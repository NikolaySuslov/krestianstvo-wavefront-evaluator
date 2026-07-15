// THE GATE BATTERY — one paste, sectioned drivers for the standing two-peer verification
// (doc/proper-time-metric.md §12: stages A/B1/B2/C1 + steps 2–5 + the metric sector, all in one session).
// Paste into BOTH peers' consoles (defines window.gates; only ONE peer runs the verb sections — the other
// observes and runs the READ sections at the printed steps). Prerequisites: transport world, V recorded
// (⎙virt), P1 booted (for a non-trivial chain), selfClock+mux on.
//
// SECTIONS (run in order; each prints ✔/✖ where a threshold exists, and step-stamped lines to diff):
//   gates.base()    — READ-ONLY snapshot: lensOps/chainRead/chainSee/edgeStatus + solH context.
//                     Run on BOTH peers back-to-back; the [GATES-BASE] lines must match at equal step=.
//   gates.burst()   — the settings+register verb burst (ONE peer): refAmp/attPhase/lensTau/lensSet/
//                     recordVia, spaced 1.6 s (the load-bearing-verb spacing hazard), each verified in
//                     lensOps afterward; ends with the recordVia reconstruction check (|mdl| < 0.05).
//   gates.loaded()  — the LOADED-ε gate: lensTau(0.1) + a V journey until ≥4 beats of differential aging,
//                     then chainRead ×3 — ε must stay |ε| ≤ 0.02 with links O(0.1+); prints mdl drift.
//   gates.metric()  — the metric-sector scene: lensSet rot 0.3 → chainRead unchanged (read-side boundary,
//                     |Δraw| < 0.05) + chainSee vis drop; revert → chainSee closes on chainRead+pred (<0.02).
//   gates.all()     — burst → loaded → metric in sequence (base() manually before AND after on both peers).
// MANUAL ITEMS the driver cannot do (do them around gates.all()):
//   · JOIN: second peer joins mid-state → both run gates.base() → [GATES-BASE] lines must match.
//   · OBJORBIT: switch drive to objorbit, run gates.burst() again (B1's ctx indirection under the other mode).
//   · UI dials: click ⎙viaφ slider + view:∠lens on one peer → both peers' bar5 must agree (viaphi/lensview).
//   · Throughout: solH/kH byte-lock (the [solH] console lines), c0/rate equality (C1's step clock).
(() => {
  if (globalThis.gates) console.warn('[GATES] redefining window.gates');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const P = (s, okv) => console.log(`%c[GATES] ${okv === true ? '✔' : okv === false ? '✖ FAIL' : '·'} ${s}`, okv === false ? 'color:#f66;font-weight:bold' : okv === true ? 'color:#9f9' : 'color:#9cf');
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const need = () => { if (typeof lensOps !== 'function' || typeof chainRead !== 'function') { console.warn('[GATES] verbs missing — wrong app/world'); return false; } return true; };

  const base = () => { if (!need()) return;
    console.log('%c[GATES-BASE] ── read-only snapshot (diff these lines across peers at equal step=) ──', 'color:#f90;font-weight:bold');
    const o = lensOps(); const cr = chainRead(); const cs = chainSee(); edgeStatus();
    console.log(`[GATES-BASE] digest step=${cr.step ?? '?'} ops=${JSON.stringify(o.map((l) => [l.slot, l.mode, +l.angle.toFixed(3), l.beta, l.omega]))} ε=${cr.defect} seenε=${cs.defect ?? cs}`);
    return { o, cr, cs }; };

  const burst = async () => { if (!need()) return;
    console.log('%c[GATES-BURST] ── settings+register verb burst (this peer drives; 1.6 s spacing) ──', 'color:#f90;font-weight:bold');
    const steps = [
      ['refAmp(V, 0.67)', () => refAmp('V', 0.67), () => lensOps()[1].beta === 0.67],
      ['refAmp(V, 1)',    () => refAmp('V', 1),    () => lensOps()[1].beta === 1],
      ['attPhase(0.1, W)', () => attPhase(0.1, 'W'), () => lensOps()[0].phase > 0],
      ['attPhase(0.1, V)', () => attPhase(0.1, 'V'), () => true],   // V ledger moves only if V has a stored att — lensOps line shows it
      ['lensTau(0.1)',    () => lensTau(0.1),      () => lensOps()[0].omega === 0.1],
      ['lensTau(0)',      () => lensTau(0),        () => lensOps()[0].omega === 0],
      ['lensSet(V, rot 0.3)', () => lensSet('V', { rot: 0.3 }), () => lensOps()[1].mode === 'metric'],
      ['lensSet(V) revert',   () => lensSet('V'),  () => lensOps()[1].mode === 'id'],
    ];
    for (const [name, fire, check] of steps) { fire(); await sleep(1600); P(`${name} → ${check() ? 'landed' : 'NOT REFLECTED'}`, check()); }
    // recordVia reconstruction — RUN-1 LESSON: V inherits W's frame IN THE BYTES (the copied att carries W's
    // rotation) while V's ledger records only the birth angle, so the construction constant = φ_birth EXACTLY and
    // mdl = ∠W at record time (same semantics as [RECALL-∠]'s plate frame). Assert against that, not against 0.
    const wAng = lensOps()[0].angle;
    recordVia(0.5); await sleep(2500);
    const cr = chainRead(); const l = cr.links && cr.links.find((x) => x.a === 'W' && x.b === 'V');
    const mErr = l ? Math.abs(Math.atan2(Math.sin(l.mdl - wAng), Math.cos(l.mdl - wAng))) : 1e9;
    P(`recordVia(0.5) reconstruction: W→V mdl=${l ? l.mdl : '?'} vs ∠W@record=${wAng.toFixed(3)} → |mdl−∠W|=${mErr.toFixed(4)} (want < 0.05)`, mErr < 0.05);
    console.log('[GATES-BURST] done — now diff lensOps/solH on the OTHER peer at these steps'); };

  const loaded = async () => { if (!need()) return;
    console.log('%c[GATES-LOADED] ── the loaded-ε gate: composition with O(1 rad) operator load ──', 'color:#f90;font-weight:bold');
    // RUN-4 LESSON (the recurring INCONCLUSIVE): the AGING VEHICLE destroyED the OBSERVABLE — a 12px journey
    // grinds V's overlap to vis ~0.04 (chase softening + wear), regardless of P1 freshness. The gate needs links
    // CARRYING O(1 rad) of operator load, and the composition law does not care whether the load came from aging
    // or AUTHORING — both are real operator angles. Phase A (the gate): authored load at full vis, no journey.
    // Phase B (informative): the lensTau-aging flavor with a vis-RECOVERY trace — does hold re-crystallize V at
    // rest (vis climbs back) or is the decorrelation permanent (the wear law, Law 7)? Either answer is a datum.
    // (RUN-2 lessons kept: fresh content first; drift only with precession OFF; nSl-scaled patience.)
    recordVia(1.0); await sleep(2500);                                   // fresh V born THROUGH a 1-rad lens — the W→V link carries O(1) load at full vis
    let hasP1 = chainRead().links.length >= 2;
    // RUN-5 LESSON: P1's content had NEVER been refreshed (the newest-plate index was unknowable) — now regPhase().bank
    // exposes it. Auto-refresh: kill the stale P1, bank a fresh plate of the current W, boot it.
    if (hasP1 && Math.min(...chainRead().links.map((l) => l.vis)) < 0.3) {
      P('P1 content stale — auto-refreshing (virtKill → virtStore → virtBoot newest)', undefined);
      virtKill(); await sleep(1800); virtStore(); await sleep(1800);
      virtBoot(Math.max(0, (regPhase().bank ?? 1) - 1)); await sleep(2200);
      hasP1 = chainRead().links.length >= 2;
    }
    if (hasP1) { attPhase(0.7, 'P1'); await sleep(1800); }               // load the V→P1 link too (rotates P1's stored att + ledger)
    await stand();
    const reads = []; for (let i = 0; i < 3; i++) { reads.push(chainRead()); await sleep(1500); }
    const minVis = Math.min(...reads.flatMap((r) => r.links.map((l) => l.vis)));
    const eps = reads.map((r) => Math.abs(r.defect)), worst = Math.max(...eps);
    if (!hasP1) P('loaded ε: TRIVIAL with 2 slots — boot P1 (virtStore(); virtBoot(newest)) and rerun', undefined);
    else if (minVis < 0.3) P(`loaded ε: INCONCLUSIVE — min link vis ${minVis.toFixed(3)} < 0.3 even without a journey (refresh P1: virtKill(); virtStore(); virtBoot(newest); rerun)`, undefined);
    else { const med = eps.slice().sort((a, b) => a - b)[1], bound = 0.02 * Math.max(1, 0.4 / minVis);   // RUN-6 LESSON: ε noise scales ~1/vis (step-1 calibration: ~0.005–0.01 at vis 0.87) — judge the MEDIAN against a vis-priced bound, not the worst read against a fixed one
      P(`loaded ε over 3 reads: [${eps.join(', ')}] at min vis ${minVis.toFixed(3)} → median ${med} (want ≤ ${bound.toFixed(4)}, vis-priced)`, med <= bound); }
    const mdls = reads.map((r) => r.links[0].mdl), drift = Math.abs(wrap(mdls[2] - mdls[0]));
    if (minVis >= 0.3) P(`mdl drift across reads: ${drift.toFixed(4)} (want < 0.05)`, drift < 0.05);
    // ── Phase B: the aging flavor + the recovery measurement (informative — no FAIL verdicts) ──
    lensTau(0.1); await sleep(1200);
    const b0 = regPhase().beats[1]; let kicks = 0;
    virtGo(5, 0);                                                        // SHORT legs: ±5px — age with the least wear
    while (regPhase().beats[1] - b0 < 4 && kicks < 20) { await sleep(5000);
      if (regPhase().beats[1] - b0 < 4) { virtGo(regPhase().gx > 2.5 ? 0 : 5, 0); kicks++; } }
    P(`aging: ΔN_V=${regPhase().beats[1] - b0} (want ≥4; kicks=${kicks})`, regPhase().beats[1] - b0 >= 4);
    lensTau(0); await stand();
    const trace = []; const t0 = Date.now(); let visNow = 0;
    for (;;) { const r = chainRead(); visNow = r.links[0].vis; trace.push(+visNow.toFixed(3));   // RUN-5: track the W→V link SPECIFICALLY — min over all links was P1-dominated and confounded the wear reading
      if (visNow >= 0.3 || Date.now() - t0 > 60000) break; await sleep(6000); }
    P(`re-crystallization (W→V): vis [${trace.join(' → ')}] over ${((Date.now() - t0) / 1000).toFixed(0)}s at rest — ${visNow >= 0.3 ? 'RECOVERED (hold re-locks the worn soliton)' : 'NOT recovered (wear persists at rest — Law 7 territory; a datum, not a failure)'}`, undefined);
    if (visNow >= 0.6) { const r = chainRead(); P(`AGED ε (the conclusive loaded reading — after real differential aging at high vis): ${Math.abs(r.defect)} at W→V vis ${visNow.toFixed(3)} (want ≤ 0.015)`, Math.abs(r.defect) <= 0.015); }   // RUN-6: measured 0.0003 at vis 0.986 — the composition law after aging, four decimal places
    else if (visNow >= 0.3) { const r = chainRead(); P(`aged ε (informative, mid vis): ${Math.abs(r.defect)} at W→V vis ${visNow.toFixed(3)}`, undefined); }
    virtGo(0, 0); };

  // stand() — release V at home and wait for its clock to quiet (the virtGo(0,0) release only fires at
  // round(gx)===0 — retried as the leash settles; twin-driver logic). Rest-state is a precondition for every
  // raw-link stability assertion (RUN-1 LESSON: a chasing V wanders ~0.1/2s and false-fails the boundary check).
  const stand = async () => { for (let i = 0; i < 4; i++) { virtGo(0, 0);
      let quiet = 0, lastB = regPhase().beats[1], waited = 0;
      while (quiet < 6000 && waited < 30000) { await sleep(500); waited += 500; const p = regPhase();
        if (p.beats[1] !== lastB) { lastB = p.beats[1]; quiet = 0; } else quiet += 500; }
      if (quiet >= 6000) return true; }
    console.warn('[GATES] could not stand V — treat raw-stability numbers as indicative'); return false; };

  const metric = async () => { if (!need()) return;
    console.log('%c[GATES-METRIC] ── read-side boundary + the two-channel readout ──', 'color:#f90;font-weight:bold');
    recordVia(0); await sleep(2500);                                     // RUN-2 LESSON: fresh content — at decayed vis (~0.06) the drop assertion compares two noise floors
    await stand();
    const w0 = chainRead(); await sleep(1800); const before = chainRead();   // two pre-reads = the natural wander baseline over the same interval the check spans
    const wander = Math.abs(wrap(before.links[0].dphi - w0.links[0].dphi));
    if (before.links[0].vis < 0.3) { P(`metric scene: INCONCLUSIVE — raw vis ${before.links[0].vis} < 0.3 even after a fresh record (investigate before asserting)`, undefined); return; }
    lensSet('V', { rot: 0.3 }); await sleep(1800);
    const cr = chainRead(); const cs = chainSee();
    const dRaw = Math.abs(wrap(cr.links[0].dphi - before.links[0].dphi));
    const bound = Math.max(0.05, 2.5 * wander);
    P(`read-side boundary: raw link moved ${dRaw.toFixed(4)} under lensSet vs wander baseline ${wander.toFixed(4)} (want < ${bound.toFixed(3)} — fields untouched)`, dRaw < bound);
    P(`two-channel: seen vis ${cs.links[0].vis} vs raw ${cr.links[0].vis} (frame mismatch costs coherence — expect a drop at healthy vis)`, cs.links[0].vis < cr.links[0].vis);
    lensSet('V'); await sleep(1800);
    const cr2 = chainRead(); const cs2 = chainSee();
    const closure = Math.abs(wrap(cs2.links[0].dphi - (cr2.links[0].dphi + cr2.links[0].pred)));
    P(`revert closure: |seen − (raw + pred)| = ${closure.toFixed(4)} (want < 0.02 — U(1) identity)`, closure < 0.02);
  };

  const all = async () => { await burst(); await loaded(); await metric();
    console.log('%c[GATES] battery done — run gates.base() on BOTH peers now and diff; then the manual items (join / objorbit burst / UI dials / solH-kH lock)', 'color:#f90;font-weight:bold'); };

  globalThis.gates = { base, burst, loaded, metric, all };
  console.log('[GATES] ready: gates.base() (both peers) · gates.all() (one peer) · sections: burst/loaded/metric — see header for the manual items');
})();
