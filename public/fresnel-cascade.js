/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ════════════════════════════════════════════════════════════════════════════════════════════════
//  fresnel-cascade.js — medium-u1's FRESNEL CASCADE as a PURE FUNCTION OF THE CYCLE INDEX
// ════════════════════════════════════════════════════════════════════════════════════════════════
//  medium-u1 (hologram_world_u1.js) grows its medium's ring operator from a causal IFS cascade run as
//  replicated world events: _launchSlot seeds W.rng from the cycle id, fires ROOTS log-spaced roots split
//  over TIERS, and every fresnelBeat spawns a self child (delay·r, gen+1) and a depth child (delay·r',
//  depth+1) with r drawn from the IFS maps. Each beat deposits a ring of radius round(delay/DELAY_SCALE).
//  finalizeFresnelm, at FRESNEL_DONE = 8·BASE, folds the cycle's radii into the native kernel (top-4
//  bands, weights α·count/total) — which REPLACES the operator. Nothing carries over between cycles.
//
//  THAT LAST FACT IS WHAT MAKES THIS PORT POSSIBLE. A cycle is a closed computation: its seed is the
//  cycle id, its events live inside [0, DONE), and its output is the ring. So ring(n) is a pure function
//  of n, and the cascade can be evaluated at ANY cycle directly — no replay from tick 1, no held
//  forward-only clock, no warm-up. Every cycle, including cycle 0, is a sample of the same stationary
//  law; there is no transient to wait out (contrast medium-core's makeIFSClock, whose ring ACCUMULATES
//  with kdecay and wanders for its whole life — measured knee 0.105–0.301 on ahc's W after tick 200, and
//  radii 34–62 on P1/P2 at the tick-40 bake, beyond anything they visit later).
//
//  WHAT IS AND IS NOT mu1's EXACT STREAM. The generator, seed hash, maps, delays, depth/gen caps, finalize
//  window and kernel fold are mu1's verbatim, and the RNG is W.rng's xoshiro128 with W.rng.seed's state
//  map — so cycle n reproduces the sequence mu1's cycle id n+1 WOULD draw in isolation. mu1 itself runs
//  its A/B cycles overlapped on ONE shared W.rng, so its live draws interleave between the two cascades
//  and its rings are not a pure function of anything; here each cycle owns its stream. Same law, same
//  distribution, no interleaving — and therefore replicable from one integer.
//
//  A KWE KERNEL CITIZEN, re-exported by krestianstvo-wavefront-evaluator.js beside makeTauKernel/makeHutchinson. It is the
//  PURE face of the evaluator's makeIfsClock (which runs the same kind of delay cascade as live world events): any app
//  can derive a medium operator (makeFresnelOperator) or a matter clock (rateAt/integrate) from one replicated integer.
//
//  G-DEPENDENCE (measured): with mu1's base (∝ G) the period and beat rate scale with G — 4.92 beats/tick at G=32, 2.34 at
//  128, 0.94 at 512 — so the medium's clock would stretch with the grid. `base` pins it (see makeFresnelCascade).
//
//  TIME: the cascade's delays are in cascade units; a cycle spans PERIOD = DONE units. The consumer maps its
//  own clock onto that axis (ahc: one unit = one matter tick of the world). cycleOf(age) = ⌊age/PERIOD⌋.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { buildNativeKernel, buildRingOffsets, kernelLambdaGrid } from './medium-core.js';

// hologram_world_u1.js's constants (IFS_MAPS = IFS_MAPS_DEFAULT of krestianstvo-wavefront-physics.js)
export const FRESNEL_MAPS = [0.3090169944, 0.4142135623, 0.5, 0.6180339887, 0.7071067812, 0.7320508075];
export const FRESNEL_DEFAULTS = { delayScale: 0.04, baseFrac: 0.35, depth: 8, genCap: 3, minDelay: 0.25,
  roots: 8, tiers: 4, alpha: 0.03, maxBands: 4, seed: 0 };

// W.rng (krestianstvo-wavefront-evaluator.js makeRng + rng.seed): xoshiro128, seeded by the raw state map.
function _rng(lt) {
  let s0 = (lt ^ 0x12345678) >>> 0, s1 = (lt * 0x9e3779b9) >>> 0,   // a FLOAT multiply, as rng.seed writes it (not imul)
      s2 = (lt ^ 0xdeadbeef) >>> 0, s3 = ((lt << 13) ^ 0xcafebabe) >>> 0;
  return () => {
    const r = (s0 + s3) >>> 0, t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0; s3 = (s3 ^ s1) >>> 0; s1 = (s1 ^ s2) >>> 0; s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0; s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
    return r / 0x100000000;
  };
}

// makeFresnelCascade({ G, …FRESNEL_DEFAULTS, maps }) — the pure cascade.
//   period      cascade units per cycle (= FRESNEL_DONE = 8·BASE, BASE = delayScale·G·baseFrac, both rounded as mu1)
//   cycle(n)    → { n, r, w, o, beats, times, rb, sEff } — the ring cycle n finalizes (memoized; a pure fn of n); times/rb per beat: when it fires and the ring it adds
//   cycleOf(a)  → ⌊a/period⌋ for a cascade age a ≥ 0
//   rateAt(a) / integrate(a0, a1) / beatsIn(a0, a1) — the cascade as a CLOCK (see the note at the return)
export function makeFresnelCascade(opts = {}) {
  const o = { ...FRESNEL_DEFAULTS, ...opts }, G = o.G | 0, maps = o.maps || FRESNEL_MAPS;
  if (!(G > 0)) throw new Error('makeFresnelCascade: G required');
  //   base — the root delay span. mu1: delayScale·G·baseFrac, i.e. it GROWS with G (mu1 only ever ran G=128). Pass
  //   base explicitly (e.g. the G=128 value 1.792) for a G-INDEPENDENT medium: same cycle, same beat rate, same rings at
  //   every G, only the radius cut r < G/2 depending on the grid (G = zoom, a cell a fixed physical size).
  const BASE = Number.isFinite(o.base) ? +(+o.base).toFixed(6) : +(o.delayScale * G * o.baseFrac).toFixed(6), DONE = +(BASE * 8).toFixed(4);
  const logMin = Math.log(o.minDelay * 2), logMax = Math.log(BASE);
  const memo = new Map();
  const run = (n) => {
    // _launchSlot's seed: MurmurHash3 finalizer of the cycle id (mu1 cycle ids start at 1 → cycle n = id n+1)
    let h = ((n + 1 + (o.seed | 0)) | 0) ^ 0xdeadbeef;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    const next = _rng((h ^ (h >>> 16)) >>> 0);
    // the future queue: (time, insertion seq) order — ctx.future's FIFO at equal time
    const q = []; let seq = 0;
    const push = (t, e) => { e.t = t; e.s = seq++; let i = q.length; q.push(e);
      while (i > 0 && (q[i - 1].t > t || (q[i - 1].t === t && q[i - 1].s > e.s))) { q[i] = q[i - 1]; i--; } q[i] = e; };
    const nR = Math.max(1, Math.round(o.roots / o.tiers));
    for (let d = 0; d < o.tiers; d++) { const logMid = logMin + ((d + 1) / o.tiers) * (logMax - logMin);
      for (let i = 0; i < nR; i++) { const t = nR === 1 ? 1 : i / (nR - 1); push(0, { depth: 0, delay: Math.exp(logMin + t * (logMid - logMin)), gen: 0 }); } }
    const radii = [], times = [], rb = []; let beats = 0;   // rb: each beat's own ring radius (cells) — the ring that beat adds to the operator (kept or cut)
    // finalizeFresnelm is queued right after the roots, so a beat landing exactly on DONE comes after it
    for (let k = 0; k < q.length; k++) { const e = q[k]; if (e.t >= DONE) break;
      const sd = e.delay * maps[Math.floor(next() * maps.length)], cd = e.delay * maps[Math.floor(next() * maps.length)];   // _ifsFireChildren: 2 draws, always
      if (e.gen < o.genCap && sd > o.minDelay) push(e.t + sd, { depth: e.depth, delay: sd, gen: e.gen + 1 });
      if (e.gen === 0 && e.depth + 1 < o.depth && cd > o.minDelay) push(e.t + sd + cd, { depth: e.depth + 1, delay: cd, gen: 0 });
      const ri = Math.max(1, Math.round(e.delay / o.delayScale)); if (ri < (G >> 1)) radii.push(ri); times.push(e.t); rb.push(ri); beats++; }
    const k = buildNativeKernel(radii, o.alpha, o.maxBands);
    return { n, r: k.fRadii, w: k.fWeights, o: buildRingOffsets(k.fRadii).map((a) => Float64Array.from(a)), beats, times: Float64Array.from(times), rb: Float64Array.from(rb), sEff: k.sEff };
  };
  const cycle = (n) => { n = Math.max(0, Math.floor(n)); let c = memo.get(n);
    if (!c) { c = run(n); if (memo.size >= 256) memo.delete(memo.keys().next().value); memo.set(n, c); } return c; };
  //   THE CASCADE AS A CLOCK. A cycle fires `beats` beats, but in a BURST: measured at G=128, 56% land in the first
  //   cascade unit and none after ~6 of the 14.3 (mean 33.6 beats, CV 12.7%). That within-cycle burst is the cascade's
  //   fractal-time CONTENT (hologram_world_u1 §6b: the intra-cascade delays are the genome expressed in time). The
  //   clock's honest coarse grain is therefore the CYCLE: during cycle n time runs at rate(n) = beats(n)/period beats
  //   per unit. integrate(a0, a1) = beats lived over cascade ages [a0, a1) at that grain — piecewise linear, pure,
  //   O(cycles spanned). A consumer ACCUMULATES it (e.g. τ += integrate(a, a+1) per tick, held in replicated state),
  //   so a join never has to sum the past. beatsIn(a0, a1) is the RAW count (the burst itself), for consumers that
  //   want fractal time.
  const rateAt = (a) => cycle(Math.max(0, Math.floor(a / DONE))).beats / DONE;
  const integrate = (a0, a1) => { if (!(a1 > a0)) return 0; let acc = 0, a = Math.max(0, a0);
    while (a < a1) { let n = Math.floor(a / DONE); if ((n + 1) * DONE <= a) n++;   // float rounding at a boundary: a/DONE can land a hair under n+1 while a ≥ (n+1)·DONE — step on, or the loop never advances
      const end = Math.min(a1, (n + 1) * DONE); acc += cycle(n).beats * (end - a) / DONE; a = end; }
    return acc; };
  const beatsIn = (a0, a1) => { if (!(a1 > a0)) return 0; let acc = 0;
    for (let n = Math.max(0, Math.floor(a0 / DONE)); n * DONE < a1; n++) { const c = cycle(n), t0 = n * DONE;
      for (let k = 0; k < c.times.length; k++) { const t = t0 + c.times[k]; if (t >= a0 && t < a1) acc++; } }
    return acc; };
  return { period: DONE, base: BASE, cycle, cycleOf: (a) => Math.max(0, Math.floor(a / DONE)), rateAt, integrate, beatsIn };
}

// makeFresnelOperator(cascade, G) — cycle → the medium's linear operator, memoized: the ring (for the real-space
//   leapfrog / GPU stepEye), λ(k) = kernelLambdaGrid(ring) (for the spectral step), and the two scale bands of λ
//   (medium-core's lambdaScale split at the ring's geometric-mean radius). All pure functions of the cycle.
export function makeFresnelOperator(cascade, G) {
  const memo = new Map();
  const band = (c, coarse, rMid) => { const kr = [], kw = [], ko = [];
    for (let d = 0; d < c.r.length; d++) if (coarse ? c.r[d] >= rMid : c.r[d] < rMid) { kr.push(c.r[d]); kw.push(c.w[d]); ko.push(c.o[d]); }
    return kernelLambdaGrid(kr, kw, ko, G); };
  const at = (n) => { n = Math.max(0, Math.floor(n)); let op = memo.get(n);
    if (!op) { const c = cascade.cycle(n), lam = kernelLambdaGrid(c.r, c.w, c.o, G);
      const rMid = c.r.length ? Math.sqrt(Math.max(...c.r) * Math.min(...c.r)) : 0;
      let _bands = null;   // the bands cost two more λ builds — only the ⌗c/⌗f recall reads them, so build on first ask
      op = { n, ring: { r: c.r, w: c.w, o: c.o }, lam: { re: lam.re, im: lam.im }, rMid, beats: c.beats,
        bands: () => _bands || (_bands = { coarse: band(c, true, rMid), fine: band(c, false, rMid) }) };
      if (memo.size >= 64) memo.delete(memo.keys().next().value); memo.set(n, op); }
    return op; };
  return { at };
}
