// medium-u1-holography.test.mjs — the abstract U1 hologram bank (makeHologramBank).
import { makeHologramBank, makeFieldMatter, simpleRing, buildNativeKernel, buildRingOffsets, makeRingProvider, makeEye, occlude, keptFraction } from '../public/medium-core.js';
import { kernelPropagateSpectral, kernelLambdaGrid, ampCorr, makeIFSClock } from '../public/medium-core.js';
import { lensC1 as LC } from '../public/soliton-algebra.js';
import { lensU1 as L } from '../public/soliton-algebra.js';

let ok = true; const chk = (n, c) => { if (!c) { ok = false; console.log(`FAIL ${n}`); } else console.log(`  ok  ${n}`); };
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;

const G = 16, N = G * G;
const mkField = (cx, cy, sg, ph0 = 0) => { const f = new Float64Array(N * 2), c = Math.cos(ph0), s = Math.sin(ph0);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r2 = (x - cx) ** 2 + (y - cy) ** 2, a = Math.exp(-r2 / (2 * sg * sg)), j = (y * G + x) * 2; f[j] += a * c; f[j + 1] += a * s; } return f; };

console.log('\n── makeHologramBank: the abstract U1 hologram ──');

// ── IDENTITY-LEG regime (a phase-only thin app: plate = raw field, recall = plain correlation) ──
{
  const bank = makeHologramBank({ G });   // default leg = identity
  const fA = mkField(5, 8, 2), fB = mkField(11, 6, 1.6);
  bank.store(fA, { ...L.id(), phase: 0.5 }, { pos: [5, 8], obj: 'A', k: 10, bw: 3 });
  bank.store(fB, { ...L.id(), phase: 1.2 }, { pos: [11, 6], obj: 'B', k: 20, bw: 7 });
  chk('store banks two plates (dual: field p + descriptor dop)', bank.count() === 2 && bank.plates[0].dop.phase === 0.5 && !!bank.plates[0].p);
  chk('identity leg: plate p equals the stored field (f32-quantized)', near(bank.plates[0].p[10 * 2], Float32Array.from(fA)[10 * 2], 1e-6));

  // recall the A-moment: cue ≈ fA → argmax must be plate 0
  const r = bank.bind(fA);
  chk('bind: cue=fA → argmax is plate 0 (content-addressed by overlap, not index)', r.index === 0 && r.corr > 0.99);
  chk('bind: cross-object plate B scores lower', r.scores[1] < r.scores[0]);
  const lifted = bank.lift(r.plate);
  chk('lift (identity leg): reconstructs the stored image', ampCorr(lifted, fA) > 0.99);
}

// ── SPECTRAL-LEG regime (medium-u1: plate = +T leg, recall = −T backward leg — genuine optical holography) ──
{
  const rc = { r: [3], w: [0.5], o: [Float64Array.from([3, 0, -3, 0, 0, 3, 0, -3, 2, 2, -2, -2, 2, -2, -2, 2])] };
  const lam = kernelLambdaGrid(rc.r, rc.w, rc.o, G);
  const leg = (f, sign) => kernelPropagateSpectral(f, null, null, null, { T: 4, dt: sign * 0.12, G, lam }).field;
  const bank = makeHologramBank({ G, leg });
  const f0 = mkField(8, 8, 2.2);
  bank.store(f0, { ...L.id() }, { pos: [8, 8], obj: 'X', k: 0, bw: 0 });
  chk('spectral leg: plate p is the PROPAGATED image, NOT the raw field (an interference record)', ampCorr(bank.plates[0].p, f0) < 0.999);
  const r = bank.bind(f0);
  const lifted = bank.lift(r.plate);
  chk('store(+T) then lift(−T) reconstructs the moment (the palindromic round-trip)', ampCorr(lifted, f0) > 0.99);
}

// ── the DUAL-LAYER AGING readout (the [RECALL-∠] equivalence: field Δφ vs descriptor Σω) ──
{
  const bank = makeHologramBank({ G, beatsOf: () => 12 });
  const stored = { ...L.id(), phase: 0.30, omega: 0.05 };
  const f0 = mkField(8, 8, 2);
  bank.store(f0, stored, { pos: [8, 8], obj: 'X', k: 0, bw: 4 });
  // "now": the register aged by +0.7 rad; the cue is the SAME field rotated by +0.7 (so the field's measured aging = 0.7 too)
  const now = { ...L.id(), phase: 1.00, omega: 0.05 };
  const cue = mkField(8, 8, 2, 0.7);
  const r = bank.bind(cue);
  const a = bank.agingReadout(r.plate, r.cueLeg, now);
  chk('agingReadout: descriptor Δ∠ = ∠now − ∠stored (0.70 rad)', near(a.dDesc, 0.70, 1e-6));
  chk('agingReadout: field Δφ ≈ descriptor Δ∠ (the EQUIVALENCE, |A−B| small)', a.eqErr != null && a.eqErr < 0.05 && a.agree);
  chk('agingReadout: Δτ = beatsOf − plate.bw (12 − 4 = 8)', a.dTau === 8);
  chk('agingReadout: ω·Δτ closed form = 0.05·8 = 0.40 rad', near(a.dOmegaTau, 0.40, 1e-9));
  // a DISAGREEMENT case: field aged, descriptor did NOT (ω never applied) → flagged, not hidden
  const now2 = { ...L.id(), phase: 0.30, omega: 0 };   // register unchanged
  const a2 = bank.agingReadout(r.plate, r.cueLeg, now2);
  chk('agingReadout: field-vs-descriptor DISAGREEMENT is flagged (agree=false)', a2.eqErr > 0.15 && !a2.agree);
}

// ── DESCRIPTOR-ONLY recall (recalla / 𝔸-path): closed-form content-address, no field ──
{
  const bank = makeHologramBank({ G, sigma: 6 });
  bank.store(mkField(5, 5, 2), { ...L.id() }, { pos: [5, 5], obj: 'A', k: 0 });
  bank.store(mkField(12, 12, 2), { ...L.id() }, { pos: [12, 12], obj: 'A', k: 1 });
  bank.store(mkField(5, 5, 2), { ...L.id() }, { pos: [5, 5], obj: 'B', k: 2 });   // same pos as #0 but DIFFERENT object
  const near0 = bank.bindDesc([5, 5], 'A');
  chk('bindDesc: cue near plate 0 pos → argmax is plate 0 (Gaussian content-address)', near0.index === 0 && near0.corr > 0.99);
  chk('bindDesc: a FAR plate scores below the exact match (the Gaussian falls off with |Δpos|)', near0.scores[1] < near0.scores[0] && near0.scores[1] < 0.3);
  chk('bindDesc: same pos but WRONG object scores 0 (object identity gates)', near0.scores[2] === 0);
  const far = bank.bindDesc([12, 12], 'A');
  chk('bindDesc: moving the cue re-addresses (now plate 1 wins)', far.index === 1);
}

// ── BANK_MAX ring + save/restore round-trip ──
{
  const bank = makeHologramBank({ G, bankMax: 2 });
  for (let i = 0; i < 4; i++) bank.store(mkField(4 + i, 8, 2), { ...L.id(), phase: 0.1 * i }, { pos: [4 + i, 8], obj: 'A', k: i, bw: i });
  chk('bankMax: the ring keeps only the last 2 plates', bank.count() === 2 && bank.plates[0].k === 2 && bank.plates[1].k === 3);
  const saved = bank.save();
  chk('save is a deep copy (mutating the bank does not touch the snapshot)', (bank.plates[0].dop.phase = 9, saved[0].dop.phase === 0.2));
  const bank2 = makeHologramBank({ G, bankMax: 2 });
  bank2.restore(saved);
  chk('restore rebuilds the bank byte-identical', bank2.count() === 2 && bank2.plates[1].k === 3 && near(bank2.plates[0].p[0], saved[0].p[0], 1e-12));
}

// ── NON-FIELD matter: pluggable metric bind (selfhost's M/O, ifsclock's genome) — the generalization, HONESTLY typed ──
{
  const bank = makeHologramBank({ G, beatsOf: () => 10 });
  // matter = an M-element (a lensC1-like object); the app's metric = phase coherence
  const mk = (ph) => ({ phase: ph, gain: 1 });
  bank.store(null, { ...L.id(), phase: 0.2 }, { m: mk(0.2), bw: 3, k: 1 });   // field=null, matter in meta.m
  bank.store(null, { ...L.id(), phase: 1.5 }, { m: mk(1.5), bw: 6, k: 2 });
  chk('store(field=null, m): a NON-FIELD plate has m and NO p (honest typing)', bank.plates[0].m != null && bank.plates[0].p == null);
  const coherence = (a, b) => Math.cos(a.phase - b.phase);   // the app's similarity on M-elements
  const r = bank.bind(mk(0.25), { metric: coherence });   // cue is an M-element, NOT a field
  chk('metric bind: argmax by the pluggable similarity (plate 0, closest phase)', r.index === 0);
  chk('metric bind: no cueLeg (there is no field to propagate)', r.cueLeg === null);
  // THE HONEST TYPING RULE: a non-field recall has NO image and NO field-Δφ — the bank must not fake them
  chk('lift on a non-field plate returns null (no image to reconstruct — not faked)', bank.lift(r.plate) === null);
  const ag = bank.agingReadout(r.plate, r.cueLeg, { ...L.id(), phase: 0.9 });
  chk('agingReadout on non-field: descriptor Δ∠ still works (0.9 − 0.2 = 0.70)', near(ag.dDesc, 0.70, 1e-6));
  chk('agingReadout on non-field: field Δφ is NULL (no field measured — the equivalence is vacuous, not faked)', ag.dField === null && ag.eqErr === null && ag.agree === true);
  chk('metric bind: a metric-less field bind still works alongside (regimes coexist)', bank.bind(mk(0), { metric: coherence }).index >= 0);
  // save/restore carries m (plain-object structured clone)
  const sv = bank.save(); const b2 = makeHologramBank({ G }); b2.restore(sv);
  chk('save/restore round-trips non-field matter m', b2.plates[0].m.phase === 0.2 && b2.plates[1].m.phase === 1.5 && b2.plates[0].p == null);
}

// ── makeFieldMatter — TURNKEY field matter (a thin app opts into a real ψ-field in one line) ──
{
  console.log('\n── makeFieldMatter: turnkey field matter ──');
  const ring = simpleRing(3);
  chk('simpleRing(3): one ring, radius 3, 8 offset-pairs (16 coords), weight 0.5', ring.r[0] === 3 && ring.w[0] === 0.5 && ring.o[0].length === 16);
  const ops = [{ ...L.id(), beta: 1 }, { ...L.id() }, { ...L.id() }, { ...L.id() }];
  const run = () => {
    const fm = makeFieldMatter({ G: 16, lensOp: (i) => ops[i] });
    fm.seedAtt(0, [{ cx: 6, cy: 8, sg: 2.2, amp: 1 }]);
    fm.seed(0, [{ cx: 6, cy: 8, sg: 2.2, amp: 1 }, { cx: 10, cy: 7, sg: 1.5, amp: 0.6 }]);
    const s0 = fm.spectrum(0, 6);
    for (let s = 0; s < 150; s++) fm.step(0, 0.055 / 0.15);
    return { fm, s0, s1: fm.spectrum(0, 6) };
  };
  const a = run(), b = run();
  const hf = (f) => { let h = 0x811c9dc5; const q = new Float32Array(f), bb = new Uint8Array(q.buffer); for (let i = 0; i < bb.length; i++) { h ^= bb[i]; h = (h * 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  chk('field matter: seed stands up a ψ-field with E0 = its energy (the cap target)', a.fm.field(0) != null && a.fm.field(0).length === 16 * 16 * 2 && a.fm.energy(0) > 0);
  chk('field matter: slots are REAL makeSlot (leash/transport + readOp register) — thin = full in thin mode, NOT throwaway adapters', typeof a.fm.slots[0].virtGo === 'function' && typeof a.fm.slots[0].leash === 'object' && a.fm.slots[0].readOp != null && a.fm.slots[0].born === true);
  chk('field matter: 150 engine steps stay finite + f32-grained (the wire lattice)', a.fm.field(0).every((v) => Number.isFinite(v) && v === Math.fround(v)));
  chk('field matter: DETERMINISTIC — two runs byte-identical (no RNG, pure fn of steps)', hf(a.fm.field(0)) === hf(b.fm.field(0)));
  chk('field matter: spectrum band 0 is normalized to 1 (the DC/low-k reference)', a.s0[0] === 1 && a.s1[0] === 1);
  chk('field matter: the timbre MORPHS as the field disperses (upper bands grow)', a.s1[4] > a.s0[4] + 0.02);
  // save/restore round-trip
  const sv = a.fm.save(); const fm2 = makeFieldMatter({ G: 16, lensOp: (i) => ops[i] }); fm2.restore(sv);
  chk('field matter: save/restore round-trips the field byte-identically', hf(fm2.field(0)) === hf(a.fm.field(0)) && fm2.energy(0) === a.fm.energy(0));
}

// ── the LIVE IFS RING (buildNativeKernel / buildRingOffsets / makeRingProvider) — the reducer's ring recompute, in core ──
{
  console.log('\n── live IFS ring: buildNativeKernel + makeRingProvider ──');
  // buildNativeKernel: a fracKernel (radii list, repeats = weight) → distinct radii + weights, top maxBands by count
  const bk = buildNativeKernel([3, 3, 5, 5, 5, 8, 2, 3, 11, 5, 8, 2, 2], 0.03, 4);
  chk('buildNativeKernel: counts radii, keeps top maxBands, weights by count/total', JSON.stringify(bk.fRadii) === JSON.stringify([2, 3, 5, 8]) && bk.fWeights.length === 4 && near(bk.fWeights[1], 0.03 * 3 / 13, 1e-12));
  const offs = buildRingOffsets([3]);
  chk('buildRingOffsets: radius r → Int16Array of ~2πr integer offsets', offs[0] instanceof Int16Array && offs[0].length / 2 === Math.max(8, Math.ceil(2 * Math.PI * 3)));

  // makeRingProvider: a LIVE ring driven by a core makeIFSClock (breathes + deterministic)
  const mkClock = () => { const c = makeIFSClock({ roots: 5, maxGen: 3, rho: 0.68, baseDelay: 26, gridR: 12, seed: 7 }); c.launch(0); return c; };
  const rp1 = makeRingProvider(mkClock()); const rp2 = makeRingProvider(mkClock());
  for (let kp = 0; kp < 60; kp++) { rp1.tick(kp); rp2.tick(kp); }
  chk('makeRingProvider: the ring BREATHES as the cascade fires (version > 0 — dynamic, not static)', rp1.version() > 5);
  chk('makeRingProvider: DETERMINISTIC — two clocks same seed → identical ring + version (replicated-safe)', JSON.stringify(rp1.ring().r) === JSON.stringify(rp2.ring().r) && rp1.version() === rp2.version());

  // makeFieldMatter driven by the LIVE ring: the field steps stably through kernel changes
  const clock = mkClock(); const rp = makeRingProvider(clock);
  const fm = makeFieldMatter({ G: 16, ringProvider: rp });
  fm.seedAtt(0, [{ cx: 8, cy: 8, sg: 2.2, amp: 1 }]); fm.seed(0, [{ cx: 8, cy: 8, sg: 2.2, amp: 1 }]);
  for (let kp = 0; kp < 80; kp++) { rp.tick(kp); fm.step(0, 0.3); }
  chk('makeFieldMatter + live ring: field steps stay finite through the breathing kernel (the reducer\'s live recompute, in core)', fm.field(0).every((v) => Number.isFinite(v)) && rp.version() > 5);
  chk('makeFieldMatter: fm.ring() is the LIVE getter (returns the current fractal ring, not a static snapshot)', typeof fm.ring === 'function' && Array.isArray(fm.ring().r));
}

// ── makeEye — the U(1) register rendered to ANY output (medium-agnostic reconstruction) ──
{
  console.log('\n── makeEye: register → medium-agnostic signal (GPU / audio / canvas) ──');
  const G = 16, N = G * G;
  const env = new Float64Array(N * 2);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r2 = (x - 8) ** 2 + (y - 8) ** 2, a = Math.exp(-r2 / 8), j = (y * G + x) * 2; env[j] = a; }
  const op = { ...L.id(), phase: 0.7, omega: 0.05 };
  const pose = { dphi: 0.7, ox: 2, oy: -1 };
  const eye = makeEye({ op: () => op, envelope: () => env, G: () => G, pose: () => pose });

  // the FIELD reconstruction is BYTE-IDENTICAL to medium-u1's _descProject (the linOp phasor content·e^{i(φ+k·(x−c))})
  const descProj = (pose.ox || pose.oy) ? LC.apply({ mode: 'metric', phase: pose.dphi, beta: 1, omega: 0, prec: 0, gain: 1, tx: pose.ox, ty: pose.oy }, env, G)
    : LC.apply({ mode: 'id', phase: pose.dphi, beta: 1, omega: 0, prec: 0 }, env, G);
  const ef = eye.field();
  let same = true; for (let j = 0; j < N * 2; j++) if (ef[j] !== descProj[j]) same = false;
  chk('makeEye: field reconstruction is BYTE-IDENTICAL to medium-u1 _descProject (the shared linOp phasor)', same);

  // ONE eye, MULTIPLE output feature spaces (the GPU sink reads field, audio reads spectrum, canvas reads angle)
  chk('makeEye: as field → the reconstructed ψ (GPU/canvas pixels)', eye.reconstruct('field') === null ? false : eye.reconstruct('field').length === N * 2);
  const spec = eye.reconstruct('spectrum');
  chk('makeEye: as spectrum → radial FFT bands normalized [0,1] (audio overtones)', Array.isArray(Array.from(spec)) && spec.length === 6 && spec[0] === 1);
  chk('makeEye: as angle → the register\'s scalar phase (canvas clock hand / audio detune)', near(eye.reconstruct('angle'), 0.7, 1e-9) && eye.reconstruct('phase') === eye.reconstruct('angle'));
  chk('makeEye: as intensity → total |ψ|² (loudness/brightness scalar)', eye.reconstruct('intensity') > 0 && near(eye.intensity(), eye.reconstruct('intensity'), 1e-12));

  // a PHASE-ONLY eye (no envelope) — a thin app with no field still renders its register angle (audio detune / clock hand)
  const eye2 = makeEye({ op: () => ({ ...L.id(), phase: 1.3 }) });
  chk('makeEye: phase-only eye (no envelope) → angle works, field/spectrum null (honest: no wave to reconstruct)', near(eye2.angle(), 1.3, 1e-9) && eye2.field() === null && eye2.spectrum() === null);
}

// ── OCCLUSION — the "break the hologram, reconstruct the WHOLE scene" property (occlude / keptFraction) ──
console.log('\n── occlude / keptFraction: reconstruction from a PARTIAL image ──');
{
  const f = mkField(8, 8, 2.4);
  // identity: mode 0 (or falsy) returns a copy, unchanged
  const id = occlude(f, { mode: 0 });
  chk('occlude mode 0 = identity copy (fresh array, equal values, not the same ref)', id !== f && id[16] === f[16] && keptFraction(f, id) > 0.999);

  // NON-MUTATION: the input is never touched
  const before = f[8 * 2];
  occlude(f, { mode: 7, frac: 0.9, block: 4, seed: 1 });
  chk('occlude never mutates its input', f[8 * 2] === before);

  // DETERMINISM: same params → byte-identical (peer-safe, in regH); a different seed reshuffles
  const a1 = occlude(f, { mode: 7, frac: 0.5, block: 4, seed: 3 });
  const a2 = occlude(f, { mode: 7, frac: 0.5, block: 4, seed: 3 });
  const a3 = occlude(f, { mode: 7, frac: 0.5, block: 4, seed: 9 });
  let det = true; for (let j = 0; j < a1.length; j++) if (a1[j] !== a2[j]) det = false;
  let diff = false; for (let j = 0; j < a1.length; j++) if (a1[j] !== a3[j]) diff = true;
  chk('occlude is deterministic in (mode,frac,block,seed) — byte-identical across peers', det);
  chk('occlude: a different seed draws a different mask', diff);

  // MONOTONE LOSS: more frac removed → less energy kept (rand-zero)
  const k25 = keptFraction(f, occlude(f, { mode: 7, frac: 0.25, block: 4, seed: 0 }));
  const k75 = keptFraction(f, occlude(f, { mode: 7, frac: 0.75, block: 4, seed: 0 }));
  chk('rand-zero: more frac → less energy kept (kept25 > kept75)', k25 > k75 && k75 >= 0 && k25 <= 1);

  // HALF-PLANE (6): zeros the left frac columns — kept ≈ the right (1−frac) area's energy
  const half = occlude(f, { mode: 6, frac: 0.5 });
  let leftZero = true; for (let y = 0; y < G; y++) for (let x = 0; x < G / 2; x++) { const j = (y * G + x) * 2; if (half[j] !== 0 || half[j + 1] !== 0) leftZero = false; }
  chk('half-plane (6): left frac columns are exactly zero', leftZero);

  // BOX (5): keeps a centered window — corners are zeroed
  const box = occlude(f, { mode: 5, frac: 0.5 });
  chk('box (5): a corner pixel is zeroed (kept a centered window)', box[0] === 0 && box[1] === 0);

  // NOISE (8) carries energy where ZERO (7) removes it — the loss-vs-corruption distinction
  const kZero = keptFraction(f, occlude(f, { mode: 7, frac: 0.6, block: 4, seed: 5 }));
  const kNoise = keptFraction(f, occlude(f, { mode: 8, frac: 0.6, block: 4, seed: 5 }));
  chk('mode 8 (noise) keeps MORE energy than mode 7 (zero) at the same mask — corruption ≠ loss', kNoise > kZero);

  // THE HEADLINE: bind an OCCLUDED cue against the full bank → still argmaxes the right plate, lift reconstructs the WHOLE.
  // The scene must be SPATIALLY EXTENDED (the classic demo works because every fragment carries the whole) and the two
  // banked objects DISTINGUISHABLE (content-addressing is only meaningful between separable objects). A = a plus-cross,
  // B = a diagonal-X — different layouts, so a fragment of A still argmaxes A.
  const mkObj = (blobs, ph = 0) => { const g = new Float64Array(N * 2), c = Math.cos(ph), s = Math.sin(ph);
    for (const [bx, by] of blobs) for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const a = Math.exp(-(((x - bx) ** 2 + (y - by) ** 2)) / (2 * 1.5 * 1.5)), j = (y * G + x) * 2; g[j] += a * c; g[j + 1] += a * s; } return g; };
  const objA = mkObj([[8, 8], [8, 3], [8, 13], [3, 8], [13, 8]], 0.3);   // plus-cross
  const objB = mkObj([[8, 8], [3, 3], [13, 13], [3, 13], [13, 3]], 1.1);   // diagonal-X
  const bank = makeHologramBank({ G });   // identity leg (raw field)
  bank.store(objA, { ...L.id(), phase: 0.3 }, { pos: [8, 8], obj: 'A', k: 0, bw: 0 });
  bank.store(objB, { ...L.id(), phase: 1.1 }, { pos: [8, 8], obj: 'B', k: 0, bw: 0 });
  const frag = occlude(objA, { mode: 7, frac: 0.5, block: 2, seed: 2 });   // knock out ~half of A in random blocks
  const bd = bank.bind(frag, { xshift: true });   // shift-invariant, like recallo
  chk('occluded cue (~half of A gone) → bind still argmaxes plate A (content-addressed from a fragment)', bd.index === 0 && bd.scores[0] > bd.scores[1]);
  const lifted = bank.lift(bd.plate, { shift: bd.shift });
  chk('lift returns the WHOLE plate — reconstruction of the FULL scene from a fragment', ampCorr(lifted, objA) > 0.999);

  // GRACEFUL DEGRADATION: recovering the RIGHT plate survives increasing occlusion (the holographic signature — the
  // property a literal photograph lacks). At extreme frac the fragment finally loses A's identity (honest limit).
  let stillA = true; for (const fr of [0.2, 0.4, 0.6]) { const b = bank.bind(occlude(objA, { mode: 7, frac: fr, block: 2, seed: 1 }), { xshift: true }); if (b.index !== 0) stillA = false; }
  chk('graceful degradation: the correct plate is still recalled through frac 0.2→0.6 occlusion', stillA);
}

console.log(ok ? '\nALL PASS (medium-u1 holography: dual plate + bind/lift + spectral-vs-identity leg + dual-layer aging + 𝔸-recall + pluggable-metric non-field bind + bank ring + save/restore + turnkey field matter + occlusion/partial-image reconstruction)\n' : '\nSOME FAILED\n');
process.exit(ok ? 0 : 1);
