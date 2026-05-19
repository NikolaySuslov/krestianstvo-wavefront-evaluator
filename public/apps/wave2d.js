/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
const REFLECTOR_MS  = 50;
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

export default {
  title:       '2D Wavefront',
  selo:        'wave2d',
  reflectorMs: REFLECTOR_MS,
  metaOptions: {},
  makeScripts: (av) => makeWave2dScripts(av),
  makeRenderer: makeWave2dRenderer,
  wrapId:      'wave-wrap',
};
