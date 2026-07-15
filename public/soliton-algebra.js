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
    // EMBED / EXTRACT — §7.101 these ARE linOp/linDemod (proven byte-identical, nlhoUnifyAllProbe d=0). The carrier
    // is just linOp with this carrier's fixed k. ψ[c] += m·e^{i(kx·x+ky·y)} embed; m̂ = Re(ψ·e^{-i k·r}) extract.
    embed(psi, content, G)  { return linOp(psi, content, this.kx, this.ky, G); },
    extract(psi, G)         { return linDemod(psi, G, this.kx, this.ky); },
  };
}
// ── §7.101 THE UNIFYING PRIMITIVE: linOp — the medium's ONE spatial operator. ────────────────────
// MEASURED (nlhoUnifyProbe, corr 1.000000): the multimedia CARRIER (makeCarrier.embed) and the §7.100g
// θ-operator are the SAME operation — content·e^{i·k·r}. linOp(psi, content, kx, ky, G) IS that operation,
// in place on a field. The carrier k selects the ROLE:
//   • STORAGE / separation : fixed k (a storage angle) → the holographic carrier basis (image, carrier-mux).
//   • TRANSFORM            : content-dependent k → θ-rotation (k ⟂ tilt), image-shift, spectral filter, …
//   • k=0 (the degenerate) : content lands DIRECTLY in the real channel (e^{i·0}=1) = the carrier-FREE
//                            region/temporal-mux injection (regionEventSoliton / regionWaveSoliton / image).
// So linOp is a strict SUPERSET of makeCarrier.embed AND the direct region/image placement — proven below
// (nlhoUnifyAllProbe) to reproduce each byte-identically. IFS-native + holographically correct by construction:
// it IS the carrier basis (§7.29/§7.44), applied through stepEyeN propagation + complex-moment/demod readout.
// §7.101c content may be REAL (Float64[N], default) or COMPLEX (Float64[2N], interleaved re,im — pass complexIn:true).
// COMPLEX content closes the IMAGE case: an image IS content·e^{i·k·r} with COMPLEX content (a pre-modulated wavefront
// slice), k=0 → ψ += content directly = the image add. So image is NOT excluded — it's the complex-content case of the
// SAME operator. Real fast-path is the exact original arithmetic (byte-identical to §7.101b — real paths unchanged).
// §7.101d SPACETIME carrier: opts.phaseT = ω·t — a TEMPORAL carrier phase added to the spatial k·r, so the operator
// is content·e^{i·(k·x + ω·t)}. phaseT=0 (default) → spatial-only (byte-identical to §7.101c). A NONZERO phaseT is the
// CLOCK-GATE folded into the operator: time/depth is just another carrier axis (the makeDepthBand basis, §5.2c/§7.25).
// k=0 + phaseT≠0 = pure temporal separation (the image depth-stacking as a smooth ω-carrier vs the old hard time-delta).
// §7.102 PHASE GENERALIZATION (the new-eye lens joins the operator family). The phase φ generalizes from the LINEAR
// carrier k·r to a GENERAL field — adding the QUADRATIC genome-lens phase: about the NEAREST of `lensCenters` (px),
// φ += a·(dx²+dy²) [FOCUS] + β·dx·dy [SHEAR, the genome θ] + vtx·atan2(dy,dx) [VORTEX]. So linOp spans:
//   • linear k·r            → carrier / storage / θ-shift  (§7.101, proven, byte-identical when no lens opts)
//   • + quadratic a·r²+βxy  → the §7.98 GENOME LENS (focus/shear) — the new-eye optical chip, now a linOp member.
// MODE: 'add' (default) = embed content (the carrier). 'mul' = multiply the existing ψ by e^{iφ} (the TRANSFORM form —
// the lens, with content = ψ itself). One operator content·e^{iφ}, φ linear…quadratic, mode add…mul.
function linOp(psi, content, kx, ky, G, opts = {}) {
  const { complexIn = false, phaseT = 0, x0 = 0, y0 = 0, x1 = G, y1 = G,
          mode = 'add', lensCenters = null, lensA = 0, lensBeta = 0, lensVtx = 0 } = opts;
  const hasLens = lensCenters && lensCenters.length >= 2 && (lensA || lensBeta || lensVtx);
  const linearZero = (kx === 0 && ky === 0 && phaseT === 0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * G + x;
    let re, im;
    if (mode === 'mul') { re = psi[i*2]; im = psi[i*2+1]; if (re === 0 && im === 0) continue; }   // transform-on-self: content = ψ
    else if (complexIn) { re = content[i*2]; im = content[i*2+1]; if (re === 0 && im === 0) continue; }
    else                { const m = content[i]; if (!m) continue; re = m; im = 0; }
    // φ = linear k·r + ωt + (optional) the genome-lens QUADRATIC phase about the nearest center.
    let ph = kx*x + ky*y + phaseT;
    if (hasLens) {
      let bcx = lensCenters[0], bcy = lensCenters[1], bd = Infinity;
      for (let k = 0; k < lensCenters.length; k += 2) { const ddx = x - lensCenters[k], ddy = y - lensCenters[k+1], d = ddx*ddx + ddy*ddy; if (d < bd) { bd = d; bcx = lensCenters[k]; bcy = lensCenters[k+1]; } }
      const dx = x - bcx, dy = y - bcy;
      ph += lensA*(dx*dx + dy*dy) + lensBeta*dx*dy + (lensVtx ? lensVtx*Math.atan2(dy, dx) : 0);
    }
    if (linearZero && !hasLens && mode !== 'mul') { psi[i*2] += re; psi[i*2+1] += im; }   // fully degenerate ADD: §7.101c byte-identical path
    else { const c = Math.cos(ph), s = Math.sin(ph);   // content·e^{iφ}
      const vr = re*c - im*s, vi = re*s + im*c;
      if (mode === 'mul') { psi[i*2] = vr; psi[i*2+1] = vi; }   // overwrite (multiply ψ by e^{iφ})
      else { psi[i*2] += vr; psi[i*2+1] += vi; } }              // add (embed)
  }
  return psi;
}
// linDemod — the read inverse. complexOut=false (default): m̂ = Re(ψ·e^{-i·k·r}) → Float64[N] (the original carrier/
// region read, byte-identical). complexOut=true: full ψ·e^{-i·k·r} → Float64[2N] (re,im) for IMAGE (k=0 → ψ itself).
function linDemod(psi, G, kx = 0, ky = 0, opts = {}) {
  const { complexOut = false, phaseT = 0, x0 = 0, y0 = 0, x1 = G, y1 = G } = opts;   // §7.101d phaseT = ω·t temporal demod (matches linOp's spacetime carrier)
  const out = new Float64Array(complexOut ? 2 * G * G : G * G);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * G + x, re = psi[i*2], im = psi[i*2+1];
    if (kx === 0 && ky === 0 && phaseT === 0) { if (complexOut) { out[i*2] = re; out[i*2+1] = im; } else out[i] = re; }
    else { const ph = kx*x + ky*y + phaseT, c = Math.cos(ph), s = Math.sin(ph);   // ψ·e^{-i·(k·r+ωt)}: (re+i·im)(c−i·s)
      if (complexOut) { out[i*2] = re*c + im*s; out[i*2+1] = im*c - re*s; } else out[i] = re*c + im*s; }
  }
  return out;
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
      // §7.101 k=0 linOp: build the content (1.0 at each note footprint cell) then linOp(content,0,0) = direct
      // real-channel placement (byte-identical to the old loop, nlhoUnifyAllProbe d=0). The temporal-mux carrier-free
      // injection IS linOp with k=0 — the same primitive as the carrier, degenerate.
      const G = g.G, content = new Float64Array(G * G);
      for (const ev of melodyFn(barOf(cyc))) for (const c of g.evFoot(ev.tier, ev.bin)) content[c] += 1.0;
      linOp(psi, content, 0, 0, G);
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
    // §7.56 masked-Ψ-pure calibration: the clean reference is ANALYTIC — the injected amplitude itself
    // (1.0 per footprint cell → energy 1.0), knowable from the CLOCK alone. Valid for the matched-age
    // temporal read (the unitary round-trip recovers the injection exactly, §7.45) — replaces the
    // unmasked runPhaseAlone replay, so the readout uses NOTHING but the masked field + the clock.
    analyticClean(g, cyc) { const out = {};
      for (const ev of melodyFn(barOf(cyc))) out['c:' + ev.tier + ':' + ev.bin] = 1.0;
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
      // §7.101 k=0 linOp (direct real-channel amplitudes) — same primitive, degenerate carrier.
      const G = g.G, content = new Float64Array(G * G);
      for (let h = 0; h < H; h++) content[cs[h]] += amps[h];
      linOp(psi, content, 0, 0, G);
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
    // §7.56 masked-Ψ-pure calibration (see regionEventSoliton): clean ref = the injected amplitude, from
    // the clock alone — no unmasked replay.
    analyticClean(g, cyc) { const amps = harmonicsFn(barOf(cyc)), H = amps.length, out = {};
      for (let h = 0; h < H; h++) out['w:' + h] = (Math.abs(amps[h]) > 1e-9 ? amps[h] : 1e-9);
      return out;
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
      const layers = layersFn(cyc); if (!layers || !layers.length) return;   // cyc passed → layer stacks may be clock-functions (§7.57)
      const nL = layers.length;
      for (let d = 0; d < nL; d++) {
        if (Math.round(totalSteps * (nL - 1 - d) / nL) !== barLocalStep) continue;  // far early, near late
        // §7.101c image = COMPLEX content, k=0 → linOp(f, 0, 0, complexIn) = the direct complex-field add (byte-
        // identical to the old loop). The IMAGE is the complex-content case of the ONE operator content·e^{i·k·r};
        // the depth/clock layer-stacking (this per-step gate) is the temporal complement sequencing the slices.
        const f = layers[d], psi = gpu.readEyePsi();
        linOp(psi, f, 0, 0, g.G, { complexIn: true, x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 });
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
    const layers = target.layersFn(cyc) || [], r = target.imgRegion;   // cyc-aware (§7.57 echo layers)
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
// ── GEOMETRY SOLITON (the deferred §finding_scratch_vs_one_world step — geometry joins the limit cycle).
//    The NLHO genome ({s,θ,tx,ty}×K) is a modality just like events/wave/image: it lives FULL-GRID at its OWN
//    bar PHASE on the SHARED persistent soliton (temporal-mux, carrier-free, k=0 — "alone in phase"), NOT on a
//    private eye-field round-trip and NOT surgically placed into a co-resident frame (which would spend the
//    orthogonality budget and DEGRADE). Inject = the genome's generator-events (the K fixed-point impulses +
//    θ/s satellites, §7.88r/t); readout = peak-detect those impulses back out at the matched age and invert to
//    a rule-set (§7.88u, the autocatalytic read). Both are GPU/grid-coupled and app-tuned, so — like
//    recognizeFull — this is a FACTORY: the app injects its genome inject/read closures, keeping this module
//    import-free. `rulesFn(cyc) -> [{s,theta,tx,ty}]` is the current genome (a clock-function — the live
//    evolve writes it per bar). `genInject(field, rules)` paints the generator into a complex field (real chan).
//    `genRead(recon, K)` recovers a rule-set from a phase recon. The result rides the shared transport; the
//    §7.100d θ-walk and §7.101 operators then act IN this phase instead of in a scratch field.
// ── PROBE-OBJECT LIBRARY (core, reusable) — pure JS generators of test wavefronts to shine through an operator/lens.
//    Each writes into a COMPLEX field f (Float64[2·G·G]) within a region {x0,y0,side}. Registry `probeObjects` maps a
//    name → generator(f, G, region, opts). Used by the lens example (and reusable anywhere). App-coupled objects (the
//    3D cube, the genome's own attractor) are NOT here — they need GPU/genome closures; pass them as extra generators.
//    opts: { np: # sources (ring/grid), amp }. depthscene carries per-shape DEPTH PHASE (focuses per-depth on propagation).
const probeObjects = {
  ring(f, G, { x0, y0, side }, { np = 8 } = {}) {
    const cx = x0+side/2, cy = y0+side/2, R = side*0.32;
    for (let k=0;k<np;k++){ const a=2*Math.PI*k/np; _pdot(f,G,cx+R*Math.cos(a),cy+R*Math.sin(a),0.9); }
  },
  point(f, G, { x0, y0, side }) { _pdot(f,G,x0+side/2,y0+side/2,1.0); },
  pair(f, G, { x0, y0, side }) { const cx=x0+side/2, cy=y0+side/2, R=side*0.32; _pdot(f,G,cx-R*0.6,cy,0.9); _pdot(f,G,cx+R*0.6,cy,0.9); },
  grid(f, G, { x0, y0, side }, { np = 8 } = {}) { const n=Math.max(2,Math.round(Math.sqrt(np)));
    for(let i=0;i<n;i++)for(let j=0;j<n;j++) _pdot(f,G,x0+side*(i+0.5)/n,y0+side*(j+0.5)/n,0.8); },
  cross(f, G, { x0, y0, side }) { const cx=x0+side/2, cy=y0+side/2, R=side*0.32; for(let t=-R;t<=R;t++){ _pdot(f,G,cx+t,cy,0.85); _pdot(f,G,cx,cy+t,0.85); } },
  blob(f, G, { x0, y0, side }) { const cx=x0+side/2, cy=y0+side/2, sg=side*0.16;
    for(let yy=-side/3;yy<=side/3;yy++)for(let xx=-side/3;xx<=side/3;xx++){ const w=Math.exp(-(xx*xx+yy*yy)/(2*sg*sg));
      if(w>0.05){const X=Math.round(cx+xx),Y=Math.round(cy+yy);if(X>=0&&X<G&&Y>=0&&Y<G)f[(Y*G+X)*2]+=w;} } },
  letterA(f, G, { x0, y0, side }) {   // apex at LARGER y so the GPU Y-flip renders it right-side-up
    const cx=x0+side/2, cy=y0+side/2, h=side*0.5, top=[cx,cy+h/2], bl=[cx-h*0.4,cy-h/2], br=[cx+h*0.4,cy-h/2];
    const line=(p,q)=>{const st=Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1]));for(let s=0;s<=st;s++){const u=s/st;_pdot(f,G,p[0]+(q[0]-p[0])*u,p[1]+(q[1]-p[1])*u,0.8);}};
    line(top,bl); line(top,br); line([cx-h*0.2,cy],[cx+h*0.2,cy]); },
  depthscene(f, G, { x0, y0, side }) {   // □ near / ○ mid / △ far at separate positions+depths → sliceable on propagation
    const R=Math.round(side*0.13);
    const shape=(cxs,cys,depth,kind)=>{ const ph=depth*1.9;
      for (let dy=-R;dy<=R;dy++) for (let dx=-R;dx<=R;dx++){ let inside=false;
        if (kind==='square') inside = Math.abs(dx)<=R && Math.abs(dy)<=R;
        else if (kind==='circle') inside = dx*dx+dy*dy <= R*R;
        else if (kind==='triangle') inside = (dy>=-R*0.6)&&(dy<=R*0.8)&&(Math.abs(dx)<=(R*0.8)*(R*0.8-dy)/(R*1.4));
        if(!inside)continue; const X=Math.round(cxs)+dx, Y=Math.round(cys)+dy; if(X<0||X>=G||Y<0||Y>=G)continue;
        const i=(Y*G+X)*2; f[i]+=0.9*Math.cos(ph); f[i+1]+=0.9*Math.sin(ph); } };
    shape(x0+side*0.25, y0+side*0.72, 0, 'square'); shape(x0+side*0.72, y0+side*0.50, 1, 'circle'); shape(x0+side*0.28, y0+side*0.25, 2, 'triangle'); },
};
// names in display order (cube/attractor are app-injected, appended by the app).
const PROBE_OBJECT_NAMES = ['ring','point','pair','grid','cross','blob','letterA','depthscene'];
// 3×3 anti-aliased dot into the REAL channel (shared by the generators above).
function _pdot(f, G, px, py, a) { for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ const X=Math.round(px)+dx, Y=Math.round(py)+dy;
  if(X>=0&&X<G&&Y>=0&&Y<G){ const w=(dx||dy)?a*0.45:a, i=(Y*G+X)*2; if(w>Math.abs(f[i])) f[i]=w; } } }
// build a probe object's field. name → generator (core or app-extra); returns Float64[2·G·G].
function makeProbeField(name, G, region, opts = {}, extra = {}) {
  const f = new Float64Array(2*G*G);
  const gen = (extra && extra[name]) || probeObjects[name] || probeObjects.ring;
  gen(f, G, region, opts);
  return f;
}

function geometrySoliton({ rulesFn, genInject, genRead, K = null, nBins }) {
  const Kof = (cyc) => K ?? (rulesFn(cyc) || []).length;
  return {
    kind: 'geometry',
    region: () => ({ kind: 'region', x0: 0, y0: 0, x1: 1, y1: 1, depth: 0 }),   // identity region (alone in phase)
    nBins,
    rulesFn,
    // inject ONCE at the entry plane (barLocalStep 0): the genome's generator-events into the shared field's
    // real channel — exactly the regionEventSoliton pattern (k=0, full grid), but the "events" are the
    // operator's OWN code (fixed-point impulses), so this phase carries the GEOMETRY, not notes/timbre.
    inject(gpu, g, cyc, barLocalStep) {
      if (barLocalStep !== 0) return;
      const rules = rulesFn(cyc); if (!rules || !rules.length) return;
      const psi = gpu.readEyePsi();
      genInject(psi, rules);                 // app closure paints the generator into psi (real chan, same footprint as echo)
      gpu.setEyePsi(psi);
    },
    // readout at the matched-age phase recon: peak-detect the generator back out → recovered rule-set + a
    // round-trip fidelity vs the true genome (mean fixed-point position error, §7.88r MEASURE).
    readout(g, recon, cyc) {
      const rules = rulesFn(cyc) || [], k = Kof(cyc);
      const recovered = genRead(recon, k) || [];
      // fidelity: fraction of maps recovered (the §7.88r/u read drops maps it can't resolve under transport).
      const f1 = rules.length ? Math.min(recovered.length, rules.length) / rules.length : 0;
      return { kind: 'geometry', recovered, trueRules: rules, f1 };
    },
  };
}

// ── OPERATOR MODALITY (the generalization: a wavefront operator that transforms a SPECIFIC modality FROM unite).
//    This is regionBind made universal across modalities and reconciled with temporal-mux. It does NOT transform
//    "the unite field" (no such simultaneous frame exists — unite is a SCHEDULE, not a field); it ADDRESSES one
//    target modality BY ITS PHASE (via _flattenTarget — materialize target's field at its bar phase), applies a
//    FIELD-NATIVE transform (xform: the soliton equation — linOp / IFS round-trip / the [H] product — NO JS
//    arithmetic, NO texture resample), and writes the result into THIS operator's own phase (alone, carrier-free).
//    So an operator is the SAME KIND of citizen as content: an entry in the unite schedule, scheduled next to the
//    modalities it acts on. Over a full cycle it can transform every modality in turn — sequentially, lossless —
//    which is the ONLY honest "transform the whole world" (simultaneity stays a process, never a frozen object).
//      target : the modality soliton to transform (image/event/wave/geometry — exposes inject or layers).
//      xform(field, gpu, g, cyc) -> field' : the FIELD operator, run on target's materialized field. May call
//        gpu.stepEyeN / gpu.linOp etc. — the substrate, not host arithmetic. Returns the transformed complex field.
//      readFn(recon, g, cyc) -> result (optional) : how to read this operator's phase back; default = the raw field.
//    `kind` tags the operator (e.g. 'thetaOp', 'spacetimeOp') so panels can find its phase.
function operatorModality(target, xform, { kind = 'operatorMod', nBins, readFn = null } = {}) {
  return {
    kind,
    region: () => ({ kind: 'region', x0: 0, y0: 0, x1: 1, y1: 1, depth: 0 }),   // identity region (alone in phase)
    nBins: nBins ?? target.nBins,
    target,
    inject(gpu, g, cyc, barLocalStep, totalSteps) {
      if (barLocalStep !== 0) return;
      // ADDRESS the target by its phase: materialize its field (its layers, or inject-into-scratch) — the same
      // _flattenTarget that bind() uses. This is "pull THIS modality out of the unite schedule", phase-addressed.
      // capture THIS phase's accumulator BEFORE the xform — xform may use the GPU field as its own scratch (e.g. the
      // time-soliton runs T propagating stepEyeN on it), so reading `shared` afterward would mix in that scratch +
      // double-count an out that is itself the left-over field. Snapshot first → out is added to the true accumulator.
      const shared = gpu.readEyePsi();
      const tgt = _flattenTarget(target, gpu, g, cyc, totalSteps);
      // TRANSFORM in the field (the substrate operator), then write the result into this operator's own phase.
      const out = xform(tgt, gpu, g, cyc) || tgt;
      for (let i = 0; i < out.length; i++) shared[i] += out[i];   // superpose onto this phase (alone → no crosstalk)
      gpu.setEyePsi(shared);
    },
    readout(g, recon, cyc) {
      const N = g.G * g.G, field = new Float64Array(N);
      for (let i = 0; i < N; i++) field[i] = recon[i*2];
      const result = readFn ? readFn(recon, g, cyc) : null;
      return { kind, field, targetKind: target.kind, result };
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

const _uniteWarned = new Set();   // throttle the per-pair coherence warning to once (unite runs every frame)
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
      // throttle: unite() runs every render frame — warn ONCE per unique (scene, pair), not per frame (console spam).
      const _wk = `${name}|${children[i].kind}⨯${children[j].kind}`;
      if (!_uniteWarned.has(_wk)) {
        _uniteWarned.add(_wk);
        if (!crossBasis && coh > 0.05)
          console.warn(`[soliton-algebra] '${name}': ${children[i].kind} ⨯ ${children[j].kind} same-basis coherence ${coh.toFixed(2)} (>0) → read-back LEAKS ~that fraction. Separate via place()/atDepth(). (warned once)`);
        else if (crossBasis)
          console.info(`[soliton-algebra] '${name}': ${children[i].kind}(${sa.kind}) ⨯ ${children[j].kind}(${sb.kind}) cross-basis — separability is measured (§7.29: clean for SPARSE content), not predicted.`);
      }
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
    const fieldValued = (c.kind === 'image' || c.kind === 'gate' || c.kind === 'recog' || c.kind === 'recall' || c.kind === 'lensOp' || c.kind === 'thetaOp' || c.kind === 'timeOp' || c.kind === 'probe');
    if (fieldValued) { gpu.stepEyeN(panelBack, -dt); const rec = gpu.readEyePsi(); imageRecon = rec; readouts[c.kind] = c.readout(g, rec, readBar * nBins, clean); }
    else { gpu.stepEyeN(D, -dt); readouts[c.kind] = c.readout(g, gpu.readEyePsi(), readBar * nBins, clean); }
  }
  gpu.setEyePsi(field);   // restore the live-phase field as the eye buffer
  const curAge = Math.max(0, (cyc - nowBar * nBins)), readAge = readBars * barSteps + curAge;
  return { field, holoMasked, viewTau, imageRecon, readouts, readBar, readAge, curAge, nowBar, livePhase, panelPhase, panelKind: panelChild.kind, nPhases: M, temporal: true, nTiers: g.nTiers, nBins: g.nBins };
}

// ── PERSISTENT TEMPORAL runtime (§7.55, the "frameless fix"): the SAME limit-cycle scene as
//    evalSolitonTemporalAt, but the field is OPEN-ENDED STATEFUL — ONE travelling wavefront that is never
//    rebuilt. The rebuild engine re-seeds zero and replays each phase from scratch (pure in cyc, but
//    frame-like at bar granularity — contradicting the frameless thesis of native-ifs-solitons.md §7.2);
//    here every injection ACCUMULATES into the persistent field and propagates indefinitely. Isolation
//    changes axis: a phase is no longer "alone in the field" (instant occupancy) but "alone at its matched
//    refocus AGE" — linearity+unitarity mean back-propagating the travelling field by exactly
//    (state − injection) steps refocuses THAT phase sharply while every other phase defocuses to diffuse
//    background (the §7.22 unified-read move, applied to phases). THE COMPLIANCE RULES:
//      • PHASE: children inject only inside their phase window (unchanged); reads only by matched-age
//        back-prop, the age a pure function of cyc.
//      • BAR: exactly ONE non-unitary op per bar — ψ *= λ at the bar boundary (clock-keyed level
//        restoration). It bounds float drift, sets the wash-out half-life of old bars (ln2/ln(1/λ) bars),
//        and — being a UNIFORM scalar — commutes with the linear propagator: refocus shape is exact and
//        amplitude is compensated analytically (λ^−agedBars) at read time. Applied in JS doubles, so the
//        one non-unitary op is CPU-deterministic across peers.
//      • SYNC: purity becomes purity-MODULO-JOIN — state init (and lag catch-up) replays only the last
//        (readBars+1) bars from zero, so two peers' fields agree on everything inside the read window
//        after that many bars (the same bounded-impurity contract the §7.22 carrier engine accepts).
//    Clean references stay ISOLATED replays (runPhaseAlone): the INSTRUMENT may replay; the MEDIUM never
//    rebuilds — that distinction is what resolves the frameless contradiction honestly. State lives on
//    eye._travelSol, advanced in PHASE QUANTA (gp = bar·M + phase = #completed phases); the intra-phase
//    partial maturation is derived per render for display only. displayLock is ignored: panel 1 shows the
//    one true travelling field (that is the point of the mode). Cross-phase contamination is the measured
//    price — probe with persistVsRebuild (eye.js ⟲ PERSIST Alt-click) before trusting dense readouts.
function evalSolitonTemporalLiveAt(eye, composite, cyc, opts = {}) {
  const gpu = eye._gpu, G = gpu._G, N = G * G, dt = eye.dt;
  const g = eye._unitedGeom(opts.geom);
  const barSteps = opts.barSteps ?? 40, readBars = opts.readBars ?? 1;
  const nBins = g.nBins, occludeR = opts.occludeR ?? 0, tau = opts.tau ?? 1.0;
  const decay = opts.persistDecay ?? 0.85;            // λ — per-bar level restoration (1 = no decay)
  const children = composite.children || [composite];
  const M = children.length;
  const phaseSteps = Math.max(1, Math.round(barSteps / M));
  // NOTE: opts.reconT is deliberately NOT consumed here — all calibrated reads land MATCHED (see the
  // readout loop); only τ offsets the image recon. recT remains a display dial for the rebuild engine.
  const nowBar = Math.floor(cyc / nBins), readBar = Math.max(0, nowBar - readBars);
  const barLocal = ((cyc % nBins) + nBins) % nBins;
  const phaseLenCyc = Math.max(1, nBins / M);
  const livePhase = Math.min(M - 1, Math.floor(barLocal / phaseLenCyc));

  // §7.60 NONLINEAR DECISION PHASE (bootstrap step 2): opts.nlKick = {gamma, th, w} applies the unitary
  // intensity-thresholded phase kick ONCE per bar, at the bar boundary (after λ, before the new bar's
  // injections) — the dedicated nonlinear instant. Everywhere else the medium stays exactly linear, so
  // all §7.32–7.45 exactness results hold in the transport/binding phases. Off by default.
  const nlk = opts.nlKick ?? null;
  // §7.78 OCCLUDER IN THE TRANSIT: opts.occlTransit = {mode, r, block, seed} applies the H-occluder to
  // the PERSISTENT field once per bar at the boundary (with λ and the kick) — the travelling hologram
  // repeatedly passes THROUGH the obstacle instead of being masked only at read time. Part of the
  // state's law → part of sKey (a dial change re-keys the state → deterministic deep re-derivation).
  const otr = opts.occlTransit ?? null;

  // ── THE STATE: one travelling field, advanced in phase quanta. gp counts COMPLETED phases since cyc 0.
  const sKey = (opts.stateKey ?? '') + `|${G}|${M}|${phaseSteps}|${nBins}|${decay}` +
               (nlk ? `|nl${nlk.gamma},${nlk.th},${nlk.w}` : '') +
               (otr && otr.r > 0 ? `|ot${otr.mode},${otr.r},${otr.block ?? 8}` : '');
  const targetGp = nowBar * M + livePhase;            // phases fully elapsed at this cyc
  // catch-up / init replay window, in BARS. Default covers the read window; §7.66 evolution passes a DEEP
  // window (≳ the field's λ-memory) so a stalled peer's re-init reconstructs the field to sub-margin
  // accuracy before replaying its missed generations (virtual-time discipline — late means replayed).
  const windowGp = M * Math.max(readBars + 1, (opts.catchupBars ?? 0));
  let st = eye._travelSol;
  if (!st || st.key !== sKey || st.gp > targetGp || targetGp - st.gp > windowGp + 2 * M) {
    // (re)init — late join, params changed, clock went backward, or viewer lagged past the window:
    // start from zero at the window edge and replay forward. This IS the late-joiner convergence path.
    st = eye._travelSol = { key: sKey, gp: Math.max(0, targetGp - windowGp), psi: new Float64Array(2 * N) };
    // §7.79b hygiene: a re-key (dial/law change) invalidates lens snapshots taken under the old law —
    // drop them so nothing downstream sees a stale-keyed bar.
    if (eye._lensBars) for (const [k, v] of eye._lensBars) if (v.key !== sKey) eye._lensBars.delete(k);
  }
  // ── ADVANCE across every phase boundary crossed since the last call. Each completed phase: (decay at
  //    bar start) → inject that phase's child ALONE into the PERSISTENT field → propagate phaseSteps.
  //    Identical inner loop to the rebuild engine — the only change is the starting field is the state.
  if (st.gp < targetGp) {
    gpu.setEyePsi(st.psi);
    for (let gp = st.gp; gp < targetGp; gp++) {
      const b = (gp / M) | 0, p = gp % M, barCyc = b * nBins;
      if (p === 0 && decay < 1) {                     // bar boundary: the ONE non-unitary op (in JS doubles)
        const f = gpu.readEyePsi(); for (let i = 0; i < f.length; i++) f[i] *= decay; gpu.setEyePsi(f);
      }
      if (p === 0 && nlk) gpu.applyEyeNlKick(nlk.gamma, nlk.th, nlk.w);   // §7.60: the nonlinear instant
      if (p === 0 && otr && otr.r > 0)                                    // §7.78: through the obstacle, once per bar
        gpu.applyEyeHologram(otr.mode, otr.r, { block: otr.block ?? 8, seed: otr.seed ?? 0 });
      if (p === 0 && opts.lensKeep === true) {
        // §7.77/§7.79b CONJUGATE-LENS SNAPSHOT — taken at the bar boundary AFTER the boundary ops
        // (λ, kick, obstacle): the field as the medium will actually CARRY it into bar b. Phase-quanta
        // time → frame-free; keyed by sKey so a lens read can never mismatch the law. Post-ops matters:
        // a pre-ops snapshot is dominated by freshly injected (not-yet-occluded) content, so the raw
        // verdict measured injection gain and could never sense the obstacle.
        const snapPsi = gpu.readEyePsi();
        (eye._lensBars ??= new Map()).set(b, { key: sKey, gp, psi: snapPsi });
        if (eye._lensBars.size > 12) eye._lensBars.delete(Math.min(...eye._lensBars.keys()));
        gpu.setEyePsi(snapPsi);                       // restore the GPU buffer after the readback
        // (prune may delete the just-set bar when a re-init replays from the window edge — never
        // dereference the map after pruning)
      }
      const child = children[p];
      for (let s = 0; s <= phaseSteps; s++) { child.inject(gpu, g, barCyc, s, phaseSteps); if (s < phaseSteps) gpu.stepEyeN(1, dt); }
    }
    st.psi = gpu.readEyePsi(); st.gp = targetGp;
  }

  // ── PANEL-1 field = the travelling field + the current phase matured to the live sub-step (display-only
  //    derivation on top of the state; the state itself only ever advances in whole phases).
  const phaseFrac = Math.min(1, Math.max(0, (barLocal - livePhase * phaseLenCyc) / phaseLenCyc));
  const curSteps = Math.min(phaseSteps, Math.round(phaseFrac * phaseSteps));
  gpu.setEyePsi(st.psi);
  { const barCyc = nowBar * nBins, lc = children[livePhase];
    for (let s = 0; s <= curSteps; s++) { lc.inject(gpu, g, barCyc, s, phaseSteps); if (s < curSteps) gpu.stepEyeN(1, dt); } }
  const field = gpu.readEyePsi();
  gpu.setEyePsi(field);
  if (occludeR > 0) gpu.applyEyeHologram(eye.hMode || 7, occludeR, { block: eye.hBlock ?? 8, seed: eye.hSeed ?? 0 });
  const holoMasked = gpu.readEyePsi();
  const panelBack = Math.max(1, Math.round(phaseSteps * (1 + tau)));
  gpu.stepEyeN(panelBack, -dt);                       // genuine rack-focus through the multi-bar hologram
  const viewTau = gpu.readEyePsi();

  // clean reference = ISOLATED replay (the instrument; unchanged from the rebuild engine) — used only when
  // analyticClean is OFF or a child has no analytic calibration.
  const runPhaseAlone = (child, atBar) => {
    const barCyc = atBar * nBins;
    gpu.setEyePsi(new Float64Array(2 * N));
    for (let s = 0; s <= phaseSteps; s++) { child.inject(gpu, g, barCyc, s, phaseSteps); if (s < phaseSteps) gpu.stepEyeN(1, dt); }
    return gpu.readEyePsi();
  };
  // §7.56 masked-Ψ-pure readout: with analyticClean the ratio gates calibrate against the INJECTED
  // amplitudes (child.analyticClean — clock-derived constants; valid because the matched-age read in the
  // unitary medium recovers the injection exactly, §7.45). Then the readout consumes NOTHING but the one
  // masked snapshot + the clock — no unmasked replay anywhere in the read path.
  const useAnalytic = opts.analyticClean ?? false;

  // ── READOUTS from the TRAVELLING field: ONE masked snapshot (H applied once — the field as a single
  //    damaged object, like a physical plate) → per child: back-prop by its matched age → λ-compensate →
  //    readout. ageSteps lands exactly at the child's injection epoch in readBar (same landing point as
  //    the rebuild engine's matured-phase back-prop); `extra` reproduces the rebuild τ / reconT offsets.
  let maskedState = st.psi;
  if (occludeR > 0) {
    gpu.setEyePsi(st.psi);
    gpu.applyEyeHologram(opts.hMode ?? (eye.hMode || 7), occludeR, { block: eye.hBlock ?? 8, seed: eye.hSeed ?? 0 });
    maskedState = gpu.readEyePsi();
  }
  // λ decays APPLIED since the read bar's injections = bar-start boundaries actually PROCESSED in (inj, state]:
  // bar b's decay fires at gp b·M, processed iff targetGp > b·M — so at a bar start (livePhase=0) the new
  // bar's λ has NOT hit yet. (Off-by-one caught by the mock-GPU harness: comp overshot λ^−1 at bar starts.)
  const agedBars = Math.max(0, (nowBar - readBar) - 1 + (livePhase > 0 ? 1 : 0));
  const comp = decay < 1 ? Math.pow(decay, -agedBars) : 1;
  const readouts = {}; let clean = {}; let imageRecon = viewTau;
  for (let q = 0; q < M; q++) {
    const c = children[q];
    if (useAnalytic && c.analyticClean) Object.assign(clean, c.analyticClean(g, readBar * nBins));
    else if (c.cleanEnergy || c.trueCells) {
      const phaseField = runPhaseAlone(c, readBar);
      gpu.setEyePsi(phaseField); gpu.stepEyeN(phaseSteps, -dt); const cleanRecon = gpu.readEyePsi();   // matched landing, like the reads
      if (c.cleanEnergy) Object.assign(clean, c.cleanEnergy(g, cleanRecon, readBar * nBins));
      else for (const ev of c.trueCells(readBar * nBins)) { let m = 0; for (const cc of g.evFoot(ev.tier, ev.bin)) { const v = cleanRecon[cc*2]**2 + cleanRecon[cc*2+1]**2; if (v > m) m = v; } clean[ev.tier+':'+ev.bin] = Math.max(1e-12, m); }
    }
    const ageSteps = (targetGp - (readBar * M + q)) * phaseSteps;   // back to phase q's injection epoch @ readBar
    const fieldValued = (c.kind === 'image' || c.kind === 'gate' || c.kind === 'recog' || c.kind === 'recall' || c.kind === 'lensOp' || c.kind === 'thetaOp' || c.kind === 'timeOp' || c.kind === 'probe');
    // RATIO-GATED reads (events/wave) always land MATCHED (extra=0): the analytic calibration is the injected
    // amplitude, valid only at the matched epoch (§7.45). reconT/τ are DISPLAY dials — they offset the image
    // recon (rack focus) but must not move the calibrated reads. (The rebuild engine tolerated D≠phaseSteps
    // only because its replay clean ref was EQUALLY mis-landed and the ratio canceled — analytic refs don't
    // get that accidental cancellation, so high T made events/notes vanish until this pin. Fixed.)
    const extra = fieldValued ? Math.round(phaseSteps * tau) : 0;
    // ── THE EYE = A LENS STACK (the unifying abstraction). "Looking" = applying an ORDERED STACK of reconstruction
    // operators (lenses) to the masked travelling field, then reading the focal result: ψ → op1 → op2 → … → read.
    // depthRecon (the matched-age back-prop) is ONE lens — the old eye is the stack [depthRecon]. The genome geometry
    // is another lens. Every stack/order = a different EYE. A modality declares c.readOps = [op,…]; absent → the
    // default single-lens stack [depthRecon], byte-identical to the original hardcoded two lines. Each op(gpu, ctx)
    // transforms whatever is on the GPU; the FIRST op seeds from maskedState (ctx.seed materializes it).
    // depthRecon = the matched-age back-prop. As a STACK op it operates on the CURRENT GPU field (so it can follow
    // another lens); standalone it self-seeds from maskedState (the runner seeds first, so both paths are correct).
    const depthRecon = (gp) => { gp.stepEyeN(Math.max(1, ageSteps + extra), -dt); };
    const backProp = (gp) => { gp.setEyePsi(maskedState); depthRecon(gp); };   // old-eye single-lens (self-seeding), back-compat
    const opCtx = { maskedState, ageSteps, extra, dt, g, phaseSteps, readBar, nBins, backProp, depthRecon };
    const stack = c.readOps || (c.readOp ? null : [depthRecon]);      // readOps = a lens stack; default = [depthRecon] (old eye)
    if (stack) { gpu.setEyePsi(maskedState); for (const op of stack) op(gpu, opCtx); }   // seed ONCE, then ψ → op1 → op2 → …
    else c.readOp(gpu, opCtx);                                        // legacy single readOp (self-manages seeding)
    const rec = gpu.readEyePsi();
    if (comp !== 1) for (let i = 0; i < rec.length; i++) rec[i] *= comp;
    if (fieldValued) imageRecon = rec;
    readouts[c.kind] = c.readout(g, rec, readBar * nBins, clean);
  }
  gpu.setEyePsi(field);                               // restore the displayed field as the eye buffer
  const curAge = Math.max(0, (cyc - nowBar * nBins)), readAge = readBars * barSteps + curAge;
  return { field, holoMasked, viewTau, imageRecon, readouts, readBar, readAge, curAge, nowBar, livePhase,
           panelPhase: livePhase, panelKind: 'travel', nPhases: M, temporal: true, persist: true,
           stateGp: st.gp, nTiers: g.nTiers, nBins: g.nBins };
}

// §7.56 STANDING-LESION instrument: damage the PERSISTENT state ITSELF — a lesion in the medium, not in a
// read-time snapshot. The physically truer occlusion: the read-time mask damages a *photograph* of the
// field; this damages the field, which then keeps propagating. Unitarity says information removed by the
// mask is GONE — later propagation cannot restore it — so the measurable quantity is not "healing over
// time" but the DELOCALIZATION TIMESCALE: content lesioned right after injection (still concentrated) is
// destroyed; content lesioned after it has spread survives like the read-time mask. The lesion-age sweep
// (eye.js, Shift-click ⟲ PERSIST) measures how many phases of propagation it takes for content to become
// holographically protected. Probe-only — mutates eye._travelSol.psi in place via the eye's H machinery.
function lesionTravellingField(eye, occludeR, opts = {}) {
  const st = eye._travelSol; if (!st) return false;
  const gpu = eye._gpu;
  gpu.setEyePsi(st.psi);
  gpu.applyEyeHologram(opts.hMode ?? eye.hMode ?? 7, occludeR, { block: opts.block ?? eye.hBlock ?? 8, seed: opts.seed ?? eye.hSeed ?? 0 });
  st.psi = gpu.readEyePsi();
  return true;
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// §7.98–7.103 THE META-CIRCULAR MEDIUM — extracted operator library (the latest-work: linOp genome lens + gauge split,
//   the world/eye lens stack, world-object self-coevolve, eye replica/recall/coevolve/optics). Faithful copy from
//   apps/eye.js, parameterized by G (grid) so it's reusable + demo-agnostic. Drives medium.js (the minimal demo).
//   The recon = depthRecon = stepEyeN(-dt) (real wave back-prop, ifs-gpu split-step Schrödinger). The lens = linOp.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// ── NLHO GENOME ENCODING (§7.88r/t) — the genome {s,θ,tx,ty}ᴷ as position-coded impulses in a generator region, and
//    the read-back. Pure functions of (G) — peer-pure (f(rules) only). ─────────────────────────────────────────
const NLHO_SAT_PX = 9, NLHO_R_MIN = 3, NLHO_R_MAX = 9;   // satellite radius range (s↔radius); SAT_PX sets bbox padding
function nlhoGenRegion(G) { const side = Math.min(G - 4, Math.max(20, Math.round(G * 0.35) - 4)); return { x0: G - side - 3, y0: 2, side }; }
function nlhoFixedPointFit(rules, G) {
  const side = nlhoGenRegion(G).side, pad = Math.max(0.06, (NLHO_SAT_PX + 1.5) / (side - 1));
  const fps = rules.map(m => { const d = Math.max(1e-3, 1 - m.s); return { fx: m.tx / d, fy: m.ty / d, s: m.s }; });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of fps) { minX = Math.min(minX, p.fx); minY = Math.min(minY, p.fy); maxX = Math.max(maxX, p.fx); maxY = Math.max(maxY, p.fy); }
  const span = Math.max(1e-3, maxX - minX, maxY - minY), sc = (1 - 2 * pad) / span;
  return { fps, minX, minY, sc, pad };
}
// inject the rule-set's generator into `field` (packed complex): per map a bright MAIN (amp∝1−s = s) + a θ-satellite.
function nlhoGenInject(field, rules, G) {
  const { x0, y0, side } = nlhoGenRegion(G), fit = nlhoFixedPointFit(rules, G);
  const blob = (cx, cy, a) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = cx + dx, Y = cy + dy; if (X < 0 || X >= G || Y < 0 || Y >= G) continue;
    const w = (dx === 0 && dy === 0) ? 1 : 0.45, idx = (Y * G + X) * 2;
    if (a * w > Math.abs(field[idx])) field[idx] = a * w; } };
  for (let i = 0; i < fit.fps.length; i++) {
    const m = fit.fps[i], theta = rules[i].theta || 0;
    const ux = fit.pad + (m.fx - fit.minX) * fit.sc, uy = fit.pad + (m.fy - fit.minY) * fit.sc;
    const cx = x0 + Math.round(ux * (side - 1)), cy = y0 + Math.round(uy * (side - 1));
    blob(cx, cy, 0.30 + 0.6 * (1 - m.s));                               // main amp ∝ 1−s (s on the main, refocuses clean)
    const r = NLHO_R_MIN + 2;
    blob(cx + Math.round(r * Math.cos(theta)), cy + Math.round(r * Math.sin(theta)), 0.45);   // θ-satellite (fixed radius)
  }
  return fit;
}
const _nlhoAToS = (v) => Math.max(0, Math.min(0.95, 1 - (v - 0.30) / 0.6));   // invert main-amp → s (§7.88t-B, identity-calibrated)
// peak-detect the generator back out → [{ux,uy,s,theta}]. Deterministic argmax (tie→lower-index). Inverse of inject.
function nlhoReadGenerator(field, K, G) {
  const { x0, y0, side } = nlhoGenRegion(G), amp = new Float64Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) { const idx = ((y0 + y) * G + (x0 + x)) * 2; amp[y * side + x] = Math.hypot(field[idx], field[idx + 1]); }
  const peaks = [], used = new Uint8Array(side * side), work = Float64Array.from(amp), PK_EPS = 1e-2;
  for (let k = 0; k < 2 * K; k++) {
    let bi = -1, bv = -Infinity;
    for (let i = 0; i < work.length; i++) { if (used[i]) continue; if (work[i] > bv + PK_EPS) { bv = work[i]; bi = i; } }
    if (bi < 0 || bv <= 1e-6) break;
    const px = bi % side, py = (bi / side) | 0; let sx = 0, sy = 0, sw = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = px + dx, qy = py + dy; if (qx < 0 || qx >= side || qy < 0 || qy >= side) continue; const w = amp[qy * side + qx]; sx += qx * w; sy += qy * w; sw += w; }
    peaks.push({ px: sw ? sx / sw : px, py: sw ? sy / sw : py, v: bv });
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = px + dx, qy = py + dy; if (qx >= 0 && qx < side && qy >= 0 && qy < side) used[qy * side + qx] = 1; }
  }
  peaks.sort((a, b) => b.v - a.v);
  const mains = peaks.slice(0, K), sats = peaks.slice(K), takenSat = new Uint8Array(sats.length), found = [];
  for (const mn of mains) {
    let bi = -1, bd = NLHO_R_MAX + 1.5;
    for (let i = 0; i < sats.length; i++) { if (takenSat[i]) continue; const dd = Math.hypot(sats[i].px - mn.px, sats[i].py - mn.py); if (dd >= NLHO_R_MIN - 1.5 && dd < bd) { bd = dd; bi = i; } }
    let theta = 0; if (bi >= 0) { takenSat[bi] = 1; theta = Math.atan2(sats[bi].py - mn.py, sats[bi].px - mn.px); if (theta < 0) theta += 2 * Math.PI; }
    found.push({ ux: mn.px / (side - 1), uy: mn.py / (side - 1), s: _nlhoAToS(mn.v), theta });
  }
  return found;
}
// growMapFromField(rules, field, G): the medium reads its own evolved code-field and, if an EMERGENT peak has formed AWAY from
// the existing fixed-point centres (strong + new), returns a NEW map {s,θ,tx,ty} born at that peak (else null). This is the §7.88
// writable-operator-atlas GROWTH: the genome adopts structure the medium itself produced — peer-pure (the peak is in `field`, the
// lensed code the medium just computed), no JS-invented map. The new map's params are READ from the peak (position → tx,ty via the
// fixed-point relation; amplitude → s; local gradient → θ), the inverse of nlhoGenInject — so it's a genuine read-back, not a guess.
function growMapFromField(rules, field, G, birth = 0.15) {
  const N = G * G, centers = genomeFpCenters(rules, G);
  // find the strongest cell that is NOT within MIN_SEP of any existing centre (an emergent, non-redundant peak). BIRTH is the
  // sensitivity (peak must clear birth·max): the IFS is CONTRACTIVE (energy clusters near centres), so emergent far structure is
  // weak — a low birth lets the genome adopt the satellites its dynamics/operators actually throw. MIN_SEP keeps it non-redundant.
  const MIN_SEP = Math.max(4, G / 12), BIRTH = birth;
  let mx = 1e-9; for (let i = 0; i < N; i++) { const a = Math.hypot(field[i*2], field[i*2+1]); if (a > mx) mx = a; }
  let bi = -1, bv = -1;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const a = Math.hypot(field[(y*G+x)*2], field[(y*G+x)*2+1]); if (a < bv) continue;
    let near = false; for (let c = 0; c < centers.length; c += 2) { if (Math.hypot(x - centers[c], y - centers[c+1]) < MIN_SEP) { near = true; break; } }
    if (!near && a > bv) { bv = a; bi = y * G + x; }
  }
  if (bi < 0 || bv < BIRTH * mx) return null;   // no emergent structure strong enough to birth a map
  const px = bi % G, py = (bi / G) | 0;
  // convert the peak (pixel) → a map. Position → normalized fixed point → tx,ty via fp = t/(1−s). θ from the local intensity
  // gradient (the satellite direction). s from the peak amplitude (brighter = lower s, like the inject's amp∝1−s).
  const s = Math.max(0.25, Math.min(0.7, 1 - bv / mx * 0.6));
  let gx = 0, gy = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X=px+dx, Y=py+dy; if(X<0||X>=G||Y<0||Y>=G) continue;
    const a = Math.hypot(field[(Y*G+X)*2], field[(Y*G+X)*2+1]); gx += dx * a; gy += dy * a; }
  const theta = (gx || gy) ? ((Math.atan2(gy, gx) + 2*Math.PI) % (2*Math.PI)) : 0;
  const fx = (px / (G - 1)), fy = (py / (G - 1)), d = 1 - s;   // normalized fixed point → tx,ty = fp·(1−s)
  return { s, theta, tx: fx * d, ty: fy * d, _life: 1, _born: true };
}

// the default genome bank (K ranks). FOUR / SPIN / TRI / DIAG.
function nlhoDefaultRules() { return [
  [{s:0.40,theta:0,tx:0.10,ty:0.10},{s:0.40,theta:0,tx:0.70,ty:0.10},{s:0.40,theta:0,tx:0.10,ty:0.70},{s:0.40,theta:0,tx:0.70,ty:0.70}],
  [{s:0.50,theta:0.6,tx:0.30,ty:0.30},{s:0.50,theta:2.0,tx:0.40,ty:0.50},{s:0.50,theta:4.0,tx:0.50,ty:0.30}],
  [{s:0.50,theta:0,tx:0.05,ty:0.05},{s:0.50,theta:0,tx:0.70,ty:0.05},{s:0.50,theta:0,tx:0.38,ty:0.70}],
  [{s:0.45,theta:0,tx:0.10,ty:0.10},{s:0.45,theta:0,tx:0.70,ty:0.70}],
]; }

// the RESONANCE bank — genomes that are GENUINELY DISTINCT in their PHASE SIGNATURE, so the geometry-sees-geometry resonance
// discriminates on the genome's OWN geometry (not a synthetic overlay; the default bank is phase-degenerate, 3/4 ranks θ=0). The
// phase a lens imprints is dominated by WHERE its fixed-point centres sit (the focus term a·r² about each centre). So a
// position-distinct genome → a position-distinct phase pattern → a grid-robust resonance signature. Each rank places its K
// centres in a different ARRANGEMENT (the "note" is the spatial pattern, which the phase encodes), plus a distinct θ/s.
function nlhoResonanceRules() {
  // distinct fixed-point ARRANGEMENTS with LOW mutual overlap (the discrimination = how little two patterns' centres coincide).
  // Measured contrast on this set: the matching key recovers ~100%, mismatches 6–72% (clean discrimination; nearby shapes like
  // the diamond/diagonal partially co-resonate — honest, like two similar-shaped rooms amplifying a similar note).
  const layouts = [
    [[0.20,0.20],[0.80,0.20],[0.20,0.80],[0.80,0.80]],   // rank 0 — wide SQUARE (corners)
    [[0.50,0.20],[0.22,0.72],[0.78,0.72]],               // rank 1 — TRIANGLE (apex up, centre offset)
    [[0.50,0.25],[0.30,0.55],[0.70,0.55],[0.50,0.85]],   // rank 2 — DIAMOND (tall)
    [[0.20,0.50],[0.50,0.20],[0.80,0.50],[0.50,0.80]],   // rank 3 — DIAMOND (wide, rotated 45° from r2)
  ];
  // each rank's NOTE (aggregate θ) is a clean value WITHIN the θ-slider range [−π, π], evenly spaced so the user can dial to it:
  // notes = [−2.4, −0.8, 0.8, 2.4]. All K maps share the rank's θ (so the aggregate IS that note — no spread that pushes it out of
  // range). The SPATIAL layout still distinguishes the shape; θ is the tunable note. s varies for a focus-distinct signature.
  const notes = [-2.4, -0.8, 0.8, 2.4];
  return layouts.map((pts, r) => {
    const th = notes[r], s = 0.42 + 0.06 * r;
    return pts.map(([tx, ty]) => ({ s, theta: th, tx, ty }));
  });
}

// ── §7.98/7.102/7.103 THE GENOME LENS = linOp (gauge/dynamics split + sub-pixel seam). Returns the lens prescription
//    (centers from the genome fixed points) + the GPU operator. P = { sMul, thAdd, tx, ty, propT, opMode, fullGrid }.
//    opMode: 'phase' (pure linOp e^{iφ}) | 'metric' (affineEyeCenters resample) | 'gauge' (metric macro-translate +
//    phase micro focus/shear + sub-pixel phase tilt). The medium operates on the medium in its own terms.
// genomeAggregate(rules): the genome's CHARACTERISTIC geometry as a single {s, theta} — the dominant rotation (the map with the
// largest |θ|) and the mean contraction. ONE definition shared by the lens internals AND the UI seed, so they agree (the seed
// shows what the lens applies). map[0] alone is often trivial; the aggregate captures the genome's real character.
function genomeAggregate(rules) {
  if (!rules || !rules.length) return { s: 0.5, theta: 0 };
  let thMax = 0, sSum = 0;
  for (const m of rules) { if (Math.abs(m.theta || 0) > Math.abs(thMax)) thMax = m.theta || 0; sSum += (m.s ?? 0.5); }
  return { s: sSum / rules.length, theta: thMax };
}
const _SUBPIX_CAL = 1 / 0.972;   // §7.103b sub-pixel tilt calibration for the IFS ring-Laplacian's small-k group velocity
function makeGenomeLens(gpu, rules, dt, G, P = {}) {
  const fullGrid = P.fullGrid !== false, rad = fullGrid ? G : (NLHO_R_MAX + 6);
  const fit = nlhoFixedPointFit(rules, G), centers = [];
  const cside = fullGrid ? G : nlhoGenRegion(G).side, cx0 = fullGrid ? 0 : nlhoGenRegion(G).x0, cy0 = fullGrid ? 0 : nlhoGenRegion(G).y0;
  for (const mm of fit.fps) { const vx = fit.pad + (mm.fx - fit.minX) * fit.sc, vy = fit.pad + (mm.fy - fit.minY) * fit.sc; centers.push(cx0 + Math.round(vx * (cside - 1)), cy0 + Math.round(vy * (cside - 1))); }
  // ABSOLUTE sliders: the lens's global scale/rotation are driven DIRECTLY by the slider params (sMul = the scale, thAdd = the
  // rotation) — NO genome baseline added. The genome supplies the fixed-point CENTRES (its geometry/satellite structure via the fit
  // above); the sliders own the global s/θ outright. So a slider value IS the lens parameter (not an offset from the genome).
  const s = Math.max(0.2, Math.min(1.6, P.sMul ?? 1));
  const th = (P.thAdd ?? 0), tx = P.tx ?? 0, ty = P.ty ?? 0, propT = P.propT ?? 2;
  const a = (1 - s) * 0.06, beta = th * 0.04, mode = P.opMode || 'phase', holoT = Math.max(0, P.holoT | 0);
  // focalDt = a CONTINUOUS multiplier on the focal step size (default 1) → SUB-STEP focal distance. propT is an integer
  // step COUNT (can't loop a fraction); focalDt scales each step's dt, so total focal distance = propT·(dt·focalDt) tunes
  // finely (e.g. propT=1, focalDt=0.1 → a tenth-step). The sub-pixel gauge seam uses the SAME total distance to stay calibrated.
  const focalDt = Math.max(0.05, P.focalDt ?? 1), fdt = dt * focalDt;
  const centersTx = new Float64Array(centers.length); for (let k = 0; k < centers.length; k += 2) { centersTx[k] = centers[k] + tx; centersTx[k + 1] = centers[k + 1] + ty; }
  // the phase-plate pass (the genome's lens element), applied to the field ALREADY on the GPU.
  const _plate = () => {
    if (mode === 'metric') { const c = Math.cos(th), sn = Math.sin(th); gpu.affineEyeCenters([s*c,-s*sn,s*sn,s*c],[tx,ty],centers,rad); }
    else if (mode === 'gauge') {   // §7.103/103b: integer translate via metric (exact), fractional + focus/shear via phase
      const itx = Math.round(tx), ity = Math.round(ty), fdx = tx - itx, fdy = ty - ity;
      if (itx || ity) gpu.affineEyeCenters([1,0,0,1],[itx,ity],centers,rad);
      const kpp = -_SUBPIX_CAL / (2 * Math.max(1, propT) * fdt);   // sub-pixel phase tilt (calibrated to the focal distance propT·fdt)
      gpu.linOp({ centers, a, beta, vtx: 0, kx: kpp*fdx, ky: kpp*fdy });
    } else gpu.linOp({ centers: centersTx, a, beta, vtx: 0 });    // §7.102 pure phase form = the lens IS linOp
  };
  // run(): apply the lens to the field ALREADY on the GPU, leave the result on the GPU (no readback).
  //   holoT=0 → NEAR-FIELD lens (phase-plate then focal prop). holoT>0 → HOLOGRAPHIC domain (§7.40): forward-propagate
  //   T into the hologram/diffraction domain, apply the phase-plate THERE, back-propagate T to reconstruct — a
  //   delocalized/robust read where the genome's footprint is spread across the field, then the focal prop forms the image.
  const run = () => {
    if (holoT > 0) gpu.stepEyeN(holoT, dt);     // FORWARD into the hologram domain
    _plate();
    if (holoT > 0) gpu.stepEyeN(holoT, -dt);    // BACK-propagate to reconstruct
    if (propT > 0) gpu.stepEyeN(propT, fdt);    // focal propagation — step size fdt=dt·focalDt → tunable sub-step focal distance
  };
  return { run, centers, s, th, fit };
}

// ── §7.103b SUB-PIXEL SEAM probe (determinism/calibration check): shine an extended blob through a pure sub-pixel
//    tilt, report centroid shift — should move ~1 cell/unit in the small-k gauge range. ─
function probeSubpixelSeam(gpu, dt, G, axis = 'x') {
  const N = G*G, cx = G>>1, cy = G>>1, T = 16, sig = 6, kpp = -_SUBPIX_CAL/(2*T*dt);
  const centroid = (f) => { let sx=0,sy=0,m=0; for(let y=0;y<G;y++)for(let x=0;x<G;x++){const a=f[(y*G+x)*2]**2+f[(y*G+x)*2+1]**2; sx+=x*a; sy+=y*a; m+=a;} return m>1e-9?(axis==='x'?sx/m:sy/m):NaN; };
  const saved = gpu.readEyePsi(), out = []; let c0 = null;
  for (const frac of [0,0.25,0.5,0.75,1.0]) {
    const f = new Float64Array(2*N); for(let y=0;y<G;y++)for(let x=0;x<G;x++){ const r2=(x-cx)**2+(y-cy)**2, a=Math.exp(-r2/(2*sig*sig)); if(a>1e-4) f[(y*G+x)*2]=a; }
    gpu.setEyePsi(f); const k = kpp*frac;
    gpu.linOp({ centers:[cx,cy], a:0, beta:0, vtx:0, kx: axis==='x'?k:0, ky: axis==='y'?k:0 });
    gpu.stepEyeN(T, dt); const c = centroid(gpu.readEyePsi()); if (c0===null) c0=c; out.push(`${frac.toFixed(2)}→Δ${(c-c0).toFixed(3)}`);
  }
  gpu.setEyePsi(saved); return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LENS STACK — the general lens mechanics, factored from medium.js (the meta-circular world lens) so BOTH the world
// lens (pass-through) and the eye (trap) compose from the SAME ops. Conforms to the algebra's operator style: a
// LensOp is a FIELD OPERATOR (field, gpu, ctx) → field', the same shape as operatorModality's `xform`. A STACK is
// FUNCTIONAL COMPOSITION of LensOps — itself a LensOp (closed under the type → a stack can be an op inside another
// stack, and drops into operatorModality/bind for holographic computing). The runner is UNTYPED (no trap/pass
// branch): trap-vs-pass is EMERGENT from ordering (recon-first = trap). The held recon-wavefront is FIRST-CLASS via
// ctx.recon (written by opRecon), so a trap's captured central wavefront is named/addressable without typing the runner.
//
//   LensOp  : (field:Float64[2N], gpu, ctx) → field'    // transforms the field; may read/write ctx
//   ctx     : { bar, G, dt, rules, P, recon?, selectedRank?, recallScores?, ... }   // the shared pipeline context
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// composeLens(...ops): functional left-to-right composition → a LensOp. The UNTYPED runner (just reduce).
function composeLens(...ops) {
  const flat = ops.flat().filter(Boolean);
  return (field, gpu, ctx) => flat.reduce((f, op) => op(f, gpu, ctx) || f, field);
}

// ── genome-as-wavefront helpers (pure; the §7.100 code=data substrate the self/coevolve/recall ops share). ───────
// the recursive-lens CLOCK depth at `bar`: triangle 0↔MAXD↔0 advancing opSpeed steps/bar (the IFS-clock rate).
function barClockDepth(bar, opSpeed = 6, MAXD = 24) {
  const sp = Math.max(1, opSpeed | 0), ph = ((bar | 0) * sp) % (2 * MAXD);
  return Math.max(1, ph < MAXD ? ph : 2 * MAXD - ph);
}
// the genome's fixed points as full-grid pixel centres (the lens centres / θ-satellite anchors).
function genomeFpCenters(rules, G) {
  const fit = nlhoFixedPointFit(rules, G), cen = [];
  for (const mm of fit.fps) { const vx = fit.pad + (mm.fx - fit.minX) * fit.sc, vy = fit.pad + (mm.fy - fit.minY) * fit.sc;
    cen.push(1 + Math.round(vx * (G - 3)), 1 + Math.round(vy * (G - 3))); }
  return cen;
}
// the genome's CODE as a wavefront: a main blob + a θ-satellite at each fixed point (code=data, the self-mode input).
function genomeCodeField(rules, G) {
  const cen = genomeFpCenters(rules, G), N = G * G, f = new Float64Array(2 * N), r = 4;
  const put = (X, Y, a) => { if (X >= 0 && X < G && Y >= 0 && Y < G) f[(Y * G + X) * 2] += a; };
  for (let i = 0; i < rules.length; i++) { const cx = cen[i*2], cy = cen[i*2+1], th = rules[i].theta || 0;
    put(cx, cy, 0.9); put(cx + Math.round(r * Math.cos(th)), cy + Math.round(r * Math.sin(th)), 0.5); }
  return f;
}
// read the lensed field's local phase-gradient direction at each centre by COMPLEX-MOMENT (§7.100) → θ per map (or null).
function readGenomeGrad(rules, lensed, G) {
  const cen = genomeFpCenters(rules, G);
  return rules.map((m, i) => { const cx0 = cen[i*2], cy0 = cen[i*2+1], RR = 6;
    let Mxr=0, Mxi=0, Myr=0, Myi=0; const at = (X, Y) => { const k = (Y*G+X)*2; return [lensed[k], lensed[k+1]]; };
    for (let dy=-RR; dy<=RR; dy++) for (let dx=-RR; dx<=RR; dx++) { const X=cx0+dx, Y=cy0+dy; if (X<1||X>=G-1||Y<1||Y>=G-1) continue;
      const [r0,i0] = at(X,Y); const a2 = r0*r0+i0*i0; if (a2 < 1e-3) continue; const [rx,ix] = at(X+1,Y), [ry,iy] = at(X,Y+1);
      Mxr+=a2*(rx*r0+ix*i0); Mxi+=a2*(ix*r0-rx*i0); Myr+=a2*(ry*r0+iy*i0); Myi+=a2*(iy*r0-ry*i0); }
    const gx = Math.atan2(Mxi, Mxr), gy = Math.atan2(Myi, Myr);
    return (Math.abs(gx)+Math.abs(gy) < 1e-4) ? null : Math.atan2(gy, gx); });
}
// the θ-walk laws (§7.100d): CONTRACT (θ←absolute read, snaps to the fixed point) | ORBIT (θ+=ω+κ·sin(read−θ), free walk).
// `dead` (optional per-map bool array) = the map's CODE was DESTROYED in the medium (occluded below threshold) → it TERMINATES:
// the program LOST that map, so its CONTRIBUTION COLLAPSES — amplitude decays toward 0 (it DROPS OUT of the generator/attractor,
// it does not freeze in place looking alive). A clean re-derivation (program present again) restores full amplitude = resurrect.
// _dead = the carried amplitude (0..1) per map; a dead map decays s·_dead, a live one recovers toward 1 (so partial damage heals).
function thetaWalk(rules, grad, law = 'orbit', dead = null) {
  const TWO = 2*Math.PI, wrap = t => ((t % TWO) + TWO) % TWO;
  const amp = (m, i) => {   // carry a per-map life fraction in m._life (1=alive); dead → decay ×0.5, live → recover toward 1
    const life = (m._life == null ? 1 : m._life);
    return dead && dead[i] ? Math.max(0, life * 0.5) : Math.min(1, life + 0.34);
  };
  if (law === 'contract') return rules.map((m, i) => ({ ...m, _life: amp(m, i), theta: (dead && dead[i]) ? (m.theta || 0) : (grad[i] == null ? (m.theta || 0) : wrap(grad[i])) }));
  const omega = 0.30, kappa = 0.12;   // ORBIT: ω dominates → never locks; κ<ω read coupling modulates the orbit
  return rules.map((m, i) => { const th = m.theta || 0, life = amp(m, i);
    if (dead && dead[i]) return { ...m, _life: life, theta: th };   // TERMINATED: code gone → drive (ω) gone → θ frozen, amplitude collapsing
    return { ...m, _life: life, theta: wrap(th + omega + (grad[i] == null ? 0 : kappa*Math.sin(grad[i]-th))) }; });
}

// applyLife(rules): bake the carried _life fraction into the map's amplitude `s` → a dead map (life→0) drops out of the
// generator/attractor (its soliton vanishes); a recovered map (life→1) is unchanged. Returns render-ready rules (s scaled).
function applyLife(rules) {
  return rules.map(m => (m._life == null || m._life >= 0.999) ? m : { ...m, s: (m.s || 0) * m._life });
}

// codeAlive(field, centers, G, thr): per-map liveness — true if the map's code-energy at its fixed-point centre survived
// (sum |ψ|² in a small window ≥ thr·nominal). After occlusion, a destroyed map → false → it TERMINATES in thetaWalk.
function codeAlive(field, centers, G, thr = 0.25) {
  const RR = 4, alive = [];
  for (let i = 0; i < centers.length; i += 2) {
    const cx = centers[i], cy = centers[i+1]; let e = 0;
    for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
      const X = cx+dx, Y = cy+dy; if (X<0||X>=G||Y<0||Y>=G) continue; const k = (Y*G+X)*2; e += field[k]*field[k] + field[k+1]*field[k+1];
    }
    alive.push(e);   // raw energy; the caller thresholds against the clean (un-occluded) energy
  }
  return alive;
}

// runGenomeLens(gpu, rules, depth, G, dt, P): apply makeGenomeLens `depth` times to the field on the GPU (the limit cycle).
function runGenomeLens(gpu, rules, depth, G, dt, P = {}) {
  const lg = makeGenomeLens(gpu, rules, dt, G, P);
  for (let q = 0; q < depth; q++) lg.run();
}

// ── THE LENS OPS (factories → LensOp). Each is a field operator closed over its params; pure of app state. ───────

// opGeometryLens: the genome lens (linOp, the optical chip / IFS-clock). depthFn(ctx)→passes (1 = single, barClockDepth = clock).
function opGeometryLens(rulesFn, { depthFn = () => 1, P = {} } = {}) {
  return (field, gpu, ctx) => {
    const rules = rulesFn(ctx); if (!rules || !rules.length) return field;
    gpu.setEyePsi(field); runGenomeLens(gpu, rules, depthFn(ctx), ctx.G, ctx.dt, { ...ctx.P, ...P });
    return gpu.readEyePsi();
  };
}

// opRecall: the §9 [H] content-addressable SELECT. The MEDIUM binds the cue against each stored genome (gpu.bindEyeField,
// the field product) + soliton transport, reduces+energy-normalizes → matched-filter score; argmax → ctx.selectedRank.
// bank = the K stored rule-sets; cueFn(ctx)→{cue, ecue} the (corrupted) probe. recallT = transport depth. Identity on ψ.
// MEMOIZED: the K GPU [H] round-trips are pure f(keyFn(ctx)) (bar + planted + cueClean + bankVer) — recompute only when the
// key changes, not every subtick. keyFn(ctx)→string lists every input the select reads (a stale key serves a stale rank).
function opRecall(bankFn, cueFn, { recallT = 12, keyFn = null } = {}) {
  return (field, gpu, ctx) => {
    const bank = bankFn(ctx); if (!bank || !bank.length) return field;
    if (keyFn) { const k = keyFn(ctx); if (ctx._recallKey === k) return field; ctx._recallKey = k; }
    let { cue, ecue } = cueFn(ctx); const N = ctx.G * ctx.G, saved = gpu.readEyePsi(), scores = [];
    // PROGRAM-MODALITY OCCLUSION: damage the CUE (the probe the medium reads) — the program's recognition input is occluded
    // (seed = bar → f(bar) peer-pure, re-derived clean each bar = resurrect). The matched score drops / a wrong rank can win.
    cue = occludeField(gpu, cue, ctx, ctx.bar * 101 + 1);
    ecue = 0; for (let i = 0; i < N; i++) ecue += cue[i*2]*cue[i*2] + cue[i*2+1]*cue[i*2+1];
    for (let r = 0; r < bank.length; r++) {
      const gF = new Float64Array(2*N); nlhoGenInject(gF, bank[r], ctx.G);
      // …and damage the STORED PROGRAM (the injected genome AS HELD in the medium) — the program-hologram itself is occluded
      // (per-rank seed → distinct holes). recall must now recognize a damaged cue against damaged stored programs.
      const gOcc = occludeField(gpu, gF, ctx, ctx.bar * 101 + 7 + r);
      const gConj = new Float64Array(2*N); let er = 0;
      for (let i = 0; i < N; i++) { gConj[i*2] = gOcc[i*2]; gConj[i*2+1] = -gOcc[i*2+1]; er += gOcc[i*2]*gOcc[i*2] + gOcc[i*2+1]*gOcc[i*2+1]; }
      gpu.setEyePsi(cue); gpu.bindEyeField(gConj);
      gpu.stepEyeN(recallT, ctx.dt); gpu.stepEyeN(recallT, -ctx.dt);
      const bf = gpu.readEyePsi(); let cr = 0, ci = 0; for (let i = 0; i < N; i++) { cr += bf[i*2]; ci += bf[i*2+1]; }
      scores.push((ecue > 0 && er > 0) ? Math.hypot(cr, ci) / Math.sqrt(ecue * er) : 0);
    }
    gpu.setEyePsi(saved);
    let win = 0; for (let r = 1; r < scores.length; r++) if (scores[r] > scores[win]) win = r;
    ctx.selectedRank = win; ctx.recallScores = scores;
    return field;   // recall SELECTS — identity on the field; the following opGeometryLens applies the chosen genome
  };
}

// opSelfEvolve: code=data θ-walk. Re-derives the genome from a seed rank to `bar` (peer-pure f(bar)): each step lenses
// the genome's own code, reads θ back (§7.100), writes it. Writes ctx.selfRules (+ returns the lensed code as the field).
// seedFn(ctx)→rules (the genome to evolve, e.g. bank[selectedRank]); law = 'orbit'|'contract'; opSpeed = walk rate.
// MEMOIZED: the bar·opSpeed-iteration θ-walk is pure f(bar, seed, law) — re-derive ctx.selfRules only when the key changes;
// every subtick just re-runs ONE lens pass on the cached genome (cheap) for the live wavefront. lawFn lets the law ride ctx.
function opSelfEvolve(seedFn, { law = 'orbit', lawFn = null, opSpeed = 6, cap = 600, keyFn = null } = {}) {
  return (field, gpu, ctx) => {
    const seed = seedFn(ctx); if (!seed || !seed.length) return field;
    const lw = lawFn ? lawFn(ctx) : law;
    const k = keyFn ? keyFn(ctx) : `${ctx.bar}|${lw}`;
    if (ctx._selfKey !== k || !ctx.selfRules) {   // re-derive the genome to `bar` (peer-pure f(bar)); else reuse the cache
      const nIter = Math.min(ctx.bar * Math.max(1, opSpeed | 0), cap);
      let rules = seed.map(m => ({ ...m }));
      const occOn = ctx.occ && (ctx.occ.mode|0) && (ctx.occ.r||0) > 0;
      for (let s = 0; s < nIter; s++) {
        // PROGRAM-MODALITY OCCLUSION: damage the CODE-FIELD (the genome's code=data wavefront) before each θ-read. A map whose
        // code is DESTROYED (energy at its centre falls below threshold) TERMINATES — its θ freezes (no field to drive it). The
        // surviving maps keep walking. seed = bar·step → f(bar) peer-pure; the genome is RE-DERIVED clean each bar → RESURRECT.
        const cleanCode = genomeCodeField(rules, ctx.G);
        const centers = genomeFpCenters(rules, ctx.G);
        let dead = null;
        let codeF = cleanCode;
        if (occOn) {
          const e0 = codeAlive(cleanCode, centers, ctx.G);
          codeF = occludeHolographic(gpu, cleanCode, ctx, ctx.bar * 211 + s);   // HOLOGRAPHIC: spread→occlude→recon (holoT = redundancy)
          const e1 = codeAlive(codeF, centers, ctx.G);
          // a map DIES when its surviving energy falls below `kill`. HOLOGRAPHIC REDUNDANCY: more spread (holoT) = the code is
          // delocalized over the aperture, so destroying a center takes MORE damage → the kill threshold RELAXES toward 0 with
          // holoT. holoT=0 → localized → kill at 25% (fragile); high holoT → kill only near-total loss (survives big occlusions).
          const T = Math.max(0, (ctx.occ.holoT|0)), kill = 0.25 * Math.exp(-T / 8);   // 0.25 → ~0.07 @T=8 → ~0.02 @T=16
          dead = e0.map((e, i) => e > 1e-9 && (e1[i] / e) < kill);
        }
        gpu.setEyePsi(codeF); runGenomeLens(gpu, rules, 1, ctx.G, ctx.dt, ctx.P); const lensed = gpu.readEyePsi();
        rules = thetaWalk(rules, readGenomeGrad(rules, lensed, ctx.G), lw, dead);
      }
      // GROW (§7.88 writable-operator-atlas, inverse of kill): AFTER the θ-walk (NOT per iteration — that was the freeze: the deep-
      // lens probe × ~nIter/4 was thousands of GPU passes). Run it a SMALL bounded number of times — at most (growMax − K) births,
      // each from the ACCUMULATED deep-lensed field (the genome's dynamics run out to the attractor's spread structure). The medium
      // reads its OWN field and adopts emergent peaks → peer-pure f(bar). Capped so a key change is cheap (≤ a few extra passes).
      if (ctx.growMax && rules.length < ctx.growMax) {
        const births = Math.min(ctx.growMax - rules.length, 4);   // bound the work: at most a few new maps per re-derivation
        for (let b = 0; b < births; b++) {
          gpu.setEyePsi(genomeCodeField(rules, ctx.G)); runGenomeLens(gpu, rules, 18, ctx.G, ctx.dt, ctx.P);
          const born = growMapFromField(rules, gpu.readEyePsi(), ctx.G, ctx.growBirth ?? 0.15);
          if (!born) break;   // no more emergent structure → stop (don't invent maps)
          rules = rules.concat([born]);
        }
      }
      ctx.selfRules = rules; ctx._selfKey = k;
      ctx.selfLife = rules.map(m => (m._life == null ? 1 : m._life));   // per-map life (0=terminated) → the render fades dead maps
    }
    // the live wavefront (one lens pass on the cached genome) — also damaged (holographically) so the displayed code shows the occlusion.
    let codeIn = genomeCodeField(ctx.selfRules, ctx.G);
    codeIn = occludeHolographic(gpu, codeIn, ctx, ctx.bar * 211);
    gpu.setEyePsi(codeIn); runGenomeLens(gpu, ctx.selfRules, 1, ctx.G, ctx.dt, ctx.P);
    return gpu.readEyePsi();   // the lensed code = the self-evolved wavefront (occluded)
  };
}

// opCoevolve: refine a REPLICA genome by peak-detect feedback (peer-pure f(bar), from a deterministic source). Each step
// lenses the source, finds the peak, migrates each fixed point's tx,ty toward it → ctx.replicaRules. srcFn(ctx)→source field.
// MEMOIZED: the bar-step peak-chase is pure f(bar, seed) from a deterministic source — re-derive ctx.replicaRules only on a
// key change. keyFn(ctx)→string (default: bar). The following opGeometryLens runs the cached replica every subtick (cheap).
function opCoevolve(seedFn, srcFn, { opSpeed = 6, window = 24, lr = 0.10, keyFn = null } = {}) {
  return (field, gpu, ctx) => {
    const k = keyFn ? keyFn(ctx) : `${ctx.bar}`;
    if (ctx._coevKey === k && ctx.replicaRules) return field;
    const seed = seedFn(ctx), src = srcFn(ctx); if (!seed || !src) return field;
    ctx._coevKey = k;
    const N = ctx.G * ctx.G, steps = Math.min(ctx.bar, window), saved = gpu.readEyePsi();
    let rules = seed.map(m => ({ ...m }));
    for (let s = 0; s < steps; s++) { gpu.setEyePsi(src); runGenomeLens(gpu, rules, barClockDepth(ctx.bar, opSpeed), ctx.G, ctx.dt, ctx.P);
      const lensed = gpu.readEyePsi(); let pbi=-1, pbv=0;
      for (let i = 0; i < N; i++) { const a = lensed[i*2]**2 + lensed[i*2+1]**2; if (a > pbv) { pbv = a; pbi = i; } }
      if (pbi >= 0 && pbv > 1e-9) { const pkx = pbi % ctx.G, pky = (pbi / ctx.G) | 0;
        rules = rules.map((m, idx) => { const d = Math.max(1e-3, 1 - m.s), rate = lr * (0.5 + 0.5*idx/Math.max(1, rules.length-1));
          return { ...m, tx: m.tx + rate*((pkx - ctx.G/2)*d - m.tx), ty: m.ty + rate*((pky - ctx.G/2)*d - m.ty) }; }); } }
    gpu.setEyePsi(saved); ctx.replicaRules = rules;
    return field;   // coevolve refines the model — identity on the field; opGeometryLens applies the refined genome
  };
}

// nlhoRuptureAdapt: the CRITIQUE'S mechanism — the genome ADAPTS to a ruptured field via readGenomeGrad → thetaWalk (NOT navigation
// to a predefined B). After an instanton rupture, the wave field carries a NEW gradient; readGenomeGrad registers it at each fixed
// point, thetaWalk drifts the genome's θ to that gradient. The genome "learns the new attractor geometry" the ruptured wave supports
// — an emergent DISCOVERY of a new vacuum, not a switch. One adaptation step per call (caller runs it per bar). law: 'orbit'|'contract'.
//   ruptured = the live post-kick field (the energy landscape the genome reads). Returns the drifted rules. Pure: f(rules, ruptured).
function nlhoRuptureAdapt(gpu, rules, ruptured, G, dt, P = {}, { law = 'contract' } = {}) {
  // read the ruptured wave's phase gradient at each of the genome's fixed points, then walk θ toward it (the critique's exact loop).
  const grad = readGenomeGrad(rules, ruptured, G);
  return thetaWalk(rules, grad, law, null);   // contract law → θ snaps toward the read gradient (settles to what the field supports)
}

// nlhoInstantonHologram: the "instanton hologram" idea (record→conj(ref)→recon) in OUR architecture — linOp ref + opHologram/opRecon,
// phase-mode. PROBLEM it addresses: the live ruptured field is CHAOTIC (re-condensing to A), so its gradient points back at A and
// the genome barely drifts (measured θ-drift 0.19rad, corr→A 98%). A HOLOGRAPHIC reconstruction is a SHARPER phase-front:
//   1. RECORD: forward-propagate the ruptured field T steps into the diffraction domain (opHologram) — the delocalized "plate".
//   2. CONJ(ref): multiply by the conjugate reference carrier (linOp e^{-i·kx·x}) — the proposal's phase-conjugation (a matched
//      filter that re-aligns the recorded fringes to the reference, sharpening the reconstruction).
//   3. RECON: backward-propagate T steps (opRecon) — collapse the plate back to a CLEAN reconstructed phase-front of the rupture.
// Returns the reconstructed field — a sharper gradient for readGenomeGrad to read than the raw chaotic ruptured field. refK = the
// reference carrier wavenumber (the proposal's REF_KX). T = the holographic depth. Pure GPU op (restores the buffer).
function nlhoInstantonHologram(gpu, ruptured, G, dt, { refK = 0.10, T = 12 } = {}) {
  const saved = gpu.readEyePsi();
  gpu.setEyePsi(ruptured);
  if (T > 0) gpu.stepEyeN(T, dt);                          // 1. RECORD → diffraction/plate domain (delocalized)
  gpu.linOp({ kx: -refK, ky: 0 });                         // 2. CONJ(ref): multiply by e^{-i·refK·x} (phase-conjugate the reference carrier)
  if (T > 0) gpu.stepEyeN(T, -dt);                         // 3. RECON → collapse the plate back to the reconstructed phase-front
  const recon = gpu.readEyePsi();
  gpu.setEyePsi(saved);
  return recon;
}

// nlhoLensWalk: LENS-SPACE TUNNEL (measured barrier-free, probe_lensspace.mjs). A→B can't cross in ENERGY-space (the attractor
// re-condenses every rupture to A), but the genome's IDENTITY is its PHASE-LENS, and the phase path φ_A→φ_B is BARRIER-FREE (energy
// flat, matched-filter swings A→B smoothly). KEY: walk the PHASE FIELD φ_t=(1−t)φ_A+t·φ_B, NOT genome parameters (param lerp breaks
// across different map counts 4-vs-3). NATIVE: phases compose multiplicatively, so applying A's plate at coeff (1−t) then B's at t
// = e^{i((1−t)φ_A+t·φ_B)} = the interpolated plate — exactly the barrier-free path, in two linOp passes. The CARRIED CONTENT is the
// medium RECALLING ITS OWN RESIDENT OPERATORS (nlhoGenInject = self-hosted code-as-wavefront reconstruction, same primitive as
// opRecall→opGeometryLens): recalled-A (1−t) blended with recalled-B (t). NOT a hand-placed seed and NOT emergent discovery — the
// probe arc (probe_recall_select.mjs) measured that phase can't transport geometry and nothing A-derived points at B, so B is
// RECALLED (the selection of rank=B is the replicated ⚡tunnel decision). `field` arg ignored. t∈[0,1]: 0=recalled-A, 1=recalled-B.
function nlhoLensWalk(gpu, _field, genomeA, genomeB, t, G, dt, P = {}, { depth = 6, propT = 2 } = {}) {
  const tt = Math.max(0, Math.min(1, t));
  const fitA = nlhoFixedPointFit(genomeA, G), fitB = nlhoFixedPointFit(genomeB, G);
  const cenA = [], cenB = [];
  for (const mm of fitA.fps) { const vx = fitA.pad + (mm.fx - fitA.minX) * fitA.sc, vy = fitA.pad + (mm.fy - fitA.minY) * fitA.sc; cenA.push(1 + Math.round(vx*(G-3)), 1 + Math.round(vy*(G-3))); }
  for (const mm of fitB.fps) { const vx = fitB.pad + (mm.fx - fitB.minX) * fitB.sc, vy = fitB.pad + (mm.fy - fitB.minY) * fitB.sc; cenB.push(1 + Math.round(vx*(G-3)), 1 + Math.round(vy*(G-3))); }
  const aggA = genomeAggregate(genomeA), aggB = genomeAggregate(genomeB);
  const aA = (1-aggA.s)*0.06*(1-tt), betaA = aggA.theta*0.04*(1-tt);   // A's plate coefficients scaled by (1−t)
  const aB = (1-aggB.s)*0.06*tt,     betaB = aggB.theta*0.04*tt;       // B's plate coefficients scaled by t
  // CARRIED CONTENT = the medium RECALLING ITS OWN RESIDENT OPERATORS (self-hosted, NOT a hand-placed seed). nlhoGenInject IS the
  // medium reconstructing a genome from its own code (the same primitive opRecall→opGeometryLens uses to rebuild a resident operator);
  // we blend recalled-A (weight 1−t) + recalled-B (weight t). HONESTY (probe_recall_select.mjs measured the whole arc): the medium
  // CANNOT discover/transport B from an A-rupture (phase can't move energy; recall of an A-rupture reads A; nothing A-derived points at
  // B) — so B is RECALLED, not created. The SELECTION (which rank = B) is the replicated ⚡tunnel decision (peer-deterministic). The
  // world CHOOSES the transition; the medium EXECUTES it by recalling B from _rules. This `seed` = self-hosted reconstruction of the
  // chosen resident operator, t-blended; the phase lens φ_A→φ_B deforms on top. NOT emergent discovery — honest recall + selection.
  const seed = new Float64Array(2 * G * G);
  const gA = new Float64Array(2 * G * G), gB = new Float64Array(2 * G * G);
  try { nlhoGenInject(gA, genomeA, G); } catch (e) {}   // recall A from its own code (the medium's resident operator A)
  try { nlhoGenInject(gB, genomeB, G); } catch (e) {}   // recall B from its own code (the chosen resident operator B)
  for (let i = 0; i < 2 * G * G; i++) seed[i] = (1 - tt) * gA[i] + tt * gB[i];   // t-blend of the two recalled operators
  gpu.setEyePsi(seed);
  for (let p = 0; p < depth; p++) {
    gpu.linOp({ centers: cenA, a: aA, beta: betaA, vtx: 0 });   // e^{i(1−t)φ_A}
    gpu.linOp({ centers: cenB, a: aB, beta: betaB, vtx: 0 });   // · e^{i·t·φ_B}  = e^{i((1−t)φ_A+t·φ_B)} (the interpolated lens)
    if (propT > 0) gpu.stepEyeN(propT, dt);                     // focal propagation (turns the phase into the carried structure)
  }
  return gpu.readEyePsi();
}

// nlhoClockMaps: build genome B's affine maps for ifsWarpEye in the GPU SHADER's convention (GLSL_IFS_WARP — VERIFIED against the
// shader source): rotation is about the GRID CENTRE (rel=(x−ctr)−tinv, src=minv·rel+ctr), so the map is M=s·R(θ) with t=(tx−0.5)·G
// (the opCodeWarp convention). A fixed-point form t=(I−M)·c rotates about the ORIGIN — WRONG for this shader → washes the field
// (browser: solid-bright, corr 23%). The readout refs (_clockRef) run THIS SAME GPU path, so the attractor lands consistently with
// the refs (GPU-faithful probe: refA/refB overlap 12%, corr→B reaches 99% — distinct, real transport).
function nlhoClockMaps(rules, G) {
  return rules.map(m => { const s = Math.max(0.15, Math.min(1.6, m.s ?? 0.5)), th = m.theta || 0, ct = Math.cos(th), sn = Math.sin(th);
    return { m: [s*ct, -s*sn, s*sn, s*ct], t: [((m.tx ?? 0.5) - 0.5) * G, ((m.ty ?? 0.5) - 0.5) * G] }; });
}

// ★ nlhoClockWalk: THE INSTANTON THAT TUNNELS, built on the CHAOS-GAME (the CONTRACTIVE point-set op — gpu.renderChaosGame). The
// earlier ifsWarpEye build FLOODED: it's a complex-field SUPERPOSITION (1/√K·Σ warped copies) = field-AVERAGING → iterating drives
// everything to a flat DC field (measured E×1300, peak/mean→1). The chaos-game is the CORRECT operator: it iterates POINT CHAINS
// p←M·(p−½)+t (the true Hutchinson map) and accumulates DENSITY → CONVERGES to the SPARSE attractor, no flood. THE WALK = the
// chaos-game ITERATION DEPTH: few iters = chains barely moved from their spread start (diffuse, the ruptured vacuum), more iters =
// converged onto B's attractor. So `ticks` (0..ticksMax) maps to iters → the density migrates A-spread → B-attractor, the honest
// contraction. `seedField` is unused (the chaos-game's chains ARE the medium iterating B's maps from any start = the IFS law).
// Returns a packed-complex field: amplitude = sqrt(density) (the attractor's invariant measure), phase 0. Leaves it on the eye buffer.
function nlhoClockWalk(gpu, seedField, genomeB, ticks, G, { ticksMax = 10, chains = 30000 } = {}) {
  // map the walk parameter to chaos-game iteration depth: tick 0 → ITERS_MIN (barely contracted, diffuse), tick max → ITERS_FULL (B's attractor)
  const ITERS_MIN = 1, ITERS_FULL = 16;
  const iters = Math.round(ITERS_MIN + (ITERS_FULL - ITERS_MIN) * Math.max(0, Math.min(1, ticks / Math.max(1, ticksMax))));
  const out = gpu.renderChaosGame(genomeB, { P: G, chains, iters });   // CONTRACTIVE: converges to the sparse attractor (no flood)
  const N = G * G, f = new Float64Array(2 * N), px = out.pixels;       // px = RGBA density heatmap (P×P), red channel = density ramp
  for (let i = 0; i < N; i++) { const r = px[i*4] / 255; f[i*2] = Math.sqrt(Math.max(0, r)); f[i*2+1] = 0; }   // amplitude = √density, phase 0
  gpu.setEyePsi(f);
  return f;
}

// ★ nlhoDammannImage: HONEST IMAGING of a genome's K-point constellation by WAVE INTERFERENCE (probe_planewave2 — the first
// controlled pass). Plane-wave input + ADDITIVE K-branch Dammann (Σ_k plane·e^{iφ_k}, single-center converging lenses) + CONJUGATE
// placement (lens at 2c0−k so the focus lands ON the target point), then propagate (stepEyeN = the medium imaging by diffraction).
// NOT a render (renderChaosGame is a trick — discards the wave); NOT a multiply (that's a single centroid focus). The image RESPONDS
// to the genome → keyed by the tunneled label. Returns the imaged constellation field (amplitude=the K foci) on the GPU eye buffer.
function nlhoDammannImage(gpu, genome, G, dt, { a = -0.05, propT = 8 } = {}) {
  const fit = nlhoFixedPointFit(genome, G), N = G * G, cN = (G - 1) / 2;
  // conjugate-placed lens centers (image lands on genomeFpCenters): for each fixed point c, place the lens at 2c0−c
  const cen = [];
  for (const mm of fit.fps) { const vx = fit.pad + (mm.fx - fit.minX) * fit.sc, vy = fit.pad + (mm.fy - fit.minY) * fit.sc;
    const cx = 1 + Math.round(vx * (G - 3)), cy = 1 + Math.round(vy * (G - 3)); cen.push(Math.round(2*cN - cx), Math.round(2*cN - cy)); }
  const K = cen.length >> 1, norm = K > 0 ? 1 / Math.sqrt(K) : 1;
  // ADDITIVE superposition of K plane-wave×(single-center converging lens) branches (the Dammann/beam-splitter — NOT multiply)
  const acc = new Float64Array(2 * N);
  for (let k = 0; k < K; k++) { const lx = cen[k*2], ly = cen[k*2+1];
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const dx = x - lx, dy = y - ly, p = a * (dx*dx + dy*dy);   // plane wave (=1) × e^{i·a·r²}
      const i = (y*G + x) * 2; acc[i] += Math.cos(p) * norm; acc[i+1] += Math.sin(p) * norm; } }
  gpu.setEyePsi(acc);
  if (propT > 0) gpu.stepEyeN(propT, dt);   // the MEDIUM images by diffraction (the lensed branches focus to the K points)
  return gpu.readEyePsi();
}

// nlhoCoevolveTunnel: EMERGENT A→B migration via PER-MAP fixed-point chase. The migration TARGET is B's ACTUAL fixed points
// (genomeFpCenters(targetB) — where B's attractor's energy concentrates, computed exactly, not from a noisy lensed read that's
// distorted by the current A-lens and chases a moving wrong target). Each of A's maps migrates toward its NEAREST B fixed point
// (round-robin cover so every B-point is claimed), moving the FULL {s,θ,tx,ty} toward B's map → the genome physically becomes B,
// not a mid-barrier clump. No hard-switch: the rules move under the energy landscape B defines (the critique's "coevolve adjusts wᵢ
// so the IFS fixed-point migrates A→B"). Returns refined rules + _maxD (distance to B, px) so the caller LOCKS on convergence.
function nlhoCoevolveTunnel(gpu, rules, targetB, G, dt, P = {}, { lr = 0.35 } = {}) {
  if (!targetB || !targetB.length) return rules.map(m => ({ ...m }));
  const cen = genomeFpCenters(rules, G), bcen = genomeFpCenters(targetB, G);   // current fixed pts + B's fixed pts (pixel)
  const K = bcen.length >> 1;
  // per-map ASSIGNMENT: each map → nearest B fixed point; round-robin any UNCLAIMED B point onto a map (so all of B is covered).
  const assign = rules.map((_, i) => { const cx = cen[i*2], cy = cen[i*2+1]; let bj = 0, bd = 1e18;
    for (let j = 0; j < K; j++) { const d = (cx-bcen[j*2])**2 + (cy-bcen[j*2+1])**2; if (d < bd) { bd = d; bj = j; } } return bj; });
  const covered = new Set(assign); for (let j = 0; j < K; j++) if (!covered.has(j)) { assign[j % rules.length] = j; covered.add(j); }
  // CONVERGENCE: max distance (px) from a current fixed point to its assigned B fixed point. Small → the genome has reached B → LOCK.
  let maxD = 0; for (let i = 0; i < rules.length; i++) { const bj = assign[i]; const d = Math.hypot(cen[i*2]-bcen[bj*2], cen[i*2+1]-bcen[bj*2+1]); if (d > maxD) maxD = d; }
  // MIGRATE the full {s,θ,tx,ty} toward the assigned B map (so the attractor BECOMES B, not just repositions): tx,ty so the fixed
  // point lands on B's point; s,θ toward B's map's. fp_target = bcen normalized; t = (I−sR)·fp for the CURRENT s,θ being migrated.
  const out = rules.map((m, i) => { const bj = assign[i], bm = targetB[bj % targetB.length];
    const sN = (m.s||0.5) + lr*((bm.s||0.5) - (m.s||0.5)), thN = (m.theta||0) + lr*((bm.theta||0) - (m.theta||0));
    const fxt = bcen[bj*2] / (G-1), fyt = bcen[bj*2+1] / (G-1), co = Math.cos(thN), si = Math.sin(thN);
    const txT = fxt - sN*(co*fxt - si*fyt), tyT = fyt - sN*(si*fxt + co*fyt);
    return { ...m, s: sN, theta: thN, tx: (m.tx||0) + lr*(txT - (m.tx||0)), ty: (m.ty||0) + lr*(tyT - (m.ty||0)) }; });
  Object.defineProperty(out, '_maxD', { value: maxD, enumerable: false });
  return out;
}

// ── OPTICS OPS (the eye's physical apparatus — the TRAP). opRecon is the APERTURE that catches the incoming wavefront
//    and lifts it into a held RECONSTRUCTION (ctx.recon = the central captured wavefront). opAutofocus chooses the focal
//    plane by sharpness; opPropagate is forward focal propagation. These make a stack a TRAP when opRecon comes FIRST —
//    the runner stays untyped; trap-vs-pass is just the ordering. (Recon physics = real backward propagation stepEyeN(-dt).)

// perceptSharpness: peak²/total energy — high when the percept is CONCENTRATED (in focus). The autofocus objective.
function perceptSharpness(field, N) { let pk=0, sum=0; for (let i=0;i<N;i++){ const a=field[i*2]**2+field[i*2+1]**2; if(a>pk)pk=a; sum+=a; } return sum>1e-12 ? pk/sum : 0; }

// opAutofocus: the eye focuses ITSELF — sweep focal planes on the incoming field, keep the depth that maximizes percept
// sharpness → ctx.focusDepth (the chosen focal plane the following opRecon reads at). f(field) → deterministic. Identity on ψ.
// MEMOIZED: the plane-sweep is the eye's most expensive op (planes × stepEyeN + a GPU READBACK each → readback stalls dominate).
// It is pure f(incoming field) and the field only changes per bar/phase — so re-sweep only when the key changes; subticks reuse
// the cached focusDepth. INCREMENTAL: instead of a full back-prop to each plane (Σ d ≈ Pd·planes/2 steps), step Δ between planes
// (the field is already at the previous plane) → Pd total steps. Together this cuts ~10× readbacks + ~planes/2× the propagation.
function opAutofocus({ maxDepth = 64, planes = 10, keyFn = null } = {}) {
  return (field, gpu, ctx) => {
    const k = keyFn ? keyFn(ctx) : `${ctx.bar}|${(ctx.phaseT||0).toFixed(2)}|${maxDepth|0}`;
    if (ctx._afKey === k && ctx.focusDepth != null) return field;   // reuse the cached focal plane (no sweep this subtick)
    const N = ctx.G * ctx.G, saved = gpu.readEyePsi(), Pd = Math.max(8, Math.min(400, maxDepth|0));
    const stepD = Math.max(1, Math.round(Pd/planes));
    let best = { d: 1, sh: -1 };
    gpu.setEyePsi(field);   // start at the field; walk BACKWARD incrementally (each plane = +stepD more steps from the last)
    for (let d = stepD; d <= Pd; d += stepD) {
      gpu.stepEyeN(stepD, -ctx.dt);   // INCREMENTAL: advance Δ from the previous plane (not a fresh full back-prop)
      const sh = perceptSharpness(gpu.readEyePsi(), N); if (sh > best.sh) best = { d, sh };
    }
    gpu.setEyePsi(saved); ctx.focusDepth = best.d; ctx.focusSharp = best.sh; ctx._afKey = k;
    return field;   // autofocus only CHOOSES the plane — identity on ψ; opRecon reads at ctx.focusDepth
  };
}

// opHologram: FORWARD-propagate the incoming wavefront T steps INTO the diffraction/hologram domain (§7.40). The near-field
// object spreads into a DELOCALIZED interference pattern — THE HOLOGRAM (every part now carries info about every part →
// occlusion-resistant). Bigger T = deeper = more delocalized. Writes ctx.hologram (first-class) + returns it. This is the
// FORWARD half of the trap (record); opRecon is the backward half (read). depthFn(ctx)→T (the holographic time-depth).
function opHologram({ depthFn = null, depth = 12 } = {}) {
  return (field, gpu, ctx) => {
    const T = Math.max(0, (depthFn ? depthFn(ctx) : depth) | 0);
    ctx.holoT = T;
    if (T === 0) { ctx.hologram = field; return field; }   // T=0 → no hologram domain (the near-field object IS the "hologram")
    gpu.setEyePsi(field); gpu.stepEyeN(T, ctx.dt);   // forward → the diffraction domain (the spread hologram)
    ctx.hologram = gpu.readEyePsi();   // the HELD hologram — the delocalized record (EYE ◀)
    return ctx.hologram;
  };
}

// opRecon: THE TRAP READ — RECONSTRUCT the held hologram by backward propagation (the matched depth = ctx.holoT, §7.101i the
// lossless temporal coordinate). The delocalized hologram collapses back into the localized image — the eye's PERCEPT. Reads
// the depth from ctx.holoT (set by opHologram) so forward T and backward T MATCH (the exact-inverse round-trip → clean recon).
// Writes ctx.recon (first-class) + returns it as the field the rest of the stack acts on (EYE ▸).
function opRecon({ depthFn = null, depth = 12 } = {}) {
  return (field, gpu, ctx) => {
    // depthFn(ctx) is the explicit depth (manual/matched). If it returns undefined (autofocus mode), opAutofocus's ctx.focusDepth
    // wins over the matched ctx.holoT — so the eye reads at the AUTOFOCUSED plane, not the forward-spread plane.
    const explicit = depthFn ? depthFn(ctx) : undefined;
    const D = Math.max(1, (explicit ?? ctx.focusDepth ?? ctx.holoT ?? depth) | 0);
    gpu.setEyePsi(field); gpu.stepEyeN(D, -ctx.dt);   // backward propagation → the reconstruction (matched-depth → clean)
    ctx.recon = gpu.readEyePsi();   // the HELD reconstruction — the eye's percept (the trap read the hologram back)
    return ctx.recon;               // the rest of the stack acts on the reconstructed percept
  };
}

// opPropagate: forward focal propagation (the pass-through focal step / the lens forming its image). propT steps of stepEyeN.
function opPropagate({ propT = 2 } = {}) {
  return (field, gpu, ctx) => { if (propT <= 0) return field; gpu.setEyePsi(field); gpu.stepEyeN(propT, ctx.dt); return gpu.readEyePsi(); };
}

// occludeField(gpu, field, ctx, seed?): DAMAGE any wavefront in place — the physically-honest occlusion (eye.js's H=OCCL
//    family, the SAME GPU primitive gpu.applyEyeHologram). The damage params ride ctx.occ = { mode, r, block } so occlusion is
//    a UNIFORM MEDIUM PROPERTY hitting EVERY wavefront — the IMAGE (the trap hologram) AND the PROGRAM (the recall cue, the
//    self code-field, the injected genome). ctx.occ.mode 6=LEFT-slab|7=RZero|8=RNois; r=fraction; block=px. mode/r 0 → identity.
//    Returns the damaged field (a fresh array; the input is not mutated beyond the GPU buffer). `seed` offsets the random pattern.
function occludeField(gpu, field, ctx, seed = 0) {
  const oc = ctx.occ; if (!oc) return field;
  const m = oc.mode | 0, frac = Math.max(0, Math.min(1, oc.r || 0));
  if (!m || frac <= 0) return field;
  gpu.setEyePsi(field);
  gpu.applyEyeHologram(m, frac, { block: (oc.block | 0) || 8, seed: (oc.seed || 0) + seed });
  return gpu.readEyePsi();
}

// occludeHolographic(gpu, field, ctx, seed?): the HOLOGRAPHIC occlusion — spread the field forward by ctx.occ.holoT (delocalize:
// every region carries the whole), occlude the SPREAD record, then reconstruct backward (matched depth → exact inverse). This is
// the §7.101i round-trip applied to the PROGRAM: at holoT=0 it's plain (localized) occlusion → damage ERASES; at high holoT the
// code is delocalized → the SAME occlusion only DIMS → the program SURVIVES bigger damage and RESURRECTS better. The honest
// "program hologram": higher holoT = more redundancy. Returns the reconstructed (damaged-then-healed) field.
function occludeHolographic(gpu, field, ctx, seed = 0) {
  const oc = ctx.occ; if (!oc || !(oc.mode|0) || (oc.r||0) <= 0) return field;
  const T = Math.max(0, oc.holoT|0);
  if (T === 0) return occludeField(gpu, field, ctx, seed);   // no spread → localized occlusion (the damage erases)
  gpu.setEyePsi(field); gpu.stepEyeN(T, ctx.dt);             // forward → the spread hologram (the code delocalized)
  const spread = occludeField(gpu, gpu.readEyePsi(), ctx, seed);   // occlude the DELOCALIZED record
  gpu.setEyePsi(spread); gpu.stepEyeN(T, -ctx.dt);           // backward → reconstruct (matched depth → clean where undamaged)
  return gpu.readEyePsi();
}

// opOcclude: the IMAGE-modality occlusion op (used in the trap, between opHologram and opRecon). Damages the SPREAD HOLOGRAM
//    via occludeField → the recon's survival measures holographic redundancy (high holoT spreads info → damage DIMS not
//    ERASES). Writes ctx.occluded (first-class — EYE ◀ shows the damage). Reads the damage params from ctx.occ (set by the app).
function opOcclude() {
  return (field, gpu, ctx) => {
    const oc = ctx.occ; if (!oc || !(oc.mode|0) || (oc.r||0) <= 0) return field;   // identity (no damage)
    ctx.occluded = occludeField(gpu, field, ctx);   // the damaged wavefront (EYE ◀ reflects it)
    return ctx.occluded;
  };
}

// ── makePerception(spec): the PERCEPTION sub-stack for a mode (the part shared by EVERY lens, medium or eye). One place
//    that maps a mode → the composed ops: recall/coevolve SELECT-then-run, self = the standalone θ-walk, pass/clock = the
//    plain genome lens. spec wires the app's data into the ops (the bank, the cue, the seed, the source, the genome, depth).
//    Returns a LensOp. This is the body of a stack; makeTrapStack wraps it with the optical trap (hologram→recon) for the eye.
function makePerception(mode, spec) {
  const { bankFn, cueFn, seedFn, srcFn, genomeFn, depthFn, lawFn, opSpeed, recallT, P } = spec;
  if (mode === 'self' || mode === 'recallself') {
    // recallself = recall SELECTS which genome, then self EVOLVES it (recognition → adaptation); self = walk the seed directly.
    const recallStep = mode === 'recallself' ? opRecall(bankFn, cueFn, { recallT, keyFn: spec.recallKeyFn }) : null;
    return composeLens(recallStep, opSelfEvolve(seedFn, { lawFn, opSpeed, keyFn: spec.selfKeyFn, P }));
  }
  const sel = mode === 'recall'   ? opRecall(bankFn, cueFn, { recallT, keyFn: spec.recallKeyFn })
            : mode === 'coevolve' ? opCoevolve(seedFn, srcFn, { opSpeed, keyFn: spec.coevKeyFn, P })
            : null;   // pass/clock = no select; just run the active genome
  return composeLens(sel, opGeometryLens(genomeFn, { depthFn, P }));
}

// opCodeMask: THE CODE GATES THE IMAGE CONTENT — IN THE MEDIUM (§7.90 binding=computation, ψ_image·ψ_code via gpu.bindEyeField,
//    the GLSL_FIELD_MUL complex product). The genome's generator-events ARE the operand B (its real footprint in the medium —
//    not a JS-invented mask); the MULTIPLY happens on the GPU (the medium operating on the medium, "the optical chip"), NOT a CPU
//    loop. The product is field content the soliton/IFS then transports (§9). Where the code has footprint, image content passes;
//    elsewhere it is suppressed → mutating {s,θ,tx,ty} reshapes WHICH content survives. gainFn(ctx)→0..1 (interpolate identity↔bound).
//    The operand is normalized to a 0..~1 footprint (so the product GATES, doesn't blow up amplitude); the soft extent rides the
//    genome's own satellite radius. off → identity.
function opCodeMask(maskFn, { gainFn = null } = {}) {
  return (field, gpu, ctx) => {
    const g = gainFn ? gainFn(ctx) : 1; if (g <= 0) return field;
    const rules = maskFn(ctx); if (!rules || !rules.length) return field;
    const G = ctx.G, N = G * G;
    // operand B = the genome's footprint over the IMAGE (its fixed points spread across the whole grid, NOT the corner generator
    // region), each a BROAD Gaussian so the gate is a smooth, image-spanning mask — at g=1 it SUPPRESSES where the genome has no
    // structure but does NOT nuke the whole image to bare blobs. B = (1−g)·1 + g·footprint → g=0 ⇒ B≡1 (no-op), g=1 ⇒ full gate.
    const centers = genomeFpCenters(rules, G);   // the genome's fixed points as full-grid pixel centres (where its attractor lives)
    const sig = Math.max(4, G / 6), s2 = 2 * sig * sig, B = new Float64Array(2 * N);   // broad footprint (σ ∝ grid → image-spanning)
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      let foot = 0;
      for (let c = 0; c < centers.length; c += 2) { const dx = x - centers[c], dy = y - centers[c+1]; foot = Math.max(foot, Math.exp(-(dx*dx + dy*dy) / s2)); }
      B[(y*G+x)*2] = (1 - g) + g * foot; }   // real operand (magnitude gate), imag = 0
    // THE MEDIUM DOES THE MULTIPLY: load the image, bindEyeField(B) = GPU ψ·=B, read the bound percept back.
    gpu.setEyePsi(field);
    gpu.bindEyeField(B);
    ctx.codeMasked = gpu.readEyePsi();   // first-class (the in-medium bound percept)
    return ctx.codeMasked;
  };
}

// opCodeWarp: THE CODE AS A GEOMETRIC OPERATOR (data=code, §7.92/7.97 METRIC transform). NOT painted content — the genome's
//    {s,θ,tx,ty} IS an affine map M=s·R(θ), t=(tx,ty), executed by the medium's OWN operator gpu.affineEyeCenters (a coordinate
//    RESAMPLE: out(x)=src(M⁻¹·(x−t))) — no JS painting. So the code ROTATES / SCALES / TRANSLATES the image by warping its space.
//    Mutating the code = mutating the warp (θ→rotate, s→scale, tx,ty→translate). This is the self-hosting form: the operator is
//    the curvature of the space, residue-free. warpFn(ctx)→rules; gainFn(ctx)→0..1 (interpolate identity↔full warp). off → identity.
// paramGainFn(ctx)→{ s, theta, tx, ty } (each a 0..1+ multiplier on that parameter's contribution to the warp; default all = g).
// mapCountFn(ctx)→int: how many of the genome's K maps PARTICIPATE = the REPLICATION COUNT (each map = one warped copy COMPLEX-
//   SUPERPOSED into the result, interfering). 1 = single warp; K = full IFS. Clamped to [1, genome's map count]. null → all maps.
function opCodeWarp(warpFn, { gainFn = null, paramGainFn = null, mapCountFn = null } = {}) {
  return (field, gpu, ctx) => {
    const g = gainFn ? gainFn(ctx) : 1; if (g <= 0) return field;
    let rules = warpFn(ctx); if (!rules || !rules.length) return field;
    const G = ctx.G;
    // REPLICATION COUNT: keep the first `nMaps` of the genome's maps (each adds one copy to the union). Honest — it selects how
    // many of the genome's REAL maps act, it does not invent copies. Clamp to [1, K].
    if (mapCountFn) { const nMaps = Math.max(1, Math.min(rules.length, mapCountFn(ctx) | 0)); rules = rules.slice(0, nMaps); }
    // per-parameter FRACTIONS (0..1, default 1) — effective gain per DOF = master g × fraction. So each slider scales how much
    // that geometric DOF participates: e.g. theta=1,others=0 → pure rotation; s=1,others=0 → pure scale. null → all follow master.
    const pg = paramGainFn ? paramGainFn(ctx) : null, fr = (v) => (v == null ? 1 : v);
    const gS = g * fr(pg && pg.s), gTh = g * fr(pg && pg.theta), gTx = g * fr(pg && pg.tx), gTy = g * fr(pg && pg.ty);
    // THE FULL K-MAP IFS OPERATOR: ψ' = (1/√K)·Σₖ fₖ(ψ). Each map fₖ = sₖ·R(θₖ) about the grid centre + translate (txₖ,tyₖ) — a
    // §7.97 METRIC coordinate-remap (the affine resample; the honest form for a geometric transform). The K warped wavefronts are
    // COMPLEX-SUPERPOSED (they INTERFERE — the true wave-combine), one GPU pass (gpu.ifsWarpEye). Per-parameter gains blend EACH of
    // {s,θ,tx,ty} toward identity independently (each slider isolates one geometric DOF). NOTE: the LENS phase mode is the pure
    // ψ·e^{iφ} circular medium (no resample); the warp NEEDS the metric resample to rotate/scale an extended image — both honest.
    const maps = rules.map(m => {
      const sRaw = Math.max(0.15, Math.min(1.6, (m.s ?? 0.5)));
      const s = 1 + (sRaw - 1) * gS;                         // scale blended toward 1 by gS
      const th = (m.theta || 0) * gTh, ct = Math.cos(th), sn = Math.sin(th);   // rotation blended toward 0 by gTh
      return { m: [s*ct, -s*sn, s*sn, s*ct], t: [((m.tx ?? 0.5) - 0.5) * G * gTx, ((m.ty ?? 0.5) - 0.5) * G * gTy] };
    });
    gpu.setEyePsi(field);
    gpu.ifsWarpEye(maps);                 // the K affine maps, complex-superposed (interfering), one GPU pass, in-medium
    ctx.codeWarped = gpu.readEyePsi();    // first-class (the full K-map IFS-transformed percept)
    return ctx.codeWarped;
  };
}

// makeTrapStack(spec): THE EYE = a TRAP = a lens COMPOSITION. opHologram (FORWARD T → record, ctx.hologram = EYE ◀) then
//    opRecon (BACKWARD T → read, ctx.recon = EYE ▸) then PERCEPTION on the reconstruction. recon-FIRST ⇒ trap (the ordering
//    IS the trap; the runner stays untyped). The SAME makePerception body runs the eye's clock/recall/self ON ITS RECON —
//    so the eye operates meta-circularly on its lifted replica of the world. holoTFn/reconDFn(ctx)→T. opticsFn(ctx)→bool.
function makeTrapStack(mode, spec) {
  return composeLens(
    spec.opticsFn && spec.opticsFn(spec.ctx)
      // re-sweep only a few times per bar (phaseT is continuous wall-clock → QUANTIZE to ~8 bins/unit so the memo actually hits;
      // keying on raw phaseT would miss every frame). Bar + phase-bin + recon depth = everything that moves the incoming field.
      ? opAutofocus({ maxDepth: (spec.reconDFn ? spec.reconDFn() : 24) * 2,
                      keyFn: (c) => `${c.bar}|${Math.floor((c.phaseT||0)*2)}|${spec.reconDFn?spec.reconDFn():24}` })
      : null,
    opHologram({ depthFn: spec.holoTFn }),   // FORWARD T → ctx.hologram (EYE ◀ raw)
    // OCCLUDE the SPREAD HOLOGRAM (the IMAGE modality, honest H=OCCL) — damage the delocalized record before reconstructing.
    // ctx.hologram → the DAMAGED field so EYE ◀ shows the occlusion; the recon's survival = holographic redundancy at this holoT.
    // (The PROGRAM modality is occluded INSIDE opRecall/opSelfEvolve — the cue & code-field — so ALL modalities degrade, not just image.)
    opOcclude(),
    (field, gpu, ctx) => { if (ctx.occluded) ctx.hologram = ctx.occluded; return field; },   // EYE ◀ reflects the damage
    // ── THE CODE ACTS ON THE WAVEFRONT *BEFORE* RECON (the physical story: woven into the delocalized hologram, not stamped on
    //    the formed picture). Two distinct couplings, each behind its own gain (0 → identity):
    //  (a) WARP — code as a GEOMETRIC OPERATOR (data=code, §7.97 metric): affineEyeCenters rotates/scales/translates the space.
    spec.codeWarpGainFn ? opCodeWarp(spec.maskFn, { gainFn: spec.codeWarpGainFn, paramGainFn: spec.paramGainFn, mapCountFn: spec.mapCountFn }) : null,
    //  (b) GATE — code as CONTENT (§7.90 binding ψ·ψ_code): the genome field masks which content survives.
    spec.codeMaskGainFn ? opCodeMask(spec.maskFn, { gainFn: spec.codeMaskGainFn }) : null,
    opRecon({ depthFn: spec.reconDFn }),     // BACKWARD T → ctx.recon  (EYE ▸ raw, reconstructed from the code-acted hologram)
    makePerception(mode, spec),              // perceive ON the recon (the eye's own mode, meta-circular)
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// U(1) OBSERVER-LENS ALGEBRA (u-register arc step 3; doc/proper-time-metric.md §12) — the observer
// descriptor {mode, phase, beta, omega, prec} as an algebraic VALUE, pure functions only (no medium,
// no GPU, no clock: the algebra knows THAT an op evaluates against a worldline time, never how the
// medium accounts it). Conventions, matching medium.js exactly:
//   phase — the AUTHORED reference angle (W: the live engine accumulator, which ALSO absorbs its own
//           precession at each beat; V/P: the drain-time aphase ledger, precession NOT included);
//   prec  — the INTEGRATED precession Σω per own-beat for slots whose phase excludes it (V/P; W keeps
//           prec = 0 since its phase already carries it) → angle(op) = phase + prec is UNIFORM: the
//           total instantaneous reference angle for every slot;
//   beta  — pin stiffness multiplier. NOT part of the read transform (β is dynamics — how hard the
//           field is pulled toward the reference — not what an observer's read DOES to a field), so
//           apply() deliberately ignores it; compose multiplies it (stacked pins stack stiffness);
//   omega — precession rate (rad per own slot-beat), the time component of the lens.
// THE MODEL LAWS this algebra states (and chainRead measures the medium against):
//  · the 'id'/'phase' sector is ABELIAN — link phases add exactly, chain().defect ≡ 0 by construction;
//    a nonzero MEASURED ε is the medium deviating from the model, never algebra error.
//  · 'metric' (affine resample, §7.97) and 'gauge' (affine + tilt) compose by the SEMIDIRECT PRODUCT —
//    the actual group of this optics: acting a THEN b on a field gives
//      A = A_b·A_a  (non-abelian: order matters)      t = A_b·t_a + t_b
//      k = k_b + k_a·A_b⁻¹  (the tilt PULLED BACK through b's map)
//      φ = φ_a + φ_b − (k_a·A_b⁻¹)·t_b  (the translation's phase correction)
//    with β multiplying and ω/prec adding as before. compose() is closed over the full table now;
//    null is returned only for UNKNOWN modes — refuse rather than fake.
// Element (all fields optional, defaults = identity): { mode, phase, kx, ky, A:[axx,axy,ayx,ayy], tx, ty,
// beta, omega, prec }. Spatial convention: CENTERED coordinates ξ = x − c, c = (G−1)/2, field interleaved
// [re,im] row-major (idx = (y·G + x)·2); the map acts ξ_out = A·ξ_in + t; the phase profile
// φ(ξ) = phase + prec + k·ξ applies in the OUTPUT frame (so angle(op) stays the k=0 center reference).
const lensU1 = (() => {
  const IDA = [1, 0, 0, 1];
  const _A = (op) => op.A || IDA;
  const hasA = (op) => { const A = _A(op); return A[0] !== 1 || A[1] !== 0 || A[2] !== 0 || A[3] !== 1 || !!(op.tx || op.ty); };
  const hasK = (op) => !!(op.kx || op.ky);
  const mul2 = (B, A) => [B[0] * A[0] + B[1] * A[2], B[0] * A[1] + B[1] * A[3], B[2] * A[0] + B[3] * A[2], B[2] * A[1] + B[3] * A[3]];   // B·A
  const inv2 = (A) => { const d = A[0] * A[3] - A[1] * A[2]; return d ? [A[3] / d, -A[1] / d, -A[2] / d, A[0] / d] : null; };
  const KNOWN = new Set(['id', 'phase', 'metric', 'gauge']);
  const modeOf = (mA, mK) => mA ? (mK ? 'gauge' : 'metric') : (mK ? 'phase' : 'id');
  // ── ℂ* GENERALIZATION (the `gain` component; U(1) → ℂ*): a U(1) element is e^{iφ} (unit modulus, UNITARY →
  //    norm-preserving → COMPACT → intrinsically runaway-proof). Dropping unit-modulus gives r·e^{iφ} = (gain, phase)
  //    — the group ℂ* under multiplication: phases ADD, gains MULTIPLY. Still abelian, still a group. `gain` defaults
  //    to 1 EVERYWHERE (`op.gain ?? 1`), so every U(1) call site is the gain≡1 slice, byte-unchanged. This is the ONE
  //    honest extension that stays a Lie group AND makes runaway possible: ℂ* is NON-compact (r unbounded above), so
  //    apply is no longer unitary and self-hosting can diverge in the r dimension — the medium's amplitude/energy as
  //    a first-class lens component. The medium's energy CAP becomes, in this algebra, a BOUND on gain (see lensC1).
  const L = {
    id: () => ({ mode: 'id', phase: 0, gain: 1, kx: 0, ky: 0, A: [1, 0, 0, 1], tx: 0, ty: 0, beta: 1, omega: 0, prec: 0 }),
    wrap: (x) => Math.atan2(Math.sin(x), Math.cos(x)),
    angle: (op) => op.phase + (op.prec || 0),                                   // the k=0 CENTER reference angle (for tilted/metric ops: the reference at ξ=0, a partial reading of the full profile)
    evalAt: (op, dTau) => op.phase + (op.prec || 0) + (op.omega || 0) * dTau,   // predicted angle dTau proper-time units AHEAD (per-op clock — the caller supplies each op's own dτ)
    compose: (a, b) => {                                                        // a THEN b (apply(b, apply(a, ψ)) ≡ apply(compose(a,b), ψ))
      if (!a || !b || !KNOWN.has(a.mode ?? 'id') || !KNOWN.has(b.mode ?? 'id')) return null;
      const Ab = _A(b), Abi = inv2(Ab); if (!Abi) return null;
      const A = mul2(Ab, _A(a));
      const tx = Ab[0] * (a.tx || 0) + Ab[1] * (a.ty || 0) + (b.tx || 0), ty = Ab[2] * (a.tx || 0) + Ab[3] * (a.ty || 0) + (b.ty || 0);
      const kpx = (a.kx || 0) * Abi[0] + (a.ky || 0) * Abi[2], kpy = (a.kx || 0) * Abi[1] + (a.ky || 0) * Abi[3];   // k_a·A_b⁻¹ (row form)
      const kx = (b.kx || 0) + kpx, ky = (b.ky || 0) + kpy;
      const out = { mode: '', phase: a.phase + b.phase - (kpx * (b.tx || 0) + kpy * (b.ty || 0)), gain: (a.gain ?? 1) * (b.gain ?? 1), kx, ky, A, tx, ty,
        beta: a.beta * b.beta, omega: (a.omega || 0) + (b.omega || 0), prec: (a.prec || 0) + (b.prec || 0) };   // ℂ*: gains MULTIPLY (as phases add)
      out.mode = modeOf(hasA(out), hasK(out)); return out; },
    invert: (op) => { if (!op || !KNOWN.has(op.mode ?? 'id')) return null;      // compose(op, invert(op)) = id (β inverts, ω/prec negate — the anti-aged inverse lens)
      const A = _A(op), Ai = inv2(A); if (!Ai) return null;
      const out = { mode: '', phase: -op.phase - ((op.kx || 0) * (op.tx || 0) + (op.ky || 0) * (op.ty || 0)), gain: (op.gain ?? 1) ? 1 / (op.gain ?? 1) : 1,   // ℂ*: gain inverts (1/r)
        kx: -((op.kx || 0) * A[0] + (op.ky || 0) * A[2]), ky: -((op.kx || 0) * A[1] + (op.ky || 0) * A[3]),
        A: Ai, tx: -(Ai[0] * (op.tx || 0) + Ai[1] * (op.ty || 0)), ty: -(Ai[2] * (op.tx || 0) + Ai[3] * (op.ty || 0)),
        beta: op.beta ? 1 / op.beta : 1, omega: -(op.omega || 0), prec: -(op.prec || 0) };
      out.mode = modeOf(hasA(out), hasK(out)); return out; },
    link: (a, b) => L.wrap((b.phase + (b.prec || 0)) - (a.phase + (a.prec || 0))),   // predicted pairwise read a→b (gauge-invariant: a difference of center references)
    chain: (ops) => { if (!ops || ops.length < 2) return null;
      const links = []; let s = 0;
      for (let i = 0; i + 1 < ops.length; i++) { const l = L.link(ops[i], ops[i + 1]); links.push(l); s += l; }
      const composed = L.link(ops[0], ops[ops.length - 1]);
      return { links, composed, defect: L.wrap(s - composed) }; },              // defect ≡ 0 in the abelian model — stated so the meter's contract is explicit
    apply: (op, psi, G) => {                                                    // β deliberately NOT applied (pin stiffness is dynamics, not read); ℂ*: SCALE by gain (unitary only when gain=1); metric path = bilinear resample, zero-fill outside
      const phi0 = (op.phase || 0) + (op.prec || 0), gn = op.gain ?? 1;
      const mA = hasA(op), mK = hasK(op);
      if (!mA && !mK) { const c = gn * Math.cos(phi0), s = gn * Math.sin(phi0), r = new Float64Array(psi.length);   // r·e^{iφ}·ψ
        for (let j = 0; j < psi.length; j += 2) { r[j] = psi[j] * c - psi[j + 1] * s; r[j + 1] = psi[j] * s + psi[j + 1] * c; } return r; }
      const n = psi.length >> 1; if (!G) G = Math.round(Math.sqrt(n));
      const c0 = (G - 1) / 2, Ai = inv2(_A(op)); if (!Ai) return null;
      const r = new Float64Array(psi.length);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        const xi = x - c0, yi = y - c0;                                         // output ξ
        let sr = 0, si = 0;
        if (mA) { const ux = xi - (op.tx || 0), uy = yi - (op.ty || 0);
          const sx = Ai[0] * ux + Ai[1] * uy + c0, sy = Ai[2] * ux + Ai[3] * uy + c0;   // source cell
          const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
          for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
            const X = x0 + dx, Y = y0 + dy; if (X < 0 || Y < 0 || X >= G || Y >= G) continue;
            const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy), j = (Y * G + X) * 2;
            sr += w * psi[j]; si += w * psi[j + 1]; }
        } else { const j = (y * G + x) * 2; sr = psi[j]; si = psi[j + 1]; }
        const th = phi0 + (op.kx || 0) * xi + (op.ky || 0) * yi, ct = gn * Math.cos(th), st = gn * Math.sin(th), j = (y * G + x) * 2;   // gain scales the metric read too
        r[j] = sr * ct - si * st; r[j + 1] = sr * st + si * ct; }
      return r; },
    // ── ℂ* helpers (the general group): logGain (=ln r) is the natural coordinate — it composes ADDITIVELY like phase,
    //    so (phase, logGain) is a uniform 2-vector. capGain bounds r (the medium's energy law as an algebra op). ──
    idC: (gain = 1) => ({ ...L.id(), gain }),
    logGain: (op) => Math.log(op.gain ?? 1),
    capGain: (op, rMax) => ((op.gain ?? 1) > rMax ? { ...op, gain: rMax } : op),
    // pin(op) / unpin(op): the SUBMANIFOLD projections. pin → the U(1) slice (gain forced to 1 — energy renormalized,
    // the amplitude DOF removed); unpin → the element as-is in ℂ* (its gain becomes free to vary). "lensU1 → lensC1"
    // for a live worldline IS unpin: not a mutation of the element (it always has all fields) but a change of WHICH
    // algebra governs it — a worldline acquiring the amplitude degree of freedom. repin projects it back (gain → 1).
    pin: (op) => (op.gain === 1 ? op : { ...op, gain: 1 }),
    unpin: (op) => op,   // identity on the element — "unpinned" is a governance choice the caller records, not a field
  };
  return L;
})();
// lensC1 — the FULL ℂ* group (gain free). lensU1 (above) is its UNITARY SUBGROUP: same object, but callers that use
// lensU1 DECLARE "I stay on the compact, energy-preserving, runaway-proof slice" (gain≡1). The subgroup relation is
// real and load-bearing — the thin apps' determinism-via-compactness depends on staying pinned. A worldline moves
// lensU1 → lensC1 by UNPINNING (gaining the amplitude DOF); ← by REPINNING (lensU1.pin, gain → 1). The names encode
// intent; `pin`/`unpin` are the transitions between the two governances.
const lensC1 = lensU1;

export { makeRegion, makeCarrier, linOp, linDemod, makeBand, makeDepthBand, subspaceCoherence, regionsOverlap,
         regionEventSoliton, regionWaveSoliton, defaultWaveCells, imageSoliton, place, atDepth,
         bind, regionBind, gate, recognizePure, recognizeFull, recall, geometrySoliton, operatorModality, operatorSoliton, operatorSolitonCyc, fitOperatorSoliton, unite, evalSolitonTemporalAt, evalSolitonTemporalLiveAt, lesionTravellingField, measureCarrierCrosstalk,
         probeObjects, PROBE_OBJECT_NAMES, makeProbeField,
         nlhoGenRegion, nlhoFixedPointFit, nlhoGenInject, nlhoReadGenerator, nlhoDefaultRules, nlhoResonanceRules, makeGenomeLens, genomeAggregate, probeSubpixelSeam,
         composeLens, barClockDepth, genomeFpCenters, genomeCodeField, readGenomeGrad, thetaWalk, runGenomeLens,
         opGeometryLens, opRecall, opSelfEvolve, opCoevolve, nlhoCoevolveTunnel, nlhoRuptureAdapt, nlhoInstantonHologram, nlhoLensWalk, nlhoClockWalk, nlhoClockMaps, nlhoDammannImage,
         perceptSharpness, opAutofocus, opHologram, opRecon, opPropagate, opOcclude, occludeField, occludeHolographic, applyLife,
         opCodeMask, opCodeWarp, makePerception, makeTrapStack, lensU1, lensC1 };
// CARRIER path (eventSoliton, carrierEventSoliton, carrierWaveSoliton, evalSolitonAt) moved to
// soliton-algebra-research.js (§7.44/§7.47: the live app is temporal; carriers are the non-live original).
