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
import { IFSGpu } from '../ifs-gpu.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
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
const PTS_PER_EDGE = 50;
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
  const PYRAMID_PTS      = ${PYRAMID_PTS_JSON};
  const COMBINED_PTS     = ${COMBINED_PTS_JSON};
  const SHAPE_PTS        = { cube: CUBE_PTS, pyramid: PYRAMID_PTS, combined: COMBINED_PTS };
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
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (['rotate','toggleMode','resetPlate','snapPlate','nextCycle','addPoint','addBeam','setDepthProbe','dragStart','dragEnd','toggleTomo','setShape',
             'setBreath','setPlateDriven','setNoHebb','setNullPlate','setPlateKernel','setDemodKick','setPlateSeedFree','setReconReset','setKickParams','setBackPlate'].includes(t))
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
        setReconReset:   (s, p) => ({ ...s, plateKernelMode: false, demodKickMode: false, plateSeedFree: false, backPlateMode: false, reconResetSeq: (s.reconResetSeq ?? 0) + 1 }),
        setBackPlate:    (s, p) => ({ ...s, backPlateMode: p.value ?? !(s.backPlateMode ?? false), plateKernelMode: false, demodKickMode: false }),
        setKickParams:   (s, p) => ({ ...s,
          plateKernelGamma: p.gamma ?? s.plateKernelGamma,
          plateKernelDT:    p.dt    ?? s.plateKernelDT,
          plateKernelSteps: p.steps ?? s.plateKernelSteps,
        }),

      });
    }
  );

  const _isStable = W.stable([hologram4], reflector);
  const _export   = W.export(Renkon, { hologram4 }, _isStable);
`;

// ── Renderer-local physics (mirror of world program, no network) ─────────────
// Build callable versions of the IFS physics functions for use in the renderer.
// These are the same algorithms the model uses, evaluated with the same constants.
const _rendererPhysics = (() => {
  const TWO_PI   = 2 * Math.PI;
  const NCELLS   = N_CELLS;
  const SHAPE_PTS = { cube: CUBE_PTS, pyramid: PYRAMID_PTS, combined: COMBINED_PTS };

  // ── _buildRingOffsets and _linearStepIFS ────────────────────────────────
  const _buildRingOffsets = (fRadii) => fRadii.map(r => {
    const nSteps = Math.max(8, Math.ceil(2 * Math.PI * r));
    const flat = new Int16Array(nSteps * 2);
    for (let k = 0; k < nSteps; k++) {
      flat[k*2]   = Math.round(r * Math.cos(k * TWO_PI / nSteps));
      flat[k*2+1] = Math.round(r * Math.sin(k * TWO_PI / nSteps));
    }
    return flat;
  });

  const _linearStepIFS = (psi, dt, fRadii, fWeights, fOffs) => {
    const out  = new Float64Array(psi);
    const h    = dt * 0.25;
    const G    = GRID;
    const nF   = fRadii.length;
    const offs = fOffs ?? _buildRingOffsets(fRadii);
    const ringN    = new Int32Array(nF);
    const ringNorm = new Float64Array(nF);
    for (let d = 0; d < nF; d++) {
      ringN[d]    = offs[d].length >> 1;
      ringNorm[d] = fWeights[d] * 4 / ringN[d];
    }
    // Step 1: Re -= (dt/4)·∇²Im
    for (let y = 0; y < G; y++) {
      const ym = ((y - 1 + G) % G) * G;
      const yp = ((y + 1)     % G) * G;
      for (let x = 0; x < G; x++) {
        const id = y*G + x;
        const xm = (x - 1 + G) % G;
        const xp = (x + 1)     % G;
        let lap = out[(y*G+xp)*2+1] + out[(y*G+xm)*2+1]
                + out[(yp+x)*2+1]   + out[(ym+x)*2+1]
                - 4*out[id*2+1];
        for (let d = 0; d < nF; d++) {
          const flat = offs[d]; const n = ringN[d]; const sc = ringNorm[d];
          const cbase = out[id*2+1];
          let acc = 0;
          for (let i = 0; i < n; i++) {
            const nx = ((x + flat[i*2]   % G) + G) % G;
            const ny = ((y + flat[i*2+1] % G) + G) % G;
            acc += out[(ny*G + nx)*2 + 1];
          }
          lap += sc * (acc - n * cbase);
        }
        out[id*2] -= h * lap;
      }
    }
    // Step 2: Im += (dt/2)·∇²Re
    for (let y = 0; y < G; y++) {
      const ym = ((y - 1 + G) % G) * G;
      const yp = ((y + 1)     % G) * G;
      for (let x = 0; x < G; x++) {
        const id = y*G + x;
        const xm = (x - 1 + G) % G;
        const xp = (x + 1)     % G;
        let lap = out[(y*G+xp)*2] + out[(y*G+xm)*2]
                + out[(yp+x)*2]   + out[(ym+x)*2]
                - 4*out[id*2];
        for (let d = 0; d < nF; d++) {
          const flat = offs[d]; const n = ringN[d]; const sc = ringNorm[d];
          const cbase = out[id*2];
          let acc = 0;
          for (let i = 0; i < n; i++) {
            const nx = ((x + flat[i*2]   % G) + G) % G;
            const ny = ((y + flat[i*2+1] % G) + G) % G;
            acc += out[(ny*G + nx)*2];
          }
          lap += sc * (acc - n * cbase);
        }
        out[id*2+1] += (dt * 0.5) * lap;
      }
    }
    // Step 3: Re -= (dt/4)·∇²Im  (mirror of step 1)
    for (let y = 0; y < G; y++) {
      const ym = ((y - 1 + G) % G) * G;
      const yp = ((y + 1)     % G) * G;
      for (let x = 0; x < G; x++) {
        const id = y*G + x;
        const xm = (x - 1 + G) % G;
        const xp = (x + 1)     % G;
        let lap = out[(y*G+xp)*2+1] + out[(y*G+xm)*2+1]
                + out[(yp+x)*2+1]   + out[(ym+x)*2+1]
                - 4*out[id*2+1];
        for (let d = 0; d < nF; d++) {
          const flat = offs[d]; const n = ringN[d]; const sc = ringNorm[d];
          const cbase = out[id*2+1];
          let acc = 0;
          for (let i = 0; i < n; i++) {
            const nx = ((x + flat[i*2]   % G) + G) % G;
            const ny = ((y + flat[i*2+1] % G) + G) % G;
            acc += out[(ny*G + nx)*2 + 1];
          }
          lap += sc * (acc - n * cbase);
        }
        out[id*2] -= h * lap;
      }
    }
    return out;
  };

  // ── Project cube sources ─────────────────────────────────────────────────
  const _projectSources = (angleY, angleX, shape = 'cube') => {
    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const halfG = (GRID - 1) / 2;
    const fscale = halfG * PROJ_SCALE;
    const reconZ = Math.round(GRID / 16);
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

  // ── Point-pixel source field — used for objField (RECORD display + RECON attractor) ──
  const _buildSrcFieldIFS = (angleY, angleX, extraPoints, shape = 'cube') => {
    const sources = _projectSources(angleY, angleX, shape);
    const field   = new Float64Array(2 * NCELLS);
    let szMin = Infinity, szMax = -Infinity;
    for (const { sz } of sources) { if (sz < szMin) szMin = sz; if (sz > szMax) szMax = sz; }
    const szRange = Math.max(1e-4, szMax - szMin);
    for (let k = 0; k < sources.length; k++) {
      const { sx, sy, sz, amp } = sources[k];
      const ix = Math.round(sx) | 0, iy = Math.round(sy) | 0;
      if (ix < 0 || ix >= GRID || iy < 0 || iy >= GRID) continue;
      const j  = iy * GRID + ix;
      const t  = Math.max(0, Math.min(1, (sz - szMin) / szRange));
      const ph = t * Math.PI * 4;
      field[j*2]   += amp * Math.cos(ph);
      field[j*2+1] += amp * Math.sin(ph);
    }
    for (const pt of (extraPoints ?? [])) {
      const j = pt.gy * GRID + pt.gx;
      field[j*2]   += pt.amp * Math.cos(pt.ph);
      field[j*2+1] += pt.amp * Math.sin(pt.ph);
    }
    return field;
  };

  // ── Volumetric source field — used for plate recording only ──────────────────
  // Each cube point emits a spherical wave across the grid, encoding all viewing
  // angles and depth in a single exposure (true Gabor hologram geometry).
  const VOL_DEPTH_SCALE = 8; // multiply per-point sz to increase fringe curvature
  const _buildVolSrcField = (angleY, angleX, extraPoints, shape = 'cube') => {
    const sources = _projectSources(angleY, angleX, shape);
    const field   = new Float64Array(2 * NCELLS);
    for (let k = 0; k < sources.length; k++) {
      const { sx, sy, sz, amp } = sources[k];
      const szScaled = sz * VOL_DEPTH_SCALE;
      for (let j = 0; j < NCELLS; j++) {
        const cx = j % GRID, cy = (j / GRID) | 0;
        const dx = cx - sx, dy = cy - sy;
        const r  = Math.sqrt(dx*dx + dy*dy + szScaled*szScaled);
        const ph = K_WAVE * r;
        const a  = amp / (r + 1);
        field[j*2]   += a * Math.cos(ph);
        field[j*2+1] += a * Math.sin(ph);
      }
    }
    for (const pt of (extraPoints ?? [])) {
      const j = pt.gy * GRID + pt.gx;
      field[j*2]   += pt.amp * Math.cos(pt.ph);
      field[j*2+1] += pt.amp * Math.sin(pt.ph);
    }
    return field;
  };

  // ── Reconstruction seed from plate ───────────────────────────────────────
  // Multiply DC-suppressed plate by conjugate of actual reference field.
  // refField: the real propagated reference (T_RECORD IFS steps from _initRefPsi).
  // Without refField falls back to plane-wave demodulation.
  const _buildReconField = (plate, dKX = 0, rotAngle = 0, refField = null, dKY = 0, shiftX = 0, shiftY = 0, scale = 1) => {
    // DC suppression
    let sumP = 0;
    for (let j = 0; j < NCELLS; j++) sumP += plate[j];
    const meanP = sumP / NCELLS;
    let maxAbs = 1e-9;
    for (let j = 0; j < NCELLS; j++) {
      const v = Math.abs(plate[j] - meanP);
      if (v > maxAbs) maxAbs = v;
    }
    const cosR = Math.cos(rotAngle), sinR = Math.sin(rotAngle);
    const halfG = (GRID - 1) / 2;
    const psi = new Float64Array(2 * NCELLS);
    for (let j = 0; j < NCELLS; j++) {
      const cx = j % GRID, cy = (j / GRID) | 0;
      const dx = cx - halfG, dy = cy - halfG;
      // rotate then scale then shift
      const rx = (dx * cosR - dy * sinR) / scale + halfG + shiftX;
      const ry = (dx * sinR + dy * cosR) / scale + halfG + shiftY;
      const x0 = Math.floor(rx), y0 = Math.floor(ry);
      const tx = rx - x0, ty = ry - y0;
      const inB = (x, y) => x >= 0 && x < GRID && y >= 0 && y < GRID;
      const sp = (x, y) => inB(x, y) ? Math.max(-maxAbs, Math.min(maxAbs, plate[y * GRID + x] - meanP)) / maxAbs : 0;
      const y1 = y0 + 1;
      const mod = (1-tx)*(1-ty)*sp(x0,y0) + tx*(1-ty)*sp(x0+1,y0)
                + (1-tx)*ty*sp(x0,y1)      + tx*ty*sp(x0+1,y1);
      let rr, ri;
      if (refField) {
        rr =  refField[j*2];
        ri = -refField[j*2+1];
      } else {
        const ph = (REF_KX + dKX) * cx + dKY * cy;
        rr =  Math.cos(ph);
        ri = -Math.sin(ph);
      }
      const wx = 0.5 * (1 - Math.cos(2 * Math.PI * cx / (GRID - 1)));
      const wy = 0.5 * (1 - Math.cos(2 * Math.PI * cy / (GRID - 1)));
      psi[j*2]   = mod * rr * wx * wy;
      psi[j*2+1] = mod * ri * wx * wy;
    }
    return psi;
  };

  // ── Reference wave initial condition ─────────────────────────────────────
  const _initRefPsi = () => {
    // Plane wave REF_AMP·exp(i·REF_KX·x) — off-axis carrier enables plate demodulation
    const psi = new Float64Array(2 * NCELLS);
    for (let j = 0; j < NCELLS; j++) {
      const x = j % GRID;
      psi[j*2]   = REF_AMP * Math.cos(REF_KX * x);
      psi[j*2+1] = REF_AMP * Math.sin(REF_KX * x);
    }
    return psi;
  };

  return { _linearStepIFS, _buildRingOffsets, _buildSrcFieldIFS, _buildVolSrcField, _buildReconField, _initRefPsi };
})();

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeHologram4Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;
  const { _linearStepIFS, _buildSrcFieldIFS, _buildVolSrcField, _buildReconField, _initRefPsi } = _rendererPhysics;

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

  const _WIRE_SHAPES = {
    cube:     { verts: CUBE_VERTS,    edges: CUBE_EDGES },
    pyramid:  { verts: PYRAMID_VERTS, edges: PYRAMID_EDGES },
    combined: { verts: [...CUBE_VERTS, ...HOUSE_PYRAMID_VERTS],
                edges: [...CUBE_EDGES, ...HOUSE_PYRAMID_EDGES.map(([a,b]) => [a + CUBE_VERTS.length, b + CUBE_VERTS.length])] },
  };
  const _drawCube = (ctx2d, angleY, angleX, glow, shape = 'cube') => {
    const CW = ctx2d.canvas.width, CH = ctx2d.canvas.height;
    ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, CW, CH);
    if (glow > 0.02) {
      const gr = ctx2d.createRadialGradient(CW/2,CH/2,CW*0.05, CW/2,CH/2,CW*0.6);
      gr.addColorStop(0, `rgba(60,180,255,${0.12*glow})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx2d.fillStyle = gr; ctx2d.fillRect(0, 0, CW, CH);
    }
    const { verts, edges } = _WIRE_SHAPES[shape] ?? _WIRE_SHAPES.cube;
    const pts = verts.map(([ox,oy,oz]) => _project(ox,oy,oz,angleY,angleX,CW,CH));
    for (let pass = 0; pass < 2; pass++) {
      for (const [ai, bi] of edges) {
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
    Object.assign(main.style, { display: 'flex', flex: '1', flexDirection: 'row', minHeight: '0', overflow: 'hidden' });
    root.appendChild(main);

    // ── Control bar (below canvases, horizontal) ──────────────────────────────
    const controlBar = document.createElement('div');
    Object.assign(controlBar.style, {
      display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
      alignItems: 'center', gap: '4px', padding: '6px 8px',
      background: '#0a0a0a', borderTop: '1px solid #222',
      flexShrink: '0', boxSizing: 'border-box',
    });
    root.appendChild(controlBar);

    // ── Canvas column (four side-by-side) ─────────────────────────────────────
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

    // ── Local GPU physics (Deterministic Viewport) ───────────────────────────
    // All physics (psi evolution, plate accumulation) is local to this renderer.
    // Shared state only carries lightweight params: angles, kernels, direction, time.
    // GPU is a one-way mirror: data flows JS→GPU, never GPU→shared state.
    let _gpu = null;
    let _gpuReady = false;
    let _gpuKernelVersion = -1;
    // Snapshot of kernel at RECON start — backward steps must use the same
    // kernel that was used during recording, not the live evolving IFS kernel.
    let _snapReconRadii   = null;
    let _snapReconWeights = null;
    let _snapReconOffsets = null;

    // Local physics state — never sent to network
    let _localKernelVersion    = -1;  // tracks when to rebuild obj field
    let _localRefKernelVersion = -1;  // tracks when to rebuild ref field
    let _localPsi        = null;   // display wavefield (1 JS step/frame)
    let _localObjField   = null;   // object field (t=0 seed, rebuilt on angle/kernel change)
    let _localRefField   = null;   // reference field (T_RECORD forward IFS from y=0 line)
    let _localPlate      = null;   // accumulated hologram plate (Float32Array, N_CELLS)
    let _plateSeq        = 0;      // incremented when plate is frozen for RECON; guards stale async callbacks
    let _localAngleYSeen = null;
    let _localShapeSeen  = null;
    let _localAngleXSeen = null;
    let _localExtraSeen  = null;
    let _localPlateResetSeq = -1;
    let _localReconSeq      = -1;
    let _localReconStep     = 0;
    let _localReconHolding  = false;  // true during RECON_HOLD_MS pause
    let _localReconHoldUntil = 0;     // performance.now() timestamp to resume
    let _lastReconStepMs    = 0;      // timestamp of last backward step
    let _localReconSoliton  = false;  // true after focus found — continuous soliton mode
    let _reconSolitonField  = null;   // focused field used as soliton attractor
    let _reconDKX           = 0;      // current parallax k-offset X
    let _reconDKY           = 0;      // current parallax k-offset Y
    let _reconDKXSeen       = 0;      // phase accumulator (auto-rot) or last applied dKX (drag)
    let _reconDKXCurrent    = 0;      // actual current carrier shift applied to objField
    let _reconDKYSeen       = 0;      // last applied parallax Y
    let _reconLensFSeen     = -1;     // last applied lens focal length
    let _autoRotate         = false;
    const AUTO_ROT_SPEED    = 0.003;
    const AUTO_ROT_AMP      = 0.3;
    let _plateSeedFree      = false;
    let _plateKernelMode    = false;  // phase kick from raw plate fringes
    let _demodKickMode      = false;  // phase kick from demodulated object wavefront phase
    let _plateKernelGamma   = SRC_ALPHA;  // phase kick strength — matches SRC_ALPHA
    let _plateKernelDT      = DT;     // leapfrog timestep for plate kernel mode
    let _plateKernelSteps   = 16;     // steps per frame for plate kernel mode
    // Traversal parameters — each can be swept independently
    let _travPhase          = 0;      // shared phase accumulator for auto sweeps
    let _travDKX            = 0;      // carrier X shift
    let _travDKY            = 0;      // carrier Y shift
    let _travRot            = 0;      // plate rotation angle
    let _travShiftX         = 0;      // plate lateral shift X (grid units)
    let _travShiftY         = 0;      // plate lateral shift Y (grid units)
    let _travScale          = 1;      // plate zoom scale
    let _autoTravMode       = 'rot';  // which parameter auto-sweep drives: 'rot'|'dkx'|'dky'|'shift'|'scale'
    const TRAV_SPEED        = 0.008;  // phase increment per frame
    let _reconSnapBaseAngleY = 0;    // snap angle at RECON entry — parallax computed relative to this
    let _reconSnapBaseAngleX = 0;
    const PARALLAX_SCALE    = 0.06;  // radians→dK conversion; tune for visible but not destructive parallax
    let _breathVis          = true;   // show breathing (live stepRecord); false = freeze display psi
    let _localDirection     = 1;
    let _localStepCount     = 0;
    let _psiReadPending     = false;
    let _localRefReady      = false;  // true once GPU ref has been read back to JS for cplx plate
    let _cplxPlateObjReady  = false;  // true once cplx plate objField has been set as RECON attractor
    let _cplxPlateUploaded  = false;  // true after uploadCplxPlate with non-zero content
    let _cplxPlateField     = null;   // JS copy of ψ_sweep·conj(ψ_ref)
    let _sweepSnapPsi       = null;   // ψ_sweep_final at snap time — pure IFS eigenstate of object

    // ── Plate sweep state ──────────────────────────────────────────────────────
    // Manual snap: seed sweep ping-pong from objField when plateSnapSeq changes,
    // run T_RECORD steps spread across frames, accumulate via accumulatePlateSweep.
    // Multi-angle: N_SNAP_ANGLES exposures per snap at stepped angleY for parallax.
    const GPU_STEPS_PER_FRAME = 4;
    const N_SNAP_ANGLES   = 1;
    const SNAP_ANGLE_STEP = 0.08;   // radians between exposures
    let _localPlateSnapSeq  = 0;
    let _hebbianWeights     = null; // Hebbian ring weights computed from RECORD soliton at snap
    let _snapPsi            = null; // RECORD soliton psi captured at snap time — RECON seed
    let _plateDrivenMode    = true;  // true = plate attractor + noise seed (default); false = geometry + snapPsi seed
    let _nullPlateTest      = false; // proof test: zero plate → object must disappear if plate-driven
    let _noHebbTest         = false; // optional: add Hebbian weights on top of baseline kernel
    let _backPlateMode      = false; // option 4: backward sweep + plate phase kick → read back as objField
    let _plateDemodMode     = false; // test mode: demodulated plate as objField injector
    let _plateDemodField    = null;  // IFS-projected demodulated field — ready as eigenstate attractor
    let _plateDemodPending  = false; // true while IFS projection readback is in flight
    let _snapAngleQueue = [];       // [{angleY, angleX}] remaining exposures for current snap
    let _recordedPlates = [];       // [{angleY, angleX, plate}] one plate per recorded angle
    let _sweepPsi      = null;
    let _sweepStep     = T_RECORD; // T_RECORD = idle
    let _sweepAngleY   = null;
    let _sweepAngleX   = null;
    let _sweepExtraKey = null;
    let _sweepSnapRadii   = null;  // kernel frozen at sweep start — must match plate
    let _sweepSnapWeights = null;
    let _sweepSnapOffsets = null;
    let _lastKeepaliveMs = 0;
    let _localReconResetSeen = 0;

    let _gpuCanvas = null;
    if (IFSGpu.isSupported()) {
      _gpuCanvas = document.createElement('canvas');
      _gpuCanvas.width  = GRID;
      _gpuCanvas.height = GRID;
      IFSGpu.create(_gpuCanvas, GRID).then(g => {
        _gpu = g;
        _gpuReady = true;
        console.log('[hologram4] GPU ready, grid=' + GRID);
      }).catch(err => {
        console.error('[hologram4] IFSGpu init FAILED:', err);
      });
    }

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
    let _smoothMaxRecord = 0;  // separate normalization for RECORD canvas — insulated from RECON sweep


    // ── Clock column (slim: title + IFS clock + wireframe only) ──────────────
    const clockCol = document.createElement('div');
    Object.assign(clockCol.style, {
      flexShrink: '0', width: '110px', display: 'flex', flexDirection: 'column',
      padding: '8px 6px', boxSizing: 'border-box', gap: '4px', overflow: 'hidden',
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
        padding: '4px 7px', fontSize: '8px', cursor: 'pointer', whiteSpace: 'nowrap',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold',
        touchAction: 'manipulation', flexShrink: '0',
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
    const btnSnap   = mkBtn('◉ SNAP PLATE',   '#fa4', '#000', () => injectEvent?.({ type: 'snapPlate' }));
    const btnReset  = mkBtn('↺ RESET PLATE',  '#333', '#aaa', () => injectEvent?.({ type: 'resetPlate' }));
    const _shapeRow = document.createElement('div');
    Object.assign(_shapeRow.style, { display: 'flex', gap: '2px', flexShrink: '0' });
    const _mkShapeBtn = (label, shape, bg) => {
      const b = mkBtn(label, bg, '#fff', () => injectEvent?.({ type: 'setShape', shape }));
      Object.assign(b.style, { fontSize: '8px', padding: '4px 5px' });
      return b;
    };
    const btnShapeCube     = _mkShapeBtn('■ CUBE',     'cube',     '#4af');
    const btnShapePyramid  = _mkShapeBtn('▲ PYRAMID',  'pyramid',  '#48f');
    const btnShapeCombined = _mkShapeBtn('⬡ BOTH',    'combined',  '#86f');
    _shapeRow.appendChild(btnShapeCube);
    _shapeRow.appendChild(btnShapePyramid);
    _shapeRow.appendChild(btnShapeCombined);
    const btnTomo   = mkBtn('⊕ TOMO',  '#555', '#aaa', () => injectEvent?.({ type: 'toggleTomo' }));
    const btnBreath = mkBtn('~ BREATH  on', '#226', '#8af', () => injectEvent?.({ type: 'setBreath' }));
    const btnHebb = mkBtn('⊛ PLATE on', '#633', '#faa', () => {
      if (_plateDemodMode) _plateDemodMode = false;
      injectEvent?.({ type: 'setPlateDriven' });
    });
    const btnNoHebb = mkBtn('⊛ +HEBB', '#555', '#aaa', () => {
      injectEvent?.({ type: 'setNoHebb' });
    });
    const btnNullPlate = mkBtn('∅ NULL PLATE', '#555', '#aaa', () => {
      injectEvent?.({ type: 'setNullPlate' });
    });
    const _travBtns = {};
    const _setTravMode = (mode) => {
      _autoRotate   = true;
      _autoTravMode = mode;
      _travPhase    = 0;
      _localReconSoliton = false;
      for (const [k, b] of Object.entries(_travBtns)) {
        b.style.background = k === mode ? '#363' : '#555';
        b.style.color      = k === mode ? '#afa' : '#aaa';
      }
    };
    const _makeTravBtn = (label, mode) => {
      const b = mkBtn(label, '#555', '#aaa', () => {
        if (_autoRotate && _autoTravMode === mode) {
          _autoRotate = false;
          b.style.background = '#555'; b.style.color = '#aaa';
        } else {
          _setTravMode(mode);
        }
      });
      _travBtns[mode] = b;
      return b;
    };
    // traversal buttons removed — don't affect soliton fixed point
    const btnPlateKernel = mkBtn('⬡ PLATE KERN', '#555', '#aaa', () => injectEvent?.({ type: 'setPlateKernel' }));
    const btnDemodKick   = mkBtn('⬡ DEMOD KICK', '#555', '#aaa', () => injectEvent?.({ type: 'setDemodKick' }));

    // Gamma slider for plate kernel phase kick strength
    const gammaWrap = document.createElement('div');
    Object.assign(gammaWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const gammaLbl = document.createElement('span');
    gammaLbl.style.cssText = 'color:#aaa;font-size:8px;white-space:nowrap';
    gammaLbl.textContent = `γ ${_plateKernelGamma.toFixed(2)}`;
    const gammaSlider = document.createElement('input');
    gammaSlider.type = 'range'; gammaSlider.min = '0'; gammaSlider.max = '1';
    gammaSlider.step = '0.01'; gammaSlider.value = String(_plateKernelGamma);
    Object.assign(gammaSlider.style, { width:'60px', cursor:'pointer' });
    gammaSlider.addEventListener('input', () => {
      injectEvent?.({ type: 'setKickParams', gamma: parseFloat(gammaSlider.value) });
    });
    gammaWrap.appendChild(gammaLbl);
    gammaWrap.appendChild(gammaSlider);

    const mkSlider = (labelStr, min, max, step, val, onInput) => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
      const lbl = document.createElement('span');
      lbl.style.cssText = 'color:#aaa;font-size:8px;white-space:nowrap';
      lbl.textContent = labelStr;
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = String(min); sl.max = String(max);
      sl.step = String(step); sl.value = String(val);
      Object.assign(sl.style, { width:'60px', cursor:'pointer' });
      sl.addEventListener('input', () => onInput(sl, lbl));
      wrap.appendChild(lbl); wrap.appendChild(sl);
      return wrap;
    };

    const dtWrap = mkSlider(`dt ${_plateKernelDT.toFixed(2)}`, 0.01, 0.5, 0.01, _plateKernelDT, (sl, lbl) => {
      injectEvent?.({ type: 'setKickParams', dt: parseFloat(sl.value) });
    });
    const stepsWrap = mkSlider(`N ${_plateKernelSteps}`, 1, 64, 1, _plateKernelSteps, (sl, lbl) => {
      injectEvent?.({ type: 'setKickParams', steps: parseInt(sl.value) });
    });

    const btnPlateSeed  = mkBtn('⬡ FREE IFS',     '#555', '#aaa', () => injectEvent?.({ type: 'setPlateSeedFree' }));
    const btnReconReset  = mkBtn('↺ RECON RESET',  '#333', '#fa8', () => injectEvent?.({ type: 'setReconReset' }));
    const btnBackPlate   = mkBtn('↩ BACK+PLATE',   '#345', '#8cf', () => injectEvent?.({ type: 'setBackPlate' }));
    const btnPlateDemod = mkBtn('◈ PLATE DEMOD', '#446', '#aaf', () => {
      _plateDemodMode = !_plateDemodMode;
      btnPlateDemod.textContent      = _plateDemodMode ? '◈ PLATE DEMOD on' : '◈ PLATE DEMOD';
      btnPlateDemod.style.background = _plateDemodMode ? '#66a' : '#446';
      if (_plateDemodMode) injectEvent?.({ type: 'setPlateDriven', value: false });
      _localReconSoliton = false;
    });
    // ── Separator helper for control bar ──────────────────────────────────────
    const mkSep = () => {
      const s = document.createElement('div');
      Object.assign(s.style, { width: '1px', height: '18px', background: '#333', flexShrink: '0', alignSelf: 'center' });
      return s;
    };

    controlBar.appendChild(btnRecord);
    controlBar.appendChild(btnRecon);
    controlBar.appendChild(btnSnap);
    controlBar.appendChild(btnReset);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(_shapeRow);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(btnTomo);
    controlBar.appendChild(btnBreath);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(btnHebb);
    controlBar.appendChild(btnNoHebb);
    controlBar.appendChild(btnNullPlate);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(btnPlateKernel);
    controlBar.appendChild(btnDemodKick);
    controlBar.appendChild(gammaWrap);
    controlBar.appendChild(dtWrap);
    controlBar.appendChild(stepsWrap);
    controlBar.appendChild(btnPlateSeed);
    controlBar.appendChild(btnReconReset);
    controlBar.appendChild(btnBackPlate);
    controlBar.appendChild(btnPlateDemod);

    const modeLbl = document.createElement('div');
    modeLbl.id = containerId + '-mode';
    Object.assign(modeLbl.style, {
      fontSize: '8px', fontWeight: 'bold', color: '#9c4', whiteSpace: 'nowrap', flexShrink: '0',
    });
    controlBar.appendChild(modeLbl);

    // ── Depth probe slider ────────────────────────────────────────────────────
    const probeWrap = document.createElement('div');
    Object.assign(probeWrap.style, { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '3px', flexShrink: '0' });
    const probeLbl = document.createElement('div');
    Object.assign(probeLbl.style, { fontSize: '7px', color: '#555', whiteSpace: 'nowrap' });
    probeLbl.textContent = 'DEPTH  off';
    const probeSlider = document.createElement('input');
    probeSlider.type = 'range'; probeSlider.min = '0'; probeSlider.max = '100'; probeSlider.value = '0';
    probeSlider.disabled = true;
    Object.assign(probeSlider.style, { width: '70px', accentColor: '#f84', cursor: 'pointer', opacity: '0.3' });
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

    // ── Lens focal length slider ───────────────────────────────────────────────
    const lensWrap  = document.createElement('div');
    lensWrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';
    const lensLbl   = document.createElement('span');
    lensLbl.style.cssText = 'color:#8cf;font-size:8px;white-space:nowrap;';
    lensLbl.textContent = 'LENS f=50';
    const lensSlider = document.createElement('input');
    lensSlider.type = 'range'; lensSlider.min = 5; lensSlider.max = 300;
    lensSlider.value = 50; lensSlider.style.width = '80px';
    lensSlider.addEventListener('input', () => {
      const f = parseInt(lensSlider.value);
      lensLbl.textContent = `LENS f=${f}`;
      injectEvent?.({ type: 'setLensF', f });
    });
    lensWrap.appendChild(lensLbl);
    lensWrap.appendChild(lensSlider);

    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, { fontSize: '7px', color: '#444', lineHeight: '1.4', overflow: 'hidden', flexShrink: '0' });

    controlBar.appendChild(mkSep());
    controlBar.appendChild(probeWrap);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(lensWrap);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(stats);

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
      _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow, world.getNodeState('hologram4')?.shape ?? 'cube');
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
      const fade = () => { if (!_dragging) { _wireGlow = Math.max(0, _wireGlow - 0.05); } _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow, world.getNodeState('hologram4')?.shape ?? 'cube'); if (_wireGlow > 0.01 || _dragging) requestAnimationFrame(fade); };
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

    let _lastRenderPhysicsMs = 0;
    const _renderFrame = () => {
      const n = world.getNodeState('hologram4');
      if (!n?.cachedRadii?.length) return;

      const dir = n.direction ?? 1;
      const lt  = world.ps.app.logicalTime ?? 0;

      // ── Sync renderer flags from world state (reflector round-trip) ──────────
      {
        const prev_plateDrivenMode = _plateDrivenMode;
        const prev_noHebbTest      = _noHebbTest;
        const prev_nullPlateTest   = _nullPlateTest;
        const prev_plateKernelMode = _plateKernelMode;
        const prev_demodKickMode   = _demodKickMode;
        const prev_plateSeedFree   = _plateSeedFree;
        const prev_backPlateMode   = _backPlateMode;
        _breathVis        = n.breathVis        ?? true;
        _plateDrivenMode  = n.plateDrivenMode  ?? true;
        _noHebbTest       = n.noHebbTest       ?? false;
        _nullPlateTest    = n.nullPlateTest     ?? false;
        _plateKernelMode  = n.plateKernelMode  ?? false;
        _demodKickMode    = n.demodKickMode    ?? false;
        _plateSeedFree    = n.plateSeedFree    ?? false;
        _backPlateMode    = n.backPlateMode    ?? false;
        _plateKernelGamma = n.plateKernelGamma ?? SRC_ALPHA;
        _plateKernelDT    = n.plateKernelDT    ?? DT;
        _plateKernelSteps = n.plateKernelSteps ?? 16;
        const reconResetSeq     = n.reconResetSeq ?? 0;
        const reconResetChanged = reconResetSeq !== _localReconResetSeen;
        const modeChanged = _plateDrivenMode !== prev_plateDrivenMode ||
                            _noHebbTest      !== prev_noHebbTest      ||
                            _nullPlateTest   !== prev_nullPlateTest   ||
                            _plateKernelMode !== prev_plateKernelMode ||
                            _demodKickMode   !== prev_demodKickMode   ||
                            _plateSeedFree   !== prev_plateSeedFree   ||
                            _backPlateMode   !== prev_backPlateMode;
        if (reconResetChanged || modeChanged) {
          _localReconResetSeen = reconResetSeq;
          if (reconResetChanged) _smoothMaxField = 0;
          _localReconSoliton = false;
        }
        // ── Sync button UI ───────────────────────────────────────────────────
        const _activeShape = n.shape ?? 'cube';
        btnShapeCube.style.opacity     = _activeShape === 'cube'     ? '1' : '0.45';
        btnShapePyramid.style.opacity  = _activeShape === 'pyramid'  ? '1' : '0.45';
        btnShapeCombined.style.opacity = _activeShape === 'combined' ? '1' : '0.45';
        btnBreath.textContent      = _breathVis        ? '~ BREATH  on'      : '~ BREATH  off';
        btnHebb.textContent        = _plateDrivenMode  ? '⊛ PLATE on'        : '⊛ GEO+SEED';
        btnHebb.style.background   = _plateDrivenMode  ? '#633'              : '#363';
        btnHebb.style.color        = _plateDrivenMode  ? '#faa'              : '#afa';
        btnNoHebb.textContent      = _noHebbTest       ? '⊛ +HEBB on'        : '⊛ +HEBB';
        btnNoHebb.style.background = _noHebbTest       ? '#363'              : '#555';
        btnNoHebb.style.color      = _noHebbTest       ? '#afa'              : '#aaa';
        btnNullPlate.textContent      = _nullPlateTest ? '∅ NULL PLATE on'   : '∅ NULL PLATE';
        btnNullPlate.style.background = _nullPlateTest ? '#800'              : '#555';
        btnNullPlate.style.color      = _nullPlateTest ? '#f88'              : '#aaa';
        btnPlateKernel.textContent      = _plateKernelMode ? '⬡ PLATE KERN on' : '⬡ PLATE KERN';
        btnPlateKernel.style.background = _plateKernelMode ? '#633'            : '#555';
        btnPlateKernel.style.color      = _plateKernelMode ? '#faa'            : '#aaa';
        btnDemodKick.textContent      = _demodKickMode ? '⬡ DEMOD KICK on'  : '⬡ DEMOD KICK';
        btnDemodKick.style.background = _demodKickMode ? '#363'              : '#555';
        btnDemodKick.style.color      = _demodKickMode ? '#afa'              : '#aaa';
        btnPlateSeed.textContent      = _plateSeedFree ? '⬡ FREE IFS on'    : '⬡ FREE IFS';
        btnPlateSeed.style.background = _plateSeedFree ? '#363'              : '#555';
        btnPlateSeed.style.color      = _plateSeedFree ? '#afa'              : '#aaa';
        btnBackPlate.textContent      = _backPlateMode  ? '↩ BACK+PLATE on'  : '↩ BACK+PLATE';
        btnBackPlate.style.background = _backPlateMode  ? '#246'             : '#345';
        btnBackPlate.style.color      = _backPlateMode  ? '#aef'             : '#8cf';
        gammaLbl.textContent = `γ ${_plateKernelGamma.toFixed(2)}`;
        if (!gammaSlider.matches(':active')) gammaSlider.value = String(_plateKernelGamma);
        const dtLbl = dtWrap.querySelector('span'), dtSl = dtWrap.querySelector('input');
        if (dtLbl) dtLbl.textContent = `dt ${_plateKernelDT.toFixed(2)}`;
        if (dtSl && !dtSl.matches(':active')) dtSl.value = String(_plateKernelDT);
        const stLbl = stepsWrap.querySelector('span'), stSl = stepsWrap.querySelector('input');
        if (stLbl) stLbl.textContent = `N ${_plateKernelSteps}`;
        if (stSl && !stSl.matches(':active')) stSl.value = String(_plateKernelSteps);
      }

      // Gate all physics/rendering to at most ~60fps.
      // Renkon may call _renderFrame on every model tick (every 1ms); skip the
      // expensive work between frames — only update UI labels on extra calls.
      const _now0 = performance.now();
      const _elapsed = _lastRenderPhysicsMs > 0 ? Math.min(_now0 - _lastRenderPhysicsMs, 50) : 16;
      const _doPhysics = _elapsed >= 16;
      if (_doPhysics) _lastRenderPhysicsMs = _now0;

      // ── Kernel update ─────────────────────────────────────────────────────
      // Frozen during RECON (backward propagation must use recording kernel).
      // Frozen during an active GPU sweep (ref and sweep must use same kernel).
      // Applied only when display psi is in RECORD mode and no sweep is running.
      const nowMs = performance.now();
      const kernelVer = n.cachedRadiiVersion ?? 0;
      const sweepActive = (_sweepStep < T_RECORD && _sweepPsi !== null);
      const extraKey = JSON.stringify(n.extraPoints ?? []);
      const reconSeq = n.reconSeq ?? 0;
      if (_gpuReady && _gpuKernelVersion !== kernelVer && dir >= 0 && !sweepActive) {
        _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets);
        _gpuKernelVersion = kernelVer;
      }

      if (_doPhysics) {
      // ── Rebuild local obj/ref fields when kernel or angle changes ─────────
      const needObj  = _localKernelVersion !== kernelVer ||
                       _localAngleYSeen !== n.angleY || _localAngleXSeen !== n.angleX ||
                       _localExtraSeen !== extraKey || _localShapeSeen !== (n.shape ?? 'cube') || !_localObjField;
      if (needObj) {
        _localObjField = _buildSrcFieldIFS(n.angleY ?? INIT_ANGLE_Y, n.angleX ?? INIT_ANGLE_X, n.extraPoints ?? [], n.shape ?? 'cube');
        _localAngleYSeen = n.angleY; _localAngleXSeen = n.angleX; _localExtraSeen = extraKey; _localShapeSeen = n.shape ?? 'cube';
        _localKernelVersion = kernelVer;
        if (_gpuReady && dir >= 0 && _localDirection >= 0) _gpu.setObjField(_localObjField);
      }
      // Don't rebuild ref while a sweep is in progress — ref and sweep must use same kernel.
      const needRef = (!_localRefField || _localRefKernelVersion !== kernelVer) && dir >= 0 && !sweepActive;
      if (needRef && n.cachedRadii.length) {
        const psiR0 = _initRefPsi();
        _localRefReady = false;
        if (_gpuReady) {
          // GPU path: seed sweep with ref init, run T_RECORD steps, bake into ref texture
          _gpu.setSweepPsi(psiR0);
          _gpu.buildRefFromSweep(T_RECORD, DT);
          _localRefField = psiR0; // placeholder — keeps needRef false until readback arrives
          _gpu.readSweepPsiAsync().then(refPsi64 => {
            _localRefField = refPsi64;
            _localRefReady = true;
            console.log('[REF] readback done, N_CELLS=', refPsi64.length / 2);
          });
        } else {
          let psiR = new Float64Array(psiR0);
          for (let i = 0; i < T_RECORD; i++) psiR = _linearStepIFS(psiR, DT, n.cachedRadii, n.cachedWeights, n.cachedOffsets);
          _localRefField = psiR;
          _localRefReady = true;
        }
        _localRefKernelVersion = kernelVer;
        _sweepStep = T_RECORD;
        _sweepPsi  = null;
        _lastKeepaliveMs = 0; // trigger next keepalive sweep immediately
      }

      // ── Plate reset ───────────────────────────────────────────────────────
      const resetSeq = n.plateResetSeq ?? 0;
      if (resetSeq !== _localPlateResetSeq) {
        _localPlateResetSeq  = resetSeq;
        _localPlate          = new Float32Array(N_CELLS);
        _localPsi            = null;
        _localReconStep      = 0;
        _localReconSeq       = -1;
        _localReconHolding   = false;
        _localReconHoldUntil = 0;
        _lastReconStepMs     = 0;
        _localDirection      = 1;
        _localReconSoliton   = false;
        _reconSolitonField   = null;
        _reconDKX = 0; _reconDKY = 0;
        _reconDKXSeen = 0; _reconDKXCurrent = 0; _reconDKYSeen = 0;
        _reconSnapBaseAngleY = 0; _reconSnapBaseAngleX = 0;
        _sweepStep = T_RECORD; _sweepPsi = null; _snapAngleQueue = []; _recordedPlates = [];
        _lastKeepaliveMs = 0;
        _localPlateSnapSeq   = n.plateSnapSeq ?? 0; // sync to current — don't auto-fire after reset
        // Force obj field + kernel re-upload so GPU is fully resynced
        _gpuKernelVersion    = -1;
        _localKernelVersion  = -1;
        _localRefKernelVersion = -1;
        _localRefReady = false;
        _cplxPlateUploaded = false;
        _cplxPlateField    = null;
        _sweepSnapPsi      = null;
        if (_gpuReady) { _gpu.resetPlate(); _gpu.resetCplxPlate(); }
      }

      // ── Ensure display psi is seeded ──────────────────────────────────────
      if (!_localPsi) {
        _localPsi = new Float64Array(2 * N_CELLS); // zero — soliton grows from vacuum
        if (_gpuReady) _gpu.setPsi(_localPsi);
      }

      // ── Mode change detected ──────────────────────────────────────────────
      if (dir !== _localDirection || reconSeq !== _localReconSeq) {
        _localDirection = dir;
        if (dir < 0) {
          _localReconSeq      = reconSeq;
          _localReconStep     = 0;
          _localReconHolding  = false;
          _localReconSoliton  = false;
          _reconSolitonField  = null;
          _cplxPlateObjReady  = false;
          _reconDKX = 0; _reconDKY = 0;
          _reconDKXSeen = 0; _reconDKXCurrent = 0; _reconDKYSeen = 0; _reconLensFSeen = -1;
          _plateDemodField = null; _plateDemodPending = false;
          _reconSnapBaseAngleY = n.angleY ?? INIT_ANGLE_Y;
          _reconSnapBaseAngleX = n.angleX ?? INIT_ANGLE_X;
          _lastReconStepMs    = nowMs;
          // Use kernel from last sweep start — that's what the plate was built with.
          // Live cachedRadii may have drifted since then.
          _snapReconRadii   = (_sweepSnapRadii   ?? n.cachedRadii).slice();
          _snapReconWeights = (_sweepSnapWeights ?? n.cachedWeights).slice();
          _snapReconOffsets = (_sweepSnapOffsets ?? n.cachedOffsets).slice();
          // Sync plate from recorded plates — use center angle as default view.
          // Increment _plateSeq so any in-flight readPlateAsync callbacks are discarded.
          _plateSeq++;
          if (_recordedPlates.length > 0) {
            const center = Math.floor((_recordedPlates.length - 1) / 2);
            _localPlate = _recordedPlates[center].plate;
          }
          if (_gpuReady) {
            if (_localPlate) _gpu.uploadPlate(_localPlate);
            let reconWeights = _snapReconWeights;
            if (_noHebbTest && _hebbianWeights && _hebbianWeights.length === _snapReconWeights.length) {
              reconWeights = _snapReconWeights.map((w, i) => w + _hebbianWeights[i]);
            }
            _gpu.setRings(_snapReconRadii, reconWeights, _snapReconOffsets);
            _gpuKernelVersion = -1;
            if (_cplxPlateUploaded && !_plateDrivenMode) {
              // Seed sweep from complex plate and use as objField attractor
              _gpu.reconFromCplxPlate();
              _psiReadPending = false;
              _gpu.readSweepPsiAsync().then(psi64 => {
                let mx = 0;
                for (let j = 0; j < N_CELLS; j++) { const v = psi64[j*2]*psi64[j*2]+psi64[j*2+1]*psi64[j*2+1]; if(v>mx) mx=v; }
                console.log('[RECON] cplx plate recon, sweep max=', Math.sqrt(mx).toFixed(6));
                if (mx < 1e-12) {
                  console.log('[RECON] cplx plate empty after recon, using snapPsi attractor');
                  return;
                }
                const scale = REF_AMP / Math.sqrt(mx);
                const normed = new Float64Array(psi64.length);
                for (let j = 0; j < psi64.length; j++) normed[j] = psi64[j] * scale;
                _gpu.setObjField(normed);
                _localPsi = normed;
                _smoothMaxField = REF_AMP * REF_AMP;
                _localReconSoliton = true;
                _cplxPlateObjReady = true;
                console.log('[RECON] objField from cplx plate, scale=', scale.toFixed(2));
              });
            } else {
              console.log('[RECON] GEO+SEED mode, no cplx plate for GPU reconFromCplxPlate');
            }
          }
          let seed;
          if (_plateDrivenMode) {
            // Pure Hebbian: seed with weak noise so kernel fixed point emerges unbiased
            seed = new Float64Array(2 * N_CELLS);
            for (let j = 0; j < N_CELLS; j++) {
              seed[j*2]   = (Math.random() - 0.5) * REF_AMP * 0.1;
              seed[j*2+1] = (Math.random() - 0.5) * REF_AMP * 0.1;
            }
          } else {
            seed = _snapPsi ?? new Float64Array(2 * N_CELLS);
          }
          _localPsi = seed;
          if (_gpuReady) _gpu.setSweepPsi(seed);
          else _gpu?.setSweepPsi(seed);
          let initMax = 1e-9;
          for (let j = 0; j < N_CELLS; j++) {
            const v = seed[j*2]*seed[j*2] + seed[j*2+1]*seed[j*2+1];
            if (v > initMax) initMax = v;
          }
          _smoothMaxField = initMax;
          _sweepStep = T_RECORD; _sweepPsi = null; _snapAngleQueue = [];
        } else {
          // Resuming RECORD: force GPU kernel + obj field resync to live state
          _gpuKernelVersion = -1;
          _localKernelVersion = -1; // force obj field rebuild + re-upload
          _snapReconRadii = null;
          _localReconSoliton = false;
          _reconSolitonField = null;
          _cplxPlateObjReady = false;
          // Don't reset _smoothMaxRecord — carry forward so RECORD display stays stable on re-entry
          _lastKeepaliveMs = 0;
        }
      }

      // ── Display psi evolution ────────────────────────────────────────────────
      // RECORD: GPU stepRecord (fast); async readback for rendering (non-blocking).
      // RECON:  JS _linearStepIFS at RECON_STEP_DELAY cadence (1 step/16ms, cheap).
      if (_localObjField && n.cachedRadii.length) {
        if (dir > 0) {
          if (_gpuReady) {
            if (_breathVis) for (let _si = 0; _si < 16; _si++) _gpu.stepRecord(DT, SRC_ALPHA);
            // Inject extra beams (Shift+right-click sources) into main GPU psi texture
            const beams = n.extraBeams;
            if (beams && beams.length > 0) {
              const t = n.time ?? 0;
              const src32 = new Float32Array(N_CELLS * 2);
              for (const b of beams) {
                const ph0 = b.freq * t + b.ph0;
                const ringCount = b.rings.length || 1;
                for (const ring of b.rings) {
                  const ph = ph0 + ring.phOff;
                  const scale = b.amp / (ring.cells.length * ringCount);
                  const cr = scale * Math.cos(ph), ci = scale * Math.sin(ph);
                  for (const j of ring.cells) { src32[j*2] += cr; src32[j*2+1] += ci; }
                }
                const jc = b.gy * GRID + b.gx;
                src32[jc*2]   += b.amp / ringCount * Math.cos(ph0);
                src32[jc*2+1] += b.amp / ringCount * Math.sin(ph0);
              }
              _gpu.addSourcesPsi(src32);
            }
            if (!_psiReadPending) {
              _psiReadPending = true;
              _gpu.readPsiAsync().then(psi64 => {
                _psiReadPending = false;
                _localPsi = psi64;
              });
            }
          } else {
            const _stepsThisFrame = Math.min(32, Math.max(1, Math.round(_elapsed)));
            for (let _si = 0; _si < _stepsThisFrame; _si++) {
              _localPsi = _linearStepIFS(_localPsi, DT, n.cachedRadii, n.cachedWeights, n.cachedOffsets);
              for (let j = 0; j < N_CELLS; j++) {
                _localPsi[j*2]   += SRC_ALPHA * (_localObjField[j*2]   - _localPsi[j*2]);
                _localPsi[j*2+1] += SRC_ALPHA * (_localObjField[j*2+1] - _localPsi[j*2+1]);
              }
              for (const b of (n.extraBeams ?? [])) {
                const t = n.time ?? 0;
                const ph0 = b.freq * t + b.ph0;
                const ringCount = b.rings.length || 1;
                for (const ring of b.rings) {
                  const ph = ph0 + ring.phOff;
                  const scale = b.amp / (ring.cells.length * ringCount);
                  const cr = scale * Math.cos(ph), ci = scale * Math.sin(ph);
                  for (const j of ring.cells) { _localPsi[j*2] += cr; _localPsi[j*2+1] += ci; }
                }
                const jc = b.gy * GRID + b.gx;
                _localPsi[jc*2]   += b.amp / ringCount * Math.cos(ph0);
                _localPsi[jc*2+1] += b.amp / ringCount * Math.sin(ph0);
              }
            }
          }
        } else {
            // RECON: compute focused field instantly (all T_RECORD steps in one RAF),
            // upload as objField attractor, then run stepRecordSweep as continuous soliton.
            // No frame-by-frame animation — the reconstruction IS the soliton fixed point.
            const probe = n.depthProbe;
            const targetSteps = probe
              ? Math.max(1, Math.round((probe.depthFraction ?? 0.5) * T_RECORD))
              : T_RECORD;

            // Attractor traversal: sweep plate demodulation parameters each frame.
            {
              const lensF = n.lensF ?? 50;
              const plate = _recordedPlates.length > 0 ? _recordedPlates[0].plate : _localPlate;
              if (_autoRotate && _plateDrivenMode) {
                _travPhase += TRAV_SPEED;
                const s = Math.sin(_travPhase);
                if      (_autoTravMode === 'rot')   { _travRot    = s * 0.6; }
                else if (_autoTravMode === 'dkx')   { _travDKX    = s * 0.25; }
                else if (_autoTravMode === 'dky')   { _travDKY    = s * 0.25; }
                else if (_autoTravMode === 'shift')  { _travShiftX = s * 12; _travShiftY = s * 8; }
                else if (_autoTravMode === 'scale')  { _travScale  = 1 + s * 0.5; }
              }
              const needUpdate = _autoRotate || Math.abs(_travDKX - _reconDKXCurrent) > 0.002 || lensF !== _reconLensFSeen;
              if (needUpdate && _gpuReady && plate?.length && !_plateDemodPending) {
                _reconDKXCurrent = _travDKX;
                _reconLensFSeen  = lensF;
                const raw = _buildReconField(plate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale);
                if (_plateDemodMode) {
                  // Project onto IFS eigenstates: free-propagate demod field for PROJ_STEPS
                  // then read back — result is the nearest IFS eigenstate to the object wave
                  const PROJ_STEPS = T_RECORD;
                  _plateDemodPending = true;
                  _plateDemodField = null;
                  _gpu.setSweepPsi(raw);
                  _gpu.stepSweepN(PROJ_STEPS, DT);
                  _gpu.readSweepPsiAsync().then(projected => {
                    _plateDemodField = projected;
                    _plateDemodPending = false;
                    _localReconSoliton = false; // re-trigger soliton entry with projected field
                  });
                } else {
                  _plateDemodField = raw;
                  if (!_plateDrivenMode) _gpu.setSweepPsi(raw);
                  _localReconSoliton = false;
                  _cplxPlateObjReady = false;
                }
              }
            }

            if (!_localReconSoliton && !_cplxPlateObjReady && _gpuReady) {
              _smoothMaxField = 1e-9;
              _localReconSoliton = true;
              if (_cplxPlateUploaded && !_plateDrivenMode) {
                if (_snapPsi) _gpu.setObjField(_snapPsi);
              } else if (_plateSeedFree) {
                const seed = _localPlate
                  ? _buildReconField(_localPlate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale)
                  : new Float64Array(2 * N_CELLS);
                _gpu.setSweepPsi(seed);
              } else if (_plateKernelMode) {
                const noiseSeed = new Float64Array(2 * N_CELLS);
                for (let j = 0; j < N_CELLS; j++) {
                  noiseSeed[j*2]   = (Math.random() - 0.5) * REF_AMP * 0.1;
                  noiseSeed[j*2+1] = (Math.random() - 0.5) * REF_AMP * 0.1;
                }
                _gpu.setSweepPsi(noiseSeed);
              } else if (_demodKickMode) {
                // Seed from demodulated plate — start near object wavefront, kick stabilizes it
                const demod = _localPlate
                  ? _buildReconField(_localPlate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale)
                  : new Float64Array(2 * N_CELLS);
                _gpu.setSweepPsi(demod);
                _gpu.setObjField(demod);
              } else if (_backPlateMode) {
                // Option 4: backward sweep + plate phase kick → read back as objField attractor
                // Seed with noise, run T_RECORD steps backward each with plate phase constraint
                const noiseSeed = new Float64Array(2 * N_CELLS);
                for (let j = 0; j < N_CELLS; j++) {
                  noiseSeed[j*2]   = (Math.random() - 0.5) * REF_AMP * 0.1;
                  noiseSeed[j*2+1] = (Math.random() - 0.5) * REF_AMP * 0.1;
                }
                _gpu.setSweepPsi(noiseSeed);
                for (let _si = 0; _si < T_RECORD; _si++) {
                  _gpu.stepSweep(-DT);
                  _gpu.platePhaseKickSweep(_plateKernelGamma, _smoothMaxPlate);
                }
                _gpu.readSweepPsiAsync().then(focused => {
                  let mx = 0;
                  for (let j = 0; j < N_CELLS; j++) { const v = focused[j*2]*focused[j*2]+focused[j*2+1]*focused[j*2+1]; if(v>mx) mx=v; }
                  if (mx < 1e-12) { console.log('[BACK+PLATE] focused field empty'); return; }
                  const scale = REF_AMP / Math.sqrt(mx);
                  const normed = new Float64Array(focused.length);
                  for (let j = 0; j < focused.length; j++) normed[j] = focused[j] * scale;
                  _gpu.setObjField(normed);
                  console.log('[BACK+PLATE] objField set from backward sweep, scale=', scale.toFixed(3));
                });
              } else if (_plateDrivenMode) {
                if (_nullPlateTest) {
                  _gpu.setSweepPsi(new Float64Array(2 * N_CELLS));
                  _gpu.setObjField(new Float64Array(2 * N_CELLS));
                } else if (_localPlate) {
                  // Noise seed for both sweep and main psi — find plate attractor unbiased
                  const noiseSeed = new Float64Array(2 * N_CELLS);
                  for (let j = 0; j < N_CELLS; j++) {
                    noiseSeed[j*2]   = (Math.random() - 0.5) * REF_AMP * 0.1;
                    noiseSeed[j*2+1] = (Math.random() - 0.5) * REF_AMP * 0.1;
                  }
                  _gpu.setSweepPsi(noiseSeed);
                  // objField = demodulated plate, rescaled to REF_AMP so injection is strong
                  const plateObj = _buildReconField(_localPlate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale);
                  let dmMx = 0; for (let j=0; j<N_CELLS; j++) { const v=plateObj[j*2]*plateObj[j*2]+plateObj[j*2+1]*plateObj[j*2+1]; if(v>dmMx) dmMx=v; }
                  const dmScale = dmMx > 1e-12 ? REF_AMP / Math.sqrt(dmMx) : 1;
                  for (let j=0; j<N_CELLS*2; j++) plateObj[j] *= dmScale;
                  console.log('[RECON] plate demod objField, raw max=', Math.sqrt(dmMx).toFixed(6), 'scaled to REF_AMP');
                  _gpu.setObjField(plateObj);
                } else {
                  _gpu.setSweepPsi(new Float64Array(2 * N_CELLS));
                  _gpu.setObjField(new Float64Array(2 * N_CELLS));
                }
              } else if (_plateDemodMode && _plateDemodField) {
                // Plate demod: inject demodulated plate as attractor — no snapPsi used
                _gpu.setObjField(_plateDemodField);
              } else {
                // Full mode: snapPsi as objField attractor (or zero if null — clears stale GPU texture)
                _gpu.setObjField(_snapPsi ?? new Float64Array(2 * N_CELLS));
              }
            } else if (_localReconSoliton && _gpuReady) {
              if (_plateSeedFree) {
                for (let _si = 0; _si < 16; _si++) _gpu.stepSweep(DT);
              } else if (_backPlateMode) {
                // Continuous backward sweep + plate phase kick — Gerchberg-Saxton in IFS basis
                for (let _si = 0; _si < _plateKernelSteps; _si++) {
                  _gpu.stepSweep(-DT);
                  _gpu.platePhaseKickSweep(_plateKernelGamma, _smoothMaxPlate);
                }
              } else if (_plateKernelMode) {
                for (let _si = 0; _si < _plateKernelSteps; _si++) {
                  _gpu.stepSweep(_plateKernelDT);
                  _gpu.platePhaseKickSweep(_plateKernelGamma, _smoothMaxPlate);
                }
              } else if (_demodKickMode) {
                // IFS step + demodulated object wavefront phase kick
                for (let _si = 0; _si < _plateKernelSteps; _si++) {
                  _gpu.stepSweep(_plateKernelDT);
                  _gpu.demodPhaseKickSweep(_plateKernelGamma);
                }
              } else {
                if (_nullPlateTest || (!_plateDrivenMode && !_snapPsi)) _gpu.setObjField(new Float64Array(2 * N_CELLS));
                for (let _si = 0; _si < 16; _si++) _gpu.stepRecordSweep(DT, SRC_ALPHA);
              }
              // Periodic readback — keep _localPsi current for _smoothMaxField EMA
              if (!_psiReadPending) {
                _psiReadPending = true;
                _gpu.readSweepPsiAsync().then(psi64 => {
                  _psiReadPending = false;
                  _localPsi = psi64;
                });
              }
            } else {
              // JS fallback
              if (!_localReconHolding && nowMs - _lastReconStepMs >= RECON_STEP_DELAY) {
                if (_localReconStep >= targetSteps) {
                  _localReconHolding = true; _localReconHoldUntil = nowMs + RECON_HOLD_MS;
                } else {
                  const rR = _snapReconRadii ?? n.cachedRadii;
                  const rW = _snapReconWeights ?? n.cachedWeights;
                  const rO = _snapReconOffsets ?? n.cachedOffsets;
                  _localPsi = _linearStepIFS(_localPsi, -DT, rR, rW, rO);
                  _localReconStep++; _lastReconStepMs = nowMs;
                }
              }
            }
          }
        }
      }

      // ── Plate sweep (RECORD only, manual snap) ────────────────────────────────
      // Triggered when plateSnapSeq changes. Runs T_RECORD steps then accumulates.
      if (dir > 0 && _localRefField && n.cachedRadii.length) {
        const snapSeq = n.plateSnapSeq ?? 0;
        // New snap: queue N_SNAP_ANGLES exposures, each gets its own fresh plate
        if (snapSeq !== _localPlateSnapSeq && _snapAngleQueue.length === 0) {
          _localPlateSnapSeq = snapSeq;
          _recordedPlates = [];
          // Compute Hebbian ring weights from current RECORD soliton:
          // w_d = Σ_{x,i} Re(ψ(x) · conj(ψ(x+off_i))) / (N * n_d)
          if (_gpuReady) {
            _gpu.readPsiAsync().then(psi64 => {
              const radii   = n.cachedRadii;
              const offsets = n.cachedOffsets;
              if (!radii.length) return;
              const W = new Array(radii.length).fill(0);
              for (let d = 0; d < radii.length; d++) {
                const offs = offsets[d];
                const nd   = offs.length >> 1;
                if (!nd) continue;
                let acc = 0;
                for (let j = 0; j < N_CELLS; j++) {
                  const cx = j % GRID, cy = (j / GRID) | 0;
                  const re0 = psi64[j*2], im0 = psi64[j*2+1];
                  for (let i = 0; i < nd; i++) {
                    const nx = ((cx + offs[i*2]   % GRID) + GRID) % GRID;
                    const ny = ((cy + offs[i*2+1] % GRID) + GRID) % GRID;
                    const nb = ny * GRID + nx;
                    // Re(ψ · conj(ψ_nb)) = re0*re_nb + im0*im_nb
                    acc += re0 * psi64[nb*2] + im0 * psi64[nb*2+1];
                  }
                }
                W[d] = acc / (N_CELLS * nd);
              }
              // Normalize so max weight = FRAC_ALPHA
              const maxW = Math.max(...W.map(Math.abs), 1e-9);
              _hebbianWeights = W.map(w => (w / maxW) * FRAC_ALPHA);
              _snapPsi = psi64;
              console.log('[HEBBIAN] weights=', _hebbianWeights.map(v => v.toFixed(4)));
            });
          }
          const baseY = n.angleY ?? INIT_ANGLE_Y;
          const baseX = n.angleX ?? INIT_ANGLE_X;
          const half = (N_SNAP_ANGLES - 1) / 2;
          for (let i = 0; i < N_SNAP_ANGLES; i++) {
            _snapAngleQueue.push({ angleY: baseY + (i - half) * SNAP_ANGLE_STEP, angleX: baseX });
          }
        }
        // Start next exposure when sweep is idle
        if (_sweepStep >= T_RECORD && _sweepPsi === null && _snapAngleQueue.length > 0) {
          const { angleY: qY, angleX: qX } = _snapAngleQueue.shift();
          _sweepPsi = new Float64Array(_buildSrcFieldIFS(qY, qX, n.extraPoints ?? [], n.shape ?? 'cube'));
          _sweepStep = 0;
          _sweepAngleY = qY; _sweepAngleX = qX; _sweepExtraKey = extraKey;
          _sweepSnapRadii   = n.cachedRadii.slice();
          _sweepSnapWeights = n.cachedWeights.slice();
          _sweepSnapOffsets = n.cachedOffsets.slice();
          if (_gpuReady) {
            _gpu.resetPlate();   // fresh plate for this exposure
            _gpu.setSweepPsi(_sweepPsi);
          }
        }
        if (_sweepStep < T_RECORD && _sweepPsi) {
          if (_gpuReady) {
            const toRun = Math.min(GPU_STEPS_PER_FRAME, T_RECORD - _sweepStep);
            _gpu.stepSweepN(toRun, DT);
            _sweepStep += toRun;
            if (_sweepStep >= T_RECORD) {
              _gpu.accumulatePlateSweep(PLATE_DECAY);
              // JS-side complex plate: read sweep psi (Float32→Float64), multiply by conj(ref) in Float64
              const _capturedRef = _localRefReady ? _localRefField : null;
              const _seqCplx = _plateSeq;
              _gpu.readSweepPsiAsync().then(swPsi => {
                if (_plateSeq !== _seqCplx) { console.log('[CPLX] aborted: plateSeq changed'); return; }
                if (!_capturedRef) { console.log('[CPLX] aborted: no ref field at snap time'); return; }
                if (swPsi.length !== _capturedRef.length) { console.log('[CPLX] aborted: length mismatch', swPsi.length, _capturedRef.length); return; }
                const cplx = new Float32Array(N_CELLS * 2);
                let mx = 0;
                for (let j = 0; j < N_CELLS; j++) {
                  const pr = swPsi[j*2], pi = swPsi[j*2+1];
                  const rr = _capturedRef[j*2], ri = _capturedRef[j*2+1];
                  cplx[j*2]   = pr*rr + pi*ri;
                  cplx[j*2+1] = pi*rr - pr*ri;
                  const m = pr*pr+pi*pi; if (m>mx) mx=m;
                }
                _gpu.uploadCplxPlate(cplx);
                _cplxPlateUploaded = true;
                // Save raw sweep psi — pure IFS eigenstate of the object, use as soliton attractor
                const swMx = Math.sqrt(mx);
                const swScale = swMx > 1e-12 ? REF_AMP / swMx : 1;
                _sweepSnapPsi = new Float64Array(N_CELLS * 2);
                for (let j = 0; j < N_CELLS * 2; j++) _sweepSnapPsi[j] = swPsi[j] * swScale;
                // Keep JS copy of ψ_sweep·conj(ψ_ref) for debug canvas
                let cplxMx = 0;
                for (let j = 0; j < N_CELLS; j++) { const v = cplx[j*2]*cplx[j*2]+cplx[j*2+1]*cplx[j*2+1]; if(v>cplxMx) cplxMx=v; }
                const cplxScale = cplxMx > 1e-12 ? REF_AMP / Math.sqrt(cplxMx) : 1;
                _cplxPlateField = new Float64Array(N_CELLS * 2);
                for (let j = 0; j < N_CELLS * 2; j++) _cplxPlateField[j] = cplx[j] * cplxScale;
                console.log('[CPLX-PLATE] uploaded, sweep max=', swMx.toFixed(6));
              });
              const capturedAngleY = _sweepAngleY;
              const capturedAngleX = _sweepAngleX;
              const _seq = _plateSeq;
              _gpu.readPlateAsync().then(pl => {
                if (_plateSeq !== _seq) return;
                _recordedPlates.push({ angleY: capturedAngleY, angleX: capturedAngleX, plate: pl });
                // Keep _localPlate pointing at the center-angle plate for display
                const center = Math.floor(_recordedPlates.length / 2);
                _localPlate = _recordedPlates[center].plate;
                console.log('[PLATE-ACCUM] angleY=', capturedAngleY?.toFixed(3), 'plates=', _recordedPlates.length);
              });
              _sweepPsi = null;
            }
          } else {
            // JS fallback: run synchronously
            while (_sweepStep < T_RECORD) {
              _sweepPsi = _linearStepIFS(_sweepPsi, DT, n.cachedRadii, n.cachedWeights, n.cachedOffsets);
              _sweepStep++;
            }
            const newPl = new Float32Array(N_CELLS);
            for (let j = 0; j < N_CELLS; j++) {
              const re = _sweepPsi[j*2]   + _localRefField[j*2];
              const im = _sweepPsi[j*2+1] + _localRefField[j*2+1];
              newPl[j] = (re*re + im*im);
            }
            _recordedPlates.push({ angleY: _sweepAngleY, angleX: _sweepAngleX, plate: newPl });
            _localPlate = newPl;
            _sweepPsi = null;
          }
        }
      }

      // Update local angle from world state (if not dragging) — always RECORD angle
      if (!_dragging) {
        _localAngleY = n.angleY ?? INIT_ANGLE_Y;
        _localAngleX = n.angleX ?? INIT_ANGLE_X;
      }

      // ── Normalization ─────────────────────────────────────────────────────
      if (_localPsi) {
        let maxField = 1e-9;
        for (let j = 0; j < N_CELLS; j++) {
          const v = _localPsi[j*2]*_localPsi[j*2] + _localPsi[j*2+1]*_localPsi[j*2+1];
          if (v > maxField) maxField = v;
        }
        if (dir > 0) {
          const nr = _smoothMaxRecord < 1e-9 ? maxField : _smoothMaxRecord * 0.98 + maxField * 0.02;
          _smoothMaxRecord = isFinite(nr) && nr > 1e-12 ? nr : 1e-9;
          if (_breathVis) _smoothMaxField = _smoothMaxRecord;
        } else {
          // RECON — update shared scale from sweep, record scale holds its last RECORD value
          const newSmooth = _smoothMaxField < 1e-9 ? maxField : _smoothMaxField * 0.98 + maxField * 0.02;
          _smoothMaxField = isFinite(newSmooth) && newSmooth > 1e-12 ? newSmooth : 1e-9;
        }
      }
      let maxPlate = 1e-9;
      if (_localPlate) {
        for (let j = 0; j < N_CELLS; j++) if (_localPlate[j] > maxPlate) maxPlate = _localPlate[j];
        _smoothMaxPlate = _smoothMaxPlate < 1e-9 ? maxPlate : _smoothMaxPlate * 0.96 + maxPlate * 0.04;
      }

      // ── Rendering ─────────────────────────────────────────────────────────
      if (_gpuReady) {
        // GPU-direct: render straight from GPU textures — no readback, no flicker
        if (dir > 0) {
          const normR = Math.max(_smoothMaxRecord > 1e-9 ? _smoothMaxRecord : _smoothMaxField, 1e-9);
          _gpu.renderField(normR);
          fieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          _gpu.renderPhase(normR);
          phaseCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          _gpu.renderPlate(_smoothMaxPlate, normR, 1);
          plateCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
        } else {
          // RECON: render from sweep texture
          const normS = Math.max(_smoothMaxField, 1e-9);
          _gpu.renderSweepField(normS);
          fieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          _gpu.renderSweepPhase(normS);
          phaseCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          _gpu.renderSweepPlate(_smoothMaxPlate, normS);
          plateCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
        }
      } else if (_localPsi) {
        // CPU fallback (no GPU): bilinear upsample from _localPsi
        const psi   = _localPsi;
        const plate = _localPlate;
        const norm      = 1 / Math.sqrt(Math.max(_smoothMaxField, 1e-18));
        const plateNorm = 1 / Math.sqrt(Math.max(_smoothMaxPlate, 1e-18));
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
      }

      // ── Depth point cloud ─────────────────────────────────────────────────
      {
        const cloud = null; // cloud tomography removed in Deterministic Viewport
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
        } else if (dir < 0 && (_cplxPlateField || _plateDemodField)) {
          // DEBUG: visualize the actual objField attractor
          const debugField = _cplxPlateField ?? _plateDemodField;
          cloudCell.wrap.firstChild.textContent = _cplxPlateField
            ? 'CPLX ATTRACTOR  ψ_sweep·conj(ψ_ref)  direct'
            : (_localRefReady ? 'DEMOD ATTRACTOR  plate·conj(ψ_ref)' : 'DEMOD ATTRACTOR  plate·exp(−iKx)');
          let maxD = 1e-9;
          for (let j = 0; j < N_CELLS; j++) {
            const v = debugField[j*2]*debugField[j*2] + debugField[j*2+1]*debugField[j*2+1];
            if (v > maxD) maxD = v;
          }
          const imgD = cloudCell.ctx.createImageData(cw, ch);
          for (let py = 0; py < ch; py++) {
            for (let px = 0; px < cw; px++) {
              const gx = Math.min(GRID-1, Math.floor(px * GRID / cw));
              const gy = Math.min(GRID-1, Math.floor(py * GRID / ch));
              const j = gy * GRID + gx;
              const re = debugField[j*2], im = debugField[j*2+1];
              const amp = Math.sqrt((re*re + im*im) / maxD);
              // Show both amplitude (brightness) and phase (hue) — object info may be in phase
              const ph = Math.atan2(im, re); // -π..π
              const hue = ((ph / Math.PI + 1) * 0.5); // 0..1
              const r = (0.5 + 0.5 * Math.cos(2 * Math.PI * hue))       * amp;
              const g = (0.5 + 0.5 * Math.cos(2 * Math.PI * (hue-0.33))) * amp;
              const b = (0.5 + 0.5 * Math.cos(2 * Math.PI * (hue-0.67))) * amp;
              const idx = (py * cw + px) * 4;
              imgD.data[idx]   = r * 255 | 0;
              imgD.data[idx+1] = g * 255 | 0;
              imgD.data[idx+2] = b * 255 | 0;
              imgD.data[idx+3] = 255;
            }
          }
          cloudCell.ctx.putImageData(imgD, 0, 0);
        } else {
          cloudCell.ctx.fillStyle = '#444';
          cloudCell.ctx.font = '7px ui-monospace,monospace';
          const msg = dir === 1 ? 'waiting for IFS cycle…' : 'record first, then reconstruct';
          cloudCell.ctx.fillText(msg, 8, ch / 2);
        }
      }

      // Wireframe
      _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow, world.getNodeState('hologram4')?.shape ?? 'cube');

      // Mode indicator (runs every Renkon tick for responsive UI)
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
  title:       'Hologram4 | IFS-Native Real-Time Wavefront (GPU)',
  selo:        'hologram4',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologram4WorldProgram + av],
  makeRenderer: makeHologram4Renderer,
  wrapId:      'hologram4-wrap',
  hideTopBar:  true,
};
