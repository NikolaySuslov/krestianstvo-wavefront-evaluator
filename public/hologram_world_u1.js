/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── hologram_world.js — shared IFS clock world program + physics constants ──────
// Import this in any hologram demo. Provides:
//   hologramWorldProgram  — Renkon world script (IFS clock, kernel, state)
//   REFLECTOR_MS, SUBTICK_MS, GRID, DT, SRC_ALPHA, T_RECORD, ... (all physics constants)
//   CUBE_PTS, PYRAMID_PTS, COMBINED_PTS (geometry)

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';

const REFLECTOR_MS = 50;
const SUBTICK_MS   = 0.09;

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID    = 128;
const N_CELLS = GRID * GRID;

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH   = 2.0;
const DELAY_SCALE  = 0.06;
const GAMMA        = 0.0;     // linear — free-space paraxial propagation
const ISAT         = 1e9;     // saturation disabled
const DT           = 0.12;
const REF_AMP      = 0.3;     // reference plane-wave amplitude
const REF_KX       = 0.20;    // reference wave tilt (x-component of k-vector)
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
const RECON_STEP_DELAY  = 16;  // ms between backward steps (~60fps cadence)
const RECON_HOLD_MS     = 1500; // ms hold before re-seeding
const T_RECORD          = 100;  // IFS pulse steps: forward (record) = backward (reconstruct)
const K_WAVE            = 0.35; // wave number for Huygens ring propagation

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
const PTS_PER_EDGE = 10;
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

const PYRAMID_VERTS = [
  [ 0, 1.4, 0],   // apex
  [-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1],[-1,-1, 1], // base (standalone)
];
const PYRAMID_EDGES = [
  [0,1],[0,2],[0,3],[0,4], // apex to base corners
  [1,2],[2,3],[3,4],[4,1], // base ring
];

// Pyramid seated on top of cube — base corners match cube top face (Y=+1)
const HOUSE_PYRAMID_VERTS = [
  [ 0, 2.4, 0],   // apex (1 unit above cube top)
  [-1, 1,-1],[ 1, 1,-1],[ 1, 1, 1],[-1, 1, 1], // base at cube top face
];
const HOUSE_PYRAMID_EDGES = [
  [0,1],[0,2],[0,3],[0,4], // apex to base corners
  [1,2],[2,3],[3,4],[4,1], // base ring (coincides with cube top — omit for cleaner look)
];

function _sampleEdgeList(verts, edges) {
  const pts = [];
  for (const [ai, bi] of edges) {
    const a = verts[ai], b = verts[bi];
    for (let t = 0; t < PTS_PER_EDGE; t++) {
      const u = (t + 0.5) / PTS_PER_EDGE;
      pts.push([a[0]+u*(b[0]-a[0]), a[1]+u*(b[1]-a[1]), a[2]+u*(b[2]-a[2])]);
    }
  }
  return pts;
}
const CUBE_PTS           = _sampleEdgeList(CUBE_VERTS, CUBE_EDGES);
const PYRAMID_PTS        = _sampleEdgeList(PYRAMID_VERTS, PYRAMID_EDGES);
const HOUSE_PYRAMID_PTS  = _sampleEdgeList(HOUSE_PYRAMID_VERTS, HOUSE_PYRAMID_EDGES);
const COMBINED_PTS       = [...CUBE_PTS, ...HOUSE_PYRAMID_PTS];
const CUBE_PTS_JSON          = JSON.stringify(CUBE_PTS);
const PYRAMID_PTS_JSON       = JSON.stringify(PYRAMID_PTS);
const COMBINED_PTS_JSON      = JSON.stringify(COMBINED_PTS);


// ── World program ─────────────────────────────────────────────────────────────
const hologramWorldProgram = `
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
  const PYRAMID_PTS      = ${PYRAMID_PTS_JSON};
  const COMBINED_PTS     = ${COMBINED_PTS_JSON};
  const SHAPE_PTS        = { cube: CUBE_PTS, pyramid: PYRAMID_PTS, combined: COMBINED_PTS, none: [] };
  const CAM_Z            = ${CAM_Z};
  const PROJ_SCALE       = ${PROJ_SCALE};
  const INIT_ANGLE_Y     = ${INIT_ANGLE_Y};
  const INIT_ANGLE_X     = ${INIT_ANGLE_X};

  ${FRAG.nlsOps(GRID, N_CELLS)}
  ${FRAG.ifsStencil(GRID)}
  ${FRAG.ifsKernels}
  ${FRAG.ifsScheduler}

  // ── Project cube sources onto plate plane ────────────────────────────────
  const _projectSources = (angleY, angleX, shape = 'cube') => {
    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const halfG = (GRID - 1) / 2;
    const fscale = halfG * PROJ_SCALE;
    const reconZ = Math.round(GRID / 16);   // λ²/reconZ > 2px keeps fringes above Nyquist
    const pts    = SHAPE_PTS[shape] ?? CUBE_PTS;
    const total  = pts.length;
    return pts.map(([ox, oy, oz]) => {
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
        amp: 200.0 * (0.5 + 0.5 * (rz + 1) / 2) / total,
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
  const _buildSrcField = (angleY, angleX, shape = 'cube') => {
    const sources = _projectSources(angleY, angleX, shape);
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
  const KERNEL_Q_MAX  = 24;   // synced kernel-change queue depth (covers the max render gap for the transport soliton replay)
  const SHIFT_Q_MAX   = 48;   // synced shift-change queue depth (covers a full slide drag for the transport soliton replay)
  const ATT_Q_MAX     = 64;   // synced att-param queue depth (opSpeed notches + cube-angle drag stream for the soliton drives)
  const SIG_Q_MAX     = 16;   // synced transient-signal queue depth (⚡sig pulses are sparse, user-fired)
  const _buildSrcFieldsByDepth = (angleY, angleX, extraPoints, shape = 'cube') => {
    const sources = _projectSources(angleY, angleX, shape);
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
  const _buildSrcFieldIFS = (angleY, angleX, extraPoints, shape = 'cube') => {
    const tiers = _buildSrcFieldsByDepth(angleY, angleX, extraPoints, shape);
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
  const _buildReconField = (plate, dKX = 0, rotAngle = 0) => {
    let maxP = 1e-9, sumP = 0;
    for (let j = 0; j < NCELLS; j++) {
      if (plate[j] > maxP) maxP = plate[j];
      sumP += plate[j];
    }
    const meanP  = sumP / NCELLS;
    const rangeP = Math.max(1e-9, maxP - meanP);
    const psi    = new Float64Array(2 * NCELLS);
    const cosR = Math.cos(rotAngle), sinR = Math.sin(rotAngle);
    const halfG = (GRID - 1) / 2;
    for (let j = 0; j < NCELLS; j++) {
      const cx = j % GRID, cy = (j / GRID) | 0;
      // Rotate grid coordinates around center
      const dx = cx - halfG, dy = cy - halfG;
      const rx = dx * cosR - dy * sinR + halfG;
      const ry = dx * sinR + dy * cosR + halfG;
      // Bilinear sample from plate at rotated position
      const x0 = Math.floor(rx), y0 = Math.floor(ry);
      const x1 = x0 + 1, y1 = y0 + 1;
      const tx = rx - x0, ty = ry - y0;
      const inBounds = (x, y) => x >= 0 && x < GRID && y >= 0 && y < GRID;
      const samplePlate = (x, y) => inBounds(x, y) ? Math.max(0, plate[y * GRID + x] - meanP) / rangeP : 0;
      const mod = (1 - tx) * (1 - ty) * samplePlate(x0, y0)
                + tx       * (1 - ty) * samplePlate(x1, y0)
                + (1 - tx) * ty       * samplePlate(x0, y1)
                + tx       * ty       * samplePlate(x1, y1);
      const ph = (REF_KX + dKX) * cx;
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
    // MATTER-PACED SIBLING LAUNCH (futureTau — the τ arc's W-node layer, replacing the wall-D/2 stagger): the
    // opposite slot launches when THIS cascade has delivered as many beats as it has roots — the first generation
    // LIVED, not a millisecond guess. This chain provides the OVERLAP (double-buffering) when beats are fast; it
    // is NOT the liveness guarantee: if the stamp is reached while the sibling is still active, the _launchA/B
    // guard drops the launch (live-caught 2026-07-11 as kv pinned at 1 — both slots' chained launches dropped →
    // both died → beatCount froze → permanent halt). Liveness is the finalize fallback in finalizeFresnelm:
    // a finalizing slot relaunches a DEAD sibling immediately. Together: overlap from matter, liveness from the
    // window boundary, and the dead wall-rest between cycles stays gone.
    ctx.futureTau(N_FRESNEL_ROOTS, '_launch' + (slot === 'A' ? 'B' : 'A'), { cycleId: cycleId + 1 });
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

  const mediumU1 = Behaviors.collect(
    {
      time:       0,
      shape:      'cube',
      angleY:     INIT_ANGLE_Y,
      angleX:     INIT_ANGLE_X,
      reconAngleY: INIT_ANGLE_Y,
      reconAngleX: INIT_ANGLE_X,
      lensF: 50,
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
      cachedRadiiVersion: 0, cachedRadiiTime: 0, kernelQueue: [],
      plateResetSeq: 0,
      plateSnapSeq: 0,
      reconSeq: 0,
      ifsNBands: 0, ifsSEff: 0, ifsRadiiStr: '',
      eyeHMode: 0, eyeHParam: 0.5, eyeHBlock: 8, eyeTSteps: 10,
      eyeMix: 0, eyeOnly: false,
      // Eye DISPLAY mode + sound — shared world state so all peers render the same mode and the
      // sequencer is deterministic from the clock (Krestianstvo compliance, doc §7.13). One enum
      // (mutually-exclusive) replaces scattered client booleans. '' = none (plain live grid).
      eyeDisplayMode: '', eyeSoundOn: false, eyeTau: 0,   // eyeTau: shared depth-scrub position
      // ── medium.js (the meta-circular world-lens demo) SHARED control state — every UI button/slider rides the
      //    reflector so two peers stay byte-identical (no optimistic local mutation; the sender also reads it back).
      medMode: 'pass', medOp: 'gauge', medWorld: false, medObj: 'cube', medRank: 0, medSelfLaw: 'orbit', medHideLive: true,
      medFocus: 1.0, medTheta: 0.0, medShiftX: 0, medShiftY: 0, medShiftTime: 0, medShiftFromX: 0, medShiftFromY: 0, medShiftTime2: 0, medShiftSeq: 0, shiftQueue: [], medPropT: 2, medFocalDt: 1.0, medOpSpeed: 6, medHoloT: 0, medCueClean: 0.6,
      medAttSeq: 0, attQueue: [],   // SYNCED ATT-PARAM QUEUE (mirrors shiftQueue): stamped opSpeed/cube-angle changes → the soliton drives apply them at SHARED steps (an un-stamped att param read at the render tick = peer-local → transport/objorbit desync)
      medSigSeq: 0, sigQueue: [],   // TRANSIENT SIGNAL queue (the RADIATION SECTOR — probe-measured: mobile packets are marginal/transient; persistent matter is pinned): stamped ⚡sig events, injected into ψ at SHARED steps → a kicked marginal packet flies from→toward and dies (honest radiation, byte-identical on peers)
      medEarR: false, medEarPh: -1,
      medBound: false,   // boundary condition (REPLICATED — it multiplies ψ, i.e. physics): false=closed (reflecting; the halo law visible), true=open (absorbing rim; note the energy cap recycles what the rim eats)
      medCoevo: true,   // DEFAULT ON (the closed dual-layer loop is the medium's native law): identical to the chase while the leash is slack; honestly slows instead of death-regrow when demand exceeds the medium. Toggle off = the open-loop chase.
      medOrbR: 16,                  // objorbit radius (the Kepler-test dial — window.orbR(r) sets it with an anchor bump)
      medOrbW: 1,
      medVirtSeq: 0, medVirtTime: 0, medVirtMode: 'record', medVirtLeak: 0, medVirtSlot: 0, medVirtGx: 0, medVirtGy: 0,   // ⎙virt — the HYPERVISOR verbs, stamped: record (hologram W → lift → V) · relift (resume V from the stored plate = time-travel to the recorded moment) · swap (V↔W — the dream becomes the world). All execute at the shared step on every peer (derived, byte-identical).                   // objorbit schedule multiplier (Kepler dial 2: opSpeed 16 gives only ~0.22px/step at R=22 — far below the chase's ~1px/step ceiling; the leash can't bind until the schedule exceeds the medium)              // ⟲coevo — CLOSED-LOOP transport: the operator position is LEASHED to the soliton's measured centroid (matter tells geometry how far it may go; the Einstein loop at the transport level). Derived deterministically from the shared field at shared steps; only the toggle rides the model. // REPLICATED REACTOR: 👂react toggle + listening phase slot (-1=any; 0..7 = the signal clock's 8×19-step slots). The reactor itself is DERIVED state (every peer computes identical hits from the identical field at shared steps → identical local replies, no reflector traffic) — only the toggle/slot ride the world model.
      medView: 'soliton',   // canvas-2 view: 'soliton' = the living lensed soliton (the world) | 'crisp' = the direct lens output (eye-percept preview)
      medDrive: 'write',    // soliton DRIVE mode — REPLICATED so both peers run the same physics (write|hybrid|sol-cons|sol-diss|transport|trueorbit|objorbit)
      medSnapVer: 0, medSnapClock: 0,   // SNAPSHOT-ON-TOGGLE anchor: version (signals re-anchor) + the SYNCED clock origin (s.time at publish) → every peer anchors the soliton step-clock to the SAME origin → byte-identical (peers present at toggle stay clock-locked; the ψ field is renderer-local, NOT shipped — late joiners re-seed + converge)
      // EYE lens state — fully REPLICATED (mirror of med*) so the eye is peer-deterministic too. mode/rank/view + lens params +
      // eye-only controls (occlusion, manual focus, code operator/mask, warp DOFs, optics, growth). All set via the setEye event.
      eyeMode: 'pass', eyeOp: 'gauge', eyeRank: 0, eyeSelfLaw: 'orbit', eyeView: 'soliton',
      eyeFocus: 1.0, eyeTheta: 0.0, eyeShiftX: 0, eyeShiftY: 0, eyePropT: 2, eyeFocalDt: 1.0, eyeOpSpeed: 6, eyeHoloT: 12, eyeCueClean: 0.6,
      eyeOptics: false, eyeFocusManual: 0, eyeOccMode: 0, eyeOccR: 0.5, eyeOccBlock: 8,
      eyeCodeMask: 0, eyeCodeWarp: 0, eyeCodeWarpS: 1, eyeCodeWarpTheta: 1, eyeCodeWarpTx: 1, eyeCodeWarpTy: 1, eyeCodeWarpMaps: 8, eyeResoStr: 1.5, eyeSrc: 'W',   // resonance lens strength (obj:hidden) · eyeSrc = the eye's PHASE SELECTOR (W = driven world, V = virtual phase — the eye can look INTO the dream)
      eyeGrowMax: 0,   // SHARED growth ceiling (self-evolution) — replicated so peers grow identical genomes
      instBar: -1, instScope: 'eye', instAmp: 11.0, instHold: 0, instBoff: 1, instTunnel: false, instTunnelMode: 'switch', instVer: 0, instReconVer: 0,   // INSTANTON: fire / scope / amp / hold / B-offset / TUNNEL on + mode / versions (all replicated)
      // committed genome OVERRIDES (rank → maps[]) + a version counter. setGenome (commit/revert) writes here → the bank mutation is
      // replicated (both peers apply identical overrides). _evolved is peer-pure (f(bar)) so the committed maps are byte-identical.
      genomeOverrides: {}, genomeVer: 0,
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (['rotate','toggleMode','resetPlate','snapPlate','nextCycle','addPoint','addBeam','setDepthProbe','dragStart','dragEnd','toggleTomo','setShape',
             'setBreath','setPlateDriven','setNoHebb','setNullPlate','setPlateKernel','setDemodKick','setPlateSeedFree','setReconReset','setKickParams','setBackPlate','setHamiltonian','setRecordMode','setLiveMode','setGsPropagator','setGsNoiseSeed','setDirectBack','pointTest',
             'setEyeH','setEyeT','setEyeMix','setEyeOnly','setEyeDisplay','setEyeSound','setEyeTau',
             'setOpEvolve','opEvolveWrite','setOpCyc','setOpNlho','setOpNlhoRate','setOpNlhoMode','setOpNlhoDrive','setOpPureMedium','setOpNlhoThetaMedium','setOpNlhoSolitonTheta','opEvolveCheckpoint','setMedium','setEye','setShared','setGenome','setMediumSnapshot','mediumSignal','mediumVirt'].includes(t))
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} }, ...(s._queue ?? [])] };
      }
      return W.reduce(s, pulse, 'mediumU1', {

        // THE WORLD'S OWN CLOCK (futureTau — the τ arc's W-node layer): a pure, monotone function of replicated
        // state, read by the kernel's proper-time dispatch. beatCount = fresnel beats LIVED (both slots) — the
        // model's fine heartbeat; cycleCount stays available as the coarse bar. ctx.futureTau(n, msg) here means
        // "when the world has lived n more beats" — a τ future on a stalled cascade honestly WAITS. THE LINE
        // (§6b, permanent): the INTRA-cascade delays (fresnelBeat's self/child delays, the log-distributed roots)
        // are the GENOME'S CONTENT expressed in time — the fractal-time generator itself — and stay coordinate-
        // authored forever (a clock's mechanism cannot wait on the clock it defines). Only the INTER-cycle glue
        // (the slot stagger below) rides futureTau.
        __clock: (s) => s.beatCount ?? 0,

        __macro: (s, p, ctx) => {
          if (p.isSubTick) return s;
          if (p.logicalTime !== 1) return s;
          ctx.future(100, '_keepalive', {});
          let s2 = _launchSlot({ ...s, time: 0 }, ctx, 'A', p.logicalTime);
          // (the sibling launch is chained inside _launchSlot — matter-paced, see there)
          return s2;
        },

        _keepalive: (s, p, ctx) => {
          ctx.future(100, '_keepalive', {});
          return s;
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
          ctx.future(NEXT_STEP_DELAY, '_physStep', {});
          return { ...s, time: (s.time ?? 0) + DT };
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
          const kbtSrc = s['slotKernelByTier_' + slot];
          const kbt    = Array.from({ length: N_DEPTH_TIERS }, (_, d) =>
            Array.isArray(kbtSrc?.[d]) ? [...kbtSrc[d]] : []);
          const tier   = (srcTier ?? 0) % N_DEPTH_TIERS;
          if (ri < (GRID >> 1)) kbt[tier].push(ri);
          const energy = (s['slotEnergy_' + slot] ?? new Array(IFS_DEPTH).fill(0)).slice();
          energy[depth] = Math.min(1, (energy[depth] ?? 0) + 0.3);
          const events  = [...(s['slotEvents_' + slot] ?? []).slice(-80),
            { d: depth, delay, wt: ctx.wallTime, t: tier }];
          return { ...s,
            beatCount: (s.beatCount ?? 0) + 1,   // the world's HEARTBEAT (the __clock source): fresnel beats lived, both slots — every futureTau in this model waits on THIS
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
          const kbtSrc2 = s['slotKernelByTier_' + slot];
          const kbt = Array.from({ length: N_DEPTH_TIERS }, (_, d) =>
            Array.isArray(kbtSrc2?.[d]) ? kbtSrc2[d] : []);
          const tierKernels = kbt.map(tierK => {
            const { fRadii: tr, fWeights: tw } = _buildNativeKernel(
              tierK.length ? tierK : (fRadii.length ? fRadii : [1]),
              FRAC_ALPHA, MAX_IFS_BANDS);
            return { fRadii: tr, fWeights: tw, fOffs: _buildRingOffsets(tr) };
          });
          // Start time-tick clock on first kernel
          if (!s.cachedRadii.length) {
            ctx.future(0, '_physStep', {});
          }
          // LIVENESS FALLBACK (live-caught 2026-07-11: kv pinned at 1 — the τ-chain alone HALTS): the chained
          // sibling launch can arrive while the sibling is STILL ACTIVE (8 beats < the cascade window) and the
          // _launchA/B guard DROPS it — once both pending launches are dropped, both slots die with nobody left to
          // relaunch and beatCount freezes forever. So: when a slot finalizes and its sibling is dead, relaunch it
          // IMMEDIATELY (coordinate, delay 0 — the honest zero-rest: a system does not rest in its own time while
          // its time is not flowing). The τ-chain still provides the matter-paced OVERLAP when beats are fast; this
          // guarantees the ping-pong can never halt. cycleId +1 keeps the chain numbering identical on both paths
          // (the dropped chain and this fallback would have used the same id — the slotId stale-beat gate stays sound).
          const nextSlot = slot === 'A' ? 'B' : 'A';
          if (!s['slotActive_' + nextSlot]) {
            ctx.future(0, '_launch' + nextSlot, { cycleId: p.cycleId + 1 });
          }
          const newRadiiStr   = fRadii.join(',');
          const kernelChanged = newRadiiStr !== s.ifsRadiiStr;
          return { ...s,
            ['slotActive_'       + slot]: false,
            ['slotKernel_'       + slot]: [],
            ['slotKernelByTier_' + slot]: Array.from({ length: N_DEPTH_TIERS }, () => []),
            cachedRadii: fRadii, cachedWeights: fWeights, cachedOffsets: fOffs,
            cachedRadiiByTier:   tierKernels.map(k => k.fRadii),
            cachedWeightsByTier: tierKernels.map(k => k.fWeights),
            cachedOffsByTier:    tierKernels.map(k => k.fOffs),
            cachedRadiiVersion: kernelChanged ? (s.cachedRadiiVersion ?? 0) + 1 : (s.cachedRadiiVersion ?? 0),
            cachedRadiiTime:    kernelChanged ? (s.time ?? 0) : (s.cachedRadiiTime ?? 0),   // synced s.time when the kernel last changed → peers apply it at the IDENTICAL soliton step (not a peer-local frame) → deterministic
            // SYNCED KERNEL QUEUE: every kernel change appended with its stamped time → a soliton peer that SKIPS an intermediate version (rendered too slowly)
            // still REPLAYS every entry at its stamped step, in order. Kept short (last KERNEL_Q_MAX) — enough to cover the max render gap. Small band-lists, not fields.
            kernelQueue: kernelChanged
              ? [...(s.kernelQueue ?? []).slice(-(KERNEL_Q_MAX-1)), { ver: (s.cachedRadiiVersion ?? 0) + 1, time: (s.time ?? 0), r: fRadii, w: fWeights, o: fOffs }]
              : (s.kernelQueue ?? []),
            ifsNBands: fRadii.length, ifsRadiiStr: newRadiiStr, ifsSEff: sEff,
            cycleCount: (s.cycleCount ?? 0) + 1,
          };
        },

        rotate: (s, p, ctx) => {
          if ((s.direction ?? 1) < 0) {
            return { ...s, reconAngleY: p.angleY ?? s.reconAngleY, reconAngleX: p.angleX ?? s.reconAngleX };
          }
          // Cube angles are baked into the transport/objorbit ATTRACTOR at build time — stamp changes into the att-param queue
          // (same reason as opSpeed: peers must rebuild the att at the IDENTICAL soliton step during a drag, not at their render tick).
          const angChg = (p.angleY != null && p.angleY !== s.angleY) || (p.angleX != null && p.angleX !== s.angleX);
          return { ...s, angleY: p.angleY ?? s.angleY, angleX: p.angleX ?? s.angleX,
            medAttSeq: angChg ? ((s.medAttSeq|0) + 1) : (s.medAttSeq|0),
            attQueue: angChg
              ? [...(s.attQueue ?? []).slice(-(ATT_Q_MAX-1)), { seq: (s.medAttSeq|0) + 1, time: (s.time ?? 0), ay: p.angleY ?? s.angleY, ax: p.angleX ?? s.angleX }]
              : (s.attQueue ?? []) };
        },

        // ── Add point source at grid coordinate ───────────────────────────
        addPoint: (s, p, ctx) => {
          const { gx, gy } = p;
          if (gx === undefined || gy === undefined) return s;
          const ph = ((gx * 7 + gy * 13) & 0xffff) / 0xffff * TWO_PI;
          const amp = 40.0 / 96;
          const extraPoints = [...(s.extraPoints ?? []), { gx, gy, ph, amp }];
          return { ...s, extraPoints };
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

        // ── Depth tier probe (renderer-local physics) ─────────────────────
        // Just updates the probe param; renderer's local GPU loop reads it.
        setDepthProbe: (s, p, ctx) => {
          const { depthFraction } = p;
          if (depthFraction === undefined) return { ...s, depthProbe: null };
          const tierIdx = Math.min(N_DEPTH_TIERS - 1, Math.floor(depthFraction * N_DEPTH_TIERS));
          return { ...s, depthProbe: { depthFraction, tierIdx } };
        },

        setLensF:   (s, p) => ({ ...s, lensF: p.f ?? s.lensF, reconSeq: (s.reconSeq ?? 0) + 1 }),
        setShape:   (s, p) => ({ ...s, shape: p.shape ?? s.shape }),

        dragStart: (s) => ({ ...s, isDragging: true }),
        dragEnd:   (s) => ({ ...s, isDragging: false }),

        // ── Manual plate snapshot trigger ─────────────────────────────────
        snapPlate: (s, p, ctx) => {
          return { ...s, plateSnapSeq: (s.plateSnapSeq ?? 0) + 1 };
        },

        // ── Toggle record / reconstruct ───────────────────────────────────
        toggleMode: (s, p, ctx) => {
          const newDir = (s.direction ?? 1) === 1 ? -1 : 1;
          return { ...s, direction: newDir, reconSeq: (s.reconSeq ?? 0) + 1 };
        },

        // ── Clear plate and return to init ────────────────────────────────
        resetPlate: (s, p, ctx) => {
          return { ...s,
            plateResetSeq: (s.plateResetSeq ?? 0) + 1,
            reconSeq: (s.reconSeq ?? 0) + 1,
            time: 0, direction: 1,
            angleY: INIT_ANGLE_Y, angleX: INIT_ANGLE_X,
            reconAngleY: INIT_ANGLE_Y, reconAngleX: INIT_ANGLE_X,
            extraPoints: [], extraBeams: [], depthProbe: null,
          };
        },

        // ── Single-point reversibility test ──────────────────────────────
        // Clears everything, places one delta source at grid center, records IFS plate,
        // then enters RECON+GS. If GS round-trip is correct, field collapses back to a point.
        pointTest: (s, p, ctx) => {
          const cx = Math.floor(GRID / 2), cy = Math.floor(GRID / 2);
          return { ...s,
            // Full reset — same as resetPlate
            plateResetSeq: (s.plateResetSeq ?? 0) + 1,
            reconSeq:      (s.reconSeq      ?? 0) + 1,
            time: 0, direction: 1,
            angleY: INIT_ANGLE_Y, angleX: INIT_ANGLE_X,
            reconAngleY: INIT_ANGLE_Y, reconAngleX: INIT_ANGLE_X,
            extraBeams: [], depthProbe: null,
            // Point test setup
            extraPoints: [{ gx: cx, gy: cy, ph: 0, amp: 40.0 / 96 }],
            recordMode: 'ifs',
            shape: 'none',
            // Reset mode flags so no stale RECON modes carry over
            backPlateMode: false,
            plateKernelMode: false,
            demodKickMode: false,
            plateSeedFree: false,
            hamiltonianMode: false,
            liveMode: false,
            nullPlateTest: false,
          };
        },

        // ── Toggle tomo / fast recording mode ─────────────────────────────
        toggleTomo: (s, p, ctx) => {
          return { ...s,
            tomoMode: !(s.tomoMode ?? TOMO_MODE),
            plateResetSeq: (s.plateResetSeq ?? 0) + 1,
            reconSeq: (s.reconSeq ?? 0) + 1,
            time: 0, direction: 1, depthProbe: null,
          };
        },

        nextCycle: (s, p, ctx) => {
          if (s.slotActive_A && s.slotActive_B) return s;
          const slot = !s.slotActive_A ? 'A' : 'B';
          return _launchSlot(s, ctx, slot, ctx.wallTime + 1);
        },

        setBreath:       (s, p) => ({ ...s, breathVis:       p.value ?? !(s.breathVis       ?? true) }),
        setPlateDriven:  (s, p) => ({ ...s, plateDrivenMode: p.value ?? !(s.plateDrivenMode  ?? true) }),
        setNoHebb:       (s, p) => ({ ...s, noHebbTest:      p.value ?? !(s.noHebbTest       ?? false) }),
        setNullPlate:    (s, p) => ({ ...s, nullPlateTest:   p.value ?? !(s.nullPlateTest    ?? false) }),
        setPlateKernel:  (s, p) => ({ ...s, plateKernelMode: p.value ?? !(s.plateKernelMode  ?? false), demodKickMode: false }),
        setDemodKick:    (s, p) => ({ ...s, demodKickMode:   p.value ?? !(s.demodKickMode    ?? false), plateKernelMode: false }),
        setPlateSeedFree:(s, p) => ({ ...s, plateSeedFree:   p.value ?? !(s.plateSeedFree    ?? false) }),
        setReconReset:   (s, p) => ({ ...s, reconResetSeq: (s.reconResetSeq ?? 0) + 1 }),
        setBackPlate:    (s, p) => ({ ...s, backPlateMode: p.value ?? !(s.backPlateMode ?? false), plateKernelMode: false, demodKickMode: false }),
        setHamiltonian:  (s, p) => ({ ...s, hamiltonianMode: p.value ?? !(s.hamiltonianMode ?? false) }),
        setRecordMode:   (s, p) => ({ ...s, recordMode: p.mode ?? 'vol' }),
        setLiveMode:     (s, p) => ({ ...s, liveMode: p.value ?? !(s.liveMode ?? false) }),
        setEyeH:         (s, p) => ({ ...s, eyeHMode: p.hMode ?? s.eyeHMode, eyeHParam: p.hParam ?? s.eyeHParam, eyeHBlock: p.hBlock ?? s.eyeHBlock }),
        setEyeT:         (s, p) => ({ ...s, eyeTSteps: p.tSteps ?? s.eyeTSteps }),
        setEyeMix:       (s, p) => ({ ...s, eyeMix: p.mix ?? s.eyeMix }),
        setEyeOnly:      (s, p) => ({ ...s, eyeOnly: p.value ?? !(s.eyeOnly ?? false) }),
        // Eye display mode: toggle off if same mode re-sent, else switch. Mutually exclusive.
        setEyeDisplay:   (s, p) => ({ ...s, eyeDisplayMode: (s.eyeDisplayMode === p.mode) ? '' : (p.mode ?? '') }),
        setEyeSound:     (s, p) => ({ ...s, eyeSoundOn: p.value ?? !(s.eyeSoundOn ?? false) }),
        setEyeTau:       (s, p) => ({ ...s, eyeTau: p.tau ?? s.eyeTau ?? 0 }),
        setGsPropagator: (s, p) => ({ ...s, gsPropagator: p.mode ?? 'ifs' }),
        setGsNoiseSeed:  (s, p) => ({ ...s, gsNoiseSeed:   p.value ?? !(s.gsNoiseSeed   ?? false) }),
        setDirectBack:   (s, p) => ({ ...s, directBackMode: p.value ?? !(s.directBackMode ?? false) }),
        setKickParams:   (s, p) => ({ ...s,
          plateKernelGamma: p.gamma   ?? s.plateKernelGamma,
          plateKernelDT:    p.dt      ?? s.plateKernelDT,
          plateKernelSteps: p.steps   ?? s.plateKernelSteps,
          gsSteps:          p.gsSteps ?? s.gsSteps,
        }),

        // ── §7.68 EVOLVE genotype in the WORLD MODEL (shared-by-ADOPTION — the measured resolution).
        //    The §7.66 margin-determinism experiment FAILED across browsers: peers' travelling fields are
        //    only pure-modulo-JOIN (different join times / re-inits = percent-level field differences ≫
        //    the hysteresis band sized for float spread), so locally-harvested genomes diverge. Therefore
        //    each mutation — born from ONE peer's private physics — is genuinely NEW SHARED INFORMATION
        //    and must cross the wire once, like a measurement outcome: peers PROPOSE (opEvolveWrite), the
        //    reflector's total order picks the first per (rule, bar), and ALL peers adopt the model's
        //    bits. Changed-only proposals keep the wire SILENT at fixed points; the genome lives in model
        //    state, so SNAPSHOTS serve joiners natively (no checkpoints needed). The shared toggle keeps
        //    every peer evolving together (no master — proposals are near-identical; arbitration picks
        //    among near-equals and adoption makes the choice everyone's).
        // §7.70: ⊕ OP-CYC display mode is SHARED — joiners enter it automatically (no manual switch).
        setOpCyc: (s, p) => ({ ...s, opCycOn: p.value ?? !(s.opCycOn ?? false) }),
        setOpNlho: (s, p) => ({ ...s, opNlhoOn: p.value ?? !(s.opNlhoOn ?? false) }),   // §7.88e SHARED LIVE-NLHO toggle
        setOpNlhoRate: (s, p) => ({ ...s, opNlhoRate: Math.max(0.01, Math.min(0.5, p.value || 0.06)) }),   // §7.88g SHARED evo rate (genome param → all peers identical)
        setOpNlhoMode: (s, p) => ({ ...s, opNlhoMode: (p.value === 'self' || p.value === 'witness' || p.value === 'off') ? p.value : (s.opNlhoMode ?? 'self') }),   // §7.88aa SHARED evolution mode → joiners match
        setOpPureMedium: (s, p) => ({ ...s, opPureMedium: p.value ?? !(s.opPureMedium ?? true) }),   // §7.91 SHARED pure-medium binding (default ON → all peers + joiners run the optical-chip operator identically)
        setOpNlhoThetaMedium: (s, p) => ({ ...s, opNlhoThetaMedium: p.value ?? !(s.opNlhoThetaMedium ?? false) }),   // §7.92 SHARED θ-walk-in-medium (default OFF → the medium rotates its own genome via rotateEyeCenters when ON; all peers match)
        setOpNlhoSolitonTheta: (s, p) => ({ ...s, opNlhoSolitonTheta: p.value ?? !(s.opNlhoSolitonTheta ?? true) }),   // §7.100c SHARED soliton-collision θ-walk (DEFAULT ON, peer-verified — θ rotated by soliton kick + IFS-native dispersion wash on a low-k phase tilt; all peers + joiners run the deep operator)
        // ── medium.js controls: ONE reducer for every button/slider (only provided fields update, others kept). The
        //    sender does NOT mutate locally — it injects, the reflector orders it, and ALL peers (incl. the sender)
        //    read it back from n.med* → byte-identical control state, the KWE peer-determinism contract.
        setMedium: (s, p) => ({ ...s,
          medMode:     (p.mode    != null) ? p.mode    : s.medMode,
          medOp:       (p.op      != null) ? p.op      : s.medOp,
          medWorld:    (p.world   != null) ? !!p.world : s.medWorld,
          medObj:      (p.obj     != null) ? p.obj     : s.medObj,
          // OBJ CHANGE while a soliton drive runs = a re-seed on every peer; without a SHARED anchor each peer re-seeds at its
          // own frame's local step → divergent steps-since-seed → transport desync. Bump the snapshot anchor ATOMICALLY with the
          // obj change (one reducer update, no two-event window) so all peers re-anchor the step-clock to the same origin and
          // att-seed at step 0 — the same recipe the drive toggle uses via setMediumSnapshot. Harmless outside soliton modes.
          medSnapVer:   (p.obj != null && p.obj !== s.medObj) ? ((s.medSnapVer|0) + 1) : (s.medSnapVer|0),
          medSnapClock: (p.obj != null && p.obj !== s.medObj) ? (s.time ?? 0) : (s.medSnapClock ?? 0),
          medHideLive: (p.hideLive != null) ? !!p.hideLive : s.medHideLive,
          medEarR:  (p.earR != null) ? !!p.earR : (s.medEarR ?? false),
          medCoevo: (p.coevo != null) ? !!p.coevo : (s.medCoevo ?? true),
          medBound: (p.bound != null) ? !!p.bound : (s.medBound ?? false),
          medOrbR:  (typeof p.orbR === 'number') ? Math.max(6, Math.min(28, p.orbR)) : (s.medOrbR ?? 16),
          medOrbW:  (typeof p.orbW === 'number') ? Math.max(1, Math.min(8, p.orbW)) : (s.medOrbW ?? 1),
          medEarPh: (typeof p.earPh === 'number') ? Math.max(-1, Math.min(1, p.earPh|0)) : (s.medEarPh ?? -1),   // 2 slots × 480 steps (v3: slot must contain the WHOLE event — injection window + propagation + far-side echo + lingering)
          medRank:     (typeof p.rank     === 'number') ? (p.rank|0)                          : s.medRank,
          medSelfLaw:  (p.selfLaw != null) ? p.selfLaw : s.medSelfLaw,
          medFocus:    (typeof p.focus    === 'number') ? Math.max(0.3, Math.min(1.8, p.focus)) : s.medFocus,
          medTheta:    (typeof p.theta    === 'number') ? Math.max(-3.1416, Math.min(3.1416, p.theta)) : s.medTheta,
          medShiftX:   (typeof p.shiftX   === 'number') ? Math.max(-12, Math.min(12, p.shiftX)) : s.medShiftX,
          medShiftY:   (typeof p.shiftY   === 'number') ? Math.max(-12, Math.min(12, p.shiftY)) : s.medShiftY,
          medShiftTime: (typeof p.shiftX === 'number' || typeof p.shiftY === 'number') ? (s.time ?? 0) : (s.medShiftTime ?? 0),   // synced s.time of the last shift → transport ease anchors to the IDENTICAL step on every peer (deterministic)
          // FROM = the value BEFORE this shift + the time it had been at → the transport ease is a PURE function of synced state (from → to over steps since shiftTime),
          // NO peer-local startPos capture (which diverged during a drag when peers sampled different intermediate shifts). Only re-based when the value actually changes.
          medShiftFromX: (typeof p.shiftX === 'number' && p.shiftX !== s.medShiftX) ? (s.medShiftX ?? 0) : (s.medShiftFromX ?? 0),
          medShiftFromY: (typeof p.shiftY === 'number' && p.shiftY !== s.medShiftY) ? (s.medShiftY ?? 0) : (s.medShiftFromY ?? 0),
          medShiftTime2: ((typeof p.shiftX === 'number' && p.shiftX !== s.medShiftX) || (typeof p.shiftY === 'number' && p.shiftY !== s.medShiftY)) ? (s.time ?? 0) : (s.medShiftTime2 ?? 0),   // time of the last VALUE change (dedupes same-value re-stamps)
          // SYNCED SHIFT QUEUE: every value change appended with its stamped time + atomic {to,from}. A slide streams many intermediate shifts; the node holds only the
          // latest, so a slow peer's render tick would SKIP intermediates and latch a different one → divergence. The queue holds every intermediate so both peers replay
          // the IDENTICAL ordered sequence at the IDENTICAL soliton steps (mirrors kernelQueue). Kept short (last SHIFT_Q_MAX). Tiny scalars, not fields.
          // MONOTONIC seq (NOT array index): the queue is truncated (.slice) so array positions drift; the renderer cursors on seq → new shifts always pull in.
          medShiftSeq: ((typeof p.shiftX === 'number' && p.shiftX !== s.medShiftX) || (typeof p.shiftY === 'number' && p.shiftY !== s.medShiftY)) ? ((s.medShiftSeq|0) + 1) : (s.medShiftSeq|0),
          shiftQueue: ((typeof p.shiftX === 'number' && p.shiftX !== s.medShiftX) || (typeof p.shiftY === 'number' && p.shiftY !== s.medShiftY))
            ? [...(s.shiftQueue ?? []).slice(-(SHIFT_Q_MAX-1)), {
                seq: (s.medShiftSeq|0) + 1,
                time: (s.time ?? 0),
                toX:   (typeof p.shiftX === 'number') ? Math.max(-12, Math.min(12, p.shiftX)) : (s.medShiftX ?? 0),
                toY:   (typeof p.shiftY === 'number') ? Math.max(-12, Math.min(12, p.shiftY)) : (s.medShiftY ?? 0),
                fromX: (typeof p.shiftX === 'number' && p.shiftX !== s.medShiftX) ? (s.medShiftX ?? 0) : (s.medShiftFromX ?? 0),
                fromY: (typeof p.shiftY === 'number' && p.shiftY !== s.medShiftY) ? (s.medShiftY ?? 0) : (s.medShiftFromY ?? 0),
              }]
            : (s.shiftQueue ?? []),
          medPropT:    (typeof p.propT    === 'number') ? Math.max(1, Math.min(8, p.propT|0))   : s.medPropT,
          medFocalDt:  (typeof p.focalDt  === 'number') ? Math.max(0.1, Math.min(2.0, p.focalDt)) : s.medFocalDt,
          medOpSpeed:  (typeof p.opSpeed  === 'number') ? Math.max(1, Math.min(16, p.opSpeed|0)): s.medOpSpeed,
          // opSpeed shapes the objorbit ATTRACTOR (θ = k·speed·w) — stamp value changes into the att-param queue so every peer
          // switches speed at the IDENTICAL soliton step (a render-tick read = peer-local frame → divergent att history).
          medAttSeq: (typeof p.opSpeed === 'number' && Math.max(1, Math.min(16, p.opSpeed|0)) !== s.medOpSpeed) ? ((s.medAttSeq|0) + 1) : (s.medAttSeq|0),
          attQueue: (typeof p.opSpeed === 'number' && Math.max(1, Math.min(16, p.opSpeed|0)) !== s.medOpSpeed)
            ? [...(s.attQueue ?? []).slice(-(ATT_Q_MAX-1)), { seq: (s.medAttSeq|0) + 1, time: (s.time ?? 0), spd: Math.max(1, Math.min(16, p.opSpeed|0)) }]
            : (s.attQueue ?? []),
          medHoloT:    (typeof p.holoT    === 'number') ? Math.max(0, Math.min(80, p.holoT|0))  : s.medHoloT,
          medCueClean: (typeof p.cueClean === 'number') ? Math.max(0, Math.min(1, p.cueClean))  : s.medCueClean,
          medView:     (p.view    != null) ? p.view    : s.medView,
          medDrive:    (p.drive   != null) ? p.drive   : s.medDrive,
        }),
        // setEye — the EYE lens (mirror of setMedium) + eye-only controls. Replicated → peers byte-identical. Same clamps.
        setEye: (s, p) => ({ ...s,
          eyeMode:     (p.mode    != null) ? p.mode    : s.eyeMode,
          eyeOp:       (p.op      != null) ? p.op      : s.eyeOp,
          eyeRank:     (typeof p.rank     === 'number') ? (p.rank|0)                            : s.eyeRank,
          eyeSelfLaw:  (p.selfLaw != null) ? p.selfLaw : s.eyeSelfLaw,
          eyeView:     (p.view    != null) ? p.view    : s.eyeView,
          eyeFocus:    (typeof p.focus    === 'number') ? Math.max(0.3, Math.min(1.8, p.focus))  : s.eyeFocus,
          eyeTheta:    (typeof p.theta    === 'number') ? Math.max(-3.1416, Math.min(3.1416, p.theta)) : s.eyeTheta,
          eyeShiftX:   (typeof p.shiftX   === 'number') ? Math.max(-12, Math.min(12, p.shiftX))  : s.eyeShiftX,
          eyeShiftY:   (typeof p.shiftY   === 'number') ? Math.max(-12, Math.min(12, p.shiftY))  : s.eyeShiftY,
          eyePropT:    (typeof p.propT    === 'number') ? Math.max(1, Math.min(8, p.propT|0))     : s.eyePropT,
          eyeFocalDt:  (typeof p.focalDt  === 'number') ? Math.max(0.1, Math.min(2.0, p.focalDt)) : s.eyeFocalDt,
          eyeOpSpeed:  (typeof p.opSpeed  === 'number') ? Math.max(1, Math.min(16, p.opSpeed|0)) : s.eyeOpSpeed,
          eyeHoloT:    (typeof p.holoT    === 'number') ? Math.max(0, Math.min(80, p.holoT|0))   : s.eyeHoloT,
          eyeCueClean: (typeof p.cueClean === 'number') ? Math.max(0, Math.min(1, p.cueClean))   : s.eyeCueClean,
          eyeOptics:   (p.optics  != null) ? !!p.optics : s.eyeOptics,
          eyeFocusManual: (typeof p.focusManual === 'number') ? Math.max(-20, Math.min(20, p.focusManual|0)) : s.eyeFocusManual,
          eyeOccMode:  (typeof p.occMode  === 'number') ? (p.occMode|0)                          : s.eyeOccMode,
          eyeOccR:     (typeof p.occR     === 'number') ? Math.max(0, Math.min(1, p.occR))        : s.eyeOccR,
          eyeOccBlock: (typeof p.occBlock === 'number') ? Math.max(1, Math.min(32, p.occBlock|0)) : s.eyeOccBlock,
          eyeCodeMask: (typeof p.codeMask === 'number') ? Math.max(0, Math.min(1, p.codeMask))    : s.eyeCodeMask,
          eyeCodeWarp: (typeof p.codeWarp === 'number') ? Math.max(0, Math.min(1, p.codeWarp))    : s.eyeCodeWarp,
          eyeCodeWarpS:     (typeof p.codeWarpS     === 'number') ? Math.max(0, Math.min(1, p.codeWarpS))     : s.eyeCodeWarpS,
          eyeCodeWarpTheta: (typeof p.codeWarpTheta === 'number') ? Math.max(0, Math.min(1, p.codeWarpTheta)) : s.eyeCodeWarpTheta,
          eyeCodeWarpTx:    (typeof p.codeWarpTx    === 'number') ? Math.max(0, Math.min(1, p.codeWarpTx))    : s.eyeCodeWarpTx,
          eyeCodeWarpTy:    (typeof p.codeWarpTy    === 'number') ? Math.max(0, Math.min(1, p.codeWarpTy))    : s.eyeCodeWarpTy,
          eyeCodeWarpMaps:  (typeof p.codeWarpMaps  === 'number') ? Math.max(1, Math.min(8, p.codeWarpMaps|0)): s.eyeCodeWarpMaps,
          eyeResoStr:       (typeof p.resoStr       === 'number') ? Math.max(0.3, Math.min(3.0, p.resoStr))    : s.eyeResoStr,
          eyeSrc:           (p.src === 'V' || p.src === 'W' || p.src === 'P1' || p.src === 'P2') ? p.src : (s.eyeSrc || 'W'),   // M3b — PHASE SELECTOR: which phase of the ONE soliton the eye traps (W = the driven world, V = the virtual phase). The whole eye machinery (hologram→recon→recall/self) runs on the SELECTED phase.
        }),
        // setShared — params NOT scoped to a lens but shared across both (growth ceiling, instanton). Replicated → peers identical.
        // instanton: a propagation-KICK fired at a deterministic bar (instBar = the bar the event lands on). instVer bumps each fire
        // so a re-fire re-triggers; instScope/instAmp = where + how hard. The app reads these as f(bar) → both peers kick identically.
        setShared: (s, p) => ({ ...s,
          eyeGrowMax: (typeof p.growMax === 'number') ? Math.max(0, Math.min(8, p.growMax|0)) : s.eyeGrowMax,
          instBar:   (typeof p.instBar  === 'number') ? (p.instBar|0)  : s.instBar,
          instScope: (p.instScope != null) ? p.instScope : s.instScope,
          instAmp:   (typeof p.instAmp  === 'number') ? Math.max(0, Math.min(20, p.instAmp)) : s.instAmp,
          instHold:  (typeof p.instHold === 'number') ? Math.max(0, Math.min(12, p.instHold|0)) : s.instHold,
          instBoff:  (typeof p.instBoff === 'number') ? Math.max(1, Math.min(3, p.instBoff|0)) : s.instBoff,   // tunnel destination offset B=A+n (1..3, pick a distinct B)
          instTunnel: (p.instTunnel != null) ? !!p.instTunnel : s.instTunnel,   // TUNNEL on: the kick carries the field A→B (rank+1)
          instTunnelMode: (p.instTunnelMode != null) ? p.instTunnelMode : s.instTunnelMode,   // 'switch' (hard lens-swap) | 'emergent' (physical migration via coevolve)
          instVer:   (typeof p.instVer  === 'number') ? (p.instVer|0)  : s.instVer,
          instReconVer: (typeof p.instReconVer === 'number') ? (p.instReconVer|0) : s.instReconVer,   // ↩recon trigger — both peers run the reconstruct on the same bump (a deterministic read → identical numbers)
        }),
        // setGenome — commit/revert the live (evolved) genome into the bank, REPLICATED. commit writes overrides[rank]=maps; revert
        // clears the most-recent preview marker (the app drops its local _evolved). genomeVer bumps so the app re-derives the bank.
        setGenome: (s, p) => {
          if (p.revert) return { ...s, genomeVer: (s.genomeVer|0) + 1, _genomeRevert: (s._genomeRevert|0) + 1 };
          if (typeof p.rank === 'number' && Array.isArray(p.maps))
            return { ...s, genomeOverrides: { ...s.genomeOverrides, [p.rank|0]: p.maps }, genomeVer: (s.genomeVer|0) + 1 };
          return s;
        },
        // SNAPSHOT-ON-TOGGLE: the toggling peer publishes its current ψ field (plain Array of Float32 values) → REPLICATED so every peer
        // seeds transport/objorbit from the IDENTICAL field. Version bump signals the app to load it. Cleared (null) when a non-snapshot drive
        // medSnapClock = the SYNCED s.time at publish → every peer anchors its soliton step-clock to the IDENTICAL origin (not its locally-observed
        // _monClock, which differs by subtick phase) → byte-identical step count from the shared att-seed. No ψ field (renderer-local).
        setMediumSnapshot: (s) => ({ ...s, medSnapVer: (s.medSnapVer|0) + 1, medSnapClock: (s.time ?? 0) }),

        // ⎙virt — stamp a record+lift of the world soliton (the hypervisor primitive): hologram-record W at the
        // shared step, phase-conjugate lift into the virtual phase V. Verbs accumulate in a seq-stamped LOG (last 16)
        // so a peer that pulls late replays EVERY unseen verb — single latest-verb fields would let a slow peer skip
        // one when two verbs land within its frame gap (executed on fast peers only → byte fork). The latest-verb
        // fields are kept alongside for old readers/.kwe files.
        mediumVirt: (s, p) => { const mode = (p && ['relift','swap','mirror','mux','store','recall','hold','leak','ear','boot','kill','go','tex','aphase','cseed','selfclock','edge','refamp','lenstau','recordraw','recvia','viaphi','lensview','lensset'].includes(p.mode)) ? p.mode : 'record';   // recordraw = ⎙virt with NO birth-default toggles (snap⇢V); recvia = record THROUGH a lens (u-register step 4 — amp = the birth angle φ); viaphi/lensview = replicated bar5 dials (step 5); lensset = the extended readOp components (metric/gauge sector, read-side)
          const e = { seq: (s.medVirtSeq|0) + 1, time: (s.time ?? 0), mode,
            leak: (mode === 'leak') ? Math.max(0, Math.min(0.2, +p.leak || 0)) : (mode === 'edge') ? Math.max(-0.5, Math.min(0.5, +p.leak || 0)) : (s.medVirtLeak ?? 0),   // edge: SIGNED κ — negative = anti-align (the antiferromagnetic coupling of the register Kuramoto/XY machine); range ±0.5 (widened from ±0.2 to match the UI slider)
            slot: (mode === 'boot') ? Math.max(0, Math.min(3, p.slot|0)) : (s.medVirtSlot ?? 0),
            gx: (mode === 'go' || mode === 'tex' || mode === 'cseed' || mode === 'edge') ? Math.max(-24, Math.min(24, +p.gx || 0)) : (s.medVirtGx ?? 0),   // tex/cseed reuse gx/gy as integer cycle counts (kx,ky); edge as the slot pair (a,b)
            gy: (mode === 'go' || mode === 'tex' || mode === 'cseed' || mode === 'edge') ? Math.max(-24, Math.min(24, +p.gy || 0)) : (s.medVirtGy ?? 0),
            amp: (mode === 'tex' || mode === 'cseed') ? Math.max(0, Math.min(2, +p.amp || 0)) : (mode === 'aphase' || mode === 'recvia' || mode === 'viaphi') ? Math.max(-Math.PI, Math.min(Math.PI, +p.amp || 0)) : (mode === 'lenstau') ? Math.max(-0.5, Math.min(0.5, +p.amp || 0)) : (mode === 'refamp') ? Math.max(0, Math.min(3, (p && p.amp != null) ? +p.amp : 1)) : (s.medVirtAmp ?? 0),   // tex phase depth / cseed amp / aphase increment / recvia birth angle (±π) / refamp pin-amplitude multiplier (0–3)
            src: (mode === 'go') ? ((p && (p.src === 'P1' || p.src === 'P2')) ? p.src : 'V')
               : (mode === 'aphase' || mode === 'refamp' || mode === 'lensset') ? ((p && (p.src === 'V' || p.src === 'P1' || p.src === 'P2')) ? p.src : 'W')   // aphase/refamp/lensset: the SLOT, explicit (stamped-carrier principle — must not depend on the gaze)
               : (s.medVirtSrc ?? 'V'),   // go carries its CARRIER stamped (the injector's eye selection at press time) — resolving from the frame-local eyeSrc at the stamped step could bind different carriers on different peers (byte fork)
            ...(mode === 'lensset' ? {   // the extended readOp components (clamped; the drain infers the descriptor mode from content)
              kx: Math.max(-1, Math.min(1, +p.kx || 0)), ky: Math.max(-1, Math.min(1, +p.ky || 0)),   // phase tilt (rad/cell)
              rot: Math.max(-Math.PI, Math.min(Math.PI, +p.rot || 0)), scl: Math.max(0.25, Math.min(4, (p && p.scl != null) ? +p.scl : 1)),   // affine rotation + isotropic scale
              tx: Math.max(-24, Math.min(24, +p.tx || 0)), ty: Math.max(-24, Math.min(24, +p.ty || 0)) } : {}) };   // affine translation (cells)
          return { ...s, medVirtSeq: e.seq, medVirtTime: e.time, medVirtMode: e.mode, medVirtLeak: e.leak, medVirtSlot: e.slot, medVirtGx: e.gx, medVirtGy: e.gy, medVirtAmp: e.amp, medVirtSrc: e.src, medVirtLog: [...(Array.isArray(s.medVirtLog) ? s.medVirtLog : []), e].slice(-64) }; },   // last 64 verbs (was 16 — the "sometimes not work" cause: a setup burst ⎙virt+hold+mux+store+boot×2+attPhase+edge×6 ≈ 12 verbs; a peer/pull >16 seq behind found the older unseen verbs already SLICED OFF the log → silently dropped. 64 covers bursts + a sweep)   // leak = the W→V coupling κ · mirror = toggle V's drive · mux = toggle §7.44 clock-phase time-sharing

        // ⚡sig — TRANSIENT SIGNAL (radiation sector): stamp a marginal-packet launch {from → toward} with the synced
        // time; the soliton drives inject it into ψ at the shared step (mirrors shiftQueue). The packet flies at its
        // group velocity and dies — measured-honest radiation (no persistent mobile matter exists in this substrate).
        mediumSignal: (s, p) => { const cl = (v, d) => (typeof v === 'number') ? Math.max(2, Math.min(GRID - 3, v)) : d;
          return { ...s,
            medSigSeq: (s.medSigSeq|0) + 1,
            sigQueue: [...(s.sigQueue ?? []).slice(-(SIG_Q_MAX-1)), {
              seq: (s.medSigSeq|0) + 1, time: (s.time ?? 0),
              fx: cl(p.fx, GRID/2), fy: cl(p.fy, GRID/2), tx: cl(p.tx, GRID/2 + 30), ty: cl(p.ty, GRID/2),
              amp: Math.max(0.05, Math.min(1.0, (typeof p.amp === 'number') ? p.amp : 0.35)),
              ph: (typeof p.ph === 'number') ? Math.max(-1, Math.min(1, p.ph|0)) : -1 }] };   // clock-phase slot 0..1 (480 steps each, injection in the first 120 only): -1 = immediate; out-of-range would head-block the queue
        },
        // §7.88w SHARED autocatalytic-drive params — ALL determine the per-bar genome wander, so any differing across
        // peers forks the hash. One reducer; only the provided fields update (others kept). Clamped to safe ranges.
        setOpNlhoDrive: (s, p) => ({ ...s,
          opNlhoKick:  (typeof p.kick   === 'number') ? Math.max(0, Math.min(1, p.kick))      : s.opNlhoKick,
          opNlhoEvery: (typeof p.every  === 'number') ? Math.max(0, Math.min(64, p.every | 0)): s.opNlhoEvery,
          opNlhoSLvl:  (typeof p.sLevel === 'number') ? Math.max(0.005, Math.min(0.1, p.sLevel)) : s.opNlhoSLvl,
          opNlhoTBins: (typeof p.tBins  === 'number') ? Math.max(16, Math.min(512, p.tBins | 0)) : s.opNlhoTBins,
          opNlhoSpin:  (typeof p.spin   === 'number') ? Math.max(0, Math.min(1, p.spin))         : s.opNlhoSpin,   // §7.88y self-evolve θ-orbit rate
        }),
        setOpEvolve: (s, p) => {
          const on = p.value ?? !(s.opEvolveOn ?? false);
          const out = { ...s, opEvolveOn: on };
          if (on) {
            // §7.72 FROZEN CANONICAL LAW: snapshot the physics dials INTO THE MODEL at evolve start.
            // Views sample n at frame (wall) time, so a slider drag mid-run races the reflector — one
            // bar harvested under different laws forks the genome permanently. Freezing here is a
            // MODEL-side read of MODEL state: deterministic for every peer and carried to joiners by
            // the snapshot. Sliders keep moving the display; the harvest law changes only on restart.
            out.opEvoT = s.eyeTSteps; out.opEvoHMode = s.eyeHMode; out.opEvoHParam = s.eyeHParam;
            // §7.74: pin the start bar (+1 = first full bar after the toggle) — all peers and joiners
            // begin the harvest chain at the same virtual time instead of each view's own frame bar.
            out.opEvoStartBar = Number.isFinite(p.bar) ? (p.bar | 0) + 1 : -1;
          }
          if (!on) {           // toggle-off clears the genome + the join anchor → all views restore seeds
            for (let r = 0; r < 8; r++) { out['opEvoW_' + r] = ''; out['opEvoBar_' + r] = -1; }
            out.opEvoSeq = (s.opEvoSeq ?? 0) + 1;
            out.opEvoCkGen = 0; out.opEvoCkG0 = ''; out.opEvoCkG1 = ''; out.opEvoCkG2 = ''; out.opEvoCkG3 = '';
            out.opEvoCkNlhoRules = '';   // §7.88d clear the NLHO rule-set anchor too
            out.opEvoCkSeq = (s.opEvoCkSeq ?? 0) + 1;
          }
          return out;
        },
        // §7.70 JOIN ANCHOR for polar-local genomes (§7.69 evolution keeps the genome VIEW-side, so
        // joiners cannot get it from snapshots — existing peers anchor it here when the roster grows;
        // monotonic-gen guard = first wins; between joins the wire stays silent).
        opEvolveCheckpoint: (s, p) => {
          const g = p.gen | 0;
          if (!(g > (s.opEvoCkGen ?? 0))) return s;
          // §7.88d LIVE-NLHO join-anchor: a checkpoint may carry the NLHO RULE-SET genome (JSON params) instead of
          // W-bits — the genome is self-describing STATE, so a joiner adopts the current rule-sets (no history
          // replay) and grows the identical attractors. Tiny payload; only on roster-grow, wire-silent otherwise.
          if (typeof p.nlhoRules === 'string') {
            if (p.nlhoRules.length > 1200) return s;
            return { ...s, opEvoCkGen: g, opEvoCkNlhoRules: p.nlhoRules,
                     opEvoCkBar: Number.isFinite(p.bar) ? p.bar | 0 : -1,
                     opEvoCkSeq: (s.opEvoCkSeq ?? 0) + 1 };
          }
          const ok = (h) => typeof h === 'string' && h.length <= 80;
          if (!ok(p.g0) || !ok(p.g1) || !ok(p.g2) || !ok(p.g3)) return s;
          return { ...s, opEvoCkGen: g, opEvoCkG0: p.g0, opEvoCkG1: p.g1, opEvoCkG2: p.g2, opEvoCkG3: p.g3,
                   opEvoCkBar: Number.isFinite(p.bar) ? p.bar | 0 : -1,   // §7.70d: the genome's virtual-time cursor
                   opEvoCkLog: (typeof p.log === 'string' && p.log.length <= 24) ? p.log : '',   // §7.73 decision log
                   opEvoCkSeq: (s.opEvoCkSeq ?? 0) + 1 };
        },
        opEvolveWrite: (s, p) => {
          const r = p.rule | 0, bar = p.bar | 0;
          if (!(s.opEvolveOn ?? false)) return s;                            // ignore strays after toggle-off
          if (r < 0 || r > 7 || typeof p.bits !== 'string' || p.bits.length > 80) return s;   // sanity
          if ((s['opEvoBar_' + r] ?? -1) >= bar) return s;   // FIRST write per (rule, bar) wins (reflector order)
          return { ...s, ['opEvoBar_' + r]: bar, ['opEvoW_' + r]: p.bits, opEvoSeq: (s.opEvoSeq ?? 0) + 1 };
        },

      });
    }
  );

  const _isStable = W.stable([mediumU1], reflector);
  const _export   = W.export(Renkon, { mediumU1 }, _isStable);
`;

export {
  hologramWorldProgram,
  REFLECTOR_MS, SUBTICK_MS,
  GRID, N_CELLS, DT, REF_AMP, REF_KX, SRC_ALPHA, PLATE_DECAY, K_WAVE,
  T_RECORD, RENDER_SCALE, FRAC_ALPHA, MAX_IFS_BANDS, N_DEPTH_TIERS, TOMO_MODE,
  IFS_DEPTH, IFS_GEN_CAP, IFS_MIN_DELAY, IFS_BASE_DELAY, FRESNEL_DONE_DELAY,
  NEXT_STEP_DELAY, RECON_STEP_DELAY, RECON_HOLD_MS,
  DELAY_SCALE, WAVELENGTH,
  CAM_Z, PROJ_SCALE, INIT_ANGLE_Y, INIT_ANGLE_X, PTS_PER_EDGE,
  CUBE_PTS, PYRAMID_PTS, COMBINED_PTS,
  CUBE_VERTS, CUBE_EDGES, PYRAMID_VERTS, PYRAMID_EDGES,
  HOUSE_PYRAMID_VERTS, HOUSE_PYRAMID_EDGES,
};
