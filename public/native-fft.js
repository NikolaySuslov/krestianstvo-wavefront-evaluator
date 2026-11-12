// native-fft.js — THE FOURIER TRANSFORM BUILT FROM THE MEDIUM'S OWN OPERATIONS (Route 3, 2026-10-20).
//
//   AHC is meta-circular: what reads the medium should be made of the medium. The FFT the app borrows is, in constant-geometry
//   (Pease) form, log₂G repetitions of ONE stage, and every part of that stage is an operation the medium already has:
//
//     · the IFS SHUFFLE — the baker's map on the cells' binary addresses: the top address bit moves to the bottom (x → 2x mod 1,
//       the carry kept). Its inverse is the IFS ITSELF: the two contractions w0(x) = x/2, w1(x) = x/2 + ½, chosen by the lowest bit.
//     · the DIMER COUPLER — two neighbouring cells coupled for a quarter period, e^{−iπ/4·σx} = (1/√2)[[1, −i], [−i, 1]]: a 50:50
//       directional coupler (two waveguides side by side for a coupling length), the medium's own local coupling on a two-cell ring.
//     · PHASE PLATES — a phase per cell (the register phase, a u1 element): the coupler between two plates diag(1, i) is the Hadamard
//       butterfly (1/√2)[[1, 1], [1, −1]], and the stage's twiddle ω^((j≫s)≪s) rides the second plate.
//
//   One stage on an axis: shuffle → plate diag(1, i) on odd cells → coupler on each adjacent pair → plate (i·ω_s(j)) on odd cells.
//   After log₂G stages on each axis the field holds its UNITARY spectrum ψ̂/G, in bit-reversed order on both axes; the inverse runs
//   the exact inverse stages backwards (the IFS contractions in place of the shuffle) from bit-reversed order back to the field.
//   A propagation never needs the order: forward → the operator e^{iλ(k)t} read at the bit-reversed k → inverse (nativePropagate).
//   Every operation is unitary, local in its own address space, and exact: the composition equals the DFT to the f64 floor
//   (test/native-fft.test.mjs). Not faster than the FFT (it IS one); its value is that the transform is the medium's own.

const _isPow2 = (G) => G >= 2 && (G & (G - 1)) === 0;
const _log2 = (G) => { let n = 0; while ((1 << n) < G) n++; return n; };
//   the index of cell j along an axis of line l (axis 0: rows — x varies; axis 1: columns — y varies)
const _at = (G, axis, l, j) => (axis === 0 ? l * G + j : j * G + l);

//   bitRevTable(G) — natural index k ↔ its bit-reversed position (an involution)
const _brMemo = new Map();
export function bitRevTable(G) { let t = _brMemo.get(G); if (t) return t; const n = _log2(G); t = new Int32Array(G);
  for (let i = 0; i < G; i++) { let r = 0; for (let b = 0; b < n; b++) r |= ((i >> b) & 1) << (n - 1 - b); t[i] = r; } _brMemo.set(G, t); return t; }

//   ifsShuffle — forward: the baker's map (the halves interleaved: old j → 2j, old j + G/2 → 2j + 1); inv: the IFS contractions
//   (position p ← old 2p's / 2p+1's source: p even → p/2, p odd → (p − 1)/2 + G/2). A permutation: exact, unitary.
export function ifsShuffle(re, im, G, axis, inv = false) { const H = G >> 1, tr = new Float64Array(G), ti = new Float64Array(G);
  for (let l = 0; l < G; l++) { for (let j = 0; j < G; j++) { const c = _at(G, axis, l, j); tr[j] = re[c]; ti[j] = im[c]; }
    for (let j = 0; j < H; j++) {
      if (!inv) { const a = _at(G, axis, l, 2 * j), b = _at(G, axis, l, 2 * j + 1); re[a] = tr[j]; im[a] = ti[j]; re[b] = tr[j + H]; im[b] = ti[j + H]; }
      else { const p = _at(G, axis, l, j), q = _at(G, axis, l, j + H); re[p] = tr[2 * j]; im[p] = ti[2 * j]; re[q] = tr[2 * j + 1]; im[q] = ti[2 * j + 1]; } } } }

//   dimerCouple — each adjacent pair (2j, 2j+1) coupled for a quarter period: e^{∓iπ/4·σx} (inv: the coupling run backwards)
export function dimerCouple(re, im, G, axis, inv = false) { const s = Math.SQRT1_2, sg = inv ? 1 : -1;   // (a, b) → ((a + sg·i·b), (sg·i·a + b))/√2
  for (let l = 0; l < G; l++) for (let j = 0; j < G; j += 2) { const p = _at(G, axis, l, j), q = _at(G, axis, l, j + 1), ar = re[p], ai = im[p], br = re[q], bi = im[q];
    re[p] = s * (ar - sg * bi); im[p] = s * (ai + sg * br); re[q] = s * (br - sg * ai); im[q] = s * (bi + sg * ar); } }

//   phasePlate — the odd cells of each pair (2j+1) turned by ph(j) (the even cells untouched)
export function phasePlate(re, im, G, axis, ph) { for (let l = 0; l < G; l++) for (let j = 0; j < (G >> 1); j++) { const q = _at(G, axis, l, 2 * j + 1), a = ph(j), c = Math.cos(a), s = Math.sin(a), r = re[q], i = im[q];
  re[q] = r * c - i * s; im[q] = r * s + i * c; } }

//   nativeStage — one constant-geometry stage s on an axis (inv: its exact inverse)
export function nativeStage(re, im, G, axis, s, inv = false) { const tw = (j) => -2 * Math.PI * ((j >> s) << s) / G;
  if (!inv) { ifsShuffle(re, im, G, axis); phasePlate(re, im, G, axis, () => Math.PI / 2); dimerCouple(re, im, G, axis); phasePlate(re, im, G, axis, (j) => Math.PI / 2 + tw(j)); }
  else { phasePlate(re, im, G, axis, (j) => -Math.PI / 2 - tw(j)); dimerCouple(re, im, G, axis, true); phasePlate(re, im, G, axis, () => -Math.PI / 2); ifsShuffle(re, im, G, axis, true); } }

//   nativeFft2d — forward: the field → its unitary spectrum ψ̂/G, bit-reversed on both axes; inv: back (bit-reversed → the field)
export function nativeFft2d(re, im, G, inv = false) { if (!_isPow2(G)) throw new Error("native-fft: G must be a power of 2"); const n = _log2(G);
  if (!inv) { for (const axis of [0, 1]) for (let s = 0; s < n; s++) nativeStage(re, im, G, axis, s); }
  else { for (const axis of [1, 0]) for (let s = n - 1; s >= 0; s--) nativeStage(re, im, G, axis, s, true); } }

//   nativePropagate — the medium's linear step for time t through its own transform: ψ ← F⁻¹ e^{i·sgn·λ(k)·t} F ψ, λ read at the
//   bit-reversed k (λ: a natural-order G×G table, real part used; sgn as the caller's convention). No reordering pass.
export function nativePropagate(re, im, G, lam, t, sgn = 1) { const br = bitRevTable(G), L = lam.re || lam; nativeFft2d(re, im, G);
  for (let py = 0; py < G; py++) for (let px = 0; px < G; px++) { const c = py * G + px, k = br[py] * G + br[px], a = sgn * L[k] * t, co = Math.cos(a), si = Math.sin(a), r = re[c], i = im[c];
    re[c] = r * co - i * si; im[c] = r * si + i * co; }
  nativeFft2d(re, im, G, true); }

//   the stage's operation count, for the record: per axis per stage G/2 couplers + G phase turns + one permutation
export const NATIVE_OPS = { shuffle: "the baker's map (IFS address rotation); inverse = the IFS contractions x/2, x/2 + ½", couple: "e^{−iπ/4·σx} on adjacent pairs", plate: "a phase per odd cell" };

// ═══ THE FRACTIONAL TRANSFORM — F^a, the transform as a CONTINUUM (2026-10-20) ═══════════════════════════════════════════════════
//   F^a (a real): F^0 the field, F^1 its spectrum, F^2 its mirror, F^4 the field again, F^a·F^b = F^(a+b) — a proper-time flow of the
//   transform itself. Separable: along x, then along y (a 2D F^a = F_x^a ⊗ F_y^a). Two native forms:
//     · frftClock — THE FOURIER CLOCK: the unitary transform cycles field → spectrum → mirror → inverse spectrum → field (F⁴ = I), so its
//       eigenvalues are only 1, −i, −1, i and F^a = Σ_k b_k(a)·F^k, b_k(a) = ¼ Σ_m e^{−iπm(a−k)/2}: ONE native transform, the parity
//       permutation P = F² and a four-term mix. Exact (F¹ the DFT, the group law, unitary) — but an in-between order is a superposition
//       of the four cardinal pictures, not a picture rotating through phase space.
//     · frftLattice — THE LATTICE GRIN: the grid's own harmonic oscillator S = (the nearest-neighbour coupling, 2cos k) + (the potential
//       2cos(2πx/G)) commutes with the DFT (Candan–Kutay–Ozaktas); its eigenvectors are the lattice Hermite–Gauss modes, and
//       F^a = V·diag(e^{−iaπn/2})·Vᵀ with n each mode's order. Exact as well (F¹ the DFT) AND the optical picture: a displaced spot
//       travels a quarter circle in phase space as a goes 0 → 1, as through a GRIN rod. The basis is computed once per G (O(G³)).
//   Both: unitary, exact at the cardinal orders, additive in a.

//   nativeFft1d — the native stages along ONE axis (unitary; the result bit-reversed along that axis)
export function nativeFft1d(re, im, G, axis, inv = false) { const n = _log2(G); if (!inv) for (let s = 0; s < n; s++) nativeStage(re, im, G, axis, s); else for (let s = n - 1; s >= 0; s--) nativeStage(re, im, G, axis, s, true); }
//   a permutation along one axis: dst[j] = src[p(j)]
const _permAxis = (re, im, G, axis, p) => { const tr = new Float64Array(G), ti = new Float64Array(G);
  for (let l = 0; l < G; l++) { for (let j = 0; j < G; j++) { const c = _at(G, axis, l, p(j)); tr[j] = re[c]; ti[j] = im[c]; } for (let j = 0; j < G; j++) { const c = _at(G, axis, l, j); re[c] = tr[j]; im[c] = ti[j]; } } };
//   the four cardinal coefficients b_k(a) (complex)
const _clockB = (a) => [0, 1, 2, 3].map((k) => { let r = 0, i = 0; for (let m = 0; m < 4; m++) { const t = -Math.PI * m * (a - k) / 2; r += Math.cos(t); i += Math.sin(t); } return [r / 4, i / 4]; });

export function frftClock(re, im, G, a) { if (!_isPow2(G)) throw new Error("native-fft: G must be a power of 2"); const N = G * G, br = bitRevTable(G), B = _clockB(a), par = (j) => (G - j) % G;
  for (const axis of [0, 1]) { const x0r = Float64Array.from(re), x0i = Float64Array.from(im), x1r = Float64Array.from(re), x1i = Float64Array.from(im);
    nativeFft1d(x1r, x1i, G, axis); _permAxis(x1r, x1i, G, axis, (j) => br[j]);   // F (natural order)
    const x2r = Float64Array.from(x0r), x2i = Float64Array.from(x0i), x3r = Float64Array.from(x1r), x3i = Float64Array.from(x1i); _permAxis(x2r, x2i, G, axis, par); _permAxis(x3r, x3i, G, axis, par);   // P = F², P·F = F³
    const X = [[x0r, x0i], [x1r, x1i], [x2r, x2i], [x3r, x3i]];
    for (let c = 0; c < N; c++) { let r = 0, i = 0; for (let k = 0; k < 4; k++) { const [br_, bi_] = B[k], xr = X[k][0][c], xi = X[k][1][c]; r += br_ * xr - bi_ * xi; i += br_ * xi + bi_ * xr; } re[c] = r; im[c] = i; } } }

//   the symmetric eigenproblem (cyclic Jacobi, f64) — the lattice oscillator is small (G×G) and solved once per G
const _jacobi = (A, n) => { const V = new Float64Array(n * n); for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) { let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q]; if (off < 1e-26) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) { const apq = A[p * n + q]; if (Math.abs(apq) < 1e-300) continue; const th = (A[q * n + q] - A[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k * n + p], akq = A[k * n + q]; A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p * n + k], aqk = A[q * n + k]; A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k * n + p], vkq = V[k * n + q]; V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; } } }
  return { ev: Float64Array.from({ length: n }, (_, i) => A[i * n + i]), V }; };   // V: columns are the eigenvectors

//   latticeOscillator(G) — the lattice Hermite–Gauss basis: rows H[n·G + u] (mode n, cell u, centred on the cell 0 of the torus) and
//   each mode's ORDER. S has DEGENERATE eigenvalues (two modes of different Fourier classes at one level), so S is diagonalised INSIDE
//   each of the DFT's four eigenspaces (MEASURED: diagonalised whole, the mixed vectors gave F¹ ≠ the DFT, 4e-2 at G 64): the projectors
//   P_c = ¼ Σ_k i^{ck} F^k are REAL — ¼(I + P ± 2·cos-transform), ¼(I − P ± 2·sin-transform) — and in class c the modes, ranked by their
//   S level (highest first), take the orders c, c + 4, c + 8, …: every mode is a Hermite–Gauss mode AND a Fourier eigenvector.
//   sym (optional, 2026-10-26 — THE NATIVE OSCILLATOR): a G-long even symbol λ₁ (natural order, λ₁(0) = 0 — e.g. the medium's own dispersion
//   along an axis). CKO's S is the nearest-neighbour Laplacian's circulant C plus its Fourier dual diag(2cos − 2): the propagator's generator plus
//   the lens's. With sym, S = C_sym + diag(sym) — the same construction on the given medium (commutes with the DFT: sym even). symKey names it
//   for the memo. Without sym: exactly as before.
const _oscMemo = new Map();
export function latticeOscillator(G, sym = null, symKey = null) { const mk = sym ? G + "|" + symKey : G; let O = _oscMemo.get(mk); if (O) return O; const n2 = G * G, sq = 1 / Math.sqrt(G), S = new Float64Array(n2);
  let cK = null; if (sym) { cK = new Float64Array(G); for (let d = 0; d < G; d++) { let v = 0; for (let k = 0; k < G; k++) v += sym[k] * Math.cos(2 * Math.PI * k * d / G); cK[d] = v / G; } for (let n = 0; n < G; n++) S[n * G + n] = sym[n]; }   // the circulant's kernel (the inverse DFT of an even symbol: real, even) and the dual diagonal
  else for (let n = 0; n < G; n++) { S[n * G + n] = 2 * Math.cos(2 * Math.PI * n / G) - 4; }   // the diagonal (the potential + the coupling's −2); the ±1 neighbours applied directly below
  const Cs = new Float64Array(n2), Sn = new Float64Array(n2); for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) { const t = 2 * Math.PI * a * b / G; Cs[a * G + b] = Math.cos(t) * sq; Sn[a * G + b] = Math.sin(t) * sq; }
  const Pm = (c) => { const M = new Float64Array(n2); for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) { const par = ((G - a) % G) === b ? 1 : 0, id = a === b ? 1 : 0;
      M[a * G + b] = c % 2 === 0 ? (id + par + (c === 0 ? 2 : -2) * Cs[a * G + b]) / 4 : (id - par + (c === 1 ? 2 : -2) * Sn[a * G + b]) / 4; } return M; };   // F = Cs − i·Sn (unitary, forward)
  //   per class: an orthonormal basis Q of the eigenspace (Gram–Schmidt over the projector's own columns, ~G/4 of them), then S inside it
  //   (k×k, k ≈ G/4: the eigen-step ~1/16 of the whole — MEASURED the whole-grid version 1.7 s at G 128, a stall)
  const H = new Float64Array(n2), order = new Int32Array(G); let row = 0;
  for (let c = 0; c < 4; c++) { const P = Pm(c), Q = []; let dim = 0; for (let u = 0; u < G; u++) dim += P[u * G + u]; dim = Math.round(dim);   // the class's dimension = trace(P_c), exact
    //   PIVOTED Gram–Schmidt (MEASURED: the columns in plain order picked nearly dependent ones — the basis off by 1e-3): each step takes the
    //   column with the LARGEST remaining residual, re-orthogonalised twice, and removes it from all the others
    const R = Array.from({ length: G }, (_, jj) => { const v = new Float64Array(G); for (let u = 0; u < G; u++) v[u] = P[u * G + jj]; return v; }), rn = R.map((v) => v.reduce((a, x) => a + x * x, 0));
    while (Q.length < dim) { let jb = 0; for (let jj = 1; jj < G; jj++) if (rn[jj] > rn[jb]) jb = jj; const v = Float64Array.from(R[jb]);
      for (let pass = 0; pass < 2; pass++) for (const q of Q) { let d = 0; for (let u = 0; u < G; u++) d += q[u] * v[u]; for (let u = 0; u < G; u++) v[u] -= d * q[u]; }
      let nn = 0; for (let u = 0; u < G; u++) nn += v[u] * v[u]; nn = 1 / Math.sqrt(nn); for (let u = 0; u < G; u++) v[u] *= nn; Q.push(v);
      for (let jj = 0; jj < G; jj++) { const w = R[jj]; let d = 0; for (let u = 0; u < G; u++) d += v[u] * w[u]; for (let u = 0; u < G; u++) w[u] -= d * v[u]; rn[jj] = w.reduce((a, x) => a + x * x, 0); } }
    const k = Q.length, SQ = Q.map((q) => { const w = new Float64Array(G); if (cK) { for (let u = 0; u < G; u++) { let v = S[u * G + u] * q[u]; for (let d = 0; d < G; d++) v += cK[d] * q[(u + G - d) % G]; w[u] = v; } return w; } for (let u = 0; u < G; u++) w[u] = S[u * G + u] * q[u] + q[(u + 1) % G] + q[(u + G - 1) % G]; return w; }), M = new Float64Array(k * k);
    for (let a = 0; a < k; a++) for (let b = a; b < k; b++) { let d = 0; for (let u = 0; u < G; u++) d += Q[a][u] * SQ[b][u]; M[a * k + b] = d; M[b * k + a] = d; }
    const { ev, V } = _jacobi(M, k), idx = Array.from({ length: k }, (_, i) => i).sort((x, y) => ev[y] - ev[x]);
    idx.forEach((col, r) => { for (let u = 0; u < G; u++) { let v = 0; for (let a = 0; a < k; a++) v += Q[a][u] * V[a * k + col]; H[row * G + u] = v; } order[row] = c + 4 * r; row++; }); }
  if (row !== G) throw new Error("native-fft: the lattice oscillator's classes did not span the grid (" + row + " of " + G + ")");
  O = { G, H, order }; if (_oscMemo.size > 4) _oscMemo.clear(); _oscMemo.set(mk, O); return O; }

export function frftLattice(re, im, G, a, sym = null, symKey = null) { const { H, order } = sym ? latticeOscillator(G, sym, symKey) : latticeOscillator(G), N = G * G, pr = new Float64Array(G), pi = new Float64Array(G);
  for (let n = 0; n < G; n++) { const t = -a * Math.PI * order[n] / 2; pr[n] = Math.cos(t); pi[n] = Math.sin(t); }
  const cr = new Float64Array(G), ci = new Float64Array(G);
  for (const axis of [0, 1]) for (let l = 0; l < G; l++) {
    for (let n = 0; n < G; n++) { let sr = 0, si = 0; const o = n * G; for (let u = 0; u < G; u++) { const h = H[o + u], c = _at(G, axis, l, u); sr += h * re[c]; si += h * im[c]; } cr[n] = sr * pr[n] - si * pi[n]; ci[n] = sr * pi[n] + si * pr[n]; }
    for (let u = 0; u < G; u++) { let sr = 0, si = 0; for (let n = 0; n < G; n++) { const h = H[n * G + u]; sr += h * cr[n]; si += h * ci[n]; } const c = _at(G, axis, l, u); re[c] = sr; im[c] = si; } } }


//   frftCentred — F^a about the grid's CENTRE (cell G/2 on each axis: the eye's images sit there), form "clock" | "lattice": the centre rolled
//   to the origin (an exact permutation), the transform, rolled back
export function frftCentred(re, im, G, a, form = "lattice", sym = null, symKey = null) { if (!(Math.abs(a) > 1e-12)) return; const H = G >> 1, roll = (s) => { for (const axis of [0, 1]) _permAxis(re, im, G, axis, (j) => (j + s + G) % G); };
  roll(H); if (form === "clock") frftClock(re, im, G, a); else frftLattice(re, im, G, a, form === "native" ? sym : null, symKey); roll(-H); }   // form "native" (2026-10-26): the native oscillator (sym, symKey — latticeOscillator)

//   frftMatrix(G, a, form) — F^a along ONE axis as a G×G complex matrix about the centre (row x = output cell, column u = input cell),
//   memoised per (G, a, form): the GPU applies it as two separable passes (IFSGpu.viewSepMat). The clock: b₀I + b₁F + b₂P + b₃PF in closed
//   form (O(G²)); the lattice GRIN: Σ_n H_n(x)·e^{−iaπ·order_n/2}·H_n(u) (O(G³) once per order a).
const _matMemo = new Map();
//   form "native" (2026-10-26): the lattice construction on latticeOscillator(G, sym, symKey) — the medium's own oscillator (sym required).
export function frftMatrix(G, a, form = "lattice", sym = null, symKey = null) { const key = G + "|" + form + (form === "native" ? ":" + symKey : "") + "|" + (Math.round(a * 1e6) / 1e6); let M = _matMemo.get(key); if (M) return M;
  const re = new Float64Array(G * G), im = new Float64Array(G * G), H2 = G >> 1, c = (j) => (j + H2) % G;   // centre ↔ the origin
  if (form === "clock") { const B = _clockB(a), s = 1 / Math.sqrt(G);
    for (let x = 0; x < G; x++) for (let u = 0; u < G; u++) { const X = c(x), U = c(u), t = -2 * Math.PI * X * U / G, fr = Math.cos(t) * s, fi = Math.sin(t) * s, pr = (X === ((G - U) % G)) ? 1 : 0, id = X === U ? 1 : 0;
      const tP = -2 * Math.PI * X * ((G - U) % G) / G, gr = Math.cos(tP) * s, gi = Math.sin(tP) * s;   // P·F[x][u] = F[−x][u] = F[x][−u]
      const o = x * G + u; re[o] = B[0][0] * id + (B[1][0] * fr - B[1][1] * fi) + B[2][0] * pr + (B[3][0] * gr - B[3][1] * gi); im[o] = B[0][1] * id + (B[1][0] * fi + B[1][1] * fr) + B[2][1] * pr + (B[3][0] * gi + B[3][1] * gr); } }
  else { const { H, order } = form === "native" ? latticeOscillator(G, sym, symKey) : latticeOscillator(G), pr = new Float64Array(G), pi = new Float64Array(G); for (let n = 0; n < G; n++) { const t = -a * Math.PI * order[n] / 2; pr[n] = Math.cos(t); pi[n] = Math.sin(t); }
    for (let x = 0; x < G; x++) for (let u = 0; u < G; u++) { const X = c(x), U = c(u); let sr = 0, si = 0; for (let n = 0; n < G; n++) { const h = H[n * G + X] * H[n * G + U]; sr += h * pr[n]; si += h * pi[n]; } re[x * G + u] = sr; im[x * G + u] = si; } }
  M = { G, re, im, key, ...(form === "clock" ? { clock: _clockB(a) } : {}) }; if (_matMemo.size > 16) _matMemo.clear(); _matMemo.set(key, M); return M; }   // (clock: its b_k — a GPU may apply it as one FFT + a combine)

// ═══ THE FAST NATIVE FFT — the same medium operations, FUSED and of higher radix (2026-10-20) ══════════════════════════════════════
//   Self-sorting (Stockham) mixed radix: each stage is ONE sweep that reads through the radix-r IFS shuffle (the address rotated by log₂r
//   bits: x[q + s·(p + j·m)], the r-map IFS's own address shift), meets an r-way COUPLER (an r-point DFT — a 4×4 multimode coupler for r 4,
//   twiddle-free: ±1, ±i) and a PHASE PLATE (the twiddle w_p^k, precomputed), and writes in natural order (no reordering pass). Radix 4 with
//   one radix-2 stage when log₂G is odd. The app's conventions (like mixedRadix2d): forward unnormalised, inverse with 1/(G·G).
const _fastPlan = new Map();
const _planOf = (G) => { let P = _fastPlan.get(G); if (P) return P; const fac = []; let n = G; while (n % 4 === 0 && n > 1) { fac.push(4); n /= 4; } if (n === 2) fac.push(2);
  const st = []; n = G; let s = 1; for (const r of fac) { const m = n / r, tw = new Float64Array(2 * m * r); for (let p = 0; p < m; p++) for (let k = 0; k < r; k++) { const a = -2 * Math.PI * p * k / n; tw[2 * (p * r + k)] = Math.cos(a); tw[2 * (p * r + k) + 1] = Math.sin(a); }
    st.push({ r, m, s, n, tw }); n = m; s *= r; } P = { G, st, ar: new Float64Array(G), ai: new Float64Array(G), br: new Float64Array(G), bi: new Float64Array(G) }; _fastPlan.set(G, P); return P; };
const _fastLine = (P, inv) => { let xr = P.ar, xi = P.ai, yr = P.br, yi = P.bi; const sg = inv ? -1 : 1;   // (sg flips the twiddles and the coupler's ±i: the inverse)
  for (const { r, m, s, tw } of P.st) {
    for (let p = 0; p < m; p++) for (let q = 0; q < s; q++) { const i0 = q + s * p;
      if (r === 4) { const i1 = i0 + s * m, i2 = i1 + s * m, i3 = i2 + s * m, a0r = xr[i0], a0i = xi[i0], a1r = xr[i1], a1i = xi[i1], a2r = xr[i2], a2i = xi[i2], a3r = xr[i3], a3i = xi[i3];
        const t0r = a0r + a2r, t0i = a0i + a2i, t1r = a0r - a2r, t1i = a0i - a2i, t2r = a1r + a3r, t2i = a1i + a3i, ur = a1r - a3r, ui = a1i - a3i, t3r = sg * ui, t3i = -sg * ur;   // t3 = ∓i·(a1 − a3)
        const o = q + s * 4 * p, w = 8 * p, y1r = t1r + t3r, y1i = t1i + t3i, y2r = t0r - t2r, y2i = t0i - t2i, y3r = t1r - t3r, y3i = t1i - t3i;
        const w1r = tw[w + 2], w1i = sg * tw[w + 3], w2r = tw[w + 4], w2i = sg * tw[w + 5], w3r = tw[w + 6], w3i = sg * tw[w + 7];
        yr[o] = t0r + t2r; yi[o] = t0i + t2i; yr[o + s] = y1r * w1r - y1i * w1i; yi[o + s] = y1r * w1i + y1i * w1r;
        yr[o + 2 * s] = y2r * w2r - y2i * w2i; yi[o + 2 * s] = y2r * w2i + y2i * w2r; yr[o + 3 * s] = y3r * w3r - y3i * w3i; yi[o + 3 * s] = y3r * w3i + y3i * w3r; }
      else { const i1 = i0 + s * m, a0r = xr[i0], a0i = xi[i0], a1r = xr[i1], a1i = xi[i1], o = q + s * 2 * p, w = 4 * p, dr = a0r - a1r, di = a0i - a1i, wr = tw[w + 2], wi = sg * tw[w + 3];
        yr[o] = a0r + a1r; yi[o] = a0i + a1i; yr[o + s] = dr * wr - di * wi; yi[o + s] = dr * wi + di * wr; } }
    let t = xr; xr = yr; yr = t; t = xi; xi = yi; yi = t; }
  return [xr, xi]; };
//   nativeFftFast1d — ONE line through the same fused native stages (2026-11-08, inert addition: the ⚛ phase space's lag transform); in place, n a
//   power of 2, the app's conventions: forward unnormalised, inverse with 1/n
export function nativeFftFast1d(re, im, n, inv = false) { const P = _planOf(n), sc = inv ? 1 / n : 1; for (let x = 0; x < n; x++) { P.ar[x] = re[x]; P.ai[x] = im[x]; } const [xr, xi] = _fastLine(P, inv); for (let x = 0; x < n; x++) { re[x] = xr[x] * sc; im[x] = xi[x] * sc; } }
export function nativeFftFast2d(re, im, G, inv = false) { const P = _planOf(G), sc = inv ? 1 / G : 1;
  for (let y = 0; y < G; y++) { const o = y * G; for (let x = 0; x < G; x++) { P.ar[x] = re[o + x]; P.ai[x] = im[o + x]; } const [xr, xi] = _fastLine(P, inv); for (let x = 0; x < G; x++) { re[o + x] = xr[x] * sc; im[o + x] = xi[x] * sc; } }
  for (let x = 0; x < G; x++) { for (let y = 0; y < G; y++) { P.ar[y] = re[y * G + x]; P.ai[y] = im[y * G + x]; } const [xr, xi] = _fastLine(P, inv); for (let y = 0; y < G; y++) { re[y * G + x] = xr[y] * sc; im[y * G + x] = xi[y] * sc; } } }
