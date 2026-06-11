// ════════════════════════════════════════════════════════════════════════════════════════════════
//  SOLITON ALGEBRA — RESEARCH / NON-LIVE: the CARRIER multiplexing path + the carrier-scene runtime.
//  ------------------------------------------------------------------------------------------------
//  The live app uses TEMPORAL (clock-phase) multiplexing everywhere (regionEventSoliton/
//  regionWaveSoliton via evalSolitonTemporalAt, §7.44/§7.47). These carrier-based solitons and the
//  non-temporal evalSolitonAt runtime are the ORIGINAL scheme — kept for reference / the sparse case,
//  not called by the live render path. defaultWaveCells stays in the main module (regionWaveSoliton
//  also uses it) and is imported here.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { defaultWaveCells } from './soliton-algebra.js';

// EVENT/note soliton: pitch×onset atoms; recovered by per-note energy ratio (§7.23). melodyFn(bar) →
// [{tier,bin}]. nBins fixes bars↔cyc. dropRatio: keep a note if it retains ≥ this fraction of clean energy.
function eventSoliton({ region, melodyFn, nBins, dropRatio = 0.30 }) {
  const barOf = (cyc) => Math.floor(cyc / nBins);
  return {
    kind: 'event',
    region: () => region,
    nBins,
    trueCells: (cyc) => melodyFn(barOf(cyc)),                // cells this bar occupies (for clean ref)
    inject(gpu, g, cyc, barLocalStep) {
      if (barLocalStep !== 0) return;                        // events enter at bar step 0 (full propagation)
      const psi = gpu.readEyePsi();
      for (const ev of melodyFn(barOf(cyc))) for (const c of g.evFoot(ev.tier, ev.bin)) psi[c * 2] += 1.0;
      gpu.setEyePsi(psi);
    },
    // recover from `recon`; `clean` = { 'tier:bin': cleanEnergy } reference the engine computed.
    readout(g, recon, cyc, clean) {
      const cellInt = (t, b) => { let m = 0; for (const c of g.evFoot(t, b)) { const v = recon[c*2]**2 + recon[c*2+1]**2; if (v > m) m = v; } return m; };
      const trueSet = melodyFn(barOf(cyc)), notes = [];
      for (const ev of trueSet) {
        const ratio = cellInt(ev.tier, ev.bin) / ((clean && clean[ev.tier + ':' + ev.bin]) || 1e-12);
        if (ratio >= dropRatio) notes.push({ tier: ev.tier, bin: ev.bin, gain: Math.min(1, Math.sqrt(ratio)) });
      }
      const f1 = trueSet.length ? notes.length / trueSet.length : 0;
      return { kind: 'event', recovered: notes, trueSet, f1 };
    },
  };
}

// CARRIER EVENT soliton (§7.30) — REGION-FREE notes: each note's atom is embedded on a CARRIER and
// spread across the WHOLE grid (no spatial region), so events share every cell with other modalities
// and separate by carrier, not by owning rows. Recovery: demodulate the recon by the carrier, then the
// SAME per-note energy gate as eventSoliton. Confirmed clean for SPARSE content (§7.29: off-diag 0.06).
// carrier = makeCarrier(kx,ky). The note→cell map (evFoot) is unchanged; the carrier just spreads/gathers.
function carrierEventSoliton({ carrier, melodyFn, nBins, dropRatio = 0.30 }) {
  const barOf = (cyc) => Math.floor(cyc / nBins);
  // build the bar's note pattern as a real per-cell field (1 at note cells), then embed on the carrier.
  const notePattern = (g, cyc) => {
    const m = new Float64Array(g.G * g.G);
    for (const ev of melodyFn(barOf(cyc))) for (const c of g.evFoot(ev.tier, ev.bin)) m[c] = 1;
    return m;
  };
  return {
    kind: 'event',
    region: () => carrier,                                   // subspace = the carrier (coherence vs others)
    nBins, carrier,
    trueCells: (cyc) => melodyFn(barOf(cyc)),
    inject(gpu, g, cyc, barLocalStep) {
      if (barLocalStep !== 0) return;                        // enter at bar step 0 (full propagation)
      const psi = gpu.readEyePsi();
      carrier.embed(psi, notePattern(g, cyc), g.G);          // notes·e^{ik·x} across the WHOLE grid
      gpu.setEyePsi(psi);
    },
    // recon → DEMODULATE by carrier → demod field (real per-cell) → per-note energy gate on note cells.
    readout(g, recon, cyc, clean) {
      const demod = carrier.extract(recon, g.G);             // Re(recon·e^{-ik·x}) — gathers this carrier
      const cellE = (t, b) => { let m = 0; for (const c of g.evFoot(t, b)) { const v = demod[c]*demod[c]; if (v > m) m = v; } return m; };
      const trueSet = melodyFn(barOf(cyc)), notes = [];
      for (const ev of trueSet) {
        const ratio = cellE(ev.tier, ev.bin) / ((clean && clean['c:' + ev.tier + ':' + ev.bin]) || 1e-12);
        if (ratio >= dropRatio) notes.push({ tier: ev.tier, bin: ev.bin, gain: Math.min(1, Math.sqrt(ratio)) });
      }
      const f1 = trueSet.length ? notes.length / trueSet.length : 0;
      return { kind: 'event', recovered: notes, trueSet, f1 };
    },
    // clean-energy key uses 'c:' prefix + a DEMODULATED clean reference (the engine calls cleanEnergy).
    cleanKey: (ev) => 'c:' + ev.tier + ':' + ev.bin,
    cleanEnergy(g, cleanRecon, cyc) {                        // engine uses this for the gate's 100% scale
      const demod = carrier.extract(cleanRecon, g.G), out = {};
      for (const ev of melodyFn(barOf(cyc))) { let m=0; for (const c of g.evFoot(ev.tier, ev.bin)){const v=demod[c]*demod[c]; if(v>m)m=v;} out['c:'+ev.tier+':'+ev.bin]=Math.max(1e-12,m); }
      return out;
    },
  };
}

// CARRIER WAVEFORM soliton (§7.31) — sound as a sparse HARMONIC SPECTRUM, region-free on a carrier.
// A waveform's information is a few harmonic amplitudes (a pluck = [1, 0.5, 0.25], not 512 samples) —
// SPARSE in the harmonic domain, so it carrier-multiplexes cleanly (§7.29) unlike the dense raw signal
// (§7.16, which decayed). Each harmonic h is an atom at a dedicated cell carrying its AMPLITUDE; recover
// by demod → read the cell amplitudes → SYNTHESIZE the waveform at the device edge (additive synthesis).
// harmonicsFn(bar) → [a0,a1,...,a_{H-1}] (amplitudes per harmonic). cellsFn(g,H) → H distinct grid cells.
function carrierWaveSoliton({ carrier, harmonicsFn, nBins, cellsFn, dropRatio = 0.30 }) {
  const barOf = (cyc) => Math.floor(cyc / nBins);
  const cells = (g, H) => (cellsFn ? cellsFn(g, H) : defaultWaveCells(g, H));
  return {
    kind: 'wave',
    region: () => carrier,
    nBins, carrier,
    inject(gpu, g, cyc, barLocalStep) {
      if (barLocalStep !== 0) return;
      const amps = harmonicsFn(barOf(cyc)), H = amps.length, cs = cells(g, H);
      const m = new Float64Array(g.G * g.G);
      for (let h = 0; h < H; h++) m[cs[h]] = amps[h];        // amplitude IS the atom value (not 1)
      const psi = gpu.readEyePsi();
      carrier.embed(psi, m, g.G);                            // harmonic atoms · carrier, whole grid
      gpu.setEyePsi(psi);
    },
    // recon → demod → recovered harmonic AMPLITUDE = (demod_h / cleanDemod_h) · trueAmp_h. At occl=0 the
    // ratio is 1 → exact amplitudes; occlusion shrinks the ratio → amplitudes fade (timbre dulls/drops).
    // Gate on the RATIO (presence), but return the actual amplitude VALUE (not a normalized ±1 — that was
    // the bug: dividing by √energy saturated every harmonic to 1, losing the spectrum's shape).
    readout(g, recon, cyc, clean) {
      const demod = carrier.extract(recon, g.G);
      const amps = harmonicsFn(barOf(cyc)), H = amps.length, cs = cells(g, H), out = new Float64Array(H);
      for (let h = 0; h < H; h++) {
        const cd = (clean && clean['w:' + h]) || 1e-12;     // clean demod amplitude at this cell
        const ratio = demod[cs[h]] / cd;                    // 1 at occl=0, <1 as occlusion eats it
        out[h] = (Math.abs(ratio) >= dropRatio) ? ratio * amps[h] : 0;   // recovered amplitude (true·ratio)
      }
      return { kind: 'wave', harmonics: out, trueHarmonics: amps };
    },
    // clean reference = the DEMOD AMPLITUDE (signed) per harmonic cell — so readout can scale recovered→true.
    cleanEnergy(g, cleanRecon, cyc) {
      const demod = carrier.extract(cleanRecon, g.G), amps = harmonicsFn(barOf(cyc)), H = amps.length, cs = cells(g, H), out = {};
      for (let h = 0; h < H; h++) { const v = demod[cs[h]]; out['w:' + h] = (Math.abs(v) > 1e-9 ? v : 1e-9); }
      return out;
    },
  };
}

// ── THE RUNTIME: evaluate a composite Soliton at cyc → live field Ψ(cyc) + readouts. ONE pure-cyc
//    engine; any composite flows through unchanged. Mirrors solitonRenderAt's proven math (clock-pure
//    K-bar recompute → H → back-prop → per-note-ratio readout), driven through the algebra. §7.26
//   opts: { geom, barSteps, reconT, readBars, K, tau, occludeR }
function evalSolitonAt(eye, composite, cyc, opts = {}) {
  const gpu = eye._gpu, G = gpu._G, N = G * G, dt = eye.dt;
  const geom = opts.geom, g = eye._unitedGeom(geom);
  const barSteps = opts.barSteps ?? 40, K = opts.K ?? 3, readBars = opts.readBars ?? 1;
  const nBins = g.nBins, onsetSteps = Math.max(1, Math.round(barSteps / nBins));
  const occludeR = opts.occludeR ?? 0, tau = opts.tau ?? 1.0;
  const nowBar = Math.floor(cyc / nBins);
  const readBar = Math.max(0, nowBar - readBars);
  const curAge = Math.max(0, (cyc - nowBar * nBins)) * onsetSteps;
  const readAge = readBars * barSteps + curAge;
  // PANEL recon back-prop depth. To REFOCUS (return to the source plane, like the cube's symmetric
  // forward-D → back-D), back-prop must equal the FORWARD depth = readAge (the bar matured readAge steps
  // from injection). Old formula readAge·(0.5+τ) at τ=0 (the default) = readAge·0.5 = HALF the focal
  // depth → the image stays SPREAD, never refocuses (the flat-letter "spread with T, stays spread" bug;
  // the cube refocused because it uses back=forward). Fix: readAge·(1+τ) → τ=0 lands EXACTLY on the focal
  // plane (refocused), and τ still racks focus DEEPER (0..1 → 1×..2×) for depth scrubbing. NOTE-recovery
  // recon uses D = recT-dial-or-readAge (the §7.22 crossover lever), unchanged.
  const panelBack = Math.max(1, Math.round(readAge * (1 + tau)));
  const D = Math.max(1, Math.round(opts.reconT ?? readAge));

  // Ψ(cyc): clock-pure recompute of the last K bars, composite.inject staged across each bar.
  const startBar = Math.max(0, nowBar - K + 1);
  gpu.setEyePsi(new Float64Array(2 * N));
  for (let bar = startBar; bar <= nowBar; bar++) {
    const steps = (bar < nowBar) ? barSteps : Math.max(0, (cyc - bar * nBins)) * onsetSteps;
    const barCyc = bar * nBins;                                // bar-start cyc → purity
    for (let s = 0; s <= steps; s++) {
      composite.inject(gpu, g, barCyc, s, barSteps);
      if (s < steps) gpu.stepEyeN(1, dt);
    }
  }
  const field = gpu.readEyePsi();

  // PANEL pair (§7.24): HOLOGRAM (H applied) → RECON (back-prop by panelBack).
  gpu.setEyePsi(field);
  if (occludeR > 0) gpu.applyEyeHologram(eye.hMode || 7, occludeR, { block: eye.hBlock ?? 8, seed: eye.hSeed ?? 0 });
  const holoMasked = gpu.readEyePsi();
  gpu.stepEyeN(panelBack, -dt);
  const viewTau = gpu.readEyePsi();

  // NOTE RECOVERY (§7.23): separate back-prop by D. CLEAN ref (no occ) → per-note clean energy gate,
  // then the OCCLUDED recon — both from the live field at depth D.
  gpu.setEyePsi(field); gpu.stepEyeN(D, -dt);
  const cleanRecon = gpu.readEyePsi();
  let clean = {};
  // each child supplies its OWN clean-energy reference (basis-aware): carrier events demodulate first
  // (cleanEnergy), region events use raw-cell energy (default). Merge all into one `clean` map.
  for (const c of (composite.children || [composite])) {
    if (c.cleanEnergy) { Object.assign(clean, c.cleanEnergy(g, cleanRecon, readBar * nBins)); }
    else if (c.trueCells) {
      for (const ev of c.trueCells(readBar * nBins)) {
        let m = 0; for (const cc of g.evFoot(ev.tier, ev.bin)) { const v = cleanRecon[cc*2]**2 + cleanRecon[cc*2+1]**2; if (v > m) m = v; }
        clean[ev.tier + ':' + ev.bin] = Math.max(1e-12, m);
      }
    }
  }
  gpu.setEyePsi(field);
  if (occludeR > 0) gpu.applyEyeHologram(eye.hMode || 7, occludeR, { block: eye.hBlock ?? 8, seed: eye.hSeed ?? 0 });
  gpu.stepEyeN(D, -dt);
  const noteRecon = gpu.readEyePsi();
  gpu.setEyePsi(field);   // restore live field as the eye buffer

  // readout: EVENTS from the D-depth noteRecon (gated); IMAGE from the panel viewTau.
  const readouts = {};
  for (const c of (composite.children || [composite])) {
    // field-valued children (image, gate/recog/recall) read the panel recon (viewTau); note-valued → noteRecon.
    const fieldValued = (c.kind === 'image' || c.kind === 'gate' || c.kind === 'recog' || c.kind === 'recall');
    readouts[c.kind] = c.readout(g, (fieldValued ? viewTau : noteRecon), readBar * nBins, clean);
  }

  return { field, holoMasked, viewTau, readouts, readBar, readAge, curAge, nowBar, nTiers: g.nTiers, nBins: g.nBins };
}

export { eventSoliton, carrierEventSoliton, carrierWaveSoliton, evalSolitonAt };
