/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors

eye-lens — THE EYE's LENS ALGEBRA (ahc, 2026-10-06).

  The new eye's one read primitive (eye.js): ψ_out = Op·ψ_in, a pluggable reconstruction operator, and the operators COMPOSE.
  In ahc every stage of the eye is such a lens, and each is one of the MEDIUM's OWN kinds — meta-circular: the eye reads with the
  operators the medium computes with.

    time    U_c(t)          the IFS TIME GENERATOR as a lens: the cascade's propagator (the operator of cycle c — the GLASS) by t
                            steps, per mode in the dual. Depth back-propagation, the recording's ±T legs, the eye's focus — all this.
                            A group: U(a)·U(b) = U(a + b) for one glass.
    relabel ψ → ψ̄, ψ → ½(ψ + e^{2iθ}ψ̄)   the DUALITY's relabels: in k they read F(p) with F(−p) (the conjugate: conj F(−p);
                            the analyser: ½(F(p) + e^{2iθ}·conj F(−p))). ◐medium's mirror (q ← 2b − q) is the same kind, done by the
                            read itself.
    gate    projections in k: the pupil (res), the spectral cut, the beam stop — what a Fourier-plane aperture passes.
    space   per-cell: out = (m + i·mi)·Q(s) + (|ψ| + 1e-4)·(n1 + i·n2) — masks (the hand), phase plates (vortex, axicon, thin
                            lens), zone plates, the noise fill; Q = phase quantisation (qL), then the intensity-only mix (amix).
    u1      THE OBSERVER-LENS ALGEBRA's element (soliton-algebra.js lensU1 — the u-register's own algebra, medium.js / eye.js):
                            { phase, gain, kx, ky, A, tx, ty } — the REGISTER's U(1) phase (the pin's angle IS a lens), a tilt (a
                            prism), an affine map (zoom / rotate / shift: the IFS maps as optics). Composed by lensU1.compose — the
                            SEMIDIRECT product (affine ∘ affine is NON-commutative: order matters), applied by lensU1.apply. (The
                            older 'phase' kind {ang} is read as a lensU1 phase element.)
  THE GENOME AS OPTICS (eye.js / medium.js: the IFS clock's maps read as lenses) — two honest forms, no new kind:
    facet plate  facetPlate(): eye.js's phase lens. The plate cut into FACETS by the genome's own Hutchinson partition, each facet a thin
                            lens about its map's fixed point — a `space` lens (a field: e^{iφ}, invisible where it sits); the image forms by
                            the medium's own `time` lens after it (the IFS time generator — the lens is the field, the travel is the clock).
    metric       hutchMetric(): the Hutchinson operator as a FOLD of space — each of the genome's cells pulls the whole plate back through its map
                            (medium.js op:metric; transformation optics, not a lens).
    union        hutchUnion(): the Hutchinson operator SET-WISE on an object, W(A) = ⋃_k w_k(A) (medium.js ifsWarpEye: per cell the
                            strongest of the K pre-images) — a fractal MASK made of the object, every map seeing all of it; n passes =
                            the clock, genomeCertified = Banach's count to the attractor. An object (transmittance), not a lens on a read:
                            for the ✦ source, where the object has no frame around it.

  A CHAIN is data: [lens, lens, …] in the order the light meets them. fuse() merges what the algebra allows (time∘time of one
  glass adds, phase∘phase adds, space∘space multiplies when the second has no nonlinearity, gate∘gate unites) — the same laws
  that let the ear hear a whole chain in one pass. run() evaluates a chain on a field, switching domain (one transform) only where
  the next lens needs the other side. compileEar() reduces a chain to the GPU ear's one pass (table → relabel → gates) and says
  honestly what it could not follow.

  Pure: no app state. Deps (the transform, the dual propagator) are passed in, so the world, the renderer and the tests share it.
*/
import { lensU1 } from "./soliton-algebra.js";
import { makeHutchinson } from "./ifs-core.js";   // the NATIVE Hutchinson operator (the IFS's Banach set-attractor face: setwise W, a proven bound)
import { FRESNEL_MAPS } from "./fresnel-cascade.js";   // the medium's CLOCK: the cascade's contraction ratios (clockGenome)

export const LENS_KINDS = ["time", "relabel", "gate", "space", "u1", "cavity", "corr"];
//   a GENOME (eye.js rules: x′ = s·R(θ)·x + t on the unit square) as lensU1 elements on a G-plate (centred frame ξ = x − (G−1)/2):
//   x = u·(G−1) → ξ′ = s·R·ξ + s·R·c + (G−1)·t − c, c = ((G−1)/2, (G−1)/2)
//   FITTED like eye.js (nlhoFixedPointFit): the raw rules put copies past the unit square (the carpet's attractor spans 0.17 … 1.17), so the
//   genome is first CONJUGATED by the fit F(u) = a·u + b that places its maps' fixed points inside the plate (pad 0.1): w′ = F∘w∘F⁻¹ keeps
//   every map's scale and rotation (the same optics) and only moves where it sits — t′ = a·t + b − s·R·b.
//   THE NATIVE HUTCHINSON KERNEL of a genome on the plate (ifs-core.js, cells): the SAME maps the field lens sums, as declared contractions
//   x′ = A·x + (τ + c − A·c), ρ = s — order-independent (setwise W), hashable, with Banach's a-priori iteration bound. One source of truth:
//   the field lens (the coherent sum of copies of ψ) and the set attractor (W iterated on points) come from these maps.
export function genomeKernel(maps, G) { const c = (G - 1) / 2;
  return makeHutchinson({ dim: 2, dedupEps: 0.5, maps: maps.map((m) => ({ A: [...m.A], t: [m.tx + c - (m.A[0] * c + m.A[1] * c), m.ty + c - (m.A[2] * c + m.A[3] * c)], rho: m.s })) }); }
//   the CERTIFIED clock length: the kernel's bound for one cell from the plate's corners — W^n of ANY start set on the plate lies within one
//   cell of the attractor (∞ if a map is not a contraction)
export function genomeCertified(kernel, G) { return kernel.bound(Float64Array.of(0, 0, G - 1, 0, 0, G - 1, G - 1, G - 1), 1); }
//   MEMOISED (a pure fn of the rules, G, fit): the attractor fit runs the native kernel's iterate — MEASURED ~10% of a frame on every ✿ drag
//   step when it re-ran per change. Returns a fresh array of fresh map objects (callers may spread them).
const _gmMemo = new Map();
export function genomeMaps(rules, G, fit = true) { const key = JSON.stringify(rules || []) + "|" + G + "|" + !!fit; let v = _gmMemo.get(key);
  if (!v) { v = _genomeMaps(rules, G, fit); if (_gmMemo.size > 32) _gmMemo.delete(_gmMemo.keys().next().value); _gmMemo.set(key, v); }
  return v.map((m) => ({ ...m, A: [...m.A] })); }
function _genomeMaps(rules, G, fit = true) { const L = G - 1, c = L / 2, M = (rules || []).map((r) => { const s = +r.s || 0.5, th = +r.theta || 0, cs = Math.cos(th), sn = Math.sin(th); return { s, A: [s * cs, -s * sn, s * sn, s * cs], t: [+r.tx || 0, +r.ty || 0] }; });
  let a = 1, b = [0, 0];
  //   the fit's box = the ATTRACTOR's bounding box from the NATIVE kernel (unit coords): rotating maps reach well beyond their fixed points
  //   (eye.js fitted the fixed points — fine for the carpet / Sierpinski, it clipped the spiral)
  if (fit && M.length && M.every((m) => m.s < 1)) { const Ku = makeHutchinson({ dim: 2, dedupEps: 4e-3, maps: M.map(({ s, A, t }) => ({ A: [...A], t: [...t], rho: s })) });
    const Au = Ku.iterate(Float64Array.of(0, 0, 1, 0, 0, 1, 1, 1), { tol: 4e-3, useBound: true }).A, fp = []; for (let k = 0; k < Au.length; k += 2) fp.push([Au[k], Au[k + 1]]);
    const mnx = Math.min(...fp.map((p) => p[0])), mxx = Math.max(...fp.map((p) => p[0])), mny = Math.min(...fp.map((p) => p[1])), mxy = Math.max(...fp.map((p) => p[1])), pad = 0.1;
    a = (1 - 2 * pad) / Math.max(1e-3, mxx - mnx, mxy - mny); b = [pad + ((1 - 2 * pad) / a - (mxx - mnx)) * a / 2 - mnx * a, pad + ((1 - 2 * pad) / a - (mxy - mny)) * a / 2 - mny * a]; }
  return M.map(({ s, A, t }) => { const tf = [a * t[0] + b[0] - (A[0] * b[0] + A[1] * b[1]), a * t[1] + b[1] - (A[2] * b[0] + A[3] * b[1])];   // the fitted map, unit coords
    return { ...lensU1.id(), mode: "metric", A, tx: A[0] * c + A[1] * c + L * tf[0] - c, ty: A[2] * c + A[3] * c + L * tf[1] - c, s }; }); }
//   the plate-frame fixed point of a genome element (x′ = A·(x − c) + c + τ)
const _fixPt = (w, c) => { const a = 1 - w.A[0], b = -w.A[1], d = -w.A[2], e = 1 - w.A[3], det = a * e - b * d;
  return Math.abs(det) < 1e-12 ? [c, c] : [c + (e * w.tx - b * w.ty) / det, c + (a * w.ty - d * w.tx) / det]; };
//   _partition(maps, G) — THE GENOME's OWN CELLS on the plate: cell k = where the Hutchinson map w_k puts the plate (w_k⁻¹(x) on the plate);
//   overlaps and gaps → the nearest fixed point. fac[j] = the cell of cell j (−1: no invertible map), fp = the fixed points. Shared by the facet
//   plate (a lens per cell) and the metric fold (a copy per cell).
function _partition(maps, G) { const N = G * G, c = (G - 1) / 2, K = maps.length, fp = maps.map((w) => _fixPt(w, c)), fac = new Int16Array(N).fill(-1);
  const inv = maps.map((w) => { const d = w.A[0] * w.A[3] - w.A[1] * w.A[2]; return Math.abs(d) < 1e-12 ? null : [w.A[3] / d, -w.A[1] / d, -w.A[2] / d, w.A[0] / d]; });
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { let best = -1, bd = Infinity, cov = false;
    for (let k = 0; k < K; k++) { const Ai = inv[k]; if (!Ai) continue; const ux = x - c - maps[k].tx, uy = y - c - maps[k].ty, sx = Ai[0] * ux + Ai[1] * uy + c, sy = Ai[2] * ux + Ai[3] * uy + c;
      const ins = sx >= -0.5 && sy >= -0.5 && sx <= G - 0.5 && sy <= G - 0.5, d = (x - fp[k][0]) ** 2 + (y - fp[k][1]) ** 2;
      if ((ins && !cov) || (ins === cov && d < bd)) { best = k; bd = d; cov = ins; } }
    fac[y * G + x] = best; }
  return { fac, fp }; }
//   facetPlate(maps, G, alpha) — THE FACET PLATE (eye.js's phase lens, _lensGeometry op:phase): a space lens (phase table). Facet k = the cells
//   the Hutchinson map w_k covers (w_k⁻¹(x) on the plate) — the genome's own partition; overlaps and gaps → the nearest fixed point. Each facet
//   a THIN LENS about its map's fixed point p_k: φ = −(1 − s_k)·α·r² (focus: s < 1 converges, eye.js α 0.06) + β_k·dx·dy (β_k = θ_k·α·⅔ —
//   eye.js's cross-quadratic: an astigmatic phase that SHEARS the facet's image on travel; a phase cannot ROTATE an image, this is its
//   small-angle stand-in). |ψ| is unchanged at the plate; the image forms by the medium's own `time` lens after it, and the cuts between
//   facets diffract. MEASURED (G 128, cycle 8): this medium's dispersion is quadratic only for k ≲ 0.1 (|v| saturates at 0.08 cells/step), so
//   a facet aberrates, and a lens designed to stay in that band (aspheric, rays ≤ v*) bent the image less than its own diffraction did —
//   invisible. The eye.js strength slices and bends it visibly over a travel of tens of steps; a loupe meant to shrink a letter into s_k-copies
//   (plate at a distance, the eye on its virtual images) lost the letter to diffraction first. Copies are the ✦ source's union, not a lens's.
//   opts (eye.js's lens strip): sx, sy — shift every facet centre (cells; the facets move with them: the partition is the shifted genome's);
//   th — added to every facet's θ (the shear); vc — an optical VORTEX e^{i·vc·atan2(dy, dx)} about each facet's centre (orbital angular
//   momentum: a real spiral-phase element, a dark core per facet).
//   facetPhase(maps, G, alpha, opts) — the facet plate's PHASE itself (unwrapped, per cell): the same profile as a POTENTIAL — applied a little
//   every step it is the genome's landscape the field lives in (one harmonic well per Hutchinson cell about its fixed point; ahc's ✿ potential).
export function facetPhase(maps0, G, alpha = 0.06, opts = {}) { const P = facetPlate(maps0, G, alpha, opts); return P.ph; }
export function facetPlate(maps0, G, alpha = 0.06, opts = {}) { const N = G * G, c = (G - 1) / 2, sx0 = +opts.sx || 0, sy0 = +opts.sy || 0, thA = +opts.th || 0, vc = +opts.vc || 0;
  const maps = (sx0 || sy0) ? maps0.map((w) => ({ ...w, tx: w.tx + sx0 - (w.A[0] * sx0 + w.A[1] * sy0), ty: w.ty + sy0 - (w.A[2] * sx0 + w.A[3] * sy0) })) : maps0;   // the conjugate T∘w∘T⁻¹: same map, centre moved
  const { fac, fp } = _partition(maps, G);
  const a = maps.map((w) => -(1 - (w.s ?? 1)) * alpha), b = maps.map((w) => (Math.atan2(w.A[2], w.A[0]) + thA) * alpha * (2 / 3)), m = new Float64Array(N), mi = new Float64Array(N), PH = new Float64Array(N);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x, best = fac[j]; if (best < 0) { m[j] = 1; continue; }
    const dx = x - fp[best][0], dy = y - fp[best][1], ph = a[best] * (dx * dx + dy * dy) + b[best] * dx * dy + (vc ? vc * Math.atan2(dy, dx) : 0); PH[j] = ph; m[j] = Math.cos(ph); mi[j] = Math.sin(ph); }
  return { kind: "space", m, mi, ph: PH, key: "facet:" + maps.map((w) => [w.tx, w.ty, w.s].map((v) => +(+v).toFixed(5)).join(",")).join(";") + "@" + alpha + "/" + [thA, vc].join(",") }; }
//   clockGenome() — THE MEDIUM's CLOCK AS A GENOME (meta-circular: the IFS that makes the medium's TIME made its SPACE lens). The Fresnel
//   cascade grows each cycle's ring by delays d → d·r, r drawn from FRESNEL_MAPS (0.309 · 0.414 · 0.5 · 0.618 · 0.707 · 0.732 — the clock's
//   law). As a spatial genome: one map per ratio, w_j(x) = r_j·(x − p_j) + p_j. The ratios are the clock's DATA; where the fixed points sit
//   is GAUGE (eye.js §7.88r: placement is not data on the wire) — the most symmetric choice, a regular ring, then fitted like every genome.
//   Σ r_j² = 1.93 > 1: the copies OVERLAP (the attractor is solid, dimension 2) — with the ⊕ sum they interfere where they overlap.
export function clockGenome(ratios = FRESNEL_MAPS) { const K = ratios.length;
  return ratios.map((r, j) => { const a = 2 * Math.PI * j / K, px = 0.5 + 0.4 * Math.cos(a), py = 0.5 + 0.4 * Math.sin(a); return { s: r, theta: 0, tx: px - r * px, ty: py - r * py }; }); }
//   blendMaps(maps, b) — THE CODE-WARP DIALS (medium.js's bar, generalised). b = { K (how many of the maps act; 0 = all), s, x, y (each blended
//   from the identity, 0, to the genome's own, 1), r (an ADDED turn, r·π, −1 … 1 — a blend would do nothing on a genome without rotation: the
//   carpet, Sierpinski, diagonal all have θ = 0), lx, ly (THE LENS's SHIFT, cells — every map conjugated by the translation, w′ = T∘w∘T⁻¹: the
//   whole lens moved over the plate, eye.js's shiftX/Y), fr (THE LENS FRAME's TURN, ×π: every map conjugated by the rotation R about the
//   plate's centre, w′ = R∘w∘R⁻¹ — for the genome's similarities A commutes with R, so only the copies' PLACES turn, t′ = R·t: the lens
//   turned as a whole, the same element seen from a turned frame; with x = y = z it is the frame's zoom, t′ = z·t) }. x, y → 1 pull the
//   copies apart to the genome's places; s → 1 shrinks them. Each result is still an exact affine map, so the kernel still certifies it.
export function blendMaps(maps, b = {}) { const K = (b.K | 0) > 0 ? Math.min(maps.length, b.K | 0) : maps.length, f = (v, d) => (v === undefined || v === null ? d : +v);
  const bs = f(b.s, 1), ra = f(b.r, 0) * Math.PI, bx = f(b.x, 1), by = f(b.y, 1), lx = f(b.lx, 0), ly = f(b.ly, 0), fa = f(b.fr, 0) * Math.PI, fc = Math.cos(fa), fs = Math.sin(fa);
  return maps.slice(0, K).map((w) => { const s0 = w.s ?? Math.hypot(w.A[0], w.A[2]), th = Math.atan2(w.A[2], w.A[0]) + ra, s = 1 + (s0 - 1) * bs, cs = Math.cos(th), sn = Math.sin(th), A = [s * cs, -s * sn, s * sn, s * cs];
    const t0x = fa ? fc * w.tx - fs * w.ty : w.tx, t0y = fa ? fs * w.tx + fc * w.ty : w.ty;   // the frame's turn (conjugation): the places turn, A stays
    return { ...w, A, tx: t0x * bx + lx - (A[0] * lx + A[1] * ly), ty: t0y * by + ly - (A[2] * lx + A[3] * ly), s }; }); }
//   hutchSum(f, G, maps, n, fft) — THE HUTCHINSON OPERATOR AS WAVES, IN THE DUAL: ψ′ = Σ_k w_k(ψ), the coherent sum (copies interfere). A map
//   w_k = shift τ_k ∘ linear A_k (about the plate's centre); in k a shift is a phase: F[ψ(x − τ)](q) = e^{−iq·τ}·F[ψ](q). So for each distinct
//   linear part A: ONE copy A(ψ) (a resample about the centre — the object has no frame around it), then in k × its STRUCTURE FACTOR
//   S_A(q) = Σ_{k: A_k = A} e^{−iq·τ_k} — the copies' point set as a Fourier-plane hologram (a 4f correlator with a diffractive filter: real
//   optics, and the medium's own duality). Sub-cell shifts are EXACT (a phase, no interpolation); copies wrap on the torus (the medium's own
//   boundary). Energy is kept (normalised to the input each pass: lossless optics). n passes = the clock. fft(re, im, inverse) in place.
//   lattice (default true): each copy's shift is ROUNDED to whole cells — placement is gauge (eye.js §7.88r), and a whole-cell shift is an
//   exact lattice move. A sub-cell shift is exact too (a phase), but on an object that is not band-limited (letterA's dots reach Nyquist) it
//   RINGS — the sinc tails of the lattice (Gibbs) run along the rows and columns of the plate: honest, and it reads as streaks (MEASURED).
//   pupil (0 < ρ < 1, optional): THE ELEMENT's APERTURE — a soft ROUND pupil (super-Gaussian, half-amplitude at ρ·G/2 about the plate's
//   centre) the light passes before the copies are made — and its NUMERICAL APERTURE: a copy shrunk by s carries only |q| < s·Nyquist (a
//   soft cut): what lies above would be steeper than the grid can hold after the shrink — on the lattice it would ALIAS (wrap
//   onto other carriers: a shrunk plane wave folded onto its conjugate, MEASURED as phantom copies in the eye's reading beam); in a real
//   optic it simply misses the aperture. Without it the aperture is the plate's own square edge: every copy is the whole
//   square shrunk, and where the copies stop tiling (a turned frame, the clock's overlapping ratios) the shrunk squares' edges show as BOXES
//   — real optics of a hard square stop (an unstable resonator images its stop). A soft round stop is what real resonators use: it turns
//   into itself, and band-limits the copy before it is shrunk. Energy is normalised to what the pupil passed (the stop's loss is real).
const _pupMemo = new Map();
//   _naCut — the band a copy shrunk by s can carry: a SEPARABLE windowed-sinc low-pass at 0.9·s·Nyquist (a decimator's usual margin; Blackman window, ±⌈3/s⌉ taps, unit DC
//   gain) — the aperture as a real-space transfer, ~10× cheaper than a round trip through the dual; periodic (the torus)
const _naTaps = new Map();
function _naCut(f, G, s) { const N = G * G, M = Math.min(G >> 1, Math.ceil(3 / s)), key = G + "|" + s; let h = _naTaps.get(key);
  if (!h) { h = new Float64Array(2 * M + 1); let sum = 0; for (let j = -M; j <= M; j++) { const sc = 0.9 * s, sinc = j === 0 ? sc : Math.sin(Math.PI * sc * j) / (Math.PI * j), w = 0.42 + 0.5 * Math.cos(Math.PI * j / (M + 1)) + 0.08 * Math.cos(2 * Math.PI * j / (M + 1)); h[j + M] = sinc * w; sum += h[j + M]; }
    for (let j = 0; j <= 2 * M; j++) h[j] /= sum; if (_naTaps.size > 16) _naTaps.clear(); _naTaps.set(key, h); }
  const L = G + 2 * M, br = new Float64Array(L), bi = new Float64Array(L), o = new Float64Array(2 * N), T = 2 * M + 1;
  const line = (get, put) => { for (let u = 0; u < L; u++) { const q = get(((u - M) % G + G) % G); br[u] = q[0]; bi[u] = q[1]; }   // the line, wrapped once (the torus)
    for (let x = 0; x < G; x++) { let ar = 0, ai = 0; for (let j = 0; j < T; j++) { const w = h[j]; ar += w * br[x + j]; ai += w * bi[x + j]; } put(x, ar, ai); } };
  const tmp = new Float64Array(2 * N), pr = [0, 0];
  for (let y = 0; y < G; y++) { const off = 2 * y * G; line((x) => (pr[0] = f[off + 2 * x], pr[1] = f[off + 2 * x + 1], pr), (x, a, b) => { tmp[off + 2 * x] = a; tmp[off + 2 * x + 1] = b; }); }
  for (let x = 0; x < G; x++) line((y) => (pr[0] = tmp[2 * (y * G + x)], pr[1] = tmp[2 * (y * G + x) + 1], pr), (y, a, b) => { o[2 * (y * G + x)] = a; o[2 * (y * G + x) + 1] = b; });
  return o; }
export function pupilOf(G, rho) { const k = G + "|" + rho; let P = _pupMemo.get(k); if (P) return P; const R = Math.max(1, rho * G / 2), c = (G - 1) / 2; P = new Float64Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r = Math.hypot(x - c, y - c) / R; P[y * G + x] = Math.exp(-Math.LN2 * r ** 8); }
  if (_pupMemo.size > 8) _pupMemo.clear(); _pupMemo.set(k, P); return P; }
export function hutchSum(f, G, maps, n, fft, lattice = true, pupil = 0) { const N = G * G, H2 = G >> 1, tw = 2 * Math.PI / G; let cur = f;
  const PU = pupil > 0 && pupil < 1 ? pupilOf(G, pupil) : null, stop = (v) => { if (!PU) return v; const o = new Float64Array(2 * N); for (let c = 0; c < N; c++) { o[2 * c] = v[2 * c] * PU[c]; o[2 * c + 1] = v[2 * c + 1] * PU[c]; } return o; };
  const groups = new Map(); for (const w of maps) { const k = w.A.map((v) => v.toFixed(9)).join(","); if (!groups.has(k)) groups.set(k, { A: w.A, t: [] }); groups.get(k).t.push(lattice ? [Math.round(w.tx), Math.round(w.ty)] : [w.tx, w.ty]); }
  const S = lattice ? [] : [...groups.values()].map((g) => { const Sr = new Float64Array(N), Si = new Float64Array(N);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const qx = (x <= H2 ? x : x - G) * tw, qy = (y <= H2 ? y : y - G) * tw, j = y * G + x; let ar = 0, ai = 0;
      for (const [tx, ty] of g.t) { const ph = -(qx * tx + qy * ty); ar += Math.cos(ph); ai += Math.sin(ph); } Sr[j] = ar; Si[j] = ai; }
    return { A: g.A, Sr, Si }; });
  //   ON THE LATTICE the structure factor's phases are whole-cell shifts — an exact INDEX ROLL in space, so the sum needs no transform at all
  //   (identical to the dual form: test/eye-lens; ~7 FFTs per pass → 0). The dual form stays for sub-cell shifts (lattice false).
  if (lattice) { const G2 = [...groups.values()];
    for (let p = 0; p < Math.max(1, n | 0); p++) { cur = stop(cur); let e0 = 0; for (let c = 0; c < 2 * N; c++) e0 += cur[c] * cur[c]; const out = new Float64Array(2 * N);
      let eS = 0, nS = 0, cut = false;   // the energy the copies' apertures pass (what the element may keep — a cut is a real loss, never re-amplified)
      for (const g of G2) { const sg = Math.sqrt(Math.abs(g.A[0] * g.A[3] - g.A[1] * g.A[2])), src = PU && sg < 1 ? _naCut(cur, G, sg) : cur;   // (the copy optic's aperture — see pupil)
        if (src !== cur) { cut = true; let es = 0; for (let c = 0; c < 2 * N; c++) es += src[c] * src[c]; eS += g.t.length * es; } else eS += g.t.length * e0; nS += g.t.length;
        const o = (g.A[0] === 1 && !g.A[1] && !g.A[2] && g.A[3] === 1) ? cur : lensU1.apply({ ...lensU1.id(), mode: "metric", A: g.A, tx: 0, ty: 0 }, src, G);
        for (const [tx, ty] of g.t) { const ox = ((tx % G) + G) % G, oy = ((ty % G) + G) % G;
          for (let y = 0; y < G; y++) { const yd = (y + oy) % G; for (let x = 0; x < G; x++) { const sj = 2 * (y * G + x), dj = 2 * (yd * G + (x + ox) % G); out[dj] += o[sj]; out[dj + 1] += o[sj + 1]; } } } }
      let e1 = 0; for (let c = 0; c < 2 * N; c++) e1 += out[c] * out[c]; const sc = e1 > 0 ? Math.sqrt((cut ? eS / nS : e0) / e1) : 0; for (let c = 0; c < 2 * N; c++) out[c] *= sc; cur = out; }
    return cur; }
  for (let p = 0; p < Math.max(1, n | 0); p++) { cur = stop(cur); let e0 = 0; for (let c = 0; c < 2 * N; c++) e0 += cur[c] * cur[c];
    const Or = new Float64Array(N), Oi = new Float64Array(N);
    for (const g of S) { const lin = { ...lensU1.id(), mode: "metric", A: g.A, tx: 0, ty: 0 }, o = (g.A[0] === 1 && !g.A[1] && !g.A[2] && g.A[3] === 1) ? cur : lensU1.apply(lin, cur, G);
      const re = new Float64Array(N), im = new Float64Array(N); for (let c = 0; c < N; c++) { re[c] = o[2 * c]; im[c] = o[2 * c + 1]; } fft(re, im, false);
      for (let c = 0; c < N; c++) { Or[c] += re[c] * g.Sr[c] - im[c] * g.Si[c]; Oi[c] += re[c] * g.Si[c] + im[c] * g.Sr[c]; } }
    fft(Or, Oi, true); let e1 = 0; for (let c = 0; c < N; c++) e1 += Or[c] * Or[c] + Oi[c] * Oi[c]; const sc = e1 > 0 ? Math.sqrt(e0 / e1) : 0;
    cur = new Float64Array(2 * N); for (let c = 0; c < N; c++) { cur[2 * c] = Or[c] * sc; cur[2 * c + 1] = Oi[c] * sc; } }
  return cur; }
//   hutchMetric(f, G, cells, copies, n) — THE HUTCHINSON OPERATOR AS A FOLD OF SPACE (medium.js's op:metric, made native): the plate is cut
//   into the genome's own cells (_partition of `cells`), and each cell PULLS BACK the whole plate through its map — out(x) = ψ(w_k⁻¹(x)) for x
//   in cell k (bilinear; a pre-image off the plate is dark — wrapping it on the torus MEASURED: the cells beyond the genome's images pulled in
//   periodic copies and tiled the whole plate). Each cell shows the whole field shrunk and turned about its fixed
//   point: a coordinate transformation (transformation optics — the space folded onto K copies of itself), not a sum and not a max. For a genome
//   whose images do not overlap it IS W(A) = ⋃ w_k(A) exactly, so the kernel's certified count holds. `copies` = the maps the cells pull
//   through: the same maps, or SHIFTED (lens x, y) — the copies slide inside cells that stay where they are, and are cut at the cell walls
//   (medium.js's shift: the Sierpinski that bends). Amplitude kept per sample (a transmittance remapped; the Jacobian s² is the copy's area).
export function hutchMetric(f, G, cells, copies, n = 1) { const N = G * G, c = (G - 1) / 2, { fac } = _partition(cells, G);   // (a pre-image off the plate is dark: zero, like the union)
  const inv = copies.map((w) => { const d = w.A[0] * w.A[3] - w.A[1] * w.A[2]; return Math.abs(d) < 1e-12 ? null : [w.A[3] / d, -w.A[1] / d, -w.A[2] / d, w.A[0] / d]; });
  let cur = f;
  for (let p = 0; p < Math.max(1, n | 0); p++) { const out = new Float64Array(2 * N);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x, k = fac[j]; if (k < 0 || !inv[k]) { out[2 * j] = cur[2 * j]; out[2 * j + 1] = cur[2 * j + 1]; continue; }
      const Ai = inv[k], ux = x - c - copies[k].tx, uy = y - c - copies[k].ty, sx = Ai[0] * ux + Ai[1] * uy + c, sy = Ai[2] * ux + Ai[3] * uy + c;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) { const X = x0 + dx, Y = y0 + dy; if (X < 0 || Y < 0 || X >= G || Y >= G) continue; const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy), q = 2 * (Y * G + X); out[2 * j] += w * cur[q]; out[2 * j + 1] += w * cur[q + 1]; } }
    cur = out; }
  return cur; }
//   cavitySum(f, G, maps, k, nMax) — A PASSIVE RESONATOR WITH THE GENOME INSIDE, seen by the eye: every round trip passes the genome's
//   coherent Hutchinson element W (hutchSum, lossless, lattice-exact) and loses 1 − |k| — the transmitted field is the sum of ALL round trips,
//   ψ_out = Σ_n kⁿ·Wⁿ(ψ) = (I − k·W)⁻¹ψ (the Fabry–Pérot / Airy sum with a fractal element; valid when the round trip is fast against the
//   field's own evolution — the steady state). Summed until |k|ⁿ < 1e-3 (≤ nMax terms). Energy normalised to the input's (a display read).
//   trav (optional): THE ROUND TRIP's TRAVEL — after the element the light travels t steps through the eye's glass (w ↦ U(t)·w, the medium's
//   own propagator): a real resonator is its element AND the path between its mirrors; the glass's dispersion then decides which of the
//   cavity's (fractal) modes come back in phase — they resonate, the rest wash out.
export function cavitySum(f, G, maps, k, nMax = 24, fft = null, pupil = 0, trav = null) { const N = G * G, kk = Math.max(-0.95, Math.min(0.95, +k || 0)); if (!kk) return f;
  //   the FIXED POINT D = ψ + k·W(D), iterated (D₀ = ψ): the same element and the same fixed point as the live fold (cavityStep) — W is the
  //   energy-normalised Hutchinson element, so the round trips are summed through it rather than as separately normalised powers
  const n = Math.min(nMax, Math.max(1, Math.ceil(Math.log(1e-3) / Math.log(Math.abs(kk))))); let D = f, e0 = 0;
  for (let c = 0; c < 2 * N; c++) e0 += f[c] * f[c];
  for (let q = 0; q < n; q++) { let w = hutchSum(D, G, maps, 1, fft, true, pupil); if (trav) w = trav(w); const Dn = new Float64Array(2 * N); for (let c = 0; c < 2 * N; c++) Dn[c] = f[c] + kk * w[c]; D = Dn; }
  let e1 = 0; for (let c = 0; c < 2 * N; c++) e1 += D[c] * D[c]; const sc = e1 > 0 ? Math.sqrt(e0 / e1) : 0, acc = new Float64Array(2 * N); for (let c = 0; c < 2 * N; c++) acc[c] = D[c] * sc;
  return acc; }
//   cavityStep(f, G, maps, k, S, pupil) — THE SAME RESONATOR LIVE: ONE round trip per new read, D ← ψ + k·W(D) (S.D the state it keeps).
//   A pure FOLD over the stream of reads (a scan, Renkon's collect): its fixed point is the resolvent (I − kW)⁻¹ψ of cavitySum, reached
//   as the round trips accumulate — the cavity's own time (a round trip per read) instead of ⌈log 1e-3 / log k⌉ trips per frame. A new
//   size or a first read starts from ψ. Shown at the input's energy (a display read).
export function cavityStep(f, G, maps, k, S, pupil = 0, trav = null) { const N = G * G, kk = Math.max(-0.95, Math.min(0.95, +k || 0)); if (!kk) return f;
  const prev = S.D && S.D.length === 2 * N ? S.D : f, w0 = hutchSum(prev, G, maps, 1, null, true, pupil), w = trav ? trav(w0) : w0, D = new Float64Array(2 * N); let e0 = 0, e1 = 0;
  for (let c = 0; c < 2 * N; c++) { D[c] = f[c] + kk * w[c]; e0 += f[c] * f[c]; e1 += D[c] * D[c]; } S.D = D;
  const sc = e1 > 0 ? Math.sqrt(e0 / e1) : 0, o = new Float64Array(2 * N); for (let c = 0; c < 2 * N; c++) o[c] = D[c] * sc; return o; }
//   correlate(re, im, G, ref) — ⊛ RECOGNITION (soliton-algebra's recognizePure, ahc's _xcorrScan): out(x) = Σ_y ψ(x + y)·conj(r(y)) — a
//   matched filter; bright where the pattern OCCURS (one peak per copy, at its place). Done on the pattern's SUPPORT in real space (the
//   convolution path, no transform): ref = { dx, dy, wr, wi } the pattern's cells relative to its centroid (refSupport). Energy kept.
export function refSupport(re, im, G, frac = 0.05, zm = true) { const N = G * G; let mx = 0, cx = 0, cy = 0, e = 0;
  for (let c = 0; c < N; c++) { const a = Math.hypot(re[c], im ? im[c] : 0); if (a > mx) mx = a; }
  for (let c = 0; c < N; c++) { const a = Math.hypot(re[c], im ? im[c] : 0); if (a > frac * mx) { cx += a * a * (c % G); cy += a * a * ((c / G) | 0); e += a * a; } }
  cx = Math.round(cx / (e || 1)); cy = Math.round(cy / (e || 1)); const dx = [], dy = [], wr = [], wi = [];
  for (let c = 0; c < N; c++) { const a = Math.hypot(re[c], im ? im[c] : 0); if (a > frac * mx) { dx.push((c % G) - cx); dy.push(((c / G) | 0) - cy); wr.push(+re[c]); wi.push(im ? +im[c] : 0); } }
  //   ZERO-MEAN (zm, default): the template minus its own mean over its bounding box (one cell of margin) — w′ = w − μ in the box: a flat
  //   patch (a fragment of a bigger stroke, a uniform glow) answers 0, only the pattern's SHAPE answers — the discriminative template
  //   (recognizeFull's distractor subtraction, as the correlation coefficient's numerator). μ and the box ride with the support; the norm is w′'s.
  const box = zm && dx.length ? { x0: Math.min(...dx) - 1, x1: Math.max(...dx) + 1, y0: Math.min(...dy) - 1, y1: Math.max(...dy) + 1 } : null;
  let mr = 0, mi = 0; if (box) { const A = (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1); for (let j = 0; j < wr.length; j++) { mr += wr[j]; mi += wi[j]; } mr /= A; mi /= A; box.A = A; }
  let n = 0; for (let j = 0; j < wr.length; j++) n += (wr[j] - mr) ** 2 + (wi[j] - mi) ** 2; if (box) n += (box.A - wr.length) * (mr * mr + mi * mi); n = Math.sqrt(n) || 1;
  for (let j = 0; j < wr.length; j++) { wr[j] /= n; wi[j] /= n; }
  return { dx: Int32Array.from(dx), dy: Int32Array.from(dy), wr: Float64Array.from(wr), wi: Float64Array.from(wi), ...(box ? { box, mr: mr / n, mi: mi / n } : {}) }; }
export function correlate(re, im, G, ref) { const N = G * G, or = new Float64Array(N), oi = new Float64Array(N); let e0 = 0, e1 = 0; const K = ref.wr.length;
  for (let c = 0; c < N; c++) e0 += re[c] * re[c] + im[c] * im[c];
  for (let j = 0; j < K; j++) { const ox = ref.dx[j], oy = ref.dy[j], ar = ref.wr[j], ai = -ref.wi[j];   // conj(r)
    for (let y = 0; y < G; y++) { const ys = ((y + oy) % G + G) % G * G, yd = y * G; for (let x = 0; x < G; x++) { const s0 = ys + ((x + ox) % G + G) % G, d = yd + x, a = re[s0], b = im[s0]; or[d] += a * ar - b * ai; oi[d] += a * ai + b * ar; } } }
  if (ref.box) { const b = ref.box, sr = _boxSum(re, G, b), si = _boxSum(im, G, b), cr = ref.mr, ci = -ref.mi;   // − conj(μ)·Σ_box ψ (a running window, O(N))
    for (let c = 0; c < N; c++) { or[c] -= sr[c] * cr - si[c] * ci; oi[c] -= sr[c] * ci + si[c] * cr; } }
  for (let c = 0; c < N; c++) e1 += or[c] * or[c] + oi[c] * oi[c]; const sc = e1 > 0 ? Math.sqrt(e0 / e1) : 0; for (let c = 0; c < N; c++) { or[c] *= sc; oi[c] *= sc; } return { re: or, im: oi }; }
//   Σ over the box {x0..x1, y0..y1} of f(x + dx, y + dy), on the torus — separable running windows
function _boxSum(f, G, b) { const N = G * G, t = new Float64Array(N), o = new Float64Array(N), w = (v) => ((v % G) + G) % G;
  for (let y = 0; y < G; y++) { const r = y * G; let s = 0; for (let d = b.x0; d <= b.x1; d++) s += f[r + w(d)]; for (let x = 0; x < G; x++) { t[r + x] = s; s += f[r + w(x + b.x1 + 1)] - f[r + w(x + b.x0)]; } }
  for (let x = 0; x < G; x++) { let s = 0; for (let d = b.y0; d <= b.y1; d++) s += t[w(d) * G + x]; for (let y = 0; y < G; y++) { o[y * G + x] = s; s += t[w(y + b.y1 + 1) * G + x] - t[w(y + b.y0) * G + x]; } }
  return o; }
//   correlateBank(re, im, G, refs) — SCALE-FREE RECOGNITION: the matched filter at several scales (the pattern redrawn at the genome's own
//   generation scales — a filter bank, recognizeFull's scale search as optics), the channels summed as ENERGIES (independent detectors:
//   √Σ|c_n|², a detection map; the scales do not interfere). Each channel is normalised to the input, so every scale peaks alike.
export function correlateBank(re, im, G, refs) { const N = G * G, acc = new Float64Array(N); let e0 = 0; for (let c = 0; c < N; c++) e0 += re[c] * re[c] + im[c] * im[c];
  for (const r of refs) { const o = correlate(re, im, G, r); for (let c = 0; c < N; c++) acc[c] += o.re[c] * o.re[c] + o.im[c] * o.im[c]; }
  const or = new Float64Array(N); let e1 = 0; for (let c = 0; c < N; c++) { or[c] = Math.sqrt(acc[c]); e1 += acc[c]; } const sc = e1 > 0 ? Math.sqrt(e0 / e1) : 0; for (let c = 0; c < N; c++) or[c] *= sc;
  return { re: or, im: new Float64Array(N) }; }
//   lowpassX(re, im, G, fc, M) — a SEPARABLE windowed-sinc low-pass (Blackman, ±M taps, unit DC gain, cut fc cycles/cell), in place on
//   the torus: the convolution path for a soft pupil in the dual — no transform (the medium's own way: a local stencil, as its leapfrog)
const _lpTaps = new Map();
export function lowpassX(re, im, G, fc, M = 6) { const key = fc + "|" + M; let h = _lpTaps.get(key);
  if (!h) { h = new Float64Array(2 * M + 1); let sum = 0; for (let j = -M; j <= M; j++) { const sinc = j === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * j) / (Math.PI * j), w = 0.42 + 0.5 * Math.cos(Math.PI * j / (M + 1)) + 0.08 * Math.cos(2 * Math.PI * j / (M + 1)); h[j + M] = sinc * w; sum += h[j + M]; }
    for (let j = 0; j <= 2 * M; j++) h[j] /= sum; if (_lpTaps.size > 16) _lpTaps.clear(); _lpTaps.set(key, h); }
  const L = G + 2 * M, br = new Float64Array(L), bi = new Float64Array(L), T = 2 * M + 1;
  for (let pass = 0; pass < 2; pass++) for (let a = 0; a < G; a++) { const at = (b) => pass ? b * G + a : a * G + b;
    for (let u = 0; u < L; u++) { const j = at(((u - M) % G + G) % G); br[u] = re[j]; bi[u] = im[j]; }
    for (let b = 0; b < G; b++) { let sr = 0, si = 0; for (let j = 0; j < T; j++) { const w = h[j]; sr += w * br[b + j]; si += w * bi[b + j]; } const d = at(b); re[d] = sr; im[d] = si; } } }
//   hutchUnion(f, G, maps, n) — THE HUTCHINSON OPERATOR on an OBJECT, set-wise: W(A) = ⋃_k w_k(A), per cell the strongest of the K pre-images
//   (medium.js ifsWarpEye); f interleaved [re, im]. n passes = the clock (genomeCertified: Banach's count to within a cell of the attractor).
//   The object's amplitude is kept (a transmittance: a union of masks, not a sum of energies).
export function hutchUnion(f, G, maps, n = 1) { const N = G * G; let cur = f;
  for (let q = 0; q < Math.max(1, n | 0); q++) { const out = new Float64Array(2 * N), best = new Float64Array(N);
    for (const w of maps) { const o = lensU1.apply(w, cur, G); if (!o) continue;
      for (let c = 0; c < N; c++) { const a = o[2 * c] * o[2 * c] + o[2 * c + 1] * o[2 * c + 1]; if (a > best[c]) { best[c] = a; out[2 * c] = o[2 * c]; out[2 * c + 1] = o[2 * c + 1]; } } }
    cur = out; }
  return cur; }
//   a lens as a lensU1 element (u1, or the older phase kind), else null
const _u1Of = (L) => L.kind === "u1" ? L.op : L.kind === "phase" ? { ...lensU1.id(), phase: +L.ang || 0 } : null;
const _isU1 = (L) => L.kind === "u1" || L.kind === "phase";
//   a lensU1 element WITHOUT an affine part (a phase, a gain, a tilt) is a per-cell multiplier — the ear can fold it
const _u1Diag = (op) => { const A = op.A || [1, 0, 0, 1]; return A[0] === 1 && !A[1] && !A[2] && A[3] === 1 && !op.tx && !op.ty; };

//   a space lens with only a complex multiplier (no nonlinearity, no noise) — the only kind a later space lens can be fused INTO
const _linSpace = (L) => L.kind === "space" && !L.qL && !L.amix && !L.n1;

//   fuse(chain) — merge adjacent lenses the algebra allows (order kept: nothing is moved past a lens it does not commute with)
export function fuse(chain) {
  const out = [];
  for (const L0 of chain || []) { if (!L0) continue; const L = { ...L0 }, P = out[out.length - 1];
    if (P && P.kind === "time" && L.kind === "time" && P.lam === L.lam) { P.t = (P.t | 0) + (L.t | 0); if (!P.t) out.pop(); continue; }
    if (P && _isU1(P) && _isU1(L)) { const c = lensU1.compose(_u1Of(P), _u1Of(L)); if (c) { out[out.length - 1] = { kind: "u1", op: c }; continue; } }   // the algebra's own product
    if (P && P.kind === "gate" && L.kind === "gate") { out[out.length - 1] = { kind: "gate", parts: [...(P.parts || [P]), ...(L.parts || [L])] }; continue; }
    if (P && P.kind === "space" && L.kind === "space" && _linSpace(L)) { out[out.length - 1] = _spaceProduct(P, L); continue; }
    if (L.kind === "time" && !(L.t | 0)) continue;
    out.push(L); }
  return out;
}
//   the product of two space lenses: the first's table (with its nonlinearity and noise), then the second's multiplier
function _spaceProduct(A, B) { const N = A.m.length, m = new Float64Array(N), mi = new Float64Array(N), n1 = A.n1 ? new Float64Array(N) : null, n2 = A.n2 ? new Float64Array(N) : null;
  for (let c = 0; c < N; c++) { const ar = A.m[c], ai = A.mi ? A.mi[c] : 0, br = B.m[c], bi = B.mi ? B.mi[c] : 0; m[c] = ar * br - ai * bi; mi[c] = ar * bi + ai * br;
    if (n1) { n1[c] = A.n1[c] * br - A.n2[c] * bi; n2[c] = A.n1[c] * bi + A.n2[c] * br; } }
  return { kind: "space", m, mi, n1, n2, qL: A.qL || 0, amix: A.amix || 0, key: (A.key || "s") + "*" + (B.key || "s") }; }

//   a diagonal lensU1 element as a space lens: (gain·e^{i(φ + k·ξ)}) per cell, ξ = x − (G−1)/2 (lensU1's centred frame)
function _u1Space(op, G) { const N = G * G, m = new Float64Array(N), mi = new Float64Array(N), c0 = (G - 1) / 2, g = op.gain ?? 1, ph = (op.phase || 0) + (op.prec || 0);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const th = ph + (op.kx || 0) * (x - c0) + (op.ky || 0) * (y - c0), c = y * G + x; m[c] = g * Math.cos(th); mi[c] = g * Math.sin(th); }
  return { kind: "space", m, mi, key: "u1:" + [ph, g, op.kx || 0, op.ky || 0].map((v) => +(+v).toFixed(6)).join(",") }; }
//   apply one space lens in place (real-space re, im)
export function applySpace(L, R, I) { const N = R.length, { m, mi, n1, n2 } = L, qL = L.qL || 0, amix = L.amix || 0, st = qL ? 2 * Math.PI / qL : 0;
  for (let c = 0; c < N; c++) { const r0 = R[c], i0 = I[c], a = Math.hypot(r0, i0) + 1e-4; let sr = r0, si = i0;
    if (qL) { const th = Math.floor(Math.atan2(si, sr) / st + 0.5) * st, rr = Math.hypot(sr, si); sr = rr * Math.cos(th); si = rr * Math.sin(th); }
    if (amix) { const rr = Math.hypot(sr, si); sr += (rr - sr) * amix; si *= 1 - amix; }
    const ur = m ? m[c] : 1, ui = mi ? mi[c] : 0; R[c] = ur * sr - ui * si + (n1 ? a * n1[c] : 0); I[c] = ur * si + ui * sr + (n2 ? a * n2[c] : 0); } }
//   a relabel in REAL space (pointwise there): the conjugate, the analyser θ
export function applyRelabelX(L, R, I) { const N = R.length, c2 = Math.cos(2 * (+L.pol || 0)), s2 = Math.sin(2 * (+L.pol || 0));
  for (let c = 0; c < N; c++) { let xr = R[c], xi = I[c]; if (L.cj) xi = -xi; if (L.pol) { const ur = 0.5 * (xr + c2 * xr + s2 * xi), ui = 0.5 * (xi + s2 * xr - c2 * xi); xr = ur; xi = ui; } R[c] = xr; I[c] = xi; } }
//   a gate in k (on the lattice's signed modes): pupil disk r2 (keep inside), spectral cut (kcm 1 keep ≤, 2 keep >), beam stop (bs, bsr2)
export function gated(px, py, g, G) { const H2 = G >> 1, w = (v) => ((v + H2) % G + G) % G - H2, d2 = px * px + py * py;
  if (g.r2 && d2 >= g.r2) return true;
  if (g.kcm) { if (g.kcm === 1 ? d2 > g.kc2 : d2 <= g.kc2) return true; }
  if (g.bs) for (const [bx, by] of g.bs) { const dx = w(px - bx), dy = w(py - by); if (dx * dx + dy * dy < g.bsr2) return true; }
  return false; }
export function applyGateK(L, Rk, Ik, G) { const H2 = G >> 1, parts = L.parts || [L];
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const px = x <= H2 ? x : x - G, py = y <= H2 ? y : y - G; if (parts.some((g) => gated(px, py, g, G))) { Rk[y * G + x] = 0; Ik[y * G + x] = 0; } } }

//   run(chain, field, deps) — evaluate a chain. field = { re, im, dom: "x" | "k" } (re/im are consumed). deps = { G, fft(re, im, inverse),
//   propHat(Zr, Zi, lam, T, dt) → [re, im], FDT }. Returns the field in whichever domain the last lens left it (dom says which).
export function run(chain, field, deps) { const { G, fft, propHat, FDT } = deps; let { re, im, dom } = field;
  const toX = () => { if (dom === "k") { fft(re, im, true); dom = "x"; } }, toK = () => { if (dom === "x") { fft(re, im, false); dom = "k"; } };
  for (const L of fuse(chain)) {
    if (L.kind === "space") { toX(); applySpace(L, re, im); }
    else if (L.kind === "relabel") { toX(); applyRelabelX(L, re, im); }
    else if (_isU1(L)) { toX(); const n = re.length, fl = new Float64Array(2 * n); for (let j = 0; j < n; j++) { fl[2 * j] = re[j]; fl[2 * j + 1] = im[j]; }
      const o = lensU1.apply(_u1Of(L), fl, G); if (o) { re = new Float64Array(n); im = new Float64Array(n); for (let j = 0; j < n; j++) { re[j] = o[2 * j]; im[j] = o[2 * j + 1]; } } }
    else if (L.kind === "gate") { toK(); applyGateK(L, re, im, G); }
    else if (L.kind === "corr") { toX(); const o = L.refs && L.refs.length > 1 ? correlateBank(re, im, G, L.refs) : correlate(re, im, G, L.ref || L.refs[0]); re = o.re; im = o.im; }   // ⊛ recognition (not fused, not heard)
    else if (L.kind === "cavity") { toX(); const n = re.length, fl = new Float64Array(2 * n); for (let j = 0; j < n; j++) { fl[2 * j] = re[j]; fl[2 * j + 1] = im[j]; }
      //   LIVE (a fold, one round trip per new read) when the caller names the read (deps.tag / tick) and keeps the states (deps.live, keyed by
      //   tag and the element's own signature — so a new glass or a re-fused chain does not restart the dream); else the resolvent
      const sk = L.liveKey !== undefined && deps.tag !== undefined && deps.live ? deps.tag + "|" + L.liveKey : null, S = sk ? (deps.live.get(sk) || (deps.live.size > 64 && deps.live.clear(), deps.live.set(sk, {}), deps.live.get(sk))) : null;
      const trav = L.trav && (L.trav.t | 0) > 0 ? (w) => { const m = w.length >> 1, a = new Float64Array(m), b = new Float64Array(m); for (let j = 0; j < m; j++) { a[j] = w[2 * j]; b[j] = w[2 * j + 1]; }
          fft(a, b, false); const [pr, pi] = propHat(a, b, L.trav.lam, L.trav.t | 0, FDT); fft(pr, pi, true); const o2 = new Float64Array(2 * m); for (let j = 0; j < m; j++) { o2[2 * j] = pr[j]; o2[2 * j + 1] = pi[j]; } return o2; } : null;   // forward, t steps (the glass)
      const o = S ? (deps.tick !== undefined && S.tick === deps.tick && S.o && S.o.length === 2 * n ? S.o : (S.tick = deps.tick, S.o = cavityStep(fl, G, L.maps, L.k, S, +L.pupil || 0, trav))) : cavitySum(fl, G, L.maps, L.k, L.nMax || 24, fft, +L.pupil || 0, trav); re = new Float64Array(n); im = new Float64Array(n); for (let j = 0; j < n; j++) { re[j] = o[2 * j]; im[j] = o[2 * j + 1]; } }   // (not fused, not heard)
    else if (L.kind === "time") { toK(); const T = Math.abs(L.t | 0); if (T) { const r = propHat(re, im, L.lam, T, L.t > 0 ? -FDT : FDT); re = r[0]; im = r[1]; } } }
  return { re, im, dom }; }

//   compileEar(chain) — the GPU ear runs ONE pass: a space table on the field, then (in k, at the read) one relabel and the gates.
//   Walk the fused chain: space lenses before any relabel/gate/time fold into the table; then at most one relabel; then gates. A
//   time lens barely changes a shell's energy (the pair (q, −q) both sit in it; the symplectic leapfrog conserves a shadow norm — MEASURED
//   1e-4 relative at 37 steps) — the ear's amplitudes follow one at the END; anything after it, or out of that order, is NOT heard — `skipped`.
//   (a diagonal u1 becomes a space lens BEFORE fusing — else it fuses into an affine element and is lost to the ear)
export function compileEar(chain, G = 0) { const f = fuse((chain || []).map((L) => (L && _isU1(L) && G && _u1Diag(_u1Of(L))) ? _u1Space(_u1Of(L), G) : L)), op = { table: null, cj: false, pol: 0, gates: [], skipped: [] }; let stage = 0;   // 0 table · 1 relabel · 2 gates · 3 past a time lens
  for (const L0 of f) { const L = (_isU1(L0) && G && _u1Diag(_u1Of(L0))) ? _u1Space(_u1Of(L0), G) : L0;   // a phase / tilt / gain is a per-cell multiplier: one more space lens
    if (_isU1(L)) { if (_u1Diag(_u1Of(L))) continue; op.skipped.push(L); continue; }   // (no G: a uniform phase changes no shell energy) · an AFFINE map resamples space — not one pass
    if (L.kind === "space" && stage === 0) { op.table = op.table ? (_linSpace(L) ? _spaceProduct(op.table, L) : (op.skipped.push(L), op.table)) : L; continue; }
    if (L.kind === "relabel" && stage <= 1 && !op.cj && !op.pol) { op.cj = !!L.cj; op.pol = +L.pol || 0; stage = 1; continue; }
    if (L.kind === "gate" && stage <= 2) { op.gates.push(...(L.parts || [L])); stage = 2; continue; }
    if (L.kind === "time") { stage = 3; continue; }
    op.skipped.push(L); }
  op.exact = !op.skipped.length; return op; }
