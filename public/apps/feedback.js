/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
const REFLECTOR_MS = 50;
const FB_STEP_MS   = 1;
const FB_CYCLE_MS  = 80;

const feedbackWorldProgram = `
  const W       = Renkon.app.W;
  const reflector = Events.receiver();

  const estimator = Behaviors.collect(
    { value: 0, iterations: 0, cycleId: 0, trace: [] },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "estimator", {
      __macro: (s, p, ctx) => {
        if (p.logicalTime % ${FB_CYCLE_MS} !== 1) return s;
        const cycleId = p.logicalTime;
        const initial = 50 + 49 * Math.sin(p.wallTime * 0.0023);
        ctx.future(0, "sendObserve", { value: initial, cycleId, wt: p.wallTime });
        return { ...s, value: initial, iterations: 0, cycleId, trace: [{n:0, v:initial}] };
      },
      sendObserve: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        ctx.send("corrector", "observe", { value: p.value, cycleId: p.cycleId });
        return s;
      },
      refine: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const delta = Math.abs(p.correction - s.value);
        const refined = (s.value + p.correction) / 2;
        if (delta > 0.01) ctx.feedback("continueRefine", { value: refined, cycleId: s.cycleId }, 64);
        const newIter = s.iterations + 1;
        const newTrace = s.trace ? [...s.trace, {n:newIter, v:refined}] : [{n:newIter, v:refined}];
        return { ...s, value: refined, iterations: newIter, trace: newTrace };
      },
      continueRefine: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        ctx.send("corrector", "observe", { value: p.value, cycleId: p.cycleId });
        return s;
      },
    })
  );

  const corrector = Behaviors.collect(
    { correction: 0, cycleId: 0 },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "corrector", {
      observe: (s, p, ctx) => {
        if (p.cycleId < s.cycleId) return s;
        const target = Math.round(p.value);
        const correction = (p.value + target) / 2;
        ctx.feedback("respond", { correction, cycleId: p.cycleId }, 64);
        return { ...s, correction, cycleId: p.cycleId };
      },
      respond: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        ctx.send("estimator", "refine", { correction: p.correction, cycleId: p.cycleId });
        return s;
      },
    })
  );

  const _isStable = W.stable([estimator, corrector], reflector);
  const _export   = W.export(Renkon, { estimator, corrector }, _isStable);
`;

function makeFeedbackRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove) => {
    const stack = new Map();
    const BISECT_HISTORY = 5;
    const bisectTraces = [];
    let bisectCurrent = null;
    let canvas = null;

    return () => {
      if (!world?.ps?.app) return;
      const lineColor = peerId === 'A' ? '#7c3aed' : '#1d9e75';

      const e  = world.getNodeState("estimator");
      const lt = e?.cycleId || world.ps.app.logicalTime || 0;
      const data = { lt, value: e?.value ?? 0, iterations: e?.iterations ?? 0, depth: e?.iterations ?? 0, stable: world.ps.app.isStable ?? false };

      if (lt > 0) {
        if (!stack.has(lt)) stack.set(lt, { depth: 0, value: null, iterations: 0, stable: false, status: 'process' });
        const entry = stack.get(lt);
        entry.depth      = Math.max(entry.depth,      data.depth);
        entry.value      = data.value;
        entry.iterations = Math.max(entry.iterations, data.iterations);
        entry.stable     = entry.stable || data.stable;
        const allLTs = [...stack.keys()], currentLT = allLTs.length ? Math.max(...allLTs) : 0;
        if (entry.status !== 'success') {
          if (entry.stable && entry.value !== null)      entry.status = 'success';
          else if (!entry.stable && currentLT > lt + 1) entry.status = 'fail';
          else                                           entry.status = 'process';
        }
      }

      const activeLTs = [...stack.keys()].sort((a, b) => b - a).slice(0, 4);
      if (!document.getElementById("feedback-wrap")) {
        const wrap = document.createElement("div"); wrap.id = "feedback-wrap";
        Object.assign(wrap.style, { display: "flex", gap: "0", flexWrap: "wrap" });
        document.body.appendChild(wrap);
      }
      let root = document.getElementById(containerId);
      if (!root) {
        root = document.createElement("div"); root.id = containerId;
        Object.assign(root.style, {
          fontFamily: "ui-monospace,monospace", padding: "20px",
          background: "#0d0d0d", color: "#eee", borderRadius: "10px",
          margin: "10px", flex: "1", minWidth: "280px", border: "1px solid #222",
        });
        document.getElementById("feedback-wrap").appendChild(root);
        root.addEventListener('mousemove', (e) => {
          const rect = root.getBoundingClientRect();
          const roster = _seloInfo(world);
          if (!roster?.myId) return;
          sendCursorMove(world.id, roster.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
        }, { passive: true });
      }

      const MAX_DEPTH = 16;
      const renderFBTrack = (trackLt, isActive) => {
        const entry = stack.get(trackLt);
        const colors = { success: '#238636', process: '#d29922', fail: '#f85149' };
        const col = colors[entry.status] || colors.process;
        if (isActive) {
          const cells = Array.from({ length: MAX_DEPTH }, (_, i) =>
            `<div style="flex:1;height:20px;background:${i < entry.depth ? lineColor : '#161616'};border:1px solid #282828;border-radius:2px;"></div>`
          ).join('');
          return `
            <div style="margin-bottom:14px;padding:12px;border-left:4px solid ${col};background:#111;border-radius:4px;">
              <div style="font-size:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#888">FEEDBACK LT ${trackLt}</span>
                <span style="background:${col}33;color:${col};padding:2px 8px;border-radius:10px;font-weight:bold;border:1px solid ${col}66">${entry.status.toUpperCase()}</span>
              </div>
              <div style="font-size:9px;color:#555;margin-bottom:4px;">DEPTH (max ${MAX_DEPTH})</div>
              <div style="display:flex;gap:2px;margin-bottom:8px;">${cells}</div>
              <div style="display:flex;gap:12px;font-size:9px;color:#555;">
                <span>value: <span style="color:${lineColor}">${entry.value != null ? entry.value.toFixed(4) : '—'}</span></span>
                <span>iters: <span style="color:#666">${entry.iterations}</span></span>
                <span>depth: <span style="color:${lineColor}">${entry.depth}</span></span>
              </div>
            </div>`;
        }
        return `
          <div style="margin-bottom:6px;padding:6px 12px;border-left:4px solid ${col}44;background:#0e0e0e;border-radius:4px;display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#555;font-size:10px;">LT ${trackLt}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="color:#444;font-size:9px;">depth:${entry.depth} · iters:${entry.iterations}</span>
              <span style="background:${col}22;color:${col};padding:1px 7px;border-radius:8px;font-size:9px;font-weight:bold;border:1px solid ${col}44">${entry.status.toUpperCase()}</span>
            </div>
          </div>`;
      };

      const cycleLt = e?.cycleId || 0;
      if (!bisectCurrent || bisectCurrent.lt !== cycleLt) {
        if (bisectCurrent?.pts?.length > 1) {
          bisectTraces.push({ ...bisectCurrent, done: true });
          if (bisectTraces.length > BISECT_HISTORY) bisectTraces.shift();
        }
        const initial = e?.trace?.[0]?.v ?? e?.value ?? 50;
        bisectCurrent = { lt: cycleLt, target: Math.round(initial), pts: [], done: false };
      }
      if (e?.trace?.length) {
        bisectCurrent.pts = e.trace;
        if (data.stable && bisectCurrent.pts.length > 1) bisectCurrent.done = true;
      }
      const drawPts = bisectCurrent.pts.length > 0 ? bisectCurrent : (bisectTraces.length ? bisectTraces[bisectTraces.length - 1] : null);

      const canvasId = containerId + '-canvas';
      const _av$ = root.querySelector('[data-av]'), _avM$ = root._avatarMap;
      root.innerHTML = `
        <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:14px;letter-spacing:1px;text-align:center;">
          PEER ${peerId} · FEEDBACK CONVERGENCE ${_clientBadge(world)}
        </div>
        ${activeLTs.map((l, i) => renderFBTrack(l, i === 0)).join('')}
        <canvas id="${canvasId}" width="260" height="150"
          style="width:100%;border-radius:4px;background:#0a0a0a;display:block;margin-top:10px;"></canvas>
        <div style="font-size:9px;color:#444;margin-top:4px;">
          <span style="color:${lineColor}">▬ trace</span>
          <span style="margin-left:10px;color:#555">╌ target</span>
        </div>`;
      if (_av$) { root.style.position = 'relative'; root.appendChild(_av$); root._avatarMap = _avM$; }
      canvas = document.getElementById(canvasId);

      if (!canvas || !drawPts?.pts?.length) { _renderAvatars(world, root); return; }
      const CW = canvas.width, CH = canvas.height;
      const PAD = { top: 14, right: 42, bottom: 24, left: 36 };
      const cw = CW - PAD.left - PAD.right, ch = CH - PAD.top - PAD.bottom;
      const c2d = canvas.getContext("2d");
      c2d.clearRect(0, 0, CW, CH);

      const allVals = [...drawPts.pts.map(p => p.v), drawPts.target].filter(isFinite);
      if (!allVals.length) return;
      const ySpan = Math.max(Math.abs(Math.max(...allVals) - Math.min(...allVals)), 0.1);
      const yMin = Math.min(...allVals) - ySpan * 0.2, yMax = Math.max(...allVals) + ySpan * 0.2;
      const maxN = Math.max(drawPts.pts[drawPts.pts.length - 1]?.n ?? 0, 5);
      const toX = n => PAD.left + (n / maxN) * cw;
      const toY = v => PAD.top  + (1 - (v - yMin) / (yMax - yMin)) * ch;

      c2d.strokeStyle = "#1a1a1a"; c2d.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const v = yMin + (yMax - yMin) * (i / 4), y = toY(v);
        c2d.beginPath(); c2d.moveTo(PAD.left, y); c2d.lineTo(CW - PAD.right, y); c2d.stroke();
        c2d.fillStyle = "#444"; c2d.font = "8px ui-monospace"; c2d.textAlign = "right";
        c2d.fillText(v.toFixed(1), PAD.left - 3, y + 3);
      }
      const ty = toY(drawPts.target);
      c2d.strokeStyle = "#444"; c2d.setLineDash([3, 3]);
      c2d.beginPath(); c2d.moveTo(PAD.left, ty); c2d.lineTo(CW - PAD.right, ty); c2d.stroke();
      c2d.setLineDash([]);
      c2d.fillStyle = "#555"; c2d.font = "8px ui-monospace"; c2d.textAlign = "left";
      c2d.fillText("" + drawPts.target, CW - PAD.right + 3, ty + 3);

      bisectTraces.forEach((tr, ti) => {
        if (!tr.pts?.length) return;
        const alpha = 0.05 + (ti / Math.max(bisectTraces.length, 1)) * 0.1;
        c2d.strokeStyle = lineColor.replace(')', ',' + alpha + ')').replace('rgb', 'rgba');
        c2d.lineWidth = 1;
        c2d.beginPath();
        tr.pts.forEach((p, i) => i === 0 ? c2d.moveTo(toX(p.n), toY(p.v)) : c2d.lineTo(toX(p.n), toY(p.v)));
        c2d.stroke();
      });
      if (drawPts.pts.length > 1) {
        c2d.strokeStyle = lineColor; c2d.lineWidth = 2;
        c2d.beginPath();
        drawPts.pts.forEach((p, i) => i === 0 ? c2d.moveTo(toX(p.n), toY(p.v)) : c2d.lineTo(toX(p.n), toY(p.v)));
        c2d.stroke();
      }
      c2d.fillStyle = lineColor;
      drawPts.pts.forEach((p, i) => {
        const r = i === drawPts.pts.length - 1 ? 4 : 2;
        c2d.beginPath(); c2d.arc(toX(p.n), toY(p.v), r, 0, Math.PI * 2); c2d.fill();
      });
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Feedback Loop | Fixed-Point Bisection',
  selo:        'feedback',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _fbStepMs: FB_STEP_MS },
  makeScripts: (av) => [feedbackWorldProgram + av],
  makeRenderer: makeFeedbackRenderer,
  wrapId:      'feedback-wrap',
};
