// medium-u1-slots.test.mjs — the observer SLOT abstraction (doc/medium-u1-slots.md; extraction ladder S1).
// The load-bearing claim of the slot-centric redesign: TRANSPORT IS THE REGISTER LEASH. medium.js ran two
// transport laws (W regenerates its attractor, V/P roll a stored plate; medium.js:1551 called it "a
// different transport law for V than W"). The slot model unifies them: ONE leashAdvance law, the only
// per-slot difference is movAtt(gx,gy). This test proves the unification headlessly (the leash is pure).
// Run: node test/medium-u1-slots.test.mjs.
import { makeLeash, leashAdvance, leashDue, makeSlot, makeSlotBank, makeSlotMux } from '../public/medium-u1-slots.js';
import { makeObserverBank, makeCouplingStore, muxClocks } from '../public/medium-core.js';
import { makeSolitonEngine } from '../public/medium-gpu.js';

let ok = true; const chk = (n, c) => { if (!c) { ok = false; console.log(`FAIL ${n}`); } else console.log(`  ok  ${n}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── makeLeash: the chase command record ──────────────────────────────────────────────────────────
{
  const L = makeLeash();
  chk('leash starts released (go=false, at origin)', L.state.go === false && L.state.gx === 0 && L.state.gy === 0);
  L.virtGo(5, -3);
  chk('virtGo(tx,ty) arms the chase (command-fresh lt=-1)', L.state.go === true && L.state.tx === 5 && L.state.ty === -3 && L.state.lt === -1 && L.state.l0 === 0);
  L.state.gx = 2; L.state.gy = 2;
  L.release();
  chk('release() clears the chase back to origin', L.state.go === false && L.state.gx === 0 && L.state.gy === 0 && L.state.tx === 0);
  L.virtGo(1, 1); const snap = L.save(); const L2 = makeLeash(); L2.restore(snap);
  chk('save/restore round-trips the leash', eq(L2.state, L.state));
  // setTarget MOVES the target without re-arming (the objorbit-continuous / every-frame-safe form)
  const L3 = makeLeash(); L3.virtGo(5, 0); L3.state.gx = 3; L3.state.l0 = 0.8; L3.state.lt = 2;
  L3.setTarget(6, 1);
  chk('setTarget moves tx/ty WITHOUT resetting the eased chase (gx/l0/lt preserved)', L3.state.tx === 6 && L3.state.ty === 1 && L3.state.gx === 3 && L3.state.l0 === 0.8 && L3.state.lt === 2);
  chk('virtGo RE-ARMS (lt=-1, l0=0) — the fresh-command semantics (calling it every frame would freeze the chase)', (L3.virtGo(6, 1), L3.state.lt === -1 && L3.state.l0 === 0));
}

// ── THE UNIFICATION: one leashAdvance law drives regenerable AND plate slots identically ───────────
{
  const corr = () => 0.9;                                       // stub high lock → full advance every beat
  const regenAtt = (gx, gy) => ({ gx, gy });                   // regenerable: attractor AT the eased position (float)
  const plateAtt = (gx, gy) => ({ gx: Math.round(gx), gy: Math.round(gy) });   // plate: rolled to integer cells
  const run = (movAtt) => { const L = makeLeash(); L.virtGo(5, 0); const path = [];
    for (let b = 0; b < 20; b++) { leashAdvance(L.state, {}, movAtt, corr); path.push([+L.state.gx.toFixed(6), +L.state.gy.toFixed(6)]); } return path; };
  const pRegen = run(regenAtt), pPlate = run(plateAtt);
  chk('THE UNIFICATION: same leash law drives both kinds identically (gx/gy path equal)', eq(pRegen, pPlate));
  chk('the leash reaches its target (5,0) at ≤1px/beat', eq(pRegen[pRegen.length - 1], [5, 0]) && eq(pRegen[0], [1, 0]));
  // a released leash advances nowhere
  const L = makeLeash(); chk('a released leash returns null (no chase)', leashAdvance(L.state, {}, regenAtt, corr) === null);
  // DESCRIPTOR-ONLY mode (field=null) — the dop-driven replay path: gx/gy advance is a PURE FN of the leash state (no
  // field read, sig=1 full advance) → deterministic → byte-identical across peers (the replay foundation).
  const runDescOnly = () => { const Ld = makeLeash(); Ld.virtGo(5, 0); const path = [];
    for (let b = 0; b < 20; b++) { leashAdvance(Ld.state, null, regenAtt, null); path.push([+Ld.state.gx.toFixed(6), +Ld.state.gy.toFixed(6)]); } return path; };
  chk('DESCRIPTOR-ONLY leash (field=null) is deterministic (pure fn of state → replay-safe)', eq(runDescOnly(), runDescOnly()));
  chk('DESCRIPTOR-ONLY leash reaches the target at full ≤1px/beat (sig=1, no field stall)', eq(runDescOnly()[runDescOnly().length - 1], [5, 0]) && eq(runDescOnly()[0], [1, 0]));
  // the lock-slack sigmoid stalls the advance when coherence collapses
  const Llow = makeLeash(); Llow.virtGo(5, 0); Llow.state.l0 = 1;
  leashAdvance(Llow.state, {}, regenAtt, () => 0.1);           // ll≪l0 → sigmoid 0 → no motion
  chk('low lock (ll≪l0) stalls the leash (the coherence gate)', Llow.state.gx === 0);
}

// ── leashDue: the τ_i cadence gate (per-slot-beat, or flat-grid fallback) ──────────────────────────
{
  const L = makeLeash();
  const flat = []; for (let kp = 0; kp < 45; kp++) if (leashDue(L.state, kp, null)) flat.push(kp);
  chk('leashDue(null beats) = flat 21-step grid (the no-clock fallback)', eq(flat, [0, 21, 42]));
  const L2 = makeLeash(); const fires = [];
  for (let kp = 0; kp < 12; kp++) { const beats = Math.floor(kp / 3); if (leashDue(L2.state, kp, beats)) fires.push([kp, beats]); }
  chk('leashDue(per-slot beats) fires ONCE per slot-beat (τ_i cadence)', eq(fires, [[3, 1], [6, 2], [9, 3]]));
  chk('leashDue advances the cursor lt to the consumed beat', L2.state.lt === 3);
}

// ── makeSlot / makeSlotBank: the facade over the extracted bank + engine ───────────────────────────
{
  const bank = makeObserverBank(4);
  const engine = makeSolitonEngine({ gpu: () => null, GRID: 16, N_CELLS: 256, DT: 0.1 });
  const sb = makeSlotBank({ bank, engine });
  chk('slot bank has 4 slots W/V/P1/P2', sb.count() === 4 && sb.slots.map((s) => s.name).join(',') === 'W,V,P1,P2');
  chk('W is regenerable, V/P are plate (the default kinds)', sb.byName('W').kind === 'regenerable' && sb.byName('V').kind === 'plate' && sb.byName('P1').kind === 'plate');
  // the slot's readOp is a LIVE view of the bank (not a copy)
  bank.ops[1].phase = 1.04;
  chk('slot.readOp is a LIVE view of bank.ops (not a copy)', sb.byName('V').readOp.phase === 1.04 && sb.byName('V').readOp === bank.ops[1]);
  chk('slot.angle() reads the register angle through the algebra', Math.abs(sb.byName('V').angle() - 1.04) < 1e-9);
  // virtGo on a slot arms its leash (transport = this on the W slot)
  sb.byName('W').virtGo(7, 2);
  chk('slot.virtGo arms the slot leash (transport = W.virtGo)', sb.byName('W').leash.state.go === true && sb.byName('W').leash.state.tx === 7);
  // bank save/restore
  const snap = sb.save(); const sb2 = makeSlotBank({ bank, engine }); sb2.restore(snap);
  chk('slot bank save/restore round-trips leash + kind', sb2.byName('W').leash.state.tx === 7 && sb2.byName('W').kind === 'regenerable');
}

// ── makeSlotMux (S2): the two-clock schedule — owner rotation + park/reload, over a stub GPU ────────
{
  // a stub GPU that records the buffer it holds (a tag) so we can assert the park/reload dance
  let held = 'W-live';
  const stub = {
    readEyePsi: () => held,
    setEyePsi: (f) => { held = f; },
    setObjField: () => {}, applyEyeSuperpose: () => {}, stepEyeN: () => {},
    applyEyeNlSpm: () => {}, applyEyeEnergyCap: () => {},
  };
  const bank = makeObserverBank(4);
  const engine = makeSolitonEngine({ gpu: () => stub, GRID: 16, N_CELLS: 256, DT: 0.1 });
  const K = makeCouplingStore();
  const sb = makeSlotBank({ bank, engine });
  // birth W + V (two live slots → nSl=2, mux active)
  sb.byName('W').born = true; sb.byName('W').field = 'W-store';
  sb.byName('V').born = true; sb.byName('V').field = 'V-store'; sb.byName('V').e0 = 1;
  const mux = makeSlotMux({
    gpu: () => stub, engine, muxClocks, K, DT: 0.1, SOL_GAMMA: 20, SOL_ISAT: 1, Q: 7,
    beta: () => 0.15, kApply: () => {}, selfClkTick: () => {}, tauAdv: () => {},
    applyOpenBoundary: () => {}, ampCorr: () => 0.9, boundOpen: () => false,
    selfClk: () => null, leashDue, beatsOf: () => null,
  });
  chk('mux nSlots counts born slots', mux.nSlots(sb.slots) === 2);
  // k where ph=0 (W owns): step returns false (the drive runs, not the mux)
  const r0 = mux.step(0, sb.slots, 'homeAtt');   // k=0, nSl=2 → ph = 0%2 = 0 (W)
  chk('mux step at a home-owned k returns false (drive runs W)', r0 === false);
  // k where ph=1 (V owns): step returns true, V's field loaded into the buffer, W stashed
  const r1 = mux.step(1, sb.slots, 'homeAtt');   // k=1 → ph = 1%2 = 1 (V)
  chk('mux step at a V-owned k returns true (V advanced)', r1 === true);
  chk('mux loaded() reports V (the non-home owner) after a V step', mux.loaded() === 1);
  chk('mux stashed W-live into W.field before loading V', sb.byName('W').field === 'W-live');
  // returning to a home-owned k parks V back and restores W
  const r2 = mux.step(2, sb.slots, 'homeAtt');   // k=2 → ph = 0 (W) → parks V
  chk('mux step back to home parks V (loaded → 0)', r2 === false && mux.loaded() === 0);
  chk('mux muxStepped tallied V (proper-time render gate)', engine.muxStepped[1] >= 1);
  // single-slot (nSl<2) → mux inactive
  sb.byName('V').born = false;
  chk('mux inactive when <2 born slots (step returns false)', mux.step(3, sb.slots, 'homeAtt') === false);
}

// ── DESCRIPTOR-TIER DETERMINISM: the ℂ* payoff — regH matches by construction, field ULP forks are OUT of contract ──
{
  const hashNums = (nums) => { let h = 0x811c9dc5; for (const v of nums) { const q = Math.round((Number.isFinite(v) ? v : 0) * 1e6) | 0;
    h ^= (q & 0xff); h = (h * 0x01000193) >>> 0; h ^= ((q >> 8) & 0xff); h = (h * 0x01000193) >>> 0; h ^= ((q >> 16) & 0xff); h = (h * 0x01000193) >>> 0; h ^= ((q >> 24) & 0xff); h = (h * 0x01000193) >>> 0; }
    return (h >>> 0).toString(16).padStart(8, '0'); };
  const opNums = (op) => [op.phase, op.gain ?? 1, op.beta, op.omega, op.prec, op.kx, op.ky, op.tx, op.ty, ...(op.A || [1, 0, 0, 1])];
  const regH = (bank, steps) => hashNums([steps, ...bank.ops.flatMap(opNums)]);
  // two peers apply the SAME exact-arithmetic descriptor evolution (W ages 8 beats, V recorded, refAmp)
  const run = () => { const B = makeObserverBank(4); let steps = 0; B.ops[0].phase = 0.24; B.ops[0].omega = 0.1;
    for (let b = 0; b < 8; b++) { B.ops[0].phase = (B.ops[0].phase + B.ops[0].omega) % (2 * Math.PI); steps += 21; }
    B.ops[1].phase = 0.5; B.ops[1].beta = 1.3; return regH(B, steps); };
  chk('DESCRIPTOR-TIER: two peers with identical descriptor evolution → identical regH (deterministic by construction)', run() === run());
  // field ULP diff forks a field hash (what the original fought) — regH doesn't hash fields, so it's immune
  const fH = (arr) => { const f = new Float32Array(arr), b = new Uint8Array(f.buffer); let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = (h * 0x01000193) >>> 0; } return (h >>> 0).toString(16); };
  chk('a 1-ULP field diff FORKS a field hash (the hard tier the original fought)', fH([0.3000001, 0.5]) !== fH([0.3000002, 0.5]));
  chk('regH is a pure fn of descriptor scalars — same ops+steps always same hash (idempotent)', regH(makeObserverBank(4), 42) === regH(makeObserverBank(4), 42));
}

console.log(ok ? '\nALL PASS (medium-u1 slots: leash + unification + facade + mux + descriptor-tier determinism)' : '\nFAILURES ABOVE');
process.exit(ok ? 0 : 1);
