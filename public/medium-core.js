// ════════════════════════════════════════════════════════════════════════════════════════════════
//  MEDIUM CORE — the medium arc's deterministic engine, EXTRACTED (doc/proper-time-metric.md §12).
//  ------------------------------------------------------------------------------------------------
//  PURPOSE: medium.js's value is its determinism-hardened core (two drain paths, mux capture, τ
//  wiring, snapshot parity — each line paid for by a live fork diagnosis). The clean observer demo
//  must IMPORT that core, never copy it — a copy forks the code that must never drift (the
//  soliton-algebra.js / eye.js precedent: extraction, not duplication). This module grows in STAGES,
//  each an authority switch verified byte-identical before the next. STATUS:
//    STAGE A  ✓ the OBSERVER BANK — descriptor store + snapshot codec (stable ops reference).
//    STAGE B1 ✓ (medium-side) the ⎙virt table de-twinned into ONE _virtVerb.
//    STAGE B2 ✓ the verb WIRE SCHEMA (normalizeVirtEvent — one source of truth at the pull) + the
//               SETTINGS-sector table (applySettingsVerb — pure bank/dial writes).
//    STAGE C1 ✓ the STEP CLOCK (makeStepClock — the §7.44 target law + reanchor continuity).
//    STAGE C2 ✓ (medium-side) the virt-sector state object _V (28 bindings).
//    STAGE C3 ✓ the V-SECTOR verb table (applyVirtVerb — optics verbs behind the stores contract;
//               residue: tex/cseed probe + edge coupling stay medium-side with their state).
//    STAGE C4 ✓ the mux TWO-CLOCK law (muxClocks) + the COUPLING STORE with its capture law
//               (makeCouplingStore). BOUNDARY DECISION: _muxVirtualStep's BODY stays in medium.js —
//               it is scheduling law wrapped around physics orchestration (13 physics callbacks);
//               the laws moved, the physics did not. The thin demo therefore imports ALL the LAWS
//               (τ kernel, lens algebra, bank, clocks, wire, verb tables, coupling store) and
//               provides its own physics — which is the meta-circularity ruling made architecture:
//               every KWE app gets proper time; the physics must be the app's own.
//  The kernel boundary holds throughout: this core knows THAT observers have descriptors, clocks and
//  queues — the PHYSICS (beat detector, grids, constants, operator algebra content) stays medium-side.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { lensU1, lensC1 } from './soliton-algebra.js';

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  DETERMINISM PRIMITIVES (the two-tier hashes + the field-overlap meter) — the instruments EVERY KWE
//  app rebuilds to compare peers. Factored here so regH/fieldH/solH/lock are ONE implementation.
//  THE TWO TIERS (doc/medium-u1-slots.md): hashNums = the EXACT-ARITHMETIC tier (register descriptors
//  evolve by lensC1 compose/apply + integer beats — no GPU, no f32, byte-identical BY CONSTRUCTION;
//  the quantize only guards benign last-bit ω·τ accumulation). hashField = the ψ tier (an f32 GPU
//  image; it may drift on ULP — the lock, not the hash, is the honest cross-peer convergence measure).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// hashField(f) — FNV-1a over the Float32 VIEW of a ψ field (interleaved [re,im] f64 → f32 bytes). The
// GPU stores/reads f32, so hashing the f32 view is the field's "GPU truth." '--------' for a null field.
export const hashField = (f) => { if (!f) return '--------'; let h = 0x811c9dc5; const q = new Float32Array(f), b = new Uint8Array(q.buffer);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = (h * 0x01000193) >>> 0; } return (h >>> 0).toString(16).padStart(8, '0'); };

// hashNums(nums) — FNV-1a over a list of DOUBLES quantized to a 1e-6 grid: the exact-arithmetic tier.
// Byte-identical across peers by construction (the register is pure descriptor arithmetic + integer beats).
export const hashNums = (nums) => { let h = 0x811c9dc5; for (const v of nums) { const q = Math.round((Number.isFinite(v) ? v : 0) * 1e6) | 0;
  h ^= (q & 0xff); h = (h * 0x01000193) >>> 0; h ^= ((q >> 8) & 0xff); h = (h * 0x01000193) >>> 0; h ^= ((q >> 16) & 0xff); h = (h * 0x01000193) >>> 0; h ^= ((q >> 24) & 0xff); h = (h * 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0'); };

// opNums(op) — a lensC1/lensU1 element flattened to its exact-arithmetic scalars (the tier-1 CONTENT).
// The canonical serialization of the group element (belongs with makeObserverBank, which produces them):
// this is what a register hash (regH) hashes per slot to prove the descriptor tier byte-identical.
export const opNums = (op) => [op.phase, op.gain ?? 1, op.beta, op.omega, op.prec, op.kx, op.ky, op.tx, op.ty, ...(op.A || [1, 0, 0, 1])];

// ampCorr(a, b) — the NORMALIZED complex field overlap |⟨a,b⟩| / (‖a‖‖b‖) ∈ [0,1]: the lock / fidelity
// meter. lock→A (living-transport observable), recall cue-match (content-addressed bind), lift fidelity.
// U(1)-invariant (magnitude of the complex inner product) → an honest convergence measure even off-phase.
export const ampCorr = (a, b) => { if (!a || !b) return 0; let re = 0, im = 0, ea = 0, eb = 0; const n = a.length >> 1;
  for (let i = 0; i < n; i++) { const ar = a[i * 2], ai = a[i * 2 + 1], br = b[i * 2], bi = b[i * 2 + 1];
    re += ar * br + ai * bi; im += ai * br - ar * bi; ea += ar * ar + ai * ai; eb += br * br + bi * bi; }
  const d = Math.sqrt(ea * eb); return d > 0 ? Math.hypot(re, im) / d : 0; };

// phaseCorr(a, b) — the PHASE of the complex overlap ⟨a,b⟩ = arg(Σ āᵢ·bᵢ) ∈ (−π,π]. ampCorr returns the
// MAGNITUDE of the SAME inner product (the lock); phaseCorr returns its ANGLE (the relative global phase of
// b vs a). This is the HONEST field-derived observer shift: how much has b's phase rotated relative to a's,
// measured from the FIELD BYTES themselves — not from any descriptor. So a recall can check the 128 KB field
// round-trip's ACTUAL aging (phaseCorr(plate, W_now)) against the 6-float algebraic prediction (ω·Δτ): the
// dual-layer equivalence becomes a genuine field-vs-equation proof, not a descriptor self-consistency check.
// Returns 0 on null / zero-overlap (no meaningful angle). Uses ā·b (conjugate a) so the sign is "b relative to a".
export const phaseCorr = (a, b) => { if (!a || !b) return 0; let re = 0, im = 0; const n = a.length >> 1;
  for (let i = 0; i < n; i++) { const ar = a[i * 2], ai = a[i * 2 + 1], br = b[i * 2], bi = b[i * 2 + 1];
    re += ar * br + ai * bi; im += ar * bi - ai * br; }   // Σ ā·b : re = ar·br+ai·bi, im = ar·bi−ai·br
  return (re || im) ? Math.atan2(im, re) : 0; };

// syncClockRate(stepClk, tauK, k, nSl) — mirror a step-clock rate flip onto the τ kernel. THE LANDMINE
// this closes: when the live-slot count nSl changes (e.g. V born → nSl 1→2), stepClk.reanchor halves the
// step budget (target/nSl → the GPU keeps up), but if _tauK keeps the OLD rate its stamp(t) lands verbs
// ~nSl× AHEAD of the drive's real solSteps → a growing backlog → stamped inputs fire seconds late (live-
// caught: store Δ=17 before V, Δ=1006 after). reanchor keeps k continuous (c0 += k·(rΔ)/spp — pure fn of
// shared k+rates → byte-identical) AND re-stamps τ's pending queue entries into the new epoch. Call each
// frame with the current nSl; it is a no-op unless the rate actually changed. Returns true on a flip.
export function syncClockRate(stepClk, tauK, k, nSl) {
  const flipped = stepClk.reanchor(k, nSl);
  if (flipped && tauK && tauK.reanchor) tauK.reanchor(k, nSl);
  return flipped;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  BEAT-SOURCE PROVIDERS (the fifth pluggable law family; kwe-gr.md §7) — matter-clocks a KWE app
//  drops in and feeds to tauK.beat. Each is a small stateful unit with the coupling-store contract:
//    .advance(kp) → true when this worldline TICKED (the caller then does tauK.beat / precession)
//    .save() / .restore(s)          f64-exact snapshot codec (for the join channel)
//  THE BOUNDARY (why these are LAW, not physics): a provider knows THAT it produces beats from its own
//  state and proper-step counter — it NEVER knows what a beat MEANS (a note, a bit, a MAXCUT flip), what
//  it renders as, or what app hosts it. The app assigns meaning; the provider assigns timing. That is the
//  extraction law ("the core knows THAT a worldline ticks, never WHY") applied to the clock ITSELF.
//  The trivial metronome (kp % tempo === 0) stays a one-liner in apps — too small to abstract.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// makeRippleClock — the LOCK-RIPPLE detector (rhythm/observers' beat source): a worldline beats when the
// coherence between its live state and its reference OSCILLATES upward through its own running mean. `feed(l)`
// takes the current lock ℓ ∈ [0,1]; the EMA baseline + up-crossing + refractory is the detector (a pure fn of
// the ℓ stream). The clock knows nothing of WHAT ℓ measures — a field overlap, a chord match, a voice lock.
export function makeRippleClock({ ema = 32, refractory = 8 } = {}) {
  const D = { bar: 0, prev: 0, lastKp: -1e9, ema, refractory };
  return {
    feed: (l, kp) => { D.bar += (l - D.bar) / D.ema; const d = l - D.bar, s = Math.sign(d);
      let beat = false; if (D.prev < 0 && s >= 0 && kp - D.lastKp >= D.refractory) { beat = true; D.lastKp = kp; } D.prev = s; return beat; },
    save: () => ({ bar: D.bar, prev: D.prev, lastKp: D.lastKp }),
    restore: (s) => { D.bar = s?.bar ?? 0; D.prev = s?.prev ?? 0; D.lastKp = s?.lastKp ?? -1e9; },
    reset: () => { D.bar = 0; D.prev = 0; D.lastKp = -1e9; },
  };
}

// makeIFSClock — GEOMETRY THAT TICKS: a Fresnel cascade as a genuine lensC1 COMPOSE-CHAIN. Each pulse carries
// the accumulated contraction op (op.gain = ρ^depth, the self-similar depth law); advance(kp) fires all due
// pulses (each firing = a BEAT + a ring at radius round(gridR·op.gain)), recursing by lensC1.compose(op, ρ).
// STABILITY = the contraction-mapping theorem = capGain = the medium energy law (ρ<1 → bounded attractor). The
// inter-cycle relaunch is armed at finalize (§9 liveness). Returns { beats, rings } this step; rings = the genome.
export function makeIFSClock({ roots = 5, maxGen = 3, rho = 0.68, baseDelay = 26, gridR = 12, kdecay = 0.985, seed = 0 } = {}) {
  let pulses = [], kernel = [], cyc = 0, relaunchDue = 0;
  const scramble = (a, b) => { let h = ((a | 0) * 73856093) ^ ((b | 0) * 19349663) ^ (0xdeadbeef ^ (seed | 0));
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 0x100000000; };
  const g2r = (op) => Math.max(1, Math.round(gridR * 2 * (op.gain ?? 1)));
  const launch = (kp) => { cyc++; const R = Math.min(0.95, rho);
    for (let r = 0; r < roots; r++) { const t = roots === 1 ? 1 : r / (roots - 1);
      const g0 = Math.min(0.98, (0.35 + 0.6 * t) * (0.7 + 0.5 * scramble(cyc, r)));
      const op = { ...lensC1.id(), gain: g0, phase: 2 * Math.PI * scramble(cyc, r + 40) };
      pulses.push({ fireK: kp + Math.max(2, Math.round((1 - g0) * baseDelay)), op, gen: 0 }); }
    relaunchDue = 0; };
  return {
    launch,
    advance: (kp) => { for (const e of kernel) e.a *= kdecay; kernel = kernel.filter((e) => e.a > 0.02);
      let fired = false; const rem = []; const rhoOp = { ...lensC1.id(), gain: Math.min(0.95, rho) };
      for (const pu of pulses) { if (pu.fireK > kp) { rem.push(pu); continue; }
        fired = true; const ri = g2r(pu.op);
        if (ri < gridR) { const ex = kernel.find((e) => e.r === ri); if (ex) ex.a = Math.min(2, ex.a + 0.4); else kernel.push({ r: ri, a: 0.4 }); }
        if (pu.gen < maxGen) { const child = lensC1.compose(pu.op, rhoOp);
          pulses.push({ fireK: kp + Math.max(2, Math.round((1 - child.gain) * baseDelay * 0.6)), op: child, gen: pu.gen + 1 });
          const child2 = lensC1.compose(child, { ...lensC1.id(), gain: 0.72 });
          pulses.push({ fireK: kp + Math.max(2, Math.round((1 - child2.gain) * baseDelay * 0.5)), op: child2, gen: pu.gen + 1 }); } }
      pulses = rem;
      if (pulses.length === 0 && relaunchDue === 0) relaunchDue = kp + roots;   // §9: arm the inter-cycle glue (finalize-fallback liveness)
      if (relaunchDue && kp >= relaunchDue) launch(kp);
      return { beat: fired, rings: kernel }; },
    setRho: (r) => { rho = r; },
    kernel: () => kernel,
    save: () => ({ pulses: pulses.map((p) => ({ fireK: p.fireK, gen: p.gen, op: { ...p.op } })), kernel: kernel.map((e) => ({ ...e })), cyc, relaunchDue }),
    restore: (s) => { pulses = (s?.pulses || []).map((p) => ({ fireK: p.fireK, gen: p.gen, op: { ...(p.op || lensC1.id()) } }));
      kernel = (s?.kernel || []).map((e) => ({ ...e })); cyc = s?.cyc ?? 0; relaunchDue = s?.relaunchDue ?? 0; },
    reset: () => { pulses = []; kernel = []; cyc = 0; relaunchDue = 0; },
  };
}

// makeSelfHost — THE META-CIRCLE as a matter-clock unit: matter M and operator O are BOTH lensC1 elements.
// step(kp) does drive (M relaxes β toward O) → beat (the coherence ripple) → self-host (O rewrites toward M by
// wash). ℂ*: if `unpinned`, O's amplitude drifts (gdrift) and self-edit amplifies it → RUNAWAY unless capGain(cap)
// bounds it (the SAME contraction law as makeIFSClock). Returns { beat, coherence, M, O }. The app decides what M
// MEANS (a computation, a voice, a register) — the provider only self-hosts a clock. spin = O's precession rate.
export function makeSelfHost({ beta = 0.06, wash = 0.12, spin = 0.28, gdrift = 1, cap = 8, unpinned = false } = {}) {
  const elt = (phase, rot, gain = 1) => { const c = Math.cos(rot), s = Math.sin(rot);
    return { mode: rot ? 'metric' : 'id', phase, gain, kx: 0, ky: 0, A: [c, -s, s, c], tx: 0, ty: 0, beta: 1, omega: 0, prec: 0 }; };
  const rotOf = (op) => Math.atan2(op.A[2], op.A[0]);
  const wrap2pi = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const towards = (a, b, f) => elt(wrap2pi(a.phase + f * lensU1.wrap(b.phase - a.phase)), rotOf(a) + f * lensU1.wrap(rotOf(b) - rotOf(a)),
    Math.exp(Math.log(a.gain ?? 1) + f * (Math.log(b.gain ?? 1) - Math.log(a.gain ?? 1))));
  const coh = (a, b) => { const dp = Math.abs(lensU1.wrap(b.phase - a.phase)), dr = Math.abs(lensU1.wrap(rotOf(b) - rotOf(a))), dg = Math.abs(Math.log((b.gain ?? 1) / (a.gain ?? 1)));
    return Math.max(0, 1 - (dp + dr) / (2 * Math.PI) - 0.3 * Math.min(1, dg)); };
  const P = { O: elt(0, 0, 1), M: elt(Math.PI, 0, 1), det: { bar: 0, prev: 0, lastKp: -1e9 }, beta, wash, spin, gdrift, cap, unpinned };
  return {
    step: (kp) => { const gd = P.unpinned ? Math.pow(1.006, P.gdrift) : 1;
      P.O = elt(wrap2pi(P.O.phase + P.spin), rotOf(P.O) + P.spin * 0.5, P.unpinned ? P.O.gain * gd : 1);
      P.M = towards(P.M, P.O, P.beta);
      const l = coh(P.M, P.O), D = P.det; D.bar += (l - D.bar) / 24; const d = l - D.bar, sg = Math.sign(d);
      let beat = false; if (D.prev < 0 && sg >= 0 && kp - D.lastKp >= 6) { beat = true; D.lastKp = kp; } D.prev = sg;
      if (beat) { P.O = towards(P.O, P.M, P.wash); if (P.unpinned && P.cap > 0) P.O = lensU1.capGain(P.O, P.cap); }
      if (!isFinite(P.O.gain) || P.O.gain > 1e7) { P.M = elt(P.M.phase, rotOf(P.M), 1); P.O = elt(P.O.phase, rotOf(P.O), 1e7); }
      return { beat, coherence: l, M: P.M, O: P.O }; },
    set: (k, v) => { if (k in P) P[k] = v; if (k === 'unpinned' && !v) { P.M = lensU1.pin(P.M); P.O = lensU1.pin(P.O); } },
    get: (k) => P[k], kick: (a = 1.5) => { P.M = elt(wrap2pi(P.M.phase + a), rotOf(P.M), P.M.gain); },
    save: () => ({ O: { ...P.O }, M: { ...P.M }, det: { ...P.det }, beta: P.beta, wash: P.wash, spin: P.spin, gdrift: P.gdrift, cap: P.cap, unpinned: P.unpinned }),
    restore: (s) => { if (!s) return; P.O = { ...s.O }; P.M = { ...s.M }; Object.assign(P.det, s.det || {}); P.beta = s.beta ?? beta; P.wash = s.wash ?? wash; P.spin = s.spin ?? spin; P.gdrift = s.gdrift ?? gdrift; P.cap = s.cap ?? cap; P.unpinned = !!s.unpinned; },
    reset: () => { P.O = elt(0, 0, 1); P.M = elt(Math.PI, 0, 1); P.det = { bar: 0, prev: 0, lastKp: -1e9 }; },
  };
}


const NUM = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? v : d;

// makeObserverBank(n) — the per-slot observer descriptors as ONE owned store.
//  ops          the live descriptor array (STABLE reference — callers may hold it; entries are the
//               extended lensU1 elements, mutated only at verb drains / beat sites, medium-side)
//  reset()      re-anchor law: every descriptor back to identity
//  save()       snapshot codec out (deep copies, incl. the affine A)
//  restore(s)   snapshot codec in — sanitizes field-by-field (a malformed entry degrades to identity
//               components, never NaN); returns false if s is not a descriptor snapshot (caller then
//               falls back to restoreLegacy)
//  restoreLegacy({attPhase, lensTau, aphEng, refAmp}) — the pre-descriptor snapshot keys, mapped
//               exactly as medium.js historically did (W phase / global ω to all four / V,P ledgers /
//               pin dials); always resets first so absent keys mean identity
// ── STAGE B2 (scoped): the VERB WIRE SCHEMA + the SETTINGS-SECTOR verb table ─────────────────────
// The mediumVirt pipeline has THREE schema sites — world clamp → PULL → drain — and the pull rebuilt
// queue entries from a fixed field list, silently stripping new fields (live-caught 2026-07-11:
// lensset carried rot=0.3, drained rot=0). The wire schema now lives HERE, once: normalizeVirtEvent
// is the single source of truth for what crosses the pull. Add a verb's fields in ONE place.
export function normalizeVirtEvent(e) {
  const q = { t: (e.time ?? 0), seq: e.seq | 0, mode: e.mode || 'record',
    leak: (typeof e.leak === 'number') ? e.leak : 0, slot: (e.slot | 0),
    gx: (e.gx || 0), gy: (e.gy || 0), amp: (typeof e.amp === 'number') ? e.amp : 0, src: e.src || 'V' };
  if (q.mode === 'lensset') { q.kx = +e.kx || 0; q.ky = +e.ky || 0; q.rot = +e.rot || 0;
    q.scl = (typeof e.scl === 'number' && e.scl > 0) ? e.scl : 1; q.tx = +e.tx || 0; q.ty = +e.ty || 0; }
  return q;
}

// applySettingsVerb(vq, k, ops, dials) — the SETTINGS SECTOR of the ⎙virt verb table: pure state
// writes into the observer bank (ops) and the replicated UI dials — lensset · lenstau · refamp ·
// viaphi · lensview. Returns true when handled. THE BOUNDARY (by design, not convenience): the
// OPTICS sector (record/relift/swap/boot/kill/store/recall/go/tex/cseed/aphase/edge/leak/ear/hold/
// mirror/mux/selfclock) stays medium-side — those verbs ARE the physics (GPU fields, att bytes,
// coupling graph, beat clocks); the core knows THAT observers have descriptors and dials, never what
// the optics does. Bodies verbatim from medium.js's drain (logs included — they are the bench UX).
export function applySettingsVerb(vq, k, ops, dials) {
  if (vq.mode === 'lensset') { const SNI = { W: 0, V: 1, P1: 2, P2: 3 }, si = SNI[vq.src] ?? 0, o = ops[si];
    // READ-SIDE ONLY (the declared honesty boundary): the metric/tilt sector shapes what the observer SEES
    // (chainSee, view:∠lens, compose predictions) — the DYNAMICS (pin/hold/leash) still consume only the U(1)
    // phase. Making the resample act on the stored att = a REAL operator transform = its own chapter, own gates.
    o.kx = vq.kx || 0; o.ky = vq.ky || 0;
    const rr = vq.rot || 0, ss = (typeof vq.scl === 'number' && vq.scl > 0) ? vq.scl : 1, cr = Math.cos(rr), sr = Math.sin(rr);
    o.A = [ss * cr, -ss * sr, ss * sr, ss * cr]; o.tx = vq.tx || 0; o.ty = vq.ty || 0;
    const mA = ss !== 1 || rr !== 0 || !!o.tx || !!o.ty, mK = !!(o.kx || o.ky);
    o.mode = mA ? (mK ? 'gauge' : 'metric') : (mK ? 'phase' : 'id');
    console.log(`[LENSSET] ${['W','V','P1','P2'][si]} readOp ← mode=${o.mode} k=(${o.kx},${o.ky}) rot=${rr.toFixed(3)} scl=${ss} t=(${o.tx},${o.ty}) atStep=${k} — read-side lens (meters/render see through it; dynamics untouched)`);
    return true; }
  if (vq.mode === 'viaphi') { dials.viaPhi = (typeof vq.amp === 'number') ? vq.amp : 0.5; return true; }   // the ⎙viaφ dial position (replicated UI state; the recvia verb still carries its angle explicitly)
  if (vq.mode === 'lensview') { dials.lensView = !dials.lensView;
    console.log(`[LENSVIEW] ${dials.lensView ? 'ON — slot panels render THROUGH each slot\'s own readOp (lensU1.apply — the same operator the meters measure)' : 'OFF — raw gauge view'} atStep=${k}`);
    return true; }
  if (vq.mode === 'lenstau') { const lw = (typeof vq.amp === 'number') ? vq.amp : 0; for (const o of ops) o.omega = lw;   // the verb is global today — all descriptors move together
    console.log(`[LENSTAU] ω=${lw.toFixed(3)} rad/beat atStep=${k} — ${lw ? 'each slot\'s pin reference now precesses per ITS OWN slot-beat: regRead Δφ(i,j) → ω·(τ_i−τ_j) (the register as clock comparator)' : 'precession OFF'}`);
    return true; }
  if (vq.mode === 'refamp') { const SNI = { W: 0, V: 1, P1: 2, P2: 3 }, si = SNI[vq.src] ?? 0, mv = (typeof vq.amp === 'number') ? vq.amp : 1;
    ops[si].beta = mv;
    console.log(`[REFAMP] ${['W','V','P1','P2'][si]} pin ×${mv.toFixed(2)} atStep=${k} — the pinning gravity h_${['W','V','P1','P2'][si]}; watch the equilibrium angle shift`);
    return true; }
  return false;
}

// ── STAGE C1: THE STEP CLOCK — matter proper-time pacing as a core value ────────────────────────
// The (c0, rate, ratePrev) trio and its two laws (§7.44, both live-hardened in the mux arc):
//   target(mon)     = floor((mon − c0)·spp / rate) — the step budget: under an nSl-way mux, matter
//                     runs at 1/nSl proper rate, so the demanded steps divide by rate (the fix for
//                     the backlog spiral: the wall must not out-demand the medium's own time).
//   reanchor(k, r)  — a rate flip keeps the step count CONTINUOUS at shared step k:
//                     c0 += k·(rateOld − rateNew)/spp — a pure fn of shared k + shared rates →
//                     byte-identical c0 on every peer. Returns true only when the rate changed
//                     (the caller then re-stamps its queues — the kernel's reanchor, gate 3/L5).
// The executed-step COUNTER (_solSteps) deliberately stays medium-side: it counts real GPU work
// (matter), not schedule — the clock knows the budget law, never what a step does.
export function makeStepClock({ stepsPerPhase = 19 } = {}) {
  const C = {
    c0: 0, rate: 1, ratePrev: 1, spp: stepsPerPhase,
    target: (mon) => Math.floor((mon - C.c0) * C.spp / C.rate),
    reanchor: (k, r) => { if (r === C.ratePrev) return false;
      C.c0 = C.c0 + (k * (C.ratePrev - r)) / C.spp; C.ratePrev = r; C.rate = r; return true; },
  };
  return C;
}


// ── STAGE C3: THE V-SECTOR VERB TABLE — the optics verbs behind a stores contract ────────────────
// The remaining ⎙virt branches (relift/swap/mirror/mux/go/boot/kill/ear/leak/hold/store/recall/
// selfclock/aphase/record/recvia/recordraw + unknown→record) moved here VERBATIM from medium.js's
// _virtVerb (the C2 state object made the contract small). S = the stores contract:
//   V         the virt-sector state object (C2)         ops/dials  the observer bank + UI dials
//   gpu       the live GPU handle (getter — set late)    tauK       the τ kernel (or null)
//   VIRT_T/DT/PHASE_MAX/BANK_MAX                         torbE0     W's energy budget (get/set — swap trades it)
//   attF32/aphNorm/ampCorr/lockSweep/goCarrier/vLeashReset/tauReset/earVInit   medium helpers (call-time)
// io = { att(), rebuildW() } — the drive branch's block-scoped pieces (per-mode W rebuild).
// RESIDUE, by design: tex/cseed (probe sector) and edge (coupling sector) return false — their state
// (texSpec/clkSpec/kEdge/kSrc) stays medium-side; the dispatcher in medium.js handles them and calls
// _muxReanchor after EVERY drained verb, exactly as before. Logs verbatim (they are the bench UX).
export function applyVirtVerb(vq, k, S, io) {
  const LOPN = { W: 0, V: 1, P1: 2, P2: 3 };
            if (vq.mode === 'relift') { if (S.V.virtHolo) { const qs = S.gpu.readEyePsi();
              S.gpu.setEyePsi(S.V.virtHolo); S.gpu.stepEyeN(S.VIRT_T, -S.DT); S.V.psiVirt = S.gpu.readEyePsi();
              let ve = 0; for (let j = 0; j < S.V.psiVirt.length; j++) ve += S.V.psiVirt[j] * S.V.psiVirt[j]; S.V.virtE0 = ve || 1;
              S.gpu.setEyePsi(qs); S.vLeashReset(); console.log(`[VIRT] RELIFT atStep=${k} — V resumed from the plate (time-travel to the recorded moment)`); } }
            else if (vq.mode === 'swap') { if (S.V.psiVirt) { const w = S.gpu.readEyePsi();
              S.gpu.setEyePsi(S.V.psiVirt); S.V.psiVirt = w;
              const t = S.torbE0; S.torbE0 = S.V.virtE0; S.V.virtE0 = t;
              S.V.virtAtt = S.attF32(io.att()); S.ops[1].phase = S.ops[1].prec = 0;   // the new dream (old W) holds at the att it was living under (f32-quantized: snapshot parity); fresh operator → fresh ledger
              S.vLeashReset();
              console.log(`[VIRT] SWAP atStep=${k} — the virtual world is now REAL (drive continues on it); the old world is now the dream`); } }
            else if (vq.mode === 'mirror') { S.V.virtMirror = !S.V.virtMirror;
              console.log(`[VIRT] MIRROR ${S.V.virtMirror ? 'ON — V now receives the same operator drive as W (V⊗ = the Lyapunov readout)' : 'OFF — V free-runs (counterfactual)'} atStep=${k}`); }
            else if (vq.mode === 'mux') { S.V.virtMux = !S.V.virtMux;
              console.log(`[VIRT] MUX ${S.V.virtMux ? 'ON — W and V now time-share the ONE substrate (§7.44: 21-step clock-phase slices, each world at half proper rate)' : 'OFF — V returns to parallel frame time'} atStep=${k}`); }
            // M3 — RECALL AS LOCK-SWEEP (the content-addressable clock, built ONLY from the proven primitives:
            // record = condensation, bind = the lock, lift = the reversed round-trip). store banks a plate of the
            // CURRENT W; recall records the current W as a CUE plate and binds it against the bank IN PLATE SPACE
            // (record is near-unitary → plate-space corr ≈ field-space corr; the deviation is the op's own
            // non-unitarity), then lifts the argmax plate into V: the cue selects WHICH recorded moment resumes.
            else if (vq.mode === 'go') { const c = S.goCarrier(vq.src);   // command the STAMPED carrier (the injector's eye selection at press time)
              if (!c.att) console.log(`[VIRT] GO — the selected phase has no recorded operator to steer (stored without att)`);
              else if (vq.gx === 0 && vq.gy === 0 && c.go && Math.round(c.gx) === 0 && Math.round(c.gy) === 0) { c.go = false;   // virtGo(0,0) at home = hand back to hold/free (clean exit from independent mode)
                console.log(`[VIRT] GO OFF atStep=${k} — the phase is home; independent command released (back to hold/free)`); }
              else { c.go = true; c.tx = vq.gx || 0; c.ty = vq.gy || 0; c.l0 = 0; c.lt = -1; c.lk = 0;   // re-learn the leash baseline for the new journey; lt=-1 = command-fresh → the first advance fires immediately even from a beat-dead slot
                console.log(`[VIRT] GO atStep=${k} — ${vq.src} chases its OWN target (${c.tx},${c.ty}) from (${c.gx.toFixed(1)},${c.gy.toFixed(1)}), lock-leashed (endogenous percept control)`); } }
            else if (vq.mode === 'boot') { const b = S.V.virtBank[vq.slot|0];   // M4: lift a bank plate into a LIVE phase slot
              if (!b) console.log(`[VIRT] BOOT — no plate ${vq.slot|0} in the bank (virtStore() first)`);
              else if (S.V.phases.length >= S.PHASE_MAX) console.log(`[VIRT] BOOT — phase slots full (${S.PHASE_MAX})`);
              else { const qs = S.gpu.readEyePsi();
                S.gpu.setEyePsi(b.p); S.gpu.stepEyeN(S.VIRT_T, -S.DT); const pf = S.gpu.readEyePsi();
                let pe = 0; for (let j = 0; j < pf.length; j++) pe += pf[j] * pf[j];
                S.V.phases.push({ psi: pf, e0: pe || 1, att: b.a ? b.a.slice(0) : null, kv: 0, src: vq.slot|0, go: false, tx: 0, ty: 0, gx: 0, gy: 0, ll: 1, l0: 0, lt: 0, lk: 0 });   // leash fields — a booted phase is commandable too (virtGo targets the eye-selected phase); lt/lk = the τ_i leash-cadence cursor
                S.ops[S.V.phases.length + 1].phase = S.ops[S.V.phases.length + 1].prec = 0;   // fresh operator in this slot → fresh ledger
                S.gpu.setEyePsi(qs);
                const nw = 1 + (S.V.psiVirt ? 1 : 0) + S.V.phases.length;
                console.log(`[VIRT] BOOT atStep=${k} — plate ${vq.slot|0} lifted into phase P${S.V.phases.length}${b.a ? ' (held at its own recorded operator)' : ' (no stored att — it will free-run and die: honest)'} · ${nw}-way clock, each world at 1/${nw} proper rate`); } }
            else if (vq.mode === 'kill') { const px = S.V.phases.pop(); if (px) S.ops[S.V.phases.length + 2].phase = S.ops[S.V.phases.length + 2].prec = 0;   // the slot's operator is gone → clear its ledger
              console.log(px ? `[VIRT] KILL atStep=${k} — phase P${S.V.phases.length + 1} released (the field is gone; its plate remains in the bank)` : '[VIRT] KILL — no booted phases'); }
            else if (vq.mode === 'ear') { S.V.earVOn = !S.V.earVOn; S.V.kvSteps = 0;
              if (S.V.earVOn) S.earVInit(); else S.V.earV = null;
              console.log(`[EAR-V] ${S.V.earVOn ? 'ON — ears in the DREAM: 8 CFAR posts ring V\'s operator, clocked in kV (fresh warmup)' : 'OFF'} atStep=${k}`); }
            else if (vq.mode === 'leak') { S.V.virtLeak = vq.leak || 0;
              console.log(`[VIRT] LEAK κ=${S.V.virtLeak} atStep=${k} — ${S.V.virtLeak > 0 ? 'the phase isolation is now imperfect: ψ_V += κ·ψ_W at shared boundaries (⧉mux only — the dream hears the world faintly)' : 'phases perfectly isolated again'}`); }
            else if (vq.mode === 'hold') { S.V.virtHold = !S.V.virtHold;
              console.log(`[VIRT] HOLD ${S.V.virtHold ? 'ON — V is driven toward its RECORDED att (a world parked at the remembered moment; the live-memory view)' : 'OFF — V free-runs (counterfactual)'} atStep=${k}`); }
            else if (vq.mode === 'store') { const wS = S.gpu.readEyePsi();
              S.gpu.stepEyeN(S.VIRT_T, S.DT); const pl = S.gpu.readEyePsi(); S.gpu.setEyePsi(wS);
              S.V.virtBank.push({ p: pl, a: S.attF32(io.att()), k, lop: { ...S.ops[0] }, bw: S.tauK ? (S.tauK.beatsOf('W') ?? 0) : 0 });   // the moment = (ψ-plate, operator) — dual-layer memory (att f32-quantized: snapshot parity)
              if (S.V.virtBank.length > S.BANK_MAX) S.V.virtBank.shift();
              console.log(`[VIRT] STORE atStep=${k} — plate ${S.V.virtBank.length}/${S.BANK_MAX} banked (hologram of this moment; recall is content-addressed)`); }
            else if (vq.mode === 'recall') { if (!S.V.virtBank.length) console.log(`[VIRT] RECALL atStep=${k} — bank empty (virtStore() first)`);
              else { const wS = S.gpu.readEyePsi();
                S.gpu.stepEyeN(S.VIRT_T, S.DT); const cue = S.gpu.readEyePsi();
                const { scores: _rsc, best } = S.lockSweep(cue, S.V.virtBank.map(b => b.p), S.ampCorr); const tbl = _rsc.map(s => s.toFixed(3));   // M3: the one recall primitive (plate-space bind)
                S.gpu.setEyePsi(S.V.virtBank[best].p); S.gpu.stepEyeN(S.VIRT_T, -S.DT); S.V.psiVirt = S.gpu.readEyePsi();
                let ve = 0; for (let j = 0; j < S.V.psiVirt.length; j++) ve += S.V.psiVirt[j] * S.V.psiVirt[j]; S.V.virtE0 = ve || 1;
                S.V.virtAtt = S.V.virtBank[best].a || S.V.virtAtt; if (S.V.virtBank[best].a) S.ops[1].phase = S.ops[1].prec = 0;   // recall the moment's OPERATOR too (hold drives V with it); replaced → fresh ledger
                S.gpu.setEyePsi(wS); S.vLeashReset();
                console.log(`[VIRT] RECALL atStep=${k} — cue⊗bank=[${tbl.join(', ')}] → plate ${best + 1} (stored atStep=${S.V.virtBank[best].k}) lifted into V — the cue selected WHICH moment`);
                const _bl = S.V.virtBank[best].lop; if (_bl) { const _dN = (S.V.virtBank[best].bw != null && S.tauK) ? (S.tauK.beatsOf('W') ?? 0) - S.V.virtBank[best].bw : null;   // W-beat aging across the window (self-check: Δ∠ = ω·ΔN_W when only precession separates the moments)
                  console.log(`[RECALL-∠] plate frame ∠=${lensU1.angle(_bl).toFixed(3)} vs W now ∠=${lensU1.angle(S.ops[0]).toFixed(3)} → observer shift Δ=${lensU1.wrap(lensU1.angle(S.ops[0]) - lensU1.angle(_bl)).toFixed(3)} rad${_dN != null ? ` · Δτ_W=${_dN} beats${S.ops[0].omega ? ` → ω·Δτ=${lensU1.wrap(S.ops[0].omega * _dN).toFixed(3)} predicted (ω constant over the window)` : ''}` : ''} — the observer-relative recall readout (Δ=0 with a parked W is the stay-home twin's honest null)`); } } }
  else if (vq.mode === 'tex' || vq.mode === 'cseed' || vq.mode === 'edge') return false;   // RESIDUE: the probe (tex/cseed) + coupling (edge) sectors stay medium-side — their state does too
            // M-c2 — SELF-CLOCK toggle: the mux gate rotates on lock-ripple BEATS (see _selfClkTick)
            else if (vq.mode === 'selfclock') { S.V.selfClk = S.V.selfClk ? null : { bar: [0, 0, 0, 0], prev: [0, 0, 0, 0], beats: 0, lastK: k };
              if (S.V.selfClk) S.tauReset(k); else if (S.tauK) S.tauK.resetClocks();   // fresh beat state → fresh τ; toggle OFF → clocks ABSENT → kernel gates unconditional (coordinate dispatch, the no-op form)
              console.log(`[SELFCLK] ${S.V.selfClk ? "ON — the mux rotates on the medium's heartbeat (lock-ripple beats; beat-clamped: refractory ≥21, watchdog 84)" : 'OFF — back to the ⌊k/21⌋ counter'} atStep=${k}`); }
            // (the SETTINGS sector — lensset/lenstau/refamp/viaphi/lensview — is handled by applySettingsVerb at the
            //  top of _virtVerb, stage B2: pure bank/dial writes live in medium-core.js; the branches below are the
            //  OPTICS sector — GPU fields, att bytes, coupling, clocks — the physics that stays medium-side by design.)
            // M-a″/M-b — OPERATOR-SIDE REGISTER WRITE, per SLOT: rotate the target operator's U(1) phase; that
            // phase's own drive re-locks its field to the rotated reference (~1 bar) and HOLDS it — the M-a′ eraser
            // inverted into retention. W = the live rebuild hook (S.ops[0].phase); V/P1/P2 = one-time rotation of the
            // STORED att (a static field — hold/chase re-locks the phase's field during its own slices/frames).
            else if (vq.mode === 'aphase') { const sl = vq.src || 'W', aA = vq.amp || 0;
              if (sl === 'W') { S.ops[0].phase = ((S.ops[0].phase + aA) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
                io.rebuildW();   // mode-specific W-operator rebuild (transport: _rebuildAtt + setObjField; objorbit: _oorbAtt(k)) — the ONE functional divergence the pre-unification diff found
                console.log(`[APHASE] atStep=${k} — W att phase += ${aA.toFixed(3)} → total ${S.aphNorm(S.ops[0].phase).toFixed(3)} rad (the drive HOLDS W at this reference)`); }
              else { const ph = sl === 'V' ? null : S.V.phases[sl === 'P1' ? 0 : 1];
                const tgt = sl === 'V' ? S.V.virtAtt : (ph ? ph.att : null);
                if (!tgt) console.log(`[APHASE] ${sl} has no stored operator to rotate (record/boot with att first)`);
                else { const c = Math.cos(aA), s = Math.sin(aA), r = new Float64Array(tgt.length);
                  for (let j = 0; j < tgt.length; j += 2) { r[j] = tgt[j]*c - tgt[j+1]*s; r[j+1] = tgt[j]*s + tgt[j+1]*c; }
                  const qz = S.attF32(r);   // f32-requantize: snapshot parity (this att is read CPU-side by the leash lock)
                  if (sl === 'V') S.V.virtAtt = qz; else ph.att = qz;
                  S.ops[LOPN[sl]].phase = S.aphNorm(S.ops[LOPN[sl]].phase + aA);   // drain-time ledger: the meter counts only rotations that LANDED (shared step → replicated)
                  console.log(`[APHASE] atStep=${k} — ${sl} att phase += ${aA.toFixed(3)} rad (register ${sl}; the θ meter reads φ_W − φ_ref — a differential read)`); } } }
            else { const wSave = S.gpu.readEyePsi(); const _hadV = !!S.V.psiVirt;   // _hadV: was there already a V? → this is a RE-record, not V's birth
              // step 4 — RECORD THROUGH A LENS ('recvia', amp=φ): the trap is born IN the rotated gauge frame — field,
              // plate and operator rotated TOGETHER, descriptor phase = φ at birth (vs record+aphase = write-then-relock,
              // a dynamical transient). U(1) invariance commutes the rotation past propagation → applied CPU-side after
              // the optical steps, no extra GPU passes; pure math at the shared drain step → replicated. φ=0 ≡ record.
              const _rvA = (vq.mode === 'recvia') ? (vq.amp || 0) : 0, _rvOp = { mode: 'id', phase: _rvA, beta: 1, omega: 0, prec: 0 };
              S.V.virtAtt = S.attF32(_rvA ? lensU1.apply(_rvOp, io.att()) : io.att()); S.ops[1].phase = _rvA ? S.aphNorm(_rvA) : 0; S.ops[1].prec = 0;   // operator rotated WITH the view (gauge-consistent); the descriptor phase IS the birth lens; fresh prec
              S.gpu.stepEyeN(S.VIRT_T, S.DT);  S.V.virtHolo = S.gpu.readEyePsi();      // RECORD: the hologram (the plate)
              S.gpu.stepEyeN(S.VIRT_T, -S.DT); S.V.psiVirt  = S.gpu.readEyePsi();      // LIFT: reversed clock → live copy
              if (_rvA) { S.V.virtHolo = lensU1.apply(_rvOp, S.V.virtHolo); S.V.psiVirt = lensU1.apply(_rvOp, S.V.psiVirt); }   // plate + live copy into the observer's frame (energy-preserving; S.ampCorr fidelity below is U(1)-invariant → still honest)
              let ve = 0; for (let j = 0; j < S.V.psiVirt.length; j++) ve += S.V.psiVirt[j] * S.V.psiVirt[j]; S.V.virtE0 = ve || 1;
              S.gpu.setEyePsi(wSave); S.vLeashReset();
              if (!_hadV && vq.mode !== 'recordraw') {   // DEFAULT MUX→HOLD→SELFCLOCK only at V's BIRTH via the normal ⎙virt (first press), IN THAT ORDER: mux
                S.V.virtMux = true;    // establishes the time-share FIRST, hold pins V, THEN selfClock takes the mux onto the medium's heartbeat. selfClock
                S.V.virtHold = true;   // seeds its own per-slot beat baseline on first sample + has a watchdog, so birth-time enable is self-handling (the earlier
                if (!S.V.selfClk) { S.V.selfClk = { bar: [0, 0, 0, 0], prev: [0, 0, 0, 0], beats: 0, lastK: k }; S.tauReset(k); }   // shift disruption was the _stampStep clock regression, since fixed — NOT selfClock). Only if not already on (don't reset a running beat state).
              }                     // A re-record must not re-toggle these; 'recordraw' (snap⇢V) skips ALL defaults.
              console.log(`[VIRT] ${_hadV ? 're-recorded' : 'recorded'}+lifted atStep=${k}${_rvA ? ` · THROUGH LENS φ=${_rvA.toFixed(3)} rad (trap born in the rotated frame)` : ''} · lift fidelity vs W = ${S.ampCorr(S.V.psiVirt, wSave).toFixed(4)} (linear round-trip, T=${S.VIRT_T})${_hadV ? ' · hold/mux unchanged (re-record)' : ' · HOLD+MUX default ON (V birth)'}`); }
  return true;
}


// ── STAGE C4: THE MUX CLOCKS + THE COUPLING STORE — the scheduler's LAWS (the orchestration stays medium) ──
// _muxVirtualStep itself deliberately STAYS in medium.js: it is ~15 lines of scheduling law wrapped around
// ~70 lines of physics orchestration (pin superpose with mux-rate compensation, CGL step, energy caps, leak,
// ears, leashes, beat ticks — thirteen physics callbacks). Moving the body would drag the physics through the
// contract and the core would "know why the medium ticks". What IS the core's: the laws below.
//
// muxClocks — the TWO-CLOCK structure (2026-07-07 interleave fix, live-hardened):
//   ph    = k % nSl                 FINE buffer-ownership clock: every slot advances once per nSl steps,
//                                   round-robin — every panel repaints every frame (no freeze).
//   capPh = beats % nSl (selfClock) COARSE coupling/τ clock: capture and beat events ride the BEAT slot,
//         | ⌊k/flat⌋ % nSl (off)    not the fine rotation — the stabilized edge determinism.
// Call AFTER the watchdog beat increment so a watchdog beat lands in the same step's capPh.
export const muxClocks = (k, nSl, beats = null, flatSlice = 21) => ({
  ph: k % nSl,
  capPh: (beats != null) ? (beats % nSl) : (Math.floor(k / flatSlice) % nSl),
});

// makeCouplingStore — the edge matrix + the CAPTURE LAW (three live forks to stabilize; doc §12):
//   setEdge(a,b,κ)      symmetric write; creates the matrix lazily; collapses to null when all-zero;
//                       ALWAYS invalidates the capture cursor (capPh = −1 → a clean capture at the next
//                       genuine coarse-clock change). Returns false only for self-coupling (a === b).
//   shouldCapture(capPh) TRUE only when edges exist AND the coarse clock genuinely changed — NEVER keyed
//                       on buffer-ownership state (the peer-local frame-end park corrupted that, both ways).
//   capture(fields,k,ph) freezes .slice() copies of the CANONICAL stores into src; indices beyond the
//                       passed array stay untouched (exact legacy semantics — a killed phase's old source
//                       persists until the edge matrix says otherwise).
// The APPLICATION of the coupling (ψ += Σκ·src — calibrated physics) stays medium-side (_kApply).
export function makeCouplingStore() {
  const K = {
    edge: null, capPh: -1, capStep: -1, src: [null, null, null, null],
    reset: () => { K.edge = null; K.capPh = -1; K.src[0] = K.src[1] = K.src[2] = K.src[3] = null; },
    setEdge: (a, b, kk) => { if (a === b) return false;
      if (!K.edge) K.edge = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      K.edge[a][b] = kk; K.edge[b][a] = kk;
      if (!K.edge.some((r) => r.some((v) => v))) K.edge = null;
      K.capPh = -1; return true; },
    shouldCapture: (capPh) => !!K.edge && K.capPh !== capPh,
    capture: (fields, k, capPh) => { for (let i = 0; i < fields.length && i < 4; i++) K.src[i] = fields[i] ? fields[i].slice() : null;
      K.capStep = k; K.capPh = capPh; },
  };
  return K;
}


// ── THE CHAIN METER (generalized from medium.js's chainRead/chainSee — ONE meter, every app) ─────
// chainMeter(slots, { G, through }) — slots = [{ name, field, op }] with field = interleaved [re,im]
// and op = the observer descriptor. Links are pairwise overlaps ⟨ψ_a|ψ_b⟩ (gauge-invariant,
// amplitude-weighted → composition is MEASURED, not an identity). Two modes:
//   raw (through=false): fields as they are; each link carries pred (the operator-authored part,
//        lensU1.link) and mdl = measured − pred (constant = construction-phase difference — watch
//        its DRIFT); plus algDefect (≡0, the abelian contract printed beside the measured ε).
//   through=true: each field first read THROUGH its own op (lensU1.apply, needs G for the metric
//        sector) — the u-register's ψ_out = Op·ψ_in semantics; no pred (the descriptor is PART of
//        the measurement); modes[] reported instead.
// Pure fn of its inputs — peer-local meters built on it match across peers at equal step.
export function chainMeter(slots, { G = 0, through = false } = {}) {
  if (!slots || slots.length < 2) return null;
  const flds = through ? slots.map((s) => lensU1.apply(s.op, s.field, G)) : slots.map((s) => s.field);
  const n = flds[0].length >> 1;
  const ov = (a, b) => { let re = 0, im = 0, ea = 0, eb = 0;
    for (let i = 0; i < n; i++) { const ar = a[i * 2], ai = a[i * 2 + 1], br = b[i * 2], bi = b[i * 2 + 1];
      re += ar * br + ai * bi; im += ar * bi - ai * br; ea += ar * ar + ai * ai; eb += br * br + bi * bi; }
    return { dphi: Math.atan2(im, re), vis: (ea && eb) ? Math.hypot(re, im) / Math.sqrt(ea * eb) : 0 }; };
  const links = []; let sum = 0, visP = 1;
  for (let i = 0; i + 1 < slots.length; i++) { const o = ov(flds[i], flds[i + 1]);
    const L = { a: slots[i].name, b: slots[i + 1].name, dphi: +o.dphi.toFixed(4), vis: +o.vis.toFixed(4) };
    if (!through) { const pred = lensU1.link(slots[i].op, slots[i + 1].op); L.pred = +pred.toFixed(4); L.mdl = +lensU1.wrap(o.dphi - pred).toFixed(4); }
    links.push(L); sum += o.dphi; visP *= o.vis; }
  const comp = ov(flds[0], flds[flds.length - 1]);
  const composed = { a: slots[0].name, b: slots[slots.length - 1].name, dphi: +comp.dphi.toFixed(4), vis: +comp.vis.toFixed(4) };
  if (!through) { const cp = lensU1.link(slots[0].op, slots[slots.length - 1].op); composed.pred = +cp.toFixed(4); composed.mdl = +lensU1.wrap(comp.dphi - cp).toFixed(4); }
  const out = { links, composed, sum: +sum.toFixed(4), defect: +lensU1.wrap(sum - comp.dphi).toFixed(4), visProduct: +visP.toFixed(4) };
  if (!through) out.algDefect = +(lensU1.chain(slots.map((s) => s.op))?.defect ?? 0).toFixed(4);
  else out.modes = slots.map((s) => s.op.mode);
  return out;
}

export function makeObserverBank(n = 4) {
  const ops = Array.from({ length: n }, () => lensU1.id());
  const sane = (o, s) => { const d = lensU1.id(); s = s || {};
    o.mode = (typeof s.mode === 'string') ? s.mode : d.mode;
    o.phase = NUM(s.phase, 0); o.beta = NUM(s.beta, 1); o.omega = NUM(s.omega, 0); o.prec = NUM(s.prec, 0);
    o.kx = NUM(s.kx, 0); o.ky = NUM(s.ky, 0); o.tx = NUM(s.tx, 0); o.ty = NUM(s.ty, 0);
    o.A = (Array.isArray(s.A) && s.A.length === 4 && s.A.every((v) => typeof v === 'number' && Number.isFinite(v))) ? [...s.A] : [1, 0, 0, 1]; };
  const reset = () => { for (const o of ops) sane(o, null); };
  const save = () => ops.map((o) => ({ ...o, A: [...(o.A || [1, 0, 0, 1])] }));
  const restore = (snap) => { if (!Array.isArray(snap) || snap.length !== n) return false;
    for (let i = 0; i < n; i++) sane(ops[i], snap[i]); return true; };
  const restoreLegacy = ({ attPhase, lensTau, aphEng, refAmp } = {}) => { reset();
    ops[0].phase = NUM(attPhase, 0);
    const lw = NUM(lensTau, 0); for (const o of ops) o.omega = lw;
    const ae = aphEng || {};
    if (ops[1]) ops[1].phase = NUM(ae.V, 0); if (ops[2]) ops[2].phase = NUM(ae.P1, 0); if (ops[3]) ops[3].phase = NUM(ae.P2, 0);
    for (let i = 0; i < n; i++) ops[i].beta = Array.isArray(refAmp) ? NUM(refAmp[i], 1) : 1; };
  return { ops, reset, save, restore, restoreLegacy };
}

// makeStampedInput(tauK, name, opts) — THE STAMPED REPLICATED-INPUT pattern (the general field-determinism law,
// [[finding_mux_determinism]] / gate-3), factored out of the medium apps. An external input (UI slider, verb, mode)
// is REPLICATED through the reflector as a monotonic seq'd LOG on a world node; every peer must apply each entry at
// the SAME shared step, NOT "whenever this peer's frame reads the latest" (that forks the field on peer-local timing).
//
// This wraps a kwe-tau queue (which owns stamp/drain/epoch — the τ kernel) with the boilerplate every consumer repeats:
//   • a SEQ CURSOR so a re-read of the (truncated, monotonic-seq) log pushes only NEW entries once;
//   • pull(logArray, mapEntry) — push new entries (seq > cursor) into the queue, stamping each to its shared step;
//   • drain(k, apply) — apply every entry whose stamped startStep step k has reached (delegates to the tauK queue);
//   • saveCursor()/restoreCursor(v) + reattach() — the join codec (the tauK queue RECORD is replaced by tauK.restore,
//     so the handle must be re-made; the pending entries ride tauK.save, only the cursor is app-serialized).
//
// The DRAIN QUEUE lives in kwe-tau (medium-agnostic: knows THAT a worldline stamps, never WHY). The PULL/CURSOR/JOIN
// boilerplate is the distributed-MEDIUM layer → it lives here. Each app then writes one .pull()/.drain() per input
// instead of the 4-block dance. (The IFS-kernel swap deliberately does NOT use this — its far-behind cold-snap +
// version dedup + cross-slot replay are kernel-specific; forcing them through here would leak special-cases.)
export function makeStampedInput(tauK, name, { clock = null } = {}) {
  let q = tauK ? tauK.makeQueue(name, { clock }) : null;
  let seen = 0;
  return {
    // PULL new replicated entries into the stamped queue. `log` = the node's replicated array (each entry {seq, time,
    // …payload}); `mapEntry(e)` returns the queue entry to push (MUST carry `t` = the verb's replicated time so the
    // kernel can stamp it; may add any payload fields the apply() consumes). Cursor guards against double-push on re-read.
    pull(log, mapEntry) { if (!q || !Array.isArray(log)) return 0; let n = 0;
      for (const e of log) { const s = e.seq | 0; if (s > seen) { const m = mapEntry(e); if (m) { if (m.t == null) m.t = e.time ?? 0; m.seq = s; q.push(m); n++; } seen = s; } }
      return n; },
    // DRAIN at the shared step k (delegates to the tauK queue's gate/epoch logic). apply(entry) runs in the drive loop.
    drain(k, apply) { return q ? q.drain(k, apply) : 0; },
    // JOIN CODEC: the cursor is app-serialized (the pending queue entries ride tauK.save/restore). After tauK.restore the
    // queue RECORD is replaced → reattach() re-makes the handle (it closed over the old record); restoreCursor sets seen.
    saveCursor() { return seen; },
    restoreCursor(v) { seen = v | 0; },
    reattach() { if (tauK) q = tauK.makeQueue(name, { clock }); },
    get length() { return q ? q.length : 0; },
    get seen() { return seen; },
  };
}
