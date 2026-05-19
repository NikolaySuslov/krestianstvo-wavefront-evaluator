/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
const REFLECTOR_MS         = 50;
const SUBTICK_MS           = 1;
const FRACTAL_DEPTH_0      = 5;
const FRACTAL_BASE_DELAY_0 = 0.5;
const FRACTAL_MIN_DELAY_0  = 0.0001;
const FRACTAL_CYCLE_0      = 30;
const FRACTAL_DECAY_0      = 0.14;

const fractalHeartbeatWorldProgram0 = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const fractal = Behaviors.collect(
    { energy: Array(${FRACTAL_DEPTH_0}).fill(0), cycleId: 0, totalBeats: 0, _beatDepth: -1, _localActive: false },
    reflector,
    (state, pulse) => W.reduce(state, pulse, "fractal", {
      __macro: (s, p, ctx) => {
        const energy = (s.energy || []).map(e => Math.max(0, e - ${FRACTAL_DECAY_0}));
        if (p.logicalTime % ${FRACTAL_CYCLE_0} === 1) {
          ctx.future(0, "initBeat", { cycleId: p.logicalTime });
          return { ...s, energy, cycleId: p.logicalTime, _localActive: false };
        }
        return { ...s, energy };
      },
      initBeat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const energy = [...(s.energy || Array(${FRACTAL_DEPTH_0}).fill(0))];
        energy[0] = 1.0;
        ctx.localReflector("beat", ${FRACTAL_BASE_DELAY_0});
        return { ...s, energy, _beatDepth: 0, totalBeats: s.totalBeats + 1, _localActive: true };
      },
      beat: (s, p, ctx) => {
        const depth = s._beatDepth + 1;
        if (depth >= ${FRACTAL_DEPTH_0}) return { ...s, _localActive: false };
        const energy = [...(s.energy || Array(${FRACTAL_DEPTH_0}).fill(0))];
        energy[depth] = 1.0;
        const nextDelay = (p._innerTickDelay ?? ${FRACTAL_BASE_DELAY_0}) / 2;
        if (depth + 1 < ${FRACTAL_DEPTH_0} && nextDelay >= ${FRACTAL_MIN_DELAY_0}) {
          ctx.localReflector("beat", nextDelay);
          return { ...s, energy, _beatDepth: depth, totalBeats: s.totalBeats + 1 };
        }
        return { ...s, energy, _beatDepth: depth, totalBeats: s.totalBeats + 1, _localActive: false };
      },
    })
  );

  const _isStable = W.stable([fractal], reflector);
  const _export   = W.export(Renkon, { fractal }, _isStable);
`;

function makeFractalHeartbeatRenderer0(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  const DEPTH_COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626'];
  const MAX_HISTORY  = 140;

  return (world, peerId, containerId, sendCursorMove) => {
    const history  = [];
    let _historyLt = -1;

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
        history.push(energy.slice());
        if (history.length > MAX_HISTORY) history.shift();
      }

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
      const cycleMs   = FRACTAL_CYCLE_0 * 50;
      const depthBars = Array.from({ length: FRACTAL_DEPTH_0 }, (_, d) => {
        const e       = Math.min(1, energy[d] ?? 0);
        const col     = DEPTH_COLORS[d] ?? '#888';
        const pct     = (e * 100).toFixed(1);
        const delayLbl = d === 0 ? 'init' : (FRACTAL_BASE_DELAY_0 / Math.pow(2, d - 1)).toFixed(3) + 'ms';
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
          cascade every ${FRACTAL_CYCLE_0} ticks (${cycleMs}ms) · ${FRACTAL_DEPTH_0} depths · base ${FRACTAL_BASE_DELAY_0}ms
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
        for (let d = FRACTAL_DEPTH_0 - 1; d >= 0; d--) {
          const col = DEPTH_COLORS[d] ?? '#888';
          c2d.strokeStyle = col;
          c2d.lineWidth = 1.5;
          c2d.globalAlpha = 0.55 + d * 0.09;
          c2d.beginPath();
          history.forEach((snap, i) => {
            const x = (i / (MAX_HISTORY - 1)) * CW;
            const e = Math.min(1, snap[d] ?? 0);
            const baseline = CH - 2 - d * (CH / FRACTAL_DEPTH_0);
            const y = baseline - e * (CH / FRACTAL_DEPTH_0 - 4);
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

export default {
  title:       'Local Reflector',
  selo:        'fractal0',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [fractalHeartbeatWorldProgram0 + av],
  makeRenderer: makeFractalHeartbeatRenderer0,
  wrapId:      'fractal-wrap',
};
