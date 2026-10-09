/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── mixed-radix-core — one FFT engine for ANY power-of-two G ─────────────────────
//
// radix-r needs G a power of r (radix-4 ⇒ 16,64,256; radix-16 ⇒ 16,256,4096) — so no
// single pure radix covers every size (128=2^7 is stuck at radix-2's 7 stages). MIXED-
// RADIX factors G largest-radix-first into a stage sequence [r0,r1,…] (product = G) and
// runs one butterfly stage per factor. This covers EVERY power-of-two G at near-minimal
// depth (128=[16×8]=2 stages, 512=[16×16×2]=3), subsuming radix-2/4/16 as special cases
// (16=[16], 256=[16×16]). Radix-16 is the base factor — the sweet spot (fewest stages,
// still-cheap nested-4×4 core); radix-8/16 cores cost a few mults, radix-2/4 are twiddle-
// free (±1,±i); radix-32+ core cost outgrows the depth win, so 16 is the practical max.
//
// EXACT to the f64 FLOOR vs a direct DFT / medium-u1's closure fft2d (same Fourier–Mukai
// transform, a different factorization → not bit-identical to radix-2, but at the floor).
// On a node graph the depth = stage count = drain rounds, so mixed-radix (2-3 stages for
// G≤4096) is far shallower than radix-2 (log2 G). Relates: butterfly-core (radix-2 exact).

// factor(G) → the largest-radix-first stage sequence (base radix 16). product(factors)=G.
export function factor(G) {
  const st = []; let m = Math.log2(G) | 0;
  for (const [r, lr] of [[16, 4], [8, 3], [4, 2], [2, 1]]) { while (m >= lr) { st.push(r); m -= lr; } }
  return st;   // e.g. 128→[16,8], 256→[16,16], 512→[16,16,2]
}

// ── the small radix-r DFT cores (fast; write into out arrays of length r) ─────────
// dft_r(xr, xi, r, inv, or, oi): r-point DFT. 2/4 twiddle-free; 8 uses √2/2; 16 nested 4×4.
// s here is the SAME forward=-1 / inverse=+1 convention as _dftDirect (s=inv?1:-1).
// The twiddle-free 4-pt DFT then needs the (∓i) factor built with -s (verified vs dense4).
const _dft4 = (xr, xi, s, o0, or, oi) => {   // 4-pt in-place over indices o0..o0+3 stride 1 in xr/xi
  const x0r = xr[o0], x0i = xi[o0], x1r = xr[o0+1], x1i = xi[o0+1], x2r = xr[o0+2], x2i = xi[o0+2], x3r = xr[o0+3], x3i = xi[o0+3];
  const t0r = x0r + x2r, t0i = x0i + x2i, t1r = x0r - x2r, t1i = x0i - x2i;
  const t2r = x1r + x3r, t2i = x1i + x3i, t3r = x1r - x3r, t3i = x1i - x3i;
  const jr = -s * t3i, ji = s * t3r;   // (∓i)·t3 with the -s convention (matches _dftDirect)
  or[0] = t0r + t2r; oi[0] = t0i + t2i; or[1] = t1r + jr; oi[1] = t1i + ji;
  or[2] = t0r - t2r; oi[2] = t0i - t2i; or[3] = t1r - jr; oi[3] = t1i - ji;
};
// generic small direct DFT (used for r=2,8 and as the fallback) — r tiny so O(r²) fine
const _dftDirect = (xr, xi, r, s, or, oi) => {
  for (let k = 0; k < r; k++) { let sr = 0, si = 0; for (let n = 0; n < r; n++) { const a = s * 2 * Math.PI * k * n / r, c = Math.cos(a), sn = Math.sin(a); sr += xr[n] * c - xi[n] * sn; si += xr[n] * sn + xi[n] * c; } or[k] = sr; oi[k] = si; }
};
// r=16 nested 4×4 (fast) — reuses _dft4 twice with inter-stage twiddles
const _w16 = []; for (let n2 = 0; n2 < 4; n2++) { _w16.push([]); for (let k1 = 0; k1 < 4; k1++) { const a = -2 * Math.PI * n2 * k1 / 16; _w16[n2].push([Math.cos(a), Math.sin(a)]); } }
const _s1r = new Float64Array(4), _s1i = new Float64Array(4), _s2r = new Float64Array(4), _s2i = new Float64Array(4), _colr = new Float64Array(16), _coli = new Float64Array(16);
const _dft16 = (xr, xi, s, or, oi) => {
  for (let n2 = 0; n2 < 4; n2++) { for (let n1 = 0; n1 < 4; n1++) { _s1r[n1] = xr[4 * n1 + n2]; _s1i[n1] = xi[4 * n1 + n2]; }
    _dft4(_s1r, _s1i, s, 0, _s2r, _s2i); for (let k1 = 0; k1 < 4; k1++) { _colr[4 * k1 + n2] = _s2r[k1]; _coli[4 * k1 + n2] = _s2i[k1]; } }
  for (let k1 = 0; k1 < 4; k1++) { const g = 4 * k1;
    for (let n2 = 0; n2 < 4; n2++) { const ar = _colr[g + n2], ai = _coli[g + n2], w = _w16[n2][k1], wr = w[0], wi = -s * w[1]; _s1r[n2] = ar * wr - ai * wi; _s1i[n2] = ar * wi + ai * wr; }
    _dft4(_s1r, _s1i, s, 0, _s2r, _s2i); for (let k2 = 0; k2 < 4; k2++) { or[k1 + 4 * k2] = _s2r[k2]; oi[k1 + 4 * k2] = _s2i[k2]; } }
};
// r=8 nested 4·2 (fast) — 2 dft4 over columns + dft2 with a twiddle (twiddle sign -s,
// output layout k1+4·k2; verified vs direct). Used by G=128=[16×8], G=1024=[16×16×4].
const _w8 = []; for (let k1 = 0; k1 < 4; k1++) { const a = -2 * Math.PI * k1 / 8; _w8.push([Math.cos(a), Math.sin(a)]); }
const _a8r = new Float64Array(8), _a8i = new Float64Array(8), _q4r = new Float64Array(4), _q4i = new Float64Array(4), _p4r = new Float64Array(4), _p4i = new Float64Array(4);
const _dft8 = (xr, xi, s, or, oi) => {
  // A[k1][n2] stored at 2*k1+n2 (k1∈[0,4), n2∈[0,2) → 0..7). (4*k1+n2 overflows the
  // length-8 Float64Array → silent drop → NaN; that was the bug.)
  for (let n2 = 0; n2 < 2; n2++) { for (let n1 = 0; n1 < 4; n1++) { _q4r[n1] = xr[2 * n1 + n2]; _q4i[n1] = xi[2 * n1 + n2]; }
    _dft4(_q4r, _q4i, s, 0, _p4r, _p4i); for (let k1 = 0; k1 < 4; k1++) { _a8r[2 * k1 + n2] = _p4r[k1]; _a8i[2 * k1 + n2] = _p4i[k1]; } }
  for (let k1 = 0; k1 < 4; k1++) { const a0r = _a8r[2 * k1], a0i = _a8i[2 * k1], a1r = _a8r[2 * k1 + 1], a1i = _a8i[2 * k1 + 1];
    const w = _w8[k1], wr = w[0], wi = -s * w[1]; const b1r = a1r * wr - a1i * wi, b1i = a1r * wi + a1i * wr;
    or[k1] = a0r + b1r; oi[k1] = a0i + b1i; or[k1 + 4] = a0r - b1r; oi[k1 + 4] = a0i - b1i; }
};
// r-point DFT dispatch. r=16 nested-4×4, r=8 nested-4·2, r=4 twiddle-free (±1,±i) — all
// FAST (direct O(r²) would be ~15× slower at r=16, and radix-8 stages appear in G=128/1024).
// r=2 direct (trivial). Twiddle signs -s·w[1] (verified vs direct; +s was the earlier bug).
const _dftR = (xr, xi, r, inv, or, oi) => { const s = inv ? 1 : -1;
  if (r === 16) _dft16(xr, xi, s, or, oi);
  else if (r === 8) _dft8(xr, xi, s, or, oi);
  else if (r === 4) _dft4(xr, xi, s, 0, or, oi);
  else _dftDirect(xr, xi, r, s, or, oi);   // 2
};

// ── mixed-radix 1D FFT (in place), factors from factor(G) ──────────────────────────
const _gr = new Float64Array(16), _gi = new Float64Array(16), _pr = new Float64Array(16), _pi = new Float64Array(16);
export function mixedRadix1d(re, im, G, inv, factors) {
  const N = G, S = inv ? 1 : -1;
  // mixed-radix digit-reversal permutation
  { const perm = _permCache.get(G) || _buildPerm(G, factors); const tr = _scr(G).r, ti = _scr(G).i;
    for (let i = 0; i < N; i++) { tr[i] = re[perm[i]]; ti[i] = im[perm[i]]; }
    for (let i = 0; i < N; i++) { re[i] = tr[i]; im[i] = ti[i]; } }
  let len = 1;
  for (const r of factors) { const nlen = len * r;
    for (let base = 0; base < N; base += nlen) for (let k = 0; k < len; k++) {
      for (let q = 0; q < r; q++) { const idx = base + k + q * len; const ang = S * 2 * Math.PI * q * k / nlen, wr = Math.cos(ang), wi = Math.sin(ang);
        _gr[q] = re[idx] * wr - im[idx] * wi; _gi[q] = re[idx] * wi + im[idx] * wr; }
      _dftR(_gr, _gi, r, inv, _pr, _pi);
      for (let p = 0; p < r; p++) { const idx = base + k + p * len; re[idx] = _pr[p]; im[idx] = _pi[p]; }
    }
    len = nlen;
  }
  if (inv) for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
}
const _permCache = new Map();
function _buildPerm(G, factors) { const perm = new Int32Array(G);
  for (let i = 0; i < G; i++) { let x = i, rev = 0, rem = G; for (const r of factors) { rem /= r; rev += (x % r) * rem; x = (x / r) | 0; } perm[i] = rev; }
  _permCache.set(G, perm); return perm; }
const _scrCache = new Map();
function _scr(G) { let s = _scrCache.get(G); if (!s) { s = { r: new Float64Array(G), i: new Float64Array(G) }; _scrCache.set(G, s); } return s; }

// ── poseSamples — TURN / ZOOM A STORED FIELD (samples, no generator) about the plate's centre (G−1)/2, as honestly as samples allow ──────
//   · quarter turns: an exact PERMUTATION of the cells (lossless for any content);
//   · the residual turn |a| ≤ π/4: THREE SHEARS (x, y, x — Paeth), each a per-row fractional shift by the shift theorem: UNITARY, exact for
//     band-limited content (the k = G/2 bin takes the symmetric real response cos(π·d), as _specShiftAtt) — no interpolation kernel;
//   · zoom z: the field's Fourier series evaluated at the scaled places, separably (rows, then columns): exact for band-limited content when
//     magnifying; when shrinking (z < 1) the band above z·Nyquist is cut first (a demagnifying optic's finite aperture — else it aliases) and
//     the places beyond the plate are DARK (one plate, not the torus's periodic copies; a 2-cell soft edge).
//   Pure fn of (re, im, G, r, z): world and renderer import this one function, so their pins agree byte for byte.
const _pzMemo = new Map();
function _zoomMat(G, z) { const k = G + "|" + z; let M = _pzMemo.get(k); if (M) return M; const c = (G - 1) / 2, H = G >> 1, Mr = new Float64Array(G * G), Mi = new Float64Array(G * G);
  for (let x = 0; x < G; x++) { const u = c + (x - c) / z, ed = Math.min(u + 0.5, G - 0.5 - u), w = ed >= 2 ? 1 : ed <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * ed / 2);
    for (let q = 0; q < G; q++) { const kq = q <= H ? q : q - G, cut = z < 1 && Math.abs(kq) > z * H ? 0 : (q === H ? Math.cos(Math.PI * (u - Math.round(u))) * Math.cos(Math.PI * Math.round(u)) : 1), ph = q === H ? 0 : 2 * Math.PI * kq * u / G;   // (the Nyquist bin: its real response cos(π·u) is in `cut`)
      Mr[x * G + q] = w * cut * Math.cos(ph) / G; Mi[x * G + q] = w * cut * Math.sin(ph) / G; } }
  if (_pzMemo.size > 8) _pzMemo.clear(); M = { Mr, Mi }; _pzMemo.set(k, M); return M; }
export function poseSamples(re0, im0, G, r = 0, z = 1) { const N = G * G, fac = factor(G), H = G >> 1, c = (G - 1) / 2;
  let re = Float64Array.from(re0, Number), im = im0 ? Float64Array.from(im0, Number) : new Float64Array(N);
  const rowR = new Float64Array(G), rowI = new Float64Array(G), outR = new Float64Array(G), outI = new Float64Array(G);
  const along = (axisX, fn) => { for (let a = 0; a < G; a++) { for (let b = 0; b < G; b++) { const j = axisX ? a * G + b : b * G + a; rowR[b] = re[j]; rowI[b] = im[j]; }
      mixedRadix1d(rowR, rowI, G, false, fac); fn(a, rowR, rowI); for (let b = 0; b < G; b++) { const j = axisX ? a * G + b : b * G + a; re[j] = rowR[b]; im[j] = rowI[b]; } } };
  if (Number.isFinite(z) && z > 0 && z !== 1) { const { Mr, Mi } = _zoomMat(G, z);   // the Fourier series at the scaled places: one G×G evaluation per line
    const ev = (a, R, I) => { for (let x = 0; x < G; x++) { let sr = 0, si = 0; const o = x * G; for (let q = 0; q < G; q++) { const mr = Mr[o + q], mi = Mi[o + q]; sr += R[q] * mr - I[q] * mi; si += R[q] * mi + I[q] * mr; } outR[x] = sr; outI[x] = si; } R.set(outR); I.set(outI); };
    along(true, ev); along(false, ev); }
  r = +r || 0; if (r) { const q = ((Math.round(r / (Math.PI / 2)) % 4) + 4) % 4, a = r - Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
    for (let t = 0; t < q; t++) { const nr = new Float64Array(N), ni = new Float64Array(N); for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const d = x * G + (G - 1 - y); nr[d] = re[y * G + x]; ni[d] = im[y * G + x]; } re = nr; im = ni; }   // (x, y) → (G−1−y, x): a quarter turn, exact
    if (Math.abs(a) > 1e-12) { const tx = -Math.tan(a / 2), sy = Math.sin(a);
      const shear = (axisX, slope) => along(axisX, (line, R, I) => { const d = slope * (line - c);   // line = the row's y (x-shear) or the column's x (y-shear); shift its content by d
        for (let q = 0; q < G; q++) { if (q === H) { const g = Math.cos(Math.PI * d); R[q] *= g; I[q] *= g; continue; } const kq = q < H ? q : q - G, ph = -2 * Math.PI * kq * d / G, cr = Math.cos(ph), ci = Math.sin(ph), vr = R[q] * cr - I[q] * ci; I[q] = R[q] * ci + I[q] * cr; R[q] = vr; }
        mixedRadix1d(R, I, G, true, fac); });
      shear(true, tx); shear(false, sy); shear(true, tx); } }
  return { re, im }; }

// ── 2D over G×G (rows then cols) ───────────────────────────────────────────────────
export function mixedRadix2d(re, im, G, inv = false) {
  const factors = factor(G); const row = _rowScr(G).r, rowi = _rowScr(G).i;
  for (let y = 0; y < G; y++) { const off = y * G; for (let x = 0; x < G; x++) { row[x] = re[off + x]; rowi[x] = im[off + x]; }
    mixedRadix1d(row, rowi, G, inv, factors); for (let x = 0; x < G; x++) { re[off + x] = row[x]; im[off + x] = rowi[x]; } }
  for (let x = 0; x < G; x++) { for (let y = 0; y < G; y++) { row[y] = re[y * G + x]; rowi[y] = im[y * G + x]; }
    mixedRadix1d(row, rowi, G, inv, factors); for (let y = 0; y < G; y++) { re[y * G + x] = row[y]; im[y * G + x] = rowi[y]; } }
}
const _rowScrCache = new Map();
function _rowScr(G) { let s = _rowScrCache.get(G); if (!s) { s = { r: new Float64Array(G), i: new Float64Array(G) }; _rowScrCache.set(G, s); } return s; }

// ── λ(k) from a ring descriptor {r,w,o} = FFT of the integer-offset stencil image ──
// (kernelLambdaGrid's fast build, via mixedRadix2d). Single source for both the module
// and the KWE world program (which imports this). λ = (re, −im) of the stencil DFT.
export function lambdaFromRing(ring, G) {
  const N = G * G; const sr = new Float64Array(N), si = new Float64Array(N);
  const put = (dx, dy, c) => { sr[(((dy % G) + G) % G) * G + (((dx % G) + G) % G)] += c; };
  put(1, 0, 4 / 6); put(-1, 0, 4 / 6); put(0, 1, 4 / 6); put(0, -1, 4 / 6);
  put(1, 1, 1 / 6); put(-1, -1, 1 / 6); put(1, -1, 1 / 6); put(-1, 1, 1 / 6); put(0, 0, -20 / 6);
  for (let d = 0; d < (ring.r?.length || 0); d++) { const o = ring.o[d] || []; const n = o.length >> 1; if (!n) continue;
    const nu = 4 * (ring.w[d] || 0) / n; for (let i = 0; i < n; i++) put(o[i * 2], o[i * 2 + 1], nu); put(0, 0, -nu * n); }
  mixedRadix2d(sr, si, G, false);
  const im = new Float64Array(N); for (let i = 0; i < N; i++) im[i] = -si[i];
  return { re: sr, im };
}

// ── one AHC field step (T=1 diagonal op via mixed-radix) + SPM + cap. The medium step
// the apps run each beat. re/im = flat arrays; returns new {re, im}. ─────────────────
export function mixedRadixStep(re, im, G, lam, dt, spm, cap) {
  const N = G * G;
  const Rr = Float64Array.from(re), Ri = new Float64Array(N), Ir = Float64Array.from(im), Ii = new Float64Array(N);
  mixedRadix2d(Rr, Ri, G, false); mixedRadix2d(Ir, Ii, G, false);
  for (let j = 0; j < N; j++) { const lr = lam.re[j], li = lam.im[j];
    const hr = dt / 4 * lr, hi = dt / 4 * li, fr = dt / 2 * lr, fi = dt / 2 * li;
    const hfr = hr * fr - hi * fi, hfi = hr * fi + hi * fr; const xr = 1 - hfr, xi = -hfi;
    const t2r = 2 - hfr, t2i = -hfi; const m12r = -(hr * t2r - hi * t2i), m12i = -(hr * t2i + hi * t2r);
    const A11r = xr, A11i = xi, A12r = m12r, A12i = m12i, A21r = fr, A21i = fi;
    const Rre = Rr[j], Rim = Ri[j], Ire = Ir[j], Iim = Ii[j];
    Rr[j] = A11r * Rre - A11i * Rim + A12r * Ire - A12i * Iim; Ri[j] = A11r * Rim + A11i * Rre + A12r * Iim + A12i * Ire;
    Ir[j] = A21r * Rre - A21i * Rim + A11r * Ire - A11i * Iim; Ii[j] = A21r * Rim + A21i * Rre + A11r * Iim + A11i * Ire;
  }
  mixedRadix2d(Rr, Ri, G, true); mixedRadix2d(Ir, Ii, G, true);
  const nre = new Array(N), nim = new Array(N);
  for (let i = 0; i < N; i++) { let pr = Rr[i], pi = Ir[i];
    const m2 = pr * pr + pi * pi, ph = m2 * spm, cp = Math.cos(ph), sp = Math.sin(ph);
    { const a = pr * cp - pi * sp, b = pr * sp + pi * cp; pr = a; pi = b; }
    const aa = Math.hypot(pr, pi); if (aa > cap) { const g = cap / aa; pr *= g; pi *= g; }
    nre[i] = pr; nim[i] = pi; }
  return { re: nre, im: nim };
}

//   _chebPow(xr, xi, qr, qi, T, out) — (U_{T−1}, U_{T−2}) of x for the one-step map M = x·I + N, N² = q·I, det M = x² − q = 1: M^T = α·I + β·N
//   by BINARY POWERING (log₂T complex multiplies, not T−2), then U_{T−1} = β, U_{T−2} = x·β − α — the same algebra as the 2nd-kind Chebyshev
//   recurrence (2026-10-07; MEASURED identical to 4e-12 relative over 20 000 random modes, T 1 … 300). T = 1 never comes here (bit-exact path).
function _chebPow(xr, xi, qr, qi, T, out) { let ar = 1, ai = 0, br = 0, bi = 0, pr = xr, pi = xi, sr = 1, si = 0, n = T;
  while (n > 0) { if (n & 1) { const bbr = br * sr - bi * si, bbi = br * si + bi * sr, nar = ar * pr - ai * pi + bbr * qr - bbi * qi, nai = ar * pi + ai * pr + bbr * qi + bbi * qr, nbr = ar * sr - ai * si + br * pr - bi * pi, nbi = ar * si + ai * sr + br * pi + bi * pr; ar = nar; ai = nai; br = nbr; bi = nbi; }
    n >>= 1; if (n) { const ssr = sr * sr - si * si, ssi = 2 * sr * si, npr = pr * pr - pi * pi + ssr * qr - ssi * qi, npi = 2 * pr * pi + ssr * qi + ssi * qr, nsr = 2 * (pr * sr - pi * si), nsi = 2 * (pr * si + pi * sr); pr = npr; pi = npi; sr = nsr; si = nsi; } }
  out[0] = br; out[1] = bi; out[2] = xr * br - xi * bi - ar; out[3] = xr * bi + xi * br - ai; }
const _cp = new Float64Array(4);
// ── the AHC linear step via mixed-radix (the diagonal M^T Chebyshev op, per mode) ──
// Byte-identical map to kernelPropagateSpectral, transform via mixed-radix (f64 floor).
export function mixedRadixPropagate(field, G, lam, { T = 1, dt = 1, kCut = 0 } = {}) {
  const N = G * G;
  const Rr = new Float64Array(N), Ri = new Float64Array(N), Ir = new Float64Array(N), Ii = new Float64Array(N);
  for (let j = 0; j < N; j++) { Rr[j] = field[j * 2]; Ir[j] = field[j * 2 + 1]; }
  mixedRadix2d(Rr, Ri, G, false); mixedRadix2d(Ir, Ii, G, false);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x;
    const kx = 2 * Math.PI * (x <= G / 2 ? x : x - G) / G, ky = 2 * Math.PI * (y <= G / 2 ? y : y - G) / G;
    if (kCut > 0 && Math.hypot(kx, ky) > kCut) { Rr[j] = Ri[j] = Ir[j] = Ii[j] = 0; continue; }
    const lr = lam.re[j], li = lam.im[j];
    const hr = (dt / 4) * lr, hi = (dt / 4) * li, fr = (dt / 2) * lr, fi = (dt / 2) * li;
    const hfr = hr * fr - hi * fi, hfi = hr * fi + hi * fr; const xr = 1 - hfr, xi = -hfi;
    const t2r = 2 - hfr, t2i = -hfi; const m12r = -(hr * t2r - hi * t2i), m12i = -(hr * t2i + hi * t2r);
    let u1r, u1i, u0r, u0i;
    if (T === 1) { u1r = 1; u1i = 0; u0r = 0; u0i = 0; }
    else { _chebPow(xr, xi, m12r * fr - m12i * fi, m12r * fi + m12i * fr, T, _cp); u1r = _cp[0]; u1i = _cp[1]; u0r = _cp[2]; u0i = _cp[3]; }   // O(log T), see _chebPow
    const A11r = (u1r * xr - u1i * xi) - u0r, A11i = (u1r * xi + u1i * xr) - u0i;
    const A12r = u1r * m12r - u1i * m12i, A12i = u1r * m12i + u1i * m12r;
    const A21r = u1r * fr - u1i * fi, A21i = u1r * fi + u1i * fr;
    const Rre = Rr[j], Rim = Ri[j], Ire = Ir[j], Iim = Ii[j];
    Rr[j] = A11r * Rre - A11i * Rim + A12r * Ire - A12i * Iim; Ri[j] = A11r * Rim + A11i * Rre + A12r * Iim + A12i * Ire;
    Ir[j] = A21r * Rre - A21i * Rim + A11r * Ire - A11i * Iim; Ii[j] = A21r * Rim + A21i * Rre + A11r * Iim + A11i * Ire;
  }
  mixedRadix2d(Rr, Ri, G, true); mixedRadix2d(Ir, Ii, G, true);
  const out = new Float64Array(2 * N);
  for (let j = 0; j < N; j++) { out[j * 2] = Rr[j]; out[j * 2 + 1] = Ir[j]; }
  return { field: out, total: N };
}
