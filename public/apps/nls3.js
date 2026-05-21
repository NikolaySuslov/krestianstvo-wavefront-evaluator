/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── NLS3 | IFS-Native Laplacian — Emergent Fractional Order ──────────────────
//
// The IFS beat cascade IS the Laplacian. No external Riesz kernel K(r)=1/r^{2s}
// is imposed. Instead the IFS empirical measure (visit-count distribution over
// radii) defines the kernel weights directly:
//
//   w(r) = FRAC_ALPHA × count(r) / totalBeats
//
// The IFS attractor has log-uniform density ρ(r)~1/r → effective s≈0.5.
// But s is NOT a free parameter here — it EMERGES from the IFS contraction
// ratios {0.309, 0.414, 0.5, 0.618, 0.707, 0.732} each cycle.
// Different IFS geometry → different emergent fractional order.
//
// Key difference from nls2.js:
//   nls2.js — IFS selects nodes; explicit K(r)=FRAC_ALPHA/r^{2s} weights them
//   nls3.js — IFS selects nodes AND weights them via its own empirical measure
//
// Strang-split NLS cycle:
//   1. NL half-step: ψ_nl = ψ · exp(-i·γ·sat(|ψ|²)·DT/2)   [exact]
//   2. IFS beats fire, each appending ri to fracKernel (with repetition)
//   3. finalizeFresnelm: countMap[r]=visits → w(r)=FRAC_ALPHA×count/total
//      ψ_new = _linearStepIFS(ψ_nl, DT, R_IFS, w)
//   4. NL half-step: ψ = normalize(ψ_new · exp(-i·γ·sat|ψ|²·DT/2))
//
// Click on intensity canvas → inject new soliton (replicated to all peers).

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
const SUBTICK_MS   = 0.09;

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID    = 64;
const N_CELLS = GRID * GRID;

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH = 5.0;    // Huygens wavelength (controls spatial oscillation rate)
const DELAY_SCALE = 0.06;   // sub-tick delay → grid distance: r = delay / DELAY_SCALE
const GAMMA   = -0.25;     // NLS nonlinearity (< 0 = focusing → bright solitons)
const ISAT    = 20.0;      // saturation intensity (prevents 2D wave collapse)
const DT      = 0.1;       // NLS time step per cycle — smaller = less IFS dispersion error

// ── Soliton initial conditions ────────────────────────────────────────────────
const SOL_AMP = 2.0;   // soliton amplitude (sets self-focusing strength)
const SOL_W   = 6;     // soliton width in grid cells
const SOL_V   = 0.8;   // carrier wave vector magnitude (group velocity)

// ── IFS fractal clock (spectral decomposition) ────────────────────────────────
const IFS_DEPTH     = 4;
const IFS_MAPS      = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP   = 5;
const IFS_MIN_DELAY = 0.10;

// Root delay covers shells up to r_max = GRID*0.35 ≈ 22 cells (≈ 3.7 soliton widths)
const IFS_BASE_DELAY    = parseFloat((DELAY_SCALE * GRID * 0.35).toFixed(6));
const FRESNEL_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 8).toFixed(4));

// Multiple IFS roots at log-spaced delays to cover soliton spatial frequencies
const N_FRESNEL_ROOTS = 16;

// Cycle timing: CYCLE ticks auto-advance if no click
// Safety: CYCLE × REFLECTOR_MS >> FRESNEL_DONE_DELAY × SUBTICK_MS
const CYCLE = 1;

// Level-of-detail: coarser strides at deeper depths (fine shells, negligible)
const LOD = [1, 1, 1, 1];  // stride for source scan; 0 = skip

// ── IFS-native Laplacian coupling ────────────────────────────────────────────
// No explicit fractional order s — it emerges from the IFS contraction geometry.
// FRAC_ALPHA is the total coupling budget shared across all IFS-discovered rings.
// Each ring r gets weight FRAC_ALPHA × count(r) / totalBeats (empirical IFS measure).
const FRAC_ALPHA = 0.08;

// ── World program ─────────────────────────────────────────────────────────────

const nls3WorldProgram = `
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
  const LOD              = ${JSON.stringify(LOD)};
  const FRAC_ALPHA       = ${FRAC_ALPHA};
  const TWO_PI           = 2 * Math.PI;
  const _PHI     = 1.6180339887;   // golden ratio — inverse IFS contraction
  const _PHI_INV = 0.6180339887;   // IFS contraction ratio (1/φ)

  ${FRAG.nlsOps(GRID, N_CELLS)}
  ${FRAG.ifsStencil(GRID)}
  ${FRAG.ifsKernels}
  ${FRAG.specCorr(GRID, N_CELLS, IFS_DEPTH)}
  ${FRAG.ifsScheduler}

  // ── Initial field: 3 solitons in equilateral triangle, converging ─────────
  // Their total momentum is zero (symmetry) — they collide at center.
  // The collision is the "instanton" — topological tunneling between
  // three-soliton vacuum states via the IFS fractal time axis.
  const _initField = () => {
    const cx = GRID/2, cy = GRID/2, r0 = GRID * 0.22;
    let psi = new Array(2 * NCELLS).fill(0);
    const v = SOL_V;
    const tri = [
      { sx: cx,                sy: cy - r0,      vx:  0,          vy:  v        },
      { sx: cx - r0*0.866,    sy: cy + r0*0.5,  vx:  v*0.866,    vy: -v*0.5    },
      { sx: cx + r0*0.866,    sy: cy + r0*0.5,  vx: -v*0.866,    vy: -v*0.5    },
    ];
    for (const { sx, sy, vx, vy } of tri)
      psi = _addSoliton(psi, sx, sy, SOL_AMP, vx, vy, SOL_W);
    return psi;
  };

  // ── Two-soliton head-on collision ─────────────────────────────────────────
  // Sub-critical 2D solitons (amp=1.0, w=2): each has power N≈17 << N_c≈47.
  // The 3-soliton IC uses SOL_AMP=2/SOL_W=6 which is 13× supercritical in 2D
  // and collapses into ISAT-limited hot spots before reaching the collision point.
  // Here smaller solitons stay coherent and pass through with a phase shift.
  const _initField2 = () => {
    const cx = GRID/2, cy = GRID/2, r0 = GRID * 0.30;
    let psi = new Array(2 * NCELLS).fill(0);
    psi = _addSoliton(psi, cx - r0, cy, 1.0, +1.0, 0, 2);
    psi = _addSoliton(psi, cx + r0, cy, 1.0, -1.0, 0, 2);
    return psi;
  };

  // ── Seed RNG and launch one IFS Fresnel cycle ─────────────────────────────
  const _launchCycle = (s, ctx, cycleId) => {
    // Step 1: exact nonlinear half-step
    const psi_nl  = _nlHalf(s.psi, DT * 0.5);
    const power_nl = _power(psi_nl);
    // Step 2 is DEFERRED: IFS beats will register radii, finalizeFresnelm applies
    // _linearStepIFS with the IFS-discovered Riesz kernel quadrature nodes.
    // Deterministic RNG seed from cycle index
    let h = (cycleId | 0) ^ 0xdeadbeef;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    W.rng.seed((h ^ (h >>> 16)) >>> 0);
    // Launch N_FRESNEL_ROOTS IFS subtrees at log-spaced delays
    // Log spacing ensures uniform coverage of spatial frequency bands
    const logMin = Math.log(IFS_MIN_DELAY * 2.0);
    const logMax = Math.log(IFS_BASE_DELAY);
    for (let i = 0; i < N_FRESNEL_ROOTS; i++) {
      const t     = N_FRESNEL_ROOTS === 1 ? 1 : i / (N_FRESNEL_ROOTS - 1);
      const delay = Math.exp(logMin + t * (logMax - logMin));
      ctx.future(0, 'fresnelBeat', { depth: 0, delay, gen: 0, cycleId });
    }
    ctx.future(FRESNEL_DONE_DELAY, 'finalizeFresnelm', { cycleId, power_nl });
    return {
      ...s, psi_nl, psi_new: null, power_nl, cycleId,
      cycleCount: (s.cycleCount ?? 0) + 1,
      _active: true,
      _beatCount: 0, _beatDepth: 0,
      fresnelEnergy: new Array(IFS_DEPTH).fill(0),
      fresnelEvents: [],
      fracKernel: [],     // IFS beats accumulate radii here (with repetition)
      ifsWeightsStr: '',  // normalized per-ring weights from IFS measure
      ifsSEff: 0,         // emergent fractional order estimated from log-log slope
    };
  };

  const nls = Behaviors.collect(
    {
      psi:      new Array(2 * ${N_CELLS}).fill(0),
      psi_nl:   null,
      psi_new:  null,
      time:     0,
      power0:   1,
      power_nl: 1,
      cycleId:  0,
      cycleCount: 0,
      _active:  false,
      _beatCount:  0,
      _beatDepth:  0,
      fresnelEnergy: new Array(${IFS_DEPTH}).fill(0),
      fresnelEvents: [],
      specCorr: new Array(${IFS_DEPTH}).fill(0),
      specN:    new Array(${IFS_DEPTH}).fill(0),
      fracKernel: [],
      ifsNBands: 0,
      ifsRadiiStr: '',
      _queue: [],
      _pendingInject: null,
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent) {
        const t = pulse._eventPayload?.type;
        if (t === 'inject' || t === 'nextCycle' || t === 'resetToA' || t === 'resetTo2') {
          const entry = { fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} };
          s = { ...s, _queue: [entry, ...(s._queue ?? [])] };
        }
      }
      return W.reduce(s, pulse, 'nls3', {

        __macro: (s, p, ctx) => {
          if (p.isSubTick) return s;
          const tick = p.logicalTime;
          if (tick === 1) {
            ctx.future(100, '_keepalive', {});
            const psi    = _initField();
            const power0 = _power(psi);
            return _launchCycle({ ...s, psi, power0 }, ctx, tick);
          }
          // Auto-advance every CYCLE ticks when idle (fallback if no click)
          if (tick % CYCLE === 0 && !s._active) {
            return _launchCycle(s, ctx, tick);
          }
          return s;
        },

        _keepalive: (s, p, ctx) => { ctx.future(100, '_keepalive', {}); return s; },

        fresnelBeat: (s, p, ctx) => {
          if (p.cycleId !== s.cycleId) return s;
          const { depth, delay } = p;
          _ifsFireChildren(ctx, p, 'fresnelBeat', 'fresnelBeat');
          const ri = Math.max(1, Math.round(delay / DELAY_SCALE));
          const fracKernel = ri < (GRID >> 1)
            ? [...(s.fracKernel ?? []), ri]
            : (s.fracKernel ?? []);
          const fresnelEnergy = s.fresnelEnergy.slice();
          fresnelEnergy[depth] = Math.min(1, (fresnelEnergy[depth] ?? 0) + 0.3);
          const fresnelEvents  = [...(s.fresnelEvents ?? []).slice(-80),
            { d: depth, delay, wt: ctx.wallTime }];
          return { ...s, _beatCount: s._beatCount+1, _beatDepth: depth,
            fresnelEnergy, fresnelEvents, fracKernel };
        },

        finalizeFresnelm: (s, p, ctx) => {
          if (p.cycleId !== s.cycleId) return s;
          const { fRadii, fWeights, sEff } = _buildNativeKernel(s.fracKernel ?? [], FRAC_ALPHA);
          const psi_new = _linearStepIFS(s.psi_nl, DT, fRadii, fWeights);
          const stepped = _nlHalf(psi_new, DT * 0.5);
          const pNew = _power(stepped);
          const scale = pNew > 1e-9 ? Math.sqrt(s.power_nl / pNew) : 1;
          let psi = stepped.slice();
          for (let j = 0; j < NCELLS; j++) { psi[j*2] *= scale; psi[j*2+1] *= scale; }
          const inj = s._pendingInject;
          if (inj) psi = _addSoliton(psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w);
          const specCorr = s.psi_nl ? _computeSpecCorr(s.psi_nl) : new Array(IFS_DEPTH).fill(0);
          return { ...s,
            psi, psi_nl: null, psi_new: null,
            time: (s.time ?? 0) + DT, _active: false,
            _beatCount: 0, _beatDepth: 0, _pendingInject: null,
            specCorr, specN: new Array(IFS_DEPTH).fill(0),
            fracKernel: [],
            ifsNBands: fRadii.length,
            ifsRadiiStr: fRadii.join(','),
            ifsWeightsStr: fWeights.map(w => w.toFixed(3)).join(','),
            ifsSEff: sEff,
          };
        },

        // ── Reset to initial 3-soliton state (replicated) ────────────────────
        resetToA: (s, p, ctx) => {
          const psi    = _initField();
          const power0 = _power(psi);
          return { ...s, psi, power0, time: 0, cycleCount: 0,
            cycleId: s.cycleId + 1, _active: false,
            psi_nl: null, psi_new: null, _pendingInject: null };
        },

        resetTo2: (s, p, ctx) => {
          const psi    = _initField2();
          const power0 = _power(psi);
          return { ...s, psi, power0, time: 0, cycleCount: 0,
            cycleId: s.cycleId + 1, _active: false,
            psi_nl: null, psi_new: null, _pendingInject: null };
        },

        // ── Click-triggered next cycle (replicated to all peers) ─────────────
        nextCycle: (s, p, ctx) => {
          if (s._active) return s;
          return _launchCycle(s, ctx, ctx.wallTime + 1);
        },

        // ── Inject soliton — if cycle active, queue for finalization ─────────
        inject: (s, p, ctx) => {
          const inj = { sx: p.sx, sy: p.sy, vx: p.vx ?? 0, vy: p.vy ?? 0,
            amp: p.amp ?? SOL_AMP, w: p.w ?? SOL_W };
          if (s._active) return { ...s, _pendingInject: inj };
          const psi = _addSoliton(s.psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w);
          return { ...s, psi, power0: _power(psi), _pendingInject: null };
        },

      });
    }
  );

  const _isStable = W.stable([nls], reflector);
  const _export   = W.export(Renkon, { nls3: nls }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeNls3Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    if (!document.getElementById('nls3-wrap')) {
      const wrap = document.createElement('div');
      wrap.id = 'nls3-wrap';
      Object.assign(wrap.style, { display: 'flex', gap: '0', flexWrap: 'wrap' });
      document.body.appendChild(wrap);
    }

    const root = document.createElement('div');
    root.id = containerId;
    Object.assign(root.style, {
      fontFamily: 'ui-monospace,monospace', padding: '14px',
      background: '#000', color: '#eee', borderRadius: '10px',
      margin: '10px', flex: '1', minWidth: '500px', border: '1px solid #111',
    });
    document.getElementById('nls3-wrap').appendChild(root);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '11px', fontWeight: 'bold', marginBottom: '8px',
      letterSpacing: '1px', textAlign: 'center', color: '#0cf',
    });
    root.appendChild(title);

    // ── CSS grid layout: IFS clock | intensity | phase ────────────────────
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: '108px 1fr 1fr',
      gap: '6px',
      alignItems: 'start',
    });
    root.appendChild(grid);

    // ── IFS clock viz panel ────────────────────────────────────────────────
    const ifsClock = makeIFSClockPanel({ label: 'FRESNEL IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    grid.appendChild(ifsClock.el);

    // ── Data canvas helper ─────────────────────────────────────────────────
    const makeDataCell = (label, color) => {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('div');
      Object.assign(lbl.style, { fontSize: '8px', color, textAlign: 'center', marginBottom: '3px', letterSpacing: '0.5px' });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = GRID; canvas.height = GRID;
      Object.assign(canvas.style, { width: '100%', height: 'auto', imageRendering: 'pixelated', borderRadius: '3px', display: 'block', cursor: 'crosshair' });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    const intCell   = makeDataCell('INTENSITY  |ψ|²  (hot — click to inject soliton)', '#f84');
    const phaseCell = makeDataCell('PHASE  arg(ψ)  (hue wheel)', '#4af');
    grid.appendChild(intCell.wrap);
    grid.appendChild(phaseCell.wrap);

    // Stats row spanning all columns
    const statsRow = document.createElement('div');
    statsRow.style.gridColumn = '1 / -1';
    root.appendChild(statsRow);
    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, { fontSize: '9px', color: '#333', marginTop: '6px', textAlign: 'center' });
    statsRow.appendChild(stats);

    // ── Reset buttons ─────────────────────────────────────────────────────
    const resetBar = document.createElement('div');
    Object.assign(resetBar.style, { textAlign: 'center', marginTop: '8px', display: 'flex', gap: '6px', justifyContent: 'center' });
    const mkBtn = (label, color, handler) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: color, color: '#000', border: 'none', borderRadius: '4px',
        padding: '4px 14px', fontSize: '9px', cursor: 'pointer',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold',
      });
      b.addEventListener('click', handler);
      return b;
    };
    resetBar.appendChild(mkBtn('Phase A  ↺  reset',   '#0d6', () => injectEvent?.({ type: 'resetToA' })));
    resetBar.appendChild(mkBtn('2-soliton  ↔  collision', '#0af', () => injectEvent?.({ type: 'resetTo2' })));
    root.appendChild(resetBar);

    const intCtx   = intCell.ctx;
    const phaseCtx = phaseCell.ctx;
    const intBuf   = intCtx.createImageData(GRID, GRID);
    const phaseBuf = phaseCtx.createImageData(GRID, GRID);

    // ── Click → inject soliton (replicated) ──────────────────────────────
    const PX = intCell.canvas.getBoundingClientRect().width / GRID || 6;
    const onInjectClick = (canvas) => (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = canvas.getBoundingClientRect().width / GRID;
      const sx = Math.floor((e.clientX - rect.left) / px);
      const sy = Math.floor((e.clientY - rect.top)  / px);
      if (sx >= 0 && sx < GRID && sy >= 0 && sy < GRID) {
        injectEvent?.({ type: 'inject', sx, sy, vx: 0, vy: 0 });
      }
    };
    intCell.canvas.addEventListener('click', onInjectClick(intCell.canvas));
    phaseCell.canvas.addEventListener('click', onInjectClick(phaseCell.canvas));

    // ── Also: click anywhere → advance cycle (replicated) ─────────────────
    root.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));



    // ── Main render function ──────────────────────────────────────────────
    return () => {
      const n = world.getNodeState('nls3');
      if (!n?.psi) return;

      const psi = n.psi;
      const lt  = world.ps.app.logicalTime ?? 0;

      // Find max intensity for normalization
      let maxI = 1e-9;
      for (let j = 0; j < N_CELLS; j++) {
        const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
        if (v > maxI) maxI = v;
      }
      const norm = 1 / Math.sqrt(maxI);
      const logS = 1 / Math.log(1 + 9);

      for (let j = 0; j < N_CELLS; j++) {
        const re = psi[j*2], im = psi[j*2+1];
        const amp = Math.sqrt(re*re + im*im) * norm;
        // Intensity: log scale hot colormap
        const lv = Math.log(1 + 9 * amp) * logS;
        const [hr, hg, hb] = colormaps.hot(lv);
        intBuf.data[j*4]   = hr;
        intBuf.data[j*4+1] = hg;
        intBuf.data[j*4+2] = hb;
        intBuf.data[j*4+3] = 255;
        // Phase: hue wheel
        const [pr, pg, pb] = colormaps.phase(re, im, norm);
        phaseBuf.data[j*4]   = pr;
        phaseBuf.data[j*4+1] = pg;
        phaseBuf.data[j*4+2] = pb;
        phaseBuf.data[j*4+3] = 255;
      }
      intCtx.putImageData(intBuf, 0, 0);
      phaseCtx.putImageData(phaseBuf, 0, 0);

      // Title
      const isActive = !!n._active;
      const depth    = n._beatDepth ?? 0;
      const beats    = n._beatCount ?? 0;
      title.style.color = isActive ? '#fa0' : '#a70';
      title.textContent =
        `PEER ${peerId} · NLS3  (IFS-native Laplacian — ${n.ifsNBands ?? 0} bands  s≈${(n.ifsSEff ?? 0).toFixed(3)})  ` +
        (isActive ? `[FRESNEL ◉ D${depth} · ${beats} beats]` : `[IDLE — click to evolve]`);

      // Power conservation
      let power = 0;
      for (let j = 0; j < N_CELLS; j++) power += psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
      const ratio = (n.power0 ?? 0) > 0 ? power / n.power0 : 1;

      // Spectral peak depth — shows where spatial correlation concentrates
      const sc = n.specCorr ?? [];
      const scPeak = sc.length ? sc.indexOf(Math.max(...sc)) : -1;
      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `t=${(n.time ?? 0).toFixed(1)}  max|ψ|²=${maxI.toFixed(2)}` +
        `  power=${ratio.toFixed(4)}  cycle=${n.cycleCount ?? 0}` +
        `  γ=${GAMMA}  Isat=${ISAT}` +
        `  ifsR=[${n.ifsRadiiStr ?? ''}] nBands=${n.ifsNBands ?? 0}` +
        `  w=[${n.ifsWeightsStr ?? ''}]  s_eff=${(n.ifsSEff ?? 0).toFixed(3)}` +
        `  psd=[${sc.map(v => v.toFixed(2)).join(',')}] peak=d${scPeak}` +
        `  ${_clientBadge(world)}`;

      // IFS clock panel update
      let vizSnap = (n.specCorr ?? []).map(c => Math.max(0, Math.min(1, c)));
      if (vizSnap.every(v => v === 0)) vizSnap = n.fresnelEnergy ?? [];
      ifsClock.update({ energy: vizSnap, events: n.fresnelEvents ?? [], isActive, lt });

      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'NLS3 | IFS-Native Laplacian (Emergent s)',
  selo:        'nls3',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [nls3WorldProgram + av],
  makeRenderer: makeNls3Renderer,
  wrapId:      'nls3-wrap',
  hideTopBar:  true,
};
