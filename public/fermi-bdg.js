// ⚛F fermi-bdg.js — A SPIN-½ FERMI GAS IN A ROUND TRAP, PAIRED (Bogoliubov–de Gennes), on the medium's own dispersion (2026-11-09).
//
//   Pauli cannot live in one c-field, so the fermions here are ORBITALS: the single-particle problem h = ε(|k|) + V(r) — ε the medium's own
//   kinetic (its Ω(k), angle-averaged: the medium is round to 0.3–1 % at these k — a declared approximation), V the ◠ bowl — is solved per
//   angular momentum ℓ in a FOURIER–BESSEL basis on a disc of radius Rb (Dirichlet): J_ℓ(α_ℓj r/Rb), on which ANY isotropic ε(k) is exactly
//   diagonal (ε(α_ℓj/Rb)) — the medium's non-k² kinetic enters with no approximation beyond the disc. Pairing: a contact attraction between
//   ↑ and ↓, regularised by the medium's own two-body bound state E_b (in 2-D every attraction binds): 1/g = (1/2π)∫₀^{k_c} k dk / (2ε(k) + E_b),
//   the same k_c as the basis. BdG, self-consistent in Δ(r) and μ (N fixed), at temperature T; a vortex Δ(r)·e^{iκθ} couples ℓ↑ with (ℓ−κ)↓ —
//   its core's Andreev (Caroli–de Gennes–Matricon) states come out of the same blocks. Pure and deterministic (same inputs → same numbers on
//   every peer); the work is split into UNITS (one ℓ block each) so the caller can pace it on beats.
//
//   Conventions: ħ = 1, energies per unit (proper) time, lengths in cells; u(r,θ) = u_r(r)·e^{iℓθ}/√(2π), ∫(u_r² + v_r²) r dr = 1.
//   Δ(r) = g/(2π)·Σ_{E>0} u_r v_r (1 − 2f(E));  n_σ(r) = 1/(2π)·Σ_{E>0} [u_r² f(E) + v_r² (1 − f(E))].

//   J_0..J_N(x) by Miller's backward recurrence, normalised by J0 + 2ΣJ_2m = 1
export function besselJAll(x, N) {
  const J = new Float64Array(N + 1); if (x === 0) { J[0] = 1; return J; }
  const big = Math.max(N, x), M = 2 * Math.floor((big + 30 + Math.sqrt(60 * big)) / 2);
  let jp1 = 0, j = 1e-30, sum = 0;
  for (let k = M; k >= 1; k--) { const jm1 = (2 * k / x) * j - jp1; jp1 = j; j = jm1;   // j = J_{k−1}
    if (Math.abs(j) > 1e200) { j *= 1e-200; jp1 *= 1e-200; sum *= 1e-200; for (let q = k - 1; q <= N; q++) J[q] *= 1e-200; }
    if (k - 1 <= N) J[k - 1] = j; if (k - 1 > 0 && (k - 1) % 2 === 0) sum += 2 * j; }
  sum += j; const s = 1 / sum; for (let q = 0; q <= N; q++) J[q] *= s; return J;
}
const besselJ = (n, x) => besselJAll(x, n)[n];

//   real symmetric eigen (JAMA tred2 + tql2): A n×n row-major (destroyed) → { d ascending, V columns (V[i*n + k] = component i of vector k) }
export function symEig(A, n) {
  const V = A, d = new Float64Array(n), e = new Float64Array(n);
  for (let j = 0; j < n; j++) d[j] = V[(n - 1) * n + j];
  for (let i = n - 1; i > 0; i--) { let scale = 0, h = 0; for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) { e[i] = d[i - 1]; for (let j = 0; j < i; j++) { d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0; V[j * n + i] = 0; } }
    else { for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1], g = Math.sqrt(h); if (f > 0) g = -g; e[i] = scale * g; h -= f * g; d[i - 1] = f - g; for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) { f = d[j]; V[j * n + i] = f; g = e[j] + V[j * n + j] * f; for (let k = j + 1; k <= i - 1; k++) { g += V[k * n + j] * d[k]; e[k] += V[k * n + j] * f; } e[j] = g; }
      f = 0; for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; } const hh = f / (h + h); for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) { f = d[j]; g = e[j]; for (let k = j; k <= i - 1; k++) V[k * n + j] -= (f * e[k] + g * d[k]); d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0; } }
    d[i] = h; }
  for (let i = 0; i < n - 1; i++) { V[(n - 1) * n + i] = V[i * n + i]; V[i * n + i] = 1; const h = d[i + 1];
    if (h !== 0) { for (let k = 0; k <= i; k++) d[k] = V[k * n + i + 1] / h; for (let j = 0; j <= i; j++) { let g = 0; for (let k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j]; for (let k = 0; k <= i; k++) V[k * n + j] -= g * d[k]; } }
    for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0; }
  for (let j = 0; j < n; j++) { d[j] = V[(n - 1) * n + j]; V[(n - 1) * n + j] = 0; } V[(n - 1) * n + n - 1] = 1; e[0] = 0;
  for (let i = 1; i < n; i++) e[i - 1] = e[i]; e[n - 1] = 0;
  let f = 0, tst1 = 0; const eps = Math.pow(2, -52);
  for (let l = 0; l < n; l++) { tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l])); let m = l; while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
    if (m > l) { let it = 0; do { if (++it > 60) break; let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.sqrt(p * p + 1); if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r); const dl1 = d[l + 1]; let h = g - d[l]; for (let i = l + 2; i < n; i++) d[i] -= h; f += h;
        p = d[m]; let c = 1, c2 = c, c3 = c; const el1 = e[l + 1]; let s = 0, s2 = 0;
        for (let i = m - 1; i >= l; i--) { c3 = c2; c2 = c; s2 = s; g = c * e[i]; h = c * p; r = Math.sqrt(p * p + e[i] * e[i]); e[i + 1] = s * r; s = e[i] / r; c = p / r; p = c * d[i] - s * g; d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) { h = V[k * n + i + 1]; V[k * n + i + 1] = s * V[k * n + i] + c * h; V[k * n + i] = c * V[k * n + i] - s * h; } }
        p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p; } while (Math.abs(e[l]) > eps * tst1); }
    d[l] += f; e[l] = 0; }
  const ord = Array.from({ length: n }, (_, k) => k).sort((a, b) => d[a] - d[b] || a - b), d2 = new Float64Array(n), V2 = new Float64Array(n * n);
  for (let k = 0; k < n; k++) { d2[k] = d[ord[k]]; for (let i = 0; i < n; i++) V2[i * n + k] = V[i * n + ord[k]]; } return { d: d2, V: V2 };
}
//   ⚛F THE COMPLEX HERMITIAN EIGENPROBLEM, RESUMABLE (2026-11-10, user: "complex Hermitian eigensolver — if physically honest, no degradation"): exact algebra —
//   Householder to a REAL tridiagonal (EISPACK htridi: the phases carried in τ), the tridiagonal QL (as symEigGen), the back-transform (htribk). The same spectrum and
//   eigenvectors as the real embedding [[Re, −Im], [Im, Re]] — which doubles every level and the size (2n): here n, each level once, ~2× less work.
//   Ar, Ai: the full Hermitian matrix (row-major, overwritten). Returns { d (ascending), Vr, Vi } — column k the k-th eigenvector
export function* hermEigGen(Ar, Ai, n) { const ar = Ar, ai = Ai, d = new Float64Array(n), e = new Float64Array(n), tr = new Float64Array(n), ti = new Float64Array(n);
  tr[n - 1] = 1; ti[n - 1] = 0; for (let i = 0; i < n; i++) d[i] = ar[i * n + i];
  for (let i = n - 1; i >= 0; i--) { const l = i - 1, ri = i * n; let h = 0, scale = 0, si = 0;
    if (l >= 0) { for (let k = 0; k <= l; k++) scale += Math.abs(ar[ri + k]) + Math.abs(ai[ri + k]); }
    if (l < 0 || scale === 0) { if (l >= 0) { tr[l] = 1; ti[l] = 0; } e[i] = 0; }
    else { for (let k = 0; k <= l; k++) { ar[ri + k] /= scale; ai[ri + k] /= scale; h += ar[ri + k] * ar[ri + k] + ai[ri + k] * ai[ri + k]; }
      let g = Math.sqrt(h); e[i] = scale * g; let f = Math.hypot(ar[ri + l], ai[ri + l]), skip = false;
      if (f !== 0) { tr[l] = (ai[ri + l] * ti[i] - ar[ri + l] * tr[i]) / f; si = (ar[ri + l] * ti[i] + ai[ri + l] * tr[i]) / f; h += f * g; g = 1 + g / f; ar[ri + l] *= g; ai[ri + l] *= g; if (l === 0) skip = true; }
      else { tr[l] = -tr[i]; si = ti[i]; ar[ri + l] = g; }
      if (!skip) { f = 0;
        for (let j = 0; j <= l; j++) { let gg = 0, gi = 0; const rj = j * n; for (let k = 0; k <= j; k++) { gg += ar[rj + k] * ar[ri + k] + ai[rj + k] * ai[ri + k]; gi += -ar[rj + k] * ai[ri + k] + ai[rj + k] * ar[ri + k]; }
          for (let k = j + 1; k <= l; k++) { const rk = k * n; gg += ar[rk + j] * ar[ri + k] - ai[rk + j] * ai[ri + k]; gi += -ar[rk + j] * ai[ri + k] - ai[rk + j] * ar[ri + k]; }
          e[j] = gg / h; ti[j] = gi / h; f += e[j] * ar[ri + j] - ti[j] * ai[ri + j]; }
        const hh = f / (h + h);
        for (let j = 0; j <= l; j++) { const ff = ar[ri + j], gg = e[j] - hh * ff, fi = -ai[ri + j], gi = ti[j] - hh * fi; e[j] = gg; ti[j] = -gi; const rj = j * n;
          for (let k = 0; k <= j; k++) { ar[rj + k] = ar[rj + k] - ff * e[k] - gg * ar[ri + k] + fi * ti[k] + gi * ai[ri + k]; ai[rj + k] = ai[rj + k] - ff * ti[k] - gg * ai[ri + k] - fi * e[k] - gi * ar[ri + k]; } } }
      for (let k = 0; k <= l; k++) { ar[ri + k] *= scale; ai[ri + k] *= scale; } ti[l] = -si; }
    const hh = d[i]; d[i] = ar[ri + i]; ar[ri + i] = hh; ai[ri + i] = scale * Math.sqrt(h); yield 8 * (i + 1) * (i + 1); }
  //   the tridiagonal (d, e — e[i] between i − 1 and i) by QL, its vectors Z from I
  const V = new Float64Array(n * n); for (let i = 0; i < n; i++) V[i * n + i] = 1; for (let i = 1; i < n; i++) e[i - 1] = e[i]; e[n - 1] = 0;
  let f = 0, tst1 = 0; const eps = Math.pow(2, -52);
  for (let l = 0; l < n; l++) { tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l])); let m = l; while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
    if (m > l) { let it = 0; do { if (++it > 60) break; let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.sqrt(p * p + 1); if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r); const dl1 = d[l + 1]; let h = g - d[l]; for (let i = l + 2; i < n; i++) d[i] -= h; f += h;
        p = d[m]; let c = 1, c2 = c, c3 = c; const el1 = e[l + 1]; let s = 0, s2 = 0;
        for (let i = m - 1; i >= l; i--) { c3 = c2; c2 = c; s2 = s; g = c * e[i]; h = c * p; r = Math.sqrt(p * p + e[i] * e[i]); e[i + 1] = s * r; s = e[i] / r; c = p / r; p = c * d[i] - s * g; d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) { h = V[k * n + i + 1]; V[k * n + i + 1] = s * V[k * n + i] + c * h; V[k * n + i] = c * V[k * n + i] - s * h; } }
        p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p; } while (Math.abs(e[l]) > eps * tst1); }
    d[l] += f; e[l] = 0; yield 6 * n * n; }
  //   back to the Hermitian matrix's own basis (htribk): Z ← diag(τ)·Z, then the Householder reflections
  const zr = V, zi = new Float64Array(n * n); for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) { const q = k * n + j; zi[q] = -zr[q] * ti[k]; zr[q] = zr[q] * tr[k]; }
  for (let i = 1; i < n; i++) { const l = i - 1, ri = i * n, h = ai[ri + i]; if (h === 0) continue;
    for (let j = 0; j < n; j++) { let sr = 0, sm = 0; for (let k = 0; k <= l; k++) { sr += ar[ri + k] * zr[k * n + j] - ai[ri + k] * zi[k * n + j]; sm += ar[ri + k] * zi[k * n + j] + ai[ri + k] * zr[k * n + j]; }
      sr = sr / h / h; sm = sm / h / h; for (let k = 0; k <= l; k++) { zr[k * n + j] -= sr * ar[ri + k] + sm * ai[ri + k]; zi[k * n + j] -= sm * ar[ri + k] - sr * ai[ri + k]; } } yield 8 * n * i; }
  const ord = Array.from({ length: n }, (_, k) => k).sort((a, b) => d[a] - d[b] || a - b), d2 = new Float64Array(n), Vr = new Float64Array(n * n), Vi = new Float64Array(n * n);
  for (let k = 0; k < n; k++) { d2[k] = d[ord[k]]; for (let i = 0; i < n; i++) { Vr[i * n + k] = zr[i * n + ord[k]]; Vi[i * n + k] = zi[i * n + ord[k]]; } } yield 0; return { d: d2, Vr, Vi }; }

export function* symEigGen(A, n) {   // the same, RESUMABLE: a work estimate (flops) handed out between steps — a caller paces it on beats
  const V = A, d = new Float64Array(n), e = new Float64Array(n);
  for (let j = 0; j < n; j++) d[j] = V[(n - 1) * n + j];
  for (let i = n - 1; i > 0; i--) { let scale = 0, h = 0; for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) { e[i] = d[i - 1]; for (let j = 0; j < i; j++) { d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0; V[j * n + i] = 0; } }
    else { for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1], g = Math.sqrt(h); if (f > 0) g = -g; e[i] = scale * g; h -= f * g; d[i - 1] = f - g; for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) { f = d[j]; V[j * n + i] = f; g = e[j] + V[j * n + j] * f; for (let k = j + 1; k <= i - 1; k++) { g += V[k * n + j] * d[k]; e[k] += V[k * n + j] * f; } e[j] = g; }
      f = 0; for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; } const hh = f / (h + h); for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) { f = d[j]; g = e[j]; for (let k = j; k <= i - 1; k++) V[k * n + j] -= (f * e[k] + g * d[k]); d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0; } }
    d[i] = h; yield 4 * i * i; }
  for (let i = 0; i < n - 1; i++) { V[(n - 1) * n + i] = V[i * n + i]; V[i * n + i] = 1; const h = d[i + 1];
    if (h !== 0) { for (let k = 0; k <= i; k++) d[k] = V[k * n + i + 1] / h; for (let j = 0; j <= i; j++) { let g = 0; for (let k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j]; for (let k = 0; k <= i; k++) V[k * n + j] -= g * d[k]; } }
    for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0; yield 2 * (i + 1) * (i + 1); }
  for (let j = 0; j < n; j++) { d[j] = V[(n - 1) * n + j]; V[(n - 1) * n + j] = 0; } V[(n - 1) * n + n - 1] = 1; e[0] = 0;
  for (let i = 1; i < n; i++) e[i - 1] = e[i]; e[n - 1] = 0;
  let f = 0, tst1 = 0; const eps = Math.pow(2, -52);
  for (let l = 0; l < n; l++) { tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l])); let m = l; while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
    if (m > l) { let it = 0; do { if (++it > 60) break; let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.sqrt(p * p + 1); if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r); const dl1 = d[l + 1]; let h = g - d[l]; for (let i = l + 2; i < n; i++) d[i] -= h; f += h;
        p = d[m]; let c = 1, c2 = c, c3 = c; const el1 = e[l + 1]; let s = 0, s2 = 0;
        for (let i = m - 1; i >= l; i--) { c3 = c2; c2 = c; s2 = s; g = c * e[i]; h = c * p; r = Math.sqrt(p * p + e[i] * e[i]); e[i + 1] = s * r; s = e[i] / r; c = p / r; p = c * d[i] - s * g; d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) { h = V[k * n + i + 1]; V[k * n + i + 1] = s * V[k * n + i] + c * h; V[k * n + i] = c * V[k * n + i] - s * h; } }
        p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p; } while (Math.abs(e[l]) > eps * tst1); }
    d[l] += f; e[l] = 0; yield 6 * n * n; }
  const ord = Array.from({ length: n }, (_, k) => k).sort((a, b) => d[a] - d[b] || a - b), d2 = new Float64Array(n), V2 = new Float64Array(n * n);
  for (let k = 0; k < n; k++) { d2[k] = d[ord[k]]; for (let i = 0; i < n; i++) V2[i * n + k] = V[i * n + ord[k]]; } yield 0; return { d: d2, V: V2 };
}

const fermi = (E, T) => T > 0 ? (E / T > 60 ? 0 : E / T < -60 ? 1 : 1 / (Math.exp(E / T) + 1)) : (E < 0 ? 1 : E > 0 ? 0 : 0.5);

//   the medium's ε(k) as a table on k = 0, dk, 2dk, … (angle-averaged by the caller) → a monotone linear interpolant
export function epsFromTable(tab, dk) { const n = tab.length; return (k) => { const x = k / dk, i = Math.floor(x); if (i >= n - 1) return tab[n - 1]; if (i < 0) return tab[0]; const t = x - i; return tab[i] * (1 - t) + tab[i + 1] * t; }; }

//   THE SOLVER. o: { eps(k), epsMax, R (bowl radius), V0 (its depth), Rb (the disc), Nsp (atoms per spin), ebF (E_b / E_F), tF (T / E_F),
//   kappa (the vortex winding, 0 = none), ecF (the cutoff above μ in E_F, + 2 E_b), Nq (radial points), maxIt, tol }
export function makeFermiSolver(o) {
  const rCore = o.rCore || 4, eps = o.eps, R = o.R, V0 = o.V0, Rb = o.Rb || R + 6, Nsp = o.Nsp, kappa = o.kappa | 0, Nq = o.Nq || 480, maxIt = o.maxIt || 120, tol = o.tol || 2e-4;
  const Vr = (r) => V0 * Math.min(1, (r * r) / (R * R)), rq = new Float64Array(Nq), wq = new Float64Array(Nq), Vq = new Float64Array(Nq);
  for (let q = 0; q < Nq; q++) { rq[q] = (q + 0.5) * Rb / Nq; wq[q] = rq[q] * Rb / Nq; Vq[q] = Vr(rq[q]); }
  const S = { phase: "basisA", L: [], ell: 0, kc: 0, EF: null, mu: null, g: 0, Eb: 0, T: 0, Ec: 0, it: 0, blk: 0, delta: null, dens: null, acc: null, hist: [], spec: [], nk: null, done: false, err: null };
  //   one |ℓ| channel of the basis: Bessel zeros α < kc·Rb, H = diag ε(α/Rb) + V, its eigenstates on the radial grid
  const channel = (l, kc) => { const xmax = kc * Rb; if (l + 1 > xmax) return null; const al = []; let xa = Math.max(1e-6, l * 0.9 + 1e-3), ja = besselJ(l, xa), dx = 0.05;
    for (let x = xa + dx; x <= xmax + dx && al.length < 400; x += dx) { const jb = besselJ(l, x); if (ja * jb < 0) { let a = x - dx, b = x, fa = ja; for (let t = 0; t < 50; t++) { const m = 0.5 * (a + b), fm = besselJ(l, m); if (fa * fm <= 0) b = m; else { a = m; fa = fm; } } const z = 0.5 * (a + b); if (z <= xmax) al.push(z); } ja = jb; }
    const nb = al.length; if (!nb) return null; const Phi = new Float64Array(nb * Nq), k = new Float64Array(nb);
    for (let j = 0; j < nb; j++) { k[j] = al[j] / Rb; const nrm = Math.SQRT2 / (Rb * Math.abs(besselJ(l + 1, al[j]))); for (let q = 0; q < Nq; q++) Phi[j * Nq + q] = nrm * besselJ(l, al[j] * rq[q] / Rb); }
    const H = new Float64Array(nb * nb); for (let i = 0; i < nb; i++) for (let j = i; j < nb; j++) { let s = 0; for (let q = 0; q < Nq; q++) s += Phi[i * Nq + q] * Vq[q] * Phi[j * Nq + q] * wq[q]; if (i === j) s += eps(k[i]); H[i * nb + j] = s; H[j * nb + i] = s; }
    const { d, V } = symEig(H, nb), psi = new Float64Array(nb * Nq); for (let n = 0; n < nb; n++) for (let q = 0; q < Nq; q++) { let s = 0; for (let j = 0; j < nb; j++) s += V[j * nb + n] * Phi[j * Nq + q]; psi[n * Nq + q] = s; }
    return { l, nb, e: d, Z: V, psi, k }; };
  //   the ideal sea: μ from N per spin (levels ℓ and −ℓ both)
  const idealMu = (T) => { const lv = []; for (const c of S.L) for (let n = 0; n < c.nb; n++) lv.push([c.e[n], c.l ? 2 : 1]); lv.sort((a, b) => a[0] - b[0]);
    let cnt = 0, eF = lv[0][0], nxt = null; for (const [e, m] of lv) { if (cnt < Nsp) { cnt += m; eF = e; } else { nxt = e; break; } }
    if (!(T > 0)) return { EF: eF, mu: nxt != null ? 0.5 * (eF + nxt) : eF, top: nxt };
    let a = lv[0][0] - 20 * T, b = lv[lv.length - 1][0]; for (let t = 0; t < 100; t++) { const m = 0.5 * (a + b); let s = 0; for (const [e, mm] of lv) s += mm * fermi(e - m, T); if (s < Nsp) a = m; else b = m; } return { EF: eF, mu: 0.5 * (a + b), top: nxt }; };
  const gFrom = (Eb, kc) => { let s = 0; const n = 4000, h = kc / n; for (let i = 0; i <= n; i++) { const k = i * h, w = i === 0 || i === n ? 1 : (i % 2 ? 4 : 2); s += w * k / (2 * eps(k) + Eb); } return 1 / ((h / 3) * s / (2 * Math.PI)); };
  const blocks = () => { const Lm = S.L.length - 1, out = []; if (!kappa) { for (let l = 0; l <= Lm; l++) out.push([l, l, l ? 2 : 1]); } else { for (let l = kappa - Lm; l <= Lm; l++) if (Math.abs(l) <= Lm && Math.abs(l - kappa) <= Lm) out.push([Math.abs(l), Math.abs(l - kappa), 1, l]); } return out; };
  //   one BdG block: u in channel a, v in channel b (κ: b = |ℓ − κ|)
  const bdgBlock = (ca, cb, w, lsigned) => { const na = ca.nb, nbb = cb.nb, n = na + nbb, mu = S.mu, T = S.T, D = S.delta, M = new Float64Array(n * n), tmp = new Float64Array(Nq);
    for (let a = 0; a < na; a++) { for (let q = 0; q < Nq; q++) tmp[q] = ca.psi[a * Nq + q] * D[q] * wq[q]; for (let b = 0; b < nbb; b++) { let s = 0; for (let q = 0; q < Nq; q++) s += tmp[q] * cb.psi[b * Nq + q]; M[a * n + na + b] = s; M[(na + b) * n + a] = s; } M[a * n + a] = ca.e[a] - mu; }
    for (let b = 0; b < nbb; b++) M[(na + b) * n + na + b] = -(cb.e[b] - mu);
    const { d, V } = symEig(M, n), u = new Float64Array(Nq), v = new Float64Array(Nq); if (S.acc.cnt) { S.acc.cnt[ca.l] += w / 2; S.acc.cnt[cb.l] += w / 2; }   /* (the signed channels each block covers: ½ through u, ½ through v) */
    for (let m = 0; m < n; m++) { const E = d[m]; if (E <= 0) continue; const f = fermi(E, T); u.fill(0); v.fill(0); let U2 = 0, V2 = 0;
      for (let a = 0; a < na; a++) { const c = V[a * n + m]; if (!c) continue; U2 += c * c; for (let q = 0; q < Nq; q++) u[q] += c * ca.psi[a * Nq + q]; }
      for (let b = 0; b < nbb; b++) { const c = V[(na + b) * n + m]; if (!c) continue; V2 += c * c; for (let q = 0; q < Nq; q++) v[q] += c * cb.psi[b * Nq + q]; }
      for (let q = 0; q < Nq; q++) { S.acc.D[q] += w * u[q] * v[q] * (1 - 2 * f); S.acc.n[q] += w * (u[q] * u[q] * f + v[q] * v[q] * (1 - f)); }
      S.acc.N += w * (U2 * f + V2 * (1 - f));
      if (S.acc.occ) { const oa = S.acc.occ[ca.l], ob = S.acc.occ[cb.l];   /* n_σ(k): each Bessel mode's occupation — u's in channel ℓ (× f), v's in ℓ − κ (× (1 − f)) */
        for (let j = 0; j < ca.nb; j++) { let cu = 0; for (let a = 0; a < na; a++) cu += ca.Z[j * na + a] * V[a * n + m]; oa[j] += w * cu * cu * f; }
        for (let j = 0; j < cb.nb; j++) { let cv = 0; for (let b = 0; b < nbb; b++) cv += cb.Z[j * nbb + b] * V[(na + b) * n + m]; ob[j] += w * cv * cv * (1 - f); } }
      if (S.acc.ld) { const L = S.acc.ld, nR = L.nR, nE = L.nE, ib = (x) => Math.floor((x / L.Emax + 1) / 2 * nE), bp = ib(E), bm = ib(-E);   /* N(r, ω) = Σ u²·δ(ω − E) + v²·δ(ω + E) (spin ↑; per area — the radial bins' 2πr dr divided out at the end) */
        for (let q = 0; q < Nq; q++) { const rb = Math.min(nR - 1, Math.floor(rq[q] / Rb * nR)); if (bp >= 0 && bp < nE) L.a[rb * nE + bp] += w * u[q] * u[q] * wq[q]; if (bm >= 0 && bm < nE) L.a[rb * nE + bm] += w * v[q] * v[q] * wq[q]; } }
      if (S.acc.spec) { let wc = 0; for (let q = 0; q < Nq && rq[q] < rCore; q++) wc += (u[q] * u[q] + v[q] * v[q]) * wq[q]; S.acc.spec.push([lsigned ?? ca.l, E, wc]); } } };   /* (+ its weight inside the core, r < rCore: the vortex's bound states vs the cloud's edge states) */
  const startIter = (last) => { S.acc = { D: new Float64Array(Nq), n: new Float64Array(Nq), N: 0, occ: last ? S.L.map((c) => new Float64Array(c.nb)) : null, ld: last ? (() => { let dm = 0; for (const v of S.delta) dm = Math.max(dm, Math.abs(v)); return { nR: 48, nE: 96, Emax: Math.max(1.8 * dm, 0.5 * S.EF), a: new Float64Array(48 * 96) }; })() : null, cnt: last ? new Float64Array(S.L.length) : null, spec: last ? [] : null }; S.blk = 0; };
  //   after the ideal sea: the scales in E_F, the cut, the second basis (or a previous solver's, when it is the same: o.reuse)
  const afterA = (EF, mu0) => { S.EF = EF; S.Eb = (o.ebF || 0) * S.EF; S.T = (o.tF || 0) * S.EF; S.Ec = Math.min(0.999 * o.epsMax, o.ecAbsF > 0 ? o.ecAbsF * S.EF + 2 * S.Eb : mu0 + (o.ecF || 3) * S.EF + 2 * S.Eb);   /* (ecAbsF: E_c = ecAbsF·E_F + 2E_b — the live BdG's cutoff, for a like-for-like reference) */
    let a = 0, b = o.kMax; for (let t = 0; t < 60; t++) { const m = 0.5 * (a + b); if (eps(m) < S.Ec) a = m; else b = m; } S.kc = a; S.ell = 0;
    if (o.reuse && o.reuse.kc === S.kc && o.reuse.Lb) { S.L = o.reuse.Lb; S.phase = "basisB"; S.ell = 1e9; } else { S.L = []; S.phase = "basisB"; } };
  //   step(units): advance the work by ≤ units (one channel or one block each); returns true when done
  S.step = (units = 1) => { try { while (units-- > 0 && !S.done) {
      if (S.phase === "basisA" || S.phase === "basisB") { const kc = S.phase === "basisA" ? S.kcA : S.kc; const c = S.ell >= 1e9 ? null : channel(S.ell, kc); if (c) { S.L.push(c); S.ell++; continue; }
        if (S.phase === "basisA") { const id = idealMu(0); afterA(id.EF, id.mu); continue; }
        S.Lb = S.L; const id = idealMu(S.T); S.mu0 = id.mu; S.mu = id.mu; S.g = S.Eb > 0 ? gFrom(S.Eb, S.kc) : 0;
        const d0 = S.Eb > 0 ? Math.sqrt(2 * S.EF * S.Eb) : 0; S.delta = new Float64Array(Nq); for (let q = 0; q < Nq; q++) S.delta[q] = 0.6 * d0 * Math.sqrt(Math.max(0, 1 - Vq[q] / Math.max(1e-12, S.EF))) * (kappa ? rq[q] / Math.sqrt(rq[q] * rq[q] + 9) : 1);
        S.blist = blocks(); S.phase = "bdg"; S.it = 0; startIter(false); continue; }
      if (S.phase === "bdg") { if (S.blk < S.blist.length) { const [la, lb, w, ls] = S.blist[S.blk++]; bdgBlock(S.L[la], S.L[lb], w, ls); continue; }
        const Dn = new Float64Array(Nq), den = new Float64Array(Nq); let dmax = 0, dd = 0; for (let q = 0; q < Nq; q++) { Dn[q] = S.g / (2 * Math.PI) * S.acc.D[q]; den[q] = 2 * S.acc.n[q] / (2 * Math.PI); dmax = Math.max(dmax, Math.abs(Dn[q])); dd = Math.max(dd, Math.abs(Dn[q] - S.delta[q])); }
        const Nn = 2 * S.acc.N, last = !!S.acc.occ; S.dens = den; S.Ntot = Nn;
        if (last) { S.nk = []; S.L.forEach((c, l) => { const cn = S.acc.cnt[l]; if (cn > 0) for (let j = 0; j < c.nb; j++) S.nk.push([c.k[j], S.acc.occ[l][j] / cn]); }); S.nk.sort((a, b) => a[0] - b[0]);
          { const L = S.acc.ld; for (let rb = 0; rb < L.nR; rb++) { const r0 = rb * Rb / L.nR, r1 = (rb + 1) * Rb / L.nR, ar = Math.PI * (r1 * r1 - r0 * r0) * (2 * L.Emax / L.nE); for (let e = 0; e < L.nE; e++) L.a[rb * L.nE + e] /= ar; } S.ldos = L; }   /* (states per area per energy, spin ↑) */
          let gap = Infinity; for (const [, E] of S.acc.spec) gap = Math.min(gap, E); S.gap = gap; S.spec = S.acc.spec; S.delta = Dn; S.done = true; S.phase = "done"; break; }
        const errN = Nn / (2 * Nsp) - 1; S.hist.push([S.it, +(dmax / S.EF).toFixed(5), +(S.mu / S.EF).toFixed(5), +errN.toExponential(2)]);
        //   μ: N fixed (a damped step on the ideal sea's density of states, 2N/E_F per spin in a 2-D trap); Δ: linear mixing
        S.mu -= 0.5 * errN * S.EF / 2; for (let q = 0; q < Nq; q++) S.delta[q] = 0.5 * S.delta[q] + 0.5 * Dn[q];
        S.it++; const conv = (S.Eb > 0 ? dd < tol * S.EF : true) && Math.abs(errN) < 5e-4; startIter(conv || S.it >= maxIt); S.conv = conv; continue; } } } catch (e) { S.err = String(e && e.stack || e); S.done = true; } return S.done; };
  //   phase A's cut: all states the ideal sea could need — ε(k) up to V0 + E_F's scale (the bowl's lip); found by bisection on ε
  { let a = 0, b = o.kMax, tgt = Math.min(0.999 * o.epsMax, V0 * 1.2); for (let t = 0; t < 60; t++) { const m = 0.5 * (a + b); if (eps(m) < tgt) a = m; else b = m; } S.kcA = a; }
  S.rq = rq; S.wq = wq; S.Vq = Vq; S.R = R; S.Rb = Rb; S.Nsp = Nsp; S.kappa = kappa;
  if (o.reuse && o.reuse.EF != null && o.reuse.Nsp === Nsp && o.reuse.R === R && o.reuse.Rb === Rb && o.reuse.Vq && o.reuse.Vq[0] === Vq[0] && o.reuse.rq.length === Nq) afterA(o.reuse.EF, o.reuse.mu0 ?? o.reuse.EF);   /* (the same sea: skip phase A) */
  return S;
}

//   THE HOMOGENEOUS GAS on the medium's ε (T = 0, the same contact g and band as the trap's BdG): for each μ the gap Δ (1/g = ∫ k dk/2π · 1/(2E)), the density
//   n = 2∫ k dk/2π · v², and the PHASE STIFFNESS of the pair field J (E = (J/2)(∇φ)², φ the pair's phase): J = (1/8)∫ k dk/2π · (Δ²/E³)·ε′² — the diamagnetic
//   ¼Σ_σ⟨n_k ∂²ε/∂k_x²⟩ integrated by parts (ε′ only; k²: J = n/4m — the pair field's n/(2·2m)). Pure.
export function homogeneousEOS({ eps, kc, g, mus, nk = 3000 }) {
  const h = kc / nk, K = new Float64Array(nk + 1), Ek = new Float64Array(nk + 1), W = new Float64Array(nk + 1), E1 = new Float64Array(nk + 1), d = Math.min(0.02, kc / 200);
  for (let i = 0; i <= nk; i++) { const k = i * h; K[i] = k; Ek[i] = eps(k); W[i] = (h / 3) * (i === 0 || i === nk ? 1 : i % 2 ? 4 : 2) * k / (2 * Math.PI); E1[i] = (eps(Math.min(kc, k + d)) - eps(Math.max(0, k - d))) / (Math.min(kc, k + d) - Math.max(0, k - d)); }
  const ig = 1 / g, out = { mu: [], n: [], D: [], J: [] };
  for (const mu of mus) { const F = (D) => { let s = 0; for (let i = 0; i <= nk; i++) { const x = Ek[i] - mu; s += W[i] / (2 * Math.sqrt(x * x + D * D)); } return s - ig; };
    let D = 0; if (F(1e-12) > 0) { let a = 1e-12, b = 1; while (F(b) > 0 && b < 1e6) b *= 2; for (let t = 0; t < 100; t++) { const m = 0.5 * (a + b); if (F(m) > 0) a = m; else b = m; } D = 0.5 * (a + b); }
    let n = 0, J = 0; for (let i = 0; i <= nk; i++) { const x = Ek[i] - mu, E = Math.sqrt(x * x + D * D); if (E > 0) { n += 2 * W[i] * 0.5 * (1 - x / E); J += W[i] * (D * D / (E * E * E)) * E1[i] * E1[i] / 8; } else if (x < 0) n += 2 * W[i]; }
    out.mu.push(mu); out.n.push(n); out.D.push(D); out.J.push(J); }
  return out;
}
//   THE STIFFNESS AT TEMPERATURE (2026-11-09, ⚛F BKT step A): the homogeneous gas at FIXED density n and temperature T on the medium's ε — μ(T), Δ(T) from the
//   finite-T gap and number equations (1/g = ∫ tanh(E/2T)/(2E), n = ∫ 2v²-thermal = Σ W(1 − (ξ/E)·tanh(E/2T))), and the superfluid stiffness of the pair field
//   J(T) = (1/8)∫ k dk/2π · ε′²·(Δ²/E²)·[tanh(E/2T)/E − sech²(E/2T)/(2T)] — the diamagnetic ¼⟨n_k ∂²ε⟩ by parts minus the paramagnetic (thermal quasi-particle)
//   current (the Landau term); T → 0 gives homogeneousEOS's J; Δ → 0 gives 0. k²: J(0) = n/4m. Pure.
export function homogeneousT({ eps, kc, g, n, Ts, nk = 600 }) {
  const h = kc / nk, Ek = new Float64Array(nk + 1), W = new Float64Array(nk + 1), E1 = new Float64Array(nk + 1), d = Math.min(0.02, kc / 200);
  for (let i = 0; i <= nk; i++) { const k = i * h; Ek[i] = eps(k); W[i] = (h / 3) * (i === 0 || i === nk ? 1 : i % 2 ? 4 : 2) * k / (2 * Math.PI); E1[i] = (eps(Math.min(kc, k + d)) - eps(Math.max(0, k - d))) / (Math.min(kc, k + d) - Math.max(0, k - d)); }
  const ig = 1 / g, th = (E, T) => T > 0 ? Math.tanh(E / (2 * T)) : 1, sech2 = (E, T) => { if (!(T > 0)) return 0; const c = Math.cosh(Math.min(350, E / (2 * T))); return 1 / (c * c); };
  const gapAt = (mu, T) => { const F = (D) => { let s = 0; for (let i = 0; i <= nk; i++) { const x = Ek[i] - mu, E = Math.sqrt(x * x + D * D); s += E > 0 ? W[i] * th(E, T) / (2 * E) : W[i] / (4 * Math.max(T, 1e-300)); } return s - ig; };
    if (!(F(1e-10) > 0)) return 0; let a = 1e-10, b = 1; while (F(b) > 0 && b < 1e6) b *= 2; for (let t = 0; t < 70; t++) { const m = 0.5 * (a + b); if (F(m) > 0) a = m; else b = m; } return 0.5 * (a + b); };
  const nAt = (mu, D, T) => { let s = 0; for (let i = 0; i <= nk; i++) { const x = Ek[i] - mu, E = Math.sqrt(x * x + D * D); s += W[i] * (1 - (E > 0 ? (x / E) * th(E, T) : 0)); } return s; };
  const out = []; let lo0 = -1 / ig;
  for (const T of Ts) { let a = Math.min(-10, lo0) - 10 * T, b = 1; for (let t = 0; t < 40 && nAt(b, gapAt(b, T), T) < n; t++) b *= 2;
    for (let t = 0; t < 48; t++) { const m = 0.5 * (a + b); if (nAt(m, gapAt(m, T), T) < n) a = m; else b = m; } const mu = 0.5 * (a + b), D = gapAt(mu, T);
    let J = 0; if (D > 0) for (let i = 0; i <= nk; i++) { const x = Ek[i] - mu, E = Math.sqrt(x * x + D * D); J += W[i] * E1[i] * E1[i] * (D * D / (E * E)) * (th(E, T) / E - sech2(E, T) / (2 * Math.max(T, 1e-300)) * (T > 0 ? 1 : 0)) / 8; }
    out.push({ T, mu, D, J: Math.max(0, J) }); }
  return out;
}
//   THE PAIR'S OWN DISPERSION in the medium: the two-body bound state at centre-of-mass momentum K — 1/g = ∫ d²q/(2π)² · 1/(ε(|K/2 + q|) + ε(|K/2 − q|) + E_b(K))
//   (the same g and band); the pair's kinetic E_b(0) − E_b(K) (k²: K²/4m — a pair of mass 2m; the medium's ε gives its own). Past the continuum's edge (the pair
//   unbinds at large K) the edge itself. Pure.
export function pairDispersion({ eps, kc, g, Ks, nq = 300, nt = 48 }) {
  const ig = 1 / g, out = []; const qs = [], ws = []; for (let i = 0; i < nq; i++) { const q = (i + 0.5) * kc / nq; qs.push(q); ws.push(q * (kc / nq) * (Math.PI / nt) * 2 / (4 * Math.PI * Math.PI)); }
  const ct = []; for (let j = 0; j < nt; j++) ct.push(Math.cos((j + 0.5) * Math.PI / nt));
  for (const Kv of Ks) { const h = Kv / 2, A = new Float64Array(nq * nt); let emin = Infinity;
    for (let i = 0; i < nq; i++) for (let j = 0; j < nt; j++) { const q = qs[i], c = ct[j], a = Math.sqrt(Math.max(0, h * h + q * q + 2 * h * q * c)), b = Math.sqrt(Math.max(0, h * h + q * q - 2 * h * q * c)), e = eps(Math.min(kc, a)) + eps(Math.min(kc, b)); A[i * nt + j] = e; if (e < emin) emin = e; }
    const F = (Eb) => { let s = 0; for (let i = 0; i < nq; i++) { let t = 0; for (let j = 0; j < nt; j++) t += 1 / (A[i * nt + j] + Eb); s += ws[i] * t; } return s - ig; };
    let lo = -emin + 1e-9, hi = 1; if (F(lo) < 0) { out.push({ K: Kv, Eb: -emin, free: true }); continue; } while (F(hi) > 0 && hi < 1e6) hi *= 2; for (let t = 0; t < 70; t++) { const m = 0.5 * (lo + hi); if (F(m) > 0) lo = m; else hi = m; } out.push({ K: Kv, Eb: 0.5 * (lo + hi), free: false }); }
  return out;
}

//   the contact coupling from the two-body bound state E_b, over the band k < kc (the same formula the solver uses)
export function couplingFromEb(eps, Eb, kc) { let s = 0; const n = 4000, h = kc / n; for (let i = 0; i <= n; i++) { const k = i * h, w = i === 0 || i === n ? 1 : (i % 2 ? 4 : 2); s += w * k / (2 * eps(k) + Eb); } return 1 / ((h / 3) * s / (2 * Math.PI)); }

//   ⚛F THE LIVE BdG (2026-11-09, user: "the live BdG is most priority for the medium"): the orbitals live ON THE MEDIUM's LATTICE (G × G, the disc r < Rs), relaxed
//   by the medium's own imaginary-time step — e^{−τV/2}·F⁻¹ e^{−τε(k)} F·e^{−τV/2}, ε(k) = −(Ω(k) − Ω(0)) read from the LIVE medium (o.omega(beat): its per-mode phase
//   rate at that beat — every lattice mode, its anisotropy included: no angle average, no frozen eigenbasis), Pauli kept by Rayleigh–Ritz (S = ΦᵀΦ, H = Φᵀ hΦ,
//   Cholesky, the M × M eigenproblem, Φ ← ΦC); BdG in their span: the Ritz energies e_a < E_c, D_ab = Σ φ_a φ_b Δ, the 2M_c dense problem (resumable), the normal
//   and anomalous densities ρ, κ → n(x), Δ(x) = g·Σ φ_a κ_ab φ_b, Δ mixed, μ held at N; g from E_b over the live medium's modes ε < E_c (1/g = (1/G²)Σ 1/(2ε + E_b)).
//   Every few iterations a relaxation sweep re-reads the medium AT ITS BEAT: change the medium and the orbitals and Δ follow. A generator handing out work
//   estimates — the caller paces it on beats (step(budget, beat)); deterministic: the same beats, the same numbers.
//   the lattice's four-fold anisotropy of a field f on the live disc: f ≈ fit(r)·(1 + a₄ cos 4θ), the radial part fitted (r < r1), a₄ read over r0..r1. Pure.
export function aniso4Of(PX, PY, P, f, r0, r1) { const K = 6, A = new Float64Array(K * K), bb = new Float64Array(K); for (let p = 0; p < P; p++) { const r2 = (PX[p] * PX[p] + PY[p] * PY[p]) / (r1 * r1); if (r2 > 1) continue; const ph = []; let t = 1; for (let k = 0; k < K; k++) { ph.push(t); t *= r2; } for (let i = 0; i < K; i++) { bb[i] += ph[i] * f[p]; for (let j = 0; j < K; j++) A[i * K + j] += ph[i] * ph[j]; } }
    for (let i = 0; i < K; i++) { let mx = i; for (let r = i + 1; r < K; r++) if (Math.abs(A[r * K + i]) > Math.abs(A[mx * K + i])) mx = r; for (let j = 0; j < K; j++) { const t = A[i * K + j]; A[i * K + j] = A[mx * K + j]; A[mx * K + j] = t; } { const t = bb[i]; bb[i] = bb[mx]; bb[mx] = t; } for (let r = i + 1; r < K; r++) { const fct = A[r * K + i] / A[i * K + i]; for (let j = i; j < K; j++) A[r * K + j] -= fct * A[i * K + j]; bb[r] -= fct * bb[i]; } }
    const cf = new Float64Array(K); for (let i = K - 1; i >= 0; i--) { let t = bb[i]; for (let j = i + 1; j < K; j++) t -= A[i * K + j] * cf[j]; cf[i] = t / A[i * K + i]; }
    let c4 = 0, c0 = 0, w4 = 0, nr = 0; for (let p = 0; p < P; p++) { const r = Math.sqrt(PX[p] * PX[p] + PY[p] * PY[p]); if (r < r0 || r > r1) continue; const r2 = r * r / (r1 * r1); let fit = 0, t = 1; for (let k = 0; k < K; k++) { fit += cf[k] * t; t *= r2; } const c = Math.cos(4 * Math.atan2(PY[p], PX[p])); c4 += (f[p] - fit) * c; w4 += c * c; c0 += fit; nr++; }
    return w4 > 0 && c0 !== 0 ? (c4 / w4) / (c0 / nr) : 0; }   /* (f ≈ fit·(1 + a₄ cos 4θ): a₄) */

export function makeLiveBdg(o) {
  const G = o.G, N = G * G, fft2 = o.fft2, c0 = (G - 1) / 2, Rs = o.Rs; let Ec = o.Ec || 1, Nsp = o.Nsp, Eb = o.Eb || 0, T = o.T || 0, tau = o.tau || 1 / (o.Ec || 1); const _ = 0, trackEvery = o.trackEvery || 4, tol = o.tol || 2e-4;
  const pid = [], PX = [], PY = []; for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const X = x - c0, Y = y - c0; if (X * X + Y * Y < Rs * Rs) { pid.push(y * G + x); PX.push(X); PY.push(Y); } }
  const P = pid.length; let Vp = new Float64Array(P); for (let p = 0; p < P; p++) Vp[p] = o.V(PX[p], PY[p]);
  const re = new Float64Array(N), im = new Float64Array(N), FFTW = 4e6;
  const S = { P, pid, PX, PY, M: o.M, it: 0, sweeps: 0, beat: 0, mediumBeats: [], conv: false, hist: [], err: null, eps: null, g: 0, mu: null, delta: null, dens: null, e: null, spec: null, gap: null, Ntot: null, phase: "seed", form: !!o.form };
  S.Vp = Vp;
  const gOf = () => { if (!S.eps) return 0; let s = 0; for (let c = 0; c < N; c++) if (S.eps[c] < Ec) s += 1 / (2 * S.eps[c] + Eb); return Eb > 0 ? N / s : 0; };
  //   LIVE PARAMETERS (2026-11-09, user: the fermion sliders live): N, E_b, T change the RUNNING solution — no restart: g from the new E_b over the same live modes, the Fermi
  //   function at the new T, μ chasing the new N (the secant) — the orbitals and Δ keep relaxing from where they are
  //   + (2026-11-09, ⑬'s knobs live): V — a new trap (a new Vp array: the GPU's V table follows its identity); ebF — the formation's E_b/E_F (E_b, E_c, τ, g from the live
  //   E_F once the sea has formed); t1 — the formation's final T/E_F: a 300-beat ramp from the T now (S.ramp — a function of the beats)
  S.setParams = (p) => { if (p.Nsp > 0) Nsp = p.Nsp | 0; if (p.Eb > 0) { Eb = +p.Eb; S.g = gOf(); } if (p.T >= 0) T = +p.T;
    if (typeof p.V === "function") { const v = new Float64Array(P); for (let q = 0; q < P; q++) v[q] = p.V(PX[q], PY[q]); Vp = v; S.Vp = Vp; }
    if (o.form && p.ebF > 0) { o.form.ebF = +p.ebF; if (S.EF > 0 && S.coolStart != null) { Eb = o.form.ebF * S.EF; Ec = (o.form.ecF || 2) * S.EF + 2 * Eb; tau = 1 / Ec; S.Ec = Ec; S.Eb = Eb; S.g = gOf(); } }
    if (o.form && p.t1 >= 0) { if (o.form.cool) o.form.cool.t1 = +p.t1; if (S.EF > 0 && S.coolStart != null) { const Q0 = (o.form.cool && o.form.cool.Q) || 1500, left = S.ramp ? S.ramp.Q - (S.beat - S.ramp.b0) : Q0 - (S.beat - S.coolStart); S.ramp = { b0: S.beat, T0: S.Tnow ?? T, T1: +p.t1 * S.EF, Q: Math.max(300, left | 0) }; } }   /* (before the sea has formed: the first ramp's target; after: a new ramp from the T now — over what was left of the cooling, at least 300 beats: the cooling's pace kept) */
    S.params = { Nsp, Eb, T }; S._muPrev = null; S.conv = false; };
  S.params = { Nsp, Eb, T };
  const setMedium = (B) => { const Om = o.omega(B); if (!Om) return false; const eps = new Float64Array(N), o0 = Om[0]; for (let c = 0; c < N; c++) eps[c] = -(Om[c] - o0); S.eps = eps; S.g = gOf(); S.mediumBeats.push(B); if (S.mediumBeats.length > 64) S.mediumBeats.shift(); return true; };
  const toGrid = (v) => { re.fill(0); im.fill(0); for (let p = 0; p < P; p++) re[pid[p]] = v[p]; };
  const hApply = (v, out) => { toGrid(v); fft2(re, im, G, false); const e = S.eps; for (let c = 0; c < N; c++) { re[c] *= e[c]; im[c] *= e[c]; } fft2(re, im, G, true); for (let p = 0; p < P; p++) out[p] = re[pid[p]] + Vp[p] * v[p]; };
  const filt = (v) => { const a = new Float64Array(P); for (let p = 0; p < P; p++) a[p] = v[p] * Math.exp(-0.5 * tau * Vp[p]); toGrid(a); fft2(re, im, G, false); const e = S.eps; for (let c = 0; c < N; c++) { const f = Math.exp(-tau * e[c]); re[c] *= f; im[c] *= f; } fft2(re, im, G, true); for (let p = 0; p < P; p++) v[p] = re[pid[p]] * Math.exp(-0.5 * tau * Vp[p]); };
  const fermi = (E) => T > 0 ? (E / T > 60 ? 0 : E / T < -60 ? 1 : 1 / (Math.exp(E / T) + 1)) : (E < 0 ? 1 : E > 0 ? 0 : 0.5);
  let Phi = null; const M = o.M;
  //   THE ORBITAL STEPS ON THE GPU (2026-11-09, user: "moving the orbital steps to the GPU is right"): o.gpu = { begin, issue, ready, finish } — the medium's own
  //   imaginary-time step e^{−τV/2}·F⁻¹ e^{τΩ(k)} F·e^{−τV/2} applied on the GPU to TWO real orbitals per field (re, im), twice in a row, both read back (fenced):
  //   G₁ = FΦ, G₂ = F²Φ; Rayleigh–Ritz in span(G₁) — S = G₁ᵀG₁, A = G₁ᵀG₂ (the filter's own matrix: no CPU FFT), λ → e = Ω(0) − ln λ / τ (Strang, O(τ²)); while the reads
  //   are in flight the generator hands out a WAIT (−1) and the caller does not consume the next beat until they land (the stop in the stepping: the work stays the beats').
  //   Rayleigh–Ritz in span(G1) from S = G1ᵀG1 and A = G1ᵀG2 (the filter's own matrix): Cholesky S = LLᵀ, L⁻¹AL⁻ᵀ diagonalized, the coefficients C (largest λ first)
  function* ritzOf(Sm, Am) {
    const L = new Float64Array(M * M); for (let i = 0; i < M; i++) { for (let j = 0; j <= i; j++) { let sv = Sm[i * M + j]; for (let k = 0; k < j; k++) sv -= L[i * M + k] * L[j * M + k]; if (i === j) { if (!(sv > 1e-24)) throw new Error("the orbitals collapsed (S not positive)"); L[i * M + i] = Math.sqrt(sv); } else L[i * M + j] = sv / L[j * M + j]; } }
    const X = new Float64Array(M * M); for (let c = 0; c < M; c++) for (let i = 0; i < M; i++) { let sv = Am[i * M + c]; for (let k = 0; k < i; k++) sv -= L[i * M + k] * X[k * M + c]; X[i * M + c] = sv / L[i * M + i]; }
    const A = new Float64Array(M * M); for (let r = 0; r < M; r++) for (let j = 0; j < M; j++) { let sv = X[r * M + j]; for (let k = 0; k < j; k++) sv -= A[r * M + k] * L[j * M + k]; A[r * M + j] = sv / L[j * M + j]; }
    for (let i = 0; i < M; i++) for (let j = 0; j < i; j++) { const v = 0.5 * (A[i * M + j] + A[j * M + i]); A[i * M + j] = A[j * M + i] = v; }
    yield 2 * M * M * M; const gen = symEigGen(A, M); let r; for (;;) { const x = gen.next(); if (x.done) { r = x.value; break; } yield x.value; }
    const ord = Array.from({ length: M }, (_, k) => k).sort((a, b) => r.d[b] - r.d[a]);   /* (the largest λ = the lowest levels first) */
    const C = new Float64Array(M * M); for (let cc = 0; cc < M; cc++) { const c = ord[cc]; for (let i = M - 1; i >= 0; i--) { let sv = r.V[i * M + c]; for (let k = i + 1; k < M; k++) sv -= L[k * M + i] * C[k * M + cc]; C[i * M + cc] = sv / L[i * M + i]; } }
    return { C, r, ord }; }
  function* relaxGpu() { S.phase = "relax"; const g = o.gpu, h = g.begin(Phi, M, P, pid, tau, S.beat, Vp); S._gh = h; const K = Math.ceil(M / 2);
    for (let k = 0; k < K; k++) { g.issue(h, k); yield FFTW; }
    while (!g.ready(h)) { S.waiting = true; yield -1; } S.waiting = false; const { G1, G2, om0 } = g.finish(h); S._gh = null;
    const Sm = new Float64Array(M * M), Am = new Float64Array(M * M);
    for (let i = 0; i < M; i++) { const a = i * P; for (let j = 0; j <= i; j++) { const b = j * P; let s1 = 0, s2 = 0, s3 = 0; for (let p = 0; p < P; p++) { s1 += G1[a + p] * G1[b + p]; s2 += G1[a + p] * G2[b + p]; s3 += G2[a + p] * G1[b + p]; } Sm[i * M + j] = Sm[j * M + i] = s1; Am[i * M + j] = Am[j * M + i] = 0.5 * (s2 + s3); } yield 6 * (i + 1) * P; }
    const { C, r, ord } = yield* ritzOf(Sm, Am);
    const NP = new Float64Array(M * P); for (let k = 0; k < M; k++) { const o2 = k * P; for (let i = 0; i < M; i++) { const c = C[i * M + k]; if (!c) continue; const a = i * P; for (let p = 0; p < P; p++) NP[o2 + p] += c * G1[a + p]; } yield 2 * M * P; }
    Phi = NP; S.Phi = Phi; S.e = Float64Array.from(ord, (c) => om0 - Math.log(Math.max(1e-300, r.d[c])) / tau); S.sweeps++; S.gpuSweeps = (S.gpuSweeps | 0) + 1; }
  S.gpuReady = () => (S._wait ? S._wait() : true) && (!S._gh || !o.gpu || o.gpu.ready(S._gh));
  //   THE RELAXATION KEPT ON THE GPU (2026-11-10; MEASURED at 30 a spin: the CPU Gram + rotation 1.0 s of 15 and ~20 MB read back a sweep): Φ lives in the GPU's
  //   matrix texture; each pair scattered into an eye, filtered twice by the medium's own imaginary-time step, gathered back as rows of G1, G2; S, A computed there
  //   (M × M read back), the small Ritz problem here, Φ ← Cᵀ·G1 written there and read back once (the CPU's copy, for the views and the publication)
  function* relaxGpuL() { S.phase = "relax"; const l = o.lin, h = l.relaxBegin(M, P, pid, tau, S.beat, Vp), K = Math.ceil(M / 2); for (let k = 0; k < K; k++) { l.relaxPass(h, k, M, P); yield FFTW / 8; }
    const fg = yield* linWait(l.gram(M, P)), Sm = new Float64Array(M * M), Am = new Float64Array(M * M);
    for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) { Sm[a * M + b] = 0.5 * (fg[2 * (a * M + b)] + fg[2 * (b * M + a)]); Am[a * M + b] = 0.5 * (fg[2 * (a * M + b) + 1] + fg[2 * (b * M + a) + 1]); } yield 2 * M * M;
    const { C, r, ord } = yield* ritzOf(Sm, Am); const fp = yield* linWait(l.rotate(Float32Array.from(C), M, P)), NP = new Float64Array(M * P); for (let i = 0; i < M * P; i++) NP[i] = fp[2 * i]; yield 2 * M * P;
    Phi = NP; S._linRef = Phi; S.Phi = Phi; S.e = Float64Array.from(ord, (c) => h.om0 - Math.log(Math.max(1e-300, r.d[c])) / tau); S.sweeps++; S.gpuSweeps = (S.gpuSweeps | 0) + 1; S.linRelax = (S.linRelax | 0) + 1; }
  function* relax() { if (o.gpu && o.lin && o.lin.relaxBegin && linOn()) { yield* relaxGpuL(); return; } if (o.gpu) { yield* relaxGpu(); return; } S.phase = "relax"; const HP = new Float64Array(M * P), tmp = new Float64Array(P);
    for (let m = 0; m < M; m++) { const v = Phi.subarray(m * P, (m + 1) * P); filt(v); yield FFTW; }
    for (let m = 0; m < M; m++) { hApply(Phi.subarray(m * P, (m + 1) * P), tmp); HP.set(tmp, m * P); yield FFTW; }
    const Sm = new Float64Array(M * M), Hm = new Float64Array(M * M);
    for (let i = 0; i < M; i++) { const a = i * P; for (let j = 0; j <= i; j++) { const b = j * P; let s = 0, h = 0, h2 = 0; for (let p = 0; p < P; p++) { s += Phi[a + p] * Phi[b + p]; h += Phi[a + p] * HP[b + p]; h2 += HP[a + p] * Phi[b + p]; } Sm[i * M + j] = Sm[j * M + i] = s; Hm[i * M + j] = Hm[j * M + i] = 0.5 * (h + h2); } yield 6 * (i + 1) * P; }
    const L = new Float64Array(M * M); for (let i = 0; i < M; i++) { for (let j = 0; j <= i; j++) { let s = Sm[i * M + j]; for (let k = 0; k < j; k++) s -= L[i * M + k] * L[j * M + k]; if (i === j) { if (!(s > 1e-14)) throw new Error("the orbitals collapsed (S not positive)"); L[i * M + i] = Math.sqrt(s); } else L[i * M + j] = s / L[j * M + j]; } }
    const X = new Float64Array(M * M); for (let c = 0; c < M; c++) for (let i = 0; i < M; i++) { let s = Hm[i * M + c]; for (let k = 0; k < i; k++) s -= L[i * M + k] * X[k * M + c]; X[i * M + c] = s / L[i * M + i]; }   /* X = L⁻¹ H */
    const A = new Float64Array(M * M); for (let r = 0; r < M; r++) for (let j = 0; j < M; j++) { let s = X[r * M + j]; for (let k = 0; k < j; k++) s -= A[r * M + k] * L[j * M + k]; A[r * M + j] = s / L[j * M + j]; }   /* A = X L⁻ᵀ */
    for (let i = 0; i < M; i++) for (let j = 0; j < i; j++) { const v = 0.5 * (A[i * M + j] + A[j * M + i]); A[i * M + j] = A[j * M + i] = v; }
    yield 2 * M * M * M; const gen = symEigGen(A, M); let r; for (;;) { const x = gen.next(); if (x.done) { r = x.value; break; } yield x.value; }
    const C = new Float64Array(M * M); for (let c = 0; c < M; c++) for (let i = M - 1; i >= 0; i--) { let s = r.V[i * M + c]; for (let k = i + 1; k < M; k++) s -= L[k * M + i] * C[k * M + c]; C[i * M + c] = s / L[i * M + i]; }   /* C = L⁻ᵀ Q */
    const NP = new Float64Array(M * P); for (let k = 0; k < M; k++) { const o2 = k * P; for (let i = 0; i < M; i++) { const c = C[i * M + k]; if (!c) continue; const a = i * P; for (let p = 0; p < P; p++) NP[o2 + p] += c * Phi[a + p]; } yield 2 * M * P; }
    Phi = NP; S.Phi = Phi; S.e = r.d; S.sweeps++; }
  const idealMu = () => { const e = S.e, Mc = e.length; if (!(T > 0)) { const k = Math.min(Mc - 1, Nsp); return Nsp < Mc ? 0.5 * (e[Nsp - 1] + e[Nsp]) : e[Mc - 1]; } let a = e[0] - 20 * T, b = e[Mc - 1]; for (let t = 0; t < 100; t++) { const m = 0.5 * (a + b); let s = 0; for (let i = 0; i < Mc; i++) s += fermi(e[i] - m); if (s < Nsp) a = m; else b = m; } return 0.5 * (a + b); };
  //   THE VORTEX (κ ≠ 0, 2026-11-09): Δ(x) complex — the orbitals stay real (h is), D_ab = Σ φ_a φ_b Δ complex symmetric, H = [[e − μ, D], [D*, −(e − μ)]] Hermitian:
  //   its real embedding [[Re H, −Im H], [Im H, Re H]] (each level twice); ρ_ab = Σ_{E>0} U_a Ū_b f + V̄_a V_b (1 − f), κ_ab = Σ_{E>0} U_a V̄_b (1 − 2f), summed over EVERY
  //   embedding vector with E > 0 and halved — exact, a degenerate pair needs no picking; Δ = g Σ φ_a κ_ab φ_b (u v̄ ∝ Δ: the phase carried); the core weight of the low states
  //   (2026-11-10: the complex Hermitian solver — hermEigGen, exact, each level once, ~2–6× less than the real embedding; o.noHerm keeps the embedding as the reference)
  function* bdgIterC() { S.phase = "bdg"; let Mc = 0; while (Mc < M && S.e[Mc] < Ec) Mc++; const n = 2 * Mc, n2 = 2 * n, herm = !o.noHerm, H = herm ? null : new Float64Array(n2 * n2), Hr = herm ? new Float64Array(n * n) : null, Hi = herm ? new Float64Array(n * n) : null, mu = S.mu, Dr = S.delta, Di = S.dIm;
    const set = herm ? (i, j, re, imv) => { Hr[i * n + j] = re; Hi[i * n + j] = imv; } : (i, j, re, imv) => { H[i * n2 + j] = re; H[(i + n) * n2 + j + n] = re; H[(i + n) * n2 + j] = imv; H[i * n2 + j + n] = -imv; };   /* (one complex entry — or its real embedding) */
    const hr = linOn() ? o.lin.proj(Dr, Mc, P) : null; let fr = null, fi = null; if (hr) { fr = yield* linWait(hr); const hi = o.lin.proj(Di, Mc, P); fi = hi ? yield* linWait(hi) : null; }   /* (the GPU: Re and Im of D, two projections) */
    if (fr && fi) { for (let a = 0; a < Mc; a++) { for (let b = 0; b <= a; b++) { const q1 = 2 * (a * Mc + b), q2 = 2 * (b * Mc + a), sr = 0.5 * (fr[q1] + fr[q2]), si = 0.5 * (fi[q1] + fi[q2]); set(a, Mc + b, sr, si); set(b, Mc + a, sr, si); set(Mc + b, a, sr, -si); set(Mc + a, b, sr, -si); } set(a, a, S.e[a] - mu, 0); set(Mc + a, Mc + a, -(S.e[a] - mu), 0); } yield 4 * Mc * Mc; S.linN = (S.linN | 0) + 1; }
    else for (let a = 0; a < Mc; a++) { const pa = a * P; for (let b = 0; b <= a; b++) { const pb = b * P; let sr = 0, si = 0; for (let p = 0; p < P; p++) { const w = Phi[pa + p] * Phi[pb + p]; sr += w * Dr[p]; si += w * Di[p]; }
        set(a, Mc + b, sr, si); set(b, Mc + a, sr, si); set(Mc + b, a, sr, -si); set(Mc + a, b, sr, -si); } set(a, a, S.e[a] - mu, 0); set(Mc + a, Mc + a, -(S.e[a] - mu), 0); yield 4 * (a + 1) * P; }
    const gen = herm ? hermEigGen(Hr, Hi, n) : symEigGen(H, n2); let r; for (;;) { const x = gen.next(); if (x.done) { r = x.value; break; } yield x.value; }
    const rr = new Float64Array(Mc * Mc), ri = new Float64Array(Mc * Mc), kr = new Float64Array(Mc * Mc), ki = new Float64Array(Mc * Mc), spec = [], low = []; let Ns = 0; const nE = herm ? n : n2, wt = herm ? 1 : 0.5; S.hermN = (S.hermN | 0) + (herm ? 1 : 0);
    const cid = []; for (let p = 0; p < P; p++) if (PX[p] * PX[p] + PY[p] * PY[p] < (o.rCore || 4) ** 2) cid.push(p);
    for (let m = 0; m < nE; m++) { const E = r.d[m]; if (E <= 0) continue; const f = fermi(E), Ur = new Float64Array(Mc), Ui = new Float64Array(Mc), Vr = new Float64Array(Mc), Vi = new Float64Array(Mc);
      if (herm) for (let a = 0; a < Mc; a++) { Ur[a] = r.Vr[a * n + m]; Ui[a] = r.Vi[a * n + m]; Vr[a] = r.Vr[(Mc + a) * n + m]; Vi[a] = r.Vi[(Mc + a) * n + m]; }
      else for (let a = 0; a < Mc; a++) { Ur[a] = r.V[a * n2 + m]; Vr[a] = r.V[(Mc + a) * n2 + m]; Ui[a] = r.V[(n + a) * n2 + m]; Vi[a] = r.V[(n + Mc + a) * n2 + m]; }
      for (let a = 0; a < Mc; a++) for (let b = 0; b < Mc; b++) { const q = a * Mc + b;   /* U_a Ū_b · f + V̄_a V_b · (1 − f) ; U_a V̄_b · (1 − 2f) — the embedding halved (each level twice), the Hermitian once */
        rr[q] += wt * ((Ur[a] * Ur[b] + Ui[a] * Ui[b]) * f + (Vr[a] * Vr[b] + Vi[a] * Vi[b]) * (1 - f)); ri[q] += wt * ((Ui[a] * Ur[b] - Ur[a] * Ui[b]) * f + (Vr[a] * Vi[b] - Vi[a] * Vr[b]) * (1 - f));
        kr[q] += wt * (Ur[a] * Vr[b] + Ui[a] * Vi[b]) * (1 - 2 * f); ki[q] += wt * (Ui[a] * Vr[b] - Ur[a] * Vi[b]) * (1 - 2 * f); }
      spec.push(E); if (E < 1.2 * (S.EF || o.EF || 1)) { let wc = 0; for (const p of cid) { let ur = 0, ui = 0, vr = 0, vi = 0; for (let a = 0; a < Mc; a++) { const ph = Phi[a * P + p]; ur += Ur[a] * ph; ui += Ui[a] * ph; vr += Vr[a] * ph; vi += Vi[a] * ph; } wc += ur * ur + ui * ui + vr * vr + vi * vi; } low.push([E, wc]); }
      yield 8 * Mc * Mc; }   /* (paced per eigenvector — one chunk was ~100 ms) */
    yield 1; for (let a = 0; a < Mc; a++) Ns += rr[a * Mc + a];
    const dn = new Float64Array(P), dkr = new Float64Array(P), dki = new Float64Array(P), w1 = new Float64Array(P), w2 = new Float64Array(P), w3 = new Float64Array(P);
    let gpuB = false; if (linOn()) { const ks = new Float64Array(Mc * Mc), kis = new Float64Array(Mc * Mc); for (let a = 0; a < Mc; a++) for (let b = 0; b < Mc; b++) { ks[a * Mc + b] = 0.5 * (kr[a * Mc + b] + kr[b * Mc + a]); kis[a * Mc + b] = 0.5 * (ki[a * Mc + b] + ki[b * Mc + a]); }
      const h1 = o.lin.back(rr, ks, Mc, P); if (h1) { const f1 = yield* linWait(h1); const h2 = o.lin.back(kis, new Float64Array(Mc * Mc), Mc, P); if (h2) { const f2 = yield* linWait(h2); for (let p = 0; p < P; p++) { dn[p] = f1[2 * p]; dkr[p] = f1[2 * p + 1]; dki[p] = f2[2 * p]; } gpuB = true; yield 3 * P; } } }   /* (the GPU: n and Re κ, then Im κ) */
    if (!gpuB) for (let a = 0; a < Mc; a++) { w1.fill(0); w2.fill(0); w3.fill(0); for (let b = 0; b < Mc; b++) { const q = a * Mc + b, x1 = rr[q], x2 = 0.5 * (kr[q] + kr[b * Mc + a]), x3 = 0.5 * (ki[q] + ki[b * Mc + a]), pb = b * P; if (x1) for (let p = 0; p < P; p++) w1[p] += x1 * Phi[pb + p]; if (x2) for (let p = 0; p < P; p++) w2[p] += x2 * Phi[pb + p]; if (x3) for (let p = 0; p < P; p++) w3[p] += x3 * Phi[pb + p]; }
      const pa = a * P; for (let p = 0; p < P; p++) { const ph = Phi[pa + p]; dn[p] += ph * w1[p]; dkr[p] += ph * w2[p]; dki[p] += ph * w3[p]; } yield 6 * Mc * P; }
    let dd = 0, dmax = 0; const Nr = new Float64Array(P), Ni = new Float64Array(P); for (let p = 0; p < P; p++) { Nr[p] = S.g * dkr[p]; Ni[p] = S.g * dki[p]; dd = Math.max(dd, Math.hypot(Nr[p] - Dr[p], Ni[p] - Di[p])); dmax = Math.max(dmax, Math.hypot(Nr[p], Ni[p])); }
    spec.sort((x, y) => x - y); const sp1 = spec.filter((_, j) => j % 2 === 0); low.sort((x, y) => x[0] - y[0]); S.low = low.filter((_, j) => j % 2 === 0).slice(0, 12);
    const errN = Ns / Nsp - 1; S.dens = dn.map((v) => 2 * v); S.Ntot = 2 * Ns; S.spec = sp1; S.gap = sp1.length ? sp1[0] : null; S.dmax = dmax; S.rho = rr; S.rhoI = ri; S.kap = kr; S.kapI = ki; S.Phi = Phi; S.McR = Mc;
    S.hist.push([S.it, S.beat, +dmax.toPrecision(5), +S.mu.toPrecision(5), +errN.toExponential(2), +dd.toExponential(2)]); if (S.hist.length > 400) S.hist.shift();
    S.conv = dd < tol * (S.EF || o.EF || 1) && Math.abs(errN) < 5e-4; S.Mc = Mc; muStep(errN); for (let p = 0; p < P; p++) { Dr[p] = 0.5 * Dr[p] + 0.5 * Nr[p]; Di[p] = 0.5 * Di[p] + 0.5 * Ni[p]; } }
  //   THE PROJECTIONS ON THE GPU (2026-11-09, user: "the GPU turbo way"; MEASURED at 30 a spin: these M_c²·P loops were 3.2 s of 15): o.lin = { phi, proj, back, ready,
  //   finish } — Φ uploaded once per sweep, D_ab = Σ_p φ_a φ_b Δ and (n, κ)(p) = Σ_ab φ_a (ρ, κ)_ab φ_b computed there (float32), read back fenced (the WAIT: the beat's
  //   work ends while in flight — the beats stay the beats'); the work counted is the CPU's own (the fill), so an iteration costs the beats it really costs
  const linWait = function* (h) { S._wait = () => o.lin.ready(h); while (!o.lin.ready(h)) { S.waiting = true; yield -1; } S.waiting = false; S._wait = null; return o.lin.finish(h); };
  const linOn = () => { if (!o.lin) return false; if (S._linRef === Phi) return true; if (!o.lin.phi(Phi, M, P)) return false; S._linRef = Phi; return true; };
  //   ⚛F THE MEDIUM's OWN SYMMETRY SPLITS THE BdG (2026-11-10, user: "spectral harmonic analysis… native medium"): the lattice disc and the round bowl are invariant
  //   under 180° (always: k → −k, a real medium) and under 90° when the medium's own ε(k) is (its two axes equal — TESTED on its table, not assumed). When Δ carries
  //   that symmetry too (tested every iteration: its 90° / 180° asymmetry ≤ 1e-3 of its max), each orbital is an irrep — read off its characters ⟨φ|Rφ⟩, ⟨φ|R²φ⟩:
  //   C4 → A (+1), B (−1), E (R² = −1); C2 → even / odd — and D_ab = Σ φ_a Δ φ_b vanishes between irreps: the 2M_c BdG falls into blocks (C4 ≈ 6×, C2 ≈ 4× less
  //   work). Any doubt — an orbital without a clean character, an asymmetric Δ (an off-centre vortex), a complex Δ — the full problem, as before
  const rotMaps = (() => { let r1 = null, r2 = null; return () => { if (r1) return [r1, r2]; const inv = new Int32Array(N).fill(-1); for (let p = 0; p < P; p++) inv[pid[p]] = p; r1 = new Int32Array(P); r2 = new Int32Array(P);
    for (let p = 0; p < P; p++) { const x = pid[p] % G, y = (pid[p] / G) | 0; r1[p] = inv[x * G + (G - 1 - y)]; r2[p] = inv[(G - 1 - y) * G + (G - 1 - x)]; } return [r1, r2]; }; })();
  const epsC4 = () => { if (S._epsC4K === S.eps) return S._epsC4; let mx = 0, dv = 0; const e = S.eps; for (let ky = 0; ky < G; ky++) for (let kx = 0; kx < G; kx++) { const c = ky * G + kx, c2 = kx * G + ((G - ky) % G); mx = Math.max(mx, Math.abs(e[c])); dv = Math.max(dv, Math.abs(e[c] - e[c2])); }
    S._epsC4K = S.eps; S._epsC4 = dv <= 1e-9 * Math.max(mx, 1e-30); S.epsC4dev = mx > 0 ? dv / mx : 0; return S._epsC4; };
  const sectorsOf = (Mc, D) => { if (S.kappaW || S.extV || o.noSym) return null; const [r1, r2] = rotMaps(); if (r1.some((v) => v < 0) || r2.some((v) => v < 0)) return null;
    let dm = 0, a1 = 0, a2 = 0; for (let p = 0; p < P; p++) { dm = Math.max(dm, Math.abs(D[p])); a1 = Math.max(a1, Math.abs(D[p] - D[r1[p]])); a2 = Math.max(a2, Math.abs(D[p] - D[r2[p]])); }
    const tol = 1e-3 * dm + 1e-12, use4 = epsC4() && a1 <= tol; if (!use4 && a2 > tol) return null;
    const lab = new Array(Mc); for (let a = 0; a < Mc; a++) { const o0 = a * P; let c1 = 0, c2 = 0; for (let p = 0; p < P; p++) { const v = Phi[o0 + p]; c1 += v * Phi[o0 + r1[p]]; c2 += v * Phi[o0 + r2[p]]; }
      if (use4) lab[a] = c1 > 0.9 ? 0 : c1 < -0.9 ? 1 : (c2 < -0.9 && Math.abs(c1) < 0.1) ? 2 : -1; else lab[a] = c2 > 0.9 ? 0 : c2 < -0.9 ? 1 : -1; if (lab[a] < 0) return null; }
    const g = [[], [], []]; for (let a = 0; a < Mc; a++) g[lab[a]].push(a); S.symKind = use4 ? "C4" : "C2"; return g.filter((x) => x.length); };
  function* bdgIter() { S.phase = "bdg"; let Mc = 0; while (Mc < M && S.e[Mc] < Ec) Mc++; const n = 2 * Mc, H = new Float64Array(n * n), mu = S.mu, D = S.delta;
    const hp = linOn() ? o.lin.proj(D, Mc, P) : null;
    if (hp) { const f = yield* linWait(hp); for (let a = 0; a < Mc; a++) { for (let b = 0; b <= a; b++) { const s = 0.5 * (f[2 * (a * Mc + b)] + f[2 * (b * Mc + a)]); H[a * n + Mc + b] = H[(Mc + b) * n + a] = s; H[b * n + Mc + a] = H[(Mc + a) * n + b] = s; } H[a * n + a] = S.e[a] - mu; H[(Mc + a) * n + Mc + a] = -(S.e[a] - mu); } yield 2 * Mc * Mc; S.linN = (S.linN | 0) + 1; }
    else for (let a = 0; a < Mc; a++) { const pa = a * P; for (let b = 0; b <= a; b++) { const pb = b * P; let s = 0; for (let p = 0; p < P; p++) s += Phi[pa + p] * Phi[pb + p] * D[p]; H[a * n + Mc + b] = H[(Mc + b) * n + a] = s; H[b * n + Mc + a] = H[(Mc + a) * n + b] = s; } H[a * n + a] = S.e[a] - mu; H[(Mc + a) * n + Mc + a] = -(S.e[a] - mu); yield 2 * (a + 1) * P; }
    const rho = new Float64Array(Mc * Mc), kap = new Float64Array(Mc * Mc), spec = []; let Ns = 0; const secs = sectorsOf(Mc, D);
    if (secs) { for (const ix of secs) { const m = ix.length, n2 = 2 * m, Hs = new Float64Array(n2 * n2); for (let i = 0; i < m; i++) { const a = ix[i]; Hs[i * n2 + i] = H[a * n + a]; Hs[(m + i) * n2 + m + i] = H[(Mc + a) * n + Mc + a]; for (let j = 0; j < m; j++) { const v = H[a * n + Mc + ix[j]]; Hs[i * n2 + m + j] = v; Hs[(m + j) * n2 + i] = v; } }
        const gs = symEigGen(Hs, n2); let r; for (;;) { const x = gs.next(); if (x.done) { r = x.value; break; } yield x.value; }
        for (let k = 0; k < n2; k++) { const E = r.d[k]; if (E <= 0) continue; const f = fermi(E); spec.push(E); for (let i = 0; i < m; i++) { const Ua = r.V[i * n2 + k], Va = r.V[(m + i) * n2 + k], a = ix[i]; for (let j = 0; j < m; j++) { const Ub = r.V[j * n2 + k], Vb = r.V[(m + j) * n2 + k], b = ix[j]; rho[a * Mc + b] += Ua * Ub * f + Va * Vb * (1 - f); kap[a * Mc + b] += 0.5 * (Ua * Vb + Va * Ub) * (1 - 2 * f); } } } yield 4 * m * m; }
      S.symN = (S.symN | 0) + 1; S.symSizes = secs.map((x) => x.length); }
    else { S.symKind = "full"; const gen = symEigGen(H, n); let r; for (;;) { const x = gen.next(); if (x.done) { r = x.value; break; } yield x.value; }
    for (let m = 0; m < n; m++) { const E = r.d[m]; if (E <= 0) continue; const f = fermi(E); spec.push(E); for (let a = 0; a < Mc; a++) { const Ua = r.V[a * n + m], Va = r.V[(Mc + a) * n + m]; for (let b = 0; b < Mc; b++) { const Ub = r.V[b * n + m], Vb = r.V[(Mc + b) * n + m]; rho[a * Mc + b] += Ua * Ub * f + Va * Vb * (1 - f); kap[a * Mc + b] += 0.5 * (Ua * Vb + Va * Ub) * (1 - 2 * f); } } yield 4 * Mc * Mc; } }
    yield 1; for (let a = 0; a < Mc; a++) Ns += rho[a * Mc + a]; S.rho = rho; S.kap = kap; S.Phi = Phi; S.McR = Mc;   /* (exposed: the one-body ρ and the pairs' κ in the orbital basis — a phase-space view reads them) */
    const dn = new Float64Array(P), dk = new Float64Array(P), w1 = new Float64Array(P), w2 = new Float64Array(P), hb = linOn() ? o.lin.back(rho, kap, Mc, P) : null;
    if (hb) { const f = yield* linWait(hb); for (let p = 0; p < P; p++) { dn[p] = f[2 * p]; dk[p] = f[2 * p + 1]; } yield 2 * P; }
    else for (let a = 0; a < Mc; a++) { w1.fill(0); w2.fill(0); for (let b = 0; b < Mc; b++) { const r1 = rho[a * Mc + b], k1 = kap[a * Mc + b], pb = b * P; if (r1) for (let p = 0; p < P; p++) w1[p] += r1 * Phi[pb + p]; if (k1) for (let p = 0; p < P; p++) w2[p] += k1 * Phi[pb + p]; } const pa = a * P; for (let p = 0; p < P; p++) { dn[p] += Phi[pa + p] * w1[p]; dk[p] += Phi[pa + p] * w2[p]; } yield 4 * Mc * P; }
    const Dn = new Float64Array(P); let dd = 0, dmax = 0; for (let p = 0; p < P; p++) { Dn[p] = S.g * dk[p]; dd = Math.max(dd, Math.abs(Dn[p] - D[p])); dmax = Math.max(dmax, Math.abs(Dn[p])); }
    const errN = Ns / Nsp - 1; S.dens = dn.map((v) => 2 * v); S.Ntot = 2 * Ns; S.spec = spec; S.gap = spec.length ? Math.min(...spec) : null; S.dmax = dmax; S.hist.push([S.it, S.beat, +dmax.toPrecision(5), +S.mu.toPrecision(5), +errN.toExponential(2), +dd.toExponential(2)]); if (S.hist.length > 400) S.hist.shift();
    S.conv = (Eb > 0 ? dd < tol * (S.EF || o.EF || 1) : true) && Math.abs(errN) < 5e-4; S.Mc = Mc;
    muStep(errN); for (let p = 0; p < P; p++) D[p] = 0.5 * D[p] + 0.5 * Dn[p]; }
  //   μ: a SECANT step on N(μ) from the last two iterations (bounded; the damped density-of-states step when the secant is ill-posed)
  function muStep(errN) { const pv = S._muPrev, step0 = 0.5 * errN * (S.EF || o.EF || 1) / 2; let nm = S.mu - step0; if (pv && Math.abs(errN - pv.err) > 1e-9 && Math.abs(S.mu - pv.mu) > 1e-12) { const sl = (errN - pv.err) / (S.mu - pv.mu); if (sl > 0) nm = S.mu - errN / sl; }
    const cap = 0.1 * (S.EF || o.EF || 1); nm = Math.max(S.mu - cap, Math.min(S.mu + cap, nm)); S._muPrev = { mu: S.mu, err: errN }; S.mu = nm; }
  //   the anisotropy of a field f on the disc: a smooth radial fit (least squares in r², degree 5, over r < r1) removed, the residual's cos 4θ part over r0 < r < r1,
  //   relative to the fit there (a thin lattice ring's radii correlate with θ — without the fit a steep radial profile reads as a false cos 4θ)
  S.aniso4 = (f, r0, r1) => aniso4Of(PX, PY, P, f, r0, r1);
  //   THE PUBLICATION for the real-time pair field (layer A, 2026-11-09): (i) the trap's SUPERFLUID WEIGHT J = ¼·Σ_σ Σ_k n_σ(k)·∂²ε/∂k_x² — n_σ(k) from the natural
  //   orbitals of Re ρ (each one FFT on the lattice, paced), ∂²ε the lattice second difference of the LIVE ε along x (the diamagnetic part — T = 0, gapped);
  //   the pair field's mass M_eff = N_p / J; (ii) the equation of state μ(n) by LOCAL-DENSITY INVERSION of its own profile (the trap scans the density:
  //   μ_loc(r) = μ − V(r) against n(r), ring-averaged) — what experiments read off a trapped gas. Pure; the caller publishes it (a replicated verb).
  function* publishPrep() { const Mc = S.McR, A = new Float64Array(Mc * Mc); for (let i = 0; i < Mc * Mc; i++) A[i] = S.rho[i]; for (let a = 0; a < Mc; a++) for (let b = 0; b < a; b++) { const v = 0.5 * (A[a * Mc + b] + A[b * Mc + a]); A[a * Mc + b] = A[b * Mc + a] = v; }
    const gen = symEigGen(A, Mc); let r; for (;;) { const x = gen.next(); if (x.done) { r = x.value; break; } yield x.value; }
    const nk = new Float64Array(N), e = S.eps, k1 = 2 * Math.PI / G; for (let m = 0; m < Mc; m++) { const lam = r.d[m]; if (!(lam > 1e-7)) continue; re.fill(0); im.fill(0); for (let p = 0; p < P; p++) { let v = 0; for (let a = 0; a < Mc; a++) v += r.V[a * Mc + m] * Phi[a * P + pid[p]]; re[pid[p]] = v; } fft2(re, im, G, false); for (let c = 0; c < N; c++) nk[c] += lam * (re[c] * re[c] + im[c] * im[c]) / N; yield FFTW + 2 * Mc * P; }
    let J = 0, Ns = 0; for (let ky = 0; ky < G; ky++) for (let kx = 0; kx < G; kx++) { const c = ky * G + kx, cp = ky * G + ((kx + 1) % G), cm = ky * G + ((kx + G - 1) % G), exx = (e[cp] - 2 * e[c] + e[cm]) / (k1 * k1); J += 0.25 * 2 * nk[c] * exx; Ns += nk[c]; }
    const cK = e[1] / (k1 * k1);   /* the live ε's small-k curvature along x (ε ≈ c·k²): a bare pair 2ε(K/2) has mass 1/c */
    const nb = 40, rm = Math.sqrt(Math.max(...PX.map((x, p) => x * x + PY[p] * PY[p]))), sn = new Float64Array(nb), sv = new Float64Array(nb), cn = new Float64Array(nb); for (let p = 0; p < P; p++) { const b = Math.min(nb - 1, Math.floor(Math.sqrt(PX[p] * PX[p] + PY[p] * PY[p]) / rm * nb)); sn[b] += S.dens[p]; sv[b] += Vp[p]; cn[b]++; }
    const eos = []; let nmx = 0; for (let b = 0; b < nb; b++) if (cn[b]) nmx = Math.max(nmx, sn[b] / cn[b]); for (let b = 0; b < nb; b++) if (cn[b] && sn[b] / cn[b] > 0.02 * nmx) eos.push([sn[b] / cn[b], S.mu - sv[b] / cn[b]]); eos.sort((x, y) => x[0] - y[0]);
    S.pub = { it: S.it, beat: S.beat, J, Np: Ns, cK, M: J > 0 ? Ns / J : null, s: J > 0 && cK > 0 ? (J / Ns) / cK : 1, eos, mu: S.mu, nmax: nmx }; S.pubIt = S.it; yield 1; }
  function* run() { S.phase = "seed"; Phi = new Float64Array(M * P); for (let m = 0; m < M; m++) { const v = o.seed(m, PX, PY); Phi.set(v, m * P); yield 20 * P; }
    while (!setMedium(S.beat)) yield (o.wait ? -1 : 1e6); for (let k = 0; k < (o.relax0 || 2); k++) yield* relax();
    S.mu = idealMu(); S.delta = new Float64Array(P); S.dIm = new Float64Array(P); for (let p = 0; p < P; p++) { const d = o.delta0 ? o.delta0(PX[p], PY[p]) : 0; if (Array.isArray(d)) { S.delta[p] = d[0]; S.dIm[p] = d[1]; } else S.delta[p] = d; }
    S.kappaW = o.kappa | 0; for (;;) { yield* (S.kappaW ? bdgIterC() : bdgIter()); S.it++; if (S.conv && S.it - (S.pubIt ?? -99) >= 8) { S.phase = "publish"; yield* publishPrep(); } if (S.it % trackEvery === 0) { while (!setMedium(S.beat)) yield (o.wait ? -1 : 1e6); yield* relax(); } } }
  //   ⚛F THE LIVE FORMATION (2026-11-09, user: "like the Bose condensate — no black screen computing offline; we observe the process"): o.form — nothing precomputed.
  //   (1) NOISE: the M orbitals random (a seeded generator: every peer the same); (2) THE SEA FILLS: the medium's own imaginary-time step sweeps them (its Ω read at each
  //   sweep's beat), Rayleigh–Ritz keeps them orthogonal (Pauli) — they settle into the lowest levels, shell by shell; E_F read live from the forming levels; (3) COOLING:
  //   from the beat the sea has formed, T ramps t0·E_F → t1·E_F over Q beats (beat-named); Δ starts as a tiny seeded noise — it decays above T_c and GROWS below it,
  //   its phase picked by the noise (as the condensate's); E_b, E_c and g from the live E_F. Then it stays live (the medium, the knobs).
  function* runForm() { const f = o.form; let st = (f.seed >>> 0) || 1; const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    S.phase = "noise"; Phi = new Float64Array(M * P); for (let m = 0; m < M; m++) { for (let p = 0; p < P; p++) Phi[m * P + p] = (rnd() - 0.5) * Math.exp(-Vp[p]); yield 20 * P; }
    while (!setMedium(S.beat)) yield (o.wait ? -1 : 1e6); S.phase = "fill"; S.fill = 0; let prev = null;
    for (let k = 0; k < (f.fillMax || 90); k++) { if (S.EF > 0) tau = 1.5 / S.EF; else tau = 1.5 / Math.max(1e-3, o.V ? 1 : 1); yield* relax(); S.phase = "fill"; S.fill = k + 1; S.EF = S.e[Math.min(M - 1, Nsp - 1)];
      { const d = new Float64Array(P); for (let a = 0; a < Math.min(M, Nsp); a++) for (let p = 0; p < P; p++) d[p] += 2 * Phi[a * P + p] * Phi[a * P + p]; S.dens = d; S.Ntot = 2 * Math.min(M, Nsp); }
      const top = Math.min(M, Nsp + 12); let ch = 0; if (prev) for (let a = 0; a < top; a++) ch = Math.max(ch, Math.abs(S.e[a] - prev[a])); S.fillChange = prev ? ch / Math.max(1e-9, S.EF) : null; prev = S.e.slice(0, top);
      if (k % 4 === 3) while (!setMedium(S.beat)) yield (o.wait ? -1 : 1e6); if (S.fillChange != null && S.fillChange < 3e-4 && k > 6) break; }
    Eb = (f.ebF || 0) * S.EF; Ec = (f.ecF || 2) * S.EF + 2 * Eb; tau = 1 / Ec; S.g = gOf(); S.Ec = Ec; S.Eb = Eb; S.coolStart = S.beat; S.params = { Nsp, Eb, T };
    const Tof = () => { if (S.ramp) { const r = S.ramp, u = Math.max(0, Math.min(1, (S.beat - r.b0) / Math.max(1, r.Q))); return r.T0 + (r.T1 - r.T0) * u; } const c = f.cool || { t0: 0.6, t1: 0, Q: 1500 }, u = Math.max(0, Math.min(1, (S.beat - S.coolStart) / Math.max(1, c.Q))); return S.EF * (c.t0 + (c.t1 - c.t0) * u); };
    T = Tof(); S.mu = idealMu(); S.delta = new Float64Array(P); S.dIm = new Float64Array(P); for (let p = 0; p < P; p++) S.delta[p] = 1e-3 * S.EF * (rnd() - 0.5) * Math.exp(-Vp[p] / Math.max(1e-6, S.EF));   /* (the seed: a tiny noise — the instability decides) */
    //   THE LOOP CLOSED (2026-11-09, user: "meta-circular in fermion forming"): o.ext(beat) → the living pair field's (P2's) fluid vortices [[x, y, s], …] in force at this
    //   beat (published, beat-stamped, by the acting peer). The fermions' Δ takes the PHASE they imply, θ(x) = Σ s_v·atan2(y − y_v, x − x_v); its AMPLITUDE stays their
    //   own (self-consistent: the cores empty themselves, the core states appear) — the complex BdG while a vortex is there, the real one when none. One order parameter
    //   split by scale: the field carries the phase (flows, vortices), the fermions the gap and the quasi-particles; and they feed the field its stiffness and pressure
    const phaseIn = () => { const vx = o.ext ? o.ext(S.beat) : null; const D = S.delta, Di = S.dIm;
      if (!vx || !vx.length) { if (S.extV) { for (let p = 0; p < P; p++) { D[p] = Math.hypot(D[p], Di[p]); Di[p] = 0; } S.extV = null; S.kappaW = 0; } return false; }
      let net = 0; for (const v of vx) net += v[2]; for (let p = 0; p < P; p++) { let th = 0; for (const v of vx) th += v[2] * Math.atan2(PY[p] - v[1], PX[p] - v[0]); const a = Math.hypot(D[p], Di[p]); D[p] = a * Math.cos(th); Di[p] = a * Math.sin(th); }
      S.extV = vx; S.kappaW = net; return true; };
    S.kappaW = 0; for (;;) { T = Tof(); S.Tnow = T; S.phase = "cool"; if (phaseIn()) yield* bdgIterC(); else yield* bdgIter(); S.it++; if (S.conv && S.beat - S.coolStart >= ((f.cool && f.cool.Q) || 1500) && S.it - (S.pubIt ?? -99) >= 8) { S.phase = "publish"; yield* publishPrep(); } if (S.it % trackEvery === 0) { while (!setMedium(S.beat)) yield (o.wait ? -1 : 1e6); yield* relax(); } } }   /* (once the ramp is over and converged it PUBLISHES as ⑧ does — μ(n), the stiffness: the caller hands the pairs over to the living pair field) */
  const R = o.form ? runForm() : run(); let carry = 0;
  //   step(budget, beat): run until `budget` work units have been handed out (the remainder carried, so the work done by a beat is a function of the beats alone)
  S.step = (budget, beat) => { S.beat = beat; let w = carry; try { while (w < budget) { const x = R.next(); if (x.done) break; if (x.value === -1) { w = budget; carry = 0; return S; } w += x.value || 0; } } catch (e) { S.err = String(e && e.stack || e); } carry = w - budget; return S; };   /* (−1: WAIT — the GPU's reads in flight: this beat's work ends here; the caller holds the next beat until S.gpuReady()) */
  return S;
}

//   ⚛F THE PAIRS' TWO CUTS (2026-11-09; the app's P2 / P1 — moved here, pure, so a worker computes them too): the anomalous density κ(x, y) = Σ_ab φ_a(x) κ_ab φ_b(y)
//   IS the pairs' condensate (Yang's ODLRO, N₀ = Σ_ab |κ_ab|²). vc: the CENTRE OF MASS ψ(R) ∝ |Δ(R)| (= g·κ(R, R)) ring-averaged about (G−1)/2, normed on the G×G grid
//   to N₀; vr: ONE PAIR's INSIDE φ(r) = κ(c, c + r), c the site G/2 (the phase at r = 0 removed, the sign kept), normed to the condensed fraction N₀/(N/2); xi its size.
//   Samples every dr; L a live BdG state (delta, dIm, kap, kapI, Phi, McR, P, PX, PY, Ntot).
export function pairCuts(L, G, dr = 0.5) { if (!L || !L.delta || !L.kap || !L.Phi || !(L.McR > 0)) return null;
  const P = L.P, Mc = L.McR, kr = L.kap, ki = L.kapI, Phi = L.Phi; let N0 = 0; for (let j = 0; j < Mc * Mc; j++) N0 += kr[j] * kr[j] + (ki ? ki[j] * ki[j] : 0);
  const radial = (val, ox, oy, signed) => { let rm = 0; const rr = new Float64Array(P); for (let p = 0; p < P; p++) { rr[p] = Math.hypot(L.PX[p] - ox, L.PY[p] - oy); rm = Math.max(rm, rr[p]); } const nb = Math.ceil(rm / dr) + 2, sm = new Float64Array(nb), cn = new Float64Array(nb);
    for (let p = 0; p < P; p++) { const b = Math.round(rr[p] / dr); sm[b] += signed ? val[p] : Math.abs(val[p]); cn[b]++; } const v = new Array(nb).fill(0); let last = -1; for (let b = 0; b < nb; b++) if (cn[b]) { v[b] = sm[b] / cn[b]; for (let q = last + 1; q < b; q++) v[q] = last < 0 ? v[b] : v[last] + (v[b] - v[last]) * (q - last) / (b - last); last = b; } v[nb - 1] = 0; return v; };
  const gridNorm = (v, c0) => { let t = 0; for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r = Math.hypot(x - c0, y - c0) / dr, j = Math.floor(r); const a = j >= v.length - 1 ? 0 : v[j] * (1 - (r - j)) + v[j + 1] * (r - j); t += a * a; } return t; };
  const Dm = new Float64Array(P); for (let p = 0; p < P; p++) Dm[p] = Math.hypot(L.delta[p], L.dIm ? L.dIm[p] : 0);
  let vc = radial(Dm, 0, 0, false); const sc = gridNorm(vc, (G - 1) / 2); vc = vc.map((a) => sc > 0 ? a * Math.sqrt(N0 / sc) : 0);
  let pc = 0, bd = Infinity; for (let p = 0; p < P; p++) { const d = (L.PX[p] - 0.5) ** 2 + (L.PY[p] - 0.5) ** 2; if (d < bd) { bd = d; pc = p; } }
  const wr = new Float64Array(Mc), wi = new Float64Array(Mc); for (let a = 0; a < Mc; a++) { const f = Phi[a * P + pc]; if (!f) continue; for (let b = 0; b < Mc; b++) { wr[b] += f * kr[a * Mc + b]; if (ki) wi[b] += f * ki[a * Mc + b]; } }
  const fr = new Float64Array(P), fi = new Float64Array(P); for (let b = 0; b < Mc; b++) { const x = wr[b], y = wi[b]; if (!x && !y) continue; const o = b * P; for (let p = 0; p < P; p++) { fr[p] += x * Phi[o + p]; fi[p] += y * Phi[o + p]; } }
  const t0 = Math.atan2(fi[pc], fr[pc]), c = Math.cos(t0), sn = Math.sin(t0), fs = new Float64Array(P); let m2 = 0, r2 = 0; for (let p = 0; p < P; p++) { fs[p] = fr[p] * c + fi[p] * sn; const w = fr[p] * fr[p] + fi[p] * fi[p]; m2 += w; r2 += w * ((L.PX[p] - 0.5) ** 2 + (L.PY[p] - 0.5) ** 2); }
  const fc = Math.min(1, N0 / Math.max(1e-9, (L.Ntot || 0) / 2)); let vr = radial(fs, 0.5, 0.5, true); const sr = gridNorm(vr, G / 2); vr = vr.map((a) => sr > 0 ? a * Math.sqrt(fc / sr) : 0);
  return { it: L.it, N0, xi: m2 > 0 ? Math.sqrt(r2 / m2) : 0, vc, vr, kappaW: L.kappaW | 0, dr }; }

//   ⚛F PER-MODE FERMIONS (2026-11-10, user: "the native one with scale, without matrices" — step 1 of the dual ladder): the LOCAL-DENSITY BdG. Where V and Δ vary
//   slowly the fermions are locally the uniform gas, whose BdG is DIAGONAL in k — every mode its own BCS factors (u_k, v_k), no matrix: the fermionic twin of the
//   medium's per-mode phase. At each site, μ_loc = μ − V(x): the gap 1/g = (1/N)Σ_k tanh(E/2T)/(2E) over the modes ε_k + V < E_c (the reference's cutoff), n = (1/N)
//   Σ_k [1 − (ξ/E)·tanh(E/2T)] (both spins; unpaired modes beyond the cutoff: 1 − tanh(ξ/2T)), ξ = ε_k + V − μ; the global μ so that Σ n = 2N. eps: the medium's OWN
//   per-mode ε table (anisotropy and all — binned into a density of states); g, E_c, T, N, V(x): the reference's. Pure; the cost is independent of N and of any matrix
export function ldaBdg({ eps, Ec, Eb, g, T = 0, Vp, Nsp, nb = 1500, nv = 160, fast = false }) {
  const N = eps.length; let emax = 0; for (let c = 0; c < N; c++) emax = Math.max(emax, eps[c]); const h = emax / nb || 1, cnt = new Float64Array(nb), eb = new Float64Array(nb);
  for (let c = 0; c < N; c++) { const b = Math.min(nb - 1, Math.max(0, Math.floor(eps[c] / h))); cnt[b]++; eb[b] += eps[c]; } for (let b = 0; b < nb; b++) eb[b] = cnt[b] ? eb[b] / cnt[b] : (b + 0.5) * h;
  let s0 = 0; for (let b = 0; b < nb; b++) if (eb[b] < Ec) s0 += cnt[b] / (2 * eb[b] + Eb); const ig = g > 0 ? 1 / g : s0 / N;
  const th = (x) => (T > 0 ? Math.tanh(x / (2 * T)) : x > 0 ? 1 : x < 0 ? -1 : 0);
  const gapAt = (ml, ecl) => { const F = (D) => { let s = 0; for (let b = 0; b < nb; b++) { if (!cnt[b] || eb[b] >= ecl) continue; const x = eb[b] - ml, E = Math.sqrt(x * x + D * D); s += cnt[b] * (E > 0 ? th(E) / (2 * E) : 1 / (4 * Math.max(T, 1e-300))); } return s / N - ig; };
    if (!(F(1e-10) > 0)) return 0; let a = 1e-10, bb = 1; while (F(bb) > 0 && bb < 1e6) bb *= 2; for (let t = 0; t < 46; t++) { const m = 0.5 * (a + bb); if (F(m) > 0) a = m; else bb = m; } return 0.5 * (a + bb); };
  const nAt = (ml, ecl, D) => { let s = 0; for (let b = 0; b < nb; b++) { if (!cnt[b]) continue; const x = eb[b] - ml; if (eb[b] < ecl) { const E = Math.sqrt(x * x + D * D); s += cnt[b] * (1 - (E > 0 ? (x / E) * th(E) : 0)); } else s += cnt[b] * (1 - th(x)); } return s / N; };
  let vmax = 0; for (let p = 0; p < Vp.length; p++) vmax = Math.max(vmax, Vp[p]); const vs = Array.from({ length: nv + 1 }, (_, j) => vmax * j / nv);
  const solve = (mu) => { const Dv = vs.map((V) => gapAt(mu - V, Ec - V)), nV = vs.map((V, j) => nAt(mu - V, Ec - V, Dv[j])), at = (arr, V) => { const x = vmax > 0 ? V / vmax * nv : 0, j = Math.min(nv - 1, Math.floor(x)), t = x - j; return arr[j] * (1 - t) + arr[j + 1] * t; };
    const D = new Float64Array(Vp.length), n = new Float64Array(Vp.length); let Nt = 0; for (let p = 0; p < Vp.length; p++) { D[p] = at(Dv, Vp[p]); n[p] = at(nV, Vp[p]); Nt += n[p]; } return { D, n, Nt }; };
  let lo = -Eb - 20 * (T + 1e-3) - 1, hi = Math.max(1, Ec); for (let t = 0; t < 12 && solve(hi).Nt < 2 * Nsp; t++) hi *= 2;
  //   (fast: the same root by regula falsi, Illinois — N(μ) is monotone: ~8 evaluations for the bisection's 32, the root the same to 1e-8·N; the live field's knobs)
  if (fast) { let flo = solve(lo).Nt - 2 * Nsp, fhi = solve(hi).Nt - 2 * Nsp, side = 0; for (let t = 0; t < 60 && fhi > flo && hi - lo > 1e-10 * (Math.abs(lo) + Math.abs(hi) + 1); t++) { const m = (lo * fhi - hi * flo) / (fhi - flo), fm = solve(m).Nt - 2 * Nsp; if (Math.abs(fm) < 1e-8 * 2 * Nsp) { lo = hi = m; break; }
      if (fm < 0) { lo = m; flo = fm; if (side < 0) fhi *= 0.5; side = -1; } else { hi = m; fhi = fm; if (side > 0) flo *= 0.5; side = 1; } } }
  else for (let t = 0; t < 32; t++) { const m = 0.5 * (lo + hi); if (solve(m).Nt < 2 * Nsp) lo = m; else hi = m; }
  const mu = 0.5 * (lo + hi), r = solve(mu); return { mu, D: r.D, n: r.n, N: r.Nt, g: 1 / ig }; }

//   ⚛F THE DUAL LADDER, RUNG 2 — THE FIELD (2026-11-10): Δ(x) the Ginzburg–Landau field whose every coefficient is the per-mode BdG's — the Euler–Lagrange equation of
//   Ω[Δ] = ∫ f_loc(|Δ|; μ − V, T) + K|∇Δ|²:   Δ·[1/g − χ(|Δ|)] − ∇·(K∇Δ) = 0,  χ = (1/N)Σ_k tanh(E/2T)/(2E) over the modes ε_k + V < E_c (rung 1's local gap equation),
//   K = J/(2|Δ|²) from the per-mode PHASE stiffness J = (1/8)(1/N)Σ_k |∇_kε|²(Δ²/E²)[tanh(E/2T)/E − sech²(E/2T)/(2T)] (a twist of Δ = |Δ|e^{iφ} costs K|Δ|²(∇φ)² = (J/2)(∇φ)²;
//   the amplitude's stiffness taken equal — exact in GL, an approximation at T = 0, declared); at T = 0 K ∝ 1/Δ² — the coherence length growing toward a normal edge: the
//   HEALING and the proximity tail rung 1 lacks. −∇² the medium's own pair kinetic L(k) = 4ε(k/2)/c (c its small-k curvature). Solved by imaginary-time gradient flow,
//   semi-implicit in k (the mean K implicit); χ, n, J tabulated over (V, |Δ|) from the medium's per-mode ε (its DOS and |∇ε|² per bin); μ held at N (secant). Pure.
//   (+ vortices [[x, y, s], …] in disc coordinates: Δ = A·e^{iθ}, θ = Σ s·atan2 — the amplitude A then feels the CENTRIFUGAL term K·A·|∇θ|², the core where it empties; muFixed: μ held)
export function glBdg({ eps, Ec, Eb, g, T = 0, Vp, pid, G, fft2, Nsp, D0 = null, mu0 = null, nb = 1200, nv = 100, nd = 72, iters = 300, outer = 5, vortices = null, muFixed = false }) {
  const N = G * G, P = Vp.length; let emax = 0; for (let c = 0; c < N; c++) emax = Math.max(emax, eps[c]); const h = emax / nb || 1, cnt = new Float64Array(nb), eb = new Float64Array(nb), gv = new Float64Array(nb), dk = 2 * Math.PI / G;
  for (let ky = 0; ky < G; ky++) for (let kx = 0; kx < G; kx++) { const c = ky * G + kx, e = eps[c], b = Math.min(nb - 1, Math.max(0, Math.floor(e / h))), ex = (eps[ky * G + (kx + 1) % G] - eps[ky * G + (kx + G - 1) % G]) / (2 * dk), ey = (eps[((ky + 1) % G) * G + kx] - eps[((ky + G - 1) % G) * G + kx]) / (2 * dk);
    cnt[b]++; eb[b] += e; gv[b] += ex * ex + ey * ey; } for (let b = 0; b < nb; b++) { if (cnt[b]) { eb[b] /= cnt[b]; gv[b] /= cnt[b]; } else eb[b] = (b + 0.5) * h; }
  const ig = 1 / g, th = (x) => (T > 0 ? Math.tanh(x / (2 * T)) : x > 0 ? 1 : x < 0 ? -1 : 0), sech2 = (x) => { if (!(T > 0)) return 0; const c = Math.cosh(Math.min(350, x / (2 * T))); return 1 / (c * c); };
  const local = (ml, ecl, D) => { let chi = 0, n = 0, J = 0; for (let b = 0; b < nb; b++) { if (!cnt[b]) continue; const x = eb[b] - ml; if (eb[b] < ecl) { const E = Math.sqrt(x * x + D * D) || 1e-300, t = th(E); chi += cnt[b] * t / (2 * E); n += cnt[b] * (1 - (x / E) * t); J += cnt[b] * gv[b] * (D * D / (E * E)) * (t / E - (T > 0 ? sech2(E) / (2 * T) : 0)) / 8; } else n += cnt[b] * (1 - th(x)); } return [chi / N, n / N, Math.max(0, J / N)]; };
  let vmax = 0; for (let p = 0; p < P; p++) vmax = Math.max(vmax, Vp[p]);
  //   the medium's own −∇² for the pair: L(k) = 2ε_pair-curvature-normed — 4ε(k/2)/c, ε at half momenta bilinear between the lattice's modes
  const c1 = eps[1] / (dk * dk), Lk = new Float64Array(N), Ei = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, at = (a, b) => eps[(((b % G) + G) % G) * G + (((a % G) + G) % G)]; return (1 - tx) * (1 - ty) * at(x0, y0) + tx * (1 - ty) * at(x0 + 1, y0) + (1 - tx) * ty * at(x0, y0 + 1) + tx * ty * at(x0 + 1, y0 + 1); };
  for (let ky = 0; ky < G; ky++) for (let kx = 0; kx < G; kx++) { const a = kx < G / 2 ? kx : kx - G, b = ky < G / 2 ? ky : ky - G; Lk[ky * G + kx] = c1 > 0 ? 4 * Ei(a / 2, b / 2) / c1 : 0; }
  const re = new Float64Array(N), im = new Float64Array(N), Lap = (f) => { re.set(f); im.fill(0); fft2(re, im, G, false); for (let c = 0; c < N; c++) { re[c] *= Lk[c]; im[c] *= Lk[c]; } fft2(re, im, G, true); return Float64Array.from(re); };
  const Vg = new Float64Array(N).fill(-1); for (let p = 0; p < P; p++) Vg[pid[p]] = Vp[p];
  const c0g = (G - 1) / 2, th2 = new Float64Array(N), thG = new Float64Array(N), pin0 = new Uint8Array(N);   /* (a vortex ON a site: there Δ = 0 — a 90° turn multiplies it by i) */ if (vortices && vortices.length) for (let c = 0; c < N; c++) { const X = (c % G) - c0g, Y = ((c / G) | 0) - c0g; let gx = 0, gy = 0, t = 0; for (const v of vortices) { const dx = X - v[0], dy = Y - v[1], r2 = dx * dx + dy * dy + 0.25; gx += -v[2] * dy / r2; gy += v[2] * dx / r2; t += v[2] * Math.atan2(dy, dx); } th2[c] = gx * gx + gy * gy; thG[c] = t; for (const v of vortices) if (Math.hypot(X - v[0], Y - v[1]) < 0.5) pin0[c] = 1; }   /* (|∇θ|² of the imposed winding — the centrifugal cost; regularized at the cell's scale, r² + ¼: a core ON a site is the lattice's) */
  //   the tables at μ: χ, n, J over (V, |Δ|)
  let Dtop = 0; if (D0) for (let p = 0; p < P; p++) Dtop = Math.max(Dtop, Math.abs(D0[p])); Dtop = Math.max(Dtop * 1.5, 1e-3);
  const tabs = (mu) => { const t = { chi: new Float64Array((nv + 1) * (nd + 1)), n: new Float64Array((nv + 1) * (nd + 1)), J: new Float64Array((nv + 1) * (nd + 1)) }; for (let i = 0; i <= nv; i++) { const V = vmax * i / nv; for (let j = 0; j <= nd; j++) { const [a, b, c] = local(mu - V, Ec - V, Dtop * j / nd); t.chi[i * (nd + 1) + j] = a; t.n[i * (nd + 1) + j] = b; t.J[i * (nd + 1) + j] = c; } } return t; };
  const look = (tab, V, D) => { const x = Math.min(nv, Math.max(0, V / (vmax || 1) * nv)), y = Math.min(nd, Math.max(0, Math.abs(D) / Dtop * nd)), i = Math.min(nv - 1, Math.floor(x)), j = Math.min(nd - 1, Math.floor(y)), u = x - i, w = y - j, k = (a, b) => tab[a * (nd + 1) + b];
    return (1 - u) * (1 - w) * k(i, j) + u * (1 - w) * k(i + 1, j) + (1 - u) * w * k(i, j + 1) + u * w * k(i + 1, j + 1); };
  const Dfl = 0.03 * Dtop;
  const relax = (mu, Dg) => { const t = tabs(mu); let res = 0, it = 0; const Kg = new Float64Array(N);
    for (it = 0; it < iters; it++) { let Kbar = 0, nK = 0; for (let c = 0; c < N; c++) { if (Vg[c] < 0) { Kg[c] = 0; Dg[c] = 0; continue; } const d = Math.max(Dfl, Math.abs(Dg[c]), Dk[c]);   /* (K of the LOCAL uniform state — the surrounding fluid's coherence length, not the depressed core's: a vortex's core would blow K = J/2Δ² up ~1000×) */ Kg[c] = look(t.J, Vg[c], d) / (2 * d * d); Kbar += Kg[c]; nK++; } Kbar /= Math.max(1, nK);
      const LD = Lap(Dg), KD = new Float64Array(N); for (let c = 0; c < N; c++) KD[c] = Kg[c] * Dg[c]; const LKD = Lap(KD), LK = Lap(Kg), A = new Float64Array(N); let dsMax = 0;
      res = 0; for (let c = 0; c < N; c++) { if (Vg[c] < 0) continue; const R = Dg[c] * (ig - look(t.chi, Vg[c], Dg[c])) + 0.5 * (Kg[c] * LD[c] + LKD[c] - Dg[c] * LK[c]); res = Math.max(res, Math.abs(R)); A[c] = R - Kbar * LD[c]; }
      const ds = 0.4 * g; re.set(Dg); for (let c = 0; c < N; c++) re[c] -= ds * A[c]; im.fill(0); fft2(re, im, G, false); for (let c = 0; c < N; c++) { const f = 1 / (1 + ds * Kbar * Lk[c]); re[c] *= f; im[c] *= f; } fft2(re, im, G, true);
      let dd = 0; for (let c = 0; c < N; c++) { const v = Vg[c] < 0 || pin0[c] ? 0 : Math.max(0, re[c]) / (1 + ds * Kg[c] * th2[c]);   /* (the centrifugal K·A·|∇θ|² implicit, site by site: stiff at the core) */ dd = Math.max(dd, Math.abs(v - Dg[c])); Dg[c] = v; } if (dd < 1e-7 * Dtop && it > 20) break; }
    let Nt = 0; const n = new Float64Array(P); for (let p = 0; p < P; p++) { n[p] = look(t.n, Vp[p], Dg[pid[p]]); Nt += n[p]; } return { Nt, n, res, it }; };
  const Dg = new Float64Array(N), Dk = new Float64Array(N); if (D0) for (let p = 0; p < P; p++) { Dg[pid[p]] = Math.abs(D0[p]); Dk[pid[p]] = Math.abs(D0[p]); }
  let mu = mu0 ?? 0, r = relax(mu, Dg), m0 = mu, e0 = r.Nt - 2 * Nsp, m1 = mu + 0.02 * (Math.abs(mu) + 0.1), r1;
  for (let k = 0; k < (muFixed ? 0 : outer); k++) { r1 = relax(m1, Dg); const e1 = r1.Nt - 2 * Nsp; if (Math.abs(e1) < 1e-4 * 2 * Nsp) { mu = m1; r = r1; break; } const m2 = Math.abs(e1 - e0) > 1e-12 ? m1 - e1 * (m1 - m0) / (e1 - e0) : m1; m0 = m1; e0 = e1; m1 = m2; mu = m1; r = r1; }
  r = relax(mu, Dg); const D = new Float64Array(P), Di = new Float64Array(P); for (let p = 0; p < P; p++) { const a = Dg[pid[p]], t = thG[pid[p]]; D[p] = vortices && vortices.length ? a * Math.cos(t) : a; Di[p] = vortices && vortices.length ? a * Math.sin(t) : 0; } return { mu, D, Di, A: Float64Array.from(pid, (c) => Dg[c]), n: r.n, N: r.Nt, res: r.res, it: r.it }; }

//   ⚛F THE DUAL LADDER, RUNG 4 — A SHEAF CELL (2026-11-10): where the field (rung 2) fails — a vortex's core, whose bound states no field can hold — an EXACT BdG on a small
//   disc of the lattice's sites around it: the medium's OWN real-space kinetic (its per-mode ε transformed back: the kernel t(x − y) with the IFS rings, not a nearest-neighbour
//   hop) + V − μ; Δ self-consistent in the CORE (r < Rc), PINNED to the field's Δ in the BUFFER (Rc ≤ r < Rb) — the overlap where the local section agrees with the global one
//   (the gluing); g from the same E_b over the whole band; the complex Hermitian eigensolver (hermEigGen), resumable — the caller paces it. Returns the core's Δ, the spectrum, the
//   low states' core weights (r < rw about the cell's centre). The cell's own walls box the extended states (their levels are the cell's); the core states are bound — the honest part
export function* cellBdgGen({ eps, G, fft2, Vg, Dr, Di, cx, cy, Rc = 4, Rb = 10, rw = 4, mu, Eb, Ec, gRef, T = 0, iters = 8, mix = 0.6 }) {
  //   (like the reference, locally — MEASURED 2026-11-10: pairing the whole band with a full-band g gave Δ ≈ 0.8 against the live 0.5; the reference's E_c ≈ 2.4 E_F is close
  //   enough to μ that the gap depends on it: so the cell's own levels of h below the SAME E_c, the SAME g, the BdG in their span)
  const N = G * G, c0 = (G - 1) / 2, kr = Float64Array.from(eps), ki = new Float64Array(N); let mean = 0; for (let c = 0; c < N; c++) mean += eps[c]; mean /= N; fft2(kr, ki, G, true); const sc = Math.abs(kr[0]) > 1e-300 ? mean / kr[0] : 1; for (let c = 0; c < N; c++) kr[c] *= sc;   /* (the kernel t(d) = (1/N)Σ_k ε_k e^{ik·d}) */
  const sx = [], sy = [], sc0 = [], core = [], wcore = [];
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const X = x - c0 - cx, Y = y - c0 - cy, r = Math.hypot(X, Y), c = y * G + x; if (r < Rb && Vg[c] >= 0) { sx.push(x); sy.push(y); sc0.push(c); core.push(r < Rc); wcore.push(r < rw); } }
  const Pc = sx.length, h = new Float64Array(Pc * Pc); for (let i = 0; i < Pc; i++) for (let j = 0; j < Pc; j++) { const d = ((((sy[i] - sy[j]) % G) + G) % G) * G + ((((sx[i] - sx[j]) % G) + G) % G); h[i * Pc + j] = kr[d] + (i === j ? Vg[sc0[i]] : 0); } yield 2 * Pc * Pc;
  const gh = symEigGen(h, Pc); let rh; for (;;) { const x = gh.next(); if (x.done) { rh = x.value; break; } yield x.value; }
  let Mc = 0; while (Mc < Pc && rh.d[Mc] < Ec) Mc++; const phi = new Float64Array(Mc * Pc); for (let a = 0; a < Mc; a++) for (let i = 0; i < Pc; i++) phi[a * Pc + i] = rh.V[i * Pc + a];   /* (the cell's levels below E_c) */
  const g = gRef, dr = Float64Array.from(sc0, (c) => Dr[c]), di = Float64Array.from(sc0, (c) => Di ? Di[c] : 0), th = (E) => (T > 0 ? Math.tanh(E / (2 * T)) : 1), out = { Pc, Mc, g, hist: [] }, n = 2 * Mc;
  for (let it = 0; it < iters; it++) { const Hr = new Float64Array(n * n), Hi = new Float64Array(n * n);
    for (let a = 0; a < Mc; a++) { for (let b = 0; b <= a; b++) { let sr = 0, si = 0; for (let i = 0; i < Pc; i++) { const w = phi[a * Pc + i] * phi[b * Pc + i]; sr += w * dr[i]; si += w * di[i]; } Hr[a * n + Mc + b] = sr; Hi[a * n + Mc + b] = si; Hr[b * n + Mc + a] = sr; Hi[b * n + Mc + a] = si; Hr[(Mc + b) * n + a] = sr; Hi[(Mc + b) * n + a] = -si; Hr[(Mc + a) * n + b] = sr; Hi[(Mc + a) * n + b] = -si; }
      Hr[a * n + a] = rh.d[a] - mu; Hr[(Mc + a) * n + Mc + a] = -(rh.d[a] - mu); } yield 2 * Mc * Mc * Pc / 8;
    const ge = hermEigGen(Hr, Hi, n); let r; for (;;) { const x = ge.next(); if (x.done) { r = x.value; break; } yield x.value; }
    const kR = new Float64Array(Pc), kI = new Float64Array(Pc), low = [], spec = [], ur = new Float64Array(Pc), ui = new Float64Array(Pc), vr = new Float64Array(Pc), vi = new Float64Array(Pc);
    for (let m = 0; m < n; m++) { const E = r.d[m]; if (E <= 0) continue; const t = th(E); spec.push(E); ur.fill(0); ui.fill(0); vr.fill(0); vi.fill(0);
      for (let a = 0; a < Mc; a++) { const Ua = r.Vr[a * n + m], Ub = r.Vi[a * n + m], Va = r.Vr[(Mc + a) * n + m], Vb = r.Vi[(Mc + a) * n + m], o2 = a * Pc; if (!Ua && !Ub && !Va && !Vb) continue; for (let i = 0; i < Pc; i++) { const f = phi[o2 + i]; ur[i] += Ua * f; ui[i] += Ub * f; vr[i] += Va * f; vi[i] += Vb * f; } }
      let wc = 0; for (let i = 0; i < Pc; i++) { kR[i] += t * (ur[i] * vr[i] + ui[i] * vi[i]); kI[i] += t * (ui[i] * vr[i] - ur[i] * vi[i]); if (wcore[i]) wc += ur[i] * ur[i] + ui[i] * ui[i] + vr[i] * vr[i] + vi[i] * vi[i]; }
      low.push([E, wc]); yield 4 * Mc * Pc; }
    let dd = 0; for (let i = 0; i < Pc; i++) if (core[i]) { const nr = g * kR[i], ni = g * kI[i]; dd = Math.max(dd, Math.hypot(nr - dr[i], ni - di[i])); dr[i] = mix * nr + (1 - mix) * dr[i]; di[i] = mix * ni + (1 - mix) * di[i]; }
    low.sort((a, b) => a[0] - b[0]); out.hist.push(dd); out.low = low.slice(0, 12); out.spec = spec.sort((a, b) => a - b); }
  out.sites = { x: sx, y: sy, core }; out.dr = dr; out.di = di; return out; }

//   ⚛F THE DUAL LADDER, RUNG 3 — RAYS (2026-11-10): the vortex core's bound states SEMICLASSICALLY — quasi-particles on straight trajectories through the core at impact
//   parameter b (angular momentum L = k_F·b), Andreev-reflected by the phase jump: E(L) = −(L/k_F)·∫₀^∞ (Δ(r)/r) e^{−2K(r)} dr / ∫₀^∞ e^{−2K(r)} dr, K(r) = (1/v_F)∫₀^r Δ — the
//   Kramer–Pesch / CdGM ray formula; the lowest state at |L| = 1/2. k_F and v_F the MEDIUM's own at μ (its angle-averaged ε(k): ε(k_F) = μ, v_F = ε′(k_F)); Δ(r) the field's (rung 2).
//   Valid for k_F·ξ ≫ 1 (returned, to judge). Pure
export function rayCore({ epsR, kMax, mu, Dr }) { const nk = 2000; let kF = null; for (let i = 1; i <= nk; i++) { const k = kMax * i / nk; if (epsR(k) >= mu) { kF = k; break; } } if (!kF) return null;
  const d = kMax / nk, vF = (epsR(Math.min(kMax, kF + d)) - epsR(Math.max(0, kF - d))) / (2 * d); if (!(vF > 0)) return null; const nr = Dr.length, dr = Dr.dr || 0.5;
  let K = 0, num = 0, den = 0; for (let j = 0; j < nr - 1; j++) { const r = (j + 0.5) * dr, D = 0.5 * (Dr[j] + Dr[j + 1]); K += D * dr / vF; const w = Math.exp(-2 * K); num += (D / r) * w * dr; den += w * dr; }
  const slope = den > 0 ? num / den : 0, E0 = slope / (2 * kF); let Dinf = 0; for (const v of Dr) Dinf = Math.max(Dinf, v); return { kF, vF, E0, slope, xi: Dinf > 0 ? vF / Dinf : null, kFxi: Dinf > 0 ? kF * vF / Dinf : null }; }

//   ⚛F THE PER-MODE TABLES (2026-11-10 — the rungs' shared ground, pure): from the medium's OWN per-mode ε (binned: its DOS and its |∇_kε|² per bin) at μ, T, the
//   cutoff E_c (ε + V < E_c), g: over (V, |Δ|) the pair susceptibility χ, the density n (both spins), the phase stiffness J. look(tab, V, D) bilinear
export function perModeTables({ eps, G, Ec, g, T = 0, mu, vmax, Dtop, nb = 800, nv = 80, nd = 64 }) {
  const N = G * G; let emax = 0; for (let c = 0; c < N; c++) emax = Math.max(emax, eps[c]); const h = emax / nb || 1, cnt = new Float64Array(nb), eb = new Float64Array(nb), gv = new Float64Array(nb), dk = 2 * Math.PI / G;
  for (let ky = 0; ky < G; ky++) for (let kx = 0; kx < G; kx++) { const c = ky * G + kx, e = eps[c], b = Math.min(nb - 1, Math.max(0, Math.floor(e / h))), ex = (eps[ky * G + (kx + 1) % G] - eps[ky * G + (kx + G - 1) % G]) / (2 * dk), ey = (eps[((ky + 1) % G) * G + kx] - eps[((ky + G - 1) % G) * G + kx]) / (2 * dk); cnt[b]++; eb[b] += e; gv[b] += ex * ex + ey * ey; }
  for (let b = 0; b < nb; b++) { if (cnt[b]) { eb[b] /= cnt[b]; gv[b] /= cnt[b]; } else eb[b] = (b + 0.5) * h; }
  const th = (x) => (T > 0 ? Math.tanh(x / (2 * T)) : x > 0 ? 1 : x < 0 ? -1 : 0), sech2 = (x) => { if (!(T > 0)) return 0; const c = Math.cosh(Math.min(350, x / (2 * T))); return 1 / (c * c); };
  const local = (ml, ecl, D) => { let chi = 0, n = 0, J = 0; for (let b = 0; b < nb; b++) { if (!cnt[b]) continue; const x = eb[b] - ml; if (eb[b] < ecl) { const E = Math.sqrt(x * x + D * D) || 1e-300, t = th(E); chi += cnt[b] * t / (2 * E); n += cnt[b] * (1 - (x / E) * t); J += cnt[b] * gv[b] * (D * D / (E * E)) * (t / E - (T > 0 ? sech2(E) / (2 * T) : 0)) / 8; } else n += cnt[b] * (1 - th(x)); } return [chi / N, n / N, Math.max(0, J / N)]; };
  const chi = new Float64Array((nv + 1) * (nd + 1)), n = new Float64Array((nv + 1) * (nd + 1)), J = new Float64Array((nv + 1) * (nd + 1));
  for (let i = 0; i <= nv; i++) { const V = vmax * i / nv; for (let j = 0; j <= nd; j++) { const [a, b, c] = local(mu - V, Ec - V, Dtop * j / nd); chi[i * (nd + 1) + j] = a; n[i * (nd + 1) + j] = b; J[i * (nd + 1) + j] = c; } }
  const look = (tab, V, D) => { const x = Math.min(nv, Math.max(0, V / (vmax || 1) * nv)), y = Math.min(nd, Math.max(0, Math.abs(D) / Dtop * nd)), i = Math.min(nv - 1, Math.floor(x)), j = Math.min(nd - 1, Math.floor(y)), u = x - i, w = y - j, k = (a, b) => tab[a * (nd + 1) + b];
    return (1 - u) * (1 - w) * k(i, j) + u * (1 - w) * k(i + 1, j) + (1 - u) * w * k(i, j + 1) + u * w * k(i + 1, j + 1); };
  //   the local uniform gap at V (rung 1's): the root of 1/g = χ(V, Δ) on the table
  const gapAt = (V) => { const ig = 1 / g; if (!(look(chi, V, 1e-9 * Dtop) > ig)) return 0; let a = 0, b = Dtop; for (let t = 0; t < 40; t++) { const m = 0.5 * (a + b); if (look(chi, V, m) > ig) a = m; else b = m; } return 0.5 * (a + b); };
  return { chi, n, J, look, gapAt, vmax, Dtop, nv, nd, mu, T }; }

//   ⚛F RUNG 2 ON THE MEDIUM's GPU — the field's tables (2026-11-10, pure): the GL of rung 2 rewritten for φ = √K·Δ — K|∇Δ|² = |∇φ|² + U_K φ², U_K = |∇ln K|²/4 + ½∇²ln K
//   (exact for smooth K; |φ|² = KΔ² = J/2, half the local superfluid stiffness) — so the kinetic is the medium's OWN pair operator L(k) = 4ε(k/2)/c with ONE coefficient, the rest
//   LOCAL: w(r, |φ|) = U_K(r) + (1/K(r))·(1/g − χ(|φ|/√K(r); V(r))) — the fixed point of e^{−γL} · e^{−γw} is rung 2's equation (−∇² + w)φ = 0. K(r) of the LOCAL uniform
//   state (rung 1's gap at V(r)); the bowl round: everything a function of r. Returns Lk (G×G), the LUT w (nr × nd), the r-index of every cell, φmax, and Δ(φ, r)
export function glField({ eps, G, Ec, g, T = 0, mu, V0, R, Rs, nr = 96, nd = 64, Dref = 0 }) {
  const N = G * G, c0 = (G - 1) / 2, dk = 2 * Math.PI / G, vmax = V0, Vr = (r) => V0 * Math.min(1, (r * r) / (R * R));
  //   the medium's pair kinetic
  const c1 = eps[1] / (dk * dk), Lk = new Float32Array(N), Ei = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, at = (a, b) => eps[(((b % G) + G) % G) * G + (((a % G) + G) % G)]; return (1 - tx) * (1 - ty) * at(x0, y0) + tx * (1 - ty) * at(x0 + 1, y0) + (1 - tx) * ty * at(x0, y0 + 1) + tx * ty * at(x0 + 1, y0 + 1); };
  for (let ky = 0; ky < G; ky++) for (let kx = 0; kx < G; kx++) { const a = kx < G / 2 ? kx : kx - G, b = ky < G / 2 ? ky : ky - G; Lk[ky * G + kx] = c1 > 0 ? 4 * Ei(a / 2, b / 2) / c1 : 0; }
  //   Dtop from the centre's uniform gap
  //   (T > 0 — 2026-11-10, the field LIVE in T: as T → T_c the local gap → 0 and K = J/(2Δ²) would be read at Δ → 0, below the table's resolution — MEASURED: above T_c K came
  //   out ~1e3, φmax 1e-15. K is the fluid's stiffness per Δ², finite at T_c (the GL limit): read at Δ* = max(Δ_loc, 0.2·Δ_ref), Δ_ref the T = 0 gap at the centre (the caller's
  //   — the scale that does not vanish); the table and φmax span it. At T = 0 nothing changes: Δ_ref is not used)
  const dref = T > 0 ? Math.max(0, +Dref || 0) : 0;
  const pre = perModeTables({ eps, G, Ec, g, T, mu, vmax, Dtop: 4 * Math.max(1e-3, Math.abs(mu), dref) + 1, nv: 8, nd: 64 }), D0c = pre.gapAt(0), Dtop = Math.max(1e-3, 1.6 * D0c, 0.4 * dref);
  const t = perModeTables({ eps, G, Ec, g, T, mu, vmax, Dtop }), dr = Rs / (nr - 1), rr = Array.from({ length: nr }, (_, i) => i * dr);
  const Dk = rr.map((r) => t.gapAt(Vr(r))), Dfl = 0.2 * Math.max(...Dk, 1e-9, dref), Kr = rr.map((r, i) => { const d = Math.max(Dfl, Dk[i]), J = t.look(t.J, Vr(r), d); return J / (2 * d * d); });   /* (K of the fluid THERE: near the edge the healing tail, not the vanishing uniform gap — Δ* = max(Δ_loc, 0.2·Δ_max); MEASURED 2026-11-10: with 0.03 K jumped orders over a few sites, U_K spiked, the relaxation ran away) */
  const Kmax = Math.max(...Kr, 1e-30), Kf = Kr.map((k) => Math.max(k, 1e-3 * Kmax)), lnK0 = Kf.map(Math.log), sg = Math.max(1, 1 / dr), lnK = lnK0.map((_, i) => { let a = 0, w = 0; for (let j = Math.max(0, i - 3 * Math.ceil(sg)); j <= Math.min(nr - 1, i + 3 * Math.ceil(sg)); j++) { const q = Math.exp(-0.5 * ((j - i) / sg) ** 2); a += q * lnK0[j]; w += q; } return a / w; }),   /* (ln K smoothed over ~a site: the transform is exact for SMOOTH K — MEASURED 2026-11-10: unsmoothed, U_K reached −50 near the edge, rows never saturated, the field ran away) */ UK = rr.map((r, i) => { const i0 = Math.max(1, Math.min(nr - 2, i)), d1 = (lnK[i0 + 1] - lnK[i0 - 1]) / (2 * dr), d2 = (lnK[i0 + 1] - 2 * lnK[i0] + lnK[i0 - 1]) / (dr * dr); return 0.25 * d1 * d1 + 0.5 * (d2 + (r > 0 ? d1 / r : d2)); });
  const phiMax = 1.5 * Math.sqrt(Math.max(...Kr.map((k, i) => k * Dk[i] * Dk[i]), Kr[0] * (0.1 * dref) ** 2, 1e-30)), lut = new Float32Array(nr * nd), ig = 1 / g, wCap = 50;
  let ramped = 0; for (let i = 0; i < nr; i++) { const V = Vr(rr[i]), K = Kf[i], sK = Math.sqrt(K); for (let j = 0; j < nd; j++) { const ph = phiMax * j / (nd - 1), D = ph / sK; let w = UK[i] + (ig - t.look(t.chi, V, D)) / K; if (!(Kr[i] > 1e-6 * Kmax)) w = wCap; lut[i * nd + j] = Math.max(-wCap, Math.min(wCap, w)); }
    if (!(lut[i * nd + nd - 1] > 0)) { ramped++; const w0 = lut[i * nd + nd - 1]; for (let j = Math.floor(0.75 * nd); j < nd; j++) { const u = (j - 0.75 * nd) / (0.25 * nd); lut[i * nd + j] = Math.max(lut[i * nd + j], w0 + u * u * (Math.abs(w0) + 1)); } } }   /* (a row that would not saturate by φmax gets a ramp past 3/4 of it — beyond the physical range; counted) */
  const idx = new Float32Array(N); for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r = Math.hypot(x - c0, y - c0); idx[y * G + x] = r >= Rs ? nr - 1 : r / dr; }
  const kAt = (r) => { const i = Math.min(nr - 1, Math.max(0, r / dr)), i0 = Math.min(nr - 2, Math.floor(i)), u = i - i0; return Kf[i0] * (1 - u) + Kf[i0 + 1] * u; };
  return { Lk, lut, idx, nr, nd, phiMax, dr, ramped, UKmin: Math.min(...UK), UKmax: Math.max(...UK), Kr: Float64Array.from(Kf), Dk: Float64Array.from(Dk), D0c, Dtop, tables: t, c1, kAt, Vr, Rs,
    deltaOf: (phi, r) => { const i = Math.min(nr - 1, Math.max(0, r / dr)), i0 = Math.min(nr - 2, Math.floor(i)), u = i - i0, K = Kf[i0] * (1 - u) + Kf[i0 + 1] * u; return phi / Math.sqrt(K); } }; }

//   ⚛F THE NATIVE FIELD's INPUTS (2026-11-10 — pure: every peer computes them from the medium's per-mode ε and the knobs' entry, nothing sent): the bowl's disc (r < R_s = R + 4),
//   E_F by the medium's own state count (the level under which N states per spin fit: Σ_sites #{ε_k < E − V(x)}/G²), E_b = (E_b/E_F)·E_F, E_c = lec·E_F + 2E_b, g from E_b over
//   the modes below E_c, T = (T/E_F)·E_F, μ from the per-mode solution (rung 1, ldaBdg — the fast root) at T. ref: a previous result at the SAME N, E_b, R, V₀ (its T = 0 part
//   reused: E_F, E_b, E_c, g, the T = 0 gap at the centre Δ_ref — the field's scale that does not vanish at T_c)
export function nativeInputs({ eps, G, Nsp, ebF, tF = 0, R, V0, lec = 2, sorted = null, ref = null }) {
  const N = G * G, c0 = (G - 1) / 2, Rs = Math.min(G / 2 - 2, R + 4), vp = []; for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const X = x - c0, Y = y - c0; if (X * X + Y * Y < Rs * Rs) vp.push(V0 * Math.min(1, (X * X + Y * Y) / (R * R))); }
  const Vp = Float64Array.from(vp); let z = ref;
  if (!z) { const ep = sorted || Float64Array.from(eps).sort(), below = (E) => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (ep[m] < E) lo = m + 1; else hi = m; } return lo; }, count = (E) => { let t = 0; for (let p = 0; p < Vp.length; p++) if (E > Vp[p]) t += below(E - Vp[p]); return t / N; };
    let a = 0, b = ep[N - 1] + V0; for (let t = 0; t < 50; t++) { const m = 0.5 * (a + b); if (count(m) < Nsp) a = m; else b = m; } const EF = 0.5 * (a + b), Eb = ebF * EF, Ec = lec * EF + 2 * Eb; let s0 = 0; for (let c = 0; c < N; c++) if (eps[c] < Ec) s0 += 1 / (2 * eps[c] + Eb);
    const g = N / s0, l0 = ldaBdg({ eps, Ec, Eb, g, T: 0, Vp, Nsp, fast: true }); let Dref = 0; for (let p = 0; p < l0.D.length; p++) Dref = Math.max(Dref, l0.D[p]); z = { EF, Eb, Ec, g, mu0: l0.mu, Dref }; }
  const T = Math.max(0, +tF || 0) * z.EF, mu = T > 0 ? ldaBdg({ eps, Ec: z.Ec, Eb: z.Eb, g: z.g, T, Vp, Nsp, fast: true }).mu : z.mu0;
  return { EF: z.EF, Eb: z.Eb, Ec: z.Ec, g: z.g, mu0: z.mu0, Dref: z.Dref, T, mu, R, V0, Rs, Nsp, ebF, tF: Math.max(0, +tF || 0) }; }

//   ⚛F THE FERMIONS IN PHASE SPACE, PER MODE (2026-11-10 — the dual ladder's instrument; pure): where the fermions are locally the uniform gas, their Wigner functions are
//   FORMULAS — at a site with V, |Δ|: per spin n_k = ½(1 − (ξ/E)·tanh(E/2T)), the pairs' κ_k = (|Δ|/2E)·tanh(E/2T), ξ = ε_k + V − μ, E = √(ξ² + |Δ|²) (modes with ε + V ≥ E_c
//   unpaired: n = ½(1 − tanh(ξ/2T)), κ = 0) — on the medium's OWN ε(k_x, k_y) (its anisotropy and rings, no angle average). perModeWigner: along sites j (Vx[j], Dx[j]) the
//   k_y-MARGINALS W_ρ(x, k_x) = (1/G)Σ_{k_y} n, W_κ(x, k_x) = (1/G)Σ_{k_y} κ at the lattice's own k_x = 2πa/G, a = −ka … ka (what a row's lag transform of ρ(x + s, x − s)
//   measures — the orbital picture's F view, like for like), + the k_y = 0 SLICE (sl: the sharp Fermi surface no row transform can show). No orbitals, no matrix: any N
export function perModeWigner({ eps, G, Ec, mu, T = 0, Vx, Dx, ka }) {
  const nx = Vx.length, nk = 2 * ka + 1, n = new Float64Array(nx * nk), kap = new Float64Array(nx * nk), sl = new Float64Array(nx * nk), th = (x) => (T > 0 ? Math.tanh(x / (2 * T)) : x > 0 ? 1 : x < 0 ? -1 : 0);
  for (let j = 0; j < nx; j++) { const V = Vx[j], D = Math.abs(Dx[j]), D2 = D * D; for (let a = -ka; a <= ka; a++) { const kx = ((a % G) + G) % G; let sn = 0, sk = 0;
      for (let b = 0; b < G; b++) { const e = eps[b * G + kx], x = e + V - mu; let nn, kk = 0; if (e + V < Ec) { const E = Math.sqrt(x * x + D2); if (E > 0) { const t = th(E); nn = 0.5 * (1 - (x / E) * t); kk = D * t / (2 * E); } else nn = 0.5; } else nn = 0.5 * (1 - th(x)); sn += nn; sk += kk; if (b === 0) sl[j * nk + a + ka] = nn; }
      n[j * nk + a + ka] = sn / G; kap[j * nk + a + ka] = sk / G; } }
  return { n, kap, sl, nx, nk, ka }; }
//   perModeCond: the CONDENSED pairs per site n₀ = (1/N)Σ_k κ_k², κ_k = (|Δ|/2E)·tanh(E/2T) (Yang's order — the macroscopic eigenvalue of the two-body density matrix, per
//   mode: no κ matrix), and the pairs' density n/2 beside it; over sites j (Vx[j], Dx[j]); the medium's ε binned
export function perModeCond({ eps, Ec, mu, T = 0, Vx, Dx, nb = 1200 }) {
  const N = eps.length; let emax = 0; for (let c = 0; c < N; c++) emax = Math.max(emax, eps[c]); const h = emax / nb || 1, cnt = new Float64Array(nb), eb = new Float64Array(nb);
  for (let c = 0; c < N; c++) { const b = Math.min(nb - 1, Math.max(0, Math.floor(eps[c] / h))); cnt[b]++; eb[b] += eps[c]; } for (let b = 0; b < nb; b++) eb[b] = cnt[b] ? eb[b] / cnt[b] : (b + 0.5) * h;
  const th = (x) => (T > 0 ? Math.tanh(x / (2 * T)) : 1), n0 = new Float64Array(Vx.length);
  for (let j = 0; j < Vx.length; j++) { const V = Vx[j], D = Math.abs(Dx[j]); if (!(D > 0)) continue; let s0 = 0; for (let b = 0; b < nb; b++) { if (!cnt[b] || eb[b] + V >= Ec) continue; const x = eb[b] + V - mu, E = Math.sqrt(x * x + D * D), k = D * th(E) / (2 * E); s0 += cnt[b] * k * k; } n0[j] = s0 / N; }
  return n0; }
//   perModeLdos: the LOCAL spectrum N(x, E) = (1/N)Σ_k [u_k²·δ(E − E_k) + v_k²·δ(E + E_k)] per spin (u² = ½(1 + ξ/E), v² = ½(1 − ξ/E); unpaired modes: δ(E − ξ)), E from μ, binned
//   over [−Emax, Emax] in nE bins (×nE/2Emax: a density) — what a tunnelling tip or RF reads at x: the gap 2|Δ(x)| open at μ, closing toward the edge. The medium's ε binned (its DOS)
export function perModeLdos({ eps, Ec, mu, Vx, Dx, Emax, nE = 96, nb = 1200 }) {
  const N = eps.length; let emax = 0; for (let c = 0; c < N; c++) emax = Math.max(emax, eps[c]); const h = emax / nb || 1, cnt = new Float64Array(nb), eb = new Float64Array(nb);
  for (let c = 0; c < N; c++) { const b = Math.min(nb - 1, Math.max(0, Math.floor(eps[c] / h))); cnt[b]++; eb[b] += eps[c]; } for (let b = 0; b < nb; b++) eb[b] = cnt[b] ? eb[b] / cnt[b] : (b + 0.5) * h;
  const nx = Vx.length, a = new Float64Array(nx * nE), w = nE / (2 * Emax), put = (j, E, v) => { const q = (E + Emax) * w - 0.5, q0 = Math.floor(q), u = q - q0; if (q0 >= 0 && q0 < nE) a[j * nE + q0] += v * (1 - u); if (q0 + 1 >= 0 && q0 + 1 < nE) a[j * nE + q0 + 1] += v * u; };
  for (let j = 0; j < nx; j++) { const V = Vx[j], D = Math.abs(Dx[j]); for (let b = 0; b < nb; b++) { if (!cnt[b]) continue; const x = eb[b] + V - mu, c = cnt[b] / N * w; if (eb[b] + V < Ec && D > 0) { const E = Math.sqrt(x * x + D * D); put(j, E, c * 0.5 * (1 + x / E)); put(j, -E, c * 0.5 * (1 - x / E)); } else put(j, x, c); } }
  return { a, nx, nE, Emax }; }

//   THE WORK A BEAT (the app's pacing rule — one place, deterministic: a function of the solver's own state): forming 3e7 until its first publication (the ramp over,
//   converged), then 5e6; the live BdG 2e7 (complex 3e7) until converged, then 5e6
export function liveBudget(L) { return L.form ? (L.pubIt != null ? 5e6 : 3e7) : L.conv ? 5e6 : (L.kappaW ? 3e7 : 2e7); }

//   ⚛F LAYER B — REAL-TIME QUASI-PARTICLES (2026-11-09, user: "is there any chance to bring it to realtime like all in medium?"): time-dependent BdG (TDHFB) in a WINDOW
//   of the live orbitals — the Mw nearest μ — on the medium's clock: the generalized density matrix R (2Mw × 2Mw, complex Hermitian) evolves as i dR/dt = [H(R), R],
//   H = [[e − μ, D], [D†, −(e − μ)]], D_ab(t) = Σ_x φ_a φ_b Δ(x, t), Δ(x, t) = g′·(κ_deep(x) + Σ_ab φ_a φ_b κ_ab(t)), κ_ab = −R₁₂[b, a]; the deep sea (outside the
//   window) held at the live BdG's equilibrium (κ_deep chosen so Δ(t = 0) is the live Δ exactly — no quench: stationary). Crank–Nicolson (exactly unitary): one or more
//   steps per beat of the beat's proper time. A quench g → g′ (E_b → E_b′) at t = 0 rings Δ — the Higgs (amplitude) mode at ≈ 2Δ. Pure, deterministic.
export function makeTdhfb(o) {
  const L = o.live, Phi = L.Phi, P = L.P, e = L.e, mu = o.mu ?? L.mu, McA = L.McR, g0 = L.g, g1 = o.g1 ?? g0, dtS = o.dt, nSub = o.nSub || 2;
  const idx = Array.from({ length: McA }, (_, a) => a).sort((a, b) => Math.abs(e[a] - mu) - Math.abs(e[b] - mu)).slice(0, Math.min(o.Mw || 44, McA)).sort((a, b) => a - b), Mw = idx.length, n = 2 * Mw;
  const ph = new Float64Array(Mw * P); for (let a = 0; a < Mw; a++) for (let p = 0; p < P; p++) ph[a * P + p] = Phi[idx[a] * P + p];
  const Dr0 = Float64Array.from(L.delta), Di0 = L.dIm ? Float64Array.from(L.dIm) : new Float64Array(P);
  //   complex helpers on n × n row-major (re, im)
  const cmat = () => ({ r: new Float64Array(n * n), i: new Float64Array(n * n) });
  const buildH = (Dr, Di) => { const H = cmat(); for (let a = 0; a < Mw; a++) { H.r[a * n + a] = e[idx[a]] - mu; H.r[(Mw + a) * n + Mw + a] = -(e[idx[a]] - mu); const pa = a * P;
      for (let b = 0; b <= a; b++) { const pb = b * P; let sr = 0, si = 0; for (let p = 0; p < P; p++) { const w = ph[pa + p] * ph[pb + p]; sr += w * Dr[p]; si += w * Di[p]; }
        for (const [x, y] of [[a, b], [b, a]]) { H.r[x * n + Mw + y] = sr; H.i[x * n + Mw + y] = si; H.r[(Mw + y) * n + x] = sr; H.i[(Mw + y) * n + x] = -si; } } } return H; };
  //   R₀: the projector on H's negative-energy vectors (the window's ground state at the live Δ) — via the real embedding (each level twice → halve)
  const H0 = buildH(Dr0, Di0), n2 = 2 * n, E = new Float64Array(n2 * n2); for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) { const r = H0.r[x * n + y], im = H0.i[x * n + y]; E[x * n2 + y] = r; E[(x + n) * n2 + y + n] = r; E[(x + n) * n2 + y] = im; E[x * n2 + y + n] = -im; }
  const ev = symEig(E, n2), R = cmat(); for (let m = 0; m < n2; m++) { if (ev.d[m] >= 0) continue; for (let x = 0; x < n; x++) { const xr = ev.V[x * n2 + m], xi = ev.V[(x + n) * n2 + m]; for (let y = 0; y < n; y++) { const yr = ev.V[y * n2 + m], yi = ev.V[(y + n) * n2 + m]; R.r[x * n + y] += 0.5 * (xr * yr + xi * yi); R.i[x * n + y] += 0.5 * (xi * yr - xr * yi); } } }
  const kapW = (Rm) => { const kr = new Float64Array(P), ki = new Float64Array(P); for (let a = 0; a < Mw; a++) { const pa = a * P; for (let b = 0; b < Mw; b++) { const q = b * n + Mw + a, cr = -Rm.r[q], ci = -Rm.i[q], pb = b * P; for (let p = 0; p < P; p++) { const w = ph[pa + p] * ph[pb + p]; kr[p] += w * cr; ki[p] += w * ci; } } } return [kr, ki]; };
  const [k0r, k0i] = kapW(R), kdr = new Float64Array(P), kdi = new Float64Array(P); for (let p = 0; p < P; p++) { kdr[p] = Dr0[p] / g0 - k0r[p]; kdi[p] = Di0[p] / g0 - k0i[p]; }   /* κ_deep: Δ(0) = the live Δ exactly */
  const S = { Mw, idx, t: 0, steps: 0, R, ser: [], g0, g1, delta: Dr0, dIm: Di0, P, PX: L.PX, PY: L.PY };
  const deltaOf = (Rm) => { const [kr, ki] = kapW(Rm), Dr = new Float64Array(P), Di = new Float64Array(P); for (let p = 0; p < P; p++) { Dr[p] = g1 * (kdr[p] + kr[p]); Di[p] = g1 * (kdi[p] + ki[p]); } return [Dr, Di]; };
  //   complex dense: C = A·B ; X = A⁻¹·B (Gaussian elimination with partial pivoting)
  const mul = (A, B, conjB = false, transB = false) => { const C = cmat(); for (let x = 0; x < n; x++) for (let k = 0; k < n; k++) { const ar = A.r[x * n + k], ai = A.i[x * n + k]; if (!ar && !ai) continue; for (let y = 0; y < n; y++) { const q = transB ? y * n + k : k * n + y, br = B.r[q], bi = conjB ? -B.i[q] : B.i[q]; C.r[x * n + y] += ar * br - ai * bi; C.i[x * n + y] += ar * bi + ai * br; } } return C; };
  const solve = (A, B) => { const a = { r: Float64Array.from(A.r), i: Float64Array.from(A.i) }, b = { r: Float64Array.from(B.r), i: Float64Array.from(B.i) };
    for (let c = 0; c < n; c++) { let pv = c, best = -1; for (let r = c; r < n; r++) { const m = a.r[r * n + c] ** 2 + a.i[r * n + c] ** 2; if (m > best) { best = m; pv = r; } } if (pv !== c) for (const M of [a, b]) for (const f of ["r", "i"]) for (let y = 0; y < n; y++) { const t = M[f][c * n + y]; M[f][c * n + y] = M[f][pv * n + y]; M[f][pv * n + y] = t; }
      const dr = a.r[c * n + c], di = a.i[c * n + c], dd = dr * dr + di * di; for (let r = c + 1; r < n; r++) { const xr = a.r[r * n + c], xi = a.i[r * n + c]; if (!xr && !xi) continue; const fr = (xr * dr + xi * di) / dd, fi = (xi * dr - xr * di) / dd;
        for (let y = c; y < n; y++) { const ur = a.r[c * n + y], ui = a.i[c * n + y]; a.r[r * n + y] -= fr * ur - fi * ui; a.i[r * n + y] -= fr * ui + fi * ur; } for (let y = 0; y < n; y++) { const ur = b.r[c * n + y], ui = b.i[c * n + y]; b.r[r * n + y] -= fr * ur - fi * ui; b.i[r * n + y] -= fr * ui + fi * ur; } } }
    for (let c = n - 1; c >= 0; c--) { const dr = a.r[c * n + c], di = a.i[c * n + c], dd = dr * dr + di * di; for (let y = 0; y < n; y++) { let sr = b.r[c * n + y], si = b.i[c * n + y]; for (let k = c + 1; k < n; k++) { const ar = a.r[c * n + k], ai = a.i[c * n + k], xr = b.r[k * n + y], xi = b.i[k * n + y]; sr -= ar * xr - ai * xi; si -= ar * xi + ai * xr; } b.r[c * n + y] = (sr * dr + si * di) / dd; b.i[c * n + y] = (si * dr - sr * di) / dd; } } return b; };
  //   one Crank–Nicolson step: U = (1 + iH dt/2)⁻¹ (1 − iH dt/2), R ← U R U† (H from the midpoint estimate: a predictor with R(t), a corrector with ½(R(t) + R̃))
  const cnU = (H, dt) => { const Ap = cmat(), Am = cmat(); for (let q = 0; q < n * n; q++) { Ap.r[q] = -H.i[q] * dt / 2; Ap.i[q] = H.r[q] * dt / 2; Am.r[q] = H.i[q] * dt / 2; Am.i[q] = -H.r[q] * dt / 2; } for (let x = 0; x < n; x++) { Ap.r[x * n + x] += 1; Am.r[x * n + x] += 1; } return solve(Ap, Am); };
  const evolve = (Rm, U) => mul(mul(U, Rm), U, true, true);
  S.step = () => { const dt = dtS / nSub; for (let k = 0; k < nSub; k++) { const [Dr, Di] = deltaOf(S.R), U1 = cnU(buildH(Dr, Di), dt), Rp = evolve(S.R, U1), Rm = cmat(); for (let q = 0; q < n * n; q++) { Rm.r[q] = 0.5 * (S.R.r[q] + Rp.r[q]); Rm.i[q] = 0.5 * (S.R.i[q] + Rp.i[q]); }
      const [Dr2, Di2] = deltaOf(Rm); S.R = evolve(S.R, cnU(buildH(Dr2, Di2), dt)); S.t += dt; S.steps++; }
    const [Dr, Di] = deltaOf(S.R); S.delta = Dr; S.dIm = Di; let dc = 0, nc = 0, dm = 0; for (let p = 0; p < P; p++) { const m = Math.hypot(Dr[p], Di[p]); dm = Math.max(dm, m); if (L.PX[p] ** 2 + L.PY[p] ** 2 < 1) { dc += m; nc++; } }
    let tr = 0; for (let x = 0; x < n; x++) tr += S.R.r[x * n + x]; S.ser.push([S.t, dc / Math.max(1, nc), dm, tr]); if (S.ser.length > 4000) S.ser.shift(); return S; };
  return S;
}
