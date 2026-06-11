// ════════════════════════════════════════════════════════════════════════════════════════════════
//  SOLITON ALGEBRA — first-class, composable live solitons as pure functions of IFS time (§7.26)
//  ------------------------------------------------------------------------------------------------
//  Refactors the hard-coded event+image union inside `solitonRenderAt` into a small ALGEBRA so live
//  solitons become first-class entities that compose like higher-order functions, with the composite
//  AUTOMATICALLY a pure function of cyc (hence peer-synced) and maskable by H.
//
//  THE TYPE.  A live soliton is a value:
//    { kind, region(), inject(gpu,g,cyc,subStep,totalSteps), readout(g,recon,cyc,clean), trueCells?(cyc) }
//   inject  : HOW it writes content into the wavefront over a bar's propagation (depth-staging here)
//   region  : WHICH grid region + depth band it owns (orthogonality unit, for clean read-back)
//   readout : HOW to recover itself from a reconstruction
//   trueCells: (events only) the cells it occupies this bar — lets the engine build the clean-energy
//             reference for the per-note ratio gate without the soliton leaking its melody upward.
//  Everything is parametrized by `cyc` only ⇒ pure ⇒ composite is peer-synced by construction.
//
//  COMBINATORS (closed over the type — result is itself a Soliton):
//    unite([...])  superpose/region-mux into one wavefront ;  place(s,region) ; atDepth(s,b0,b1)
//
//  GUARANTEE vs CONDITION (measured, §7.20/§7.22/§7.23):
//   • GUARANTEE: composition is always SOUND — composite field is deterministic & peer-synced.
//   • CONDITION: composition is LEGIBLE (parts recoverable) only if parts stay ORTHOGONAL (disjoint
//     region OR depth OR sparse structure). unite() runs an orthogonality check and warns; soundness
//     is automatic, legibility is the caller's discipline via place()/atDepth().
//
//  Composition does COEXISTENCE (unite/place/atDepth) AND, as of §7.32-7.33, COMPUTATION: `gate(controller,
//  target)` is a Soliton TAKING two Solitons where one TRANSFORMS the other via the binding [H] = field
//  PRODUCT (GPU-verified: ψ_img·ψ_rhythm reproduces the exact gated image, fidelity 1.000). "image sampled
//  where the beat fires." Coexistence superposes-and-reads-separately; computation multiplies-and-binds.
//  COEXISTENCE has two realizations: CARRIER-mux (carrierEventSoliton/carrierWaveSoliton — orthogonal in k,
//  clean for sparse §7.29) and TEMPORAL-mux (regionEventSoliton/regionWaveSoliton via evalSolitonTemporalAt —
//  each modality alone in its bar PHASE, carrier-free; §7.44 "media as a limit cycle", dense self-fid ≈1.0).
//
//  RECURSION & SELF-REFERENCE (§9, conceptual answers measured in holography.js):
//   • STRUCTURAL recursion — YES, free: every combinator is CLOSED over the Soliton type (unite/gate/
//     recognize/recall take Solitons, return a Soliton) → arbitrary nesting gate(a, gate(b, c)) works now.
//   • TEMPORAL feedback (output → own input across time) — only as a CLOCK-PURE FIXED-POINT loop (fixed
//     iters from a clock-seeded start → stays a pure function of the clock → peer-synced). Open-ended
//     stateful feedback would break peer-sync — forbidden by design. RECALL is the first real instance
//     (Hopfield relaxation = a fixed-point feedback loop). See IFSEye.fixedPointLoop / recallGate (§9).
//   • The algebra's OBJECTS are solitons (unite = a monoid → a composite scene IS a soliton, already used).
//   • The algebra SELF-HOSTS (§7.43, RESOLVED, GPU-verified): the binding OPERATOR is reified as a value in
//     the algebra — `operatorSoliton` (rank-K stack, apply(a,b)[k]=Σ_r W_r(U_r·a)(V_r·b)) and its clock form
//     `operatorSolitonCyc` (a LIMIT CYCLE: one field walking its K ranks across K sub-ticks, the bound output
//     accumulating over the bar = the exact binding, corr 1.000 on the GPU). So the OPERATOR is the same kind
//     of thing as the OBJECTS: a pure function of cyc, peer-synced. `fitOperatorSoliton` builds it exactly from
//     a rule's bilinear tensor (mode-expansion + σ-guard → monotonic to the true rank). selfApplyGate showed
//     fixed-point-reaching alone ≠ self-hosting; the rank-K reification is the real self-hosting.
//
//  THE ARCHITECTURE (§7.45 synthesis). Data is a wavefront; the operator that transforms it is ALSO a wavefront
//  on the same clock; combining them RUNS the computation by propagation (§7.32); memory/feedback are attractors
//  & fixed points of the same medium (§7.42). No separate CPU over passive RAM — the WAVE MEDIUM IS THE PROCESSOR,
//  the solitons are the programs AND the data, the field's geometry (ring kernel, fractal clock, phase) is the
//  instruction set computing the next state. The soliton processes ITSELF through time. This is measured at small
//  scale (the instruction set = bilinear bind + matched-filter read + temporal mux); computational UNIVERSALITY
//  is an open frontier, not a settled claim. "Algebraic soliton field" is the accurate name, not metaphor.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── SUBSPACE — the generalization of "region" (§7.27). Many solitons can share ONE physical field
//    (preserving the united-wavefront thesis: one object, masked together, cross-modal-capable) and
//    still be separable IF they occupy ORTHOGONAL SUBSPACES — and the subspace need NOT be a spatial
//    region. The trivial impl is a region (disjoint cells). Other bases (carrier/angle-mux, spectral,
//    depth) are drop-in: they fully OVERLAP in space but stay orthogonal in a non-spatial inner
//    product, the way real holograms angle-multiplex N images into one plate. A Subspace is:
//      { kind, coherence(other) }                       — 0 = orthogonal (clean read-back), 1 = collinear
//    plus, on the soliton, embed/extract use it. coherence replaces the old binary regionsOverlap so
//    `unite` is basis-AGNOSTIC: it warns when two solitons' subspaces are too coherent to separate,
//    whatever the basis. (Whether IFS PRESERVES a given basis's orthogonality is a measured question.)
//
// REGION subspace — grid sub-rect (cells) + depth band (bars). coherence = fractional overlap (0 if
// spatially OR depth disjoint). This is the current (only-implemented) basis; the trivial special case.
function makeRegion(x0, y0, x1, y1, depthBar0 = 0, depthBar1 = 1) {
  return {
    kind: 'region',
    x0, y0, x1, y1, depth: { bar0: depthBar0, bar1: depthBar1 },
    // coherence with another subspace: spatial-overlap-fraction × depth-overlap (0..1). Disjoint → 0.
    coherence(o) {
      if (o.kind !== 'region') return 0.5;   // unknown cross-basis pairing → be cautious (warn-ish)
      const ox = Math.max(0, Math.min(this.x1, o.x1) - Math.max(this.x0, o.x0));
      const oy = Math.max(0, Math.min(this.y1, o.y1) - Math.max(this.y0, o.y0));
      const od = Math.max(0, Math.min(this.depth.bar1, o.depth.bar1) - Math.max(this.depth.bar0, o.depth.bar0));
      if (ox === 0 || oy === 0 || od === 0) return 0;   // disjoint in space OR depth → orthogonal
      const myArea = Math.max(1, (this.x1-this.x0)*(this.y1-this.y0));
      return (ox * oy) / myArea;            // fraction of THIS region the other covers
    },
  };
}
// Generic coherence between two subspaces (each may implement its own coherence()). Symmetric-ish:
// use the max of both directions so neither side under-reports an overlap.
function subspaceCoherence(a, b) {
  const ab = a.coherence ? a.coherence(b) : 0.5;
  const ba = b.coherence ? b.coherence(a) : 0.5;
  return Math.max(ab, ba);
}
// (back-compat) — old name, now derived from coherence (overlap if coherence above ~0).
function regionsOverlap(a, b) { return subspaceCoherence(a, b) > 1e-6; }

// ── FUTURE SUBSPACE BASES (descriptors only — embed/extract into the field are NOT wired yet; these
//    define the orthogonality MODEL so unite()/the engine are already basis-agnostic. Each must be
//    MEASURED for whether the IFS ring-kernel preserves its orthogonality, like the occlusion tests).
//
// CARRIER (angle-multiplex, the holographically-native basis): a modality is encoded as
//   content·e^{i(kx·x+ky·y)} summed into the SAME cells as others; recovered by correlating with its
//   own carrier. Two carriers are orthogonal when |Δk| is large (well-separated angles). coherence
//   ~ a falloff in carrier distance. This is how a real plate stores N images in one physical object.
function makeCarrier(kx, ky, minSep = 0.6) {
  return {
    kind: 'carrier', kx, ky, minSep,
    coherence(o) { if (o.kind !== 'carrier') return 0.5;
      const dk = Math.hypot(this.kx - o.kx, this.ky - o.ky);
      return Math.max(0, 1 - dk / minSep); },     // far apart in k → 0 (orthogonal)
    // EMBED: write real per-cell content m(x,y) onto this carrier into the shared field:
    //   ψ[c] += m·e^{i(kx·x+ky·y)}  (fully overlapping all cells with other carriers).
    embed(psi, content, G) {
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        const i = y * G + x, m = content[i] || 0; if (m === 0) continue;
        const ph = this.kx * x + this.ky * y;
        psi[i*2]   += m * Math.cos(ph);
        psi[i*2+1] += m * Math.sin(ph);
      }
    },
    // EXTRACT: demodulate by the conjugate carrier and take the real part:
    //   m̂(x,y) = Re( ψ[c]·e^{-i(kx·x+ky·y)} ). Other carriers' terms carry e^{i(Δk·x)} → oscillate →
    //   average toward 0 when |Δk| is large (the orthogonality), so only THIS modality survives.
    extract(psi, G) {
      const out = new Float64Array(G * G);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        const i = y * G + x, ph = this.kx * x + this.ky * y, c = Math.cos(ph), s = Math.sin(ph);
        out[i] = psi[i*2] * c + psi[i*2+1] * s;   // Re(ψ·e^{-iph})
      }
      return out;
    },
  };
}
// SPECTRAL (band-mux): a modality lives in a spatial-frequency band [k0,k1] of the same cells.
// Orthogonal when bands are disjoint. coherence = band overlap fraction.
function makeBand(k0, k1) {
  return { kind: 'band', k0, k1,
    coherence(o) { if (o.kind !== 'band') return 0.5;
      const ov = Math.max(0, Math.min(this.k1, o.k1) - Math.max(this.k0, o.k0));
      return ov / Math.max(1e-9, this.k1 - this.k0); } };
}
// DEPTH (the IFS-native basis — depth=duration, already PROVEN to separate, §5.2c/§7.25): a modality
// at injection-depth band [d0,d1]; recovered by back-prop distance. Orthogonal when depth bands disjoint.
function makeDepthBand(d0, d1) {
  return { kind: 'depthband', d0, d1,
    coherence(o) { if (o.kind !== 'depthband') return 0.5;
      const ov = Math.max(0, Math.min(this.d1, o.d1) - Math.max(this.d0, o.d0));
      return ov / Math.max(1e-9, this.d1 - this.d0); } };
}

// ── PRIMITIVE SOLITONS ──────────────────────────────────────────────────────────────────────────

// REGION EVENT soliton (§7.44, TEMPORAL/carrier-free) — for the temporal-multiplexed scene, where each
// modality is ALONE in its bar phase, no carrier is needed to separate it. Place the note pattern DIRECTLY
// in the real channel at the note cells (no e^{ikx} spread); recover by reading those cells back directly
// (no demod). Same per-note energy gate / f1 as the carrier version — identical readout API, carrier-free.
function regionEventSoliton({ melodyFn, nBins, dropRatio = 0.30 }) {
  const barOf = (cyc) => Math.floor(cyc / nBins);
  return {
    kind: 'event',
    region: () => ({ kind: 'region', x0: 0, y0: 0, x1: 1, y1: 1, depth: 0 }),   // identity region (alone in phase)
    nBins,
    trueCells: (cyc) => melodyFn(barOf(cyc)),
    inject(gpu, g, cyc, barLocalStep) {
      if (barLocalStep !== 0) return;
      const psi = gpu.readEyePsi();
      for (const ev of melodyFn(barOf(cyc))) for (const c of g.evFoot(ev.tier, ev.bin)) psi[c*2] += 1.0;   // direct, real channel
      gpu.setEyePsi(psi);
    },
    readout(g, recon, cyc, clean) {
      const cellE = (t, b) => { let m = 0; for (const c of g.evFoot(t, b)) { const v = recon[c*2]*recon[c*2] + recon[c*2+1]*recon[c*2+1]; if (v > m) m = v; } return m; };
      const trueSet = melodyFn(barOf(cyc)), notes = [];
      for (const ev of trueSet) {
        const ratio = cellE(ev.tier, ev.bin) / ((clean && clean['c:' + ev.tier + ':' + ev.bin]) || 1e-12);
        if (ratio >= dropRatio) notes.push({ tier: ev.tier, bin: ev.bin, gain: Math.min(1, Math.sqrt(ratio)) });
      }
      const f1 = trueSet.length ? notes.length / trueSet.length : 0;
      return { kind: 'event', recovered: notes, trueSet, f1 };
    },
    cleanEnergy(g, cleanRecon, cyc) { const out = {};
      for (const ev of melodyFn(barOf(cyc))) { let m=0; for (const c of g.evFoot(ev.tier, ev.bin)){ const v=cleanRecon[c*2]*cleanRecon[c*2]+cleanRecon[c*2+1]*cleanRecon[c*2+1]; if(v>m)m=v; } out['c:'+ev.tier+':'+ev.bin]=Math.max(1e-12,m); }
      return out;
    },
  };
}

// REGION WAVEFORM soliton (§7.44, TEMPORAL/carrier-free) — harmonic amplitudes placed directly at their
// cells (real channel), recovered directly. Alone in its phase → no carrier needed. Same API as carrier ver.
function regionWaveSoliton({ harmonicsFn, nBins, cellsFn, dropRatio = 0.30 }) {
  const barOf = (cyc) => Math.floor(cyc / nBins);
  const cells = (g, H) => (cellsFn ? cellsFn(g, H) : defaultWaveCells(g, H));
  return {
    kind: 'wave',
    region: () => ({ kind: 'region', x0: 0, y0: 0, x1: 1, y1: 1, depth: 0 }),
    nBins,
    inject(gpu, g, cyc, barLocalStep) {
      if (barLocalStep !== 0) return;
      const amps = harmonicsFn(barOf(cyc)), H = amps.length, cs = cells(g, H);
      const psi = gpu.readEyePsi();
      for (let h = 0; h < H; h++) psi[cs[h]*2] += amps[h];    // amplitude directly in the real channel
      gpu.setEyePsi(psi);
    },
    readout(g, recon, cyc, clean) {
      const amps = harmonicsFn(barOf(cyc)), H = amps.length, cs = cells(g, H), out = new Float64Array(H);
      for (let h = 0; h < H; h++) { const cd = (clean && clean['w:' + h]) || 1e-12; const ratio = recon[cs[h]*2] / cd; out[h] = (Math.abs(ratio) >= dropRatio) ? ratio * amps[h] : 0; }
      return { kind: 'wave', harmonics: out, trueHarmonics: amps };
    },
    cleanEnergy(g, cleanRecon, cyc) { const amps = harmonicsFn(barOf(cyc)), H = amps.length, cs = cells(g, H), out = {};
      for (let h = 0; h < H; h++) { const v = cleanRecon[cs[h]*2]; out['w:' + h] = (Math.abs(v) > 1e-9 ? v : 1e-9); } return out;
    },
  };
}

function defaultWaveCells(g, H) {
  const G = g.G, y = Math.floor(G * 0.5), out = [];
  for (let h = 0; h < H; h++) out.push(y * G + Math.min(G - 1, Math.round((h + 1) * G / (H + 1))));
  return out;
}

// IMAGE soliton: a depth-staged layer stack in `region`'s rows; recovered as the back-propagated field.
function imageSoliton({ region, layersFn }) {
  return {
    kind: 'image',
    region: () => region,
    layersFn, imgRegion: region,            // exposed so gate() can flatten the layers in pure JS (no GPU loop)
    inject(gpu, g, cyc, barLocalStep, totalSteps) {
      const layers = layersFn(); if (!layers || !layers.length) return;
      const nL = layers.length;
      for (let d = 0; d < nL; d++) {
        if (Math.round(totalSteps * (nL - 1 - d) / nL) !== barLocalStep) continue;  // far early, near late
        const f = layers[d], psi = gpu.readEyePsi();
        for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) {
          const k = (y * g.G + x) * 2; psi[k] += f[k]; psi[k + 1] += f[k + 1];
        }
        gpu.setEyePsi(psi);
      }
    },
    readout(_g, recon) { return { kind: 'image', field: recon }; },
  };
}

// ── COMBINATORS ───────────────────────────────────────────────────────────────────────────────
function place(s, region)        { return { ...s, region: () => region }; }
function atDepth(s, bar0, bar1)  { const r = s.region(); return { ...s, region: () => ({ ...r, depth: { bar0, bar1 } }) }; }

// ── HOLOGRAPHIC-COMPUTING API (§9) — composition-as-COMPUTATION as a small INSTRUCTION SET on one
//    wavefront. The one primitive is `bind(controller, target, {op, readout, refFn})`: it combines the
//    target field with a controller-supplied field pointwise in the hologram domain (the binding [H]),
//    superposes the result on the controller's carrier (coexistence-safe inside unite), and reads it back
//    one of three ways. THREE FACES OF ONE PRODUCT (all the IFS-correlation we measured in §7.32):
//      op       how the two fields combine:
//        'mask'    ψ_target · r            r=0/1 selector  → GATING (transform)         [§7.33, proven]
//        'product' ψ_target · ψ_ref                        → correlation/convolution    [§7.32, proven]
//        'conj'    ψ_target · conj(ψ_ref)                  → matched filter (sharpest)   [unmeasured]
//      readout  what to extract from the round-tripped bound field (demod the carrier first):
//        'field'   the transformed field                    → GATE (where it passed)
//        'map'     |demod| per cell, normalized             → RECOGNITION (where ref OCCURS — "A's light up")
//        'recall'  the peak region → the matched stored pattern → RECALL (completion)   [unmeasured]
//    So: gate = bind(op:'mask', readout:'field'); recognize = bind(op:'conj', readout:'map'); recall =
//    bind(op:'conj', readout:'recall'). The product→correlation IS measured (§7.32); conj/map/recall are
//    NEW modes — each ships behind a `holoComputeGate` measurement before it's trusted (same discipline).
//
//    `refFn(g, cyc) -> Float64(N)` supplies the controller field: a 0/1 mask (op:'mask') or a reference
//    PATTERN (op:'product'/'conj', e.g. the letter-A field whose occurrences we want to find/recall).
//    controller must expose a carrier so the bound result is demod-separable from co-resident modalities.

// flatten a target soliton's content into a complex field in PURE JS (sum depth layers in its region),
// with a GPU scratch-buffer fallback if it doesn't expose layers. NO per-substep GPU loop (that froze §).
function _flattenTarget(target, gpu, g, cyc, totalSteps) {
  const N = g.G * g.G, tgt = new Float64Array(2 * N);
  if (target.layersFn && target.imgRegion) {
    const layers = target.layersFn() || [], r = target.imgRegion;
    for (const f of layers) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
      const k = (y * g.G + x) * 2; tgt[k] += f[k]; tgt[k + 1] += f[k + 1];
    }
  } else {
    const shared0 = gpu.readEyePsi();
    gpu.setEyePsi(tgt); target.inject(gpu, g, cyc, 0, totalSteps);
    tgt.set(gpu.readEyePsi()); gpu.setEyePsi(shared0);
  }
  return tgt;
}

// THE PRIMITIVE. controller TRANSFORMS/PROBES target via [H], result on the controller's carrier.
function bind(controller, target, { op = 'mask', readout = 'field', refFn, kind = 'bind' } = {}) {
  const carrier = controller.carrier || controller.region();
  if (!carrier || carrier.kind !== 'carrier')
    console.warn(`[soliton-algebra] bind(): controller has no carrier subspace — the bound result can't be demodulated cleanly.`);
  return {
    kind,
    region: () => carrier,
    nBins: controller.nBins ?? target.nBins,
    carrier, op, readoutMode: readout, controller, target,
    // inject ONCE at the entry plane: form (target [op] controller-field) in JS, embed on the carrier, ADD.
    inject(gpu, g, cyc, barLocalStep, totalSteps) {
      if (barLocalStep !== 0) return;
      const N = g.G * g.G;
      const tgt = _flattenTarget(target, gpu, g, cyc, totalSteps);
      const ref = refFn(g, cyc);                    // 0/1 mask OR a reference pattern field (real per-cell)
      // controller field on the carrier: r·e^{ik·x} (mask) or pattern·e^{ik·x} (product/conj).
      const pc = new Float64Array(2 * N); carrier.embed(pc, ref, g.G);
      const shared = gpu.readEyePsi();
      for (let i = 0; i < N; i++) {
        const tr = tgt[i*2], ti = tgt[i*2+1];
        let br = pc[i*2], bi = pc[i*2+1];
        if (op === 'conj') bi = -bi;                // ψ_target · conj(controller) — matched filter
        // 'mask' and 'product' are the same pointwise product; they differ only in what `ref` IS (selector
        // vs pattern) and in the readout. 'conj' flips the controller's imaginary sign before multiplying.
        shared[i*2]   += (tr*br - ti*bi);
        shared[i*2+1] += (tr*bi + ti*br);
      }
      gpu.setEyePsi(shared);
    },
    // readout: demod the carrier → then field / map / recall.
    readout(g, recon, _cyc) {
      const demod = carrier.extract(recon, g.G);    // Re(bound·e^{-ik·x}) — the bound result, gathered
      const G = g.G, N = G * G;
      if (readout === 'map' || readout === 'recall') {
        // RECOGNITION map: |demod| normalized to [0,1] — bright where the reference correlates (occurs).
        let mx = 0; for (let i = 0; i < N; i++) { const v = Math.abs(demod[i]); if (v > mx) mx = v; }
        const map = new Float64Array(N); const inv = 1 / Math.max(1e-12, mx);
        for (let i = 0; i < N; i++) map[i] = Math.abs(demod[i]) * inv;
        if (readout === 'recall') {
          // RECALL: locate the peak cell; the engine/caller maps it back to a stored pattern id (future).
          let pk = 0, pi = 0; for (let i = 0; i < N; i++) if (map[i] > pk) { pk = map[i]; pi = i; }
          return { kind, field: demod, map, peak: { idx: pi, x: pi % G, y: (pi / G) | 0, val: mx } };
        }
        return { kind, field: demod, map };          // recognition
      }
      return { kind, field: demod, controllerKind: controller.kind, targetKind: target.kind };  // 'field' — transformed target (gate)
    },
  };
}

// ── REGION-BIND (§7.53, TEMPORAL/carrier-free) — the phase-native form of bind() for the limit-cycle scene.
//    UNIFORM ISOLATION: under evalSolitonTemporalAt each combinator runs ALONE in its bar phase, so the carrier
//    (whose only job was to demod the bound result out of a SHARED grid) is unnecessary. The binding still FUSES
//    its inputs (forms target·controller in JS — binding requires co-presence of the operands), but the result
//    is written DIRECTLY into the real channel and read back DIRECTLY (no e^{ikx} embed, no demod) — exactly the
//    regionEventSoliton pattern applied to the operator. So: inputs fuse inside the bind (one phase), the OUTPUT
//    is one modality on the clock, no grid-mixing, one isolation mechanism (the phase). Same op/readout faces.
function regionBind(controller, target, { op = 'mask', readout = 'field', refFn, kind = 'bind' } = {}) {
  return {
    kind,
    region: () => ({ kind: 'region', x0: 0, y0: 0, x1: 1, y1: 1, depth: 0 }),   // identity region (alone in phase)
    nBins: controller.nBins ?? target.nBins,
    op, readoutMode: readout, controller, target,
    inject(gpu, g, cyc, barLocalStep, totalSteps) {
      if (barLocalStep !== 0) return;
      const N = g.G * g.G;
      const tgt = _flattenTarget(target, gpu, g, cyc, totalSteps);   // target field (fused operand) in scratch
      const ref = refFn(g, cyc);                                     // mask/pattern, real per-cell
      const shared = gpu.readEyePsi();
      for (let i = 0; i < N; i++) {
        const tr = tgt[i*2], ti = tgt[i*2+1], r = ref[i] || 0;
        // bind by the REAL ref directly (no carrier phase): mask/product = ψ_target·r; conj flips target's sign.
        if (op === 'conj') { shared[i*2] += tr*r; shared[i*2+1] += -ti*r; }
        else               { shared[i*2] += tr*r; shared[i*2+1] +=  ti*r; }
      }
      gpu.setEyePsi(shared);
    },
    // read the bound result DIRECTLY from the phase field (alone in its phase → no demod needed).
    readout(g, recon, _cyc) {
      const G = g.G, N = G * G, field = new Float64Array(N);
      for (let i = 0; i < N; i++) field[i] = recon[i*2];             // real channel = the bound result
      if (readout === 'map' || readout === 'recall') {
        let mx = 0; for (let i = 0; i < N; i++) { const v = Math.abs(field[i]); if (v > mx) mx = v; }
        const map = new Float64Array(N), inv = 1/Math.max(1e-12, mx);
        for (let i = 0; i < N; i++) map[i] = Math.abs(field[i]) * inv;
        if (readout === 'recall') { let pk=0, pi=0; for (let i=0;i<N;i++) if (map[i]>pk){pk=map[i];pi=i;}
          return { kind, field, map, peak: { idx: pi, x: pi%G, y: (pi/G)|0, val: mx } }; }
        return { kind, field, map };
      }
      return { kind, field, controllerKind: controller.kind, targetKind: target.kind };
    },
  };
}

// ── WRAPPERS — the three faces of bind(), each a closed Soliton combinator (§9 instruction set):
// GATE (§7.33, proven): controller mask TRANSFORMS the target — "target where the mask passes." kind:'gate'.
// `temporal:true` → phase-native (§7.53 regionBind, carrier-free, for evalSolitonTemporalAt); default = carrier.
function gate(controller, target, maskFn, { temporal = false } = {}) {
  const mk = temporal ? regionBind : bind;
  return mk(controller, target, { op: 'mask', readout: 'field', refFn: maskFn, kind: 'gate' });
}
// RECOGNIZE-PURE: the PURE single-scale matched-filter combinator — a REFERENCE pattern probes the target via
// op:'conj' (ψ_scene·conj(ψ_ref)) → a correlation MAP, bright where the reference OCCURS, at ONE fixed scale.
// Pure soliton algebra (no _eye, no GPU scale-search, no distractor subtraction) → SINGLE-SCALE only; preserved
// for future use, NOT the live recognizer. The FULL recognizer (scale-search + discriminative subtraction) is
// `recognizeFull` below. kind:'recog'. `temporal:true` → phase-native (§7.53). refPatternFn(g,cyc)->Float64(N).
function recognizePure(controller, target, refPatternFn, { temporal = false } = {}) {
  const mk = temporal ? regionBind : bind;
  return mk(controller, target, { op: 'conj', readout: 'map', refFn: refPatternFn, kind: 'recog' });
}

// RECOGNIZE-FULL (§7.54): the FULL live recognizer as a CLOSED combinator — scale-search (§7.38) + discriminative
// distractor subtraction, which a single conj-product (recognizePure) can't do. It is inherently app-coupled (it
// runs the IFSEye GPU recognizers), so it's a FACTORY: the app injects its dependencies, keeping this module
// import-free. Returns a phase-native {kind:'recog', inject, readout} soliton (carrier-free, its own clock phase,
// uniform §7.53). The binding/recognition CAPABILITY (GPU scale-search) lives in the injected `score` fn, called
// inside readout on the node's own phase recon — so the recognizer is a true scene node, not app-side procedural.
//   deps: { target, score }
//     target : the image soliton to recognize within (exposes layersFn + imgRegion; injected into the phase).
//     score(sceneReal, g) -> { map?, hits?, presence?, ... } : the app's GPU recognizer (closes over _eye, refFn,
//       distractFns, slots, kind, tuning). Receives the node's phase recon (real channel) → returns the result
//       the overlay consumes. Pure-shape combinator; the impurity (GPU/app) is confined to the injected `score`.
function recognizeFull({ target, score }) {
  const region = target.imgRegion || (target.region && target.region()) || { kind:'region', x0:0, y0:0, x1:1, y1:1, depth:0 };
  return {
    kind: 'recog', region: () => region, layersFn: target.layersFn, imgRegion: region,
    inject(gpu, g, cyc, barLocalStep, totalSteps) { target.inject(gpu, g, cyc, barLocalStep, totalSteps); },
    // readout: hand the node's own phase recon to the injected app scorer; carry both the raw field and result.
    readout(g, recon, cyc, clean) {
      const N = g.G * g.G, field = new Float64Array(N);
      for (let i = 0; i < N; i++) field[i] = recon[i*2];
      const result = score ? score(field, g, recon, cyc, clean) : null;
      return { kind: 'recog', field, result };
    },
  };
}
// RECALL: a noisy/partial CUE probes a stored superposition → peak-select the matched stored pattern. op:'conj'.
// `temporal:true` → phase-native (§7.53, carrier-free).
function recall(controller, memory, cueFn, { temporal = false } = {}) {
  const mk = temporal ? regionBind : bind;
  return mk(controller, memory, { op: 'conj', readout: 'recall', refFn: cueFn, kind: 'recall' });
}
// ── OPERATOR SOLITON (§9, self-hosting — the constructive answer to Q2). The rank measurement (§selfHostGate)
//    showed a binding RULE is a rank-K bilinear tensor, so one field can't be it — but a RANK-K STACK can. This
//    reifies a binding operator AS a soliton-valued object: K triples (U_r, V_r, W_r) of fields such that
//      apply(a, b)[k] = Σ_r W_r[k] · (U_r·a) · (V_r·b)
//    This IS the algebra hosting its own rule: the operator is now a value in the same domain (a stack of
//    solitons), applicable like any soliton. `triples`: [{U,V,W}] each Float64(N). Closed under the type — an
//    operatorSoliton can itself be a target/controller of bind, gate, etc. K=rank (fidelity rises with K, exact
//    per §selfHostGate: rank-1≈9%, rank-N=100% of a general operator).
function operatorSoliton(triples, { name = 'operator' } = {}) {
  return {
    kind: 'operator', name, triples, rank: triples.length,
    // apply the reified operator to two input fields → output field (the binding it encodes).
    apply(a, b) {
      const N = a.length, out = new Float64Array(N);
      for (const { U, V, W } of triples) {
        let ua = 0, vb = 0; for (let i = 0; i < N; i++) { ua += U[i] * a[i]; vb += V[i] * b[i]; }
        const c = ua * vb; for (let k = 0; k < N; k++) out[k] += W[k] * c;
      }
      return out;
    },
  };
}

// ── OPERATOR Ψ(cyc) — the CLOCK-PURE / LIMIT-CYCLE form of an operatorSoliton (§9, "algebra as a Limit Cycle").
//    Measured result (live, GPU): a rank-K operator does NOT compress into one SPATIAL field (carriers/sparse/
//    wavelet all cap ~0.41 — dense ranks coexisting at one instant crosstalk). But TIME has the capacity: walk
//    the K rank-1 triples across K sub-ticks of the shared IFS clock — rank r alone at tick r → NO crosstalk →
//    temporal-mux reproduces the operator EXACTLY (1.000 through the medium, all K). The K lives on the clock
//    axis (DoF = N_space × K_time, conserved — not cheated). Crucially this makes the operator the SAME KIND of
//    thing as the objects: a pure function of `cyc`, hence peer-synced by construction (peer A and B at the same
//    cyc both select rank `cyc mod K` → identical field). The operator is now one soliton — one object cycling
//    in time — not a static spatial stack. `rankAt(cyc)` = which rank is live; `fieldAt(cyc)` = that rank's
//    carrier field (W_r, the output direction it emits this tick); `applyCyc(a,b,cyc0)` integrates one full bar
//    (K ticks from cyc0) = the complete binding, identical to operatorSoliton.apply. Closed under the type.
function operatorSolitonCyc(triples, { name = 'operatorΨ' } = {}) {
  const K = triples.length, N = triples[0] ? triples[0].W.length : 0;
  const rankAt = (cyc) => ((cyc % K) + K) % K;                 // which singular triple is live this tick
  return {
    kind: 'operatorCyc', name, triples, rank: K, period: K,
    rankAt,
    // the operator's own field at cyc: the live rank's output carrier W_r (what it emits this sub-tick). Pure in cyc.
    fieldAt(cyc) { return triples[rankAt(cyc)].W; },
    // ONE-TICK action: contribute only the live rank's rank-1 term (U_r·a)(V_r·b)·W_r. Peer-synced (pure in cyc).
    applyTick(a, b, cyc) {
      const { U, V, W } = triples[rankAt(cyc)]; let ua = 0, vb = 0;
      for (let i = 0; i < N; i++) { ua += U[i] * a[i]; vb += V[i] * b[i]; }
      const c = ua * vb, out = new Float64Array(N); for (let k = 0; k < N; k++) out[k] = W[k] * c; return out;
    },
    // FULL binding: integrate the limit cycle over one bar (K ticks starting at cyc0). Σ_tick applyTick = apply.
    applyCyc(a, b, cyc0 = 0) {
      const out = new Float64Array(N);
      for (let t = 0; t < K; t++) { const term = this.applyTick(a, b, cyc0 + t); for (let k = 0; k < N; k++) out[k] += term[k]; }
      return out;
    },
    // collapse back to the static stack (for spatial use / comparison): identical operator, K-field form.
    toStack() { return operatorSoliton(triples, { name: name + '·stack' }); },
  };
}

// Build a rank-K operatorSoliton EXACTLY from the target's bilinear tensor via truncated SVD — NOT a flaky
// random-search fit (that produced flat-zero artifacts: the optimizer was too weak AND the product a·b is
// actually HIGH rank = δ_ijk). The exact construction: tensorFn must expose its tensor T[k][i][j] (the rule).
// Mode-(i,j)→k unfolding A (n × n²); top-K singular triples give the best rank-K operator: U_r,V_r recovered
// from the right singular vector (reshaped n×n, its dominant left/right vectors), W_r the left singular vector.
// This is the constructive, EXACT self-hosting: the rule reified as K soliton-triples, optimal at each K.
function fitOperatorSoliton(tensorFn, { N = 16, K = 8 } = {}) {
  // tensorFn(): returns T as T[k] = Float64(N*N) (the (i,j) slice for output k). The "rule" as data.
  // K is a BUDGET of rank-1 bilinear triples {U,V,W} — exactly what operatorSoliton.apply sums. Two corrections
  // over the naive version: (1) each tensor mode's reshaped right-singular matrix Rm is generally NOT rank-1, so
  // we EXPAND it into as many rank-1 (U,V) sub-triples as it needs (the naive "force rank-1" lost 18–35% per mode
  // → ~0.83 ceiling); (2) a σ-guard STOPS once the tensor's true singular values vanish (the naive version divided
  // by σ≈0 past the true rank → garbage triples → non-monotonic K-sweep dip). Result: faithful, monotonic in K.
  const T = tensorFn(N);                       // T[k][i*N+j]
  const A = T;                                 // mode-1 unfolding: rows k (N), cols (i,j) (N*N)
  const AAt=[]; for(let i=0;i<N;i++){ const r=new Float64Array(N); for(let j=0;j<N;j++){ let s=0; for(let p=0;p<N*N;p++) s+=A[i][p]*A[j][p]; r[j]=s; } AAt.push(r); }
  let rng=0x33333>>>0; const rand=()=>{rng=(rng*1664525+1013904223)>>>0;return rng/4294967296;};
  const mulN=(M,v)=>{const o=new Float64Array(N);for(let i=0;i<N;i++){let s=0;for(let j=0;j<N;j++)s+=M[i][j]*v[j];o[i]=s;}return o;};
  // dominant eigenpair of a symmetric N×N matrix M via power iteration → {vec, lam}.
  const dom=(M,iters)=>{let v=new Float64Array(N);for(let i=0;i<N;i++)v[i]=rand()-0.5;let lam=0;
    for(let it=0;it<iters;it++){const x=mulN(M,v);let nn=0;for(let i=0;i<N;i++)nn+=x[i]*x[i];nn=Math.sqrt(Math.max(1e-30,nn));for(let i=0;i<N;i++)v[i]=x[i]/nn;lam=nn;}
    return {vec:v,lam};};
  // overall scale guard: first tensor singular value sets the "significant" threshold.
  let M = AAt.map(r=>Float64Array.from(r));
  const first = dom(M, 300); const sig0 = Math.sqrt(Math.max(0, first.lam));
  const TOL = sig0 * 1e-4;                      // singular values below this are numerical zero → stop
  M = AAt.map(r=>Float64Array.from(r));         // reset (dom mutated nothing, but be explicit)
  const triples=[];
  outer:
  for (let r=0; r<N && triples.length<K; r++){
    const { vec:w, lam } = dom(M, 300);
    const sigma=Math.sqrt(Math.max(0,lam));
    if (sigma <= TOL) break;                    // σ-GUARD: past the true tensor rank → no more real modes
    // right singular vector rvec = Aᵀw / σ (length N²); reshape to N×N matrix Rm.
    const rvec=new Float64Array(N*N); for(let p=0;p<N*N;p++){ let s=0; for(let k=0;k<N;k++) s+=A[k][p]*w[k]; rvec[p]= s/sigma; }
    const Rm=[]; for(let i=0;i<N;i++){ const row=new Float64Array(N); for(let j=0;j<N;j++) row[j]=rvec[i*N+j]; Rm.push(row); }
    // EXPAND Rm into its own rank-1 sub-triples (U_s⊗V_s, value τ_s): peel the dominant one, deflate, repeat,
    // until Rm energy is exhausted or the K budget runs out. Each sub-triple is a true rank-1 bilinear term.
    for (let s=0; s<N && triples.length<K; s++){
      const RRt=[]; for(let i=0;i<N;i++){ const row=new Float64Array(N); for(let j=0;j<N;j++){ let acc=0; for(let q=0;q<N;q++) acc+=Rm[i][q]*Rm[j][q]; row[j]=acc; } RRt.push(row); }
      const { vec:U, lam:l2 } = dom(RRt, 150); const tau=Math.sqrt(Math.max(0,l2));
      if (tau <= TOL) break;                    // Rm exhausted for this mode → next tensor mode
      const V=new Float64Array(N); for(let j=0;j<N;j++){ let acc=0; for(let i=0;i<N;i++) acc+=Rm[i][j]*U[i]; V[j]= tau>1e-12 ? acc/tau : 0; }
      // fold σ (tensor mode) · τ (sub-mode) into W so apply() = σ·τ · w · (U·a)(V·b) reproduces this rank-1 term.
      const W=new Float64Array(N); for(let k=0;k<N;k++) W[k]=w[k]*sigma*tau;
      triples.push({ U, V, W });
      // deflate Rm by this rank-1 sub-mode (τ·U Vᵀ) so the next s finds the next sub-triple.
      for(let i=0;i<N;i++) for(let j=0;j<N;j++) Rm[i][j]-= tau*U[i]*V[j];
    }
    // deflate the tensor mode (σ²·w wᵀ) so the next r finds the next tensor singular triple.
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) M[i][j]-=lam*w[i]*w[j];
  }
  return operatorSoliton(triples, { name: `op-rank${triples.length}` });
}

// unite: superpose/region-mux children into ONE pure-cyc Soliton (closed → nests). Orthogonality check.
function unite(children, { name = 'united' } = {}) {
  for (let i = 0; i < children.length; i++)
    for (let j = i + 1; j < children.length; j++)
    {
      // basis-AGNOSTIC orthogonality check: coherence of the two solitons' SUBSPACES. SAME-basis
      // (region⨯region, carrier⨯carrier) is computable → warn on real overlap. CROSS-basis
      // (e.g. carrier-event ⨯ region-image) separability is MEASURED not predicted (§7.29: carrier
      // events vs region image separate when events are sparse) → don't false-alarm; note it once.
      const sa = children[i].region(), sb = children[j].region();
      const crossBasis = sa.kind !== sb.kind;
      const coh = subspaceCoherence(sa, sb);
      if (!crossBasis && coh > 0.05)
        console.warn(`[soliton-algebra] '${name}': ${children[i].kind} ⨯ ${children[j].kind} same-basis coherence ${coh.toFixed(2)} (>0) → read-back LEAKS ~that fraction. Separate via place()/atDepth().`);
      else if (crossBasis)
        console.info(`[soliton-algebra] '${name}': ${children[i].kind}(${sa.kind}) ⨯ ${children[j].kind}(${sb.kind}) cross-basis — separability is measured (§7.29: clean for SPARSE content), not predicted.`);
    }
  return {
    kind: 'united',
    children,
    region: () => children.reduce((acc, c) => { const r = c.region();
      return acc ? { x0:Math.min(acc.x0,r.x0), y0:Math.min(acc.y0,r.y0), x1:Math.max(acc.x1,r.x1), y1:Math.max(acc.y1,r.y1), depth:acc.depth } : r; }, null),
    trueCells: (cyc) => children.flatMap(c => c.trueCells ? c.trueCells(cyc) : []),
    inject(gpu, g, cyc, s, total) { for (const c of children) c.inject(gpu, g, cyc, s, total); },
    readout(g, recon, cyc, clean) { const out = {}; for (const c of children) out[c.kind] = c.readout(g, recon, cyc, clean); return out; },
  };
}

// ── TEMPORAL-MULTIPLEXED runtime (§7.44, "media as a limit cycle"): the SAME composite, but the modalities
//    are separated on the CLOCK axis instead of by carriers. Each child occupies a PHASE of the bar — at its
//    phase it is the ONLY modality in the field (no cross-modal coexistence → no carrier crosstalk; §7.44
//    measured this recovers DENSE modalities at ~1.0 where carriers leak to ~0.82). Per phase: inject that
//    child ALONE into a fresh field, propagate its phase window, snapshot; the child reads back from ITS OWN
//    phase snapshot. The "live field" returned (panel 1) is the CURRENT phase's field (what's on the clock
//    right now). Same return shape as evalSolitonAt → panels/audio/sliders unchanged. H-occlusion + τ apply
//    to each phase identically. The bar is divided into M = children.length equal phases.
function evalSolitonTemporalAt(eye, composite, cyc, opts = {}) {
  const gpu = eye._gpu, G = gpu._G, N = G * G, dt = eye.dt;
  const g = eye._unitedGeom(opts.geom);
  const barSteps = opts.barSteps ?? 40, K = opts.K ?? 3, readBars = opts.readBars ?? 1;
  const nBins = g.nBins, occludeR = opts.occludeR ?? 0, tau = opts.tau ?? 1.0;
  const children = composite.children || [composite];
  const M = children.length;
  const nowBar = Math.floor(cyc / nBins), readBar = Math.max(0, nowBar - readBars);
  // phase windows: split the bar's propagation budget into M equal slices (one per modality).
  const phaseSteps = Math.max(1, Math.round(barSteps / M));
  // which phase is live right now — drives the "limit cycle" feel if panel 1 follows it.
  const barLocal = ((cyc % nBins) + nBins) % nBins, livePhase = Math.min(M - 1, Math.floor(barLocal / Math.max(1, nBins / M)));
  // DISPLAY LOCK (visualisation only — does NOT change the architecture): which phase feeds panel 1 + its recon.
  //   opts.displayLock: 'live' = follow the cycling phase (panel 1 shows events→image→wave as the bar turns);
  //   or a modality KIND ('image'|'event'|'wave'|…) = lock panel 1 + recon to THAT phase (steady). Default 'live'
  //   (show the cycle). The limit cycle still RUNS in full regardless (every modality injected alone in its phase,
  //   read from its own phase snapshot) — only which phase we PAINT on panel 1 changes. Panels 2/3/4 always come
  //   from each modality's own phase. 'image' resolves to image/gate/recog/recall (the field-valued visual phase).
  const lockMode = opts.displayLock ?? 'live';
  const findKind = (want) => {
    if (want === 'image') return children.findIndex(c => c.kind === 'image' || c.kind === 'gate' || c.kind === 'recog' || c.kind === 'recall');
    return children.findIndex(c => c.kind === want);
  };
  let panelPhase = livePhase;
  if (lockMode !== 'live') { const idx = findKind(lockMode); if (idx >= 0) panelPhase = idx; }
  const panelChild = children[panelPhase];
  const panelBack = Math.max(1, Math.round(phaseSteps * (1 + tau)));
  const D = Math.max(1, Math.round(opts.reconT ?? phaseSteps));

  // run ONE child alone through its phase window → return its matured field (clock-pure: injected at the
  // read bar's start, propagated phaseSteps). Each child injects at barLocalStep 0..phaseSteps as it expects.
  const runPhaseAlone = (child, atBar) => {
    const barCyc = atBar * nBins;
    gpu.setEyePsi(new Float64Array(2 * N));
    for (let s = 0; s <= phaseSteps; s++) { child.inject(gpu, g, barCyc, s, phaseSteps); if (s < phaseSteps) gpu.stepEyeN(1, dt); }
    return gpu.readEyePsi();
  };

  // PANEL-1 field = the panel phase's modality (locked to image by default, or the live phase if displayLock:'live').
  // When following 'live', mature to the current sub-step (the cycle is visibly turning); when locked, mature the
  // chosen phase fully (steady hologram). Either way this is ONE modality alone — never a superposition.
  {
    const barCyc = nowBar * nBins;
    const curSteps = (lockMode === 'live') ? Math.min(phaseSteps, Math.max(0, (cyc - barCyc))) : phaseSteps;
    gpu.setEyePsi(new Float64Array(2 * N));
    for (let s = 0; s <= curSteps; s++) { panelChild.inject(gpu, g, barCyc, s, phaseSteps); if (s < curSteps) gpu.stepEyeN(1, dt); }
  }
  const field = gpu.readEyePsi();
  gpu.setEyePsi(field);
  if (occludeR > 0) gpu.applyEyeHologram(eye.hMode || 7, occludeR, { block: eye.hBlock ?? 8, seed: eye.hSeed ?? 0 });
  const holoMasked = gpu.readEyePsi();
  gpu.stepEyeN(panelBack, -dt);
  const viewTau = gpu.readEyePsi();

  // READOUTS: each child read from ITS OWN phase snapshot (matured + H + back-prop D), at the READ bar.
  // imageRecon = the IMAGE/visual phase's refocused recon — captured here so RECOGNITION can always read the
  // image phase regardless of which phase panel 1 is locked to (recog needs the image, not events/wave).
  const readouts = {}; let clean = {}; let imageRecon = viewTau;
  for (const c of children) {
    const phaseField = runPhaseAlone(c, readBar);
    // clean reference (no occlusion) for this child's phase
    gpu.setEyePsi(phaseField); gpu.stepEyeN(D, -dt); const cleanRecon = gpu.readEyePsi();
    if (c.cleanEnergy) Object.assign(clean, c.cleanEnergy(g, cleanRecon, readBar * nBins));
    else if (c.trueCells) for (const ev of c.trueCells(readBar * nBins)) { let m = 0; for (const cc of g.evFoot(ev.tier, ev.bin)) { const v = cleanRecon[cc*2]**2 + cleanRecon[cc*2+1]**2; if (v > m) m = v; } clean[ev.tier+':'+ev.bin] = Math.max(1e-12, m); }
    // occluded recon for this child's phase
    gpu.setEyePsi(phaseField);
    if (occludeR > 0) gpu.applyEyeHologram(eye.hMode || 7, occludeR, { block: eye.hBlock ?? 8, seed: eye.hSeed ?? 0 });
    const fieldValued = (c.kind === 'image' || c.kind === 'gate' || c.kind === 'recog' || c.kind === 'recall');
    if (fieldValued) { gpu.stepEyeN(panelBack, -dt); const rec = gpu.readEyePsi(); imageRecon = rec; readouts[c.kind] = c.readout(g, rec, readBar * nBins, clean); }
    else { gpu.stepEyeN(D, -dt); readouts[c.kind] = c.readout(g, gpu.readEyePsi(), readBar * nBins, clean); }
  }
  gpu.setEyePsi(field);   // restore the live-phase field as the eye buffer
  const curAge = Math.max(0, (cyc - nowBar * nBins)), readAge = readBars * barSteps + curAge;
  return { field, holoMasked, viewTau, imageRecon, readouts, readBar, readAge, curAge, nowBar, livePhase, panelPhase, panelKind: panelChild.kind, nPhases: M, temporal: true, nTiers: g.nTiers, nBins: g.nBins };
}

// ── CARRIER CROSS-TALK MEASUREMENT (§7.29) — THE decisive test for region-free interleaved
//    composition. Embed N test patterns on N orthogonal carriers into ONE shared field, run the IFS
//    round-trip (forward T → optional H → back T — the actual united-field path), demodulate each by
//    its carrier, and build the LEAKAGE MATRIX L[i][j] = corr(recovered_i, content_j). DIAGONAL high
//    (each modality recovers itself) + OFF-DIAGONAL ~0 (no bleed) ⇒ carriers are a real orthogonal
//    basis UNDER the IFS medium → region-free united composition works. Off-diagonal high ⇒ the
//    ring-kernel mixes carriers (not free-space) → carrier basis fails here. Can FAIL (that's the point).
//    eye: IFSEye (gpu, tSteps, dt, hMode/hParam). carriers: [makeCarrier,...]. patternsFn(i,G)->Float64(N).
function measureCarrierCrosstalk(eye, carriers, patternsFn, { T = null, occludeR = 0 } = {}) {
  const gpu = eye._gpu, G = gpu._G, N = G * G, dt = eye.dt, D = Math.max(1, Math.round(T ?? eye.tSteps));
  const corr = (a, b) => { let n=0,da=0,db=0; for (let i=0;i<a.length;i++){ n+=a[i]*b[i]; da+=a[i]*a[i]; db+=b[i]*b[i]; } return (da>0&&db>0)? n/Math.sqrt(da*db) : 0; };
  const patterns = carriers.map((_, i) => patternsFn(i, G));
  // EMBED all modalities on their carriers into ONE field, fully overlapping every cell.
  const psi = new Float64Array(2 * N);
  carriers.forEach((c, i) => c.embed(psi, patterns[i], G));
  // IFS round-trip through the united field: forward → (H) → back.
  gpu.setEyePsi(psi); gpu.stepEyeN(D, dt);
  if (occludeR > 0) gpu.applyEyeHologram(eye.hMode || 7, occludeR, { block: eye.hBlock ?? 8, seed: eye.hSeed ?? 0 });
  gpu.stepEyeN(D, -dt);
  const recon = gpu.readEyePsi();
  // DEMODULATE each carrier → recovered modality; leakage matrix vs every true pattern.
  const recovered = carriers.map(c => c.extract(recon, G));
  const rows = [`[CARRIER CROSS-TALK] ${carriers.length} modalities, one field, T=${D}${occludeR>0?` occl ${occludeR}`:''}. L[i][j]=corr(recover_i, true_j):`,
    '         ' + carriers.map((_,j)=>('m'+j).padStart(8)).join('')];
  let offMax = 0;
  for (let i = 0; i < carriers.length; i++) {
    let line = '  recov '+i+' ';
    for (let j = 0; j < carriers.length; j++) { const v = corr(recovered[i], patterns[j]); line += v.toFixed(2).padStart(8); if (i!==j) offMax = Math.max(offMax, Math.abs(v)); }
    rows.push(line);
  }
  rows.push(`  → DIAGONAL≈1 (self-recovery) + OFF-DIAGONAL≈0 (here max ${offMax.toFixed(2)}) = carriers ORTHOGONAL`);
  rows.push('    under the IFS medium → region-free interleaved composition works. off-diag high = kernel mixes carriers.');
  console.log(rows.join('\n'));
  return rows;
}

export { makeRegion, makeCarrier, makeBand, makeDepthBand, subspaceCoherence, regionsOverlap,
         regionEventSoliton, regionWaveSoliton, defaultWaveCells, imageSoliton, place, atDepth,
         bind, regionBind, gate, recognizePure, recognizeFull, recall, operatorSoliton, operatorSolitonCyc, fitOperatorSoliton, unite, evalSolitonTemporalAt, measureCarrierCrosstalk };
// CARRIER path (eventSoliton, carrierEventSoliton, carrierWaveSoliton, evalSolitonAt) moved to
// soliton-algebra-research.js (§7.44/§7.47: the live app is temporal; carriers are the non-live original).
