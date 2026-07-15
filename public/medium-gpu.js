// ════════════════════════════════════════════════════════════════════════════════════════════════
//  MEDIUM GPU — the medium arc's SOLITON ENGINE, EXTRACTED (doc/proper-time-metric.md §13; the ladder
//  rung after medium-core.js). medium-core.js extracted the deterministic LAWS (τ wiring, lens algebra,
//  observer bank, step clock, coupling store, verb tables, beat providers). This module extracts the
//  GPU SOLITON ENGINE: the living-soliton FIELD STATE + the leaf physics helpers that advance it + the
//  engine's snapshot slice. It wraps an IFSGpu handle (passed as a GETTER — the real handle is created
//  async, after this object exists).
//
//  THE BOUNDARY (the C4 precedent, held exactly): "the laws moved, the physics ORCHESTRATION did not."
//  The engine owns the field state and the LEAF helpers (muxVirtualStep, selfClkTick, applyKick,
//  rebuildAtt, …) — each a bounded fn of (its args, engine state, gpu). It does NOT own the drive*
//  ORCHESTRATION (driveSolitonTransport/driveObjOrbit/…): those are ~850-line closures reading ~30
//  tuning consts + the reflector node, and they STAY in medium.js, now calling into this handle. The
//  thin demo (apps/medium-u1.js) drives the SAME engine — that is why it is extracted, not copied.
//
//  STAGES (each an authority switch, verified before the next — see the plan):
//    G1  ✓ the engine STATE object (makeSolitonEngine — this file; medium.js renames _x → _E.x).
//    G2  ⋯ the LEAF PHYSICS HELPERS + a stepSoliton primitive move here behind a ctx contract.
//    G3  ⋯ saveEngine()/restoreEngine() — the engine's snapshot slice (f32/{__f64} discipline).
//  The kernel boundary holds: this engine knows THAT a soliton lives on a clocked substrate — the
//  DRIVE (why it moves: transport vs orbit vs recall) stays medium-side.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// makeSolitonEngine — the living-soliton FIELD STATE as ONE owned object (G1). `gpu` is a GETTER
// (() => _gpu) because the IFSGpu handle is created asynchronously in medium.js AFTER this exists;
// leaf helpers (G2) read it late via E.gpu(). Every field below is verbatim from medium.js's engine
// state block (lines ~750-792 + _lockNow/_lockMin/_muxStepped/_ringCache/_frameBar), same initial
// values — this is the C2-style one-object relocation, no logic change.
//
//  psiSource     living SOURCE soliton (canvas-1, ψ_in — the object through the world-clock kernel)
//  psiLensed     the living driven WORLD soliton (canvas-2, ψ_out = source through the lens; the eye's input)
//  psiRecon      the living eye-recon soliton (driven toward the reconstruction)
//  psiC          a second persistent soliton held live at C by the instanton drive (the ψ_C witness)
//  localObjField the source object field the source soliton is driven toward
//  kernelVer     last-applied ring-kernel version   ·   ringCache  last-set IFS ring kernel
//  shiftSeen     last-consumed shift SEQ cursor (monotonic)
//  monDir/monClock   clock direction · n.time·_MON_RATE = the deterministic step phase (peer-identical)
//  solSteps/solInit  accumulated EXECUTED step count (matter proper time) · once-only anchor flag
//  kwSteps       W's proper-time step counter (the channel machinery clocks in kW)
//  snapVer/snapPending/snapClock0   last applied medSnapVer · toggle re-anchor flag · shared step-clock origin
//  readyFrames/snapConsumed   frames past the readiness gates · join-snapshot-applied-or-grace-expired flag
//  muxStepped    per-slot proper-time render tally (reset each frame; gates per-slot repaint)
//  lockNow/lockMin   minLock telemetry: ampCorr(ψ, att) — the living-transport observable
//  frameBar      the current bar (set each frame)
export function makeSolitonEngine({ gpu, GRID, N_CELLS, DT, stepsPerPhase = 19 } = {}) {
  const E = {
    gpu,                         // the IFSGpu handle GETTER: E.gpu() → the live handle (null until ready)
    GRID, N_CELLS, DT, stepsPerPhase,
    // ── the living-soliton fields ──
    localObjField: null, psiSource: null, psiLensed: null, psiRecon: null, psiC: null,
    kernelVer: -1, ringCache: null,
    // ── clocks + step counters (the deterministic engine phase) ──
    shiftSeen: 0, monDir: 1, monClock: 0, solSteps: 0, solInit: false, kwSteps: 0,
    // ── join / snapshot cursors ──
    snapVer: 0, snapPending: false, snapClock0: 0, readyFrames: 0, snapConsumed: false,
    // ── render/telemetry gates ──
    muxStepped: [0, 0, 0, 0], lockNow: 0, lockMin: 1, frameBar: 0,
  };

  // ── PURE FIELD-MATH LEAVES (G2) — args-only, no app scope; verbatim from medium.js (deps audit: ZERO app deps).
  //    These are the soliton SUBSTRATE primitives every app shares; the mux/leash ORCHESTRATION stays app-side (C4).
  const G = GRID;

  // applyKick — add an amplitude kick to a Float64 field IN PLACE; returns it. sig → defect width. shape (optional) =
  // a TARGET field the kick is SHAPED toward (energy added in that pattern — carries the field toward its basin);
  // without shape, a centered Gaussian spike (the plain transient). (medium.js _applyKick, verbatim.)
  E.applyKick = (f, amp, sig, shape = null) => { if (!f) return f; const c = G >> 1, N = f.length >> 1;
    if (shape) { let sm = 0; for (let i = 0; i < N; i++) { const a = Math.hypot(shape[i * 2], shape[i * 2 + 1]); if (a > sm) sm = a; } sm = sm || 1;
      for (let i = 0; i < N; i++) { f[i * 2] += amp * shape[i * 2] / sm; f[i * 2 + 1] += amp * shape[i * 2 + 1] / sm; } return f; }
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r2 = (x - c) ** 2 + (y - c) ** 2, a = amp * Math.exp(-r2 / (2 * sig * sig)); f[(y * G + x) * 2] += a; }
    return f; };

  // applyPhaseImpulse — multiply ψ by e^{i·w·dphi}, w a Gaussian envelope: a localized phase impulse (soliton-preserving,
  // no amplitude added — the phase-label instanton's write). (medium.js _applyPhaseImpulse, verbatim.)
  E.applyPhaseImpulse = (f, dphi) => { if (!f) return f; const c = G >> 1, sig2 = (G * 0.25) ** 2;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r2 = (x - c) ** 2 + (y - c) ** 2, w = Math.exp(-r2 / (2 * sig2)), p = w * dphi, co = Math.cos(p), sn = Math.sin(p), i = (y * G + x) * 2, vr = f[i], vi = f[i + 1]; f[i] = vr * co - vi * sn; f[i + 1] = vr * sn + vi * co; }
    return f; };

  // rollField — torus-translate a field by (sx, sy) integer cells: an EXACT deterministic wavefront translation (the
  // field-space analog of makeProbeField at a moving center). Returns a new field. (medium.js _rollField, verbatim.)
  E.rollField = (f, sx, sy) => { const out = new Float64Array(f.length);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const xs = ((x - sx) % G + G) % G, ys = ((y - sy) % G + G) % G;
      const si = (ys * G + xs) * 2, di = (y * G + x) * 2; out[di] = f[si]; out[di + 1] = f[si + 1]; }
    return out; };

  // stepSoliton — the SUBSTRATE STEP the drives repeat: n × [ stepEyeN(dispersion) + applyEyeNlSpm(saturable focusing)
  //   + applyEyeEnergyCap(renorm to e0) ], operating on the GPU eye buffer (the caller loaded it). e0 ≤ 0 skips the cap.
  //   This is the soliton's own physics; WHERE it runs (which slot, which att) is the app's orchestration. Not the drive
  //   loop itself (that reads the app's ~30 consts) — just the inner recipe, so both apps share ONE soliton step.
  E.stepSoliton = ({ gamma, isat, e0 = 0, steps = 1, dt = DT } = {}) => { const g = E.gpu(); if (!g) return;
    for (let s = 0; s < steps; s++) { g.stepEyeN(1, dt); g.applyEyeNlSpm(-gamma, isat, dt); if (e0 > 0) g.applyEyeEnergyCap(e0); } };

  // ── THE ENGINE SNAPSHOT CODEC (G3) — for the thin demo's join channel (apps/medium-u1.js). medium.js's own
  //    ~50-key cross-cutting snapshot is UNCHANGED and does NOT route through this (its fragile _snapPending
  //    arm/cancel ordering stays medium-side, by decision). This codec is the ENGINE slice only: the live field
  //    + the deterministic step/clock counters. It returns/consumes a PLAIN object with the ψ as a typed array —
  //    the `{__f64}` framework wrapper (and its reviver) is the APP's boundary concern, applied per-field exactly
  //    as medium.js does; the engine does not own that convention (it is shared by every medSnap payload).
  //
  //  saveEngine({ stepClkC0, torbE0, transPx, transPy }) — the three app-OWNED-but-engine-SERIALIZED scalars are
  //    passed IN (the app owns _stepClk / _torbE0 / the ease position; the engine only ships them alongside its ψ).
  //    Returns { psiLensed, solSteps, kwSteps, shiftSeen, stepClkC0, torbE0, transPx, transPy } — psiLensed is a
  //    fresh Float64Array copy (caller wraps it {__f64} for the wire); scalars verbatim.
  E.saveEngine = ({ stepClkC0 = 0, torbE0 = 1, transPx = 0, transPy = 0 } = {}) => ({
    // f32-quantize ψ ("GPU truth"): the leader reads the field back from the f32 GPU texture, so a joiner must start from
    // the SAME f32 values or its first step diverges. Float32Array.from does the round-trip (the original's discipline).
    psiLensed: E.psiLensed ? Float64Array.from(Float32Array.from(E.psiLensed)) : null,
    solSteps: E.solSteps, kwSteps: E.kwSteps, shiftSeen: E.shiftSeen,
    stepClkC0, torbE0, transPx, transPy,
  });

  //  restoreEngine(s, { setStepClkC0, setTorbE0, setTransP }) — writes the engine slice back VERBATIM (matching
  //    medium.js's restore at 2098-2109: field slice, solInit/snapConsumed set, solSteps/kwSteps/shiftSeen), and
  //    hands the app-owned scalars to the caller's setters so the APP still owns _stepClk / _torbE0 / ease AND the
  //    _snapPending arm/cancel ordering around them. Returns true if a field was restored (else the caller att-seeds).
  E.restoreEngine = (s, { setStepClkC0, setTorbE0, setTransP } = {}) => {
    if (!s || !s.psiLensed || s.psiLensed.length !== 2 * E.N_CELLS) return false;
    E.psiLensed = Float64Array.from(s.psiLensed);
    E.solInit = true; E.snapConsumed = true;                          // snapshot restored → self-seed no longer needed/allowed
    E.solSteps = s.solSteps | 0;
    E.kwSteps = (typeof s.kwSteps === 'number') ? (s.kwSteps | 0) : (s.solSteps | 0);
    E.shiftSeen = (typeof s.shiftSeen === 'number') ? s.shiftSeen : E.shiftSeen;
    if (setStepClkC0 && typeof s.stepClkC0 === 'number') setStepClkC0(s.stepClkC0);   // the app writes _stepClk.c0 (+ cancels its own _snapPending, in its own order)
    if (setTorbE0) setTorbE0((typeof s.torbE0 === 'number') ? s.torbE0 : 1);
    if (setTransP) setTransP((typeof s.transPx === 'number') ? s.transPx : 0, (typeof s.transPy === 'number') ? s.transPy : 0);
    return true;
  };

  return E;
}
