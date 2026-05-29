/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── INSTANTON HOLOGRAM | Topological Tunneling × IFS Holography ───────────────
//
// Records a topological instanton (Q=0 → Q=1 vacuum tunneling arc) onto a
// holographic plate, then reconstructs it — a hologram of a topological event.
//
// Physics:
//   Vacuum A  (Q=0)  — single bright soliton at centre
//   Vacuum B  (Q=+1) — three solitons with 2π/3 phase offsets
//   Instanton — vortex injection drives A→B tunneling; the arc is the instanton
//
// Holography:
//   RECORD mode  — NLS + IFS propagation; plate accumulates |ψ + ref|²
//   RECON  mode  — plate × conj(ref) seeds ψ; backward IFS steps refocus arc
//   Reference    — tilted plane wave REF_KX × x, native IFS propagated
//
// Controls:
//   Click canvas          → inject soliton at cursor
//   Right-click canvas    → inject vortex (triggers instanton)
//   [RECORD] / [RECON]    → toggle holographic mode
//   [RESET PLATE]         → clear plate, return to vacuum A
//   [Phase A] / [Phase B] → reset vacuum state
//   Dbl-click             → manual IFS next-cycle

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
const SUBTICK_MS   = 0.09;

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID    = 48;
const N_CELLS = GRID * GRID;

// ── NLS physical parameters ───────────────────────────────────────────────────
const WAVELENGTH  = 5.0;
const DELAY_SCALE = 0.06;
const GAMMA       = -0.25;   // focusing nonlinearity
const ISAT        = 20.0;
const DT          = 0.1;

// ── Holography parameters ─────────────────────────────────────────────────────
const REF_AMP     = 1.2;
const REF_KX      = 0.10;
const PLATE_DECAY = 0.992;
const SRC_ALPHA   = 0.0;    // no relaxation — pure NLS, instanton drives itself
const T_RECON     = 60;     // backward IFS steps per reconstruction burst
const RECON_STEP_DELAY = 50;
const RECON_HOLD_MS    = 1200;

// ── Soliton parameters ────────────────────────────────────────────────────────
const SOL_AMP = 1.0;
const SOL_W   = 2;
const SOL_V   = 1.0;

// ── IFS fractal clock ─────────────────────────────────────────────────────────
const IFS_DEPTH      = 4;
const IFS_MAPS       = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP    = 3;
const IFS_MIN_DELAY  = 0.25;
const IFS_BASE_DELAY = parseFloat((DELAY_SCALE * GRID * 0.35).toFixed(6));
const FRESNEL_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 8).toFixed(4));
const N_FRESNEL_ROOTS = 4;
const PHYS_STEPS      = 1;
const NEXT_STEP_DELAY = 1;

const FRAC_ALPHA    = 0.08;
const MAX_IFS_BANDS = 4;

// ── Render ────────────────────────────────────────────────────────────────────
const RENDER_SCALE = 5;

// ── World program ─────────────────────────────────────────────────────────────
const instantonHologramWorldProgram = `
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
  const PLATE_DECAY      = ${PLATE_DECAY};
  const SRC_ALPHA        = ${SRC_ALPHA};
  const T_RECON          = ${T_RECON};
  const RECON_STEP_DELAY = ${RECON_STEP_DELAY};
  const RECON_HOLD_MS    = ${RECON_HOLD_MS};
  const SOL_AMP          = ${SOL_AMP};
  const SOL_W            = ${SOL_W};
  const SOL_V            = ${SOL_V};
  const IFS_DEPTH        = ${IFS_DEPTH};
  const IFS_MAPS         = ${JSON.stringify(IFS_MAPS)};
  const IFS_GEN_CAP      = ${IFS_GEN_CAP};
  const IFS_MIN_DELAY    = ${IFS_MIN_DELAY};
  const IFS_BASE_DELAY   = ${IFS_BASE_DELAY};
  const FRESNEL_DONE_DELAY = ${FRESNEL_DONE_DELAY};
  const N_FRESNEL_ROOTS  = ${N_FRESNEL_ROOTS};
  const PHYS_STEPS       = ${PHYS_STEPS};
  const NEXT_STEP_DELAY  = ${NEXT_STEP_DELAY};
  const FRAC_ALPHA       = ${FRAC_ALPHA};
  const MAX_IFS_BANDS    = ${MAX_IFS_BANDS};
  const TWO_PI           = 2 * Math.PI;

  ${FRAG.nlsOps(GRID, N_CELLS)}
  ${FRAG.ifsStencil(GRID)}
  ${FRAG.ifsKernels}
  ${FRAG.topoOps(GRID, N_CELLS)}
  ${FRAG.ifsScheduler}

  // ── Vacuum states ─────────────────────────────────────────────────────────
  const _initVacuumA = () => {
    const cx = GRID/2, cy = GRID/2;
    let psi = new Float64Array(2 * NCELLS);
    psi = _addSoliton(psi, cx, cy, SOL_AMP * 1.4, 0, 0, SOL_W * 1.2, 0);
    return psi;
  };
  const _initVacuumB = () => {
    const cx = GRID/2, cy = GRID/2, r0 = GRID * 0.22;
    let psi = new Float64Array(2 * NCELLS);
    const pi23 = TWO_PI / 3;
    [
      { sx: cx,            sy: cy - r0,     vx: 0,         vy:  SOL_V,      ph0: 0       },
      { sx: cx - r0*0.866, sy: cy + r0*0.5, vx:  SOL_V*0.866, vy: -SOL_V*0.5, ph0: pi23 },
      { sx: cx + r0*0.866, sy: cy + r0*0.5, vx: -SOL_V*0.866, vy: -SOL_V*0.5, ph0: 2*pi23 },
    ].forEach(({ sx, sy, vx, vy, ph0 }) => {
      psi = _addSoliton(psi, sx, sy, SOL_AMP, vx, vy, SOL_W, ph0);
    });
    return psi;
  };

  // ── Reference wave: static tilted plane wave, guaranteed amplitude REF_AMP ─
  const _buildRef = () => {
    const psi = new Float64Array(2 * NCELLS);
    for (let j = 0; j < NCELLS; j++) {
      const x = j % GRID;
      psi[j*2]   = REF_AMP * Math.cos(REF_KX * x);
      psi[j*2+1] = REF_AMP * Math.sin(REF_KX * x);
    }
    return psi;
  };

  // ── Build reconstruction seed: plate × conj(ref) ─────────────────────────
  const _buildReconSeed = (plate, refField) => {
    const psi  = new Float64Array(2 * NCELLS);
    let maxP = 1e-9;
    for (let j = 0; j < NCELLS; j++) if (plate[j] > maxP) maxP = plate[j];
    const norm = 1 / maxP;
    for (let j = 0; j < NCELLS; j++) {
      const fringe = plate[j] * norm;
      const rfRe = refField[j*2], rfIm = -refField[j*2+1]; // conjugate
      const mag = Math.sqrt(rfRe*rfRe + rfIm*rfIm) + 1e-12;
      psi[j*2]   = fringe * rfRe / mag;
      psi[j*2+1] = fringe * rfIm / mag;
    }
    return psi;
  };

  // ── IFS slot launcher ────────────────────────────────────────────────────
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
    return { ...s,
      cycleCount: (s.cycleCount ?? 0) + 1,
      ['slotId_'     + slot]: cycleId,
      ['slotKernel_' + slot]: [],
      ['slotEnergy_' + slot]: new Array(IFS_DEPTH).fill(0),
      ['slotEvents_' + slot]: [],
      ['slotActive_' + slot]: true,
    };
  };

  const instantonHologram = Behaviors.collect(
    {
      psi:        new Float64Array(2 * ${N_CELLS}),
      plate:      new Float32Array(${N_CELLS}),
      refField:   null,
      time:       0,
      power0:     1,
      cycleCount: 0,
      vacuumState: 'A',
      direction:  1,   // +1 = RECORD, -1 = RECON
      pendingInject: null,
      slotId_A: -1, slotActive_A: false,
      slotKernel_A: [], slotEnergy_A: new Array(${IFS_DEPTH}).fill(0), slotEvents_A: [],
      slotId_B: -2, slotActive_B: false,
      slotKernel_B: [], slotEnergy_B: new Array(${IFS_DEPTH}).fill(0), slotEvents_B: [],
      cachedRadii: [], cachedWeights: [], cachedOffsets: [],
      ifsNBands: 0, ifsRadiiStr: '', ifsSEff: 0,
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (['injectSoliton','injectVortex','nextCycle','setVacuumA','setVacuumB',
             'toggleMode','resetPlate'].includes(t)) {
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} }, ...(s._queue ?? [])] };
        }
      }
      return W.reduce(s, pulse, 'instantonHologram', {

        __macro: (s, p, ctx) => {
          if (p.isSubTick) return s;
          if (p.logicalTime === 1) {
            ctx.future(100, '_keepalive', {});
            const psi    = _initVacuumA();
            const power0 = _power(psi);
            let s2 = _launchSlot({ ...s, psi, power0, vacuumState: 'A' }, ctx, 'A', p.logicalTime);
            ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2), '_launchB', { cycleId: p.logicalTime + 1 });
            return s2;
          }
          return s;
        },

        _keepalive: (s, p, ctx) => { ctx.future(100, '_keepalive', {}); return s; },

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
          const d = dir ?? 1;
          let psi;
          if (d > 0) {
            // RECORD: full symplectic NLS step (focusing nonlinearity active)
            const psi_nl  = _nlHalf(s.psi, DT * 0.5);
            const psi_lin = _linearStepIFS(psi_nl, DT, fRadii, fWeights, fOffs);
            psi = _nlHalf(psi_lin, DT * 0.5);
          } else {
            // RECON: linear-only backward step — no nonlinearity, pure wave replay
            psi = _linearStepIFS(s.psi, -DT, fRadii, fWeights, fOffs);
          }

          // Update plate in RECORD mode
          let plate = s.plate;
          if (d > 0 && s.refField) {
            const newPlate = new Float32Array(plate);
            for (let j = 0; j < NCELLS; j++) {
              const re = psi[j*2]   + s.refField[j*2];
              const im = psi[j*2+1] + s.refField[j*2+1];
              newPlate[j] = newPlate[j] * PLATE_DECAY + (re*re + im*im);
            }
            plate = newPlate;
          }

          const stepsLeft = (p.stepsLeft ?? 1) - 1;
          if (stepsLeft > 0) {
            ctx.future(d < 0 ? RECON_STEP_DELAY : 0, '_physStep', { stepsLeft, fRadii, fWeights, fOffs, dir: d });
          } else if (d > 0 && s.cachedRadii.length > 0) {
            ctx.future(NEXT_STEP_DELAY, '_physStep', {
              stepsLeft: PHYS_STEPS, fRadii: s.cachedRadii,
              fWeights: s.cachedWeights, fOffs: s.cachedOffsets, dir: 1,
            });
          } else if (d < 0 && s.cachedRadii.length > 0) {
            ctx.future(RECON_HOLD_MS, '_reconLoop', {});
          }
          return { ...s, psi, plate, time: (s.time ?? 0) + DT };
        },

        _reconLoop: (s, p, ctx) => {
          if ((s.direction ?? 1) >= 0 || !s.plate || !s.refField || !s.cachedRadii.length) return s;
          const psi = _buildReconSeed(s.plate, s.refField);
          ctx.future(0, '_physStep', {
            stepsLeft: T_RECON, fRadii: s.cachedRadii,
            fWeights: s.cachedWeights, fOffs: s.cachedOffsets, dir: -1,
          });
          return { ...s, psi };
        },

        fresnelBeat: (s, p, ctx) => {
          const slot = p.slot ?? 'A';
          if (p.cycleId !== s['slotId_' + slot]) return s;
          _ifsFireChildren(ctx, p, 'fresnelBeat', 'fresnelBeat');
          const ri = Math.max(1, Math.round(p.delay / DELAY_SCALE));
          const kernel = s['slotKernel_' + slot] ?? [];
          const newKernel = ri < (GRID >> 1) ? [...kernel, ri] : kernel;
          const energy = (s['slotEnergy_' + slot] ?? new Array(IFS_DEPTH).fill(0)).slice();
          energy[p.depth] = Math.min(1, (energy[p.depth] ?? 0) + 0.3);
          const events = [...(s['slotEvents_' + slot] ?? []).slice(-80),
            { d: p.depth, delay: p.delay, wt: ctx.wallTime }];
          return { ...s,
            ['slotKernel_' + slot]: newKernel,
            ['slotEnergy_' + slot]: energy,
            ['slotEvents_' + slot]: events,
          };
        },

        finalizeFresnelm: (s, p, ctx) => {
          const slot = p.slot ?? 'A';
          if (p.cycleId !== s['slotId_' + slot]) return s;
          const { fRadii, fWeights, sEff } = _buildNativeKernel(
            s['slotKernel_' + slot] ?? [], FRAC_ALPHA, MAX_IFS_BANDS);
          const fOffs = _buildRingOffsets(fRadii);

          // Build reference wave on first kernel
          const refField = s.refField ?? (fRadii.length ? _buildRef() : null);

          // Apply pending inject
          let psi = s.psi;
          const inj = s.pendingInject;
          if (inj?.kind === 'soliton')
            psi = _addSoliton(psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w, 0);
          else if (inj?.kind === 'vortex')
            psi = _addVortex(psi, inj.ox, inj.oy, inj.charge);

          if (!s.cachedRadii.length) {
            ctx.future(0, '_physStep', {
              stepsLeft: PHYS_STEPS, fRadii, fWeights, fOffs,
              dir: s.direction ?? 1,
            });
          }
          const nextSlot    = slot === 'A' ? 'B' : 'A';
          const nextCycleId = p.cycleId + 2;
          if (!s['slotActive_' + nextSlot]) {
            ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2),
              '_launch' + nextSlot, { cycleId: nextCycleId });
          }
          const vacuumState = inj?.kind === 'vortex' ? 'tunneling' : s.vacuumState;
          return { ...s, psi, refField,
            ['slotActive_' + slot]: false,
            ['slotKernel_' + slot]: [],
            cachedRadii: fRadii, cachedWeights: fWeights, cachedOffsets: fOffs,
            pendingInject: null, vacuumState,
            ifsNBands: fRadii.length, ifsRadiiStr: fRadii.join(','), ifsSEff: sEff,
          };
        },

        nextCycle: (s, p, ctx) => {
          if (s.slotActive_A && s.slotActive_B) return s;
          const slot = !s.slotActive_A ? 'A' : 'B';
          return _launchSlot(s, ctx, slot, ctx.wallTime + 1);
        },

        injectSoliton: (s, p, ctx) => {
          const inj = { kind: 'soliton', sx: p.sx, sy: p.sy,
            amp: p.amp ?? SOL_AMP, vx: p.vx ?? 0, vy: p.vy ?? 0, w: p.w ?? SOL_W };
          if (s.slotActive_A || s.slotActive_B) return { ...s, pendingInject: inj };
          const psi = _addSoliton(s.psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w, 0);
          return { ...s, psi, power0: _power(psi), pendingInject: null };
        },

        injectVortex: (s, p, ctx) => {
          // Vortex injection is the instanton event — transitions Q=0 → Q=1
          const inj = { kind: 'vortex', ox: p.ox, oy: p.oy, charge: p.charge ?? 1 };
          if (s.slotActive_A || s.slotActive_B) return { ...s, pendingInject: inj };
          const psi = _addVortex(s.psi, inj.ox, inj.oy, inj.charge);
          return { ...s, psi, power0: _power(psi),
            vacuumState: 'tunneling', pendingInject: null };
        },

        toggleMode: (s, p, ctx) => {
          const newDir = (s.direction ?? 1) === 1 ? -1 : 1;
          let psi = s.psi;
          if (newDir === -1 && s.plate && s.refField && s.cachedRadii.length) {
            psi = _buildReconSeed(s.plate, s.refField);
            ctx.future(0, '_physStep', {
              stepsLeft: T_RECON, fRadii: s.cachedRadii,
              fWeights: s.cachedWeights, fOffs: s.cachedOffsets, dir: -1,
            });
          } else if (newDir === 1) {
            psi = _initVacuumA();
            ctx.future(0, '_physStep', {
              stepsLeft: PHYS_STEPS, fRadii: s.cachedRadii,
              fWeights: s.cachedWeights, fOffs: s.cachedOffsets, dir: 1,
            });
          }
          return { ...s, direction: newDir, psi, vacuumState: newDir === 1 ? 'A' : s.vacuumState };
        },

        resetPlate: (s, p, ctx) => {
          const psi = _initVacuumA();
          return { ...s,
            psi, plate: new Float32Array(${N_CELLS}),
            time: 0, direction: 1, vacuumState: 'A', pendingInject: null,
          };
        },

        setVacuumA: (s, p, ctx) => {
          const psi = _initVacuumA();
          return { ...s, psi, power0: _power(psi), vacuumState: 'A', pendingInject: null };
        },
        setVacuumB: (s, p, ctx) => {
          const psi = _initVacuumB();
          return { ...s, psi, power0: _power(psi), vacuumState: 'B', pendingInject: null };
        },

      });
    }
  );

  const _isStable = W.stable([instantonHologram], reflector);
  const _export   = W.export(Renkon, { instantonHologram }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeInstantonHologramRenderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  const _topoCharge = (psi) => {
    const q   = new Float32Array(N_CELLS);
    const PI2 = 2 * Math.PI;
    const wrap = (d) => { while (d > Math.PI) d -= PI2; while (d < -Math.PI) d += PI2; return d; };
    const ph = (py, px) => {
      const id = py * GRID + px;
      if (psi[id*2]*psi[id*2] + psi[id*2+1]*psi[id*2+1] < 0.01) return 0;
      return Math.atan2(psi[id*2+1], psi[id*2]);
    };
    for (let y = 0; y < GRID - 1; y++) {
      for (let x = 0; x < GRID - 1; x++) {
        const dph = wrap(ph(y,x+1) - ph(y,x)) + wrap(ph(y+1,x+1) - ph(y,x+1)) +
                    wrap(ph(y+1,x) - ph(y+1,x+1)) + wrap(ph(y,x) - ph(y+1,x));
        q[y * GRID + x] = dph / PI2;
      }
    }
    return q;
  };

  return (world, peerId, containerId, sendCursorMove, _injectRaw) => {
    const injectEvent = _injectRaw ? (ev) => setTimeout(() => _injectRaw(ev), 0) : undefined;

    if (!document.getElementById('instanton-hologram-wrap')) {
      const wrap = document.createElement('div');
      wrap.id = 'instanton-hologram-wrap';
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
    document.getElementById('instanton-hologram-wrap').appendChild(root);

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

    const RW = GRID * RENDER_SCALE;
    const RH = GRID * RENDER_SCALE;

    const makeDataCell = (label, color) => {
      const wrap   = document.createElement('div');
      Object.assign(wrap.style, { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column' });
      const lbl    = document.createElement('div');
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
      return { wrap, canvas, ctx: canvas.getContext('2d'), lbl };
    };

    const intCell    = makeDataCell('NLS WAVEFRONT  |ψ|²  (click=soliton  right-click=vortex/instanton)', '#f84');
    const phaseCell  = makeDataCell('PHASE  arg(ψ)  +  topo charge', '#4af');
    const plateCell  = makeDataCell('HOLOGRAM PLATE  |ψ+ref|²', '#8f4');
    canvasCol.appendChild(intCell.wrap);
    canvasCol.appendChild(phaseCell.wrap);
    canvasCol.appendChild(plateCell.wrap);

    const intBuf   = intCell.ctx.createImageData(RW, RH);
    const phaseBuf = phaseCell.ctx.createImageData(RW, RH);
    const plateBuf = plateCell.ctx.createImageData(RW, RH);

    // Precompute bilinear tables
    const _bx0 = new Int32Array(RW), _bx1 = new Int32Array(RW);
    const _btx = new Float32Array(RW), _btx1 = new Float32Array(RW);
    for (let rx = 0; rx < RW; rx++) {
      const fx = (rx + 0.5) / RENDER_SCALE - 0.5;
      const x0 = Math.floor(fx);
      _bx0[rx] = Math.max(0, Math.min(GRID-1, x0));
      _bx1[rx] = Math.max(0, Math.min(GRID-1, x0+1));
      _btx[rx] = fx - x0; _btx1[rx] = 1 - _btx[rx];
    }
    const _by0 = new Int32Array(RH), _by1 = new Int32Array(RH);
    const _bty = new Float32Array(RH), _bty1 = new Float32Array(RH);
    for (let ry = 0; ry < RH; ry++) {
      const fy = (ry + 0.5) / RENDER_SCALE - 0.5;
      const y0 = Math.floor(fy);
      _by0[ry] = Math.max(0, Math.min(GRID-1, y0));
      _by1[ry] = Math.max(0, Math.min(GRID-1, y0+1));
      _bty[ry] = fy - y0; _bty1[ry] = 1 - _bty[ry];
    }

    let _smoothMaxI = 0, _smoothMaxPlate = 0;

    // ── Clock column ──────────────────────────────────────────────────────────
    const clockCol = document.createElement('div');
    Object.assign(clockCol.style, {
      flexShrink: '0', width: '130px', display: 'flex', flexDirection: 'column',
      padding: '10px 8px', boxSizing: 'border-box', gap: '6px', overflow: 'hidden',
    });
    main.appendChild(clockCol);

    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize: '7px', fontWeight: 'bold', letterSpacing: '0.5px',
      color: '#0d6', textAlign: 'center', lineHeight: '1.4',
      height: '3em', overflow: 'hidden', flexShrink: '0',
    });
    clockCol.appendChild(title);

    const ifsClock = makeIFSClockPanel({ label: 'FRESNEL IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    clockCol.appendChild(ifsClock.el);

    const mkBtn = (label, bg, fg, handler) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: bg, color: fg ?? '#000', border: 'none', borderRadius: '4px',
        padding: '4px 0', fontSize: '8px', cursor: 'pointer', width: '100%',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold', touchAction: 'manipulation',
      });
      b.addEventListener('click', handler);
      b.addEventListener('touchend', (e) => { e.preventDefault(); handler(e); }, { passive: false });
      return b;
    };

    const btnRecord = mkBtn('● RECORD',       '#9c4', '#000', () => {
      if ((world.getNodeState('instantonHologram')?.direction ?? 1) !== 1)
        injectEvent?.({ type: 'toggleMode' });
    });
    const btnRecon  = mkBtn('◎ RECONSTRUCT',  '#4af', '#000', () => {
      if ((world.getNodeState('instantonHologram')?.direction ?? 1) !== -1)
        injectEvent?.({ type: 'toggleMode' });
    });
    const btnReset  = mkBtn('↺ RESET PLATE',  '#333', '#aaa', () => injectEvent?.({ type: 'resetPlate' }));
    const btnA      = mkBtn('Phase A  Q=0',   '#0d6', '#000', () => injectEvent?.({ type: 'setVacuumA' }));
    const btnB      = mkBtn('Phase B  Q=+1',  '#f50', '#000', () => injectEvent?.({ type: 'setVacuumB' }));
    clockCol.appendChild(btnRecord);
    clockCol.appendChild(btnRecon);
    clockCol.appendChild(btnReset);
    clockCol.appendChild(btnA);
    clockCol.appendChild(btnB);

    const modeLbl = document.createElement('div');
    Object.assign(modeLbl.style, { fontSize: '9px', fontWeight: 'bold', textAlign: 'center', color: '#9c4' });
    clockCol.appendChild(modeLbl);

    const tunnelLbl = document.createElement('div');
    Object.assign(tunnelLbl.style, { fontSize: '8px', textAlign: 'center', color: '#555' });
    tunnelLbl.textContent = '← instanton →';
    clockCol.appendChild(tunnelLbl);

    const windingLbl = document.createElement('div');
    Object.assign(windingLbl.style, { fontSize: '11px', fontWeight: 'bold', color: '#888', textAlign: 'center' });
    clockCol.appendChild(windingLbl);

    const stats = document.createElement('div');
    Object.assign(stats.style, { fontSize: '7px', color: '#444', lineHeight: '1.6', overflow: 'hidden' });
    clockCol.appendChild(stats);

    // ── Canvas interaction ────────────────────────────────────────────────────
    const _canvasCoords = (canvas, e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.changedTouches?.length ? e.changedTouches[0].clientX : e.clientX;
      const cy = e.changedTouches?.length ? e.changedTouches[0].clientY : e.clientY;
      return [
        Math.floor((cx - rect.left) / rect.width  * GRID),
        Math.floor((cy - rect.top)  / rect.height * GRID),
      ];
    };

    [intCell.canvas, phaseCell.canvas, plateCell.canvas].forEach(c => {
      c.addEventListener('click', (e) => {
        const [sx, sy] = _canvasCoords(c, e);
        if (sx >= 0 && sx < GRID && sy >= 0 && sy < GRID)
          injectEvent?.({ type: 'injectSoliton', sx, sy, vx: 0, vy: 0 });
      });
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const [ox, oy] = _canvasCoords(c, e);
        if (ox >= 0 && ox < GRID && oy >= 0 && oy < GRID)
          injectEvent?.({ type: 'injectVortex', ox, oy, charge: 1 });
      });
      c.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));
    });

    // ── Render loop ───────────────────────────────────────────────────────────
    const LOG_K = 9;
    const logS  = 1 / Math.log(1 + LOG_K);

    const _renderFrame = () => {
      const n = world.getNodeState('instantonHologram');
      if (!n?.psi) return;

      const psi   = n.psi;
      const plate = n.plate;
      const dir   = n.direction ?? 1;
      const lt    = world.ps.app.logicalTime ?? 0;

      let maxI = 1e-9;
      for (let j = 0; j < N_CELLS; j++) {
        const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
        if (v > maxI) maxI = v;
      }
      _smoothMaxI = _smoothMaxI < 1e-9 ? maxI : _smoothMaxI * 0.96 + maxI * 0.04;
      const norm = 1 / Math.sqrt(_smoothMaxI);

      let maxP = 1e-9;
      if (plate) {
        for (let j = 0; j < N_CELLS; j++) if (plate[j] > maxP) maxP = plate[j];
        _smoothMaxPlate = _smoothMaxPlate < 1e-9 ? maxP : _smoothMaxPlate * 0.96 + maxP * 0.04;
      }
      const plateNorm = 1 / Math.sqrt(_smoothMaxPlate);

      // Topo charge for phase canvas overlay
      const qField = _topoCharge(psi);

      for (let ry = 0; ry < RH; ry++) {
        const cy0 = _by0[ry], cy1 = _by1[ry], ty1 = _bty1[ry], ty = _bty[ry];
        for (let rx = 0; rx < RW; rx++) {
          const cx0 = _bx0[rx], cx1 = _bx1[rx], tx1 = _btx1[rx], tx = _btx[rx];
          const j00 = cy0*GRID+cx0, j10 = cy0*GRID+cx1;
          const j01 = cy1*GRID+cx0, j11 = cy1*GRID+cx1;
          const w00 = tx1*ty1, w10 = tx*ty1, w01 = tx1*ty, w11 = tx*ty;
          const bi  = (ry*RW+rx)*4;

          const re = psi[j00*2]*w00 + psi[j10*2]*w10 + psi[j01*2]*w01 + psi[j11*2]*w11;
          const im = psi[j00*2+1]*w00 + psi[j10*2+1]*w10 + psi[j01*2+1]*w01 + psi[j11*2+1]*w11;
          const amp = Math.sqrt(re*re + im*im) * norm;
          const lv  = Math.log(1 + LOG_K * amp) * logS;
          const [r, g, b] = colormaps.hot(lv);
          intBuf.data[bi] = r; intBuf.data[bi+1] = g;
          intBuf.data[bi+2] = b; intBuf.data[bi+3] = 255;

          // Phase canvas: phase hue + topo charge glow
          const [pr, pg, pb] = colormaps.phase(re, im, norm);
          const q = qField[j00]*w00 + qField[j10]*w10 + qField[j01]*w01 + qField[j11]*w11;
          const qv = Math.min(1, Math.abs(q) * 3);
          const qr = q > 0 ? 255 : 0, qb = q < 0 ? 255 : 0;
          phaseBuf.data[bi]   = Math.round(pr*(1-qv) + qr*qv);
          phaseBuf.data[bi+1] = Math.round(pg*(1-qv));
          phaseBuf.data[bi+2] = Math.round(pb*(1-qv) + qb*qv);
          phaseBuf.data[bi+3] = 255;

          // Plate canvas
          const pl = plate ? (plate[j00]*w00 + plate[j10]*w10 + plate[j01]*w01 + plate[j11]*w11) : 0;
          const plv = Math.log(1 + LOG_K * Math.sqrt(pl) * plateNorm) * logS;
          const [rr, rg, rb] = colormaps.hologram(plv);
          plateBuf.data[bi] = rr; plateBuf.data[bi+1] = rg;
          plateBuf.data[bi+2] = rb; plateBuf.data[bi+3] = 255;
        }
      }
      intCell.ctx.putImageData(intBuf, 0, 0);
      phaseCell.ctx.putImageData(phaseBuf, 0, 0);
      plateCell.ctx.putImageData(plateBuf, 0, 0);

      const isRec = dir === 1;
      const vs    = n.vacuumState ?? 'A';
      const isActive = !!(n.slotActive_A || n.slotActive_B);

      modeLbl.textContent = isRec ? '● RECORDING' : '◎ RECONSTRUCTING';
      modeLbl.style.color = isRec ? '#9c4' : '#4af';
      btnRecord.style.opacity = isRec ? '1' : '0.4';
      btnRecon.style.opacity  = isRec ? '0.4' : '1';
      plateCell.lbl.textContent = isRec
        ? 'HOLOGRAM PLATE  |ψ+ref|²  accumulating instanton'
        : 'HOLOGRAM PLATE  |ψ+ref|²  (frozen — reconstructing)';

      tunnelLbl.style.color = vs === 'tunneling' ? '#f80' : '#555';
      tunnelLbl.textContent = vs === 'tunneling' ? '⟿  TUNNELING  ⟿' : '← instanton →';

      let Q = 0;
      for (let i = 0; i < N_CELLS; i++) if (Math.abs(qField[i]) > 0.4) Q += Math.round(qField[i]);
      windingLbl.style.color = Q !== 0 ? '#f80' : '#555';
      windingLbl.textContent = 'Q=' + (Q >= 0 ? '+' : '') + Q;

      title.style.color = vs === 'tunneling' ? '#f80' : (isRec ? '#9c4' : '#4af');
      title.textContent = 'PEER ' + peerId + ' · INSTANTON HOL  s≈' + (n.ifsSEff ?? 0).toFixed(3) +
        '  ' + (n.slotActive_A ? '[A]' : '') + (n.slotActive_B ? '[B]' : '');

      const energyA = n.slotEnergy_A ?? [], energyB = n.slotEnergy_B ?? [];
      const mergedEnergy = energyA.map((v, i) => Math.max(v, energyB[i] ?? 0));
      const mergedEvents = [...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])]
        .sort((a, b) => a.wt - b.wt).slice(-80);
      ifsClock.update({ energy: mergedEnergy, events: mergedEvents, isActive, lt });

      stats.textContent = 't=' + (n.time ?? 0).toFixed(1) +
        '  cyc=' + (n.cycleCount ?? 0) + '  R=[' + (n.ifsRadiiStr ?? '') + ']';

      _renderAvatars(world, root);
    };

    let _lastRenderMs = 0;
    const _rafLoop = (ts) => {
      requestAnimationFrame(_rafLoop);
      if (ts - _lastRenderMs < 33) return;
      _lastRenderMs = ts;
      _renderFrame();
    };
    requestAnimationFrame(_rafLoop);

    return _renderFrame;
  };
}

export default {
  title:       'Instanton Hologram | Topological Tunneling × IFS Holography',
  selo:        'instanton_hologram',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [instantonHologramWorldProgram + av],
  makeRenderer: makeInstantonHologramRenderer,
  wrapId:      'instanton-hologram-wrap',
  hideTopBar:  true,
};
