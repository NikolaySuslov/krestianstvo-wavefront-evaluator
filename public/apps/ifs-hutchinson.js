/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors

ifs-hutchinson — THE REFERENCE CONSUMER of the ifs-core.js Hutchinson kernel.

  ifsclock.js (a medium-iteration app) realizes its ring genome the CHAOS-GAME way
  (one ring per firing, in order, with kdecay fade — see medium-core makeIFSClock).
  This app is the OTHER realization of the same object: the SETWISE Hutchinson
  operator W(S)=⋃ᵢ wᵢ(S) run to its Banach fixed point A=W(A), driven straight from
  the kernel re-exported by the wavefront evaluator (makeHutchinson). The radial maps
  are affine contractions WITH OFFSET, r→ρᵢ·r+cᵢ (pure r→ρr collapses to {0}); the
  offset fixes each map at an anchor so the attractor is a self-similar Cantor-like
  ring LADDER. It exists to give ifs-core.js one clean live consumer without
  perturbing the working app, and to SHOW the three kernel guarantees on screen: the
  a-priori bound() (no magic iteration guard), order-independent W (no chaos-game
  firing-order join fork), and the cross-peer hash() proving the ring set
  byte-identical at equal shared step.

  WHY THE GENOME LIVES IN WORLD STATE (not a live kernel object): the maps (the ρ
  set) are the REPLICATED genome; the attractor is DERIVED from them by pure setwise
  iteration. So the world reduction holds only { rhos, tol, iters } + a beat counter,
  and BOTH the world (for its hash) and the renderer reconstruct the set by running
  `iters` W-steps deterministically. Same maps + iters on every peer ⇒ same set ⇒
  byte-identical — the ifs-core hash contract. A 'grow' verb dials ρ (clamped
  <1: the contraction invariant can't be broken by a UI event); the attractor tracks.

  This is the BANACH set-attractor face of IFS. The causal delay-cascade face stays
  makeIfsClock — its fixpoint is the empty `future` queue reached by an ORDERED firing
  trajectory (no nonempty fixed set for W, order IS the clock). The two are separate
  kernel citizens on purpose; see ifs-core.js header.

  GEOMETRIC SCHEDULING AS A CLOCK SOURCE (the 'clock' node): the convergence ITSELF is
  a clock. A streaming contraction node (makeStreamingContractionNode) runs the SAME W
  toward the attractor, emitting a BEAT PER STEP — but the beats are NOT evenly spaced:
  the tick cadence is the geometric DESCENT (the Hausdorff step-delta shrinks by ~ρ each
  step), so beats come fast early, slowing as it nears the fixpoint. When it CONVERGES,
  ctx.futureContract fires a CERTIFIED 'cycle' tick (arrived ≤ bound()) and RE-SEEDS the
  next descent. So the clock's tempo is Banach convergence, its cycle boundary is a
  certified event — a fractal-like clock whose rhythm is geometry, not a fixed interval.
  This shows the correction from the thread: the intermediate iterates ARE emitted (the
  beat stream), AND the endpoint is certified — stream + certificate, together, live.
*/

import { makeHutchinson, seedRing } from "../krestianstvo-wavefront-evaluator.js";   // re-exported beside makeTauKernel

const REFLECTOR_MS = 50;
const R0        = 12;                                  // the ρ⁰ ring radius (GRID/2, ifsclock's convention)
const DEDUP_EPS = 5e-2;                                // ring resolution grid. tol is SET EQUAL to this: a
//   gridded set cannot converge BELOW its own resolution (each dedup jitters points by up to dedupEps), so
//   asking bound() for tol < dedupEps never certifies — the same floor law as ifs-core's f32/GPU note.
const DEFAULT_RHOS = [0.4142135623, 0.6180339887, 0.7320508075];   // ifsclock's mutually-incommensurable ρ's

// The radial maps are CONTRACTIONS WITH OFFSET: r → ρᵢ·r + cᵢ (D=1 affine, A=[ρᵢ], t=[cᵢ]). Pure r→ρr would
// collapse the whole ring set to {0} (a degenerate single-point attractor); the offset cᵢ = (1−ρᵢ)·anchorᵢ
// FIXES each map at anchorᵢ instead, so the attractor is a self-similar Cantor-like ring LADDER spread across
// the radius line — the honest non-trivial IFS attractor (and the same reason ifsclock's lensC1 chain uses
// translation/child branches, not bare gain). anchors span the visible ring band.
const ringMaps = (rhos) => rhos.map((rho, i) => { const anchor = R0 * (0.35 + 0.55 * (i / Math.max(1, rhos.length - 1)));
  return { A: [rho], t: [(1 - rho) * anchor], rho }; });

// Reconstruct the ring set from the REPLICATED genome by running EXACTLY `iters` setwise-W steps from the
// seed. Pure (same rhos + iters → same set on every peer), so the world hash and the renderer agree by
// construction. `iters` grows one per beat until it reaches bound() — the ring set visibly CONVERGES to the
// Banach attractor, which is the whole point to watch. Returns { A, iters, bound, certified, hash }.
const ringSet = (rhos, tol, iters) => {
  const H = makeHutchinson({ dim: 1, dedupEps: DEDUP_EPS, maps: ringMaps(rhos) });
  const S0 = seedRing(R0);
  const bound = H.bound(S0, tol);
  const n = Math.max(0, Math.min(iters, Number.isFinite(bound) ? bound : iters));
  let S = S0; for (let i = 0; i < n; i++) S = H.step(S);
  const converged = Number.isFinite(bound) && n >= bound;
  return { A: S, iters: n, bound, certified: converged, hash: H.hashSet(S) };
};

// ── WORLD PROGRAM ─────────────────────────────────────────────────────────────────────────────────
//  State = the GENOME (rhos) + tol + an ITERATION counter that advances one setwise-W step per beat until
//  it reaches bound() (the a-priori Banach certificate). The attractor is a pure function of (rhos, iters),
//  recomputed on read; the world hash tracks it. Self-drives via _keepalive (a future(1) heartbeat armed on
//  the first macro pulse), so the shim's reflector pulses keep beats flowing. UI verbs (start/stop/grow/…)
//  arrive as _eventPayload.type and are lifted into the reduce through a _verb queue entry (the KWE UI law).
const hutchinsonWorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const hutch = Behaviors.collect(
    { rhos: ${JSON.stringify(DEFAULT_RHOS)}, tol: ${DEDUP_EPS}, iters: 0, beats: 0, running: true, _armed: false },
    reflector,
    (state, pulse) => {
      let s0 = state;
      if (pulse?._isEvent && pulse?._eventPayload?.type) {   // lift a UI event into the reduce as a _verb
        const entry = { fireAt: pulse.wallTime, msg: "_verb", payload: pulse._eventPayload };
        s0 = { ...state, _queue: [entry, ...(state._queue ?? [])], _nextAt: pulse.wallTime };
      }
      return W.reduce(s0, pulse, "hutch", {
        __macro: (s, p, ctx) => {
          if (!s._armed) ctx.future(1, "_beat", {});        // arm the self-driving heartbeat once
          return { ...s, _armed: true };
        },
        // ONE setwise-W step per beat while running, until iters reaches the bound (then hold). The renderer
        // recomputes the ring set from (rhos, iters) — this reduce only advances the replicated counter.
        _beat: (s, p, ctx) => { ctx.future(1, "_beat", {});
          const it = (s.running) ? (s.iters ?? 0) + 1 : (s.iters ?? 0);
          return { ...s, iters: it, beats: (s.beats ?? 0) + 1 }; },
        _verb: (s, p) => {
          if (p.type === "start") return { ...s, running: true };
          if (p.type === "stop")  return { ...s, running: false };
          // GROW/SHRINK dial every ρ (clamped inside the Banach edge) and RESTART the convergence (iters→0)
          // so the new attractor grows in visibly. The kernel's setRho also clamps; we keep the replicated
          // value honest here so the world hash and the renderer's makeHutchinson see identical rhos.
          if (p.type === "grow")   return { ...s, rhos: (s.rhos ?? []).map((r) => Math.min(0.95, r + 0.03)), iters: 0 };
          if (p.type === "shrink") return { ...s, rhos: (s.rhos ?? []).map((r) => Math.max(0.10, r - 0.03)), iters: 0 };
          if (p.type === "reseed") return { ...s, rhos: ${JSON.stringify(DEFAULT_RHOS)}, iters: 0, beats: 0 };
          return s;
        },
      });
    }
  );

  // ── GEOMETRIC-SCHEDULING CLOCK (the streaming contraction node, inline) ─────────────────────────────
  // The convergence IS the clock. Each step: apply one W-step, compute the Hausdorff step-delta (residual),
  // EMIT a beat tagged with that residual — the beats are NOT evenly spaced, their cadence is the geometric
  // descent (residual shrinks ~ρ/step). When residual ≤ tol, ctx.futureContract fires a CERTIFIED 'cycle'
  // tick (arrived ≤ bound()) and RE-SEEDS the next descent. Tempo = Banach convergence; cycle = certified.
  // Inline pure over plain state (constants literal) → snapshot/join-safe. Mirrors makeStreamingContractionNode.
  const _R0 = ${R0};
  const _EPS = ${DEDUP_EPS};
  const _stepW = (rhos, S) => { const out = [];
    for (let i = 0; i < rhos.length; i++) { const rho = rhos[i], anchor = _R0 * (0.35 + 0.55 * (i / Math.max(1, rhos.length - 1))), t = (1 - rho) * anchor;
      for (const r of S) out.push(rho * r + t); }
    const seen = new Map(); for (const r of out) { const k = Math.round(r / _EPS); if (!seen.has(k)) seen.set(k, r); }
    return [...seen.keys()].sort((a, b) => a - b).map(k => seen.get(k)); };
  const _haus = (P, Q) => { const one = (X, Y) => { let w = 0; for (const x of X) { let b = Infinity; for (const y of Y) { const d = (x - y) * (x - y); if (d < b) b = d; } if (b > w) w = b; } return Math.sqrt(w); };
    return (!P.length || !Q.length) ? Infinity : Math.max(one(P, Q), one(Q, P)); };

  const _CLOCK_RHOS = ${JSON.stringify(DEFAULT_RHOS)};   // the clock's fixed genome (the demo shows geometric-scheduling-as-clock; hutch already shows genome tracking)
  const clock = Behaviors.collect(
    { _armed: false, S: null, residual: 1, tick: 0, cycle: 0, cadence: [], lastArrivedAt: -1 },
    reflector,
    (s, pulse) => W.reduce(s, pulse, "clock", {
      // the geometric gate reads this — the clock ticks toward its fixpoint, and futureContract fires at ≤ tol
      __residual: (st) => (st.S && st.S.length) ? _haus(st.S, _stepW(_CLOCK_RHOS, st.S)) : Infinity,
      __macro: (st, p, ctx) => {
        if (!st._armed) { ctx.future(1, "_step", {}); ctx.futureContract(_EPS, "cycleTick"); return { ...st, _armed: true, S: [_R0], residual: 1, cadence: [] }; }
        return st;
      },
      _step: (st, p, ctx) => { ctx.future(1, "_step", {});
        if (!st.S) return st;
        const S1 = _stepW(_CLOCK_RHOS, st.S);
        const residual = _haus(st.S, S1);
        // EMIT a beat: tag its residual → the renderer plots the (uneven) cadence = the geometric descent
        const cadence = [...(st.cadence ?? []), +residual.toFixed(4)].slice(-64);
        return { ...st, S: S1, residual, tick: (st.tick ?? 0) + 1, cadence };
      },
      // CERTIFIED cycle boundary: fires when residual ≤ tol (arrived ≤ bound), re-seeds the next descent + re-arms
      cycleTick: (st, p, ctx) => { ctx.futureContract(_EPS, "cycleTick");
        return { ...st, cycle: (st.cycle ?? 0) + 1, lastArrivedAt: st.tick, S: [_R0], residual: 1 }; },   // re-seed → next geometric cycle
    })
  );

  const _isStable = W.stable([hutch, clock], reflector);
  const _export   = W.export(Renkon, { hutch, clock }, _isStable);
`;

function makeHutchinsonRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, _sendCursorMove, injectEvent) => {
    const verb = (type) => injectEvent?.({ type });

    return () => {
      if (!world?.ps?.app) return;
      const st = world.getNodeState("hutch");
      if (!st) return;

      if (!document.getElementById("ifs-hutchinson-wrap")) {
        const w = document.createElement("div"); w.id = "ifs-hutchinson-wrap";
        Object.assign(w.style, { display: "flex", gap: "0", flexWrap: "wrap" });
        document.body.appendChild(w);
      }
      let root = document.getElementById(containerId);
      if (!root) {
        root = document.createElement("div"); root.id = containerId;
        Object.assign(root.style, { fontFamily: "ui-monospace,monospace", padding: "18px", background: "#0d0d0d",
          color: "#eee", borderRadius: "10px", margin: "10px", border: "1px solid #222", minWidth: "360px" });
        root.innerHTML = `
          <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:4px;letter-spacing:1px;">
            PEER ${peerId} · IFS HUTCHINSON · setwise W attractor <span id="${containerId}-roster"></span></div>
          <div id="${containerId}-hud" style="font-size:9px;color:#555;margin-bottom:8px;"></div>
          <canvas id="${containerId}-rings" width="320" height="320" style="background:#070707;border-radius:8px;display:block;"></canvas>
          <div id="${containerId}-cert" style="font-size:9px;color:#666;margin-top:8px;"></div>
          <div style="font-size:10px;color:#4a7;margin-top:12px;margin-bottom:3px;font-weight:bold;">⊙ GEOMETRIC CLOCK — convergence IS the tempo</div>
          <canvas id="${containerId}-clock" width="320" height="60" style="background:#070707;border-radius:6px;display:block;"></canvas>
          <div id="${containerId}-clockhud" style="font-size:9px;color:#4a7;margin-top:4px;"></div>
          <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
            <button data-act="start"  style="font-size:11px;padding:5px 12px;background:#161b22;color:#238636;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">▶ run</button>
            <button data-act="stop"   style="font-size:11px;padding:5px 12px;background:#161b22;color:#d29922;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">■ stop</button>
            <button data-act="grow"   style="font-size:11px;padding:5px 12px;background:#161b22;color:#58a6ff;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">ρ+ grow</button>
            <button data-act="shrink" style="font-size:11px;padding:5px 12px;background:#161b22;color:#8b949e;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">ρ− shrink</button>
            <button data-act="reseed" style="font-size:11px;padding:5px 12px;background:#161b22;color:#8b949e;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">↺ reseed</button>
          </div>`;
        document.getElementById("ifs-hutchinson-wrap").appendChild(root);
        root.addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (!b) return;
          verb(b.dataset.act); });   // data-act is start|stop|grow|shrink|reseed → the _verb type
      }

      // Reconstruct the ring set from the REPLICATED (genome, iters) — pure, so identical on every peer. As
      // iters climbs toward bound() each beat, the set visibly converges to the Banach attractor.
      const { A, iters, bound, certified, hash } = ringSet(st.rhos ?? [], st.tol ?? DEDUP_EPS, st.iters ?? 0);
      const lt = world.ps.app.logicalTime ?? 0, stable = world.ps.app.isStable ?? false;

      // THE CIRCLES FOLLOW THE CLOCK: draw the rings from the clock's LIVE iterate S, which REGROWS each descent
      // and SNAPS BACK on every certified cycle — so the circle animation IS the clock beating (fast growth
      // early, slowing as it converges, reset at the cycle boundary). Falls back to the held attractor A when
      // the clock hasn't started. The clock's S is a pure fn of replicated state → identical on every peer.
      const _clk0 = world.getNodeState("clock");
      const drawRings = (_clk0?.S && _clk0.S.length) ? _clk0.S : A;

      const set = (suf, html) => { const el = document.getElementById(containerId + suf); if (el) el.innerHTML = html; };
      set("-hud", `beats ${st.beats ?? 0} · LT ${lt} · ${st.running ? "running" : "paused"} · rings ${A.length} · ρ[${(st.rhos ?? []).map((r) => r.toFixed(3)).join(",")}] · gW ${hash}`);
      set("-cert", `iter ${iters}/${Number.isFinite(bound) ? bound : "∞"} (setwise W, a-priori ρ<1 bound) · ${certified ? "CONVERGED ✓" : "converging…"} · order-independent W ⇒ same gW on every peer at equal step`);

      // Draw the ring set: concentric circles at each radius. drawRings = the clock's LIVE iterate → the
      // circles GROW with the descent and RESET each certified cycle (the clock beating, made visible).
      const cv = document.getElementById(containerId + "-rings");
      if (cv) { const g = cv.getContext("2d"); const CW = cv.width, CH = cv.height, cx = CW / 2, cy = CH / 2, RMAX = CW / 2 - 8;
        g.clearRect(0, 0, CW, CH);
        // pulse the center dot brighter right after a cycle reset (few ticks in) — a visual downbeat
        const justReset = _clk0 && (_clk0.tick ?? 0) - (_clk0.lastArrivedAt ?? -99) <= 2;
        for (let i = 0; i < drawRings.length; i++) { const rad = (drawRings[i] / R0) * RMAX; if (rad < 1 || rad > RMAX) continue;
          const t = 1 - drawRings[i] / R0;                                // deeper (smaller) rings = warmer
          g.strokeStyle = `hsl(${(200 + t * 140) % 360},70%,${(38 + t * 24).toFixed(0)}%)`;
          g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, rad, 0, 2 * Math.PI); g.stroke(); }
        g.fillStyle = justReset ? "#3fb950" : "#444"; g.beginPath(); g.arc(cx, cy, justReset ? 4 : 2, 0, 2 * Math.PI); g.fill();
      }

      // ── GEOMETRIC CLOCK: draw the cadence — bar heights = residual per step (the geometric descent). The
      //    beats come FAST then slow as the residual shrinks toward tol; each CYCLE (certified arrival) resets
      //    the descent. So the rhythm you see IS the Banach convergence, and cycle boundaries are certified. ──
      const clk = world.getNodeState("clock");
      const cc = document.getElementById(containerId + "-clock");
      if (cc && clk) { const g = cc.getContext("2d"), CW = cc.width, CH = cc.height;
        g.clearRect(0, 0, CW, CH);
        const cad = clk.cadence ?? []; const n = cad.length;
        const maxR = Math.max(DEDUP_EPS, ...cad);
        for (let i = 0; i < n; i++) { const x = (i / 64) * CW; const bw = Math.max(2, CW / 64 - 1);
          const h = Math.max(1, (cad[i] / maxR) * (CH - 4));
          // warm→cool as residual shrinks: a beat near tol (converged) is cool/green, a big early step is warm
          const t = 1 - cad[i] / maxR;
          g.fillStyle = `hsl(${(20 + t * 130).toFixed(0)},70%,55%)`;
          g.fillRect(x, CH - h, bw, h); }
        // tol line (the convergence floor the cycle fires at)
        g.strokeStyle = "#3fb95055"; g.lineWidth = 1; const ty = CH - Math.max(1, (DEDUP_EPS / maxR) * (CH - 4));
        g.beginPath(); g.moveTo(0, ty); g.lineTo(CW, ty); g.stroke();
      }
      if (clk) set("-clockhud", `tick ${clk.tick ?? 0} · residual ${(clk.residual ?? 1).toExponential(1)} · CYCLES ${clk.cycle ?? 0} (each = a CERTIFIED futureContract arrival ≤ bound) · tempo = geometric descent`);

      set("-roster", _clientBadge(world));
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:        "IFS Hutchinson · setwise W attractor",
  selo:         "ifs-hutchinson",
  reflectorMs:  REFLECTOR_MS,
  metaOptions:  {},
  makeScripts:  (av) => [hutchinsonWorldProgram + av],
  makeRenderer: makeHutchinsonRenderer,
  wrapId:       "ifs-hutchinson-wrap",
};
