/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── Wavelet1 | IFS-Native Wavelet Transform ───────────────────────────────────
//
// The IFS beat cascade defines a multiresolution analysis of the 2D intensity
// field |ψ(x)|².  Each depth level d of the IFS tree fires beats at a specific
// range of radii — those radii form the analysis filter for sub-band d.
//
// Analysis (forward WT):
//   C_d(x) = Σ_{(r,w)∈band_d}  w · ring_avg(|ψ|², x, r)
//   ring_avg: mean of |ψ|² sampled at the 4 axis-aligned ring pixels of radius r
//
// Synthesis (inverse WT):
//   ψ_rec(x) = Σ_d Σ_{(r,w)∈band_d}  w · ring_avg(C_d, x, r)
//   (adjoint of analysis — same ring kernel, applied to sub-band images)
//
// Residual = |ψ|² − ψ_rec  (reconstruction error)
//
// The IFS geometry determines which spatial scales land in each depth band.
// IFS_MAPS contraction ratios {0.309…0.732} → band d covers radii ≈
// IFS_BASE_DELAY × (product of d contractions) / DELAY_SCALE.
//
// Click on the intensity canvas → inject a new soliton (replicated to peers).
// Double-click → advance cycle.

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
const SUBTICK_MS   = 1;

// ── Grid ─────────────────────────────────────────────────────────────────────
const GRID    = 64;
const N_CELLS = GRID * GRID;

// ── Physical parameters (NLS field used as input signal) ──────────────────────
const GAMMA       = -0.25;
const ISAT        = 20.0;
const DT          = 0.1;
const DELAY_SCALE = 0.06;

// ── Soliton initial conditions ────────────────────────────────────────────────
const SOL_AMP = 2.0;
const SOL_W   = 6;
const SOL_V   = 0.8;

// ── IFS wavelet clock ─────────────────────────────────────────────────────────
// Each depth band d gets a dedicated delay range:
//   band 0 (coarse): [BASE/2,  BASE]      → radii ~11..22 px
//   band 1:          [BASE/4,  BASE/2]    → radii ~6..11 px
//   band 2:          [BASE/8,  BASE/4]    → radii ~3..6 px
//   band 3 (fine):   [BASE/16, BASE/8]    → radii ~1..3 px
// Within each band the IFS self-similarly spawns children that stay in-band
// (gen-only recursion, no depth-increment). This gives true octave bands.
const IFS_DEPTH     = 4;
const IFS_MAPS      = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP   = 6;
const IFS_MIN_DELAY = 0.06;
const IFS_BASE_DELAY    = parseFloat((DELAY_SCALE * GRID * 0.35).toFixed(6));
const WAVELET_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 10).toFixed(4));
const N_WT_ROOTS    = 4;  // roots per depth band
const CYCLE = 1;
const FRAC_ALPHA    = 0.08;

// ── World program ─────────────────────────────────────────────────────────────
const wavelet1WorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const GRID             = ${GRID};
  const NCELLS           = ${N_CELLS};
  const GAMMA            = ${GAMMA};
  const ISAT             = ${ISAT};
  const DT               = ${DT};
  const DELAY_SCALE      = ${DELAY_SCALE};
  const SOL_AMP          = ${SOL_AMP};
  const SOL_W            = ${SOL_W};
  const SOL_V            = ${SOL_V};
  const IFS_DEPTH        = ${IFS_DEPTH};
  const IFS_MAPS         = ${JSON.stringify(IFS_MAPS)};
  const IFS_GEN_CAP      = ${IFS_GEN_CAP};
  const IFS_MIN_DELAY    = ${IFS_MIN_DELAY};
  const IFS_BASE_DELAY   = ${IFS_BASE_DELAY};
  const WAVELET_DONE_DELAY = ${WAVELET_DONE_DELAY};
  const N_WT_ROOTS       = ${N_WT_ROOTS};
  const CYCLE            = ${CYCLE};
  const FRAC_ALPHA       = ${FRAC_ALPHA};
  const TWO_PI           = 2 * Math.PI;

  ${FRAG.nlsOps(GRID, N_CELLS)}
  ${FRAG.ifsKernels}
  ${FRAG.ifsWavelet(GRID, N_CELLS, IFS_DEPTH)}

  // ── Initial field: 3 converging solitons ─────────────────────────────────
  const _initField = () => {
    const cx = GRID/2, cy = GRID/2, r0 = GRID * 0.22;
    let psi = new Array(2 * NCELLS).fill(0);
    const v = SOL_V;
    [
      { sx: cx,            sy: cy - r0,      vx:  0,        vy:  v     },
      { sx: cx - r0*0.866, sy: cy + r0*0.5,  vx:  v*0.866,  vy: -v*0.5 },
      { sx: cx + r0*0.866, sy: cy + r0*0.5,  vx: -v*0.866,  vy: -v*0.5 },
    ].forEach(({ sx, sy, vx, vy }) => {
      psi = _addSoliton(psi, sx, sy, SOL_AMP, vx, vy, SOL_W);
    });
    return psi;
  };

  // ── Launch one IFS wavelet analysis cycle ─────────────────────────────────
  // Each depth band d gets exclusive delay range [BASE/2^(d+1), BASE/2^d].
  // Roots within each band fire gen-only IFS subtrees (no depth increment),
  // so each sub-tree stays in its own octave — true multiresolution bands.
  const _launchCycle = (s, ctx, cycleId) => {
    let h = (cycleId | 0) ^ 0xdeadbeef;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    W.rng.seed((h ^ (h >>> 16)) >>> 0);
    for (let d = 0; d < IFS_DEPTH; d++) {
      // octave d: delay in [BASE >> (d+1), BASE >> d]  (halving each band)
      const bandMax = IFS_BASE_DELAY / Math.pow(2, d);
      const bandMin = Math.max(IFS_MIN_DELAY, IFS_BASE_DELAY / Math.pow(2, d + 1));
      for (let i = 0; i < N_WT_ROOTS; i++) {
        const t     = N_WT_ROOTS === 1 ? 1 : i / (N_WT_ROOTS - 1);
        const delay = bandMin + t * (bandMax - bandMin);
        ctx.future(0, 'wtBeat', { depth: d, delay, gen: 0, cycleId });
      }
    }
    ctx.future(WAVELET_DONE_DELAY, 'finalizeWavelet', { cycleId });
    return {
      ...s, cycleId, cycleCount: (s.cycleCount ?? 0) + 1,
      _active: true, _beatCount: 0, _beatDepth: 0,
      fresnelEnergy: new Array(IFS_DEPTH).fill(0),
      fresnelEvents: [],
      fracKernel: [],
      fracKernelByDepth: Array.from({ length: IFS_DEPTH }, () => []),
    };
  };

  const wavelet1 = Behaviors.collect(
    {
      psi:      new Array(2 * ${N_CELLS}).fill(0),
      time:     0,
      power0:   1,
      cycleId:  0,
      cycleCount: 0,
      _active:  false,
      _beatCount:  0,
      _beatDepth:  0,
      fresnelEnergy: new Array(${IFS_DEPTH}).fill(0),
      fresnelEvents: [],
      fracKernel: [],
      fracKernelByDepth: Array.from({ length: ${IFS_DEPTH} }, () => []),
      wtBands:   null,
      wtRecon:   null,
      wtBandEnergy: new Array(${IFS_DEPTH}).fill(0),
      wtBandRadii:  new Array(${IFS_DEPTH}).fill('-'),
      ifsNBands: 0,
      _queue: [],
      _pendingInject: null,
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent) {
        const t = pulse._eventPayload?.type;
        if (t === 'inject' || t === 'nextCycle' || t === 'resetField') {
          const entry = { fireAt: pulse.wallTime, msg: t, payload: pulse._eventPayload ?? {} };
          s = { ...s, _queue: [entry, ...(s._queue ?? [])] };
        }
      }
      return W.reduce(s, pulse, 'wavelet1', {

        __macro: (s, p, ctx) => {
          const tick = p.logicalTime;
          if (tick === 1) {
            ctx.future(100, '_keepalive', {});
            const psi    = _initField();
            const power0 = _power(psi);
            return _launchCycle({ ...s, psi, power0 }, ctx, tick);
          }
          if (tick % CYCLE === 0 && !s._active) {
            return _launchCycle(s, ctx, tick);
          }
          return s;
        },

        _keepalive: (s, p, ctx) => { ctx.future(100, '_keepalive', {}); return s; },

        // ── IFS wavelet beat: gen-only recursion within this depth's octave ──
        // depth is fixed for the lifetime of this sub-tree — no depth promotion.
        // Self-similar children shrink the delay but stay in the same band.
        wtBeat: (s, p, ctx) => {
          if (p.cycleId !== s.cycleId) return s;
          const { depth, delay, gen } = p;
          // Gen-only recursion: one self-similar child per beat
          const selfR     = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
          const selfDelay = delay * selfR;
          if (gen < IFS_GEN_CAP && selfDelay > IFS_MIN_DELAY)
            ctx.future(selfDelay, 'wtBeat', { depth, delay: selfDelay, gen: gen + 1, cycleId: s.cycleId });
          const ri = Math.max(1, Math.round(delay / DELAY_SCALE));
          // Each depth band d is exclusive to radii in [bandFloor_d, bandCeil_d).
          // bandFloor = round(BASE / 2^(d+1) / DELAY_SCALE), bandCeil = round(BASE / 2^d / DELAY_SCALE)
          // Only accept ri if it falls within this band's octave — deep gen children
          // can contract into lower bands; we drop those to keep octaves disjoint.
          const bandCeil  = Math.round(IFS_BASE_DELAY / Math.pow(2, depth)     / DELAY_SCALE);
          const bandFloor = Math.round(IFS_BASE_DELAY / Math.pow(2, depth + 1) / DELAY_SCALE);
          const inBand    = ri >= Math.max(1, bandFloor) && ri <= bandCeil && ri < (GRID >> 1);
          const fracKernel = inBand
            ? [...(s.fracKernel ?? []), ri]
            : (s.fracKernel ?? []);
          const fracKernelByDepth = s.fracKernelByDepth.map((a, d) =>
            d === depth && inBand ? [...a, ri] : a
          );
          const fresnelEnergy = s.fresnelEnergy.slice();
          fresnelEnergy[depth] = Math.min(1, (fresnelEnergy[depth] ?? 0) + 0.3);
          const fresnelEvents  = [...(s.fresnelEvents ?? []).slice(-80),
            { d: depth, delay, wt: ctx.wallTime }];
          return { ...s, _beatCount: s._beatCount+1, _beatDepth: depth,
            fresnelEnergy, fresnelEvents, fracKernel, fracKernelByDepth };
        },

        // ── Finalize: build depth kernels, analyze psi, synthesize, compute residual ──
        finalizeWavelet: (s, p, ctx) => {
          if (p.cycleId !== s.cycleId) return s;
          const kernelByDepth = _buildDepthKernels(s.fracKernelByDepth, FRAC_ALPHA);
          const wtBands    = _ifsAnalyze(s.psi, kernelByDepth);
          const wtRecon    = _ifsSynthesize(wtBands, kernelByDepth);
          // Advance field by pure NL phase rotation (NL half-step × 2 = full DT)
          let psi = _nlHalf(_nlHalf(s.psi, DT * 0.5), DT * 0.5);
          const inj = s._pendingInject;
          if (inj) psi = _addSoliton(psi, inj.sx, inj.sy, inj.amp, inj.vx, inj.vy, inj.w);
          // band spatial std-dev: captures how much structure each band resolves
          const wtBandEnergy = wtBands.map(b => {
            let mean = 0;
            for (let i = 0; i < ${N_CELLS}; i++) mean += b[i];
            mean /= ${N_CELLS};
            let v = 0;
            for (let i = 0; i < ${N_CELLS}; i++) v += (b[i] - mean) * (b[i] - mean);
            return Math.sqrt(v / ${N_CELLS});
          });
          // band radius ranges from per-depth kernels
          const wtBandRadii = kernelByDepth.map(kb =>
            kb.radii.length ? kb.radii[0] + '..' + kb.radii[kb.radii.length - 1] : '-'
          );
          const { fRadii: fr2 } = _buildNativeKernel(s.fracKernel ?? [], FRAC_ALPHA);
          return { ...s,
            psi, time: (s.time ?? 0) + DT,
            _active: false, _beatCount: 0, _beatDepth: 0, _pendingInject: null,
            fracKernel: [], fracKernelByDepth: Array.from({ length: IFS_DEPTH }, () => []),
            wtBands: wtBands.map(b => Array.from(b)),
            wtRecon: Array.from(wtRecon),
            wtBandEnergy,
            wtBandRadii,
            ifsNBands: fr2.length,
          };
        },

        nextCycle: (s, p, ctx) => {
          if (s._active) return s;
          return _launchCycle(s, ctx, ctx.wallTime + 1);
        },

        resetField: (s, p, ctx) => {
          const psi    = _initField();
          const power0 = _power(psi);
          return { ...s, psi, power0, time: 0, cycleCount: 0,
            cycleId: s.cycleId + 1, _active: false, _pendingInject: null,
            wtBands: null, wtRecon: null };
        },

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

  const _isStable = W.stable([wavelet1], reflector);
  const _export   = W.export(Renkon, { wavelet1 }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeWavelet1Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    if (!document.getElementById('wavelet1-wrap')) {
      const wrap = document.createElement('div');
      wrap.id = 'wavelet1-wrap';
      Object.assign(wrap.style, { display: 'flex', gap: '0', flexWrap: 'wrap' });
      document.body.appendChild(wrap);
    }

    const root = document.createElement('div');
    root.id = containerId;
    Object.assign(root.style, {
      fontFamily: 'ui-monospace,monospace', padding: '14px',
      background: '#000', color: '#eee', borderRadius: '10px',
      margin: '10px', flex: '1', minWidth: '600px', border: '1px solid #111',
    });
    document.getElementById('wavelet1-wrap').appendChild(root);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '11px', fontWeight: 'bold', marginBottom: '8px',
      letterSpacing: '1px', textAlign: 'center', color: '#0cf',
    });
    root.appendChild(title);

    // Canvas helper
    const makeDataCell = (label, color) => {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('div');
      Object.assign(lbl.style, {
        fontSize: '7px', color, textAlign: 'center', marginBottom: '2px',
        letterSpacing: '0.3px', lineHeight: '1.3',
      });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = GRID; canvas.height = GRID;
      Object.assign(canvas.style, {
        width: '100%', height: 'auto', imageRendering: 'pixelated',
        borderRadius: '3px', display: 'block', cursor: 'crosshair',
      });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    // ── Row 1: IFS clock | intensity | band 0 | band 1 | band 2 | band 3 ─────
    const row1 = document.createElement('div');
    Object.assign(row1.style, {
      display: 'grid',
      gridTemplateColumns: '108px repeat(5, 1fr)',
      gap: '4px', alignItems: 'start', marginBottom: '4px',
    });
    root.appendChild(row1);

    const ifsClock = makeIFSClockPanel({ label: 'WAVELET IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    row1.appendChild(ifsClock.el);

    const intCell  = makeDataCell('INPUT  |ψ|²  (click = inject)', '#f84');
    row1.appendChild(intCell.wrap);

    const bandCells = IFS_DEPTH_COLORS.slice(0, IFS_DEPTH).map((c, d) => {
      const cell = makeDataCell(`BAND ${d}  C_${d}(x)`, c);
      row1.appendChild(cell.wrap);
      return cell;
    });

    // ── Row 2: (empty IFS clock col) | synth | residual ───────────────────────
    const row2 = document.createElement('div');
    Object.assign(row2.style, {
      display: 'grid',
      gridTemplateColumns: '108px repeat(5, 1fr)',
      gap: '4px', alignItems: 'start',
    });
    root.appendChild(row2);

    row2.appendChild(document.createElement('div')); // clock column spacer
    const synthCell = makeDataCell('SYNTH  Σ C_d⊛K_d', '#0f8');
    const residCell = makeDataCell('RESIDUAL  |ψ|²−rec', '#f44');
    row2.appendChild(synthCell.wrap);
    row2.appendChild(residCell.wrap);

    // Stats
    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, {
      fontSize: '9px', color: '#333', marginTop: '6px', textAlign: 'center',
    });
    root.appendChild(stats);

    // Controls
    const ctrlBar = document.createElement('div');
    Object.assign(ctrlBar.style, {
      display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '8px',
    });
    const mkBtn = (label, color, handler) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: color, color: '#000', border: 'none', borderRadius: '4px',
        padding: '4px 12px', fontSize: '9px', cursor: 'pointer',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold',
      });
      b.addEventListener('click', handler);
      return b;
    };
    ctrlBar.appendChild(mkBtn('Reset field ↺', '#0d6', () => injectEvent?.({ type: 'resetField' })));
    ctrlBar.appendChild(mkBtn('Next cycle ▶', '#0af', () => injectEvent?.({ type: 'nextCycle' })));
    root.appendChild(ctrlBar);

    // Image data buffers
    const intBuf    = intCell.ctx.createImageData(GRID, GRID);
    const bandBufs  = bandCells.map(c => c.ctx.createImageData(GRID, GRID));
    const synthBuf  = synthCell.ctx.createImageData(GRID, GRID);
    const residBuf  = residCell.ctx.createImageData(GRID, GRID);

    // Click → inject soliton
    const onInjectClick = (canvas) => (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = rect.width / GRID;
      const sx = Math.floor((e.clientX - rect.left) / px);
      const sy = Math.floor((e.clientY - rect.top)  / px);
      if (sx >= 0 && sx < GRID && sy >= 0 && sy < GRID)
        injectEvent?.({ type: 'inject', sx, sy, vx: 0, vy: 0 });
    };
    intCell.canvas.addEventListener('click', onInjectClick(intCell.canvas));
    root.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));

    const logS = 1 / Math.log(1 + 9);

    // ── Main render function ──────────────────────────────────────────────
    return () => {
      const n = world.getNodeState('wavelet1');
      if (!n?.psi) return;

      const psi = n.psi;
      const lt  = world.ps.app.logicalTime ?? 0;
      const isActive = !!n._active;

      // Input intensity
      let maxI = 1e-9;
      for (let j = 0; j < N_CELLS; j++) {
        const v = psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1];
        if (v > maxI) maxI = v;
      }
      const normI = 1 / Math.sqrt(maxI);
      for (let j = 0; j < N_CELLS; j++) {
        const amp = Math.sqrt(psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1]) * normI;
        const lv  = Math.log(1 + 9 * amp) * logS;
        const [r, g, b] = colormaps.hot(lv);
        intBuf.data[j*4] = r; intBuf.data[j*4+1] = g;
        intBuf.data[j*4+2] = b; intBuf.data[j*4+3] = 255;
      }
      intCell.ctx.putImageData(intBuf, 0, 0);

      // Sub-band images
      if (n.wtBands) {
        for (let d = 0; d < IFS_DEPTH; d++) {
          const band = n.wtBands[d];
          if (!band) continue;
          let maxB = 1e-30;
          for (let j = 0; j < N_CELLS; j++) if (band[j] > maxB) maxB = band[j];
          const buf = bandBufs[d];
          for (let j = 0; j < N_CELLS; j++) {
            const v = band[j] / maxB;
            const lv = Math.log(1 + 9 * v) * logS;
            const [r, g, b] = colormaps.wavelet(lv);
            buf.data[j*4] = r; buf.data[j*4+1] = g;
            buf.data[j*4+2] = b; buf.data[j*4+3] = 255;
          }
          bandCells[d].ctx.putImageData(buf, 0, 0);
        }
      }

      // Synthesized field
      if (n.wtRecon) {
        let maxS = 1e-30;
        for (let j = 0; j < N_CELLS; j++) if (n.wtRecon[j] > maxS) maxS = n.wtRecon[j];
        for (let j = 0; j < N_CELLS; j++) {
          const v  = n.wtRecon[j] / maxS;
          const lv = Math.log(1 + 9 * v) * logS;
          const [r, g, b] = colormaps.hot(lv);
          synthBuf.data[j*4] = r; synthBuf.data[j*4+1] = g;
          synthBuf.data[j*4+2] = b; synthBuf.data[j*4+3] = 255;
        }
        synthCell.ctx.putImageData(synthBuf, 0, 0);

        // Residual: normalized |ψ|² − normalized recon
        let maxR = 1e-30;
        const residArr = new Float32Array(N_CELLS);
        for (let j = 0; j < N_CELLS; j++) {
          const normPsi  = (psi[j*2]*psi[j*2] + psi[j*2+1]*psi[j*2+1]) / maxI;
          const normRecon = n.wtRecon[j] / maxS;
          residArr[j] = Math.abs(normPsi - normRecon);
          if (residArr[j] > maxR) maxR = residArr[j];
        }
        for (let j = 0; j < N_CELLS; j++) {
          const lv = Math.log(1 + 9 * residArr[j] / maxR) * logS;
          const [r, g, b] = colormaps.hot(lv);
          residBuf.data[j*4] = r; residBuf.data[j*4+1] = g;
          residBuf.data[j*4+2] = b; residBuf.data[j*4+3] = 255;
        }
        residCell.ctx.putImageData(residBuf, 0, 0);
      }

      // Title
      const depth = n._beatDepth ?? 0;
      const beats = n._beatCount ?? 0;
      title.style.color = isActive ? IFS_DEPTH_COLORS[depth % IFS_DEPTH_COLORS.length] : '#0cf';
      title.textContent =
        `PEER ${peerId} · WAVELET1  (IFS-native WT — ${n.ifsNBands ?? 0} bands)  ` +
        (isActive ? `[ANALYZING ◉ D${depth} · ${beats} beats]` : `[IDLE — click to inject]`);

      // Stats
      const bandE = (n.wtBandEnergy ?? []).map(e => e.toFixed(4)).join('  ');
      const bandR = (n.wtBandRadii  ?? []).join('  ');
      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `t=${(n.time ?? 0).toFixed(1)}  cycle=${n.cycleCount ?? 0}` +
        `  nBands=${n.ifsNBands ?? 0}` +
        `  band_σ=[${bandE}]` +
        `  band_r=[${bandR}]` +
        `  ${_clientBadge(world)}`;

      // IFS clock update
      ifsClock.update({ energy: n.fresnelEnergy ?? [], events: n.fresnelEvents ?? [], isActive, lt });

      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Wavelet1 | IFS-Native Wavelet Transform',
  selo:        'wavelet1',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [wavelet1WorldProgram + av],
  makeRenderer: makeWavelet1Renderer,
  wrapId:      'wavelet1-wrap',
  hideTopBar:  true,
};
