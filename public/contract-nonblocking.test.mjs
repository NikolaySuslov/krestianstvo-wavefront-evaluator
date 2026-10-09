// futureContract(tol, msg, payload, { blocking: false }) — the NON-BLOCKING certificate (2026-09-24, for ahc's entrainment
// gate). A node whose residual only shrinks ACROSS pulses (re-measured once per beat of a living medium) must not hold the
// world unstable while its certificate is pending: the drain cannot make it converge, and the join WARP loop would spin
// its 1000-iteration guard. Proven against the REAL W.reduce + W.stable. Run: node public/contract-nonblocking.test.mjs
import { W } from './krestianstvo-wavefront-evaluator.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const pulse = (k) => ({ wallTime: k, logicalTime: k, _appRef: { _currentEvalGen: 0 } });
const isStable = (s, wall) => W.stable([s], { wallTime: wall, _appRef: { _outbox: {} } });

// a node that halves its residual once per PULSE (never within a drain), and arms its certificate on the first pulse
const node = (blocking) => ({
  __residual: (s) => (Number.isFinite(s.r) ? s.r : Infinity),
  __macro: (s, p, ctx) => { if (s.r === undefined) { ctx.futureContract(1e-3, "done", { tag: 1 }, blocking === undefined ? undefined : { blocking }); return { ...s, r: 1 }; } return s.fired ? s : { ...s, r: s.r / 2 }; },
  done: (s, p) => ({ ...s, fired: true, firedR: s.r, tag: p?.tag }),
});

{ let s = {}; s = W.reduce(s, pulse(1), "n", node(false));
  ok('a pending NON-BLOCKING contract leaves the world stable', isStable(s, 1) === true, `residual ${s._contractResidual}`);
  ok('...and is queued as a contract entry marked _cNB', (s._queue || []).some((e) => e.fireAtContract === 1e-3 && e._cNB === true));
  let k = 1; while (!s.fired && k < 40) s = W.reduce(s, pulse(++k), "n", node(false));
  ok('...it still FIRES when the residual reaches tol (the gate is unchanged)', s.fired === true && s.firedR <= 1e-3 && s.tag === 1, `fired at pulse ${k}, r ${s.firedR}`);
  ok('...and is consumed (queue empty afterwards)', (s._queue || []).length === 0); }
{ let s = {}; s = W.reduce(s, pulse(1), "n", node(undefined));
  ok('the DEFAULT (no opts) is still blocking — existing contract apps unchanged', isStable(s, 1) === false && !(s._queue || []).some((e) => e._cNB)); }
{ let s = {}; s = W.reduce(s, pulse(1), "n", node(true));
  ok('blocking:true behaves as the default', isStable(s, 1) === false); }
{ const a = [], b = []; for (const out of [a, b]) { let s = {}; for (let k = 1; k <= 14; k++) { s = W.reduce(s, pulse(k), "n", node(false)); out.push(JSON.stringify([s.r, s.fired ?? false, (s._queue || []).length])); } }
  ok('two peers byte-identical (pure fn of replicated state)', a.join() === b.join()); }

console.log(fail ? `\n✗ ${fail} failed, ${pass} passed` : `\n✅ ALL PASS  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
