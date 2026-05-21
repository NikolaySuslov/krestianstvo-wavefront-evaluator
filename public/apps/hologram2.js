/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── Hologram2 | IFS Fractal Clock — new API, single IFS clock panel ──────────
//
// Recreates hologram.js using krestianstvo-wavefront-physics.js API.
// The dual elaborate IFS viz panels (emitViz + reconViz) are replaced with
// the single simpler IFS clock panel from nls2/nls3/instanton2/3 demos.
//
// Physics unchanged from hologram.js:
//   EMIT  beat(depth, delay, gen) → scatter to hologram plate shells
//   finalizePlate → extract +1 diffraction order, fire N_RECON_ROOTS reconBeat roots
//   RECON reconBeat → back-propagate plate to recon plane (time-reversed beat)
//   finalizeRecon → lock completed reconstruction

import { FRAG, colormaps, IFS_MAPS_DEFAULT } from '../krestianstvo-wavefront-physics.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
// Must be smaller than IFS_MIN_DELAY (0.1) so each beat fires in its own
// heartbeat instead of all draining in one JS turn → no UI freeze.
const SUBTICK_MS   = 0.09;

// ── Primary parameters ────────────────────────────────────────────────────────
const GRID         = 64;
const PTS_PER_EDGE = 16;  // 12 edges × 16 = 192 sources

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH   = 4.0;
const DELAY_SCALE  = 0.02;

// ── Derived ───────────────────────────────────────────────────────────────────
const N_CELLS  = GRID * GRID;
const RECON_Z  = Math.round(GRID / 8);
const REF_KX   = 0.08;

// ── IFS clock parameters ──────────────────────────────────────────────────────
const IFS_DEPTH     = 5;
const IFS_MAPS      = IFS_MAPS_DEFAULT;
const IFS_GEN_CAP   = 6;
const IFS_MIN_DELAY = 0.1;

// Emit side: shells 0 … MAX_DIST on the hologram plate
const MAX_DIST        = Math.ceil(Math.sqrt(2) * GRID);
const IFS_BASE_DELAY  = parseFloat((DELAY_SCALE * MAX_DIST).toFixed(6));
const PLATE_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 10).toFixed(4));

// Recon side: N_RECON_ROOTS roots fired at geometrically spaced delays
const RECON_BASE_DELAY  = parseFloat((DELAY_SCALE * MAX_DIST).toFixed(6));
const RECON_MIN_DELAY   = Math.max(IFS_MIN_DELAY * 1.1, parseFloat((DELAY_SCALE * (RECON_Z + 1)).toFixed(6)));
const N_RECON_ROOTS     = 16;
const RECON_DONE_DELAY  = parseFloat((RECON_BASE_DELAY * 12).toFixed(4));
// Rows processed per reconRow beat — tune so one beat ≈ 2–4ms in JS.
// At GRID=128: 128 rows × 35px ring window × 128 cols ≈ 570K ops → ~5ms → use 4 rows.
const RECON_ROWS_PER_BEAT = 4;

// ── Cycle timing ──────────────────────────────────────────────────────────────
const CYCLE = 60;

// ── Level-of-Detail tables ────────────────────────────────────────────────────
const LOD_BEAT  = [1, 1, 1, 1, 0];
const LOD_OUTER = [1, 1, 1, 2, 0];
const LOD_INNER = [1, 1, 1, 1, 0];

// ── Perspective ───────────────────────────────────────────────────────────────
const CAM_Z      = 4.5;
const PROJ_SCALE = 2 / (7 * (1 - 1 / GRID));

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

const INIT_ANGLE_Y = 0.7853981634;
const INIT_ANGLE_X = 0.5235987756;

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
const hologram2WorldProgram = `
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
  const RECON_MIN_DELAY   = ${RECON_MIN_DELAY};
  const N_RECON_ROOTS     = ${N_RECON_ROOTS};
  const RECON_DONE_DELAY  = ${RECON_DONE_DELAY};
  const LOD_BEAT            = ${JSON.stringify(LOD_BEAT)};
  const LOD_OUTER           = ${JSON.stringify(LOD_OUTER)};
  const LOD_INNER           = ${JSON.stringify(LOD_INNER)};
  const RECON_ROWS_PER_BEAT = ${RECON_ROWS_PER_BEAT};
  const INIT_ANGLE_X      = ${INIT_ANGLE_X};
  const INIT_ANGLE_Y      = ${INIT_ANGLE_Y};

  const _refPhase = (cx) => TWO_PI * REF_KX * cx;

  const _projectSources = (angle) => {
    const cosY = Math.cos(angle),  sinY = Math.sin(angle);
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
        sz:  z * (${RECON_Z} / camZ),
        amp: 8.0 * (0.5 + 0.5 * (rz + 1) / 2) / total,
      };
    });
  };

  const hologram2 = Behaviors.collect(
    {
      angle:           0,
      cycleId:         0,
      cycleCount:      0,
      plate:           new Array(2 * N_CELLS).fill(0),
      recon:           new Array(2 * N_CELLS).fill(0),
      _sources:        null,
      _plateBuf:       null,
      _reconBuf:       null,
      _beatCount:      0,
      _beatDepth:      0,
      _reconBeatCount: 0,
      _reconBeatDepth: 0,
      _reconRowIdx:    0,
      ifsEnergy:       new Array(IFS_DEPTH).fill(0),
      ifsEvents:       [],
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && !pulse.isSubTick && pulse._eventPayload?.type === 'nextCycle') {
        const entry = { fireAt: pulse.wallTime, msg: 'nextCycle', payload: {} };
        s = { ...state, _queue: [entry, ...(state._queue ?? [])] };
      }
      return W.reduce(s, pulse, "hologram2", {

      __macro: (s, p, ctx) => {
        const tick = p.logicalTime;
        if (tick === 1) {
          const angle = INIT_ANGLE_Y;
          const angleInt = Math.round(angle * 1e6) >>> 0;
          let h = angleInt ^ 0xdeadbeef;
          h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
          h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
          h = (h ^ (h >>> 16)) >>> 0;
          W.rng.seed(h);
          ctx.future(100, '_keepalive', {});
          ctx.future(0, 'beat', { depth: 0, delay: IFS_BASE_DELAY, gen: 0, cycleId: tick });
          ctx.future(PLATE_DONE_DELAY, 'finalizePlate', { cycleId: tick, angle });
          ctx.future(PLATE_DONE_DELAY + RECON_DONE_DELAY, 'finalizeRecon', { cycleId: tick });
          return {
            ...s, cycleId: tick, angle, cycleCount: 1, _emitActive: true, _reconActive: false,
            _sources: _projectSources(angle),
            plate: new Array(2 * N_CELLS).fill(0), _plateBuf: null, _reconBuf: null,
            _beatCount: 0, _beatDepth: 0, _reconBeatCount: 0, _reconBeatDepth: 0, _reconRowIdx: 0,
            ifsEnergy: new Array(IFS_DEPTH).fill(0), ifsEvents: [],
          };
        }
        return s;
      },

      _keepalive: (s, p, ctx) => { ctx.future(100, '_keepalive', {}); return s; },

      nextCycle: (s, p, ctx) => {
        const tick = ctx.wallTime + 1;
        const cycleCount = (s.cycleCount ?? 0) + 1;
        const angle = ((s.angle ?? INIT_ANGLE_Y) + 0.41421356) % TWO_PI;
        const angleInt = Math.round(angle * 1e6) >>> 0;
        let h = angleInt ^ 0xdeadbeef;
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        W.rng.seed(h);
        ctx.future(1, 'beat', { depth: 0, delay: IFS_BASE_DELAY, gen: 0, cycleId: tick });
        ctx.future(1 + PLATE_DONE_DELAY, 'finalizePlate', { cycleId: tick, angle });
        ctx.future(1 + PLATE_DONE_DELAY + RECON_DONE_DELAY, 'finalizeRecon', { cycleId: tick });
        // Keep previous recon frozen while new emit runs (Option A from hologram3).
        return {
          ...s, cycleId: tick, angle, cycleCount, _emitActive: true, _reconActive: false,
          _sources: _projectSources(angle),
          plate: new Array(2 * N_CELLS).fill(0), _plateBuf: null, _reconBuf: null,
          _beatCount: 0, _beatDepth: 0, _reconBeatCount: 0, _reconBeatDepth: 0, _reconRowIdx: 0,
          ifsEnergy: new Array(IFS_DEPTH).fill(0), ifsEvents: [],
        };
      },

      beat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const { depth, delay, gen } = p;

        const selfR      = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
        const childR     = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
        const selfDelay  = delay * selfR;
        const childDelay = delay * childR;

        if (gen < IFS_GEN_CAP && selfDelay > IFS_MIN_DELAY)
          ctx.future(selfDelay, 'beat', {
            depth, delay: selfDelay, gen: gen + 1, cycleId: s.cycleId,
          });
        if (gen === 0 && depth + 1 < IFS_DEPTH && childDelay > IFS_MIN_DELAY)
          ctx.future(selfDelay + childDelay, 'beat', {
            depth: depth + 1, delay: childDelay, gen: 0, cycleId: s.cycleId,
          });

        const lodBeat = depth < LOD_BEAT.length ? LOD_BEAT[depth] : 0;
        const ifsEnergy = s.ifsEnergy.slice();
        ifsEnergy[depth] = Math.min(1, (ifsEnergy[depth] ?? 0) + 0.3);
        const ifsEvents = [...(s.ifsEvents ?? []).slice(-80), { d: depth, delay, wt: ctx.wallTime }];
        if (!lodBeat) return { ...s, _beatCount: s._beatCount + 1, _beatDepth: depth, ifsEnergy, ifsEvents };

        const distTarget = delay / DELAY_SCALE;
        const sources    = s._sources;
        const plate      = s.plate;  // mutate in place — fresh array per cycle
        for (const { sx, sy, sz, amp } of sources) {
          for (let cy = 0; cy < GRID; cy++) {
            for (let cx = 0; cx < GRID; cx++) {
              const dx     = cx - sx, dy = cy - sy;
              const dist2d = Math.sqrt(dx * dx + dy * dy);
              if (Math.abs(dist2d - distTarget) >= 1.5) continue;
              const dist3d = Math.sqrt(dx * dx + dy * dy + sz * sz);
              const phase  = (dist3d / WAVELENGTH) * TWO_PI;
              const id     = cy * GRID + cx;
              plate[id * 2]     += amp * Math.cos(phase);
              plate[id * 2 + 1] += amp * Math.sin(phase);
            }
          }
        }

        return {
          ...s, plate, _plateBuf: plate,
          _beatCount: s._beatCount + 1, _beatDepth: depth,
          ifsEnergy, ifsEvents,
        };
      },

      finalizePlate: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const objField = s.plate;
        const plate    = new Array(2 * N_CELLS).fill(0);
        for (let cy = 0; cy < GRID; cy++) {
          for (let cx = 0; cx < GRID; cx++) {
            const id   = cy * GRID + cx;
            const rp   = _refPhase(cx);
            const oRe  = objField[id * 2], oIm = objField[id * 2 + 1];
            plate[id * 2]     = oRe * Math.cos(rp) + oIm * Math.sin(rp);
            plate[id * 2 + 1] = oIm * Math.cos(rp) - oRe * Math.sin(rp);
          }
        }
        const logMin = Math.log(RECON_MIN_DELAY);
        const logMax = Math.log(RECON_BASE_DELAY);
        for (let i = 0; i < N_RECON_ROOTS; i++) {
          const t     = N_RECON_ROOTS === 1 ? 1 : i / (N_RECON_ROOTS - 1);
          const delay = Math.exp(logMin + t * (logMax - logMin));
          ctx.future(0, 'reconBeat', { depth: 0, delay, gen: 0, cycleId: p.cycleId, row: 0 });
        }
        return { ...s, plate, _plateBuf: plate,
          _reconBuf: new Array(2 * N_CELLS).fill(0),
          _emitActive: false, _reconActive: true,
          ifsEnergy: new Array(IFS_DEPTH).fill(0), ifsEvents: [] };
      },

      // Each reconBeat processes RECON_ROWS_PER_BEAT plate rows for one shell
      // radius (delay), then schedules the next strip as a future beat in virtual
      // time. This spreads the O(GRID²) work across many heartbeats so the UI
      // never blocks. The IFS tree still fans out normally for self+child recursion.
      reconBeat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const { depth, delay, gen, row } = p;
        const rowStart = row ?? 0;

        const selfR      = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
        const childR     = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
        const selfDelay  = delay * selfR;
        const childDelay = delay * childR;

        // IFS tree recursion — only on the first strip of each beat (row===0)
        // so children don't multiply per strip.
        if (rowStart === 0) {
          if (gen < IFS_GEN_CAP && selfDelay > IFS_MIN_DELAY)
            ctx.future(selfDelay, 'reconBeat', { depth, delay: selfDelay, gen: gen + 1, cycleId: s.cycleId, row: 0 });
          if (gen === 0 && depth + 1 < IFS_DEPTH && childDelay > IFS_MIN_DELAY)
            ctx.future(selfDelay + childDelay, 'reconBeat', { depth: depth + 1, delay: childDelay, gen: 0, cycleId: s.cycleId, row: 0 });
        }

        const lodO = depth < LOD_OUTER.length ? LOD_OUTER[depth] : 0;
        const ifsEnergy = s.ifsEnergy.slice();
        ifsEnergy[depth] = Math.min(1, (ifsEnergy[depth] ?? 0) + 0.3);
        const ifsEvents = [...(s.ifsEvents ?? []).slice(-80), { d: depth, delay, wt: ctx.wallTime }];
        if (!lodO) return { ...s, _reconBeatCount: s._reconBeatCount + 1, _reconBeatDepth: depth, ifsEnergy, ifsEvents };

        const distTarget = delay / DELAY_SCALE;
        const r2dSq = distTarget * distTarget - RECON_Z * RECON_Z;
        if (r2dSq < 0) return { ...s, _reconBeatCount: s._reconBeatCount + 1, _reconBeatDepth: depth, ifsEnergy, ifsEvents };
        const r2d    = Math.sqrt(r2dSq);
        const rMax   = r2d + 1.5;
        const rowEnd = Math.min(GRID, rowStart + RECON_ROWS_PER_BEAT);

        const plate = s.plate;
        const recon = s._reconBuf;

        for (let cy = rowStart; cy < rowEnd; cy += lodO) {
          for (let cx = 0; cx < GRID; cx += lodO) {
            const pid   = cy * GRID + cx;
            const srcRe = plate[pid * 2];
            const srcIm = plate[pid * 2 + 1];
            if (srcRe * srcRe + srcIm * srcIm < 1e-24) continue;
            const ry0 = Math.max(0,    Math.ceil (cy - rMax));
            const ry1 = Math.min(GRID, Math.floor(cy + rMax) + 1);
            const rx0 = Math.max(0,    Math.ceil (cx - rMax));
            const rx1 = Math.min(GRID, Math.floor(cx + rMax) + 1);
            for (let ry = ry0; ry < ry1; ry++) {
              const dy = ry - cy;
              for (let rx = rx0; rx < rx1; rx++) {
                const dx   = rx - cx;
                const d2   = Math.sqrt(dx * dx + dy * dy);
                if (Math.abs(d2 - r2d) >= 1.5) continue;
                const dist3d = Math.sqrt(dx * dx + dy * dy + RECON_Z * RECON_Z);
                const prop   = (dist3d / WAVELENGTH) * TWO_PI;
                const cosP   = Math.cos(prop), sinP = Math.sin(prop);
                const rid    = ry * GRID + rx;
                recon[rid * 2]     += (srcRe * cosP + srcIm * sinP) / dist3d;
                recon[rid * 2 + 1] += (-srcRe * sinP + srcIm * cosP) / dist3d;
              }
            }
          }
        }

        // Schedule next strip in virtual time — fires in a future heartbeat.
        if (rowEnd < GRID)
          ctx.future(IFS_MIN_DELAY, 'reconBeat', { depth, delay, gen, cycleId: s.cycleId, row: rowEnd });

        return {
          ...s, _reconBuf: recon, recon,
          _reconBeatCount: s._reconBeatCount + 1, _reconBeatDepth: depth,
          _reconRowIdx: s._reconRowIdx + 1,
          ifsEnergy, ifsEvents,
        };
      },

      finalizeRecon: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        return { ...s, recon: s._reconBuf ? s._reconBuf.slice() : s.recon, _emitActive: false, _reconActive: false };
      },

    });
    }
  );

  const _isStable = W.stable([hologram2], reflector);
  const _export   = W.export(Renkon, { hologram2 }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────

function makeHologram2Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    if (!document.getElementById('hologram2-wrap')) {
      const wrap = document.createElement('div'); wrap.id = 'hologram2-wrap';
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
    document.getElementById('hologram2-wrap').appendChild(root);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '11px', fontWeight: 'bold',
      marginBottom: '8px', letterSpacing: '1px', textAlign: 'center',
    });
    root.appendChild(title);

    // ── CSS grid: 2 rows × 4 columns ─────────────────────────────────────────
    // Row 1: wireframe | wavefront | plate | info
    // Row 2: IFS clock | recon log | recon contrast | (empty)
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr 108px',
      gap: '6px',
      alignItems: 'start',
    });
    root.appendChild(grid);

    // ── Canvas cell helper ────────────────────────────────────────────────────
    const makeDataCell = (label, color, cw, ch) => {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('div');
      Object.assign(lbl.style, { fontSize: '8px', color, textAlign: 'center', marginBottom: '3px', letterSpacing: '0.5px' });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      Object.assign(canvas.style, {
        width: '100%', height: 'auto', imageRendering: 'pixelated',
        borderRadius: '3px', display: 'block',
      });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    const makeWireCell = (label, color) => {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('div');
      Object.assign(lbl.style, { fontSize: '8px', color, textAlign: 'center', marginBottom: '3px', letterSpacing: '0.5px' });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 240;
      Object.assign(canvas.style, { width: '100%', height: 'auto', borderRadius: '3px', display: 'block', background: '#000' });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    // Row 1: wireframe | wavefront | plate | info
    const objWire  = makeWireCell(`CUBE  (${CUBE_PTS.length} src) — click`, '#442');
    objWire.canvas.style.cursor = 'pointer';
    const waveCell = makeDataCell('WAVEFRONT  (object field)', '#643', GRID, GRID);
    const plateCell = makeDataCell('HOLOGRAM PLATE  (+1 order)', '#226', GRID, GRID);
    const infoCell  = document.createElement('div');
    Object.assign(infoCell.style, { fontSize: '9px', color: '#444', lineHeight: '2.0', letterSpacing: '0.5px', paddingTop: '14px' });
    infoCell.innerHTML =
      `<div style="color:#553">PTS / EDGE</div><div style="color:#eee">${PTS_PER_EDGE}</div>` +
      `<div style="color:#553;margin-top:6px">PLATE GRID</div><div style="color:#eee">${GRID} × ${GRID}</div>` +
      `<div style="color:#553;margin-top:6px">WAVELENGTH</div><div style="color:#eee">${WAVELENGTH}</div>` +
      `<div style="color:#553;margin-top:6px">RECON Z</div><div style="color:#eee">${RECON_Z}</div>`;
    grid.appendChild(objWire.wrap);
    grid.appendChild(waveCell.wrap);
    grid.appendChild(plateCell.wrap);
    grid.appendChild(infoCell);

    // Row 2: recon log | recon contrast | (empty) | IFS clock
    const reconCell   = makeDataCell('RECONSTRUCTION  (log scale)', '#0a5', GRID, GRID);
    const reconHiCell = makeDataCell('RECONSTRUCTION  (contrast)', '#143', GRID, GRID);
    const ifsClock = makeIFSClockPanel({ label: 'HUYGENS IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    grid.appendChild(reconCell.wrap);
    grid.appendChild(reconHiCell.wrap);
    grid.appendChild(document.createElement('div'));
    grid.appendChild(ifsClock.el);

    // Stats row
    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, { fontSize: '9px', color: '#333', marginTop: '6px', textAlign: 'center' });
    root.appendChild(stats);

    const waveCtx    = waveCell.ctx;
    const plateCtx   = plateCell.ctx;
    const reconCtx   = reconCell.ctx;
    const reconHiCtx = reconHiCell.ctx;

    const waveBuf    = waveCtx.createImageData(GRID, GRID);
    const plateBuf_  = plateCtx.createImageData(GRID, GRID);
    const reconBuf_  = reconCtx.createImageData(GRID, GRID);
    const reconHiBuf = reconHiCtx.createImageData(GRID, GRID);

    // ── Wireframe ─────────────────────────────────────────────────────────────
    const _project = (ox, oy, oz, angle, W, H) => {
      const cosY = Math.cos(angle), sinY = Math.sin(angle);
      const cosX = Math.cos(INIT_ANGLE_X), sinX = Math.sin(INIT_ANGLE_X);
      const ry1 =  cosY * ox + sinY * oz;
      const ry2 =  oy;
      const rz1 = -sinY * ox + cosY * oz;
      const rx  =  ry1;
      const ry  =  cosX * ry2 - sinX * rz1;
      const rz  =  sinX * ry2 + cosX * rz1;
      const halfG  = (GRID - 1) / 2;
      const fscale = halfG * PROJ_SCALE;
      const z = CAM_Z - rz;
      return {
        px: (halfG + (rx / z) * fscale * CAM_Z) / GRID * W,
        py: (halfG - (ry / z) * fscale * CAM_Z) / GRID * H,
        depth: rz,
      };
    };

    let _wireHover = 0;
    let _wireRafId = null;
    let _wireAngleSnap = 0;

    const _drawCube = (ctx, angle, glow) => {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

      if (glow > 0) {
        const gr = ctx.createRadialGradient(W/2, H/2, W*0.1, W/2, H/2, W*0.65);
        gr.addColorStop(0, `rgba(80,200,255,${0.10 * glow})`);
        gr.addColorStop(0.5, `rgba(40,120,220,${0.18 * glow})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      }

      const pts = CUBE_VERTS.map(([ox, oy, oz]) => _project(ox, oy, oz, angle, W, H));
      for (let pass = 0; pass < 2; pass++) {
        for (const [ai, bi] of CUBE_EDGES) {
          const a = pts[ai], b = pts[bi];
          const avgD  = (a.depth + b.depth) / 2;
          const isBack = avgD < 0;
          if (pass === 0 && !isBack) continue;
          if (pass === 1 &&  isBack) continue;
          const t      = (avgD + 1) / 2;
          const bright = isBack ? 0.15 + t * 0.1 : 0.5 + t * 0.5;
          const alpha  = isBack ? 0.25 : 0.9;
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
          if (glow > 0 && !isBack) {
            const r = Math.floor((bright*220)*(1-glow) + 40*glow);
            const g = Math.floor((bright*160)*(1-glow) + 180*glow);
            const bv = Math.floor((bright*30) *(1-glow) + 255*glow);
            ctx.strokeStyle = `rgba(${r},${g},${bv},${alpha})`;
            ctx.lineWidth = 1.5 + glow * 1.5;
            if (glow > 0.3) { ctx.shadowColor = `rgba(60,180,255,${glow * 0.8})`; ctx.shadowBlur = 6 * glow; }
          } else {
            ctx.strokeStyle = `rgba(${Math.floor(bright*220)},${Math.floor(bright*160)},${Math.floor(bright*30)},${alpha})`;
            ctx.lineWidth = isBack ? 1 : 1.5;
            ctx.shadowBlur = 0;
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
      for (const { px, py, depth } of pts) {
        const t = (depth + 1) / 2, bright = 0.4 + t * 0.6;
        ctx.beginPath(); ctx.arc(px, py, 3 + t * 3, 0, Math.PI * 2);
        if (glow > 0) {
          const r = Math.floor(bright*255*(1-glow) + 60*glow);
          const g = Math.floor(bright*180*(1-glow) + 200*glow);
          const bv = Math.floor(bright*40*(1-glow) + 255*glow);
          ctx.fillStyle = `rgba(${r},${g},${bv},0.95)`;
          ctx.shadowColor = `rgba(80,200,255,${glow * 0.9})`; ctx.shadowBlur = 8 * glow;
        } else {
          ctx.fillStyle = `rgba(${Math.floor(bright*255)},${Math.floor(bright*180)},${Math.floor(bright*40)},0.95)`;
          ctx.shadowBlur = 0;
        }
        ctx.fill(); ctx.shadowBlur = 0;
      }
      ctx.fillStyle = glow > 0.3 ? `rgba(80,200,255,${0.4 + glow*0.4})` : 'rgba(200,150,30,0.3)';
      ctx.font = '7px ui-monospace,monospace';
      ctx.fillText(`cube ${CUBE_PTS.length} src  θ=${(angle * 180 / Math.PI).toFixed(1)}°`, 4, H - 4);
    };

    // ── Tone mapping ──────────────────────────────────────────────────────────
    const logScale = 1 / Math.log(1 + 9);

    const maxFieldI = (field) => {
      let m = 1e-9;
      for (let i = 0; i < N_CELLS; i++) {
        const re = field[i*2], im = field[i*2+1];
        const v = re*re + im*im;
        if (v > m) m = v;
      }
      return m;
    };

    const paintLog = (buf, field, tint) => {
      const mi = maxFieldI(field); if (mi < 1e-6) { buf.data.fill(0); return; }
      const norm = 1 / Math.sqrt(mi);
      for (let i = 0; i < N_CELLS; i++) {
        const re = field[i*2], im = field[i*2+1];
        const amp = Math.sqrt(re*re + im*im) * norm;
        const v = Math.log(1 + 9 * amp) * logScale;
        buf.data[i*4]   = Math.floor(v * tint[0]);
        buf.data[i*4+1] = Math.floor(v * tint[1]);
        buf.data[i*4+2] = Math.floor(v * tint[2]);
        buf.data[i*4+3] = 255;
      }
    };

    const paintReconHi = (buf, field) => {
      const mi = maxFieldI(field); if (mi < 1e-6) { buf.data.fill(0); return; }
      const norm = 1 / Math.sqrt(mi);
      for (let i = 0; i < N_CELLS; i++) {
        const re = field[i*2], im = field[i*2+1];
        const amp = Math.sqrt(re*re + im*im) * norm;
        const t = Math.max(0, (amp - 0.2) / 0.8);
        const v = Math.pow(t, 0.35);
        buf.data[i*4]   = Math.floor(v * v * 255);
        buf.data[i*4+1] = Math.floor(v * 255);
        buf.data[i*4+2] = Math.floor(v * 255);
        buf.data[i*4+3] = 255;
      }
    };


    // ── Wireframe interactions ────────────────────────────────────────────────
    const _wireRafDraw = () => {
      _wireRafId = null;
      _drawCube(objWire.ctx, _wireAngleSnap, _wireHover);
      if (_wireHover > 0.01) _wireRafId = requestAnimationFrame(_wireRafDraw);
    };
    objWire.canvas.addEventListener('mouseenter', () => {
      _wireHover = 1;
      if (!_wireRafId) { _wireRafId = requestAnimationFrame(_wireRafDraw); }
    });
    objWire.canvas.addEventListener('mouseleave', () => {
      const fade = () => {
        _wireHover = Math.max(0, _wireHover - 0.06);
        _drawCube(objWire.ctx, _wireAngleSnap, _wireHover);
        if (_wireHover > 0.01) requestAnimationFrame(fade);
      };
      requestAnimationFrame(fade);
    });
    const _triggerCycle = () => injectEvent?.({ type: 'nextCycle' });
    objWire.canvas.addEventListener('click', _triggerCycle);
    objWire.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault(); _wireHover = 1;
      if (!_wireRafId) { _wireRafId = requestAnimationFrame(_wireRafDraw); }
    }, { passive: false });
    objWire.canvas.addEventListener('touchend', (e) => {
      e.preventDefault(); _triggerCycle();
    }, { passive: false });

    // ── Render loop ───────────────────────────────────────────────────────────
    return () => {
      const h = world.getNodeState('hologram2');
      if (!h) return;

      const lt             = world.ps.app.logicalTime ?? 0;
      const angle          = h.angle ?? 0;
      const beatDepth      = h._beatDepth ?? 0;
      const beatCount      = h._beatCount ?? 0;
      const reconBeatCount = h._reconBeatCount ?? 0;
      const reconBeatDepth = h._reconBeatDepth ?? 0;
      const isEmitting     = !!h._emitActive;
      const isRecon        = !!h._reconActive;

      const depthCol = IFS_DEPTH_COLORS[beatDepth % IFS_DEPTH_COLORS.length];
      title.style.color = depthCol;
      title.textContent =
        `PEER ${peerId} · HOLOGRAM2  (IFS fractal clock)  ` +
        (isEmitting
          ? `[EMIT ◉ D${beatDepth} · ${beatCount} beats]`
          : isRecon
            ? `[RECON ◎ D${reconBeatDepth} · ${reconBeatCount} beats]`
            : `[IDLE — click cube]`);

      // IFS clock panel update
      ifsClock.update({ energy: h.ifsEnergy ?? [], events: h.ifsEvents ?? [], isActive: isEmitting || isRecon, lt });

      // Wireframe
      _wireAngleSnap = angle;
      if (!_wireRafId) _drawCube(objWire.ctx, angle, _wireHover);

      // Wavefront: orange log
      if (h.plate && maxFieldI(h.plate) > 1e-6)
        { paintLog(waveBuf, h.plate, [255, 120, 30]); waveCtx.putImageData(waveBuf, 0, 0); }

      // Hologram plate: blue log
      if (h.plate && maxFieldI(h.plate) > 1e-6)
        { paintLog(plateBuf_, h.plate, [40, 60, 255]); plateCtx.putImageData(plateBuf_, 0, 0); }

      // Reconstruction
      const rf = (h._reconBuf && maxFieldI(h._reconBuf) > 1e-6) ? h._reconBuf
               : (h.recon && maxFieldI(h.recon) > 1e-6) ? h.recon : null;
      if (rf) {
        paintLog(reconBuf_, rf, [30, 255, 140]);
        reconCtx.putImageData(reconBuf_, 0, 0);
        paintReconHi(reconHiBuf, rf);
        reconHiCtx.putImageData(reconHiBuf, 0, 0);
      }

      // Stats
      const cycleCount = h.cycleCount ?? 0;
      const drain = world.ps.app._lastDrainIters ?? 0;
      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `PEER ${peerId}  cycle=${cycleCount}  θ=${(angle * 180 / Math.PI).toFixed(1)}°` +
        `  lt=${lt}  drain=${drain}i  emit=${beatCount}  recon=${reconBeatCount}` +
        `  ${_clientBadge(world)}`;

      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Hologram2 | IFS Fractal Clock (new API)',
  selo:        'hologram2',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologram2WorldProgram + av],
  makeRenderer: makeHologram2Renderer,
  wrapId:      'hologram2-wrap',
  hideTopBar:  true,
};
