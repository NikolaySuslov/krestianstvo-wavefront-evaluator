/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// medium-u1.js — medium.js's SUCCESSOR, SLOT-CENTRIC (doc/medium-u1-slots.md; extraction ladder S3+).
//
//   THE ARCHITECTURE: the U(1)/ℂ* OBSERVER REGISTER is the organizing principle. There are N observer SLOTS
//   (W, V, P1, P2) on ONE soliton substrate; each slot = (field, readOp, clock τ, register, leash). Transport,
//   eye, perception, holography are BEHAVIORS OF SLOTS, not separate subsystems (the pre-U1 scopes/modes are
//   gone — the tunnel/instanton arc is preserved dormant in medium-u1-oracle for later resurrection).
//
//   TRANSPORT = THE W SLOT'S LEASH (the unification, verified in test/medium-u1-slots.js): shiftX/Y → W.virtGo.
//   W's movAtt REGENERATES its attractor (makeProbeField at the eased leash position); a plate slot (V/P) ROLLS
//   a stored plate — the SAME leashAdvance law drives both. So there is no special "transport drive": W is a slot
//   whose attractor is regenerable, commanded by the same virtGo V/P use.
//
//   Built over the EXTRACTED substrate (imported, never copied): medium-gpu (_E: fields/stepSoliton/snapshot),
//   medium-core (bank/muxClocks/coupling/chainMeter/step-clock), kwe-tau (worldline clocks), medium-u1-slots
//   (the slot bank + mux), soliton-algebra (lensC1). World = hologram_world_u1 (node 'mediumU1').
//
//   BUILD STATUS: S3 (this) = the W-home transport chase over the slot bank (mux ready for V at S5/S6). The
//   oracle (selo 'medium-u1-oracle') is the live PARITY WITNESS — diff the chase/lock against it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

import { IFSGpu } from '../ifs-gpu.js';
import {
  hologramWorldProgram, REFLECTOR_MS, SUBTICK_MS, GRID, N_CELLS, DT, SRC_ALPHA, RENDER_SCALE,
} from '../hologram_world_u1.js';
import { makeProbeField, lensU1, lensC1 } from '../soliton-algebra.js';
import { makeObserverBank, makeStepClock, makeCouplingStore, muxClocks, chainMeter, makeStampedInput, hashField as _hashField, hashNums as _hashNums, opNums as _opNums, ampCorr as _ampCorr, phaseCorr, syncClockRate, kernelABCD, kernelSymbol, packetD, qStep, qFixedPoint, qSpmRate, kernelPropagateSpectral, kernelLambdaGrid, fft2d, crossCorrScan, spectralShift, leapfrogStepX, coverStep, coverResidual, secondMoment, secondMomentTorus, virialRateX, virialSpec, slCasimir, regionStepX } from '../medium-core.js';
import { makeSolitonEngine } from '../medium-gpu.js';
import { makeSlotBank, makeSlotMux, leashAdvance, leashDue, leashGainPredicted } from '../medium-u1-slots.js';

const STEPS_PER_PHASE = 19, _MON_RATE = 3.0, Q = 7, SLOTN = ['W', 'V', 'P1', 'P2'];
const _SOL_GAMMA = 20, _SOL_ISAT = 1;         // saturable-focusing (the soliton sustain)
const _TRANSPORT_BETA = 0.15;                 // pin/superpose weight per step (β·attractor; the coevolve-chase stiffness)
const _OBJORB_R = 16, _OBJORB_W_STEP = 0.012 / STEPS_PER_PHASE;   // objorbit radius + per-step angular gain

function makeMediumU1Scripts(avatarScript) { return [hologramWorldProgram + avatarScript]; }

// (the determinism hashes _hashField/_hashNums/_opNums + the lock meter _ampCorr are now imported from
//  medium-core — hashField/hashNums/opNums/ampCorr — the ONE implementation every KWE app shares.)

function makeMediumU1Renderer(core) {
  const RW = GRID * RENDER_SCALE, RH = GRID * RENDER_SCALE;
  const mkCell = (label, color) => { const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', flex: '1', minWidth: '0', border: `1px solid ${color}22`, borderRadius: '4px', overflow: 'hidden' });
    const lbl = document.createElement('div'); Object.assign(lbl.style, { fontSize: '8px', color, padding: '2px 5px', background: '#000a', whiteSpace: 'pre-wrap', overflow: 'hidden', fontFamily: 'ui-monospace,monospace', lineHeight: '1.3' }); lbl.textContent = label;
    const canvas = document.createElement('canvas'); canvas.width = RW; canvas.height = RH;
    Object.assign(canvas.style, { flex: '1', minHeight: '0', width: '100%', height: '100%', objectFit: 'contain', borderRadius: '3px', display: 'block' });
    wrap.appendChild(lbl); wrap.appendChild(canvas); return { wrap, canvas, ctx: canvas.getContext('2d'), setLabel: (t) => { lbl.textContent = t; } }; };
  const mkBtn = (label, on, handler) => { const b = document.createElement('button'); b.textContent = label; b._on = !!on;
    const paint = () => Object.assign(b.style, { background: b._on ? '#264' : '#222', color: b._on ? '#9f9' : '#9cf', border: '1px solid #0004', borderRadius: '4px', padding: '4px 8px', fontSize: '9px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'ui-monospace,monospace', fontWeight: 'bold' });
    paint(); b.addEventListener('click', () => { handler(b); paint(); }); b._repaint = paint; return b; };
  const mkSlider = (label, min, max, step, val, onInput) => { const wrap = document.createElement('div'); Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: '#9cf', fontFamily: 'ui-monospace,monospace' });
    const lbl = document.createElement('span'); const _txt = (v) => `${label} ${(+v).toFixed(2)}`; lbl.textContent = _txt(val);
    const s = document.createElement('input'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = val; s.style.width = '90px';
    s.addEventListener('input', () => { lbl.textContent = _txt(s.value); onInput(+s.value); });
    const setVal = (v) => { if (document.activeElement === s) return; if (+s.value !== +v) s.value = v; lbl.textContent = _txt(v); };
    wrap.appendChild(lbl); wrap.appendChild(s); return { wrap, input: s, setVal }; };

  return (world, peerId, containerId, sendCursorMove, _injectEvent) => {
    const injectEvent = _injectEvent ? (ev) => setTimeout(() => _injectEvent(ev), 0) : undefined;
    if (!document.getElementById('medium-u1-wrap')) { const wrap = document.createElement('div'); wrap.id = 'medium-u1-wrap';
      Object.assign(wrap.style, { display: 'flex', alignItems: 'stretch', height: '100vh', width: '100%', overflow: 'hidden' }); document.body.appendChild(wrap); }
    const root = document.createElement('div'); root.id = containerId;
    Object.assign(root.style, { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px', background: '#000', color: '#9cf', fontFamily: 'ui-monospace,monospace', flex: '1', minWidth: '0', minHeight: '0', boxSizing: 'border-box', overflow: 'hidden' });
    document.getElementById('medium-u1-wrap').appendChild(root);
    const hdr = document.createElement('div'); Object.assign(hdr.style, { fontSize: '9px', color: '#6ad', padding: '1px 4px', borderBottom: '1px solid #234' });
    const bar1 = document.createElement('div'); Object.assign(bar1.style, { display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' });
    const bar2 = document.createElement('div'); Object.assign(bar2.style, { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '9px', color: '#9cf' });   // the REGISTER strip (per-slot: refAmp β, attPhase, ω)
    const rowEl = document.createElement('div'); Object.assign(rowEl.style, { display: 'flex', gap: '6px', flex: '1', minHeight: '0' });
    root.appendChild(hdr); root.appendChild(bar1); root.appendChild(bar2); root.appendChild(rowEl);
    const inCell = mkCell('ψ_in — the live IFS source', '#6ad'), outCell = mkCell('ψ_out — W slot (transport chase)', '#9cf');
    rowEl.appendChild(outCell.wrap);   // source canvas (inCell) HIDDEN — the slot/perception view is the medium's face; inCell kept as a live off-DOM render target for _E.psiSource

    // ── THE EXTRACTED SUBSTRATE + THE SLOT BANK ──
    let _gpu = null, _gpuReady = false, _gpuCanvas = null;
    const _E = makeSolitonEngine({ gpu: () => _gpu, GRID, N_CELLS, DT, stepsPerPhase: STEPS_PER_PHASE });
    const _stepClk = makeStepClock({ stepsPerPhase: STEPS_PER_PHASE });
    const _bank = makeObserverBank(4), _lensOp = _bank.ops;
    const _K = makeCouplingStore();
    const _sb = makeSlotBank({ bank: _bank, engine: _E });   // W (regenerable) + V/P (plate)
    const W = _sb.byName('W'), V = _sb.byName('V');
    let _driveMode = 'transport', _lensObj = 'letterA', _objExtras = {};   // a makeProbeField object (the cube path needs _cubeField — S5+); letterA/ring/point are the regenerable-att objects
    let _solSeeded = false, _solLogBar = -1, _solE0 = -1;
    let _objOrbTheta = 0, _lastTgtX = NaN, _lastTgtY = NaN;   // last commanded transport target (virtGo only on CHANGE — re-arming every frame freezes the chase)
    let _muxOn = false;   // ⧉mux time-share (S7+); OFF (S6) → V runs in a parallel drive block (nSl=1 for W's clock)
    let _regTraceOn = true, _regTraceLast = -1;   // [DET] trace ON BY DEFAULT (catch the first fork without enabling) — mu1.regTrace(false) to silence
    let _joinBurstLog = false;   // armed on restore → logs the joiner's FIRST driven frame (todo/target) to see if it bursts the backlog
    let _mirLogBar = -1;         // [MIRROR] bar-cadence log cursor
    const _mirVerbQ = [];
    let _mirRegion = null, _mirRegionName = '';   // REGIONAL WITNESS (descent rung 2): peer-LOCAL region — this tab's mirror integrates only R; outside = the register's declaration (no peer exchange; the reflector untouched)        // ⌀PDE MIRROR-SOURCED VERBS: {mode, amp, k, dop, gx, gy, bw} — REGISTER context snapshotted at the DRAIN step (abstract loop, shared-exact), FIELD bytes read in the MIRROR loop at the SAME k
    // ── THE JOIN-LAG BISECTOR (mu1.lagTrace — the driveTrace method applied to the old two-peer freeze): a
    //    peer-local per-second trace separating the THREE possible layers, since the bug predates this app
    //    (old-medium era) and lives in what both share. Read the flag it prints:
    //      clock× < 1     → CLOCK DELIVERY degraded (reflector event loop / shared-socket head-of-line / ws) —
    //                       the world clock n.time is arriving slowly; NOT this peer's compute.
    //      frame avg high → LOCAL COMPUTE (this peer's own frame cost grew — GPU/JS work per frame).
    //      todoMax bursts → BURSTY BACKLOG (clock arrives in clumps → whole-quanta gating bursts — the §7.44 class).
    //    Run on BOTH peers, note 10s of baseline, join, compare which signature fires on which peer.
    let _lagOn = false; const _lag = { frames: 0, ms: 0, msMax: 0, todoMax: 0, wall0: 0, clock0: 0, steps0: 0 };
    const _lagTick = (t0, todo, n) => { const now = performance.now();
      if (!_lag.wall0) { _lag.wall0 = now; _lag.clock0 = n.time ?? 0; _lag.steps0 = _E.solSteps; return; }
      const dtm = t0 ? now - t0 : 0;
      _lag.frames++; _lag.ms += dtm; if (dtm > _lag.msMax) _lag.msMax = dtm; if (todo > _lag.todoMax) _lag.todoMax = todo;
      if (now - _lag.wall0 >= 1000) { const w = (now - _lag.wall0) / 1000;
        const ck = ((n.time ?? 0) - _lag.clock0) / w, sps = (_E.solSteps - _lag.steps0) / w, avg = _lag.frames ? _lag.ms / _lag.frames : 0;
        if (!_lag.ckBase) _lag.ckBase = ck;   // n.time is WORLD-UNITS (not seconds) — judge delivery vs this peer's OWN baseline
        console.log(`[LAG] fps=${(_lag.frames / w).toFixed(1)} · frame avg=${avg.toFixed(1)}ms max=${_lag.msMax.toFixed(0)}ms · clock×=${ck.toFixed(3)} (baseline ${_lag.ckBase.toFixed(2)}; world-units/s) · steps/s=${sps.toFixed(1)} (demand ≈ ${(ck * 19 * _MON_RATE / ((_stepClk.rate || 1))).toFixed(0)}) · todoMax=${_lag.todoMax} → ${ck < 0.6 * _lag.ckBase ? '⚠ CLOCK DELIVERY (reflector/ws layer — not this peer)' : avg > 20 ? '⚠ LOCAL COMPUTE (this peer\'s frame cost)' : _lag.todoMax > 200 ? '⚠ BURSTY BACKLOG (clock clumps → whole-quanta bursts)' : 'healthy'}`);
        _lag.frames = 0; _lag.ms = 0; _lag.msMax = 0; _lag.todoMax = 0; _lag.wall0 = now; _lag.clock0 = n.time ?? 0; _lag.steps0 = _E.solSteps; } };
    let _autoCompN = 0, _autoCompLog = 0;   // ⌀PDE CONTINUOUS COMPILATION: every N shared bars the mirror re-compiles W's envelope (0 = off; replicated via the autoc verb)
    // WORLD TEMPO (replicated 'tempo' verb, drained at the shared step): the proper-time DIVISOR. The §7.44 law
    // generalized — a PERMANENT supply<demand deficit (e.g., two tabs on ONE GPU: measured 266→215 steps/s vs a
    // fixed 268 demand) makes the backlog spiral to the cap (5s frames). tempo=2 halves demand at a SHARED step on
    // every peer (rides syncClockRate: rate = nSl·tempo, stamped startSteps stay consistent) → the world runs slower
    // but SMOOTHLY, byte-identically. The honest response to scarcity: dilate matter's time, never drop its steps.
    let _tempoDiv = 1;
    // ── BOOT DEFAULT — THE CLOSED REGISTER (⌀PDE + mirror, W-routed): a FRESH LEADER runs classic physics only as
    //    the COMPILER PASS (seed → dress → lock), then auto-fires the close pair ONCE (~8 bars in). Joiners never
    //    fire — the snapshot carries the world's mode. One-shot: any close (auto or manual) disarms it, so a later
    //    mode:physics stays physics. mu1.autoClose(false) before the trigger keeps classic as this world's default.
    let _autoClose = true, _bootSeedBar = -1;
    // xatt — EXACT SPECTRAL ATTRACTOR (replicated toggle): A built by spectralShift (unitary at fractional offsets;
    // the bilinear half-pixel loss gone) + exact U(1) rotation. Changes the PIN TARGET → replicated so every peer's
    // physics flips at the same shared step. Default OFF (the classic bilinear A is the verified reference); flip
    // live with mu1.exactAtt(true) and watch lock→A — the oracle protocol for a physics-affecting swap.
    let _xattOn = false;
    const _xattBuild = (op, gx, gy, base) => { const sh = spectralShift(base, gx, gy, GRID);
      const ph = lensU1.angle(op); if (!ph) return sh;
      const c = Math.cos(ph), sn = Math.sin(ph);
      for (let j = 0; j < sh.length; j += 2) { const r = sh[j] * c - sh[j + 1] * sn; sh[j + 1] = sh[j] * sn + sh[j + 1] * c; sh[j] = r; }
      return sh; };
    // ── AUTO-TEMPO GOVERNOR (default ON — the tempo fix incorporated, costing neither determinism nor speed):
    //    MEASUREMENT is peer-local (the spiral signature: a large backlog that KEEPS GROWING across seconds);
    //    ACTUATION is the replicated 'tempo' verb at a shared step — concurrent proposals from several peers are
    //    idempotent (same _tempoDiv×2 from the same replicated state; the reducer last-wins). RAISE fast (≥4s of
    //    growing deficit → ÷2·current), LOWER cautiously (≥25s of full headroom → probe back up; if a lower recently
    //    preceded a raise, the next probe waits 90s — flap guard). Zero per-step cost; mu1.autoTempo(false) disables.
    let _autoTempoOn = true; const _at = { sec0: 0, bMax: 0, bPrev: 0, defMs: 0, headMs: 0, todoMax: 0, coolUntil: 0, lastLowerAt: 0 };
    const _autoTempoTick = (todo) => { if (!_autoTempoOn || !_E.solInit) return;
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (todo > _at.todoMax) _at.todoMax = todo;
      // sample the backlog EVERY FRAME and keep the per-window MAX: the IFS world clock OSCILLATES (n.direction
      // back-swing ⇒ instantaneous backlog reads 0) — a boundary-sampled b reset the deficit counter on every
      // back-swing and the governor NEVER FIRED (live-caught; same lesson as the drive's monDir gate). The
      // forward-phase PEAK is the honest backlog observable.
      const bNow = Math.max(0, (_E.monDir > 0 ? _stepClk.target(_E.monClock) : 0) - _E.solSteps);
      if (bNow > _at.bMax) _at.bMax = bNow;
      if (!_at.sec0) { _at.sec0 = now; return; }
      const span = now - _at.sec0; if (span < 1000) return;
      // TIME-based accumulation (not count-based): deep-spiral frames run 2–5s, so one evaluation must carry its
      // full duration — a 4-count threshold would have taken ~20s of spiral to trip; 4000ms trips in 1–2 frames.
      const growing = _at.bMax > _at.bPrev + 30 && _at.bMax > 300;
      _at.defMs = growing ? _at.defMs + span : 0;
      _at.headMs = (_at.bMax < 21 && _at.todoMax <= 2 * Q) ? _at.headMs + span : 0;
      if (now > _at.coolUntil) {
        if (_at.defMs >= 4000 && _tempoDiv < 8) { const nd = Math.min(8, _tempoDiv * 2);
          console.log(`[TEMPO-AUTO] sustained deficit (peak backlog ${_at.bMax}, growing ${(_at.defMs / 1000).toFixed(1)}s) → proposing tempo ÷${nd} (replicated — lands at a shared step on every peer)`);
          injectEvent?.({ type: 'mediumVirt', mode: 'tempo', amp: nd }); _at.coolUntil = now + 8000; _at.defMs = 0; }
        else if (_tempoDiv > 1 && _at.headMs >= ((now - _at.lastLowerAt) < 60000 ? 90000 : 25000)) { const nd = Math.max(1, _tempoDiv >> 1);
          console.log(`[TEMPO-AUTO] sustained headroom (${(_at.headMs / 1000).toFixed(0)}s) → probing recovery: tempo ÷${nd}`);
          injectEvent?.({ type: 'mediumVirt', mode: 'tempo', amp: nd }); _at.coolUntil = now + 10000; _at.lastLowerAt = now; _at.headMs = 0; }
      }
      _at.bPrev = _at.bMax; _at.bMax = 0; _at.todoMax = 0; _at.sec0 = now; };
    // FRAME-LOCK display (LOCAL dial): render the state AS OF THE LAST SHARED BAR instead of the peer-local frame
    // end. Frames are peer-local EVENTS — wall-clock-identical frames don't exist — but with this on, every image a
    // peer displays is a member of ONE shared sequence (identical film, ≤1 bar wall-time offset between peers).
    let _frameLock = false, _frameLockGrid = 21, _dispW = null, _dispV = null, _dispWk = -1, _dispVk = -1;   // grid must be a multiple of Q (captures live in the Q-block); the displayed index k is STAMPED on the label — identical index ⇒ identical pixels (post-hoc alignable at full granularity)
    let _lastPaintSig = '';   // SUBTICK-DRIVEN PAINT: the last painted shared-frame signature — with frameLock on, the canvas repaints ONLY when a NEW boundary frame exists (paint content AND order = pure fns of shared time; rAF becomes just the polling loop)
    let _joinTraced = false;   // one-shot [MU1-JOINTRACE] guard
    const _SNAP_GRACE = 30;   // ready-frames a JOINER holds self-seeding to wait for the WS field snapshot (~1.5s at 20fps; normally lands <10). The "seed in snapshot" join-stability fix — without it a joiner racing ahead self-seeds → permanent desync until a lucky reload.
    let _joinAnchor = false;   // set on restore; on the first driven frame, decide whether the join backlog needs easing (c0 kept verbatim — see the drive)
    let _joinEaseN = 0;   // frames-remaining to EASE a big join backlog (cap todo/frame) — c0 UNCHANGED so stamped kernel/shift startSteps stay identical → solH byte-identical, lag spread over frames
    // ── THE IFS-KERNEL SHARED-STEP SWAP (the root fork fix, ported from the oracle §kernelQueue). The IFS fractal CLOCK
    //    recomputes the ring kernel mid-run (cachedRadiiVersion bumps on a real change). stepEye() propagates the soliton
    //    THROUGH _ringTex — so the kernel is a per-STEP physics input. Applying setRings at the peer-local FRAME (the old
    //    line-380 bug, keyed on genomeVer) meant two peers stepped through DIFFERENT kernels between the same solSteps →
    //    the field forked at the very first step while regH (which doesn't hash the ring) stayed identical. THE FIX: stage
    //    each kernel change at its SHARED start step = floor((cachedRadiiTime·MON_RATE − c0)·spp/rate) and apply it INSIDE
    //    the drive loop at that exact step (field preserved across the swap). Pure fn of shared state → byte-identical. ──
    let _pendKern = [];   // [{ startStep, r, w, o, ver }] staged kernel swaps, applied at their shared step in the drive loop
    const _kernApplied = [];   // per-frame [{ atStep, r, w, o }] the kernel swaps W's loop applied → V's loop replays them at the SAME steps (the ring is global _ringTex; V steps through it too)
    const _attApplied = [];    // per-frame [{ atStep, gx, gy }] W's ATTRACTOR schedule (frame-start pose + every leash advance) — the MIRROR drive replays the same att at the same shared steps (movAtt is a pure register fn → deterministic)
    const _kernStep = (t) => Math.floor((t * _MON_RATE - _stepClk.c0) * STEPS_PER_PHASE / (_stepClk.rate || 1));
    let _solH = '--------', _solHStep = -1;   // solH = the FIELD hash captured at the last SHARED Q-boundary step (both peers pass through it identically → comparable across peers, unlike a frame-end hash)
    let _detEvery = 1;   // [DET] log every Q-boundary (7 steps) BY DEFAULT — fine enough to catch the first fork; regTrace(true,N) to coarsen
    // THE PIN STRENGTH (β) — the injection-lock stiffness (finding_pin_injection_lock). A stronger β makes the shared
    // attractor A dominate the field faster → lock→A tightens → each peer's ψ ≈ A ≈ every peer's ψ (images converge,
    // no field exchange). Tunable to find where the lock is tight without over-pinning (the original capped ~0.45).
    // LOCAL/peer-independent by default (a render-quality dial, not replicated) — but see mu1.pin() to sync it.
    let _pinBeta = _TRANSPORT_BETA;
    // THE MEASURED WEAR CONSTANTS (2026-07-18, wearTest/wearGo — Law 7 quantified): betaStar = the capture
    // threshold (the Casimir-flow İ zero-crossing; independently matches the GR-probe locking threshold ≈0.1).
    // Past β* transport cost is ~LINEAR in speed (the ride: ×2.5 cost for ×3 vpx at β=0.6); below β* the walk
    // SHEDS instead of carrying (~50–380× dearer). Telemetry constants: they inform grip verdicts and logs —
    // they do NOT silently retune the drive (a replicated calibration verb is the honest path to that).
    const _WEAR = { betaStar: 0.15 };
    // ── ⟲COEVO — THE HONEST ℂ* EINSTEIN LOOP ("matter tells geometry how far it may go"). The oracle gated the leash on
    //    ampCorr(FIELD, att) — real back-reaction but a FIELD read (peer-local → forked solH) AND a partial self-fool
    //    (it reads the operator's own product; [[gr-medium-conclusions]] §4: "any closed loop that includes the operator's
    //    own output self-fools; only globally-normalized quality observables are honest"). THE ℂ* FORM: gate on a GAIN
    //    (energy) observable instead — matter's ENERGY STATE throttles its own transport, sensor = a REGISTER coordinate.
    //    TWO GOVERNANCES (the pin/unpin switch made first-class):
    //      • PINNED (default, lensU1 slice, gain≡1): gainOf = leashGainPredicted — the DESCRIPTOR-predicted lag (a pure
    //        fn of leash state, no field) → gx/gy stays exact → in regH → REPLAY-SAFE. Back-reaction ON, determinism kept.
    //      • UNPINNED (lensC1, gain free): gainOf = the FIELD-measured energy ratio (true matter energy back-reaction —
    //        the momentum channel opens, the honest v* becomes reachable) at the cost of a field read (determinism rides
    //        on the f32 Q-boundary quantization holding). An explicit, per-run choice — mu1.unpin(true).
    let _coevoOn = false;   // the Einstein loop (gain-gated). OFF by default — the baseline is the open-loop DOP replay
                            // (the target never waits for matter); mu1.coevo(true) opts INTO the back-reaction. Default-off
                            // keeps the plain-transport feel + the pure replay as the reference, and makes the loop a
                            // deliberate, observable choice rather than ambient behavior.
    let _unpinned = false;  // false = lensU1 (pinned, descriptor-predicted gain) · true = lensC1 (field-measured gain)
    let _coevoG = 1;        // the last gain observable (telemetry: 1 = matter kept up, →0 = lagging → target throttled)
    const _COEVO_MAXLAG = 4;   // px of target-lag at which the PINNED gain observable saturates to 0 (the target fully waits)
    const _VIRT_T = 16;   // hologram depth (steps): linear round-trip → near-exact lift (the pure-wave case)
    // the τ kernel (worldline clocks) — for the [RECALL-∠] aging readout (Δ∠ = ω·Δτ_W). Browser-loaded KWETau.
    const _tauK = (typeof globalThis !== 'undefined' && globalThis.KWETau) ? globalThis.KWETau({ monRate: _MON_RATE, stepsPerPhase: STEPS_PER_PHASE, flatL: 21 }) : null;
    // ── THE STAMPED-INPUT DRAIN (the general field-determinism law, finding_mux_determinism / gate-3): EVERY external
    //    input (slider, verb, mode) is applied at a SHARED STAMPED step, NOT "whenever this peer's frame reads the latest
    //    value" (that applies it at a peer-local step → the field forks whenever anyone drags a slider). Each replicated
    //    input carries a seq; the kernel STAMPS it (t → startStep = a pure fn of the shared clock); the drive loop DRAINS
    //    it at that exact shared step → both peers apply it at the identical step regardless of frame timing. This pull/
    //    cursor/drain/join pattern is FACTORED into medium-core's makeStampedInput (reusable by any KWE app) — shift and
    //    the register verbs are its consumers here; each is one .pull()/.drain() instead of the 4-block dance.
    const _siShift = makeStampedInput(_tauK, 'shift');   // stamped shift targets (n.shiftQueue → drained at the shared step)
    const _siReg = makeStampedInput(_tauK, 'reg');       // stamped register/holography verbs (refamp/aphase/lenstau/record/store/recall → drained at the shared step; they write _lensOp/birth slots, all in regH + the field)
    // apply a stamped medium verb at the shared step `k` (drained in the drive loop). record/store/recall BIRTH/BANK/LIFT
    // slots at the shared step (V's birth step must match across peers, else vKv diverges → V forks). Register verbs
    // (refamp/aphase/lenstau) mutate _lensOp at the shared step (in regH + fed to the field). All byte-identical across peers.
    const _applyRegVerb = (e, k) => { const si = SLOTN.indexOf(e.src || 'W');
      // ── ⌀PDE MEMORY-MAKING, REGISTER-SOURCED (the scene comes home): with the REGISTER ENGINE live, the
      //    field verbs read W.descBase DIRECTLY at the drain step — the register field IS the state at k,
      //    shared-exact on every peer, no mirror, no queue. Context + bytes both register-side; executors are
      //    CPU spectral legs; births land in P1 as 𝔸-slots (the homogeneous slot type: every slot = a trapped-
      //    hologram lens; W is merely the one the drive acts on). The mirror queue survives only as the legacy
      //    path for a mirror-without-engine state (shouldn't occur post-v7, but honesty over deadcode-pruning).
      if ((e.mode === 'record' || e.mode === 'recvia' || e.mode === 'store' || e.mode === 'recall' || e.mode === 'recallx') && W.desc) {
        const mv = { mode: e.mode === 'recvia' ? 'record' : e.mode, amp: e.amp || 0, k, si,
          dop: { ..._lensOp[0] }, gx: W.leash.state.gx, gy: W.leash.state.gy, bw: _tauK ? (_tauK.beatsOf('W') ?? 0) : 0 };
        if (W.descBase) { if (mv.mode === 'store') _storeFrom(mv, W.descBase);
          else if (mv.mode === 'recall' || mv.mode === 'recallx') _recallFrom(mv, W.descBase);
          else _recordFrom(mv, W.descBase);
          return; }
        if (V.born && V.mirror) { _mirVerbQ.push(mv); return; }
        console.log(`[MU1] ${e.mode} in ⌀PDE needs the register engine (no envelope yet) or a MIRROR — or use recall𝔸 (descriptor-only)`); return; }
      if (e.mode === 'record' || e.mode === 'recvia') { _recordV(e.amp || 0, k); return; }
      if (e.mode === 'store') { _storeMoment(k); return; }
      if (e.mode === 'recall') { _recallMoment(k); return; }
      if (e.mode === 'recallx') { _recallMoment(k, true); return; }   // shift-aware (crossCorrScan): finds+RELOCATES a moved moment
      if (e.mode === 'recalla') { _recallDop(k); return; }   // 𝔸-recall: the descriptor-only (abstractive) read — no field, no steps
      // ── mirror — TOGGLE the live PDE mirror (the classic verb, generalized; already whitelisted in the world).
      //    BIRTH: V = an independently integrated PDE copy of W, injection-locked to the REGISTER's attractor.
      //    Seed: field mode = W's shared f32 bytes; ⌀PDE = the BAR-EXACT register projection (no render frac —
      //    peer-identical). In ⌀PDE this returns the medium as a LIVE VIEW of the abstract model. Toggle OFF releases V.
      if (e.mode === 'mirror') {
        if (!V.mirror) {
          let seed = null;
          if (W.field) seed = Float64Array.from(W.field);
          else if (W.desc && W.descBase) { const dphi0 = lensU1.wrap(lensU1.angle(_lensOp[0]) - (W.descPhi0 || 0));
            const L0 = W.leash.state, ox0 = L0.gx - (W.descPos?.[0] ?? 0), oy0 = L0.gy - (W.descPos?.[1] ?? 0);
            try { seed = (ox0 || oy0) ? lensC1.apply({ mode: 'metric', phase: dphi0, beta: 1, omega: 0, prec: 0, gain: 1, tx: ox0, ty: oy0 }, W.descBase, GRID)
                                      : lensU1.apply({ mode: 'id', phase: dphi0, beta: 1, omega: 0, prec: 0 }, W.descBase, GRID); } catch (err) { seed = null; } }
          if (!seed) { console.log('[MIRROR] no seed (need W.field or an abstract-W envelope)'); return; }
          if (_E.ringCache && _gpu) _gpu.setRings(_E.ringCache.r, _E.ringCache.w, _E.ringCache.o);   // ⌀PDE bookkeeping never uploads — the mirror needs the real ring
          let e2 = 0; for (let j = 0; j < seed.length; j++) e2 += seed[j] * seed[j];
          V.field = seed; V.e0 = e2 || 1; V.att = null; V.hold = false; V.desc = false; V.descBase = null; V.mirror = true; V.born = true; V.kv = 0; V.leash.release();
          console.log(`[MIRROR] BORN @step=${k} — V = live PDE injection-locked to the register (${W.desc ? '⌀PDE: the medium returns as a VIEW of the abstract model' : 'field mode: the Lyapunov mirror'}) · watch [MIRROR] lock→A`);
        } else { V.mirror = false; V.born = false; V.field = null; console.log(`[MIRROR] OFF @step=${k} — V released`); }
        return; }
      // ── autoc — CONTINUOUS COMPILATION (the third setting of the compile knob: once=wabs · always=mirror-view ·
      //    every-N=this). amp = the period in bars (0 = off). Requires ⌀PDE + a live mirror: every Nth shared bar the
      //    mirror RE-COMPILES W's envelope, so the register's declaration tracks living physics with a stated
      //    staleness bound (≤N bars) while the canvas keeps rendering ONLY the register projection.
      if (e.mode === 'tempo') { _tempoDiv = Math.max(1, Math.min(8, e.amp | 0));
        console.log(`[TEMPO] world proper-time divisor → ${_tempoDiv} @step=${k} (demand ÷${_tempoDiv}; the rate flip lands via syncClockRate at the next frame — shared, byte-identical)`); return; }
      if (e.mode === 'autoc') { _autoCompN = e.amp | 0;
        console.log(`[AUTOC] ${_autoCompN > 0 ? `ON — recompile W's envelope from the mirror every ${_autoCompN} bars${!(V.born && V.mirror) ? ' (waiting: needs a live MIRROR)' : ''}${!W.desc ? ' (waiting: needs ⌀PDE — W must be abstract)' : ''}` : 'OFF'} @step=${k}`); return; }
      if (e.mode === 'descgo') { const s = (si >= 0) ? _sb.slots[si] : null;   // 𝔸-TRANSPORT: command the desc slot's leash (the ONE leash law, descriptor-only branch — movement as pure register arithmetic, 0 grid steps; the render translates the dressed base)
        if (s && s.desc) { s.virtGo(e.gx || 0, e.gy || 0); console.log(`[MU1-𝔸GO] ${s.name} → (${(e.gx || 0).toFixed(1)},${(e.gy || 0).toFixed(1)}) @step=${_E.solSteps} — descriptor transport`); } return; }
      // ── wabs — ⌀PDE, THE META-CIRCULAR CLOSURE, both doors (replicated, drained at the shared step k): ──
      //  amp=1 CLOSE: compile EVERY born field slot into its 𝔸 form (envelope + descriptor). W's envelope reads the
      //    LIVE GPU buffer (the field at exactly step k — shared bytes under the chunking discipline); other slots
      //    compile from their canonical stores. From the next frame the drive is pure register arithmetic (⌀PDE).
      //  amp=0 MATERIALIZE: project each 𝔸-slot back into a field — BAR-EXACT (register state only, NO render frac:
      //    frac is a frame-local render quantity; folding it in would fork the materialized field across peers) —
      //    and hand it to the medium. The PDE resumes FROM the descriptor state: if the abstraction was faithful the
      //    soliton simply CONTINUES and lock→A recovers ≈1. That resumption is the oracle measurement, per no-tricks.
      if (e.mode === 'wabs') {
        if (e.amp) {
          for (let i2 = 0; i2 < _sb.slots.length; i2++) { const s2 = _sb.slots[i2]; if (!s2.born || s2.desc) continue;
            let env = (i2 === 0 && _gpu) ? _gpu.readEyePsi() : (s2.field ? Float64Array.from(s2.field) : null);
            if (!env) continue;
            env = Float64Array.from(Float32Array.from(env));   // f32-lattice at capture: the envelope is DYNAMICAL now — a joiner (f32 wire) must hold the leader's exact bytes
            s2.descBase = env; s2.descPhi0 = lensU1.angle(_lensOp[i2]);
            if (i2 === 0) { s2.descHold = Float64Array.from(env); s2.descPosCap = [s2.leash.state.gx, s2.leash.state.gy];
              let eC = 0; for (let j = 0; j < env.length; j++) eC += env[j] * env[j]; s2.descE0 = eC || 1; }   // the REGISTER ENGINE's cap level (the state's own energy at close) + capture pose
            s2.descPos = [s2.leash.state.gx, s2.leash.state.gy]; s2.descObj = _lensObj; s2.descBar = Math.floor(k / 21); s2.descCapBar = Math.floor(k / 21);   // capture stamp (telemetry: declaration age in defTest; descBar stays the aging cursor)
            s2.desc = true; s2.field = null; s2.att = null; s2.hold = false; s2.mirror = false;
            if (i2 === 0) { s2.sl2 = _mkSl2(env); if (s2.sl2) console.log(`[SL2] register-resident tier CAPTURED at close: V=${s2.sl2.V.toExponential(3)} V̈=${s2.sl2.vdd.toExponential(3)} I=${s2.sl2.I.toExponential(3)} (kv=${s2.sl2.kv}) — the sl(2) charges live in regH-side state now; the witness only verifies`); } }   // a compiled slot can't stay a mirror (no field to integrate)
          _E.psiLensed = null; _autoClose = false;   // any close (auto or manual) disarms the boot trigger
          console.log(`[MU1-⌀PDE] REGISTER CLOSED @step=${k} — every slot = descriptor + compiled envelope; 0 grid steps/frame from here. The medium is demoted to compiler+oracle. mu1.abstract(false) = the door back.`);
        } else {
          for (let i2 = 0; i2 < _sb.slots.length; i2++) { const s2 = _sb.slots[i2]; if (!s2.desc) continue;
            s2.desc = false; if (!s2.descBase) continue;
            const dphi = lensU1.wrap(lensU1.angle(_lensOp[i2]) - (s2.descPhi0 || 0));
            const L2 = s2.leash.state, ox2 = L2.gx - (s2.descPos?.[0] ?? 0), oy2 = L2.gy - (s2.descPos?.[1] ?? 0);
            let f = null; try { f = (ox2 || oy2) ? lensC1.apply({ mode: 'metric', phase: dphi, beta: 1, omega: 0, prec: 0, gain: 1, tx: ox2, ty: oy2 }, s2.descBase, GRID)
                                                 : lensU1.apply({ mode: 'id', phase: dphi, beta: 1, omega: 0, prec: 0 }, s2.descBase, GRID); } catch (err) { f = null; }
            if (!f) { s2.descBase = null; continue; }
            s2.field = Float64Array.from(f); let e2 = 0; for (let j = 0; j < f.length; j++) e2 += f[j] * f[j]; s2.e0 = e2 || 1;
            if (i2 > 0) { s2.att = Float64Array.from(s2.descBase); s2.hold = true; }   // plate slots resume held toward their envelope
            s2.descBase = null; s2.descPhi0 = 0; s2.sl2 = null; s2.descHold = null; s2.descPosCap = null; s2.descE0 = null; s2.descDisp = null; s2.descLive = false; s2.descAtt = null; s2.descAttG = null; }   // the field resumes → the register tier retires (the witness IS the state again)
          if (W.field) _E.psiLensed = W.field;
          if (_E.ringCache && _gpu) _gpu.setRings(_E.ringCache.r, _E.ringCache.w, _E.ringCache.o);   // the abstract span only BOOKKEPT kernel versions — upload the current ring before the PDE resumes
          console.log(`[MU1-⌀PDE] MATERIALIZED @step=${k} — the register projected back into the medium; the PDE resumes FROM the descriptor state. THE ORACLE TEST: if the abstraction was faithful, lock→A recovers ≈1 and the soliton simply continues (watch [MU1:transport] lock).`);
        }
        return; }
      if (e.mode === 'refamp') { if (si >= 0) { _lensOp[si].beta = (typeof e.amp === 'number') ? e.amp : 1; console.log(`[MU1] refAmp ${e.src} β=${_lensOp[si].beta.toFixed(2)} @step=${_E.solSteps}`); } }
      else if (e.mode === 'lenstau') { const w = e.amp || 0; for (const o of _lensOp) o.omega = w; console.log(`[MU1] lensTau ω=${w.toFixed(3)} @step=${_E.solSteps}`); }
      // lensset (the extended readOp components): here the MOMENTUM tilt kx/ky — the linOp k·x term. On an 𝔸-slot
      // this makes the phase fronts FLOW through the envelope at ω/|k| (the travelling wave, per-pixel in the view
      // shader). kx/ky are in opNums → regH: a replicated register write like every other verb.
      else if (e.mode === 'xatt') { _xattOn = !!e.amp;
        console.log(`[MU1] exact-𝔸TT ${_xattOn ? 'ON — spectralShift attractor (unitary at fractional offsets; bilinear half-pixel loss gone)' : 'OFF — classic bilinear (the verified reference)'} @step=${_E.solSteps} — the pin target flips at this shared step on EVERY peer`); }
      else if (e.mode === 'lensset') { if (si >= 0) { if (typeof e.kx === 'number') _lensOp[si].kx = e.kx; if (typeof e.ky === 'number') _lensOp[si].ky = e.ky;
        console.log(`[MU1] lensset ${e.src} k=(${(_lensOp[si].kx || 0).toFixed(3)},${(_lensOp[si].ky || 0).toFixed(3)}) rad/cell @step=${_E.solSteps} — with ω≠0 the fronts flow at ω/|k| cell/bar`); } }
      else if (e.mode === 'aphase') { if (si >= 0) { _lensOp[si].phase = ((_lensOp[si].phase + (e.amp || 0)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (si === 1 && V.att) { const c = Math.cos(e.amp || 0), s = Math.sin(e.amp || 0), r = new Float64Array(V.att.length);   // V/P: rotate the STORED att too (the register write lands in the field bytes)
          for (let j = 0; j < V.att.length; j += 2) { r[j] = V.att[j] * c - V.att[j + 1] * s; r[j + 1] = V.att[j] * s + V.att[j + 1] * c; } V.att = r; }
        console.log(`[MU1] aphase ${e.src} → ∠${_lensOp[si].phase.toFixed(3)} @step=${_E.solSteps}`); } }
      // ⟲COEVO / UNPIN — REPLICATED, stamped like every other register verb. THEY MUST BE: both gate the leash advance,
      // and gx/gy is IN regH — if one peer ran coevo-on and the other coevo-off, gx/gy (hence regH AND the field) would
      // fork. Flipping them at the SHARED step keeps every peer on the same physics. (The governance choice is part of
      // the world's state, not a local render dial — unlike pin β, which only tunes this peer's image convergence.)
      else if (e.mode === 'edge') {
        // THE REGISTER KURAMOTO/XY MACHINE, U1-native (the old kApply was a stub — never ported): edge(a,b,±κ)
        // couples slot PHASES θ_i = ∠(_lensOp[i]) directly — replicated register content (regH covers phases AND
        // _K.edge), applied at shared bars in the abstract drive. MORE abstract than the field version: the XY
        // dynamics runs on the descriptors themselves; 𝔸 declarations show it (∠φ color), MAXCUT reads off the
        // sign pattern of phase differences (the register-experiment laws: answer = DIFFERENCES, Law 2/5).
        const a = Math.max(0, Math.min(3, Math.round(e.gx || 0))), b = Math.max(0, Math.min(3, Math.round(e.gy || 0)));
        const kap = Math.max(-0.5, Math.min(0.5, +e.leak || 0));
        if (a !== b) { if (!_K.edge) _K.edge = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
          _K.edge[a][b] = kap; _K.edge[b][a] = kap;
          console.log(`[MU1-EDGE] ${SLOTN[a]}⇄${SLOTN[b]} κ=${kap.toFixed(2)} @step=${k} — XY coupling on the REGISTER phases (κ>0 align, κ<0 anti-align; watch [KUR])`); }
        return; }
      else if (e.mode === 'coevo') { _coevoOn = !!e.amp; console.log(`[MU1] ⟲coevo ${_coevoOn ? 'ON' : 'OFF'} @step=${_E.solSteps} — the Einstein loop (matter throttles its own transport)`); }
      else if (e.mode === 'unpin') { _unpinned = !!e.amp; for (const o of _lensOp) o.gain = 1;   // re-pin resets gain to the U(1) slice; unpin lets it live
        console.log(`[MU1] ${_unpinned ? 'UNPIN → lensC1 (gain FREE: the coevo gate reads TRUE field energy — honest matter back-reaction, momentum channel open; regH may fork)' : 'PIN → lensU1 (gain≡1: the coevo gate reads the descriptor-predicted lag — replay-safe)'} @step=${_E.solSteps}`); } };
    // (the shift + reg cursors are now owned by _siShift / _siReg — makeStampedInput; see the pull sites)
    // ── DUAL-LAYER HOLOGRAPHY (S6): a stored moment = BOTH plates. FIELD plate = the 128KB ψ (the IMAGE, via the GPU
    //    forward/backward round-trip). DESCRIPTOR plate = the slot's (M,O) = its readOp copy ≈ 6 floats (the register
    //    MOMENT). The demo's HEADLINE is their EQUIVALENCE: [RECALL-∠] = ω·Δτ from the field round-trip AND from a
    //    pure lensC1 compose on the descriptor — the field is the ground-truth ORACLE proving the cheap path faithful.
    const _plates = [];   // { p: fieldPlate, a: att, dop: descriptorPlate(readOp copy), bw: W-beats-at-record, k }
    const BANK_MAX = 8;
    // (the replicated-verb cursor is now _siReg.seen — makeStampedInput)

    // ── DOP-DRIVEN ATTRACTOR (the ℂ*-descriptor replay foundation, verified headless corr=1.0000): the attractor W
    //    chases is A = lensC1.apply(Op, ψ_base) — the observer's OWN operator applied to a DETERMINISTIC base object.
    //    ψ_base = makeProbeField(the object) at the ORIGIN, computed ONCE (byte-deterministic, no RNG/GPU). Op carries the
    //    leash translation (tx,ty)=(gx,gy) + the register phase. So A is a PURE FUNCTION OF THE EXACT DESCRIPTOR (Op is
    //    regH-identical across peers; ψ_base is deterministic) → A(k) is identical on every peer at every shared step →
    //    the drive op-sequence is byte-identical → REPLAY holds by construction (no field→descriptor feedback, no
    //    frame-scoping, no peer-local input to hunt). This is why solH matches: the attractor IS the shared descriptor,
    //    rendered. (Verified: lensC1.apply(Op{tx:gx,ty:gy}, ψ_base) === makeProbeField(gx,gy) to corr 1.0000 — the soliton
    //    behaves IDENTICALLY, the drive/β/self-focus are UNCHANGED, only the ATTRACTOR's source moved to the descriptor.)
    let _psiBase = null;   // the deterministic base object at the origin (computed once when the object is known)
    const _rebuildBase = () => { try { _psiBase = makeProbeField(_lensObj, GRID, { x0: 1, y0: 1, side: GRID - 2 }, { np: 8 }, _objExtras); } catch (e) { _psiBase = null; } };
    _rebuildBase();
    // ── 𝔸-PROJECTION (the frame-rate render of a DESCRIPTOR-ONLY slot): ψ̂ = lensC1.apply(Op_slot + the stored
    //    translation, ψ_base(obj)) — the slot's 6-float state RENDERED, recomputed each frame. CPU f64 (deterministic,
    //    same arithmetic tier as regH — deliberately NOT a GPU shader: GLSL sin/cos are driver-defined precision, the
    //    CPU compose is byte-identical on every peer), render-only, touches no GPU state. This is the "project the
    //    ansatz at frame rate" half of abstractive holography; _recallDop below is the "recall without simulating" half.
    const _baseCache = new Map();   // per-object ψ_base (the deterministic base wavefront; _psiBase stays W's own)
    const _psiBaseOf = (name) => { if (!_baseCache.has(name)) { try { _baseCache.set(name, makeProbeField(name, GRID, { x0: 1, y0: 1, side: GRID - 2 }, { np: 8 }, _objExtras)); } catch (e) { _baseCache.set(name, null); } } return _baseCache.get(name); };
    // _descPose(si) — THE 𝔸-SLOT'S POSE AT THE RENDER INSTANT, pure model arithmetic (CPU f64), shared by the CPU
    // projection (meters) and the GPU view (one law, two consumers):
    //  • dphi — the register phase: bar-exact ∠ + the fractional-bar ω·frac, frac = (float shared steps −
    //    descBar·21)/21, a pure fn of the SHARED clock (monClock/c0) → every peer computes the same instant
    //    identically; at the bar tick the register jumps +ω exactly as frac resets → CONTINUOUS rotation.
    //  • ox/oy — the leash displacement, with the descriptor-only leash law (sig=1, step=min(1,d) toward target)
    //    evaluated AT frac exactly (it is closed form — no prediction error): continuous 60fps motion, the
    //    register itself stays bar-exact (in regH).
    const _descPose = (si) => { const s = _sb.slots[si]; if (!s || !s.desc) return null;
      const fs = (_E.monClock - _stepClk.c0) * STEPS_PER_PHASE / (_stepClk.rate || 1);
      // frame-lock: frac=0 → the 𝔸 pose quantizes to the last shared bar (the register film becomes peer-identical
      // exactly, not just up to each peer's monClock sampling moment)
      const frac = _frameLock ? 0 : Math.max(0, Math.min(1, (fs - (s.descBar | 0) * 21) / 21));
      const dphi = lensU1.wrap(lensU1.angle(_lensOp[si]) - (s.descPhi0 || 0) + (_lensOp[si].omega || 0) * frac);
      const L = s.leash.state; let ox = L.gx - (s.descPos?.[0] ?? 0), oy = L.gy - (s.descPos?.[1] ?? 0);
      if (L.go) { const dx = L.tx - L.gx, dy = L.ty - L.gy, d = Math.hypot(dx, dy);
        if (d > 1e-9) { const st = Math.min(1, d) * frac; ox += (dx / d) * st; oy += (dy / d) * st; } }
      return { dphi, ox, oy }; };
    const _descProject = (si) => { const s = _sb.slots[si]; if (!s || !s.desc) return null;
      // TWO PROJECTION BASES:
      //  • DRESSED (preferred): descBase = the medium's OWN locked profile captured at store (plate w0) — the LIVING
      //    soliton's shape, already at its position. The op is then a PURE PHASE ROTATION by the AGING ONLY,
      //    Δ∠ = ∠now − ∠birth (rotating by the absolute register angle would double-count the store-time phase the
      //    field bytes already carry). The reconstruction looks like the living field because it IS the living field's
      //    recorded moment, transported in ω-time by the algebra — the holographic read, 0 steps.
      //  • PROBE (fallback, old plates without w0): ψ_base(obj) translated to the stored coords — the bare ansatz
      //    (shows the injected symbol; the visual gap vs DRESSED is exactly the medium's dressing).
      // (the pose — smooth ω-time phase + leash offset — is _descPose, shared by this CPU path and the GPU view)
      if (s.descBase) { const P = _descPose(si); if (!P) return null;
        try { return (P.ox || P.oy) ? lensC1.apply({ mode: 'metric', phase: P.dphi, beta: 1, omega: 0, prec: 0, gain: 1, tx: P.ox, ty: P.oy }, s.descBase, GRID)
                                    : lensU1.apply({ mode: 'id', phase: P.dphi, beta: 1, omega: 0, prec: 0 }, s.descBase, GRID); } catch (e) { return null; } }
      const base = _psiBaseOf(s.descObj || _lensObj); if (!base) return null;
      const op = { ..._lensOp[si], mode: 'metric', tx: s.descPos?.[0] ?? 0, ty: s.descPos?.[1] ?? 0 };
      try { return lensC1.apply(op, base, GRID); } catch (e) { return null; } };
    W.movAtt = (gx, gy) => { if (!_psiBase) _rebuildBase(); if (!_psiBase) return null;
      // Op = the W readOp's exact scalars + the leash translation. A pure translation (tx,ty)=(gx,gy) reproduces the moved
      // probe exactly; W's register phase rides via Op.phase (lensC1.apply rotates by it). Deterministic: pure fn of Op+base.
      const op = { ...W.readOp, mode: 'metric', tx: gx, ty: gy };
      try { return _xattOn ? _xattBuild(W.readOp, gx, gy, _psiBase) : lensC1.apply(op, _psiBase, GRID); } catch (e) { return null; } };

    // objorbit: the leash TARGET circles the shiftX/Y well (transport's chase on a circle — same virtGo, moving target)
    const _objOrbTarget = (baseX, baseY) => [baseX + _OBJORB_R * Math.cos(_objOrbTheta), baseY + _OBJORB_R * Math.sin(_objOrbTheta)];

    if (IFSGpu.isSupported()) { _gpuCanvas = document.createElement('canvas'); _gpuCanvas.width = GRID; _gpuCanvas.height = GRID;
      IFSGpu.create(_gpuCanvas, GRID).then(g => { _gpu = g; _gpuReady = true; if (typeof window !== 'undefined') window._mediumU1Gpu = _gpu; console.log('[MEDIUM-U1] IFSGpu ready'); })
        .catch(err => console.error('[MEDIUM-U1] IFSGpu init FAILED:', err)); }

    // ── the hologram render: the GPU's OWN hologram colormap (AMPLITUDE-dominant, phase as a secondary channel),
    //    drawn Y-FLIPPED (GL is bottom-up) — the same path the oracle uses (_drawL11). A hand-rolled CPU colormap
    //    both mis-oriented (top-down → 180° flip) and phase-dominated the image; renderEyeField is the honest one.
    const _VX0 = 1, _VY0 = 1, _VSIDE = GRID - 2;   // full-grid view
    const _GLOW = 3.0;
    const _peakSq = (a) => { let m = 1e-12; for (let j = 0; j < (a.length >> 1); j++) { const v = a[j * 2] * a[j * 2] + a[j * 2 + 1] * a[j * 2 + 1]; if (v > m) m = v; } return m; };
    const _blit = (cell) => {   // GPU canvas → the cell canvas (Y-flip: GL bottom-up), shared by both render paths
      const ctx = cell.ctx, cw = cell.canvas.width, ch = cell.canvas.height, cellp = Math.min(cw, ch) / _VSIDE, dw = _VSIDE * cellp, offx = (cw - dw) / 2, offy = (ch - dw) / 2;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(_gpuCanvas, _VX0, GRID - (_VY0 + _VSIDE), _VSIDE, _VSIDE, offx, offy, _VSIDE * cellp, _VSIDE * cellp); };
    // color dial (LOCAL display choice): 'auto' = amplitude for field views, phase for 𝔸 views (each mode's native
    // look) · 'amp' / '∠φ' force one colormap on BOTH paths. Both are honest renders of the same ψ — amplitude hides
    // global phase (real physics: intensity can't see it), phase shows the motion. No replicated state.
    let _colorMode = 'auto';
    const _ampFor = (isDesc) => _colorMode === 'auto' ? true : _colorMode === 'amp';   // auto = AMP in BOTH modes (user: the register view must default to the physical look; ∠φ stays one toggle away)
    const _drawField = (cell, f) => { if (!f || !_gpu || !_gpuCanvas) { cell.ctx.clearRect(0, 0, RW, RH); return; }
      const saved = _gpu.readEyePsi();                         // preserve the shared eye buffer
      const pk = _peakSq(f) * _GLOW;
      _gpu.setEyePsi(f);
      if (_ampFor(false)) _gpu.renderEyeField(pk);             // AMPLITUDE hologram colormap (peak-scaled → less glow)
      else _gpu.renderEyePhase(pk);                            // PHASE colormap (hue = arg ψ) — the same honest ψ, other channel
      _gpu.setEyePsi(saved);
      _blit(cell);
    };
    // ── THE 𝔸-SLOT GPU VIEW — the meta-circular split made literal: MODEL = the slot's ℂ* register (CPU f64, in
    //    regH, the only authority); VIEW = ONE fragment shader evaluating the linOp phasor B(x−off)·e^{i(φ+k·(x−c))}
    //    per pixel per frame (renderDescField). The envelope uploads ONCE per recall (setDescBase); each frame ships
    //    only ~7 uniforms — no eye-buffer round-trip, no readback, no PDE. The field "moves itself": with ω and k set
    //    the phase fronts flow through the envelope at ω/|k| (the travelling wave), transport glides via the leash
    //    law — all of it pure consequence of the register, none of it simulated, none of it faked.
    let _descTexKey = null, _descPeak = 1;   // which base is on the GPU + its peak (upload/measure once per recall)
    const _drawDesc = (cell, si) => { const s = _sb.slots[si]; if (!s?.descBase || !_gpu || !_gpuCanvas) return false;
      const P = _descPose(si); if (!P) return false;
      // display source = the BAR-GRID buffer when the register engine is live (descDisp — the shared film;
      // the live descBase is mid-bar at a peer-local frame end and would paint DIFFERENT steps on peers)
      const baseArr = s.descDisp || s.descBase;
      if (_descTexKey !== baseArr) { _gpu.setDescBase(baseArr); _descTexKey = baseArr; _descPeak = _peakSq(baseArr); }
      const op = _lensOp[si], px = (s.descPos?.[0] ?? 0), py = (s.descPos?.[1] ?? 0);
      _gpu.renderDescField({ ox: P.ox, oy: P.oy, cx: GRID / 2 + px + P.ox, cy: GRID / 2 + py + P.oy,
        kx: op.kx || 0, ky: op.ky || 0, phi: P.dphi, ampView: _ampFor(true) ? 1 : 0 }, _descPeak * _GLOW);
      _blit(cell); return true; };

    // ── SLOT VIEWS (S5): "eye/medium scopes" are re-derived as slot VIEWS. There is ONE view slot the observer looks
    //    at (default W = the world; select V/P to look at those). PERCEPTION = render the selected slot THROUGH its
    //    own readOp (lensU1.apply — the ψ_out = Op·ψ_in read primitive) when lensView is on; raw ψ otherwise. This
    //    dissolves the old two-scope UI: "which scope" becomes "which slot", and "the eye" is just viewing V. ──
    let _viewSlot = 0;                                       // which slot the outCell shows (0=W, 1=V, 2=P1, 3=P2)
    // view modes: 'raw' ψ · 'lens' ψ through the slot's readOp · 'desc' 𝔸 = the ℂ* DESCRIPTOR rendered (the same A the
    // pin chases — the register's PREDICTION of the slot, labeled as such, never passed off as the field). 𝔸 is the
    // visual form of lock→A: the raw and 𝔸 views converge exactly as lock→1. Local display choice, no replicated state.
    const _dials = { view: 'raw' };
    const _lensedView = (sl, f) => (_dials.view === 'lens' && f && (lensU1.angle(_lensOp[sl]) || _lensOp[sl].mode !== 'id')) ? lensU1.apply(_lensOp[sl], f, GRID) : f;   // render THROUGH the slot's readOp (metric/gauge = real transformed views, grid-exact)

    // ── S6: RECORD (births V) + STORE (banks a moment) + RECALL — the dual-layer holography verbs (peer-replicated
    //    via the reflector, applied at the shared drain step). record: freeze W → V's field (GPU round-trip) AND set
    //    V's descriptor phase — the DUAL plate born together. store: bank BOTH plates. recall: cue⊗bank → lift best +
    //    the [RECALL-∠] equivalence (field aging Δ∠ vs the descriptor-only ω·Δτ prediction — the headline). ──
    // ── THE SPECTRAL LEGS (gate D applied to the holography verbs): the ±T propagation runs REGISTER-SIDE via the
    //    diagonalized engine step (kernelPropagateSpectral, proven ≡ the GPU leapfrog at the f32 floor). The λ(k)
    //    grid is a DYNAMIC cache keyed on kernelVer: the fractal clock bumps the ring, but kernel swaps land at
    //    SHARED steps and the verbs drain at shared steps → at any drain, kernelVer (hence the grid) is identical
    //    on every peer; a bump just lazily recomputes one 128² symbol pass (~60ms, only when a verb actually fires
    //    on the new version). CONSEQUENCES: record/store/recall make ZERO GPU calls — pure CPU f64 on the shared
    //    f32 W.field ⇒ plate/lift bytes are byte-identical across peers BY CONSTRUCTION (stronger than the old GPU
    //    path), and the eye-buffer save/restore churn (the 31ms recordV stall) is gone.
    let _lamCache = { ver: -9999, lam: null };
    const _lambda = () => { const rc = _E.ringCache; if (!rc?.r?.length) return null;
      if (_lamCache.ver !== _E.kernelVer) _lamCache = { ver: _E.kernelVer, lam: kernelLambdaGrid(rc.r, rc.w, rc.o, GRID) };
      return _lamCache.lam; };
    const _specLeg = (f, T, dt) => { const lam = _lambda(); if (!lam || !f) return null;
      return kernelPropagateSpectral(f, null, null, null, { T, dt, G: GRID, lam }).field; };
    // the BAR-EXACT declaration of W (register state only — no render frac): the boundary source for a REGIONAL
    // witness and the seam-glue reference (same math as the mirror seed / materialize).
    const _declProject = () => { if (!W.desc || !W.descBase) return null;
      const dphi = lensU1.wrap(lensU1.angle(_lensOp[0]) - (W.descPhi0 || 0));
      const L0 = W.leash.state, ox = L0.gx - (W.descPos?.[0] ?? 0), oy = L0.gy - (W.descPos?.[1] ?? 0);
      try { return (ox || oy) ? lensC1.apply({ mode: 'metric', phase: dphi, beta: 1, omega: 0, prec: 0, gain: 1, tx: ox, ty: oy }, W.descBase, GRID)
                              : lensU1.apply({ mode: 'id', phase: dphi, beta: 1, omega: 0, prec: 0 }, W.descBase, GRID); } catch (e) { return null; } };
    // ── THE REGISTER ENGINE'S ONE-STEP KERNEL (shared by every LIVING slot): pin superpose (β replicated) →
    //    exact spectral linear step (gate D, λ-grid cache) → engine SPM phase → cap at the slot's own descE0 →
    //    f32 grain (the wire lattice = the original engine's grain). Pure fn of (slot state, shared step).
    //    FAST PATH (the GC-lag fix): the spectral call runs on a per-G scratch pool (reuse:true — zero
    //    allocation), and each slot keeps a ping-pong spare (s._eng) the result is copied into, fused with the
    //    SPM pass. Op ORDER is preserved exactly (superpose → linear → SPM → energy → cap → fround), so the
    //    bytes are identical to the allocating path — only the garbage is gone (~6 × 128 KB/step before).
    const _regStep1 = (s, att, bfac) => { const lamS = _lambda(); if (!lamS || !s.descBase || !s.descE0) return;
      const psi = s.descBase;
      if (att) { const b = 0.15 * (bfac || 1); for (let j = 0; j < psi.length; j++) psi[j] += b * att[j]; }
      const ev = kernelPropagateSpectral(psi, null, null, null, { T: 1, dt: DT, G: GRID, lam: lamS, reuse: true }).field;
      const nb = (s._eng && s._eng !== psi && s._eng.length === ev.length) ? s._eng : new Float64Array(ev.length);
      for (let j = 0; j < N_CELLS; j++) { const re = ev[j * 2], im = ev[j * 2 + 1], I2 = re * re + im * im;
        const th = _SOL_GAMMA * I2 / (1 + I2 / _SOL_ISAT) * DT, c = Math.cos(th), sn = Math.sin(th);
        nb[j * 2] = re * c - im * sn; nb[j * 2 + 1] = re * sn + im * c; }
      let e2 = 0; for (let j = 0; j < nb.length; j++) e2 += nb[j] * nb[j];
      const sc = Math.sqrt(s.descE0 / (e2 || 1)); if (sc < 1) for (let j = 0; j < nb.length; j++) nb[j] *= sc;
      for (let j = 0; j < nb.length; j++) nb[j] = Math.fround(nb[j]);
      s._engE = e2;   // pre-cap energy (pure fn of shared k) — the UNPINNED coevo gate's field reading in ⌀PDE
      s._eng = psi; s.descBase = nb; };
    // ── THE U1 SHARD EXECUTOR (rung 2 rewired to the register engine — the old path lived in the mirror
    //    loop and died with it): with mu1.region set and NO mirror running, W's engine step computes ONLY the
    //    region (regionStepX: bit-identical inside R by the light-cone margins, cost ∝ |R|), the outside stays
    //    as the peer's DECLARED boundary (frozen witness bytes). CONTRACT CONSEQUENCE, stated honestly: on a
    //    sharded peer the field returns to WITNESS status — eH becomes shard-scoped (tagged in [DET-⌀], not
    //    cross-comparable); regH remains the whole shared contract. The cap follows the rung-1 law: energy is
    //    the ONE GLOBAL datum (summed over the whole field), the scale touches only R (the outside is never
    //    renormalized — the GPU-shard scissor discipline, inherited).
    let _viewAllOn = false, _viewAllCache = { bar: -1, f: null };   // Σ VIEW: linear superposition of the slots' declarations — a labeled VIEW (slots do not interact); per-bar cached CPU composite
    let _shardRef = null, _shardLogBar = -1, _kurLogBar = -1, _shardActive = false, _shardEconKv = -9999, _shardEconOk = false, _shardEconInfo = null, _shardWarned = false;
    const _regStepRegion = (s, att, bfac, reg) => { const rc = _E.ringCache; if (!rc?.r?.length || !s.descBase || !s.descE0) return;
      const psi = s.descBase;
      if (att) { const b = 0.15 * (bfac || 1);
        for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2; psi[j] += b * att[j]; psi[j + 1] += b * att[j + 1]; } }
      const nb = (s._eng && s._eng !== psi && s._eng.length === psi.length) ? s._eng : new Float64Array(psi.length);
      regionStepX(psi, rc.r, rc.w, rc.o, DT, GRID, reg, { out: nb });
      for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2;
        const re = nb[j], im = nb[j + 1], I2 = re * re + im * im;
        const th = _SOL_GAMMA * I2 / (1 + I2 / _SOL_ISAT) * DT, c = Math.cos(th), sn = Math.sin(th);
        nb[j] = re * c - im * sn; nb[j + 1] = re * sn + im * c; }
      let e2 = 0; for (let j = 0; j < nb.length; j++) e2 += nb[j] * nb[j];
      const sc = Math.sqrt(s.descE0 / (e2 || 1));
      if (sc < 1) for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2; nb[j] *= sc; nb[j + 1] *= sc; }
      for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2; nb[j] = Math.fround(nb[j]); nb[j + 1] = Math.fround(nb[j + 1]); }
      s._eng = psi; s.descBase = nb; };
    // ── THE REGISTER-RESIDENT sl(2) TIER (the gate-F meta-circular rung): V and V̈ are INVARIANT under the
    //    anchors (translation + global phase), so they are pure functions of descBase + the stencil — REGISTER
    //    content. W.sl2 = {V, vdd, I, kv} is captured at every compile door (wabs/autoc), RE-KEYED lazily when
    //    kernelVer moves (the rekeyTest-validated law: same envelope, new stencil), and aged by the ARREST law
    //    (wearTest-measured: a held state is stationary in the invariant — İ_park ≈ −5e3 residual vs +8e5 free
    //    slide). The witness verifies per bar in [VPT] (the lock→A analog for the sl(2) charges). Derived data:
    //    NOT in regH (a pure fn of hashed content + kernelVer adds fork surface, no information) and NOT in the
    //    snapshot (joiners lazily recompute — same bytes by construction).
    const _mkSl2 = (env) => { const rc = _E.ringCache; if (!rc?.r?.length || !env) return null;
      const sm = secondMomentTorus(env, GRID);
      const sE = Math.min(48, Math.max(2, Math.sqrt(sm.V / (2 * (sm.P || 1)))));
      const Dq = packetD(rc.r, rc.w, rc.o, sE);
      const spec = virialSpec(env, GRID, { gamma: _SOL_GAMMA, isat: _SOL_ISAT });   // ONE FFT, at the door — the spectrum IS compile content
      const vdd = virialRateX(null, rc.r, rc.w, rc.o, GRID, { gamma: _SOL_GAMMA, isat: _SOL_ISAT, Dq, spec });
      return { V: sm.V, vdd, I: vdd * sm.V, kv: _E.kernelVer, m: sm.m, spec, Dq }; };
    // RE-KEY = a pure stencil re-sum over the cached spectrum (FFT-free): V, m, spec are stencil-independent.
    const _sl2Rekey = (sl2) => { const rc = _E.ringCache; if (!rc?.r?.length || !sl2?.spec) return null;
      const vdd = virialRateX(null, rc.r, rc.w, rc.o, GRID, { gamma: _SOL_GAMMA, isat: _SOL_ISAT, Dq: sl2.Dq, spec: sl2.spec });
      return { V: sl2.V, vdd, I: vdd * sl2.V, kv: _E.kernelVer, m: sl2.m, spec: sl2.spec, Dq: sl2.Dq }; };
    // ── THE LIVE GROUP LEDGER (the virial law WIRED TO THE MEDIUM): H and V of W's current field, from the
    //    engine's own operators (kinetic via the λ grid, potential via the closed-form saturable F). W is pinned
    //    AND capped, so H is NOT conserved here — the reading is the REGIME INDICATOR: H<0 = "this state, if
    //    freed (unpinned, uncapped), would collapse" — the VPT call as a live matter observable, ansatz-free.
    //    Peer-local telemetry (a pure fn of the shared field at a shared bar → identical on peers at equal bar).
    let _vptOn = true, _vptEvery = 4, _vptLogBar = -1, _vptLast = null, _vptPrev = null, _sl2KeyN = 0;   // ON BY DEFAULT at coarse cadence (every 4th bar ≈ 1.5s: one FFT — negligible); H is THE physical summary of the medium, so it rides the hdr too; _vptPrev = the last (solSteps, V, I) for the Casimir tier's V̇/İ
    const _vptRead = () => { const lam = _lambda(); if (!lam) return null;
      // source: W's live field; in ⌀PDE (W.field null) fall back to the MIRROR — live physics locked to the register
      // is exactly what H should be read from. Pure ⌀PDE without a mirror has no field: H of the DECLARATION is a
      // constant of the compiled envelope (nothing integrates) — nothing live to watch; start a mirror.
      const f = W.field || ((V.born && V.mirror) ? V.field : null); if (!f) return null;
      const src = W.field ? 'W' : 'V-mirror';
      const pr = new Float64Array(N_CELLS), pi = new Float64Array(N_CELLS);
      for (let j = 0; j < N_CELLS; j++) { pr[j] = f[j * 2]; pi[j] = f[j * 2 + 1]; }
      fft2d(pr, pi, GRID, false);
      let hk = 0; for (let j = 0; j < N_CELLS; j++) hk += (-0.5 * lam.re[j]) * (pr[j] * pr[j] + pi[j] * pi[j]);
      hk /= N_CELLS;
      let hn = 0, E = 0;
      for (let j = 0; j < N_CELLS; j++) { const I = f[j * 2] ** 2 + f[j * 2 + 1] ** 2; E += I;
        hn -= _SOL_GAMMA * _SOL_ISAT * (I - _SOL_ISAT * Math.log(1 + I / _SOL_ISAT)); }
      // TORUS-AWARE moment (the wearGo lag artifact made law): a wrapped core / full-field halo pulls the naive
      // centroid toward G/2 and corrupts V — the live state earns the first-harmonic centroid + wrapped distances.
      const Vr = secondMomentTorus(f, GRID).V;
      // ── GATE F WIRED LIVE: the ERMAKOV–LEWIS tier of the same reading. V̈ from the register (analytic ∇λ,
      //    engine γ/Isat, Dq at the state's effective σ), V̇ from the last reading (Δt = ΔsolSteps·DT — the
      //    SHARED step clock, never wall time), I = V̈V − ½V̇². Perspective: the VPT boolean becomes a DATED
      //    forecast (free flight focuses at t*=−V̇/V̈ with waist I/V̈, or hits V→0 at t_c — full quadratic, no
      //    chirpless assumption), and İ per unit t = the sl(2)-WORK of the drive (pin+cap+kernel bumps): on a
      //    free Hamiltonian stretch I is conserved, so İ≠0 is exactly the operator's maintenance power.
      const rc = _E.ringCache; let vddX = null, Vd = null, Ic = null, tFoc = null, vMinP = null, tCol = null, Idot = null, rekey = null;
      if (rc?.r?.length) { const sigEff = Math.min(48, Math.max(2, Math.sqrt(Vr / (2 * (E || 1)))));
        const Dq = packetD(rc.r, rc.w, rc.o, sigEff);
        vddX = virialRateX(f, rc.r, rc.w, rc.o, GRID, { gamma: _SOL_GAMMA, isat: _SOL_ISAT, Dq });
        const prev = _vptPrev;
        if (prev && prev.src === src && _E.solSteps > prev.k) { const dtEl = (_E.solSteps - prev.k) * DT;
          Vd = (Vr - prev.V) / dtEl; Ic = slCasimir(vddX, Vr, Vd);
          if (prev.I != null) { let dI = Ic - prev.I;
            // THE RE-KEY (the fractal clock swapped the kernel between readings): V and V̇ are continuous
            // functionals of ψ, but V̈ is a functional of the STENCIL → I jumps by ΔI = ΔV̈·V, closed-form from
            // the two descriptors on the SAME field. Bookkeep it OUT of İ: the re-key is the clock re-tuning the
            // medium, not the drive doing work — without this, every kernel bump would pollute the wear meter.
            if (prev.kv !== _E.kernelVer && prev.st) {
              const vddOld = virialRateX(f, prev.st.r, prev.st.w, prev.st.o, GRID, { gamma: _SOL_GAMMA, isat: _SOL_ISAT, Dq });
              rekey = (vddX - vddOld) * Vr; dI -= rekey; }
            Idot = dI / dtEl; }
          if (vddX > 0 && Vd < 0) { tFoc = -Vd / vddX; vMinP = Ic / vddX; }
          else if (vddX < 0) tCol = (Vd + Math.sqrt(Vd * Vd - 2 * vddX * Vr)) / -vddX; }
        _vptPrev = { k: _E.solSteps, V: Vr, I: Ic, src, kv: _E.kernelVer,
          st: { r: Array.from(rc.r), w: Array.from(rc.w), o: rc.o.map((a) => Array.from(a)) } }; }   // stencil COPY (the node's live arrays get recomputed by the clock)
      return { H: hk + hn, hk, hn, V: Vr, E, src, vddX, Vd, I: Ic, Idot, tFoc, vMinP, tCol, rekey }; };
    const _recordV = (phi, k) => { if (!W.field) return;
      const rvOp = { mode: 'id', phase: phi || 0, beta: 1, omega: 0, prec: 0 };
      // V's held OPERATOR = W's current ATTRACTOR (the probe field at W's leash position — the operator W was living
      // UNDER), NOT W's field. This is the fix for "view:V frozen after record": holding V toward a copy of its OWN
      // field pins it rigidly (att≈field → the pin does nothing → static); holding it toward the OPERATOR gives it a
      // distinct attractor to live at (like recall, which holds toward the banked probe att pl.a). Matches the oracle
      // (virtAtt = io.att() = the W attractor, line 317), not W.field.
      const wAtt = W.movAtt(W.leash.state.gx, W.leash.state.gy) || W.field;
      V.att = phi ? lensU1.apply(rvOp, wAtt) : wAtt.slice();
      const holo = _specLeg(W.field, _VIRT_T, DT); if (!holo) return;    // RECORD: the hologram plate (forward, SPECTRAL — zero GPU)
      let lift = _specLeg(holo, _VIRT_T, -DT);                           // LIFT: the exact backward leg → live copy
      if (phi) lift = lensU1.apply(rvOp, lift);
      let ve = 0; for (let j = 0; j < lift.length; j++) ve += lift[j] * lift[j];
      V.field = lift; V.e0 = ve || 1; V.born = true; V.hold = true; V.desc = false; V.mirror = false;     // V born: its OWN recorded att, held (parked at the remembered moment); a field birth ends descriptor mode
      _lensOp[1].phase = phi ? ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : 0; _lensOp[1].prec = 0; _lensOp[1].omega = _lensOp[0].omega;   // V's descriptor = the birth lens (DUAL plate: the register moment)
      V.leash.release();
      console.log(`[MU1-VIRT] recorded+lifted V atStep=${k}${phi ? ` · THROUGH LENS φ=${phi.toFixed(3)}` : ''} · lift fidelity vs W = ${_ampCorr(lift, W.field).toFixed(4)} (T=${_VIRT_T}, spectral) · V BORN (dual plate: field + descriptor ∠${lensU1.wrap(lensU1.angle(_lensOp[1])).toFixed(3)})`); };
    const _storeMoment = (k) => { if (!W.field) return;
      // f32-quantize the plate AT CREATION (the saveEngine discipline applied to the spectral leg): the plate rides
      // the wire as f32 — a leader keeping f64 while a joiner restores f32 would split recall's argmax at the margin.
      const p64 = _specLeg(W.field, _VIRT_T, DT); if (!p64) return;
      const plate = Float64Array.from(Float32Array.from(p64));
      _plates.push({ p: plate, a: W.movAtt(W.leash.state.gx, W.leash.state.gy), dop: { ..._lensOp[0] },
        pos: [W.leash.state.gx, W.leash.state.gy], obj: _lensObj,   // the COMPLETE collective coordinates: readOp scalars (dop) + leash position + object identity — with these the descriptor plate is self-sufficient (𝔸-recall reads it with no field)
        w0: Float64Array.from(W.field),   // the DRESSED profile — the medium's OWN locked soliton at the stored moment (f32 GPU readback → peer-identical bytes). This is the holographic PLATE proper: captured ONCE here; 𝔸-recall reconstructs+ages it by pure descriptor rotation, never re-simulating (the bare probe ψ_base shows the injected symbol; the dressing — saturable focusing through the ring kernel — is what the 6 floats alone don't carry)
        bw: _tauK ? (_tauK.beatsOf('W') ?? 0) : 0, k });   // BOTH plates: field (p) + descriptor (dop = W's (M,O) copy)
      if (_plates.length > BANK_MAX) _plates.shift();
      console.log(`[MU1-VIRT] STORE atStep=${k} — plate ${_plates.length}/${BANK_MAX} banked (dual: field + descriptor ∠${lensU1.wrap(lensU1.angle(_plates[_plates.length - 1].dop)).toFixed(3)}, bw=${_tauK ? (_tauK.beatsOf('W') ?? 0) : 0})`); };
    const _recallMoment = (k, xshift = false) => { if (!_plates.length || !W.field) return;
      // cue = W now, propagated to plate space (SPECTRAL leg — zero GPU); bind against the bank; best = argmax overlap.
      // xshift (recallx): score SHIFT-INVARIANTLY (crossCorrScan — all N offsets in one dual pass) and RELOCATE the
      // lift to where the cue actually sits — recall that finds a moment the soliton has moved away from.
      const cue = _specLeg(W.field, _VIRT_T, DT); if (!cue) return;
      let best = 0, bc = -1, bestD = [0, 0];
      const scores = _plates.map((pl, i) => { let c, d = [0, 0];
        if (xshift) { const r = crossCorrScan(cue, pl.p, GRID); c = r.corrMax; d = [r.dx, r.dy]; } else c = _ampCorr(cue, pl.p);
        if (c > bc) { bc = c; best = i; bestD = d; } return +c.toFixed(3); });
      const pl = _plates[best];
      // FIELD-PLATE lift (the IMAGE): the exact backward leg on the stored plate → V's field (relocated if xshift)
      V.field = _specLeg(pl.p, _VIRT_T, -DT);
      if (xshift && (bestD[0] || bestD[1])) { V.field = spectralShift(V.field, -bestD[0], -bestD[1], GRID);
        console.log(`[MU1-RECALLX] shift-invariant match: plate ${best + 1} at δ=(${bestD[0]},${bestD[1]}) → lift RELOCATED to the cue's position (the duality recall: zero-lag would have scored it ${_ampCorr(cue, pl.p).toFixed(3)})`); }
      let ve = 0; for (let j = 0; j < V.field.length; j++) ve += V.field[j] * V.field[j]; V.e0 = ve || 1;
      V.att = (xshift && (bestD[0] || bestD[1])) ? (_plateAtt(pl.dop, [(pl.pos?.[0] ?? 0) - bestD[0], (pl.pos?.[1] ?? 0) - bestD[1]], pl.obj) || pl.a) : (pl.a || V.att);
      V.born = true; V.hold = true; V.desc = false; V.mirror = false;
      _lensOp[1].phase = _lensOp[1].prec = 0;
      // THE DUAL-LAYER EQUIVALENCE (the headline): the observer's aging shift comes TWO independent ways —
      // (A) FIELD-derived — measured from the 128 KB FIELD BYTES, no descriptor: phaseCorr(plate, cue) = arg⟨plate, cue⟩,
      //     the phase W's field ACTUALLY rotated between store and now. cue = W-now propagated by stepEyeN(+DT) to plate
      //     space; pl.p = W-at-store propagated the SAME way → both live in identical plate space, so their overlap phase
      //     is PURELY the aging (the common propagation cancels). This is the true field round-trip, not a descriptor read.
      const dField = lensU1.wrap(phaseCorr(pl.p, cue));
      // (B) DESCRIPTOR-only — the 6-float algebraic PREDICTION, computed with NO field at all. THE EXACT form is the
      //     difference of two STORED register phases: pl.dop.phase froze W's register angle at store (= the accumulated
      //     Σω up to store); _lensOp[0]'s angle is the accumulated Σω up to now. Their difference IS the aging, and it
      //     handles a CHANGING ω correctly (the register accumulates ω PER BEAT — the "W AGES" loop), which the naive
      //     ω·Δτ does NOT. This is lensC1.compose(plate, invert(W-now)) read as an angle — a pure 6-float op, no field.
      const dDesc = _tauK ? lensU1.wrap(lensU1.angle(_lensOp[0]) - lensU1.angle(pl.dop)) : null;
      // ω·Δτ is the CLOSED-FORM special case — EXACT only if ω was CONSTANT since store (then Σω = ω·N). Shown alongside
      // as the "if ω never changed" prediction; it DIVERGES from dDesc (and the field) when ω was changed mid-flight —
      // NOT a bug, an honest signal that the constant-ω closed form doesn't apply (live-caught: ω set late → ω·Δτ=37 rad
      // over 186 beats while the field only aged 1.2 rad, because ω was 0 for 180 of those beats).
      const dN = (pl.bw != null && _tauK) ? (_tauK.beatsOf('W') ?? 0) - pl.bw : null;
      const dOmegaTau = (dN != null && _lensOp[0].omega) ? lensU1.wrap(_lensOp[0].omega * dN) : null;
      console.log(`[MU1-RECALL] cue⊗bank=[${scores.join(', ')}] → plate ${best + 1} (stored atStep=${pl.k}) lifted into V`);
      // the HEADLINE: measured field aging (A) vs the EXACT descriptor Δφ (B). |A−B|≈0 is the field-vs-equation proof.
      const eqErr = (dDesc != null) ? Math.abs(lensU1.wrap(dField - dDesc)) : null;
      console.log(`[RECALL-∠] Δ(field measured, 128KB)=${dField.toFixed(3)} rad${dDesc != null ? ` · Δ(descriptor Σω, 6 floats)=${dDesc.toFixed(3)} rad` : ''} · Δτ_W=${dN ?? '—'} beats${eqErr != null ? ` · EQUIVALENCE |field−equation|=${eqErr.toFixed(4)} rad ${eqErr < 0.15 ? '✓ AGREE (the macro-law describes the micro-physics)' : '✗ DISAGREE (field structure the 6 floats miss, or a non-global phase)'}` : ''}${dOmegaTau != null ? ` · [ω·Δτ closed-form=${dOmegaTau.toFixed(3)} rad — exact only if ω constant since store]` : ''} — the dual-layer readout`); };

    // ── 𝔸-RECALL (recalla) — ABSTRACTIVE HOLOGRAPHY: recall as a PURE ℂ*-DESCRIPTOR OPERATOR, zero simulation. The
    //    field path (_recallMoment) content-addresses by propagating W through the kernel (stepEyeN ±T) and correlating
    //    128KB plates; THIS path evaluates the same read in CLOSED FORM on the descriptor plates alone: two translated
    //    copies of one base object overlap as the autocorrelation of ψ_base ≈ exp(−|Δpos|²/2σ²) — the algebraic
    //    prediction of ampCorr(cue, plate) (cross-object plates score 0: different base ⇒ negligible overlap). The
    //    recalled slot is born DESCRIPTOR-ONLY: its whole state IS (dop, pos, obj) — no field bytes, no grid step ever
    //    runs for it; the render projects it at frame rate (_descProject) and its phase precesses in ω-time at the
    //    shared bar (the 𝔸-slot aging block in the drive loop). The FIELD verb 'recall' stays untouched as the
    //    independent ORACLE — run both and compare plate choice + aging Δ∠ (the honest dual-layer check; per the
    //    no-tricks law the view is labeled PREDICTIVE, never passed off as ψ). All arithmetic CPU f64 at the shared
    //    drain step → in regH → byte-identical across peers by construction.
    const _RECALL_SIG = 6;   // px — the closed-form content-address width (≈ the probe autocorrelation radius)
    const _recallDop = (k) => { if (!_plates.length) return;
      const cx = W.leash.state.gx, cy = W.leash.state.gy;   // cue = W's DESCRIPTOR now (leash coords; no field read)
      let best = 0, bc = -1; const scores = _plates.map((pl, i) => { const dx = (pl.pos?.[0] ?? 0) - cx, dy = (pl.pos?.[1] ?? 0) - cy;
        const c = (pl.obj && pl.obj !== _lensObj) ? 0 : Math.exp(-(dx * dx + dy * dy) / (2 * _RECALL_SIG * _RECALL_SIG));
        if (c > bc) { bc = c; best = i; } return +c.toFixed(3); });
      const pl = _plates[best];
      // V born in DESCRIPTOR MODE: re-instantiate the REMEMBERED operator (the stored dop) at its stored position; it
      // then lives FORWARD in ω-time from that moment. No V.field/att → the V field-drive block never runs for it.
      _lensOp[1].phase = pl.dop.phase; _lensOp[1].prec = pl.dop.prec || 0; _lensOp[1].omega = pl.dop.omega; _lensOp[1].beta = pl.dop.beta;
      V.desc = true; V.descPos = [pl.pos?.[0] ?? 0, pl.pos?.[1] ?? 0]; V.descObj = pl.obj || _lensObj; V.descBar = Math.floor(k / 21);
      V.descBase = pl.w0 || null; V.descPhi0 = lensU1.angle(pl.dop);   // the DRESSED base (the living profile recorded at store) + the birth angle — _descProject rotates it by ∠now−∠birth (aging only)
      V.field = null; V.att = null; V.hold = false; V.mirror = false; V.born = true; V.leash.release();
      V.leash.state.gx = V.descPos[0]; V.leash.state.gy = V.descPos[1];   // seed the 𝔸-leash AT the stored position (descgo chases FROM here; the render translates by leash − descPos, so the reconstruction starts un-shifted)
      const dDesc = lensU1.wrap(lensU1.angle(_lensOp[0]) - lensU1.angle(pl.dop));   // predicted aging (Σω difference — the [RECALL-∠] (B) path, now primary)
      const dN = (pl.bw != null && _tauK) ? (_tauK.beatsOf('W') ?? 0) - pl.bw : null;
      console.log(`[RECALL-𝔸] cue⊗bank (closed form, no field)=[${scores.join(', ')}] → plate ${best + 1} (stored atStep=${pl.k}, pos ${(pl.pos?.[0] ?? 0).toFixed(1)},${(pl.pos?.[1] ?? 0).toFixed(1)}) — V born DESCRIPTOR-ONLY (0 grid steps) · predicted aging Δ∠=${dDesc.toFixed(3)} rad over Δτ_W=${dN ?? '—'} beats · oracle: run 'recall' (field path) and compare choice+Δ∠`); };

    // ── MIRROR-SOURCED VERB EXECUTORS (⌀PDE): mv = the queue entry (register context AT the drain step — shared-
    //    exact); mf = the mirror's live buffer AT the same shared step (deterministic). All CPU f64 from there
    //    (spectral legs, plate codec) — identical results on every peer by construction. Births → P1 as 𝔸-slots.
    const _storeFrom = (mv, mf) => { const p64 = _specLeg(mf, _VIRT_T, DT); if (!p64) return;
      _plates.push({ p: Float64Array.from(Float32Array.from(p64)), a: _plateAtt(mv.dop, [mv.gx, mv.gy], _lensObj),
        dop: { ...mv.dop }, pos: [mv.gx, mv.gy], obj: _lensObj, w0: Float64Array.from(Float32Array.from(mf)), bw: mv.bw, k: mv.k });
      if (_plates.length > BANK_MAX) _plates.shift();
      console.log(`[MU1-VIRT] STORE (⌀register-sourced) atStep=${mv.k} — plate ${_plates.length}/${BANK_MAX} banked (field from the WITNESS at the shared step + descriptor ∠${lensU1.wrap(lensU1.angle(mv.dop)).toFixed(3)}, bw=${mv.bw})`); };
    const _recordFrom = (mv, mf) => { const ti = (mv.si >= 1 && mv.si <= 3) ? mv.si : 2, P1 = _sb.slots[ti], phi = mv.amp || 0;   // slot-TARGETED (the register-strip selector; default P1)
      const rvOp = { mode: 'id', phase: phi, beta: 1, omega: 0, prec: 0 };
      P1.descBase = Float64Array.from(Float32Array.from(phi ? lensU1.apply(rvOp, mf) : mf));
      _lensOp[ti].phase = phi ? ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : 0; _lensOp[ti].prec = 0; _lensOp[ti].omega = mv.dop.omega;
      P1.desc = true; P1.descPhi0 = lensU1.angle(_lensOp[ti]); P1.descPos = [mv.gx, mv.gy]; P1.descObj = _lensObj; P1.descBar = Math.floor(mv.k / 21);
      P1.field = null; P1.att = null; P1.hold = false; P1.mirror = false; P1.born = true;
      P1.leash.release(); P1.leash.state.gx = mv.gx; P1.leash.state.gy = mv.gy;
      console.log(`[MU1-VIRT] RECORD (⌀register-sourced) atStep=${mv.k}${phi ? ` · THROUGH LENS φ=${phi.toFixed(3)}` : ''} — ${SLOTN[ti]} born as an 𝔸-SLOT (the moment DECLARED: envelope from the witness, descriptor ∠${P1.descPhi0.toFixed(3)} · view:${SLOTN[ti]}, mu1.descGo(x,y,'${SLOTN[ti]}') to transport it)`); };
    const _recallFrom = (mv, mf) => { if (!_plates.length) return;
      const cue = _specLeg(mf, _VIRT_T, DT); if (!cue) return;
      const xshift = mv.mode === 'recallx';
      let best = 0, bc = -1, bestD = [0, 0];
      const scores = _plates.map((pl, i) => { let c, d = [0, 0];
        if (xshift) { const r = crossCorrScan(cue, pl.p, GRID); c = r.corrMax; d = [r.dx, r.dy]; } else c = _ampCorr(cue, pl.p);
        if (c > bc) { bc = c; best = i; bestD = d; } return +c.toFixed(3); });
      const pl = _plates[best]; let lift = _specLeg(pl.p, _VIRT_T, -DT); if (!lift) return;
      if (xshift && (bestD[0] || bestD[1])) lift = spectralShift(lift, -bestD[0], -bestD[1], GRID);
      // the moment is resurrected ALIVE into V (field mode's recall semantics, register-resident): a LIVING
      // 𝔸-slot — the register engine steps it, held toward its plate's regenerated attractor (the pin),
      // transportable via descgo (the pin chase). The mirror role, if V held it, is released — a slot is one
      // thing at a time; every slot is the same TYPE, modes differ.
      const ti = (mv.si >= 1 && mv.si <= 3) ? mv.si : 1, V1 = _sb.slots[ti];   // slot-TARGETED living birth (default V)
      _lensOp[ti].phase = 0; _lensOp[ti].prec = 0; _lensOp[ti].omega = mv.dop.omega;
      V1.desc = true; V1.descBase = Float64Array.from(Float32Array.from(lift)); V1.descPhi0 = 0;
      V1.descPos = pl.pos ? [pl.pos[0] - bestD[0], pl.pos[1] - bestD[1]] : [mv.gx, mv.gy]; V1.descObj = pl.obj || _lensObj; V1.descBar = Math.floor(mv.k / 21);
      V1.descPosCap = [...V1.descPos]; V1.descCapBar = Math.floor(mv.k / 21); V1.descHold = null;
      let eL = 0; for (let j = 0; j < V1.descBase.length; j++) eL += V1.descBase[j] * V1.descBase[j]; V1.descE0 = eL || 1;
      V1.descLive = true; V1.descAttG = { dop: { ...pl.dop }, obj: pl.obj || _lensObj };
      V1.descAtt = _plateAtt(pl.dop, V1.descPos, pl.obj || _lensObj);
      V1.descDisp = Float64Array.from(V1.descBase);
      V1.field = null; V1.att = null; V1.hold = false; V1.mirror = false; V1.born = true;
      V1.leash.release(); V1.leash.state.gx = V1.descPos[0]; V1.leash.state.gy = V1.descPos[1];
      const dDesc = (pl.bw != null) ? lensU1.wrap(lensU1.angle(mv.dop) - lensU1.angle(pl.dop)) : null;
      console.log(`[MU1-RECALL${xshift ? 'X' : ''}] (⌀register-sourced) cue⊗bank${xshift ? ' (SHIFT-INVARIANT)' : ''}=[${scores.join(', ')}] → plate ${best + 1} (stored atStep=${pl.k})${xshift ? ((bestD[0] || bestD[1]) ? ` · δ=(${bestD[0]},${bestD[1]}) → lift RELOCATED to the cue's position` : ' · δ=(0,0) — no relocation needed') : ''} → ${SLOTN[ti]} born LIVING (the register engine steps it; held toward its plate attractor; mu1.descGo(x,y,'${SLOTN[ti]}') to walk it)${dDesc != null ? ` · descriptor aging Δ∠=${dDesc.toFixed(3)} rad over Δτ_W=${(mv.bw - pl.bw) | 0} beats` : ''} · view:${SLOTN[ti]}`); };

    // ── S7: JOIN SNAPSHOT (the medium.js idiom, user-preferred: snapshot AT JOIN, not a periodic checkpoint). The
    //    platform asks a live peer for a state snapshot via world.ps.app._snapHook, ships it OFF the render path, and
    //    sets _snapshotApplied on the joiner — who restores VERBATIM then tracks forward. Engine SLICE via the G3 codec
    //    (_E.saveEngine/restoreEngine, the app owning _stepClk.c0); the SLOT registers (bank + leash/flags) + the plate
    //    bank ride alongside. Typed fields ship as plain arrays (the framework reviver handles the wire). ──
    // ── THE WIRE CODEC (the join-freeze fix): every big field ships as an f32-BASE64 STRING, not a JSON number
    //    array. WHY: the snapshot path is 4 synchronous multi-MB JSON passes (leader deep-copy + send-stringify,
    //    reflector parse + re-stringify) on threads that ALSO carry the heartbeats — a plates-laden snapshot
    //    (~15MB as number arrays) froze BOTH peers (head-of-line blocked clock → todo=0 → the world stops; fresh
    //    worlds were small → "sometimes it joins smoothly"). f32 is already the fields' GPU truth (zero honesty
    //    loss); base64 is ~3.5× smaller and stringifies as ONE string (10–30× faster than 33k array elements).
    //    _f64b accepts legacy plain arrays too (old snapshots restore unchanged).
    const _b64f = (f) => { if (!f) return null; const u8 = new Uint8Array(Float32Array.from(f).buffer);
      let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s); };
    const _f64b = (v) => { if (!v) return null; if (Array.isArray(v)) return Float64Array.from(v);   // legacy wire
      const bin = atob(v); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return Float64Array.from(new Float32Array(u8.buffer)); };
    // plate att is NOT shipped — it is a PURE register function (a = lensC1.apply(dop+pos, ψ_base(obj)), exactly how
    // _storeMoment built it: readOp-at-store ≡ dop) → regenerated bit-identically at restore. 1/3 off every plate.
    const _plateAtt = (dop, pos, obj) => { try { const base = _psiBaseOf(obj || _lensObj); if (!base) return null;
      return _xattOn ? _xattBuild(dop, pos?.[0] ?? 0, pos?.[1] ?? 0, base)
                     : lensC1.apply({ ...dop, mode: 'metric', tx: pos?.[0] ?? 0, ty: pos?.[1] ?? 0 }, base, GRID); } catch (e) { return null; } };
    const _takeSnap = () => { const eng = _E.saveEngine({ stepClkC0: _stepClk.c0, torbE0: W.e0, transPx: W.leash.state.gx, transPy: W.leash.state.gy });
      return {
      eng: { ...eng, psiLensed: eng.psiLensed ? _b64f(eng.psiLensed) : null },   // WIRE: f32-base64 (the app owns this boundary, per G3; decoded before restoreEngine)
      stepClk: { rate: _stepClk.rate, ratePrev: _stepClk.ratePrev },
      bank: _bank.save(),                                             // the observer readOps (all 4 descriptors)
      slots: _sb.save(),                                             // per-slot leash/flags/kind (S1 codec)
      slotFields: _sb.slots.map((s) => s.field ? _b64f(s.field) : null),   // each slot's canonical ψ (the plate/live fields)
      slotAtt: _sb.slots.map((s) => s.att ? _b64f(s.att) : null),
      K: { edge: _K.edge ? _K.edge.map((r) => [...r]) : null, capPh: _K.capPh, capStep: _K.capStep, src: _K.src.map((s) => s ? _b64f(s) : null) },
      plates: _plates.map((pl) => ({ p: _b64f(pl.p), dop: { ...pl.dop }, pos: pl.pos ? [...pl.pos] : null, obj: pl.obj || null, w0: pl.w0 ? _b64f(pl.w0) : null, bw: pl.bw, k: pl.k })),   // a NOT shipped (regenerated: _plateAtt)
      descSlots: _sb.slots.map((s) => s.desc ? { pos: s.descPos ? [...s.descPos] : null, obj: s.descObj || null, bar: s.descBar | 0, base: s.descBase ? _b64f(s.descBase) : null, hold: s.descHold ? _b64f(s.descHold) : null, posCap: s.descPosCap ? [...s.descPosCap] : null, capBar: s.descCapBar ?? null, e0: s.descE0 ?? null, live: s.descLive ? 1 : 0, attg: s.descAttG ? { dop: { ...s.descAttG.dop }, obj: s.descAttG.obj || null } : null, phi0: s.descPhi0 || 0 } : null),   // 𝔸-slot state (desc mode + coords + ω-time cursor + the dressed base/birth angle) — a joiner must resume the identical precession AND reconstruction
      tauK: _tauK ? _tauK.save() : null,
      shiftSeen: _siShift.saveCursor(), regSeen: _siReg.saveCursor(),   // the shift + register-verb cursors (+ pending stamped entries ride tauK.save via the 'shift'/'reg' queues — a mid-slide joiner applies them at their startSteps)
      lastTgt: [_lastTgtX, _lastTgtY], driveMode: _driveMode, autoCompN: _autoCompN, tempoDiv: _tempoDiv, xatt: _xattOn,
      // THE IFS KERNEL THE LEADER WAS STEPPING THROUGH AT THE SNAPSHOT STEP — version-matched to the shipped field. The
      // joiner MUST step through THIS ring, NOT the node's live ring: if the fractal clock advanced the ring version between
      // the leader's capture and the joiner's apply (a join landing at/after a kernel bump), the node's ring is a DIFFERENT
      // version than the field → the joiner steps a vN field through a v(N+1) kernel → intermittent post-restore fork.
      // DEEP-copy the offsets (array-of-arrays, per tier) to PLAIN nested number arrays so they survive the JSON wire
      // (a shallow Array.from keeps inner typed arrays that can serialize to length-less objects → 0 offset points → freeze).
      kernelVer: _E.kernelVer, ring: _E.ringCache ? { r: Array.from(_E.ringCache.r), w: Array.from(_E.ringCache.w), o: (_E.ringCache.o || []).map((tier) => Array.from(tier || [])) } : null,
    }; };
    const _restoreSnap = (s, n) => { if (!s) return;
      const _engOk = _E.restoreEngine({ ...s.eng, psiLensed: _f64b(s.eng?.psiLensed) }, { setStepClkC0: (c0) => { _stepClk.c0 = c0; }, setTorbE0: (e0) => { W.e0 = e0; }, setTransP: (x, y) => { W.leash.state.gx = x; W.leash.state.gy = y; } });
      // ⌀PDE JOIN: an abstract-register leader ships NO ψ (psiLensed null) → restoreEngine declines the slice. The
      // REGISTER IS the state — restore the engine counters by hand so the joiner resumes the abstract drive at the
      // same shared k (the descSlots loop below restores desc mode + envelopes; nothing else is needed: no field).
      if (!_engOk && Array.isArray(s.descSlots) && s.descSlots.some((d) => d)) { _E.solInit = true; _E.snapConsumed = true;
        _E.solSteps = s.eng?.solSteps | 0; _E.kwSteps = (typeof s.eng?.kwSteps === 'number') ? (s.eng.kwSteps | 0) : (s.eng?.solSteps | 0);
        if (typeof s.eng?.stepClkC0 === 'number') _stepClk.c0 = s.eng.stepClkC0;
        W.e0 = (typeof s.eng?.torbE0 === 'number') ? s.eng.torbE0 : 1; }
      if (s.stepClk) { _stepClk.rate = s.stepClk.rate ?? 1; _stepClk.ratePrev = s.stepClk.ratePrev ?? 1; }
      _bank.restore(s.bank); _sb.restore(s.slots);
      for (let i = 0; i < _sb.slots.length; i++) { _sb.slots[i].field = s.slotFields?.[i] ? _f64b(s.slotFields[i]) : _sb.slots[i].field;
        _sb.slots[i].att = s.slotAtt?.[i] ? _f64b(s.slotAtt[i]) : _sb.slots[i].att; }
      W.field = _E.psiLensed;   // the engine slice restored psiLensed = W's field (they are the same store)
      _K.edge = s.K?.edge ? s.K.edge.map((r) => [...r]) : null; _K.capPh = s.K?.capPh ?? -1; _K.capStep = s.K?.capStep ?? -1;
      for (let i = 0; i < 4; i++) _K.src[i] = s.K?.src?.[i] ? _f64b(s.K.src[i]) : null;
      _plates.length = 0; for (const pl of (s.plates || [])) _plates.push({ p: _f64b(pl.p),
        a: pl.a ? _f64b(pl.a) : _plateAtt(pl.dop, pl.pos, pl.obj),   // legacy snapshots carry a; new wire REGENERATES it (pure register fn — bit-identical to what _storeMoment built)
        dop: { ...pl.dop }, pos: pl.pos ? [...pl.pos] : null, obj: pl.obj || null, w0: pl.w0 ? _f64b(pl.w0) : null, bw: pl.bw, k: pl.k });
      for (let i = 0; i < _sb.slots.length; i++) { const d = s.descSlots?.[i], sl = _sb.slots[i];   // 𝔸-slot restore: desc mode + coords + ω-time cursor + the dressed base (its 6 floats ride the bank)
        sl.desc = !!d; sl.descPos = d?.pos ? [...d.pos] : null; sl.descObj = d?.obj || null; sl.descBar = d?.bar | 0;
        sl.descBase = d?.base ? _f64b(d.base) : null; sl.descPhi0 = d?.phi0 || 0;
        sl.descHold = d?.hold ? _f64b(d.hold) : (d?.base ? _f64b(d.base) : null);   // the living-declaration ANCHOR (legacy snapshots: anchor = base)
        sl.descPosCap = d?.posCap ? [...d.posCap] : (d?.pos ? [...d.pos] : null); sl.descCapBar = d?.capBar ?? null;
        sl.descE0 = d?.e0 ?? (sl.descBase ? (() => { let e = 0; for (let j = 0; j < sl.descBase.length; j++) e += sl.descBase[j] * sl.descBase[j]; return e || 1; })() : null);   // the register engine's cap level (legacy: recompute from the shipped base — same f32 bytes ⇒ same sum)
        sl.descDisp = sl.descBase ? Float64Array.from(sl.descBase) : null;   // display buffer seeded from the shipped state (bar-grid film from frame one)
        sl.descLive = !!d?.live; sl.descAttG = d?.attg ? { dop: { ...d.attg.dop }, obj: d.attg.obj || null } : null;
        sl.descAtt = (sl.descLive && sl.descAttG && sl.descPos) ? _plateAtt(sl.descAttG.dop, sl.descPos, sl.descAttG.obj) : null; }   // a living slot's pin target REGENERATED (pure register fn — identical bytes; the att itself never rides the wire)
      if (_tauK && s.tauK) { _tauK.restore(s.tauK); _siShift.reattach(); _siReg.reattach(); }   // restore replaces the queue RECORDS → re-attach BOTH handles (they closed over the old records); pending mid-slide shifts + register verbs now drain at their stamped startSteps
      _siShift.restoreCursor(s.shiftSeen | 0); _siReg.restoreCursor(s.regSeen | 0);
      _lastTgtX = s.lastTgt?.[0] ?? NaN; _lastTgtY = s.lastTgt?.[1] ?? NaN; if (typeof s.driveMode === 'string') _driveMode = s.driveMode;
      _autoCompN = s.autoCompN | 0; _tempoDiv = Math.max(1, s.tempoDiv | 0); _autoClose = false; _xattOn = !!s.xatt;   // adopt the world's mode + replicated dials
      // THE REGISTER IS THE DEFAULT even across a physics-mode excursion (user request): a world restored in
      // FIELD mode re-arms the close — it fires 1 bar after restore (the state is already dressed, so the
      // capture is immediate and good). mu1.autoClose(false) right after load keeps classic. Idempotent under
      // a double-fire (two peers reloading: the second wabs finds the slots already desc and skips).
      if (!s.descSlots?.some((d) => d) && (_E.psiLensed || W.field)) { _autoClose = true; _bootSeedBar = _E.frameBar;
        console.log(`[MU1-BOOT] restored a FIELD-mode world — re-closing to the ⌀register default in 1 bar (mu1.autoClose(false) NOW to stay classic)`); }
      // RESTORE THE IFS KERNEL the leader was stepping through — upload its EXACT ring + adopt its kernelVer, so the joiner
      // steps the soliton through the SAME propagation kernel from step 1 (else it forks at the first step, the root fork).
      // _pendKern cleared: the shared-step swap logic replays any change AFTER this ver from the node's kernelQueue.
      _pendKern.length = 0;
      // set the ring ONLY (no field round-trip — the eye buffer isn't loaded yet at join; the field uploads fresh at the
      // first drive frame). A readEyePsi here reads an uninitialized FBO → writing that back froze the joiner (live-caught).
      // A restored joiner has solInit=true, so the cold-start ring-upload branch (!_kernRunning) NEVER runs for it — it MUST
      // get a valid ring HERE or stepEye propagates through an empty kernel → the field freezes (the 5f64a108 freeze).
      // PREFER THE SNAPSHOT's VERSION-MATCHED RING (the leader's ring at the capture step, now that its offsets survive the
      // wire via the deep-copy in _takeSnap). This is the intermittent-fork fix: the node's LIVE ring may be a NEWER version
      // than the shipped field (the fractal clock advanced between capture and apply) → stepping a vN field through the node's
      // v(N+1) kernel forks. The snapshot ring is version-matched to the field. Fall back to the node ring ONLY if the
      // snapshot ring is missing/empty (its offsets must be non-degenerate — sum of tier lengths > 0). Any kernel change
      // AFTER the snapshot's version replays through the shared-step staging (kernelQueue), landing at the identical solStep.
      const _snapOffTot = (s.ring?.o) ? s.ring.o.reduce((a, t) => a + ((t?.length || 0) >> 1), 0) : 0;
      const _jr = (s.ring && s.ring.r && s.ring.r.length && _snapOffTot > 0) ? s.ring : (n.cachedRadii?.length ? { r: n.cachedRadii, w: n.cachedWeights, o: n.cachedOffsets } : null);
      const _jrVer = (_jr === s.ring && typeof s.kernelVer === 'number') ? s.kernelVer : (n.cachedRadiiVersion | 0);
      if (_jr) { _gpu.setRings(_jr.r, _jr.w, _jr.o); _E.ringCache = { r: _jr.r, w: _jr.w, o: _jr.o }; }
      _E.kernelVer = _jrVer;
      console.log(`[MU1-JOINRING] used ${_jr === s.ring ? 'SNAPSHOT' : 'NODE'} ring · ver=${_jrVer} · snapOffTot=${_snapOffTot} nodeVer=${n.cachedRadiiVersion | 0} snapVer=${s.kernelVer}`);
      _solSeeded = true; _joinBurstLog = true; _joinAnchor = true;   // a restored joiner has W's field verbatim → do NOT re-seed; first-frame decides whether to ease a big backlog (c0 kept verbatim)
      // JOIN DIAGNOSTIC: hash the restored field at the restore step. Compare to the LEADER's [DET] solH at the SAME
      // solStep= (the leader logs solH every Q-boundary). If they MATCH → the restore is exact, the fork is in the drive
      // afterward (GPU-context). If they DIFFER → the field transfer itself is lossy (the fork is at join, not drive).
      console.log(`[MU1-JOIN] restored @ solStep=${_E.solSteps} · restoredFieldH=${_hashField(W.field)} (compare to the LEADER's [DET] solH at solStep=${_E.solSteps}) · c0=${_stepClk.c0.toFixed(4)} rate=${_stepClk.rate} born=[${_sb.slots.filter((x) => x.born).map((x) => x.name).join(',')}]`); };
    // leader fills the WS snapshot when asked; joiner restores it on _snapshotApplied (handled in the frame)
    if (world?.ps?.app) world.ps.app._snapHook = (worldSnap) => { if (_solSeeded && (W.field || W.desc)) { worldSnap.medSnapU1 = _takeSnap();   // an ABSTRACT leader has no W.field — the register (descSlots) IS the state and ships fine
      const _wireKB = (JSON.stringify(worldSnap.medSnapU1).length / 1024) | 0;   // cheap now (b64 strings pass through); the join-freeze watch number
      console.log(`[MU1-SNAP] leader captured @ solStep=${_E.solSteps} · fieldH=${W.field ? _hashField(W.field) : '(abstract)'} (the joiner's restoredFieldH MUST equal this) · c0=${_stepClk.c0.toFixed(4)} · wire≈${_wireKB}KB (f32-b64 codec; plates ship p+w0 only — att regenerated)`); }
      else console.log(`[MU1-SNAP] ⚠ _snapHook fired but NOT captured (solSeeded=${_solSeeded} Wfield=${W.field ? 'ok' : 'NULL'}) → the joiner will get NO field snapshot → it self-seeds → desync`); };

    // ── UI: drive toggle (transport↔objorbit) + shiftX/Y → W.virtGo ──
    const _driveBtn = mkBtn('drive:transport', true, () => { _driveMode = _driveMode === 'transport' ? 'objorbit' : 'transport'; _driveBtn.textContent = `drive:${_driveMode}`; injectEvent?.({ type: 'setMedium', drive: _driveMode }); });
    bar1.appendChild(_driveBtn);
    const _sX = mkSlider('shiftX', -12, 12, 0.25, 0, (v) => injectEvent?.({ type: 'setMedium', shiftX: v }));   // range matches the world clamp [-12,12] (a wider slider jumped back on clamp)
    const _sY = mkSlider('shiftY', -12, 12, 0.25, 0, (v) => injectEvent?.({ type: 'setMedium', shiftY: v }));
    bar1.appendChild(_sX.wrap); bar1.appendChild(_sY.wrap);
    // SLOT VIEW selector (replaces the old eye/medium SCOPE toggle) — pick which slot the outCell shows. LOCAL
    // (a display choice, peer-independent, like the old scope) — only BORN slots are selectable.
    const _viewSel = document.createElement('select'); Object.assign(_viewSel.style, { background: '#222', color: '#9cf', border: '1px solid #0004', borderRadius: '4px', padding: '3px 4px', fontSize: '9px', fontFamily: 'ui-monospace,monospace', cursor: 'pointer' });
    for (const nm of SLOTN) { const o = document.createElement('option'); o.value = nm; o.textContent = `view:${nm}`; _viewSel.appendChild(o); }
    _viewSel.onchange = () => { _viewSlot = Math.max(0, SLOTN.indexOf(_viewSel.value)); }; bar1.appendChild(_viewSel);
    // view cycle: raw ψ → ∠lens (ψ through readOp) → 𝔸desc (the descriptor projection — see _dials). LOCAL display toggle.
    const _VIEWS = ['raw', 'lens', 'desc'], _VIEWLBL = { raw: 'view:raw', lens: 'view:∠lens', desc: 'view:𝔸desc' };
    const _lvBtn = mkBtn('view:raw', false, () => { _dials.view = _VIEWS[(_VIEWS.indexOf(_dials.view) + 1) % _VIEWS.length];
      _lvBtn.textContent = _VIEWLBL[_dials.view]; _lvBtn._on = _dials.view !== 'raw'; }); bar1.appendChild(_lvBtn);
    // color cycle (LOCAL): auto (field→amp, 𝔸→∠φ) → amp → ∠φ — force one colormap on both render paths.
    const _COLORS = ['auto', 'amp', '∠φ'];
    const _colBtn = mkBtn('color:auto', false, () => { _colorMode = _COLORS[(_COLORS.indexOf(_colorMode) + 1) % _COLORS.length];
      _colBtn.textContent = `color:${_colorMode}`; _colBtn._on = _colorMode !== 'auto'; }); bar1.appendChild(_colBtn);
    // S6 dual-layer holography controls (replicated verbs):
    const _verbSlot = () => (_viewSlot >= 1 ? SLOTN[_viewSlot] : _regSlot);   // memory-verb target: the VIEWED slot wins when it's V/P1/P2 (user expectation: "I'm looking at P1 — recall lands in P1"); resolved AT PRESS and stamped into the verb (never at drain — the carrier principle)
    bar1.appendChild(mkBtn('⎙rec', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'record', src: _verbSlot() })));   // record → declares into the target slot
    bar1.appendChild(mkBtn('store', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'store', src: _verbSlot() })));    // bank the moment (both plates)
    bar1.appendChild(mkBtn('recall⇄', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'recallx', src: _verbSlot() })));  // shift-aware recall: finds a MOVED moment and RELOCATES the reconstruction to the cue's (current) position — "bring that moment HERE"
    bar1.appendChild(mkBtn('recall@', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'recall', src: _verbSlot() })));   // zero-lag in-place recall: the reconstruction lands at the plate's STORED position — "show me where it WAS" (the two answer different questions; both honest)
    bar1.appendChild(mkBtn('recall𝔸', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'recalla', src: _verbSlot() })));  // 𝔸-recall: descriptor-only (abstractive holography — closed-form read, 0 grid steps; 'recall' is its oracle)
    const _absBtn = mkBtn('⌀PDE', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'wabs', amp: W.desc ? 0 : 1 }));   // the meta-circular closure: close the WHOLE register into abstract holography ⇄ materialize back (the oracle test)
    bar1.appendChild(_absBtn);
    bar1.appendChild(mkBtn('mirror', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'mirror' })));   // toggle the LIVE PDE mirror of the register (field mode: Lyapunov; ⌀PDE: the medium as a view of the abstract model)
    // mode:physics ⇄ mode:⌀register — the ONE-PRESS architecture toggle (the "old oracle view" ⇄ the closed register).
    // physics = classic field mode (W integrates, verbs read W.field). ⌀register = PURE wabs-close: the register
    // is the whole state (sl2 charges + 𝔸 view, 0 grid steps/frame); the mirror is NOT bundled — press it
    // separately when a live-physics verifier/witness is wanted. Open: mirror-off (if any) THEN materialize.
    // Label = the CURRENT mode (reflected from replicated state); click = switch.
    const _xattBtn = mkBtn('x𝔸tt', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'xatt', amp: _xattOn ? 0 : 1 }));   // the exact spectral attractor toggle (replicated; watch lock→A — the oracle protocol for adopting it as default)
    bar1.appendChild(_xattBtn);
    const _modeBtn = mkBtn('mode:physics', false, () => {
      if (!W.desc) injectEvent?.({ type: 'mediumVirt', mode: 'wabs', amp: 1 });
      else { if (V.born && V.mirror) injectEvent?.({ type: 'mediumVirt', mode: 'mirror' }); injectEvent?.({ type: 'mediumVirt', mode: 'wabs', amp: 0 }); } });
    bar1.appendChild(_modeBtn);
    const _coevoBtn = mkBtn('⟲coevo', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'coevo', amp: _coevoOn ? 0 : 1 }));   // the Einstein loop (matter throttles its own transport) — replicated toggle
    bar1.appendChild(_coevoBtn);
    const _unpinBtn = mkBtn('unpin', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'unpin', amp: _unpinned ? 0 : 1 }));   // U(1)⇄ℂ*: pinned = descriptor-predicted lag (replay-safe) · unpinned = TRUE field energy (v7: works in ⌀PDE — the register engine IS the field)
    bar1.appendChild(_unpinBtn);

    // ── THE REGISTER STRIP (bar2) — per-slot observer controls: which slot to target, its pin β (refAmp), its att
    //    phase write (attPhase ±), and the global ω (lensTau) precession dial. Every control is a REPLICATED verb. ──
    let _regSlot = 'W';   // which slot the register controls target
    const _regLbl = document.createElement('span'); _regLbl.textContent = 'register:'; _regLbl.style.fontWeight = 'bold'; bar2.appendChild(_regLbl);
    const _regSel = document.createElement('select'); Object.assign(_regSel.style, { background: '#222', color: '#9cf', border: '1px solid #0004', borderRadius: '4px', padding: '3px 4px', fontSize: '9px', fontFamily: 'ui-monospace,monospace', cursor: 'pointer' });
    for (const nm of SLOTN) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; _regSel.appendChild(o); } _regSel.onchange = () => { _regSlot = _regSel.value; }; bar2.appendChild(_regSel);
    const _sBeta = mkSlider('β', 0, 3, 0.05, 1, (v) => injectEvent?.({ type: 'mediumVirt', mode: 'refamp', src: _regSlot, amp: v }));   // pin gravity (refAmp)
    bar2.appendChild(_sBeta.wrap);
    bar2.appendChild(mkBtn('att−', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'aphase', src: _regSlot, amp: -0.2 })));   // rotate the register phase (attPhase)
    bar2.appendChild(mkBtn('att+', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'aphase', src: _regSlot, amp: +0.2 })));
    const _sOm = mkSlider('ω', -0.5, 0.5, 0.01, 0, (v) => injectEvent?.({ type: 'mediumVirt', mode: 'lenstau', amp: v }));   // GLOBAL precession (lensTau) — the register-clock comparator
    bar2.appendChild(_sOm.wrap);
    const _regReadout = document.createElement('span'); _regReadout.style.color = '#7a8'; bar2.appendChild(_regReadout);   // live per-slot ∠/β/ω

    // ── console meters (the register readouts, over the slot array) ──
    // ── S4: THE REGISTER METERS over the slot array (the observer readouts — chainRead/chainSee/lensOps/regPhase).
    //    Peer-local (like regRead in the oracle), zero replicated state — a pure fn of the slots' fields+readOps, so
    //    two peers match at equal step. chainRead = raw pairwise overlaps (pred/mdl vs the algebra); chainSee = the
    //    chain read THROUGH each slot's readOp (ψ_seen = Op·ψ). Only BORN slots participate (need ≥2). ──
    // (a DESCRIPTOR-ONLY slot participates in the chain meters through its projection — its ψ IS its render)
    const _chainSlots = () => _sb.slots.map((s, i) => ({ name: s.name, field: s.desc ? _descProject(i) : s.field, op: s.readOp, born: s.born }))
      .filter((s) => (s.born || s.field) && s.field).map(({ name, field, op }) => ({ name, field, op }));
    // ── regH: THE DESCRIPTOR-TIER DETERMINISM HASH (the contract — two peers MUST match at equal step). It hashes ONLY
    //    exact-arithmetic state: every readOp's scalars, each slot's τ_i beat count + born flag, the coupling edges, the
    //    plate descriptors (M,O) + their bw, and the shared step k. NO field bytes → no GPU/f32/ULP → byte-identical
    //    across peers BY CONSTRUCTION. This is the ℂ*-descriptor payoff: the register (what computes/ages/remembers) is
    //    deterministic for free; the field (fieldH) is a peer-local image that MAY drift. regH✗ = a real fork; fieldH✗
    //    alone = benign float noise (the physics agrees — the register is intact).
    const _regH = () => _hashNums([
      _E.solSteps, _stepClk.rate,
      ..._lensOp.flatMap((op) => _opNums(op)),
      ..._sb.slots.flatMap((s) => [s.born ? 1 : 0, _tauK ? (_tauK.beatsOf(s.name) ?? 0) : 0, s.leash.state.go ? 1 : 0, Math.round(s.leash.state.gx * 100), Math.round(s.leash.state.gy * 100), s.desc ? 1 : 0, s.descBar | 0]),   // desc mode + its ω-time cursor ARE the 𝔸-slot's whole dynamics → in the contract
      ...(_K.edge ? _K.edge.flat() : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      _plates.length, ..._plates.flatMap((pl) => [..._opNums(pl.dop), pl.bw | 0]),
    ]);
    if (typeof window !== 'undefined') {
      window.mu1 = {
        lensOps: () => { const o = _lensOp.map((l, i) => ({ slot: SLOTN[i], ...l, angle: +lensU1.angle(l).toFixed(4) }));
          console.log(`[LENSOPS] ${o.map((l) => `${l.slot}:{∠${l.angle} β=${l.beta} ω=${l.omega} g=${(l.gain ?? 1).toFixed(2)}}`).join(' · ')} step=${_E.solSteps}`); return o; },
        regPhase: () => ({ step: _E.solSteps, regH: _regH(), lock: +_E.lockNow.toFixed(3), born: _sb.slots.map((s) => s.born ? s.name : null).filter(Boolean),
          angle: SLOTN.map((nm, i) => +lensU1.wrap(lensU1.angle(_lensOp[i])).toFixed(3)),
          beats: SLOTN.map((nm) => _tauK ? (_tauK.beatsOf(nm) ?? 0) : 0), Wpos: [+W.leash.state.gx.toFixed(2), +W.leash.state.gy.toFixed(2)],
          fieldH: _sb.slots.map((s) => s.field ? _hashField(s.field) : null) }),
        chainRead: () => { const c = _chainSlots(); if (c.length < 2) return '[MU1] need ≥2 born slots'; const m = chainMeter(c);
          console.log(`[CHAIN] ${m.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis} pred ${l.pred} mdl ${l.mdl})`).join(' · ')} · ε=${m.defect} (alg ${m.algDefect}) step=${_E.solSteps}`); return m; },
        chainSee: () => { const c = _chainSlots(); if (c.length < 2) return '[MU1] need ≥2 born slots'; const m = chainMeter(c, { G: GRID, through: true });
          console.log(`[CHAINSEE] ${m.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis})`).join(' · ')} · ε=${m.defect} · modes[${m.modes.join(',')}] step=${_E.solSteps}`); return m; },
        // S6 dual-layer holography verbs (replicated via mediumVirt → applied at the shared drain step):
        rec: (phi = 0) => injectEvent?.({ type: 'mediumVirt', mode: phi ? 'recvia' : 'record', amp: +phi }),
        store: () => injectEvent?.({ type: 'mediumVirt', mode: 'store' }),
        recall: () => injectEvent?.({ type: 'mediumVirt', mode: 'recall' }),
        recalla: () => injectEvent?.({ type: 'mediumVirt', mode: 'recalla' }),   // 𝔸-recall (descriptor-only; compare its [RECALL-𝔸] against recall's [RECALL-∠])
        mirror: () => injectEvent?.({ type: 'mediumVirt', mode: 'mirror' }),   // toggle the live PDE mirror (V injection-locked to the register's attractor; works in field AND ⌀PDE modes)
        // lagTrace(on) — the JOIN-LAG BISECTOR (see _lagTick): run on BOTH peers, baseline 10s, join, read the flag:
        // CLOCK DELIVERY (reflector/ws layer) vs LOCAL COMPUTE (this peer) vs BURSTY BACKLOG (clock clumping).
        lagTrace: (on = true) => { _lagOn = !!on; if (!on) { _lag.wall0 = 0; _lag.ckBase = 0; } return `[LAG] trace ${on ? 'ON — [LAG] line per second; compare peers across a join' : 'OFF'}`; },
        // tempo(n) — the WORLD PROPER-TIME divisor (replicated, 1–8): the §7.44 answer to a PERMANENT supply<demand
        // deficit (shared GPU / weak peer — [LAG] shows steps/s below clock×·57). tempo(2) halves demand at a shared
        // step on EVERY peer: the world runs slower but smoothly, byte-identically. tempo(1) restores full speed.
        tempo: (n = 2) => injectEvent?.({ type: 'mediumVirt', mode: 'tempo', amp: +n }),
        // autoTempo(on) — the governor (default ON): peer-local deficit/headroom measurement, replicated actuation.
        // exactAtt(on) — the exact spectral attractor (replicated physics toggle; see _xattOn). recallx() — the
        // shift-aware recall verb (finds + relocates a moved moment; works field-mode and mirror-sourced in ⌀PDE).
        exactAtt: (on = true) => injectEvent?.({ type: 'mediumVirt', mode: 'xatt', amp: on ? 1 : 0 }),
        recallx: () => injectEvent?.({ type: 'mediumVirt', mode: 'recallx' }),
        // region(spec) — THE TWO-BROWSER SHARD (descent rung 2, live): this tab's mirror integrates physics ONLY
        // in its region; outside = the register's declaration (locally computed → the reflector is UNTOUCHED — no
        // peer exchange, ordinary replicated inputs only). PEER-LOCAL view dial: tab 1 mu1.region('left'), tab 2
        // mu1.region('right') → one world, GPU per tab ≈ halved, seams declaration-anchored (watch seam-glue in
        // the [MIRROR] log). Specs: 'left'|'right'|'top'|'bottom'|'all' or (x0, y0, x1, y1). Needs ⌀PDE + mirror.
        region: (spec = 'all', y0, x1, y1) => { const G2 = GRID / 2;
          if (spec === 'all' || spec == null) { _mirRegion = null; _mirRegionName = ''; _shardRef = null; return '[REGION] full field (no shard — the whole-torus register engine resumes)'; }
          const R = { left: { x0: 0, y0: 0, x1: G2, y1: GRID }, right: { x0: G2, y0: 0, x1: GRID, y1: GRID },
            top: { x0: 0, y0: G2, x1: GRID, y1: GRID }, bottom: { x0: 0, y0: 0, x1: GRID, y1: G2 } }[spec];
          if (R) { _mirRegion = R; _mirRegionName = String(spec); }
          else if (typeof spec === 'number') { _mirRegion = { x0: spec | 0, y0: y0 | 0, x1: x1 | 0, y1: y1 | 0 }; _mirRegionName = `${spec | 0},${y0 | 0}→${x1 | 0},${y1 | 0}`; }
          else return '[REGION] unknown spec (left/right/top/bottom/all or x0,y0,x1,y1)';
          // the declared-boundary snapshot (the seam-glue reference, peer-local witness data)
          _shardRef = (W.desc && W.descBase) ? Float64Array.from(W.descBase) : null;
          const viaMirror = V.born && V.mirror;
          return `[REGION] shard=${_mirRegionName} · ${viaMirror ? 'MIRROR path (the GPU witness integrates only R; outside = the 𝔸 declaration)' : W.desc ? 'REGISTER-ENGINE path (regionStepX: bit-exact inside R, cost ∝ |R|; outside = the declared boundary, frozen) — eH becomes SHARD-SCOPED on this peer (regH stays the shared contract); watch [SHARD] seam-glue' : 'waiting: needs ⌀PDE'} · peer-local (each tab picks its own)`; },
        // coverTest() — DESCENT RUNG 1.5, live: run the cover law on the REAL current field. (1) cocycle: a 2×2
        // cover + glue vs the whole-torus step — must be BIT-FOR-BIT; (2) the spatial fork-finder: clean overlaps
        // ≡ 0, then a deliberately tainted halo cell must light up localized. Peer-local meter (~100ms CPU), no
        // state touched. A pass here means the live medium is SHARDABLE as-is: assigning these patches to peers
        // + shipping halos is wire engineering, not physics.
        viewAll: (on = true) => { _viewAllOn = !!on; _viewAllCache = { bar: -1, f: null };
          return `[ΣVIEW] ${on ? 'ON — the canvas shows the LINEAR SUPERPOSITION of every born slot declaration (a labeled VIEW: slots do not interact through it; per-bar film cadence). All living worldlines at once — W + recalled memories.' : 'OFF — single-slot view restored'}`; },
        coverTest: () => { const rc = _E.ringCache; if (!rc?.r?.length) return '[COVER] no kernel';
          const src = W.field || ((V.born && V.mirror) ? V.field : null); if (!src) return '[COVER] no field (⌀PDE: start a mirror)';
          const t0 = performance.now();
          const whole = leapfrogStepX(src, rc.r, rc.w, rc.o, DT, GRID);
          const cov = coverStep(src, rc.r, rc.w, rc.o, DT, GRID, 2);
          let dmax = 0; for (let j = 0; j < whole.length; j++) dmax = Math.max(dmax, Math.abs(cov[j] - whole[j]));
          const clean = coverResidual(src, rc.r, rc.w, rc.o, DT, GRID, 2);
          const bad = coverResidual(src, rc.r, rc.w, rc.o, DT, GRID, 2, { taint: { x: (GRID / 2 - 3) | 0, y: (GRID / 4) | 0, amp: 1e-3 } });
          const ms = (performance.now() - t0).toFixed(0);
          console.log(`[COVER] LIVE field (${W.field ? 'W' : 'mirror'}) · kernelVer=${_E.kernelVer} · reach=${clean.reach} · halo=3·reach=${3 * clean.reach}`);
          console.log(`[COVER] cocycle: 2×2 cover + glue vs whole torus → max|Δ|=${dmax === 0 ? '0 (BIT-FOR-BIT ✓ the live medium is shardable as-is)' : dmax.toExponential(2) + ' ✗ a non-local read leaked into the step'}`);
          console.log(`[COVER] fork-finder: clean overlaps residual=${clean.rmax === 0 ? '0 ✓' : clean.rmax.toExponential(2) + ' ✗'} · tainted halo → residual ${bad.rmax.toExponential(2)} @ (${bad.at?.[0]},${bad.at?.[1]}) ${bad.at ? '(localized ✓ — the descent analog of solH: WHERE, not just whether)' : '✗ not found'} · ${ms}ms`);
          return { dmax, clean: clean.rmax, taintedAt: bad.at }; },
        // defTest() — THE COMPOSITE-DEFECT INSTRUMENT (§1.2 of the doc, the refusable prediction): any pipeline's
        // fidelity must FACTOR into its arrows' measured defects; a composite that loses more than its factors
        // contains a hidden non-functorial read. Three arrows measured live, one call, no state touched:
        //   door  = ampCorr(exact declaration, live declaration) — the materialize door's OWN loss (bilinear
        //           resample + border zero-fill), isolated by rebuilding the projection with spectralShift
        //           (exact torus translation) + exact U(1) rotation. ≡1 on the id path (zero offset).
        //   state = ampCorr(witness, exact declaration) — physics vs a FAITHFUL projection: staleness + dressing
        //           drift + speckle, with the door's loss removed.
        //   composite = ampCorr(witness, live declaration) — lock→A as the mirror logs it.
        // Under a shard region, two more refusable checks: outside R the witness must equal f32(declaration)
        // BIT-EXACTLY (any scissor leak / ping-pong parity fault shows here FIRST), and the seam band must be
        // no worse than the interior (sharding adds no seam-specific defect beyond the declaration's own).
        defTest: () => {
          if (!W.desc || !W.descBase) return '[DEF] needs ⌀PDE (the declaration is the reference arrow)';
          const declB = _declProject(); if (!declB) return '[DEF] projection failed';
          const dphi = lensU1.wrap(lensU1.angle(_lensOp[0]) - (W.descPhi0 || 0));
          const L0 = W.leash.state, ox = L0.gx - (W.descPos?.[0] ?? 0), oy = L0.gy - (W.descPos?.[1] ?? 0);
          let declX = (ox || oy) ? spectralShift(W.descBase, ox, oy, GRID) : Float64Array.from(W.descBase);
          if (dphi) { const c = Math.cos(dphi), s = Math.sin(dphi);
            for (let j = 0; j < declX.length; j += 2) { const r = declX[j] * c - declX[j + 1] * s; declX[j + 1] = declX[j] * s + declX[j + 1] * c; declX[j] = r; } }
          const door = _ampCorr(declX, declB);
          // age in STEP-bars (floor(solSteps/21) — the stamps' scale); _E.frameBar is the CLOCK-cycle bar, a different counter
          const age = (W.descCapBar != null) ? `${Math.floor(_E.solSteps / 21) - W.descCapBar} bars` : '? (pre-stamp compile)';
          console.log(`[DEF] the adjunction's arrows, measured (composite fidelity must factor into its arrows — §1.2):`);
          console.log(`[DEF] door (live bilinear+zero-fill vs exact spectral materialize) = ${door.toFixed(5)} at offset (${ox.toFixed(2)},${oy.toFixed(2)}) ∠${dphi.toFixed(3)}${(!ox && !oy) ? ' — id path, exact by construction' : ''}`);
          const wit = (V.born && V.mirror && V.field) ? V.field : null;
          if (!wit) { console.log(`[DEF] no witness (pure ⌀PDE — nothing integrates): the counit/state arrows need a mirror`); return { door }; }
          const state = _ampCorr(wit, declX), comp = _ampCorr(wit, declB), pred = door * state, resid = comp - pred;
          console.log(`[DEF] state (witness vs exact declaration, declaration age ${age}) = ${state.toFixed(4)} · composite (witness vs LIVE declaration — NOT the [MIRROR] lock→A, which scores vs the bare-probe ATTRACTOR) = ${comp.toFixed(4)}`);
          console.log(`[DEF] factorization: door×state = ${pred.toFixed(4)} → residual ${resid >= 0 ? '+' : ''}${resid.toFixed(4)} ${comp >= pred - 0.03 ? '✓ composes (no hidden non-functorial read in this pipeline)' : '✗ the composite loses MORE than its arrows — a hidden peer-local/non-functorial read is in the pipeline'}`);
          const out = { door, state, comp, resid };
          if (_mirRegion) { const reg = _mirRegion, BW = 16;
            const zi = { n: 0, ea: 0, eb: 0 }, zb = { n: 0, ea: 0, eb: 0 }; let outMax = 0, outN = 0;
            for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const j = (y * GRID + x) * 2;
              const inR = x >= reg.x0 && x < reg.x1 && y >= reg.y0 && y < reg.y1;
              if (!inR) { outMax = Math.max(outMax, Math.abs(wit[j] - Math.fround(declB[j])), Math.abs(wit[j + 1] - Math.fround(declB[j + 1]))); outN++; continue; }
              const depth = Math.min(x - reg.x0, reg.x1 - 1 - x, y - reg.y0, reg.y1 - 1 - y), z = depth < BW ? zb : zi;
              z.n += wit[j] * declB[j] + wit[j + 1] * declB[j + 1]; z.ea += wit[j] ** 2 + wit[j + 1] ** 2; z.eb += declB[j] ** 2 + declB[j + 1] ** 2; }
            const zc = (z) => (z.ea > 0 && z.eb > 0) ? Math.abs(z.n) / Math.sqrt(z.ea * z.eb) : 1;
            const li = zc(zi), lb = zc(zb);
            console.log(`[DEF] shard[${_mirRegionName}] outside-R (${outN}px): max|Δ| vs f32(declaration) = ${outMax === 0 ? '0 — BIT-EXACT ✓ (no scissor leak, no ping-pong parity fault)' : outMax.toExponential(2) + ' ✗ the scissored pipeline WROTE outside R (cap-scale leak or parity fault — the setEyePsiBoth landmine class)'}`);
            // the seam bound is ITSELF the factorization law one level down: the band's defect = the declaration's
            // defect at the boundary PROPAGATED into the light-cone band → expected band ≈ interior × state (the
            // composed defect), NOT ≈ interior. Measured live 2026-07-18: left 0.894 vs 0.897 predicted.
            console.log(`[DEF] shard zones: interior lock=${li.toFixed(3)} · seam band(${BW}px)=${lb.toFixed(3)} vs composed bound interior×state=${(li * state).toFixed(3)} ${lb >= li * state - 0.05 ? '✓ the seam carries only the declaration defect, composed (sharding adds NO defect of its own)' : '✗ seam loss beyond the composed declaration defect — boundary corruption inside the light-cone band'}`);
            out.outsideMaxD = outMax; out.interior = li; out.band = lb; }
          return out; },
        // pure() — THE ⌀PDE PURITY PROOF (refusable, not asserted): scramble the GPU EYE buffer — the physics
        // pipeline's state — with noise. If the register is truly the model, NOTHING changes: the canvas keeps
        // rendering the register's envelope (a separate display texture), eH keeps its CPU-computed sequence,
        // verbs keep working. If the image or eH reacts, the GPU was secretly in the loop and the claim is false.
        pure: () => { if (!_gpu) return '[PURE] no gpu';
          // v2 (the scramble version couldn't discriminate — user-tested: BOTH modes keep canonical state
          // CPU-side and re-upload each frame, so the eye buffer is scratch either way; the question is WHO
          // EXECUTES THE STEPS). This counts actual GPU physics substeps over 3s: ⌀PDE must read ZERO.
          if (!_gpu._pureWrapped) { const orig = _gpu.stepEyeN.bind(_gpu); _gpu._pureCount = 0;
            _gpu.stepEyeN = (n, dt2) => { _gpu._pureCount += Math.abs(n | 0) || 1; return orig(n, dt2); }; _gpu._pureWrapped = true; }
          const c0 = _gpu._pureCount, mode = W.desc ? '⌀register' : 'physics';
          setTimeout(() => { const d = _gpu._pureCount - c0;
            console.log(`[PURE] GPU physics substeps in 3s: ${d} — ${d === 0 ? 'ZERO: the GPU stepped NOTHING; every evolution step was CPU f64 register arithmetic (the ⌀PDE claim, proven by counting, not asserted)' : `the GPU executed ${d} stepEye substeps (field mode / a live mirror / an instrument run)`} · mode at start: ${mode}`); }, 3000);
          return `[PURE] counting GPU physics substeps for 3s (mode: ${mode})… — the scramble test cannot discriminate (both modes re-upload canonical CPU state per frame); WHO STEPS is the question, and this counter answers it`; },
        // bankScan() — the DUALITY meter (finite-Fourier/Cartier applied to recall): SHIFT-INVARIANT plate matching,
        // one dual pass per plate (all N offsets at once, O(N·logN)). Shows what zero-lag recall misses: a banked
        // moment the soliton has MOVED away from still matches — at its offset. Peer-local meter, no state; a
        // replicated shift-aware recall verb is the follow-up if this proves useful in practice.
        bankScan: () => { if (!_plates.length) return '[BANKSCAN] no plates';
          const src = W.field || ((V.born && V.mirror) ? V.field : null); if (!src) return '[BANKSCAN] no field (⌀PDE: start a mirror)';
          const cue = _specLeg(src, _VIRT_T, DT); if (!cue) return '[BANKSCAN] no λ grid yet';
          console.log(`[BANKSCAN] cue⊗bank — zero-lag (the current recall score) vs SHIFT-INVARIANT (the duality win):`);
          _plates.forEach((pl, i) => { const r = crossCorrScan(cue, pl.p, GRID);
            console.log(`  plate ${i + 1} (atStep=${pl.k}, pos ${(pl.pos?.[0] ?? 0).toFixed(1)},${(pl.pos?.[1] ?? 0).toFixed(1)}) · corr0=${r.corr0.toFixed(3)} · corrMax=${r.corrMax.toFixed(3)} @ δ=(${r.dx},${r.dy})${r.corrMax > r.corr0 + 0.1 ? ' ← a MOVED moment found (zero-lag recall would miss it)' : ''}`); });
          return '[BANKSCAN] done'; },
        // autoClose(on) — the boot-default arm: ON (default) = a fresh leader closes the register after dressing;
        // OFF (call it early, e.g. from the console right after load) = classic physics stays the default.
        autoClose: (on = true) => { _autoClose = !!on; return `[MU1-BOOT] auto-close ${on ? 'ARMED' : 'OFF (classic physics default)'}`; },
        autoTempo: (on = true) => { _autoTempoOn = !!on; return `[TEMPO-AUTO] governor ${on ? 'ON (raise ≤4s after a sustained deficit; probe back after ~25s headroom)' : 'OFF (manual mu1.tempo only)'}`; },
        // autoCompile(N) — CONTINUOUS COMPILATION (⌀PDE + mirror): every N shared bars the mirror re-compiles W's
        // envelope → the canvas always shows the REGISTER projection while the declaration tracks living physics
        // with a ≤N-bar staleness bound. N=0 off. The third setting of the compile knob (once=wabs · always=mirror-view).
        autoCompile: (n = 8) => injectEvent?.({ type: 'mediumVirt', mode: 'autoc', amp: +n }),
        // frameLock(on) — LOCAL display dial: render the last SHARED-bar state instead of the peer-local frame end.
        // Frames are peer-local EVENTS (wall-clock-identical frames don't exist), but with this ON on both peers,
        // every displayed image belongs to ONE shared sequence — the identical film, ≤1 bar wall-offset. Applies to
        // W (field), the mirror, AND the 𝔸 pose (frac→0). Costs the between-bar smoothness — that smoothness IS the
        // peer-local sampling. Same-GPU caveat for field images; the 𝔸 film is exact up to colormap rounding.
        frameLock: (on = true, grid = 21) => { _frameLock = !!on; _frameLockGrid = Math.max(Q, Math.round((grid | 0) / Q) * Q); if (!on) { _dispW = null; _dispV = null; _lastPaintSig = ''; }
          return `[FRAMELOCK] ${on ? `ON — the shared film at every ${_frameLockGrid} steps (grid=${Q} ≈ 8fps · grid=21 bars ≈ 2.7fps) · SUBTICK-DRIVEN paint (one paint per shared index; rAF = polling only) · film@k stamped: identical k ⇒ identical pixels across peers` : 'OFF — smooth peer-local sampling of the shared trajectory (every frame is STILL a shared-film member; only the index is peer-sampled)'}`; },
        // subtickView(on) — the SUBTICK-DRIVEN RENDERER, named: frameLock at the finest shared grid (Q) + paint
        // gating. The canvas paints exactly the shared-boundary film, at most one paint per index — paint content
        // AND order are pure functions of shared time on every peer. The mirror under subtickView = the identical
        // physics film on every same-GPU peer, byte-for-byte, nothing exchanged, nothing verified.
        subtickView: (on = true) => window.mu1.frameLock(on, Q),
        descGo: (x = 0, y = 0, slot = 'V') => injectEvent?.({ type: 'mediumVirt', mode: 'descgo', src: slot, gx: +x, gy: +y }),   // 𝔸-transport: chase (x,y) with the descriptor leash — the recalled hologram MOVES, 0 grid steps
        descK: (kx = 0.3, ky = 0, slot = 'V') => injectEvent?.({ type: 'mediumVirt', mode: 'lensset', src: slot, kx: +kx, ky: +ky }),   // the linOp momentum tilt (rad/cell): with ω≠0 the 𝔸-slot's phase fronts FLOW — the travelling wave, pure register
        // ⌀PDE — the meta-circular closure: abstract(true) compiles EVERY born slot (W included) to envelope+descriptor
        // → 0 grid steps/frame, regH is the whole contract; abstract(false) MATERIALIZES the register back into the
        // medium and the PDE resumes from the descriptor state (the faithfulness measurement: lock→A should recover ≈1).
        abstract: (on = true) => { injectEvent?.({ type: 'mediumVirt', mode: 'wabs', amp: on ? 1 : 0 }); return `[⌀PDE] ${on ? 'CLOSING the register (slots → descriptor+envelope; 0 grid steps/frame)' : 'MATERIALIZING (register → field; the PDE resumes — the oracle test)'} — lands at the shared step on every peer`; },
        // kernFit() — GATE A of the metaplectic/ABCD arc: the IFS-NATIVE low-k fit, closed form from the ring
        // DESCRIPTOR alone (the kernel is a convolution — its symbol is exact; no GPU probe, no pixels). Reports the
        // effective diffraction tensor D (the paraxial mass tensor of THIS medium), its principal axes (the measured
        // axis-anisotropy signature, now DERIVED), the dipole Hermiticity check, and kFit vs kKnee — THE NOTE: the
        // IFS clock is a low-pass filter itself (rings anti-couple past j₀,₁/r), so when kFit ≥ kKnee the quadratic
        // ABCD slice is exact for every state the clock keeps: the fit discards only what the kernel discards.
        // Peer-local instrument, pure fn of the shared ring — both peers print identical lines at equal kernelVer.
        kernFit: () => { const rc = _E.ringCache; if (!rc?.r?.length) return '[KERNFIT] no ring kernel yet';
          const fit = kernelABCD(rc.r, rc.w, rc.o, { dt: DT, T: _VIRT_T });
          console.log(`[KERNFIT] kernelVer=${_E.kernelVer} · D=[[${fit.D[0].toFixed(4)}, ${fit.D[1].toFixed(4)}],[${fit.D[1].toFixed(4)}, ${fit.D[2].toFixed(4)}]] · principal D1=${fit.eig.D1.toFixed(4)} D2=${fit.eig.D2.toFixed(4)} axis θ=${(fit.eig.theta * 180 / Math.PI).toFixed(1)}° · aniso D1/D2=${fit.aniso.toFixed(3)} (the H+V banding signature, derived not probed)`);
          console.log(`[KERNFIT] dipole=(${fit.drift[0].toExponential(2)}, ${fit.drift[1].toExponential(2)}) ${fit.hermitian ? '≈0 ✓ Hermitian' : '≠0 ✗ NON-centrosymmetric kernel → k-odd gain (report this!)'} · kFit(±5%)=${fit.kFit.toFixed(3)} rad/px vs kKnee=j01/rMax=${fit.kKnee.toFixed(3)} (rMax=${fit.rMax}) → ${fit.kFit >= fit.kKnee ? 'quadratic holds THROUGH the clock\'s own passband ✓ — the ABCD slice is exact for every state the clock keeps' : 'quadratic knee sits INSIDE the passband — states sharper than kFit see the non-quadratic tail'}`);
          console.log(`[KERNFIT] ABCD free block over the ±T=${_VIRT_T} hologram depth (stepEyeN is LINEAR there): B=D·T·dt=[[${fit.abcd.B[0].toFixed(4)}, ${fit.abcd.B[1].toFixed(4)}],[${fit.abcd.B[2].toFixed(4)}, ${fit.abcd.B[3].toFixed(4)}]] → a k-tilted packet drifts Δx=B·k · v_g=D·k·dt per step — GATE B: materialize a descK-tilted packet, run the real ±T round-trip, compare drift/curvature against this matrix`);
          return fit; },
        // kernTest(kx, ky, {T, sigma}) — GATE B: the ABCD prediction vs the REAL linear kernel, measured ON the GPU,
        // off the drive path (eye buffer saved/restored; peer-local instrument — the drive re-uploads W.field each
        // frame, so nothing is perturbed). A Gaussian probe (width σ, tilt e^{ik·x}) runs stepEyeN(T, +dt) — the SAME
        // pure-linear propagation the hologram verbs use. Measured vs predicted, four observables:
        //   • centroid drift  Δx = D·k·T·dt (the B block — THE gate B number)
        //   • width spread    σ²(t) = σ₀² + (D·t/(2σ₀))² (the free-Schrödinger law with mass tensor D⁻¹)
        //   • dipole energy   e^{−(k·s)t} − 1 (the k-odd gain the Hermiticity check predicted)
        //   • ±T round-trip   ampCorr(back, probe) ≈ 1 (backward is the exact inverse — the dipole must cancel here)
        // kernTest('sweep') maps resid% across k = 0.05…0.30 → the honest quadratic band ON the real operator.
        kernTest: (kx = 0.15, ky = 0, { T = 64, sigma = 10 } = {}) => {
          if (!_gpu || !_E.ringCache?.r?.length) return '[KERNTEST] gpu/kernel not ready';
          const rc = _E.ringCache;
          const fit = kernelABCD(rc.r, rc.w, rc.o, { dt: DT, T });
          // EXACT-SYMBOL prediction (still zero GPU, pure descriptor): v = −½∂λ/∂k at k, PACKET-AVERAGED over the
          // probe's own spectrum |ψ̂|² = e^{−|k−k₀|²σ²} — a σ=10 probe has Δk≈0.1, so it samples the lattice
          // dispersion CURVATURE even at low k₀ (the systematic sub-D·k drift the first sweep measured). If the
          // exact-symbol residual collapses while the quadratic one grows, the register model is exact at all k and
          // the quadratic is just its paraxial slice (the ABCD group ops keep the quadratic; drift/phase use λ exact).
          const vEx = (qx0, qy0) => { const h = 1e-4;
            const dλx = (kernelSymbol(rc.r, rc.w, rc.o, qx0 + h, qy0).re - kernelSymbol(rc.r, rc.w, rc.o, qx0 - h, qy0).re) / (2 * h);
            const dλy = (kernelSymbol(rc.r, rc.w, rc.o, qx0, qy0 + h).re - kernelSymbol(rc.r, rc.w, rc.o, qx0, qy0 - h).re) / (2 * h);
            return [-0.5 * dλx, -0.5 * dλy]; };
          const vPacket = (qx0, qy0) => { const R = 2.5 / sigma, nS = 5; let vx = 0, vy = 0, ws = 0;
            for (let iy = -nS; iy <= nS; iy++) for (let ix = -nS; ix <= nS; ix++) { const ddx = ix * R / nS, ddy = iy * R / nS;
              const w = Math.exp(-(ddx * ddx + ddy * ddy) * sigma * sigma);
              const [vx1, vy1] = vEx(qx0 + ddx, qy0 + ddy); vx += w * vx1; vy += w * vy1; ws += w; }
            return [vx / ws, vy / ws]; };
          const mom = (f) => { let E = 0, cx = 0, cy = 0; for (let j = 0; j < N_CELLS; j++) { const a2 = f[j * 2] ** 2 + f[j * 2 + 1] ** 2; E += a2; cx += (j % GRID) * a2; cy += ((j / GRID) | 0) * a2; }
            cx /= E || 1; cy /= E || 1; let sxx = 0, syy = 0; for (let j = 0; j < N_CELLS; j++) { const a2 = f[j * 2] ** 2 + f[j * 2 + 1] ** 2, dx = (j % GRID) - cx, dy = ((j / GRID) | 0) - cy; sxx += dx * dx * a2; syy += dy * dy * a2; }
            return { E, cx, cy, sxx: sxx / (E || 1), syy: syy / (E || 1) }; };
          const runOne = (qx, qy) => { const c = GRID / 2, probe = new Float64Array(2 * N_CELLS);
            for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const dx = x - c, dy = y - c, a = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
              if (a > 1e-12) { const ph = qx * dx + qy * dy, i = (y * GRID + x) * 2; probe[i] = a * Math.cos(ph); probe[i + 1] = a * Math.sin(ph); } }
            const save = _gpu.readEyePsi();
            _gpu.setEyePsi(probe); _gpu.stepEyeN(T, DT); const fwd = _gpu.readEyePsi();
            _gpu.stepEyeN(T, -DT); const back = _gpu.readEyePsi(); _gpu.setEyePsi(save);
            const m0 = mom(probe), m1 = mom(fwd), t = T * DT;
            const pred = [(fit.D[0] * qx + fit.D[1] * qy) * t, (fit.D[1] * qx + fit.D[2] * qy) * t];
            const [vpx, vpy] = vPacket(qx, qy), predEx = [vpx * t, vpy * t];   // exact symbol, packet-averaged
            const meas = [m1.cx - m0.cx, m1.cy - m0.cy];
            const res = Math.hypot(meas[0] - pred[0], meas[1] - pred[1]), mag = Math.hypot(pred[0], pred[1]);
            const resEx = Math.hypot(meas[0] - predEx[0], meas[1] - predEx[1]), magEx = Math.hypot(predEx[0], predEx[1]);
            const sxPred = m0.sxx + (fit.D[0] * t / (2 * Math.sqrt(m0.sxx))) ** 2;
            const ePred = Math.exp(-(qx * fit.drift[0] + qy * fit.drift[1]) * t) - 1;
            return { pred, predEx, meas, res, mag, resEx, magEx, dE: m1.E / m0.E - 1, ePred, rt: _ampCorr(back, probe), sxx0: m0.sxx, sxx1: m1.sxx, sxPred }; };
          if (kx === 'sweep') { console.log(`[KERNTEST-SWEEP] T=${T} σ=${sigma} · k along x · quad=D·k·T·dt vs EXACT=⟨−½∂λ/∂k⟩_packet·T·dt vs measured:`);
            for (const q of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) { const r = runOne(q, 0);
              console.log(`  k=${q.toFixed(2)} · Δquad=${r.pred[0].toFixed(3)} ΔEXACT=${r.predEx[0].toFixed(3)} Δmeas=${r.meas[0].toFixed(3)} px · resid quad=${(100 * r.res / Math.max(r.mag, 1e-9)).toFixed(1)}% EXACT=${(100 * r.resEx / Math.max(r.magEx, 1e-9)).toFixed(1)}% · ΔE meas=${(100 * r.dE).toFixed(3)}% pred=${(100 * r.ePred).toFixed(3)}% · rt=${r.rt.toFixed(5)}`); }
            return '[KERNTEST-SWEEP] done — if EXACT resid ≈ 0 while quad grows, the register model is exact at all k (the quadratic is just its paraxial slice)'; }
          const r = runOne(+kx, +ky);
          console.log(`[KERNTEST] k=(${(+kx).toFixed(3)},${(+ky).toFixed(3)}) T=${T} σ=${sigma} (t=${(T * DT).toFixed(2)}) · kernelVer=${_E.kernelVer}`);
          console.log(`[KERNTEST] drift: quad Δ=(${r.pred[0].toFixed(3)}, ${r.pred[1].toFixed(3)}) · EXACT-symbol Δ=(${r.predEx[0].toFixed(3)}, ${r.predEx[1].toFixed(3)}) · meas Δ=(${r.meas[0].toFixed(3)}, ${r.meas[1].toFixed(3)}) px · resid: quad ${(100 * r.res / Math.max(r.mag, 1e-9)).toFixed(1)}% · EXACT ${(100 * r.resEx / Math.max(r.magEx, 1e-9)).toFixed(1)}% ${r.resEx / Math.max(r.magEx, 1e-9) < 0.02 ? '✓ the register model is exact at this k — plate propagation can move into the register (use λ, not the quadratic)' : '✗ EXACT also misses — a real model gap (report the numbers)'}`);
          console.log(`[KERNTEST] spread: σx² ${r.sxx0.toFixed(2)} → ${r.sxx1.toFixed(2)} px² (quad pred ${r.sxPred.toFixed(2)}) · dipole energy: meas ${(100 * r.dE).toFixed(4)}% vs pred ${(100 * r.ePred).toFixed(4)}% (s=(${fit.drift[0].toExponential(2)}, ${fit.drift[1].toExponential(2)})) · ±T roundtrip ampCorr=${r.rt.toFixed(5)} (≈1 required — backward is the exact inverse, the dipole cancels)`);
          return r; },
        // virialTest({sigma, iamp, steps, gamma, isat, cap, dt}) — THE GROUP-IDENTITY LEDGER (ansatz-free; the
        // sl(2,ℝ)/pseudo-conformal law measured on the real engine). At criticality (2D cubic, quadratic dispersion)
        // the virial identity is EXACT: V̈ = 4·D·H — in THIS engine's convention iψ_t = −(D/2)Δψ − γ|ψ|²ψ (the
        // literature's 8H belongs to the iu_t + Δu + |u|²u = 0 convention, kinetic coefficient 1 not ½; the γ=0
        // closed form confirms: free Gaussian V̈ = 2D²P/σ₀² = 4D·H_kin exactly — AND the instrument itself caught
        // the wrong 8: perfect parabola + perfect conservation + ratio 0.487 ≈ ½, live-run 2026-07-17). V = Σr²|ψ|²,
        // H = H_kin + H_nl conserved — V(t) is a PARABOLA,
        // H<0 ⇒ finite-time collapse (Vlasov–Petrishchev–Talanov), no Gaussian, no projection. THIS medium breaks
        // each generator in a named way, and this instrument MEASURES the breaking:
        //   • parabola residual in the cubic regime  = D-breaking (the lattice: non-quadratic symbol) — small at low k;
        //   • parabola BEND with saturation on        = K-breaking (Isat — WHY collapse arrests);
        //   • H drift with cap:true                   = the cap's non-Hamiltonian renormalization.
        // H computed EXACTLY engine-side: H_kin = −½⟨ψ,L̂ψ⟩ = Σ_k ω(k)|ψ̂(k)|²/N via the λ-grid (the symbol — the
        // lattice kinetic term, not a fit); H_nl = −Σ F(I), F = γ·Isat·(I − Isat·ln(1+I/Isat)) (→ γI²/2 cubic).
        // Pure Hamiltonian run: stepEyeN + NlSpm only — NO cap, NO pin (the identity addresses the closed system).
        virialTest: ({ sigma = 10, iamp = 0.06, steps = 240, gamma = _SOL_GAMMA, isat = 1e12, cap = false, dt = 0 } = {}) => {
          if (!_gpu || !_E.ringCache?.r?.length) return '[VIRIAL] gpu/kernel not ready';
          const lam = _lambda(); if (!lam) return '[VIRIAL] no λ grid';
          const dtv = dt || DT;   // dt OVERRIDE: shrink the Strang splitting error (∝dt²/step) to see the identity cleanly
          const c = GRID / 2, probe = new Float64Array(2 * N_CELLS); let P0 = 0;
          for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const dx = x - c, dy = y - c, a = iamp * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
            if (a > 1e-12) { probe[(y * GRID + x) * 2] = a; P0 += a * a; } }
          const F = (I) => (isat > 1e9 ? gamma * I * I / 2 : gamma * isat * (I - isat * Math.log(1 + I / isat)));   // the SPM potential (closed form; cubic limit exact)
          const H_of = (f) => { const pr = new Float64Array(N_CELLS), pi = new Float64Array(N_CELLS);
            for (let j = 0; j < N_CELLS; j++) { pr[j] = f[j * 2]; pi[j] = f[j * 2 + 1]; }
            fft2d(pr, pi, GRID, false);
            let hk = 0; for (let j = 0; j < N_CELLS; j++) hk += (-0.5 * lam.re[j]) * (pr[j] * pr[j] + pi[j] * pi[j]);   // ω(k)=−λ/2 · |ψ̂|²
            hk /= N_CELLS;                                                                                             // Parseval (unnormalized FFT)
            let hn = 0; for (let j = 0; j < N_CELLS; j++) hn -= F(f[j * 2] ** 2 + f[j * 2 + 1] ** 2);
            return { H: hk + hn, hk, hn }; };
          const V_of = (f) => { let E = 0, cx = 0, cy = 0; for (let j = 0; j < N_CELLS; j++) { const a2 = f[j * 2] ** 2 + f[j * 2 + 1] ** 2; E += a2; cx += (j % GRID) * a2; cy += ((j / GRID) | 0) * a2; }
            cx /= E || 1; cy /= E || 1; let v = 0; for (let j = 0; j < N_CELLS; j++) { const a2 = f[j * 2] ** 2 + f[j * 2 + 1] ** 2, dx = (j % GRID) - cx, dy = ((j / GRID) | 0) - cy; v += (dx * dx + dy * dy) * a2; } return v; };
          const H0 = H_of(probe), Dq = packetD(_E.ringCache.r, _E.ringCache.w, _E.ringCache.o, sigma);
          const save = _gpu.readEyePsi(); _gpu.setEyePsi(probe);
          const ts = [], vs = [];
          for (let i = 0; i < steps; i++) { _gpu.stepEyeN(1, dtv); _gpu.applyEyeNlSpm(-gamma, isat, dtv); if (cap) _gpu.applyEyeEnergyCap(P0);
            const f = _gpu.readEyePsi(); ts.push((i + 1) * dtv); vs.push(V_of(f)); }   // sample EVERY step (short pre-arrest windows need it)
          const fEnd = _gpu.readEyePsi(); _gpu.setEyePsi(save);
          const Hend = H_of(fEnd);
          // THE FIT WINDOW (the run-2 lesson): the VPT identity applies BEFORE the singular/arrest time only — a
          // collapsing run bottoms out at the lattice floor and REBOUNDS; fitting across the bounce returns garbage.
          // For H<0, fit only the pre-minimum segment (80% of the way to argmin V); for H≥0 use the full window.
          let iMin = 0; for (let i = 1; i < vs.length; i++) if (vs[i] < vs[iMin]) iMin = i;
          const nFit = (H0.H < 0 && iMin > 4 && iMin < vs.length - 1) ? Math.max(8, Math.floor(iMin * 0.8)) : vs.length;
          // least-squares parabola V(t) = c0 + c1·t + c2·t² over the window → V̈_meas = 2·c2
          let s0 = nFit, s1 = 0, s2 = 0, s3 = 0, s4 = 0, b0 = 0, b1 = 0, b2 = 0;
          for (let i = 0; i < nFit; i++) { const t = ts[i], v = vs[i]; s1 += t; s2 += t * t; s3 += t * t * t; s4 += t * t * t * t; b0 += v; b1 += v * t; b2 += v * t * t; }
          const det = (a, b, c2, d, e, f2, g, h, i2) => a * (e * i2 - f2 * h) - b * (d * i2 - f2 * g) + c2 * (d * h - e * g);
          const Dm = det(s0, s1, s2, s1, s2, s3, s2, s3, s4);
          const c0 = det(b0, s1, s2, b1, s2, s3, b2, s3, s4) / Dm;
          const c1 = det(s0, b0, s2, s1, b1, s3, s2, b2, s4) / Dm;
          const c2q = det(s0, s1, b0, s1, s2, b1, s2, s3, b2) / Dm;
          let rms = 0; for (let i = 0; i < nFit; i++) { const r = vs[i] - (c0 + c1 * ts[i] + c2q * ts[i] * ts[i]); rms += r * r; } rms = Math.sqrt(rms / nFit);
          const vddMeas = 2 * c2q, vddPred = 4 * Dq * H0.H;   // V̈ = 4·D·H in the iψ_t = −(D/2)Δψ convention (see header)
          // EXACT-SYMBOL prediction (the σ=24 overshoot lesson: at low D-breaking the residual is PREDICTION
          // structure — packetD's LSQ weight ≠ the virial's |∇ω|² weight). For ANY dispersion, chirpless data obeys
          // the exact lattice theorem V̈_lin = 2·P·Var(v_g), v_g = ∇_kω off the λ grid (centered diff, Brillouin
          // torus) — NO quadratic band assumed. D̄ survives only in the NL pressure cross-term: V̈_nl = −4·D̄·Σp,
          // p(ρ) = ρ·f(ρ) − F(ρ) (cubic: γρ²/2 → −2γD̄Σρ² ✓ the classic term).
          const vddX = (() => { const pr = new Float64Array(N_CELLS), pi = new Float64Array(N_CELLS);
            for (let j = 0; j < N_CELLS; j++) { pr[j] = probe[j * 2]; pi[j] = probe[j * 2 + 1]; }
            fft2d(pr, pi, GRID, false);
            const dk = 2 * Math.PI / GRID; let sw = 0, svx = 0, svy = 0, sv2 = 0;
            for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const j = y * GRID + x;
              const w = pr[j] * pr[j] + pi[j] * pi[j]; if (!w) continue;
              const xp = y * GRID + ((x + 1) % GRID), xm = y * GRID + ((x + GRID - 1) % GRID);
              const yp = ((y + 1) % GRID) * GRID + x, ym = ((y + GRID - 1) % GRID) * GRID + x;
              const vx = -0.5 * (lam.re[xp] - lam.re[xm]) / (2 * dk), vy = -0.5 * (lam.re[yp] - lam.re[ym]) / (2 * dk);
              sw += w; svx += w * vx; svy += w * vy; sv2 += w * (vx * vx + vy * vy); }
            const vlin = 2 * P0 * (sv2 / sw - ((svx / sw) ** 2 + (svy / sw) ** 2));
            let sp = 0; for (let j = 0; j < N_CELLS; j++) { const I = probe[j * 2] ** 2 + probe[j * 2 + 1] ** 2;
              const fI = gamma * I / (1 + I / isat), FI = F(I); sp += I * fI - FI; }
            return vlin - 4 * Dq * sp; })();
          const tCollapse = (H0.H < 0 && vddPred < 0) ? Math.sqrt(-2 * vs[0] / vddPred) : null;   // V0 + ½V̈t² → 0 (chirpless probe: V̇0≈0)
          const hScale = Math.max(Math.abs(H0.hk) + Math.abs(H0.hn), 1e-12);   // drift scaled by the ENERGY SCALE, not the (possibly near-zero) cancellation H0
          console.log(`[VIRIAL] σ=${sigma} iamp=${iamp} P0=${P0.toFixed(2)} γ=${gamma} Isat=${isat > 1e9 ? '∞ (cubic)' : isat} cap=${cap} dt=${dtv} · ${steps} steps · fit window ${nFit}/${vs.length}${nFit < vs.length ? ' (pre-arrest segment)' : ''} · kernelVer=${_E.kernelVer}`);
          console.log(`[VIRIAL] H0=${H0.H.toExponential(4)} (kin ${H0.hk.toExponential(3)} + nl ${H0.hn.toExponential(3)}) · H_end=${Hend.H.toExponential(4)} · drift=${(100 * (Hend.H - H0.H) / hScale).toFixed(3)}% of the energy scale ${cap ? '(cap ON — the drift IS the cap-breaking)' : '(split-step conservation; shrink with dt:0.03 to isolate physics from splitting error)'}`);
          console.log(`[VIRIAL] V̈: measured=${vddMeas.toExponential(4)} vs 4·D̄·H=${vddPred.toExponential(4)} (ratio ${(vddMeas / (vddPred || 1)).toFixed(3)}) vs EXACT-symbol=${vddX.toExponential(4)} (ratio ${(vddMeas / (vddX || 1)).toFixed(3)}) · parabola RMS resid=${(100 * rms / Math.abs(vs[0])).toFixed(3)}% of V0 ${isat > 1e9 ? '(cubic: EXACT ratio→1 = the group law on the lattice; the 4D̄H gap = the quadratic slice\'s reach)' : '(saturable: the BEND is the K-breaking — why collapse arrests)'}`);
          if (tCollapse) console.log(`[VIRIAL] H<0 ⇒ the GROUP collapse call (VPT, no ansatz): V→0 at t*≈${tCollapse.toFixed(2)} (step ≈ ${Math.round(tCollapse / dtv)}) · MEASURED V-minimum at step ${iMin + 1} (t=${ts[iMin].toFixed(2)}) — pred/meas ${(tCollapse / ts[iMin]).toFixed(2)} (arrest precedes the ideal singularity; ≲1 expected)`);
          return { H0: H0.H, Hend: Hend.H, vddMeas, vddPred, vddX, ratio: vddMeas / (vddPred || 1), ratioX: vddMeas / (vddX || 1), rms, nFit, iMin, ts, vs, tCollapse, tMin: ts[iMin] }; },
        // elTest({sigma, iamp, chirp, steps, gamma, isat, dt}) — GATE F: the ERMAKOV–LEWIS / sl(2,ℝ) CASIMIR on
        // the REAL GPU engine. The (V, V̇, H) triple gate E measured carries the invariant I = V̈·V − ½V̇²
        // (dI/dt = V̇(V̈−V̈) ≡ 0), and it is PREDICTIVE: a chirped (converging, chirp<0) probe focuses at
        // t* = −V̇₀/V̈ with waist V_min = I/V̈ — both called from t≈0 REGISTER data (analytic-∇λ curvature,
        // virialRateX) before the field gets there; the run then measures whether the medium agrees. Headless
        // regressions: waist to 0.1% linear, Casimir drift 1.5e-3; the GPU adds the f32/engine reality. Pure
        // Hamiltonian run (no cap, no pin) — the invariant addresses the closed system, like virialTest.
        elTest: ({ sigma = 10, iamp = 0.06, chirp = -0.01, steps = 400, gamma = 0, isat = 1e12, dt = 0 } = {}) => {
          if (!_gpu || !_E.ringCache?.r?.length) return '[EL] gpu/kernel not ready';
          const rc = _E.ringCache, dtv = dt || DT, c = GRID / 2, probe = new Float64Array(2 * N_CELLS);
          for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const dx = x - c, dy = y - c, r2 = dx * dx + dy * dy;
            const a = iamp * Math.exp(-r2 / (2 * sigma * sigma)); if (a <= 1e-12) continue;
            const th = chirp * r2, j = (y * GRID + x) * 2; probe[j] = a * Math.cos(th); probe[j + 1] = a * Math.sin(th); }
          const Dq = packetD(rc.r, rc.w, rc.o, sigma);
          const vddX = virialRateX(probe, rc.r, rc.w, rc.o, GRID, { gamma, isat, Dq });
          const save = _gpu.readEyePsi(); _gpu.setEyePsi(probe);
          const vs = [secondMoment(probe, GRID).V];
          for (let i = 0; i < steps; i++) { _gpu.stepEyeN(1, dtv); if (gamma) _gpu.applyEyeNlSpm(-gamma, isat, dtv);
            vs.push(secondMoment(_gpu.readEyePsi(), GRID).V); }
          _gpu.setEyePsi(save);
          let iLo = Infinity, iHi = -Infinity;
          for (let i = 1; i < vs.length - 1; i++) { const Vd = (vs[i + 1] - vs[i - 1]) / (2 * dtv); const I = slCasimir(vddX, vs[i], Vd); iLo = Math.min(iLo, I); iHi = Math.max(iHi, I); }
          const drift = (iHi - iLo) / (Math.abs(vddX) * vs[0]);
          const Vd1 = (vs[2] - vs[0]) / (2 * dtv), I1 = slCasimir(vddX, vs[1], Vd1);
          const tStar = dtv - Vd1 / vddX, vMinPred = I1 / vddX;
          let m = 0; for (let i = 1; i < vs.length; i++) if (vs[i] < vs[m]) m = i;
          const focus = m > 0 && m < vs.length - 1;
          console.log(`[EL] gate F on the GPU · σ=${sigma} chirp=${chirp} γ=${gamma}${gamma ? ` Isat=${isat > 1e9 ? '∞ (cubic)' : isat}` : ' (linear)'} dt=${dtv} · ${steps} steps · kernelVer=${_E.kernelVer}`);
          console.log(`[EL] CASIMIR I = V̈·V − ½V̇²: drift=${(100 * drift).toFixed(3)}% of V̈·V0 over the run (${gamma ? (isat > 1e9 ? 'cubic: the sl(2) law — small drift = the Dq-weight gap' : 'saturable: the drift IS the K-breaking, measured') : 'linear: conserved to FD+f32 — the register\'s first conserved observable beyond H'})`);
          console.log(`[EL] the FOCAL CALL (from t≈0 register data, nothing integrated): t*=${tStar.toFixed(2)} V_min=${vMinPred.toFixed(2)} · MEASURED: ${focus ? `tMin=${(m * dtv).toFixed(2)} V_min=${vs[m].toFixed(2)} → pred/meas t ${(tStar / (m * dtv)).toFixed(3)}, ΔV_min=${(100 * Math.abs(vMinPred - vs[m]) / vs[0]).toFixed(2)}% of V0` : 'no interior focus (chirp≥0 or window too short — the call applies to converging probes)'}`);
          return { vddX, drift, tStar, vMinPred, tMin: m * dtv, vMin: vs[m], focus, vs }; },
        // rekeyTest({dw, sigma, iamp, steps, dt}) — the KERNEL RE-KEY micro-gate (gate F through a kernel
        // TRANSITION): at a swap, V/V̇ are continuous but V̈ jumps — and the jump is closed-form from the two
        // ring DESCRIPTORS alone (virialRateX A vs B, same field). Refusable: run the SAME probe under ring A
        // (the live kernel) and ring B (weights ×(1+dw)) on the real GPU, fit both curvatures, compare the
        // measured ΔV̈ against the descriptor prediction. Linear chirpless run — curvature IS the whole signal.
        // GPU rings restored to the canonical live ring after each leg (the mirror-loop discipline).
        rekeyTest: ({ dw = 0.25, sigma = 8, iamp = 0.05, steps = 120, dt = 0 } = {}) => {
          if (!_gpu || !_E.ringCache?.r?.length) return '[REKEY] gpu/kernel not ready';
          const rc = _E.ringCache, dtv = dt || DT, c = GRID / 2, probe = new Float64Array(2 * N_CELLS);
          for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const dx = x - c, dy = y - c, a = iamp * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
            if (a > 1e-12) probe[(y * GRID + x) * 2] = a; }
          const wB = Array.from(rc.w, (x) => x * (1 + dw));
          const curvOf = (wUse) => { const save = _gpu.readEyePsi(); _gpu.setRings(rc.r, wUse, rc.o); _gpu.setEyePsi(probe);
            const vs = [secondMoment(probe, GRID).V];
            for (let i = 0; i < steps; i++) { _gpu.stepEyeN(1, dtv); vs.push(secondMoment(_gpu.readEyePsi(), GRID).V); }
            _gpu.setRings(rc.r, rc.w, rc.o); _gpu.setEyePsi(save);
            let s0 = vs.length, s1 = 0, s2 = 0, s3 = 0, s4 = 0, b0 = 0, b1 = 0, b2 = 0;
            for (let i = 0; i < vs.length; i++) { const t = i * dtv, v = vs[i]; s1 += t; s2 += t * t; s3 += t * t * t; s4 += t * t * t * t; b0 += v; b1 += v * t; b2 += v * t * t; }
            const det = (a, b, c2, d, e, f2, g, h, i2) => a * (e * i2 - f2 * h) - b * (d * i2 - f2 * g) + c2 * (d * h - e * g);
            const Dm = det(s0, s1, s2, s1, s2, s3, s2, s3, s4);
            return 2 * det(s0, s1, b0, s1, s2, b1, s2, s3, b2) / Dm; };
          const mA = curvOf(rc.w), mB = curvOf(wB);
          const pA = virialRateX(probe, rc.r, rc.w, rc.o, GRID, {}), pB = virialRateX(probe, rc.r, wB, rc.o, GRID, {});
          const dMeas = mB - mA, dPred = pB - pA;
          console.log(`[REKEY] the clock's kernel edit as a REGISTER prediction · ring A = live kernelVer=${_E.kernelVer}, ring B = weights ×${(1 + dw).toFixed(2)} · σ=${sigma} · ${steps} steps`);
          console.log(`[REKEY] V̈_A: meas ${mA.toExponential(4)} pred ${pA.toExponential(4)} · V̈_B: meas ${mB.toExponential(4)} pred ${pB.toExponential(4)}`);
          console.log(`[REKEY] ΔV̈ (the re-key): measured ${dMeas.toExponential(4)} vs descriptor-predicted ${dPred.toExponential(4)} → ratio ${(dMeas / (dPred || 1)).toFixed(4)} ${Math.abs(dMeas / (dPred || 1) - 1) < 0.05 ? '✓ the register calls the kernel edit\'s effect on a live 2nd derivative' : '✗ the jump is not the descriptors\' — a hidden channel moved'}`);
          return { mA, mB, pA, pB, dMeas, dPred, ratio: dMeas / (dPred || 1) }; },
        // wearTest({betas, steps, every}) — LAW 7 GETS ITS GAUGE: İ(β), the sl(2)-work of the injection lock,
        // measured on the LIVE dressed state. For each β: park a copy of the state on the eye pipeline with the
        // REAL maintenance loop (superpose(β) → step → SPM → cap — verbatim the drive's pin sequence, engine
        // γ/Isat, cap at the state's own energy), sample I(t) at bar cadence, İ = LSQ slope. β=0 = the cap+SPM
        // floor (NOT zero — the cap works too); the calibration zero is elTest's linear run. Also reports the
        // lock each β buys — the wear curve is COST vs HOLD, the injection-lock trade measured as one table.
        wearTest: ({ betas = [0, 0.05, 0.1, 0.15, 0.3, 0.6], steps = 210, every = 21 } = {}) => {
          if (!_gpu || !_E.ringCache?.r?.length) return '[WEAR] gpu/kernel not ready';
          const f0 = W.field || ((V.born && V.mirror) ? V.field : null); if (!f0) return '[WEAR] no live field (⌀PDE: start a mirror)';
          const att = W.movAtt(W.leash.state.gx, W.leash.state.gy); if (!att) return '[WEAR] no attractor (W has no operator probe)';
          const rc = _E.ringCache; let e0 = 0; for (let j = 0; j < f0.length; j++) e0 += f0[j] * f0[j];
          const save = _gpu.readEyePsi();
          console.log(`[WEAR] İ(β) — the maintenance power of the injection lock, live state (src=${W.field ? 'W' : 'V-mirror'}, E=${e0.toFixed(1)}) · ${steps} steps/β, engine γ/Isat + cap`);
          const rows = [];
          for (const b of betas) { _gpu.setEyePsi(Float64Array.from(f0)); _gpu.setObjField(att);
            const smp = [];
            for (let i = 0; i < steps; i++) { if (b > 0) _gpu.applyEyeSuperpose(b);
              _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); _gpu.applyEyeEnergyCap(e0);
              if (((i + 1) % every) === 0) { const g = _gpu.readEyePsi(); smp.push({ t: (i + 1) * DT, g, V: secondMomentTorus(g, GRID).V }); } }
            const fEnd = smp[smp.length - 1].g;
            // I at interior samples (per-sample V̈: the state deforms under the lock — a frozen curvature would lie)
            const Is = [];
            for (let j = 1; j < smp.length - 1; j++) { const Vd = (smp[j + 1].V - smp[j - 1].V) / (smp[j + 1].t - smp[j - 1].t);
              const sE = Math.min(48, Math.max(2, Math.sqrt(smp[j].V / (2 * e0))));
              const vdd = virialRateX(smp[j].g, rc.r, rc.w, rc.o, GRID, { gamma: _SOL_GAMMA, isat: _SOL_ISAT, Dq: packetD(rc.r, rc.w, rc.o, sE) });
              Is.push({ t: smp[j].t, I: slCasimir(vdd, smp[j].V, Vd) }); }
            let st = 0, sI = 0, stt = 0, stI = 0; const nI = Is.length;
            for (const p of Is) { st += p.t; sI += p.I; stt += p.t * p.t; stI += p.t * p.I; }
            const Idot = (nI * stI - st * sI) / (nI * stt - st * st || 1);
            const lock = _ampCorr(fEnd, att);
            rows.push({ beta: b, Idot, lock });
            console.log(`[WEAR]   β=${b.toFixed(2)} → İ=${Idot.toExponential(3)} · lock=${lock.toFixed(3)}${b === 0 ? ' (β=0: NOT a floor — the freed state\'s OWN sl(2) slide; pin-maintained states are not free equilibria)' : ''}`); }
          _gpu.setEyePsi(save);
          // THE MEASURED LAW (first live run 2026-07-18, which REFUSED the ~β² cost hypothesis): İ(β) is an
          // ARREST curve — İ falls ~4 orders from the free slide and CROSSES ZERO at the capture threshold
          // (measured β*≈0.15, matching the ≈0.1 locking threshold found independently in the GR-probe arc);
          // past capture a small NEGATIVE residual = the pin's compressive hold + cap work. On a parked state
          // the pin doesn't SPEND work — it ARRESTS invariant flow. The cost reading belongs to a MOVING target.
          let bStar = null; for (let i = 1; i < rows.length; i++) if (rows[i - 1].Idot > 0 && rows[i].Idot <= 0) { bStar = rows[i].beta; break; }
          console.log(`[WEAR] the ARREST curve: İ falls ${rows[0]?.Idot > 0 && rows[rows.length - 1] ? (Math.log10(Math.abs(rows[0].Idot / (rows[rows.length - 1].Idot || 1)))).toFixed(1) : '?'} orders across the sweep${bStar != null ? ` · ZERO-CROSSING at β≈${bStar} = the capture threshold, in the medium's own invariant` : ''} — the pin arrests the state's sl(2) slide; residual İ<0 past capture = compressive hold + cap`);
          return rows; },
        // wearGo({betas, steps, every, vpx}) — LAW 7's SECOND FACE: the pin with a MOVING target. wearTest
        // measured HOLDING (arrest — the pin spends nothing on a parked state); this measures MOVING: for each β,
        // the SAME starting state runs twice — parked, and chasing an attractor that walks +x at vpx px/bar
        // (movAtt regenerated per step, the drive's real transport sequence) — so cost = İ_move − İ_park is a
        // same-state differential. Also lag (centroid behind the final target) and lock vs the final attractor.
        // On record before data: below the capture β* the state loses the target (lag ~ the full walk, cost ≈ 0 —
        // no grip, no work); above β*, cost > 0 = the genuine transport work. The medium shapes the rest.
        wearGo: ({ betas = [0.05, 0.15, 0.3, 0.6], steps = 210, every = 21, vpx = 1 } = {}) => {
          if (!_gpu || !_E.ringCache?.r?.length) return '[WEAR-GO] gpu/kernel not ready';
          const f0 = W.field || ((V.born && V.mirror) ? V.field : null); if (!f0) return '[WEAR-GO] no live field (⌀PDE: start a mirror)';
          const rc = _E.ringCache, L0 = W.leash.state, gx0 = L0.gx, gy0 = L0.gy;
          if (!W.movAtt(gx0, gy0)) return '[WEAR-GO] no attractor';
          let e0 = 0; for (let j = 0; j < f0.length; j++) e0 += f0[j] * f0[j];
          const save = _gpu.readEyePsi();
          const runOne = (b, move) => { _gpu.setEyePsi(Float64Array.from(f0));
            let gx = gx0, att = W.movAtt(gx, gy0); _gpu.setObjField(att);
            const smp = [];
            for (let i = 0; i < steps; i++) { if (move) { gx = gx0 + vpx * (i + 1) / 21; att = W.movAtt(gx, gy0); if (att) _gpu.setObjField(att); }
              if (b > 0) _gpu.applyEyeSuperpose(b);
              _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); _gpu.applyEyeEnergyCap(e0);
              if (((i + 1) % every) === 0) smp.push({ t: (i + 1) * DT, g: _gpu.readEyePsi(), V: 0 }); }
            for (const s of smp) s.V = secondMomentTorus(s.g, GRID).V;
            const Is = [];
            for (let j = 1; j < smp.length - 1; j++) { const Vd = (smp[j + 1].V - smp[j - 1].V) / (smp[j + 1].t - smp[j - 1].t);
              const sE = Math.min(48, Math.max(2, Math.sqrt(smp[j].V / (2 * e0))));
              const vdd = virialRateX(smp[j].g, rc.r, rc.w, rc.o, GRID, { gamma: _SOL_GAMMA, isat: _SOL_ISAT, Dq: packetD(rc.r, rc.w, rc.o, sE) });
              Is.push({ t: smp[j].t, I: slCasimir(vdd, smp[j].V, Vd) }); }
            let st = 0, sI = 0, stt = 0, stI = 0; const nI = Is.length;
            for (const p of Is) { st += p.t; sI += p.I; stt += p.t * p.t; stI += p.t * p.I; }
            const Idot = (nI * stI - st * sI) / (nI * stt - st * st || 1);
            const fEnd = smp[smp.length - 1].g, sm = secondMomentTorus(fEnd, GRID);
            return { Idot, fEnd, att, cx: sm.cx, m: sm.m, gxEnd: gx }; };
          console.log(`[WEAR-GO] transport wear · target walks +x at ${vpx} px/bar (${(vpx / 21 / DT).toFixed(4)} px/engine-t; v*≈0.068 px/step for scale) · ${steps} steps/leg, 2 legs/β (parked + chase, same state)`);
          const rows = [];
          for (const b of betas) { const p = runOne(b, false), m = runOne(b, true);
            let lag = Math.abs((((m.gxEnd % GRID) + GRID) % GRID) - m.cx); if (lag > GRID / 2) lag = GRID - lag;   // wrapped distance (the torus)
            const lock = _ampCorr(m.fEnd, m.att), cost = m.Idot - p.Idot;
            rows.push({ beta: b, IdotPark: p.Idot, IdotMove: m.Idot, cost, lock, lag, mLoc: m.m });
            console.log(`[WEAR-GO]   β=${b.toFixed(2)} → İ_park=${p.Idot.toExponential(2)} İ_chase=${m.Idot.toExponential(2)} · COST=${cost.toExponential(2)} · ${m.m < 0.2 ? `lag n/a (m=${m.m.toFixed(2)} — state fills the torus; a centroid there is noise)` : `lag=${lag.toFixed(1)}px of ${(vpx * steps / 21).toFixed(1)} walked (m=${m.m.toFixed(2)})`} · lock(final tgt)=${lock.toFixed(3)}`); }
          _gpu.setEyePsi(save);
          console.log(`[WEAR-GO] Law 7's two faces: holding = ARREST (wearTest) · moving = COST (this) — the cost column is the transport work in the medium's own invariant`);
          return rows; },
        // vpt() / vptWatch(on) — the virial law WIRED TO THE MEDIUM: one-shot / bar-cadence H(W) reading with the
        // VPT regime flag (H<0 = would-collapse-if-freed — the group-theoretic runaway light, live, ansatz-free).
        vpt: () => { const r = _vptRead(); if (!r) return '[VPT] no field to read — in pure ⌀PDE nothing integrates (H of the declaration is a constant of the compiled envelope); start a mirror for live H';
          console.log(`[VPT] src=${r.src} · H=${r.H.toExponential(3)} (kin ${r.hk.toExponential(3)} + nl ${r.hn.toExponential(3)}) · V=${r.V.toExponential(3)} · E=${r.E.toFixed(1)} → ${r.H < 0 ? '⚠ H<0: would COLLAPSE if freed (the pin+cap are holding it — the VPT call, live)' : 'H>0: would spread if freed'}${r.I != null ? ` · CASIMIR I=${r.I.toExponential(3)}${r.Idot != null ? ` İ=${r.Idot.toExponential(2)}` : ''}${r.tFoc != null ? ` · freed: focus in ${Math.round(r.tFoc / DT)} steps (waist V=${r.vMinP.toExponential(2)})` : r.tCol != null ? ` · freed: V→0 in ${Math.round(r.tCol / DT)} steps` : ''} (V̇ from the last vpt reading — two reads ≥1 bar apart make the forecast)` : ' (first reading — call again next bar for the Casimir tier: V̇ needs two shared-bar samples)'}`); return r; },
        vptWatch: (on = true, every = 4) => { _vptOn = !!on; _vptEvery = Math.max(1, every | 0); return `[VPT] watch ${on ? `ON — H + regime every ${_vptEvery} bars (src: W's field, or the MIRROR in ⌀PDE${(!W.field && !(V.born && V.mirror)) ? ' — NO FIELD YET: pure ⌀PDE has nothing integrating; press mirror for live H' : ''})` : 'OFF'}`; },
        // sl2() — the REGISTER-RESIDENT sl(2) charges (⌀PDE): what the register asserts about V/V̈/I with zero
        // field reads, vs the witness if a mirror is running. The meta-circular claim made inspectable.
        sl2: () => { if (!W.desc) return '[SL2] field mode — the witness IS the state; the register tier lives in ⌀PDE';
          if (!W.sl2) return '[SL2] no tier yet (compiles at the wabs/autoc door, or lazily next frame)';
          const r = _vptRead();
          console.log(`[SL2] REGISTER: V=${W.sl2.V.toExponential(3)} V̈=${W.sl2.vdd.toExponential(3)} I=${W.sl2.I.toExponential(3)} (kv=${W.sl2.kv}, m=${W.sl2.m.toFixed(2)}) · aging law: HELD ⇒ stationary (arrest, measured) · freed ⇒ ${W.sl2.vdd > 0 ? 'spreads (V̈>0)' : 'focuses/collapses (V̈<0)'}${r ? ` · WITNESS: V=${r.V.toExponential(3)} Δ=${(100 * (r.V / W.sl2.V - 1)).toFixed(1)}%` : ' · no witness (pure ⌀PDE — the assertion stands unverified, by design)'}`);
          return { reg: W.sl2, wit: r ? { V: r.V, I: r.I } : null }; },
        // grip() — the wear constants applied to the CURRENT drive (Law 7's verdict, from the measured curves).
        grip: () => { const b = _pinBeta, bs = _WEAR.betaStar;
          const verdict = b < bs ? `SHED regime (β=${b.toFixed(2)} < β*≈${bs}): a moving target radiates the state instead of carrying it — transport is ~50–380× dearer here; hold is also below capture (the state slides)` : `RIDE regime (β=${b.toFixed(2)} ≥ β*≈${bs}): holding ≈ free (arrest), transport cost ~linear in speed (torque·v)`;
          console.log(`[GRIP] ${verdict} · measured 2026-07-18 (wearTest zero-crossing + wearGo two-speed sweep); β* matches the GR-probe locking threshold ≈0.1 independently`);
          return { beta: b, betaStar: bs, regime: b < bs ? 'shed' : 'ride' }; },
        // qTest({sigma, steps, sample, gamma, isat, iamp}) — GATE C ORACLE: the q REGISTER (width σ + chirp b,
        // medium-core qStep — the engine's OWN recipe projected onto the Gaussian ansatz) vs the REAL nonlinear
        // engine step (stepEyeN + applyEyeNlSpm + applyEyeEnergyCap — exactly the drive's stepSoliton), same probe,
        // same params, side by side. Off the drive path (eye saved/restored). What to compare:
        //   • the σ(t) TRAJECTORY (breathing/contraction) — register (pure f64, zero grid) vs GPU (ground truth);
        //   • the FIXED POINT σ* (qFixedPoint) vs the late-time GPU width — saturation-arrested-Townes, derived;
        //   • REGIME calls: qTest({isat:1e9, iamp:0.05}) → cubic sub-critical 'spread'; iamp big → 'collapse'
        //     (RUNAWAY predicted by the register BEFORE the grid shows it — the earned version of the old claim).
        // Engine-params PREDICTION already in the model: the free equilibrium is a TIGHT core (σ*≈1–2 px, deep
        // saturation) — the wide soliton shape in the demo is held by the PIN (injection lock), not free NL balance;
        // expect the GPU trajectory to CONTRACT toward px scale, arrested by grid/lattice effects the ansatz
        // doesn't model (that arrest gap is the honest finding, not a failure).
        qTest: ({ sigma = 10, steps = 1200, sample = 60, gamma = _SOL_GAMMA, isat = _SOL_ISAT, iamp = 1 } = {}) => {
          if (!_gpu || !_E.ringCache?.r?.length) return '[QTEST] gpu/kernel not ready';
          const rc = _E.ringCache;
          const c = GRID / 2, probe = new Float64Array(2 * N_CELLS); let P0 = 0;
          for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const dx = x - c, dy = y - c, a = iamp * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
            if (a > 1e-12) { probe[(y * GRID + x) * 2] = a; P0 += a * a; } }
          // TWO width observables (a collapsing/saturated field forms core + RADIATION HALO — the second moment is
          // halo-dominated and can GROW while a tight core forms; r50 is halo-resistant):
          //   sig  = √⟨r²⟩_I (2nd moment — halo-inclusive) · core = r50/√ln2 (the median-energy radius, Gaussian-
          //   normalized so core == σ for a true Gaussian) · imax = peak intensity (core formation → imax rises).
          const wid = (f) => { let E = 0, cx = 0, cy = 0, imax = 0; for (let j = 0; j < N_CELLS; j++) { const a2 = f[j * 2] ** 2 + f[j * 2 + 1] ** 2; E += a2; if (a2 > imax) imax = a2; cx += (j % GRID) * a2; cy += ((j / GRID) | 0) * a2; }
            cx /= E || 1; cy /= E || 1; let s2 = 0; const hist = new Float64Array(2 * GRID);
            for (let j = 0; j < N_CELLS; j++) { const a2 = f[j * 2] ** 2 + f[j * 2 + 1] ** 2, dx = (j % GRID) - cx, dy = ((j / GRID) | 0) - cy, r2 = dx * dx + dy * dy; s2 += r2 * a2;
              const bin = Math.min(2 * GRID - 1, Math.round(Math.sqrt(r2) * 2)); hist[bin] += a2; }   // ½-px radial bins
            let acc = 0, r50 = 0; for (let bIdx = 0; bIdx < hist.length; bIdx++) { acc += hist[bIdx]; if (acc >= E / 2) { r50 = bIdx / 2; break; } }
            return { sig: Math.sqrt(s2 / (E || 1)), core: r50 / Math.sqrt(Math.LN2), imax }; };
          // the register's D̄(σ): packetD at the CURRENT width (gate B's lesson), cached per 0.25-px bucket, σ clamped
          // ≥1.3 for the fit band (kMax = 4/σ must stay inside the Brillouin zone — below that the ansatz is off-model anyway)
          const _dCache = new Map();
          const Dof = (s) => { const sc = Math.max(1.3, s), key = Math.round(sc * 4); if (!_dCache.has(key)) _dCache.set(key, packetD(rc.r, rc.w, rc.o, key / 4)); return _dCache.get(key); };
          const fp = qFixedPoint({ Dof, gamma, isat, P: P0, lo: 0.4 });
          // GPU trajectory (the ground truth — the drive's exact stepSoliton recipe)
          const save = _gpu.readEyePsi(); _gpu.setEyePsi(probe);
          const rows = [];
          for (let i = 0; i < steps; i++) { _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-gamma, isat, DT); _gpu.applyEyeEnergyCap(P0);
            if (((i + 1) % sample) === 0) { const wq = wid(_gpu.readEyePsi()); rows.push({ step: i + 1, gpu: wq.sig, core: wq.core, imax: wq.imax }); } }
          _gpu.setEyePsi(save);
          // register trajectory (pure f64 — zero grid work). ADAPTIVE SUBSTEPS: the linear half is exact at any dt,
          // but the SPM kick is Euler — near a tight core (breathing period ~15 steps) one dt=0.12 kick overshoots.
          // Substep so the per-substep state change stays ≲2%. COLLAPSE GUARD: σ < 0.5 px = the model has left its
          // validity domain (the lattice arrests what the ideal-plane ansatz cannot) → declare collapse and STOP —
          // never integrate through the singularity (the 1e5-px σ_reg garbage of the first run).
          const st = { sigma, b: 0, phi: 0, P: P0 }; let ri = 0, collapsedAt = 0;
          for (let i = 0; i < steps; i++) {
            if (!collapsedAt) {
              const D0 = Dof(st.sigma);
              const bdot = D0 / st.sigma ** 4 - D0 * st.b * st.b + qSpmRate(st.sigma, st.P, gamma, isat).rb;
              const frac = (Math.abs(D0 * st.b) + Math.abs(bdot) * st.sigma * st.sigma) * DT;   // ~relative state change per dt
              const nS = Math.min(400, Math.max(1, Math.ceil(frac / 0.02)));
              for (let s2 = 0; s2 < nS; s2++) { qStep(st, { D: Dof(st.sigma), gamma, isat, dt: DT / nS });
                if (st.sigma < 0.5) { collapsedAt = i + 1; break; } }
            }
            if (((i + 1) % sample) === 0 && rows[ri]) rows[ri++].reg = collapsedAt ? null : st.sigma;
          }
          console.log(`[QTEST] σ0=${sigma} iamp=${iamp} P0=${P0.toFixed(1)} γ=${gamma} Isat=${isat} dt=${DT} · ${steps} steps · kernelVer=${_E.kernelVer}`);
          console.log(`[QTEST] register prediction: ${fp.sigma != null ? `σ*=${fp.sigma.toFixed(2)} px (${fp.stable ? 'STABLE' : 'unstable'}) · breathing Ω=${fp.Omega.toExponential(2)}/t → period ≈ ${Math.round(fp.period / DT)} steps` : `NO fixed point → regime=${fp.regime?.toUpperCase()} ${fp.regime === 'collapse' ? '(RUNAWAY — derived, not observed)' : '(below the minimum soliton power — will spread)'}`}${collapsedAt ? ` · register COLLAPSED @step=${collapsedAt} (σ<0.5 px — validity edge; the LATTICE arrests what the ideal plane cannot: kKnee physics)` : ''}`);
          for (const r of rows) console.log(`  step=${String(r.step).padStart(5)} · σ_gpu=${r.gpu.toFixed(3)} (2nd-mom, halo-incl) · core_gpu=${r.core.toFixed(3)} · I_max=${r.imax.toExponential(2)} · σ_reg=${r.reg != null ? r.reg.toFixed(3) : `⊘ collapsed@${collapsedAt}`}${r.reg != null ? ` · Δcore=${(100 * (r.reg - r.core) / r.core).toFixed(1)}%` : ''}`);
          const late = rows.slice(-5);
          console.log(`[QTEST] late-time: core_gpu ≈ ${(late.reduce((a, r) => a + r.core, 0) / late.length).toFixed(3)} px (σ_gpu 2nd-mom ${(late.reduce((a, r) => a + r.gpu, 0) / late.length).toFixed(2)} — the difference IS the radiation halo) vs register ${fp.sigma != null ? `σ*=${fp.sigma.toFixed(2)}` : `(${fp.regime}${collapsedAt ? ` @${collapsedAt}` : ''})`} — compare σ* against CORE, not the halo-inclusive moment. Known model boundary: saturated cores are FLAT-TOPPED (super-Gaussian) — the Gaussian projection overestimates focusing near I0≈Isat (gate D: mode ladder / flat-top parameter).`);
          return { rows, fp, P0, collapsedAt }; },
        // specTest({T, sigma, useW, kCut}) — GATE D ORACLE: the SPECTRAL register propagator (kernelPropagateSpectral —
        // the engine's discrete linear step DIAGONALIZED; regression-proven ≡ the leapfrog to 1e-10) vs the real GPU
        // stepEyeN(T), same field. Expected agreement = the f32 floor (the CPU path is the SAME linear map in f64) —
        // a pass means the ±T hologram legs (record/store/recall propagation) are REGISTER-RESIDENT EXACTLY: dipole,
        // non-quadratic band, numerical dispersion, everything (no paraxial slice, no packet averaging). Also runs
        // the kCut-TRUNCATED propagation — the clock's own passband as a COMPRESSION LAW for descriptor plates
        // (fidelity + kept-mode ratio = the honest compression number). useW:true tests the real dressed soliton.
        specTest: ({ T = _VIRT_T, sigma = 8, useW = false, kCut = 0 } = {}) => {
          if (!_gpu || !_E.ringCache?.r?.length) return '[SPECTEST] gpu/kernel not ready';
          const rc = _E.ringCache;
          let f0;
          if (useW && W.field) f0 = Float64Array.from(Float32Array.from(W.field));   // f32-quantized start (GPU truth — both paths begin from identical bytes)
          else { const c = GRID / 2; f0 = new Float64Array(2 * N_CELLS);
            for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const dx = x - c, dy = y - c, a = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
              if (a > 1e-12) { const i = (y * GRID + x) * 2, ph = 0.15 * dx; f0[i] = a * Math.cos(ph); f0[i + 1] = a * Math.sin(ph); } }
            f0 = Float64Array.from(Float32Array.from(f0)); }
          const save = _gpu.readEyePsi();
          _gpu.setEyePsi(f0); _gpu.stepEyeN(T, DT); const gFwd = _gpu.readEyePsi(); _gpu.setEyePsi(save);
          const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          const sFull = kernelPropagateSpectral(f0, rc.r, rc.w, rc.o, { T, dt: DT, G: GRID });
          const tMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
          // the STATE's own spectral band: |ψ̂(k)|² radial cumulative → k50/k90/k99. THE GATE-D LESSON (measured on
          // the dressed soliton: 2×kKnee cut → fidelity 0.32): a PINNED state lives ABOVE the clock's knee — the pin
          // re-injects sharp probe content every step, so kKnee bounds the FREE dynamics, NOT the maintained state.
          // The honest compression cut is therefore STATE-ADAPTIVE (default k99); the clock band prints as reference.
          const pr = new Float64Array(N_CELLS), pi = new Float64Array(N_CELLS);
          for (let j = 0; j < N_CELLS; j++) { pr[j] = f0[j * 2]; pi[j] = f0[j * 2 + 1]; }
          fft2d(pr, pi, GRID, false);
          const bins = new Float64Array(4 * GRID); let Etot = 0;
          for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const j = y * GRID + x;
            const kx2 = 2 * Math.PI * (x <= GRID / 2 ? x : x - GRID) / GRID, ky2 = 2 * Math.PI * (y <= GRID / 2 ? y : y - GRID) / GRID;
            const e = pr[j] * pr[j] + pi[j] * pi[j]; Etot += e;
            bins[Math.min(bins.length - 1, Math.round(Math.hypot(kx2, ky2) * 100))] += e; }   // 0.01 rad/px radial bins
          const kAt = (frac) => { let acc = 0; for (let b2 = 0; b2 < bins.length; b2++) { acc += bins[b2]; if (acc >= frac * Etot) return b2 / 100; } return Math.PI; };
          const k50 = kAt(0.5), k90 = kAt(0.9), k99 = kAt(0.99);
          const knee = rc.r?.length ? 2.404825557695773 / Math.max(...rc.r) : 0.3;
          const kc = kCut || Math.max(0.05, k99);   // state-adaptive default
          const sCut = kernelPropagateSpectral(f0, rc.r, rc.w, rc.o, { T, dt: DT, G: GRID, kCut: kc });
          const corrFull = _ampCorr(sFull.field, gFwd), corrCut = _ampCorr(sCut.field, gFwd), dphi = phaseCorr(sFull.field, gFwd);
          let md = 0, pk = 0; for (let j = 0; j < gFwd.length; j++) { md = Math.max(md, Math.abs(sFull.field[j] - gFwd[j])); pk = Math.max(pk, Math.abs(gFwd[j])); }
          console.log(`[SPECTEST] T=${T} dt=${DT} · field=${useW ? 'W.field (the dressed soliton)' : `Gaussian σ=${sigma}, tilt k=0.15`} · kernelVer=${_E.kernelVer}`);
          console.log(`[SPECTEST] FULL spectral vs GPU: ampCorr=${corrFull.toFixed(7)} · phase Δ=${dphi.toExponential(2)} rad · max|Δ|=${md.toExponential(2)} (=${(100 * md / (pk || 1)).toFixed(3)}% of peak — expected: the f32 floor; the CPU path IS the same discrete map in f64) · CPU ${tMs.toFixed(1)}ms — pass ⇒ the ±T hologram legs are register-resident EXACTLY`);
          console.log(`[SPECTEST] state band: k50=${k50.toFixed(2)} k90=${k90.toFixed(2)} k99=${k99.toFixed(2)} rad/px · clock knee kKnee=${knee.toFixed(2)} — ${k90 > knee ? 'the state lives ABOVE the knee (pin-maintained: the knee bounds free dynamics, not held states)' : 'the state sits inside the clock passband'}`);
          console.log(`[SPECTEST] TRUNCATED @kCut=${kc.toFixed(3)}${kCut ? '' : ' (state-adaptive k99)'}: ampCorr=${corrCut.toFixed(6)} · modes kept ${sCut.kept}/${sCut.total} = ${(100 * sCut.kept / sCut.total).toFixed(1)}% → descriptor-plate compression ×${(sCut.total / Math.max(1, sCut.kept)).toFixed(0)}`);
          return { corrFull, corrCut, dphi, maxDiff: md, k50, k90, k99, knee, kept: sCut.kept, total: sCut.total, ms: tMs }; },
        aphase: (a = 0.1, slot = 'W') => injectEvent?.({ type: 'mediumVirt', mode: 'aphase', amp: +a, src: slot }),
        lensTau: (w = 0.1) => injectEvent?.({ type: 'mediumVirt', mode: 'lenstau', amp: +w }),
        // regTrace(on) — the DETERMINISM GATE instrument: log [REGH] step=… regH=… fieldH=… on a SHARED cadence (every
        // 200 steps, a pure fn of the shared step so both peers log at the SAME step= values). Compare the two consoles:
        // regH MUST match line-for-line at equal step= (the contract); fieldH may differ (benign). Off by default.
        regTrace: (on = true, every = 4) => { _regTraceOn = !!on; _detEvery = Math.max(1, every | 0); return `[DET] trace ${_regTraceOn ? `ON — every ${_detEvery * Q} steps · compare regH + solH across peers at equal solStep= (regTrace(true,1) = every ${Q} steps to find the first fork)` : 'OFF — field ENFORCEMENT dropped: W runs AS ITS OWN MIRROR (deterministic by construction, verified never; the register/regH stays the whole contract — the mirror-mode performance, on the live W canvas)'}`; },
        // pin(β) — the IMAGE-CONVERGENCE tuner (finding_pin_injection_lock): raise β to tighten lock→A. A tight lock means
        // each peer's ψ ≈ the shared attractor A ≈ every peer's ψ → the images converge (no field exchange, pure local
        // lock to a regH-shared reference). Watch 'lock→A' in the status climb toward 1 as you raise β. Set the SAME β on
        // both peers to compare fairly (it's a local render dial, not replicated). Original capped ~0.45; try 0.3–0.45.
        pin: (b) => { if (typeof b === 'number') _pinBeta = Math.max(0, Math.min(1, b)); return `[PIN] β=${_pinBeta.toFixed(2)} · lock→A now ${_E.lockNow.toFixed(3)} (→1 = images converge to the shared attractor)`; },
        // ⟲coevo(on) — the honest ℂ* EINSTEIN LOOP: matter's energy state throttles its own transport ("matter tells
        // geometry how far it may go"). ON = the leash advance is gated by a gain observable; OFF = open-loop (the target
        // never waits for matter — the pure DOP replay). Watch 'coevo g' in the status: 1 = matter kept up (full advance),
        // →0 = matter lagging (the target throttles/waits). Drag shiftX fast to see g dip and the target hold back.
        edge: (a = 'W', b = 'V', kap = 0.2) => { const ia = SLOTN.indexOf(String(a)), ib = SLOTN.indexOf(String(b));
          if (ia < 0 || ib < 0 || ia === ib) return '[EDGE] usage: mu1.edge("W","V",±κ) — slots W/V/P1/P2, κ∈[−0.5,0.5]; κ<0 = anti-align (frustration)';
          injectEvent?.({ type: 'mediumVirt', mode: 'edge', gx: ia, gy: ib, leak: +kap });
          return `[EDGE] ${SLOTN[ia]}⇄${SLOTN[ib]} κ=${(+kap).toFixed(2)} injected (replicated; the XY law runs per shared bar on the REGISTER phases — watch [KUR]). K₃ frustration: edge(W,V,−.2); edge(W,P1,−.2); edge(V,P1,−.2)`; },
        edges: () => { if (!_K.edge) return '[EDGE] none set (mu1.edge(a,b,κ))'; _K.edge.forEach((r, i) => console.log(`  ${SLOTN[i]}: [${r.map((v) => v.toFixed(2)).join(', ')}]`)); return _K.edge; },
        coevo: (on = true) => { injectEvent?.({ type: 'mediumVirt', mode: 'coevo', amp: on ? 1 : 0 }); return `[COEVO] Einstein loop → ${on ? 'ON' : 'OFF'} (replicated: lands at the shared step on every peer — it gates gx/gy, which is in regH)`; },
        // unpin(on) — THE GOVERNANCE SWITCH (lensU1 ⇄ lensC1). PINNED (default): the coevo gate reads the DESCRIPTOR-
        // predicted lag → pure leash arithmetic → in regH → byte-deterministic. UNPINNED: the gate reads the TRUE FIELD
        // ENERGY (E(ψ)/e0) → real matter-energy back-reaction (the momentum channel; the honest v* becomes reachable) →
        // but the leash now depends on a field read, so determinism rides on the f32 Q-boundary quantization holding.
        // This IS the doc's determinism↔liveness trade, made a one-call choice. Compare regH across peers after unpinning.
        unpin: (on = true) => { injectEvent?.({ type: 'mediumVirt', mode: 'unpin', amp: on ? 1 : 0 }); return `[UNPIN] → ${on ? 'lensC1 (gain FREE: the coevo gate reads TRUE field energy — honest matter back-reaction, the momentum channel; regH may fork since the leash now reads the field)' : 'lensU1 (gain≡1: descriptor-predicted lag — replay-safe, byte-deterministic)'} (replicated: lands at the shared step)`; },
      };
    }

    // ── THE SLOT MUX (S2): advances non-home slots when they own k. At S3 only W is born (nSl=1) → mux inert,
    //    but wired now so V/P (S5/S6) drop in with zero driver change — the point of the slot model. ──
    const _mux = makeSlotMux({
      gpu: () => _gpu, engine: _E, muxClocks, K: _K, DT, SOL_GAMMA: _SOL_GAMMA, SOL_ISAT: _SOL_ISAT, Q,
      beta: (i) => _pinBeta * (_lensOp[i].beta || 1),
      kApply: () => {}, selfClkTick: () => {}, tauAdv: () => {}, applyOpenBoundary: (f) => f,
      ampCorr: _ampCorr, boundOpen: () => false, selfClk: () => null, leashDue, beatsOf: () => null,
    });

    const _frame = () => {
      const _lagT0 = (_lagOn && typeof performance !== 'undefined') ? performance.now() : 0;
      if (!_gpuReady || !_gpu) { hdr.textContent = 'medium-u1 · waiting for IFSGpu…'; return; }
      const n = world.getNodeState('mediumU1') || {};
      // JOIN: the framework applied a leader's WS snapshot → restore VERBATIM then track forward (medium.js idiom).
      // ONLY consume _snapshotApplied WHEN medSnapU1 IS ACTUALLY PRESENT. Clearing the flag while the payload hasn't landed
      // yet (framework sets the flag on the frame the WS snapshot arrives, but our medSnapU1 key can be revived a frame
      // later) would LOSE the restore forever → the joiner falls through to self-seed → permanent desync (the intermittent
      // "several reloads" flakiness). Leave the flag set until the payload is here; the snapshot-grace below holds meanwhile.
      const _wApp = world?.ps?.app;
      // JOIN-TRACE: log the flag/payload state whenever _snapshotApplied is set, so a bad join (flag but no payload, or
      // payload but grace already self-seeded) is visible instead of silent. One-shot per applied flag.
      if (_wApp && _wApp._snapshotApplied && !_joinTraced) { _joinTraced = true;
        console.log(`[MU1-JOINTRACE] _snapshotApplied=true · medSnapU1=${_wApp.medSnapU1 ? 'PRESENT' : 'MISSING'} · solInit=${_E.solInit} solSeeded=${_solSeeded} readyFrames=${_E.readyFrames} n.time=${(n.time ?? 0).toFixed(2)}`); }
      if (_wApp && _wApp._snapshotApplied && _wApp.medSnapU1) { _wApp._snapshotApplied = false; _restoreSnap(_wApp.medSnapU1, n); _wApp.medSnapU1 = null; }
      _E.monClock = (n.time ?? 0) * _MON_RATE; _E.monDir = (n.direction ?? 1); _E.frameBar = Math.floor((n.cycleCount ?? 0) / 4);
      if (typeof n.medDrive === 'string' && (n.medDrive === 'transport' || n.medDrive === 'objorbit') && n.medDrive !== _driveMode) { _driveMode = n.medDrive; _driveBtn.textContent = `drive:${_driveMode}`; }
      const tgtX = (typeof n.medShiftX === 'number') ? n.medShiftX : 0, tgtY = (typeof n.medShiftY === 'number') ? n.medShiftY : 0;   // slider REFLECTION only (display); the DRIVE target comes from the stamped shift queue (below)
      // PULL the world's stamped shift intermediates into the kernel queue (each gets startStep = a pure fn of the shared
      // clock). A slide streams many intermediates; each is applied at ITS shared step in the drive loop → both peers move
      // the target at the SAME step regardless of frame timing (the field-fork-on-slider fix — finding_mux_determinism).
      _siShift.pull(n.shiftQueue, (e) => ({ toX: e.toX ?? 0, toY: e.toY ?? 0 }));   // stamp each new shift intermediate to its shared step
      // STATUS: regH = the DESCRIPTOR-tier determinism hash (the CONTRACT — two peers MUST match at equal step=). lock =
      // ampCorr(ψ, A) = the IMAGE-CONVERGENCE observable: A (=Op·probe) is byte-identical across peers (regH proves it), so
      // a TIGHT lock (→1) means each peer's field ≈ A ≈ every other peer's field — the images converge WITHOUT any field
      // exchange (a local injection-lock to a shared reference, like independent PLLs to a broadcast clock). fieldH = the
      // raw ψ digest (informational; it never goes byte-identical on GPUs — the lock is the honest convergence measure).
      hdr.textContent = `medium-u1 (SLOT-CENTRIC) · ${n.cachedRadii?.length ? 'RUNNING' : 'waiting…'} · drive:${_driveMode}${W.desc ? ' · ⌀PDE ABSTRACT (register closed — 0 grid steps/frame)' : ''}${_tempoDiv > 1 ? ` · tempo÷${_tempoDiv}` : ''} · β ${_pinBeta.toFixed(2)} · lock→A ${W.desc ? '≡1 (W IS the descriptor)' : _E.lockNow.toFixed(2)} · ${_coevoOn ? `⟲coevo g ${_coevoG.toFixed(2)}${_unpinned ? ' [ℂ* unpinned: TRUE field energy]' : ' [U(1) pinned: predicted lag]'}` : '⟲coevo OFF (open-loop)'} · step ${_E.solSteps} · regH ${_regH()} (MUST match) · ${W.desc ? 'solH — (no field)' : _regTraceOn ? `solH@${_solHStep} ${_solH} (field @ shared boundary — compare peers here)` : 'solH — (unverified: W as its own mirror)'}${_vptLast ? ` · H ${_vptLast.H.toExponential(2)}${_vptLast.H < 0 ? ' ⚠pin-held' : ''}` : ''}`;
      if (_absBtn._on !== !!W.desc) { _absBtn._on = !!W.desc; _absBtn.textContent = W.desc ? '⌀PDE:ON' : '⌀PDE'; _absBtn._repaint(); }   // reflect the replicated state (position mirrors state)
      const _modeNow = W.desc ? 'mode:⌀register' : 'mode:physics';
      _coevoBtn._on = _coevoOn; _coevoBtn.style.opacity = _coevoOn ? 1 : 0.6; _unpinBtn._on = _unpinned; _unpinBtn.style.opacity = _unpinned ? 1 : 0.6;
      if (_modeBtn.textContent !== _modeNow) { _modeBtn.textContent = _modeNow; _modeBtn._on = !!W.desc; _modeBtn._repaint(); }
      if (_xattBtn._on !== _xattOn) { _xattBtn._on = _xattOn; _xattBtn.textContent = _xattOn ? 'x𝔸tt:ON' : 'x𝔸tt'; _xattBtn._repaint(); }
      if (!n.cachedRadii?.length) return;
      _E.readyFrames++;
      // IFS-KERNEL SWAP — keyed on cachedRadiiVersion (the fractal clock's ring-change counter), NOT genomeVer (manual
      // edits only). BEFORE the soliton drive (cold/first-load): apply immediately at the frame — no soliton stepping yet
      // to fork. ONCE the soliton runs: STAGE each pending change at its SHARED step (cachedRadiiTime → step) so both peers
      // swap the kernel at the identical solStep INSIDE the loop (see the drive loop). This is the fork you kept naming
      // ("not in proper time"): the kernel is a per-step physics input and must advance on the shared step, not the frame.
      const _kernVer = n.cachedRadiiVersion | 0;
      const _kernRunning = (_driveMode === 'transport' || _driveMode === 'objorbit') && _E.solInit;
      if (!_kernRunning) {
        if (_E.kernelVer !== _kernVer) { _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets); _E.kernelVer = _kernVer; _E.ringCache = { r: n.cachedRadii, w: n.cachedWeights, o: n.cachedOffsets }; _pendKern.length = 0; }
      } else if (_E.kernelVer !== _kernVer) {
        // COLD-SNAP ONLY WHEN FAR-BEHIND (the oracle guard, line 2207): if our version is older than the OLDEST queue entry
        // minus one, the queue can't replay the gap → snap to the node kernel at this frame (peer-local, accepted only when
        // there's genuinely no queue to replay). OTHERWISE always STAGE from the queue at each change's SHARED step — even
        // versions this peer skipped (rendered slowly) are in the queue → both peers replay the IDENTICAL ordered sequence
        // at IDENTICAL steps. THE BUG THIS FIXES: cold-snapping whenever `pending` was momentarily empty applied the kernel
        // at a PEER-LOCAL frame → the two peers swapped at different solSteps → the field forked right at the kV bump (live-
        // caught: solH matched through kV=51 then forked exactly at 51→52). Staging keys the swap to the shared step.
        const q = Array.isArray(n.kernelQueue) ? n.kernelQueue : [];
        const oldestQ = q.length ? Math.min(...q.map((e) => e.ver | 0)) : (_kernVer + 1);
        if (_E.kernelVer < oldestQ - 1) { const qs = _gpu.readEyePsi(); _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets); _gpu.setEyePsi(qs); _E.kernelVer = _kernVer; _E.ringCache = { r: n.cachedRadii, w: n.cachedWeights, o: n.cachedOffsets }; _pendKern.length = 0;
          console.log(`[MU1-KSNAP] cold-snap kernel ver=${_kernVer} at frame (solSteps=${_E.solSteps}, oldestQ=${oldestQ}) — far behind, queue can't replay the gap`); }
        else { for (const e of q) { if ((e.ver | 0) > _E.kernelVer && !_pendKern.some((p) => (p.ver | 0) === (e.ver | 0))) {
              const _off = (e.o || []).map((tier) => Array.from(tier || []));   // deep-copy tiers (survive the node→setRings path intact)
              _pendKern.push({ startStep: _kernStep(e.time ?? 0), r: e.r, w: e.w, o: _off, ver: e.ver | 0 }); } }
          _pendKern.sort((a, b) => a.startStep - b.startStep); }
      }

      // ── S6 VERB DRAIN (record/store/recall/aphase/lenstau — the register + holography verbs) — replayed from the
      //    replicated log at the frame (they mutate at the shared drain; the field-plate GPU round-trips are pure) ──
      // EVERY medium verb is STAMPED to a shared step and drained in the drive loop (via _siReg). This includes record/store/
      // recall: record BIRTHS V, and V's birth STEP determines how many steps V has run since (its vKv trajectory). Draining
      // it at the peer-local FRAME forked V (live-caught: after rec, vKv=14 on one peer, 21 on the other at the SAME solStep).
      // Register verbs (refamp/aphase/lenstau) write _lensOp (in regH + fed to the field). ALL land at the identical shared step.
      // The verb log is normally the replicated array; when a peer has only the latest fields (no log yet), synthesize a
      // one-entry log so the FIRST verb still stamps. _siReg's seq cursor guards against double-staging on re-read.
      const _vlog = (Array.isArray(n.medVirtLog) && n.medVirtLog.length) ? n.medVirtLog
        : ((n.medVirtSeq | 0) > _siReg.seen ? [{ seq: n.medVirtSeq | 0, time: n.medVirtTime ?? 0, mode: n.medVirtMode || 'record', amp: (typeof n.medVirtAmp === 'number') ? n.medVirtAmp : 0, src: n.medVirtSrc || 'W', gx: n.medVirtGx ?? 0, gy: n.medVirtGy ?? 0, leak: n.medVirtLeak ?? 0 }] : []);
      _siReg.pull(_vlog, (e) => ({ mode: e.mode, src: e.src || 'W', amp: (typeof e.amp === 'number') ? e.amp : 0, gx: (typeof e.gx === 'number') ? e.gx : 0, gy: (typeof e.gy === 'number') ? e.gy : 0,
        kx: (typeof e.kx === 'number') ? e.kx : undefined, ky: (typeof e.ky === 'number') ? e.ky : undefined }));   // gx/gy ride for descgo (the 𝔸-slot leash target); kx/ky for lensset (the linOp momentum tilt)

      // GRACE (first-load fix): on a fresh page the world clock's n.time can arrive in a settling burst right as the
      // GPU becomes ready — anchoring c0 mid-burst leaves a backlog. Hold a few ready-frames so monClock is stable
      // BEFORE the first anchor. Fresh single peer (no snapshot) still seeds; this only delays the anchor a beat.
      if (!_E.solInit && _E.readyFrames < 4) { hdr.textContent += ' · settling…'; return; }
      // SNAPSHOT GRACE (the "seed in snapshot" JOIN-STABILITY fix — ported from the oracle §_SNAP_GRACE, lines 2254-2260).
      // THE BUG (your report, and the oracle's line 800): a JOINER that self-seeds from scratch BEFORE the WS field snapshot
      // arrives becomes an INDEPENDENT fresh peer (its own solSteps=0, its own field) → permanently OUT OF SYNC with the
      // leader; only a LUCKY reload where the snapshot happens to land within the tiny window syncs it (the "several reloads"
      // flakiness). FIX: if a snapshot is EXPECTED (we joined a world that is ALREADY RUNNING — n.time/kernelVer已advanced,
      // not a fresh empty world), HOLD self-seeding for up to _SNAP_GRACE ready-frames, giving the WS snapshot (_snapHook →
      // _snapshotApplied → _restoreSnap, above) time to land. Only if it never comes (grace expires) do we self-seed. The
      // snapshot restore sets solInit=true, so once it lands this block is skipped and the joiner tracks the leader's field.
      if (!_E.solInit) {
        // "SNAPSHOT EXPECTED" = am I a genuine JOINER (other peers already in the selo), NOT a fresh sole-member leader?
        // Use the FRAMEWORK ROSTER (seloRoster.count/joinOrder at join): a fresh leader joins as the SOLE member (count===1
        // → no snapshot will EVER come); a joiner joins with others present. THE BUG THIS FIXES: the old heuristic keyed on
        // the WORLD CLOCK (n.time>3 || cachedRadiiVersion>2) — but a FRESH LEADER's own IFS world clock has usually already
        // ticked past that by the time the medium's first frame runs → the leader wrongly thought it was a joiner → WAITED
        // INDEFINITELY for a snapshot that never comes → BLACK SCREEN on fresh load (reload timing differed → seeded → image).
        const _roster = world?.ps?.app?.seloRoster || world?.ps?.getSeloRoster?.() || null;
        const _joinOrder = _roster ? (_roster.joinOrder | 0) : 0;
        const _snapExpected = _joinOrder > 1;   // joined AFTER at least one other peer → a leader exists → a field snapshot should come
        if (_snapExpected) { hdr.textContent += ` · joining (awaiting snapshot, ${_E.readyFrames}f)…`;
          if (_E.readyFrames === _SNAP_GRACE) console.log(`[MU1-WAIT] snapshot not yet applied after ${_SNAP_GRACE} ready-frames (joinOrder=${_joinOrder} rosterCount=${_roster?.count} _snapshotApplied=${!!_wApp?._snapshotApplied} medSnapU1=${_wApp?.medSnapU1 ? 'PRESENT' : 'missing'}) — still waiting (a joiner never self-seeds while a leader exists)`);
          return; }
      }
      // the step budget (§7.44); transport is a snapshot mode → high cap for byte-identical clocked replay
      if (!_E.solInit) { _stepClk.c0 = _E.monClock; _E.solSteps = 0; _E.kwSteps = 0; _E.solInit = true; _bootSeedBar = _E.frameBar;
        // REGISTER-BORN (no physics flash): when the register default is armed, the symbol is injected
        // DIRECTLY into the abstract register — desc from step 0, the field branch never runs, the mode
        // button reads ⌀register from the first frame, and the dressing happens in-register. Deterministic:
        // movAtt is a pure register fn; a fresh world has one leader; joiners restore the snapshot.
        let regBorn = false;
        if (_autoClose) { const att0 = W.movAtt(W.leash.state.gx, W.leash.state.gy);
          if (att0) { const b0 = Float64Array.from(Float32Array.from(att0));
            let eS = 0; for (let j = 0; j < b0.length; j++) eS += b0[j] * b0[j];
            W.desc = true; W.descBase = b0; W.descDisp = Float64Array.from(b0); W.descE0 = eS || 1; W.e0 = eS || 1;
            W.descPhi0 = lensU1.angle(_lensOp[0]); W.descPos = [W.leash.state.gx, W.leash.state.gy];
            W.descPosCap = [...W.descPos]; W.descBar = 0; W.descCapBar = 0; W.descObj = _lensObj;
            W.born = true; _solSeeded = true; _autoClose = false; regBorn = true;
            console.log(`[MU1-SEED] REGISTER-BORN — the symbol injected straight into the abstract register (zero physics passes, zero GPU steps; the dressing IS the boot animation, in-register)`); } }
        if (!regBorn) console.log(`[MU1-SEED] self-seed (fresh leader or snapshot grace expired) @ readyFrames=${_E.readyFrames} n.time=${(n.time ?? 0).toFixed(2)} kernelVer=${n.cachedRadiiVersion | 0}`); }
      // MUX PROPER-RATE CLOCK (the backlog-spiral fix, [[finding-mux-proper-rate-clock]]): each live slot beyond W adds
      // a FULL todo-loop of GPU work per frame (W-drive + V-drive + … = nSl×todo), but `target` is driven by WALL-CLOCK
      // at the full rate → it demands nSl× more steps than the frame can execute → the backlog COMPOUNDS (live-caught:
      // todo 41→191→411→602 after V born, recordV's 31ms stall seeding it). Fix: the operator's clock runs in MATTER
      // proper-time — `target` advances at 1/nSl. nSl = live slots (a pure fn of replicated born-state → byte-identical).
      // Re-anchor c0 at a rate CHANGE so the step count stays CONTINUOUS (c0 += k·(rateOld−rateNew)/spp).
      // (desc slots excluded: a DESCRIPTOR-ONLY slot runs 0 GPU steps — counting it would halve W's proper rate for
      //  nothing. desc flips only at the shared recalla/record drain step → nSl stays a pure fn of replicated state.)
      const _nSl = _sb.slots.reduce((a, s) => a + (s.born && !s.desc ? 1 : 0), 0) || 1;
      // MIRROR the step-clock rate flip onto the τ KERNEL when the live-slot count changes (V born → nSl 1→2). Factored into
      // medium-core.syncClockRate — without it _tauK keeps the old rate while the drive runs at nSl proper-rate → verb stamps
      // land ~nSl× ahead of the drive → a growing backlog → store/recall fire seconds late (see the helper's comment).
      syncClockRate(_stepClk, _tauK, _E.solSteps, _nSl * _tempoDiv);   // rate = live slots × the world tempo (both replicated → the flip lands identically on every peer)
      let target = _stepClk.target(_E.monClock);
      // COLD-START BURST CLAMP (first-load lag fix): a fresh page's world clock advances BEFORE the GPU+kernel are
      // ready, so the first DRIVEN frame can owe a huge backlog (target ≫ solSteps=0) → a 1024-step burst in one frame
      // = the visible lag (the "spiral"). Re-anchor c0 to NOW so target=0 and the soliton eases in. Guarded on
      // solSteps===0 so it fires ONLY on the first driven frame(s); steady-state clocked replay is untouched. (Reload
      // was clean because the clock was already warm — the bug only showed on the cold first load.)
      if (_E.solSteps === 0 && (target - _E.solSteps) > 1024) { _stepClk.c0 = _E.monClock; target = _stepClk.target(_E.monClock); }
      // JOIN-EASE (the join-lag fix): a JOINER restores solSteps MID-RUN (never 0), so the cold clamp above never fires. By
      // the time the snapshot is applied, n.time may have advanced past the capture instant (WS latency) → target ≫ solSteps
      // → a burst = the lag. We must NOT re-anchor c0 (the kernel-swap + shift startSteps are floor((t·rate−c0)·spp) — a
      // DIFFERENT c0 lands them at different solSteps → the field forks; this is why the oracle keeps c0 verbatim). Instead
      // CAP the per-frame catch-up while easing: c0 stays the leader's (stamped startSteps identical), and the backlog is
      // consumed over several frames — byte-identical at every shared boundary (whole-quanta), just spread in wall-time.
      if (_joinAnchor && (target - _E.solSteps) > 1024) _joinEaseN = 40;   // big backlog at join → ease it; else no ease needed
      _joinAnchor = false;
      // WHOLE-QUANTA CHUNKING (the solH frame-rate-independence, ported from the oracle line 2311): step ONLY in whole
      // Q=7-quanta, so every peer batches its GPU work at IDENTICAL shared step boundaries {0,7,14,21,…} regardless of
      // frame timing (drops/extra frames). Without this, peer A's todo=13 and peer B's todo=41 cross the same boundaries
      // with DIFFERENT GPU batch sizes → float accumulation is batch-order-sensitive → the fields diverge EVEN at the
      // same final k. With it, the GPU batches are byte-identical at every shared boundary → the field is REPRODUCIBLE
      // (not just convergent). This is the mechanism that made the original's solH hold under frame-rate differences.
      // STEP ONLY ON THE FORWARD PHASE OF THE WORLD CLOCK (the oracle law, line 2312). The IFS world clock OSCILLATES —
      // n.time rises AND falls, n.direction flips sign. The soliton advances ONLY while monDir>0; on the back-swing it
      // HOLDS (reachable→solSteps−solSteps=0). THE FORK THIS FIXES: without the monDir gate, `target=floor((n.time·r−c0)…)`
      // tracks the RAW oscillating value, so on the down-swing two peers sampling n.time at different frame moments compute
      // different targets and accumulate solSteps differently (frame-cadence-dependent → the peer-local "not in proper
      // time" drift). Gating on the SHARED n.direction makes stepping a pure fn of the clock PHASE, not the sampled value.
      const reachable = Math.max(0, (_E.monDir > 0 ? target : _E.solSteps) - _E.solSteps);
      const _cap = _joinEaseN > 0 ? 28 : 1024;   // ease a fresh-join backlog at 28 steps/frame (c0 unchanged → shared boundaries → solH identical); steady-state 1024
      const todo = Math.min(Math.floor(reachable / Q), Math.floor(_cap / Q)) * Q;   // whole 7-quanta only
      if (todo > 0) _E.solSteps += todo;
      if (_joinEaseN > 0 && todo > 0) _joinEaseN--;
      // JOIN-BURST DIAGNOSTIC: a joiner restores solSteps mid-run, so `target` (from the shared clock) can be FAR ahead →
      // reachable ≫ Q → the joiner runs a huge todo in ONE frame while the leader ran those steps over dozens of frames.
      // Whole-quanta chunking SHOULD make that byte-identical, but this trace confirms whether the joiner actually bursts.
      if (_joinBurstLog && todo > 0) { _joinBurstLog = false; console.log(`[MU1-FIRSTDRIVE] solSteps→${_E.solSteps} todo=${todo} target=${target} reachable=${reachable} monClock=${_E.monClock.toFixed(3)} c0=${_stepClk.c0.toFixed(4)} rate=${_stepClk.rate} · ringLen=${_E.ringCache?.r?.length ?? 'NULL'} ringCount=${_gpu._ringCount ?? '?'} offTot=${_E.ringCache?.o ? _E.ringCache.o.reduce((s, o) => s + (o?.length >> 1 || 0), 0) : 'NULL'} nodeOffTot=${n.cachedOffsets ? n.cachedOffsets.reduce((s, o) => s + (o?.length >> 1 || 0), 0) : 'NULL'} kernelVer=${_E.kernelVer}/node=${n.cachedRadiiVersion|0} psiBase=${_psiBase ? 'ok' : 'NULL'} Wfield=${W.field ? W.field.length : 'NULL'} We0=${W.e0.toExponential(3)}`); }

      // TRANSPORT target: DRAINED FROM THE STAMPED QUEUE inside the drive loop (see below) → applied at the shared step,
      // not here at the peer-local frame. objorbit's target IS deterministic already (θ = solSteps·gain, a pure fn of the
      // shared step) so it stays frame-level, updated continuously via setTarget (no re-arm). At first drive, if the leash
      // was never armed and no shift is queued yet, arm it to the current reflected target so W has somewhere to go.
      if (_driveMode === 'objorbit') { _objOrbTheta = _E.solSteps * _OBJORB_W_STEP; const [ox, oy] = _objOrbTarget(tgtX, tgtY);
        if (!W.leash.state.go) W.virtGo(ox, oy); else W.setTarget(ox, oy); }
      else if (!W.leash.state.go && _siShift.length === 0) { W.virtGo(tgtX, tgtY); }   // cold arm (no queued shift yet)

      // ── ⌀PDE — THE CLOSED REGISTER (the whole medium as abstract holography): when W itself is an 𝔸-slot
      //    (mu1.abstract(true) → the wabs verb compiled every born slot to envelope+descriptor), NO GPU pass runs.
      //    The SAME shared-step grid k advances the SAME laws — kernel-version bookkeeping, stamped shift/verb
      //    drains, τ_W beats + ω precession, the leash — all pure f64 register arithmetic, all in regH (solH
      //    retires: there is no field to hash — the register hash IS the whole determinism contract now). lock→A ≡ 1
      //    BY CONSTRUCTION (W IS its descriptor; zero chase gap is exactly the ansatz's declaration, not a trick).
      //    The PDE is demoted to COMPILER (it made the envelopes) + ORACLE (mu1.abstract(false) MATERIALIZES the
      //    register back into the medium and re-steps it — if the abstraction was faithful the soliton simply
      //    continues and lock recovers ≈1; that resumption is the measurement).
      let out = null, att = null;
      const _base = _E.solSteps - todo;
      _kernApplied.length = 0;   // both branches record the kernel + attractor SCHEDULES; the mirror drive replays them
      _attApplied.length = 0; _attApplied.push({ atStep: _base, gx: W.leash.state.gx, gy: W.leash.state.gy, phi: lensU1.angle(_lensOp[0]) });   // phi rides for the AUTOC anchors (the register pose AT a step — end-of-frame state is peer-frame-local)
      if (W.desc) {
        // ── THE REGISTER ENGINE (v7 — the user's cut through v1–v6: stop MODELING the maintained state, RUN
        //    the medium in the register). One full engine step per drained shared step, all f64 CPU, zero GPU:
        //    pin superpose (β from the REPLICATED refAmp ONLY — the peer-local mu1.pin never enters register
        //    law) → exact spectral linear step (gate D) → the engine's SPM phase → cap at descE0. ~3ms/step ≈
        //    10ms/frame at the net step rate — the same pacing discipline as every other tier. Breathing, wake,
        //    dressing are the ORIGINAL field's, because this IS the field, register-resident. Four refusals
        //    (v1 dissolution → v2 fixed point → v4 shimmer → v6 silence) taught the lesson the arc already
        //    knew: the only faithful model of the medium is the medium.
        let regAtt = (W.descBase && W.movAtt) ? W.movAtt(W.leash.state.gx, W.leash.state.gy) : null;
        for (let i = 0; i < todo; i++) { const k = _base + i;
          while (_pendKern.length && k >= _pendKern[0].startStep) { const pk = _pendKern.shift(); _E.kernelVer = pk.ver; _E.ringCache = { r: pk.r, w: pk.w, o: pk.o };
            _kernApplied.push({ atStep: k, r: pk.r, w: pk.w, o: pk.o }); }   // version BOOKKEEPING (the register engine reads the ring via the λ-grid cache) + the schedule for a live MIRROR
          _siShift.drain(k, (e) => { if (_driveMode === 'transport') { if (!W.leash.state.go) W.virtGo(e.toX, e.toY); else W.setTarget(e.toX, e.toY); } });
          _siReg.drain(k, (e) => _applyRegVerb(e, k));
          _E.kwSteps++;
          // one engine step per LIVING slot: W (the driven worldline) + any slot with descLive (a recalled
          // moment resurrected ALIVE — field mode's recall semantics, register-resident). Per-step f32 grain
          // (the join-fork fix: snapshots land MID-BAR and the wire is f32 — identical bytes at EVERY step;
          // also the ORIGINAL engine's own grain: the GPU field was f32 per step).
          if (W.descBase && W.descE0) { const shardR = (_mirRegion && !(_sb.slots[1].born && _sb.slots[1].mirror)) ? _mirRegion : null;
            // SHARD ECONOMY GUARD (live-caught freeze): the x-space regional step costs ~terms·|R+2reach| per
            // substep — for the fractal clock's LIVE rings (~184 points, reach ≈ 24) that is ~10× the WHOLE
            // spectral step (whose FFT cost ignores ring size; that asymmetry is why the engine is spectral).
            // Regional execution is a genuine win only for small-reach kernels; otherwise the whole-torus
            // engine keeps running and the shard remains INSTRUMENTATION (seam meter; eH stays whole-scoped).
            let econ = false;
            if (shardR) { const rc2 = _E.ringCache;
              if (_shardEconKv !== _E.kernelVer) { let reach = 1, nt = 9;
                if (rc2?.o) for (const o of rc2.o) { nt += o.length >> 1; for (let i2 = 0; i2 < o.length; i2++) { const a2 = Math.abs(o[i2]); if (a2 > reach) reach = a2; } }
                _shardEconKv = _E.kernelVer; _shardEconOk = reach <= 6 && nt <= 48; _shardEconInfo = { reach, nt }; }
              econ = _shardEconOk;
              if (!econ && !_shardWarned) { _shardWarned = true;
                console.log(`[REGION] ⚠ the live kernel ring (${_shardEconInfo.nt} stencil terms, reach ${_shardEconInfo.reach}) makes the regional x-space step ~10× DEARER than the whole spectral step (FFT cost ignores ring size — why the engine is spectral). Running the WHOLE-torus engine; the shard stays as instrumentation (seam meter). Regional compute pays off on small-reach kernels — or on the GPU turbo executor (per-pixel stencil, cost genuinely ∝ |R|).`); } }
            _shardActive = !!(shardR && econ);
            if (_shardActive) _regStepRegion(W, regAtt, _lensOp[0].beta || 1, shardR); else _regStep1(W, regAtt, _lensOp[0].beta || 1); }
          for (let li = 1; li <= 3; li++) { const VL = _sb.slots[li]; if (VL.desc && VL.descLive && VL.descBase && VL.descE0) _regStep1(VL, VL.descAtt, _lensOp[li].beta || 1); }
          if (((k + 1) % 21) === 0) { const barA = Math.floor((k + 1) / 21);
            // W's aging: the IDENTICAL law as field mode (τ_W beat cursor + ω per bar) — the register cannot tell
            // which side of the abstraction it aged on. That indistinguishability IS the meta-circular closure.
            if (_tauK && barA > (_tauK.beatsOf('W') ?? 0)) { let nb = barA - (_tauK.beatsOf('W') ?? 0);
              while (nb--) { _tauK.beat('W', _E.kwSteps, k + 1); if (_lensOp[0].omega) _lensOp[0].phase = ((_lensOp[0].phase + _lensOp[0].omega) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); } }
            for (let si = 0; si < _sb.slots.length; si++) { const s = _sb.slots[si]; if (!s.desc) continue;
              let nbD = barA - (s.descBar | 0); if (nbD <= 0) continue; s.descBar = barA;
              while (nbD--) { if (si > 0 && _lensOp[si].omega) _lensOp[si].phase = ((_lensOp[si].phase + _lensOp[si].omega) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);   // W's ω rode its beat law above
                // ⟲coevo survives abstraction in its PINNED form only (matter = the descriptor now; the field-
                // measured gate has no field to read — unpin is meaningless here and deliberately ignored).
                if (s.leash.state.go) leashAdvance(s.leash.state, null, () => 1, null,
                  (si === 0 && _coevoOn) ? ((L) => { const g = _unpinned
                      ? Math.max(0, Math.min(1, (W._engE ?? W.descE0 ?? 1) / (W.descE0 || 1)))   // UNPINNED (ℂ*): TRUE register-field energy — admissible in ⌀PDE since v7 (the engine computed the field for this k in THIS loop; _engE is a pure fn of shared state — the bar-interleaved-drive thread, closed)
                      : leashGainPredicted(L, _COEVO_MAXLAG); _coevoG = g; return g; }) : null); }
              // the register SCHEDULE for a live MIRROR/AUTOC — pushed UNCONDITIONALLY per processed bar (even an idle
              // leash must anchor phi at each bar: the ω tick above changed it, and end-of-frame φ is peer-frame-local)
              if (si === 0) _attApplied.push({ atStep: k + 1, gx: s.leash.state.gx, gy: s.leash.state.gy, phi: lensU1.angle(_lensOp[0]) }); }
            // ── bar boundary of THE REGISTER ENGINE (see the per-step block above): f32-quantize the envelope
            //    (the wire lattice — a joiner must land on the leader's bytes), refresh the pin target at the
            //    new leash pose, retire the sl2 spec cache. Pose is render-side ONLY as the sub-bar frac — the
            //    field carries its own motion (the soliton CHASES the attractor inside the register field,
            //    wake and all, exactly as in the GPU medium).
            // bar boundary for every LIVING slot: display buffer (the shared film — the canvas must never
            // show a peer-local mid-bar step), pose re-anchor (render keeps only the sub-bar frac), pin-target
            // refresh at the slot's OWN leash (descgo drags a living memory via the pin chase, like W).
            for (let si2 = 0; si2 < 4; si2++) { const s3 = _sb.slots[si2];
              if (!s3.desc || !s3.descBase || (si2 > 0 && !s3.descLive)) continue;
              s3.descDisp = Float64Array.from(s3.descBase);
              s3.descPos = [s3.leash.state.gx, s3.leash.state.gy];
              if (si2 === 0) { W.sl2 = null; regAtt = W.movAtt(W.leash.state.gx, W.leash.state.gy); }
              else if (s3.descAttG) s3.descAtt = _plateAtt(s3.descAttG.dop, s3.descPos, s3.descAttG.obj); }
            // THE KURAMOTO BAR LAW (the register XY machine, U1-native): dθ_i = Σ_j κ_ij·sin(θ_j − θ_i) per
            // shared bar, applied to the descriptor phases of born slots — pure register arithmetic; phases AND
            // the κ matrix are both in regH, so the whole XY dynamics is byte-replicated. κ>0 aligns, κ<0
            // anti-aligns; a κ<0 triangle is FRUSTRATED (no static minimum — the dynamics is the answer, Law 2);
            // MAXCUT reads off the sign pattern of the differences (Law 5: the answer is in DIFFERENCES).
            if (_K.edge) { const th = _lensOp.map((op) => lensU1.angle(op)); const dth = [0, 0, 0, 0]; let anyK = false;
              for (let ia = 0; ia < 4; ia++) { if (ia !== 0 && !_sb.slots[ia].born) continue;
                for (let ib = 0; ib < 4; ib++) { const kk = _K.edge[ia][ib]; if (!kk || (ib !== 0 && !_sb.slots[ib].born)) continue;
                  anyK = true; dth[ia] += kk * Math.sin(th[ib] - th[ia]); } }
              if (anyK) { for (let ia = 0; ia < 4; ia++) if (dth[ia]) _lensOp[ia].phase = ((_lensOp[ia].phase + dth[ia]) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
                if ((barA % 4) === 0 && _kurLogBar !== barA) { _kurLogBar = barA;
                  const tN = _lensOp.map((op) => lensU1.wrap(lensU1.angle(op)));
                  console.log(`[KUR] bar ${barA} · θ=[${tN.map((t) => t.toFixed(2)).join(', ')}] · Δ(W,V)=${lensU1.wrap(tN[0] - tN[1]).toFixed(2)} Δ(W,P1)=${lensU1.wrap(tN[0] - tN[2]).toFixed(2)} Δ(V,P1)=${lensU1.wrap(tN[1] - tN[2]).toFixed(2)} — the XY register machine (MAXCUT = the sign pattern of Δ; a frustrated κ<0 triangle never settles — watch it orbit)`); } } }
            if (_mirRegion && !(_sb.slots[1].born && _sb.slots[1].mirror) && W.desc && W.descBase && _shardRef && _shardLogBar !== barA && (barA % 4) === 0) { _shardLogBar = barA;
              const reg = _mirRegion, BW = 16; let num = 0, ea = 0, eb = 0;
              for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) {
                const depth = Math.min(x - reg.x0, reg.x1 - 1 - x, y - reg.y0, reg.y1 - 1 - y); if (depth >= BW) continue;
                const j = (y * GRID + x) * 2;
                num += W.descBase[j] * _shardRef[j] + W.descBase[j + 1] * _shardRef[j + 1]; ea += W.descBase[j] ** 2 + W.descBase[j + 1] ** 2; eb += _shardRef[j] ** 2 + _shardRef[j + 1] ** 2; }
              console.log(`[SHARD] bar ${barA} · region[${_mirRegionName}] ${_shardActive ? 'on the REGISTER ENGINE (regional x-space, cost ∝ |R|)' : 'INSTRUMENTATION-ONLY (whole-torus spectral engine — see the economy note)'} · seam-glue=${(ea > 0 && eb > 0 ? Math.abs(num) / Math.sqrt(ea * eb) : 1).toFixed(3)} (live ${BW}px band vs the declared-boundary snapshot) (${(reg.x1 - reg.x0) * (reg.y1 - reg.y0)}/${N_CELLS} cells) · ${_shardActive ? 'eH shard-scoped' : 'eH whole-scoped'}; regH = the shared contract`); }
            if (_regTraceOn && ((((k + 1) / Q) | 0) % _detEvery === 0)) console.log(`[DET-⌀] solStep=${k + 1} · regH=${_regH()} · eH=${W.descBase ? (_shardActive ? `⚠shard[${_mirRegionName}]:` : '') + _hashField(W.descBase) : '—'}${[1,2,3].map((li) => _sb.slots[li].descLive && _sb.slots[li].descBase ? ` · e${SLOTN[li]}=${_hashField(_sb.slots[li].descBase)}` : '').join('')} · bW=${_tauK ? (_tauK.beatsOf('W') ?? 0) : 0} kW=${_E.kwSteps} · kV=${_E.kernelVer} (register-only: regH + the living envelope hashes are the contract)`);
          }
        }
        _E.lockNow = 1;
      } else {
      // W-HOME DRIVE (the buffer home; the coevolve-chase). Seed once from the att, then self-sustain: each step
      // superpose toward W.movAtt(gx,gy) + stepSoliton. The leash advances gx/gy per W's proper-step (τ_W cadence).
      const save = _gpu.readEyePsi();
      att = W.movAtt(W.leash.state.gx, W.leash.state.gy);
      if (!_solSeeded) { _gpu.setEyePsi(att || save); _solSeeded = true; W.born = true;
        let e = 0; const s0 = att || save; if (s0) for (let j = 0; j < s0.length; j++) e += s0[j] * s0[j]; W.e0 = e || 1; _solE0 = -1; }
      else _gpu.setEyePsi(W.field || save);
      if (att) _gpu.setObjField(att);
      _E.muxStepped[0] = _E.muxStepped[1] = _E.muxStepped[2] = _E.muxStepped[3] = 0;
      for (let i = 0; i < todo; i++) { const k = _base + i;
        // IFS-KERNEL SWAP at the SHARED step: apply every staged ring change whose shared startStep this step has reached,
        // preserving the field across the setRings (read→setRings→write). Both peers swap the propagation kernel at the
        // IDENTICAL solStep → they step through the SAME kernel every step → the field replays byte-identically. (This is
        // the root fork: stepEye() propagates THROUGH _ringTex, so a peer-local kernel swap forked the field at step 1.)
        while (_pendKern.length && k >= _pendKern[0].startStep) { const pk = _pendKern.shift();
          if (pk.r && pk.r.length) { const qs = _gpu.readEyePsi(); _gpu.setRings(pk.r, pk.w, pk.o); _gpu.setEyePsi(qs); _E.kernelVer = pk.ver; _E.ringCache = { r: pk.r, w: pk.w, o: pk.o };
            if (att) _gpu.setObjField(att);
            _kernApplied.push({ atStep: k, r: pk.r, w: pk.w, o: pk.o }); } }   // RECORD the swap (step→ring) so V's drive replays the SAME ring at the SAME step (the ring is global _ringTex; V steps through it too — an unreplayed swap forks V at the kernel bump, live-caught)
        // SHIFT DRAIN at the SHARED step: apply every queued shift whose stamped startStep this step has reached. Both
        // peers set the target at the IDENTICAL step (the field-fork-on-slider fix). setTarget moves it without re-arming
        // the eased chase; a fresh command (never armed) uses virtGo so the baseline learns. Pure fn of shared k.
        _siShift.drain(k, (e) => { if (_driveMode === 'transport') { if (!W.leash.state.go) W.virtGo(e.toX, e.toY); else W.setTarget(e.toX, e.toY); } });
        // REGISTER-VERB DRAIN at the SHARED step (refamp/aphase/lenstau → _lensOp): both peers write the identical β/phase/ω
        // at the identical solStep → regH AND the field stay byte-identical (the 9205 refAmp-slider fork fix).
        _siReg.drain(k, (e) => _applyRegVerb(e, k));
        if (_muxOn && _mux.step(k, _sb.slots, att)) continue;   // ⧉mux time-shares the substrate (S7+); OFF → V runs in the parallel block below (S6)
        _E.muxStepped[0]++;
        if (att) _gpu.applyEyeSuperpose(_pinBeta * (_lensOp[0].beta || 1));   // ψ += β_W·att (the chase superpose)
        _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); _gpu.applyEyeEnergyCap(W.e0);   // batch-invariant: ALWAYS stepEyeN(1), never a batched stepEyeN(N) — so N×1 == 1+1+…+1 across peers
        _E.kwSteps++;
        // QUANTUM-BOUNDARY BLOCK (aligned chunking, the oracle's _FIXED_QUANTUM readback, line 2596): at the shared Q=7
        // boundary, readEyePsi→setEyePsi round-trips ψ so every peer's GPU work re-aligns to the SAME step regardless of
        // frame timing (a slow peer's todo=14 and a fast peer's todo=7 both cross {…,7,14,21} identically). Also the point
        // where the shared-step register updates land:
        //  • LEASH ADVANCE is DESCRIPTOR-ONLY (field=null) — gx/gy is a pure fn of the leash state, no field read → the
        //    register (regH) stays independent of field determinism (the successor form; the oracle's field-fed pacing was
        //    a pre-deterministic-field workaround, kept dormant in leashAdvance for the field-driven modes).
        //  • att = movAtt(gx) = lensC1.apply(Op, ψ_base) — the ℂ* descriptor attractor, deterministic by construction.
        //  • solH captured here — at a shared boundary step, so it is comparable across peers (a frame-end hash isn't).
        // NOTE: the FIELD-fork mechanism was the IFS KERNEL (a per-step input, synced at the loop top), NOT this block.
        if (((k + 1) % Q) === 0) { const q = _gpu.readEyePsi(); _gpu.setEyePsi(q);
          // ⟲COEVO LEASH — the honest ℂ* Einstein loop. The advance is gated by a GAIN (energy) observable so matter's
          // own state throttles its transport, with the sensor chosen by the pin/unpin governance:
          //   PINNED  → leashGainPredicted(L): the DESCRIPTOR lag (pure leash arithmetic, no field) → gx/gy exact, in
          //             regH, replay-safe. Back-reaction ON and deterministic — the default.
          //   UNPINNED→ the FIELD-measured energy ratio E(ψ)/e0 read from the SHARED-boundary f32 readback `q` (true
          //             matter-energy back-reaction; the momentum channel; determinism rides on the f32 quantization).
          //   coevo OFF → gainOf=null → sig=1, the open-loop DOP replay (the target never waits for matter).
          const _gx0 = W.leash.state.gx, _gy0 = W.leash.state.gy;
          const _gainOf = !_coevoOn ? null
            : (_unpinned ? (() => { let e = 0; for (let j = 0; j < q.length; j++) e += q[j] * q[j];   // ℂ*: TRUE field energy vs the slot's budget
                const g = W.e0 > 0 ? e / W.e0 : 1; _coevoG = g; return g; })
               : ((L) => { const g = leashGainPredicted(L, _COEVO_MAXLAG); _coevoG = g; return g; }));   // lensU1: descriptor-predicted
          if (leashDue(W.leash.state, _E.kwSteps, null)) leashAdvance(W.leash.state, null, (gx, gy) => W.movAtt(gx, gy), null, _gainOf);
          // REGENERATE att ONLY WHEN gx/gy ACTUALLY MOVED — the oracle's "ONE att per frame, stationary across the loop"
          // form (line 2529): keep the obj texture loaded and stationary until the target moves. A pure efficiency/clarity
          // match to the oracle (att = Op·ψ_base is deterministic either way, so this isn't the determinism mechanism —
          // the FIELD fork was the IFS kernel, synced separately; see the shared-step kernel swap at the loop top).
          if (W.leash.state.gx !== _gx0 || W.leash.state.gy !== _gy0) { att = W.movAtt(W.leash.state.gx, W.leash.state.gy); if (att) _gpu.setObjField(att);
            _attApplied.push({ atStep: k + 1, gx: W.leash.state.gx, gy: W.leash.state.gy }); }   // the att schedule for the MIRROR replay
          // W AGES — INSIDE THE LOOP, AT THE SHARED 21-STEP BAR (was after the frame loop, at peer-local frame-end). The
          // beat + ω-precession of _lensOp[0].phase MUST land at the exact shared solStep, not the peer-local frame end:
          // a frame spanning bars 224→225→226 (todo=21) applied all 3 precessions AFTER the loop, so the [DET] regH logged
          // mid-loop saw the OLD phase; a joiner whose frame spanned only bar 224 (todo=7) applied that precession, then
          // logged, then the next frame did 225 — so the SAME solStep saw a DIFFERENT phase on the two peers (the one-bar
          // regH lag you caught). Keyed on (k+1)%21 it is a pure fn of the shared step → identical phase at identical
          // solStep on every peer regardless of frame granularity. (barNow off (k+1), not solSteps — the in-loop shared step.)
          if (_tauK && ((k + 1) % 21) === 0) { const barNow = Math.floor((k + 1) / 21);
            if (barNow > (_tauK.beatsOf('W') ?? 0)) { const nb = barNow - (_tauK.beatsOf('W') ?? 0);
              for (let b = 0; b < nb; b++) { _tauK.beat('W', _E.kwSteps, k + 1); if (_lensOp[0].omega) _lensOp[0].phase = ((_lensOp[0].phase + _lensOp[0].omega) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); } } }
          // 𝔸-SLOT AGING — a DESCRIPTOR-ONLY slot lives in ω-TIME with no field: at the SAME shared 21-step bar its
          // register phase precesses by ω per bar (pure f64, keyed on shared k exactly like W's aging → byte-identical
          // across peers). descBar is the cursor, set at the recalla drain step (itself a pure fn of shared k) — so a
          // joiner replays the identical precession. This is the whole 𝔸-slot dynamics: 6 floats evolving, 0 grid steps.
          if (((k + 1) % 21) === 0) { const barD = Math.floor((k + 1) / 21);
            for (let si = 1; si < _sb.slots.length; si++) { const s = _sb.slots[si]; if (!s.desc) continue;
              let nbD = barD - (s.descBar | 0); if (nbD <= 0) continue; s.descBar = barD;
              while (nbD--) { if (_lensOp[si].omega) _lensOp[si].phase = ((_lensOp[si].phase + _lensOp[si].omega) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
                // 𝔸-TRANSPORT ADVANCE: the SAME leash law as every slot (descriptor-only branch: no field, sig=1 —
                // ≤1px/bar toward the descgo target), pure register arithmetic at the shared bar → gx/gy in regH,
                // byte-identical. The dummy movAtt (()=>1) satisfies the law's non-null gate; the RENDER does the
                // actual translation of the dressed base (no att field is ever built for an 𝔸-slot).
                if (s.leash.state.go) leashAdvance(s.leash.state, null, () => 1, null, null); } } }
          // solH gated on regTrace: with the register as the sole contract, regTrace(false) turns field mode into
          // "W AS ITS OWN MIRROR" — physics deterministic by construction, verified never, enforcement cost zero
          // (the mirror discipline applied to W itself; the ⌀PDE arc's lesson applied backwards to the live field).
          if (_regTraceOn) { _solH = _hashField(q); _solHStep = k + 1; }
          if (_frameLock && ((k + 1) % _frameLockGrid) === 0) { _dispW = Float64Array.from(q); _dispWk = k + 1; }   // frame-lock: keep the shared-grid state for display (the shared film, index stamped)
          // [DET] EMITTED HERE, INSIDE THE LOOP, AT EVERY SHARED Q-BOUNDARY — NOT once per frame. A frame processes a whole
          // `todo` chunk (many Q-boundaries); a frame-end log kept only the LAST boundary's hash, so a fork that lands
          // mid-frame on one peer but at a frame edge on the other stayed invisible for many steps. Emitting per-boundary
          // makes BOTH peers print the SAME solStep= line at EVERY shared boundary → the first mismatching solStep is the
          // fork. attH/gx localize it: if attH forks BEFORE solH, the op-sequence (descriptor) forked (regH bug); if solH
          // forks while attH+gx still match, the FIELD drifted under an identical op-sequence (a GPU/f32 replay gap).
          if (_regTraceOn && ((_solHStep / Q) % _detEvery === 0)) {
            const _attH = _hashField(att);
            // COMPONENT BREAKDOWN — so a regH fork localizes to the exact term. opH = the 4 readOps' scalars (phase/gain/
            // metric); btH = the τ-beat counts per slot; W∠ = _lensOp[0].phase (the precessing register); bW = beatsOf('W').
            // If opH/W∠/bW fork at join → the restored descriptor ≠ the leader's live one (snapshot capture-point bug).
            const _opH = _hashNums(_lensOp.flatMap((op) => _opNums(op)));
            const _btH = _hashNums(_sb.slots.map((s) => _tauK ? (_tauK.beatsOf(s.name) ?? 0) : 0));
            // PER-SLOT FIELD HASH — after rec, V (and booted P) run the SAME soliton on the shared substrate (at slower mux
            // rate) and MUST be byte-identical across peers too, not just W. solH is W's field (slot 0); slotH lists every
            // BORN slot's own field hash so a V/P divergence is visible where a W-only trace would miss it (your rec case).
            const _slotH = _sb.slots.filter((s) => s.born).map((s) => `${s.name}=${s.field ? _hashField(s.field) : '--------'}`).join(' ');
            console.log(`[DET] solStep=${_solHStep} · regH=${_regH()} · solH=${_solH} · slotH[${_slotH}] · kV=${_E.kernelVer} pend=${_pendKern.length} bW=${_tauK ? (_tauK.beatsOf('W') ?? 0) : 0} kW=${_E.kwSteps} · opH=${_opH} btH=${_btH}`);
          }
        }
      }
      out = _gpu.readEyePsi(); _gpu.setEyePsi(save);
      if (!W.desc) { W.field = out; _E.psiLensed = out; }   // (a wabs verb can close the register MID-frame — don't resurrect the field it just compiled away)
      // ── V LIVE DRIVE (S6): once V is born it runs LIVE on the shared substrate — held toward its OWN recorded att
      //    (parked at the remembered moment), so view:V is a LIVING copy, not a frozen snapshot. Same sustain as W
      //    (superpose→step→cap), same shared step count → deterministic. (nSl=1 parallel form; the mux drives it under
      //    ⧉mux once that's enabled — S7+.) This is what makes view:V dynamic (bug: V was static till store/recall). ──
      if (V.born && V.field && V.att && todo > 0) { const sv = _gpu.readEyePsi();
        const _vbase = _E.solSteps - todo;
        _gpu.setEyePsi(V.field); _gpu.setObjField(V.att);
        for (let i = 0; i < todo; i++) { const _vk = _vbase + i;
          // KERNEL SWAP REPLAY: apply the SAME ring swap W's loop applied at this step (the ring is global _ringTex — V
          // propagates through it too; without this V steps a stale kernel and forks at the kV bump, live-caught: solH
          // matched but V's vH forked exactly where pend>0 and kV jumped 55→57). Field-preserving read→setRings→write.
          for (const ks of _kernApplied) { if (ks.atStep === _vk && ks.r && ks.r.length) { const qv = _gpu.readEyePsi(); _gpu.setRings(ks.r, ks.w, ks.o); _gpu.setEyePsi(qv); if (V.att) _gpu.setObjField(V.att); } }
          if (V.hold) _gpu.applyEyeSuperpose(_pinBeta * (_lensOp[1].beta || 1));
          _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); _gpu.applyEyeEnergyCap(V.e0); V.kv++;
          if (((_vbase + i + 1) % Q) === 0) { const q = _gpu.readEyePsi(); _gpu.setEyePsi(q);   // V's per-Q f32 readback (same reproducibility discipline as W — at the SHARED step)
            // [DET-V] V's field hash at the SAME shared boundary as W's [DET] → compare V across peers directly (V must be
            // byte-identical too: it's the same soliton, driven at the mux rate). Fires at the shared step, keyed identically.
            if (_regTraceOn && (((_vbase + i + 1) / Q) % _detEvery === 0)) console.log(`[DET-V] solStep=${_vbase + i + 1} · vH=${_hashField(q)} · vKv=${V.kv} vE0=${V.e0.toExponential(3)} vHold=${V.hold ? 1 : 0} vβ=${(_pinBeta * (_lensOp[1].beta || 1)).toFixed(3)}`); } }
        V.field = _gpu.readEyePsi(); _gpu.setEyePsi(sv); }
      if (att && todo > 0) { _E.lockNow = _ampCorr(out, att); if (_E.lockNow < _E.lockMin) _E.lockMin = _E.lockNow; }
      // (W AGES moved INSIDE the drive loop, at the shared 21-step bar — see above. Applying it here at peer-local
      // frame-end forked the register phase by one bar across peers with different frame granularity.)
      if (_solLogBar !== _E.frameBar && todo > 0) { _solLogBar = _E.frameBar;
        let e = 0, sx = 0, sy = 0, sw = 0; for (let j = 0; j < N_CELLS; j++) { const a2 = out[j * 2] ** 2 + out[j * 2 + 1] ** 2; e += a2; sx += (j % GRID) * a2; sy += ((j / GRID) | 0) * a2; sw += a2; }
        if (_solE0 < 0) _solE0 = e || 1; const cx = sw > 0 ? sx / sw : GRID / 2, cy = sw > 0 ? sy / sw : GRID / 2;
        console.log(`[MU1:${_driveMode}] bar ${_E.frameBar} · E×${(e / _solE0).toFixed(2)} · Wpos(${cx.toFixed(1)},${cy.toFixed(1)}) · leash g=(${W.leash.state.gx.toFixed(2)},${W.leash.state.gy.toFixed(2)}) → tgt(${tgtX},${tgtY}) · lock ${_E.lockNow.toFixed(3)}${_pinBeta < _WEAR.betaStar ? ` · grip:⚠ β=${_pinBeta.toFixed(2)}<β*≈${_WEAR.betaStar} (SHED regime — the walk radiates instead of carrying; mu1.pin(0.15+) for the ride)` : ''} · todo=${todo} · wH=${_regTraceOn ? _hashField(out) : '— (unverified)'}`);
        }
      }   // ← end of the FIELD drive (the ⌀PDE abstract branch above replaces all of it with register arithmetic)
      // ── MIRROR DRIVE (both modes): V = an independently integrated PDE copy, INJECTION-LOCKED to the REGISTER's
      //    attractor. It replays W's kernel schedule (_kernApplied) and attractor schedule (_attApplied) at the SAME
      //    shared steps — both pure register functions → deterministic. In FIELD mode this is the classic Lyapunov
      //    mirror (Δ(V,W) = does the medium heal/conserve/amplify a difference). In ⌀PDE mode it INVERTS the
      //    architecture: the register is the model, and the PDE returns as a LIVE VIEW of it — real dressing, real
      //    SPM texture, real kernel-bump response, held onto the abstraction by the pin's measured capture range.
      //    The medium's final demotion: model → compiler → oracle → renderer-with-real-physics.
      if (V.born && V.mirror && V.field && todo > 0) { const sv = _gpu.readEyePsi();
        // ── REGIONAL WITNESS (descent rung 2, live): integrate physics ONLY in R; outside = the register's
        //    DECLARATION (locally computed — the reflector protocol is untouched, no peer exchanges anything).
        //    Honest by the light-cone law (interior exact per step, pinned bit-for-bit) + the pin's contraction
        //    of the seam band. setEyePsiBoth keeps BOTH ping-pong buffers' outside coherent (scissored passes
        //    never write it); the cap's scale pass is scissored too, so the declaration band is never renormalized.
        const reg = (_mirRegion && W.desc) ? _mirRegion : null;
        if (reg) { const comp = _declProject();
          if (comp) { for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) { const j = (y * GRID + x) * 2; comp[j] = V.field[j]; comp[j + 1] = V.field[j + 1]; }
            _gpu.setEyePsiBoth(comp);
            _gpu.setEyeScissor(reg.x0, reg.y0, reg.x1 - reg.x0, reg.y1 - reg.y0); }
          else _gpu.setEyePsi(V.field); }
        else _gpu.setEyePsi(V.field);
        let mAtt = null, aCur = 0;
        for (let i = 0; i < todo; i++) { const mk = _base + i;
          for (const ks of _kernApplied) if (ks.atStep === mk && ks.r?.length) { const qv = _gpu.readEyePsi(); _gpu.setRings(ks.r, ks.w, ks.o); _gpu.setEyePsi(qv); if (mAtt) _gpu.setObjField(mAtt); }
          while (aCur < _attApplied.length && _attApplied[aCur].atStep <= mk) { const a = _attApplied[aCur++]; mAtt = W.movAtt(a.gx, a.gy); if (mAtt) _gpu.setObjField(mAtt); }
          // MIRROR-SOURCED VERB EXECUTION at the shared step: the queue entry carries the register context from the
          // drain (shared-exact); mf = the mirror's live buffer HERE, at k — both pure fns of shared state. The
          // executors are CPU-only (spectral legs) — no GPU state is touched mid-loop.
          while (_mirVerbQ.length && _mirVerbQ[0].k <= mk) { const mv = _mirVerbQ.shift();
            const mf = _gpu.readEyePsi();
            if (mv.mode === 'store') _storeFrom(mv, mf);
            else if (mv.mode === 'recall' || mv.mode === 'recallx') _recallFrom(mv, mf);
            else _recordFrom(mv, mf); }
          if (mAtt) _gpu.applyEyeSuperpose(_pinBeta * (_lensOp[1].beta || 1));   // the injection lock onto the REGISTER's attractor
          _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); _gpu.applyEyeEnergyCap(V.e0); V.kv++;
          if (((mk + 1) % Q) === 0) { const q = _gpu.readEyePsi(); _gpu.setEyePsi(q);   // the same f32 shared-boundary re-alignment discipline as W
            if (_frameLock && ((mk + 1) % _frameLockGrid) === 0) { _dispV = Float64Array.from(q); _dispVk = mk + 1; }   // frame-lock: the mirror's shared-grid state for display (index stamped)
            // AUTOC — CONTINUOUS COMPILATION: at every Nth shared bar the mirror RE-COMPILES the register's envelope.
            // The PDE computes FOR the register; the canvas always renders the register projection. Anchors (φ, pose)
            // come from the recorded register SCHEDULE at the capture step — NOT end-of-frame state (peer-frame-local,
            // would fork the anchors). descBar is NOT touched (it is the aging-law cursor, not a capture anchor).
            // q is the f32-realigned shared-boundary readback → peer-deterministic bytes under the same discipline
            // that held solH. The declaration's staleness bound: ≤N bars, by construction.
            if (_autoCompN > 0 && W.desc && W.descBase && ((mk + 1) % 21) === 0 && (Math.floor((mk + 1) / 21) % _autoCompN) === 0) {
              let an = _attApplied[0]; for (const a of _attApplied) { if (a.atStep <= mk + 1) an = a; else break; }
              W.descBase = Float64Array.from(q);
              W.descPhi0 = (an && typeof an.phi === 'number') ? an.phi : lensU1.angle(_lensOp[0]);
              W.descPos = [an ? an.gx : W.leash.state.gx, an ? an.gy : W.leash.state.gy];
              W.descCapBar = Math.floor((mk + 1) / 21);   // capture stamp (defTest's declaration-age readout)
              W.descHold = Float64Array.from(W.descBase); W.descPosCap = [...W.descPos];   // the living-declaration anchor re-captures too (q is already f32-lattice; shift origin re-anchors)
              W.sl2 = _mkSl2(W.descBase);                 // the sl(2) tier re-captures with the envelope (compile door #2)
              if ((_autoCompLog++ % 8) === 0) console.log(`[AUTOC] bar ${Math.floor((mk + 1) / 21)} — W's envelope RECOMPILED from the mirror (declaration age reset; the PDE as CONTINUOUS COMPILER · logging every 8th recompile)`);
            } }
        }
        if (reg) _gpu.setEyeScissor(0, 0, 0, 0);
        V.field = _gpu.readEyePsi(); _gpu.setEyePsi(sv);
        if (_mirLogBar !== _E.frameBar) { _mirLogBar = _E.frameBar; const lockA = mAtt ? _ampCorr(V.field, mAtt) : 0;
          let regTxt = '';
          if (reg) { const d2 = _declProject(); if (d2) { let num = 0, ea = 0, eb = 0; const BW = 16;
              for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) {
                const depth = Math.min(x - reg.x0, reg.x1 - 1 - x, y - reg.y0, reg.y1 - 1 - y); if (depth >= BW) continue;
                const j = (y * GRID + x) * 2;
                num += V.field[j] * d2[j] + V.field[j + 1] * d2[j + 1]; ea += V.field[j] ** 2 + V.field[j + 1] ** 2; eb += d2[j] ** 2 + d2[j + 1] ** 2; }
              regTxt = ` · shard[${_mirRegionName}] seam-glue=${(ea > 0 && eb > 0 ? Math.abs(num) / Math.sqrt(ea * eb) : 1).toFixed(3)} (witness vs declaration, ${BW}px band — the live gluing defect)`; } }
          console.log(`[MIRROR] bar ${_E.frameBar} · lock→A=${lockA.toFixed(3)}${(!W.desc && W.field) ? ` · Δ(V,W) corr=${_ampCorr(V.field, W.field).toFixed(4)} (the Lyapunov readout)` : ' (⌀PDE: the live PDE tracking the abstract register — the lock-in transient IS the medium accepting the declaration)'} · kv=${V.kv}${regTxt}`); }
      }
      if (_mirVerbQ.length && !(V.born && V.mirror)) { console.log(`[MU1] ⚠ ${_mirVerbQ.length} mirror-sourced verb(s) dropped — the mirror died before executing them (re-press after restarting the mirror)`); _mirVerbQ.length = 0; }
      // the live group ledger at bar cadence (mu1.vptWatch) — BOTH modes: H from W's field, or from the MIRROR in
      // ⌀PDE (live physics locked to the register — the right H source there). Telemetry only; a pure fn of the
      // shared field at a shared bar → two peers print identical [VPT] lines at equal bar.
      // sl(2)-tier RE-KEY + lazy init: when the fractal clock moved kernelVer (or a joiner arrives without the
      // derived tier), recompute from descBase — a pure register fn, identical bytes on every peer whenever it
      // runs (the λ-grid-cache argument; timing is telemetry-only since sl2 is outside regH).
      if (W.desc && W.descBase && _E.ringCache?.r?.length && (!W.sl2 || W.sl2.kv !== _E.kernelVer)) {
        const old = W.sl2; W.sl2 = old ? (_sl2Rekey(old) || _mkSl2(W.descBase)) : _mkSl2(W.descBase);
        if (old && W.sl2 && (_sl2KeyN++ % 8) === 0) console.log(`[SL2] RE-KEY kv ${old.kv}→${W.sl2.kv}: V̈ ${old.vdd.toExponential(3)}→${W.sl2.vdd.toExponential(3)} ⇒ ΔI=${(W.sl2.I - old.I).toExponential(2)} (FFT-free stencil re-sum over the compiled spectrum · logging every 8th re-key)`); }
      if (_vptOn && _vptLogBar !== _E.frameBar && (_E.frameBar % _vptEvery) === 0 && todo > 0) { _vptLogBar = _E.frameBar;
        const r = _vptRead(); if (r) { _vptLast = r;
          // the gate-F tier: the dated forecast (t* / t_c in engine time units, ÷DT for steps) + İ the maintenance power
          const elTxt = r.I == null ? '' : ` · I=${r.I.toExponential(2)}${r.Idot != null ? ` İ=${r.Idot.toExponential(1)} (sl2-work of pin+cap; 0 on free flight)` : ''}${r.rekey != null ? ` · re-key ΔI=${r.rekey.toExponential(1)} (kernel bump — the clock re-tuned V̈; bookkept out of İ)` : ''}${r.tFoc != null ? ` · freed: FOCUS in ${Math.round(r.tFoc / DT)} steps, waist V=${r.vMinP.toExponential(2)}` : r.tCol != null ? ` · freed: V→0 in ${Math.round(r.tCol / DT)} steps (dated collapse call)` : ''}`;
          const sl2Txt = (W.desc && W.sl2) ? ` · sl2-REG V=${W.sl2.V.toExponential(2)} (wit Δ=${(100 * (r.V / W.sl2.V - 1)).toFixed(1)}% — the register's charge vs the witness; held ⇒ stationary, the arrest law)` : '';
          console.log(`[VPT] bar ${_E.frameBar} · src=${r.src} · H=${r.H.toExponential(3)} (kin ${r.hk.toExponential(2)} nl ${r.hn.toExponential(2)}) · V=${r.V.toExponential(3)} · ${r.H < 0 ? '⚠ H<0 — would COLLAPSE if freed (the pin+cap are holding it: the VPT call, live)' : 'H>0 — would spread if freed'}${elTxt}${sl2Txt}`); }
        // PURE ⌀PDE (no field anywhere): the register-only ledger — the sl(2) charges + the dated forecast,
        // asserted from register content ALONE (Vd=0: the held state is stationary by the measured arrest law;
        // freed from rest, V(t)=V+½V̈t²). The mirror is the optional VERIFIER, not the source.
        else if (W.desc && W.sl2) { const s = W.sl2;
          console.log(`[VPT] bar ${_E.frameBar} · src=REGISTER (pure ⌀PDE — nothing integrates) · sl2: V=${s.V.toExponential(3)} V̈=${s.vdd.toExponential(3)} I=${s.I.toExponential(3)} (kv=${s.kv}) · held ⇒ stationary (arrest law) · freed ⇒ ${s.vdd < 0 ? `V→0 in ~${Math.round(Math.sqrt(-2 * s.V / s.vdd) / DT)} steps (dated collapse call, register-side)` : `spreads (V̈>0)`} — asserted with ZERO field reads; press mirror to verify`); } }
      // [DET] is now emitted INSIDE the drive loop at every shared Q-boundary (see above) — the frame-end emit is gone
      // (it only saw the last boundary of the frame, hiding mid-frame forks). _regTraceLast retired.

      // render: outCell = the SELECTED slot, THROUGH its readOp (perception view). "which scope" is now "which slot"
      // (the eye/medium scopes re-derived as slot views, S5). The source canvas (inCell) is HIDDEN — no draw needed.
      const vsl = _sb.slots[_viewSlot];
      let vfield = (vsl && vsl.born) ? vsl.field : (_viewSlot === 0 ? out : null);
      // 𝔸 view: render the DESCRIPTOR'S projection instead of ψ — W: att = lensC1.apply(Op, ψ_base) at the live leash
      // (already computed this frame); V/P: the stored att. This is the register's PREDICTION of the slot, honest because
      // LABELED — the medium view (raw) stays the real field, per the no-tricks law. Pure render read, no state written.
      // A DESCRIPTOR-ONLY slot (𝔸-recall) has no ψ AT ALL — its view is the GPU linOp shader (_drawDesc: final pixel
      // arithmetic over the recorded envelope, ~7 uniforms/frame). CPU projection is the fallback (no base / no GPU).
      // W-VIA-MIRROR ROUTING (the default-flip UX): in ⌀PDE with a live mirror, view:W RAW shows the MIRROR's
      // field — the physics of the register, on the W canvas (the classic look; the closed architecture underneath).
      // The DECLARATION stays one click away: the view cycle's 𝔸desc mode shows the register projection instead.
      const _wViaMirror = _viewSlot === 0 && W.desc && V.born && V.mirror && !!V.field && _dials.view !== 'desc';
      if (_wViaMirror) vfield = V.field;
      let _drawn = false;
      // FRAME-LOCK: display the last SHARED-bar state instead of the peer-local frame end → every displayed image is
      // a member of one shared sequence across peers (the shared film; ≤1 bar wall-time offset). Local display dial.
      if (_frameLock) { if (_wViaMirror) { if (_dispV) vfield = _dispV; }
        else if (_viewSlot === 0 && !W.desc && _dispW) vfield = _dispW;
        else if (_viewSlot === 1 && V.mirror && _dispV) vfield = _dispV; }
      // SUBTICK-DRIVEN PAINT (frameLock on): paint ONLY when a NEW shared-boundary frame exists. The signature is
      // the shared index (+ the local display dials); at most ONE paint per index → paint content AND order are pure
      // fns of shared time on every peer (a slow display drops indices; it never invents or reorders frames). rAF
      // degrades to a polling loop; between boundaries the existing pixels ARE the correct frame (repaint = waste).
      let _skipPaint = false;
      if (_frameLock) {
        const sig = _wViaMirror ? `WV:${_dispVk}:${_colorMode}:${_dials.view}`
          : (vsl && vsl.desc) ? `A${_viewSlot}:${vsl.descBar}:${lensU1.angle(_lensOp[_viewSlot]).toFixed(9)}:${vsl.leash.state.gx.toFixed(4)},${vsl.leash.state.gy.toFixed(4)}:${_colorMode}:${_dials.view}`
          : (_viewSlot === 1 && V.mirror) ? `V:${_dispVk}:${_colorMode}:${_dials.view}`
          : (_viewSlot === 0 && !W.desc) ? `W:${_dispWk}:${_colorMode}:${_dials.view}` : null;
        if (sig) { if (sig === _lastPaintSig) _skipPaint = true; else _lastPaintSig = sig; }
      }
      const vnm = SLOTN[_viewSlot];   // used by the selector reflection BELOW the paint block too — stays outside the skip
      if (!_skipPaint) {
      // Σ VIEW (multi-slot vision): the SUM of every born slot's declaration — the linear-superposition read of
      // the whole register bank at once. Honest because LABELED (linearity is the view's assumption, not the
      // medium's: slots do not interact through this render). Per-bar cached (the film grid), CPU projection.
      if (_viewAllOn && W.desc) { const nowBar = Math.floor(_E.solSteps / 21);
        if (_viewAllCache.bar !== nowBar) { const acc = new Float64Array(2 * N_CELLS); let nSum = 0;
          for (let si3 = 0; si3 < 4; si3++) { const s4 = _sb.slots[si3]; if (!s4.desc || !s4.descBase || (si3 > 0 && !s4.born)) continue;
            const pf = _descProject(si3); if (!pf) continue; nSum++;
            for (let j = 0; j < acc.length; j++) acc[j] += pf[j]; }
          _viewAllCache = { bar: nowBar, f: nSum ? acc : null }; }
        if (_viewAllCache.f) { _drawField(outCell, _viewAllCache.f); _drawn = true; } }
      if (!_drawn && vsl && vsl.desc && !_wViaMirror) { _drawn = _drawDesc(outCell, _viewSlot); if (!_drawn) vfield = _descProject(_viewSlot); }
      else if (_dials.view === 'desc') vfield = (_viewSlot === 0) ? att : (vsl ? vsl.att : null);
      if (!_drawn) _drawField(outCell, _lensedView(_viewSlot, vfield));
      const vop = _lensOp[_viewSlot];
      outCell.setLabel(`ψ_${vnm}${(vsl && vsl.born) || _viewSlot === 0 ? '' : ' (unborn)'} · ∠${lensU1.wrap(lensU1.angle(vop)).toFixed(2)}${vop.beta !== 1 ? ` β${vop.beta}` : ''}${vop.omega ? ` ω${vop.omega}` : ''}${_wViaMirror ? ' · LIVE via MIRROR (the physics of the register; 𝔸 declaration on the view cycle)' : vsl && vsl.mirror ? ' · MIRROR: live PDE injection-locked to the register' : vsl && vsl.desc ? ' · 𝔸 PREDICTIVE slot (descriptor-only, 0 grid steps)' : _dials.view === 'lens' ? ' · ∠lens view' : _dials.view === 'desc' ? ' · 𝔸 DESCRIPTOR render (register prediction — not ψ)' : ''}${_viewSlot === 0 ? ` · transport lock ${_E.lockNow.toFixed(2)}` : ''}${_frameLock ? ` · film@k=${_viewSlot === 1 && V.mirror ? _dispVk : _dispWk} (shared index: identical k ⇒ identical pixels)` : ''}${_mirRegion && V.mirror ? ` · shard:${_mirRegionName} (outside R = the declaration)` : ''}${_viewAllOn && W.desc ? ' · Σ VIEW (linear superposition of the slot declarations — a VIEW; slots do not interact)' : ''}`);
      }
      // reflect the selector to only-born slots (W always; V/P when born — S6)
      if (_viewSel.value !== vnm) _viewSel.value = vnm;
      _sX.setVal(tgtX); _sY.setVal(tgtY);
      // reflect the register strip to the TARGETED slot's live descriptor (the bar5 law: position mirrors state)
      const rsi = SLOTN.indexOf(_regSlot); if (rsi >= 0) { _sBeta.setVal(_lensOp[rsi].beta); _sOm.setVal(_lensOp[rsi].omega);
        _regReadout.textContent = ` ${_regSlot}:∠${lensU1.wrap(lensU1.angle(_lensOp[rsi])).toFixed(2)} β${_lensOp[rsi].beta.toFixed(2)} ω${_lensOp[rsi].omega.toFixed(2)}${_sb.slots[rsi].born || rsi === 0 ? '' : ' (unborn)'}`; }
      if (core._renderAvatars) core._renderAvatars(world, root);
      if (_lagOn) _lagTick(_lagT0, todo, n);
      _autoTempoTick(todo);
      // BOOT CLOSE (see _autoClose): the REGISTER ENGINE (v7) made the GPU compile pass unnecessary — the
      // register runs the full physics itself, so the bare injected symbol DRESSES IN-REGISTER (SPM + kernel
      // sculpt it live on the canvas, the same ~8 bars, now visible and register-resident). Close at the first
      // bar after the seed: what's captured is ≈ the bare probe, and the dressing transient IS the boot
      // animation. No lock gate — there is nothing to converge before the close anymore.
      if (_autoClose && !W.desc && _bootSeedBar >= 0 && _E.frameBar >= _bootSeedBar + 1 && todo > 0) {
        _autoClose = false;
        console.log(`[MU1-BOOT] seed planted (${_E.frameBar - _bootSeedBar} bar) → CLOSING the register — the REGISTER ENGINE dresses the symbol in-register (full physics, f64 CPU, zero GPU; watch the dressing live). Mirror = optional verifier · mode:physics = one press back · mu1.autoClose(false) keeps classic`);
        injectEvent?.({ type: 'mediumVirt', mode: 'wabs', amp: 1 });
      }
    };
    root.addEventListener('mousemove', (e) => { const rect = root.getBoundingClientRect(); const ro = core._seloInfo ? core._seloInfo(world) : null;
      if (ro?.myId) sendCursorMove(world.id, ro.myId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height); }, { passive: true });
    return _frame;
  };
}

export default {
  title:       'Medium-U1 | transport = W.virtGo · slot-centric register (medium.js successor)',
  selo:        'medium-u1',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => makeMediumU1Scripts(av),
  makeRenderer: makeMediumU1Renderer,
  wrapId:      'medium-u1-wrap',
  hideTopBar:  true,
};
