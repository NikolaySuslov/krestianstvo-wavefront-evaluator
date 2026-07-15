/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ════════════════════════════════════════════════════════════════════════════════════════════════
//  SELFHOST — the operator that hosts itself: the META-CIRCLE on the thin bench (kwe-gr.md §6; the
//  medium's §7.88–§7.101 self-hosting arc, reduced to pure lens algebra).
//  ------------------------------------------------------------------------------------------------
//  Every other thin app keeps the lens READ-ONLY: matter evolves by its own rules, lensU1 watches.
//  THIS one closes the circle — lens = operator = matter — with NO substrate at all. Each worldline's
//  MATTER is itself a lensU1 element M; its OPERATOR is another lensU1 element O; and:
//    · DRIVE (operator → matter): each proper step M relaxes a fraction β toward O — M is applied
//      THROUGH a sliver of O (compose), exactly ψ += β·att with descriptors instead of fields.
//    · BEAT (matter → clock): the mismatch link(M, O) ripples as M chases a PRECESSING O (O.phase
//      advances SPIN/step) — an algebraic lock ripple; its up-crossings feed the SAME τ kernel a
//      soliton or a metronome feeds. The clock EMERGES from the lens dynamics — no PDE.
//    · SELF-HOST (matter → operator): on each beat the matter REWRITES its own operator —
//      O ← compose(O, wash·(M ⊖ O)). The genome that drives the matter is edited BY the matter it
//      drove. This is the enzyme-wash / self-evolution of §7.88 as one compose. lensU1.apply/compose
//      are now the PHYSICS, not the readout.
//  HOLOGRAPHY dual-layer, free: record = freeze (M, O) as a plate (a lens-element PAIR); recall =
//  the remembered operator hosts itself again, aged (compose against drift) — the medium's
//  record/lift round-trip on 6-float descriptors instead of 128KB fields; [RECALL-∠] verbatim.
//  PER-WORLDLINE UNPIN — lensU1 → lensC1 as a live, replicated event on a SINGLE worldline (others stay pinned):
//    · PINNED (lensU1, default): gain≡1 → the element lives on a COMPACT torus → runaway IMPOSSIBLE. Two regimes,
//        FROZEN (stiff pin, matter locks, clock dies — the medium's "no-live-chase dies" law) ↔ HOSTED (a living
//        self-hosting clock). A phase-only clock cannot blow up — there's no amplitude to blow up.
//    · UNPINNED (lensC1): the amplitude DOF is FREED — the element is now r·e^{iφ} on the NON-compact ℂ*. The
//        operator's amplitude drifts up (`gdrift`) and the self-host loop amplifies it MULTIPLICATIVELY → the THIRD
//        regime, RUNAWAY (r → ∞) — unless the energy law bounds it. `cap` = lensU1.capGain = the medium's energy law
//        as one algebra op; THE stability dial (headless: gdrift·cap8 → r≈9 HOSTED, cap0 → r→10⁶ RUNAWAY). repin
//        projects the worldline back to the U(1) slice (gain → 1, energy renormalized).
//  THE MEANING: unpinning is a worldline ACQUIRING a degree of freedom — its energy stops being conserved and
//  becomes free to flow. "lensU1 → lensC1" is not a cast (the element always has all fields) but a change of WHICH
//  algebra governs it. One worldline can unpin while its neighbours stay pinned — a genuine per-worldline group
//  boundary crossing, replicated. The medium's energy cap IS what keeps an unpinned worldline stable.
//  Determinism + join identical to rhythm/ifsclock (engine = coord only; snapshot at join via _snapHook).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { makeTauKernel } from '../kwe-tau.js';
import { lensU1 } from '../soliton-algebra.js';
import { makeObserverBank, normalizeVirtEvent, applySettingsVerb, makeStepClock, makeCouplingStore, muxClocks, chainMeter } from '../medium-core.js';

const REFLECTOR_MS = 50;
const TICK_S = REFLECTOR_MS / 1000;
const SPP = 19;
const SLOTN = ['W', 'V', 'P1', 'P2'];
const BASEHZ = [220, 277.18, 329.63, 392];
// Calibrated to the RIPPLE regime (headless sweep): a FAST operator (SPIN) + a MODERATE pin (BETA0) → the
// matter perpetually chases without catching → coherence oscillates → beats. Frozen corner (fast pin, slow spin)
// gives beats=0 (matter locks, no ripple → dead clock); this is the medium's β≫chase-rate freeze, measured here.
const SPIN = 0.28;    // O.phase advances this per proper step (the operator PRECESSES fast → the matter must chase → ripple)
const BETA0 = 0.06;   // default drive fraction (how much of O composes into M per step) — the pin stiffness (moderate = perpetual chase)
const WASH0 = 0.12;   // default self-edit rate (how hard the matter rewrites O on each beat) — THE headline dial
// (former GAIN0 multiplier removed — headless-proven it CANNOT destabilize a phase-only clock: see below.)
const GDRIFT0 = 1.0;  // default operator gain-drift (ℂ*-mode): how fast O's amplitude wanders up — the excursion the
                      // self-host loop amplifies into runaway when uncapped. In U(1)-mode gain≡1 so this does nothing.

const selfhostWorldProgram = `
  const W = Renkon.app.W;
  const reflector = Events.receiver();
  const med = Behaviors.collect(
    { time: 0, seq: 0, log: [], started: false },
    reflector,
    (state, pulse) => {
      let st = { ...state, time: pulse.wallTime ?? state.time };
      if (pulse?._isEvent && pulse?._eventPayload?.type === 'shVerb') {
        st = { ...st, _queue: [{ fireAt: pulse.wallTime, msg: 'verb', payload: pulse._eventPayload }, ...(st._queue ?? [])], _nextAt: pulse.wallTime };
      }
      return W.reduce(st, pulse, 'med', {
        __macro: (s, p, ctx) => { if (s.started) return s; ctx.future(1, '_keepalive', {}); return { ...s, started: true }; },
        _keepalive: (s, p, ctx) => { ctx.future(1, '_keepalive', {}); return s; },
        verb: (s, p, ctx) => {
          const MODES = ['spawn','wash','beta','gdrift','cap','unpin','kick','aphase','lenstau','refamp','viaphi','store','recall','boot','kill','edge'];
          const mode = MODES.includes(p.mode) ? p.mode : 'spawn';
          const cl = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
          const e = { seq: (s.seq|0) + 1, time: s.time, mode,
            amp: (mode === 'wash') ? cl(p.amp, 0, 0.6, 0.12) : (mode === 'gdrift') ? cl(p.amp, 0, 4, 1) : (mode === 'cap') ? cl(p.amp, 0, 200, 8) : (mode === 'beta') ? cl(p.amp, 0.02, 0.6, 0.14)
               : (mode === 'lenstau') ? cl(p.amp, -0.5, 0.5, 0) : (mode === 'refamp') ? cl(p.amp, 0, 3, 1) : cl(p.amp, -Math.PI, Math.PI, 0),
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

function makeSelfhostScripts(avatarScript) { return [selfhostWorldProgram, avatarScript]; }

const wrap2pi = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const wrap = lensU1.wrap;
// the matter/operator lens element: phase (U(1)) + rot (SO(2)) + GAIN (ℂ*, the modulus r). In U(1)-mode gain≡1 →
// the element lives on a COMPACT space (torus) → runaway-proof (2 regimes). In ℂ*-mode gain is free → NON-compact →
// the RUNAWAY regime is reachable, and the energy CAP (a bound on gain — the medium's energy law) is what tames it.
const elt = (phase, rot, gain = 1) => { const c = Math.cos(rot), s = Math.sin(rot);
  return { mode: rot ? 'metric' : 'id', phase, gain, kx: 0, ky: 0, A: [c, -s, s, c], tx: 0, ty: 0, beta: 1, omega: 0, prec: 0 }; };
const rotOf = (op) => Math.atan2(op.A[2], op.A[0]);   // read the SO(2) angle back out of A
// "M relaxes a fraction f toward O" in phase (add), rot (add), AND logGain (add — the uniform ℂ* coordinate)
const towards = (M, O, f) => elt(wrap2pi(M.phase + f * wrap(O.phase - M.phase)), rotOf(M) + f * wrap(rotOf(O) - rotOf(M)),
  Math.exp(Math.log(M.gain ?? 1) + f * (Math.log(O.gain ?? 1) - Math.log(M.gain ?? 1))));
const coherence = (M, O) => { const dp = Math.abs(wrap(O.phase - M.phase)), dr = Math.abs(wrap(rotOf(O) - rotOf(M)));
  const dg = Math.abs(Math.log((O.gain ?? 1) / (M.gain ?? 1)));   // gain mismatch counts too (ℂ*: a lock needs matching modulus AND phase)
  return Math.max(0, 1 - (dp + dr) / (2 * Math.PI) - 0.3 * Math.min(1, dg)); };   // 1 = M locked to O, 0 = opposed — the "lock" ℓ

function makeSelfhostRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    const bank = makeObserverBank(4), regs = bank.ops;   // the OBSERVER register (read-side, for chainMeter/recall stamps) — distinct from the matter M
    const dials = { viaPhi: 0.5, lensView: false };
    const K = makeCouplingStore();
    const clk = makeStepClock({ stepsPerPhase: SPP });
    const tauK = makeTauKernel({ monRate: 1, stepsPerPhase: SPP, flatL: 21 });
    const q = tauK.makeQueue('virt', { clock: null });
    // THE META-CIRCLE STATE: M[i] = the matter (a lens element); O[i] = its self-hosted operator (a lens element).
    const live = [false, false, false, false];
    const M = [null, null, null, null], O = [null, null, null, null];
    const kp = [0, 0, 0, 0], beta = [BETA0, BETA0, BETA0, BETA0], wash = [WASH0, WASH0, WASH0, WASH0];
    const gdrift = [1, 1, 1, 1], cap = [8, 8, 8, 8];   // ℂ*-mode: gdrift = operator gain-drift rate (excursion source); cap = the gain bound (medium energy law) — 0 = uncapped
    const unpinned = [false, false, false, false];   // PER-WORLDLINE governance: false = lensU1 (pinned, gain≡1, compact) · true = lensC1 (UNPINNED — amplitude DOF free). unpin(slot) moves ONE worldline lensU1→lensC1; repin projects back (gain→1). Replicated per-slot.
    const det = SLOTN.map(() => ({ bar: 0, prev: 0, lastKp: -1e9 }));
    const cohHist = [[], [], [], []];   // recent coherence for the face bar + regime readout
    const plates = [];
    let k = 0, seen = 0, booted = false, halted = false, lag = 0;
    const beatsOut = [];
    let inhabit = -1;
    const nSlots = () => 1 + (live[1] ? 1 : 0) + (live[2] ? 1 : 0) + (live[3] ? 1 : 0);
    const reanchor = (kk) => { const r = nSlots(); if (clk.reanchor(kk, r)) tauK.reanchor(kk, r); };
    const spawn = (i) => { O[i] = elt(0, 0, 1); M[i] = elt(Math.PI, 0, 1); live[i] = true; kp[i] = 0; det[i] = { bar: 0, prev: 0, lastKp: -1e9 }; };   // M starts OPPOSED to O → it must chase → the first ripple

    const stepSlot = (i, kk) => { if (!live[i]) return;
      // 1. OPERATOR PRECESSES (the moving target — the chase never finishes → a clock). In ℂ*-mode its GAIN also drifts
      //    up a touch each step (`gdrift`) — the amplitude EXCURSION the self-host loop can then amplify into runaway.
      const gd = unpinned[i] ? Math.pow(1.006, gdrift[i]) : 1;   // gdrift 1 → 0.6%/step upward drift (uncapped → runaway; cap tames it)
      O[i] = elt(wrap2pi(O[i].phase + SPIN), rotOf(O[i]) + SPIN * 0.5, unpinned[i] ? O[i].gain * gd : 1);   // pinned: gain forced to 1 (lensU1); unpinned: gain free (lensC1)
      // 2. DRIVE: matter relaxes β toward the operator (operator → matter) — phase, rot, AND logGain (ℂ*). lensU1 as physics.
      M[i] = towards(M[i], O[i], beta[i]);
      // 3. coupling (Kuramoto of self-hosting operators): a neighbour's operator nudges this one at a Q boundary
      if ((kk + 1) % 7 === 0 && K.edge && K.src[i]) { const row = K.edge[i];
        for (let j = 0; j < 4; j++) { const kap = row[j]; if (!kap || j === i || !K.src[j]) continue;
          const nb = K.src[j]; O[i] = elt(wrap2pi(O[i].phase + kap * wrap(nb[0] - O[i].phase)), rotOf(O[i]), O[i].gain); } }
      kp[i]++;
      // 4. BEAT: the lock ripple of the mismatch (matter → clock) — same detector as rhythm's ripple mode
      const l = coherence(M[i], O[i]); const D = det[i]; D.bar += (l - D.bar) / 24; const d = l - D.bar, sg = Math.sign(d);
      let beat = false; if (D.prev < 0 && sg >= 0 && kp[i] - D.lastKp >= 6) { beat = true; D.lastKp = kp[i]; } D.prev = sg;
      cohHist[i].push(l); if (cohHist[i].length > 48) cohHist[i].shift();
      // 5. SELF-HOST (matter → operator): on the beat, the matter REWRITES its operator (phase+rot+gain) toward M.
      //    U(1)-mode: gain≡1, compose-toward is bounded → STABLE (2 regimes). ℂ*-mode: gain is free and the operator's
      //    own upward drift + this self-edit form a MULTIPLICATIVE loop in r → RUNAWAY, unless CAP bounds it (the
      //    medium's energy law as an algebra op: lensU1.capGain). cap = THE stability dial.
      if (beat) {
        O[i] = towards(O[i], M[i], wash[i]);
        if (unpinned[i] && cap[i] > 0) O[i] = lensU1.capGain(O[i], cap[i]);   // the energy law: bound r → tame the runaway (only while unpinned)
        regs[i].phase = wrap2pi(regs[i].phase + (regs[i].omega || 0));
        tauK.beat(SLOTN[i], kp[i], kk); beatsOut.push(i);
      } else tauK.advance(SLOTN[i], kp[i]);
      if (!isFinite(O[i].gain) || O[i].gain > 1e7) { M[i] = elt(M[i].phase, rotOf(M[i]), 1); O[i] = elt(O[i].phase, rotOf(O[i]), 1e7); } };   // hard clamp so a diverged slot renders 'RUNAWAY' instead of NaN-crashing the engine

    // the matter/operator as a complex field (for chainMeter/coupling/recall): a tiny profile carrying (phase, rot)
    const matField = (i) => { const f = new Float64Array(8); const m = M[i] || elt(0, 0);
      f[0] = Math.cos(m.phase); f[1] = Math.sin(m.phase); f[2] = Math.cos(rotOf(m)); f[3] = Math.sin(rotOf(m));
      const o = O[i] || elt(0, 0); f[4] = Math.cos(o.phase); f[5] = Math.sin(o.phase); f[6] = coherence(m, o); f[7] = 0; return f; };

    const seed = () => { spawn(0); booted = true; };
    const appVerb = (vq, kk) => { const SNI = { W: 0, V: 1, P1: 2, P2: 3 }, si = SNI[vq.src] ?? 0;
      if (vq.mode === 'aphase') { if (live[si]) { regs[si].phase = wrap2pi(regs[si].phase + (vq.amp || 0)); console.log(`[SH] aphase ${SLOTN[si]} → ∠${regs[si].phase.toFixed(3)} atStep=${kk}`); } }
      else if (vq.mode === 'wash') { wash[si] = vq.amp ?? WASH0; console.log(`[SH] wash ${SLOTN[si]} = ${wash[si].toFixed(3)} atStep=${kk} — self-edit rate (shapes the clock within HOSTED; combine with gain for runaway)`); }
      else if (vq.mode === 'gdrift') { gdrift[si] = vq.amp ?? GDRIFT0; console.log(`[SH] gdrift ${SLOTN[si]} = ${gdrift[si].toFixed(2)} atStep=${kk} — operator gain-drift (ℂ*-mode): the amplitude excursion the self-host loop amplifies`); }
      else if (vq.mode === 'cap') { cap[si] = vq.amp ?? 8; console.log(`[SH] cap ${SLOTN[si]} = ${cap[si].toFixed(1)} atStep=${kk} — the ENERGY LAW (gain bound); low→tame, 0→uncapped→RUNAWAY. THE stability dial in ℂ*-mode`); }
      else if (vq.mode === 'unpin') { unpinned[si] = !unpinned[si];
        if (!unpinned[si]) { if (M[si]) M[si] = lensU1.pin(M[si]); if (O[si]) O[si] = lensU1.pin(O[si]); }   // REPIN = project onto the U(1) submanifold (gain → 1, energy renormalized)
        console.log(`[SH] ${SLOTN[si]} → ${unpinned[si] ? 'lensC1 (UNPINNED — amplitude DOF freed; can now run away, cap tames it)' : 'lensU1 (REPINNED — gain projected to 1; back on the compact unitary slice)'} atStep=${kk} — a worldline crossing the group boundary, live`); }
      else if (vq.mode === 'beta') { beta[si] = vq.amp ?? BETA0; console.log(`[SH] beta ${SLOTN[si]} = ${beta[si].toFixed(3)} atStep=${kk} — drive fraction (pin stiffness)`); }
      else if (vq.mode === 'kick') { if (live[si]) { M[si] = elt(wrap2pi(M[si].phase + (vq.amp || 1.5)), rotOf(M[si])); console.log(`[SH] kick ${SLOTN[si]} — matter knocked off the operator (watch it re-lock or destabilize) atStep=${kk}`); } }
      else if (vq.mode === 'spawn') { const t = vq.slot | 0; if (live[t]) { spawn(t); console.log(`[SH] respawn ${SLOTN[t]} atStep=${kk}`); } }
      else if (vq.mode === 'boot') { const t = live[2] ? 3 : 2; if (!live[t]) { spawn(t); Object.assign(regs[t], lensU1.id()); beta[t] = beta[0]; wash[t] = wash[0]; console.log(`[SH] boot ${SLOTN[t]} — a new self-hosting worldline atStep=${kk}`); } }
      else if (vq.mode === 'kill') { const t = live[3] ? 3 : live[2] ? 2 : -1; if (t > 0) { live[t] = false; M[t] = O[t] = null; Object.assign(regs[t], lensU1.id()); console.log(`[SH] kill ${SLOTN[t]} atStep=${kk}`); } }
      else if (vq.mode === 'store') { plates.push({ M: { ...M[0] }, O: { ...O[0] }, lop: { ...regs[0] }, bw: tauK.beatsOf('W') ?? 0 }); if (plates.length > 4) plates.shift(); console.log(`[SH] store — the (matter,operator) pair banked ${plates.length}/4 (∠${lensU1.angle(regs[0]).toFixed(3)}, bw=${tauK.beatsOf('W') ?? 0})`); }
      else if (vq.mode === 'recall') { if (plates.length) { let best = 0, bc = -1;
        for (let pi = 0; pi < plates.length; pi++) { const c = coherence(M[0], plates[pi].M); if (c > bc) { bc = c; best = pi; } }
        const pl = plates[best]; live[1] = true; M[1] = { ...pl.M }; O[1] = { ...pl.O }; kp[1] = 0; det[1] = { bar: 0, prev: 0, lastKp: -1e9 }; Object.assign(regs[1], lensU1.id()); beta[1] = beta[0]; wash[1] = wash[0];
        const dN = (tauK.beatsOf('W') ?? 0) - (pl.bw ?? 0);
        console.log(`[SH] recall → plate ${best + 1} (cue⊗=${bc.toFixed(3)}) → V; the remembered SELF-HOSTING operator runs again atStep=${kk}`);
        console.log(`[RECALL-∠] plate frame ∠=${lensU1.angle(pl.lop).toFixed(3)} vs W now ∠=${lensU1.angle(regs[0]).toFixed(3)} → Δ=${lensU1.wrap(lensU1.angle(regs[0]) - lensU1.angle(pl.lop)).toFixed(3)} rad · Δτ_W=${dN} beats${regs[0].omega ? ` → ω·Δτ=${lensU1.wrap(regs[0].omega * dN).toFixed(3)} predicted` : ''}`); } }
      else if (vq.mode === 'edge') { const ea = vq.gx | 0, eb = vq.gy | 0, ek = vq.leak || 0;
        if (!K.setEdge(ea, eb, ek)) console.log('[SH] edge: self-coupling ignored'); else console.log(`[SH] edge κ(${SLOTN[ea]},${SLOTN[eb]}) = ${ek} atStep=${kk} — coupled self-hosting operators`); } };
    const chainSlots = () => SLOTN.map((nm, i) => ({ name: nm, field: live[i] ? matField(i) : null, op: regs[i] })).filter((s) => s.field);

    // ── snapshot codec (f64-exact; join channel below) ──
    const takeSnap = () => ({ k, seq: seen, clk: { c0: clk.c0, rate: clk.rate, ratePrev: clk.ratePrev }, tauK: tauK.save(), bank: bank.save(), dials: { ...dials },
      K: { edge: K.edge ? K.edge.map((r) => [...r]) : null, capPh: K.capPh, capStep: K.capStep, src: K.src.map((s) => s ? Array.from(s) : null) },
      live: [...live], M: M.map((m) => m ? { ...m } : null), O: O.map((o) => o ? { ...o } : null), kp: [...kp], beta: [...beta], wash: [...wash], gdrift: [...gdrift], cap: [...cap], unpinned: [...unpinned],
      det: det.map((d) => ({ ...d })), plates: plates.map((pl) => ({ M: { ...pl.M }, O: { ...pl.O }, lop: { ...pl.lop }, bw: pl.bw })) });
    const restoreSnap = (s) => { k = s.k | 0; seen = s.seq | 0; clk.c0 = s.clk?.c0 ?? 0; clk.rate = s.clk?.rate ?? 1; clk.ratePrev = s.clk?.ratePrev ?? 1;
      if (s.tauK) tauK.restore(s.tauK); bank.restore(s.bank); Object.assign(dials, s.dials || {});
      K.edge = s.K?.edge ? s.K.edge.map((r) => [...r]) : null; K.capPh = s.K?.capPh ?? -1; K.capStep = s.K?.capStep ?? -1;
      for (let i = 0; i < 4; i++) K.src[i] = s.K?.src?.[i] ? Float64Array.from(s.K.src[i]) : null;
      for (let i = 0; i < 4; i++) { live[i] = !!s.live?.[i]; M[i] = s.M?.[i] ? { ...s.M[i] } : null; O[i] = s.O?.[i] ? { ...s.O[i] } : null;
        kp[i] = s.kp?.[i] ?? 0; beta[i] = s.beta?.[i] ?? BETA0; wash[i] = s.wash?.[i] ?? WASH0; gdrift[i] = s.gdrift?.[i] ?? GDRIFT0; cap[i] = s.cap?.[i] ?? 8; unpinned[i] = !!s.unpinned?.[i]; Object.assign(det[i], s.det?.[i] || { bar: 0, prev: 0, lastKp: -1e9 }); cohHist[i] = []; }
      plates.length = 0; for (const pl of (s.plates || [])) plates.push({ M: { ...pl.M }, O: { ...pl.O }, lop: { ...pl.lop }, bw: pl.bw | 0 });
      booted = true; console.log(`[SH] restored from join snapshot @ step=${k} — mH must match live peers at equal step`); };
    world.ps.app._snapHook = (worldSnap) => { if (booted) worldSnap.medSnapSh = takeSnap(); };

    const advance = (time) => {
      const wApp = world?.ps?.app;
      if (wApp && wApp._snapshotApplied) { wApp._snapshotApplied = false; if (wApp.medSnapSh) { restoreSnap(wApp.medSnapSh); wApp.medSnapSh = null; } }
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
        q.drain(k, (vq) => { if (!applySettingsVerb(vq, k, regs, dials)) appVerb(vq, k); reanchor(k); });
        const nSl = nSlots(); const { ph, capPh } = muxClocks(k, nSl, null);
        if (K.shouldCapture(capPh)) K.capture([live[0] ? matField(0) : null, live[1] ? matField(1) : null, live[2] ? matField(2) : null, live[3] ? matField(3) : null], k, capPh);
        stepSlot(ph, k);
        k++; done++; } } catch (err) { halted = true; console.error(`[SH] ENGINE HALTED at step=${k}:`, err); } };

    // ── audio + console ──
    let AC = null, master = null;
    const soundOn = () => { if (AC) { AC.close(); AC = null; return false; } AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.18; master.connect(AC.destination); AC.resume(); return true; };
    const pluck = (i) => { if (!AC || !live[i]) return; const ang = lensU1.wrap(lensU1.angle(regs[i])), f0 = BASEHZ[i] * Math.pow(2, (ang * (200 / Math.PI)) / 1200);
      const t0 = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f0;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45); o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.5); };
    const mH = () => { let h = 0x811c9dc5; for (let i = 0; i < 4; i++) if (live[i]) { const v = [Math.round(M[i].phase * 1e4), Math.round(rotOf(M[i]) * 1e4), Math.round(O[i].phase * 1e4), Math.round(rotOf(O[i]) * 1e4)]; for (const x of v) { h ^= (x >>> 0); h = Math.imul(h, 0x01000193) >>> 0; } } return (h >>> 0).toString(16).padStart(8, '0'); };
    // MEASURED (headless sweep): the bounded compose-toward self-edit is UNCONDITIONALLY STABLE — it can only
    // move O a fraction toward M, so it cannot diverge. The medium's RUNAWAY risk needs NONLINEAR operator gain
    // (the genome regenerating fields), which pure U(1)×SO(2) lacks — that's the honest thin↔medium difference,
    // and it means the boundary here is TWO regimes: FROZEN (stiff pin → matter locks → dead clock, the medium's
    // "field with no live chase dies" law) ↔ HOSTED (moderate pin → perpetual chase → living self-hosting clock).
    const regimeOf = (i) => { const ch = cohHist[i]; if (ch.length < 12) return '…'; const mean = ch.reduce((a, b) => a + b, 0) / ch.length;
      let vv = 0; for (const c of ch) vv += (c - mean) ** 2; vv = Math.sqrt(vv / ch.length);
      const g = Math.max(O[i]?.gain ?? 1, M[i]?.gain ?? 1);
      if (g > 50) return 'RUNAWAY';                           // ℂ*-mode, uncapped: amplitude blew up (the third regime — reachable ONLY with gain)
      if (mean > 0.85 && vv < 0.04) return 'FROZEN';          // locked, no ripple → dead clock (stiff pin: crank beta)
      return 'HOSTED'; };                                     // a living self-hosting ripple clock
    const inj = (p) => injectEvent?.({ type: 'shVerb', ...p });
    globalThis.sh = {
      chainRead: () => { const c = chainSlots(); if (c.length < 2) return '[SH] need ≥2 worldlines'; const m = chainMeter(c);
        console.log(`[CHAIN] ${m.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis} pred ${l.pred} mdl ${l.mdl})`).join(' · ')} · ε=${m.defect} · beatsS[${SLOTN.map((n) => tauK.beatsOf(n) ?? 0).join(',')}] step=${k}`); return m; },
      regime: () => { const r = SLOTN.map((n, i) => live[i] ? `${n}:${regimeOf(i)}` : `${n}:—`).join(' · '); console.log(`[SH] regimes: ${r}`); return r; },
      lensOps: () => { const o = regs.map((l, i) => ({ slot: SLOTN[i], ...l, angle: +lensU1.angle(l).toFixed(4) })); console.log(`[LENSOPS] ${o.map((l) => `${l.slot}:{∠${l.angle} ω=${l.omega}}`).join(' · ')} · step=${k}`); return o; },
      regPhase: () => ({ beats: SLOTN.map((n) => tauK.beatsOf(n) ?? 0), tau: SLOTN.map((n) => +tauK.tauOf(n).toFixed(3)), step: k, kH: tauK.hash(), mH: mH() }),
      wash: (slot = 'W', a = WASH0) => inj({ mode: 'wash', src: slot, amp: +a }),
      beta: (slot = 'W', a = BETA0) => inj({ mode: 'beta', src: slot, amp: +a }),
      gdrift: (slot = 'W', a = GDRIFT0) => inj({ mode: 'gdrift', src: slot, amp: +a }),
      cap: (slot = 'W', a = 8) => inj({ mode: 'cap', src: slot, amp: +a }), unpin: (slot = 'W') => inj({ mode: 'unpin', src: slot }),
      kick: (slot = 'W', a = 1.5) => inj({ mode: 'kick', src: slot, amp: +a }),
      aphase: (a = 0.1, slot = 'W') => inj({ mode: 'aphase', amp: +a, src: slot }), lensTau: (w = 0.1) => inj({ mode: 'lenstau', amp: +w }),
      edge: (a = 0, b = 1, kk2 = 0.1) => inj({ mode: 'edge', gx: a | 0, gy: b | 0, leak: +kk2 }),
      store: () => inj({ mode: 'store' }), recall: () => inj({ mode: 'recall' }), boot: () => inj({ mode: 'boot' }), kill: () => inj({ mode: 'kill' }), respawn: (slot = 'W') => inj({ mode: 'spawn', slot: { W: 0, V: 1, P1: 2, P2: 3 }[slot] ?? 0 }),
      sound: () => soundOn() };

    // ── UI: each worldline as M (dot) chasing O (ring) on a phase dial + the coherence/regime bar ──
    let els = null;
    const mkUI = (root) => {
      root.innerHTML = `
        <div style="font-size:11px;font-weight:bold;color:#c9f;margin-bottom:8px;letter-spacing:1px;">PEER ${peerId} · SELFHOST — the operator that hosts itself <span id="${containerId}-roster"></span></div>
        <div id="${containerId}-row" style="display:flex;gap:14px;"></div>
        <div id="${containerId}-bar" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:10px;color:#c9f;"></div>
        <div id="${containerId}-st" style="margin-top:6px;font-size:9px;color:#a8c;"></div>
        <div style="margin-top:4px;font-size:9px;color:#658;">console: sh.sound() · sh.wash('W',r) · sh.beta('W',b) · sh.unpin('W') [lensU1↔lensC1] · sh.cap('W',c) [energy law] · sh.gdrift('W',g) · sh.kick('W') · sh.regime() · sh.lensTau(ω) · sh.chainRead() · sh.store()/recall() · sh.edge(a,b,κ)</div>`;
      const row = document.getElementById(`${containerId}-row`);
      const cvs = SLOTN.map(() => { const box = document.createElement('div'); box.style.textAlign = 'center';
        const c = document.createElement('canvas'); c.width = 96; c.height = 96; Object.assign(c.style, { background: '#0a080e', borderRadius: '50%', border: '1px solid #435' });
        const lab = document.createElement('div'); lab.style.cssText = 'font-size:9px;color:#c9f;margin-top:2px;'; box.appendChild(c); box.appendChild(lab); row.appendChild(box); return { c, lab, ctx: c.getContext('2d') }; });
      const bar = document.getElementById(`${containerId}-bar`);
      const btn = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'font-size:10px;background:#212;color:#c9f;border:1px solid #435;border-radius:4px;padding:2px 8px;cursor:pointer;'; b.onclick = fn; bar.appendChild(b); return b; };
      const sld = (label, min, max, step, val, onchg) => { const w = document.createElement('span'); w.style.cssText = 'display:flex;gap:3px;align-items:center;';
        const l = document.createElement('span'); const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.style.width = '80px';
        const txt = (v) => { l.textContent = `${label} ${(+v).toFixed(3)}`; }; txt(val); i.addEventListener('input', () => txt(i.value)); i.addEventListener('change', () => onchg(+i.value));
        w.appendChild(l); w.appendChild(i); bar.appendChild(w); return { input: i, set: (v) => { if (document.activeElement === i) return; if (+i.value !== +v) i.value = v; txt(v); } }; };
      let slot = 'W'; const sel = document.createElement('select'); sel.style.cssText = 'background:#212;color:#c9f;border:1px solid #435;font-size:10px;'; for (const nm of SLOTN) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; sel.appendChild(o); } sel.onchange = () => { slot = sel.value; }; bar.appendChild(sel);
      const snd = btn('🔇 sound', () => { snd.textContent = soundOn() ? '🔊 sound' : '🔇 sound'; });
      const sWash = sld('wash', 0, 0.6, 0.005, WASH0, (v) => globalThis.sh.wash(slot, v));   // THE headline dial: the self-edit rate
      const sBeta = sld('beta', 0.02, 0.6, 0.005, BETA0, (v) => globalThis.sh.beta(slot, v));
      const sGd = sld('gdrift', 0, 4, 0.05, GDRIFT0, (v) => globalThis.sh.gdrift(slot, v));   // ℂ* amplitude-excursion rate
      const sCap = sld('cap', 0, 60, 1, 8, (v) => globalThis.sh.cap(slot, v));                 // the energy law (0 = uncapped → runaway)
      const unpb = btn('unpin', () => { globalThis.sh.unpin(slot); });   // unpin/repin the SELECTED worldline (lensU1 ↔ lensC1); label synced from unpinned[] in the frame loop
      const sOm = sld('ω', -0.5, 0.5, 0.01, 0, (v) => globalThis.sh.lensTau(v));
      btn('kick', () => globalThis.sh.kick(slot)); btn('respawn', () => globalThis.sh.respawn(slot));
      btn('store', () => globalThis.sh.store()); btn('recall', () => globalThis.sh.recall()); btn('boot', () => globalThis.sh.boot()); btn('kill', () => globalThis.sh.kill());
      return { cvs, sWash, sBeta, sGd, sCap, unpb, sOm, slotSel: () => slot, st: document.getElementById(`${containerId}-st`), roster: document.getElementById(`${containerId}-roster`) };
    };
    const REGCOL = { FROZEN: '#68a', HOSTED: '#7d7', RUNAWAY: '#e55', '…': '#556' };
    const face = (i) => { const { ctx, lab } = els.cvs[i], R = 40, cx = 48, cy = 48;
      ctx.clearRect(0, 0, 96, 96);
      if (!live[i]) { lab.textContent = `${SLOTN[i]} —`; return; }
      const reg = regimeOf(i);
      ctx.strokeStyle = '#324'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
      // O = the operator: a RING marker at its phase (the moving target the matter chases)
      const oa = O[i].phase; ctx.strokeStyle = REGCOL[reg]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx + R * Math.cos(oa - Math.PI / 2), cy + R * Math.sin(oa - Math.PI / 2), 6, 0, 2 * Math.PI); ctx.stroke();
      // M = the matter: a filled DOT at its phase (chasing O)
      const ma = M[i].phase; ctx.fillStyle = '#c9f'; ctx.beginPath(); ctx.arc(cx + R * Math.cos(ma - Math.PI / 2), cy + R * Math.sin(ma - Math.PI / 2), 4, 0, 2 * Math.PI); ctx.fill();
      // the register hand (read-side, ω-precessed)
      const ha = lensU1.angle(regs[i]); ctx.strokeStyle = '#89f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (R - 14) * Math.cos(ha - Math.PI / 2), cy + (R - 14) * Math.sin(ha - Math.PI / 2)); ctx.stroke();
      // coherence bar (center) — how locked M is to O right now (the lock ℓ that ripples into beats)
      const l = coherence(M[i], O[i]); ctx.fillStyle = REGCOL[reg]; ctx.fillRect(cx - 14, cy - 2, 28 * l, 4); ctx.strokeStyle = '#435'; ctx.strokeRect(cx - 14, cy - 2, 28, 4); ctx.lineWidth = 1;
      lab.innerHTML = `${SLOTN[i]} <span style="color:${REGCOL[reg]}">${reg}</span> τ${(tauK.tauOf(SLOTN[i]) ?? 0).toFixed(1)}<br>b${tauK.beatsOf(SLOTN[i]) ?? 0} w${wash[i].toFixed(2)}${unpinned[i] ? ` r${(O[i]?.gain ?? 1).toFixed(1)}` : ''}${regs[i].omega ? ` ω${regs[i].omega}` : ''}`; };
    return () => {
      if (!world?.ps?.app) return;
      if (!document.getElementById('selfhost-wrap')) { const wrap2 = document.createElement('div'); wrap2.id = 'selfhost-wrap'; Object.assign(wrap2.style, { display: 'flex', gap: '0', flexWrap: 'wrap' }); document.body.appendChild(wrap2); }
      let root = document.getElementById(containerId);
      if (!root) { root = document.createElement('div'); root.id = containerId; Object.assign(root.style, { fontFamily: 'ui-monospace,monospace', padding: '16px', background: '#0b0810', color: '#eee', borderRadius: '10px', margin: '10px', border: '1px solid #324' });
        document.getElementById('selfhost-wrap').appendChild(root); els = mkUI(root);
        root.addEventListener('mousemove', (e) => { const rect = root.getBoundingClientRect(); const ro = _seloInfo(world); if (ro?.myId) sendCursorMove(world.id, ro.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height); }, { passive: true }); }
      const med = world.getNodeState('med');
      if (med) { beatsOut.length = 0; advance(med.time ?? 0); for (const i of beatsOut) pluck(i); }
      if (els) { for (let i = 0; i < 4; i++) face(i);
        const si = Math.max(0, SLOTN.indexOf(els.slotSel())); els.sWash.set(wash[si]); els.sBeta.set(beta[si]); els.sGd.set(gdrift[si]); els.sCap.set(cap[si]); els.sOm.set(regs[0].omega);
        const upT = unpinned[si] ? 'repin ●' : 'unpin'; if (els.unpb.textContent !== upT) els.unpb.textContent = upT;
        els.st.textContent = `step=${k}${halted ? ' · ⚠ HALTED' : lag > 100 ? ` · replaying (${lag})` : ''} · kH=${tauK.hash()} · mH=${mH()} · beats[${SLOTN.map((n) => tauK.beatsOf(n) ?? 0).join(',')}]${K.edge ? ' · edges' : ''} — diff kH/mH across peers at equal step`;
        if (els.roster) els.roster.innerHTML = _clientBadge(world); }
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Selfhost (lens = operator = matter)',
  selo:        'selfhost',
  reflectorMs: REFLECTOR_MS,
  metaOptions: {},
  makeScripts: (av) => makeSelfhostScripts(av),
  makeRenderer: makeSelfhostRenderer,
  wrapId:      'selfhost-wrap',
};
