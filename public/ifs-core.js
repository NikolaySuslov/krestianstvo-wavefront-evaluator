// ════════════════════════════════════════════════════════════════════════════════════════════════
//  ifs-core.js — THE HUTCHINSON OPERATOR AS A KWE KERNEL CITIZEN
// ════════════════════════════════════════════════════════════════════════════════════════════════
//  A `makeTauKernel`-shaped factory (public/kwe-tau.js): a live, serializable object the app holds,
//  feeds at shared steps, and folds into its save()/restore()/hash() for byte-identical joins. It is
//  re-exported through krestianstvo-wavefront-evaluator.js beside makeTauKernel — one import surface.
//
//  WHY THIS EXISTS (and why it is NOT makeIfsClock): the evaluator's makeIfsClock and medium-core's
//  makeIFSClock are the CAUSAL / KLEENE face of IFS — an IFS whose maps are DELAY contraction ratios
//  that schedule WHEN beats fire on the `future` queue. Their fixpoint is a firing SCHEDULE, reached by
//  draining `future`; there is no compact set and no Hausdorff metric. This file is the OTHER face:
//  the BANACH set-attractor. The Hutchinson operator W(S) = ⋃ᵢ wᵢ(S) is a genuine metric contraction
//  on (compact sets, Hausdorff distance) whenever every wᵢ is a contraction (Lipschitz ρᵢ < 1); its
//  unique fixed point A = W(A) is the IFS attractor, attracting from ANY start. The two faces must NOT
//  be fused: one converges by causal well-foundedness (the frontier/τ gates), the other by ρ < 1.
//
//  WHAT THE APPS ACTUALLY DO (ifsclock.js, ahc-fractal.js): each firing deposits a ring at radius
//  GRID·gain where gain = ρ^depth is the ACCUMULATED lensC1 contraction, recursing by lensC1.compose(op,ρ)
//  (gains MULTIPLY under compose — that IS the Lipschitz composition). Those apps realize W the
//  STOCHASTIC / chaos-game way (fire one branch, deposit one point, recurse), whose intermediate states
//  depend on branch-firing order → a join fork source (finding: register-join-determinism). This kernel
//  gives the SETWISE W instead: W = ⋃ᵢ wᵢ commutes, so order stops mattering, AND it carries a proven
//  a-priori iteration bound() that replaces the app's magic `iters < N` safety guard with a certificate.
//
//  THREE GUARANTEES every consumer inherits (the payoff of moving off per-app chaos-game onto the kernel):
//    1. bound(tol) — a COMPUTED iteration count ⌈log(tol·(1−ρ)/d0)/log ρ⌉ from ρ_max, not a magic number.
//    2. order-independence — setwise W commutes; join-time firing order is no longer a fork source.
//    3. one hash() — the solH/KPULL cross-peer diff instrument, kernel-side (matches kwe-tau.hash()).
//
//  HONESTY BOUNDS (stated, not hidden):
//    • This is exact for SET-ATTRACTOR IFS only. Scheduling cascades (fractal TIME) stay on makeIfsClock.
//    • Setwise W is NOT byte-identical to the chaos-game realization's INTERMEDIATE states (same limit,
//      different path) — apps OPT IN; old chaos-game .kwe snapshots do not restore into this kernel.
//    • On GPU/f32, the Hausdorff convergence test can never fall below the f32 floor — use bound() (a
//      fixed proven count) rather than iterate()'s tolerance test in that path.
//
//  A "point set" here is a flat Float64Array of D-dim points ([x0,y0, x1,y1, …] for D=2). A map wᵢ is
//  an affine contraction { A: [row-major D×D], t: [D], rho: spectral-Lipschitz bound < 1 }. The ring-set
//  apps are the 1-D radial special case (D=1, A=[ρ], t=[0]); makeRadialIFS below builds exactly that.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// FNV-1a over doubles quantized to a 1e-9 grid — the exact-arithmetic tier hash (matches medium-core's
// hashNums contract: byte-identical across peers by construction; the quantize guards benign last-bit).
const _hashNums = (nums) => { let h = 0x811c9dc5;
  for (const v of nums) { const q = Math.round((Number.isFinite(v) ? v : 0) * 1e9);
    // hash the 32-bit halves of the (possibly >32-bit) quantized integer, low then high
    const lo = q | 0, hi = Math.floor(q / 0x100000000) | 0;
    for (const w of [lo, hi]) { let x = w >>> 0;
      for (let b = 0; b < 4; b++) { h ^= (x & 0xff); h = Math.imul(h, 0x01000193) >>> 0; x >>>= 8; } } }
  return (h >>> 0).toString(16).padStart(8, '0'); };

// Apply an affine map w = {A (D×D row-major), t (D)} to one D-vector (into `out` at offset o).
const _applyAffine = (w, p, off, D, out, o) => {
  for (let r = 0; r < D; r++) { let s = w.t[r] || 0;
    for (let c = 0; c < D; c++) s += (w.A[r * D + c] || 0) * p[off + c];
    out[o + r] = s; } };

// Hausdorff-like set distance between two point sets P, Q (flat, D-dim): max over P of min-to-Q, symmetrized.
// O(|P|·|Q|) — the sets are the SUPPORT of the attractor (deduplicated, bounded), not the field, so small.
const _hausdorff = (P, Q, D) => {
  const nP = P.length / D, nQ = Q.length / D;
  if (nP === 0 || nQ === 0) return Infinity;
  const oneWay = (X, Y, nX, nY) => { let worst = 0;
    for (let i = 0; i < nX; i++) { let best = Infinity;
      for (let j = 0; j < nY; j++) { let d = 0;
        for (let k = 0; k < D; k++) { const dk = X[i * D + k] - Y[j * D + k]; d += dk * dk; }
        if (d < best) best = d; }
      if (best > worst) worst = best; }
    return Math.sqrt(worst); };
  return Math.max(oneWay(P, Q, nP, nQ), oneWay(Q, P, nQ, nP)); };

// Dedup a flat point set on a quantization grid (keeps the support bounded across W iterations, and makes
// the hash order-independent). Deterministic: sort the quantized keys. `eps` is the merge grid.
const _dedup = (S, D, eps) => {
  const n = S.length / D, seen = new Map(), inv = 1 / eps;
  for (let i = 0; i < n; i++) { let key = '';
    for (let k = 0; k < D; k++) key += Math.round(S[i * D + k] * inv) + ',';
    if (!seen.has(key)) { const p = new Array(D); for (let k = 0; k < D; k++) p[k] = S[i * D + k]; seen.set(key, p); } }
  const keys = [...seen.keys()].sort();
  const out = new Float64Array(keys.length * D);
  keys.forEach((key, i) => { const p = seen.get(key); for (let k = 0; k < D; k++) out[i * D + k] = p[k]; });
  return out; };

// ── THE FACTORY ─────────────────────────────────────────────────────────────────────────────────
//  makeHutchinson({ maps, dim, dedupEps })
//    maps     — array of { A:[D*D], t:[D], rho:number<1 }. rho is each map's Lipschitz bound (spectral
//               norm of A, or the ℂ* gain for the radial case). Enforced < 1 at construction and setRho.
//    dim      — D (default inferred from the first map's t, else 1).
//    dedupEps — support merge grid (default 1e-9; keeps the attractor support finite + hash stable).
export const makeHutchinson = ({ maps = [], dim = null, dedupEps = 1e-9 } = {}) => {
  const D = dim ?? (maps[0]?.t?.length ?? 1);
  const RHO_CAP = 0.999999;   // hard contraction ceiling for LIVE dials (setRho) — a UI event can't break Banach.
  // Construction preserves a DECLARED ρ verbatim (including ρ≥1): an honestly non-contractive system must
  // report ∞ from bound(), not be silently coerced into contracting. Live dials clamp; declarations don't.
  const W = maps.map((w) => ({ A: [...(w.A ?? [1])], t: [...(w.t ?? [0])],
    rho: Math.max(0, w.rho ?? 1) }));

  const rhoMax = () => W.reduce((m, w) => Math.max(m, w.rho), 0);

  // W(S): the setwise Hutchinson step ⋃ᵢ wᵢ(S). Order-independent (union commutes); deduped so the
  // support stays bounded and the result is canonical (hashable, join-stable).
  const step = (S) => {
    const n = S.length / D, out = new Float64Array(n * W.length * D);
    let o = 0;
    for (const w of W) for (let i = 0; i < n; i++) { _applyAffine(w, S, i * D, D, out, o); o += D; }
    return _dedup(out, D, dedupEps); };

  // A-PRIORI iteration bound (the certificate that replaces `iters < magicN`). Banach:
  //   d(Wⁿ S₀, A) ≤ ρⁿ/(1−ρ) · d(S₀, W S₀).  Solve ρⁿ·d0/(1−ρ) ≤ tol for n.
  // d0 is measured from the actual seed (one W step) so the bound is tight, not worst-case-global.
  const bound = (S0, tol = 1e-6) => {
    const ρ = rhoMax(); if (ρ <= 0) return 1; if (ρ >= 1) return Infinity;   // ρ≥1: no contraction, no finite bound
    const d0 = _hausdorff(S0, step(S0), D);
    if (!(d0 > 0) || !Number.isFinite(d0)) return 1;
    const need = Math.log(tol * (1 - ρ) / d0) / Math.log(ρ);
    return Math.max(1, Math.ceil(need)); };

  // iterate: apply W until the Hausdorff step-delta ≤ tol (metric convergence), capped by the COMPUTED
  // bound (not a magic number). Returns { A, iters, certified } — certified = hit tol at/under bound.
  // On f32/GPU paths where tol can sit below the float floor, pass useBound:true to run the fixed
  // proven count and skip the (never-terminating) convergence test.
  const iterate = (S0, { tol = 1e-6, useBound = false } = {}) => {
    let S = _dedup(S0, D, dedupEps);
    const nb = bound(S, tol);
    if (useBound) { const N = Number.isFinite(nb) ? nb : 0;
      for (let i = 0; i < N; i++) S = step(S); return { A: S, iters: N, certified: Number.isFinite(nb) }; }
    let iters = 0; const cap = Number.isFinite(nb) ? nb : 100000;
    while (iters < cap) { const S1 = step(S); iters++;
      const d = _hausdorff(S, S1, D); S = S1;
      if (d <= tol) return { A: S, iters, certified: true }; }
    return { A: S, iters, certified: Number.isFinite(nb) }; };

  // NOTE ON SUPPORT (why dedupEps matters): a DENSE attractor (e.g. Sierpinski) is a fractal — its support
  // is unbounded at any finite resolution, so each W step multiplies |S| by |maps| until dedup merges on
  // the dedupEps grid. Choose dedupEps at the RESOLUTION you care about (it IS the pixel/ring grid); a
  // dedupEps far below tol lets |S| explode (ρⁿ shrinks the STEP-delta below tol long before the grid
  // merges points). For dense 2D sets keep dedupEps ≳ tol. The 1-D ring-set apps are naturally sparse.

  // Live genome dial (the app's ρ knob). Clamped < 1 so the contraction invariant can never be broken
  // by a UI event. Optionally rescale the map's A by the ratio so the spectral norm tracks rho (radial
  // case: A=[rho] exactly; general case: caller owns A, we only gate the declared bound).
  const setRho = (i, rho, { scaleA = false } = {}) => {
    if (i < 0 || i >= W.length) return;
    const r = Math.min(RHO_CAP, Math.max(0, rho));
    if (scaleA && W[i].rho > 0) { const s = r / W[i].rho; for (let j = 0; j < W[i].A.length; j++) W[i].A[j] *= s; }
    W[i].rho = r; };

  const maps_ = () => W.map((w) => ({ A: [...w.A], t: [...w.t], rho: w.rho }));

  // hash(): the cross-peer diff instrument. Hashes the DEFINING DATA (the maps) — two peers with the same
  // contraction system hash identically by construction. To diff a COMPUTED attractor, hash iterate().A
  // via hashSet(). (Maps are the join-relevant replicated state; the attractor is derivable from them.)
  const hash = () => _hashNums(W.flatMap((w) => [...w.A, ...w.t, w.rho]));
  const hashSet = (S) => _hashNums(Array.from(_dedup(S, D, dedupEps)));

  // save() ships D + dedupEps for VERIFICATION, but they are CONSTRUCTION constants, not live state:
  // restore() replays only the maps (the replicated genome). Peers MUST construct with the same dim +
  // dedupEps (an app-config invariant, like the medium's grid size); restore() throws if they differ,
  // because a mismatched dedupEps forks hashSet() silently — better a loud failure than a quiet fork.
  const save = () => ({ D, dedupEps, maps: maps_() });
  const restore = (s) => { if (!s?.maps) return;
    if ((s.D != null && s.D !== D) || (s.dedupEps != null && s.dedupEps !== dedupEps))
      throw new Error(`ifs-core restore: config mismatch (dim ${s.D}→${D}, dedupEps ${s.dedupEps}→${dedupEps}) — peers must share app config`);
    W.length = 0;   // snapshot path: keep ρ verbatim (the replicated genome)
    for (const w of s.maps) W.push({ A: [...w.A], t: [...w.t], rho: Math.max(0, w.rho) }); };

  return Object.freeze({ step, iterate, bound, setRho, rhoMax, maps: maps_, hausdorff: (P, Q) => _hausdorff(P, Q, D),
    dim: () => D, hash, hashSet, save, restore });
};

// ── RADIAL CONVENIENCE (the ifsclock.js / ahc-fractal.js ring-set case) ───────────────────────────
//  The apps' attractor is a set of RADII: each map is r → ρᵢ·r, a firing deposits a ring at GRID·gain
//  with gain = accumulated ρ^depth. That is the D=1 Hutchinson system with A=[ρᵢ], t=[0]. makeRadialIFS
//  wraps makeHutchinson for it; seedRing(r0) makes the singleton start set the chaos-game grows from.
export const makeRadialIFS = (rhos = [], { dedupEps = 1e-6 } = {}) =>
  makeHutchinson({ dim: 1, dedupEps, maps: rhos.map((rho) => ({ A: [rho], t: [0], rho })) });

// A singleton seed set at radius r0 (the ρ⁰ ring). W grows it into the full self-similar radius ladder.
export const seedRing = (r0 = 1) => Float64Array.of(r0);

// ── makeContractionNode — THE CERTIFIED-CONTRACTION NODE CLASS (uses the core's futureContract gate) ─────────
//  A node whose reduce IS a Banach contraction: each shared step applies `step` once, and the node fires `msg`
//  (default "arrived") via ctx.futureContract THE MOMENT it converges (residual ≤ tol) — the geometric gate,
//  drained in a CERTIFIED bound() steps, not the shared magic cap. Returns a handler set to hand to
//  Behaviors.collect (state field `S` holds the iterate). It is what ifsclock / ahc's ring-build / the
//  self-host each hand-rolled; now a primitive. Pure over replicated state → join-safe (proven in
//  public/contract-gate.test.mjs). ADDITIVE at the core: a world with no such node is bit-for-bit unchanged.
//
//    step(S) → S'      one contraction step (e.g. makeHutchinson.step, or any Lipschitz-<1 map)
//    residual(S) → n   distance-to-fixpoint (e.g. Hausdorff step-delta ‖S − step(S)‖); becomes __residual
//    seed              the initial iterate S₀ (armed on the first __macro)
//    tol               convergence tolerance (the futureContract threshold)
//    bound             optional a-priori Banach count (for the drain's certified early-exit; display/telemetry)
//    onArrive          optional msg name fired at convergence (default "arrived")
export const makeContractionNode = ({ step, residual, seed, tol = 1e-6, bound = Infinity, onArrive = 'arrived' } = {}) => ({
  __residual: (s) => (s && s.S !== undefined) ? residual(s.S) : Infinity,   // core reads this for the futureContract gate + _contractResidual
  __macro: (s, _p, ctx) => {
    if (!s || s.S === undefined) { ctx.futureContract(tol, onArrive); return { ...s, S: seed, cSteps: 0, arrived: false, cBound: bound }; }
    if (s.arrived) return s;                                                 // parked at the fixpoint (no wasted steps)
    return { ...s, S: step(s.S), cSteps: (s.cSteps ?? 0) + 1 };
  },
  [onArrive]: (s) => ({ ...s, arrived: true, arrivedAt: s.cSteps }),          // fires ONLY when residual ≤ tol (the gate)
});

// ── makeStreamingContractionNode — THE IFS-CLOCK'S SUCCESSOR: emits the TRAJECTORY (a beat per step, like the
//    IFS clock — the intermediate iterates ARE the product) AND fires a CERTIFIED convergence endpoint
//    (futureContract → arrived + bound()). The correction to "a convergence gate fires once and erases the
//    stream": the intermediate S-values always EXIST (computed per step, in state); whether they are EMITTED
//    is a per-node choice. makeContractionNode emits only the endpoint; this emits BOTH. So it is strictly
//    richer than the IFS clock (which has the beat stream but NO certified 'done' event) — the fractal beat
//    texture PLUS a Banach convergence certificate on top. Pure over replicated state → join-safe.
//
//    emit(S, cStep) → the per-step beat payload (called each step with the fresh iterate); collected into
//                     state.beats (a replicated array) so a renderer/downstream reads the stream. Keep it a
//                     pure fn of (S, step) — the emitted beats are then byte-identical on every peer.
//    (step/residual/seed/tol/bound/onArrive as in makeContractionNode.)
export const makeStreamingContractionNode = ({ step, residual, seed, tol = 1e-6, bound = Infinity,
  emit = (S, k) => ({ k, n: S.length }), onArrive = 'arrived', maxBeats = 4096 } = {}) => ({
  __residual: (s) => (s && s.S !== undefined) ? residual(s.S) : Infinity,
  __macro: (s, _p, ctx) => {
    if (!s || s.S === undefined) { ctx.futureContract(tol, onArrive);
      return { ...s, S: seed, cSteps: 0, arrived: false, cBound: bound, beats: [emit(seed, 0)] }; }   // beat 0 = the seed
    if (s.arrived) return s;                                                    // parked (stream ends at the fixpoint)
    const S1 = step(s.S), k = (s.cSteps ?? 0) + 1;
    const beats = (s.beats ?? []); const nb = beats.length < maxBeats ? [...beats, emit(S1, k)] : beats;   // EMIT the step
    return { ...s, S: S1, cSteps: k, beats: nb };
  },
  [onArrive]: (s) => ({ ...s, arrived: true, arrivedAt: s.cSteps }),           // the CERTIFIED endpoint, atop the stream
});

// NOTE — WHY THERE IS NO "settleCascade" HELPER HERE: the AHC's operator-build cascade (medium-core
// makeIFSClock) is a LIVING clock — kdecay=0.985 fades old rings and §9 relaunchDue respawns them forever, so
// its ring set NEVER reaches a fixed point (measured: ~99 ring changes over 200 ticks). Its `for k=1..40 tick`
// is therefore SAMPLING a perpetual-motion clock at tick 40, not waiting for Banach convergence. A bound()-
// capped "settle" loop would silently resample a DIFFERENT living state for high-ρ slots (measured: slots at
// ρ=0.72/0.78 land on different radii) → changed physics. So the set-attractor certificate does NOT apply to
// this build; the honest bound is stated, not faked. (This kernel's iterate/bound belong to apps whose ring
// set actually CONVERGES — ifs-hutchinson's offset maps — not to the living operator-build cascade.)

if (typeof globalThis !== 'undefined') { globalThis.KWEHutchinson = makeHutchinson; globalThis.KWERadialIFS = makeRadialIFS; }
