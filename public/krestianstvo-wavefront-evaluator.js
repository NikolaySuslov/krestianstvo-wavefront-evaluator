/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
(https://github.com/NikolaySuslov/krestianstvo-wavefront-evaluator/blob/master/LICENSE.md)
*/
// ═══════════════════════════════════════════════════════════════════════════
// Krestianstvo Wavefront Evaluator — Core
//
// Deterministic reactive execution engine for multiplayer distributed apps.
// Built on Renkon (reactive programs) + Krestianstvo - Renkon VM | Croquet synchronisation model.
//
// Exports: W, makeRng, makeMeta, makeWorld, makeView, makeShim, makePeer,
//          _worldNextAt, _worldSnapshot, META_PROGRAM, _VIEW_PROGRAM
// ═══════════════════════════════════════════════════════════════════════════

import { ProgramState } from "./renkon-core-0.10.7.js";
export { ProgramState };

// ── Priority queue (_Q) ───────────────────────────────────────────────────────
const _Q = (() => {
  const enqueue = (q, e) => [...q, e].sort((a, b) => a.fireAt - b.fireAt);
  const split   = (q, now) => ({
    ready: q.filter(e => e.fireAt <= now),
    later: q.filter(e => e.fireAt >  now),
  });
  const nextAt  = (q) => q.length > 0 ? q[0].fireAt : Infinity;
  return Object.freeze({ enqueue, split, nextAt });
})();

// ── XOROSHIRO128+ PRNG ────────────────────────────────────────────────────────
export const makeRng = (s0, s1, s2, s3) => {
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

// ── Node runtime (W) ─────────────────────────────────────────────────────────
export const W = (() => {
  const reduce = (state, pulse, nodeId, handlers) => {
    if (!pulse) return state;
    if (pulse._restoreState?.[nodeId] !== undefined) return pulse._restoreState[nodeId];
    const { wallTime, logicalTime, isSubTick } = pulse;
    const appRef = pulse._appRef;

    const inbound = (appRef?._outbox?.[nodeId] ?? [])
      .filter(m => (m._evalGen ?? 0) < (appRef?._currentEvalGen ?? 0))
      .map(m => ({
        fireAt: wallTime, msg: m.msg, payload: m.payload,
        _depth: (m._depth ?? 0),
      }));
    if (appRef?._outbox?.[nodeId]) {
      appRef._outbox[nodeId] = appRef._outbox[nodeId]
        .filter(m => (m._evalGen ?? 0) >= (appRef?._currentEvalGen ?? 0));
      if (appRef._outbox[nodeId].length === 0) delete appRef._outbox[nodeId];
    }

    const { ready: ownReady, later } = _Q.split(state._queue ?? [], wallTime);
    const allReady = [...inbound, ...ownReady];

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
        depth: entryDepth,
        future: (delayMs, msg, payload) =>
          effects.push({ kind: "future", fireAt: wallTime + delayMs, msg, payload,
            _depth: delayMs > 0 ? 0 : entryDepth }),
        send: (targetId, msg, payload) =>
          effects.push({ kind: "send", targetId, msg, payload, _depth: entryDepth }),
        feedback: (msg, payload, maxDepth = 32) => {
          if (entryDepth < maxDepth) {
            const fbDelay = pulse._fbStepMs ?? 0;
            effects.push({ kind: "future", fireAt: wallTime + fbDelay, msg, payload, _depth: entryDepth + 1 });
          }
        },
        futureInf: (msg, payload) =>
          effects.push({ kind: "future", fireAt: wallTime, msg, payload, _depth: entryDepth }),
        localReflector: (tickMsg, innerTickDelay = 0, extraPayload = {}) =>
          effects.push({ kind: "future", fireAt: wallTime + innerTickDelay,
                         msg: tickMsg, payload: { ...extraPayload, _isLocalTick: true, _innerTickDelay: innerTickDelay },
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
      _lt:     isSubTick ? (state._lt ?? -1) : logicalTime,
    };
  };

  const stable = (nodes, pulse) => {
    const wall    = pulse?.wallTime ?? 0;
    const appRef  = pulse?._appRef;
    const outboxEmpty = !appRef || Object.keys(appRef._outbox ?? {}).length === 0;
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
    if (ws._viewPs) {
      ws._viewPs.registerEvent("worldUpdate", { logicalTime: ws.logicalTime, isStable });
    }
    return null;
  };

  const getState = (n) => {
    if (!n) return null;
    const { _queue, _nextAt, _depth, _lt, ...user } = n;
    return user;
  };

  const localReflectorMixin = (tickMsg, innerTickDelay = 0) => ({
    __macro: (s, p, ctx) => {
      if (s._localActive) return s;
      ctx.localReflector(tickMsg, innerTickDelay);
      return { ...s, _localActive: true, localLt: 0 };
    },
  });

  const rng = makeRng(0x12345678, 0x9abcdef0, 0xdeadbeef, 0xcafebabe);
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
export const _worldNextAt = (world) => {
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

export const _worldSnapshot = (world, source, iter) => {
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

// ── Meta program ──────────────────────────────────────────────────────────────
export const META_PROGRAM = `
  const reflectorPulse = Events.receiver({queued: true});

  const dispatch = (() => {
    if (!reflectorPulse?.length) return null;

    const reg       = Renkon.app.registry;
    const SUBTICK_MS = Renkon.app._subtickMs ?? 1;
    for (const pulse of reflectorPulse) {
      for (const [id, worldps] of reg) {
        const world  = worldps.app;

        const _tgt  = pulse._targetWorld;
        const _tgts = pulse._targetWorlds;
        const isTargeted = _tgt != null || _tgts != null;
        if (isTargeted && _tgt !== id && !(_tgts?.includes(id))) continue;

        const lastLT      = world.logicalTime   || 0;
        const lastPulseId = world._lastPulseId || 0;
        const isNewPulse = (pulse._pulseId > lastPulseId) ||
                           (pulse.logicalTime > lastLT);

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
        }

        if (isNewPulse || lastLT === 0) {
          world._currentEvalGen = (world._currentEvalGen ?? 0) + 1;
          const p = { ...pulse, _appRef: world, _fbStepMs: Renkon.app._fbStepMs ?? 0 };
          world._lastPulse = p;
          world.logicalTime  = p.logicalTime;
          world._lastPulseId = p._pulseId || 0;
          worldps.registerEvent("reflector", p);
          worldps.evaluate();

          world._telemetry ??= {};
          world._telemetry[p.logicalTime] = [
            Renkon.app._worldSnapshot?.(world, "macro", 0)
          ];
          const _tKeys = Object.keys(world._telemetry).map(Number).sort((a, b) => a - b);
          if (_tKeys.length > 5) delete world._telemetry[_tKeys[0]];

          let iters = 0;
          while (!world.isStable && iters < 10000) {
            const _wn = Renkon.app._worldNextAt(world);
            if (_wn === null) break;
            if (_wn >= p.wallTime + SUBTICK_MS) break;
            iters++;
            world._currentEvalGen++;
            worldps.registerEvent("reflector", { ...p, wallTime: _wn ?? p.wallTime, isSubTick: true });
            worldps.evaluate();
            world._telemetry[p.logicalTime].push(
              Renkon.app._worldSnapshot?.(world, "drain", iters)
            );
          }
          world._lastDrainIters = iters;
          if (world._outbox && Object.keys(world._outbox).length > 0) {
            world._currentEvalGen++;
            worldps.registerEvent("reflector", { ...p, isSubTick: true });
            worldps.evaluate();
          }
        }
      }

      const _ptag = pulse._isEvent ? "⚡EVENT" : "♥HB";
      pulse._isEvent ? console.log(
        "[META " + Renkon.app.id + "] " + _ptag +
        " dispatched | lt=" + pulse.logicalTime +
        " | pulseId=#" + (pulse._pulseId || "?") +
        " | worlds=" + [...reg.keys()].join(",") +
        (pulse._eventPayload ? " | payload=" + JSON.stringify(pulse._eventPayload) : "")
      ): {};
    }

    return null;
  })();
`;

// ── Factories ─────────────────────────────────────────────────────────────────

// reflectorMs: the real-time interval used by startAutonomous (ms per tick).
// Pass the same value you pass to makeShim.
export const makeMeta = (peerId, rngSeed = null, reflectorMs = 50) => {
  if (rngSeed) W.rng.restore(rngSeed);

  const ps = new ProgramState(0, {
    id: peerId, registry: new Map(),
    logicalTime: 0, isStable: false, lastDispatch: null,
  });
  ps.setupProgram([META_PROGRAM]);
  ps.evaluator(0);

  const register = (world) => {
    world.app.meta = ps;
    ps.app.registry.set(world.id, world.ps);
  };

  let _localLt     = 0;
  let _autoInterval = null;

  const injectPulse = (pulse) => {
    _localLt = pulse.logicalTime;
    if (_autoInterval) stopAutonomous();
    pulse._isEvent ? console.log(
      "[META " + peerId + "] injectPulse" +
      " | lt=" + pulse.logicalTime +
      " | pulseId=#" + (pulse._pulseId || "?") +
      " | " + (pulse._isEvent
        ? "⚡EVENT payload=" + JSON.stringify(pulse._eventPayload)
        : "♥HB")
    ) : {};
    ps.registerEvent("reflectorPulse", pulse);
    ps.evaluate();
  };

  const startAutonomous = () => {
    if (_autoInterval) return;
    _autoInterval = setInterval(() => {
      _localLt++;
      const pulse = Object.freeze({
        logicalTime: _localLt,
        wallTime:    _localLt,
        wallMs:      _localLt * reflectorMs,
        _isLocal:    true,
      });
      ps.registerEvent("reflectorPulse", pulse);
      ps.evaluate();
    }, reflectorMs);
  };

  const stopAutonomous = () => {
    if (_autoInterval) { clearInterval(_autoInterval); _autoInterval = null; }
  };

  const getLocalLt = () => _localLt;

  const takeSnapshot = () => {
    const _safeClone = (v) =>
      JSON.parse(JSON.stringify(v, (k, val) => k === '_appRef' ? undefined : val));
    const snap = { time: _localLt, worlds: {} };
    console.group('%c[SNAP TAKE] peer=' + peerId + ' t=' + _localLt, 'color:#f90;font-weight:bold');
    for (const [worldId, worldPS] of ps.app.registry) {
      const app = worldPS.app;
      const nodes = {};
      for (const [k, v] of Object.entries(app)) {
        if (v !== null && typeof v === 'object' && Array.isArray(v._queue)) {
          nodes[k] = _safeClone(v);
        }
      }
      snap.worlds[worldId] = {
        ...nodes,
        _logicalTime:  app.logicalTime  || 0,
        _lastPulseId:  app._lastPulseId || 0,
        _lastPulse:    app._lastPulse ? _safeClone(app._lastPulse) : null,
      };
      const nodeNames = Object.keys(nodes);
      console.log('  world=' + worldId + ' lt=' + (app.logicalTime || 0) + ' nodes=[' + nodeNames.join(',') + ']');
      for (const [k, v] of Object.entries(nodes)) {
        const { _queue, _nextAt, _lt, _depth, ...user } = v;
        console.log('    ' + k + ': ' + JSON.stringify(user) + '  queue=' + _queue.length + (_nextAt < Infinity ? ' nextAt=' + _nextAt : ''));
      }
    }
    console.groupEnd();
    return snap;
  };

  const applySnapshot = (snap) => {
    if (!snap || !snap.worlds) {
      console.warn('[SNAP APPLY] peer=' + peerId + ' — no snapshot payload, skipping');
      return;
    }
    const snapTime = snap.time || 0;
    _localLt = snapTime;
    console.group('%c[SNAP APPLY] peer=' + peerId + ' t=' + snapTime, 'color:#58a6ff;font-weight:bold');
    for (const [worldId, worldPS] of ps.app.registry) {
      const saved = snap.worlds[worldId];
      if (!saved) {
        console.warn('  world=' + worldId + ' — not in snapshot (snap has: ' + Object.keys(snap.worlds).join(',') + ')');
        continue;
      }
      const app = worldPS.app;
      const restoreState = {};
      for (const [k, v] of Object.entries(saved)) {
        if (k.startsWith('_')) continue;
        restoreState[k] = v;
        app[k] = v;
      }
      const prevLt = app.logicalTime || 0;
      app.logicalTime      = saved._logicalTime || snapTime;
      app._lastPulseId     = saved._lastPulseId || 0;
      app.isStable         = true;
      app._snapshotApplied = true;
      if (saved._lastPulse) app._lastPulse = saved._lastPulse;
      const restorePulse = {
        logicalTime:   app.logicalTime,
        wallTime:      app.logicalTime,
        _pulseId:      app._lastPulseId,
        _restoreState: restoreState,
        _appRef:       app,
        isSubTick:     false,
      };
      app._currentEvalGen = (app._currentEvalGen ?? 0) + 1;
      worldPS.registerEvent('reflector', restorePulse);
      worldPS.evaluate();
      app.isStable = true;
      const nodeNames = Object.keys(restoreState);
      console.log('  world=' + worldId
        + ' lt: ' + prevLt + ' → ' + app.logicalTime
        + '  nodes=[' + nodeNames.join(',') + ']');
    }
    console.groupEnd();
    const summary = [...ps.app.registry.keys()].map(wid => {
      const a = ps.app.registry.get(wid).app;
      return wid + '@lt=' + a.logicalTime + '/_lastPulseId=' + (a._lastPulseId || 0);
    }).join('  ');
    console.log('%c[SNAP APPLY DONE] peer=' + peerId + '  ' + summary, 'color:#58a6ff;font-weight:bold');
  };

  const getSeloRoster = () => ps.app.seloRoster ?? null;

  // Reset logical time on all registered worlds so the next reflector pulse
  // (whatever lt it carries) always passes isNewPulse. Call this when joining
  // a fresh selo where no snapshot will arrive (sole member).
  const resetLt = () => {
    _localLt = 0;
    for (const [, worldPS] of ps.app.registry) {
      worldPS.app.logicalTime  = 0;
      worldPS.app._lastPulseId = 0;
    }
  };

  return { ps, id: peerId, register, injectPulse, startAutonomous, stopAutonomous, getLocalLt, resetLt, takeSnapshot, applySnapshot, getSeloRoster };
};

export const makeWorld = (worldId, programScripts) => {
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
  const getNodeState = (name) => W.getState(ps.app[name]);
  const getQueue     = (name) => ps.app[name]?._queue ?? [];
  return { ps, app: ps.app, id: worldId, getNodeState, getQueue };
};

export const makeView = (viewId, viewProgram, appData = {}) => {
  const ps = new ProgramState(0, { id: viewId, ...appData });
  const scripts = Array.isArray(viewProgram) ? viewProgram : [viewProgram];
  ps.setupProgram(scripts);
  ps.evaluator(0);
  return { ps, id: viewId };
};

export const _VIEW_PROGRAM = `
  const worldUpdate = Events.receiver();
  const _render = Behaviors.collect(null, worldUpdate, () => {
    Renkon.app.renderFn();
    return null;
  });
`;

// ── Reflector shim ────────────────────────────────────────────────────────────
export const makeShim = (intervalMs = 1000, jitter = null) => {
  let startTime         = null;
  let lastHeartbeatTick = -1;
  let pulseCount        = 0;
  let _running          = false;
  let _timer            = null;

  const peers   = [];
  const pending = [];
  const addPeer = (m) => { peers.push(m); pending.push([]); };

  const getCurrentTick = () => {
    if (!startTime) return 0;
    return Math.floor((Date.now() - startTime) / intervalMs);
  };

  const broadcastPulse = (tick, isHeartbeat, payload = null,
                           targetWorldId = null, targetNodeId = null, targetWorldIds = null) => {
    pulseCount++;
    const pulse = Object.freeze({
      logicalTime:   tick,
      wallTime:      tick,
      wallMs:        tick * intervalMs,
      _pulseId:      pulseCount,
      _isHeartbeat:  isHeartbeat,
      _isEvent:      !isHeartbeat,
      _eventPayload: payload,
      _targetWorld:  targetWorldId,
      _targetNode:   targetNodeId,
      _targetWorlds: targetWorldIds,
    });

    (isHeartbeat == false) ? console.log(
      "[REFLECTOR] ⚡ EVENT    " +
      " | lt=" + tick +
      " | wallMs=" + pulse.wallMs +
      " | pulseId=#" + pulseCount +
      (payload ? " | payload=" + JSON.stringify(payload) : "")
    ) : {};

    for (let i = 0; i < peers.length; i++) {
      const lag       = (jitter?.peer === i) ? (jitter.lag      ?? 0) : 0;
      const dropEvery = (jitter?.peer === i) ? (jitter.dropEvery ?? 0) : 0;
      if (dropEvery > 0 && tick % dropEvery === 0) {
        console.log("[REFLECTOR]   DROP peer=" + i + " lt=" + tick);
        continue;
      }
      if (lag > 0) {
        pending[i].push({ deliverAt: tick + lag, pulse });
      } else {
        peers[i].injectPulse(pulse);
      }
    }
  };

  const _deliverPending = (currentTick) => {
    for (let i = 0; i < peers.length; i++) {
      while (pending[i].length > 0 && pending[i][0].deliverAt <= currentTick) {
        peers[i].injectPulse(pending[i].shift().pulse);
      }
    }
  };

  const injectExternalEvent = (payload, targetWorldId = null, targetNodeId = null, targetWorldIds = null) => {
    if (!_running) return;
    const tick = getCurrentTick();
    lastHeartbeatTick = tick;
    broadcastPulse(tick, false, payload, targetWorldId, targetNodeId, targetWorldIds);
  };

  const start = () => {
    if (_running) return;
    _running = true;
    if (!startTime) startTime = Date.now();
    lastHeartbeatTick = -1;
    pulseCount = 0;
    console.log("[REFLECTOR] started | intervalMs=" + intervalMs);
    _timer = setInterval(() => {
      const tick = getCurrentTick();
      _deliverPending(tick);
      if (tick > lastHeartbeatTick) {
        lastHeartbeatTick = tick;
        broadcastPulse(tick, true);
      }
    }, 10);
  };

  const stop = () => {
    _running = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    console.log("[REFLECTOR] stopped | lastTick=" + getCurrentTick() + " | totalPulses=" + pulseCount);
  };

  const setLt = (n) => {
    startTime = Date.now() - (n * intervalMs);
    console.log("[REFLECTOR] setLt(" + n + ") — epoch adjusted");
  };

  return { addPeer, start, stop, isRunning: () => _running, setLt, injectExternalEvent };
};

// ── WebSocket peer ────────────────────────────────────────────────────────────
const PEER_PROGRAM = `
  const wsMessages = Events.next(Renkon.app.wsStream);
  const wsMsg = Behaviors.collect(null, wsMessages, function(_, res) {
    return (res && !res.done) ? res.value : null;
  });

  const _outgoing = Events.receiver({ queued: true });

  const _dispatch = Behaviors.collect(null, wsMsg, (s, msg) => {
    const app = Renkon.app;
    if (!msg || !app.meta) return s;
    if (msg.type === 'pulse') {
      app.meta.injectPulse(msg);
    } else if (msg.type === 'selo_joined') {
      const r = app.meta.ps.app;
      r.seloRoster = { myId: msg.clientId, clients: new Map([[msg.clientId, { joinedAt: Date.now() }]]), count: msg.clientsInSelo };
      console.log('%c[PEER] joined selo:' + msg.seloId + ' as ' + msg.clientId + ' (' + msg.clientsInSelo + ' total)', 'color:#58a6ff');
      if (msg.clientsInSelo === 1) {
        // Sole member — no snapshot coming. Reset lt so reflector pulses pass isNewPulse.
        app.meta.resetLt();
      }
    } else if (msg.type === 'connect') {
      const r = app.meta.ps.app;
      if (r.seloRoster) {
        const clients = new Map(r.seloRoster.clients);
        clients.set(msg.from, { joinedAt: Date.now() });
        r.seloRoster = { ...r.seloRoster, clients, count: r.seloRoster.count + 1 };
        console.log('[PEER] client joined: ' + msg.from + ' (' + r.seloRoster.count + ' total)');
      }
    } else if (msg.type === 'disconnect') {
      const r = app.meta.ps.app;
      if (r.seloRoster) {
        const clients = new Map(r.seloRoster.clients);
        clients.delete(msg.from);
        r.seloRoster = { ...r.seloRoster, clients, count: Math.max(1, r.seloRoster.count - 1) };
        console.log('[PEER] client left: ' + msg.from + ' (' + r.seloRoster.count + ' total)');
      }
    } else if (msg.type === 'request_snapshot') {
      console.log('%c[PEER] request_snapshot for ' + msg.targetUser, 'color:#f90;font-weight:bold');
      const snap = app.meta.takeSnapshot();
      if (app.ws && app.ws.readyState === 1) {
        app.ws.send(JSON.stringify({ type: 'snapshot_response', targetUser: msg.targetUser, payload: snap }));
        console.log('[PEER] snapshot_response sent → ' + msg.targetUser + ' t=' + snap.time);
      }
    } else if (msg.type === 'snapshot_apply') {
      console.log('%c[PEER] snapshot_apply received seloId=' + msg.seloId + ' t=' + (msg.snapshot && msg.snapshot.time), 'color:#58a6ff;font-weight:bold');
      app.meta.applySnapshot(msg.snapshot);
    }
    return s;
  });

  const _evSend = Behaviors.collect(null, _outgoing, (s, evs) => {
    const app = Renkon.app;
    if (!app.ws || app.ws.readyState !== 1) return s;
    for (const ev of evs) {
      if (!ev) continue;
      app.ws.send(JSON.stringify({
        type: 'client_event',
        payload: ev.payload,
        targetWorldId: ev.targetWorldId ?? null,
        targetNodeId: ev.targetNodeId ?? null,
        targetWorldIds: ev.targetWorldIds ?? null,
      }));
    }
    return s;
  });
`;

export const makePeer = (meta, wsUrl, seloId = 'default') => {
  const messageQueue     = [];
  const messageResolvers = [];

  const wsStream = (async function* () {
    while (true) {
      const msg = await new Promise((resolve) => {
        if (messageQueue.length > 0) resolve(messageQueue.shift());
        else messageResolvers.push(resolve);
      });
      yield msg;
    }
  })();

  const appData = { meta, ws: null, wsStream };
  const ps = new ProgramState(0, appData);
  ps.setupProgram([PEER_PROGRAM]);
  ps.evaluator(0);

  const ws = new WebSocket(wsUrl);
  appData.ws = ws;

  ws.addEventListener('open', () => {
    console.log('%c[PEER:' + seloId + '] WS open → joining selo', 'color:#58a6ff');
    ws.send(JSON.stringify({ type: 'join_selo', seloId }));
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'pulse') {
      if (msg._isEvent) console.log('[PEER:' + seloId + '] ⚡pulse lt=' + msg.logicalTime + ' pulseId=#' + msg._pulseId);
    } else if (msg.type === 'snapshot_apply') {
      console.log('%c[PEER:' + seloId + '] snapshot_apply t=' + (msg.snapshot?.time ?? '?'), 'color:#f90;font-weight:bold');
    } else if (msg.type !== 'selo_joined') {
      console.log('[PEER:' + seloId + '] msg=' + msg.type);
    }
    if (messageResolvers.length > 0) messageResolvers.shift()(msg);
    else messageQueue.push(msg);
    ps.evaluate();
  });
  ws.addEventListener('close', () => {
    console.log('%c[PEER:' + seloId + '] WS closed', 'color:#f85149');
    appData.ws = null;
  });
  ws.addEventListener('error', (e) => { console.error('[PEER] WS error', e); });

  const disconnect = () => {
    if (appData.ws) {
      appData.ws.send(JSON.stringify({ type: 'goodbye' }));
      appData.ws.close();
      appData.ws = null;
    }
    ps.stop();
  };

  const injectExternalEvent = (payload, targetWorldId = null, targetNodeId = null, targetWorldIds = null) => {
    ps.registerEvent('_outgoing', { payload, targetWorldId, targetNodeId, targetWorldIds });
    ps.evaluate();
  };

  return { ps, disconnect, injectExternalEvent, seloId };
};

