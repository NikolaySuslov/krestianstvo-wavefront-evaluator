/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
(https://github.com/NikolaySuslov/krestianstvo-wavefront-evaluator/blob/master/LICENSE.md)
*/
// ═══════════════════════════════════════════════════════════════════════════
// Krestianstvo Wavefront Evaluator
//
// Deterministic reactive execution engine for multiplayer distributed apps.
// Built on Renkon (reactive programs) + Croquet synchronisation model.
//
// Architecture (top → bottom):
//   Reflector shim  stamps canonical pulses, simulates network delivery
//   Meta Program    orchestrates worlds: warp · drain · stability · UI sync
//   World           hosts the reactive node graph (W.reduce per node)
//   Host helpers    _worldNextAt · _worldSnapshot (no node names)
//
// Two-layer time:
//   Macro-tick  shared logical time, discrete, reflector-stamped, observable
//   Micro-tick  local settlement (drain · warp · feedback), transient, hidden
// ═══════════════════════════════════════════════════════════════════════════

// ── Bootstrap ─────────────────────────────────────────────────────────────────

  const { ProgramState } = import(
    "https://cdn.jsdelivr.net/npm/renkon-core/dist/renkon-core.js"
  );

// ── Priority queue (_Q) ───────────────────────────────────────────────────────
// Sorted min-heap over fireAt. All operations are pure — no mutation.
// Used by W.reduce to manage each node's local queue of future messages.

const _Q = (() => {
  const enqueue = (q, e) => [...q, e].sort((a, b) => a.fireAt - b.fireAt);
  const split   = (q, now) => ({
    ready: q.filter(e => e.fireAt <= now),
    later: q.filter(e => e.fireAt >  now),
  });
  const nextAt  = (q) => q.length > 0 ? q[0].fireAt : Infinity;
  return Object.freeze({ enqueue, split, nextAt });
})();

// ── Node runtime (W) ─────────────────────────────────────────────────────────
// W.reduce(state, pulse, nodeId, handlers) → newState
//   Processes one pulse through a node's message handlers.
//   Manages: inbound outbox delivery (evalGen-gated), queue splitting,
//   __macro injection, depth tracking for feedback loops.
//
// W.stable(nodes, pulse) → bool
//   Returns true when all queues are drained past wallTime,
//   all feedback depths are 0, and the shared outbox is empty.
//
// W.export(Renkon, nodeMap, isStable)
//   Writes node states + isStable to world.app for the host layer.
//
// W.getState(node) → plain user fields (strips _queue, _nextAt, _depth)

// ── XOROSHIRO128+ PRNG ────────────────────────────────────────────────────────
// Deterministic PRNG. Seed from reflector shim (production: snapshot/restore).
// All peers share same seed → same sequence → deterministic random values.
// Usage: W.rng.next() → [0,1)  W.rng.nextInt(N) → [0,N)
//        W.rng.state() → snapshot  W.rng.restore(st) → restore
const makeRng = (s0, s1, s2, s3) => {
  const sm = (x) => {
    x = (x + 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };
  let s = [sm(s0 >>> 0), sm(s1 >>> 0), sm(s2 >>> 0), sm(s3 >>> 0)];
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const next = () => {
    const r = (s[0] + s[3]) >>> 0;
    const t = (s[1] << 9)   >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0; s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0; s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t)    >>> 0; s[3] = rotl(s[3], 11);
    return r / 0x100000000;
  };
  return {
    next,
    nextInt:  (n) => Math.floor(next() * n),
    state:    () => ({ s0: s[0], s1: s[1], s2: s[2], s3: s[3] }),
    restore:  (st) => { s = [st.s0>>>0, st.s1>>>0, st.s2>>>0, st.s3>>>0]; },
  };
};

const W = (() => {
  const reduce = (state, pulse, nodeId, handlers) => {
    if (!pulse) return state;
    const { wallTime, logicalTime, isSubTick } = pulse;
    const appRef = pulse._appRef;

    // Collect inbound send() messages for this node.
    // Only consume entries written in a PREVIOUS evalGen — entries written
    // in the CURRENT evalGen were produced by another node earlier in this
    // same evaluate() pass and must wait for the next evaluate() to be seen.
    // This prevents the outbox wipe from destroying messages mid-pass.
    const inbound = (appRef?._outbox?.[nodeId] ?? [])
      .filter(m => (m._evalGen ?? 0) < (appRef?._currentEvalGen ?? 0))
      .map(m => ({
        fireAt: wallTime, msg: m.msg, payload: m.payload,
        _depth: (m._depth ?? 0),
      }));
    // Remove only the consumed entries, leaving same-gen entries in place.
    if (appRef?._outbox?.[nodeId]) {
      appRef._outbox[nodeId] = appRef._outbox[nodeId]
        .filter(m => (m._evalGen ?? 0) >= (appRef?._currentEvalGen ?? 0));
      if (appRef._outbox[nodeId].length === 0) delete appRef._outbox[nodeId];
    }

    // Split own queue. Queue entries may carry _depth from a feedback() call.
    const { ready: ownReady, later } = _Q.split(state._queue ?? [], wallTime);
    const allReady = [...inbound, ...ownReady];

    // Inject __macro once per logicalTime (W-managed via _lt).
    // Skip if this node already processed this logicalTime — prevents
    // double-firing under warp replay and makes incremental __macro the default.
    // App handlers decide what to do when called; W ensures they're called once.
    if (!isSubTick && (state._lt ?? -1) !== logicalTime) {
      allReady.unshift({ fireAt: wallTime, msg: "__macro", payload: pulse, _depth: 0 });
    }

    const { _queue, _nextAt, _depth: _prevDepth, _lt: _prevLt, ...userState0 } = state;
    let userState = userState0;
    let newQueue  = later;
    let maxDepthSeen = 0;

    for (const entry of allReady) {
      const handler = handlers[entry.msg];
      if (!handler) continue;

      const entryDepth = entry._depth ?? 0;
      maxDepthSeen = Math.max(maxDepthSeen, entryDepth);

      const effects = [];
      const ctx = {
        wallTime, logicalTime,
        // Current feedback loop depth for this entry.
        depth: entryDepth,
        // Schedule a future at a real time offset.
        // delayMs > 0 starts a new phase — depth resets to 0.
        // delayMs = 0 stays within the same wave — depth is preserved.
        future: (delayMs, msg, payload) =>
          effects.push({ kind: "future", fireAt: wallTime + delayMs, msg, payload,
            _depth: delayMs > 0 ? 0 : entryDepth }),
        // Send a message to another node — same wave, depth preserved.
        // The receiving node will see this depth on the next evaluate() call,
        // so the round-trip depth accumulates correctly across send() boundaries.
        send: (targetId, msg, payload) =>
          effects.push({ kind: "send", targetId, msg, payload, _depth: entryDepth }),
        // Schedule a feedback loop iteration at the same wallTime.
        // Only fires if entryDepth < maxDepth — enforces termination.
        // Each feedback() call increments depth by 1, making the loop
        // depth a first-class, observable property of the wavefront.
        feedback: (msg, payload, maxDepth = 32) => {
          if (entryDepth < maxDepth) {
            const fbDelay = pulse._fbStepMs ?? 0;
            effects.push({ kind: "future", fireAt: wallTime + fbDelay, msg, payload, _depth: entryDepth + 1 });
          }
        },
        // Schedule msg at fireAt=wallTime (delay=0) — re-enqueues every drain pass.
        // Runs once per drain iteration, bounded by the drain cap (compute budget).
        // Deterministic: all peers execute the same number of steps per tick.
        // Use for unbounded local computation — the reflector tick is the interrupt.
        futureInf: (msg, payload) =>
          effects.push({ kind: "future", fireAt: wallTime, msg, payload, _depth: entryDepth }),
        // localReflector: activate a self-hosting logical clock at innerTickDelay.
        // The clock drives the local simulation autonomously via futureInf-style
        // recursion. All local nodes receive identical ticks — same drain sequence,
        // same state on all currently-connected peers.
        // On outer reflector reconnect: warp overwrites speculative local state.
        // innerTickDelay < 1 = sub-tick (many inner ticks per outer tick)
        // innerTickDelay >= 1 = one inner tick per outer tick (paced mode)
        localReflector: (tickMsg, innerTickDelay = 0) =>
          effects.push({ kind: "future", fireAt: wallTime + innerTickDelay,
                         msg: tickMsg, payload: { _isLocalTick: true, _innerTickDelay: innerTickDelay },
                         _depth: entryDepth }),
      };

      userState = handler(userState, entry.payload, ctx);

      for (const eff of effects) {
        if (eff.kind === "future") {
          newQueue = _Q.enqueue(newQueue,
            { fireAt: eff.fireAt, msg: eff.msg, payload: eff.payload, _depth: eff._depth ?? 0 });
        } else if (eff.kind === "send" && appRef) {
          appRef._outbox ??= {};
          appRef._outbox[eff.targetId] ??= [];
          appRef._outbox[eff.targetId].push(
            { msg: eff.msg, payload: eff.payload, _depth: eff._depth ?? 0,
              _evalGen: appRef._currentEvalGen });
        }
      }
    }

    return {
      ...userState,
      _queue:  newQueue,
      _nextAt: _Q.nextAt(newQueue),
      _depth:  maxDepthSeen,
      // _lt: last logicalTime for which __macro ran — W-managed infrastructure.
      // Preserved on sub-ticks so the once-per-LT guard works across heartbeat.
      _lt:     isSubTick ? (state._lt ?? -1) : logicalTime,
    };
  };

  // stable: world is settled when:
  // 1. All node queues have no ready entries (fireAt > wallTime)
  // 2. No node is mid-feedback-loop (_depth === 0)
  // 3. The shared outbox is empty — ctx.send() messages are pending work
  //    just as much as queue entries, but they live outside any node's _queue.
  //    Without this check, a send() at the end of a feedback chain leaves
  //    the world appearing stable while a message is undelivered in the outbox.
  const stable = (nodes, pulse) => {
    const wall    = pulse?.wallTime ?? 0;
    const appRef  = pulse?._appRef;
    const outboxEmpty = !appRef || Object.keys(appRef._outbox ?? {}).length === 0;
    // Flatten arrays of W nodes so W.stable([coordinator, cells]) works
    // without manually spreading — Renkon array behaviors are passed directly.
    const flat = nodes.flatMap(n => Array.isArray(n) ? n : [n]);
    return outboxEmpty && flat.every(n =>
      !n ||
      ((n._queue ?? []).every(e => e.fireAt > wall) && (n._depth ?? 0) === 0)
    );
  };

  const exportFn = (Renkon, nodeMap, isStable) => {
    const ws = Renkon.app.meta.app.registry.get(Renkon.app.id).app;
    ws.isStable    = isStable;
    ws.logicalTime = Renkon.app._lastPulse?.logicalTime ?? 0;
    for (const [k, v] of Object.entries(nodeMap)) ws[k] = v;
    return null;
  };

  const getState = (n) => {
    if (!n) return null;
    const { _queue, _nextAt, _depth, _lt, ...user } = n;
    return user;
  };

  // W.localReflector(tickMsg, innerTickDelay) — handler mixin for self-hosting clock.
  // Merges into a W.reduce handlers object to create an autonomous logical clock node.
  // The clock activates on __macro and drives itself via ctx.localReflector().
  // innerTickDelay: 0 = sub-tick (max speed), 0.1 = 10 inner ticks per outer tick, etc.
  //
  // Usage:
  //   W.reduce(state, pulse, "clock", {
  //     ...W.localReflector("tick", 0),
  //     tick: (s, p, ctx) => {
  //       ctx.localReflector("tick", p._innerTickDelay ?? 0); // keep driving
  //       return { ...s, localLt: s.localLt + 1 };
  //     }
  //   })
  const localReflectorMixin = (tickMsg, innerTickDelay = 0) => ({
    __macro: (s, p, ctx) => {
      if (s._localActive) return s;
      ctx.localReflector(tickMsg, innerTickDelay);
      return { ...s, _localActive: true, localLt: 0 };
    },
  });

  // Shared deterministic RNG — seeded by the reflector shim.
  // IMPORTANT: Always call W.rng.seed(logicalTime) at the start of each
  // cycle (__macro handler) so both peers reset to the same state.
  // Never rely on the continuous RNG state across peers — each world
  // in the same tab shares the same object and will advance it independently.
  const rng = makeRng(0x12345678, 0x9abcdef0, 0xdeadbeef, 0xcafebabe);

  // seed(lt): reset the RNG to a deterministic state derived from logicalTime.
  // Both peers call this with the same lt → identical subsequent sequence.
  // Use at the top of every __macro handler that uses W.rng.
  rng.seed = (lt) => {
    const ltN = (lt >>> 0);
    rng.restore({
      s0: (ltN ^ 0x12345678) >>> 0,
      s1: (ltN * 0x9e3779b9) >>> 0,
      s2: (ltN ^ 0xdeadbeef) >>> 0,
      s3: ((ltN << 13) ^ 0xcafebabe) >>> 0,
    });
  };

  return Object.freeze({ reduce, stable, export: exportFn, getState,
                         localReflector: localReflectorMixin, rng });
})();

// ── Host helpers ──────────────────────────────────────────────────────────────
// Registered on meta.ps.app and called from META_PROGRAM as Renkon.app.*.
// Completely generic — no node names, work for any world topology.

// _worldNextAt(world) → number | null
//   Earliest pending fireAt across all W nodes. Drives wallTime advancement
//   in drain and warp loops so queue entries fire at the right moment.

const _worldNextAt = (world) => {
  let t = Infinity;
  for (const key of Object.keys(world)) {
    const v = world[key];
    if (v === null || typeof v !== 'object') continue;
    if (typeof v._nextAt === 'number') {
      t = Math.min(t, v._nextAt);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== null && typeof item === 'object' && typeof item._nextAt === 'number')
          t = Math.min(t, item._nextAt);
      }
    }
  }
  return isFinite(t) ? t : null;
};

// _worldSnapshot(world, source, iter) → { source, iter, nodes }
//   Serialisable per-evaluate snapshot of all W node states.
//   Infrastructure fields (_queue etc.) excluded; _depth exposed as "depth".
//   Used for telemetry. nodes[nodeName] contains app-specific scalar fields.

const _worldSnapshot = (world, source, iter) => {
  const nodes = {};
  const scanNode = (key, v) => {
    if (v === null || typeof v !== 'object' || !Array.isArray(v._queue)) return;
    const fields = {};
    for (const [k, fv] of Object.entries(v)) {
      if (k.startsWith('_')) continue;
      if (fv === null || typeof fv !== 'object') fields[k] = fv;
    }
    nodes[key] = { ...fields, queueLen: v._queue.length, nextAt: v._nextAt ?? Infinity, depth: v._depth ?? 0 };
  };
  for (const key of Object.keys(world)) {
    const v = world[key];
    if (Array.isArray(v)) v.forEach((item, i) => scanNode(key + "_" + i, item));
    else scanNode(key, v);
  }
  return { source, iter, nodes };
};

// ── Meta program (META_PROGRAM) ───────────────────────────────────────────────
// Renkon program that runs above world programs.
// Receives reflector pulses via a queued receiver (no pulse dropped under jitter).
// wallTime is logical (lt * REFLECTOR_MS) — pure virtual time, no Date.now().
//
//   WARP (new LT arrives, previous cycle unfinished)
//     Synchronous loop advancing wallTime via _worldNextAt until isStable.
//     Catches up a peer that missed pulses. Uses logical fireAt values only.
//
//   MACRO pulse (new logicalTime)
//     Evaluates world, then drains futures whose fireAt ≤ pulse.wallTime.
//     Futures beyond wallTime wait for the next reflector pulse.

const META_PROGRAM = `
  const reflectorPulse = Events.receiver({queued: true});

  const dispatch = (() => {
    if (!reflectorPulse?.length) return null;

    const reg       = Renkon.app.registry;
    const SUBTICK_MS = Renkon.app._subtickMs ?? 1;
    for (const pulse of reflectorPulse) {
      for (const [id, worldps] of reg) {
        const world  = worldps.app;
        const lastLT = world.logicalTime || 0;
        const isNewPulse = pulse.logicalTime > lastLT;


        // ── WARP: finish the previous cycle before starting the new macro ────
        // Warp: only when peer missed pulses (LT jumped > 1).
        // With logical time, pending futures on LT+1 are normal — drain handles them.
        if (isNewPulse && lastLT > 0 && !world.isStable && pulse.logicalTime > lastLT + 1) {
          console.log(\`[WARP] \${id} LT \${lastLT} → \${pulse.logicalTime}\`);
          world._telemetry ??= {};
          world._telemetry[lastLT] ??= [];
          let safety = 0;
          while (!world.isStable && safety < 1000) {
            safety++;
            world._currentEvalGen++;
            const _wn = Renkon.app._worldNextAt(world) ?? world._lastPulse.wallTime;
            worldps.registerEvent("reflector", {
              ...world._lastPulse,
              wallTime: _wn,
              isSubTick: true,
            });
            worldps.evaluate();
            world._telemetry[lastLT].push(
              Renkon.app._worldSnapshot?.(world, "warp", safety)
            );
          }
          world._lastWarpIters = safety;
          // ── CRITICAL: flush UI while logicalTime is STILL the old LT ──────
          if (typeof Renkon.app._uiRefresh === "function") Renkon.app._uiRefresh();
        }

        // ── STANDARD: process the new macro pulse ──────────────────────────
        if (isNewPulse || lastLT === 0) {
          world._currentEvalGen = (world._currentEvalGen ?? 0) + 1;
          const p = { ...pulse, _appRef: world, _fbStepMs: Renkon.app._fbStepMs ?? 0 };
          world._lastPulse = p;
          world.logicalTime = p.logicalTime; // ← logicalTime advances HERE
          worldps.registerEvent("reflector", p);
          worldps.evaluate();

          // Baseline snapshot after macro pulse — iter 0
          world._telemetry ??= {};
          world._telemetry[p.logicalTime] = [
            Renkon.app._worldSnapshot?.(world, "macro", 0)
          ];
          // Prune: keep only the last 5 LT entries to prevent unbounded growth.
          // Runs once per new LT — not per push — so cost is O(keys) ~= O(5).
          const _tKeys = Object.keys(world._telemetry).map(Number).sort((a, b) => a - b);
          if (_tKeys.length > 5) delete world._telemetry[_tKeys[0]];

          // Pure Krestianstvo drain: release futures whose fireAt ≤ wallTime.
          // wallTime is logical (lt * REFLECTOR_MS) — futures at fireAt > wallTime
          // wait for the next reflector pulse. No real-time involvement.
          let iters = 0;
          while (!world.isStable && iters < 10000) {
            const _wn = Renkon.app._worldNextAt(world);
              if (_wn !== null && _wn >= p.wallTime + SUBTICK_MS) break;
            iters++;
            world._currentEvalGen++;
            worldps.registerEvent("reflector", { ...p, wallTime: _wn ?? p.wallTime, isSubTick: true });
            worldps.evaluate();
            world._telemetry[p.logicalTime].push(
              Renkon.app._worldSnapshot?.(world, "drain", iters)
            );
          }
          world._lastDrainIters = iters;
          // Outbox flush: deliver pending ctx.send() messages.
          if (world._outbox && Object.keys(world._outbox).length > 0) {
            world._currentEvalGen++;
            worldps.registerEvent("reflector", { ...p, isSubTick: true });
            worldps.evaluate();
          }
        }
      }

      // UI refresh after each pulse.
      if (typeof Renkon.app._uiRefresh === "function") Renkon.app._uiRefresh();
    }

    return null;
  })();
`;

// ── Factories ─────────────────────────────────────────────────────────────────

// makeMeta(peerId) → { ps, id, register, injectPulse }
//   Creates a meta ProgramState running META_PROGRAM.
//   register(world) — adds a world to this meta's registry.
//   injectPulse(pulse) — delivers a reflector pulse to META_PROGRAM.
//
// makeWorld(worldId, programString) → { ps, app, id, getNodeState, getQueue }
//   Creates a world ProgramState from a user program string.
//   getNodeState(name) — returns plain user state for a named W node.
//   getQueue(name)     — returns raw queue for a named W node.

const makeMeta = (peerId) => {
  const ps = new ProgramState(0, {
    id: peerId, registry: new Map(),
    logicalTime: 0, isStable: false, lastDispatch: null,
  });
  ps.setupProgram([META_PROGRAM]);
  ps.evaluator(0);

  const register    = (world) => {
    world.app.meta          = ps;
    ps.app.registry.set(world.id, world.ps);
  };

  let _lastOuterLt = 0;
  let _localLt     = 0;
  let _autoInterval = null;

  const injectPulse = (pulse) => {
    _lastOuterLt = pulse.logicalTime;
    _localLt     = pulse.logicalTime; // stay in sync with outer
    // Outer reflector connected — stop autonomous mode, outer takes over
    if (_autoInterval) stopAutonomous();
    ps.registerEvent("reflectorPulse", pulse);
    ps.evaluate();
  };

  // Autonomous fallback: self-inject logical pulses when outer reflector is silent.
  // Pure logical time — lt increments, wallTime = lt. No Date.now().
  // On outer reconnect: outer logicalTime takes over, warp catches up if needed.
  const startAutonomous = () => {
    if (_autoInterval) return;
    _autoInterval = setInterval(() => {
      _localLt++;
      const pulse = Object.freeze({ logicalTime: _localLt, wallTime: _localLt, _isLocal: true });
      ps.registerEvent("reflectorPulse", pulse);
      ps.evaluate();
    }, REFLECTOR_MS);
  };

  const stopAutonomous = () => {
    if (_autoInterval) { clearInterval(_autoInterval); _autoInterval = null; }
  };

  const getLocalLt = () => _localLt;
  return { ps, id: peerId, register, injectPulse, startAutonomous, stopAutonomous, getLocalLt };
};

const makeWorld = (worldId, programScripts) => {
  const ps = new ProgramState(0, {
    id:              worldId,
    meta:            null,
    isStable:        true,
    W,
    _outbox:         {},
    _outboxGen:      0,
    _currentEvalGen: 0,
    _lastPulse:      null,
  });
  const scripts = Array.isArray(programScripts) ? programScripts : [programScripts];
  ps.setupProgram(scripts);
  ps.evaluator(0, { once: true });

  // Helper to extract node state for the view
  const getNodeState = (name) => W.getState(ps.app[name]);
  const getQueue     = (name) => ps.app[name]?._queue ?? [];
  
  return { ps, app: ps.app, id: worldId, getNodeState, getQueue };
};

// ── Reflector shim ────────────────────────────────────────────────────────────
// Simulates the Croquet reflector. Stamps wallTime once per pulse — peers
// receive the identical frozen pulse object regardless of delivery timing.
//
// Default: ideal network (no latency, synchronous delivery).
// Fast version: REFLECTOR_MS=3000, SUB_STEPS=50, STEP_MS=50.
// Change REFLECTOR_MS to set how often logical time advances.
// To simulate jitter: makeShim(intervalMs, { min: 10, max: 300 })
//
// wallTime is stamped once and frozen. Delivery delay is simulated via
// setTimeout but the pulse content never changes — determinism guaranteed.

// makeShim(intervalMs, jitter)
// jitter: { peer: peerIndex, lag: N } — peer N receives each pulse N ticks late.
//         { peer: peerIndex, dropEvery: N } — peer N drops every Nth pulse.
// Both simulate network conditions in pure logical time — no Date.now().
// The delayed peer receives the same pulse content (same logicalTime, wallTime)
// just delivered later. Warp in META_PROGRAM catches it up deterministically.
const makeShim = (intervalMs = 1000, jitter = null,
                  rngSeed = { s0: 0x12345678, s1: 0x9abcdef0,
                              s2: 0xdeadbeef, s3: 0xcafebabe }) => {
  W.rng.restore(rngSeed); // seed shared RNG — same on all peers
  let lt = 0;
  const peers   = [];
  // pending[i] = queue of pulses waiting to be delivered to peer i
  const pending = [];
  const addPeer = (m) => { peers.push(m); pending.push([]); };
  const setLt   = (n) => { lt = n; };

  const fire = () => {
    lt++;
    const pulse = Object.freeze({
      logicalTime: lt,
      wallTime:    lt,  // pure logical tick count — no ms scaling
    });

    for (let i = 0; i < peers.length; i++) {
      // Check if this peer has a lag configured
      const lag = (jitter?.peer === i) ? (jitter.lag ?? 0) : 0;
      const dropEvery = (jitter?.peer === i) ? (jitter.dropEvery ?? 0) : 0;

      if (dropEvery > 0 && lt % dropEvery === 0) continue; // drop this pulse

      if (lag > 0) {
        // Queue the pulse — deliver when lt reaches lt+lag
        pending[i].push({ deliverAt: lt + lag, pulse });
      } else {
        peers[i].injectPulse(pulse);
      }
    }

    // Deliver any queued pulses whose deliverAt has been reached
    for (let i = 0; i < peers.length; i++) {
      while (pending[i].length > 0 && pending[i][0].deliverAt <= lt) {
        peers[i].injectPulse(pending[i].shift().pulse);
      }
    }
  };

  let _interval = null;
  const start = () => {
    fire();
    _interval = setInterval(fire, intervalMs);
  };
  const stop  = () => { if (_interval) { clearInterval(_interval); _interval = null; } };
  const isRunning = () => _interval !== null;

  return { addPeer, start, stop, isRunning, setLt };
};

// ══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 1 — Counter / Subcounter
// ══════════════════════════════════════════════════════════════════════════════
//
// Demonstrates:
//   • Macro pulses driving a counter across two deterministic peers
//   • Real-time sub-step drain at STEP_MS intervals (STEP_MS > 0)
//     or synchronous instant drain (STEP_MS = 0)
//   • Warp mechanism: if a new macro arrives before the previous cycle
//     finishes, warp drains the remainder synchronously before advancing
//   • Visual integrity trace showing both peers filling the sub-step bar
//
// Constants:
//   PULSE_MS   — interval between macro pulses (ms)
//   SUB_STEPS  — number of sub-steps per cycle
//   STEP_MSf    — delay between sub-steps (0 = instant sync drain)

const REFLECTOR_MS   = 50;   // single reflector — all worlds, drives animation
const PULSE_MS       = REFLECTOR_MS;
// Sub-tick threshold: future(delay) where delay < SUBTICK_MS drains this tick.
// future(0.5) → sub-tick, fires now.  future(1) → next tick.  future(60) → 60 ticks.
// Logical time is pure tick counts — REFLECTOR_MS is only the shim's real-time interval.
const SUBTICK_MS     = 1;  // anything < 1 tick is a sub-tick
// Sub-tick resolution: wallTime = lt * REFLECTOR_MS * SUBTICK_RES
// future(REFLECTOR_MS) = next reflector tick (animation frame)
// future(1)            = one logical sub-tick within a tick
// Set SUBTICK_RES > 1 to enable 1000s of sub-steps per tick via future(1) chains
const SUBTICK_RES    = 1;    // 1 = disabled (future ms = real ms). Increase for sub-ticks.
const SUB_STEPS      = 50;
const STEP_MS        = 1;     // 1 tick per sub-step
const COUNTER_CYCLE_MS = 60;   // ticks between counter cycles

const WORLD_PROGRAM = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const counter = Behaviors.collect(
    { count: 0, cycleId: 0, started: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "counter", {
      __macro: (s, p, ctx) => {
        if (s.started) return s;
        ctx.future(0, "newCycle", { cycleId: 1 });
        return { ...s, started: true };
      },
      newCycle: (s, p, ctx) => {
        ctx.send("subcounter", "startSubCount", { cycleId: p.cycleId });
        ctx.future(CYCLE_VAL, "newCycle", { cycleId: p.cycleId + 1 });
        return { ...s, count: s.count + 1, cycleId: p.cycleId };
      },
    })
  );

  const subcounter = Behaviors.collect(
    { subCount: 0, stepsDone: 0, currentCycle: 0, stepsTarget: SUBSTEPS_VAL },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "subcounter", {
      startSubCount: (s, p, ctx) => {
        if (p.cycleId <= s.currentCycle) return s;
        ctx.future(0, "step", p.cycleId);
        return { ...s, subCount: 0, stepsDone: 0, currentCycle: p.cycleId, stepsTarget: SUBSTEPS_VAL };
      },
      step: (s, cycleId, ctx) => {
        if (cycleId !== s.currentCycle || s.stepsDone >= SUBSTEPS_VAL) return s;
        const next = s.stepsDone + 1;
        if (next < SUBSTEPS_VAL) ctx.future(STEPMS_VAL, "step", cycleId);
        return { ...s, subCount: s.subCount + 1, stepsDone: next };
      }
    })
  );

  // World stable when queues empty AND subcounter reached its target.
  // isStable: queues empty only — don't require subcounter completion.
  // Subcounter animation runs across many reflector ticks; requiring completion
  // would trigger warp on every pulse since the chain takes 2500ms to finish.
  const _isStable = W.stable([counter, subcounter], reflector);

const _export = W.export(Renkon, { counter, subcounter }, _isStable);
`
.replace(/CYCLE_VAL/g,    String(COUNTER_CYCLE_MS))
.replace(/STEPMS_VAL/g,   String(STEP_MS))
.replace(/SUBSTEPS_VAL/g, String(SUB_STEPS))

// ══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 2 — Fixed-Point Bisection (Feedback Loop)
// ══════════════════════════════════════════════════════════════════════════════
//
// Demonstrates:
//   • ctx.feedback() — feedback loop depth as a first-class wavefront property
//   • Two-node feedback: estimator ↔ corrector, bisecting toward nearest integer
//   • Depth accumulates across send() boundaries (same wave, depth preserved)
//   • Real-time animation via FB_STEP_MS heartbeat (FB_STEP_MS > 0)
//   • Varying convergence depth per cycle via non-trivial starting formula
//
// Starting formula: initial = 50 + 49 * sin(lt * 2.3)
//   Produces values in [1, 99] with varying fractional parts.
//   Cycles near an integer converge in 3–5 iterations (bar partially filled).
//   Cycles far from an integer take 15–25+ iterations (bar fully filled).
//   This makes the depth bar and canvas curve look different each cycle,
//   demonstrating that convergence depth is a genuine property of the input,
//   not a fixed constant of the algorithm.
//
// Bisection recurrence (per iteration):
//   correction = (value + target) / 2
//   refined    = (value + correction) / 2
//             = (3·value + target) / 4
//   Converges with ratio 3/4 per step. Number of steps to reach EPSILON:
//   N ≈ log(|initial - target| / EPSILON) / log(4/3)
//
// Constants:
//   EPSILON      — convergence threshold (loop stops when |delta| < EPSILON)
//   MAX_FB_DEPTH — maximum feedback depth (circuit breaker)
//   FB_STEP_MS   — delay between iterations (0 = sync, >0 = animated)
//   FB_PULSE_MS  — macro pulse interval for feedback worlds
//                  must be > MAX_FB_DEPTH × FB_STEP_MS to avoid warp

// Two nodes: estimator and corrector.
// Each macro pulse: estimator proposes an initial value (a noisy integer).
// corrector observes it and sends back a refined value via feedback.
// estimator applies the correction and re-evaluates if delta > EPSILON.
// The loop terminates when |value - correction| < EPSILON — fixed point.
//
// This demonstrates ctx.feedback() as a first-class wavefront property:
// each iteration increments depth, telemetry captures the full convergence
// trajectory, and stability requires depth === 0 (loop fully settled).

const EPSILON      = 0.01;
const MAX_FB_DEPTH = 64;
const FB_REFLECTOR_MS = REFLECTOR_MS;
const FB_STEP_MS      = 1;     // 1 tick per feedback iteration
const FB_PULSE_MS     = FB_REFLECTOR_MS;
const FB_CYCLE_MS     = 80;   // ticks between feedback cycles (> MAX_FB_DEPTH * FB_STEP_MS = 64)
                               // must be > MAX_FB_DEPTH * FB_STEP_MS = 64*50 = 3200ms... 
                               // use 4000ms to be safe

const FEEDBACK_WORLD_PROGRAM = `
  const W       = Renkon.app.W;
  const reflector = Events.receiver();

  // estimator: proposes a value each macro pulse, refines it on feedback.
  // Feedback world uses ONLY ctx.future and ctx.feedback — no ctx.send.
  // This keeps the world stable between ticks (futures at fireAt > wallTime)
  // and prevents warp from firing. Each iteration fires one per FB_STEP_MS tick.
  //
  // Flow: startCycle → observe(future) → correct(future) → refine(future) → loop
  // Cycle timing: __macro fires every FB_CYCLE_TICKS ticks (logicalTime % N === 1).
  // No self-rescheduling future — eliminates warp-driven cycle accumulation.
  const estimator = Behaviors.collect(
    { value: 0, iterations: 0, cycleId: 0, trace: [] },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "estimator", {
      __macro: (s, p, ctx) => {
        // Start a new cycle every FB_CYCLE_TICKS macro ticks
        if (p.logicalTime % FB_CYCLE_TICKS_VAL !== 1) return s;
        const cycleId = p.logicalTime;
        const initial = 50 + 49 * Math.sin(p.wallTime * 0.0023);
        ctx.future(0, "sendObserve", { value: initial, cycleId, wt: p.wallTime });
        return { ...s, value: initial, iterations: 0, cycleId, trace: [{n:0, v:initial}] };
      },
      sendObserve: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        ctx.send("corrector", "observe", { value: p.value, cycleId: p.cycleId });
        return s;
      },
      refine: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const delta = Math.abs(p.correction - s.value);
        const refined = (s.value + p.correction) / 2;
        if (delta > EPSILONVAL) {
          ctx.feedback("continueRefine", { value: refined, cycleId: s.cycleId }, MAX_FB_DEPTHVAL);
        }
        const newIter = s.iterations + 1;
        const newTrace = s.trace ? [...s.trace, {n:newIter, v:refined}] : [{n:newIter, v:refined}];
        return { ...s, value: refined, iterations: newIter, trace: newTrace };
      },
      continueRefine: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        ctx.send("corrector", "observe", { value: p.value, cycleId: p.cycleId });
        return s;
      },
    })
  );

  const corrector = Behaviors.collect(
    { correction: 0, cycleId: 0 },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "corrector", {
      observe: (s, p, ctx) => {
        if (p.cycleId < s.cycleId) return s;
        const target = Math.round(p.value);
        const correction = (p.value + target) / 2;
        ctx.feedback("respond", { correction, cycleId: p.cycleId }, MAX_FB_DEPTHVAL);
        return { ...s, correction, cycleId: p.cycleId };
      },
      respond: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        ctx.send("estimator", "refine", { correction: p.correction, cycleId: p.cycleId });
        return s;
      },
    })
  );

  const _isStable = W.stable([estimator, corrector], reflector);
  const _export   = W.export(Renkon, { estimator, corrector }, _isStable);
`
  .replace(/EPSILONVAL/g,      "0.01")
  .replace(/MAX_FB_DEPTHVAL/g, "64")
  .replace(/FB_CYCLE_TICKS_VAL/g, "80");

// ══════════════════════════════════════════════════════════════════════════════
// WIRE — Connect examples to infrastructure
// ══════════════════════════════════════════════════════════════════════════════

const meta1 = makeMeta("peer_A");
const meta2 = makeMeta("peer_B");

// Inject STEP_MS so META_PROGRAM can branch on sync vs real-time mode.
meta1.ps.app._subtickMs      = SUBTICK_MS;  // 1 = sub-tick threshold
meta1.ps.app._worldNextAt    = _worldNextAt;
meta2.ps.app._worldNextAt    = _worldNextAt;
meta1.ps.app._worldSnapshot  = _worldSnapshot;
meta2.ps.app._worldSnapshot  = _worldSnapshot;

const worldA = makeWorld("worldA", WORLD_PROGRAM);
const worldB = makeWorld("worldB", WORLD_PROGRAM);

meta1.register(worldA);
meta2.register(worldB);

// Feedback loop worlds — always sync drain (STEP_MS=0 equivalent):
// feedback() schedules at the same wallTime so the drain loop exhausts
// the entire convergence chain in one synchronous burst per macro pulse.
const meta3 = makeMeta("peer_A_fb");
const meta4 = makeMeta("peer_B_fb");
meta3.ps.app._fbStepMs = FB_STEP_MS;
meta4.ps.app._fbStepMs = FB_STEP_MS;
meta3.ps.app._worldNextAt    = _worldNextAt;
meta4.ps.app._worldNextAt    = _worldNextAt;
meta3.ps.app._worldSnapshot  = _worldSnapshot;
meta4.ps.app._worldSnapshot  = _worldSnapshot;

const worldC = makeWorld("worldC", FEEDBACK_WORLD_PROGRAM);
const worldD = makeWorld("worldD", FEEDBACK_WORLD_PROGRAM);

meta3.register(worldC);
meta4.register(worldD);

// Single 50ms reflector — all four worlds, same as wave world pattern.
// Cycle timing is future-driven inside world programs. No separate shims.
// No heartbeat — reflector IS the animation driver.
const shim = makeShim(REFLECTOR_MS);
shim.addPeer({ injectPulse: (p) => meta1.injectPulse(p) });
shim.addPeer({ injectPulse: (p) => meta2.injectPulse(p) });
shim.addPeer({ injectPulse: (p) => meta3.injectPulse(p) });
shim.addPeer({ injectPulse: (p) => meta4.injectPulse(p) });

// RNG worlds
const meta9  = makeMeta("peer_A_rng");
const meta10 = makeMeta("peer_B_rng");
meta9.ps.app._subtickMs    = SUBTICK_MS;
meta9.ps.app._worldNextAt  = _worldNextAt;
meta9.ps.app._worldSnapshot = _worldSnapshot;
meta10.ps.app._subtickMs   = SUBTICK_MS;
meta10.ps.app._worldNextAt = _worldNextAt;
meta10.ps.app._worldSnapshot = _worldSnapshot;
const worldI = makeWorld("worldI", RNG_WORLD_PROGRAM);
const worldJ = makeWorld("worldJ", RNG_WORLD_PROGRAM);
meta9.register(worldI);
meta10.register(worldJ);

// Zeno worlds
const meta7 = makeMeta("peer_A_zeno");
const meta8 = makeMeta("peer_B_zeno");
meta7.ps.app._subtickMs   = SUBTICK_MS;
meta7.ps.app._worldNextAt = _worldNextAt;
meta7.ps.app._worldSnapshot = _worldSnapshot;
meta8.ps.app._subtickMs   = SUBTICK_MS;
meta8.ps.app._worldNextAt = _worldNextAt;
meta8.ps.app._worldSnapshot = _worldSnapshot;
const worldG = makeWorld("worldG", ZENO_WORLD_PROGRAM);
const worldH = makeWorld("worldH", ZENO_WORLD_PROGRAM);
meta7.register(worldG);
meta8.register(worldH);
shim.addPeer({ injectPulse: (p) => meta5.injectPulse(p) });
shim.addPeer({ injectPulse: (p) => meta6.injectPulse(p) });
shim.addPeer({ injectPulse: (p) => meta9.injectPulse(p) });
shim.addPeer({ injectPulse: (p) => meta10.injectPulse(p) });
shim.addPeer({ injectPulse: (p) => meta7.injectPulse(p) });
shim.addPeer({ injectPulse: (p) => meta8.injectPulse(p) });
shim.start();

// ── Disconnect/Reconnect button ───────────────────────────────────────────────
const _makeShimControl = () => {
  const el = document.createElement("div");
  Object.assign(el.style, {
    fontFamily: "ui-monospace,monospace", padding: "12px 20px",
    background: "#0d0d0d", borderRadius: "10px", margin: "10px",
    maxWidth: "620px", border: "1px solid #222",
    display: "flex", alignItems: "center", gap: "16px"
  });

  const btn = document.createElement("button");
  Object.assign(btn.style, {
    padding: "6px 18px", borderRadius: "6px", border: "none",
    fontFamily: "ui-monospace,monospace", fontSize: "11px",
    fontWeight: "bold", cursor: "pointer", letterSpacing: "1px",
    background: "#238636", color: "#fff"
  });

  const status = document.createElement("span");
  Object.assign(status.style, { fontSize: "10px", color: "#888" });

  const update = () => {
    const running = shim.isRunning();
    btn.textContent  = running ? "DISCONNECT" : "RECONNECT";
    btn.style.background = running ? "#f85149" : "#238636";
    status.textContent = running
      ? "reflector connected — peers in sync"
      : "reflector stopped — running standalone on local logical clock";
    status.style.color = running ? "#238636" : "#d29922";
  };

  btn.onclick = () => {
    const allMetas = [meta1, meta2, meta3, meta4, meta5, meta6, meta7, meta8];
    if (shim.isRunning()) {
      shim.stop();
      allMetas.forEach(m => m.startAutonomous());
    } else {
      const maxLt = Math.max(...allMetas.map(m => m.getLocalLt()));
      shim.setLt(maxLt);
      allMetas.forEach(m => m.stopAutonomous());
      shim.start();
    }
    update();
  };

  update();
  el.appendChild(btn);
  el.appendChild(status);
  document.body.insertBefore(el, document.body.firstChild);
};
// Auto-start: begin in autonomous mode immediately.
// If the outer reflector connects, it takes over via injectPulse syncing _localLt.
// This allows a peer to run standalone with no reflector on the network.
const _allMetas = [meta1, meta2, meta3, meta4, meta5, meta6, meta7, meta8, meta9, meta10];
_allMetas.forEach(m => m.startAutonomous());

_makeShimControl();

// ══════════════════════════════════════════════════════════════════════════════
// VIEWS — DOM rendering
// ══════════════════════════════════════════════════════════════════════════════

// _renderView is extracted as an imperative function so META_PROGRAM can call
// it synchronously via meta1/meta2.ps.app._uiRefresh after a warp/drain cycle,
// without waiting for the next Events.timer(16) tick.

const _vt = Events.timer(16);
const waveStack = new Map();

const _renderView = () => {
  // Use 'worldps' to access the internal app state reliably
  if (!worldA?.ps?.app || !worldB?.ps?.app) return null;

  const getW = (w) => {
    const s = w.getNodeState("subcounter");
    const c = w.getNodeState("counter");
    const lt = s?.currentCycle || w.ps.app.logicalTime || 0;
    return {
      lt,
      sub:        s?.subCount   ?? 0,
      stepsDone:  s?.stepsDone  ?? 0,
      count:      c?.count      ?? 0,
      target: s?.stepsTarget ?? SUB_STEPS,   // ← use the constant, not literal 50
      drainIters: w.ps.app._lastDrainIters ?? 0,
      warpIters:  w.ps.app._lastWarpIters  ?? 0,
      telemetry:  w.ps.app._telemetry?.[lt] ?? [],
    };
  };
  
  const a = getW(worldA), b = getW(worldB);
  // Use the max LT seen across both peers as currentLT.
  // Using only peer A's LT caused premature 'fail' when peer A advanced 2+
  // LTs ahead of peer B due to jitter — the gap threshold fired incorrectly.
  const currentLT = Math.max(a.lt, b.lt);

  const updateStack = (data, peerId) => {
    if (data.lt === 0) return;
    if (!waveStack.has(data.lt)) {
      waveStack.set(data.lt, {
        a: 0, b: 0, aValues: {}, bValues: {},
        aStepsDone: 0, bStepsDone: 0,
        aDrainIters: 0, bDrainIters: 0,
        aWarpIters: 0,  bWarpIters: 0,
        target: data.target, status: 'process'
      });
    }

    const wave = waveStack.get(data.lt);
    const id = peerId.toLowerCase();

    // Update data
    wave[id] = Math.max(wave[id], data.sub);
    wave[id + 'Values'][data.sub] = data.count;
    wave[id + 'StepsDone']  = Math.max(wave[id + 'StepsDone'],  data.stepsDone);
    wave[id + 'DrainIters'] = Math.max(wave[id + 'DrainIters'], data.drainIters);
    wave[id + 'WarpIters']  = Math.max(wave[id + 'WarpIters'],  data.warpIters);

    // --- INTEGRITY & STATUS ---
    const isNewest = data.lt === currentLT;
    const bothFinished = (wave.a >= wave.target && wave.b >= wave.target);

    // Once a wave reaches 'success' it is frozen — never overwritten.
    if (wave.status === 'success') return;

    if (bothFinished) {
      wave.status = 'success';
      if (!isNewest) wave.warped = true;
    } else if (!isNewest && currentLT > data.lt + 2) {
      wave.status = 'fail';
    } else {
      wave.status = 'process';
    }
  };

  updateStack(a, 'A');
  updateStack(b, 'B');

  const activeLTs = [...waveStack.keys()].sort((x, y) => y - x).slice(0, 3);

  let root = document.getElementById("v10-app");
  if (!root) {
    root = document.createElement("div");
    root.id = "v10-app";
    Object.assign(root.style, {
      fontFamily: "ui-monospace,monospace", padding: "20px",
      background: "#0d0d0d", color: "#eee", borderRadius: "10px", 
      margin: "10px", maxWidth: "620px", border: "1px solid #222"
    });
    document.body.appendChild(root);
  }

  const renderTrack = (lt, isActive) => {
    const wave = waveStack.get(lt);
    const colors = { success: '#238636', process: '#d29922', fail: '#f85149' };
    const statusColor = colors[wave.status] || colors.process;

    // ── ACTIVE (current LT): full dot-track view ──────────────────────────
 // REPLACE the existing renderTrack active branch with:
if (isActive) {
  const lead        = Math.max(wave.a, wave.b);
  const windowStart = Math.max(0, lead - 9);
  const cellIndices = Array.from({length: 12}, (_, i) => windowStart + i)
                           .filter(i => i <= wave.target);
  const renderRow = (label, currentSub, isIdRow = false) => `
    <div style="display:flex;gap:3px;margin-bottom:3px;align-items:center;">
      <div style="width:55px;font-size:10px;color:#555;font-weight:bold;">${label}</div>
      ${cellIndices.map(i => {
        const isFilled = i <= currentSub;
        let bgColor = "#161616", textColor = "#333";
        if (isIdRow)       { bgColor = "#222"; textColor = "#666"; }
        else if (isFilled) { bgColor = "#ccc"; textColor = "#000"; }
        return `<div style="flex:1;height:24px;background:${bgColor};
                    border:1px solid #282828;display:flex;align-items:center;
                    justify-content:center;font-size:9px;color:${textColor};">
                  ${(isIdRow || isFilled) ? i : ''}
                </div>`;
      }).join('')}
    </div>`;

  // Progress bars showing full 0→target range
  return `
    <div style="margin-bottom:16px;padding:12px;border-left:4px solid ${statusColor};
                background:#111;border-radius:4px;">
      <div style="font-size:10px;margin-bottom:10px;display:flex;
                  justify-content:space-between;align-items:center;">
        <span style="color:#888">WAVEFRONT LT ${lt}</span>
        <span style="background:${statusColor}33;color:${statusColor};padding:2px 8px;
                     border-radius:10px;font-weight:bold;border:1px solid ${statusColor}66;">
          ${wave.status.toUpperCase()}
        </span>
      </div>
      ${renderRow('ID',     wave.target, true)}
      ${renderRow('PEER A', wave.a)}
      ${renderRow('PEER B', wave.b)}
      <div style="margin-top:8px;display:flex;gap:12px;font-size:9px;color:#444;">
        <span>target: <span style="color:#666">${wave.target}</span></span>
        <span>drain: <span style="color:#666">${Math.max(wave.aDrainIters, wave.bDrainIters)} iters</span></span>
        ${wave.aWarpIters > 0 || wave.bWarpIters > 0
          ? `<span style="color:#d29922">warp: ${Math.max(wave.aWarpIters, wave.bWarpIters)} iters</span>`
          : ''}
      </div>
    </div>`;
}

    // ── COMPLETED (past LT): compact status-only badge ────────────────────
    // Dot rows are dropped — fill level is always 50/50 for completed cycles
    // and carries no information. Only success vs fail vs warped matters.
    const wasWarped  = wave.aWarpIters > 0 || wave.bWarpIters > 0;
    const warpLabel  = wasWarped ? ` · WARP ${Math.max(wave.aWarpIters, wave.bWarpIters)}i` : '';
    const drainLabel = `drain:${Math.max(wave.aDrainIters, wave.bDrainIters)}i`;
    const peerLine   = wave.status === 'fail'
      ? `<span style="color:#666; font-size:9px;">A:${wave.a} B:${wave.b} / ${wave.target}</span>`
      : `<span style="color:#444; font-size:9px;">${drainLabel}</span>`;
    return `
      <div style="margin-bottom: 8px; padding: 8px 12px; border-left: 4px solid ${statusColor}44;
                  background: #0e0e0e; border-radius: 4px; display: flex;
                  justify-content: space-between; align-items: center;">
        <span style="color: #555; font-size: 10px;">LT ${lt}${warpLabel}</span>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${peerLine}
          <span style="background: ${statusColor}22; color: ${statusColor}; padding: 1px 7px;
                       border-radius: 8px; font-size: 9px; font-weight: bold;
                       border: 1px solid ${statusColor}44">
            ${wave.status.toUpperCase()}
          </span>
        </div>
      </div>`;
  };

  root.innerHTML = `
    <div style="font-size: 13px; font-weight: bold; color: #666; margin-bottom: 20px; letter-spacing: 1px; text-align: center;">
      WAVEFRONT INTEGRITY PHYSICAL TRACE
    </div>
    ${activeLTs.map((lt, i) => renderTrack(lt, i === 0)).join('')}
  `;
};


// Register _uiRefresh so META_PROGRAM can call it synchronously after any
// warp or drain cycle, bypassing the 16 ms Events.timer gate entirely.
meta1.ps.app._uiRefresh = _renderView;
meta2.ps.app._uiRefresh = _renderView;

// ── 8. Feedback loop view ─────────────────────────────────────────────────────
// Shows convergence depth per cycle for the estimator/corrector feedback world.
// Each row is one macro pulse: the depth bar shows how many feedback iterations
// were needed to reach the fixed point, and the final converged value.

const fbStack = new Map(); // lt → { aDepth, bDepth, aValue, bValue, status }

const _renderFeedback = () => {
  if (!worldC?.ps?.app || !worldD?.ps?.app) return;

  const getFB = (w) => {
    const e  = w.getNodeState("estimator");
    const lt = e?.cycleId || w.ps.app.logicalTime || 0;

    // Depth: read directly from the live node state on world.app.
    // W.export writes the full node object (including _depth) to world.app[name].
    // Telemetry only captures drain snapshots in sync mode — in real-time mode
    // (FB_STEP_MS > 0) the heartbeat drives steps without populating telemetry,
    // so we read _depth directly instead.
    return {
      lt,
      value:      e?.value      ?? 0,
      iterations: e?.iterations ?? 0,
      depth:      e?.iterations ?? 0,
      stable:     w.ps.app.isStable ?? false,
    };
  };

  const fa = getFB(worldC), fb = getFB(worldD);
  const currentLT = fa.lt;

  // Update each peer's data only into the fbStack entry for its own LT.
  // This prevents a peer still at LT N from contaminating LT N+1's entry
  // with stale values when the other peer has already advanced.
  const updateFB = (f, peerKey) => {
    if (f.lt === 0) return;
    if (!fbStack.has(f.lt)) fbStack.set(f.lt, {
      aDepth: 0, bDepth: 0, aValue: null, bValue: null,
      aIter: 0, bIter: 0, aStable: false, bStable: false, status: 'process',
    });
    const e = fbStack.get(f.lt);
    e[peerKey + 'Depth']  = Math.max(e[peerKey + 'Depth'],  f.depth);
    e[peerKey + 'Value']  = f.value;
    e[peerKey + 'Iter']   = Math.max(e[peerKey + 'Iter'],   f.iterations);
    e[peerKey + 'Stable'] = e[peerKey + 'Stable'] || f.stable;
  };
  updateFB(fa, 'a');
  updateFB(fb, 'b');

  // Status: only evaluate LTs where both peers have reported.
  for (const [lt, e] of fbStack) {
    if (e.aValue === null || e.bValue === null) continue; // one peer not yet reported
    const synced = Math.abs(e.aValue - e.bValue) < EPSILON;
    const bothStable = e.aStable && e.bStable;
    if (synced && bothStable)              e.status = 'success';
    else if (!synced && currentLT > lt + 1) e.status = 'fail';
    else                                   e.status = 'process';
  }

  const activeLTs = [...fbStack.keys()].sort((a, b) => b - a).slice(0, 4);

  let root = document.getElementById("fb-app");
  if (!root) {
    root = document.createElement("div");
    root.id = "fb-app";
    Object.assign(root.style, {
      fontFamily: "ui-monospace,monospace", padding: "20px",
      background: "#0d0d0d", color: "#eee", borderRadius: "10px",
      margin: "10px", maxWidth: "620px", border: "1px solid #222"
    });
    document.body.appendChild(root);
  }

  const MAX_DEPTH_DISPLAY = 16;

  const renderFBTrack = (lt, isActive) => {
    const e     = fbStack.get(lt);
    const colors = { success: '#238636', process: '#d29922', fail: '#f85149' };
    const col   = colors[e.status] || colors.process;
    const depth = Math.max(e.aDepth, e.bDepth);

    if (isActive) {
      // Depth bar: each cell is one feedback iteration
      const cells = Array.from({ length: MAX_DEPTH_DISPLAY }, (_, i) => {
        const filled = i < depth;
        return `<div style="flex:1; height:20px; background:${filled ? '#7c3aed' : '#161616'};
                            border:1px solid #282828; border-radius:2px;"></div>`;
      }).join('');

      return `
        <div style="margin-bottom:16px; padding:12px; border-left:4px solid ${col}; background:#111; border-radius:4px;">
          <div style="font-size:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <span style="color:#888">FEEDBACK LT ${lt}</span>
            <span style="background:${col}33; color:${col}; padding:2px 8px; border-radius:10px; font-weight:bold; border:1px solid ${col}66">
              ${e.status.toUpperCase()}
            </span>
          </div>
          <div style="font-size:9px; color:#555; margin-bottom:4px;">DEPTH (max ${MAX_DEPTH_DISPLAY} shown)</div>
          <div style="display:flex; gap:2px; margin-bottom:8px;">${cells}</div>
          <div style="display:flex; gap:16px; font-size:9px; color:#555;">
            <span>A value: <span style="color:#a78bfa">${e.aValue != null ? e.aValue.toFixed(4) : '—'}</span></span>
            <span>B value: <span style="color:#a78bfa">${e.bValue != null ? e.bValue.toFixed(4) : '—'}</span></span>
            <span>A iters: <span style="color:#666">${e.aIter}</span></span>
            <span>B iters: <span style="color:#666">${e.bIter}</span></span>
            <span>depth: <span style="color:#7c3aed">${depth}</span></span>
          </div>
        </div>`;
    }

    // Compact completed row
    const synced = e.aValue != null && e.bValue != null && Math.abs(e.aValue - e.bValue) < EPSILON;
    return `
      <div style="margin-bottom:8px; padding:8px 12px; border-left:4px solid ${col}44;
                  background:#0e0e0e; border-radius:4px; display:flex;
                  justify-content:space-between; align-items:center;">
        <span style="color:#555; font-size:10px;">LT ${lt}</span>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="color:#444; font-size:9px;">depth:${depth} · iters:${Math.max(e.aIter, e.bIter)}</span>
          <span style="color:${synced ? '#444' : '#f85149'}; font-size:9px;">${synced ? 'converged' : 'DIVERGED'}</span>
          <span style="background:${col}22; color:${col}; padding:1px 7px; border-radius:8px; font-size:9px; font-weight:bold; border:1px solid ${col}44">
            ${e.status.toUpperCase()}
          </span>
        </div>
      </div>`;
  };

  root.innerHTML = `
    <div style="font-size:13px; font-weight:bold; color:#666; margin-bottom:20px; letter-spacing:1px; text-align:center;">
      FEEDBACK LOOP CONVERGENCE TRACE
    </div>
    ${activeLTs.map((lt, i) => renderFBTrack(lt, i === 0)).join('')}
  `;
};

const _fbView = Behaviors.collect(null, _vt, () => { _renderFeedback(); return null; });

// ── 9. Bisection coordinate space canvas ─────────────────────────────────────
// A third panel drawn on a <canvas> element. Reads live from worldC (peer A)
// on every _uiRefresh call. Shows the full convergence trajectory in (n, value)
// space: each feedback iteration is one point on the curve, plotted as it
// arrives during the drain loop. The target integer is a dashed horizontal
// line; the current value is a moving dot on the curve.
//
// History: the last BISECT_HISTORY completed cycles are kept as faded traces
// so you can see how different LTs produce different starting points but the
// same convergence shape.

const _renderBisect = (() => {
  const BISECT_HISTORY = 5;
  const bisectTraces   = [];
  let   bisectCurrent  = null;
  let   canvas         = null;

  return () => {
    if (!worldC?.ps?.app || !worldD?.ps?.app) return;

    // Create canvas if needed
    if (!canvas) {
      let wrap = document.getElementById("bisect-wrap");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = "bisect-wrap";
        Object.assign(wrap.style, {
          fontFamily: "ui-monospace,monospace", padding: "20px",
          background: "#0d0d0d", color: "#eee", borderRadius: "10px",
          margin: "10px", maxWidth: "620px", border: "1px solid #222"
        });
        wrap.innerHTML =
          '<div style="font-size:13px;font-weight:bold;color:#666;margin-bottom:14px;letter-spacing:1px;text-align:center;">BISECTION COORDINATE SPACE — FEEDBACK LOOP</div>' +
          '<canvas id="bisect-canvas" width="580" height="260" style="width:100%;border-radius:4px;background:#0a0a0a;display:block;"></canvas>' +
          '<div style="display:flex;gap:16px;margin-top:8px;font-size:9px;color:#444;">' +
          '<span style="color:#7c3aed">▬ peer A</span>' +
          '<span style="color:#1d9e75">▬ peer B</span>' +
          '<span style="color:#555">╌ target</span>' +
          '</div>';
        document.body.appendChild(wrap);
      }
      canvas = document.getElementById("bisect-canvas");
    }

    const eA = worldC.getNodeState("estimator");
    const eB = worldD.getNodeState("estimator");
    if (!eA) return;

    const lt   = eA.cycleId || 0;
    const initial = eA.trace?.[0]?.v ?? eA.value ?? 50;
    const target  = Math.round(initial);

    const aCycleOk = eA.cycleId === lt && isFinite(eA.value);
    const bCycleOk = eB?.cycleId === lt && isFinite(eB?.value);
    const fa = { stable: worldC.ps.app.isStable ?? false };
    const fb = { stable: worldD.ps.app.isStable ?? false };

    // Update current trace
    if (!bisectCurrent || bisectCurrent.lt !== lt) {
      if (bisectCurrent?.ptsA?.length > 1) {
        bisectTraces.push({ ...bisectCurrent, done: true });
        if (bisectTraces.length > BISECT_HISTORY) bisectTraces.shift();
      }
      bisectCurrent = { lt, initial, target, ptsA: [], ptsB: [], done: false };
    }

    if (!bisectCurrent.done) {
      if (aCycleOk && eA.trace?.length) bisectCurrent.ptsA = eA.trace;
      if (bCycleOk && eB?.trace?.length) bisectCurrent.ptsB = eB.trace;
      if (fa.stable && fb.stable && bisectCurrent.ptsA.length > 1)
        bisectCurrent.done = true;
    }

    // Pick what to draw — current if it has points, else last history
    const drawPts = bisectCurrent.ptsA.length > 0 ? bisectCurrent :
                    (bisectTraces.length ? bisectTraces[bisectTraces.length - 1] : null);
    if (!drawPts || !drawPts.ptsA.length) return;

    // Draw
    const W = canvas.width, H = canvas.height;
    const PAD = { top: 20, right: 60, bottom: 34, left: 50 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top  - PAD.bottom;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // Y range from drawPts
    const allVals = [
      ...drawPts.ptsA.map(p => p.v),
      ...(drawPts.ptsB?.map(p => p.v) ?? []),
      drawPts.target,
    ].filter(isFinite);
    if (!allVals.length) return;
    const yRaw = Math.max(Math.abs(Math.max(...allVals) - Math.min(...allVals)), 0.1);
    const yPad = yRaw * 0.2;
    const yMin = Math.min(...allVals) - yPad;
    const yMax = Math.max(...allVals) + yPad;

    const maxN = Math.max(drawPts.ptsA[drawPts.ptsA.length - 1]?.n ?? 0,
                          drawPts.ptsB?.[drawPts.ptsB.length - 1]?.n ?? 0, 5);
    const toX = n => PAD.left + (n / maxN) * cw;
    const toY = v => PAD.top  + (1 - (v - yMin) / (yMax - yMin)) * ch;

    // Grid
    ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const v = yMin + (yMax - yMin) * (i / 5);
      const y = toY(v);
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
      ctx.fillStyle = "#444"; ctx.font = "9px ui-monospace"; ctx.textAlign = "right";
      ctx.fillText(v.toFixed(2), PAD.left - 4, y + 3);
    }
    const xSteps = Math.min(maxN, 8);
    for (let i = 0; i <= xSteps; i++) {
      const n = Math.round((i / xSteps) * maxN);
      const x = toX(n);
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, H - PAD.bottom); ctx.stroke();
      ctx.fillStyle = "#444"; ctx.font = "9px ui-monospace"; ctx.textAlign = "center";
      ctx.fillText(n, x, H - PAD.bottom + 12);
    }

    // Axis labels
    ctx.fillStyle = "#555"; ctx.font = "9px ui-monospace"; ctx.textAlign = "center";
    ctx.fillText("iteration", W / 2, H - 2);
    ctx.save(); ctx.translate(12, H / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("value", 0, 0); ctx.restore();

    // Target line
    const ty = toY(drawPts.target);
    ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, ty); ctx.lineTo(W - PAD.right, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#555"; ctx.font = "9px ui-monospace"; ctx.textAlign = "left";
    ctx.fillText("target " + drawPts.target, W - PAD.right + 4, ty + 3);

    // History traces (faded)
    bisectTraces.forEach((tr, ti) => {
      if (!tr.ptsA?.length) return;
      const alpha = 0.06 + (ti / Math.max(bisectTraces.length, 1)) * 0.12;
      const trMaxN = tr.ptsA[tr.ptsA.length - 1].n || maxN;
      const trX = n => PAD.left + (n / Math.max(trMaxN, maxN)) * cw;
      ctx.strokeStyle = "rgba(124,58,237," + alpha + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      tr.ptsA.forEach((p, i) => i === 0 ? ctx.moveTo(trX(p.n), toY(p.v)) : ctx.lineTo(trX(p.n), toY(p.v)));
      ctx.stroke();
    });

    // Peer A line (purple)
    if (drawPts.ptsA.length > 1) {
      ctx.strokeStyle = "#7c3aed"; ctx.lineWidth = 2;
      ctx.beginPath();
      drawPts.ptsA.forEach((p, i) => i === 0 ? ctx.moveTo(toX(p.n), toY(p.v)) : ctx.lineTo(toX(p.n), toY(p.v)));
      ctx.stroke();
    }

    // Peer B line (green)
    if (drawPts.ptsB?.length > 1) {
      ctx.strokeStyle = "#1d9e75"; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath();
      drawPts.ptsB.forEach((p, i) => i === 0 ? ctx.moveTo(toX(p.n), toY(p.v)) : ctx.lineTo(toX(p.n), toY(p.v)));
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Iteration dots — peer A
    ctx.fillStyle = "#7c3aed";
    drawPts.ptsA.forEach((p, i) => {
      const r = i === drawPts.ptsA.length - 1 ? 5 : 3;
      ctx.beginPath(); ctx.arc(toX(p.n), toY(p.v), r, 0, Math.PI * 2); ctx.fill();
    });

    // Iteration dots — peer B
    if (drawPts.ptsB?.length) {
      ctx.fillStyle = "#1d9e75";
      drawPts.ptsB.forEach((p, i) => {
        const r = i === drawPts.ptsB.length - 1 ? 5 : 3;
        ctx.beginPath(); ctx.arc(toX(p.n), toY(p.v), r, 0, Math.PI * 2); ctx.fill();
      });
    }

    // LT label
    ctx.fillStyle = "#333"; ctx.font = "bold 10px ui-monospace"; ctx.textAlign = "right";
    ctx.fillText("LT " + drawPts.lt, W - PAD.right, PAD.top - 6);
  };
})();

const _bisectView = Behaviors.collect(null, _vt, () => { _renderBisect(); return null; });

const _refreshFB = () => { _renderFeedback(); _renderBisect(); };
meta3.ps.app._uiRefresh = _refreshFB;
meta4.ps.app._uiRefresh = _refreshFB;



// ══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 5 — Deterministic RNG (XOROSHIRO128+)
// ══════════════════════════════════════════════════════════════════════════════
//
// Demonstrates W.rng — shared deterministic PRNG seeded by the reflector shim.
// Both peers call W.rng.next() in the same order → identical sequences.
// Used for: procedural generation, AI decisions, physics randomness, etc.
//
// World program calls W.rng per-step and records the sequence.
// View shows both peers' sequences side by side — they must be identical.

const RNG_STEPS        = 20;   // random values per cycle
const RNG_CYCLE_TICKS  = 80;   // ticks between cycles

const RNG_WORLD_PROGRAM = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const rngNode = Behaviors.collect(
    { values: [], cycleId: 0, started: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "rngNode", {
      __macro: (s, p, ctx) => {
        if (s.started) return s;
        ctx.future(0, "generate", { cycleId: 1, step: 0, values: [] });
        return { ...s, started: true };
      },
      generate: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId && p.cycleId > 1) return s;
        // Seed RNG from cycleId at the start of each cycle (step 0).
        // Both peers call this with the same cycleId → identical sequence.
        // This resets the shared W.rng state so peer A and peer B
        // both start drawing from the same position in the sequence.
        if (p.step === 0) W.rng.seed(p.cycleId);
        // Draw one random value from the now-deterministically-seeded RNG
        const v = W.rng.next();
        const values = [...(p.values || []), v];
        if (values.length < STEPS_VAL) {
          // Sub-tick chain — all STEPS_VAL values drawn within this tick
          ctx.future(0, "generate", { cycleId: p.cycleId, step: p.step + 1, values });
        } else {
          // Done — schedule next cycle
          ctx.future(CYCLE_VAL, "generate", { cycleId: p.cycleId + 1, step: 0, values: [] });
        }
        return { ...s, values, cycleId: p.cycleId };
      },
    })
  );

  const _isStable = W.stable([rngNode], reflector);
  const _export   = W.export(Renkon, { rngNode }, _isStable);
`
  .replace(/STEPS_VAL/g, String(RNG_STEPS))
  .replace(/CYCLE_VAL/g,  String(RNG_CYCLE_TICKS));

// ══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 4 — Zeno Series (decreasing sub-tick futures)
// ══════════════════════════════════════════════════════════════════════════════
//
// A recursively halving series of futures that all fire within one tick.
// future(0.5) -> future(0.25) -> future(0.125) -> ... -> sum converges to 1
// Each step is a sub-tick (delay < SUBTICK_MS=1). All drain in one pass.
// Steps: ~13 until delay < ZENO_MIN_DELAY=0.0001

const ZENO_INITIAL_DELAY = 0.5;    // first sub-tick: half a tick
const ZENO_MIN_DELAY     = 0.0001;  // stop when delay < this (floating point floor)
const ZENO_CYCLE_TICKS   = 60;     // new Zeno series every 60 ticks

const ZENO_WORLD_PROGRAM = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  // Zeno node uses W.localReflector to drive itself autonomously.
  // The local clock fires at sub-tick speed (delay=INITIAL_VAL, halving each step).
  // On outer reflector reconnect: warp replays authoritative state, discarding
  // any speculative local ticks that diverged from the outer timeline.
  const zeno = Behaviors.collect(
    { n: 0, sum: 0, localLt: 0, cycleId: 0, _localActive: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "zeno", {
      // W.localReflector mixin: activates local clock on first __macro
      ...W.localReflector("tick", INITIAL_VAL),

      // Local clock tick — drives the Zeno halving series
      tick: (s, p, ctx) => {
        const delay  = p._innerTickDelay ?? INITIAL_VAL;
        const newSum = s.sum + delay;
        const nextDelay = delay / 2;
        if (nextDelay > MIN_VAL) {
          // Reschedule with halved delay — stays sub-tick (< 1)
          ctx.localReflector("tick", nextDelay);
        } else {
          // Series converged — restart after CYCLE_VAL ticks
          ctx.future(CYCLE_VAL, "restart", {});
        }
        return { ...s, localLt: s.localLt + 1, n: s.n + 1, sum: newSum };
      },

      restart: (s, p, ctx) => {
        // Begin a new Zeno series
        ctx.localReflector("tick", INITIAL_VAL);
        return { ...s, n: 0, sum: 0, cycleId: s.cycleId + 1 };
      },
    })
  );

  const _isStable = W.stable([zeno], reflector);
  const _export   = W.export(Renkon, { zeno }, _isStable);
`
  .replace(/INITIAL_VAL/g, String(ZENO_INITIAL_DELAY))
  .replace(/MIN_VAL/g,     String(ZENO_MIN_DELAY))
  .replace(/CYCLE_VAL/g,   String(ZENO_CYCLE_TICKS));

// ══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 3 — 2D Wavefront Stress (10×10 = 101 independent W nodes)
// ══════════════════════════════════════════════════════════════════════════════
//
// Demonstrates the local-queue-of-futures architecture under stress:
//   • 1 coordinator node + 100 cell nodes = 101 independent W nodes
//   • Each cell owns its own local queue — no central routing after dispatch
//   • No coordinator — each cell subscribes to reflector directly
//   • Each cell's __macro independently computes the same deterministic origin
//     (pure function of logicalTime) and its own dist from its (cx,cy) to (ox,oy)
//   • Each cell schedules its own ctx.future(dist*80, "activate") — own queue
//   • 100 fully independent nodes, zero inter-node communication
//   • W.stable checks all 101 queues — world only stable when every cell
//     has completed its decay and returned to rest
//   • _worldNextAt scans all 101 _nextAt values to advance wallTime correctly
//
// The wavefront is genuinely distributed: after the coordinator dispatches,
// no node knows the global state. Stability emerges from 101 local queues
// all draining to empty — the architectural invariant under test.

const GRID_W        = 10;
const GRID_H        = 10;
const WAVE_STEP_MS    = 2;    // ticks per unit distance — wavefront travel speed
const WAVE_DECAY_MS   = 12;   // ticks a cell stays lit after activation
const WAVE_CYCLE_MS   = 80;   // ticks between wave cycles
// Wave uses the main REFLECTOR_MS shim — no separate shim needed

// Programmatically build the world string with 101 Behaviors.collect calls.
// Each cell is a named W node ("cell_0".."cell_99") with its own queue.
const STRESS_WORLD_PROGRAM = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  // clock: single coordinator node. __macro fires once (started guard),
  // schedules startWave immediately. startWave computes origin from wallTime,
  // broadcasts to all cells, then schedules the next wave via future.
  // The WAVE_CYCLE_VAL future sits in clock's queue across many 50ms ticks,
  // firing when wallTime advances far enough — no second shim needed.
  const clock = Behaviors.collect(
    { started: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "clock", {
      __macro: (s, p, ctx) => {
        if (s.started) return s;
        ctx.future(0, "startWave", { wt: p.wallTime });
        return { started: true };
      },
      startWave: (s, p, ctx) => {
        const ox = Math.round(HALF_VAL + HALF_VAL * Math.sin(p.wt * 0.07));
        const oy = Math.round(HALF_VAL + HALF_VAL * Math.sin(p.wt * 0.05));
        for (let i = 0; i < GW_VAL * GW_VAL; i++) {
          ctx.send("cell_" + i, "wave", { ox, oy, wt: p.wt });
        }
        ctx.future(CYCLE_VAL, "startWave", { wt: p.wt + CYCLE_VAL });
        return s;
      },
    })
  );

  // Each cell receives "wave" from clock, computes its own distance,
  // schedules its own activate future. All propagation timing is local.
  const _makeCell = (id) => {
    const cx = id % GW_VAL;
    const cy = Math.floor(id / GW_VAL);
    return (state, pulse) => W.reduce(state, pulse, "cell_" + id, {
      wave: (s, p, ctx) => {
        const dist  = Math.sqrt((cx - p.ox) * (cx - p.ox) + (cy - p.oy) * (cy - p.oy));
        const phase = dist * 0.8;
        ctx.future(Math.floor(dist * STEP_VAL), "activate", { dist, phase, wt: p.wt });
        return { ...s, wt: p.wt, amp: 0, active: false };
      },
      activate: (s, p, ctx) => {
        if (p.wt !== s.wt) return s;
        const amp = Math.cos(p.phase) * Math.exp(-p.dist * 0.15);
        ctx.future(DECAY_VAL, "decay", { wt: p.wt });
        return { ...s, amp, active: true };
      },
      decay: (s, p, ctx) => {
        if (p.wt !== s.wt) return s;
        return { ...s, amp: 0, active: false };
      },
    });
  };
`
  .replace(/GW_VAL/g,    String(GRID_W))
  .replace(/HALF_VAL/g,  String(Math.floor(GRID_W / 2 - 1)))
  .replace(/CYCLE_VAL/g, String(WAVE_CYCLE_MS))  // ticks
  .replace(/STEP_VAL/g,  String(WAVE_STEP_MS))   // ticks per unit dist
  .replace(/DECAY_VAL/g, String(WAVE_DECAY_MS));  // ticks
// ── Stress world wire
// _injectCellScript: called after makeWorld, before first pulse.
// Appends the generated cell declarations as a second script via updateProgram.
// updateProgram(array) is called with [script1, script2] — the array is what
// setupProgram expects. Called from host layer so no mid-evaluation conflict.
const _waveScript2 = (() => {
  const N = GRID_W * GRID_H;
  const cells = Array.from({ length: N }, (_, i) =>
    "const cell_" + i + " = Behaviors.collect({amp:0,active:false,wt:0}, reflector, _makeCell(" + i + "));"
  ).join(" ");
  const refs = Array.from({ length: N }, (_, i) => "cell_" + i).join(", ");
  return cells
    + " const _isStable = W.stable([clock, " + refs + "], reflector);"
    + " const _export = W.export(Renkon, { clock, " + refs + " }, _isStable);";
})();
const _injectCellScript = (worldPs) => {
  worldPs.updateProgram([worldPs.scripts[0], _waveScript2]);
};

// ── Stress world wire ────────────────────────────────────────────────────────
const meta5 = makeMeta("peer_A_wave");
const meta6 = makeMeta("peer_B_wave");

meta5.ps.app._worldNextAt   = _worldNextAt;
meta6.ps.app._worldNextAt   = _worldNextAt;

const worldE = makeWorld("worldE", STRESS_WORLD_PROGRAM);
const worldF = makeWorld("worldF", STRESS_WORLD_PROGRAM);
// Inject cell declarations before first pulse arrives
_injectCellScript(worldE.ps);
_injectCellScript(worldF.ps);

meta5.register(worldE);
meta6.register(worldF);

// Single reflector at WAVE_REFLECTOR_MS=50ms — pure Krestianstvo.
// The clock node schedules wave cycles via ctx.future(WAVE_CYCLE_MS) internally.
// No second shim, no Date.now(), no _waveTick.
// wave worlds use the main shim (added above)


// ── 10. Stress world view — 2D wave canvas ────────────────────────────────────

const _renderWave = (() => {
  // Pre-create all cell divs once — only update their CSS transform/background
  // on each render. This avoids innerHTML teardown and is much smoother.
  let cellsA = null;
  let cellsB = null;

  const CELL_PX = 24; // px per cell
  const GAP_PX  = 2;  // gap between cells

  const buildGrid = (containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const cells = {};
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const id  = y * GRID_W + x;
        const div = document.createElement("div");
        Object.assign(div.style, {
          position:        "absolute",
          left:            `${x * (CELL_PX + GAP_PX)}px`,
          top:             `${y * (CELL_PX + GAP_PX)}px`,
          width:           `${CELL_PX}px`,
          height:          `${CELL_PX}px`,
          borderRadius:    "3px",
          background:      "#121212",
          transition:      "background 60ms linear, transform 60ms ease-out",
          transform:       "scale(0.85)",
          willChange:      "background, transform",
        });
        container.appendChild(div);
        cells[id] = div;
      }
    }
    return cells;
  };

  const updateGrid = (cells, worldX) => {
    if (!cells) return;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const id   = y * GRID_W + x;
        const cell = worldX.getNodeState("cell_" + id);
        const div  = cells[id];
        if (!div || !cell) continue;

        const amp = cell.amp ?? 0;
        const abs = Math.abs(amp);

        const scale = cell.active ? (0.85 + abs * 0.55) : 0.85;
        div.style.transform = `scale(${scale.toFixed(3)})`;

        let bg;
        if (amp > 0.01) {
          const v = Math.floor(abs * 255);
          bg = `rgb(${Math.floor(v*0.12)},${Math.floor(v*0.72)},${Math.floor(v*0.62)})`;
        } else if (amp < -0.01) {
          const v = Math.floor(abs * 255);
          bg = `rgb(${Math.floor(v*0.55)},${Math.floor(v*0.15)},${Math.floor(v*0.8)})`;
        } else {
          bg = "#121212";
        }
        div.style.background = bg;
      }
    }
  };

  return () => {
    if (!worldE?.ps?.app) return;

    const gridPx = GRID_W * (CELL_PX + GAP_PX) - GAP_PX;

    // One-time panel creation
    if (!document.getElementById("wave-wrap")) {
      const wrap = document.createElement("div");
      wrap.id = "wave-wrap";
      Object.assign(wrap.style, {
        fontFamily: "ui-monospace,monospace", padding: "20px",
        background: "#0d0d0d", color: "#eee", borderRadius: "10px",
        margin: "10px", maxWidth: "620px", border: "1px solid #222",
      });
      wrap.innerHTML = `
        <div style="font-size:13px; font-weight:bold; color:#666; margin-bottom:14px; letter-spacing:1px; text-align:center;">
          2D WAVEFRONT STRESS — ${GRID_W}×${GRID_H} NODES
        </div>
        <div style="display:flex; gap:16px; justify-content:center;">
          <div>
            <div style="font-size:9px; color:#444; margin-bottom:6px; text-align:center; letter-spacing:1px;">PEER A</div>
            <div id="wave-grid-a" style="position:relative; width:${gridPx}px; height:${gridPx}px;"></div>
          </div>
          <div>
            <div style="font-size:9px; color:#444; margin-bottom:6px; text-align:center; letter-spacing:1px;">PEER B</div>
            <div id="wave-grid-b" style="position:relative; width:${gridPx}px; height:${gridPx}px;"></div>
          </div>
        </div>
        <div style="display:flex; gap:16px; margin-top:14px; font-size:9px; color:#444; justify-content:center;">
          <span>LT <span id="wave-lt" style="color:#555">—</span></span>
          <span>stable: <span id="wave-stable" style="color:#555">—</span></span>
          <span>active: <span id="wave-active" style="color:#555">—</span>/100</span>
        </div>`;
      document.body.appendChild(wrap);
      cellsA = buildGrid("wave-grid-a");
      cellsB = buildGrid("wave-grid-b");
    }

    updateGrid(cellsA, worldE);
    updateGrid(cellsB, worldF);

    // Status line
    const lt = worldE.getNodeState("clock")?.started ? (worldE.ps.app.logicalTime ?? 0) : 0;
    let activeCells   = 0;
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      if (worldE.getNodeState("cell_" + i)?.active) activeCells++;
    }
    const stable = worldE.ps.app.isStable ?? false;

    const ltEl = document.getElementById("wave-lt");
    const stEl = document.getElementById("wave-stable");
    const acEl = document.getElementById("wave-active");
    if (ltEl) ltEl.textContent = lt;
    if (stEl) { stEl.textContent = stable ? "yes" : "no"; stEl.style.color = stable ? "#238636" : "#d29922"; }
    if (acEl) acEl.textContent = activeCells;
  };
})();

const _waveView = Behaviors.collect(null, _vt, () => { _renderWave(); return null; });

// ── Zeno view ─────────────────────────────────────────────────────────────────
const _renderRng = () => {
  if (!worldI?.ps?.app || !worldJ?.ps?.app) return;
  const rA = worldI.getNodeState("rngNode");
  const rB = worldJ.getNodeState("rngNode");
  if (!rA?.values?.length) return;

  let el = document.getElementById("rng-view");
  if (!el) {
    el = document.createElement("div");
    el.id = "rng-view";
    Object.assign(el.style, {
      fontFamily: "ui-monospace,monospace", padding: "20px",
      background: "#0d0d0d", color: "#eee", borderRadius: "10px",
      margin: "10px", maxWidth: "620px", border: "1px solid #222"
    });
    document.body.appendChild(el);
  }

  const match = JSON.stringify(rA.values) === JSON.stringify(rB?.values);
  const statusCol = match ? "#238636" : "#f85149";
  const statusTxt = match ? "IDENTICAL ✓" : "DIVERGED ✗";

  const barRow = (v) => {
    const pct = (v * 100).toFixed(1);
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
      '<div style="width:220px;background:#161616;border-radius:2px;height:10px;overflow:hidden;">' +
      '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#7c3aed,#238636);"></div></div>' +
      '<span style="font-size:9px;color:#555;width:50px;">' + v.toFixed(5) + '</span></div>';
  };

  const valsA = (rA.values || []).slice(0, 10);
  const valsB = (rB?.values || []).slice(0, 10);

  el.innerHTML =
    '<div style="font-size:13px;font-weight:bold;color:#666;margin-bottom:14px;letter-spacing:1px;text-align:center;">DETERMINISTIC RNG — XOROSHIRO128+</div>' +
    '<div style="font-size:9px;color:#444;margin-bottom:10px;">Both peers draw from the same seed → identical sequences. Seed set by reflector shim.</div>' +
    '<div style="display:flex;gap:20px;">' +
      '<div style="flex:1"><div style="font-size:9px;color:#888;margin-bottom:6px;">PEER A — cycle ' + (rA.cycleId||0) + '</div>' +
      valsA.map(barRow).join('') + '</div>' +
      '<div style="flex:1"><div style="font-size:9px;color:#888;margin-bottom:6px;">PEER B — cycle ' + (rB?.cycleId||0) + '</div>' +
      valsB.map(barRow).join('') + '</div>' +
    '</div>' +
    '<div style="margin-top:10px;font-size:10px;font-weight:bold;color:' + statusCol + ';">' + statusTxt + '</div>';
};
const _rngView = Behaviors.collect(null, _vt, () => { _renderRng(); return null; });
meta9.ps.app._uiRefresh  = _renderRng;
meta10.ps.app._uiRefresh = _renderRng;

const _renderZeno = () => {
  if (!worldG?.ps?.app || !worldH?.ps?.app) return;
  const zA = worldG.getNodeState("zeno");
  const zB = worldH.getNodeState("zeno");
  if (!zA) return;
  let el = document.getElementById("zeno-view");
  if (!el) {
    el = document.createElement("div");
    el.id = "zeno-view";
    Object.assign(el.style, {
      fontFamily: "ui-monospace,monospace", padding: "20px",
      background: "#0d0d0d", color: "#eee", borderRadius: "10px",
      margin: "10px", maxWidth: "620px", border: "1px solid #222"
    });
    document.body.appendChild(el);
  }
  const bar = (label, n, sum) => {
    const pct = Math.min((sum || 0) * 100, 100).toFixed(4);
    return '<div style="margin-bottom:10px;">' +
      '<div style="font-size:10px;color:#888;margin-bottom:4px;">' + label +
      ' steps:<span style="color:#7c3aed"> ' + (n||0) + '</span>' +
      ' sum:<span style="color:#238636"> ' + (sum||0).toFixed(6) + '</span></div>' +
      '<div style="background:#161616;border-radius:2px;height:16px;overflow:hidden;">' +
      '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#7c3aed,#238636);border-radius:2px;"></div>' +
      '</div><div style="font-size:9px;color:#444;margin-top:2px;">' + pct + '% of tick — converges to 1.0 (never reached)</div></div>';
  };
  el.innerHTML =
    '<div style="font-size:13px;font-weight:bold;color:#666;margin-bottom:16px;letter-spacing:1px;text-align:center;">ZENO SERIES — SUB-TICK FUTURES</div>' +
    '<div style="font-size:9px;color:#444;margin-bottom:12px;">future(0.5) → future(0.25) → future(0.125) → ... all within one tick</div>' +
    bar("PEER A", zA.n, zA.sum) + bar("PEER B", zB?.n, zB?.sum);
};
const _zenoView = Behaviors.collect(null, _vt, () => { _renderZeno(); return null; });
meta7.ps.app._uiRefresh = _renderZeno;
meta8.ps.app._uiRefresh = _renderZeno;
meta5.ps.app._uiRefresh = _renderWave;
meta6.ps.app._uiRefresh = _renderWave;
const _view = Behaviors.collect(null, _vt, () => { _renderView(); return null; });
