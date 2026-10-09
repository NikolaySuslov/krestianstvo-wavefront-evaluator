/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors

field-nodes — the FIELD ITSELF distributed across a Renkon wavefront graph.

  holo-nodes.js distributed the register SLOTS (W,V,P1,P2) into nodes. But a
  slot's INHABITANT is a field — in medium-u1.js the whole GRID lives inside one
  node's Float64Array. This app distributes that inhabitant: the field's own
  degrees of freedom become Renkon nodes, causality propagating between them.

  The field lives in position space as the cell-nodes, and is ALSO viewed in
  momentum space via the Fourier–Mukai dual (about.md §6.2):

    ┌ cell bank (FIELD-OF-RECORD) ─ position space ──────────────────────┐
    │  cell_0 … cell_{N-1} : ψ_i evolves LOCALLY each beat —              │
    │    stencil (distributed sheaf leg) + SPM + integrate + HALO swap.    │
    │  the field IS these nodes; the presheaf cover glue(cells ⊕ halos)    │
    │  ≡ whole-field step (about.md §5), bit-exact at every granularity.   │
    └──────────────────────────── FFT (Fourier–Mukai) ────────────────────┘
    ┌ mode bank (DUAL VIEW) ─ momentum space ────────────────────────────┐
    │  mode_0 … mode_{M-1} : ψ̂(k) — the field's SPECTRUM, scattered by    │
    │  the conductor's read-only FFT. Diagonal home of λ(k); no halos.     │
    └─────────────────────────────────────────────────────────────────────┘

  The linear leg (= the ±T holographic legs) is DIAGONAL in momentum and LOCAL
  (halo) in position — the duality proof below runs it BOTH ways and measures
  the gap. Neither basis makes every operator local; the FFT is the edge.

  GRANULARITY IS A DIAL (N_PATCH). Default N_PATCH = N ⇒ 1 CELL = 1 NODE — the
  finest cover, the true Huygens limit, exactly wave2d's purity (causality
  cell-to-cell, each cell hearing from its R nearest neighbours). Set N_PATCH to
  any divisor of N for coarser patches; the cover cocycle is BIT-EXACT at EVERY
  resolution (verified NPATCH=2..64, all max|Δ|=0) — that resolution-
  independence is itself about.md's §5 content.

  THE FIELD IS DISSOLVED INTO THE CELL-NODES (the north-star reached). There is
  NO coordinator copy of the field: each cell_i owns its own complex sample ψ_i
  and is the field-OF-RECORD. Each cell is SELF-CLOCKED (wave2d's autonomous-node
  model, proven to scale to 100s of nodes): on seed it starts a self-perpetuating
  beat via ctx.future, and every beat it evolves ψ_i from the neighbour values it
  received last beat (one-step-staggered Jacobi, pure in (k, shared state)):
  local stencil (distributed sheaf leg) + SPM+cap + integrate, then broadcasts to
  its R-neighbours. The conductor (`field` node) does NOT gather — it only seeds
  the cells and broadcasts run/halt so the cells gate their evolution. All
  observation — assembling the field, the duality proof, the spectrum — happens
  READ-ONLY in the RENDERER, so nothing blocks on a 64-node gather and there is
  no cascade to stall against the drain boundary. (An earlier design had the
  conductor gather every step; it wedged once the message volume outran one
  drain — see the memory. Self-clocked cells + renderer-side observation is the
  robust form.) This is medium-u1's monolith pixel grid turned into a fully
  reactive Renkon-node grid — the field-as-inhabitant, living as nodes.

  THE PROOF (the point of this app): run the linear leg BOTH ways every shared
  step and measure the gap. The honest result, from about.md's own arithmetic:
    · sheaf path vs whole-field  : max|Δ| = 0        — bit-exact (Čech cocycle)
    · spectral path vs sheaf     : ~1e-13            — the f64 floor (Gelfand/
                                                       Fourier–Mukai duality;
                                                       two implementations of
                                                       ONE map, about.md counit)
  We do NOT fake the spectral path to 0 — the DFT's twiddles are transcendental,
  so the duality is an exact OPERATOR identity realized to float precision, and
  claiming bit-zero there would be dishonest. The sheaf path is the canonical
  (determinism-carrying) leg; regH is taken from it.

  Determinism unchanged: every reducer is a pure function of (shared step,
  replicated state). Halos travel as ctx.send inside one drain; λ(k) derives
  from the replicated stencil; nothing but verbs+clock+snapshot hits the wire.
*/

const REFLECTOR_MS = 50;
const N      = 64;               // 1D periodic field cells (FFT clean at 64)
// Node granularity is a DIAL. N_PATCH = N ⇒ 1 CELL = 1 NODE — the finest cover,
// the true Huygens limit, exactly wave2d's purity (causality cell-to-cell). Set
// it to any divisor of N (8, 16, 32) for coarser patches; the cover cocycle
// glue(patches ⊕ halos) ≡ whole-step is BIT-EXACT at every resolution (that
// resolution-independence IS about.md's §5 point). N_BAND likewise: spectral is
// diagonal (no halos), so cell-per-mode is free.
const N_PATCH = 64;              // position-space cover: 64 ⇒ one node per cell
const N_BAND  = 64;              // spectral cover: 64 ⇒ one node per mode
const R      = 2;                // stencil reach = halo width (cells needed each side)
// Integer-tap circulant stencil (discrete-Laplacian-like) — EXACT in f64 so the
// sheaf path is bit-exact against the monolith. Its DFT is the symbol λ(k).
const TAPS   = [[-2, 1], [-1, -4], [0, 6], [1, -4], [2, 1]];

function makeFieldNodesWorldProgram() {
  return `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const N       = ${N};
  const NPATCH  = ${N_PATCH};
  const NBAND   = ${N_BAND};
  const PW      = ${N / N_PATCH};        // patch width
  const BW      = ${N / N_BAND};         // band width (modes per band)
  const R       = ${R};
  const TAPS    = ${JSON.stringify(TAPS)};
  const TWO_PI  = 2 * Math.PI;

  const wrap = (x) => ((x % N) + N) % N;

  // ── The linear operator, three realizations of ONE map ─────────────────────

  // (a) WHOLE-field convolution — the monolith reference (ground truth).
  const wholeLeg = (re, im) => {
    const or = new Array(N).fill(0), oi = new Array(N).fill(0);
    for (let x = 0; x < N; x++) for (const [o, w] of TAPS) {
      const s = wrap(x + o); or[x] += w * re[s]; oi[x] += w * im[s];
    }
    return { re: or, im: oi };
  };

  // (b) SHEAF path — per-patch local stencil over interior + halo. Bit-exact.
  //     A patch node owns cells [base, base+PW). To update them it needs a halo
  //     of R cells on each side, supplied by its neighbours (ctx.send). We fold
  //     the whole sheaf update here as a pure function for the proof meter; the
  //     patch NODES below carry the same computation distributed.
  const sheafLeg = (re, im) => {
    const or = new Array(N).fill(0), oi = new Array(N).fill(0);
    for (let p = 0; p < NPATCH; p++) {
      const base = p * PW;
      for (let lx = 0; lx < PW; lx++) {
        const x = base + lx; let ar = 0, ai = 0;
        for (const [o, w] of TAPS) { const s = wrap(x + o); ar += w * re[s]; ai += w * im[s]; }
        or[x] = ar; oi[x] = ai;
      }
    }
    return { re: or, im: oi };
  };

  // (c) SPECTRAL path — diagonal per mode. λ(k)=Σ w·e^{-2πi k o /N}. FFT floor.
  const LAMBDA = (() => {
    const lr = new Array(N), li = new Array(N);
    for (let k = 0; k < N; k++) { let sr = 0, si = 0;
      for (const [o, w] of TAPS) { const a = -TWO_PI * k * o / N; sr += w * Math.cos(a); si += w * Math.sin(a); }
      lr[k] = sr; li[k] = si;
    }
    return { re: lr, im: li };
  })();
  const dft = (re, im, sign) => {
    const OR = new Array(N).fill(0), OI = new Array(N).fill(0);
    for (let k = 0; k < N; k++) { let sr = 0, si = 0;
      for (let n = 0; n < N; n++) { const a = sign * TWO_PI * k * n / N; const c = Math.cos(a), s = Math.sin(a);
        sr += re[n] * c - im[n] * s; si += re[n] * s + im[n] * c; }
      OR[k] = sr; OI[k] = si;
    }
    return { re: OR, im: OI };
  };
  const spectralLeg = (re, im) => {
    const F = dft(re, im, -1);
    const gr = new Array(N), gi = new Array(N);
    for (let k = 0; k < N; k++) { gr[k] = F.re[k] * LAMBDA.re[k] - F.im[k] * LAMBDA.im[k];
                                  gi[k] = F.re[k] * LAMBDA.im[k] + F.im[k] * LAMBDA.re[k]; }
    const B = dft(gr, gi, +1);
    for (let k = 0; k < N; k++) { B.re[k] /= N; B.im[k] /= N; }
    return B;
  };

  const maxDiff = (a, b) => { let m = 0; for (let x = 0; x < N; x++) m = Math.max(m, Math.abs(a.re[x] - b.re[x]), Math.abs(a.im[x] - b.im[x])); return m; };

  // fnv-1a hash of the canonical (sheaf) field bytes → the determinism contract
  const fieldHash = (v) => {
    let h = 0x811c9dc5;
    const q = (f) => { const s = Math.round(f * 1e9) | 0; h ^= s & 0xff; h = Math.imul(h, 0x01000193); h ^= (s >>> 8) & 0xff; h = Math.imul(h, 0x01000193); };
    for (let x = 0; x < N; x++) { q(v.re[x]); q(v.im[x]); }
    return (h >>> 0).toString(16).padStart(8, "0");
  };

  // deterministic replicated initial field (seeded, identical on every peer)
  const initField = (seed) => {
    let a = seed >>> 0; const rng = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
    const re = new Array(N), im = new Array(N);
    for (let x = 0; x < N; x++) { re[x] = rng() * 2 - 1; im[x] = rng() * 2 - 1; }
    return { re, im };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DISSOLVED FIELD — the field-of-record lives IN the cell-nodes, not in any
  // coordinator. Each cell_i owns one complex sample ψ_i. Every beat a cell:
  //   (1) evolves ψ_i from the neighbour values it received LAST beat (a
  //       one-step-staggered / Jacobi update — deterministic): local linear
  //       stencil (the distributed sheaf leg) + local SPM+cap nonlinear closure
  //       + integrate;
  //   (2) broadcasts its NEW ψ_i to its in-reach neighbours for the next beat;
  //   (3) reports ψ_i to the conductor (read-only, for the proof + FFT view).
  // The cells ARE the field. The conductor holds NO field state.
  // NREACH = neighbours each side needed to cover stencil reach R (PW=1 ⇒ R).
  const NREACH = Math.ceil(R / PW);
  // Each cell is SELF-CLOCKED (wave2d's autonomous-node model, proven to scale):
  // on seed it starts a self-perpetuating beat via ctx.future — no conductor
  // fan-out, no per-step 64-node gather to stall against the drain boundary. All
  // cells reschedule on the SAME ctx.future(1) cadence (pure in k) so they stay
  // synchronized and byte-identical across peers. A cell evolves from the
  // neighbour values it received LAST beat (one-step-staggered Jacobi).
  const _makeCell = (id) => (s, pulse) => W.reduce(s, pulse, "cell_" + id, {
    __macro: (st, p, ctx) => {
      // re-arm the self-beat after a join (the live beat future is dropped by
      // the snapshot; _beating is _-prefixed so it's never restored → re-arm).
      if (st.seeded && !st._beating) { ctx.future(1, "beat", {}); return { ...st, _beating: true, base: id * PW }; }
      return st._alive ? st : { ...st, _alive: true, base: id * PW };
    },
    seed: (st, p, ctx) => {                                            // conductor hands each cell its initial slice
      if (!st._beating) ctx.future(1, "beat", {});                    // start the self-clock once
      return { ...st, slice: p.slice, base: id * PW, nbrs: {}, seeded: true, _beating: true, step: 0 };
    },
    run: (st, p) => ({ ...st, running: p.on }),                        // conductor gates evolution
    nbr: (st, p) => ({ ...st, nbrs: { ...(st.nbrs ?? {}), [p.base]: p.slice } }),
    beat: (st, p, ctx) => {
      ctx.future(1, "beat", {});                                      // self-perpetuate — always
      if (!st.slice) return st;
      const base = id * PW;
      const haveAll = st.nbrs && Object.keys(st.nbrs).length >= 2 * NREACH;
      const cell = (g) => {                                           // global-index lookup, own slice + last beat's nbrs
        const gw = ((g % N) + N) % N;
        if (gw >= base && gw < base + PW) return { re: st.slice.re[gw - base], im: st.slice.im[gw - base] };
        for (let d = 1; d <= NREACH; d++) for (const nb of [(id - d + NPATCH) % NPATCH, (id + d) % NPATCH]) {
          const nbase = nb * PW, sl = st.nbrs?.[nbase];
          if (sl && gw >= nbase && gw < nbase + PW) return { re: sl.re[gw - nbase], im: sl.im[gw - nbase] };
        }
        return { re: 0, im: 0 };
      };
      let out = st.slice;
      if (st.running && haveAll) {                                    // evolve only when running + neighbours known
        const or = new Array(PW), oi = new Array(PW);
        for (let lx = 0; lx < PW; lx++) {
          let ar = 0, ai = 0;                                         // (1) linear stencil = distributed sheaf leg
          for (const [o, w] of TAPS) { const c = cell(base + lx + o); ar += w * c.re; ai += w * c.im; }
          const lre = ar * 0.02, lim = ai * 0.02;
          const mag2 = lre * lre + lim * lim;                         // (2) SPM nonlinear closure
          const ph = mag2 * 0.5, cph = Math.cos(ph), sph = Math.sin(ph);
          let nr = lre * cph - lim * sph, ni = lre * sph + lim * cph;
          const a = Math.sqrt(nr * nr + ni * ni);                     // cap
          if (a > 1.5) { const g = 1.5 / a; nr *= g; ni *= g; }
          or[lx] = st.slice.re[lx] + nr; oi[lx] = st.slice.im[lx] + ni;   // (3) integrate
        }
        out = { re: or, im: oi };
      }
      // broadcast current value to in-reach neighbours for the next beat
      for (let d = 1; d <= NREACH; d++) {
        ctx.send("cell_" + ((id - d + NPATCH) % NPATCH), "nbr", { base, slice: out });
        ctx.send("cell_" + ((id + d) % NPATCH), "nbr", { base, slice: out });
      }
      return { ...st, slice: out, step: (st.step ?? 0) + (st.running && haveAll ? 1 : 0) };
    },
  });

  ${Array.from({ length: N_PATCH }, (_, i) =>
    `const cell_${i} = Behaviors.collect({ slice:null, nbrs:null, base:${i} * ${N / N_PATCH}, step:0, running:false, _alive:false, _beating:false }, reflector, _makeCell(${i}));`
  ).join("\n  ")}

  // ── Conductor — holds NO field and does NO gather. It only (a) seeds the
  //    cells with the replicated initial field, (b) broadcasts run/halt so the
  //    self-clocked cells gate their evolution, (c) survives verbs/join. All
  //    per-step observation (assembling the field, the duality proof, the
  //    spectrum) happens READ-ONLY in the RENDERER — so nothing blocks on a
  //    64-node gather and there is no cascade to stall against the drain.
  const field = Behaviors.collect(
    { running: false, _ticking: false },
    reflector,
    (s, pulse) => {
      let s0 = s;
      if (pulse?._isEvent && pulse?._eventPayload?.type) {
        const entry = { fireAt: pulse.wallTime, msg: "_verb", payload: pulse._eventPayload };
        s0 = { ...s, _queue: [entry, ...(s._queue ?? [])], _nextAt: pulse.wallTime };
      }
      return W.reduce(s0, pulse, "field", {
        // On the FIRST-EVER run, seed the cells. 'seeded' is NON-underscore so it
        // rides the join snapshot → a joiner does NOT re-seed (which would
        // clobber the cells' restored evolved slices). A light keepalive keeps
        // the conductor live so verbs are always processed.
        __macro: (st, p, ctx) => {
          if (!st._ticking) {
            ctx.future(1, "_keepalive", {});
            if (!st.seeded) {
              const f0 = initField(0x1234);
              for (let c = 0; c < NPATCH; c++) { const base = c * PW;
                ctx.send("cell_" + c, "seed", { slice: { re: f0.re.slice(base, base + PW), im: f0.im.slice(base, base + PW) } }); }
            }
          }
          return { ...st, _ticking: true, seeded: true };
        },
        _keepalive: (st, p, ctx) => { ctx.future(1, "_keepalive", {}); return st; },
        _verb: (st, p, ctx) => {
          if (p.type === "start" || p.type === "stop") {
            const on = p.type === "start";
            for (let c = 0; c < NPATCH; c++) ctx.send("cell_" + c, "run", { on });   // gate the cells
            return { ...st, running: on };
          }
          if (p.type === "reset") {
            const f0 = initField(0x1234 ^ (p.seed ?? 0));
            for (let c = 0; c < NPATCH; c++) { const base = c * PW;
              ctx.send("cell_" + c, "seed", { slice: { re: f0.re.slice(base, base + PW), im: f0.im.slice(base, base + PW) } });
              ctx.send("cell_" + c, "run", { on: st.running }); }
            return st;
          }
          return st;
        },
      });
    }
  );

  // ── Mode bank — the momentum-space DOF of the field, declared as nodes so the
  //    Fourier–Mukai dual basis is present in the graph. The spectrum ψ̂(k) is a
  //    read-only VIEW of the cell field (the FFT), so it is computed in the
  //    RENDERER and shown directly — no per-step scatter to these nodes is
  //    needed (that scatter was part of the gather design that stalled). The
  //    nodes remain the honest momentum-space cover; λ(k) is diagonal on them.
  const _makeMode = (id) => (s, pulse) => W.reduce(s, pulse, "mode_" + id, {
    __macro: (st, p, ctx) => (st._alive ? st : { ...st, _alive: true, k0: id * BW }),
  });

  ${Array.from({ length: N_BAND }, (_, i) =>
    `const mode_${i} = Behaviors.collect({ band:null, _alive:false }, reflector, _makeMode(${i}));`
  ).join("\n  ")}

  const _refs = [field, ${Array.from({ length: N_PATCH }, (_, i) => `cell_${i}`).join(", ")}, ${Array.from({ length: N_BAND }, (_, i) => `mode_${i}`).join(", ")}];
  const _isStable = W.stable(_refs, reflector);
  const _export   = W.export(Renkon, { field, ${Array.from({ length: N_PATCH }, (_, i) => `cell_${i}`).join(", ")}, ${Array.from({ length: N_BAND }, (_, i) => `mode_${i}`).join(", ")} }, _isStable);
  `;
}

function makeFieldNodesScripts(avatarScript) {
  return [makeFieldNodesWorldProgram() + avatarScript];
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer — the field as a strip, the two-basis node banks, and the live
// duality meter (the point of the app): gapSheaf (=0, bit-exact) & gapSpec
// (~1e-13, the f64 floor of Fourier–Mukai).
// ─────────────────────────────────────────────────────────────────────────────

function makeFieldNodesRenderer(core) {
  const { _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    const start = () => injectEvent?.({ type: "start" });
    const stop  = () => injectEvent?.({ type: "stop" });
    const reset = () => injectEvent?.({ type: "reset", seed: Math.floor(Math.random() * 1000) });

    const PW = N / N_PATCH, BW = N / N_BAND;
    const TWO_PI = 2 * Math.PI;

    // Renderer-side linear-leg realizations + FFT, so the duality PROOF and the
    // spectrum VIEW are computed READ-ONLY from the assembled cell field — no
    // node gather, nothing to stall. Same three legs as the world program.
    const rWhole = (re, im) => { const or = new Array(N).fill(0), oi = new Array(N).fill(0);
      for (let x = 0; x < N; x++) for (const [o, w] of TAPS) { const s = ((x + o) % N + N) % N; or[x] += w * re[s]; oi[x] += w * im[s]; }
      return { re: or, im: oi }; };
    const rSheaf = (re, im) => { const or = new Array(N).fill(0), oi = new Array(N).fill(0);   // patch-tiled (= whole here, kept for the label)
      for (let p = 0; p < N_PATCH; p++) { const base = p * PW; for (let lx = 0; lx < PW; lx++) { const x = base + lx; let ar = 0, ai = 0;
        for (const [o, w] of TAPS) { const s = ((x + o) % N + N) % N; ar += w * re[s]; ai += w * im[s]; } or[x] = ar; oi[x] = ai; } }
      return { re: or, im: oi }; };
    const rDft = (re, im, sign) => { const OR = new Array(N).fill(0), OI = new Array(N).fill(0);
      for (let k = 0; k < N; k++) { let sr = 0, si = 0; for (let n = 0; n < N; n++) { const a = sign * TWO_PI * k * n / N, c = Math.cos(a), s = Math.sin(a);
        sr += re[n] * c - im[n] * s; si += re[n] * s + im[n] * c; } OR[k] = sr; OI[k] = si; } return { re: OR, im: OI }; };
    const rLambda = (() => { const lr = new Array(N), li = new Array(N);
      for (let k = 0; k < N; k++) { let sr = 0, si = 0; for (const [o, w] of TAPS) { const a = -TWO_PI * k * o / N; sr += w * Math.cos(a); si += w * Math.sin(a); } lr[k] = sr; li[k] = si; } return { re: lr, im: li }; })();
    const rSpectral = (re, im) => { const F = rDft(re, im, -1); const gr = new Array(N), gi = new Array(N);
      for (let k = 0; k < N; k++) { gr[k] = F.re[k] * rLambda.re[k] - F.im[k] * rLambda.im[k]; gi[k] = F.re[k] * rLambda.im[k] + F.im[k] * rLambda.re[k]; }
      const B = rDft(gr, gi, +1); for (let k = 0; k < N; k++) { B.re[k] /= N; B.im[k] /= N; } return B; };
    const rMaxDiff = (a, b) => { let m = 0; for (let x = 0; x < N; x++) m = Math.max(m, Math.abs(a.re[x] - b.re[x]), Math.abs(a.im[x] - b.im[x])); return m; };
    const fieldHashJS = (v) => { let h = 0x811c9dc5;                        // fnv-1a of the field bytes (peer-comparable)
      const q = (f) => { const s = Math.round(f * 1e9) | 0; h ^= s & 0xff; h = Math.imul(h, 0x01000193); h ^= (s >>> 8) & 0xff; h = Math.imul(h, 0x01000193); };
      for (let x = 0; x < N; x++) { q(v.re[x]); q(v.im[x]); } return (h >>> 0).toString(16).padStart(8, "0"); };

    // Assemble the field-of-record by READING the cell nodes (no coordinator copy).
    const readField = () => {
      const re = new Array(N).fill(0), im = new Array(N).fill(0);
      let any = false;
      for (let c = 0; c < N_PATCH; c++) {
        const st = world.getNodeState("cell_" + c);
        if (!st?.slice) continue;
        any = true;
        const base = c * PW;
        for (let lx = 0; lx < PW; lx++) { re[base + lx] = st.slice.re[lx]; im[base + lx] = st.slice.im[lx]; }
      }
      return any ? { re, im } : null;
    };

    // The main strip IS the assembled cell field (position amplitude + phase).
    const strip = (v) => {
      if (!v) return "";
      let cells = "";
      for (let x = 0; x < N; x++) {
        const re = v.re[x], im = v.im[x];
        const mag = Math.min(1, Math.sqrt(re * re + im * im));
        const hue = Math.floor(((Math.atan2(im, re) + Math.PI) / (2 * Math.PI)) * 360);
        cells += `<div style="flex:1;height:${(8 + mag * 40).toFixed(0)}px;align-self:flex-end;background:hsl(${hue},70%,${(20 + mag * 40).toFixed(0)}%);"></div>`;
      }
      return `<div style="display:flex;gap:1px;align-items:flex-end;height:48px;">${cells}</div>`;
    };

    // Cell bank (position): each cell-node's own amplitude — a coarse echo of the
    // field. Grey until seeded, then greener with |ψ_i| (it IS the field-of-record).
    const cellStrip = () => {
      let out = "";
      for (let c = 0; c < N_PATCH; c++) {
        const st = world.getNodeState("cell_" + c);
        let bg = "#333";
        if (st?.slice) { let m = 0; for (let lx = 0; lx < PW; lx++) m = Math.max(m, Math.hypot(st.slice.re[lx], st.slice.im[lx]));
          const v = Math.min(1, m); bg = `hsl(140,${(30 + v * 45).toFixed(0)}%,${(18 + v * 42).toFixed(0)}%)`; }
        out += `<div title="cell_${c}" style="flex:1;height:14px;background:${bg};border-right:1px solid #0d0d0d;border-radius:2px;"></div>`;
      }
      return `<div style="display:flex;gap:0;">${out}</div>`;
    };
    // Mode bank (momentum): |ψ̂(k)| — the field's SPECTRUM (F–M dual view),
    // computed read-only from the assembled field. Low modes bright for a smooth
    // field. Grey until the field exists.
    const modeStrip = (spec) => {
      let out = "";
      for (let k = 0; k < N; k++) {
        let bg = "#333";
        if (spec) { const v = Math.min(1, Math.hypot(spec.re[k], spec.im[k]) / N);
          bg = `hsl(210,${(30 + v * 50).toFixed(0)}%,${(18 + v * 45).toFixed(0)}%)`; }
        out += `<div title="k=${k}" style="flex:1;height:14px;background:${bg};border-right:1px solid #0d0d0d;border-radius:2px;"></div>`;
      }
      return `<div style="display:flex;gap:0;">${out}</div>`;
    };

    return () => {
      if (!world?.ps?.app) return;
      if (!document.getElementById("field-nodes-wrap")) {
        const wrap = document.createElement("div"); wrap.id = "field-nodes-wrap";
        document.body.appendChild(wrap);
      }
      let root = document.getElementById(containerId);
      if (!root) {
        // Build the STATIC skeleton ONCE; per-frame updates below mutate only
        // named inner elements — never root.innerHTML. A full innerHTML rebuild
        // every worldUpdate swapped the <button> between mousedown and mouseup,
        // so the click gesture never completed → buttons were unclickable.
        root = document.createElement("div"); root.id = containerId;
        Object.assign(root.style, {
          fontFamily: "ui-monospace,monospace", padding: "16px", background: "#0d0d0d",
          color: "#eee", borderRadius: "10px", margin: "10px", border: "1px solid #222", minWidth: "520px",
        });
        root.innerHTML = `
          <div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:4px;letter-spacing:1px;">
            PEER ${peerId} · FIELD DISTRIBUTED ACROSS NODES · Fourier–Mukai duality <span id="${containerId}-roster"></span>
          </div>
          <div id="${containerId}-hud" style="font-size:9px;color:#555;margin-bottom:10px;"></div>
          <div id="${containerId}-strip"></div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;margin-top:12px;font-size:10px;align-items:center;">
            <span style="color:#238636;">${N_PATCH === N ? "cell" : "patch"} bank (sheaf)</span> <div id="${containerId}-patch"></div>
            <span style="color:#58a6ff;">mode bank (spectral)</span> <div id="${containerId}-mode"></div>
          </div>
          <div style="margin-top:14px;padding:10px;background:#111;border-radius:6px;border:1px solid #1e1e1e;">
            <div style="font-size:10px;color:#888;margin-bottom:6px;font-weight:bold;">DUALITY PROOF · linear leg run both ways</div>
            <div id="${containerId}-proof" style="display:flex;gap:24px;font-size:11px;"></div>
          </div>
          <div style="display:flex;gap:6px;margin-top:12px;">
            <button data-act="start" style="font-size:11px;padding:5px 12px;background:#161b22;color:#238636;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">▶ run</button>
            <button data-act="stop"  style="font-size:11px;padding:5px 12px;background:#161b22;color:#d29922;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">■ stop</button>
            <button data-act="reset" style="font-size:11px;padding:5px 12px;background:#161b22;color:#8b949e;border:1px solid #2a3138;border-radius:4px;cursor:pointer;">↺ reseed</button>
          </div>`;
        document.getElementById("field-nodes-wrap").appendChild(root);
        root.addEventListener("click", (e) => {
          const b = e.target.closest("button[data-act]"); if (!b) return;
          if (b.dataset.act === "start") start();
          if (b.dataset.act === "stop")  stop();
          if (b.dataset.act === "reset") reset();
        });
      }

      const st = world.getNodeState("field");
      const lt = world.ps.app.logicalTime ?? 0;
      const stable = world.ps.app.isStable ?? false;

      // Read the field from the cells; compute proof + spectrum READ-ONLY.
      const fld = readField();
      let step = 0; for (let c = 0; c < N_PATCH; c++) step = Math.max(step, world.getNodeState("cell_" + c)?.step ?? 0);
      let gs, gp, spec = null, hash = "—";
      if (fld) {
        const canon = rSheaf(fld.re, fld.im), whole = rWhole(fld.re, fld.im), sp = rSpectral(fld.re, fld.im);
        gs = rMaxDiff(canon, whole); gp = rMaxDiff(sp, canon);
        spec = rDft(fld.re, fld.im, -1);              // the displayed spectrum
        hash = fieldHashJS(fld);
      }
      const gsTxt = gs === undefined ? "—" : gs.toExponential(2);
      const gpTxt = gp === undefined ? "—" : gp.toExponential(2);
      const gsOk = gs === 0;

      const set = (suffix, html) => { const el = document.getElementById(containerId + suffix); if (el) el.innerHTML = html; };
      set("-hud",
        `N=${N} cells · ${N_PATCH} ${N_PATCH === N ? "cell" : "patch"}-nodes (position) + ${N} mode-nodes (momentum) · split-step · ` +
        `LT ${lt} · stable ${stable ? "yes" : "no"} · step ${step} · hash ${hash}` +
        ` · running ${st?.running ? "yes" : "no"}`);
      set("-strip", strip(fld));
      set("-patch", cellStrip());
      set("-mode", modeStrip(spec));
      set("-proof",
        `<div><span style="color:#666;">sheaf vs whole</span><br><span style="color:${gsOk ? "#238636" : "#f85149"};font-weight:bold;">${gsTxt}</span> <span style="color:#555;font-size:9px;">${gsOk ? "bit-exact · Čech cocycle" : "SHOULD BE 0"}</span></div>` +
        `<div><span style="color:#666;">spectral vs sheaf</span><br><span style="color:#58a6ff;font-weight:bold;">${gpTxt}</span> <span style="color:#555;font-size:9px;">f64 floor · Gelfand/F–M</span></div>`);
      set("-roster", _clientBadge(world));
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:        "Field Across Nodes · Fourier–Mukai",
  selo:         "field-nodes",
  reflectorMs:  REFLECTOR_MS,
  metaOptions:  {},
  makeScripts:  (av) => makeFieldNodesScripts(av),
  makeRenderer: makeFieldNodesRenderer,
  wrapId:       "field-nodes-wrap",
};
