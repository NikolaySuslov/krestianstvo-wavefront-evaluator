// kwe-tau.test.mjs — regression tests for the proper-time kernel (node test/kwe-tau.test.mjs).
// Every scenario here is a distillation of a LIVE-verified behavior or a LIVE-CAUGHT fork from the medium's
// τ arc (doc/proper-time-metric.md + the 2026-07 fork hunt). If one fails, a determinism law regressed.
import { makeTauKernel } from '../public/kwe-tau.js';

let ok = true; const chk = (n, c) => { if (!c) { ok = false; console.log(`FAIL ${n}`); } else console.log(`  ok  ${n}`); };

// ── τ integrator (L4): monotone, integer snap, L recalibration, plateau, ceiling ────────────────────────────
{
  const K = makeTauKernel();
  let prev = 0, kp = 0, mono = true;
  for (let b = 1; b <= 40; b++) { kp += 3;
    if (b % 5 === 0) K.beat('V', kp);
    const t = K.advance('V', kp); if (t < prev) mono = false;
    if (b % 5 === 0 && t !== Math.floor(t)) mono = false; prev = t; }
  chk('τ monotone + integer at beats', mono);
  chk('L recalibrated in own steps', K.status().clocks.V.L === 15);
  kp = 0;                                        // counter reset (the ear-toggle/reboot class)
  for (let b = 0; b < 20; b++) { kp += 3; const t = K.advance('V', kp); if (t < prev) mono = false; prev = t; }
  chk('plateau through counter reset (never backward)', mono);
  for (let b = 0; b < 200; b++) { kp += 3; prev = K.advance('V', kp); }
  chk('dead worldline ceilings below next integer', prev < K.status().clocks.V.beats + 1);
}

// ── level 0: flat clock ≡ coordinate time (the no-op guarantee) ──────────────────────────────────────────────
{
  const K = makeTauKernel();
  K.registerClock('app', { flat: true });
  chk('flat clock: τ = kp/21 exactly', K.advance('app', 42) === 2 && K.advance('app', 210) === 10);
}

// ── declared liveness policy: watchdog fires only when opted in ─────────────────────────────────────────────
{
  const K = makeTauKernel();
  K.registerClock('rot', { watchdogK: 84 }); K.registerClock('mat');
  K.beat('rot', 10, 100); K.beat('mat', 10, 100);
  chk('watchdog fires for opted-in clock', K.watchdog('rot', 184, 20) === true && K.status().clocks.rot.beats === 2);
  chk('watchdog never fires for a physics clock', K.watchdog('mat', 9000, 20) === false && K.status().clocks.mat.beats === 1);
}

// ── gate 3″ dispatch (L3): stall-wake anti-teleport ──────────────────────────────────────────────────────────
{
  const K = makeTauKernel();
  const Q = K.makeQueue('shift', { clock: 'W' });
  K.beat('W', 100, 500); K.advance('W', 100);                     // τ_W alive then frozen
  // simulate a prior application so the burst is genuine backlog
  Q.push({ t: 0, seq: 0 }); Q.entries()[0].startStep = 900; Q.entries()[0].seq = 1;
  Q.restore({ seq: 2, startStep: 910 }); Q.restore({ seq: 3, startStep: 920 });
  const out = []; let kpW = 100;
  for (let k = 1000; k <= 1400 && Q.length; k++) {
    if (k >= 1050 && (k - 1050) % 60 === 0) K.beat('W', ++kpW, k);  // wake ripple: a beat per 60 k
    K.advance('W', kpW);
    Q.drain(k, () => out.push(k)); }
  chk('stall-wake: 1 fresh + τ-paced backlog', out[0] === 1000 && out.length === 3 && out[1] > 1049 && out[2] > out[1] + 30);
}

// ── L1+L2: frame-batching invariance (the pre-loop + raw-length-valve fork regression) ──────────────────────
{
  const run = (batch) => { const K = makeTauKernel();
    const Q = K.makeQueue('shift', { clock: 'W' });                // W never beats: frozen τ, valve territory
    K.advance('W', 0);
    const verbs = [ { t: 0, seq: 1, s: 9835 }, { t: 0, seq: 2, s: 9835 }, { t: 0, seq: 3, s: 9836 },
                    { t: 0, seq: 4, s: 9876 }, { t: 0, seq: 5, s: 9897 },
                    { t: 0, seq: 6, s: 10150 }, { t: 0, seq: 7, s: 10150 }, { t: 0, seq: 8, s: 10151 },
                    { t: 0, seq: 9, s: 10152 }, { t: 0, seq: 10, s: 10153 }, { t: 0, seq: 11, s: 10154 } ];
    const out = [];
    for (let base = 9830; base < 10300; base += batch) {
      while (verbs.length && verbs[0].s < base + batch) { const v = verbs.shift(); Q.restore({ t: v.t, seq: v.seq, startStep: v.s }); }
      for (let k = base; k < base + batch; k++) Q.drain(k, (e) => out.push(`${e.seq}@${k}`)); }
    return out.join(' '); };
  const a = run(7), b = run(14), c = run(28);
  chk('batching invariance 7/14/28 (fast drag, frozen τ)', a === b && b === c);
  chk('same-step siblings flow (>= fresh)', a.startsWith('1@9835 2@9835 3@9836'));
}

// ── L5: epoch re-anchor + re-stamp convergence (the cross-epoch stamping race regression) ───────────────────
{
  const R = 3, SPP = 19;
  const K = makeTauKernel({ monRate: R, stepsPerPhase: SPP, clock0: 165.6, rate: 1 });
  const Q = K.makeQueue('virt', { clock: null });
  const tFlip = 100.0, kFlip = Math.floor((tFlip * R - 165.6) * SPP / 1);
  const sOld = Q.push({ t: 103.7, seq: 1 });                       // stamped in the OLD epoch (the race)
  K.reanchor(kFlip, 2);                                            // the flip at its shared step → re-stamp
  const sNew = Math.floor((103.7 * R - K.clock0) * SPP / 2);       // what a post-flip peer stamps
  chk('re-stamp converges to the post-flip stamp', Q.head().startStep === sNew && sOld !== sNew);
}

// ── cadence (the leash law): per-beat, command-fresh, dead-stand, flat grid ──────────────────────────────────
{
  const K = makeTauKernel();
  K.registerClock('V');
  const C = K.makeCadence('V'); C.fresh();                          // 'go' fired on a never-beaten worldline
  const adv = []; let kp = 0;
  for (kp = 1; kp <= 300; kp++) { if (kp >= 40 && kp % 30 === 0) K.beat('V', kp);
    if (C.due(kp)) adv.push(kp); }
  chk('cadence: command-fresh immediate, then per-beat', adv[0] === 1 && adv.slice(1).every(k => k % 30 === 0));
  const C2 = K.makeCadence('P1');                                   // clock never registered → flat grid
  const adv2 = []; for (kp = 1; kp <= 100; kp++) if (C2.due(kp)) adv2.push(kp);
  chk('cadence flat grid off-clock (no-op form)', adv2.join(',') === '21,42,63,84');
  const C3 = K.makeCadence('V'); K.registerClock('X'); const C4 = K.makeCadence('X');
  const adv4 = []; for (kp = 1; kp <= 500; kp++) if (C4.due(kp)) adv4.push(kp);
  chk('dead uncommanded worldline stands honestly', adv4.length === 0 && !!C3);
}

// ── L6: snapshot round-trip mid-backlog (joiner throttle-phase parity) ───────────────────────────────────────
{
  const K = makeTauKernel({ clock0: 27.75, rate: 2, monRate: 3 });
  const Q = K.makeQueue('shift', { clock: 'W' });
  K.beat('W', 50, 900); K.advance('W', 55);
  Q.restore({ seq: 1, startStep: 800 }); Q.restore({ seq: 2, startStep: 810 });
  Q.drain(1000, () => {});                                          // applies the fresh head → cursors move, backlog held
  const snap = JSON.parse(JSON.stringify(K.save()));                // through the wire
  const J = makeTauKernel(); J.restore(snap);
  chk('snapshot: hash parity leader vs joiner', J.hash() === K.hash());
  const a = [], b = [];
  const QL = K.makeQueue('shift'), QJ = J.makeQueue('shift');       // re-attach to the restored records
  for (let k = 1001; k <= 1100; k++) { QL.drain(k, e => a.push(`${e.seq}@${k}`)); QJ.drain(k, e => b.push(`${e.seq}@${k}`)); }
  chk('snapshot: identical post-join drain decisions', a.join() === b.join());
}


// ── gate-3 API: absent-clock unconditional, creation baseline, resets ────────────────────────────────────────
{
  const K = makeTauKernel();
  const Q = K.makeQueue('shift', { clock: 'W' });
  Q.restore({ seq: 1, startStep: 100 }); Q.restore({ seq: 2, startStep: 100 }); Q.restore({ seq: 3, startStep: 100 });
  let n = 0; Q.drain(500, () => n++);
  chk('absent clock = unconditional coordinate dispatch (no-op form)', n === 3);
  K.beat('W', 10, 400); K.advance('W', 12);
  Q.restore({ seq: 4, startStep: 90 }); Q.restore({ seq: 5, startStep: 91 });   // backlog behind kApply=500
  let m = 0; Q.drain(501, () => m++);
  chk('clock present again → backlog throttled', m === 1);   // only the fresh-by-kApply... none fresh; τ jumped at beat → 1 τ-paced
  K.resetClocks();
  let r = 0; Q.drain(502, () => r++);
  chk('resetClocks → unconditional again', r === 1 && Q.length === 0);
  const t0 = K.advance('V', 500);
  chk('lazy creation baselines at kp (τ starts 0, not ceiling)', t0 === 0);
  Q.restore({ seq: 6, startStep: 90 }); Q.clear(); Q.resetCursors();
  chk('clear + resetCursors', Q.length === 0);
}
console.log(ok ? 'ALL PASS (incl. gate-3 API)' : 'FAILURES ABOVE');

// ── gate-4: head-blocking guard (the sig slot-gate class) ────────────────────────────────────────────────────
{
  const K = makeTauKernel();
  let slot = 0;   // stands in for a shared-state condition (e.g. the sig clock's slot(kW))
  const Q = K.makeQueue('sig', { clock: null, guard: (e) => (e.ph ?? -1) < 0 || e.ph === slot });
  Q.restore({ seq: 1, startStep: 10, ph: 2 }); Q.restore({ seq: 2, startStep: 10, ph: -1 });
  let out = []; Q.drain(50, e => out.push(e.seq));
  chk('guard blocks the head (FIFO: unslotted entry waits behind)', out.length === 0 && Q.length === 2);
  slot = 2; Q.drain(51, e => out.push(e.seq));
  chk('guard opens → head + follower drain in order', out.join(',') === '1,2');
  const Q2 = K.makeQueue('sig');   // re-attach without guard option keeps the existing guard
  Q2.restore({ seq: 3, startStep: 10, ph: 1 });
  let out2 = []; Q2.drain(60, e => out2.push(e.seq));
  chk('guard survives re-attach', out2.length === 0);
}
console.log(ok ? 'ALL PASS (incl. gate-4 guard)' : 'FAILURES ABOVE');


process.exit(ok ? 0 : 1);
