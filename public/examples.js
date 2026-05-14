/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── App registry ──────────────────────────────────────────────────────────────
// Each entry describes one example app.
//
// Fields:
//   title          — display name
//   selo           — WebSocket selo namespace
//   reflectorMs    — shim tick interval
//   metaOptions    — object merged onto meta.ps.app after creation
//   worldId        — world registry key
//   worldProgram   — Renkon program string for the world (appended with AVATAR_WORLD_SCRIPT by selo.html)
//   rendererFactory(core) → (world, peerId, containerId) → () => void
//     core is the imported krestianstvo-wavefront-evaluator module
//
// ── Counter ───────────────────────────────────────────────────────────────────

const REFLECTOR_MS    = 50;
const SUBTICK_MS      = 1;
const SUB_STEPS       = 50;
const STEP_MS         = 1;
const COUNTER_CYCLE_MS = 60;

const counterWorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const counter = Behaviors.collect(
    { count: 0, cycleId: 0, started: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "counter", {
      __macro: (s, p, ctx) => {
        if (s.started) return s;
        ctx.future(0, "newCycle", { cycleId: 1 });
        return { ...s, started: true };
      },
      newCycle: (s, p, ctx) => {
        ctx.send("subcounter", "startSubCount", { cycleId: p.cycleId });
        ctx.future(${COUNTER_CYCLE_MS}, "newCycle", { cycleId: p.cycleId + 1 });
        return { ...s, count: s.count + 1, cycleId: p.cycleId };
      },
    })
  );

  const subcounter = Behaviors.collect(
    { subCount: 0, stepsDone: 0, currentCycle: 0, stepsTarget: ${SUB_STEPS} },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "subcounter", {
      startSubCount: (s, p, ctx) => {
        if (p.cycleId <= s.currentCycle) return s;
        ctx.future(0, "step", p.cycleId);
        return { ...s, subCount: 0, stepsDone: 0, currentCycle: p.cycleId, stepsTarget: ${SUB_STEPS} };
      },
      step: (s, cycleId, ctx) => {
        if (cycleId !== s.currentCycle || s.stepsDone >= ${SUB_STEPS}) return s;
        const next = s.stepsDone + 1;
        if (next < ${SUB_STEPS}) ctx.future(${STEP_MS}, "step", cycleId);
        return { ...s, subCount: s.subCount + 1, stepsDone: next };
      }
    })
  );

  const _isStable = W.stable([counter, subcounter], reflector);
  const _export = W.export(Renkon, { counter, subcounter }, _isStable);
`;

function makeCounterRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove) => {
    const stack = new Map();
    return () => {
      if (!world?.ps?.app) return;
      if (world.ps.app._snapshotApplied) { stack.clear(); world.ps.app._snapshotApplied = false; }

      const s  = world.getNodeState("subcounter");
      const c  = world.getNodeState("counter");
      const lt = s?.currentCycle || world.ps.app.logicalTime || 0;
      const data = {
        lt, sub: s?.subCount ?? 0, stepsDone: s?.stepsDone ?? 0, count: c?.count ?? 0,
        target: s?.stepsTarget ?? SUB_STEPS,
        drainIters: world.ps.app._lastDrainIters ?? 0,
        warpIters:  world.ps.app._lastWarpIters  ?? 0,
      };

      if (data.lt > 0) {
        if (!stack.has(data.lt)) stack.set(data.lt, { sub: 0, stepsDone: 0, drainIters: 0, warpIters: 0, target: data.target, status: 'process' });
        const wave = stack.get(data.lt);
        wave.sub        = Math.max(wave.sub,        data.sub);
        wave.stepsDone  = Math.max(wave.stepsDone,  data.stepsDone);
        wave.drainIters = Math.max(wave.drainIters, data.drainIters);
        wave.warpIters  = Math.max(wave.warpIters,  data.warpIters);
        const allLTs = [...stack.keys()], currentLT = allLTs.length ? Math.max(...allLTs) : 0;
        if (wave.status !== 'success') {
          if (wave.sub >= wave.target)                    wave.status = 'success';
          else if (currentLT > data.lt + 2)              wave.status = 'fail';
          else                                            wave.status = 'process';
        }
      }

      const activeLTs = [...stack.keys()].sort((x, y) => y - x).slice(0, 3);
      if (!document.getElementById("counter-wrap")) {
        const wrap = document.createElement("div");
        wrap.id = "counter-wrap";
        Object.assign(wrap.style, { display: "flex", gap: "0", flexWrap: "wrap" });
        document.body.appendChild(wrap);
      }
      let root = document.getElementById(containerId);
      if (!root) {
        root = document.createElement("div");
        root.id = containerId;
        Object.assign(root.style, {
          fontFamily: "ui-monospace,monospace", padding: "20px",
          background: "#0d0d0d", color: "#eee", borderRadius: "10px",
          margin: "10px", flex: "1", minWidth: "280px", border: "1px solid #222",
        });
        document.getElementById("counter-wrap").appendChild(root);
        root.addEventListener('mousemove', (e) => {
          const rect = root.getBoundingClientRect();
          const roster = _seloInfo(world);
          if (!roster?.myId) return;
          sendCursorMove(world.id, roster.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
        }, { passive: true });
      }

      const renderTrack = (lt, isActive) => {
        const wave = stack.get(lt);
        const colors = { success: '#238636', process: '#d29922', fail: '#f85149' };
        const sc = colors[wave.status] || colors.process;
        if (isActive) {
          const lead = wave.sub, ws = Math.max(0, lead - 9);
          const ci = Array.from({length: 12}, (_, i) => ws + i).filter(i => i <= wave.target);
          const row = (label, cur, isId = false) => `
            <div style="display:flex;gap:3px;margin-bottom:3px;align-items:center;">
              <div style="width:55px;font-size:10px;color:#555;font-weight:bold;">${label}</div>
              ${ci.map(i => {
                const f = i <= cur;
                let bg = "#161616", tc = "#333";
                if (isId) { bg = "#222"; tc = "#666"; } else if (f) { bg = "#ccc"; tc = "#000"; }
                return `<div style="flex:1;height:24px;background:${bg};border:1px solid #282828;display:flex;align-items:center;justify-content:center;font-size:9px;color:${tc};">${(isId || f) ? i : ''}</div>`;
              }).join('')}
            </div>`;
          return `
            <div style="margin-bottom:16px;padding:12px;border-left:4px solid ${sc};background:#111;border-radius:4px;">
              <div style="font-size:10px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#888">WAVEFRONT LT ${lt}</span>
                <span style="background:${sc}33;color:${sc};padding:2px 8px;border-radius:10px;font-weight:bold;border:1px solid ${sc}66;">${wave.status.toUpperCase()}</span>
              </div>
              ${row('ID', wave.target, true)}
              ${row('PEER ' + peerId, wave.sub)}
              <div style="margin-top:8px;display:flex;gap:12px;font-size:9px;color:#444;">
                <span>target: <span style="color:#666">${wave.target}</span></span>
                <span>drain: <span style="color:#666">${wave.drainIters} iters</span></span>
                ${wave.warpIters > 0 ? `<span style="color:#d29922">warp: ${wave.warpIters} iters</span>` : ''}
              </div>
            </div>`;
        }
        return `
          <div style="margin-bottom:8px;padding:8px 12px;border-left:4px solid ${sc}44;background:#0e0e0e;border-radius:4px;display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#555;font-size:10px;">LT ${lt}</span>
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="color:#444;font-size:9px;">drain:${wave.drainIters}i</span>
              <span style="background:${sc}22;color:${sc};padding:1px 7px;border-radius:8px;font-size:9px;font-weight:bold;border:1px solid ${sc}44">${wave.status.toUpperCase()}</span>
            </div>
          </div>`;
      };

      const _av$ = root.querySelector('[data-av]'), _avM$ = root._avatarMap;
      root.innerHTML = `
        <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:16px;letter-spacing:1px;text-align:center;">
          PEER ${peerId} · WAVEFRONT TRACE ${_clientBadge(world)}
        </div>
        ${activeLTs.map((lt, i) => renderTrack(lt, i === 0)).join('')}
      `;
      if (_av$) { root.style.position = 'relative'; root.appendChild(_av$); root._avatarMap = _avM$; }
      _renderAvatars(world, root);
    };
  };
}

// ── Feedback ──────────────────────────────────────────────────────────────────

const FB_STEP_MS  = 1;
const FB_CYCLE_MS = 80;

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

// ── Zeno ──────────────────────────────────────────────────────────────────────

const ZENO_INITIAL_DELAY = 0.5;
const ZENO_MIN_DELAY     = 0.0001;
const ZENO_CYCLE_TICKS   = 60;

const zenoWorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const zeno = Behaviors.collect(
    { n: 0, sum: 0, localLt: 0, cycleId: 0, _localActive: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "zeno", {
      ...W.localReflector("tick", ${ZENO_INITIAL_DELAY}),
      tick: (s, p, ctx) => {
        const delay = p._innerTickDelay ?? ${ZENO_INITIAL_DELAY};
        const newSum = s.sum + delay;
        const nextDelay = delay / 2;
        if (nextDelay > ${ZENO_MIN_DELAY}) {
          ctx.localReflector("tick", nextDelay);
        } else {
          ctx.future(${ZENO_CYCLE_TICKS}, "restart", {});
        }
        return { ...s, localLt: s.localLt + 1, n: s.n + 1, sum: newSum };
      },
      restart: (s, p, ctx) => {
        ctx.localReflector("tick", ${ZENO_INITIAL_DELAY});
        return { ...s, n: 0, sum: 0, cycleId: s.cycleId + 1 };
      },
    })
  );

  const _isStable = W.stable([zeno], reflector);
  const _export   = W.export(Renkon, { zeno }, _isStable);
`;

function makeZenoRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove) => () => {
    if (!world?.ps?.app) return;
    const z = world.getNodeState("zeno");
    if (!z) return;

    if (!document.getElementById("zeno-wrap")) {
      const wrap = document.createElement("div"); wrap.id = "zeno-wrap";
      Object.assign(wrap.style, { display: "flex", gap: "0", flexWrap: "wrap" });
      document.body.appendChild(wrap);
    }
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement("div"); el.id = containerId;
      Object.assign(el.style, {
        fontFamily: "ui-monospace,monospace", padding: "20px",
        background: "#0d0d0d", color: "#eee", borderRadius: "10px",
        margin: "10px", flex: "1", minWidth: "240px", border: "1px solid #222",
      });
      document.getElementById("zeno-wrap").appendChild(el);
      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const roster = _seloInfo(world);
        if (!roster?.myId) return;
        sendCursorMove(world.id, roster.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }, { passive: true });
    }

    const pct = Math.min((z.sum || 0) * 100, 100).toFixed(4);
    const _av$ = el.querySelector('[data-av]'), _avM$ = el._avatarMap;
    el.innerHTML =
      '<div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:14px;letter-spacing:1px;text-align:center;">PEER ' + peerId + ' · ZENO SERIES ' + _clientBadge(world) + '</div>' +
      '<div style="font-size:9px;color:#444;margin-bottom:10px;">future(0.5) → future(0.25) → ... all within one tick</div>' +
      '<div style="font-size:10px;color:#888;margin-bottom:6px;">steps: <span style="color:#7c3aed">' + (z.n || 0) + '</span>  sum: <span style="color:#238636">' + (z.sum || 0).toFixed(6) + '</span></div>' +
      '<div style="background:#161616;border-radius:2px;height:16px;overflow:hidden;">' +
      '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#7c3aed,#238636);border-radius:2px;"></div></div>' +
      '<div style="font-size:9px;color:#444;margin-top:4px;">' + pct + '% of tick</div>';
    if (_av$) { el.style.position = 'relative'; el.appendChild(_av$); el._avatarMap = _avM$; }
    _renderAvatars(world, el);
  };
}

// ── RNG ───────────────────────────────────────────────────────────────────────

const RNG_STEPS       = 20;
const RNG_CYCLE_TICKS = 80;

const SESSION_RNG_SEED = Object.freeze({ s0: 0x12345678, s1: 0x9abcdef0, s2: 0xdeadbeef, s3: 0xcafebabe });

const rngWorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const rngNode = Behaviors.collect(
    { values: [], cycleId: 0, started: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "rngNode", {
      __macro: (s, p, ctx) => {
        if (s.started) return s;
        ctx.future(0, "generate", { cycleId: 1, step: 0, values: [] });
        return { ...s, started: true };
      },
      generate: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId && p.cycleId > 1) return s;
        if (p.step === 0) W.rng.seed(p.cycleId);
        const v = W.rng.next();
        const values = [...(p.values || []), v];
        if (values.length < ${RNG_STEPS}) {
          ctx.future(0, "generate", { cycleId: p.cycleId, step: p.step + 1, values });
        } else {
          ctx.future(${RNG_CYCLE_TICKS}, "generate", { cycleId: p.cycleId + 1, step: 0, values: [] });
        }
        return { ...s, values, cycleId: p.cycleId };
      },
    })
  );

  const _isStable = W.stable([rngNode], reflector);
  const _export   = W.export(Renkon, { rngNode }, _isStable);
`;

function makeRngRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove) => () => {
    if (!world?.ps?.app) return;
    const r = world.getNodeState("rngNode");
    if (!r?.values?.length) return;

    if (!document.getElementById("rng-wrap")) {
      const wrap = document.createElement("div"); wrap.id = "rng-wrap";
      Object.assign(wrap.style, { display: "flex", gap: "0", flexWrap: "wrap" });
      document.body.appendChild(wrap);
    }
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement("div"); el.id = containerId;
      Object.assign(el.style, {
        fontFamily: "ui-monospace,monospace", padding: "20px",
        background: "#0d0d0d", color: "#eee", borderRadius: "10px",
        margin: "10px", flex: "1", minWidth: "240px", border: "1px solid #222",
      });
      document.getElementById("rng-wrap").appendChild(el);
      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const roster = _seloInfo(world);
        if (!roster?.myId) return;
        sendCursorMove(world.id, roster.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }, { passive: true });
    }

    const barRow = (v) => {
      const pct = (v * 100).toFixed(1);
      return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
        '<div style="width:160px;background:#161616;border-radius:2px;height:10px;overflow:hidden;">' +
        '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#7c3aed,#238636);"></div></div>' +
        '<span style="font-size:9px;color:#555;width:50px;">' + v.toFixed(5) + '</span></div>';
    };

    const _av$ = el.querySelector('[data-av]'), _avM$ = el._avatarMap;
    el.innerHTML =
      '<div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:12px;letter-spacing:1px;text-align:center;">PEER ' + peerId + ' · RNG ' + _clientBadge(world) + '</div>' +
      '<div style="font-size:9px;color:#888;margin-bottom:8px;">cycle ' + (r.cycleId || 0) + '</div>' +
      (r.values || []).slice(0, 10).map(barRow).join('');
    if (_av$) { el.style.position = 'relative'; el.appendChild(_av$); el._avatarMap = _avM$; }
    _renderAvatars(world, el);
  };
}

// ── Wave2D ────────────────────────────────────────────────────────────────────

const GRID_W        = 15;
const GRID_H        = 15;
const WAVE_STEP_MS  = 2;
const WAVE_DECAY_MS = 28;

const wave2dWorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const clock = Behaviors.collect(
    {},
    reflector,
    (state, pulse) => {
      let stateWithEvent = state;
      if (pulse?._isEvent && pulse?._eventPayload?.type === "cellClick") {
        const entry = {
          fireAt:  pulse.wallTime,
          msg:     "userWave",
          payload: { ox: pulse._eventPayload.ox, oy: pulse._eventPayload.oy, wt: pulse.wallTime, clientId: pulse._eventPayload.clientId },
        };
        stateWithEvent = { ...state, _queue: [entry, ...(state._queue ?? [])], _nextAt: pulse.wallTime };
      }
      return W.reduce(stateWithEvent, pulse, "clock", {
        __macro: (s, p, ctx) => { if (s._alive) return s; ctx.future(1, "_keepalive", {}); return { ...s, _alive: true }; },
        _keepalive: (s, p, ctx) => { ctx.future(1, "_keepalive", {}); return s; },
        userWave: (s, p, ctx) => {
          for (let i = 0; i < ${GRID_W * GRID_H}; i++)
            ctx.send("cell_" + i, "wave", { ox: p.ox ?? 0, oy: p.oy ?? 0, wt: p.wt, clientId: p.clientId });
          return s;
        },
      });
    }
  );

  const _makeCell = (id) => {
    const cx = id % ${GRID_W}, cy = Math.floor(id / ${GRID_W});
    return (state, pulse) => W.reduce(state, pulse, "cell_" + id, {
      wave: (s, p, ctx) => {
        const dist = Math.sqrt((cx - p.ox) ** 2 + (cy - p.oy) ** 2);
        const contribution = Math.cos(dist * 0.45) * Math.exp(-dist * 0.22) * 0.8;
        ctx.future(Math.max(1, Math.floor(dist * ${WAVE_STEP_MS})), "activate", { contribution, clientId: p.clientId });
        return s;
      },
      activate: (s, p, ctx) => {
        ctx.future(${WAVE_DECAY_MS}, "decay", { contribution: p.contribution });
        return { ...s, amp: (s.amp ?? 0) + p.contribution, active: true, _count: (s._count ?? 0) + 1, clientId: p.clientId ?? s.clientId };
      },
      decay: (s, p, ctx) => {
        const count = Math.max(0, (s._count ?? 0) - 1);
        return { ...s, amp: count > 0 ? (s.amp ?? 0) - p.contribution : 0, active: count > 0, _count: count };
      },
    });
  };
`;

// The cell behaviors are generated programmatically and appended as a second script.
function makeWave2dScripts(avatarScript) {
  const N = GRID_W * GRID_H;
  const cells = Array.from({ length: N }, (_, i) =>
    `const cell_${i} = Behaviors.collect({amp:0,active:false,_count:0,clientId:null}, reflector, _makeCell(${i}));`
  ).join(" ");
  const refs = Array.from({ length: N }, (_, i) => `cell_${i}`).join(", ");
  const cellScript = cells
    + ` const _isStable = W.stable([clock, ${refs}], reflector);`
    + ` const _export = W.export(Renkon, { clock, ${refs} }, _isStable);`;
  return [wave2dWorldProgram, cellScript, avatarScript];
}

function makeWave2dRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars, _clientHue } = core;
  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    let cells = null;
    let _lastClickMs = 0;
    const CELL_PX = 24, GAP_PX = 2;

    const fireCell = (cellId) => {
      const now = Date.now();
      if (now - _lastClickMs < REFLECTOR_MS) return;
      _lastClickMs = now;
      const clientId = _seloInfo(world)?.myId;
      injectEvent?.({ type: "cellClick", ox: cellId % GRID_W, oy: Math.floor(cellId / GRID_W), clientId });
    };

    const buildGrid = (container) => {
      const cellMap = {};
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          const id = y * GRID_W + x;
          const div = document.createElement("div");
          Object.assign(div.style, {
            position: "absolute",
            left: `${x * (CELL_PX + GAP_PX)}px`, top: `${y * (CELL_PX + GAP_PX)}px`,
            width: `${CELL_PX}px`, height: `${CELL_PX}px`,
            borderRadius: "3px", background: "#121212",
            transition: "background 60ms linear, transform 60ms ease-out",
            transform: "scale(0.85)", willChange: "background, transform",
            cursor: "pointer",
          });
          div.onmouseenter = ((cellId) => (e) => { if (e.buttons === 1) fireCell(cellId); })(id);
          container.appendChild(div);
          cellMap[id] = div;
        }
      }

      // Touch: fire whichever cell is under each touch point as the finger moves.
      container.addEventListener('touchstart',  onTouch, { passive: false });
      container.addEventListener('touchmove',   onTouch, { passive: false });

      function onTouch(e) {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        for (const t of e.touches) {
          const lx = t.clientX - rect.left;
          const ly = t.clientY - rect.top;
          const cx = Math.floor(lx / (CELL_PX + GAP_PX));
          const cy = Math.floor(ly / (CELL_PX + GAP_PX));
          if (cx < 0 || cx >= GRID_W || cy < 0 || cy >= GRID_H) continue;
          fireCell(cy * GRID_W + cx);
        }
      }

      return cellMap;
    };

    const updateGrid = () => {
      if (!cells) return;
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          const id = y * GRID_W + x;
          const cell = world.getNodeState("cell_" + id);
          const div = cells[id];
          if (!div || !cell) continue;
          const amp = cell.amp ?? 0;
          if (!cell.active && div._wvActive === false) continue;
          const t = Math.tanh(amp), abs = Math.abs(t);
          const tf = `scale(${(cell.active ? (0.85 + abs * 0.12) : 0.85).toFixed(3)})`;
          if (div._wvTf !== tf) { div.style.transform = tf; div._wvTf = tf; }
          let bg;
          const hue = _clientHue(cell.clientId);
          if (hue !== null && cell.active && t >  0.04) { const v = abs; bg = `hsl(${hue},${Math.floor(20+v*45)}%,${Math.floor(v*45)}%)`; }
          else if (hue !== null && cell.active && t < -0.04) { const v = abs; bg = `hsl(${hue},${Math.floor(20+v*45)}%,${Math.floor(v*22)}%)`; }
          else if (t >  0.04) { const v = abs; bg = `rgb(${Math.floor(v*12)},${Math.floor(v*160)},${Math.floor(v*190)})`; }
          else if (t < -0.04) { const v = abs; bg = `rgb(${Math.floor(v*120)},${Math.floor(v*20)},${Math.floor(v*190)})`; }
          else { bg = "#121212"; }
          if (div._wvBg !== bg) { div.style.background = bg; div._wvBg = bg; }
          div._wvActive = cell.active;
        }
      }
    };

    return () => {
      if (!world?.ps?.app) return;
      const gridPx = GRID_W * (CELL_PX + GAP_PX) - GAP_PX;
      if (!document.getElementById("wave-wrap")) {
        const wrap = document.createElement("div"); wrap.id = "wave-wrap";
        Object.assign(wrap.style, { display: "flex", gap: "0", flexWrap: "wrap" });
        document.body.appendChild(wrap);
      }
      let root = document.getElementById(containerId);
      if (!root) {
        root = document.createElement("div"); root.id = containerId;
        Object.assign(root.style, {
          fontFamily: "ui-monospace,monospace", padding: "20px",
          background: "#0d0d0d", color: "#eee", borderRadius: "10px",
          margin: "10px", border: "1px solid #222",
        });
        root.innerHTML = `
          <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:14px;letter-spacing:1px;text-align:center;">
            PEER ${peerId} · 2D WAVEFRONT ${GRID_W}×${GRID_H} <span id="${containerId}-roster"></span>
          </div>
          <div id="${containerId}-grid" style="position:relative;width:${gridPx}px;height:${gridPx}px;"></div>
          <div style="display:flex;gap:16px;margin-top:12px;font-size:9px;color:#444;">
            <span>LT <span id="${containerId}-lt" style="color:#555">—</span></span>
            <span>stable: <span id="${containerId}-stable" style="color:#555">—</span></span>
            <span>active: <span id="${containerId}-active" style="color:#555">—</span>/100</span>
          </div>`;
        document.getElementById("wave-wrap").appendChild(root);
        cells = buildGrid(document.getElementById(containerId + "-grid"));
        const onCursorMove = (cx, cy) => {
          const rect = root.getBoundingClientRect();
          const roster = _seloInfo(world);
          if (!roster?.myId) return;
          sendCursorMove(world.id, roster.myId, (cx - rect.left) / rect.width, (cy - rect.top) / rect.height);
        };
        root.addEventListener('mousemove', (e) => onCursorMove(e.clientX, e.clientY), { passive: true });
        root.addEventListener('touchmove', (e) => {
          if (e.touches.length > 0) onCursorMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
      }

      updateGrid();
      const lt = world.getNodeState("clock")?.started ? (world.ps.app.logicalTime ?? 0) : 0;
      let activeCells = 0;
      for (let i = 0; i < GRID_W * GRID_H; i++) if (world.getNodeState("cell_" + i)?.active) activeCells++;
      const stable = world.ps.app.isStable ?? false;
      const ltEl = document.getElementById(containerId + "-lt");
      const stEl = document.getElementById(containerId + "-stable");
      const acEl = document.getElementById(containerId + "-active");
      const roEl = document.getElementById(containerId + "-roster");
      if (ltEl) ltEl.textContent = lt;
      if (stEl) { stEl.textContent = stable ? "yes" : "no"; stEl.style.color = stable ? "#238636" : "#d29922"; }
      if (acEl) acEl.textContent = activeCells;
      if (roEl) roEl.innerHTML = _clientBadge(world);
      _renderAvatars(world, root);
    };
  };
}

// ── Fractal Heartbeat ─────────────────────────────────────────────────────────

const FRACTAL_DEPTH      = 5;
const FRACTAL_BASE_DELAY = 0.5;   // sub-tick delay (ms) at first cascade level
const FRACTAL_MIN_DELAY  = 0.0001; // stop cascading below this threshold
const FRACTAL_CYCLE      = 30;    // global ticks between cascade restarts
const FRACTAL_DECAY      = 0.14;  // energy decay per global tick

const fractalHeartbeatWorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const fractal = Behaviors.collect(
    { energy: Array(${FRACTAL_DEPTH}).fill(0), cycleId: 0, totalBeats: 0, _beatDepth: -1, _localActive: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "fractal", {
      __macro: (s, p, ctx) => {
        const energy = (s.energy || []).map(e => Math.max(0, e - ${FRACTAL_DECAY}));
        if (p.logicalTime % ${FRACTAL_CYCLE} === 1) {
          ctx.future(0, "initBeat", { cycleId: p.logicalTime });
          return { ...s, energy, cycleId: p.logicalTime, _localActive: false };
        }
        return { ...s, energy };
      },
      initBeat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const energy = [...(s.energy || Array(${FRACTAL_DEPTH}).fill(0))];
        energy[0] = 1.0;
        ctx.localReflector("beat", ${FRACTAL_BASE_DELAY});
        return { ...s, energy, _beatDepth: 0, totalBeats: s.totalBeats + 1, _localActive: true };
      },
      beat: (s, p, ctx) => {
        const depth = s._beatDepth + 1;
        if (depth >= ${FRACTAL_DEPTH}) return { ...s, _localActive: false };
        const energy = [...(s.energy || Array(${FRACTAL_DEPTH}).fill(0))];
        energy[depth] = 1.0;
        const nextDelay = (p._innerTickDelay ?? ${FRACTAL_BASE_DELAY}) / 2;
        if (depth + 1 < ${FRACTAL_DEPTH} && nextDelay >= ${FRACTAL_MIN_DELAY}) {
          ctx.localReflector("beat", nextDelay);
          return { ...s, energy, _beatDepth: depth, totalBeats: s.totalBeats + 1 };
        }
        // Cascade complete — clear _localActive so next cycle's __macro can restart
        return { ...s, energy, _beatDepth: depth, totalBeats: s.totalBeats + 1, _localActive: false };
      },
    })
  );

  const _isStable = W.stable([fractal], reflector);
  const _export   = W.export(Renkon, { fractal }, _isStable);
`;

function makeFractalHeartbeatRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  const DEPTH_COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626'];
  const MAX_HISTORY  = 140;

  return (world, peerId, containerId, sendCursorMove) => {
    const history = [];

    return () => {
      if (!world?.ps?.app) return;
      const f = world.getNodeState("fractal");
      if (!f) return;

      const energy     = f.energy || [];
      const totalBeats = f.totalBeats || 0;
      const cycleId    = f.cycleId   || 0;
      const drainIters = world.ps.app._lastDrainIters ?? 0;

      history.push(energy.slice());
      if (history.length > MAX_HISTORY) history.shift();

      if (!document.getElementById("fractal-wrap")) {
        const wrap = document.createElement("div"); wrap.id = "fractal-wrap";
        Object.assign(wrap.style, { display: "flex", gap: "0", flexWrap: "wrap" });
        document.body.appendChild(wrap);
      }
      let root = document.getElementById(containerId);
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
      }

      const canvasId  = containerId + '-canvas';
      const cycleMs   = FRACTAL_CYCLE * 50;
      const depthBars = Array.from({ length: FRACTAL_DEPTH }, (_, d) => {
        const e       = Math.min(1, energy[d] ?? 0);
        const col     = DEPTH_COLORS[d] ?? '#888';
        const pct     = (e * 100).toFixed(1);
        const delayLbl = d === 0 ? 'init' : (FRACTAL_BASE_DELAY / Math.pow(2, d - 1)).toFixed(3) + 'ms';
        return `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
            <div style="width:56px;font-size:9px;color:#555;text-align:right;">D${d} · ${delayLbl}</div>
            <div style="flex:1;background:#161616;border-radius:2px;height:14px;overflow:hidden;">
              <div style="width:${pct}%;height:100%;background:${col};border-radius:2px;
                          transition:width 50ms ease-out;box-shadow:0 0 6px ${col}88;"></div>
            </div>
            <div style="width:32px;font-size:9px;color:${col};">${e.toFixed(2)}</div>
          </div>`;
      }).join('');

      const _av$ = root.querySelector('[data-av]'), _avM$ = root._avatarMap;
      root.innerHTML = `
        <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:12px;letter-spacing:1px;text-align:center;">
          PEER ${peerId} · FRACTAL HEARTBEAT ${_clientBadge(world)}
        </div>
        <div style="font-size:9px;color:#444;margin-bottom:10px;text-align:center;">
          cascade every ${FRACTAL_CYCLE} ticks (${cycleMs}ms) · ${FRACTAL_DEPTH} depths · base ${FRACTAL_BASE_DELAY}ms
        </div>
        ${depthBars}
        <canvas id="${canvasId}" width="260" height="96"
          style="width:100%;border-radius:4px;background:#080808;display:block;margin-top:10px;"></canvas>
        <div style="display:flex;gap:14px;margin-top:8px;font-size:9px;color:#444;">
          <span>cycle <span style="color:#555">${cycleId}</span></span>
          <span>beats <span style="color:#555">${totalBeats}</span></span>
          <span>drain <span style="color:#555">${drainIters}i</span></span>
        </div>`;
      if (_av$) { root.style.position = 'relative'; root.appendChild(_av$); root._avatarMap = _avM$; }

      const canvas = document.getElementById(canvasId);
      if (canvas && history.length > 1) {
        const CW = canvas.width, CH = canvas.height;
        const c2d = canvas.getContext("2d");
        c2d.clearRect(0, 0, CW, CH);
        for (let d = FRACTAL_DEPTH - 1; d >= 0; d--) {
          const col = DEPTH_COLORS[d] ?? '#888';
          c2d.strokeStyle = col;
          c2d.lineWidth = 1.5;
          c2d.globalAlpha = 0.55 + d * 0.09;
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
      _renderAvatars(world, root);
    };
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────
// Each app entry defines everything selo.html needs to boot it.
//
// Fields:
//   title           display name shown in <title> and the nav
//   selo            WS selo namespace / worldId
//   reflectorMs     tick interval
//   metaOptions     extra fields set on meta.ps.app (subtickMs, fbStepMs, rngSeed)
//   makeScripts(avatarScript) → string[]   world program(s) passed to makeWorld
//   makeRenderer(core)        → rendererFactory
//   wrapId          DOM id of the flex container that holds both peer panels

export const APPS = {
  wave2d: {
    title:      '2D Wavefront',
    selo:       'wave2d',
    reflectorMs: REFLECTOR_MS,
    metaOptions: {},
    makeScripts: (av) => makeWave2dScripts(av),
    makeRenderer: makeWave2dRenderer,
    wrapId: 'wave-wrap',
  },
  fractal: {
    title:      'Fractal Heartbeat',
    selo:       'fractal',
    reflectorMs: REFLECTOR_MS,
    metaOptions: { _subtickMs: SUBTICK_MS },
    makeScripts: (av) => [fractalHeartbeatWorldProgram + av],
    makeRenderer: makeFractalHeartbeatRenderer,
    wrapId: 'fractal-wrap',
  },
  feedback: {
    title:      'Feedback Loop | Fixed-Point Bisection',
    selo:       'feedback',
    reflectorMs: REFLECTOR_MS,
    metaOptions: { _fbStepMs: FB_STEP_MS },
    makeScripts: (av) => [feedbackWorldProgram + av],
    makeRenderer: makeFeedbackRenderer,
    wrapId: 'feedback-wrap',
  },
  zeno: {
    title:      'Zeno Series | Infinite Future Cascade',
    selo:       'zeno',
    reflectorMs: REFLECTOR_MS,
    metaOptions: { _subtickMs: SUBTICK_MS },
    makeScripts: (av) => [zenoWorldProgram + av],
    makeRenderer: makeZenoRenderer,
    wrapId: 'zeno-wrap',
  },
  counter: {
    title:      'Counter / Subcounter',
    selo:       'counter',
    reflectorMs: REFLECTOR_MS,
    metaOptions: { _subtickMs: SUBTICK_MS },
    makeScripts: (av) => [counterWorldProgram + av],
    makeRenderer: makeCounterRenderer,
    wrapId: 'counter-wrap',
  },
  rng: {
    title:      'Deterministic RNG',
    selo:       'rng',
    reflectorMs: REFLECTOR_MS,
    metaOptions: { _subtickMs: SUBTICK_MS, _rngSeed: SESSION_RNG_SEED },
    makeScripts: (av) => [rngWorldProgram + av],
    makeRenderer: makeRngRenderer,
    wrapId: 'rng-wrap',
  }
};
