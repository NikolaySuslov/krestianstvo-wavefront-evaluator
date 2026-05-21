/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── krestianstvo-wavefront-physics.js ────────────────────────────────────────
//
// Shared physics library for krestianstvo-wavefront-evaluator examples.
//
// Three layers:
//
//   FRAG.*       — Template string fragments. Concatenate into a world-program
//                  template before the app-specific behaviour. Each fragment
//                  declares one or more pure named functions; explicit grid/ncells
//                  parameters replace implicit globals so fragments are reusable
//                  across different grid sizes.
//
//                  Usage (outer scope, at module load time):
//                    import { FRAG } from './krestianstvo-wavefront-physics.js';
//                    const worldProg = `
//                      ${FRAG.nlsOps(GRID, N_CELLS)}
//                      ${FRAG.ifsStencil(GRID)}
//                      ${FRAG.ifsKernels}
//                      ${FRAG.specCorr(GRID, N_CELLS, IFS_DEPTH)}
//                      ${FRAG.topoOps(GRID, N_CELLS)}
//                      // ... app-specific code ...
//                    `;
//
//   kernel.*     — Outer-scope kernel builders. Call inside finalizeFresnelm
//                  (world program context) or at module load time.
//                  Returns { fRadii, fWeights, sEff? }.
//
//   colormaps.*  — Renderer-side RGB colormaps. No DOM dependencies.
//
// ── IFS-native operation taxonomy ─────────────────────────────────────────────
//
//   IFS-native FFT      hologram beat:       Huygens IFS forward propagation
//                       IFS shell ≈ spatial-frequency annular component
//
//   IFS-native iFFT     hologram reconBeat:  Huygens IFS back-propagation
//                       Time-reversed IFS clock = phase-conjugate reconstruction
//
//   IFS-native PSD      specCorr:            g²(L)/g²(0) intensity autocorrelation
//                       IFS depth ↔ spatial-frequency octave
//
//   IFS-native ∂        linearStepIFS:       IFS-discovered ring-stencil Laplacian
//                       Riesz:  K(r) = α/r^{2s}   (explicit fractional order)
//                       Native: K(r) = α·count(r)/N  (IFS measure, emergent s)
//
//   IFS-native soliton  NLS Strang split:    NL(dt/2) · LinearIFS(dt) · NL(dt/2)
//
//   IFS-native instanton same + vortex injection + topological vacuum tunneling
//
//   IFS-native WT       ifsWavelet:          _ifsAnalyze / _ifsSynthesize / _buildDepthKernels
//                       Sub-band image per depth: ring-average of |ψ|² at IFS-depth radii
//                       Synthesis = adjoint back-projection → intensity reconstruction
//
// ── Default IFS clock parameters ─────────────────────────────────────────────
export const IFS_MAPS_DEFAULT = [
  0.3090169944,  // cos(72°)   — pentagonal / icosahedral
  0.4142135623,  // √2 - 1     — silver ratio
  0.5,           // 1/2        — dyadic
  0.6180339887,  // φ⁻¹        — golden ratio
  0.7071067812,  // 1/√2       — octagonal
  0.7320508075,  // √3 - 1     — hexagonal
];

// ── FRAG: template string fragments ──────────────────────────────────────────
export const FRAG = {

  // ── NLS field operations ──────────────────────────────────────────────────
  // Defines: _nlHalf, _power, _addSoliton
  // Requires: ISAT, GAMMA injected as consts in template scope.
  nlsOps: (grid, ncells) => `
  // Exact NL half-step: ψ → ψ · exp(-i·γ·sat(|ψ|²)·dt)
  const _nlHalf = (psi, dt) => {
    const out = psi.slice();
    for (let j = 0; j < ${ncells}; j++) {
      const re = psi[j*2], im = psi[j*2+1];
      const amp2 = re*re + im*im;
      const g    = GAMMA * amp2 / (1 + amp2 / ISAT);
      const ph   = -g * dt;
      const c = Math.cos(ph), s = Math.sin(ph);
      out[j*2]   = re*c - im*s;
      out[j*2+1] = re*s + im*c;
    }
    return out;
  };
  // Total field power ∫|ψ|²
  const _power = (psi) => {
    let p = 0;
    for (let j = 0; j < ${ncells}; j++) p += psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
    return p;
  };
  // Inject sech-envelope soliton at (sx,sy) with velocity (vx,vy)
  const _addSoliton = (psi, sx, sy, amp, vx, vy, w, ph0) => {
    ph0 = ph0 ?? 0;
    const out = psi.slice();
    for (let cy = 0; cy < ${grid}; cy++) {
      for (let cx = 0; cx < ${grid}; cx++) {
        const dx = cx - sx, dy = cy - sy;
        const r   = Math.sqrt(dx*dx + dy*dy);
        const env = amp / Math.cosh(r / w);
        if (env < 1e-4) continue;
        const ph = vx*cx + vy*cy + ph0;
        const id = cy*${grid} + cx;
        out[id*2]   += env * Math.cos(ph);
        out[id*2+1] += env * Math.sin(ph);
      }
    }
    return out;
  };`,

  // ── Symplectic IFS Laplacian (Störmer-Verlet leapfrog) ───────────────────
  // Defines: _linearStepIFS(psi, dt, fRadii, fWeights)
  // Extends the standard r=1 stencil with arbitrary ring radii and weights.
  // Implements -½(-∇²)^s: 3-step Re→Im→Re with periodic boundary conditions.
  // Full-ring circumference sampling (isotropic) — no cross-shaped PSF artifact.
  ifsStencil: (grid) => `
  // IFS-driven fractional Laplacian: 3-step symplectic leapfrog, isotropic rings.
  // fRadii[d], fWeights[d]: IFS-discovered rings and their kernel weights.
  // Ring offsets precomputed once: nSteps = ceil(2π·r), uniformly sampled angles.
  const _buildRingOffsets = (fRadii) => fRadii.map(r => {
    const nSteps = Math.max(8, Math.ceil(2 * Math.PI * r));
    const offs = [];
    for (let k = 0; k < nSteps; k++) {
      offs.push([
        Math.round(r * Math.cos(k * 2 * Math.PI / nSteps)),
        Math.round(r * Math.sin(k * 2 * Math.PI / nSteps)),
      ]);
    }
    return offs;
  });
  const _lapRing = (buf, cx, cy, offs, ch) => {
    const G = ${grid};
    let acc = 0;
    for (const [dx, dy] of offs)
      acc += buf[((((cy+dy)%G+G)%G)*G+(((cx+dx)%G+G)%G))*2+ch];
    // Same convention as nearest-neighbour stencil: Σ_ring - n·center
    // fWeights already calibrated for 4-point (n=4) convention via fracAlpha/totalBeats.
    // Dividing by offs.length/4 keeps the effective coupling per ring at the same scale.
    return (acc - offs.length * buf[(cy*G+cx)*2+ch]) * (4 / offs.length);
  };
  const _linearStepIFS = (psi, dt, fRadii, fWeights) => {
    const out  = psi.slice();
    const h    = dt * 0.25;
    const f    = dt * 0.5;
    const nF   = fRadii.length;
    const G    = ${grid};
    const offs = _buildRingOffsets(fRadii);
    // Step 1: Re -= (dt/4)·[∇²Im + Σ_d fw_d·ring_d Im]
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        const id = y*G + x;
        let lap = out[(y*G+(x+1)%G)*2+1] + out[(y*G+(x-1+G)%G)*2+1]
                + out[(((y+1)%G)*G+x)*2+1] + out[(((y-1+G)%G)*G+x)*2+1]
                - 4*out[id*2+1];
        for (let d = 0; d < nF; d++) lap += fWeights[d] * _lapRing(out, x, y, offs[d], 1);
        out[id*2] -= h * lap;
      }
    }
    // Step 2: Im += (dt/2)·[∇²Re_half + Σ_d fw_d·ring_d Re_half]
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        const id = y*G + x;
        let lap = out[(y*G+(x+1)%G)*2] + out[(y*G+(x-1+G)%G)*2]
                + out[(((y+1)%G)*G+x)*2] + out[(((y-1+G)%G)*G+x)*2]
                - 4*out[id*2];
        for (let d = 0; d < nF; d++) lap += fWeights[d] * _lapRing(out, x, y, offs[d], 0);
        out[id*2+1] += f * lap;
      }
    }
    // Step 3: Re -= (dt/4)·[∇²Im_new + Σ_d fw_d·ring_d Im_new]
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        const id = y*G + x;
        let lap = out[(y*G+(x+1)%G)*2+1] + out[(y*G+(x-1+G)%G)*2+1]
                + out[(((y+1)%G)*G+x)*2+1] + out[(((y-1+G)%G)*G+x)*2+1]
                - 4*out[id*2+1];
        for (let d = 0; d < nF; d++) lap += fWeights[d] * _lapRing(out, x, y, offs[d], 1);
        out[id*2] -= h * lap;
      }
    }
    return out;
  };`,

  // ── IFS kernel builders (world-program side) ──────────────────────────────
  // Defines: _buildRieszKernel(fracKernel, fracAlpha, fracS, fracRefSum)
  //          _buildNativeKernel(fracKernel, fracAlpha)
  //
  // Both return { fRadii, fWeights, sEff }.
  // Call inside finalizeFresnelm after fresnelBeats have populated fracKernel.
  ifsKernels: `
  // Riesz kernel: K(r) = FRAC_ALPHA * norm / r^{2s}
  // norm keeps Σfw = FRAC_ALPHA * fracRefSum regardless of how many IFS bands fire.
  // fracRefSum = Σ r^{-2s} for a reference set (e.g. [2,4,8,16]).
  const _buildRieszKernel = (fracKernel, fracAlpha, fracS, fracRefSum) => {
    const radiiSet = new Set(fracKernel);
    const fRadii   = [...radiiSet].sort((a, b) => a - b);
    const ifsSum   = fRadii.reduce((acc, r) => acc + Math.pow(r, -2*fracS), 0) || fracRefSum;
    const norm     = fracRefSum / ifsSum;
    const fWeights = fRadii.map(r => fracAlpha * norm / Math.pow(r, 2 * fracS));
    const sEff     = fracS;
    return { fRadii, fWeights, sEff };
  };
  // IFS-native kernel: K(r) = fracAlpha * count(r) / totalBeats
  // The IFS empirical visit-frequency IS the kernel — no external 1/r^{2s}.
  // Fractional order s emerges from IFS geometry (log-log slope of w vs r).
  const _buildNativeKernel = (fracKernel, fracAlpha) => {
    const countMap = new Map();
    for (const r of fracKernel) countMap.set(r, (countMap.get(r) ?? 0) + 1);
    const totalBeats = fracKernel.length || 1;
    const fRadii   = [...countMap.keys()].sort((a, b) => a - b);
    const fWeights = fRadii.map(r => fracAlpha * countMap.get(r) / totalBeats);
    // Estimate emergent s: log-log slope of w(r) vs r; for ρ(r)~1/r → s≈0.5
    let sEff = 0;
    if (fRadii.length >= 2) {
      const logR = fRadii.map(r => Math.log(r));
      const logW = fWeights.map(w => Math.log(w + 1e-30));
      const n = fRadii.length;
      const mR = logR.reduce((a, b) => a + b, 0) / n;
      const mW = logW.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (logR[i]-mR)*(logW[i]-mW); den += (logR[i]-mR)**2; }
      sEff = den > 1e-10 ? -num / (2 * den) : 0;
    }
    return { fRadii, fWeights, sEff };
  };`,

  // ── IFS-native PSD: g²(L)/g²(0) intensity autocorrelation ───────────────
  // Defines: _computeSpecCorr(psi, ifsDepth) → number[]
  // Computes spatial intensity autocorrelation at lags tied to IFS depth bands.
  // g²(L)/g²(0) = <I(x)·I(x+L)> / <I²>: carrier-phase independent, ∈ [0,1].
  // 1 = fully coherent compact soliton; ~0 = dispersed incoherent field.
  specCorr: (grid, ncells, ifsDepth) => `
  const _computeSpecCorr = (psi) => {
    const lags = [${grid} >> 2, ${grid} >> 3, ${grid} >> 4, ${grid} >> 5];
    const specCorr = new Array(${ifsDepth}).fill(0);
    let g0 = 0;
    for (let j = 0; j < ${ncells}; j++) {
      const I = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
      g0 += I * I;
    }
    g0 /= ${ncells};
    if (g0 < 1e-18) return specCorr;
    for (let d = 0; d < ${ifsDepth}; d++) {
      const lag = lags[d] ?? 1;
      let sum = 0;
      for (let cy = 0; cy < ${grid}; cy++) {
        for (let cx = 0; cx < ${grid}; cx++) {
          const cid = cy*${grid} + cx;
          const rh  = cy*${grid} + ((cx+lag) & (${grid}-1));
          const rv  = ((cy+lag) & (${grid}-1))*${grid} + cx;
          const I_c = psi[cid*2]*psi[cid*2] + psi[cid*2+1]*psi[cid*2+1];
          const I_h = psi[rh*2]*psi[rh*2] + psi[rh*2+1]*psi[rh*2+1];
          const I_v = psi[rv*2]*psi[rv*2] + psi[rv*2+1]*psi[rv*2+1];
          sum += I_c * (I_h + I_v) * 0.5;
        }
      }
      specCorr[d] = (sum / ${ncells}) / g0;
    }
    return specCorr;
  };`,

  // ── Topological operations (instanton) ───────────────────────────────────
  // Defines: _topoCharge(psi), _totalWinding(q), _addVortex(psi, ox, oy, charge)
  // Lattice plaquette method: q(x,y) = (1/2π) Σ_plaquette wrapped phase diffs.
  // ±1 at vortex/anti-vortex cores, ≈0 elsewhere.
  topoOps: (grid, ncells) => `
  const _topoCharge = (psi) => {
    const q   = new Float32Array(${ncells});
    const PI2 = 2 * Math.PI;
    const wrap = (d) => {
      while (d >  Math.PI) d -= PI2;
      while (d < -Math.PI) d += PI2;
      return d;
    };
    const ph = (py, px) => {
      const id = py * ${grid} + px;
      if (psi[id*2]*psi[id*2] + psi[id*2+1]*psi[id*2+1] < 0.01) return 0;
      return Math.atan2(psi[id*2+1], psi[id*2]);
    };
    for (let y = 0; y < ${grid} - 1; y++) {
      for (let x = 0; x < ${grid} - 1; x++) {
        const dph = wrap(ph(y,x+1)    - ph(y,x))    +
                    wrap(ph(y+1,x+1)  - ph(y,x+1))  +
                    wrap(ph(y+1,x)    - ph(y+1,x+1)) +
                    wrap(ph(y,x)      - ph(y+1,x));
        q[y * ${grid} + x] = dph / PI2;
      }
    }
    return q;
  };
  const _totalWinding = (q) => {
    let total = 0;
    for (let i = 0; i < ${ncells}; i++) if (Math.abs(q[i]) > 0.4) total += Math.round(q[i]);
    return total;
  };
  // Inject topological charge: ψ → ψ · exp(i·charge·θ) around (ox,oy)
  const _addVortex = (psi, ox, oy, charge) => {
    const out = psi.slice();
    for (let y = 0; y < ${grid}; y++) {
      for (let x = 0; x < ${grid}; x++) {
        const dx = x - ox, dy = y - oy;
        if (dx*dx + dy*dy < 0.25) continue;
        const ph = charge * Math.atan2(dy, dx);
        const id = y*${grid} + x;
        const re = out[id*2], im = out[id*2+1];
        const c = Math.cos(ph), ss = Math.sin(ph);
        out[id*2]   = re*c - im*ss;
        out[id*2+1] = re*ss + im*c;
      }
    }
    return out;
  };`,

  // ── IFS beat scheduler (world-program side) ───────────────────────────────
  // Defines: _ifsFireChildren(ctx, p, beatName, reconBeatName)
  // Call at the start of every beat/fresnelBeat handler to spawn the IFS tree.
  // Consumes exactly 2 RNG values per call for peer determinism.
  // ifsMaps, ifsGenCap, ifsMinDelay, ifsDepth must be consts in template scope.
  ifsScheduler: `
  const _ifsFireChildren = (ctx, p, beatName, nextBeatName) => {
    const { depth, delay, gen } = p;
    const selfR      = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
    const childR     = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
    const selfDelay  = delay * selfR;
    const childDelay = delay * childR;
    if (gen < IFS_GEN_CAP && selfDelay > IFS_MIN_DELAY)
      ctx.future(selfDelay, beatName,
        { ...p, delay: selfDelay, gen: gen + 1 });
    if (gen === 0 && depth + 1 < IFS_DEPTH && childDelay > IFS_MIN_DELAY)
      ctx.future(selfDelay + childDelay, nextBeatName ?? beatName,
        { ...p, depth: depth + 1, delay: childDelay, gen: 0 });
    return { selfDelay, childDelay };
  };`,

  // ── IFS-native wavelet transform ─────────────────────────────────────────
  // Defines: _ifsAnalyze(psi, kernelByDepth) → Float32Array[]
  //          _ifsSynthesize(bands, kernelByDepth) → Float32Array
  //          _ifsResidual(psi, bands, kernelByDepth) → Float32Array
  //
  // Analysis: each depth band d has a set of (radius, weight) pairs built from
  // the IFS beat tree (same fracKernel split by depth). The sub-band image for
  // depth d at pixel x is:
  //   C_d(x) = Σ_{(r,w)∈band_d}  w · ring_avg(|ψ|, x, r)
  // where ring_avg is the mean intensity on the axial ring of radius r.
  //
  // Synthesis: weighted back-projection from sub-band images:
  //   ψ_recon(x) = Σ_d Σ_{(r,w)∈band_d}  w · (C_d ⊛ ring_delta)(x)
  // ring_delta at radius r: 1/(4r) on the 4 nearest ring pixels (N/S/E/W).
  //
  // kernelByDepth: Array(ifsDepth) of { radii: number[], weights: number[] }
  // Built by accumulating fracKernel entries tagged with their IFS depth.
  ifsWavelet: (grid, ncells, ifsDepth) => `
  // IFS-native analysis: project intensity onto per-depth ring kernels
  // Returns ifsDepth Float32Arrays, each holding one sub-band image (real-valued).
  const _ifsAnalyze = (psi, kernelByDepth) => {
    const bands = [];
    for (let d = 0; d < ${ifsDepth}; d++) {
      const band = new Float32Array(${ncells});
      const kb = kernelByDepth[d];
      if (!kb || kb.radii.length === 0) { bands.push(band); continue; }
      for (let cy = 0; cy < ${grid}; cy++) {
        for (let cx = 0; cx < ${grid}; cx++) {
          const cid = cy * ${grid} + cx;
          let acc = 0;
          for (let k = 0; k < kb.radii.length; k++) {
            const r = kb.radii[k], w = kb.weights[k];
            const r0 = cy * ${grid} + ((cx + r) & (${grid} - 1));
            const r1 = cy * ${grid} + ((cx - r + ${grid}) & (${grid} - 1));
            const r2 = ((cy + r) & (${grid} - 1)) * ${grid} + cx;
            const r3 = ((cy - r + ${grid}) & (${grid} - 1)) * ${grid} + cx;
            const I0 = psi[r0*2]*psi[r0*2] + psi[r0*2+1]*psi[r0*2+1];
            const I1 = psi[r1*2]*psi[r1*2] + psi[r1*2+1]*psi[r1*2+1];
            const I2 = psi[r2*2]*psi[r2*2] + psi[r2*2+1]*psi[r2*2+1];
            const I3 = psi[r3*2]*psi[r3*2] + psi[r3*2+1]*psi[r3*2+1];
            acc += w * (I0 + I1 + I2 + I3) * 0.25;
          }
          band[cid] = acc;
        }
      }
      bands.push(band);
    }
    return bands;
  };
  // IFS-native synthesis: back-project sub-band images into a scalar field
  // Returns Float32Array of length ncells (intensity estimate).
  const _ifsSynthesize = (bands, kernelByDepth) => {
    const out = new Float32Array(${ncells});
    for (let d = 0; d < ${ifsDepth}; d++) {
      const band = bands[d];
      const kb = kernelByDepth[d];
      if (!kb || kb.radii.length === 0) continue;
      for (let cy = 0; cy < ${grid}; cy++) {
        for (let cx = 0; cx < ${grid}; cx++) {
          let acc = 0;
          for (let k = 0; k < kb.radii.length; k++) {
            const r = kb.radii[k], w = kb.weights[k];
            const r0 = cy * ${grid} + ((cx + r) & (${grid} - 1));
            const r1 = cy * ${grid} + ((cx - r + ${grid}) & (${grid} - 1));
            const r2 = ((cy + r) & (${grid} - 1)) * ${grid} + cx;
            const r3 = ((cy - r + ${grid}) & (${grid} - 1)) * ${grid} + cx;
            acc += w * (band[r0] + band[r1] + band[r2] + band[r3]) * 0.25;
          }
          out[cy * ${grid} + cx] += acc;
        }
      }
    }
    return out;
  };
  // Build per-depth kernel from fracKernelByDepth accumulated in beat handlers
  const _buildDepthKernels = (fracKernelByDepth, fracAlpha) => {
    return fracKernelByDepth.map(depthKernel => {
      if (!depthKernel || depthKernel.length === 0) return { radii: [], weights: [] };
      const countMap = new Map();
      for (const r of depthKernel) countMap.set(r, (countMap.get(r) ?? 0) + 1);
      const total = depthKernel.length;
      const radii   = [...countMap.keys()].sort((a, b) => a - b);
      const weights = radii.map(r => fracAlpha * countMap.get(r) / total);
      return { radii, weights };
    });
  };`,

  // ── Huygens wavefront propagation (hologram) ─────────────────────────────
  // Defines: _huygensShellAccum(field, sources, distTarget, wavelength, grid, amp)
  //          _refPhase(cx, refKx)
  //          _extractPlusOneOrder(objField, refKx, grid, ncells)
  //
  // IFS-native FFT:  beat → _huygensShellAccum → plate  (forward propagation)
  // IFS-native iFFT: reconBeat back-propagates plate → recon using same clock
  huygens: (grid, ncells) => `
  // Accumulate Huygens wavefront contributions from sources onto field at shell dist
  const _huygensShellAccum = (field, sources, distTarget, wavelength, grid) => {
    const TWO_PI_OVER_WL = (2 * Math.PI) / wavelength;
    const out = field.slice();
    for (const { sx, sy, sz, amp } of sources) {
      for (let cy = 0; cy < grid; cy++) {
        for (let cx = 0; cx < grid; cx++) {
          const dx = cx - sx, dy = cy - sy;
          const dist2d = Math.sqrt(dx*dx + dy*dy);
          if (Math.abs(dist2d - distTarget) >= 1.5) continue;
          const dist3d = Math.sqrt(dx*dx + dy*dy + (sz ?? 0)*(sz ?? 0));
          const phase  = dist3d * TWO_PI_OVER_WL;
          const id     = cy * grid + cx;
          out[id*2]   += amp * Math.cos(phase);
          out[id*2+1] += amp * Math.sin(phase);
        }
      }
    }
    return out;
  };
  // Off-axis reference beam phase at column cx
  const _refPhase = (cx, refKx) => 2 * Math.PI * refKx * cx;
  // Extract +1 diffraction order: E_obj · conj(E_ref) = E_obj · exp(-i·rp)
  // Discards DC and -1 order → sparse plate, cleaner reconstruction
  const _extractPlusOneOrder = (objField, refKx, grid, ncells) => {
    const plate = new Array(2 * ncells).fill(0);
    for (let cy = 0; cy < grid; cy++) {
      for (let cx = 0; cx < grid; cx++) {
        const id  = cy * grid + cx;
        const rp  = _refPhase(cx, refKx);
        const oRe = objField[id*2], oIm = objField[id*2+1];
        plate[id*2]   = oRe * Math.cos(rp) + oIm * Math.sin(rp);
        plate[id*2+1] = oIm * Math.cos(rp) - oRe * Math.sin(rp);
      }
    }
    return plate;
  };`,

};

// ── kernel.*: outer-scope kernel builders ────────────────────────────────────
// These run in the app module (not inside world program strings).
// Useful for precomputing kernels at module load or for testing.

export const kernel = {

  // Riesz kernel with explicit fractional order s and normalization reference.
  riesz: (fracKernel, fracAlpha, fracS, fracRefSum) => {
    const radiiSet = new Set(fracKernel);
    const fRadii   = [...radiiSet].sort((a, b) => a - b);
    const ifsSum   = fRadii.reduce((acc, r) => acc + Math.pow(r, -2*fracS), 0) || fracRefSum;
    const norm     = fracRefSum / ifsSum;
    const fWeights = fRadii.map(r => fracAlpha * norm / Math.pow(r, 2 * fracS));
    return { fRadii, fWeights, sEff: fracS };
  },

  // IFS-native kernel: empirical visit-count distribution, emergent s.
  native: (fracKernel, fracAlpha) => {
    const countMap = new Map();
    for (const r of fracKernel) countMap.set(r, (countMap.get(r) ?? 0) + 1);
    const totalBeats = fracKernel.length || 1;
    const fRadii   = [...countMap.keys()].sort((a, b) => a - b);
    const fWeights = fRadii.map(r => fracAlpha * countMap.get(r) / totalBeats);
    const sEff     = estimateSeff(fRadii, fWeights);
    return { fRadii, fWeights, sEff };
  },

  // Reference sum Σ r^{-2s} for a set of reference radii.
  // Use [2,4,8,16] to match the 4 fixed rings in nls.js / instanton.js.
  rieszRefSum: (refRadii, fracS) =>
    refRadii.reduce((s, r) => s + Math.pow(r, -2 * fracS), 0),
};

// Estimate effective fractional order from log-log slope of w(r) vs r.
// For IFS-native kernel: ρ(r)~1/r → s_eff ≈ 0.5.
export function estimateSeff(fRadii, fWeights) {
  if (fRadii.length < 2) return 0;
  const n    = fRadii.length;
  const logR = fRadii.map(r => Math.log(r));
  const logW = fWeights.map(w => Math.log(w + 1e-30));
  const mR   = logR.reduce((a, b) => a + b, 0) / n;
  const mW   = logW.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (logR[i]-mR)*(logW[i]-mW); den += (logR[i]-mR)**2; }
  return den > 1e-10 ? -num / (2 * den) : 0;
}

// ── colormaps.*: renderer-side RGB utilities ──────────────────────────────────

export const colormaps = {

  // Hot colormap: black → red → yellow → white.  v ∈ [0,1]
  hot: (v) => [
    Math.min(255, Math.floor(v * 3 * 255)),
    Math.min(255, Math.max(0, Math.floor((v * 3 - 1) * 255))),
    Math.min(255, Math.max(0, Math.floor((v * 3 - 2) * 255))),
  ],

  // Phase + amplitude → HSV-like RGB.  norm = 1/sqrt(maxIntensity).
  phase: (re, im, norm) => {
    const amp = Math.sqrt(re*re + im*im) * norm;
    if (amp < 0.015) return [0, 0, 0];
    const hue = (Math.atan2(im, re) / (2 * Math.PI) + 1) % 1;
    const v   = Math.min(1, Math.log(1 + 6 * amp) / Math.log(7));
    const hi  = Math.floor(hue * 6) % 6;
    const f   = hue * 6 - Math.floor(hue * 6);
    const q   = v * (1 - f), t0 = v * f;
    const rgb = [[v,t0,0],[q,v,0],[0,v,t0],[0,q,v],[t0,0,v],[v,0,q]][hi];
    return rgb.map(x => Math.floor(x * 255));
  },

  // Topological charge density → RGB.  red = +vortex, blue = −anti-vortex.
  charge: (q) => {
    const a = Math.min(1, Math.abs(q) * 4);
    if (a < 0.04) return [8, 8, 8];
    if (q > 0)    return [Math.round(255 * a), Math.round(50 * a * a), 0];
    return [0, Math.round(50 * a * a), Math.round(255 * a)];
  },

  // Wavelet sub-band colormap.  v ∈ [0,1], green-cyan gradient
  wavelet: (v) => {
    const b = Math.min(255, Math.floor(v * 1.5 * 255));
    const g = Math.min(255, Math.floor(v * 2.5 * 255));
    const r = Math.min(255, Math.max(0, Math.floor((v * 4 - 2) * 255)));
    return [r, g, b];
  },

  // Hologram intensity colormap.  v ∈ [0,1], blue-dominant
  hologram: (v) => {
    const b = Math.min(255, Math.floor(v * 2 * 255));
    const g = Math.min(255, Math.max(0, Math.floor((v * 3 - 1) * 255)));
    const r = Math.min(255, Math.max(0, Math.floor((v * 4 - 3) * 255)));
    return [r, g, b];
  },
};

// ── IFS clock parameters helper ───────────────────────────────────────────────
// Computes the standard IFS timing parameters for a given grid and delay scale.
// Returns an object with all timing constants ready to inject into a template.
export function makeIFSParams({
  grid,
  delayScale,
  gridCoverage = 0.35,   // fraction of grid radius to cover with IFS roots
  doneFactor   = 8,      // DONE_DELAY = BASE_DELAY × doneFactor
  nRoots       = 10,     // number of log-spaced IFS roots
} = {}) {
  const ifsBaseDelay    = parseFloat((delayScale * grid * gridCoverage).toFixed(6));
  const fresnelDoneDelay = parseFloat((ifsBaseDelay * doneFactor).toFixed(4));
  return {
    ifsBaseDelay,
    fresnelDoneDelay,
    nRoots,
    logMin: Math.log(0.10 * 2.0),
    logMax: Math.log(ifsBaseDelay),
  };
}
