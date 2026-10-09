/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors

contract-pipeline — the LIVE demonstration of the core's GEOMETRIC (Banach) scheduling gate.

  The wavefront-evaluator core now schedules on FOUR things: coordinate time (ctx.future), proper
  time (ctx.futureTau), the causal frontier (ctx.futureFrontier), and — new — GEOMETRIC CONVERGENCE
  (ctx.futureContract: fire when this node's state reaches its fixpoint). This app shows what that
  uniquely enables and nothing else in the repo does: a PIPELINE GATED BY CONVERGENCE.

    A ⊸ B ⊸ C   — three Hutchinson contraction nodes, each with a DIFFERENT ρ (→ a different a-priori
                   Banach bound()). A starts at boot. B does NOT start on a clock — it starts the moment
                   A has CONVERGED (A's futureContract fires → A ctx.send's B "go"). C waits on B. So the
                   schedule is driven by GEOMETRY (each stage's attractor), not by wall-time.

  MECHANISM (no new core machinery beyond the gate): each node arms ctx.futureContract(tol) → the core
  fires its "arrived" handler exactly when __residual(state) ≤ tol (certified ≤ bound()). On arrival the
  node ctx.send's the next stage "go", which seeds it and arms ITS gate. Cross-node signalling is the
  core's existing outbox (ctx.send) — the demo needs NO drain-loop restructuring (the unbuilt "2b-iii");
  send + futureContract compose the whole chain. Pure over replicated state → byte-identical per peer.

  WHAT YOU SEE: three residual bars draining to their tol; each stage lights up (▶ running → ✓ converged)
  as its upstream converges; per-stage bound() vs actual arrival step (the certificate); a pipeline hash
  that must match across peers at equal step. The core scheduling on Banach convergence, composed.
*/

const REFLECTOR_MS = 50;
const GRIDR = 12, TOL = 4e-3;
const STAGES = ["A", "B", "C"];
const RHOS = { A: [0.45, 0.6], B: [0.55, 0.7], C: [0.62, 0.78] };   // different ρ per stage → different bound()

const pipelineWorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const GRIDR = ${GRIDR};
  const TOL = ${TOL};

  // ── inline Hutchinson (offset radial maps → non-degenerate ring ladder), pure over plain state ──────
  const _stepW = (rhos, S) => { const D = 1, out = [];
    for (const rho of rhos) { const t = (1 - rho) * GRIDR * 0.7; for (const r of S) out.push(rho * r + t); }
    // dedup on a 1e-3 grid (bounds support; canonical → hashable)
    const seen = new Map(); for (const r of out) { const k = Math.round(r * 1000); if (!seen.has(k)) seen.set(k, r); }
    return [...seen.keys()].sort((a, b) => a - b).map(k => seen.get(k)); };
  const _haus = (P, Q) => { const one = (X, Y) => { let w = 0; for (const x of X) { let best = Infinity; for (const y of Y) { const d = (x - y) * (x - y); if (d < best) best = d; } if (best > w) w = best; } return Math.sqrt(w); };
    if (!P.length || !Q.length) return Infinity; return Math.max(one(P, Q), one(Q, P)); };
  const _residual = (rhos, S) => (S && S.length) ? _haus(S, _stepW(rhos, S)) : Infinity;
  // a-priori Banach bound from rho_max (the certificate): ceil(log(tol*(1-r)/d0)/log r)
  const _bound = (rhos) => { const r = Math.max(...rhos); const S0 = [GRIDR]; const d0 = _haus(S0, _stepW(rhos, S0));
    if (!(d0 > 0) || r <= 0 || r >= 1) return 999; return Math.max(1, Math.ceil(Math.log(TOL * (1 - r) / d0) / Math.log(r))); };
  const _hash = (S) => { let h = 0x811c9dc5; for (const v of S) { const q = Math.round(v * 1e6) | 0;
    for (let b = 0; b < 4; b++) { h ^= (q >> (b * 8)) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } } return (h >>> 0).toString(16).padStart(8, '0'); };

  // A STAGE node: dormant until 'go' (A gets go at boot; B/C when upstream converges). On go: seed + arm
  // futureContract. Each __macro applies one contraction step (once per pulse). On arrival: send next 'go'.
  // A restart verb (UI) is lifted into the reduce via a _verb queue entry (the KWE UI law) and re-boots A.
  const _makeStage = (name, rhos, next) => (s, pulse) => {
    let s0 = s;
    if (name === "A" && pulse?._isEvent && pulse?._eventPayload?.type === "reset")
      s0 = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: "_reset", payload: {} }, ...(s._queue ?? [])], _nextAt: pulse.wallTime };
    return W.reduce(s0, pulse, name, {
      __residual: (st) => _residual(rhos, st.S),                     // the core's geometric gate reads this
      __macro: (st, p, ctx) => {
        if (name === "A" && !st._booted) ctx.send("A", "go");        // A self-starts at boot
        // TIME: every pulse advances gTick (the shared clock) so each stage can record WHEN it ran.
        const gTick = (st.gTick ?? 0) + 1;
        if (!st.running) return { ...st, _booted: true, gTick };
        if (st.arrived) return { ...st, _booted: true, gTick };
        // STAGE-AS-CLOCK: one contraction step; record the residual → the stage's own TEMPO (fast→slow descent).
        const S1 = _stepW(rhos, st.S), residual = _residual(rhos, st.S);
        const cadence = [...(st.cadence ?? []), +residual.toFixed(3)].slice(-48);
        return { ...st, _booted: true, gTick, S: S1, steps: (st.steps ?? 0) + 1, residual, cadence };
      },
      go: (st, p, ctx) => { ctx.futureContract(TOL, "arrived");      // ARM the geometric gate for this stage
        // TIME: stamp startTick = when this stage was woken (by upstream convergence). duration = arrivedTick − startTick.
        return { ...st, running: true, S: [GRIDR], steps: 0, arrived: false, hash: undefined, bound: _bound(rhos),
                 cadence: [], startTick: st.gTick ?? 0 }; },
      arrived: (st, p, ctx) => { if (next) ctx.send(next, "go");      // fires when __residual ≤ TOL → wake the next stage
        return { ...st, arrived: true, arrivedAt: st.steps, arrivedTick: st.gTick ?? 0, hash: _hash(st.S) }; },
      _reset: (st, p, ctx) => { ctx.send("A", "go"); return { running:false, arrived:false, _booted:true, gTick: st.gTick ?? 0 }; },
    });
  };

  const A = Behaviors.collect({ running:false, arrived:false }, reflector, _makeStage("A", ${JSON.stringify(RHOS.A)}, "B"));
  const B = Behaviors.collect({ running:false, arrived:false }, reflector, _makeStage("B", ${JSON.stringify(RHOS.B)}, "C"));
  const C = Behaviors.collect({ running:false, arrived:false }, reflector, _makeStage("C", ${JSON.stringify(RHOS.C)}, null));

  const _isStable = W.stable([A, B, C], reflector);
  const _export   = W.export(Renkon, { A, B, C }, _isStable);
`;

function makeRenderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, _sendCursorMove, injectEvent) => {
    const verb = (type) => injectEvent?.({ type });

    return () => {
      if (!world?.ps?.app) return;
      const A = world.getNodeState("A"), B = world.getNodeState("B"), C = world.getNodeState("C");
      if (!A) return;

      if (!document.getElementById("contract-pipeline-wrap")) {
        const w = document.createElement("div"); w.id = "contract-pipeline-wrap";
        Object.assign(w.style, { display: "flex", gap: "0", flexWrap: "wrap" });
        document.body.appendChild(w);
      }
      let root = document.getElementById(containerId);
      if (!root) {
        root = document.createElement("div"); root.id = containerId;
        Object.assign(root.style, { fontFamily: "ui-monospace,monospace", padding: "18px", background: "#0d0d0d",
          color: "#eee", borderRadius: "10px", margin: "10px", border: "1px solid #222", minWidth: "420px" });
        root.innerHTML = `
          <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:4px;letter-spacing:1px;">
            PEER ${peerId} · CONTRACT PIPELINE · A ⊸ B ⊸ C gated by convergence <span id="${containerId}-roster"></span></div>
          <div id="${containerId}-hud" style="font-size:9px;color:#555;margin-bottom:10px;"></div>
          <div id="${containerId}-stages"></div>
          <div style="font-size:10px;color:#4a7;margin-top:12px;margin-bottom:3px;font-weight:bold;">⊙ TIMELINE — each stage is a clock; downstream starts when upstream's convergence CERTIFIES</div>
          <canvas id="${containerId}-timeline" width="440" height="66" style="background:#070707;border-radius:6px;display:block;"></canvas>
          <div id="${containerId}-timehud" style="font-size:9px;color:#4a7;margin-top:4px;"></div>
          <div style="font-size:9px;color:#666;margin-top:8px;">each stage starts when its UPSTREAM has CONVERGED (geometric scheduling, not a clock) · pHash = cross-peer diff at equal step</div>
          <div style="display:flex;gap:6px;margin-top:12px;">
            <button data-act="reset" style="font-size:11px;padding:5px 12px;background:#161b22;color:#8b949e;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">↺ restart</button>
          </div>`;
        document.getElementById("contract-pipeline-wrap").appendChild(root);
        root.addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b) verb(b.dataset.act); });
      }

      const states = { A, B, C };
      const stageRow = (nm) => { const s = states[nm] || {};
        const res = (s.S && s.S.length) ? _residualView(s.S, nm) : null;
        const status = !s.running ? "waiting" : s.arrived ? "✓ converged" : "▶ running";
        const col = !s.running ? "#555" : s.arrived ? "#3fb950" : "#58a6ff";
        // residual bar: log-scaled fill (residual shrinks from ~O(GRIDR) to TOL)
        const rres = res == null ? 0 : Math.max(0, Math.min(1, 1 - Math.log10(Math.max(res, TOL)) / Math.log10(GRIDR)));
        const bar = `<div style="height:10px;background:#161b22;border-radius:3px;overflow:hidden;flex:1;"><div style="height:100%;width:${(rres*100).toFixed(0)}%;background:${col};"></div></div>`;
        const cert = s.arrived ? `arrived ${s.arrivedAt}/${s.bound} #${(s.hash||"----").slice(0,4)}` : s.running ? `step ${s.steps ?? 0}/${s.bound ?? "?"} · res ${res != null ? res.toExponential(1) : "—"}` : "dormant";
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="width:14px;color:${col};font-weight:bold;">${nm}</span>${bar}
          <span style="width:110px;font-size:9px;color:${col};">${status}</span>
          <span style="width:190px;font-size:8px;color:#666;">${cert}</span></div>`; };

      const lt = world.ps.app.logicalTime ?? 0, stable = world.ps.app.isStable ?? false;
      const pHash = [A, B, C].map(s => s?.hash ?? "--").join("·");
      const set = (suf, html) => { const el = document.getElementById(containerId + suf); if (el) el.innerHTML = html; };
      set("-hud", `LT ${lt} · ${stable ? "stable (pipeline complete)" : "converging…"} · pHash ${pHash}`);
      set("-stages", STAGES.map(stageRow).join(""));

      // ── TIMELINE (the time idea): a Gantt of the cascade — each stage's start→arrival on the shared gTick
      //    axis. Downstream bars begin EXACTLY where upstream bars end (start = upstream's certified arrival).
      //    The running stage's bar fills live; the bar's internal texture = its cadence (residual descent). ──
      const tl = document.getElementById(containerId + "-timeline");
      if (tl) { const g = tl.getContext("2d"), CW = tl.width, CH = tl.height;
        g.clearRect(0, 0, CW, CH);
        const now = Math.max(1, A?.gTick ?? 1);                       // current shared tick (A ticks every pulse)
        const span = Math.max(now, (C?.arrivedTick ?? 0) + 4);        // time axis extent
        const rowH = CH / 3, cols = { A: "#58a6ff", B: "#a371f7", C: "#3fb950" };
        STAGES.forEach((nm, i) => { const s = states[nm] || {}; const y = i * rowH + 3, h = rowH - 6;
          if (!s.running && s.arrivedTick == null) { g.fillStyle = "#222"; g.fillRect(0, y, 12, h); g.fillStyle = "#555"; g.font = "9px monospace"; g.fillText(nm, 2, y + h - 1); return; }
          const t0 = s.startTick ?? 0, t1 = s.arrived ? (s.arrivedTick ?? now) : now;
          const x0 = (t0 / span) * CW, x1 = (t1 / span) * CW;
          // the bar
          g.fillStyle = cols[nm] + (s.arrived ? "cc" : "88"); g.fillRect(x0, y, Math.max(2, x1 - x0), h);
          // cadence texture inside the bar (residual descent — the stage's tempo)
          const cad = s.cadence ?? []; if (cad.length) { const mx = Math.max(TOL, ...cad);
            g.strokeStyle = "#0d0d0d"; g.lineWidth = 1;
            for (let k = 0; k < cad.length; k++) { const cx = x0 + (k / cad.length) * (x1 - x0); const ch = (cad[k] / mx) * h;
              g.beginPath(); g.moveTo(cx, y + h); g.lineTo(cx, y + h - ch); g.stroke(); } }
          g.fillStyle = "#fff"; g.font = "9px monospace"; g.fillText(nm, 2, y + h - 1);
        });
      }
      const dur = (s) => (s?.arrived && s.arrivedTick != null && s.startTick != null) ? (s.arrivedTick - s.startTick) : null;
      set("-timehud", STAGES.map(nm => { const s = states[nm]; const d = dur(s);
        return `${nm}:${s?.arrived ? (s.startTick ?? "?") + "→" + (s.arrivedTick ?? "?") + "(" + (d ?? "?") + "t)" : s?.running ? "run@" + (s.startTick ?? "?") : "wait"}`; }).join(" · ")
        + " · the 1-tick gaps between stages = the certified 'go' MESSAGE propagating (causal send delay)");

      set("-roster", _clientBadge(world));
      _renderAvatars(world, root);
    };
  };

  // renderer-side residual (display only; the world computes the authoritative one)
  function _residualView(S, nm) { const rhos = { A: [0.45,0.6], B:[0.55,0.7], C:[0.62,0.78] }[nm];
    const step = (arr) => { const out=[]; for (const rho of rhos){ const t=(1-rho)*GRIDR*0.7; for (const r of arr) out.push(rho*r+t); }
      const seen=new Map(); for (const r of out){ const k=Math.round(r*1000); if(!seen.has(k))seen.set(k,r);} return [...seen.values()]; };
    const one=(X,Y)=>{let w=0;for(const x of X){let b=Infinity;for(const y of Y){const d=(x-y)*(x-y);if(d<b)b=d;}if(b>w)w=b;}return Math.sqrt(w);};
    const S1=step(S); return Math.max(one(S,S1),one(S1,S)); }
}

export default {
  title:        "Contract Pipeline · convergence-gated A⊸B⊸C",
  selo:         "contract-pipeline",
  reflectorMs:  REFLECTOR_MS,
  metaOptions:  {},
  makeScripts:  (av) => [pipelineWorldProgram + av],
  makeRenderer: makeRenderer,
  wrapId:       "contract-pipeline-wrap",
};
