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
const GRID    = 64;
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
      cachedRadiiVersion: 0,
      plateResetSeq: 0,
      plateSnapSeq: 0,
      reconSeq: 0,
      ifsNBands: 0, ifsSEff: 0, ifsRadiiStr: '',
      eyeHMode: 0, eyeHParam: 0.5, eyeHBlock: 8, eyeTSteps: 10,
      eyeMix: 0, eyeOnly: false,
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (['rotate','toggleMode','resetPlate','snapPlate','nextCycle','addPoint','addBeam','setDepthProbe','dragStart','dragEnd','toggleTomo','setShape',
             'setBreath','setPlateDriven','setNoHebb','setNullPlate','setPlateKernel','setDemodKick','setPlateSeedFree','setReconReset','setKickParams','setBackPlate','setHamiltonian','setRecordMode','setLiveMode','setGsPropagator','setGsNoiseSeed','setDirectBack','pointTest',
             'setEyeH','setEyeT','setEyeMix','setEyeOnly'].includes(t))
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} }, ...(s._queue ?? [])] };
      }
      return W.reduce(s, pulse, 'hologram4', {

        __macro: (s, p, ctx) => {
          if (p.isSubTick) return s;
          if (p.logicalTime !== 1) return s;
          ctx.future(100, '_keepalive', {});
          let s2 = _launchSlot({ ...s, time: 0 }, ctx, 'A', p.logicalTime);
          ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2), '_launchB', { cycleId: p.logicalTime + 1 });
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
          // Stagger opposite slot
          const nextSlot    = slot === 'A' ? 'B' : 'A';
          const nextCycleId = p.cycleId + 2;
          if (!s['slotActive_' + nextSlot]) {
            ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2),
              '_launch' + nextSlot, { cycleId: nextCycleId });
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
            ifsNBands: fRadii.length, ifsRadiiStr: newRadiiStr, ifsSEff: sEff,
            cycleCount: (s.cycleCount ?? 0) + 1,
          };
        },

        rotate: (s, p, ctx) => {
          if ((s.direction ?? 1) < 0) {
            return { ...s, reconAngleY: p.angleY ?? s.reconAngleY, reconAngleX: p.angleX ?? s.reconAngleX };
          }
          return { ...s, angleY: p.angleY ?? s.angleY, angleX: p.angleX ?? s.angleX };
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
        setGsPropagator: (s, p) => ({ ...s, gsPropagator: p.mode ?? 'ifs' }),
        setGsNoiseSeed:  (s, p) => ({ ...s, gsNoiseSeed:   p.value ?? !(s.gsNoiseSeed   ?? false) }),
        setDirectBack:   (s, p) => ({ ...s, directBackMode: p.value ?? !(s.directBackMode ?? false) }),
        setKickParams:   (s, p) => ({ ...s,
          plateKernelGamma: p.gamma   ?? s.plateKernelGamma,
          plateKernelDT:    p.dt      ?? s.plateKernelDT,
          plateKernelSteps: p.steps   ?? s.plateKernelSteps,
          gsSteps:          p.gsSteps ?? s.gsSteps,
        }),

      });
    }
  );

  const _isStable = W.stable([hologram4], reflector);
  const _export   = W.export(Renkon, { hologram4 }, _isStable);
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
