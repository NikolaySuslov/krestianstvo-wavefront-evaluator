// kwe-futuretau.test.mjs — the τ arc's W-node layer: ctx.futureTau + __clock in the node runtime (W.reduce).
// Run: node test/kwe-futuretau.test.mjs. The laws are kwe-tau.js L1–L6, applied at the world-model layer:
// a node's clock is a pure monotone fn of its own replicated state; futureTau fires when the node has AGED,
// not when the wall has moved; no clock ⇒ futureTau ≡ future exactly; a τ future on a standing clock waits.
import { W } from '../public/krestianstvo-wavefront-evaluator.js';

let ok = true; const chk = (n, c) => { if (!c) { ok = false; console.log(`FAIL ${n}`); } else console.log(`  ok  ${n}`); };
const pulse = (wallTime, logicalTime) => ({ wallTime, logicalTime, isSubTick: false });
const run = (state, handlers, from, to, step = 1) => { const log = [];
  for (let t = from; t <= to; t += step) state = W.reduce(state, pulse(t, t), 'n', { ...handlers, _log: (s, p, ctx) => { log.push({ t, p }); return (handlers._log ? handlers._log(s, p, ctx) : s); } });
  return { state, log }; };

// ── no-op guarantee: without __clock, futureTau(d) ≡ future(d) ───────────────────────────────────────────────
{
  const H = { __macro: (s, p, ctx) => { if (p.logicalTime === 1) { ctx.futureTau(50, '_log', { via: 'tau' }); ctx.future(50, '_log', { via: 'coord' }); } return s; } };
  const { log } = run({}, H, 1, 100);
  chk('flat: futureTau(50) fires with future(50), same pulse', log.length === 2 && log[0].t === log[1].t && log[0].t === 51);
}

// ── clocked: fires when the node has AGED by dTau, independent of wall pacing ────────────────────────────────
{
  const H = {
    __clock: (s) => s.cycles ?? 0,
    __macro: (s, p, ctx) => { if (p.logicalTime === 1) ctx.futureTau(3, '_log', {}); return s; },
    _beat: (s) => ({ ...s, cycles: (s.cycles ?? 0) + 1 }),
  };
  let state = {}; const fired = [];
  for (let t = 1; t <= 200; t++) {
    if (t === 40 || t === 90 || t === 150) state = W.reduce(state, pulse(t, t), 'n', { ...H, __macro: (s, p, ctx) => H._beat(H.__macro(s, p, ctx), p, ctx) });
    else state = W.reduce(state, pulse(t, t), 'n', { ...H, _log: (s) => { fired.push(t); return s; } });
  }
  chk('clocked: fires on the pulse AFTER the 3rd beat (t=151), not at any wall delay', fired.length === 1 && fired[0] === 151);
}

// ── a standing clock parks the future honestly, and the node still reports STABLE ───────────────────────────
{
  const H = { __clock: (s) => s.cycles ?? 0,
    __macro: (s, p, ctx) => { if (p.logicalTime === 1) ctx.futureTau(1, '_log', {}); return s; } };
  const { state, log } = run({}, H, 1, 500);
  chk('dead clock: τ future never fires', log.length === 0 && state._queue.length === 1);
  chk('τ-parked node is STABLE (its clock cannot advance on a stable world)', W.stable([state], pulse(500, 500)) === true);
  chk('τ entry never blocks the coordinate wake schedule', state._nextAt === Infinity);
}

// ── snapshot safety: the τ entry JSON round-trips (no Infinity → null corruption) ────────────────────────────
{
  const H = { __clock: (s) => s.cycles ?? 0,
    __macro: (s, p, ctx) => { if (p.logicalTime === 1) ctx.futureTau(2, '_log', {}); return s; },
    _beat: (s) => ({ ...s, cycles: (s.cycles ?? 0) + 1 }) };
  let state = W.reduce({}, pulse(1, 1), 'n', H);
  const wire = JSON.parse(JSON.stringify(state));                    // through the join snapshot
  chk('τ entry survives JSON (fireAtTau intact, no fireAt:null)', wire._queue[0].fireAtTau === 2 && !('fireAt' in wire._queue[0]));
  let joiner = wire; const fired = [];
  for (let t = 2; t <= 10; t++) {
    joiner = W.reduce(joiner, pulse(t, t), 'n', { ...H, __macro: (s) => ({ ...s, cycles: (s.cycles ?? 0) + 1 }), _log: (s) => { fired.push(t); return s; } });
  }
  chk('joiner: restored τ future fires on the pulse after ITS clock reaches the stamp', fired.length === 1 && fired[0] === 4);   // readiness is evaluated against the INCOMING state, once per pulse (same convention as coordinate futures)
}

// ── determinism: identical pulse streams → identical fire steps regardless of scheduling pattern ─────────────
{
  const mk = () => ({ __clock: (s) => s.n ?? 0,
    __macro: (s, p, ctx) => { const s2 = { ...s, n: (s.n ?? 0) + ((p.logicalTime % 3 === 0) ? 1 : 0) };
      if (p.logicalTime === 5) ctx.futureTau(4, '_log', {}); return s2; } });
  const a = run({}, mk(), 1, 60), b = run({}, mk(), 1, 60);
  chk('two peers, same stream → identical τ fire step', JSON.stringify(a.log.map(e=>e.t)) === JSON.stringify(b.log.map(e=>e.t)) && a.log.length === 1);
}


// ── the IFS launch chain (hologram_world's topology in miniature): τ-chain for OVERLAP + finalize fallback for
//    LIVENESS. FAST beats (all roots < window/5) exercise the guard-drop path that halted the live world
//    (2026-07-11, kv pinned at 1): the chained launch arrives while the sibling is still active and is dropped —
//    without the fallback both slots die and beatCount freezes forever. ─────────────────────────────────────────
{
  const ROOTS = 4, DONE = 40;
  const mkH = (withFallback) => {
    const launch = (s, ctx, slot, cycleId) => {
      for (let i = 0; i < ROOTS; i++) ctx.future(2 + i * 2, '_beat', {});   // FAST roots: chain stamp reached at ~launch+8, long before fin at +40 → the chained launch WILL be guard-dropped
      ctx.future(DONE, '_fin', { slot });
      ctx.futureTau(ROOTS, '_launch' + (slot === 'A' ? 'B' : 'A'), { cycleId: cycleId + 1 });   // overlap chain
      return { ...s, ['active' + slot]: true, launches: [...(s.launches ?? []), `${slot}${cycleId}`] };
    };
    return {
      __clock: (s) => s.beats ?? 0,
      __macro: (s, p, ctx) => (p.logicalTime === 1 ? launch(s, ctx, 'A', 1) : s),
      _launchA: (s, p, ctx) => (s.activeA ? s : launch(s, ctx, 'A', p.cycleId)),
      _launchB: (s, p, ctx) => (s.activeB ? s : launch(s, ctx, 'B', p.cycleId)),
      _beat: (s) => ({ ...s, beats: (s.beats ?? 0) + 1 }),
      _fin: (s, p, ctx) => { const next = p.slot === 'A' ? 'B' : 'A';
        if (withFallback && !s['active' + next]) ctx.future(0, '_launch' + next, { cycleId: (s.lastCycle ?? 0) + 1 });
        return { ...s, ['active' + p.slot]: false }; },
    };
  };
  // track lastCycle for the fallback id (mirror of p.cycleId+1 in the real model)
  const runW = (withFallback) => { const H = mkH(withFallback); let st = {};
    const H2 = { ...H, _launchA: (s, p, ctx) => H._launchA({ ...s, lastCycle: p.cycleId ?? s.lastCycle }, p, ctx),
                       _launchB: (s, p, ctx) => H._launchB({ ...s, lastCycle: p.cycleId ?? s.lastCycle }, p, ctx) };
    for (let t = 1; t <= 3000; t++) st = W.reduce(st, pulse(t, t), 'n', H2); return st; };
  const dead = runW(false), live = runW(true), live2 = runW(true);
  chk(`chain-only HALTS under fast beats (the live-caught bug: ${dead.launches.length} launches then silence)`, dead.launches.length <= 3);
  const alt = live.launches.every((l, i) => i === 0 || l[0] !== live.launches[i - 1][0]);
  chk(`chain + finalize fallback ping-pongs perpetually (${live.launches.length} cycles in 3000 pulses)`, live.launches.length > 30 && alt);
  chk('fallback path: two peers identical', JSON.stringify(live.launches) === JSON.stringify(live2.launches));
}

console.log(ok ? '\nALL PASS (futureTau W-layer)' : '\nFAILURES ABOVE');
process.exit(ok ? 0 : 1);
