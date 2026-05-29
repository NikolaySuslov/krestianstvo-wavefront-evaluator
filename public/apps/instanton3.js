/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── INSTANTON3 | IFS-Native Laplacian — Topological Tunneling ────────────────
//
// Same topological physics as instanton2.js but uses the IFS-native Laplacian
// from nls3.js: no external Riesz kernel K(r)=1/r^{2s} is imposed. Instead the
// IFS empirical measure (visit-count per radius) defines kernel weights directly:
//
//   w(r) = FRAC_ALPHA × count(r) / totalBeats
//
// The fractional order s is NOT a free parameter — it emerges from the IFS
// contraction geometry {0.309, 0.414, 0.5, 0.618, 0.707, 0.732} each cycle.
// s_eff is estimated from the log-log slope of w(r) vs r and displayed live.
//
// Two topological vacuum states of the 2D focusing NLS field:
//   Phase A  (Q = 0)  — single bright soliton at centre, stable.
//   Phase B  (Q = ±1) — three solitons with 2π/3 relative phase offsets.
//
// Controls:
//   Click  intensity / charge canvas → inject vortex (+1) at cursor (replicated)
//   Right-click                      → inject anti-vortex (−1)
//   [Phase A] / [Phase B] buttons    → reset vacuum state (replicated)
//   Double-click                     → manual next cycle (replicated)

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
const SUBTICK_MS   = 0.09;

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID    = 42;
const N_CELLS = GRID * GRID;

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH  = 5.0;
const DELAY_SCALE = 0.06;
const GAMMA       = -0.25;
const ISAT        = 20.0;     // saturation intensity (prevents 2D wave collapse)
const DT          = 0.1;

// ── Soliton parameters ────────────────────────────────────────────────────────
const SOL_AMP = 1.0;
const SOL_W   = 2;
const SOL_V   = 1.0;

// ── Topological parameters ────────────────────────────────────────────────────
const AUTO_INJECT_AT = 12;   // auto-inject instanton after this many cycles

// ── IFS fractal clock ─────────────────────────────────────────────────────────
const IFS_DEPTH      = 4;
const IFS_MAPS       = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP    = 3;
const IFS_MIN_DELAY  = 0.25;
const IFS_BASE_DELAY = parseFloat((DELAY_SCALE * GRID * 0.35).toFixed(6));
const FRESNEL_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 8).toFixed(4));
const N_FRESNEL_ROOTS  = 4;
const CYCLE            = 16;
const PHYS_STEPS       = 1;
const NEXT_STEP_DELAY  = 1;
const LOD              = [1, 1, 1, 1];

// ── IFS-native Laplacian coupling ────────────────────────────────────────────
const FRAC_ALPHA    = 0.08;
const MAX_IFS_BANDS = 4;   // cap kernel bands for Safari JIT performance

// ── Render ────────────────────────────────────────────────────────────────────
const RENDER_SCALE = 4;

// ── World program ─────────────────────────────────────────────────────────────
const instanton3WorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const GRID             = ${GRID};
  const NCELLS           = ${N_CELLS};
  const WAVELENGTH       = ${WAVELENGTH};
  const DELAY_SCALE      = ${DELAY_SCALE};
  const GAMMA            = ${GAMMA};
  const ISAT             = ${ISAT};
  const DT               = ${DT};
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
  const CYCLE            = ${CYCLE};
  const PHYS_STEPS       = ${PHYS_STEPS};
  const NEXT_STEP_DELAY  = ${NEXT_STEP_DELAY};
  const LOD              = ${JSON.stringify(LOD)};
  const FRAC_ALPHA       = ${FRAC_ALPHA};
  const MAX_IFS_BANDS    = ${MAX_IFS_BANDS};
  const TWO_PI           = 2 * Math.PI;
  const AUTO_INJECT_AT   = ${AUTO_INJECT_AT};


  ${FRAG.nlsOps(GRID, N_CELLS)}
  ${FRAG.ifsStencil(GRID)}
  ${FRAG.ifsKernels}
  ${FRAG.specCorr(GRID, N_CELLS, IFS_DEPTH)}
  ${FRAG.topoOps(GRID, N_CELLS)}
  ${FRAG.ifsScheduler}

  // ── Vacuum A: Q=0 — single bright soliton ────────────────────────────────
  const _initVacuumA = () => {
    const cx = GRID/2, cy = GRID/2;
    let psi = new Float64Array(2 * NCELLS);
    psi = _addSoliton(psi, cx, cy, SOL_AMP * 1.4, 0, 0, SOL_W * 1.2, 0);
    return psi;
  };

  // ── Vacuum B: Q=±sign — 2π/3 relative phase offsets give net winding ─────
  const _initVacuumB = (sign) => {
    const cx = GRID/2, cy = GRID/2, r0 = GRID * 0.22;
    let psi = new Float64Array(2 * NCELLS);
    const v = SOL_V, pi23 = TWO_PI / 3;
    [
      { sx: cx,             sy: cy - r0,     vx: 0,        vy:  v,      ph0: 0              },
      { sx: cx - r0*0.866,  sy: cy + r0*0.5, vx:  v*0.866, vy: -v*0.5, ph0: sign * pi23    },
      { sx: cx + r0*0.866,  sy: cy + r0*0.5, vx: -v*0.866, vy: -v*0.5, ph0: sign * 2*pi23  },
    ].forEach(({ sx, sy, vx, vy, ph0 }) => {
      psi = _addSoliton(psi, sx, sy, SOL_AMP, vx, vy, SOL_W, ph0);
    });
    return psi;
  };

  // Launch one IFS slot (A or B).
  const _launchSlot = (s, ctx, slot, cycleId) => {
    const psi_nl   = _nlHalf(s.psi, DT * 0.5);
    const power_nl = _power(psi_nl);
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
    ctx.future(FRESNEL_DONE_DELAY, 'finalizeFresnelm', { cycleId, slot, power_nl });
    return {
      ...s,
      ['slotPsiNl_'  + slot]: psi_nl,
      ['slotPowerNl_'+ slot]: power_nl,
      cycleCount: (s.cycleCount ?? 0) + 1,
      ['slotId_'     + slot]: cycleId,
      ['slotKernel_' + slot]: [],
      ['slotEnergy_' + slot]: new Array(IFS_DEPTH).fill(0),
      ['slotEvents_' + slot]: [],
      ['slotPhase_'  + slot]: new Array(IFS_DEPTH).fill(null),
      ['slotActive_' + slot]: true,
    };
  };

  const instanton3 = Behaviors.collect(
    {
      psi:      new Float64Array(2 * ${N_CELLS}),
      time:     0,
      power0:   1,
      cycleCount: 0,
      vacuumState: 'A',
      autoInjected: false,
      // Dual-slot IFS overlap — A and B staggered by FRESNEL_DONE_DELAY/2
      slotId_A: -1, slotActive_A: false, slotPsiNl_A: null, slotPowerNl_A: 1,
      slotKernel_A: [], slotEnergy_A: new Array(${IFS_DEPTH}).fill(0),
      slotEvents_A: [], slotPhase_A:  new Array(${IFS_DEPTH}).fill(null),
      slotId_B: -2, slotActive_B: false, slotPsiNl_B: null, slotPowerNl_B: 1,
      slotKernel_B: [], slotEnergy_B: new Array(${IFS_DEPTH}).fill(0),
      slotEvents_B: [], slotPhase_B:  new Array(${IFS_DEPTH}).fill(null),
      // Current finalized kernel
      cachedRadii: [],
      cachedWeights: [],
      cachedOffsets: [],
      ifsNBands: 0,
      ifsRadiiStr: '',
      ifsWeightsStr: '',
      ifsSEff: 0,
      specCorr: new Array(${IFS_DEPTH}).fill(0),
      specN:    new Array(${IFS_DEPTH}).fill(0),
      _queue: [],
      pendingInject: null,
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (['injectSoliton','injectVortex','nextCycle','setVacuumA','setVacuumB'].includes(t)) {
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} }, ...(s._queue ?? [])] };
        }
      }
      return W.reduce(s, pulse, 'instanton3', {

        __macro: (s, p, ctx) => {
          if (p.isSubTick) return s;
          const tick = p.logicalTime;
          if (tick === 1) {
            ctx.future(100, '_keepalive', {});
            const psi    = _initVacuumA();
            const power0 = _power(psi);
            let s2 = _launchSlot({ ...s, psi, power0, vacuumState: 'A', autoInjected: false }, ctx, 'A', tick);
            ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2), '_launchB', { cycleId: tick + 1 });
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
          const { fRadii, fWeights, fOffs } = p;
          if (!fRadii || !fRadii.length || !s.psi) return s;
          const pIn     = _power(s.psi);
          const psi_nl  = _nlHalf(s.psi, DT * 0.5);
          const psi_lin = _linearStepIFS(psi_nl, DT, fRadii, fWeights, fOffs);
          const stepped = _nlHalf(psi_lin, DT * 0.5);
          const pNew    = _power(stepped);
          const scale   = pNew > 1e-9 ? Math.sqrt(pIn / pNew) : 1;
          const psi     = new Float64Array(stepped);
          for (let j = 0; j < NCELLS; j++) { psi[j*2] *= scale; psi[j*2+1] *= scale; }
          const stepsLeft = (p.stepsLeft ?? 1) - 1;
          if (stepsLeft > 0) {
            ctx.future(0, '_physStep', { stepsLeft, fRadii, fWeights, fOffs });
          } else if (s.cachedRadii.length > 0) {
            ctx.future(NEXT_STEP_DELAY, '_physStep', { stepsLeft: PHYS_STEPS, fRadii: s.cachedRadii, fWeights: s.cachedWeights, fOffs: s.cachedOffsets });
          }
          return { ...s, psi, time: (s.time ?? 0) + DT };
        },

        fresnelBeat: (s, p, ctx) => {
          const slot = p.slot ?? 'A';
          if (p.cycleId !== s['slotId_' + slot]) return s;
          const { depth, delay } = p;
          _ifsFireChildren(ctx, p, 'fresnelBeat', 'fresnelBeat');
          const ri = Math.max(1, Math.round(delay / DELAY_SCALE));
          const kernel = s['slotKernel_' + slot] ?? [];
          const newKernel = ri < (GRID >> 1) ? [...kernel, ri] : kernel;
          const energy = (s['slotEnergy_' + slot] ?? new Array(IFS_DEPTH).fill(0)).slice();
          energy[depth] = Math.min(1, (energy[depth] ?? 0) + 0.3);
          const events = [...(s['slotEvents_' + slot] ?? []).slice(-80),
            { d: depth, delay, wt: ctx.wallTime }];
          const phase = (s['slotPhase_' + slot] ?? new Array(IFS_DEPTH).fill(null)).slice();
          phase[depth] = { phase: (ctx.wallTime / delay) % 1, delay };
          return { ...s,
            ['slotKernel_' + slot]: newKernel,
            ['slotEnergy_' + slot]: energy,
            ['slotEvents_' + slot]: events,
            ['slotPhase_'  + slot]: phase,
          };
        },

        finalizeFresnelm: (s, p, ctx) => {
          const slot   = p.slot ?? 'A';
          if (p.cycleId !== s['slotId_' + slot]) return s;
          const psi_nl = s['slotPsiNl_' + slot];
          if (!psi_nl) return s;
          const { fRadii, fWeights, sEff } = _buildNativeKernel(s['slotKernel_' + slot] ?? [], FRAC_ALPHA, MAX_IFS_BANDS);
          const fOffs = _buildRingOffsets(fRadii);
          const specCorr = _computeSpecCorr(psi_nl);
          // Apply pending injection (soliton or vortex)
          let psi = s.psi;
          const inj = s.pendingInject;
          if (inj?.kind === 'soliton')
            psi = _addSoliton(psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w, 0);
          else if (inj?.kind === 'vortex')
            psi = _addVortex(psi, inj.ox, inj.oy, inj.charge);
          // (Re)start physics chain
          if (!s.cachedRadii.length) {
            ctx.future(0, '_physStep', { stepsLeft: PHYS_STEPS, fRadii, fWeights, fOffs });
          }
          // Schedule opposite slot
          const nextSlot    = slot === 'A' ? 'B' : 'A';
          const nextCycleId = p.cycleId + 2;
          if (!s['slotActive_' + nextSlot]) {
            ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2),
              '_launch' + nextSlot, { cycleId: nextCycleId });
          }
          const vacuumState = inj?.kind === 'vortex' ? 'tunneling' : s.vacuumState;
          const autoInjected = inj?.kind === 'vortex' ? true : s.autoInjected;
          return { ...s,
            psi,
            ['slotActive_' + slot]: false,
            ['slotKernel_' + slot]: [],
            ['slotPsiNl_'  + slot]: null,
            cachedRadii: fRadii, cachedWeights: fWeights, cachedOffsets: fOffs,
            pendingInject: null,
            vacuumState, autoInjected,
            specCorr, specN: new Array(IFS_DEPTH).fill(0),
            ifsNBands: fRadii.length,
            ifsRadiiStr: fRadii.join(','),
            ifsWeightsStr: fWeights.map(w => w.toFixed(3)).join(','),
            ifsSEff: sEff,
          };
        },

        nextCycle: (s, p, ctx) => {
          if (s.slotActive_A && s.slotActive_B) return s;
          const slot = !s.slotActive_A ? 'A' : 'B';
          return _launchSlot(s, ctx, slot, ctx.wallTime + 1);
        },

        // ── Inject soliton — queue if IFS active ─────────────────────────
        injectSoliton: (s, p, ctx) => {
          const inj = { kind: 'soliton', sx: p.sx, sy: p.sy,
            amp: p.amp ?? SOL_AMP, vx: p.vx ?? 0, vy: p.vy ?? 0, w: p.w ?? SOL_W };
          if (s.slotActive_A || s.slotActive_B) return { ...s, pendingInject: inj };
          const psi = _addSoliton(s.psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w, 0);
          return { ...s, psi, power0: _power(psi), pendingInject: null };
        },

        // ── Inject topological vortex — queue if IFS active ──────────────
        injectVortex: (s, p, ctx) => {
          const inj = { kind: 'vortex', ox: p.ox, oy: p.oy, charge: p.charge ?? 1 };
          if (s.slotActive_A || s.slotActive_B) return { ...s, pendingInject: inj };
          const psi = _addVortex(s.psi, inj.ox, inj.oy, inj.charge);
          return { ...s, psi, power0: _power(psi), vacuumState: 'tunneling',
            autoInjected: true, pendingInject: null };
        },

        // ── Reset to vacuum A ─────────────────────────────────────────────
        setVacuumA: (s, p, ctx) => {
          const psi = _initVacuumA();
          const power0 = _power(psi);
          ctx.future(NEXT_STEP_DELAY, '_launchA', { cycleId: ctx.wallTime + 1 });
          ctx.future(NEXT_STEP_DELAY + Math.floor(FRESNEL_DONE_DELAY / 2), '_launchB', { cycleId: ctx.wallTime + 2 });
          return { ...s, psi, power0, vacuumState: 'A',
            autoInjected: false, time: 0, cycleCount: 0, pendingInject: null,
            ifsNBands: 0, ifsRadiiStr: '', ifsWeightsStr: '', ifsSEff: 0,
            cachedRadii: [], cachedWeights: [], cachedOffsets: [],
            specCorr: new Array(IFS_DEPTH).fill(0), specN: new Array(IFS_DEPTH).fill(0),
            slotActive_A: false, slotPsiNl_A: null, slotKernel_A: [], slotEnergy_A: new Array(IFS_DEPTH).fill(0), slotEvents_A: [], slotPhase_A: new Array(IFS_DEPTH).fill(null),
            slotActive_B: false, slotPsiNl_B: null, slotKernel_B: [], slotEnergy_B: new Array(IFS_DEPTH).fill(0), slotEvents_B: [], slotPhase_B: new Array(IFS_DEPTH).fill(null),
          };
        },

        // ── Reset to vacuum B ─────────────────────────────────────────────
        setVacuumB: (s, p, ctx) => {
          const psi = _initVacuumB(1);
          const power0 = _power(psi);
          ctx.future(NEXT_STEP_DELAY, '_launchA', { cycleId: ctx.wallTime + 1 });
          ctx.future(NEXT_STEP_DELAY + Math.floor(FRESNEL_DONE_DELAY / 2), '_launchB', { cycleId: ctx.wallTime + 2 });
          return { ...s, psi, power0, vacuumState: 'B',
            autoInjected: false, time: 0, cycleCount: 0, pendingInject: null,
            ifsNBands: 0, ifsRadiiStr: '', ifsWeightsStr: '', ifsSEff: 0,
            cachedRadii: [], cachedWeights: [], cachedOffsets: [],
            specCorr: new Array(IFS_DEPTH).fill(0), specN: new Array(IFS_DEPTH).fill(0),
            slotActive_A: false, slotPsiNl_A: null, slotKernel_A: [], slotEnergy_A: new Array(IFS_DEPTH).fill(0), slotEvents_A: [], slotPhase_A: new Array(IFS_DEPTH).fill(null),
            slotActive_B: false, slotPsiNl_B: null, slotKernel_B: [], slotEnergy_B: new Array(IFS_DEPTH).fill(0), slotEvents_B: [], slotPhase_B: new Array(IFS_DEPTH).fill(null),
          };
        },

      });
    }
  );

  const _isStable = W.stable([instanton3], reflector);
  const _export   = W.export(Renkon, { instanton3 }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeInstanton3Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  const _topoCharge = (psi) => {
    const q   = new Float32Array(N_CELLS);
    const PI2 = 2 * Math.PI;
    const wrap = (d) => {
      while (d >  Math.PI) d -= PI2;
      while (d < -Math.PI) d += PI2;
      return d;
    };
    const ph = (py, px) => {
      const id = py * GRID + px;
      if (psi[id*2]*psi[id*2] + psi[id*2+1]*psi[id*2+1] < 0.01) return 0;
      return Math.atan2(psi[id*2+1], psi[id*2]);
    };
    for (let y = 0; y < GRID - 1; y++) {
      for (let x = 0; x < GRID - 1; x++) {
        const dph = wrap(ph(y,x+1)   - ph(y,x))   +
                    wrap(ph(y+1,x+1) - ph(y,x+1)) +
                    wrap(ph(y+1,x)   - ph(y+1,x+1)) +
                    wrap(ph(y,x)     - ph(y+1,x));
        q[y * GRID + x] = dph / PI2;
      }
    }
    return q;
  };

  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    if (!document.getElementById('instanton3-wrap')) {
      const wrap = document.createElement('div');
      wrap.id = 'instanton3-wrap';
      Object.assign(wrap.style, {
        display: 'flex', gap: '0', flexWrap: 'nowrap',
        alignItems: 'stretch', height: '100vh', width: '100%', overflow: 'hidden',
      });
      document.body.appendChild(wrap);
    }

    const root = document.createElement('div');
    root.id = containerId;
    Object.assign(root.style, {
      fontFamily: 'ui-monospace,monospace',
      background: '#000', color: '#eee',
      flex: '1', minWidth: '0', minHeight: '0', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    });
    document.getElementById('instanton3-wrap').appendChild(root);

    // ── Main layout: canvas area + clock column ───────────────────────────
    const main = document.createElement('div');
    Object.assign(main.style, { display: 'flex', flex: '1', flexDirection: 'row', minHeight: '0' });
    root.appendChild(main);

    // ── Canvas column ─────────────────────────────────────────────────────
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
      Object.assign(lbl.style, { fontSize: '8px', color, textAlign: 'center', marginBottom: '2px', letterSpacing: '0.5px', flexShrink: '0' });
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

    const intCell    = makeDataCell('INTENSITY  |ψ|²  (click = soliton  right-click = vortex Q+1)', '#f84');
    const phaseCell  = makeDataCell('PHASE  arg(ψ)', '#4af');
    const chargeCell = makeDataCell('TOPO CHARGE  q(x,y)   red=+1 vortex  blue=−1 anti-vortex', '#f64');
    canvasCol.appendChild(intCell.wrap);
    canvasCol.appendChild(phaseCell.wrap);
    canvasCol.appendChild(chargeCell.wrap);

    const intBuf2    = intCell.ctx.createImageData(RW, RH);
    const phaseBuf2  = phaseCell.ctx.createImageData(RW, RH);
    const chargeBuf2 = chargeCell.ctx.createImageData(RW, RH);

    let _smoothMaxI = 0;

    // ── Clock column ──────────────────────────────────────────────────────
    const clockCol = document.createElement('div');
    Object.assign(clockCol.style, {
      flexShrink: '0', width: '120px', display: 'flex', flexDirection: 'column',
      padding: '10px 8px', boxSizing: 'border-box', gap: '6px', overflow: 'hidden',
    });
    main.appendChild(clockCol);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '8px', fontWeight: 'bold', letterSpacing: '0.5px',
      color: '#0d6', textAlign: 'center', lineHeight: '1.4',
      height: '3em', overflow: 'hidden', flexShrink: '0',
    });
    clockCol.appendChild(title);

    const ifsClock = makeIFSClockPanel({ label: 'FRESNEL IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    clockCol.appendChild(ifsClock.el);

    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, {
      fontSize: '7px', color: '#444', lineHeight: '1.6',
      overflow: 'hidden', flexShrink: '0',
    });
    clockCol.appendChild(stats);

    const mkBtn = (label, bg, handler) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: bg, color: '#000', border: 'none', borderRadius: '4px',
        padding: '4px 0', fontSize: '8px', cursor: 'pointer', width: '100%',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold',
        touchAction: 'manipulation',
      });
      b.addEventListener('click', handler);
      b.addEventListener('touchend', (e) => { e.preventDefault(); handler(e); }, { passive: false });
      return b;
    };

    const btnA = mkBtn('Phase A  Q=0',  '#0d6', () => injectEvent?.({ type: 'setVacuumA' }));
    const btnB = mkBtn('Phase B  Q=+1', '#f50', () => injectEvent?.({ type: 'setVacuumB' }));
    clockCol.appendChild(btnA);
    clockCol.appendChild(btnB);

    const tunnelLbl = document.createElement('div');
    tunnelLbl.id = containerId + '-tunnel-lbl';
    Object.assign(tunnelLbl.style, { fontSize: '9px', color: '#555', textAlign: 'center' });
    tunnelLbl.textContent = '←  instanton  →';
    clockCol.appendChild(tunnelLbl);

    const windingLbl = document.createElement('div');
    windingLbl.id = containerId + '-winding';
    Object.assign(windingLbl.style, { fontSize: '11px', fontWeight: 'bold', color: '#888', textAlign: 'center' });
    clockCol.appendChild(windingLbl);

    // ── Canvas pointer handlers — mouse + touch ───────────────────────────
    const _canvasCoords = (canvas, e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.changedTouches?.length ? e.changedTouches[0].clientX : e.clientX;
      const cy = e.changedTouches?.length ? e.changedTouches[0].clientY : e.clientY;
      const sx = Math.floor((cx - rect.left) / rect.width  * GRID);
      const sy = Math.floor((cy - rect.top)  / rect.height * GRID);
      return [sx, sy];
    };

    [intCell.canvas, phaseCell.canvas, chargeCell.canvas].forEach(c => {
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
      c.addEventListener('touchend', (e) => {
        e.preventDefault();
        const [sx, sy] = _canvasCoords(c, e);
        if (sx >= 0 && sx < GRID && sy >= 0 && sy < GRID)
          injectEvent?.({ type: 'injectSoliton', sx, sy, vx: 0, vy: 0 });
      }, { passive: false });
      c.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    });

    root.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));

    // ── Main render ────────────────────────────────────────────────────────
    const _renderFrame = () => {
      const n = world.getNodeState('instanton3');
      if (!n?.psi) return;

      const psi = n.psi;
      const lt  = world.ps.app.logicalTime ?? 0;

      // Smoothed max-intensity for stable colormap
      let maxI = 1e-9;
      for (let j = 0; j < N_CELLS; j++) {
        const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
        if (v > maxI) maxI = v;
      }
      _smoothMaxI = _smoothMaxI < 1e-9 ? maxI : _smoothMaxI * 0.97 + maxI * 0.03;
      const norm = 1 / Math.sqrt(_smoothMaxI);
      const logS = 1 / Math.log(1 + 9);

      // ── Bilinear upsampled intensity canvas ───────────────────────────
      for (let ry = 0; ry < RH; ry++) {
        const fy = (ry + 0.5) / RENDER_SCALE - 0.5;
        const y0 = Math.floor(fy); const ty = fy - y0;
        const y1 = y0 + 1;
        for (let rx = 0; rx < RW; rx++) {
          const fx = (rx + 0.5) / RENDER_SCALE - 0.5;
          const x0 = Math.floor(fx); const tx = fx - x0;
          const x1 = x0 + 1;
          const bi = (ry * RW + rx) * 4;
          let re = 0, im = 0;
          for (let dy = 0; dy <= 1; dy++) {
            const cy2 = Math.max(0, Math.min(GRID - 1, dy === 0 ? y0 : y1));
            const wy  = dy === 0 ? (1 - ty) : ty;
            for (let dx = 0; dx <= 1; dx++) {
              const gx = Math.max(0, Math.min(GRID - 1, dx === 0 ? x0 : x1));
              const wx = dx === 0 ? (1 - tx) : tx;
              const j  = cy2 * GRID + gx;
              const w  = wx * wy;
              re += psi[j*2]   * w;
              im += psi[j*2+1] * w;
            }
          }
          const amp = Math.sqrt(re*re + im*im) * norm;
          const lv  = Math.log(1 + 9 * amp) * logS;
          const [r, g, b] = colormaps.hot(lv);
          intBuf2.data[bi]   = r;
          intBuf2.data[bi+1] = g;
          intBuf2.data[bi+2] = b;
          intBuf2.data[bi+3] = 255;
          const [pr, pg, pb] = colormaps.phase(re, im, norm);
          phaseBuf2.data[bi]   = pr;
          phaseBuf2.data[bi+1] = pg;
          phaseBuf2.data[bi+2] = pb;
          phaseBuf2.data[bi+3] = 255;
        }
      }
      intCell.ctx.putImageData(intBuf2, 0, 0);
      phaseCell.ctx.putImageData(phaseBuf2, 0, 0);

      // ── Topological charge — spread vortex cores into glow ────────────
      const qField = _topoCharge(psi);
      const qGlow  = new Float32Array(N_CELLS);
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const q = qField[y*GRID + x];
          if (Math.abs(q) < 0.3) continue;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const ry = y+dy, rx = x+dx;
              if (ry < 0 || ry >= GRID || rx < 0 || rx >= GRID) continue;
              const w = 1 / (1 + dx*dx + dy*dy);
              const idx = ry*GRID + rx;
              if (Math.abs(qGlow[idx]) < Math.abs(q * w)) qGlow[idx] = q * w;
            }
          }
        }
      }
      // Bilinear upsampled charge canvas
      for (let ry = 0; ry < RH; ry++) {
        const fy = (ry + 0.5) / RENDER_SCALE - 0.5;
        const y0 = Math.floor(fy); const ty = fy - y0;
        const y1 = y0 + 1;
        for (let rx = 0; rx < RW; rx++) {
          const fx = (rx + 0.5) / RENDER_SCALE - 0.5;
          const x0 = Math.floor(fx); const tx = fx - x0;
          const x1 = x0 + 1;
          const bi = (ry * RW + rx) * 4;
          let q = 0;
          for (let dy = 0; dy <= 1; dy++) {
            const cy2 = Math.max(0, Math.min(GRID - 1, dy === 0 ? y0 : y1));
            const wy  = dy === 0 ? (1 - ty) : ty;
            for (let dx = 0; dx <= 1; dx++) {
              const gx = Math.max(0, Math.min(GRID - 1, dx === 0 ? x0 : x1));
              q += qGlow[cy2 * GRID + gx] * (dx === 0 ? (1 - tx) : tx) * wy;
            }
          }
          const [r, g, b] = colormaps.charge(q);
          chargeBuf2.data[bi]   = r;
          chargeBuf2.data[bi+1] = g;
          chargeBuf2.data[bi+2] = b;
          chargeBuf2.data[bi+3] = 255;
        }
      }
      chargeCell.ctx.putImageData(chargeBuf2, 0, 0);

      // Total winding number
      let Q = 0;
      for (let i = 0; i < N_CELLS; i++) if (Math.abs(qField[i]) > 0.4) Q += Math.round(qField[i]);

      const vs       = n.vacuumState ?? 'A';
      const isActive = !!(n.slotActive_A || n.slotActive_B);

      title.style.color = vs === 'tunneling' ? '#f80' : (vs === 'B' ? '#f50' : '#0d6');
      title.textContent =
        `PEER ${peerId} · INSTANTON3  s≈${(n.ifsSEff ?? 0).toFixed(3)}  ` +
        (n.slotActive_A ? '[A]' : '') + (n.slotActive_B ? '[B]' : '') +
        (isActive ? '' : `[${vs === 'A' ? 'VAC-A' : vs === 'B' ? 'VAC-B' : 'TUNNEL'}]`);

      const tl = document.getElementById(containerId + '-tunnel-lbl');
      if (tl) {
        tl.style.color = vs === 'tunneling' ? '#f80' : '#555';
        tl.textContent = vs === 'tunneling' ? '⟿  TUNNELING  ⟿' : '←  instanton  →';
      }
      const wd = document.getElementById(containerId + '-winding');
      if (wd) {
        wd.style.color = Q !== 0 ? '#f80' : '#555';
        wd.textContent = `Q=${Q >= 0 ? '+' : ''}${Q}`;
      }

      let power = 0;
      for (let j = 0; j < N_CELLS; j++) power += psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
      const ratio = (n.power0 ?? 0) > 0 ? power / n.power0 : 1;

      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `t=${(n.time ?? 0).toFixed(1)}  max|ψ|²=${maxI.toFixed(2)}` +
        `  P=${ratio.toFixed(4)}  cyc=${n.cycleCount ?? 0}` +
        `  Q=${Q >= 0 ? '+' : ''}${Q}  γ=${GAMMA}` +
        `  R=[${n.ifsRadiiStr ?? ''}]` +
        `  ${_clientBadge(world)}`;

      // Merge both slot energy/events for clock
      const energyA = n.slotEnergy_A ?? [];
      const energyB = n.slotEnergy_B ?? [];
      const mergedEnergy = energyA.map((v, i) => Math.max(v, energyB[i] ?? 0));
      const mergedEvents = [...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])]
        .sort((a, b) => a.wt - b.wt).slice(-80);

      ifsClock.update({ energy: mergedEnergy, events: mergedEvents, isActive, lt });

      _renderAvatars(world, root);
    };

    // RAF loop
    let _rafId = null;
    const _rafLoop = () => { _renderFrame(); _rafId = requestAnimationFrame(_rafLoop); };
    _rafId = requestAnimationFrame(_rafLoop);

    return _renderFrame;
  };
}

export default {
  title:       'Instanton3 | IFS-Native Laplacian (Emergent s)',
  selo:        'instanton3',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [instanton3WorldProgram + av],
  makeRenderer: makeInstanton3Renderer,
  wrapId:      'instanton3-wrap',
  hideTopBar:  true,
};
