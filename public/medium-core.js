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
  if (vq.mode === 'lenstau') { const lw = (typeof vq.amp === 'number') ? vq.amp : 0;
    // PER-SLOT when a src is given (the twin experiment needs DIFFERENT ω per worldline — each ages at its own rate);
    // GLOBAL (all slots) when src is absent, for back-compat with the old one-knob-moves-all form.
    if (vq.src === 'W' || vq.src === 'V' || vq.src === 'P1' || vq.src === 'P2') { const si = { W: 0, V: 1, P1: 2, P2: 3 }[vq.src]; if (ops[si]) ops[si].omega = lw;
      console.log(`[LENSTAU] ${vq.src} ω=${lw.toFixed(3)} rad/beat atStep=${k} — THIS worldline precesses per its OWN slot-beat (per-slot ω → differential aging: regRead Δφ(i,j) → ω_i·τ_i − ω_j·τ_j)`); }
    else { for (const o of ops) o.omega = lw;   // global: all descriptors move together (no src)
      console.log(`[LENSTAU] ω=${lw.toFixed(3)} rad/beat atStep=${k} (ALL slots) — ${lw ? 'each slot\'s pin reference precesses per ITS OWN slot-beat' : 'precession OFF'}`); }
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

// kuramotoStep(phases, edge, opts) — THE XY / KURAMOTO PHASE LAW as a pure function (extracted from medium-u1's
// register XY machine). Given N worldline phases and an N×N symmetric coupling matrix κ, return the per-slot phase
// INCREMENTS dθ_i = gain · Σ_j κ_ij · sin(θ_j − θ_i) — the classic Kuramoto/XY update (κ>0 aligns, κ<0 anti-aligns;
// a frustrated triangle κ_ij<0 ∀ settles at the ±2π/3 splay, continuously degenerate). The caller adds dθ to its own
// registers and wraps — this owns ONLY the increment math, so it is medium-agnostic (the phases may be register ∠, or
// register ∠ + a measured lock offset, or anything the app calls a worldline phase). Pure fn of (phases, edge) → in
// the determinism contract, byte-identical on peers.
//   phases  — number[] (θ_i). edge — the κ matrix (null → no coupling; edge[i][j] the pairwise κ, self κ ignored).
//   opts.gain  — a scalar multiplier on every increment (medium-u1: 3 under turbo = the Q-rate Euler equivalent,
//                1 otherwise). Default 1.
//   opts.born  — optional boolean[] (or predicate i→bool): a slot participates (as source AND sink) only if born.
//                Index 0 is ALWAYS live (the home worldline), matching the app convention. Default: all participate.
// Returns { dth: number[], any: bool } — dth[i] the increment for slot i (0 where uncoupled/unborn); any = did any
// edge contribute (the app's "did the machine run this bar" gate, e.g. for logging).
export function kuramotoStep(phases, edge, { gain = 1, born = null } = {}) {
  const n = phases.length, dth = new Array(n).fill(0);
  if (!edge) return { dth, any: false };
  const live = (i) => i === 0 || (born == null ? true : (typeof born === 'function' ? !!born(i) : !!born[i]));
  let any = false;
  for (let i = 0; i < n; i++) { if (!live(i)) continue;
    for (let j = 0; j < n; j++) { const kk = edge[i] && edge[i][j]; if (!kk || i === j || !live(j)) continue;
      any = true; dth[i] += gain * kk * Math.sin(phases[j] - phases[i]); } }
  return { dth, any };
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

// wrap2pi(x) — the register's phase-wrap to [0, 2π). NOTE this is DELIBERATELY DIFFERENT from lensU1.wrap (which is
// atan2(sin,cos) → (−π, π]): the thin apps' register aging accumulates phase in [0, 2π), and the two ranges are NOT
// interchangeable — swapping them would fork determinism. This is the exact formula the thin apps (rhythm/observers/
// ifsclock/selfhost) each defined locally; extracted so there is ONE definition (byte-identical, same arithmetic).
export const wrap2pi = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

// bankAge(bank, i, tauK, name, kp, kk, beat) — the SHARED register-aging idiom the phase-only thin apps repeat: on a
// slot's OWN beat, stamp the worldline clock (tauK.beat) and PRECESS the register by its ω (the W-convention: the
// phase absorbs its own precession, prec ≡ 0); otherwise advance the clock without a beat. A pure fn of (shared step,
// register state, the beat decision the app's OWN clock made) → replay-safe. Returns the beat boolean (for the app's
// per-beat bookkeeping — audio triggers, beatsOut lists, etc.). The app still OWNS the beat SOURCE (ripple/rhythm/
// host/IFS): this only unifies the "what to do WITH a beat" register step, never WHY the worldline ticked.
export function bankAge(ops, i, tauK, name, kp, kk, beat) {
  if (beat) { tauK.beat(name, kp, kk); ops[i].phase = wrap2pi(ops[i].phase + (ops[i].omega || 0)); }
  else tauK.advance(name, kp);
  return beat;
}

// makeRegisterReadout(ctx) — THE FULL U(1) REGISTER INTROSPECTION, shared by every app's `regPhase()`. A thin app
// is a U1 demo in thin mode, so it should expose the SAME register readout as the full medium — the field-specific
// parts simply absent. The UNIVERSAL register state (what EVERY U1 worldline carries regardless of its matter) is:
//   per slot: { name, angle (∠ = the U(1) charge), omega (ω precession rate), beta (β pin stiffness), beats (τ-beat
//              count), tau (proper time), born } — read from the app's register (lensU1 descriptors) + τ kernel;
//   top level: step (shared), kH (the τ-kernel determinism hash).
// The app adds only its MATTER-SPECIFIC extra (a content hash wH/gH/mH/vH, the full determinism regH, a lock
// coherence, a transport pos) via phase(extra). So medium-u1's "fuller" regPhase and the thin apps' compact one are
// now ONE readout at full fidelity — the thin apps stop hiding the register they already have.
//   ctx.tauK   — the proper-time kernel (beatsOf/tauOf/hash). Nullable (→ beats/tau 0, kH null).
//   ctx.names  — the worldline names, e.g. ['W','V','P1','P2'].
//   ctx.op(i)  — a getter → slot i's lens descriptor (the register element with .phase/.omega/.beta). Required for ∠.
//   ctx.born(i)— a getter → is slot i alive? (fields[i]!=null, or live[i], or slot.born). Default: all born.
//   ctx.step   — a getter (or value) → the current shared step.
// Returns { phase(extra = {}), slots() }.
//   slots() → the full per-slot register table [{ name, angle, omega, beta, beats, tau, born }] (the rich view).
//   phase(extra) → { step, kH, born:[live names], angle:[∠…], omega:[…], beta:[…], beats:[…], tau:[…], ...extra }
//                  — the flat regPhase shape, now carrying the universal register fields every U1 app shares.
// Pure telemetry (a fn of shared state) → NOT in the determinism contract; safe to shape freely.
export function makeRegisterReadout({ tauK, names, op = null, born = null, step }) {
  const angleOf = (i) => (op ? +lensU1.wrap(lensU1.angle(op(i))).toFixed(3) : 0);
  const omegaOf = (i) => (op ? +(op(i).omega || 0).toFixed(4) : 0);
  const betaOf = (i) => (op ? +(op(i).beta ?? 1).toFixed(3) : 1);
  const beatsOf = (nm) => (tauK ? (tauK.beatsOf(nm) ?? 0) : 0);
  const tauOf = (nm) => (tauK ? +tauK.tauOf(nm).toFixed(3) : 0);
  const isBorn = (i) => (born == null ? true : !!born(i));
  const slots = () => names.map((nm, i) => ({ name: nm, angle: angleOf(i), omega: omegaOf(i), beta: betaOf(i), beats: beatsOf(nm), tau: tauOf(nm), born: isBorn(i) }));
  return {
    slots,
    phase: (extra = {}) => ({
      step: (typeof step === 'function' ? step() : step) | 0,
      kH: tauK ? tauK.hash() : null,
      born: names.filter((nm, i) => isBorn(i)),
      angle: names.map((nm, i) => angleOf(i)),
      omega: names.map((nm, i) => omegaOf(i)),
      beta: names.map((nm, i) => betaOf(i)),
      beats: names.map((nm) => beatsOf(nm)),
      tau: names.map((nm) => tauOf(nm)),
      ...extra,
    }),
  };
}

// regHash(ctx) — THE U(1) REGISTER DETERMINISM HASH: the whole "what is in the contract" statement as a pure fn.
// A U1 world is byte-replicated iff every peer's register hashes identically at the same step, so this fixes the
// EXACT coordinate list that constitutes the contract: (shared step, clock rate) + the per-slot lens descriptors
// (opNums) + the per-slot dynamics flags (born · beats · leash go/gx/gy · desc-mode + its ω-time cursor descBar) +
// the coupling edges + the plate bank's descriptor copies. Anything NOT here is telemetry (may differ across peers);
// anything here MUST match. Extracted VERBATIM from medium-u1's _regH — the flat number order is load-bearing
// (hashNums is order-sensitive), so it is reproduced exactly; the app supplies only the accessors.
//   ctx.step  — the shared step (number). ctx.rate — the step-clock rate.
//   ctx.ops   — the lens descriptors [op,…] (hashed via opNums). ctx.slots — the slot objects (born/leash/desc/…).
//   ctx.edge  — the κ matrix (null → 16 zeros, the fixed 4×4 slot). ctx.plates — the hologram plates ({dop,bw}).
//   ctx.beatsOf(name) — the τ-beat count for a slot (or null-kernel → 0). ctx.slotName(s) — a slot's worldline name.
// Returns the 8-hex hash. BYTE-IDENTICAL to the inline _regH by construction (same sequence, same hashNums).
export function regHash({ step, rate, ops, slots, edge, plates, beatsOf, slotName = (s) => s.name }) {
  const nums = [
    step, rate,
    ...ops.flatMap((op) => opNums(op)),
    ...slots.flatMap((s) => [s.born ? 1 : 0, beatsOf ? (beatsOf(slotName(s)) ?? 0) : 0, s.leash.state.go ? 1 : 0, Math.round(s.leash.state.gx * 100), Math.round(s.leash.state.gy * 100), s.desc ? 1 : 0, s.descBar | 0]),
    ...(edge ? edge.flat() : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    plates.length, ...plates.flatMap((pl) => [...opNums(pl.dop), pl.bw | 0]),
  ];
  return hashNums(nums);
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  THE IFS-KERNEL ABCD SLICE (gate A of the metaplectic arc — the IFS-NATIVE low-k fit).
//
//  stepEye integrates  iψ_t = −½·L̂ψ  (Strang leapfrog: Re −= dt/4·L̂Im · Im += dt/2·L̂Re · Re −= dt/4·L̂Im),
//  where L̂ = lap9 + Σ_d ν_d(Σ_i S_{δ_di} − n_d·I), ν_d = 4·w_d/n_d — verbatim ifs-gpu's GLSL_LAP_FUNC/setRings,
//  re-derived here on the DESCRIPTOR side (keep in sync with the shader). L̂ is a CONVOLUTION → diagonal in k:
//  its exact symbol λ(k) is a CLOSED FORM of the ring descriptor (radii/weights/offsets). That is the IFS-native
//  fit: no GPU probe, no pixels — pure f64, recomputable at every fractal-clock kernel bump for free.
//
//  Plane wave e^{i(k·x − ωt)}:  ω(k) = −λ(k)/2  (phase advance per unit dt) · group velocity v_g = ∂ω/∂k.
//  LOW-k:  λ(k) ≈ −k^T·D·k + i·(k·s)  with  D = I₂ (lap9 is isotropic −|k|² to 4th order) + ½·Σ_d ν_d Σ_i δδ^T
//  and s = Σ_d ν_d Σ_i δ_i (the dipole — non-zero ⇔ non-centrosymmetric kernel ⇔ non-Hermitian k-odd gain; a
//  Hermiticity CHECK, expected ≈0 for ring kernels). So the medium's paraxial regime IS Schrödinger with mass
//  tensor D⁻¹, and the ABCD free block over T steps is [[I, D·T·dt],[0, I]] — the ±T hologram propagation
//  (stepEyeN is LINEAR: no SPM in the record/recall round-trips) becomes a closed-form register operation once
//  gate B validates the fit. D's principal axes are the measured axis-anisotropy signature, now DERIVED.
//
//  THE CLOCK IS ITS OWN LOW-PASS (the design note): a full ring's symbol is J₀-like — beyond k ≈ j₀,₁/r the
//  ring ANTI-couples and the symbol oscillates; the medium itself scrambles that band. So the quadratic fit is
//  valid exactly where the medium keeps states: compare kFit (the ±tol deviation knee, scanned along 4
//  directions) against kKnee = j₀,₁/r_max. kFit ≳ kKnee ⇒ the ABCD slice is exact FOR EVERY STATE THE CLOCK
//  PASSES — the fit discards only what the kernel itself discards.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// kernelSymbol(radii, weights, offs, kx, ky) — the EXACT symbol λ(k) of L̂ (re + im), closed form.
export function kernelSymbol(radii, weights, offs, kx, ky) {
  const cx = Math.cos(kx), cy = Math.cos(ky), cpq = Math.cos(kx + ky), cmq = Math.cos(kx - ky);
  let re = (4 * (2 * cx + 2 * cy) + 2 * cpq + 2 * cmq - 20) / 6, im = 0;   // lap9 (exact; → −|k|² at low k)
  for (let d = 0; d < (radii?.length || 0); d++) { const o = offs?.[d] || []; const n = o.length >> 1; if (!n) continue;
    const nu = 4 * (weights?.[d] ?? 0) / n; let cs = 0, sn = 0;
    for (let i = 0; i < n; i++) { const u = kx * o[i * 2] + ky * o[i * 2 + 1]; cs += Math.cos(u); sn += Math.sin(u); }
    re += nu * (cs - n); im += nu * sn; }
  return { re, im };
}

// kernelABCD(radii, weights, offs, { dt, T, tol }) — the low-k ABCD slice + its honest validity band.
export function kernelABCD(radii, weights, offs, { dt = 1, T = 1, tol = 0.05 } = {}) {
  let Dxx = 1, Dxy = 0, Dyy = 1, sx = 0, sy = 0, rMax = 0;   // D starts at I₂ (the lap9 term)
  for (let d = 0; d < (radii?.length || 0); d++) { const o = offs?.[d] || []; const n = o.length >> 1; if (!n) continue;
    const nu = 4 * (weights?.[d] ?? 0) / n;
    if ((radii?.[d] || 0) > rMax) rMax = radii[d];
    for (let i = 0; i < n; i++) { const x = o[i * 2], y = o[i * 2 + 1];
      Dxx += 0.5 * nu * x * x; Dxy += 0.5 * nu * x * y; Dyy += 0.5 * nu * y * y; sx += nu * x; sy += nu * y; } }
  // principal axes of D (symmetric 2×2) — the anisotropy signature, derived not probed
  const tr = Dxx + Dyy, df = Dxx - Dyy, disc = Math.sqrt(df * df + 4 * Dxy * Dxy);
  const D1 = (tr + disc) / 2, D2 = (tr - disc) / 2, theta = 0.5 * Math.atan2(2 * Dxy, df);
  // kFit: the largest |k| where the quadratic tracks the exact Re λ within tol, scanned along x/y/diagonals
  const dirs = [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];
  let kFit = Infinity;
  for (const [ux, uy] of dirs) { let kGood = 0;
    for (let k = 0.02; k <= Math.PI; k += 0.02) { const kxx = k * ux, kyy = k * uy;
      const ex = kernelSymbol(radii, weights, offs, kxx, kyy).re;
      const quad = -(Dxx * kxx * kxx + 2 * Dxy * kxx * kyy + Dyy * kyy * kyy);
      if (Math.abs(ex - quad) <= tol * Math.max(Math.abs(ex), Math.abs(quad), 1e-9)) kGood = k; else break; }
    if (kGood < kFit) kFit = kGood; }
  const kKnee = rMax > 0 ? 2.404825557695773 / rMax : Math.PI;   // j₀,₁/r_max — the clock's own low-pass knee
  const Bt = T * dt;                                             // the free block's duration (x' = x + D·k·T·dt)
  return {
    D: [Dxx, Dxy, Dyy], eig: { D1, D2, theta }, aniso: D2 !== 0 ? D1 / D2 : Infinity,
    drift: [sx, sy], hermitian: Math.hypot(sx, sy) < 1e-9,
    kFit, kKnee, rMax,
    abcd: { A: [1, 0, 0, 1], B: [Dxx * Bt, Dxy * Bt, Dxy * Bt, Dyy * Bt], C: [0, 0, 0, 0], Dm: [1, 0, 0, 1] },
    vg: (kx, ky) => [(Dxx * kx + Dxy * ky) * dt, (Dxy * kx + Dyy * ky) * dt],   // group velocity per step at tilt k
  };
}

// packetD(radii, weights, offs, sigma) — the PACKET-EFFECTIVE quadratic coefficient (gate B's lesson made a law):
// the k→0 quadratic over-predicts at packet bandwidth, so fit the EXACT dispersion ω(k) = −λ(k)/2 to (D̄/2)k²
// over the packet's OWN radial spectrum |ψ̂|²·k dk = e^{−k²σ²}·k dk — D̄ = ⟨ω·k²⟩/⟨k⁴/2⟩, direction-averaged
// (x/y/diagonal; the measured medium is near-isotropic). D̄(σ) → the k→0 D as σ → ∞. Pure f64, no GPU.
export function packetD(radii, weights, offs, sigma) {
  const dirs = [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2]];
  const kMax = 4 / sigma, n = 48; let num = 0, den = 0;
  for (let i = 1; i <= n; i++) { const k = kMax * i / n, wgt = Math.exp(-k * k * sigma * sigma) * k;
    let om = 0; for (const [ux, uy] of dirs) om += -0.5 * kernelSymbol(radii, weights, offs, k * ux, k * uy).re;
    om /= dirs.length;
    num += wgt * om * k * k; den += wgt * (k * k * k * k) / 2; }
  return den > 0 ? num / den : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  GATE C — THE q REGISTER (width σ + chirp b): the Gaussian collective coordinates, evolved by THE ENGINE'S
//  OWN RECIPE projected onto the ansatz. Meta-circular, not textbook: each abstract step IS the engine's Strang
//  split (stepEye linear · applyEyeNlSpm phase · applyEyeEnergyCap) evaluated on ψ = A·e^{−r²/2σ² + i b r²/2 + iφ}
//  (I(r) = I0·e^{−r²/σ²}, I0 = P/(πσ²), P = Σ|ψ|² — grid-sum units, cell = 1):
//   • LINEAR: the exact Gaussian law under iψ_t = −(D̄/2)∇²ψ — complex parameter w = 1/α, α = 1/σ² − i·b,
//     w ← w + i·D̄·dt (the ABCD B-block acting on q); Gouy φ̇ = −D̄/σ². D̄ = packetD(σ).
//   • SPM (shader semantics VERBATIM — applyEyeNlSpm(−γ,…) applies δφ(r) = +γ·I/(1+I/Isat)·dt): projected onto
//     the ansatz modes {1, r²} by INTENSITY-weighted least squares (u = r²/σ², weight e^{−u}: ⟨1⟩=⟨u⟩=1, ⟨u²⟩=2 →
//     slope β = ⟨u·g⟩−⟨g⟩, intercept a0 = ⟨g⟩−β): φ̇ += a0, ḃ += 2β/σ². CUBIC LIMIT closed form: β = −γI0/4 →
//     ḃ_NL = −γP/(2πσ⁴) — the classic 2D variational focusing term, RECOVERED not assumed.
//   • CAP: P ← e0 every step ⇒ P is a CONSTANT of the register.
//  b=0 balance F(σ) = D̄/σ⁴ + ḃ_NL(σ) = 0 → σ* (saturation arrests the Townes collapse — WHY the engine's
//  soliton is stable, now DERIVED); linearized breathing Ω = √(−D̄σ*F′(σ*)). Cubic limit: F is scale-free —
//  no σ* exists; P > P_c = 2πD̄/γ ⇒ collapse (F<0 everywhere), P < P_c ⇒ spread (F>0) — RUNAWAY and the
//  MINIMUM SOLITON POWER are register predictions now. The GPU oracle (mu1.qTest) measures all of it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// qSpmRate(sigma, P, gamma, isat) — the SPM projection rates: φ̇_NL = a0, ḃ_NL = rb (per unit t). Simpson
// quadrature over u ∈ [0, 40] (f64-deterministic; closed form only exists in the cubic limit — tested against it).
export function qSpmRate(sigma, P, gamma, isat) {
  const I0 = P / (Math.PI * sigma * sigma);
  const U = 40, n = 400; let m0 = 0, m1 = 0;
  for (let i = 0; i <= n; i++) { const u = U * i / n, w = (i === 0 || i === n) ? 1 : (i % 2 ? 4 : 2);
    const e = Math.exp(-u), g = gamma * I0 * e / (1 + I0 * e / isat);
    m0 += w * e * g; m1 += w * e * u * g; }
  const h = U / n / 3; m0 *= h; m1 *= h;
  const beta = m1 - m0;                       // LSQ slope on u (var(u) = 1 under the e^{−u} weight)
  return { a0: m0 - beta, rb: 2 * beta / (sigma * sigma) };
}

// qStep(st, { D, gamma, isat, dt }) — ONE abstract engine step on the register (linear exact law, then the SPM
// projection; P untouched — the cap holds it). Mutates and returns st = { sigma, b, phi, P }.
export function qStep(st, { D, gamma, isat, dt }) {
  const ar = 1 / (st.sigma * st.sigma), ai = -st.b;
  st.phi += -D * ar * dt;                     // Gouy (d arg A/dt = −D·Re α)
  const dn = ar * ar + ai * ai;
  let wr = ar / dn, wi = -ai / dn;            // w = 1/α
  wi += D * dt;                               // the linear (ABCD-B) action on the complex beam parameter
  const dn2 = wr * wr + wi * wi;
  st.sigma = 1 / Math.sqrt(wr / dn2); st.b = wi / dn2;
  if (gamma) { const { a0, rb } = qSpmRate(st.sigma, st.P, gamma, isat);
    st.phi += a0 * dt; st.b += rb * dt; }
  return st;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  GATE D — THE SPECTRAL REGISTER: the engine's OWN discrete linear step, DIAGONALIZED. stepEye is a torus
//  convolution leapfrog, so the plane-wave grid k = 2π·j/G diagonalizes it EXACTLY, with the closed-form symbol
//  λ(k) (kernelSymbol — complex when the kernel carries the dipole). Each substep is linear per mode:
//    S1: R̂ −= (dt/4)·λ·Î   ·   S2: Î += (dt/2)·λ·R̂   ·   S3 = S1        (verbatim GLSL_STEP1/2/3, in k-space)
//  ⇒ T linear steps = a per-mode 2×2 recurrence — NOT a continuum import: the register runs the engine's exact
//  discrete propagator (its numerical dispersion included), so the ±T hologram legs (record/recall propagation)
//  are register-resident EXACTLY; f32 is the only gap vs the GPU. The palindromic split makes −dt the exact
//  inverse (why the engine's ±T round-trip is clean — now provable per mode). The clock's own low-pass (kKnee)
//  becomes a COMPRESSION LAW: truncate modes |k| > kCut and the descriptor plate shrinks ~100× with a STATED error.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// _fft1d — in-place iterative radix-2 complex FFT (n a power of 2). f64-deterministic (pure Math.cos/sin).
// NOTE (measured): a twiddle-TABLE variant with offset indexing benchmarked 2× SLOWER here than this
// recurrence-on-subarrays form (V8 optimizes the small-typed-array tight loops) — keep this one.
function _fft1d(re, im, n, inv) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) { const a = i + j, b = i + j + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } } }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// fft2d(re, im, G, inv) — in-place 2D FFT over a G×G row-major grid (G a power of 2). Column scratch pooled
// per G (the hot path runs ~240 fft2d calls/s — per-call allocations are GC-pause fuel).
const _fftCol = new Map();
export function fft2d(re, im, G, inv = false) {
  for (let y = 0; y < G; y++) { const off = y * G; _fft1d(re.subarray(off, off + G), im.subarray(off, off + G), G, inv); }
  let c = _fftCol.get(G); if (!c) { c = { r: new Float64Array(G), i: new Float64Array(G) }; _fftCol.set(G, c); }
  const tr = c.r, ti = c.i;
  for (let x = 0; x < G; x++) { for (let y = 0; y < G; y++) { tr[y] = re[y * G + x]; ti[y] = im[y * G + x]; }
    _fft1d(tr, ti, G, inv);
    for (let y = 0; y < G; y++) { re[y * G + x] = tr[y]; im[y * G + x] = ti[y]; } }
}

// kernelLambdaGrid(radii, weights, offs, G) — the symbol λ(k) precomputed over the full G×G mode grid (row-major,
// same k layout as kernelPropagateSpectral). The CACHE UNIT for hot-path use: key it on the kernel VERSION —
// the fractal clock bumps the ring at SHARED steps, so a per-kernelVer lazy cache is identical on every peer.
export function kernelLambdaGrid(radii, weights, offs, G) {
  // THE FAST BUILD: λ over the whole mode grid = the DFT of the operator's spatial STENCIL. L̂ is a torus
  // convolution with INTEGER offsets, so one G² stencil image + one FFT replaces G²·Σn_d symbol evaluations —
  // ~100× cheaper. This was a live main-thread stall: the fractal clock bumps kernelVer fastest in a YOUNG world,
  // and every per-kernelVer cache miss (vptWatch default-on, verbs) rebuilt the grid at 100–500ms — the
  // "fresh leader lags, reloaded world smooth" signature. Values are EXACT (same sum, FFT-ordered; f64 ~1e-12 —
  // regression-pinned against kernelSymbol). Non-integer offsets (synthetic/analysis kernels) fall back to the
  // direct per-mode evaluation.
  const N = G * G;
  let intOk = true;
  for (const o of (offs || [])) { if (!intOk) break; for (let i = 0; i < (o?.length || 0); i++) if (!Number.isInteger(o[i])) { intOk = false; break; } }
  if (!intOk) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x;
      const kx = 2 * Math.PI * (x <= G / 2 ? x : x - G) / G, ky = 2 * Math.PI * (y <= G / 2 ? y : y - G) / G;
      const s = kernelSymbol(radii, weights, offs, kx, ky); re[j] = s.re; im[j] = s.im; }
    return { re, im };
  }
  const sr = new Float64Array(N), si = new Float64Array(N);
  const put = (dx, dy, c) => { sr[(((dy % G) + G) % G) * G + (((dx % G) + G) % G)] += c; };
  put(1, 0, 4 / 6); put(-1, 0, 4 / 6); put(0, 1, 4 / 6); put(0, -1, 4 / 6);   // lap9 (verbatim GLSL_LAP_FUNC)
  put(1, 1, 1 / 6); put(-1, -1, 1 / 6); put(1, -1, 1 / 6); put(-1, 1, 1 / 6);
  put(0, 0, -20 / 6);
  for (let d = 0; d < (radii?.length || 0); d++) { const o = offs?.[d] || []; const n = o.length >> 1; if (!n) continue;
    const nu = 4 * (weights?.[d] ?? 0) / n;
    for (let i = 0; i < n; i++) put(o[i * 2], o[i * 2 + 1], nu);
    put(0, 0, -nu * n); }
  fft2d(sr, si, G, false);                       // DFT gives Σ c_δ e^{−ik·δ} = conj(λ) (real stencil) → λ = (re, −im)
  for (let j = 0; j < N; j++) si[j] = -si[j];
  return { re: sr, im: si };
}

// kernelPropagateSpectral(field, radii, weights, offs, { T, dt, kCut, G, lam }) — run T of the ENGINE'S linear
// steps on an interleaved complex field, entirely in the register (FFT → per-mode leapfrog recurrence → inverse
// FFT). dt < 0 = the exact backward leg. kCut > 0 truncates modes |k| > kCut (the passband compression; kept/total
// reported). `lam` = a kernelLambdaGrid result — skips the per-mode symbol evaluation (the hot-path cache; radii/
// weights/offs may then be null). Returns { field, kept, total }. R̂/Î are the spectra of the REAL/IMAG fields
// (two complex spectra) — exactly how the GLSL substeps couple them; λ complex ⇒ the dipole rides along.
// `reuse: true` — the hot-path option (the register engine calls this ~60×/s): the four spectra and the output
// come from a per-G scratch pool instead of fresh allocations (~6 × 128 KB of garbage per step otherwise — GC
// pauses read as visual lag). RESULT VALUES are bit-identical to the alloc path (same ops, same order); the
// caller must consume/copy the returned field before the NEXT reuse:true call (it is the pool's buffer).
const _kpsPool = new Map();
export function kernelPropagateSpectral(field, radii, weights, offs, { T = 1, dt = 1, kCut = 0, G = Math.round(Math.sqrt(field.length / 2)), lam = null, reuse = false } = {}) {
  const N = G * G;
  let Rr, Ri, Ir, Ii, outBuf = null;
  if (reuse) { let p = _kpsPool.get(N);
    if (!p) { p = { a: new Float64Array(N), b: new Float64Array(N), c: new Float64Array(N), d: new Float64Array(N), o: new Float64Array(2 * N) }; _kpsPool.set(N, p); }
    ({ a: Rr, b: Ri, c: Ir, d: Ii, o: outBuf } = p); Ri.fill(0); Ii.fill(0); }
  else { Rr = new Float64Array(N); Ri = new Float64Array(N); Ir = new Float64Array(N); Ii = new Float64Array(N); }
  for (let j = 0; j < N; j++) { Rr[j] = field[j * 2]; Ir[j] = field[j * 2 + 1]; }
  fft2d(Rr, Ri, G, false); fft2d(Ir, Ii, G, false);
  let kept = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x;
    const kx = 2 * Math.PI * (x <= G / 2 ? x : x - G) / G, ky = 2 * Math.PI * (y <= G / 2 ? y : y - G) / G;
    if (kCut > 0 && Math.hypot(kx, ky) > kCut) { Rr[j] = Ri[j] = Ir[j] = Ii[j] = 0; continue; }
    kept++;
    let lr, li;
    if (lam) { lr = lam.re[j]; li = lam.im[j]; }
    else { const s = kernelSymbol(radii, weights, offs, kx, ky); lr = s.re; li = s.im; }
    const hr = (dt / 4) * lr, hi = (dt / 4) * li, fr = (dt / 2) * lr, fi = (dt / 2) * li;
    // CLOSED-FORM M^T (the eigen-rotation micro-opt): the one-step map M = S1·S2·S1 has det 1 and
    // m11 = m22 = 1 − hf, so M^T = U_{T−1}(x)·M − U_{T−2}(x)·I with x = tr M/2 = 1 − hf and U_n the
    // 2nd-kind Chebyshev recurrence (complex-safe — the dipole's Im λ rides along). Identical map in exact
    // arithmetic (f64 diffs ~1e-13); ~5× fewer flops in the mode loop than iterating the substeps.
    const hfr = hr * fr - hi * fi, hfi = hr * fi + hi * fr;              // hf
    const xr = 1 - hfr, xi = -hfi;                                       // x = m11 = m22
    let u1r, u1i, u0r, u0i;                                              // U_{T−1}, U_{T−2}
    if (T === 1) { u1r = 1; u1i = 0; u0r = 0; u0i = 0; }
    else { u0r = 1; u0i = 0; u1r = 2 * xr; u1i = 2 * xi;
      for (let s = 2; s < T; s++) { const nr = 2 * (xr * u1r - xi * u1i) - u0r, ni = 2 * (xr * u1i + xi * u1r) - u0i;
        u0r = u1r; u0i = u1i; u1r = nr; u1i = ni; } }
    const t2r = 2 - hfr, t2i = -hfi;                                     // 2 − hf
    const m12r = -(hr * t2r - hi * t2i), m12i = -(hr * t2i + hi * t2r);  // m12 = −h·(2−hf)
    const A11r = (u1r * xr - u1i * xi) - u0r, A11i = (u1r * xi + u1i * xr) - u0i;
    const A12r = u1r * m12r - u1i * m12i, A12i = u1r * m12i + u1i * m12r;
    const A21r = u1r * fr - u1i * fi, A21i = u1r * fi + u1i * fr;        // m21 = f · A22 = A11
    const ar0 = Rr[j], ai0 = Ri[j], br0 = Ir[j], bi0 = Ii[j];
    Rr[j] = (A11r * ar0 - A11i * ai0) + (A12r * br0 - A12i * bi0);
    Ri[j] = (A11r * ai0 + A11i * ar0) + (A12r * bi0 + A12i * br0);
    Ir[j] = (A21r * ar0 - A21i * ai0) + (A11r * br0 - A11i * bi0);
    Ii[j] = (A21r * ai0 + A21i * ar0) + (A11r * bi0 + A11i * br0);
  }
  fft2d(Rr, Ri, G, true); fft2d(Ir, Ii, G, true);
  const out = outBuf || new Float64Array(2 * N);
  for (let j = 0; j < N; j++) { out[j * 2] = Rr[j]; out[j * 2 + 1] = Ir[j]; }   // the inverse's imag parts are ~0 (real component fields) — dropped
  return { field: out, kept, total: N };
}

// ── THE REMAINING DUALITY HARVEST (Cartier/finite-Fourier, applied where the real-space path cannot follow) ──

// spectralShift(field, dx, dy, G) — EXACT torus translation by ANY offset, fractional included (the shift theorem:
// multiply by the character e^{−ik·Δ}). Unitary (Parseval-exact) at every offset — vs the bilinear resample's
// measured ~18%/half-pixel loss (the orbit-mode finding). NOTE: rewiring movAtt to this CHANGES the pin target
// (physics-affecting) — exported as the primitive for the oracle-checked experiment, not silently wired.
export function spectralShift(field, dx, dy, G = Math.round(Math.sqrt(field.length / 2))) {
  const N = G * G, fr = new Float64Array(N), fi = new Float64Array(N);
  for (let j = 0; j < N; j++) { fr[j] = field[j * 2]; fi[j] = field[j * 2 + 1]; }
  fft2d(fr, fi, G, false);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x;
    const kx = 2 * Math.PI * (x <= G / 2 ? x : x - G) / G, ky = 2 * Math.PI * (y <= G / 2 ? y : y - G) / G;
    const ph = -(kx * dx + ky * dy), c = Math.cos(ph), s = Math.sin(ph);
    const r = fr[j] * c - fi[j] * s; fi[j] = fr[j] * s + fi[j] * c; fr[j] = r; }
  fft2d(fr, fi, G, true);
  const out = new Float64Array(2 * N);
  for (let j = 0; j < N; j++) { out[j * 2] = fr[j]; out[j * 2 + 1] = fi[j]; }
  return out;
}

// crossCorrScan(a, b, G) — SHIFT-INVARIANT overlap in one dual pass: g(δ) = Σ a*(x)·b(x+δ) for ALL N offsets at
// once (ifft(conj(Â)·B̂), O(N·logN) vs O(N²) real-space). Returns { corr0 (zero-lag — the current recall score),
// corrMax, dx, dy } with ampCorr normalization and signed torus offsets. The recall capability zero-lag cannot
// have: content-addressing that FINDS a banked moment the state has since MOVED away from — and says where.
export function crossCorrScan(a, b, G = Math.round(Math.sqrt(a.length / 2))) {
  const N = G * G;
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  let na = 0, nb = 0;
  for (let j = 0; j < N; j++) { ar[j] = a[j * 2]; ai[j] = a[j * 2 + 1]; br[j] = b[j * 2]; bi[j] = b[j * 2 + 1];
    na += a[j * 2] ** 2 + a[j * 2 + 1] ** 2; nb += b[j * 2] ** 2 + b[j * 2 + 1] ** 2; }
  const nrm = Math.sqrt(na * nb) || 1;
  fft2d(ar, ai, G, false); fft2d(br, bi, G, false);
  for (let j = 0; j < N; j++) { const pr = ar[j] * br[j] + ai[j] * bi[j], pi = ar[j] * bi[j] - ai[j] * br[j]; ar[j] = pr; ai[j] = pi; }
  fft2d(ar, ai, G, true);
  const c0 = Math.hypot(ar[0], ai[0]) / nrm;
  let best = 0, bv = -1;
  for (let j = 0; j < N; j++) { const v = ar[j] * ar[j] + ai[j] * ai[j]; if (v > bv) { bv = v; best = j; } }
  let dx = best % G, dy = (best / G) | 0; if (dx > G / 2) dx -= G; if (dy > G / 2) dy -= G;
  return { corr0: c0, corrMax: Math.sqrt(bv) / nrm, dx, dy };
}

// occlude(field, {mode, frac, block, seed, G}) — CORRUPT/MASK a field into a PARTIAL image, the input side of the
// classic "break the hologram, still reconstruct the whole scene" demonstration. Returns a FRESH copy (never
// mutates); the kept fraction of the image can then be `bind`-ed against the FULL bank and the winner `lift`-ed —
// a real hologram argmaxes correctly from a fragment and reconstructs the whole, and the fidelity degrades
// GRACEFULLY as `frac` grows. This is the CPU/f64 twin of the GPU occluder (ifs-gpu.js GLSL_EYE_HOLOGRAM) — same
// mode vocabulary and same per-block hash, so a headless test and the live GPU render agree on the mask.
//   modes (mirrors the shader):
//     1 low-pass   keep |k-radius| ≤ frac        (aperture — keep the centre)
//     2 high-pass  keep radius ≥ frac            (keep the outside)
//     3 conjugate  flip Im (phase conjugate — the family member that is not a mask)
//     5 box        keep a CENTERED frac·G window (the graceful-degradation window; NEW vs the shader)
//     6 half       zero the LEFT frac·G columns  (contiguous slab — "cut the plate in half")
//     7 rand-zero  scattered square blocks (size `block`) knocked to 0 with probability `frac`  ← the CLASSIC
//     8 rand-noise those same blocks REPLACED by amplitude-scaled complex noise (corruption, not loss)
//   frac ∈ [0,1] is "how much is removed/aperture radius"; `block` (px, modes 7/8) and `seed` (reshuffle the
//   random pattern) match the shader defaults (8, 0). The hash is the shader's hash — a pure fn of (block coord,
//   seed) → deterministic and peer-identical.
const _fract = (v) => v - Math.floor(v);
const _occHash = (x, y, seed) => {   // GLSL hash(vec2)+u_seed, hardened so an INTEGER seed still reshuffles (a bare
  // additive seed cancels under fract for integer x; here seed enters MULTIPLICATIVELY via a 0.618… stir first).
  const s = _fract(seed * 0.6180339887 + 0.31830988);   // seed → a fractional stir (irrational step, integer-seed-safe)
  let px = _fract((x + s * 37.0) * 123.34 + s);
  let py = _fract((y + s * 51.0) * 456.21 + s);
  const dt = px * (px + 45.32) + py * (py + 45.32); px += dt; py += dt;
  return _fract(px * py);
};
export function occlude(field, { mode = 7, frac = 0.5, block = 8, seed = 0, G = Math.round(Math.sqrt(field.length / 2)) } = {}) {
  if (!field || !mode) return field ? Float64Array.from(field) : null;   // mode 0 / falsy = identity
  const out = Float64Array.from(field), half = G * 0.5, b = Math.max(block | 0, 1);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const j = (y * G + x) * 2;
    if (mode === 3) { out[j + 1] = -out[j + 1]; continue; }
    let masked = false, noise = false;
    if (mode === 1 || mode === 2) { const dx = x - half, dy = y - half, r = Math.hypot(dx, dy) / half;
      masked = mode === 1 ? (r > Math.max(frac, 0.001)) : (r < Math.max(frac, 0.001)); }
    else if (mode === 5) { const w = frac * G, lo = (G - w) / 2, hi = (G + w) / 2;   // centered box: zero OUTSIDE the window
      masked = !(x >= lo && x < hi && y >= lo && y < hi); }
    else if (mode === 6) { masked = x < frac * G; }                                  // left slab: zero the left frac columns
    else if (mode === 7 || mode === 8) { const h = _occHash(Math.floor(x / b), Math.floor(y / b), seed);
      if (h < frac) { masked = true; noise = mode === 8; } }
    if (!masked) continue;
    if (!noise) { out[j] = 0; out[j + 1] = 0; }
    else { const amp = Math.hypot(field[j], field[j + 1]) + 1e-4;
      out[j] = amp * (_occHash(x, y, seed + 7.1) - 0.5) * 2; out[j + 1] = amp * (_occHash(x, y, seed + 19.7) - 0.5) * 2; }
  }
  return out;
}

// keptFraction(field, occluded) — energy ratio surviving a mask, ‖occluded‖²/‖field‖² ∈ [0,1]: the HONEST "how
// much of the image is left" number to report alongside a reconstruction fidelity (the demo's x-axis). For a
// noise mode this exceeds the geometric kept-area (noise carries energy) — which is exactly why loss (7) and
// corruption (8) degrade differently, and why the number must be MEASURED, not assumed from `frac`.
export function keptFraction(field, occluded) {
  if (!field || !occluded) return 0;
  let e0 = 0, e1 = 0; for (let i = 0; i < field.length; i++) { e0 += field[i] * field[i]; e1 += occluded[i] * occluded[i]; }
  return e0 > 0 ? e1 / e0 : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  DESCENT RUNG 1 — THE COVER LAW (local-to-global made first-class on ONE peer). Can a single peer carry the
//  sharding structure for free? In THIS architecture, yes: the GLOBAL MODEL is already the register (tiny,
//  replicated whole); the field is a WITNESS — so a cover of the field is view-tier structure with zero contract
//  stakes. These functions make the cover explicit and PIN its two facts:
//   • THE COCYCLE (tested bit-for-bit): for the LOCAL ops — the kernel leapfrog (finite support ≤ reach/substep)
//     and pointwise SPM — stepping a P×P cover with halos of width 3·reach and GLUING ≡ stepping the whole torus,
//     to the last bit (the per-cell term order is FIXED and shared between paths — bit-exactness is an ORDER
//     property, not just a value property).
//   • THE OBSTRUCTION: the energy cap is the one GLOBAL datum. It does not break sharding — it REDUCES (per-patch
//     partial sums combine associatively) — but f64 addition is order-sensitive, so THE REDUCTION TREE IS PART OF
//     THE CONTRACT: a fixed patch-ordered tree reproduces the global cap to ~1e-12 (not bitwise vs the single-pass
//     sum); multi-peer sharding must ship the tree, not just the partials. Capping each patch by its OWN energy is
//     WRONG (demonstrated in the tests) — the cocycle fails exactly at the global sector, as it must.
//  Multi-peer region sharding later = assigning patches to peers + shipping halos; the gluing law is already
//  pinned here, with the whole-field path as the resident oracle. (Čech language becomes literal at that point:
//  halo agreement on overlaps is the cocycle condition; a nonzero residual localizes WHERE a non-local read leaked.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// _kernTerms — the operator L̂ as an explicit FIXED-ORDER term list [dx, dy, coeff] (lap9 first, then rings,
// then the center corrections). The order is load-bearing: both the whole-torus and the cover path accumulate
// per cell in this exact order, which is what makes the cocycle test bit-for-bit.
function _kernTerms(radii, weights, offs) {
  const t = [];
  const push = (dx, dy, c) => t.push([dx, dy, c]);
  push(1, 0, 4 / 6); push(-1, 0, 4 / 6); push(0, 1, 4 / 6); push(0, -1, 4 / 6);
  push(1, 1, 1 / 6); push(-1, -1, 1 / 6); push(1, -1, 1 / 6); push(-1, 1, 1 / 6);
  push(0, 0, -20 / 6);
  let reach = 1;
  for (let d = 0; d < (radii?.length || 0); d++) { const o = offs?.[d] || []; const n = o.length >> 1; if (!n) continue;
    const nu = 4 * (weights?.[d] ?? 0) / n;
    for (let i = 0; i < n; i++) { push(o[i * 2], o[i * 2 + 1], nu);
      reach = Math.max(reach, Math.abs(o[i * 2]), Math.abs(o[i * 2 + 1])); }
    push(0, 0, -nu * n); }
  return { terms: t, reach };
}

const _lapWith = (terms, get, x, y) => { let a = 0;
  for (let i = 0; i < terms.length; i++) { const tm = terms[i]; a += tm[2] * get(x + tm[0], y + tm[1]); } return a; };

// leapfrogStepX(field, radii, weights, offs, dt, G) — ONE whole-torus engine step in x-space (the reference the
// cover is glued against). Same Strang split as the GPU (S1·S2·S1); fixed term order per cell (see _kernTerms).
export function leapfrogStepX(field, radii, weights, offs, dt, G = Math.round(Math.sqrt(field.length / 2))) {
  const { terms } = _kernTerms(radii, weights, offs), N = G * G;
  const R = new Float64Array(N), I = new Float64Array(N);
  for (let j = 0; j < N; j++) { R[j] = field[j * 2]; I[j] = field[j * 2 + 1]; }
  const wrap = (arr) => (x, y) => arr[(((y % G) + G) % G) * G + (((x % G) + G) % G)];
  const sub = (dst, src, s) => { const g = wrap(src), out = new Float64Array(dst);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) out[y * G + x] = dst[y * G + x] + s * _lapWith(terms, g, x, y);
    return out; };
  const R1 = sub(R, I, -dt / 4), I1 = sub(I, R1, dt / 2), R2 = sub(R1, I1, -dt / 4);
  const out = new Float64Array(2 * N);
  for (let j = 0; j < N; j++) { out[j * 2] = R2[j]; out[j * 2 + 1] = I1[j]; }
  return out;
}

// regionStepX(field, radii, weights, offs, dt, G, reg, {out}) — ONE engine step computed ONLY inside the region
// reg = {x0,y0,x1,y1} (torus box), reading boundary data from the field's own outside and writing NOTHING there.
// The Strang cascade uses shrinking margins (S1 over R+2·reach, S2 over R+reach, S3 over R): with a CORRECT
// outside (the field's own), values inside R match the whole-torus step for ONE step. ⚠ HONEST BOUND for the
// ITERATED shard (test-pinned): each of the 3 substeps propagates by the stencil reach, so a FROZEN/declared
// boundary corrupts ~3·reach INWARD PER STEP — after N steps only the interior beyond N·(3·reach) stays
// bit-exact vs a true whole-torus run; the seam DIVERGES (a real declared-boundary approximation, not a
// whole-region exactness claim). same _kernTerms order (the cocycle discipline). cost ∝ |R|; scratch pooled.
const _rsxPool = new Map();
export function regionStepX(field, radii, weights, offs, dt, G, reg, { out = null } = {}) {
  const { terms, reach } = _kernTerms(radii, weights, offs), N = G * G;
  let p = _rsxPool.get(N);
  if (!p) { p = { R: new Float64Array(N), I: new Float64Array(N), R1: new Float64Array(N), I1: new Float64Array(N), R2: new Float64Array(N) }; _rsxPool.set(N, p); }
  const { R, I, R1, I1, R2 } = p;
  for (let j = 0; j < N; j++) { R[j] = field[j * 2]; I[j] = field[j * 2 + 1]; }
  const wrap = (arr) => (x, y) => arr[(((y % G) + G) % G) * G + (((x % G) + G) % G)];
  // sub-update dst→outArr over reg expanded by m (torus box); OUTSIDE the box, outArr must equal dst wherever a
  // LATER substep will read it — copy the next margin band's worth: simplest correct form copies dst fully once.
  const subR = (outArr, dst, src, s, m) => { outArr.set(dst); const g = wrap(src);
    for (let ey = reg.y0 - m; ey < reg.y1 + m; ey++) for (let ex = reg.x0 - m; ex < reg.x1 + m; ex++) {
      const gx = ((ex % G) + G) % G, gy = ((ey % G) + G) % G;
      outArr[gy * G + gx] = dst[gy * G + gx] + s * _lapWith(terms, g, gx, gy); } };
  subR(R1, R, I, -dt / 4, 2 * reach);
  subR(I1, I, R1, dt / 2, reach);
  subR(R2, R1, I1, -dt / 4, 0);
  const o = out || new Float64Array(2 * N);
  o.set(field);
  for (let ey = reg.y0; ey < reg.y1; ey++) for (let ex = reg.x0; ex < reg.x1; ex++) {
    const gx = ((ex % G) + G) % G, gy = ((ey % G) + G) % G, j = gy * G + gx;
    o[j * 2] = R2[j]; o[j * 2 + 1] = I1[j]; }
  return o;
}

// ── MULTISCALE SHARD (§9.1): the IFS kernel is a MULTIRESOLUTION decomposition — the world builds it in
//    scale TIERS (cachedRadiiByTier). THE LOAD-BEARING THEOREM (test-pinned, exact to f64): the operator's
//    SYMBOL is LINEAR in the ring set, so L̂_merged = Σ_d L̂_tier − (nTiers−1)·lap9 (each tier carries its own
//    lap9). Hence the LINEAR propagation decomposes by tier — this is the presheaf's global section in the
//    SCALE direction (an EXACT gluing, not a measured-small defect). Nonlinearity (SPM/cap) does NOT decompose;
//    it is applied once on the full field. ⚠ THE DOWNSAMPLING OPTIMIZATION WAS REFUTED BY TEST (doc §9.1): a
//    single ring of radius r has symbol cos(k·r), BROADBAND for large r (an r=16 ring is significant to |k|>π),
//    so coarse tiers are NOT band-separated and cannot be stepped on coarse grids (~90–100% error). Radius ≠
//    frequency for rings; gate A's low-pass is the AGGREGATE transport coefficient, not individual coarse rings.
//    So the exact scale-gluing is a real STRUCTURAL result but yields NO compute win via multigrid — kept as the
//    proven decomposition (tierSymbolSum/tierLambdaGrid); the multigrid compute-shard route is CLOSED.
export function tierSymbolSum(radiiByTier, weightsByTier, offsByTier, kx, ky) {
  // Σ_d λ_tier(k) − (nTiers−1)·lap9(k) — the merged symbol reconstructed from the tiers (the exact scale-gluing).
  const nT = radiiByTier.length; let re = 0, im = 0;
  for (let d = 0; d < nT; d++) { const s = kernelSymbol(radiiByTier[d], weightsByTier[d], offsByTier[d], kx, ky); re += s.re; im += s.im; }
  const lap = kernelSymbol([], [], [], kx, ky); re -= (nT - 1) * lap.re; im -= (nT - 1) * lap.im;
  return { re, im };
}
// tierPropagate(field, radiiByTier, weightsByTier, offsByTier, {T,dt,G,lam}) — propagate the LINEAR operator by
// the tier decomposition: build the merged λ-grid AS the tier-sum (exact) and run the standard spectral step.
// This is the reference form (still one FFT); the per-tier DOWNSAMPLED steppers optimize it. Reconstructs the
// whole linear step to the f64 floor when the tiers partition the merged kernel's rings.
export function tierLambdaGrid(radiiByTier, weightsByTier, offsByTier, G) {
  const N = G * G, re = new Float64Array(N), im = new Float64Array(N);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x;
    const kx = 2 * Math.PI * (x <= G / 2 ? x : x - G) / G, ky = 2 * Math.PI * (y <= G / 2 ? y : y - G) / G;
    const s = tierSymbolSum(radiiByTier, weightsByTier, offsByTier, kx, ky); re[j] = s.re; im[j] = s.im; }
  return { re, im };
}

// coverStep(field, radii, weights, offs, dt, G, P) — the SAME step via an explicit P×P cover: each patch is
// extracted with a halo of 3·reach (one full step = three substeps, each propagating ≤ reach), stepped LOCALLY
// (no torus knowledge inside a patch), and the interiors GLUED. Bit-for-bit ≡ leapfrogStepX (the cocycle).
export function coverStep(field, radii, weights, offs, dt, G, P = 2) {
  const { terms, reach } = _kernTerms(radii, weights, offs);
  const pw = G / P; if (pw !== (pw | 0)) throw new Error('coverStep: P must divide G');
  const h = 3 * reach, s = pw + 2 * h, N = G * G;
  const out = new Float64Array(2 * N);
  for (let pj = 0; pj < P; pj++) for (let pi = 0; pi < P; pi++) {
    const BR = new Float64Array(s * s), BI = new Float64Array(s * s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const gx = (((pi * pw + x - h) % G) + G) % G, gy = (((pj * pw + y - h) % G) + G) % G;
      BR[y * s + x] = field[(gy * G + gx) * 2]; BI[y * s + x] = field[(gy * G + gx) * 2 + 1]; }
    // three LOCAL substeps: the valid region shrinks by `reach` per substep; the interior stays clean since 3·reach ≤ h.
    const getB = (arr) => (x, y) => arr[Math.min(s - 1, Math.max(0, y)) * s + Math.min(s - 1, Math.max(0, x))];
    const subB = (dst, src, sc, m) => { const g = getB(src), o2 = new Float64Array(dst);
      for (let y = m; y < s - m; y++) for (let x = m; x < s - m; x++) o2[y * s + x] = dst[y * s + x] + sc * _lapWith(terms, g, x, y);
      return o2; };
    const R1 = subB(BR, BI, -dt / 4, reach), I1 = subB(BI, R1, dt / 2, 2 * reach), R2 = subB(R1, I1, -dt / 4, 3 * reach);
    for (let y = 0; y < pw; y++) for (let x = 0; x < pw; x++) {
      const j = ((pj * pw + y) * G + (pi * pw + x)) * 2, b = (y + h) * s + (x + h);
      out[j] = R2[b]; out[j + 1] = I1[b]; } }
  return out;
}

// capReduce(partials) — the global sector as a monoid: combine per-patch energy partials in a FIXED patch-ordered
// tree (left fold). THE LAW: the tree is part of the contract — shards must ship (partial, patchIndex) and every
// holder folds in the same order, or the cap scalar (hence every capped byte) forks at the f64 level.
export function capReduce(partials) { let e = 0; for (let i = 0; i < partials.length; i++) e += partials[i]; return e; }

// coverResidual — THE SPATIAL FORK-FINDER (the Čech instrument made operational): each patch computes its
// interior EXTENDED by `ov` cells, so adjacent patches compute the overlap bands REDUNDANTLY; the residual is
// the max disagreement over all overlaps (+ where). For honest LOCAL ops the residual is EXACTLY 0 (the cocycle,
// bit-for-bit); any NON-LOCAL read leaking into the step lights up localized at its entry point — the descent
// analog of solH, except it answers WHERE, not just WHETHER. `taint: {x, y, amp}` injects a deliberate halo
// perturbation into the ONE patch owning that cell (not its neighbors) — the calibration fault: the residual
// must appear within the taint's light cone (≤ 3·reach).
export function coverResidual(field, radii, weights, offs, dt, G, P = 2, { ov = 0, taint = null } = {}) {
  const { terms, reach } = _kernTerms(radii, weights, offs);
  const pw = G / P; if (pw !== (pw | 0)) throw new Error('coverResidual: P must divide G');
  const o = ov || reach, h = 3 * reach + o, s = pw + 2 * h;
  // each patch's EXTENDED interior: [h−o, h+pw+o) in buffer coords — neighbors overlap by 2o cells
  const ext = new Array(P * P);
  for (let pj = 0; pj < P; pj++) for (let pi = 0; pi < P; pi++) {
    const BR = new Float64Array(s * s), BI = new Float64Array(s * s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const gx = (((pi * pw + x - h) % G) + G) % G, gy = (((pj * pw + y - h) % G) + G) % G;
      BR[y * s + x] = field[(gy * G + gx) * 2]; BI[y * s + x] = field[(gy * G + gx) * 2 + 1]; }
    if (taint) { // inject into the OWNING patch's buffer only (owner = the patch whose interior contains the cell)
      const own = (((taint.x / pw) | 0) === pi && ((taint.y / pw) | 0) === pj);
      if (own) { const bx = taint.x - pi * pw + h, by = taint.y - pj * pw + h;
        BR[by * s + bx] += (taint.amp ?? 1e-3); } }
    const getB = (arr) => (x, y) => arr[Math.min(s - 1, Math.max(0, y)) * s + Math.min(s - 1, Math.max(0, x))];
    const subB = (dst, src, sc, m) => { const g = getB(src), o2 = new Float64Array(dst);
      for (let y = m; y < s - m; y++) for (let x = m; x < s - m; x++) o2[y * s + x] = dst[y * s + x] + sc * _lapWith(terms, g, x, y);
      return o2; };
    const R1 = subB(BR, BI, -dt / 4, reach), I1 = subB(BI, R1, dt / 2, 2 * reach), R2 = subB(R1, I1, -dt / 4, 3 * reach);
    ext[pj * P + pi] = { R: R2, I: I1, pi, pj }; }
  // compare every REDUNDANTLY computed global cell across the patches that computed it
  let rmax = 0, at = null; const val = new Map();
  for (const e of ext) for (let y = h - o; y < h + pw + o; y++) for (let x = h - o; x < h + pw + o; x++) {
    const gx = (((e.pi * pw + x - h) % G) + G) % G, gy = (((e.pj * pw + y - h) % G) + G) % G, key = gy * G + gx;
    const vr = e.R[y * s + x], vi = e.I[y * s + x], prev = val.get(key);
    if (prev) { const d = Math.max(Math.abs(vr - prev[0]), Math.abs(vi - prev[1]));
      if (d > rmax) { rmax = d; at = [gx, gy]; } }
    else val.set(key, [vr, vi]); }
  return { rmax, at, reach, ov: o };
}

// qFixedPoint({ Dof, gamma, isat, P, lo, hi }) — the b=0 balance: root of F(σ) = D̄(σ)/σ⁴ + ḃ_NL(σ). Returns
// { sigma, stable, Omega, period } or { sigma: null, regime } when no root exists in range — regime 'collapse'
// (F < 0: focusing wins at every scale — RUNAWAY) or 'spread' (F > 0: below the minimum soliton power).
export function qFixedPoint({ Dof, gamma, isat, P, lo = 1.5, hi = 48 } = {}) {
  const D = (s) => (typeof Dof === 'function' ? Dof(s) : Dof);
  const F = (s) => D(s) / (s * s * s * s) + qSpmRate(s, P, gamma, isat).rb;
  let a = lo, b = hi, Fa = F(a), Fb = F(b);
  if (Fa * Fb > 0) return { sigma: null, regime: Fa < 0 ? 'collapse' : 'spread', Fa, Fb };
  for (let i = 0; i < 80; i++) { const m = (a + b) / 2, Fm = F(m); if (Fa * Fm <= 0) { b = m; Fb = Fm; } else { a = m; Fa = Fm; } }
  const s = (a + b) / 2, h = s * 1e-4, Fp = (F(s + h) - F(s - h)) / (2 * h);
  const stable = Fp < 0, Om = stable ? Math.sqrt(Math.max(0, -D(s) * s * Fp)) : 0;
  return { sigma: s, stable, Omega: Om, period: Om > 0 ? 2 * Math.PI / Om : Infinity };
}

// ── GATE F: THE ERMAKOV–LEWIS / sl(2,ℝ) CASIMIR ─────────────────────────────────────────────────────────
// Gate E measured the algebra's structure equation (V̈ = 4·D·H, Ḣ = 0). The triple (V, V̇, H) then carries a
// CASIMIR — the invariant of the quadratic sector:  I = V̈·V − ½V̇²,  dI/dt = V̇(V̈ − V̈) ≡ 0.
// It is the register's first genuinely CONSERVED observable beyond H itself, and it is PREDICTIVE: the
// parabola's turning point is fixed by t=0 data alone —  t* = −V̇₀/V̈,  V_min = I/V̈  — the register calls a
// GPU focal event (the waist) before the field gets there. On the lattice the honest curvature is the
// EXACT-SYMBOL rate (virialRateX below): under LINEAR evolution v_g(k) is a per-mode constant of motion, so
// Var(x)(t) = Var(x₀) + 2Cov·t + Var(v_g)·t² is an EXACT parabola for ANY dispersion — no quadratic band
// assumed. Nonlinearity adds the pressure term (cubic: conserved with H ⇒ I still exact; saturable: the
// K-breaking — I's drift MEASURES it, same shape as gate E's ledger).

// secondMoment(field, G) → { V, P, cx, cy }: V = Σ r²|ψ|² about the intensity centroid (the virial ledger's V).
export function secondMoment(field, G = Math.round(Math.sqrt(field.length / 2))) {
  const N = G * G; let P = 0, cx = 0, cy = 0;
  for (let j = 0; j < N; j++) { const a2 = field[j * 2] ** 2 + field[j * 2 + 1] ** 2; P += a2; cx += (j % G) * a2; cy += ((j / G) | 0) * a2; }
  cx /= P || 1; cy /= P || 1; let V = 0;
  for (let j = 0; j < N; j++) { const a2 = field[j * 2] ** 2 + field[j * 2 + 1] ** 2, dx = (j % G) - cx, dy = ((j / G) | 0) - cy; V += (dx * dx + dy * dy) * a2; }
  return { V, P, cx, cy };
}

// virialRateX(field, radii, weights, offs, G, { gamma, isat, Dq }) → V̈ from the EXACT lattice symbol (the
// σ=24 lesson made law): linear part 2·P·Var(v_g) with the ANALYTIC group velocity off the operator's stencil —
// v_g(k) = −½∇λ = ½Σ c_δ·δ·sin(k·δ) (no grid finite-difference: a centered-diff v_g biases V̈ ~1.7% at G=64,
// and the Casimir INTEGRATES that bias — measured before this was made analytic); nonlinear pressure part
// −4·D̄·Σp, p(ρ) = ρ·f(ρ) − F(ρ) (cubic limit: −2γD̄Σρ² — the classic term). gamma=0 ⇒ pure linear.
// `spec` option: { w (|ψ̂|² per mode, FFT order), P, sp } — the FIELD-side content, precomputed. With it the call
// is FFT-FREE: a kernel RE-KEY changes only the stencil, so a register holding the spectrum re-keys V̈ by a pure
// stencil re-sum (the sl(2)-tier hot path — the envelope's spectrum is compile-time register content).
export function virialRateX(field, radii, weights, offs, G = Math.round(Math.sqrt((field ? field.length : 0) / 2)) || 0, { gamma = 0, isat = Infinity, Dq = 0, spec = null, lam = null } = {}) {
  if (spec) G = G || Math.round(Math.sqrt(spec.w.length));
  const N = G * G;
  let wSpec;
  if (spec) wSpec = spec.w;
  else { const pr = new Float64Array(N), pi = new Float64Array(N);
    for (let j = 0; j < N; j++) { pr[j] = field[j * 2]; pi[j] = field[j * 2 + 1]; }
    fft2d(pr, pi, G, false);
    wSpec = new Float64Array(N); for (let j = 0; j < N; j++) wSpec[j] = pr[j] * pr[j] + pi[j] * pi[j]; }
  let sw = 0, svx = 0, svy = 0, sv2 = 0;
  if (lam) {
    // FD-on-λ v_g (the TELEMETRY path): centered difference on the cached λ-grid — O(N), no per-term trig.
    // Bias ≈1.7% at G=64 vs the analytic sum (measured, gate F) — fine for live tiers; instruments that need
    // the exact curvature pass the stencil instead. (The analytic sum costs ~terms·N sin's — 120 ms/call on
    // the live fractal ring's ~190 terms, profiled at 31% of the frame when run per bar.)
    const dk = 2 * Math.PI / G;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x;
      const w = wSpec[j]; if (!w) continue;
      const xp = y * G + ((x + 1) % G), xm = y * G + ((x + G - 1) % G);
      const yp = ((y + 1) % G) * G + x, ym = ((y + G - 1) % G) * G + x;
      const vx = -0.5 * (lam.re[xp] - lam.re[xm]) / (2 * dk), vy = -0.5 * (lam.re[yp] - lam.re[ym]) / (2 * dk);
      sw += w; svx += w * vx; svy += w * vy; sv2 += w * (vx * vx + vy * vy); }
  } else {
  // the operator's stencil (verbatim the kernelLambdaGrid terms: lap9 + rings) as a term list for the analytic ∇λ
  const terms = [[1, 0, 4 / 6], [-1, 0, 4 / 6], [0, 1, 4 / 6], [0, -1, 4 / 6], [1, 1, 1 / 6], [-1, -1, 1 / 6], [1, -1, 1 / 6], [-1, 1, 1 / 6]];
  for (let d = 0; d < (radii?.length || 0); d++) { const o = offs?.[d] || []; const n = o.length >> 1; if (!n) continue;
    const nu = 4 * (weights?.[d] ?? 0) / n;
    for (let i = 0; i < n; i++) terms.push([o[i * 2], o[i * 2 + 1], nu]); }   // center terms carry δ=0 → zero ∇, omitted
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x;
    const w = wSpec[j]; if (!w) continue;
    const kx = 2 * Math.PI * (x <= G / 2 ? x : x - G) / G, ky = 2 * Math.PI * (y <= G / 2 ? y : y - G) / G;
    let vx = 0, vy = 0;
    for (let t = 0; t < terms.length; t++) { const s = terms[t][2] * Math.sin(kx * terms[t][0] + ky * terms[t][1]); vx += 0.5 * terms[t][0] * s; vy += 0.5 * terms[t][1] * s; }
    sw += w; svx += w * vx; svy += w * vy; sv2 += w * (vx * vx + vy * vy); }
  }
  let P;
  if (spec) P = spec.P;
  else { P = 0; for (let j = 0; j < N; j++) P += field[j * 2] ** 2 + field[j * 2 + 1] ** 2; }
  const vlin = sw > 0 ? 2 * P * (sv2 / sw - ((svx / sw) ** 2 + (svy / sw) ** 2)) : 0;
  if (!gamma) return vlin;
  let sp;
  if (spec && spec.sp != null) sp = spec.sp;
  else { sp = 0; for (let j = 0; j < N; j++) { const I = field[j * 2] ** 2 + field[j * 2 + 1] ** 2;
    const fI = gamma * I / (1 + (isat === Infinity ? 0 : I / isat)), FI = (isat === Infinity || isat > 1e9) ? gamma * I * I / 2 : gamma * isat * (I - isat * Math.log(1 + I / isat));
    sp += I * fI - FI; } }
  return vlin - 4 * Dq * sp;
}
// virialSpec(field, G, { gamma, isat }) → the `spec` bundle for virialRateX: { w, P, sp } — one FFT, once, at
// the compile door; every later re-key is stencil-only.
export function virialSpec(field, G = Math.round(Math.sqrt(field.length / 2)), { gamma = 0, isat = Infinity } = {}) {
  const N = G * G, pr = new Float64Array(N), pi = new Float64Array(N);
  for (let j = 0; j < N; j++) { pr[j] = field[j * 2]; pi[j] = field[j * 2 + 1]; }
  fft2d(pr, pi, G, false);
  const w = new Float64Array(N); for (let j = 0; j < N; j++) w[j] = pr[j] * pr[j] + pi[j] * pi[j];
  let P = 0, sp = 0;
  for (let j = 0; j < N; j++) { const I = field[j * 2] ** 2 + field[j * 2 + 1] ** 2; P += I;
    if (gamma) { const fI = gamma * I / (1 + (isat === Infinity ? 0 : I / isat)), FI = (isat === Infinity || isat > 1e9) ? gamma * I * I / 2 : gamma * isat * (I - isat * Math.log(1 + I / isat));
      sp += I * fI - FI; } }
  return { w, P, sp };
}

// slCasimir(vdd, V, Vd) — the invariant itself. Conserved exactly wherever V̈ is the true constant curvature;
// its drift is the measured sl(2)-breaking (lattice band + saturation), the gate F ledger number.
export function slCasimir(vdd, V, Vd) { return vdd * V - 0.5 * Vd * Vd; }

// secondMomentTorus(field, G) → { V, P, cx, cy }: the TORUS-AWARE second moment. The naive centroid fails on a
// wrapped/halo-laden state (a core straddling the boundary or a full-field halo pulls Σx·I toward G/2 — live
// symptom: "lock 0.92 yet lag 64px", self-contradictory). Centroid = the FIRST-HARMONIC phase per axis
// (cx = (G/2π)·arg Σ I·e^{i2πx/G} — exact on the torus, wrap-immune); V uses wrapped signed distances.
export function secondMomentTorus(field, G = Math.round(Math.sqrt(field.length / 2))) {
  const N = G * G, w = 2 * Math.PI / G; let P = 0, ax = 0, bx = 0, ay = 0, by = 0;
  for (let j = 0; j < N; j++) { const I = field[j * 2] ** 2 + field[j * 2 + 1] ** 2; if (!I) continue;
    P += I; const x = j % G, y = (j / G) | 0;
    ax += I * Math.cos(w * x); bx += I * Math.sin(w * x); ay += I * Math.cos(w * y); by += I * Math.sin(w * y); }
  const cx = ((Math.atan2(bx, ax) / w) + G) % G, cy = ((Math.atan2(by, ay) / w) + G) % G;
  // m = the circular RESULTANT LENGTH (min over axes): the localization gauge. m→1 = a compact state (centroid
  // meaningful); m→0 = the state fills the torus (a "centroid"/lag there is noise — the observable must refuse
  // itself). Live lesson: an extended hologram object gave lag≈60px at lock 0.92 — not tracking failure, m≈0.
  const m = P > 0 ? Math.min(Math.hypot(ax, bx), Math.hypot(ay, by)) / P : 0;
  let V = 0;
  for (let j = 0; j < N; j++) { const I = field[j * 2] ** 2 + field[j * 2 + 1] ** 2; if (!I) continue;
    let dx = ((j % G) - cx + G) % G; if (dx > G / 2) dx -= G;
    let dy = (((j / G) | 0) - cy + G) % G; if (dy > G / 2) dy -= G;
    V += (dx * dx + dy * dy) * I; }
  return { V, P, cx, cy, m };
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ── MERGED FROM medium-u1-engine.js ── THE ABSTRACT REGISTER ENGINE (makeRegisterEngine)
// (was a separate file; consolidated into medium-core.js — the one abstract-medium module. medium-gpu.js
//  stays separate because it is WebGL-bound and would break core's headless purity.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// medium-u1-engine.js — THE ABSTRACT REGISTER ENGINE, extracted from medium-u1.js (extraction ladder rung after
//   medium-gpu / medium-u1-slots). This is the U1 abstract-holography machine's PURE PHYSICS CORE: the operators
//   the register runs on itself, freed from the app's DOM/GPU/verb scaffolding so ANY app (medium-u1 itself, and
//   the thin apps as they migrate off the old phase-only U1) can host a live register-driven medium.
//
//   WHAT IT IS (the meta-circular step, v7): the register does not DESCRIBE the medium, it RUNS it. One step is
//   five operators, all f64 CPU, zero GPU:  pin superpose (β replicated) → exact spectral linear step (gate D, via
//   the λ-grid cache) → engine SPM phase → energy cap at the slot's own descE0 → f32 grain (Math.fround — the wire
//   lattice IS the original engine's own grain). Pure fn of (slot state, shared step): the whole determinism
//   contract (regH) reads its output.
//
//   THE CONTEXT OBJECT (why a factory, not free functions): every operator here needs a handful of LIVE, app-owned
//   values — the running IFS ring cache (recomputed by the fractal clock), the per-slot lens register (∠,β,ω), the
//   slot bank, the coupling edges, the linear-mode dial. The app OWNS and MUTATES those (they ride replication);
//   the engine only READS them, through getters on `ctx`. So `makeRegisterEngine(ctx)` closes over getters, never
//   over a snapshot — the engine always sees the app's current state, and the app's determinism/snapshot/verb
//   machinery is untouched. Constants (GRID, DT, N_CELLS, γ, isat) are captured by value.
//
//   BOUNDARY (what stayed in medium-u1.js, by the medium-gpu extraction rule — engine math moves, orchestration
//   + GPU + DOM stay): the GPU turbo executor (_tbAdvanceAll — WebGL), the drive loop, verb wiring, snapshot glue,
//   store/recall of moments (they touch _plates + platform hooks), regH assembly (the app chooses which fields).
//   The pure per-step engine, the symbol/scale grids, the declaration projection, the cross-slot coupling, the
//   sl(2)/Casimir charge builders, and the region (shard) step are here.
//
//   EXTRACTION INVARIANT: byte-for-byte. medium-u1's regH and the npm suites must be identical before/after — the
//   functions moved verbatim, only their closure variables became ctx getters. (Same discipline that kept
//   medium.js byte-identical through the medium-gpu extraction.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// makeRegisterEngine(ctx) — build the register engine over an app context.
//
//   ctx (constants):   GRID, DT, N_CELLS, gamma, isat
//   ctx (live getters — the app owns the state, the engine only reads):
//     ringCache()   → the current IFS ring kernel { r, w, o } (recomputed by the fractal clock)
//     kernelVer()   → the ring cache's version (drives the λ-grid cache invalidation)
//     lensOp(i)     → slot i's lens register { phase, beta, omega, prec, ... } (∠ ω β aging)
//     slots()       → the slot bank's slots[] (each { desc, descBase, descE0, descLive, descAtt, _eng, _engE, ... })
//     edge()        → the coupling matrix _K.edge (4×4 κ) or null
//     linearMode()  → 0 full · 1 free-linear · 2 linear sharp-trap
//     linLeak()     → the mode-2 leak (β-derived unit-gain damping)
//     shardRing()   → the ring used by the region step (demo sandbox override or the live ringCache)
//     wSlot()       → the W slot object (for _declProject's leash/pos/phi anchors)
//
// Returns { lambda, lambdaScale, rMid, specLeg, declProject, step, coupledAtt, stepRegion, mkSl2, sl2Rekey }.
export function makeRegisterEngine(ctx) {
  const { GRID, DT, N_CELLS, gamma, isat } = ctx;

  // ── the symbol λ(k) grid, cached per kernelVer (the gate-D diagonalization of the live ring) ──
  let _lamCache = { ver: -9999, lam: null };
  const lambda = () => { const rc = ctx.ringCache(); if (!rc?.r?.length) return null;
    const ver = ctx.kernelVer();
    if (_lamCache.ver !== ver) _lamCache = { ver, lam: kernelLambdaGrid(rc.r, rc.w, rc.o, GRID) };
    return _lamCache.lam; };

  // ── SCALE-SELECTIVE λ (the tier-decomposition theorem cashed): the propagator is EXACTLY additive over the
  //    ring scale-tiers (λ_merged = Σ_d λ_tier − (n−1)·lap9, f64-pinned). So a λ built from a RADIUS BAND of the
  //    rings propagates ONLY that scale's structure — coarse (large radius = the smooth skeleton) or fine (small
  //    radius = the speckle detail). Exact by the theorem, not an approximation. The band λ = lap9 + only the
  //    in-band rings' contribution. Cached per (kernelVer, band). rMid splits at the geometric mean.
  let _lamScaleCache = { key: '' };
  const rMid = () => { const rc = ctx.ringCache(); if (!rc?.r?.length) return 0; const r = rc.r; return Math.sqrt(Math.max(...r) * Math.min(...r)); };
  const lambdaScale = (band) => { const rc = ctx.ringCache(); if (!rc?.r?.length) return null; if (band === 'all') return lambda();
    const key = `${ctx.kernelVer()}:${band}`; if (_lamScaleCache.key === key) return _lamScaleCache.lam;
    const mid = rMid(); const keep = [], kw = [], ko = [];
    for (let d = 0; d < rc.r.length; d++) { const inBand = band === 'coarse' ? rc.r[d] >= mid : rc.r[d] < mid;
      if (inBand) { keep.push(rc.r[d]); kw.push(rc.w[d]); ko.push(rc.o[d]); } }
    const lam = kernelLambdaGrid(keep, kw, ko, GRID);   // lap9 + only the in-band rings (kernelLambdaGrid always includes lap9)
    _lamScaleCache = { key, lam }; return lam; };

  const specLeg = (f, T, dt, band) => { const lam = band && band !== 'all' ? lambdaScale(band) : lambda(); if (!lam || !f) return null;
    return kernelPropagateSpectral(f, null, null, null, { T, dt, G: GRID, lam }).field; };

  // ── the BAR-EXACT declaration of W (register state only — no render frac): the boundary source for a REGIONAL
  //    witness and the seam-glue reference (same math as the mirror seed / materialize). ──
  const declProject = () => { const W = ctx.wSlot(); if (!W.desc || !W.descBase) return null;
    const dphi = lensU1.wrap(lensU1.angle(ctx.lensOp(0)) - (W.descPhi0 || 0));
    const L0 = W.leash.state, ox = L0.gx - (W.descPos?.[0] ?? 0), oy = L0.gy - (W.descPos?.[1] ?? 0);
    try { return (ox || oy) ? lensC1.apply({ mode: 'metric', phase: dphi, beta: 1, omega: 0, prec: 0, gain: 1, tx: ox, ty: oy }, W.descBase, GRID)
                            : lensU1.apply({ mode: 'id', phase: dphi, beta: 1, omega: 0, prec: 0 }, W.descBase, GRID); } catch (e) { return null; } };

  // ── THE REGISTER ENGINE'S ONE-STEP KERNEL (shared by every LIVING slot): pin superpose (β replicated) → exact
  //    spectral linear step (gate D, λ-grid cache) → engine SPM phase → cap at the slot's own descE0 → f32 grain
  //    (the wire lattice = the original engine's grain). Pure fn of (slot state, shared step).
  //    FAST PATH (the GC-lag fix): the spectral call runs on a per-G scratch pool (reuse:true — zero allocation),
  //    and each slot keeps a ping-pong spare (s._eng) the result is copied into, fused with the SPM pass. Op ORDER
  //    is preserved exactly (superpose → linear → SPM → energy → cap → fround), so the bytes are identical to the
  //    allocating path — only the garbage is gone (~6 × 128 KB/step before).
  const step = (s, att, bfac) => { const lamS = lambda(); if (!lamS || !s.descBase || !s.descE0) return;
    const linearMode = ctx.linearMode();
    const psi = s.descBase;
    // PIN (linear injection lock): ON in the full medium AND in the linear SHARP TRAP (mode 2 — the pin IS the
    // linear trap); OFF only in FREE-linear (mode 1) to show the dispersing free field.
    if (att && linearMode !== 1) { const b = 0.15 * (bfac || 1); for (let j = 0; j < psi.length; j++) psi[j] += b * att[j]; }
    const ev = kernelPropagateSpectral(psi, null, null, null, { T: 1, dt: DT, G: GRID, lam: lamS, reuse: true }).field;
    const nb = (s._eng && s._eng !== psi && s._eng.length === ev.length) ? s._eng : new Float64Array(ev.length);
    if (linearMode) { const damp = linearMode === 2 ? (1 - ctx.linLeak()) : 1;   // mode 2: LINEAR damping balances the pin (driven-damped oscillator → sharp fixed point at A); mode 1: none (free dispersal)
      for (let j = 0; j < ev.length; j++) nb[j] = ev[j] * damp; }
    else for (let j = 0; j < N_CELLS; j++) { const re = ev[j * 2], im = ev[j * 2 + 1], I2 = re * re + im * im;   // nonlinear SPM (full medium)
      const th = gamma * I2 / (1 + I2 / isat) * DT, c = Math.cos(th), sn = Math.sin(th);
      nb[j * 2] = re * c - im * sn; nb[j * 2 + 1] = re * sn + im * c; }
    let e2 = 0; for (let j = 0; j < nb.length; j++) e2 += nb[j] * nb[j];
    // the CAP (nonlinear energy renormalization) runs ONLY in the full medium; the linear modes use their own
    // linear energy handling (mode 1: none, conserves; mode 2: the linear leak above balances the pin).
    const sc = Math.sqrt(s.descE0 / (e2 || 1)); if (!linearMode && e2 > 1e-9) for (let j = 0; j < nb.length; j++) nb[j] *= sc;
    for (let j = 0; j < nb.length; j++) nb[j] = Math.fround(nb[j]);
    s._engE = e2;   // pre-cap energy (pure fn of shared k) — the UNPINNED coevo gate's field reading in ⌀PDE
    s._eng = psi; s.descBase = nb; };

  // ── CROSS-SLOT ATTRACTOR COUPLING (real, physical — the U1 register form of the old shared-substrate "β mixes
  //    slots"). Slot i's pin target = its own att + Σ_j κ_ij · (slot j's FIELD): the soliton is pulled toward a
  //    coupled neighbor's shape, so it physically DEFORMS toward it (V observing W → V's letter bleeds toward W's).
  //    Driven by the SAME edge κ as the Kuramoto phase law (consistent: an edge means "these slots interact"), so
  //    it rides regH via _K.edge — deterministic, byte-replicated. κ>0 attracts (blend), κ<0 repels (anti-blend).
  //    snap = the same-step frozen field (turbo); slots' descBase (CPU, per-step current) otherwise. ──
  // fieldMix gate (app-owned, replicated): an edge ALWAYS drives the Kuramoto PHASE law (app-side); this gate governs
  //   only the SECOND layer — the attractor FIELD-mixing here. false → coupledAtt returns the bare att (phases still
  //   entrain, but the soliton shape does NOT bleed toward the neighbor). Default true = the current behavior (byte-
  //   identical when the getter is absent). It must be replicated, not peer-local: it changes descBase (in regH).
  const coupledAtt = (i, baseAtt, snap) => { const edge = ctx.edge(); if (!edge || !baseAtt) return baseAtt;
    if (ctx.fieldMix && !ctx.fieldMix()) return baseAtt;   // field-mixing OFF: edge couples PHASE only, shapes stay pure
    let any = false; for (let jc = 0; jc < 4; jc++) if (jc !== i && edge[i][jc]) any = true;
    if (!any) return baseAtt;
    const slots = ctx.slots();
    const out = Float64Array.from(baseAtt);
    for (let jc = 0; jc < 4; jc++) { const kk = edge[i][jc]; if (!kk || jc === i) continue;
      const sj = slots[jc]; if (!sj.desc || (jc > 0 && !sj.descLive)) continue;
      const fj = snap ? snap[jc] : sj.descBase; if (!fj) continue;
      for (let n2 = 0; n2 < out.length; n2++) out[n2] += kk * fj[n2]; }
    return out; };

  // ── THE REGION (SHARD) STEP — one engine step computed ONLY inside the region (regionStepX: bit-identical inside
  //    R by the light-cone margins, cost ∝ |R|); same pin→linear→SPM→cap→fround order as `step`, scissored to R
  //    (the outside is never renormalized — the GPU-shard scissor discipline). ──
  const stepRegion = (s, att, bfac, reg) => { const rc = ctx.shardRing(); if (!rc?.r?.length || !s.descBase || !s.descE0) return;
    const psi = s.descBase;
    if (att) { const b = 0.15 * (bfac || 1);
      for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2; psi[j] += b * att[j]; psi[j + 1] += b * att[j + 1]; } }
    const nb = (s._eng && s._eng !== psi && s._eng.length === psi.length) ? s._eng : new Float64Array(psi.length);
    regionStepX(psi, rc.r, rc.w, rc.o, DT, GRID, reg, { out: nb });
    for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2;
      const re = nb[j], im = nb[j + 1], I2 = re * re + im * im;
      const th = gamma * I2 / (1 + I2 / isat) * DT, c = Math.cos(th), sn = Math.sin(th);
      nb[j] = re * c - im * sn; nb[j + 1] = re * sn + im * c; }
    let e2 = 0; for (let j = 0; j < nb.length; j++) e2 += nb[j] * nb[j];
    const sc = Math.sqrt(s.descE0 / (e2 || 1));
    if (e2 > 1e-9) for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2; nb[j] *= sc; nb[j + 1] *= sc; }   // both directions (the true engine cap), inside R only (scissor discipline)
    for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2; nb[j] = Math.fround(nb[j]); nb[j + 1] = Math.fround(nb[j + 1]); }
    s._eng = psi; s.descBase = nb; s._texStepSynced = -1;   // sharded W is CPU-stepped → mark texture-desync (a later _tbSyncSlot re-reads correctly if unsharded); descDisp refreshed at display cadence by the caller
  };

  // ── THE REGISTER-RESIDENT sl(2) TIER (the gate-F meta-circular rung): V and V̈ are INVARIANT under the anchors
  //    (translation + global phase), so they are pure functions of descBase + the stencil — REGISTER content.
  //    W.sl2 = {V, vdd, I, kv} is captured at every compile door (wabs/autoc), RE-KEYED lazily when kernelVer
  //    moves (the rekeyTest-validated law: same envelope, new stencil). ──
  const mkSl2 = (env) => { const rc = ctx.ringCache(); if (!rc?.r?.length || !env) return null;
    const sm = secondMomentTorus(env, GRID);
    const sE = Math.min(48, Math.max(2, Math.sqrt(sm.V / (2 * (sm.P || 1)))));
    const Dq = packetD(rc.r, rc.w, rc.o, sE);
    const spec = virialSpec(env, GRID, { gamma, isat });   // ONE FFT, at the door — the spectrum IS compile content
    const vdd = virialRateX(null, rc.r, rc.w, rc.o, GRID, { gamma, isat, Dq, spec, lam: lambda() });   // FD-on-λ v_g (≈1.7% bias, telemetry-grade)
    return { V: sm.V, vdd, I: vdd * sm.V, kv: ctx.kernelVer(), m: sm.m, spec, Dq }; };

  // RE-KEY = a pure stencil re-sum over the cached spectrum (FFT-free): V, m, spec are stencil-independent.
  const sl2Rekey = (sl2) => { const rc = ctx.ringCache(); if (!rc?.r?.length || !sl2?.spec) return null;
    const vdd = virialRateX(null, rc.r, rc.w, rc.o, GRID, { gamma, isat, Dq: sl2.Dq, spec: sl2.spec, lam: lambda() });   // FD-on-λ
    return { V: sl2.V, vdd, I: vdd * sl2.V, kv: ctx.kernelVer(), m: sl2.m, spec: sl2.spec, Dq: sl2.Dq }; };

  return { lambda, lambdaScale, rMid, specLeg, declProject, step, coupledAtt, stepRegion, mkSl2, sl2Rekey };
}

// buildNativeKernel(fracKernel, fracAlpha, maxBands) — THE LIVE-RING BUILDER (radii → weighted ring bands), pure.
// Extracted from krestianstvo-wavefront-physics.js (where it lives baked into the world-program string, so it wasn't
// importable). fracKernel = a flat list of ring RADII (one per fresnel beat / cascade firing — repeats encode weight);
// counts them into distinct radii, weights each by fracAlpha·count/total, merges excess bands into the nearest kept
// radius (top maxBands by count), and estimates the emergent self-similar exponent sEff (log-log slope of w vs r).
// This is the pure half of the reducer's live recompute — a thin app running its OWN IFS clock can call it to turn
// the clock's radii into a ring, without the reducer's replicated/reactive fresnel machinery. Returns {fRadii, fWeights, sEff}.
export function buildNativeKernel(fracKernel, fracAlpha, maxBands) {
  const countMap = new Map();
  for (const r of fracKernel) countMap.set(r, (countMap.get(r) ?? 0) + 1);
  const totalBeats = fracKernel.length || 1;
  let fRadii = [...countMap.keys()].sort((a, b) => a - b);
  if (maxBands && fRadii.length > maxBands) {   // merge excess bands by weight — keep top maxBands by count, fold the rest into the nearest kept radius
    const byCount = fRadii.slice().sort((a, b) => countMap.get(b) - countMap.get(a));
    const kept = new Set(byCount.slice(0, maxBands));
    const mergedCount = new Map();
    for (const r of fRadii) {
      if (kept.has(r)) { mergedCount.set(r, (mergedCount.get(r) ?? 0) + countMap.get(r)); }
      else { let nearest = byCount[0], minD = Math.abs(r - nearest);
        for (const kr of kept) { const d = Math.abs(r - kr); if (d < minD) { minD = d; nearest = kr; } }
        mergedCount.set(nearest, (mergedCount.get(nearest) ?? 0) + countMap.get(r)); }
    }
    fRadii = [...kept].sort((a, b) => a - b);
    fRadii.forEach((r) => countMap.set(r, mergedCount.get(r) ?? countMap.get(r)));
  }
  const fWeights = fRadii.map((r) => fracAlpha * countMap.get(r) / totalBeats);
  let sEff = 0;
  if (fRadii.length >= 2) {
    const logR = fRadii.map((r) => Math.log(r)), logW = fWeights.map((w) => Math.log(w + 1e-30)), n = fRadii.length;
    const mR = logR.reduce((a, b) => a + b, 0) / n, mW = logW.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (logR[i] - mR) * (logW[i] - mW); den += (logR[i] - mR) ** 2; }
    sEff = den > 1e-10 ? -num / (2 * den) : 0;
  }
  return { fRadii, fWeights, sEff };
}

// buildRingOffsets(fRadii) — each radius r → an Int16Array of the (dx,dy) integer lattice offsets around a circle
// of radius r (≥8 steps, ~2πr for dense rings). Pure; the geometric half of the live-ring builder (verbatim from
// the physics file). Returns fRadii.map(r → Int16Array). Pair with buildNativeKernel's fRadii → the ringCache offsets.
export function buildRingOffsets(fRadii) {
  return fRadii.map((r) => {
    const nSteps = Math.max(8, Math.ceil(2 * Math.PI * r));
    const flat = new Int16Array(nSteps * 2);
    for (let kk = 0; kk < nSteps; kk++) { flat[kk * 2] = Math.round(r * Math.cos(kk * 2 * Math.PI / nSteps)); flat[kk * 2 + 1] = Math.round(r * Math.sin(kk * 2 * Math.PI / nSteps)); }
    return flat;
  });
}

// makeRingProvider(ifsClock, { alpha, maxBands, gridR }) — a LIVE IFS RING for a thin app, driven by its OWN core
// makeIFSClock (the ℂ* cascade — already pure/core), NOT the world reducer's replicated fresnel machinery. Each tick
// advances the clock and, when its ring set CHANGES, rebuilds the ringCache (buildNativeKernel + buildRingOffsets)
// and bumps a version. So a thin app gets a DYNAMIC fractal ring (the clock breathes the kernel) instead of a static
// simpleRing — feed .ring() to makeFieldMatter (or the engine's ringCache getter) and .version() to kernelVer.
//   ifsClock — a makeIFSClock instance (the app owns it: launch/advance/save/restore ride the app's determinism).
//   alpha (default 0.03 = FRAC_ALPHA) · maxBands (default 4 = MAX_IFS_BANDS) · gridR (max radius kept, default 24).
// Returns { tick(kp), ring(), version(), clock } — tick(kp) advances the clock at proper step kp (returns {beat}).
// NOTE: the app must advance this at SHARED steps (the determinism law) — the provider is pure given (kp, clock state).
export function makeRingProvider(ifsClock, { alpha = 0.03, maxBands = 4, gridR = 24 } = {}) {
  let ring = simpleRing(3), version = 0, lastRadiiStr = '';
  const rebuild = () => {
    const kernel = ifsClock.kernel();   // [{r, a}] — the accumulated ring set (radius + amplitude)
    // flatten to a fracKernel (radii list, weighted by rounded amplitude) so buildNativeKernel's count-weighting
    // reflects each ring's strength; keep only r < gridR (the physics guard).
    const frac = [];
    for (const e of kernel) { if (e.r < gridR) { const w = Math.max(1, Math.round(e.a * 4)); for (let c = 0; c < w; c++) frac.push(e.r); } }
    const radiiStr = frac.slice().sort((a, b) => a - b).join(',');
    if (radiiStr === lastRadiiStr) return false;   // no change → keep the ring + version (kernelVer stable)
    lastRadiiStr = radiiStr;
    if (!frac.length) { ring = simpleRing(3); version++; return true; }   // empty → fall back to the static ring
    const { fRadii, fWeights } = buildNativeKernel(frac, alpha, maxBands);
    ring = { r: fRadii, w: fWeights, o: buildRingOffsets(fRadii).map((o) => Float64Array.from(o)) };
    version++; return true;
  };
  return {
    clock: ifsClock,
    tick: (kp) => { const r = ifsClock.advance(kp); rebuild(); return r; },   // advance the cascade + rebuild the ring if it changed
    refresh: () => rebuild(),   // rebuild the ring from the clock's CURRENT kernel WITHOUT advancing (for an app that advances the clock itself, e.g. ifsclock's stepSlot)
    ring: () => ring, version: () => version,
  };
}

// simpleRing(r, n) — a single small IFS ring kernel: n offsets on a circle of radius r (default 8 axis+diagonal),
// weight split. The minimal ring that turns the engine's lap9 into a real DISPERSIVE medium (a static stand-in for
// the fractal clock's kernel — a thin app has no clock, so a fixed ring is its dispersion). This is the recipe
// observers and rhythm each hand-rolled identically. Returns { r:[…], w:[…], o:[Float64Array] } (the ringCache shape).
export function simpleRing(r = 3, n = 8, weight = 0.5) {
  const off = [];
  for (let a = 0; a < n; a++) { const th = a * 2 * Math.PI / n; off.push(Math.round(r * Math.cos(th)), Math.round(r * Math.sin(th))); }
  return { r: [r], w: [weight], o: [Float64Array.from(off)] };
}

// makeFieldMatter(opts) — TURNKEY FIELD MATTER: a real ψ-field medium a thin app can OPT INTO in one line, without
// hand-rolling the ring cache + engine-slot adapters + makeRegisterEngine ctx + seed (the ~40 lines observers and
// rhythm each copied). It wraps makeRegisterEngine (the shared meta-circular step: pin → spectral lap9+ring → SPM →
// cap → f32) and owns the PLUMBING; the app supplies only its MATTER SHAPE (the seed's bump list) and its register
// (lensOp) — the same mechanism-to-core / content-stays-app boundary as the rest of the arc. A thin app with no rich
// matter thus gets the full abstract medium as its matter, exactly like medium-u1 / observers / rhythm's field mode.
//   opts.G        grid side (default 16 — small = cheap CPU, deterministic). N = G².
//   opts.slots    slot count (default 4). opts.ring — the ringCache (default simpleRing(3)).
//   opts.gamma/isat/dt   the engine step constants (default 20 / 1 / 0.12 — the medium-u1 recipe).
//   opts.lensOp(i)  → slot i's lens register (for the pin's ∠/β; the app owns it). Default: identity (β=1).
//   opts.linearMode() → 0 full · 1 free · 2 sharp-trap (default 0). opts.edge() → coupling matrix (default null).
// Returns:
//   slots       — the per-slot engine-slot adapters (pass slots[i] to step; descBase/descE0/descAtt live here).
//   G, N, ring  — the geometry (for the app's own reads).
//   seed(i, bumps)      — stand up slot i's ψ from a bump list [{cx,cy,sg,amp,ph?}] (Gaussian, deterministic, no RNG);
//                         sets descE0 = the seed energy (the cap holds it there). Returns the field.
//   seedAtt(i, bumps)   — the same for the PIN attractor (descAtt). Pass the pin's target shape.
//   step(i, bfac=1)     — one engine step on slot i, pinned toward its att (bfac scales the pin; the app maps its
//                         own historical pin strength through this, e.g. BETA/0.15).
//   field(i)/setField/att(i)/energy(i)  — reads/writes.
//   spectrum(i, nBands) — the radial-FFT bands of |ψ|² (spatial-frequency content), normalized to [0,1]. Generic
//                         (rhythm reads it as overtone timbre; any app can read a field's spectral shape). null if unseeded.
//   save()/restore(arr, {deserialize}) — the field snapshot slice (fields + E0; the app's typed-array codec via hook).
export function makeFieldMatter(opts = {}) {
  const G = opts.G || 16, N = G * G;
  const names = opts.names || ['W', 'V', 'P1', 'P2'];
  // ring may be: a static ringCache {r,w,o}; a makeRingProvider (has .ring()/.version() — a LIVE fractal ring that
  // breathes as the app's IFS clock fires); or omitted → the static simpleRing(3). The engine reads it through
  // getters, so a live provider's changing ring + version drive the λ-grid cache invalidation exactly like the full
  // app's fractal clock does. (opts.ringProvider is an explicit alias for the live case.)
  const provider = opts.ringProvider || (opts.ring && typeof opts.ring.ring === 'function' ? opts.ring : null);
  const staticRing = provider ? null : (opts.ring || simpleRing(3));
  const ringOf = () => (provider ? provider.ring() : staticRing);
  const verOf = () => (provider ? provider.version() : 1);
  const gamma = opts.gamma ?? 20, isat = opts.isat ?? 1, dt = opts.dt ?? 0.12;
  const linearMode = opts.linearMode || (() => 0);
  const edge = opts.edge || (() => null);
  // ── THE REAL SLOT BANK (not throwaway adapters): the field lives in the SAME slot type medium-u1 uses — a
  //    makeSlot with a leash (transport), a readOp (its register descriptor), born/kv/save, and the register
  //    engine's desc* contract (descBase/descE0/descAtt) as dynamic fields (exactly how medium-u1 attaches them).
  //    So a thin app's field slots ARE the full app's slots in thin mode — leash/transport available, not stripped.
  //    The app may PASS its own observer bank (opts.bank) so the field slots share its register (readOp = bank.ops[i]);
  //    else a fresh bank is created. lensOp(i) defaults to the slot's readOp (the register the pin ages/reads).
  const bank = opts.bank || makeObserverBank(names.length);
  const sb = makeSlotBank({ names, bank, engine: null, kinds: Object.fromEntries(names.map((nm) => [nm, 'plate'])) });
  const slots = sb.slots;
  const lensOp = opts.lensOp || ((i) => slots[i].readOp);   // the pin reads the slot's own register by default
  const reg = makeRegisterEngine({
    GRID: G, DT: dt, N_CELLS: N, gamma, isat,
    ringCache: ringOf, kernelVer: verOf,
    lensOp, slots: () => slots, edge,
    linearMode, linLeak: () => 0.1, shardRing: ringOf, wSlot: () => slots[0],
  });

  const energy = (f) => { let e = 0; for (let j = 0; j < f.length; j++) e += f[j] * f[j]; return e; };
  const paint = (bumps) => { const f = new Float64Array(N * 2);   // deterministic Gaussian bumps (no RNG → byte-identical across peers)
    for (const b of (bumps || [])) { const c = Math.cos(b.ph || 0), s = Math.sin(b.ph || 0), sg = b.sg || 2, amp = b.amp ?? 1;
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const r2 = (x - b.cx) ** 2 + (y - b.cy) ** 2, a = amp * Math.exp(-r2 / (2 * sg * sg)), j = (y * G + x) * 2; f[j] += a * c; f[j + 1] += a * s; } }
    return f; };

  return {
    slots, bank, G, N, ring: ringOf,   // the REAL slots (leash/transport/readOp/save) + the register bank + the (possibly live) ring getter
    // seed slot i's field into its descBase (the engine step's contract); descE0 = the cap target; descAtt = the pin.
    seed: (i, bumps) => { const f = paint(bumps); slots[i].descBase = f; slots[i].descE0 = energy(f) || 1; slots[i].born = true; return f; },
    seedAtt: (i, bumps) => { const a = paint(bumps); slots[i].descAtt = a; return a; },
    step: (i, bfac = 1) => reg.step(slots[i], slots[i].descAtt, bfac),
    field: (i) => slots[i].descBase, setField: (i, f) => { slots[i].descBase = f; }, att: (i) => slots[i].descAtt,
    energy: (i) => (slots[i].descBase ? energy(slots[i].descBase) : 0), e0: (i) => slots[i].descE0 ?? 1,   // e0 = the seed/cap-target energy (energy(i)/e0(i) = the fill ratio)
    reg,   // the underlying engine (for lambda/specLeg/… if the app needs them)
    // the radial spectrum of |ψ|² → nBands (rhythm's timbre reader, generalized). Pure fn of the field.
    spectrum: (i, nBands = 6) => { const f = slots[i].descBase; if (!f) return null;
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let j = 0; j < N; j++) { const rr = f[j * 2], ii = f[j * 2 + 1]; re[j] = rr * rr + ii * ii; }
      fft2d(re, im, G, false);
      const bands = new Float64Array(nBands), cnt = new Float64Array(nBands), c = G / 2;
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const kx = x <= G / 2 ? x : x - G, ky = y <= G / 2 ? y : y - G;
        const kr = Math.hypot(kx, ky), b = Math.min(nBands - 1, Math.floor(kr / c * nBands)), j = y * G + x;
        bands[b] += Math.hypot(re[j], im[j]); cnt[b]++; }
      let mx = 1e-9; for (let h = 0; h < nBands; h++) { bands[h] = cnt[h] ? bands[h] / cnt[h] : 0; if (bands[h] > mx) mx = bands[h]; }
      for (let h = 0; h < nBands; h++) bands[h] /= mx; return bands; },
    // save/restore the field slice (descBase/descAtt/descE0 per slot). The app's typed-array codec via the hook; the
    // slots' CONTROL state (leash/kind/born) rides sb.save() separately if the app wants transport preserved too.
    save: ({ serialize = (f) => (f ? Array.from(f) : null) } = {}) => ({ fields: slots.map((s) => serialize(s.descBase)), atts: slots.map((s) => serialize(s.descAtt)), E0: slots.map((s) => s.descE0 ?? 1) }),
    restore: (s, { deserialize = (v) => (v ? Float64Array.from(v) : null) } = {}) => { if (!s) return;
      for (let i = 0; i < slots.length; i++) { slots[i].descBase = deserialize(s.fields?.[i]); slots[i].descAtt = deserialize(s.atts?.[i]); slots[i].descE0 = s.E0?.[i] ?? 1; slots[i].born = !!slots[i].descBase; } },
  };
}

// makeEye(source) — THE U(1) EYE as a MEDIUM-AGNOSTIC RECONSTRUCTION. A register is a compact description of a wave
// (∠φ, k tilt, ω precession, β, translation) over a recorded ENVELOPE; rendering it to GPU pixels is just ONE
// reconstruction of that description. This factory produces the SIGNAL in a requested feature space — the same linOp
// phasor content(x−off)·e^{i(φ+k·(x−c))} medium-u1's renderDescField draws — as a PURE fn of the register, with no
// device. Each app then has a thin SINK (a WebGL shader, a WebAudio graph, a canvas 2d ctx) that pushes this signal
// to its medium: the register renders to ANY output because core computes the medium-agnostic signal and the sink is
// pluggable and app-side. (The no-tricks law: the signal is computed ONCE, deterministically; every sink is a faithful
// projection of the SAME state — GPU pixels, audio overtones, and a clock hand all read one register, never faked.)
//   THE OUTPUT-CONCEPT AWARENESS (what core now knows): a register can be RECONSTRUCTED INTO A SIGNAL — a ψ field, its
//   spectrum, or its scalar phase/angle. It does NOT know GPU/audio/canvas exist; it produces what those consume.
//   source — getters describing the register to render (all optional; a bare {} yields nulls):
//     op()       → the lens descriptor { phase, k?, beta, omega, prec, tx?, ty?, mode? } (the register). Default id.
//     envelope() → the recorded complex ψ profile the phasor rotates (descBase/w0). Null → a phase-only eye (scalars only).
//     pose()     → { dphi, ox, oy } the AGING phase Δ∠ + leash offset (medium-u1's _descPose); default {dphi:op.phase}.
//     G()        → the grid side (for the field reconstruction). Default 0.
//   reconstruct(as, nBands?) — the signal in a feature space:
//     'field'    → the reconstructed ψ = lensC1.apply(op@pose, envelope, G) — the pixel/canvas sink's input (Float64 [re,im,…]).
//     'spectrum' → radial |ψ|² FFT bands [0,1] (the audio sink's overtones; nBands default 6). Needs a field.
//     'phase' | 'angle' → the register's total angle lensU1.angle(op) (a scalar; the canvas clock-hand / audio detune).
//     'intensity'→ total |ψ|² energy (a scalar loudness/brightness). Needs a field.
//   Convenience: field(), spectrum(n), angle(), intensity().
export function makeEye(source = {}) {
  const opOf = source.op || (() => lensU1.id());
  const envOf = source.envelope || (() => null);
  const gOf = source.G || (() => 0);
  const poseOf = source.pose || (() => { const o = opOf(); return { dphi: o.phase || 0, ox: 0, oy: 0 }; });
  const field = () => { const env = envOf(); if (!env) return null; const G = gOf() || Math.round(Math.sqrt(env.length / 2)); const P = poseOf();
    try { return (P.ox || P.oy) ? lensC1.apply({ mode: 'metric', phase: P.dphi, beta: 1, omega: 0, prec: 0, gain: 1, tx: P.ox, ty: P.oy }, env, G)
                                : lensU1.apply({ mode: 'id', phase: P.dphi, beta: 1, omega: 0, prec: 0 }, env, G); } catch (e) { return null; } };
  const spectrum = (nBands = 6) => { const f = field(); if (!f) return null; const G = gOf() || Math.round(Math.sqrt(f.length / 2)), N = G * G;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let j = 0; j < N; j++) { const rr = f[j * 2], ii = f[j * 2 + 1]; re[j] = rr * rr + ii * ii; }
    fft2d(re, im, G, false);
    const bands = new Float64Array(nBands), cnt = new Float64Array(nBands), c = G / 2;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const kx = x <= G / 2 ? x : x - G, ky = y <= G / 2 ? y : y - G;
      const kr = Math.hypot(kx, ky), b = Math.min(nBands - 1, Math.floor(kr / c * nBands)), j = y * G + x;
      bands[b] += Math.hypot(re[j], im[j]); cnt[b]++; }
    let mx = 1e-9; for (let h = 0; h < nBands; h++) { bands[h] = cnt[h] ? bands[h] / cnt[h] : 0; if (bands[h] > mx) mx = bands[h]; }
    for (let h = 0; h < nBands; h++) bands[h] /= mx; return bands; };
  const angle = () => lensU1.angle(opOf());
  const intensity = () => { const f = field(); if (!f) return 0; let e = 0; for (let j = 0; j < f.length; j++) e += f[j] * f[j]; return e; };
  return {
    field, spectrum, angle, intensity,
    reconstruct: (as, nBands = 6) => (as === 'field' ? field() : as === 'spectrum' ? spectrum(nBands)
      : (as === 'phase' || as === 'angle') ? angle() : as === 'intensity' ? intensity() : null),
  };
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ── MERGED FROM medium-u1-holography.js ── THE ABSTRACT U1 HOLOGRAM (makeHologramBank)
// (was a separate file; consolidated into medium-core.js — the one abstract-medium module. medium-gpu.js
//  stays separate because it is WebGL-bound and would break core's headless purity.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// medium-u1-holography.js — THE ABSTRACT U1 HOLOGRAM, extracted from medium-u1.js (extraction ladder rung after
//   medium-u1-engine). The U1 register's MEMORY, freed from the app so any thin app (medium-u1, observers, rhythm,
//   …) banks + recalls moments with one shared, tested implementation instead of a hand-rolled copy each.
//
//   THE IDEA (why holography, literally): a moment is banked as a DUAL PLATE — a field IMAGE and its descriptor
//   ALGEBRA — and retrieved by CORRELATION, not by address. Two independent readings of the same recall must agree:
//     • the FIELD path — bind the cue against the bank by amplitude overlap, lift the winner (an image reconstruction);
//     • the DESCRIPTOR path — the same read in CLOSED FORM on the 6-float register copy alone (no field).
//   And the aging between store and recall is measured BOTH ways — from the field bytes (phaseCorr) and from the
//   register (∠now − ∠stored) — the |field − equation| ≈ 0 EQUIVALENCE that is the whole U1 story's headline.
//
//   PLUGGABLE PROPAGATION (the generalization): medium-u1 stores a ±T SPECTRAL LEG (a genuine hologram — the plate
//   is an interference record, recall is a backward propagation). A phase-only thin app has no propagation: its plate
//   is the RAW field and recall is plain correlation. Both are the SAME structure with a different `leg` — so `leg`
//   is a ctx hook, default IDENTITY. A hologram over non-propagating matter is just content-addressable recall; the
//   spectral leg turns it into optical holography. One module, both regimes.
//
//   ctx (all optional except where noted):
//     leg(field, sign, scale?) → propagate field by sign·T (medium-u1: the spectral leg; default: identity copy).
//                                Used at STORE (+) to make the plate and at LIFT (−) to reconstruct.
//     corr(a, b)               → amplitude overlap ∈ [0,1] for binding (default: ampCorr).
//     phaseCorr(a, b)          → the overlap ANGLE (the field-measured aging; default: the core phaseCorr).
//     shiftScan(a, b)          → { corrMax, dx, dy } shift-invariant bind (default: crossCorrScan). Only if used.
//     shift(field, dx, dy)     → translate a field (default: spectralShift). Only if xshift recall is used.
//     angleOf(register)        → the register's total angle (default: lensU1.angle).
//     wrap(x)                  → wrap to (−π,π] (default: lensU1.wrap).
//     beatsOf(name)            → worldline beat count for the Δτ readout (default: () => null).
//     G                        → grid side (needed only for shiftScan/shift).
//     bankMax                  → ring-buffer size (default 4).
//     sigma                    → recalla content-address width in px (default 6).
//     f32                      → quantize plate bytes to f32 at store (default true — the wire-lattice discipline;
//                                a leader keeping f64 while a joiner restores f32 splits recall's argmax at the margin).
//
//   A PLATE = { p (field image), dop (register copy), pos, obj, w0 (dressed profile), bw (beats at store), k (step) }.
//   All arithmetic is CPU f64 at the caller's shared drain step → in the determinism contract, byte-identical on peers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

const _quantF32 = (f) => Float64Array.from(Float32Array.from(f));

export function makeHologramBank(ctx = {}) {
  const G = ctx.G || 0;
  const BANK_MAX = ctx.bankMax || 4;
  const SIG = ctx.sigma || 6;
  const useF32 = ctx.f32 !== false;
  const leg = ctx.leg || ((f) => (f ? Float64Array.from(f) : null));   // default propagation = identity copy (raw-field recall)
  const corr = ctx.corr || ampCorr;
  const phCorr = ctx.phaseCorr || phaseCorr;
  const shiftScan = ctx.shiftScan || ((a, b) => crossCorrScan(a, b, G));
  const shift = ctx.shift || ((f, dx, dy) => spectralShift(f, dx, dy, G));
  const angleOf = ctx.angleOf || ((op) => lensU1.angle(op));
  const wrap = ctx.wrap || ((x) => lensU1.wrap(x));
  const beatsOf = ctx.beatsOf || (() => null);

  const plates = [];

  // store(field, register, meta) — bank a moment. field → (optionally propagated) plate IMAGE `p`; register → the
  // descriptor `dop`; meta carries pos/obj/w0/bw/k. Returns the banked plate.
  //   THE TWO REGIMES (the honest typing rule): a FIELD plate has `p` (bind by amplitude overlap, lift reconstructs
  //   the image, aging measures the field-Δφ). A NON-FIELD plate has `meta.m` instead (arbitrary matter — an M/O
  //   pair, an IFS genome — bound by a pluggable `metric`, NO lift, aging is descriptor-only). `p` and `m` are
  //   distinct slots; a plate may carry either. `register` (the algebra half) is ALWAYS present — it is what makes
  //   the aging readout work for every matter. Pass field=null + meta.m=… for the non-field case.
  const store = (field, register, meta = {}) => {
    let p = field != null ? leg(field, +1, meta.scale) : null;
    if (p && useF32) p = _quantF32(p);
    const plate = {
      p, m: meta.m ?? null, dop: { ...register },   // p = field image (nullable) · m = non-field matter (nullable) · dop = the register
      pos: meta.pos ? [meta.pos[0], meta.pos[1]] : null,
      obj: meta.obj ?? null,
      w0: meta.w0 != null ? (useF32 ? _quantF32(meta.w0) : Float64Array.from(meta.w0)) : null,
      bw: meta.bw != null ? meta.bw : (beatsOf(meta.name || 'W') ?? 0),
      k: meta.k ?? 0,
    };
    plates.push(plate);
    if (plates.length > BANK_MAX) plates.shift();
    return plate;
  };

  // bind(cue, {xshift, scale, metric}) — content-address: score the cue against every plate, return the argmax.
  //   FIELD bind (no metric): propagate the cue to plate space (leg), score amplitude overlap corr(cueLeg, plate.p)
  //     — or shift-invariantly (shiftScan) with xshift, reporting the winning offset. cueLeg rides the result for
  //     the field-Δφ aging.
  //   METRIC bind (metric given): score metric(cue, plate.m) on the NON-FIELD matter directly — the cue is whatever
  //     the app's matter is (an M-element, a genome), NOT a field; no leg, no cueLeg (aging will be descriptor-only).
  //     THE GENERALIZATION: the hologram is a correlation memory over a PLUGGABLE similarity; the field/ampCorr case
  //     is one instance. metric(cue, plate.m) → a scalar (higher = closer). Plates without `m` score −Infinity.
  // Returns { index, plate, scores, corr, shift:[dx,dy], cueLeg } or null if the bank is empty.
  const bind = (cue, { xshift = false, scale, metric = null } = {}) => {
    if (!plates.length || cue == null) return null;
    if (metric) {   // METRIC bind (non-field matter): score by the app's similarity on plate.m
      let best = 0, bc = -Infinity;
      const scores = plates.map((pl, i) => { const c = (pl.m != null) ? metric(cue, pl.m) : -Infinity;
        if (c > bc) { bc = c; best = i; } return +(Number.isFinite(c) ? c : 0).toFixed(3); });
      return { index: best, plate: plates[best], scores, corr: bc, shift: [0, 0], cueLeg: null };   // no cueLeg → agingReadout is descriptor-only (honest: no field to measure)
    }
    const c0 = leg(cue, +1, scale);
    let best = 0, bc = -1, bestD = [0, 0];
    const scores = plates.map((pl, i) => { let c, d = [0, 0];
      if (!pl.p) { c = 0; }
      else if (xshift) { const r = shiftScan(c0, pl.p); c = r.corrMax; d = [r.dx, r.dy]; }
      else c = corr(c0, pl.p);
      if (c > bc) { bc = c; best = i; bestD = d; } return +c.toFixed(3); });
    return { index: best, plate: plates[best], scores, corr: bc, shift: bestD, cueLeg: c0 };
  };

  // lift(plate, {scale, shift:[dx,dy]}) — reconstruct the IMAGE: the backward leg of the plate (relocated if a shift
  // is given). Returns the lifted field (a fresh array). For the identity leg this is just the stored plate (± shift).
  const lift = (plate, { scale, shift: sh = [0, 0] } = {}) => {
    if (!plate?.p) return null;
    let out = leg(plate.p, -1, scale);
    if (out && (sh[0] || sh[1])) out = shift(out, -sh[0], -sh[1]);
    return out;
  };

  // bindDesc(pos, obj) — the DESCRIPTOR-ONLY recall (recalla): closed-form content-address with NO field. Two
  // translated copies of one base object overlap as the autocorrelation of the probe ≈ exp(−|Δpos|²/2σ²); a
  // cross-object plate (different obj) scores 0. Returns { index, plate, scores } or null. This is the 𝔸-path.
  const bindDesc = (pos, obj) => {
    if (!plates.length) return null;
    const cx = pos?.[0] ?? 0, cy = pos?.[1] ?? 0;
    let best = 0, bc = -1;
    const scores = plates.map((pl, i) => { const dx = (pl.pos?.[0] ?? 0) - cx, dy = (pl.pos?.[1] ?? 0) - cy;
      const c = (pl.obj && obj && pl.obj !== obj) ? 0 : Math.exp(-(dx * dx + dy * dy) / (2 * SIG * SIG));
      if (c > bc) { bc = c; best = i; } return +c.toFixed(3); });
    return { index: best, plate: plates[best], scores, corr: bc };
  };

  // agingReadout(plate, cueLeg, registerNow) — THE DUAL-LAYER [RECALL-∠] proof, as a value. Returns:
  //   dField   — aging measured from the FIELD BYTES: arg⟨plate, cueLeg⟩ (both in plate space → common propagation
  //              cancels, leaving pure aging). null if either field is missing (descriptor-only recall).
  //   dDesc    — aging from the 6-FLOAT register: ∠now − ∠stored (the Σω difference; handles a CHANGING ω exactly,
  //              which naive ω·Δτ does not).
  //   dTau     — Δτ in beats (beatsOf(name) − plate.bw).
  //   dOmegaTau— ω·Δτ, the CLOSED-FORM special case (exact only if ω was constant since store; shown for comparison).
  //   eqErr    — |dField − dDesc|: the equivalence. < tol ⇒ "the macro-law describes the micro-physics".
  //   agree    — eqErr == null || eqErr < tol.
  // The caller logs it however it likes; this owns only the MATH (identical on every peer).
  const agingReadout = (plate, cueLeg, registerNow, { name = 'W', tol = 0.15 } = {}) => {
    const dField = (plate?.p && cueLeg) ? wrap(phCorr(plate.p, cueLeg)) : null;
    const dDesc = wrap(angleOf(registerNow) - angleOf(plate.dop));
    const dTau = (plate.bw != null) ? ((beatsOf(name) ?? 0) - plate.bw) : null;
    const dOmegaTau = (dTau != null && registerNow.omega) ? wrap(registerNow.omega * dTau) : null;
    const eqErr = (dField != null) ? Math.abs(wrap(dField - dDesc)) : null;
    return { dField, dDesc, dTau, dOmegaTau, eqErr, agree: eqErr == null || eqErr < tol };
  };

  // regenPlateAtt(plate, pos, probeOf) — regenerate a plate's attractor from the register (NOT shipped in snapshots;
  // it is a pure fn a = lensC1.apply(dop@pos, ψ_base(obj))). probeOf(obj) → the bare probe field for that object.
  // Returns the att field, or null. (Optional helper — apps with a probe model use it; others skip.)
  const regenPlateAtt = (plate, pos, probeOf) => {
    if (typeof probeOf !== 'function') return null;
    const base = probeOf(plate.obj); if (!base) return null;
    const op = { ...plate.dop, tx: (pos?.[0] ?? plate.pos?.[0] ?? 0), ty: (pos?.[1] ?? plate.pos?.[1] ?? 0),
      mode: (plate.pos ? 'metric' : plate.dop.mode) };
    try { return lensC1.apply(op, base, G); } catch (e) { return null; }
  };

  return {
    plates,
    store, bind, lift, bindDesc, agingReadout, regenPlateAtt,
    count: () => plates.length,
    clear: () => { plates.length = 0; },
    // save/restore — the bank owns the plate-snapshot STRUCTURE (which fields ride, the dop copy, the ordering); the
    // app supplies only the field WIRE ENCODING as a hook (base64 for big GPU fields, plain Array for tiny toy
    // fields — a real per-app choice, not a structural one). This is the answer to "can the register/plate snapshot
    // codec go to core?": the SHAPE does (here); the ENCODING stays a one-line app hook. `a` (the live-only att) is
    // NEVER shipped — it is a pure fn regenerated at restore (regenPlateAtt), saving 1/3 of every plate's bytes.
    //   save({serialize, serializeM})     — serialize(field)→wire (default Array.from); serializeM(matter)→wire
    //                                        (default: JSON structured clone — m is plain objects, not typed arrays).
    //   restore(arr, {deserialize, deserializeM}) — the inverse hooks. Rebuilds the bank (field p AND non-field m).
    save: ({ serialize = (f) => (f ? Array.from(f) : null), serializeM = (m) => (m != null ? JSON.parse(JSON.stringify(m)) : null) } = {}) => plates.map((pl) => ({
      p: serialize(pl.p), m: serializeM(pl.m), dop: { ...pl.dop }, pos: pl.pos ? [...pl.pos] : null,
      obj: pl.obj ?? null, w0: pl.w0 != null ? serialize(pl.w0) : null, bw: pl.bw, k: pl.k,   // a NOT shipped (regenerated)
    })),
    restore: (arr, { deserialize = (v) => (v ? Float64Array.from(v) : null), deserializeM = (m) => (m != null ? JSON.parse(JSON.stringify(m)) : null) } = {}) => {
      plates.length = 0;
      for (const pl of (arr || [])) plates.push({
        p: deserialize(pl.p), m: deserializeM(pl.m), dop: { ...pl.dop }, pos: pl.pos ? [...pl.pos] : null,
        obj: pl.obj ?? null, w0: pl.w0 != null ? deserialize(pl.w0) : null, bw: pl.bw, k: pl.k,
      });
    },
  };
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ── MERGED FROM medium-u1-slots.js ── THE OBSERVER SLOT ABSTRACTION (makeLeash / makeSlot / makeSlotBank / makeSlotMux)
// (was a separate file; consolidated into medium-core.js — the one abstract-medium module. medium-gpu.js
//  stays separate because it is WebGL-bound and would break core's headless purity.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  MEDIUM-U1 SLOTS — the observer SLOT abstraction (doc/medium-u1-slots.md). The U(1)/ℂ* register arc
//  made into the app's ORGANIZING PRINCIPLE: an observer slot is (field, readOp, clock τ, register,
//  leash), and transport / eye / perception / holography are all BEHAVIORS OF SLOTS, not separate
//  subsystems. This module owns ONLY the slot facade + the ONE leash law; the fork-critical substrate
//  (fields, mux, τ queues, GPU) stays in medium-gpu (_E) + medium-core + kwe-tau, reused not copied.
//
//  THE UNIFICATION (verified in the oracle, medium.js:1551 — "a different transport law for V than W"):
//  W transports by regenerating its attractor (makeProbeField at the eased position), V/P by rolling a
//  stored plate (rollField). The LEASH LAW (advance gx,gy toward tx,ty at ≤1px/beat × the lock-slack
//  sigmoid) is IDENTICAL for every slot — the only per-slot difference is `movAtt(gx,gy)`. So transport
//  is not a special drive: it is the W slot's leash with a REGENERABLE movAtt. One leash, N slots.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// makeLeash() — the per-slot chase command + eased position + τ-cadence cursor (the 9-field record the
// oracle carried as _V.virt* globals, now owned per slot). go/tx/ty = the command; gx/gy = the eased
// operator position (where movAtt regenerates/rolls to); ll/l0 = the live/baseline lock; lt/lk = the
// τ_i cadence cursor (last slot-beat consumed / kp at last advance). reset() releases an in-flight chase.
export function makeLeash() {
  const L = { go: false, tx: 0, ty: 0, gx: 0, gy: 0, ll: 1, l0: 0, lt: 0, lk: 0 };
  return {
    state: L,
    virtGo(tx, ty) { L.go = true; L.tx = tx; L.ty = ty; L.l0 = 0; L.lt = -1; L.lk = 0; },   // COMMAND a fresh target; lt=-1 = command-fresh → first advance fires immediately, baseline re-learns
    setTarget(tx, ty) { L.go = true; L.tx = tx; L.ty = ty; },   // MOVE the target WITHOUT re-arming (objorbit's continuous motion; must NOT reset l0/lt each frame — that would freeze the eased chase)
    release() { L.go = false; L.tx = 0; L.ty = 0; L.gx = 0; L.gy = 0; L.l0 = 0; L.lt = 0; L.lk = 0; },
    save: () => ({ ...L }),
    restore: (s) => { if (s) Object.assign(L, s); },
  };
}

// THE LEASH LAW (verbatim from the oracle _leashAdvance, generalized): advance the eased position (gx,gy)
// toward the target (tx,ty) by ≤1px/beat × a slack sigmoid. THREE MODES (the sig throttle is the ⟲coevo
// Einstein loop — "matter tells geometry how far it may go"; the DIFFERENCE is WHICH matter observable gates it):
//   • FIELD-FED (field != null, corr supplied): sig paces on ampCorr(field, mov) — the soliton stalls when it loses
//     COHERENCE with its target. Reads the FIELD → NOT replay-safe (per-peer field noise → gx forks). The oracle form.
//   • GAIN-GATED (field == null, gainOf supplied): sig paces on a DESCRIPTOR ENERGY observable g = gainOf(L) ∈ (0,1]
//     — matter's ENERGY STATE throttles its own transport. This is the HONEST ℂ* Einstein loop (doc §"why can't the
//     Einstein loop be achieved — IT CAN"): the back-reaction SURVIVES but the sensor is a REGISTER coordinate, not the
//     field. When gainOf is a pure fn of leash state (the descriptor-predicted lag), gx/gy stays exact → in regH →
//     replay-safe. (An unpinned slot may pass a FIELD-measured gainOf for true energy back-reaction — its choice.)
//   • DESCRIPTOR-ONLY (field == null, no gainOf): sig = 1, full deterministic ≤1px/beat, a PURE fn of leash state.
//     The DOP-DRIVEN REPLAY default (no back-reaction; the target moves open-loop, the pinned soliton follows).
// Returns the new moving attractor (for setObjField), or null if not chasing.
export function leashAdvance(L, field, movAtt, corr, gainOf) {
  if (!L.go) return null;
  const mov0 = movAtt(L.gx, L.gy); if (!mov0) return null;
  let sig = 1;
  if (field && corr) { L.ll = corr(field, mov0);   // FIELD-FED pacing (not replay-safe; kept for the field-driven modes)
    if (L.l0 <= 0) L.l0 = L.ll || 1; else L.l0 = L.l0 * 0.98 + L.ll * 0.02;   // slow always-learning baseline
    sig = Math.max(0, Math.min(1, (L.ll / Math.max(1e-6, L.l0) - 0.75) * 4)); }   // the ⟲coevo sigmoid
  else if (gainOf) { const g = gainOf(L); L.ll = g;   // GAIN-GATED (ℂ* honest back-reaction): energy throttles transport
    // sig ∈ [0,1] rises with the gain observable: g≥1 (matter kept up) → full advance; g→0 (matter lagging) → target waits.
    // Same shape as the coevo sigmoid but on the DESCRIPTOR energy, so (if gainOf is descriptor-derived) gx/gy stays exact.
    sig = Math.max(0, Math.min(1, (g - 0.25) / 0.5)); }
  else { L.ll = 1; }   // DESCRIPTOR-ONLY: full advance, no read → gx/gy is a pure fn of the shared step (replay-safe)
  const dx = L.tx - L.gx, dy = L.ty - L.gy, d = Math.hypot(dx, dy);   // ≤1px per beat in ANY direction (normalized step)
  if (d > 1e-9) { const st = Math.min(1, d) * sig; L.gx += (dx / d) * st; L.gy += (dy / d) * st; }
  return movAtt(L.gx, L.gy);
}

// leashGainPredicted(L, maxLag) — the DESCRIPTOR-derived energy observable for the gain-gated Einstein loop: a pure
// function of leash state (no field). Models "how much has matter fallen behind its target": g = 1 − min(1, lag/maxLag)
// where lag = |target − eased-position| accumulated as a slow follower of the gap. g≈1 when the soliton is at its
// target (kept up), g→0 when the target has run far ahead (matter lagging → the loop throttles the target). In regH
// (pure leash arithmetic) → replay-safe. The default gainOf for a PINNED slot's Einstein loop.
export function leashGainPredicted(L, maxLag = 4) {
  const dx = L.tx - L.gx, dy = L.ty - L.gy, lag = Math.hypot(dx, dy);
  // EMA the lag onto the leash (L.lg) so a momentary jump doesn't spike the gate; slow follower like the coevo baseline.
  L.lg = (L.lg == null) ? lag : (L.lg * 0.9 + lag * 0.1);
  return Math.max(0, Math.min(1, 1 - L.lg / Math.max(1e-6, maxLag)));
}

// leashGainEnergy(energy, e0) — THE UNPINNED (ℂ*) TWIN of leashGainPredicted: the FIELD-MEASURED gain observable for
// the gain-gated Einstein loop. Where the pinned gate reads the DESCRIPTOR's predicted lag (pure, replay-safe), the
// UNPINNED gate reads the TRUE matter energy ratio g = |ψ|²/e0 ∈ [0,1] — real back-reaction (the field's own energy
// tells geometry how far it may go). g≈1 when the field kept its energy budget, g→0 when it drained (matter lagging →
// throttle the target). The two together ARE the "why can't the Einstein loop be achieved — it CAN" pair (doc): pinned
// = descriptor-side (in regH, deterministic), unpinned = field-side (reads bytes → may fork regH, the honest ℂ* price).
// Named here so BOTH gain modes live together in core, even though only a TRANSPORTING slot (medium-u1's W) uses them.
export function leashGainEnergy(energy, e0) {
  return e0 > 0 ? Math.max(0, Math.min(1, energy / e0)) : 1;
}

// leashDue(L, kp, beats) — the τ_i cadence gate (verbatim from the oracle _leashDue): a commanded slot's
// leash advances once per SLOT-BEAT (its own worldline clock's integer crossing), NOT the flat 21-step
// grid. `beats` = the slot's τ-kernel beat count (or null = no clock → flat kp%21 fallback, the no-op
// guarantee). Cursor on the leash (lt = slot-beats consumed, lk = kp at last advance).
export function leashDue(L, kp, beats) {
  if (beats == null) return (kp % 21) === 0;
  if ((beats | 0) > (L.lt | 0)) { L.lt = beats | 0; L.lk = kp; return true; }
  return false;
}

// makeSlot({ name, kind, bank, index, engine, clockName, movAtt }) — the observer SLOT facade. It does NOT
// own the readOp (that lives in the observer bank, ops[index] — the extracted store) or the field (that
// lives in the engine / a plate — the extracted state); it BINDS them with a clock name + a leash + the
// per-kind movAtt strategy, so the mux/register/render can treat every slot uniformly.
//   name      'W' | 'V' | 'P1' | 'P2' — the worldline clock key + slot label
//   kind      'regenerable' (a live object → movAtt = makeProbeField at eased pos)  |
//             'plate'       (a stored moment → movAtt = rollField of the stored att)
//   bank      the makeObserverBank instance (readOp = bank.ops[index], the lensC1 element)
//   engine    the makeSolitonEngine instance (_E) — for rollField + the shared substrate
//   movAtt    (gx,gy) → Float64 attractor field at the eased operator position (the per-kind strategy;
//             the caller wires it: regenerable = () => makeProbeField(obj, {x0:1+gx,y0:1+gy}); plate =
//             (gx,gy) => engine.rollField(storedAtt, round(gx), round(gy)))
// The slot exposes: readOp (live descriptor), leash (+ virtGo/release), clockName, kind, and the register
// reads (angle/beats/tau via the caller's tauK). One object; the mux advances it, the render draws it.
export function makeSlot({ name, kind = 'plate', bank, index, engine, clockName = name, movAtt = null } = {}) {
  const leash = makeLeash();
  const S = {
    name, kind, index, clockName, engine,
    leash,
    // ── the slot's FIELD + operator storage (the canonical store the mux parks to; null until the slot is born) ──
    field: null,          // this slot's canonical ψ (frozen at its last mux-transition; W's rides the engine buffer live)
    att: null,            // the slot's stored operator/attractor (a plate slot chases/holds this; regenerable slots leave it null)
    e0: 1,                // the slot's energy-cap target
    kv: 0,                // this slot's PROPER-step counter (τ_i clocks on it; W uses the engine's kwSteps)
    // ── per-slot BEHAVIOR FLAGS (the S2 ruling: V/P asymmetries are DATA, not code branches). The uniform
    //    advance reads these as optional hooks; a bare register slot leaves them all false/0. ──
    mirror: false,        // V-style: receive the SAME operator drive as the buffer-home (the Lyapunov readout)
    hold: false,          // driven toward the slot's OWN recorded att (parked at the remembered moment)
    leak: 0,              // κ: ψ_slot += κ·ψ_home at shared boundaries (imperfect isolation)
    ears: null,           // the slot's reactor state (CFAR posts) — null = no ears (added when the ears feature lands)
    born: false,          // has this slot been recorded/booted into a live field? (W is born at seed)
    get readOp() { return bank.ops[index]; },          // the lensC1 element — LIVE (mutated by verbs/beats at shared steps)
    // movAtt: the per-kind attractor at the eased leash position. Overridable (a slot's stored att changes
    // on record/recall; a regenerable slot's object changes on obj switch) — the caller re-binds it.
    movAtt: movAtt || (() => null),
    virtGo(tx, ty) { leash.virtGo(tx, ty); },          // shiftX/Y → virtGo (transport = THIS command on the W slot; fresh command)
    setTarget(tx, ty) { leash.setTarget(tx, ty); },    // move the target without re-arming (objorbit continuous motion)
    release() { leash.release(); },
    // register reads (the observer's phase/aging), delegated to the algebra + the caller's τ kernel:
    angle() { return lensC1.angle(this.readOp); },     // total reference angle = phase + prec
    // save/restore the slot's OWN control state (leash + kind + flags); the readOp rides the bank snapshot, the
    // FIELD/att ride the engine/plate snapshot (typed arrays go through the app's {__f64} boundary, not here).
    save() { return { name, kind: S.kind, leash: leash.save(), e0: S.e0, kv: S.kv, mirror: S.mirror, hold: S.hold, leak: S.leak, born: S.born }; },
    restore(s) { if (!s) return; if (s.kind) S.kind = s.kind; leash.restore(s.leash);
      S.e0 = s.e0 ?? 1; S.kv = s.kv | 0; S.mirror = !!s.mirror; S.hold = !!s.hold; S.leak = s.leak || 0; S.born = !!s.born; },
  };
  return S;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  THE SLOT MUX (S2) — the §7.44 clock-phase mux re-expressed as "advance the OWNING slot", uniform for
//  every slot, with the V/P asymmetries (mirror/hold/leak/ears) as per-slot FLAGS not code branches.
//  This is the fork-critical scheduling law from the oracle _muxVirtualStep, transcribed FAITHFULLY (its
//  determinism fixes are the comments' ledger) but organized slot-first. The GPU + the physics callbacks
//  (selfClkTick / kApply / tauAdv / beta / applyOpenBoundary / ampCorr) are passed in via ctx — the C4
//  boundary: this module owns the SCHEDULING + the uniform advance STRUCTURE, the app owns the physics.
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// makeSlotMux(ctx) — ctx = {
//   gpu()                the live IFSGpu handle getter
//   engine               the makeSolitonEngine (_E) — muxStepped/kwSteps + rollField
//   muxClocks(k,nSl,beats)  the two-clock law (medium-core) — { ph (fine buffer owner), capPh (coarse coupling/τ) }
//   K                    the coupling store (medium-core) — shouldCapture/capture, edge/src
//   selfClk()            the selfClock beat state (or null) — { beats, lastK }
//   DT, SOL_GAMMA, SOL_ISAT, Q   the soliton-step constants + the quantum boundary
//   beta(i)              the pin amplitude for slot i (refAmp sweep)
//   kApply(field, i)     apply slot i's coupling edges (physics; medium-side)
//   selfClkTick(field, k, refAtt, ph, kp)   the beat detector + τ advance (physics; medium-side)
//   tauAdv(k)            advance global τ (physics; medium-side)
//   applyOpenBoundary(field)   the sponge (physics; medium-side)
//   ampCorr(a,b)         amplitude correlation (physics; medium-side)
//   boundOpen()          the open-boundary toggle
// }
// The returned mux exposes step(k, slots, homeAtt) → true if a NON-home slot owned k (the drive `continue`s;
// queues/verbs are home-slot events). Home = slots[0] (W) owns the live GPU buffer; others park to slot.field.
export function makeSlotMux(ctx) {
  const { gpu, engine, muxClocks, K, DT, SOL_GAMMA, SOL_ISAT } = ctx;
  const M = { loaded: 0, nSl: 1 };   // mux SCHEDULING state (buffer owner + live-slot count) — the mux's own, not the engine's
  const nSlots = (slots) => slots.reduce((n, s) => n + (s.born ? 1 : 0), 0);   // live slots (born = has a field)
  // park the loaded non-home slot's field back to its store + restore the home field to the buffer
  const parkToHome = (slots, homeAtt, loaded) => { const g = gpu(); if (loaded === 0 || !g) return;
    slots[loaded].field = g.readEyePsi();                       // write the loaded slot's live field home
    g.setEyePsi(slots[0].field); M.loaded = 0; if (homeAtt) g.setObjField(homeAtt); };

  // advanceSlot(slot, k) — the UNIFORM per-slot advance (the register core; flags add optional hooks). The
  // slot owns the GPU buffer here. movAtt drives the chase; the flags (mirror/hold/leak/ears) layer on.
  const advanceSlot = (slot, k, homeAtt, homeField) => { const g = gpu();
    const beats = ctx.selfClk() ? null : null;   // (τ cadence resolved by the app's tauK via leashDue; see below)
    const indep = slot.leash.state.go && slot.att;
    const holdPin = !slot.mirror && !indep && slot.hold && slot.att;
    const vh = indep || holdPin;
    // pin amplitude (superpose toward the operator) — mirror uses the home att, else the slot's own
    if ((slot.mirror && homeAtt) || vh) g.applyEyeSuperpose(ctx.beta(slot.index));
    if (holdPin) { const xtra = Math.min(M.nSl - 1, 2); for (let e = 0; e < xtra; e++) g.applyEyeSuperpose(ctx.beta(slot.index)); }   // MUX-RATE COMPENSATION (held slice only): match the home slot's per-global-step crush
    g.stepEyeN(1, DT); g.applyEyeNlSpm(-SOL_GAMMA, SOL_ISAT, DT); g.applyEyeEnergyCap(slot.e0);
    slot.kv++;
    return { indep, holdPin };
  };

  return {
    nSlots,
    advanceSlot,
    parkToHome,
    // step(k, slots, homeAtt, homeField) — the two-clock schedule. Returns true if a non-home slot owned k.
    loaded: () => M.loaded,                                     // the app render reads this (the "ended mid-slice" desync fix)
    step(k, slots, homeAtt) {
      const nSl = nSlots(slots);
      M.nSl = nSl;                                               // for advanceSlot's mux-rate compensation
      if (nSl < 2) return false;
      const sc = ctx.selfClk();
      // watchdog (Q=7-aligned): force a beat if none in ≥84 steps → bounds source staleness (shared-k pure fn)
      if (sc && (k % 7) === 0 && k - sc.lastK >= 84) { sc.beats++; sc.lastK = k; }
      const { ph, capPh } = muxClocks(k, nSl, sc ? sc.beats : null);
      // COUPLING-SOURCE CAPTURE — gated PURELY on the coarse-clock (capPh) change (the third-edge-fix law): read
      // every slot's CANONICAL store (never the peer-local GPU buffer), freeze into K.src, BEFORE the park logic.
      if (K.shouldCapture(capPh)) {
        if (M.loaded === 0) slots[0].field = gpu().readEyePsi();   // home owns → flush its live field to its store
        else parkToHome(slots, homeAtt, M.loaded);                 // some other slot owns → park it + restore home
        K.capture(slots.map((s) => s.field), k, capPh);
      }
      if (ph === 0) { if (M.loaded !== 0) parkToHome(slots, homeAtt, M.loaded); return false; }   // home slot owns k → the drive runs (not here)
      // a NON-home slot owns k: park the previously-loaded slot, load THIS slot's field + operator
      if (M.loaded !== ph) { parkToHome(slots, homeAtt, M.loaded);
        slots[0].field = gpu().readEyePsi();                    // stash home
        const slot = slots[ph]; gpu().setEyePsi(slot.field); M.loaded = ph;
        if (slot.att) { const chasing = slot.leash.state.go; gpu().setObjField(chasing ? slot.movAtt(slot.leash.state.gx, slot.leash.state.gy) : slot.att); }
        else if (slot.mirror && homeAtt) gpu().setObjField(homeAtt);
      }
      const slot = slots[ph];
      const { indep } = advanceSlot(slot, k, homeAtt);
      // the slot's PROPER-STEP events (its own kv grid — pulled out of the global-Q block so interlacing can't starve it):
      if (indep && ctx.leashDue(slot.leash.state, slot.kv, ctx.beatsOf ? ctx.beatsOf(slot.name) : null)) {
        const qv = gpu().readEyePsi(); const nm = leashAdvance(slot.leash.state, qv, (gx, gy) => slot.movAtt(gx, gy), ctx.ampCorr); if (nm) gpu().setObjField(nm);
      }
      // the shared quantum boundary (coupling / boundary / selfClk-τ) — at (k+1)%Q, on the slot's own field:
      if ((ctx.boundOpen() || slot.leak > 0 || ctx.selfClk() || K.edge) && ctx.Q > 0 && ((k + 1) % ctx.Q) === 0) {
        const qv = gpu().readEyePsi();
        if (slot.leak > 0 && slots[0].field) for (let j = 0; j < qv.length; j++) qv[j] += slot.leak * slots[0].field[j];   // home→slot leak
        ctx.kApply(qv, slot.index);
        if (ctx.boundOpen()) ctx.applyOpenBoundary(qv);
        if (ctx.selfClk()) { const refAtt = slot.mirror ? homeAtt : (slot.leash.state.go && slot.att ? slot.movAtt(slot.leash.state.gx, slot.leash.state.gy) : slot.att); ctx.selfClkTick(qv, k + 1, refAtt, ph, slot.kv); ctx.tauAdv(k + 1); }
        gpu().setEyePsi(qv);
      }
      if (ph >= 0 && ph < 4) engine.muxStepped[ph]++;
      return true;
    },
  };
}

// makeSlotBank({ names, bank, engine, kinds }) — the N-slot array over ONE observer bank + ONE engine.
// names = ['W','V','P1','P2']; kinds = per-name 'regenerable'|'plate' (default: W regenerable, rest plate).
// The caller wires each slot's movAtt after construction (it needs the app's makeProbeField / stored atts).
export function makeSlotBank({ names = ['W', 'V', 'P1', 'P2'], bank, engine, kinds = {} } = {}) {
  const slots = names.map((name, index) => makeSlot({
    name, index, bank, engine,
    kind: kinds[name] || (name === 'W' ? 'regenerable' : 'plate'),
    clockName: name,
  }));
  return {
    slots,
    byName: (nm) => slots[names.indexOf(nm)],
    count: () => slots.length,
    save: () => slots.map((s) => s.save()),
    restore: (arr) => { if (Array.isArray(arr)) slots.forEach((s, i) => s.restore(arr[i])); },
  };
}
