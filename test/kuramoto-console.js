// KURAMOTO-OF-CLOCKS v5 — P_lock(κ): the consensus statistics of coupled proper-time clocks
// (doc/proper-time-metric.md §11). Paste into ONE peer's console (replicated verbs; the other peer
// observes solH/kH — the whole experiment must stay byte-locked).
// Prerequisites: transport world, selfClock+mux on (V recorded, HOLD on), W parked.
//
// v5 lessons (run 3, 2026-07-11 — the run that killed the single-κ_c picture):
//  · MULTISTABILITY: identical dials, clean baselines, different outcomes (run 2 locked only −0.15; run 3
//    locked −0.1/−0.15 and freed −0.2/−0.3). The attractor (lock-π / free / entrained / suppressed) is
//    chosen by the phase configuration at coupling switch-on, unrepeatable by construction (GAUGE wander).
//    The honest observable is P_lock(κ) over repeated encounters → v5 repeats each κ point REPS× with a
//    re-baseline between, and prints the per-κ aggregate (lock fraction + attractor labels).
//  · BEATLESS PHASE SLIP: whole radians of rel accumulated before the FIRST beat (4.7/6.3/10.4 rad in run
//    3) — the edge torque acts on the fields every mux step; the beat/τ layer is a threshold detector on
//    top (integrate-and-fire clocks). v5 SPLITS each point at the first beat: relJump (the transient) is
//    reported separately, and sRel/cyc/exc/pred are STEADY-STATE (from the first beat onward).
//  · CLOCK SUPPRESSION (oscillator death): κ=−0.1 held V's clock still ~90 s from a clean start. v5
//    reports tFirst (seconds to the first beat) per rep; a rep with no beat at all = SUPPRESSED.
// PACING: control + 4κ × REPS points ≈ 30–60 min total pending. Progress prints per beat.
// Abort anytime: globalThis.__kuramotoStop = true (finally restores all dials).
//
// The setup: lensTau(ω) gives a slot ω rad of pin-reference precession per ITS OWN beat; V journeys and
// beats, W stands parked — proper-time detuning by construction. edge(W,V,κ) is the channel. Verdicts:
// LOCK-π/LOCK-0 (plateau, basin), LOCK-1:1 (plateau + winding ≥0.9 — time transfer), FREE, PULLED, MIXED
// (rate entrained yet phase slipping), SUPPRESSED, CAP. Multi-observer reading: above threshold, consensus
// is PER-ENCOUNTER PROBABILISTIC — P_lock(κ) is the law. β×1 stiff-pin slice; refAmp('V',0.67) = next axis.
(async () => {
  if (globalThis.__kuramoto || globalThis.__omegaSweep || globalThis.__twinRun) return console.warn('[KURAMOTO] another lensTau/edge experiment is running (or a stale flag) — wait, or delete globalThis.__kuramoto/__omegaSweep/__twinRun');
  if (typeof regPhase !== 'function' || typeof edge !== 'function' || typeof lensTau !== 'function' || typeof virtGo !== 'function')
    return console.warn('[KURAMOTO] preflight: verbs missing — wrong world/app (need the transport medium)');
  { const p = regPhase(); if (!p || !Array.isArray(p.beats)) return console.warn('[KURAMOTO] preflight: regPhase has no beats[] — τ kernel not live');
    if (p.V === null) return console.warn('[KURAMOTO] preflight: no V register — record V + mux first');
    if (p.W === null) return console.warn('[KURAMOTO] preflight: no W field'); }
  globalThis.__kuramoto = true; globalThis.__kuramotoStop = false;
  // ── PARAMETERS ─────────────────────────────────────────────────────────────
  const OMEGA     = 0.1;                          // rad/beat detuning
  const KSIGN     = -1;                           // edge sign convention
  const KAPPAS    = [0, 0.1, 0.15, 0.2, 0.3];     // |κ| ladder; 0 = in-run control (1 rep)
  const REPS      = 3;                            // encounters per κ≠0 point → P_lock statistics
  const CTRL_BEATS = 20;
  const MIN_BEATS = 15;                           // steady-state beats: never judge on less
  const MAX_BEATS = 60;                           // total-beat cap per rep (REPS× makes long caps expensive)
  const SLIP_CYC  = 2;                            // steady-state slip cycles for a trustworthy FREE/PULLED
  const LOCK_W    = 10;                           // trailing window (beats) for slope/winding/R
  const PLATEAU   = 0.025;                        // |trailing rel slope| below this = plateau (0.25·ω)
  const PLAT_N    = 3;                            // consecutive plateau reads → LOCKED exit
  const REST_S    = 12;                           // re-baseline: V quiet this long = clock standing
  const LEG       = 12;
  const POLL_MS   = 300;
  const STALL_S   = 9;
  const MAX_KICKS = 12;
  const MAX_S     = 420;                          // wall cap per rep
  const TOL       = 0.02;
  // ───────────────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const target = () => (regPhase().gx > LEG / 2 ? 0 : LEG);
  const conc = (arr) => { let s = 0, c = 0; for (const x of arr) { s += Math.sin(x); c += Math.cos(x); } return arr.length ? Math.hypot(s, c) / arr.length : 0; };
  const lsq = (ys) => { const n = ys.length; if (n < 2) return 0; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; }
    const d = n * sxx - sx * sx; return d ? (n * sxy - sx * sy) / d : 0; };
  const rebase = async (label) => { edge('W', 'V', 0);
    for (let i = 0; i < 5; i++) { virtGo(0, 0);
      let quiet = 0, lastB = regPhase().beats[1], waited = 0;
      while (quiet < REST_S * 1000 && waited < 60000) { await sleep(POLL_MS); waited += POLL_MS; const p = regPhase();
        if (p.beats[1] !== lastB) { lastB = p.beats[1]; quiet = 0; } else quiet += POLL_MS; }
      if (quiet >= REST_S * 1000) return true;
      console.log(`[KURAMOTO] rebase: V still beating, re-releasing (${label})`); }
    console.warn(`[KURAMOTO] rebase FAILED (${label}) — proceeding; row marked dirty`); return false; };
  const rows = [];
  // ── one encounter: rebase → couple → measure (transient split at the first beat) ──────────────────────
  const measure = async (kappa, ctrl, rep) => {
    const clean = await rebase(`κ=${kappa} rep${rep}`);
    if (globalThis.__kuramotoStop) return { stopped: true };
    edge('W', 'V', kappa); await sleep(1500);
    const p0 = regPhase(); const b0 = p0.beats[1], w0 = p0.beats[0];
    let pv = p0.V, pw = p0.W, accV = 0, accW = 0;
    let last = b0, quiet = 0, kicks = 0, tgt = target(), t0 = Date.now(), lastSay = t0;
    const relB = [], wB = [], offB = [];
    let mark = null, slope = NaN, wind = NaN, platCnt = 0, lockedExit = false, selfOsc = 0, stopped = false;
    virtGo(tgt, 0);
    for (;;) {
      if (globalThis.__kuramotoStop) { stopped = true; break; }
      await sleep(POLL_MS);
      const p = regPhase();
      if (p.V !== null) { accV += norm(p.V - pv); pv = p.V; }
      if (p.W !== null) { accW += norm(p.W - pw); pw = p.W; }
      const nb = p.beats[1] !== last;
      if (nb) { last = p.beats[1]; quiet = 0; } else quiet += POLL_MS;
      const dN = last - b0;
      if (nb) { lastSay = Date.now();
        if (!mark) mark = { rel: accV - accW, accV, accW, bV: last, bW: p.beats[0], t: +((Date.now() - t0) / 1000).toFixed(0) };   // the transient/steady-state split
        relB.push(accV - accW); wB.push(p.beats[0] - w0);
        if (p.V !== null && p.W !== null) offB.push(norm(p.V - p.W));
        if (Math.abs(p.gx - tgt) < 0.6) selfOsc++;                      // noise floor ≈3 (arrival coincidences); only large values meaningful
        if (relB.length > LOCK_W) {
          slope = lsq(relB.slice(-(LOCK_W + 1)));
          wind = (wB[wB.length - 1] - wB[wB.length - 1 - LOCK_W]) / LOCK_W;
          platCnt = Math.abs(slope) < PLATEAU ? platCnt + 1 : 0;
        }
        console.log(`[KURAMOTO] κ=${kappa} r${rep}: ΔN=${dN}/${ctrl ? CTRL_BEATS : MAX_BEATS} relS=${((accV - accW) - mark.rel).toFixed(3)} slope=${isNaN(slope) ? '—' : slope.toFixed(4)} wind=${isNaN(wind) ? '—' : wind.toFixed(2)} gx=${p.gx.toFixed(1)}`); }
      else if (Date.now() - lastSay > 15000) { lastSay = Date.now();
        console.log(`[KURAMOTO] κ=${kappa} r${rep}: … waiting for a beat (ΔN=${dN}, quiet ${(quiet / 1000).toFixed(0)}s, gx=${p.gx.toFixed(1)})${mark ? '' : ' — still in the suppressed window'}`); }
      if (dN < (ctrl ? CTRL_BEATS : MAX_BEATS) && quiet > STALL_S * 1000) {
        if (++kicks > MAX_KICKS) break;
        if (Math.abs(p.gx - tgt) < 1) tgt = target();
        virtGo(tgt, 0); quiet = 0;
        console.log(`[KURAMOTO] κ=${kappa} r${rep}: kick ${kicks} (ΔN=${dN}, gx=${p.gx.toFixed(1)}→${tgt})`);
      }
      const dNs = mark ? last - mark.bV : 0;
      const cycS = mark ? Math.abs((accV - accW) - mark.rel) / (2 * Math.PI) : 0;
      if (!ctrl && dNs >= MIN_BEATS && platCnt >= PLAT_N) { lockedExit = true; break; }
      if (ctrl ? dN >= CTRL_BEATS : (cycS >= SLIP_CYC && dNs >= MIN_BEATS) || dN >= MAX_BEATS) break;
      if (Date.now() - t0 > MAX_S * 1000) break;
    }
    // ── readout: steady-state stats from the first beat; the transient reported as relJump/wJump/tFirst ──
    const pE = regPhase(); const dN = last - b0, dNW = pE.beats[0] - w0;
    const dNs = mark ? last - mark.bV : 0, dNWs = mark ? pE.beats[0] - mark.bW : 0;
    const relS = mark ? (accV - accW) - mark.rel : 0;
    const sRelS = dNs ? relS / dNs : NaN, sVs = (mark && dNs) ? (accV - mark.accV) / dNs : NaN, sWs = (mark && dNs) ? (accW - mark.accW) / dNs : NaN;
    const predS = dNs ? OMEGA * (dNs - dNWs) / dNs : NaN;
    const cycS = Math.abs(relS) / (2 * Math.PI);
    const R = conc(offB.slice(-LOCK_W));
    const off = offB.length ? Math.atan2(offB.slice(-LOCK_W).reduce((a, x) => a + Math.sin(x), 0), offB.slice(-LOCK_W).reduce((a, x) => a + Math.cos(x), 0)) : NaN;
    const label = !mark ? 'SUPPRESSED (no beats — oscillator death)'
      : ctrl ? (Math.abs(Math.abs(sRelS) - OMEGA) < TOL && dNW === 0 ? 'CONTROL OK' : '⚠ CONTROL OFF — do not trust this run')
      : lockedExit ? (wind >= 0.9 ? 'LOCK-1:1 (time transfer)' : Math.abs(off) > Math.PI / 2 ? 'LOCK-π' : 'LOCK-0')
      : cycS >= SLIP_CYC ? (predS > 0.02 ? (Math.abs(sRelS) < 0.7 * predS ? 'PULLED' : 'FREE') : 'MIXED (rate entrained, phase slipping)')
      : `CAP (slope=${isNaN(slope) ? '?' : slope.toFixed(4)} vs pred=${(predS || 0).toFixed(4)})`;
    const row = { kappa, rep, clean, tFirst: mark ? mark.t : null, relJump: +(mark ? mark.rel : 0).toFixed(3), wJump: mark ? mark.bW - w0 : dNW,
      dNs, dNWs, wind: +((isNaN(wind) ? (dNs ? dNWs / dNs : 0) : wind)).toFixed(2), cycS: +cycS.toFixed(2), slope: +(isNaN(slope) ? 0 : slope).toFixed(4),
      sRelS: +(sRelS || 0).toFixed(4), predS: +(predS || 0).toFixed(4), excS: +((sVs || 0) - OMEGA).toFixed(4), R: +R.toFixed(3), off: +(off || 0).toFixed(3),
      selfOsc, kicks, label };
    rows.push(row);
    console.log(`%c[KURAMOTO] κ=${kappa} r${rep}${clean ? '' : ' (DIRTY)'}: tFirst=${row.tFirst}s relJump=${row.relJump} wJump=${row.wJump} · ΔNs=${dNs} ΔNWs=${dNWs} wind=${row.wind} cycS=${row.cycS} slope=${isNaN(slope) ? '—' : slope.toFixed(4)} sRelS=${row.sRelS} predS=${row.predS} excS=${row.excS} off=${row.off} · ${label}`,
      label.startsWith('LOCK') ? 'color:#9f9;font-weight:bold' : label.startsWith('⚠') || label.startsWith('SUPPRESSED') ? 'color:#f66;font-weight:bold' : 'color:#9cf');
    return { stopped, locked: lockedExit, label };
  };
  console.log(`%c[KURAMOTO v5] P_lock(κ) at ω=${OMEGA} — ${REPS} encounters per κ, transient split at the first beat (~30–60 min); abort: globalThis.__kuramotoStop=true`, 'color:#f90;font-weight:bold');
  try {
    lensTau(OMEGA); await sleep(1200);
    sweep: for (const kMag of KAPPAS) {
      const kappa = KSIGN * kMag, ctrl = kMag === 0;
      for (let rep = 1; rep <= (ctrl ? 1 : REPS); rep++) {
        const r = await measure(kappa, ctrl, rep);
        if (r.stopped) { console.warn('[KURAMOTO] aborted by __kuramotoStop'); break sweep; }
      }
    }
  } finally {
    edge('W', 'V', 0); virtGo(0, 0); lensTau(0);                        // ALWAYS restore the dials — error/abort included
    globalThis.__kuramoto = false;
  }
  console.table(rows);
  const agg = [];                                                       // the law: P_lock(κ) + the attractor census per κ
  for (const kMag of KAPPAS.slice(1)) { const k = KSIGN * kMag, rs = rows.filter((r) => r.kappa === k);
    if (rs.length) agg.push({ kappa: k, reps: rs.length, P_lock: +(rs.filter((r) => r.label.startsWith('LOCK')).length / rs.length).toFixed(2),
      attractors: rs.map((r) => r.label.split(' ')[0]).join(' | '), meanTFirst: +(rs.reduce((a, r) => a + (r.tFirst ?? 0), 0) / rs.length).toFixed(0),
      meanRelJump: +(rs.reduce((a, r) => a + Math.abs(r.relJump), 0) / rs.length).toFixed(2) }); }
  console.table(agg);
  console.log('[KURAMOTO] done — P_lock(κ) + attractor census above; relJump/tFirst columns = the transient laws (beatless slip, suppression time); verify solH/kH stayed locked on the second peer');
  return { rows, agg };
})();
