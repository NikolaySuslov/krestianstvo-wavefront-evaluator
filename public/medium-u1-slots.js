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
import { lensC1 } from './soliton-algebra.js';

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
// toward the target (tx,ty) by ≤1px/beat × the lock-slack sigmoid, learning a slow lock baseline. TWO MODES:
//   • FIELD-FED (field != null, corr supplied): the ⟲coevo sigmoid paces on ampCorr(field, mov) — the soliton stalls
//     when it loses coherence with its target. This reads the FIELD → NOT replay-safe (per-peer field noise → gx forks).
//   • DESCRIPTOR-ONLY (field == null): sig = 1, the leash advances at the full deterministic ≤1px/beat rate, a PURE
//     function of the leash state (no field read). This is the DOP-DRIVEN REPLAY mode: gx/gy is exact-arithmetic → in
//     regH → the attractor A=Op·ψ_base is identical on every peer → the drive op-sequence replays byte-identically.
// Returns the new moving attractor (for setObjField), or null if not chasing.
export function leashAdvance(L, field, movAtt, corr) {
  if (!L.go) return null;
  const mov0 = movAtt(L.gx, L.gy); if (!mov0) return null;
  let sig = 1;
  if (field && corr) { L.ll = corr(field, mov0);   // FIELD-FED pacing (not replay-safe; kept for the field-driven modes)
    if (L.l0 <= 0) L.l0 = L.ll || 1; else L.l0 = L.l0 * 0.98 + L.ll * 0.02;   // slow always-learning baseline
    sig = Math.max(0, Math.min(1, (L.ll / Math.max(1e-6, L.l0) - 0.75) * 4)); }   // the ⟲coevo sigmoid
  else { L.ll = 1; }   // DESCRIPTOR-ONLY: full advance, no field read → gx/gy is a pure fn of the shared step (replay-safe)
  const dx = L.tx - L.gx, dy = L.ty - L.gy, d = Math.hypot(dx, dy);   // ≤1px per beat in ANY direction (normalized step)
  if (d > 1e-9) { const st = Math.min(1, d) * sig; L.gx += (dx / d) * st; L.gy += (dy / d) * st; }
  return movAtt(L.gx, L.gy);
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
