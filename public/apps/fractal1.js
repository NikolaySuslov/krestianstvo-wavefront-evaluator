/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
const REFLECTOR_MS         = 50;
const SUBTICK_MS           = 1;
const FRACTAL_DEPTH_1      = 5;
const FRACTAL_BASE_DELAY_1 = 8.3;
const FRACTAL_MIN_DELAY_1  = 0.0001;
const FRACTAL_CYCLE_1      = 200;
const FRACTAL_DECAY_1      = 0.03;

const fractalHeartbeatWorldProgram1 = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const fractal = Behaviors.collect(
    { energy: Array(${FRACTAL_DEPTH_1}).fill(0), cycleId: 0, totalBeats: 0,
      spawned: Array(${FRACTAL_DEPTH_1}).fill(false), tickEvents: [] },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "fractal", {
      __macro: (s, p, ctx) => {
        const energy = (s.energy || []).map(e => Math.max(0, e - ${FRACTAL_DECAY_1}));
        if (p.logicalTime % ${FRACTAL_CYCLE_1} === 1) {
          ctx.future(0, "initBeat", { cycleId: p.logicalTime });
          return { ...s, energy, cycleId: p.logicalTime,
                   spawned: Array(${FRACTAL_DEPTH_1}).fill(false), tickEvents: [] };
        }
        return { ...s, energy, tickEvents: [] };
      },
      initBeat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const energy = [...(s.energy || Array(${FRACTAL_DEPTH_1}).fill(0))];
        energy[0] = 1.0;
        ctx.future(${FRACTAL_BASE_DELAY_1}, "beat",
          { depth: 0, delay: ${FRACTAL_BASE_DELAY_1}, cycleId: s.cycleId });
        return { ...s, energy, totalBeats: s.totalBeats + 1 };
      },
      beat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const { depth, delay } = p;
        if (depth >= ${FRACTAL_DEPTH_1}) return s;
        ctx.future(delay, "beat", { depth, delay, cycleId: s.cycleId });
        const spawned = [...(s.spawned || Array(${FRACTAL_DEPTH_1}).fill(false))];
        const energy  = [...(s.energy  || Array(${FRACTAL_DEPTH_1}).fill(0))];
        if (!spawned[depth]) {
          energy[depth] = 1.0;
          const childDepth = depth + 1;
          const childDelay = delay / 2;
          if (childDepth < ${FRACTAL_DEPTH_1} && childDelay >= ${FRACTAL_MIN_DELAY_1}) {
            ctx.future(childDelay, "beat",
              { depth: childDepth, delay: childDelay, cycleId: s.cycleId });
          }
          spawned[depth] = true;
        }
        const subT = ctx.wallTime % 1;
        const tickEvents = [...(s.tickEvents || []), { d: depth, t: subT, wt: ctx.wallTime, delay }];
        return { ...s, energy, spawned, totalBeats: s.totalBeats + 1, tickEvents };
      },
    })
  );

  const _wtFloor  = Math.floor(reflector.wallTime ?? 0);
  const _isStable = (fractal._nextAt ?? Infinity) >= _wtFloor + 1 && W.stable([fractal], reflector);
  const _export   = W.export(Renkon, { fractal }, _isStable);
`;

function makeFractalHeartbeatRenderer1(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  const DEPTH_COLORS = ['#E34A27', '#FEA655', '#FFD98E', '#566357', '#909473'];
  const MAX_HISTORY  = 140;
  const TL_HISTORY   = 15;

  return (world, peerId, containerId, sendCursorMove) => {
    const history   = [];
    const tlHistory = Array.from({ length: TL_HISTORY }, () => ({ events: [], energy: [], lt: 0 }));
    let _historyLt  = -1;

    let _rafId      = null;
    let _liveEnergy = Array(FRACTAL_DEPTH_1).fill(0);
    let _ltPhase    = Array(FRACTAL_DEPTH_1).fill(0);
    let _cycleFrac  = 0;
    let _tlStatic   = null;
    let _tlStaticLt = -1;
    let _lastBeatT  = Array(FRACTAL_DEPTH_1).fill(null);

    const _drawOscWheels = () => {
      const pwCanvas = document.getElementById(containerId + '-canvas-pw');
      if (!pwCanvas) return;

      const CW = pwCanvas.width, CH = pwCanvas.height;
      const c2d = pwCanvas.getContext('2d');
      const WR   = 22;
      const GAP  = CW / FRACTAL_DEPTH_1;
      const cy   = WR + 6;

      c2d.clearRect(0, 0, CW, CH);

      for (let d = 0; d < FRACTAL_DEPTH_1; d++) {
        const periodTicks = FRACTAL_BASE_DELAY_1 / Math.pow(2, d);
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
        const LANE_W = TW / FRACTAL_DEPTH_1;
        tc.clearRect(0, 0, TCW, TCH);
        tc.drawImage(_tlStatic, 0, 0);
        const liveFrac = _cycleFrac;
        for (let d = 0; d < FRACTAL_DEPTH_1; d++) {
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
        for (let d = 0; d < FRACTAL_DEPTH_1; d++) {
          const periodTicks = FRACTAL_BASE_DELAY_1 / Math.pow(2, d);
          _ltPhase[d] = (lt / periodTicks) % 1;
        }
        _cycleFrac  = (lt % FRACTAL_CYCLE_1) / FRACTAL_CYCLE_1;
        _liveEnergy = energy.slice();
        history.push(energy.slice());
        if (history.length > MAX_HISTORY) history.shift();
        const tickEvs = (f.tickEvents || []).slice();
        for (const { d, t } of tickEvs) {
          if (d < FRACTAL_DEPTH_1) _lastBeatT[d] = t;
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
      const cycleMs  = FRACTAL_CYCLE_1 * 50;

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
        subLabel.textContent = `cascade every ${FRACTAL_CYCLE_1} ticks (${cycleMs}ms) · ${FRACTAL_DEPTH_1} depths · base ${FRACTAL_BASE_DELAY_1}ms`;
        root.appendChild(subLabel);

        const barsWrap = mk('div', {}); barsWrap.id = containerId + '-bars';
        for (let d = 0; d < FRACTAL_DEPTH_1; d++) {
          const col = DEPTH_COLORS[d] ?? '#888';
          const delayLbl = (FRACTAL_BASE_DELAY_1 / Math.pow(2, d)).toFixed(4) + 't';
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

      for (let d = 0; d < FRACTAL_DEPTH_1; d++) {
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

      const canvas = document.getElementById(canvasId);
      if (canvas && history.length > 1) {
        const CW = canvas.width, CH = canvas.height;
        const c2d = canvas.getContext("2d");
        c2d.clearRect(0, 0, CW, CH);
        for (let d = FRACTAL_DEPTH_1 - 1; d >= 0; d--) {
          const col = DEPTH_COLORS[d] ?? '#888';
          c2d.strokeStyle = col; c2d.lineWidth = 1.5; c2d.globalAlpha = 0.55 + d * 0.09;
          c2d.beginPath();
          history.forEach((snap, i) => {
            const x = (i / (MAX_HISTORY - 1)) * CW;
            const e = Math.min(1, snap[d] ?? 0);
            const baseline = CH - 2 - d * (CH / FRACTAL_DEPTH_1);
            const y = baseline - e * (CH / FRACTAL_DEPTH_1 - 4);
            if (i === 0) c2d.moveTo(x, y); else c2d.lineTo(x, y);
          });
          c2d.stroke();
        }
        c2d.globalAlpha = 1;
      }

      const _cycleX = (wt) => (wt % FRACTAL_CYCLE_1) / FRACTAL_CYCLE_1;

      const tl1Canvas = document.getElementById(canvasId + '-tl1');
      if (tl1Canvas) {
        const CW   = tl1Canvas.width, CH = tl1Canvas.height;
        const cx   = CW / 2, cy = CH / 2;
        const R_MAX = Math.min(cx, cy) - 6;
        const R_MIN = 18;
        const depthR = (d) => R_MAX - d * (R_MAX - R_MIN) / (FRACTAL_DEPTH_1 - 1);
        const RING_W = (R_MAX - R_MIN) / (FRACTAL_DEPTH_1 - 1) * 0.38;
        const ARC_W  = 0.04 * Math.PI;
        const c2d    = tl1Canvas.getContext('2d');
        c2d.clearRect(0, 0, CW, CH);

        for (let d = 0; d < FRACTAL_DEPTH_1; d++) {
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
            if (d >= FRACTAL_DEPTH_1) continue;
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

        const handAngle = (lt % FRACTAL_CYCLE_1) / FRACTAL_CYCLE_1 * Math.PI * 2 - Math.PI / 2;
        for (let d = FRACTAL_DEPTH_1 - 1; d >= 0; d--) {
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
        c2d.fillText((lt % FRACTAL_CYCLE_1) + ' / ' + FRACTAL_CYCLE_1, cx, CH - 4);
        c2d.globalAlpha = 1;
      }

      const tlCanvas = document.getElementById(canvasId + '-tl');
      if (tlCanvas) {
        const CW = tlCanvas.width, CH = tlCanvas.height;
        const PAD_L = 14, PAD_R = 4, PAD_T = 2, PAD_B = 12;
        const TW = CW - PAD_L - PAD_R;
        const TH = CH - PAD_T - PAD_B;
        const ROW_H = TH / TL_HISTORY;
        const LANE_W = TW / FRACTAL_DEPTH_1;

        if (!_tlStatic || _tlStatic.width !== CW || _tlStatic.height !== CH) {
          _tlStatic = document.createElement('canvas');
          _tlStatic.width = CW; _tlStatic.height = CH;
          _tlStaticLt = -1;
        }
        if (_tlStaticLt !== lt) {
          _tlStaticLt = lt;
          const sc = _tlStatic.getContext('2d');
          sc.clearRect(0, 0, CW, CH);

          for (let d = 0; d < FRACTAL_DEPTH_1; d++) {
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
              if (d >= FRACTAL_DEPTH_1 || wt == null) continue;
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
  title:       'Fractal Heartbeat',
  selo:        'fractal',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [fractalHeartbeatWorldProgram1 + av],
  makeRenderer: makeFractalHeartbeatRenderer1,
  wrapId:      'fractal-wrap',
};
