/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ════════════════════════════════════════════════════════════════════════════════════════════════
//  OBSERVERS — the THIN meta-circular medium (the u-register arc as a clean demo; doc §12).
//  ------------------------------------------------------------------------------------------------
//  medium.js is the full laboratory (5k lines of layered arcs). THIS app is the extraction ladder's
//  payoff: it IMPORTS every LAW — the τ kernel (worldline clocks), the observer bank (descriptors),
//  the lens algebra (compose/link/chain/apply), the step clock (§7.44 matter proper-time), the verb
//  wire schema, the settings-verb table, the coupling store (the capture law) — NB: the mux two-clock
//  step-slicing is GONE (registers are homogeneous full-rate; differential aging is τ-clock-side, below),
//  the chain meter — and, since step 2a of the U1-engine extraction, THE REGISTER ENGINE ITSELF
//  (makeRegisterEngine, now in medium-core): observers steps its 16×16 slots through the SAME abstract-holography law as
//  medium-u1 — the gate-D spectral linear step (lap9 + a small static IFS ring) → saturable SPM →
//  energy cap → f32 grain. It is no longer a hand-rolled 4-point Schrödinger toy: it is a genuine
//  (tiny) holographic medium, a thin app on the shared engine. Still no GPU (the engine is CPU-pure).
//
//  THE HEADLINE (the futureTau generalization made visible): the BEAT SOURCE IS PLUGGABLE, per slot —
//    · 'ripple' — a miniature lock-ripple detector on the slot's own toy field (matter beats);
//    · 'rhythm' — a metronome in the slot's own proper steps (the MUSICAL beat).
//  Both feed the SAME τ kernel: the kernel knows THAT a worldline has a clock, never WHY it ticks.
//  With per-slot TEMPO as a verb, differential aging needs no journeys: two observers at different
//  tempos + lensTau(ω) = the twin experiment on a metronome. THIS is why the mux's 1/nSl slowing was
//  redundant and could be removed (the mux unification): aging was ALWAYS a per-worldline τ-RATE here,
//  never a step-ration — the clocks tick at their own tempo/ω on the shared full-rate step grid. Read
//  by the register (chainRead pred/mdl,
//  [RECALL-∠] plate stamps).
//
//  DETERMINISM (the purest form): the world program holds ONLY (time, verb log) — a peer's whole
//  engine state is a pure function of the shared clock and the verb history, so a JOINER simply
//  replays the log from k=0 (no snapshot machinery; the log is capped at 512 verbs — a demo budget).
//  All state mutates at kernel-stamped shared steps; the status line prints kH + a W-field hash so
//  two peers byte-check at a glance. Conventions vs medium.js: every slot uses the W-convention
//  (phase absorbs its own precession; prec ≡ 0) since every slot rebuilds its att from a base — the
//  uniform total angle is just op.phase. The metric/tilt sector stays READ-SIDE (views + meters).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { makeTauKernel } from '../kwe-tau.js';
import { lensU1 } from '../soliton-algebra.js';
import { makeObserverBank, normalizeVirtEvent, applySettingsVerb, makeStepClock, makeCouplingStore, chainMeter, makeRippleClock, wrap2pi, bankAge, kuramotoStep, makeRegisterReadout,
  makeRegisterEngine, makeHologramBank } from '../medium-core.js';   // one import from the consolidated core: laws + kuramotoStep (XY phase, A+) + makeRegisterReadout (regPhase telemetry) + the register ENGINE (observers steps its 16² slots through the shared gate-D+ring law — a thin app on the U1 medium) + the HOLOGRAM bank (identity leg = raw-field recall + dual-layer aging). muxClocks dropped (homogeneous full-rate).

const REFLECTOR_MS = 50;
const TICK_S = REFLECTOR_MS / 1000;   // wallTime counts reflector PULSES, not ms (live-caught: /1000 ran the engine 50× slow — step=19 after a minute, zero beats ever)
const G = 16, N = G * G;             // the toy grid
const SPP = 19;                      // steps per shared time-unit (second) — the §7.44 budget
const BETA = 0.055, CDISP = 0.28;    // pin gain per proper step · dispersion strength (CDISP now unused: the engine's λ-grid step supplies dispersion; kept for the record)
const DT = 0.12, SOL_GAMMA = 20, SOL_ISAT = 1;   // the engine's step constants (matches medium-u1: gate-D linear step + saturable SPM)
const PIN_FAC = BETA / 0.15;         // the engine pins by 0.15·bfac; map observers' historical BETA through bfac so the pin strength is preserved
const KQ = 7;                        // coupling boundary (every 7th global step, the medium's Q law)
const SLOTN = ['W', 'V', 'P1', 'P2'];
// ── observers' IFS ring kernel (STATIC — no fractal clock here; a single small ring makes observers a genuine
//    holographic medium, not just a lap9 toy). The engine reduces to lap9 when rings are empty; one ring of
//    radius 3 (8 axis+diagonal offsets, weight split) gives it real ring dispersion. kernelVer is constant (1).
const _OBS_RING = (() => { const r = 3, off = [];
  for (let a = 0; a < 8; a++) { const th = a * Math.PI / 4; off.push(Math.round(r * Math.cos(th)), Math.round(r * Math.sin(th))); }
  return { r: [r], w: [0.5], o: [Float64Array.from(off)] }; })();

// ── the world program: time + the verb log, nothing else ─────────────────────────────────────────
const observersWorldProgram = `
  const W = Renkon.app.W;
  const reflector = Events.receiver();
  const med = Behaviors.collect(
    { time: 0, seq: 0, log: [], started: false },
    reflector,
    (state, pulse) => {
      let st = { ...state, time: pulse.wallTime ?? state.time };
      if (pulse?._isEvent && pulse?._eventPayload?.type === 'obsVerb') {
        st = { ...st, _queue: [{ fireAt: pulse.wallTime, msg: 'verb', payload: pulse._eventPayload }, ...(st._queue ?? [])], _nextAt: pulse.wallTime };
      }
      return W.reduce(st, pulse, 'med', {
        __macro: (s, p, ctx) => { if (s.started) return s; ctx.future(1, '_keepalive', {}); return { ...s, started: true }; },
        _keepalive: (s, p, ctx) => { ctx.future(1, '_keepalive', {}); return s; },
        verb: (s, p, ctx) => {
          if (p.mode === 'checkpoint' && p.snap && typeof p.snap.k === 'number') {   // the event-sourcing CHECKPOINT: park the engine state, PRUNE the log behind it
            const sq = p.snap.seq | 0;                                               // (live peers ignore snap entirely — their engines already hold this state; only a JOINER restores from it)
            return { ...s, snap: p.snap, log: (s.log ?? []).filter((x) => (x.seq | 0) > sq) };
          }
          const MODES = ['record','recvia','aphase','aphaseset','lenstau','lensset','refamp','viaphi','lensview','store','recall','boot','kill','edge','tempo','beatmode'];
          const mode = MODES.includes(p.mode) ? p.mode : 'record';
          const cl = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
          const e = { seq: (s.seq|0) + 1, time: s.time, mode,
            amp: (mode === 'tempo') ? Math.round(cl(p.amp, 8, 200, 40)) : (mode === 'beatmode') ? cl(p.amp, 0, 1, 0)
               : (mode === 'lenstau') ? cl(p.amp, -0.5, 0.5, 0) : (mode === 'refamp') ? cl(p.amp, 0, 3, 1) : cl(p.amp, -Math.PI, Math.PI, 0),
            src: (p.src === 'V' || p.src === 'P1' || p.src === 'P2') ? p.src : 'W',
            slot: cl(p.slot, 0, 3, 0)|0, gx: cl(p.gx, 0, 3, 0)|0, gy: cl(p.gy, 0, 3, 0)|0, leak: cl(p.leak, -0.5, 0.5, 0),
            ...(mode === 'lensset' ? { kx: cl(p.kx, -1, 1, 0), ky: cl(p.ky, -1, 1, 0), rot: cl(p.rot, -Math.PI, Math.PI, 0), scl: cl(p.scl, 0.25, 4, 1), tx: cl(p.tx, -8, 8, 0), ty: cl(p.ty, -8, 8, 0) } : {}) };
          if ((s.log?.length ?? 0) >= 512) return s;   // demo budget — total-replay determinism needs the WHOLE history
          return { ...s, seq: e.seq, log: [...(s.log ?? []), e] };
        },
      });
    }
  );
  const _isStable = W.stable([med], reflector);
  const _export = W.export(Renkon, { med }, _isStable);
`;

function makeObserversScripts(avatarScript) { return [observersWorldProgram, avatarScript]; }

// ── the physics toy (all CPU, all deterministic; float ops in fixed order) ───────────────────────
const mkField = () => new Float64Array(N * 2);
const bump = (f, cx, cy, sg, amp, ph0) => { const c = Math.cos(ph0), s = Math.sin(ph0);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r2 = (x - cx) ** 2 + (y - cy) ** 2, a = amp * Math.exp(-r2 / (2 * sg * sg)), j = (y * G + x) * 2;
    f[j] += a * c; f[j + 1] += a * s; } };
const mkAtt = () => { const f = mkField(); bump(f, 5, 8, 2.0, 1.0, 0); bump(f, 11, 7, 1.4, 0.7, 1.2); return f; };   // asymmetric (metric rot visible)
const energy = (f) => { let e = 0; for (let i = 0; i < f.length; i++) e += f[i] * f[i]; return e; };
const capTo = (f, e0) => { const e = energy(f); if (e > e0 && e > 0) { const s = Math.sqrt(e0 / e); for (let i = 0; i < f.length; i++) f[i] *= s; } };
const corrAbs = (a, b) => { let re = 0, im = 0, ea = 0, eb = 0;
  for (let i = 0; i < N; i++) { const ar = a[i*2], ai = a[i*2+1], br = b[i*2], bi = b[i*2+1];
    re += ar * br + ai * bi; im += ar * bi - ai * br; ea += ar*ar + ai*ai; eb += br*br + bi*bi; }
  return (ea && eb) ? Math.hypot(re, im) / Math.sqrt(ea * eb) : 0; };
// wrap2pi now imported from medium-core (one definition; [0,2π) register-aging wrap)
const hashF = (f) => { let h = 0x811c9dc5; const q = new Float32Array(f);
  const b = new Uint8Array(q.buffer); for (let i = 0; i < b.length; i++) { h ^= b[i]; h = (h * 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

function makeObserversRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    // ── THE ENGINE (pure fn of shared time + verb log; every law imported) ──
    const bank = makeObserverBank(4), ops = bank.ops;
    const dials = { viaPhi: 0.5, lensView: false };
    const K = makeCouplingStore();
    const clk = makeStepClock({ stepsPerPhase: SPP });
    const tauK = makeTauKernel({ monRate: 1, stepsPerPhase: SPP, flatL: 21 });
    const q = tauK.makeQueue('virt', { clock: null });
    const fields = [null, null, null, null], attBase = [null, null, null, null], attEff = [null, null, null, null], attPh = [0, 0, 0, 0];
    const E0 = [1, 1, 1, 1], kp = [0, 0, 0, 0];
    const beatMode = ['ripple', 'ripple', 'ripple', 'ripple'], tempo = [40, 40, 40, 40];
    const ripple = SLOTN.map(() => makeRippleClock({ ema: 32, refractory: 21 }));   // the ripple beat source — one kernel provider per slot (was a hand-rolled EMA/up-crossing/refractory; now imported LAW)
    // ── THE HOLOGRAM BANK (shared core): observers' memory now uses the SAME abstract bank as medium-u1 — but with
    //    the IDENTITY leg (no propagation: a phase-only medium's plate is the raw field, recall is plain correlation).
    //    The dual-layer aging readout (field Δφ vs descriptor Σω) comes free. plates = the bank's array (same ref).
    const _holo = makeHologramBank({ G, bankMax: 4, corr: corrAbs, beatsOf: (nm) => (tauK.beatsOf(nm) ?? 0) });   // identity leg (default) — raw-field recall
    const plates = _holo.plates;                                         // { p, a(live), dop, pos, obj, w0, bw, k } — observer-stamped memory
    const scratch = mkField();
    let k = 0, seen = 0, booted = false, halted = false, lag = 0;
    // ── THE SHARED REGISTER ENGINE (step 2a): observers now steps its slots through medium-u1's engine — the
    //    gate-D spectral linear step (lap9 + the _OBS_RING IFS ring) → saturable SPM → energy cap → f32 grain,
    //    identical law to medium-u1. Per-slot ENGINE VIEWS alias descBase↔fields[i], so the app's fields[]/verbs/
    //    snapshot/render are untouched; only the step math changed (from the hand-rolled 4-point toy). The engine
    //    reads app state through getters: lensOp = ops (the register), edge = K.edge (the same Kuramoto coupling).
    const engSlots = SLOTN.map((nm, i) => ({
      get desc() { return true; }, get descLive() { return !!fields[i]; },
      get descBase() { return fields[i]; }, set descBase(v) { fields[i] = v; },
      get descE0() { return E0[i]; }, get descAtt() { return attEff[i]; },
      _eng: null, _engE: 0,
    }));
    const _reg = makeRegisterEngine({
      GRID: G, DT, N_CELLS: N, gamma: SOL_GAMMA, isat: SOL_ISAT,
      ringCache: () => _OBS_RING, kernelVer: () => 1,
      lensOp: (i) => ops[i], slots: () => engSlots, edge: () => K.edge,
      linearMode: () => 0, linLeak: () => 0.1,
      shardRing: () => _OBS_RING, wSlot: () => engSlots[0],
    });
    // ── THE CHECKPOINT (event-sourcing graduation): a full engine snapshot, f64-EXACT — JSON round-trips doubles
    //    exactly, and live peers keep evolving in f64, so a quantized joiner would fork (the medium's f32-parity
    //    lesson inverted: here NOTHING is quantized, so nothing may be rounded). tauK.save() carries the pending
    //    verb queues, so stamps survive the log prune (the kv-fork lesson: ship EVERYTHING the state depends on).
    //    Verification is built in: a restored joiner's wH must match the live peers at equal step — the same
    //    at-a-glance byte-check as always.
    const takeSnap = () => ({ k, seq: seen,
      clk: { c0: clk.c0, rate: clk.rate, ratePrev: clk.ratePrev },
      tauK: tauK.save(), bank: bank.save(), dials: { ...dials },
      K: { edge: K.edge ? K.edge.map((r) => [...r]) : null, capPh: K.capPh, capStep: K.capStep, src: K.src.map((s) => s ? Array.from(s) : null) },
      fields: fields.map((f) => f ? Array.from(f) : null), attBase: attBase.map((f) => f ? Array.from(f) : null),
      E0: [...E0], kp: [...kp], beatMode: [...beatMode], tempo: [...tempo], ripple: ripple.map((r) => r.save()),
      plates: _holo.save().map((raw, i) => ({ ...raw, a: plates[i].a ? Array.from(plates[i].a) : null })) });   // bank owns the plate shape; observers ALSO ships `a` (it has no probe model to regenerate it)
    const restoreSnap = (s) => {
      k = s.k | 0; seen = s.seq | 0;
      clk.c0 = s.clk?.c0 ?? 0; clk.rate = s.clk?.rate ?? 1; clk.ratePrev = s.clk?.ratePrev ?? 1;
      if (s.tauK) tauK.restore(s.tauK);
      bank.restore(s.bank); Object.assign(dials, s.dials || {});
      K.edge = s.K?.edge ? s.K.edge.map((r) => [...r]) : null; K.capPh = s.K?.capPh ?? -1; K.capStep = s.K?.capStep ?? -1;
      for (let i = 0; i < 4; i++) K.src[i] = s.K?.src?.[i] ? Float64Array.from(s.K.src[i]) : null;
      for (let i = 0; i < 4; i++) { fields[i] = s.fields?.[i] ? Float64Array.from(s.fields[i]) : null;
        attBase[i] = s.attBase?.[i] ? Float64Array.from(s.attBase[i]) : null; attEff[i] = null; attPh[i] = NaN;   // attEff rebuilt lazily from base + descriptor phase
        E0[i] = s.E0?.[i] ?? 1; kp[i] = s.kp?.[i] ?? 0; beatMode[i] = s.beatMode?.[i] ?? 'ripple'; tempo[i] = s.tempo?.[i] ?? 40;
        ripple[i].restore(s.ripple?.[i]); }
      _holo.restore(s.plates);   // the bank rebuilds the plate shape (default deserialize: Float64Array.from)
      (s.plates || []).forEach((raw, i) => { if (plates[i]) plates[i].a = raw.a ? Float64Array.from(raw.a) : null; });   // observers' `a` rides the snapshot (no probe model to regenerate)
      booted = true;
      console.log(`[OBS] restored from checkpoint @ step=${k} seq=${seen} — replaying only the log since (verify: wH must match live peers at equal step)`); };
    const rebuildAtt = (i) => { if (!attBase[i]) { attEff[i] = null; return; }
      if (!attEff[i] || attPh[i] !== ops[i].phase) { attEff[i] = lensU1.apply({ mode: 'id', phase: ops[i].phase, beta: 1, omega: 0, prec: 0 }, attBase[i]); attPh[i] = ops[i].phase; } };
    // reanchor: REMOVED the nSl rate-flip. With homogeneous full-rate registers the world clock runs at a FIXED rate
    // (slot count no longer throttles it — that WAS the mux's 1/nSl slowing). Kept as a no-op hook so the call sites
    // and snapshot stay structurally identical; differential aging is now purely τ-clock-side (tempo/ω per slot).
    const reanchor = (_kk) => {};
    const seed = () => { attBase[0] = mkAtt(); fields[0] = attBase[0].slice(); E0[0] = energy(fields[0]); rebuildAtt(0); booted = true; };
    const stepSlot = (i, kk) => { let f = fields[i]; if (!f) return;
      rebuildAtt(i);
      const a = attEff[i];
      // ── THE ENGINE STEP (was: hand-rolled pin + 4-point ∇² + cap). One call runs the SHARED law: pin superpose
      //    (bfac = PIN_FAC·β, preserving observers' historical pin strength through the engine's 0.15·bfac) →
      //    gate-D spectral step (lap9 + the IFS ring) → saturable SPM → energy cap at E0[i] → f32 grain. The
      //    engine reassigns descBase (our setter writes fields[i]); re-read f for the coupling below.
      _reg.step(engSlots[i], a, PIN_FAC * (ops[i].beta || 1));
      f = fields[i];
      if ((kk + 1) % KQ === 0 && K.edge) { const row = K.edge[i];        // M-e coupling at the shared Q boundary, from the CAPTURED slice-end sources
        for (let jj = 0; jj < 4; jj++) { const kap = row[jj]; if (!kap || jj === i || !K.src[jj]) continue;
          const s = K.src[jj]; for (let m = 0; m < f.length; m++) f[m] += kap * s[m]; }
        capTo(f, E0[i]); }                                              // re-cap after the coupling injection (the engine capped pre-coupling)
      kp[i]++;
      // ── THE PLUGGABLE BEAT (the demo's headline): rhythm = metronome in proper steps · ripple = lock-ripple detector.
      //    Both feed the SAME kernel — it knows THAT this worldline has a clock, never WHY it ticks.
      let beat = false;
      if (beatMode[i] === 'rhythm') beat = kp[i] % tempo[i] === 0;
      else if (a) beat = ripple[i].feed(corrAbs(f, a), kp[i]);            // the ripple provider: ℓ = field⊗att coherence → the kernel decides the beat
      bankAge(ops, i, tauK, SLOTN[i], kp[i], kk, beat); };   // the shared register-aging step (stamp clock + precess on own beat; W-convention)
    const appVerb = (vq, kk) => {                                        // the thin app's own optics table (the medium keeps its own — physics is the app's)
      if (vq.mode === 'aphase') { const SNI = { W: 0, V: 1, P1: 2, P2: 3 }, si = SNI[vq.src] ?? 0;
        if (fields[si]) { ops[si].phase = wrap2pi(ops[si].phase + (vq.amp || 0)); console.log(`[OBS] aphase ${SLOTN[si]} += ${(vq.amp || 0).toFixed(3)} → ∠${ops[si].phase.toFixed(3)} atStep=${kk}`); } }
      else if (vq.mode === 'aphaseset') { const SNI = { W: 0, V: 1, P1: 2, P2: 3 }, si = SNI[vq.src] ?? 0;   // ABSOLUTE per-slot ∠ (the φ slider — a knob, not a ratchet)
        if (fields[si]) { ops[si].phase = wrap2pi(vq.amp || 0); console.log(`[OBS] ∠set ${SLOTN[si]} → ∠${ops[si].phase.toFixed(3)} atStep=${kk}`); } }
      else if (vq.mode === 'boot') { const pl = plates[vq.slot | 0]; const si = fields[2] ? 3 : 2;
        if (pl && !fields[si]) { fields[si] = pl.p.slice(); attBase[si] = pl.a.slice(); E0[si] = energy(fields[si]); Object.assign(ops[si], lensU1.id()); attPh[si] = 0; attEff[si] = null; kp[si] = 0;
          console.log(`[OBS] boot plate ${vq.slot|0} → ${SLOTN[si]} atStep=${kk}`); } }
      else if (vq.mode === 'kill') { const si = fields[3] ? 3 : fields[2] ? 2 : -1;
        if (si > 0) { fields[si] = attBase[si] = attEff[si] = null; Object.assign(ops[si], lensU1.id()); console.log(`[OBS] kill ${SLOTN[si]} atStep=${kk}`); } }
      else if (vq.mode === 'store') { if (fields[0]) {   // the hologram bank owns the plate (identity leg → p = the raw field)
        const pl = _holo.store(fields[0], ops[0], { k: kk }); pl.a = attBase[0].slice();   // live-only att attached after store
        console.log(`[OBS] store — plate ${plates.length}/4 banked (frame ∠${lensU1.angle(ops[0]).toFixed(3)}, bw=${pl.bw}) atStep=${kk}`); } }
      else if (vq.mode === 'recall') { if (plates.length && fields[0]) {
        const bd = _holo.bind(fields[0]); const { plate: pl, index: best, corr: bc } = bd;   // content-address by overlap
        fields[1] = _holo.lift(pl); attBase[1] = pl.a.slice(); E0[1] = energy(fields[1]); Object.assign(ops[1], lensU1.id()); attPh[1] = 0; attEff[1] = null; kp[1] = 0;   // identity leg → lift = a copy of the raw plate
        const ag = _holo.agingReadout(pl, bd.cueLeg, ops[0], { name: 'W' });   // the shared dual-layer [RECALL-∠] readout
        console.log(`[OBS] recall → plate ${best + 1} (cue⊗=${bc.toFixed(3)}) lifted into V atStep=${kk}`);
        console.log(`[RECALL-∠] plate frame ∠=${lensU1.angle(pl.dop).toFixed(3)} vs W now ∠=${lensU1.angle(ops[0]).toFixed(3)} → observer shift Δ=${ag.dDesc.toFixed(3)} rad · Δτ_W=${ag.dTau} beats${ag.dOmegaTau != null ? ` → ω·Δτ=${ag.dOmegaTau.toFixed(3)} predicted` : ''}${ag.eqErr != null ? ` · |field−equation|=${ag.eqErr.toFixed(3)} ${ag.agree ? '✓' : '✗'}` : ''}`); } }
      else if (vq.mode === 'edge') { const ea = vq.gx | 0, eb = vq.gy | 0, ek = vq.leak || 0;
        if (!K.setEdge(ea, eb, ek)) console.log('[OBS] edge: self-coupling ignored');
        else console.log(`[OBS] edge κ(${SLOTN[ea]},${SLOTN[eb]}) = ${ek} atStep=${kk} (capture law: fresh sources at the next coarse-clock change)`); }
      else if (vq.mode === 'tempo') { const SNI = { W: 0, V: 1, P1: 2, P2: 3 }, si = SNI[vq.src] ?? 0; tempo[si] = vq.amp || 40;
        console.log(`[OBS] tempo ${SLOTN[si]} = ${tempo[si]} proper steps/beat atStep=${kk} — the musical dial of proper time`); }
      else if (vq.mode === 'beatmode') { const SNI = { W: 0, V: 1, P1: 2, P2: 3 }, si = SNI[vq.src] ?? 0; beatMode[si] = (vq.amp >= 0.5) ? 'rhythm' : 'ripple';
        console.log(`[OBS] beat source ${SLOTN[si]} = ${beatMode[si]} atStep=${kk} — the kernel never knows why a worldline ticks`); }
      else { const phi = (vq.mode === 'recvia') ? (vq.amp || 0) : 0;      // record / recvia: V born as W's copy (THROUGH the lens for recvia)
        if (!fields[0]) return;
        const rv = { mode: 'id', phase: phi, beta: 1, omega: 0, prec: 0 };
        fields[1] = phi ? lensU1.apply(rv, fields[0]) : fields[0].slice();
        attBase[1] = phi ? lensU1.apply(rv, attBase[0]) : attBase[0].slice();
        E0[1] = energy(fields[1]); Object.assign(ops[1], lensU1.id()); ops[1].phase = wrap2pi(phi); ops[1].omega = ops[0].omega; attPh[1] = NaN; attEff[1] = null; kp[1] = 0;
        console.log(`[OBS] ${phi ? `recorded V THROUGH lens φ=${phi.toFixed(3)}` : 'recorded V'} atStep=${kk}`); } };
    const chainSlots = () => SLOTN.map((nm, i) => ({ name: nm, field: fields[i], op: ops[i] })).filter((s) => s.field);
    const advance = (time) => { if (!booted) { const m0 = world.getNodeState('med'); if (m0?.snap) restoreSnap(m0.snap); else seed(); }
      if (tauK.rate !== clk.rate || tauK.clock0 !== clk.c0) tauK.setEpoch(clk.c0, clk.rate);
      const med = world.getNodeState('med'); if (!med) return;
      if ((med.seq | 0) > seen) { for (const e of (med.log || [])) if ((e.seq | 0) > seen) { const n = normalizeVirtEvent(e); n.t = (e.time || 0) * TICK_S; q.push(n); } seen = med.seq | 0; }   // verb stamps ride the SAME clock scale as the target (pulse ticks → seconds)
      lag = Math.max(0, clk.target(time * TICK_S) - k);                // replay/catch-up depth for the status line
      if (halted) return;                                                // a thrown engine must SAY so once, not freeze silently
      let done = 0;                                                       // the cap bounds THIS FRAME'S work (4000 steps), not a frozen goalpost
      try { while (done < 4000) {
        const tgt = clk.target(time * TICK_S);                           // recomputed EVERY step — a mid-replay rate flip (record/boot/kill) moves the goalpost; the stale-target loop OVERSHOT by ~(chunk·Δrate/rate) steps and then FROZE until wall time caught up (live-caught: joiner static frames, sim-confirmed leader k=237 vs joiner k=380)
        if (k >= tgt) break;
        q.drain(k, (vq) => { if (!applySettingsVerb(vq, k, ops, dials)) appVerb(vq, k); });
        // ── HOMOGENEOUS REGISTERS (the mux unification): every live slot has its OWN field array (no shared buffer to
        //    time-share), so ALL of them step every shared k at FULL rate — no 1/nSl slowing, no owner-of-k mux. This
        //    matches medium-u1's ⌀PDE drive (independent descBase per slot). DIFFERENTIAL AGING survives WITHOUT the
        //    mux: it now lives ENTIRELY in each worldline's τ-clock (tempo/ω per slot) — two observers age differently
        //    because their PROPER clocks tick at different rates PER STEP (§7.44 as a rate, not a step-ration). Coupling
        //    capture rides a fixed Q cadence (slot-count-independent), not the mux's nSl coarse phase.
        const capPh = Math.floor(k / KQ);   // the coupling-source cadence (every KQ steps) — replaces muxClocks' nSl-dependent capPh
        if (K.shouldCapture(capPh)) K.capture([fields[0], fields[1], fields[2], fields[3]], k, capPh);   // canonical stores ARE the fields — the capture law verbatim, no GPU park needed
        for (let i = 0; i < 4; i++) if (fields[i]) stepSlot(i, k);       // every born worldline advances at k (homogeneous, full-rate)
        // A+: THE PHASE-KURAMOTO — edges couple the register PHASES too (the shared kuramotoStep law), at the SAME Q
        // boundary as the field coupling, over ALL slots at once (read-all-then-write → determinism: a pure fn of the
        // shared step + register). This runs ALONGSIDE the field coupling in stepSlot (edges nudge both phase & matter,
        // as in medium-u1). θ = the bare register angle (observers' W-convention: phase absorbs precession).
        if (K.edge && ((k + 1) % KQ) === 0) { const { dth, any } = kuramotoStep(ops.map((o) => o.phase), K.edge, { born: fields.map((f) => !!f) });
          if (any) for (let i = 0; i < 4; i++) if (dth[i]) ops[i].phase = wrap2pi(ops[i].phase + dth[i]); }
        k++; done++; } } catch (err) { halted = true; console.error(`[OBS] ENGINE HALTED at step=${k} — every frame from here would re-throw; state frozen for diagnosis:`, err); } };
    // ── console instruments (window.obs.*) ──
    const chainRead = () => { const c = chainSlots(); if (c.length < 2) return '[OBS] need ≥2 slots';
      const m = chainMeter(c); const out = { ...m, beats: SLOTN.map((nm) => tauK.beatsOf(nm) ?? 0), step: k };
      console.log(`[CHAIN] ${out.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis} pred ${l.pred} mdl ${l.mdl})`).join(' · ')} · ε=${out.defect} (alg ${out.algDefect}) · beatsS[${out.beats.join(',')}] step=${k}`); return out; };
    const chainSee = () => { const c = chainSlots(); if (c.length < 2) return '[OBS] need ≥2 slots';
      const m = chainMeter(c, { G, through: true }); const out = { ...m, beats: SLOTN.map((nm) => tauK.beatsOf(nm) ?? 0), step: k };
      console.log(`[CHAINSEE] ${out.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis})`).join(' · ')} · ε=${out.defect} · modes[${out.modes.join(',')}] step=${k}`); return out; };
    const lensOps = () => { const o = ops.map((l, i) => ({ slot: SLOTN[i], ...l, angle: +lensU1.angle(l).toFixed(4) }));
      console.log(`[LENSOPS] ${o.map((l) => `${l.slot}:{${l.mode} ∠${l.angle} β=${l.beta} ω=${l.omega}}`).join(' · ')} · step=${k}`); return o; };
    const inj = (p) => injectEvent?.({ type: 'obsVerb', ...p });
    // ── DETERMINISM INSTRUMENTS (step 2a verification: prove the engine migration kept observers a pure fn of
    //    (shared step, verb log)). Two complementary checks:
    //    • detHash() — ONE fingerprint over ALL determinism-relevant state (every slot's f32 field + register ops +
    //      the τ kernel + kp counters). Two peers call it at the SAME step and compare a SINGLE string: match = the
    //      migrated engine is byte-replicating; mismatch = a fork (and WHICH field, via the per-part hashes). This
    //      folds the old at-a-glance wH+kH check into one value that covers the whole engine, not just W.
    //    • selfCheck(n) — the timing-INDEPENDENT purity test: snapshot → run n steps → restore → run n steps again →
    //      assert identical detHash. Catches hidden nondeterminism (float-order drift, a stale λ-cache, buffer
    //      aliasing in the engine's ping-pong) WITHOUT needing a second peer or matched wall-clocks. This is the
    //      assertion that would have flagged the migration if the engine step were not pure.
    const _fieldHashes = () => fields.map((f) => f ? hashF(f) : '--------');
    const detHash = () => { const parts = [
        ..._fieldHashes(),                                             // the 4 slot fields (f32 bytes — the engine's grain)
        hashF(new Float64Array(ops.flatMap((o) => [o.phase, o.beta, o.omega, o.prec, o.kx || 0, o.ky || 0]))),  // the register
        tauK.hash(),                                                   // the worldline clocks (beats/τ/queues)
        hashF(new Float64Array(kp)),                                   // the per-slot proper-step counters
      ];
      let h = 0x811c9dc5; for (const p of parts) for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
      const H = h.toString(16).padStart(8, '0');
      console.log(`[DET] observers detHash=${H} @step=${k} — TWO PEERS at equal step MUST match (fields[${_fieldHashes().join(',')}] kH=${tauK.hash()})`); return { H, step: k, fields: _fieldHashes(), kH: tauK.hash() }; };
    const selfCheck = (n = 200) => { if (halted) return '[DET] engine halted — cannot self-check';
      const snap = takeSnap();
      const runN = () => { for (let s = 0; s < n; s++) { for (let i = 0; i < 4; i++) if (fields[i]) stepSlot(i, k);
        if (K.edge && ((k + 1) % KQ) === 0) { const { dth, any } = kuramotoStep(ops.map((o) => o.phase), K.edge, { born: fields.map((f) => !!f) }); if (any) for (let i = 0; i < 4; i++) if (dth[i]) ops[i].phase = wrap2pi(ops[i].phase + dth[i]); }
        k++; } return detHash().H; };   // mirror the live drive: all born slots per k + the phase-Kuramoto at the Q boundary (homogeneous, no mux)
      const h1 = runN(); restoreSnap(snap); const h2 = runN(); restoreSnap(snap);   // restore twice: leave state exactly as found
      const ok = h1 === h2;
      console.log(`[DET] selfCheck(${n}): ${ok ? '✓ PURE — the engine step is a deterministic fn of (step, state); the migration is sound' : '✗ FORK — nondeterminism in the engine step! h1=' + h1 + ' h2=' + h2}`);
      return { ok, h1, h2, n }; };
    const _rout = makeRegisterReadout({ tauK, names: SLOTN, op: (i) => ops[i], born: (i) => !!fields[i], step: () => k });   // the FULL register introspection (∠/ω/β/beats/τ/born per slot) — observers as a full-fidelity U1 demo
    globalThis.obs = { chainRead, chainSee, lensOps, detHash, selfCheck,
      regPhase: () => _rout.phase({ wH: fields[0] ? hashF(fields[0]) : null }),   // {beats,tau,step,kH} shared + observers' field hash
      rec: (phi = 0) => inj(phi ? { mode: 'recvia', amp: +phi } : { mode: 'record' }),
      aphase: (a = 0.1, slot = 'W') => inj({ mode: 'aphase', amp: +a, src: slot }),
      aphaseSet: (a = 0, slot = 'W') => inj({ mode: 'aphaseset', amp: +a, src: slot }),   // absolute ∠ (the per-slot φ knob)
      viaPhi: (a = 0.5) => inj({ mode: 'viaphi', amp: +a }),   // the global record-through-lens angle (feeds ⎙viaφ)
      lensTau: (w = 0.1, slot = null) => inj({ mode: 'lenstau', amp: +w, ...(slot ? { src: slot } : {}) }),   // per-slot ω when slot given; global when omitted
      lensSet: (slot = 'V', p = {}) => inj({ mode: 'lensset', src: slot, kx: +p.kx || 0, ky: +p.ky || 0, rot: +p.rot || 0, scl: (p.scl != null) ? +p.scl : 1, tx: +p.tx || 0, ty: +p.ty || 0 }),
      refAmp: (slot = 'V', m = 1) => inj({ mode: 'refamp', src: slot, amp: +m }),
      edge: (a = 0, b = 1, kk2 = -0.15) => inj({ mode: 'edge', gx: a | 0, gy: b | 0, leak: +kk2 }),
      store: () => inj({ mode: 'store' }), recall: () => inj({ mode: 'recall' }),
      boot: (n = 0) => inj({ mode: 'boot', slot: n | 0 }), kill: () => inj({ mode: 'kill' }),
      tempo: (slot = 'V', n = 40) => inj({ mode: 'tempo', src: slot, amp: n }),
      beatMode: (slot = 'V', m = 'rhythm') => inj({ mode: 'beatmode', src: slot, amp: m === 'rhythm' ? 1 : 0 }),
      view: () => inj({ mode: 'lensview' }),
      checkpoint: () => { inj({ mode: 'checkpoint', snap: takeSnap() }); return `checkpoint @ step=${k} seq=${seen} stamped (log prunes behind it; joiners replay only since)`; } };
    // ── UI ──
    let els = null; const PX = 8;
    const mkUI = (root) => {
      root.innerHTML = `
        <div style="font-size:11px;font-weight:bold;color:#8df;margin-bottom:8px;letter-spacing:1px;">PEER ${peerId} · OBSERVERS — the thin meta-circular medium <span id="${containerId}-roster"></span></div>
        <div id="${containerId}-row" style="display:flex;gap:10px;"></div>
        <div id="${containerId}-bar" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:10px;color:#9cf;"></div>
        <div id="${containerId}-st" style="margin-top:6px;font-size:9px;color:#7a8;"></div>
        <div style="margin-top:4px;font-size:9px;color:#456;">console: obs.detHash() (two peers must match) · obs.selfCheck(200) (engine purity) · obs.chainRead() · obs.lensOps() · obs.regPhase() · obs.rec(φ) · obs.lensTau(ω) · obs.tempo('V',N) · obs.beatMode('V','rhythm') · obs.store()/recall() · obs.edge(a,b,κ)</div>`;
      const row = document.getElementById(`${containerId}-row`);   // getElementById, not querySelector — selo ids carry ':' (invalid in a #id selector, live-caught)
      const cvs = SLOTN.map((nm) => { const box = document.createElement('div'); box.style.textAlign = 'center';
        const c = document.createElement('canvas'); c.width = G; c.height = G;
        Object.assign(c.style, { width: `${G * PX}px`, height: `${G * PX}px`, imageRendering: 'pixelated', background: '#000', borderRadius: '4px', border: '1px solid #223' });
        const lab = document.createElement('div'); lab.style.cssText = 'font-size:9px;color:#8df;margin-top:2px;';
        box.appendChild(c); box.appendChild(lab); row.appendChild(box); return { c, lab, ctx: c.getContext('2d'), img: new ImageData(G, G) }; });
      const bar = document.getElementById(`${containerId}-bar`);
      const btn = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'font-size:10px;background:#122;color:#9cf;border:1px solid #345;border-radius:4px;padding:2px 8px;cursor:pointer;'; b.onclick = fn; bar.appendChild(b); return b; };
      // bar5 law: CHANGE injects the replicated verb; POSITION reflected from replicated state per frame
      const sld = (label, min, max, step, val, onchg) => { const w = document.createElement('span'); w.style.cssText = 'display:flex;gap:3px;align-items:center;';
        const l = document.createElement('span'); const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.style.width = '70px';
        const txt = (v) => { l.textContent = `${label} ${(+v).toFixed(2)}`; }; txt(val);
        i.addEventListener('input', () => txt(i.value));
        i.addEventListener('change', () => onchg(+i.value));
        w.appendChild(l); w.appendChild(i); bar.appendChild(w);
        return { input: i, set: (v) => { if (document.activeElement === i) return; if (+i.value !== +v) i.value = v; txt(v); } }; };
      let slot = 'V'; const sel = document.createElement('select'); sel.style.cssText = 'background:#122;color:#9cf;border:1px solid #345;font-size:10px;';
      for (const nm of SLOTN) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; sel.appendChild(o); } sel.value = 'V';
      sel.onchange = () => { slot = sel.value; }; bar.appendChild(sel);
      btn('⎙rec', () => globalThis.obs.rec(0)); btn('⎙viaφ', () => globalThis.obs.rec(dials.viaPhi));
      const sPhi = sld('φ', -3.14, 3.14, 0.05, 0, (v) => globalThis.obs.aphaseSet(v, slot));            // per-SLOT ∠ (the dropdown targets it; absolute set)
      const sOm = sld('ω', -0.5, 0.5, 0.01, 0, (v) => globalThis.obs.lensTau(v, slot));                 // per-SLOT ω (each observer ages at its own rate — the twin experiment)
      const sVia = sld('φ:rec', -3.14, 3.14, 0.05, 0.5, (v) => globalThis.obs.viaPhi(v));               // GLOBAL: the ⎙viaφ record-through-lens angle (not a register value)
      const sRot = sld('rot', -3.14, 3.14, 0.05, 0, (v) => globalThis.obs.lensSet(slot, { rot: v }));   // per-SLOT
      const sBeta = sld('β', 0, 3, 0.05, 1, (v) => globalThis.obs.refAmp(slot, v));
      const sTmp = sld('tempo', 8, 200, 1, 40, (v) => globalThis.obs.tempo(slot, v));
      btn('beat:src', () => globalThis.obs.beatMode(slot, beatMode[SLOTN.indexOf(slot)] === 'rhythm' ? 'ripple' : 'rhythm'));
      const lv = btn('view:raw', () => globalThis.obs.view());
      btn('store', () => globalThis.obs.store()); btn('recall', () => globalThis.obs.recall());
      btn('boot', () => globalThis.obs.boot(Math.max(0, plates.length - 1))); btn('kill', () => globalThis.obs.kill());
      btn('⎗ckpt', () => console.log(globalThis.obs.checkpoint()));
      return { cvs, lv, sPhi, sOm, sVia, sRot, sBeta, sTmp, slotSel: () => slot, st: document.getElementById(`${containerId}-st`), roster: document.getElementById(`${containerId}-roster`) };
    };
    const paint = () => { if (!els) return;
      for (let i = 0; i < 4; i++) { const { c, lab, ctx, img } = els.cvs[i]; const f0 = fields[i];
        if (!f0) { ctx.clearRect(0, 0, G, G); lab.textContent = `${SLOTN[i]} —`; continue; }
        const f = (dials.lensView && (lensU1.angle(ops[i]) || ops[i].mode !== 'id')) ? lensU1.apply(ops[i], f0, G) : f0;   // render THROUGH the readOp (the honest ∠lens view)
        let mx = 1e-9; for (let j = 0; j < N; j++) { const a2 = f[j*2]*f[j*2] + f[j*2+1]*f[j*2+1]; if (a2 > mx) mx = a2; }
        for (let j = 0; j < N; j++) { const re = f[j*2], im = f[j*2+1], a = Math.sqrt((re*re + im*im) / mx), th = Math.atan2(im, re);
          const h = (th + Math.PI) / (2 * Math.PI) * 6; const sect = Math.floor(h), fr = h - sect, v = Math.min(1, a * 1.2) * 255;
          const p2 = v * (1 - fr), q2 = v * fr; let r, g2, b;
          switch (sect % 6) { case 0: r = v; g2 = q2; b = 0; break; case 1: r = p2; g2 = v; b = 0; break; case 2: r = 0; g2 = v; b = q2; break;
            case 3: r = 0; g2 = p2; b = v; break; case 4: r = q2; g2 = 0; b = v; break; default: r = v; g2 = 0; b = p2; }
          img.data[j*4] = r; img.data[j*4+1] = g2; img.data[j*4+2] = b; img.data[j*4+3] = 255; }
        ctx.putImageData(img, 0, 0);
        lab.innerHTML = `${SLOTN[i]} ∠${lensU1.angle(ops[i]).toFixed(2)} τ${(tauK.tauOf(SLOTN[i]) ?? 0).toFixed(1)}${ops[i].beta !== 1 ? ` β${ops[i].beta}` : ''}${ops[i].mode !== 'id' ? ` ${ops[i].mode}` : ''}<br>${beatMode[i]}${beatMode[i] === 'rhythm' ? `·${tempo[i]}` : ''} b${tauK.beatsOf(SLOTN[i]) ?? 0}${ops[i].omega ? ` ω${ops[i].omega}` : ''}`; }
      const lvT = dials.lensView ? 'view:∠lens' : 'view:raw'; if (els.lv.textContent !== lvT) els.lv.textContent = lvT;
      const si2 = Math.max(0, SLOTN.indexOf(els.slotSel()));            // reflect replicated state onto the dials (bar5 law) — φ, ω, rot, β, tempo all follow the SELECTED slot
      els.sPhi.set(lensU1.wrap(ops[si2].phase)); els.sOm.set(ops[si2].omega); els.sVia.set(dials.viaPhi);   // φ/ω per-slot; φ:rec is the global via dial
      els.sRot.set(Math.atan2(ops[si2].A[2], ops[si2].A[0])); els.sBeta.set(ops[si2].beta); els.sTmp.set(tempo[si2]);
      const c = chainSlots(); const eps = c.length >= 2 ? chainMeter(c.map((s) => s)).defect : '—';
      els.st.textContent = `step=${k}${halted ? ' · ⚠ HALTED (see console error)' : lag > 100 ? ` · replaying (${lag} behind)` : ''} · kH=${tauK.hash()} · wH=${fields[0] ? hashF(fields[0]) : '—'} · ε=${eps} · plates=${plates.length}${K.edge ? ' · edges ON' : ''} — diff kH/wH across peers at equal step`;
      if (els.roster) els.roster.innerHTML = _clientBadge(world); };
    return () => {
      if (!world?.ps?.app) return;
      if (!document.getElementById('observers-wrap')) { const wrap = document.createElement('div'); wrap.id = 'observers-wrap';
        Object.assign(wrap.style, { display: 'flex', gap: '0', flexWrap: 'wrap' }); document.body.appendChild(wrap); }
      let root = document.getElementById(containerId);
      if (!root) { root = document.createElement('div'); root.id = containerId;
        Object.assign(root.style, { fontFamily: 'ui-monospace,monospace', padding: '16px', background: '#0d0d0d', color: '#eee', borderRadius: '10px', margin: '10px', border: '1px solid #222' });
        document.getElementById('observers-wrap').appendChild(root); els = mkUI(root);
        root.addEventListener('mousemove', (e) => { const rect = root.getBoundingClientRect(); const ro = _seloInfo(world);
          if (ro?.myId) sendCursorMove(world.id, ro.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height); }, { passive: true }); }
      const med = world.getNodeState('med');
      if (med) advance(med.time ?? 0);
      paint();
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Observers (thin medium)',
  selo:        'observers',
  reflectorMs: REFLECTOR_MS,
  metaOptions: {},
  makeScripts: (av) => makeObserversScripts(av),
  makeRenderer: makeObserversRenderer,
  wrapId:      'observers-wrap',
};
