/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// kwe-tau.js — THE PROPER-TIME KERNEL (τ): per-worldline clocks + deterministic proper-time dispatch.
//
// Crystallized from the medium's τ arc (doc/proper-time-metric.md, doc/computer.md runs 1–39 + the 2026-07 fork
// hunt). The medium DISCOVERED these laws in its own dynamics; this module is their physics-free form. The split
// (the meta-circular boundary): the kernel may know THAT a worldline has a clock — never WHY it ticks. Everything
// here is provable without knowing what ψ is; everything that requires ψ (beat detectors, measurement grids,
// substrate float discipline, slot↔worldline mappings) stays on the app side of the line, and every constant
// with units arrives through options, never as a kernel default.
//
// THE DETERMINISM LAWS (each one paid for with a live-caught fork):
//   L1  Every gate term must be a pure function of (k, shared state). Queue LENGTH is not (it counts
//       future-stamped entries whose visibility depends on peer-local pull timing); DUE-count is.
//   L2  Never apply anything at a frame boundary — frames are peer-local. All effects land at shared steps:
//       an authored coordinate, a τ crossing, or a due-valve trip.
//   L3  External commands act once at their authored coordinate; everything beyond that moves only as the
//       local matter's own clock ticks. (Authored-fresh vs backlog: a crossing whose startStep is ≥ the k of
//       the previous application is a NEW command and fires at its own coordinate; a crossing already due when
//       the previous one applied is BACKLOG and spreads at ≤1 per τ-unit of the owning worldline.)
//   L4  τ is monotone and causal: integer snap at beats, fractional advance on the PREVIOUS slice length
//       (the retarded estimator — the causal choice), ceiling below the next integer, self-heal (never
//       backward) through counter resets. A worldline with no beats accumulates no time — the clock may
//       honestly STAND; liveness is a declared per-clock policy, never a hidden clamp.
//   L5  Epoch safety: the time→step mapping (c0, rate) changes only at shared steps, and every FUTURE queue
//       entry is re-stamped into the new epoch at the change itself — a verb stamped on either side of the
//       flip converges to the same startStep on every peer.
//   L6  Everything snapshot-carries: clocks, cursors, queues, epoch. A joiner resumes the same τ, the same
//       throttle phase, the same pending stamps — or its geometry forks.
//
// LEVELS (what an app gets):
//   0  No clock registered → flat default: τ ≡ kp/flatL. Gating on a null clock = unconditional coordinate
//      dispatch. The kernel reduces exactly to reflector/future (the no-op guarantee, at kernel level).
//   1  Executed-tick clocks for free: kp = steps the worldline actually lived (vs the coordinate span).
//   2  The app registers genuine beats (its own detector, its own physics) → metric-weighted proper time.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const makeTauKernel = (opts = {}) => {
  const RATE = opts.monRate ?? 1;          // world-clock rate (the medium uses its _MON_RATE)
  const SPP  = opts.stepsPerPhase ?? 19;   // steps per time unit (the medium's ·19)
  const FLAT_L = opts.flatL ?? 21;         // flat-clock slice length (level 0/1 unit; the medium's 21)
  let c0 = opts.clock0 ?? 0, rate = opts.rate ?? 1;   // the epoch: k = floor((t·RATE − c0)·SPP/rate)

  const stamp = (t) => Math.floor(((t ?? 0) * RATE - c0) * SPP / rate);

  // ── CLOCKS ──────────────────────────────────────────────────────────────────────────────────────────────────
  // A clock record is the τ_i integrator verified in the medium (monotone / integer-snap / L-recal / self-heal /
  // ceiling). The kernel never detects beats: the app's detector (pure fn of replicated state, evaluated at
  // shared steps — the app must PROVE that, gate-1 style) calls beat(); the kernel only integrates.
  const clocks = new Map();
  const _clock = (name, make) => { let c = clocks.get(name);
    if (!c) { c = { beats: 0, tau: 0, lprev: FLAT_L, beatK: 0, kp: 0, lastKk: 0, flat: false, watchdogK: null, ...(make || {}) }; clocks.set(name, c); }
    return c; };
  const registerClock = (name, o = {}) => _clock(name, { flat: !!o.flat, watchdogK: (typeof o.watchdogK === 'number') ? o.watchdogK : null });
  // Lazy creation via beat/advance BASELINES the clock at the current proper counter (a fresh clock reads τ=0 and
  // crawls, never the 0.999 ceiling — the medium's lazy-init lesson, kernelized).
  const beat = (name, kp, kk) => { const c = _clock(name, { beatK: kp });
    c.lprev = Math.max(opts.minL ?? 3, kp - c.beatK); c.beatK = kp; c.beats++; c.tau = c.beats;
    if (typeof kk === 'number') c.lastKk = kk; c.kp = kp; };
  const advance = (name, kp) => { const c = _clock(name, { beatK: kp }); c.kp = kp;
    if (c.flat) { c.tau = kp / c.lprev; return c.tau; }                       // level 0/1: flat metric, unbounded
    if (kp < c.beatK) c.beatK = kp;                                          // self-heal: counter reset behind the baseline → re-baseline, never backward
    c.tau = Math.max(c.tau, c.beats + Math.min(0.999, (kp - c.beatK) / c.lprev));   // ceiling + monotone plateau through re-baselines
    return c.tau; };
  const tauOf = (name) => (name && clocks.has(name)) ? clocks.get(name).tau : 0;
  const beatsOf = (name) => (name && clocks.has(name)) ? clocks.get(name).beats : null;   // null = no clock (app cadences fall back to their flat grid)
  const resetClocks = () => clocks.clear();   // selfClock-off semantics: ABSENT clocks = every gate unconditional (coordinate dispatch — the no-op guarantee by construction); fresh clocks rebuild lazily from the detector's next feed
  // DECLARED liveness policy (default OFF — a dead worldline's clock honestly stands): a clock that opted in
  // via watchdogK gets a forced beat when kk − lastBeatKk ≥ watchdogK. Call at shared steps only.
  const watchdog = (name, kk, kp) => { const c = clocks.get(name);
    if (!c || c.watchdogK == null || kk - c.lastKk < c.watchdogK) return false;
    beat(name, (typeof kp === 'number') ? kp : c.kp, kk); return true; };

  // ── QUEUES (the gate-3″ dispatch law, L1–L3) ────────────────────────────────────────────────────────────────
  // Entries carry the raw verb time t; the KERNEL stamps (apps never compute startSteps — the stamp-race bug
  // class is inexpressible). clock: null → unconditional coordinate dispatch (level-0 no-op).
  const queues = new Map();
  const _sort = (q) => q.sort((a, b) => a.startStep - b.startStep || ((a.seq ?? a.ver ?? 0) - (b.seq ?? b.ver ?? 0)));
  const makeQueue = (name, o = {}) => {
    let rec = queues.get(name);
    if (!rec) { rec = { q: [], clock: o.clock ?? null, valve: o.valve ?? 4, tauLast: 0, kApply: 0 }; queues.set(name, rec); }
    // guard: an OPTIONAL head-blocking condition — the head fires only when guard(head, k) is true (FIFO channel
    // semantics: everything behind waits). MUST be a pure function of (k, shared state) — L1 applies to it fully.
    // Non-serializable → never snapshotted; re-supply it at every makeQueue re-attach (restore keeps entries only).
    if (o.guard) rec.guard = o.guard;
    const due = (k) => { let n = 0; for (const e of rec.q) { if (e.startStep <= k) n++; else break; } return n; };   // L1: due-count, never raw length
    const api = {
      push: (entry) => { entry.startStep = stamp(entry.t); rec.q.push(entry); _sort(rec.q); return entry.startStep; },
      restore: (entry) => { rec.q.push(entry); _sort(rec.q); },   // snapshot path: keep the leader's stamp verbatim
      // L3: fresh (startStep ≥ kApply) fires at its coordinate; backlog paces on the owning clock; due-valve bounds.
      // An ABSENT clock (never fed, or resetClocks — the selfClock-off state) = unconditional coordinate dispatch.
      drain: (k, apply) => { let n = 0;
        const gate = () => !rec.clock || !clocks.has(rec.clock) || rec.q[0].startStep >= rec.kApply || (tauOf(rec.clock) - rec.tauLast) >= 1 || due(k) > rec.valve;
        while (rec.q.length && k >= rec.q[0].startStep && gate() && (!rec.guard || rec.guard(rec.q[0], k))) { const e = rec.q.shift(); rec.tauLast = tauOf(rec.clock); rec.kApply = k; apply(e); n++; }
        return n; },
      clear: () => { rec.q.length = 0; },
      resetCursors: () => { rec.tauLast = 0; rec.kApply = 0; },
      get length() { return rec.q.length; }, head: () => rec.q[0] ?? null, entries: () => rec.q,
    };
    return api; };

  // ── EPOCH (L5) ──────────────────────────────────────────────────────────────────────────────────────────────
  // Change the mapping ONLY at a shared step k. Keeps k continuous (c0' = c0 + k·(rateOld − rateNew)/SPP) and
  // re-stamps every FUTURE entry into the new epoch (past-due keeps its stamps: already-due is already-due).
  const reanchor = (k, newRate) => { if (newRate === rate) return;
    c0 = c0 + (k * (rate - newRate)) / SPP; rate = newRate;
    for (const rec of queues.values()) { let ch = false;
      for (const e of rec.q) { if (typeof e.t === 'number' && e.startStep > k) { e.startStep = stamp(e.t); ch = true; } }
      if (ch) _sort(rec.q); } };
  const setEpoch = (newC0, newRate) => { c0 = newC0; rate = newRate ?? rate; };   // join/boot alignment only — NOT for live flips (use reanchor)

  // ── CADENCE (the leash law: one advance per beat of the owning worldline) ──────────────────────────────────
  // fresh() = command-fresh (the experimenter's hand is outside the metric: the FIRST advance after a command
  // fires immediately, even from a beat-dead worldline; further motion only as its clock ticks).
  const makeCadence = (clockName, o = {}) => { const flatMod = o.flatModulo ?? FLAT_L;
    const cur = { lt: 0, lk: 0 };
    return {
      fresh: () => { cur.lt = -1; },
      due: (kp) => { const c = clocks.get(clockName);
        if (!c || c.flat) return (kp % flatMod) === 0;                        // level-0 grid (no-op form)
        if ((c.beats | 0) > (cur.lt | 0)) { cur.lt = c.beats | 0; cur.lk = kp; return true; }
        return false; },
      save: () => ({ lt: cur.lt, lk: cur.lk }),
      restore: (s) => { cur.lt = (s?.lt ?? 0) | 0; cur.lk = (s?.lk ?? 0) | 0; },
    }; };

  // ── SNAPSHOT (L6) + OBSERVABILITY ───────────────────────────────────────────────────────────────────────────
  const save = () => ({ c0, rate,
    clocks: Object.fromEntries([...clocks].map(([n, c]) => [n, { ...c }])),
    queues: Object.fromEntries([...queues].map(([n, r]) => [n, { clock: r.clock, valve: r.valve, tauLast: r.tauLast, kApply: r.kApply, q: r.q.map(e => ({ ...e })) }])) });
  const restore = (s) => { if (!s) return;
    c0 = s.c0 ?? c0; rate = s.rate ?? rate;
    if (s.clocks) for (const [n, c] of Object.entries(s.clocks)) clocks.set(n, { ...c });
    if (s.queues) for (const [n, r] of Object.entries(s.queues)) queues.set(n, { clock: r.clock ?? null, valve: r.valve ?? 4, tauLast: r.tauLast ?? 0, kApply: r.kApply ?? 0, q: (r.q ?? []).map(e => ({ ...e })) }); };
  const reset = () => { clocks.clear(); queues.clear(); };
  // Cross-peer diff instrument (the solH/KPULL method as a kernel citizen): hash the ENTIRE kernel state —
  // two peers printing hash() at matching shared steps must match, or the fork is in this layer.
  const hash = () => { const s = JSON.stringify(save()); let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0'); };
  const status = () => ({ c0, rate,
    clocks: Object.fromEntries([...clocks].map(([n, c]) => [n, { tau: c.tau, beats: c.beats, L: c.lprev, kp: c.kp, flat: c.flat, wd: c.watchdogK }])),
    queues: Object.fromEntries([...queues].map(([n, r]) => [n, { len: r.q.length, head: r.q[0]?.startStep ?? null, kApply: r.kApply, clock: r.clock }])) });

  return { stamp, registerClock, beat, advance, tauOf, beatsOf, watchdog, resetClocks, makeQueue, makeCadence, reanchor, setEpoch, save, restore, reset, hash, status,
    get clock0() { return c0; }, get rate() { return rate; } };
};

// App factories (which don't import modules) reach the kernel through the global.
if (typeof globalThis !== 'undefined') globalThis.KWETau = makeTauKernel;
