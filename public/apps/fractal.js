/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
import { makeIfsClock } from "../krestianstvo-wavefront-evaluator.js";

const REFLECTOR_MS       = 50;
const SUBTICK_MS         = 1;
const FRACTAL_DEPTH      = 5;
const FRACTAL_BASE_DELAY = 2.1415926535;
const FRACTAL_MIN_DELAY  = 0.1;
const FRACTAL_CYCLE      = 8;
const FRACTAL_DECAY      = 0.1;
const FRACTAL_IFS_MAPS   = [0.4142135623, 0.6180339887, 0.7320508075];

const fractalHeartbeatWorldProgram = makeIfsClock({
  depth:     FRACTAL_DEPTH,
  baseDelay: FRACTAL_BASE_DELAY,
  minDelay:  FRACTAL_MIN_DELAY,
  cycle:     FRACTAL_CYCLE,
  decay:     FRACTAL_DECAY,
  maps:      FRACTAL_IFS_MAPS,
  genCap:    6,
  onCycle: `(cycleCount, p, W) => {
    const r1 = W.rng.next(), r2 = W.rng.next(), r3 = W.rng.next();
    return { lx: (r1 - 0.5) * 2, ly: 1 + (r2 - 0.5) * 2, lz: (r3 - 0.5) * 2 };
  }`,
  onBeat: `(p, ctx, W) => {
    const { delay, lx = 0.1, ly = 0, lz = 25 } = p;
    const SIGMA = 10, RHO = 28, BETA = 2.6667, SCALE = 0.5, STEPS = 8;
    const dt = delay * SCALE / STEPS;
    const f = (x, y, z) => [SIGMA*(y-x), x*(RHO-z)-y, x*y-BETA*z];
    let nlx = lx, nly = ly, nlz = lz;
    for (let _s = 0; _s < STEPS; _s++) {
      const [k1x,k1y,k1z] = f(nlx,nly,nlz);
      const [k2x,k2y,k2z] = f(nlx+k1x*dt/2, nly+k1y*dt/2, nlz+k1z*dt/2);
      const [k3x,k3y,k3z] = f(nlx+k2x*dt/2, nly+k2y*dt/2, nlz+k2z*dt/2);
      const [k4x,k4y,k4z] = f(nlx+k3x*dt,   nly+k3y*dt,   nlz+k3z*dt);
      nlx += (k1x+2*k2x+2*k3x+k4x)*dt/6;
      nly += (k1y+2*k2y+2*k3y+k4y)*dt/6;
      nlz += (k1z+2*k2z+2*k3z+k4z)*dt/6;
      if (!isFinite(nlx)||!isFinite(nly)||!isFinite(nlz)) { nlx=lx; nly=ly; nlz=lz; break; }
    }
    return { lx: nlx, ly: nly, lz: nlz };
  }`,
}) + `
  const _wtFloor  = Math.floor(reflector.wallTime ?? 0);
  const _isStable = (fractal._nextAt ?? Infinity) >= _wtFloor + 1 && W.stable([fractal], reflector);
  const _export   = W.export(Renkon, { fractal }, _isStable);
`;

function makeFractalHeartbeatRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  const DEPTH_COLORS = ['#E34A27', '#FEA655', '#FFD98E', '#566357', '#909473'];
  const MAX_HISTORY  = 140;
  const TL_HISTORY   = 15;

  return (world, peerId, containerId, sendCursorMove) => {
    const history   = [];
    const tlHistory = Array.from({ length: TL_HISTORY }, () => ({ events: [], energy: [], lt: 0 }));
    let _historyLt  = -1;

    let _rafId      = null;
    let _liveEnergy = Array(FRACTAL_DEPTH).fill(0);
    let _lastDelay  = Array(FRACTAL_DEPTH).fill(0);
    let _ltPhase    = Array(FRACTAL_DEPTH).fill(0);
    let _cycleFrac  = 0;
    let _tlStatic   = null;
    let _tlStaticLt = -1;
    let _lastBeatT  = Array(FRACTAL_DEPTH).fill(null);
    let _logCycleId = -1;
    let _cycleLog   = [];
    const _ifsPoints    = [];
    const _wfaPoints    = [];
    const _lorenzPoints = [];
    let _lorenzIdx   = 0;
    let _lorenzCycle = -1;

    const _drawOscWheels = () => {
      const pwCanvas = document.getElementById(containerId + '-canvas-pw');
      if (!pwCanvas) return;

      const CW = pwCanvas.width, CH = pwCanvas.height;
      const c2d = pwCanvas.getContext('2d');
      const WR   = 22;
      const GAP  = CW / FRACTAL_DEPTH;
      const cy   = WR + 6;

      c2d.clearRect(0, 0, CW, CH);

      for (let d = 0; d < FRACTAL_DEPTH; d++) {
        const periodTicks = (_lastDelay[d] > 0) ? _lastDelay[d] : FRACTAL_BASE_DELAY / Math.pow(2, d);
        const periodMs    = periodTicks * REFLECTOR_MS;
        const cx          = GAP * d + GAP / 2;
        const e           = Math.min(1, _liveEnergy[d] ?? 0);
        const col         = DEPTH_COLORS[d];

        c2d.strokeStyle = '#1a1a28'; c2d.lineWidth = 1; c2d.globalAlpha = 0.7;
        c2d.beginPath(); c2d.arc(cx, cy, WR, 0, Math.PI * 2); c2d.stroke();

        const cyclesElapsed = _ltPhase[d];
        const spinsPerFrame = 16.7 / periodMs;
        const SAMPLES       = Math.max(1, Math.min(48, Math.ceil(spinsPerFrame * 6)));
        const baseAlpha     = (0.15 + e * 0.75) / Math.sqrt(SAMPLES);

        c2d.strokeStyle = col; c2d.lineWidth = 1.5; c2d.globalAlpha = baseAlpha;
        for (let s = 0; s < SAMPLES; s++) {
          const t     = (s + 1) / SAMPLES;
          const phase = cyclesElapsed - spinsPerFrame * (1 - t);
          const a     = phase * Math.PI * 2 - Math.PI / 2;
          c2d.beginPath(); c2d.moveTo(cx, cy); c2d.lineTo(cx + WR * Math.cos(a), cy + WR * Math.sin(a)); c2d.stroke();
        }

        const tipAngle = cyclesElapsed * Math.PI * 2 - Math.PI / 2;
        c2d.strokeStyle = col; c2d.lineWidth = 2.5; c2d.globalAlpha = 0.9;
        c2d.shadowColor = col; c2d.shadowBlur = 6;
        c2d.beginPath(); c2d.moveTo(cx, cy); c2d.lineTo(cx + WR * Math.cos(tipAngle), cy + WR * Math.sin(tipAngle)); c2d.stroke();
        c2d.shadowBlur = 0;

        c2d.fillStyle = col; c2d.globalAlpha = 0.4 + e * 0.5;
        c2d.beginPath(); c2d.arc(cx, cy, 2, 0, Math.PI * 2); c2d.fill();

        c2d.fillStyle = col; c2d.globalAlpha = 0.5 + e * 0.45;
        c2d.font = '7px ui-monospace'; c2d.textAlign = 'center';
        c2d.fillText('D' + d, cx, cy + WR + 11);

        c2d.fillStyle = '#2a2a35'; c2d.globalAlpha = 1;
        c2d.font = '6px ui-monospace';
        c2d.fillText(periodMs.toFixed(1) + 'ms', cx, cy + WR + 20);
      }

      c2d.globalAlpha = 1;

      const tlCanvas = document.getElementById(containerId + '-canvas-tl');
      if (tlCanvas && _tlStatic) {
        const tc  = tlCanvas.getContext('2d');
        const TCW = tlCanvas.width, TCH = tlCanvas.height;
        const PAD_L = 14, PAD_R = 4, PAD_T = 2, PAD_B = 12;
        const TW    = TCW - PAD_L - PAD_R;
        const TH    = TCH - PAD_T - PAD_B;
        const LANE_W = TW / FRACTAL_DEPTH;
        tc.clearRect(0, 0, TCW, TCH);
        tc.drawImage(_tlStatic, 0, 0);
        const liveFrac = _cycleFrac;
        for (let d = 0; d < FRACTAL_DEPTH; d++) {
          const lx = PAD_L + d * LANE_W + liveFrac * LANE_W;
          tc.strokeStyle = DEPTH_COLORS[d]; tc.lineWidth = 1.5; tc.globalAlpha = 0.6;
          tc.beginPath(); tc.moveTo(lx, PAD_T); tc.lineTo(lx, PAD_T + TH); tc.stroke();
        }
        tc.globalAlpha = 1;
      }

      _rafId = requestAnimationFrame(_drawOscWheels);
    };

    return () => {
      if (!world?.ps?.app) return;
      const f = world.getNodeState("fractal");
      if (!f) return;

      const energy     = f.energy || [];
      const totalBeats = f.totalBeats || 0;
      const cycleId    = f.cycleId   || 0;
      const drainIters = world.ps.app._lastDrainIters ?? 0;
      const lt         = world.ps.app.logicalTime || 0;

      if (lt !== _historyLt) {
        _historyLt = lt;
        for (let d = 0; d < FRACTAL_DEPTH; d++) {
          const periodTicks = FRACTAL_BASE_DELAY / Math.pow(2, d);
          _ltPhase[d] = (lt / periodTicks) % 1;
        }
        _cycleFrac  = (lt % FRACTAL_CYCLE) / FRACTAL_CYCLE;
        _liveEnergy = energy.slice();
        history.push(energy.slice());
        if (history.length > MAX_HISTORY) history.shift();
        const tickEvs = (f.tickEvents || []).slice();
        for (const { d, t, delay, wt } of tickEvs) {
          if (d < FRACTAL_DEPTH) { _lastBeatT[d] = t; if (delay > 0) _lastDelay[d] = delay; }
        }
        if (cycleId !== _logCycleId) { _logCycleId = cycleId; _cycleLog = []; }
        for (const { d, wt, delay, lx, ly, lz } of tickEvs) {
          _cycleLog.push({ depth: d, wt, delay });
          const logBase = Math.log(FRACTAL_BASE_DELAY);
          const logMin  = Math.log(FRACTAL_MIN_DELAY);
          const xRaw    = delay > 0 ? (Math.log(delay) - logMin) / (logBase - logMin) : 0;
          _ifsPoints.push({ x: Math.min(1, Math.max(0, xRaw)), y: d, col: DEPTH_COLORS[d] ?? '#888' });
          const ax = Math.min(1, Math.max(0, xRaw));
          const ay = wt % 1;
          _wfaPoints.push({ x: ax, y: ay, col: DEPTH_COLORS[d] ?? '#888' });
          if (lx !== undefined && lz !== undefined && isFinite(lx) && isFinite(lz)
              && Math.abs(lx) < 23 && lz > 4 && lz < 48) {
            _lorenzPoints.push({ lx, lz, col: DEPTH_COLORS[d] ?? '#888' });
          }
        }
        tlHistory.push({ events: tickEvs, energy: (f.energy || []).slice(), lt });
        if (tlHistory.length > TL_HISTORY) tlHistory.shift();
      }

      if (!document.getElementById("fractal-wrap")) {
        const wrap = document.createElement("div"); wrap.id = "fractal-wrap";
        Object.assign(wrap.style, { display: "flex", gap: "0", flexWrap: "wrap" });
        document.body.appendChild(wrap);
      }
      let root = document.getElementById(containerId);
      const canvasId = containerId + '-canvas';
      const cycleMs  = FRACTAL_CYCLE * 50;

      if (!root) {
        root = document.createElement("div"); root.id = containerId;
        Object.assign(root.style, {
          fontFamily: "ui-monospace,monospace", padding: "20px",
          background: "#0d0d0d", color: "#eee", borderRadius: "10px",
          margin: "10px", flex: "1", minWidth: "300px", border: "1px solid #222",
        });
        document.getElementById("fractal-wrap").appendChild(root);
        root.addEventListener('mousemove', (e) => {
          const rect = root.getBoundingClientRect();
          const roster = _seloInfo(world);
          if (!roster?.myId) return;
          sendCursorMove(world.id, roster.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
        }, { passive: true });

        const mk = (tag, style, attrs = {}) => {
          const el = document.createElement(tag);
          Object.assign(el.style, style);
          Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
          return el;
        };
        const label = (txt, style) => { const d = mk('div', style); d.textContent = txt; return d; };

        root.appendChild(label(`PEER ${peerId} · FRACTAL HEARTBEAT`, {
          fontSize: '11px', fontWeight: 'bold', color: '#444',
          marginBottom: '12px', letterSpacing: '1px', textAlign: 'center',
        }));
        const subLabel = mk('div', { fontSize: '9px', color: '#444', marginBottom: '10px', textAlign: 'center' });
        subLabel.id = containerId + '-sub';
        subLabel.textContent = `cascade every ${FRACTAL_CYCLE} ticks (${cycleMs}ms) · ${FRACTAL_DEPTH} depths · base ${FRACTAL_BASE_DELAY}t · min ${FRACTAL_MIN_DELAY}t`;
        root.appendChild(subLabel);

        const barsWrap = mk('div', {}); barsWrap.id = containerId + '-bars';
        for (let d = 0; d < FRACTAL_DEPTH; d++) {
          const col = DEPTH_COLORS[d] ?? '#888';
          const delayLbl = (FRACTAL_BASE_DELAY / Math.pow(2, d)).toFixed(4) + 't';
          const row = mk('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' });
          const lbl = mk('div', { width: '56px', fontSize: '9px', color: '#555', textAlign: 'right' });
          lbl.textContent = `D${d} · ${delayLbl}`;
          const track = mk('div', { flex: '1', background: '#161616', borderRadius: '2px', height: '14px', overflow: 'hidden' });
          const bar = mk('div', { width: '0%', height: '100%', background: col, borderRadius: '2px',
            transition: 'width 50ms ease-out', boxShadow: `0 0 6px ${col}88` });
          bar.id = containerId + '-bar-' + d;
          track.appendChild(bar);
          const val = mk('div', { width: '32px', fontSize: '9px', color: col });
          val.id = containerId + '-val-' + d;
          row.appendChild(lbl); row.appendChild(track); row.appendChild(val);
          barsWrap.appendChild(row);
        }
        root.appendChild(barsWrap);

        const mkCanvas = (id, w, h, style) => {
          const c = mk('canvas', style, { width: w, height: h }); c.id = id; return c;
        };
        root.appendChild(mkCanvas(canvasId, 260, 96,
          { width: '100%', borderRadius: '4px', background: '#080808', display: 'block', marginTop: '10px' }));
        root.appendChild(label('IFS ATTRACTOR  (x = log delay: MIN→BASE · y = depth)', { fontSize: '9px', color: '#333', marginTop: '10px', marginBottom: '3px', letterSpacing: '0.5px' }));
        root.appendChild(mkCanvas(canvasId + '-ifs', 260, 130,
          { width: '100%', borderRadius: '4px', background: '#02020a', display: 'block' }));
        root.appendChild(label('WAVEFRONT ATTRACTOR  (x = log delay: fine→coarse · y = phase wt mod 1)', { fontSize: '9px', color: '#333', marginTop: '10px', marginBottom: '3px', letterSpacing: '0.5px' }));
        root.appendChild(mkCanvas(canvasId + '-wfa', 480, 260,
          { width: '100%', borderRadius: '4px', background: '#00000f', display: 'block' }));
        root.appendChild(label('LORENZ ATTRACTOR  in fractal time  (x=X · y=Z · color=depth)', { fontSize: '9px', color: '#333', marginTop: '10px', marginBottom: '3px', letterSpacing: '0.5px' }));
        root.appendChild(mkCanvas(canvasId + '-art', 700, 700,
          { width: '100%', borderRadius: '4px', background: '#00000f', display: 'block' }));
        root.appendChild(label('WATERFALL + PHASE', { fontSize: '9px', color: '#333', marginTop: '10px', marginBottom: '3px', letterSpacing: '0.5px' }));
        root.appendChild(mkCanvas(canvasId + '-tl1', 260, 260,
          { width: '100%', borderRadius: '50%', background: '#050508', display: 'block' }));
        root.appendChild(label('PHASE LANES', { fontSize: '9px', color: '#333', marginTop: '10px', marginBottom: '3px', letterSpacing: '0.5px' }));
        root.appendChild(mkCanvas(canvasId + '-tl', 260, 100,
          { width: '100%', borderRadius: '4px', background: '#050508', display: 'block' }));
        root.appendChild(label('OSCILLATOR WHEELS', { fontSize: '9px', color: '#333', marginTop: '10px', marginBottom: '3px', letterSpacing: '0.5px' }));
        root.appendChild(mkCanvas(containerId + '-canvas-pw', 260, 76,
          { width: '100%', borderRadius: '4px', background: '#050508', display: 'block' }));

        const stats = mk('div', { display: 'flex', gap: '14px', marginTop: '8px', fontSize: '9px', color: '#444' });
        stats.id = containerId + '-stats';
        root.appendChild(stats);

        if (!_rafId) _rafId = requestAnimationFrame(_drawOscWheels);
      }

      for (let d = 0; d < FRACTAL_DEPTH; d++) {
        const e   = Math.min(1, energy[d] ?? 0);
        const bar = document.getElementById(containerId + '-bar-' + d);
        const val = document.getElementById(containerId + '-val-' + d);
        if (bar) bar.style.width = (e * 100).toFixed(1) + '%';
        if (val) val.textContent = e.toFixed(2);
      }
      const stats = document.getElementById(containerId + '-stats');
      if (stats) stats.innerHTML =
        `<span>cycle <span style="color:#555">${cycleId}</span></span>` +
        `<span>beats <span style="color:#555">${totalBeats}</span></span>` +
        `<span>drain <span style="color:#555">${drainIters}i</span></span>`;

      const ifsCanvas = document.getElementById(canvasId + '-ifs');
      if (ifsCanvas && _ifsPoints.length > 0) {
        const CW = ifsCanvas.width, CH = ifsCanvas.height;
        const c2d = ifsCanvas.getContext('2d');
        const PAD = 12;
        const IW = CW - PAD * 2, IH = CH - PAD * 2;
        if (ifsCanvas._drawn === undefined) {
          c2d.clearRect(0, 0, CW, CH);
          for (let d = 0; d < FRACTAL_DEPTH; d++) {
            const y = PAD + (d / (FRACTAL_DEPTH - 1)) * IH;
            c2d.strokeStyle = '#1a1a2e'; c2d.lineWidth = 0.5; c2d.globalAlpha = 1;
            c2d.beginPath(); c2d.moveTo(PAD, y); c2d.lineTo(PAD + IW, y); c2d.stroke();
            c2d.fillStyle = DEPTH_COLORS[d]; c2d.globalAlpha = 0.3;
            c2d.font = '7px ui-monospace'; c2d.textAlign = 'right';
            c2d.fillText('D' + d, PAD - 2, y + 2.5);
          }
          c2d.globalAlpha = 1;
          [0, 0.25, 0.5, 0.75, 1].forEach(v => {
            const x = PAD + v * IW;
            c2d.strokeStyle = '#1a1a2e'; c2d.lineWidth = 0.5;
            c2d.beginPath(); c2d.moveTo(x, PAD); c2d.lineTo(x, PAD + IH); c2d.stroke();
            c2d.fillStyle = '#252535'; c2d.font = '6px ui-monospace'; c2d.textAlign = 'center';
            c2d.fillText(v.toFixed(2), x, PAD + IH + 9);
          });
          ifsCanvas._drawn = 0;
        }
        const from = ifsCanvas._drawn;
        for (let i = from; i < _ifsPoints.length; i++) {
          const { x, y, col } = _ifsPoints[i];
          const px = PAD + x * IW;
          const py = PAD + (y / (FRACTAL_DEPTH - 1)) * IH;
          c2d.fillStyle = col;
          c2d.globalAlpha = 0.08; c2d.beginPath(); c2d.arc(px, py, 4, 0, Math.PI * 2); c2d.fill();
          c2d.globalAlpha = 0.75; c2d.beginPath(); c2d.arc(px, py, 1.2, 0, Math.PI * 2); c2d.fill();
        }
        ifsCanvas._drawn = _ifsPoints.length;
        c2d.globalAlpha = 1;
      }

      const artCanvas = document.getElementById(canvasId + '-art');
      if (artCanvas && _lorenzPoints.length > 0) {
        const CW = artCanvas.width, CH = artCanvas.height;
        const ac  = artCanvas.getContext('2d');
        const PAD = 12;
        const AW  = CW - PAD * 2, AH = CH - PAD * 2;
        const bx0 = -22, bx1 = 22, bz0 = 5, bz1 = 47;
        const toCanvasX = lx => PAD + ((lx - bx0) / (bx1 - bx0)) * AW;
        const toCanvasY = lz => PAD + AH - ((lz - bz0) / (bz1 - bz0)) * AH;
        if (artCanvas._drawn === undefined) {
          ac.clearRect(0, 0, CW, CH);
          ac.fillStyle = '#888'; ac.font = '7px ui-monospace'; ac.textAlign = 'center';
          ac.fillText('X', CW / 2, CH - 2);
          ac.save(); ac.translate(8, CH / 2); ac.rotate(-Math.PI / 2);
          ac.fillText('Z', 0, 0); ac.restore();
          artCanvas._drawn = 0;
        }
        const from = artCanvas._drawn;
        for (let i = from; i < _lorenzPoints.length; i++) {
          const { lx, lz, col } = _lorenzPoints[i];
          const px = toCanvasX(lx);
          const py = toCanvasY(lz);
          ac.fillStyle = col;
          ac.globalAlpha = 0.08; ac.beginPath(); ac.arc(px, py, 3, 0, Math.PI * 2); ac.fill();
          ac.globalAlpha = 0.85; ac.beginPath(); ac.arc(px, py, 0.8, 0, Math.PI * 2); ac.fill();
        }
        artCanvas._drawn = _lorenzPoints.length;
        ac.globalAlpha = 1;
      }

      const wfaCanvas = document.getElementById(canvasId + '-wfa');
      if (wfaCanvas && _wfaPoints.length > 0) {
        const CW = wfaCanvas.width, CH = wfaCanvas.height;
        const wc = wfaCanvas.getContext('2d');
        const PAD = 14;
        const WW = CW - PAD * 2, WH = CH - PAD * 2;
        if (wfaCanvas._drawn === undefined) {
          wc.clearRect(0, 0, CW, CH);
          [0, 0.25, 0.5, 0.75, 1].forEach(v => {
            const x = PAD + v * WW;
            wc.strokeStyle = '#111'; wc.lineWidth = 0.5; wc.globalAlpha = 1;
            wc.beginPath(); wc.moveTo(x, PAD); wc.lineTo(x, PAD + WH); wc.stroke();
            wc.fillStyle = '#252535'; wc.font = '6px ui-monospace'; wc.textAlign = 'center';
            wc.fillText(v.toFixed(2), x, PAD + WH + 9);
          });
          [0, 0.25, 0.5, 0.75, 1].forEach(v => {
            const y = PAD + v * WH;
            wc.strokeStyle = '#111'; wc.lineWidth = 0.5;
            wc.beginPath(); wc.moveTo(PAD, y); wc.lineTo(PAD + WW, y); wc.stroke();
          });
          wc.fillStyle = '#333'; wc.font = '7px ui-monospace'; wc.textAlign = 'center';
          wc.fillText('log delay (fine → coarse)', PAD + WW / 2, CH - 2);
          wc.save(); wc.translate(8, PAD + WH / 2); wc.rotate(-Math.PI / 2);
          wc.fillText('phase wt%1', 0, 0); wc.restore();
          wfaCanvas._drawn = 0;
        }
        const wfFrom = wfaCanvas._drawn;
        for (let i = wfFrom; i < _wfaPoints.length; i++) {
          const { x, y, col } = _wfaPoints[i];
          const px = PAD + x * WW;
          const py = PAD + y * WH;
          wc.fillStyle = col;
          wc.globalAlpha = 0.07; wc.beginPath(); wc.arc(px, py, 3, 0, Math.PI * 2); wc.fill();
          wc.globalAlpha = 0.75; wc.beginPath(); wc.arc(px, py, 0.8, 0, Math.PI * 2); wc.fill();
        }
        wfaCanvas._drawn = _wfaPoints.length;
        wc.globalAlpha = 1;
      }

      const canvas = document.getElementById(canvasId);
      if (canvas && history.length > 1) {
        const CW = canvas.width, CH = canvas.height;
        const c2d = canvas.getContext("2d");
        c2d.clearRect(0, 0, CW, CH);
        for (let d = FRACTAL_DEPTH - 1; d >= 0; d--) {
          const col = DEPTH_COLORS[d] ?? '#888';
          c2d.strokeStyle = col; c2d.lineWidth = 1.5; c2d.globalAlpha = 0.55 + d * 0.09;
          c2d.beginPath();
          history.forEach((snap, i) => {
            const x = (i / (MAX_HISTORY - 1)) * CW;
            const e = Math.min(1, snap[d] ?? 0);
            const baseline = CH - 2 - d * (CH / FRACTAL_DEPTH);
            const y = baseline - e * (CH / FRACTAL_DEPTH - 4);
            if (i === 0) c2d.moveTo(x, y); else c2d.lineTo(x, y);
          });
          c2d.stroke();
        }
        c2d.globalAlpha = 1;
      }

      const _cycleX = (wt) => (wt % FRACTAL_CYCLE) / FRACTAL_CYCLE;

      const tl1Canvas = document.getElementById(canvasId + '-tl1');
      if (tl1Canvas) {
        const CW   = tl1Canvas.width, CH = tl1Canvas.height;
        const cx   = CW / 2, cy = CH / 2;
        const R_MAX = Math.min(cx, cy) - 6;
        const R_MIN = 18;
        const depthR = (d) => R_MAX - d * (R_MAX - R_MIN) / (FRACTAL_DEPTH - 1);
        const RING_W = (R_MAX - R_MIN) / (FRACTAL_DEPTH - 1) * 0.38;
        const ARC_W  = 0.04 * Math.PI;
        const c2d    = tl1Canvas.getContext('2d');
        c2d.clearRect(0, 0, CW, CH);

        for (let d = 0; d < FRACTAL_DEPTH; d++) {
          const r = depthR(d);
          c2d.strokeStyle = DEPTH_COLORS[d]; c2d.lineWidth = 0.5; c2d.globalAlpha = 0.08;
          c2d.beginPath(); c2d.arc(cx, cy, r, 0, Math.PI * 2); c2d.stroke();
        }

        for (let g = 0; g < 4; g++) {
          const a = (g / 4) * Math.PI * 2 - Math.PI / 2;
          c2d.strokeStyle = '#1e1e28'; c2d.lineWidth = 1; c2d.globalAlpha = 0.4;
          c2d.beginPath();
          c2d.moveTo(cx + R_MIN * Math.cos(a), cy + R_MIN * Math.sin(a));
          c2d.lineTo(cx + R_MAX * Math.cos(a), cy + R_MAX * Math.sin(a));
          c2d.stroke();
        }

        tlHistory.forEach(({ events, energy: rowEnergy }, idx) => {
          const age = idx / (TL_HISTORY - 1);
          for (const { d, t } of events) {
            if (d >= FRACTAL_DEPTH) continue;
            const e     = Math.min(1, rowEnergy[d] ?? 0);
            const col   = DEPTH_COLORS[d] ?? '#888';
            const alpha = age * (0.4 + e * 0.6);
            const r     = depthR(d);
            const angle = t * Math.PI * 2 - Math.PI / 2;
            const r0    = r - RING_W;
            const r1    = r + RING_W;
            c2d.fillStyle   = col; c2d.globalAlpha = alpha;
            c2d.shadowColor = col; c2d.shadowBlur  = age * (4 + e * 8);
            c2d.beginPath();
            c2d.arc(cx, cy, r1, angle - ARC_W, angle + ARC_W);
            c2d.arc(cx, cy, r0, angle + ARC_W, angle - ARC_W, true);
            c2d.closePath(); c2d.fill();
            c2d.shadowBlur = 0;
          }
          c2d.globalAlpha = 1;
        });

        const handAngle = (lt % FRACTAL_CYCLE) / FRACTAL_CYCLE * Math.PI * 2 - Math.PI / 2;
        for (let d = FRACTAL_DEPTH - 1; d >= 0; d--) {
          const e   = Math.min(1, energy[d] ?? 0);
          const dr  = depthR(d);
          const col = DEPTH_COLORS[d];
          c2d.strokeStyle = col; c2d.lineWidth = 1 + e * 2;
          c2d.globalAlpha = 0.15 + e * 0.85;
          c2d.shadowColor = col; c2d.shadowBlur = e * e * 40;
          c2d.beginPath(); c2d.moveTo(cx, cy); c2d.lineTo(cx + dr * Math.cos(handAngle), cy + dr * Math.sin(handAngle)); c2d.stroke();
          c2d.shadowBlur = 0;
        }

        c2d.fillStyle = '#1a1a28'; c2d.globalAlpha = 1;
        c2d.beginPath(); c2d.arc(cx, cy, R_MIN - 4, 0, Math.PI * 2); c2d.fill();

        c2d.fillStyle = '#252535'; c2d.font = '8px ui-monospace';
        c2d.textAlign = 'center'; c2d.globalAlpha = 1;
        c2d.fillText((lt % FRACTAL_CYCLE) + ' / ' + FRACTAL_CYCLE, cx, CH - 4);
        c2d.globalAlpha = 1;
      }

      const tlCanvas = document.getElementById(canvasId + '-tl');
      if (tlCanvas) {
        const CW = tlCanvas.width, CH = tlCanvas.height;
        const PAD_L = 14, PAD_R = 4, PAD_T = 2, PAD_B = 12;
        const TW = CW - PAD_L - PAD_R;
        const TH = CH - PAD_T - PAD_B;
        const ROW_H = TH / TL_HISTORY;
        const LANE_W = TW / FRACTAL_DEPTH;

        if (!_tlStatic || _tlStatic.width !== CW || _tlStatic.height !== CH) {
          _tlStatic = document.createElement('canvas');
          _tlStatic.width = CW; _tlStatic.height = CH;
          _tlStaticLt = -1;
        }
        if (_tlStaticLt !== lt) {
          _tlStaticLt = lt;
          const sc = _tlStatic.getContext('2d');
          sc.clearRect(0, 0, CW, CH);

          for (let d = 0; d < FRACTAL_DEPTH; d++) {
            const lx = PAD_L + d * LANE_W;
            sc.strokeStyle = '#181820'; sc.lineWidth = 1; sc.globalAlpha = 0.5;
            sc.beginPath(); sc.moveTo(lx, PAD_T); sc.lineTo(lx, PAD_T + TH); sc.stroke();
            sc.fillStyle = DEPTH_COLORS[d]; sc.globalAlpha = 0.4;
            sc.font = '6px ui-monospace'; sc.textAlign = 'left';
            sc.fillText('D' + d, lx + 2, PAD_T + 7);
          }

          tlHistory.forEach(({ events, energy: rowEnergy }, idx) => {
            const age  = idx / (TL_HISTORY - 1);
            const rowY = PAD_T + idx * ROW_H;
            const markH = Math.max(2, ROW_H);
            for (const { d, wt } of events) {
              if (d >= FRACTAL_DEPTH || wt == null) continue;
              const frac  = _cycleX(wt);
              const e     = Math.min(1, rowEnergy[d] ?? 0);
              const col   = DEPTH_COLORS[d] ?? '#888';
              const lx    = PAD_L + d * LANE_W;
              const alpha = (0.25 + age * 0.55) + e * 0.20;
              const mx    = lx + frac * LANE_W;
              sc.fillStyle   = col; sc.globalAlpha = alpha;
              sc.shadowColor = col; sc.shadowBlur  = 4 + e * 6;
              sc.fillRect(mx - 2, rowY, 4, markH);
              sc.shadowBlur  = 0;
            }
            sc.globalAlpha = 1;
          });

          sc.globalAlpha = 0.06;
          sc.fillStyle = '#ffffff';
          sc.fillRect(PAD_L, PAD_T + (TL_HISTORY - 1) * ROW_H, TW, ROW_H);
          sc.globalAlpha = 1;
        }
      }
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Lorenz Attractor | IFS Clock',
  selo:        'lorenz',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [fractalHeartbeatWorldProgram + av],
  makeRenderer: makeFractalHeartbeatRenderer,
  wrapId:      'fractal-wrap',
};
