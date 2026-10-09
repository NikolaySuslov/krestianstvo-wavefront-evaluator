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
// Exports: W, makeRng, makeMeta, makeWorld, makeView, makeShim, makePeer, makeTauKernel (kwe-tau.js),
//          makeHutchinson/makeRadialIFS/seedRing (ifs-core.js — the BANACH set-attractor face of IFS,
//          the causal-cascade face being makeIfsClock below),
//          _worldNextAt, _worldSnapshot, META_PROGRAM, _VIEW_PROGRAM,
//          makeIfsClock
// ═══════════════════════════════════════════════════════════════════════════

import { ProgramState } from "./renkon-core-0.10.7.js";
export { ProgramState };

// ── Compact typed-array snapshot codec (_TA) ─────────────────────────────────
// Large typed arrays (e.g. a G×G ψ field = 16K+ floats per slot) serialized as {__f64:[...]} — a plain JS number
// array — are ~10× the bytes and far slower to JSON.stringify/parse than raw buffer bytes. This codec ships them
// as base64 of the underlying buffer instead, keeping snapshots small and the leader's synchronous takeSnapshot
// cheap (the join-time frame hitch). f64 is PRESERVED (8 bytes/elem) so bit-exact CPU determinism survives the
// round-trip (an f32 codec would truncate → a joiner's restored field ≠ the leader's → a CPU-mode fork). The
// {__f64:[...]} form is still accepted on decode (legacy snapshots + non-Float64 typed arrays fall back to it).
const _TA = (() => {
  const _MIN = 256;   // only compact arrays big enough to matter (small ones: {__f64:[...]} is fine, avoids base64 overhead)
  const enc = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const dec = (b64) => { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  // encode a typed array to a compact snapshot value; returns null if it should fall through to the default handler
  const encode = (val) => {
    if (val instanceof Float64Array) { if (val.length < _MIN) return { __f64: Array.from(val) }; return { __b64: enc(new Uint8Array(val.buffer, val.byteOffset, val.byteLength)), __ta: "f64" }; }
    if (val instanceof Float32Array) { if (val.length < _MIN) return { __f32: Array.from(val) }; return { __b64: enc(new Uint8Array(val.buffer, val.byteOffset, val.byteLength)), __ta: "f32" }; }
    return null;   // other typed arrays → caller's default ({__f64:...})
  };
  // encode a large PLAIN JS array of finite numbers as compact base64-f64 (many apps hold fields as new Array(N),
  // not typed arrays — e.g. ahc's descBase.re/.im). JS numbers ARE f64, so this is lossless; decodes back to a
  // Float64Array (a numeric field is used index-wise either way). Returns null unless it is a big all-finite-number
  // array (mixed/short arrays stay as normal JSON arrays — safe, and avoids the O(N) scan when it can't help).
  const encodePlain = (arr) => {
    if (!Array.isArray(arr) || arr.length < _MIN) return null;
    for (let i = 0; i < arr.length; i++) { const x = arr[i]; if (typeof x !== "number" || !Number.isFinite(x)) return null; }
    const f = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) f[i] = arr[i];
    return { __b64: enc(new Uint8Array(f.buffer)), __ta: "f64", __wasPlain: 1 };   // __wasPlain: decode to a plain Array (preserve the app's type)
  };
  // decode a compact value back to a typed array (or plain Array if it was encoded from one); returns undefined if
  // val is not a compact form.
  const decode = (val) => {
    if (!val || typeof val !== "object") return undefined;
    if (Array.isArray(val.__f64)) return new Float64Array(val.__f64);
    if (Array.isArray(val.__f32)) return new Float32Array(val.__f32);
    if (typeof val.__b64 === "string") { const u8 = dec(val.__b64); const ta = val.__ta === "f32" ? new Float32Array(u8.buffer) : new Float64Array(u8.buffer);
      return val.__wasPlain ? Array.from(ta) : ta; }   // __wasPlain → the app stored a plain Array; give it back as one
    return undefined;
  };
  return Object.freeze({ encode, encodePlain, decode });
})();

// ── Priority queue (_Q) ───────────────────────────────────────────────────────
const _Q = (() => {
  // Entries are due either on COORDINATE time (fireAt ≤ wallTime — ctx.future) or on PROPER time (fireAtTau ≤ the
  // node's __clock reading — ctx.futureTau). τ entries carry NO fireAt (never Infinity: JSON.stringify(Infinity)
  // → null would silently corrupt the join snapshot); absence sorts last, never coordinate-ready, never blocks
  // stability (a τ future waiting on a stable world can never fire — honestly parked).
  const enqueue = (q, e) => [...q, e].sort((a, b) => ((a.fireAt ?? Infinity) - (b.fireAt ?? Infinity)));
  const split   = (q, now) => ({
    ready: q.filter(e => e.fireAt !== undefined && e.fireAt <= now),
    later: q.filter(e => e.fireAt === undefined || e.fireAt >  now),
  });
  const nextAt  = (q) => { for (const e of q) { if (e.fireAt !== undefined) return e.fireAt; } return Infinity; };
  return Object.freeze({ enqueue, split, nextAt });
})();

// ── XOROSHIRO128+ PRNG ────────────────────────────────────────────────────────
// The proper-time kernel (per-worldline clocks + deterministic τ dispatch — the medium's τ arc, crystallized).
// Also reachable by app factories as globalThis.KWETau. See public/kwe-tau.js for the determinism laws L1–L6.
export { makeTauKernel } from './kwe-tau.js';
export { makeHutchinson, makeRadialIFS, seedRing, makeContractionNode, makeStreamingContractionNode } from './ifs-core.js';   // the Banach set-attractor IFS kernel + the certified-contraction node classes (futureContract gate; streaming = beat stream + certified endpoint)
export { makeDescriptorHost, descriptorMeasure, measureHash } from './ifs-selfhost.js';   // Idea 3: the living cascade ⇄ Hutchinson-W generator reconciled live (self-host descriptor)
export { makeFresnelCascade, makeFresnelOperator, FRESNEL_MAPS, FRESNEL_DEFAULTS } from './fresnel-cascade.js';   // medium-u1's Fresnel cascade as a PURE fn of the cycle index — a medium operator (ring/λ per cycle) and a matter clock (beats per cycle) from one replicated integer

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

    const { ready: ownReady, later: laterAll } = _Q.split(state._queue ?? [], wallTime);

    const { _queue, _nextAt, _depth: _prevDepth, _lt: _prevLt, ...userState0 } = state;

    // ── PROPER-TIME DISPATCH (futureTau — the τ arc's W-node layer; laws in public/kwe-tau.js) ──────────────────
    // A node may declare its clock as the reserved handler key  __clock: (state) => number  — a PURE, MONOTONE
    // function of the node's own replicated state (its heartbeat: cycles completed, steps lived, beats counted —
    // the model-level analog of the medium's beat detector; the kernel may know THAT a node has a clock, never WHY
    // it ticks). ctx.futureTau(dTau, msg) fires when the clock has advanced by dTau from the SCHEDULING state —
    // "when this node's matter has aged by dTau", not "in dTau milliseconds". No __clock ⇒ τ ≡ wallTime and
    // futureTau reduces EXACTLY to future (the no-op guarantee). τ readiness is evaluated once per pulse against
    // the incoming replicated state → deterministic (L1); a τ entry on a node whose clock stands WAITS, honestly.
    // ── MONOTONE τ THROUGH A COUNTER RESET (the self-heal kwe-tau has and this layer lacked, added 2026-09-10).
    // __clock is DECLARED pure and monotone, but an app's honest clock source can still step BACKWARD at a
    // legitimate counter reset (a slot reset restarts its step counter; a recall re-births a worldline). This gate
    // is a bare `tauNow >= fireAtTau` and a τ entry carries NO fireAt, so a backward jump would strand it FOREVER
    // — nothing else can ever fire it.
    // kwe-tau's answer (kwe-tau.js:65-66): RE-BASELINE the counter and keep accumulating. Its τ is `c.beats`, a
    // count of beats LIVED, so a reset moves the baseline while τ keeps climbing (measured: τ=3, counter resets to
    // 0, three more beats → τ=6 — NOT frozen at 3, and NOT restarted at 3).
    // This layer now does the same with two replicated numbers: _tauBase (accumulated τ carried across resets) and
    // _tauRef (the raw reading that base corresponds to). τ = _tauBase + (raw − _tauRef); when raw drops below
    // _tauRef we bank the elapsed time into the base and re-reference. So τ is monotone AND keeps advancing —
    // physically, resetting a worldline's FIELD does not un-live the beats it lived, and it does not stop the
    // clock either.
    // ADDITIVE: a clock that never goes backward keeps _tauRef at its initial reading and τ ≡ raw ⇒ bit-for-bit
    // unchanged. No __clock ⇒ τ ≡ wallTime, exactly as before (the no-op guarantee).
    const clockFn = handlers.__clock;
    const tauRaw  = clockFn ? clockFn(userState0) : wallTime;
    const _tauRef0  = userState0._tauRef;
    const _tauBase0 = userState0._tauBase ?? 0;
    // a reset (raw below the reference) banks the elapsed span and re-references at the new raw reading
    const _tauPrev  = userState0._tauLast;   // the raw reading this node last saw (pre-reset it is the high mark)
    const _rebased  = clockFn && _tauPrev !== undefined && tauRaw < _tauPrev;
    // On a reset: bank everything lived up to the last reading, then re-reference at the new raw value.
    const tauBase   = _rebased ? (_tauBase0 + (_tauPrev - (_tauRef0 ?? 0))) : _tauBase0;
    const tauRef    = _rebased ? tauRaw : (_tauRef0 ?? tauRaw);
    const tauNow0   = clockFn ? (tauBase + (tauRaw - tauRef)) : tauRaw;
    const tauReady = laterAll.filter(e => e.fireAtTau !== undefined && tauNow0 >= e.fireAtTau);
    // ── CAUSAL FRONTIER DISPATCH (futureFrontier — the "stars in the sky" gate; laws in doc/frontier-design.md) ──
    // ctx.futureFrontier(reqTime, msg) fires when THIS node's clock AND its light-cone neighbours' clocks have all
    // reached reqTime. The neighbour clocks are folded into the node's OWN replicated state (userState0._nbrClk =
    // {from: clk}, filled by the node's own handler from neighbour _clk broadcasts) → the gate is a PURE FN of the
    // node's replicated state, exactly like __clock/futureTau → byte-identical firing on every peer (determinism
    // preserved). ADDITIVE: no _nbrClk ⇒ frontier ≡ own clock ≡ futureTau's behaviour; a node with no fireAtFrontier
    // entry is bit-for-bit unchanged. An unmet frontier WAITS honestly (no fireAt → never coordinate-ready).
    const _nbrClk = userState0._nbrClk;
    const frontier = (_nbrClk && typeof _nbrClk === "object")
      ? Math.min(tauNow0, ...Object.values(_nbrClk))
      : tauNow0;
    const frontierReady = laterAll.filter(e => e.fireAtFrontier !== undefined && frontier >= e.fireAtFrontier);
    // ── GEOMETRIC (BANACH) CONVERGENCE DISPATCH (futureContract — the geometry gate beside the temporal ones) ──
    // ctx.futureContract(tol, msg) fires when THIS node's state has CONVERGED to within tol of its fixpoint —
    // the Banach face beside futureTau's Kleene face. A node declares a reserved PURE handler
    //   __residual: (state) => number     // distance-to-fixpoint (a contraction's step-delta ‖state − W(state)‖)
    // and the entry fires when __residual(state) ≤ tol. Like __clock, it is a pure fn of the node's REPLICATED
    // state → byte-identical firing on every peer (determinism preserved). ADDITIVE: no __residual ⇒ residual
    // is +∞ ⇒ never fires; a node with no fireAtContract entry is bit-for-bit unchanged. An unmet contract
    // WAITS honestly (no fireAt → never coordinate-ready, never blocks stability). This gives the core a
    // certified-contraction node class: a contraction (ρ<1) drains in bound() steps, and downstream work can
    // be scheduled on its OWN geometric convergence rather than a clock. Laws mirror futureTau (kwe-tau.js).
    const residualFn = handlers.__residual;
    const residual0 = residualFn ? residualFn(userState0) : Infinity;
    const contractReady = laterAll.filter(e => e.fireAtContract !== undefined && residual0 <= e.fireAtContract);
    const consumed = (tauReady.length || frontierReady.length || contractReady.length)
      ? new Set([...tauReady, ...frontierReady, ...contractReady]) : null;
    const later = consumed ? laterAll.filter(e => !consumed.has(e)) : laterAll;
    const allReady = [...inbound, ...ownReady, ...tauReady, ...frontierReady, ...contractReady];

    if (!isSubTick && (state._lt ?? -1) !== logicalTime) {
      allReady.unshift({ fireAt: wallTime, msg: "__macro", payload: pulse, _depth: 0 });
    }

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
        futureTau: (dTau, msg, payload) =>
          effects.push({ kind: "futureTau", dTau, msg, payload }),   // resolved AFTER the handler returns, against the post-handler state ("aged by dTau from the moment this verb finished")
        futureFrontier: (reqTime, msg, payload) =>
          effects.push({ kind: "futureFrontier", reqTime, msg, payload }),   // fires when own clock AND light-cone neighbour clocks (in _nbrClk) all reach reqTime — the causal frontier gate
        futureContract: (tol, msg, payload, opts) =>
          effects.push({ kind: "futureContract", tol, msg, payload, blocking: opts?.blocking !== false }),   // fires when __residual(state) ≤ tol — the geometric (Banach) convergence gate (the node has reached its fixpoint). opts.blocking:false = a CERTIFICATE that waits across pulses without holding isStable (see stable)
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
        } else if (eff.kind === "futureTau") {
          // Schedule against the PLATEAU, not the raw clock: if the counter has just reset, the raw reading is
          //   below the high-water mark, and a deadline stamped from it would be instantly (and wrongly) due.
          //   Same monotone τ the gate above reads → schedule and fire agree by construction.
          const tRaw = clockFn ? clockFn(userState) : wallTime;   // post-handler state (replicated → deterministic)
          const tNow = clockFn ? (tauBase + (tRaw - tauRef)) : tRaw;   // the SAME accumulator the gate reads → schedule and fire agree by construction
          newQueue = _Q.enqueue(newQueue,
            { fireAtTau: tNow + eff.dTau, msg: eff.msg, payload: eff.payload, _depth: 0 });   // no fireAt: never coordinate-ready, JSON-safe (see _Q)
        } else if (eff.kind === "futureFrontier") {
          newQueue = _Q.enqueue(newQueue,
            { fireAtFrontier: eff.reqTime, msg: eff.msg, payload: eff.payload, _depth: 0 });   // no fireAt: gated on the causal frontier (own+neighbour clocks), never wall-time-ready, JSON-safe
        } else if (eff.kind === "futureContract") {
          newQueue = _Q.enqueue(newQueue,
            { fireAtContract: eff.tol, msg: eff.msg, payload: eff.payload, _depth: 0, ...(eff.blocking ? {} : { _cNB: true }) });   // no fireAt: gated on geometric convergence (__residual ≤ tol), never wall-time-ready, JSON-safe
        } else if (eff.kind === "send" && appRef) {
          appRef._outbox ??= {};
          appRef._outbox[eff.targetId] ??= [];
          appRef._outbox[eff.targetId].push(
            { msg: eff.msg, payload: eff.payload, _depth: eff._depth ?? 0,
              _evalGen: appRef._currentEvalGen });
        }
      }
    }

    // Post-handler residual (2b-ii): re-measure distance-to-fixpoint against the FINAL state this reduce
    // produces — the state `stable` will see. Stamped as _contractResidual so `stable` can decide, purely
    // from node state, whether a pending futureContract entry has converged. undefined ⇒ no contraction node
    // ⇒ never blocks (the additive guarantee: a contract-less world is bit-for-bit unchanged).
    const _contractResidual = residualFn ? residualFn(userState) : undefined;

    // τ HIGH-WATER MARK (see the monotone-τ note above): re-read the clock against the FINAL state — a handler
    // may have advanced it — and carry the running maximum in replicated state. This is what makes the plateau
    // survive a counter reset AND ride the join snapshot, so a joiner cannot resume with a lower τ than the
    // leader and re-fire a crossing the leader already consumed. Only stamped when the node HAS a clock, so a
    // clock-less node's state is untouched (the additive guarantee).
    // Re-read against the FINAL state (a handler may have advanced the clock) and carry the three τ numbers in
    // replicated state so the accumulator survives a reset AND rides the join snapshot — a joiner must not resume
    // with a lower τ than the leader and re-fire a crossing the leader already consumed.
    // The reset usually happens INSIDE a handler, so the drop is visible only against the POST-handler state —
    // the pre-handler check above catches a drop that arrived between pulses. Re-check here and bank the span
    // lived up to the pre-reset reading, so a reset costs nothing and τ resumes climbing from the banked value.
    const _tauRawEnd = clockFn ? clockFn(userState) : undefined;
    //   The drop is detected against the PRE-handler raw reading (tauRaw), not against tauRef: after a long climb
    //   tauRef is still the old origin (often 0), so comparing to it misses every reset. tauRaw is what this node
    //   read at the top of this very pulse, so a handler that reset the counter shows up as end < start.
    const _endRebased = clockFn && _tauRawEnd < tauRaw;
    const _tauFields = clockFn
      ? (_endRebased
          ? { _tauBase: tauNow0, _tauRef: _tauRawEnd, _tauLast: _tauRawEnd }   // tauNow0 = everything lived up to this pulse; re-reference at the reset value
          : { _tauBase: tauBase, _tauRef: tauRef, _tauLast: _tauRawEnd })
      : undefined;

    return {
      ...userState,
      _queue:  newQueue,
      _nextAt: _Q.nextAt(newQueue),
      _depth:  maxDepthSeen,
      _lt:     isSubTick ? (state._lt ?? -1) : logicalTime,
      ...(_contractResidual !== undefined ? { _contractResidual } : {}),
      ...(_tauFields ?? {}),
    };
  };

  const stable = (nodes, pulse) => {
    const wall    = pulse?.wallTime ?? 0;
    const appRef  = pulse?._appRef;
    const outboxEmpty = !appRef || Object.keys(appRef._outbox ?? {}).length === 0;
    const flat = nodes.flatMap(n => Array.isArray(n) ? n : [n]);
    return outboxEmpty && flat.every(n =>
      !n ||
      ((n._queue ?? []).every(e =>
         (e.fireAt === undefined || e.fireAt > wall)                                    // temporal entries: due ones block; τ/frontier/contract carry no fireAt
         // 2b-ii: an UNCONVERGED futureContract entry DOES block stability — the world isn't "done" until its
         // contraction nodes reach their fixpoint. Guarded so it's vacuous without a contract: an entry with no
         // fireAtContract is unaffected, and a node with no _contractResidual (no __residual → contract-less)
         // can't have a blocking contract → a contract-less world is bit-for-bit unchanged (the additive law).
         // NON-BLOCKING contracts (_cNB, ctx.futureContract(tol, msg, payload, { blocking: false })) are exempt: a node whose
         // residual can only shrink ACROSS pulses (it is re-measured once per beat of a living medium, not per drain sub-tick)
         // must not hold the world unstable — the drain cannot make it converge, and the join WARP loop (which has no
         // next-event break) would spin its 1000-iteration guard every pulse the certificate is pending.
         && !(e.fireAtContract !== undefined && !e._cNB && n._contractResidual !== undefined && n._contractResidual > e.fireAtContract)
       ) && (n._depth ?? 0) === 0)
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
          // _telemetry = WRITE-ONLY debug scaffolding (a full _worldSnapshot node-scan pushed per sub-tick; NOTHING
          //   reads it back). It was UNCAPPED here → every join/reload's warp pushed up to 1000 scans into a per-LT
          //   array never freed → the leader DEGRADED with every joiner reload (measured). Since nothing consumes it,
          //   the honest fix is to NOT BUILD it in normal operation — gate recording behind window.KWE_TELEMETRY (off
          //   by default → zero snapshot work). A debugger flips the flag on to inspect the warp/drain trajectory.
          const _tel = (typeof window !== "undefined" && window.KWE_TELEMETRY);
          if (_tel) { world._telemetry ??= {}; world._telemetry[lastLT] ??= []; }
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
            // PER-BEAT HOOK DURING WARP (the join-catch-up fix): WARP replays the joiner's missed beats in the reducer; without
            //   the hook here the GPU texture doesn't step per beat during catch-up → it bursts afterward (wrong-beat coupling
            //   smear → the occasional join fork). Firing the hook per WARP sub-tick makes the texture step 1 beat/sub-tick,
            //   LOCKSTEP with the reducer → each caught-up beat gets its own couplAtt (deterministic), like a live peer.
            if (typeof world._pulseHook === "function") { try { world._pulseHook(world, world._lastPulse); } catch (e) {} }
            if (_tel && world._telemetry[lastLT].length < 200) world._telemetry[lastLT].push(
              Renkon.app._worldSnapshot?.(world, "warp", safety)
            );
          }
          world._lastWarpIters = safety;
          if (_tel) { const _tKeys = Object.keys(world._telemetry).map(Number).sort((a, b) => a - b);   // cap the KEY count (per join/reload adds one) — drop oldest
            while (_tKeys.length > 5) delete world._telemetry[_tKeys.shift()]; }
        }

        if (isNewPulse || lastLT === 0) {
          world._currentEvalGen = (world._currentEvalGen ?? 0) + 1;
          const p = { ...pulse, _appRef: world, _fbStepMs: Renkon.app._fbStepMs ?? 0 };
          world._lastPulse = p;
          world.logicalTime  = p.logicalTime;
          world._lastPulseId = p._pulseId || 0;
          worldps.registerEvent("reflector", p);
          worldps.evaluate();

          const _telD = (typeof window !== "undefined" && window.KWE_TELEMETRY);   // same write-only debug scaffolding, gated off by default
          if (_telD) {
            world._telemetry ??= {};
            world._telemetry[p.logicalTime] = [ Renkon.app._worldSnapshot?.(world, "macro", 0) ];
            const _tKeys = Object.keys(world._telemetry).map(Number).sort((a, b) => a - b);
            if (_tKeys.length > 5) delete world._telemetry[_tKeys[0]];
          }

          let iters = 0;
          while (!world.isStable && iters < 10000) {
            const _wn = Renkon.app._worldNextAt(world);
            if (_wn === null) break;
            if (_wn >= p.wallTime + SUBTICK_MS) break;
            iters++;
            world._currentEvalGen++;
            worldps.registerEvent("reflector", { ...p, wallTime: _wn ?? p.wallTime, isSubTick: true });
            worldps.evaluate();
            if (typeof world._pulseHook === "function") { try { world._pulseHook(world, p); } catch (e) {} }   // per-beat hook during the drain sub-ticks too (a joiner's catch-up drains beats here) → texture steps lockstep with the reducer
            if (_telD && world._telemetry[p.logicalTime].length < 200) world._telemetry[p.logicalTime].push(
              Renkon.app._worldSnapshot?.(world, "drain", iters)
            );
          }
          world._lastDrainIters = iters;
          if (world._outbox && Object.keys(world._outbox).length > 0) {
            world._currentEvalGen++;
            worldps.registerEvent("reflector", { ...p, isSubTick: true });
            worldps.evaluate();
          }
          // PER-PULSE HOOK (once per beat, LOSSLESS — this loop processes every queued pulse, unlike the post-batch renderFn).
          //   A renderer may register world._pulseHook (on the world app, like _snapHook) to run GPU work (a coupled-slot step +
          //   deterministic checkpoint readback) on the SHARED beat clock rather than rAF (which skips beats per-peer). Runs after
          //   the drain so state is settled for this beat. Only on real (non-subtick) new pulses → once per beat.
          if (typeof world._pulseHook === "function") { try { world._pulseHook(world, p); } catch (e) { console.warn("[pulseHook]", e); } }
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
    const _t0 = performance.now();
    ps.registerEvent("reflectorPulse", pulse);
    ps.evaluate();
    const _tEval = performance.now() - _t0;
    if (_tEval > 5 || pulse._isEvent) {
      let nBands = '?';
      for (const [, wps] of ps.app.registry) { const v = wps.app?.nls4; if (v) nBands = v.ifsNBands ?? '?'; }
      console.log(`[META:injectPulse] lt=${pulse.logicalTime} isEvent=${!!pulse._isEvent} eval=${_tEval.toFixed(2)}ms nBands=${nBands}`);
    }
    if (pulse.logicalTime % 100 === 0) {
      let worldAlarms = '?', worldResolved = '?', worldChangeList = '?';
      for (const [, wps] of ps.app.registry) {
        worldAlarms    = wps.evaluationAlarm?.length ?? '?';
        worldResolved  = wps.resolved?.size ?? '?';
        worldChangeList= wps.changeList?.size ?? '?';
      }
      console.log(`[PS] lt=${pulse.logicalTime} metaAlarms=${ps.evaluationAlarm?.length} metaResolved=${ps.resolved?.size} worldAlarms=${worldAlarms} worldResolved=${worldResolved} worldChangeList=${worldChangeList}`);
    }
  };

  const startAutonomous = () => {
    if (_autoInterval) return;
    let _lastFire = performance.now();
    const _tick = (now) => {
      if (!_autoInterval) return;
      if (now - _lastFire >= reflectorMs) {
        _lastFire += reflectorMs;
        // prevent drift accumulation if tab was hidden
        if (now - _lastFire > reflectorMs * 4) _lastFire = now;
        _localLt++;
        const pulse = Object.freeze({
          logicalTime: _localLt,
          wallTime:    _localLt,
          wallMs:      _localLt * reflectorMs,
          _isLocal:    true,
        });
        ps.registerEvent("reflectorPulse", pulse);
        ps.evaluate();
      }
      _autoInterval = requestAnimationFrame(_tick);
    };
    _autoInterval = requestAnimationFrame(_tick);
  };

  const stopAutonomous = () => {
    if (_autoInterval) { cancelAnimationFrame(_autoInterval); _autoInterval = null; }
  };

  const getLocalLt = () => _localLt;

  const takeSnapshot = () => {
    const _safeClone = (v) =>
      JSON.parse(JSON.stringify(v, (k, val) => {
        if (k === '_appRef') return undefined;
        // Strip ephemeral wavefunction arrays — they are renderer-local and
        // reconstructed on next tick. Keys: psi, refPsi, platePsi, cloudPsiC,
        // cloudPsiF, objField, srcField, snapRefField, plateFastField, plateTierFields.
        if (k === 'psi' || k === 'refPsi' || k === 'platePsi' ||
            k === 'cloudPsiC' || k === 'cloudPsiF' ||
            k === 'objField' || k === 'srcField' ||
            k === 'snapRefField' || k === 'plateFastField' ||
            k === 'plateTierFields' || k === 'depthTierFields') return undefined;
        if (ArrayBuffer.isView(val) && !(val instanceof DataView)) return _TA.encode(val) ?? { __f64: Array.from(val) };   // compact base64 for big f32/f64 fields; small/other → {__f64:[...]}
        const _cp = Array.isArray(val) ? _TA.encodePlain(val) : null;   // big plain number arrays (e.g. descBase.re/.im = new Array(N)) → compact base64-f64
        if (_cp) return _cp;
        return val;
      }));
    const _cloneOutbox = (ob) => JSON.parse(JSON.stringify(ob ?? {}, (k, val) => {
      if (k === '_appRef') return undefined;
      if (ArrayBuffer.isView(val) && !(val instanceof DataView)) return _TA.encode(val) ?? { __f64: Array.from(val) };
      return (Array.isArray(val) ? _TA.encodePlain(val) : null) ?? val;
    }));
    const snap = { time: _localLt, worlds: {}, rng: W.rng.state() };   // W.rng's LIVE counters ship with the join snapshot: the model's in-flight cascades (e.g. fresnelBeat's _ifsFireChildren, 2 draws/beat) consume the stream between _launchSlot reseeds — a joiner restored mid-cascade at the DEFAULT rng state draws different child delays → different ring radii at the next finalize → same kernel ver, different CONTENT → permanent field fork (live-caught twice; the queue itself already ships)
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
        // IN-FLIGHT MESSAGES ARE WORLD STATE. A ctx.send (or a _pulseHook push) made after a pulse's last evaluate is
        //   delivered at the NEXT pulse; a snapshot taken between the two must carry it, or the joiner resumes one
        //   message short of the leader (Croquet snapshots its future-message queue for the same reason). The
        //   texture-coupling reportCoup is exactly this: pushed after the drain, consumed by the next register beat.
        //   Payloads are shipped verbatim — none of the node-state key stripping applies to a message.
        _outbox:       _cloneOutbox(app._outbox),
      };
      // App-level snapshot hook: lets a renderer inject LIVE state (e.g. a soliton ψ field that lives in the GPU, not a world node) into the snapshot
      // AT JOIN TIME ONLY (takeSnapshot runs on a request_snapshot). Typed arrays the hook adds are serialized as {__f64:...} below — but the hook runs
      // after _safeClone, so it must add already-cloneable data ({__f64:[...]} form). Off the render path; one capture per join.
      if (typeof app._snapHook === 'function') { try { app._snapHook(snap.worlds[worldId]); } catch (e) { console.warn('[SNAP] _snapHook failed', e); } }
      //   one summary line per world. The per-node dump that was here JSON.stringify'd every node's full state (plain
      //   arrays, no codec — multi-MB with fields/plates) into the console on EVERY join, on the leader, inside this
      //   synchronous take. Queue lengths are what a join debug needs; the state itself travels in the snapshot.
      console.log('  world=' + worldId + ' lt=' + (app.logicalTime || 0) + ' nodes=[' + Object.entries(nodes).map(([k, v]) =>
        k + (v._queue.length ? ' q' + v._queue.length : '') + (v._nextAt < Infinity ? ' @' + v._nextAt : '')).join(', ') + ']');
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
    if (snap.rng) W.rng.restore(snap.rng);   // resume the leader's EXACT rng stream (see takeSnapshot: mid-cascade joiner parity; pre-rng snapshots skip = old behavior)
    console.group('%c[SNAP APPLY] peer=' + peerId + ' t=' + snapTime, 'color:#58a6ff;font-weight:bold');
    for (const [worldId, worldPS] of ps.app.registry) {
      const saved = snap.worlds[worldId];
      if (!saved) {
        console.warn('  world=' + worldId + ' — not in snapshot (snap has: ' + Object.keys(snap.worlds).join(',') + ')');
        continue;
      }
      const app = worldPS.app;
      const _revive = (val) => {
        if (val && typeof val === 'object') {
          const ta = _TA.decode(val);   // compact {__b64/__ta} or {__f64:[...]}/{__f32:[...]} → typed array
          if (ta !== undefined) return ta;
          if (Array.isArray(val)) return val.map(_revive);
          const out = {};
          for (const [fk, fv] of Object.entries(val)) out[fk] = _revive(fv);
          return out;
        }
        return val;
      };
      const restoreState = {};
      for (const [k, v] of Object.entries(saved)) {
        if (k.startsWith('_')) continue;
        const rv = _revive(v);
        restoreState[k] = rv;
        app[k] = rv;
      }
      // PRE-RESTORE HOOK — the twin of _snapHook's STRIPPING: an app may ship DERIVED state as its recipe (e.g. a hologram plate as the
      //   stored field it is an exact, deterministic function of) and rebuild it HERE, in the restored node states, before the restore
      //   evaluate — so no reducer and no renderer ever sees the thinner snapshot. It must be a pure function of the restored state.
      if (typeof app._restorePreHook === 'function') { try { app._restorePreHook(restoreState); for (const [k, v] of Object.entries(restoreState)) app[k] = v; } catch (e) { console.warn('[SNAP] _restorePreHook failed', e); } }
      // The joiner's own outbox holds messages from the world it ran BEFORE the snapshot — a world that no longer
      //   exists; delivering them would inject its values into the restored one. Replace it with the leader's
      //   in-flight messages, re-stamped _evalGen 0 so the next evaluate delivers them, as the leader's next one does.
      //   (The restore evaluate below does not consume the outbox: W.reduce returns _restoreState first.)
      const _ob = {};
      for (const [tgt, msgs] of Object.entries(saved._outbox ?? {})) {
        if (Array.isArray(msgs) && msgs.length) _ob[tgt] = msgs.map((m) => ({ ..._revive(m), _evalGen: 0 }));
      }
      app._outbox = _ob;
      const prevLt = app.logicalTime || 0;
      app.logicalTime      = saved._logicalTime || snapTime;
      app._lastPulseId     = saved._lastPulseId || 0;
      app.isStable         = true;
      app._awaitSnapshot   = false;   // the joiner's renderer may start now — from the restored state
      app._snapshotApplied = true;
      app._snapshotSeq     = (app._snapshotSeq | 0) + 1;   // a counter, never cleared: _snapshotApplied is consumed by the renderer, and a
                                                            //   _pulseHook may run before the next render, so it needs its own "a restore happened" signal
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
      // RESTORE HOOK — the twin of _snapHook (which runs on TAKE). Renderer-side watermarks ("I have handled up to
      //   here") must be primed from the RESTORED state at THIS instant: the renderer's next call (a render frame, or
      //   a _pulseHook) comes only after the next pulse has already been evaluated, and priming then treats that
      //   pulse as handled — a beat the leader acts on and the joiner silently skips.
      if (typeof app._restoreHook === 'function') { try { app._restoreHook(); } catch (e) { console.warn('[SNAP] _restoreHook failed', e); } }
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
      // a pulse before any snapshot means none is coming (the reflector found no live member to ask and dropped the
      //   pending join) — stop holding the renderer rather than leave the joiner blank
      for (const [, w] of (app.meta.ps.app.registry || [])) if (w.app._awaitSnapshot) { w.app._awaitSnapshot = false; console.warn('[PEER] pulse before snapshot — not waiting any longer'); }
      app.meta.injectPulse(msg);
    } else if (msg.type === 'selo_joined') {
      const r = app.meta.ps.app;
      r.seloRoster = { myId: msg.clientId, clients: new Map([[msg.clientId, { joinedAt: Date.now() }]]), count: msg.clientsInSelo, joinOrder: msg.clientsInSelo };
      console.log('%c[PEER] joined selo:' + msg.seloId + ' as ' + msg.clientId + ' (' + msg.clientsInSelo + ' total)', 'color:#58a6ff');
      if (msg.clientsInSelo === 1) {
        // Sole member — no snapshot coming. Reset lt so reflector pulses pass isNewPulse.
        app.meta.resetLt();
      } else {
        // JOINING — a snapshot is on its way. Mark every world as awaiting it, so a renderer can hold instead of
        //   booting a fresh local field that the snapshot then overwrites (w.app._awaitSnapshot; applySnapshot clears it).
        //   The reflector buffers this peer's pulses until the snapshot, so the world itself does not advance meanwhile.
        for (const [, w] of (r.registry || [])) w.app._awaitSnapshot = true;
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
    const _tMsg = performance.now();
    const msg = JSON.parse(event.data);
    if (msg.type === 'pulse') {
      if (msg._isEvent) console.log(`[PEER:${seloId}] ⚡pulse lt=${msg.logicalTime} arrived at ${_tMsg.toFixed(1)}ms`);
    } else if (msg.type === 'snapshot_apply') {
      console.log('%c[PEER:' + seloId + '] snapshot_apply t=' + (msg.snapshot?.time ?? '?'), 'color:#f90;font-weight:bold');
    } else if (msg.type !== 'selo_joined') {
      console.log('[PEER:' + seloId + '] msg=' + msg.type);
    }
    if (messageResolvers.length > 0) messageResolvers.shift()(msg);
    else messageQueue.push(msg);
    // evaluate after microtask so the async generator resumes before we process
    Promise.resolve().then(() => ps.evaluate());
  });
  ws.addEventListener('close', () => {
    console.log('%c[PEER:' + seloId + '] WS closed', 'color:#f85149');
    appData.ws = null;
  });
  ws.addEventListener('error', (e) => { console.error('[PEER] WS error', e); });

  //   ── SAY GOODBYE ON PAGE UNLOAD (2026-09-17 — "reload occasionally does not work; changing k, or a new
  //   window/tab, helps"). A RELOAD never calls disconnect(), so nothing sent 'goodbye' and the reflector kept
  //   the dying client in the selo until TCP eventually noticed. The fresh page then joined a room that still
  //   showed size > 1, so the reflector requested a snapshot FROM THE DEAD PEER — and the new world sat waiting
  //   on a restore that never came (or applied one from a world that was already gone).
  //   THAT IS THE INTERMITTENCY: it depends on whether the old socket closed before the new one joined, which
  //   is a race. Every workaround the user found avoids a stale member — a different ?k= is a different room, a
  //   new window/tab leaves the old page alive so it answers properly.
  //   pagehide is the reliable one (bfcache-safe, fires on mobile); beforeunload is kept for older paths. The
  //   send is best-effort: if the socket is already closing there is nothing to do, and the reflector's normal
  //   close handling still applies.
  if (typeof window !== 'undefined') {
    const _bye = () => { try { if (appData.ws && appData.ws.readyState === 1) appData.ws.send(JSON.stringify({ type: 'goodbye' })); } catch (e) {} };
    window.addEventListener('pagehide', _bye);
    window.addEventListener('beforeunload', _bye);
  }

  const disconnect = () => {
    if (appData.ws) {
      appData.ws.send(JSON.stringify({ type: 'goodbye' }));
      appData.ws.close();
      appData.ws = null;
    }
    ps.stop();
  };

  const injectExternalEvent = (payload, targetWorldId = null, targetNodeId = null, targetWorldIds = null) => {
    const _t0 = performance.now();
    ps.registerEvent('_outgoing', { payload, targetWorldId, targetNodeId, targetWorldIds });
    ps.evaluate();
    console.log(`[INJECT] registerEvent+evaluate took ${(performance.now()-_t0).toFixed(2)}ms type=${payload?.type}`);
  };

  return { ps, disconnect, injectExternalEvent, seloId };
};

// ── IFS Clock ─────────────────────────────────────────────────────────────────
// Returns a Renkon world-program string that runs an IFS fractal heartbeat clock.
//
// The clock fires "beat" events at self-similar delays derived from the IFS maps.
// Each beat carries { depth, delay, gen, cycleId } plus any payload returned by
// the user-supplied onBeat function — enabling the clock to drive arbitrary
// continuous dynamical systems (Lorenz, Rössler, neural oscillators, etc.).
//
// Parameters:
//   depth     — number of fractal depth levels (default 5)
//   baseDelay — root delay in logical-time ticks (default π-2 ≈ 2.14, transcendental)
//   minDelay  — contraction floor; beats below this are dropped (default 0.1)
//   cycle     — logical ticks between cycle restarts (default 8)
//   decay     — energy decay per tick, 0..1 (default 0.1)
//   maps      — IFS contraction ratios; defaults to [√2-1, 1/φ, √3-1] (mutually
//               incommensurable algebraic irrationals — no integer products with π base)
//   genCap    — max self-loop generations before stopping chain (default 6)
//   onBeat    — JS source string of a function (p, ctx, W) => extraFields.
//               Called at every beat; return value is merged into each tickEvent.
//               p = beat payload { depth, delay, gen, cycleId, ...user fields }
//               ctx = W.reduce context { future, wallTime }
//               W = the W runtime (for W.rng etc.)
//               Must always consume a fixed number of W.rng.next() calls for
//               determinism across peers.
//   onCycle   — JS source string of a function (cycleCount, p, W) => extraFields.
//               Called at the start of each cycle (after RNG is reseeded).
//               Return value is spread into the initial beat payload.
//               Use this to set initial conditions for your dynamical system.
//
// Usage:
//   import { makeIfsClock } from './krestianstvo-wavefront-evaluator.js';
//   const prog = makeIfsClock({
//     onCycle: `(cycleCount, p, W) => {
//       const lx0 = (W.rng.next() - 0.5) * 2;
//       const ly0 = 1 + (W.rng.next() - 0.5) * 2;
//       const lz0 = (W.rng.next() - 0.5) * 2;
//       return { lx: lx0, ly: ly0, lz: lz0 };
//     }`,
//     onBeat: `(p, ctx, W) => {
//       const { delay, lx = 0.1, ly = 0, lz = 25 } = p;
//       const SIGMA = 10, RHO = 28, BETA = 2.6667, SCALE = 0.5;
//       const dt = delay * SCALE / 8;
//       // ... RK4 steps ...
//       return { lx: nlx, ly: nly, lz: nlz };
//     }`,
//   });
//   const world = makeWorld('myWorld', [prog]);
//
export const makeIfsClock = ({
  depth    = 5,
  baseDelay = 2.1415926535,
  minDelay  = 0.1,
  cycle     = 8,
  decay     = 0.1,
  maps      = [0.4142135623, 0.6180339887, 0.7320508075],
  genCap    = null,   // null → DERIVED from the Banach bound below (the self-chain's certified natural depth);
                      // a number overrides it (a deliberate truncation). Was a magic 6 — measured to truncate
                      // ~0.5% of beats vs the natural depth (fractal-timecontraction.test.mjs).
  onBeat    = '(p, ctx, W) => ({})',
  onCycle   = '(cycleCount, p, W) => ({})',
} = {}) => {
  // CERTIFIED SELF-CHAIN DEPTH (Banach bound on time): selfDelay = delay·rᵢ (rᵢ ∈ maps, all <1) is a geometric
  // contraction, so after n generations selfDelay ≤ baseDelay·ρ_max^n; it falls below minDelay at
  // n = ⌈log(minDelay/baseDelay)/log ρ_max⌉. That is the fractal's NATURAL depth — the delays terminate the
  // chain, not a magic cap. genCap defaults to this bound (self-adjusts to ρ/baseDelay/minDelay); an explicit
  // genCap still overrides for a deliberate shallower truncation. (Proven: this equals the minDelay-terminated
  // stream where the old genCap=6 didn't already truncate — a lossless generalization of the magic number.)
  const _rhoMax = Math.max(...maps);
  const _boundDepth = (_rhoMax > 0 && _rhoMax < 1 && baseDelay > minDelay)
    ? Math.ceil(Math.log(minDelay / baseDelay) / Math.log(_rhoMax)) : 999;
  genCap = (genCap == null) ? _boundDepth : genCap;
  return `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const fractal = Behaviors.collect(
    { energy: Array(${depth}).fill(0), cycleId: 0, totalBeats: 0, cycleCount: 0, tickEvents: [] },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "fractal", {

      __macro: (s, p, ctx) => {
        const energy = (s.energy || []).map(e => Math.max(0, e - ${decay}));
        if (p.logicalTime % ${cycle} === 1) {
          const cycleCount = (s.cycleCount ?? 0) + 1;
          // MurmurHash3 finalizer — bijective hash for uncorrelated per-cycle RNG seeds
          let h = (cycleCount ^ (p.logicalTime >>> 0)) >>> 0;
          h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
          h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
          h = (h ^ (h >>> 16)) >>> 0;
          W.rng.seed(h);
          const _onCycle = ${onCycle};
          const extra = _onCycle(cycleCount, p, W) ?? {};
          ctx.future(0, "beat", { depth: 0, delay: ${baseDelay}, cycleId: p.logicalTime,
                                  gen: 0, ...extra });
          return { ...s, energy, cycleId: p.logicalTime, cycleCount, tickEvents: [] };
        }
        return { ...s, energy, tickEvents: [] };
      },

      beat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const { depth, delay, gen = 0 } = p;
        if (depth >= ${depth}) return s;
        const _maps = ${JSON.stringify(maps)};
        const _onBeat = ${onBeat};
        const extra = _onBeat(p, ctx, W) ?? {};
        const energy = [...(s.energy || Array(${depth}).fill(0))];
        energy[depth] = 1.0;
        const subT = ctx.wallTime % 1;
        const wt   = ctx.wallTime;
        const tickEvents = [...(s.tickEvents || []),
          { d: depth, t: subT, wt, delay, ...extra }];
        // Always consume exactly 2 RNG values unconditionally for peer determinism
        const selfRatio  = _maps[Math.floor(W.rng.next() * _maps.length)];
        const childRatio = _maps[Math.floor(W.rng.next() * _maps.length)];
        const selfDelay  = delay * selfRatio;
        const childDelay = delay * childRatio;
        if (gen < ${genCap} && selfDelay > ${minDelay}) {
          ctx.future(selfDelay, "beat", { depth, delay: selfDelay, gen: gen + 1,
                                         cycleId: s.cycleId, ...extra });
        }
        if (gen === 0 && depth + 1 < ${depth}) {
          const childOffset = selfDelay + childDelay;
          if (childDelay > ${minDelay}) {
            ctx.future(childOffset, "beat", { depth: depth + 1, delay: childDelay, gen: 0,
                                             cycleId: s.cycleId, ...extra });
          }
        }
        return { ...s, energy, totalBeats: s.totalBeats + 1, tickEvents };
      },
    })
  );
`;
};

