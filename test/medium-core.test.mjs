// medium-core.test.mjs — extraction stage A: the observer bank (doc/proper-time-metric.md §12).
// Run: node test/medium-core.test.mjs. The bank must be a faithful re-housing of medium.js's
// descriptor store: stable ops reference, identity reset, lossless snapshot round-trip, exact
// legacy-key mapping, and sanitization that degrades to identity components (never NaN).
import { secondMomentTorus, virialSpec, regionStepX, leapfrogStepX, coverStep, capReduce, coverResidual, spectralShift, crossCorrScan, makeObserverBank, normalizeVirtEvent, applySettingsVerb, applyVirtVerb, makeStepClock, makeCouplingStore, kuramotoStep, makeRegisterReadout, regHash, muxClocks, makeRippleClock, makeIFSClock, makeSelfHost, makeStampedInput, hashField, hashNums, opNums, ampCorr, phaseCorr, syncClockRate, kernelSymbol, kernelABCD, packetD, qSpmRate, qStep, qFixedPoint, fft2d, kernelPropagateSpectral, kernelLambdaGrid, secondMoment, virialRateX, slCasimir, tierSymbolSum, tierLambdaGrid, makeRegisterEngine } from '../public/medium-core.js';
import { lensU1 as L } from '../public/soliton-algebra.js';

let ok = true; const chk = (n, c) => { if (!c) { ok = false; console.log(`FAIL ${n}`); } else console.log(`  ok  ${n}`); };
const near = (a, b, t = 1e-12) => Math.abs(a - b) < t;

{
  const B = makeObserverBank(4);
  chk('bank starts as four identity descriptors', B.ops.length === 4 && B.ops.every((o) => o.mode === 'id' && o.phase === 0 && o.beta === 1 && o.omega === 0 && o.prec === 0));
  const ref = B.ops;
  B.ops[0].phase = 1.04; B.ops[1].prec = 0.8; B.ops[2].beta = 0.67; B.ops[3].omega = 0.1; B.ops[1].kx = 0.2; B.ops[1].A = [0, -1, 1, 0];
  const snap = B.save();
  chk('save is a deep copy (mutating the bank does not touch the snapshot)', (B.ops[0].phase = 9, snap[0].phase === 1.04 && (B.ops[0].phase = 1.04, true)));
  chk('save copies the affine A by value', snap[1].A !== B.ops[1].A && JSON.stringify(snap[1].A) === '[0,-1,1,0]');
  B.reset();
  chk('reset → identity everywhere (the re-anchor law)', B.ops.every((o) => o.phase === 0 && o.beta === 1 && o.omega === 0 && o.prec === 0 && o.kx === 0 && JSON.stringify(o.A) === '[1,0,0,1]'));
  chk('restore round-trips the snapshot', B.restore(snap) === true && near(B.ops[0].phase, 1.04) && near(B.ops[1].prec, 0.8) && near(B.ops[2].beta, 0.67) && near(B.ops[3].omega, 0.1) && near(B.ops[1].kx, 0.2) && JSON.stringify(B.ops[1].A) === '[0,-1,1,0]');
  chk('ops reference is STABLE across reset/restore (call sites hold the array)', B.ops === ref);
}

{
  const B = makeObserverBank(4);
  chk('restore refuses a non-snapshot (caller falls back to legacy)', B.restore(null) === false && B.restore([{}, {}]) === false && B.restore('x') === false);
  B.ops[2].phase = 7;                                                  // stale local state a joiner might hold
  B.restoreLegacy({ attPhase: 2.184, lensTau: 0.1, aphEng: { V: 0.3, P1: -0.2 }, refAmp: [1, 0.67, 1, 2] });
  chk('legacy mapping: attPhase→[0].phase, ω→all four, aphEng→[1..3].phase, refAmp→beta', near(B.ops[0].phase, 2.184) && B.ops.every((o) => near(o.omega, 0.1))
    && near(B.ops[1].phase, 0.3) && near(B.ops[2].phase, -0.2) && near(B.ops[3].phase, 0) && near(B.ops[1].beta, 0.67) && near(B.ops[3].beta, 2));
  chk('legacy restore resets first (stale state gone, prec/kx/A identity)', B.ops[2].prec === 0 && B.ops[2].kx === 0 && JSON.stringify(B.ops[2].A) === '[1,0,0,1]');
  B.restoreLegacy({});
  chk('legacy restore with NO keys = full identity (old minimal snapshots)', B.ops.every((o) => o.phase === 0 && o.beta === 1 && o.omega === 0));
}

{
  const B = makeObserverBank(4);
  B.restore([{ phase: NaN, beta: 'x', A: [1, 2, 3], kx: Infinity }, null, { mode: 'gauge', phase: 0.5, A: [0, -1, 1, 0], kx: 0.2 }, {}]);
  chk('sanitize: malformed fields degrade to identity components, never NaN', B.ops[0].phase === 0 && B.ops[0].beta === 1 && JSON.stringify(B.ops[0].A) === '[1,0,0,1]' && B.ops[0].kx === 0 && B.ops[1].phase === 0);
  chk('sanitize: well-formed extended fields survive (metric/gauge ready)', B.ops[2].mode === 'gauge' && near(B.ops[2].kx, 0.2) && JSON.stringify(B.ops[2].A) === '[0,-1,1,0]');
  chk('bank descriptors are valid lensU1 elements (compose accepts them)', L.compose(B.ops[2], B.ops[0]) !== null);
}

// ── stage B2: the verb wire schema (the pull's single source of truth) ──────────────────────────────────────
{
  const q = normalizeVirtEvent({ time: 42.5, seq: 7, mode: 'edge', leak: -0.15, gx: 0, gy: 1, junk: 'x' });
  chk('wire: base fields map (time→t) with exact defaults', q.t === 42.5 && q.seq === 7 && q.mode === 'edge' && q.leak === -0.15 && q.gy === 1 && q.amp === 0 && q.src === 'V');
  chk('wire: unknown junk does NOT ride the queue (schema discipline)', !('junk' in q));
  const l = normalizeVirtEvent({ time: 1, seq: 8, mode: 'lensset', src: 'V', kx: 0.2, ky: -0.1, rot: 0.3, scl: 2, tx: 3, ty: -4 });
  chk('wire: lensset extended fields SURVIVE the pull (the live-caught strip, fixed)', l.kx === 0.2 && l.ky === -0.1 && l.rot === 0.3 && l.scl === 2 && l.tx === 3 && l.ty === -4);
  chk('wire: lensset fields absent for other modes (no schema bleed)', !('rot' in normalizeVirtEvent({ time: 1, seq: 9, mode: 'aphase', amp: 0.5 })));
  chk('wire: empty event degrades to identity record (never NaN)', (() => { const e = normalizeVirtEvent({}); return e.mode === 'record' && e.t === 0 && e.amp === 0; })());
}

// ── stage B2: the settings-sector verb table ────────────────────────────────────────────────────────────────
{
  const B = makeObserverBank(4), dials = { viaPhi: 0.5, lensView: false };
  chk('settings: lensset writes the descriptor (A from rot/scl, mode inferred)', applySettingsVerb({ mode: 'lensset', src: 'V', kx: 0, ky: 0, rot: 0.3, scl: 1, tx: 0, ty: 0 }, 10, B.ops, dials) === true
    && B.ops[1].mode === 'metric' && near(B.ops[1].A[0], Math.cos(0.3)) && near(B.ops[1].A[1], -Math.sin(0.3)));
  chk('settings: lensset with no spatial parts reverts to the U(1) sector', (applySettingsVerb({ mode: 'lensset', src: 'V', kx: 0, ky: 0, rot: 0, scl: 1, tx: 0, ty: 0 }, 11, B.ops, dials), B.ops[1].mode === 'id' && JSON.stringify(B.ops[1].A) === '[1,0,0,1]'));
  chk('settings: lenstau sets ω on ALL descriptors (the global dial)', (applySettingsVerb({ mode: 'lenstau', amp: 0.1 }, 12, B.ops, dials), B.ops.every((o) => o.omega === 0.1)));
  chk('settings: refamp writes one slot\'s β', (applySettingsVerb({ mode: 'refamp', src: 'P1', amp: 0.67 }, 13, B.ops, dials), B.ops[2].beta === 0.67 && B.ops[1].beta === 1));
  chk('settings: viaphi + lensview write the dials', (applySettingsVerb({ mode: 'viaphi', amp: 1.2 }, 14, B.ops, dials), applySettingsVerb({ mode: 'lensview' }, 15, B.ops, dials), near(dials.viaPhi, 1.2) && dials.lensView === true));
  chk('settings: lensview toggles (not sets)', (applySettingsVerb({ mode: 'lensview' }, 16, B.ops, dials), dials.lensView === false));
  const before = JSON.stringify(B.ops);
  chk('settings: optics modes REFUSED (false, bank untouched) — the boundary', ['record', 'store', 'recall', 'aphase', 'edge', 'go', 'boot'].every((m) => applySettingsVerb({ mode: m }, 17, B.ops, dials) === false) && JSON.stringify(B.ops) === before);
}

// ── stage C1: the step clock — the §7.44 target law + the reanchor continuity law ───────────────────────────
{
  const C = makeStepClock({ stepsPerPhase: 19 });
  C.c0 = 2; C.rate = 1;
  chk('clock: target = floor((mon−c0)·spp/rate)', C.target(4.5) === Math.floor(2.5 * 19));
  C.rate = C.ratePrev = 3;
  chk('clock: mux divides the step budget (rate 3 → 1/3 demand)', C.target(4.5) === Math.floor(2.5 * 19 / 3));
  const c0b = C.c0;
  chk('clock: reanchor is a no-op at the same rate (false, c0 untouched)', C.reanchor(100, 3) === false && C.c0 === c0b);
  // BIT-EXACT equivalence with the legacy inline formulas over a random flip sequence (the authority-switch proof)
  let rnd = 424242; const R = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  const K = makeStepClock({ stepsPerPhase: 19 });
  let c0 = K.c0 = R() * 100; let rate = 1, ratePrev = 1; K.rate = K.ratePrev = 1;
  let exact = true;
  for (let t = 0; t < 500; t++) {
    const mon = c0 + R() * 80;
    const legacyTarget = Math.floor((mon - c0) * 19 / rate);
    if (K.target(mon) !== legacyTarget) { exact = false; break; }
    const r = 1 + Math.floor(R() * 4), k = Math.max(0, legacyTarget);
    if (r !== ratePrev) { c0 = c0 + (k * (ratePrev - r)) / 19; ratePrev = r; rate = r; }   // the legacy inline reanchor, verbatim
    K.reanchor(k, r);
    if (K.c0 !== c0 || K.rate !== rate || K.ratePrev !== ratePrev) { exact = false; break; }
  }
  chk('clock: BIT-EXACT vs the legacy inline formulas over 500 random flips (same float-op order)', exact);
  // the continuity law: at the flip step k, target(mon_k) is invariant for rate INCREASES (exact) and bounded for decreases
  let worstUp = 0, worstDown = 0;
  for (let t = 0; t < 300; t++) {
    const C2 = makeStepClock({ stepsPerPhase: 19 });
    const r1 = 1 + Math.floor(R() * 4); C2.c0 = R() * 100; C2.rate = C2.ratePrev = r1;
    const mon = C2.c0 + R() * 60 + 0.5, k = C2.target(mon);
    const r2 = 1 + Math.floor(R() * 4); if (r2 === r1) continue;
    C2.reanchor(k, r2);
    const d = C2.target(mon) - k;
    if (r2 > r1) worstUp = Math.max(worstUp, Math.abs(d)); else worstDown = Math.max(worstDown, Math.abs(d));
    if (d < 0) { worstUp = worstDown = 1e9; break; }                   // target must NEVER go backward at a flip
  }
  chk(`clock: reanchor continuity — rate↑ exact (worst ${worstUp}), rate↓ bounded < r1/r2, never backward (worst ${worstDown})`, worstUp === 0 && worstDown < 4);
}

// ── stage C3: the V-sector verb table behind the stores contract (GPU-free branches smoke-tested) ───────────
{
  const B = makeObserverBank(4); B.ops[2].phase = 0.7; B.ops[2].prec = 0.2;
  let tauResets = 0;
  const V = { virtMirror: false, virtHold: false, virtMux: false, virtLeak: 0, virtHolo: null, psiVirt: null,
    virtBank: [], phases: [{ psi: new Float64Array(2), att: null }], selfClk: null, earVOn: false, earV: null, kvSteps: 0 };
  const S = { V, ops: B.ops, dials: { viaPhi: 0.5, lensView: false }, tauK: null, gpu: null,
    VIRT_T: 8, DT: 0.01, PHASE_MAX: 2, BANK_MAX: 4, torbE0: 1,
    attF32: (f) => f, aphNorm: (x) => x, ampCorr: () => 1, lockSweep: () => ({ scores: [], best: 0 }),
    goCarrier: () => ({ att: null }), vLeashReset: () => {}, tauReset: () => { tauResets++; }, earVInit: () => {} };
  chk('C3: residue modes REFUSED (tex/cseed/edge stay medium-side)', ['tex', 'cseed', 'edge'].every((m) => applyVirtVerb({ mode: m }, 1, S, {}) === false));
  chk('C3: mirror toggles V state through the contract', applyVirtVerb({ mode: 'mirror' }, 2, S, {}) === true && V.virtMirror === true);
  chk('C3: hold + mux + leak write V state', (applyVirtVerb({ mode: 'hold' }, 3, S, {}), applyVirtVerb({ mode: 'mux' }, 4, S, {}), applyVirtVerb({ mode: 'leak', leak: 0.05 }, 5, S, {}),
    V.virtHold === true && V.virtMux === true && V.virtLeak === 0.05));
  chk('C3: kill pops the phase AND clears its ledger slot (index math intact)', applyVirtVerb({ mode: 'kill' }, 6, S, {}) === true && V.phases.length === 0 && B.ops[2].phase === 0 && B.ops[2].prec === 0);
  chk('C3: selfclock toggle creates the beat state + resets τ', applyVirtVerb({ mode: 'selfclock' }, 7, S, {}) === true && !!V.selfClk && V.selfClk.lastK === 7 && tauResets === 1);
  chk('C3: selfclock toggle OFF clears it (no second τ reset)', applyVirtVerb({ mode: 'selfclock' }, 8, S, {}) === true && V.selfClk === null && tauResets === 1);
  chk('C3: relift without a plate is a handled no-op', applyVirtVerb({ mode: 'relift' }, 9, S, {}) === true && V.psiVirt === null);
}

// ── stage C4: the mux two-clock law + the coupling store's capture law ──────────────────────────────────────
{
  chk('clocks: ph rotates every step (fine buffer ownership)', [0, 1, 2, 3, 4, 5].every((k) => muxClocks(k, 3).ph === k % 3));
  chk('clocks: capPh rides the BEAT slot under selfClock', muxClocks(1000, 3, 7).capPh === 7 % 3 && muxClocks(1001, 3, 8).capPh === 8 % 3);
  chk('clocks: capPh is the ⌊k/21⌋ slice off selfClock (beat count null)', muxClocks(41, 2).capPh === Math.floor(41 / 21) % 2 && muxClocks(42, 2).capPh === 0);
  const K = makeCouplingStore();
  chk('coupling: no edges → never capture', K.shouldCapture(1) === false);
  chk('coupling: self-edge refused', K.setEdge(2, 2, -0.15) === false && K.edge === null);
  chk('coupling: setEdge is symmetric + lazy-creates the matrix + invalidates the cursor', K.setEdge(0, 1, -0.15) === true && K.edge[0][1] === -0.15 && K.edge[1][0] === -0.15 && K.capPh === -1);
  chk('coupling: capture gated PURELY on the coarse-clock change', K.shouldCapture(1) === true && (K.capture([new Float64Array([1, 2])], 100, 1), K.shouldCapture(1) === false && K.shouldCapture(2) === true));
  const f = new Float64Array([3, 4]);
  K.capture([null, f], 200, 2);
  chk('coupling: capture freezes COPIES and leaves untouched indices alone (legacy tail semantics)', K.src[1] !== f && K.src[1][0] === 3 && K.src[0] === null && K.capStep === 200 && K.capPh === 2);
  f[0] = 99;
  chk('coupling: frozen source is immune to later field mutation', K.src[1][0] === 3);
  chk('coupling: zeroing the last edge collapses the matrix to null (+ cursor invalidated)', (K.setEdge(0, 1, 0), K.edge === null && K.capPh === -1));
  chk('coupling: reset clears everything', (K.setEdge(0, 2, 0.1), K.capture([new Float64Array(2)], 1, 0), K.reset(), K.edge === null && K.capPh === -1 && K.src.every((s) => s === null)));
}

// ── the KURAMOTO / XY PHASE LAW (kuramotoStep) — extracted from medium-u1's register XY machine ──
{
  // no edge → zero increments, any=false (the no-op guarantee)
  const r0 = kuramotoStep([0, 1, 2, 3], null);
  chk('kuramoto: no edge → all dθ=0, any=false', r0.dth.every((d) => d === 0) && r0.any === false);

  // two aligned-coupled slots: κ>0 pulls them TOGETHER (dθ_i has the sign that reduces |θ_j−θ_i|)
  const edge2 = [[0, 0.5, 0, 0], [0.5, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const r1 = kuramotoStep([0, 1, 0, 0], edge2);
  chk('kuramoto: κ>0 aligns — slot 0 nudged toward slot 1 (+) and slot 1 toward slot 0 (−)', r1.dth[0] > 0 && r1.dth[1] < 0 && near(r1.dth[0], 0.5 * Math.sin(1), 1e-12) && r1.any);
  // anti-align: κ<0 pushes them APART
  const r1n = kuramotoStep([0, 0.2, 0, 0], [[0, -0.5, 0, 0], [-0.5, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  chk('kuramoto: κ<0 anti-aligns — the increment has the opposite sign', r1n.dth[0] < 0 && r1n.dth[1] > 0);

  // gain multiplier (medium-u1's turbo κ×3 = the Q-rate Euler equivalent)
  const rg = kuramotoStep([0, 1, 0, 0], edge2, { gain: 3 });
  chk('kuramoto: gain scales every increment (turbo κ×3)', near(rg.dth[0], 3 * 0.5 * Math.sin(1), 1e-12));

  // self-coupling on the diagonal is ignored (a slot never couples to itself)
  const rs = kuramotoStep([0.5, 0, 0, 0], [[9, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  chk('kuramoto: diagonal (self) κ ignored → dθ=0', rs.dth[0] === 0 && rs.any === false);

  // born-gating: index 0 is ALWAYS live; an unborn slot participates as NEITHER source nor sink
  const edgeB = [[0, 0.5, 0.5, 0], [0.5, 0, 0, 0], [0.5, 0, 0, 0], [0, 0, 0, 0]];
  const rb = kuramotoStep([0, 1, 1, 0], edgeB, { born: [true, true, false, false] });   // slot 2 unborn
  chk('kuramoto: unborn slot is skipped as SINK (its dθ stays 0)', rb.dth[2] === 0);
  chk('kuramoto: unborn slot is skipped as SOURCE (slot 0 only feels slot 1, not 2)', near(rb.dth[0], 0.5 * Math.sin(1), 1e-12));
  chk('kuramoto: index 0 is always live even if born[0] is false', kuramotoStep([0, 1, 0, 0], edge2, { born: [false, true, false, false] }).dth[0] !== 0);

  // THE K₃ FRUSTRATION (the [KUR] headline): three all-negative edges → the ±2π/3 splay is a FIXED POINT (dθ≈0)
  const kf = -0.2, edgeK3 = [[0, kf, kf, 0], [kf, 0, kf, 0], [kf, kf, 0, 0], [0, 0, 0, 0]];
  const splay = [0, 2 * Math.PI / 3, 4 * Math.PI / 3, 0];
  const rk3 = kuramotoStep(splay, edgeK3, { born: [true, true, true, false] });
  chk('kuramoto: the K₃ ±2π/3 splay is a FIXED POINT (frustrated equilibrium — dθ≈0)', rk3.dth.slice(0, 3).every((d) => Math.abs(d) < 1e-12));
}

// ── the ATTRACTOR FIELD-MIXING gate (coupledAtt + ctx.fieldMix) — the edge's SECOND coupling layer, toggleable ──
{
  const G = 8, N = G * G;
  const mk = (v) => { const f = new Float64Array(N * 2); for (let i = 0; i < N * 2; i += 2) f[i] = v; return f; };
  const edge = [[0, 0.5, 0, 0], [0.5, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];   // slot 0 ⇄ slot 1, κ=0.5
  const slots = [{ desc: true, descBase: mk(2), descLive: true }, { desc: true, descBase: mk(3), descLive: true }, { desc: false }, { desc: false }];
  let fieldMix = true;
  const reg = makeRegisterEngine({ GRID: G, DT: 0.12, N_CELLS: N, gamma: 20, isat: 1,
    ringCache: () => null, kernelVer: () => 0, lensOp: () => ({}), slots: () => slots, edge: () => edge,
    linearMode: () => 0, linLeak: () => 0, shardRing: () => null, wSlot: () => slots[0], fieldMix: () => fieldMix });
  const base = mk(1);
  fieldMix = true;  const on = reg.coupledAtt(0, base, null);   // 1 + 0.5·3 = 2.5 (slot 0's att bleeds toward slot 1's field)
  chk('coupledAtt: fieldMix ON → the att mixes in the coupled neighbor (1 + κ·field = 2.5)', near(on[0], 2.5, 1e-12));
  fieldMix = false; const off = reg.coupledAtt(0, base, null);   // bare att — the edge still couples PHASE (kuramoto), just not the shape
  chk('coupledAtt: fieldMix OFF → bare att returned even WITH a live edge (edge couples phase only, shapes pure)', off === base && off[0] === 1);
  // no edge → bare att regardless of the gate (the no-op guarantee is unchanged)
  const noEdge = makeRegisterEngine({ GRID: G, DT: 0.12, N_CELLS: N, gamma: 20, isat: 1,
    ringCache: () => null, kernelVer: () => 0, lensOp: () => ({}), slots: () => slots, edge: () => null,
    linearMode: () => 0, linLeak: () => 0, shardRing: () => null, wSlot: () => slots[0], fieldMix: () => true });
  chk('coupledAtt: no edge → bare att (unchanged no-op, gate irrelevant)', noEdge.coupledAtt(0, base, null) === base);
}

// ── the REGISTER READOUT (makeRegisterReadout) — the shared regPhase telemetry shape ──
{
  const fakeTau = { beatsOf: (nm) => ({ W: 7, V: 3 }[nm] ?? 0), tauOf: (nm) => ({ W: 7.25, V: 3.1 }[nm] ?? 0), hash: () => 'deadbeef' };
  const regs = [{ ...L.id(), phase: 0.5, omega: 0.1, beta: 1.2 }, { ...L.id(), phase: 1.3 }, L.id(), L.id()];
  const born = [true, true, false, false];
  const rout = makeRegisterReadout({ tauK: fakeTau, names: ['W', 'V', 'P1', 'P2'], op: (i) => regs[i], born: (i) => born[i], step: () => 42 });
  const p = rout.phase({ wH: 'abc12345' });
  chk('readout: FULL register introspection — step/kH + universal per-slot ∠/ω/β/beats/τ + born + the app extra',
    p.step === 42 && p.kH === 'deadbeef' && p.wH === 'abc12345'
    && p.angle[0] === 0.5 && p.omega[0] === 0.1 && p.beta[0] === 1.2 && p.beats[0] === 7 && p.tau[0] === 7.25
    && JSON.stringify(p.born) === JSON.stringify(['W', 'V']));
  chk('readout: slots() is the rich per-slot register table', (() => { const s = rout.slots(); return s.length === 4 && s[0].name === 'W' && s[0].angle === 0.5 && s[0].omega === 0.1 && s[0].beta === 1.2 && s[0].born === true && s[2].born === false; })());
  chk('readout: no op/born getters → angle 0, all born (a phase-only app with no register still works)', (() => { const r = makeRegisterReadout({ tauK: null, names: ['W'], step: 1 }).phase(); return r.angle[0] === 0 && r.beta[0] === 1 && r.beats[0] === 0 && r.kH === null && JSON.stringify(r.born) === JSON.stringify(['W']); })());
}

// ── the REGISTER DETERMINISM HASH (regHash) — BYTE-IDENTICAL to medium-u1's inline _regH (the contract shape) ──
{
  const mkSlot = (name, born, go, gx, gy, desc, descBar) => ({ name, born, desc, descBar, leash: { state: { go, gx, gy } } });
  const ops = [{ ...L.id(), phase: 0.3, beta: 1.2 }, { ...L.id(), phase: 1.1 }, L.id(), L.id()];
  const slots = [mkSlot('W', true, true, 3.14, 2.7, false, 0), mkSlot('V', true, false, 0, 0, true, 5), mkSlot('P1', false, false, 0, 0, false, 0), mkSlot('P2', false, false, 0, 0, false, 0)];
  const edge = [[0, -0.2, 0, 0], [-0.2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const plates = [{ dop: { ...L.id(), phase: 0.5 }, bw: 3 }, { dop: { ...L.id(), phase: 1.9 }, bw: 7 }];
  const beatsOf = (nm) => ({ W: 12, V: 4 }[nm]);   // undefined for unborn (the real kwe-tau behavior)
  // reproduce the OLD inline _regH sequence VERBATIM (the contract these bytes must never silently change)
  const old = hashNums([1234, 1, ...ops.flatMap(opNums),
    ...slots.flatMap((s) => [s.born ? 1 : 0, beatsOf(s.name) ?? 0, s.leash.state.go ? 1 : 0, Math.round(s.leash.state.gx * 100), Math.round(s.leash.state.gy * 100), s.desc ? 1 : 0, s.descBar | 0]),
    ...edge.flat(), plates.length, ...plates.flatMap((pl) => [...opNums(pl.dop), pl.bw | 0])]);
  chk('regHash: BYTE-IDENTICAL to the inline _regH sequence (the contract shape, load-bearing order)', regHash({ step: 1234, rate: 1, ops, slots, edge, plates, beatsOf }) === old);
  // null edge → the fixed 16-zero slot; empty plates → just the length
  const oldNull = hashNums([1234, 1, ...ops.flatMap(opNums), ...slots.flatMap((s) => [s.born ? 1 : 0, beatsOf(s.name) ?? 0, s.leash.state.go ? 1 : 0, Math.round(s.leash.state.gx * 100), Math.round(s.leash.state.gy * 100), s.desc ? 1 : 0, s.descBar | 0]), ...new Array(16).fill(0), 0]);
  chk('regHash: null edge + empty plates matches the inline fallback exactly', regHash({ step: 1234, rate: 1, ops, slots, edge: null, plates: [], beatsOf }) === oldNull);
  chk('regHash: a 1-ULP descriptor change FORKS the hash (the contract is sensitive)', regHash({ step: 1234, rate: 1, ops: [{ ...ops[0], phase: 0.3 + 1e-5 }, ops[1], ops[2], ops[3]], slots, edge, plates, beatsOf }) !== old);
}


// ── stage: the BEAT-SOURCE PROVIDERS (makeRippleClock / makeIFSClock / makeSelfHost) ────────────────────────
{
  // ripple clock: an oscillating ℓ produces beats; a flat ℓ does not; refractory respected; snapshot round-trips
  const rc = makeRippleClock({ refractory: 8 });
  let beats = 0, last = -100; for (let k = 0; k < 300; k++) { if (rc.feed(0.5 + 0.4 * Math.sin(k * 0.25), k)) { chk('ripple: refractory ≥ 8 between beats', k - last >= 8); last = k; beats++; } }
  chk(`ripple clock ticks on an oscillating lock (${beats} beats)`, beats > 5);
  const flat = makeRippleClock(); let fb = 0; for (let k = 0; k < 200; k++) if (flat.feed(0.7, k)) fb++;
  chk('ripple clock is SILENT on a flat lock (no ripple → no beat)', fb === 0);
  const snap = rc.save(), rc2 = makeRippleClock(); rc2.restore(snap);
  chk('ripple clock snapshot round-trips (same detector state)', JSON.stringify(rc2.save()) === JSON.stringify(snap));

  // IFS clock: alive + deterministic + the CONTRACTION law (higher ρ → more cascade activity, ring set bounded)
  const mkIFS = (rho) => { const c = makeIFSClock({ rho, seed: 3 }); c.launch(0); let b = 0; for (let k = 1; k < 1500; k++) if (c.advance(k).beat) b++; return { beats: b, rings: c.kernel().length, cyc: c.save().cyc }; };
  const a = mkIFS(0.68), b = mkIFS(0.68);
  chk('IFS clock is a LIVING clock (beats + a bounded ring genome)', a.beats > 50 && a.rings > 2 && a.rings < 20);
  chk('IFS clock is deterministic (two runs byte-identical)', JSON.stringify(a) === JSON.stringify(b));
  chk('IFS clock stays BOUNDED across the contraction range (ρ 0.5..0.9 all give a finite ring set)', [0.5, 0.7, 0.9].every((r) => { const x = mkIFS(r); return x.rings > 0 && x.rings < 25; }));
  const ifs = makeIFSClock({ seed: 5 }); ifs.launch(0); for (let k = 1; k < 400; k++) ifs.advance(k);
  const isnap = ifs.save(), ifs2 = makeIFSClock({ seed: 5 }); ifs2.restore(isnap);
  let same = true; for (let k = 400; k < 800; k++) { if (JSON.stringify(ifs.advance(k)) !== JSON.stringify(ifs2.advance(k))) { same = false; break; } }
  chk('IFS clock snapshot → a restored clock evolves identically', same);

  // selfhost: pinned = gain≡1 (compact); unpinned+cap = bounded; unpinned+cap0 = runaway (the three regimes)
  const runSH = (unpinned, cap) => { const sh = makeSelfHost({ unpinned, cap }); let beats = 0, mg = 1; for (let k = 0; k < 2000; k++) { const r = sh.step(k); if (r.beat) beats++; mg = Math.max(mg, r.O.gain); } return { beats, maxG: mg }; };
  chk('selfhost PINNED: a living clock with gain≡1 (compact, runaway-proof)', (() => { const r = runSH(false, 8); return r.beats > 20 && r.maxG === 1; })());
  chk('selfhost UNPINNED+cap: bounded amplitude (the energy law tames ℂ*)', (() => { const r = runSH(true, 8); return r.beats > 20 && r.maxG > 1 && r.maxG < 30; })());
  chk('selfhost UNPINNED+cap0: RUNAWAY (uncapped ℂ* diverges)', runSH(true, 0).maxG > 1000);
  const shd1 = runSH(true, 8), shd2 = runSH(true, 8);
  chk('selfhost deterministic (two runs identical)', JSON.stringify(shd1) === JSON.stringify(shd2));
  const sh = makeSelfHost({ unpinned: true, cap: 8 }); for (let k = 0; k < 500; k++) sh.step(k);
  const ssnap = sh.save(), sh2 = makeSelfHost(); sh2.restore(ssnap);
  let smatch = true; for (let k = 500; k < 900; k++) { if (JSON.stringify(sh.step(k)) !== JSON.stringify(sh2.step(k))) { smatch = false; break; } }
  chk('selfhost snapshot → a restored unit evolves identically', smatch);
  const shp = makeSelfHost({ unpinned: true }); for (let k = 0; k < 300; k++) shp.step(k); shp.set('unpinned', false);
  chk('selfhost repin projects gain → 1 (back to the U(1) slice)', shp.step(301).O.gain === 1);
}

// ── makeStampedInput — the stamped replicated-input pattern (pull/cursor/drain/join over a tauK queue) ──────────────
{
  // minimal tauK stub: makeQueue with the same push(stamp via t)/drain(k)/save-restore shape kwe-tau provides.
  const mkTauK = (c0 = 0, rate = 1, spp = 19) => { const recs = new Map();
    const stamp = (t) => Math.floor(((t ?? 0) - c0) * spp / rate);
    return { makeQueue: (name) => { let q = recs.get(name); if (!q) { q = []; recs.set(name, q); }
      return { push: (e) => { e.startStep = stamp(e.t); q.push(e); q.sort((a, b) => a.startStep - b.startStep); return e.startStep; },
        drain: (k, apply) => { let n = 0; while (q.length && k >= q[0].startStep) { apply(q.shift()); n++; } return n; },
        get length() { return q.length; } }; } }; };

  const tauK = mkTauK(0, 1, 19);
  const si = makeStampedInput(tauK, 'shift');
  const applied = [];
  // PULL: a replicated log of 3 shift intermediates (seq 1,2,3 at times 1,2,3 → stamped 19,38,57)
  const log = [{ seq: 1, time: 1, toX: 5 }, { seq: 2, time: 2, toX: 6 }, { seq: 3, time: 3, toX: 7 }];
  const n1 = si.pull(log, (e) => ({ toX: e.toX }));
  chk('stampedInput.pull returns the count of NEW entries staged', n1 === 3);
  chk('stampedInput.pull advances the seq cursor', si.seen === 3);
  chk('stampedInput.pull carries t from the entry time (for the kernel to stamp)', si.length === 3);
  // RE-PULL the same log → cursor guards against double-staging (the "monotonic seq, truncated log" case)
  const n2 = si.pull(log, (e) => ({ toX: e.toX }));
  chk('stampedInput.pull re-read stages NOTHING (cursor guards double-push)', n2 === 0 && si.length === 3);

  // DRAIN at shared steps: nothing before 19, then each at its stamped step
  si.drain(10, (e) => applied.push(['@10', e.toX]));
  chk('stampedInput.drain fires nothing before the first startStep', applied.length === 0);
  si.drain(19, (e) => applied.push([19, e.toX]));
  chk('stampedInput.drain fires the seq-1 entry at its stamped step 19', applied.length === 1 && applied[0][0] === 19 && applied[0][1] === 5);
  si.drain(60, (e) => applied.push([60, e.toX]));
  chk('stampedInput.drain fires all remaining due entries (steps 38,57 ≤ 60)', applied.length === 3 && applied[2][1] === 7);

  // JOIN CODEC: cursor is app-serialized; reattach re-makes the handle after a tauK.restore
  const si2 = makeStampedInput(tauK, 'shift');
  si2.restoreCursor(si.saveCursor());
  chk('stampedInput.saveCursor/restoreCursor round-trips the seq cursor', si2.seen === 3);
  si2.reattach();   // must not throw; re-makes the queue handle
  chk('stampedInput.reattach re-makes the handle (post-tauK.restore) without error', si2.length === 0);

  // null tauK (a peer without the kernel) → all ops are safe no-ops
  const si0 = makeStampedInput(null, 'x');
  chk('stampedInput with no tauK is a safe no-op (pull=0, drain=0, length=0)', si0.pull([{ seq: 1, time: 0 }], () => ({})) === 0 && si0.drain(99, () => {}) === 0 && si0.length === 0);
}

// ── determinism primitives: hashField / hashNums / opNums / ampCorr ─────────────────────────────────
{
  // hashField — deterministic, f32-view based, order-sensitive, '--------' on null
  const f1 = new Float64Array([0.5, -0.25, 1.0, 0.0]), f2 = Float64Array.from(f1);
  chk('hashField is deterministic for identical fields', hashField(f1) === hashField(f2));
  chk('hashField null → 8-dash sentinel', hashField(null) === '--------');
  const f3 = Float64Array.from(f1); f3[0] = 0.5000001;   // a sub-f32 tweak that survives f32 rounding
  chk('hashField distinguishes fields that differ above f32 precision', hashField(f1) !== hashField(f3));
  chk('hashField output is 8 hex chars', /^[0-9a-f]{8}$/.test(hashField(f1)));

  // hashNums — quantized (1e-6), so a sub-1e-6 diff collides; a >1e-6 diff forks; NaN→0
  chk('hashNums deterministic', hashNums([1, 2, 3.5]) === hashNums([1, 2, 3.5]));
  chk('hashNums quantizes at 1e-6 (sub-grid diff collides)', hashNums([1.0]) === hashNums([1.0000001]));
  chk('hashNums forks on a supra-1e-6 diff', hashNums([1.0]) !== hashNums([1.001]));
  chk('hashNums treats non-finite as 0 (NaN/∞ never poison the hash)', hashNums([NaN]) === hashNums([0]) && hashNums([Infinity]) === hashNums([0]));

  // opNums — the lensC1 element serialization: 13 scalars, gain defaults 1
  const op = L.id(); op.phase = 0.3; op.tx = 2;
  const nums = opNums(op);
  chk('opNums flattens an element to 13 scalars (9 + A[4])', nums.length === 13);
  chk('opNums defaults gain to 1 when absent', opNums({ phase: 0 })[1] === 1);
  chk('opNums round-trips through hashNums identically for equal ops', hashNums(opNums(op)) === hashNums(opNums({ ...op, A: [...op.A] })));

  // ampCorr — normalized overlap ∈ [0,1]; 1 for identical, phase-magnitude invariant, 0 on null/zero
  const a = new Float64Array([1, 0, 0, 1, 1, 0]);
  chk('ampCorr(a,a) = 1 (self-overlap normalized)', near(ampCorr(a, a), 1, 1e-9));
  const aRot = new Float64Array([0, 1, -1, 0, 0, 1]);   // a rotated by +90° (×i): |overlap| unchanged
  chk('ampCorr is U(1)-invariant (a global phase rotation → still 1)', near(ampCorr(a, aRot), 1, 1e-9));
  const b = new Float64Array([0, 1, 1, 0, 0, 0]);       // orthogonal-ish
  chk('ampCorr ∈ [0,1] and < 1 for a non-parallel field', ampCorr(a, b) >= 0 && ampCorr(a, b) < 1);
  chk('ampCorr null / zero-energy → 0 (no divide-by-zero)', ampCorr(null, a) === 0 && ampCorr(a, new Float64Array(6)) === 0);

  // phaseCorr — the ANGLE of the SAME overlap ampCorr magnitudes. THE FIELD-VS-EQUATION MEASUREMENT: rotate a field
  // by a known global phase θ and phaseCorr(orig, rotated) must recover θ (the aging the field ACTUALLY underwent).
  const rot = (f, th) => { const c = Math.cos(th), s = Math.sin(th), r = new Float64Array(f.length);
    for (let i = 0; i < f.length; i += 2) { r[i] = f[i] * c - f[i + 1] * s; r[i + 1] = f[i] * s + f[i + 1] * c; } return r; };
  chk('phaseCorr(a,a) = 0 (a field has no shift vs itself)', near(phaseCorr(a, a), 0, 1e-9));
  for (const th of [0.3, -0.7, 1.9, -2.8]) chk(`phaseCorr recovers a known global rotation θ=${th} (the measured aging)`, near(phaseCorr(a, rot(a, th)), th, 1e-9));
  chk('phaseCorr sign convention: arg⟨a,b⟩ is "b relative to a" (opposite sign for the reverse)', near(phaseCorr(a, rot(a, 0.5)), -phaseCorr(rot(a, 0.5), a), 1e-9));
  chk('phaseCorr null / zero-overlap → 0 (no meaningless angle)', phaseCorr(null, a) === 0 && phaseCorr(a, new Float64Array(6)) === 0);
  // THE DUAL-LAYER EQUIVALENCE, in the small: measured field shift ≡ the algebraic ω·Δτ prediction
  const omega = 0.11, dTau = 7, predicted = L.wrap(omega * dTau);   // (B) 6-float algebra
  const measured = L.wrap(phaseCorr(a, rot(a, predicted)));          // (A) 128KB-analog field measurement
  chk('field-vs-equation: measured phaseCorr ≡ ω·Δτ (the recall equivalence, exact in the linear case)', near(L.wrap(measured - predicted), 0, 1e-9));
}

// ── syncClockRate — mirror a stepClk rate flip onto the τ kernel (the backlog landmine) ──────────────
{
  const stepClk = makeStepClock({ stepsPerPhase: 19 });
  let tauRate = 1, tauReanchoredAt = null;
  const tauK = { reanchor: (k, r) => { tauRate = r; tauReanchoredAt = k; } };
  // no change → no-op (returns false, τ untouched)
  chk('syncClockRate no-op when rate unchanged (nSl stays 1)', syncClockRate(stepClk, tauK, 100, 1) === false && tauReanchoredAt === null);
  // nSl 1→2 → flip: stepClk rate becomes 2 AND tauK.reanchor called at the SAME k with the SAME rate
  const flipped = syncClockRate(stepClk, tauK, 200, 2);
  chk('syncClockRate returns true on a real flip', flipped === true);
  chk('syncClockRate mirrors the rate onto τ (same rate, same k)', tauRate === 2 && tauReanchoredAt === 200);
  chk('syncClockRate advanced stepClk to the new rate', stepClk.rate === 2);
  // null tauK → safe (still flips stepClk, no throw)
  const s2 = makeStepClock({ stepsPerPhase: 19 });
  chk('syncClockRate with no tauK is safe (flips stepClk only)', syncClockRate(s2, null, 0, 3) === true && s2.rate === 3);
}

{
  // ── kernelSymbol / kernelABCD — the IFS-native ABCD slice (gate A of the metaplectic arc) ──
  // exact full ring (float offsets — the math check; the GPU quantizes to ints, which only perturbs D slightly):
  // ⟨δδ^T⟩ over a circle of radius r = (r²/2)·I → D = (1 + w·r²)·I, dipole = 0, symbol(0) = 0 (conservation).
  const r = 6, n = 64, w = 0.5, ring = [];
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; ring.push(r * Math.cos(a), r * Math.sin(a)); }
  const fit = kernelABCD([r], [w], [ring], { dt: 0.05, T: 16 });
  chk('kernelABCD: full ring → isotropic D = (1 + w·r²)·I', near(fit.D[0], 1 + w * r * r, 1e-9) && near(fit.D[2], 1 + w * r * r, 1e-9) && near(fit.D[1], 0, 1e-9));
  chk('kernelABCD: full ring is centrosymmetric → dipole ≈ 0 (Hermitian)', fit.hermitian);
  chk('kernelSymbol: λ(0) = 0 exactly (conservation — the DC term vanishes)', near(kernelSymbol([r], [w], [ring], 0, 0).re, 0, 1e-12) && near(kernelSymbol([r], [w], [ring], 0, 0).im, 0, 1e-12));
  const kk = 0.01, exx = kernelSymbol([r], [w], [ring], kk, 0).re;
  chk('kernelSymbol: low-k symbol tracks the quadratic −Dxx·k²', near(exx, -fit.D[0] * kk * kk, 1e-5));
  chk('kernelABCD: kKnee = j₀,₁/r_max (the clock\'s own low-pass knee)', near(fit.kKnee, 2.404825557695773 / r, 1e-12));
  chk('kernelABCD: the ±T free block B = D·T·dt', near(fit.abcd.B[0], fit.D[0] * 16 * 0.05, 1e-12) && near(fit.abcd.B[3], fit.D[2] * 16 * 0.05, 1e-12));
  const [vgx, vgy] = fit.vg(0.3, 0);
  chk('kernelABCD: group velocity v_g = D·k·dt (the descK → drift prediction)', near(vgx, fit.D[0] * 0.3 * 0.05, 1e-12) && near(vgy, 0, 1e-12));
  // two-point "ring" along x → anisotropic D: Dxx = 1 + 2wr², Dyy = 1, principal axis θ = 0
  const fit2 = kernelABCD([r], [w], [[r, 0, -r, 0]], {});
  chk('kernelABCD: two-point x-pair → Dxx = 1 + 2wr², Dyy = 1 (anisotropy derived, axis θ=0)', near(fit2.D[0], 1 + 2 * w * r * r, 1e-9) && near(fit2.D[2], 1, 1e-9) && near(fit2.eig.theta, 0, 1e-9) && fit2.aniso > 1);
  // asymmetric kernel (a single offset) → non-zero dipole = the non-Hermitian check fires
  const fit3 = kernelABCD([r], [w], [[r, 0]], {});
  chk('kernelABCD: non-centrosymmetric kernel → dipole ≠ 0 (Hermiticity check catches it)', !fit3.hermitian && near(fit3.drift[0], 4 * w * r, 1e-9));
}

{
  // ── gate C: the q register (σ, b) — the engine recipe projected onto the Gaussian ansatz ──
  // SPM cubic limit (Isat → ∞): the quadrature must recover the CLOSED FORM ḃ_NL = −γP/(2πσ⁴).
  const sg = 10, P = 100, gam = 20;
  const cub = qSpmRate(sg, P, gam, 1e12);
  chk('qSpmRate cubic limit → ḃ_NL = −γP/(2πσ⁴) (the 2D variational focusing term, recovered)', near(cub.rb, -gam * P / (2 * Math.PI * sg ** 4), Math.abs(cub.rb) * 1e-4));
  // linear-only spreading: qStep must reproduce the EXACT Gaussian law σ²(t) = σ0² + (D·t/σ0)²
  const st = { sigma: 8, b: 0, phi: 0, P: 50 }; const D = 2.4, dt = 0.12, N = 200;
  for (let i = 0; i < N; i++) qStep(st, { D, gamma: 0, isat: 1, dt });
  const t = N * dt;
  chk('qStep linear-only: σ²(t) = σ0² + (D·t/σ0)² EXACTLY (the complex-parameter law is closed form)', near(st.sigma * st.sigma, 8 * 8 + (D * t / 8) ** 2, 1e-9));
  chk('qStep conserves P (the cap holds it)', st.P === 50);
  // SPM-only: pure phase — σ untouched, b driven NEGATIVE (focusing chirp)
  const st2 = { sigma: 8, b: 0, phi: 0, P: 50 };
  qStep(st2, { D: 0, gamma: 20, isat: 1, dt: 0.12 });
  chk('qStep SPM-only: σ unchanged (pure phase), b < 0 (focusing chirp)', near(st2.sigma, 8, 1e-12) && st2.b < 0);
  // fixed point in the SATURABLE engine regime: exists, stable, breathing Ω real. NOTE the PREDICTION hiding in
  // the bracket: at engine params (γ=20, Isat=1, P~300) the free-soliton equilibrium is a TIGHT core σ* ≈ 1–2 px
  // (deep saturation) — the wide probe shape is held by the PIN (injection lock), not by the free NL balance.
  const fp = qFixedPoint({ Dof: 2.4, gamma: 20, isat: 1, P: 300, lo: 0.4 });
  chk('qFixedPoint saturable (engine regime): σ* exists, STABLE, breathing Ω > 0 (saturation arrests Townes)', fp.sigma !== null && fp.stable && fp.Omega > 0);
  chk('qFixedPoint saturable: the free equilibrium is a TIGHT core (σ* < 3 px — the pin, not NL balance, holds wide shapes)', fp.sigma < 3);
  // cubic regimes are scale-free — NO σ*: P > P_c ⇒ collapse (runaway DERIVED), P < P_c ⇒ spread
  const Pc = 2 * Math.PI * 2.4 / 20;
  const up = qFixedPoint({ Dof: 2.4, gamma: 20, isat: 1e12, P: Pc * 4 });
  const dn = qFixedPoint({ Dof: 2.4, gamma: 20, isat: 1e12, P: Pc / 4 });
  chk('qFixedPoint cubic P>P_c → regime "collapse" (RUNAWAY is a register prediction now)', up.sigma === null && up.regime === 'collapse');
  chk('qFixedPoint cubic P<P_c → regime "spread" (the minimum soliton power, derived)', dn.sigma === null && dn.regime === 'spread');
  // packetD: flattening lattice dispersion ⇒ D̄(σ small) < D(k→0), and D̄ → D(k→0) as σ → ∞ (gate B's lesson)
  const r = 6, n = 64, w = 0.5, ring = [];
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; ring.push(r * Math.cos(a), r * Math.sin(a)); }
  const D0 = kernelABCD([r], [w], [ring], {}).D[0];
  const Dnear = packetD([r], [w], [ring], 200), Dtight = packetD([r], [w], [ring], 8);
  chk('packetD → k→0 D for a wide packet (σ=200: within 0.1%)', Math.abs(Dnear - D0) / D0 < 1e-3);
  chk('packetD < k→0 D for a tight packet (the lattice curvature flattens transport — the gate B shortfall)', Dtight < D0 * 0.98);
}

{
  // ── gate D: the SPECTRAL register — the engine's discrete linear step, diagonalized ──
  const G = 32, N = G * G;
  // fft2d round trip = identity
  const rr = new Float64Array(N), ii = new Float64Array(N);
  let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let j = 0; j < N; j++) { rr[j] = rnd() - 0.5; ii[j] = rnd() - 0.5; }
  const rr0 = Float64Array.from(rr), ii0 = Float64Array.from(ii);
  fft2d(rr, ii, G, false); fft2d(rr, ii, G, true);
  let fmax = 0; for (let j = 0; j < N; j++) fmax = Math.max(fmax, Math.abs(rr[j] - rr0[j]), Math.abs(ii[j] - ii0[j]));
  chk('fft2d: forward∘inverse = identity (1e-12)', fmax < 1e-12);

  // REFERENCE x-space leapfrog (verbatim GLSL_STEP1/2/3 + GLSL_LAP_FUNC semantics, torus, f64) — the independent
  // implementation the spectral path must match EXACTLY (same linear map, different basis).
  const ringO = [3, 0, 2, 2, 0, 3, -2, 2, -3, 0, -2, -2, 0, -3, 2, -2], rw = 0.4, nu = 4 * rw / (ringO.length / 2);
  const ringLap = (src) => { const out = new Float64Array(N);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const g = (xx, yy) => src[((yy + 4 * G) % G) * G + ((xx + 4 * G) % G)];
      const ortho = g(x + 1, y) + g(x - 1, y) + g(x, y + 1) + g(x, y - 1);
      const diag = g(x + 1, y + 1) + g(x - 1, y - 1) + g(x + 1, y - 1) + g(x - 1, y + 1);
      let l = (4 * ortho + diag - 20 * src[y * G + x]) / 6;
      let acc = 0; for (let p = 0; p < ringO.length; p += 2) acc += g(x + ringO[p], y + ringO[p + 1]);
      out[y * G + x] = l + nu * (acc - (ringO.length / 2) * src[y * G + x]); }
    return out; };
  const refStepN = (f, T, dt) => { const R = new Float64Array(N), I = new Float64Array(N);
    for (let j = 0; j < N; j++) { R[j] = f[j * 2]; I[j] = f[j * 2 + 1]; }
    for (let s = 0; s < T; s++) { let L = ringLap(I); for (let j = 0; j < N; j++) R[j] -= (dt / 4) * L[j];
      L = ringLap(R); for (let j = 0; j < N; j++) I[j] += (dt / 2) * L[j];
      L = ringLap(I); for (let j = 0; j < N; j++) R[j] -= (dt / 4) * L[j]; }
    const out = new Float64Array(2 * N); for (let j = 0; j < N; j++) { out[j * 2] = R[j]; out[j * 2 + 1] = I[j]; } return out; };
  const probe = new Float64Array(2 * N);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const dx = x - G / 2, dy = y - G / 2, a = Math.exp(-(dx * dx + dy * dy) / 18);
    const ph = 0.4 * dx; probe[(y * G + x) * 2] = a * Math.cos(ph); probe[(y * G + x) * 2 + 1] = a * Math.sin(ph); }
  const T = 7, dt = 0.11, radii = [3], weights = [rw], offs = [ringO];
  const ref = refStepN(probe, T, dt);
  const spec = kernelPropagateSpectral(probe, radii, weights, offs, { T, dt, G });
  let dmax = 0; for (let j = 0; j < 2 * N; j++) dmax = Math.max(dmax, Math.abs(ref[j] - spec.field[j]));
  chk('spectral propagator ≡ the x-space leapfrog EXACTLY (same discrete map, diagonalized — 1e-10)', dmax < 1e-10);
  // −dt is the exact inverse (the palindromic split — why the engine's ±T round-trip is clean, per mode)
  const back = kernelPropagateSpectral(spec.field, radii, weights, offs, { T, dt: -dt, G });
  let bmax = 0; for (let j = 0; j < 2 * N; j++) bmax = Math.max(bmax, Math.abs(back.field[j] - probe[j]));
  chk('spectral ±T round-trip = identity (backward is the exact inverse)', bmax < 1e-10);
  // passband truncation: a smooth packet loses almost nothing below the cut, and the plate COMPRESSES
  const cut = kernelPropagateSpectral(probe, radii, weights, offs, { T, dt, G, kCut: 1.2 });
  chk('kCut truncation: smooth packet fidelity ≥ 0.999 with a real mode cut (the passband compression law)', ampCorr(cut.field, ref) > 0.999 && cut.kept < cut.total * 0.4);
  // the λ-grid cache path (the hot-path form the holography verbs use) ≡ the direct path
  const lam = kernelLambdaGrid(radii, weights, offs, G);
  const viaLam = kernelPropagateSpectral(probe, null, null, null, { T, dt, G, lam });
  let lmax = 0; for (let j = 0; j < 2 * N; j++) lmax = Math.max(lmax, Math.abs(viaLam.field[j] - spec.field[j]));
  chk('kernelLambdaGrid cache path ≡ direct symbol path (the per-kernelVer verb cache is exact)', lmax < 1e-9);
  // the FAST stencil-DFT grid build ≡ kernelSymbol at EVERY mode (integer offsets — the live-kernel path)
  let gmax = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = y * G + x;
    const kx2 = 2 * Math.PI * (x <= G / 2 ? x : x - G) / G, ky2 = 2 * Math.PI * (y <= G / 2 ? y : y - G) / G;
    const s = kernelSymbol(radii, weights, offs, kx2, ky2);
    gmax = Math.max(gmax, Math.abs(lam.re[j] - s.re), Math.abs(lam.im[j] - s.im)); }
  chk('kernelLambdaGrid (stencil-DFT fast build) ≡ kernelSymbol at every mode (1e-9 — the ~100× rebuild fix)', gmax < 1e-9);
}

{
  // ── the duality harvest: exact shift + shift-invariant scan ──
  const G = 32, N = G * G, f = new Float64Array(2 * N);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const dx = x - 16, dy = y - 12, a = Math.exp(-(dx * dx + dy * dy) / 10);
    const i = (y * G + x) * 2, ph = 0.3 * dx; f[i] = a * Math.cos(ph); f[i + 1] = a * Math.sin(ph); }
  // integer spectral shift ≡ the exact torus roll
  const s5 = spectralShift(f, 5, -3, G); let rmax = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const si = (((y + 3) % G + G) % G) * G + (((x - 5) % G + G) % G);
    rmax = Math.max(rmax, Math.abs(s5[(y * G + x) * 2] - f[si * 2]), Math.abs(s5[(y * G + x) * 2 + 1] - f[si * 2 + 1])); }
  chk('spectralShift: integer offset ≡ the exact torus roll (1e-10)', rmax < 1e-10);
  // fractional shift is UNITARY and exactly invertible
  const sh = spectralShift(f, 2.5, -1.25, G), back = spectralShift(sh, -2.5, 1.25, G);
  let bmax2 = 0, e0 = 0, e1 = 0;
  for (let j = 0; j < 2 * N; j++) { bmax2 = Math.max(bmax2, Math.abs(back[j] - f[j])); e0 += f[j] * f[j]; e1 += sh[j] * sh[j]; }
  chk('spectralShift: fractional shift is unitary (Parseval) and exactly invertible', bmax2 < 1e-10 && Math.abs(e1 - e0) < 1e-9 * e0);
  // crossCorrScan finds a rolled copy at its offset with corr ≈ 1
  const cc = crossCorrScan(f, spectralShift(f, 7, -4, G), G);
  chk('crossCorrScan: finds a moved copy (corrMax≈1 at the true offset; zero-lag would miss it)', cc.corrMax > 0.9999 && cc.dx === 7 && cc.dy === -4 && cc.corr0 < cc.corrMax - 0.1);
}

{
  // ── DESCENT RUNG 1: the cover law — the cocycle bit-for-bit, and the global obstruction named ──
  const G = 32, N = G * G, ringO = [3, 0, 2, 2, 0, 3, -2, 2, -3, 0, -2, -2, 0, -3, 2, -2];
  const radii = [3], weights = [0.4], offs = [ringO], dt = 0.11;
  const f = new Float64Array(2 * N);
  let seed = 77; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let j = 0; j < 2 * N; j++) f[j] = rnd() - 0.5;
  const whole = leapfrogStepX(f, radii, weights, offs, dt, G);
  // sanity: the x-space reference agrees with the spectral propagator (same map, different basis)
  const spec1 = kernelPropagateSpectral(f, radii, weights, offs, { T: 1, dt, G });
  let smax = 0; for (let j = 0; j < 2 * N; j++) smax = Math.max(smax, Math.abs(whole[j] - spec1.field[j]));
  chk('descent: leapfrogStepX ≡ the spectral propagator (1e-10 — same map, different basis)', smax < 1e-10);
  // THE COCYCLE: cover-step-then-glue ≡ whole-torus step, BIT FOR BIT (local ops, fixed term order, halo 3·reach)
  for (const P of [2, 4]) {
    const cov = coverStep(f, radii, weights, offs, dt, G, P);
    let dmax = 0; for (let j = 0; j < 2 * N; j++) dmax = Math.max(dmax, Math.abs(cov[j] - whole[j]));
    chk(`descent: ${P}×${P} cover + glue ≡ whole torus BIT-FOR-BIT (the cocycle holds for the local ops)`, dmax === 0);
  }
  // THE OBSTRUCTION: the energy cap is global. Per-patch LOCAL capping forks the glued field (wrong physics);
  // the monoid REDUCE (fixed patch-ordered tree) reproduces the global cap to f64-order sensitivity (~1e-12).
  const e0 = 3.7; let Ew = 0; for (let j = 0; j < 2 * N; j++) Ew += whole[j] * whole[j];
  const sw = Math.sqrt(e0 / Ew), globalCap = Float64Array.from(whole, (v) => v * sw);
  const pw = G / 2, partials = [];
  const localCap = Float64Array.from(whole);
  for (let pj = 0; pj < 2; pj++) for (let pi = 0; pi < 2; pi++) { let Ep = 0;
    for (let y = 0; y < pw; y++) for (let x = 0; x < pw; x++) { const j = ((pj * pw + y) * G + (pi * pw + x)) * 2; Ep += whole[j] ** 2 + whole[j + 1] ** 2; }
    partials.push(Ep);
    const sp = Math.sqrt((e0 / 4) / Ep);
    for (let y = 0; y < pw; y++) for (let x = 0; x < pw; x++) { const j = ((pj * pw + y) * G + (pi * pw + x)) * 2; localCap[j] *= sp; localCap[j + 1] *= sp; } }
  let lmax = 0; for (let j = 0; j < 2 * N; j++) lmax = Math.max(lmax, Math.abs(localCap[j] - globalCap[j]));
  chk('descent: per-patch LOCAL capping ≠ the global cap (the obstruction is real — the cap is a global datum)', lmax > 1e-6);
  const Er = capReduce(partials), sr = Math.sqrt(e0 / Er);
  chk('descent: the monoid REDUCE reproduces the global cap (~1e-12; the reduction TREE is part of the contract — f64 order sensitivity)', Math.abs(sr - sw) < 1e-12 * sw);
}

{
  // ── the SPATIAL FORK-FINDER (coverResidual): clean cocycle = exactly 0; a tainted halo lights up WHERE ──
  const G = 32, N = G * G, ringO = [3, 0, 2, 2, 0, 3, -2, 2, -3, 0, -2, -2, 0, -3, 2, -2];
  const radii = [3], weights = [0.4], offs = [ringO], dt = 0.11;
  const f = new Float64Array(2 * N);
  let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let j = 0; j < 2 * N; j++) f[j] = rnd() - 0.5;
  const clean = coverResidual(f, radii, weights, offs, dt, G, 2);
  chk('fork-finder: clean cover → overlap residual EXACTLY 0 (redundant computations agree bit-for-bit)', clean.rmax === 0);
  const t = { x: 15, y: 8, amp: 1e-3 };   // a cell near the patch seam — tainted in its OWNER only
  const bad = coverResidual(f, radii, weights, offs, dt, G, 2, { taint: t });
  const near = bad.at && Math.max(Math.abs(bad.at[0] - t.x), Math.abs(bad.at[1] - t.y)) <= 3 * bad.reach;
  chk('fork-finder: a tainted halo read lights up LOCALIZED (within the 3·reach light cone of the fault)', bad.rmax > 1e-9 && near);
}

{
  // ── THE LIGHT-CONE LAW (the theorem behind NO-EXCHANGE sharding): corrupt EVERYTHING outside a region —
  // after one step, region cells deeper than 3·reach from the region's edge are BIT-EXACT vs the true whole-torus
  // step. Wrong/stale/declaration-sourced boundary data can only touch the seam band; the interior is untouchable.
  // This is what lets a regional witness take its halo from the REGISTER (the declaration) instead of a peer.
  const G = 32, N = G * G, ringO = [3, 0, 2, 2, 0, 3, -2, 2, -3, 0, -2, -2, 0, -3, 2, -2];
  const radii = [3], weights = [0.4], offs = [ringO], dt = 0.11, reach = 3;
  const f = new Float64Array(2 * N);
  let seed = 55; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let j = 0; j < 2 * N; j++) f[j] = rnd() - 0.5;
  const whole = leapfrogStepX(f, radii, weights, offs, dt, G);
  const R = { x0: 4, y0: 4, x1: 28, y1: 28 };                     // the region a shard-holder owns
  const g = Float64Array.from(f);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (x < R.x0 || x >= R.x1 || y < R.y0 || y >= R.y1) {
    g[(y * G + x) * 2] = rnd() * 9; g[(y * G + x) * 2 + 1] = rnd() * 9; }   // GARBAGE outside the region
  const stepped = leapfrogStepX(g, radii, weights, offs, dt, G);
  const band = 3 * reach; let imax = 0, smax2 = 0;
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) { const j = (y * G + x) * 2;
    const depth = Math.min(x - R.x0, R.x1 - 1 - x, y - R.y0, R.y1 - 1 - y);
    const d = Math.max(Math.abs(stepped[j] - whole[j]), Math.abs(stepped[j + 1] - whole[j + 1]));
    if (depth >= band) imax = Math.max(imax, d); else smax2 = Math.max(smax2, d); }
  chk('light-cone: garbage boundary → interior beyond 3·reach BIT-EXACT (declaration-sourced halos are honest)', imax === 0);
  chk('light-cone: the corruption DID reach the seam band (the test has teeth)', smax2 > 1e-3);
}

{
  // ── GATE F: the ERMAKOV–LEWIS / sl(2,ℝ) CASIMIR — I = V̈·V − ½V̇², the conserved partner of the virial law.
  // Under LINEAR lattice evolution v_g(k) is a per-mode constant of motion ⇒ Var(x)(t) is an EXACT parabola for
  // ANY dispersion (no quadratic band assumed) ⇒ I is exactly conserved with the register-predicted curvature
  // (virialRateX, analytic ∇λ off the stencil) — and the parabola's turning point is fixed by t≈0 data alone:
  // t* = −V̇₀/V̈, V_min = I/V̈ — the register calls the FOCAL EVENT before the field gets there. Cubic NL keeps
  // the parabola (V̈ = 4DH const — the group law); saturation BENDS it (the K-breaking, measured).
  const G = 64, N = G * G, ringO = [3, 0, 2, 2, 0, 3, -2, 2, -3, 0, -2, -2, 0, -3, 2, -2];
  const radii = [3], weights = [0.4], offs = [ringO], dt = 0.1;
  const mkGauss = (sig, b, amp = 0.1) => { const f = new Float64Array(2 * N);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const dx = x - G / 2, dy = y - G / 2, r2 = dx * dx + dy * dy;
      const a = amp * Math.exp(-r2 / (2 * sig * sig)), th = b * r2;
      f[(y * G + x) * 2] = a * Math.cos(th); f[(y * G + x) * 2 + 1] = a * Math.sin(th); }
    return f; };
  const nlPhase = (f, gamma, isat, dtv) => { for (let j = 0; j < N; j++) { const re = f[j * 2], im = f[j * 2 + 1], I = re * re + im * im;
    const th = gamma * (isat === Infinity ? I : I / (1 + I / isat)) * dtv, c = Math.cos(th), s = Math.sin(th);
    f[j * 2] = re * c - im * s; f[j * 2 + 1] = re * s + im * c; } };
  const runLedger = (f0, steps, gamma = 0, isat = Infinity, Dq = 0, wUse = weights) => {
    let f = Float64Array.from(f0); const vs = [secondMoment(f, G).V];
    for (let s = 0; s < steps; s++) { f = leapfrogStepX(f, radii, wUse, offs, dt, G); if (gamma) nlPhase(f, gamma, isat, dt); vs.push(secondMoment(f, G).V); }
    const vddX = virialRateX(f0, radii, wUse, offs, G, { gamma, isat, Dq });
    let s0 = vs.length, s1 = 0, s2 = 0, s3 = 0, s4 = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < vs.length; i++) { const t = i * dt, v = vs[i]; s1 += t; s2 += t * t; s3 += t * t * t; s4 += t * t * t * t; b0 += v; b1 += v * t; b2 += v * t * t; }
    const det = (a, b, c, d, e, f2, g, h, i2) => a * (e * i2 - f2 * h) - b * (d * i2 - f2 * g) + c * (d * h - e * g);
    const Dm = det(s0, s1, s2, s1, s2, s3, s2, s3, s4);
    const c0 = det(b0, s1, s2, b1, s2, s3, b2, s3, s4) / Dm, c1 = det(s0, b0, s2, s1, b1, s3, s2, b2, s4) / Dm, c2 = det(s0, s1, b0, s1, s2, b1, s2, s3, b2) / Dm;
    let rms = 0; for (let i = 0; i < vs.length; i++) { const r = vs[i] - (c0 + c1 * i * dt + c2 * i * dt * i * dt); rms += r * r; } rms = Math.sqrt(rms / vs.length) / vs[0];
    let iLo = Infinity, iHi = -Infinity;
    for (let i = 1; i < vs.length - 1; i++) { const Vd = (vs[i + 1] - vs[i - 1]) / (2 * dt); const I = slCasimir(vddX, vs[i], Vd); iLo = Math.min(iLo, I); iHi = Math.max(iHi, I); }
    const drift = (iHi - iLo) / (Math.abs(vddX) * vs[0]);
    const Vd1 = (vs[2] - vs[0]) / (2 * dt), I1 = slCasimir(vddX, vs[1], Vd1);
    let mIdx = 0; for (let i = 1; i < vs.length; i++) if (vs[i] < vs[mIdx]) mIdx = i;
    return { vs, vddX, vddMeas: 2 * c2, rms, drift, tStar: dt - Vd1 / vddX, vMinPred: I1 / vddX, tMin: mIdx * dt, vMin: vs[mIdx], mIdx };
  };
  const lin = runLedger(mkGauss(5, 0), 100);
  chk('gate F: LINEAR V(t) is an EXACT parabola on the lattice — any dispersion, no quadratic band (RMS < 1e-5·V0)', lin.rms < 1e-5);
  chk('gate F: register-predicted curvature (analytic ∇λ) ≡ measured V̈ to 0.5% (the FD bias the Casimir caught)', Math.abs(lin.vddMeas / lin.vddX - 1) < 5e-3);
  const chp = runLedger(mkGauss(5, -0.02), 140);
  chk('gate F: the CASIMIR is conserved along a chirped linear trajectory (drift < 1% of V̈·V0)', chp.drift < 0.01);
  chk('gate F: the WAIST is called from t≈0 register data — t* = −V̇₀/V̈ within 2 steps of the measured focus', chp.mIdx > 0 && chp.mIdx < chp.vs.length - 1 && Math.abs(chp.tStar - chp.tMin) < 2 * dt);
  chk('gate F: V_min = I/V̈ matches the measured waist (< 2% of V0 — the focal depth, predicted not integrated)', Math.abs(chp.vMinPred - chp.vMin) / chp.vs[0] < 0.02);
  const Dq = packetD(radii, weights, offs, 5);
  const cub = runLedger(mkGauss(5, 0, 0.25), 100, 2, Infinity, Dq);
  chk('gate F: CUBIC keeps the parabola (V̈ = 4DH const — the sl(2) group law survives the nonlinearity)', cub.rms < 2e-3);
  chk('gate F: cubic register curvature within 8% (the Dq packet-weight gap — gate C\'s honest boundary)', Math.abs(cub.vddMeas / cub.vddX - 1) < 0.08);
  const sat = runLedger(mkGauss(5, 0, 0.25), 100, 20, 0.01, Dq);
  chk('gate F: SATURATION bends the parabola (RMS > 5× cubic — the K-breaking IS why collapse arrests, measured)', sat.rms > 5 * cub.rms);
  // THE RE-KEY LAW (the clock's kernel edit as a register prediction): same probe, ring weights ×1.2 — the
  // curvature JUMP measured under evolution must equal the descriptor-predicted ΔV̈ (virialRateX A vs B, same
  // field). This is what lets the live [VPT] watch bookkeep kernel bumps OUT of the wear meter İ.
  const wB = weights.map((x) => x * 1.2);
  const linB = runLedger(mkGauss(5, 0), 100, 0, Infinity, 0, wB);
  const dMeas = linB.vddMeas - lin.vddMeas, dPred = linB.vddX - lin.vddX;
  chk('gate F: the RE-KEY — kernel-edit ΔV̈ measured ≡ descriptor-predicted (2% — bumps are bookkeepable, not wear)', Math.abs(dMeas / dPred - 1) < 0.02);
  // the TORUS-AWARE moment (the wearGo lag artifact made law): a Gaussian straddling the wrap boundary must
  // read the SAME (V, centroid) as its centered twin; the naive centroid/V read garbage there (live symptom:
  // "lock 0.92 yet lag 64px" — every wear row lag≈60 regardless of β, speed, or distance walked).
  const cen = secondMomentTorus(mkGauss(5, 0), G);
  const straddle = new Float64Array(2 * N);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { let dx = (x - 2 + G) % G; if (dx > G / 2) dx -= G;
    let dy = (y - 3 + G) % G; if (dy > G / 2) dy -= G;
    straddle[(y * G + x) * 2] = 0.1 * Math.exp(-(dx * dx + dy * dy) / 50); }
  const str = secondMomentTorus(straddle, G), naiv = secondMoment(straddle, G);
  chk('gate F: torus moment — wrap-straddling Gaussian reads its true centroid (first-harmonic phase, wrap-immune)', Math.abs(str.cx - 2) < 0.05 && Math.abs(str.cy - 3) < 0.05);
  chk('gate F: torus moment — V of the straddler ≡ V of the centered twin (0.1%); the NAIVE V is off by >10× there', Math.abs(str.V / cen.V - 1) < 1e-3 && naiv.V > 10 * str.V);
  // the localization gauge m (circular resultant length): compact state → m≈1; a torus-filling state → m≈0,
  // and lag/centroid observables must refuse themselves (the "lag 64px at lock 0.92" lesson made law)
  const flat = new Float64Array(2 * N); for (let j = 0; j < N; j++) flat[j * 2] = 0.1;
  chk('gate F: localization gauge — compact m>0.9, torus-filling m<0.05 (centroid validity is now measurable)', str.m > 0.9 && secondMomentTorus(flat, G).m < 0.05);
  // the FFT-free re-key path: virialRateX with a cached spec bundle ≡ the direct field path (identical sums)
  const chirped = mkGauss(5, -0.02), spec = virialSpec(chirped, G, { gamma: 2, isat: Infinity });
  const direct = virialRateX(chirped, radii, weights, offs, G, { gamma: 2, isat: Infinity, Dq });
  const cached = virialRateX(null, radii, weights, offs, G, { gamma: 2, isat: Infinity, Dq, spec });
  chk('gate F: spec-cached V̈ ≡ direct field path (the register re-keys FFT-free — the spectrum is compile content)', Math.abs(cached - direct) <= 1e-12 * Math.abs(direct));
  // the hot-path scratch pool (reuse:true) must be BIT-IDENTICAL to the allocating path — same ops, same order,
  // only the garbage differs (the GC-pause visual-lag fix for the register engine)
  const lamP = kernelLambdaGrid(radii, weights, offs, G);
  const pA1 = kernelPropagateSpectral(chirped, null, null, null, { T: 1, dt: 0.12, G, lam: lamP }).field;
  const pR1 = kernelPropagateSpectral(chirped, null, null, null, { T: 1, dt: 0.12, G, lam: lamP, reuse: true }).field;
  let pd = 0; for (let j = 0; j < pA1.length; j++) if (pA1[j] !== pR1[j]) pd++;
  chk('gate F: reuse:true scratch-pool propagation ≡ allocating path BIT-FOR-BIT (the fast path changes no bytes)', pd === 0);
  // the U1 shard executor: one regional step ≡ the whole-torus step BIT-FOR-BIT inside R (the light-cone
  // margins as an evaluation schedule), and the outside untouched byte-for-byte
  const regF = mkGauss(6, -0.01, 0.2), regBox = { x0: 10, y0: 4, x1: 42, y1: 60 };
  const wholeS = leapfrogStepX(regF, radii, weights, offs, 0.11, G);
  const regS = regionStepX(regF, radii, weights, offs, 0.11, G, regBox);
  let inDiff = 0, outDiff = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const j = (y * G + x) * 2;
    const inR = x >= regBox.x0 && x < regBox.x1 && y >= regBox.y0 && y < regBox.y1;
    if (inR) { if (regS[j] !== wholeS[j] || regS[j + 1] !== wholeS[j + 1]) inDiff++; }
    else if (regS[j] !== regF[j] || regS[j + 1] !== regF[j + 1]) outDiff++; }
  chk('shard executor: regionStepX ≡ whole step INSIDE R bit-for-bit, outside untouched (cost ∝ |R|)', inDiff === 0 && outDiff === 0);
  // ITERATED light-cone (the HONEST bound for a live shard): freeze the outside each step; after N steps the
  // frozen boundary's influence has crept N·reach inward, so ONLY the interior beyond N·reach from the region
  // edge stays bit-exact vs a true whole-torus run. This is what a two-browser shard actually guarantees — NOT
  // whole-region exactness (that would be an overclaim). The seam DIVERGES over steps; the deep interior holds.
  // NOTE the true per-step cone: a full Strang step = 3 substeps, each propagating by the STENCIL reach
  // (ring max offset + lap9), so one step's cone is ~3·(ringReach) ≈ 9 cells here, not 1·reach. The honest
  // margin is N·(3·ringReach). (This corrected a v1 overclaim — the single-step test passed only because it
  // used the field's OWN correct outside; a FROZEN boundary reveals the true, larger cone.)
  { const reach = 9, N2 = 3, box = { x0: 2, y0: 2, x1: 62, y1: 62 };   // 60×60 (max depth 30 > N·reach 27 → a genuine deep-exact core AND a diverging rim)
    // a field with signal EVERYWHERE (incl. near the region edge) so the seam divergence is measurable — a
    // centered Gaussian is ~0 at the edges, hiding the (real) divergence. Deterministic pseudo-random.
    let rs = 77; const rr = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const rndF = new Float64Array(2 * G * G); for (let j = 0; j < rndF.length; j++) rndF[j] = (rr() - 0.5) * 0.2;
    let wf = Float64Array.from(rndF), sf = Float64Array.from(rndF); const regF2 = rndF;
    for (let st = 0; st < N2; st++) { wf = leapfrogStepX(wf, radii, weights, offs, 0.11, G);
      const stepped = regionStepX(sf, radii, weights, offs, 0.11, G, box);
      // re-freeze the outside to the ORIGINAL boundary each step (the declared-boundary shard discipline)
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (x < box.x0 || x >= box.x1 || y < box.y0 || y >= box.y1) { const j = (y * G + x) * 2; stepped[j] = regF2[j]; stepped[j + 1] = regF2[j + 1]; }
      sf = stepped; }
    const margin = N2 * reach; let deepMax = 0, seamMax = 0;
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) { const j = (y * G + x) * 2;
      const depth = Math.min(x - box.x0, box.x1 - 1 - x, y - box.y0, box.y1 - 1 - y);
      const d = Math.max(Math.abs(sf[j] - wf[j]), Math.abs(sf[j + 1] - wf[j + 1]));
      if (depth >= margin) deepMax = Math.max(deepMax, d); else seamMax = Math.max(seamMax, d); }
    chk('shard iterated light-cone: interior beyond N·reach BIT-EXACT vs whole-torus after N frozen-boundary steps (the honest shard guarantee)', deepMax === 0);
    chk('shard iterated light-cone: the seam band DID diverge (frozen boundary ≠ true field — the shard is a real approximation there, not overclaimed)', seamMax > 1e-6); }
  // the FD-on-λ telemetry path: within the declared ~2% of the analytic sum (the live tier's 120ms→O(N) fix)
  const vddFD = virialRateX(regF, radii, weights, offs, G, { lam: kernelLambdaGrid(radii, weights, offs, G) });
  const vddAn = virialRateX(regF, radii, weights, offs, G, {});
  chk('virialRateX FD-on-λ ≡ analytic within 2% (telemetry-grade v_g — bias declared, instruments keep exact)', Math.abs(vddFD / vddAn - 1) < 0.02);
  // ── MULTISCALE SHARD, the load-bearing theorem (§9.1): the IFS tiers are a MULTIRESOLUTION decomposition of
  // the LINEAR operator — the symbol is linear in the ring set, so Σ_d λ_tier − (nTiers−1)·lap9 = λ_merged
  // EXACTLY, hence tier-decomposed linear propagation reconstructs the whole linear step (the presheaf's global
  // section in the SCALE direction — an exact gluing). Nonlinearity does NOT decompose (applied once on the
  // full field); that boundary is honest and stated. Partition the merged kernel's rings into tiers by radius.
  { const mkRing = (r) => { const n = Math.max(8, Math.round(2 * Math.PI * r)), o = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; o.push(Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))); } return o; };
    const R1 = mkRing(3), R2 = mkRing(8), R3 = mkRing(15);
    const mRad = [3, 8, 15], mW = [0.3, 0.2, 0.15], mO = [R1, R2, R3];
    const rBT = [[3], [8], [15]], wBT = [[0.3], [0.2], [0.15]], oBT = [[R1], [R2], [R3]];
    // symbol reconstruction at several k
    let symMax = 0; for (const kx of [0.1, 0.7, 1.5, 2.5]) for (const ky of [0.3, 1.1]) {
      const sm = kernelSymbol(mRad, mW, mO, kx, ky), ts = tierSymbolSum(rBT, wBT, oBT, kx, ky);
      symMax = Math.max(symMax, Math.hypot(ts.re - sm.re, ts.im - sm.im) / (Math.hypot(sm.re, sm.im) || 1)); }
    chk('multiscale: Σ tier-symbols − (n−1)·lap9 ≡ merged symbol to the f64 floor (the exact scale-gluing — the presheaf global section)', symMax < 1e-12);
    // the tier λ-grid ≡ the merged λ-grid → tier-decomposed spectral propagation ≡ the whole linear step
    const G3 = 64; const lamM = kernelLambdaGrid(mRad, mW, mO, G3), lamT = tierLambdaGrid(rBT, wBT, oBT, G3);
    let gridMax = 0; for (let j = 0; j < lamM.re.length; j++) gridMax = Math.max(gridMax, Math.abs(lamM.re[j] - lamT.re[j]), Math.abs(lamM.im[j] - lamT.im[j]));
    chk('multiscale: tier λ-grid ≡ merged λ-grid (1e-10) — the linear step reconstructs from the tiers, whole-field FFT or not', gridMax < 1e-10);
    const pf = new Float64Array(2 * G3 * G3); let ps = 5; const pr = () => (ps = (ps * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let j = 0; j < pf.length; j++) pf[j] = (pr() - 0.5) * 0.2;
    const whole = kernelPropagateSpectral(pf, mRad, mW, mO, { T: 5, dt: 0.1, G: G3 }).field;
    const viaT = kernelPropagateSpectral(pf, null, null, null, { T: 5, dt: 0.1, G: G3, lam: lamT }).field;
    let pMax = 0; for (let j = 0; j < whole.length; j++) pMax = Math.max(pMax, Math.abs(whole[j] - viaT[j]));
    chk('multiscale: T=5 tier-propagated linear step ≡ whole spectral step (1e-9 — the reconstruction holds under iteration)', pMax < 1e-9);
    // ── TEMPORAL LOD (the KWE-native win — §9.1): the tiers are PROPER-TIME worldlines (T_d = T·(d+1)/N), so a
    // coarse tier's λ can be applied at a LOWER RATE (every `period` steps, scaled ×period to preserve the
    // average) — a refusable approximation with a MEASURED defect, NOT a fork. Fine tier every step, coarse
    // tiers slower → fewer kernel-applications. This is the one real optimization the fractal CLOCK offers;
    // it is invisible to the static-convolution view (tiers are broadband) and visible only as proper time.
    const lap9 = kernelLambdaGrid([], [], [], G3);
    const ringT = rBT.map((_, d) => { const l = kernelLambdaGrid(rBT[d], wBT[d], oBT[d], G3);
      return { re: l.re.map((v, j) => v - lap9.re[j]), im: l.im.map((v, j) => v - lap9.im[j]) }; });
    const T2 = 12, periods = [1, 2, 3];
    let psi = Float64Array.from(pf);
    for (let t = 0; t < T2; t++) { const lre = Float64Array.from(lap9.re), lim = Float64Array.from(lap9.im);
      for (let d = 0; d < 3; d++) if (t % periods[d] === 0) for (let j = 0; j < G3 * G3; j++) { lre[j] += ringT[d].re[j] * periods[d]; lim[j] += ringT[d].im[j] * periods[d]; }
      psi = kernelPropagateSpectral(psi, null, null, null, { T: 1, dt: 0.1, G: G3, lam: { re: lre, im: lim } }).field; }
    const wholeT2 = kernelPropagateSpectral(pf, mRad, mW, mO, { T: T2, dt: 0.1, G: G3 }).field;
    let lodMax = 0, ampT = 0; for (let j = 0; j < wholeT2.length; j++) { lodMax = Math.max(lodMax, Math.abs(wholeT2[j] - psi[j])); ampT = Math.max(ampT, Math.abs(wholeT2[j])); }
    chk('multiscale temporal-LOD: coarse tiers at 1/2, 1/3 rate → <1% error at ~61% of the kernel-applications (the KWE proper-time win, refusable+measured)', lodMax / ampT < 0.01);
    // ── SCALE-SELECTIVE HOLOGRAPHY (the theorem cashed as a CAPABILITY): a radius-BANDED λ propagates only that
    // scale's structure — recall the coarse skeleton or the fine detail of a banked moment, EXACT by the split.
    const mid2 = Math.sqrt(Math.max(...mRad) * Math.min(...mRad));
    const fB = { r: [], w: [], o: [] }, cB = { r: [], w: [], o: [] };
    mRad.forEach((r, d) => { const b = r < mid2 ? fB : cB; b.r.push(r); b.w.push(mW[d]); b.o.push(mO[d]); });
    const lamF = kernelLambdaGrid(fB.r, fB.w, fB.o, G3), lamC = kernelLambdaGrid(cB.r, cB.w, cB.o, G3), lap = kernelLambdaGrid([], [], [], G3);
    let splitMax = 0; for (let j = 0; j < G3 * G3; j++) splitMax = Math.max(splitMax, Math.abs(lamF.re[j] + lamC.re[j] - lap.re[j] - lamM.re[j]), Math.abs(lamF.im[j] + lamC.im[j] - lap.im[j] - lamM.im[j]));
    chk('scale-selective: fine-band λ + coarse-band λ − lap9 ≡ merged λ (1e-10 — coarse/fine recall is an EXACT split, not an approximation)', splitMax < 1e-10);
    const plate = kernelPropagateSpectral(pf, mRad, mW, mO, { T: 16, dt: 0.12, G: G3 }).field;
    const lAll = kernelPropagateSpectral(plate, null, null, null, { T: 16, dt: -0.12, G: G3, lam: lamM }).field;
    const lC = kernelPropagateSpectral(plate, null, null, null, { T: 16, dt: -0.12, G: G3, lam: lamC }).field;
    let dCA = 0, eA = 0; for (let j = 0; j < lAll.length; j++) { dCA += (lC[j] - lAll[j]) ** 2; eA += lAll[j] ** 2; }
    chk('scale-selective: coarse-band recall lift DIFFERS from the full lift (a distinct scale reconstruction, not a copy)', Math.sqrt(dCA / eA) > 0.2); }
}

console.log(ok ? '\nALL PASS (medium-core observer bank + beat providers + stamped input + determinism primitives + kernel ABCD slice + gate-C q register + gate-D spectral propagator + gate-F Ermakov–Lewis Casimir)' : '\nFAILURES ABOVE');
process.exit(ok ? 0 : 1);
