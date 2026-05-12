/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
(https://github.com/NikolaySuslov/krestianstvo-wavefront-evaluator/blob/master/LICENSE.md)
*/
// ═══════════════════════════════════════════════════════════════════════════
// Krestianstvo Wavefront Evaluator — UI Elements
//
// DOM helpers, avatar rendering, cursor tracking, and the connect/disconnect
// control bar. Import these in HTML examples; keep krestianstvo-wavefront-evaluator
// free of any DOM dependencies.
//
// Exports: _seloInfo, _clientBadge, _clientColor, _clientHue,
//          makeSendCursorMove, _renderAvatars, makePeerControl
// ═══════════════════════════════════════════════════════════════════════════

import { makePeer, makeView, _VIEW_PROGRAM } from "./krestianstvo-wavefront-evaluator.js";

// ── Roster helpers ────────────────────────────────────────────────────────────

export const _seloInfo = (world) => world?.ps?.app?.meta?.app?.seloRoster ?? null;

export const _clientBadge = (world) => {
  const r = _seloInfo(world);
  if (!r) return '';
  return `<span style="margin-left:8px;padding:1px 6px;border-radius:8px;` +
         `background:#0d1a2e;color:#4a9eff;font-size:9px;border:1px solid #1e3a5f;">` +
         `${r.count} cli</span>`;
};

// Deterministic hue/color from a client ID string (polynomial rolling hash).
export const _clientColor = (clientId) => {
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) & 0xffff;
  return `hsl(${h % 360},70%,62%)`;
};

export const _clientHue = (clientId) => {
  if (!clientId) return null;
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) & 0xffff;
  return h % 360;
};

// ── Cursor move sender ────────────────────────────────────────────────────────
// Returns a throttled fn(seloId, clientId, x, y) that injects a cursorMove
// event into the matching peer. peerState = { peers: [...] } from the app.
export const makeSendCursorMove = (peerState, reflectorMs) => {
  const _throttle = {};
  return (seloId, clientId, x, y) => {
    const now = Date.now();
    if (now - (_throttle[seloId] ?? 0) < reflectorMs) return;
    _throttle[seloId] = now;
    const peer = peerState.peers?.find(p => p.seloId === seloId);
    peer?.injectExternalEvent({ type: 'cursorMove', clientId, x, y });
  };
};

// ── Avatar overlay renderer ───────────────────────────────────────────────────
// Renders floating cursor dots for all connected clients inside `container`.
// Expects world to have an `avatarNode` behavior (from AVATAR_WORLD_SCRIPT).
export const _renderAvatars = (world, container) => {
  let overlay = container.querySelector('[data-av]');
  if (!overlay) {
    container._avatarMap = {};
    overlay = document.createElement('div');
    overlay.setAttribute('data-av', '1');
    Object.assign(overlay.style, {
      position: 'absolute', inset: '0',
      pointerEvents: 'none', zIndex: '10', overflow: 'hidden',
    });
    container.style.position = 'relative';
    container.appendChild(overlay);
  }
  container._avatarMap ??= {};

  const av = world.getNodeState('avatarNode');
  if (!av?.cursors) return;

  const myId = _seloInfo(world)?.myId;

  for (const id of Object.keys(container._avatarMap)) {
    if (!av.cursors[id]) { container._avatarMap[id]?.remove(); delete container._avatarMap[id]; }
  }

  for (const [clientId, cur] of Object.entries(av.cursors)) {
    let el = container._avatarMap[clientId];
    if (!el) {
      const color = _clientColor(clientId);
      el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute', width: '12px', height: '12px', borderRadius: '50%',
        background: color, border: '2px solid rgba(255,255,255,0.15)',
        boxShadow: `0 0 8px ${color}99`,
        transform: 'translate(-50%,-50%)',
        transition: 'left 80ms linear,top 80ms linear',
        pointerEvents: 'none',
      });
      const lbl = document.createElement('span');
      Object.assign(lbl.style, {
        position: 'absolute', top: '14px', left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '7px', color, whiteSpace: 'nowrap',
        fontFamily: 'ui-monospace,monospace', textShadow: '0 1px 3px #000',
      });
      lbl.textContent = clientId.slice(-6);
      el.appendChild(lbl);
      overlay.appendChild(el);
      container._avatarMap[clientId] = el;
    }
    el.style.left    = `${(cur.x * 100).toFixed(1)}%`;
    el.style.top     = `${(cur.y * 100).toFixed(1)}%`;
    el.style.opacity = clientId === myId ? '0.3' : '0.85';
  }
};

// ── Connect / disconnect control bar ─────────────────────────────────────────
// Renders a button + status line at the top of the page.
// Each entry in metas gets one peer connection (staggered 500ms apart).
// On disconnect, resumes autonomous clocks for all metas.
export const makePeerControl = (metas, seloId, wsUrl, peerState, allMetas, reflectorMs) => {
  const el = document.createElement("div");
  Object.assign(el.style, {
    fontFamily: "ui-monospace,monospace", padding: "12px 20px",
    background: "#0d0d0d", borderRadius: "10px", margin: "10px",
    maxWidth: "680px", border: "1px solid #222",
    display: "flex", alignItems: "center", gap: "16px",
  });

  const btn = document.createElement("button");
  Object.assign(btn.style, {
    padding: "6px 18px", borderRadius: "6px", border: "none",
    fontFamily: "ui-monospace,monospace", fontSize: "11px",
    fontWeight: "bold", cursor: "pointer", letterSpacing: "1px",
    background: "#238636", color: "#fff",
  });

  const status = document.createElement("span");
  Object.assign(status.style, { fontSize: "10px", color: "#888" });

  const update = () => {
    const connected = !!peerState.peers;
    btn.textContent = connected ? "DISCONNECT" : "RECONNECT";
    btn.style.background = connected ? "#f85149" : "#238636";
    if (!connected) {
      status.textContent = "disconnected — running on local autonomous clock";
      status.style.color = "#d29922";
    } else {
      status.textContent = "connected → " + wsUrl + "  (selo: " + seloId + ")";
      status.style.color = "#238636";
    }
  };

  const connect = () => {
    if (peerState.peers) return;
    peerState.peers = [];
    metas.forEach((meta) => {
      const p = makePeer(meta, wsUrl, seloId);
      peerState.peers.push(p);
      meta.stopAutonomous();
    });
    update();
  };

  const disconnect = () => {
    if (!peerState.peers) return;
    peerState.peers.forEach(p => p.disconnect());
    peerState.peers = null;
    allMetas.forEach(m => m.startAutonomous());
    update();
  };

  btn.onclick = () => { if (peerState.peers) disconnect(); else connect(); };
  update();
  el.appendChild(btn);
  el.appendChild(status);
  document.body.insertBefore(el, document.body.firstChild);
  connect();
  return { el, getPeerA: () => peerState.peers?.[0] ?? null };
};

// ── Avatar world script ───────────────────────────────────────────────────────
// Append to any world's program scripts so avatarNode tracks cursor positions.
export const AVATAR_WORLD_SCRIPT = `
  const avatarNode = Behaviors.collect(
    { cursors: {} },
    reflector,
    (state, pulse) => {
      if (pulse?._restoreState !== undefined) return { cursors: {} };
      let s = state;
      if (pulse?._isEvent && pulse._eventPayload?.type === 'cursorMove') {
        const { clientId, x, y } = pulse._eventPayload;
        const cursors = { ...s.cursors, [clientId]: { x, y, at: pulse.logicalTime } };
        for (const id of Object.keys(cursors)) {
          if (pulse.logicalTime - cursors[id].at > 200) delete cursors[id];
        }
        s = { ...s, cursors };
      }
      return W.reduce(s, pulse, "avatarNode", {
        __macro: (s, p, ctx) => {
          if (s._alive) return s;
          return { ...s, _alive: true };
        },
      });
    }
  );
  const _isStableAll = _isStable && W.stable([avatarNode], reflector);
  const _avatarExport = W.export(Renkon, { avatarNode }, _isStableAll);
`;

// ── _wireApp ──────────────────────────────────────────────────────────────────
// Creates two renderer instances + two Renkon views, wires them.
// sendCursorMove and injectEvent are forwarded to the renderer factory.
export const _wireApp = (factory, wA, wB, name, sendCursorMove, injectEvent) => {
  const rA = factory(wA, 'A', name + '-a', sendCursorMove, injectEvent);
  const rB = factory(wB, 'B', name + '-b', sendCursorMove, injectEvent);
  const vA = makeView(name + 'ViewA', _VIEW_PROGRAM, { renderFn: rA });
  const vB = makeView(name + 'ViewB', _VIEW_PROGRAM, { renderFn: rB });
  wA.ps.app._viewPs = vA.ps;
  wB.ps.app._viewPs = vB.ps;
};
