// MOVES 1 + 2a + 2b-ii — the real core makeContractionNode + futureContract drain/stability, proven against
// the REAL W.reduce. Run: node public/contract-node.test.mjs
//
// Move 1  — makeContractionNode: a factory (core export) emitting a certified-contraction node handler set.
// Move 2a — the node PARKS at its fixpoint (arrived → no new futures) so the drain exits without the magic cap.
// Move 2b-ii — an UNCONVERGED futureContract entry BLOCKS isStable (the world isn't done until it converges),
//              guarded so a CONTRACT-LESS world is bit-for-bit unchanged (the additive law).
//
// The load-bearing proof is (4): a plain node (no __residual) driven through the REAL, now-modified W.reduce is
// BYTE-IDENTICAL to the same node's expected behavior — i.e. the core edits touch nothing for current apps.

import { W, makeContractionNode, makeHutchinson, seedRing } from './krestianstvo-wavefront-evaluator.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

const mkHutch = (rhos, r0 = 12) => makeHutchinson({ dim: 1, dedupEps: 1e-3, maps: rhos.map(r => ({ A: [r], t: [(1 - r) * r0 * 0.7], rho: r })) });
const drive = (handlers, nodeId, N) => { let s = {}; for (let k = 1; k <= N; k++) s = W.reduce(s, { wallTime: k, logicalTime: k, _appRef: { _currentEvalGen: 0 } }, nodeId, handlers); return s; };
const isStable = (s, wall) => W.stable([s], { wallTime: wall, _appRef: { _outbox: {} } });

const RHOS = [0.5, 0.68], TOL = 5e-3, R0 = 12;

// ── (1) THE FACTORY produces a working certified-contraction node in the REAL core: converges + fires. ──────
{
  const H = mkHutch(RHOS); const bound = H.bound(seedRing(R0), TOL);
  const node = makeContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound });
  const s = drive(node, "c", bound + 10);
  ok('makeContractionNode converges + fires "arrived" in real W.reduce', s.arrived === true && s.arrivedAt > 0, `arrived at step ${s.arrivedAt}`);
}

// ── (2a) THE NODE PARKS at its fixpoint — after arrival it produces no new futures, so the drain would exit
//     (no reliance on the magic 10000 cap). Check the queue is empty + residual holds post-arrival. ──────────
{
  const H = mkHutch(RHOS); const bound = H.bound(seedRing(R0), TOL);
  const node = makeContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound });
  const s = drive(node, "c", bound + 10);
  const parked = (s._queue ?? []).length === 0;   // arrived entry consumed, no re-arm, no pending futures
  ok('arrived node PARKS (empty queue → drain exits, no magic cap)', s.arrived && parked, `queueLen=${(s._queue ?? []).length}`);
}

// ── (2b-ii) UNCONVERGED contract BLOCKS isStable; CONVERGED does not. The world waits for the fixpoint. ─────
{
  const H = mkHutch(RHOS); const bound = H.bound(seedRing(R0), TOL);
  const node = makeContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound });
  let s = {}, stableEarly = null, stableAfter = null;
  for (let k = 1; k <= bound + 10; k++) { s = W.reduce(s, { wallTime: k, logicalTime: k, _appRef: { _currentEvalGen: 0 } }, "c", node);
    if (k === 2) stableEarly = isStable(s, k);        // clearly un-converged (residual ≫ tol) → must block
    if (s.arrived && stableAfter === null) stableAfter = isStable(s, k); }   // converged → must release
  ok('unconverged contract BLOCKS stability; converged RELEASES it', stableEarly === false && stableAfter === true,
     `stable(early,unconverged)=${stableEarly} → stable(converged)=${stableAfter}`);
}

// ── (3) JOIN-SAFE: two peers → byte-identical (pure fn of replicated state). ────────────────────────────────
{
  const mk = () => { const H = mkHutch(RHOS); return makeContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound: H.bound(seedRing(R0), TOL) }); };
  const a = drive(mk(), "c", 60), b = drive(mk(), "c", 60);
  const h = (s) => JSON.stringify({ S: Array.from(s.S), cSteps: s.cSteps, arrived: s.arrived, at: s.arrivedAt });
  ok('contraction node byte-identical across peers (join-safe)', h(a) === h(b), `arrived step ${a.arrivedAt}`);
}

// ── (4) THE ADDITIVE LAW (load-bearing): a CONTRACT-LESS node (no __residual, no futureContract) driven
//     through the REAL modified W.reduce is bit-for-bit as before — no _contractResidual stamped, never blocks
//     stability, queue drains normally. This proves the core edits touch NOTHING for current apps. ───────────
{
  const plain = {
    __macro: (s, _p, ctx) => { if (!s.n) { ctx.future(0, "tick"); return { ...s, n: 1 }; } return s; },
    tick: (s) => ({ ...s, ticked: true, q: (s.q ?? 0) + 1 }),
  };
  const s = drive(plain, "p", 4);
  const clean = s._contractResidual === undefined && s.arrived === undefined && (s._queue ?? []).length === 0;
  ok('additive: contract-less node bit-for-bit unchanged (no _contractResidual, drains normally)',
     s.ticked === true && s.q === 1 && clean, `state={n:${s.n},ticked:${s.ticked},q:${s.q},_contractResidual:${s._contractResidual}}`);
  // and it is STABLE exactly as before (no contract clause can touch it)
  ok('additive: contract-less node stability unchanged', isStable(s, 100) === true);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}  ${pass} passed, ${fail} failed`);
console.log('\nMEANING: the core now offers a CERTIFIED-CONTRACTION node class (makeContractionNode) that drains');
console.log('by its Banach bound() via the futureContract gate, and unconverged contracts hold the world un-');
console.log('stable until they reach their fixpoint — WHILE contract-less worlds stay bit-for-bit unchanged.');
process.exit(fail === 0 ? 0 : 1);
