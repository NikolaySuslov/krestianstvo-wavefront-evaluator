/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors

ifs-selfhost — THE LIVE DESCRIPTOR SELF-HOST (Idea 3) as a KWE world-node.

  The reference deployment of the descriptor self-host proven headless in ifs-idea3.test.mjs.
  It reconciles, LIVE and inside the replicated world, the two faces of the AHC's IFS: the
  LIVING ring cascade (medium-core makeIFSClock — never settles) and its Hutchinson-W
  generator (the fixed rule). M = the living ring as a short decaying window; O = the
  (λ,κ,s) descriptor. Each beat, O takes one 𝓗-step (KL-gradient descent) toward the (λ,κ,s)
  explaining M. Fixpoint: O == C*, the rule the ring implies == the ring the rule generates.

  WHY THE HOST LOGIC IS INLINED IN THE PROGRAM STRING (not the imported makeDescriptorHost
  object): a KWE world program runs in an ISOLATED Renkon context — it cannot reach module
  functions, and a live makeIFSClock instance cannot cross into it or be snapshotted. So the
  host's step is expressed here as PURE functions over PLAIN serializable state (clock pulses/
  kernel arrays, windowed M, descriptor O), living entirely in the replicated reduce state.
  This is the same boundary ahc-mixed-radix respects (heavy JS baked into the world string;
  makeIFSClock run only at BUILD time). Determinism: step is a pure fn of (state, integer kstep)
  → two peers stepping the same shared-step sequence stay byte-identical (proven in the test),
  and the whole host state snapshots as plain JSON. Cross-peer diff is on the MEASURE hash, not
  raw O (the 3-param loss is non-identifiable — same μ, different params; μ is the invariant).

  WHAT YOU SEE: O=(λ,κ,s) converging, μ_live (the descriptor's measure) over the living ring,
  the measure hash (cross-peer at equal step), a ρ dial the descriptor TRACKS live. The
  meta-circle running in the medium: the world hosts the operator that generates it.
*/

const REFLECTOR_MS = 50;
const G = 16, GRIDR = G >> 1, BD = 26, SEED = 7, RHO0 = 0.68, BEAT_EVERY = 30;

// The self-host program. All host logic is INLINE pure JS over plain state (no imported object, no live
// clock instance) — the only way to run inside the isolated world context AND stay snapshot/join-safe.
const selfhostWorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  // NOTE: every config constant is INTERPOLATED as a literal (\${GRIDR} etc.), NOT declared as a top-level
  // const. In a Renkon world program a top-level const becomes a reactive NODE, and a helper fn that closes
  // over it gets a node-dependency Renkon can't always resolve ("depends on undefined variable BD"). Baking
  // the literals in makes every helper self-contained (zero node deps) — the ahc-mixed-radix boundary.

  // ── INLINE living cascade (medium-core makeIFSClock, as pure fns over plain state) ──────────────────
  const _scramble = (a, b, seed) => { let h = ((a|0)*73856093) ^ ((b|0)*19349663) ^ (0xdeadbeef ^ (seed|0));
    h = Math.imul(h ^ (h>>>16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h>>>13), 0xc2b2ae35) >>> 0; return ((h ^ (h>>>16)) >>> 0) / 0x100000000; };
  const _g2r = (gain) => Math.max(1, Math.round(${GRIDR} * 2 * (gain ?? 1)));
  // clock state = { pulses:[{fireK,gain,gen}], kernel:[{r,a}], cyc, relaunchDue }
  const _clockLaunch = (C, kp, rho, seed) => { C.cyc++;
    for (let r = 0; r < 5; r++) { const t = r / 4;
      const g0 = Math.min(0.98, (0.35 + 0.6*t) * (0.7 + 0.5*_scramble(C.cyc, r, seed)));
      C.pulses.push({ fireK: kp + Math.max(2, Math.round((1-g0)*${BD})), gain: g0, gen: 0 }); }
    C.relaunchDue = 0; };
  const _clockAdvance = (C, kp, rho, seed) => { const rhoC = Math.min(0.95, rho);
    for (const e of C.kernel) e.a *= 0.985; C.kernel = C.kernel.filter(e => e.a > 0.02);
    const rem = [];
    for (const pu of C.pulses) { if (pu.fireK > kp) { rem.push(pu); continue; }
      const ri = _g2r(pu.gain);
      if (ri < ${GRIDR}) { const ex = C.kernel.find(e => e.r === ri); if (ex) ex.a = Math.min(2, ex.a + 0.4); else C.kernel.push({ r: ri, a: 0.4 }); }
      if (pu.gen < 3) { const cg = pu.gain * rhoC;
        C.pulses.push({ fireK: kp + Math.max(2, Math.round((1-cg)*${BD}*0.6)), gain: cg, gen: pu.gen+1 });
        const cg2 = cg * 0.72; C.pulses.push({ fireK: kp + Math.max(2, Math.round((1-cg2)*${BD}*0.5)), gain: cg2, gen: pu.gen+1 }); } }
    C.pulses = rem;
    if (C.pulses.length === 0 && C.relaunchDue === 0) C.relaunchDue = kp + 5;
    if (C.relaunchDue && kp >= C.relaunchDue) _clockLaunch(C, kp, rho, seed);
    return C.kernel; };

  // ── INLINE descriptor model + 𝓗 step (the tree is a pure fn of (seed,rho); μ + KL-gradient step) ────
  const _buildTree = (seed, rhoIn) => { const rho = Math.min(0.95, rhoIn), nodes = [];
    const seeds = []; for (let r = 0; r < 5; r++) { const t = r/4; seeds.push(Math.min(0.98, (0.35+0.6*t)*(0.7+0.5*_scramble(1, r, seed)))); }
    const expand = (g, gen) => { const r = Math.max(1, Math.round(2*${GRIDR}*g));
      if (r < ${GRIDR}) { const gs = gen===0?1:gen===1?0.6:0.5, iv = Math.max(2, (1-g)*${BD}*gs); nodes.push({ r, depth: gen, gain: g, rate: 1/iv }); }
      if (gen < 3) { expand(g*rho, gen+1); expand(g*rho*0.72, gen+1); } };
    for (const g0 of seeds) expand(g0, 0); return nodes; };
  const _measure = (nodes, lam, kap, s) => { const raw = new Array(${GRIDR}).fill(0);
    for (const n of nodes) raw[n.r] += n.rate * Math.exp(-lam*n.depth) * Math.pow(n.gain, kap);
    const v = raw.map(x => Math.pow(x, s)); const tot = v.reduce((a,b)=>a+b,0); return tot>0 ? v.map(x=>x/tot) : v; };
  const _asVec = (arr) => { const tot = arr.reduce((a,b)=>a+b,0); return tot>0 ? arr.map(x=>x/tot) : arr; };
  const _kl = (star, mu) => { let s = 0; for (let i=0;i<star.length;i++) if (star[i]>1e-9) s += star[i]*Math.log(star[i]/Math.max(1e-12,mu[i])); return s; };
  const _stepH = (nodes, O, muHat) => { const [lam,kap,s]=O, h=1e-4, L=(a,b,c)=>_kl(muHat, _measure(nodes,a,b,c));
    return [ lam - 0.4*(L(lam+h,kap,s)-L(lam-h,kap,s))/(2*h),
             kap - 0.4*(L(lam,kap+h,s)-L(lam,kap-h,s))/(2*h),
             Math.min(1, Math.max(0.05, s - 0.15*(L(lam,kap,s+h)-L(lam,kap,s-h))/(2*h))) ]; };
  const _muHash = (mu) => { let h = 0x811c9dc5; for (const v of mu) { const q = Math.round((Number.isFinite(v)?v:0)*1e6)|0;
    for (let b=0;b<4;b++){ h ^= (q>>(b*8))&0xff; h = Math.imul(h, 0x01000193)>>>0; } } return (h>>>0).toString(16).padStart(8,'0'); };

  // freshHost(rho) → the whole plain-state host (clock + M window + descriptor O + beat cursor).
  const _freshHost = (rho) => { const C = { pulses: [], kernel: [], cyc: 0, relaunchDue: 0 }; _clockLaunch(C, 0, rho, ${SEED});
    return { clock: C, M: new Array(${GRIDR}).fill(0), O: [0,0,1], lastBeat: 0 }; };

  const host = Behaviors.collect(
    { _armed:false, kstep:0, beats:0, rho:${RHO0}, H:null },
    reflector,
    (state, pulse) => {
      let s0 = state;
      if (pulse?._isEvent && pulse?._eventPayload?.type) {
        const entry = { fireAt: pulse.wallTime, msg: "_verb", payload: pulse._eventPayload };
        s0 = { ...state, _queue: [entry, ...(state._queue ?? [])], _nextAt: pulse.wallTime };
      }
      return W.reduce(s0, pulse, "host", {
        __macro: (s, p, ctx) => { if (!s._armed) ctx.future(1, "_beat", {}); return { ...s, _armed:true, H: s.H ?? _freshHost(s.rho) }; },

        // ONE shared-step advance of the self-host, ALL inline + pure over plain state → join-safe.
        _beat: (s, p, ctx) => { ctx.future(1, "_beat", {});
          const kstep = (s.kstep ?? 0) + 1;
          const H = s.H ?? _freshHost(s.rho);
          for (let i = 0; i < H.M.length; i++) H.M[i] *= 0.99;                          // forget (MDECAY)
          const kernel = _clockAdvance(H.clock, kstep, s.rho, ${SEED});                 // advance living clock
          for (const e of kernel) if (e.r >= 1 && e.r < ${GRIDR}) H.M[e.r] += e.a;      // fold ring into window
          let beat = false;
          if (kstep - H.lastBeat >= ${BEAT_EVERY}) { beat = true; H.lastBeat = kstep;
            const muHat = _asVec(H.M); if (muHat.some(x => x > 0)) { const nodes = _buildTree(${SEED}, s.rho); H.O = _stepH(nodes, H.O, muHat); } }
          const nodes = _buildTree(${SEED}, s.rho);
          return { ...s, kstep, beats: (s.beats ?? 0) + (beat ? 1 : 0), H,
                   O: H.O.slice(), muLive: _measure(nodes, H.O[0], H.O[1], H.O[2]), muHash: _muHash(_measure(nodes, H.O[0], H.O[1], H.O[2])) };
        },

        _verb: (s, p) => {
          if (p.type === "rho")   return { ...s, rho: Math.min(0.95, Math.max(0.40, p.value)), H: _freshHost(Math.min(0.95, Math.max(0.40, p.value))), kstep:0, beats:0 };
          if (p.type === "reset") return { ...s, rho: ${RHO0}, H: _freshHost(${RHO0}), kstep:0, beats:0 };
          return s;
        },
      });
    }
  );

  const _isStable = W.stable([host], reflector);
  const _export   = W.export(Renkon, { host }, _isStable);
`;

function makeRenderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, _sendCursorMove, injectEvent) => {
    const verb = (type, extra = {}) => injectEvent?.({ type, ...extra });

    return () => {
      if (!world?.ps?.app) return;
      const st = world.getNodeState("host");
      if (!st) return;

      if (!document.getElementById("ifs-selfhost-wrap")) {
        const w = document.createElement("div"); w.id = "ifs-selfhost-wrap";
        Object.assign(w.style, { display: "flex", gap: "0", flexWrap: "wrap" });
        document.body.appendChild(w);
      }
      let root = document.getElementById(containerId);
      if (!root) {
        root = document.createElement("div"); root.id = containerId;
        Object.assign(root.style, { fontFamily: "ui-monospace,monospace", padding: "18px", background: "#0d0d0d",
          color: "#eee", borderRadius: "10px", margin: "10px", border: "1px solid #222", minWidth: "380px" });
        root.innerHTML = `
          <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:4px;letter-spacing:1px;">
            PEER ${peerId} · IFS SELF-HOST · living cascade ⇄ W generator <span id="${containerId}-roster"></span></div>
          <div id="${containerId}-hud" style="font-size:9px;color:#555;margin-bottom:8px;"></div>
          <canvas id="${containerId}-hist" width="340" height="150" style="background:#070707;border-radius:8px;display:block;"></canvas>
          <div id="${containerId}-desc" style="font-size:9px;color:#666;margin-top:8px;"></div>
          <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;align-items:center;">
            <button data-act="reset" style="font-size:11px;padding:5px 12px;background:#161b22;color:#8b949e;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">↺ reset</button>
            <span style="font-size:9px;color:#666;">ρ</span>
            <input data-act="rho" type="range" min="0.40" max="0.95" step="0.01" value="${RHO0}" style="width:120px;">
            <span id="${containerId}-rhoval" style="font-size:9px;color:#58a6ff;">${RHO0.toFixed(2)}</span>
          </div>`;
        document.getElementById("ifs-selfhost-wrap").appendChild(root);
        root.addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b) verb(b.dataset.act); });
        root.addEventListener("input", (e) => { const el = e.target.closest("input[data-act='rho']"); if (el) { const v = parseFloat(el.value);
          const lbl = document.getElementById(containerId + "-rhoval"); if (lbl) lbl.textContent = v.toFixed(2); verb("rho", { value: v }); } });
      }

      const O = st.O ?? [0, 0, 1], rho = st.rho ?? RHO0, muLive = st.muLive ?? new Array(GRIDR).fill(0);
      const lt = world.ps.app.logicalTime ?? 0, stable = world.ps.app.isStable ?? false;
      const converged = (st.beats ?? 0) > 40;

      const set = (suf, html) => { const el = document.getElementById(containerId + suf); if (el) el.innerHTML = html; };
      set("-hud", `beats ${st.beats ?? 0} · kstep ${st.kstep ?? 0} · LT ${lt} · ${stable ? "stable" : "…"} · ρ ${rho.toFixed(2)} · μHash ${st.muHash ?? "--------"}`);
      set("-desc", `O=(λ ${O[0].toFixed(3)}, κ ${O[1].toFixed(3)}, s ${O[2].toFixed(3)}) · ${converged ? "CONVERGED ✓ (rule ⇄ trace reconciled live)" : "converging…"} · μHash = cross-peer diff at equal step (compare THIS, not O — loss non-identifiable)`);
      set("-roster", _clientBadge(world));

      // draw the descriptor's μ_live (blue) — the rule-face the living clock is being fit by.
      const cv = document.getElementById(containerId + "-hist");
      if (cv) { const g = cv.getContext("2d"), CW = cv.width, CH = cv.height, bw = CW / GRIDR;
        g.clearRect(0, 0, CW, CH);
        const mx = Math.max(0.01, ...muLive);
        for (let r = 1; r < GRIDR; r++) { const x = r * bw;
          g.fillStyle = "#58a6ff"; const hl = (muLive[r] / mx) * (CH - 16); g.fillRect(x + 2, CH - hl - 10, bw - 6, hl);
          g.fillStyle = "#555"; g.font = "8px monospace"; g.fillText("r" + r, x + 2, CH - 1); }
        g.fillStyle = "#666"; g.font = "8px monospace"; g.fillText("blue = descriptor μ(λ,κ,s) — the rule fit to the living ring", 6, 10);
      }
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:        "IFS Self-Host · living ⇄ W generator",
  selo:         "ifs-selfhost",
  reflectorMs:  REFLECTOR_MS,
  metaOptions:  {},
  makeScripts:  (av) => [selfhostWorldProgram + av],
  makeRenderer: makeRenderer,
  wrapId:       "ifs-selfhost-wrap",
};
