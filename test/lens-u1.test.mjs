// lens-u1.test.mjs — the observer-lens algebra (u-register arc steps 3+5+; doc/proper-time-metric.md §12).
// Run: node test/lens-u1.test.mjs. Pure laws only — the medium is tested against these LIVE by chainRead
// (measured ε vs the abelian defect ≡ 0); here we prove the algebra itself keeps its contract, including
// the metric/gauge SEMIDIRECT-PRODUCT sector (affine maps compose non-abelian; tilts pull back; the
// translation phase-correction term is exact).
import { lensU1 as L } from '../public/soliton-algebra.js';

let ok = true; const chk = (n, c) => { if (!c) { ok = false; console.log(`FAIL ${n}`); } else console.log(`  ok  ${n}`); };
const near = (a, b, t = 1e-12) => Math.abs(a - b) < t;
const op = (phase, beta = 1, omega = 0, prec = 0, ext = {}) => ({ mode: 'id', phase, beta, omega, prec, ...ext });

// ── identity + angle uniformity ─────────────────────────────────────────────────────────────────────────────
{
  const d = L.id();
  chk('id() is the neutral descriptor (extended element, all-identity)', d.mode === 'id' && d.phase === 0 && d.beta === 1 && d.omega === 0 && d.prec === 0
    && d.kx === 0 && d.ky === 0 && d.tx === 0 && d.ty === 0 && JSON.stringify(d.A) === '[1,0,0,1]');
}
chk('angle = phase + prec (the uniform total reference)', near(L.angle(op(0.3, 1, 0, 0.2)), 0.5));
chk('evalAt = angle + ω·dτ (prediction forward on the op\'s own clock)', near(L.evalAt(op(0.3, 1, 0.1, 0.2), 7), 0.5 + 0.7));

// ── compose: the abelian sector (id/phase) ──────────────────────────────────────────────────────────────────
{
  const a = op(0.4, 2, 0.1, 0.05), b = op(-0.1, 0.5, 0.2, 0.15), c = op(1.1, 3, -0.3, 0);
  const ab = L.compose(a, b);
  chk('compose: phases add, β multiplies, ω adds, prec adds', near(ab.phase, 0.3) && near(ab.beta, 1) && near(ab.omega, 0.30000000000000004) && near(ab.prec, 0.2) && ab.mode === 'id');
  const abc1 = L.compose(L.compose(a, b), c), abc2 = L.compose(a, L.compose(b, c));
  chk('compose is associative (abelian)', near(abc1.phase, abc2.phase) && near(abc1.beta, abc2.beta) && near(abc1.omega, abc2.omega) && near(abc1.prec, abc2.prec));
  const aid = L.compose(a, L.id());
  chk('id is neutral under compose', near(aid.phase, a.phase) && near(aid.beta, a.beta) && near(aid.omega, a.omega) && near(aid.prec, a.prec));
  chk('compose REFUSES unknown modes (null, not a fake)', L.compose(a, { ...b, mode: 'warp' }) === null && L.compose(null, b) === null);
}

// ── compose: the metric/gauge semidirect product ────────────────────────────────────────────────────────────
{
  const R90 = [0, -1, 1, 0], SH = [1, 0.5, 0, 1];                     // rotation, shear — non-commuting
  const a = op(0.2, 1, 0, 0, { A: R90, tx: 1, ty: -2 }), b = op(-0.3, 1, 0, 0, { A: SH, tx: 0.5, ty: 0 });
  const ab = L.compose(a, b), ba = L.compose(b, a);
  chk('metric: A composes as A_b·A_a (matrix product)', JSON.stringify(ab.A) === JSON.stringify([0.5, -1, 1, 0]) && ab.mode === 'metric');
  chk('metric: NON-abelian (compose(a,b) ≠ compose(b,a))', JSON.stringify(ab.A) !== JSON.stringify(ba.A));
  const abc1 = L.compose(L.compose(a, b), op(0, 1, 0, 0, { kx: 0.3, ky: -0.1, tx: 2, ty: 1 }));
  const abc2 = L.compose(a, L.compose(b, op(0, 1, 0, 0, { kx: 0.3, ky: -0.1, tx: 2, ty: 1 })));
  chk('semidirect product is associative (metric+tilt mix)', ['phase','kx','ky','tx','ty'].every((f) => near(abc1[f], abc2[f], 1e-12)) && abc1.A.every((v, i) => near(v, abc2.A[i])));
  chk('mode inference: phase∘metric → gauge', L.compose(op(0, 1, 0, 0, { kx: 0.2 }), a).mode === 'gauge');
  const inv = L.invert(op(0.7, 2, 0.1, 0.3, { A: R90, tx: 1.5, ty: -0.5, kx: 0.2, ky: -0.4 }));
  const round = L.compose(op(0.7, 2, 0.1, 0.3, { A: R90, tx: 1.5, ty: -0.5, kx: 0.2, ky: -0.4 }), inv);
  chk('invert: compose(a, invert(a)) = id (all components)', round.mode === 'id' && near(round.phase, 0, 1e-12) && near(round.kx, 0) && near(round.ky, 0)
    && near(round.tx, 0) && near(round.ty, 0) && round.A.every((v, i) => near(v, [1, 0, 0, 1][i])) && near(round.beta, 1) && near(round.omega, 0) && near(round.prec, 0));
}

// ── link: gauge invariance + antisymmetry ───────────────────────────────────────────────────────────────────
{
  const a = op(0.7, 1, 0, 0.1), b = op(-0.4, 1, 0, 0.3);
  chk('link is antisymmetric', near(L.link(a, b), -L.link(b, a)));
  const g = 1.234;                                                     // a global gauge shift on BOTH ops
  chk('link is gauge-invariant (differences only — Law 5)', near(L.link(op(0.7 + g, 1, 0, 0.1), op(-0.4 + g, 1, 0, 0.3)), L.link(a, b)));
  chk('link wraps to (−π, π]', Math.abs(L.link(op(-3), op(3))) <= Math.PI);
}

// ── chain: the abelian law — defect ≡ 0 for ANY id-sector ops (the meter's model contract) ──────────────────
{
  let rnd = 12345; const r = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return (rnd / 0x7fffffff) * 8 - 4; };
  let worst = 0;
  for (let t = 0; t < 200; t++) { const ops = [op(r(), 1, 0, r()), op(r(), 1, 0, r()), op(r(), 1, 0, r()), op(r(), 1, 0, r())];
    worst = Math.max(worst, Math.abs(L.chain(ops).defect)); }
  chk(`chain defect ≡ 0 for 200 random 4-chains (worst ${worst.toExponential(1)})`, worst < 1e-9);
  chk('chain of <2 ops refuses', L.chain([L.id()]) === null && L.chain(null) === null);
}

// ── apply: honest read — pure rotation, energy-preserving, β ignored, functorial over compose ───────────────
{
  const psi = new Float64Array([1, 0, 0.5, -0.25, -0.3, 0.8]);
  const e = (f) => { let s = 0; for (const x of f) s += x * x; return s; };
  const a = op(0.9, 3, 0, 0.2), b = op(-1.3, 0.5, 0, 0);
  const ra = L.apply(a, psi);
  chk('apply preserves energy (β is dynamics, NOT applied — an honest read)', near(e(ra), e(psi)));
  chk('apply(id) is the identity', L.apply(L.id(), psi).every((x, i) => near(x, psi[i])));
  const seq = L.apply(b, L.apply(a, psi)), one = L.apply(L.compose(a, b), psi);
  chk('apply is functorial: apply(b)∘apply(a) = apply(a∘b)', seq.every((x, i) => near(x, one[i], 1e-9)));
  chk('apply returns a NEW array (pure — input untouched)', ra !== psi && psi[0] === 1);
}

// ── apply, metric sector: exact functoriality on grid-exact maps (integer translation + 90° rotation about
//    the (G−1)/2 center map the lattice onto itself → bilinear is exact; content kept in the interior so the
//    zero-fill boundary never differs between one composed resample and two chained ones) ───────────────────
{
  const G = 8, psi = new Float64Array(G * G * 2);
  const put = (x, y, re, im) => { psi[(y * G + x) * 2] = re; psi[(y * G + x) * 2 + 1] = im; };
  put(3, 3, 1, 0.5); put(4, 3, -0.3, 0.2); put(3, 4, 0.7, -0.1); put(4, 4, 0.2, 0.9);   // central 2×2 support
  const a = op(0.15, 1, 0, 0, { tx: 1, ty: -1 });                     // integer translation
  const b = op(-0.4, 1, 0, 0, { A: [0, -1, 1, 0] });                  // 90° rotation (half-integer center → lattice-exact)
  const seq = L.apply(b, L.apply(a, psi, G), G), one = L.apply(L.compose(a, b), psi, G);
  let worst = 0; for (let i = 0; i < seq.length; i++) worst = Math.max(worst, Math.abs(seq[i] - one[i]));
  chk(`metric functoriality EXACT on lattice-exact maps (worst ${worst.toExponential(1)})`, worst < 1e-12);
  const e = (f) => { let s = 0; for (const x of f) s += x * x; return s; };
  chk('metric apply preserves energy for lattice-exact maps (unitary sector)', near(e(L.apply(b, psi, G)), e(psi)));
}

// ── apply, tilt pullback: the translation phase-correction term measured on a plane wave ────────────────────
{
  const G = 8, c0 = (G - 1) / 2, psi = new Float64Array(G * G * 2);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const th = 0.31 * (x - c0) - 0.17 * (y - c0);
    psi[(y * G + x) * 2] = Math.cos(th); psi[(y * G + x) * 2 + 1] = Math.sin(th); }
  const a = op(0.2, 1, 0, 0, { kx: 0.5, ky: -0.3 });                  // a tilt lens
  const b = op(-0.6, 1, 0, 0, { tx: 2, ty: 1 });                      // then a translation
  const seq = L.apply(b, L.apply(a, psi, G), G), one = L.apply(L.compose(a, b), psi, G);
  let worst = 0; for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {   // compare only cells the translation kept in-grid
    if (x - 2 < 0 || y - 1 < 0) continue; const j = (y * G + x) * 2;
    worst = Math.max(worst, Math.abs(seq[j] - one[j]), Math.abs(seq[j + 1] - one[j + 1])); }
  chk(`tilt pullback + phase correction EXACT under translation (worst ${worst.toExponential(1)})`, worst < 1e-12);
}

// ── the ℂ* generalization: gain as a first-class component (U(1) = the gain≡1 slice) ────────────────────────
{
  chk('id has gain 1 (the U(1) sublimit is the default)', L.id().gain === 1 && (L.idC(2.5).gain === 2.5));
  chk('BACKWARD COMPAT: a gain-less element behaves exactly as before (gain treated as 1)', near(L.apply({ mode: 'id', phase: 0.5 }, new Float64Array([1, 0]))[0], Math.cos(0.5)));
  const a = L.idC(2), b = L.idC(3); a.phase = 0.4; b.phase = -0.1;
  const ab = L.compose(a, b);
  chk('compose: gains MULTIPLY, phases ADD (ℂ* group law)', near(ab.gain, 6) && near(ab.phase, 0.3));
  chk('invert: gain inverts (1/r), compose(a,invert(a)) → gain 1', near(L.invert(a).gain, 0.5) && near(L.compose(a, L.invert(a)).gain, 1) && near(L.compose(a, L.invert(a)).phase, 0));
  // functoriality WITH gain: apply(b)∘apply(a) = apply(a∘b), gains and phases both
  const psi = new Float64Array([1, 0, 0.5, -0.3]);
  const seq = L.apply(b, L.apply(a, psi)), one = L.apply(L.compose(a, b), psi);
  chk('apply is functorial over ℂ* (gain scales, composes)', seq.every((x, i) => near(x, one[i], 1e-9)));
  const e = (f) => { let s = 0; for (const x of f) s += x * x; return s; };
  chk('apply(gain 2) quadruples energy (NON-unitary — the whole point)', near(e(L.apply(L.idC(2), psi)), 4 * e(psi)));
  chk('logGain = ln r (the additive coordinate — composes like phase)', near(L.logGain(L.idC(Math.E)), 1) && near(L.logGain(L.compose(L.idC(2), L.idC(3))), Math.log(6)));
  chk('capGain bounds r (the medium energy law as an algebra law)', L.capGain(L.idC(5), 3).gain === 3 && L.capGain(L.idC(2), 3).gain === 2);
  // the RUNAWAY vs STABLE distinction, in the algebra: repeated self-compose with r>1 diverges; with cap it doesn't
  let g = L.idC(1.3), gc = L.idC(1.3); for (let i = 0; i < 40; i++) { g = L.compose(g, L.idC(1.3)); gc = L.capGain(L.compose(gc, L.idC(1.3)), 8); }
  chk('ℂ* is NON-compact: uncapped self-compose DIVERGES (r → huge), capped stays bounded — the third regime\'s root', g.gain > 1e4 && gc.gain === 8);
}

// ── pin / unpin: the submanifold projections (lensU1 ⊂ lensC1) ───────────────────────────────────────────────
{
  const c = L.idC(3.5); c.phase = 0.4;
  chk('pin projects onto the U(1) slice (gain → 1, phase kept)', L.pin(c).gain === 1 && L.pin(c).phase === 0.4);
  const already = L.id();
  chk('pin is idempotent + a no-op on already-pinned (returns the SAME ref, no copy)', L.pin(L.pin(c)).gain === 1 && L.pin(already) === already);
  chk('unpin is identity on the element (governance is the caller\'s, not a field)', L.unpin(c) === c);
  // the round trip: unpin (free the gain) → let it grow → repin (project back) collapses the amplitude excursion
  let w = L.idC(1); for (let i = 0; i < 10; i++) w = L.compose(w, L.idC(1.5));   // an unpinned worldline running its gain up
  chk('a grown (unpinned) worldline has large gain; repin collapses it to the unitary slice', w.gain > 50 && L.pin(w).gain === 1);
}

console.log(ok ? '\nALL PASS (lensU1/lensC1 algebra)' : '\nFAILURES ABOVE');
process.exit(ok ? 0 : 1);
