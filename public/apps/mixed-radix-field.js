/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors

mixed-radix-field — ONE field engine for ANY power-of-two G, picking the best radix
factorization for the grid scale.

  radix-r needs G a power of r (radix-4 ⇒ 16,64,256; radix-16 ⇒ 16,256). No single
  pure radix covers every size (128=2^7 is stuck at radix-2's 7 stages). MIXED-RADIX
  factors G largest-radix-first into a stage sequence and runs one butterfly stage per
  factor — covering EVERY size at near-minimal DEPTH:
    16=[16] 1st · 32=[16×2] · 64=[16×4] · 128=[16×8] · 256=[16×16] 2st · 512=[16×16×2]
  (base radix 16 = the sweet spot). On a node graph depth = drain rounds, so this is
  2–3 stages for any G≤4096 vs radix-2's log2 G. Subsumes radix-2/4/16 as special cases.

  Change G (the selector) → factor(G) recomputes → the field reseeds at the new scale
  and the HUD shows the chosen stage sequence. EXACT to the f64 FLOOR vs medium-u1's
  closure fft2d for every G (a different Fourier–Mukai factorization, at the floor).

  This is the closest of the dissolved fields to medium-u1's W field: same real IFS
  ring λ(k), same spectral (FFT) realization — just the FFT restructured mixed-radix.
  The field is a single closure grid here (the transform is the point); dissolving to
  per-cell rich-object registers is the next step. Live SPM (0 = stable waves).
*/

import { makeIFSClock, makeRingProvider, kernelLambdaGrid, kernelPropagateSpectral } from "../medium-core.js";
import { factor, mixedRadixPropagate } from "../mixed-radix-core.js";

const REFLECTOR_MS = 50;
const GSIZES = [16, 32, 64, 128, 256];
const G0 = 64;                    // default grid
const FDT = 0.15, SPM = 0, CAP = 1.6, OMEGA0 = 0.1;   // OMEGA0 = the base worldline's ℂ* dop precession rate (medium-u1 lensTau ω)

const FACTORS = {}; for (const G of GSIZES) FACTORS[G] = factor(G);
// compact ring descriptors per G (tiny — 14KB total) to embed in the world program so
// the field can compute λ(k) inline (no 3.5MB of embedded λ grids). λ = FFT of the
// integer-offset stencil image = kernelLambdaGrid's fast build, reproduced inline.
function ringDesc(G) {
  const ifs = makeIFSClock({ roots: 5, rho: 0.68, baseDelay: 26, gridR: G >> 1, seed: 7 }); ifs.launch(0);
  const ring = makeRingProvider(ifs, { alpha: 0.03, maxBands: 4, gridR: G + 8 });
  for (let k = 1; k <= 40; k++) ring.tick(k);
  const r = ring.ring(); return { r: Array.from(r.r), w: Array.from(r.w), o: r.o.map((a) => Array.from(a)) };
}
const RINGS = {}; for (const G of GSIZES) RINGS[G] = ringDesc(G);

function makeWorldProgram() {
  // The world program IMPORTS the mixed-radix engine from the core module (Renkon's
  // string program supports import — it compiles through the same module machinery).
  // → SINGLE SOURCE OF TRUTH: the transform lives only in mixed-radix-core.js; a fix
  //   there lands in both the module (renderer/gate) AND the world program. No inlined
  //   duplicate. Only the tiny replicated ring DESCRIPTORS (build data) are embedded.
  return `
  const { factor, lambdaFromRing, mixedRadixStep } = import("/mixed-radix-core.js");
  // THE EXACT medium-u1 REGISTER as this field's BASE: the single worldline carries one full ℂ*
  // dop {mode,phase,beta,omega,prec,kx,ky,tx,ty,gain,A[4]} — aged by the SAME shared helpers the AHC
  // uses (dopFresh/dopBeat/applyDop, medium-core.js). This lifts mixed-radix-field from a bare field
  // to a field WITH the register (the base for per-cell rich-object registers — the next step).
  const { dopFresh, dopBeat, applyDop } = import("/medium-core.js");
  const OMEGA = ${OMEGA0};
  const W         = Renkon.app.W;
  const reflector = Events.receiver();
  const GSIZES = ${JSON.stringify(GSIZES)};
  const RINGS  = ${JSON.stringify(RINGS)};
  const DT = ${FDT};
  const CAP = ${CAP};
  // per-G λ cache (computed once when G is set; pure fn of the replicated ring → same on every peer)
  const _lamCache = {};
  const _lamFor = (G) => { if (!_lamCache[G]) _lamCache[G] = lambdaFromRing(RINGS[G], G); return _lamCache[G]; };

  const initField = (G, seed) => {
    // SINGLE CENTERED band-limited wavepacket. One bump at the grid centre so its energy
    // decays to ~0 before the edge → no wraparound seam on the periodic (torus) FFT. A
    // WIDE real-space envelope ⇒ a NARROW spectrum: only low-k rides, so nothing sits on
    // the ring's Nyquist facets ⇒ no aliasing creases. Isolates the medium: whatever
    // structure appears now is λ(k) dynamics, not boundary/aliasing artifacts.
    const N = G * G; const re = new Array(N).fill(0), im = new Array(N).fill(0);
    const cx = G * 0.5, cy = G * 0.5, kx = 0.7, ky = 0.35;
    const w = (G * 0.16) * (G * 0.16);   // envelope variance ∝ G² → same shape at every scale, edges ~0
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const env = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * w)), ph = kx * x + ky * y;
      re[y * G + x] = env * Math.cos(ph); im[y * G + x] = env * Math.sin(ph); }
    return { re, im }; };

  // SELF-BEATING field: steps ψ each beat via the imported mixedRadixStep (pure fn of
  // shared ψ+G+ring → deterministic). Events go to _verb (start/stop/reset/setspm/setG).
  const field = Behaviors.collect(
    { running: false, _ticking: false, G: ${G0}, spm: ${SPM}, step: 0, ops: dopFresh(1, OMEGA), beats: [0] },
    reflector,
    (s, pulse) => {
      let s0 = s;
      if (pulse?._isEvent && pulse?._eventPayload?.type)
        s0 = { ...s, _queue: [{ fireAt: pulse.wallTime, msg: "_verb", payload: pulse._eventPayload }, ...(s._queue ?? [])], _nextAt: pulse.wallTime };
      return W.reduce(s0, pulse, "field", {
        __macro: (st, p, ctx) => {
          if (!st._ticking) { ctx.future(1, "beat", {});
            if (!st.seeded) { const f0 = initField(st.G, 0x1234); return { ...st, _ticking: true, seeded: true, re: f0.re, im: f0.im }; } }
          return { ...st, _ticking: true, seeded: true };
        },
        beat: (st, p, ctx) => {
          ctx.future(1, "beat", {});
          if (!st.re || !st.running) return st;
          const G = st.G; const nf = mixedRadixStep(st.re, st.im, G, _lamFor(G), DT, st.spm ?? 0, CAP);
          // age the base worldline's dop (∠ precesses by ω per beat) — the SAME dopBeat the AHC uses.
          const kstep = (st.step ?? 0) + 1; const aged = dopBeat(st.ops, st.beats, kstep, [1]);
          return { ...st, re: nf.re, im: nf.im, step: kstep, ops: aged.ops, beats: aged.beats };
        },
        _verb: (st, p, ctx) => {
          if (p.type === "start" || p.type === "stop") return { ...st, running: p.type === "start" };
          if (p.type === "reset") { const f0 = initField(st.G, 0x1234 ^ (p.seed ?? 0)); return { ...st, re: f0.re, im: f0.im, step: 0 }; }
          if (p.type === "setspm") return { ...st, spm: +p.spm || 0 };
          if (p.type === "setG" && GSIZES.includes(p.G | 0)) { const G = p.G | 0; const f0 = initField(G, 0x1234); return { ...st, G, re: f0.re, im: f0.im, step: 0, ops: dopFresh(1, OMEGA), beats: [0] }; }
          // the base worldline's register DOF (the dop): β pin stiffness, ω precession, kx/ky tilt.
          if (p.type === "setpin")  { const ops = st.ops.map((o) => ({ ...o, beta: +p.beta || 1 })); return { ...st, ops }; }
          if (p.type === "setomega"){ const ops = st.ops.map((o) => ({ ...o, omega: +p.omega || 0 })); return { ...st, ops }; }
          if (p.type === "settilt") { const ops = st.ops.map((o) => ({ ...o, kx: +p.kx || 0, ky: +p.ky || 0, mode: (p.kx||p.ky) ? 'phase' : 'id' })); return { ...st, ops }; }
          return st;
        },
      });
    }
  );

  const _refs = [field];
  const _isStable = W.stable(_refs, reflector);
  const _export   = W.export(Renkon, { field }, _isStable);
  `;
}

function makeScripts(avatarScript) { return [makeWorldProgram() + avatarScript]; }

// renderer-side λ(k) + ring per G (for the read-only gate), cached — rebuilds the real
// IFS ring (matches the world program's inlined descriptors, same seed/params).
const _lamRenderCache = {};
function _lamRender(G) {
  if (_lamRenderCache[G]) return _lamRenderCache[G];
  const ifs = makeIFSClock({ roots: 5, rho: 0.68, baseDelay: 26, gridR: G >> 1, seed: 7 }); ifs.launch(0);
  const ring = makeRingProvider(ifs, { alpha: 0.03, maxBands: 4, gridR: G + 8 });
  for (let k = 1; k <= 40; k++) ring.tick(k);
  const r = ring.ring(); const lam = kernelLambdaGrid(r.r, r.w, r.o, G);
  const out = { lam: { re: lam.re, im: lam.im }, ring: { r: Array.from(r.r), w: Array.from(r.w), o: r.o.map((a) => Array.from(a)) } };
  _lamRenderCache[G] = out; return out;
}

function makeRenderer(core) {
  const { _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    const start = () => injectEvent?.({ type: "start" });
    const stop  = () => injectEvent?.({ type: "stop" });
    const reset = () => injectEvent?.({ type: "reset", seed: Math.floor(Math.random() * 1000) });
    const setG  = (G) => injectEvent?.({ type: "setG", G });
    const setspm = (v) => injectEvent?.({ type: "setspm", spm: v });

    const hsl2rgb = (h, s, l) => { h /= 360; const a = s * Math.min(l, 1 - l);
      const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [255 * f(0), 255 * f(8), 255 * f(4)]; };
    let _canvas = null, _ctx = null, _imgG = 0, _imgData = null;
    const _gateCache = {};   // gate result per G (computed once — it's a fixed debug meter)
    const paint = (re, im, G) => {
      if (!re) return;
      if (!_canvas) { _canvas = document.getElementById(containerId + "-canvas"); if (!_canvas) return; _ctx = _canvas.getContext("2d"); }
      if (_imgG !== G) { _canvas.width = G; _canvas.height = G; _imgData = _ctx.createImageData(G, G); _imgG = G; }
      const d = _imgData.data, N = G * G;
      for (let i = 0; i < N; i++) { const rr = re[i], ii = im[i]; const mag = Math.min(1, Math.hypot(rr, ii)), hue = ((Math.atan2(ii, rr) + Math.PI) / (2 * Math.PI)) * 360;
        const [r, g, b] = hsl2rgb(hue, 0.72, 0.18 + mag * 0.46); const o = i * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; }
      _ctx.putImageData(_imgData, 0, 0);
    };

    return () => {
      if (!world?.ps?.app) return;
      if (!document.getElementById("mixed-radix-field-wrap")) { const w = document.createElement("div"); w.id = "mixed-radix-field-wrap"; document.body.appendChild(w); }
      let root = document.getElementById(containerId);
      if (!root) {
        root = document.createElement("div"); root.id = containerId;
        Object.assign(root.style, { fontFamily: "ui-monospace,monospace", padding: "16px", background: "#0d0d0d", color: "#eee", borderRadius: "10px", margin: "10px", border: "1px solid #222", minWidth: "420px" });
        root.innerHTML = `
          <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:4px;letter-spacing:1px;">
            PEER ${peerId} · MIXED-RADIX FIELD · one engine, any G <span id="${containerId}-roster"></span></div>
          <div id="${containerId}-hud" style="font-size:9px;color:#555;margin-bottom:8px;"></div>
          <canvas id="${containerId}-canvas" width="64" height="64" style="width:288px;height:288px;image-rendering:pixelated;border:1px solid #222;"></canvas>
          <div id="${containerId}-gate" style="font-size:9px;color:#666;margin-top:8px;"></div>
          <div style="display:flex;gap:6px;margin-top:10px;align-items:center;font-size:10px;color:#666;">
            <span>G:</span><span id="${containerId}-gsel" style="display:flex;gap:4px;"></span>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button data-act="start" style="font-size:11px;padding:5px 12px;background:#161b22;color:#238636;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">▶ run</button>
            <button data-act="stop"  style="font-size:11px;padding:5px 12px;background:#161b22;color:#d29922;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">■ stop</button>
            <button data-act="reset" style="font-size:11px;padding:5px 12px;background:#161b22;color:#8b949e;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">↺ reseed</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;align-items:center;font-size:10px;color:#666;">
            <span>SPM:</span>
            <button data-spm="0" style="font-size:10px;padding:3px 8px;background:#161b22;color:#79c0ff;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">0 stable</button>
            <button data-spm="0.15" style="font-size:10px;padding:3px 8px;background:#161b22;color:#f0883e;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">0.15</button>
          </div>`;
        document.getElementById("mixed-radix-field-wrap").appendChild(root);
        // G selector buttons
        const gsel = document.getElementById(containerId + "-gsel");
        gsel.innerHTML = GSIZES.map((G) => `<button data-g="${G}" style="font-size:10px;padding:3px 7px;background:#161b22;color:#8b949e;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">${G}</button>`).join("");
        root.addEventListener("click", (e) => {
          const b = e.target.closest("button[data-act]"), gb = e.target.closest("button[data-g]"), sb = e.target.closest("button[data-spm]");
          if (b) { if (b.dataset.act === "start") start(); if (b.dataset.act === "stop") stop(); if (b.dataset.act === "reset") reset(); }
          if (gb) setG(+gb.dataset.g);
          if (sb) setspm(parseFloat(sb.dataset.spm));
        });
      }

      const st = world.getNodeState("field");
      if (!st) return;
      const G = st.G, lt = world.ps.app.logicalTime ?? 0, stable = world.ps.app.isStable ?? false;

      // The field SELF-STEPS in its own beat (world program) — the renderer only OBSERVES.
      // live gate: mixed-radix vs closure kernelPropagateSpectral (one step, read-only).
      // λ + ring computed renderer-side from the small ring descriptor (cached per G).
      // GATE (mixed-radix vs closure) — a DEBUG meter that runs two full G² transforms.
      // It was recomputed EVERY render frame → at G=128/256 that dominated the frame
      // (~30-43ms) and lagged the animation. It's ~constant per G (both operators exact),
      // so compute it ONCE per G (cached) on the current field, not every frame.
      if (_gateCache[G] === undefined && st.re) { const N = G * G; const L = _lamRender(G);
        const inter = new Float64Array(2 * N); for (let i = 0; i < N; i++) { inter[i * 2] = st.re[i]; inter[i * 2 + 1] = st.im[i]; }
        const clo = kernelPropagateSpectral(inter.slice(), Float64Array.from(L.ring.r), Float64Array.from(L.ring.w), L.ring.o.map((a) => Float64Array.from(a)), { T: 1, dt: FDT, G, lam: L.lam }).field;
        const mr = mixedRadixPropagate(inter.slice(), G, L.lam, { T: 1, dt: FDT }).field;
        let m = 0; for (let i = 0; i < 2 * N; i++) m = Math.max(m, Math.abs(clo[i] - mr[i])); _gateCache[G] = { s: m.toExponential(2), ok: m < 1e-9 }; }
      const gc = _gateCache[G] || { s: "—", ok: false }, gate = gc.s, gateOk = gc.ok;

      const fac = FACTORS[G];
      const set = (suf, html) => { const el = document.getElementById(containerId + suf); if (el) el.innerHTML = html; };
      set("-hud", `G=${G} · factor(${G}) = [${fac.join("×")}] = ${fac.length} stage${fac.length > 1 ? "s" : ""} (radix-2 would be ${Math.log2(G)}) · EXACT medium-u1 ring · LT ${lt} · stable ${stable ? "yes" : "no"} · step ${st.step ?? 0} · SPM ${(st.spm ?? 0).toFixed(2)} · running ${st.running ? "yes" : "no"}`);
      paint(st.re, st.im, G);
      set("-gate", `mixed-radix [${fac.join("×")}] vs closure FFT: <span style="color:${gateOk ? "#238636" : "#f85149"};font-weight:bold;">${gate}</span> ${gateOk ? "· f64 FLOOR · exact" : ""}`);
      set("-roster", _clientBadge(world));
      _renderAvatars(world, root);
      // highlight current G button (getElementById tolerates the ':' in containerId;
      // a '#id' CSS selector would not — query buttons WITHIN the gsel element instead)
      const gselEl = document.getElementById(containerId + "-gsel");
      if (gselEl) gselEl.querySelectorAll("button").forEach((b) => { b.style.color = (+b.dataset.g === G) ? "#79c0ff" : "#8b949e"; b.style.borderColor = (+b.dataset.g === G) ? "#1f6feb" : "#2a3138"; });
    };
  };
}

export default {
  title:        "Mixed-Radix Field · one engine, any G",
  selo:         "mixed-radix-field",
  reflectorMs:  REFLECTOR_MS,
  metaOptions:  {},
  makeScripts:  (av) => makeScripts(av),
  makeRenderer: makeRenderer,
  wrapId:       "mixed-radix-field-wrap",
};
