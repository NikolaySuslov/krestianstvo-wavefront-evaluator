// ω-SWEEP DRIVER v2 — the temporal shatter floor (doc/proper-time-metric.md §10).
// Paste into ONE peer's console (it injects replicated verbs — the other peer just observes solH/kH).
// Prerequisites: transport world, selfClock+mux on (V recorded, HOLD fine), W parked (no attPhase writes).
//
// v2 lessons (first run returned ΔN=0..3 — driver artifacts, not the floor):
//  · a tight HOLD lock stalls the journey at the 1px command-fresh advance (perturbation under the 1e-3 beat
//    grid → no beat → the per-beat leash never takes step 2). Fix: STALL KICK — re-issue virtGo (a legitimate
//    command; command-fresh gives another immediate advance) until beats flow.
//  · each ω point needs ΔN ≥ MIN_BEATS (~10) or free-wander drift (±0.05–0.09/leg) swamps the per-beat slope.
//  · the settle window must span several beat periods (beats arrive every ~3–8 s).
// Slope is a telescoped unwrap (noise cancels; per-sample motion ≪ π holds below and AT the floor, where slip
// shows as slope deficit — the measurement). lensTau(0) restores the register afterwards.
(async () => {
  // CONCURRENCY GUARD — lensTau is WORLD-GLOBAL replicated state: two drivers fight over one dial and mislabel
  // each other's ω (live-caught: identical ΔN/Δφ rows under different ω labels). ONE instance, ONE peer.
  if (globalThis.__omegaSweep) return console.warn('[ω-SWEEP] already running (here or as a stale flag) — wait, or delete globalThis.__omegaSweep');
  globalThis.__omegaSweep = true;
  // ── PARAMETERS ─────────────────────────────────────────────────────────────
  const OMEGAS    = [0.1, 0.2, 0.3, 0.45];  // rad/beat (model clamp ±0.5); bracket finer around a suspected floor
  const MIN_BEATS = 10;      // per ω point — the slope's denominator (signal ω·MIN_BEATS ≫ drift)
  const LEG       = 12;      // px journey amplitude (targets auto-picked ≥ LEG/2 away from current gx)
  const POLL_MS   = 300;     // sample cadence (phase unwrap + beat watch)
  const STALL_S   = 9;       // no beat for this long while under MIN_BEATS → kick (re-issue virtGo)
  const MAX_KICKS = 6;       // per ω point; still stalled after these → report STALLED (itself a datum at high ω)
  const DONE_S    = 25;      // beats reached MIN + no new beat this long → point complete
  const MAX_BEATS = 40;      // hard readout cap — the traveling clock beats continuously under chase, so the quiet-exit may never fire (live: ΔN=404); more beats only sharpen the slope, 40 is plenty
  const TOL       = 0.03;    // |slope|−ω tolerance for the TRACKING verdict
  // ───────────────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const target = () => (regPhase().gx > LEG / 2 ? 0 : LEG);   // always a ≥ LEG/2 px journey from wherever V is
  const results = [];
  console.log('%c[ω-SWEEP v2] start — slope Δφ_V/ΔN per ω (|slope| ≈ ω until the temporal shatter floor)', 'color:#f90;font-weight:bold');
  for (const w of OMEGAS) {
    lensTau(w); await sleep(1500);
    const p00 = regPhase(); const b0 = p00.beats[1];
    let prev = p00.V, acc = 0, last = b0, quiet = 0, kicks = 0, tgt = target();
    virtGo(tgt, 0);
    for (;;) {
      await sleep(POLL_MS);
      const p = regPhase();
      if (p.V !== null) { acc += norm(p.V - prev); prev = p.V; }          // telescoped unwrap
      if (p.beats[1] !== last) { last = p.beats[1]; quiet = 0; } else quiet += POLL_MS;
      const dN = last - b0;
      if (dN < MIN_BEATS && quiet > STALL_S * 1000) {                     // stalled under target → kick
        if (++kicks > MAX_KICKS) break;
        if (Math.abs(p.gx - tgt) < 1) { tgt = target(); }                 // arrived but under-beat → new leg
        virtGo(tgt, 0);                                                   // command-fresh: immediate advance
        console.log(`[ω-SWEEP] ω=${w}: kick ${kicks} (ΔN=${dN}, gx=${p.gx.toFixed(1)}→${tgt})`);
        quiet = 0;
      }
      if (dN >= MIN_BEATS && (quiet > DONE_S * 1000 || dN >= MAX_BEATS)) break;   // enough beats + settled (or the hard cap — the traveling clock rarely goes quiet under chase)
    }
    const dN = last - b0, slope = dN ? acc / dN : NaN;
    const verdict = !dN ? 'STALLED (no beats — at high ω this IS the floor signature)'
      : dN < MIN_BEATS ? `UNDER-SAMPLED (ΔN=${dN} < ${MIN_BEATS} — treat slope as indicative)`
      : Math.abs(Math.abs(slope) - w) < TOL ? 'TRACKING' : '⚠ SLIPPING — near/past the floor';
    results.push({ omega: w, dN, kicks, dPhi: +acc.toFixed(3), slope: +(slope || 0).toFixed(4), verdict });
    console.log(`%c[ω-SWEEP] ω=${w}: ΔN=${dN} kicks=${kicks} Δφ_V=${acc.toFixed(3)} slope=${(slope || 0).toFixed(4)} · ${verdict}`,
      verdict === 'TRACKING' ? 'color:#9f9' : 'color:#f66;font-weight:bold');
  }
  virtGo(0, 0); lensTau(0); globalThis.__omegaSweep = false;
  console.table(results);
  console.log('[ω-SWEEP] done — floor = first ω with |slope| < ω − TOL at full ΔN; verify solH/kH stayed locked on the second peer');
  return results;
})();
