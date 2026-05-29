/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── Hologram4 | IFS-Native Real-Time Wavefront Holography ────────────────────
//
// The IFS fractal clock IS the Huygens-Fresnel propagator.
// Each IFS beat at (depth d, delay τ) applies a Huygens ring convolution
// at radius r = round(τ/DELAY_SCALE) with complex weight w = A·exp(±ik·r)/r.
//
// RECORD  (+k): IFS beats accumulate psi forward; plate = |psi+ref|² built
//               at finalizeFresnelm from the converged psi snapshot.
// RECON   (−k): conjugate IFS beats (same tree, flipped phase) propagate the
//               plate-seeded field backward → converges to srcField projection.
//
// Controls:
//   Drag any canvas or wireframe → rotate cube
//   [RECORD] / [RECONSTRUCT] buttons → toggle mode
//   [RESET PLATE] → clear and return to init
//   Dbl-click canvas → manual IFS next-cycle

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
const SUBTICK_MS   = 0.09;

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID    = 128;
const N_CELLS = GRID * GRID;

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH   = 2.0;
const DELAY_SCALE  = 0.06;         // maps IFS delay → ring radius: r = delay/DELAY_SCALE
const DT           = 0.12;
const REF_AMP      = 1.5;
const REF_KX       = 3.5;          // off-axis reference — separates ±1 orders
const SRC_ALPHA    = 0.04;         // Huygens beat amplitude scale
const RECON_ALPHA  = 0.02;         // anchor during reconstruction — same strength as RECORD
const PLATE_DECAY  = 0.992;        // per-step exponential decay for plate accumulation
const Z_PROP       = 28;           // virtual source depth (grid cells)

// ── IFS Huygens propagator ────────────────────────────────────────────────────
// Each beat fires at delay τ ∈ [IFS_MIN_DELAY, IFS_BASE_DELAY], mapping to
// ring radius r = round(τ/DELAY_SCALE).  The Huygens weight at that radius is
// w(r) = SRC_ALPHA · cos(k·r) / r   (real part; imaginary handled in beat handler)
// Forward tree  (+k phase): builds psi from srcField via Huygens integral.
// Backward tree (−k phase): time-reversal → refocuses to srcField projection.
const IFS_DEPTH      = 12;
const IFS_MAPS       = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP    = 3;
const IFS_MIN_DELAY  = 0.25;
const IFS_BASE_DELAY = parseFloat((DELAY_SCALE * GRID * 0.35).toFixed(6));
const FRESNEL_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 8).toFixed(4));
const N_FRESNEL_ROOTS   = 16;
const NEXT_STEP_DELAY   = 1;

// ── Render ────────────────────────────────────────────────────────────────────
const RENDER_SCALE = 3;

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
  const DT               = ${DT};
  const REF_AMP          = ${REF_AMP};
  const REF_KX           = ${REF_KX};
  const SRC_ALPHA        = ${SRC_ALPHA};
  const RECON_ALPHA      = ${RECON_ALPHA};
  const PLATE_DECAY      = ${PLATE_DECAY};
  const FRAC_ALPHA       = ${SRC_ALPHA};
  const MAX_IFS_BANDS    = 4;
  const PHYS_STEPS       = 1;
  const Z_PROP           = ${Z_PROP};
  const IFS_DEPTH        = ${IFS_DEPTH};
  const IFS_MAPS         = ${JSON.stringify(IFS_MAPS)};
  const IFS_GEN_CAP      = ${IFS_GEN_CAP};
  const IFS_MIN_DELAY    = ${IFS_MIN_DELAY};
  const IFS_BASE_DELAY   = ${IFS_BASE_DELAY};
  const FRESNEL_DONE_DELAY = ${FRESNEL_DONE_DELAY};
  const N_FRESNEL_ROOTS   = ${N_FRESNEL_ROOTS};
  const NEXT_STEP_DELAY   = ${NEXT_STEP_DELAY};
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
        sz:  z * (Z_PROP / CAM_Z),
        amp: 40.0 * (0.5 + 0.5 * (rz + 1) / 2) / total,
      };
    });
  };

  // ── Build source field: Huygens from cube (no reference) ─────────────────
  const _buildSrcField = (angleY, angleX) => {
    const sources = _projectSources(angleY, angleX);
    const n       = sources.length;
    const srcX = new Float32Array(n), srcY = new Float32Array(n);
    const srcZ = new Float32Array(n), srcA = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      srcX[k] = sources[k].sx; srcY[k] = sources[k].sy;
      srcZ[k] = sources[k].sz; srcA[k] = sources[k].amp;
    }
    const field = new Float64Array(2 * NCELLS);
    const kWav  = TWO_PI / WAVELENGTH;
    for (let j = 0; j < NCELLS; j++) {
      const cx = j % GRID, cy = (j / GRID) | 0;
      let re = 0, im = 0;
      for (let k = 0; k < n; k++) {
        const dx   = cx - srcX[k], dy = cy - srcY[k], sz = srcZ[k];
        const dist = Math.sqrt(dx*dx + dy*dy + sz*sz);
        const ph   = dist * kWav;
        re += srcA[k] * Math.cos(ph);
        im += srcA[k] * Math.sin(ph);
      }
      field[j*2] = re; field[j*2+1] = im;
    }
    return field;
  };

  // ── Extract fringes × ref from plate ─────────────────────────────────────
  // fringes = |obj+ref|² − |obj|² − |ref|² = 2·Re[obj·ref*]
  // seed    = fringes × ref  (IFS backward tree will converge this to obj)
  const _buildReconField = (plate, plateObj) => {
    const refAmp2 = REF_AMP * REF_AMP;
    let maxF = 1e-9;
    for (let j = 0; j < NCELLS; j++) {
      const f = Math.abs(plate[j] - plateObj[j] - refAmp2);
      if (f > maxF) maxF = f;
    }
    const norm = 1 / maxF;
    const psi  = new Float64Array(2 * NCELLS);
    for (let j = 0; j < NCELLS; j++) {
      const cx = j % GRID, ph = -REF_KX * cx;  // conjugate reference → phase conjugate mirror
      const fringe = (plate[j] - plateObj[j] - refAmp2) * norm;
      psi[j*2]   = fringe * Math.cos(ph);
      psi[j*2+1] = fringe * Math.sin(ph);
    }
    return psi;
  };

  // ── IFS slot launcher ─────────────────────────────────────────────────────
  const _launchSlot = (s, ctx, slot, cycleId) => {
    let h = (cycleId | 0) ^ 0xdeadbeef;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    W.rng.seed((h ^ (h >>> 16)) >>> 0);
    const logMin = Math.log(IFS_MIN_DELAY * 2.0);
    const logMax = Math.log(IFS_BASE_DELAY);
    for (let i = 0; i < N_FRESNEL_ROOTS; i++) {
      const t     = N_FRESNEL_ROOTS === 1 ? 1 : i / (N_FRESNEL_ROOTS - 1);
      const delay = Math.exp(logMin + t * (logMax - logMin));
      ctx.future(0, 'fresnelBeat', { depth: 0, delay, gen: 0, cycleId, slot });
    }
    ctx.future(FRESNEL_DONE_DELAY, 'finalizeFresnelm', { cycleId, slot });
    return {
      ...s,
      ['slotId_'     + slot]: cycleId,
      ['slotKernel_' + slot]: [],
      ['slotEnergy_' + slot]: new Array(IFS_DEPTH).fill(0),
      ['slotEvents_' + slot]: [],
      ['slotActive_' + slot]: true,
    };
  };

  const hologram4 = Behaviors.collect(
    {
      psi:      new Float64Array(2 * ${N_CELLS}),
      srcField: new Float64Array(2 * ${N_CELLS}),
      plate:    new Float32Array(${N_CELLS}),
      plateObj: new Float32Array(${N_CELLS}),
      time:     0,
      angleY:   INIT_ANGLE_Y,
      angleX:   INIT_ANGLE_X,
      cycleCount: 0,
      reconId:    0,
      direction:  1,
      slotId_A: -1, slotActive_A: false,
      slotKernel_A: [], slotEnergy_A: new Array(${IFS_DEPTH}).fill(0), slotEvents_A: [],
      slotId_B: -2, slotActive_B: false,
      slotKernel_B: [], slotEnergy_B: new Array(${IFS_DEPTH}).fill(0), slotEvents_B: [],
      cachedRadii: [], cachedWeights: [], cachedOffsets: [],
      ifsNBands: 0, ifsSEff: 0, ifsRadiiStr: '',
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (['rotate','toggleMode','resetPlate','nextCycle'].includes(t))
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} }, ...(s._queue ?? [])] };
      }
      return W.reduce(s, pulse, 'hologram4', {

        __macro: (s, p, ctx) => {
          if (p.isSubTick) return s;
          if (p.logicalTime !== 1) return s;
          ctx.future(100, '_keepalive', {});
          const srcField = _buildSrcField(INIT_ANGLE_Y, INIT_ANGLE_X);
          const psi      = new Float64Array(srcField);
          let s2 = _launchSlot({ ...s, psi, srcField, time: 0 }, ctx, 'A', p.logicalTime);
          ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2), '_launchB', { cycleId: p.logicalTime + 1 });
          return s2;
        },

        _keepalive: (s, p, ctx) => { ctx.future(200, '_keepalive', {}); return s; },

        _launchB: (s, p, ctx) => {
          if (s.slotActive_B) return s;
          return _launchSlot(s, ctx, 'B', p.cycleId ?? ctx.wallTime);
        },
        _launchA: (s, p, ctx) => {
          if (s.slotActive_A) return s;
          return _launchSlot(s, ctx, 'A', p.cycleId ?? ctx.wallTime);
        },

        // ── IFS beat: collect kernel radius (nls4 pattern) ───────────────
        fresnelBeat: (s, p, ctx) => {
          const slot = p.slot ?? 'A';
          if (p.cycleId !== s['slotId_' + slot]) return s;
          const { depth, delay } = p;
          _ifsFireChildren(ctx, p, 'fresnelBeat', 'fresnelBeat');
          const ri     = Math.max(1, Math.round(delay / DELAY_SCALE));
          const kernel = s['slotKernel_' + slot] ?? [];
          const newKernel = ri < (GRID >> 1) ? [...kernel, ri] : kernel;
          const energy = (s['slotEnergy_' + slot] ?? new Array(IFS_DEPTH).fill(0)).slice();
          energy[depth] = Math.min(1, (energy[depth] ?? 0) + 0.3);
          const events = [...(s['slotEvents_' + slot] ?? []).slice(-80),
            { d: depth, delay, wt: ctx.wallTime }];
          return { ...s,
            ['slotKernel_' + slot]: newKernel,
            ['slotEnergy_' + slot]: energy,
            ['slotEvents_' + slot]: events,
          };
        },

        // ── Finalize: build kernel, snapshot plate, (re)start _physStep ───
        finalizeFresnelm: (s, p, ctx) => {
          const slot = p.slot ?? 'A';
          if (p.cycleId !== s['slotId_' + slot]) return s;
          const { fRadii, fWeights, sEff } = _buildNativeKernel(
            s['slotKernel_' + slot] ?? [], FRAC_ALPHA, MAX_IFS_BANDS);
          const fOffs = _buildRingOffsets(fRadii);
          // (Re)start physics chain — like nls4
          if (!s.cachedRadii.length) {
            ctx.future(NEXT_STEP_DELAY, '_physStep', {
              stepsLeft: PHYS_STEPS, fRadii, fWeights, fOffs,
            });
          }
          const nextSlot    = slot === 'A' ? 'B' : 'A';
          const nextCycleId = p.cycleId + 2;
          if (!s['slotActive_' + nextSlot]) {
            ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2),
              '_launch' + nextSlot, { cycleId: nextCycleId });
          }
          return { ...s,
            ['slotActive_' + slot]: false,
            ['slotKernel_' + slot]: [],
            cachedRadii: fRadii, cachedWeights: fWeights, cachedOffsets: fOffs,
            ifsNBands: fRadii.length, ifsRadiiStr: fRadii.join(','), ifsSEff: sEff,
            cycleCount: (s.cycleCount ?? 0) + 1,
          };
        },

        // ── Continuous physics step (nls4 pattern) ────────────────────────
        // RECORD (+DT): forward IFS propagation + source injection.
        // RECON  (−DT): backward IFS (time-reversal) from seeded psi.
        _physStep: (s, p, ctx) => {
          const { fRadii, fWeights, fOffs } = p;
          if (!fRadii?.length || !s.psi) return s;
          const d   = (s.direction ?? 1);
          // Always propagate forward — RECON uses phase-conjugate seed, not -DT
          let psi = _linearStepIFS(s.psi, DT, fRadii, fWeights, fOffs);
          if (d > 0 && s.srcField) {
            for (let j = 0; j < ${N_CELLS}; j++) {
              psi[j*2]   += SRC_ALPHA * (s.srcField[j*2]   - psi[j*2]);
              psi[j*2+1] += SRC_ALPHA * (s.srcField[j*2+1] - psi[j*2+1]);
            }
          } else if (d < 0 && s.reconBaseField) {
            for (let j = 0; j < ${N_CELLS}; j++) {
              psi[j*2]   += RECON_ALPHA * (s.reconBaseField[j*2]   - psi[j*2]);
              psi[j*2+1] += RECON_ALPHA * (s.reconBaseField[j*2+1] - psi[j*2+1]);
            }
          }
          // Accumulate plate only during RECORD
          let plate = s.plate, plateObj = s.plateObj;
          if (d > 0) {
            plate    = new Float32Array(${N_CELLS});
            plateObj = new Float32Array(${N_CELLS});
            for (let j = 0; j < ${N_CELLS}; j++) {
              const cx  = j % GRID, rph = REF_KX * cx;
              const rre = REF_AMP * Math.cos(rph), rim = REF_AMP * Math.sin(rph);
              const re  = psi[j*2], im = psi[j*2+1];
              plate[j]    = PLATE_DECAY * s.plate[j]    + (1 - PLATE_DECAY) * ((re+rre)*(re+rre) + (im+rim)*(im+rim));
              plateObj[j] = PLATE_DECAY * s.plateObj[j] + (1 - PLATE_DECAY) * (re*re + im*im);
            }
          }
          const stepsLeft = (p.stepsLeft ?? 1) - 1;
          if (stepsLeft > 0) {
            ctx.future(0, '_physStep', { stepsLeft, fRadii, fWeights, fOffs });
          } else if (s.cachedRadii.length > 0) {
            ctx.future(NEXT_STEP_DELAY, '_physStep', {
              stepsLeft: PHYS_STEPS,
              fRadii: s.cachedRadii, fWeights: s.cachedWeights, fOffs: s.cachedOffsets,
            });
          }
          return { ...s, psi, plate, plateObj, time: (s.time ?? 0) + DT };
        },

        // ── Update rotation angle ─────────────────────────────────────────
        rotate: (s, p, ctx) => {
          const angleY   = p.angleY ?? s.angleY;
          const angleX   = p.angleX ?? s.angleX;
          const srcField = _buildSrcField(angleY, angleX);
          // In RECORD reset psi to new source; in RECON leave psi (holds recon result)
          const psi = (s.direction ?? 1) > 0 ? new Float64Array(srcField) : s.psi;
          return { ...s, angleY, angleX, srcField, psi };
        },

        // ── Toggle record / reconstruct ───────────────────────────────────
        // _physStep reads s.direction each step — no need to restart the chain.
        toggleMode: (s, p, ctx) => {
          const newDir = (s.direction ?? 1) === 1 ? -1 : 1;
          if (newDir === -1) {
            const reconBaseField = _buildReconField(s.plate, s.plateObj);
            return { ...s, direction: newDir, psi: new Float64Array(reconBaseField), reconBaseField };
          }
          return { ...s, direction: 1, psi: new Float64Array(s.srcField), reconBaseField: null };
        },

        // ── Clear plate and return to init ────────────────────────────────
        resetPlate: (s, p, ctx) => {
          const srcField = _buildSrcField(INIT_ANGLE_Y, INIT_ANGLE_X);
          // Restart physics chain like nls4 reset
          ctx.future(NEXT_STEP_DELAY, '_launchA', { cycleId: ctx.wallTime + 1 });
          ctx.future(NEXT_STEP_DELAY + Math.floor(FRESNEL_DONE_DELAY / 2),
            '_launchB', { cycleId: ctx.wallTime + 2 });
          return { ...s,
            psi: new Float64Array(srcField), srcField, reconBaseField: null,
            plate:    new Float32Array(${N_CELLS}),
            plateObj: new Float32Array(${N_CELLS}),
            time: 0, direction: 1,
            angleY: INIT_ANGLE_Y, angleX: INIT_ANGLE_X,
            cachedRadii: [], cachedWeights: [], cachedOffsets: [],
            slotActive_A: false, slotKernel_A: [],
            slotActive_B: false, slotKernel_B: [],
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

  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
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

    const main = document.createElement('div');
    Object.assign(main.style, { display: 'flex', flex: '1', flexDirection: 'row', minHeight: '0' });
    root.appendChild(main);

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

    const fieldCell = makeDataCell('OBJECT WAVE  |ψ|²  IFS Huygens propagation', '#f84');
    const phaseCell = makeDataCell('PHASE  arg(ψ)  wavefront structure', '#4af');
    const plateCell = makeDataCell('HOLOGRAM PLATE  |obj+ref|²  /  RECON  |ψ|²', '#9c4');
    canvasCol.appendChild(fieldCell.wrap);
    canvasCol.appendChild(phaseCell.wrap);
    canvasCol.appendChild(plateCell.wrap);

    const fieldBuf = fieldCell.ctx.createImageData(RW, RH);
    const phaseBuf = phaseCell.ctx.createImageData(RW, RH);
    const plateBuf = plateCell.ctx.createImageData(RW, RH);

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

    const ifsClock = makeIFSClockPanel({ label: 'HUYGENS IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    clockCol.appendChild(ifsClock.el);

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
    clockCol.appendChild(btnRecord);
    clockCol.appendChild(btnRecon);
    clockCol.appendChild(btnReset);

    const modeLbl = document.createElement('div');
    modeLbl.id = containerId + '-mode';
    Object.assign(modeLbl.style, {
      fontSize: '9px', fontWeight: 'bold', textAlign: 'center', color: '#9c4',
    });
    clockCol.appendChild(modeLbl);

    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, { fontSize: '7px', color: '#444', lineHeight: '1.6', overflow: 'hidden' });
    clockCol.appendChild(stats);

    let _dragging = false, _dragX0 = 0, _dragY0 = 0, _baseAngleY = INIT_ANGLE_Y, _baseAngleX = INIT_ANGLE_X;
    let _localAngleY = INIT_ANGLE_Y, _localAngleX = INIT_ANGLE_X;
    let _wireGlow = 0, _wireRafId = null;
    let _smoothMaxField = 0, _smoothMaxPlate = 0;

    const _clientXY = (e) => {
      const t = e.touches ?? e.changedTouches;
      return t?.length ? [t[0].clientX, t[0].clientY] : [e.clientX, e.clientY];
    };
    const _onStart = (e) => {
      e.preventDefault(); _dragging = true;
      [_dragX0, _dragY0] = _clientXY(e);
      _baseAngleY = _localAngleY; _baseAngleX = _localAngleX;
      wireCvs.style.cursor = 'grabbing';
    };
    const _onMove = (e) => {
      if (!_dragging) return;
      const [cx, cy] = _clientXY(e);
      _localAngleY = _baseAngleY + (cx - _dragX0) * 0.012;
      _localAngleX = _baseAngleX + (cy - _dragY0) * 0.012;
      _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow);
    };
    const _onEnd = (e) => {
      if (!_dragging) return;
      _dragging = false; wireCvs.style.cursor = 'grab';
      injectEvent?.({ type: 'rotate', angleY: _localAngleY, angleX: _localAngleX });
    };

    const _attachDrag = (el) => {
      el.addEventListener('mousedown',  _onStart, { passive: false });
      el.addEventListener('touchstart', _onStart, { passive: false });
    };
    [fieldCell.canvas, phaseCell.canvas, plateCell.canvas, wireCvs].forEach(_attachDrag);
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

    [fieldCell.canvas, phaseCell.canvas, plateCell.canvas].forEach(c => {
      c.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));
    });

    const logS = 1 / Math.log(1 + 9);

    const _renderFrame = () => {
      const n = world.getNodeState('hologram4');
      if (!n?.psi) return;

      const psi   = n.psi;
      const plate = n.plate;
      const lt    = world.ps.app.logicalTime ?? 0;
      const dir   = n.direction ?? 1;

      if (!_dragging) {
        _localAngleY = n.angleY ?? INIT_ANGLE_Y;
        _localAngleX = n.angleX ?? INIT_ANGLE_X;
      }

      let maxField = 1e-9;
      for (let j = 0; j < N_CELLS; j++) {
        const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
        if (v > maxField) maxField = v;
      }
      _smoothMaxField = Math.max(_smoothMaxField * (dir > 0 ? 0.98 : 0.88), maxField);
      const norm = 1 / Math.sqrt(_smoothMaxField);

      let maxPlate = 1e-9;
      if (plate) {
        for (let j = 0; j < N_CELLS; j++) if (plate[j] > maxPlate) maxPlate = plate[j];
        _smoothMaxPlate = _smoothMaxPlate < 1e-9 ? maxPlate : _smoothMaxPlate * 0.96 + maxPlate * 0.04;
      }
      const plateNorm = 1 / Math.sqrt(_smoothMaxPlate);

      for (let ry = 0; ry < RH; ry++) {
        const fy = (ry + 0.5) / RENDER_SCALE - 0.5;
        const y0 = Math.floor(fy), ty = fy - y0, y1 = y0 + 1;
        for (let rx = 0; rx < RW; rx++) {
          const fx = (rx + 0.5) / RENDER_SCALE - 0.5;
          const x0 = Math.floor(fx), tx = fx - x0, x1 = x0 + 1;
          const bi = (ry * RW + rx) * 4;
          let re = 0, im = 0, pl = 0;
          for (let dy = 0; dy <= 1; dy++) {
            const cy2 = Math.max(0, Math.min(GRID-1, dy === 0 ? y0 : y1));
            const wy  = dy === 0 ? (1-ty) : ty;
            for (let dx = 0; dx <= 1; dx++) {
              const gx = Math.max(0, Math.min(GRID-1, dx === 0 ? x0 : x1));
              const w  = (dx === 0 ? (1-tx) : tx) * wy;
              const j  = cy2 * GRID + gx;
              re += psi[j*2]   * w;
              im += psi[j*2+1] * w;
              if (plate) pl += plate[j] * w;
            }
          }
          const amp = Math.sqrt(re*re + im*im) * norm;
          const lv  = Math.log(1 + 9 * amp) * logS;
          const [fr, fg, fb] = colormaps.hot(lv);
          fieldBuf.data[bi]   = fr; fieldBuf.data[bi+1] = fg;
          fieldBuf.data[bi+2] = fb; fieldBuf.data[bi+3] = 255;
          const [pr, pg, pb] = colormaps.phase(re, im, norm);
          phaseBuf.data[bi]   = pr; phaseBuf.data[bi+1] = pg;
          phaseBuf.data[bi+2] = pb; phaseBuf.data[bi+3] = 255;
          let rr, rg, rb;
          if (pl > 0 && dir > 0) {
            const pv = Math.sqrt(pl) * plateNorm;
            const plv = Math.log(1 + 9 * pv) * logS;
            [rr, rg, rb] = colormaps.hot(plv);
          } else {
            const rlv = Math.log(1 + 9 * amp) * logS;
            [rr, rg, rb] = colormaps.hot(rlv);
          }
          plateBuf.data[bi]   = rr; plateBuf.data[bi+1] = rg;
          plateBuf.data[bi+2] = rb; plateBuf.data[bi+3] = 255;
        }
      }
      fieldCell.ctx.putImageData(fieldBuf, 0, 0);
      phaseCell.ctx.putImageData(phaseBuf, 0, 0);
      plateCell.ctx.putImageData(plateBuf, 0, 0);

      _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow);

      const isRec  = dir === 1;
      const ml = document.getElementById(containerId + '-mode');
      if (ml) {
        ml.textContent  = isRec ? '● RECORDING' : '◎ RECONSTRUCTING';
        ml.style.color  = isRec ? '#9c4' : '#4af';
      }
      btnRecord.style.opacity = isRec ? '1' : '0.4';
      btnRecon.style.opacity  = isRec ? '0.4' : '1';

      const isActive = !!(n.slotActive_A || n.slotActive_B);
      title.style.color = isRec ? '#9c4' : '#4af';
      title.textContent =
        `PEER ${peerId} · HOLOGRAM4  IFS-Huygens  ` +
        (n.slotActive_A ? '[A]' : '') + (n.slotActive_B ? '[B]' : '');

      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `t=${(n.time ?? 0).toFixed(1)}  cyc=${n.cycleCount ?? 0}` +
        `  R=[${n.ifsRadiiStr ?? ''}]  s≈${(n.ifsSEff ?? 0).toFixed(2)}` +
        `  ${_clientBadge(world)}`;

      const energyA = n.slotEnergy_A ?? [], energyB = n.slotEnergy_B ?? [];
      const mergedEnergy = energyA.map((v, i) => Math.max(v, energyB[i] ?? 0));
      const mergedEvents = [...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])]
        .sort((a, b) => a.wt - b.wt).slice(-80);
      ifsClock.update({ energy: mergedEnergy, events: mergedEvents, isActive, lt });

      _renderAvatars(world, root);
    };

    let _rafId = null;
    const _rafLoop = () => { _renderFrame(); _rafId = requestAnimationFrame(_rafLoop); };
    _rafId = requestAnimationFrame(_rafLoop);

    return _renderFrame;
  };
}

export default {
  title:       'Hologram4 | IFS-Native Huygens Holography',
  selo:        'hologram4',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologram4WorldProgram + av],
  makeRenderer: makeHologram4Renderer,
  wrapId:      'hologram4-wrap',
  hideTopBar:  true,
};
