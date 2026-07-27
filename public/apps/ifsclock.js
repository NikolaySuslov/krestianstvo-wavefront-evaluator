/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ════════════════════════════════════════════════════════════════════════════════════════════════
//  IFS-CLOCK — the fractal clock as a thin GR-KWE app: geometry that ticks (kwe-gr.md §7).
//  ------------------------------------------------------------------------------------------------
//  The third member of the thin family (after observers/rhythm), and the one that proves the deepest
//  §7 claim on the kernel bench: A WORLDLINE'S CLOCK CAN BE MADE OF GEOMETRY. Each slot runs a
//  miniature of hologram_world's Fresnel cascade — a genome of affine delays fires a recursive tree;
//  each firing is a BEAT (fresnelBeat), and the beats feed the SAME τ kernel that a metronome or a
//  soliton's lock ripple feeds. The kernel never learns the beats came from a fractal.
//
//  THE CASCADE (faithful miniature of hologram_world._launchSlot/fresnelBeat, run in the engine's
//  deterministic step loop instead of Renkon futures): a launch seeds N_ROOTS root pulses at
//  log-distributed delays; each pulse, when its delay elapses (counted in PROPER steps), FIRES —
//  emits a beat, deposits a ring of radius round(GRID·op.gain) — op = the branch's ACCUMULATED lensC1 CONTRACTION,
//  gain = ρ^depth (the self-similar depth law) — and (until MAX_GEN) spawns children by lensC1.compose(op, ρ). So the
//  content in time (permanently coordinate-authored — a clock's mechanism cannot wait on the clock it
//  defines); only the INTER-cycle glue rides τ (the sibling relaunch, futureTau-paced with the
//  finalize-fallback liveness law — proper-time-metric.md §9, the halt that was live-caught + fixed).
//
//  WHAT YOU SEE/DO: each slot draws its accumulated genome as concentric rings (the fractal clock's
//  face) with the register hand; the beat rate emerges from the cascade's own branching, not a dial.
//  lensTau/edge/store/recall/chainRead all work verbatim — the geometry clock is a first-class
//  worldline. Determinism + join identical to rhythm.js (engine = coord only; snapshot at join via
//  the platform's _snapHook). MATTER = the cascade; the kernel = imported law.
//  THE ℂ* UNIFICATION (kwe-gr §7): the cascade is a genuine lensC1 COMPOSE-CHAIN — each pulse carries the
//  accumulated contraction op (op.gain = ρ^depth, the self-similar depth law), a firing deposits a ring at
//  GRID·gain and RECURSES by lensC1.compose(op, ρ). This makes the IFS map A LENS COMPOSE, and reveals ONE
//  law behind three: the contraction-mapping theorem (ρ<1 → the ring set converges to a bounded attractor;
//  ρ≥1 → diverges) IS lensU1.capGain IS selfhost's runaway cap IS the medium's energy law. The ℂ* gain
//  component — the generalization of U(1) that added the SCALING generator — is exactly the group IFS
//  mediums are built from: the observer descriptor completing into the conformal (similarity) group.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { makeTauKernel } from '../kwe-tau.js';
import { lensU1 } from '../soliton-algebra.js';
import { makeObserverBank, normalizeVirtEvent, applySettingsVerb, makeStepClock, makeCouplingStore, chainMeter, makeIFSClock, wrap2pi, bankAge,
  makeHologramBank, kuramotoStep, makeRegisterReadout, makeRingProvider, makeFieldMatter } from '../medium-core.js';   // one import from the consolidated core: laws + makeIFSClock (ℂ* IFS beat provider) + wrap2pi/bankAge + the HOLOGRAM bank (NON-FIELD genome) + kuramotoStep + makeRegisterReadout. makeRingProvider + makeFieldMatter = the OPT-IN field mode: the geometry clock's LIVE ring drives a real dispersing ψ-field (the fractal clock ALSO disperses). muxClocks dropped.

const REFLECTOR_MS = 50;
const TICK_S = REFLECTOR_MS / 1000;
const SPP = 19;                      // proper steps per shared second (§7.44 budget)
const SLOTN = ['W', 'V', 'P1', 'P2'];
const GRID = 24;                     // the genome kernel's radial extent (rings live in [1, GRID/2))
const N_ROOTS = 5;                   // Fresnel roots per launch (the cascade's fan-out)
const MAX_GEN = 3;                   // recursion depth (each firing spawns 2 children until here)
const BASE_DELAY = 26;               // sets the fire-delay scale: a map's delay ∝ (1 − its gain) · BASE_DELAY (tighter contraction fires sooner)
// (DELAY_SCALE / CHILD_SHRINK retired — the cascade is now a lensC1 compose-chain: the ring radius is GRID·gain and the
//  self-similar shrink is lensC1.compose(op, ρ). ρ = the contraction ratio, set by genomeAmp via RHO().)
const KDECAY = 0.985;                // genome kernel amplitude decay per beat (old rings fade — a living clock)
const BASEHZ = [220, 277.18, 329.63, 392];

const ifsWorldProgram = `
  const W = Renkon.app.W;
  const reflector = Events.receiver();
  const med = Behaviors.collect(
    { time: 0, seq: 0, log: [], started: false },
    reflector,
    (state, pulse) => {
      let st = { ...state, time: pulse.wallTime ?? state.time };
      if (pulse?._isEvent && pulse?._eventPayload?.type === 'ifsVerb') {
        st = { ...st, _queue: [{ fireAt: pulse.wallTime, msg: 'verb', payload: pulse._eventPayload }, ...(st._queue ?? [])], _nextAt: pulse.wallTime };
      }
      return W.reduce(st, pulse, 'med', {
        __macro: (s, p, ctx) => { if (s.started) return s; ctx.future(1, '_keepalive', {}); return { ...s, started: true }; },
        _keepalive: (s, p, ctx) => { ctx.future(1, '_keepalive', {}); return s; },
        verb: (s, p, ctx) => {
          const MODES = ['relaunch','genome','aphase','lenstau','refamp','viaphi','store','recall','boot','kill','edge','field'];
          const mode = MODES.includes(p.mode) ? p.mode : 'relaunch';
          const cl = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
          const e = { seq: (s.seq|0) + 1, time: s.time, mode,
            amp: (mode === 'genome') ? cl(p.amp, 0.3, 2, 1) : (mode === 'lenstau') ? cl(p.amp, -0.5, 0.5, 0)
               : (mode === 'refamp') ? cl(p.amp, 0, 3, 1) : cl(p.amp, -Math.PI, Math.PI, 0),
            src: (p.src === 'V' || p.src === 'P1' || p.src === 'P2') ? p.src : 'W',
            slot: cl(p.slot, 0, 3, 0)|0, gx: cl(p.gx, 0, 3, 0)|0, gy: cl(p.gy, 0, 3, 0)|0, leak: cl(p.leak, -0.5, 0.5, 0) };
          if ((s.log?.length ?? 0) >= 512) return s;
          return { ...s, seq: e.seq, log: [...(s.log ?? []), e] };
        },
      });
    }
  );
  const _isStable = W.stable([med], reflector);
  const _export = W.export(Renkon, { med }, _isStable);
`;

function makeIfsScripts(avatarScript) { return [ifsWorldProgram, avatarScript]; }

// wrap2pi now imported from medium-core (one definition; [0,2π) register-aging wrap)
// a deterministic scramble of (cycleId, slot) → the launch's delay jitter (mirrors the medium's rng-seeded roots,
// but PURE — no shared rng state to snapshot, so the thin app stays trivially deterministic)
const scramble = (a, b) => { let h = ((a | 0) * 73856093) ^ ((b | 0) * 19349663) ^ 0xdeadbeef;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 0x100000000; };

function makeIfsRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    // ── THE ENGINE — every law imported; only the CASCADE is this app's own matter ──
    const bank = makeObserverBank(4), ops = bank.ops;
    const dials = { viaPhi: 0.5, lensView: false };
    const K = makeCouplingStore();
    const clk = makeStepClock({ stepsPerPhase: SPP });
    const tauK = makeTauKernel({ monRate: 1, stepsPerPhase: SPP, flatL: 21 });
    const q = tauK.makeQueue('virt', { clock: null });
    // a worldline's matter = a live Fresnel cascade — PROVIDED by the kernel's makeIFSClock (the lensC1 compose-chain
    // is now a CORE law; this app supplies only the meaning: rings on a face, coupling, recall). ifs[i] = the provider.
    const live = [false, false, false, false];
    const ifs = [null, null, null, null], kp = [0, 0, 0, 0];
    const genomeAmp = [1, 1, 1, 1];                                     // 'genome' verb: the contraction ratio ρ (via the provider's setRho)
    // ── OPT-IN FIELD MODE (makeRingProvider + makeFieldMatter): a slot's geometry clock (ifs[i]) drives a LIVE fractal
    //    ring (makeRingProvider, refreshed from the clock's own kernel — the clock is advanced in stepSlot, so we use
    //    .refresh() not .tick() to avoid double-advancing), and that live ring disperses a real ψ-field. So 'geometry
    //    that ticks' ALSO 'geometry that disperses': you see the fractal kernel breathe AND a soliton evolve through it.
    //    OFF by default (the genome-as-face demo is untouched); the `field` verb toggles a slot in.
    const FG = 16, FGAMMA = 20, FISAT = 1, FDT = 0.12;                 // the field grid (16 = the stable spectral size; the ring provider clamps the clock's radii to <FG/2 so they fit — a bigger grid destabilizes the spectral step)
    const fieldOn = [false, false, false, false];
    const _fm = [null, null, null, null];                             // per-slot field matter (each driven by ITS OWN clock's live ring) — lazy, created when field mode turns on
    const _ringProv = [null, null, null, null];                       // per-slot live ring provider (makeRingProvider over ifs[i])
    // enter field mode for slot i: build its live ring provider (from its geometry clock) + a field-matter over that
    // ring, seed a soliton. The clock is already live (spawnIFS); the provider .refresh()es the ring from it in stepSlot.
    const enterField = (i) => { if (!ifs[i]) return; _ringProv[i] = makeRingProvider(ifs[i], { gridR: FG >> 1 });
      _fm[i] = makeFieldMatter({ G: FG, names: ['W'], gamma: FGAMMA, isat: FISAT, dt: FDT, lensOp: () => ops[i], ringProvider: _ringProv[i] });
      _ringProv[i].refresh(); const c = (FG - 1) / 2;
      _fm[i].seedAtt(0, [{ cx: c, cy: c, sg: 2.5, amp: 1.0 }]); _fm[i].seed(0, [{ cx: c, cy: c, sg: 2.5, amp: 1.0 }]); fieldOn[i] = true; };
    const events = [[], [], [], []];                                  // recent (radius, kp) for the render pulse — the app's own visual, tracked from ring appearances
    const RHO = (i) => Math.min(0.95, 0.4 + 0.28 * genomeAmp[i]);      // genomeAmp → the contraction ratio the provider uses
    let k = 0, seen = 0, booted = false, halted = false, lag = 0;
    const beatsOut = [];
    let inhabit = -1;
    // reanchor: REMOVED the nSl rate-flip (the mux's 1/nSl slowing). Homogeneous full-rate clocks → fixed world rate;
    // differential aging is each cascade's OWN branching (rho/depth). No-op hook kept for call-site/snapshot shape.
    const reanchor = (_kk) => {};

    // spawn/kill a worldline = create/drop its makeIFSClock provider (the kernel owns the cascade compose-chain +
    // its contraction-stability law; this app owns only ρ, rings-as-face, coupling, recall). gridR = GRID/2 so rings
    // land in [1, GRID/2). A per-slot seed keeps cascades distinct AND deterministic (pure fn — no shared rng).
    const spawnIFS = (i) => { ifs[i] = makeIFSClock({ roots: N_ROOTS, maxGen: MAX_GEN, rho: RHO(i), baseDelay: BASE_DELAY, gridR: GRID >> 1, kdecay: KDECAY, seed: i * 101 + 7 }); ifs[i].launch(kp[i]); };
    const kernelOf = (i) => (ifs[i] ? ifs[i].kernel() : []);          // the accumulated genome (the provider's ring set)

    const stepSlot = (i, kk) => { if (!live[i] || !ifs[i]) return;
      ifs[i].setRho(RHO(i));                                          // the genome dial → the contraction ratio, live
      kp[i]++;
      const before = kernelOf(i).length;
      const { beat, rings } = ifs[i].advance(kp[i]);                  // THE BEAT SOURCE: the kernel's IFS provider (a fresnel firing = a tick)
      if (rings.length > before) events[i].push({ r: rings[rings.length - 1].r, kp: kp[i] });   // a ring appeared → a firing flash (the app's own visual)
      if (events[i].length > 40) events[i].shift();
      // OPT-IN FIELD: the clock JUST advanced (rings updated) → refresh the live ring (no double-advance) + step the
      // ψ-field through it. The soliton disperses through the SAME fractal kernel that ticks — geometry that ticks AND
      // disperses. Deterministic (the ring is a pure fn of the clock's kernel; the step is the shared engine).
      if (fieldOn[i] && _fm[i]) { _ringProv[i].refresh(); _fm[i].step(0, 0.4); }
      if (bankAge(ops, i, tauK, SLOTN[i], kp[i], kk, beat)) beatsOut.push(i); };   // the shared register-aging step (stamp clock + precess on own beat)

    // the genome as a complex field (for chainMeter/coupling/recall): rings → a radial profile, phase = register
    const genomeField = (i) => { const n = GRID * GRID, f = new Float64Array(n * 2), c = (GRID - 1) / 2, ph = ops[i].phase, ker = kernelOf(i);
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const rr = Math.round(Math.hypot(x - c, y - c));
        const e = ker.find((k2) => k2.r === rr); if (!e) continue; const j = (y * GRID + x) * 2;
        f[j] = e.a * Math.cos(ph); f[j + 1] = e.a * Math.sin(ph); } return f; };

    const seed = () => { live[0] = true; spawnIFS(0); booted = true; };
    const appVerb = (vq, kk) => { const SNI = { W: 0, V: 1, P1: 2, P2: 3 }, si = SNI[vq.src] ?? 0;
      if (vq.mode === 'aphase') { if (live[si]) { ops[si].phase = wrap2pi(ops[si].phase + (vq.amp || 0)); console.log(`[IFS] aphase ${SLOTN[si]} → ∠${ops[si].phase.toFixed(3)} atStep=${kk}`); } }
      else if (vq.mode === 'genome') { genomeAmp[si] = vq.amp || 1; console.log(`[IFS] genome ${SLOTN[si]} amp=${genomeAmp[si].toFixed(2)} atStep=${kk} — cascade richness (fan-out); the fractal beat rate follows`); }
      else if (vq.mode === 'field') { if (live[si] && !fieldOn[si]) { enterField(si); console.log(`[IFS] field ${SLOTN[si]} ON atStep=${kk} — the geometry clock's LIVE fractal ring now disperses a real ψ-field (geometry that ticks AND disperses). Its FFT spectrum is a spectral eye read.`); }
        else if (fieldOn[si]) { fieldOn[si] = false; console.log(`[IFS] field ${SLOTN[si]} OFF atStep=${kk} — back to the genome-as-face view`); } }
      else if (vq.mode === 'relaunch') { const t = (vq.slot | 0); if (live[t] && ifs[t]) { ifs[t].launch(kp[t]); console.log(`[IFS] relaunch ${SLOTN[t]} cascade atStep=${kk}`); } }
      else if (vq.mode === 'boot') { const t = live[2] ? 3 : 2; if (!live[t]) { live[t] = true; Object.assign(ops[t], lensU1.id()); kp[t] = 0; genomeAmp[t] = genomeAmp[0]; spawnIFS(t); console.log(`[IFS] boot ${SLOTN[t]} — a new geometry clock atStep=${kk}`); } }
      else if (vq.mode === 'kill') { const t = live[3] ? 3 : live[2] ? 2 : -1; if (t > 0) { live[t] = false; ifs[t] = null; Object.assign(ops[t], lensU1.id()); console.log(`[IFS] kill ${SLOTN[t]} atStep=${kk}`); } }
      else if (vq.mode === 'store') { _holo.store(null, ops[0], { m: { ker: kernelOf(0).map((e) => ({ ...e })) }, k: kk });   // NON-FIELD: bank the genome (ring set) + the register; no field
        console.log(`[IFS] store — genome banked ${plates.length}/4 (∠${lensU1.angle(ops[0]).toFixed(3)}, bw=${plates[plates.length - 1].bw})`); }
      else if (vq.mode === 'recall') { if (plates.length) {
        const bd = _holo.bind(kernelOf(0), { metric: (cueKer, plM) => genomeCorr(cueKer, plM.ker) });   // content-address by GENOME OVERLAP (the pluggable metric on plate.m)
        const { plate: pl, index: best, corr: bc } = bd; live[1] = true; Object.assign(ops[1], lensU1.id()); kp[1] = 0; genomeAmp[1] = genomeAmp[0]; spawnIFS(1);   // the remembered CLOCK regrows from a fresh cascade (the genome is the CUE, not restored verbatim — an IFS clock is its dynamics)
        const ag = _holo.agingReadout(pl, bd.cueLeg, ops[0], { name: 'W' });   // shared aging (descriptor-only — no field-Δφ, honestly)
        console.log(`[IFS] recall → plate ${best + 1} (cue⊗=${bc.toFixed(3)}) → V; the remembered CLOCK runs again atStep=${kk}`);
        console.log(`[RECALL-∠] plate frame ∠=${lensU1.angle(pl.dop).toFixed(3)} vs W now ∠=${lensU1.angle(ops[0]).toFixed(3)} → Δ=${ag.dDesc.toFixed(3)} rad · Δτ_W=${ag.dTau} beats${ag.dOmegaTau != null ? ` → ω·Δτ=${ag.dOmegaTau.toFixed(3)} predicted` : ''}`); } }
      else if (vq.mode === 'edge') { const ea = vq.gx | 0, eb = vq.gy | 0, ek = vq.leak || 0;
        if (!K.setEdge(ea, eb, ek)) console.log('[IFS] edge: self-coupling ignored'); else console.log(`[IFS] edge κ(${SLOTN[ea]},${SLOTN[eb]}) = ${ek} atStep=${kk} — Kuramoto of geometry clocks`); } };
    const genomeCorr = (a, b) => { let dot = 0, na = 0, nb = 0;         // genome overlap (for recall's cue match)
      for (let r = 1; r < GRID; r++) { const ea = a.find((e) => e.r === r)?.a || 0, eb = b.find((e) => e.r === r)?.a || 0; dot += ea * eb; na += ea * ea; nb += eb * eb; }
      return (na && nb) ? dot / Math.sqrt(na * nb) : 0; };
    // ── THE HOLOGRAM BANK (shared core, NON-FIELD regime): ifsclock banks IFS GENOMES (ring sets), not fields. The
    //    pluggable metric = genomeCorr(cue.ker, plate.m.ker) — recall content-addresses by GENOME OVERLAP. No leg, no
    //    lift (a genome is not a propagating image — and recall regrows the clock from a fresh cascade, dynamics not
    //    restore); the [RECALL-∠] aging readout is shared (descriptor-only — no field-Δφ). plates = the bank array.
    const _holo = makeHologramBank({ bankMax: 4, beatsOf: (nm) => (tauK.beatsOf(nm) ?? 0) });
    const plates = _holo.plates;   // { m: {ker}, dop, bw, k } — the remembered genome
    const chainSlots = () => SLOTN.map((nm, i) => ({ name: nm, field: live[i] ? genomeField(i) : null, op: ops[i] })).filter((s) => s.field);

    // ── the snapshot codec (f64-exact; join channel below, not the log) ──
    const takeSnap = () => ({ k, seq: seen, clk: { c0: clk.c0, rate: clk.rate, ratePrev: clk.ratePrev }, tauK: tauK.save(), bank: bank.save(), dials: { ...dials },
      K: { edge: K.edge ? K.edge.map((r) => [...r]) : null, capPh: K.capPh, capStep: K.capStep, src: K.src.map((s) => s ? Array.from(s) : null) },
      live: [...live], ifs: ifs.map((c) => c ? c.save() : null),   // the provider serializes its own cascade state (the kernel owns the codec)
      kp: [...kp], genomeAmp: [...genomeAmp], events: events.map((a) => a.map((e) => ({ ...e }))),
      fieldOn: [...fieldOn], fields: _fm.map((fm) => (fm ? fm.save() : null)),   // opt-in field state (a joiner in field mode restores the live soliton, not re-seed)
      plates: _holo.save() });   // the bank owns the plate shape; m (the genome ring set) rides as a plain-object structured clone
    const restoreSnap = (s) => { k = s.k | 0; seen = s.seq | 0; clk.c0 = s.clk?.c0 ?? 0; clk.rate = s.clk?.rate ?? 1; clk.ratePrev = s.clk?.ratePrev ?? 1;
      if (s.tauK) tauK.restore(s.tauK); bank.restore(s.bank); Object.assign(dials, s.dials || {});
      K.edge = s.K?.edge ? s.K.edge.map((r) => [...r]) : null; K.capPh = s.K?.capPh ?? -1; K.capStep = s.K?.capStep ?? -1;
      for (let i = 0; i < 4; i++) K.src[i] = s.K?.src?.[i] ? Float64Array.from(s.K.src[i]) : null;
      for (let i = 0; i < 4; i++) { live[i] = !!s.live?.[i]; kp[i] = s.kp?.[i] ?? 0; genomeAmp[i] = s.genomeAmp?.[i] ?? 1; events[i] = (s.events?.[i] || []).map((e) => ({ ...e }));
        if (live[i]) { spawnIFS(i); if (s.ifs?.[i]) ifs[i].restore(s.ifs[i]); } else ifs[i] = null; }   // recreate the provider then restore its cascade state (the kernel's codec)
      for (let i = 0; i < 4; i++) { if (s.fieldOn?.[i] && ifs[i]) { enterField(i); if (s.fields?.[i]) _fm[i].restore(s.fields[i]); }   // re-enter field mode + restore the live soliton verbatim
        else { fieldOn[i] = false; _fm[i] = null; _ringProv[i] = null; } }
      _holo.restore(s.plates);   // the bank rebuilds the plate shape incl. m ({ker}) via structured clone
      booted = true; console.log(`[IFS] restored from join snapshot @ step=${k} — gH must match live peers at equal step`); };
    world.ps.app._snapHook = (worldSnap) => { if (booted) worldSnap.medSnapIfs = takeSnap(); };

    const advance = (time) => {
      const wApp = world?.ps?.app;
      if (wApp && wApp._snapshotApplied) { wApp._snapshotApplied = false; if (wApp.medSnapIfs) { restoreSnap(wApp.medSnapIfs); wApp.medSnapIfs = null; } }
      if (!booted) seed();
      if (tauK.rate !== clk.rate || tauK.clock0 !== clk.c0) tauK.setEpoch(clk.c0, clk.rate);
      const med = world.getNodeState('med'); if (!med) return;
      if ((med.seq | 0) > seen) { for (const e of (med.log || [])) if ((e.seq | 0) > seen) { const n = normalizeVirtEvent(e); n.t = (e.time || 0) * TICK_S; q.push(n); } seen = med.seq | 0; }
      lag = Math.max(0, clk.target(time * TICK_S) - k);
      if (halted) return;
      let done = 0;
      try { while (done < 4000) {
        const tgt = clk.target(time * TICK_S);
        if (k >= tgt) break;
        q.drain(k, (vq) => { if (!applySettingsVerb(vq, k, ops, dials)) appVerb(vq, k); });
        // ── HOMOGENEOUS CLOCKS (the mux unification, matching observers/rhythm/medium-u1): each geometry clock runs
        //    its OWN IFS cascade — no shared substrate to time-share — so ALL live clocks advance every shared k at
        //    FULL rate (no 1/nSl). Each fractal clock's beat rate emerges from ITS OWN cascade branching (rho/depth),
        //    which IS the differential aging — the mux slot-count slowing was redundant with that. Capture rides the
        //    fixed flat-slice cadence (period 21 = the old muxClocks coarse period), slot-independent.
        const capPh = Math.floor(k / 21);
        if (K.shouldCapture(capPh)) K.capture([live[0] ? genomeField(0) : null, live[1] ? genomeField(1) : null, live[2] ? genomeField(2) : null, live[3] ? genomeField(3) : null], k, capPh);
        for (let i = 0; i < 4; i++) if (live[i]) stepSlot(i, k);         // every live geometry clock advances at k (homogeneous, full-rate)
        // A+: THE PHASE-KURAMOTO — edges entrain the geometry clocks' register PHASES (the shared kuramotoStep law), at
        // the Q boundary, over all live clocks (read-all-then-write → deterministic). This is ifsclock's ONLY edge
        // coupling (its genome matter has no field to mix — so 'Kuramoto of geometry clocks' is now literally true).
        if (K.edge && ((k + 1) % 21) === 0) { const { dth, any } = kuramotoStep(ops.map((o) => o.phase), K.edge, { born: [...live] });
          if (any) for (let i = 0; i < 4; i++) if (dth[i]) ops[i].phase = wrap2pi(ops[i].phase + dth[i]); }
        k++; done++; } } catch (err) { halted = true; console.error(`[IFS] ENGINE HALTED at step=${k}:`, err); } };

    // ── console instruments + audio (a beat = a soft pluck; sound renders the fractal's real beats) ──
    let AC = null, master = null;
    const soundOn = () => { if (AC) { AC.close(); AC = null; return false; } AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.18; master.connect(AC.destination); AC.resume(); return true; };
    const pluck = (i) => { if (!AC || !live[i]) return; const ang = lensU1.wrap(lensU1.angle(ops[i])), f0 = BASEHZ[i] * Math.pow(2, (ang * (200 / Math.PI)) / 1200);
      const t0 = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle'; o.frequency.value = f0;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5); o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.55); };
    const inj = (p) => injectEvent?.({ type: 'ifsVerb', ...p });
    const _rout = makeRegisterReadout({ tauK, names: SLOTN, op: (i) => ops[i], born: (i) => !!live[i], step: () => k });   // the FULL register introspection (∠/ω/β/beats/τ/born per slot) — ifsclock as a full-fidelity U1 demo
    globalThis.ifs = {
      chainRead: () => { const c = chainSlots(); if (c.length < 2) return '[IFS] need ≥2 clocks'; const m = chainMeter(c);
        console.log(`[CHAIN] ${m.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis} pred ${l.pred} mdl ${l.mdl})`).join(' · ')} · ε=${m.defect} · beatsS[${SLOTN.map((n) => tauK.beatsOf(n) ?? 0).join(',')}] step=${k}`); return m; },
      lensOps: () => { const o = ops.map((l, i) => ({ slot: SLOTN[i], ...l, angle: +lensU1.angle(l).toFixed(4) })); console.log(`[LENSOPS] ${o.map((l) => `${l.slot}:{∠${l.angle} β=${l.beta} ω=${l.omega}}`).join(' · ')} · step=${k}`); return o; },
      regPhase: () => _rout.phase({ gH: hashKernel(kernelOf(0)) }),   // {beats,tau,step,kH} shared + ifsclock's genome hash
      relaunch: (slot = 'W') => inj({ mode: 'relaunch', slot: { W: 0, V: 1, P1: 2, P2: 3 }[slot] ?? 0 }),
      genome: (slot = 'W', a = 1) => inj({ mode: 'genome', src: slot, amp: +a }),
      field: (slot = 'W') => inj({ mode: 'field', src: slot }),   // toggle the opt-in ψ-field: the geometry clock's live ring disperses a soliton (geometry that ticks AND disperses)
      aphase: (a = 0.1, slot = 'W') => inj({ mode: 'aphase', amp: +a, src: slot }),
      lensTau: (w = 0.1, slot = null) => inj({ mode: 'lenstau', amp: +w, ...(slot ? { src: slot } : {}) }),   // per-slot ω when slot given (each geometry clock ages at its own rate); global when omitted
      edge: (a = 0, b = 1, kk2 = 0.1) => inj({ mode: 'edge', gx: a | 0, gy: b | 0, leak: +kk2 }),
      store: () => inj({ mode: 'store' }), recall: () => inj({ mode: 'recall' }), boot: () => inj({ mode: 'boot' }), kill: () => inj({ mode: 'kill' }),
      sound: () => soundOn() };
    const hashKernel = (ker) => { let h = 0x811c9dc5; for (const e of ker.slice().sort((a, b) => a.r - b.r)) { h ^= (e.r * 1000 + Math.round(e.a * 100)) >>> 0; h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 0).toString(16).padStart(8, '0'); };

    // ── UI: the genome rings as the fractal clock's FACE ──
    let els = null;
    const mkUI = (root) => {
      root.innerHTML = `
        <div style="font-size:11px;font-weight:bold;color:#9f8;margin-bottom:8px;letter-spacing:1px;">PEER ${peerId} · IFS-CLOCK — geometry that ticks <span id="${containerId}-roster"></span></div>
        <div id="${containerId}-row" style="display:flex;gap:14px;"></div>
        <div id="${containerId}-bar" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:10px;color:#9f8;"></div>
        <div id="${containerId}-st" style="margin-top:6px;font-size:9px;color:#7a8;"></div>
        <div style="margin-top:4px;font-size:9px;color:#465;">console: ifs.sound() · ifs.relaunch('W') · ifs.genome('W',a) · ifs.lensTau(ω) · ifs.chainRead() · ifs.store()/recall() · ifs.edge(a,b,κ) · ifs.boot()/kill()</div>`;
      const row = document.getElementById(`${containerId}-row`);
      const cvs = SLOTN.map(() => { const box = document.createElement('div'); box.style.textAlign = 'center';
        const c = document.createElement('canvas'); c.width = 96; c.height = 96; Object.assign(c.style, { background: '#060a06', borderRadius: '50%', border: '1px solid #253' });
        const lab = document.createElement('div'); lab.style.cssText = 'font-size:9px;color:#9f8;margin-top:2px;'; box.appendChild(c); box.appendChild(lab); row.appendChild(box); return { c, lab, ctx: c.getContext('2d') }; });
      const bar = document.getElementById(`${containerId}-bar`);
      const btn = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'font-size:10px;background:#121;color:#9f8;border:1px solid #354;border-radius:4px;padding:2px 8px;cursor:pointer;'; b.onclick = fn; bar.appendChild(b); return b; };
      const sld = (label, min, max, step, val, onchg) => { const w = document.createElement('span'); w.style.cssText = 'display:flex;gap:3px;align-items:center;';
        const l = document.createElement('span'); const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.style.width = '70px';
        const txt = (v) => { l.textContent = `${label} ${(+v).toFixed(2)}`; }; txt(val); i.addEventListener('input', () => txt(i.value)); i.addEventListener('change', () => onchg(+i.value));
        w.appendChild(l); w.appendChild(i); bar.appendChild(w); return { input: i, set: (v) => { if (document.activeElement === i) return; if (+i.value !== +v) i.value = v; txt(v); } }; };
      let slot = 'W'; const sel = document.createElement('select'); sel.style.cssText = 'background:#121;color:#9f8;border:1px solid #354;font-size:10px;'; for (const nm of SLOTN) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; sel.appendChild(o); } sel.onchange = () => { slot = sel.value; }; bar.appendChild(sel);
      const snd = btn('🔇 sound', () => { snd.textContent = soundOn() ? '🔊 sound' : '🔇 sound'; });
      btn('↻ relaunch', () => globalThis.ifs.relaunch(slot));
      const sGen = sld('genome', 0.3, 2, 0.05, 1, (v) => globalThis.ifs.genome(slot, v));
      const sOm = sld('ω', -0.5, 0.5, 0.01, 0, (v) => globalThis.ifs.lensTau(v, slot));   // per-SLOT ω (the dropdown targets it; each geometry clock ages at its own rate)
      btn('store', () => globalThis.ifs.store()); btn('recall', () => globalThis.ifs.recall()); btn('boot', () => globalThis.ifs.boot()); btn('kill', () => globalThis.ifs.kill());
      return { cvs, sGen, sOm, slotSel: () => slot, st: document.getElementById(`${containerId}-st`), roster: document.getElementById(`${containerId}-roster`) };
    };
    const face = (i) => { const { ctx, lab } = els.cvs[i], R = 48, cx = 48, cy = 48;
      ctx.clearRect(0, 0, 96, 96);
      if (!live[i]) { lab.textContent = `${SLOTN[i]} —`; return; }
      for (const e of kernelOf(i)) { const rad = (e.r / (GRID / 2)) * (R - 6);   // the genome as concentric rings — the fractal clock's face
        ctx.strokeStyle = `hsla(${110 + i * 40}, 70%, ${35 + Math.min(45, e.a * 40)}%, ${Math.min(1, e.a)})`; ctx.lineWidth = 1 + Math.min(2, e.a); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 2 * Math.PI); ctx.stroke(); }
      for (const ev of events[i]) { const age = kp[i] - ev.kp; if (age > 30) continue;   // a firing flash rippling outward
        const rad = (ev.r / (GRID / 2)) * (R - 6), a = 1 - age / 30; ctx.fillStyle = `hsla(${110 + i * 40},90%,70%,${a})`; ctx.beginPath(); ctx.arc(cx, cy - rad, 1.8, 0, 2 * Math.PI); ctx.fill(); }
      const ang = lensU1.angle(ops[i]); ctx.strokeStyle = '#9f8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (R - 10) * Math.cos(ang - Math.PI / 2), cy + (R - 10) * Math.sin(ang - Math.PI / 2)); ctx.stroke(); ctx.lineWidth = 1;
      lab.innerHTML = `${SLOTN[i]} ∠${lensU1.wrap(ang).toFixed(2)} τ${(tauK.tauOf(SLOTN[i]) ?? 0).toFixed(1)}<br>rings ${kernelOf(i).length} b${tauK.beatsOf(SLOTN[i]) ?? 0}${ops[i].omega ? ` ω${ops[i].omega}` : ''}`; };
    return () => {
      if (!world?.ps?.app) return;
      if (!document.getElementById('ifs-wrap')) { const wrap = document.createElement('div'); wrap.id = 'ifs-wrap'; Object.assign(wrap.style, { display: 'flex', gap: '0', flexWrap: 'wrap' }); document.body.appendChild(wrap); }
      let root = document.getElementById(containerId);
      if (!root) { root = document.createElement('div'); root.id = containerId; Object.assign(root.style, { fontFamily: 'ui-monospace,monospace', padding: '16px', background: '#080d08', color: '#eee', borderRadius: '10px', margin: '10px', border: '1px solid #232' });
        document.getElementById('ifs-wrap').appendChild(root); els = mkUI(root);
        root.addEventListener('mousemove', (e) => { const rect = root.getBoundingClientRect(); const ro = _seloInfo(world); if (ro?.myId) sendCursorMove(world.id, ro.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height); }, { passive: true }); }
      const med = world.getNodeState('med');
      if (med) { beatsOut.length = 0; advance(med.time ?? 0); for (const i of beatsOut) pluck(i); }
      if (els) { for (let i = 0; i < 4; i++) face(i);
        { const si = Math.max(0, SLOTN.indexOf(els.slotSel())); els.sGen.set(genomeAmp[si]); els.sOm.set(ops[si].omega); }   // both φ:gen and ω reflect the SELECTED slot now
        els.st.textContent = `step=${k}${halted ? ' · ⚠ HALTED' : lag > 100 ? ` · replaying (${lag})` : ''} · kH=${tauK.hash()} · gH=${hashKernel(kernelOf(0))} · beats[${SLOTN.map((n) => tauK.beatsOf(n) ?? 0).join(',')}]${K.edge ? ' · edges' : ''} — diff kH/gH across peers at equal step`;
        if (els.roster) els.roster.innerHTML = _clientBadge(world); }
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'IFS-Clock (geometry that ticks)',
  selo:        'ifsclock',
  reflectorMs: REFLECTOR_MS,
  metaOptions: {},
  makeScripts: (av) => makeIfsScripts(av),
  makeRenderer: makeIfsRenderer,
  wrapId:      'ifs-wrap',
};
