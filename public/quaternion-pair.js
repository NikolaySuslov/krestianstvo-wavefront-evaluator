/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ═══════════════════════════════════════════════════════════════════════════
// quaternion-pair.js — a quaternion as a PAIR of complex fields (Cayley–Dickson)
//
// ℍ = ℂ ⊕ ℂ·j :  q = z₀ + z₁·j ,  z₀,z₁ ∈ ℂ ,  j² = −1 ,  i·j = −i·j  (j·z = z̄·j).
// So a quaternion FIELD is an ordered pair of the AHC's existing complex fields:
//   slot A = z₀ (the "1,i" plane) , slot B = z₁ (the "j,k" plane).
// The quaternion PRODUCT in this basis is the ONE operator to add to the medium — two pointwise complex
// multiplies + a conjugate, cross-wired between the pair. It reuses the medium's ψA·ψB binding.
//
// This module is PURE + headless (no GPU, no reflector) so the algebra can be proven before wiring an app verb.
// See doc/quaternion-slot-pair.md.
// ═══════════════════════════════════════════════════════════════════════════

// ── scalar complex ops (a complex number = [re, im]) ─────────────────────────
export const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];   // (a·b)
export const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const cconj = (a) => [a[0], -a[1]];                                              // z̄

// ── a quaternion as the pair (z0, z1) of complex numbers ─────────────────────
//   q = z0 + z1·j = (a + b·i) + (c + d·i)·j = a + b·i + c·j + d·k
//   so z0 = [a, b] (the 1,i part) and z1 = [c, d] (the j,k part).
export const fromWXYZ = (w, x, y, z) => ({ z0: [w, x], z1: [y, z] });                   // (a,bi,cj,dk) → pair
export const toWXYZ   = (q) => [q.z0[0], q.z0[1], q.z1[0], q.z1[1]];                     // pair → [w,x,y,z]

// ── THE product: P = Q·R in the pair basis (Cayley–Dickson, using j·z = z̄·j) ─
//   (a + b·j)(c + d·j) = (a·c − d̄·b) + (b·c̄ + d·a)·j
//   with a=Q.z0, b=Q.z1, c=R.z0, d=R.z1 :
//     p0 = a·c − conj(d)·b            ← slot A
//     p1 = b·conj(c) + d·a            ← slot B
//   NOTE: the ORDER matters (conj(d)·b, not b·conj(d)) — that is the non-commutativity. Do NOT symmetrize.
export const qmul = (Q, R) => {
  const a = Q.z0, b = Q.z1, c = R.z0, d = R.z1;
  const p0 = csub(cmul(a, c), cmul(cconj(d), b));   // slot A: a·c − d̄·b
  const p1 = cadd(cmul(b, cconj(c)), cmul(d, a));   // slot B: b·c̄ + d·a
  return { z0: p0, z1: p1 };
};

// ── the rest of the ℍ vocabulary, all in the pair basis (for the SU(2) register / tests) ──
export const qadd  = (Q, R) => ({ z0: cadd(Q.z0, R.z0), z1: cadd(Q.z1, R.z1) });
export const qconj = (Q) => ({ z0: cconj(Q.z0), z1: [-Q.z1[0], -Q.z1[1]] });            // conj: (w,−x,−y,−z) = (z̄0, −z1)
export const qnorm2 = (Q) => Q.z0[0] ** 2 + Q.z0[1] ** 2 + Q.z1[0] ** 2 + Q.z1[1] ** 2; // |q|² = w²+x²+y²+z²
export const qscale = (Q, s) => ({ z0: [Q.z0[0] * s, Q.z0[1] * s], z1: [Q.z1[0] * s, Q.z1[1] * s] });

// ── FIELD version: a quaternion FIELD = two complex fields {re,im} of length N (slot A, slot B). ──
//   qmulField(QA,QB, RA,RB) → {pA, pB} : the per-cell Cayley–Dickson product = the AHC qedge coupling op.
//   Each of pA,pB is {re:Float64Array(N), im:Float64Array(N)}. All ops are pointwise complex mul / conj.
export const qmulField = (QA, QB, RA, RB, N) => {
  const pAr = new Float64Array(N), pAi = new Float64Array(N), pBr = new Float64Array(N), pBi = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const ar = QA.re[n], ai = QA.im[n], br = QB.re[n], bi = QB.im[n];   // a = z0(A) , b = z1(B) of Q
    const cr = RA.re[n], ci = RA.im[n], dr = RB.re[n], di = RB.im[n];   // c = z0(A) , d = z1(B) of R
    // p0 = a·c − d̄·b     (slot A)
    const ac_r = ar * cr - ai * ci, ac_i = ar * ci + ai * cr;           // a·c
    const dcb_r = dr * br - (-di) * bi, dcb_i = dr * bi + (-di) * br;    // d̄·b  (d̄ = [dr, −di])
    pAr[n] = ac_r - dcb_r; pAi[n] = ac_i - dcb_i;
    // p1 = b·c̄ + d·a     (slot B)
    const bcc_r = br * cr - bi * (-ci), bcc_i = br * (-ci) + bi * cr;    // b·c̄  (c̄ = [cr, −ci])
    const da_r = dr * ar - di * ai, da_i = dr * ai + di * ar;           // d·a
    pBr[n] = bcc_r + da_r; pBi[n] = bcc_i + da_i;
  }
  return { pA: { re: pAr, im: pAi }, pB: { re: pBr, im: pBi } };
};

// ═══════════════════════════════════════════════════════════════════════════
// SU(2) REGISTER — a unit quaternion acting on the pair by RIGHT multiplication ψ_ℍ ← ψ_ℍ·u.
//
//   WHICH SIDE IS NOT A CONVENTION HERE (2026-09-23 — it was LEFT until then, and that was wrong).
//   The medium's own complex structure is multiplication from the LEFT: the ∠ aging e^{i∠} on both
//   channels is e^{i∠}·(z₀ + z₁·j), and the propagator λ(k) is a complex kernel applied the same way.
//   A register action must COMMUTE with that, or it is not a symmetry of the medium — it fights it.
//     · LEFT u·ψ is ANTILINEAR (its pair form carries conj(ψ_A), conj(ψ_B)). MEASURED against one
//       medium sub-step: commutation error 3.4e-2 for the linear step alone, 0.38 against a plain global
//       phase. A rotated-then-evolved pair is a different field from an evolved-then-rotated one.
//     · RIGHT ψ·u is ℂ-LINEAR: in the pair basis it is the SU(2) MATRIX acting on the spinor
//           (ψ_A, ψ_B) ↦ [[u₀, −ū₁], [u₁, ū₀]]·(ψ_A, ψ_B)
//       — the textbook spin-½ rotation. MEASURED: commutes with the linear step and the global phase to
//       f64 (7e-16), and with the WHOLE step once the nonlinearity and the energy cap depend on the pair
//       density |ψ_A|²+|ψ_B|² (see ahc-mixed-radix.js's pair-covariant turbo step).
//   So the pair is a SPINOR FIELD: ℂ² at every cell, total density |ψ_A|²+|ψ_B|² invariant, the Bloch
//   vector S = ψ†σψ rotated rigidly by R(u). The register's U(1) ∠ (a left scalar) and this SU(2) (a
//   right action) commute — together they are U(2) = U(1)×SU(2)/ℤ₂, the full symmetry of a free spinor.
//   NOTE the u₁=0 slice is now σ_z (e^{+iθ/2} on A, e^{−iθ/2} on B), a genuine spin rotation — NOT the
//   global ∠ phase, which is the separate U(1) factor the lensU1 register already owns.
// ═══════════════════════════════════════════════════════════════════════════

// a unit quaternion from axis n̂=(nx,ny,nz) and angle θ:  u = cos(θ/2) + n̂·(i,j,k)·sin(θ/2)
//   in pair basis: u0 = [cos(θ/2), nz·sin(θ/2)] , u1 = [nx·sin(θ/2), ny·sin(θ/2)]
export const su2 = (nx, ny, nz, theta) => {
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2), L = Math.hypot(nx, ny, nz) || 1;
  const ux = nx / L, uy = ny / L, uz = nz / L;
  return { z0: [c, uz * s], z1: [ux * s, uy * s] };
};

// apply the register to a quaternion FIELD (per cell): ψ_ℍ ← ψ_ℍ·u  (u the SAME for every cell = a global lens).
//   Returns the rotated pair {pA,pB} = [[u₀,−ū₁],[u₁,ū₀]]·(ψ_A,ψ_B), ℂ-linear (see the note above). Norm-preserving
//   per cell. Composition: (ψ·u)·v = ψ·(u·v).
export const su2ApplyField = (u, QA, QB, N) => {
  // Q·u with u constant: reuse qmulField by broadcasting u into constant fields (the FIELD is the left factor).
  const uAr = new Float64Array(N).fill(u.z0[0]), uAi = new Float64Array(N).fill(u.z0[1]);
  const uBr = new Float64Array(N).fill(u.z1[0]), uBi = new Float64Array(N).fill(u.z1[1]);
  return qmulField(QA, QB, { re: uAr, im: uAi }, { re: uBr, im: uBi }, N);
};

// SU(2) precession by one beat: u ← u · exp(½ ω n̂·𝐢)  (accumulated on the RIGHT, matching the action above).
export const su2Precess = (u, nx, ny, nz, omega) => qmul(u, su2(nx, ny, nz, omega));

// ═══════════════════════════════════════════════════════════════════════════
// SU(2) SPIN-LOCK — the quaternion generalization of the U(1) injection pin (finding_pin_injection_lock).
//   U(1) pin: ψ ← ψ + β·(att·e^{i∠}) — pull each cell toward a rotating target AMPLITUDE (a point on a circle).
//   SU(2) spin-lock: ψ_ℍ ← ψ_ℍ + β·(refₕ·u − ψ_ℍ) — pull the PAIR toward a target SPINOR ORIENTATION on S³
//     (refₕ·u = the reference spinor field rotated to the target orientation u). β is the lock stiffness. The
//     capture region is a SOLID ANGLE on S³ (a basin), not a range on a circle — the "spin-locked to an effective
//     SU(2) field" of NMR. u = identity → reduces to the U(1) additive injection toward ref on both channels.
//   refA/refB = the held reference spinor field (the ℍ analog of att; e.g. |ψ| as a real spinor, or the recalled
//   moment). Returns the pulled pair {A,B}. Norm-relaxing (contracts |ψ_ℍ − u·refₕ| by (1−β) each beat → the field
//   RELAXES onto the target orientation, exactly the injection-lock settle). The medium's cap re-normalizes energy.
export const su2Lock = (u, QA, QB, refA, refB, beta, N) => {
  const { pA: tA, pB: tB } = su2ApplyField(u, refA, refB, N);   // target = refₕ·u (the reference at orientation u)
  const A = { re: new Float64Array(N), im: new Float64Array(N) }, B = { re: new Float64Array(N), im: new Float64Array(N) };
  for (let n = 0; n < N; n++) {
    A.re[n] = QA.re[n] + beta * (tA.re[n] - QA.re[n]);   // ψ ← ψ + β·(target − ψ)  (a soft pull toward u·refₕ)
    A.im[n] = QA.im[n] + beta * (tA.im[n] - QA.im[n]);
    B.re[n] = QB.re[n] + beta * (tB.re[n] - QB.re[n]);
    B.im[n] = QB.im[n] + beta * (tB.im[n] - QB.im[n]);
  }
  return { A, B };
};

// ═══════════════════════════════════════════════════════════════════════════
// QUATERNION CONTENT-ADDRESS — qcorr: the ℍ generalization of the real overlap the bank uses for recall.
//   Today's _corr(ψ,φ) = Re⟨ψ,φ⟩ / (‖ψ‖‖φ‖) — a SCALAR: it can only match by amplitude/phase-alignment, so two
//   stored moments with the same magnitude profile but a DIFFERENT relative SPIN are indistinguishable. Over the
//   slot PAIR the natural overlap is a full QUATERNION:
//
//       ⟨ψ_ℍ, φ_ℍ⟩_ℍ  =  Σₙ  conj_ℍ(ψ_ℍ[n]) · φ_ℍ[n]        (a Hermitian ℍ-inner-product, per-cell qmul, summed)
//
//   with conj_ℍ = the quaternion conjugate (w,−x,−y,−z) = (z̄0, −z1). This returns ONE quaternion Σ = [w,x,y,z]:
//     • SCALAR part w = Σ Re(z̄0·φ0) + Re(z̄1·φ1) = EXACTLY today's real overlap over the two channels combined
//       (the conservative slice — take .w to recover the U(1) content-address byte-for-byte).
//     • VECTOR part (x,y,z) = the axis·magnitude of the RELATIVE SPINOR ROTATION carrying φ_ℍ onto ψ_ℍ — nonzero
//       only when cue and plate differ by a genuine SU(2) twist. ‖vec‖ measures spin MISMATCH.
//   So recall can score by the FULL quaternion: match amplitude (w) AND spin (‖vec‖ small ⇒ same orientation).
export const qcorr = (QA, QB, RA, RB, N) => {
  let w = 0, x = 0, y = 0, z = 0;
  for (let n = 0; n < N; n++) {
    // conj_ℍ(Q) at cell n:  z̄0 = [QA.re, −QA.im] , −z1 = [−QB.re, −QB.im]
    const a = [QA.re[n], -QA.im[n]], b = [-QB.re[n], -QB.im[n]];   // conj_ℍ(ψ_ℍ)
    const c = [RA.re[n], RA.im[n]], d = [RB.re[n], RB.im[n]];      // φ_ℍ
    // per-cell Cayley–Dickson product (a+b·j)(c+d·j) = (a·c − d̄·b) + (b·c̄ + d·a)·j, accumulated
    const ac_r = a[0]*c[0] - a[1]*c[1], ac_i = a[0]*c[1] + a[1]*c[0];             // a·c
    const dcb_r = d[0]*b[0] - (-d[1])*b[1], dcb_i = d[0]*b[1] + (-d[1])*b[0];     // d̄·b
    const bcc_r = b[0]*c[0] - b[1]*(-c[1]), bcc_i = b[0]*(-c[1]) + b[1]*c[0];     // b·c̄
    const da_r = d[0]*a[0] - d[1]*a[1], da_i = d[0]*a[1] + d[1]*a[0];            // d·a
    w += ac_r - dcb_r; x += ac_i - dcb_i;   // slot-A output = scalar (w) + i (x)
    y += bcc_r + da_r; z += bcc_i + da_i;   // slot-B output = j (y) + k (z)
  }
  return [w, x, y, z];   // the overlap quaternion [w,x,y,z]
};

// NORMALIZED quaternion content-address score (the drop-in for _corr): returns {w, vec, score, q}.
//   w      = the scalar overlap, normalized by ‖ψ_ℍ‖‖φ_ℍ‖ ∈ [−1,1]  — EXACTLY today's _corr over the pair.
//   vec    = ‖vector part‖ / (‖ψ_ℍ‖‖φ_ℍ‖) ∈ [0,1]                  — the SPIN MISMATCH (0 = same orientation).
//   score  = w − spinPenalty·vec   — the content-address ranking: high scalar overlap AND low spin mismatch wins.
//   spinPenalty=0 ⇒ score=w ⇒ IDENTICAL to today's real-overlap recall (the conservative default).
export const qcorrScore = (QA, QB, RA, RB, N, spinPenalty = 1) => {
  const q = qcorr(QA, QB, RA, RB, N);
  let np = 0, nq = 0;   // ‖ψ_ℍ‖² , ‖φ_ℍ‖²  (each = Σ |z0|²+|z1|² over the pair)
  for (let n = 0; n < N; n++) {
    np += QA.re[n]**2 + QA.im[n]**2 + QB.re[n]**2 + QB.im[n]**2;
    nq += RA.re[n]**2 + RA.im[n]**2 + RB.re[n]**2 + RB.im[n]**2;
  }
  const norm = Math.sqrt(np * nq) || 1;
  const w = q[0] / norm, vec = Math.hypot(q[1], q[2], q[3]) / norm;
  return { w, vec, score: w - spinPenalty * vec, q };
};

// ═══════════════════════════════════════════════════════════════════════════
// SU(2) KURAMOTO — the quaternionic lift of the XY phase law (2026-09-22).
//   U(1) Kuramoto: dθᵢ = Σⱼ κᵢⱼ·sin(θⱼ − θᵢ)   — a SCALAR kick on a circle.
//   SU(2) Kuramoto: each unit carries an ORIENTATION SPINOR uᵢ ∈ S³ and relaxes on the sphere.
//
//   THE ENERGY. The natural lift of −Σκ·cos(Δθ) is
//       E = −Σ_{i<j} κᵢⱼ · wᵢⱼ ,      wᵢⱼ = Re⟨uᵢ, uⱼ⟩ = cos(Δᵢⱼ/2)
//   and w is EXACTLY the scalar part of qcorr — VERIFIED identical to the plain ℝ⁴ dot product
//   uᵢ·uⱼ to 2.2e-16 over 5000 random pairs. So E is a QUADRATIC FORM on (S³)ⁿ and its gradient
//   is available in closed form; nothing has to be approximated.
//
//   THE FLOW (Riemannian gradient descent on the product of spheres):
//       ambientᵢ = ∂E/∂uᵢ = −Σⱼ κᵢⱼ·uⱼ
//       gᵢ       = P(uᵢ)·ambientᵢ ,   P(u)x = x − (x·u)u      (project onto Tᵤ S³)
//       uᵢ      ← normalise(uᵢ − η·gᵢ)
//
//   WHY THE PROJECTION IS THE WHOLE POINT, recorded because the obvious law fails. The first
//   attempt used the qcorr VECTOR part as a torque — uᵢ ← su2(axis=Σκ·vec, |…|)·uᵢ — which moves
//   along a great circle generated by the relative spinor. MEASURED: that is a true gradient flow
//   for κ>0 (energy fell 20000/20000 steps, hit −1.5 exactly) and NOT one for κ<0 (energy rose on
//   ~half the steps at every step size from 0.02 down to 0.0002, and it never settled — 8 random
//   starts gave 8 configurations, still drifting 19.8° after 40000 steps). The two maps coincide
//   only when every uⱼ agrees, which is exactly the ferromagnetic case. The projected gradient is
//   correct on both branches.
//
//   MEASURED on the frustrated triangle (3 units, all pairs κ = −0.5), 8 random starts:
//       E = −0.75000000 (the analytic bound), w = −0.5 on all three pairs, 0 rises in 40000 steps,
//       settled to 1e-9. Ferromagnetic κ=+0.5 → E = −1.5 exactly, w = +1.
//
//   ── THE TRIANGLE IS THE WRONG BENCHMARK FOR THIS LAW, and the measurement says so twice.
//   (2026-09-22, user: "is the frustrated triangle the correct task for quaternion XY, maybe that is
//   the wrong problem here?" — it is, and here is the evidence.)
//   RANK OF THE SPAN of the ground state on a complete graph K_n, all κ = −0.5 (how many of S³'s four
//   dimensions the answer actually uses):
//       K2 → rank 1, E = −0.50   (two units cannot frustrate at all: w = −1 exactly, perfectly
//                                 satisfied — the double cover makes the antipode a free escape,
//                                 which is NOT true on the circle)
//       K3 → rank 2, E = −0.75   ← COPLANAR. the triangle's answer is the XY answer in an S³ gauge.
//       K4 → rank 3, E = −1.00   ← genuinely non-coplanar
//       K5 → rank 4, E = −1.25   ← uses all of S³
//   So the triangle is the LARGEST frustrated case that does not need quaternions: its ground state
//   spans a 2-plane, i.e. a great circle, and the extra two dimensions are pure gauge. Reading a
//   quaternionic result into it would be reading in the gauge.
//   THE RIGHT TASK IS K4, and ahc has exactly four slots. MEASURED: E = −1.00000000 (the bound —
//   attained when Σuᵢ = 0, a regular simplex in ℝ⁴), rank 3, and the pair angles come out UNEQUAL
//   (119.3°, 67.0°, 95.7° over the six pairs) — a configuration XY cannot represent at all, because
//   on a circle four mutually repelling phases can only be the 90° cross.
//   Use K3 to check the law against the familiar answer; use K4 to see what the law is FOR.
//
//   NOTE ON THE DOUBLE COVER: u and −u are the same ROTATION but opposite spinors, so a TWO-unit
//   antiferromagnet is not frustrated at all — it reaches w = −1 exactly (perfect antipodal
//   alignment). Frustration needs three. That differs from the circle, where two anti-aligned
//   oscillators already obstruct a third.
//
//   us   = array of unit quaternions as [w,x,y,z] (toWXYZ form — the ℝ⁴ view IS the manifold here)
//   edge = the symmetric κ matrix (edge[i][j]); falsy entries are no coupling
//   eta  = step size. Returns { us, any } — `any` false when no edge is live (caller keeps state).
//   PURE: same inputs → same outputs, no clock, no RNG. Safe for a replicated reducer.
export const su2KuramotoStep = (us, edge, { eta = 0.01, born = null } = {}) => {
  const n = us.length;
  if (!edge) return { us, any: false };
  const live = (i) => (born == null ? true : (typeof born === 'function' ? !!born(i) : !!born[i]));
  const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let any = false;
  const out = us.map((u) => u.slice());
  for (let i = 0; i < n; i++) {
    if (!live(i)) continue;
    const amb = [0, 0, 0, 0];
    for (let j = 0; j < n; j++) { const k = edge[i] && edge[i][j];
      if (!k || i === j || !live(j)) continue;
      any = true;
      for (let a = 0; a < 4; a++) amb[a] -= k * us[j][a];   // ∂E/∂uᵢ = −Σ κ uⱼ
    }
    const d = dot4(amb, us[i]);
    let nn = 0;
    for (let a = 0; a < 4; a++) { const v = us[i][a] - eta * (amb[a] - d * us[i][a]); out[i][a] = v; nn += v * v; }
    const s = Math.sqrt(nn) || 1;
    for (let a = 0; a < 4; a++) out[i][a] /= s;             // back onto S³
  }
  return { us: any ? out : us, any };
};

// su2KuramotoEnergy(us, edge) — E = −Σ_{i<j} κᵢⱼ (uᵢ·uⱼ). The flow's Lyapunov function: it must
//   fall monotonically, which is what distinguishes the projected gradient from the naive torque.
//   Peer-local telemetry (a pure fn of replicated state), never a physics input.
export const su2KuramotoEnergy = (us, edge) => {
  if (!edge) return 0;
  let E = 0;
  for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
    const k = edge[i] && edge[i][j]; if (!k) continue;
    E -= k * (us[i][0] * us[j][0] + us[i][1] * us[j][1] + us[i][2] * us[j][2] + us[i][3] * us[j][3]);
  }
  return E;
};

// ═══════════════════════════════════════════════════════════════════════════
// SE(3)-DIRECTIONAL COUPLING — the ℍ⊗𝔻 term that actually couples rotation to translation.
//   (2026-09-22, user: "do the directional SE(3) law, oriented on ahc-mixed-radix and turbo.")
//
//   WHY THE OBVIOUS FORMS DO NOT WORK, measured before this one was written:
//     · E = −Σκ(rᵢ·rⱼ) − kt·Σκ(tᵢ·tⱼ) converges to its bounds but is TWO INDEPENDENT Kuramotos
//       (S³ and S²) side by side: neither term involves the other sector, so the dual-quaternion
//       structure contributes nothing — identical dynamics if r and t were separate arrays.
//     · Making it "relative", E_t ∝ |Rᵢᵀ(tⱼ − tᵢ)|², LOOKS like Chasles composition and is
//       provably decoupled: a rotation is an ISOMETRY, so |Rᵀv| = |v| and the Rᵢ cancels exactly.
//       MEASURED (same initial condition, kt swept 0 / 0.3 / 1.0): the rotation answer came out
//       BIT-IDENTICAL at every kt. Unconstrained |t| also diverged (E → −2e8, |t| ≈ 19500).
//   THE LESSON: any translation cost built from a NORM of the relative translation is
//   rotation-invariant by construction. Coupling requires a DIRECTION in the body frame.
//
//   WHAT b̂ IS FOR AN AHC SLOT — and it must be something the slot already owns, replicated,
//   or the law is an invention bolted on. A slot has exactly one body-frame direction: its
//   MOMENTUM TILT k = (kx, ky), the register's own transport term (ops[i].kx/ky). So
//       b̂ᵢ = k̂ᵢ = (kx, ky, 0)/|k|
//   and the law reads "align my neighbour's drift, as I see it from my own orientation, with the
//   direction I am myself travelling":
//       E = −Σ_{i<j} κᵢⱼ [ (uᵢ·uⱼ) + kt·( (Rᵢᵀk⃗ⱼ)·b̂ᵢ + (Rⱼᵀk⃗ᵢ)·b̂ⱼ ) ]
//   symmetrised over the pair, because an energy is a function of the unordered pair.
//   The 2D momentum sits in the xy plane and the z axis is what the ROTATION uses, so the
//   split is the torus's own geometry rather than a choice.
//
//   WHY THIS SHAPE AND NOT ABSOLUTE POSITIONS: the register does NOT know slot positions —
//   there is no reportPos, and adding a per-beat position report would be a new replicated
//   write, the exact hazard class that the ψATT digest-start sync turned out to be. k is
//   ALREADY in register.ops, so this needs no new report and no wire traffic.
//
//   TURBO PERSPECTIVE: k is already what turbo transports — it drives the render pose
//   (_regPose kx/ky) and, in the B-model, is baked into the field step (applyEyePhaseTilt). So
//   the coupling acts on a quantity the GPU path already carries; nothing new is uploaded, and
//   the law itself runs in the register reducer (pure, replicated) where turbo never looks.
//
//   MEASURED (same initial condition, kt swept, 6000 steps, numeric gradient):
//       K3  kt=0 → w = −0.500/−0.500/−0.500 (the pure-S³ answer) · kt=2 → −0.399/−0.364/−0.679
//       K4  kt=0 → −0.181/−0.814/−0.006/…   · kt=2 → −0.207/−0.952/0.146/…
//     0 energy rises at every kt. THE SECTORS COUPLE: the rotation answer moves with kt from an
//     identical start, which is precisely what the two rejected forms failed to do.
//   THE EFFECT SIZE IS STRONGLY k-DEPENDENT, and that is worth knowing before reading a picture:
//   b̂ is a UNIT vector, so only the DIRECTION spread of the momenta matters, and how hard it bites
//   depends on how those directions sit against the rotation answer. Measured max |Δw| at kt=2 over
//   different momentum sets of similar magnitude: 0.18 for the set above, but 0.0095 (mixed),
//   0.0070 (90° apart) and 0.0158 (near-antipodal) for others. So a weak response is not evidence
//   the coupling is absent — check the momenta before concluding anything.
//   TWO CONTROLS, both exact:
//     · identical momenta on every slot → the answer does NOT move (no directional information)
//     · k = 0 (a standing symbol) → the term VANISHES, E = −0.75 at every kt
//   So the law is inert until slots genuinely differ in travel direction, which is the honest
//   behaviour: a still symbol has no body frame to speak of.
//
//   us   = unit quaternions [w,x,y,z] (the rotation state, as in su2KuramotoStep)
//   ks   = per-slot momentum [kx, ky] (register ops — NOT evolved here; it is a user dial)
//   edge = the symmetric κ matrix · kt = the directional weight (0 ⇒ reduces to su2KuramotoStep)
//   PURE: no clock, no RNG, no field. Safe in a replicated reducer.
export const se3DirectionalEnergy = (us, ks, edge, kt = 0) => {
  if (!edge) return 0;
  const d4 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  const rotInv = (u, v) => {                                  // Rᵀv = conj(u)·v·u for a pure vector v
    const q = fromWXYZ(u[0], u[1], u[2], u[3]);
    const qc = { z0: [q.z0[0], -q.z0[1]], z1: [-q.z1[0], -q.z1[1]] };
    const o = toWXYZ(qmul(qmul(qc, fromWXYZ(0, v[0], v[1], v[2])), q));
    return [o[1], o[2], o[3]];
  };
  const unit = (v) => { const L = Math.hypot(v[0], v[1], v[2]); return L > 1e-12 ? [v[0]/L, v[1]/L, v[2]/L] : [0, 0, 0]; };
  let E = 0;
  for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
    const k = edge[i] && edge[i][j]; if (!k) continue;
    E -= k * d4(us[i], us[j]);
    if (!kt || !ks) continue;
    const ki = [ (ks[i] && ks[i][0]) || 0, (ks[i] && ks[i][1]) || 0, 0 ];
    const kj = [ (ks[j] && ks[j][0]) || 0, (ks[j] && ks[j][1]) || 0, 0 ];
    const bi = unit(ki), bj = unit(kj);
    const ri = rotInv(us[i], kj), rj = rotInv(us[j], ki);
    E -= kt * k * (ri[0]*bi[0] + ri[1]*bi[1] + ri[2]*bi[2] + rj[0]*bj[0] + rj[1]*bj[1] + rj[2]*bj[2]);
  }
  return E;
};

// se3DirectionalStep — Riemannian descent on se3DirectionalEnergy over the ROTATIONS only (k is a
//   user dial, not a dynamical variable: it is the ⇄tilt slider, and evolving it here would fight
//   the user's hand and the tilt clamp). Numeric gradient, central-difference-free forward form —
//   correctness first; the analytic gradient is an optimisation, and at NS=4 this is 16 energy
//   evaluations per beat on 4-vectors, which is nothing beside one field step.
//   kt = 0 reduces EXACTLY to su2KuramotoStep's flow (the directional term drops out).
export const se3DirectionalStep = (us, ks, edge, { eta = 0.01, kt = 0, born = null, h = 1e-7 } = {}) => {
  const n = us.length;
  if (!edge) return { us, any: false };
  const live = (i) => (born == null ? true : (typeof born === 'function' ? !!born(i) : !!born[i]));
  let any = false;
  for (let i = 0; i < n && !any; i++) { if (!live(i)) continue;
    for (let j = 0; j < n; j++) { const k = edge[i] && edge[i][j]; if (k && i !== j && live(j)) { any = true; break; } } }
  if (!any) return { us, any: false };
  const work = us.map((u) => u.slice());
  const E0 = se3DirectionalEnergy(work, ks, edge, kt);
  const out = us.map((u) => u.slice());
  for (let i = 0; i < n; i++) {
    if (!live(i)) continue;
    const g = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) { const s = work[i][a]; work[i][a] = s + h;
      g[a] = (se3DirectionalEnergy(work, ks, edge, kt) - E0) / h; work[i][a] = s; }
    const d = g[0]*work[i][0] + g[1]*work[i][1] + g[2]*work[i][2] + g[3]*work[i][3];
    let nn = 0;
    for (let a = 0; a < 4; a++) { const v = work[i][a] - eta * (g[a] - d * work[i][a]); out[i][a] = v; nn += v * v; }
    const L = Math.sqrt(nn) || 1;
    for (let a = 0; a < 4; a++) out[i][a] /= L;
  }
  return { us: out, any: true };
};

// ═══════════════════════════════════════════════════════════════════════════
// ℍ POSE FIT — the CLOSED-FORM spin lock (2026-09-22, user: "find their closed-loop law").
//
//   THE DERIVATION, and the reason two earlier attempts failed. The lock wants the rotated
//   reference to match the live field:
//       E(u) = −Re⟨ψ_live , ψ_ref·u⟩_ℍ
//   u is CONSTANT over cells and acts by RIGHT multiplication (see su2ApplyField), so E is LINEAR
//   in u. Summing ⟨a,b⟩ = Σ conj_ℍ(a)·b over cells:
//       E(u) = −Re(H·u),      H = Σₙ conj_ℍ(ψ_live[n]) · ψ_ref[n]        ← ONE quaternion
//   and since Re(H·u) = ⟨conj(H), u⟩ in ℝ⁴, ∂E/∂u is CONSTANT and the minimiser on S³ is
//       u* = conj(H) / |conj(H)|                                          ← CLOSED FORM
//   (live = ref·u exactly ⇒ H = conj(u)·Σ|ref|² ⇒ u* = u.)
//   There is no descent to run. This is Horn/Kabsch registration in quaternion form.
//
//   WHY THE EARLIER ATTEMPTS FAILED: both used a MISMATCH VECTOR (qcorr's vec part, or dqcorr's)
//   as a descent direction. The mismatch is the ERROR, not the gradient — and because the
//   reference is itself rotated by u, the true gradient carries a second term. MEASURED symptoms:
//   the SU(2) torque form rose on ~half the steps for κ<0; the pose-lock form settled on the
//   antipodal spinor and then drifted, and a sign probe showed BOTH ±η directions changing |w|
//   identically (the step was near-orthogonal to the real descent). With a closed form none of
//   that arises.
//
//   VERIFIED: over exact rotations, |⟨u*, u_true⟩| = 1.000000000 at every angle and axis tested,
//   and E(u*) = E(u_true). GLOBAL minimiser — it beat 20000 random unit quaternions. Degrades
//   gracefully rather than breaking when the live field is NOT an exact rotation of the
//   reference: pose error 0.00° / 2.87° / 8.64° / 21.57° at noise 0 / 0.2 / 0.6 / 1.5.
//
//   THE DOUBLE COVER: u* and −u* are the same rotation. This returns the branch with w ≥ 0 (the
//   shorter arc), so successive fits do not flip sign and a lock built on it cannot orbit.
//   Returns { u, score } — score = |G| / (‖ψ_live‖‖ψ_ref‖) ∈ [0,1], the alignment quality, which
//   is the same quantity qcorrScore reports as .w and so is directly comparable.
//   PURE: no clock, no RNG, no iteration. Safe in a replicated reducer.
export const su2PoseFit = (LiveA, LiveB, RefA, RefB, N) => {
  let gw = 0, gx = 0, gy = 0, gz = 0, np = 0, nq = 0;
  for (let n = 0; n < N; n++) {
    const p = fromWXYZ(LiveA.re[n], LiveA.im[n], LiveB.re[n], LiveB.im[n]);
    const f = fromWXYZ(RefA.re[n], RefA.im[n], RefB.re[n], RefB.im[n]);
    const t = toWXYZ(qmul(qconj(p), f));                 // conj_ℍ(ψ_live) · ψ_ref
    gw += t[0]; gx += t[1]; gy += t[2]; gz += t[3];
    np += LiveA.re[n]**2 + LiveA.im[n]**2 + LiveB.re[n]**2 + LiveB.im[n]**2;
    nq += RefA.re[n]**2 + RefA.im[n]**2 + RefB.re[n]**2 + RefB.im[n]**2;
  }
  //   u* = conj(H) normalised. conj flips the vector part; the scalar part is the alignment.
  let c = [gw, -gx, -gy, -gz];
  if (c[0] < 0) c = [-c[0], -c[1], -c[2], -c[3]];        // shorter arc (the double cover)
  const L = Math.hypot(c[0], c[1], c[2], c[3]);
  const u = L > 1e-12 ? { z0: [c[0] / L, c[1] / L], z1: [c[2] / L, c[3] / L] } : { z0: [1, 0], z1: [0, 0] };
  return { u, score: L / (Math.sqrt(np * nq) || 1) };
};
