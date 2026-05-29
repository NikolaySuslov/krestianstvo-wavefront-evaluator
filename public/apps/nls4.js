/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── NLS4 | Split-View Distributed Soliton ────────────────────────────────────
//
// Two peers run the identical NLS simulation (Croquet determinism).
// Each peer renders only its own half of the 64×64 field:
//   peer index 0 → left  half (columns 0  .. GRID/2-1)  — soliton moves right →
//   peer index 1 → right half (columns GRID/2 .. GRID-1) — soliton moves left  ←
//
// The two browser windows placed side-by-side form a single seamless view.
// The soliton crosses the visual boundary between screens as it propagates.
//
// Initial condition: two sech-envelope solitons placed at ±30% of grid width,
// moving toward each other along x with equal and opposite momenta.
// They collide at the center (the screen boundary) and pass through with a
// phase shift — demonstrating soliton stability under IFS fractional dispersion.

import { FRAG, colormaps, IFS_MAPS_DEFAULT, kernel } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';



// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
const SUBTICK_MS   = 0.09;

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID    = 42;
const N_CELLS = GRID * GRID;
const HALF    = GRID >> 1;

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH  = 5.0;
const DELAY_SCALE = 0.06;
const GAMMA       = -0.25;
const ISAT        = 20.0;
const DT          = 0.1;

// ── Soliton initial conditions — nls3 _initField2: two solitons colliding ────
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
const N_FRESNEL_ROOTS  = 4;
const CYCLE            = 16;  // refresh IFS kernel every N physics ticks (must exceed FRESNEL_DONE_DELAY≈11)
const PHYS_STEPS       = 1;   // 1 step per tick — chain spreads across ticks via NEXT_STEP_DELAY
const NEXT_STEP_DELAY  = 1;   // ms > SUBTICK_MS — each step fires in its own reflector tick
const LOD              = [1, 1, 1, 1];
const FRAC_ALPHA       = 0.08;
const MAX_IFS_BANDS    = 4;   // cap kernel bands for Safari JIT performance

// ── World program ─────────────────────────────────────────────────────────────
const nls4WorldProgram = `
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
  const _PHI     = 1.6180339887;
  const _PHI_INV = 0.6180339887;

  ${FRAG.nlsOps(GRID, N_CELLS)}
  ${FRAG.ifsStencil(GRID)}
  ${FRAG.ifsKernels}
  ${FRAG.specCorr(GRID, N_CELLS, IFS_DEPTH)}
  ${FRAG.ifsScheduler}

  const _initField = () => {
    const cx = GRID / 2, cy = GRID / 2, r0 = GRID * 0.30;
    let psi = new Float64Array(2 * NCELLS);
    psi = _addSoliton(psi, cx - r0, cy, SOL_AMP, +SOL_V, 0, SOL_W);
    psi = _addSoliton(psi, cx + r0, cy, SOL_AMP, -SOL_V, 0, SOL_W);
    return psi;
  };

  // Launch one IFS slot (A or B). slot='A'|'B'. Uses a unique cycleId per launch.
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
    // Each slot stores its own psi_nl snapshot independently
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

  const nls = Behaviors.collect(
    {
      psi:      new Float64Array(2 * ${N_CELLS}),
      time:     0,
      power0:   1,
      cycleCount: 0,
      // Dual-slot IFS overlap — A and B staggered by CYCLE/2
      slotId_A: -1, slotActive_A: false, slotPsiNl_A: null, slotPowerNl_A: 1,
      slotKernel_A: [], slotEnergy_A: new Array(${IFS_DEPTH}).fill(0),
      slotEvents_A: [], slotPhase_A:  new Array(${IFS_DEPTH}).fill(null),
      slotId_B: -2, slotActive_B: false, slotPsiNl_B: null, slotPowerNl_B: 1,
      slotKernel_B: [], slotEnergy_B: new Array(${IFS_DEPTH}).fill(0),
      slotEvents_B: [], slotPhase_B:  new Array(${IFS_DEPTH}).fill(null),
      // Current finalized kernel (from whichever slot last completed)
      cachedRadii: [],
      cachedWeights: [],
      cachedOffsets: [],
      ifsNBands: 0,
      ifsRadiiStr: '',
      ifsWeightsStr: '',
      ifsSEff: 0,
      specCorr: new Array(${IFS_DEPTH}).fill(0),
      specN:    new Array(${IFS_DEPTH}).fill(0),
      pendingInject: null,
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (t === 'inject' || t === 'reset' || t === 'nextCycle')
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} }, ...(s._queue ?? [])] };
      }
      return W.reduce(s, pulse, 'nls4', {

        __macro: (s, p, ctx) => {
          if (p.isSubTick) return s;
          const tick = p.logicalTime;
          if (tick === 1) {
            ctx.future(100, '_keepalive', {});
            const psi    = _initField();
            const power0 = _power(psi);
            // Launch slot A; slot B starts after FRESNEL_DONE_DELAY/2
            let s2 = _launchSlot({ ...s, psi, power0 }, ctx, 'A', tick);
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
          // If cachedRadii empty (post-reset), chain stops here;
          // finalizeFresnelm will restart it when the new kernel is ready.
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
          // Apply pending injection
          let psi = s.psi;
          const inj = s.pendingInject;
          if (inj) psi = _addSoliton(psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w);
          // (Re)start physics chain — handles both first-ever finalize and post-reset
          if (!s.cachedRadii.length) {
            ctx.future(0, '_physStep', { stepsLeft: PHYS_STEPS, fRadii, fWeights, fOffs });
          }
          // Schedule the opposite slot to start after half the IFS window
          const nextSlot    = slot === 'A' ? 'B' : 'A';
          const nextCycleId = p.cycleId + 2;
          if (!s['slotActive_' + nextSlot]) {
            ctx.future(Math.floor(FRESNEL_DONE_DELAY / 2),
              '_launch' + nextSlot, { cycleId: nextCycleId });
          }
          return { ...s,
            psi,
            ['slotActive_' + slot]: false,
            ['slotKernel_' + slot]: [],
            ['slotPsiNl_'  + slot]: null,
            cachedRadii: fRadii, cachedWeights: fWeights, cachedOffsets: fOffs,
            pendingInject: null,
            specCorr, specN: new Array(IFS_DEPTH).fill(0),
            ifsNBands: fRadii.length,
            ifsRadiiStr: fRadii.join(','),
            ifsWeightsStr: fWeights.map(w => w.toFixed(3)).join(','),
            ifsSEff: sEff,
          };
        },

        _launchA: (s, p, ctx) => {
          if (s.slotActive_A) return s;
          return _launchSlot(s, ctx, 'A', p.cycleId ?? ctx.wallTime);
        },

        reset: (s, p, ctx) => {
          const psi    = _initField();
          const power0 = _power(psi);
          // Schedule slot launches at positive delays so they fire in future ticks,
          // not as subtick drains in this turn.
          ctx.future(NEXT_STEP_DELAY, '_launchA', { cycleId: ctx.wallTime + 1 });
          ctx.future(NEXT_STEP_DELAY + Math.floor(FRESNEL_DONE_DELAY / 2), '_launchB', { cycleId: ctx.wallTime + 2 });
          return {
            ...s, psi, power0, time: 0, cycleCount: 0, pendingInject: null,
            ifsNBands: 0, ifsRadiiStr: '', ifsWeightsStr: '', ifsSEff: 0,
            cachedRadii: [], cachedWeights: [], cachedOffsets: [],
            specCorr: new Array(IFS_DEPTH).fill(0), specN: new Array(IFS_DEPTH).fill(0),
            slotActive_A: false, slotPsiNl_A: null, slotKernel_A: [], slotEnergy_A: new Array(IFS_DEPTH).fill(0), slotEvents_A: [], slotPhase_A: new Array(IFS_DEPTH).fill(null),
            slotActive_B: false, slotPsiNl_B: null, slotKernel_B: [], slotEnergy_B: new Array(IFS_DEPTH).fill(0), slotEvents_B: [], slotPhase_B: new Array(IFS_DEPTH).fill(null),
          };
        },

        nextCycle: (s, p, ctx) => {
          if (s.slotActive_A && s.slotActive_B) return s;
          const slot = !s.slotActive_A ? 'A' : 'B';
          return _launchSlot(s, ctx, slot, ctx.wallTime + 1);
        },

        inject: (s, p, ctx) => {
          const inj = { sx: p.sx, sy: p.sy, vx: p.vx ?? 0, vy: p.vy ?? 0,
            amp: p.amp ?? SOL_AMP, w: p.w ?? SOL_W };
          if (s.slotActive_A || s.slotActive_B) return { ...s, pendingInject: inj };
          const psi = _addSoliton(s.psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w);
          return { ...s, psi, power0: _power(psi), pendingInject: null };
        },

      });
    }
  );

  const _isStable = W.stable([nls], reflector);
  const _export   = W.export(Renkon, { nls4: nls }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeNls4Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    if (!document.getElementById('nls4-wrap')) {
      const wrap = document.createElement('div');
      wrap.id = 'nls4-wrap';
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
    document.getElementById('nls4-wrap').appendChild(root);

    // ── Side selection — default left, switchable live ────────────────────
    let _peerSide = 'left';

    // ── Main UI — visible immediately ────────────────────────────────────
    const main = document.createElement('div');
    Object.assign(main.style, { display: 'flex', flex: '1', flexDirection: 'row', minHeight: '0' });
    root.appendChild(main);

    // ── Canvas column — flushes to the inner browser edge ────────────────
    const canvasCol = document.createElement('div');
    Object.assign(canvasCol.style, {
      flex: '1', minWidth: '0', minHeight: '0',
      display: 'flex', flexDirection: 'row',
      alignItems: 'stretch',
      // justifyContent is set per side by _applySide()
    });

    // Canvas wrapper — full height, canvas pinned to the inner edge
    const canvasSlot = document.createElement('div');
    Object.assign(canvasSlot.style, {
      position: 'relative', height: '100%',
      display: 'flex', alignItems: 'stretch',
    });
    canvasCol.appendChild(canvasSlot);

    const RENDER_SCALE = 4; // upsample factor — pure visual, no physics change
    const RW = HALF * RENDER_SCALE;
    const RH = GRID * RENDER_SCALE;

    const mkCanvas = () => {
      const c = document.createElement('canvas');
      c.width  = RW; c.height = RH;
      Object.assign(c.style, {
        height: '100%', width: 'auto',
        aspectRatio: `${HALF} / ${GRID}`,
        imageRendering: 'auto', display: 'block', cursor: 'crosshair',
      });
      return c;
    };
    const intCanvas   = mkCanvas();
    const phaseCanvas = mkCanvas();
    phaseCanvas.style.display = 'none';
    canvasSlot.appendChild(intCanvas);
    canvasSlot.appendChild(phaseCanvas);

    const intCtx2   = intCanvas.getContext('2d');
    const phaseCtx2 = phaseCanvas.getContext('2d');
    const intBuf2   = intCtx2.createImageData(RW, RH);
    const phaseBuf2 = phaseCtx2.createImageData(RW, RH);

    let _showPhase  = false;
    let _viewOffset = 0; // default left offset; updated by side switch or slider
    let _smoothMaxI = 0; // exponentially smoothed peak intensity for stable colormap

    // ── Clock column — sits on the outer edge, with title + controls ─────
    const clockCol = document.createElement('div');
    Object.assign(clockCol.style, {
      flexShrink: '0', width: '120px', display: 'flex', flexDirection: 'column',
      padding: '10px 8px', boxSizing: 'border-box', gap: '6px', overflow: 'hidden',
    });

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '8px', fontWeight: 'bold', letterSpacing: '0.5px',
      color: '#0cf', textAlign: 'center', lineHeight: '1.4',
      height: '3em', overflow: 'hidden', flexShrink: '0',
    });
    clockCol.appendChild(title);

    const ifsClock = makeIFSClockPanel({ label: 'FRESNEL IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    clockCol.appendChild(ifsClock.el);

    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, {
      fontSize: '7px', color: '#444', lineHeight: '1.6',
      height: '7em', overflow: 'hidden', flexShrink: '0',
    });
    clockCol.appendChild(stats);

    const mkBtn = (label, color, handler) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: color, color: '#000', border: 'none', borderRadius: '4px',
        padding: '4px 0', fontSize: '8px', cursor: 'pointer', width: '100%',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold',
        touchAction: 'manipulation',
      });
      b.addEventListener('click', handler);
      b.addEventListener('touchend', (e) => { e.preventDefault(); handler(e); }, { passive: false });
      return b;
    };
    const _applySide = (side) => {
      _peerSide = side;
      _viewOffset = side === 'left' ? 0 : HALF;
      offsetInput.value = _viewOffset;
      while (main.firstChild) main.removeChild(main.firstChild);
      if (side === 'left') {
        // clock on left, canvas on right → canvas flush to RIGHT (inner) edge
        main.appendChild(clockCol); main.appendChild(canvasCol);
        canvasCol.style.justifyContent = 'flex-end';
      } else {
        // canvas on left, clock on right → canvas flush to LEFT (inner) edge
        main.appendChild(canvasCol); main.appendChild(clockCol);
        canvasCol.style.justifyContent = 'flex-start';
      }
      btnLeft.style.background  = side === 'left'  ? '#0cf' : '#1a1a1a';
      btnLeft.style.color       = side === 'left'  ? '#000' : '#0cf';
      btnRight.style.background = side === 'right' ? '#f80' : '#1a1a1a';
      btnRight.style.color      = side === 'right' ? '#000' : '#f80';
    };

    clockCol.appendChild(mkBtn('Reset  ↺', '#0d6', () => injectEvent?.({ type: 'reset' })));

    const sideRow = document.createElement('div');
    Object.assign(sideRow.style, { display: 'flex', gap: '4px' });
    const btnLeft  = mkBtn('◀ L', '#0cf', () => _applySide('left'));
    const btnRight = mkBtn('R ▶', '#1a1a1a', () => _applySide('right'));
    btnLeft.style.color  = '#000';
    btnRight.style.color = '#f80';
    Object.assign(btnLeft.style,  { flex: '1' });
    Object.assign(btnRight.style, { flex: '1' });
    sideRow.appendChild(btnLeft);
    sideRow.appendChild(btnRight);
    clockCol.appendChild(sideRow);

    const toggleBtn = mkBtn('INTENSITY', '#1a1a1a', () => {
      _showPhase = !_showPhase;
      intCanvas.style.display   = _showPhase ? 'none' : 'block';
      phaseCanvas.style.display = _showPhase ? 'block' : 'none';
      toggleBtn.textContent = _showPhase ? 'PHASE' : 'INTENSITY';
      toggleBtn.style.color = _showPhase ? '#4af' : '#f84';
    });
    toggleBtn.style.color = '#f84';
    clockCol.appendChild(toggleBtn);

    const offsetRow = document.createElement('div');
    Object.assign(offsetRow.style, { display: 'flex', alignItems: 'center', gap: '4px' });
    const offsetLbl = document.createElement('div');
    Object.assign(offsetLbl.style, { fontSize: '7px', color: '#555', flexShrink: '0' });
    offsetLbl.textContent = 'offset';
    const offsetInput = document.createElement('input');
    offsetInput.type = 'number'; offsetInput.value = 0; offsetInput.step = 1;
    Object.assign(offsetInput.style, {
      flex: '1', minWidth: '0', background: '#111', color: '#0cf',
      border: '1px solid #333', borderRadius: '3px',
      padding: '2px 4px', fontSize: '8px', fontFamily: 'ui-monospace,monospace',
      textAlign: 'right',
    });
    offsetInput.addEventListener('input', () => { _viewOffset = parseInt(offsetInput.value) || 0; });
    offsetRow.appendChild(offsetLbl);
    offsetRow.appendChild(offsetInput);
    clockCol.appendChild(offsetRow);

    // Unified pointer handler — works for both mouse and touch events
    const _clientXY = (e) => {
      if (e.changedTouches?.length) return { cx: e.changedTouches[0].clientX, cy: e.changedTouches[0].clientY };
      return { cx: e.clientX, cy: e.clientY };
    };

    const onCanvasClick = (canvas) => (e) => {
      e.preventDefault();
      const { cx, cy } = _clientXY(e);
      const rect    = canvas.getBoundingClientRect();
      const px      = rect.width / HALF || 1;
      const lx      = Math.floor((cx - rect.left) / px);
      const ly      = Math.floor((cy - rect.top)  / px);
      const xOffset = _viewOffset;
      const sx      = xOffset + lx;
      const sy      = ly;
      if (sx >= 0 && sx < GRID && sy >= 0 && sy < GRID) {
        let h = (sx * 73856093) ^ (sy * 19349663);
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
        const angle = (h / 0xffffffff) * 2 * Math.PI;
        const vx = Math.cos(angle) * SOL_V;
        const vy = Math.sin(angle) * SOL_V;
        injectEvent?.({ type: 'inject', sx, sy, vx, vy });
      }
    };


    // Initial layout + click/touch wiring (left by default)
    _applySide('left');
    for (const c of [intCanvas, phaseCanvas]) {
      const h = onCanvasClick(c);
      c.addEventListener('click',      h);
      c.addEventListener('touchend',   h, { passive: false });
      c.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    }

    // ── Main render function ──────────────────────────────────────────────
    const _renderFrame = () => {
      const n = world.getNodeState('nls4');
      if (!n?.psi || n.cycleCount < 1) return;

      const xOffset = _viewOffset;
      const psi = n.psi;
      const lt  = world.ps.app.logicalTime ?? 0;

      // Smoothed max-intensity normalisation — avoids brightness flicker at cycle boundaries
      let maxI = 1e-9;
      for (let j = 0; j < N_CELLS; j++) {
        const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
        if (v > maxI) maxI = v;
      }
      _smoothMaxI = _smoothMaxI < 1e-9 ? maxI : _smoothMaxI * 0.97 + maxI * 0.03;
      const norm = 1 / Math.sqrt(_smoothMaxI);
      const logS = 1 / Math.log(1 + 9);

      // Color split: warm = left half of field, cool = right half.
      // Purely visual spatial zone — solitons swap colors as they cross center.

      // ── Render upsampled view — bilinear sample from physics grid ────────
      for (let ry = 0; ry < RH; ry++) {
        // map render pixel centre to physics grid coordinate
        const fy = (ry + 0.5) / RENDER_SCALE - 0.5;
        const y0 = Math.floor(fy); const ty = fy - y0;
        const y1 = y0 + 1;
        for (let rx = 0; rx < RW; rx++) {
          const fx = (rx + 0.5) / RENDER_SCALE - 0.5;
          const lx0 = Math.floor(fx); const tx = fx - lx0;
          const lx1 = lx0 + 1;
          const bi = (ry * RW + rx) * 4;

          // sample 4 corners with bilinear weights
          let re = 0, im = 0;
          for (let dy = 0; dy <= 1; dy++) {
            const cy2 = Math.max(0, Math.min(GRID - 1, dy === 0 ? y0 : y1));
            const wy  = dy === 0 ? (1 - ty) : ty;
            for (let dx = 0; dx <= 1; dx++) {
              const lx  = dx === 0 ? lx0 : lx1;
              const gx  = xOffset + lx;
              const wx  = dx === 0 ? (1 - tx) : tx;
              if (gx < 0 || gx >= GRID) continue;
              const j = cy2 * GRID + gx;
              const w = wx * wy;
              re += psi[j*2]   * w;
              im += psi[j*2+1] * w;
            }
          }

          const amp = Math.sqrt(re*re + im*im) * norm;
          const lv  = Math.log(1 + 9 * amp) * logS;
          const [hr, hg, hb] = colormaps.hot(lv);
          intBuf2.data[bi]   = hr;
          intBuf2.data[bi+1] = hg;
          intBuf2.data[bi+2] = hb;
          intBuf2.data[bi+3] = 255;
          const [pr, pg, pb] = colormaps.phase(re, im, norm);
          phaseBuf2.data[bi]   = pr;
          phaseBuf2.data[bi+1] = pg;
          phaseBuf2.data[bi+2] = pb;
          phaseBuf2.data[bi+3] = 255;
        }
      }
      intCtx2.putImageData(intBuf2, 0, 0);
      phaseCtx2.putImageData(phaseBuf2, 0, 0);

      const isActive = !!(n.slotActive_A || n.slotActive_B);
      const side     = _peerSide ?? '?';
      title.style.color = isActive ? '#fa0' : '#a70';
      title.textContent =
        `PEER ${peerId} [${side.toUpperCase()}] · NLS4  ` +
        `s≈${(n.ifsSEff ?? 0).toFixed(3)}  ` +
        (n.slotActive_A ? '[A]' : '') + (n.slotActive_B ? '[B]' : '');

      let power = 0;
      for (let j = 0; j < N_CELLS; j++) power += psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
      const ratio = (n.power0 ?? 0) > 0 ? power / n.power0 : 1;

      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `t=${(n.time ?? 0).toFixed(1)}  max|ψ|²=${maxI.toFixed(2)}` +
        `  power=${ratio.toFixed(4)}  cycle=${n.cycleCount ?? 0}` +
        `  side=${side}  ${_clientBadge(world)}`;

      // Merge both slot energy/events for the IFS clock display
      const energyA = n.slotEnergy_A ?? [];
      const energyB = n.slotEnergy_B ?? [];
      const mergedEnergy = energyA.map((v, i) => Math.max(v, energyB[i] ?? 0));
      const mergedEvents = [...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])]
        .sort((a, b) => a.wt - b.wt).slice(-80);

      ifsClock.update({
        energy: mergedEnergy,
        events: mergedEvents,
        isActive,
        lt,
      });

      _renderAvatars(world, root);
    };

    // RAF loop — renders at 60fps using latest world state between reflector ticks
    let _rafId = null;
    const _rafLoop = () => { _renderFrame(); _rafId = requestAnimationFrame(_rafLoop); };
    _rafId = requestAnimationFrame(_rafLoop);

    return _renderFrame;
  };
}

export default {
  title:       'NLS4 | Split-View Distributed Soliton',
  selo:        'nls4',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [nls4WorldProgram + av],
  makeRenderer: makeNls4Renderer,
  wrapId:      'nls4-wrap',
  hideTopBar:  true,
};
