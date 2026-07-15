// medium-gpu.test.mjs — extraction stage G (doc/proper-time-metric.md §13): the GPU soliton ENGINE.
// The GPU drive itself needs WebGL/WebGPU (browser-only), so this covers what CAN run headless: the
// PURE FIELD-MATH LEAVES (applyKick/applyPhaseImpulse/rollField — moved verbatim from medium.js, the
// determinism-critical field ops), the stepSoliton recipe contract (against a call-recording stub gpu),
// and the engine STATE object's shape. Run: node test/medium-gpu.test.mjs.
import { makeSolitonEngine } from '../public/medium-gpu.js';

let ok = true; const chk = (n, c) => { if (!c) { ok = false; console.log(`FAIL ${n}`); } else console.log(`  ok  ${n}`); };
const GRID = 16, N_CELLS = GRID * GRID, DT = 0.1;
const mk = (gpu = null) => makeSolitonEngine({ gpu: () => gpu, GRID, N_CELLS, DT, stepsPerPhase: 19 });
const field = (fn) => { const f = new Float64Array(N_CELLS * 2); for (let i = 0; i < N_CELLS; i++) { const [re, im] = fn(i % GRID, (i / GRID) | 0); f[i * 2] = re; f[i * 2 + 1] = im; } return f; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── the STATE object ──────────────────────────────────────────────────────────────────────────────
{
  const E = mk();
  chk('engine state: fields start null', E.psiSource === null && E.psiLensed === null && E.psiRecon === null && E.psiC === null && E.localObjField === null);
  chk('engine state: clocks/cursors at their medium.js initial values', E.monDir === 1 && E.monClock === 0 && E.solSteps === 0 && E.solInit === false && E.kwSteps === 0 && E.kernelVer === -1 && E.shiftSeen === 0);
  chk('engine state: join cursors + telemetry gates', E.snapVer === 0 && E.snapPending === false && E.snapClock0 === 0 && E.readyFrames === 0 && E.snapConsumed === false && E.lockNow === 0 && E.lockMin === 1 && E.frameBar === 0 && E.muxStepped.length === 4);
  chk('engine carries its config', E.GRID === GRID && E.N_CELLS === N_CELLS && E.DT === DT && E.stepsPerPhase === 19);
  chk('gpu is a getter (null until ready)', typeof E.gpu === 'function' && E.gpu() === null);
}

// ── applyKick (centered spike) ──────────────────────────────────────────────────────────────────────
{
  const E = mk();
  const f = new Float64Array(N_CELLS * 2);
  const out = E.applyKick(f, 1.0, 3.0);
  chk('applyKick returns the same buffer (in place)', out === f);
  const c = (GRID >> 1); const ci = (c * GRID + c) * 2;
  chk('applyKick centered spike peaks at the center, real only', f[ci] > 0.9 && f[ci + 1] === 0);
  chk('applyKick is symmetric about center', Math.abs(f[((c) * GRID + (c - 2)) * 2] - f[((c) * GRID + (c + 2)) * 2]) < 1e-12);
  // determinism: two identical kicks are byte-identical
  const g = new Float64Array(N_CELLS * 2); E.applyKick(g, 1.0, 3.0);
  chk('applyKick deterministic', same(f, g));
  chk('applyKick(null) is a no-op returning null', E.applyKick(null, 1, 3) === null);
}

// ── applyKick (shaped toward a target) ────────────────────────────────────────────────────────────
{
  const E = mk();
  const shape = field((x, y) => [x === 3 && y === 3 ? 2 : 0, 0]);   // a single bright cell (peak amp 2)
  const f = new Float64Array(N_CELLS * 2);
  E.applyKick(f, 0.5, 3.0, shape);
  const j = (3 * GRID + 3) * 2;
  chk('shaped kick deposits amp·shape/peak at the shape peak', Math.abs(f[j] - 0.5 * 2 / 2) < 1e-12);   // = 0.5
  chk('shaped kick leaves non-shape cells untouched', f[(5 * GRID + 5) * 2] === 0);
}

// ── applyPhaseImpulse (soliton-preserving, |ψ| unchanged) ───────────────────────────────────────────
{
  const E = mk();
  const f = field((x, y) => { const r = 0.3 + 0.1 * x; const th = 0.02 * y; return [r * Math.cos(th), r * Math.sin(th)]; });
  const mag0 = f.map((_, i) => i % 2 === 0 ? Math.hypot(f[i], f[i + 1]) : 0);
  const out = E.applyPhaseImpulse(f, 0.7);
  chk('applyPhaseImpulse returns the buffer in place', out === f);
  let magOk = true; for (let i = 0; i < N_CELLS; i++) { if (Math.abs(Math.hypot(f[i * 2], f[i * 2 + 1]) - mag0[i * 2]) > 1e-12) magOk = false; }
  chk('applyPhaseImpulse preserves |ψ| everywhere (phase-only)', magOk);
  // at the center the Gaussian envelope w≈1, so the phase rotates by ~dphi vs a fresh copy of the same field
  const f2 = field((x, y) => { const r = 0.3 + 0.1 * x; const th = 0.02 * y; return [r * Math.cos(th), r * Math.sin(th)]; });
  const c = GRID >> 1, ci = (c * GRID + c) * 2;
  const th0 = Math.atan2(f2[ci + 1], f2[ci]), th1 = Math.atan2(f[ci + 1], f[ci]);
  chk('applyPhaseImpulse rotates the center by ~dphi (envelope≈1 at center)', Math.abs(((th1 - th0) - 0.7 + Math.PI) % (2 * Math.PI) - Math.PI) < 1e-3);
}

// ── rollField (exact torus translation) ─────────────────────────────────────────────────────────────
{
  const E = mk();
  const f = field((x, y) => [x * 10 + y, 0]);                        // a unique value per cell (re = x*10+y)
  const r = E.rollField(f, 3, 0);                                    // roll +3 in x
  chk('rollField returns a NEW buffer', r !== f && r.length === f.length);
  chk('rollField(+3,0): out[x] = in[x-3 mod G]', r[(0 * GRID + 3) * 2] === f[(0 * GRID + 0) * 2] && r[(0 * GRID + 0) * 2] === f[(0 * GRID + (GRID - 3)) * 2]);
  const back = E.rollField(r, -3, 0);
  chk('rollField is invertible (roll then unroll = identity)', same(back, f));
  const r2 = E.rollField(f, 3, 0);
  chk('rollField deterministic', same(r, r2));
}

// ── stepSoliton (the substrate-step recipe: stepEyeN + applyEyeNlSpm + applyEyeEnergyCap) ────────────
{
  const calls = [];
  const stub = {
    stepEyeN: (n, dt) => calls.push(['stepEyeN', n, dt]),
    applyEyeNlSpm: (g, isat, dt) => calls.push(['applyEyeNlSpm', g, isat, dt]),
    applyEyeEnergyCap: (e0) => calls.push(['applyEyeEnergyCap', e0]),
  };
  const E = mk(stub);
  E.stepSoliton({ gamma: 20, isat: 1, e0: 1.5, steps: 2, dt: DT });
  const order = calls.map((c) => c[0]).join(',');
  chk('stepSoliton runs `steps` iterations of the 3-call recipe in order',
    order === 'stepEyeN,applyEyeNlSpm,applyEyeEnergyCap,stepEyeN,applyEyeNlSpm,applyEyeEnergyCap');
  chk('stepSoliton passes NEGATIVE gamma (GLSL −g → focusing) + isat + dt', calls[1][1] === -20 && calls[1][2] === 1 && calls[1][3] === DT);
  chk('stepSoliton always steps dt=1 count per iter', calls[0][1] === 1 && calls[0][2] === DT);
  // e0 <= 0 skips the cap
  calls.length = 0; E.stepSoliton({ gamma: 20, isat: 1, e0: 0, steps: 1 });
  chk('stepSoliton with e0<=0 skips the energy cap', calls.length === 2 && !calls.some((c) => c[0] === 'applyEyeEnergyCap'));
  // no gpu → silent no-op
  const E2 = mk(null);
  chk('stepSoliton with no gpu is a silent no-op', E2.stepSoliton({ gamma: 1, isat: 1, steps: 3 }) === undefined);
}

// ── saveEngine / restoreEngine (the thin demo's join codec — the engine slice, plain object) ────────
{
  const E = mk();
  // populate the engine slice with a distinctive state. saveEngine f32-quantizes ψ ("GPU truth" — the leader reads the
  // field from the f32 texture, so a joiner must start from the SAME f32 values), so compare against the f32 round-trip.
  E.psiLensed = field((x, y) => [x * 0.01 - 0.5, y * 0.01]);
  const f32 = Float64Array.from(Float32Array.from(E.psiLensed));   // the f32-quantized expectation
  E.solSteps = 4321; E.kwSteps = 2100; E.shiftSeen = 17;
  const s = E.saveEngine({ stepClkC0: 12.5, torbE0: 0.87, transPx: 3.25, transPy: -4.75 });
  chk('saveEngine returns a fresh f32-quantized copy of psiLensed (GPU truth)', s.psiLensed instanceof Float64Array && s.psiLensed !== E.psiLensed && same(s.psiLensed, f32));
  chk('saveEngine carries the deterministic counters', s.solSteps === 4321 && s.kwSteps === 2100 && s.shiftSeen === 17);
  chk('saveEngine ships the app-owned scalars passed in', s.stepClkC0 === 12.5 && s.torbE0 === 0.87 && s.transPx === 3.25 && s.transPy === -4.75);
  chk('saveEngine does NOT {__f64}-wrap (that is the app boundary)', !('__f64' in s) && !(s.psiLensed && s.psiLensed.__f64));

  // restore into a FRESH engine and confirm byte-identity + app-setter routing
  const E2 = mk();
  let gotC0 = null, gotE0 = null, gotP = null;
  const okR = E2.restoreEngine(s, { setStepClkC0: (v) => { gotC0 = v; }, setTorbE0: (v) => { gotE0 = v; }, setTransP: (x, y) => { gotP = [x, y]; } });
  chk('restoreEngine returns true on a valid slice', okR === true);
  chk('restoreEngine restores psiLensed byte-identical to the f32 slice (fresh copy)', E2.psiLensed instanceof Float64Array && E2.psiLensed !== s.psiLensed && same(E2.psiLensed, f32));
  chk('restoreEngine restores counters verbatim', E2.solSteps === 4321 && E2.kwSteps === 2100 && E2.shiftSeen === 17);
  chk('restoreEngine sets solInit + snapConsumed (self-seed suppressed)', E2.solInit === true && E2.snapConsumed === true);
  chk('restoreEngine routes app-owned scalars to the caller setters (app keeps _stepClk/_snapPending order)', gotC0 === 12.5 && gotE0 === 0.87 && JSON.stringify(gotP) === '[3.25,-4.75]');

  // guards
  chk('restoreEngine returns false on null / wrong-length field (caller att-seeds)', E2.restoreEngine(null) === false && E2.restoreEngine({ psiLensed: new Float64Array(4) }) === false);
  chk('kwSteps falls back to solSteps for a pre-kW slice', (() => { const E3 = mk(); E3.restoreEngine({ psiLensed: field(() => [0, 0]), solSteps: 99 }); return E3.kwSteps === 99; })());
  // FULL round-trip determinism: save → restore → save again = identical slice
  const s2 = E2.saveEngine({ stepClkC0: 12.5, torbE0: 0.87, transPx: 3.25, transPy: -4.75 });
  chk('save→restore→save round-trip is byte-identical', same(s.psiLensed, s2.psiLensed) && s.solSteps === s2.solSteps && s.kwSteps === s2.kwSteps && s.shiftSeen === s2.shiftSeen);
}

console.log(ok ? '\nALL PASS (medium-gpu engine: state + pure leaves + stepSoliton recipe + snapshot codec)' : '\nFAILURES ABOVE');
process.exit(ok ? 0 : 1);
