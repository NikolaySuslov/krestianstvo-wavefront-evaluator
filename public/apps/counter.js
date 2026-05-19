/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
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

export default {
  title:       'Counter / Subcounter',
  selo:        'counter',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [counterWorldProgram + av],
  makeRenderer: makeCounterRenderer,
  wrapId:      'counter-wrap',
};
