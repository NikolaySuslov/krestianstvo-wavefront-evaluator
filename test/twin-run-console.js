// THE CONTROLLED TWIN RUN — path-dependent proper time, read as an interference phase
// (doc/proper-time-metric.md §10; the ω·τ_i lens as clock comparator).
// Paste into ONE peer's console (replicated verbs — the other peer observes solH/kH).
// Prerequisites: transport world, selfClock+mux on (V recorded, HOLD on), W parked (no attPhase writes).
//
// Protocol: stand both clocks → mark the baseline → send V out and back (two legs) → RELEASE at home
// (with the traveling clock, arrival does NOT stop time — an observer still holding a command is still
// living it; only release stands the clock) → stand → read out. The phase ledger is telescoped-unwrapped
// through the ENTIRE run, so the mod-2π ambiguity never enters. Predictions:
//   · leg slopes:  Δφ/ΔN ≈ ω on BOTH legs, SAME SIGN (precession is ∫ω·dτ — monotone: the return leg
//     ADDS, it never retraces; that asymmetry between path and clock IS the twin paradox);
//   · the stay-home twin: ΔN_W = 0 and Δφ_W ≈ 0 (± baseline wander);
//   · the headline: Δφ_V = ω·ΔN_V — the traveling twin's extra age, as a register phase.
(async () => {
  if (globalThis.__twinRun || globalThis.__omegaSweep) return console.warn('[TWIN] another lensTau experiment is running (or a stale flag) — wait, or delete globalThis.__twinRun / __omegaSweep');
  globalThis.__twinRun = true;
  // ── PARAMETERS ─────────────────────────────────────────────────────────────
  const OMEGA   = 0.1;    // rad/beat (keep well under the measured no-floor range ≤ 0.45)
  const LEG     = 12;     // px out-and-back amplitude (≥ ~LEG beats per leg via the 1px/beat leash)
  const POLL_MS = 300;
  const STAND_S = 20;     // "clock standing" = no V beat for this long
  const KICK_S  = 12;     // mid-journey stall → re-issue virtGo (command-fresh)
  const TOL     = 0.03;
  // ───────────────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let pv = null, pw = null, accV = 0, accW = 0;                       // telescoped phase ledgers (V + the W control arm)
  const tick = () => { const p = regPhase();
    if (p.V !== null) { if (pv !== null) accV += norm(p.V - pv); pv = p.V; }
    if (p.W !== null) { if (pw !== null) accW += norm(p.W - pw); pw = p.W; }
    return p; };
  const waitArrive = async (tgt, label) => { let quiet = 0, lastB = tick().beats[1];
    for (;;) { await sleep(POLL_MS); const p = tick();
      if (p.beats[1] !== lastB) { lastB = p.beats[1]; quiet = 0; } else quiet += POLL_MS;
      if (Math.abs(p.gx - tgt) < 0.6) return p;
      if (quiet > KICK_S * 1000) { virtGo(tgt, 0); quiet = 0; console.log(`[TWIN] kick (${label}, gx=${p.gx.toFixed(1)}→${tgt})`); } } };
  // release + stand, with retries: the virtGo(0,0) release only fires if round(gx)===0 at the drain — the
  // leash may still be easing (gx≈0.5 rounds to 1 → silent no-op → the chase keeps beating forever). Re-issue
  // as it settles; each retry is a legitimate command.
  const releaseAndStand = async (label) => { for (let i = 0; i < 5; i++) {
      virtGo(0, 0);
      let quiet = 0, lastB = tick().beats[1], waited = 0;
      while (quiet < STAND_S * 1000 && waited < 60000) { await sleep(POLL_MS); waited += POLL_MS; const p = tick();
        if (p.beats[1] !== lastB) { lastB = p.beats[1]; quiet = 0; } else quiet += POLL_MS; }
      if (quiet >= STAND_S * 1000) { console.log(`[TWIN] V's clock standing (${label})`); return tick(); }
      console.log(`[TWIN] still beating after release try ${i + 1} (${label}) — re-releasing`); }
    console.warn('[TWIN] could not stand the clock — proceeding (treat the readout as indicative)'); return tick(); };
  console.log(`%c[TWIN] controlled twin run — ω=${OMEGA}, leg=${LEG}px out-and-back`, 'color:#f90;font-weight:bold');
  // 0 — home, RELEASED, standing (the marked baseline; lensTau off until the mark so nothing pre-precesses)
  lensTau(0); await sleep(800);
  let p = tick();
  if (Math.abs(p.gx) > 0.6) { virtGo(0, 0); await waitArrive(0, 'pre-home'); }
  await releaseAndStand('baseline');
  lensTau(OMEGA); await sleep(1500);
  const t0 = tick(); const b0 = t0.beats[1], w0 = t0.beats[0]; accV = 0; accW = 0;
  console.log(`[TWIN] baseline marked — beats V=${b0} W=${w0}; departing`);
  // 1 — the outbound leg
  virtGo(LEG, 0); const pOut = await waitArrive(LEG, 'out');
  const bOut = pOut.beats[1], accOut = accV;
  console.log(`[TWIN] turnaround — leg1 ΔN=${bOut - b0} Δφ=${accOut.toFixed(3)}`);
  // 2 — the return leg + release + stand
  virtGo(0, 0); await waitArrive(0, 'home');
  const pEnd = await releaseAndStand('post-journey');                  // release at home — ONLY this stands the clock (retried as the leash settles)
  lensTau(0);
  const bEnd = pEnd.beats[1], wEnd = pEnd.beats[0];
  // ── readout ────────────────────────────────────────────────────────────────
  const dN1 = bOut - b0, dN2 = bEnd - bOut, dN = bEnd - b0, dNW = wEnd - w0;
  const s1 = dN1 ? accOut / dN1 : NaN, s2 = dN2 ? (accV - accOut) / dN2 : NaN, s = dN ? accV / dN : NaN;
  const monotone = dN1 && dN2 && Math.sign(s1) === Math.sign(s2);
  const track = dN && Math.abs(Math.abs(s) - OMEGA) < TOL;
  console.log(`%c[TWIN] leg 1 (out):  ΔN=${dN1}  Δφ=${accOut.toFixed(3)}  slope=${(s1 || 0).toFixed(4)}`, 'color:#9cf');
  console.log(`%c[TWIN] leg 2 (home): ΔN=${dN2}  Δφ=${(accV - accOut).toFixed(3)}  slope=${(s2 || 0).toFixed(4)}  ${monotone ? '(same sign — the return ADDS: no retrace)' : '⚠ sign flipped — investigate'}`, 'color:#9cf');
  console.log(`%c[TWIN] traveling twin V: aged ΔN=${dN} beats → Δφ_V=${accV.toFixed(3)} vs ω·ΔN=${(OMEGA * dN).toFixed(3)} · ${track ? 'MATCH' : '⚠ off'}`, track ? 'color:#9f9;font-weight:bold' : 'color:#f66;font-weight:bold');
  console.log(`%c[TWIN] stay-home twin W: aged ΔN=${dNW} beats (expect 0) · Δφ_W=${accW.toFixed(3)} (baseline wander only)`, dNW === 0 ? 'color:#9f9' : 'color:#f66');
  console.log(`[TWIN] the register read the age difference: Δφ = ω·(τ_V − τ_W) = ${(OMEGA * (dN - dNW)).toFixed(3)} predicted, ${accV.toFixed(3)} measured — path-dependent proper time as an interference phase`);
  globalThis.__twinRun = false;
  return { omega: OMEGA, leg1: { dN: dN1, dPhi: +accOut.toFixed(3), slope: +(s1 || 0).toFixed(4) },
           leg2: { dN: dN2, dPhi: +(accV - accOut).toFixed(3), slope: +(s2 || 0).toFixed(4) },
           total: { dN, dPhi: +accV.toFixed(3), predicted: +(OMEGA * dN).toFixed(3) }, W: { dN: dNW, dPhi: +accW.toFixed(3) } };
})();
