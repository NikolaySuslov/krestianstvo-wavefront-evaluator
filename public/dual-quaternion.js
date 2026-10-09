/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ═══════════════════════════════════════════════════════════════════════════
// dual-quaternion.js — a DUAL QUATERNION as a PAIR of quaternions (each a pair of ℂ-slots)
//
//   ℍ⊗𝔻 = ℍ ⊕ ℍ·ε ,   q̂ = q_r + q_d·ε ,   ε² = 0 , ε ≠ 0   (the DUAL unit is NILPOTENT, not −1).
//
// A dual quaternion is a pair of quaternions (q_r, q_d): the REAL part q_r carries a ROTATION (SO(3)/SU(2)),
// the DUAL part q_d carries a TRANSLATION. A UNIT dual quaternion (|q_r|=1, ⟨q_r,q_d⟩=0) is a RIGID-BODY MOTION
// in 3D — a SCREW (rotation about an axis + translation along it) — i.e. SE(3), the way a unit quaternion is SO(3).
//   translation t is encoded as   q_d = ½ · t · q_r   (t = pure quaternion (0, tx, ty, tz)).
//
// Built from the AHC slots: each quaternion is a PAIR of ℂ-slots (quaternion-pair.js), so a DUAL quaternion FIELD
// is FOUR ℂ-slots: (A,B) = q_r , (C,D) = q_d. The transform stays per-channel complex on all four; the dual
// structure lives ONLY in the coupling (dualQmul) + the register (the SE(3) screw). This module is PURE + headless.
//
//   THE PRODUCT (from ε² = 0):
//     (q_r + q_d ε)(r_r + r_d ε) = q_r·r_r  +  (q_r·r_d + q_d·r_r)·ε
//   — the ROTATION part is a plain quaternion product q_r·r_r; the TRANSLATION (dual) part is the CROSS term
//     q_r·r_d + q_d·r_r. The ε² term VANISHES → q_d never feeds back into the rotation (the nilpotent structure).
//   NOTE: unlike ℍ, ℍ⊗𝔻 is NOT a division algebra — ε is a ZERO DIVISOR (ε·ε=0), so pure-dual elements aren't
//   invertible. That's the trade for SE(3): rigid motion (rotation ⊕ translation) at the cost of the clean inverse.
//
// See doc/dual-quaternion-torus.md and doc/quaternion-slot-pair.md.
// ═══════════════════════════════════════════════════════════════════════════

import { qmul, qadd, qconj, qnorm2, qscale, fromWXYZ, toWXYZ, su2, qcorr } from "./quaternion-pair.js";

// ── a dual quaternion = { r, d } : two quaternions (each a {z0,z1} pair-basis quaternion) ────────────────────
export const dq = (r, d) => ({ r, d });
export const dqZero = () => ({ r: fromWXYZ(0, 0, 0, 0), d: fromWXYZ(0, 0, 0, 0) });
export const dqReal = (r) => ({ r, d: fromWXYZ(0, 0, 0, 0) });                 // a pure rotation (no translation)

// ── THE dual-quaternion product (ε² = 0): rotation part = q_r·r_r ; dual part = q_r·r_d + q_d·r_r ─────────────
export const dqmul = (Q, R) => ({
  r: qmul(Q.r, R.r),                              // rotation: the plain quaternion product (decoupled from the dual part)
  d: qadd(qmul(Q.r, R.d), qmul(Q.d, R.r)),        // translation: the CROSS term (q_r·r_d + q_d·r_r), the nilpotent coupling
});

export const dqadd = (Q, R) => ({ r: qadd(Q.r, R.r), d: qadd(Q.d, R.d) });
export const dqscale = (Q, s) => ({ r: qscale(Q.r, s), d: qscale(Q.d, s) });

// ── the THREE conjugates of a dual quaternion (each answers a different question) ────────────────────────────
//   • quaternion conj  : (q̄_r + q̄_d ε)        — conjugate each quaternion part (for the norm / rotation inverse)
//   • dual conj        : (q_r − q_d ε)         — flip the dual unit (ε → −ε)
//   • combined (SE(3)) : (q̄_r − q̄_d ε)        — the one that inverts a UNIT dual quaternion (rigid-motion inverse)
export const dqconjQ = (Q) => ({ r: qconj(Q.r), d: qconj(Q.d) });
export const dqconjD = (Q) => ({ r: Q.r, d: qscale(Q.d, -1) });
export const dqconj  = (Q) => ({ r: qconj(Q.r), d: qscale(qconj(Q.d), -1) });   // the rigid-motion inverse conjugate

// ── norm: |q̂|² = q̂·q̂*_Q = |q_r|² + 2⟨q_r,q_d⟩·ε  (a DUAL number). A UNIT dual quaternion has |q_r|²=1 AND
//    ⟨q_r,q_d⟩=0 (the two rigid-motion constraints). Returns [ |q_r|² , 2⟨q_r,q_d⟩ ] = [real, dual] parts. ──
export const dqnorm2 = (Q) => {
  const nr = qnorm2(Q.r);
  // ⟨q_r, q_d⟩ = the real part of q_r·q̄_d  = w·w' + x·x' + y·y' + z·z'  (the 4-vector dot of the two quaternions)
  const [w, x, y, z] = toWXYZ(Q.r), [w2, x2, y2, z2] = toWXYZ(Q.d);
  const dot = w * w2 + x * x2 + y * y2 + z * z2;
  return [nr, 2 * dot];   // [real, dual]  (unit ⇒ [1, 0])
};

// ── build a UNIT dual quaternion (a rigid-body motion) from a rotation u ∈ SU(2) and a translation t=(tx,ty,tz):
//    q_r = u ,  q_d = ½ · t · u   with t the PURE quaternion (0, tx, ty, tz). Screw motion = rotation ⊕ translation. ──
export const dqFromRotTrans = (u, tx, ty, tz) => {
  const t = fromWXYZ(0, tx, ty, tz);             // the translation as a pure quaternion
  const qd = qscale(qmul(t, u), 0.5);            // q_d = ½ t u
  return { r: u, d: qd };
};

// recover the translation from a unit dual quaternion:  t = 2 · q_d · q̄_r   (a pure quaternion → (tx,ty,tz)) ──
export const dqTranslation = (Q) => {
  const t = qscale(qmul(Q.d, qconj(Q.r)), 2);    // 2 q_d q̄_r
  const [, tx, ty, tz] = toWXYZ(t);              // the vector part (the scalar part is ~0 for a unit dq)
  return [tx, ty, tz];
};

// SE(3) SCREW from an axis n̂, an angle θ (rotation), and a pitch h·θ translation ALONG the axis (Chasles):
//   u = exp(½θ n̂·𝐢) ; translation d = (h·θ)·n̂. h=0 → pure rotation ; θ=0 → pure translation. ──
export const dqScrew = (nx, ny, nz, theta, pitch = 0) => {
  const L = Math.hypot(nx, ny, nz) || 1, ux = nx / L, uy = ny / L, uz = nz / L;
  const u = su2(ux, uy, uz, theta);              // the rotation part
  const d = pitch * theta;                       // translation distance along the screw axis
  return dqFromRotTrans(u, d * ux, d * uy, d * uz);
};

// ═══════════════════════════════════════════════════════════════════════════
// FIELD version — a dual-quaternion FIELD = FOUR complex fields {re,im}[N]:
//   rA = q_r.z0 , rB = q_r.z1  (the ROTATION quaternion pair) ; dA = q_d.z0 , dB = q_d.z1 (the DUAL/translation pair).
//   dualQmulField(Q, R) applies the §product per cell. Reuses the ℂ complex mul, exactly like qmulField.
// ═══════════════════════════════════════════════════════════════════════════

// helpers to (de)interleave a field-quaternion {rA,rB} ↔ per-cell {z0:[re,im], z1:[re,im]}
const _cellQ = (F, n) => ({ z0: [F.rA.re[n], F.rA.im[n]], z1: [F.rB.re[n], F.rB.im[n]] });
const _cellD = (F, n) => ({ z0: [F.dA.re[n], F.dA.im[n]], z1: [F.dB.re[n], F.dB.im[n]] });
const _putR = (out, n, Q) => { out.rA.re[n] = Q.z0[0]; out.rA.im[n] = Q.z0[1]; out.rB.re[n] = Q.z1[0]; out.rB.im[n] = Q.z1[1]; };
const _putD = (out, n, Q) => { out.dA.re[n] = Q.z0[0]; out.dA.im[n] = Q.z0[1]; out.dB.re[n] = Q.z1[0]; out.dB.im[n] = Q.z1[1]; };
const _mkField = (N) => ({ rA: { re: new Float64Array(N), im: new Float64Array(N) }, rB: { re: new Float64Array(N), im: new Float64Array(N) },
                           dA: { re: new Float64Array(N), im: new Float64Array(N) }, dB: { re: new Float64Array(N), im: new Float64Array(N) } });

// the per-cell dual-quaternion product Q·R over a FOUR-slot field (Q = {rA,rB,dA,dB}, likewise R). The qedge²-coupling.
export const dualQmulField = (Q, R, N) => {
  const out = _mkField(N);
  for (let n = 0; n < N; n++) {
    const qr = _cellQ(Q, n), qd = _cellD(Q, n), rr = _cellQ(R, n), rd = _cellD(R, n);
    const P = dqmul({ r: qr, d: qd }, { r: rr, d: rd });   // per-cell dual product
    _putR(out, n, P.r); _putD(out, n, P.d);
  }
  return out;
};

// apply a CONSTANT unit dual quaternion (the SE(3) register) to a dual-quaternion field by RIGHT multiply ψ̂·Û per cell:
//     P.r = ψ_r·u_r ,    P.d = ψ_r·u_d + ψ_d·u_r
//   RIGHT, for the same reason as su2ApplyField (quaternion-pair.js): the medium's complex structure acts from the
//   left, so only a right action is ℂ-linear and commutes with the propagator and the ∠ aging (2026-09-23; was LEFT).
//   WHAT IT MOVES — stated honestly: each cell's value ψ̂(x) is a (scaled) rigid-body POSE in an INTERNAL 3-space,
//   and b(x) = 2·ψ_r⁻¹·ψ_d is that pose's position seen from its own frame. Under ψ̂ ← ψ̂·Û every cell's b moves by
//   the SAME rigid motion (b ↦ R(u_r)⁻¹·b + t_Û): the register is a body-frame SE(3) motion of that internal cloud.
//   It does NOT move anything on the torus — spatial transport on 𝕋² is the k-glide, a different thing.
//   Invariants per cell: |ψ_r|² and ⟨ψ_r,ψ_d⟩ (the dual-number norm), so a nonlinearity/cap built on |ψ_r|² is
//   SE(3)-covariant; one built on the dual channels' own energy is not (the translation changes |ψ_d|).
export const dqApplyField = (U, F, N) => {
  const out = _mkField(N);
  for (let n = 0; n < N; n++) {
    const psi = { r: _cellQ(F, n), d: _cellD(F, n) };
    const P = dqmul(psi, U);            // ψ̂·Û  (Û the SAME for every cell = a global rigid-motion lens)
    _putR(out, n, P.r); _putD(out, n, P.d);
  }
  return out;
};

// SE(3) precession by one beat: U ← U·screw(Δθ, Δpitch) — accumulated on the RIGHT, matching the action above. The
//   aging clock traces a SCREW (rotation + glide) through SE(3), the dual-quaternion generalization of su2Precess.
export const dqPrecess = (U, nx, ny, nz, dTheta, dPitch = 0) => dqmul(U, dqScrew(nx, ny, nz, dTheta, dPitch));

// ═══════════════════════════════════════════════════════════════════════════
// SE(3) SCREW-LOCK — the dual-quaternion generalization of the SU(2) spin-lock (quaternion-pair.js su2Lock).
//   spin-lock: ψ_ℍ ← ψ_ℍ + β·(u·ref − ψ_ℍ) — pull the pair toward a target SPINOR ORIENTATION (a basin on S³).
//   screw-lock: ψ̂ ← ψ̂ + β·(ref̂·U − ψ̂) — pull the four-field POSE toward a target RIGID MOTION ref̂·U (a capture
//     basin in SE(3): orientation AND position). β = the lock stiffness. U=(u_r,u_d) the target screw; ref̂ = the
//     held reference dual-quaternion field (the pose analog of att; e.g. |ψ| per channel, or a recalled moment).
//   pitch=0 (u_d=0) ⇒ U reduces to a pure rotation ⇒ the screw-lock reduces to su2Lock on the rotation pair (the
//   dual channels relax toward u_r·ref_d) — the SU(2) slice. Field = {rA,rB,dA,dB}; returns the pulled field.
export const dqLock = (U, F, ref, beta, N) => {
  const T = dqApplyField(U, ref, N);   // target = ref̂·U  (the reference pose moved by the target motion)
  const out = _mkField(N);
  const pull = (o, f, t) => { for (let n = 0; n < N; n++) { o.re[n] = f.re[n] + beta * (t.re[n] - f.re[n]); o.im[n] = f.im[n] + beta * (t.im[n] - f.im[n]); } };
  pull(out.rA, F.rA, T.rA); pull(out.rB, F.rB, T.rB); pull(out.dA, F.dA, T.dA); pull(out.dB, F.dB, T.dB);   // ψ̂ ← ψ̂ + β·(ref̂·U − ψ̂)
  return out;
};

// ═══════════════════════════════════════════════════════════════════════════
// DUAL-QUATERNION CONTENT-ADDRESS — dqcorr: the ℍ⊗𝔻 generalization of qcorr (recall by RIGID POSE, not just spin).
//   The dual-quaternion inner product ⟨ψ̂, φ̂⟩ = Σ conj_ℍ(ψ̂)·φ̂ is itself a DUAL QUATERNION (r + d·ε):
//     • REAL quaternion r  = the qcorr of the ROTATION pairs (ψ_r vs φ_r) = today's spin+amplitude overlap. Its
//       scalar part = the amplitude overlap of the rotation channel (the conservative slice).
//     • DUAL quaternion d  = the CROSS overlap qcorr(ψ_r,φ_d) + qcorr(ψ_d,φ_r) = the RELATIVE TRANSLATION between
//       cue and plate — nonzero only when the two moments sit at a different position/pose. ‖d.vec‖ = pose mismatch.
//   Because ℍ⊗𝔻 is NOT a division algebra (ε a zero divisor), there is no clean inverse; we use a PSEUDO-INVERSE
//   normalization (divide by the ROTATION-channel norms, the invertible real part) — the honest choice.
//   Returns { r:[w,x,y,z], d:[w,x,y,z] } — the overlap dual quaternion (two quaternions).
export const dqcorr = (Psi, Phi, N) => {
  const r = qcorr(Psi.rA, Psi.rB, Phi.rA, Phi.rB, N);                         // rotation overlap ⟨ψ_r, φ_r⟩
  const d1 = qcorr(Psi.rA, Psi.rB, Phi.dA, Phi.dB, N);                        // ⟨ψ_r, φ_d⟩
  const d2 = qcorr(Psi.dA, Psi.dB, Phi.rA, Phi.rB, N);                        // ⟨ψ_d, φ_r⟩
  const d = [d1[0] + d2[0], d1[1] + d2[1], d1[2] + d2[2], d1[3] + d2[3]];     // the DUAL cross term (translation overlap)
  return { r, d };
};

// NORMALIZED dual-quaternion content-address (the dqedge recall drop-in): returns {w, spin, trans, score, dq}.
//   w      = the ROTATION-channel amplitude overlap ∈ [−1,1]  — EXACTLY the qcorr scalar on the rotation pair (the
//            conservative slice: identical to today's recall when you take .w).
//   spin   = ‖r.vec‖ / norm ∈ [0,1]  — the SPIN mismatch (same as qcorr's vec, on the rotation channel).
//   trans  = ‖d.vec‖ / norm ∈ [0,∞)  — the TRANSLATION/pose mismatch (the NEW dual-quaternion axis).
//   score  = w − spinPenalty·spin − transPenalty·trans   — recall prefers the plate matching in amplitude AND spin
//            AND position. spinPenalty=transPenalty=0 ⇒ score=w ⇒ IDENTICAL to today's real-overlap recall.
export const dqcorrScore = (Psi, Phi, N, spinPenalty = 1, transPenalty = 1) => {
  const o = dqcorr(Psi, Phi, N);
  // pseudo-inverse normalization: use the ROTATION-channel norms (the invertible real part), per §non-division note.
  let np = 0, nq = 0;
  for (let n = 0; n < N; n++) {
    np += Psi.rA.re[n]**2 + Psi.rA.im[n]**2 + Psi.rB.re[n]**2 + Psi.rB.im[n]**2;
    nq += Phi.rA.re[n]**2 + Phi.rA.im[n]**2 + Phi.rB.re[n]**2 + Phi.rB.im[n]**2;
  }
  const norm = Math.sqrt(np * nq) || 1;
  const w = o.r[0] / norm, spin = Math.hypot(o.r[1], o.r[2], o.r[3]) / norm, trans = Math.hypot(o.d[1], o.d[2], o.d[3]) / norm;
  return { w, spin, trans, score: w - spinPenalty * spin - transPenalty * trans, dq: o };
};

// ═══════════════════════════════════════════════════════════════════════════
// SE(3) POSE LOCK — THE GRADIENT-DESCENT ATTEMPT, SUPERSEDED. Kept for the failure analysis;
// the working law is dqPoseFit at the end of this file (closed form, no descent).
//
//   THE DISTINCTION THAT MOTIVATED IT, and which is the useful part of this note:
//     · FOUR SLOTS = FOUR SPINORS coupled pairwise by κ — a LATTICE of rotors on S³. That is
//       su2KuramotoStep / se3DirectionalStep in quaternion-pair.js. It is a valid model but it is
//       NOT what this app declares.
//     · FOUR SLOTS = ONE OBJECT — what ahc actually declares: qpair = [0,1] is ONE quaternion
//       (two slots), dqpair = [0,1,2,3] is ONE dual quaternion (four slots). In ℍ⊗𝔻 mode the
//       register IS the rigid-body pose, so there is no second body to entrain with and Kuramoto
//       is the wrong question. The right one is "what does the FIELD say the pose should be?"
//
//   THE ERROR SIGNAL EXISTS AND IS GOOD. dqcorr(live, reference) gives both sectors separately,
//   MEASURED by rotating a 4-field through a known screw and reading the mismatch back:
//       θ=0.00 pitch=0    r.w=1.00000  |r.vec|=0.00000  |d.vec|=0.00000
//       θ=0.30 pitch=0    r.w=0.98877  |r.vec|=0.13764  |d.vec|=0.01884
//       θ=1.00 pitch=0    r.w=0.87758  |r.vec|=0.44158  |d.vec|=0.06045
//       θ=1.00 pitch=0.5  r.w=0.87758  |r.vec|=0.44158  |d.vec|=0.17869   ← pitch moves d only
//       θ=2.00 pitch=0.5  r.w=0.54030  |r.vec|=0.77504  |d.vec|=0.34228
//   r.w is cos(θ/2) exactly, |r.vec| is monotone in θ, and |d.vec| responds to pitch at fixed θ.
//   So a genuine SE(3) error signal is available from machinery the app already runs for recall.
//
//   WHY IT IS NOT SHIPPED: using that mismatch vector AS the descent direction is wrong, and it
//   is the SAME mistake the SU(2) law made with qcorr's vector part. The energy is
//       E(U) = −Re⟨ψ_live, U·ψ_ref⟩
//   whose gradient requires the error PROJECTED THROUGH the action of U on ψ_ref — the reference
//   depends on U, so there is a second term. dqcorr returns the ERROR, not that gradient.
//   MEASURED symptoms of shipping it anyway: the lock settled on the ANTIPODAL spinor (|w| → 1
//   with the wrong branch), then DRIFTED (|r.vec| 0.027 → 0.046, |d.vec| 0.030 → 0.198). Adding
//   the standard sign(w) shorter-arc fix made it worse — it settled at |w| ≈ 0.03, maximally
//   MISALIGNED — and a sign probe showed both ±η step directions changing |w| identically, i.e.
//   the step was near-orthogonal to the true descent direction.
//
//   TO FINISH IT: derive ∂E/∂U for E = −Re⟨ψ_live, U·ψ_ref⟩ on the unit-dual-quaternion manifold
//   (|r| = 1 and ⟨r,d⟩ = 0, both of which the projection code below handled correctly), rather
//   than reading a torque off dqcorr. The projection and the constraint handling were verified
//   sound in isolation: |U.r| = 1.000000000 and ⟨r,d⟩ = 3.3e-17 held across 400 steps.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ℍ⊗𝔻 POSE FIT — closed form, rotation AND translation (rewritten 2026-09-23 for the RIGHT action).
//
//   MODEL: live = ref·Û, i.e. live_r = ref_r·u_r and live_d = ref_r·u_d + ref_d·u_r (dqApplyField).
//   ROTATION — exactly as in the ℍ case, from the rotation pair alone:
//       H_r = Σ conj(live_r)·ref_r = conj(u_r)·Σ|ref_r|²   ⇒   u_r* = conj(H_r)/|H_r|
//   (the dual pair is NOT mixed in: live_d carries u_d, so folding it into H_r would bias the rotation.)
//   TRANSLATION — LEAST SQUARES, which is well-posed:
//       minimise Σ |live_d − ref_d·u_r* − ref_r·u_d|²  over u_d ∈ ℍ
//       normal equation: (Σ|ref_r|²)·u_d = Σ conj(ref_r)·(live_d − ref_d·u_r*)
//   then project onto the rigid-motion constraint ⟨u_r,u_d⟩ = 0.
//   WHY THE PREVIOUS VERSION CALLED TRANSLATION "ILL-POSED": it maximised the CORRELATION −Re⟨live, U·ref⟩,
//   which is LINEAR in u_d, so the optimum ran to infinity (measured E(U*) = −769 vs −122 at the truth) and
//   the magnitude had to be borrowed from the pitch slider. That was a property of the objective, not of
//   the physics: the residual is QUADRATIC in u_d and has one minimiser. The fitted translation is now a
//   measurement, recovered exactly when the model holds.
//   SCALE (a SIMILARITY fit, Umeyama): the live field and its reference need not carry the same amplitude — in
//   ahc the reference is the pin target att while the field is held at its energy e0 — and a rigid motion cannot
//   change amplitude. So the model is live = s·ref·Û with s = Re⟨live_r, ref_r·u_r*⟩/Σ|ref_r|², and the translation
//   is solved on live/s. Without s the fitted translation is inflated by |live|/|ref|, and a servo built on it has
//   its translation gain multiplied by that ratio — MEASURED in the app: the ℍ⊗𝔻 pose servo blew the dual channels
//   up to 1.6e6 within 5 s. (The rotation is scale-free: u_r* is a direction.)
//   Returns { U, score, dScore, scale } — score = rotation alignment |H_r|/(‖live_r‖‖ref_r‖) ∈ [0,1] (comparable with
//   dqcorrScore's .w); dScore = |u_d*| (how far the body is displaced, in dual-quaternion units = ½|t|); scale = s.
//   { rotationOnly: true } returns u_d = 0 (the rotation core). PURE: no clock, no RNG, no iteration.
export const dqPoseFit = (Live, Ref, N, { rotationOnly = false } = {}) => {
  let h = [0, 0, 0, 0], nl = 0, nr = 0;
  for (let n = 0; n < N; n++) {
    const pr = fromWXYZ(Live.rA.re[n], Live.rA.im[n], Live.rB.re[n], Live.rB.im[n]);
    const fr = fromWXYZ(Ref.rA.re[n], Ref.rA.im[n], Ref.rB.re[n], Ref.rB.im[n]);
    const t = toWXYZ(qmul(qconj(pr), fr));
    for (let a = 0; a < 4; a++) h[a] += t[a];
    nl += qnorm2(pr); nr += qnorm2(fr);
  }
  let c = [h[0], -h[1], -h[2], -h[3]];
  if (c[0] < 0) c = c.map((v) => -v);                    // shorter arc (double cover)
  const Lr = Math.hypot(c[0], c[1], c[2], c[3]);
  const r = Lr > 1e-12 ? c.map((v) => v / Lr) : [1, 0, 0, 0];
  const ur = fromWXYZ(r[0], r[1], r[2], r[3]);
  let d = [0, 0, 0, 0];
  const scale = nr > 1e-12 ? Lr / nr : 1;   // s = Re⟨live_r, ref_r·u_r*⟩/Σ|ref_r|² = |H_r|/Σ|ref_r|² (u_r* aligns H_r)
  if (!rotationOnly && nr > 1e-12 && scale > 1e-12) {
    const g = [0, 0, 0, 0];
    for (let n = 0; n < N; n++) {
      const fr = fromWXYZ(Ref.rA.re[n], Ref.rA.im[n], Ref.rB.re[n], Ref.rB.im[n]);
      const fd = fromWXYZ(Ref.dA.re[n], Ref.dA.im[n], Ref.dB.re[n], Ref.dB.im[n]);
      const pd = fromWXYZ(Live.dA.re[n], Live.dA.im[n], Live.dB.re[n], Live.dB.im[n]);
      const res = toWXYZ(qmul(qconj(fr), qadd(qscale(pd, 1 / scale), qscale(qmul(fd, ur), -1))));   // conj(ref_r)·(live_d/s − ref_d·u_r*)
      for (let a = 0; a < 4; a++) g[a] += res[a];
    }
    d = g.map((v) => v / nr);
    const pr2 = d[0]*r[0] + d[1]*r[1] + d[2]*r[2] + d[3]*r[3];
    d = d.map((v, a) => v - pr2 * r[a]);                  // ⟨u_r,u_d⟩ = 0
  }
  return {
    U: { r: { z0: [r[0], r[1]], z1: [r[2], r[3]] }, d: { z0: [d[0], d[1]], z1: [d[2], d[3]] } },
    score: Lr / (Math.sqrt(nl * nr) || 1),
    dScore: Math.hypot(d[0], d[1], d[2], d[3]),
    scale,
  };
};
