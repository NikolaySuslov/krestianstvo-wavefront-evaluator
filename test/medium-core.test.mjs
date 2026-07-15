// medium-core.test.mjs — extraction stage A: the observer bank (doc/proper-time-metric.md §12).
// Run: node test/medium-core.test.mjs. The bank must be a faithful re-housing of medium.js's
// descriptor store: stable ops reference, identity reset, lossless snapshot round-trip, exact
// legacy-key mapping, and sanitization that degrades to identity components (never NaN).
import { makeObserverBank, normalizeVirtEvent, applySettingsVerb, applyVirtVerb, makeStepClock, makeCouplingStore, muxClocks, makeRippleClock, makeIFSClock, makeSelfHost, makeStampedInput, hashField, hashNums, opNums, ampCorr, phaseCorr, syncClockRate } from '../public/medium-core.js';
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

console.log(ok ? '\nALL PASS (medium-core observer bank + beat providers + stamped input + determinism primitives)' : '\nFAILURES ABOVE');
process.exit(ok ? 0 : 1);
