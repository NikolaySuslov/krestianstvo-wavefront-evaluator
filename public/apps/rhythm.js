/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ════════════════════════════════════════════════════════════════════════════════════════════════
//  RHYTHM — musical matter: the synth voice IS the physics, the musical beat IS the clock.
//  ------------------------------------------------------------------------------------------------
//  The futureTau generalization at full volume (doc §12): the τ kernel knows THAT a worldline has a
//  clock, never WHY it ticks — here the worldlines are SYNTH VOICES and their clocks are MUSICAL.
//  Each slot = a voice of 4 complex harmonics (an 8-float "field"). Its own matter dynamics: every
//  harmonic rotates at its own rate per PROPER step (a literal oscillator bank); the pin (β) pulls it
//  toward its authored chord; rotation-vs-pin makes a genuine lock ripple → the 'ripple' beat source
//  beats from the voice's OWN oscillation. Or 'rhythm': a metronome in proper steps. Or 'host': the
//  voice is matterLESS (a thin chord makes a thin ripple), so a makeSelfHost unit becomes its MATTER —
//  M↔O self-hosting produces a RICH coherence ripple (the beats a bare chord can't), and its register
//  angle drives the audible detune. The clock provider IS the missing matter. Same kernel, three modes.
//  On each beat the register precesses ω (lensTau) — rendered as AUDIBLE DETUNE (±2 semitones per π
//  of register angle): two voices at different TEMPOS age at different rates, so their pitches drift
//  apart at ω·Δτ — THE TWIN PARADOX AS SOMETHING YOU HEAR. Edges = Kuramoto-of-voices (entrainment,
//  audible). store/recall = musical memory with the [RECALL-∠] observer stamp. chainMeter compares
//  voice registers exactly as it compares medium fields.
//  Sound is a PEER-LOCAL RENDER of replicated state (the KWE render law: audio = real state, plucked
//  when the SHARED engine crosses a beat); the on-screen phasor faces are the registers drawn as the
//  clock faces they are. DETERMINISM: the engine always runs in COORD (k = ⌊shared time·SPP/rate⌋, a
//  pure fn of the shared clock → byte-identical on every peer); INHABIT is pure audio re-timing at the
//  ear, never touching k. JOIN = the medium.js idiom: at join the platform asks a live peer for a state
//  snapshot (_snapHook) and the joiner restores it VERBATIM (_snapshotApplied) then tracks forward — a
//  one-shot channel, not a periodic checkpoint and not in the replicated log.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { makeTauKernel } from '../kwe-tau.js';
import { lensU1 } from '../soliton-algebra.js';
import { makeObserverBank, normalizeVirtEvent, applySettingsVerb, makeStepClock, makeCouplingStore, chainMeter, makeRippleClock, makeSelfHost, wrap2pi, fft2d, kuramotoStep, makeRegisterReadout,
  makeFieldMatter, makeHologramBank, makeEye } from '../medium-core.js';   // one import from the consolidated core: laws + kuramotoStep (XY phase, A+) + makeRegisterReadout (regPhase) + makeFieldMatter (beatmode 'field': turnkey ψ-field matter) + the HOLOGRAM bank + makeEye (the register→AUDIO sink: eye.angle→detune, eye.spectrum→overtones — one register rendered to sound). muxClocks dropped (homogeneous full-rate).

const REFLECTOR_MS = 50;
const TICK_S = REFLECTOR_MS / 1000;   // wallTime counts reflector PULSES, not ms (live-caught: /1000 ran the engine 50× slow — step=19 after a minute, zero beats ever)
const H = 6, NF = H * 2;             // harmonics per voice · floats per voice (H=1 would degenerate the ripple clock into a metronome — richness of matter IS richness of time)
const STRETCH = 0.083;               // rotation-rate incommensurability: rate_h = ROT·(h+1)·(1+h·STRETCH) → the ripple interference never repeats. INDEPENDENT of the audio overtones (f0·(h+1) stay integer — the pluck still fuses into ONE pitch)
const SPP = 19;                      // proper steps per shared second (§7.44 budget)
const BETA = 0.045, ROT = 0.11;      // pin gain · base harmonic rotation per proper step (harmonic h rotates ROT·(h+1))
// ── beatmode 'field': the OPT-IN rich-medium matter. A voice runs a small REAL U1 field (a spatial soliton on a
//    torus, stepped by the shared makeRegisterEngine: gate-D spectral lap9 + IFS ring → SPM → cap → f32). Its BEAT
//    is the soliton's lock-ripple against its pin (a genuine breathing dynamics, not a rotator interference); its
//    SPECTRUM (radial FFT bands of |ψ|²) feeds the pluck's overtones, so the medium's DISPERSION is audible — a
//    dispersing/self-focusing field makes a pluck whose timbre morphs. The other modes are untouched.
const FG = 16, FDT = 0.12, FGAMMA = 20, FISAT = 1;   // the field's grid + step constants passed to makeFieldMatter (the ring defaults to core's simpleRing(3) = rhythm's old F_OBS_RING, byte-identical)
const KQ = 7;
const SLOTN = ['W', 'V', 'P1', 'P2'];
const BASEHZ = [220, 277.18, 329.63, 392];   // A3 · C#4 · E4 · G4 — the ensemble's chord

const rhythmWorldProgram = `
  const W = Renkon.app.W;
  const reflector = Events.receiver();
  const med = Behaviors.collect(
    { time: 0, seq: 0, log: [], started: false },
    reflector,
    (state, pulse) => {
      let st = { ...state, time: pulse.wallTime ?? state.time };
      if (pulse?._isEvent && pulse?._eventPayload?.type === 'rhyVerb') {
        st = { ...st, _queue: [{ fireAt: pulse.wallTime, msg: 'verb', payload: pulse._eventPayload }, ...(st._queue ?? [])], _nextAt: pulse.wallTime };
      }
      return W.reduce(st, pulse, 'med', {
        __macro: (s, p, ctx) => { if (s.started) return s; ctx.future(1, '_keepalive', {}); return { ...s, started: true }; },
        _keepalive: (s, p, ctx) => { ctx.future(1, '_keepalive', {}); return s; },
        verb: (s, p, ctx) => {
          const MODES = ['record','recvia','aphase','aphaseset','lenstau','refamp','viaphi','store','recall','boot','kill','edge','tempo','beatmode','stretch'];
          const mode = MODES.includes(p.mode) ? p.mode : 'record';
          const cl = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
          const e = { seq: (s.seq|0) + 1, time: s.time, mode,
            amp: (mode === 'tempo') ? cl(p.amp, 1, 96, 19) : (mode === 'beatmode') ? cl(p.amp, 0, 3, 1)
               : (mode === 'stretch') ? cl(p.amp, 0, 0.4, 0.083)
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

function makeRhythmScripts(avatarScript) { return [rhythmWorldProgram, avatarScript]; }

// ── the musical matter (a voice = 4 complex harmonics) ───────────────────────────────────────────
const mkChord = (seedPh) => { const f = new Float64Array(NF);            // the authored chord voicing: falling harmonic amps, staggered phases
  for (let h = 0; h < H; h++) { const a = 1 / (h + 1), th = seedPh * (h + 1);
    f[h * 2] = a * Math.cos(th); f[h * 2 + 1] = a * Math.sin(th); } return f; };
const energy = (f) => { let e = 0; for (let i = 0; i < f.length; i++) e += f[i] * f[i]; return e; };
const capTo = (f, e0) => { const e = energy(f); if (e > e0 && e > 0) { const s = Math.sqrt(e0 / e); for (let i = 0; i < f.length; i++) f[i] *= s; } };
const corrAbs = (a, b) => { let re = 0, im = 0, ea = 0, eb = 0;
  for (let i = 0; i < H; i++) { const ar = a[i*2], ai = a[i*2+1], br = b[i*2], bi = b[i*2+1];
    re += ar * br + ai * bi; im += ar * bi - ai * br; ea += ar*ar + ai*ai; eb += br*br + bi*bi; }
  return (ea && eb) ? Math.hypot(re, im) / Math.sqrt(ea * eb) : 0; };
// wrap2pi now imported from medium-core (one definition; [0,2π) register-aging wrap)
const hashF = (f) => { let h = 0x811c9dc5; const q = new Float32Array(f);
  const b = new Uint8Array(q.buffer); for (let i = 0; i < b.length; i++) { h ^= b[i]; h = (h * 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

function makeRhythmRenderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;
  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    // ── THE ENGINE — every law imported; only the voice physics is this app's own ──
    const bank = makeObserverBank(4), ops = bank.ops;
    const dials = { viaPhi: 0.5, lensView: false };
    const K = makeCouplingStore();
    const clk = makeStepClock({ stepsPerPhase: SPP });
    const tauK = makeTauKernel({ monRate: 1, stepsPerPhase: SPP, flatL: 21 });
    const q = tauK.makeQueue('virt', { clock: null });
    const voices = [null, null, null, null], chords = [null, null, null, null], chEff = [null, null, null, null], chPh = [0, 0, 0, 0];
    const E0 = [1, 1, 1, 1], kp = [0, 0, 0, 0];
    const beatMode = ['rhythm', 'rhythm', 'rhythm', 'rhythm'], tempo = [19, 19, 19, 19];   // default: one beat per proper second — a pulse you can follow
    const stretch = [STRETCH, STRETCH, STRETCH, STRETCH];   // per-slot matter richness (replicated verb 'stretch') — rotation-rate incommensurability; higher = more aperiodic ripple
    const ripple = SLOTN.map(() => makeRippleClock({ ema: 32, refractory: 8 }));   // 'ripple' beat source — kernel provider per slot (was hand-rolled det[]; now imported LAW)
    const host = SLOTN.map(() => makeSelfHost({ beta: 0.06, wash: 0.12, spin: 0.28 }));   // 'host' beat source — the SELF-HOST unit AS this voice's matter: rich M↔O coherence ripple + a register angle for detune (the answer to "matterless" voices)
    // ── beatmode 'field' state: per-voice ψ field + its pin target + energy cap, and ONE shared register engine over
    //    a per-voice adapter (descBase↔vfield[i]) — the same pattern observers uses. Fields are null until a voice is
    //    switched to 'field' (lazy seed). The engine reads app state via getters; edges OFF here (voice coupling stays
    //    the additive Kuramoto below — a field-field coupling would be a separate future upgrade).
    // ── beatmode 'field' — the TURNKEY FIELD MATTER (shared core): makeFieldMatter stands up the ψ-field medium
    //    (ring cache + engine + slot adapters + seed + spectrum), so rhythm no longer hand-rolls the ~40 lines. The
    //    app supplies only its register (ops) and its MATTER SHAPE (the seed bump list); everything else is core.
    const _fm = makeFieldMatter({ G: FG, gamma: FGAMMA, isat: FISAT, dt: FDT, lensOp: (i) => ops[i] });   // ring defaults to simpleRing(3) = rhythm's old F_OBS_RING (byte-identical)
    // seed voice i's field: a soliton (two bumps) + its pin target (off-center twin, per-voice offset → distinct
    // ripple). Byte-identical to the old inline seedField. E0 = the seed energy (the cap holds it there).
    const seedField = (i) => { _fm.seedAtt(i, [{ cx: 6 + (i & 1), cy: 8, sg: 2.2, amp: 1.0 }]);
      _fm.seed(i, [{ cx: 6, cy: 8, sg: 2.2, amp: 1.0 }, { cx: 10, cy: 7, sg: 1.5, amp: 0.6 }]); };
    // ── THE AUDIO EYE (makeEye per voice): the register RENDERED TO SOUND. One eye reads voice i's register — its
    //    ANGLE → the pluck's detune (a scalar output), its field ENVELOPE (field-mode) → the SPECTRUM → the overtone
    //    stack. Same medium-agnostic signal a GPU sink would draw as pixels; here the sink is Web Audio. The pose is
    //    identity (voices don't transport). NB: eye.spectrum FFTs the RECONSTRUCTED field (phase-rotated), so it
    //    differs from _fm.spectrum only at float-noise (~2e-16 in |ψ|², inaudible); AUDIO IS RENDER-ONLY/peer-local
    //    (not in regH), so that noise cannot fork determinism — the eye is the honest abstraction here.
    const _eyes = SLOTN.map((nm, i) => makeEye({ op: () => ops[i], envelope: () => _fm.field(i), G: () => FG, pose: () => ({ dphi: ops[i].phase, ox: 0, oy: 0 }) }));
    const beatAcc = [0, 0, 0, 0];   // rhythm-mode phase accumulator: += 1/tempo per proper step, beat when it crosses 1 → FLOAT tempo (steps/beat), incl. irrational metronomes; replicated (snapshot-carried)
    // ── THE HOLOGRAM BANK (shared core, identity leg): rhythm's musical memory — store/recall of voice moments —
    //    now uses the SAME abstract bank as medium-u1/observers. Identity leg (a voice is a rotator bank, not a
    //    propagating field), so the plate is the raw voice and recall is correlation. The dual-layer aging readout
    //    ([RECALL-∠]: the remembered moment returns AGED — you hear the detune) comes free. plates = the bank's array.
    const _holo = makeHologramBank({ bankMax: 4, corr: corrAbs, beatsOf: (nm) => (tauK.beatsOf(nm) ?? 0) });   // no G: a voice is a 12-float rotator bank, not a grid; G is only used by shiftScan/shift, which rhythm never calls
    const plates = _holo.plates;
    let k = 0, seen = 0, booted = false, halted = false, lag = 0;
    const beatsOut = [];                                                 // beats crossed THIS frame → the audio render plucks them
    let inhabit = -1;                                                    // −1 = COORDINATE (the ensemble at its true full rate — every voice steps every k now, no mux dilation; outside view, default); 0..3 = INHABIT that worldline: the inhabitant's beats are the master pulse and the OTHER voices re-time to it (slower-tempo ones thin out — dilation heard from inside). PURE RENDER (audio re-timing at the ear), NEVER touches the engine's k → determinism intact. Since the mux unification, dilation is heard ONLY here (relative/inside), which was always the honest view — the coordinate ensemble no longer artificially slows as voices join; a voice ages slower only if its OWN tempo/ω says so.
    const rebuildChord = (i) => { if (!chords[i]) { chEff[i] = null; return; }
      if (!chEff[i] || chPh[i] !== ops[i].phase) { chEff[i] = lensU1.apply({ mode: 'id', phase: ops[i].phase, beta: 1, omega: 0, prec: 0 }, chords[i]); chPh[i] = ops[i].phase; } };
    // reanchor: REMOVED the nSl rate-flip (that WAS the mux's 1/nSl slowing). Homogeneous full-rate voices → the world
    // clock runs at a FIXED rate; differential tempo is purely voice-clock-side (beatAcc/ω). No-op hook kept for the
    // call-site/snapshot shape.
    const reanchor = (_kk) => {};
    const seed = () => { chords[0] = mkChord(0.7); voices[0] = chords[0].slice(); E0[0] = energy(voices[0]); rebuildChord(0); booted = true; };
    const stepSlot = (i, kk) => { const v = voices[i]; if (!v) return;
      rebuildChord(i);
      const beta = BETA * (ops[i].beta || 1), a = chEff[i];
      if (a) for (let j = 0; j < v.length; j++) v[j] += beta * a[j];     // the pin: pulled toward the authored chord
      const str = stretch[i];
      for (let h = 0; h < H; h++) { const th = ROT * (h + 1) * (1 + str * h), c = Math.cos(th), s = Math.sin(th), j = h * 2;   // the matter: each harmonic rotates at its own INCOMMENSURATE rate — the ripple is their interference (aperiodic, hierarchical beats)
        const re = v[j], im = v[j + 1]; v[j] = re * c - im * s; v[j + 1] = re * s + im * c; }
      if ((kk + 1) % KQ === 0 && K.edge) { const row = K.edge[i];        // Kuramoto-of-voices at the shared Q boundary (captured slice-end sources)
        for (let jj = 0; jj < 4; jj++) { const kap = row[jj]; if (!kap || jj === i || !K.src[jj]) continue;
          const s = K.src[jj]; for (let m = 0; m < v.length; m++) v[m] += kap * s[m]; } }
      capTo(v, E0[i]);
      kp[i]++;
      let beat = false;                                                  // THE PLUGGABLE CLOCK: metronome · the voice's own lock ripple · a self-host matter-clock
      if (beatMode[i] === 'rhythm') { beatAcc[i] += 1 / tempo[i];        // FLOAT tempo (steps per beat, ≥1 = the proper-time floor): a beat every `tempo` steps ON AVERAGE — 2.5 → 0,3,5,8,10…; π → an irrational metronome that never aligns to the step grid
        if (beatAcc[i] >= 1) { beat = true; beatAcc[i] -= 1; } }
      else if (beatMode[i] === 'host') { const r = host[i].step(kp[i]);  // the self-host unit IS the matter: its M↔O coherence ripple beats where a thin chord could not; its register angle IS the detune
        beat = r.beat; ops[i].phase = wrap2pi(lensU1.angle(r.O)); }      // borrow the host operator's angle straight into the register (skips the ω precession below — the host's own dynamics ARE the aging)
      else if (beatMode[i] === 'field') { if (!_fm.field(i)) seedField(i);  // the REAL U1 MEDIUM as matter (turnkey makeFieldMatter): step the soliton, beat = its lock-ripple vs the pin
        _fm.step(i, BETA / 0.15 * (ops[i].beta || 1));   // one engine step (spectral lap9 + ring → SPM → cap → f32); BETA/0.15 maps rhythm's pin strength through the engine's 0.15·bfac
        beat = ripple[i].feed(corrAbs(_fm.field(i), _fm.att(i)), kp[i]); }   // the ripple detector on the FIELD↔pin coherence — the soliton's breathing IS the clock
      else if (a) beat = ripple[i].feed(corrAbs(v, a), kp[i]);           // the ripple provider: ℓ = voice⊗chord coherence → the kernel decides the beat
      if (beat) { tauK.beat(SLOTN[i], kp[i], kk); if (beatMode[i] !== 'host') ops[i].phase = wrap2pi(ops[i].phase + (ops[i].omega || 0)); beatsOut.push(i); }
      else tauK.advance(SLOTN[i], kp[i]); };
    const appVerb = (vq, kk) => {
      const SNI = { W: 0, V: 1, P1: 2, P2: 3 };
      if (vq.mode === 'aphase') { const si = SNI[vq.src] ?? 0;
        if (voices[si]) { ops[si].phase = wrap2pi(ops[si].phase + (vq.amp || 0)); console.log(`[RHY] aphase ${SLOTN[si]} → ∠${ops[si].phase.toFixed(3)} atStep=${kk}`); } }
      else if (vq.mode === 'aphaseset') { const si = SNI[vq.src] ?? 0;   // ABSOLUTE per-slot ∠ set (the φ slider — a knob, not a ratchet like aphase)
        if (voices[si]) { ops[si].phase = wrap2pi(vq.amp || 0); console.log(`[RHY] ∠set ${SLOTN[si]} → ∠${ops[si].phase.toFixed(3)} atStep=${kk}`); } }
      else if (vq.mode === 'tempo') { const si = SNI[vq.src] ?? 0; tempo[si] = vq.amp || 19;
        console.log(`[RHY] tempo ${SLOTN[si]} = ${tempo[si].toFixed(3)} proper steps/beat atStep=${kk} — proper time's musical dial (float: 2.5 = 0,3,5,8…; π = irrational metronome)`); }
      else if (vq.mode === 'beatmode') { const si = SNI[vq.src] ?? 0; beatMode[si] = ['ripple', 'rhythm', 'host', 'field'][Math.round(vq.amp) | 0] || 'ripple';
        if (beatMode[si] === 'host') host[si].reset();                    // a fresh self-host on (re)selection → the matter starts from its authored M/O, deterministically
        if (beatMode[si] === 'field') { seedField(si); ripple[si] = makeRippleClock({ ema: 32, refractory: 8 }); }   // fresh field + a fresh ripple detector on selection → the soliton starts from its authored seed, deterministically
        console.log(`[RHY] beat source ${SLOTN[si]} = ${beatMode[si]} atStep=${kk} — the kernel never knows why a voice ticks${beatMode[si] === 'host' ? ' (self-host matter: rich ripple from M↔O, not the chord)' : beatMode[si] === 'field' ? ' (a REAL U1 soliton field: beat = its lock-ripple, timbre = its FFT spectrum — you HEAR the dispersion of the medium)' : ''}`); }
      else if (vq.mode === 'stretch') { const si = SNI[vq.src] ?? 0; stretch[si] = (typeof vq.amp === 'number') ? vq.amp : 0.083;
        console.log(`[RHY] matter richness ${SLOTN[si]} stretch = ${stretch[si].toFixed(3)} atStep=${kk} — rotation-rate incommensurability; the ripple clock is the interference of ${H} rotators`); }
      else if (vq.mode === 'boot') { const pl = plates[vq.slot | 0]; const si = voices[2] ? 3 : 2;
        if (pl && !voices[si]) { voices[si] = Float64Array.from(pl.p); chords[si] = Float64Array.from(pl.a); E0[si] = energy(voices[si]); Object.assign(ops[si], lensU1.id()); chPh[si] = NaN; chEff[si] = null; kp[si] = 0;
          console.log(`[RHY] boot plate ${vq.slot|0} → voice ${SLOTN[si]} atStep=${kk}`); } }
      else if (vq.mode === 'kill') { const si = voices[3] ? 3 : voices[2] ? 2 : -1;
        if (si > 0) { voices[si] = chords[si] = chEff[si] = null; Object.assign(ops[si], lensU1.id()); console.log(`[RHY] kill ${SLOTN[si]} atStep=${kk}`); } }
      else if (vq.mode === 'store') { if (voices[0]) {   // the hologram bank owns the plate (identity leg → p = the raw voice)
        const pl = _holo.store(voices[0], ops[0], { k: kk }); pl.a = Float64Array.from(chords[0]);   // live-only chord attached after store
        console.log(`[RHY] store — the moment's voice banked ${plates.length}/4 (frame ∠${lensU1.angle(ops[0]).toFixed(3)}, bw=${pl.bw})`); } }
      else if (vq.mode === 'recall') { if (plates.length && voices[0]) {
        const bd = _holo.bind(voices[0]); const { plate: pl, index: best } = bd;   // content-address by overlap
        voices[1] = _holo.lift(pl); chords[1] = Float64Array.from(pl.a); E0[1] = energy(voices[1]); Object.assign(ops[1], lensU1.id()); chPh[1] = NaN; chEff[1] = null; kp[1] = 0;
        const ag = _holo.agingReadout(pl, bd.cueLeg, ops[0], { name: 'W' });   // the shared dual-layer [RECALL-∠] readout
        console.log(`[RHY] recall → plate ${best + 1} (cue⊗=${bd.corr.toFixed(3)}) sounds again as V atStep=${kk}`);
        console.log(`[RECALL-∠] plate frame ∠=${lensU1.angle(pl.dop).toFixed(3)} vs W now ∠=${lensU1.angle(ops[0]).toFixed(3)} → Δ=${ag.dDesc.toFixed(3)} rad · Δτ_W=${ag.dTau} beats${ag.dOmegaTau != null ? ` → ω·Δτ=${ag.dOmegaTau.toFixed(3)} predicted` : ''}${ag.eqErr != null ? ` · |field−equation|=${ag.eqErr.toFixed(3)} ${ag.agree ? '✓' : '✗'}` : ''} — the remembered moment returns AGED (you can hear the detune)`); } }
      else if (vq.mode === 'edge') { const ea = vq.gx | 0, eb = vq.gy | 0, ek = vq.leak || 0;
        if (!K.setEdge(ea, eb, ek)) console.log('[RHY] edge: self-coupling ignored');
        else console.log(`[RHY] edge κ(${SLOTN[ea]},${SLOTN[eb]}) = ${ek} atStep=${kk} — Kuramoto-of-voices (listen for entrainment)`); }
      else { const phi = (vq.mode === 'recvia') ? (vq.amp || 0) : 0;      // record / recvia: V = W's voice, born through the lens
        if (!voices[0]) return;
        const rv = { mode: 'id', phase: phi, beta: 1, omega: 0, prec: 0 };
        voices[1] = phi ? lensU1.apply(rv, voices[0]) : voices[0].slice();
        chords[1] = phi ? lensU1.apply(rv, chords[0]) : chords[0].slice();
        E0[1] = energy(voices[1]); Object.assign(ops[1], lensU1.id()); ops[1].phase = wrap2pi(phi); ops[1].omega = ops[0].omega; chPh[1] = NaN; chEff[1] = null; kp[1] = 0;
        console.log(`[RHY] ${phi ? `V recorded THROUGH lens φ=${phi.toFixed(3)}` : 'V recorded'} atStep=${kk}`); } };
    // ── the state snapshot codec (f64-exact — JSON round-trips doubles; tauK.save carries pending stamps).
    //    Used by the platform's join channel (_snapHook / _snapshotApplied below), NOT the replicated log. ──
    const takeSnap = () => ({ k, seq: seen, clk: { c0: clk.c0, rate: clk.rate, ratePrev: clk.ratePrev },
      tauK: tauK.save(), bank: bank.save(), dials: { ...dials },
      K: { edge: K.edge ? K.edge.map((r) => [...r]) : null, capPh: K.capPh, capStep: K.capStep, src: K.src.map((s) => s ? Array.from(s) : null) },
      voices: voices.map((f) => f ? Array.from(f) : null), chords: chords.map((f) => f ? Array.from(f) : null),
      fm: _fm.save(),   // beatmode 'field' state via makeFieldMatter (a joiner in field-mode restores the live soliton verbatim, not re-seeds)
      E0: [...E0], kp: [...kp], beatMode: [...beatMode], tempo: [...tempo], stretch: [...stretch], beatAcc: [...beatAcc], ripple: ripple.map((r) => r.save()), host: host.map((h) => h.save()),
      plates: _holo.save().map((raw, i) => ({ ...raw, a: plates[i].a ? Array.from(plates[i].a) : null })) });   // bank owns the plate shape; rhythm ALSO ships `a` (the chord — no probe model to regenerate)
    const restoreSnap = (s) => { k = s.k | 0; seen = s.seq | 0;
      clk.c0 = s.clk?.c0 ?? 0; clk.rate = s.clk?.rate ?? 1; clk.ratePrev = s.clk?.ratePrev ?? 1;
      if (s.tauK) tauK.restore(s.tauK); bank.restore(s.bank); Object.assign(dials, s.dials || {});
      K.edge = s.K?.edge ? s.K.edge.map((r) => [...r]) : null; K.capPh = s.K?.capPh ?? -1; K.capStep = s.K?.capStep ?? -1;
      for (let i = 0; i < 4; i++) K.src[i] = s.K?.src?.[i] ? Float64Array.from(s.K.src[i]) : null;
      for (let i = 0; i < 4; i++) { voices[i] = s.voices?.[i] ? Float64Array.from(s.voices[i]) : null;
        chords[i] = s.chords?.[i] ? Float64Array.from(s.chords[i]) : null; chEff[i] = null; chPh[i] = NaN;
        E0[i] = s.E0?.[i] ?? 1; kp[i] = s.kp?.[i] ?? 0; beatMode[i] = s.beatMode?.[i] ?? 'rhythm'; tempo[i] = s.tempo?.[i] ?? 19; stretch[i] = s.stretch?.[i] ?? STRETCH; beatAcc[i] = s.beatAcc?.[i] ?? 0;
        ripple[i].restore(s.ripple?.[i]); host[i].restore(s.host?.[i]);
      }
      _fm.restore(s.fm);   // restore the field-mode soliton (fields/atts/E0) verbatim
      _holo.restore(s.plates);   // the bank rebuilds the plate shape
      (s.plates || []).forEach((raw, i) => { if (plates[i]) plates[i].a = raw.a ? Float64Array.from(raw.a) : null; });   // rhythm's `a` (chord) rides the snapshot
      booted = true; console.log(`[RHY] restored from checkpoint @ step=${k} — vH must match live peers at equal step`); };
    // ── JOIN SNAPSHOT (the medium.js idiom): the platform requests a state snapshot from a live peer AT JOIN via
    //    _snapHook, ships it off the render path, and sets _snapshotApplied on the joiner — who restores VERBATIM
    //    (adopting the leader's exact k/clock/state) then tracks forward. No periodic checkpoints, no verb-log
    //    snapshots — the snapshot is a one-shot platform channel, taken only when someone joins.
    world.ps.app._snapHook = (worldSnap) => { if (booted) worldSnap.medSnapRhy = takeSnap(); };   // leader fills the snapshot with its full engine state
    const advance = (time) => {
      const wApp = world?.ps?.app;
      if (wApp && wApp._snapshotApplied) { wApp._snapshotApplied = false;   // joiner: the framework applied the WS snapshot → restore the leader's state verbatim
        if (wApp.medSnapRhy) { restoreSnap(wApp.medSnapRhy); wApp.medSnapRhy = null; } }
      if (!booted) seed();                                               // fresh world (no snapshot arrived) → self-seed
      if (tauK.rate !== clk.rate || tauK.clock0 !== clk.c0) tauK.setEpoch(clk.c0, clk.rate);
      const med = world.getNodeState('med'); if (!med) return;
      if ((med.seq | 0) > seen) { for (const e of (med.log || [])) if ((e.seq | 0) > seen) { const n = normalizeVirtEvent(e); n.t = (e.time || 0) * TICK_S; q.push(n); } seen = med.seq | 0; }   // verb stamps ride the SAME clock scale as the target (pulse ticks → seconds)
      // THE ENGINE ALWAYS RUNS IN COORD (shared, deterministic): k = ⌊time·SPP/rate⌋ is a pure fn of the SHARED
      // reflector time → byte-identical on every peer, always. INHABIT is a pure AUDIO re-timing (below, in the
      // pluck dispatch), NEVER a change to k — because k is a shared coordinate and speeding it up would fork it
      // permanently (the divergence you caught). This is the honesty boundary: the frame choice lives at the
      // observer's EAR, not in the matter's clock.
      lag = Math.max(0, clk.target(time * TICK_S) - k);
      if (halted) return;                                                // a thrown engine must SAY so once, not freeze silently
      let done = 0;                                                       // frame-work cap, not a frozen goalpost
      try { while (done < 4000) {
        const tgt = clk.target(time * TICK_S);                           // shared coordinate time — recomputed every step (stale-target-safe)
        if (k >= tgt) break;
        q.drain(k, (vq) => { if (!applySettingsVerb(vq, k, ops, dials)) appVerb(vq, k); });
        // ── HOMOGENEOUS VOICES (the mux unification, matching observers/medium-u1): each voice has its OWN buffer, so
        //    ALL of them step every shared k at FULL rate — no 1/nSl mux slowing. Differential tempo now lives ENTIRELY
        //    in each voice's own clock (beatAcc += 1/tempo[i], and ω): two voices at the same tempo stay in sync however
        //    many others play; a detuned voice drifts at ITS rate, not 1/nSl. The OLD coordinate-view "ensemble dilates
        //    as voices join" (a mux artifact) is GONE — time dilation is now heard ONLY via `inhabit` (the relative
        //    re-timing at the ear), which the code's own note already called the HONEST inside-view. Capture rides a
        //    fixed Q cadence, slot-independent.
        const capPh = Math.floor(k / KQ);
        if (K.shouldCapture(capPh)) K.capture([voices[0], voices[1], voices[2], voices[3]], k, capPh);
        for (let i = 0; i < 4; i++) if (voices[i]) stepSlot(i, k);       // every live voice advances at k (homogeneous, full-rate)
        // A+: THE PHASE-KURAMOTO — edges entrain the register PHASES (audible as pitch/detune pulling together), at the
        // SAME Q boundary as the field coupling, over all voices (read-all-then-write → deterministic). Runs ALONGSIDE
        // the field coupling in stepSlot. (A 'host'-mode voice re-borrows its phase from the host next step, so it
        // doesn't hold a Kuramoto nudge — harmless; the law still runs.)
        if (K.edge && ((k + 1) % KQ) === 0) { const { dth, any } = kuramotoStep(ops.map((o) => o.phase), K.edge, { born: voices.map((v) => !!v) });
          if (any) for (let i = 0; i < 4; i++) if (dth[i]) ops[i].phase = wrap2pi(ops[i].phase + dth[i]); }
        k++; done++; } } catch (err) { halted = true; console.error(`[RHY] ENGINE HALTED at step=${k}:`, err); } };
    // ── the AUDIO RENDER (peer-local; sound = the replicated state, plucked at its beats) ──
    let AC = null, master = null;
    const soundOn = () => { if (AC) { AC.close(); AC = null; drones = null; clickOn = false; console.log('[RHY] audio OFF'); return false; }   // closing the context kills the drone nodes — drop the refs (stale nodes throw)
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = 0.22; master.connect(AC.destination);
      AC.resume().then(() => console.log(`[RHY] audio ON (state=${AC.state}) — beats pluck as the shared engine crosses them`));   // Chrome: a context born outside a trusted gesture starts SUSPENDED and stays silent — resume explicitly (live-caught: "no audio")
      { const o = AC.createOscillator(), g = AC.createGain();             // TEST BEEP through the SAME output chain — bisects "chain broken" vs "plucks not firing"
        o.frequency.value = 440; o.type = 'sine'; g.gain.value = 0.15; o.connect(g); g.connect(master);
        o.start(); o.stop(AC.currentTime + 0.15);
        console.log('[RHY] test beep (A4, 150ms) — heard it ⇒ the chain works and the beats are the question; silent ⇒ context/output device'); }
      return true; };
    let _plucks = 0;
    // ── DRONES (render-only): one sustained tone per live worldline, detune following the LIVE register angle —
    //    the STATE made continuously audible (ω·τ aging = slow glissandi; the u-register's links = the drifting
    //    intervals between drones). Plucks remain the EVENTS (beats); the drone renders replicated state like a
    //    canvas does, so peers cannot fork on it. ── WALL CLICK: a soft coordinate-time metronome (1/s of WALL,
    //    labeled as such) — the undilated reference. Since the mux unification the ensemble no longer falls behind by
    //    slot COUNT (all voices run full-rate); the click is the reference for the dilation that REMAINS — per-voice
    //    tempo/ω (a slow-tempo voice audibly lags the click) and the `inhabit` inside-view re-timing.
    let drones = null, clickOn = false, nextClick = 0;
    const droneToggle = () => { if (!AC) { console.log('[RHY] enable sound first'); return false; }
      if (drones) { for (const d of drones) { try { d.o.stop(); } catch (e) {} } drones = null; console.log('[RHY] drones OFF'); return false; }
      drones = SLOTN.map((nm, i) => { const o = AC.createOscillator(), g = AC.createGain();
        o.type = 'triangle'; o.frequency.value = BASEHZ[i]; g.gain.value = 0.0; o.connect(g); g.connect(master); o.start(); return { o, g }; });
      console.log('[RHY] drones ON — sustained state: detune = the register angle, live'); return true; };
    const clickToggle = () => { clickOn = !clickOn; nextClick = 0; console.log(`[RHY] wall click ${clickOn ? 'ON — coordinate time, 1/s of WALL (the undilated reference; slow-tempo/ω voices lag it — dilation is per-voice now, not per-count)' : 'OFF'}`); return clickOn; };
    const relPending = [[], [], [], []]; let relLastBeat = 0;            // RELATIVE-mode: other slots' beats, dripped at the inhabitant's beat cadence
    const inhabitCycle = () => {                                         // COORDINATE → W → V → P1 → P2 → COORDINATE. A frame choice at the observer boundary (render-only, peer-local)
      do { inhabit = (inhabit + 2) % 5 - 1; } while (inhabit >= 0 && !voices[inhabit]);   // skip empty slots
      for (const q of relPending) q.length = 0; relLastBeat = inhabit >= 0 ? (tauK.beatsOf(SLOTN[inhabit]) ?? 0) : 0;
      console.log(`[RHY] inhabit = ${inhabit < 0 ? 'COORDINATE (the ensemble at true full rate — the outside view)' : `${SLOTN[inhabit]} (INSIDE: its beats are the master pulse; the others re-time to it — slower-tempo ones thin out, dilation from within)`}`);
      return inhabit; };
    const audioFrame = () => { if (!AC) return;
      if (inhabit >= 0) {                                                 // INHABIT: the inhabitant's beats are the master pulse; drip ONE deferred beat from each other slot per inhabitant beat → slower slots run dry between beats and thin out (dilation seen from inside)
        const ib = tauK.beatsOf(SLOTN[inhabit]) ?? 0;
        if (ib > relLastBeat) { relLastBeat = ib;
          for (let j = 0; j < 4; j++) if (j !== inhabit && relPending[j].length) { relPending[j].shift(); pluck(j); } } }
      if (drones) for (let i = 0; i < 4; i++) { const d = drones[i];
        const on = !!voices[i], ang = on ? lensU1.wrap(lensU1.angle(ops[i])) : 0;
        d.g.gain.setTargetAtTime(on ? 0.045 : 0.0, AC.currentTime, 0.1);
        if (on) d.o.frequency.setTargetAtTime(BASEHZ[i] * Math.pow(2, (ang * (200 / Math.PI)) / 1200), AC.currentTime, 0.08); }
      if (clickOn) { const t = AC.currentTime;
        if (t >= nextClick) { const o = AC.createOscillator(), g = AC.createGain();
          o.type = 'square'; o.frequency.value = 1900; g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
          o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.04);
          nextClick = (nextClick && t - nextClick < 0.5) ? nextClick + 1 : t + 1; } } };
    const pluck = (i) => { if (!AC || !voices[i]) return;
      if (AC.state === 'suspended') AC.resume();                         // belt-and-braces: some browsers re-suspend on tab switches
      if (_plucks < 6) console.log(`[RHY] pluck ${SLOTN[i]} #${_plucks + 1} (state=${AC.state}, t=${AC.currentTime.toFixed(2)})`); _plucks++;
      const ang = lensU1.wrap(_eyes[i].angle());                        // the AUDIO EYE: register angle → detune (±200 cents per π — precession is a GLISSANDO over beats). eye.angle() = lensU1.angle(ops[i])
      const cents = ang * (200 / Math.PI), f0 = BASEHZ[i] * Math.pow(2, cents / 1200);
      // OVERTONE AMPLITUDES: for a 'field' voice they come from the MEDIUM'S SPECTRUM (radial FFT bands) — so the
      // pluck's timbre IS the soliton's spatial-frequency content, morphing as it disperses/self-focuses (a tight
      // soliton = bright/broadband, a spread one = dull/low). Other modes use the harmonic-rotator magnitudes.
      const fieldMode = beatMode[i] === 'field' && _fm.field(i);
      const spec = fieldMode ? _eyes[i].spectrum(H) : null;   // the AUDIO EYE: field ENVELOPE → radial spectrum → the overtone stack (the timbre morphs with the medium's dispersion)
      const t0 = AC.currentTime, e = fieldMode ? Math.min(1, _fm.energy(i) / (_fm.e0(i) || 1)) : Math.min(1, energy(voices[i]) / (E0[i] || 1));
      for (let h = 0; h < H; h++) { const amp = spec ? spec[h] : Math.hypot(voices[i][h*2], voices[i][h*2+1]);
        if (amp < 0.02) continue;
        const o = AC.createOscillator(), g = AC.createGain();
        o.frequency.value = f0 * (h + 1); o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5 * e * amp / (h + 1), t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);          // long ring-out (was 0.22s — too short to hear the stack's timbre; render-only, peers cannot fork on a decay time)
        o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.9); } };
    // ── console instruments ──
    const chainSlots = () => SLOTN.map((nm, i) => ({ name: nm, field: voices[i], op: ops[i] })).filter((s) => s.field);
    const inj = (p) => injectEvent?.({ type: 'rhyVerb', ...p });
    const _rout = makeRegisterReadout({ tauK, names: SLOTN, op: (i) => ops[i], born: (i) => !!voices[i], step: () => k });   // the FULL register introspection (∠/ω/β/beats/τ/born per slot) — rhythm as a full-fidelity U1 demo
    globalThis.rhy = {
      chainRead: () => { const c = chainSlots(); if (c.length < 2) return '[RHY] need ≥2 voices';
        const m = chainMeter(c); const out = { ...m, beats: SLOTN.map((nm) => tauK.beatsOf(nm) ?? 0), step: k };
        console.log(`[CHAIN] ${out.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis} pred ${l.pred} mdl ${l.mdl})`).join(' · ')} · ε=${out.defect} (alg ${out.algDefect}) · beatsS[${out.beats.join(',')}] step=${k}`); return out; },
      lensOps: () => { const o = ops.map((l, i) => ({ slot: SLOTN[i], ...l, angle: +lensU1.angle(l).toFixed(4) }));
        console.log(`[LENSOPS] ${o.map((l) => `${l.slot}:{∠${l.angle} β=${l.beta} ω=${l.omega}}`).join(' · ')} · step=${k}`); return o; },
      regPhase: () => _rout.phase({ vH: voices[0] ? hashF(voices[0]) : null }),   // {beats,tau,step,kH} shared + rhythm's voice hash
      rec: (phi = 0) => inj(phi ? { mode: 'recvia', amp: +phi } : { mode: 'record' }),
      aphase: (a = 0.1, slot = 'W') => inj({ mode: 'aphase', amp: +a, src: slot }),
      aphaseSet: (a = 0, slot = 'W') => inj({ mode: 'aphaseset', amp: +a, src: slot }),   // absolute ∠ (the per-slot φ knob)
      viaPhi: (a = 0.5) => inj({ mode: 'viaphi', amp: +a }),   // the global record-through-lens angle (feeds ⎙viaφ)
      lensTau: (w = 0.1, slot = null) => inj({ mode: 'lenstau', amp: +w, ...(slot ? { src: slot } : {}) }),   // per-slot ω when slot given (differential aging); global when omitted
      refAmp: (slot = 'V', m = 1) => inj({ mode: 'refamp', src: slot, amp: +m }),
      edge: (a = 0, b = 1, kk2 = 0.1) => inj({ mode: 'edge', gx: a | 0, gy: b | 0, leak: +kk2 }),
      tempo: (slot = 'V', n = 19) => inj({ mode: 'tempo', src: slot, amp: n }),
      beatMode: (slot = 'V', m = 'rhythm') => inj({ mode: 'beatmode', src: slot, amp: { ripple: 0, rhythm: 1, host: 2, field: 3 }[m] ?? 1 }),
      stretch: (slot = 'V', s = 0.083) => inj({ mode: 'stretch', src: slot, amp: +s }),
      store: () => inj({ mode: 'store' }), recall: () => inj({ mode: 'recall' }),
      boot: (n = 0) => inj({ mode: 'boot', slot: n | 0 }), kill: () => inj({ mode: 'kill' }),
      sound: () => soundOn(), drone: () => droneToggle(), click: () => clickToggle(), inhabit: () => inhabitCycle() };
    // ── UI: the registers as CLOCK FACES ──
    let els = null;
    const mkUI = (root) => {
      root.innerHTML = `
        <div style="font-size:11px;font-weight:bold;color:#fd9;margin-bottom:8px;letter-spacing:1px;">PEER ${peerId} · RHYTHM — musical matter, musical clocks <span id="${containerId}-roster"></span></div>
        <div id="${containerId}-row" style="display:flex;gap:14px;"></div>
        <div id="${containerId}-bar" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:10px;color:#fd9;"></div>
        <div id="${containerId}-st" style="margin-top:6px;font-size:9px;color:#a87;"></div>
        <div style="margin-top:4px;font-size:9px;color:#654;">console: rhy.sound() · rhy.rec(φ) · rhy.aphaseSet(∠,'V') · rhy.tempo('V',N) · rhy.lensTau(ω,'V') · rhy.beatMode('V','field') · rhy.chainRead() · rhy.store()/recall() · rhy.edge(a,b,κ) · rhy.checkpoint()</div>`;
      const row = document.getElementById(`${containerId}-row`);
      const cvs = SLOTN.map((nm) => { const box = document.createElement('div'); box.style.textAlign = 'center';
        const c = document.createElement('canvas'); c.width = 84; c.height = 84;
        Object.assign(c.style, { background: '#0a0806', borderRadius: '50%', border: '1px solid #432' });
        const lab = document.createElement('div'); lab.style.cssText = 'font-size:9px;color:#fd9;margin-top:3px;';
        box.appendChild(c); box.appendChild(lab); row.appendChild(box); return { c, lab, ctx: c.getContext('2d') }; });
      const bar = document.getElementById(`${containerId}-bar`);
      const btn = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'font-size:10px;background:#211;color:#fd9;border:1px solid #543;border-radius:4px;padding:2px 8px;cursor:pointer;'; b.onclick = fn; bar.appendChild(b); return b; };
      // sliders follow the medium's bar5 law: the CHANGE event injects the replicated verb; the POSITION is
      // reflected from replicated state every frame (set() skips while the user is dragging) — so a slot switch
      // retargets the dials instantly and another peer's verbs move YOUR sliders (live-caught omission).
      const sld = (label, min, max, step, val, onchg) => { const w = document.createElement('span'); w.style.cssText = 'display:flex;gap:3px;align-items:center;';
        const l = document.createElement('span'); const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.style.width = '70px';
        const txt = (v) => { l.textContent = `${label} ${(+v).toFixed(2)}`; }; txt(val);
        i.addEventListener('input', () => txt(i.value));
        i.addEventListener('change', () => onchg(+i.value));
        w.appendChild(l); w.appendChild(i); bar.appendChild(w);
        return { input: i, set: (v) => { if (document.activeElement === i) return; if (+i.value !== +v) i.value = v; txt(v); } }; };
      let slot = 'V'; const sel = document.createElement('select'); sel.style.cssText = 'background:#211;color:#fd9;border:1px solid #543;font-size:10px;';
      for (const nm of SLOTN) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; sel.appendChild(o); } sel.value = 'V';
      sel.onchange = () => { slot = sel.value; }; bar.appendChild(sel);
      const snd = btn('🔇 sound', () => { snd.textContent = soundOn() ? '🔊 sound' : '🔇 sound'; });   // the INSTANCE's own toggle — two peer panels share the page, and globalThis.rhy is the LAST panel's (live-caught: panel A's button was toggling panel B's context)
      btn('⎙rec', () => globalThis.rhy.rec(0)); btn('⎙viaφ', () => globalThis.rhy.rec(dials.viaPhi));
      const sPhi = sld('φ', -3.14, 3.14, 0.05, 0, (v) => globalThis.rhy.aphaseSet(v, slot));           // per-SLOT ∠ (the dropdown targets it; absolute set, reflected on switch)
      const sOm = sld('ω', -0.5, 0.5, 0.01, 0, (v) => globalThis.rhy.lensTau(v, slot));                 // per-SLOT ω (each worldline ages at its own rate — the twin experiment)
      const sVia = sld('φ:rec', -3.14, 3.14, 0.05, 0.5, (v) => globalThis.rhy.viaPhi(v));               // GLOBAL: the ⎙viaφ record-through-lens angle (not a register value — feeds the record verb)
      const sBeta = sld('β', 0, 3, 0.05, 1, (v) => globalThis.rhy.refAmp(slot, v));                     // per-SLOT (the dropdown targets it; reflected on switch)
      const sTmp = sld('tempo', 1, 96, 0.05, 19, (v) => globalThis.rhy.tempo(slot, v));   // float steps/beat, ≥1 (the proper-time floor)
      const sStr = sld('matter', 0, 0.4, 0.005, STRETCH, (v) => globalThis.rhy.stretch(slot, v));      // per-SLOT ripple richness (rotation-rate incommensurability)
      btn('beat:src', () => { const order = ['ripple', 'rhythm', 'host', 'field']; const cur = order.indexOf(beatMode[SLOTN.indexOf(slot)]);
        globalThis.rhy.beatMode(slot, order[(cur + 1) % 4]); });   // cycle ripple → rhythm → host → field (a REAL U1 soliton as matter; its FFT shapes the timbre)
      btn('store', () => globalThis.rhy.store()); btn('recall', () => globalThis.rhy.recall());
      btn('boot', () => globalThis.rhy.boot(Math.max(0, plates.length - 1))); btn('kill', () => globalThis.rhy.kill());
      const drn = btn('drone', () => { drn.textContent = droneToggle() ? 'drone ●' : 'drone'; });
      const clk2 = btn('click', () => { clk2.textContent = clickToggle() ? 'click ●' : 'click'; });
      const inh = btn('⊙ coord', () => { const v = inhabitCycle(); inh.textContent = v < 0 ? '⊙ coord' : `⊙ ${SLOTN[v]}`; });   // inhabit toggle: coord → W → V → P1 → P2
      return { cvs, sPhi, sOm, sVia, sBeta, sTmp, sStr, slotSel: () => slot, st: document.getElementById(`${containerId}-st`), roster: document.getElementById(`${containerId}-roster`) };
    };
    const face = (i) => { const { ctx, lab } = els.cvs[i]; const R = 42;
      ctx.clearRect(0, 0, 84, 84);
      if (!voices[i]) { lab.textContent = `${SLOTN[i]} —`; return; }
      ctx.strokeStyle = '#543'; ctx.beginPath(); ctx.arc(R, R, R - 3, 0, 2 * Math.PI); ctx.stroke();
      const ang = lensU1.angle(ops[i]);                                  // the REGISTER as a clock hand
      ctx.strokeStyle = '#fd9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(R, R);
      ctx.lineTo(R + (R - 8) * Math.cos(ang - Math.PI / 2), R + (R - 8) * Math.sin(ang - Math.PI / 2)); ctx.stroke(); ctx.lineWidth = 1;
      for (let h = 0; h < H; h++) { const re = voices[i][h*2], im = voices[i][h*2+1], a = Math.hypot(re, im), th = Math.atan2(im, re);   // the matter: harmonic phasors as dots
        const r2 = 8 + h * 5.4; ctx.fillStyle = `hsl(${35 + h * 18},80%,${30 + Math.min(50, a * 60)}%)`;   // 6 rings inside the face
        ctx.beginPath(); ctx.arc(R + r2 * Math.cos(th - Math.PI / 2), R + r2 * Math.sin(th - Math.PI / 2), 2.6, 0, 2 * Math.PI); ctx.fill(); }
      const modeTag = beatMode[i] === 'rhythm' ? `rhythm·${tempo[i].toFixed(2)}` : beatMode[i] === 'host' ? 'host·M↔O' : beatMode[i] === 'field' ? 'field·⊛soliton' : `ripple:${stretch[i].toFixed(2)}`;
      lab.innerHTML = `${SLOTN[i]} ∠${lensU1.wrap(ang).toFixed(2)} τ${(tauK.tauOf(SLOTN[i]) ?? 0).toFixed(1)}${ops[i].beta !== 1 ? ` β${ops[i].beta}` : ''}<br>${modeTag} b${tauK.beatsOf(SLOTN[i]) ?? 0}${ops[i].omega ? ` ω${ops[i].omega}` : ''}`; };
    return () => {
      if (!world?.ps?.app) return;
      if (!document.getElementById('rhythm-wrap')) { const wrap = document.createElement('div'); wrap.id = 'rhythm-wrap';
        Object.assign(wrap.style, { display: 'flex', gap: '0', flexWrap: 'wrap' }); document.body.appendChild(wrap); }
      let root = document.getElementById(containerId);
      if (!root) { root = document.createElement('div'); root.id = containerId;
        Object.assign(root.style, { fontFamily: 'ui-monospace,monospace', padding: '16px', background: '#0d0a08', color: '#eee', borderRadius: '10px', margin: '10px', border: '1px solid #332' });
        document.getElementById('rhythm-wrap').appendChild(root); els = mkUI(root);
        root.addEventListener('mousemove', (e) => { const rect = root.getBoundingClientRect(); const ro = _seloInfo(world);
          if (ro?.myId) sendCursorMove(world.id, ro.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height); }, { passive: true }); }
      const med = world.getNodeState('med');
      if (med) { beatsOut.length = 0; advance(med.time ?? 0);
        for (const i of beatsOut) {                                       // COORD & ABSOLUTE: every crossed beat plays NOW (ABSOLUTE ran the engine nSl× faster → full-speed). RELATIVE: the inhabitant plays now, others DEFER to be dripped at the inhabitant's cadence (audioFrame).
          if (inhabit < 0 || i === inhabit) pluck(i);
          else relPending[i].push(1);
        } }
      audioFrame();                                                       // drones follow live register angles; the wall click keeps coordinate time; inhabited re-timing released here
      if (els) { for (let i = 0; i < 4; i++) face(i);
        const si = Math.max(0, SLOTN.indexOf(els.slotSel()));            // reflect replicated state onto the dials (bar5 law) — φ, ω, β, tempo, matter all follow the SELECTED slot now
        els.sPhi.set(lensU1.wrap(ops[si].phase)); els.sOm.set(ops[si].omega); els.sVia.set(dials.viaPhi);   // φ/ω per-slot; φ:rec is the global via dial
        els.sBeta.set(ops[si].beta); els.sTmp.set(tempo[si]); els.sStr.set(stretch[si]);
        const c = chainSlots(); const eps = c.length >= 2 ? chainMeter(c).defect : '—';
        els.st.textContent = `step=${k}${halted ? ' · ⚠ HALTED (see console error)' : lag > 100 ? ` · replaying (${lag} behind)` : ''} · kH=${tauK.hash()} · vH=${voices[0] ? hashF(voices[0]) : '—'} · ε=${eps} · plates=${plates.length}${K.edge ? ' · edges ON' : ''} — diff kH/vH across peers at equal step`;
        if (els.roster) els.roster.innerHTML = _clientBadge(world); }
      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Rhythm (musical matter)',
  selo:        'rhythm',
  reflectorMs: REFLECTOR_MS,
  metaOptions: {},
  makeScripts: (av) => makeRhythmScripts(av),
  makeRenderer: makeRhythmRenderer,
  wrapId:      'rhythm-wrap',
};
