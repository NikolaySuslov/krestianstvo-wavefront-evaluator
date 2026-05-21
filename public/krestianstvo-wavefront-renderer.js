/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── krestianstvo-wavefront-renderer.js ───────────────────────────────────────
//
// Shared renderer utilities for krestianstvo-wavefront-evaluator examples.
//
// Exports:
//
//   makeIFSClockPanel(opts) → { el, update(snap) }
//     Creates the three-canvas IFS clock panel (waterfall + phase rings +
//     oscillator wheels). The returned `el` is a DOM div ready to be appended
//     anywhere. Call `update(snap)` each render-loop iteration.
//
//     opts:
//       label        — string shown above the panel (default: 'IFS CLOCK')
//       labelColor   — CSS color for the label (default: '#0cf')
//       depth        — number of IFS depth levels (default: 4)
//       colors       — array of CSS color strings, one per depth
//       maxHistory   — waterfall row history length (default: 40)
//       gridRow      — CSS gridRow value if panel should span rows (optional)
//
//     snap (passed to update each frame):
//       energy       — Float32Array or Array[depth]  per-depth energy 0..1
//       events       — Array of { d, delay, wt }     beat event log
//       isActive     — bool   whether IFS is currently firing
//       lt           — number logical time (used to advance waterfall once/lt)
//
//   IFS_DEPTH_COLORS   — default depth color palette (cyan → purple)

// ── Default depth color palette ───────────────────────────────────────────────
export const IFS_DEPTH_COLORS = ['#00d4ff', '#0090ff', '#6040ff', '#c020a0', '#ff4080'];

// ── makeIFSClockPanel ─────────────────────────────────────────────────────────
export function makeIFSClockPanel({
  label      = 'IFS CLOCK',
  labelColor = '#0cf',
  depth      = 4,
  colors     = IFS_DEPTH_COLORS,
  maxHistory = 40,
  gridRow    = null,
} = {}) {

  // ── DOM ──────────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { width: '100%' });
  if (gridRow) wrap.style.gridRow = gridRow;

  const lbl = document.createElement('div');
  Object.assign(lbl.style, {
    fontSize: '7px', color: labelColor, textAlign: 'center',
    marginBottom: '3px', letterSpacing: '0.5px',
  });
  lbl.textContent = label;
  wrap.appendChild(lbl);

  const mkCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    Object.assign(c.style, { width: '100%', display: 'block', marginBottom: '2px' });
    wrap.appendChild(c);
    return c;
  };

  const wfCanvas     = mkCanvas(108, 54);
  const ringsCanvas  = mkCanvas(108, 108);
  const wheelsCanvas = mkCanvas(108, 48);

  // ── State ────────────────────────────────────────────────────────────────────
  const wfHistory = [];
  const ltPhase   = new Array(depth).fill(0);
  const lastDelay = new Array(depth).fill(1);
  let _vizLt      = -1;
  let _rafId      = null;
  let _active     = false;
  let _snap       = new Array(depth).fill(0);

  // ── Draw ─────────────────────────────────────────────────────────────────────
  const _draw = () => {
    // Waterfall — bar chart, newest row at top
    const wfCtx = wfCanvas.getContext('2d');
    const WW = wfCanvas.width, WH = wfCanvas.height;
    wfCtx.fillStyle = '#000'; wfCtx.fillRect(0, 0, WW, WH);
    const rowH = Math.max(1, Math.floor(WH / maxHistory));
    const barW = Math.floor(WW / depth);
    for (let t = 0; t < wfHistory.length && t * rowH < WH; t++) {
      const row = wfHistory[wfHistory.length - 1 - t];
      for (let d = 0; d < depth; d++) {
        wfCtx.globalAlpha = row[d] ?? 0;
        wfCtx.fillStyle   = colors[d] ?? '#fff';
        wfCtx.fillRect(d * barW, t * rowH, barW - 1, rowH);
      }
    }
    wfCtx.globalAlpha = 1;

    // Phase rings — concentric rings with a dot at current phase position
    const rCtx = ringsCanvas.getContext('2d');
    const RW = ringsCanvas.width, RH = ringsCanvas.height;
    rCtx.fillStyle = '#000'; rCtx.fillRect(0, 0, RW, RH);
    const cx = RW / 2, cy = RH / 2;
    for (let d = 0; d < depth; d++) {
      const ph  = ltPhase[d] ?? 0;
      const rad = (d + 1) / (depth + 1) * Math.min(cx, cy) * 0.9;
      const en  = _snap[d] ?? 0;
      rCtx.beginPath(); rCtx.arc(cx, cy, rad, 0, Math.PI * 2);
      rCtx.strokeStyle = colors[d] ?? '#fff';
      rCtx.globalAlpha = 0.15 + en * 0.6;
      rCtx.lineWidth   = 1 + en * 2;
      rCtx.stroke();
      const px = cx + Math.cos(ph * Math.PI * 2) * rad;
      const py = cy + Math.sin(ph * Math.PI * 2) * rad;
      rCtx.beginPath(); rCtx.arc(px, py, 2 + en * 3, 0, Math.PI * 2);
      rCtx.fillStyle   = colors[d] ?? '#fff';
      rCtx.globalAlpha = 0.5 + en * 0.5;
      rCtx.fill();
    }
    rCtx.globalAlpha = 1;

    // Oscillator wheels — spinning hand per depth
    const wCtx = wheelsCanvas.getContext('2d');
    const OW = wheelsCanvas.width, OH = wheelsCanvas.height;
    wCtx.fillStyle = '#000'; wCtx.fillRect(0, 0, OW, OH);
    const slotW = Math.floor(OW / depth);
    for (let d = 0; d < depth; d++) {
      const ph = ltPhase[d] ?? 0;
      const en = _snap[d] ?? 0;
      const x0 = d * slotW + slotW / 2;
      const y0 = OH / 2;
      const rr = Math.min(slotW, OH) * 0.38;
      wCtx.beginPath(); wCtx.arc(x0, y0, rr, 0, Math.PI * 2);
      wCtx.strokeStyle = colors[d] ?? '#fff';
      wCtx.globalAlpha = 0.2; wCtx.lineWidth = 1; wCtx.stroke();
      wCtx.beginPath();
      wCtx.moveTo(x0, y0);
      wCtx.lineTo(x0 + Math.cos(ph * Math.PI * 2) * rr,
                  y0 + Math.sin(ph * Math.PI * 2) * rr);
      wCtx.strokeStyle = colors[d] ?? '#fff';
      wCtx.globalAlpha = 0.4 + en * 0.6;
      wCtx.lineWidth   = 1 + en * 2;
      wCtx.stroke();
    }
    wCtx.globalAlpha = 1;
  };

  const _raf = () => {
    _rafId = null;
    if (!_active) return;
    _draw();
    _rafId = requestAnimationFrame(_raf);
  };

  // ── update(snap) — called from the app render loop ────────────────────────
  //   snap.energy   Array[depth]        per-depth energy 0..1
  //   snap.events   Array[{d,delay,wt}] beat event log
  //   snap.isActive bool
  //   snap.lt       number
  const update = ({ energy = [], events = [], isActive = false, lt = 0 } = {}) => {
    _snap   = energy;
    _active = isActive;

    if (lt !== _vizLt) {
      _vizLt = lt;
      if (isActive) {
        wfHistory.push(energy.slice());
        if (wfHistory.length > maxHistory) wfHistory.shift();
      }
      for (const { d, delay, wt } of events.slice(-80)) {
        if (d < depth && delay > 0) {
          lastDelay[d] = delay;
          ltPhase[d]   = (wt / delay) % 1;
        }
      }
    }

    if (_active && !_rafId) {
      _rafId = requestAnimationFrame(_raf);
    }
  };

  return { el: wrap, update };
}
