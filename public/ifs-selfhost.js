// ════════════════════════════════════════════════════════════════════════════════════════════════
//  ifs-selfhost.js — THE DESCRIPTOR SELF-HOST (Idea 3): the living IFS cascade and its Hutchinson-W
//  generator, reconciled LIVE at the rule level. A makeSelfHost-shaped kernel citizen, re-exported
//  through krestianstvo-wavefront-evaluator.js beside makeTauKernel / makeHutchinson.
// ════════════════════════════════════════════════════════════════════════════════════════════════
//  Proven headless in public/ifs-idea3.test.mjs (4/4): the online loop reaches Idea-1's batch fixpoint
//  ON THE MEASURE (TV 0.006), is DETERMINISTIC (byte-identical → join-safe), TRACKS a live ρ change,
//  and is snapshot-safe. This module packages that loop so a KWE world-node can host it.
//
//  THE LOOP (makeSelfHost's M/O co-evolution): M = the living ring as a short DECAYING WINDOW of recent
//  deposits (the drifting trace-face); O = the (λ,κ,s) descriptor (the tracking rule-face) —
//    λ = kdecay depth-survival falloff, κ = radius/gain bias, s = amp-cap saturation exponent (s<1).
//  Each BEAT, O takes one damped 𝓗-step (KL-gradient descent) toward the (λ,κ,s) explaining M. Fixpoint:
//  O == C*, the rule the ring implies == the ring the rule generates. The measure model is
//    μ(r) ∝ [ Σ_{tree nodes at r}  rate · exp(−λ·depth) · gain^κ ]^s        (rate = 1/fire-interval).
//
//  DETERMINISM CONTRACT (why it is join-safe): the ENTIRE state — the living clock, the windowed M, the
//  descriptor O, the beat cursor — is serializable via save()/restore(); step() is a pure function of that
//  state + the integer step index kp (no wall-clock, no RNG beyond the clock's own seeded stream). Two
//  peers stepping the same kp sequence from the same snapshot stay byte-identical (proven). A world-node
//  therefore keeps the host's save() blob IN its replicated reduce state and advances it at shared steps.
//
//  NON-IDENTIFIABILITY (stated, not hidden): the 3-param loss is a flat valley — different (λ,κ,s) can give
//  the SAME μ. So the INVARIANT is the measure μ(O), not the parameter triple; determinism (identical start
//  → identical O) is what pins the params per-peer. Consumers should compare μ (or its hash), not raw O.
//  REPRESENTATIONAL LIMIT (from Idea 1): at G=16 the 3-param form reaches TV≈0.014; at larger G it floors
//  higher (more radii bins than 3 params span). This module makes the fixpoint LIVE, not more expressive.

import { makeIFSClock } from './medium-core.js';

// Build the finite tree's nodes (radius, depth, gain, fire-rate) for a (seed, ρ) — the descriptor's fixed
// geometry. Pure; identical on every peer for the same (seed, ρ, gridR, baseDelay).
const buildTree = (seed, rhoIn, gridR, BD) => {
  const scramble = (a, b) => { let h = ((a | 0) * 73856093) ^ ((b | 0) * 19349663) ^ (0xdeadbeef ^ (seed | 0));
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 0x100000000; };
  const seeds = []; for (let r = 0; r < 5; r++) { const t = r / 4; seeds.push(Math.min(0.98, (0.35 + 0.6 * t) * (0.7 + 0.5 * scramble(1, r)))); }
  const rho = Math.min(0.95, rhoIn), nodes = [];
  const expand = (g, gen) => { const r = Math.max(1, Math.round(2 * gridR * g));
    if (r < gridR) { const gs = gen === 0 ? 1 : gen === 1 ? 0.6 : 0.5, interval = Math.max(2, (1 - g) * BD * gs); nodes.push({ r, depth: gen, gain: g, rate: 1 / interval }); }
    if (gen < 3) { expand(g * rho, gen + 1); expand(g * rho * 0.72, gen + 1); } };
  for (const g0 of seeds) expand(g0, 0);
  return nodes;
};

// μ(r) from the physical (λ,κ,s) descriptor over the tree, normalized. Pure.
export const descriptorMeasure = (nodes, [lam, kap, s], gridR) => {
  const raw = new Array(gridR).fill(0);
  for (const n of nodes) raw[n.r] += n.rate * Math.exp(-lam * n.depth) * Math.pow(n.gain, kap);
  const v = raw.map((x) => Math.pow(x, s)); const tot = v.reduce((a, b) => a + b, 0);
  return tot > 0 ? v.map((x) => x / tot) : v;
};
const asVec = (arr) => { const tot = arr.reduce((a, b) => a + b, 0); return tot > 0 ? arr.map((x) => x / tot) : arr; };
const kl = (star, mu) => { let s = 0; for (let i = 0; i < star.length; i++) if (star[i] > 1e-9) s += star[i] * Math.log(star[i] / Math.max(1e-12, mu[i])); return s; };
// FNV-1a hash of a measure quantized to 1e-6 — the cross-peer diff instrument (compare μ, NOT raw O; the
// loss is non-identifiable so two peers with identical μ are identical even if params drifted numerically).
export const measureHash = (mu) => { let h = 0x811c9dc5; for (const v of mu) { const q = Math.round((Number.isFinite(v) ? v : 0) * 1e6) | 0;
  for (let b = 0; b < 4; b++) { h ^= (q >> (b * 8)) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } } return (h >>> 0).toString(16).padStart(8, '0'); };

// ── THE FACTORY ─────────────────────────────────────────────────────────────────────────────────
//  makeDescriptorHost({ seed, rho, gridR, baseDelay, beatEvery, eta, mDecay })
//    seed, rho   — the cascade config (matches the app's makeIFSClock)
//    gridR       — ring extent (G>>1); baseDelay — cascade tempo
//    beatEvery   — ticks between 𝓗 steps (the self-host beat cadence)
//    eta         — per-param damped gradient steps [λ,κ,s] (the contraction factor lives here)
//    mDecay      — M's exponential-forget rate (short window over recent deposits)
export const makeDescriptorHost = ({ seed = 7, rho = 0.68, gridR = 8, baseDelay = 26,
  beatEvery = 30, eta = [0.4, 0.4, 0.15], mDecay = 0.99 } = {}) => {
  const ifs = makeIFSClock({ roots: 5, rho, baseDelay, gridR, kdecay: 0.985, seed });
  ifs.launch(0);
  let nodes = buildTree(seed, rho, gridR, baseDelay);
  const P = { O: [0, 0, 1], M: new Array(gridR).fill(0), lastBeat: 0, seed, rho, gridR, baseDelay };
  const oneStep = (muHat) => { const [lam, kap, s] = P.O, h = 1e-4, L = (a, b, c) => kl(muHat, descriptorMeasure(nodes, [a, b, c], gridR));
    return [ lam - eta[0] * (L(lam + h, kap, s) - L(lam - h, kap, s)) / (2 * h),
             kap - eta[1] * (L(lam, kap + h, s) - L(lam, kap - h, s)) / (2 * h),
             Math.min(1, Math.max(0.05, s - eta[2] * (L(lam, kap, s + h) - L(lam, kap, s - h)) / (2 * h))) ]; };
  return {
    // step(kp): advance the living clock, fold its ring into the decaying window M, and (on a beat) nudge
    // O one 𝓗-step toward the (λ,κ,s) explaining M. Pure over (state, kp). Returns { beat, O, ring }.
    step: (kp) => {
      for (let i = 0; i < P.M.length; i++) P.M[i] *= mDecay;
      const adv = ifs.advance(kp);
      for (const e of ifs.kernel()) if (e.r >= 1 && e.r < gridR) P.M[e.r] += e.a;
      let beat = false;
      if (kp - P.lastBeat >= beatEvery) { beat = true; P.lastBeat = kp;
        const muHat = asVec(P.M); if (muHat.some((x) => x > 0)) P.O = oneStep(muHat); }
      return { beat, O: P.O.slice(), ring: adv.rings };
    },
    setRho: (r) => { P.rho = r; ifs.setRho(r); nodes = buildTree(seed, r, gridR, baseDelay); },   // live ρ dial → clock + tree track
    O: () => P.O.slice(),
    measure: () => descriptorMeasure(nodes, P.O, gridR),          // μ(O) — the invariant (compare THIS, not O)
    windowMeasure: () => asVec(P.M),                              // μ̂ — M's current short-window measure
    hash: () => measureHash(descriptorMeasure(nodes, P.O, gridR)),// cross-peer diff on the MEASURE
    nodes: () => nodes,
    save: () => ({ O: P.O.slice(), M: P.M.slice(), lastBeat: P.lastBeat, rho: P.rho, ifs: ifs.save() }),
    restore: (snap) => { if (!snap) return; P.O = snap.O.slice(); P.M = snap.M.slice(); P.lastBeat = snap.lastBeat; P.rho = snap.rho;
      nodes = buildTree(seed, snap.rho, gridR, baseDelay); ifs.restore(snap.ifs); },
  };
};

if (typeof globalThis !== 'undefined') globalThis.KWEDescriptorHost = makeDescriptorHost;
