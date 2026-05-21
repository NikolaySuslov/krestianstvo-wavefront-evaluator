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
const GRID    = 64;
const N_CELLS = GRID * GRID;

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH  = 5.0;
const DELAY_SCALE = 0.06;
const GAMMA       = -0.25;
const ISAT        = 20.0;     // saturation intensity (prevents 2D wave collapse)
const DT          = 0.2;

// ── Soliton parameters ────────────────────────────────────────────────────────
const SOL_AMP = 1.8;
const SOL_W   = 7;
const SOL_V   = 0.8;

// ── Topological parameters ────────────────────────────────────────────────────
const AUTO_INJECT_AT = 12;   // auto-inject instanton after this many cycles

// ── IFS fractal clock ─────────────────────────────────────────────────────────
const IFS_DEPTH     = 4;
const IFS_MAPS      = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP   = 5;
const IFS_MIN_DELAY = 0.10;
const IFS_BASE_DELAY     = parseFloat((DELAY_SCALE * GRID * 0.35).toFixed(6));
const FRESNEL_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 8).toFixed(4));
const N_FRESNEL_ROOTS    = 16;
const CYCLE = 1;
const LOD   = [1, 1, 1, 1];

// ── IFS-native Laplacian coupling ────────────────────────────────────────────
// No explicit fractional order s — it emerges from the IFS contraction geometry.
// FRAC_ALPHA is the total coupling budget; each ring r gets weight
// FRAC_ALPHA × count(r) / totalBeats (empirical IFS measure).
const FRAC_ALPHA = 0.02;

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
  const LOD              = ${JSON.stringify(LOD)};
  const FRAC_ALPHA       = ${FRAC_ALPHA};
  const TWO_PI           = 2 * Math.PI;
  const AUTO_INJECT_AT   = ${AUTO_INJECT_AT};


  ${FRAG.nlsOps(GRID, N_CELLS)}
  ${FRAG.ifsStencil(GRID)}
  ${FRAG.ifsKernels}
  ${FRAG.specCorr(GRID, N_CELLS, IFS_DEPTH)}
  ${FRAG.topoOps(GRID, N_CELLS)}
  ${FRAG.ifsScheduler}

  // ── Vacuum A: Q=0 — all solitons share the same carrier phase ────────────
  const _initVacuumA = () => {
    const cx = GRID/2, cy = GRID/2;
    let psi = new Array(2 * NCELLS).fill(0);
    psi = _addSoliton(psi, cx, cy, SOL_AMP * 1.4, 0, 0, SOL_W * 1.2, 0);
    return psi;
  };

  // ── Vacuum B: Q=±sign — 2π/3 relative phase offsets give net winding ─────
  const _initVacuumB = (sign) => {
    const cx = GRID/2, cy = GRID/2, r0 = GRID * 0.22;
    let psi = new Array(2 * NCELLS).fill(0);
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

  // ── Launch one Strang-split NLS cycle via IFS Fresnel tree ───────────────
  const _launchCycle = (s, ctx, cycleId) => {
    const psi_nl   = _nlHalf(s.psi, DT * 0.5);
    const power_nl = _power(psi_nl);
    // Linear step deferred: IFS beats register radii, finalizeFresnelm applies _linearStepIFS.
    let h = (cycleId | 0) ^ 0xdeadbeef;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    W.rng.seed((h ^ (h >>> 16)) >>> 0);
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
      _active: true, _beatCount: 0, _beatDepth: 0,
      fresnelEnergy: new Array(IFS_DEPTH).fill(0),
      fresnelEvents: [],
      fracKernel: [],
    };
  };

  const instanton3 = Behaviors.collect(
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
      _queue: [],
      vacuumState: 'A',
      autoInjected: false,
      fracKernel: [],
      ifsNBands: 0,
      ifsRadiiStr: '',
      ifsWeightsStr: '',
      ifsSEff: 0,
      _pendingInject: null,
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent) {
        const t = pulse._eventPayload?.type;
        if (['injectSoliton','injectVortex','nextCycle','setVacuumA','setVacuumB'].includes(t)) {
          const entry = { fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} };
          s = { ...s, _queue: [entry, ...(s._queue ?? [])] };
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
            return _launchCycle({ ...s, psi, power0, vacuumState: 'A', autoInjected: false }, ctx, tick);
          }
          if (tick % CYCLE === 0 && !s._active) {
            if (!s.autoInjected && (s.cycleCount ?? 0) >= AUTO_INJECT_AT) {
              const cx = GRID / 2, cy = GRID / 2;
              const psi = _addVortex(s.psi, cx, cy, 1);
              return _launchCycle({ ...s, psi, autoInjected: true, vacuumState: 'tunneling' }, ctx, tick);
            }
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
          const fresnelEvents  = [...(s.fresnelEvents ?? []).slice(-80), { d: depth, delay, wt: ctx.wallTime }];
          return { ...s, _beatCount: s._beatCount+1, _beatDepth: depth,
            fresnelEnergy, fresnelEvents, fracKernel };
        },

        finalizeFresnelm: (s, p, ctx) => {
          if (p.cycleId !== s.cycleId) return s;
          const { fRadii, fWeights, sEff } = _buildNativeKernel(s.fracKernel ?? [], FRAC_ALPHA);
          const psi_new = _linearStepIFS(s.psi_nl, DT, fRadii, fWeights);
          const stepped = _nlHalf(psi_new, DT * 0.5);
          const pNew    = _power(stepped);
          const scale   = pNew > 1e-9 ? Math.sqrt(s.power_nl / pNew) : 1;
          let psi = stepped.slice();
          for (let j = 0; j < NCELLS; j++) { psi[j*2] *= scale; psi[j*2+1] *= scale; }
          const inj = s._pendingInject;
          if (inj?.kind === 'soliton')
            psi = _addSoliton(psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w, 0);
          else if (inj?.kind === 'vortex')
            psi = _addVortex(psi, inj.ox, inj.oy, inj.charge);
          const specCorr = s.psi_nl ? _computeSpecCorr(s.psi_nl) : new Array(IFS_DEPTH).fill(0);
          return { ...s, psi, psi_nl: null, psi_new: null,
            time: (s.time ?? 0) + DT, _active: false, _beatCount: 0, _beatDepth: 0,
            fracKernel: [],
            ifsNBands: fRadii.length,
            ifsRadiiStr: fRadii.join(','),
            ifsWeightsStr: fWeights.map(w => w.toFixed(3)).join(','),
            ifsSEff: sEff,
            vacuumState: inj?.kind === 'vortex' ? 'tunneling' : s.vacuumState,
            autoInjected: inj?.kind === 'vortex' ? true : s.autoInjected,
            _pendingInject: null,
            specCorr, specN: new Array(IFS_DEPTH).fill(0) };
        },

        nextCycle: (s, p, ctx) => {
          if (s._active) return s;
          return _launchCycle(s, ctx, ctx.wallTime + 1);
        },

        // ── Inject soliton — if cycle active, queue for finalization ─────
        injectSoliton: (s, p, ctx) => {
          const inj = { kind: 'soliton', sx: p.sx, sy: p.sy,
            amp: p.amp ?? SOL_AMP, vx: p.vx ?? 0, vy: p.vy ?? 0, w: p.w ?? SOL_W };
          if (s._active) return { ...s, _pendingInject: inj };
          const psi = _addSoliton(s.psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w, 0);
          return { ...s, psi, power0: _power(psi), _pendingInject: null };
        },

        // ── Inject topological vortex — if cycle active, queue ───────────
        injectVortex: (s, p, ctx) => {
          const inj = { kind: 'vortex', ox: p.ox, oy: p.oy, charge: p.charge ?? 1 };
          if (s._active) return { ...s, _pendingInject: inj };
          const psi = _addVortex(s.psi, inj.ox, inj.oy, inj.charge);
          return { ...s, psi, power0: _power(psi), vacuumState: 'tunneling',
            autoInjected: true, _pendingInject: null };
        },

        // ── Reset to vacuum A (replicated) ───────────────────────────────
        setVacuumA: (s, p, ctx) => {
          const psi = _initVacuumA();
          return { ...s, psi, power0: _power(psi), vacuumState: 'A',
            autoInjected: false, time: 0, cycleCount: 0,
            cycleId: s.cycleId + 1, _active: false,
            psi_nl: null, psi_new: null, _pendingInject: null };
        },

        // ── Reset to vacuum B (replicated) ───────────────────────────────
        setVacuumB: (s, p, ctx) => {
          const psi = _initVacuumB(1);
          return { ...s, psi, power0: _power(psi), vacuumState: 'B',
            autoInjected: false, time: 0, cycleCount: 0,
            cycleId: s.cycleId + 1, _active: false,
            psi_nl: null, psi_new: null, _pendingInject: null };
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
    document.getElementById('instanton3-wrap').appendChild(root);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '11px', fontWeight: 'bold', marginBottom: '8px',
      letterSpacing: '1px', textAlign: 'center', color: '#f80',
    });
    root.appendChild(title);

    // ── CSS grid: IFS clock | intensity | topo charge density ─────────────
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid', gridTemplateColumns: '108px 1fr 1fr',
      gap: '6px', alignItems: 'start',
    });
    root.appendChild(grid);

    // IFS clock
    const ifsClock = makeIFSClockPanel({ label: 'FRESNEL IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    grid.appendChild(ifsClock.el);

    // Data canvas helper
    const makeDataCell = (label, color) => {
      const wrap   = document.createElement('div');
      const lbl    = document.createElement('div');
      Object.assign(lbl.style, { fontSize: '8px', color, textAlign: 'center', marginBottom: '3px', letterSpacing: '0.5px' });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = GRID; canvas.height = GRID;
      Object.assign(canvas.style, { width: '100%', height: 'auto', imageRendering: 'pixelated', borderRadius: '3px', display: 'block', cursor: 'crosshair' });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    const intCell    = makeDataCell('INTENSITY  |ψ|²  (click = soliton  right-click = vortex Q+1)', '#f84');
    const chargeCell = makeDataCell('TOPO CHARGE  q(x,y)   red=+1 vortex  blue=−1 anti-vortex', '#f64');
    grid.appendChild(intCell.wrap);
    grid.appendChild(chargeCell.wrap);

    // Stats row
    const statsRow = document.createElement('div');
    statsRow.style.gridColumn = '1 / -1';
    root.appendChild(statsRow);
    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, { fontSize: '9px', color: '#333', marginTop: '6px', textAlign: 'center' });
    statsRow.appendChild(stats);

    // ── Vacuum state bar ───────────────────────────────────────────────────
    const vacuumBar = document.createElement('div');
    Object.assign(vacuumBar.style, {
      display: 'flex', gap: '8px', alignItems: 'center',
      justifyContent: 'center', marginTop: '8px',
    });
    const mkBtn = (label, bg, handler) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: bg, color: '#000', border: 'none', borderRadius: '4px',
        padding: '4px 10px', fontSize: '9px', cursor: 'pointer',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold',
      });
      b.addEventListener('click', handler);
      return b;
    };
    const btnA = mkBtn('Phase A  Q=0',  '#0d6', () => injectEvent?.({ type: 'setVacuumA' }));
    const btnB = mkBtn('Phase B  Q=+1', '#f50', () => injectEvent?.({ type: 'setVacuumB' }));

    const tunnelLbl = document.createElement('div');
    tunnelLbl.id = containerId + '-tunnel-lbl';
    Object.assign(tunnelLbl.style, { fontSize: '10px', color: '#555', minWidth: '160px', textAlign: 'center' });
    tunnelLbl.textContent = '←  instanton  →';

    const windingLbl = document.createElement('div');
    windingLbl.id = containerId + '-winding';
    Object.assign(windingLbl.style, { fontSize: '11px', fontWeight: 'bold', color: '#888', minWidth: '60px', textAlign: 'right' });

    vacuumBar.appendChild(btnA);
    vacuumBar.appendChild(tunnelLbl);
    vacuumBar.appendChild(btnB);
    vacuumBar.appendChild(windingLbl);
    root.appendChild(vacuumBar);

    const intBuf    = intCell.ctx.createImageData(GRID, GRID);
    const chargeBuf = chargeCell.ctx.createImageData(GRID, GRID);

    // ── Click handlers ─────────────────────────────────────────────────────
    const _canvasCoords = (canvas, e) => {
      const rect = canvas.getBoundingClientRect();
      const px = rect.width / GRID;
      return [Math.floor((e.clientX - rect.left) / px),
              Math.floor((e.clientY - rect.top)  / px)];
    };
    [intCell.canvas, chargeCell.canvas].forEach(c => {
      // Left-click: inject soliton (immediately visible as intensity peak)
      c.addEventListener('click', (e) => {
        const [sx, sy] = _canvasCoords(c, e);
        if (sx >= 0 && sx < GRID && sy >= 0 && sy < GRID)
          injectEvent?.({ type: 'injectSoliton', sx, sy, vx: 0, vy: 0 });
      });
      // Right-click: inject vortex (topological charge imprint)
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const [ox, oy] = _canvasCoords(c, e);
        if (ox >= 0 && ox < GRID && oy >= 0 && oy < GRID)
          injectEvent?.({ type: 'injectVortex', ox, oy, charge: 1 });
      });
    });
    root.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));


    // ── Main render ────────────────────────────────────────────────────────
    return () => {
      const n = world.getNodeState('instanton3');
      if (!n?.psi) return;

      const psi = n.psi;
      const lt  = world.ps.app.logicalTime ?? 0;

      // Intensity — hot colormap
      let maxI = 1e-9;
      for (let j = 0; j < N_CELLS; j++) {
        const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
        if (v > maxI) maxI = v;
      }
      const norm = 1 / Math.sqrt(maxI);
      const logS = 1 / Math.log(1 + 9);
      for (let j = 0; j < N_CELLS; j++) {
        const amp = Math.sqrt(psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1]) * norm;
        const lv  = Math.log(1 + 9 * amp) * logS;
        const [r, g, b] = colormaps.hot(lv);
        intBuf.data[j*4] = r; intBuf.data[j*4+1] = g;
        intBuf.data[j*4+2] = b; intBuf.data[j*4+3] = 255;
      }
      intCell.ctx.putImageData(intBuf, 0, 0);

      // Topological charge density — spread each vortex core into a 3×3 glow
      // so point-like ±1 cores are visible rather than isolated pixels
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
      for (let j = 0; j < N_CELLS; j++) {
        const [r, g, b] = colormaps.charge(qGlow[j]);
        chargeBuf.data[j*4] = r; chargeBuf.data[j*4+1] = g;
        chargeBuf.data[j*4+2] = b; chargeBuf.data[j*4+3] = 255;
      }
      chargeCell.ctx.putImageData(chargeBuf, 0, 0);

      // Total winding number
      let Q = 0;
      for (let i = 0; i < N_CELLS; i++) if (Math.abs(qField[i]) > 0.4) Q += Math.round(qField[i]);

      // Vacuum state labels
      const vs       = n.vacuumState ?? 'A';
      const isActive = !!n._active;
      const depth    = n._beatDepth ?? 0;
      const beats    = n._beatCount ?? 0;

      title.style.color = vs === 'tunneling' ? '#f80' : (vs === 'B' ? '#f50' : '#0d6');
      title.textContent =
        `PEER ${peerId} · INSTANTON3  (IFS-native Laplacian  s≈${(n.ifsSEff ?? 0).toFixed(3)})  ` +
        (isActive ? `[FRESNEL ◉ D${depth} · ${beats} beats]`
                  : `[${vs === 'A' ? 'VACUUM A' : vs === 'B' ? 'VACUUM B' : 'TUNNELING'} — click to inject]`);

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

      // Power conservation
      let power = 0;
      for (let j = 0; j < N_CELLS; j++) power += psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
      const ratio = (n.power0 ?? 0) > 0 ? power / n.power0 : 1;

      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `t=${(n.time ?? 0).toFixed(1)}  max|ψ|²=${maxI.toFixed(2)}` +
        `  power=${ratio.toFixed(4)}  cycle=${n.cycleCount ?? 0}` +
        `  Q=${Q >= 0 ? '+' : ''}${Q}  γ=${GAMMA}  λ=${WAVELENGTH}` +
        `  ifsR=[${n.ifsRadiiStr ?? ''}] nBands=${n.ifsNBands ?? 0}` +
        `  w=[${n.ifsWeightsStr ?? ''}]  s_eff=${(n.ifsSEff ?? 0).toFixed(3)}` +
        (() => { const sc = n.specCorr ?? [];
                 const pk = sc.length ? sc.indexOf(Math.max(...sc)) : -1;
                 return `  psd=[${sc.map(v => v.toFixed(2)).join(',')}] peak=d${pk}`; })() +
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
  title:       'Instanton3 | IFS-Native Laplacian (Emergent s)',
  selo:        'instanton3',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [instanton3WorldProgram + av],
  makeRenderer: makeInstanton3Renderer,
  wrapId:      'instanton3-wrap',
  hideTopBar:  true,
};
