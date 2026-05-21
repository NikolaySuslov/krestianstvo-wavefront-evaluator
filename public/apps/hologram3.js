/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── Hologram3 | IFS-Native Wavelet Holography ────────────────────────────────
//
// Classical hologram2 replaces Huygens shell accumulation + back-propagation
// with the IFS-native wavelet pipeline:
//
//   EMIT phase  (beat → fracKernelByDepth)
//     Object field built by Huygens from cube sources (unchanged).
//     IFS beats accumulate fracKernelByDepth — one radius per beat, depth-tagged.
//
//   finalizePlate
//     kernelByDepth = _buildDepthKernels(fracKernelByDepth)
//     wtBands[d]    = _ifsAnalyze(objField, kernelByDepth)   ← wavelet encoding
//     plateBands[d] = wtBands[d] * ref_phase_d               ← per-band reference
//
//   RECON phase  (reconBeat → reconKernelByDepth, independent IFS roots)
//     Same scheduler structure but accumulates a separate reconKernelByDepth.
//
//   finalizeRecon
//     reconKernel = _buildDepthKernels(reconKernelByDepth)
//     recon[d]    = _ifsSynthesize(plateBands, reconKernel)  ← adjoint reconstruction
//
// The result: each depth band carries one spatial-frequency octave of the scene.
// Selective reconstruction (choosing which bands to include) gives multiresolution
// holography — impossible with classical Huygens-plate holography.
//
// Click wireframe → next cycle (new cube angle).
// Click a band panel → toggle that band in/out of reconstruction.

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
// SUBTICK_MS controls how far ahead the drain loop runs per heartbeat.
// Must be smaller than the finest beat delay so each beat fires in its own heartbeat.
// Finest beat: IFS_BASE_DELAY / 2^IFS_DEPTH / 2 ≈ 1.274/16/2 = 0.04 → use 0.03
const SUBTICK_MS   = 0.03;

// ── Primary parameters ────────────────────────────────────────────────────────
const GRID         = 128;
const PTS_PER_EDGE = 16;  // 12 edges × 16 = 192 sources

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH  = 3.0;  // shorter λ → more fringes → sharper reconstruction
// DELAY_SCALE controls beat timing. Must be large enough that IFS_BASE_DELAY > SUBTICK_MS (1)
// so beats spread across reflector heartbeats instead of all draining in one JS turn.
// 0.04 * 182 * 0.35 = 2.548 > 1 ✓
const DELAY_SCALE = 0.04;

// ── Derived ───────────────────────────────────────────────────────────────────
const N_CELLS = GRID * GRID;
const RECON_Z = Math.round(GRID / 8);
const REF_KX  = 0.08;

// ── IFS wavelet clock parameters ──────────────────────────────────────────────
const IFS_DEPTH     = 5;
const IFS_MAPS      = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP   = 8;
const IFS_MIN_DELAY = 0.06;

const MAX_DIST           = Math.ceil(Math.sqrt(2) * GRID);
const IFS_BASE_DELAY     = parseFloat((DELAY_SCALE * MAX_DIST * 0.35).toFixed(6));
// PLATE_DONE_DELAY must exceed SUBTICK_MS (1) so finalizePlate fires in a future
// reflector heartbeat, not the same drain loop as the click. Use *20 not *10.
const PLATE_DONE_DELAY   = parseFloat((IFS_BASE_DELAY * 20).toFixed(4));
const RECON_BASE_DELAY   = IFS_BASE_DELAY;
const RECON_DONE_DELAY   = parseFloat((RECON_BASE_DELAY * 20).toFixed(4));
const N_EMIT_ROOTS  = 6;   // roots per depth band for emit
const N_RECON_ROOTS = 6;   // roots per depth band for recon
const FRAC_ALPHA    = 0.08;

// ── Cycle timing ──────────────────────────────────────────────────────────────
const CYCLE = 60;

// ── Perspective ───────────────────────────────────────────────────────────────
const CAM_Z      = 4.5;
const PROJ_SCALE = 2 / (7 * (1 - 1 / GRID));
const INIT_ANGLE_Y = 0.7853981634;
const INIT_ANGLE_X = 0.5235987756;

// ── Geometry ──────────────────────────────────────────────────────────────────
const CUBE_VERTS = [
  [-1,-1,-1], [ 1,-1,-1], [ 1, 1,-1], [-1, 1,-1],
  [-1,-1, 1], [ 1,-1, 1], [ 1, 1, 1], [-1, 1, 1],
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
      pts.push([
        a[0] + u * (b[0] - a[0]),
        a[1] + u * (b[1] - a[1]),
        a[2] + u * (b[2] - a[2]),
      ]);
    }
  }
  return pts;
}
const CUBE_PTS      = _sampleEdges();
const CUBE_PTS_JSON = JSON.stringify(CUBE_PTS);

// ── World program ─────────────────────────────────────────────────────────────
const hologram3WorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const GRID              = ${GRID};
  const N_CELLS           = ${N_CELLS};
  const WAVELENGTH        = ${WAVELENGTH};
  const RECON_Z           = ${RECON_Z};
  const DELAY_SCALE       = ${DELAY_SCALE};
  const TWO_PI            = 2 * Math.PI;
  const CUBE_PTS          = ${CUBE_PTS_JSON};
  const REF_KX            = ${REF_KX};
  const CYCLE             = ${CYCLE};
  const IFS_DEPTH         = ${IFS_DEPTH};
  const IFS_MAPS          = ${JSON.stringify(IFS_MAPS)};
  const IFS_GEN_CAP       = ${IFS_GEN_CAP};
  const IFS_MIN_DELAY     = ${IFS_MIN_DELAY};
  const IFS_BASE_DELAY    = ${IFS_BASE_DELAY};
  const PLATE_DONE_DELAY  = ${PLATE_DONE_DELAY};
  const RECON_BASE_DELAY  = ${RECON_BASE_DELAY};
  const RECON_DONE_DELAY  = ${RECON_DONE_DELAY};
  const N_EMIT_ROOTS      = ${N_EMIT_ROOTS};
  const N_RECON_ROOTS     = ${N_RECON_ROOTS};
  const FRAC_ALPHA        = ${FRAC_ALPHA};
  const INIT_ANGLE_X      = ${INIT_ANGLE_X};
  const INIT_ANGLE_Y      = ${INIT_ANGLE_Y};

  ${FRAG.ifsWavelet(GRID, N_CELLS, IFS_DEPTH)}

  // ── Project cube vertices onto the hologram plate plane ─────────────────────
  const _projectSources = (angle) => {
    const cosY = Math.cos(angle), sinY = Math.sin(angle);
    const cosX = Math.cos(INIT_ANGLE_X), sinX = Math.sin(INIT_ANGLE_X);
    const halfG  = (GRID - 1) / 2;
    const fscale = halfG * ${PROJ_SCALE};
    const camZ   = ${CAM_Z};
    const total  = CUBE_PTS.length;
    return CUBE_PTS.map(([ox, oy, oz]) => {
      const ry1 =  cosY * ox + sinY * oz;
      const ry2 =  oy;
      const rz1 = -sinY * ox + cosY * oz;
      const rx  =  ry1;
      const ry  =  cosX * ry2 - sinX * rz1;
      const rz  =  sinX * ry2 + cosX * rz1;
      const z   =  camZ - rz;
      return {
        sx:  halfG + (rx / z) * fscale * camZ,
        sy:  halfG - (ry / z) * fscale * camZ,
        sz:  z * (RECON_Z / camZ),
        amp: 8.0 * (0.5 + 0.5 * (rz + 1) / 2) / total,
      };
    });
  };

  // ── Launch per-depth octave roots ────────────────────────────────────────────
  // For recon, stagger by depth so coarsest band (d=0, large radii) fires first →
  // progressive coarse-to-fine reveal. emit roots all fire at delay=0 (no stagger).
  const _launchOctaveRoots = (ctx, cycleId, nRoots, msgName, angle, stagger) => {
    for (let d = 0; d < IFS_DEPTH; d++) {
      const bandMax   = IFS_BASE_DELAY / Math.pow(2, d);
      const bandMin   = Math.max(IFS_MIN_DELAY, IFS_BASE_DELAY / Math.pow(2, d + 1));
      const fireDelay = stagger ? d * stagger : 0;
      for (let i = 0; i < nRoots; i++) {
        const t     = nRoots === 1 ? 1 : i / (nRoots - 1);
        const delay = bandMin + t * (bandMax - bandMin);
        ctx.future(fireDelay, msgName, { depth: d, delay, gen: 0, cycleId, angle });
      }
    }
  };

  // Full-ring _ifsAnalyze: samples the full circumference (not just 4 cardinal
  // points) with clamp-to-edge, eliminating the cross-shaped PSF artifact.
  const _ifsAnalyzeClamp = (psi, kernelByDepth) => {
    const bands = [];
    for (let d = 0; d < IFS_DEPTH; d++) {
      const band = new Float32Array(N_CELLS);
      const kb   = kernelByDepth[d];
      if (!kb || kb.radii.length === 0) { bands.push(band); continue; }
      // Precompute ring sample offsets for each radius
      const ringOffsets = kb.radii.map(r => {
        const nSteps = Math.max(8, Math.ceil(TWO_PI * r));
        const offsets = [];
        for (let k = 0; k < nSteps; k++) {
          offsets.push([
            Math.round(r * Math.cos(k * TWO_PI / nSteps)),
            Math.round(r * Math.sin(k * TWO_PI / nSteps)),
          ]);
        }
        return offsets;
      });
      for (let cy = 0; cy < GRID; cy++) {
        for (let cx = 0; cx < GRID; cx++) {
          let acc = 0;
          for (let k = 0; k < kb.radii.length; k++) {
            const w       = kb.weights[k];
            const offsets = ringOffsets[k];
            let ringAcc = 0;
            for (const [dx, dy] of offsets) {
              const nx = Math.min(GRID-1, Math.max(0, cx + dx));
              const ny = Math.min(GRID-1, Math.max(0, cy + dy));
              const id = ny * GRID + nx;
              ringAcc += psi[id*2]*psi[id*2] + psi[id*2+1]*psi[id*2+1];
            }
            acc += w * ringAcc / offsets.length;
          }
          band[cy * GRID + cx] = acc;
        }
      }
      bands.push(band);
    }
    return bands;
  };

  // Unsharp-mask band reconstruction:
  //   recon = Σ fine_bands  −  α * Σ coarse_bands
  // Fine bands carry edge/detail; subtracting coarse removes the diffuse halo.
  const _reconFromBands = (plateBands, mask) => {
    const out = new Array(N_CELLS).fill(0);
    const mid = Math.floor(IFS_DEPTH / 2);  // bands >= mid are "fine"
    for (let d = 0; d < IFS_DEPTH; d++) {
      if (!plateBands[d]) continue;
      const isFine = d >= mid;
      const active = mask[d];
      if (!active && !isFine) continue;
      // fine bands: add with exponential weight favouring finest
      // coarse bands: subtract a fraction (unsharp mask) even if masked
      const w = isFine
        ? (active ? Math.pow(2, d - mid + 1) : 0)
        : -0.3;
      const band = plateBands[d];
      for (let i = 0; i < N_CELLS; i++) out[i] += band[i] * w;
    }
    // Clamp negatives to zero
    for (let i = 0; i < N_CELLS; i++) if (out[i] < 0) out[i] = 0;
    return out;
  };

  const hologram3 = Behaviors.collect(
    {
      angle:              0,
      cycleId:            0,
      cycleCount:         0,
      objField:           new Array(2 * N_CELLS).fill(0),
      _sources:           null,
      plateBands:         null,
      wtBands:            null,
      kernelByDepth:      null,
      recon:              null,
      _reconBuf:          null,
      bandMask:           new Array(${IFS_DEPTH}).fill(true),
      fracKernelByDepth:  Array.from({ length: ${IFS_DEPTH} }, () => []),
      _emitActive:        false,
      _reconActive:       false,
      _beatCount:         0,
      _beatDepth:         0,
      _reconBeatCount:    0,
      _reconBeatDepth:    0,
      ifsEnergy:          new Array(${IFS_DEPTH}).fill(0),
      ifsEvents:          [],
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick) {
        const t = pulse._eventPayload?.type;
        if (t === 'nextCycle')
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: 'nextCycle', payload: {} }, ...(s._queue ?? [])] };
        if (t === 'toggleBand')
          s = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: 'toggleBand', payload: pulse._eventPayload }, ...(s._queue ?? [])] };
      }
      return W.reduce(s, pulse, 'hologram3', {

        __macro: (s, p, ctx) => {
          if (p.logicalTime !== 1) return s;
          const angle = INIT_ANGLE_Y;
          let h = (Math.round(angle * 1e6) >>> 0) ^ 0xdeadbeef;
          h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
          h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
          W.rng.seed((h ^ (h >>> 16)) >>> 0);
          ctx.future(100, '_keepalive', {});
          const cycleId = p.logicalTime;
          _launchOctaveRoots(ctx, cycleId, N_EMIT_ROOTS, 'emitBeat', angle);
          ctx.future(PLATE_DONE_DELAY, 'finalizePlate', { cycleId, angle });
          const _sources = _projectSources(angle);
          return {
            ...s,
            angle, cycleId, cycleCount: 1,
            objField: new Array(2 * N_CELLS).fill(0),
            _sources,
            plateBands: null, wtBands: null, kernelByDepth: null, recon: null,
            fracKernelByDepth: Array.from({ length: IFS_DEPTH }, () => []),
            _emitActive: true, _reconActive: false,
            _beatCount: 0, _beatDepth: 0, _reconBeatCount: 0, _reconBeatDepth: 0,
            ifsEnergy: new Array(IFS_DEPTH).fill(0), ifsEvents: [],
          };
        },

        _keepalive: (s, p, ctx) => { ctx.future(100, '_keepalive', {}); return s; },

        nextCycle: (s, p, ctx) => {
          const cycleId    = ctx.wallTime + 1;
          const cycleCount = (s.cycleCount ?? 0) + 1;
          const angle      = ((s.angle ?? INIT_ANGLE_Y) + 0.41421356) % TWO_PI;
          let h = (Math.round(angle * 1e6) >>> 0) ^ 0xdeadbeef;
          h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
          h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
          W.rng.seed((h ^ (h >>> 16)) >>> 0);
          // Start new emit cycle
          _launchOctaveRoots(ctx, cycleId, N_EMIT_ROOTS, 'emitBeat', angle);
          ctx.future(PLATE_DONE_DELAY, 'finalizePlate', { cycleId, angle });
          return {
            ...s,
            angle, cycleId, cycleCount,
            objField: new Array(2 * N_CELLS).fill(0),
            _sources: _projectSources(angle),
            // Keep previous recon frozen; new recon starts after finalizePlate.
            fracKernelByDepth: Array.from({ length: IFS_DEPTH }, () => []),
            _emitActive: true, _reconActive: false,
            _beatCount: 0, _beatDepth: 0, _reconBeatCount: 0, _reconBeatDepth: 0,
            ifsEnergy: new Array(IFS_DEPTH).fill(0), ifsEvents: [],
          };
        },

        // ── Emit beat: accumulate one Huygens shell into objField ────────────
        // objField is mutated in place — it is a fresh array allocated in nextCycle,
        // so mutation across beats is safe. No slice() needed.
        emitBeat: (s, p, ctx) => {
          if (p.cycleId !== s.cycleId) return s;
          const { depth, delay, gen, angle } = p;
          const selfR     = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
          const selfDelay = delay * selfR;
          if (gen < IFS_GEN_CAP && selfDelay > IFS_MIN_DELAY)
            ctx.future(selfDelay, 'emitBeat', { depth, delay: selfDelay, gen: gen + 1, cycleId: s.cycleId, angle });

          const distTarget = delay / DELAY_SCALE;
          const sources    = s._sources;
          const objField   = s.objField;
          for (const { sx, sy, sz, amp } of sources) {
            for (let cy = 0; cy < GRID; cy++) {
              for (let cx = 0; cx < GRID; cx++) {
                const dx     = cx - sx, dy = cy - sy;
                const dist2d = Math.sqrt(dx*dx + dy*dy);
                if (Math.abs(dist2d - distTarget) >= 1.5) continue;
                const dist3d = Math.sqrt(dx*dx + dy*dy + sz*sz);
                const phase  = (dist3d / WAVELENGTH) * TWO_PI;
                const id     = cy * GRID + cx;
                objField[id*2]   += amp * Math.cos(phase);
                objField[id*2+1] += amp * Math.sin(phase);
              }
            }
          }

          const ri = Math.max(1, Math.round(delay / DELAY_SCALE));
          const bandCeil  = Math.round(IFS_BASE_DELAY / Math.pow(2, depth)     / DELAY_SCALE);
          const bandFloor = Math.round(IFS_BASE_DELAY / Math.pow(2, depth + 1) / DELAY_SCALE);
          const inBand    = ri >= Math.max(1, bandFloor) && ri <= bandCeil && ri < (GRID >> 1);
          const fracKernelByDepth = s.fracKernelByDepth.map((a, d) =>
            d === depth && inBand ? [...a, ri] : a
          );
          const ifsEnergy = s.ifsEnergy.slice();
          ifsEnergy[depth] = Math.min(1, (ifsEnergy[depth] ?? 0) + 0.3);
          const ifsEvents = [...(s.ifsEvents ?? []).slice(-80), { d: depth, delay, wt: ctx.wallTime }];
          return { ...s, objField, fracKernelByDepth, _beatCount: s._beatCount + 1, _beatDepth: depth, ifsEnergy, ifsEvents };
        },

        // ── finalizePlate: wavelet-encode the accumulated objField ───────────
        finalizePlate: (s, p, ctx) => {
          if (p.cycleId !== s.cycleId) return s;
          const kernelByDepth = _buildDepthKernels(s.fracKernelByDepth, FRAC_ALPHA);
          const wtBands    = _ifsAnalyzeClamp(s.objField, kernelByDepth);
          const plateBands = wtBands.map(b => Array.from(b));
          // Direct band sum reconstruction — bands already hold intensity at each
          // spatial scale; summing them (with mask) gives the sharpest result.
          const mask = s.bandMask ?? new Array(IFS_DEPTH).fill(true);
          const recon = _reconFromBands(plateBands, mask);
          return {
            ...s,
            wtBands: plateBands,
            plateBands,
            kernelByDepth,
            recon,
            _reconBuf: null,
            _emitActive: false, _reconActive: false,
            _reconBeatCount: 0, _reconBeatDepth: 0,
            ifsEnergy: new Array(IFS_DEPTH).fill(0), ifsEvents: [],
          };
        },

        // ── Toggle a band: instantly recompute recon from band sum ────────────
        toggleBand: (s, p, ctx) => {
          if (!s.plateBands) return s;
          const d = p.band ?? 0;
          const bandMask = (s.bandMask ?? new Array(IFS_DEPTH).fill(true)).slice();
          bandMask[d] = !bandMask[d];
          const recon = _reconFromBands(s.plateBands, bandMask);
          return { ...s, bandMask, recon };
        },

      });
    }
  );

  const _isStable = W.stable([hologram3], reflector);
  const _export   = W.export(Renkon, { hologram3 }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeHologram3Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    if (!document.getElementById('hologram3-wrap')) {
      const wrap = document.createElement('div'); wrap.id = 'hologram3-wrap';
      Object.assign(wrap.style, { display: 'flex', gap: '0', flexWrap: 'wrap' });
      document.body.appendChild(wrap);
    }

    const root = document.createElement('div');
    root.id = containerId;
    Object.assign(root.style, {
      fontFamily: 'ui-monospace,monospace', padding: '12px',
      background: '#000', color: '#eee', borderRadius: '10px',
      margin: '10px', flex: '1', minWidth: '0', boxSizing: 'border-box',
      border: '1px solid #111',
    });
    document.getElementById('hologram3-wrap').appendChild(root);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '11px', fontWeight: 'bold',
      marginBottom: '8px', letterSpacing: '1px', textAlign: 'center',
    });
    root.appendChild(title);

    // ── Canvas helper ─────────────────────────────────────────────────────────
    const makeDataCell = (label, color) => {
      const wrap   = document.createElement('div');
      const lbl    = document.createElement('div');
      Object.assign(lbl.style, {
        fontSize: '8px', color, textAlign: 'center',
        marginBottom: '3px', letterSpacing: '0.5px',
      });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = GRID; canvas.height = GRID;
      Object.assign(canvas.style, {
        width: '100%', height: 'auto', imageRendering: 'pixelated',
        borderRadius: '3px', display: 'block',
      });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d'), lbl };
    };

    const makeWireCell = (label, color) => {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('div');
      Object.assign(lbl.style, {
        fontSize: '8px', color, textAlign: 'center',
        marginBottom: '3px', letterSpacing: '0.5px',
      });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 200;
      Object.assign(canvas.style, {
        width: '100%', height: 'auto', borderRadius: '3px',
        display: 'block', background: '#000', cursor: 'pointer',
      });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    // ── Row 1: IFS clock | obj field | cube wireframe | recon | recon-contrast ──
    const row1 = document.createElement('div');
    Object.assign(row1.style, {
      display: 'grid',
      gridTemplateColumns: `108px repeat(4, 1fr)`,
      gap: '4px', alignItems: 'start', marginBottom: '4px',
    });
    root.appendChild(row1);

    const ifsClock = makeIFSClockPanel({ label: 'WAVELET HOLO', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    row1.appendChild(ifsClock.el);

    const objCell    = makeDataCell('OBJECT FIELD  |ψ|²', '#643');
    const cubeCell   = makeWireCell(`CUBE (${CUBE_PTS.length} src) — click`, '#442');
    const reconCell   = makeDataCell('RECON  Σ masked bands', '#0a5');
    const reconHiCell = makeDataCell('RECON  (contrast)', '#143');
    row1.appendChild(objCell.wrap);
    row1.appendChild(cubeCell.wrap);
    row1.appendChild(reconCell.wrap);
    row1.appendChild(reconHiCell.wrap);

    // ── Row 2: spacer | bands ─────────────────────────────────────────────────
    const row2 = document.createElement('div');
    Object.assign(row2.style, {
      display: 'grid',
      gridTemplateColumns: `108px repeat(${IFS_DEPTH}, 1fr) auto`,
      gap: '4px', alignItems: 'start', marginBottom: '4px',
    });
    root.appendChild(row2);

    row2.appendChild(document.createElement('div')); // clock spacer

    const bandCells = IFS_DEPTH_COLORS.slice(0, IFS_DEPTH).map((c, d) => {
      const cell = makeDataCell(`BAND ${d}  [click=toggle]`, c);
      cell.canvas.style.cursor = 'pointer';
      cell.canvas.addEventListener('click', () => injectEvent?.({ type: 'toggleBand', band: d }));
      row2.appendChild(cell.wrap);
      return cell;
    });

    // Info cell
    const infoCell = document.createElement('div');
    Object.assign(infoCell.style, {
      fontSize: '9px', color: '#444', lineHeight: '2.0',
      letterSpacing: '0.5px', paddingTop: '4px',
    });
    infoCell.innerHTML =
      `<div style="color:#553">GRID</div><div style="color:#eee">${GRID}×${GRID}</div>` +
      `<div style="color:#553;margin-top:4px">DEPTH</div><div style="color:#eee">${IFS_DEPTH}</div>` +
      `<div style="color:#553;margin-top:4px">λ</div><div style="color:#eee">${WAVELENGTH}</div>`;
    row2.appendChild(infoCell);

    // Stats
    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, { fontSize: '9px', color: '#333', marginTop: '6px', textAlign: 'center' });
    root.appendChild(stats);

    // Image buffers
    const objBuf      = objCell.ctx.createImageData(GRID, GRID);
    const bandBufs    = bandCells.map(c => c.ctx.createImageData(GRID, GRID));
    const reconBuf    = reconCell.ctx.createImageData(GRID, GRID);
    const reconHiBuf  = reconHiCell.ctx.createImageData(GRID, GRID);

    const logS = 1 / Math.log(1 + 9);

    // ── Wireframe ─────────────────────────────────────────────────────────────
    const _project = (ox, oy, oz, angle, W, H) => {
      const cosY = Math.cos(angle), sinY = Math.sin(angle);
      const cosX = Math.cos(INIT_ANGLE_X), sinX = Math.sin(INIT_ANGLE_X);
      const halfG  = (GRID - 1) / 2, fscale = halfG * PROJ_SCALE;
      const ry1 = cosY*ox + sinY*oz, ry2 = oy, rz1 = -sinY*ox + cosY*oz;
      const rx = ry1, ry = cosX*ry2 - sinX*rz1, rz = sinX*ry2 + cosX*rz1;
      const z = CAM_Z - rz;
      return {
        px: (halfG + (rx/z)*fscale*CAM_Z) / GRID * W,
        py: (halfG - (ry/z)*fscale*CAM_Z) / GRID * H,
        depth: rz,
      };
    };

    let _wireHover = 0, _wireRafId = null, _wireAngle = INIT_ANGLE_Y;

    const _drawCube = (ctx, angle, glow) => {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (glow > 0) {
        const gr = ctx.createRadialGradient(W/2,H/2,W*0.1, W/2,H/2,W*0.65);
        gr.addColorStop(0, `rgba(80,200,255,${0.10*glow})`);
        gr.addColorStop(0.5, `rgba(40,120,220,${0.18*glow})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      }
      const pts = CUBE_VERTS.map(([ox,oy,oz]) => _project(ox,oy,oz,angle,W,H));
      for (let pass = 0; pass < 2; pass++) {
        for (const [ai, bi] of CUBE_EDGES) {
          const a = pts[ai], b = pts[bi];
          const avgD = (a.depth + b.depth) / 2, isBack = avgD < 0;
          if (pass === 0 && !isBack) continue;
          if (pass === 1 &&  isBack) continue;
          const t = (avgD + 1) / 2, bright = isBack ? 0.15 + t*0.1 : 0.5 + t*0.5;
          const alpha = isBack ? 0.25 : 0.9;
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
          if (glow > 0 && !isBack) {
            ctx.strokeStyle = `rgba(${Math.floor(bright*220*(1-glow)+40*glow)},${Math.floor(bright*160*(1-glow)+180*glow)},${Math.floor(bright*30*(1-glow)+255*glow)},${alpha})`;
            ctx.lineWidth = 1.5 + glow*1.5;
            ctx.shadowColor = `rgba(60,180,255,${glow*0.8})`; ctx.shadowBlur = 6*glow;
          } else {
            ctx.strokeStyle = `rgba(${Math.floor(bright*220)},${Math.floor(bright*160)},${Math.floor(bright*30)},${alpha})`;
            ctx.lineWidth = isBack ? 1 : 1.5; ctx.shadowBlur = 0;
          }
          ctx.stroke(); ctx.shadowBlur = 0;
        }
      }
      for (const { px, py, depth } of pts) {
        const t = (depth+1)/2, bright = 0.4 + t*0.6;
        ctx.beginPath(); ctx.arc(px, py, 3 + t*3, 0, Math.PI*2);
        ctx.fillStyle = glow > 0
          ? `rgba(${Math.floor(bright*255*(1-glow)+60*glow)},${Math.floor(bright*180*(1-glow)+200*glow)},${Math.floor(bright*40*(1-glow)+255*glow)},0.95)`
          : `rgba(${Math.floor(bright*255)},${Math.floor(bright*180)},${Math.floor(bright*40)},0.95)`;
        ctx.shadowColor = glow > 0 ? `rgba(80,200,255,${glow*0.9})` : 'transparent';
        ctx.shadowBlur  = glow > 0 ? 8*glow : 0;
        ctx.fill(); ctx.shadowBlur = 0;
      }
      ctx.fillStyle = glow > 0.3 ? `rgba(80,200,255,${0.4+glow*0.4})` : 'rgba(200,150,30,0.3)';
      ctx.font = '7px ui-monospace,monospace';
      ctx.fillText(`${CUBE_PTS.length} src  θ=${(angle*180/Math.PI).toFixed(1)}°`, 4, H - 4);
    };

    const _wireRafDraw = () => {
      _wireRafId = null;
      _drawCube(cubeCell.ctx, _wireAngle, _wireHover);
      if (_wireHover > 0.01) _wireRafId = requestAnimationFrame(_wireRafDraw);
    };
    cubeCell.canvas.addEventListener('mouseenter', () => {
      _wireHover = 1; if (!_wireRafId) _wireRafId = requestAnimationFrame(_wireRafDraw);
    });
    cubeCell.canvas.addEventListener('mouseleave', () => {
      const fade = () => { _wireHover = Math.max(0, _wireHover - 0.06); _drawCube(cubeCell.ctx, _wireAngle, _wireHover); if (_wireHover > 0.01) requestAnimationFrame(fade); };
      requestAnimationFrame(fade);
    });
    cubeCell.canvas.addEventListener('click', () => injectEvent?.({ type: 'nextCycle' }));

    // ── Main render ───────────────────────────────────────────────────────────
    return () => {
      const h = world.getNodeState('hologram3');
      if (!h) return;

      const lt           = world.ps.app.logicalTime ?? 0;
      const isEmitting   = !!h._emitActive;
      const isRecon      = !!h._reconActive;
      const beatDepth    = h._beatDepth ?? 0;
      const bandMask     = h.bandMask ?? new Array(IFS_DEPTH).fill(true);

      // Title
      const col = IFS_DEPTH_COLORS[beatDepth % IFS_DEPTH_COLORS.length];
      title.style.color = col;
      title.textContent =
        `PEER ${peerId} · HOLOGRAM3  (IFS-native Wavelet Holography)  ` +
        (isEmitting
          ? `[EMIT ◉ D${beatDepth} · ${h._beatCount} beats]`
          : h.recon
            ? `[READY — click cube or band]`
            : `[IDLE — click cube]`);

      // IFS clock
      ifsClock.update({ energy: h.ifsEnergy ?? [], events: h.ifsEvents ?? [], isActive: isEmitting || isRecon, lt });

      // Wireframe
      _wireAngle = h.angle ?? INIT_ANGLE_Y;
      if (!_wireRafId) _drawCube(cubeCell.ctx, _wireAngle, _wireHover);

      // Object field (log-hot)
      if (h.objField) {
        let maxI = 1e-9;
        for (let j = 0; j < N_CELLS; j++) {
          const v = h.objField[j*2]*h.objField[j*2] + h.objField[j*2+1]*h.objField[j*2+1];
          if (v > maxI) maxI = v;
        }
        const norm = 1 / Math.sqrt(maxI);
        for (let j = 0; j < N_CELLS; j++) {
          const amp = Math.sqrt(h.objField[j*2]*h.objField[j*2] + h.objField[j*2+1]*h.objField[j*2+1]) * norm;
          const lv  = Math.log(1 + 9 * amp) * logS;
          const [r, g, b] = colormaps.hot(lv);
          objBuf.data[j*4] = r; objBuf.data[j*4+1] = g; objBuf.data[j*4+2] = b; objBuf.data[j*4+3] = 255;
        }
        objCell.ctx.putImageData(objBuf, 0, 0);
      }

      // Sub-band images
      if (h.wtBands) {
        for (let d = 0; d < IFS_DEPTH; d++) {
          const band = h.wtBands[d];
          if (!band) continue;
          let maxB = 1e-30;
          for (let j = 0; j < N_CELLS; j++) if (band[j] > maxB) maxB = band[j];
          const active = bandMask[d];
          // Dim masked-out bands
          const dimFactor = active ? 1.0 : 0.25;
          for (let j = 0; j < N_CELLS; j++) {
            const lv = Math.log(1 + 9 * band[j] / maxB) * logS * dimFactor;
            const [r, g, b] = colormaps.wavelet(lv);
            const buf = bandBufs[d];
            buf.data[j*4] = r; buf.data[j*4+1] = g; buf.data[j*4+2] = b; buf.data[j*4+3] = 255;
          }
          bandCells[d].ctx.putImageData(bandBufs[d], 0, 0);
          // Visual indicator: dim label if band is masked
          bandCells[d].lbl.style.opacity = active ? '1' : '0.3';
        }
      }

      // Reconstruction
      if (h.recon) {
        let maxR = 1e-30;
        for (let j = 0; j < N_CELLS; j++) if (h.recon[j] > maxR) maxR = h.recon[j];
        for (let j = 0; j < N_CELLS; j++) {
          const lv = Math.log(1 + 9 * h.recon[j] / maxR) * logS;
          const [r, g, b] = colormaps.hot(lv);
          reconBuf.data[j*4] = r; reconBuf.data[j*4+1] = g; reconBuf.data[j*4+2] = b; reconBuf.data[j*4+3] = 255;
        }
        reconCell.ctx.putImageData(reconBuf, 0, 0);

        // High-contrast
        for (let j = 0; j < N_CELLS; j++) {
          const amp = h.recon[j] / maxR;
          const t   = Math.max(0, (amp - 0.2) / 0.8);
          const v   = Math.pow(t, 0.35);
          reconHiBuf.data[j*4]   = Math.floor(v*v*255);
          reconHiBuf.data[j*4+1] = Math.floor(v*255);
          reconHiBuf.data[j*4+2] = Math.floor(v*255);
          reconHiBuf.data[j*4+3] = 255;
        }
        reconHiCell.ctx.putImageData(reconHiBuf, 0, 0);
      }

      // Stats
      const maskStr = bandMask.map((m, d) => m ? `${d}✓` : `${d}✗`).join(' ');
      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `cycle=${h.cycleCount ?? 0}  θ=${((h.angle ?? 0)*180/Math.PI).toFixed(1)}°` +
        `  lt=${lt}  emit=${h._beatCount ?? 0}  recon=${h._reconBeatCount ?? 0}` +
        `  bands=[${maskStr}]  ${_clientBadge(world)}`;

      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Hologram3 | IFS-Native Wavelet Holography',
  selo:        'hologram3',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologram3WorldProgram + av],
  makeRenderer: makeHologram3Renderer,
  wrapId:      'hologram3-wrap',
  hideTopBar:  true,
};
