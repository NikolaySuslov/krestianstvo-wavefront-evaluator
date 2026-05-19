/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
const REFLECTOR_MS     = 50;
const SUBTICK_MS       = 1;
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

export default {
  title:       'Zeno Series | Infinite Future Cascade',
  selo:        'zeno',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [zenoWorldProgram + av],
  makeRenderer: makeZenoRenderer,
  wrapId:      'zeno-wrap',
};
