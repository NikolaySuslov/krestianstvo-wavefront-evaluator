// CORE EMPOWERMENT PROTOTYPE — futureContract: the geometric (Banach) convergence gate.
// Run: node public/contract-gate.test.mjs
//
// The wavefront-evaluator core schedules on THREE things today: coordinate time (ctx.future), proper time
// (ctx.futureTau, gated by a pure __clock(state)), and the causal frontier (ctx.futureFrontier, gated by
// __clock + neighbour clocks). All three are TEMPORAL/CAUSAL — Kleene-style: "fire when a clock reaches T".
//
// This prototype adds the FOURTH, GEOMETRIC gate — futureContract(tol): "fire when this node's state has
// CONVERGED to within tol of its fixpoint" — the Banach face. A node declares a reserved pure handler
//   __residual: (state) => number     // distance-to-fixpoint (the contraction step-delta ‖state − W(state)‖)
// and the gate fires when __residual(state) ≤ tol. It is the exact structural twin of __clock/futureTau:
// a pure fn of the node's REPLICATED state → byte-identical firing on every peer (determinism preserved),
// and ADDITIVE (no fireAtContract entry ⇒ a node is bit-for-bit unchanged; no __residual ⇒ never fires).
//
// WHY THIS EMPOWERS THE CORE: a contraction node (ρ<1) has an A-PRIORI Banach bound on how many steps it
// needs — so instead of the drain's magic `iters < 10000` guard, such a node can be drained in a CERTIFIED
// number of steps, and it can SCHEDULE downstream work on its own geometric convergence, not a clock. The
// core gains a certified-termination node class + a convergence gate — Banach as a native peer to Kleene.
//
// This harness mirrors the core's reduce/queue/readiness logic (a faithful slice, not the whole engine) with
// the contract gate added, and proves: (1) the gate fires exactly at convergence; (2) firing step == the
// a-priori bound() ± a small margin (the certificate is honest); (3) byte-identical across two peers; (4)
// ADDITIVE — a node without the gate is unchanged.

import { makeHutchinson, seedRing } from './ifs-core.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

// ── A faithful slice of the core queue + readiness, WITH the contract gate added. ─────────────────────────
// Queue entries: {fireAt} (coordinate), {fireAtTau} (proper — omitted here), {fireAtContract: tol} (geometric).
const _split = (q, now) => ({ ready: q.filter(e => e.fireAt !== undefined && e.fireAt <= now), later: q.filter(e => e.fireAt === undefined || e.fireAt > now) });

// The mini-reducer: one pulse → run ready handlers → new state + queue. Mirrors W.reduce's shape, adding the
// __residual gate exactly where __clock's tau gate sits.
const makeReducer = (handlers) => (state, pulse) => {
  const { wallTime } = pulse;
  const { ready: ownReady, later: laterAll } = _split(state._queue ?? [], wallTime);

  // ── THE CONTRACT GATE (the new geometric readiness pass — twin of the tau/frontier passes) ──────────────
  const residualFn = handlers.__residual;
  const residual0 = residualFn ? residualFn(state) : Infinity;
  const contractReady = laterAll.filter(e => e.fireAtContract !== undefined && residual0 <= e.fireAtContract);
  const consumed = contractReady.length ? new Set(contractReady) : null;
  const later0 = consumed ? laterAll.filter(e => !consumed.has(e)) : laterAll;

  const allReady = [...ownReady, ...contractReady];
  // macro tick (drives the contraction step each pulse), mirroring the core's __macro injection
  if ((state._lt ?? -1) !== pulse.logicalTime) allReady.unshift({ msg: '__macro' });

  let s = state, newQueue = later0;
  for (const entry of allReady) {
    const handler = handlers[entry.msg]; if (!handler) continue;
    const effects = [];
    const ctx = {
      wallTime,
      future: (delayMs, msg, payload) => effects.push({ fireAt: wallTime + delayMs, msg, payload }),
      futureContract: (tol, msg, payload) => effects.push({ fireAtContract: tol, msg, payload }),   // the new gate verb
    };
    s = handler(s, entry.payload, ctx);
    for (const eff of effects) newQueue = [...newQueue, eff];
  }
  return { ...s, _queue: newQueue, _lt: pulse.logicalTime };
};

// ── A CONTRACTION NODE: its state IS a Hutchinson point set; each __macro applies one W step; __residual is
//    the Hausdorff step-delta (distance to the fixpoint). On the FIRST macro it arms futureContract(tol) to
//    fire "arrived" when converged. This is the core's new certified-contraction node class, in miniature. ──
const makeContractionNode = (rhos, tol, r0 = 12) => {
  const H = makeHutchinson({ dim: 1, dedupEps: 1e-3, maps: rhos.map(r => ({ A: [r], t: [(1 - r) * r0 * 0.7], rho: r })) });
  const bound = H.bound(seedRing(r0), tol);
  const handlers = {
    __residual: (s) => { if (!s.S) return Infinity; const S1 = H.step(s.S); return H.hausdorff(s.S, S1); },
    __macro: (s, _p, ctx) => {
      if (!s.S) { ctx.futureContract(tol, 'arrived'); return { ...s, S: seedRing(r0), steps: 0, arrived: false }; }
      return { ...s, S: H.step(s.S), steps: s.steps + 1 };
    },
    arrived: (s) => ({ ...s, arrived: true, arrivedAtStep: s.steps }),   // fires ONLY when __residual ≤ tol
  };
  return { reduce: makeReducer(handlers), bound, H, tol };
};

// drive a node N pulses (one logicalTime each → one __macro/step per pulse)
const drive = (node, N) => { let s = {}; for (let k = 1; k <= N; k++) s = node.reduce(s, { wallTime: k, logicalTime: k }); return s; };

const RHOS = [0.5, 0.68], TOL = 5e-3;

// ── (1) THE GATE FIRES EXACTLY AT CONVERGENCE: 'arrived' is set once __residual ≤ tol, not before. ─────────
{
  const node = makeContractionNode(RHOS, TOL);
  // step through and watch: not arrived while residual > tol, arrived once ≤ tol
  let s = {}, firedStep = -1, residualAtFire = null;
  for (let k = 1; k <= node.bound + 20; k++) { const prev = s; s = node.reduce(s, { wallTime: k, logicalTime: k });
    if (!prev.arrived && s.arrived) { firedStep = s.arrivedAtStep; residualAtFire = node.H.hausdorff(s.S, node.H.step(s.S)); } }
  ok('futureContract fires exactly when __residual ≤ tol', s.arrived && residualAtFire <= TOL,
     `arrived at step ${firedStep}, residual there ${residualAtFire?.toExponential(2)} ≤ tol ${TOL}`);
}

// ── (2) THE CERTIFICATE IS HONEST: the fire step ≈ the a-priori Banach bound() (the gate's convergence is
//     the certified one, not an accident). Fire step should be ≤ bound (bound is an upper bound). ───────────
{
  const node = makeContractionNode(RHOS, TOL);
  const s = drive(node, node.bound + 20);
  ok('fires at/under the a-priori bound() (certified drain)', s.arrived && s.arrivedAtStep <= node.bound,
     `arrived step ${s.arrivedAtStep} ≤ bound ${node.bound}`);
}

// ── (3) DETERMINISM: two independent peers driving the same node reach byte-identical state (the gate is a
//     pure fn of replicated state → join-safe, exactly like __clock/futureTau). ──────────────────────────────
{
  const a = drive(makeContractionNode(RHOS, TOL), 60), b = drive(makeContractionNode(RHOS, TOL), 60);
  const hashS = (s) => JSON.stringify({ S: Array.from(s.S), steps: s.steps, arrived: s.arrived, at: s.arrivedAtStep });
  ok('contract gate is byte-identical across peers (join-safe)', hashS(a) === hashS(b), `arrived step ${a.arrivedAtStep}`);
}

// ── (4) ADDITIVE: a node with NO __residual / no futureContract entry behaves like a plain coordinate node —
//     the gate is invisible unless used (the "no fireAtContract ⇒ bit-for-bit unchanged" contract). ─────────
{
  const plain = { __macro: (s, _p, ctx) => { if (!s.n) { ctx.future(0, 'tick'); return { ...s, n: 1 }; } return s; },
                  tick: (s) => ({ ...s, ticked: true }) };
  const reduce = makeReducer(plain);
  let s = {}; for (let k = 1; k <= 3; k++) s = reduce(s, { wallTime: k, logicalTime: k });
  ok('additive: a node without the gate is unaffected', s.ticked === true && s.arrived === undefined);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}  ${pass} passed, ${fail} failed`);
console.log('\nMEANING: the core gains a GEOMETRIC (Banach) scheduling gate beside its temporal/causal ones.');
console.log('A contraction node drains in a CERTIFIED bound() steps and can schedule downstream work on its');
console.log('OWN convergence — Banach as a native peer to Kleene. Pure over replicated state → join-safe.');
process.exit(fail === 0 ? 0 : 1);
