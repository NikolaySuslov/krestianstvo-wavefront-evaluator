/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
const REFLECTOR_MS    = 50;
const SUBTICK_MS      = 1;
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

export default {
  title:       'Deterministic RNG',
  selo:        'rng',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS, _rngSeed: SESSION_RNG_SEED },
  makeScripts: (av) => [rngWorldProgram + av],
  makeRenderer: makeRngRenderer,
  wrapId:      'rng-wrap',
};
