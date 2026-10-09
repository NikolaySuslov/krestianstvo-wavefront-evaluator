// TWO CONVERGENCE REGIMES IN ONE SUB-TICK DRAIN — run: node public/two-regimes.test.mjs
//
// The wavefront-evaluator's sub-tick DRAIN LOOP is itself a fixpoint iteration: it runs W.reduce until the
// world is quiescent (isStable) WITHIN one logical tick — draining all ctx.future(0) cascades, feedback, and
// sends that must settle before the world advances. That is the KLEENE fixpoint (converge by running out of
// due events; discrete, exact, join-safe; the iters<10000 is only a runaway guard).
//
// futureContract added the BANACH fixpoint (converge by a metric residual ≤ tol; ρ<1). The question this
// proves: can the two regimes COEXIST in ONE drain — a causal node settling by Kleene quiescence AND a
// contraction node settling by its a-priori bound() — both reaching their fixpoint in the SAME tick, the
// drain terminating correctly for both, deterministic, and the causal node bit-for-bit unaffected?
//
// This mirrors the real drain loop (evaluator.js:403): while (!isStable) advance a sub-tick pulse. Within a
// tick, a node steps by RE-ARMING ctx.future(0) (Kleene: keeps going until no due entry); a contraction node
// ALSO arms futureContract(tol) and STOPS re-arming when it converges (Banach). Both drive !isStable; the
// drain ends when BOTH are settled.

import { W } from './krestianstvo-wavefront-evaluator.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

// ── A CAUSAL (Kleene) node: a fixed-length cascade. Each step re-arms future(0) until a counter runs out —
//    it settles by QUIESCENCE (no due event), not by any metric. This is the general node shape. ────────────
const causalNode = (steps) => ({
  __macro: (s, _p, ctx) => { ctx.future(0, 'step'); return { ...s, k: 0, done: false }; },
  step: (s, _p, ctx) => { const k = (s.k ?? 0) + 1; if (k < steps) ctx.future(0, 'step'); else return { ...s, k, done: true }; return { ...s, k }; },
});

// ── A CONTRACTION (Banach) node: a 1-D geometric shrink toward 0. Each step re-arms future(0) to keep
//    stepping WITHIN the tick, AND arms futureContract(tol) once; when residual ≤ tol the gate fires 'settled'
//    and it STOPS re-arming (exits the drain by its bound(), not by quiescence). ─────────────────────────────
const contractionNode = (rho, tol) => {
  const residual = (x) => Math.abs(x - rho * x);   // ‖x − W(x)‖ for W(x)=ρx
  const bound = Math.ceil(Math.log(tol / 1) / Math.log(rho));   // steps for |x| to shrink 1 → tol (d0=|1−ρ|, but use the simple decay bound)
  return { bound, handlers: {
    __residual: (s) => (s.x !== undefined) ? residual(s.x) : Infinity,
    __macro: (s, _p, ctx) => { ctx.future(0, 'step'); ctx.futureContract(tol, 'settled'); return { ...s, x: 1, k: 0, settled: false }; },
    step: (s, _p, ctx) => { if (s.settled) return s; ctx.future(0, 'step'); return { ...s, x: rho * s.x, k: (s.k ?? 0) + 1 }; },
    settled: (s) => ({ ...s, settled: true, settledAt: s.k }),   // Banach gate: fires when residual ≤ tol
  } };
};

// ── DRAIN one tick: mirror evaluator.js:403 — advance sub-tick pulses until BOTH nodes are stable. ──────────
const drainTick = (nodes, lt) => {
  const app = { _outbox: {}, _currentEvalGen: 0 };
  const S = {}; for (const id in nodes) S[id] = {};
  // macro pulse (new logicalTime) — fires __macro
  let iters = 0; const trace = [];
  app._currentEvalGen++;
  for (const id in nodes) S[id] = W.reduce(S[id], { wallTime: 0, logicalTime: lt, _appRef: app }, id, nodes[id]);
  // sub-tick drain: keep pulsing (same lt, isSubTick) until all nodes stable
  const stable = () => W.stable(Object.values(S), { wallTime: 0, _appRef: app });
  while (!stable() && iters < 10000) { iters++;
    app._currentEvalGen++;
    for (const id in nodes) S[id] = W.reduce(S[id], { wallTime: 0, logicalTime: lt, isSubTick: true, _appRef: app }, id, nodes[id]);
    trace.push({ iters, states: Object.fromEntries(Object.entries(S).map(([id, s]) => [id, s.done ?? s.settled])) });
  }
  return { S, iters, trace };
};

const CAUSAL_STEPS = 8, RHO = 0.5, TOL = 1e-3;

// ── (1) BOTH REGIMES SETTLE IN ONE DRAIN: the causal node reaches quiescence (done) AND the contraction node
//     reaches its fixpoint (settled), in the SAME tick's drain. ────────────────────────────────────────────
{
  const cn = contractionNode(RHO, TOL);
  const { S, iters } = drainTick({ causal: causalNode(CAUSAL_STEPS), contract: cn.handlers }, 1);
  ok('both regimes settle in one drain (Kleene quiescence + Banach convergence)',
     S.causal.done === true && S.contract.settled === true,
     `causal done@k${S.causal.k} (quiescence) · contract settled@k${S.contract.settledAt} (residual ${cn.handlers.__residual(S.contract).toExponential(1)}≤tol) · drain iters ${iters}`);
}

// ── (2) THE CONTRACTION EXITS BY ITS BANACH bound() (certified), not the magic cap. ────────────────────────
{
  const cn = contractionNode(RHO, TOL);
  const { S } = drainTick({ contract: cn.handlers }, 1);
  ok('contraction node exits by its a-priori bound() (certified, not magic cap)',
     S.contract.settled && S.contract.settledAt <= cn.bound,
     `settled@${S.contract.settledAt} ≤ bound ${cn.bound}`);
}

// ── (3) THE CAUSAL NODE IS BIT-FOR-BIT UNAFFECTED by the contraction sharing the drain: it settles at the
//     same step whether alone or beside a contraction (Kleene quiescence is oblivious to the Banach node). ──
{
  const alone  = drainTick({ causal: causalNode(CAUSAL_STEPS) }, 1).S.causal;
  const beside = drainTick({ causal: causalNode(CAUSAL_STEPS), contract: contractionNode(RHO, TOL).handlers }, 1).S.causal;
  ok('causal node bit-for-bit identical alone vs beside a contraction (additive)',
     alone.k === beside.k && alone.done === beside.done, `alone k${alone.k} == beside k${beside.k}`);
}

// ── (4) THE WHOLE DRAIN IS DETERMINISTIC: two peers draining the same mixed tick → byte-identical. ─────────
{
  const run = () => drainTick({ causal: causalNode(CAUSAL_STEPS), contract: contractionNode(RHO, TOL).handlers }, 1).S;
  const a = run(), b = run();
  const h = (S) => JSON.stringify({ ck: S.causal.k, cd: S.causal.done, x: S.contract.x, sa: S.contract.settledAt });
  ok('mixed-regime drain is byte-identical across peers (join-safe)', h(a) === h(b));
}

// ── (5) THE DRAIN TERMINATES ON THE SLOWER REGIME: iters = max(causal quiescence, contraction bound) — the
//     drain waits for BOTH fixpoints (the honest coexistence: neither regime shortcuts the other). ──────────
{
  const cn = contractionNode(RHO, TOL);
  const { S, iters } = drainTick({ causal: causalNode(3), contract: cn.handlers }, 1);   // causal FAST (3), contract SLOW
  const slower = Math.max(3, S.contract.settledAt);
  ok('drain terminates on the slower regime (waits for both fixpoints)', iters >= slower && S.causal.done && S.contract.settled,
     `causal quiescence@3, contract Banach@${S.contract.settledAt}, drain ran ${iters} (≥ max)`);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}  ${pass} passed, ${fail} failed`);
console.log('\nMEANING: the sub-tick drain and geometric scheduling are ONE primitive — "converge before advance" —');
console.log('in two regimes: KLEENE (causal quiescence, the general drain) and BANACH (metric attractor, the');
console.log('contraction subset). They COEXIST in one drain; the Banach node is certified by bound(), the Kleene');
console.log('nodes are untouched. Geometric scheduling COMPLETES the sub-tick loop, it does not replace it.');
process.exit(fail === 0 ? 0 : 1);
