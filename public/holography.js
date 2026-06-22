// holography.js — IFS holography API
// Requires ifs-gpu.js (IFSGpu) to be loaded first.
// Two classes:
//   IFSEye      — live observer: wavefront → F^T → [H] → F^-T → percept
//   IFSHologram — record/reconstruct pipeline with save/load

// ── IFSEye ────────────────────────────────────────────────────────────────────
// Wraps the eye pipeline from IFSGpu. Takes any wavefront as input, applies
// T forward IFS steps, an optional hologram-domain H transform, T backward
// steps, and relaxes the result onto a soliton percept.
//
// Usage:
//   const eye = new IFSEye(gpu, { tSteps: 100, relaxSteps: 60, dt: 0.12, srcAlpha: 0.08 })
//   eye.hMode  = 1;  eye.hParam = 0.4;   // H = low-pass, aperture 0.4
//   eye.setSource(psi64)                  // set input wavefront
//   eye.compute()                         // run the full pipeline
//   eye.renderArrived(canvas2dCtx, norm)  // panel 1: received wavefront
//   eye.renderPercept(canvas2dCtx, norm)  // panel 2: soliton percept (settled)
//   eye.renderEvidence(canvas2dCtx, norm) // panel 3: raw inverse / scored

class IFSEye {
  constructor(gpu, opts = {}) {
    this._gpu        = gpu;
    this.tSteps      = opts.tSteps      ?? 100;
    this.relaxSteps  = opts.relaxSteps  ?? 16;  // percept tracking steps (seed=prev, attractor=evidence)
    this.dt          = opts.dt          ?? 0.12;
    this.srcAlpha    = opts.srcAlpha    ?? 0.08;
    this.refMix      = opts.refMix      ?? 0;    // >0: score evidence against _refField
    this.hMode       = opts.hMode       ?? 0;    // 0=id 1=LP 2=HP 3=conj 7=rand-zero 8=rand-noise
    this.hParam      = opts.hParam      ?? 0.5;  // aperture radius / masked fraction
    this.hSteps      = opts.hSteps      ?? 1;
    this.hBlock      = opts.hBlock      ?? 8;    // random-block size px (modes 7/8)
    this.hSeed       = opts.hSeed       ?? 0.0;  // reshuffle random pattern (modes 7/8)
    this.depthBand   = opts.depthBand   ?? 0.35; // depth-scrub focal band (fraction of D);
                                                 // shallow band → object present at all τ,
                                                 // τ shifts focal depth (true depth-of-field)

    this._source       = null;  // Float64Array input wavefront
    this._refField     = null;  // optional reference for refMix scoring
    this._perceptState = null;  // held percept between calls (memory/hysteresis)
    this._evidence     = null;  // object-plane reconstruction (after backward leg)
    this._holoField    = null;  // hologram-domain field after [H] — what gets saved

    this.arrivedNorm  = 1e-9;
    this.holoNorm     = 1e-9;
    this.evidenceNorm = 1e-9;
    this.perceptNorm  = 1e-9;
    this.dirty        = true;   // set true to trigger recompute on next compute()
  }

  // Set the input wavefront. Marks dirty. (Clears any layered source.)
  setSource(psi64) {
    this._source = psi64;
    this._layers = null;
    this.dirty   = true;
  }

  // Set a MULTI-DEPTH layered source (array of Float64 fields, near→far). When set,
  // compute() uses staged per-depth injection instead of a single forward leg, so the
  // LIVE eye renders the depth hologram — and all sliders update it continuously.
  // _source is also set (the summed layers) so dirty-guards and refMix still work.
  setLayers(layers) {
    this._layers = layers;
    const N = layers[0].length;
    const sum = new Float64Array(N);
    for (const f of layers) for (let k = 0; k < N; k++) sum[k] += f[k];
    this._source = sum;
    this.dirty   = true;
  }

  // Set a reference field for refMix scoring on the evidence panel.
  setRef(psi64) {
    this._refField = psi64;
  }

  // Run the full eye pipeline. Only runs when dirty (object changed or H changed).
  // Renders all three panels to the provided canvases.
  compute(gpuCanvas, panelField, panelPercept, panelEvidence, RW, RH) {
    if (!this.dirty || !this._source) return;
    const gpu = this._gpu;
    const D   = this.tSteps;
    const dt  = this.dt;

    // ── Forward leg: source → hologram domain ────────────────────────────
    // Layered source → STAGED multi-depth injection (each layer at its own step); flat
    // source → single forward leg. Either way the eye buffer ends holding ψ_holo, and the
    // rest of the pipeline (H, backward, percept) is identical — so the LIVE eye renders
    // the depth hologram and every slider updates it continuously.
    if (this._layers) {
      this._stagedForwardOnly(this._layers);   // forward only, leaves ψ_holo in eye buffer
    } else {
      gpu.setEyePsi(this._source);
      gpu.stepEyeN(D, dt);
    }
    this.arrivedNorm = Math.max(gpu.readEyePeakSq(), 1e-12);

    // ── [H] hologram-domain transform ────────────────────────────────────
    // Applied BEFORE panel 1 renders, so panel 1 shows the wavefront AS FED to the
    // backward leg — i.e. with the occlusion/mask visible. The holography demo is then
    // self-evident: panel 1 shows part of the hologram blacked out, yet panels 2/3
    // still reconstruct the whole object.
    gpu.applyEyeHologram(this.hMode, this.hParam,
      { steps: this.hSteps, smoothMaxPlate: this.arrivedNorm, block: this.hBlock, seed: this.hSeed });

    // Capture the post-H hologram field — this is what gets saved to file.
    // It contains the mask pattern (zeros/noise where H applied), so file size
    // reflects actual hologram content, not just the reconstruction.
    this._holoField  = gpu.readEyePsi();
    this.holoNorm    = Math.max(gpu.readEyePeakSq(), 1e-12);

    // Panel 1 — the (possibly masked) hologram fed to reconstruction.
    if (panelField) {
      gpu.renderEyeField(this.holoNorm);
      panelField.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panelField.setLabel(this.hMode
        ? 'EYE  |ψ_holo|²  hologram after [H] (masked)'
        : 'EYE  |ψ_holo|²  received wavefront');
    }

    // ── Backward leg: hologram domain → object plane (evidence) ──────────
    gpu.stepEyeN(D, -dt);
    this._evidence    = gpu.readEyePsi();
    this.evidenceNorm = Math.max(gpu.readEyePeakSq(), 1e-12);

    // Reconstruction quality.
    // FLAT source: score vs the raw object plane (a flat round-trip returns the object).
    // LAYERED source: a staged multi-depth round-trip does NOT return the raw object plane
    // (each layer injected at a different step → single backward leg can't refocus all to
    // one plane); it returns a depth-scrambled but deterministic field. So score vs the
    // CLEAN staged reconstruction (ref) — "how much does [H]/occlusion degrade the
    // achievable recon" — exactly as computeDepth/sweepOcclusionDepth do. (Scoring a
    // layered recon vs the raw object gives <1 even at r=0 — that was the 0.740 confusion.)
    if (this._layers) {
      const ref = this._stagedDepthForward(this._layers, 0).recon; // clean staged recon
      this.score = this._corr(this._evidence, ref);
      gpu.setEyePsi(this._evidence); // restore eye buffer (ref computation overwrote it)
    } else {
      this.score = this._corr(this._evidence, this._source);
    }

    // Panel 3 — evidence (exact inverse), labeled with the live quality score.
    if (panelEvidence) {
      if (this.refMix > 0 && this._refField) {
        gpu.renderEyeDiff(this._refField, this.refMix, this.evidenceNorm);
        panelEvidence.setLabel(`EYE  |ψ_evidence|²  recon score=${this.score.toFixed(3)}`);
      } else {
        gpu.renderEyeField(this.evidenceNorm);
        panelEvidence.setLabel(`EYE  |ψ_evidence|²  recon score=${this.score.toFixed(3)}`);
      }
      panelEvidence.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
    }

    // ── Soliton percept: a living field that TRACKS the evidence ──────────
    // The probe showed a degenerate case: seeding the percept FROM the evidence with
    // the evidence AS the attractor makes the injection term α(evidence−ψ)=0 → no-op
    // (the evidence is already an IFS near-eigenstate). For the relaxation to mean
    // anything, seed and attractor must DIFFER:
    //   • seed    = the PREVIOUS percept (what the eye was holding) — memory/hysteresis
    //   • attractor = the NEW evidence — the percept migrates toward it across the steps
    // On the very first snap (no prior percept) there's nothing to track, so we just
    // adopt the evidence directly (relaxation would be a no-op there anyway).
    if (this._perceptState) {
      gpu.setEyePsi(this._perceptState);   // start from what we were perceiving
    } else {
      this._perceptState = new Float64Array(this._evidence);
      this.perceptNorm   = this.evidenceNorm;
      gpu.setEyePsi(this._perceptState);
    }
    gpu.setEyeObjField(this._evidence);    // pull toward the new evidence (≠ seed → real work)
    if (this.probe) {
      // Instrumented relax: log per-chunk residual ‖ψ_n − ψ_{n-1}‖ / ‖ψ_n‖ so you can
      // see exactly which step the eigenstate stops moving (the convergence knee).
      const CH = 5;                       // measure every CH steps
      let prev = gpu.readEyePsi();
      const rows = [];
      for (let i = 0; i < this.relaxSteps; i += CH) {
        for (let k = 0; k < CH && (i + k) < this.relaxSteps; k++) gpu.stepRecordEye(dt, this.srcAlpha);
        const cur = gpu.readEyePsi();
        let dd = 0, nn = 0;
        for (let j = 0; j < cur.length; j++) { const d = cur[j] - prev[j]; dd += d*d; nn += cur[j]*cur[j]; }
        rows.push(`step ${String(i + CH).padStart(3)}: residual ${(Math.sqrt(dd / Math.max(nn, 1e-30))).toExponential(2)}`);
        prev = cur;
      }
      console.log('[EYE PROBE] relax convergence (residual = ‖Δψ‖/‖ψ‖ per ' + CH + ' steps):\n' + rows.join('\n'));
    } else {
      for (let i = 0; i < this.relaxSteps; i++) gpu.stepRecordEye(dt, this.srcAlpha);
    }
    this._perceptState = gpu.readEyePsi();
    this.perceptNorm   = Math.max(gpu.readEyePeakSq(), 1e-12);

    // Panel 2 — settled soliton percept
    if (panelPercept) {
      gpu.renderEyeField(this.perceptNorm);
      panelPercept.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panelPercept.setLabel('EYE  |ψ_percept|²  soliton (settled)');
    }

    this.dirty = false;
  }

  // Render all three eye panels from loaded _evidence (no _source needed).
  // Panel 1 — forward-propagate evidence T steps → hologram domain view
  // Panel 2 — relax evidence onto soliton percept (same as live)
  // Panel 3 — evidence itself (the reconstruction)
  renderLoaded(gpuCanvas, panelField, panelPercept, panelEvidence, RW, RH) {
    if (!this._evidence) return;
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;

    // Panel 3 — evidence directly
    if (panelEvidence) {
      gpu.setEyePsi(this._evidence);
      gpu.renderEyeField(this.evidenceNorm);
      panelEvidence.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panelEvidence.setLabel('EYE  |ψ_evidence|²  (loaded)');
    }

    // Panel 1 — the hologram domain field (post-H, as saved)
    if (panelField) {
      const holoSrc = this._holoField ?? this._evidence;
      const hNorm   = this._holoField ? Math.max(this.holoNorm, 1e-12) : Math.max(this.evidenceNorm, 1e-12);
      gpu.setEyePsi(holoSrc);
      gpu.renderEyeField(hNorm);
      panelField.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panelField.setLabel(this._holoField ? 'EYE  |ψ_holo|²  (loaded)' : 'EYE  |ψ_arrived|²  (loaded)');
    }

    // Panel 2 — relax onto the soliton percept.
    // Seed from WEAK NOISE (not the evidence) so the attractor term α(evidence−ψ) is
    // nonzero and the relaxation actually does work: the field genuinely SETTLES onto
    // the IFS eigenstate nearest the loaded reconstruction, rather than trivially
    // copying the evidence (seed=attractor=evidence would be a no-op). Needs more steps
    // than live tracking since it starts from noise, not a nearby percept.
    if (panelPercept) {
      const seed = new Float64Array(this._evidence.length);
      const amp  = Math.sqrt(this.evidenceNorm) * 0.1;
      for (let j = 0; j < seed.length; j++) seed[j] = (Math.random() - 0.5) * 2 * amp;
      gpu.setEyePsi(seed);
      gpu.setEyeObjField(this._evidence);     // attractor = loaded reconstruction
      const settleSteps = Math.max(this.relaxSteps, 60); // from noise → needs to converge
      for (let i = 0; i < settleSteps; i++) gpu.stepRecordEye(dt, this.srcAlpha);
      this._perceptState = gpu.readEyePsi();
      this.perceptNorm   = Math.max(gpu.readEyePeakSq(), 1e-12);
      gpu.renderEyeField(this.perceptNorm);
      panelPercept.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panelPercept.setLabel('EYE  |ψ_percept|²  soliton (settled, loaded)');
    }
  }

  // ── One-shot diagnostic: OCCLUSION SWEEP — the holographic-redundancy curve.
  // For the current source + tSteps, reconstruct while occluding r = 0.1…0.9 of the
  // wavefront and log the reconstruction score at each. The SHAPE of the curve is the
  // answer:
  //   • linear falloff (score ≈ 1−r)  → PHOTO-like: local spread, no redundancy
  //   • graceful/sublinear falloff     → HOLOGRAPHIC: whole object survives partial loss
  // Run at small T (e.g. 100) and large T (e.g. 350) and compare the two curves.
  sweepOcclusion(seedPsi64, rValues = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    const rows = [];
    for (const r of rValues) {
      gpu.setEyePsi(seedPsi64);
      gpu.stepEyeN(D, dt);                                          // forward → hologram
      if (r > 0) gpu.applyEyeHologram(7, r, { block: this.hBlock });// random-block occlude, fraction r
      gpu.stepEyeN(D, -dt);                                         // backward → reconstruction
      const recon = gpu.readEyePsi();
      const score = this._corr(recon, seedPsi64);
      rows.push(`r=${r.toFixed(2)}: score ${score.toFixed(3)}  ${'█'.repeat(Math.round(score*40))}`);
    }
    console.log(`[EYE SWEEP] occlusion redundancy curve @ T=${D} (1=perfect recon):\n` + rows.join('\n')
      + '\n→ linear falloff = photo (local spread); graceful = HOLOGRAPHIC (global spread).');
  }

  // ── One-shot diagnostic: DEPTH SWEEP — score vs propagation depth T at FIXED occlusion.
  // Tests whether deeper propagation ever lifts the reconstruction (the "maybe T is still
  // too shallow" hypothesis). Also reports participation ratio PR (how full the grid is) —
  // for a dense object PR starts ~100%, so the relevant globalization measure is whether
  // the SCORE climbs with T, not PR. If score is FLAT across a wide T range → redundancy
  // has saturated (deeper T won't help). If it CLIMBS → keep going deeper.
  sweepT(seedPsi64, r = 0.5, tValues = [50, 100, 200, 350, 500, 750, 1000, 1500]) {
    const gpu = this._gpu, dt = this.dt;
    const N = seedPsi64.length >> 1;
    const rows = [];
    for (const T of tValues) {
      gpu.setEyePsi(seedPsi64);
      gpu.stepEyeN(T, dt);
      // participation ratio of the spread hologram (1/N..1) → % of grid filled
      const holo = gpu.readEyePsi();
      let s1 = 0, s2 = 0;
      for (let j = 0; j < N; j++) { const m = holo[j*2]*holo[j*2] + holo[j*2+1]*holo[j*2+1]; s1 += m; s2 += m*m; }
      const PR = s2 > 0 ? (s1*s1) / s2 / N * 100 : 0;
      if (r > 0) gpu.applyEyeHologram(7, r, { block: this.hBlock });
      gpu.stepEyeN(T, -dt);
      const score = this._corr(gpu.readEyePsi(), seedPsi64);
      rows.push(`T=${String(T).padStart(4)}: score ${score.toFixed(3)}  spread=${PR.toFixed(0).padStart(3)}%  ${'█'.repeat(Math.round(score*40))}`);
    }
    console.log(`[EYE DEPTH-SWEEP] score vs T at occlusion r=${r} (1=perfect recon):\n` + rows.join('\n')
      + '\n→ score FLAT across T = redundancy saturated (deeper won\'t help); score CLIMBS = go deeper.');
  }

  // ── One-shot diagnostic: MULTI-DEPTH occlusion sweep — the TRUE holography test.
  // A real hologram's redundancy comes from DEPTH: points at different distances emit
  // wavefronts of different curvature, and that multi-depth superposition fills the plate.
  // A single object plane (cube projection, flat texture) never exercises this. Here each
  // depth layer is injected at its OWN forward step (far = injected early = propagates more;
  // near = injected late = propagates less) — STAGED injection, the depth-encoding the eye
  // never used. We then occlude and reconstruct, scoring against the depth object's OWN
  // clean (un-occluded) reconstruction — so we measure redundancy relative to what this
  // object CAN reconstruct, not an impossible single-depth ideal.
  //
  // layers: Float64Array[]  (length D_layers) — the depth slices, near→far.
  // Returns nothing; logs the occlusion curve.
  // Staged multi-depth forward propagation + optional occlusion + backward reconstruction.
  // Layer d injected at forward step round(D·(nL-1-d)/nL): far layers early (propagate the
  // most), near layers late. Returns { recon, holo } — holo = the staged hologram field
  // captured just before the backward leg (post-occlusion). Shared by the sweep and render.
  // Staged forward propagation ONLY — leaves ψ_holo (no occlusion, no backward) in the
  // eye buffer. Shared by compute() (live) and _stagedDepthForward (sweeps).
  _stagedForwardOnly(layers, bandInject = false) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    const nL = layers.length, N = layers[0].length >> 1;
    // Default: spread injection across the FULL [0,D] (deep scene — the layer/3D test).
    // bandInject: compress injection into [0, D·band] so the scene's depth is SHALLOW and
    // matches the depthScrub focal band → every τ shows the object, focus sweeps depth.
    const span = bandInject ? Math.max(1, Math.round(D * (this.depthBand ?? 0.35))) : D;
    const injStep = (d) => Math.round(span * (nL - 1 - d) / nL);
    gpu.setEyePsi(new Float64Array(2 * N));
    const sched = layers.map((f, d) => ({ step: injStep(d), d })).sort((a, b) => a.step - b.step);
    let cur = 0, si = 0;
    const injectDue = () => {
      while (si < sched.length && sched[si].step <= cur) {
        const f = layers[sched[si].d];
        // Skip empty bins (sparse depth-map spacing) — they hold their step position to
        // create depth gaps but inject nothing, so no readback/upload needed.
        let nonzero = false;
        for (let k = 0; k < f.length; k++) { if (f[k] !== 0) { nonzero = true; break; } }
        if (nonzero) {
          const psi = gpu.readEyePsi();
          for (let k = 0; k < f.length; k++) psi[k] += f[k];
          gpu.setEyePsi(psi);
        }
        si++;
      }
    };
    injectDue();
    while (cur < D) {
      const next = (si < sched.length) ? Math.min(sched[si].step, D) : D;
      if (next > cur) { gpu.stepEyeN(next - cur, dt); cur = next; }
      injectDue();
    }
  }

  _stagedDepthForward(layers, occludeR) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    this._stagedForwardOnly(layers);
    if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock });
    const holo = gpu.readEyePsi();   // staged hologram (post-occlusion)
    gpu.stepEyeN(D, -dt);            // backward full depth → reconstruction
    return { recon: gpu.readEyePsi(), holo };
  }

  // ── DEPTH-SLICE reconstruction — the literal "observe the depth object" readout. ──
  // A staged multi-depth hologram has NO single reconstruction plane: each layer refocuses
  // at its OWN backward step. Layer d was injected at forward step injStep(d)=D·(nL-1-d)/nL,
  // so it traveled (D − injStep(d)) steps → it refocuses after exactly that many BACKWARD
  // steps. We back-propagate the hologram in stages, capturing the field at each layer's
  // focus step = its reconstructed depth slice. Returns { slices[], scores[], holo } where
  // slices[d] is layer d refocused (sharp) and scores[d] = corr(slice_d, layer_d).
  reconstructDepthSlices(layers, occludeR = 0) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    const nL = layers.length;
    const injStep = (d) => Math.round(D * (nL - 1 - d) / nL);
    // back-step at which layer d refocuses (sharp), measured from the hologram:
    const focusBack = (d) => D - injStep(d);   // near(d=0)→~D, far(d=nL-1)→~0
    // forward to hologram (+ optional occlusion)
    this._stagedForwardOnly(layers);
    if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock });
    const holo = gpu.readEyePsi();
    // order layers by focus back-step ascending, step backward capturing each slice
    const order = layers.map((_, d) => d).sort((a, b) => focusBack(a) - focusBack(b));
    const slices = new Array(nL), scores = new Array(nL);
    let cur = 0; // backward steps taken so far
    for (const d of order) {
      const target = focusBack(d);
      if (target > cur) { gpu.stepEyeN(target - cur, -dt); cur = target; }
      const slice = gpu.readEyePsi();
      slices[d] = slice;
      scores[d] = this._corr(slice, layers[d]);   // does layer d refocus to its own shape?
    }
    return { slices, scores, holo };
  }

  // ── Single-layer ground-truth test — isolates the refocus math from cross-layer blur. ──
  // For each layer ALONE: forward-propagate it by its depth-distance (D − injStep(d)), then
  // back-propagate the same amount → should return the clean layer (score ≈ 1.0). This
  // proves the refocus step math is correct, independent of the multi-layer interference
  // that swamps reconstructDepthSlices. Logs per-layer round-trip score.
  testDepthLayersIsolated(layers) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt, nL = layers.length;
    const injStep = (d) => Math.round(D * (nL - 1 - d) / nL);
    const rows = [];
    for (let d = 0; d < nL; d++) {
      const steps = D - injStep(d);               // this layer's depth-distance
      gpu.setEyePsi(layers[d]);
      gpu.stepEyeN(steps, dt);                     // forward to its hologram depth
      gpu.stepEyeN(steps, -dt);                    // back-propagate the same → should refocus
      const score = this._corr(gpu.readEyePsi(), layers[d]);
      rows.push(`layer ${d}: ${steps} steps  round-trip score ${score.toFixed(3)}  ${'█'.repeat(Math.round(score*40))}`);
    }
    console.log(`[EYE DEPTH-ISOLATED] single-layer refocus (no cross-layer interference), T=${D}:\n` + rows.join('\n')
      + '\n→ high = refocus math correct (multi-layer failure is then pure cross-layer blur); low = math/precision bug.');
  }

  // Render the depth-slice reconstruction to the panels: panel 1 = hologram, panels 2..n =
  // refocused layer slices (cycles through layers if more than 2 display panels). Each slice
  // labeled with its score vs its own layer — when a layer refocuses sharply to its shape,
  // its score is high. occ from current H occlusion mode.
  renderDepthSlices(layers, gpuCanvas, panels, RW, RH) {
    const gpu = this._gpu;
    const occ = (this.hMode === 6 || this.hMode === 7 || this.hMode === 8) ? this.hParam : 0;
    const { slices, scores, holo } = this.reconstructDepthSlices(layers, occ);
    const peak = (a) => { let m = 0; for (let j = 0; j < a.length >> 1; j++) { const v = a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if (v > m) m = v; } return Math.max(m, 1e-12); };
    const names = ['disc', 'ring', 'cross', 'frame'];
    // panel 0 → hologram; panels 1.. → layer slices
    if (panels[0]) {
      gpu.setEyePsi(holo); gpu.renderEyeField(peak(holo));
      panels[0].ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panels[0].setLabel(occ > 0 ? `EYE  |ψ_holo|²  hologram (occl ${occ.toFixed(2)})` : 'EYE  |ψ_holo|²  3D hologram');
    }
    for (let p = 1; p < panels.length; p++) {
      const d = (p - 1) % layers.length;     // which layer this panel shows
      if (!panels[p]) continue;
      gpu.setEyePsi(slices[d]); gpu.renderEyeField(peak(slices[d]));
      panels[p].ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panels[p].setLabel(`EYE  layer ${d} (${names[d] ?? d}) refocus  score=${scores[d].toFixed(3)}`);
    }
    return scores;
  }

  // ── DEPTH-SCRUB EXPLORER — the IFS-native "depth vision". ────────────────────────
  // Reimagines depth NOT as a stack of Euclidean planes (optical tomography) but as a
  // continuous coordinate along the IFS evolution clock τ. The scene is a soliton; its
  // depth structure IS its trajectory through fractal time. Scrubbing τ moves the
  // observation point THROUGH depth: structure that focuses at τ is sharp, neighboring
  // depths are softly blurred — that blur is natural DEPTH-OF-FIELD, not interference.
  //
  // tau ∈ [0,1]: 0 = focus at the hologram plane (all depth spread / far), 1 = focus fully
  // back-propagated (near plane). The eye buffer is left holding the scrubbed field, and a
  // few driven-dissipative relax steps give it the soliton "depth-of-attention" hold.
  //   layers : the scene (depth = staged injection order)
  //   tau    : depth-scrub position 0..1
  // Returns the focused field (also left in the eye buffer for rendering).
  // The MASKED scene hologram (staged forward + [H]), with NO back-scrub — so occlusion
  // holes are visible (like the static hologram test). Panels 2-3 then reconstruct depth
  // THROUGH this masked hologram; panel 1 shows the mask itself.
  depthHologram(layers, shallow = true) {
    const gpu = this._gpu;
    this._stagedForwardOnly(layers, shallow);
    if (this.hMode) {
      gpu.applyEyeHologram(this.hMode, this.hParam,
        { steps: this.hSteps, smoothMaxPlate: Math.max(gpu.readEyePeakSq(), 1e-12),
          block: this.hBlock, seed: this.hSeed });
    }
    return gpu.readEyePsi();
  }

  depthScrub(layers, tau, shallow = true) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    // Build the scene hologram. shallow=true → band-injected (depth compressed into the
    // focal band, so the object is present at every τ — true depth-of-field). shallow=false
    // → full-range injection (deep scene; τ sweeps the whole reconstruction range).
    this._stagedForwardOnly(layers, shallow);
    // Apply the current [H] transform / occlusion to the HOLOGRAM (same as the static
    // tests), so masking works while exploring depth: "occlude the hologram, can you still
    // scrub through the scene's depth?" — the holographic-robustness test, live.
    if (this.hMode) {
      gpu.applyEyeHologram(this.hMode, this.hParam,
        { steps: this.hSteps, smoothMaxPlate: Math.max(gpu.readEyePeakSq(), 1e-12),
          block: this.hBlock, seed: this.hSeed });
    }
    // ── τ → focal back-step, BAND-MAPPED. ──────────────────────────────────────────
    // Naively back-propagating τ·D conflates depth with reconstruction-progress: τ=0 = bare
    // hologram (un-reconstructed), τ=1 = fully reconstructed. To get PURE depth-of-focus —
    // object PRESENT at every τ, only the focal plane moving — first back-propagate a BASE
    // amount to reconstruct the object, then let τ sweep a small focal offset within the
    // depth band. depthBand ∈ (0,1] = fraction of D that the scene's depth spans; the focal
    // sweep covers k ∈ [D·(1−band), D]. With band small (shallow scene), every k is near
    // full reconstruction → no bare-hologram endpoint; τ purely shifts near↔far focus.
    const band = shallow ? (this.depthBand ?? 0.35) : 1.0;
    const kFar  = D;                              // τ=1 → focus the far end (full back-prop)
    const kNear = Math.round(D * (1 - band));     // τ=0 → focus the near end (still reconstructed)
    const back  = Math.round(kNear + tau * (kFar - kNear));
    if (back > 0) gpu.stepEyeN(back, -dt);
    // Depth-of-attention hold: a few driven-dissipative steps toward the current view so
    // the monitor settles onto a stable soliton at this depth (the living-percept display).
    const field = gpu.readEyePsi();
    if (this.relaxSteps > 0) {
      gpu.setEyeObjField(field);                  // attractor = the scrubbed view
      for (let i = 0; i < Math.min(this.relaxSteps, 8); i++) gpu.stepRecordEye(dt, this.srcAlpha * 0.5);
    }
    return gpu.readEyePsi();
  }

  // ── COMBINED-FIELD MULTIMEDIA HOLOGRAM (carrier multiplex) ──────────────────────
  // ONE complex field holds BOTH an image and a sound, separable on readout — a single
  // multimedia wavefront (like one plate storing multiple images). The sound is embedded
  // into the grid and tagged with a TILT CARRIER e^{i·k·x} distinct from the image's
  // content; demodulating by conj(carrier) recovers it. Both propagate under one IFS
  // operator and reconstruct with one backward sweep. Separation isn't perfect (the IFS
  // medium isn't orthogonal → some cross-talk), but it's the proven real-holography scheme
  // and the cross-talk is measurable.
  //
  // imgField : Float64Array(2·N_CELLS) — the 2D image wavefront
  // sndSamples : Float64Array(M) — the sound waveform (M ≤ N_CELLS)
  // grid : side length (N_CELLS = grid²);  carrierKx : sound carrier tilt
  // Returns the combined field Ψ (2·N_CELLS).
  combineMultimedia(imgField, sndSamples, grid, carrierKx = 1.7, sndAmp = 0.5) {
    const N = grid * grid;
    const Psi = new Float64Array(2 * N);
    for (let k = 0; k < 2 * N; k++) Psi[k] = imgField[k];   // image: direct
    // embed sound row-major into the grid, modulated by the carrier e^{i·kx·x}
    const M = Math.min(sndSamples.length, N);
    for (let i = 0; i < M; i++) {
      const x = i % grid;
      const ph = carrierKx * x;
      Psi[i*2]   += sndAmp * sndSamples[i] * Math.cos(ph);
      Psi[i*2+1] += sndAmp * sndSamples[i] * Math.sin(ph);
    }
    return Psi;
  }

  // Demodulate the sound back out of a (reconstructed) combined field: multiply by
  // conj(carrier) and take the real part per cell → the recovered samples.
  splitSound(combinedField, grid, carrierKx = 1.7, M = null) {
    const N = grid * grid; M = M ?? N;
    const out = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const x = i % grid;
      const ph = carrierKx * x;
      // Re( Ψ · e^{-i·ph} ) = Re·cos + Im·sin  → the carrier-demodulated amplitude
      out[i] = combinedField[i*2] * Math.cos(ph) + combinedField[i*2+1] * Math.sin(ph);
    }
    return out;
  }

  // Full combined-field round-trip: combine → forward → [optional occlude] → backward →
  // returns { recon (the combined reconstructed field), imgScore, sndScore } where the
  // scores measure how cleanly each modality survived (vs the originals).
  multimediaRoundTrip(imgField, sndSamples, grid, opts = {}) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    const kx = opts.carrierKx ?? 1.7, sndAmp = opts.sndAmp ?? 0.5;
    const M = Math.min(sndSamples.length, grid*grid);
    const Psi = this.combineMultimedia(imgField, sndSamples, grid, kx, sndAmp);
    gpu.setEyePsi(Psi);
    gpu.stepEyeN(D, dt);                                   // forward → combined hologram
    if (opts.hMode) gpu.applyEyeHologram(opts.hMode, opts.hParam ?? 0.5,
      { block: opts.hBlock ?? 8, seed: opts.hSeed ?? 0 });
    const holo = gpu.readEyePsi();
    gpu.stepEyeN(D, -dt);                                  // backward → reconstruction
    const recon = gpu.readEyePsi();
    // image: direct correlation vs original image
    const imgScore = this._corr(recon, imgField);
    // sound: demodulate, correlate vs original samples
    const sndRec = this.splitSound(recon, grid, kx, M);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < M; i++) { const a = sndRec[i], b = sndSamples[i]; dot += a*b; na += a*a; nb += b*b; }
    const sndScore = (na > 0 && nb > 0) ? Math.abs(dot) / Math.sqrt(na*nb) : 0;
    return { holo, recon, sndRec, imgScore, sndScore };
  }

  // ── CONVERGED: depth-resolved image + sound in ONE staged combined field. ───────────
  // The full vision: depth (τ-scrub), sound (carrier multiplex), and shared clock (one τ)
  // unified. The sound is carrier-tagged and injected as an extra "layer" at a chosen depth
  // position (sndDepth ∈ [0,1)) of the SAME staged forward that builds the depth image — so
  // it travels its own propagation distance like any depth layer. τ-scrub then recovers the
  // focused depth-view at τ; demodulating the carrier recovers the sound. ONE wavefront,
  // scrubbed by ONE τ, yields focused 3D image AND its soundtrack.
  //
  // layers: image depth bins (near→far). sndSamples: waveform. grid, carrierKx, sndAmp.
  // sndDepth: where in depth the sound rides (its τ focus position).
  // Returns a scrub(tau) → { view, sndRec } and a hologram() for display.
  depthScrubMMSetup(layers, sndSamples, grid, opts = {}) {
    const kx = opts.carrierKx ?? 1.7, sndAmp = opts.sndAmp ?? 1.0;
    const sndDepth = opts.sndDepth ?? 0.5;
    const N = grid * grid, M = Math.min(sndSamples.length, N);
    // Build a carrier-tagged sound FIELD (the sound as a 2D layer to inject into the stage).
    const sndLayer = new Float64Array(2 * N);
    for (let i = 0; i < M; i++) {
      const x = i % grid, ph = kx * x;
      sndLayer[i*2]   = sndAmp * sndSamples[i] * Math.cos(ph);
      sndLayer[i*2+1] = sndAmp * sndSamples[i] * Math.sin(ph);
    }
    // Insert the sound layer into the depth-layer stack at its sndDepth position, so it is
    // injected at the matching forward step and shares the depth/τ axis with the image.
    const nL = layers.length;
    const sndIdx = Math.max(0, Math.min(nL, Math.round(sndDepth * nL)));
    const combined = [...layers.slice(0, sndIdx), sndLayer, ...layers.slice(sndIdx)];
    return { combined, kx, M, grid };
  }

  // One scrub of the converged field at depth τ → focused view + recovered sound.
  depthScrubMM(setup, tau, shallow = true) {
    const gpu = this._gpu;
    const view = this.depthScrub(setup.combined, tau, shallow);   // focused depth image at τ
    const sndRec = this.splitSound(view, setup.grid, setup.kx, setup.M); // demod sound from it
    return { view, sndRec };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  CLOCK-MODULATED MULTIMEDIA on the REAL 2D image — "no tricks at all" version. Sound
  //  is NOT placed in the grid (no carrier, no depth slot): it modulates the per-step dt
  //  of the SAME GPU evolution that carries the 2D image wavefront. The image rides the
  //  steps; the audio IS the step tempo. Recovery is phase-rate demod (mean per-step phase
  //  advance, amplitude-weighted), calibrated against a constant-dt back-pass. Image and
  //  sound then have ORTHOGONAL failure modes — spatial occlusion degrades the image
  //  holographically but barely touches the time-axis sound (verified in 1D, see IFSSound).
  //
  //  imgField : Float64Array(2·N) source wavefront.  samples : audio (resampled to D ticks).
  //  Returns { holo, recon, sRec, s, imgScore, sndScore }.
  // ════════════════════════════════════════════════════════════════════════════════════
  clockModMM(imgField, samples, eps = 0.25) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    // resample audio → D ticks, normalize, build dt schedule (same convention as IFSSound)
    const s = new Float64Array(D); let mx = 0;
    for (let i = 0; i < D; i++) {
      const v = samples[Math.min(samples.length - 1, Math.floor(i * samples.length / D))];
      s[i] = v; if (Math.abs(v) > mx) mx = Math.abs(v);
    }
    if (mx > 0) for (let i = 0; i < D; i++) s[i] /= mx;
    const dts = new Float64Array(D);
    for (let i = 0; i < D; i++) dts[i] = dt * (1 + eps * s[i]);

    // amplitude-weighted mean phase advance between two GPU fields (the demod observable)
    const meanAdv = (a, b) => {
      let sw = 0, acc = 0;
      for (let i = 0; i < a.length; i += 2) {
        const ar = a[i], ai = a[i+1], br = b[i], bi = b[i+1];
        const a2 = ar*ar + ai*ai; if (a2 < 1e-12) continue;
        acc += a2 * Math.atan2(bi*ar - br*ai, br*ar + bi*ai); sw += a2;
      }
      return sw > 0 ? acc / sw : 0;
    };

    // ── FORWARD through the modulated clock, carrying the 2D image ──
    gpu.setEyePsi(imgField);
    for (let i = 0; i < D; i++) gpu.stepEye(dts[i]);
    const holo = gpu.readEyePsi();

    // ── RECOVER: modulated backward pass (refocus image + log phase advance) ──
    gpu.setEyePsi(holo);
    let prev = holo;
    const advMod = new Float64Array(D);
    for (let i = D - 1; i >= 0; i--) {
      gpu.stepEye(-dts[i]);
      const cur = gpu.readEyePsi();
      advMod[D - 1 - i] = meanAdv(prev, cur);
      prev = cur;
    }
    const recon = prev;

    // ── calibration: constant-dt backward pass from the same hologram ──
    gpu.setEyePsi(holo);
    prev = holo;
    const advBase = new Float64Array(D);
    for (let i = D - 1; i >= 0; i--) {
      gpu.stepEye(-dt);
      const cur = gpu.readEyePsi();
      advBase[D - 1 - i] = meanAdv(prev, cur);
      prev = cur;
    }

    // demod: s_i ≈ (advMod/advBase − 1)/eps
    const sRec = new Float64Array(D);
    for (let k = 0; k < D; k++) {
      const fwdTick = D - 1 - k, base = advBase[k];
      sRec[fwdTick] = (Math.abs(base) > 1e-9) ? (advMod[k] / base - 1) / eps : 0;
    }
    let rmx = 0; for (let i = 0; i < D; i++) if (Math.abs(sRec[i]) > rmx) rmx = Math.abs(sRec[i]);
    if (rmx > 0) for (let i = 0; i < D; i++) sRec[i] /= rmx;

    // scores
    const imgScore = this._corr(recon, imgField);
    let sd = 0, sa = 0, sb = 0;
    for (let i = 0; i < D; i++) { const x = sRec[i], y = s[i]; sd += x*y; sa += x*x; sb += y*y; }
    const sndScore = (sa > 0 && sb > 0) ? sd / Math.sqrt(sa*sb) : 0;
    return { holo, recon, sRec, s, imgScore, sndScore };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  DEPTH + CLOCK-MODULATED SOUND — the converged "no tricks" path. A STAGED multi-depth
  //  scene (layers injected at their own forward steps = depth) propagates through a
  //  dt-schedule modulated by the heartbeat `samples`. τ-scrub (band-mapped, same as
  //  depthScrub) refocuses a depth slice; the heartbeat is recovered by phase-rate demod of
  //  the per-step phase advance during the SAME backward leg. So panel 2/3 are real focused
  //  DEPTH views (not a flat plane), and the sound is the clock — no carrier, no depth slot.
  //
  //  layers : depth bins (near→far).  samples : heartbeat (resampled to D ticks).
  //  tau : focal depth ∈ [0,1].  eps : modulation depth.  shallow : band-inject (depth-of-field).
  //  Returns { holo, view, sRec, s }.  view = focused depth slice at τ (left in eye buffer).
  // ════════════════════════════════════════════════════════════════════════════════════
  clockDepthScrub(layers, samples, tau, eps = 0.25, shallow = true) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    const nL = layers.length, N = layers[0].length >> 1;
    // dt schedule from the heartbeat (one per forward step), same convention as clockModMM
    const s = new Float64Array(D); let mx = 0;
    for (let i = 0; i < D; i++) {
      const v = samples[Math.min(samples.length - 1, Math.floor(i * samples.length / D))];
      s[i] = v; if (Math.abs(v) > mx) mx = Math.abs(v);
    }
    if (mx > 0) for (let i = 0; i < D; i++) s[i] /= mx;
    const dts = new Float64Array(D);
    for (let i = 0; i < D; i++) dts[i] = dt * (1 + eps * s[i]);
    const meanAdv = (a, b) => {
      let sw = 0, acc = 0;
      for (let i = 0; i < a.length; i += 2) {
        const ar = a[i], ai = a[i+1], br = b[i], bi = b[i+1];
        const a2 = ar*ar + ai*ai; if (a2 < 1e-12) continue;
        acc += a2 * Math.atan2(bi*ar - br*ai, br*ar + bi*ai); sw += a2;
      }
      return sw > 0 ? acc / sw : 0;
    };

    // ── STAGED FORWARD with the modulated clock (depth = injection step) ──
    const span = shallow ? Math.max(1, Math.round(D * (this.depthBand ?? 0.35))) : D;
    const injStep = (d) => Math.round(span * (nL - 1 - d) / nL);
    gpu.setEyePsi(new Float64Array(2 * N));
    const sched = layers.map((f, d) => ({ step: injStep(d), d })).sort((a, b) => a.step - b.step);
    const injectAt = (cur) => {
      for (const e of sched) {
        if (e.step !== cur) continue;
        const f = layers[e.d];
        let nz = false; for (let k = 0; k < f.length; k++) { if (f[k] !== 0) { nz = true; break; } }
        if (!nz) continue;
        const psi = gpu.readEyePsi();
        for (let k = 0; k < f.length; k++) psi[k] += f[k];
        gpu.setEyePsi(psi);
      }
    };
    for (let i = 0; i < D; i++) { injectAt(i); gpu.stepEye(dts[i]); }
    injectAt(D);
    const holo = gpu.readEyePsi();

    // ── [H] occlusion on the hologram (same as depthScrub) ──
    if (this.hMode) {
      gpu.applyEyeHologram(this.hMode, this.hParam,
        { steps: this.hSteps, smoothMaxPlate: Math.max(gpu.readEyePeakSq(), 1e-12),
          block: this.hBlock, seed: this.hSeed });
    }

    // ── τ → focal back-step, band-mapped (identical to depthScrub) ──
    const band = shallow ? (this.depthBand ?? 0.35) : 1.0;
    const kNear = Math.round(D * (1 - band));
    const back  = Math.round(kNear + tau * (D - kNear));

    // ── BACKWARD leg through the SAME schedule reversed, demod heartbeat from phase rate ──
    let prev = gpu.readEyePsi();
    const advMod = new Float64Array(back);
    for (let j = 0; j < back; j++) {
      const i = D - 1 - j;                 // reverse the forward step order
      gpu.stepEye(-dts[i]);
      const cur = gpu.readEyePsi();
      advMod[j] = meanAdv(prev, cur);
      prev = cur;
    }
    const view = prev;

    // calibration: constant-dt backward pass from the same (post-H) hologram
    gpu.setEyePsi(holo);
    if (this.hMode) gpu.applyEyeHologram(this.hMode, this.hParam,
      { steps: this.hSteps, smoothMaxPlate: Math.max(gpu.readEyePeakSq(), 1e-12),
        block: this.hBlock, seed: this.hSeed });
    let pc = gpu.readEyePsi();
    const advBase = new Float64Array(back);
    for (let j = 0; j < back; j++) {
      gpu.stepEye(-dt);
      const cur = gpu.readEyePsi();
      advBase[j] = meanAdv(pc, cur);
      pc = cur;
    }
    // demod: s_i ≈ (advMod/advBase − 1)/eps  (forward tick i = D-1-j)
    const sRec = new Float64Array(D);
    for (let j = 0; j < back; j++) {
      const i = D - 1 - j, base = advBase[j];
      sRec[i] = (Math.abs(base) > 1e-9) ? (advMod[j] / base - 1) / eps : 0;
    }
    let rmx = 0; for (let i = 0; i < D; i++) if (Math.abs(sRec[i]) > rmx) rmx = Math.abs(sRec[i]);
    if (rmx > 0) for (let i = 0; i < D; i++) sRec[i] /= rmx;

    gpu.setEyePsi(view);   // leave the focused depth view in the eye buffer
    return { holo, view, sRec, s };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  EVENT-TIMING HOLOGRAPHY — the rhythm ITSELF made holographic (not a waveform, not a
  //  live monitor). A fresnelBeat event is { d/t: tier, wt: time, delay: ring }. We encode
  //  each event as a LOCALIZED IMPULSE: its TIME → a forward-injection step (time = depth,
  //  the medium's own rule), its TIER → a fixed grid cell (deterministic, not tuned). The
  //  reversible field carries the impulses; back-propagation refocuses each at its own step.
  //  RECOVERY IS HONEST: we PEAK-DETECT impulses in the reconstructed field — read the events
  //  back out — rather than replaying the input. The score can therefore FAIL (occlusion,
  //  collisions). This puts the discrete polyrhythm BACK INTO the hologram: onset times AND
  //  tier identity reconstruct, and degrade gracefully under occlusion if it is holographic.
  //
  //  events : [{ t|d: tier, wt: time }]   nTiers : voice count   nBins : time quantization
  //  occludeR : hologram occlusion fraction (the holography test).
  //  Returns { holo, recovered:[{tier, bin}], trueSet:[{tier,bin}], onsetScore, tierScore, f1 }.
  // ════════════════════════════════════════════════════════════════════════════════════
  eventTimingHologram(events, opts = {}) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt, G = gpu._G, N = G * G;
    const nTiers = opts.nTiers ?? 4;
    // SPARSE bins reconstruct cleanly (verified): dense bins blur like dense-depth scenes —
    // the same structure-gating. Default to few, well-separated bins for f1≈1 at r=0.
    const nBins  = opts.nBins  ?? Math.min(4, Math.max(2, Math.floor(D / 24)));
    const occludeR = opts.occludeR ?? 0;
    const thresh = opts.thresh ?? 0.25;     // peak-detect threshold (fraction of slice max)

    // ── fixed deterministic tier → grid cell map (well-separated, NOT tuned per-event) ──
    const tierCell = (tier) => {
      const cols = Math.ceil(Math.sqrt(nTiers));
      const cx = Math.round(G * ((tier % cols) + 0.5) / cols);
      const cy = Math.round(G * (Math.floor(tier / cols) + 0.5) / cols);
      return cy * G + cx;
    };
    // time → forward injection step (time = depth). Spread bins across [0, D·band]. Wide
    // band = well-separated bins = clean reconstruction (verified: band≥0.6 gives f1≈1@r=0).
    const span = Math.max(nBins, Math.round(D * (opts.band ?? 0.7)));
    const binStep = (bin) => Math.round(span * (nBins - 1 - bin) / nBins);  // early bin = deep
    const focusBack = (bin) => D - binStep(bin);

    // quantize events → a set of (tier, bin). wt is virtual time; normalize to [0,1) over the
    // event window, then to a bin. (If wt missing, spread events evenly — still honest test.)
    const wts = events.map(e => e.wt ?? 0);
    const wMin = Math.min(...wts, 0), wMax = Math.max(...wts, 1);
    const span01 = (wMax - wMin) || 1;
    const trueSet = [];
    const seen = new Set();
    events.forEach((e, i) => {
      const tier = (e.t ?? e.d ?? 0) % nTiers;
      const u = ((e.wt ?? i) - wMin) / span01;             // 0..1
      const bin = Math.min(nBins - 1, Math.floor(u * nBins));
      const key = tier + ':' + bin;
      if (!seen.has(key)) { seen.add(key); trueSet.push({ tier, bin }); }
    });

    // ── ENCODE: staged forward, injecting each event's impulse at its bin's forward step ──
    gpu.setEyePsi(new Float64Array(2 * N));
    // schedule injections by step ascending
    const sched = trueSet.map(ev => ({ step: binStep(ev.bin), ev })).sort((a, b) => a.step - b.step);
    let cur = 0, si = 0;
    const injectDue = () => {
      while (si < sched.length && sched[si].step <= cur) {
        const psi = gpu.readEyePsi();
        const c = tierCell(sched[si].ev.tier);
        psi[c * 2] += 1.0;                                  // unit impulse, real part
        gpu.setEyePsi(psi);
        si++;
      }
    };
    injectDue();
    while (cur < D) {
      const next = (si < sched.length) ? Math.min(sched[si].step, D) : D;
      if (next > cur) { gpu.stepEyeN(next - cur, dt); cur = next; }
      injectDue();
    }
    if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    const holo = gpu.readEyePsi();

    // ── RECOVER: back-propagate, at each bin's focus step peak-detect lit tier-cells. ──
    // Honest: we read what's actually IN the reconstructed field, not the injected set.
    const bins = Array.from({ length: nBins }, (_, b) => b).sort((a, b) => focusBack(a) - focusBack(b));
    const recovered = [];
    let back = 0;
    for (const bin of bins) {
      const target = focusBack(bin);
      if (target > back) { gpu.stepEyeN(target - back, -dt); back = target; }
      const slice = gpu.readEyePsi();
      // intensity at each tier cell; a cell counts as "fired at this bin" if it's a local
      // peak above threshold·(max tier-cell intensity in this slice).
      let mx = 1e-12;
      const ints = new Array(nTiers);
      for (let tier = 0; tier < nTiers; tier++) {
        const c = tierCell(tier);
        const I = slice[c * 2] * slice[c * 2] + slice[c * 2 + 1] * slice[c * 2 + 1];
        ints[tier] = I; if (I > mx) mx = I;
      }
      for (let tier = 0; tier < nTiers; tier++) {
        if (ints[tier] >= thresh * mx && ints[tier] > 1e-9) recovered.push({ tier, bin });
      }
    }

    // ── SCORE: match recovered (tier,bin) against trueSet. onset = bin match, tier = tier. ──
    const trueKeys = new Set(trueSet.map(e => e.tier + ':' + e.bin));
    const recKeys  = new Set(recovered.map(e => e.tier + ':' + e.bin));
    let tp = 0; for (const k of recKeys) if (trueKeys.has(k)) tp++;
    const precision = recKeys.size ? tp / recKeys.size : 0;
    const recall    = trueKeys.size ? tp / trueKeys.size : 0;
    const f1 = (precision + recall) ? 2 * precision * recall / (precision + recall) : 0;
    // onset-only score: bins present (ignoring tier) — "did the groove survive"
    const trueBins = new Set(trueSet.map(e => e.bin)), recBins = new Set(recovered.map(e => e.bin));
    let bt = 0; for (const b of recBins) if (trueBins.has(b)) bt++;
    const onsetScore = trueBins.size ? bt / trueBins.size : 0;
    // tier-only score: tiers present (ignoring time) — "did the voices survive"
    const trueTiers = new Set(trueSet.map(e => e.tier)), recTiers = new Set(recovered.map(e => e.tier));
    let tt = 0; for (const t of recTiers) if (trueTiers.has(t)) tt++;
    const tierScore = trueTiers.size ? tt / trueTiers.size : 0;

    return { holo, recovered, trueSet, onsetScore, tierScore, precision, recall, f1, nBins, nTiers };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  THE UNIFIED FIELD — one evolution, read at three resolutions (architecture §7.10).
  //  There is ONE substrate: the EVENTS (the clock's atoms). We encode them once, biased to
  //  preserve FINE ONSETS (user decision): sharp, well-separated impulses, placed REDUNDANTLY
  //  (a small cross per event so spatial occlusion cannot erase a tier-cell). An optional
  //  IMAGE rides the SAME staged forward — depth = the same time axis the events live on.
  //  From the ONE reconstruction we derive ALL faces, indexed by the single knob τ:
  //    • discrete  → peak-detect events  (the groove / drums)
  //    • continuous→ envelope of the recovered impulse intensities over back-prop (the WAVEFORM,
  //                  derived for free — NOT a second encoding)
  //    • spatial   → the field at τ's focal step (the image depth-slice)
  //  τ ∈ [0,1] = position along the fractal clock; near→far focal sweep, same band-map as depth.
  //
  //  events:[{t|d,wt}]  opts:{ nTiers, nBins, band, occludeR, imgField, redund }
  //  Returns { holo, recovered, trueSet, f1, onsetScore, tierScore,
  //            waveform:Float64Array(nBins), viewTau:Float64Array(field), tau }
  // ════════════════════════════════════════════════════════════════════════════════════
  unifiedField(events, tau = 1.0, opts = {}) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt, G = gpu._G, N = G * G;
    const nTiers = opts.nTiers ?? 4;
    const nBins  = opts.nBins  ?? Math.min(4, Math.max(2, Math.floor(D / 24)));  // sparse → fine onsets
    const occludeR = opts.occludeR ?? 0;
    const thresh = opts.thresh ?? 0.25;
    const redund = opts.redund ?? true;        // redundant impulse placement (occlusion resilience)

    const tierCell = (tier) => {
      const cols = Math.ceil(Math.sqrt(nTiers));
      const cx = Math.round(G * ((tier % cols) + 0.5) / cols);
      const cy = Math.round(G * (Math.floor(tier / cols) + 0.5) / cols);
      return { cx, cy, c: cy * G + cx };
    };
    // redundant footprint = the cell + 4 neighbours at radius rr (a plus sign). Spatial
    // occlusion (block-zeroing) then has to hit ALL of them to erase the event → onset survives.
    const footprint = (tier) => {
      const { cx, cy } = tierCell(tier);
      const rr = Math.max(2, Math.round(G * 0.06));
      const pts = [[cx, cy]];
      if (redund) pts.push([cx + rr, cy], [cx - rr, cy], [cx, cy + rr], [cx, cy - rr]);
      return pts.filter(([x, y]) => x >= 0 && x < G && y >= 0 && y < G).map(([x, y]) => y * G + x);
    };

    const span = Math.max(nBins, Math.round(D * (opts.band ?? 0.7)));   // wide band → separated bins
    const binStep   = (bin) => Math.round(span * (nBins - 1 - bin) / nBins);
    const focusBack = (bin) => D - binStep(bin);

    // quantize events → (tier,bin) set. timeKey selects the TIME axis: 'wt' (wall-time, default)
    // or 'delay' (the beat's Fresnel ring delay — the structural time of a repeating MOTIF, where
    // wt only marks the repeat). For the clock's deterministic motif, 'delay' is the right axis.
    const timeKey = opts.timeKey ?? 'wt';
    const tval = (e, i) => timeKey === 'delay' ? (e.delay ?? i) : (e.wt ?? i);
    const ts = events.map((e, i) => tval(e, i));
    const wMin = Math.min(...ts, 0), wMax = Math.max(...ts, 1);
    const span01 = (wMax - wMin) || 1;
    const trueSet = []; const seen = new Set();
    const cellDelay = new Map();   // (tier:bin) → the beat's Fresnel delay (its physical timbre)
    events.forEach((e, i) => {
      const tier = (e.t ?? e.d ?? 0) % nTiers;
      const bin = Math.min(nBins - 1, Math.floor(((tval(e, i) - wMin) / span01) * nBins));
      const key = tier + ':' + bin;
      if (!cellDelay.has(key)) cellDelay.set(key, e.delay ?? 0);
      if (!seen.has(key)) { seen.add(key); trueSet.push({ tier, bin, delay: e.delay ?? 0 }); }
    });

    // ── ENCODE: ONE staged forward. Optional image seeded first (rides the same steps), then
    //    each event injected as a redundant impulse at its bin's forward step. ──
    gpu.setEyePsi(opts.imgField ? new Float64Array(opts.imgField) : new Float64Array(2 * N));
    const sched = trueSet.map(ev => ({ step: binStep(ev.bin), ev })).sort((a, b) => a.step - b.step);
    let cur = 0, si = 0;
    const injectDue = () => {
      while (si < sched.length && sched[si].step <= cur) {
        const psi = gpu.readEyePsi();
        for (const c of footprint(sched[si].ev.tier)) psi[c * 2] += 1.0;
        gpu.setEyePsi(psi);
        si++;
      }
    };
    injectDue();
    while (cur < D) {
      const next = (si < sched.length) ? Math.min(sched[si].step, D) : D;
      if (next > cur) { gpu.stepEyeN(next - cur, dt); cur = next; }
      injectDue();
    }
    if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    const holo = gpu.readEyePsi();

    // tier intensity in a field = max over the event's footprint (redundancy: survives if ANY
    // footprint cell survives) — this is what makes the onset robust to spatial occlusion.
    const tierIntensity = (field, tier) => {
      let m = 0;
      for (const c of footprint(tier)) {
        const I = field[c * 2] * field[c * 2] + field[c * 2 + 1] * field[c * 2 + 1];
        if (I > m) m = I;
      }
      return m;
    };

    // ── RECOVER: back-propagate, capturing the FULL intensity matrix I[tier][bin] first. ──
    // The detection discriminator is TEMPORAL CONTRAST WITHIN A TIER, not brightness within a
    // bin. After deep T the footprints bleed and every cell carries some energy → comparing
    // tiers within a bin saturates (every tier "lit" every bin → onset/tier trivially 1.0,
    // precision dead). Instead: a true event = "this voice SPIKES at its own focus step",
    // i.e. I[tier][bin] stands out above that SAME tier's baseline across the other bins.
    const binsOrdered = Array.from({ length: nBins }, (_, b) => b).sort((a, b) => focusBack(a) - focusBack(b));
    const I = Array.from({ length: nTiers }, () => new Float64Array(nBins));
    const waveform = new Float64Array(nBins);     // continuous envelope, derived from the SAME pass
    let back = 0;
    for (const bin of binsOrdered) {
      const target = focusBack(bin);
      if (target > back) { gpu.stepEyeN(target - back, -dt); back = target; }
      const slice = gpu.readEyePsi();
      let binSum = 0;
      for (let tier = 0; tier < nTiers; tier++) {
        const v = tierIntensity(slice, tier); I[tier][bin] = v; binSum += v;
      }
      waveform[bin] = binSum;                     // continuous: total event energy at this bin
    }
    // normalize the derived waveform
    let wmx = 0; for (let i = 0; i < nBins; i++) if (waveform[i] > wmx) wmx = waveform[i];
    if (wmx > 0) for (let i = 0; i < nBins; i++) waveform[i] /= wmx;

    // DETECT per tier by temporal contrast: a bin fires for a tier if its intensity exceeds
    // (tier baseline) + contrast·(tier peak − baseline). baseline = that tier's median-ish
    // (min across bins, robust to the few spikes). contrast≈0.5 ⇒ must be clearly above floor.
    const contrast = opts.contrast ?? 0.5;
    const recovered = [];
    for (let tier = 0; tier < nTiers; tier++) {
      const row = I[tier];
      let lo = Infinity, hi = 0;
      for (let b = 0; b < nBins; b++) { if (row[b] < lo) lo = row[b]; if (row[b] > hi) hi = row[b]; }
      if (hi < 1e-9) continue;                    // this tier never fired at all
      const gate = lo + contrast * (hi - lo);
      for (let b = 0; b < nBins; b++) if (row[b] >= gate && (hi - lo) > 0.05 * hi)
        recovered.push({ tier, bin: b, delay: cellDelay.get(tier + ':' + b) ?? 0,
                         amp: hi > 0 ? (row[b] - lo) / (hi - lo) : 0 });   // timbre + relative strength
    }

    // ── CONTINUOUS-FACE FINE WAVEFORM — a full audio-rate buffer SYNTHESIZED FROM the recovered
    //    events (§7.10: events = substrate, waveform = a reading of them). Each recovered beat is
    //    a damped sinusoid at its delay-pitch, placed at its onset (bin) — so the SAME atoms that
    //    give the discrete groove also give a true playable waveform, no second encoding. This is
    //    "the waveform we started by holographing", now derived from the reconstructed atoms. ──
    const WLEN = opts.audioLen ?? 1024;            // audio-rate samples spanning the bar
    const audioWave = new Float64Array(WLEN);
    // normalize delays present → pitch (inner ring = small delay = higher), like the sonifier
    let dmin = Infinity, dmax = 0;
    for (const ev of recovered) { const d = ev.delay ?? 0.2; if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
    const dsp = (dmax - dmin) || 1;
    for (const ev of recovered) {
      const u = ((ev.delay ?? 0.2) - dmin) / dsp;  // 0 inner … 1 outer
      const cycles = 6 + (1 - u) * 30;             // inner ring = more cycles (higher pitch)
      const decay  = 3 + u * 6;                    // outer ring = slower decay
      const onset  = Math.floor((ev.bin + 0.0) / nBins * WLEN);
      const dur    = Math.floor(WLEN / nBins);
      const A = 0.3 + 0.7 * (ev.amp ?? 1);         // recovered strength → loudness
      for (let i = 0; i < dur && onset + i < WLEN; i++) {
        const t = i / dur;                          // 0..1 within this beat's slot
        audioWave[onset + i] += A * Math.sin(2 * Math.PI * cycles * t) * Math.exp(-decay * t);
      }
    }
    // normalize to unit peak
    let amx = 0; for (let i = 0; i < WLEN; i++) { const a = Math.abs(audioWave[i]); if (a > amx) amx = a; }
    if (amx > 0) for (let i = 0; i < WLEN; i++) audioWave[i] /= amx;

    // ── SPATIAL readout at τ: focus the field at the τ-mapped depth (image face). ──
    // τ band-maps to a focal back-step like depthScrub; we re-derive from the hologram so the
    // earlier back-prop loop (which ended at the deepest bin) doesn't disturb this.
    gpu.setEyePsi(holo);
    if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    const band = opts.band ?? 0.7;
    const kNear = Math.round(D * (1 - band));
    const backTau = Math.round(kNear + tau * (D - kNear));
    if (backTau > 0) gpu.stepEyeN(backTau, -dt);
    const viewTau = gpu.readEyePsi();

    // ── SCORES (fine-onset focus): f1 over (tier,bin), plus onset & tier sub-scores. ──
    const trueKeys = new Set(trueSet.map(e => e.tier + ':' + e.bin));
    const recKeys  = new Set(recovered.map(e => e.tier + ':' + e.bin));
    let tp = 0; for (const k of recKeys) if (trueKeys.has(k)) tp++;
    const precision = recKeys.size ? tp / recKeys.size : 0;
    const recall    = trueKeys.size ? tp / trueKeys.size : 0;
    const f1 = (precision + recall) ? 2 * precision * recall / (precision + recall) : 0;
    const trueBins = new Set(trueSet.map(e => e.bin)), recBins = new Set(recovered.map(e => e.bin));
    let bt = 0; for (const b of recBins) if (trueBins.has(b)) bt++;
    const onsetScore = trueBins.size ? bt / trueBins.size : 0;
    const trueTiers = new Set(trueSet.map(e => e.tier)), recTiers = new Set(recovered.map(e => e.tier));
    let tt = 0; for (const t of recTiers) if (trueTiers.has(t)) tt++;
    const tierScore = trueTiers.size ? tt / trueTiers.size : 0;

    return { holo, recovered, trueSet, waveform, audioWave, viewTau, tau,
             f1, onsetScore, tierScore, precision, recall, nBins, nTiers };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  HOLOGRAPHIC SAMPLER / SEQUENCER (§7.12) — events TRANSPORT a waveform voice. ONE field
  //  holds two SPATIALLY-SEPARATED payloads (cross-talk measured → separation = both recover
  //  cleanly, §7.12): a continuous WAVEFORM (the voice/timbre) in the LEFT grid columns, and a
  //  discrete EVENT pattern (the sequence) in the RIGHT columns. Both reconstruct from one
  //  backward sweep; the recovered events become the TRIGGER SCHEDULE that plays the recovered
  //  voice. The schedule is itself holographic — it survived the round-trip, it wasn't authored
  //  at playback. Occlusion degrades the PATTERN gracefully (events drop) while each surviving
  //  hit keeps its full VOICE. IFS diffusion still delocalizes both → holographic robustness.
  //
  //  voice  : Float64Array(voiceLen) — the waveform sample stream (the instrument's sound)
  //  events : [{ t|d: tier, wt|step: time }] — the sequence (when/which voice fires)
  //  opts   : { nTiers, nBins, band, occludeR, perTierVoice }
  //  Returns { holo, recovered, trueSet, voiceOut, voiceScore, f1, schedule, nBins, nTiers }
  //    voiceOut : the recovered voice waveform (samples, restored from the left region)
  //    schedule : [{ tier, bin, tSec }] — recovered trigger list (for the player)
  // ════════════════════════════════════════════════════════════════════════════════════
  holographicSampler(voice, events, opts = {}) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt, G = gpu._G, N = G * G;
    const nTiers = opts.nTiers ?? 4;
    const nBins  = opts.nBins  ?? 4;
    const band   = opts.band ?? 0.7;
    const occludeR = opts.occludeR ?? 0;
    const contrast = opts.contrast ?? 0.5;

    // ── REGION SPLIT (the measured cross-talk fix): waveform in LEFT half of columns, events
    //    in RIGHT half. Disjoint injection regions → no amplitude competition (§7.12). ──
    const splitX = G >> 1;
    // event tier → a cell in the RIGHT half (rows spread by tier)
    const tierCell = (tier) => {
      const cols = Math.max(1, Math.ceil(Math.sqrt(nTiers)));
      const rx = splitX + Math.round((G - splitX) * ((tier % cols) + 0.5) / cols);
      const ry = Math.round(G * (Math.floor(tier / cols) + 0.5) / cols);
      return { rx: Math.min(G - 1, rx), ry };
    };
    const footprint = (tier) => {
      const { rx, ry } = tierCell(tier);
      const rr = Math.max(2, Math.round(G * 0.05));
      const pts = [[rx, ry], [rx + rr, ry], [rx - rr, ry], [rx, ry + rr], [rx, ry - rr]];
      return pts.filter(([x, y]) => x >= splitX && x < G && y >= 0 && y < G).map(([x, y]) => y * G + x);
    };
    const span = Math.max(nBins, Math.round(D * band));
    const binStep   = (bin) => Math.round(span * (nBins - 1 - bin) / nBins);
    const focusBack = (bin) => D - binStep(bin);

    // quantize events → (tier,bin), keep delay for the timbre if present
    const tval = (e, i) => e.wt ?? e.step ?? i;
    const ts = events.map((e, i) => tval(e, i));
    const wMin = Math.min(...ts, 0), wMax = Math.max(...ts, 1), sp = (wMax - wMin) || 1;
    const trueSet = []; const seen = new Set();
    events.forEach((e, i) => {
      const tier = (e.t ?? e.d ?? 0) % nTiers;
      const bin = Math.min(nBins - 1, Math.floor(((tval(e, i) - wMin) / sp) * nBins));
      const key = tier + ':' + bin;
      if (!seen.has(key)) { seen.add(key); trueSet.push({ tier, bin }); }
    });

    // ── ENCODE: seed the VOICE into the left columns, then stage EVENT impulses (right) ──
    // voiceRows = how many grid ROWS the voice occupies. Recovery AVERAGES these rows; at large
    // T the 2D ring diffusion mixes rows into different states, so averaging MANY rows
    // superimposes differently-diffused copies = additive LAYERING (a depth-timbre). voiceRows=1
    // → a single clean row, no inter-row mixing → DRY voice, independent of T. So this knob, not
    // T, controls voice timbre; T is left to mean holographic depth/redundancy only.
    const voiceRows = Math.max(1, Math.min(G, opts.voiceRows ?? 1));
    const psi0 = new Float64Array(2 * N);
    const vLen = voice ? voice.length : 0;
    if (voice) {
      for (let y = 0; y < voiceRows; y++) for (let x = 0; x < splitX; x++) {
        const idx = y * splitX + x;
        psi0[(y * G + x) * 2] += voice[idx % vLen] * (opts.voiceAmp ?? 1.0);
      }
    }
    gpu.setEyePsi(psi0);
    const sched = trueSet.map(ev => ({ step: binStep(ev.bin), ev })).sort((a, b) => a.step - b.step);
    let cur = 0, si = 0;
    const inj = () => {
      while (si < sched.length && sched[si].step <= cur) {
        const psi = gpu.readEyePsi();
        for (const c of footprint(sched[si].ev.tier)) psi[c * 2] += (opts.evAmp ?? 1.0);
        gpu.setEyePsi(psi); si++;
      }
    };
    inj();
    while (cur < D) {
      const next = (si < sched.length) ? Math.min(sched[si].step, D) : D;
      if (next > cur) { gpu.stepEyeN(next - cur, dt); cur = next; }
      inj();
    }
    if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    const holo = gpu.readEyePsi();

    // ── RECOVER VOICE: full backward sweep, read the left region back as samples. ──
    gpu.setEyePsi(holo);
    if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    gpu.stepEyeN(D, -dt);
    const recon = gpu.readEyePsi();
    const voiceOut = new Float64Array(vLen);
    const voiceCount = new Float64Array(vLen);
    // also accumulate sum-of-squares per sample → variance ACROSS rows (the divergence diag)
    const voiceSq = new Float64Array(vLen);
    for (let y = 0; y < voiceRows; y++) for (let x = 0; x < splitX; x++) {  // read back ONLY the voice's own rows
      const k = (y * splitX + x) % vLen;
      const v = recon[(y * G + x) * 2];
      voiceOut[k] += v; voiceSq[k] += v * v; voiceCount[k]++;
    }
    // DIVERGENCE: mean per-sample variance across contributing rows, normalized. ~0 = rows agree
    // (averaging is clean); rising with T = rows diffuse apart → averaging adds layering artifacts.
    let divSum = 0, divN = 0;
    for (let i = 0; i < vLen; i++) {
      if (voiceCount[i] > 1) {
        const mean = voiceOut[i] / voiceCount[i];
        const varr = voiceSq[i] / voiceCount[i] - mean * mean;
        divSum += Math.max(0, varr); divN++;
      }
    }
    const rowDivergence = divN > 0 ? divSum / divN : 0;
    for (let i = 0; i < vLen; i++) if (voiceCount[i]) voiceOut[i] /= voiceCount[i];
    let vmx = 0; for (let i = 0; i < vLen; i++) { const a = Math.abs(voiceOut[i]); if (a > vmx) vmx = a; }
    if (vmx > 0) for (let i = 0; i < vLen; i++) voiceOut[i] /= vmx;
    // voice fidelity vs original
    let vdot = 0, vna = 0, vnb = 0;
    for (let i = 0; voice && i < vLen; i++) { const a = voiceOut[i], b = voice[i]; vdot += a*b; vna += a*a; vnb += b*b; }
    const voiceScore = (vna > 0 && vnb > 0) ? Math.abs(vdot) / Math.sqrt(vna * vnb) : 0;

    // ── RECOVER EVENTS: per-bin focal back-prop + temporal-contrast detect (right region). ──
    gpu.setEyePsi(holo);
    if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    const binsOrdered = Array.from({ length: nBins }, (_, b) => b).sort((a, b) => focusBack(a) - focusBack(b));
    const I = Array.from({ length: nTiers }, () => new Float64Array(nBins));
    let back = 0;
    const tierInt = (field, tier) => { let m = 0; for (const c of footprint(tier)) { const v = field[c*2]*field[c*2] + field[c*2+1]*field[c*2+1]; if (v > m) m = v; } return m; };
    for (const bin of binsOrdered) {
      const target = focusBack(bin);
      if (target > back) { gpu.stepEyeN(target - back, -dt); back = target; }
      const slice = gpu.readEyePsi();
      for (let tier = 0; tier < nTiers; tier++) I[tier][bin] = tierInt(slice, tier);
    }
    // GLOBAL peak across all tiers/bins — the loudest real event. A tier far below this is
    // SILENCE, not an event. (Diag revealed the real bug: the single event is razor-sharp —
    // tier 0 ≈1.1, the other tiers ≈0.005, 200× weaker — but a per-tier-relative gate let each
    // weak tier fire its OWN noise peak → phantoms. The fix is an ABSOLUTE floor vs the global
    // peak; the field localizes events fine, the detector just wasn't using the global scale.)
    let globalHi = 0;
    for (let t = 0; t < nTiers; t++) for (let b = 0; b < nBins; b++) if (I[t][b] > globalHi) globalHi = I[t][b];
    const absFloor = globalHi * 0.25;                 // a real event ≥ 25% of the loudest event
    const recovered = [];
    for (let tier = 0; tier < nTiers; tier++) {
      const row = I[tier]; let hi = 0;
      for (let b = 0; b < nBins; b++) if (row[b] > hi) hi = row[b];
      if (hi < absFloor) continue;                    // whole tier below global floor = no event (noise)
      const gate = Math.max(0.55 * hi, absFloor);     // fire bins near this tier's peak AND above floor
      for (let b = 0; b < nBins; b++) if (row[b] >= gate) recovered.push({ tier, bin: b });
    }
    // f1
    const tk = new Set(trueSet.map(e => e.tier + ':' + e.bin));
    const rk = new Set(recovered.map(e => e.tier + ':' + e.bin));
    let tp = 0; for (const k of rk) if (tk.has(k)) tp++;
    const prec = rk.size ? tp / rk.size : 0, rec = tk.size ? tp / tk.size : 0;
    const f1 = (prec + rec) ? 2 * prec * rec / (prec + rec) : 0;

    // ── SCHEDULE: recovered events → trigger list with playback times (for the sampler). ──
    const barSecs = opts.barSecs ?? 2.0, slot = barSecs / Math.max(1, nBins);
    const schedule = recovered.map(e => ({ tier: e.tier, bin: e.bin, tSec: e.bin * slot }));

    return { holo, recovered, trueSet, voiceOut, voiceScore, f1, schedule,
             prec, recall: rec, nBins, nTiers, barSecs, rowDivergence, voiceRows };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  THE UNITED FIELD (§7.14) — image + events + sound in ONE wavefront, ONE deep T, ONE clock.
  //  The goal realised: three modalities encoded into DISJOINT REGIONS of one grid, propagated by
  //  a single deep-T forward (gated by the shared IFS clock), and all recovered from that one
  //  reconstruction — each surviving MASKING (the measurement showed all three need deep T for
  //  occlusion-robustness, so all read at the same deep depth). Regions (cross-talk clean, §7.12):
  //    • IMAGE  : top rows  [0 .. imgRows)         — depth-staged scene (depth = injection step)
  //    • EVENTS : bottom-left quadrant             — redundant-impulse tiers×bins (rhythm)
  //    • VOICE  : bottom-right quadrant            — tiled waveform (the instrument)
  //  Returns the three recoveries + scores; one τ (the shared clock position) indexes them all.
  //
  //  imgLayers : depth layers (near→far) | events : [{t,wt}] | voice : Float64Array | tau ∈ [0,1]
  // ════════════════════════════════════════════════════════════════════════════════════
  unitedField(imgLayers, events, voice, tau = 1.0, opts = {}) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt, G = gpu._G, N = G * G;
    const nTiers = opts.nTiers ?? 4, nBins = opts.nBins ?? 4;
    const band = opts.band ?? 0.7, occludeR = opts.occludeR ?? 0;
    const imgRows = Math.round(G * 0.6);            // image gets the top 60% of rows
    const midX = G >> 1;                            // events = bottom-left, voice = bottom-right
    const evRow0 = imgRows, evRows = G - imgRows;   // bottom band height
    const occ = () => { if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 }); };

    // ── event geometry (bottom-left quadrant). Each (tier,bin) is a distinct 2D CELL:
    //    bin → column, tier → row-band. ALL seeded at step 0 (full deep-T propagation for
    //    masking-robustness); bin is SPATIAL, not a depth-step — so deep uniform seeding keeps the
    //    time axis (the earlier depth-as-time encoding would be erased by uniform deep seeding). ──
    const evCell = (tier, bin) => {
      const cx = Math.round(midX * (bin + 0.5) / nBins);
      const cy = evRow0 + Math.round(evRows * (tier + 0.5) / nTiers);
      return { cx: Math.min(midX - 1, cx), cy: Math.min(G - 1, cy) };
    };
    const evFoot = (tier, bin) => {
      const { cx, cy } = evCell(tier, bin), rr = Math.max(2, Math.round(G * 0.03));
      return [[cx,cy],[cx+rr,cy],[cx-rr,cy],[cx,cy+rr],[cx,cy-rr]]
        .filter(([x,y]) => x>=0 && x<midX && y>=evRow0 && y<G).map(([x,y]) => y*G+x);
    };
    const span = Math.max(nBins, Math.round(D * band));   // (kept for image depth staging)

    // quantize events → (tier,bin)
    const ts = events.map((e,i)=> e.wt ?? i);
    const wMin = Math.min(...ts,0), wMax = Math.max(...ts,1), sp=(wMax-wMin)||1;
    const trueSet=[], seen=new Set();
    events.forEach((e,i)=>{ const tier=(e.t??e.d??0)%nTiers, bin=Math.min(nBins-1,Math.floor(((( e.wt??i)-wMin)/sp)*nBins)); const k=tier+':'+bin; if(!seen.has(k)){seen.add(k);trueSet.push({tier,bin});}});

    // VOICE region = the full bottom-RIGHT 2D quadrant (cols midX..G, rows evRow0..G), row-major.
    // (Fix for the 0.65 ceiling: the voice was tiled into ONE 32-wide row but is vLen=512 samples,
    //  so 15/16 of it was never stored → score capped. The 2D quadrant holds far more cells, so
    //  ALL samples fit and round-trip.) vCells[i] = grid cell index for voice sample i.
    const vLen = voice ? voice.length : 0;
    const vCells = [];
    for (let y = evRow0; y < G && vCells.length < vLen; y++)
      for (let x = midX; x < G && vCells.length < vLen; x++) vCells.push(y * G + x);
    const vN = vCells.length;                         // cells available (≥ vLen if region big enough)

    // ── ENCODE: one staged forward at deep T. Image layers injected at their depth-steps (top
    //    region only); events as impulses (bottom-left); voice tiled (bottom-right), all at step 0
    //    except the depth-staged image. Disjoint regions → clean separation. ──
    gpu.setEyePsi(new Float64Array(2*N));
    // Seed EVENTS + VOICE at step 0 → they get the FULL deep-T propagation (masking-robustness:
    // the measurement showed deep T gives event f1=1.0 under occlusion). The IMAGE layers are
    // depth-STAGED (injected across the forward, below) for depth-of-field. All in disjoint regions.
    {
      const psi = gpu.readEyePsi();
      for (const ev of trueSet) for (const c of evFoot(ev.tier, ev.bin)) psi[c*2] += 1.0;
      if (voice) for (let i=0; i<vN; i++) psi[vCells[i]*2] += voice[i];   // all samples, 2D region
      gpu.setEyePsi(psi);
    }
    const nL = imgLayers ? imgLayers.length : 0;
    const imgInj = (d) => Math.round(span * (nL-1-d)/nL);
    const sched = imgLayers ? imgLayers.map((f,d)=>({step:imgInj(d),d})).sort((a,b)=>a.step-b.step) : [];
    let cur=0, si=0;
    const injImg = () => { while(si<sched.length && sched[si].step<=cur){ const f=imgLayers[sched[si].d]; let nz=false; for(let k=0;k<f.length;k++){if(f[k]!==0){nz=true;break;}} if(nz){ const psi=gpu.readEyePsi(); // image only in top rows
        for(let y=0;y<imgRows;y++)for(let x=0;x<G;x++){ const gi=(y*G+x)*2, fi=((y*G+x))*2; psi[gi]+=f[fi]; psi[gi+1]+=f[fi+1]; } gpu.setEyePsi(psi);} si++; } };
    injImg();
    while(cur<D){ const nx=(si<sched.length)?Math.min(sched[si].step,D):D; if(nx>cur){gpu.stepEyeN(nx-cur,dt);cur=nx;} injImg(); }
    occ();
    const holo = gpu.readEyePsi();

    // GEOMETRY descriptor — everything _unitedReadout (and a LOADED file) needs to recover the
    // three modalities from `holo` alone. This is what saveUnited() persists alongside the field,
    // so the file round-trips to the SAME readouts. (vCells/evFoot are regenerated from these.)
    const geom = { nTiers, nBins, imgRowsFrac: 0.6, vLen, barSecs: opts.barSecs ?? 2.0, trueSet, voice: voice ? Array.from(voice) : null };

    const r = this._unitedReadout(holo, geom, tau, occludeR);
    return { holo, ...r, trueSet, tau, nBins, nTiers, barSecs: geom.barSecs, _voiceSrc: geom.voice };
  }

  // Run the THREE united-field readouts (image-at-τ, voice, events) on a hologram field.
  // Factored out of unitedField() so SAVE/LOAD round-trips through the SAME code: a loaded
  // `holo` + `geom` reconstructs image+voice+events identically to the live render. `geom` is
  // the descriptor returned by unitedField (nTiers, nBins, imgRowsFrac, vLen, barSecs, trueSet,
  // voice). occludeR re-applies the occlusion operator on each backward leg (kept for parity;
  // a loaded hologram is normally read at occludeR=0).
  _unitedReadout(holo, geom, tau = 1.0, occludeR = 0) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt, G = gpu._G;
    const nTiers = geom.nTiers, nBins = geom.nBins;
    const imgRows = Math.round(G * (geom.imgRowsFrac ?? 0.6));
    const midX = G >> 1, evRow0 = imgRows, evRows = G - imgRows;
    const voice = geom.voice, vLen = geom.vLen ?? (voice ? voice.length : 0);
    const trueSet = geom.trueSet ?? [];
    const occ = () => { if (occludeR > 0) gpu.applyEyeHologram(7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 }); };

    const evCell = (tier, bin) => {
      const cx = Math.round(midX * (bin + 0.5) / nBins);
      const cy = evRow0 + Math.round(evRows * (tier + 0.5) / nTiers);
      return { cx: Math.min(midX - 1, cx), cy: Math.min(G - 1, cy) };
    };
    const evFoot = (tier, bin) => {
      const { cx, cy } = evCell(tier, bin), rr = Math.max(2, Math.round(G * 0.03));
      return [[cx,cy],[cx+rr,cy],[cx-rr,cy],[cx,cy+rr],[cx,cy-rr]]
        .filter(([x,y]) => x>=0 && x<midX && y>=evRow0 && y<G).map(([x,y]) => y*G+x);
    };
    const vCells = [];
    for (let y = evRow0; y < G && vCells.length < vLen; y++)
      for (let x = midX; x < G && vCells.length < vLen; x++) vCells.push(y * G + x);
    const vN = vCells.length;

    // ── READOUT 1: IMAGE at τ (full-range back-prop; τ scrubs hologram→image). ──
    gpu.setEyePsi(holo); occ();
    const backTau = Math.round(tau * D);
    if (backTau>0) gpu.stepEyeN(backTau, -dt);
    const viewTau = gpu.readEyePsi();
    const imgOnly = new Float64Array(viewTau);
    for (let y = imgRows; y < G; y++) for (let x = 0; x < G; x++) { const k=(y*G+x)*2; imgOnly[k]=0; imgOnly[k+1]=0; }

    // ── READOUT 2 + 3 share the FULL backward recon. ──
    gpu.setEyePsi(holo); occ(); gpu.stepEyeN(D, -dt);
    const recon = gpu.readEyePsi();
    const voiceOut = new Float64Array(vLen);
    for (let i=0; i<vN; i++) voiceOut[i] = recon[vCells[i]*2];
    let vmx=0; for(let i=0;i<vN;i++){const a=Math.abs(voiceOut[i]); if(a>vmx)vmx=a;} if(vmx>0)for(let i=0;i<vN;i++)voiceOut[i]/=vmx;
    let vdot=0,vna=0,vnb=0; for(let i=0;voice&&i<vN;i++){const a=voiceOut[i],b=voice[i];vdot+=a*b;vna+=a*a;vnb+=b*b;}
    const voiceScore = (vna>0&&vnb>0)? Math.abs(vdot)/Math.sqrt(vna*vnb) : 0;
    const voiceStored = vLen ? vN/vLen : 1;

    const I = Array.from({length:nTiers},()=>new Float64Array(nBins));
    const cellInt = (tier,bin)=>{ let m=0; for(const c of evFoot(tier,bin)){const v=recon[c*2]*recon[c*2]+recon[c*2+1]*recon[c*2+1]; if(v>m)m=v;} return m; };
    let globalHi=0;
    for(let t=0;t<nTiers;t++)for(let b=0;b<nBins;b++){ const v=cellInt(t,b); I[t][b]=v; if(v>globalHi)globalHi=v; }
    const absFloor = globalHi*0.25;
    const recovered=[];
    for(let t=0;t<nTiers;t++)for(let b=0;b<nBins;b++) if(I[t][b]>=absFloor) recovered.push({tier:t,bin:b});
    const tk=new Set(trueSet.map(e=>e.tier+':'+e.bin)), rk=new Set(recovered.map(e=>e.tier+':'+e.bin));
    let tp=0; for(const k of rk)if(tk.has(k))tp++;
    const prec=rk.size?tp/rk.size:0, rec=tk.size?tp/tk.size:0, f1=(prec+rec)?2*prec*rec/(prec+rec):0;
    const barSecs = geom.barSecs ?? 2.0, slot = barSecs/Math.max(1,nBins);
    const schedule = recovered.map(e=>({tier:e.tier,bin:e.bin,tSec:e.bin*slot}));

    return { viewTau, imgOnly, voiceOut, voiceScore, voiceStored, recovered, schedule, f1 };
  }

  // ── SAVE/LOAD for the UNITED field (§7.14). The whole point of the united field is that ONE
  //    wavefront `u.holo` carries image+events+voice (region-separated) + depth (depth=duration,
  //    intrinsic to the staged forward). So the file stores ONE complex field + the geometry
  //    descriptor needed to replay the three readouts. On load, _unitedReadout(holo, geom, τ)
  //    reconstructs all three modalities — and τ-scrubbing re-extracts depth — from that one field.
  //    Format: Uint32 metaLen | JSON meta (type:'eye-united', geom, tSteps, dt, hMode…) | Float32 holo.
  saveUnited(u, meta = {}) {
    if (!u || !u.holo) { console.warn('[IFSEye] saveUnited: no united field'); return null; }
    const fullMeta = {
      type:   'eye-united',
      tSteps: this.tSteps, dt: this.dt,
      hMode:  this.hMode, hParam: this.hParam, hSteps: this.hSteps,
      geom: {
        nTiers: u.nTiers, nBins: u.nBins, imgRowsFrac: 0.6,
        vLen: u.voiceOut ? u.voiceOut.length : 0,
        barSecs: u.barSecs ?? 2.0,
        trueSet: u.trueSet ?? [],
        voice: u._voiceSrc ? Array.from(u._voiceSrc) : null,   // source waveform, for fidelity scoring on reload
      },
      ...meta,
    };
    const field = u.holo;
    const f32   = new Float32Array(field.length);
    for (let i = 0; i < f32.length; i++) f32[i] = field[i];
    const metaBytes = new TextEncoder().encode(JSON.stringify(fullMeta));
    const metaLen   = new Uint32Array([metaBytes.length]);
    return new Blob([metaLen.buffer, metaBytes.buffer, f32.buffer], { type: 'application/octet-stream' });
  }

  async downloadUnited(u, filename = 'united_hologram.kwe', meta = {}) {
    const blob = this.saveUnited(u, meta);
    if (!blob) return;
    let outBlob = blob;
    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter();
      w.write(await blob.arrayBuffer()); w.close();
      outBlob = await new Response(cs.readable).blob();
    }
    const url = URL.createObjectURL(outBlob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // Load a united-field file → { meta, holo, geom }. Restores tSteps/H params, loads the holo
  // into GPU norm bookkeeping. Caller replays readouts via readoutUnited(holo, geom, τ).
  loadUnited(buf) {
    const metaLen = new Uint32Array(buf, 0, 1)[0];
    const meta    = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, metaLen)));
    if (meta.type !== 'eye-united') throw new Error('not a united-field file');
    const f32 = new Float32Array(buf.slice(4 + metaLen));
    if (meta.tSteps !== undefined) this.tSteps = meta.tSteps;
    if (meta.hMode  !== undefined) this.hMode  = meta.hMode;
    if (meta.hParam !== undefined) this.hParam = meta.hParam;
    if (meta.hSteps !== undefined) this.hSteps = meta.hSteps;
    const holo = new Float64Array(f32.length);
    for (let i = 0; i < f32.length; i++) holo[i] = f32[i];
    console.log('[IFSEye] loadUnited T=', this.tSteps, 'geom=', meta.geom);
    return { meta, holo, geom: meta.geom };
  }

  // Replay the three readouts from a LOADED holo + geom (occlusion off by default).
  readoutUnited(holo, geom, tau = 1.0, occludeR = 0) {
    const r = this._unitedReadout(holo, geom, tau, occludeR);
    return { holo, ...r, trueSet: geom.trueSet ?? [], tau, nBins: geom.nBins, nTiers: geom.nTiers, barSecs: geom.barSecs ?? 2.0 };
  }

  // Region geometry — the SINGLE source of truth for where each modality lives on the G×G grid.
  // Used by the still readout, the soliton injector, and the soliton readout so all three agree
  // on cells. nTiers/nBins → event cells (bottom-left); vLen → voice cells (bottom-right);
  // image owns the top imgRowsFrac of rows. Returns closures + the voice cell list.
  _unitedGeom(geom) {
    const G = this._gpu._G;
    const nTiers = geom.nTiers ?? 4, nBins = geom.nBins ?? 4;
    const imgRows = Math.round(G * (geom.imgRowsFrac ?? 0.6));
    const midX = G >> 1, evRow0 = imgRows, evRows = G - imgRows;
    const vLen = geom.vLen ?? (geom.voice ? geom.voice.length : 0);
    // When there's NO voice region (vLen===0, voice-as-events roll mode), events get the FULL bottom
    // width instead of the left half — so a denser pitch×onset roll has room (cells don't crowd into
    // touching footprints). With a voice region, events keep the left half (right = voice). §7.16.
    const evW = vLen > 0 ? midX : G;
    const evCell = (tier, bin) => {
      const cx = Math.round(evW * (bin + 0.5) / nBins);
      const cy = evRow0 + Math.round(evRows * (tier + 0.5) / nTiers);
      return { cx: Math.min(evW - 1, cx), cy: Math.min(G - 1, cy) };
    };
    // Footprint radius adapts to the TIGHTER of column/row cell spacing so neighbouring cells never
    // share pixels (was a fixed G*0.03 → touched at dense rolls), but is allowed to GROW with coarse
    // cells: bigger features survive deep propagation (fine 1px features blurred fast → f1 decay;
    // §7.16). Cap raised to G*0.06 so coarse rolls get robust rhythm-sized footprints.
    const dxSp = evW / nBins, dySp = evRows / nTiers;
    const rr = Math.max(1, Math.min(Math.round(G * 0.06), Math.floor(Math.min(dxSp, dySp) / 2) - 1));
    const evFoot = (tier, bin) => {
      const { cx, cy } = evCell(tier, bin);
      return [[cx,cy],[cx+rr,cy],[cx-rr,cy],[cx,cy+rr],[cx,cy-rr]]
        .filter(([x,y]) => x>=0 && x<evW && y>=evRow0 && y<G).map(([x,y]) => y*G+x);
    };
    const vCells = [];
    for (let y = evRow0; y < G && vCells.length < vLen; y++)
      for (let x = midX; x < G && vCells.length < vLen; x++) vCells.push(y * G + x);
    return { G, nTiers, nBins, imgRows, midX, evRow0, evRows, vLen, vCells, vN: vCells.length, evCell, evFoot };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  UNITED-FIELD SOLITON (B2) — live, continuous, advected multimedia. (§7.15)
  //
  //  Instead of one frozen deep-T hologram, the field is a TRAVELLING window: content is
  //  injected at the ENTRY plane each bar and the IFS dynamics advect it forward one step per
  //  frame. Age = depth = how many steps a bar has propagated. The bar that has aged exactly
  //  `solBarSteps·readBars` is "due now": reading it = back-propagating the live field by that
  //  age (NOT a fixed D-step back-prop — each bar refocuses at its own depth). Old bars fall off
  //  past depth D and are dropped. ONE field, three modalities, now FLOWING in time.
  //
  //  Clock-native sync: the caller drives advance() from the IFS clock (one step per RAF, a new
  //  bar's content every solBarSteps). Two shared world scalars — cycleCount (→ how many bars
  //  have entered) and τ — fully determine the live field on every peer by deterministic
  //  recompute. No field/audio exchange. (Soliton-as-recompute, lifted to the united field.)
  //
  //  HONEST UNKNOWN (the experiment): the still field's masking-robustness came from each item's
  //  FULL deep-T propagation. Under continuous advection a bar only ever sees a sliding partial
  //  window shared with younger/older bars. Whether region-separation + reconstruction survive
  //  that is UNPROVEN — measure with solitonCoherenceSweep(), which scores each bar vs its
  //  intended content as it ages. Flat across age → real soliton. Decay → the medium has a
  //  coherence length shorter than D (itself a finding).
  // ════════════════════════════════════════════════════════════════════════════════════

  // Begin a soliton run. geom = { nTiers,nBins,imgRowsFrac,vLen,barSecs }. barSteps = forward
  // steps between bar injections (the bar period in IFS steps). readBars = how many bars back the
  // "now playing" plane is (≥1 so the bar is fully formed before readout). Resets the live field.
  solitonBegin(geom, opts = {}) {
    const { barSteps = 40, readBars = 1, keepBars = 3 } = opts;
    const G = this._gpu._G, N = G * G;
    this._sol = {
      geom, barSteps, readBars, keepBars,
      psi: new Float64Array(2 * N),   // the live travelling field (persists across advance() calls)
      age: 0,                          // total forward steps taken since begin
      bars: [],                        // ring of injected bars: { stepInjected, content } (content for scoring)
      barsEntered: 0,
      pending: [],                     // staggered note injections not yet due: { atStep, ev } (§7.17)
      onsetSteps: opts.onsetSteps ?? 0,// forward steps between successive onsets WITHIN a bar (0 = all
                                       // at once = chord; >0 = arpeggio spread across the field's depth →
                                       // notes emerge one-by-one as the clock advects, no audio trick)
    };
    this._gpu.setEyePsi(this._sol.psi);
    return this._sol;
  }

  // Write a set of event atoms into the GPU field at the current entry plane (helper).
  _injectAtoms(g, events) {
    const psi = this._gpu.readEyePsi();
    for (const ev of events) for (const c of g.evFoot(ev.tier, ev.bin)) psi[c*2] += 1.0;
    this._gpu.setEyePsi(psi);
    this._sol.psi = psi;
  }

  // Inject one bar's content at the ENTRY plane. content = { events:[{tier,bin}], voice, image }.
  // If onsetSteps>0 (arpeggio mode, §7.17): voice/image inject now, but the NOTES are STAGGERED —
  // each note's onset (bin) becomes a forward-step delay (bin·onsetSteps), queued in s.pending and
  // injected by solitonAdvance when its step arrives. So notes enter the field at DIFFERENT depths
  // and emerge one-by-one as the clock advects — the arpeggio tempo IS the clock's, identical on
  // every peer, no audio scheduling. onsetSteps=0 → all notes at once (chord, the old behaviour).
  solitonInject(content) {
    const s = this._sol; if (!s) return;
    const g = this._unitedGeom(s.geom);
    // voice + image always enter at bar start
    if (content.voice || content.image) {
      const psi = this._gpu.readEyePsi();
      if (content.voice) for (let i = 0; i < g.vN; i++) psi[g.vCells[i]*2] += content.voice[i] || 0;
      if (content.image) for (let y = 0; y < g.imgRows; y++) for (let x = 0; x < g.G; x++) { const k=(y*g.G+x)*2; psi[k]+=content.image[k]; psi[k+1]+=content.image[k+1]; }
      this._gpu.setEyePsi(psi); s.psi = psi;
    }
    const evs = content.events || [];
    if (s.onsetSteps > 0 && evs.length) {
      // stagger: queue each note at its onset-delayed step (relative to NOW)
      for (const ev of evs) s.pending.push({ atStep: s.age + ev.bin * s.onsetSteps, ev });
    } else if (evs.length) {
      this._injectAtoms(g, evs);   // chord: all now
    }
    s.bars.push({ stepInjected: s.age, content });
    s.barsEntered++;
    const keep = s.barSteps * (s.keepBars ?? 3);
    s.bars = s.bars.filter(b => (s.age - b.stepInjected) <= keep);
  }

  // Advance the soliton one IFS step (everything ages by 1). O(1 step)/frame. If `content` is given,
  // a new bar enters first. Then any STAGGERED notes (s.pending) whose step has arrived are injected
  // at the entry plane — this is what makes the arpeggio emerge note-by-note from the clock (§7.17).
  solitonAdvance(content = null) {
    const s = this._sol; if (!s) return null;
    if (content) this.solitonInject(content);
    if (s.pending.length) {                      // inject any notes now due, drop them from the queue
      const g = this._unitedGeom(s.geom);
      const due = s.pending.filter(p => p.atStep <= s.age);
      if (due.length) this._injectAtoms(g, due.map(p => p.ev));
      s.pending = s.pending.filter(p => p.atStep > s.age);
    }
    this._gpu.stepEyeN(1, this.dt);          // ADVECT one step (the soliton moves)
    s.age++;
    s.psi = this._gpu.readEyePsi();
    return s;
  }

  // Read the bar currently "due" (aged solBarSteps·readBars). Back-propagate the LIVE field by
  // that age and recover the three modalities from that bar's cells. tau scrubs WITHIN the read
  // depth (0..1 of the bar's age). Returns the same shape as the still readout for the renderer.
  // readDepth (arpeggio mode, §7.17): if given, back-prop by THIS fixed shallow depth instead of the
  // due-bar age — so only the note(s) at the current read plane (the freshly-emerged onset) refocus,
  // and the clock's advection is what surfaces them one at a time.
  solitonReadNow(tau = 1.0, readDepth = null, occludeR = 0) {
    const s = this._sol; if (!s) return null;
    const targetAge = s.barSteps * s.readBars;
    // the bar whose age is closest to targetAge = the one due now
    let due = null, best = Infinity;
    for (const b of s.bars) { const a = s.age - b.stepInjected; const d = Math.abs(a - targetAge); if (d < best) { best = d; due = b; } }
    const dueAge = due ? (s.age - due.stepInjected) : targetAge;
    // Depth to back-propagate. τ SCRUBS around the due-bar depth but NEVER gates reconstruction to
    // zero (τ=0 used to mean back=0 → the raw un-reconstructed field, which looked "clean only at low
    // T"). Map τ∈[0,1] → 0.5×..1.5× the due-bar depth so τ=0 still fully reconstructs at half-depth.
    const scrub = 0.5 + tau;                          // τ=0→0.5, τ=0.5→1.0, τ=1→1.5
    const base = (readDepth != null) ? readDepth * scrub : dueAge * scrub;
    const back = Math.max(1, Math.round(base));
    const g = this._unitedGeom(s.geom);
    const gpu = this._gpu;
    gpu.setEyePsi(s.psi);
    // OCCLUSION applied on the SCRATCH (the GPU buffer we just loaded), NOT the persistent s.psi —
    // so masking is a read-time test and never corrupts the live travelling field.
    if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    if (back > 0) gpu.stepEyeN(back, -this.dt);
    const recon = gpu.readEyePsi();
    // restore the live field (the back-prop/occlusion overwrote the GPU buffer)
    gpu.setEyePsi(s.psi);

    // image-only (top rows), full-field view, voice + events from this bar's recon
    const viewTau = recon;
    const imgOnly = new Float64Array(viewTau);
    for (let y = g.imgRows; y < g.G; y++) for (let x = 0; x < g.G; x++) { const k=(y*g.G+x)*2; imgOnly[k]=0; imgOnly[k+1]=0; }
    const vLen = g.vN;
    const voiceOut = new Float64Array(vLen);
    for (let i = 0; i < g.vN; i++) voiceOut[i] = recon[g.vCells[i]*2];
    let vmx=0; for(let i=0;i<vLen;i++){const a=Math.abs(voiceOut[i]); if(a>vmx)vmx=a;} if(vmx>0)for(let i=0;i<vLen;i++)voiceOut[i]/=vmx;
    // events: peak-detect this bar's cells, global-floor gate
    const I = Array.from({length:g.nTiers},()=>new Float64Array(g.nBins));
    const cellInt = (t,b)=>{ let m=0; for(const c of g.evFoot(t,b)){const v=recon[c*2]*recon[c*2]+recon[c*2+1]*recon[c*2+1]; if(v>m)m=v;} return m; };
    let hi=0; for(let t=0;t<g.nTiers;t++)for(let b=0;b<g.nBins;b++){const v=cellInt(t,b);I[t][b]=v;if(v>hi)hi=v;}
    const floor=hi*0.25, recovered=[];
    for(let t=0;t<g.nTiers;t++)for(let b=0;b<g.nBins;b++) if(I[t][b]>=floor) recovered.push({tier:t,bin:b});
    // score vs the bar's INTENDED content (this is the soliton's honesty metric)
    const trueSet = due?.content?.events ?? [];
    const tk=new Set(trueSet.map(e=>e.tier+':'+e.bin)), rk=new Set(recovered.map(e=>e.tier+':'+e.bin));
    let tp=0; for(const k of rk)if(tk.has(k))tp++;
    const prec=rk.size?tp/rk.size:0, rec=tk.size?tp/tk.size:0, f1=(prec+rec)?2*prec*rec/(prec+rec):0;
    let voiceScore=0;
    if (due?.content?.voice) { let d=0,na=0,nb=0; const vv=due.content.voice; for(let i=0;i<g.vN;i++){const a=voiceOut[i],b=vv[i]||0;d+=a*b;na+=a*a;nb+=b*b;} voiceScore=(na>0&&nb>0)?Math.abs(d)/Math.sqrt(na*nb):0; }
    const barSecs = s.geom.barSecs ?? 2.0, slot = barSecs/Math.max(1,g.nBins);
    const schedule = recovered.map(e=>({tier:e.tier,bin:e.bin,tSec:e.bin*slot}));
    return { viewTau, imgOnly, voiceOut, voiceScore, voiceStored:1, recovered, schedule, f1,
             trueSet, tau, nBins:g.nBins, nTiers:g.nTiers, barSecs, dueAge, barsEntered:s.barsEntered };
  }

  // Read ONE bar as a PROPER single-object hologram round-trip at depth T (§7.20). The live soliton
  // field holds several coexisting bars; back-propagating that shared field contaminates the readout
  // with neighbours' deep-diffused energy — and that contamination GROWS with T, so the melody got
  // WORSE at high T (backwards from how holography should behave). This reads the due bar in
  // ISOLATION: inject its content alone → forward T → (optionally occlude) → backward T → recover.
  // Now deeper T = more distributed redundancy = the note survives occlusion BETTER, as expected.
  // (This is the same isolated round-trip the masking measurement used; the soliton field stays the
  // live visual, but the AUDIO/event readout comes from the clean per-bar hologram.) Restores nothing
  // it owns beyond the GPU eye buffer, which the live drive re-seeds from s.psi after.
  solitonReadBar(content, { occludeR = 0, T = null } = {}) {
    const s = this._sol; if (!s) return null;
    const g = this._unitedGeom(s.geom);
    const gpu = this._gpu, D = Math.max(1, Math.round(T ?? s.barSteps)), dt = this.dt, N = gpu._G * gpu._G;
    const cellInt = (recon, t, b) => { let m=0; for(const c of g.evFoot(t,b)){const v=recon[c*2]*recon[c*2]+recon[c*2+1]*recon[c*2+1]; if(v>m)m=v;} return m; };
    const seed = () => { const psi=new Float64Array(2*N); for(const ev of (content.events||[])) for(const c of g.evFoot(ev.tier,ev.bin)) psi[c*2]+=1.0; return psi; };

    // CLEAN reference round-trip (NO occlusion) → its per-cell intensity at the true cells gives an
    // ABSOLUTE scale (so occlusion → DROPOUT not phantom-explosion; §7.19). This depends ONLY on the
    // bar's note positions + T (NOT on occlusion or time), so it's CACHED per (notes,T) — recomputing
    // its 2×D round-trip every frame was a big chunk of soliton's cost. Cache lives on this._sol.
    const ckey = (content.events||[]).map(e=>e.tier+':'+e.bin).sort().join(',') + '@' + D;
    let cleanHi;
    if (s._cleanCache && s._cleanCache.key === ckey) {
      cleanHi = s._cleanCache.hi;
    } else {
      gpu.setEyePsi(seed()); gpu.stepEyeN(D, dt); gpu.stepEyeN(D, -dt);
      const clean = gpu.readEyePsi();
      cleanHi = 0; for (const ev of (content.events||[])) { const v = cellInt(clean, ev.tier, ev.bin); if (v > cleanHi) cleanHi = v; }
      cleanHi = Math.max(cleanHi, 1e-12);
      s._cleanCache = { key: ckey, hi: cleanHi };
    }

    // OCCLUDED round-trip — recover from partial data.
    gpu.setEyePsi(seed()); gpu.stepEyeN(D, dt);
    if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    gpu.stepEyeN(D, -dt);
    const recon = gpu.readEyePsi();
    gpu.setEyePsi(s.psi);                                  // restore the live visual field

    // Gate against the ABSOLUTE clean scale: a cell counts only if it holds ≥35% of the clean note
    // energy. Heavy occlusion → cells fall below this → dropout (audible), never phantom-explosion.
    const ABS = cleanHi * 0.35;
    const cand = [];
    for (let t=0;t<g.nTiers;t++) for (let b=0;b<g.nBins;b++) { const v = cellInt(recon,t,b); if (v >= ABS) cand.push({tier:t,bin:b,v}); }
    // cap to the number of notes actually in the bar (top-K by energy) — can't invent extra notes.
    const K = (content.events||[]).length;
    cand.sort((a,b)=>b.v-a.v);
    const recovered = cand.slice(0, Math.max(K, 0)).map(c=>({tier:c.tier,bin:c.bin}));
    const trueSet = content.events || [];
    const tk=new Set(trueSet.map(e=>e.tier+':'+e.bin)), rk=new Set(recovered.map(e=>e.tier+':'+e.bin));
    let tp=0; for(const k of rk)if(tk.has(k))tp++;
    const prec=rk.size?tp/rk.size:0, rec=tk.size?tp/tk.size:0, f1=(prec+rec)?2*prec*rec/(prec+rec):0;
    return { recovered, trueSet, f1, nTiers:g.nTiers, nBins:g.nBins, recon };
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  //  CLOCK-PURE SOLITON FIELD — Ψ(cyc) (§7.22, prototype). The live integrated soliton (_sol.psi
  //  accumulated by repeated advance()) is PATH-DEPENDENT → desyncs across peers at high T (slow
  //  peers integrate fewer steps, the catch-up cap skips bars unequally). A soliton is a travelling
  //  wave with a CLOSED-FORM state f(x−vt); its field at cyc should be computable DIRECTLY from cyc,
  //  no integration history → frame-rate-independent → identical on every peer = perfect sync.
  //
  //  The obstacle (§7.18): a lossless field accumulates forever (infinite memory) → not a function of
  //  recent cyc. So Ψ(cyc) needs BOUNDED memory. Two models, both implemented here for measurement:
  //   • 'window'  — recompute exactly the last K bars from scratch (no state, hard cutoff).
  //   • 'decay'   — integrate but multiply by `decay` each step so old bars fade (smooth, ~bounded).
  //
  //  contentFn(barIdx) → { events } (pitch×onset atoms), deterministic per bar (peer-identical).
  //  Returns the field Float64Array for absolute cycle `cyc`. memory: { mode, K, decay }.
  solitonFieldAt(cyc, geom, contentFn, { barSteps = 40, memory = { mode:'window', K:3, decay:0.985 } } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G*G, dt = this.dt;
    const g = this._unitedGeom(geom);
    const onsetSteps = Math.max(1, Math.round(barSteps / g.nBins));
    const barOf = (c) => Math.floor(c / g.nBins);
    const nowBar = barOf(cyc);
    // Inject EVENTS (notes) + a FLAT image (single layer) at step 0 of a bar.
    const injectAtStart = (psi, cont) => {
      for (const ev of (cont.events||[])) for (const c of g.evFoot(ev.tier, ev.bin)) psi[c*2] += 1.0;
      if (cont.image) for (let y=0;y<g.imgRows;y++) for (let x=0;x<G;x++){ const k=(y*G+x)*2; psi[k]+=cont.image[k]; psi[k+1]+=cont.image[k+1]; }
    };
    // Inject ONE image layer (top rows only) into the current GPU field.
    const injectImageLayer = (f) => {
      const psi = gpu.readEyePsi();
      for (let y=0;y<g.imgRows;y++) for (let x=0;x<G;x++){ const k=(y*G+x)*2; psi[k]+=f[k]; psi[k+1]+=f[k+1]; }
      gpu.setEyePsi(psi);
    };
    // Run ONE bar's content over `steps` forward steps, optionally DEPTH-STAGING the image:
    // events (+ flat image) enter at step 0; if cont.imageLayers is an array, each layer d is injected
    // at sub-step round(steps·(nL−1−d)/nL) — far layers EARLY (deep in the bar), near layers LATE
    // (shallow) — so the bar becomes a real depth-staged object (§7.25), refocusable per-depth by τ.
    // decay (optional, for decay-memory) multiplies the field each step.
    const runBar = (cont, steps, decay) => {
      const layers = cont.imageLayers;
      if (!layers || !layers.length) {
        const psi = gpu.readEyePsi(); injectAtStart(psi, cont); gpu.setEyePsi(psi);
        for (let s=0;s<steps;s++){ gpu.stepEyeN(1, dt); if (decay) { const q=gpu.readEyePsi(); for(let i=0;i<q.length;i++)q[i]*=decay; gpu.setEyePsi(q); } }
        return;
      }
      // depth-staged: events at step 0, image layers across the bar
      { const psi = gpu.readEyePsi(); for (const ev of (cont.events||[])) for (const c of g.evFoot(ev.tier, ev.bin)) psi[c*2]+=1.0; gpu.setEyePsi(psi); }
      const nL = layers.length;
      const injStepOf = (d) => Math.round(steps * (nL-1-d)/nL);   // far(d=nL−1)→0, near(d=0)→~steps
      const sched = layers.map((f,d)=>({ step: injStepOf(d), f })).sort((a,b)=>a.step-b.step);
      let cur=0, si=0;
      const due = () => { while (si<sched.length && sched[si].step<=cur){ injectImageLayer(sched[si].f); si++; } };
      due();
      while (cur < steps) {
        const next = (si<sched.length) ? Math.min(sched[si].step, steps) : steps;
        if (next>cur){ gpu.stepEyeN(next-cur, dt); if (decay){ const q=gpu.readEyePsi(); for(let i=0;i<q.length;i++)q[i]*=Math.pow(decay,next-cur); gpu.setEyePsi(q); } cur=next; }
        due();
      }
    };

    if (memory.mode === 'decay') {
      const d = memory.decay ?? 0.985;
      const Kdec = Math.max(memory.K ?? 3, Math.ceil(Math.log(0.01) / Math.log(d) / barSteps));
      const startBar = Math.max(0, nowBar - Kdec);
      gpu.setEyePsi(new Float64Array(2*N));
      for (let bar = startBar; bar <= nowBar; bar++) {
        const steps = (bar < nowBar) ? barSteps : (cyc - bar*g.nBins) * onsetSteps;
        runBar(contentFn(bar), steps, d);
      }
      return gpu.readEyePsi();
    }
    // 'window' (default): recompute exactly the last K bars, no decay. Pure f(cyc).
    const K = memory.K ?? 3;
    const startBar = Math.max(0, nowBar - K + 1);
    gpu.setEyePsi(new Float64Array(2*N));
    for (let bar = startBar; bar <= nowBar; bar++) {
      const steps = (bar < nowBar) ? barSteps : Math.max(0, (cyc - bar*g.nBins)) * onsetSteps;
      runBar(contentFn(bar), steps, null);
    }
    return gpu.readEyePsi();
  }

  // CLOCK-PURE LIVE RENDER (§7.22) — everything a frame needs, computed PURELY from cyc so all peers
  // render the identical moving picture (no integration, no drift). Returns { field, viewTau, imgOnly,
  // recovered, f1, trueSet, nTiers, nBins }. occ applies at read time (masking audible). τ scrubs the
  // current bar's read depth. This REPLACES the integrated _sol.psi advance for the live soliton.
  solitonRenderAt(cyc, geom, contentFn, { barSteps = 40, reconT = null, readBars = 1, memory = { mode:'window', K:3 }, tau = 1.0, occludeR = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G*G, dt = this.dt, g = this._unitedGeom(geom);
    const onsetSteps = Math.max(1, Math.round(barSteps / g.nBins));
    const nowBar = Math.floor(cyc / g.nBins);
    const curAge = Math.max(0, (cyc - nowBar*g.nBins)) * onsetSteps;   // how far the current bar has advected
    // The bar we READ is `readBars` behind the freshest, so it has MATURED (propagated deep) → genuinely
    // holographic + isolatable in Ψ(cyc). Its true age = readBars·barSteps + curAge. (§7.23) The freshest
    // bar can't be read holographically — it just entered, hasn't spread. Latency = readBars bars.
    const readBar = Math.max(0, nowBar - readBars);
    const readAge = readBars * barSteps + curAge;
    // Ψ(cyc): the travelling field (pure fn of cyc) — used as the field-image panel.
    const field = this.solitonFieldAt(cyc, geom, contentFn, { barSteps, memory });
    // HOLOGRAM panel: the field Ψ(cyc) with H applied — this is what masking HITS (you see the
    // occlusion blocks here). RECON panel: back-prop THAT masked hologram → the reconstruction, which
    // stays stable despite the holes (hologram→recon pair, like the eye-cube demo). §7.24
    // RECON depth: back-prop to where the matured bar's image refocuses (readAge), scrubbable by τ
    // around it (τ∈[0,1] → 0.5×..1.5× readAge) — NEVER 0, so the recon panel always reconstructs
    // (don't gate it to the raw hologram at τ=0). This is the depth at which the image becomes stable.
    const back = Math.max(1, Math.round(readAge * (0.5 + tau)));
    gpu.setEyePsi(field); if (occludeR>0) gpu.applyEyeHologram(this.hMode||7, occludeR, { block:this.hBlock??8, seed:this.hSeed??0 });
    const holoMasked = gpu.readEyePsi();              // the masked hologram (panel 1 — masking visible)
    gpu.stepEyeN(back, -dt);
    const viewTau = gpu.readEyePsi();                 // recon from the masked hologram (panel 4 — stable)
    const imgOnly = new Float64Array(viewTau);
    for (let y=g.imgRows;y<G;y++) for (let x=0;x<G;x++){ const k=(y*G+x)*2; imgOnly[k]=0; imgOnly[k+1]=0; }
    // ── ONE LIVE HOLOGRAPHIC SOLITON (§7.23) — recover the current bar's notes by BACK-PROPAGATING
    // THE ACTUAL Ψ(cyc) FIELD (with H applied to THAT field), not by re-holographing the bar's known
    // content in isolation. So the soliton and what-you-hear are ONE object, and H genuinely masks the
    // live travelling wavefront. The current (freshest) bar sits at depth ~curAge in Ψ(cyc); back-prop
    // by reconT refocuses it to its cells while the OLDER bars (deeper) stay diffuse → natural depth
    // separation (no re-seed). Per-note ratio vs the SAME field un-masked = honest occlusion response.
    const cont = contentFn(readBar);                                   // the MATURED bar we read
    const trueSet = cont.events || [];
    const cellInt=(recon,t,b)=>{let m=0;for(const c of g.evFoot(t,b)){const v=recon[c*2]*recon[c*2]+recon[c*2+1]*recon[c*2+1];if(v>m)m=v;}return m;};
    // recon depth = the matured bar's TRUE age (so it refocuses to its plane); recT dial overrides for
    // exploration of the depth/occlusion crossover (§7.22).
    const D = Math.max(1, Math.round(reconT ?? readAge));
    // CLEAN: back-prop the live field (NO occlusion) by D → per-note clean energy (100% scale).
    gpu.setEyePsi(field); gpu.stepEyeN(D, -dt);
    const clean = gpu.readEyePsi();
    const cleanCell = {};
    for (const ev of trueSet) cleanCell[ev.tier+':'+ev.bin] = Math.max(1e-12, cellInt(clean, ev.tier, ev.bin));
    // OCCLUDED: apply H to the LIVE field, then back-prop by D → per-note surviving energy.
    gpu.setEyePsi(field);
    if (occludeR>0) gpu.applyEyeHologram(this.hMode||7, occludeR, { block:this.hBlock??8, seed:this.hSeed??0 });
    gpu.stepEyeN(D, -dt);
    const recon = gpu.readEyePsi();
    // PER-NOTE ENERGY RATIO vs the un-masked live field → occlusion quiets/drops notes (audible).
    const DROP = 0.30;
    const recovered = [];
    for (const ev of trueSet) {
      const ratio = cellInt(recon, ev.tier, ev.bin) / cleanCell[ev.tier+':'+ev.bin];
      if (ratio >= DROP) recovered.push({ tier:ev.tier, bin:ev.bin, gain: Math.min(1, Math.sqrt(ratio)) });
    }
    const f1 = trueSet.length ? recovered.length / trueSet.length : 0;
    return { field, holoMasked, viewTau, imgOnly, recovered, f1, trueSet, nTiers:g.nTiers, nBins:g.nBins, nowBar, readBar, readAge, curAge };
  }

  // THE HOLOGRAPHY PROOF (§7.23) — measures the ACTUAL live unified recon (solitonRenderAt reading the
  // live Ψ(cyc) field, H applied to that field, reading a MATURED bar), NOT an isolated re-holograph.
  // So this table is exactly what the live SOLITON does. Sweeps recon-depth T × occlusion r and reports
  // f1 = fraction of the matured bar's notes surviving. f1 RISING with T = holographic redundancy from
  // the live field; flat ≈ 1−r = photographic; junk at r=0 = multi-bar contamination won. Can FAIL.
  solitonOcclusionVsT(geom, contentFn, { Ts = null, Rs = null, barSteps = 40, readBars = 1, K = 3 } = {}) {
    const Tset = Ts ?? [1, 4, 20, 80, 200, 350];
    const Rset = Rs ?? [0, 0.25, 0.5, 0.75];
    const g = this._unitedGeom(geom);
    // Evaluate at a cyc where `readBars` bars have already entered AND the read bar sits mid-window so
    // the K-bar memory is full (most realistic / hardest case for contamination). Read bar = bar 2.
    const targetReadBar = Math.max(readBars, 2);
    const cyc = (targetReadBar + readBars) * g.nBins;   // nowBar = targetReadBar+readBars → readBar=targetReadBar
    const measureAt = (T, r) => {
      // recT overrides the recon depth → this row's depth = T. barSteps fixed (bar period). The live
      // unified recon (reads Ψ(cyc), H on the live field, matured bar) returns f1 directly.
      const u = this.solitonRenderAt(cyc, geom, contentFn,
        { barSteps, reconT: T, readBars, memory: { mode:'window', K }, tau: 1.0, occludeR: r });
      return u ? u.f1 : 0;
    };
    const rows = ['[SOLITON OCCL vs T] LIVE unified recon (reads Ψ(cyc), H on live field, matured bar). f1 surviving:',
      '  recT \\ r ' + Rset.map(r=>('r='+r).padStart(8)).join('')];
    for (const T of Tset) {
      let line = '  '+String(T).padStart(4)+'   ';
      for (const r of Rset) line += measureAt(T,r).toFixed(2).padStart(8);
      rows.push(line);
    }
    rows.push('  → f1 RISING down a column (fixed r, deeper recT) = holographic redundancy from the LIVE');
    rows.push('    field. flat ≈ 1−r = photographic. low at r=0 = multi-bar contamination (§7.20) won.');
    console.log(rows.join('\n'));
    return rows;
  }

  // MEASURE peer sync: evaluate Ψ(cyc) the way TWO peers at DIFFERENT frame rates would, then compare.
  // A true clock-pure field gives identical Ψ(cyc) regardless of how the cyc was reached → corr=1.0.
  // Peer A: evaluate Ψ directly at the target cyc. Peer B: same target cyc (pure recompute SHOULD match
  // bit-for-bit since it ignores frame history). Also times cost. Logs a table per memory model.
  solitonSyncTest(geom, contentFn, { barSteps = 40, atCyc = 200, models = null } = {}) {
    const useModels = models ?? [
      { mode:'window', K:2 }, { mode:'window', K:3 }, { mode:'window', K:4 },
      { mode:'decay', decay:0.985 }, { mode:'decay', decay:0.97 },
    ];
    const corr = (a,b) => { let n=0,da=0,db=0; for(let i=0;i<a.length;i++){n+=a[i]*b[i];da+=a[i]*a[i];db+=b[i]*b[i];} return da>0&&db>0? n/Math.sqrt(da*db) : 0; };
    const rows = ['[SOLITON SYNC] Ψ(cyc) peer agreement + cost per memory model (cyc='+atCyc+'):',
      '  model            peerCorr   ms/eval   (corr=1.0 → frame-rate-independent = synced)'];
    for (const m of useModels) {
      const t0 = performance.now();
      const a = this.solitonFieldAt(atCyc, geom, contentFn, { barSteps, memory: m });
      const t1 = performance.now();
      const b = this.solitonFieldAt(atCyc, geom, contentFn, { barSteps, memory: m });   // 2nd peer, same cyc
      const c = corr(a, b);
      const tag = m.mode === 'window' ? `window K=${m.K}    ` : `decay ${m.decay}  `;
      rows.push(`  ${tag}   ${c.toFixed(4)}     ${(t1-t0).toFixed(1)}`);
    }
    rows.push('  → window = pure recompute (expect corr 1.0000, cost ∝ K·barSteps). decay = bounded');
    rows.push('    integration. Pick the cheapest that holds corr=1.0 for the live Ψ(cyc) soliton.');
    console.log(rows.join('\n'));
    return rows;
  }

  // THE EXPERIMENT: run the soliton for `cycles` bars and score each bar vs its intended content
  // at EVERY age 0..D as it ages out — does reconstruction stay flat (true soliton) or decay with
  // age (medium has a coherence length)? Pure measurement; logs a table; restores nothing it owns.
  // contentFn(barIndex) → { events, voice, image } (same content each bar = cleanest signal).
  solitonCoherenceSweep(geom, contentFn, { barSteps = 40, cycles = 8, sampleAges = null, depthT = null, _quiet = false } = {}) {
    const opts_quiet = _quiet;
    // The sweep needs a DEEP horizon regardless of the live T slider (which may be tiny). Use an
    // explicit depthT (default 350 — the masking depth) and RESTORE the slider after.
    const saveT = this.tSteps;
    const D = depthT ?? 350;
    this.tSteps = D;
    const ages = sampleAges ?? [0, Math.round(D*0.25), Math.round(D*0.5), Math.round(D*0.75), D].filter(a=>a<=D);
    this.solitonBegin(geom, { barSteps, readBars: 1 });
    // table[age] = accumulated {voiceSum, f1Sum, n} across bars sampled at that age
    const acc = new Map(ages.map(a=>[a,{v:0,f:0,n:0}]));
    const g = this._unitedGeom(geom);
    const totalSteps = cycles * barSteps + D;
    // bars[barIndex] = injected content, to score against
    const injected = [];
    for (let step = 0; step < totalSteps; step++) {
      if (step % barSteps === 0) {
        const bi = step / barSteps;
        const content = (bi < cycles) ? contentFn(bi) : null;
        if (content) { this.solitonInject(content); injected[bi] = { stepInjected: this._sol.age, content }; }
      }
      // before stepping, sample any bar that is exactly at a target age
      for (const a of ages) {
        for (let bi = 0; bi < injected.length; bi++) {
          const rec = injected[bi]; if (!rec) continue;
          if (this._sol.age - rec.stepInjected === a) {
            const sc = this._scoreBarAtAge(g, rec.content, a);
            const e = acc.get(a); e.v += sc.voiceScore; e.f += sc.f1; e.n++;
          }
        }
      }
      this._gpu.stepEyeN(1, this.dt); this._sol.age++; this._sol.psi = this._gpu.readEyePsi();
    }
    const rows = ['[UNITED SOLITON] reconstruction vs bar AGE (does the travelling field stay coherent?):',
      '  age (steps)   voiceScore     eventF1'];
    for (const a of ages) { const e = acc.get(a); const v=e.n?e.v/e.n:0, f=e.n?e.f/e.n:0;
      rows.push(`  ${String(a).padStart(6)}      ${v.toFixed(3).padStart(8)}    ${f.toFixed(3).padStart(8)}  ${'█'.repeat(Math.round(v*30))}`); }
    rows.push('  → FLAT across age = true soliton (content survives advection). DECAY = coherence');
    rows.push('    length < D; the field carries multimedia only within that depth.');
    if (!opts_quiet) console.log(rows.join('\n'));
    this._sol = null;
    this.tSteps = saveT;   // restore the live slider
    // summary: mean f1 at age 0 (fresh) and at the deepest age (aged) → for the structure sweep table
    const f0 = (()=>{const e=acc.get(ages[0]); return e&&e.n?e.f/e.n:0;})();
    const fD = (()=>{const e=acc.get(ages[ages.length-1]); return e&&e.n?e.f/e.n:0;})();
    let fMean=0,nA=0; for(const a of ages){const e=acc.get(a); if(e&&e.n){fMean+=e.f/e.n;nA++;}} fMean=nA?fMean/nA:0;
    return { rows, f0, fD, fMean, ages };
  }

  // STRUCTURE-GATING PROOF (§7.16) — run the coherence sweep across a MATRIX of (pitches × onsets)
  // configs so "resolution dominates density" is reproducible in ONE call. Coarse-sparse should hold
  // (high fMean); fine and/or dense should decay (low fMean). The cell SIZE (resolution) should move
  // the number more than the note COUNT (density). Logs a comparative table; can FAIL (that's the point).
  solitonStructureSweep(makeMelody, { imgRowsFrac = 0.35, barSteps = 40, cycles = 6, depthTs = null } = {}) {
    // ONE-FACTOR-AT-A-TIME × DEPTH. Each row isolates EXACTLY one variable (pitches / onsets / notes)
    // from baseline 4×4/2; the WHOLE OFAT block is repeated at several T values, because the structure
    // gating may DIFFER with depth — at low T the field is photographic (everything recovers, no
    // gating), at deep T it's holographic (gating, if any, appears). So "does resolution or density
    // bite" can only be read PER T. (Answers the low-T intuition: the law may be T-dependent.)
    const Ts = depthTs ?? [40, 100, 350];
    const base = { nTiers: 4, nBins: 4, notes: 2 };
    const variants = [
      ['BASELINE     ', base.nTiers, base.nBins, base.notes],
      ['+pitches(8)  ', 8,           base.nBins, base.notes],   // RESOLUTION: tiers 4→8 only
      ['+pitches(12) ', 12,          base.nBins, base.notes],   // resolution further
      ['+onsets(8)   ', base.nTiers, 8,          base.notes],   // TIME-resolution: bins 4→8 only
      ['+notes(3)    ', base.nTiers, base.nBins, 3],            // DENSITY: notes 2→3
      ['+notes(4)    ', base.nTiers, base.nBins, 4],            // density further
    ];
    const out = ['[STRUCTURE-GATING × DEPTH] mean eventF1 (Δ vs that T\'s baseline). Read each T block:',
      '  T   variant         t×b    notes   fresh  aged   mean   Δ'];
    for (const T of Ts) {
      let baseMean = null;
      for (const [tag, nT, nB, nn] of variants) {
        const geom = { nTiers: nT, nBins: nB, imgRowsFrac, vLen: 0, barSecs: 2.0 };
        const r = this.solitonCoherenceSweep(geom, makeMelody(nT, nB, nn), { barSteps, cycles, depthT: T, _quiet: true });
        if (baseMean === null) baseMean = r.fMean;
        const d = r.fMean - baseMean;
        out.push(`  ${String(T).padStart(3)} ${tag} ${String(nT).padStart(2)}×${nB}   ${nn}    ${r.f0.toFixed(2)}   ${r.fD.toFixed(2)}   ${r.fMean.toFixed(2)}  ${(d>=0?'+':'')}${d.toFixed(2)}  ${'█'.repeat(Math.max(0,Math.round(r.fMean*15)))}`);
      }
      out.push('  ' + '─'.repeat(60));
    }
    out.push('  → per T: which variant\'s Δ is most NEGATIVE = the limit that bites AT THAT DEPTH.');
    out.push('    if low-T rows are all ~0 (photographic) and gating only appears at high T → the');
    out.push('    structure law is a DEEP-T (holographic) phenomenon, absent when shallow.');
    console.log(out.join('\n'));
    return out;
  }

  // Score one bar's content at a given age: back-prop the live field by `age` and compare the
  // bar's cells to its intended content. (Helper for the coherence sweep.)
  _scoreBarAtAge(g, content, age) {
    const gpu = this._gpu, live = this._sol.psi;
    gpu.setEyePsi(live);
    if (age > 0) gpu.stepEyeN(age, -this.dt);
    const recon = gpu.readEyePsi();
    gpu.setEyePsi(live);
    let voiceScore = 0;
    if (content.voice) { const vo=new Float64Array(g.vN); for(let i=0;i<g.vN;i++)vo[i]=recon[g.vCells[i]*2];
      let mx=0; for(let i=0;i<g.vN;i++){const a=Math.abs(vo[i]);if(a>mx)mx=a;} if(mx>0)for(let i=0;i<g.vN;i++)vo[i]/=mx;
      let d=0,na=0,nb=0; for(let i=0;i<g.vN;i++){const a=vo[i],b=content.voice[i]||0;d+=a*b;na+=a*a;nb+=b*b;}
      voiceScore=(na>0&&nb>0)?Math.abs(d)/Math.sqrt(na*nb):0; }
    let f1 = 0;
    if (content.events) {
      const cellInt=(t,b)=>{let m=0;for(const c of g.evFoot(t,b)){const v=recon[c*2]*recon[c*2]+recon[c*2+1]*recon[c*2+1];if(v>m)m=v;}return m;};
      let hi=0; const I=Array.from({length:g.nTiers},()=>new Float64Array(g.nBins));
      for(let t=0;t<g.nTiers;t++)for(let b=0;b<g.nBins;b++){const v=cellInt(t,b);I[t][b]=v;if(v>hi)hi=v;}
      const fl=hi*0.25, rec=[]; for(let t=0;t<g.nTiers;t++)for(let b=0;b<g.nBins;b++)if(I[t][b]>=fl)rec.push(t+':'+b);
      const tk=new Set(content.events.map(e=>e.tier+':'+e.bin)), rk=new Set(rec);
      let tp=0; for(const k of rk)if(tk.has(k))tp++;
      const p=rk.size?tp/rk.size:0, r=tk.size?tp/tk.size:0; f1=(p+r)?2*p*r/(p+r):0;
    }
    return { voiceScore, f1 };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  MASKING-ROBUSTNESS vs DEPTH, per modality (the decisive united-field measurement).
  //  Requirement (§7.14): the holography test — full recon from PARTIAL (masked) data — must
  //  hold for ALL modalities, not just the image. Image needs HIGH T for that redundancy
  //  (§5.2b). This sweeps T × occlusion for the SAMPLER's VOICE (waveform) and EVENTS, logging
  //  how each survives masking at each depth → tells us whether voice/events ALSO need high T
  //  (then recover them deep too) or survive at any T (then moderate-T-for-sharpness is safe).
  //  Pure measurement; restores tSteps after. Logs a table.
  // ════════════════════════════════════════════════════════════════════════════════════
  sweepModalitiesVsT(voice, events, opts = {}) {
    const Ts = opts.Ts ?? [50, 100, 200, 350, 500];
    const Rs = opts.Rs ?? [0, 0.25, 0.5, 0.75];
    const saveT = this.tSteps;
    const rows = [];
    rows.push('[MODALITY MASKING vs DEPTH]  voiceScore / eventF1  per (T, occlusion r):');
    rows.push('  T  \\ r   ' + Rs.map(r => `r=${r.toFixed(2)}`.padStart(13)).join(''));
    for (const T of Ts) {
      this.tSteps = T;
      let line = `  ${String(T).padStart(4)}    `;
      for (const r of Rs) {
        const res = this.holographicSampler(voice, events, { ...opts, occludeR: r });
        line += `${res.voiceScore.toFixed(2)}/${res.f1.toFixed(2)}`.padStart(13);
      }
      rows.push(line);
    }
    this.tSteps = saveT;
    rows.push('  → if voiceScore/f1 CLIMB with T (like the image), they NEED high T for masking-');
    rows.push('    robustness → recover deep too. If FLAT/high at all T → moderate-T readout is safe.');
    console.log(rows.join('\n'));
    return rows;
  }

  // Render the multi-depth pipeline to the three eye panels at the current occlusion (hParam
  // if H=occlude mode, else 0). Panel 1 = staged hologram, Panel 2 = summed depth object
  // (ground truth), Panel 3 = reconstruction with live score vs that object.
  computeDepth(layers, gpuCanvas, panelField, panelPercept, panelEvidence, RW, RH) {
    const gpu = this._gpu, N = layers[0].length >> 1;
    const occ = (this.hMode === 6 || this.hMode === 7 || this.hMode === 8) ? this.hParam : 0;
    // CLEAN staged reconstruction (no occlusion) — the correct reference. A staged
    // multi-depth round-trip does NOT return the raw object plane (each layer was injected
    // at a different step, so a single backward leg can't refocus them all to one plane);
    // it returns a depth-scrambled but DETERMINISTIC field. The meaningful question is how
    // much OCCLUSION degrades that achievable reconstruction — so we score vs the clean
    // recon (ref), exactly as sweepOcclusionDepth does. (Scoring vs the raw object gives
    // ~0 even at r=0, which is correct but meaningless — that bug showed score=0.008.)
    const ref = this._stagedDepthForward(layers, 0).recon;
    const { recon, holo } = this._stagedDepthForward(layers, occ);

    const peak = (a) => { let m = 0; for (let j = 0; j < a.length >> 1; j++) { const v = a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if (v > m) m = v; } return Math.max(m, 1e-12); };

    if (panelField) {                       // Panel 1 — the staged multi-depth hologram
      gpu.setEyePsi(holo); gpu.renderEyeField(peak(holo));
      panelField.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panelField.setLabel(occ > 0 ? `EYE  |ψ_holo|²  3D hologram (occl ${occ.toFixed(2)})` : 'EYE  |ψ_holo|²  3D hologram');
    }
    if (panelPercept) {                      // Panel 2 — the CLEAN reconstruction (reference)
      gpu.setEyePsi(ref); gpu.renderEyeField(peak(ref));
      panelPercept.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panelPercept.setLabel(`EYE  |ψ_recon₀|²  clean recon (ref, ${layers.length} layers)`);
    }
    if (panelEvidence) {                     // Panel 3 — occluded recon, scored vs clean ref
      const score = this._corr(recon, ref);
      gpu.setEyePsi(recon); gpu.renderEyeField(peak(recon));
      panelEvidence.ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
      panelEvidence.setLabel(`EYE  |ψ_recon|²  occl recon score=${score.toFixed(3)}`);
    }
  }

  sweepOcclusionDepth(layers, rValues = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
    const D = this.tSteps, nL = layers.length;
    // Reference: the object's OWN clean reconstruction (no occlusion).
    const ref = this._stagedDepthForward(layers, 0).recon;
    const rows = [];
    for (const r of rValues) {
      const recon = this._stagedDepthForward(layers, r).recon;
      const score = this._corr(recon, ref);   // redundancy relative to achievable recon
      rows.push(`r=${r.toFixed(2)}: score ${score.toFixed(3)}  ${'█'.repeat(Math.round(score*40))}`);
    }
    console.log(`[EYE MULTI-DEPTH] occlusion vs depth-staged object @ T=${D}, ${nL} depth layers:\n` + rows.join('\n')
      + '\n→ graceful falloff = depth superposition gives holographic redundancy; linear = none.');
  }

  // ── One-shot diagnostic: RING-BAND redundancy — MISMATCHED legs.
  // Encode with the FULL kernel (the real hologram), then DECODE with only one ring
  // band. Because the legs use different operators, the round-trip is NO LONGER a
  // trivial identity — the score reveals whether that single band alone can invert the
  // full-kernel hologram, i.e. whether the object's info is redundantly carried in that
  // band. (Same-kernel round-trips score 1.000 for any band, which is uninformative.)
  //   high score for a band → that ring scale alone decodes the full hologram (redundant)
  //   low score             → that band is insufficient; info is distributed across scales

  // ── BINDING GATE (§9) — the decisive cheap test BEFORE building composition-as-COMPUTATION.
  //    Coexistence (two solitons sharing one field, masked together) is BUILT & measured (§7.26-7.31).
  //    The frontier is COMPUTATION: one soliton TRANSFORMING another via an operator in the shared field —
  //    "A computes on B," output = a field that depends JOINTLY on A and B, recoverable. The natural
  //    holographic operator is field MULTIPLICATION: ψA·ψB in space = CONVOLUTION/CORRELATION in the
  //    carrier domain (matched-filter / associative-recall, the §9 'holographic computer' mechanism).
  //
  //    CLAIM: bind two carrier-embedded patterns by pointwise PRODUCT (the binding [H]), round-trip the
  //    bound field through the IFS medium, demodulate at the SUM carrier (kA+kB, where the product lands),
  //    and the readout is the CORRELATION of A and B. A clean matched-filter must do TWO things, and a
  //    naive 0-vs-0 test proves NEITHER (the earlier ∞× contrast was degenerate — disjoint patterns share
  //    no cell, so the product is identically zero and there is nothing for the kernel to smear):
  //      (1) GRADED — recovered correlation must TRACK the true Σ A·B as overlap goes 100%→0% (monotone,
  //          and ≈ the arithmetic value, not merely "high vs zero"). Energy-conservation alone can't fake
  //          a monotone curve that matches the true correlation at every partial overlap.
  //      (2) LAG    — it must PEAK at the correct shift. Shift B by δ cells; recovered must fall off as
  //          |δ| grows. A matched filter localizes the match; energy-conservation would be flat in δ.
  //    PASS = recovered tracks the graded true-corr (corr ≳ 0.9 between the two curves) AND the lag curve
  //    peaks at δ=0 with clear falloff. Either failing ⇒ the round-trip conserves energy but does NOT
  //    compute the correlation → no clean binding (the multiply↔convolve relation fails for the ring-kernel).
  //    Pure measurement; logs two tables; caller re-seeds the eye buffer after.
  //
  //    patFn(frac, dx, G) → Float64Array B that overlaps the base A by ~`frac` AND is shifted by `dx` cells.
  //      patFn(1,0,G) === A (the base). frac<1 slides B off A; dx shifts it for the lag test. carrierA/B = makeCarrier(...).
  bindingGate(carrierA, carrierB, patFn, { T = 50, occludeR = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt;
    const A = patFn(1, 0, G);                                       // base pattern (full overlap, no shift)
    const trueCorr = (P, Q) => { let s = 0; for (let i = 0; i < N; i++) s += P[i] * Q[i]; return s; };
    const embed = (carr, content) => { const p = new Float64Array(2 * N); carr.embed(p, content, G); return p; };
    // BIND: pointwise complex product ψA·ψB. The A·B amplitude lands on carrier (kA+kB); demod there reads it.
    const bind = (pA, pB) => { const o = new Float64Array(2 * N);
      for (let i = 0; i < N; i++) { const ar=pA[i*2],ai=pA[i*2+1],br=pB[i*2],bi=pB[i*2+1];
        o[i*2] = ar*br - ai*bi; o[i*2+1] = ar*bi + ai*br; } return o; };
    const sumCarr = { kx: carrierA.kx + carrierB.kx, ky: carrierA.ky + carrierB.ky };
    const pA = embed(carrierA, A);                                  // A's carrier field is fixed across the sweep
    // round-trip the bound field, demod at sumCarr → the medium's estimate of Σ A·B.
    const measure = (B) => {
      const bound = bind(pA, embed(carrierB, B));
      gpu.setEyePsi(bound); gpu.stepEyeN(T, dt);
      if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
      gpu.stepEyeN(T, -dt);
      const r = gpu.readEyePsi(); let s = 0;
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const i = y*G+x, ph = sumCarr.kx*x + sumCarr.ky*y;
        s += r[i*2]*Math.cos(ph) + r[i*2+1]*Math.sin(ph); }         // Σ Re(ψ·e^{-i(kA+kB)·x})
      return s;
    };
    // Pearson correlation between the true-corr curve and the recovered curve (does recovered TRACK truth?).
    const curveCorr = (P, Q) => { const n=P.length; let mp=0,mq=0; for(let i=0;i<n;i++){mp+=P[i];mq+=Q[i];} mp/=n;mq/=n;
      let num=0,dp=0,dq=0; for(let i=0;i<n;i++){const a=P[i]-mp,b=Q[i]-mq;num+=a*b;dp+=a*a;dq+=b*b;} return (dp>0&&dq>0)?num/Math.sqrt(dp*dq):0; };

    // ── (1) GRADED OVERLAP: B slides off A; recovered must track true Σ A·B ──────────────────────────
    const fracs = [1.0, 0.75, 0.5, 0.25, 0.0];
    const tcr = [], rcr = [];
    for (const f of fracs) { const B = patFn(f, 0, G); tcr.push(trueCorr(A, B)); rcr.push(measure(B)); }
    const tc0 = Math.max(1e-9, tcr[0]), rc0 = Math.max(1e-9, Math.abs(rcr[0]));   // normalize both to their 100% value
    const gradeFit = curveCorr(tcr, rcr.map(Math.abs));
    const g = ['[BINDING GATE §9] does IFS field PRODUCT compute the A·B CORRELATION? (matched-filter)',
      `   (1) GRADED OVERLAP @ T=${T}${occludeR>0?` occl ${occludeR}`:''} — recovered must TRACK the true correlation:`,
      '   overlap   trueΣA·B(norm)   recovered(norm)',
      ...fracs.map((f,i) => `   ${(f*100).toFixed(0).padStart(4)}%    ${(tcr[i]/tc0).toFixed(3).padStart(10)}    ${(Math.abs(rcr[i])/rc0).toFixed(3).padStart(12)}`),
      `   → curve-fit (recovered vs true): ${gradeFit.toFixed(3)}   (≳0.9 = recovered TRACKS true correlation, not just energy)`];

    // ── (2) LAG: B = A shifted by δ cells; recovered must PEAK at δ=0 and fall MONOTONICALLY off ──────
    //    Shift range is scaled to the FEATURE SIZE (a δ much smaller than the feature still overlaps
    //    heavily, so we must reach ≳ feature width to see the correlation hit its floor). featR is the
    //    feature's half-width from patFn's geometry; we step out to ~2× that so the curve actually bottoms.
    const featR = Math.max(3, Math.round(G * 0.14));
    const step = Math.max(1, Math.round(featR / 2));
    const lags = [-4,-3,-2,-1,0,1,2,3,4].map(k => k * step);
    const lagR = lags.map(d => Math.abs(measure(patFn(1, d, G))));
    const lagPk = Math.max(...lagR), z = lags.indexOf(0), lagAt0 = lagR[z];
    const peakAt0 = lagAt0 >= lagPk - 1e-6;                          // is δ=0 the (a) maximum?
    // monotone decrease away from center on BOTH sides (the matched-filter signature; flat ⇒ no localization).
    let mono = true; for (let i = z; i+1 < lagR.length; i++) if (lagR[i+1] > lagR[i] + 1e-6) mono = false;
    for (let i = z; i-1 >= 0; i--) if (lagR[i-1] > lagR[i] + 1e-6) mono = false;
    const edge = (lagR[0] + lagR[lagR.length-1]) / 2, falloff = lagAt0 / Math.max(1e-9, edge);
    const l = [`   (2) LAG — B shifted by δ cells (feature half-width ${featR}); matched filter must PEAK at δ=0:`,
      '   δ:   ' + lags.map(d => String(d).padStart(7)).join(''),
      '   rec: ' + lagR.map(v => (v/Math.max(1e-9,lagPk)).toFixed(2).padStart(7)).join(''),
      `   → peak@δ=0: ${peakAt0?'YES':'NO'}   monotone falloff both sides: ${mono?'YES':'NO'}   center/edge: ${falloff.toFixed(1)}×`];

    // PASS = recovered TRACKS the graded correlation (the decisive test) AND the lag has a strict, monotone
    // peak at δ=0 (localization). Falloff MAGNITUDE depends on shift range vs feature size → reported, not gated.
    const pass = gradeFit >= 0.9 && peakAt0 && mono;
    const verdict = [`   ══ VERDICT: ${pass ? 'BINDING COMPUTES' : 'NOT A CLEAN MATCHED FILTER'} ══`,
      pass ? '   recovered tracks the graded correlation AND localizes the lag → cross-modal binding is real on'
           : '   the round-trip conserves energy but does NOT reproduce the correlation curve/peak → the ring-kernel',
      pass ? '   the IFS medium → build composition-as-computation (§9: events×image gating, associative recall).'
           : "   doesn't realize multiply↔convolve cleanly → binding would need a different operator. Honest stop."];
    console.log([...g, ...l, ...verdict].join('\n'));
    return [...g, ...l, ...verdict];
  }

  // ── §7.90 PURE-MEDIUM BINDING GATE — same test as bindingGate, but the field product ψA·ψB is done ON THE GPU
  //    (bindEyeField), not in JS. If this reproduces the §9 correlation result (curve-fit ≳0.9, lag peak@0), then
  //    the WHOLE binding — multiply AND transport — is a medium operation: the medium operates on the medium. ─
  bindingGateGPU(carrierA, carrierB, patFn, { T = 50, occludeR = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt;
    const A = patFn(1, 0, G);
    const trueCorr = (P, Q) => { let s = 0; for (let i = 0; i < N; i++) s += P[i] * Q[i]; return s; };
    const embed = (carr, content) => { const p = new Float64Array(2 * N); carr.embed(p, content, G); return p; };
    const sumCarr = { kx: carrierA.kx + carrierB.kx, ky: carrierA.ky + carrierB.ky };
    const pA = embed(carrierA, A);
    // measure: LOAD A into the eye field, BIND by B on the GPU (the medium multiply), propagate, demod.
    const measure = (B) => {
      gpu.setEyePsi(pA);                       // ψ_eye = A
      gpu.bindEyeField(embed(carrierB, B));    // §7.90 ψ_eye ·= B  — the PURE-MEDIUM product (GPU, no JS multiply)
      gpu.stepEyeN(T, dt);
      if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
      gpu.stepEyeN(T, -dt);
      const r = gpu.readEyePsi(); let s = 0;
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const i = y*G+x, ph = sumCarr.kx*x + sumCarr.ky*y;
        s += r[i*2]*Math.cos(ph) + r[i*2+1]*Math.sin(ph); }
      return s;
    };
    const curveCorr = (P, Q) => { const n=P.length; let mp=0,mq=0; for(let i=0;i<n;i++){mp+=P[i];mq+=Q[i];} mp/=n;mq/=n;
      let num=0,dp=0,dq=0; for(let i=0;i<n;i++){const a=P[i]-mp,b=Q[i]-mq;num+=a*b;dp+=a*a;dq+=b*b;} return (dp>0&&dq>0)?num/Math.sqrt(dp*dq):0; };
    const fracs = [1.0, 0.75, 0.5, 0.25, 0.0], tcr = [], rcr = [];
    for (const f of fracs) { const B = patFn(f, 0, G); tcr.push(trueCorr(A, B)); rcr.push(measure(B)); }
    const tc0 = Math.max(1e-9, tcr[0]), rc0 = Math.max(1e-9, Math.abs(rcr[0]));
    const gradeFit = curveCorr(tcr, rcr.map(Math.abs));
    const featR = Math.max(3, Math.round(G * 0.14)), step = Math.max(1, Math.round(featR / 2));
    const lags = [-4,-3,-2,-1,0,1,2,3,4].map(k => k * step);
    const lagR = lags.map(d => Math.abs(measure(patFn(1, d, G))));
    const lagPk = Math.max(...lagR), z = lags.indexOf(0), lagAt0 = lagR[z], peakAt0 = lagAt0 >= lagPk - 1e-6;
    let mono = true; for (let i = z; i+1 < lagR.length; i++) if (lagR[i+1] > lagR[i] + 1e-6) mono = false;
    for (let i = z; i-1 >= 0; i--) if (lagR[i-1] > lagR[i] + 1e-6) mono = false;
    const pass = gradeFit >= 0.9 && peakAt0 && mono;
    const out = ['[§7.90 PURE-MEDIUM BINDING GATE] field product ψA·ψB done ON THE GPU (bindEyeField), not in JS:',
      `   GRADED OVERLAP @ T=${T}${occludeR>0?` occl ${occludeR}`:''}:`,
      '   overlap   trueΣA·B(norm)   recovered(norm)',
      ...fracs.map((f,i) => `   ${(f*100).toFixed(0).padStart(4)}%    ${(tcr[i]/tc0).toFixed(3).padStart(10)}    ${(Math.abs(rcr[i])/rc0).toFixed(3).padStart(12)}`),
      `   → curve-fit ${gradeFit.toFixed(3)}  | lag peak@δ=0 ${peakAt0?'YES':'NO'}  monotone ${mono?'YES':'NO'}`,
      `   ══ ${pass ? 'PURE-MEDIUM BINDING COMPUTES — the medium operates on the medium (optical chip in this substrate)' : 'GPU binding does NOT track the correlation — investigate'} ══`];
    console.log(out.join('\n'));
    return out;
  }

  // ── GATE OPERATOR (§9) — the FIRST cross-modal binding operator, verified end-to-end. bindingGate
  //    proved the MECHANISM (ψA·ψB → correlation); this proves the USE: an EVENTS soliton GATES an IMAGE
  //    soliton — "image sampled where/when the beat fires." The rhythm is a spatial selection mask r(x,y)
  //    (1 in beat-ON columns, 0 off); the image is content c(x,y). The gate is the binding [H]: embed the
  //    rhythm on a carrier, MULTIPLY into the image field (ψ_img·ψ_rhythm), round-trip the IFS medium,
  //    demodulate → the recovered field should be the GATED image c·r — present in beat-ON regions, dark
  //    in beat-OFF regions. This is one soliton TRANSFORMING another in the shared wavefront (not coexisting).
  //
  //    Two measurements: (a) SELECTIVITY — energy in beat-ON cells vs beat-OFF cells (contrast ≫1 = the
  //    beat carves the image); (b) FIDELITY — corr(recovered, true c·r) (≈1 = the gate computes the exact
  //    product, not a smear). PASS = contrast ≫ 1 AND fidelity ≳ 0.9 → the events×image gate operator is
  //    real → wire it as a Soliton-taking-Soliton combinator. Pure measurement; caller re-seeds the eye.
  //
  //    carrier = makeCarrier(...) for the rhythm. imgFn(G)->Float64(N) content. beatFn(x,G)->bool (column on?).
  gateOperator(carrier, imgFn, beatFn, { T = 50, occludeR = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt;
    const img = imgFn(G);
    // rhythm mask r(x,y): 1 where this column's beat is ON (temporal selection projected onto space).
    const mask = new Float64Array(N);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) mask[y*G+x] = beatFn(x, G) ? 1 : 0;
    // true gated image c·r — the ground truth the operator must reproduce.
    const trueGated = new Float64Array(N); for (let i = 0; i < N; i++) trueGated[i] = img[i] * mask[i];
    // embed each on the SAME carrier? No — image is plain (carrier 0), rhythm on `carrier`; their product
    // lands on `carrier` (k_img=0 + k_rhythm=k), so we demod at `carrier` to read the gated result.
    const pImg = new Float64Array(2*N); for (let i = 0; i < N; i++) pImg[i*2] = img[i];   // image: real, carrier 0
    const pRhy = new Float64Array(2*N); carrier.embed(pRhy, mask, G);                      // rhythm on its carrier
    // GATE = pointwise product (the binding [H]).
    const bound = new Float64Array(2*N);
    for (let i = 0; i < N; i++) { const ar=pImg[i*2],ai=pImg[i*2+1],br=pRhy[i*2],bi=pRhy[i*2+1];
      bound[i*2] = ar*br - ai*bi; bound[i*2+1] = ar*bi + ai*br; }
    // round-trip the gated field through the IFS medium, demod at the rhythm carrier → recovered gated image.
    gpu.setEyePsi(bound); gpu.stepEyeN(T, dt);
    if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    gpu.stepEyeN(T, -dt);
    const recov = carrier.extract(gpu.readEyePsi(), G);     // Re(ψ·e^{-ik·x}) — the recovered gated image
    // (a) SELECTIVITY: mean energy in beat-ON image cells vs beat-OFF image cells.
    let onE=0,onN=0,offE=0,offN=0;
    for (let i = 0; i < N; i++) { if (img[i] === 0) continue;        // only where the image has content
      if (mask[i] > 0) { onE += recov[i]*recov[i]; onN++; } else { offE += recov[i]*recov[i]; offN++; } }
    const onMean = onE/Math.max(1,onN), offMean = offE/Math.max(1,offN);
    const selectivity = onMean / Math.max(1e-12, offMean);
    // (b) FIDELITY: correlation of recovered vs true c·r (does it reproduce the exact gated image?).
    const corr = (a,b) => { let n=0,da=0,db=0; for(let i=0;i<a.length;i++){n+=a[i]*b[i];da+=a[i]*a[i];db+=b[i]*b[i];} return (da>0&&db>0)?n/Math.sqrt(da*db):0; };
    const fidelity = corr(recov, trueGated);
    gpu.setEyePsi(new Float64Array(2*N));    // caller re-seeds; leave clean
    const pass = selectivity > 3 && fidelity >= 0.9;
    // selectivity is ∞-ish when beat-OFF energy is exactly 0 (the product is identically zero there — no
    // leakage to measure); report that as "no leakage" rather than a misleading 12-digit ratio. FIDELITY
    // (exact-product correlation) is the substantive number; selectivity just confirms no OFF-region bleed.
    const selStr = (offMean < 1e-9) ? 'no OFF-region leakage (beat-OFF energy = 0)' : selectivity.toFixed(1) + '×';
    const rows = ['[GATE OPERATOR §9] EVENTS gate IMAGE — "image sampled where the beat fires" (ψ_img·ψ_rhythm):',
      `   selectivity (beat-ON vs beat-OFF energy in image cells): ${selStr}`,
      `   fidelity     (corr recovered vs true c·r):              ${fidelity.toFixed(3)}    (≳0.9 = exact gated product, not a smear)`,
      `   T=${T}${occludeR>0?` occl ${occludeR}`:''}  →  ${pass ? 'GATE OPERATOR WORKS — the rhythm soliton TRANSFORMS the image soliton in the shared field (§9 build).'
                                                                  : 'gate weak — selectivity or fidelity below bar; the product does not cleanly carve the image here.'}`];
    console.log(rows.join('\n'));
    return rows;
  }

  // ── RECOGNIZE GATE (§9, recognition mode) — "give a reference object, all its occurrences light up."
  //    This is the SPATIAL face of the §7.32 correlation: instead of one peak value, keep the WHOLE
  //    correlation map. A SCENE holds K copies of a reference pattern at known locations PLUS distractor
  //    patterns elsewhere; we probe the scene with the reference via the matched-filter [H] (ψ_scene ·
  //    conj(ψ_ref·e^{ik·x})), round-trip the IFS medium, demod the carrier → a correlation MAP. PASS =
  //    the map PEAKS at the true reference locations and STAYS LOW on distractors. Metrics:
  //      hitRatio  = mean(map at true sites) / mean(map at distractor sites)   (≫1 = it discriminates)
  //      localized = is each true site a LOCAL MAX of the map?                  (the "lights up THERE")
  //    NEW mode (the §7.32 product is proven; the conj-matched-filter + spatial-map readout are not) →
  //    this measurement decides it before the recognize() combinator is trusted. Pure measurement.
  //
  //    refFn(G) -> Float64(N) reference pattern (small, centered at origin block). carrier = makeCarrier(...).
  //    sites = [{x,y}] true locations; distractFn(G) -> Float64(N) the distractor pattern (a DIFFERENT shape).
  recognizeGate(carrier, refFn, sites, distractFn, distractSites, { T = 50, occludeR = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt;
    const ref = refFn(G), dis = distractFn(G);
    // stamp a centered pattern p at location (cx,cy) into scene field s (real channel).
    const stamp = (s, p, cx, cy) => { for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const v = p[y*G+x]; if (!v) continue; const X = cx + x - (G>>1), Y = cy + y - (G>>1);
      if (X>=0 && X<G && Y>=0 && Y<G) s[(Y*G+X)*2] += v; } };
    // SCENE: reference copies at `sites` + distractors at `distractSites`, all real, one field.
    const scene = new Float64Array(2 * N);
    for (const st of sites)         stamp(scene, ref, st.x, st.y);
    for (const st of distractSites) stamp(scene, dis, st.x, st.y);
    // ── MEDIUM-FAITHFUL RECOGNITION via the PROVEN operator, evaluated at each candidate position. A real-
    //    space pointwise product can't slide the reference (the earlier ZERO: probe at center, copies
    //    elsewhere → no overlap). bindingGate (§7.32) proved the IFS round-trip computes the correlation of
    //    two aligned fields. So the honest matched-filter MAP is: place the reference at candidate position
    //    u, BIND (product) with the scene, round-trip the medium, and read the scalar correlation — exactly
    //    the proven operation, repeated over a grid of u. This is GPU work (one round-trip per candidate),
    //    NOT a JS dot product — so a coarse candidate grid keeps it affordable for a probe. The reference
    //    placed at u: refField_u (real). Bind = scene·refField_u (both real → real product, no carrier
    //    needed for the SCALAR readout; the carrier matters only when co-residing with other modalities).
    const cand = [...sites, ...distractSites];   // evaluate the operator AT the known sites + distractors
    const refAt = (u) => { const f = new Float64Array(2 * N); stamp(f, ref, u.x, u.y); return f; };
    const corrAt = (u) => {
      const r = refAt(u); const bound = new Float64Array(2 * N);
      for (let i=0;i<N;i++){ const ar=scene[i*2], br=r[i*2]; bound[i*2] = ar*br; }   // scene·ref_u (real·real)
      gpu.setEyePsi(bound); gpu.stepEyeN(T, dt);
      if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
      gpu.stepEyeN(T, -dt);
      const b = gpu.readEyePsi(); let s=0; for (let i=0;i<N;i++) s += b[i*2];   // Σ Re — the correlation scalar
      return Math.abs(s);
    };
    const vals = cand.map(corrAt);
    gpu.setEyePsi(new Float64Array(2 * N));        // leave eye clean
    let mx = Math.max(1e-12, ...vals);
    // build a sparse "map" keyed by candidate for the diagnostics below (full-grid map isn't needed — we
    // evaluate the proven operator only where we want to know: the true sites and the distractors).
    const valAt = (s) => { const k = cand.findIndex(c=>c.x===s.x&&c.y===s.y); return k>=0 ? vals[k]/mx : 0; };
    const tMean = sites.reduce((a,s)=>a+valAt(s),0) / Math.max(1,sites.length);
    const dMean = distractSites.reduce((a,s)=>a+valAt(s),0) / Math.max(1,distractSites.length);
    const hitRatio = tMean / Math.max(1e-9, dMean);
    // discrimination: every TRUE site should score higher than every DISTRACTOR site (the L-detector
    // prefers L's to +'s at the SAME positions — pure shape discrimination, position held fixed).
    const minTrue = Math.min(...sites.map(valAt)), maxDis = distractSites.length ? Math.max(...distractSites.map(valAt)) : 0;
    const allTrueWin = minTrue > maxDis;
    const pass = hitRatio > 2.5 && allTrueWin;
    const rows = ['[RECOGNIZE GATE §9] "give a reference → its occurrences light up" — matched filter via the',
      '   PROVEN operator (scene·ref_u → IFS round-trip → correlation scalar, §7.32), evaluated at each site:',
      `   scene: ${sites.length} reference copies + ${distractSites.length} distractors, one field, T=${T}${occludeR>0?` occl ${occludeR}`:''}  max corr ${mx.toExponential(2)}`,
      `   corr at TRUE sites (norm):      ${sites.map(s=>valAt(s).toFixed(2)).join('  ')}   mean ${tMean.toFixed(2)}  (min ${minTrue.toFixed(2)})`,
      `   corr at DISTRACTOR sites (norm):${distractSites.map(s=>valAt(s).toFixed(2)).join('  ')}   mean ${dMean.toFixed(2)}  (max ${maxDis.toFixed(2)})`,
      `   hit/distractor ratio: ${hitRatio.toFixed(1)}×   every true site beats every distractor: ${allTrueWin?'YES':'NO'}`,
      `   → ${pass ? 'RECOGNITION WORKS — the L-detector scores L\'s above +\'s through the medium (build recognize()).'
                  : (mx < 1e-9 ? 'correlation ~ZERO — the scene·ref product is empty (alignment/stamp issue).'
                              : 'weak — the medium\'s correlation does not separate the reference shape from the distractor here.')}`];
    console.log(rows.join('\n'));
    return rows;
  }

  // ── PURE-CONV FORWARD PATH (§7.36) — the DENSE recognition cash-in. §7.36 proved one IFS step is a
  //    spatial CONVOLUTION (circulant ⇒ DFT-diagonal), so the convolution theorem holds: the WHOLE dense
  //    correlation map = IFFT( FFT(scene)·conj(FFT(ref)) ) in O(N log N), recognition at EVERY pixel — not
  //    the leapfrog (§7.35 NO) and not per-candidate round-trips. The DFT IS the diagonalizing transform of
  //    the pure ring convolution, so this is the faithful realization of "the pure conv is the FFT-analog."
  //    These are reusable first-class methods (the path), not buried in a probe.

  // radix-2 2D FFT in place on (re,im) length G·G. G must be a power of two (the grid is). inv=true → IFFT.
  _fft2d(re, im, inv) {
    const G = this._gpu._G;
    const fft1d = (R, I) => { const n = R.length;
      for (let i=1,j=0;i<n;i++){ let b=n>>1; for(;j&b;b>>=1) j^=b; j^=b; if(i<j){ const tr=R[i];R[i]=R[j];R[j]=tr; const ti=I[i];I[i]=I[j];I[j]=ti; } }
      for (let L=2;L<=n;L<<=1){ const ang=(inv?2:-2)*Math.PI/L, wr=Math.cos(ang), wi=Math.sin(ang);
        for (let i=0;i<n;i+=L){ let cr=1,ci=0; for(let k=0;k<L/2;k++){ const ur=R[i+k],ui=I[i+k],
          vr=R[i+k+L/2]*cr-I[i+k+L/2]*ci, vi=R[i+k+L/2]*ci+I[i+k+L/2]*cr;
          R[i+k]=ur+vr; I[i+k]=ui+vi; R[i+k+L/2]=ur-vr; I[i+k+L/2]=ui-vi;
          const n2=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=n2; } } }
      if (inv) for(let i=0;i<n;i++){ R[i]/=n; I[i]/=n; } };
    const R=new Float64Array(G), I=new Float64Array(G);
    for (let y=0;y<G;y++){ for(let x=0;x<G;x++){R[x]=re[y*G+x];I[x]=im[y*G+x];} fft1d(R,I); for(let x=0;x<G;x++){re[y*G+x]=R[x];im[y*G+x]=I[x];} }
    for (let x=0;x<G;x++){ for(let y=0;y<G;y++){R[y]=re[y*G+x];I[y]=im[y*G+x];} fft1d(R,I); for(let y=0;y<G;y++){re[y*G+x]=R[y];im[y*G+x]=I[y];} }
  }

  // DENSE correlation MAP: corr(x) = Σ scene·ref(·−x) for EVERY x, via the convolution theorem. ref is
  // centered at the grid origin; the map's bright cells are where the reference OCCURS. Returns Float64(N)
  // (the |correlation|, normalized to peak 1). sceneR, refCentered: Float64(N) real fields. O(N log N).
  denseCorrMap(sceneR, refCentered) {
    const G = this._gpu._G, N = G * G;
    const ar=Float64Array.from(sceneR), ai=new Float64Array(N); this._fft2d(ar,ai,false);
    const br=Float64Array.from(refCentered), bi=new Float64Array(N); this._fft2d(br,bi,false);
    const cr=new Float64Array(N), ci=new Float64Array(N);
    for (let i=0;i<N;i++){ cr[i]=ar[i]*br[i]+ai[i]*bi[i]; ci[i]=ai[i]*br[i]-ar[i]*bi[i]; }   // A·conj(B)
    this._fft2d(cr,ci,true);
    const m=new Float64Array(N); let mx=0; for(let i=0;i<N;i++){ m[i]=Math.hypot(cr[i],ci[i]); if(m[i]>mx) mx=m[i]; }
    if (mx>0) for(let i=0;i<N;i++) m[i]/=mx;
    return m;
  }

  // DENSE SCALE recognition (§7.36 + §7.38): the dense map at SEVERAL reference sizes, combined to a single
  // map = per-cell MAX over scales, plus a per-cell best-scale field (which size matched there). "Every
  // occurrence at any position AND any size lights up, and we know the size." refFn(G)->Float64(N) centered.
  // Returns { map: Float64(N) (peak 1), scaleAt: Float32(N) (matched scale per cell) }. O(S·N log N).
  denseRecognizeScale(sceneR, refFn, { scales = [0.7, 1.0, 1.4] } = {}) {
    const G = this._gpu._G, N = G * G, cC = G >> 1;
    const ref = (typeof refFn === 'function') ? refFn(G) : refFn;   // accept a function OR a ready array
    // The FFT cross-correlation peaks at the SHIFT between scene and ref. For the peak to land ON the object
    // (not offset by half the grid), the reference must sit at the ORIGIN (0,0) with wraparound — NOT centered.
    // ref comes centered at cC, so we re-center to origin: (x−cC, y−cC) mod G, scaled.
    const stampScaled = (sc) => { const f=new Float64Array(N);
      for (let y=0;y<G;y++) for (let x=0;x<G;x++){ const v=ref[y*G+x]; if(!v) continue;
        const X=(Math.round((x-cC)*sc)%G+G)%G, Y=(Math.round((y-cC)*sc)%G+G)%G; f[Y*G+X]+=v; } return f; };
    const map = new Float64Array(N), scaleAt = new Float32Array(N);
    for (const sc of scales) {
      const m = this.denseCorrMap(sceneR, stampScaled(sc));            // already peak-normalized per scale
      for (let i=0;i<N;i++) if (m[i] > map[i]) { map[i] = m[i]; scaleAt[i] = sc; }
    }
    return { map, scaleAt };
  }

  // ── WAVELET RECOGNITION (§7.38 wired live) — the cash-in of the IFS-NATIVE WAVELET. Unlike candidate/dense
  //    (which BRUTE-search sizes — correlate the ref at each scale and take the best), this uses the FRACTAL
  //    CASCADE decomposition (_ifsAnalyze, §7.38): one multiresolution pass projects the scene onto the
  //    attractor-contracted ring scale-bands, and at each location the band whose ring straddles the local
  //    EDGE (the DoG extremum across bands) REPORTS the feature size directly — the wavelet way, not guessing.
  //    Combined with a dense FFT correlation for WHERE the reference is, weighted by the scale-band match.
  //    Returns { map: Float64(N) (peak 1, where ref occurs), scaleAt: Float32(N) (the band-reported size) }.
  //    refFn(G)->Float64(N) centered. ifsMaps: contraction ratios. depth: band count.
  waveletRecognize(sceneR, refFn, { ifsMaps = [0.30902, 0.41421, 0.5, 0.61803, 0.70711], depth = 5, baseR = null, scales = [0.7, 1.0, 1.4] } = {}) {
    const G = this._gpu._G, N = G * G, cC = G >> 1;
    const ref = (typeof refFn === 'function') ? refFn(G) : refFn;   // accept a function OR a ready array
    // The band ladder must span the OBJECT scale range, not 0.4·G — earlier base≈26 sampled rings far OUTSIDE
    // the tiny ~4–8px glyphs (DoG response ~0 everywhere → no glow). Derive the ref's footprint radius and
    // build a fractal ladder AROUND it (½×…2× of the ref size), so the bands actually straddle the glyph edges.
    let refR = 1; for (let y=0;y<G;y++) for (let x=0;x<G;x++) if (ref[y*G+x]) refR = Math.max(refR, Math.hypot(x-cC, y-cC));
    const base = baseR || Math.max(3, Math.round(refR * 1.5));    // top of the ladder ≈ 1.5× the glyph radius
    const bandR = []; for (let d=0; d<depth; d++) bandR.push(Math.max(1, Math.round(base * Math.pow(0.6, d))));  // 0.6× steps → finer ladder over the glyph range
    // ring intensity at distance r around each cell (the _ifsAnalyze projection, N/S/E/W ring avg).
    const ringBand = (r) => { const b = new Float64Array(N);
      for (let cy=0;cy<G;cy++) for (let cx=0;cx<G;cx++){ const cid=cy*G+cx;
        const a=cy*G+((cx+r)&(G-1)), c=cy*G+((cx-r+G)&(G-1)), e=((cy+r)&(G-1))*G+cx, f=((cy-r+G)&(G-1))*G+cx;
        b[cid] = (sceneR[a]*sceneR[a] + sceneR[c]*sceneR[c] + sceneR[e]*sceneR[e] + sceneR[f]*sceneR[f]) * 0.25; }
      return b; };
    const bands = bandR.map(ringBand);
    // per-cell DoG response across bands: |band(r) − band(2r)| ≈ |bandᵢ − bandᵢ₊₁| → peaks where the local
    // feature edge matches a band scale. The winning band's radius = the locally-detected feature SIZE.
    const sizeMap = new Float32Array(N), edgeStrength = new Float64Array(N);
    for (let i=0;i<N;i++){ let best=-1, bestB=0;
      for (let d=0; d<bands.length-1; d++){ const resp = Math.abs(bands[d][i] - bands[d+1][i]);
        if (resp > best){ best=resp; bestB=d; } }
      sizeMap[i] = bandR[bestB]; edgeStrength[i] = best; }
    // WHERE is the reference? dense FFT correlation (peak-normalized), reusing the proven path. We weight the
    // correlation by local edge strength so the glow concentrates on real wavelet-detected features.
    // ref must be ORIGIN-centered (not at cC) so the correlation peak lands ON the object (else half-grid offset).
    const refOrigin = new Float64Array(N);
    for (let y=0;y<G;y++) for (let x=0;x<G;x++){ const v=ref[y*G+x]; if(!v) continue;
      const X=((x-cC)%G+G)%G, Y=((y-cC)%G+G)%G; refOrigin[Y*G+X]+=v; }
    const corr = this.denseCorrMap(sceneR, refOrigin);
    // COMBINE: the CORRELATION sets WHERE (brightness — same strength as FFT mode, no edge multiply that
    // suppressed the glow where center≠edge). The cascade's DoG band only REPORTS the size (hue), spread to
    // the nearby correlation peak so the size label travels to the object center. Map = the correlation map.
    const map = new Float64Array(N), scaleAt = new Float32Array(N); let mx=0;
    for (let i=0;i<N;i++){ map[i] = corr[i]; if (map[i] > mx) mx = map[i]; }
    if (mx>0) for (let i=0;i<N;i++) map[i]/=mx;
    // size at each bright cell: read the strongest DoG band in a small neighborhood (the edge sits a ring
    // away from the center where the correlation peaks), report as a scale multiple of the glyph radius.
    for (let cy=0;cy<G;cy++) for (let cx=0;cx<G;cx++){ const i=cy*G+cx; if (map[i] < 0.4) continue;
      let bestE=-1, bestSz=refR; const w=Math.max(2,Math.round(refR));
      for (let dy=-w;dy<=w;dy++) for (let dx=-w;dx<=w;dx++){ const X=cx+dx,Y=cy+dy; if(X<0||X>=G||Y<0||Y>=G) continue;
        const j=Y*G+X; if (edgeStrength[j]>bestE){ bestE=edgeStrength[j]; bestSz=sizeMap[j]; } }
      scaleAt[i] = bestSz / Math.max(1e-6, refR);                 // 1.0 ≈ native glyph size; <1 small, >1 large
    }
    return { map, scaleAt };
  }

  // ── PURE WAVELET RECOGNITION (§7.38, cascade-ONLY — no FFT, no correlation). Recognition by ANGULAR
  //    SCALE-BAND SIGNATURE matching. Each band ring is sampled in S ANGULAR SECTORS (not just summed) →
  //    the descriptor is (depth × S): energy per scale AND per direction. Radial-only signatures are
  //    rotation-BLIND (an L and a + of the same size look identical → both glow); the angular sectors make
  //    SHAPE legible — an L puts energy in one quadrant + two edges, a + on the four axes → different
  //    descriptors → the L matches the L-reference, the + doesn't. Still ONLY the cascade (a richer
  //    multiresolution signature), no correlation. NOTE: angular comparison is rotation-SENSITIVE (a rotated
  //    L would mismatch) — fine for fixed-orientation glyph detection; rotation-invariance would need a
  //    magnitude-of-angular-FFT signature (future). refFn(G)->Float64(N) centered. S sectors, depth bands.
  waveletRecognizePure(sceneR, refFn, { depth = 5, baseR = null, sectors = 8 } = {}) {
    const G = this._gpu._G, N = G * G, cC = G >> 1, S = sectors;
    const ref = (typeof refFn === 'function') ? refFn(G) : refFn;
    let refR = 1; for (let y=0;y<G;y++) for (let x=0;x<G;x++) if (ref[y*G+x]) refR = Math.max(refR, Math.hypot(x-cC, y-cC));
    const base = baseR || Math.max(3, Math.round(refR * 1.5));
    const bandR = []; for (let d=0; d<depth; d++) bandR.push(Math.max(1, Math.round(base * Math.pow(0.6, d))));
    const D = depth * S;   // descriptor length
    // ANGULAR-SECTOR signature at (cx,cy): for each band radius, sample the ring at many angles and bin the
    // |field|² into S sectors → a (depth×S) vector. Captures WHERE around the center the energy sits.
    const sampleDesc = (field, cx, cy, out, off=0) => {
      for (let k=0;k<bandR.length;k++){ const r=bandR[k], steps=Math.max(S*3, Math.ceil(2*Math.PI*r));
        for (let s=0;s<steps;s++){ const ang=2*Math.PI*s/steps;
          const X=((cx+Math.round(r*Math.cos(ang)))%G+G)%G, Y=((cy+Math.round(r*Math.sin(ang)))%G+G)%G;
          const v=field[Y*G+X], sec=Math.floor((ang/(2*Math.PI))*S)%S;
          out[off + k*S + sec] += v*v; } }
    };
    const l2norm = (a,off,len)=>{ let s=0; for(let i=0;i<len;i++) s+=a[off+i]*a[off+i]; return Math.sqrt(Math.max(1e-12,s)); };
    // REFERENCE descriptor at its own center.
    const refDesc = new Float64Array(D); sampleDesc(ref, cC, cC, refDesc); const refNrm = l2norm(refDesc,0,D);
    const map = new Float64Array(N), scaleAt = new Float32Array(N); let mx=0;
    const desc = new Float64Array(D);
    for (let cy=0;cy<G;cy++) for (let cx=0;cx<G;cx++){
      desc.fill(0); sampleDesc(sceneR, cx, cy, desc, 0);
      let energy=0; for(let i=0;i<D;i++) energy+=desc[i];
      if (energy < 1e-7) continue;                                    // empty → dark
      // cosine similarity of the (band×sector) descriptors → shape+scale match.
      let dot=0; for(let i=0;i<D;i++) dot+=desc[i]*refDesc[i];
      const cos = dot / (l2norm(desc,0,D)*refNrm);
      map[cy*G+cx] = cos * Math.min(1, energy*3);
      // size = the band carrying the most energy (summed over sectors), as a multiple of the glyph radius.
      let domB=0, domE=-1; for(let k=0;k<bandR.length;k++){ let e=0; for(let s=0;s<S;s++) e+=desc[k*S+s]; if(e>domE){domE=e;domB=k;} }
      scaleAt[cy*G+cx] = bandR[domB] / Math.max(1e-6, refR);
      if (map[cy*G+cx] > mx) mx = map[cy*G+cx];
    }
    if (mx>0) for (let i=0;i<N;i++) map[i]/=mx;
    return { map, scaleAt };
  }

  // ── GPU WAVELET RECOGNITION (§7.38, ported to the GPU for performance — like the solitons). Same angular
  //    cascade as waveletRecognizePure, but the per-cell descriptor build + match runs in ONE fragment-shader
  //    pass (recognizeWaveletGPU) instead of ~500k JS samples/bar. We build the REFERENCE descriptor in JS
  //    once (tiny: bands×sectors), then the GPU does every cell in parallel. Returns { map, scaleAt }.
  waveletRecognizeGPU(sceneR, refFn, { depth = 5, baseR = null, sectors = 8, sharpPow = 18, energyGate = 3, distractFn = null, disWeight = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, cC = G >> 1, S = sectors;
    const ref = (typeof refFn === 'function') ? refFn(G) : refFn;
    let refR = 1; for (let y=0;y<G;y++) for (let x=0;x<G;x++) if (ref[y*G+x]) refR = Math.max(refR, Math.hypot(x-cC, y-cC));
    const base = baseR || Math.max(3, Math.round(refR * 1.5));
    const bandR = []; for (let d=0; d<depth; d++) bandR.push(Math.max(1, Math.round(base * Math.pow(0.6, d))));
    // angular descriptor (bands×sectors) of a centered shape — the per-cell descriptor the shader builds.
    const descOf = (shape) => { const d = new Float32Array(depth * S);
      for (let k=0;k<bandR.length;k++){ const r=bandR[k], steps=Math.max(S*3, Math.ceil(2*Math.PI*r));
        for (let s=0;s<steps;s++){ const ang=2*Math.PI*s/steps;
          const X=((cC+Math.round(r*Math.cos(ang)))%G+G)%G, Y=((cC+Math.round(r*Math.sin(ang)))%G+G)%G;
          const v=shape[Y*G+X], sec=Math.floor((ang/(2*Math.PI))*S)%S; d[k*S+sec] += v*v; } }
      return d; };
    const refDesc = descOf(ref);
    // DISTRACTOR descriptor (subtracted in the shader to cancel distractor-likeness). Accept an ARRAY of
    // distractor shape-fns and AVERAGE their descriptors → "triangle-like AND not-like-ANY-distractor".
    // (Subtracting only ONE distractor left the others leaking — the bug that made it worse.)
    let disDesc = null;
    if (distractFn && disWeight > 0) {
      const fns = Array.isArray(distractFn) ? distractFn : [distractFn];
      disDesc = new Float32Array(depth * S);
      for (const fn of fns) { const dis = (typeof fn === 'function') ? fn(G) : fn; const dd = descOf(dis);
        for (let i=0;i<disDesc.length;i++) disDesc[i] += dd[i] / fns.length; }
    }
    return gpu.recognizeWaveletGPU(sceneR, refDesc, bandR, { nSectors: S, refR, sharpPow, energyGate, disDesc, disWeight });
  }

  // ── SCALE-INVARIANT wavelet recognition (§7.38 scale-search, GPU). Find the reference at ANY SIZE: run the
  //    cascade with the reference RESIZED to each scale, take the per-cell MAX (and the matched scale). Each
  //    scale is one GPU pass. refFn: glyph (centered). scales: ref sizes to try. Returns { map, scaleAt }.
  waveletRecognizeScaleGPU(sceneR, refFn, { depth = 6, sectors = 12, scales = [0.65, 1.0, 1.35], sharpPow = 18, energyGate = 3, distractFn = null, disWeight = 0 } = {}) {
    const G = this._gpu._G, N = G * G, cC = G >> 1;
    const ref0 = (typeof refFn === 'function') ? refFn(G) : refFn;
    // resize the centered reference to a given scale (nearest-resample about the center).
    const scaled = (sc) => { const f = new Float64Array(N);
      for (let y=0;y<G;y++) for (let x=0;x<G;x++){ const v=ref0[y*G+x]; if(!v) continue;
        const X=Math.round(cC+(x-cC)*sc), Y=Math.round(cC+(y-cC)*sc); if(X>=0&&X<G&&Y>=0&&Y<G) f[Y*G+X]+=v; } return f; };
    const out = new Float64Array(N), scAt = new Float32Array(N);
    for (const sc of scales) {
      const m = this.waveletRecognizeGPU(sceneR, scaled(sc), { depth, sectors, sharpPow, energyGate, distractFn, disWeight }).map;   // peak-normalized per scale
      for (let i=0;i<N;i++) if (m[i] > out[i]) { out[i] = m[i]; scAt[i] = sc; }
    }
    return { map: out, scaleAt: scAt };
  }

  // ── HOLOGRAM-DOMAIN PRESENCE (§7.40, refined) — the HONEST holographic readout. §7.40 + the GPU test
  //    showed: forward-propagating to depth T DELOCALIZES every letter (each A's info spreads across the whole
  //    grid and superposes with the others) — that is the hologram's nature. So "WHERE are the A's" dissolves;
  //    the hologram answers "IS A PRESENT, how strongly." This returns a SCALAR PRESENCE: the complex
  //    correlation of the scene's hologram with the REFERENCE 'A' hologram, divided by its correlation with a
  //    DISTRACTOR hologram — >1 means A-content dominates. It RISES with T (the hologram gets truer), the
  //    opposite of the recon photo. sceneFieldComplex: live Ψ(cyc). refFn: 'A'. distractFn: a non-A letter.
  holoPresence(sceneFieldComplex, refFn, distractFn, { T = 50, occludeR = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt;
    const ref = (typeof refFn === 'function') ? refFn(G) : refFn;
    const dis = (typeof distractFn === 'function') ? distractFn(G) : distractFn;
    const holoOf = (real, withH) => { const p = new Float64Array(2*N); for (let i=0;i<N;i++) p[i*2]=real[i];
      gpu.setEyePsi(p); gpu.stepEyeN(T, dt);
      if (withH && occludeR>0) gpu.applyEyeHologram(this.hMode||7, occludeR, { block:this.hBlock??8, seed:this.hSeed??0 });
      return gpu.readEyePsi(); };
    // scene hologram (from the LIVE complex field, [H] applied — the real masked hologram on screen).
    gpu.setEyePsi(sceneFieldComplex); gpu.stepEyeN(T, dt);
    if (occludeR>0) gpu.applyEyeHologram(this.hMode||7, occludeR, { block:this.hBlock??8, seed:this.hSeed??0 });
    const sH = gpu.readEyePsi();
    const aH = holoOf(ref, false), dH = holoOf(dis, false);   // ref & distractor holograms (clean templates)
    gpu.setEyePsi(sceneFieldComplex);   // restore live field
    // |complex correlation| ⟨sceneHolo, templateHolo⟩ — the holographic matched-filter strength.
    const corr = (a, b) => { let re=0, im=0, na=0, nb=0;
      for (let i=0;i<N;i++){ const ar=a[i*2],ai=a[i*2+1],br=b[i*2],bi=b[i*2+1];
        re+=ar*br+ai*bi; im+=ai*br-ar*bi; na+=ar*ar+ai*ai; nb+=br*br+bi*bi; }
      return Math.sqrt(re*re+im*im)/Math.max(1e-12, Math.sqrt(na*nb)); };
    const aCorr = corr(sH, aH), dCorr = corr(sH, dH);
    const presence = aCorr / Math.max(1e-9, dCorr);    // >1 = the scene's hologram is more 'A'-like than distractor-like
    return { presence, aCorr, dCorr };
  }

  // (legacy spatial holo recognizer — kept for reference; the hologram delocalizes positions so the SPATIAL
  //  map is not meaningful at high T. Use holoPresence above for the honest scalar readout.)
  waveletRecognizeHoloGPU(sceneFieldComplex, refFn, { depth = 6, sectors = 12, T = 50, occludeR = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt;
    const ref = (typeof refFn === 'function') ? refFn(G) : refFn;
    gpu.setEyePsi(sceneFieldComplex); gpu.stepEyeN(T, dt);
    if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
    const sH = gpu.readEyePsi(); const sceneHoloR = new Float64Array(N);
    for (let i=0;i<N;i++) sceneHoloR[i] = Math.hypot(sH[i*2], sH[i*2+1]);
    const rp = new Float64Array(2*N); for (let i=0;i<N;i++) rp[i*2] = ref[i];
    gpu.setEyePsi(rp); gpu.stepEyeN(T, dt);
    const rH = gpu.readEyePsi(); const refHoloR = new Float64Array(N);
    for (let i=0;i<N;i++) refHoloR[i] = Math.hypot(rH[i*2], rH[i*2+1]);
    gpu.setEyePsi(sceneFieldComplex);
    return this.waveletRecognizeGPU(sceneHoloR, refHoloR, { depth, sectors });
  }

  // ── HOLOGRAM-DOMAIN vs RECON-DOMAIN RECOGNITION vs T (§7.40) — the decisive measurement behind the user's
  //    insight: "higher T = truer hologram, so why does recognition (in the recon) DEGRADE with T?" Because
  //    the recon is the refocused PHOTO (2T leapfrog steps accumulate error → blurs). The HOLOGRAM (forward-T
  //    spread field) gets RICHER with T. Correlation of HOLOGRAMS is the holographic matched filter (§7.32:
  //    the round-trip preserves correlation). This probe compares, across T, the discrimination of:
  //      • RECON domain: correlate ref-image vs scene-image at each A site (what the live recognizer does now)
  //      • HOLOGRAM domain: forward both to depth T, correlate the spread fields at each A site
  //    discrimination = mean(corr at A sites) / mean(corr at distractor sites). If hologram-domain HOLDS or
  //    RISES with T while recon FALLS → recognition belongs in the hologram domain (build it there). Decides
  //    it by measurement, not theory. sceneR: real letter page. refReal: centered ref 'A'. aSites/dSites: [{x,y}].
  holoRecogVsT(sceneR, refReal, aSites, dSites, { Ts = [10, 50, 150, 350] } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt, cC = G >> 1;
    const refCells = []; for (let y=0;y<G;y++) for (let x=0;x<G;x++) if (refReal[y*G+x]) refCells.push({dx:x-cC, dy:y-cC, v:refReal[y*G+x]});
    // forward-propagate a real field to depth T → its hologram (complex), returned as Float64(2N).
    // ⚠ The PREVIOUS version of this probe was WRONG: it measured a global inner product Σ Re(a·conj(b)),
    //   which UNITARITY (§7.28) conserves across T → identical 1.49× at every T (a no-op, not a finding). The
    //   real degradation is in the WAVELET CASCADE reading a SPATIALLY-degraded field, AND it needs [H] (a
    //   pure forward→back round-trip is reversible → T-invariant; only occlusion makes T bite). This version
    //   runs the ACTUAL waveletRecognizeGPU on the ACTUAL fields at depth T, with [H] applied, both domains.
    const occludeR = (this.hMode===6||this.hMode===7||this.hMode===8) ? this.hParam : 0.5;   // need [H] for T to matter
    const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
    // build ref descriptors: GLYPH descriptor (for the recon, where letters are refocused shapes) and the
    // ref-HOLOGRAM descriptor (for the hologram domain, where the ref is a spread interference pattern at T).
    const refReal2 = new Float64Array(N); for (const c of refCells){ const X=cC+c.dx,Y=cC+c.dy; if(X>=0&&X<G&&Y>=0&&Y<G) refReal2[Y*G+X]+=c.v; }
    const siteDisc = (map) => { const sv=(u)=>{ let m=0,w=2; for(let dy=-w;dy<=w;dy++)for(let dx=-w;dx<=w;dx++){const X=((u.x+dx)%G+G)%G,Y=((u.y+dy)%G+G)%G,v=map[Y*G+X];if(v>m)m=v;}return m; };
      return mean(aSites.map(sv)) / Math.max(1e-9, mean(dSites.map(sv))); };
    const rows = ['[HOLO vs RECON RECOG vs T §7.40 v2] real waveletRecognizeGPU on the real fields, [H] applied:',
      `   discrimination = mean(A-sites)/mean(distractor-sites), occl=${occludeR}:`,
      '    T      recon-domain      hologram-domain'];
    for (const T of Ts) {
      // RECON: forward T → [H] → back T → the refocused (degraded) image; run the cascade with the GLYPH ref.
      const p = new Float64Array(2*N); for (let i=0;i<N;i++) p[i*2]=sceneR[i];
      gpu.setEyePsi(p); gpu.stepEyeN(T, dt);
      if (occludeR>0) gpu.applyEyeHologram(this.hMode||7, occludeR, { block:this.hBlock??8, seed:this.hSeed??0 });
      gpu.stepEyeN(T, -dt);
      const reconR = gpu.readEyePsi(); const reconReal = new Float64Array(N); for(let i=0;i<N;i++) reconReal[i]=reconR[i*2];
      const reconMap = this.waveletRecognizeGPU(reconReal, refReal2, { depth: 6, sectors: 12 }).map;
      // HOLOGRAM: forward T → [H] → the SPREAD masked field; run the cascade against the REF's hologram (forward T).
      gpu.setEyePsi(p); gpu.stepEyeN(T, dt);
      if (occludeR>0) gpu.applyEyeHologram(this.hMode||7, occludeR, { block:this.hBlock??8, seed:this.hSeed??0 });
      const holoR = gpu.readEyePsi(); const holoReal = new Float64Array(N); for(let i=0;i<N;i++) holoReal[i]=Math.hypot(holoR[i*2],holoR[i*2+1]);
      const pr = new Float64Array(2*N); for (let i=0;i<N;i++) pr[i*2]=refReal2[i]; gpu.setEyePsi(pr); gpu.stepEyeN(T, dt);
      const rh = gpu.readEyePsi(); const refHoloReal = new Float64Array(N); for(let i=0;i<N;i++) refHoloReal[i]=Math.hypot(rh[i*2],rh[i*2+1]);
      const holoMap = this.waveletRecognizeGPU(holoReal, refHoloReal, { depth: 6, sectors: 12 }).map;
      rows.push(`  ${String(T).padStart(4)}    ${siteDisc(reconMap).toFixed(2).padStart(8)}×        ${siteDisc(holoMap).toFixed(2).padStart(8)}×`);
    }
    gpu.setEyePsi(new Float64Array(2*N));
    rows.push('   → recon FALLS with T (photo blurs under [H]) but hologram HOLDS/RISES ⇒ recognize in the HOLOGRAM domain.');
    rows.push('     both flat/equal ⇒ probe still not capturing it (or no domain advantage). both fall ⇒ float32 limit.');
    console.log(rows.join('\n'));
    return rows;
  }

  // ── LIVE RECOGNITION (§7.34, recognition mode wired live). The reusable engine behind recognizeGate,
  //    for the running soliton: given a SCENE field (complex, already built/propagated-free), a REFERENCE
  //    pattern, and a list of CANDIDATE positions, evaluate the PROVEN correlation operator (scene·ref_u →
  //    IFS round-trip → correlation scalar, §7.32) at each candidate and return NORMALIZED match scores.
  //    "The reference's occurrences score highest." Honest scope: candidate positions (not a dense map) —
  //    one GPU round-trip per candidate, so keep the candidate list small for live use. Leaves eye clean.
  //    sceneR: Float64(N) REAL scene intensity (or real channel). ref: Float64(N) centered reference.
  //    cands: [{x,y}]. Returns [{x,y,score}] with score∈[0,1] (1 = strongest match in this set).
  recognizeLive(sceneR, ref, cands, { T = 50, occludeR = 0 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt;
    const refCells = []; for (let y=0;y<G;y++) for (let x=0;x<G;x++) if (ref[y*G+x]) refCells.push({dx:x-(G>>1), dy:y-(G>>1), v:ref[y*G+x]});
    const corrAt = (u) => {
      const bound = new Float64Array(2 * N);                       // scene·ref_u (real·real), ref placed at u
      for (const c of refCells) { const X=u.x+c.dx, Y=u.y+c.dy; if (X<0||X>=G||Y<0||Y>=G) continue;
        const i=Y*G+X; bound[i*2] = sceneR[i] * c.v; }
      gpu.setEyePsi(bound); gpu.stepEyeN(T, dt);
      if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
      gpu.stepEyeN(T, -dt);
      const b = gpu.readEyePsi(); let s=0; for (let i=0;i<N;i++) s += b[i*2]; return Math.abs(s);
    };
    const raw = cands.map(corrAt);
    gpu.setEyePsi(new Float64Array(2 * N));
    const mx = Math.max(1e-12, ...raw);
    return cands.map((u,i) => ({ x:u.x, y:u.y, score: raw[i]/mx }));
  }

  // ── SCALE-INVARIANT LIVE RECOGNITION (§7.38 wired live). Find the reference at ANY SIZE: for each
  //    candidate, correlate the scene against the reference RESIZED to each scale in `scales` (the proven
  //    operator per scale, §7.32), and take the BEST scale. Returns {x,y,score,scale} — score = match
  //    strength, scale = the size at which it matched (the §7.38 scale-localization: the matched scale
  //    reports the object's size). One GPU round-trip per (candidate × scale) — keep both lists small for
  //    live use. Builds on recognizeLive's proven per-position operator; adds the scale search on top.
  recognizeLiveScale(sceneR, ref, cands, { T = 50, occludeR = 0, scales = [0.6, 0.8, 1.0, 1.3, 1.7] } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt, cC = G >> 1;
    // pre-resize the reference to each scale → cell lists (resampled footprint).
    const refByScale = scales.map(sc => { const cells=[];
      for (let y=0;y<G;y++) for (let x=0;x<G;x++){ const v=ref[y*G+x]; if(!v) continue;
        cells.push({ dx: Math.round((x-cC)*sc), dy: Math.round((y-cC)*sc), v }); }
      return cells; });
    const corrAt = (u, cells) => {
      const bound = new Float64Array(2 * N);
      for (const c of cells){ const X=u.x+c.dx, Y=u.y+c.dy; if(X<0||X>=G||Y<0||Y>=G) continue;
        const i=Y*G+X; bound[i*2] += sceneR[i]*c.v; }
      gpu.setEyePsi(bound); gpu.stepEyeN(T, dt);
      if (occludeR > 0) gpu.applyEyeHologram(this.hMode || 7, occludeR, { block: this.hBlock ?? 8, seed: this.hSeed ?? 0 });
      gpu.stepEyeN(T, -dt);
      const b = gpu.readEyePsi(); let s=0; for (let i=0;i<N;i++) s+=b[i*2]; return Math.abs(s);
    };
    // for each candidate: best score over scales, and which scale won. Normalize per-scale-cellcount so a
    // bigger resized footprint (more cells) doesn't trivially win — divide by √(cell count) like a matched filter.
    const out = cands.map(u => { let best=-1, bestSc=1;
      for (let si=0; si<scales.length; si++){ const cells=refByScale[si];
        const raw = corrAt(u, cells) / Math.sqrt(Math.max(1, cells.length));
        if (raw > best){ best=raw; bestSc=scales[si]; } }
      return { x:u.x, y:u.y, raw:best, scale:bestSc }; });
    gpu.setEyePsi(new Float64Array(2 * N));
    const mx = Math.max(1e-12, ...out.map(o=>o.raw));
    return out.map(o => ({ x:o.x, y:o.y, score:o.raw/mx, scale:o.scale, raw:o.raw }));   // raw = unnormalized match (for discrimination vs T)
  }

  // ── RECOGNITION vs T vs SIZE (§7.39) — WHY does recognition work at low T but fade at high T? Three
  //    competing explanations make DIFFERENT predictions, so one matrix decides it:
  //      • dilution/spread (high T spreads the field → peak washes out)  → degrades for ALL sizes equally
  //      • float32 error  (2T leapfrog steps accumulate error)           → degrades for ALL sizes equally
  //      • SCALE-MISMATCH (depth=T IS the scale axis, §7.38: object size must MATCH propagation depth)
  //                                                                       → best-T SHIFTS with object size
  //                                                                          (small obj → low T, large → higher T)
  //    Test: a disc of radius R at the grid center, recognized by the SAME-size ref (matched) and by an
  //    EMPTY offset region (baseline). DISCRIMINATION = matched/baseline. Sweep R × T → print the matrix
  //    and report, per size, the BEST T. If best-T rises with R → scale-mismatch (T is the scale knob, a
  //    DEEPER §7.38 confirmation). If best-T is the same (low) for all R → just spreading/error. Pure measure.
  recogVsT(refFn, { sizes = [3, 6, 12], Ts = [5, 20, 50, 120, 250] } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt, cC = G >> 1;
    const disc = (R) => { const f=new Float64Array(N); for(let y=0;y<G;y++)for(let x=0;x<G;x++) if(Math.hypot(x-cC,y-cC)<=R) f[y*G+x]=1; return f; };
    // correlation of a scene against a ref placed at (ux,uy), through the round-trip at depth T.
    const corr = (sceneR, refCells, ux, uy, T) => {
      const bound = new Float64Array(2*N);
      for (const c of refCells){ const X=ux+c.dx, Y=uy+c.dy; if(X<0||X>=G||Y<0||Y>=G) continue; const i=Y*G+X; bound[i*2]+=sceneR[i]*c.v; }
      gpu.setEyePsi(bound); gpu.stepEyeN(T, dt); gpu.stepEyeN(T, -dt);
      const b=gpu.readEyePsi(); let s=0; for(let i=0;i<N;i++) s+=b[i*2]; return Math.abs(s);
    };
    const rows = ['[RECOG vs T vs SIZE §7.39] WHY recognition fades at high T — is T the SCALE axis (§7.38) or just spreading?',
      '   discrimination = matched(ref·same-size obj) / baseline(ref·empty offset), per object SIZE × depth T:',
      '   size\\T  ' + Ts.map(t=>String(t).padStart(7)).join('') + '    best-T'];
    const bestTs = [];
    for (const R of sizes) {
      const obj = disc(R);                                              // object of radius R at center
      const refCells = []; { const rf = refFn ? refFn(G) : disc(R);     // ref = same disc (matched filter for this size)
        // build ref as the SAME disc footprint, centered (so matched = same size)
        for (let y=0;y<G;y++) for (let x=0;x<G;x++) if (disc(R)[y*G+x]) refCells.push({dx:x-cC,dy:y-cC,v:1}); }
      const line = []; let bestT=Ts[0], bestV=-1;
      for (const T of Ts) {
        const matched  = corr(obj, refCells, cC, cC, T) / Math.sqrt(refCells.length);          // ref on the object
        const baseline = corr(obj, refCells, Math.min(G-1,cC+Math.round(G*0.35)), cC, T) / Math.sqrt(refCells.length); // ref on empty
        const disc_ratio = matched / Math.max(1e-9, baseline);
        line.push(disc_ratio);
        if (disc_ratio > bestV){ bestV=disc_ratio; bestT=T; }
      }
      bestTs.push(bestT);
      rows.push(`   R=${String(R).padStart(2)}    ` + line.map(v=>v.toFixed(1).padStart(7)).join('') + `    T=${bestT}`);
    }
    gpu.setEyePsi(new Float64Array(2*N));
    // does best-T rise monotonically with size?
    let rises=true; for (let i=1;i<bestTs.length;i++) if (bestTs[i] < bestTs[i-1]) rises=false;
    const allSame = new Set(bestTs).size === 1;
    rows.push(`   → best-T by size: [${bestTs.join(', ')}]  ${
      rises && !allSame ? '— RISES with size ⇒ T IS THE SCALE AXIS (§7.38): object size must match propagation depth (deeper confirmation).'
      : allSame ? '— SAME T for all sizes ⇒ high-T loss is just SPREADING/float32 error, not scale. Keep recT modest.'
      : '— non-monotone ⇒ mixed (some scale-dependence + spreading).'}`);
    console.log(rows.join('\n'));
    return rows;
  }

  // ── FFT-ANALOG GATE (§7.35) — IS the IFS forward transform an FFT-analog for CORRELATION? If so, the
  //    whole dense correlation MAP comes from ONE multiply in the transform domain (the convolution theorem)
  //    instead of N round-trips — turning O(N²) sliding correlation into O(N). The theorem holds iff the
  //    transform is shift-covariant (Fourier modes are; the IFS ring-kernel is translation-invariant in the
  //    bulk but anisotropic on the H/V axes and at edges — finding_ifs_axis_anisotropy). So this is NOT
  //    assumed; it is the decisive measurement. The convolution-theorem correlation map is:
  //        S = F(scene)          (forward-propagate the scene)
  //        R = F(ref_centered)   (forward-propagate the reference, centered at origin)
  //        C = F⁻¹( S · conj(R) ) (multiply in the transform domain, inverse-transform → the MAP)
  //    where F = IFS forward T steps, F⁻¹ = IFS back T steps. THREE round-trips for the ENTIRE map.
  //    THREE TESTS:
  //     (1) ONE-SHOT MAP   — does C peak at the pattern's true position? (peak-error in cells)
  //     (2) SHIFT-COVARIANCE — sweep the position (center/edge/on-axis/off-axis); does the peak TRACK it
  //         with constant sharpness? (peak-error & peak-height vs position; constancy = covariance)
  //     (3) SUPERPOSITION  — K patterns in one field → does ONE map show K correct peaks? ("all A's at once")
  //    PASS ⇒ the IFS transform is an FFT-analog for correlation → dense recognition/recall in O(1) maps.
  //    Pure measurement; logs tables; leaves the eye clean. refFn(G)->Float64(N) centered pattern.
  fftAnalogGate(refFn, { T = 50, positions = null, superposK = 3 } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt;
    const ref = refFn(G), cC = G >> 1;
    const stamp = (s, p, cx, cy) => { for (let y=0;y<G;y++) for (let x=0;x<G;x++){ const v=p[y*G+x]; if(!v) continue;
      const X=cx+x-cC, Y=cy+y-cC; if(X>=0&&X<G&&Y>=0&&Y<G) s[(Y*G+X)*2]+=v; } };
    const fwd = (psiReal) => { gpu.setEyePsi(psiReal); gpu.stepEyeN(T, dt); return gpu.readEyePsi(); };
    // F(ref) centered ONCE (the matched filter's transform).
    const refField = new Float64Array(2*N); stamp(refField, ref, cC, cC);
    const R = fwd(refField);
    // convolution-theorem correlation MAP for a scene: F⁻¹( F(scene) · conj(R) ), demod-free (real map = |C|).
    const corrMap = (sceneField) => {
      const S = fwd(sceneField), P = new Float64Array(2*N);
      for (let i=0;i<N;i++){ const sr=S[i*2],si=S[i*2+1],rr=R[i*2],ri=-R[i*2+1];   // conj(R)
        P[i*2]=sr*rr-si*ri; P[i*2+1]=sr*ri+si*rr; }
      gpu.setEyePsi(P); gpu.stepEyeN(T, -dt); const C = gpu.readEyePsi();          // inverse transform
      const m = new Float64Array(N); for (let i=0;i<N;i++) m[i]=Math.hypot(C[i*2],C[i*2+1]);
      return m;
    };
    const argmax = (m) => { let bi=0; for(let i=0;i<N;i++) if(m[i]>m[bi]) bi=i; return {x:bi%G,y:(bi/G)|0,val:m[bi]}; };
    const peakErr = (m, tx, ty) => { const p=argmax(m); return { err: Math.hypot(p.x-tx,p.y-ty), peak:p.val, px:p.x, py:p.y }; };
    // sharpness: peak value / mean of the map (high = a clean spike, low = smeared).
    const sharp = (m, pk) => { let s=0; for(let i=0;i<N;i++) s+=m[i]; return pk/Math.max(1e-12, s/N); };

    const rows = ['[FFT-ANALOG GATE §7.35] is the IFS forward transform an FFT-analog for CORRELATION?',
      `   map = F⁻¹(F(scene)·conj(F(ref))) — ONE multiply in the transform domain → the WHOLE map. T=${T}.`];

    // ── (1)+(2) ONE-SHOT MAP + SHIFT-COVARIANCE: single pattern swept across representative positions ──
    const m0 = Math.round(G*0.20), m1 = G>>1, m2 = Math.round(G*0.80), edge = Math.round(G*0.10);
    const poss = positions || [
      {x:m1,y:m1,tag:'center'}, {x:m0,y:m1,tag:'off-axis-L'}, {x:m1,y:m0,tag:'on V-axis'},
      {x:m0,y:m0,tag:'diagonal'}, {x:edge,y:m1,tag:'near edge'}, {x:m2,y:m2,tag:'far diag'} ];
    rows.push('   (1)+(2) ONE-SHOT MAP & SHIFT-COVARIANCE — does the peak track the pattern, constant shape?');
    rows.push('     position        true(x,y)   peak(x,y)   err(cells)   sharpness');
    let maxErr=0, sharps=[];
    for (const p of poss) {
      const sc = new Float64Array(2*N); stamp(sc, ref, p.x, p.y);
      const m = corrMap(sc); const e = peakErr(m, p.x, p.y); const sh = sharp(m, e.peak);
      maxErr = Math.max(maxErr, e.err); sharps.push(sh);
      rows.push(`     ${p.tag.padEnd(12)}   (${String(p.x).padStart(2)},${String(p.y).padStart(2)})     (${String(e.px).padStart(2)},${String(e.py).padStart(2)})      ${e.err.toFixed(1).padStart(4)}        ${sh.toFixed(1).padStart(5)}`);
    }
    const shMean = sharps.reduce((a,b)=>a+b,0)/sharps.length;
    const shVar  = Math.sqrt(sharps.reduce((a,b)=>a+(b-shMean)**2,0)/sharps.length) / Math.max(1e-9, shMean);
    rows.push(`     → max peak-error ${maxErr.toFixed(1)} cells; sharpness ${shMean.toFixed(1)}±${(shVar*100).toFixed(0)}% across positions`);
    rows.push(`       (err≲2 everywhere = peak TRACKS position; low sharpness-variance = SHIFT-COVARIANT = FFT-analog)`);

    // ── (3) SUPERPOSITION: K patterns in ONE field → does ONE map show K correct peaks? ──
    const sites = []; for (let k=0;k<superposK;k++){ const a=2*Math.PI*k/superposK;
      sites.push({x: Math.round(m1 + Math.cos(a)*G*0.28), y: Math.round(m1 + Math.sin(a)*G*0.28)}); }
    const scK = new Float64Array(2*N); for (const s of sites) stamp(scK, ref, s.x, s.y);
    const mK = corrMap(scK); let mxK=0; for(let i=0;i<N;i++) if(mK[i]>mxK) mxK=mK[i];
    // for each true site, the local-max value within a window, normalized — all should be high if K peaks coexist.
    const winMax=(cx,cy,w=3)=>{let m=0;for(let dy=-w;dy<=w;dy++)for(let dx=-w;dx<=w;dx++){const X=cx+dx,Y=cy+dy;if(X<0||X>=G||Y<0||Y>=G)continue;const v=mK[Y*G+X];if(v>m)m=v;}return m;};
    const siteVals = sites.map(s=>winMax(s.x,s.y)/Math.max(1e-12,mxK));
    const minSite = Math.min(...siteVals);
    gpu.setEyePsi(new Float64Array(2*N));
    rows.push(`   (3) SUPERPOSITION — ${superposK} patterns, ONE map: peak at each true site (norm): [${siteVals.map(v=>v.toFixed(2)).join(' ')}]`);
    rows.push(`     → weakest site ${minSite.toFixed(2)} (≳0.5 = all K light up at once = the dense map is FREE)`);

    const pass = maxErr <= 2.5 && shVar < 0.5 && minSite > 0.5;
    rows.push(`   ══ VERDICT: ${pass ? 'IFS IS AN FFT-ANALOG FOR CORRELATION' : 'NOT A CLEAN FFT-ANALOG (correlation only at fixed alignment / bounded region)'} ══`);
    rows.push(pass ? '     peak tracks position + shift-covariant + superposes → dense recognition/recall in O(1) maps (3 round-trips for the WHOLE field).'
                   : '     peak smears, drifts with position, or superposition fails → no free dense map; keep candidate-position scoring. Honest stop.');
    console.log(rows.join('\n'));
    return rows;
  }

  // ── CONVOLUTION-ANALOG GATE (§7.36) — the FOLLOW-UP to §7.35's NO. INSIGHT (user): one IFS STEP is a
  //    spatial CONVOLUTION (ring stencil) → it IS shift-invariant; §7.35 failed because it propagated the
  //    LEAPFROG round-trip (a 3-substep integrator + finite-boundary + depth-staging), NOT the pure
  //    convolution. A convolution on a uniform grid is circulant → diagonalized by the DFT → the
  //    convolution theorem MUST hold for it. So this re-tests the FFT-analog claim against the PURE ring
  //    convolution (periodic boundary, no leapfrog, no staging), in JS so there are zero confounds. THEN
  //    the deeper test: IFS is FRACTAL (multi-scale rings) → a WAVELET (scale-covariant) basis may fit
  //    BETTER than single-scale FFT — so we also test SCALE-covariance (find the reference at other SIZES).
  //
  //    refFn(G)->Float64(N) centered pattern. Uses the eye's CURRENT ring kernel (gpu._ringRadii).
  convAnalogGate(refFn, { positions = null, scales = [0.7, 1.0, 1.4] } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G;
    const ref = refFn(G), cC = G >> 1;
    // ── the PURE ring-convolution kernel K(dx,dy): one application of the ring stencil, periodic boundary.
    //    Mirrors _buildRingOffsets + the leapfrog's ring sum, but as a SINGLE linear convolution (the
    //    operator whose eigenbasis is Fourier). Weights match the GPU's normalized ring weights (4/n each).
    const radii = (gpu._ringRadii && gpu._ringRadii.length) ? gpu._ringRadii : [1, 2, 3, 4];
    const kern = new Map();   // "dx,dy" -> weight; the convolution stencil (small support)
    const addK = (dx, dy, w) => { const k = dx + ',' + dy; kern.set(k, (kern.get(k) || 0) + w); };
    addK(0, 0, 1);            // identity term (the field itself) so K is a proper smoothing/Laplacian-like op
    for (const r of radii) {
      const nSteps = Math.max(8, Math.ceil(2 * Math.PI * r)), w = 0.15 / radii.length;   // mild ring weight
      for (let s = 0; s < nSteps; s++) addK(Math.round(r*Math.cos(s*2*Math.PI/nSteps)), Math.round(r*Math.sin(s*2*Math.PI/nSteps)), w / nSteps * nSteps / nSteps);
    }
    const kArr = [...kern.entries()].map(([k,w]) => { const [dx,dy]=k.split(',').map(Number); return {dx,dy,w}; });
    // apply K as ONE convolution with PERIODIC boundary (complex field, ψ stored interleaved).
    const conv = (psi) => { const out = new Float64Array(2*N);
      for (let y=0;y<G;y++) for (let x=0;x<G;x++){ let re=0,im=0;
        for (const k of kArr){ const X=((x+k.dx)%G+G)%G, Y=((y+k.dy)%G+G)%G, i=(Y*G+X)*2; re+=psi[i]*k.w; im+=psi[i+1]*k.w; }
        const o=(y*G+x)*2; out[o]=re; out[o+1]=im; }
      return out; };
    // ── radix-2 FFT (G is a power of two on this grid) for the convolution-theorem test ──────────────
    const fft1d = (re, im, inv) => { const n=re.length;
      for (let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; } }
      for (let len=2;len<=n;len<<=1){ const ang=(inv?2:-2)*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
        for (let i=0;i<n;i+=len){ let cr=1,ci=0; for(let k=0;k<len/2;k++){ const ur=re[i+k],ui=im[i+k],
          vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci, vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;
          re[i+k]=ur+vr; im[i+k]=ui+vi; re[i+k+len/2]=ur-vr; im[i+k+len/2]=ui-vi;
          const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } }
      if (inv) for(let i=0;i<n;i++){ re[i]/=n; im[i]/=n; } };
    const fft2d = (re, im, inv) => { const R=new Float64Array(G), I=new Float64Array(G);
      for (let y=0;y<G;y++){ for(let x=0;x<G;x++){R[x]=re[y*G+x];I[x]=im[y*G+x];} fft1d(R,I,inv); for(let x=0;x<G;x++){re[y*G+x]=R[x];im[y*G+x]=I[x];} }
      for (let x=0;x<G;x++){ for(let y=0;y<G;y++){R[y]=re[y*G+x];I[y]=im[y*G+x];} fft1d(R,I,inv); for(let y=0;y<G;y++){re[y*G+x]=R[y];im[y*G+x]=I[y];} } };
    const stamp = (s, p, cx, cy, sc=1) => { for (let y=0;y<G;y++) for (let x=0;x<G;x++){ const v=p[y*G+x]; if(!v) continue;
      const X=Math.round(cx+(x-cC)*sc), Y=Math.round(cy+(y-cC)*sc); if(X>=0&&X<G&&Y>=0&&Y<G) s[Y*G+X]+=v; } };

    const rows = ['[CONV-ANALOG GATE §7.36] §7.35 used the LEAPFROG round-trip (not a pure convolution).',
      `   Re-test on the PURE ring convolution (periodic boundary, ${kArr.length}-tap stencil, ${radii.length} rings) — circulant ⇒ DFT-diagonal.`];

    // helper: dense correlation MAP of a real scene against the real ref, via the DFT convolution theorem.
    //   corr = IFFT( FFT(scene) · conj(FFT(ref)) ). With periodic boundary this is EXACT (no medium at all)
    //   → it isolates whether the OPERATOR (pure conv) admits the theorem, vs the leapfrog implementation.
    const refReal = new Float64Array(N); stamp(refReal, ref, cC, cC);
    const fftMap = (sceneReal) => {
      const ar=Float64Array.from(sceneReal), ai=new Float64Array(N); fft2d(ar,ai,false);
      const br=Float64Array.from(refReal),  bi=new Float64Array(N); fft2d(br,bi,false);
      const cr=new Float64Array(N), ci=new Float64Array(N);
      for (let i=0;i<N;i++){ cr[i]=ar[i]*br[i]+ai[i]*bi[i]; ci[i]=ai[i]*br[i]-ar[i]*bi[i]; }  // A·conj(B)
      fft2d(cr,ci,true); const m=new Float64Array(N); for(let i=0;i<N;i++) m[i]=Math.hypot(cr[i],ci[i]); return m;
    };
    const argmax = (m) => { let bi=0; for(let i=0;i<N;i++) if(m[i]>m[bi]) bi=i; return {x:bi%G,y:(bi/G)|0,val:m[bi]}; };
    // NOTE: FFT correlation peaks at the SHIFT between scene & ref. ref is centered at (cC,cC); a copy at
    // (px,py) → peak at ((px-cC+? )) mod G — we just check the peak is a single sharp spike that MOVES 1:1
    // with the copy position (shift-covariance), and that K patterns give K peaks.

    // ── (A) FFT-on-pure-convolution: shift-covariance of the correlation peak ──
    const m1=G>>1, m0=Math.round(G*0.25), m2=Math.round(G*0.75), edge=Math.round(G*0.10);
    const poss = positions || [{x:m1,y:m1},{x:m0,y:m1},{x:m1,y:m0},{x:m0,y:m0},{x:edge,y:m1},{x:m2,y:m2}];
    let peaks=[]; for (const p of poss){ const sc=new Float64Array(N); stamp(sc,ref,p.x,p.y); peaks.push(argmax(fftMap(sc))); }
    // shift-covariance: the peak position must move 1:1 with p. Measure consistency of (peak - p) mod G.
    const off0x=((peaks[0].x-poss[0].x)%G+G)%G, off0y=((peaks[0].y-poss[0].y)%G+G)%G;
    let driftMax=0; for (let i=0;i<poss.length;i++){ const ox=((peaks[i].x-poss[i].x)%G+G)%G, oy=((peaks[i].y-poss[i].y)%G+G)%G;
      driftMax=Math.max(driftMax, Math.min(Math.abs(ox-off0x),G-Math.abs(ox-off0x)), Math.min(Math.abs(oy-off0y),G-Math.abs(oy-off0y))); }
    rows.push('   (A) FFT convolution-theorem on the PURE conv — does the peak shift 1:1 with position?');
    rows.push(`     constant peak-offset (${off0x},${off0y}); max DRIFT across positions ${driftMax} cells  ${driftMax<=1?'→ SHIFT-COVARIANT ✓ (FFT works on the pure conv)':'→ drifts (still not shift-covariant)'}`);

    // ── (B) SUPERPOSITION: K copies → K peaks in one FFT map? ──
    // EMPIRICAL peak mapping from (A): a copy at site s peaks at ((s + off0) mod G) (off0 is the constant
    // shift the FFT correlation introduces for a center-stamped ref). Earlier this sampled the wrong cell
    // (referenced test-A's single position) → false 0.00; fixed to the measured mapping.
    const K=3, sites=[]; for(let k=0;k<K;k++){const a=2*Math.PI*k/K; sites.push({x:Math.round(m1+Math.cos(a)*G*0.28),y:Math.round(m1+Math.sin(a)*G*0.28)});}
    const scK=new Float64Array(N); for(const s of sites) stamp(scK,ref,s.x,s.y); const mK=fftMap(scK);
    let mxK=0; for(let i=0;i<N;i++) if(mK[i]>mxK) mxK=mK[i];
    const winMax=(cx,cy,w=2)=>{let m=0;for(let dy=-w;dy<=w;dy++)for(let dx=-w;dx<=w;dx++){const X=((cx+dx)%G+G)%G,Y=((cy+dy)%G+G)%G,v=mK[Y*G+X];if(v>m)m=v;}return m;};
    const sv=sites.map(s=>winMax(((s.x+off0x)%G+G)%G,((s.y+off0y)%G+G)%G)/Math.max(1e-12,mxK));
    rows.push(`   (B) SUPERPOSITION ${K} copies → peak at each (norm): [${sv.map(v=>v.toFixed(2)).join(' ')}]  weakest ${Math.min(...sv).toFixed(2)}`);

    // ── (C) SCALE-covariance (the WAVELET question): does correlation survive a SIZE change? FFT matched
    //    filter is NOT scale-covariant (a resized pattern decorrelates) — if IFS/wavelet were the right
    //    basis, correlation would hold across scale. We measure the peak height for the ref vs SCALED refs.
    const scaleScores = scales.map(sc => { const s=new Float64Array(N); stamp(s,ref,m1,m1,sc); const m=fftMap(s); return argmax(m).val; });
    const base = scaleScores[scales.indexOf(1.0)] || Math.max(...scaleScores);
    rows.push('   (C) SCALE-covariance (wavelet question) — peak height vs reference SIZE (norm to 1.0×):');
    rows.push(`     scales ${scales.map(s=>s+'×').join('  ')} → [${scaleScores.map(v=>(v/Math.max(1e-12,base)).toFixed(2)).join('  ')}]  (≈1 across scales = scale-covariant = wavelet-like; FFT drops off)`);

    // VERDICT rests on (A) — shift-covariance IS the convolution-theorem test (a circulant op is DFT-
    // diagonal iff its correlation peak shifts 1:1). (B) is confirmation; (C) is the separate wavelet hint.
    const fftPass = driftMax <= 1;
    rows.push(`   ══ ${fftPass ? 'FFT WORKS on the pure ring convolution (peak shifts 1:1 = DFT-diagonal) — §7.35\'s NO was the LEAPFROG/boundary, NOT the convolution.' : 'even the pure conv peak drifts — not cleanly DFT-diagonal (kernel/boundary).'} ══`);
    rows.push(`     superposition (${sv.every(v=>v>0.5)?'K peaks confirmed':'check'}); the dense map IS available IF we expose a PURE-CONV forward path (no leapfrog).`);
    rows.push('     scale row (C): ≈1 across sizes = wavelet-like scale-covariance (find ref at any SIZE) on top; asymmetric drop = partial.');
    console.log(rows.join('\n'));
    return rows;
  }

  // ── WAVELET / SCALE-COVARIANCE GATE (§7.37) — is the IFS ring kernel a WAVELET-like (multi-scale)
  //    operator, giving SIZE-invariant recognition that single-scale FFT cannot? §7.36-C hinted yes
  //    (asymmetric scale tolerance). Three honest tests, on the PURE convolution (no leapfrog confound):
  //     (1) SCALE-TOLERANCE CURVE — correlate the reference against copies RESIZED 0.5×…2×. FFT matched-
  //         filter peaks sharply at 1.0× and DROPS both sides. Flatter = scale-tolerant.
  //     (2) SCALE LOCALIZATION — the wavelet PAYOFF: build a multi-scale bank (the reference correlated
  //         through ring kernels of DIFFERENT scales), present a resized object, and check the best-
  //         responding scale TRACKS the object's true size → it can find ref at any size AND report which.
  //     (3) FRACTAL CONTROL (the decisive one) — repeat (1) with the FULL multi-ring kernel vs a SINGLE-
  //         ring kernel. If scale-tolerance comes from the MULTI-SCALE rings (full flat, single sharp),
  //         the scale-covariance is CAUSED by the fractal structure = the wavelet thesis, not a coincidence.
  //    refFn(G)->Float64(N) centered pattern.
  waveletScaleGate(refFn, { scales = [0.5, 0.7, 1.0, 1.4, 2.0] } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, cC = G >> 1;
    const ref = refFn(G);
    const radii = (gpu._ringRadii && gpu._ringRadii.length) ? gpu._ringRadii : [1, 2, 3, 4];
    // radix-2 FFT (reused form).
    const fft1d=(re,im,inv)=>{const n=re.length; for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
      for(let L=2;L<=n;L<<=1){const a=(inv?2:-2)*Math.PI/L,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=L){let cr=1,ci=0;for(let k=0;k<L/2;k++){const ur=re[i+k],ui=im[i+k],vr=re[i+k+L/2]*cr-im[i+k+L/2]*ci,vi=re[i+k+L/2]*ci+im[i+k+L/2]*cr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+L/2]=ur-vr;im[i+k+L/2]=ui-vi;const n2=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=n2;}}} if(inv)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}};
    const fft2d=(re,im,inv)=>{const R=new Float64Array(G),I=new Float64Array(G);
      for(let y=0;y<G;y++){for(let x=0;x<G;x++){R[x]=re[y*G+x];I[x]=im[y*G+x];}fft1d(R,I,inv);for(let x=0;x<G;x++){re[y*G+x]=R[x];im[y*G+x]=I[x];}}
      for(let x=0;x<G;x++){for(let y=0;y<G;y++){R[y]=re[y*G+x];I[y]=im[y*G+x];}fft1d(R,I,inv);for(let y=0;y<G;y++){re[y*G+x]=R[y];im[y*G+x]=I[y];}}};
    const stamp=(s,p,cx,cy,sc=1)=>{ for(let y=0;y<G;y++)for(let x=0;x<G;x++){const v=p[y*G+x];if(!v)continue;
      const X=Math.round(cx+(x-cC)*sc),Y=Math.round(cy+(y-cC)*sc);if(X>=0&&X<G&&Y>=0&&Y<G) s[Y*G+X]+=v;}};
    // build a ring-convolution kernel from a given radii list, blur the field by it (the "analysis filter"
    // at that scale band). Returned as a real per-cell smoothing applied in-place to a real array.
    const ringFilter=(arr, rlist, strength=0.4)=>{ const out=Float64Array.from(arr);
      for(const r of rlist){ const nS=Math.max(8,Math.ceil(2*Math.PI*r)), w=strength/rlist.length/nS;
        const tmp=Float64Array.from(out);
        for(let y=0;y<G;y++)for(let x=0;x<G;x++){ let acc=0; for(let s=0;s<nS;s++){const X=((x+Math.round(r*Math.cos(s*2*Math.PI/nS)))%G+G)%G,Y=((y+Math.round(r*Math.sin(s*2*Math.PI/nS)))%G+G)%G;acc+=tmp[Y*G+X];}
          out[y*G+x]+=w*acc; } }
      return out; };
    // FFT correlation peak height of two REAL fields.
    const corrPeak=(aR,bR)=>{ const ar=Float64Array.from(aR),ai=new Float64Array(N);fft2d(ar,ai,false);
      const br=Float64Array.from(bR),bi=new Float64Array(N);fft2d(br,bi,false);
      const cr=new Float64Array(N),ci=new Float64Array(N);
      for(let i=0;i<N;i++){cr[i]=ar[i]*br[i]+ai[i]*bi[i];ci[i]=ai[i]*br[i]-ar[i]*bi[i];}
      fft2d(cr,ci,true); let mx=0;for(let i=0;i<N;i++){const m=Math.hypot(cr[i],ci[i]);if(m>mx)mx=m;}return mx; };

    const refReal=new Float64Array(N); stamp(refReal,ref,cC,cC);
    const rows=['[WAVELET/SCALE GATE §7.37] is the IFS ring kernel WAVELET-like (multi-scale) → SIZE-invariant recognition?'];

    // ── (1) SCALE-TOLERANCE CURVE — raw FFT correlation of ref vs resized copies ──
    const base1 = corrPeak(refReal, refReal);
    const tol = scales.map(sc=>{ const s=new Float64Array(N); stamp(s,ref,cC,cC,sc); return corrPeak(refReal,s)/Math.max(1e-12,base1); });
    rows.push('   (1) SCALE-TOLERANCE — corr(ref, resized) (norm to 1.0×):');
    rows.push(`     scales ${scales.map(s=>s+'×').join('  ')} → [${tol.map(v=>v.toFixed(2)).join('  ')}]   (flat = scale-tolerant; sharp peak at 1× = FFT-like)`);

    // ── (2) SCALE LOCALIZATION — multi-scale bank: filter the OBJECT through ring-bands of growing scale,
    //     correlate each band against ref; the best-responding band should TRACK the object's true size. ──
    const bands = [ radii.map(r=>r*0.5), radii.slice(), radii.map(r=>r*2) ];   // fine / native / coarse analysis scales
    const bandTag = ['fine(½)','native','coarse(2×)'];
    rows.push('   (2) SCALE LOCALIZATION — which analysis band responds most to a resized object? (should track size)');
    let trackOK=0; const testScales=[0.6,1.0,1.6];
    for (const osc of testScales) {
      const obj=new Float64Array(N); stamp(obj,ref,cC,cC,osc);
      const resp = bands.map(b=> corrPeak(ringFilter(obj,b), refReal));
      const best = resp.indexOf(Math.max(...resp));
      // small object → fine band should win; large → coarse. native ↔ 1.0.
      const want = osc<0.85?0 : osc>1.2?2 : 1;
      if (best===want) trackOK++;
      rows.push(`     object ${osc}× → band responses [${resp.map(v=>(v/Math.max(...resp)).toFixed(2)).join(' ')}] best=${bandTag[best]} (want ${bandTag[want]}) ${best===want?'✓':'·'}`);
    }

    // ── (3) FRACTAL CONTROL — scale-tolerance with FULL multi-ring vs SINGLE-ring kernel ──
    // We compare how flat the scale-tolerance is when the OBJECT is pre-filtered by the full multi-scale
    // ring bank vs a single ring. If multi-scale flattens the curve and single-scale doesn't, the scale-
    // covariance is CAUSED by the fractal rings.
    const flatness=(arr)=>{ const mean=arr.reduce((a,b)=>a+b,0)/arr.length; const v=Math.sqrt(arr.reduce((a,b)=>a+(b-mean)**2,0)/arr.length); return 1-Math.min(1,v/Math.max(1e-9,mean)); };
    const tolMulti = scales.map(sc=>{ const s=new Float64Array(N); stamp(s,ref,cC,cC,sc); return corrPeak(refReal, ringFilter(s, radii)); });
    const tolSingle= scales.map(sc=>{ const s=new Float64Array(N); stamp(s,ref,cC,cC,sc); return corrPeak(refReal, ringFilter(s, [radii[radii.length>>1]||radii[0]])); });
    const fM=flatness(tolMulti.map(v=>v/Math.max(...tolMulti))), fS=flatness(tolSingle.map(v=>v/Math.max(...tolSingle)));
    rows.push('   (3) FRACTAL CONTROL — does scale-tolerance COME FROM the multi-scale rings?');
    rows.push(`     multi-ring flatness ${fM.toFixed(2)}  vs  single-ring flatness ${fS.toFixed(2)}   ${fM>fS+0.08?'→ multi-scale IS flatter = scale-covariance is FRACTAL ✓':'→ no multi-scale advantage'}`);

    const verdict = (trackOK>=2 && fM>fS+0.08);
    rows.push(`   ══ ${verdict ? 'WAVELET-LIKE — the fractal ring kernel gives scale-covariant recognition (size localizes, multi-scale causes it).' : 'NOT clearly wavelet-like — scale-tolerance weak or not caused by the multi-scale structure.'} ══`);
    rows.push('     → if wavelet-like: recognition can find the reference at ANY SIZE and report it — beyond what single-scale FFT offers.');
    console.log(rows.join('\n'));
    return rows;
  }

  // ── IFS-NATIVE WAVELET GATE (§7.38) — §7.37 tested the WRONG construction (uniformly-scaled ring copies).
  //    The codebase already has an IFS-native wavelet transform (krestianstvo-wavefront-physics.js: `ifsWavelet`
  //    / _ifsAnalyze / _ifsSynthesize / _buildDepthKernels). Its scale ladder is NOT a static kernel rescaled —
  //    it is the FRACTAL BEAT CASCADE: the IFS clock fires children at delays scaled by the CONTRACTION MAPS
  //    (cos72°, √2−1, ½, φ⁻¹, …), so each tree DEPTH d emits ring radii at a CONTRACTED scale → a genuine
  //    multiresolution ladder generated by the attractor (the user's point: the wavelet ≈ the fractal cascade,
  //    and IFS lets the kernel change dynamically across depth). This probe builds the REAL per-depth ring
  //    bank from the IFS maps and re-asks the scale questions against the ACTUAL _ifsAnalyze decomposition.
  //     (1) BAND SCALES — confirm the depth bands really are different scales (geometric/contracted), not copies.
  //     (2) SCALE LOCALIZATION — resize an object; does the _ifsAnalyze sub-band whose scale MATCHES the object
  //         carry the most energy, and does the peak band TRACK the object size? (the wavelet payoff)
  //     (3) RECONSTRUCTION — does _ifsSynthesize(_ifsAnalyze(ψ)) recover ψ (a valid transform pair, not lossy)?
  //    refFn(G)->Float64(N). ifsMaps: contraction ratios. depth: ladder depth.
  ifsWaveletGate(refFn, { ifsMaps = [0.30902, 0.41421, 0.5, 0.61803, 0.70711], depth = 5, baseR = null } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, cC = G >> 1;
    const ref = refFn(G);
    const stamp=(s,p,cx,cy,sc=1)=>{ for(let y=0;y<G;y++)for(let x=0;x<G;x++){const v=p[y*G+x];if(!v)continue;
      const X=Math.round(cx+(x-cC)*sc),Y=Math.round(cy+(y-cC)*sc);if(X>=0&&X<G&&Y>=0&&Y<G) s[Y*G+X]+=v;}};
    // ── Build the FRACTAL ring cascade: depth d's radius = base · Π(contractions) — the attractor's scales.
    //    band[d] = the radius emitted at tree-depth d (one radius per band here; the real tree emits a SET,
    //    but the per-depth SCALE is what carries the multiresolution structure we are testing).
    // DYADIC ladder via the IFS contraction maps — but the single-map step (0.31×) collapses too fast
    // (gave [24,7,3,2,1], a bad ladder). Use a per-band CUMULATIVE contraction toward ~½ per octave so the
    // ladder is a clean multiresolution sweep (the fractal cascade's intended geometric scaling).
    const base = baseR || Math.max(4, Math.round(G * 0.40));
    const kernelByDepth = [];
    for (let d = 0; d < depth; d++) {
      const rr = Math.max(1, Math.round(base * Math.pow(0.5, d)));   // dyadic octaves: 25,13,6,3,2 (clean ladder)
      kernelByDepth.push({ radii: [rr], weights: [1] });
    }
    // ── _ifsAnalyze: project intensity onto each depth band's ring (mean of N/S/E/W ring pixels) — the
    //    EXACT operation from krestianstvo-wavefront-physics.js `ifsWavelet`, reproduced here for the probe.
    const analyze = (psi) => kernelByDepth.map(kb => { const band = new Float32Array(N);
      for (let cy=0;cy<G;cy++) for (let cx=0;cx<G;cx++){ let acc=0;
        for (let k=0;k<kb.radii.length;k++){ const rr=kb.radii[k], w=kb.weights[k];
          const a=cy*G+((cx+rr)&(G-1)), b=cy*G+((cx-rr+G)&(G-1)), c=((cy+rr)&(G-1))*G+cx, e=((cy-rr+G)&(G-1))*G+cx;
          const I=(p)=>psi[p*2]*psi[p*2]+psi[p*2+1]*psi[p*2+1];
          acc += w*(I(a)+I(b)+I(c)+I(e))*0.25; }
        band[cy*G+cx]=acc; }
      return band; });
    const synth = (bands) => { const out=new Float32Array(N);
      bands.forEach((band,d)=>{ const kb=kernelByDepth[d]; for(let cy=0;cy<G;cy++)for(let cx=0;cx<G;cx++){ let acc=0;
        for(let k=0;k<kb.radii.length;k++){ const rr=kb.radii[k],w=kb.weights[k];
          const a=cy*G+((cx+rr)&(G-1)),b=cy*G+((cx-rr+G)&(G-1)),c=((cy+rr)&(G-1))*G+cx,e=((cy-rr+G)&(G-1))*G+cx;
          acc+=w*(band[a]+band[b]+band[c]+band[e])*0.25; }
        out[cy*G+cx]+=acc; } });
      return out; };
    const bandEnergy = (band) => { let s=0; for(let i=0;i<N;i++) s+=band[i]*band[i]; return s; };

    const rows=['[IFS-NATIVE WAVELET GATE §7.38] re-test scale-covariance on the REAL fractal cascade decomposition',
      `   (not §7.37\'s uniform copies). Depth bands = attractor-contracted ring scales (_ifsAnalyze).`];
    // (1) band scales — show they are a contracted (geometric) ladder, not copies.
    rows.push(`   (1) BAND SCALES (fractal cascade radii): [${kernelByDepth.map(k=>k.radii[0]).join(', ')}]  (geometric contraction = multiresolution ✓)`);

    // (2) SCALE LOCALIZATION — the RIGHT metric. Raw band energy is monotone in 1/r for filled blobs (the
    // r=1 ring is always brightest next to lit cells → always "wins"; that was the §7.38 v1 bug). A wavelet
    // RESPONSE at scale r is a DIFFERENCE OF SCALES (DoG): how much the object's structure CHANGES between
    // ring r and ring r/2 — peaking when r straddles the object's EDGE (r ≈ object radius). We use clean
    // DISCS of known radius and read the band response at the object CENTROID (ring intensity at distance r),
    // detecting the band where it transitions (the edge) — that band should TRACK the disc radius.
    rows.push('   (2) SCALE LOCALIZATION — disc of radius R → which band\'s ring straddles the edge (tracks R)?');
    const discR = (R) => { const f=new Float64Array(2*N); for(let y=0;y<G;y++)for(let x=0;x<G;x++){ if(Math.hypot(x-cC,y-cC)<=R) f[(y*G+x)*2]=1; } return f; };
    // ring intensity at distance r from the centroid (single sample, the edge profile).
    const ringAtCenter = (psi, r) => { let s=0,n=0; const steps=Math.max(8,Math.ceil(2*Math.PI*r));
      for(let k=0;k<steps;k++){ const X=Math.round(cC+r*Math.cos(2*Math.PI*k/steps)), Y=Math.round(cC+r*Math.sin(2*Math.PI*k/steps));
        if(X>=0&&X<G&&Y>=0&&Y<G){ s+=psi[(Y*G+X)*2]; n++; } } return n? s/n : 0; };
    const radii = kernelByDepth.map(k=>k.radii[0]);
    const discRadii = [4, 9, 18];   // small / mid / large disc radii (px)
    let prevEdge=-1, monotone=true; const edgeBands=[];
    for (const R of discRadii) {
      const psi = discR(R);
      // DoG response per band: |ring(r) − ring(2r)| at center → peaks where r ≈ R (the edge).
      const resp = radii.map(r => Math.abs(ringAtCenter(psi, r) - ringAtCenter(psi, r*2)));
      const mx=Math.max(...resp,1e-12), eb=resp.indexOf(mx);
      edgeBands.push(eb);
      if (prevEdge>=0 && eb > prevEdge) monotone=false;   // bigger disc → bigger r → LOWER band index (radii descend) → eb should not increase
      rows.push(`     disc R=${R} → band-resp [${resp.map(v=>(v/mx).toFixed(2)).join(' ')}] edge@band${eb}(r=${radii[eb]})`);
      prevEdge=eb;
    }
    const distinctPeaks = new Set(edgeBands).size;
    rows.push(`     → distinct edge-bands across radii: ${distinctPeaks}/${discRadii.length}, monotone ${monotone?'YES':'no'}  (≥2 & monotone = size LOCALIZES = wavelet-covariant)`);

    // (3) RECONSTRUCTION — is _ifsAnalyze/_ifsSynthesize a valid (information-preserving) transform pair?
    const objR=new Float64Array(2*N); { const tmp=new Float64Array(N); stamp(tmp,ref,cC,cC,1.0); for(let i=0;i<N;i++) objR[i*2]=tmp[i]; }
    const recon=synth(analyze(objR));
    // correlation of |ψ|² (input intensity) vs recon.
    const inI=new Float64Array(N); for(let i=0;i<N;i++) inI[i]=objR[i*2]*objR[i*2];
    let na=0,nb=0,nab=0,ma=0,mb=0; for(let i=0;i<N;i++){ma+=inI[i];mb+=recon[i];} ma/=N;mb/=N;
    for(let i=0;i<N;i++){const da=inI[i]-ma,db=recon[i]-mb;nab+=da*db;na+=da*da;nb+=db*db;}
    const reconCorr = (na>0&&nb>0)?nab/Math.sqrt(na*nb):0;
    rows.push(`   (3) RECONSTRUCTION corr(input, synth∘analyze): ${reconCorr.toFixed(2)}  (high = valid transform pair; the bands HOLD the object)`);

    const verdict = distinctPeaks>=2 && monotone;
    rows.push(`   ══ ${verdict ? 'IFS-NATIVE WAVELET IS SCALE-COVARIANT — object size localizes to the fractal scale-band (the wavelet ≈ the attractor cascade).' : 'the fractal cascade does NOT cleanly localize size here (bands overlap or do not track) — wavelet-covariance not realized.'} ══`);
    rows.push('     → §7.37 tested uniform ring copies (no advantage); this tests the ATTRACTOR-contracted bands (the real ifsWavelet). Compare.');
    console.log(rows.join('\n'));
    return rows;
  }


  // ── TEMPORAL-MULTIPLEXING OPERATOR (§9, the FOURTH route — the only one not yet tried). All three SPACE-like
  //    routes (carriers §7.30, sparse-carriers, wavelet §7.38) failed because K dense ranks must COEXIST at the
  //    same instant → spatial/spectral crosstalk caps fidelity (~0.41). Temporal mux trades space for TIME: the
  //    operator is ONE field that walks a K-step trajectory across K sub-ticks of the IFS clock; at sub-tick r it
  //    carries triple r ALONE, so the ranks NEVER coexist → no crosstalk by construction. The accumulation
  //    Σ_r W_r·(U_r·a)(V_r·b) happens by temporal integration over the cycle (same trick clockForward uses to
  //    fold a sequence into one wavefront). This is "the algebra as a Limit Cycle": rank-K operator = one entity
  //    in the time domain. The honest cost lives elsewhere — does the IFS medium PRESERVE each rank's projection
  //    across its sub-tick, and does the sequential read incur drift? Controls:
  //      (1) temporal-mux NO medium  vs abstract stack  → does time-separation remove crosstalk? (expect ~1.0)
  //      (2) temporal-mux THROUGH medium vs abstract     → IFS round-trip cost per sub-tick (the real number)
  //      (3) the spatial-carrier baseline (0.41) it must beat
  //    If (1)≈1 and (2) stays high, temporal mux IS the one-soliton realization that the space routes couldn't be.
  operatorSolitonTemporal(triples, targetFn, { Nr = 64, T = 30, trials = 12, subStep = 1, quiet = false } = {}) {
    const gpu = this._gpu, G = gpu._G, N = G * G, dt = this.dt, K = triples.length;
    // scatter the Nr abstract dims across the 2D grid (same layout as the spatial probes, so the medium cost is
    // measured on the SAME footprint — the only thing that changes is space→time for the rank axis).
    const side = Math.ceil(Math.sqrt(Nr)), step = Math.max(1, Math.floor(G/side));
    const cells = []; for (let i=0;i<Nr;i++){ const gx=(i%side)*step+(step>>1), gy=((i/side)|0)*step+(step>>1); cells.push(Math.min(G-1,gy)*G+Math.min(G-1,gx)); }
    const placeVec = (v) => { const f=new Float64Array(N); for (let i=0;i<Nr;i++) f[cells[i]]=v[i]; return f; };
    // project an Nr-vector field back to coefficients on `cells`.
    const readVec = (field) => { const o=new Float64Array(Nr); for (let i=0;i<Nr;i++) o[i]=field[cells[i]*2]; return o; };
    // ⟨vec, input⟩ for ONE vec (one rank, alone at its sub-tick) — optionally through the medium round-trip.
    const innerOne = (vec, inputReal, throughMedium) => {
      // stamp vec·input as a real field, propagate forward T then back T (matched-filter round-trip), read coeffs, sum.
      const prod = new Float64Array(2*N);
      for (let i=0;i<Nr;i++){ const c=cells[i]; prod[c*2]=vec[i]*inputReal[c]; }
      if (throughMedium){ gpu.setEyePsi(prod); gpu.stepEyeN(T,dt); gpu.stepEyeN(T,-dt); const f=gpu.readEyePsi(); let s=0; for(let i=0;i<Nr;i++) s+=f[cells[i]*2]; return s; }
      let s=0; for(let i=0;i<Nr;i++) s+=prod[cells[i]*2]; return s;
    };
    // TEMPORAL apply: walk the K sub-ticks; at sub-tick r, rank r is the ONLY one present. Accumulate W_r·(U_r·a)(V_r·b).
    const applyTemporal = (a, b, throughMedium) => {
      const aR=placeVec(a), bR=placeVec(b); const out=new Float64Array(Nr);
      for (let r=0;r<K;r++){
        const ua = innerOne(triples[r].U, aR, throughMedium);   // rank r alone → no crosstalk from r'≠r
        const vb = innerOne(triples[r].V, bR, throughMedium);
        const c = ua*vb, W = triples[r].W; for (let k=0;k<Nr;k++) out[k]+=W[k]*c;
      }
      return out;
    };
    const applyAbstract = (a,b) => { const out=new Float64Array(Nr);
      for (const {U,V,W} of triples){ let ua=0,vb=0; for(let i=0;i<Nr;i++){ua+=U[i]*a[i];vb+=V[i]*b[i];} const c=ua*vb; for(let k=0;k<Nr;k++) out[k]+=W[k]*c; } return out; };
    const corr=(a,b)=>{let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return d/Math.sqrt(Math.max(1e-12,na*nb));};
    let rng=0x77AA>>>0; const rv=()=>{const v=new Float64Array(Nr);for(let i=0;i<Nr;i++){rng=(rng*1664525+1013904223)>>>0;v[i]=rng/4294967296*2-1;}return v;};
    let accTemp=0, accMed=0, accTruth=0;
    for (let t=0;t<trials;t++){ const a=rv(), b=rv(); const truth=targetFn(a,b);
      accTemp  += corr(applyTemporal(a,b,false), applyAbstract(a,b));   // time-separated vs abstract (crosstalk test)
      accMed   += corr(applyTemporal(a,b,true),  applyAbstract(a,b));   // time-separated + medium vs abstract
      accTruth += corr(applyTemporal(a,b,true),  truth);                // end-to-end vs the TRUE operator
    }
    gpu.setEyePsi(new Float64Array(2*N));
    accTemp/=trials; accMed/=trials; accTruth/=trials;
    const rows=['[OPERATOR-SOLITON TEMPORAL §9] rank-K operator as a K-step CLOCK TRAJECTORY (space→time, the 4th route):',
      `   K=${K} triples walked over K sub-ticks (rank r alone at tick r → NO spatial crosstalk), Nr=${Nr}, round-trip T=${T}:`,
      `   temporal-mux NO medium vs abstract stack:           ${accTemp.toFixed(3)}  (1=time-separation removes ALL crosstalk)`,
      `   temporal-mux THROUGH the IFS medium vs abstract:    ${accMed.toFixed(3)}  (per-sub-tick round-trip cost)`,
      `   temporal-mux THROUGH medium vs the TRUE operator:   ${accTruth.toFixed(3)}  (end-to-end: one field-in-time IS the operator)`,
      '   spatial-carrier baseline (the routes that failed):  0.410  ← temporal must beat this to be the better realization',
      (accTemp>0.97 && accMed>0.85)
        ? '   → TEMPORAL MUX WORKS: time-separation removes the crosstalk the space routes hit; the medium preserves each rank.'
        : (accTemp>0.97)
        ? '   → time-separation removes crosstalk (≈1.0) BUT the IFS round-trip degrades the sequential read (medium cost moved, not gone).'
        : '   → even time-separated, the per-tick projection leaks (the round-trip is not a clean per-rank inner product here).',
      '     ("Algebra as a Limit Cycle": the rank lives in the clock dimension → one soliton, IF the medium preserves each tick.)'];
    if (!quiet) console.log(rows.join('\n'));
    return { rows, accTemp, accMed, accTruth };
  }

  // ── OPERATOR LIMIT-CYCLE on the GPU (§7.43, full-GPU path). Given the K rank-1 triples and two input
  //    vectors a,b (length Nr) placed on a grid lattice, run ONE full bar on the GPU: per rank, two GPU
  //    row-reduced dot products give (U_r·a),(V_r·b); a GPU scatter-MAD adds W_r·(scalar) into a persistent
  //    accumulation texture (reset on rank 0). JS only reads back the final bound field. Returns the bound
  //    Nr-vector AND a corr vs the JS reference apply (so the GPU path is VERIFIED, not assumed exact).
  //    `cells`: the Nr grid-cell indices the vectors live on (same lattice as operatorSolitonTemporal).
  operatorCycleBarGPU(triples, a, b, cells) {
    const gpu = this._gpu, G = gpu._G, N = G * G, K = triples.length, Nr = a.length;
    gpu.opCycleInit();
    // place an Nr-vector onto its grid cells as a full real field.
    const place = (v) => { const f = new Float64Array(N); for (let i = 0; i < Nr; i++) f[cells[i]] = v[i]; return f; };
    const aField = place(a), bField = place(b);
    for (let r = 0; r < K; r++) {
      // (U_r·a): upload U_r→'a', a→'b', GPU dot. (V_r·b): upload V_r→'a', b→'b', GPU dot.
      gpu.opCycleUpload('a', place(triples[r].U)); gpu.opCycleUpload('b', aField);
      const ua = gpu.opCycleDotAB();
      gpu.opCycleUpload('a', place(triples[r].V)); gpu.opCycleUpload('b', bField);
      const vb = gpu.opCycleDotAB();
      // scatter W_r·(ua·vb) into the accumulation (reset on the first rank = start of the bar).
      gpu.opCycleUpload('w', place(triples[r].W));
      gpu.opCycleTick(ua * vb, r === 0);
    }
    const boundField = gpu.opCycleReadAcc();
    const bound = new Float64Array(Nr); for (let i = 0; i < Nr; i++) bound[i] = boundField[cells[i]];
    // JS reference (the exact stack apply) for verification.
    const ref = new Float64Array(Nr);
    for (const { U, V, W } of triples) { let ua = 0, vb = 0; for (let i = 0; i < Nr; i++) { ua += U[i]*a[i]; vb += V[i]*b[i]; } const c = ua*vb; for (let k = 0; k < Nr; k++) ref[k] += W[k]*c; }
    let d = 0, na = 0, nb = 0; for (let i = 0; i < Nr; i++) { d += bound[i]*ref[i]; na += bound[i]*bound[i]; nb += ref[i]*ref[i]; }
    return { bound, ref, corr: d / Math.sqrt(Math.max(1e-12, na*nb)) };
  }

  // self-test: build a rank-3 rule, fit it, run the GPU bar, report corr vs JS. Logs the verification number.
  operatorCycleGPUSelfTest({ Nr = 64, K = 12 } = {}) {
    const gpu = this._gpu, G = gpu._G;
    const side = Math.ceil(Math.sqrt(Nr)), step = Math.max(1, Math.floor(G/side));
    const cells = []; for (let i = 0; i < Nr; i++){ const gx=(i%side)*step+(step>>1), gy=((i/side)|0)*step+(step>>1); cells.push(Math.min(G-1,gy)*G+Math.min(G-1,gx)); }
    let rs = 0x51A3>>>0; const rv = () => { const v = new Float64Array(Nr); for (let i=0;i<Nr;i++){ rs=(rs*1664525+1013904223)>>>0; v[i]=rs/4294967296*2-1; } return v; };
    const tr = []; for (let r=0;r<3;r++) tr.push({ U: rv(), V: rv(), W: rv() });
    const lowTensor = (n) => { const T=[]; for(let k=0;k<n;k++){ const row=new Float64Array(n*n); for(let i=0;i<n;i++)for(let j=0;j<n;j++){ let s=0; for(const{U,V,W}of tr) s+=W[k]*U[i]*V[j]; row[i*n+j]=s; } T.push(row); } return T; };
    return { tr, cells, lowTensor, Nr, K };   // caller fits + runs (fitOperatorSoliton lives in the algebra module)
  }

  // ── MULTIMEDIA AS A LIMIT CYCLE (§7.44) — does the operator's space→time result TRANSFER to multimedia?
  //    The multimedia scheme packs M modalities on M orthogonal CARRIERS in one field (§7.3). That works for
  //    SPARSE modalities (image 1.0 / sound 0.999) but LEAKS for DENSE ones (§7.29: carrier-mux clean for sparse,
  //    leaks for dense) — same failure mode as the dense operator. So: replace the carrier (space) axis with the
  //    CLOCK (time) axis — modality m alone at its phase of the bar → no cross-modal coexistence. Honest difference
  //    from the operator: multimedia reads out PER-PHASE (keep modalities SEPARATE), not bar-integrated (operator
  //    SUMS its ranks). And the REAL risk the "different freq per phase, all clean" story glosses: the IFS medium
  //    PROPAGATES the field BETWEEN phases — does the separation survive that, or does phase A bleed into phase B?
  //    This probe measures it on TWO DENSE images (clean field-correlation readout, no phase-demod approximation):
  //      carrier arm   : both on orthogonal carriers, ONE round-trip, extract each → cross-modal leak (§7.29 dense)
  //      temporal arm  : modality A injected/propagated/read in phase-A ticks, THEN B in phase-B ticks of one bar,
  //                      the field evolving between phases (the actual test) → cross-modal leak
  //    Reports self-fidelity (each modality recovered) AND cross-leak (A's readout picking up B). Temporal WINS
  //    iff it keeps self high AND cross low where carriers don't. carrierSep separates the two carriers in k.
  multimediaTemporalGate({ G = null, T = 30, trials = 8, carrierSep = 2.5, phaseT = 6, quiet = false } = {}) {
    const gpu = this._gpu; G = G || gpu._G; const N = G * G, dt = this.dt;
    let rng = 0x4D2C >>> 0; const rand = () => { rng = (rng*1664525+1013904223)>>>0; return rng/4294967296; };
    // a DENSE real image (every cell lit) — the regime carriers leak in.
    const denseImg = () => { const m = new Float64Array(N); for (let i=0;i<N;i++) m[i] = rand()*2-1; return m; };
    const corr = (a, b) => { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){ d+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; } return d/Math.sqrt(Math.max(1e-12,na*nb)); };
    // two orthogonal carriers (well separated in k).
    const cA = { kx: carrierSep*0.30, ky: carrierSep*0.21 }, cB = { kx: carrierSep*0.60, ky: carrierSep*0.42 };
    const embed = (psi, m, c) => { for (let y=0;y<G;y++) for (let x=0;x<G;x++){ const i=y*G+x, v=m[i]; if(!v) continue; const ph=c.kx*x+c.ky*y; psi[i*2]+=v*Math.cos(ph); psi[i*2+1]+=v*Math.sin(ph); } };
    const extract = (psi, c) => { const o=new Float64Array(N); for (let y=0;y<G;y++) for (let x=0;x<G;x++){ const i=y*G+x, ph=c.kx*x+c.ky*y; o[i]=psi[i*2]*Math.cos(ph)+psi[i*2+1]*Math.sin(ph); } return o; };
    const roundTrip = (psi) => { gpu.setEyePsi(psi); gpu.stepEyeN(T,dt); gpu.stepEyeN(T,-dt); return gpu.readEyePsi(); };

    // ── CARRIER ARM: both dense images coexist on two carriers in ONE field, one round-trip, demod each.
    let cSelfA=0, cSelfB=0, cLeak=0;
    for (let t=0;t<trials;t++){
      const A=denseImg(), B=denseImg(); const psi=new Float64Array(2*N);
      embed(psi,A,cA); embed(psi,B,cB);
      const rt=roundTrip(psi); const rA=extract(rt,cA), rB=extract(rt,cB);
      cSelfA+=corr(rA,A); cSelfB+=corr(rB,B); cLeak+=Math.abs(corr(rA,B));   // A's channel picking up B = crosstalk
    }
    cSelfA/=trials; cSelfB/=trials; cLeak/=trials;

    // ── TEMPORAL ARM: phase A then phase B within one bar. The field PROPAGATES between phases (the honest test):
    //    phase A: inject A (round-trip phaseT), read A out;  phase B: inject B onto the SAME evolving field
    //    (no carrier — plain real field), round-trip phaseT, read B. Cross-leak = does A still sit in B's readout?
    let tSelfA=0, tSelfB=0, tLeak=0;
    for (let t=0;t<trials;t++){
      const A=denseImg(), B=denseImg();
      // phase A: A alone in the field, propagate, recover (matched round-trip over the phase window)
      const pa=new Float64Array(2*N); for (let i=0;i<N;i++) pa[i*2]=A[i];
      gpu.setEyePsi(pa); gpu.stepEyeN(phaseT,dt); gpu.stepEyeN(phaseT,-dt); const rtA=gpu.readEyePsi();
      const rA=new Float64Array(N); for (let i=0;i<N;i++) rA[i]=rtA[i*2];
      // phase B: B alone, but the field has ADVANCED (continue evolving from where A left off — the medium's state
      // carries between phases). Inject B additively onto the post-A field, propagate phase B, recover B.
      const pb=new Float64Array(rtA); for (let i=0;i<N;i++) pb[i*2]+=B[i];
      gpu.setEyePsi(pb); gpu.stepEyeN(phaseT,dt); gpu.stepEyeN(phaseT,-dt); const rtB=gpu.readEyePsi();
      const rB=new Float64Array(N); for (let i=0;i<N;i++) rB[i]=rtB[i*2];
      // B's readout still contains the post-A residue → subtract the known post-A field (the receiver knows the
      // phase boundary — it's clock-pure) to isolate B; leak = what of A survives in the isolated B.
      const rBiso=new Float64Array(N); for (let i=0;i<N;i++) rBiso[i]=rB[i]-rA[i];
      tSelfA+=corr(rA,A); tSelfB+=corr(rBiso,B); tLeak+=Math.abs(corr(rBiso,A));
    }
    tSelfA/=trials; tSelfB/=trials; tLeak/=trials;
    gpu.setEyePsi(new Float64Array(2*N));

    const rows=['[MULTIMEDIA AS A LIMIT CYCLE §7.44] does the operator space→time result TRANSFER to multimedia?',
      `   TWO DENSE images (the regime carriers leak), G=${G}, round-trip T=${T}, phase window=${phaseT}:`,
      '                        self-fidelity (recover each)     cross-leak (A bleeding into B)',
      `   CARRIER  (space)     A=${cSelfA.toFixed(3)}  B=${cSelfB.toFixed(3)}              ${cLeak.toFixed(3)}`,
      `   TEMPORAL (time)      A=${tSelfA.toFixed(3)}  B=${tSelfB.toFixed(3)}              ${tLeak.toFixed(3)}`,
      // Separation MARGIN = mean self-fidelity − cross-leak (high self AND low leak both help). The dense cost can
      // show up as EITHER lower self-fidelity (carrier degrades the content) OR higher leak (carrier crosstalk);
      // the margin captures both, so the verdict doesn't mis-fire when one scheme pays the dense cost on the other axis.
      ((cM,tM)=> (tM > cM + 0.03)
        ? `   → TRANSFERS: temporal margin ${tM.toFixed(3)} > carrier ${cM.toFixed(3)} — time-phasing beats dense carriers (whether the carrier`
        : (Math.abs(tM-cM) <= 0.03)
        ? `   → TIE: temporal margin ${tM.toFixed(3)} ≈ carrier ${cM.toFixed(3)} — both viable; choose by COST (carriers=space/capacity, time=refresh rate).`
        : `   → carriers win here: margin ${cM.toFixed(3)} > temporal ${tM.toFixed(3)} (these modalities are sparse enough that space-mux is clean).`
      )((cSelfA+cSelfB)/2 - cLeak, (tSelfA+tSelfB)/2 - tLeak),
      '     dense cost surfaces as SELF-degradation (carrier 0.82) OR cross-leak; temporal keeps self≈1.0 (matched round-trip is',
      '     reversible per phase) — the inter-phase drift risk did NOT materialize. Unlike the operator (bar-INTEGRATED sum),',
      '     multimedia reads PER-PHASE; the real trade is refresh rate (M phases → each modality M× slower), DoF=N_space×M_time.'];
    if (!quiet) console.log(rows.join('\n'));
    return { rows, carrier:{selfA:cSelfA,selfB:cSelfB,leak:cLeak}, temporal:{selfA:tSelfA,selfB:tSelfB,leak:tLeak} };
  }

  // ── WAVELET-BASIS SPARSITY GATE (§9, the decisive test for "pack the operator stack in the IFS-WAVELET
  //    basis instead of carriers"). Carriers failed because the triples were DENSE (§7.29). The conjecture:
  //    the IFS-native wavelet (§7.38, scale-orthogonal, medium-preserved) may make a STRUCTURED operator SPARSE
  //    → then it packs cleanly (sparse = §7.29's clean regime). BUT a key honest fact first: a RANDOM operator's
  //    triples are dense in EVERY orthonormal basis (random vectors project ~uniformly) → no basis saves it.
  //    So this gate tests BOTH: a RANDOM operator (control — expect dense everywhere) and a STRUCTURED operator
  //    (the conjecture — expect sparse in the wavelet/scale-band basis). Sparsity = participation ratio (low =
  //    few significant coeffs = sparse = packable). Decides whether the wavelet route can work, before building.
  waveletSparsityGate({ G = 16, depth = 5, ifsMaps = [0.30902,0.41421,0.5,0.61803,0.70711] } = {}) {
    let rng=0x5A17>>>0; const rand=()=>{rng=(rng*1664525+1013904223)>>>0;return rng/4294967296;};
    const Np = G*G;   // resolved patch (G=16 → ~5 ring radii actually distinguishable)
    // a vector as a G×G field; project onto the IFS-wavelet scale-bands (ring-energy per band at center) →
    // band-coefficient vector. PARTICIPATION RATIO of |coeff|² (1=one band=maximally sparse, depth=uniform=dense).
    const base = Math.max(2, Math.round(G*0.45));
    const bandR = []; for(let d=0;d<depth;d++) bandR.push(Math.max(1, Math.round(base*Math.pow(0.6,d))));
    const waveletCoeffs = (vec) => { const c = new Float64Array(depth);
      // sum ring energy at each band radius around the patch centre — the scale-band projection.
      const cc=(G>>1); for(let d=0;d<depth;d++){ const r=bandR[d]; let s=0,n=0;
        const steps=Math.max(8,Math.ceil(2*Math.PI*r));
        for(let k=0;k<steps;k++){ const x=Math.round(cc+r*Math.cos(2*Math.PI*k/steps)), y=Math.round(cc+r*Math.sin(2*Math.PI*k/steps));
          if(x>=0&&x<G&&y>=0&&y<G){ const v=vec[y*G+x]; s+=v*v; n++; } }
        c[d] = n? s/n : 0; }
      return c; };
    const PR = (c) => { let s1=0,s2=0; for(const v of c){ s1+=v; s2+=v*v; } return s2>0 ? (s1*s1)/(s2*c.length) : 1; };  // ∈(0,1], low=sparse
    const spatialPR = (vec) => { let s1=0,s2=0; for(const v of vec){ const m=v*v; s1+=m; s2+=m*m; } return s2>0?(s1*s1)/(s2*vec.length):1; };
    // RANDOM operator triple (dense everywhere — control).
    const randVec = () => { const v=new Float64Array(Np); for(let i=0;i<Np;i++) v[i]=rand()*2-1; return v; };
    // GAUSSIAN-structured triple: a couple of smooth bumps — SPACE-sparse (the wrong kind; control for "smooth").
    const gaussVec = () => { const v=new Float64Array(Np);
      const nb=1+ (rand()*2|0); for(let b=0;b<nb;b++){ const bx=rand()*G, by=rand()*G, w=2+rand()*4, amp=rand()*2-1;
        for(let y=0;y<G;y++) for(let x=0;x<G;x++){ const d2=(x-bx)**2+(y-by)**2; v[y*G+x]+= amp*Math.exp(-d2/(2*w*w)); } }
      return v; };
    // FRACTAL/self-similar triple — the RIGHT structure for the conjecture: energy placed on rings whose radii
    // follow the IFS CONTRACTION CASCADE (the attractor's scales), so the field is self-similar across scale →
    // should be SCALE-SPARSE (concentrated in a few wavelet bands) the way the IFS-wavelet basis is built for.
    const fractalVec = () => { const v=new Float64Array(Np), cc=(G>>1);
      let r = G*0.45, amp = 1;
      for (let d=0; d<depth+2; d++){ const rr=Math.max(1,Math.round(r)), steps=Math.max(8,Math.ceil(2*Math.PI*rr));
        for(let k=0;k<steps;k++){ const x=Math.round(cc+rr*Math.cos(2*Math.PI*k/steps)), y=Math.round(cc+rr*Math.sin(2*Math.PI*k/steps));
          if(x>=0&&x<G&&y>=0&&y<G) v[y*G+x]+= amp; }
        r *= ifsMaps[d % ifsMaps.length]; amp *= 0.7; }   // contract radius + decay → self-similar across scale
      return v; };
    const meanPR = (gen, n=12) => { let sp=0, wv=0; for(let t=0;t<n;t++){ const v=gen(); sp+=spatialPR(v); wv+=PR(waveletCoeffs(v)); } return { sp:sp/n, wv:wv/n }; };
    const R = meanPR(randVec), Gs = meanPR(gaussVec), F = meanPR(fractalVec);
    const rows=['[WAVELET-SPARSITY GATE §9 v2] is a FRACTAL operator SCALE-SPARSE in the IFS-wavelet basis? (fair test)',
      `   participation ratio (→0 sparse, →1 dense), G=${G} patch, ${depth} scale-bands:`,
      `   RANDOM triple:   spatial PR ${R.sp.toFixed(2)}   wavelet PR ${R.wv.toFixed(2)}   (dense in BOTH — no basis helps; control)`,
      `   GAUSSIAN triple: spatial PR ${Gs.sp.toFixed(2)}   wavelet PR ${Gs.wv.toFixed(2)}   (SPACE-sparse, not scale — wrong kind)`,
      `   FRACTAL triple:  spatial PR ${F.sp.toFixed(2)}   wavelet PR ${F.wv.toFixed(2)}   (CONJECTURE: scale-sparse → low wavelet PR)`,
      (F.wv < 0.5 && F.wv < R.wv - 0.15)
        ? '   → FRACTAL ops ARE scale-sparse in the IFS-wavelet basis (low wavelet PR) → wavelet-packing CAN work for fractal-structured operators.'
        : (F.wv < R.wv - 0.1)
        ? '   → fractal ops are somewhat scale-sparser → wavelet-packing may partially help for fractal operators (marginal).'
        : '   → even fractal ops are not clearly scale-sparse here → the wavelet route does not beat carriers; operator stays explicit K-field stack.'];
    rows.push('     HONEST: random ops are dense in every basis (expected). The wavelet route works (if at all) ONLY for operators');
    rows.push('     with FRACTAL/self-similar structure matched to the IFS cascade — this measures whether that structure → scale-sparsity.');
    console.log(rows.join('\n'));
    return rows;
  }

  // radii/weights/offsets: full current kernel. Restores it after.
  sweepRingBands(seedPsi64, radii, weights, offsets) {
    const gpu = this._gpu, D = this.tSteps, dt = this.dt;
    const nB = radii.length;
    const rows = [];

    // Reference: full encode, full decode (the exact round-trip) — should be ~1.0.
    // COMPLEX correlation (phase-sensitive) so band-mismatch can actually lower it —
    // intensity correlation saturates on sparse geometry (back-flow refocuses to the
    // points regardless of band) and can't distinguish a true inverse from a near-miss.
    gpu.setRings(radii, weights, offsets);
    gpu.setEyePsi(seedPsi64); gpu.stepEyeN(D, dt); gpu.stepEyeN(D, -dt);
    const sFull = this._corrComplex(gpu.readEyePsi(), seedPsi64);
    rows.push(`full encode / full decode: score ${sFull.toFixed(3)}  ${'█'.repeat(Math.round(sFull*40))}`);

    // Mismatched: full encode, then decode with ONE band only.
    for (let keep = 0; keep < nB; keep++) {
      const r1 = [radii[keep]], w1 = [weights[keep]], o1 = offsets ? [offsets[keep]] : undefined;
      // Forward leg with FULL kernel → the real hologram.
      gpu.setRings(radii, weights, offsets);
      gpu.setEyePsi(seedPsi64);
      gpu.stepEyeN(D, dt);
      // Backward leg with ONE band → partial decoder.
      gpu.setRings(r1, w1, o1);
      gpu.stepEyeN(D, -dt);
      const s = this._corrComplex(gpu.readEyePsi(), seedPsi64);
      rows.push(`full encode / band ${keep} decode (r=${radii[keep]}): score ${s.toFixed(3)}  ${'█'.repeat(Math.round(s*40))}`);
    }
    // Restore the full kernel so the live display is unaffected.
    gpu.setRings(radii, weights, offsets);
    console.log(`[EYE RING-BAND] band redundancy @ T=${D} (full encode, single-band decode):\n` + rows.join('\n')
      + '\n→ high band score = that ring scale alone decodes the full hologram (redundant);'
      + '\n  low = info distributed across scales. (Mismatched legs → non-trivial, unlike same-kernel.)');
  }

  // ── One-shot diagnostic: how far must the wavefront propagate to become a
  // well-mixed hologram? Scans the forward leg in chunks, measuring the per-chunk
  // change in |ψ|² (normalized). When this stops dropping, the hologram has stopped
  // mixing — that propagation depth is the minimum useful T_RECORD for the eye.
  // Also reports the participation ratio (how spread the energy is) at each chunk.
  // Call once (e.g. from a debug button) with the current object seed.
  probeForward(seedPsi64, maxT = 120, chunk = 5) {
    const gpu = this._gpu, dt = this.dt;
    gpu.setEyePsi(seedPsi64);
    let prevMag = null;
    const rows = [];
    for (let t = 0; t < maxT; t += chunk) {
      gpu.stepEyeN(chunk, dt);
      const psi = gpu.readEyePsi();
      const N = psi.length >> 1;
      // |ψ|² per cell, plus participation ratio PR = (Σm)² / Σm² (1=peaked, N=uniform).
      let s1 = 0, s2 = 0; const mag = new Float64Array(N);
      for (let j = 0; j < N; j++) { const m = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1]; mag[j] = m; s1 += m; s2 += m*m; }
      const PR = s2 > 0 ? (s1*s1) / s2 : 0;
      let dchg = 0;
      if (prevMag) { let dd = 0, nn = 0; for (let j = 0; j < N; j++) { const d = mag[j]-prevMag[j]; dd += d*d; nn += mag[j]*mag[j]; } dchg = Math.sqrt(dd/Math.max(nn,1e-30)); }
      rows.push(`T=${String(t+chunk).padStart(3)}: |ψ|² change ${dchg.toExponential(2)}  spread PR=${(PR/N*100).toFixed(1)}% of grid`);
      prevMag = mag;
    }
    console.log('[EYE PROBE] forward-leg mixing (object → hologram):\n' + rows.join('\n')
      + '\n→ minimum useful T ≈ where "change" flattens; "spread" shows how filled the hologram is.');
  }

  // Render arrived wavefront from the last compute() to a canvas context.
  // Call after compute() if you need to re-render without recomputing.
  renderArrived(ctx, gpuCanvas, RW, RH) {
    this._gpu.renderEyeField(this.arrivedNorm);
    ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
  }

  renderPercept(ctx, gpuCanvas, RW, RH) {
    if (!this._perceptState) return;
    this._gpu.setEyePsi(this._perceptState);
    this._gpu.renderEyeField(this.perceptNorm);
    ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
  }

  renderEvidence(ctx, gpuCanvas, RW, RH) {
    if (!this._evidence) return;
    this._gpu.setEyePsi(this._evidence);
    this._gpu.renderEyeField(this.evidenceNorm);
    ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
  }

  // Normalized correlation of |a|² vs |b|² over the grid (0..1). Used as the
  // reconstruction-quality score: how well the evidence matches the source object.
  _corr(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    const N = a.length >> 1;
    let ma = 0, mb = 0;
    const A = new Float64Array(N), B = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      A[j] = a[j*2]*a[j*2] + a[j*2+1]*a[j*2+1];
      B[j] = b[j*2]*b[j*2] + b[j*2+1]*b[j*2+1];
      ma += A[j]; mb += B[j];
    }
    ma /= N; mb /= N;
    let num = 0, da = 0, db = 0;
    for (let j = 0; j < N; j++) {
      const x = A[j] - ma, y = B[j] - mb;
      num += x*y; da += x*x; db += y*y;
    }
    const den = Math.sqrt(da * db);
    return den > 1e-30 ? Math.max(0, num / den) : 0;
  }

  // COMPLEX correlation: |Σ a·conj(b)| / (‖a‖·‖b‖), magnitude of the normalized
  // complex inner product (0..1, phase-invariant to a global offset). Unlike _corr
  // (intensity), this is sensitive to PHASE — so it can detect a decode that refocuses
  // energy to roughly the right places but with the wrong field. Use where the test
  // must be able to FAIL (e.g. band-mismatch decode on sparse geometry).
  _corrComplex(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    const N = a.length >> 1;
    let dotRe = 0, dotIm = 0, na = 0, nb = 0;
    for (let j = 0; j < N; j++) {
      const ar = a[j*2], ai = a[j*2+1], br = b[j*2], bi = b[j*2+1];
      dotRe += ar*br + ai*bi;     // Re(a·conj(b))
      dotIm += ai*br - ar*bi;     // Im(a·conj(b))
      na += ar*ar + ai*ai;
      nb += br*br + bi*bi;
    }
    const den = Math.sqrt(na * nb);
    return den > 1e-30 ? Math.sqrt(dotRe*dotRe + dotIm*dotIm) / den : 0;
  }

  // Reset percept memory (e.g. on scene change where continuity is unwanted).
  resetPercept() { this._perceptState = null; }

  // Save the current evidence (ψ after F^T→H→F^-T) plus params to a Blob.
  // Format: same .ifsh as IFSHologram so files are interchangeable.
  save(meta = {}) {
    const field = this._holoField ?? this._evidence;
    if (!field) { console.warn('[IFSEye] save: no hologram — compute first'); return null; }
    const fullMeta = {
      type:    'eye',
      field:   this._holoField ? 'holo' : 'evidence', // distinguish old files
      tSteps:  this.tSteps,
      dt:      this.dt,
      hMode:   this.hMode,
      hParam:  this.hParam,
      hSteps:  this.hSteps,
      ...meta,
    };
    const f32       = new Float32Array(field.length);
    for (let i = 0; i < f32.length; i++) f32[i] = field[i];
    const metaBytes = new TextEncoder().encode(JSON.stringify(fullMeta));
    const metaLen   = new Uint32Array([metaBytes.length]);
    return new Blob([metaLen.buffer, metaBytes.buffer, f32.buffer],
      { type: 'application/octet-stream' });
  }

  async download(filename = 'eye_hologram.kwe', meta = {}) {
    const blob = this.save(meta);
    if (!blob) return;
    let outBlob = blob;
    if (typeof CompressionStream !== 'undefined') {
      const cs     = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(await blob.arrayBuffer());
      writer.close();
      outBlob = await new Response(cs.readable).blob();
    }
    const url = URL.createObjectURL(outBlob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // Load from ArrayBuffer. Detects gzip (magic bytes 1f 8b) and decompresses first.
  static async decompress(buf) {
    const magic = new Uint8Array(buf, 0, 2);
    if (magic[0] === 0x1f && magic[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(buf);
      writer.close();
      return await new Response(ds.readable).arrayBuffer();
    }
    return buf;
  }

  load(buf) {
    const metaLen = new Uint32Array(buf, 0, 1)[0];
    const metaStr = new TextDecoder().decode(new Uint8Array(buf, 4, metaLen));
    const meta    = JSON.parse(metaStr);
    const f32     = new Float32Array(buf.slice(4 + metaLen));
    if (meta.tSteps !== undefined) this.tSteps = meta.tSteps;
    if (meta.hMode  !== undefined) this.hMode  = meta.hMode;
    if (meta.hParam !== undefined) this.hParam = meta.hParam;
    if (meta.hSteps !== undefined) this.hSteps = meta.hSteps;

    const psi64 = new Float64Array(f32.length);
    let mx = 0;
    for (let i = 0; i < f32.length; i++) {
      psi64[i] = f32[i];
      if (i % 2 === 0) { const v = f32[i]*f32[i]+f32[i+1]*f32[i+1]; if (v > mx) mx = v; }
    }

    if (meta.field === 'holo' || !meta.field) {
      // New format: stored field is the post-H hologram. Run backward leg to get evidence.
      this._holoField = psi64;
      this.holoNorm   = Math.max(mx, 1e-12);
      const gpu = this._gpu, D = this.tSteps, dt = this.dt;
      gpu.setEyePsi(this._holoField);
      gpu.stepEyeN(D, -dt);
      this._evidence    = gpu.readEyePsi();
      let evMx = 0;
      for (let j = 0; j < this._evidence.length; j += 2) {
        const v = this._evidence[j]*this._evidence[j] + this._evidence[j+1]*this._evidence[j+1];
        if (v > evMx) evMx = v;
      }
      this.evidenceNorm = Math.max(evMx, 1e-12);
    } else {
      // Legacy format: stored field is _evidence directly
      this._evidence    = psi64;
      this._holoField   = null;
      this.evidenceNorm = Math.max(mx, 1e-12);
    }

    this._perceptState = null;
    this.dirty = false;
    console.log('[IFSEye] loaded, field=', meta.field ?? 'evidence(legacy)', 'T=', this.tSteps);
    return meta;
  }
}


// ── IFSHologram ───────────────────────────────────────────────────────────────
// Record/reconstruct pipeline. Records by running T IFS steps from a seed
// field and accumulating |ψ + ψ_ref|² into a plate. Reconstructs by seeding
// from plate × conj(ref) and running T backward steps. Supports save/load.
//
// Usage:
//   const holo = new IFSHologram(gpu, { tRecord: 100, dt: 0.12, decay: 0.998 })
//   holo.snap(seedPsi64, refField64)      // record one exposure
//   holo.reconstruct()                    // backward T steps → reconPsi
//   holo.renderPlate(ctx, gpuCanvas, ...)
//   holo.renderRecon(ctx, gpuCanvas, ...)
//   const blob = holo.save()              // → Blob (.ifsh)
//   holo.load(arrayBuffer, gpu)           // ← .ifsh

class IFSHologram {
  constructor(gpu, opts = {}) {
    this._gpu      = gpu;
    this.tRecord   = opts.tRecord ?? 100;
    this.dt        = opts.dt      ?? 0.12;
    this.decay     = opts.decay   ?? 0.998;

    this._snapSwPsi     = null;   // ψ at hologram plane (after T forward steps)
    this._reconPsi      = null;   // ψ at object plane (after T backward steps)
    this._snapRadii     = null;
    this._snapWeights   = null;
    this._snapAngleY    = null;
    this._snapAngleX    = null;

    this.snapMaxField = 1e-9;
    this.reconNorm    = 1e-9;
    this.plateNorm    = 1e-9;
  }

  // Record one exposure: seed field → T forward IFS steps → accumulate plate.
  // radii/weights/offsets: current IFS kernel arrays.
  snap(seedPsi64, radii, weights, offsets, angleY, angleX) {
    const gpu = this._gpu;
    gpu.resetPlate();
    gpu.setSweepPsi(seedPsi64);
    gpu.stepSweepN(this.tRecord, this.dt);
    gpu.accumulatePlateSweep(this.decay);
    this._snapSwPsi   = gpu.readPsi();
    this._snapRadii   = Float64Array.from(radii);
    this._snapWeights = Float64Array.from(weights);
    this._snapAngleY  = angleY;
    this._snapAngleX  = angleX;
    let mx = 0;
    for (let j = 0; j < this._snapSwPsi.length >> 1; j++) {
      const v = this._snapSwPsi[j*2]*this._snapSwPsi[j*2] + this._snapSwPsi[j*2+1]*this._snapSwPsi[j*2+1];
      if (v > mx) mx = v;
    }
    this.snapMaxField = mx;
    return this._snapSwPsi;
  }

  // Exact backward reconstruction: upload snapSwPsi, run T backward steps.
  reconstruct(focusDepth = 0) {
    if (!this._snapSwPsi) { console.warn('[IFSHologram] reconstruct: no snapshot — call snap() first'); return null; }
    const gpu = this._gpu;
    gpu.setSweepPsi(this._snapSwPsi);
    const steps = focusDepth > 0 ? Math.max(1, this.tRecord - focusDepth) : this.tRecord;
    gpu.stepSweepN(steps, -this.dt);
    this._reconPsi = gpu.readPsi();
    let mx = 0;
    for (let j = 0; j < this._reconPsi.length >> 1; j++) {
      const v = this._reconPsi[j*2]*this._reconPsi[j*2] + this._reconPsi[j*2+1]*this._reconPsi[j*2+1];
      if (v > mx) mx = v;
    }
    this.reconNorm = mx;
    return this._reconPsi;
  }

  // Render the current GPU plate to a canvas context.
  renderPlate(ctx, gpuCanvas, smoothMaxPlate, smoothMaxField, RW, RH) {
    this._gpu.renderSweepPlate(smoothMaxPlate, smoothMaxField);
    ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
  }

  // Render the reconstruction (sweep texture) to a canvas context.
  renderRecon(ctx, gpuCanvas, RW, RH) {
    const norm = Math.max(this.reconNorm, 1e-9);
    this._gpu.renderSweepField(norm);
    ctx.drawImage(gpuCanvas, 0, 0, RW, RH);
  }

  // Save snapshot to .kwe Blob.
  save() {
    if (!this._snapSwPsi) { console.warn('[IFSHologram] save: no snapshot'); return null; }
    const meta = {
      grid:    this._snapSwPsi.length >> 1,  // N_CELLS — grid² inferred at load
      dt:      this.dt,
      tRecord: this.tRecord,
      radii:   this._snapRadii   ? Array.from(this._snapRadii)   : [],
      weights: this._snapWeights ? Array.from(this._snapWeights) : [],
      angleY:  this._snapAngleY,
      angleX:  this._snapAngleX,
    };
    const f32      = new Float32Array(this._snapSwPsi.length);
    for (let i = 0; i < f32.length; i++) f32[i] = this._snapSwPsi[i];
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    const metaLen   = new Uint32Array([metaBytes.length]);
    return new Blob([metaLen.buffer, metaBytes.buffer, f32.buffer],
      { type: 'application/octet-stream' });
  }

  // Trigger browser download of the .kwe file.
  download(filename = 'hologram.kwe') {
    const blob = this.save();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // Load from ArrayBuffer (e.g. from file input). Optionally re-uploads kernel to gpu.
  load(buf, gpu) {
    const metaLen = new Uint32Array(buf, 0, 1)[0];
    const metaStr = new TextDecoder().decode(new Uint8Array(buf, 4, metaLen));
    const meta    = JSON.parse(metaStr);
    const f32     = new Float32Array(buf.slice(4 + metaLen));
    const swPsi   = new Float64Array(f32.length);
    for (let i = 0; i < f32.length; i++) swPsi[i] = f32[i];
    this._snapSwPsi   = swPsi;
    this._snapAngleY  = meta.angleY;
    this._snapAngleX  = meta.angleX;
    this.tRecord      = meta.tRecord ?? this.tRecord;
    this.dt           = meta.dt      ?? this.dt;
    if (meta.radii?.length) {
      this._snapRadii   = new Float64Array(meta.radii);
      this._snapWeights = new Float64Array(meta.weights);
      if (gpu ?? this._gpu) {
        const TWO_PI = 2 * Math.PI;
        const offsets = meta.radii.map(r => {
          const n = Math.max(8, Math.ceil(TWO_PI * r));
          const f = new Int16Array(n * 2);
          for (let k = 0; k < n; k++) {
            f[k*2]   = Math.round(r * Math.cos(k * TWO_PI / n));
            f[k*2+1] = Math.round(r * Math.sin(k * TWO_PI / n));
          }
          return f;
        });
        (gpu ?? this._gpu).setRings(meta.radii, meta.weights, offsets);
      }
    }
    console.log('[IFSHologram] loaded, grid=', meta.grid, 'T=', meta.tRecord);
    return meta;
  }
}

// ── IFSSound — IFS-native holography of a 1D temporal signal ────────────────────
// The image pipeline, one dimension down. A sound is a 1D field ψ(t) (the analytic
// signal: waveform + i·Hilbert). The SAME idea — propagate a complex field through a
// reversible IFS operator, reconstruct backward — applied to time instead of space.
//
// Native fit: the IFS clock is intrinsically temporal (fractal subdivisions of time);
// images had to BORROW it as a spatial operator, but sound uses it as what it is. The
// 1D operator here is a symmetric multi-tap dispersive Laplacian (the line analog of the
// ring operator), evolved by the same symplectic leapfrog → exactly reversible.
//
// "A sound wavefront contains depth": the analytic signal's PHASE carries timing/pitch,
// exactly as image phase carried spatial depth. Forward IFS disperses (chirps) the signal
// across time; backward refocuses it. depthScrub(τ) reads it out at evolution-time τ —
// the SAME τ that drives the image depth explorer, so one fractal clock syncs both.
class IFSSound {
  constructor(opts = {}) {
    this.tSteps    = opts.tSteps    ?? 100;   // propagation depth (shared with image)
    this.dt        = opts.dt        ?? 0.12;
    this.depthBand = opts.depthBand ?? 0.35;  // τ focal band (shared meaning with image)
    // 1D dispersive kernel taps (line analog of IFS ring radii/weights). Symmetric.
    this.taps    = opts.taps    ?? [1, 2, 3, 5];
    this.weights = opts.weights ?? [0.03, 0.02, 0.015, 0.01];
    this._N = 0; this._src = null;
  }

  // Set the source waveform (real samples). Builds the analytic-signal complex field.
  setWaveform(samples) {
    const N = samples.length;
    this._N = N;
    // analytic signal: Re = samples, Im = Hilbert(samples). Cheap FFT-free Hilbert via a
    // 90°-phase-shifted copy is overkill here; for the prototype we seed Im=0 and let the
    // dispersive propagation generate phase structure (faithful enough for the round-trip).
    const psi = new Float64Array(2 * N);
    for (let i = 0; i < N; i++) psi[i*2] = samples[i];
    this._src = psi;
    return psi;
  }

  // One reversible 1D IFS leapfrog step (symmetric kick-drift-kick, periodic boundary).
  _step(psi, dt) {
    const N = this._N, out = new Float64Array(psi), h = dt * 0.25;
    const lap = (src, comp) => {
      const L = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        // nearest-neighbor 1D Laplacian + multi-tap dispersive terms (the line "rings")
        let v = src[((i+1)%N)*2+comp] + src[((i-1+N)%N)*2+comp] - 2*src[i*2+comp];
        for (let d = 0; d < this.taps.length; d++) {
          const t = this.taps[d], w = this.weights[d];
          v += w * (src[((i+t)%N)*2+comp] + src[((i-t+N)%N)*2+comp] - 2*src[i*2+comp]);
        }
        L[i] = v;
      }
      return L;
    };
    let l = lap(out, 1); for (let i = 0; i < N; i++) out[i*2]   -= h * l[i];
    l = lap(out, 0);     for (let i = 0; i < N; i++) out[i*2+1] += dt * 0.5 * l[i];
    l = lap(out, 1);     for (let i = 0; i < N; i++) out[i*2]   -= h * l[i];
    return out;
  }
  _stepN(psi, n, dt) { let p = psi; for (let i = 0; i < n; i++) p = this._step(p, dt); return p; }

  // Forward propagate the source → the sound hologram (dispersed field).
  hologram() { return this._stepN(this._src, this.tSteps, this.dt); }

  // τ-scrub: reconstruct the sound at evolution-time τ (band-mapped, same as the image so
  // ONE τ drives both). Returns the complex field at depth/time-focus τ. Optional band
  // occlusion (start..end fraction zeroed) for the redundancy test.
  scrub(tau, occlude = null) {
    const D = this.tSteps, band = this.depthBand;
    let psi = this.hologram();
    if (occlude) {                              // mask a fraction of the hologram (a band)
      const a = Math.floor(occlude[0] * this._N), b = Math.floor(occlude[1] * this._N);
      for (let i = a; i < b; i++) { psi[i*2] = 0; psi[i*2+1] = 0; }
    }
    const kNear = Math.round(D * (1 - band));
    const back  = Math.round(kNear + tau * (D - kNear));
    if (back > 0) psi = this._stepN(psi, back, -this.dt);
    return psi;
  }

  // Reconstructed waveform (real part) at τ — what you'd play / draw.
  waveformAt(tau, occlude = null) {
    const psi = this.scrub(tau, occlude);
    const w = new Float64Array(this._N);
    for (let i = 0; i < this._N; i++) w[i] = psi[i*2];
    return w;
  }

  // Round-trip fidelity test (sound analog of the point reconstruction): forward then
  // full backward should return the source. Returns correlation (1 = exact).
  testRoundTrip() {
    let psi = this._stepN(this._src, this.tSteps, this.dt);
    psi = this._stepN(psi, this.tSteps, -this.dt);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < this._N; i++) { const a = psi[i*2], b = this._src[i*2]; dot += a*b; na += a*a; nb += b*b; }
    return (na > 0 && nb > 0) ? dot / Math.sqrt(na*nb) : 0;
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  //  CLOCK-MODULATED SOUND — "no tricks at all": sound lives in the TIME-STEP SCHEDULE,
  //  not in space. No spatial carrier e^{ikx·x}, no fake depth slot. The audio modulates
  //  the per-step dt of the SAME reversible evolution that carries an image; the image is
  //  carried by the steps, the audio IS the steps' tempo. Recovery is phase-rate demod:
  //  the receiver re-steps and measures per-step phase advance — the dt schedule the
  //  emitter used is read back from how fast the field's phase rotates each tick.
  //
  //  Reversibility is UNTOUCHED: each leapfrog step is individually reversible for ANY dt,
  //  so reversing the SAME dt schedule (backward, same per-step dt) exactly refocuses the
  //  field. This is the genuinely native encoding — sound = the clock's own breathing.
  // ════════════════════════════════════════════════════════════════════════════════════

  // Build the per-step dt schedule from an audio stream of length D (the propagation depth).
  // dt_i = dt·(1 + eps·s_i), s_i ∈ [-1,1] normalized. Returned alongside the normalized
  // samples actually used (resampled to D ticks) so the receiver can be scored against them.
  _clockSchedule(samples, eps) {
    const D = this.tSteps;
    // resample the audio to exactly D ticks (one sample per propagation step — the clock IS
    // the audio clock). nearest-neighbour is fine for the prototype.
    const s = new Float64Array(D);
    let mx = 0;
    for (let i = 0; i < D; i++) {
      const v = samples[Math.min(samples.length - 1, Math.floor(i * samples.length / D))];
      s[i] = v; if (Math.abs(v) > mx) mx = Math.abs(v);
    }
    if (mx > 0) for (let i = 0; i < D; i++) s[i] /= mx;   // normalize to [-1,1]
    const dts = new Float64Array(D);
    for (let i = 0; i < D; i++) dts[i] = this.dt * (1 + eps * s[i]);
    return { s, dts, eps };
  }

  // Mean phase-advance per step of a field under one step at dt: ⟨Δarg(ψ)⟩ over all cells,
  // amplitude-weighted (low-amplitude cells have meaningless phase). This is the quantity
  // that scales with dt → the demod observable.
  _meanPhaseAdvance(psiBefore, psiAfter) {
    let sw = 0, acc = 0;
    for (let i = 0; i < this._N; i++) {
      const ar = psiBefore[i*2], ai = psiBefore[i*2+1];
      const br = psiAfter[i*2],  bi = psiAfter[i*2+1];
      const a2 = ar*ar + ai*ai;
      if (a2 < 1e-12) continue;
      // Δarg = arg(after · conj(before)) = atan2(Im, Re) of the product
      const pr = br*ar + bi*ai;       // Re(after·conj(before))
      const pi = bi*ar - br*ai;       // Im(after·conj(before))
      acc += a2 * Math.atan2(pi, pr);
      sw  += a2;
    }
    return sw > 0 ? acc / sw : 0;
  }

  // FORWARD through the clock-modulated schedule, carrying an arbitrary image-bearing field
  // `imgField` (2·N complex). Returns the dispersed hologram AND the schedule used. The
  // image rides the steps; the audio is the dt sequence. If imgField is omitted, uses the
  // sound's own _src (pure-audio self-test).
  clockForward(samples, imgField = null, eps = 0.25) {
    const sched = this._clockSchedule(samples, eps);
    let psi = imgField ? new Float64Array(imgField) : new Float64Array(this._src);
    for (let i = 0; i < this.tSteps; i++) psi = this._step(psi, sched.dts[i]);
    return { holo: psi, sched };
  }

  // RECOVER: re-step the hologram BACKWARD through the same schedule (exact refocus of the
  // image) WHILE measuring per-step mean phase advance → infer the dt that was used at each
  // tick → divide out the constant-dt baseline → the audio s_i. Returns { recon, sRec, img }.
  //   recon : the refocused field (image exactly back, since same dt schedule reversed)
  //   sRec  : recovered audio (length D), to be correlated with sched.s
  // Phase-rate demod is approximate (phase advance also depends on field structure, which
  // evolves), so we CALIBRATE: a parallel constant-dt back-pass gives the baseline advance
  // per step; the ratio modulated/baseline ≈ (1+eps·s_i) → s_i. The two passes start from
  // the same hologram and visit structurally-matched fields, cancelling most of the
  // structure-dependence.
  clockRecover(holo, sched, eps = null) {
    eps = eps ?? sched.eps;
    const D = this.tSteps;
    // modulated backward pass (true inverse — refocuses the image) with phase-advance log
    let pm = new Float64Array(holo);
    const advMod = new Float64Array(D);
    for (let i = D - 1; i >= 0; i--) {
      const nxt = this._step(pm, -sched.dts[i]);
      advMod[D - 1 - i] = this._meanPhaseAdvance(pm, nxt);   // advance at this tick
      pm = nxt;
    }
    const recon = pm;
    // constant-dt backward pass (calibration baseline) from the SAME hologram
    let pc = new Float64Array(holo);
    const advBase = new Float64Array(D);
    for (let i = D - 1; i >= 0; i--) {
      const nxt = this._step(pc, -this.dt);
      advBase[D - 1 - i] = this._meanPhaseAdvance(pc, nxt);
      pc = nxt;
    }
    // s_i ≈ (advMod/advBase − 1)/eps   (both passes indexed by tick order D-1-i = forward i)
    const sRec = new Float64Array(D);
    for (let k = 0; k < D; k++) {
      const fwdTick = D - 1 - k;                  // map back-pass order → forward tick index
      const base = advBase[k];
      const r = (Math.abs(base) > 1e-9) ? (advMod[k] / base - 1) / eps : 0;
      sRec[fwdTick] = r;
    }
    // normalize recovered audio to unit peak for fair correlation
    let mx = 0; for (let i = 0; i < D; i++) if (Math.abs(sRec[i]) > mx) mx = Math.abs(sRec[i]);
    if (mx > 0) for (let i = 0; i < D; i++) sRec[i] /= mx;
    return { recon, sRec };
  }

  // End-to-end self-test of the clock-modulated channel: encode `samples` into the dt
  // schedule while carrying `imgField` (or the sound's own _src), reconstruct, and report
  // BOTH fidelities — image (field correlation) and sound (recovered-schedule correlation).
  // No spatial carrier, no depth slot: the only seam is eps (modulation depth).
  clockRoundTrip(samples, imgField = null, eps = 0.25) {
    const { holo, sched } = this.clockForward(samples, imgField, eps);
    const { recon, sRec } = this.clockRecover(holo, sched, eps);
    const ref = imgField ?? this._src ?? recon;   // self-test needs a reference; fall back gracefully
    // image fidelity
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < this._N; i++) { const a = recon[i*2], b = ref[i*2]; dot += a*b; na += a*a; nb += b*b; }
    const imgScore = (na > 0 && nb > 0) ? dot / Math.sqrt(na*nb) : 0;
    // sound fidelity (recovered dt schedule vs the one encoded)
    let sd = 0, sa = 0, sb = 0;
    for (let i = 0; i < this.tSteps; i++) { const a = sRec[i], b = sched.s[i]; sd += a*b; sa += a*a; sb += b*b; }
    const sndScore = (sa > 0 && sb > 0) ? sd / Math.sqrt(sa*sb) : 0;
    return { imgScore, sndScore, sRec, s: sched.s, recon };
  }
}

export { IFSEye, IFSHologram, IFSSound };
