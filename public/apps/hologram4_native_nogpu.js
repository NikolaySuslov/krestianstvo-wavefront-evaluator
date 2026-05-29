/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── Hologram4 | Fully Native IFS Holography ──────────────────────────────────
//
// Strict native spacetime: object, reference, recording, and reconstruction are
// all generated solely by _linearStepIFS / fresnelBeat — no external math.
//
// Object wave:  depth-tier-encoded sources (sz → N_DEPTH_TIERS IFS delay buckets)
// Reference:    line of unit sources at y=0 → T_RECORD IFS steps (refField)
// Plate:        |ψ_obj_IFS + refField|²  accumulated with PLATE_DECAY
// Reconstruct:  psi_0 = plate × conj(refField) → T_RECORD backward IFS steps
//               → Lévy-flight tails collapse, source constellation re-focuses
//
// The "anomalous tails" in reconstruction are physical — proof of fractal medium.
//
// Mode RECORD  (+DT): source continuously drives ψ → fringes form on plate.
// Mode RECON   (−DT): reference×plate initialises ψ, propagates backward →
//                     cube wavefront reconstructs in the intensity canvas.
//
// Controls:
//   Drag any canvas or wireframe → rotate cube (updates source at next cycle)
//   [RECORD]  /  [RECONSTRUCT] buttons → toggle propagation direction
//   [RESET PLATE] button → clear accumulated exposure and return to init angle
//   Dbl-click any canvas → manual IFS next-cycle

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
const SUBTICK_MS   = 0.09;

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID    = 64;
const N_CELLS = GRID * GRID;

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH   = 2.0;
const DELAY_SCALE  = 0.06;
const GAMMA        = 0.0;     // linear — free-space paraxial propagation
const ISAT         = 1e9;     // saturation disabled
const DT           = 0.12;
const REF_AMP      = 0.3;     // reference plane-wave amplitude
const REF_KX       = 0.08;    // reference wave tilt (x-component of k-vector)
const SRC_ALPHA    = 0.08;    // relaxation toward psiSnap — bounded steady state
const PLATE_DECAY  = 0.994;   // time-exposure decay per physics step

// ── IFS fractal clock ─────────────────────────────────────────────────────────
const IFS_DEPTH      = 8;
const IFS_MAPS       = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP    = 3;
const IFS_MIN_DELAY  = 0.25;
const IFS_BASE_DELAY = parseFloat((DELAY_SCALE * GRID * 0.35).toFixed(6));
const FRESNEL_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 8).toFixed(4));
const N_FRESNEL_ROOTS = 8;
const PHYS_STEPS        = 1;
const NEXT_STEP_DELAY   = 1;
const RECON_STEP_DELAY  = 50;  // ms between backward steps — one per reflector tick, visible
const RECON_HOLD_MS     = 1500; // ms to hold at focal depth before looping
const T_RECORD          = 100;  // IFS pulse steps: forward (record) = backward (reconstruct)

// ── IFS-native Laplacian ──────────────────────────────────────────────────────
const FRAC_ALPHA    = 0.03;   // less ring energy → tighter halos, sharper point features
const MAX_IFS_BANDS = 4;

// ── Depth tier encoding ───────────────────────────────────────────────────────
const N_DEPTH_TIERS = 4;

// ── Recording mode ────────────────────────────────────────────────────────────
// TOMO_MODE = true:  per-tier IFS propagation — exact nonlinear dispersion,
//                    enables depth cloud tomography. Cost: ~N/2 × T_RECORD steps.
// TOMO_MODE = false: single-field phase modulation — linear depth encoding,
//                    ~4× faster plate accumulation, no tomography.
const TOMO_MODE = false;

// ── Render ────────────────────────────────────────────────────────────────────
const RENDER_SCALE = 5;

// ── Cube geometry ─────────────────────────────────────────────────────────────
const PTS_PER_EDGE = 8;
const CAM_Z        = 4.5;
const PROJ_SCALE   = 2 / (7 * (1 - 1 / GRID));
const INIT_ANGLE_Y = 0.7853981634;
const INIT_ANGLE_X = 0.5235987756;

const CUBE_VERTS = [
  [-1,-1,-1],[ 1,-1,-1],[ 1, 1,-1],[-1, 1,-1],
  [-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1],
];
const CUBE_EDGES = [
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7],
];
function _sampleEdges() {
  const pts = [];
  for (const [ai, bi] of CUBE_EDGES) {
    const a = CUBE_VERTS[ai], b = CUBE_VERTS[bi];
    for (let t = 0; t < PTS_PER_EDGE; t++) {
      const u = (t + 0.5) / PTS_PER_EDGE;
      pts.push([a[0]+u*(b[0]-a[0]), a[1]+u*(b[1]-a[1]), a[2]+u*(b[2]-a[2])]);
    }
  }
  return pts;
}
const CUBE_PTS      = _sampleEdges();
const CUBE_PTS_JSON = JSON.stringify(CUBE_PTS);

// ── World program ─────────────────────────────────────────────────────────────
const hologram4WorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const GRID             = ${GRID};
  const NCELLS           = ${N_CELLS};
  const WAVELENGTH       = ${WAVELENGTH};
  const DELAY_SCALE      = ${DELAY_SCALE};
  const GAMMA            = ${GAMMA};
  const ISAT             = ${ISAT};
  const DT               = ${DT};
  const REF_AMP          = ${REF_AMP};
  const REF_KX           = ${REF_KX};
  const SRC_ALPHA        = ${SRC_ALPHA};
  const PLATE_DECAY      = ${PLATE_DECAY};
  const IFS_DEPTH        = ${IFS_DEPTH};
  const IFS_MAPS         = ${JSON.stringify(IFS_MAPS)};
  const IFS_GEN_CAP      = ${IFS_GEN_CAP};
  const IFS_MIN_DELAY    = ${IFS_MIN_DELAY};
  const IFS_BASE_DELAY   = ${IFS_BASE_DELAY};
  const FRESNEL_DONE_DELAY = ${FRESNEL_DONE_DELAY};
  const N_FRESNEL_ROOTS  = ${N_FRESNEL_ROOTS};
  const PHYS_STEPS       = ${PHYS_STEPS};
  const NEXT_STEP_DELAY   = ${NEXT_STEP_DELAY};
  const RECON_STEP_DELAY  = ${RECON_STEP_DELAY};
  const RECON_HOLD_MS     = ${RECON_HOLD_MS};
  const T_RECORD          = ${T_RECORD};
  const FRAC_ALPHA       = ${FRAC_ALPHA};
  const MAX_IFS_BANDS    = ${MAX_IFS_BANDS};
  const TWO_PI           = 2 * Math.PI;
  const CUBE_PTS         = ${CUBE_PTS_JSON};
  const CAM_Z            = ${CAM_Z};
  const PROJ_SCALE       = ${PROJ_SCALE};
  const INIT_ANGLE_Y     = ${INIT_ANGLE_Y};
  const INIT_ANGLE_X     = ${INIT_ANGLE_X};

  ${FRAG.nlsOps(GRID, N_CELLS)}
  ${FRAG.ifsStencil(GRID)}
  ${FRAG.ifsKernels}
  ${FRAG.ifsScheduler}

  // ── Project cube sources onto plate plane ────────────────────────────────
  const _projectSources = (angleY, angleX) => {
    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const halfG = (GRID - 1) / 2;
    const fscale = halfG * PROJ_SCALE;
    const reconZ = Math.round(GRID / 16);   // λ²/reconZ > 2px keeps fringes above Nyquist
    const total  = CUBE_PTS.length;
    return CUBE_PTS.map(([ox, oy, oz]) => {
      const ry1 =  cosY * ox + sinY * oz;
      const rz1 = -sinY * ox + cosY * oz;
      const rx  =  ry1;
      const ry  =  cosX * oy - sinX * rz1;
      const rz  =  sinX * oy + cosX * rz1;
      const z   =  CAM_Z - rz;
      return {
        sx:  halfG + (rx / z) * fscale * CAM_Z,
        sy:  halfG - (ry / z) * fscale * CAM_Z,
        sz:  z * (reconZ / CAM_Z),
        amp: 40.0 * (0.5 + 0.5 * (rz + 1) / 2) / total,
      };
    });
  };

  // ── IFS-native source field ───────────────────────────────────────────────
  // Exact spherical Huygens wavelets do not exist in this universe — light
  // propagates via the fractional IFS Laplacian, not the standard wave eq.
  // Sources are injected as depth-phase-encoded point sources; the IFS
  // operator itself produces the native wavefronts (fractal diffraction tails,
  // Riesz-kernel halos instead of Airy disks).
  //
  // _buildSrcField  — with reference plane wave  (drives live ψ)
  // _buildSrcFieldIFS — object only, no reference  (drives _snapStep plate)
  const _buildSrcField = (angleY, angleX) => {
    const sources = _projectSources(angleY, angleX);
    const field   = new Float64Array(2 * NCELLS);
    const kWav    = TWO_PI / WAVELENGTH;
    for (let k = 0; k < sources.length; k++) {
      const { sx, sy, sz, amp } = sources[k];
      const ix = Math.round(sx) | 0, iy = Math.round(sy) | 0;
      if (ix < 0 || ix >= GRID || iy < 0 || iy >= GRID) continue;
      const j  = iy * GRID + ix;
      const ph = sz * kWav;
      field[j*2]   += amp * Math.cos(ph);
      field[j*2+1] += amp * Math.sin(ph);
    }
    for (let j = 0; j < NCELLS; j++) {
      const ph = REF_KX * (j % GRID);
      field[j*2]   += REF_AMP * Math.cos(ph);
      field[j*2+1] += REF_AMP * Math.sin(ph);
    }
    return field;
  };
  // IFS delay-tier depth encoding:
  // Sources are partitioned into N_DEPTH_TIERS buckets by projected depth sz.
  // Each tier d is independently evolved for T_d = T_RECORD * (d+1) / N_DEPTH_TIERS
  // IFS steps before being added to the plate — so near and far sources imprint
  // at different spatial-frequency bands in the hologram fringe pattern.
  //
  // Near (small sz, rz≈+1, tier 0) → fewest steps → high-frequency fringes.
  // Far  (large sz, rz≈-1, tier N-1) → most steps → low-frequency fringes.
  //
  // _buildSrcFieldsByDepth returns Float64Array[N_DEPTH_TIERS][2*NCELLS].
  // _buildSrcFieldIFS (legacy, RECON seed only) returns the flat sum of all tiers
  // at t=0 — the reconstruction starts from this and propagates backward.
  const N_DEPTH_TIERS = ${N_DEPTH_TIERS};
  const TOMO_MODE     = ${TOMO_MODE};
  const _buildSrcFieldsByDepth = (angleY, angleX, extraPoints) => {
    const sources = _projectSources(angleY, angleX);
    // Measure actual depth range from the projected sources so tiers always
    // spread across the full N_DEPTH_TIERS even when the cube is edge-on.
    let szMin = Infinity, szMax = -Infinity;
    for (const { sz } of sources) {
      if (sz < szMin) szMin = sz;
      if (sz > szMax) szMax = sz;
    }
    // Guarantee a minimum spread so a perfectly edge-on cube still partitions.
    const szRange = Math.max(1e-4, szMax - szMin);
    const tiers   = Array.from({ length: N_DEPTH_TIERS }, () => new Float64Array(2 * NCELLS));
    for (let k = 0; k < sources.length; k++) {
      const { sx, sy, sz, amp } = sources[k];
      const ix = Math.round(sx) | 0, iy = Math.round(sy) | 0;
      if (ix < 0 || ix >= GRID || iy < 0 || iy >= GRID) continue;
      const j = iy * GRID + ix;
      // t=0 → near (small sz), t=1 → far (large sz)
      const t  = Math.max(0, Math.min(1, (sz - szMin) / szRange));
      const d  = Math.min(N_DEPTH_TIERS - 1, Math.floor(t * N_DEPTH_TIERS));
      // Depth-encode phase: sources at different depths carry different complex phase.
      // This is physically correct — depth separation is encoded as phase delay (sz*kz).
      const ph = t * Math.PI * 4;
      tiers[d][j*2]   += amp * Math.cos(ph);
      tiers[d][j*2+1] += amp * Math.sin(ph);
    }
    // Extra right-click points go into the nearest tier
    for (const pt of (extraPoints ?? [])) {
      const j = pt.gy * GRID + pt.gx;
      const d = 0;
      tiers[d][j*2]   += pt.amp * Math.cos(pt.ph);
      tiers[d][j*2+1] += pt.amp * Math.sin(pt.ph);
    }
    return tiers;
  };
  const _buildSrcFieldIFS = (angleY, angleX, extraPoints) => {
    // Flat sum of all tiers at t=0 — used as live ψ initialiser in RECORD mode
    // and as the RECON seed (reconstruction propagates backward from this).
    const tiers = _buildSrcFieldsByDepth(angleY, angleX, extraPoints);
    const field = new Float64Array(2 * NCELLS);
    for (const tier of tiers) {
      for (let j = 0; j < 2 * NCELLS; j++) field[j] += tier[j];
    }
    return field;
  };

  // ── Build reconstruction initial field: (plate − DC) × analytic reference ─
  // The plate was recorded as |ψ_obj_IFS + ψ_ref_IFS|² (fully native).
  // For the reconstruction seed we use the analytic reference because it has
  // uniform amplitude everywhere — the native ref (propagated from y=0) can
  // have near-zero amplitude in grid regions the wave hasn't reached, making
  // the seed vanishingly small and killing the reconstruction.
  // The analytic reference here only seeds the initial psi; all propagation
  // is IFS-native (same snapshot kernel as recording).
  const _buildReconField = (plate) => {
    let maxP = 1e-9, sumP = 0;
    for (let j = 0; j < NCELLS; j++) {
      if (plate[j] > maxP) maxP = plate[j];
      sumP += plate[j];
    }
    const meanP  = sumP / NCELLS;
    const rangeP = Math.max(1e-9, maxP - meanP);
    const psi    = new Float64Array(2 * NCELLS);
    for (let j = 0; j < NCELLS; j++) {
      const cx  = j % GRID;
      const ph  = REF_KX * cx;
      const mod = Math.max(0, plate[j] - meanP) / rangeP;
      psi[j*2]   = mod * Math.cos(ph);
      psi[j*2+1] = mod * Math.sin(ph);
    }
    return psi;
  };

  // ── Depth-tier 3D point list ─────────────────────────────────────────────
  // Returns [{ox,oy,oz,tier,amp}] — cube edge points with tier assigned at the
  // current recording angle. Stored in state so the renderer can re-project at
  // any angle, making the cloud rotate in sync with the main view.
  const _buildTierPts3D = (angleY, angleX) => {
    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const total = CUBE_PTS.length;
    // Compute sz for each point to assign tiers
    const pts = CUBE_PTS.map(([ox, oy, oz]) => {
      const ry1 =  cosY*ox + sinY*oz, rz1 = -sinY*ox + cosY*oz;
      const rz  =  sinX*oy + cosX*rz1;
      const z   =  CAM_Z - rz;
      const amp = 40.0 * (0.5 + 0.5*(rz+1)/2) / total;
      return { ox, oy, oz, sz: z, amp };
    });
    let szMin = Infinity, szMax = -Infinity;
    for (const p of pts) { if (p.sz < szMin) szMin = p.sz; if (p.sz > szMax) szMax = p.sz; }
    const szRange = Math.max(1e-4, szMax - szMin);
    return pts.map(({ ox, oy, oz, sz, amp }) => {
      const t    = Math.max(0, Math.min(1, (sz - szMin) / szRange));
      const tier = Math.min(N_DEPTH_TIERS - 1, Math.floor(t * N_DEPTH_TIERS));
      return { ox, oy, oz, tier, amp };
    });
  };

  // ── Physical depth-tier tomographic cloud ────────────────────────────────
  // Runs N_DEPTH_TIERS backward IFS sweeps from the hologram plate, each for
  // T_d = T_RECORD*(d+1)/N_DEPTH_TIERS steps using tier-d's kernel.
  // Finds 2D local maxima of |ψ|² in each reconstructed slice — these are the
  // physical focal spots where the wavefront re-converges, not synthetic geometry.
  const CLOUD_TOP_K = 24;
  // Build half-resolution reconstruction seed from plate — 2×2 box-average downsample.
  // Used as the coarse-pass input for fractal foveated rendering.
  const _buildReconFieldHalf = (plate) => {
    const GH  = GRID >> 1;
    const GH2 = GH * GH;
    let maxP = 1e-9, sumP = 0;
    for (let j = 0; j < NCELLS; j++) { if (plate[j] > maxP) maxP = plate[j]; sumP += plate[j]; }
    const meanP  = sumP / NCELLS;
    const rangeP = Math.max(1e-9, maxP - meanP);
    const psi = new Float64Array(2 * GH2);
    for (let hy = 0; hy < GH; hy++) {
      for (let hx = 0; hx < GH; hx++) {
        const fx = hx * 2, fy = hy * 2;
        // 2×2 box average
        const p00 = Math.max(0, plate[ fy      * GRID + fx    ] - meanP) / rangeP;
        const p10 = Math.max(0, plate[ fy      * GRID + fx + 1] - meanP) / rangeP;
        const p01 = Math.max(0, plate[(fy + 1) * GRID + fx    ] - meanP) / rangeP;
        const p11 = Math.max(0, plate[(fy + 1) * GRID + fx + 1] - meanP) / rangeP;
        const mod = (p00 + p10 + p01 + p11) * 0.25;
        const ph  = REF_KX * fx;  // reference phase at full-res x, preserved
        psi[(hy * GH + hx) * 2]     = mod * Math.cos(ph);
        psi[(hy * GH + hx) * 2 + 1] = mod * Math.sin(ph);
      }
    }
    return psi;
  };

  // Precomputed focal step → tier index lookup (constant for fixed T_RECORD/N_DEPTH_TIERS).
  // Index is step number (1-based), value is tier index or -1 (no harvest at that step).
  const _focalStepToTier = new Int8Array(T_RECORD + 1).fill(-1);
  for (let d = 0; d < N_DEPTH_TIERS; d++)
    _focalStepToTier[Math.round(T_RECORD * (d + 1) / N_DEPTH_TIERS)] = d;

  // Preallocated intensity buffer — avoids Float32Array allocation per harvest.
  const _reconI = new Float32Array(NCELLS);

  // Peak buffers — typed arrays avoid object heap churn (CLOUD_TOP_K entries max).
  const _peakJ   = new Int32Array(NCELLS);
  const _peakAmp = new Float32Array(NCELLS);

  // Sub-pixel peak buffers — store floating-point grid coords after CoM refinement.
  const _peakX = new Float32Array(NCELLS);  // sub-pixel x in grid coords
  const _peakY = new Float32Array(NCELLS);  // sub-pixel y in grid coords

  // Extract physically-correct local maxima with:
  //   • SNR threshold: peak must exceed tier average * 1.5 (rejects speckle noise)
  //   • Sub-pixel refinement: 3×3 intensity-weighted center-of-mass (Airy disk centroid)
  // Returns array of {x, y, amp} with floating-point coordinates for renderer.
  const _extractLocalMaxima = (psi) => {
    let maxI = 1e-9, sumI = 0;
    for (let j = 0; j < NCELLS; j++) {
      const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
      _reconI[j] = v;
      if (v > maxI) maxI = v;
      sumI += v;
    }
    const avgI  = sumI / NCELLS;
    // Two-level threshold: must be above both the speckle noise floor (1.5× avg)
    // and the global peak fraction (15%) to count as a structural point.
    const thresh = Math.max(avgI * 1.5, maxI * 0.10);
    const invMax = 1 / maxI;
    let pc = 0;
    for (let y = 1; y < GRID - 1; y++) {
      for (let x = 1; x < GRID - 1; x++) {
        const j = y * GRID + x;
        const v = _reconI[j];
        if (v < thresh) continue;
        if (v > _reconI[j-1] && v > _reconI[j+1] &&
            v > _reconI[j-GRID] && v > _reconI[j+GRID]) {
          // 3×3 intensity-weighted center-of-mass — locates true Airy disk centroid
          let wSum = 0, wX = 0, wY = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const w = _reconI[(y+dy)*GRID + (x+dx)];
              wSum += w; wX += dx * w; wY += dy * w;
            }
          }
          _peakX[pc] = x + wX / wSum;
          _peakY[pc] = y + wY / wSum;
          _peakJ[pc] = j;
          _peakAmp[pc] = Math.sqrt(v * invMax);
          pc++;
        }
      }
    }
    // Fallback: flat field → top-4 by linear scan
    if (pc === 0) {
      let t0j=-1,t1j=-1,t2j=-1,t3j=-1, t0v=0,t1v=0,t2v=0,t3v=0;
      for (let j = 0; j < NCELLS; j++) {
        const v = _reconI[j];
        if (v>t0v){t3v=t2v;t3j=t2j;t2v=t1v;t2j=t1j;t1v=t0v;t1j=t0j;t0v=v;t0j=j;}
        else if(v>t1v){t3v=t2v;t3j=t2j;t2v=t1v;t2j=t1j;t1v=v;t1j=j;}
        else if(v>t2v){t3v=t2v;t3j=t2j;t2v=v;t2j=j;}
        else if(v>t3v){t3v=v;t3j=j;}
      }
      const invSqMax = 1/Math.sqrt(maxI);
      for (const [j,v] of [[t0j,t0v],[t1j,t1v],[t2j,t2v],[t3j,t3v]]) {
        if (j < 0) continue;
        _peakX[pc] = j % GRID; _peakY[pc] = (j / GRID) | 0;
        _peakJ[pc] = j; _peakAmp[pc] = Math.sqrt(v) * invSqMax; pc++;
      }
    }
    // Partial selection sort for top-K
    const k = Math.min(pc, CLOUD_TOP_K);
    for (let i = 0; i < k; i++) {
      let best = i;
      for (let m = i+1; m < pc; m++)
        if (_peakAmp[m] > _peakAmp[best]) best = m;
      if (best !== i) {
        let tj=_peakJ[i]; _peakJ[i]=_peakJ[best]; _peakJ[best]=tj;
        let tx=_peakX[i]; _peakX[i]=_peakX[best]; _peakX[best]=tx;
        let ty=_peakY[i]; _peakY[i]=_peakY[best]; _peakY[best]=ty;
        let ta=_peakAmp[i]; _peakAmp[i]=_peakAmp[best]; _peakAmp[best]=ta;
      }
    }
    const cells = [];
    for (let i = 0; i < k; i++)
      cells.push({ x: _peakX[i], y: _peakY[i], amp: _peakAmp[i] });
    return cells;
  };

  const _buildReconCloud = (plate, rByTier, wByTier, oByTier, rFB, wFB, oFB) => {
    if (!plate || !rFB?.length) return null;
    const tiers = Array.from({ length: N_DEPTH_TIERS }, (_, d) => ({ d, cells: [] }));
    let psi = _buildReconField(plate);
    let anyCell = false;
    for (let step = 1; step <= T_RECORD; step++) {
      psi = _linearStepIFS(psi, -DT, rFB, wFB, oFB);
      const d = _focalStepToTier[step];
      if (d >= 0) {
        const cells = _extractLocalMaxima(psi);
        tiers[d].cells = cells;
        if (cells.length) anyCell = true;
      }
    }
    return anyCell ? tiers : null;
  };

  // ── Dual-slot IFS launcher (scheduler-native depth tiers) ───────────────
  // Each depth tier d fires its own root set with delays scaled by tier:
  //   tier 0 (near) → shortest delays → small ring radii → high-freq kernel
  //   tier N-1 (far) → longest delays → large ring radii → low-freq kernel
  // The IFS tree for each tier propagates independently through fresnelBeat,
  // accumulating into slotKernelByTier[d]. finalizeFresnelm builds per-tier
  // kernels so _keepalive can evolve each tier with its own dispersion relation.
  const _launchSlot = (s, ctx, slot, cycleId) => {
    let h = (cycleId | 0) ^ 0xdeadbeef;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    W.rng.seed((h ^ (h >>> 16)) >>> 0);
    const logMin = Math.log(IFS_MIN_DELAY * 2.0);
    const logMax = Math.log(IFS_BASE_DELAY);
    for (let d = 0; d < N_DEPTH_TIERS; d++) {
      // Scale delay range per tier: tier 0 uses [logMin, logMid], tier N-1 uses full range.
      const tierT  = (d + 1) / N_DEPTH_TIERS;
      const logMid = logMin + tierT * (logMax - logMin);
      const nRoots = Math.max(1, Math.round(N_FRESNEL_ROOTS / N_DEPTH_TIERS));
      for (let i = 0; i < nRoots; i++) {
        const t     = nRoots === 1 ? 1 : i / (nRoots - 1);
        const delay = Math.exp(logMin + t * (logMid - logMin));
        ctx.future(0, 'fresnelBeat', { depth: 0, delay, gen: 0, cycleId, slot, srcTier: d });
      }
    }
    ctx.future(FRESNEL_DONE_DELAY, 'finalizeFresnelm', { cycleId, slot });
    return {
      ...s,
      ['slotId_'            + slot]: cycleId,
      ['slotKernelByTier_'  + slot]: Array.from({ length: N_DEPTH_TIERS }, () => []),
      ['slotKernel_'        + slot]: [],
      ['slotEnergy_'        + slot]: new Array(IFS_DEPTH).fill(0),
      ['slotEvents_'        + slot]: [],
      ['slotActive_'        + slot]: true,
    };
  };

  // ── Build native IFS reference wave ─────────────────────────────────────
  // A uniform line of unit-amplitude sources at y=0 (top row), propagated
  // T_RECORD forward IFS steps.  Both object and reference now share the same
  // fractional-Laplacian dispersion, so their interference is fully native.
  const _initRefPsi = () => {
    const psi = new Float64Array(2 * NCELLS);
    for (let x = 0; x < GRID; x++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * x / (GRID - 1)));
      psi[x * 2] = w;
    }
    return psi;
  };

  const hologram4 = Behaviors.collect(
    {
      psi:      new Float64Array(2 * ${N_CELLS}),
      psiSnap:  new Float64Array(2 * ${N_CELLS}),
      refField: new Float64Array(2 * ${N_CELLS}),
      srcField: new Float64Array(2 * ${N_CELLS}),
      plate:    new Float32Array(${N_CELLS}),
      time:     0,
      snapId:   0,
      angleY:   INIT_ANGLE_Y,
      angleX:   INIT_ANGLE_X,
      cycleCount: 0,
      direction:  1,
      slotId_A: -1, slotActive_A: false,
      slotKernel_A: [], slotKernelByTier_A: Array.from({ length: N_DEPTH_TIERS }, () => []),
      slotEnergy_A: new Array(${IFS_DEPTH}).fill(0), slotEvents_A: [],
      slotId_B: -2, slotActive_B: false,
      slotKernel_B: [], slotKernelByTier_B: Array.from({ length: N_DEPTH_TIERS }, () => []),
      slotEnergy_B: new Array(${IFS_DEPTH}).fill(0), slotEvents_B: [],
      cachedRadii: [], cachedWeights: [], cachedOffsets: [],
      cachedRadiiByTier: null, cachedWeightsByTier: null, cachedOffsByTier: null,
      cachedRadiiVersion: 0,
      ifsNBands: 0, ifsSEff: 0, ifsRadiiStr: '',
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (['rotate','toggleMode','resetPlate','nextCycle','addPoint','addBeam','setDepthProbe','dragStart','dragEnd','toggleTomo'].includes(t))
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} }, ...(s._queue ?? [])] };
      }
      return W.reduce(s, pulse, 'hologram4', {

        __macro: (s, p, ctx) => {
          if (p.isSubTick) return s;
          if (p.logicalTime !== 1) return s;
          ctx.future(100, '_keepalive', {});
          const srcField = _buildSrcField(INIT_ANGLE_Y, INIT_ANGLE_X);
          const objField = _buildSrcFieldIFS(INIT_ANGLE_Y, INIT_ANGLE_X, []);
          const psi      = new Float64Array(objField);
          let s2 = _launchSlot({ ...s, psi, srcField, objField, time: 0 }, ctx, 'A', p.logicalTime);
          ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2), '_launchB', { cycleId: p.logicalTime + 1 });
          return s2;
        },

        _keepalive: (s, p, ctx) => {
          ctx.future(100, '_keepalive', {});
          if ((s.direction ?? 1) > 0 && s.cachedRadii.length > 0) {
            const aY      = s.angleY ?? INIT_ANGLE_Y, aX = s.angleX ?? INIT_ANGLE_X;
            const psiSnap   = _buildSrcFieldIFS(aY, aX, s.extraPoints);
            const tierPts3D = _buildTierPts3D(aY, aX);
            const snapRef   = s.refField ?? s.snapRefField;
            const sweepDone = !s.plateSweeping;
            if (sweepDone) {
              const plateSeq = (s.plateSeq ?? 0) + 1;
              const TM = s.tomoMode ?? TOMO_MODE;
              if (!TM) {
                // Fast mode: single phase-encoded field, T_RECORD steps, no tier loop
                const fastField = _buildSrcFieldIFS(aY, aX, s.extraPoints);
                ctx.future(0, '_platePulseFast', { plateSeq, step: 0 });
                return { ...s, psiSnap, snapRefField: snapRef, tierPts3D, plateSeq,
                  plateSweeping: true, plateScratch: null, plateFastField: fastField,
                  snapRadii: s.cachedRadii, snapWeights: s.cachedWeights, snapOffs: s.cachedOffsets,
                };
              }
              // Tomo mode: per-tier IFS propagation
              const tierFields = _buildSrcFieldsByDepth(aY, aX, s.extraPoints);
              const dtfArr     = tierFields.map(f => Array.from(f));
              ctx.future(0, '_platePulse', { tierD: 0, plateSeq });
              return { ...s, psiSnap, snapRefField: snapRef, tierPts3D,
                depthTierFields: dtfArr, plateSeq, plateSweeping: true,
                plateTierFields: tierFields, plateScratch: null,
                snapRadii: s.cachedRadii, snapWeights: s.cachedWeights, snapOffs: s.cachedOffsets,
                snapRadiiByTier:   s.cachedRadiiByTier,
                snapWeightsByTier: s.cachedWeightsByTier,
                snapOffsByTier:    s.cachedOffsByTier,
              };
            }
            return { ...s, psiSnap, snapRefField: snapRef, tierPts3D };
          }
          return s;
        },

        // ── Async plate accumulation — one IFS step per tick ─────────────
        // Each tick: one _linearStepIFS call on one tier's psi.
        // State carries platePsi (current tier's wavefunction) so no large payloads.
        // Flow: step 0..targetSteps per tier, then next tier, then commit plate.
        _platePulse: (s, p, ctx) => {
          if ((s.direction ?? 1) <= 0) return s;
          if (p.plateSeq !== (s.plateSeq ?? 0)) return s;
          if (!s.cachedRadii.length || !s.plateTierFields) return s;
          if (s.isDragging) {
            // Pause during drag — resume 1ms after each tick until drag ends
            ctx.future(1, '_platePulse', p);
            return s;
          }

          const tierD      = p.tierD ?? 0;
          const step       = p.step  ?? 0;
          const targetSteps = Math.round(T_RECORD * (tierD + 1) / N_DEPTH_TIERS);
          const hasTK  = s.cachedRadiiByTier?.length === N_DEPTH_TIERS;
          const fRadii = s.cachedRadii, fWeights = s.cachedWeights, fOffs = s.cachedOffsets;
          const tR = hasTK ? s.cachedRadiiByTier[tierD]   : fRadii;
          const tW = hasTK ? s.cachedWeightsByTier[tierD] : fWeights;
          const tO = hasTK ? s.cachedOffsByTier[tierD]    : fOffs;

          // Init psi for this tier on first step
          let psi = step === 0
            ? new Float64Array(s.plateTierFields[tierD])
            : s.platePsi;
          if (!psi) return s;

          // Run PLATE_BATCH steps per tick — fast enough to finish a sweep in ~100ms,
          // but yields between batches so rotate events can interleave.
          const PLATE_BATCH = 5;
          let nextStep = step;
          while (nextStep < targetSteps && nextStep < step + PLATE_BATCH) {
            psi = _linearStepIFS(psi, DT, tR, tW, tO);
            nextStep++;
          }

          if (nextStep < targetSteps) {
            ctx.future(1, '_platePulse', { tierD, step: nextStep, plateSeq: p.plateSeq });
            return { ...s, platePsi: psi };
          }

          // Tier done — accumulate |ψ + ref|² into scratchPl
          const ref     = s.snapRefField ?? s.refField;
          if (!ref?.length) {
            return { ...s, platePsi: null, plateScratch: null, plateSweeping: false };
          }
          const scratch = s.plateScratch ?? new Float32Array(${N_CELLS});
          const newScratch = new Float32Array(scratch);
          for (let j = 0; j < ${N_CELLS}; j++) {
            const re = psi[j*2]   + ref[j*2];
            const im = psi[j*2+1] + ref[j*2+1];
            newScratch[j] += re*re + im*im;
          }

          // Commit this tier's contribution into plate immediately — visible progress.
          const norm  = (1 - PLATE_DECAY) / N_DEPTH_TIERS;
          const newPl = new Float32Array(s.plate);
          for (let j = 0; j < ${N_CELLS}; j++)
            newPl[j] += newScratch[j] * norm;

          if (tierD + 1 < N_DEPTH_TIERS) {
            ctx.future(1, '_platePulse', { tierD: tierD + 1, step: 0, plateSeq: p.plateSeq });
            return { ...s, plate: newPl, platePsi: null, plateScratch: null };
          }

          // All tiers done — apply decay to the fully accumulated plate and finish.
          const decayedPl = new Float32Array(${N_CELLS});
          for (let j = 0; j < ${N_CELLS}; j++)
            decayedPl[j] = newPl[j] * PLATE_DECAY;
          const keepTick = (s._keepTick ?? 0) + 1;
          let cloudUpdates = {};
          if (keepTick % 10 === 0) {
            const cloudSeq  = (s.cloudSeq ?? 0) + 1;
            const cloudPsiC = _buildReconFieldHalf(decayedPl);
            ctx.future(0, '_cloudPulse', { step: 0, cloudSeq, phase: 1 });
            cloudUpdates = { cloudSeq, cloudPsiC, foveaMap: {} };
          }
          return { ...s, plate: decayedPl, platePsi: null, plateScratch: null,
                   plateSweeping: false, _keepTick: keepTick, ...cloudUpdates };
        },

        // ── Fast plate accumulation (TOMO_MODE=false) ────────────────────
        // Single phase-encoded field, T_RECORD steps, batched 5 per tick.
        // No tier loop — ~4× fewer IFS calls than _platePulse.
        _platePulseFast: (s, p, ctx) => {
          if ((s.direction ?? 1) <= 0) return s;
          if (p.plateSeq !== (s.plateSeq ?? 0)) return s;
          if (!s.cachedRadii.length || !s.plateFastField) return s;
          if (s.isDragging) { ctx.future(1, '_platePulseFast', p); return s; }

          const fRadii = s.cachedRadii, fWeights = s.cachedWeights, fOffs = s.cachedOffsets;
          let psi = p.step === 0
            ? new Float64Array(s.plateFastField)
            : s.platePsi;
          if (!psi) return s;

          let step = p.step ?? 0;
          const end = Math.min(T_RECORD, step + 5);
          while (step < end) {
            psi = _linearStepIFS(psi, DT, fRadii, fWeights, fOffs);
            step++;
          }

          if (step < T_RECORD) {
            ctx.future(1, '_platePulseFast', { ...p, step });
            return { ...s, platePsi: psi };
          }

          // Done — accumulate |ψ + ref|² and commit
          const ref = s.snapRefField ?? s.refField;
          if (!ref?.length) return { ...s, platePsi: null, plateSweeping: false };
          const newPl = new Float32Array(s.plate);
          for (let j = 0; j < ${N_CELLS}; j++) {
            const re = psi[j*2]   + ref[j*2];
            const im = psi[j*2+1] + ref[j*2+1];
            newPl[j] = newPl[j] * PLATE_DECAY + (re*re + im*im) * (1 - PLATE_DECAY);
          }
          return { ...s, plate: newPl, platePsi: null, plateSweeping: false,
                   _keepTick: (s._keepTick ?? 0) + 1 };
        },

        _launchB: (s, p, ctx) => {
          if (s.slotActive_B) return s;
          return _launchSlot(s, ctx, 'B', p.cycleId ?? ctx.wallTime);
        },
        _launchA: (s, p, ctx) => {
          if (s.slotActive_A) return s;
          return _launchSlot(s, ctx, 'A', p.cycleId ?? ctx.wallTime);
        },

        _physStep: (s, p, ctx) => {
          const { fRadii, fWeights, fOffs, dir } = p;
          if (!fRadii?.length || !s.psi) return s;
          // reconSeq gates concurrent backward chains — only the latest one runs.
          if (p.reconSeq !== undefined && p.reconSeq !== (s.reconSeq ?? 0)) {
            return s;
          }
          const d = dir ?? 1;
          let psi = _linearStepIFS(s.psi, d * DT, fRadii, fWeights, fOffs);
          // RECORD: relax toward IFS object field (no reference) — bounded, shows
          // fractal diffraction from cube vertices, distinct from RECON.
          // RECON: no injection — pure holographic convergence from plate seed.
          if (d > 0 && s.objField) {
            for (let j = 0; j < ${N_CELLS}; j++) {
              psi[j*2]   += SRC_ALPHA * (s.objField[j*2]   - psi[j*2]);
              psi[j*2+1] += SRC_ALPHA * (s.objField[j*2+1] - psi[j*2+1]);
            }
          }
          // Coherent IFS ring emitters — drive each pre-computed ring with
          // inward-converging phase, creating resonance blooms at the click point.
          const t = (s.time ?? 0);
          for (const b of (s.extraBeams ?? [])) {
            const ph0 = b.freq * t + b.ph0;
            const ringCount = b.rings.length || 1;
            for (const ring of b.rings) {
              const ph = ph0 + ring.phOff;
              const scale = b.amp / (ring.cells.length * ringCount);
              const cr = scale * Math.cos(ph);
              const ci = scale * Math.sin(ph);
              for (const j of ring.cells) {
                psi[j*2]   += cr;
                psi[j*2+1] += ci;
              }
            }
            // Centre cell — focal point, same total scale as one ring
            const jc = b.gy * GRID + b.gx;
            psi[jc*2]   += b.amp / ringCount * Math.cos(ph0);
            psi[jc*2+1] += b.amp / ringCount * Math.sin(ph0);
          }
          const stepsLeft = (p.stepsLeft ?? 1) - 1;
          if (stepsLeft > 0) {
            const stepDelay = d < 0 ? (p.stepDelay ?? RECON_STEP_DELAY) : 0;
            ctx.future(stepDelay, '_physStep', { stepsLeft, fRadii, fWeights, fOffs, dir: d, reconSeq: p.reconSeq, stepDelay });
          } else if (d > 0 && s.cachedRadii.length > 0) {
            ctx.future(NEXT_STEP_DELAY, '_physStep', {
              stepsLeft: PHYS_STEPS, fRadii: s.cachedRadii,
              fWeights: s.cachedWeights, fOffs: s.cachedOffsets, dir: 1,
            });
          } else if (d < 0 && s.plate && s.cachedRadii.length > 0) {
            ctx.future(RECON_HOLD_MS, '_reconLoop', {});
          }
          // No plate here — plate updated once per IFS cycle in finalizeFresnelm,
          // keeping _physStep return identical in shape to instanton3 (psi + time only).
          return { ...s, psi, time: (s.time ?? 0) + DT };
        },

        // ── Reconstruction loop ───────────────────────────────────────────
        // Fires when a backward burst ends. Starts the async cloud pulse sweep,
        // then schedules the next reconLoop after RECON_HOLD_MS.
        _reconLoop: (s, p, ctx) => {
          if ((s.direction ?? 1) >= 0 || !s.plate || !s.cachedRadii.length) return s;
          const TM      = s.tomoMode ?? TOMO_MODE;
          const probe   = s.depthProbe;
          const seq     = (s.reconSeq ?? 0) + 1;
          const hasTK   = TM && s.snapRadiiByTier?.length === N_DEPTH_TIERS;
          const rFB     = s.snapRadii?.length ? s.snapRadii : s.cachedRadii;
          const wFB     = s.snapWeights ?? s.cachedWeights;
          const oFB     = s.snapOffs    ?? s.cachedOffsets;
          if (probe) {
            const psi = _buildReconField(s.plate);
            let steps, rRadii, rWeights, rOffs;
            if (TM) {
              const { tierIdx } = probe;
              rRadii   = hasTK ? s.snapRadiiByTier[tierIdx]   : rFB;
              rWeights = hasTK ? s.snapWeightsByTier[tierIdx] : wFB;
              rOffs    = hasTK ? s.snapOffsByTier[tierIdx]    : oFB;
              steps    = Math.round(T_RECORD * (tierIdx + 1) / N_DEPTH_TIERS);
            } else {
              rRadii = rFB; rWeights = wFB; rOffs = oFB;
              steps  = Math.round((probe.depthFraction ?? 0.5) * T_RECORD);
            }
            ctx.future(0, '_physStep', {
              stepsLeft: steps, fRadii: rRadii, fWeights: rWeights, fOffs: rOffs,
              dir: -1, reconSeq: seq,
            });
            ctx.future(RECON_HOLD_MS, '_reconLoop', {});
            return { ...s, psi, reconSeq: seq };
          }
          // No probe: animate psi through full sweep. In tomo mode also kick cloud.
          const psi = _buildReconField(s.plate);
          if (TM) {
            const cloudSeq  = (s.cloudSeq ?? 0) + 1;
            const cloudPsiC = _buildReconFieldHalf(s.plate);
            ctx.future(0, '_cloudPulse', { step: 0, cloudSeq, phase: 1 });
            ctx.future(0, '_physStep', {
              stepsLeft: T_RECORD, fRadii: rFB,
              fWeights: wFB, fOffs: oFB, dir: -1, reconSeq: seq,
            });
            return { ...s, psi, reconSeq: seq, cloudSeq, cloudPsiC, foveaMap: {} };
          }
          ctx.future(0, '_physStep', {
            stepsLeft: T_RECORD, fRadii: rFB,
            fWeights: wFB, fOffs: oFB, dir: -1, reconSeq: seq,
          });
          return { ...s, psi, reconSeq: seq };
        },

        // ── Fractal Foveated Cloud Sweep ──────────────────────────────────
        // Two-phase progressive reconstruction exploiting IFS multi-scale structure:
        //
        // PHASE 1 — coarse (_cloudPulse, phase=1):
        //   Runs on a GRID/2 × GRID/2 downsampled plate using only the largest
        //   rings (low-frequency macro channel). Finds approximate ROI per tier.
        //   Cost: (GRID/2)² × T_RECORD × 1 ring ≈ 8× cheaper than full resolution.
        //
        // PHASE 2 — fine (_cloudPulse, phase=2):
        //   For each coarse ROI, runs full _linearStepIFS in a small window
        //   (FOV_WIN × FOV_WIN) around each coarse peak on the full-res plate.
        //   Uses all rings for accurate sub-pixel centroid.
        //   Cost: FOV_WIN² × T_RECORD × N_rings per tier — tiny.
        //
        // Tiers pop into the reconCloud progressively as each phase completes them.

        _cloudPulse: (s, p, ctx) => {
          if (!(s.tomoMode ?? TOMO_MODE)) return s;
          if ((s.direction ?? 1) >= 0) return s;
          if (p.cloudSeq !== (s.cloudSeq ?? 0)) return s;
          if (!s.cachedRadii.length) return s;

          const rFB    = s.snapRadii?.length ? s.snapRadii : s.cachedRadii;
          const wFB    = s.snapWeights ?? s.cachedWeights;
          const oFB    = s.snapOffs    ?? s.cachedOffsets;
          const phase  = p.phase ?? 1;
          const step   = (p.step ?? 0) + 1;
          const GH     = GRID >> 1;          // half-res grid size
          const GH2    = GH * GH;
          const FOV_WIN = Math.min(GRID, 20); // fine-pass window radius in full-res cells

          let reconCloud = s.reconCloud ?? Array.from({ length: N_DEPTH_TIERS }, (_, d) => ({ d, cells: [] }));

          if (phase === 1) {
            // ── Phase 1: coarse sweep on half-res grid, large rings only ────
            if (!s.cloudPsiC) return s; // no coarse psi yet
            // Use only the largest ring (last entry — sorted ascending by _buildNativeKernel)
            const macroIdx  = rFB.length - 1;
            const macroR    = [rFB[macroIdx] >> 1];
            const macroW    = [wFB[macroIdx]];
            const macroO    = p.macroO ?? _buildRingOffsets(macroR);
            // Batch 5 backward steps per tick, harvesting fovea at focal steps.
            let cloudPsiC = s.cloudPsiC;
            let foveaMap  = s.foveaMap ?? {};
            let curStep   = step;
            const endStep = Math.min(T_RECORD, step + 5);
            while (curStep < endStep) {
              cloudPsiC = _linearStepIFS(cloudPsiC, -DT, macroR, macroW, macroO);
              curStep++;
              const tierIdx = _focalStepToTier[curStep] ?? -1;
              if (tierIdx >= 0) {
                let maxI = 1e-9;
                for (let j = 0; j < GH2; j++) {
                  const v = cloudPsiC[j*2]*cloudPsiC[j*2] + cloudPsiC[j*2+1]*cloudPsiC[j*2+1];
                  if (v > maxI) maxI = v;
                }
                const coarsePeaks = [];
                const cthresh = maxI * 0.2;
                for (let cy = 1; cy < GH - 1; cy++) {
                  for (let cx = 1; cx < GH - 1; cx++) {
                    const j = cy * GH + cx;
                    const v = cloudPsiC[j*2]*cloudPsiC[j*2] + cloudPsiC[j*2+1]*cloudPsiC[j*2+1];
                    if (v < cthresh) continue;
                    const jL = cy*GH+(cx-1), jR = cy*GH+(cx+1);
                    const jU = (cy-1)*GH+cx, jD = (cy+1)*GH+cx;
                    const vL = cloudPsiC[jL*2]*cloudPsiC[jL*2]+cloudPsiC[jL*2+1]*cloudPsiC[jL*2+1];
                    const vR = cloudPsiC[jR*2]*cloudPsiC[jR*2]+cloudPsiC[jR*2+1]*cloudPsiC[jR*2+1];
                    const vU = cloudPsiC[jU*2]*cloudPsiC[jU*2]+cloudPsiC[jU*2+1]*cloudPsiC[jU*2+1];
                    const vD = cloudPsiC[jD*2]*cloudPsiC[jD*2]+cloudPsiC[jD*2+1]*cloudPsiC[jD*2+1];
                    if (v > vL && v > vR && v > vU && v > vD)
                      coarsePeaks.push({ cx: cx * 2, cy: cy * 2 });
                  }
                }
                coarsePeaks.sort((a, b) => {
                  const va = cloudPsiC[((a.cy>>1)*GH+(a.cx>>1))*2];
                  const vb = cloudPsiC[((b.cy>>1)*GH+(b.cx>>1))*2];
                  return vb*vb - va*va;
                });
                foveaMap = { ...foveaMap, [tierIdx]: coarsePeaks.slice(0, 8) };
              }
            }
            if (curStep < T_RECORD) {
              ctx.future(1, '_cloudPulse', { step: curStep, cloudSeq: p.cloudSeq, phase: 1, macroO });
            } else {
              ctx.future(1, '_cloudPulse', { step: 0, cloudSeq: p.cloudSeq, phase: 2, tierD: 0 });
            }
            return { ...s, cloudPsiC, foveaMap, reconCloud };

          } else {
            // ── Phase 2: one _linearStepIFS per tick, async, full-res ────────
            const tierD  = p.tierD ?? 0;
            if (tierD >= N_DEPTH_TIERS) {
              ctx.future(RECON_HOLD_MS, '_reconLoop', {});
              return { ...s, reconCloud };
            }
            const fSteps = Math.round(T_RECORD * (tierD + 1) / N_DEPTH_TIERS);
            const fStep  = p.fStep ?? 0;  // how many backward steps done for this tier

            // Init psi for this tier on fStep=0, then batch 5 steps per tick
            let psiF = fStep === 0 ? _buildReconField(s.plate) : s.cloudPsiF;
            let nextFStep = fStep;
            const endFStep = Math.min(fSteps, fStep + 5);
            while (nextFStep < endFStep) {
              psiF = _linearStepIFS(psiF, -DT, rFB, wFB, oFB);
              nextFStep++;
            }

            if (nextFStep < fSteps) {
              ctx.future(1, '_cloudPulse', { cloudSeq: p.cloudSeq, phase: 2, tierD, fStep: nextFStep });
              return { ...s, cloudPsiF: psiF };
            }
            const nextPsiF = psiF;

            // Reached focal step — extract peaks in fovea windows
            const fovea   = (s.foveaMap ?? {})[tierD] ?? [];
            const allCells = [];
            let maxI = 1e-9;
            for (const { cx, cy } of fovea) {
              const x0 = Math.max(1, cx - FOV_WIN), x1 = Math.min(GRID - 2, cx + FOV_WIN);
              const y0 = Math.max(1, cy - FOV_WIN), y1 = Math.min(GRID - 2, cy + FOV_WIN);
              for (let gy = y0; gy <= y1; gy++) {
                for (let gx = x0; gx <= x1; gx++) {
                  const j = gy * GRID + gx;
                  const v = nextPsiF[j*2]*nextPsiF[j*2] + nextPsiF[j*2+1]*nextPsiF[j*2+1];
                  if (v > maxI) maxI = v;
                }
              }
            }
            const invMax = 1 / maxI;
            for (const { cx, cy } of fovea) {
              const x0 = Math.max(1, cx - FOV_WIN), x1 = Math.min(GRID - 2, cx + FOV_WIN);
              const y0 = Math.max(1, cy - FOV_WIN), y1 = Math.min(GRID - 2, cy + FOV_WIN);
              for (let gy = y0; gy <= y1; gy++) {
                for (let gx = x0; gx <= x1; gx++) {
                  const j = gy * GRID + gx;
                  const v = nextPsiF[j*2]*nextPsiF[j*2] + nextPsiF[j*2+1]*nextPsiF[j*2+1];
                  if (v < maxI * 0.15) continue;
                  const jL=j-1, jR=j+1, jU=j-GRID, jD=j+GRID;
                  const vL=nextPsiF[jL*2]*nextPsiF[jL*2]+nextPsiF[jL*2+1]*nextPsiF[jL*2+1];
                  const vR=nextPsiF[jR*2]*nextPsiF[jR*2]+nextPsiF[jR*2+1]*nextPsiF[jR*2+1];
                  const vU=nextPsiF[jU*2]*nextPsiF[jU*2]+nextPsiF[jU*2+1]*nextPsiF[jU*2+1];
                  const vD=nextPsiF[jD*2]*nextPsiF[jD*2]+nextPsiF[jD*2+1]*nextPsiF[jD*2+1];
                  if (v > vL && v > vR && v > vU && v > vD) {
                    let wSum=0, wX=0, wY=0;
                    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
                      const w = nextPsiF[((gy+dy)*GRID+(gx+dx))*2]*nextPsiF[((gy+dy)*GRID+(gx+dx))*2]
                              + nextPsiF[((gy+dy)*GRID+(gx+dx))*2+1]*nextPsiF[((gy+dy)*GRID+(gx+dx))*2+1];
                      wSum+=w; wX+=dx*w; wY+=dy*w;
                    }
                    allCells.push({ x: gx+wX/wSum, y: gy+wY/wSum, amp: Math.sqrt(v*invMax) });
                  }
                }
              }
            }
            const cells = allCells.length > 0
              ? allCells.sort((a,b)=>b.amp-a.amp).slice(0, CLOUD_TOP_K)
              : _extractLocalMaxima(nextPsiF);
            reconCloud = reconCloud.map((t, d) => d === tierD ? { d, cells } : t);
            // Next tier — start its psi fresh (fStep=0)
            ctx.future(1, '_cloudPulse', { cloudSeq: p.cloudSeq, phase: 2, tierD: tierD + 1, fStep: 0 });
            return { ...s, reconCloud, cloudPsiF: null };
          }
        },

        fresnelBeat: (s, p, ctx) => {
          const slot = p.slot ?? 'A';
          if (p.cycleId !== s['slotId_' + slot]) return s;
          const { depth, delay, srcTier } = p;
          _ifsFireChildren(ctx, p, 'fresnelBeat', 'fresnelBeat');
          const ri = Math.max(1, Math.round(delay / DELAY_SCALE));
          // Accumulate into the merged kernel (for physics) AND the per-tier kernel.
          const kernel    = s['slotKernel_' + slot] ?? [];
          const newKernel = ri < (GRID >> 1) ? [...kernel, ri] : kernel;
          // Per-tier: each srcTier accumulates its own ring radii independently.
          const kbt    = (s['slotKernelByTier_' + slot] ?? Array.from({ length: N_DEPTH_TIERS }, () => [])).map(a => [...a]);
          const tier   = (srcTier ?? 0) % N_DEPTH_TIERS;
          if (ri < (GRID >> 1)) kbt[tier].push(ri);
          const energy = (s['slotEnergy_' + slot] ?? new Array(IFS_DEPTH).fill(0)).slice();
          energy[depth] = Math.min(1, (energy[depth] ?? 0) + 0.3);
          const events  = [...(s['slotEvents_' + slot] ?? []).slice(-80),
            { d: depth, delay, wt: ctx.wallTime, t: tier }];
          return { ...s,
            ['slotKernel_'        + slot]: newKernel,
            ['slotKernelByTier_'  + slot]: kbt,
            ['slotEnergy_'        + slot]: energy,
            ['slotEvents_'        + slot]: events,
          };
        },

        finalizeFresnelm: (s, p, ctx) => {
          const slot = p.slot ?? 'A';
          if (p.cycleId !== s['slotId_' + slot]) return s;
          const { fRadii, fWeights, sEff } = _buildNativeKernel(
            s['slotKernel_' + slot] ?? [], FRAC_ALPHA, MAX_IFS_BANDS);
          const fOffs = _buildRingOffsets(fRadii);
          // Build per-tier kernels from slotKernelByTier — each tier gets its own
          // dispersion relation (distinct ring radii → distinct spatial frequencies).
          const kbt = s['slotKernelByTier_' + slot] ?? Array.from({ length: N_DEPTH_TIERS }, () => []);
          const tierKernels = kbt.map(tierK => {
            const { fRadii: tr, fWeights: tw } = _buildNativeKernel(
              tierK.length ? tierK : (fRadii.length ? fRadii : [1]),
              FRAC_ALPHA, MAX_IFS_BANDS);
            return { fRadii: tr, fWeights: tw, fOffs: _buildRingOffsets(tr) };
          });
          // (Re)start physics chain
          if (!s.cachedRadii.length) {
            ctx.future(0, '_physStep', {
              stepsLeft: PHYS_STEPS, fRadii, fWeights, fOffs, dir: s.direction ?? 1,
            });
          }
          // Stagger opposite slot
          const nextSlot    = slot === 'A' ? 'B' : 'A';
          const nextCycleId = p.cycleId + 2;
          if (!s['slotActive_' + nextSlot]) {
            ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2),
              '_launch' + nextSlot, { cycleId: nextCycleId });
          }
          const newRadiiStr = fRadii.join(',');
          const kernelChanged = newRadiiStr !== s.ifsRadiiStr;
          const needRef = kernelChanged || !s.refField?.length;
          const refSeq  = needRef ? (s.refSeq ?? 0) + 1 : (s.refSeq ?? 0);
          // First build: synchronous so plate accumulation can start immediately.
          // Subsequent changes: async _refPulse so it doesn't block.
          let refField = s.refField;
          if (!s.refField?.length) {
            let psi = _initRefPsi();
            for (let i = 0; i < T_RECORD; i++) psi = _linearStepIFS(psi, DT, fRadii, fWeights, fOffs);
            refField = psi;
          } else if (kernelChanged) {
            ctx.future(1, '_refPulse', { refSeq, step: 0,
              fRadii, fWeights, fOffs: Array.from(fOffs) });
          }
          return { ...s,
            ['slotActive_'       + slot]: false,
            ['slotKernel_'       + slot]: [],
            ['slotKernelByTier_' + slot]: Array.from({ length: N_DEPTH_TIERS }, () => []),
            cachedRadii: fRadii, cachedWeights: fWeights, cachedOffsets: fOffs,
            cachedRadiiByTier:   tierKernels.map(k => k.fRadii),
            cachedWeightsByTier: tierKernels.map(k => k.fWeights),
            cachedOffsByTier:    tierKernels.map(k => k.fOffs),
            cachedRadiiVersion: kernelChanged ? (s.cachedRadiiVersion ?? 0) + 1 : (s.cachedRadiiVersion ?? 0),
            refField,
            refSeq,
            ifsNBands: fRadii.length, ifsRadiiStr: newRadiiStr, ifsSEff: sEff,
            cycleCount: (s.cycleCount ?? 0) + 1,
          };
        },


        // ── Async reference wave builder — one IFS step per tick ─────────
        // Only runs in RECORD mode (direction >= 0). In RECON mode, refField
        // is already built and doesn't need updating — yield ticks to _cloudPulse.
        _refPulse: (s, p, ctx) => {
          if (p.refSeq !== (s.refSeq ?? 0)) return s;  // stale, cancel
          if ((s.direction ?? 1) < 0) {
            // Pause during RECON — resume when direction flips back
            ctx.future(200, '_refPulse', p);
            return s;
          }
          if (s.isDragging) { ctx.future(1, '_refPulse', p); return s; }
          const step = p.step ?? 0;
          let psi = step === 0 ? _initRefPsi() : s.refPsi;
          let nextStep = step;
          while (nextStep < T_RECORD && nextStep < step + 5) {
            psi = _linearStepIFS(psi, DT, p.fRadii, p.fWeights, p.fOffs);
            nextStep++;
          }
          if (nextStep < T_RECORD) {
            ctx.future(1, '_refPulse', { ...p, step: nextStep });
            return { ...s, refPsi: psi };
          }
          // Done — commit as live refField
          return { ...s, refField: psi, refPsi: null };
        },

        rotate: (s, p, ctx) => {
          const angleY   = p.angleY ?? s.angleY;
          const angleX   = p.angleX ?? s.angleX;
          const srcField = _buildSrcField(angleY, angleX);
          const objField = _buildSrcFieldIFS(angleY, angleX, s.extraPoints);
          const psi      = (s.direction ?? 1) > 0 ? new Float64Array(objField) : s.psi;
          // In RECON mode, rebuild cloud from the plate using current kernel — the
          // backward sweep uses stored plate (rotation-invariant) but we rebuild so
          // tier labels reflect the new viewing angle.
          // Rotation in RECON mode: keep existing cloud (it's angle-independent),
          // just kick a fresh async sweep so it updates without blocking rotate.
          // In RECON mode the cloud is plate-derived (angle-independent) —
          // don't restart _cloudPulse on every drag event, it floods the queue.
          return { ...s, angleY, angleX, srcField, objField, psi };
        },

        // ── Add point source at grid coordinate ───────────────────────────
        addPoint: (s, p, ctx) => {
          const { gx, gy } = p;
          if (gx === undefined || gy === undefined) return s;
          // Deterministic phase — same on all Croquet peers
          const ph = ((gx * 7 + gy * 13) & 0xffff) / 0xffff * TWO_PI;
          const amp = 40.0 / 96;
          const extraPoints = [...(s.extraPoints ?? []), { gx, gy, ph, amp }];
          // Rebuild objField with extra points routed into their depth tier
          const objField = _buildSrcFieldIFS(s.angleY ?? INIT_ANGLE_Y, s.angleX ?? INIT_ANGLE_X, extraPoints);
          const psi = new Float64Array(objField);
          return { ...s, objField, psi, extraPoints };
        },

        // ── Add coherent IFS ring emitter ────────────────────────────────────
        // Pre-computes cells on each IFS ring radius around (gx,gy) and drives
        // them with inward-converging phase each physics step.  Because the ring
        // radii are taken from cachedRadii (the live IFS kernel), the beam speaks
        // the same spatial frequencies the propagator uses — this creates visible
        // resonance blooms and standing-wave halos where the beam's rings overlap
        // the cube's own diffraction rings.
        addBeam: (s, p, ctx) => {
          const { gx, gy } = p;
          if (gx === undefined || gy === undefined) return s;
          const radii = (s.cachedRadii?.length ? s.cachedRadii : [2, 4, 6, 8]);
          const freq  = TWO_PI / WAVELENGTH;
          // Build ring cell lists with inward-converging phase offset per ring.
          // Each ring r gets phase -kWav*r so waves focus toward centre (gx,gy).
          const kWav  = TWO_PI / WAVELENGTH;
          const rings = [];
          for (const r of radii) {
            const cells = [];
            for (let dy = -r - 1; dy <= r + 1; dy++) {
              for (let dx = -r - 1; dx <= r + 1; dx++) {
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (Math.abs(dist - r) > 0.65) continue;
                const cx = ((gx + dx) % GRID + GRID) % GRID;
                const cy = ((gy + dy) % GRID + GRID) % GRID;
                cells.push(cy * GRID + cx);
              }
            }
            // phase offset makes the ring converge inward
            rings.push({ r, cells, phOff: -kWav * r });
          }
          const ph0  = ((gx * 7 + gy * 13) & 0xffff) / 0xffff * TWO_PI;
          const amp  = 4.0;
          const extraBeams = [...(s.extraBeams ?? []), { gx, gy, rings, ph0, amp, freq }];
          return { ...s, extraBeams };
        },

        // ── Depth tier probe (physically time-gated) ─────────────────────────
        // Selecting tier d in RECON mode aborts the current backward sweep and
        // restarts from the plate seed for exactly (d+1)/N * T_RECORD steps.
        // Sources recorded at tier d re-focused at exactly that step count, so
        // the field at termination shows only the near/far slice — no filter trick.
        setDepthProbe: (s, p, ctx) => {
          const { depthFraction } = p;
          if (depthFraction === undefined) {
            // Probe turned off → restart slow full sweep (visually scan through depth)
            if ((s.direction ?? 1) < 0 && s.plate && s.cachedRadii.length > 0) {
              const rRadii   = s.snapRadii?.length ? s.snapRadii : s.cachedRadii;
              const rWeights = s.snapWeights ?? s.cachedWeights;
              const rOffs    = s.snapOffs    ?? s.cachedOffsets;
              const seq = (s.reconSeq ?? 0) + 1;
              const psi = _buildReconField(s.plate);
              ctx.future(0, '_physStep', {
                stepsLeft: T_RECORD, fRadii: rRadii,
                fWeights: rWeights, fOffs: rOffs, dir: -1, reconSeq: seq,
              });
              return { ...s, depthProbe: null, psi, reconSeq: seq };
            }
            return { ...s, depthProbe: null };
          }
          const TM = s.tomoMode ?? TOMO_MODE;
          const tierIdx = Math.min(N_DEPTH_TIERS - 1, Math.floor(depthFraction * N_DEPTH_TIERS));
          const probe = { depthFraction, tierIdx };
          if ((s.direction ?? 1) < 0 && s.plate && s.cachedRadii.length > 0) {
            const hasTK    = TM && s.snapRadiiByTier?.length === N_DEPTH_TIERS;
            const rFB      = s.snapRadii?.length ? s.snapRadii : s.cachedRadii;
            const wFB      = s.snapWeights ?? s.cachedWeights;
            const oFB      = s.snapOffs    ?? s.cachedOffsets;
            const rRadii   = hasTK ? s.snapRadiiByTier[tierIdx]   : rFB;
            const rWeights = hasTK ? s.snapWeightsByTier[tierIdx] : wFB;
            const rOffs    = hasTK ? s.snapOffsByTier[tierIdx]    : oFB;
            // Fast mode: continuous depth steps 0..T_RECORD; tomo: tier focal steps.
            const steps = TM
              ? Math.round(T_RECORD * (tierIdx + 1) / N_DEPTH_TIERS)
              : Math.max(1, Math.round(depthFraction * T_RECORD));
            // Synchronous: throttled (fast: ~20 buckets; tomo: N_DEPTH_TIERS)
            // needs exact focal-depth psi — can't share s.psi with the ongoing sweep.
            let psi = _buildReconField(s.plate);
            for (let i = 0; i < steps; i++) psi = _linearStepIFS(psi, -DT, rRadii, rWeights, rOffs);
            const seq = (s.reconSeq ?? 0) + 1;
            ctx.future(RECON_HOLD_MS, '_reconLoop', {});
            return { ...s, depthProbe: probe, psi, reconSeq: seq };
          }
          return { ...s, depthProbe: probe };
        },

        dragStart: (s) => ({ ...s, isDragging: true }),
        dragEnd:   (s) => ({ ...s, isDragging: false }),

        // ── Toggle record / reconstruct ───────────────────────────────────
        toggleMode: (s, p, ctx) => {
          const newDir = (s.direction ?? 1) === 1 ? -1 : 1;
          let psi = s.psi;
          if (newDir === -1 && s.plate) {
            const TM    = s.tomoMode ?? TOMO_MODE;
            const hasTK = TM && s.snapRadiiByTier?.length === N_DEPTH_TIERS;
            const rFB   = s.snapRadii?.length ? s.snapRadii : s.cachedRadii;
            const wFB   = s.snapWeights ?? s.cachedWeights;
            const oFB   = s.snapOffs    ?? s.cachedOffsets;
            // In tomo mode kick off foveated cloud sweep; fast mode has no tier cloud.
            const probe = s.depthProbe;
            if (TM) {
              const cloudSeq  = (s.cloudSeq ?? 0) + 1;
              const cloudPsiC = _buildReconFieldHalf(s.plate);
              ctx.future(0, '_cloudPulse', { step: 0, cloudSeq, phase: 1 });
              s = { ...s, cloudSeq, cloudPsiC, foveaMap: {} };
            }
            if (probe) {
              const { tierIdx } = probe;
              const rRadii   = hasTK ? s.snapRadiiByTier[tierIdx]   : rFB;
              const rWeights = hasTK ? s.snapWeightsByTier[tierIdx] : wFB;
              const rOffs    = hasTK ? s.snapOffsByTier[tierIdx]    : oFB;
              if (rRadii.length > 0) {
                const steps = TM
                  ? Math.round(T_RECORD * (tierIdx + 1) / N_DEPTH_TIERS)
                  : Math.max(1, Math.round((probe.depthFraction ?? 0.5) * T_RECORD));
                psi = _buildReconField(s.plate);
                const seq = (s.reconSeq ?? 0) + 1;
                ctx.future(0, '_physStep', {
                  stepsLeft: steps, fRadii: rRadii, fWeights: rWeights, fOffs: rOffs,
                  dir: -1, reconSeq: seq,
                });
                ctx.future(RECON_HOLD_MS, '_reconLoop', {});
                s = { ...s, reconSeq: seq };
              }
            } else {
              if (rFB.length > 0) {
                // No probe: slow animated sweep.
                psi = _buildReconField(s.plate);
                const seq = (s.reconSeq ?? 0) + 1;
                ctx.future(0, '_physStep', {
                  stepsLeft: T_RECORD, fRadii: rFB,
                  fWeights: wFB, fOffs: oFB, dir: -1, reconSeq: seq,
                });
                s = { ...s, reconSeq: seq };
              }
            }
          } else if (newDir === 1 && s.cachedRadii.length > 0) {
            psi = s.objField ? new Float64Array(s.objField) : _buildSrcFieldIFS(s.angleY ?? INIT_ANGLE_Y, s.angleX ?? INIT_ANGLE_X, s.extraPoints);
            ctx.future(0, '_physStep', {
              stepsLeft: PHYS_STEPS, fRadii: s.cachedRadii,
              fWeights: s.cachedWeights, fOffs: s.cachedOffsets, dir: 1,
            });
          }
          return { ...s, direction: newDir, psi };
        },

        // ── Clear plate and return to init ────────────────────────────────
        resetPlate: (s, p, ctx) => {
          const srcField = _buildSrcField(INIT_ANGLE_Y, INIT_ANGLE_X);
          const objField = _buildSrcFieldIFS(INIT_ANGLE_Y, INIT_ANGLE_X, []);
          const psi      = new Float64Array(objField);
          return { ...s,
            psi, srcField, objField,
            plate:    new Float32Array(${N_CELLS}),
            time:     0, direction: 1,
            angleY:   INIT_ANGLE_Y, angleX: INIT_ANGLE_X,
            extraPoints: [], extraBeams: [], depthProbe: null,
          };
        },

        // ── Toggle tomo / fast recording mode ─────────────────────────────
        // Resets the plate — plates recorded in one mode are incompatible with
        // the other's reconstruction path.
        toggleTomo: (s, p, ctx) => {
          const newTM = !(s.tomoMode ?? TOMO_MODE);
          const srcField = _buildSrcField(s.angleY ?? INIT_ANGLE_Y, s.angleX ?? INIT_ANGLE_X);
          const objField = _buildSrcFieldIFS(s.angleY ?? INIT_ANGLE_Y, s.angleX ?? INIT_ANGLE_X, s.extraPoints ?? []);
          const psi      = new Float64Array(objField);
          return { ...s,
            tomoMode: newTM,
            psi, srcField, objField,
            plate:        new Float32Array(${N_CELLS}),
            time:         0, direction: 1,
            plateSweeping: false, depthProbe: null,
          };
        },

        nextCycle: (s, p, ctx) => {
          if (s.slotActive_A && s.slotActive_B) return s;
          const slot = !s.slotActive_A ? 'A' : 'B';
          return _launchSlot(s, ctx, slot, ctx.wallTime + 1);
        },

      });
    }
  );

  const _isStable = W.stable([hologram4], reflector);
  const _export   = W.export(Renkon, { hologram4 }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeHologram4Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  const RW = GRID * RENDER_SCALE;
  const RH = GRID * RENDER_SCALE;

  const _project = (ox, oy, oz, angleY, angleX, W, H) => {
    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const halfG = (GRID - 1) / 2, fsc = halfG * PROJ_SCALE;
    const ry1 =  cosY*ox + sinY*oz, rz1 = -sinY*ox + cosY*oz;
    const rx = ry1, ry = cosX*oy - sinX*rz1, rz = sinX*oy + cosX*rz1;
    const z  = CAM_Z - rz;
    return { px: (halfG + (rx/z)*fsc*CAM_Z)/GRID*W, py: (halfG - (ry/z)*fsc*CAM_Z)/GRID*H, depth: rz };
  };

  const _drawCube = (ctx2d, angleY, angleX, glow) => {
    const CW = ctx2d.canvas.width, CH = ctx2d.canvas.height;
    ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, CW, CH);
    if (glow > 0.02) {
      const gr = ctx2d.createRadialGradient(CW/2,CH/2,CW*0.05, CW/2,CH/2,CW*0.6);
      gr.addColorStop(0, `rgba(60,180,255,${0.12*glow})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx2d.fillStyle = gr; ctx2d.fillRect(0, 0, CW, CH);
    }
    const pts = CUBE_VERTS.map(([ox,oy,oz]) => _project(ox,oy,oz,angleY,angleX,CW,CH));
    for (let pass = 0; pass < 2; pass++) {
      for (const [ai, bi] of CUBE_EDGES) {
        const a = pts[ai], b = pts[bi];
        const avgD = (a.depth + b.depth) / 2, isBack = avgD < 0;
        if (pass === 0 && !isBack) continue;
        if (pass === 1 &&  isBack) continue;
        const t = (avgD + 1) / 2, bright = isBack ? 0.15 + t*0.1 : 0.5 + t*0.5;
        ctx2d.beginPath(); ctx2d.moveTo(a.px, a.py); ctx2d.lineTo(b.px, b.py);
        if (glow > 0.02 && !isBack) {
          ctx2d.strokeStyle = `rgba(${Math.floor(40+bright*180*(1-glow))},${Math.floor(160*glow+bright*100*(1-glow))},255,${isBack?0.2:0.9})`;
          ctx2d.lineWidth = 1.5 + glow;
          ctx2d.shadowColor = `rgba(60,180,255,${glow*0.7})`; ctx2d.shadowBlur = 5*glow;
        } else {
          ctx2d.strokeStyle = `rgba(${Math.floor(bright*220)},${Math.floor(bright*160)},${Math.floor(bright*30)},${isBack?0.22:0.85})`;
          ctx2d.lineWidth = isBack ? 0.8 : 1.4; ctx2d.shadowBlur = 0;
        }
        ctx2d.stroke(); ctx2d.shadowBlur = 0;
      }
    }
    for (const { px, py, depth } of pts) {
      const t = (depth+1)/2, bright = 0.4 + t*0.6;
      ctx2d.beginPath(); ctx2d.arc(px, py, 2 + t*2, 0, Math.PI*2);
      ctx2d.fillStyle = glow > 0.02
        ? `rgba(${Math.floor(bright*255*(1-glow)+60*glow)},${Math.floor(bright*180*(1-glow)+200*glow)},255,0.9)`
        : `rgba(${Math.floor(bright*255)},${Math.floor(bright*180)},${Math.floor(bright*40)},0.9)`;
      ctx2d.shadowColor = glow > 0.02 ? `rgba(80,200,255,${glow*0.8})` : 'transparent';
      ctx2d.shadowBlur  = glow > 0.02 ? 6*glow : 0;
      ctx2d.fill(); ctx2d.shadowBlur = 0;
    }
    ctx2d.fillStyle = glow > 0.3 ? `rgba(80,200,255,${0.3+glow*0.5})` : 'rgba(200,150,30,0.35)';
    ctx2d.font = '7px ui-monospace,monospace';
    ctx2d.fillText(`θY=${(angleY*180/Math.PI).toFixed(1)}° θX=${(angleX*180/Math.PI).toFixed(1)}°`, 4, CH-4);
  };

  return (world, peerId, containerId, sendCursorMove, _injectEvent) => {
    // Wrap injectEvent so dispatch always escapes the current synchronous frame.
    // On the sender peer, events fired during a render call would otherwise wait
    // until the render returns before hitting the network stack, adding a full
    // frame of latency that the receiver peer doesn't pay.
    const injectEvent = _injectEvent
      ? (ev) => setTimeout(() => _injectEvent(ev), 0)
      : undefined;
    if (!document.getElementById('hologram4-wrap')) {
      const wrap = document.createElement('div'); wrap.id = 'hologram4-wrap';
      Object.assign(wrap.style, {
        display: 'flex', gap: '0', flexWrap: 'nowrap',
        alignItems: 'stretch', height: '100vh', width: '100%', overflow: 'hidden',
      });
      document.body.appendChild(wrap);
    }

    const root = document.createElement('div');
    root.id = containerId;
    Object.assign(root.style, {
      fontFamily: 'ui-monospace,monospace', background: '#000', color: '#eee',
      flex: '1', minWidth: '0', minHeight: '0', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    });
    document.getElementById('hologram4-wrap').appendChild(root);

    // ── Main layout ───────────────────────────────────────────────────────────
    const main = document.createElement('div');
    Object.assign(main.style, { display: 'flex', flex: '1', flexDirection: 'row', minHeight: '0' });
    root.appendChild(main);

    // ── Canvas column (three side-by-side) ────────────────────────────────────
    const canvasCol = document.createElement('div');
    Object.assign(canvasCol.style, {
      flex: '1', minWidth: '0', minHeight: '0',
      display: 'flex', flexDirection: 'row',
      alignItems: 'stretch', gap: '4px', padding: '8px', boxSizing: 'border-box',
    });
    main.appendChild(canvasCol);

    const makeDataCell = (label, color) => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column' });
      const lbl = document.createElement('div');
      Object.assign(lbl.style, {
        fontSize: '8px', color, textAlign: 'center', marginBottom: '2px',
        letterSpacing: '0.5px', flexShrink: '0',
      });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = RW; canvas.height = RH;
      Object.assign(canvas.style, {
        flex: '1', minHeight: '0', width: '100%', height: '100%',
        objectFit: 'contain', imageRendering: 'auto',
        borderRadius: '3px', display: 'block', cursor: 'crosshair',
      });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    const fieldCell = makeDataCell('IFS WAVEFRONT  |ψ|²  (drag = rotate)', '#f84');
    const phaseCell = makeDataCell('IFS PHASE  arg(ψ)  Lévy diffraction tails', '#4af');
    const plateCell = makeDataCell('IFS HOLOGRAM PLATE  |ψ_obj+ψ_ref|²  native', '#9c4');
    const cloudCell = makeDataCell('DEPTH CLOUD  tier tomography  (RECON only)', '#c8f');
    canvasCol.appendChild(fieldCell.wrap);
    canvasCol.appendChild(phaseCell.wrap);
    canvasCol.appendChild(plateCell.wrap);
    canvasCol.appendChild(cloudCell.wrap);

    const fieldBuf = fieldCell.ctx.createImageData(RW, RH);
    const phaseBuf = phaseCell.ctx.createImageData(RW, RH);
    const plateBuf = plateCell.ctx.createImageData(RW, RH);

    // Precompute bilinear sample tables — reused every frame
    const _bx0 = new Int32Array(RW), _bx1 = new Int32Array(RW);
    const _btx = new Float32Array(RW), _btx1 = new Float32Array(RW);
    for (let rx = 0; rx < RW; rx++) {
      const fx = (rx + 0.5) / RENDER_SCALE - 0.5;
      const x0 = Math.floor(fx);
      _bx0[rx] = Math.max(0, Math.min(GRID-1, x0));
      _bx1[rx] = Math.max(0, Math.min(GRID-1, x0 + 1));
      _btx[rx] = fx - x0; _btx1[rx] = 1 - _btx[rx];
    }
    const _by0 = new Int32Array(RH), _by1 = new Int32Array(RH);
    const _bty = new Float32Array(RH), _bty1 = new Float32Array(RH);
    for (let ry = 0; ry < RH; ry++) {
      const fy = (ry + 0.5) / RENDER_SCALE - 0.5;
      const y0 = Math.floor(fy);
      _by0[ry] = Math.max(0, Math.min(GRID-1, y0));
      _by1[ry] = Math.max(0, Math.min(GRID-1, y0 + 1));
      _bty[ry] = fy - y0; _bty1[ry] = 1 - _bty[ry];
    }

    let _smoothMaxField = 0, _smoothMaxPlate = 0, _smoothMeanField = 0, _smoothMeanPlate = 0;

    // ── Clock column ──────────────────────────────────────────────────────────
    const clockCol = document.createElement('div');
    Object.assign(clockCol.style, {
      flexShrink: '0', width: '130px', display: 'flex', flexDirection: 'column',
      padding: '10px 8px', boxSizing: 'border-box', gap: '6px', overflow: 'hidden',
    });
    main.appendChild(clockCol);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '7px', fontWeight: 'bold', letterSpacing: '0.5px',
      color: '#9c4', textAlign: 'center', lineHeight: '1.4',
      height: '3em', overflow: 'hidden', flexShrink: '0',
    });
    clockCol.appendChild(title);

    const ifsClock = makeIFSClockPanel({ label: 'FRESNEL IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    clockCol.appendChild(ifsClock.el);

    // Wireframe cube canvas in clock column
    const wireCvs = document.createElement('canvas');
    wireCvs.width = 120; wireCvs.height = 120;
    Object.assign(wireCvs.style, {
      width: '100%', height: 'auto', borderRadius: '3px',
      display: 'block', cursor: 'grab', flexShrink: '0',
    });
    clockCol.appendChild(wireCvs);
    const wireCtx = wireCvs.getContext('2d');

    const mkBtn = (label, bg, fg, handler) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: bg, color: fg ?? '#000', border: 'none', borderRadius: '4px',
        padding: '4px 0', fontSize: '8px', cursor: 'pointer', width: '100%',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold',
        touchAction: 'manipulation',
      });
      b.addEventListener('click', handler);
      b.addEventListener('touchend', (e) => { e.preventDefault(); handler(e); }, { passive: false });
      return b;
    };

    const btnRecord = mkBtn('● RECORD',       '#9c4', '#000', () => {
      if ((world.getNodeState('hologram4')?.direction ?? 1) !== 1)
        injectEvent?.({ type: 'toggleMode' });
    });
    const btnRecon  = mkBtn('◎ RECONSTRUCT',  '#4af', '#000', () => {
      if ((world.getNodeState('hologram4')?.direction ?? 1) !== -1)
        injectEvent?.({ type: 'toggleMode' });
    });
    const btnReset  = mkBtn('↺ RESET PLATE',  '#333', '#aaa', () => injectEvent?.({ type: 'resetPlate' }));
    const btnTomo   = mkBtn('⊕ TOMO',  '#555', '#aaa', () => injectEvent?.({ type: 'toggleTomo' }));
    clockCol.appendChild(btnRecord);
    clockCol.appendChild(btnRecon);
    clockCol.appendChild(btnReset);
    clockCol.appendChild(btnTomo);

    const modeLbl = document.createElement('div');
    modeLbl.id = containerId + '-mode';
    Object.assign(modeLbl.style, {
      fontSize: '9px', fontWeight: 'bold', textAlign: 'center', color: '#9c4',
    });
    clockCol.appendChild(modeLbl);

    // ── Depth probe slider ────────────────────────────────────────────────────
    const probeWrap = document.createElement('div');
    Object.assign(probeWrap.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
    const probeLbl = document.createElement('div');
    Object.assign(probeLbl.style, { fontSize: '7px', color: '#555', textAlign: 'center' });
    probeLbl.textContent = 'DEPTH  off';
    const probeSlider = document.createElement('input');
    probeSlider.type = 'range'; probeSlider.min = '0'; probeSlider.max = '100'; probeSlider.value = '0';
    probeSlider.disabled = true;
    Object.assign(probeSlider.style, { width: '100%', accentColor: '#f84', cursor: 'pointer', opacity: '0.3' });
    let _probeActive = false;
    let _probeTierSent = -1;
    const _updateProbeUI = (active, val) => {
      _probeActive = active;
      const _tmLbl = (world.getNodeState('hologram4')?.tomoMode ?? TOMO_MODE);
      probeLbl.textContent = active
        ? ((_tmLbl ? 'DEPTH TIER  ' : 'DEPTH  ') + val + '%')
        : (_tmLbl ? 'DEPTH TIER  off' : 'DEPTH  off');
      probeLbl.style.color = active ? '#f84' : '#555';
      probeSlider.disabled = !active;
      probeSlider.style.opacity = active ? '1' : '0.3';
      btnProbeOn.style.opacity  = active ? '0.4' : '1';
      btnProbeOff.style.opacity = active ? '1' : '0.4';
    };
    const _sendProbe = (val) => {
      const f    = val / 100;
      const _TM  = (world.getNodeState('hologram4')?.tomoMode ?? TOMO_MODE);
      // In tomo mode throttle to tier changes; in fast mode throttle to ~20 positions.
      const bucket = _TM
        ? Math.min(N_DEPTH_TIERS - 1, Math.floor(f * N_DEPTH_TIERS))
        : Math.floor(f * 20);
      if (bucket !== _probeTierSent) {
        _probeTierSent = bucket;
        injectEvent?.({ type: 'setDepthProbe', depthFraction: f });
      }
      _updateProbeUI(true, val);
    };
    probeSlider.addEventListener('input', () => _sendProbe(parseInt(probeSlider.value)));
    const btnProbeOn  = mkBtn('⦿ TIER ON',  '#f84', '#000', () => {
      _sendProbe(parseInt(probeSlider.value));
    });
    const btnProbeOff = mkBtn('✕ TIER OFF', '#222', '#888', () => {
      injectEvent?.({ type: 'setDepthProbe', depthFraction: undefined });
      _updateProbeUI(false, 0);
      _probeTierSent = -1;
    });
    probeWrap.appendChild(probeLbl);
    probeWrap.appendChild(probeSlider);
    probeWrap.appendChild(btnProbeOn);
    probeWrap.appendChild(btnProbeOff);
    clockCol.appendChild(probeWrap);

    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, { fontSize: '7px', color: '#444', lineHeight: '1.6', overflow: 'hidden' });
    clockCol.appendChild(stats);

    // ── Drag-to-rotate (shared across all canvases + wireframe) ──────────────
    let _dragging = false, _dragX0 = 0, _dragY0 = 0, _baseAngleY = INIT_ANGLE_Y, _baseAngleX = INIT_ANGLE_X;
    let _localAngleY = INIT_ANGLE_Y, _localAngleX = INIT_ANGLE_X;
    let _wireGlow = 0, _wireRafId = null;
    let _lastRotateMs = 0;
    const ROTATE_THROTTLE_MS = 150;

    // Cloud has its own independent view angle (drag rotates the point stack locally)
    let _cloudDragging = false, _cloudDragX0 = 0, _cloudDragY0 = 0;
    let _cloudAngleY = 0.785, _cloudAngleX = 0.524;  // matches cube default: 45° az, 30° el
    let _cloudBaseAngleY = _cloudAngleY, _cloudBaseAngleX = _cloudAngleX;

    const _clientXY = (e) => {
      const t = e.touches ?? e.changedTouches;
      return t?.length ? [t[0].clientX, t[0].clientY] : [e.clientX, e.clientY];
    };
    const _onStart = (e) => {
      e.preventDefault();
      _dragging = true;
      [_dragX0, _dragY0] = _clientXY(e);
      _baseAngleY = _localAngleY; _baseAngleX = _localAngleX;
      _lastRotateMs = 0;
      wireCvs.style.cursor = 'grabbing';
      _injectEvent?.({ type: 'dragStart' });
    };
    const _onMove = (e) => {
      if (!_dragging) return;
      e.preventDefault();
      const [cx, cy] = _clientXY(e);
      _localAngleY = _baseAngleY + (cx - _dragX0) * 0.012;
      _localAngleX = _baseAngleX + (cy - _dragY0) * 0.012;
      _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow);
      const now = performance.now();
      if (now - _lastRotateMs > ROTATE_THROTTLE_MS) {
        _lastRotateMs = now;
        injectEvent?.({ type: 'rotate', angleY: _localAngleY, angleX: _localAngleX });
      }
    };
    const _onEnd = (e) => {
      if (!_dragging) return;
      e.preventDefault();
      _dragging = false;
      wireCvs.style.cursor = 'grab';
      injectEvent?.({ type: 'rotate', angleY: _localAngleY, angleX: _localAngleX });
      _injectEvent?.({ type: 'dragEnd' });
    };

    // Cloud canvas drag — rotates point stack view, does NOT rotate the world
    cloudCell.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      _cloudDragging = true;
      [_cloudDragX0, _cloudDragY0] = _clientXY(e);
      _cloudBaseAngleY = _cloudAngleY; _cloudBaseAngleX = _cloudAngleX;
      cloudCell.canvas.style.cursor = 'grabbing';
    }, { passive: false });
    cloudCell.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      _cloudDragging = true;
      [_cloudDragX0, _cloudDragY0] = _clientXY(e);
      _cloudBaseAngleY = _cloudAngleY; _cloudBaseAngleX = _cloudAngleX;
    }, { passive: false });
    window.addEventListener('mousemove', (e) => {
      if (!_cloudDragging) return;
      const [cx, cy] = _clientXY(e);
      _cloudAngleY = _cloudBaseAngleY + (cx - _cloudDragX0) * 0.015;
      _cloudAngleX = _cloudBaseAngleX + (cy - _cloudDragY0) * 0.015;
    });
    window.addEventListener('mouseup', () => {
      if (_cloudDragging) { _cloudDragging = false; cloudCell.canvas.style.cursor = 'grab'; }
    });
    cloudCell.canvas.style.cursor = 'grab';

    const _attachDrag = (el) => {
      el.addEventListener('mousedown',  _onStart, { passive: false });
      el.addEventListener('touchstart', _onStart, { passive: false });
    };
    const allDragTargets = [fieldCell.canvas, phaseCell.canvas, plateCell.canvas, wireCvs];
    allDragTargets.forEach(_attachDrag);
    // Prevent browser scroll/pan from stealing touch events on drag canvases.
    allDragTargets.forEach(el => { el.style.touchAction = 'none'; });
    cloudCell.canvas.style.touchAction = 'none';
    window.addEventListener('mousemove',  _onMove);
    window.addEventListener('touchmove',  _onMove, { passive: false });
    window.addEventListener('mouseup',    _onEnd);
    window.addEventListener('touchend',   _onEnd);

    wireCvs.addEventListener('mouseenter', () => {
      _wireGlow = 1;
      const fade = () => { if (!_dragging) { _wireGlow = Math.max(0, _wireGlow - 0.05); } _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow); if (_wireGlow > 0.01 || _dragging) requestAnimationFrame(fade); };
      if (!_wireRafId) requestAnimationFrame(fade);
    });
    wireCvs.addEventListener('mouseleave', () => { if (!_dragging) _wireGlow = 0; });

    // Right-click → static point source; Shift+right-click → live oscillating beam
    fieldCell.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = fieldCell.canvas.getBoundingClientRect();
      const gx = Math.floor(((e.clientX - r.left) / r.width)  * GRID);
      const gy = Math.floor(((e.clientY - r.top)  / r.height) * GRID);
      if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID)
        injectEvent?.({ type: e.shiftKey ? 'addBeam' : 'addPoint', gx, gy });
    });

    [fieldCell.canvas, phaseCell.canvas, plateCell.canvas, cloudCell.canvas].forEach(c => {
      c.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));
    });

    // ── Main render ────────────────────────────────────────────────────────────
    const TWO_PI = 2 * Math.PI;
    const LOG_K = 99;
    const logS = 1 / Math.log(1 + LOG_K);

    const _renderFrame = () => {
      const n = world.getNodeState('hologram4');
      if (!n?.psi) return;

      const psi      = n.psi;
      const plate    = n.plate;
      const refField = n.refField;
      const lt       = world.ps.app.logicalTime ?? 0;
      const dir      = n.direction ?? 1;

      // Update local angle from world state (if not dragging)
      if (!_dragging) {
        _localAngleY = n.angleY ?? INIT_ANGLE_Y;
        _localAngleX = n.angleX ?? INIT_ANGLE_X;
      }

      let maxField = 1e-9;
      for (let j = 0; j < N_CELLS; j++) {
        const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
        if (v > maxField) maxField = v;
      }
      _smoothMaxField = _smoothMaxField < 1e-9 ? maxField : _smoothMaxField * 0.96 + maxField * 0.04;
      const norm = 1 / Math.sqrt(_smoothMaxField);

      let maxPlate = 1e-9;
      if (plate) {
        for (let j = 0; j < N_CELLS; j++) if (plate[j] > maxPlate) maxPlate = plate[j];
        _smoothMaxPlate = _smoothMaxPlate < 1e-9 ? maxPlate : _smoothMaxPlate * 0.96 + maxPlate * 0.04;
      }
      const plateNorm = 1 / Math.sqrt(_smoothMaxPlate);

      // ── Bilinear upsampled rendering (precomputed tables) ────────────────
      for (let ry = 0; ry < RH; ry++) {
        const cy0 = _by0[ry], cy1 = _by1[ry];
        const ty1 = _bty1[ry], ty  = _bty[ry];
        for (let rx = 0; rx < RW; rx++) {
          const cx0 = _bx0[rx], cx1 = _bx1[rx];
          const tx1 = _btx1[rx], tx = _btx[rx];
          const j00 = (cy0 * GRID + cx0), j10 = (cy0 * GRID + cx1);
          const j01 = (cy1 * GRID + cx0), j11 = (cy1 * GRID + cx1);
          const w00 = tx1*ty1, w10 = tx*ty1, w01 = tx1*ty, w11 = tx*ty;
          const re = psi[j00*2]*w00 + psi[j10*2]*w10 + psi[j01*2]*w01 + psi[j11*2]*w11;
          const im = psi[j00*2+1]*w00 + psi[j10*2+1]*w10 + psi[j01*2+1]*w01 + psi[j11*2+1]*w11;
          const bi = (ry * RW + rx) * 4;

          const amp = Math.sqrt(re*re + im*im) * norm;
          const lv  = Math.log(1 + LOG_K * amp) * logS;
          const [fr, fg, fb] = colormaps.hologram(lv);

          fieldBuf.data[bi]   = fr; fieldBuf.data[bi+1] = fg;
          fieldBuf.data[bi+2] = fb; fieldBuf.data[bi+3] = 255;

          const [pr, pg, pb] = colormaps.phase(re, im, norm);
          phaseBuf.data[bi]   = pr; phaseBuf.data[bi+1] = pg;
          phaseBuf.data[bi+2] = pb; phaseBuf.data[bi+3] = 255;

          let rv;
          if (dir === 1 && plate) {
            const pl = plate[j00]*w00 + plate[j10]*w10 + plate[j01]*w01 + plate[j11]*w11;
            rv = Math.sqrt(pl) * plateNorm;
          } else {
            rv = amp;
          }
          const rlv  = Math.log(1 + LOG_K * rv) * logS;
          const [rr, rg, rb] = colormaps.hologram(rlv);
          plateBuf.data[bi]   = rr; plateBuf.data[bi+1] = rg;
          plateBuf.data[bi+2] = rb; plateBuf.data[bi+3] = 255;
        }
      }
      fieldCell.ctx.putImageData(fieldBuf, 0, 0);
      phaseCell.ctx.putImageData(phaseBuf, 0, 0);
      plateCell.ctx.putImageData(plateBuf, 0, 0);

      // ── Depth point cloud ─────────────────────────────────────────────────
      // Each tier d maps to a virtual Z depth in [-1,+1]: near=+1 (front), far=-1 (back).
      // Peak-amplitude cells (top-20 per tier) are projected using the same
      // perspective as _drawCube. Cloud is computed synchronously on RECON switch
      // and refreshed every _reconLoop tick (~1.5s).
      {
        const cloud = n.reconCloud;
        cloudCell.wrap.firstChild.textContent =
          dir === 1 ? 'DEPTH CLOUD  source tiers  live' : 'DEPTH CLOUD  tier tomography  live';
        const cw = cloudCell.canvas.width, ch = cloudCell.canvas.height;
        cloudCell.ctx.fillStyle = '#000';
        cloudCell.ctx.fillRect(0, 0, cw, ch);
        // Tier colors: hue sweep cyan→lime→orange→magenta across N_DEPTH_TIERS
        const TIER_COLORS = Array.from({ length: N_DEPTH_TIERS }, (_, i) => {
          const h = (180 - i * 180 / Math.max(1, N_DEPTH_TIERS - 1)) | 0;
          return `hsl(${h},100%,60%)`;
        });
        const cloudHasCells = cloud?.length === N_DEPTH_TIERS &&
          cloud.some(t => t.cells.length > 0);
        if (cloudHasCells) {
          // 3D perspective projection of stacked depth slabs — draggable view angle.
          // Each tier occupies a Z slice; focal spots are 3D points rotated by
          // _cloudAngleY / _cloudAngleX and projected with simple perspective.
          let gxMin = Infinity, gxMax = -Infinity, gyMin = Infinity, gyMax = -Infinity;
          for (const { cells } of cloud) {
            for (const { x, y } of cells) {
              if (x < gxMin) gxMin = x; if (x > gxMax) gxMax = x;
              if (y < gyMin) gyMin = y; if (y > gyMax) gyMax = y;
            }
          }
          if (!isFinite(gxMin)) { gxMin = 0; gxMax = GRID; gyMin = 0; gyMax = GRID; }
          const gxSpan = Math.max(4, gxMax - gxMin);
          const gySpan = Math.max(4, gyMax - gyMin);
          // Map sub-pixel grid coords → 3D in [-1,+1]³; tier → Z in [-1,+1]
          const toX3 = (gx) => ((gx - gxMin) / gxSpan - 0.5) * 2;
          const toY3 = (gy) => ((gy - gyMin) / gySpan - 0.5) * 2;
          const toZ3 = (d)  => ((d / Math.max(1, N_DEPTH_TIERS - 1)) - 0.5) * 2;

          const cosY = Math.cos(_cloudAngleY), sinY = Math.sin(_cloudAngleY);
          const cosX = Math.cos(_cloudAngleX), sinX = Math.sin(_cloudAngleX);

          // Rotate without translation — find bounding box first, then fit
          const rotateRaw = (x3, y3, z3) => {
            const rx  = cosY * x3 + sinY * z3;
            const rz1 = -sinY * x3 + cosY * z3;
            const ry  = cosX * y3 - sinX * rz1;
            const rz  = sinX * y3 + cosX * rz1;
            return { rx, ry, rz };
          };

          // Sample all 4 corners of every tier slab to find screen extents
          let rxMin = Infinity, rxMax = -Infinity, ryMin = Infinity, ryMax = -Infinity;
          for (let d = 0; d < N_DEPTH_TIERS; d++) {
            const z3 = toZ3(d);
            for (const [cx_, cy_] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
              const { rx, ry } = rotateRaw(cx_, cy_, z3);
              if (rx < rxMin) rxMin = rx; if (rx > rxMax) rxMax = rx;
              if (ry < ryMin) ryMin = ry; if (ry > ryMax) ryMax = ry;
            }
          }
          const pad = 24;  // px padding — enough for 6px label text on all sides
          const SC  = Math.min(
            (cw - 2 * pad) / Math.max(0.01, rxMax - rxMin),
            (ch - 2 * pad) / Math.max(0.01, ryMax - ryMin)
          ) * 0.82;  // 18% safety margin so splat radii don't clip edges
          // Center the rotated volume on canvas
          const cx0 = cw / 2 - ((rxMin + rxMax) / 2) * SC;
          const cy0 = ch / 2 - ((ryMin + ryMax) / 2) * SC;

          const rotate3 = (x3, y3, z3) => {
            const { rx, ry, rz } = rotateRaw(x3, y3, z3);
            return { sx: cx0 + rx * SC, sy: cy0 + ry * SC, rz };
          };

          // Collect all points with depth for painter's sort
          const pts3d = [];
          for (let d = 0; d < N_DEPTH_TIERS; d++) {
            const { cells } = cloud[d];
            const col = TIER_COLORS[d];
            const z3  = toZ3(d);
            for (const { x, y, amp } of cells) {
              const { sx, sy, rz } = rotate3(toX3(x), toY3(y), z3);
              pts3d.push({ sx, sy, rz, amp, col });
            }
          }
          // Far → near painter's sort
          pts3d.sort((a, b) => a.rz - b.rz);

          // Additive Gaussian splatting — light is strictly additive, splats bloom
          // into continuous surfaces where focal spots cluster (Airy disk rendering).
          cloudCell.ctx.globalCompositeOperation = 'lighter';
          cloudCell.ctx.shadowBlur = 0;
          for (const { sx, sy, amp, col } of pts3d) {
            const r = 3 + amp * 7;  // splat radius scales with intensity
            const grad = cloudCell.ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
            grad.addColorStop(0,   col.replace(')', `,${0.6 + amp * 0.4})`).replace('hsl', 'hsla'));
            grad.addColorStop(0.4, col.replace(')', `,${0.2 + amp * 0.2})`).replace('hsl', 'hsla'));
            grad.addColorStop(1,   col.replace(')', ',0)').replace('hsl', 'hsla'));
            cloudCell.ctx.fillStyle = grad;
            cloudCell.ctx.globalAlpha = 1;
            cloudCell.ctx.beginPath();
            cloudCell.ctx.arc(sx, sy, r, 0, Math.PI * 2);
            cloudCell.ctx.fill();
          }
          cloudCell.ctx.globalCompositeOperation = 'source-over';

          // Slab outlines — corners at ±1 in XY plane, each tier's Z
          cloudCell.ctx.shadowBlur = 0;
          for (let d = N_DEPTH_TIERS - 1; d >= 0; d--) {
            const col = TIER_COLORS[d];
            const z3  = toZ3(d);
            const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([cx_, cy_]) => {
              const { sx, sy } = rotate3(cx_, cy_, z3);
              return [sx, sy];
            });
            cloudCell.ctx.globalAlpha = 0.12;
            cloudCell.ctx.strokeStyle = col;
            cloudCell.ctx.lineWidth = 0.8;
            cloudCell.ctx.beginPath();
            cloudCell.ctx.moveTo(corners[3][0], corners[3][1]);
            for (const [px, py] of corners) cloudCell.ctx.lineTo(px, py);
            cloudCell.ctx.stroke();
            cloudCell.ctx.globalAlpha = 0.6;
            cloudCell.ctx.fillStyle = col;
            cloudCell.ctx.font = '6px ui-monospace,monospace';
            const label = d === 0 ? 'near' : d === N_DEPTH_TIERS - 1 ? 'far' : 'mid' + d;
            cloudCell.ctx.fillText('T' + d + ' ' + label, corners[0][0] + 2, corners[0][1] - 2);
          }
          cloudCell.ctx.globalAlpha = 1;
          cloudCell.ctx.shadowBlur  = 0;
        } else {
          cloudCell.ctx.fillStyle = '#444';
          cloudCell.ctx.font = '7px ui-monospace,monospace';
          const msg = dir === 1 ? 'waiting for IFS cycle…' : 'record first, then reconstruct';
          cloudCell.ctx.fillText(msg, 8, ch / 2);
        }
      }

      // Wireframe
      _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow);

      // Mode indicator
      const isRec  = dir === 1;
      plateCell.wrap.firstChild.textContent = isRec
        ? 'IFS HOLOGRAM PLATE  |ψ_obj+ψ_ref|²  native'
        : 'IFS RECON BEAM  |ψ|²  Lévy collapse';
      const ml = document.getElementById(containerId + '-mode');
      if (ml) {
        ml.textContent  = isRec ? '● RECORDING' : '◎ RECONSTRUCTING';
        ml.style.color  = isRec ? '#9c4' : '#4af';
      }
      btnRecord.style.opacity = isRec ? '1' : '0.4';
      btnRecon.style.opacity  = isRec ? '0.4' : '1';
      const TM = n.tomoMode ?? TOMO_MODE;
      btnTomo.textContent    = TM ? '⊕ TOMO  on' : '⊕ TOMO  off';
      btnTomo.style.background = TM ? '#a63' : '#555';
      btnTomo.style.color      = TM ? '#fff' : '#aaa';

      // Sync probe UI from world state (keeps second peer in sync)
      const wProbe   = n.depthProbe;
      const wFrac    = wProbe?.depthFraction ?? 0;
      const wBucket  = wProbe
        ? (TM
            ? Math.min(N_DEPTH_TIERS - 1, Math.floor(wFrac * N_DEPTH_TIERS))
            : Math.floor(wFrac * 20))
        : -1;
      if (!!wProbe !== _probeActive || (wProbe && wBucket !== _probeTierSent)) {
        const pct = wProbe ? Math.round(wFrac * 100) : 0;
        _updateProbeUI(!!wProbe, pct);
        if (wProbe) { probeSlider.value = pct; _probeTierSent = wBucket; }
        else _probeTierSent = -1;
      }
      if (wProbe && _probeActive) {
        if (TM) {
          const tier  = wProbe.tierIdx ?? 0;
          const steps = Math.round(T_RECORD * (tier + 1) / N_DEPTH_TIERS);
          const label = tier === 0 ? 'near' : tier === N_DEPTH_TIERS - 1 ? 'far' : 'mid-' + tier;
          probeLbl.textContent = 'DEPTH  tier' + tier + '  ' + label + '  [' + (isRec ? 'rec' : 'recon@' + steps + 'st') + ']';
        } else {
          const steps = Math.max(1, Math.round(wFrac * T_RECORD));
          probeLbl.textContent = 'DEPTH  ' + Math.round(wFrac * 100) + '%  [' + (isRec ? 'rec' : 'recon@' + steps + 'st') + ']';
        }
      }

      // Title
      const isActive = !!(n.slotActive_A || n.slotActive_B);
      title.style.color = isRec ? '#9c4' : '#4af';
      title.textContent =
        `PEER ${peerId} · HOLOGRAM4  s≈${(n.ifsSEff ?? 0).toFixed(3)}  ` +
        (n.slotActive_A ? '[A]' : '') + (n.slotActive_B ? '[B]' : '');

      // Stats
      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `t=${(n.time ?? 0).toFixed(1)}  cyc=${n.cycleCount ?? 0}` +
        `  R=[${n.ifsRadiiStr ?? ''}]  ${_clientBadge(world)}`;

      // IFS clock
      const energyA = n.slotEnergy_A ?? [], energyB = n.slotEnergy_B ?? [];
      const mergedEnergy = energyA.map((v, i) => Math.max(v, energyB[i] ?? 0));
      const mergedEvents = [...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])]
        .sort((a, b) => a.wt - b.wt).slice(-80);
      ifsClock.update({ energy: mergedEnergy, events: mergedEvents, isActive, lt });

      _renderAvatars(world, root);
    };

    // RAF loop — throttled to ~30 fps to keep main thread free for input events
    let _rafId = null, _lastRenderMs = 0;
    const RENDER_INTERVAL_MS = 33;  // ~30 fps
    const _rafLoop = (ts) => {
      _rafId = requestAnimationFrame(_rafLoop);
      if (ts - _lastRenderMs < RENDER_INTERVAL_MS) return;
      _lastRenderMs = ts;
      _renderFrame();
    };
    _rafId = requestAnimationFrame(_rafLoop);

    return _renderFrame;
  };
}

export default {
  title:       'Hologram4 | IFS-Native Real-Time Wavefront (no GPU)',
  selo:        'hologram4',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologram4WorldProgram + av],
  makeRenderer: makeHologram4Renderer,
  wrapId:      'hologram4-wrap',
  hideTopBar:  true,
};
