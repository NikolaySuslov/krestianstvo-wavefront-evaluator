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

  // Set the input wavefront. Marks dirty.
  setSource(psi64) {
    this._source = psi64;
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
    gpu.setEyePsi(this._source);
    gpu.stepEyeN(D, dt);
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

    // Reconstruction quality: normalized correlation of |ψ_evidence|² vs |ψ_source|².
    // 1.0 = perfect reconstruction of the object; falls off with occlusion / precision.
    // Graceful (slow) falloff vs sharp loss = the holographic signature.
    this.score = this._corr(this._evidence, this._source);

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

  // ── One-shot diagnostic: RING-BAND redundancy — MISMATCHED legs.
  // Encode with the FULL kernel (the real hologram), then DECODE with only one ring
  // band. Because the legs use different operators, the round-trip is NO LONGER a
  // trivial identity — the score reveals whether that single band alone can invert the
  // full-kernel hologram, i.e. whether the object's info is redundantly carried in that
  // band. (Same-kernel round-trips score 1.000 for any band, which is uninformative.)
  //   high score for a band → that ring scale alone decodes the full hologram (redundant)
  //   low score             → that band is insufficient; info is distributed across scales
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

export { IFSEye, IFSHologram };
