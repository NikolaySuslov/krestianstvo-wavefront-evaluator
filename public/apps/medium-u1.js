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
//   TRANSPORT = THE W SLOT'S LEASH (the unification, verified in test/medium-u1-slots.test.mjs): shiftX/Y → W.virtGo.
//   W's movAtt REGENERATES its attractor (makeProbeField at the eased leash position); a plate slot (V/P) ROLLS
//   a stored plate — the SAME leashAdvance law drives both. So there is no special "transport drive": W is a slot
//   whose attractor is regenerable, commanded by the same virtGo V/P use.
//
//   Built over the EXTRACTED substrate (imported, never copied): medium-gpu (_E: fields/stepSoliton/snapshot),
//   medium-core (bank/coupling/kuramoto/chain-meter/step-clock + the register ENGINE + HOLOGRAM bank + SLOT bank +
//   regHash + register-readout + field-matter — the whole abstract-medium surface, consolidated), kwe-tau (worldline
//   clocks), soliton-algebra (lensC1). World = hologram_world_u1 (node 'mediumU1').
//
//   BUILD STATUS: S3 (this) = the W-home transport chase over the slot bank (mux ready for V at S5/S6). The
//   oracle (selo 'medium-u1-oracle') is the live PARITY WITNESS — diff the chase/lock against it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

import { IFSGpu } from '../ifs-gpu.js';
import {
  hologramWorldProgram, REFLECTOR_MS, SUBTICK_MS, GRID, N_CELLS, DT, SRC_ALPHA, RENDER_SCALE,
} from '../hologram_world_u1.js';
import { makeProbeField, lensU1, lensC1 } from '../soliton-algebra.js';
import { makeObserverBank, makeStepClock, makeCouplingStore, kuramotoStep, regHash, makeRegisterReadout, muxClocks, chainMeter, makeStampedInput, hashField as _hashField, hashNums as _hashNums, opNums as _opNums, ampCorr as _ampCorr, phaseCorr, syncClockRate, kernelABCD, kernelSymbol, packetD, qStep, qFixedPoint, qSpmRate, kernelPropagateSpectral, kernelLambdaGrid, fft2d, crossCorrScan, spectralShift, leapfrogStepX, coverStep, coverResidual, secondMoment, secondMomentTorus, virialRateX, virialSpec, slCasimir, regionStepX,
  makeSlotBank, makeSlotMux, leashAdvance, leashDue, leashGainPredicted, leashGainEnergy, makeRegisterEngine } from '../medium-core.js';   // the whole abstract-medium surface, one import (was 3 lines pre-consolidation). leashGainEnergy = the unpinned (ℂ*) coevo-gain twin of leashGainPredicted
import { makeSolitonEngine } from '../medium-gpu.js';
import { makeHologramBank, occlude, keptFraction } from '../medium-core.js';   // occlude/keptFraction = the CPU/f64 occluder (the "break the plate" demo input, twin of ifs-gpu GLSL_EYE_HOLOGRAM)
import { makeRng } from '../krestianstvo-wavefront-evaluator.js';   // the KWE core PRNG (xoshiro128**) — deterministic, seedable; used for the occlude-mask seed (NOT Math.random — replicated)

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
    // DRAG GUARD: suppress reflection only WHILE the user is actually dragging — NOT merely while the element holds
    //   focus. A range input KEEPS focus after the pointer is released, so a focus-based guard silently froze the
    //   slider forever after its first drag ("the model updates but the UI doesn't") — the bug for any slider you
    //   drag and then WATCH (the damage slider). Pointer/key down→up (and blur) bracket a real interaction.
    let _dragging = false;
    const _down = () => { _dragging = true; }, _up = () => { _dragging = false; };
    s.addEventListener('pointerdown', _down); s.addEventListener('keydown', _down);
    s.addEventListener('pointerup', _up); s.addEventListener('keyup', _up);
    s.addEventListener('blur', _up); window.addEventListener('pointerup', _up);   // pointerup can land outside the thumb
    const setVal = (v) => { if (_dragging) return; if (+s.value !== +v) s.value = v; lbl.textContent = _txt(v); };
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
    // ── 'lightpts' — REAL light points: a 3×3 lattice of GAUSSIAN sources with a FINITE WAIST (σ=5px). The finite
    //    waist is the physics (measured): the ring kernel has a low-pass knee kKnee = j₀,₁/rMax ≈ 0.22–0.27 rad/cell;
    //    a hard 3×3 _pdot is nearly a delta whose spectrum lives ABOVE the knee, in the dispersive/chaotic band —
    //    isolated hard dots CANNOT form a coherent lock there (measured: speckle ~1.1 = noise). A σ=5 Gaussian sits
    //    BELOW the knee → coherent, oscillating, interfering (measured: speckle 0.78 ≈ letterA's 0.75, temporal
    //    liveliness 0.44 = letterA's 0.43). A real optical point source has a waist; a delta is not a light point.
    _objExtras.lightpts = (f, G2, { x0, y0, side }) => { const n = 3, sig = 5;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const cx = x0 + side * (i + 0.5) / n, cy = y0 + side * (j + 0.5) / n;
        for (let y = 0; y < G2; y++) for (let x = 0; x < G2; x++) { const w = 0.8 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sig * sig));
          if (w > 0.01) { const p = (y * G2 + x) * 2; if (w > f[p]) f[p] = w; } } } };
    // the probe geometries the LOCK can hold (makeProbeField's vocabulary). letterA/cross are DENSE (drawn as a chain
    // of dots along each stroke — that density is the on-screen "texture"); lightpts are SOFT Gaussian light points
    // (below the kKnee → coherent); point/pair/grid are HARD dots (above the knee → they decohere; kept for contrast).
    // Switching is a replicated verb (see 'lensobj') and passes through a DOOR (field re-seeded — see the handler).
    const _PROBE_OBJS = ['ring', 'point', 'pair', 'grid', 'cross', 'blob', 'letterA', 'depthscene', 'lightpts'];
    let _solSeeded = false, _solLogBar = -1, _solE0 = -1;
    let _objOrbTheta = 0, _lastTgtX = NaN, _lastTgtY = NaN;   // last commanded transport target (virtGo only on CHANGE — re-arming every frame freezes the chase)
    let _muxOn = false;   // ⧉mux time-share (S7+); OFF (S6) → V runs in a parallel drive block (nSl=1 for W's clock)
    let _syncTraceLeft = 0, _syncTraceSlot = 1;
    let _tbTraceLeft = 0, _tbTraceSlot = 0, _attCadLeft = 0, _attCadSlot = 1, _tbTraceFrom = -1;   // _tbTraceFrom: hold the trace until this SHARED step so both peers log the same window (see tbTrace)
    let _stepTraceLeft = 0, _stepTraceSlot = 1, _primeTrace = 0, _lastShipH = [null, null, null, null];
    let _wattDetEvery = 0, _wattDetBar = -1, _paintDetEvery = 0, _paintDetBar = -1;   // ψATT fork locator (mu1.wattDet) — off by default
    let _clockDetEvery = 0, _clockDetBar = -1;   // step-clock fork locator (mu1.clockDet) — the c0/target/solSteps terms; off by default
    let _forkDetEvery = 0, _forkDetBar = -1, _forkDetSlot = 1, _forkArgPrev = null;   // _forkArgPrev: previous argPin sample, so [FORK] can print its own TREND (a decaying series = the pin converging, not a fork)   // always-on shared-bar state hash (mu1.forkDet) — brackets WHEN a fork happened; off by default
    let _mapDetEvery = 0, _mapDetBar = -1, _mapDetSlot = 1;   // 4×4 tile map of the painted field (mu1.mapDet) — answers WHERE it differs, which no scalar can; off by default
    let _dispEvery = 1;   // Q-blocks between DISPLAY film refreshes (1 = 3x/bar = the old behaviour; 3 = 1x/bar). See mu1.dispRate.
    let _regTraceOn = true, _regTraceLast = -1, _detTickN = 0, _detFieldEvery = 8;   // _detFieldEvery: DET ticks between FIELD-hash syncs. DEFAULT 1 = per-tick (the user's call, 2026-07-30): measured at only 7% of readbacks once throttled, and fork detection is worth more than 7%. mu1.detField(8) if a session ever needs it back.   // [DET] trace ON BY DEFAULT (catch the first fork without enabling) — mu1.regTrace(false) to silence
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
    // _liveAtt(i) — THE ONE ANSWER to "what is slot i actually pinned to right now?": the ψATT hold (rolled to the
    //   current leash offset + rotated by the register angle) when adopted, else null so the caller falls back to its
    //   own probe/plate regeneration. Used by store (the plate must bank the LIVE target, not the retired probe) and
    //   by the residual/⊘ views, so those cannot drift from what the engine is really chasing.
    const _liveAtt = (i) => { const s = _sb.slots[i]; if (!s || !s._attHold || s._digestLeft > 0) return null;
      return _xattBuild(_holdOp(i, s), _holdDx(s), _holdDy(s), s._attHold); };
    // ── THE HOLD IS ROTATED BY THE AGING ONLY — the descPhi0 convention, which ψATT was violating. A probe base is
    //    phase-NEUTRAL (real-valued, global phase 0), so rotating it by the ABSOLUTE register angle is correct: the
    //    register supplies the whole phase. A ψATT hold is a CAPTURED FIELD that ALREADY CARRIES the phase it had at
    //    capture — rotating it by the absolute angle again DOUBLE-COUNTS that phase, so the pin target drifts away
    //    from the very field it was cut from and the lock cannot settle. This is exactly why `descBase` is rotated by
    //    ∠now − descPhi0 (see _descProject/_descPose) and never by ∠now. `_holdPhi0` records the register angle AT
    //    capture, so the pin target = hold rotated by the AGING since then — and dop keeps governing the POSE (which
    //    is the user's point: the register CAN lock a recalled hold, once it rotates by the delta, not the absolute).
    const _holdOp = (i, s) => ({ ..._lensOp[i], phase: lensU1.wrap(lensU1.angle(_lensOp[i]) - (s._holdPhi0 || 0)), prec: 0 });
    // ── THE HOLD SHIFT MUST BE INTEGER. MEASURED: spectralShift is EXACT for integer offsets (RMS deviation from a
    //    plain index roll = 0.0000%), but a FRACTIONAL offset of a hard-edged object leaks 13–17% of its amplitude
    //    OUTSIDE a generously-dilated support — real Gibbs ringing from the letter's sharp pixel edges, streaked along
    //    the shift axes (the horizontal/vertical banding on screen). Under ψATT the hold is re-shifted EVERY BAR at
    //    whatever fractional offset the leash sits at, so the PIN TARGET itself becomes 13–17% ringing — and a pin
    //    target that noisy cannot cleanly pull the soliton to a new place: it fights it, which reads as "tries to
    //    move, then re-locks back". Rounding the shift keeps the target CLEAN (exact roll) and costs at most half a
    //    pixel of placement — far less than the sub-pixel accuracy the ringing was destroying. (A probe att does not
    //    need this: it is REGENERATED at the position, never resampled.)
    const _holdDx = (s) => Math.round(s.leash.state.gx - (s._attHoldPos?.[0] ?? 0));
    const _holdDy = (s) => Math.round(s.leash.state.gy - (s._attHoldPos?.[1] ?? 0));
    // NOTE (2026-07-27): a zero-offset short-circuit (`gx===0&&gy===0 ? copy : spectralShift`) looks free and is NOT
    //   admissible: spectralShift(base,0,0) differs from a plain copy by ~2.7e-15 on 32686/32768 values (the f64 FFT
    //   round-trip), and this builds the PIN TARGET, which is in regH. Peers on either side of that change would fork.
    //   The per-bar cost is removed by CACHING the built target instead (see _selfHold) — same bytes, computed once.
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
    let _dispDesc = [null, null, null, null], _dispDescK = [-1, -1, -1, -1];   // frame-lock film for 𝔸 DESCRIPTOR slots (the field-mode pair below covers W only) — captured at the shared bar, index stamped
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
    let _KHOLD_MAX = 4200;   // ~200 bars of deferral before the hold gives up (mu1.kHold(bars) to tune). The fractal clock re-rings every few bars in a live world, so the hold normally releases far sooner; this is the stall guard, not the expected wait.
    let _kernHold = null;   // {since, ver, need} — set at a join whose kernelVer is older than kernelQueue can replay. While set the soliton does NOT step: the joiner DEFERS until a queued swap lands at its shared step (the generative alignment; see [JOIN-KHOLD]) rather than cold-snapping the kernel at a peer-local frame.
    const _kernApplied = [];   // per-frame [{ atStep, r, w, o }] the kernel swaps W's loop applied → V's loop replays them at the SAME steps (the ring is global _ringTex; V steps through it too)
    const _attApplied = [];    // per-frame [{ atStep, gx, gy }] W's ATTRACTOR schedule (frame-start pose + every leash advance) — the MIRROR drive replays the same att at the same shared steps (movAtt is a pure register fn → deterministic)
    const _kernStep = (t) => Math.floor((t * _MON_RATE - _stepClk.c0) * STEPS_PER_PHASE / (_stepClk.rate || 1));
    // _stageKern(q) — queue every kernel change from the SHARED kernelQueue at its SHARED step. Idempotent (deduped
    //   on ver), so it is safe to call every frame — and it MUST be, not only when this peer's version happens to
    //   differ from the node's: staging concerns FUTURE swaps, and gating it on a momentary version equality makes
    //   which entries a peer holds depend on WHEN its frame sampled the queue. That is peer-local, and it is the
    //   measured source of the residual 1–2 version slip between peers (see the note at the call site).
    const _stageKern = (q) => { let added = 0;
      for (const e of (q || [])) { if ((e.ver | 0) > _E.kernelVer && !_pendKern.some((p) => (p.ver | 0) === (e.ver | 0))) {
          const _off = (e.o || []).map((tier) => Array.from(tier || []));   // deep-copy tiers (survive the node→setRings path intact)
          _pendKern.push({ startStep: _kernStep(e.time ?? 0), r: e.r, w: e.w, o: _off, ver: e.ver | 0 }); added++; } }
      if (added) _pendKern.sort((a, b) => a.startStep - b.startStep);
      return added; };
    let _solH = '--------', _solHStep = -1;   // solH = the FIELD hash captured at the last SHARED Q-boundary step (both peers pass through it identically → comparable across peers, unlike a frame-end hash)
    let _detEvery = 1;   // [DET] log every Q-boundary (7 steps) BY DEFAULT — fine enough to catch the first fork; regTrace(true,N) to coarsen
    // THE PIN STRENGTH (β) — the injection-lock stiffness (finding_pin_injection_lock). A stronger β makes the shared
    // attractor A dominate the field faster → lock→A tightens → each peer's ψ ≈ A ≈ every peer's ψ (images converge,
    // no field exchange). Tunable to find where the lock is tight without over-pinning (the original capped ~0.45).
    // LOCAL/peer-independent by default (a render-quality dial, not replicated) — but see mu1.pin() to sync it.
    let _pinBeta = _TRANSPORT_BETA;
    // LINEAR modes (replicated, eH-affecting): 0 = full nonlinear medium · 1 = FREE linear (SPM+cap+pin off →
    // the gate-D field disperses; nonlinearity-makes-the-soliton proof) · 2 = linear SHARP TRAP (the "sharp eye
    // trap"): pin ON (a LINEAR injection lock to the sharp attractor A) balanced by a LINEAR damping ψ←(1−γ)ψ
    // instead of the nonlinear cap — a driven-damped LINEAR oscillator whose fixed point sits AT A, so the
    // symbol is held SHARP with ZERO nonlinearity (linear holography, not self-focusing).
    let _linearMode = 0;
    // the linear-trap damping DERIVED from β so the fixed point sits AT A (unit gain): steady state of
    // ψ←(1−leak)(ψ+βA) is ψ*≈βA(1−leak)/leak; ψ*≈A ⇒ leak≈β/(1+β). Under-damping (the old fixed 0.02) let the
    // pin over-accumulate → a dim broad blob indistinguishable from the dispersing free field (user-caught).
    const _linLeak = () => { const b = 0.15 * (_lensOp[0].beta || 1); return Math.max(0.02, Math.min(0.5, b / (1 + b))); };
    // ── THE REGISTER ENGINE (extracted to medium-core.js): the pure meta-circular physics core. The app owns
    //    and mutates the live state (ring cache, lens register, slots, edges, linear mode); the engine only READS
    //    it through these getters, so replication/snapshot/verbs stay entirely app-side. See the module header for
    //    the boundary. Byte-identical to the old inline functions — only their closure vars became ctx getters.
    const _reg = makeRegisterEngine({
      GRID, DT, N_CELLS, gamma: _SOL_GAMMA, isat: _SOL_ISAT,
      ringCache: () => _E.ringCache, kernelVer: () => _E.kernelVer,
      lensOp: (i) => _lensOp[i], slots: () => _sb.slots, edge: () => _K.edge,
      linearMode: () => _linearMode, linLeak: _linLeak,
      shardRing: () => _shardDemoRing || _E.ringCache, wSlot: () => W,
      fieldMix: () => _fieldMix,   // the SECOND coupling layer's toggle (edge always couples PHASE; this gates the field-shape bleed)
    });
    const _lambda = _reg.lambda, _lambdaScale = _reg.lambdaScale, _rMid = _reg.rMid, _specLeg = _reg.specLeg;
    const _declProject = _reg.declProject, _regStep1 = _reg.step, _coupledAtt = _reg.coupledAtt;
    const _regStepRegion = _reg.stepRegion, _mkSl2 = _reg.mkSl2, _sl2Rekey = _reg.sl2Rekey;
    // ── _holdDrift(i) — MEDIUM-SEMANTIC IDENTITY CHECK for a ψATT hold. After adoption the slot chases a copy of its
    //    own captured field; `obj` is retired, so the only way to ask "is it still the same thing?" is in charges the
    //    anchors cannot touch. V (second moment) and V̈ are invariant under translation + global phase — precisely the
    //    two freedoms the hold is transported by (_holdDx integer roll, _holdOp aging rotation) — so any change in them
    //    is REAL divergence of the state from what was adopted, not a pose difference. dV is the identity metric; dI is
    //    the Casimir (sl(2)-work done by pin+cap: 0 on free flight, nonzero exactly when something is being forced).
    //    Costs one FFT ⇒ called only on the _vptEvery bar cadence. TELEMETRY ONLY — never enters regH.
    //    ── MEASURED CORRECTION (2026-07-26, live two-slot read): dV against the ADOPTION snapshot is NOT the identity
    //    statistic. The adopted V₀ is an f32 byte-freeze of an instantaneous state; the pin+SPM+cap keep acting and the
    //    state RELAXES to a slightly broader equilibrium. Live control: a slot with gap=0.00px drifted +6.63% while a
    //    slot with gap=13.75px drifted +6.17% — the STATIONARY slot moved MORE. So the ~6% is common-mode relaxation,
    //    not transport damage, and the transport contribution is the DIFFERENTIAL (here ≈0.5%, i.e. ~0). Two fixes:
    //      (a) the reference is the SETTLED V (sampled until it CONVERGES — see _HOLD_TOL), never the byte-snapshot;
    //      (b) the verdict is differential against a stationary control slot when one exists — common-mode cancels.
    //    The band is read from the data (stationary spread), not invented: the old flat 2% sat BELOW the relaxation
    //    floor and so reported every healthy hold as an identity failure.
    //    MEASURED SETTLE CURVE (bench: letterA, β=0.3, pin=own byte-freeze, 8 steps/bar): V rises to +1.06% by bar 3,
    //    then falls monotonically and ASYMPTOTES to ≈−3.0% by bar 20 (−2.89/−2.94/−2.99 at bars 20/22/24 — residual
    //    creep <0.05% per 2 bars). At bar 8 the state is at −0.47% and still mid-transit, so an 8-bar window would
    //    freeze a MOVING value into the reference. 20 bars is past the knee. The SIGN is regime-dependent — the live
    //    two-slot read drifted +6% where this bench drifts −3% — which is exactly why the reference is measured per
    //    hold rather than assumed, and why the verdict is differential against a stationary control.
    //    ── SECOND CORRECTION (2026-07-26, the store→recall read): a fixed bar count is the WRONG settle trigger. It
    //    assumes you know when the transient BEGAN, and recall restarts it (recall rebuilds descBase and re-pins), so
    //    a window opened at recall time closed mid-transit and froze a reference ~6% below where the state was headed
    //    (live: recalled V settled at 8.594e4 while its own live value and the untouched control both sat at ~9.09e4 —
    //    the CONTENT was fine to 0.14%, only the reference was early). So the reference is now taken by CONVERGENCE,
    //    not by clock: sample V each cadence bar and accept the reference only when successive samples agree to
    //    _HOLD_TOL. Self-verifying — it cannot be fooled about when the transient started.
    const _HOLD_MIN = 4;             // minimum bars before convergence may be declared (skip the initial rise)
    const _HOLD_MAX = 80;            // give-up bound: accept the last sample and SAY it never converged
    const _HOLD_TOL = 0.004;         // successive-sample agreement (0.4%) ⇒ settled; the bench's post-knee creep is <0.05%/2bars
    const _HOLD_BAND = 0.03;         // differential band — applied to (dV − common-mode); covers the residual post-knee creep
    const _HOLD_SPREAD = 0.03;       // if stationary controls disagree by more than this there is NO common mode (see _holdCommon)
    // ── the stationary-slot common mode. Returns {com, spread, n, ok}. TWO measured defects fixed here:
    //    (1) `st[st.length >> 1]` is NOT a median for even counts — it picks the upper-middle, i.e. the MAX at n=2, so
    //        the WORST-drifting control silently defined the zero point (live: two stationary slots at 2.38%/5.15%
    //        yielded com=5.15%, which then reported the STABLE slot as "DIVERGED −2.77% ⇒ IDENTITY failure").
    //    (2) a common mode only EXISTS if the controls agree. When they disagree by more than _HOLD_SPREAD there is no
    //        shared relaxation to subtract (live: one slot at 0.03% vs another at 5.95% — that 5.95% belonged to ONE
    //        slot, not to the medium), and the honest output is "no common mode", not a confident wrong number.
    const _holdCommon = (rows) => { const st = rows.filter((r) => r.gap != null && r.gap < 1 && r.dV != null).map((r) => r.dV).sort((a, b) => a - b);
      if (!st.length) return { com: null, spread: null, n: 0, ok: false };
      const h = st.length >> 1, med = st.length % 2 ? st[h] : 0.5 * (st[h - 1] + st[h]);   // TRUE median (even ⇒ mean of the two middles)
      const spread = st[st.length - 1] - st[0];
      return { com: med, spread, n: st.length, ok: st.length === 1 || spread <= _HOLD_SPREAD }; };
    // ── _specSynth(field, N, kcut) — THE SPECTRAL RECIPE: keep the N strongest modes below kcut and rebuild the field
    //    from them alone. A THIRD description form, between the two the arc had: `dop`+obj is compact but FOREIGN (a
    //    shared generator both peers call); a ψATT byte-hold is native but has NO generator (128KB, must ride the wire).
    //    A mode list is BOTH — Fourier is the medium's OWN eigenbasis here (λ(k) is diagonal in it; _specLeg propagates
    //    in it), so a recipe written in modes is native description, not an imported vocabulary.
    //    MEASURED (bench: relaxed letterA hold, cut at 0.5·kKnee):
    //      N=64  → 1024 B  shape 0.9005   N=128 → 2048 B  shape 0.9415   N=256+ saturates at 0.9508
    //    vs 131072 B for the f32 hold ⇒ ~64× at 0.94. And the identity bandwidth is NARROW: the sweep found V tracks
    //    the full state down to ~0.35–0.5·kKnee (≈1% of modes) and only scrambles below that (cross inverts at 0.25).
    //    NOTE this corrects the older "sharp strokes ARE the symbol" reading: that is true of the PROBE field, but an
    //    ADOPTED hold is 98.6% low-band (the medium already low-passed it), so the identity lives BELOW the knee.
    //    Deterministic: pure fn of (field bytes, N, kcut) — same inputs ⇒ same output on every peer.
    const _specSynth = (f, N, kcut) => { if (!f || !(N > 0)) return null;
      const re = new Float64Array(N_CELLS), im = new Float64Array(N_CELLS);
      for (let j = 0; j < N_CELLS; j++) { re[j] = f[j * 2]; im[j] = f[j * 2 + 1]; }
      fft2d(re, im, GRID, false);
      const cand = [];
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        const kx = (x <= GRID / 2 ? x : x - GRID) * (2 * Math.PI / GRID), ky = (y <= GRID / 2 ? y : y - GRID) * (2 * Math.PI / GRID);
        if (Math.hypot(kx, ky) > kcut) continue;
        const j = y * GRID + x; cand.push([re[j] * re[j] + im[j] * im[j], j]); }
      cand.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));   // power desc, INDEX asc as the tie-break — a bare power sort is not a total order and could differ across engines
      const keep = cand.slice(0, Math.min(N, cand.length));
      const r2 = new Float64Array(N_CELLS), i2 = new Float64Array(N_CELLS);
      for (const c of keep) { r2[c[1]] = re[c[1]]; i2[c[1]] = im[c[1]]; }
      fft2d(r2, i2, GRID, true);
      const out = new Float64Array(f.length);
      for (let j = 0; j < N_CELLS; j++) { out[j * 2] = r2[j]; out[j * 2 + 1] = i2[j]; }
      return { field: Float64Array.from(Float32Array.from(out)), modes: keep.length, pool: cand.length }; };
    const _kKnee = () => { const rc = _E.ringCache; if (!rc?.r?.length) return Math.PI;
      try { return kernelABCD(rc.r, rc.w, rc.o, { dt: DT, T: 1 }).kKnee; } catch (e) { return Math.PI; } };
    const _holdDrift = (i) => { const s = _sb.slots[i];
      if (!s || !s._attHold || s._digestLeft > 0 || !s._holdSl2 || !s.descBase) return null;
      const now = _mkSl2(s.descBase); if (!now) return null;
      const ref = s._holdRef || s._holdSl2, settled = !!s._holdRef;   // settled ⇒ the relaxation transient is already in the reference
      const h = s._holdSl2;
      return { V: now.V, V0: h.V, Vref: ref.V, settled, refN: s._holdRefN | 0, refStuck: !!s._holdRefStuck, dV: ref.V ? (now.V / ref.V - 1) : null,
        dV0: h.V ? (now.V / h.V - 1) : null,   // kept for the record: drift vs the adoption byte-freeze (relaxation INCLUDED)
        I: now.I, I0: h.I, dI: now.I - h.I,
        gap: (s._attHoldPos && s.descPos) ? Math.hypot(s.descPos[0] - s._attHoldPos[0], s.descPos[1] - s._attHoldPos[1]) : null }; };
    // the verdict, differential when a TRUSTWORTHY stationary control exists. `cm` = the _holdCommon result object.
    //   Three states, and the code must not blur them: controlled (subtract and judge), uncontrolled (no stationary
    //   slot — absolute and provisional), and CONTRADICTED (controls disagree — refuse to judge, report the spread).
    //   The last is new: it is what readings 2 and 3 actually were, and printing a hard verdict there was the bug.
    const _holdVerdict = (d, cm) => { if (d.dV == null) return 'no reference yet';
      const pre = !d.settled ? `(reference NOT settled yet — ${d.refN | 0} sample(s), still converging, so this reading includes the relaxation transient) `
        : d.refStuck ? '(reference accepted WITHOUT convergence — the state never stopped moving within the give-up bound; treat as provisional) ' : '';
      if (cm && cm.n > 0 && !cm.ok)   // controls exist but contradict each other ⇒ there is no common mode to subtract
        return `${pre}NO VERDICT — the ${cm.n} stationary controls disagree by ${(100 * cm.spread).toFixed(2)}% (> ${(100 * _HOLD_SPREAD).toFixed(0)}%), so there is no shared relaxation mode to subtract. This slot's own drift is ${(100 * d.dV).toFixed(2)}%; a differential claim would be arithmetic on noise. Let the references settle, or reduce to ONE stationary control.`;
      const com = cm && cm.ok ? cm.com : null, rel = com == null ? d.dV : d.dV - com, ctl = com != null;
      if (Math.abs(rel) < _HOLD_BAND) return `${pre}${d.gap > 1 ? `SAME state, ${d.gap.toFixed(2)}px short ⇒ TRANSPORT failure — identity intact${ctl ? ' vs the stationary control' : ''}: the pin is not losing the symbol, it is losing the race against self-trapping` : `LOCKED — identity intact${ctl ? ' vs the stationary control' : ''} and in place`}`;
      return `${pre}DIVERGED ${(100 * rel).toFixed(2)}%${ctl ? ' ABOVE the stationary common mode' : ' (UNCONTROLLED — no stationary slot to subtract the relaxation common mode; treat as provisional)'} ⇒ IDENTITY failure`; };
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
    // ── ⌛PIN HOLD (replicated): how long a LIVING recalled slot stays driven by its plate attractor. 0 = FOREVER
    //    (the DEFAULT, and the right setting for normal use — leave it there).
    //    ⚠ WHAT THIS DIAL ACTUALLY DOES, measured after an earlier WRONG diagnosis: the pin is NOT a "projector"
    //    painting a texture over the medium — it is the medium's COHERENCE SOURCE. Fading it does not reveal a
    //    hidden live soliton; the field DECOHERES INTO SPECKLE (spatial speckle-index 1.16 pinned → 1.49 unpinned:
    //    per-cell noise, no symbol, no interference fringes). The interference ripples you want exist BECAUSE the
    //    soliton is locked and coherent — the bright envelope and the fringes are not separable layers.
    //    (The earlier "pin re-draws the clean symbol over damage" measurement was similarity-to-symbol, which cannot
    //    tell DIFFERENT structure from NO structure — the same metric trap as ampCorr elsewhere in this file.)
    //    So N > 0 is a DECOHERENCE EXPERIMENT, not a way to clean up the view. Replicated (it scales the pin → regH).
    let _pinHold = 0;
    const _pinFac = (s, k) => { if (!_pinHold) return 1;                       // 0 = drive forever (default, unchanged)
      const born = s._pinK; if (born == null) return 1;                        // no birth stamp → full drive
      const age = k - born; return age >= _pinHold ? 0 : (1 - age / _pinHold); };   // linear fade over _pinHold shared steps
    let _fieldMix = true;   // the edge's SECOND coupling layer: attractor field-mixing (the soliton shape bleeds toward
                            // a coupled neighbor). ON by default (an edge means "interact" fully). OFF → the edge still
                            // couples PHASE (Kuramoto), but shapes stay pure — isolates the two layers. Replicated (it
                            // gates descBase → in regH; a peer-local flag would fork the field). mu1.fieldMix(false).
    let _coevoOn = false;   // the Einstein loop (gain-gated). OFF by default — the baseline is the open-loop DOP replay
                            // (the target never waits for matter); mu1.coevo(true) opts INTO the back-reaction. Default-off
                            // keeps the plain-transport feel + the pure replay as the reference, and makes the loop a
                            // deliberate, observable choice rather than ambient behavior.
    let _unpinned = false;  // false = lensU1 (pinned, descriptor-predicted gain) · true = lensC1 (field-measured gain)
    let _coevoG = 1;        // the last gain observable (telemetry: 1 = matter kept up, →0 = lagging → target throttled)
    const _COEVO_MAXLAG = 4;   // px of target-lag at which the PINNED gain observable saturates to 0 (the target fully waits)
    let _VIRT_T = 16;   // hologram depth (steps): the ±T spectral leg depth. Linear round-trip → near-exact lift (the
                        // pure-wave case). TUNABLE (replicated verb 'virtt' + slider): larger T = the plate is more
                        // DELOCALIZED (deeper spread). NOTE: a plate is stored with the T that was live AT STORE; the
                        // leg closure reads the CURRENT _VIRT_T, so changing T then recalling an OLD plate mismatches
                        // its store-leg — RE-STORE after changing T (the demo flow: set T → store → recall/damage).
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
      if ((e.mode === 'record' || e.mode === 'recvia' || e.mode === 'store' || e.mode === 'recall' || e.mode === 'recallx' || e.mode === 'recallo') && W.desc) {
        // SYNC BEFORE BUILDING mv (audit 2026-07-31). The guard below syncs the FIELD before the executors read it,
        //   but mv is built HERE — capturing W's leash (gx/gy) and _lensOp — one statement EARLIER. Under turbo the
        //   leash/descBase can still be at a pre-advance step at that moment, so the verb's DESCRIPTOR carried a
        //   pre-sync pose while its FIELD was post-sync: the two disagree, and a recall cued from that mv can select
        //   a different plate on each peer. Advance+sync first so mv and the field describe the SAME shared step.
        if (_turboOn && _gpu && !_shardXspace) { _tbAdvanceAll(k); _tbSyncSlot(0); }
        const mv = { mode: e.mode === 'recvia' ? 'record' : e.mode, amp: e.amp || 0, k, si, scale: e.scale || 'all',
          dop: { ..._lensOp[0] }, gx: W.leash.state.gx, gy: W.leash.state.gy, bw: _tauK ? (_tauK.beatsOf('W') ?? 0) : 0,
          holoMode: e.holoMode | 0, frac: e.frac || 0, block: e.block | 0, seed: e.seed || 0,   // recallo: the occluder params (mode/frac/block/seed → occlude())
          at: Array.isArray(e.at) ? [+e.at[0] || 0, +e.at[1] || 0] : null };   // explicit recall PLACEMENT (recallAt) — where the moment lands, overriding the plate's stored pos
        if (W.descBase) { if (_turboOn && _gpu) { _tbAdvanceAll(k); _tbSyncSlot(0); }   // advance the texture to the verb's stamped step, then read W's bytes back (CPU-mode semantics: the verb sees descBase at k)
          if (mv.mode === 'store') _storeFrom(mv, W.descBase);
          else if (mv.mode === 'recall' || mv.mode === 'recallx') _recallFrom(mv, W.descBase);
          else if (mv.mode === 'recallo') _recallFrom(mv, W.descBase, true);   // occluded cue: bind the FRAGMENT, lift the WHOLE plate
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
      if (e.mode === 'mirror') { if (_turboOn && _gpu && !_shardXspace) { _tbAdvanceAll(k); _tbSyncAll(); }   // TURBO SYNC (audit 2026-07-31): this handler READS field/leash state that feeds regH. Under turbo the GPU holds truth, so an unsynced read takes bytes from a peer-local step and forks. Every state-reading verb must advance+sync at its stamped k first — the store-verb pattern, applied uniformly.
      
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
        if (_turboOn && _gpu && !e.amp) { _tbAdvanceAll(k); _tbSyncAll(); }   // materialize reads descBase → advance+sync every living texture to k first (CPU semantics)
        if (e.amp) {
          for (let i2 = 0; i2 < _sb.slots.length; i2++) { const s2 = _sb.slots[i2]; if (!s2.born || s2.desc) continue;
            let env = (i2 === 0 && _gpu) ? _gpu.readEyePsi() : (s2.field ? Float64Array.from(s2.field) : null);
            if (!env) continue;
            env = Float64Array.from(Float32Array.from(env));   // f32-lattice at capture: the envelope is DYNAMICAL now — a joiner (f32 wire) must hold the leader's exact bytes
            s2.descBase = env; s2._texDirty = true; s2.descPhi0 = lensU1.angle(_lensOp[i2]);
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
            _dispDesc[i2] = null; _dispDescK[i2] = -1;   // the slot is leaving desc mode: its frame-lock film describes a retired state
            s2.descBase = null; s2.descPhi0 = 0; s2.sl2 = null; s2.descHold = null; s2.descPosCap = null; s2.descE0 = null; s2.descDisp = null; s2.descLive = false; s2.descAtt = null; s2.descAttG = null; }   // the field resumes → the register tier retires (the witness IS the state again)
          if (W.field) _E.psiLensed = W.field;
          if (_E.ringCache && _gpu) _gpu.setRings(_E.ringCache.r, _E.ringCache.w, _E.ringCache.o);   // the abstract span only BOOKKEPT kernel versions — upload the current ring before the PDE resumes
          console.log(`[MU1-⌀PDE] MATERIALIZED @step=${k} — the register projected back into the medium; the PDE resumes FROM the descriptor state. THE ORACLE TEST: if the abstraction was faithful, lock→A recovers ≈1 and the soliton simply continues (watch [MU1:transport] lock).`);
        }
        return; }
      if (e.mode === 'refamp') { if (si >= 0) { _lensOp[si].beta = (typeof e.amp === 'number') ? e.amp : 1; console.log(`[MU1] refAmp ${e.src} β=${_lensOp[si].beta.toFixed(2)} @step=${_E.solSteps}`); } }
      else if (e.mode === 'lenstau') { const w = e.amp || 0;
        // PER-SLOT when a src is given (each worldline ages at its own ω — the twin experiment); GLOBAL fallback (all
        // slots) when no src, for back-compat. si was resolved from e.src above (SLOTN.indexOf).
        if (si >= 0 && e.src) { _lensOp[si].omega = w; console.log(`[MU1] lensTau ${e.src} ω=${w.toFixed(3)} @step=${_E.solSteps} — THIS worldline precesses at its own rate`); }
        else { for (const o of _lensOp) o.omega = w; console.log(`[MU1] lensTau ω=${w.toFixed(3)} (ALL slots) @step=${_E.solSteps}`); } }
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
      else if (e.mode === 'linonly') { _linearMode = Math.max(0, Math.min(2, e.amp | 0));
        console.log(`[MU1] linear mode=${_linearMode} @step=${k} — ${_linearMode === 0 ? 'FULL nonlinear medium (SPM + cap + pin)' : _linearMode === 1 ? 'FREE LINEAR (SPM+cap+pin OFF): only gate-D linear propagation → the field DISPERSES (nonlinearity-makes-the-soliton proof)' : 'LINEAR SHARP TRAP: pin ON (linear injection lock to the sharp attractor A) + linear damping ψ←(1−' + _linLeak().toFixed(2) + ')ψ (derived from β for unit gain) instead of the nonlinear cap → the symbol held SHARP by PURELY LINEAR means (a driven-damped oscillator whose fixed point sits at A — linear holography, not self-focusing)'} · REPLICATED (eH-affecting)`); }
      else if (e.mode === 'turbo') { if (_turboOn && !e.amp && _gpu) { _tbSyncAll();   // turning OFF: read back every living texture so the CPU engine resumes from current bytes
          _filmStep = [-1, -1, -1, -1]; if (_gpu.dropFilm) for (let fi = 0; fi < 4; fi++) _gpu.dropFilm(fi); }   // and RETIRE the films: they are turbo-only captures, stale the moment the CPU executor takes over
        // TURNING ON: the GPU textures may still hold bytes from a PREVIOUS turbo session, and _tbAdvanceAll only
        //   primes when `_tbTexStep[i] < 0 || _texDirty`. Without invalidating here, a slot with a leftover
        //   _tbTexStep >= 0 SKIPS the prime and the GPU steps from a stale texture instead of the CPU's current
        //   descBase — so turbo starts from different bytes on each peer ("different fieldH from the start",
        //   reported 2026-07-31). Force a re-prime from the canonical CPU state on every turbo entry.
        if (!_turboOn && e.amp) { for (let ti2 = 0; ti2 < 4; ti2++) { _tbTexStep[ti2] = -1; const st = _sb.slots[ti2]; if (st) st._texDirty = true; } }
        _turboOn = !!e.amp; _tbCur = -1;
        console.log(`[MU1] ⚡turbo ${_turboOn ? 'ON — the GPU executes the U1 ENGINE STEP (same five operators, same f32 grain, batched per Q block; array-in/array-out — no field-mode semantics). REPLICATED: every peer switches executor at this shared step. Caveat, declared: GPU f32 pipelines round differently across VENDORS — cross-device eH needs the CPU executor (universal); turbo trades that for ~10× speed.' : 'OFF — the universal CPU f64 executor resumes'} @step=${k}`); }
      else if (e.mode === 'coevo') { _coevoOn = !!e.amp; console.log(`[MU1] ⟲coevo ${_coevoOn ? 'ON' : 'OFF'} @step=${_E.solSteps} — the Einstein loop (matter throttles its own transport)`); }
      else if (e.mode === 'unpin') { _unpinned = !!e.amp; for (const o of _lensOp) o.gain = 1;   // re-pin resets gain to the U(1) slice; unpin lets it live
        console.log(`[MU1] ${_unpinned ? 'UNPIN → lensC1 (gain FREE: the coevo gate reads TRUE field energy — honest matter back-reaction, momentum channel open; regH may fork)' : 'PIN → lensU1 (gain≡1: the coevo gate reads the descriptor-predicted lag — replay-safe)'} @step=${_E.solSteps}`); }
      else if (e.mode === 'fieldmix') { _fieldMix = !!e.amp; console.log(`[MU1] field-mixing ${_fieldMix ? 'ON — an edge couples BOTH layers: phase entrains (Kuramoto) AND the soliton shape bleeds toward the neighbor' : 'OFF — an edge couples PHASE ONLY (Kuramoto); the soliton shapes stay pure (the second layer is gated off)'} @step=${_E.solSteps} — replicated (gates descBase, in regH)`); }
      // occludebank — DAMAGE THE STORED PLATE ITSELF (memory-side occlusion, the "can a corrupted memory still be
      //   read?" test — distinct from recallo which occludes the CUE). Masks the target plate's `p` (the field image)
      //   AND `w0` (the dressed profile) IN THE BANK, PERMANENTLY. Then a normal recall reads the damaged plate — and
      //   a real hologram still argmaxes + lifts close to the original from what survives. Replicated: applied at the
      //   shared step, occlude is deterministic (mode/frac/block/seed stamped), and the damaged plate bytes ride the
      //   snapshot to joiners (regH hashes plate DOP not p-bytes → identical-damage-at-shared-step keeps peers in
      //   lockstep; the corruption is in the shipped plate, not a per-peer read). gx = plate index (−1 = the last).
      // pinbeta — THE GLOBAL PIN STRENGTH, replicated (2026-08-03). See mu1.pin: _pinBeta scales ψ += β·att at every
      //   step of every slot, so it is PHYSICS. It used to be set locally with no event and was absent from the join
      //   snapshot, so two peers could run the pin at different strengths (measured: 0.25 vs 0.30) → a differently
      //   scaled COMPLEX injection each step → a permanent GLOBAL PHASE offset that the cap could not remove
      //   (amplitude restored exactly, phase not). regH did not catch it: regH covers _lensOp[].beta, not this
      //   multiplier. Stamped like every other physics dial so it lands at the identical shared step.
      else if (e.mode === 'pinbeta') { const _pb0 = _pinBeta; _pinBeta = Math.max(0, Math.min(1, +e.amp || 0));
        console.log(`[MU1-PIN] β ${_pb0.toFixed(2)} → ${_pinBeta.toFixed(2)} @step=${k} (REPLICATED — lands at this shared step on every peer; it scales the per-step pin injection ψ+=β·att, so an unshared β is a permanent global-phase fork with |ψ|² untouched)`); }
      else if (e.mode === 'occludebank') { if (!_plates.length) { console.log('[MU1-BANK⊘] no plates to damage (store a moment first)'); return; }
        const idx = (e.gx | 0) >= 0 ? Math.min(e.gx | 0, _plates.length - 1) : _plates.length - 1;
        // SEED: a DETERMINISTIC per-press mask, derived from the SHARED drain step k via the KWE PRNG (makeRng) — NOT
        //   Math.random(). The verb lands at the shared k on every peer, so makeRng(k,…).nextInt gives the identical
        //   seed on all peers (replicated by construction, no shared-stream consumed). e.seed>0 overrides (explicit).
        const pl = _plates[idx]; const hm = e.holoMode || 7, fr = e.frac || 0, bk = e.block || 8;
        _occFrac = fr; _occMode = hm;   // REFLECT: the verb handler (runs on EVERY peer at the shared step) sets the UI vars — the SAME pattern as virtt→_VIRT_T, which is the one that provably works. The render then reflects _occFrac/_occMode.
        let sd = e.seed | 0; if (sd <= 0) { const _r = makeRng(k, idx, hm, 0x5eed); _r.next(); _r.next(); sd = _r.nextInt(1e9); }   // shared-step-derived → deterministic + varies per press/plate/method (2 warm-up draws mix all inputs)
        // NON-DESTRUCTIVE: occlude FROM the PRISTINE original (captured once as p0/w00), so damage is a LEVEL not a
        //   cumulative wipe — dragging the slider re-damages from clean → frac maps monotonically, and frac=0 HEALS.
        //   p0/w00 are live-only (not shipped); the joiner gets the resulting damaged p (which ships). The pristine
        //   snapshot is idempotent (only set if absent) so a re-damage after restore keeps whatever bytes it has.
        if (pl.p && !pl.p0) pl.p0 = Float64Array.from(pl.p);
        if (pl.w0 && !pl.w00) pl.w00 = Float64Array.from(pl.w0);
        if (pl.p0) pl.p = (fr > 0) ? occlude(pl.p0, { mode: hm, frac: fr, block: bk, seed: sd, G: GRID }) : Float64Array.from(pl.p0);   // fr=0 → restore pristine (heal)
        if (pl.w00) pl.w0 = (fr > 0) ? occlude(pl.w00, { mode: hm, frac: fr, block: bk, seed: sd, G: GRID }) : Float64Array.from(pl.w00);
        const before = pl.p0 || null;
        // if a LIVE slot currently holds this plate (recalled), re-lift so its reconstruction DEGRADES with the damage
        _reliftDamaged(idx);
        const modeName = { 1: 'low-pass', 2: 'high-pass', 3: 'conjugate', 5: 'box', 6: 'half-plane', 7: 'rand-zero', 8: 'rand-noise' }[hm] || 'rand-zero';
        const kept = before && pl.p ? keptFraction(before, pl.p) : 0; pl._dmg = kept;   // record kept-fraction for the plate-view label (local, not shipped)
        console.log(`[MU1-BANK⊘] plate ${idx + 1}/${_plates.length} DAMAGED IN THE BANK (${modeName}, frac=${fr.toFixed(2)}${(hm === 7 || hm === 8) ? `, block=${bk}px` : ''}) → kept ${(kept * 100).toFixed(0)}% of the stored image · the memory is now CORRUPTED · recall@/recall⇄ to read it (a hologram recovers the whole from the survivor); mu1.plateView(${idx}) to SEE the damaged plate @step=${_E.solSteps}`); }
      // platelive — lift a stored plate into a LIVING 𝔸-slot (register-stepped soliton, not a frozen image). gx =
      //   plate index (−1 = last); the slot is the register-strip target (default P2, a spare demo slot). Replicated
      //   (a normal 𝔸-slot birth at the shared step — same as recall). This is the "view plate as a live soliton" op.
      else if (e.mode === 'platelive') {
        const ti = (si >= 1 && si <= 3) ? si : 3;   // src decides the host; the : 3 is only a REPLICATION safety net (a malformed/legacy verb must still land somewhere DETERMINISTIC on every peer). The UI never sends an invalid src — it refuses at press time instead.
        // gx < 0 = RELEASE the host link (the toggle's OFF): the slot keeps its field and keeps living, it simply
        //   stops tracking that plate — so bank damage no longer re-lifts into it. gx ≥ 0 = HOST that plate.
        if ((e.gx | 0) < 0) { const had = _recalledInto[ti]; _recalledInto[ti] = -1;
          console.log(`[MU1-PLATELIVE] ${SLOTN[ti]} RELEASED${had >= 0 ? ` plate ${had + 1}` : ''} — the slot keeps its field and keeps living; bank damage no longer re-lifts into it @step=${_E.solSteps}`); return; }
        if (!_plates.length) { console.log('[MU1-PLATELIVE] no plates (store first)'); return; }
        const idx = Math.min(e.gx | 0, _plates.length - 1); _recallPlateLive(idx, ti, k, Array.isArray(e.at) ? e.at : null); }   // e.at = explicit placement
      // virtt — set the HOLOGRAPHY DEPTH T (the ±T spectral-leg steps). Replicated (store/recall use it → forks if
      //   per-peer). amp = T (clamped [1,256]). Larger T = more delocalized plate. RE-STORE after changing (old
      //   plates were spread at the old T; the leg reads the current T at recall).
      // pinhold — how long a living recalled slot stays DRIVEN by its plate attractor (0 = forever, the default).
      //   Replicated: it scales the pin, which is in regH. See the _pinHold declaration for the measurement that
      //   motivates it (a constant pin re-draws the clean symbol over a 90%-damaged field).
      // lensobj — WHAT THE LOCK HOLDS. The pin target is lensC1.apply(op, makeProbeField(obj)); `obj` decides whether
      //   the medium organizes around a DENSE GLYPH (letterA — a chain of dots along each stroke; that density is the
      //   on-screen "texture") or around LIGHT POINTS. TWO measured requirements make a points-switch actually work
      //   (each alone fails into noise — both were missing at first):
      //   (1) THE DOOR — re-seed every living slot's field+budget from the new attractor (see below); and
      //   (2) FINITE WAIST — use 'lightpts' (Gaussian σ=5, below the ring's kKnee), not hard 3×3 dots (deltas above
      //       the knee, which sit in the dispersive band and can only decohere).
      //   Replicated: the pin target is in regH, and every slot's att regenerates from obj.
      else if (e.mode === 'lensobj') { if (_turboOn && _gpu && !_shardXspace) { _tbAdvanceAll(k); _tbSyncAll(); }   // TURBO SYNC (audit 2026-07-31): this handler READS field/leash state that feeds regH. Under turbo the GPU holds truth, so an unsynced read takes bytes from a peer-local step and forks. Every state-reading verb must advance+sync at its stamped k first — the store-verb pattern, applied uniformly.
      const nm = String(e.obj || '');
        if (!_PROBE_OBJS.includes(nm)) { console.log(`[MU1-OBJ] unknown object '${nm}' — one of: ${_PROBE_OBJS.join(', ')}`); return; }
        _lensObj = nm; _baseCache.clear(); _rebuildBase();   // drop the cached probe fields so every att regenerates from the NEW object
        for (const s2 of _sb.slots) if (s2.descAttG) s2.descAttG.obj = nm;   // living slots re-pin to the new geometry
        _regAttC = W.movAtt ? W.movAtt(W.leash.state.gx, W.leash.state.gy) : _regAttC;
        // ── THE DOOR (measured essential — without it every object switch decays into noise): re-seed each LIVING
        //    slot's FIELD + ENERGY BUDGET from its regenerated attractor. WHY: leaving the old object's field in place
        //    turns it into a mismatched remainder; dispersion+SPM churn it into turbulence, and the energy cap
        //    renormalizes UNIFORMLY (organized and turbulent parts alike) → the noise fraction NEVER decays — the pin
        //    cannot drain it, only add its own pattern (measured: speckle 1.13 vs 0.75; re-seeding through the door →
        //    0.78 ≈ letterA-clean, temporal liveliness preserved). Same idiom as recall/wabs: a state transition is a
        //    DOOR that replaces descBase, not a fight against stale content. descE0 rescales to the new object's own
        //    energy (the render normalizes by peak, so absolute brightness is unaffected; keeping the OLD budget
        //    over-boosts a sparse target ~3× → SPM turbulence — also measured). f32-quantized like recall's births.
        //    All inside the stamped drain at the shared k → byte-identical on every peer; descBase/descE0 ride snap.
        const _door = (s2, att2) => { if (!att2 || !s2.descBase) return;
          const nb2 = Float64Array.from(Float32Array.from(att2)); let e2 = 0; for (let j = 0; j < nb2.length; j++) e2 += nb2[j] * nb2[j];
          s2.descBase = nb2; s2.descE0 = e2 || 1; s2._engE = e2; s2.descDisp = Float64Array.from(nb2); s2._texDirty = true;
          s2._attHold = null; s2._attHoldPos = null; s2._holdPhi0 = 0; s2._holdSl2 = null; s2._attCache = null; s2._shiftCache = null; s2._holdBytesKey = null; s2._holdRef = null; s2._holdRefBar = -1; s2._holdRefPrev = null; s2._holdRefN = 0; s2._holdRefStuck = false; s2._digestLeft = 0; };   // an object switch retires any ψATT hold (the new probe is the pin again)
        if (W.desc && W.descBase && _regAttC) { _door(W, _regAttC); W.sl2 = null; }
        for (let li2 = 1; li2 <= 3; li2++) { const s2 = _sb.slots[li2]; if (!s2.desc || !s2.descLive || !s2.descAttG) continue;
          const att2 = _plateAtt(s2.descAttG.dop, s2.descPos, nm); if (att2) { s2.descAtt = att2; _door(s2, att2); } }
        console.log(`[MU1-OBJ] pin target → '${nm}' @step=${_E.solSteps} — switched THROUGH THE DOOR: every living slot re-seeded from the new attractor (field + energy budget), so the lock re-forms cleanly instead of fighting the old object's remainder as undamped turbulence.${nm === 'lightpts' ? ' lightpts = GAUSSIAN sources (σ=5px, BELOW the ring kKnee → coherent oscillating interference; a hard dot is a delta above the knee and can only decohere).' : (nm === 'point' || nm === 'pair' || nm === 'grid') ? ' NOTE: hard 3×3 dots live ABOVE the kernel kKnee (dispersive band) — expect them to stay noisy; use lightpts for coherent light points.' : ''}`); }
      // selfatt — THE FIELD-AS-ATTRACTOR DOOR (the symbol's identity migrates from the OPERATOR into the FIELD).
      //   amp = digest bars (0 = revert to probe pin). Sequence per living slot: DIGEST (unpin for amp bars — the
      //   medium disperses/'digests' the injected pixels naturally) → ADOPT (the field's own f32 state at the shared
      //   bar becomes the pin target; transport rolls it via spectralShift; the REGISTER's φ/ω rotate it — set lensTau
      //   ω≠0 for the precession that keeps it alive). MEASURED: shape retained (~0.6 vs 0.72 probe), oscillation
      //   register-driven at ~60% of the probe-beat's liveliness; the texture only PARTIALLY softens — by the Gate-D
      //   law the letter's identity lives ABOVE kKnee (its sharp strokes ARE the symbol in this medium's optics), so
      //   a field-borne symbol keeps sharp support, honestly. Replicated: digest countdown + adoption happen at shared
      //   bars; the hold rides the snapshot.
      else if (e.mode === 'selfatt') { if (_turboOn && _gpu && !_shardXspace) { _tbAdvanceAll(k); _tbSyncAll(); }   // TURBO SYNC (audit 2026-07-31): this handler READS field/leash state that feeds regH. Under turbo the GPU holds truth, so an unsynced read takes bytes from a peer-local step and forks. Every state-reading verb must advance+sync at its stamped k first — the store-verb pattern, applied uniformly.
      const bars = Math.max(0, Math.min(64, Math.round(e.amp || 0)));
        if (!bars) { for (const s2 of _sb.slots) { s2._attHold = null; s2._attHoldPos = null; s2._holdPhi0 = 0; s2._holdSl2 = null; s2._attCache = null; s2._shiftCache = null; s2._holdBytesKey = null; s2._holdRef = null; s2._holdRefBar = -1; s2._holdRefPrev = null; s2._holdRefN = 0; s2._holdRefStuck = false; s2._digestLeft = 0; }
          console.log(`[MU1-ψATT] OFF @step=${_E.solSteps} — back to the probe pin (the operator re-asserts the injected symbol)`); return; }
        let n2 = 0; for (const s2 of _sb.slots) if (s2.desc && s2.descBase && (s2 === W || s2.descLive)) { s2._digestLeft = bars; s2._attHold = null; s2._attHoldPos = null; s2._holdPhi0 = 0; s2._holdSl2 = null; s2._attCache = null; s2._shiftCache = null; s2._holdBytesKey = null; s2._holdRef = null; s2._holdRefBar = -1; s2._holdRefPrev = null; s2._holdRefN = 0; s2._holdRefStuck = false; n2++; }
        console.log(`[MU1-ψATT] DIGEST ${bars} bars → ADOPT @step=${_E.solSteps} for ${n2} living slot(s): the pin lifts, the medium digests the injected pixels, then the FIELD'S OWN state becomes the attractor (rolled by the leash, rotated by the register φ/ω — set ω≠0 via lensTau for living precession). The symbol is then carried by MATTER, not by the operator.`); }
      // synthspec — SYNTHESISE → ADOPT, with no probe, no injection and no digest. Takes the slot's CURRENT state,
      //   keeps its N strongest modes below kcut (_specSynth), writes THAT back as descBase, and adopts it directly as
      //   the pin target. The digest phase exists only to disperse INJECTED PIXELS — a synthesised field never had any,
      //   so there is nothing to digest and the door is immediate. Pixels are the render OUTPUT, never the input.
      //   descE0 is recomputed from the synthesised field itself (the _door discipline): inheriting a stale budget
      //   would let the cap rescale the state on its first step and quietly change what was adopted.
      //   Only N + kfrac ride the wire — the recipe is DERIVED from replicated bytes, so every peer computes it.
      //   Verified at the bench: a synthesised state is a legitimate attractor (pinned to itself, 24 bars, it drifts
      //   −1.8% at N=32/128 and −0.6% at N=512 off its own start — it settles, it does not run away or collapse).
      else if (e.mode === 'synthspec') { const N = Math.max(0, Math.min(4096, Math.round(e.amp || 0)));
        const kf = Math.max(0.05, Math.min(4, (e.gx | 0) ? (e.gx | 0) / 100 : 0.5));   // gx = kcut as a PERCENT of kKnee (integer on the wire); default 0.5 — the measured identity floor is 0.35–0.5
        if (!N) { console.log(`[MU1-SYNTH] N=0 — nothing synthesised (pass a mode count; 64–128 is the measured knee of the shape/size curve)`); return; }
        const kc = _kKnee() * kf; let n3 = 0;
        for (let si5 = 0; si5 < _sb.slots.length; si5++) { const s5 = _sb.slots[si5];
          if (!s5.desc || !s5.descBase || !(s5 === W || s5.descLive)) continue;
          if (_turboOn && _gpu && !(si5 === 0 && _shardXspace)) { _tbAdvanceAll(e.k != null ? e.k : _E.solSteps); _tbSyncSlot(si5); }   // read the slot's bytes AT THE STAMPED STEP (the store-verb pattern) — else peers synthesise from different states
          const r = _specSynth(s5.descBase, N, kc); if (!r) continue;
          let e5 = 0; for (let j = 0; j < r.field.length; j++) e5 += r.field[j] * r.field[j];
          s5.descBase = r.field; s5.descE0 = e5 || 1; s5._engE = e5; s5.descDisp = Float64Array.from(r.field); s5._texDirty = true;
          s5._attHold = Float64Array.from(r.field); s5._attHoldPos = [s5.leash.state.gx, s5.leash.state.gy]; s5._holdKeyN = (s5._holdKeyN | 0) + 1; s5._attCache = null; s5._shiftCache = null; s5._holdBytesKey = null;   // ADOPT IMMEDIATELY — no digest: there are no injected pixels to disperse
          s5._holdPhi0 = lensU1.angle(_lensOp[si5]); s5._digestLeft = 0;
          s5._holdSl2 = _mkSl2(s5._attHold); s5._holdRef = null; s5._holdRefBar = (_E.frameBar | 0) + _HOLD_MIN; s5._holdRefPrev = null; s5._holdRefN = 0; s5._holdRefStuck = false;
          if (si5 === 0) W.sl2 = null;
          n3++; if (si5 === 0 || n3 === 1) console.log(`[MU1-SYNTH] ${SLOTN[si5]}: ${r.modes}/${r.pool} modes below k=${kc.toFixed(3)} (${(100 * kf).toFixed(0)}% of kKnee) → ${r.modes * 16} B of recipe vs ${s5.descBase.length * 4} B of f32 field (${(s5.descBase.length * 4 / (r.modes * 16)).toFixed(0)}× smaller)`); }
        console.log(`[MU1-SYNTH] SYNTHESISE→ADOPT @step=${_E.solSteps} on ${n3} slot(s): the field was rebuilt from its own ${N} strongest low-k modes and adopted DIRECTLY as the pin target — no probe, no injection, no digest. The state is now medium-native description (Fourier IS this medium's eigenbasis: λ(k) is diagonal in it), not a foreign generator and not an opaque byte-copy. Set ω≠0 (mu1.lensTau) for living precession; mu1.holdId() to verify identity.`); }
      else if (e.mode === 'pinhold') { _pinHold = Math.max(0, Math.min(4000, Math.round(e.amp || 0)));
        console.log(`[MU1-PINHOLD] ⌛ pin hold = ${_pinHold ? `${_pinHold} steps — DECOHERENCE EXPERIMENT: the drive fades and the soliton loses coherence, degenerating into per-cell SPECKLE (no symbol, no interference fringes). The pin is the medium's coherence source, not a texture painted over it. Set 0 to restore the live soliton.` : '0 = DRIVE FOREVER (the default and the right setting: the lock is what sustains the coherent soliton AND its interference)'} @step=${_E.solSteps}`); }
      else if (e.mode === 'virtt') { const nt = Math.max(1, Math.min(500, Math.round(e.amp || 16))); _VIRT_T = nt;
        console.log(`[MU1-VIRT_T] hologram depth T=${nt} @step=${_E.solSteps} — re-store to bank at this depth (old plates were spread at the previous T); larger T = deeper spread (mu1.sweepOcclusion to measure)`); } };
    // (the shift + reg cursors are now owned by _siShift / _siReg — makeStampedInput; see the pull sites)
    // ── DUAL-LAYER HOLOGRAPHY (S6): a stored moment = BOTH plates. FIELD plate = the 128KB ψ (the IMAGE, via the GPU
    //    forward/backward round-trip). DESCRIPTOR plate = the slot's (M,O) = its readOp copy ≈ 6 floats (the register
    //    MOMENT). The demo's HEADLINE is their EQUIVALENCE: [RECALL-∠] = ω·Δτ from the field round-trip AND from a
    //    pure lensC1 compose on the descriptor — the field is the ground-truth ORACLE proving the cheap path faithful.
    const BANK_MAX = 8;
    // ── THE HOLOGRAM BANK (extracted to medium-core.js): the abstract U1 memory — dual plates (field image +
    //    descriptor algebra), content-address bind, ±T-leg lift, closed-form 𝔸-recall, and the dual-layer aging
    //    readout. medium-u1 supplies its SPECTRAL leg (genuine optical holography); the app keeps the slot-birth +
    //    logging. `_plates` IS the bank's array (same reference) so regH/snapshot/bankScan see identical bytes. The
    //    plate's live-only `a` (att) is attached by the app after store() (the snapshot regenerates it via _plateAtt).
    const _holo = makeHologramBank({
      G: GRID, bankMax: BANK_MAX, sigma: 6, f32: true,
      leg: (f, sign, scale) => _specLeg(f, _VIRT_T, sign * DT, scale),   // the ±T spectral leg = the propagation that makes it HOLOGRAPHY (not just correlation)
      corr: _ampCorr, phaseCorr, shiftScan: (a, b) => crossCorrScan(a, b, GRID), shift: (f, dx, dy) => spectralShift(f, dx, dy, GRID),
      angleOf: (op) => lensU1.angle(op), wrap: (x) => lensU1.wrap(x),
      beatsOf: (nm) => (_tauK ? (_tauK.beatsOf(nm) ?? 0) : 0),
    });
    const _plates = _holo.plates;   // { p: fieldPlate, a: att(live-only), dop: descriptor copy, pos, obj, w0, bw, k }
    const _recalledInto = [-1, -1, -1, -1];   // per-slot: which plate index it last recalled (−1 = none) → memory-damage re-lifts the live reconstruction so it DEGRADES
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
      // exactly, not just up to each peer's monClock sampling moment). The interpolation WINDOW must match the
      // display-refresh cadence: bar (21) in CPU mode, Q (7) under turbo (descDisp + descPos both re-anchor at Q)
      // — else frac (0→1 over a bar) and the Q-anchored descPos disagree → the residual mis-scales.
      const _turboLive = _turboOn && (s.descLive || si === 0);
      const frac = _frameLock ? 0 : _turboLive
        ? Math.max(0, Math.min(1, (fs - Math.floor(fs / Q) * Q) / Q))   // turbo: Q-block window (descDisp+descPos re-anchor at Q)
        : Math.max(0, Math.min(1, (fs - (s.descBar | 0) * 21) / 21));   // CPU: the original bar window (descBar anchor, untouched)
      const dphi = lensU1.wrap(lensU1.angle(_lensOp[si]) - (s.descPhi0 || 0) + (_lensOp[si].omega || 0) * frac);
      // ox/oy = the sub-DISPLAY-tick pose interpolation: the displayed envelope (descDisp) refreshes at a
      // coarse cadence (bar in CPU / Q in turbo), and this offset carries the position between refreshes so
      // the soliton glides smoothly. descPos is re-anchored to the leash at the SAME cadence descDisp refreshes
      // → ox is only the residual since the last refresh (small, never a full-bar jump). THE JITTER (turbo,
      // cat1100) was descPos updating at BAR cadence while descDisp refreshed at Q — ox grew over a bar then
      // snapped; fixed by the Q-cadence descPos re-anchor in the drive loop (they now refresh together).
      const L = s.leash.state; let ox = L.gx - (s.descPos?.[0] ?? 0), oy = L.gy - (s.descPos?.[1] ?? 0);
      // ψATT: the adopted pin target is a copy of the field ITSELF, so the pin drags the soliton far more effectively
      //   than a probe does — MEASURED (integer-shifted hold, leash walked to 12px): the field's own centroid moves
      //   6.81px for a 6px command and 10.74px for 12px, i.e. it very nearly ARRIVES on its own. The residual above
      //   assumes the field still lags its target by the FULL (leash − descPos), which is true for a probe pin but a
      //   large over-estimate here — adding it in full over-translates, and the bar-boundary descPos re-anchor then
      //   snaps it back ("tries to move, re-locks"). The hold is also INTEGER-rolled (see _holdDx), so the render must
      //   not re-introduce a sub-pixel offset the pin target itself does not have. Quarter-weight the residual for an
      //   adopted slot: enough to interpolate the genuine ~1px lag between refreshes, not enough to double-translate.
      if (s._attHold && !s._digestLeft) { ox *= 0.25; oy *= 0.25; }
      // THE LEASH-LEAN (anticipation toward the target) — a render translation of the WHOLE envelope toward
      // L.tx. It belongs ONLY to a STATIC descriptor slot (recalla: the field can't move itself, so the render
      // MUST translate it to show transport). For a LIVE-engine slot the field carries its OWN transport (the
      // pin drags the letter through a stationary medium — halo/wake stay put), so this lean would DOUBLE-
      // translate: it micro-moves the whole field (letter + halo + background) at shift start on top of the
      // real physics — the "whole field moves" artifact (user-caught). Gate it out for live slots; the field's
      // own motion is the only motion (no-tricks: don't move what the medium isn't moving).
      const _live = s.descLive || (si === 0 && s.desc);
      if (L.go && !_live) { const dx = L.tx - L.gx, dy = L.ty - L.gy, d = Math.hypot(dx, dy);
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
    // FIELD-VIEW cycle (LOCAL display dial — peer-local, not in eH; changes nothing physical): 'full' = ψ (the
    // whole field, default) · 'residual' = ψ − A (the MEDIUM'S OWN response: the dressing/halo/wake/SPM texture
    // with the injected symbol subtracted — "the field itself, minus the symbol") · 'bare' = A (the injected
    // attractor alone, no dressing — the clean skeleton). All exact, honest: A and ψ are real state components.
    let _fieldView = 'full'; const _FVIEWS = ['full', 'residual', 'bare'];
    const _attForSlot = (si) => { const s = _sb.slots[si];
      if (si === 0) return _regAttC || (W.movAtt ? W.movAtt(W.leash.state.gx, W.leash.state.gy) : null);   // W's live attractor
      return s?.descAtt || null; };   // a living slot's plate attractor
    const _fieldViewApply = (si, f) => { if (_fieldView === 'full' || !f) return f;
      const a = _attForSlot(si); if (!a || a.length !== f.length) return f;
      const out = new Float64Array(f.length);
      if (_fieldView === 'bare') { for (let j = 0; j < f.length; j++) out[j] = a[j]; return out; }   // bare = A alone
      // residual = ψ with the SYMBOL PROJECTED OUT: ψ − (⟨A,ψ⟩/⟨A,A⟩)·A, the COMPLEX orthogonal projection (the field
      //   is re/im interleaved, so the coefficient is complex: ⟨A,ψ⟩ = Σ conj(A)·ψ). NOT ψ−1·A: at the pin equilibrium
      //   the injected symbol sits at a SMALL, PHASE-ROTATED amplitude (|coeff| ≈ 0.07, not 1), so subtracting the full
      //   A overshoots ~15× and leaves an inverted symbol ghost — and a REAL coefficient leaves the phase-quadrature of
      //   A behind. The complex projection removes EXACTLY the A subspace → the remainder is ORTHOGONAL to the symbol =
      //   the medium's own oscillating dressing (halo/wake). Honest: a component decomposition, coefficient MEASURED
      //   from the live state (an inner product), not a mask.
      let par = 0, pai = 0, aa = 0;   // ⟨A,ψ⟩ = Σ (Ar−iAi)(ψr+iψi) ; ⟨A,A⟩ = Σ|A|²
      for (let j = 0; j < f.length; j += 2) { const ar = a[j], ai = a[j + 1], fr = f[j], fi = f[j + 1];
        par += ar * fr + ai * fi; pai += ar * fi - ai * fr; aa += ar * ar + ai * ai; }
      const cr = aa > 0 ? par / aa : 0, ci = aa > 0 ? pai / aa : 0;   // complex coeff c = ⟨A,ψ⟩/⟨A,A⟩
      for (let j = 0; j < f.length; j += 2) { const ar = a[j], ai = a[j + 1];   // ψ − c·A (complex)
        out[j] = f[j] - (cr * ar - ci * ai); out[j + 1] = f[j + 1] - (cr * ai + ci * ar); }
      return out; };   // residual = ψ − proj_A(ψ) (symbol removed exactly, only the oscillating remainder)
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
    let _filmOn = true, _filmStep = [-1, -1, -1, -1];   // texture-direct display film (see filmCapture): on by default; mu1.film(false) falls back to the readback path for A/B
    let _descTexKey = null, _descPeak = 1;   // which base is on the GPU + its peak (upload/measure once per recall)
    const _drawDesc = (cell, si) => { const s = _sb.slots[si]; if (!s?.descBase || !_gpu || !_gpuCanvas) return false;
      const P = _descPose(si); if (!P) return false;
      // display source = the BAR-GRID buffer when the register engine is live (descDisp — the shared film;
      // the live descBase is mid-bar at a peer-local frame end and would paint DIFFERENT steps on peers)
      // FRAME-LOCK takes precedence over every other display source: it is the "identical shared index ⇒ identical
      //   pixels" guarantee, and it must NOT be overridden by descDisp (peer-local readback step) or by the GPU film
      //   (captured on the peer-local _dispTick). Falls through to the normal sources when locking is off or no
      //   shared-bar capture exists yet.
      const _lockArr = (_frameLock && _dispDesc[si] && _dispDescK[si] >= 0) ? _dispDesc[si] : null;
      const baseArr = _lockArr || s.descDisp || s.descBase;
      // upload only when the buffer OBJECT changed (descDisp is rebuilt each refresh → new identity), but ALWAYS
      // recompute the peak the colormap normalizes by: it is a property of the CONTENT, and a stale peak crushes or
      // blows out the visible dynamic range (worst for SPARSE targets, whose peak is one small spot that moves).
      // TEXTURE-DIRECT: when a film exists for this slot, renderDescField samples it (and its GPU-reduced peak)
      //   directly — no setDescBase upload, no _peakSq scan of a CPU array, and nothing was read back to build it.
      // _turboOn is REQUIRED: the film is captured only in the turbo branch, so in CPU mode any existing film is a
      //   STALE leftover from before the switch — rendering it would freeze the picture (the same regression as the
      //   descDisp gate below). CPU mode therefore always falls back to descDisp, which its own path keeps current.
      // NOTE (2026-08-03): do NOT add `&& s.descLive` here. The outCell label reads "𝔸 PREDICTIVE slot
      //   (descriptor-only, 0 grid steps)" for ANY slot with `desc` set (see the label at the bottom of the render)
      //   — it does NOT mean descLive is false. A recalled V is BOTH desc and descLive, its texture advances every
      //   step, and gating the film on descLive there merely drops the smooth display source for no reason.
      const _useFilm = !_lockArr && _filmOn && _turboOn && _gpu.hasFilm && _gpu.hasFilm(si) && _filmStep[si] >= 0;   // frame-lock overrides the film: the film is captured on the PEER-LOCAL _dispTick, the lock film at the SHARED bar
      if (!_useFilm) { if (_descTexKey !== baseArr) { _gpu.setDescBase(baseArr); _descTexKey = baseArr; }
        _descPeak = _peakSq(baseArr); }
      const op = _lensOp[si], px = (s.descPos?.[0] ?? 0), py = (s.descPos?.[1] ?? 0);
      if (_paintDetEvery && (_E.frameBar % _paintDetEvery) === 0 && _paintDetBar !== _E.frameBar + si * 0.1) {
        _paintDetBar = _E.frameBar + si * 0.1;
        const _sl = _sb.slots[si];
        // fieldH MUST HASH WHAT IS ACTUALLY PAINTED (2026-08-01). It hashed `baseArr` = _lockArr || descDisp ||
        //   descBase — but when the FILM is active the render samples the GPU film texture and descDisp is
        //   deliberately NOT refreshed (_skipCopy). So fieldH was reporting a stale buffer that nothing paints, on
        //   BOTH peers, which made every cross-peer comparison meaningless while the film was on. Hash the film when
        //   the film is the source; hash baseArr otherwise. `src` names which, so the column is never ambiguous.
        let _paintH = null, _paintSrc = 'baseArr';
        if (_useFilm) { try { _gpu.selectEyeSlot(si); _paintH = _hashField(_gpu.readEyePsi()); _paintSrc = 'FILM(gpu)'; _gpu.selectEyeSlot(null); } catch (e) { _paintH = null; } }
        if (_paintH == null) _paintH = _hashField(baseArr);
        console.log(`[PAINT] bar=${_E.frameBar} ${SLOTN[si]} · fieldH=${_paintH} (src=${_paintSrc}) · baseIs=${_sl?.descDisp === baseArr ? 'descDisp' : _sl?.descBase === baseArr ? 'descBase' : 'other'} · regH=${_regH()} · solStep=${_E.solSteps}`
          + ` · OP β=${(op.beta ?? 1).toPrecision(17)} φ=${(op.phase || 0).toPrecision(17)} prec=${(op.prec || 0).toPrecision(17)} ω=${(op.omega || 0).toPrecision(17)}`
          + ` · POSE dphi=${P.dphi.toPrecision(17)} ox=${P.ox.toPrecision(17)} oy=${P.oy.toPrecision(17)} descPos=[${px},${py}] descPhi0=${(_sl?.descPhi0 || 0).toPrecision(17)} descBar=${_sl?.descBar | 0}/${Math.floor((_E.solSteps | 0) / 21)}${(_sl?.descBar | 0) > Math.floor((_E.solSteps | 0) / 21) ? ' *** descBar AHEAD of the current bar → nbD≤0 → φ CAN NEVER TICK AGAIN ***' : ''}${(si > 0 && _sl?.descLive && !(op.omega)) ? ' *** ω=0 on a LIVING slot → the bar tick is gated `if (omega)` so φ CAN NEVER ADVANCE: compare ω with the other peer (a replay must keep the LIVE ω, not the plate\'s stored one) ***' : ''}`
          + ` · att=${_sl?._attHold ? 'ψATT' : _sl?.descAtt ? 'plate' : 'probe'} attH=${_sl?._attHold ? _hashField(_sl._attHold) : '—'} descAttH=${_sl?.descAtt ? _hashField(_sl.descAtt) : '—'} e0=${(_sl?.descE0 ?? 0).toPrecision(17)}`
          + (() => { // THE FIELD'S OWN GLOBAL PHASE, relative to its pin target — the quantity the screenshots show.
            //   Two peers whose ring pattern is RIGIDLY ROTATED differ by a global phase, which no other column
            //   measures: regH, descPhi0, ∠ and the hold hash can all match while the FIELD sits at a different
            //   absolute phase. argPin = arg⟨att, ψ⟩ (the measured lock offset, the same inner product the XY law
            //   uses); |ψ|² and Σψ give a phase-free amplitude check, so a rotation-only difference is separable
            //   from a genuine content difference: SAME |ψ|² + DIFFERENT argPin ⇒ pure global rotation.
            // THESE SCALARS MUST HASH WHAT fieldH HASHES (2026-08-03). They read `baseArr` = descDisp — but when the
            //   FILM is the render source, _skipCopy deliberately STOPS refreshing descDisp, so descDisp is a stale
            //   buffer that nothing paints. That is the exact defect the note above records as fixed for fieldH and
            //   it was never fixed HERE: |ψ|²/Σψ/argPin were frozen constants (identical on every bar) while fieldH
            //   and nowH moved every bar, on BOTH peers. Any cross-peer verdict drawn from them while the film was
            //   on was reading two stale buffers, not the painted state — which is precisely how a phase "fork" can
            //   appear that no other column corroborates. Use the SAME source fieldH used: the film when the film
            //   is the source, baseArr otherwise. src= already names which, so the numbers are never ambiguous.
            let f = baseArr;
            if (_useFilm) { try { _gpu.selectEyeSlot(si); f = _gpu.readEyePsi(); _gpu.selectEyeSlot(null); } catch (e2) { f = baseArr; } }
            let e = 0, sr = 0, si2 = 0; for (let j = 0; j < f.length; j += 2) { e += f[j] * f[j] + f[j + 1] * f[j + 1]; sr += f[j]; si2 += f[j + 1]; }
            let ap = null; const a2 = _sl?.descAtt || (si === 0 ? _regAttC : null);
            if (a2 && a2.length === f.length) { let rr = 0, ii = 0;
              for (let j = 0; j < f.length; j += 2) { rr += a2[j] * f[j] + a2[j + 1] * f[j + 1]; ii += a2[j] * f[j + 1] - a2[j + 1] * f[j]; }
              ap = Math.atan2(ii, rr); }
            return ` · FIELD(${_useFilm ? 'film' : 'baseArr'}) |ψ|²=${e.toPrecision(17)} Σψ=${Math.atan2(si2, sr).toPrecision(17)} argPin=${ap == null ? '—' : ap.toPrecision(17)}`; })()
          // SHIPPED vs nowH: what this peer last SHIPPED in a snapshot vs what descBase holds now. For a LIVING slot
          //   (descLive — a recalled 𝔸-slot) the register engine steps it every frame, so nowH SHOULD advance and a
          //   difference here is normal, not a defect. The old text asserted "a desc slot is NOT stepped (0 grid
          //   steps), so only a DOOR can change it" — true of a PARKED descriptor, false of a living recall, and it
          //   sent several rounds of debugging after correct behaviour. Only flag the genuinely suspicious case.
          + ((_lastShipH[si] && _sl?.descBase) ? ` · SHIPPED=${_lastShipH[si]} nowH=${_hashField(_sl.descBase)}${_lastShipH[si] === _hashField(_sl.descBase) ? ' (unchanged)' : (_sl.descLive ? ' (advancing — LIVING slot, the engine steps it every frame: expected)' : ' *** PARKED desc slot REWRITTEN — a non-living descriptor runs 0 grid steps, so only a DOOR (lensobj/wabs/platelive/recall/damage re-lift) can change it ***')}` : '')
          + ` · CAP=${(_gpu && _gpu.applyEyeEnergyCapNS) ? 'NS(f32 shader scale)' : 'RB(f64 cpu scale)'}`
          + ` · TURBO on=${_turboOn ? 1 : 0} tbCur=${_tbCur} texStep=[${_tbTexStep.join(',')}] texDirty=${_sl?._texDirty ? 1 : 0} texSynced=${_sl?._texStepSynced ?? '—'} filmStep=${_filmStep[si]}`
          + ` · frameLock=${_frameLock ? _frameLockGrid : 'off'}`); }
      _gpu.renderDescField({ ox: P.ox, oy: P.oy, cx: GRID / 2 + px + P.ox, cy: GRID / 2 + py + P.oy,
        kx: op.kx || 0, ky: op.ky || 0, phi: P.dphi, ampView: _ampFor(true) ? 1 : 0, filmId: _useFilm ? si : null, peakGain: _GLOW }, _descPeak * _GLOW);   // peakGain = the same _GLOW the legacy path folds into smoothMax, so film and readback paths normalize IDENTICALLY
      _blit(cell); return true; };

    // ── SLOT VIEWS (S5): "eye/medium scopes" are re-derived as slot VIEWS. There is ONE view slot the observer looks
    //    at (default W = the world; select V/P to look at those). PERCEPTION = render the selected slot THROUGH its
    //    own readOp (lensU1.apply — the ψ_out = Op·ψ_in read primitive) when lensView is on; raw ψ otherwise. This
    //    dissolves the old two-scope UI: "which scope" becomes "which slot", and "the eye" is just viewing V. ──
    let _viewSlot = 0;                                       // which slot the outCell shows (0=W, 1=V, 2=P1, 3=P2)
    let _plateView = -1;                                     // ≥0 = draw stored plate `p` directly (see the MEMORY itself, incl. damage); −1 = off. Local display, no replicated state.
    let _occView = false;                                    // LOCAL toggle: when viewing a slot that holds a damaged plate, draw the DAMAGED PLATE (pre-lift — the occluded regions visible) instead of the reconstructed result. Peer-local view, no replicated state (like _plateView / _fieldView / frameLock).
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
    // ── the symbol λ(k) grid + scale-selective λ + spectral leg + the bar-exact declaration projection + THE
    //    REGISTER ENGINE's one-step kernel: all EXTRACTED to medium-core.js (bound above as _lambda /
    //    _lambdaScale / _rMid / _specLeg / _declProject / _regStep1). Byte-identical; the app owns the state.
    // ── ⚡TURBO v3 — BAR-CHUNK advance with a global cursor (the profile's verdict on v2: per-Q readbacks =
    //    3 stalls/bar/slot, 78% of frame in readEyePsi). One readback per BAR per living slot; between
    //    advances descBase lawfully LAGS solSteps by <1 bar, and every reader syncs on demand at its own
    //    stamped step: bar boundaries (before the XY/film reads), field-verbs (advance to k — the CPU
    //    semantics exactly), snapshots (advance to solSteps), swap-frames (frame-end sync: _kernApplied resets
    //    per frame, so a lag across a swap frame would lose the pre-swap ring). All sync points are pure fns
    //    of stamped shared steps → deterministic. Ring reconstruction per slot as before.
    // ── ⚡TURBO v4 — RESIDENT-TEXTURE advance (no per-bar readback). Each living slot keeps its state in a GPU
    //    texture (selectEyeSlot); the executor advances it in place. descBase (CPU) stays the CANONICAL state —
    //    the texture is only a between-sync CACHE of it — but is refreshed by readback ONLY when a consumer
    //    needs bytes: _tbSyncSlot(i)/_tbSyncAll() at bar hashes, verbs, snapshots. Between syncs descBase is
    //    STALE and _tbTexStep[i] > the descBase's step; sl._texDirty marks it. THE HONESTY INVARIANT (preserves
    //    the U1 shift from the old texture-as-state medium): the texture is authoritative only between sync
    //    points, each a pure fn of shared steps; at every step a determinism reader observes, descBase is
    //    synced first → the CPU register is never stale where the contract reads it. mu1.pure() still counts GPU
    //    steps; the register still forks or doesn't.
    const _tbTexStep = [-1, -1, -1, -1];   // the shared step each slot's TEXTURE holds (−1 = not resident)
    const _tbLive = (i) => { const sl = _sb.slots[i]; return sl.desc && sl.descBase && sl.descE0 && (i === 0 || sl.descLive); };
    // ── CROSS-SLOT ATTRACTOR COUPLING (real, physical — the U1 register form of the old shared-substrate
    //    "β mixes slots"). Slot i's pin target = its own att + Σ_j κ_ij · (slot j's FIELD): the soliton is
    //    pulled toward a coupled neighbor's shape, so it physically DEFORMS toward it (V observing W → V's
    //    letter bleeds toward W's). Driven by the SAME edge κ as the Kuramoto phase law (consistent: an edge
    //    means "these slots interact"), so it rides regH via _K.edge — deterministic, byte-replicated. κ>0
    //    attracts (blend), κ<0 repels (anti-blend). Returns a fresh composite att, or the bare att if uncoupled.
    // _coupledAtt (cross-slot attractor/Kuramoto coupling) EXTRACTED to medium-core.js (bound above).
    // upload descBase → the slot's resident texture (only when the CPU side was mutated externally: a verb, a
    // fresh recall, or first prime); after this the texture and descBase agree at _tbCur.
    const _tbPrime = (i) => { const sl = _sb.slots[i]; _filmStep[i] = -1; if (_gpu.dropFilm) _gpu.dropFilm(i);   // the CPU side just replaced the texture — any film of the OLD content is stale
      _gpu.selectEyeSlot(i);
      // BOTH halves (2026-08-03): a prime replaces the slot's CPU-side truth, so leaving the opposite half holding
      //   older content lets any later parity flip resurrect bytes that are no longer the state. Same reasoning as
      //   the join prime — see the setEyePsiBoth note in _restoreSnap. Makes the primed state parity-independent.
      (_gpu.setEyePsiBoth || _gpu.setEyePsi).call(_gpu, sl.descBase); _gpu.commitEyeSlot(i); _gpu.markEyeSlotPrimed(i); _tbTexStep[i] = _tbCur; sl._texDirty = false;
      if (_primeTrace > 0) { _primeTrace--;
        // PRIME RECEIPT: what went UP to the GPU, and what comes straight back DOWN. If up != down the upload did not
        //   land where the stepper reads (wrong slot selected, wrong parity, or the texture is not the stepped one) —
        //   which on a join means turbo steps the joiner's PRE-JOIN texture while the CPU side holds the leader's bytes.
        let back = '—'; try { back = _hashField(_gpu.readEyePsi()); } catch (e) {}
        console.log(`[PRIME] ${SLOTN[i]} · up=${_hashField(sl.descBase)} · readback=${back} · tbCur=${_tbCur} texStep=${_tbTexStep[i]} · ${back === _hashField(sl.descBase) ? 'MATCH — the GPU holds the restored bytes' : '*** MISMATCH — the upload did not land in the stepped texture ***'}`); } };
    // sync one slot's descBase FROM its texture (readback) — the only place a per-bar readback can happen, and
    // only when a consumer calls it. Idempotent: no-op if descBase already current at the texture's step.
    const _tbSyncSlot = (i) => { const sl = _sb.slots[i];
      if (_syncTraceLeft > 0 && i === _syncTraceSlot) { _syncTraceLeft--;
        // WHY DOES ONE PEER'S SYNC LAND A Q-BLOCK LATER? Log the DECISION, not just the result: live/texStep gate,
        //   the early-out comparison, and the caller. Two peers with identical cursors that nonetheless sync at
        //   different steps must differ in WHICH CALL reaches here first within the frame.
        const why = !_tbLive(i) ? 'SKIP notLive' : _tbTexStep[i] < 0 ? 'SKIP texStep<0' : (sl._texStepSynced === _tbTexStep[i]) ? 'SKIP already-synced' : 'SYNC';
        const st = (new Error()).stack.split('\n')[2] || '?';
        const ln = (st.match(/medium-u1\.js:(\d+)/) || [])[1] || '?';
        console.log(`[SYNCDEC] ${SLOTN[i]} · ${why} · texStep=${_tbTexStep[i]} texSynced=${sl._texStepSynced ?? '—'} tbCur=${_tbCur} solSteps=${_E.solSteps} · caller=line${ln}`); }
      if (!_tbLive(i) || _tbTexStep[i] < 0) return;
      if (sl._texStepSynced === _tbTexStep[i]) return;
      if (_rbTrace) { _rbN[i] = (_rbN[i] | 0) + 1;   // WHO is forcing this readback? (peer-local diagnostic, off by default)
        const fr = (new Error()).stack.split('\n').slice(2, 6).map((x) => x.trim().replace(/^at\s+/, ''));
        const nm = (x) => { const mm = x.match(/^([^\s(]+)/); const ln = x.match(/medium-u1\.js:(\d+)/); return (mm ? mm[1] : '?') + (ln ? ':' + ln[1] : ''); };
        const key = fr.slice(0, 3).map(nm).join(' < ');   // 3 frames deep: _tbSyncAll alone never says WHO called IT
        _rbSrc[key] = (_rbSrc[key] | 0) + 1; }
      _gpu.selectEyeSlot(i); sl.descBase = _gpu.readEyePsi();
      let eT = 0; for (let j = 0; j < sl.descBase.length; j++) eT += sl.descBase[j] * sl.descBase[j]; sl._engE = eT;
      sl._texStepSynced = _tbTexStep[i]; };
    const _tbSyncAll = () => { for (let i = 0; i < 4; i++) _tbSyncSlot(i); };
    // READBACK TRACE (mu1.rbTrace()): readPixels is a hard GPU pipeline stall — with two peers on one GPU each stall
    //   drains the SHARED queue, so the cost is superlinear in peers. This counts who actually forces one.
    let _rbTrace = false, _rbN = [0, 0, 0, 0], _rbSrc = {}, _rbT0 = 0;
    // advance every living slot's RESIDENT texture from _tbCur to upTo — in place, NO readback at all (the ring
    // swap's carry was removed 2026-07-30: setRings does not touch the eye texture, so nothing needed carrying). descBase is NOT touched here; consumers sync on demand.
    const _tbAdvanceAll = (upTo, skipSlot = -1) => { if (!_gpu || _tbCur < 0 || _tbCur >= upTo) return;
      const cur = _tbCur;
      // COUPLING SNAPSHOT (determinism): if any edge is set, freeze every coupled slot's field AT cur BEFORE
      // advancing any slot — else a slot advanced earlier in the loop would be read at upTo by a later slot
      // (order-dependent, physically inconsistent). All slots share _tbCur here, so one sync-all + copy gives a
      // consistent same-step snapshot; the coupling reads THIS, not the live (mid-advance) descBase.
      let _coupSnap = null;
      if (_K.edge) { let anyEdge = false; for (let a2 = 0; a2 < 4; a2++) for (let b2 = 0; b2 < 4; b2++) if (_K.edge[a2][b2]) anyEdge = true;
        if (anyEdge) { _tbSyncAll(); _coupSnap = _sb.slots.map((s2) => (s2.descBase ? Float64Array.from(s2.descBase) : null)); } }
      for (let si4 = 0; si4 < 4; si4++) { if (si4 === skipSlot || !_tbLive(si4)) continue; const sl = _sb.slots[si4];   // skipSlot: W when it's CPU-sharded (stepped by regionStepX outside this loop)
        // if descBase was mutated externally since the texture last held it, re-prime; else the texture is live
        if (_tbTexStep[si4] < 0 || sl._texDirty) _tbPrime(si4);
        else _gpu.selectEyeSlot(si4);
        let ring = _tbFrameRing; for (const ks of _kernApplied) if (ks.atStep <= cur && ks.r?.length) ring = ks;
        if (ring && ring.r?.length && _tbFrameRingCur !== ring) { _gpu.setRings(ring.r, ring.w, ring.o); _tbFrameRingCur = ring; }
        // att4 IS CAPTURED ONCE PER CALL AND HELD FOR THE WHOLE BLOCK — and this function is invoked at PEER-LOCAL
        //   moments (Q boundaries, verb handlers, snapshots, display ticks), while sl.descAtt is REBUILT in the BAR
        //   loop (once per 21 steps, via _selfHold). So the split of a bar's 21 steps into blocks, and therefore HOW
        //   MANY steps are pinned against the pre-refresh target versus the post-refresh one, is frame-cadence
        //   dependent. attH matching between peers proves only that the BYTES agree — never that the SCHEDULE did.
        //   Why that shows up as a pure ROTATION: applyEyeSuperpose adds β·att (a COMPLEX vector) into ψ every step,
        //   so injecting the refreshed target one step earlier/later tilts ψ's global phase, and the cap (a real
        //   scale) then restores the amplitude exactly — leaving |ψ|² equal to float noise and argPin permanently
        //   offset. Measured 2026-08-03: [SNAP-PHASE]/[JOIN-PHASE] agree to 13 significant figures at the join
        //   (baseH identical, so the payload is faithful), yet [PAINT] argPin drifts to 0.009–0.036 rad apart while
        //   |ψ|² stays within 0.23× the f32 floor. attCur names the step the held target was captured at, so two
        //   peers' [TBSTEP] lines at equal cur= reveal a schedule difference the attH column cannot.
        const _attCapK = cur;
        const att4 = _coupledAtt(si4, si4 === 0 ? _regAttC : sl.descAtt, _coupSnap); if (att4) _gpu.setObjField(att4);
        const b4base = 0.15 * (_lensOp[si4].beta || 1);
        for (let kk2 = cur; kk2 < upTo; kk2++) {
          const b4 = si4 === 0 ? b4base : b4base * _pinFac(sl, kk2);   // ⌛pinHold fades per STEP → recompute inside the loop so turbo matches the CPU executor exactly (W never fades)
          // RING SWAP, NO CARRY (2026-07-30): this used to do readEyePsi → setRings → setEyePsi, a full readback+
          //   re-upload INSIDE the per-step loop, per living slot, every time the fractal clock re-rang the kernel.
          //   Profiled at 46.3% of frame time (_tbAdvanceAll, 2967ms) once the display path went texture-direct.
          //   The carry is NOT needed: setRings writes only the ring/meta textures and _nRings — it never touches
          //   the eye ping-pong or any framebuffer (verified in ifs-gpu.js), so the resident field is untouched by
          //   a ring swap. Dropping the round-trip changes no bytes; it removes a pipeline stall per swap per slot.
          for (const ks of _kernApplied) if (ks.atStep === kk2 && ks.r?.length && _tbFrameRingCur !== ks) { _gpu.setRings(ks.r, ks.w, ks.o); _tbFrameRingCur = ks; if (att4) _gpu.setObjField(att4); }
          if (att4 && _linearMode !== 1 && b4 > 0) _gpu.applyEyeSuperpose(b4);   // pin ON in full + linear TRAP (mode 2); OFF only in free-linear (mode 1), or once pinHold has faded to 0
          _gpu.stepEyeN(1, DT);   // the LINEAR spectral step (gate D) always runs
          if (!_linearMode) { _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); (_gpu.applyEyeEnergyCapNS || _gpu.applyEyeEnergyCap).call(_gpu, sl.descE0); }   // nonlinear SPM+cap: full medium only
          else if (_linearMode === 2 && _gpu.applyEyeScale) _gpu.applyEyeScale(1 - _linLeak());   // linear SHARP TRAP: LINEAR damping balances the pin (driven-damped → sharp fixed point)
          _tbSteps++; }
        _gpu.commitEyeSlot(si4); _tbTexStep[si4] = upTo;
        if (_tbTraceLeft > 0 && si4 === _tbTraceSlot && (_tbTraceFrom < 0 || upTo > _tbTraceFrom)) { _tbTraceLeft--;   // _tbTraceFrom: a SHARED start step, so both consoles log the SAME window (an unaligned window has no comparable line — see tbTrace)
          // TURBO STEP RECEIPT: hash the TEXTURE after the block (readback is diagnostic-only, off by default).
          //   joiner hash CONSTANT while steps climb ⇒ the GPU stepped but the result never reached descBase
          //   (parity/prime bookkeeping) — hash MOVING but != leader ⇒ genuine divergence in the stepping itself.
          // READ THIS AT EQUAL cur=, NEVER BY LINE POSITION (2026-08-03). The trace starts when the VERB IS TYPED,
          //   which is a different wall-clock moment in each console — so two peers' traces cover DIFFERENT step
          //   windows of the same trajectory, and the first lines can look "a constant N steps apart" while nothing
          //   is wrong. Match lines by the cur= value; only then are texH/attH comparable.
          // attH = THE PIN TARGET THIS WHOLE BLOCK WAS STEPPED AGAINST. It is captured ONCE per advance (att4,
          //   above) and held for all `upTo−cur` steps, but for a ψATT slot descAtt is rebuilt only in the BAR loop
          //   (once per 21 steps) while this runs every 7 — so WHICH refresh a given block sees depends on whether
          //   the bar loop ran before or after it within the frame, which is frame-cadence (peer-local) ordering.
          //   Same cur= + same texH-in + DIFFERENT attH ⇒ the peers pinned against targets from different refreshes:
          //   the pin sets the field's GLOBAL PHASE while the cap fixes only amplitude, so that shows up downstream
          //   as matched |ψ|² with a differing Σψ/argPin — the rotation seen on screen, not an amplitude fork.
          // ringH = THE KERNEL THIS BLOCK PROPAGATED THROUGH — the last per-step input that is NOT verified across
          //   peers anywhere in steady state ([SNAP-RING] checks it only at join). It is peer-local BY CONSTRUCTION:
          //   `ring` starts at _tbFrameRing (= _E.ringCache captured at THIS PEER'S frame start) and is then
          //   overridden by any _kernApplied entry with atStep <= cur — but _kernApplied is CLEARED EVERY FRAME.
          //   So a fractal-clock swap recorded in frame N on one peer falls in frame N+1 on a peer whose frame
          //   boundaries sit elsewhere: there it is already folded into _tbFrameRing and the replay loop adds
          //   nothing, while the first peer replays it explicitly. Same steps, same field, DIFFERENT kernel for a
          //   few blocks ⇒ a small permanent phase/shape difference with amplitude untouched (the cap renormalizes).
          //   Same cur= + same texH-in + DIFFERENT ringH is the confirmation; kv is the swap count folded in so far.
          let th = '—'; try { _gpu.selectEyeSlot(si4); th = _hashField(_gpu.readEyePsi()); } catch (e) {}
          let rh = '—'; try { rh = ring?.r?.length ? _hashNums([].concat(Array.from(ring.r || []), Array.from(ring.w || []), ...((ring.o || []).map((t) => Array.from(t || []))))) : '—'; } catch (e) {}
          console.log(`[TBSTEP] ${SLOTN[si4]} · cur=${cur}→${upTo} (${upTo - cur} steps) · texH=${th} · descBaseH=${sl.descBase ? _hashField(sl.descBase) : '—'} · attH=${att4 ? _hashField(att4) : '—'}${sl._attHold ? ' (ψATT)' : ''} attCapK=${_attCapK} attBar=${Math.floor(_attCapK / 21)} · ringH=${rh} ringSrc=${ring === _tbFrameRing ? 'frameStart' : 'kernApplied'} kernQ=${_kernApplied.length} ver=${_E.kernelVer} · primed=${_gpu.eyeSlotPrimed ? (_gpu.eyeSlotPrimed(si4) ? 1 : 0) : '?'} · texDirty=${sl._texDirty ? 1 : 0} · texSynced=${sl._texStepSynced ?? '—'}`); } }
      _gpu.selectEyeSlot(null);
      _tbCur = upTo; };
    // ── THE U1 SHARD EXECUTOR (rung 2 rewired to the register engine — the old path lived in the mirror
    //    loop and died with it): with mu1.region set and NO mirror running, W's engine step computes ONLY the
    //    region (regionStepX: bit-identical inside R by the light-cone margins, cost ∝ |R|), the outside stays
    //    as the peer's DECLARED boundary (frozen witness bytes). CONTRACT CONSEQUENCE, stated honestly: on a
    //    sharded peer the field returns to WITNESS status — eH becomes shard-scoped (tagged in [DET-⌀], not
    //    cross-comparable); regH remains the whole shared contract. The cap follows the rung-1 law: energy is
    //    the ONE GLOBAL datum (summed over the whole field), the scale touches only R (the outside is never
    //    renormalized — the GPU-shard scissor discipline, inherited).
    let _viewAllOn = false, _viewAllCache = { bar: -1, f: null };   // Σ VIEW: linear superposition of the slots' declarations — a labeled VIEW (slots do not interact); per-bar cached CPU composite
    // _edgeTag(i) — the COUPLING readout for the render label: which slots slot i shares a LIVE edge κ with (both the
    //   Kuramoto phase law AND the attractor field-mixing are driven by this same _K.edge). Distinguishes REAL
    //   interaction (an edge → the viewed slot's phase entrains + its field bleeds toward the neighbor) from a mere
    //   overlay (Σ VIEW with no edges). '' when slot i is uncoupled. So the canvas itself says "coupled to …" vs silent.
    const _edgeTag = (i) => { if (!_K.edge) return ''; const parts = [];
      for (let j = 0; j < 4; j++) { const kap = _K.edge[i]?.[j]; if (j !== i && kap) parts.push(`${SLOTN[j]}${kap > 0 ? '+' : '−'}${Math.abs(kap).toFixed(2)}`); }
      return parts.length ? ` · ⇄COUPLED ${parts.join(' ')} (κ: ${_fieldMix ? 'phase entrains + field bleeds — both layers' : 'PHASE only — field-mix OFF, shapes pure'}, in eH)` : ''; };
    const _anyEdge = () => { if (!_K.edge) return false; for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b && _K.edge[a][b]) return true; return false; };
    let _turboOn = false, _turboArmed = true, _tbCur = -1, _tbSteps = 0, _tbLogBar = -1;   // _turboArmed: fire the GPU executor once at boot; disarmed by any explicit toggle or a join (adopt the world's state)
    let _tbFrameRing = null, _tbFrameRingCur = null, _regAttC = null;   // turbo frame context (ring-at-frame-start; the shared pin target)   // ⚡turbo: the GPU as EXECUTOR of the register-engine step (replicated dial; _tbRingStep = atStep of the ring currently on the GPU)
    let _shardRef = null, _shardLogBar = -1, _kurLogBar = -1, _shardActive = false, _shardEconKv = -9999, _shardEconOk = false, _shardEconInfo = null, _shardWarned = false, _shardXspace = false, _shardDemoRing = null;
    const _shardRing = () => _shardDemoRing || _E.ringCache;   // the demo sandbox overrides the shared kernel with a small ring (peer-local; eH forks by design)
    // freeze W.descBase's OUTSIDE-region to the declared boundary (_shardRef), for DISPLAY/OWNERSHIP only —
    // W's TEXTURE keeps the true whole-torus field. HONEST CONSEQUENCE: on the spectral engine the interior is
    // COMPUTED EXACTLY (it read the true field as its boundary, not the declaration), so declaration-only
    // sharding is an ownership/display convention with an EXACT interior (seam-glue ≈ 1, no real approximation).
    // The genuine boundary approximation lives only in the x-space shard (small kernels, frozen texture too).
    const _shardFreezeOutside = () => { if (!_mirRegion || !_shardRef || !W.descBase) return; const reg = _mirRegion;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { if (x >= reg.x0 && x < reg.x1 && y >= reg.y0 && y < reg.y1) continue;
        const j = (y * GRID + x) * 2; W.descBase[j] = _shardRef[j]; W.descBase[j + 1] = _shardRef[j + 1]; } };
    // _regStepRegion (the region/shard engine step) EXTRACTED to medium-core.js (bound above as _regStepRegion).
    // ── THE REGISTER-RESIDENT sl(2) TIER (the gate-F meta-circular rung): V and V̈ are INVARIANT under the
    //    anchors (translation + global phase), so they are pure functions of descBase + the stencil — REGISTER
    //    content. W.sl2 = {V, vdd, I, kv} is captured at every compile door (wabs/autoc), RE-KEYED lazily when
    //    kernelVer moves (the rekeyTest-validated law: same envelope, new stencil), and aged by the ARREST law
    //    (wearTest-measured: a held state is stationary in the invariant — İ_park ≈ −5e3 residual vs +8e5 free
    //    slide). The witness verifies per bar in [VPT] (the lock→A analog for the sl(2) charges). Derived data:
    //    NOT in regH (a pure fn of hashed content + kernelVer adds fork surface, no information) and NOT in the
    //    snapshot (joiners lazily recompute — same bytes by construction).
    // _mkSl2 (the sl(2)/Casimir charge builder) and _sl2Rekey (the FFT-free stencil re-key) EXTRACTED to medium-core.js
    // (bound above). The witness/verifier (_vptRead below) stays app-side.
    // ── THE LIVE GROUP LEDGER (the virial law WIRED TO THE MEDIUM): H and V of W's current field, from the
    //    engine's own operators (kinetic via the λ grid, potential via the closed-form saturable F). W is pinned
    //    AND capped, so H is NOT conserved here — the reading is the REGIME INDICATOR: H<0 = "this state, if
    //    freed (unpinned, uncapped), would collapse" — the VPT call as a live matter observable, ansatz-free.
    //    Peer-local telemetry (a pure fn of the shared field at a shared bar → identical on peers at equal bar).
    let _vptOn = true, _vptEvery = 4, _vptLogBar = -1, _vptLast = null, _vptPrev = null, _sl2KeyN = 0;   // ON BY DEFAULT at coarse cadence (every 4th bar ≈ 1.5s: one FFT — negligible); H is THE physical summary of the medium, so it rides the hdr too; _vptPrev = the last (solSteps, V, I) for the Casimir tier's V̇/İ
    const _vptRead = () => { const lam = _lambda(); if (!lam) return null;
      // source (updated for the register engine, v7): W's live field in field mode; W.descBase in ⌀PDE (the
      // register ENGINE steps it — it IS a live integrating field now, so H is genuinely defined, not a frozen
      // declaration constant as the pre-v7 note claimed); a running MIRROR as a third option. H = the physical
      // summary of whichever the register is actually evolving.
      const f = W.field || (W.desc && W.descBase ? W.descBase : null) || ((V.born && V.mirror) ? V.field : null); if (!f) return null;
      const src = W.field ? 'W' : (W.desc && W.descBase ? 'W-⌀reg' : 'V-mirror');
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
    const _recordV = (phi, k) => { if (_turboOn && _gpu && !_shardXspace) { _tbAdvanceAll(k); _tbSyncSlot(0); }   // TURBO SYNC (audit): reads W.field to record V — an unsynced read captures a peer-local step if (!W.field) return;
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
      // ψATT DETERMINISM (2026-07-31): under ψATT the plate's att is _liveAtt(0) = _xattBuild(op, Δpos, W._attHold),
      //   which reads W's LEASH POSE (_holdDx/_holdDy) — and under turbo the leash/descBase may not be at the stamped
      //   step yet when the drain runs. The ADOPTION site already advances+syncs for exactly this reason ("else peers
      //   could capture different steps"); store needs the same guard, or two peers bank atts built from DIFFERENT
      //   Δpos and the recalled pin target — which is in regH — forks. This is the store-verb pattern, applied.
      if (_turboOn && _gpu && !_shardXspace) { _tbAdvanceAll(k); _tbSyncSlot(0); }
      // the hologram bank owns the plate math (f32-quantized ±T leg + descriptor copy + w0 dressed profile). The
      // f32 discipline (leader f64 vs joiner f32 splits recall's argmax at the margin) is the bank's f32:true default.
      const pl = _holo.store(W.field, _lensOp[0], { pos: [W.leash.state.gx, W.leash.state.gy], obj: _lensObj,
        w0: W.field, bw: _tauK ? (_tauK.beatsOf('W') ?? 0) : 0, k });   // COMPLETE collective coords: dop + pos + obj (self-sufficient for 𝔸-recall); w0 = the DRESSED profile (the medium's own locked soliton, the plate proper)
      if (!pl) return;
      // the plate's attractor = WHATEVER THE SLOT IS ACTUALLY PINNED TO at the store step. Under ψATT that is the
      //   adopted FIELD hold, not the probe — storing the probe would silently re-inject the injected symbol on every
      //   later recall (the plate would carry a texture the live slot had already retired). `selfAtt` marks such a
      //   plate so recall re-enters ψATT instead of the probe pin, and the att bytes must SHIP (a field hold cannot be
      //   regenerated from dop+obj the way a probe att can — that is why `a` is normally omitted from the snapshot).
      pl.a = _liveAtt(0) || W.movAtt(W.leash.state.gx, W.leash.state.gy);
      pl.selfAtt = !!W._attHold;   // the moment was captured in FIELD-CARRIED form
      // ── THE PHASE THE STORED HOLD CARRIES (2026-08-04) — the ψATT-only recall asymmetry ────────────────────────
      //   Under ψATT `pl.a` is _liveAtt(0) = _xattBuild(_holdOp(0,W), dx, dy, W._attHold): W's hold ALREADY ROTATED
      //   by (∠W_op − W._holdPhi0) and SHIFTED by W's pose. So the bytes CARRY a phase, and whoever later adopts
      //   them as a hold must record THAT phase as its _holdPhi0 — _holdOp's contract is "rotate by the aging SINCE
      //   the hold was captured, never by the absolute angle the bytes already carry".
      //   Both recall paths instead set `_holdPhi0 = ∠_lensOp[ti]` — the SLOT'S OWN op at recall time, which is not
      //   the angle these bytes were built with. The convention then subtracts the wrong reference, and the recalled
      //   slot chases a hold rotated by (∠V_now − ∠V_recall) layered on a field already carrying (∠W_store − φ0_W).
      //   Scoped to ψATT (a probe att is phase-neutral, so the absolute angle is correct there) and to RECALL (W
      //   never re-adopts a plate as its hold) — exactly the reported isolation: non-ψATT V restores exactly, ψATT W
      //   restores exactly, only ψATT V/P1/P2 fails.
      pl.aPhi = pl.selfAtt ? lensU1.angle(_holdOp(0, W)) : 0;   // the angle `a` was BUILT with (0 for a probe att)
      try { console.log(`[STORE-ψATT] plate ${_plates.length} · selfAtt=${pl.selfAtt ? 1 : 0} · aPhi=${(pl.aPhi || 0).toPrecision(17)} — an adopter must use THIS as its _holdPhi0, not its own op angle · holdD=[${_holdDx(W)},${_holdDy(W)}] · aH=${pl.a ? _hashField(pl.a) : '—'}`); } catch (e) {}
      console.log(`[MU1-VIRT] STORE atStep=${k} — plate ${_plates.length}/${BANK_MAX} banked (dual: field + descriptor ∠${lensU1.wrap(lensU1.angle(pl.dop)).toFixed(3)}, bw=${pl.bw})`); };
    const _recallMoment = (k, xshift = false) => { if (!_plates.length || !W.field) return;
      if (_turboOn && _gpu && !_shardXspace) { _tbAdvanceAll(k); _tbSyncSlot(0); }   // the cue is W's field/leash AT the stamped step — see _recallDop: an unsynced cue can select a different plate on each peer
      try { console.log(`[RECALL-CUE] path=recallMoment atStep=${k} · cueH=${W.field ? _hashField(W.field) : '—'} · leash=[${W.leash.state.gx.toPrecision(17)},${W.leash.state.gy.toPrecision(17)}] · xshift=${xshift ? 1 : 0} · plates=${_plates.length}`); } catch (e) {}
      // BIND + LIFT via the hologram bank: cue = W now, propagated to plate space (the bank's spectral leg — zero GPU);
      // argmax overlap (xshift → shift-invariant crossCorrScan + relocate). The bank owns the correlation/lift math;
      // the app owns V's slot-birth + the readout logging.
      const bd = _holo.bind(W.field, { xshift }); if (!bd) return;
      const { plate: pl, index: best, scores, shift: bestD, cueLeg: cue } = bd;
      V.field = _holo.lift(pl, { shift: bestD }); _recalledInto[1] = best;   // remember V holds plate `best` → memory-damage re-lifts it
      if (xshift && (bestD[0] || bestD[1])) console.log(`[MU1-RECALLX] shift-invariant match: plate ${best + 1} at δ=(${bestD[0]},${bestD[1]}) → lift RELOCATED to the cue's position (zero-lag would have scored it ${_ampCorr(cue, pl.p).toFixed(3)})`);
      let ve = 0; for (let j = 0; j < V.field.length; j++) ve += V.field[j] * V.field[j]; V.e0 = ve || 1;
      V.att = (xshift && (bestD[0] || bestD[1])) ? (_plateAtt(pl.dop, [(pl.pos?.[0] ?? 0) - bestD[0], (pl.pos?.[1] ?? 0) - bestD[1]], pl.obj) || pl.a) : (pl.a || V.att);
      V.born = true; V.hold = true; V.desc = false; V.mirror = false;
      _lensOp[1].phase = _lensOp[1].prec = 0;
      // THE DUAL-LAYER AGING READOUT (the headline) via the bank: (A) FIELD-measured Δφ = arg⟨plate, cue⟩ (both in
      // plate space → the common propagation cancels, leaving pure aging) vs (B) DESCRIPTOR Δ∠ = ∠now − ∠stored (the
      // exact Σω difference, correct even under a CHANGING ω). |A−B|≈0 is the field-vs-equation proof; ω·Δτ is the
      // constant-ω closed form shown alongside (diverges honestly when ω changed mid-flight).
      const ag = _holo.agingReadout(pl, cue, _lensOp[0], { name: 'W' });
      console.log(`[MU1-RECALL] cue⊗bank=[${scores.join(', ')}] → plate ${best + 1} (stored atStep=${pl.k}) lifted into V`);
      console.log(`[RECALL-∠] Δ(field measured, 128KB)=${ag.dField.toFixed(3)} rad${ag.dDesc != null ? ` · Δ(descriptor Σω, 6 floats)=${ag.dDesc.toFixed(3)} rad` : ''} · Δτ_W=${ag.dTau ?? '—'} beats${ag.eqErr != null ? ` · EQUIVALENCE |field−equation|=${ag.eqErr.toFixed(4)} rad ${ag.agree ? '✓ AGREE (the macro-law describes the micro-physics)' : '✗ DISAGREE (field structure the 6 floats miss, or a non-global phase)'}` : ''}${ag.dOmegaTau != null ? ` · [ω·Δτ closed-form=${ag.dOmegaTau.toFixed(3)} rad — exact only if ω constant since store]` : ''} — the dual-layer readout`); };

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
    const _recallDop = (k) => { if (!_plates.length) return;
      // CUE DETERMINISM (2026-07-31). bindDesc scores the bank against W's LIVE LEASH POSITION, and the winning
      //   plate decides V's whole future: descBase = pl.w0 and descPhi0 = ∠pl.dop. Under turbo the leash/descBase may
      //   not be at the stamped step when the drain runs, so two peers could cue from slightly different positions,
      //   pick a DIFFERENT PLATE (or the same plate at a different score margin), and each settle onto its own static
      //   state — identical register, identical pin, permanently different field. This is the store-verb pattern that
      //   _storeMoment already applies; the recall cue needs it for the same reason.
      if (_turboOn && _gpu && !_shardXspace) { _tbAdvanceAll(k); _tbSyncSlot(0); }
      // 𝔸-RECALL bind via the bank: closed-form content-address on W's DESCRIPTOR position (leash coords, no field
      // read) — the Gaussian exp(−|Δpos|²/2σ²) with object-identity gating. The bank owns the bind; V's descriptor
      // birth stays here. (σ = the ctx sigma:6 — the probe autocorrelation radius.)
      const cx = W.leash.state.gx, cy = W.leash.state.gy;
      const bd = _holo.bindDesc([cx, cy], _lensObj); if (!bd) return;
      const { plate: pl, index: best, scores } = bd;
      // V born in DESCRIPTOR MODE: re-instantiate the REMEMBERED operator (the stored dop) at its stored position; it
      // then lives FORWARD in ω-time from that moment. No V.field/att → the V field-drive block never runs for it.
      _lensOp[1].phase = pl.dop.phase; _lensOp[1].prec = pl.dop.prec || 0; _lensOp[1].omega = pl.dop.omega; _lensOp[1].beta = pl.dop.beta;
      V.desc = true; V.descPos = [pl.pos?.[0] ?? 0, pl.pos?.[1] ?? 0]; V.descObj = pl.obj || _lensObj; V.descBar = Math.floor(k / 21);
      V.descBase = pl.w0 || null; V.descPhi0 = lensU1.angle(pl.dop);   // the DRESSED base (the living profile recorded at store) + the birth angle — _descProject rotates it by ∠now−∠birth (aging only)
      V.field = null; V.att = null; V.hold = false; V.mirror = false; V.born = true; V.leash.release();
      V.leash.state.gx = V.descPos[0]; V.leash.state.gy = V.descPos[1];   // seed the 𝔸-leash AT the stored position (descgo chases FROM here; the render translates by leash − descPos, so the reconstruction starts un-shifted)
      const dDesc = lensU1.wrap(lensU1.angle(_lensOp[0]) - lensU1.angle(pl.dop));   // predicted aging (Σω difference — the [RECALL-∠] (B) path, now primary)
      const dN = (pl.bw != null && _tauK) ? (_tauK.beatsOf('W') ?? 0) - pl.bw : null;
      // CUE RECEIPT: the inputs that DECIDE the recall, printed at full precision. Compare peers at equal atStep=:
      //   cue → the scores → the chosen plate → descPhi0/w0. A difference in ANY of these makes V a permanently
      //   different static state, since the pin then holds each peer at its own fixed point (identical thereafter).
      console.log(`[RECALL-CUE] path=recallDop atStep=${k} · cue=[${cx.toPrecision(17)},${cy.toPrecision(17)}] obj=${_lensObj} · scores=[${scores.map((v) => (+v).toPrecision(17)).join(', ')}] · chose=${best} · dopPhase=${(pl.dop?.phase ?? 0).toPrecision(17)} descPhi0=${lensU1.angle(pl.dop).toPrecision(17)} · w0H=${pl.w0 ? _hashField(pl.w0) : '—'} · plates=${_plates.length}`);
      console.log(`[RECALL-𝔸] cue⊗bank (closed form, no field)=[${scores.join(', ')}] → plate ${best + 1} (stored atStep=${pl.k}, pos ${(pl.pos?.[0] ?? 0).toFixed(1)},${(pl.pos?.[1] ?? 0).toFixed(1)}) — V born DESCRIPTOR-ONLY (0 grid steps) · predicted aging Δ∠=${dDesc.toFixed(3)} rad over Δτ_W=${dN ?? '—'} beats · oracle: run 'recall' (field path) and compare choice+Δ∠`); };

    // ── MIRROR-SOURCED VERB EXECUTORS (⌀PDE): mv = the queue entry (register context AT the drain step — shared-
    //    exact); mf = the mirror's live buffer AT the same shared step (deterministic). All CPU f64 from there
    //    (spectral legs, plate codec) — identical results on every peer by construction. Births → P1 as 𝔸-slots.
    const _storeFrom = (mv, mf) => {   // ⌀PDE store: the witness field mf at the shared step → the bank (spectral leg + f32, owned by the bank)
      const pl = _holo.store(mf, mv.dop, { pos: [mv.gx, mv.gy], obj: _lensObj, w0: mf, bw: mv.bw, k: mv.k }); if (!pl) return;
      // bank the LIVE pin target (see _storeMoment): under ψATT the slot is pinned to its adopted FIELD, so the plate
      //   must carry that — otherwise recall re-injects the probe symbol the slot had already retired.
      pl.a = _liveAtt(mv.si >= 0 ? mv.si : 0) || _plateAtt(mv.dop, [mv.gx, mv.gy], _lensObj);
      pl.selfAtt = !!_sb.slots[mv.si >= 0 ? mv.si : 0]?._attHold;
      console.log(`[MU1-VIRT] STORE (⌀register-sourced) atStep=${mv.k} — plate ${_plates.length}/${BANK_MAX} banked (field from the WITNESS at the shared step + descriptor ∠${lensU1.wrap(lensU1.angle(mv.dop)).toFixed(3)}, bw=${mv.bw})`); };
    const _recordFrom = (mv, mf) => { const ti = (mv.si >= 1 && mv.si <= 3) ? mv.si : 2, P1 = _sb.slots[ti], phi = mv.amp || 0;   // slot-TARGETED (the register-strip selector; default P1)
      const rvOp = { mode: 'id', phase: phi, beta: 1, omega: 0, prec: 0 };
      P1.descBase = Float64Array.from(Float32Array.from(phi ? lensU1.apply(rvOp, mf) : mf));
      _lensOp[ti].phase = phi ? ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : 0; _lensOp[ti].prec = 0; _lensOp[ti].omega = mv.dop.omega;
      P1.desc = true; P1.descPhi0 = lensU1.angle(_lensOp[ti]); P1.descPos = [mv.gx, mv.gy]; P1.descObj = _lensObj; P1.descBar = Math.floor(mv.k / 21);
      P1.field = null; P1.att = null; P1.hold = false; P1.mirror = false; P1.born = true;
      P1.leash.release(); P1.leash.state.gx = mv.gx; P1.leash.state.gy = mv.gy;
      console.log(`[MU1-VIRT] RECORD (⌀register-sourced) atStep=${mv.k}${phi ? ` · THROUGH LENS φ=${phi.toFixed(3)}` : ''} — ${SLOTN[ti]} born as an 𝔸-SLOT (the moment DECLARED: envelope from the witness, descriptor ∠${P1.descPhi0.toFixed(3)} · view:${SLOTN[ti]}, mu1.descGo(x,y,'${SLOTN[ti]}') to transport it)`); };
    const _recallFrom = (mv, mf, occ = false) => { if (!_plates.length) return;
      const xshift = mv.mode === 'recallx';
      // OCCLUSION (recallo): mask the cue to a PARTIAL image BEFORE binding — the classic "break the hologram, still
      // reconstruct the whole scene" test. The bank is UNTOUCHED (full plates); only what W presents as the cue is a
      // fragment. bind still argmaxes correctly from the fragment (ampCorr normalizes by the KEPT energy of both),
      // and lift returns the WHOLE plate. All CPU f64 at the shared step (occlude is deterministic: mode/frac/block/
      // seed are stamped in mv) → in regH, byte-identical across peers. Shift-invariant bind so a fragment that also
      // MOVED is still found+relocated. The readout reports fragment-in (keptFraction) vs whole-out fidelity.
      const cue = occ ? occlude(mf, { mode: mv.holoMode || 7, frac: mv.frac, block: mv.block || 8, seed: mv.seed, G: GRID }) : mf;
      // CUE RECEIPT (all three recall paths carry one — see _recallDop). The cue BYTES decide which plate wins, and
      //   the winner decides V's whole future (descBase/descPhi0), so a peer-local cue makes V a permanently
      //   different static state. Compare peers at equal atStep=: cueH first, then the chosen plate.
      try { console.log(`[RECALL-CUE] path=recallFrom atStep=${mv.k ?? '—'} · cueH=${_hashField(cue)} · occ=${occ ? 1 : 0} xshift=${xshift ? 1 : 0} · plates=${_plates.length}`); } catch (e) {}
      const bd = _holo.bind(cue, { xshift: xshift || occ }); if (!bd) return;
      const { plate: pl, index: best, scores, shift: bestD } = bd;
      const lift = _holo.lift(pl, { scale: mv.scale, shift: bestD }); if (!lift) return;
      if (occ) { const kept = keptFraction(mf, cue), fid = _ampCorr(lift, mf);   // fragment-in vs whole-out — the occlusion signature
        const modeName = { 1: 'low-pass', 2: 'high-pass', 3: 'conjugate', 5: 'box', 6: 'half-plane', 7: 'rand-zero', 8: 'rand-noise' }[mv.holoMode || 7] || 'rand-zero';
        console.log(`[MU1-RECALL⊘] OCCLUDED cue (${modeName}, frac=${(mv.frac || 0).toFixed(2)}${(mv.holoMode === 7 || mv.holoMode === 8 || !mv.holoMode) ? `, block=${mv.block || 8}px` : ''}) → kept ${(kept * 100).toFixed(0)}% of the image · cue⊗bank=[${scores.join(', ')}] → plate ${best + 1} (score ${(bd.corr).toFixed(3)}) · WHOLE reconstruction fidelity vs unoccluded W = ${fid.toFixed(3)} — a real hologram lifts the FULL scene from a fragment (fidelity degrades gracefully as frac↑)`); }
      // the moment is resurrected ALIVE into V (field mode's recall semantics, register-resident): a LIVING
      // 𝔸-slot — the register engine steps it, held toward its plate's regenerated attractor (the pin),
      // transportable via descgo (the pin chase). The mirror role, if V held it, is released — a slot is one
      // thing at a time; every slot is the same TYPE, modes differ.
      const ti = (mv.si >= 1 && mv.si <= 3) ? mv.si : 1, V1 = _sb.slots[ti];   // slot-TARGETED living birth (default V)
      _recalledInto[ti] = best;   // remember this slot holds plate `best` → memory-damage re-lifts the live reconstruction
      _lensOp[ti].phase = 0; _lensOp[ti].prec = 0; _lensOp[ti].omega = mv.dop.omega;
      V1.desc = true; V1.descBase = Float64Array.from(Float32Array.from(lift)); V1.descPhi0 = 0; V1._texDirty = true;   // fresh CPU bytes → turbo re-primes the texture on the next advance
      // THE BIRTH RECIPE (2026-08-03) — so a JOIN can reproduce THIS lift, not a different one. There are TWO recall
      //   births and they are NOT interchangeable: _recallFrom (cue⊗bank, this one) lifts with {scale, shift:bestD}
      //   and sets descPhi0 = 0 / op.phase = 0; _recallPlateLive lifts with {scale:'all'} and sets
      //   descPhi0 = ∠pl.dop / op.phase = ∠pl.dop. The join replay only ever called _recallPlateLive, so a slot the
      //   leader birthed HERE was re-derived on the joiner through the OTHER path — different lift arguments and a
      //   different aging reference (dphi = ∠now − descPhi0), i.e. a genuinely different reconstruction from the
      //   same plate. Measured: the leader logged [MU1-RECALLX] while the joiner logged [MU1-PLATELIVE].
      // WHERE THE RECALLED MOMENT LANDS — three cases, in priority order:
      //   1. mv.at  → an EXPLICIT commanded position (recallAt / the at:[x,y] option): place it THERE. Without this
      //      every recall could only land at the plate's stored pos (recall@) or at the cue's pos (recall⇄) — there
      //      was no way to say "bring that moment HERE, to this spot".
      //   2. pl.pos − bestD → the stored pos, relocated by the shift-scan offset (recall⇄ finds a MOVED moment and
      //      brings it to where the cue now is; bestD is [0,0] for zero-lag recall@, so that lands at the stored pos).
      //   3. mv.gx/gy → the verb's carried coords (a plate with no stored pos).
      const _atPos = Array.isArray(mv.at) ? [+mv.at[0] || 0, +mv.at[1] || 0] : null;
      V1.descPos = _atPos || (pl.pos ? [pl.pos[0] - bestD[0], pl.pos[1] - bestD[1]] : [mv.gx, mv.gy]); V1.descObj = pl.obj || _lensObj;   // (descBar is set below, from the STORE step — see the store-anchored note)
      V1._birth = { via: 'recallFrom', scale: mv.scale || 'all', shift: bestD ? [bestD[0], bestD[1]] : null, atPos: _atPos ? [..._atPos] : null };   // the birth recipe (declared here, after _atPos) — see the note above the lift
      // STORE-ANCHORED ω-TIME — the same law as _recallPlateLive (see the long note there): a recall RESURRECTS a
      //   stored moment, so the cursor is anchored to the PLATE's own step (pl.k, baked into the plate and therefore
      //   identical on every peer and at every join), never to the recall step (which depends on WHEN each peer
      //   recalled and has to be reconstructed from the wire on a join). Both birth paths must agree, or a joiner
      //   replaying through the other path re-derives a different phase from the same plate.
      const _anchorK = (typeof pl.k === 'number') ? (pl.k | 0) : (mv.k | 0);
      const _agedBars = Math.max(0, Math.floor((mv.k | 0) / 21) - Math.floor(_anchorK / 21));   // aging since the STORE, applied at birth (see the note in _recallPlateLive)
      if (_agedBars && _lensOp[ti].omega) _lensOp[ti].phase = ((_lensOp[ti].phase + _agedBars * _lensOp[ti].omega) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      V1.descBar = Math.floor((mv.k | 0) / 21);
      V1.descPosCap = [...V1.descPos]; V1.descCapBar = Math.floor(_anchorK / 21); V1.descHold = null;
      let eL = 0; for (let j = 0; j < V1.descBase.length; j++) eL += V1.descBase[j] * V1.descBase[j]; V1.descE0 = eL || 1;
      V1.descLive = true; V1.descAttG = { dop: { ...pl.dop }, obj: pl.obj || _lensObj }; V1._pinK = _anchorK;   // the ⌛pinHold fade clock runs from the STORE step
      V1.descAtt = _plateAtt(pl.dop, V1.descPos, pl.obj || _lensObj); V1._digestLeft = 0;
      // ψATT INHERITANCE: a plate banked in FIELD-CARRIED form (selfAtt) re-enters ψATT on recall — its stored att IS
      //   a captured field, so the recalled slot is pinned to that, not to a regenerated probe. Otherwise the probe
      //   symbol would reappear in every recalled copy, which is exactly the leak ψATT exists to close. The hold is
      //   anchored at the plate's own position so the leash rolls it from there (same convention as adoption).
      if (pl.selfAtt && pl.a) { V1._attHold = Float64Array.from(pl.a); V1._attHoldPos = [...V1.descPos]; V1._holdKeyN = (V1._holdKeyN | 0) + 1; V1._attCache = null; V1._shiftCache = null; V1._holdBytesKey = null; V1._holdPhi0 = (typeof pl.aPhi === 'number') ? pl.aPhi : lensU1.angle(_lensOp[ti]); V1._holdSl2 = _mkSl2(V1._attHold); V1._holdRef = null; V1._holdRefBar = (_E?.frameBar | 0) + _HOLD_MIN; V1._holdRefPrev = null; V1._holdRefN = 0; V1._holdRefStuck = false; }   // the recalled hold keeps its medium-semantic identity (sl(2) is anchor-invariant, so the banked charges survive the relocation)
      else { V1._attHold = null; V1._attHoldPos = null; V1._holdPhi0 = 0; V1._holdSl2 = null; V1._attCache = null; V1._shiftCache = null; V1._holdBytesKey = null; V1._holdRef = null; V1._holdRefBar = -1; V1._holdRefPrev = null; V1._holdRefN = 0; V1._holdRefStuck = false; }   // a recall birth retires any ψATT hold (the plate att is the pin)
      V1.descDisp = Float64Array.from(V1.descBase);
      V1.field = null; V1.att = null; V1.hold = false; V1.mirror = false; V1.born = true;
      V1.leash.release(); V1.leash.state.gx = V1.descPos[0]; V1.leash.state.gy = V1.descPos[1];
      if (V1._attHold && !V1._digestLeft) { const _a = _liveAtt(ti); if (_a) V1.descAtt = _a; }   // ψATT BIRTH PINS TO ITS HOLD, NOT THE PROBE (AFTER the leash seed → _holdDx/dy=0) — see the full note at the same line in _recallPlateLive (the join-replay-only V/P1/P2 fork)
      const dDesc = (pl.bw != null) ? lensU1.wrap(lensU1.angle(mv.dop) - lensU1.angle(pl.dop)) : null;
      console.log(`[MU1-RECALL${xshift ? 'X' : ''}] (⌀register-sourced) cue⊗bank${xshift ? ' (SHIFT-INVARIANT)' : ''}=[${scores.join(', ')}] → plate ${best + 1} (stored atStep=${pl.k})${(mv.scale && mv.scale !== 'all') ? ` · SCALE=${mv.scale} (${mv.scale === 'coarse' ? 'smooth skeleton — large-radius tiers only' : 'speckle detail — small-radius tiers only'}, exact by the tier theorem; rMid=${_rMid().toFixed(1)})` : ''}${xshift ? ((bestD[0] || bestD[1]) ? ` · δ=(${bestD[0]},${bestD[1]}) → lift RELOCATED to the cue's position` : ' · δ=(0,0) — no relocation needed') : ''} → ${SLOTN[ti]} born LIVING (the register engine steps it; held toward its plate attractor; mu1.descGo(x,y,'${SLOTN[ti]}') to walk it)${dDesc != null ? ` · descriptor aging Δ∠=${dDesc.toFixed(3)} rad over Δτ_W=${(mv.bw - pl.bw) | 0} beats` : ''} · view:${SLOTN[ti]}`); };

    // _recallPlateLive(idx, ti, k) — lift a SPECIFIC plate (by index, no bind) into slot ti as a LIVING 𝔸-slot: the
    //   register engine steps it every frame, held toward its plate attractor → a LIVE SOLITON (not a frozen image).
    //   This is "view plate" done honestly: the memory brought back to life. Damage to the plate re-lifts here
    //   (_recalledInto), so the living soliton degrades as you drag. Same birth as _recallFrom, minus the cue/bind.
    // birth = the recipe recorded at the ORIGINAL recall ({via, scale, shift, atPos}); when present this reproduces
    //   that lift EXACTLY — same scale band, same shift correction, and the same descPhi0/op.phase convention as the
    //   path that actually birthed the slot. A joiner cannot re-run _recallFrom (it needs the live cue field mf,
    //   which the joiner does not have), so the recipe carries the parts of that path that matter for the result.
    const _recallPlateLive = (idx, ti, k, at = null, birth = null) => { const pl = _plates[idx]; if (!pl?.p) return;   // at = [x,y] explicit placement (else the plate's stored pos)
      // A NULL LIFT IS A SILENT NO-OP AND MUST NOT BE (2026-08-03). lift() returns null when the λ-grid is missing
      //   — i.e. when there is no ring/kernelVer yet — and this guard then returned WITHOUT WRITING ANY SLOT STATE,
      //   leaving the caller to believe the recall had been derived. That is exactly how the join replay ran as a
      //   no-op for a whole session (joiner logged liftVer=-1). Say it out loud.
      const lift = _holo.lift(pl, birth ? { scale: birth.scale || 'all', shift: birth.shift || undefined } : { scale: 'all' });   // reproduce the ORIGINAL lift's arguments when a recipe is present
      if (!lift) { console.warn(`[MU1-PLATELIVE] ⚠ ABORTED for plate ${idx + 1} → ${SLOTN[ti]}: _holo.lift returned null (kernelVer=${_E.kernelVer}, ring tiers=${_E.ringCache?.r?.length ?? 0}). The lift is a PROPAGATION through the λ-grid — with no ring there is nothing to propagate through, so NOTHING was written: the slot keeps whatever it already had. If this fires during a JOIN, the kernel is being adopted after the replay.`); return; }
      const V1 = _sb.slots[ti]; _recalledInto[ti] = idx;
      // THE PHASE CONVENTION IS PART OF THE BIRTH RECIPE. _recallFrom sets phase=0/descPhi0=0; _recallPlateLive sets
      //   both to ∠pl.dop. descPhi0 is the AGING REFERENCE (the render computes dphi = ∠now − descPhi0), so mixing
      //   the two conventions makes the same plate reconstruct at a different phase — and the pin then contracts the
      //   two peers toward different fixed points. Follow whichever path actually birthed the slot.
      const _bPhi = (birth && birth.via === 'recallFrom') ? 0 : lensU1.angle(pl.dop);
      // A REPLAY KEEPS THE CURSOR IT WAS GIVEN. On a genuine recall the op is (re)born at the birth phase and ages
      //   from there. On a JOIN REPLAY the caller has already installed the leader's AGED cursor (see the note at
      //   the call site) precisely so that everything derived below — above all _holdPhi0, the ψATT hold's rotation
      //   reference — is consistent with it. Resetting phase here would put _holdPhi0 and the op on different
      //   instants again, which is the mismatch the ordering fix exists to remove. birth.replay marks that case.
      const _isReplay = !!(birth && birth.replay);
      if (!_isReplay) _lensOp[ti].phase = _bPhi;
      // ω IS LIVE REGISTER STATE, NOT A PLATE PROPERTY (2026-08-04) — the frozen-φ bug, second half.
      //   A birth takes ω from the plate's stored dop, which is right: the recalled moment resumes the precession it
      //   was banked with. But a REPLAY must keep the LIVE value the restore already installed from `lensOps`.
      //   Why it matters: ω can be changed AFTER the store (mu1.lensTau / the `lenstau` verb), so a plate banked
      //   while ω was 0 carries dop.omega = 0 forever. The replay then overwrote the joiner's correctly-restored
      //   ω=0.08 with that stale 0 — and the bar tick is gated `if (_lensOp[si].omega)`, so the joiner's φ COULD
      //   NEVER ADVANCE. MEASURED: leader ω=0.080000000000000002 with φ advancing every bar; joiner ω=0 with φ
      //   frozen at 3.0400000000000027 and dphi frozen with it, while descBar/regH/attH/e0 all matched — none of
      //   them read ω. A dead precession is exactly a persistent argPin offset that no state hash can see.
      //   (This is why the earlier ω=0 runs hid it: a stale 0 and a live 0 are indistinguishable.)
      _lensOp[ti].prec = _isReplay ? (_lensOp[ti].prec || 0) : 0;
      if (!_isReplay) _lensOp[ti].omega = pl.dop.omega || 0;
      V1.desc = true; V1.descBase = Float64Array.from(Float32Array.from(lift)); V1.descPhi0 = _bPhi; V1._texDirty = true;   // descPhi0 follows the birth convention (0 for a recallFrom slot, ∠pl.dop for a plateLive one)
      V1._birth = birth ? { via: birth.via, scale: birth.scale, shift: birth.shift, atPos: birth.atPos }   // preserve the ORIGINAL recipe across a replay (drop the transient `replay` marker — it describes THIS call, not the birth)
        : { via: 'plateLive', scale: 'all', shift: null, atPos: at ? [+at[0] || 0, +at[1] || 0] : null };
      // placement, in the SAME priority order the birthing path used: an explicit `at`, else the recipe's atPos,
      //   else the plate's stored pos SHIFT-CORRECTED by the recipe (that is what _recallFrom's bestD does — a
      //   relocated lift lands at pl.pos − bestD, not at pl.pos).
      V1.descPos = at ? [+at[0] || 0, +at[1] || 0]
        : (birth?.atPos ? [...birth.atPos]
        : (pl.pos ? [pl.pos[0] - (birth?.shift?.[0] || 0), pl.pos[1] - (birth?.shift?.[1] || 0)] : [0, 0]));
      // ── STORE-ANCHORED ω-TIME (2026-08-03, user's call) ──────────────────────────────────────────────────────
      //   A RECALL RESURRECTS A STORED MOMENT; the store is the accurate instant, the recall is just when someone
      //   asked for it. So the slot's ω-time cursor is anchored to the PLATE's own step (pl.k), not to the recall
      //   step k. Why this matters beyond taste: pl.k is BAKED INTO THE PLATE, so it is identical on every peer and
      //   at every join, forever. The recall step is not — it depends on WHEN each peer recalled, and on a join the
      //   replay has to reconstruct it from the wire (recallK) while the leader used its own live step. Every
      //   quantity derived from it — the aging cursor (descBar), the capture stamp (descCapBar), the pin-fade birth
      //   (_pinK) — was therefore anchored to an event that is NOT intrinsic to the memory, which is exactly the
      //   class of thing that cannot survive a join. Anchoring to pl.k makes the reconstruction's phase a pure
      //   function of the plate: same answer on any peer, at any join, whenever the recall happened.
      //   This is the same law regH already runs on — derive from shared state, never copy an event.
      //   Fallback to the recall step only for a plate with no k (legacy bank entries).
      const _anchorK = (typeof pl.k === 'number') ? (pl.k | 0) : (k | 0);
      // AGE THE CURSOR AT BIRTH, don't leave a debt for the bar loop. The loop advances phase by
      //   (barA − descBar)·ω on the next boundary; with a store anchor that debt is every bar since the store, so
      //   applying it here makes the slot resume at its aged phase IMMEDIATELY instead of rendering one frame at the
      //   store phase and then jumping. Pure fn of shared values (pl.k, k, ω) ⇒ identical on every peer.
      //   (skipped on a REPLAY: the cursor installed by the caller is ALREADY the aged one — the leader's live
      //    value — so ageing it again would double-count every bar since the store.)
      const _agedBars = _isReplay ? 0 : Math.max(0, Math.floor((k | 0) / 21) - Math.floor(_anchorK / 21));
      if (_agedBars && _lensOp[ti].omega) _lensOp[ti].phase = ((_lensOp[ti].phase + _agedBars * _lensOp[ti].omega) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      // descBar IS THE ω-TICK CURSOR, AND ON A REPLAY IT MUST BE **NOW** (2026-08-04) — the frozen-φ bug.
      //   The bar loop ticks the register by `nbD = barA − descBar` and then sets `descBar = barA`. So descBar must
      //   never be AHEAD of the current bar, or nbD ≤ 0 and the slot's φ NEVER ADVANCES AGAIN.
      //   On a genuine recall, k is the recall step and floor(k/21) is the current bar — fine. On a JOIN REPLAY the
      //   caller passes k = recallK, which store-anchoring made the STORE step (it ships _pinK), so this wrote a
      //   descBar from the wrong epoch while the aging that would have compensated is deliberately skipped
      //   (_isReplay). MEASURED: the joiner's φ froze at a single value (5.4399999999999924) for every bar while the
      //   leader's advanced by ω per bar — with regH/attH/e0/ω all matching, because none of them read φ's motion.
      //   A frozen register clock is exactly a persistent argPin offset that no state hash can see.
      //   On a replay the cursor is already the leader's aged value; anchor descBar to NOW so the tick resumes from
      //   it rather than being disabled.
      V1.descObj = pl.obj || _lensObj; V1.descBar = _isReplay ? Math.floor((_E.solSteps | 0) / 21) : Math.floor((k | 0) / 21);
      V1.descPosCap = [...V1.descPos]; V1.descCapBar = Math.floor(_anchorK / 21); V1.descHold = null;
      let eL = 0; for (let j = 0; j < V1.descBase.length; j++) eL += V1.descBase[j] * V1.descBase[j]; V1.descE0 = eL || 1;
      V1.descLive = true; V1.descAttG = { dop: { ...pl.dop }, obj: pl.obj || _lensObj }; V1._pinK = _anchorK;   // the ⌛pinHold fade clock runs from the STORE step — the plate's own coordinate, identical on every peer
      V1.descAtt = _plateAtt(pl.dop, V1.descPos, pl.obj || _lensObj); V1._digestLeft = 0;
      // ψATT INHERITANCE: a plate banked in FIELD-CARRIED form (selfAtt) re-enters ψATT on recall — its stored att IS
      //   a captured field, so the recalled slot is pinned to that, not to a regenerated probe. Otherwise the probe
      //   symbol would reappear in every recalled copy, which is exactly the leak ψATT exists to close. The hold is
      //   anchored at the plate's own position so the leash rolls it from there (same convention as adoption).
      // ── A REPLAY MUST NOT RE-ANCHOR THE ψATT HOLD (2026-08-03) ────────────────────────────────────────────────
      //   _holdPhi0 is the hold's ROTATION REFERENCE: _holdOp rotates the pin target by (∠now − _holdPhi0) every
      //   bar, so it is physics. The leader's value was taken WHEN IT ADOPTED ψATT — a third instant, neither the
      //   plate's store step nor the recall step — and it rides the wire correctly as descSlots.selfPhi0, restored
      //   just before this replay runs. Re-deriving it here from the current op (whatever that is) throws the
      //   correct value away and gives the joiner a differently-rotated pin target: same bytes, same regH, same
      //   energy, permanently different PHASE — measured at 0.035–0.083 rad while |ψ|² agreed to 0.002–0.040× the
      //   f32 floor. On a REPLAY, keep every restored hold field; only a genuine recall re-anchors.
      if (_isReplay) { /* keep the restored ψATT hold verbatim (bytes, pose, φ0, digest, keyN) */ }
      else if (pl.selfAtt && pl.a) { V1._attHold = Float64Array.from(pl.a); V1._attHoldPos = [...V1.descPos]; V1._holdKeyN = (V1._holdKeyN | 0) + 1; V1._attCache = null; V1._shiftCache = null; V1._holdBytesKey = null; V1._holdPhi0 = (typeof pl.aPhi === 'number') ? pl.aPhi : lensU1.angle(_lensOp[ti]); V1._holdSl2 = _mkSl2(V1._attHold); V1._holdRef = null; V1._holdRefBar = (_E?.frameBar | 0) + _HOLD_MIN; V1._holdRefPrev = null; V1._holdRefN = 0; V1._holdRefStuck = false; }   // the recalled hold keeps its medium-semantic identity (sl(2) is anchor-invariant, so the banked charges survive the relocation)
      else { V1._attHold = null; V1._attHoldPos = null; V1._holdPhi0 = 0; V1._holdSl2 = null; V1._attCache = null; V1._shiftCache = null; V1._holdBytesKey = null; V1._holdRef = null; V1._holdRefBar = -1; V1._holdRefPrev = null; V1._holdRefN = 0; V1._holdRefStuck = false; } V1.descDisp = Float64Array.from(V1.descBase);   // a recall birth retires any ψATT hold
      // ψATT BIRTH PINS TO ITS HOLD, NOT THE PROBE (2026-08-05) — the join-replay-only V/P1/P2 fork, ROOT CAUSE.
      //   descAtt was set to _plateAtt (a PROBE att) unconditionally above, and the ψATT branch adopted _attHold but
      //   never overwrote descAtt. So a ψATT slot leaves this birth fn pinned to a PROBE, and the per-step register
      //   loop (medium-core step: psi += β·descAtt) drives it toward the probe until the NEXT bar boundary rebuilds
      //   descAtt = _selfHold() (line ~4314). A LIVE recall survives that because both connected peers hit the same
      //   shared bar together (the probe epoch is identical and immediately replaced in lockstep). A JOIN does not: the
      //   replay runs mid-bar, so the joiner pins ψATT V against the PROBE for the steps up to the next bar while the
      //   leader — long past its own recall bar — pins against its evolved HOLD. A handful of probe-vs-hold steps near
      //   the contraction leave a permanent argPin offset that no state hash sees (regH/attH/e0/ω all match, exactly
      //   as reported). W is immune (never recalled → never here); non-ψATT V is immune (its pin IS the probe, so the
      //   birth value is already correct). Seed the ψATT pin here — _liveAtt = the same shift+rotate _selfHold builds
      //   (verified byte-identical) — so the slot is born chasing the hold, and both live-recall and join-replay agree
      //   from the birth step, with no wrong-pin epoch to expose.
      V1.field = null; V1.att = null; V1.hold = false; V1.mirror = false; V1.born = true;
      V1.leash.release(); V1.leash.state.gx = V1.descPos[0]; V1.leash.state.gy = V1.descPos[1];
      if (V1._attHold && !V1._digestLeft) { const _a = _liveAtt(ti); if (_a) V1.descAtt = _a; }   // AFTER the leash is seeded to descPos (so _holdDx/_holdDy = 0, the clean birth roll — matches the leader's _selfHold at its recall bar)
      console.log(`[MU1-PLATELIVE] plate ${idx + 1}/${_plates.length} lifted into ${SLOTN[ti]} as a LIVING soliton (register-stepped, held toward its attractor) — damage the plate to watch it degrade LIVE · view:${SLOTN[ti]} · liftVer=${_E.kernelVer} liftH=${_hashField(V1.descBase)} — liftVer is the kernel version whose λ-grid propagated this plate (specLeg→lambda() is cached on kernelVer). A REPLICATED recall runs on every peer at the same shared step, so liftVer matches and so does liftH; a JOIN re-lifts at whatever version is current THEN, and a plate carries no kernelVer of its own — so compare this line's liftVer against the joiner's [JOIN-LIFT]`); };

    // _reliftDamaged(idx) — after a stored plate is damaged, re-lift it into every LIVE slot that recalled it, so the
    //   slot's RECONSTRUCTION visibly DEGRADES with the damage (the "corrupted memory read live" demo). Uses the SAME
    //   lift the recall used (bank ±T leg), writing the slot the same way recall did — field-mode (V.field) or ⌀PDE
    //   (descBase). Pure re-read of the (now damaged) plate; no re-bind (the slot already knows which plate it holds).
    const _reliftDamaged = (idx) => { const pl = _plates[idx]; if (!pl?.p) return;
      for (let ti = 0; ti < _sb.slots.length; ti++) { if (_recalledInto[ti] !== idx) continue; const s = _sb.slots[ti];
        const lift = _holo.lift(pl, { scale: 'all' }); if (!lift) continue;
        if (s.desc && s.descLive) { s.descBase = Float64Array.from(Float32Array.from(lift)); s._texDirty = true;   // ⌀PDE 𝔸-slot: refresh the envelope (register keeps stepping it)
          let e = 0; for (let j = 0; j < s.descBase.length; j++) e += s.descBase[j] * s.descBase[j]; s.descE0 = e || 1; s.descDisp = Float64Array.from(s.descBase); }
        else if (s.field) { s.field = lift; let e = 0; for (let j = 0; j < lift.length; j++) e += lift[j] * lift[j]; s.e0 = e || 1; }   // field-mode
      } };

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
    const _takeSnap = () => {
      // THE CAPTURE STEP IS ASYNCHRONOUS AND MAY BE MID-Q-BLOCK (2026-08-03) — the INTERMITTENCY.
      //   takeSnapshot runs on a `request_snapshot` network message (krestianstvo-wavefront-evaluator.js ~456), so
      //   it fires at an ARBITRARY solSteps, not on a step boundary. The advance below is required (the textures
      //   must hold the bytes we are about to ship) but it advances to _E.solSteps, which in the steady drive is
      //   NOT a multiple of Q: the normal caller is gated on `(k+1) % Q === 0`, so every other block is an aligned
      //   7-step chunk. A mid-block capture therefore executes a PARTIAL block and leaves _tbCur off the Q grid on
      //   the LEADER, while the joiner resumes on it — after which the two peers' blocks are permanently offset.
      //   That is precisely the att4 schedule difference (att4 is captured once per _tbAdvanceAll call and held for
      //   the block, so an offset block boundary changes HOW MANY steps see the pre- vs post-refresh pin target),
      //   and it explains why the symptom is INTERMITTENT: when the request happens to land on a Q boundary the
      //   peers stay aligned and everything matches (measured: [SNAP-PHASE]/[JOIN-PHASE] agreeing to 13 figures on
      //   the runs that landed clean), and when it lands mid-block they rotate apart.
      //   Logged, not silently corrected: rounding the capture step here would change WHICH state is shipped, and
      //   solSteps is the label the joiner adopts — the fix belongs at the block boundary, not in the payload.
      const _capOff = (_E.solSteps | 0) % Q;
      if (_capOff !== 0) console.warn(`[SNAP-ALIGN] ⚠ capture at solStep=${_E.solSteps} is MID-Q-BLOCK (offset ${_capOff}/${Q}) — the leader is about to advance a PARTIAL block, leaving its _tbCur off the Q grid while the joiner resumes on it. Every later block is then offset between the peers, which shifts WHEN the refreshed pin target (att4) enters the step loop → a small permanent GLOBAL PHASE difference (|ψ|² equal, argPin apart). A capture landing ON a boundary (offset 0) stays aligned — that is the intermittency.`);
      else console.log(`[SNAP-ALIGN] capture at solStep=${_E.solSteps} is Q-ALIGNED (offset 0) — blocks stay in phase with the joiner`);
      if (_turboOn && _gpu) { _tbAdvanceAll(_E.solSteps); _tbSyncAll(); }   // turbo: advance every living texture to solSteps AND read back BEFORE any field is captured (a mid-bar lag on the wire would fork the joiner)
      if (_turboOn && _gpu) console.log(`[SNAP-ALIGN] after advance: _tbCur=${_tbCur} (${_tbCur % Q === 0 ? 'ON the Q grid' : `OFF the Q grid by ${_tbCur % Q}`}) — the joiner will anchor _tbCur at the restored solStep and step in aligned Q blocks from there`);
      // NOTE (2026-07-31): a `_q32` pass was added here on the theory that the leader kept f64 while shipping f32.
      //   MEASURED WRONG and removed: saveEngine already f32-quantizes psiLensed (medium-gpu.js), and _tbSyncAll
      //   above has just read descBase back FROM the f32 texture — so the bytes are already f32 and re-quantizing
      //   only allocated a new array and marked the texture dirty ON THE LEADER ONLY, which is an asymmetry between
      //   the peers rather than a fix. The SNAP-SENT/SNAP-RECV receipts confirm the payload is transferred exactly
      //   (same solStep, same descBase hash), so the divergence is NOT in the snapshot.
      // THE LEADER ADOPTS THE f32 IT SHIPS — for the DESC SLOTS (2026-07-31). descSlots ships `base: _b64f(descBase)`,
      //   i.e. Float32Array, but a desc slot is stepped by _regStep1 in f64 (and under turbo read back from an f32
      //   texture, which is already f32 — so this is a no-op there). On the CPU executor the leader therefore keeps
      //   f64 bytes while the joiner resumes from their f32 truncation: the two start on DIFFERENT state, and since
      //   the pin is a CONTRACTION each converges to the fixed point nearest its own start and neither moves again —
      //   the measured signature (|ψ|² frozen and unequal, every input identical). saveEngine already does this for
      //   W's psiLensed; the desc slots had no equivalent. Idempotent for already-f32 buffers.
      for (const s2 of _sb.slots) if (s2?.desc && s2.descBase) {
        s2.descBase = Float64Array.from(Float32Array.from(s2.descBase));
        let e2 = 0; for (let j = 0; j < s2.descBase.length; j++) e2 += s2.descBase[j] * s2.descBase[j];
        s2.descE0 = e2 || 1; s2._texDirty = true; s2._holdBytesKey = null; s2._shiftCache = null;   // the cap must be measured from the SHIPPED bytes, else leader and joiner renormalize to different levels
        if (s2._attHold) s2._attHold = Float64Array.from(Float32Array.from(s2._attHold)); }
      // RING RECEIPT: the kernel the leader was STEPPING THROUGH at the capture step. A joiner that steps a vN field
      //   through a v(N+1) kernel forks on its FIRST step and then locks in (the pin contracts each peer to a
      //   different fixed point). The version alone is not enough — two peers can hold the same VERSION NUMBER with
      //   different offsets if the fractal clock re-rang between capture and apply — so hash the content.
      try { const _rh = _E.ringCache ? _hashNums([].concat(Array.from(_E.ringCache.r || []), Array.from(_E.ringCache.w || []), ...(_E.ringCache.o || []).map((t) => Array.from(t || [])))) : '—';
        console.log(`[SNAP-RING] kernelVer=${_E.kernelVer} · ringH=${_rh} · tiers=${_E.ringCache?.r?.length ?? 0} · offTot=${(_E.ringCache?.o || []).reduce((a, t) => a + ((t?.length || 0) >> 1), 0)}`); } catch (e) {}
      for (let qi = 0; qi < 4; qi++) { const qs = _sb.slots[qi]; _lastShipH[qi] = (qs?.desc && qs.descBase) ? _hashField(qs.descBase) : null; }
      // THE LEADER'S HALF OF THE PHASE RECEIPT — the same argPin the joiner prints at restore, measured on the
      //   EXACT bytes being shipped, at the ship step. If the joiner's [JOIN-PHASE] argPin differs from this at the
      //   same solStep, the rotation was introduced by the WIRE (the f32 b64 codec) or by capturing these bytes at
      //   a different sub-step than solSteps claims; if it matches, the payload is faithful and the divergence is
      //   downstream in the drive. Deliberately measured AFTER the f32 quantization loop above, so it reports what
      //   the joiner will actually receive rather than the leader's f64 working copy.
      try { for (let qi2 = 1; qi2 < 4; qi2++) { const qs2 = _sb.slots[qi2];
        if (!qs2?.desc || !qs2.descLive || !qs2.descBase) continue;
        const a4 = qs2.descAtt || qs2._attHold; if (!a4 || a4.length !== qs2.descBase.length) continue;
        let rr3 = 0, ii3 = 0, e4 = 0; const f4 = qs2.descBase;
        for (let j4 = 0; j4 < f4.length; j4 += 2) { e4 += f4[j4] * f4[j4] + f4[j4 + 1] * f4[j4 + 1];
          rr3 += a4[j4] * f4[j4] + a4[j4 + 1] * f4[j4 + 1]; ii3 += a4[j4] * f4[j4 + 1] - a4[j4 + 1] * f4[j4]; }
        console.log(`[SNAP-PHASE] ${SLOTN[qi2]} @solStep=${_E.solSteps} · argPin=${Math.atan2(ii3, rr3).toPrecision(17)} · |ψ|²=${e4.toPrecision(17)} · baseH=${_hashField(f4)} attH=${_hashField(a4)} — the joiner's [JOIN-PHASE] for this slot at this solStep MUST equal this; a difference means the rotation rode the wire`); } } catch (e) {}
      // the LEADER's ping-pong parity at the ship step — see the [JOIN-PARITY] note in _restoreSnap. The parity is
      //   per-GPU-CONTEXT state advanced by this peer's own op history; it is NOT in the snapshot and NOT in regH.
      try { console.log(`[SNAP-PARITY] ${_sb.slots.map((x, i) => `${SLOTN[i]}:${_gpu?.eyeSlotParity ? _gpu.eyeSlotParity(i) : '?'}`).join(' ')} @solStep=${_E.solSteps} — the joiner's [JOIN-PARITY] at this step tells you whether the two peers step the SAME half of each texture pair`); } catch (e) {}
      // SEND RECEIPT: the LEADER's view of what it is shipping, hashed the same way the joiner hashes what it takes.
      try { console.log(`[SNAP-SENT] solStep=${_E.solSteps} · psiLensed=${_E.psiLensed ? _hashField(_E.psiLensed) : 'NULL'} · descBase=[${_sb.slots.map((s2, i) => s2?.desc && s2.descBase ? `${SLOTN[i]}:${_hashField(s2.descBase)}` : `${SLOTN[i]}:—`).join(' ')}] · turbo=${_turboOn ? 1 : 0}`); } catch (e) {}
      const eng = _E.saveEngine({ stepClkC0: _stepClk.c0, torbE0: W.e0, transPx: W.leash.state.gx, transPy: W.leash.state.gy });
      return {
      eng: { ...eng, psiLensed: eng.psiLensed ? _b64f(eng.psiLensed) : null },   // WIRE: f32-base64 (the app owns this boundary, per G3; decoded before restoreEngine)
      stepClk: { rate: _stepClk.rate, ratePrev: _stepClk.ratePrev },
      bank: _bank.save(),                                             // the observer readOps (all 4 descriptors)
      slots: _sb.save(),                                             // per-slot leash/flags/kind (S1 codec)
      slotFields: _sb.slots.map((s) => s.field ? _b64f(s.field) : null),   // each slot's canonical ψ (the plate/live fields)
      slotAtt: _sb.slots.map((s) => s.att ? _b64f(s.att) : null),
      K: { edge: _K.edge ? _K.edge.map((r) => [...r]) : null, capPh: _K.capPh, capStep: _K.capStep, src: _K.src.map((s) => s ? _b64f(s) : null) },
      plates: _holo.save({ serialize: _b64f }).map((raw, i) => { const lp = _plates[i]; if (!lp) return raw;
        // ψATT plate: its `a` is a CAPTURED FIELD, so it CANNOT be regenerated from dop+obj at restore the way a probe
        //   att can (that regeneration is why `a` is normally omitted). Ship it, with the selfAtt marker, or the
        //   joiner's recall would fall back to the probe and re-inject the retired symbol.
        const _self = lp.selfAtt ? { selfAtt: 1, a: lp.a ? _b64f(lp.a) : null, aPhi: lp.aPhi || 0 } : null;   // aPhi = the angle `a` was BUILT with; an adopter needs it as its _holdPhi0 (see the [STORE-ψATT] note) and it cannot be re-derived from dop+obj the way a probe att can
        if (lp._dmg == null) return _self ? { ...raw, ..._self } : raw;   // undamaged plate → ship as-is (no pristine to carry)
        // a DAMAGED plate ships its PRISTINE (p0/w00) + the damage marker _dmg so a JOINER can re-damage/heal NON-
        // DESTRUCTIVELY from the SAME clean bytes as the leader (else the joiner's re-drag would occlude from the
        // already-damaged p → its future damage forks the field). The current damaged p ships as `raw.p` (unchanged).
        return { ...raw, ...(_self || {}), _dmg: lp._dmg, p0: lp.p0 ? _b64f(lp.p0) : null, w00: lp.w00 ? _b64f(lp.w00) : null }; }),   // pristine rides ONLY for damaged plates
      // THE PER-SLOT REGISTER OPERATORS (2026-07-31). _lensOp carries each slot's phase/prec/omega/beta/kx/ky — the
      //   U(1) register itself — and it was NEVER shipped: a joiner started from DEFAULTS and rebuilt every
      //   phase-derived quantity from there. The field bytes transfer exactly (SNAP-SENT/RECV agree on W and V), so
      //   the joiner ends up holding the right amplitude at the WRONG GLOBAL PHASE — measured: |ψ|² agreeing to 9
      //   figures while Σψ differed by 0.27 rad and argPin by 0.18 rad, i.e. the rotated ring seen on screen. A
      //   global phase is conserved by the dynamics (the pin chases a rotating target; the cap is amplitude-only),
      //   so the offset never decays — exactly the stable mismatch observed. regH matched throughout because the
      //   register HASH is over shared verb state, not over this local op array.
      lensOps: _lensOp.map((o) => ({ ...o })),
      descSlots: _sb.slots.map((s) => s.desc ? { pos: s.descPos ? [...s.descPos] : null, obj: s.descObj || null, bar: s.descBar | 0, base: s.descBase ? _b64f(s.descBase) : null, hold: s.descHold ? _b64f(s.descHold) : null, posCap: s.descPosCap ? [...s.descPosCap] : null, capBar: s.descCapBar ?? null, e0: s.descE0 ?? null, live: s.descLive ? 1 : 0, attg: s.descAttG ? { dop: { ...s.descAttG.dop }, obj: s.descAttG.obj || null } : null, phi0: s.descPhi0 || 0, leash: s.leash?.save ? s.leash.save() : null, selfHold: s._attHold ? _b64f(s._attHold) : null, selfHoldPos: s._attHoldPos ? [...s._attHoldPos] : null, selfPhi0: s._holdPhi0 || 0, selfDigest: s._digestLeft | 0, selfKeyN: s._holdKeyN | 0 } : null),   // + the ψATT hold/digest (the PIN TARGET — a joiner without it forks the field)   // 𝔸-slot state (desc mode + coords + ω-time cursor + the dressed base/birth angle) — a joiner must resume the identical precession AND reconstruction   // + the per-slot LEASH via its own codec (all 9 fields: go/tx/ty/gx/gy/ll/l0/lt/lk). Only W's leash rode the wire before (engine setTransP), so a joiner's A-slot sat at a DEFAULT position while the leader's had drifted: _descPose renders ox/oy = leash - descPos, so the joiner painted the same bytes at a different offset. Found because a RECALL fixed it instantly - recall re-seeds the leash.
      tauK: _tauK ? _tauK.save() : null,
      turboOn: _turboOn ? 1 : 0,   // (the pre-capture sync ran at the top of _takeSnap — descSlots above already hold the synced bytes)
      linearMode: _linearMode | 0,
      pinB: _pinBeta,   // THE GLOBAL PIN STRENGTH (2026-08-03): scales ψ += β·att every step for every slot, so it is physics and MUST ride the join — a joiner defaulting to _TRANSPORT_BETA while the leader sits at a slider-set value injects a differently-scaled complex vector per step → permanent global-phase fork (|ψ|² equal, argPin apart). Not in regH (that covers _lensOp[].beta, the per-slot refAmp).
      slotBirth: _sb.slots.map((s2) => (s2?._birth ? { ...s2._birth } : null)),   // WHICH recall path birthed each slot (+ its lift args). The two births are not interchangeable — see the recipe note in _recallFrom — and the join replay must re-run the one the leader actually used, or it derives a different reconstruction from the same plate.
      wLeash: W.leash?.save ? W.leash.save() : null,   // W's FULL leash via its own codec (2026-08-03). The engine slice carries only gx/gy (transPx/transPy) — the TARGET (tx/ty), the `go` flag and the lag terms never rode the wire at all, and in a ⌀PDE world even gx/gy were dropped because restoreEngine declines the slice. V/P1/P2 have shipped their full leash since 2026-07-31 (descSlots[].leash); this is the same codec for W, so an in-flight transport resumes identically instead of the joiner's W sitting still at the right position.
      shiftSeen: _siShift.saveCursor(), regSeen: _siReg.saveCursor(),   // the shift + register-verb cursors (+ pending stamped entries ride tauK.save via the 'shift'/'reg' queues — a mid-slide joiner applies them at their startSteps)
      slotKv: _sb.slots.map((s2) => (s2?.kv | 0)), slotBorn: _sb.slots.map((s2) => (s2?.born ? 1 : 0)),   // V's OWN step counter: kv drives its trajectory (see the vKv note at the recall drain), and it is NOT in the slot-bank codec (which carries descBase/descAtt/descE0 only) nor in descSlots. A joiner starting kv at 0 while the leader's has climbed runs a DIFFERENT number of steps for the same shared step — the exact "vKv=14 vs 21 at the same solStep" fork already recorded in this file.
      lastTgt: [_lastTgtX, _lastTgtY], driveMode: _driveMode, autoCompN: _autoCompN, tempoDiv: _tempoDiv, xatt: _xattOn, fieldMix: _fieldMix ? 1 : 0, virtT: _VIRT_T, occFrac: _occFrac, occMode: _occMode, livePlate: _recalledInto[3], recalledInto: [..._recalledInto], recallK: _sb.slots.map((s2) => (s2._pinK == null ? null : s2._pinK)), recallAt: _sb.slots.map((s2) => (s2.descPos ? [...s2.descPos] : null)), pinHold: _pinHold, lensObj: _lensObj, pinK: _sb.slots.map((s) => (s._pinK == null ? null : s._pinK)),   // lensObj = WHAT the pin holds (the probe geometry; every slot's att regenerates from it — a joiner must match or its pin target differs)   // pinHold + each slot's birth step: the pin fade must resume IDENTICALLY on a joiner (it scales the pin → in regH)   // fieldMix rides the snap (defaults ON → a joiner must adopt a leader that turned it OFF, else the edge-mixed field forks); virtT = the hologram depth (leg must match the leader's for recall); occFrac/occMode = the damage dial + method (so a JOINER's slider shows the real level); livePlate = which plate lives in P2 (the live-plate button state)
      // THE IFS KERNEL THE LEADER WAS STEPPING THROUGH AT THE SNAPSHOT STEP — version-matched to the shipped field. The
      // joiner MUST step through THIS ring, NOT the node's live ring: if the fractal clock advanced the ring version between
      // the leader's capture and the joiner's apply (a join landing at/after a kernel bump), the node's ring is a DIFFERENT
      // version than the field → the joiner steps a vN field through a v(N+1) kernel → intermittent post-restore fork.
      // DEEP-copy the offsets (array-of-arrays, per tier) to PLAIN nested number arrays so they survive the JSON wire
      // (a shallow Array.from keeps inner typed arrays that can serialize to length-less objects → 0 offset points → freeze).
      kernelVer: _E.kernelVer, ring: _E.ringCache ? { r: Array.from(_E.ringCache.r), w: Array.from(_E.ringCache.w), o: (_E.ringCache.o || []).map((tier) => Array.from(tier || [])) } : null,
    }; };
    const _restoreSnap = (s, n) => { if (!s) return;
      // ── ADOPT THE PROBE GEOMETRY FIRST (2026-08-03) — THE OBJECT-SWITCH JOIN HOLE ────────────────────────────
      //   _lensObj names the probe field every attractor is regenerated from (_plateAtt → _psiBaseOf(obj), memoised
      //   in _baseCache). It DID ride the snapshot, but it was adopted ~180 lines BELOW the descSlots loop — and
      //   that loop is what rebuilds each living slot's pin target:
      //       sl.descAtt = _plateAtt(sl.descAttG.dop, sl.descPos, sl.descAttG.obj)
      //   Running that first meant _baseCache was populated from the JOINER'S CURRENT object — the boot default
      //   'letterA' — and the descAtt built from it was never recomputed when _lensObj later became the leader's
      //   'ring'. _plateAtt also falls back to _lensObj whenever a slot's descAttG.obj is absent, so a legacy or
      //   partially-filled descAttG resolves against the wrong geometry outright.
      //   THE REPRODUCTION THIS EXPLAINS (user-reported): the page boots with the 'A' symbol, the LEADER switches
      //   the UI to 'ring', then a peer joins. The joiner shows a ring (the shipped descBase bytes ARE the ring)
      //   but its PIN TARGET was built from letterA — so it chases a different attractor than the leader from step
      //   one. The pin is a contraction, so the two peers settle toward different fixed points and never
      //   reconverge: same |ψ|² (the cap is amplitude-only), permanently different global phase. It matches the
      //   measured signature exactly, and it is INTERMITTENT in the way reported — it only bites when the object
      //   was switched away from the default before the join.
      //   Adopt the geometry BEFORE anything can regenerate an attractor, and drop the memoised bases so every
      //   later _psiBaseOf call in this restore builds from the leader's object.
      if (s.lensObj && _PROBE_OBJS.includes(s.lensObj) && _lensObj !== s.lensObj) {
        const _objPrev = _lensObj; _lensObj = s.lensObj; _baseCache.clear(); _rebuildBase();
        console.log(`[JOIN-OBJ] probe geometry '${_objPrev}' → '${_lensObj}' adopted BEFORE any attractor is rebuilt — every descAtt/_plateAtt in this restore now regenerates from the LEADER's object. (Adopting this after the descSlots loop, as before, left the joiner pinned to its boot-default geometry while painting the leader's bytes.)`); }
      const _engOk = _E.restoreEngine({ ...s.eng, psiLensed: _f64b(s.eng?.psiLensed) }, { setStepClkC0: (c0) => { _stepClk.c0 = c0; }, setTorbE0: (e0) => { W.e0 = e0; }, setTransP: (x, y) => { W.leash.state.gx = x; W.leash.state.gy = y; } });
      // ⌀PDE JOIN: an abstract-register leader ships NO ψ (psiLensed null) → restoreEngine declines the slice. The
      // REGISTER IS the state — restore the engine counters by hand so the joiner resumes the abstract drive at the
      // same shared k (the descSlots loop below restores desc mode + envelopes; nothing else is needed: no field).
      if (!_engOk && Array.isArray(s.descSlots) && s.descSlots.some((d) => d)) { _E.solInit = true; _E.snapConsumed = true;
        _E.solSteps = s.eng?.solSteps | 0; _E.kwSteps = (typeof s.eng?.kwSteps === 'number') ? (s.eng.kwSteps | 0) : (s.eng?.solSteps | 0);
        if (typeof s.eng?.stepClkC0 === 'number') _stepClk.c0 = s.eng.stepClkC0;
        W.e0 = (typeof s.eng?.torbE0 === 'number') ? s.eng.torbE0 : 1;
        // W's LEASH MUST BE RESTORED HERE TOO (2026-08-03) — the ⌀PDE join hole. On the NORMAL path restoreEngine
        //   applies the transport position via setTransP(x,y) → W.leash.state.gx/gy. This ABSTRACT fallback exists
        //   precisely because restoreEngine DECLINES the slice (psiLensed is null — the register IS the state), and
        //   it hand-restored solSteps/kwSteps/c0/torbE0 but NOT the leash. So in a ⌀PDE world W's transport position
        //   silently lands at DEFAULT on the joiner while the leader's has drifted.
        //   Why that shows up on V/P1/P2 and not on W: W's descPos is re-anchored to its own leash every bar, so W
        //   self-corrects and looks right — but W's leash feeds the pin target and the cross-slot coupling that the
        //   other slots chase, and nothing re-anchors those. The per-slot leash for V/P1/P2 was fixed on 2026-07-31
        //   by shipping descSlots[].leash; W's rode ONLY inside the engine slice, which an abstract world never uses.
        //   This is the same class as that fix, in the one path it was never applied to.
        if (typeof s.eng?.transPx === 'number') W.leash.state.gx = s.eng.transPx;
        if (typeof s.eng?.transPy === 'number') W.leash.state.gy = s.eng.transPy;
        console.log(`[JOIN-⌀PDE] abstract register restore (no ψ) @solStep=${_E.solSteps} · W leash=[${W.leash.state.gx.toPrecision(17)},${W.leash.state.gy.toPrecision(17)}] (from the wire: ${typeof s.eng?.transPx === 'number' ? 'YES' : '⚠ MISSING — legacy snapshot, W transport falls back to this peer\'s default and the slots that chase W will differ'}) · c0=${_stepClk.c0.toFixed(4)} torbE0=${W.e0.toExponential(3)}`); }
      // W's FULL leash (see the takeSnap note) — applied AFTER both engine paths so it supersedes the gx/gy-only
      //   restore with the complete 9-field state (target, go flag, lag terms). Legacy snapshots have no wLeash and
      //   keep the gx/gy behaviour above. This is what makes an IN-FLIGHT W transport resume on a joiner.
      if (s.wLeash && W.leash?.restore) { W.leash.restore(s.wLeash);
        console.log(`[JOIN-WLEASH] W leash restored in full · pos=[${W.leash.state.gx.toPrecision(17)},${W.leash.state.gy.toPrecision(17)}] tgt=[${W.leash.state.tx},${W.leash.state.ty}] go=${W.leash.state.go ? 1 : 0} — the engine slice ships only gx/gy, so without this a joiner's W stops at the right place but forgets where it was HEADED, and every slot whose pin chases W's pose follows a different target`); }
      if (s.stepClk) { _stepClk.rate = s.stepClk.rate ?? 1; _stepClk.ratePrev = s.stepClk.ratePrev ?? 1; }
      _bank.restore(s.bank); _sb.restore(s.slots);
      // RESTORE RECEIPT: print the hash of every field the joiner actually took, so it can be compared against the
      //   LEADER's own [SNAP-SENT] line. If sent==restored but fieldH still differs later, the divergence is AFTER
      //   the restore (something re-seeds or re-quantizes); if they already differ here, the payload is the problem.
      try { console.log(`[SNAP-RECV] solStep=${s.eng?.solSteps | 0} · psiLensed=${s.eng?.psiLensed ? _hashField(_f64b(s.eng.psiLensed)) : 'NULL'} · descBase=[${(s.descSlots || []).map((d, i) => d?.base ? `${SLOTN[i]}:${_hashField(_f64b(d.base))}` : `${SLOTN[i]}:—`).join(' ')}] · slotFields=[${(s.slotFields || []).map((f, i) => f ? `${SLOTN[i]}:${_hashField(_f64b(f))}` : `${SLOTN[i]}:—`).join(' ')}]`); } catch (e) {}
      for (let i = 0; i < _sb.slots.length; i++) { _sb.slots[i].field = s.slotFields?.[i] ? _f64b(s.slotFields[i]) : _sb.slots[i].field;
        _sb.slots[i].att = s.slotAtt?.[i] ? _f64b(s.slotAtt[i]) : _sb.slots[i].att; }
      W.field = _E.psiLensed;   // the engine slice restored psiLensed = W's field (they are the same store)
      _K.edge = s.K?.edge ? s.K.edge.map((r) => [...r]) : null; _K.capPh = s.K?.capPh ?? -1; _K.capStep = s.K?.capStep ?? -1;
      for (let i = 0; i < 4; i++) _K.src[i] = s.K?.src?.[i] ? _f64b(s.K.src[i]) : null;
      _holo.restore(s.plates, { deserialize: _f64b });   // the bank rebuilds the plate SHAPE; the app decodes the f32-base64 wire
      (s.plates || []).forEach((raw, i) => { const pl = _plates[i]; if (pl) { pl.a = raw.a ? _f64b(raw.a) : _plateAtt(pl.dop, pl.pos, pl.obj); pl.selfAtt = !!raw.selfAtt; if (typeof raw.aPhi === 'number') pl.aPhi = raw.aPhi; if (raw._dmg != null) pl._dmg = raw._dmg;   // aPhi rides with `a`: the adopter's _holdPhi0 must be the angle the bytes were built with, not its own op angle   // selfAtt: this plate's `a` is a captured FIELD (shipped), so recall re-enters ψATT instead of the probe pin
        if (raw.p0) pl.p0 = _f64b(raw.p0); if (raw.w00) pl.w00 = _f64b(raw.w00); } });   // regenerate the live-only att + carry the damage marker + restore the PRISTINE (p0/w00) so the joiner re-damages/heals from the SAME clean bytes as the leader (byte-identical future damage)
      for (let i = 0; i < _sb.slots.length; i++) { const d = s.descSlots?.[i], sl = _sb.slots[i];   // 𝔸-slot restore: desc mode + coords + ω-time cursor + the dressed base (its 6 floats ride the bank)
        sl.desc = !!d; sl.descPos = d?.pos ? [...d.pos] : null; sl.descObj = d?.obj || null; sl.descBar = d?.bar | 0;
        sl.descBase = d?.base ? _f64b(d.base) : null; sl.descPhi0 = d?.phi0 || 0;
        // THE PER-SLOT LEASH (2026-07-31). Only W's leash rode the wire (via the engine slice's setTransP); V/P1/P2
        //   leashes were never shipped, so a joiner's 𝔸-slot started at a DEFAULT position while the leader's had
        //   drifted. _descPose renders ox/oy = leash − descPos, so the joiner painted the same bytes at a different
        //   offset/phase — permanent, because nothing re-syncs it. Diagnostic that found it: a RECALL made the peers
        //   match instantly, and recall re-seeds the leash (V.leash.state.gx = V.descPos[0]) — so the leash was the
        //   state the join was missing and the recall was repairing.
        if (d?.leash && sl.leash?.restore) sl.leash.restore(d.leash);
        sl.descHold = d?.hold ? _f64b(d.hold) : (d?.base ? _f64b(d.base) : null);   // the living-declaration ANCHOR (legacy snapshots: anchor = base)
        sl._attHold = d?.selfHold ? _f64b(d.selfHold) : null; sl._holdKeyN = (d?.selfKeyN | 0); sl._holdBytesKey = null; sl._attCache = null; sl._shiftCache = null; sl._attHoldPos = d?.selfHoldPos ? [...d.selfHoldPos] : null; sl._holdPhi0 = d?.selfPhi0 || 0; sl._digestLeft = d?.selfDigest | 0; sl._holdSl2 = sl._attHold ? _mkSl2(sl._attHold) : null; sl._holdRef = null; sl._holdRefBar = sl._attHold ? ((_E?.frameBar | 0) + _HOLD_MIN) : -1; sl._holdRefPrev = null; sl._holdRefN = 0; sl._holdRefStuck = false;   // ψATT join: the field-borne PIN TARGET must resume identically — bytes + POSE + birth phase + digest, or the joiner's pin differs and the field forks. selfKeyN adopts the leader's counter; the shift cache is keyed on the hold BYTES (shared), never on a peer-local counter. sl2 is RECOMPUTED (pure fn of bytes + stencil, no wire cost); the settle reference is peer-local telemetry and re-settles locally.
        sl.descPosCap = d?.posCap ? [...d.posCap] : (d?.pos ? [...d.pos] : null); sl.descCapBar = d?.capBar ?? null;
        sl.descE0 = d?.e0 ?? (sl.descBase ? (() => { let e = 0; for (let j = 0; j < sl.descBase.length; j++) e += sl.descBase[j] * sl.descBase[j]; return e || 1; })() : null);   // the register engine's cap level (legacy: recompute from the shipped base — same f32 bytes ⇒ same sum)
        sl.descDisp = sl.descBase ? Float64Array.from(sl.descBase) : null;   // display buffer seeded from the shipped state (bar-grid film from frame one)
        sl.descLive = !!d?.live; sl.descAttG = d?.attg ? { dop: { ...d.attg.dop }, obj: d.attg.obj || null } : null;
        // ψATT SLOTS PIN TO THEIR HOLD, NOT TO A REGENERATED PLATE (2026-08-02). This rebuilt descAtt from
        //   _plateAtt(dop,pos,obj) for every live slot — but a slot that has ADOPTED (ψATT) is pinned to its
        //   field-borne hold, and _selfHold() is what the leader actually chases. Regenerating a probe attractor here
        //   gave the joiner a DIFFERENT pin target from the leader while _attHold itself shipped correctly, so both
        //   peers contracted toward different fixed points with every other column identical. The hold is restored
        //   just above; leave descAtt null for such a slot and let the bar loop rebuild it with _selfHold(), exactly
        //   as the leader does. Non-adopted live slots keep the plate regeneration, which is right for them.
        sl.descAtt = (sl.descLive && !sl._attHold && sl.descAttG && sl.descPos) ? _plateAtt(sl.descAttG.dop, sl.descPos, sl.descAttG.obj) : null; }   // a living slot's pin target REGENERATED (pure register fn — identical bytes; the att itself never rides the wire)
      if (_tauK && s.tauK) { _tauK.restore(s.tauK); _siShift.reattach(); _siReg.reattach(); }   // restore replaces the queue RECORDS → re-attach BOTH handles (they closed over the old records); pending mid-slide shifts + register verbs now drain at their stamped startSteps
      if (Array.isArray(s.lensOps)) for (let li4 = 0; li4 < Math.min(4, s.lensOps.length); li4++) { const src = s.lensOps[li4]; if (src) Object.assign(_lensOp[li4], src); }   // THE REGISTER OPS — see the takeSnap note: without these the joiner runs the right field at the wrong global phase
      // (the ψATT descAtt seed lives in _recallPlateLive itself now — the birth function sets a ψATT slot's pin to its
      //  HOLD, not a probe, so both a live recall and the JOIN-REPLAY below are self-consistent; see the note there.)
      _turboOn = !!s.turboOn; _turboArmed = false;
      // ANCHOR THE TURBO CURSOR TO THE RESTORED SHARED STEP (2026-08-01). _tbCur is the texture's step cursor, and it
      //   was lazily initialised as `if (_tbCur < 0) _tbCur = k` on the FIRST advance — where k = _base + i is the
      //   PEER'S OWN cursor at that instant. A joiner therefore anchored wherever it happened to be when turbo first
      //   ran, and then advanced in lockstep forever: MEASURED with mu1.tbTrace, both peers stepping 7/block with a
      //   CONSTANT 112-step offset that never converges. Every receipt matched (bytes, ring, register, cap) because
      //   they were all correct — they just described moments 112 steps apart, which near a contracting fixed point
      //   looks exactly like a small frozen phase/amplitude difference. The restored solSteps IS the shared step the
      //   snapshot bytes belong to, so anchor there instead of at a peer-local k.
      _tbCur = (_E.solSteps | 0) || -1;
      console.log(`[JOIN-TBCUR] turbo cursor anchored at the restored shared step ${_tbCur} (was: lazily set to this peer's own k on the first advance — the source of a constant step offset between peers)`
        + ` · Q-grid: ${_tbCur % Q === 0 ? 'ALIGNED (offset 0)' : `OFF by ${_tbCur % Q}/${Q}`} — compare with the LEADER's [SNAP-ALIGN]. Both peers off the grid by the SAME amount is fine (they stay in phase); a MISMATCH means their Q blocks are permanently offset, which shifts when the refreshed pin target enters the step loop → the |ψ|²-equal / argPin-apart rotation`);
      // JOIN MUST INVALIDATE THE GPU TEXTURES (2026-07-31 — the same omission as the turbo verb, in the other place
      //   it matters). The restore has just replaced every descBase with the LEADER'S bytes, but _tbAdvanceAll only
      //   primes when `_tbTexStep[i] < 0 || _texDirty`. A joiner whose textures still carry _tbTexStep >= 0 from
      //   before the join SKIPS the prime and steps from its own stale texture instead of the restored state — so it
      //   starts mismatched and never converges. Symptom that located it: toggling CPU→GPU made the peers match
      //   (that path forces a re-prime) while a fresh browser join started mismatched from the first frame.
      for (let ti3 = 0; ti3 < 4; ti3++) { _tbTexStep[ti3] = -1; const st3 = _sb.slots[ti3]; if (st3) st3._texDirty = true; }
      // PRIME THE FIELD-MODE W TEXTURE (2026-07-31). _tbPrime is the ONLY path that uploads CPU bytes to a slot's GPU
      //   texture, and _tbAdvanceAll calls it only for slots passing _tbLive(i) — which requires `sl.desc`. A W in
      //   FIELD mode has desc=false, so it is never primed: on a turbo join the register and W.field restore fine on
      //   the CPU while the GPU keeps the joiner's PRE-JOIN eye texture, and turbo then steps THAT. The CPU executor
      //   is unaffected because it steps W.field directly — which is exactly the reported symptom (CPU restore
      //   correct, turbo restore wrong, for W as well as V). Upload the restored bytes into the default eye buffer
      //   so the first turbo advance starts from the leader's state.
      // PRIME EVERY RESTORED SLOT DIRECTLY (2026-07-31). Marking _texDirty/_tbTexStep=-1 and trusting _tbAdvanceAll
      //   to notice does NOT work on a joiner: measured with mu1.primeTrace, the leader logs [PRIME] but the joiner
      //   logs NOTHING — the advance loop's `_tbLive(i)` gate is not satisfied at the moment it first runs, so the
      //   prime is skipped and never revisited, and turbo steps the browser's PRE-JOIN texture while descBase holds
      //   the leader's bytes. The CPU executor is immune (it steps descBase directly) — exactly the reported
      //   asymmetry. So upload here, unconditionally, right after the bytes land.
      if (_turboOn && _gpu) { for (let pi = 0; pi < 4; pi++) { const ps = _sb.slots[pi];
        if (!ps?.desc || !ps.descBase || !ps.descE0) continue;
        if (pi > 0 && !ps.descLive) continue;
        // WRITE BOTH HALVES OF THE PING-PONG (2026-08-03) — THE PARITY FORK, measured.
        //   Each slot's eye is a texture PAIR with a `src` marker naming the half that currently holds the field.
        //   That marker is per-GPU-CONTEXT state, advanced by however many ops THIS peer has run on the slot since
        //   boot — it is not replicated and does not ride the snapshot. Measured at solStep=6153: the leader logged
        //   [SNAP-PARITY] W:B V:A while the joiner logged [JOIN-PARITY] W:A V:A — OPPOSITE parity on W. (An earlier
        //   run had them agree, which is exactly why the symptom is INTERMITTENT.)
        //   setEyePsi writes ONLY the half `src` names, so the OTHER half keeps this peer's stale PRE-JOIN content.
        //   Any op that reads the pair at the other parity — or any later flip — then propagates bytes the leader
        //   never had, while every CPU-side hash (regH, attH, e0, descBase) still matches because each peer is
        //   internally consistent. W's parity is the one that matters most even when V's agrees: V's pin target and
        //   the cross-slot coupling are built from W's state.
        //   setEyePsiBoth writes the field into BOTH halves, which makes the restored state parity-INDEPENDENT: it
        //   no longer matters which half either peer happens to be on. Cost is one extra texture upload per slot,
        //   once, at join.
        try { _gpu.selectEyeSlot(pi); (_gpu.setEyePsiBoth || _gpu.setEyePsi).call(_gpu, ps.descBase); _gpu.commitEyeSlot(pi); _gpu.markEyeSlotPrimed(pi);
          ps._texDirty = false; _tbTexStep[pi] = (_E.solSteps | 0);   // the texture now HOLDS the restored bytes, which belong to the restored shared step — say so, so the first _tbAdvanceAll does NOT re-prime (a re-prime would reset parity mid-flight) and advances from the correct cursor
          // AND SAY THE READBACK IS CURRENT (2026-08-03). _tbSyncSlot early-outs on
          //   `_texStepSynced === _tbTexStep[i]`, and this block leaves _texStepSynced at the joiner's PRE-JOIN
          //   value. Two ways that bites, both observed as "every shared column matches, the texture differs":
          //    • stale != solSteps → the first sync READS BACK the texture over the freshly restored descBase.
          //      Harmless only if the texture is already exact; at join it is the leader's bytes re-quantized
          //      through the f32 upload, so the readback silently REPLACES the wire bytes with a round-tripped
          //      copy — and descE0 (the cap level) still refers to the pre-round-trip bytes.
          //    • stale == solSteps by coincidence → the first real sync is SKIPPED and descBase stays behind
          //      the texture for a whole Q-block.
          //   The texture and descBase are equal RIGHT NOW by construction, so stamp both cursors together.
          ps._texStepSynced = (_E.solSteps | 0);
          // seed the engine-energy meter FROM the restored bytes rather than nulling it: _engE feeds ⟲coevo's
          //   gain gate (leashGainEnergy) when unpinned, and a null there falls back to descE0 — a DIFFERENT value
          //   than the leader's live meter, i.e. a peer-local input to W's leash advance, which every other slot's
          //   pin chases. Computing it here makes it a pure fn of the restored (shared) bytes.
          { let _eJ = 0; for (let _j = 0; _j < ps.descBase.length; _j++) _eJ += ps.descBase[_j] * ps.descBase[_j]; ps._engE = _eJ; }
          console.log(`[JOIN-PRIME] ${SLOTN[pi]} descBase uploaded to its GPU texture · H=${_hashField(ps.descBase)} · texStep=texSynced=${_E.solSteps | 0} — without this the joiner's turbo steps its PRE-JOIN texture (CPU mode was unaffected: it steps descBase directly)`); } catch (e) { console.warn('[JOIN-PRIME] failed', SLOTN[pi], e); } }
        _gpu.selectEyeSlot(null); }
      if (_turboOn && _gpu && !W.desc && W.field) { try { _gpu.selectEyeSlot(null); (_gpu.setEyePsiBoth || _gpu.setEyePsi).call(_gpu, W.field); _gpu.selectEyeSlot(null);   // BOTH halves — same parity fork as the slot prime above (the default eye buffer has its own src marker)
        console.log(`[JOIN-PRIME] field-mode W uploaded to the GPU eye buffer · fieldH=${_hashField(W.field)} — without this, turbo steps the joiner's pre-join texture (CPU mode was unaffected because it steps W.field directly)`); } catch (e) { console.warn('[JOIN-PRIME] failed', e); } }
      _filmStep = [-1, -1, -1, -1]; if (_gpu?.dropFilm) for (let fi3 = 0; fi3 < 4; fi3++) _gpu.dropFilm(fi3);   // films are captures of the PRE-JOIN state — retire them with the textures
      _linearMode = Math.max(0, Math.min(2, s.linearMode | 0));   // adopt the world's linear mode
      if (typeof s.pinB === 'number') { const _pbPrev = _pinBeta; _pinBeta = Math.max(0, Math.min(1, s.pinB));   // the leader's GLOBAL pin strength — see the takeSnap note: an unadopted β is a permanent global-phase fork
        if (_pbPrev !== _pinBeta) console.log(`[JOIN-PIN] β ${_pbPrev.toFixed(2)} → ${_pinBeta.toFixed(2)} adopted from the leader — this scales ψ+=β·att at EVERY step, so a joiner keeping its own β injects a differently-scaled complex vector per step: |ψ|² stays equal (the cap is a real scale) while the GLOBAL PHASE drifts permanently apart`); }
      _siShift.restoreCursor(s.shiftSeen | 0); _siReg.restoreCursor(s.regSeen | 0);
      if (Array.isArray(s.slotKv)) for (let ki = 0; ki < _sb.slots.length && ki < s.slotKv.length; ki++) { const sk = _sb.slots[ki]; if (sk) sk.kv = s.slotKv[ki] | 0; }
      if (Array.isArray(s.slotBorn)) for (let ki = 0; ki < _sb.slots.length && ki < s.slotBorn.length; ki++) { const sk = _sb.slots[ki]; if (sk) sk.born = !!s.slotBorn[ki]; }
      if (Array.isArray(s.slotBirth)) for (let ki = 0; ki < _sb.slots.length && ki < s.slotBirth.length; ki++) { const sk = _sb.slots[ki]; if (sk) sk._birth = s.slotBirth[ki] ? { ...s.slotBirth[ki] } : null; }   // the birth recipe rides the wire so a SECOND join still reproduces the original recall path
      _lastTgtX = s.lastTgt?.[0] ?? NaN; _lastTgtY = s.lastTgt?.[1] ?? NaN; if (typeof s.driveMode === 'string') _driveMode = s.driveMode;
      _autoCompN = s.autoCompN | 0; _tempoDiv = Math.max(1, s.tempoDiv | 0); _autoClose = false; _xattOn = !!s.xatt; _fieldMix = (s.fieldMix == null) ? true : !!s.fieldMix; _VIRT_T = (s.virtT | 0) || 16;
      if (typeof s.occFrac === 'number') _occFrac = s.occFrac; if (s.occMode) _occMode = s.occMode | 0;   // the damage dial + method (joiner's slider shows the leader's real damage level)
      _pinHold = (s.pinHold | 0) || 0;   // the ⌛pin-fade dial (replicated: it scales the pin, which is in regH)
      // (_lensObj is now adopted EARLY — see the note at the top of _restoreSnap. Kept here as a no-op guard for the
      //  case where the early adopt did not fire; re-running it is harmless because it only re-derives from bytes.)
      if (s.lensObj && _PROBE_OBJS.includes(s.lensObj) && _lensObj !== s.lensObj) { _lensObj = s.lensObj; _baseCache.clear(); _rebuildBase();
        console.warn(`[JOIN-OBJ] ⚠ late lensObj adopt → '${_lensObj}' (the early adopt did not fire; any att regenerated before this point used the WRONG probe geometry)`); }
      if (Array.isArray(s.pinK)) for (let i = 0; i < _sb.slots.length; i++) { const v = s.pinK[i]; if (v != null) _sb.slots[i]._pinK = v | 0; }   // each slot's birth step → the fade resumes at the identical phase on the joiner
      if (Array.isArray(s.recalledInto)) for (let i = 0; i < 4; i++) _recalledInto[i] = (s.recalledInto[i] ?? -1) | 0;
      else if (typeof s.livePlate === 'number' && s.livePlate >= 0) _recalledInto[3] = s.livePlate | 0;   // legacy snapshots carried only P2's   // adopt the world's mode + replicated dials (fieldMix defaults ON for pre-toggle snapshots; virtT defaults 16)
      // ── REPLAY THE RECALL INSTEAD OF COPYING ITS RESULT (2026-07-31) ────────────────────────────────────────────
      //   THE CLASS OF BUG THIS ENDS: a recall is a REPLICATED VERB — every peer runs _recallPlateLive/_recallFrom
      //   from the same bank and derives the same state, which is why "do a recall" always re-synced the peers. A
      //   JOIN is not: it ships V's state as DATA, so anything the recall DERIVES rather than STORES is missing
      //   unless the snapshot enumerates it. We found those one at a time — lensOps, then the per-slot leash — and
      //   that method never terminates: the next unlisted derived field is always waiting.
      //   THE FIX: the joiner re-runs the SAME function with the SAME plate. _recallPlateLive(idx, ti, k) rebuilds
      //   descBase / descPhi0 / descPos / descE0 / descAttG / descAtt / the ψATT hold / the leash from the plate
      //   alone, and every input is already replicated (the bank ships; _recalledInto ships; k is shared). So the
      //   joiner DERIVES what the leader derived, including fields nobody has enumerated. This is the same law the
      //   rest of the arc runs on — a stamped verb replayed from shared state, not a serialized copy of results.
      //   Only for slots that are LIVING recalls (idx >= 0 and the plate exists); everything else keeps the
      //   byte-restore above. The aging anchor (_pinK) and placement (descPos) ride the wire so the replayed slot
      //   resumes at the leader's birth step and position rather than the plate's default.
      // ── ADOPT THE KERNEL BEFORE THE REPLAY (2026-08-03) — MEASURED: the replay was SILENTLY DOING NOTHING ──────
      //   The lift is a PROPAGATION: _recallPlateLive → _holo.lift → specLeg → lambda(), and lambda() reads
      //   ctx.ringCache() / ctx.kernelVer(). Those were adopted ~65 lines BELOW this loop, so at replay time the
      //   joiner still had its pre-join ring — or none at all. lambda() returns null without a ring, so specLeg
      //   returns null, so _holo.lift returns null, and _recallPlateLive hits its own guard
      //       const lift = _holo.lift(pl, {scale:'all'}); if (!lift) return;
      //   and RETURNS BEFORE WRITING ANYTHING. No derived descPos/leash, no descAttG, no descAtt, no ψATT hold —
      //   the slot kept only the raw byte-restore while [JOIN-A] cheerfully reported those leftovers as "derived".
      //   MEASURED: the joiner logged `[JOIN-LIFT] liftVer=-1` — kernelVer at its sentinel, i.e. no kernel present.
      //   That is why shape A changed nothing, and why the reconstruction renders at a different SCALE: the joiner
      //   never re-derived the reconstruction at all. Same ordering class as the _lensObj hole — state adopted
      //   after the code that consumes it.
      //   Adopt ringCache/kernelVer here (the GPU setRings stays below — that is a GPU-side concern, and the λ-grid
      //   is pure CPU). Idempotent: the block below re-assigns the identical values.
      { const _preOffTot = (s.ring?.o) ? s.ring.o.reduce((a, t) => a + ((t?.length || 0) >> 1), 0) : 0;
        const _preJr = (s.ring && s.ring.r && s.ring.r.length && _preOffTot > 0) ? s.ring : (n.cachedRadii?.length ? { r: n.cachedRadii, w: n.cachedWeights, o: n.cachedOffsets } : null);
        if (_preJr) { _E.ringCache = { r: _preJr.r, w: _preJr.w, o: _preJr.o };
          _E.kernelVer = (_preJr === s.ring && typeof s.kernelVer === 'number') ? s.kernelVer : (n.cachedRadiiVersion | 0);
          console.log(`[JOIN-KERNEL] ring+kernelVer=${_E.kernelVer} adopted BEFORE the recall replay (src=${_preJr === s.ring ? 'SNAPSHOT' : 'NODE'}) — the lift propagates through this λ-grid; without it lambda() returns null, _holo.lift returns null, and _recallPlateLive returns WITHOUT WRITING ANYTHING (the silent no-op that made shape A ineffective)`); }
        else console.warn(`[JOIN-KERNEL] ⚠ no ring available before the replay (snapshot ring empty AND node ring empty) — the lift will return null and every living slot will keep only its byte-restore`); }
      try {
        for (let ri = 0; ri < 4; ri++) { const idx = _recalledInto[ri];
          if (idx < 0 || !_plates[idx]?.p) continue;
          const sl2 = _sb.slots[ri]; if (!sl2 || !sl2.desc || !sl2.descLive) continue;   // only living 𝔸-recalls; a field-mode or parked slot keeps its restored bytes
          const rk = (Array.isArray(s.recallK) && s.recallK[ri] != null) ? (s.recallK[ri] | 0) : (_E.solSteps | 0);
          const rat = (Array.isArray(s.recallAt) && s.recallAt[ri]) ? s.recallAt[ri] : null;
          // PRESERVE THE EVOLVED BYTES, RE-DERIVE THE REST. The field itself transfers correctly (SNAP-SENT ==
          //   SNAP-RECV on every receipt) and it has LIVED since the recall — pinned, stepped, ω-aged for
          //   solSteps−recallK steps. Replaying the recall wholesale rebuilds V as it was AT BIRTH and clobbers that
          //   evolution with a stale reconstruction. What the join actually loses is the DERIVED register/pose state
          //   around the bytes (descAttG, descAtt, descPhi0, descE0, the ψATT hold, the leash) — the fields nobody
          //   enumerated. So: run the same code the leader ran to re-derive those, then put the restored bytes back.
          // ── THE REPLAY MUST RESTORE EVERY *AGED* FIELD, NOT JUST THE BYTES (2026-08-02) ──────────────────────
          //   THE BUG THIS FIXES: "W syncs on join, V/P1/P2 do not — but a fresh recall re-syncs them instantly."
          //   _recallPlateLive is a BIRTH function: it writes the slot as it was AT RECALL TIME. This block only put
          //   FIVE things back (descBase/descE0/descDisp/leash/descPos), so every OTHER field it touches stayed at
          //   BIRTH on the joiner while the leader's had aged for solSteps−recallK steps. W was immune only because
          //   W is never in _recalledInto, so it never enters this loop at all — exactly the reported asymmetry.
          //   The clobbered aged state, and why each one forks the field:
          //    • descBar — the AGING CURSOR. Reset to floor(rk/21) = the BIRTH bar. The very next bar boundary runs
          //      `nbD = barA − descBar` (the bar loop) and catches up HUNDREDS of bars in one frame: _lensOp.phase
          //      jumps by nbD·ω and the leash advances nbD times. This is the dominant term — it alone re-poses and
          //      re-phases the slot on the joiner's first bar, which is why the divergence appears immediately and
          //      never heals. (descPosCap/descCapBar are the same cursor's capture stamp.)
          //    • _lensOp[ri].phase/prec/omega — the U(1) REGISTER OP, reset to ∠pl.dop/0/pl.dop.omega. The leader's
          //      phase has been ticking +ω every bar since birth. It is BOTH the render's dphi (∠now − descPhi0) and
          //      the rotation applied to the ψATT pin target via _holdOp — so a wrong op is a wrong PIN, and the pin
          //      is a contraction: the two peers then converge to DIFFERENT fixed points and freeze there. Note this
          //      also undid the `lensOps` restore done above, which is the very state that restore exists to carry.
          //    • descPhi0 — the aging REFERENCE (∠now − descPhi0). _recallPlateLive sets ∠pl.dop, but a slot born via
          //      _recallFrom carries descPhi0 = 0, and a materialized slot carries the op angle at capture. Forcing
          //      the plate's value gives the joiner a different zero for the same rotation.
          //    • _attHold/_holdPhi0/_holdKeyN/_holdSl2 — the ψATT hold is re-derived from pl.a, discarding the AGED
          //      hold that descSlots.selfHold shipped correctly. Same class as the descAtt fix above: the leader
          //      chases its evolved hold, the joiner chases a birth copy.
          //    • descHold — nulled; it is the living-declaration ANCHOR the restore had just decoded.
          //   So: snapshot the restored (aged) state, run the replay purely to re-derive what the wire does NOT
          //   carry (descAttG and the descObj/born/desc flags), then put ALL of the aged state back.
          // ── SHAPE A: DERIVE EVERYTHING, ADOPT ONLY THE BYTES AND THE ω-TIME CURSOR (2026-08-03) ──────────────
          //   THE LAW (user's framing, and the arc's own): the PLATE is the transferable object; the ⌀PDE register
          //   moves it in HOLOGRAPHY TIME. A joiner does not need the leader's history — it needs the same plate and
          //   the same ω-time cursor, and it re-derives the rest by running the SAME code the leader ran.
          //   WHAT WAS WRONG BEFORE: this block already replayed _recallPlateLive (good) and then restored TWELVE
          //   fields on top of it (bad) — leash, descPos, descBar, descPosCap/descCapBar, descPhi0, descHold, the
          //   whole ψATT hold group, and the entire _lensOp. Each was added to fix one symptom, and each put
          //   LEADER-COPIED state where DERIVED state belongs, so the two peers' V's were assembled by different
          //   rules. That is the "the next unlisted derived field is always waiting" trap the replay exists to end,
          //   re-entered from the other side. It is also exactly why a fresh RECALL fixes the slot permanently
          //   (recall derives all of it from the plate on EVERY peer) while a JOIN does not.
          //   WHAT WE ADOPT, and why only these two:
          //    • descBase/descE0/descDisp — THE BYTES. The field has lived (solSteps−rk) steps since birth and a
          //      birth-time lift cannot reproduce that. This is state, not a derived quantity.
          //    • _lensOp[ri].phase (+prec) — THE ω-TIME CURSOR: where in its oscillation V currently is. Not
          //      derivable from the plate (it advances +ω per bar since birth), and it is what "sync the timing to
          //      the living field" means. descBar is set to the CURRENT bar so the bar loop does not then replay
          //      hundreds of catch-up ω ticks on top of the cursor we just adopted.
          //   EVERYTHING ELSE STAYS DERIVED: descPos/leash (re-seeded from the plate, as recall does), descPhi0
          //   (the plate's birth angle — the reference the cursor is measured against), descAttG/descAtt and the
          //   ψATT hold (rebuilt from the plate, including selfAtt inheritance), descHold, descPosCap/descCapBar.
          //   ω is carried by _lensOp too and IS derived (pl.dop.omega), so it is not re-adopted.
          const _bIn = sl2.descBase ? _hashField(sl2.descBase) : '—';   // what the restore left in the slot, BEFORE the replay touches it
          const _keepBase = sl2.descBase, _keepE0 = sl2.descE0, _keepDisp = sl2.descDisp;
          const _keepPhase = _lensOp[ri]?.phase, _keepPrec = _lensOp[ri]?.prec;   // the ω-time cursor ONLY (not the whole op)
          // ── ADOPT THE CURSOR *BEFORE* THE BIRTH, NOT AFTER (2026-08-03) ────────────────────────────────────────
          //   _recallPlateLive DERIVES state from _lensOp[ri] as it stands when it runs — in particular
          //       V1._holdPhi0 = lensU1.angle(_lensOp[ti])
          //   which is the ψATT hold's ROTATION REFERENCE: _holdOp rotates the pin target by (∠now − _holdPhi0)
          //   every bar, so it is physics, and it feeds regH through the pin.
          //   Adopting the leader's cursor AFTER the birth left _holdPhi0 anchored to the BIRTH phase while the op
          //   jumped straight to the AGED phase — so the joiner's pin target was rotated by a different amount than
          //   the leader's, whose _holdPhi0 and op aged together from the same instant. Two peers then chase
          //   differently-rotated attractors: a small, permanent, visible difference that a fresh recall clears
          //   (both peers re-anchor together) — exactly the reported behaviour.
          //   Setting the cursor first makes every phase-derived quantity inside the birth consistent with it.
          if (typeof _keepPhase === 'number') _lensOp[ri].phase = _keepPhase;
          if (typeof _keepPrec === 'number') _lensOp[ri].prec = _keepPrec;
          { const _bRec = (Array.isArray(s.slotBirth) ? s.slotBirth[ri] : null) || sl2._birth || null;
            _recallPlateLive(idx, ri, rk, rat, { ...(_bRec || { via: 'plateLive', scale: 'all', shift: null, atPos: null }), replay: true }); }   // reproduce the ORIGINAL birth recipe (which recall path, which lift args, which phase convention) — see the note in _recallFrom; replay:true keeps the aged cursor installed above
          if (_keepBase) { sl2.descBase = _keepBase; sl2._texDirty = true;   // the evolved field wins over the birth lift
            if (_keepE0 != null) sl2.descE0 = _keepE0;                        // and its cap level, measured from those bytes
            sl2.descDisp = _keepDisp || Float64Array.from(_keepBase);
            sl2._holdBytesKey = null; sl2._shiftCache = null; sl2._attCache = null; }   // caches keyed on the hold/bytes must not survive the swap
          // THE TIMING SYNC — adopt the ω-time cursor from the leader.
          //   descBar is NOT stamped to "now" any more: it is now STORE-ANCHORED (floor(pl.k/21), set by the birth
          //   fn from the plate's own step), which is identical on every peer by construction. Overwriting it here
          //   would re-introduce exactly the recall-anchored quantity the store-anchoring removes — and the bar loop
          //   catch-up it was guarding against is not a problem for a store-anchored cursor, because the leader's
          //   descBar is the SAME value: both peers have already aged from the same anchor, so nothing is replayed.
          console.log(`[JOIN-BYTES] ${SLOTN[ri]} · payload=${(s.descSlots?.[ri]?.base) ? _hashField(_f64b(s.descSlots[ri].base)) : '—'} · afterRestore=${_bIn} · afterReplay=${sl2.descBase ? _hashField(sl2.descBase) : '—'} · e0=${(sl2.descE0 ?? 0).toPrecision(17)} — payload==afterRestore==afterReplay is REQUIRED; the first column that changes is where the bytes are being altered`);
          console.log(`[JOIN-REPLAY] ${SLOTN[ri]} re-derived from plate ${idx + 1}/${_plates.length} (birth k=${rk}${rat ? ` pos=[${rat[0]},${rat[1]}]` : ''}) — DERIVED state replayed from the same code the leader ran; the EVOLVED descBase from the snapshot is kept (it has lived ${Math.max(0, (_E.solSteps | 0) - rk)} steps since birth and the replay cannot reproduce that)`);
          // AGED-STATE RECEIPT: every column here is what the BIRTH replay would have reset and this block put back.
          //   Each `kept≠birth` is a fork the joiner would otherwise have taken. Compare against the leader's
          //   [PAINT] line at the SAME bar: φ/descPhi0/attH must all match there, and descBar must equal
          //   floor(solStep/21) — a descBar still at the BIRTH bar means the bar loop is about to catch up
          //   `barA − descBar` bars in one frame and re-pose the slot.
          // THE SHAPE-A SPLIT, made auditable: exactly TWO things are adopted from the leader (the bytes and the
          //   ω-time cursor); every other column below was DERIVED by _recallPlateLive from the plate, i.e. by the
          //   same code path a replicated recall runs on every peer. If a column here differs between peers, it is
          //   derived from an input that itself differs (the plate, _lensObj, or the bank) — NOT from a missing
          //   snapshot field, and the fix belongs at that input rather than in another restore line.
          // ── THE LIFT'S PROPAGATOR IS NOT IN THE PLATE (2026-08-03) — the candidate that explains "same energy,
          //    different ring SIZE". _recallPlateLive → _holo.lift → specLeg → lambda(), and lambda() is cached on
          //    ctx.kernelVer(): the lift propagates the plate through the λ-grid of the kernel version CURRENT AT
          //    LIFT TIME. The plate records p/m/dop/pos/obj/w0/bw/k — the interference pattern — but NOT the
          //    propagator that made it. The fractal clock advances kernelVer continuously (observed 176→407), so:
          //      • a REPLICATED recall is exact — every peer lifts at the SAME shared kernelVer;
          //      • a JOIN is not — the leader's V was lifted at the version current when it recalled, while the
          //        joiner re-lifts NOW, at a different version ⇒ a different propagator ⇒ the reconstruction
          //        focuses at a different SCALE. A hologram read at the wrong depth changes size, not energy —
          //        which is why |ψ|², e0, regH and attH all match while the ring is visibly a different radius,
          //        and why a fresh recall on both peers fixes it permanently.
          //    Shape A makes this STRUCTURAL rather than masked: under A the lift IS the derivation, so it can no
          //    longer be papered over by adopting the leader's bytes.
          //    Logged, not yet corrected: the honest fix is for the plate to carry its store-time kernelVer and for
          //    the lift to use THAT λ-grid (a plate is a record of a propagation; the propagation belongs with it).
          //    liftVer==storeVer on BOTH peers ⇒ this is not the cause; a difference ⇒ it is.
          try { console.log(`[JOIN-ANCHOR] ${SLOTN[ri]} · storeK=${_plates[idx].k ?? '—'} (the plate's own step — the ω-time ANCHOR) · recallK=${rk} · joinK=${_E.solSteps} · _pinK=${sl2._pinK} descBar=${sl2.descBar} descCapBar=${sl2.descCapBar} — _pinK/descCapBar MUST equal floor(storeK) values on BOTH peers: they are derived from the plate, not from when anyone recalled. A recall RESURRECTS a stored moment, so the store step is the accurate instant; the recall step is peer/timing-dependent and cannot survive a join.`); } catch (e) {}
          try { console.log(`[JOIN-LIFT] ${SLOTN[ri]} · plate ${idx + 1} stored at k=${_plates[idx].k ?? '—'} · liftVer=${_E.kernelVer} (the λ-grid this lift used) · plate carries NO kernelVer — compare liftVer with the LEADER's kernelVer AT ITS RECALL: a difference means the two peers propagated the SAME plate through DIFFERENT propagators, which changes the reconstruction's SCALE at constant energy (|ψ|²/e0/regH/attH all still match — none of them encode spatial extent)`); } catch (e) {}
          console.log(`[JOIN-A] ${SLOTN[ri]} · ADOPTED: baseH=${sl2.descBase ? _hashField(sl2.descBase) : '—'} e0=${(sl2.descE0 ?? 0).toPrecision(17)} · cursor φ=${(_lensOp[ri].phase || 0).toPrecision(17)} prec=${(_lensOp[ri].prec || 0).toPrecision(17)} · descBar=${sl2.descBar} (=floor(${_E.solSteps | 0}/21), stamped to NOW so the bar loop adds no catch-up ω)`
            + ` || DERIVED from plate ${idx + 1}: ω=${(_lensOp[ri].omega || 0).toPrecision(17)} descPhi0=${(sl2.descPhi0 || 0).toPrecision(17)} pos=[${sl2.descPos?.[0]},${sl2.descPos?.[1]}] leash=[${sl2.leash.state.gx.toPrecision(17)},${sl2.leash.state.gy.toPrecision(17)}] att=${sl2._attHold ? `ψATT H=${_hashField(sl2._attHold)}` : sl2.descAtt ? `plate H=${_hashField(sl2.descAtt)}` : 'probe'} holdPhi0=${(sl2._holdPhi0 || 0).toPrecision(17)} digest=${sl2._digestLeft | 0}`
            + ` — the plate is the transferable object; the register moves it in ω-time. Only the bytes and the cursor cannot be re-derived.`); }
      } catch (e) { console.warn('[JOIN-REPLAY] failed, keeping the byte-restore', e); }   // which plate EACH slot holds (any slot can host a live plate) — so a joiner's damage-relift + button state are right
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
      try { const _rh2 = _jr ? _hashNums([].concat(Array.from(_jr.r || []), Array.from(_jr.w || []), ...(_jr.o || []).map((t) => Array.from(t || [])))) : '—';
        console.log(`[SNAP-RING] (joiner) kernelVer=${_jrVer} · ringH=${_rh2} · tiers=${_jr?.r?.length ?? 0} · offTot=${_snapOffTot} — ringH MUST equal the leader's [SNAP-RING]; a mismatch means the joiner steps the leader's field through a DIFFERENT kernel and forks on step one`); } catch (e) {}
      console.log(`[MU1-JOINRING] used ${_jr === s.ring ? 'SNAPSHOT' : 'NODE'} ring · ver=${_jrVer} · snapOffTot=${_snapOffTot} nodeVer=${n.cachedRadiiVersion | 0} snapVer=${s.kernelVer}`);
      // ── GENERATIVE JOIN: DEFER, DON'T REPLAY (2026-08-03, user's call) ────────────────────────────────────────
      //   THE PROBLEM: the snapshot ring is version-matched to the shipped FIELD (right for step one), but it also
      //   puts the joiner BEHIND kernelQueue's oldest entry — and the far-behind branch then cold-snaps the kernel
      //   at a PEER-LOCAL FRAME, which is the one path in this file that applies a per-step physics input off the
      //   shared step. Measured: the peers' kernelVer diverge and stay diverged, giving a permanent phase
      //   difference at constant energy.
      //   THE GENERATIVE FIX (rather than shipping more history): the fractal clock is a GENERATOR — every peer can
      //   derive the same kernel from the shared clock. So a joiner does not need the intermediate versions it
      //   missed; it needs to STOP STEPPING until the shared clock reaches a swap it can stage from, then advance
      //   by the same law as everyone else. That is alignment with the generator, not a replay of its output.
      //   _kernHold marks the joiner as not-yet-aligned. The drive loop refuses to step the soliton while it is set
      //   (the field simply waits — no stepping means no divergence to accumulate), and the staging branch clears
      //   it the moment a queued swap lands at its shared step, which is the first instant both peers are
      //   provably on the same kernel at the same step. From there the normal shared-step staging carries them.
      { const _q0 = Array.isArray(n.kernelQueue) ? n.kernelQueue : [];
        const _oldest0 = _q0.length ? Math.min(..._q0.map((e) => e.ver | 0)) : (_jrVer + 1);
        _kernHold = (_KHOLD_MAX > 0 && _jrVer < _oldest0 - 1) ? { since: _E.solSteps | 0, ver: _jrVer, need: _oldest0 } : null;   // mu1.kHold(0) disables the deferral (A/B against the old cold-snap behaviour)
        if (_kernHold) console.log(`[JOIN-KHOLD] kernel HOLD armed: this peer is at ver=${_jrVer} but the queue's oldest replayable is ${_oldest0} — the gap CANNOT be derived, so the soliton will NOT step until a queued swap lands at its shared step (deferral, not replay). Without this the far-behind branch cold-snaps at a peer-local frame and the peers propagate through different kernels at the same step: permanent phase difference at constant energy.`);
        else console.log(`[JOIN-KHOLD] no hold needed — ver=${_jrVer} is within the queue's replayable range (oldest=${_oldest0}, depth=${_q0.length}, nodeVer=${n.cachedRadiiVersion | 0}, gap=${(n.cachedRadiiVersion | 0) - _jrVer} versions to stage); the normal shared-step staging aligns the kernel. If ver later DRIFTS between peers anyway, the staging is racing the queue's arrival rather than the gap being unreplayable — a different problem from the one the hold solves.`); }
      _solSeeded = true; _joinBurstLog = true; _joinAnchor = true;   // a restored joiner has W's field verbatim → do NOT re-seed; first-frame decides whether to ease a big backlog (c0 kept verbatim)
      // JOIN DIAGNOSTIC: hash the restored field at the restore step. Compare to the LEADER's [DET] solH at the SAME
      // solStep= (the leader logs solH every Q-boundary). If they MATCH → the restore is exact, the fork is in the drive
      // afterward (GPU-context). If they DIFFER → the field transfer itself is lossy (the fork is at join, not drive).
      console.log(`[MU1-JOIN] restored @ solStep=${_E.solSteps} · restoredFieldH=${_hashField(W.field)} (compare to the LEADER's [DET] solH at solStep=${_E.solSteps}) · c0=${_stepClk.c0.toFixed(4)} rate=${_stepClk.rate} born=[${_sb.slots.filter((x) => x.born).map((x) => x.name).join(',')}]`);
      // ARM THE BISECTOR HERE, NOT FROM THE CONSOLE (2026-08-03). mu1.forkDet's original instruction was "run on
      //   BOTH peers before joining" — which a JOINER can never do: mu1 does not exist until the app is up, and by
      //   then this restore has already run. The joiner's own state begins at THIS line, so this is exactly the
      //   right place to start hashing. Auto-arm on any join that restored a living 𝔸-slot (the case the whole
      //   store/recall join concerns); the leader is armed by hand, at any time, because the log keys off the
      //   SHARED bar — a leader armed later still emits the same hashes at the same bars and the two logs pair up.
      //   Off with mu1.forkDet(0). Costs one readback per armed slot per 8 bars.
      // THE PHASE RECEIPT AT THE RESTORE INSTANT (2026-08-03). The surviving symptom is a PURE GLOBAL ROTATION:
      //   with the [PAINT] scalars finally reading the painted buffer, |ψ|² agrees to 0.0–0.2× the f32 floor while
      //   argPin=arg⟨att,ψ⟩ differs by 0.009–0.036 rad — same magnitude, different phase, and a global phase is
      //   conserved by the dynamics (the cap is amplitude-only), so it never decays. `att` is byte-identical on
      //   both peers, so the rotation is in ψ ITSELF. Print argPin for every restored living slot AT THE RESTORE,
      //   from the bytes that just came off the wire, BEFORE a single step runs. Then compare to the leader's
      //   [PAINT] argPin at the SAME solStep:
      //     • already different HERE  ⇒ the rotation is IN THE PAYLOAD (the f32 wire quantization of descBase, or
      //       the leader shipping a buffer captured at a different sub-step than the one it reports);
      //     • equal here, diverging later ⇒ the two peers' first steps rotate differently (a per-step phase term:
      //       the pin superpose, the SPM, or the cap's f32 scale).
      //   That single bit is what separates "the join delivered a rotated field" from "the join delivered the right
      //   field and the drive rotated it", and no existing receipt answers it.
      try { for (let pi2 = 1; pi2 < 4; pi2++) { const ps2 = _sb.slots[pi2];
        if (!ps2?.desc || !ps2.descLive || !ps2.descBase) continue;
        const a3 = ps2.descAtt || ps2._attHold; if (!a3 || a3.length !== ps2.descBase.length) continue;
        let rr2 = 0, ii2 = 0, e3 = 0; const f3 = ps2.descBase;
        for (let j3 = 0; j3 < f3.length; j3 += 2) { e3 += f3[j3] * f3[j3] + f3[j3 + 1] * f3[j3 + 1];
          rr2 += a3[j3] * f3[j3] + a3[j3 + 1] * f3[j3 + 1]; ii2 += a3[j3] * f3[j3 + 1] - a3[j3 + 1] * f3[j3]; }
        console.log(`[JOIN-PHASE] ${SLOTN[pi2]} @solStep=${_E.solSteps} · argPin=${Math.atan2(ii2, rr2).toPrecision(17)} · |ψ|²=${e3.toPrecision(17)} · baseH=${_hashField(f3)} attH=${_hashField(a3)} att=${ps2._attHold ? 'ψATT' : 'plate'} · eyeParity=${_gpu?.eyeSlotParity ? _gpu.eyeSlotParity(pi2) : '?'} — compare to the LEADER's [PAINT] argPin at this SAME solStep: DIFFERENT here ⇒ the rotation rode the wire (payload); EQUAL here but diverging later ⇒ the drive rotates the two peers differently`); } } catch (e) {}
      // THE PING-PONG PARITY IS PEER-LOCAL STATE THAT NOTHING SYNCS (2026-08-03 — the remaining candidate).
      //   Each slot's eye is a TEXTURE PAIR (A/B) with a `src` marker saying which half currently holds the field;
      //   every GPU op reads src and writes the other, then commitEyeSlot stores the flipped parity back. That
      //   marker is created per GPU CONTEXT and advanced by however many ops this peer has run on the slot — the
      //   joiner has its own op history since boot, the leader a different one. The join uploads the right BYTES
      //   (proven: [SNAP-PHASE]/[JOIN-PHASE] agree to 13 figures) but says nothing about WHICH half of the pair
      //   they land in, so two peers can sit at OPPOSITE parity at the same shared step. Both are internally
      //   consistent — which is exactly why every CPU-side hash (regH, attH, e0, descBase) matches — but the two
      //   fields then take different physical paths through the pair each step. This is the only input to the GPU
      //   step that is (a) not in regH, (b) never compared across peers, and (c) still unexplained after the
      //   payload, the Q-block alignment, the ring, the pin bytes and the clock were all proven identical.
      //   NOT YET CONFIRMED — logged so the two peers' parity can be diffed at the join instant.
      try { console.log(`[JOIN-PARITY] ${_sb.slots.map((x, i) => `${SLOTN[i]}:${_gpu?.eyeSlotParity ? _gpu.eyeSlotParity(i) : '?'}`).join(' ')} @solStep=${_E.solSteps} — compare with the LEADER's [SNAP-PARITY] at the same step. OPPOSITE parity on a slot whose bytes/attH/regH all match is the remaining candidate for the |ψ|²-equal / argPin-apart rotation.`); } catch (e) {}
      if (!_forkDetEvery) { const _fs = _sb.slots.findIndex((x, i) => i > 0 && x?.desc && x.descLive && x.descBase);
        if (_fs > 0) { _forkDetEvery = 8; _forkDetSlot = _fs; _forkDetBar = -1;
          console.log(`[FORK] auto-armed on ${SLOTN[_fs]} at the join (every 8 bars) — a joiner cannot be armed "before joining", so the restore arms it. Arm the LEADER with mu1.forkDet(8,'${SLOTN[_fs]}') (any time; lines pair by bar=), then compare: the FIRST bar where baseH differs brackets the fork to 21 steps. mu1.forkDet(0) to stop.`); } } };
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
    // A VIEW SWITCH MUST LEAVE THE NEW SLOT WITH A VALID DISPLAY SOURCE (2026-08-02). Setting _viewSlot alone
    //   reopens, on every switch, the same gap that was fixed at join: _skipCopy immediately stops refreshing the
    //   newly-viewed slot's descDisp (because the film is "on"), while its film does not exist yet and only starts
    //   capturing at the next _dispTick — so the slot paints a STALE descDisp in between. It also matters because
    //   the default view is W: every peer necessarily joins on W and switches to V afterwards, so this path is on
    //   the critical path for every join. Refresh descDisp from the current bytes and drop the OLD slot's film.
    _viewSel.onchange = () => { const prev = _viewSlot;
      _viewSlot = Math.max(0, SLOTN.indexOf(_viewSel.value));
      if (prev !== _viewSlot) {
        if (_gpu?.dropFilm && _filmStep[prev] >= 0) { _gpu.dropFilm(prev); _filmStep[prev] = -1; }   // the slot we left keeps no film (nothing captures it any more — a stale one would be served to any reader)
        const ns = _sb.slots[_viewSlot];
        if (ns?.descBase) ns.descDisp = Float64Array.from(ns.descBase);   // seed the new slot's display source NOW, so it never paints a stale buffer while waiting for its first film capture
        // CAPTURE THE NEW SLOT'S FILM IMMEDIATELY (2026-08-03) — the RELOAD-ONLY visual mismatch. Seeding descDisp
        //   (above) stops the slot painting a STALE buffer, but it leaves the two peers rendering the SAME slot
        //   through DIFFERENT SOURCES, which is the actual defect:
        //     • the peer that has been viewing V all along has a live V FILM → _useFilm is true → the shader samples
        //       the GPU film, current at the shared step;
        //     • a RELOADED peer had every film dropped by _restoreSnap (films are pre-join captures) and boots on W,
        //       so when you switch to V it has no V film → _useFilm is FALSE → it renders the setDescBase fallback
        //       from descDisp, which only refreshes at BAR cadence while the film refreshes every Q.
        //   Same state, two display paths, different pixels — and [PAINT]'s fieldH hashes whichever source is in
        //   use (src=FILM(gpu) vs baseArr), so the hash mismatches too. That is exactly the reported signature:
        //   live store/recall on two connected peers is fine (both have films); only a RELOAD breaks it, only for
        //   V/P1/P2 (W is the boot view, so its film always exists), and it appears the moment you switch to V.
        //   Capturing here puts the reloaded peer back on the film path on the same frame it switches.
        if (_filmOn && _turboOn && _gpu?.filmCapture && _tbLive(_viewSlot) && _filmStep[_viewSlot] < 0) {
          try { _gpu.selectEyeSlot(_viewSlot); _gpu.filmCapture(_viewSlot); _gpu.selectEyeSlot(null); _filmStep[_viewSlot] = _tbTexStep[_viewSlot] >= 0 ? _tbTexStep[_viewSlot] : (_E.solSteps | 0);
            console.log(`[VIEW] ${SLOTN[_viewSlot]} film captured at the switch (step ${_filmStep[_viewSlot]}) — without this a peer whose films were dropped at join renders this slot from descDisp (bar cadence) while a peer that never reloaded renders it from its film (Q cadence): same state, different pixels AND a different [PAINT] fieldH`); } catch (e) { _gpu.selectEyeSlot(null); } }
        _descTexKey = null; _lastPaintSig = ''; }
    }; bar1.appendChild(_viewSel);
    // view cycle: raw ψ → ∠lens (ψ through readOp) → 𝔸desc (the descriptor projection — see _dials). LOCAL display toggle.
    const _VIEWS = ['raw', 'lens', 'desc'], _VIEWLBL = { raw: 'view:raw', lens: 'view:∠lens', desc: 'view:𝔸desc' };
    const _lvBtn = mkBtn('view:raw', false, () => { _dials.view = _VIEWS[(_VIEWS.indexOf(_dials.view) + 1) % _VIEWS.length];
      _lvBtn.textContent = _VIEWLBL[_dials.view]; _lvBtn._on = _dials.view !== 'raw'; }); bar1.appendChild(_lvBtn);
    // FIELD-VIEW cycle (LOCAL): full ψ → residual (ψ−A, the medium's own dressing alone) → bare (A, the injected
    // symbol alone). A display decomposition of the state into its injected + medium-produced parts. Peer-local.
    const _FVLBL = { full: 'ψ:full', residual: 'ψ⊥A:medium', bare: 'A:symbol' };   // residual = ψ with the symbol PROJECTED OUT (ψ ⊥ A) → the oscillating dressing only
    const _fvBtn = mkBtn('ψ:full', false, () => { _fieldView = _FVIEWS[(_FVIEWS.indexOf(_fieldView) + 1) % _FVIEWS.length];
      _fvBtn.textContent = _FVLBL[_fieldView]; _fvBtn._on = _fieldView !== 'full'; }); bar1.appendChild(_fvBtn);
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
    bar1.appendChild(mkBtn('recall⊘', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'recallo', src: _verbSlot(), holoMode: 7, frac: 0.5, block: 8, seed: 0 })));  // OCCLUDED recall: knock out 50% of W in random blocks, bind the fragment, lift the WHOLE plate — "break the hologram, reconstruct the whole scene" (mu1.recallo({mode,frac,block,seed}) for a sweep)
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
    const _fmixBtn = mkBtn('⇄mix', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'fieldmix', amp: _fieldMix ? 0 : 1 }));   // the edge's SECOND coupling layer: ON = phase entrains AND shapes bleed · OFF = an edge couples PHASE only (Kuramoto), shapes stay pure — isolates the two layers
    bar1.appendChild(_fmixBtn);
    const _turboBtn = mkBtn('gpu', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'turbo', amp: _turboOn ? 0 : 1 }));   // executor toggle: 'gpu' = turbo (GPU executes the U1 engine step) · 'cpu' = the universal CPU executor (label reflects state)
    bar1.appendChild(_turboBtn);
    const _LIN_LABELS = ['nonlin', 'lin:free', 'lin:trap'];   // the linear-mode cycle: full · free-linear (disperses) · sharp linear trap
    const _linBtn = mkBtn('nonlin', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'linonly', amp: (_linearMode + 1) % 3 }));   // cycle: full nonlinear → free linear (dispersing) → linear SHARP TRAP (symbol held by linear injection lock + linear damping)
    bar1.appendChild(_linBtn);

    // ── THE REGISTER STRIP (bar2) — per-slot observer controls: which slot to target, its pin β (refAmp), its att
    //    phase write (attPhase ±), and the global ω (lensTau) precession dial. Every control is a REPLICATED verb. ──
    let _regSlot = 'W';   // which slot the register controls target
    const _regLbl = document.createElement('span'); _regLbl.textContent = 'register:'; _regLbl.style.fontWeight = 'bold'; bar2.appendChild(_regLbl);
    const _regSel = document.createElement('select'); Object.assign(_regSel.style, { background: '#222', color: '#9cf', border: '1px solid #0004', borderRadius: '4px', padding: '3px 4px', fontSize: '9px', fontFamily: 'ui-monospace,monospace', cursor: 'pointer' });
    for (const nm of SLOTN) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; _regSel.appendChild(o); } _regSel.onchange = () => { _regSlot = _regSel.value; }; bar2.appendChild(_regSel);
    // β = pin gravity (refAmp). NOTE ITS MEANING INVERTS UNDER ψATT: with a PROBE pin, β sets how hard the medium is
    //   driven toward a DIFFERENT shape, so the probe↔medium mismatch beat (the visible oscillation) survives well
    //   past β=1. Once ψATT has adopted, the target IS the field's own state, so the pin no longer drives a mismatch —
    //   it CLAMPS the field to a rotating copy of itself, i.e. it is pure DAMPING. Measured liveliness vs β under
    //   ψATT(ω=0.3): 0.51 @0.2 · 0.27 @0.4 · 0.14 @0.6 · 0.12 @0.7 · 0.11 @1.0 · 0.08 @3.0 — monotone decay, and by
    //   ~0.7 it is already so flat that further travel looks static (that is the "stops working at 0.70" effect: not
    //   a cliff, a saturated tail). Injection-per-step/|field| grows 0.03→0.11→0.30 across β 0.2→0.7→2.0 and the
    //   field's tracking of the hold rises 0.73→0.87→0.95 — the clamp tightening. UNDER ψATT USE LOW β (0.2–0.4) AND
    //   RAISE ω FOR LIFE: ω is the oscillator now (liveliness ≈0.37·ω), β only decides how tightly it is held.
    const _sBeta = mkSlider('β', 0, 3, 0.05, 1, (v) => injectEvent?.({ type: 'mediumVirt', mode: 'refamp', src: _regSlot, amp: v }));   // pin gravity (refAmp)
    bar2.appendChild(_sBeta.wrap);
    bar2.appendChild(mkBtn('att−', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'aphase', src: _regSlot, amp: -0.2 })));   // rotate the register phase (attPhase)
    bar2.appendChild(mkBtn('att+', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'aphase', src: _regSlot, amp: +0.2 })));
    const _sOm = mkSlider('ω', -0.5, 0.5, 0.01, 0, (v) => injectEvent?.({ type: 'mediumVirt', mode: 'lenstau', amp: v, src: _regSlot }));   // per-SLOT precession (lensTau, targets the register-slot dropdown) — each worldline ages at its own ω, the register-clock comparator
    bar2.appendChild(_sOm.wrap);
    const _regReadout = document.createElement('span'); _regReadout.style.color = '#7a8'; bar2.appendChild(_regReadout);   // live per-slot ∠/β/ω

    // ── MEMORY-OCCLUSION strip (⊘memory): DAMAGE a stored plate and watch the living memory degrade — the "corrupted
    //    memory" demo, visually. Method dropdown + a LIVE damage slider (drag = apply, non-destructive from pristine →
    //    0 heals) drive an `occludebank` verb (replicated). 'live plate' lifts the plate into a LIVING soliton (P2);
    //    dragging damage then degrades that soliton in real time. (The slider is the only damage control — no button.)
    // ── WHAT THE LOCK HOLDS: the probe geometry the pin drives the medium toward. letterA/cross are DENSE (a chain of
    //    dots along each stroke — that density IS the on-screen "texture"); point/pair/grid are SPARSE LIGHT POINTS and
    //    the medium builds its own interference between them (measured MORE coherent than letterA). The LOCK itself is
    //    untouched — coherence, oscillation and fringes all remain; only the target geometry changes. Replicated verb.
    const _objSep = document.createElement('span'); _objSep.textContent = '│ pin holds:'; _objSep.style.color = '#7a9'; _objSep.style.fontWeight = 'bold'; bar2.appendChild(_objSep);
    const _objSel = document.createElement('select'); Object.assign(_objSel.style, { background: '#222', color: '#9cf', border: '1px solid #0004', borderRadius: '4px', padding: '3px 4px', fontSize: '9px', fontFamily: 'ui-monospace,monospace', cursor: 'pointer' });
    for (const nm of _PROBE_OBJS) { const o = document.createElement('option'); o.value = nm; o.textContent = nm === 'lightpts' ? 'lightpts ·coherent ✦' : (nm === 'point' || nm === 'pair' || nm === 'grid') ? `${nm} ·hard (noisy)` : nm; _objSel.appendChild(o); }   // lightpts = Gaussian sources below the kKnee (the working light points); hard dots decohere
    _objSel.value = _lensObj; _objSel.onchange = () => injectEvent?.({ type: 'mediumVirt', mode: 'lensobj', obj: _objSel.value });
    bar2.appendChild(_objSel);
    const _occSep = document.createElement('span'); _occSep.textContent = '│ ⊘memory:'; _occSep.style.color = '#a77'; _occSep.style.fontWeight = 'bold'; bar2.appendChild(_occSep);
    const _OCC_METHODS = [[7, 'rand-zero'], [8, 'rand-noise'], [6, 'half'], [5, 'box'], [1, 'low-pass'], [2, 'high-pass'], [3, 'conjugate']];
    let _occMode = 7;
    const _occSel = document.createElement('select'); Object.assign(_occSel.style, { background: '#222', color: '#c99', border: '1px solid #0004', borderRadius: '4px', padding: '3px 4px', fontSize: '9px', fontFamily: 'ui-monospace,monospace', cursor: 'pointer' });
    for (const [m, nm] of _OCC_METHODS) { const o = document.createElement('option'); o.value = String(m); o.textContent = nm; _occSel.appendChild(o); }
    _occSel.onchange = () => { _occMode = _occSel.value | 0; }; bar2.appendChild(_occSel);
    // T slider: the ±T HOLOGRAPHY DEPTH (spectral-leg steps). Replicated verb 'virtt'. Larger T = deeper spread; the
    //   plate delocalizes (mu1.sweepOcclusion measures it). Fires on release (change) — re-store after to bank at the new T.
    const _sVirtT = mkSlider('T', 1, 500, 1, 16, () => {});   // apply on release only (a step-change; not a live drag)
    _sVirtT.input.addEventListener('change', () => injectEvent?.({ type: 'mediumVirt', mode: 'virtt', amp: +_sVirtT.input.value }));
    bar2.appendChild(_sVirtT.wrap);
    // ⌛pin slider: how long a recalled slot stays DRIVEN by its plate attractor. 0 (default) = forever — the pin then
    //   re-draws the clean symbol over any damage (measured: a 90%-damaged field ends 0.73 like the SYMBOL, 0.13 like
    //   the damaged data). Raise it and the drive FADES after birth, so what you see is the medium's own state and
    //   damage stays visible. Replicated (the pin is in regH). Applies on release.
    // ⏱ WORLD PROPER-TIME DIVISOR (the §7.44 spiral brake, as a UI dial). When supply < demand — a shared GPU, a
    //   weak peer, several living slots — the wall-clock target asks for more steps than can execute, the backlog
    //   grows, and the deficit SPIRALS (measured once at todo pinned to the 1024 cap, backlog 200→5847). Dividing
    //   demand slows MATTER'S OWN CLOCK so the backlog cannot outrun supply: fewer steps per wall-second, physics
    //   per step unchanged. Replicated as a STAMPED verb (`tempo`, clamped 1–8 in the world reducer), so the divisor
    //   flips at a SHARED step on every peer and the register stays byte-identical — a peer-local divisor would fork
    //   proper time itself. The auto-tempo governor drives the same verb; this slider is the manual override, and
    //   because both actuate through the reducer they compose rather than fight (last-wins on the same shared state).
    //   Apply on RELEASE (change, not input): each drag position would otherwise stamp a verb on every peer.
    const _sTempo = mkSlider('⏱÷', 1, 8, 1, 1, () => {});
    _sTempo.input.addEventListener('change', () => injectEvent?.({ type: 'mediumVirt', mode: 'tempo', amp: +_sTempo.input.value }));
    bar2.appendChild(_sTempo.wrap);
    // ⌛pin slider REMOVED (2026-07-26): it dialled a DECOHERENCE EXPERIMENT, not a normal control — 0 (drive forever)
    // is the correct setting for every ordinary use, so a live slider mostly offered a way to dissolve the soliton by
    // accident. The mechanism is untouched and still replicated (_pinHold / _pinFac / the `pinhold` verb / the snap
    // field): run it deliberately from the console with mu1.pinHold(n), mu1.pinHold(0) to restore.
    // LIVE damage slider (the ONLY damage control): fires occludebank AS YOU DRAG (throttled ~100ms) + commits on
    //   release, with a FIXED mask seed for the drag so frac grows smoothly (the pattern doesn't reshuffle mid-drag).
    //   The handler occludes from the PRISTINE original, so dragging DOWN heals (0 = pristine) and UP re-damages —
    //   non-destructive. Seed chosen once per drag (a stable pattern). Press 'live plate' first to watch a recalled
    //   soliton degrade in real time; the damage also rides into any slot that recalled the plate (_reliftDamaged).
    let _occFrac = 0.5, _occSeed = 0, _occLast = 0, _occDragN = 0;   // _occFrac/_occMode are SET BY THE occludebank VERB HANDLER on every peer (+ restored on join) → the render reflects them (the _VIRT_T pattern)
    const _fireDamage = (fr, seed) => injectEvent?.({ type: 'mediumVirt', mode: 'occludebank', gx: -1, holoMode: _occMode, frac: fr, block: 8, seed: seed | 0 });
    const _occDmg = mkSlider('damage', 0, 1, 0.05, 0.5, (v) => { _occFrac = v;   // LIVE: apply as you drag (throttled)
      // one FIXED seed per drag so frac grows without the mask reshuffling. Derived from a monotonic drag counter via
      // the KWE PRNG (makeRng) — NO Math.random / Date.now (no wall-clock nondeterminism). The seed VALUE is then
      // stamped into the replicated verb → identical on every peer; the noise generator (occlude's _occHash) is a
      // pure fn of that seed → the SAME mask everywhere. (Throttle timing IS wall-clock but only gates HOW OFTEN the
      // replicated verb fires on THIS peer — the applied result is a pure fn of the last stamped {frac,seed}.)
      if (!_occSeed) { const _r = makeRng(++_occDragN, _occMode, 0xda11a9e, 0x5eed); _r.next(); _r.next(); _occSeed = 1 + _r.nextInt(9998); }
      const now = Date.now(); if (now - _occLast > 100) { _occLast = now; _fireDamage(v, _occSeed); } });
    bar2.appendChild(_occDmg.wrap);
    _occDmg.input.addEventListener('change', () => { _fireDamage(_occFrac, _occSeed); _occSeed = 0; });   // release: final apply + clear the drag seed (next drag picks a new pattern) — the slider IS the damage control (no separate button; dragging live-applies + release commits)
    // 'live plate' — TOGGLE, SLOT-TARGETED (the same _verbSlot() rule as the memory buttons: the VIEWED slot wins when
    //   it is V/P1/P2, else the register-strip target; default P2). ON lifts the last stored plate into that slot as a
    //   LIVING 𝔸-slot and views it (the memory as an evolving soliton — damage it → degrades live); OFF returns the
    //   view to W. The view switch is local; the platelive recall is replicated. Slot-targeting lets you put the SAME
    //   plate into two slots (e.g. compare it at two T's, or watch one memory degrade in two reconstructions at once).
    //   NOTE damage reacts to ANY slot holding the plate — a plain store+recall@ into V/P1 registers the same way
    //   (_recalledInto is written by every recall path, not just this button), which is why the slider already
    //   degraded V/P1/P2 without ever pressing this.
    //   NO SILENT DEFAULT: the target is exactly the SELECTED slot (_verbSlot). W cannot host a live plate (it is the
    //   driven world), so with W selected the button DISABLES and says so — it never quietly invents P2. Pick V/P1/P2
    //   in the register strip (or view one) and the button follows it.
    const _plvSlotIdx = () => { const i = SLOTN.indexOf(_verbSlot()); return (i >= 1 && i <= 3) ? i : -1; };   // −1 = W selected → no valid target
    //   THE TOGGLE IS ABOUT THE PLATE, NOT THE VIEW: ON = the selected slot HOSTS the live plate (so bank damage
    //   re-lifts into it and you watch it degrade); OFF = RELEASE it (the slot stops tracking that plate, so damage
    //   no longer touches it). The VIEW STAYS on the selected slot either way — toggling never jumps you to W.
    const _plvBtn = mkBtn('live plate', false, () => {
      const ti = _plvSlotIdx();
      if (ti < 0) { console.log('[MU1-PLATELIVE] W is the driven world — it cannot host a live plate. Select V / P1 / P2 in the register strip (or view one) and press again.'); return; }
      if (_recalledInto[ti] >= 0) {   // ON → OFF: release the plate link (replicated); the slot keeps its field, the view stays here
        injectEvent?.({ type: 'mediumVirt', mode: 'platelive', gx: -1, src: SLOTN[ti] }); _viewSlot = ti; _plateView = -1; return; }
      const idx = _plates.length - 1; if (idx < 0) return;
      injectEvent?.({ type: 'mediumVirt', mode: 'platelive', gx: idx, src: SLOTN[ti] }); _viewSlot = ti; _plateView = -1; });   // OFF → ON: host the last plate in the SELECTED slot (REPLICATED) + view it
    bar2.appendChild(_plvBtn);
    // '⊘view' — LOCAL toggle: show the hosted STORED PLATE (the memory itself + its damage — STATIC, a frozen record)
    //   vs the slot's LIVE RECONSTRUCTION (register-stepped, moving). Static-vs-moving IS the contrast: the memory is
    //   a record, the recall is alive. At T=1 the raw holes show in the reconstruction too; at high T the −T lift
    //   fills them — so toggling with/without shows how much the hologram recovered from the damage you can see here.
    const _ocvBtn = mkBtn('⊘view', false, () => { _occView = !_occView; });
    bar2.appendChild(_ocvBtn);
    // 'ψatt' — the FIELD-AS-ATTRACTOR door (selfatt): digest 3 bars then the field's own state becomes the pin
    //   target; press again (when any hold is live) to revert to the probe pin. Set ω≠0 (lensTau) for living precession.
    const _psaBtn = mkBtn('ψatt', false, () => { const held = _sb.slots.some((s) => s._attHold || s._digestLeft > 0);
      injectEvent?.({ type: 'mediumVirt', mode: 'selfatt', amp: held ? 0 : 3 }); });
    bar2.appendChild(_psaBtn);

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
    // the whole determinism contract — EXTRACTED to medium-core.regHash (byte-identical: the flat number order is
    // load-bearing, reproduced exactly there). The app supplies only the accessors; the contract SHAPE is now shared.
    const _regH = () => regHash({ step: _E.solSteps, rate: _stepClk.rate, ops: _lensOp, slots: _sb.slots,
      edge: _K.edge, plates: _plates, beatsOf: _tauK ? ((nm) => _tauK.beatsOf(nm)) : null });
    // the SHARED full register introspection (same as the thin apps — medium-u1 is the full-fidelity demo of it):
    // per-slot ∠/ω/β/beats/τ/born + step + kH. medium-u1 adds its field-specific extras (regH, lock, Wpos, fieldH).
    const _rout = makeRegisterReadout({ tauK: _tauK, names: SLOTN, op: (i) => _lensOp[i], born: (i) => !!_sb.slots[i].born, step: () => _E.solSteps });
    if (typeof window !== 'undefined') {
      window.mu1 = {
        // poseCheck() — THE HONESTY TEST for the shift render. It measures WHERE THE FIELD ACTUALLY IS (the
        // intensity centroid of descBase, torus-aware) vs descPos (the render anchor) vs the leash. If the
        // field carries the position, centroid ≈ leash and the render offset ox = leash − descPos should equal
        // centroid − descPos (i.e. the render draws the field at its TRUE place, no fake displacement). A large
        // ox with centroid already AT descPos would be a trick (double-count); ox ≈ centroid−descPos is honest
        // interpolation of a coarsely-refreshed film. Run while dragging shiftX.
        poseCheck: (slot = 'W') => { const si = SLOTN.indexOf(slot), s = _sb.slots[si];
          if (!s?.desc || !s.descBase) return '[POSE] slot not a live descriptor'; if (_turboOn && _gpu) _tbSyncSlot(si);
          const sm = secondMomentTorus(s.descBase, GRID), L = s.leash.state;
          const dpx = s.descPos?.[0] ?? 0, dpy = s.descPos?.[1] ?? 0;
          // the field's DISPLAYED position = its centroid + the render offset ox (that's what the eye sees).
          // descPos is a LEASH coordinate (can be negative / off-grid); the centroid is a GRID coordinate. The
          // soliton is injected at GRID/2 + descPos-relative, so the field's leash-frame position is
          // centroid − GRID/2. Compare THAT to the leash (both wrapped consistently onto the torus).
          const wrap = (a) => { let d = ((a % GRID) + GRID) % GRID; if (d > GRID / 2) d -= GRID; return d; };
          const fieldLx = wrap(sm.cx - GRID / 2), fieldLy = wrap(sm.cy - GRID / 2);   // field position in leash frame
          const oxR = L.gx - dpx, oyR = L.gy - dpy;                                    // what _descPose adds
          const shown = [wrap(fieldLx + oxR), wrap(fieldLy + oyR)];                    // where the eye sees it
          const err = Math.hypot(wrap(shown[0] - L.gx), wrap(shown[1] - L.gy));        // displayed vs leash target
          const fieldLag = Math.hypot(wrap(fieldLx - L.gx), wrap(fieldLy - L.gy));     // the field's own lag behind the leash
          console.log(`[POSE] ${slot} · field(leash-frame)=(${fieldLx.toFixed(1)},${fieldLy.toFixed(1)}) · leash=(${L.gx.toFixed(1)},${L.gy.toFixed(1)}) · descPos=(${dpx.toFixed(1)},${dpy.toFixed(1)}) · m=${sm.m.toFixed(2)}${sm.m < 0.25 ? ' ⚠delocalized' : ''}`);
          console.log(`[POSE] render ox=(${oxR.toFixed(2)},${oyR.toFixed(2)}) → shown=(${shown[0].toFixed(1)},${shown[1].toFixed(1)}) · field lag behind leash=${fieldLag.toFixed(2)}px · shown-vs-field=${Math.hypot(oxR, oyR).toFixed(2)}px`);
          console.log(`[POSE] → ${Math.hypot(oxR, oyR) < 0.5 ? '✓ HONEST: ox≈0 — the render draws descBase IN PLACE; the motion you see IS the field moving (the pin transport). No fake displacement.' : (Math.abs(Math.hypot(oxR, oyR) - fieldLag) < 1.5 ? '✓ HONEST: ox interpolates a stale film frame toward where the field HAS moved (ox ≈ the field\'s real displacement since the last refresh)' : '✗ SUSPECT: ox displaces beyond the field\'s real position — showing the soliton where it is HEADING, not where it IS (the pin-lag over-reach)')}`);
          return { fieldLeashFrame: [fieldLx, fieldLy], leash: [L.gx, L.gy], descPos: [dpx, dpy], ox: [oxR, oyR], shown, fieldLag, m: sm.m }; },
        // poseSettle(slot, bars) — is the field lag a STABLE fixed point (honest pin equilibrium) or a growing
        // DRIFT (would compound across shifts)? Samples fieldLag at bar cadence while the leash is parked. A
        // flat series = the injection lock's honest static offset (a driven oscillator settles behind its
        // forcing — real physics, shown faithfully). A rising series = accumulating drift (a real problem).
        poseSettle: (slot = 'W', nBars = 12) => { const si = SLOTN.indexOf(slot), s = _sb.slots[si];
          if (!s?.desc) return '[SETTLE] not a live slot'; const L = s.leash.state;
          if (L.go && (Math.abs(L.tx - L.gx) > 0.1 || Math.abs(L.ty - L.gy) > 0.1)) console.log('[SETTLE] ⚠ leash still moving — let the shift STOP first for a clean settle read');
          let n = 0; const wrap = (a) => { let d = ((a % GRID) + GRID) % GRID; if (d > GRID / 2) d -= GRID; return d; };
          const series = []; const tick = () => { if (n >= nBars) {
              // judge the TREND of the STEADY portion (back half), not endpoint−start: the first samples are the
              // settling transient, so comparing them to the last falsely reads a rise (the bug this fixes). A
              // least-squares slope over the back half near zero = stable fixed point (breathing jitter aside).
              const h = series.slice(Math.floor(series.length / 2)); const nn = h.length;
              let st = 0, sy = 0, stt = 0, sty = 0; for (let i = 0; i < nn; i++) { st += i; sy += h[i]; stt += i * i; sty += i * h[i]; }
              const slope = (nn * sty - st * sy) / (nn * stt - st * st || 1);   // px per bar over the steady window
              const mean = sy / nn, amp = Math.max(...h) - Math.min(...h);
              console.log(`[SETTLE] ${slot} · fieldLag over ${nBars} bars: [${series.map((v) => v.toFixed(2)).join(', ')}]`);
              console.log(`[SETTLE] steady window: mean=${mean.toFixed(2)}px · slope=${slope.toFixed(3)}px/bar · jitter=±${(amp / 2).toFixed(2)}px → ${Math.abs(slope) < 0.05 ? '✓ STABLE fixed point (the pin\'s honest static offset — a driven lock settles behind its target; the ±jitter is the soliton\'s own breathing, σ-wander normal-not-broken; ox=0 shows it faithfully — NO trick, NO drift)' : slope > 0.05 ? '✗ GROWING drift (compounds across shifts; raise β / leash gain to tighten the lock — a physics fix, the render stays honest)' : '↓ still RELAXING toward the target'}`); return; }
            if (_turboOn && _gpu) _tbSyncSlot(si);
            const sm = secondMomentTorus(s.descBase, GRID);
            series.push(Math.hypot(wrap(wrap(sm.cx - GRID / 2) - L.gx), wrap(wrap(sm.cy - GRID / 2) - L.gy))); n++;
            setTimeout(tick, 21 * DT * 1000 / 3); };   // ~1 bar of wall time (rough; the series shape is what matters)
          tick(); return `[SETTLE] sampling fieldLag for ${nBars} bars — keep the leash parked…`; },
        lensOps: () => { const o = _lensOp.map((l, i) => ({ slot: SLOTN[i], ...l, angle: +lensU1.angle(l).toFixed(4) }));
          console.log(`[LENSOPS] ${o.map((l) => `${l.slot}:{∠${l.angle} β=${l.beta} ω=${l.omega} g=${(l.gain ?? 1).toFixed(2)}}`).join(' · ')} step=${_E.solSteps}`); return o; },
        regPhase: () => _rout.phase({   // the shared universal register fields (step/kH/born/angle/omega/beta/beats/tau) + medium-u1's field extras
          regH: _regH(), lock: +_E.lockNow.toFixed(3),
          Wpos: [+W.leash.state.gx.toFixed(2), +W.leash.state.gy.toFixed(2)],
          // fieldH — the LIVING state's digest. In ⌀PDE the state is descBase (s.field is null there), so hash whichever
          //   exists: descBase for a register-resident slot, field for a classic PDE slot. (It used to hash s.field
          //   only, which reported null for every slot in ⌀PDE — a blind meter exactly when you need it to tell you
          //   whether the field is still evolving.) Peer-local telemetry; a pure fn of shared state at a shared step.
          fieldH: _sb.slots.map((s) => (s.descBase ? _hashField(s.descBase) : (s.field ? _hashField(s.field) : null))),
          fieldSrc: _sb.slots.map((s) => (s.descBase ? '𝔸' : (s.field ? 'ψ' : null))),   // which store fieldH read (𝔸 = descBase / ψ = field)
          // ψATT: WHAT each slot's pin is holding — 'probe' (the injected symbol, the operator asserts it), 'digest…'
          //   (pin lifted, the medium is dispersing the pixels), or 'FIELD' (adopted: the slot's own captured state is
          //   the target, precessing at ω — the symbol is carried by MATTER). 'FIELD ω0' warns the target is static
          //   (a fixed point: after adoption the register clock is the ONLY oscillator).
          pinSrc: _sb.slots.map((s, i) => (!s.desc && !s.field) ? null
            : s._digestLeft > 0 ? `digest${s._digestLeft}`
            : s._attHold ? (_lensOp[i].omega ? 'FIELD' : 'FIELD ω0⚠') : 'probe') }),
        chainRead: () => { const c = _chainSlots(); if (c.length < 2) return '[MU1] need ≥2 born slots'; const m = chainMeter(c);
          console.log(`[CHAIN] ${m.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis} pred ${l.pred} mdl ${l.mdl})`).join(' · ')} · ε=${m.defect} (alg ${m.algDefect}) step=${_E.solSteps}`); return m; },
        chainSee: () => { const c = _chainSlots(); if (c.length < 2) return '[MU1] need ≥2 born slots'; const m = chainMeter(c, { G: GRID, through: true });
          console.log(`[CHAINSEE] ${m.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis})`).join(' · ')} · ε=${m.defect} · modes[${m.modes.join(',')}] step=${_E.solSteps}`); return m; },
        // S6 dual-layer holography verbs (replicated via mediumVirt → applied at the shared drain step):
        rec: (phi = 0) => injectEvent?.({ type: 'mediumVirt', mode: phi ? 'recvia' : 'record', amp: +phi }),
        store: () => injectEvent?.({ type: 'mediumVirt', mode: 'store' }),
        // recall(scale?) — zero-lag recall, optionally SCALE-SELECTIVE: 'coarse' lifts only the large-radius
        // (smooth skeleton) tiers, 'fine' only the small-radius (speckle detail), 'all' (default) the whole
        // moment. Exact by the tier-decomposition theorem (λ_merged = Σ λ_tier − (n−1)·lap9), not an
        // approximation — the ±T lift leg runs with the banded λ. Replicated (V's field is in eH).
        recall: (scale) => injectEvent?.({ type: 'mediumVirt', mode: 'recall', scale: (scale === 'coarse' || scale === 'fine') ? scale : 'all' }),
        recalla: () => injectEvent?.({ type: 'mediumVirt', mode: 'recalla' }),   // 𝔸-recall (descriptor-only; compare its [RECALL-𝔸] against recall's [RECALL-∠])
        // recallAt(x, y, opts) — RECALL AND PLACE. The classic verbs can only land a moment at the position it was
        //   STORED at (recall@) or wherever the cue currently is (recall⇄) — neither lets you say "bring that moment
        //   HERE". This passes an explicit at:[x,y] (leash coords, ±24) that overrides both. opts.mode picks which
        //   recall does the binding ('recall' zero-lag · 'recallx' shift-invariant · 'recallo' occluded-cue), and
        //   opts.slot targets the host. The placement is REPLICATED (it rides the verb entry) and the recalled slot's
        //   leash is seeded there, so descgo walks it on from that point.
        recallAt: (x = 0, y = 0, { mode = 'recall', slot, scale, frac, holoMode, block, seed } = {}) =>
          injectEvent?.({ type: 'mediumVirt', mode: ['recall', 'recallx', 'recallo'].includes(mode) ? mode : 'recall',
            at: [+x, +y], ...(slot ? { src: slot } : {}), ...(scale ? { scale } : {}),
            ...(frac != null ? { frac: +frac, holoMode: holoMode | 0, block: block | 0, seed: seed | 0 } : {}) }),
        // livePlateAt(i, x, y, slot) — the plate-lift path with explicit placement (mu1.livePlate + a position).
        livePlateAt: (i = -1, x = 0, y = 0, slot) => { const idx = (i | 0) >= 0 ? Math.min(i | 0, _plates.length - 1) : (_plates.length - 1); if (idx < 0) return '[LIVEPLATE] no plates (store first)';
          const ti = slot != null ? SLOTN.indexOf(String(slot)) : _plvSlotIdx();
          if (!(ti >= 1 && ti <= 3)) return '[LIVEPLATE] pick a host slot: V, P1 or P2';
          injectEvent?.({ type: 'mediumVirt', mode: 'platelive', gx: idx, src: SLOTN[ti], at: [+x, +y] }); _viewSlot = ti; _plateView = -1;
          return `[LIVEPLATE] plate ${idx + 1} → ${SLOTN[ti]} at (${x},${y}) — placed, not at its stored position`; },
        // recallo({mode, frac, block, seed}) — OCCLUDED recall: mask W to a PARTIAL image, bind the FRAGMENT against
        // the full bank, lift the WHOLE plate. The "break the hologram, still reconstruct the whole scene" demo — the
        // one property a hologram has that a literal photograph does not. mode: 7 rand-zero (default) · 8 rand-noise ·
        // 6 half-plane · 5 box · 1 low-pass · 2 high-pass · 3 conjugate. frac = how much is removed (0..1); block =
        // random-block px (7/8); seed = reshuffle. Sweep frac and watch [MU1-RECALL⊘]: reconstruction fidelity stays
        // high, degrading GRACEFULLY (the holographic signature). All replicated (occluded cue → V's field is in eH).
        recallo: ({ mode = 7, frac = 0.5, block = 8, seed = 0, src } = {}) =>
          injectEvent?.({ type: 'mediumVirt', mode: 'recallo', holoMode: mode | 0, frac: +frac, block: block | 0, seed: +seed, ...(src ? { src } : {}) }),
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
        recallx: (scale) => injectEvent?.({ type: 'mediumVirt', mode: 'recallx', scale: (scale === 'coarse' || scale === 'fine') ? scale : 'all' }),
        // region(spec) — THE TWO-BROWSER SHARD (descent rung 2, live): this tab's mirror integrates physics ONLY
        // in its region; outside = the register's declaration (locally computed → the reflector is UNTOUCHED — no
        // peer exchange, ordinary replicated inputs only). PEER-LOCAL view dial: tab 1 mu1.region('left'), tab 2
        // mu1.region('right') → one world, GPU per tab ≈ halved, seams declaration-anchored (watch seam-glue in
        // shardDemo(on) — a peer-local SANDBOX to see the GENUINE local-to-global shard live. The production
        // fractal kernel is too big-ring for x-space regional stepping (declaration-only there = ownership,
        // exact interior, no real gluing). This overrides THIS PEER's kernel with a SMALL ring (reach 3) so
        // regionStepX actually shards COMPUTE (cost ∝ |R|), the outside is a FROZEN declared boundary the
        // interior reads, and the seam genuinely DIVERGES — the real Čech gluing, measurable (seam-glue < 1).
        // ⚠ eH will NOT match a non-demo peer (this is a local physics sandbox, by design). Turn off to rejoin
        // the shared kernel. Then: mu1.shardDemo(true); mu1.region('left') — watch [SHARD] seam-glue drop.
        shardDemo: (on = true) => { if (!on) { _shardDemoRing = null; return '[SHARD-DEMO] OFF — rejoining the shared fractal kernel (eH matches peers again next kernel bump)'; }
          const ringO = [3, 0, 2, 2, 0, 3, -2, 2, -3, 0, -2, -2, 0, -3, 2, -2];   // reach 3, 8 terms — passes the x-space economy gate
          _shardDemoRing = { r: [3], w: [0.4], o: [ringO] };
          return '[SHARD-DEMO] ON — this peer\'s kernel forced to a SMALL ring (reach 3) so mu1.region() runs the GENUINE x-space shard (cost ∝ |R|, frozen boundary, diverging seam = real Čech gluing). ⚠ eH will NOT match non-demo peers (local physics sandbox). Now: mu1.region(\'left\'). shardDemo(false) to rejoin.'; },
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
          return `[REGION] shard=${_mirRegionName} · ${viaMirror ? 'MIRROR path (the GPU witness integrates only R; outside = the 𝔸 declaration)' : W.desc ? 'LIVE shard: this peer OWNS only R (outside = frozen declared boundary; two-browser split tab1 left + tab2 right = one world, reflector untouched). Interior deep-exact, SEAM approximate (~3·reach/step inward, held near-exact by the pin + seam-glue meter — NOT whole-region exactness). On this LIVE fractal kernel the shard is DECLARATION-ONLY: whole spectral step + outside frozen → regional OWNERSHIP but GLOBAL FLOPs (spectral engines can\'t shard compute; only small-reach kernels get x-space cost∝|R|). eH SHARD-SCOPED (regH = shared contract)' : 'waiting: needs ⌀PDE'} · peer-local`; },
        // coverTest() — DESCENT RUNG 1.5, live: run the cover law on the REAL current field. (1) cocycle: a 2×2
        // cover + glue vs the whole-torus step — must be BIT-FOR-BIT; (2) the spatial fork-finder: clean overlaps
        // ≡ 0, then a deliberately tainted halo cell must light up localized. Peer-local meter (~100ms CPU), no
        // state touched. A pass here means the live medium is SHARDABLE as-is: assigning these patches to peers
        // + shipping halos is wire engineering, not physics.
        // linear(mode) — 0/false = full nonlinear · 1/'free' = free linear (disperses) · 2/'trap' = linear
        // SHARP TRAP (symbol held sharp by the LINEAR injection lock + linear damping, zero nonlinearity).
        linear: (mode = 2) => { const m2 = mode === 'trap' ? 2 : mode === 'free' ? 1 : mode === true ? 1 : mode === false ? 0 : Math.max(0, Math.min(2, mode | 0));
          injectEvent?.({ type: 'mediumVirt', mode: 'linonly', amp: m2 });
          return `[LINEAR] mode=${m2} — ${m2 === 0 ? 'full nonlinear medium' : m2 === 1 ? 'FREE linear (disperses — nonlinearity-makes-the-soliton proof)' : 'LINEAR SHARP TRAP: the symbol held by a linear injection lock + linear damping, ZERO nonlinearity (linear holography). Replicated (eH-affecting).'}`; },
        turbo: (on = true) => { injectEvent?.({ type: 'mediumVirt', mode: 'turbo', amp: on ? 1 : 0 });
          return `[TURBO] → ${on ? 'ON' : 'OFF'} injected (REPLICATED executor dial — every peer switches at the shared step; same map, same f32 grain, GPU-batched per Q block; cross-vendor GPUs may round differently — the CPU executor stays the universal-determinism path)`; },
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
        // sweepOcclusion({T, block, seed, mode, fracs}) — THE HOLOGRAPHIC-REDUNDANCY CURVE (the oracle's
        //   sweepOcclusion, on the ABSTRACT spectral leg). For each occlusion fraction, run W's CURRENT field through
        //   the SAME sandwich the plate/lift use, with the occluder BETWEEN the legs:
        //       ψ →(+T spread)→ HOLOGRAM →(occlude frac)→ →(−T converge)→ reconstruction
        //   and log corr(reconstruction, ψ). Reports SPREAD = corr(holo,ψ) (how delocalized T made the plate — the
        //   thing that WOULD buy redundancy) and the score curve. THE SHAPE IS THE ANSWER:
        //     • falloff tracking `kept` → PHOTO-like: partial loss = partial image
        //     • graceful/sublinear      → HOLOGRAPHIC: the fragment still carries the whole
        //   T is the SPREAD DEPTH — the exact abstract twin of the oracle's tSteps. HONEST FINDING (measured G=128,
        //   DT=0.12): raising T DELOCALIZES the plate (spread corr 0.97→0.10, participation ratio 6%→46% by T~350),
        //   and the reconstruction improves with it — exactly the oracle's behavior.
        //   ⚠ THE METRIC IS THE TRAP (a real bug this diagnostic used to have): judging by ampCorr alone made high-T
        //   recovery look like FAILURE and produced a string of wrong conclusions ("flat in T", "needs nonlinearity",
        //   "spread ≠ redundancy"). ampCorr is a NORMALIZED inner product: it punishes the energy the mask removed and
        //   the speckle it added even when the SHAPE is perfectly recovered. MEASURED at frac=0.90, T=350: ampCorr
        //   0.246 (reads as failure) but the object's strokes are 2.04× brighter than background — the letter is
        //   plainly VISIBLE, just dim (energy ≈ kept ≈ 6%, exactly as a 90% mask implies). HOLOGRAPHIC RECOVERY
        //   RESTORES STRUCTURE, NOT ENERGY. So this reports CONTRAST (on-strokes ÷ off-strokes) as the primary score,
        //   with ampCorr alongside for reference. >1.5 VISIBLE · ~1.15 faint · ~1 lost.
        //   NOTE both legs here are LINEAR — so is the oracle's (`stepEyeN is LINEAR: no SPM in the round-trips`);
        //   the linear ±T propagation IS the holographic mechanism, no nonlinearity required.
        //   `nl:true` adds a SECOND, different mechanism on top: the −T leg becomes recall's own step (pin→−1→SPM→cap),
        //   so the ATTRACTOR pulls a fragment back onto the stored soliton (basin convergence) — extra robustness at
        //   the cost of clean fidelity (it relaxes to the DRESSED attractor, not the exact input). Target attractor:
        //   `att` opt, else the plate the cue BINDS to, else the clean spread hologram. Pure CPU; MUTATES NOTHING.
        sweepOcclusion: ({ T, block = 8, seed = 0, mode = 7, nl = false, att = null, fracs = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9] } = {}) => {
          const src = W.field || W.descBase || ((V.born && V.mirror) ? V.field : null);
          if (!src) return '[SWEEP⊘] no field (⌀PDE: start a mirror, or record W first)';
          if (!_lambda()) return '[SWEEP⊘] no λ grid yet (let the ring settle)';
          const Ts = (T != null) ? [T | 0] : [_VIRT_T, Math.max(_VIRT_T * 8, 128)];   // default: the recall depth vs a DEEP spread
          const modeName = { 1: 'low-pass', 2: 'high-pass', 3: 'conjugate', 5: 'box', 6: 'half-plane', 7: 'rand-zero', 8: 'rand-noise' }[mode] || 'rand-zero';
          // STRUCTURE metric (the one that matches WHAT YOU SEE): mean |recon| ON the object's strokes vs OFF them.
          //   ampCorr alone is MISLEADING here — it is a NORMALIZED inner product, so it punishes the energy the mask
          //   removed and the speckle it added even when the object's SHAPE is perfectly recovered. A 90%-occluded
          //   plate can reconstruct a clearly VISIBLE letter (contrast ≈2) while ampCorr reads ~0.25 and looks like
          //   failure. Holographic recovery is about restoring STRUCTURE, not energy — so report both.
          //   contrast > 1 = the object is visible above background; ~1 = indistinguishable (true failure).
          // STRUCTURE SCORE = the normalized correlation of the AMPLITUDE patterns, |rec| vs |ref| (Pearson, mean-
          //   removed). This is what the eye judges: "is the object's SHAPE there?", independent of overall brightness
          //   and of the phase speckle a mask introduces. 1 = the shape is perfectly recovered, 0 = no relation.
          //   WHY NOT an on/off contrast RATIO (the previous attempt, now discarded): the object is SPARSE (~3% of
          //   cells on-stroke) and a clean reconstruction has an EXACTLY-ZERO background, so the ratio blows up (1e14)
          //   and had to be floored — making the clean row an artifact. Worse, a ratio is SCALE-FREE: at low T the
          //   surviving speckle is faint but sits on the strokes, so the ratio stays huge while the image fades toward
          //   nothing — which is why T=16 looked "better" than T=350 when it is not. Pearson on |ψ| has neither flaw.
          const _struct = (rec, ref) => { if (!rec || !ref) return 0;
            let ma = 0, mb = 0; const a = new Float64Array(N_CELLS), b = new Float64Array(N_CELLS);
            for (let p = 0; p < N_CELLS; p++) { a[p] = Math.hypot(rec[p * 2], rec[p * 2 + 1]); b[p] = Math.hypot(ref[p * 2], ref[p * 2 + 1]); ma += a[p]; mb += b[p]; }
            ma /= N_CELLS; mb /= N_CELLS;
            let num = 0, da = 0, db = 0;
            for (let p = 0; p < N_CELLS; p++) { const x = a[p] - ma, y = b[p] - mb; num += x * y; da += x * x; db += y * y; }
            const den = Math.sqrt(da * db); return den > 0 ? num / den : 0; };
          // the NONLINEAR backward leg = recall's own _regStep1 run T times: pin toward `tgt` (0.15·att, the injection
          //   lock) → linear −1 step → SPM phase → cap at e0. Identical primitive to the engine's live step (no fakery).
          const nlBack = (f, Td, tgt, e0) => { let p = Float64Array.from(f); const b = 0.15;
            for (let s = 0; s < Td; s++) {
              if (tgt) for (let j = 0; j < p.length; j++) p[j] += b * tgt[j];                    // pin (injection lock)
              const ev = _specLeg(p, 1, -DT); if (!ev) return null;                              // linear −1
              const nb = new Float64Array(ev.length);
              for (let j = 0; j < N_CELLS; j++) { const re = ev[j * 2], im = ev[j * 2 + 1], I = re * re + im * im, th = _SOL_GAMMA * I / (1 + I / _SOL_ISAT) * DT, c = Math.cos(th), sn = Math.sin(th); nb[j * 2] = re * c - im * sn; nb[j * 2 + 1] = re * sn + im * c; }   // SPM
              let e2 = 0; for (let j = 0; j < nb.length; j++) e2 += nb[j] * nb[j];               // cap at e0
              if (e0 > 0 && e2 > 0) { const g = Math.sqrt(e0 / e2); for (let j = 0; j < nb.length; j++) nb[j] *= g; }
              p = nb;
            }
            return p; };
          for (const Td of Ts) {
            const holo = _specLeg(src, Td, DT); if (!holo) continue;   // +T: spread ψ into the hologram (the plate)
            const spread = _ampCorr(holo, src);
            let e0 = 0; for (let j = 0; j < holo.length; j++) e0 += holo[j] * holo[j];
            // the nl target: an explicit att, else the plate the CLEAN cue binds to (recall's real target = pl.a), else holo
            const tgt = nl ? (att || (() => { const bd = _plates.length ? _holo.bind(src) : null; return (bd?.plate?.a) || (bd?.plate && _plateAtt(bd.plate.dop, bd.plate.pos || [0, 0], bd.plate.obj)) || holo; })()) : null;
            const legName = nl ? `NONLINEAR pinned (recall's step, pin→−1→SPM→cap)${att ? ' · att=given' : _plates.length ? ' · att=bound plate' : ' · att=self-holo'}` : 'linear (control)';
            const rows = fracs.map((fr) => {
              const occ = fr > 0 ? occlude(holo, { mode, frac: fr, block, seed, G: GRID }) : holo;   // break the spread hologram
              const kept = keptFraction(holo, occ);
              const recon = nl ? nlBack(occ, Td, tgt, e0) : _specLeg(occ, Td, -DT);   // −T: converge back → the reconstruction
              const score = recon ? _ampCorr(recon, src) : 0;
              const st = recon ? _struct(recon, src) : 0;   // STRUCTURE: is the object's SHAPE recovered? (what the eye judges)
              const vis = st >= 0.5 ? 'VISIBLE' : st >= 0.2 ? 'faint' : 'lost';
              return `  frac=${fr.toFixed(2)} (kept ${(kept * 100).toFixed(0).padStart(3)}%): structure ${st.toFixed(3)} ${vis.padEnd(7)} · ampCorr ${score.toFixed(3)}  ${'█'.repeat(Math.round(Math.max(0, st) * 40))}`;
            });
            console.log(`[SWEEP⊘] ${modeName} occlusion @ T=${Td}${Ts.length > 1 ? (Td === Ts[0] ? ' (LOW spread depth)' : ' (HIGH spread depth)') : ''} · spread corr(holo,ψ)=${spread.toFixed(2)} (lower = more delocalized plate) · leg=${legName} (1=perfect recon):\n` + rows.join('\n'));
          }
          console.log(`→ READ THE STRUCTURE COLUMN. structure = Pearson correlation of the AMPLITUDE patterns |recon| vs |ψ| — "is the object's SHAPE recovered?", which is what the eye judges. ≥0.5 VISIBLE · ≥0.2 faint · ~0 lost. ampCorr (the complex normalized inner product) is shown alongside but is MISLEADING alone: it punishes the energy the mask removed and the phase speckle it added even when the shape is intact. HOLOGRAPHIC RECOVERY RESTORES STRUCTURE, NOT ENERGY — a heavily occluded plate legitimately yields a DIM image whose SHAPE is still right. Compare T values: more spread (lower spread corr) = the object is delocalized over more of the plate = a fragment carries more of the whole.`);
          if (nl) console.log(`→ nl leg = recall's own step (pin→−1→SPM→cap): the ATTRACTOR pulls a fragment back onto the stored soliton (basin convergence) — a SECOND recovery mechanism on top of the propagation, at the cost of clean fidelity (it relaxes to the DRESSED attractor, not the exact input).`);
          return '[SWEEP⊘] done';
        },
        // autoClose(on) — the boot-default arm: ON (default) = a fresh leader closes the register after dressing;
        // OFF (call it early, e.g. from the console right after load) = classic physics stays the default.
        autoClose: (on = true) => { _autoClose = !!on; if (!on) _turboArmed = false; return `[MU1-BOOT] auto-close ${on ? 'ARMED' : 'OFF (classic physics default; GPU-executor auto-arm also disabled)'}`; },
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
        frameLock: (on = true, grid = 21) => { _frameLock = !!on; _frameLockGrid = Math.max(Q, Math.round((grid | 0) / Q) * Q); if (!on) { _dispW = null; _dispV = null; _dispDesc = [null, null, null, null]; _dispDescK = [-1, -1, -1, -1]; _lastPaintSig = ''; }   // drop the desc lock films too — a stale one would keep painting after unlocking
          return `[FRAMELOCK] ${on ? `ON — the shared film at every ${_frameLockGrid} steps (grid=${Q} ≈ 8fps · grid=21 bars ≈ 2.7fps) · SUBTICK-DRIVEN paint (one paint per shared index; rAF = polling only) · film@k stamped: identical k ⇒ identical pixels across peers` : 'OFF — smooth peer-local sampling of the shared trajectory (every frame is STILL a shared-film member; only the index is peer-sampled)'}`; },
        // subtickView(on) — the SUBTICK-DRIVEN RENDERER, named: frameLock at the finest shared grid (Q) + paint
        // gating. The canvas paints exactly the shared-boundary film, at most one paint per index — paint content
        // AND order are pure functions of shared time on every peer. The mirror under subtickView = the identical
        // physics film on every same-GPU peer, byte-for-byte, nothing exchanged, nothing verified.
        subtickView: (on = true) => window.mu1.frameLock(on, Q),
        // fieldView(mode) — LOCAL display decomposition of the state: 'full' = ψ (default) · 'residual' = ψ−A
        // (the MEDIUM'S OWN response: dressing/halo/wake with the injected symbol subtracted) · 'bare' = A (the
        // injected symbol alone, no dressing). Exact & honest — A and ψ are real components; peer-local view.
        fieldView: (mode = 'residual') => { _fieldView = _FVIEWS.includes(mode) ? mode : 'residual';
          const a = _attForSlot(_viewSlot), f = _sb.slots[_viewSlot]?.descDisp || _sb.slots[_viewSlot]?.descBase || _sb.slots[_viewSlot]?.field;
          let diag = '';
          if (a && f && a.length === f.length) { let dA = 0, dF = 0, pa = 0; for (let j = 0; j < f.length; j++) { dA += a[j] * a[j]; dF += f[j] * f[j]; pa += f[j] * a[j]; }
            const c = dA > 0 ? pa / dA : 0; let dR = 0; for (let j = 0; j < f.length; j++) dR += (f[j] - c * a[j]) ** 2;   // projected residual = ψ − (⟨ψ,A⟩/⟨A,A⟩)·A
            diag = ` · symbol coeff ⟨ψ,A⟩/⟨A,A⟩=${c.toFixed(3)} · |ψ|²=${dF.toFixed(1)} |ψ−proj_A(ψ)|²=${dR.toFixed(1)} (oscillating residual ${dR > 0.01 * dF ? 'HAS content ✓' : '≈0 — ψ∥A, no dressing yet (raise β / let it dress)'})`; }
          else diag = ` · ⚠ A=${a ? 'ok' : 'NULL'} ψ=${f ? 'ok' : 'NULL'}${a && f ? ` len ${a.length}≠${f.length}` : ''} — projection can't run`;
          return `[FIELD-VIEW] ${_fieldView} — ${_fieldView === 'full' ? 'the whole field ψ' : _fieldView === 'residual' ? 'ψ − proj_A(ψ): the symbol PROJECTED OUT → only the medium\'s own oscillating dressing (halo/wake/SPM)' : 'A: the injected symbol alone'} · local display (not in eH)${diag}`; },
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
        // charges() — THE REGISTER'S CHARGE SHEET: every certified symmetry-sector charge each slot carries,
        // one line per slot, organized by GATE (doc §4). Not a new computation — it ASSEMBLES what the register
        // already holds (∠/ω from the U(1) descriptor, pose from translation, V/V̈/I from the sl(2) tier, H the
        // regime) into the one honest summary the register-experiment was built around. Conserved charges (I,
        // H under free flight) flagged. Peer-local read (pure fn of register state). The group-theory ledger,
        // live: this is what a worldline IS — a point carrying the charges of the symmetries the gates certified.
        charges: (slot) => { const rows = []; const targets = slot ? [SLOTN.indexOf(String(slot))] : [0, 1, 2, 3];
          for (const si of targets) { if (si < 0) continue; const s = _sb.slots[si]; if (!(s.born || si === 0)) continue;
            const op = _lensOp[si], live = s.desc && (si === 0 || s.descLive);
            const sl2 = si === 0 ? W.sl2 : null;   // the sl(2) tier is W-resident (the driven worldline); other slots carry the U(1)+translation charges
            const row = { slot: SLOTN[si], mode: si === 0 ? (W.desc ? '⌀register' : 'field') : s.desc ? (s.descLive ? 'living' : s.mirror ? 'mirror' : 'parked') : '—',
              // U(1) sector (gate: phase register): ∠ the phase charge, ω its precession rate, β the pin stiffness
              U1: { angle: +lensU1.wrap(lensU1.angle(op)).toFixed(3), omega: +(op.omega || 0).toFixed(3), beta: +(op.beta ?? 1).toFixed(2) },
              // translation sector (gate B: exact-symbol transport): the leash pose = the position charge
              translation: [+s.leash.state.gx.toFixed(2), +s.leash.state.gy.toFixed(2)],
              // worldline proper time (§7.5): the slot's own τ-beat count
              tau: _tauK ? (_tauK.beatsOf(SLOTN[si]) ?? 0) : 0 };
            // sl(2,ℝ) sector (gates E/F) — W only (the living driven worldline carries the dynamical charges)
            if (sl2) row.sl2 = { V: +sl2.V.toExponential(3), Vdd: +sl2.vdd.toExponential(3), I: +sl2.I.toExponential(3), m: +sl2.m.toFixed(2) };
            rows.push(row); }
          const _hr = _vptRead(); const H = _hr ? _hr.H : (_vptLast ? _vptLast.H : null);   // compute H fresh (the register engine's live field), not just the 4-bar-cached watch value
          console.log('[CHARGES] the register\'s certified symmetry charges (doc §4) — what each worldline carries:');
          for (const r of rows) console.log(`  ${r.slot} (${r.mode}): U(1) ∠${r.U1.angle} ω${r.U1.omega} β${r.U1.beta} · pos(${r.translation[0]},${r.translation[1]}) · τ=${r.tau}${r.sl2 ? ` · sl(2) V=${r.sl2.V} V̈=${r.sl2.Vdd} I=${r.sl2.I}(Casimir, conserved on free flight) m=${r.sl2.m}` : ''}`);
          if (H != null) { const vdd = rows[0]?.sl2?.Vdd;
            // H and V̈ are DIFFERENT charges: H = total energy (kinetic + saturable potential); V̈ = the second
            // moment's curvature. The simple "H<0⇒collapse" rule holds ONLY in the pure quadratic sector (where
            // V̈=4DH); a saturable/pin-held state leaves that sector, so H and V̈ can DISAGREE — H>0 (energetically
            // would spread) while V̈<0 (width would initially contract) is a real, non-contradictory state. Report
            // each honestly; flag when they part ways rather than let the sheet imply one fate.
            const agree = vdd == null || (H < 0) === (vdd < 0);
            console.log(`  H=${H.toExponential(3)} (total energy = kinetic + saturable potential; conserved on free flight)${vdd != null ? ` · V̈=${(+vdd).toExponential(2)} (2nd-moment curvature)${agree ? ` — AGREE: ${H < 0 ? 'both say collapse-if-freed' : 'both say spread-if-freed'}` : ' — ⚠ DISAGREE: H and V̈ part ways (state is OUTSIDE the quadratic sector where V̈=4DH — energy vs width give different fates; both honest, neither is "the" answer)'}` : ''}); regH=${_regH()} (the whole determinism contract)`); }
          console.log('  sectors: U(1) phase (write-fidelity≈1) · translation (gate B ≤0.2%) · sl(2,ℝ)/Casimir (gate F, waist to 0.1%) — each a MEASURED gate, not a decree');
          return { charges: rows, H, regH: _regH() }; },
        // sl2() — the REGISTER-RESIDENT sl(2) charges (⌀PDE): what the register asserts about V/V̈/I with zero
        // field reads, vs the witness if a mirror is running. The meta-circular claim made inspectable.
        sl2: () => { if (!W.desc) return '[SL2] field mode — the witness IS the state; the register tier lives in ⌀PDE';
          if (!W.sl2) return '[SL2] no tier yet (compiles at the wabs/autoc door, or lazily next frame)';
          const r = _vptRead();
          console.log(`[SL2] REGISTER: V=${W.sl2.V.toExponential(3)} V̈=${W.sl2.vdd.toExponential(3)} I=${W.sl2.I.toExponential(3)} (kv=${W.sl2.kv}, m=${W.sl2.m.toFixed(2)}) · aging law: HELD ⇒ stationary (arrest, measured) · freed ⇒ ${W.sl2.vdd > 0 ? 'spreads (V̈>0)' : 'focuses/collapses (V̈<0)'}${r ? ` · WITNESS: V=${r.V.toExponential(3)} Δ=${(100 * (r.V / W.sl2.V - 1)).toFixed(1)}%` : ' · no witness (pure ⌀PDE — the assertion stands unverified, by design)'}`);
          return { reg: W.sl2, wit: r ? { V: r.V, I: r.I } : null }; },
        // holdId(slot) — MEDIUM SEMANTICS for a ψATT hold. After adoption `obj` is retired (that was the foreign
        // name); this asks the medium itself what it is carrying, in the charges the anchors cannot move. Use it to
        // separate the two failure modes of a stalled recall: dV≈0 + gap>0 = the same state, transport short;
        // dV moving = the pin+SPM built something else. Identity CHECK only — ~3 invariants cannot regenerate a field.
        // rbTrace(secs) — WHO forces the GPU readbacks? readPixels is a hard pipeline stall (profiled at 91.8% of
        //   frame time with 3 living slots on two peers); with two browsers on one GPU each stall drains the SHARED
        //   queue, so it degrades superlinearly in peers and vanishes when one browser closes. This counts the calls
        //   per slot and attributes each to its caller, so the fix targets the real source instead of a guess.
        rbTrace: (secs = 5) => { _rbTrace = true; _rbN = [0, 0, 0, 0]; _rbSrc = {}; _rbT0 = performance.now();
          setTimeout(() => { _rbTrace = false; const dt = (performance.now() - _rbT0) / 1000;
            const tot = _rbN.reduce((a, b) => a + b, 0);
            console.log(`[RB] ${tot} readbacks in ${dt.toFixed(1)}s = ${(tot / dt).toFixed(1)}/s · 128KB each ⇒ ~${(tot / dt * 0.128).toFixed(1)} MB/s of pipeline-stalling transfer`);
            console.log(`[RB] per slot: ${SLOTN.map((nm, i) => `${nm}=${_rbN[i] | 0} (${(_rbN[i] / dt).toFixed(1)}/s)`).join(' · ')}`);
            const src = Object.entries(_rbSrc).sort((a, b) => b[1] - a[1]);
            console.log(`[RB] by caller:`); for (const [k, v] of src) console.log(`       ${String(v).padStart(5)}  ${(100 * v / (tot || 1)).toFixed(0).padStart(3)}%  ${k}`);
            console.log(`[RB] viewSlot=${SLOTN[_viewSlot]} viewAll=${_viewAllOn} living=${_sb.slots.map((s2, i) => (i === 0 || s2.descLive) && s2.desc ? SLOTN[i] : null).filter(Boolean).join(',')}`);
          }, Math.max(1, secs) * 1000);
          return `[RB] tracing readbacks for ${secs}s — leave the tab focused and let it run`; },
        holdId: (slot) => { const raw = [];
          for (let i = 0; i < _sb.slots.length; i++) { const s2 = _sb.slots[i];
            if (!s2?._attHold) continue;
            if (s2._digestLeft > 0) { console.log(`[\u03c8ATT-ID] ${SLOTN[i]}: DIGESTING (${s2._digestLeft} bars left) \u2014 the pin is lifted, nothing adopted yet`); continue; }
            if (_turboOn && _gpu && !(i === 0 && _shardXspace)) _tbSyncSlot(i);   // TURBO: the GPU holds truth — read back BEFORE _mkSl2, else this reports stale bytes for any slot that isn't on screen
            const d = _holdDrift(i); if (!d) { console.log(`[\u03c8ATT-ID] ${SLOTN[i]}: held, but no charges yet (needs a live descBase + ring)`); continue; }
            raw.push({ slot: SLOTN[i], ...d }); }
          // the common mode is measured over ALL holds (a stationary slot is the control), then each row is judged
          // differentially \u2014 even when the caller asked about one slot, because the control must not be filtered out.
          const cm = _holdCommon(raw), com = (cm.ok ? cm.com : null);
          const rows = slot ? raw.filter((r) => r.slot === slot) : raw;
          for (const r of rows) console.log(`[ψATT-ID] ${r.slot}: V=${r.V.toExponential(3)} (settled ref ${r.Vref.toExponential(3)}, dV=${(100 * r.dV).toFixed(2)}%${com != null ? `, common-mode ${(100 * com).toFixed(2)}% → differential ${(100 * (r.dV - com)).toFixed(2)}%` : ''}) · I=${r.I.toExponential(3)} (ΔI=${r.dI.toExponential(2)} — the sl(2)-work pin+cap spend to hold it; 0 would be free flight)${r.gap != null ? ` · gap=${r.gap.toFixed(2)}px` : ''} → ${_holdVerdict(r, cm)}`);
          if (cm.n > 1 && !cm.ok) console.log(`[ψATT-ID] control CONTRADICTED: ${cm.n} stationary slots span ${(100 * cm.spread).toFixed(2)}% (> ${(100 * _HOLD_SPREAD).toFixed(0)}%). Stationary slots holding the same content should relax ALIKE — when they do not, one of them has not settled (its reference was taken mid-transient) and there is no shared mode to subtract. No differential verdict is issued.`);
          else if (cm.ok && cm.n > 1) console.log(`[ψATT-ID] control: ${cm.n} stationary slot(s) agree to ${(100 * cm.spread).toFixed(2)}%, common mode ${(100 * cm.com).toFixed(2)}% — that much drift is RELAXATION (the state settling off its f32 byte-freeze), not identity loss. Only the differential is transport/identity information.`);
          else if (cm.ok && cm.n === 1) console.log(`[ψATT-ID] control: 1 stationary slot sets the common mode at ${(100 * cm.com).toFixed(2)}% — a single control cannot be cross-checked, so the subtraction is taken on trust. A second stationary hold would test it.`);
          else if (raw.length) console.log('[ψATT-ID] no stationary control (every hold is displaced) — verdicts are absolute and provisional: the relaxation common mode cannot be subtracted. Adopt a second, un-shifted slot to calibrate.');
          if (!raw.length) console.log('[\u03c8ATT-ID] no slot is holding \u2014 press \u03c8att to adopt (in probe mode the symbol is the foreign object, and `obj` already names it)');
          return rows; },
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
        // gpuDet(steps) — IS THE GPU PATH ITSELF DETERMINISTIC BETWEEN TWO WINDOWS ON ONE MACHINE?
        //   Everything the join can control is now verified identical between peers (ver, regH, attH/holdH, e0,
        //   descPhi0, pos, leash, parity, payload, kernel staging, plate, backlog) — yet argPin sits 0.02–0.04 rad
        //   apart, which is 3% of |pin|, far above the f32 floor and NOT explainable by SPM integrating the
        //   amplitude noise (that gives 1.7e-7 rad over 20k steps). The user tests both peers on the SAME machine
        //   and SAME GPU, so hardware/driver divergence is excluded too.
        //   This isolates the remaining unknown: build a field from a FIXED analytic recipe (no world state at all),
        //   upload it, run N engine steps with the CURRENT ring, and hash the result. Two windows must print the
        //   SAME hash. If they do, the GPU path is deterministic and the offset is still in state we have not
        //   compared. If they DIFFER, the medium cannot be phase-exact across contexts by construction, and the
        //   honest position is that argPin equality is not achievable — the lock, not fieldH, is the convergence
        //   measure (which is what the status line has claimed all along).
        //   Peer-local by design; run it in BOTH consoles and compare the printed hashes.
        //   THE RING MUST BE PINNED, NOT SAMPLED (2026-08-03). The first version hashed with the CURRENT ring and
        //   asked the user to run both windows "at the same ver" — impractical: the fractal clock advances ver
        //   continuously, so four runs came back at ver 127/258/125/253 and their differing outH proved nothing
        //   (a different ver IS a different propagator). Build a FIXED synthetic ring from the recipe below so the
        //   propagator is identical in both windows regardless of what the clock is doing. Now the ONLY difference
        //   between the two runs is the GPU context itself, which is exactly what the test is for.
        gpuDet: (steps = 21) => { if (!_gpu) return '[GPUDET] gpu not ready';
          const n2 = steps | 0, c = GRID / 2, sg = 8;
          // fixed 4-tier ring: radii 3,7,13,21 with equal weights, offsets = the integer circle at each radius.
          const _rr = [3, 7, 13, 21], _rw = _rr.map(() => 1 / _rr.length), _ro = _rr.map((r) => {
            const pts = []; const nA = Math.max(8, Math.round(2 * Math.PI * r));
            for (let a = 0; a < nA; a++) { const th = 2 * Math.PI * a / nA;
              pts.push(Math.round(r * Math.cos(th)), Math.round(r * Math.sin(th))); }
            return pts; });
          const f0 = new Float64Array(2 * N_CELLS);
          for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const dx = x - c, dy = y - c;
            const a = Math.exp(-(dx * dx + dy * dy) / (2 * sg * sg));
            if (a > 1e-12) { const i = (y * GRID + x) * 2, ph = 0.15 * dx; f0[i] = a * Math.cos(ph); f0[i + 1] = a * Math.sin(ph); } }
          const q0 = Float64Array.from(Float32Array.from(f0));   // f32-quantize so the UPLOAD is identical on both peers
          let e0q = 0; for (let j = 0; j < q0.length; j++) e0q += q0[j] * q0[j];
          const save = _gpu.readEyePsi(), liveRing = _E.ringCache;
          try { _gpu.setRings(_rr, _rw, _ro);   // PIN the propagator — see the note above
            _gpu.selectEyeSlot(null); (_gpu.setEyePsiBoth || _gpu.setEyePsi).call(_gpu, q0);
            const hUp = _hashField(_gpu.readEyePsi());
            for (let i = 0; i < n2; i++) { _gpu.stepEyeN(1, DT);
              _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); (_gpu.applyEyeEnergyCapNS || _gpu.applyEyeEnergyCap).call(_gpu, e0q); }   // always full-medium, so linMode cannot differ between windows
            const out = _gpu.readEyePsi(); let e2 = 0, sr = 0, si2 = 0;
            for (let j = 0; j < out.length; j += 2) { e2 += out[j] * out[j] + out[j + 1] * out[j + 1]; sr += out[j]; si2 += out[j + 1]; }
            const ringH = _hashNums([].concat(_rr, _rw, ..._ro));
            return `[GPUDET] ${n2} steps · FIXED seed + FIXED ring (nothing sampled from the world) · uploadH=${hUp} ringH=${ringH} · outH=${_hashField(out)} · |ψ|²=${e2.toPrecision(17)} · Σψ=${Math.atan2(si2, sr).toPrecision(17)} — uploadH and ringH MUST be equal in both windows (they are constants); if they are and outH DIFFERS, the GPU pipeline is not reproducible between contexts on this machine and cross-peer phase equality is unachievable by construction. If outH MATCHES, the GPU is exact and the argPin offset is still in state we have not compared.`;
          } catch (e) { return `[GPUDET] failed: ${e}`; }
          finally { try { if (liveRing?.r?.length) _gpu.setRings(liveRing.r, liveRing.w, liveRing.o); _gpu.setEyePsi(save); } catch (e2) {} } },
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
        lensTau: (w = 0.1, slot = 'W') => injectEvent?.({ type: 'mediumVirt', mode: 'lenstau', amp: +w, src: slot }),   // per-slot ω (each worldline ages at its own rate); defaults to W
        // regTrace(on) — the DETERMINISM GATE instrument: log [REGH] step=… regH=… fieldH=… on a SHARED cadence (every
        // 200 steps, a pure fn of the shared step so both peers log at the SAME step= values). Compare the two consoles:
        // regH MUST match line-for-line at equal step= (the contract); fieldH may differ (benign). Off by default.
        // detField(n) — how many DET ticks between FIELD-hash syncs. Each sync is a full 4-slot GPU readback and
        //   readPixels STALLS the pipeline; profiled at 40% of all readbacks with W/V/P1 living, and on a shared GPU
        //   two peers' stalls serialize against each other (the "lag when the 2nd browser is open" symptom).
        //   regH — the actual shared contract — needs no field bytes and rides EVERY tick regardless. n=1 restores
        //   the old per-tick behaviour for a fork hunt; the default 8 keeps the check while paying 1/8 the readbacks.
        // paintDet(n) — CAN'T COMPARE TWO BROWSERS BY EYE. Screenshots are taken tens of ms apart and `frac`
        //   advances continuously, so SOME visual difference is guaranteed even when everything is correct — the
        //   eyeball test cannot separate "peer-local sampling phase" from a real fork. This prints, every n bars,
        //   the exact RENDER INPUTS stamped with the SHARED index, so two peers are compared as NUMBERS AT EQUAL k:
        //     · frac/dphi/ox/oy — the sub-tick interpolation. These are PEER-LOCAL BY DESIGN (frac comes from each
        //       peer's own monClock sampling moment) and are EXPECTED to differ unless mu1.frameLock(true) is set
        //       on BOTH peers. A difference here is the smooth-glide window, not a fault.
        //     · fieldH — the hash of the bytes being displayed. This MUST match at equal k. If it differs, the
        //       state forked; if it matches while the picture differs, the difference is sampling phase only.
        paintDet: (n = 4) => { _paintDetEvery = Math.max(0, n | 0);
          return `[PAINT] ${_paintDetEvery ? `ON — every ${_paintDetEvery} bars. Compare peers at EQUAL k: fieldH MUST match (state); frac/dphi/ox/oy may differ (peer-local sampling) unless frameLock is on for both.` : 'OFF'}`; },
        // clockDet(n) — STEP-CLOCK FORK LOCATOR. Use when [TBSTEP] shows both peers stepping the SAME number of
        //   steps per block with cursors a CONSTANT distance apart (the "everything matches but they're at
        //   different steps" signature). That is never a byte fork: solSteps chases `target`, so it self-corrects
        //   unless `target` itself is offset — and target = floor((monClock − c0)·spp/rate). This prints every term
        //   of that equation, so a constant offset of N steps can be attributed to its cause instead of inferred:
        //     • monClock/rate match, c0 DIFFERS  → the join did not keep c0 verbatim. Δc0 = N·rate/spp. Look for a
        //       [RATEFLIP] line on one peer only (reanchor rewrites c0 by k·(ratePrev−r)/spp).
        //     • c0 matches, target differs        → the peers sampled the oscillating world clock on opposite
        //       phases; check monDir.
        //     • every term matches                → the offset is downstream of the clock (the turbo cursor).
        // forkDet(n) — THE BISECTOR. Everything else here samples a WINDOW (tbTrace) or the painted buffer
        //   (paintDet); this is the always-on one: at every n-th SHARED bar it syncs the slot's texture and hashes
        //   descBase. Turn it on BEFORE the join on both peers, let them run, then find the FIRST bar whose baseH
        //   differs — that bar brackets the fork to 21 steps, which is what no other instrument here gives you.
        //   Use when tbTrace shows identical inputs (attH/ringH/ver/cadence all matching) but descBaseH ALREADY
        //   different at the first traced block: that means the fork happened EARLIER and the trace is only
        //   watching two already-forked fields evolve correctly. Costs one readback per slot per n bars.
        //   YOU CANNOT ARM A JOINER "BEFORE THE JOIN" — mu1 does not exist until the app is up, and by then the
        //   restore has already run. So the JOIN ARMS IT ITSELF: _restoreSnap turns this on automatically (see
        //   _forkDetArm at the end of the restore), starting at the exact bar the joiner's own state begins. On the
        //   LEADER, which never restores, arm it by hand at any time — it is stateless per bar, so a leader armed
        //   late still emits the same hashes at the same bars and the two logs pair up by bar= regardless.
        //   So the real procedure is: arm the LEADER whenever you like, then just join. Both sides log from then on.
        // IS THE RESIDUAL A FORK OR THE GPU NOISE FLOOR? (2026-08-03) — the question left after the join was proven
        //   exact. Read the SHAPE of the argPin gap across many bars, not its value at one bar:
        //     • BOUNDED and OSCILLATING (wanders up and down, no trend)  ⇒ the f32 GPU floor. Two peers running the
        //       same register around the same attractor, out of step by accumulated rounding. This app's own status
        //       line already states fieldH "never goes byte-identical on GPUs — the lock is the honest convergence
        //       measure". Nothing to fix; compare `lock→A` instead, which should sit near 1 on both.
        //     • MONOTONE GROWING, or settling to a NON-ZERO CONSTANT                ⇒ a real residual fork; the pin
        //       is contracting the two peers toward DIFFERENT fixed points and some input still differs.
        //   Measured after the lensObj + parity fixes: 0.0071 → 0.0210 → 0.0255 → 0.0034 rad over four bars — i.e.
        //   oscillating, which is the first shape. Sample over dozens of bars before concluding either way.
        // mapDet(slot) — WHERE IN THE FIELD does it differ? Every other instrument here reduces the field to ONE
        //   number (a hash, |ψ|², argPin), which cannot distinguish "the whole field is rotated" from "one region
        //   is driven differently while the rest matches" — the reported symptom. This prints a coarse 4×4 tile map
        //   of |ψ|² and argPin over the PAINTED buffer, so the two peers' maps can be diffed tile by tile:
        //     • every tile differs by a similar small amount ⇒ global (phase/noise) — look at the drive
        //     • ONE or a FEW tiles differ, the rest match to ~1e-9 ⇒ genuinely regional. Note WHICH tiles: a
        //       contiguous block points at a scissor/region path, a scattered set at per-element reconstruction.
        //   Run on both peers at the same bar (it keys off the shared bar like [FORK]) and compare.
        mapDet: (slot = 'V', n = 8) => { _mapDetSlot = Math.max(0, SLOTN.indexOf(slot)); _mapDetEvery = Math.max(0, n | 0); _mapDetBar = -1;
          return `[MAP] ${_mapDetEvery ? `ON — ${SLOTN[_mapDetSlot]} every ${_mapDetEvery} bars, 4×4 tiles over the painted buffer. Compare peers TILE BY TILE at equal bar: a few differing tiles = regional, all differing = global.` : 'OFF'}`; },
        // kHold(bars) — JOIN-TIME TUNING for the kernel deferral. At a join whose kernelVer is older than
        //   kernelQueue can replay, the peer DEFERS (stops stepping) until a queued swap lands at its shared step,
        //   rather than cold-snapping the kernel at a peer-local frame (which permanently forks the propagator).
        //   This sets how long it will wait before giving up and snapping anyway — the stall guard, not the
        //   expected wait: a live fractal clock re-rings every few bars, so the release is normally quick.
        //     • RAISE it if you see `[JOIN-KHOLD] ⚠ TIMED OUT` (the clock is quiet; waiting longer costs only a
        //       frozen field, while snapping costs a permanent phase offset)
        //     • LOWER it if the join pause is too long to be usable and you would rather accept the offset
        //   Returns the current setting. Argument is in BARS (21 steps each); 0 disables the deferral entirely
        //   (restoring the old cold-snap behaviour, for A/B).
        // burstCap(steps) — THE argPin-OFFSET A/B. A joiner catches up its backlog at up to `steps` per frame; the
        //   leader ran those same steps at the steady-state cadence (one Q-block per _tbAdvanceAll call). att4 (the
        //   pin target) is captured ONCE PER CALL, so a big burst injects the pin against a target sampled far less
        //   often — same steps, same kernel, same bytes, different integration path. That is a phase difference at
        //   constant energy, established once during catch-up and then CONSERVED (nothing damps a global phase).
        //   Run `mu1.burstCap(7)` on BOTH peers before joining: if the residual argPin offset collapses, the call
        //   cadence is the mechanism and the fix is to make it shared (at the cost of join latency). Default 1024.
        kHold: (bars) => { if (typeof bars === 'number') _KHOLD_MAX = Math.max(0, (bars | 0)) * 21;
          return `[KHOLD] deferral limit = ${(_KHOLD_MAX / 21) | 0} bars (${_KHOLD_MAX} steps)${_KHOLD_MAX === 0 ? ' — DISABLED: a far-behind joiner cold-snaps the kernel at a peer-local frame and carries a permanent phase offset' : ''} · hold now: ${_kernHold ? `ACTIVE since k=${_kernHold.since} (ver=${_kernHold.ver}, waiting for ≥${_kernHold.need})` : 'none'}`; },
        forkDet: (n = 8, slot = 'V') => { _forkDetEvery = Math.max(0, n | 0); _forkDetSlot = Math.max(0, SLOTN.indexOf(slot)); _forkDetBar = -1;
          return `[FORK] ${_forkDetEvery ? `ON — ${SLOTN[_forkDetSlot]} every ${_forkDetEvery} bars. A JOINER arms this automatically at restore; arm the LEADER by hand (any time — lines pair by bar=). The FIRST bar where baseH differs brackets the fork to 21 steps.` : 'OFF'}`; },
        clockDet: (n = 4) => { _clockDetEvery = Math.max(0, n | 0); _clockDetBar = -1;
          return `[CLOCK] ${_clockDetEvery ? `ON — every ${_clockDetEvery} bars. Compare peers at EQUAL bar: monClock, rate and c0 MUST all match. A c0 difference of Δ is a PERMANENT target offset of Δ·spp/rate steps — that is the constant-offset [TBSTEP] signature.` : 'OFF'}`; },
        // wattDet(n) — ψATT FORK LOCATOR. Prints, at a SHARED bar, every input the pin target is built from, so two
        //   peers can be diffed line by line instead of guessing which term drifted. The target is
        //   _xattBuild(_holdOp(∠,φ0), _holdDx, _holdDy, _attHold); a fork in ANY of these forks the field, because
        //   the pin target is in regH. Run on both peers and compare at EQUAL bar=.
        wattDet: (every = 4) => { _wattDetEvery = Math.max(0, every | 0);
          return `[ψDET] ${_wattDetEvery ? `ON — every ${_wattDetEvery} bars, at the shared bar. Compare the two peers' lines at EQUAL bar=; the FIRST differing column is the fork.` : 'OFF'}`; },
        // syncDec(n, slot) — the LAST asymmetry: both peers now have identical tbCur/texStep, yet one peer's
        //   texSynced trails the other's by a Q-block on every row. This logs every _tbSyncSlot DECISION with its
        //   caller line, so the two peers can be diffed on WHICH call reaches the sync first inside the frame.
        syncDec: (n = 30, slot = 'V') => { _syncTraceLeft = Math.max(0, n | 0); _syncTraceSlot = Math.max(0, SLOTN.indexOf(slot));
          return `[SYNCDEC] logging ${_syncTraceLeft} sync decisions for ${SLOTN[_syncTraceSlot]} — compare the CALLER LINES and the SKIP/SYNC pattern between peers`; },
        // attCad(n, slot) — WHY IS W SMOOTH *AND* IDENTICAL WHILE V IS SMOOTH *AND* DIVERGENT? W's pin target
        //   (_regAttC) is rebuilt in the PER-STEP loop; a desc slot's descAtt is rebuilt only at the BAR. The film is
        //   captured every Q (7 steps). If V is stepped against a target that only refreshes every 21 steps, then
        //   WHICH Q tick you capture at changes the result — while W, whose target tracks every step, is insensitive
        //   to capture timing. This prints both cadences so the asymmetry is measured, not assumed.
        attCad: (n = 12, slot = 'V') => { _attCadLeft = Math.max(0, n | 0); _attCadSlot = Math.max(0, SLOTN.indexOf(slot));
          return `[ATTCAD] tracing ${_attCadLeft} target refreshes of ${SLOTN[_attCadSlot]} — BAR lines = a 21-step cadence; STEP lines (W) = per-step`; },
        // tbTrace(n, slot) — TURBO-LOOP step receipt. stepTrace only instruments the CPU executor, so it prints
        //   nothing under turbo. This hashes the slot's GPU TEXTURE after each advance block, next to descBase.
        //   Run on BOTH peers after a join: a joiner whose texH never moves while `cur→upTo` climbs is being stepped
        //   on paper only — the upload/parity bookkeeping is wrong, not the physics.
        // tbTrace(n, slot, from) — trace n turbo advance blocks. THE WINDOW PROBLEM (2026-08-03): with no `from`,
        //   tracing starts at the moment the verb is TYPED, which is a different wall-clock instant in each console
        //   — so the two peers capture DIFFERENT step windows of the same trajectory and there is no equal cur= to
        //   compare (measured: one peer 9597→9737, the other 9429→9569, zero overlap). Worse, the windows look
        //   "a constant N steps apart" and invite a divergence verdict when nothing is wrong.
        //   PASS `from` — a SHARED step — and both peers start tracing at the same cur, so every line pairs up:
        //     mu1.tbTrace(20, 'V', 12000)   ← run on BOTH peers with the SAME number, ahead of the current step
        //   Read the current step from any [CLOCK]/[PAINT]/[TBSTEP] line (solStep=/cur=) and pick a value a few
        //   hundred steps ahead; the returned string also prints where you are now and how far the target is.
        // k() — the current SHARED step. Every alignment argument in these instruments is expressed in it, and there
        //   was no way to read it: `mu1.tbTrace(20,'V',<shared step>)` left you to find a number with no accessor.
        k: () => _E.solSteps | 0,
        tbTrace: (n = 12, slot = 'W', from = null) => { _tbTraceLeft = Math.max(0, n | 0); _tbTraceSlot = Math.max(0, SLOTN.indexOf(slot));
          // A NEGATIVE `from` means "this many steps FROM NOW" — the usable form. Both consoles run the same call
          //   within a few seconds and resolve to the same absolute step (solSteps is shared), so the windows align
          //   without anyone reading a number off a log first. Absolute values still work; null = start immediately.
          const _rel = (typeof from === 'number' && from < 0);
          _tbTraceFrom = (from == null) ? -1 : (_rel ? ((_E.solSteps | 0) + Math.abs(from | 0)) : (from | 0));
          // round UP to a Q boundary: advances only ever land on multiples of Q, so an off-grid target would arm on
          //   the first block PAST it — which can be a different block in each window if they straddle the boundary.
          if (_tbTraceFrom > 0) _tbTraceFrom = Math.ceil(_tbTraceFrom / Q) * Q;
          return `[TBSTEP] tracing ${_tbTraceLeft} turbo advance blocks of ${SLOTN[_tbTraceSlot]}${_tbTraceFrom >= 0 ? ` STARTING AT SHARED STEP ${_tbTraceFrom} (now ${_E.solSteps}${_tbTraceFrom <= _E.solSteps ? ' — ⚠ ALREADY PAST: the trace starts immediately and the windows will NOT align; use a negative offset like -500' : `, ~${_tbTraceFrom - _E.solSteps} steps ≈ ${((_tbTraceFrom - _E.solSteps) / 21).toFixed(0)} bars away`})` : ' starting NOW — ⚠ the two consoles start at DIFFERENT steps, so the windows may not overlap; pass -500 (steps from now) as the 3rd arg to align them'} — run the SAME call in both consoles, then compare at EQUAL cur=, never by line position: descBaseH/attH/ringH must match`; },
        // primeTrace(n) — does the GPU actually RECEIVE the restored bytes? _tbPrime is the only upload path; this
        //   hashes what goes up and reads it straight back. A MISMATCH means turbo steps a texture the restore never
        //   wrote — the CPU executor is unaffected because it steps descBase directly, which is exactly the reported
        //   asymmetry (CPU join correct, turbo join wrong).
        primeTrace: (n = 8) => { _primeTrace = Math.max(0, n | 0); return `[PRIME] tracing the next ${_primeTrace} texture primes — reload the joiner with this armed`; },
        // stepTrace(n, slot) — BISECT THE DIVERGENCE. Every INPUT is now verified identical across peers (payload,
        //   ring content, register ops, cap, shared step) yet the fields differ. So the split happens INSIDE the
        //   stepping. This hashes a slot's descBase after EVERY engine step for n steps and prints (solStep, hash):
        //   run it on both peers, line up the solStep columns, and the FIRST step whose hash differs is the exact
        //   operation that forks — no more hypotheses, just the step index. Peer-local diagnostic; no state written.
        stepTrace: (n = 40, slot = 'V') => { _stepTraceLeft = Math.max(0, n | 0); _stepTraceSlot = Math.max(0, SLOTN.indexOf(slot));
          return `[STEP] tracing ${_stepTraceLeft} engine steps of ${SLOTN[_stepTraceSlot]} — compare the two peers at EQUAL solStep=; the first differing hash is the forking step`; },
        // drive() — READ-ONLY spiral check (the §7.44 question, at the readback layer). The mux spiral's signature is
        //   a backlog that KEEPS GROWING across seconds while todo pins at the cap; a fixed overhead shows a bounded,
        //   flat backlog. This reports the governor's own live measurement so the two can be told apart, and prints
        //   the tempo divisor (NOTE: mu1.tempo(n) is a SETTER — calling it bare injects tempo=2 on every peer).
        drive: () => { const r = { tempoDiv: _tempoDiv, autoTempo: _autoTempoOn, backlogMax: _at.bMax, backlogPrev: _at.bPrev,
            deficitMs: _at.defMs, headroomMs: _at.headMs, todoMax: _at.todoMax, viewSlot: SLOTN[_viewSlot],
            living: _sb.slots.map((s2, i) => ((i === 0 || s2.descLive) && s2.desc) ? SLOTN[i] : null).filter(Boolean) };
          console.log(`[DRIVE] tempoDiv=${r.tempoDiv}${r.tempoDiv > 1 ? ' ⚠ matter\'s clock is SLOWED (governor acted, or mu1.tempo(n) was called — mu1.tempo(1) restores)' : ''} · autoTempo=${r.autoTempo ? 'ON' : 'OFF'}`);
          console.log(`[DRIVE] backlog max=${r.backlogMax} prev=${r.backlogPrev} · todoMax=${r.todoMax}${r.todoMax >= 1024 ? ' ⚠ PINNED AT THE CAP — the spiral signature' : ''}`);
          console.log(`[DRIVE] deficit=${r.deficitMs}ms (≥4000 ⇒ the governor raises the divisor) · headroom=${r.headroomMs}ms · living=${r.living.join(',')} · view=${r.viewSlot}`);
          console.log(`[DRIVE] ⇒ ${r.todoMax >= 1024 || r.deficitMs >= 4000 ? 'SUPPLY < DEMAND: this is the §7.44 spiral shape, not a fixed cost — the readback stalls are eating the step budget.' : 'backlog BOUNDED: supply meets demand, so the readback cost is steady overhead, NOT a spiral. Throttle it, do not govern it.'}`);
          return r; },
        // film(on) — TEXTURE-DIRECT DISPLAY (default ON, 2026-07-30). OFF falls back to the old readback path
        //   (texture → readPixels → descBase → descDisp → upload) for an A/B comparison. The readback was profiled
        //   at 83–91% of all GPU readbacks and, because readPixels STALLS the pipeline, two peers on one GPU
        //   serialize on it — the "lag with a second browser open" symptom. Display-only: the film never re-enters
        //   the register, so this changes no physics and no determinism (descDisp was never in the contract).
        film: (on = true) => { _filmOn = !!on; _filmStep = [-1, -1, -1, -1]; _descTexKey = null;
          return `[FILM] texture-direct display ${_filmOn ? 'ON — the viewed slot renders straight from its GPU film + GPU-reduced peak; nothing is read back' : 'OFF — legacy readback path (readPixels per refresh)'}. mu1.rbTrace(5) to compare.`; },
        // dispRate(n) — Q-blocks between DISPLAY readbacks of the viewed slot. 1 = 3x/bar (smoothest, default),
        //   3 = 1x/bar. This is THE dominant GPU cost (83-91% of readbacks profiled); each readPixels stalls the
        //   pipeline and, on a shared GPU, two peers' stalls serialize. Purely render-side — descDisp is not in regH.
        dispRate: (n = 1) => { _dispEvery = Math.max(1, Math.min(21, n | 0));
          return `[DISP] film refresh every ${_dispEvery} Q-block(s) = ${(3 / _dispEvery).toFixed(1)}x/bar · readbacks scale by 1/${_dispEvery}. Try dispRate(3) with two peers and compare smoothness against the lag.`; },
        detField: (n = 8) => { _detFieldEvery = Math.max(1, n | 0);
          return `[DET] field-hash sync every ${_detFieldEvery} DET tick(s) — regH still every tick (that is the contract; the envelope hashes are the secondary check). Lower for a fork hunt, raise for speed.`; },
        regTrace: (on = true, every = 4) => { _regTraceOn = !!on; _detEvery = Math.max(1, every | 0); return `[DET] trace ${_regTraceOn ? `ON — every ${_detEvery * Q} steps · compare regH + solH across peers at equal solStep= (regTrace(true,1) = every ${Q} steps to find the first fork)` : 'OFF — field ENFORCEMENT dropped: W runs AS ITS OWN MIRROR (deterministic by construction, verified never; the register/regH stays the whole contract — the mirror-mode performance, on the live W canvas)'}`; },
        // pin(β) — the IMAGE-CONVERGENCE tuner (finding_pin_injection_lock): raise β to tighten lock→A. A tight lock means
        // each peer's ψ ≈ the shared attractor A ≈ every peer's ψ → the images converge (no field exchange, pure local
        // β IS PHYSICS, NOT A RENDER DIAL — REPLICATED (2026-08-03). The old comment here said "it's a local render
        //   dial, not replicated", and that was WRONG in a way that produced the reload-only V/P1/P2 mismatch:
        //   _pinBeta multiplies applyEyeSuperpose (ψ += β·att) at every step of every slot (see beta(), and the
        //   superpose calls in the drive), so it sets the INJECTION STRENGTH of the pin. Two peers at different β
        //   add a differently-scaled COMPLEX vector each step; the cap (a real scale) then restores amplitude
        //   exactly — leaving |ψ|² equal to float noise and the GLOBAL PHASE permanently offset. Measured: header
        //   β 0.25 on one peer vs 0.30 on the other, with ΔargPin 0.009–0.036 rad and Δ|ψ|² inside the f32 floor.
        //   regH never caught it because regH covers _lensOp[].beta (the per-slot refAmp, which IS replicated and
        //   DOES ride the snapshot as lensOps) — NOT this global multiplier. The effective strength is the product
        //   _pinBeta · _lensOp[i].beta, and only half of it was shared.
        //   Now stamped through the same replicated path as every other physics dial, so it lands at the identical
        //   shared step on every peer. It also rides the join snapshot (see takeSnap/restoreSnap `pinB`).
        pin: (b) => { if (typeof b !== 'number') return `[PIN] β=${_pinBeta.toFixed(2)} · lock→A now ${_E.lockNow.toFixed(3)} (→1 = images converge to the shared attractor)`;
          injectEvent?.({ type: 'mediumVirt', mode: 'pinbeta', amp: Math.max(0, Math.min(1, b)) });
          return `[PIN] β→${Math.max(0, Math.min(1, b)).toFixed(2)} REPLICATED (lands at the shared step on every peer; it scales ψ+=β·att, so an unshared β is a permanent global-phase fork)`; },
        // ⟲coevo(on) — the honest ℂ* EINSTEIN LOOP: matter's energy state throttles its own transport ("matter tells
        // geometry how far it may go"). ON = the leash advance is gated by a gain observable; OFF = open-loop (the target
        // never waits for matter — the pure DOP replay). Watch 'coevo g' in the status: 1 = matter kept up (full advance),
        // →0 = matter lagging (the target throttles/waits). Drag shiftX fast to see g dip and the target hold back.
        edge: (a = 'W', b = 'V', kap = 0.2) => { const ia = SLOTN.indexOf(String(a)), ib = SLOTN.indexOf(String(b));
          if (ia < 0 || ib < 0 || ia === ib) return '[EDGE] usage: mu1.edge("W","V",±κ) — slots W/V/P1/P2, κ∈[−0.5,0.5]; κ<0 = anti-align (frustration)';
          injectEvent?.({ type: 'mediumVirt', mode: 'edge', gx: ia, gy: ib, leak: +kap });
          return `[EDGE] ${SLOTN[ia]}⇄${SLOTN[ib]} κ=${(+kap).toFixed(2)} injected — TWO real couplings on this edge: (1) the XY/Kuramoto law on the register PHASES ([KUR]) AND (2) cross-slot ATTRACTOR MIXING (each slot's pin blends κ·the other's FIELD → the solitons visually DEFORM toward each other, κ>0 attract/blend, κ<0 repel — the U1 form of the old medium's β-mixing). K₃ frustration: edge(W,V,−.2); edge(W,P1,−.2); edge(V,P1,−.2)`; },
        edges: () => { if (!_K.edge) return '[EDGE] none set (mu1.edge(a,b,κ))'; _K.edge.forEach((r, i) => console.log(`  ${SLOTN[i]}: [${r.map((v) => v.toFixed(2)).join(', ')}]`)); return _K.edge; },
        // mix(a,b,amount) — the discoverable alias for the ATTRACTOR-COUPLING half of an edge: slot a's & b's
        // solitons pull toward each other's shape (amount>0 blend, <0 repel). Same replicated edge verb, named
        // for the visual result (the old medium's slot-mixing, U1-honest: the fields genuinely interact, in regH).
        mix: (a = 'W', b = 'V', amount = 0.3) => window.mu1.edge(a, b, amount),
        // fieldMix(on) — GATE the edge's SECOND coupling layer (attractor field-mixing) WITHOUT removing the edge.
        //   An edge drives TWO couplings from one κ: (1) the Kuramoto PHASE law (θ_i entrains) and (2) attractor
        //   FIELD-mixing (the soliton SHAPE bleeds toward the neighbor). This toggle governs ONLY (2): fieldMix(false)
        //   keeps the edges and their phase coupling live, but the shapes stay PURE — so you can SEE which of the two
        //   effects an edge is producing. Replicated (it gates descBase → in regH); default ON. Differs from mu1.mix
        //   (which CREATES an edge); this leaves the edge and switches its field-layer off/on.
        fieldMix: (on = true) => { injectEvent?.({ type: 'mediumVirt', mode: 'fieldmix', amp: on ? 1 : 0 }); return `[FIELDMIX] attractor field-mixing → ${on ? 'ON (an edge couples BOTH: phase entrains + shape bleeds)' : 'OFF (an edge couples PHASE only — Kuramoto; shapes stay pure)'} (replicated: lands at the shared step; gates descBase, in regH)`; },
        // occludeBank({idx, mode, frac, block, seed}) — MEMORY-SIDE occlusion: DAMAGE a STORED plate in the bank
        //   (permanent), the "can a corrupted memory still be read?" test — the mirror of recallo (which occludes the
        //   CUE, leaving memory intact). idx = plate index (default −1 = the last). mode: 7 rand-zero · 8 rand-noise ·
        //   6 half · 5 box · 1/2/3 LP/HP/conj. frac = fraction removed. After damaging, recall@ / recall⇄ reads it —
        //   a real hologram recovers the whole from what survived; mu1.plateView(idx) to SEE the corruption directly.
        //   Replicated (the damaged plate rides regH's snapshot to joiners; deterministic at the shared step).
        occludeBank: ({ idx = -1, mode = 7, frac = 0.5, block = 8, seed = 0 } = {}) =>
          injectEvent?.({ type: 'mediumVirt', mode: 'occludebank', gx: idx | 0, holoMode: mode | 0, frac: +frac, block: block | 0, seed: seed | 0 }),   // seed:0 (default) → the handler derives a deterministic seed from the shared drain step (KWE PRNG); pass an explicit seed to fix the mask
        // livePlate(i) — lift stored plate i into a LIVING 𝔸-slot (P2) and view it: the memory as an EVOLVING SOLITON
        //   (register-stepped, held toward its attractor), NOT a frozen image. Damage the plate → the soliton degrades
        //   live. i≥0 = that plate; default -1 = the last. The recall is REPLICATED (a normal 𝔸-slot birth); the view
        //   switch is local. This is the honest "see the memory alive". (mu1.plateView = the frozen-image alternative.)
        // virtT(T) — set the ±T HOLOGRAPHY DEPTH (spectral-leg steps, 1–256). Replicated. Larger T = deeper spread /
        //   more delocalized plate. RE-STORE after changing (old plates were spread at the previous T). mu1.sweepOcclusion measures the curve.
        virtT: (T = 16) => { injectEvent?.({ type: 'mediumVirt', mode: 'virtt', amp: +T }); return `[VIRT_T] hologram depth → T=${Math.max(1, Math.min(500, Math.round(+T)))} (replicated) — re-store to bank at this depth`; },
        // dispTrace(n) — WHY does the canvas look frozen while fieldH keeps changing? Samples, n times ~1s apart, the
        //   THREE things between the physics and the pixels for the viewed slot: the live state (descBase), the
        //   DISPLAY buffer the renderer actually uploads (descDisp — refreshed only at the BAR boundary, k%21), and
        //   whether the GPU texture key changed. If descBase moves but descDisp doesn't → the display buffer is not
        //   being refreshed. If both move but the canvas is static → the upload/render is stale. Peer-local probe.
        dispTrace: (n = 6) => { let i = 0; const tick = () => { const s = _sb.slots[_viewSlot];
            const hb = s?.descBase ? _hashField(s.descBase) : null, hd = s?.descDisp ? _hashField(s.descDisp) : null;
            console.log(`[DISP] ${SLOTN[_viewSlot]} step=${_E.solSteps} descBase=${hb} descDisp=${hd} sameObj=${s?.descDisp === _descTexKey ? 'TEX-KEY-MATCHES(no re-upload)' : 'key differs'} live=${s?.descLive ? 1 : 0} desc=${s?.desc ? 1 : 0}`);
            if (++i < n) setTimeout(tick, 1000); };
          tick(); return `[DISP] tracing the viewed slot for ${n}s — compare descBase (physics) vs descDisp (what the canvas uploads)`; },
        // lensObj(name) — WHAT THE LOCK HOLDS. The pin target is makeProbeField(obj) through the readOp; `obj` alone
        //   decides whether the medium organizes around a DENSE GLYPH or SPARSE LIGHT POINTS. 'letterA' is drawn as a
        //   chain of dots along each stroke — that density IS the on-screen texture, not the medium. 'point'/'pair'/
        //   'grid' are isolated light points and the medium builds its own interference between them (MEASURED more
        //   coherent than letterA: speckle 0.86 grid / 0.92 cross vs 1.04 letterA). THE LOCK IS UNCHANGED — this is the
        //   right way to lose the texture while KEEPING the oscillating soliton (unlike pinHold, which dissolves it).
        //   One of: ring · point · pair · grid · cross · blob · letterA · depthscene. Replicated (pin target is in regH).
        lensObj: (name = 'lightpts') => { if (!_PROBE_OBJS.includes(String(name))) return `[MU1-OBJ] one of: ${_PROBE_OBJS.join(', ')}`;
          injectEvent?.({ type: 'mediumVirt', mode: 'lensobj', obj: String(name) });
          return `[MU1-OBJ] pin target → '${name}' (replicated) — the switch passes THROUGH THE DOOR: every living slot's field+budget re-seeds from the new attractor (leaving the old field = undamped turbulence, the uniform cap never drains it). Use 'lightpts' for coherent light points (Gaussian σ=5 below the ring kKnee); hard dots (point/pair/grid) are deltas above the knee and stay noisy.`; },
        // selfAtt(bars) — ψATT: THE FIELD-AS-ATTRACTOR DOOR. After the lock, DIGEST `bars` bars (pin lifted — the
        //   medium disperses the injected pixels), then ADOPT: the field's own f32 state becomes the pin target
        //   (rolled by the leash, rotated by the register φ/ω). The symbol's identity migrates from the OPERATOR into
        //   the FIELD — "use the field itself that holds the injection". Set lensTau ω≠0 first: after adoption the
        //   oscillation is REGISTER-driven (the probe-mismatch beat is gone by construction; ω is the living clock).
        //   HONEST LIMITS (measured): shape ≈0.6 of probe-pinned; texture only PARTIALLY softens (Gate-D law: the
        //   letter's identity lives ABOVE kKnee — its sharp strokes ARE the symbol in this medium). 0 = revert to probe.
        // pinBeta(v, slot) — β, the pin gravity (refAmp), per slot. Its MEANING DEPENDS ON WHAT THE PIN HOLDS:
        //   · probe pin  → β drives the medium toward a DIFFERENT shape; the mismatch beat IS the oscillation, so
        //                  higher β keeps it lively well past 1.
        //   · ψATT (adopted) → the target is the field's OWN rotating state, so β is pure DAMPING. Measured liveliness
        //                  (ω=0.3): 0.51@0.2 · 0.27@0.4 · 0.14@0.6 · 0.12@0.7 · 0.11@1.0 · 0.08@3.0 — monotone, and
        //                  flat past ~0.7 (why the slider "stops doing anything" there). Use 0.2–0.4 and raise ω.
        pinBeta: (v = 1, slot) => { const nm = slot || _regSlot; injectEvent?.({ type: 'mediumVirt', mode: 'refamp', src: nm, amp: +v });
          const held = _sb.slots[Math.max(0, SLOTN.indexOf(nm))]?._attHold;
          return `[REFAMP] β(${nm}) → ${(+v).toFixed(2)}${held ? ' · ψATT is ADOPTED on this slot, so β is DAMPING (target = the field itself): low β + higher ω is the lively regime' : ''}`; },
        // synthHold(N, kfrac) — SYNTHESISE → ADOPT. Rebuilds the live slot's field from its own N strongest modes
        //   below kfrac·kKnee and adopts it directly: no probe, no injection, no digest (there are no injected pixels
        //   to disperse — a synthesised field never was a glyph). THE THIRD DESCRIPTION FORM: `dop`+obj is compact but
        //   foreign (a shared generator); a ψATT byte-hold is native but ungenerative (128KB on the wire); a MODE LIST
        //   is both, because Fourier is this medium's own eigenbasis. Measured: N=64 → 1024 B, shape 0.90; N=128 →
        //   2048 B, shape 0.94 (vs 131072 B for the f32 hold ⇒ ~64×); saturates at N≈256. kfrac default 0.5 sits at
        //   the measured identity floor (V tracks the full state to 0.35–0.5·kKnee, scrambles below 0.25).
        synthHold: (N = 128, kfrac = 0.5) => { injectEvent?.({ type: 'mediumVirt', mode: 'synthspec', amp: +N, gx: Math.round(100 * (+kfrac || 0.5)) });
          return `[SYNTH] → ${Math.max(0, Math.min(4096, Math.round(+N)))} modes below ${(+kfrac || 0.5).toFixed(2)}·kKnee, adopted directly (replicated). Pixels are the OUTPUT now, never the input — set ω via mu1.lensTau(0.2) for living precession, mu1.holdId() to verify identity.`; },
        // specCost(N, kfrac) — READ-ONLY: what would a recipe of N modes cost and how faithful would it be? Runs the
        //   same _specSynth the verb runs, on W's live bytes, WITHOUT touching the medium. Use it to pick N before
        //   committing: the shape/size curve has a knee (0.90 at 64, 0.94 at 128, flat past 256).
        specCost: (N = 128, kfrac = 0.5) => { if (!W.descBase) return '[SPEC] no field on W';
          const kc = _kKnee() * (+kfrac || 0.5), r = _specSynth(W.descBase, Math.max(1, Math.round(+N)), kc);
          if (!r) return '[SPEC] synthesis failed (no ring?)';
          const sh = _ampCorr(r.field, W.descBase), v0 = _mkSl2(W.descBase), v1 = _mkSl2(r.field);
          console.log(`[SPEC] ${r.modes}/${r.pool} modes below k=${kc.toFixed(3)} (${(100 * (+kfrac || 0.5)).toFixed(0)}% of kKnee=${_kKnee().toFixed(3)}) · recipe ${r.modes * 16} B vs field ${W.descBase.length * 4} B (f32) = ${(W.descBase.length * 4 / (r.modes * 16)).toFixed(0)}× smaller · shape(ampCorr)=${sh.toFixed(4)}${(v0 && v1) ? ` · identity dV=${(100 * (v1.V / v0.V - 1)).toFixed(2)}%` : ''} — READ-ONLY, the medium is untouched`);
          return { modes: r.modes, bytes: r.modes * 16, shape: sh, dV: (v0 && v1) ? (v1.V / v0.V - 1) : null }; },
        // basinTest(amp, bars, seed) — IS THE HELD STATE AN ATTRACTOR, OR JUST A STORED PICTURE?
        //   THE QUESTION. Spectral truncation failed (live: the COMPLETE low band = 421/421 modes reproduces only 0.30
        //   of the state, dV −90%) because SPM is diagonal in POSITION and dense in k — a state that has lived under it
        //   is high-k by construction, and no linear-basis truncation describes it. So the compact form, if one exists,
        //   is not a basis expansion but a BASIN RECIPE: (pin target, β, ω, ring, cap E₀) → run to convergence. That is
        //   exact rather than lossy — the medium regenerates the state by running its own dynamics. This tests the
        //   premise that claim rests on: does the state RETURN after a kick, or does it merely sit where it was put?
        //
        //   THE TRAP THIS AVOIDS. Under ψATT the pin target IS the state, so "perturb → the pin drags it back" is a
        //   TAUTOLOGY — it would return no matter what, and prove nothing about attractors. So the run is done on a
        //   SCRATCH COPY with the pin held FIXED at the unperturbed target while the STATE is kicked. Recovery then
        //   measures the medium's own dynamics (dispersion + SPM + cap) pulling the state back to a fixed point, not
        //   the pin being redefined around wherever the state happens to be.
        //
        //   THE CONTROL (what makes it a test rather than a demo). β=0 is run alongside: same kick, same steps, NO pin.
        //   · both recover        ⇒ the medium alone re-forms it: a genuine attractor of the dynamics
        //   · only pinned recovers ⇒ the pin is doing the work; the state is a DRIVEN equilibrium, not a free attractor
        //     (still a valid basin recipe — the pin is part of the recipe — but a weaker claim, and honest to say so)
        //   · neither recovers    ⇒ not an attractor at all: the hold is a stored picture and the basin idea is dead
        //   READ-ONLY: runs on copies, never touches descBase/_attHold. Deterministic (makeRng on the given seed, no
        //   Math.random), so the same seed replays identically — but PEER-LOCAL by design: it is a measurement.
        basinTest: (amp = 0.3, bars = 24, seed = 1) => {
          const s0 = _sb.slots[0]; if (!s0.descBase || !s0.descE0) return '[BASIN] no field on W';
          const tgt = _liveAtt(0) || s0.descAtt || _regAttC;
          if (!tgt) return '[BASIN] no pin target — adopt (mu1.selfAtt) or pin first';
          const base = Float64Array.from(s0.descBase), E0 = s0.descE0;
          const rng = makeRng(seed | 0, 0xba51, 0x11fe, 0x5eed); rng.next(); rng.next();   // warm-up: the first draw is dominated by s0+s3
          // the KICK: broadband complex noise at `amp` × the state's own rms — deliberately NOT low-k, since the
          // question is whether the medium re-forms structure across the whole band it actually occupies.
          let rms = 0; for (let j = 0; j < base.length; j++) rms += base[j] * base[j];
          rms = Math.sqrt(rms / base.length);
          const kick = Float64Array.from(base);
          for (let j = 0; j < kick.length; j++) kick[j] += amp * rms * (2 * rng.next() - 1);
          const run = (f, beta) => { let e = 0; for (let j = 0; j < f.length; j++) e += f[j] * f[j];
            const sl = { descBase: Float64Array.from(f), descE0: E0, _eng: null, leash: s0.leash };
            for (let b = 0; b < bars; b++) for (let n = 0; n < STEPS_PER_PHASE; n++) _regStep1(sl, beta ? tgt : null, beta);
            return Float64Array.from(Float32Array.from(sl.descBase)); };
          const d0 = _ampCorr(kick, base);                       // how far the kick threw it
          const pin = run(kick, _lensOp[0].beta || 1), free = run(kick, 0);
          const ctlP = run(base, _lensOp[0].beta || 1);           // UNKICKED controls: the state also drifts on its own
          const ctlF = run(base, 0);                              //   (relaxation), so recovery must beat THIS, not 1.0
          const sh = (f) => _ampCorr(f, base), vv = (f) => { const q = _mkSl2(f); return q ? q.V : null; };
          const v0 = vv(base);
          const pct = (f) => v0 ? `${(100 * (vv(f) / v0 - 1)).toFixed(2)}%` : '?';
          console.log(`[BASIN] kick amp=${amp} (shape after kick ${d0.toFixed(4)}) · ${bars} bars × ${STEPS_PER_PHASE} steps · β=${(_lensOp[0].beta || 1).toFixed(2)}`);
          console.log(`  PINNED  recovered shape ${sh(pin).toFixed(4)} (dV ${pct(pin)})  · unkicked control ${sh(ctlP).toFixed(4)} (dV ${pct(ctlP)})`);
          console.log(`  FREE    recovered shape ${sh(free).toFixed(4)} (dV ${pct(free)})  · unkicked control ${sh(ctlF).toFixed(4)} (dV ${pct(ctlF)})`);
          // ── THE BASELINE IS THE UNKICKED CONTROL, NOT THE KICK (corrected 2026-07-27 — the first version compared
          //    against the post-kick shape and printed the OPPOSITE conclusion on data that showed a clean basin).
          //    Why the kick is the wrong baseline: the state RELAXES on its own, so the unkicked run lands at ~0.93,
          //    not 1.0. At a small kick the post-kick shape (0.998) sits ABOVE that equilibrium, so converging to it
          //    scores as a "loss" when the state is simply arriving where it always goes. Convergence to the SAME
          //    PLACE regardless of the kick IS the attractor signature — that is what must be measured.
          const cvP = sh(pin) - sh(ctlP), cvF = sh(free) - sh(ctlF);   // ≈0 ⇒ the kick was forgotten (converged to the control)
          const TOL = 0.02;
          console.log(`  ⇒ CONVERGENCE (kicked vs unkicked — ≈0 means the kick was forgotten): PINNED ${cvP >= 0 ? '+' : ''}${cvP.toFixed(4)} · FREE ${cvF >= 0 ? '+' : ''}${cvF.toFixed(4)} — ${Math.abs(cvF) <= TOL && sh(ctlF) > 0.5 ? 'the MEDIUM ALONE re-forms it ⇒ genuine attractor of the dynamics (the basin recipe is exact and pin-INDEPENDENT)' : Math.abs(cvP) <= TOL ? `DRIVEN EQUILIBRIUM with a real basin: the pinned run converges to its unkicked equilibrium (${sh(ctlP).toFixed(4)}) whatever the kick, but the FREE run collapses to ${sh(ctlF).toFixed(4)} — so this is a fixed point of dispersion+SPM+cap+PIN, not of the medium alone. The pin is PART of the recipe, not scaffolding.` : `OUTSIDE THE BASIN at amp=${amp}: the kicked run lands ${Math.abs(cvP).toFixed(4)} from its equilibrium — the basin has an edge and this kick is past it (sweep amp down to find it).`}`);
          return { kickShape: d0, pinned: sh(pin), free: sh(free), ctlPinned: sh(ctlP), ctlFree: sh(ctlF), convPinned: cvP, convFree: cvF }; },
        // basinTarget(N, kfrac, bars) — CAN A CHEAP TARGET CONVERGE TO AN EXPENSIVE STATE?
        //   The question basinTest makes well-posed. Under ψATT the basin recipe is exact but CIRCULAR: the pin target
        //   IS the state, so "run to convergence" reads "the state that converges to itself". It stops being circular
        //   only if the target can be cheaper than the state. basinTest showed the basin tolerates STATE error (a kick
        //   to 0.3×rms is forgotten); this asks whether it also tolerates TARGET error — pin to a degraded, compact
        //   target (the N-mode low-band reconstruction, which alone scores ~0.30 live) and see where the medium lands.
        //     converges near the true state ⇒ REAL COMPRESSION: N modes + the dynamics regenerate what N modes cannot
        //     converges near the degraded target ⇒ the pin just reproduces whatever it is given; no compression
        //   READ-ONLY: copies only, the medium is untouched.
        basinTarget: (N = 421, kfrac = 4, bars = 24) => {
          const s0 = _sb.slots[0]; if (!s0.descBase || !s0.descE0) return '[BASIN-T] no field on W';
          const base = Float64Array.from(s0.descBase), E0 = s0.descE0;
          const r = _specSynth(base, Math.max(1, Math.round(+N)), _kKnee() * (+kfrac || 4));
          if (!r) return '[BASIN-T] synthesis failed (no ring?)';
          const beta = _lensOp[0].beta || 1;
          const run = (f, tgt) => { const sl = { descBase: Float64Array.from(f), descE0: E0, _eng: null };
            for (let b = 0; b < bars; b++) for (let n = 0; n < STEPS_PER_PHASE; n++) _regStep1(sl, tgt, beta);
            return Float64Array.from(Float32Array.from(sl.descBase)); };
          const sh = (a, b) => _ampCorr(a, b);
          const tgtShape = sh(r.field, base);                       // how degraded the cheap target is, alone
          const fromDeg = run(r.field, r.field);                    // start AND pin at the degraded target (the honest cheap-recipe run)
          const trueEq = run(base, base);                           // the true state's own equilibrium — the thing to beat
          const a = sh(fromDeg, base), b = sh(fromDeg, r.field);
          console.log(`[BASIN-T] cheap target = ${r.modes} modes (${r.modes * 16} B) below ${(+kfrac || 4).toFixed(2)}·kKnee · alone it scores ${tgtShape.toFixed(4)} vs the true state · β=${beta.toFixed(2)}, ${bars} bars`);
          console.log(`  converged from/on the cheap target → ${a.toFixed(4)} vs the TRUE state · ${b.toFixed(4)} vs the cheap target itself`);
          console.log(`  the true state's own equilibrium → ${sh(trueEq, base).toFixed(4)} (the ceiling any recipe can reach)`);
          const lift = a - tgtShape;
          console.log(`  ⇒ the dynamics ${lift > 0.05 ? `LIFT the cheap target by ${lift.toFixed(4)} toward the true state ⇒ REAL COMPRESSION: ${r.modes * 16} B + the medium's own dynamics regenerate what ${r.modes} modes alone cannot` : `add ${lift >= 0 ? '+' : ''}${lift.toFixed(4)} — NO LIFT: the medium reproduces whatever target it is given, so a degraded target yields a degraded state and the recipe cannot be cheaper than the state`}`);
          return { modes: r.modes, bytes: r.modes * 16, targetAlone: tgtShape, converged: a, vsTarget: b, trueEq: sh(trueEq, base), lift }; },
        selfAtt: (bars = 3) => { injectEvent?.({ type: 'mediumVirt', mode: 'selfatt', amp: +bars });
          const v = Math.max(0, Math.min(64, Math.round(+bars)));
          return `[ψATT] → ${v ? `digest ${v} bars then ADOPT the field as the attractor (set ω via mu1.lensTau(0.1..0.3) for living precession)` : 'OFF — the probe pin re-asserts the injected symbol'} (replicated)`; },
        // pinHold(n) — ⌛ a DECOHERENCE EXPERIMENT (not a display cleanup). 0 = default: the plate attractor drives a
        //   living slot forever, and that lock is what SUSTAINS the coherent soliton and its interference fringes.
        //   n>0 fades the drive after n shared steps → the field DECOHERES into per-cell speckle (measured spatial
        //   speckle-index 1.16 → 1.49: no symbol, no fringes). The bright envelope and the ripples are NOT separable
        //   layers — the ripples exist because the soliton is locked. Replicated (the pin is in regH).
        pinHold: (n = 300) => { injectEvent?.({ type: 'mediumVirt', mode: 'pinhold', amp: +n });
          const v = Math.max(0, Math.min(4000, Math.round(+n)));
          return `[PINHOLD] ⌛ → ${v ? `${v} steps: DECOHERENCE — the drive fades and the soliton dissolves into speckle (no symbol, no fringes). mu1.pinHold(0) to restore.` : '0 = drive FOREVER (default, correct for normal use) — the lock sustains the coherent soliton AND its interference'} (replicated)`; },
        // livePlate(i, slot) — HOST plate i (default: the last) in `slot` (V/P1/P2; default = the SELECTED slot) as a
        //   LIVING soliton: bank damage then re-lifts into it and you watch it degrade. Slot-targeted, so the SAME
        //   plate can live in two slots at once (compare it, or watch one memory degrade in two reconstructions).
        //   Replicated birth; the view switch is local. mu1.releasePlate(slot) is the inverse (stop hosting).
        livePlate: (i = -1, slot) => { const idx = (i | 0) >= 0 ? Math.min(i | 0, _plates.length - 1) : (_plates.length - 1); if (idx < 0) return '[LIVEPLATE] no plates (store first)';
          const ti = slot != null ? SLOTN.indexOf(String(slot)) : _plvSlotIdx();   // explicit slot, else the SELECTED one (no silent P2 default)
          if (!(ti >= 1 && ti <= 3)) return '[LIVEPLATE] pick a host slot: V, P1 or P2 — W is the driven world and cannot host a live plate (mu1.livePlate(-1,"P1"), or select the slot in the register strip)';
          injectEvent?.({ type: 'mediumVirt', mode: 'platelive', gx: idx, src: SLOTN[ti] }); _viewSlot = ti; _plateView = -1;
          return `[LIVEPLATE] lifting plate ${idx + 1}/${_plates.length} into ${SLOTN[ti]} as a LIVING soliton (register-stepped) — viewing ${SLOTN[ti]}; damage it to watch it degrade live`; },
        // releasePlate(slot) — the inverse of livePlate: the slot STOPS hosting its plate (keeps its field and keeps
        //   living; bank damage simply no longer re-lifts into it). Replicated. Default = the SELECTED slot.
        releasePlate: (slot) => { const ti = slot != null ? SLOTN.indexOf(String(slot)) : _plvSlotIdx();
          if (!(ti >= 1 && ti <= 3)) return '[LIVEPLATE] pick a slot: V, P1 or P2';
          injectEvent?.({ type: 'mediumVirt', mode: 'platelive', gx: -1, src: SLOTN[ti] });
          return `[LIVEPLATE] ${SLOTN[ti]} releasing its plate — it keeps living, but bank damage no longer re-lifts into it`; },
        // plateView(i) — the FROZEN-IMAGE alternative: display the stored plate `p` bytes directly (the raw memory +
        //   damage), NOT stepped. i≥0 shows plate i; -1 off. Local display. (mu1.livePlate = the evolving-soliton view.)
        plateView: (i = -1) => { _plateView = (i | 0) >= 0 ? Math.min(i | 0, Math.max(0, _plates.length - 1)) : -1;
          return _plateView >= 0 ? `[PLATE-VIEW] showing stored plate ${_plateView + 1}/${_plates.length} FROZEN (the raw memory${_plates[_plateView]?._dmg != null ? ` · ${(100 * (1 - _plates[_plateView]._dmg)).toFixed(0)}% damaged` : ''}) — plateView(-1) off; mu1.livePlate() for the live soliton` : '[PLATE-VIEW] off (slot view)'; },
        // occView(on) — PEER-LOCAL toggle: for a slot holding a recalled plate, draw the DAMAGED PLATE (the occlusion
        //   ITSELF, pre-lift) vs the −T RECONSTRUCTION (default). The damaged plate + T are REPLICATED (identical on
        //   every peer); only THIS view choice is local — so two peers at the SAME shared T can watch different things
        //   at once: one the occlusion (what was knocked out), the other the reconstruction (what the hologram
        //   recovered from it). No replicated state, not in eH — flip freely, it never affects the shared field.
        occView: (on = true) => { _occView = !!on; return `[⊘VIEW] this peer now shows the ${_occView ? 'STORED PLATE — the memory itself, with its damage. STATIC by nature (a frozen record; it redraws only when you damage it), not a living field' : 'LIVE RECONSTRUCTION (default) — the slot\'s field, register-stepped every frame'} at the shared T=${_VIRT_T} · LOCAL only — another peer with the opposite toggle sees the other half of the SAME shared state`; },
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
      hdr.textContent = `medium-u1 (SLOT-CENTRIC) · ${n.cachedRadii?.length ? 'RUNNING' : 'waiting…'} · drive:${_driveMode}${W.desc ? ' · ⌀PDE ABSTRACT (register closed — 0 grid steps/frame)' : ''}${_tempoDiv > 1 ? ` · tempo÷${_tempoDiv}` : ''}${_turboOn ? ' · ⚡turbo(GPU executor)' : ''}${_linearMode === 1 ? ' · ⊘nonlinear (FREE linear — dispersing)' : _linearMode === 2 ? ' · ▣linear TRAP (symbol held by linear lock)' : ''} · β ${_pinBeta.toFixed(2)} · lock→A ${W.desc ? '≡1 (W IS the descriptor)' : _E.lockNow.toFixed(2)} · ${_coevoOn ? `⟲coevo g ${_coevoG.toFixed(2)}${_unpinned ? ' [ℂ* unpinned: TRUE field energy]' : ' [U(1) pinned: predicted lag]'}` : '⟲coevo OFF (open-loop)'} · step ${_E.solSteps} · regH ${_regH()} (MUST match) · ${W.desc ? 'solH — (no field)' : _regTraceOn ? `solH@${_solHStep} ${_solH} (field @ shared boundary — compare peers here)` : 'solH — (unverified: W as its own mirror)'}${_vptLast ? ` · H ${_vptLast.H.toExponential(2)}${_vptLast.H < 0 ? ' ⚠pin-held' : ''}` : ''}`;
      if (_absBtn._on !== !!W.desc) { _absBtn._on = !!W.desc; _absBtn.textContent = W.desc ? '⌀PDE:ON' : '⌀PDE'; _absBtn._repaint(); }   // reflect the replicated state (position mirrors state)
      const _modeNow = W.desc ? 'mode:⌀register' : 'mode:physics';
      _coevoBtn._on = _coevoOn; _coevoBtn.style.opacity = _coevoOn ? 1 : 0.6; _unpinBtn._on = _unpinned; _unpinBtn.style.opacity = _unpinned ? 1 : 0.6;
      { const _fl = _fieldMix ? '⇄mix' : '⇄mix:OFF'; if (_fmixBtn.textContent !== _fl) { _fmixBtn.textContent = _fl; _fmixBtn._repaint?.(); } _fmixBtn._on = _fieldMix; _fmixBtn.style.opacity = _fieldMix ? 1 : 0.6; }
      { const _ll = _LIN_LABELS[_linearMode]; if (_linBtn.textContent !== _ll) { _linBtn.textContent = _ll; _linBtn._repaint?.(); } _linBtn._on = _linearMode > 0; _linBtn.style.opacity = _linearMode ? 1 : 0.6; }
      _turboBtn._on = _turboOn; _turboBtn.style.opacity = _turboOn ? 1 : 0.6;
      { const _exl = _turboOn ? 'gpu' : 'cpu'; if (_turboBtn.textContent !== _exl) { _turboBtn.textContent = _exl; _turboBtn._repaint?.(); } }   // executor label reflects the replicated state
      if (_modeBtn.textContent !== _modeNow) { _modeBtn.textContent = _modeNow; _modeBtn._on = !!W.desc; _modeBtn._repaint(); }
      if (_xattBtn._on !== _xattOn) { _xattBtn._on = _xattOn; _xattBtn.textContent = _xattOn ? 'x𝔸tt:ON' : 'x𝔸tt'; _xattBtn._repaint(); }
      // live-plate button: reflects the TARGETED slot (_verbSlot: viewed slot wins, else the register-strip target).
      //   _recalledInto[] is written by the platelive/recall VERB HANDLERS on every peer and restored on join → the
      //   state is correct everywhere (same proven mechanism as _VIRT_T). Label shows the slot + which plate it holds;
      //   ◉ = THIS peer is viewing that slot, ○ = it holds a plate but this peer is looking elsewhere.
      { const _ti = _plvSlotIdx(), _pi = _ti >= 0 ? _recalledInto[_ti] : -1;
        const _hasP = _pi >= 0;
        const _lbl = _ti < 0 ? 'live plate (pick V/P1/P2)'   // W selected: no valid host — say so, never silently retarget
          : _hasP ? `live ${SLOTN[_ti]}:pl${_pi + 1} ◉` : `live plate→${SLOTN[_ti]}`;   // ◉ = this slot HOSTS a plate (damage re-lifts into it); press to RELEASE
        const _op = _ti < 0 ? 0.35 : (_hasP ? 1 : 0.6);
        if (_plvBtn.textContent !== _lbl || _plvBtn._on !== _hasP || _plvBtn.style.opacity !== String(_op)) {
          _plvBtn._on = _hasP; _plvBtn.textContent = _lbl; _plvBtn.style.opacity = _op; _plvBtn._repaint?.(); } }
      if (_ocvBtn._on !== _occView) { _ocvBtn._on = _occView; _ocvBtn.textContent = _occView ? '⊘plate (static)' : '⊘view'; _ocvBtn.style.opacity = _occView ? 1 : 0.6; _ocvBtn._repaint?.(); }   // label says STATIC: a plate is a frozen record, not a living field
      { const _dig = _sb.slots.some((s) => s._digestLeft > 0), _held = _sb.slots.some((s) => !!s._attHold);   // ψatt button: digesting → ⌛, adopted → ψatt◉ (the field carries the symbol), else off
        const _pl2 = _dig ? 'ψatt⌛' : _held ? 'ψatt◉' : 'ψatt'; const _on2 = _dig || _held;
        if (_psaBtn.textContent !== _pl2) { _psaBtn._on = _on2; _psaBtn.textContent = _pl2; _psaBtn.style.opacity = _on2 ? 1 : 0.6; _psaBtn._repaint?.(); } }
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
        // DEFER RATHER THAN COLD-SNAP WHEN A HOLD IS ARMED (2026-08-03). A joiner arrives with _kernHold set (see
        //   [JOIN-KHOLD]): its version is older than the queue can replay, so the gap is genuinely underivable.
        //   Cold-snapping here would apply a per-step physics input at a PEER-LOCAL FRAME — the one thing the
        //   staging discipline exists to prevent — and the peers then propagate through different kernels at the
        //   same step forever. Instead we WAIT: the soliton does not step (see the drive gate), and the staging
        //   branch below clears the hold as soon as a queued swap lands at its shared step, which is the first
        //   instant both peers are provably on the same kernel at the same step. Generative, not historical: the
        //   joiner re-derives from the clock rather than replaying what it missed.
        if (_kernHold) { /* held — fall through to staging below; no peer-local swap, no stepping */ }
        else if (_E.kernelVer < oldestQ - 1) { const qs = _gpu.readEyePsi(); _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets); _gpu.setEyePsi(qs); _E.kernelVer = _kernVer; _E.ringCache = { r: n.cachedRadii, w: n.cachedWeights, o: n.cachedOffsets }; _pendKern.length = 0;
          // A JOINER IS ALWAYS "FAR BEHIND" (2026-08-03) — so this escape hatch fires on essentially every join, and
          //   it is the ONE path in the kernel logic that applies a swap at a PEER-LOCAL FRAME rather than at the
          //   shared step. The note above already names that as the fork it exists to prevent; the guard just does
          //   not cover the join case, because a joiner restores kernelVer from the snapshot while the node's live
          //   version has moved on and kernelQueue only retains recent entries.
          //   MEASURED CONSEQUENCE: the two peers' kernelVer diverge and STAY diverged (leader 310,312,312,313,314,
          //   316,318,320 vs joiner 306,308,312,313,316,318,322,325 at the same bars). The kernel is a PER-STEP
          //   physics input, so a different λ-grid at the same step is a different propagation — giving a permanent
          //   phase difference at constant energy (|ψ|² within 0.04× the f32 floor, argPin ~0.015 rad apart,
          //   oscillating and NOT decaying) with regH/attH/holdH/e0 all matching. Exactly the reported symptom.
          console.warn(`[MU1-KSNAP] ⚠ cold-snap kernel ver=${_E.kernelVer}→${_kernVer} applied at a PEER-LOCAL FRAME (solSteps=${_E.solSteps}, oldestQ=${oldestQ}, queue=${q.length}) — the queue cannot replay the gap, so this peer swaps at a step the other peer never swaps at. From here the two peers propagate through DIFFERENT kernels at the same step: a permanent phase difference at constant energy. This fires on essentially every JOIN (a joiner restores an old kernelVer while the node has advanced); until the join adopts the kernel through the shared-step queue, V/P1/P2 will not be phase-exact.`); }
        else _stageKern(q);
      }
      // ── STAGING MUST NOT BE GATED ON "MY VERSION DIFFERS RIGHT NOW" (2026-08-03) — the residual ver DRIFT ──────
      //   The whole block above is entered only when `_E.kernelVer !== _kernVer`, i.e. when this peer's version
      //   differs from the node's AT THIS FRAME. But staging is about FUTURE swaps: an entry whose startStep lies
      //   ahead must be queued regardless of what version we happen to hold now. A peer whose frame lands while the
      //   two are momentarily equal skips staging entirely and never picks those entries up; the other peer, whose
      //   frame landed a moment earlier or later, does. Different _pendKern contents ⇒ the swaps land at different
      //   steps ⇒ the 1–2 version slip measured between peers (518,521,524,525,528,530 matching, then 532 vs 534).
      //   MEASURED CONTEXT that rules out the other explanation: the queue is NOT too shallow — even on a slow
      //   connection the joiner reported `gap=2 versions to stage, depth=24`, so the unreplayable-gap case (which
      //   the _kernHold deferral handles) simply does not arise here. This race is the real residual.
      //   Staging is idempotent (the `some()` dedupe) and cheap, so run it EVERY frame from the shared queue: both
      //   peers then hold the same _pendKern regardless of when their frames sample it.
      if (_kernRunning && !_kernHold) _stageKern(Array.isArray(n.kernelQueue) ? n.kernelQueue : []);

      // ── S6 VERB DRAIN (record/store/recall/aphase/lenstau — the register + holography verbs) — replayed from the
      //    replicated log at the frame (they mutate at the shared drain; the field-plate GPU round-trips are pure) ──
      // EVERY medium verb is STAMPED to a shared step and drained in the drive loop (via _siReg). This includes record/store/
      // recall: record BIRTHS V, and V's birth STEP determines how many steps V has run since (its vKv trajectory). Draining
      // it at the peer-local FRAME forked V (live-caught: after rec, vKv=14 on one peer, 21 on the other at the SAME solStep).
      // Register verbs (refamp/aphase/lenstau) write _lensOp (in regH + fed to the field). ALL land at the identical shared step.
      // The verb log is normally the replicated array; when a peer has only the latest fields (no log yet), synthesize a
      // one-entry log so the FIRST verb still stamps. _siReg's seq cursor guards against double-staging on re-read.
      const _vlog = (Array.isArray(n.medVirtLog) && n.medVirtLog.length) ? n.medVirtLog
        : ((n.medVirtSeq | 0) > _siReg.seen ? [{ seq: n.medVirtSeq | 0, time: n.medVirtTime ?? 0, mode: n.medVirtMode || 'record', amp: (typeof n.medVirtAmp === 'number') ? n.medVirtAmp : 0, src: n.medVirtSrc || 'W', gx: n.medVirtGx ?? 0, gy: n.medVirtGy ?? 0, leak: n.medVirtLeak ?? 0, scale: n.medVirtScale || 'all',
            holoMode: n.medVirtHoloMode ?? 0, frac: n.medVirtFrac ?? 0, block: n.medVirtBlock ?? 0, seed: n.medVirtSeed ?? 0, obj: n.medLensObj }] : []);   // recallo occluder params + the lensobj probe geometry
      _siReg.pull(_vlog, (e) => ({ mode: e.mode, src: e.src || 'W', amp: (typeof e.amp === 'number') ? e.amp : 0, gx: (typeof e.gx === 'number') ? e.gx : 0, gy: (typeof e.gy === 'number') ? e.gy : 0,
        kx: (typeof e.kx === 'number') ? e.kx : undefined, ky: (typeof e.ky === 'number') ? e.ky : undefined,
        leak: (typeof e.leak === 'number') ? e.leak : 0,
        holoMode: e.holoMode | 0, frac: (typeof e.frac === 'number') ? e.frac : 0, block: e.block | 0, seed: (typeof e.seed === 'number') ? e.seed : 0,   // recallo: occluder mode/frac/block/seed (must ride every hop — the dead-edge-bug lesson)
        at: Array.isArray(e.at) ? [+e.at[0] || 0, +e.at[1] || 0] : null,   // recall PLACEMENT — must ride every hop too
        obj: (typeof e.obj === 'string') ? e.obj : undefined,   // lensobj: the probe geometry the pin holds
        scale: (e.scale === 'coarse' || e.scale === 'fine') ? e.scale : 'all' }));   // gx/gy ride for descgo; kx/ky for lensset; leak = edge κ; scale = the recall band (coarse/fine/all — tier-selective ±T leg). Every hop of the pipe must carry it (the dead-edge-bug lesson)

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
            W.desc = true; W.descBase = b0; W.descDisp = Float64Array.from(b0); W.descE0 = eS || 1; W.e0 = eS || 1; W._texDirty = true;
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
      // RATE-FLIP RECEIPT (2026-08-03). `reanchor` REWRITES c0 by k·(ratePrev−r)/spp, and c0 is the one quantity the
      //   join is required to keep VERBATIM (every stamped startStep is floor((t·rate−c0)·spp)). A flip that fires on
      //   one peer and not the other — or fires on both at a DIFFERENT k — shifts that peer's whole `target` curve and
      //   the peers then accumulate solSteps at a CONSTANT offset that never converges: exactly the [TBSTEP] signature
      //   (both stepping 7/block, cursors a fixed distance apart, every byte-level column identical). _nSl is
      //   recomputed LOCALLY from slot state each frame while ratePrev arrives from the wire, so the two can disagree
      //   at join even when the slot state is right. Log every flip with the k it fired at and the c0 it produced;
      //   the peers' [RATEFLIP] lines must match line-for-line, k for k.
      { const _rWant = _nSl * _tempoDiv, _c0Pre = _stepClk.c0, _rPrev = _stepClk.ratePrev;
        if (syncClockRate(_stepClk, _tauK, _E.solSteps, _rWant))
          console.log(`[RATEFLIP] k=${_E.solSteps} · rate ${_rPrev}→${_rWant} (nSl=${_nSl} tempoDiv=${_tempoDiv}) · c0 ${_c0Pre.toPrecision(17)}→${_stepClk.c0.toPrecision(17)} (Δ=${(_stepClk.c0 - _c0Pre).toPrecision(17)}) · born=[${_sb.slots.map((s2, i2) => (s2.born ? `${SLOTN[i2]}${s2.desc ? '(desc)' : ''}` : '')).filter(Boolean).join(',')}] — MUST fire at the SAME k with the SAME Δ on every peer; a flip on one peer only leaves a permanent target offset of Δ·spp/rate steps`); }
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
      // THE JOIN BURST IS A DIFFERENT INTEGRATION PATH (2026-08-03) — the argPin-offset candidate.
      //   A joiner restores solSteps mid-run, so `target` is ahead and it runs the gap as a BURST (up to 1024
      //   steps/frame, or 28 under the ease) while the leader ran those same steps over dozens of frames.
      //   Whole-quanta chunking makes the STEP BOUNDARIES shared, but not the per-call context: _tbAdvanceAll
      //   captures att4 ONCE PER CALL and holds it for the whole block, so a 1024-step burst is one call with one
      //   att4 where the leader had many calls with att4 re-read between them. Same steps, same kernel, same target
      //   bytes — but the pin is injected against a target sampled at a different cadence, and the cap renormalizes
      //   at different points. That is a phase difference at constant energy, established ONCE during the catch-up
      //   and then conserved (nothing damps a global phase) — which matches the measured signature exactly:
      //   |ψ|² within 0.03× the f32 floor, argPin 0.02–0.04 rad apart, permanent, with every hash agreeing.
      //   Logged, not yet corrected: the fix would be to cap the per-frame catch-up to the Q-block the leader used
      //   (making the call cadence shared too), which costs join latency — measure before choosing.
      // THE JOIN BACKLOG — how far behind the shared clock this peer restored. MEASURED 2026-08-03: backlog=10
      //   steps, i.e. the joiner arrives essentially IN STEP (under two Q-blocks) and absorbs it in the same number
      //   of _tbAdvanceAll calls the leader used. So the "catch-up burst integrates differently" hypothesis is
      //   FALSIFIED: there is no burst to speak of, and the residual argPin offset is not explained by it.
      if (_joinAnchor) { const _bl = target - _E.solSteps;
        console.log(`[JOIN-BURST] backlog=${_bl} steps at join (target=${target}, solSteps=${_E.solSteps}) · ease=${_joinEaseN > 0 ? `ON (28/frame for ${_joinEaseN} frames)` : 'OFF'} · ≈${Math.max(1, Math.ceil(_bl / Q))} Q-blocks to absorb — a SMALL backlog here means the joiner integrates the gap the same way the leader did, so the catch-up path is NOT a source of divergence`); }
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
      // ── THE CLOCK METER (mu1.clockDet(n)) — WHY solSteps CAN HOLD A CONSTANT OFFSET ─────────────────────────
      //   solSteps chases `target`, so it is normally SELF-CORRECTING: a peer that falls behind catches up next
      //   frame. It can only hold a FIXED offset if `target` itself is offset, and target = floor((mon−c0)·spp/rate).
      //   mon (the world clock) and rate are shared, so a constant step offset means a constant c0 difference of
      //   Δc0 = offset·rate/spp. This prints every term of that equation at a shared bar, so the offset can be
      //   attributed instead of inferred: identical mon + identical rate + DIFFERENT c0 ⇒ the join did not keep c0
      //   verbatim (look for a [RATEFLIP] on one peer only). Identical c0 + different target ⇒ the peers sampled
      //   the world clock on different phases (check monDir). Everything identical ⇒ the offset is downstream.
      if (_clockDetEvery && (_E.frameBar % _clockDetEvery) === 0 && _clockDetBar !== _E.frameBar) { _clockDetBar = _E.frameBar;
        console.log(`[CLOCK] bar=${_E.frameBar} · solSteps=${_E.solSteps} target=${target} reachable=${reachable} todo=${todo} · monClock=${_E.monClock.toPrecision(17)} monDir=${_E.monDir} · c0=${_stepClk.c0.toPrecision(17)} rate=${_stepClk.rate} ratePrev=${_stepClk.ratePrev} spp=${STEPS_PER_PHASE} · nSl=${_nSl} tempoDiv=${_tempoDiv} joinEase=${_joinEaseN} — compare peers at EQUAL bar: monClock/rate/c0 MUST all match; a c0 difference of Δ means a permanent target offset of Δ·spp/rate steps`); }

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
        _tbFrameRing = _E.ringCache; _tbFrameRingCur = null;   // turbo frame context (ring BEFORE this frame's swaps)
        _regAttC = W._digestLeft > 0 ? null   // ψATT digest: pin lifted (the medium digests the injected pixels)
          : W._attHold ? _xattBuild(_holdOp(0, W), _holdDx(W), _holdDy(W), W._attHold)   // ψATT adopted: the FIELD-borne symbol (INTEGER-rolled — see _holdDx — + register-rotated)
          : (W.descBase && W.movAtt) ? W.movAtt(W.leash.state.gx, W.leash.state.gy) : null;
        for (let i = 0; i < todo; i++) { const k = _base + i; let _cpuSnap = null;
          while (_pendKern.length && k >= _pendKern[0].startStep) { const pk = _pendKern.shift(); _E.kernelVer = pk.ver; _E.ringCache = { r: pk.r, w: pk.w, o: pk.o };
            _kernApplied.push({ atStep: k, r: pk.r, w: pk.w, o: pk.o });   // version BOOKKEEPING (the register engine reads the ring via the λ-grid cache) + the schedule for a live MIRROR
            // A STAGED SWAP LANDING AT ITS SHARED STEP IS THE ALIGNMENT POINT — release the join hold here. This is
            //   the first instant a deferred joiner is PROVABLY on the same kernel as every other peer at the same
            //   step, derived from the shared clock rather than copied. From here the ordinary staging carries it.
            if (_kernHold) { _gpu.setRings(pk.r, pk.w, pk.o);
              console.log(`[JOIN-KHOLD] RELEASED at k=${k} ver=${pk.ver} — a queued swap landed at its shared step, so this peer is now on the same kernel as the others at the same step (held ${k - (_kernHold.since | 0)} steps since the join, from ver=${_kernHold.ver}). Stepping resumes; the gap was never replayed — the clock regenerated it.`);
              _kernHold = null; } }
          // ── THE DEFERRAL GATE (see [JOIN-KHOLD]) ───────────────────────────────────────────────────────────────
          //   While held, this peer knows its kernel is NOT the one the others are stepping through, and it cannot
          //   derive the versions it missed. Rather than propagate the field through a kernel it knows to be wrong
          //   (which is what the cold-snap did, permanently), it advances the SHARED CURSOR only: k moves, the
          //   queue drains, verbs stamp — but no propagation happens, so no divergence can accumulate. The field
          //   simply waits at the restored bytes until the release above. The cost is a visible pause on join; the
          //   gain is that when stepping resumes both peers are on the same kernel at the same step, by derivation.
          if (_kernHold) {
            // SAFETY VALVE: the fractal clock re-rings often, so a swap normally arrives within a few hundred
            //   steps. If one does not (a quiescent clock, or a world whose kernel has stopped changing) the hold
            //   would stall this peer forever, which is worse than a phase offset. After _KHOLD_MAX steps, give up
            //   on deriving and adopt the node kernel — announcing plainly that this peer is now the cold-snap
            //   case and will carry a phase difference until the next shared swap re-aligns it.
            if ((k - (_kernHold.since | 0)) > _KHOLD_MAX) {
              console.warn(`[JOIN-KHOLD] ⚠ TIMED OUT after ${k - (_kernHold.since | 0)} steps with no staged swap (ver=${_E.kernelVer}, node=${n.cachedRadiiVersion | 0}) — adopting the node kernel at this frame so the peer does not stall. This IS the cold-snap case: expect a phase offset vs the other peers until a shared swap re-aligns them. If this fires routinely, the clock is not re-ringing and the deferral strategy needs a different alignment point.`);
              if (n.cachedRadii?.length) { const _qs = _gpu.readEyePsi(); _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets); _gpu.setEyePsi(_qs);
                _E.kernelVer = n.cachedRadiiVersion | 0; _E.ringCache = { r: n.cachedRadii, w: n.cachedWeights, o: n.cachedOffsets }; }
              _kernHold = null; }
            else { if ((k % 210) === 0) console.log(`[JOIN-KHOLD] holding at k=${k} (ver=${_E.kernelVer}, waiting for a staged swap ≥ ${_kernHold.need}; pend=${_pendKern.length}) — the field is NOT stepping, so nothing diverges while we wait`);
              _E.kwSteps++; continue; } }
          _siShift.drain(k, (e) => { if (_driveMode === 'transport') { if (!W.leash.state.go) W.virtGo(e.toX, e.toY); else W.setTarget(e.toX, e.toY); } });
          _siReg.drain(k, (e) => _applyRegVerb(e, k));
          _E.kwSteps++;
          // one engine step per LIVING slot: W (the driven worldline) + any slot with descLive (a recalled
          // moment resurrected ALIVE — field mode's recall semantics, register-resident). Per-step f32 grain
          // (the join-fork fix: snapshots land MID-BAR and the wire is f32 — identical bytes at EVERY step;
          // also the ORIGINAL engine's own grain: the GPU field was f32 per step).
          // ── SHARDED W (rung 2, LIVE — turbo or CPU): with a region set and no mirror, W advances ONLY inside
          //    R via the bit-exact CPU regionStepX (light-cone margin cascade; outside = the declared boundary,
          //    frozen). This runs REGARDLESS of executor: the point of two-browser sharding is that each browser
          //    computes only its HALF (the combined system handles a world one GPU couldn't) — NOT per-machine
          //    speed, so the old "regional is 10× dearer than the whole spectral step" economy gate does not
          //    apply here (it compared one peer's regional cost to one peer's WHOLE cost; sharding's win is
          //    across peers). Honest by the light-cone law (interior bit-exact) + eH shard-scoped. When sharded,
          //    W does NOT use the turbo texture path (regionStepX is CPU, bit-exact-pinned); we step it here and
          //    skip W in the turbo advance. Non-W living slots keep the turbo path.
          // SHARD MODE: is the kernel small-reach enough that the x-space regionStepX (cost ∝ ring-points·|R+
          // margin|) BEATS the whole spectral step (cost FFT-fixed, ring-size-blind)? For the LIVE fractal
          // kernel (~184 points, reach ~24) it does NOT — regionStepX per step froze the browser. On such a
          // kernel the honest shard is DECLARATION-ONLY: run the whole-torus SPECTRAL engine (cheap), then keep
          // only R and re-freeze the outside to the declared boundary (post-step). The region's deep interior
          // is the EXACT engine step (identical to whole-torus); the outside is the declared boundary; the seam
          // is the real approximation (seam-glue meter). Compute is global on a spectral engine — the WORLD
          // PARTITION is regional, not the FLOP count; that asymmetry (why the engine is spectral) is the honest
          // limit. Small-reach kernels use the x-space regionStepX (genuine cost ∝ |R|).
          const _wSharded = _mirRegion && !(_sb.slots[1].born && _sb.slots[1].mirror) && W.desc && W.descBase && W.descE0;
          _shardActive = !!_wSharded;
          if (_wSharded) { const rc2 = _shardRing(); const econKey = _E.kernelVer * 2 + (_shardDemoRing ? 1 : 0);
            if (_shardEconKv !== econKey) { let reach = 1, nt = 9;
              if (rc2?.o) for (const o of rc2.o) { nt += o.length >> 1; for (let i2 = 0; i2 < o.length; i2++) { const a2 = Math.abs(o[i2]); if (a2 > reach) reach = a2; } }
              _shardEconKv = econKey; _shardEconOk = reach <= 6 && nt <= 48; _shardEconInfo = { reach, nt };
              if (!_shardEconOk && !_shardWarned) { _shardWarned = true; console.log(`[REGION] kernel reach ${reach}, ${nt} terms → x-space regionStepX would be ~10× the spectral step (froze). DECLARATION-ONLY shard: whole spectral engine + region kept, outside frozen to the boundary. Deep interior exact; seam approximate (watch seam-glue). World partition is regional; per-machine FLOPs stay global (spectral engines don't shard compute — the honest limit). mu1.shardDemo(true) forces a small kernel to see the GENUINE x-space shard.`); }
              else if (_shardEconOk && _shardDemoRing) console.log(`[REGION] SHARD-DEMO active: reach ${reach}, ${nt} terms → GENUINE x-space shard (cost ∝ |R|, frozen boundary, diverging seam). ⚠ eH forked (local sandbox).`); }
            _shardXspace = _shardEconOk; }
          else _shardXspace = false;
          // x-space regional step (small kernels only): step W ONLY inside R, skip it in the turbo advance below.
          if (_shardXspace) { if (_turboOn && _gpu) _tbSyncSlot(0);
            let _cs = null; if (_K.edge) { let ae = false; for (let a2 = 0; a2 < 4; a2++) for (let b2 = 0; b2 < 4; b2++) if (_K.edge[a2][b2]) ae = true; if (ae) _cs = _sb.slots.map((s2) => (s2.descBase ? Float64Array.from(s2.descBase) : null)); }
            if (_attCadLeft > 0 && _attCadSlot === 0 && (k % 7) === 0) console.log(`[ATTCAD] STEP k=${k} W · regAttC=${_regAttC ? _hashField(_regAttC) : '—'} — W's target is rebuilt in the PER-STEP loop; compare its change rate against V's [ATTCAD] BAR lines`);
            _regStepRegion(W, _coupledAtt(0, _regAttC, _cs), _lensOp[0].beta || 1, _mirRegion);
            if (_turboOn && _gpu) { W._texDirty = true; _tbTexStep[0] = k + 1; } }
          if (_turboOn && _gpu) { if (_tbCur < 0) _tbCur = k;
            // SMOOTH LIVE DISPLAY: advance + refresh the DISPLAYED slot's film at Q cadence (3×/bar), the rest
            // only at bars. The soliton's SHAPE (breathing, wander) changes per step — a bar-locked envelope
            // reads as ~3fps choppy regardless of executor; resident textures made the one displayed-slot
            // readback cheap, so we can afford 3×/bar for it. Non-displayed slots stay bar-cadence.
            if (((k + 1) % Q) === 0) { _tbAdvanceAll(k + 1, _shardXspace ? 0 : -1);   // skip W only when x-space-sharded (stepped by regionStepX); declaration-only shard steps W whole-torus here
              // DISPLAY READBACK CADENCE (mu1.dispRate). PROFILED 2026-07-30: this single line is 83-91% of ALL GPU
              //   readbacks (~20/s, ~2.6 MB/s per peer). readPixels is a hard PIPELINE STALL, so with two peers on one
              //   GPU the stalls serialize against each other — the measured "lag with a 2nd browser open, gone when
              //   it closes". The 2018 comment above assumed "resident textures made the readback cheap"; the profile
              //   says otherwise. _dispEvery counts Q-blocks between film refreshes: 1 = 3x/bar (smoothest, the old
              //   behaviour), 3 = 1x/bar (a third of the readbacks). Render-side only — descDisp never enters regH,
              //   so this changes smoothness, never determinism.
              const _dispTick = (((k + 1) / Q) | 0) % _dispEvery === 0;
              // TEXTURE-DIRECT FILM: copy the viewed slot's live texture into its display film GPU-SIDE, at this
              //   SHARED step (exactly where descDisp used to refresh, so peers still show the same moment). No
              //   readback ⇒ no pipeline stall. The CPU-side descDisp path below still runs when _filmOn is off.
              // RETIRE A FILM THE MOMENT ITS SLOT STOPS BEING VIEWED (2026-08-01). filmCapture only ever runs for
              //   _viewSlot, but the render (and fieldH) will use ANY slot that still has a film — so a slot that was
              //   viewed earlier keeps serving a STALE film while its descBase moves on. Two peers viewing different
              //   slots therefore paint the same slot from films captured at different moments: measured on V, whose
              //   texSynced lagged texStep by 7–14 steps on the peer where V was not the viewed slot, with every
              //   other column (attH, e0, regH, solStep, β/φ/ω) identical. Dropping the film makes that slot fall
              //   back to descDisp, which the bar-cadence sync keeps current — correct, just not Q-smooth.
              if (_filmOn && _gpu && _gpu.dropFilm) { for (let fv = 0; fv < 4; fv++) if (fv !== _viewSlot && _filmStep[fv] >= 0) { _gpu.dropFilm(fv); _filmStep[fv] = -1; } }
              if (_filmOn && _gpu && !_frameLock && _dispTick) { const vsF = _viewSlot;
                // RESTORE THE DEFAULT EYE SELECTION after capturing. _tbAdvanceAll ends with selectEyeSlot(null) for
                //   exactly this reason: leaving a slot selected makes any later GPU op silently operate on that
                //   slot's ping-pong instead of the default eye buffer. Whether a later op runs before the next
                //   selectEyeSlot is FRAME-TIMING dependent — peer-local — which is how identical physics hashes
                //   (holdH/targetH match on both peers) can still render differently.
  if (_tbLive(vsF) && _gpu.filmCapture) { _gpu.selectEyeSlot(vsF); _gpu.filmCapture(vsF); _gpu.selectEyeSlot(null); _filmStep[vsF] = k + 1; } }
              if (!_frameLock && _dispTick && !_filmOn) { const vs = _viewSlot; if (_tbLive(vs)) { _tbSyncSlot(vs);
                // declaration-only-sharded W: the whole-torus texture evolved the OUTSIDE too — freeze it back to
                // the declared boundary at EVERY display refresh (not just at bars), else the outside jitters
                // (evolve at Q, snap at bar). This peer owns only R; outside is the static declaration.
                if (vs === 0 && _wSharded && !_shardXspace) _shardFreezeOutside();
                const sv = _sb.slots[vs]; if (sv.descBase) sv.descDisp = Float64Array.from(sv.descBase);
                // SHIFT-JITTER FIX (turbo-only, cat1100): the LIVE field carries its own transport (the pin drags
                // the soliton INSIDE descBase, synced here at Q). But _descPose ALSO adds a render offset
                // ox=leash−descPos that grows mid-bar as the leash moves → the render shifts the already-moving
                // field forward AGAIN (double-count), then descPos snaps at the bar → back-forward jitter. Since
                // the film now refreshes at Q, re-anchor descPos to the leash at the SAME Q cadence → ox stays ≈0
                // (the field's own motion IS the transport; pose keeps only the true sub-Q residual).
                sv.descPos = [sv.leash.state.gx, sv.leash.state.gy]; } }
            } }
          else if (!_shardXspace && W.descBase && W.descE0) {
            // CPU whole-torus W (not x-space-sharded — either unsharded, or a declaration-only shard which steps
            // W whole then freezes the outside below). Coupling snapshot as before.
            if (_K.edge) { let ae = false; for (let a2 = 0; a2 < 4; a2++) for (let b2 = 0; b2 < 4; b2++) if (_K.edge[a2][b2]) ae = true;
              if (ae) _cpuSnap = _sb.slots.map((s2) => (s2.descBase ? Float64Array.from(s2.descBase) : null)); }
            _regStep1(W, _coupledAtt(0, _regAttC, _cpuSnap), _lensOp[0].beta || 1); }
          if (!_turboOn) for (let li = 1; li <= 3; li++) { const VL = _sb.slots[li]; if (VL.desc && VL.descLive && VL.descBase && VL.descE0) { _regStep1(VL, _coupledAtt(li, VL.descAtt, _cpuSnap), (_lensOp[li].beta || 1) * _pinFac(VL, k));
            if (_stepTraceLeft > 0 && li === _stepTraceSlot) { _stepTraceLeft--;
              console.log(`[STEP] solStep=${k + 1} ${SLOTN[li]} · descBaseH=${_hashField(VL.descBase)} · attH=${VL.descAtt ? _hashField(VL.descAtt) : '—'} · e0=${(VL.descE0 ?? 0).toPrecision(17)} · beta=${((_lensOp[li].beta || 1) * _pinFac(VL, k)).toPrecision(17)}`); } } }   // ⌛pinHold: fade the plate-attractor drive after birth (0 = drive forever, the default)
          // THE KURAMOTO/XY LAW, MEDIUM-DRIVEN (v2 — the pure-descriptor version settled at the exact splay and
          // froze: a noiseless ODE parks at its equilibrium; the OLD medium's life came from the FIELDS kicking
          // the phases). Applied at Q boundaries (the old cadence, 3×/bar): each slot's phase entering the XY
          // sum is its MATTER phase — op∠ + arg⟨att,ψ⟩ (the measured lock offset) for living slots, the bare
          // descriptor angle for parked ones. The living medium's churn (SPM, kernel bumps) now drives wander
          // along the frustrated triangle's degenerate manifold — Law 2 ("dynamics, not states") restored,
          // deterministically (descBase = shared bytes; every term a pure fn of shared k).
          if (_K.edge && ((k + 1) % (_turboOn ? 21 : Q)) === 0) {   // turbo: bar cadence (descBase syncs at bars) with κ×3 = the Q-rate Euler equivalent
            if (_turboOn && _gpu) for (let ie = 0; ie < 4; ie++) { let touched = false; for (let je = 0; je < 4; je++) if (_K.edge[ie][je]) touched = true; if (touched) _tbSyncSlot(ie); }   // the XY law reads matter phases → sync ONLY the edge-connected slots (the cost of running the register XY machine; zero when no edges)
            const th = _lensOp.map((op, i2) => { const sl = _sb.slots[i2];
              const att2 = i2 === 0 ? _regAttC : sl.descAtt;
              if (sl.desc && sl.descBase && att2 && (i2 === 0 || sl.descLive)) {
                let rr = 0, im2 = 0; const f2 = sl.descBase;
                for (let j = 0; j < f2.length; j += 2) { rr += att2[j] * f2[j] + att2[j + 1] * f2[j + 1]; im2 += att2[j] * f2[j + 1] - att2[j + 1] * f2[j]; }
                return lensU1.angle(op) + Math.atan2(im2, rr); }
              return lensU1.angle(op); });
            // THE XY LAW itself is now the pure core kuramotoStep(th, edge, {gain, born}); the app owns only WHAT the
            // phase is (th above = op∠ + measured lock offset) and the apply/wrap below. turbo gain=3 = the Q-rate Euler
            // equivalent (bar cadence vs the 3×/bar Q cadence). born-gating: index 0 (W) always live.
            const { dth, any: anyK } = kuramotoStep(th, _K.edge, { gain: _turboOn ? 3 : 1, born: _sb.slots.map((s) => s.born) });
            if (anyK) { for (let ia = 0; ia < 4; ia++) if (dth[ia]) _lensOp[ia].phase = ((_lensOp[ia].phase + dth[ia]) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
              const barK = Math.floor((k + 1) / 21);
              if ((barK % 4) === 0 && _kurLogBar !== barK && ((k + 1) % 21) === 0) { _kurLogBar = barK;
                console.log(`[KUR] bar ${barK} · θ_matter=[${th.map((t) => lensU1.wrap(t).toFixed(2)).join(', ')}] · Δ(W,V)=${lensU1.wrap(th[0] - th[1]).toFixed(2)} Δ(W,P1)=${lensU1.wrap(th[0] - th[2]).toFixed(2)} Δ(V,P1)=${lensU1.wrap(th[1] - th[2]).toFixed(2)} — XY on MATTER phases (op∠ + measured lock offset). Splay Δ=±2.09 = the frustrated compromise (continuously degenerate); the absolute phases WANDER under the medium's churn — Law 2: dynamics, not states`); } }
          }
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
                      ? leashGainEnergy(W._engE ?? W.descE0 ?? 1, W.descE0 || 1)   // UNPINNED (ℂ*): TRUE register-field energy (the core coevo-gain twin) — admissible in ⌀PDE since v7 (_engE is a pure fn of shared state)
                      : leashGainPredicted(L, _COEVO_MAXLAG); _coevoG = g; return g; }) : null); }
              // the register SCHEDULE for a live MIRROR/AUTOC — pushed UNCONDITIONALLY per processed bar (even an idle
              // leash must anchor phi at each bar: the ω tick above changed it, and end-of-frame φ is peer-frame-local)
              if (si === 0) _attApplied.push({ atStep: k + 1, gx: s.leash.state.gx, gy: s.leash.state.gy, phi: lensU1.angle(_lensOp[0]) }); }
            // ── THE BISECTOR (mu1.forkDet) — hash the slot's ACTUAL state at a SHARED bar, always on ────────────
            //   Every other instrument here answers "do the inputs match NOW"; this one answers "WHEN did the state
            //   stop matching", which is the question left over when tbTrace shows identical attH/ringH/ver/cadence
            //   but a descBaseH that ALREADY differs at the first traced block. Runs at a shared bar off shared k,
            //   so the two peers' lines pair by bar= with no window-alignment problem (the trap that cost two
            //   rounds of tbTrace). Syncs first: under turbo descBase is stale between Q-blocks and hashing it
            //   unsynced would report a lag, not a fork.
            if (_forkDetEvery && (barA % _forkDetEvery) === 0 && _forkDetBar !== barA) { _forkDetBar = barA;
              const fs2 = _sb.slots[_forkDetSlot];
              if (fs2?.desc && fs2.descBase) { if (_turboOn && _gpu) _tbSyncSlot(_forkDetSlot);
                // A HASH CANNOT TELL "DIFFERENT STATE" FROM "SAME STATE, LAST MANTISSA BIT" (2026-08-03, measured).
                //   baseH is bit-exact, and this field rides the cap at the f32 floor: |engE−e0| wanders ~1.2e-4 on
                //   EACH peer independently, which is exactly the sqrt(32768)·2^-24·e0 = 1.8e-4 accumulation scale.
                //   So two peers that are physically identical still hash differently, forever, and baseH alone
                //   reports a permanent "fork" that is only float noise. Print SCALARS alongside it so the verdict
                //   is separable: |ψ|² and the pin-projection ⟨att,ψ⟩ (magnitude AND angle). Read them as:
                //     baseH differs + these scalars agree to ~1e-4  ⇒ f32 noise, NOT a fork (nothing to fix)
                //     baseH differs + argPin differs at 1e-2+       ⇒ a real GLOBAL PHASE fork (the pin/register)
                //     baseH differs + |ψ|² differs at 1e-2+         ⇒ a real AMPLITUDE/content fork (the cap/step)
                //   dE is |engE−e0| in units of the f32 floor: ≈1 is the noise band, ≫1 is physical.
                const _f2 = fs2.descBase; let _e2 = 0, _pr = 0, _pi = 0;
                const _a2 = fs2.descAtt || fs2._attHold;
                for (let j2 = 0; j2 < _f2.length; j2 += 2) { _e2 += _f2[j2] * _f2[j2] + _f2[j2 + 1] * _f2[j2 + 1];
                  if (_a2 && _a2.length === _f2.length) { _pr += _a2[j2] * _f2[j2] + _a2[j2 + 1] * _f2[j2 + 1]; _pi += _a2[j2] * _f2[j2 + 1] - _a2[j2 + 1] * _f2[j2]; } }
                const _floor = Math.sqrt(_f2.length >> 1) * Math.pow(2, -24) * (fs2.descE0 || 1);
                const _dE = Math.abs((fs2._engE ?? _e2) - (fs2.descE0 ?? 0)) / (_floor || 1);
                // TRACK argPin's OWN TREND, so a TRANSIENT is not mistaken for a FORK. The pin is a CONTRACTION
                //   toward a shared attractor, so two peers that start apart at a join must CONVERGE — measured
                //   0.034 → 0.032 → 0.020 → 0.007 → 0.003 rad over five sampled bars. A fork holds or grows; a
                //   decaying series is the lock doing its job. Print the per-sample change so the direction is
                //   visible in ONE peer's log without cross-peer diffing.
                const _ap = _a2 ? Math.atan2(_pi, _pr) : 0;
                const _apD = (_forkArgPrev != null) ? (_ap - _forkArgPrev) : NaN; _forkArgPrev = _ap;
                console.log(`[FORK] bar=${barA} k=${k + 1} ${SLOTN[_forkDetSlot]} · baseH=${_hashField(_f2)} · |ψ|²=${_e2.toPrecision(17)} argPin=${_ap.toPrecision(17)} Δ=${Number.isNaN(_apD) ? '—' : _apD.toExponential(3)} |pin|=${Math.hypot(_pr, _pi).toPrecision(17)} · dE=${_dE.toFixed(2)}×f32floor · e0=${(fs2.descE0 ?? 0).toPrecision(17)} engE=${(fs2._engE ?? 0).toPrecision(17)} · attH=${fs2.descAtt ? _hashField(fs2.descAtt) : '—'} holdH=${fs2._attHold ? _hashField(fs2._attHold) : '—'} · ∠=${lensU1.angle(_lensOp[_forkDetSlot]).toPrecision(17)} pos=[${fs2.descPos?.[0]},${fs2.descPos?.[1]}] leash=[${fs2.leash.state.gx.toPrecision(17)},${fs2.leash.state.gy.toPrecision(17)}] · regH=${_regH()} ver=${_E.kernelVer} — compare |ψ|²/argPin, NOT baseH: a bit-exact hash differs on f32 noise alone (dE≈1 = the noise band)`); } }
            // ── bar boundary of THE REGISTER ENGINE (see the per-step block above): f32-quantize the envelope
            //    (the wire lattice — a joiner must land on the leader's bytes), refresh the pin target at the
            //    new leash pose, retire the sl2 spec cache. Pose is render-side ONLY as the sub-bar frac — the
            //    field carries its own motion (the soliton CHASES the attractor inside the register field,
            //    wake and all, exactly as in the GPU medium).
            // bar boundary for every LIVING slot: display buffer (the shared film — the canvas must never
            // show a peer-local mid-bar step), pose re-anchor (render keeps only the sub-bar frac), pin-target
            // refresh at the slot's OWN leash (descgo drags a living memory via the pin chase, like W).
            // under turbo, descDisp (the display film) is needed ONLY for the slot the canvas shows (or all,
            // in Σ-view) — sync just those, not every living slot (the resident-texture win). Non-displayed
            // living slots keep advancing on the GPU untouched; their descBase syncs when a hash/verb needs it.
            const _dispNeeds = (si2) => !_turboOn || _viewAllOn || si2 === _viewSlot;
            for (let si2 = 0; si2 < 4; si2++) { const s3 = _sb.slots[si2];
              if (!s3.desc || !s3.descBase || (si2 > 0 && !s3.descLive)) continue;
              // x-space-sharded W is CPU-stepped (regionStepX) → descBase already current, don't sync the stale
              // texture. Declaration-only W stepped whole-torus (texture) → sync it, then FREEZE the outside to
              // the declared boundary (this peer owns only R).
              // TEXTURE-DIRECT: with the film on, descDisp is NOT the display source any more (the shader samples
              //   the GPU film), so this per-bar readback+copy is pure waste — and it was the LAST readback in the
              //   display path (profiled at 31–33% of all readbacks once the Q-cadence one was removed). Other
              //   consumers of descDisp (the ⊘/residual views, dispTrace) sync on demand, so nothing loses data.
              // The film only EXISTS under turbo (its capture lives in the turbo branch), so the descDisp refresh may
              //   be skipped only when turbo is actually on. Without the _turboOn term this froze the display in CPU
              //   mode: no film captured, yet descDisp suppressed ⇒ _drawDesc kept painting a stale buffer and the
              //   image stopped (regression from the texture-direct change, 2026-07-30).
              // BAR-BOUNDARY descBase SYNC IS AN INVARIANT, NOT A DISPLAY DETAIL (2026-07-31, after a determinism
              //   regression report). Before the texture-direct change, the display refresh happened to sync the
              //   viewed slot's descBase at every bar, and everything downstream — the XY law, the DET hash, ψATT
              //   adoption, the settle sampler — inherited a CURRENT descBase for free. Suppressing the readback for
              //   the film removed that guarantee, leaving only the paths that carry their own guard. Rather than
              //   audit every consumer forever, the sync is restored unconditionally at the BAR (once per bar per
              //   living slot, not the 3×/bar Q-cadence display refresh the film actually replaced). The film still
              //   removes the Q-cadence readbacks — the expensive ones — while the cheap bar-rate invariant stands.
              // THE BAR-CADENCE SYNC IS UNCONDITIONAL FOR LIVING SLOTS (2026-08-01). _dispNeeds is a DISPLAY predicate
              //   (`si2 === _viewSlot`), and _viewSlot is PEER-LOCAL — so gating the readback on it let a peer-local
              //   choice decide WHEN replicated state is sampled. Measured on V: the peer where V was not the viewed
              //   slot showed texSynced trailing texStep by a constant ~7 (one Q-block) on every row, and its |ψ|²
              //   sat 8.4e-6 below the cap while the other peer's sat exactly at it — same attH, same e0, same regH,
              //   same solStep. Display cadence may differ between peers; the SAMPLING STEP of shared state may not.
              //   (The descDisp COPY below stays display-gated — that is genuinely a render concern.)
              const _dispSync = true;
              // THE SKIP MUST MATCH _useFilm EXACTLY (2026-08-01). This suppressed the descDisp copy whenever the film
              //   was merely ENABLED, but the render only uses the film when one actually EXISTS (_useFilm also tests
              //   hasFilm && _filmStep[si] >= 0). After a join drops the films (JOIN-PRIME → dropFilm, _filmStep=-1)
              //   the joiner fell into the gap: no film to render from AND no descDisp refresh, so paint FROZE on the
              //   last copy — the restored bytes — while descBase advanced underneath. Measured: the leader's nowH
              //   changed every bar while the joiner's fieldH stayed pinned at the SHIPPED hash, yet tbTrace showed
              //   the joiner's texture stepping normally. Same predicate on both sides, so the gap cannot reopen.
              const _skipCopy = _filmOn && _turboOn && _gpu && si2 === _viewSlot
                && !!(_gpu.hasFilm && _gpu.hasFilm(si2)) && _filmStep[si2] >= 0;
              if (_turboOn && _gpu && _dispSync && !(si2 === 0 && _shardXspace)) _tbSyncSlot(si2);
              if (si2 === 0 && _wSharded && !_shardXspace) _shardFreezeOutside();
              if (_dispNeeds(si2) && !_skipCopy) s3.descDisp = Float64Array.from(s3.descBase);   // the display COPY stays view-gated (render concern); the SYNC above does not (shared-state sampling)
              // ── FRAME-LOCK FOR DESCRIPTOR SLOTS (2026-07-31). frameLock's contract is "identical shared index ⇒
              //   identical pixels", but its only capture (the _dispW/_dispWk pair) lives in the FIELD-MODE loop, so
              //   an 𝔸 descriptor slot had none: the label read film@k=-1 and locking quantized only the POSE (frac=0),
              //   leaving descBase at whatever step _tbSyncSlot last read back — measured 7–14 steps apart between
              //   peers, which is the residual visual difference. This captures the desc film AT THE SHARED BAR
              //   (`(k+1)%21===0`, barA is a pure fn of the replicated step) and stamps its index, so both peers
              //   display the same bytes from the same shared moment. Render-side only: _dispDesc never re-enters
              //   descBase, the register, or regH — it is a display copy, exactly as descDisp is.
              //   NOTE ON GRID: this block runs at the BAR ((k+1)%21===0), so the finest capture available here is one
              //   per bar. A _frameLockGrid of 7 (the Q sub-bar option) cannot be honoured from this site — it would
              //   silently degrade to bar cadence — so the effective grid is stated honestly as max(21, grid) and the
              //   label's stamped index tells the truth about what was actually captured.
              if (_frameLock && _dispSync && (((k + 1) % Math.max(21, _frameLockGrid)) === 0) && s3.descBase) {
                _dispDesc[si2] = Float64Array.from(s3.descBase); _dispDescK[si2] = k + 1; }
              s3.descPos = [s3.leash.state.gx, s3.leash.state.gy];
              // ── ψATT (selfatt): digest countdown + ADOPTION at the shared bar. While digesting, the att is null
              //    (pin lifted — the medium digests the injected pixels). At 0 the slot ADOPTS its own f32 state as
              //    the attractor: from then on att = _xattBuild(register op, Δpos, hold) — the field-borne symbol,
              //    rolled by the leash and rotated by the register's φ/ω. All at shared bars → peer-identical.
              if (s3._digestLeft > 0) { s3._digestLeft--;
                if (s3._digestLeft === 0) { if (_turboOn && _gpu && !(si2 === 0 && _shardXspace)) { _tbAdvanceAll(k + 1); _tbSyncSlot(si2); }   // adoption reads the PIN TARGET bytes: advance the texture to the SHARED bar step first (the store-verb pattern), else peers could capture different steps
                  s3._attHold = Float64Array.from(Float32Array.from(s3.descBase)); s3._attHoldPos = [s3.leash.state.gx, s3.leash.state.gy]; s3._holdKeyN = (s3._holdKeyN | 0) + 1; s3._attCache = null; s3._shiftCache = null; s3._holdBytesKey = null;
                  s3._holdPhi0 = lensU1.angle(_lensOp[si2]);   // the register angle AT CAPTURE — the hold is later rotated by ∠now − this (aging only), never by the absolute angle it already carries
                  // ── MEDIUM-SEMANTIC IDENTITY of the adopted symbol. Once ψATT drops the probe, `obj` (the foreign
                  //    name) no longer describes what the field carries — but sl(2) does: V and V̈ are invariant under
                  //    exactly the anchors the hold is allowed to move by (integer roll + global phase), so they name
                  //    the ADOPTED THING in the medium's own units. Telemetry only (never regH); recomputed on join.
                  s3._holdSl2 = _mkSl2(s3._attHold); s3._holdRef = null; s3._holdRefBar = barA + _HOLD_MIN; s3._holdRefPrev = null; s3._holdRefN = 0; s3._holdRefStuck = false;   // the SETTLED reference is taken later (by CONVERGENCE, see _HOLD_TOL): V₀ is a byte-freeze and the state relaxes off it
                  const _om = _lensOp[si2].omega || 0, _bt = _lensOp[si2].beta || 1;
                  console.log(`[MU1-ψATT] ${SLOTN[si2]} ADOPTED its field as the attractor @bar=${barA} — the symbol is now carried by the FIELD, not the probe. ${_om ? `ω=${_om.toFixed(3)}/bar → the pin target precesses: REGISTER-DRIVEN oscillation (expect liveliness ≈${(0.37 * Math.abs(_om)).toFixed(2)}; the probe-beat's was ≈0.19, matched at ω≈0.5).` : '⚠ ω=0 → the target is STATIC and the state is a FIXED POINT: it will freeze (measured liveliness 0.004). Set mu1.lensTau(0.3, "' + SLOTN[si2] + '") — after adoption the ONLY oscillator is the register clock, because the probe↔medium mismatch that used to beat is gone by construction.'}${_bt > 0.5 ? ` ⚠ β=${_bt.toFixed(2)} is HIGH for ψATT: the target is now the field's OWN state, so β is pure DAMPING (it clamps ψ to a rotating copy of itself), not drive. Liveliness ≈halves per +0.2β below 0.6 and saturates flat past ~0.7 — use mu1.pinBeta(0.3,"${SLOTN[si2]}") (or the β slider) and raise ω instead.` : ''}`); } }
              // the adopted attractor = the captured field TRANSLATED to the current leash offset and ROTATED by the
              //   slot's register angle. _xattBuild (not lensC1.apply) REGARDLESS of the xatt toggle, and that is
              //   deliberate: lensC1.apply REGENERATES from a probe base under a full operator (mode/rot/scale);
              //   a hold is a CAPTURED FIELD, and the only operations that keep it that field are a unitary shift +
              //   a global phase. THE ROTATION IS THE OSCILLATOR: lensU1.angle(op) is the very phase ω advances once
              //   per bar (the beat law below), so the pin target precesses — the field is chased by a rotating copy
              //   of itself. ω=0 ⇒ a static target ⇒ a fixed point (measured temporal 0.004); liveliness is LINEAR in
              //   ω (0.037 per 0.1 rad/bar) and reaches the probe-beat's own liveliness (~0.19) at ω≈0.5.
              // THE SETTLED IDENTITY REFERENCE: sampled at SHARED bars until successive samples CONVERGE, once the pin+cap
              //   relaxation transient off the f32 byte-freeze has run out. Everything before this is measured against
              //   the snapshot and flagged as such. Telemetry only — one FFT, once per hold.
              //   TURBO: descBase is STALE until _tbSyncSlot — the GPU holds truth. The display path above only syncs
              //   when _dispNeeds(si2), so a holding slot that isn't on screen would be sampled from old bytes: the
              //   convergence test would compare two stale reads, "converge" early, and freeze a wrong reference.
              //   Sync HERE, gated on the sample actually being due, so non-sampling bars cost nothing. (Determinism
              //   is not at stake either way — nothing reads _holdRef back into physics — but the numbers have to be
              //   worth trusting, which is the whole point of the instrument.)
              if (s3._attHold && !s3._digestLeft && !s3._holdRef && s3._holdRefBar >= 0 && barA >= s3._holdRefBar && s3.descBase && _E.ringCache?.r?.length) {
                if (_turboOn && _gpu && !(si2 === 0 && _shardXspace)) _tbSyncSlot(si2);   // same guard as the adoption capture above (the advance to this bar already ran)
                const smp = _mkSl2(s3.descBase);
                if (smp) { const prev = s3._holdRefPrev; s3._holdRefPrev = smp; s3._holdRefN = (s3._holdRefN | 0) + 1;
                  s3._holdRefBar = barA + _vptEvery;   // next sample at the telemetry cadence (one FFT per sample)
                  // CONVERGED = two successive samples agree to _HOLD_TOL, after at least _HOLD_MIN samples (the
                  // transient RISES before it falls, so an early pair can agree by crossing — the minimum blocks that).
                  const rel = prev && prev.V ? Math.abs(smp.V / prev.V - 1) : Infinity;
                  const stuck = s3._holdRefN >= _HOLD_MAX;
                  if ((s3._holdRefN >= _HOLD_MIN && rel <= _HOLD_TOL) || stuck) {
                    s3._holdRef = smp; s3._holdRefStuck = stuck && rel > _HOLD_TOL;
                    console.log(`[ψATT-ID] ${SLOTN[si2]} identity reference ${s3._holdRefStuck ? 'ACCEPTED WITHOUT CONVERGENCE' : 'CONVERGED'} @bar=${barA} after ${s3._holdRefN} samples: V=${smp.V.toExponential(3)} (adopted ${s3._holdSl2 ? s3._holdSl2.V.toExponential(3) : '?'}, relaxation ${s3._holdSl2 ? (100 * (smp.V / s3._holdSl2.V - 1)).toFixed(2) + '%' : '?'}, last step ${(100 * rel).toFixed(3)}%)${s3._holdRefStuck ? ' ⚠ the state never stopped moving — verdicts against this reference are provisional' : ' — drift is judged against this from now on'}`); } } }
              // PERF (2026-07-27): the ψATT target is a pure fn of (register angle, integer offset, hold bytes) — it
              //   changes only when one of those moves, but this ran EVERY BAR FOR EVERY ADOPTED SLOT, and each build
              //   is 2 FFTs via spectralShift. That is the store/recall lag: the plate path it replaced (_plateAtt)
              //   regenerates from a probe with no FFT, so adopting turned ~0 FFT/bar into 2·(living slots)/bar.
              //   Cache on the key; the zero-offset short-circuit in _xattBuild covers the stationary case as well.
              const _selfHold = () => { const op = _holdOp(si2, s3), dx = _holdDx(s3), dy = _holdDy(s3);
                // SPLIT THE BUILD: spectralShift (2 FFTs, 1.5ms) depends ONLY on (dx, dy, hold bytes); the register
                //   rotation is a scalar multiply that changes every bar with ω. So cache the SHIFTED field and apply
                //   the rotation fresh per call — VERIFIED byte-identical to the fused build at every offset/phase
                //   tested (0 differing values of 32768), because it is the same two ops in the same order, only the
                //   first one memoised. 30.5× faster per call; 3 living slots go from 4.57ms/bar to 0.15ms/bar.
                //   (Do NOT also short-circuit dx=dy=0 to a plain copy: spectralShift(b,0,0) differs from a copy by
                //   2.7e-15 on 32686/32768 values, and this is the PIN TARGET — regH. See the _xattBuild note.)
                // CACHE KEY = SHARED STATE ONLY (2026-07-31, after an edge+ψATT mismatch). The key must never contain a
                //   peer-local quantity: the XY law reads this att into _lensOp[].phase, which is in regH, so a cache
                //   that can differ between peers forks the register. _holdKeyN is bumped on adopt/recall/join — shared
                //   EVENTS, but the counter is peer-local bookkeeping — so it is NOT admissible in the key. Identity of
                //   the hold BYTES is what matters, so key on the bytes themselves (cheap hash of a few probes + length)
                //   plus the integer offset. Rebuild on any change; never serve a target built from different bytes.
                //   Sparse probing is NOT enough (measured: 8 probes miss a change between them), and this feeds regH —
                //   so use the full-field hash the determinism layer already trusts. It is O(N) but runs only when the
                //   key is re-derived, which is once per bar per holding slot, against a 2-FFT build it replaces.
                if (s3._holdBytesKey == null || s3._holdBytesSrc !== s3._attHold) { s3._holdBytesKey = _hashField(s3._attHold); s3._holdBytesSrc = s3._attHold; }
                const sk = `${dx}|${dy}|${s3._holdBytesKey}`;
                if (s3._shiftKey !== sk || !s3._shiftCache) { s3._shiftCache = spectralShift(s3._attHold, dx, dy, GRID); s3._shiftKey = sk; }
                const ph = lensU1.angle(op); if (!ph) return Float64Array.from(s3._shiftCache);
                const out = Float64Array.from(s3._shiftCache), c = Math.cos(ph), sn = Math.sin(ph);
                for (let j = 0; j < out.length; j += 2) { const r = out[j] * c - out[j + 1] * sn; out[j + 1] = out[j] * sn + out[j + 1] * c; out[j] = r; }
                return out; };   // aging-only rotation (_holdOp) + INTEGER roll (_holdDx)   // INTEGER shift — see _holdDx: a fractional resample of the hold rings at 13–17% and corrupts the pin target
              // ψATT FORK LOCATOR (mu1.wattDet): every input to the pin target, at a shared bar. Peer-local by
              //   design (a console reader), but every VALUE printed must be shared — that is exactly what it tests.
              if (_wattDetEvery && s3._attHold && !s3._digestLeft && (barA % _wattDetEvery) === 0 && _wattDetBar !== barA + si2 * 0.1) {
                _wattDetBar = barA + si2 * 0.1;
                const _dx = _holdDx(s3), _dy = _holdDy(s3), _op = _holdOp(si2, s3);
                console.log(`[ψDET] bar=${barA} ${SLOTN[si2]} · gx=${s3.leash.state.gx.toPrecision(17)} gy=${s3.leash.state.gy.toPrecision(17)} · holdPos=[${s3._attHoldPos?.[0]},${s3._attHoldPos?.[1]}] · dx=${_dx} dy=${_dy} · ∠=${lensU1.angle(_lensOp[si2]).toPrecision(17)} φ0=${(s3._holdPhi0 || 0).toPrecision(17)} · opPhase=${lensU1.angle(_op).toPrecision(17)} · holdH=${_hashField(s3._attHold)} · targetH=${_hashField(_selfHold())} · digest=${s3._digestLeft | 0} keyN=${s3._holdKeyN | 0}`); }
              if (_attCadLeft > 0 && si2 === _attCadSlot) { _attCadLeft--;
                console.log(`[ATTCAD] BAR ${barA} k=${k} ${SLOTN[si2]} · descAtt=${s3.descAtt ? _hashField(s3.descAtt) : '—'} · attHold=${s3._attHold ? _hashField(s3._attHold) : '—'} · dphiNow=${lensU1.angle(_lensOp[si2]).toPrecision(17)} — a BAR-cadence refresh: if this hash only moves once per 21 steps while the film is captured every 7, the film samples a state stepped against a STALE target`); }
              if (si2 === 0) { if ((barA % 4) === 0) W.sl2 = null;   // sl2 refresh at the VPT cadence (a per-bar rebuild profiled at 120ms/bar with the analytic v_g — 31% of the frame)
                _regAttC = W._digestLeft > 0 ? null : (W._attHold ? _selfHold() : W.movAtt(W.leash.state.gx, W.leash.state.gy)); }
              else if (s3._digestLeft > 0) s3.descAtt = null;
              else if (s3._attHold) s3.descAtt = _selfHold();
              else if (s3.descAttG) s3.descAtt = _plateAtt(s3.descAttG.dop, s3.descPos, s3.descAttG.obj); }
            if (_turboOn && (barA % 8) === 0 && _tbLogBar !== barA) { _tbLogBar = barA;
              console.log(`[TURBO] bar ${barA} · GPU executed ${_tbSteps} engine steps since the last report (CPU engine idle) — proof of engagement; mu1.pure() now counts these honestly`); _tbSteps = 0; }
            if (_mirRegion && !(_sb.slots[1].born && _sb.slots[1].mirror) && W.desc && W.descBase && _shardRef && _shardLogBar !== barA && (barA % 4) === 0) { _shardLogBar = barA;
              const reg = _mirRegion, BW = 16; let num = 0, ea = 0, eb = 0;
              for (let y = reg.y0; y < reg.y1; y++) for (let x = reg.x0; x < reg.x1; x++) {
                const depth = Math.min(x - reg.x0, reg.x1 - 1 - x, y - reg.y0, reg.y1 - 1 - y); if (depth >= BW) continue;
                const j = (y * GRID + x) * 2;
                num += W.descBase[j] * _shardRef[j] + W.descBase[j + 1] * _shardRef[j + 1]; ea += W.descBase[j] ** 2 + W.descBase[j + 1] ** 2; eb += _shardRef[j] ** 2 + _shardRef[j + 1] ** 2; }
              console.log(`[SHARD] bar ${barA} · region[${_mirRegionName}] ${_shardXspace ? `x-space regionStepX (cost ∝ |R| — shards COMPUTE; interior deep-exact, seam approximate) · seam-glue=${(ea > 0 && eb > 0 ? Math.abs(num) / Math.sqrt(ea * eb) : 1).toFixed(3)}` : 'DECLARATION-ONLY (whole spectral step; interior COMPUTED EXACTLY — the display outside is the declared boundary, ownership only; both peers compute the full field, spectral engines can\'t shard compute; seam-glue≈1 by construction)'} · ${(reg.x1 - reg.x0) * (reg.y1 - reg.y0)}/${N_CELLS} cells owned · ⚠eH shard-scoped (regH = the shared contract)`); }
            // eH is emitted only when the envelope is SYNCED at this step: always in CPU mode; under turbo ONLY
            // at bar boundaries (descBase lags mid-bar — a stale hash would be a false fork signal). regH (the
            // whole shared contract) is always current — it does not depend on the field bytes.
            const _eHsynced = !_turboOn || ((k + 1) % 21) === 0;
            if (_regTraceOn && ((((k + 1) / Q) | 0) % _detEvery === 0)) {
              // PERF (2026-07-30, profiled): this was 40% of ALL GPU readbacks — a full 4-slot drain every DET tick,
              //   purely to hash bytes for a console line. readPixels is a hard pipeline STALL, and with two peers on
              //   one GPU each stall drains the SHARED queue, so it degrades superlinearly in peers and vanishes when
              //   one browser closes (measured: ~4.4 MB/s of stalling transfer per peer with W/V/P1 living).
              //   regH — the whole shared contract — needs NO field bytes and is unaffected. The envelope hashes are
              //   a secondary check, so they ride a COARSER cadence (_detFieldEvery DET ticks) instead of every tick.
              //   Fork detection is preserved: regH still fires at full rate, and the field hashes still fire, rarer.
              // PROFILED 2026-07-30 (after the display path went texture-direct): this is now ~90% of ALL GPU
              //   readbacks — a full 4-slot drain per DET tick, ~20/s, ~2.8 MB/s per peer. readPixels STALLS the
              //   pipeline and two peers on one GPU serialize on it. W is the DRIVEN worldline: a fork appears in
              //   W's bytes first (V/P are pinned replicas of stored moments), so W is hashed EVERY tick — the
              //   per-tick guarantee is kept where it earns its cost — and the other living slots ride the coarser
              //   _detFieldEvery cadence. regH, the actual shared contract, is field-free and unaffected either way.
              const _eHnow = _eHsynced, _eHall = _eHsynced && ((_detTickN++ % _detFieldEvery) === 0);
              if (_turboOn && _gpu && _eHnow) { if (_eHall) _tbSyncAll(); else _tbSyncSlot(0); }
              console.log(`[DET-⌀] solStep=${k + 1} · regH=${_regH()} · eH=${!_eHnow ? '(field hash on the coarse cadence — regH above is the contract and is current)' : W.descBase ? (_shardActive ? `⚠shard[${_mirRegionName}]:` : '') + _hashField(W.descBase) : '—'}${_eHall ? [1,2,3].map((li) => _sb.slots[li].descLive && _sb.slots[li].descBase ? ` · e${SLOTN[li]}=${_hashField(_sb.slots[li].descBase)}` : '').join('') : ''} · bW=${_tauK ? (_tauK.beatsOf('W') ?? 0) : 0} kW=${_E.kwSteps} · kV=${_E.kernelVer} (register-only: regH + the living envelope hashes are the contract)`); }
          }
        }
        if (_turboOn && _gpu && _kernApplied.length) _tbAdvanceAll(_base + todo);   // frame-end advance on SWAP frames (flushes the lag before _kernApplied resets — the pre-swap ring)
        // W is synced at BAR boundaries only (in the descDisp block, when W is displayed — the common case).
        // The post-loop readers of W.descBase — vpt/sl2 (peer-local TELEMETRY, bar cadence anyway) and the
        // mirror seed (an occasional verb) — do NOT need sub-bar freshness, so NO per-frame readback here.
        // This removes the last per-frame gl.readPixels stall (profiled: even 1/frame blocked the whole frame
        // on GPU completion). If W is not the displayed slot AND a frame ends off a bar boundary, W.descBase
        // lags <1 bar — telemetry-acceptable, and the hash path syncs explicitly when it needs bytes.
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
                const g = leashGainEnergy(e, W.e0); _coevoG = g; return g; })   // the core coevo-gain twin (clamped [0,1]; the sigmoid saturates ≥1 anyway → gx/gy/regH identical, only _coevoG telemetry clamps)
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
              W.descBase = Float64Array.from(q); W._texDirty = true;
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
      // under turbo, the sl2/vpt telemetry reads W.descBase — sync W lazily ONLY when they're about to run
      // (both are throttled: sl2 on kernelVer change, vpt every _vptEvery bars). Rare → negligible vs a
      // per-frame readback; keeps the telemetry honest (current W bytes) without stalling every frame.
      // TELEMETRY MUST NOT DECIDE WHEN STATE IS SAMPLED (2026-08-02, same defect as line ~3810). The VPT terms here
      //   (_vptOn / _vptLogBar / _vptEvery) are ALL PEER-LOCAL, so this forced a readback of W at a moment the other
      //   peer never sampled. W happens to match today, but two peers with different VPT settings would diverge for a
      //   purely diagnostic reason. The sl2 re-key term IS shared (kernelVer), so keep that; drop the VPT trigger and
      //   let the telemetry read whatever the bar-cadence sync last left — stale telemetry beats a peer-local fork.
      if (_turboOn && _gpu && W.desc && (!W.sl2 || W.sl2.kv !== _E.kernelVer)) _tbSyncSlot(0);
      if (W.desc && W.descBase && _E.ringCache?.r?.length && (!W.sl2 || W.sl2.kv !== _E.kernelVer)) {
        const old = W.sl2; W.sl2 = old ? (_sl2Rekey(old) || _mkSl2(W.descBase)) : _mkSl2(W.descBase);
        if (old && W.sl2 && (_sl2KeyN++ % 8) === 0) console.log(`[SL2] RE-KEY kv ${old.kv}→${W.sl2.kv}: V̈ ${old.vdd.toExponential(3)}→${W.sl2.vdd.toExponential(3)} ⇒ ΔI=${(W.sl2.I - old.I).toExponential(2)} (FFT-free stencil re-sum over the compiled spectrum · logging every 8th re-key)`); }
      if (_vptOn && _vptLogBar !== _E.frameBar && (_E.frameBar % _vptEvery) === 0 && todo > 0) { _vptLogBar = _E.frameBar;
        const r = _vptRead(); if (r) { _vptLast = r;
          // the gate-F tier: the dated forecast (t* / t_c in engine time units, ÷DT for steps) + İ the maintenance power
          const elTxt = r.I == null ? '' : ` · I=${r.I.toExponential(2)}${r.Idot != null ? ` İ=${r.Idot.toExponential(1)} (sl2-work of pin+cap; 0 on free flight)` : ''}${r.rekey != null ? ` · re-key ΔI=${r.rekey.toExponential(1)} (kernel bump — the clock re-tuned V̈; bookkept out of İ)` : ''}${r.tFoc != null ? ` · freed: FOCUS in ${Math.round(r.tFoc / DT)} steps, waist V=${r.vMinP.toExponential(2)}` : r.tCol != null ? ` · freed: V→0 in ${Math.round(r.tCol / DT)} steps (dated collapse call)` : ''}`;
          const sl2Txt = (W.desc && W.sl2) ? ` · sl2-REG V=${W.sl2.V.toExponential(2)} (wit Δ=${(100 * (r.V / W.sl2.V - 1)).toFixed(1)}% — the register's charge vs the witness; held ⇒ stationary, the arrest law)` : '';
          // ψATT IDENTITY: what the medium says about the thing it adopted, in anchor-invariant charges. dV≈0 with a
          // position gap ⇒ the SAME state stalled short (a transport failure); dV drifting ⇒ a DIFFERENT state the
          // pin+SPM built (an identity failure). Those are physically different and this is the only line that tells
          // them apart — sl(2) is an identity CHECK, not a generator: it verifies, it cannot rebuild the field.
          const hd = _holdDrift(0);
          // the control for the per-bar line: only OTHER HOLDING slots can be stationary controls, and each costs an
          // FFT (~120ms) — so cap the survey at the slots that actually hold, and reuse slot 0's already-computed drift.
          const hdCm = !hd ? null : _holdCommon([{ ...hd, slot: 0 }].concat(
            _sb.slots.map((s4, i) => { if (!(i > 0 && s4?._attHold && !s4._digestLeft && s4._holdSl2)) return null;
              // NO SYNC HERE (2026-08-02). This telemetry survey forced a readback on holding slots, and the VPT
              //   cadence is PEER-LOCAL — so a diagnostic was deciding WHEN replicated state got sampled. Caught with
              //   mu1.syncDec: peer 1 showed an extra `caller=line3810` sync at solSteps=13286 while tbCur=13265
              //   (21 steps ahead — mid-frame), which shifted texSynced for every row after it; peer 2's log had only
              //   the bar-loop sync. That single extra call was the entire V asymmetry. The survey now reads whatever
              //   is current: a slightly stale control is a telemetry inaccuracy, a peer-local readback is a fork.
              return _holdDrift(i); })
              .filter(Boolean).map((d, i) => ({ ...d, slot: i + 1 }))));
          const hdTxt = !hd ? '' : ` \u00b7 \u03c8ATT-ID V=${hd.V.toExponential(3)} vs settled ref ${hd.Vref.toExponential(3)} \u21d2 dV=${(100 * hd.dV).toFixed(2)}%${(hdCm && hdCm.ok) ? ` (common-mode ${(100 * hdCm.com).toFixed(2)}% \u2014 relaxation, subtracted)` : ''}${hd.gap != null ? ` \u00b7 gap=${hd.gap.toFixed(2)}px` : ''} \u00b7 \u0394I=${hd.dI.toExponential(2)} \u2192 ${_holdVerdict(hd, hdCm)}`;
          console.log(`[VPT] bar ${_E.frameBar} · src=${r.src} · H=${r.H.toExponential(3)} (kin ${r.hk.toExponential(2)} nl ${r.hn.toExponential(2)}) · V=${r.V.toExponential(3)} · ${r.H < 0 ? '⚠ H<0 — would COLLAPSE if freed (the pin+cap are holding it: the VPT call, live)' : 'H>0 — would spread if freed'}${elTxt}${sl2Txt}${hdTxt}`); }
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
      // FROZEN PLATE VIEW: draw a STORED plate's `p` bytes directly — the raw MEMORY (and its damage), NOT stepped.
      // Local display; overrides the slot render. Console-only: mu1.plateView(i) (the UI 'live plate' shows the
      // EVOLVING soliton via mu1.livePlate — this is the raw-bytes alternative for inspecting exact stored content).
      if (_plateView >= 0 && _plates[_plateView]?.p) { _drawField(outCell, _plates[_plateView].p);
        outCell.setLabel(`PLATE ${_plateView + 1}/${_plates.length} (the stored memory itself · atStep=${_plates[_plateView].k}${_plates[_plateView]._dmg ? ` · ⊘ DAMAGED ${(100 * (1 - _plates[_plateView]._dmg)).toFixed(0)}% removed` : ''}) — mu1.plateView(-1) to return to the slot view`);
        _drawn = true; if (_viewSel.value !== SLOTN[_viewSlot]) _viewSel.value = SLOTN[_viewSlot]; _sX.setVal(tgtX); _sY.setVal(tgtY); return; }
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
      if (_frameLock && _fieldView === 'full') {   // field-view transforms (residual/bare) are live-computed → never skip-paint them
        const sig = _wViaMirror ? `WV:${_dispVk}:${_colorMode}:${_dials.view}`
          : (vsl && vsl.desc) ? `A${_viewSlot}:${vsl.descBar}:${lensU1.angle(_lensOp[_viewSlot]).toFixed(9)}:${vsl.leash.state.gx.toFixed(4)},${vsl.leash.state.gy.toFixed(4)}:${_colorMode}:${_dials.view}`
          : (_viewSlot === 1 && V.mirror) ? `V:${_dispVk}:${_colorMode}:${_dials.view}`
          : (_viewSlot === 0 && !W.desc) ? `W:${_dispWk}:${_colorMode}:${_dials.view}`
          : (_sb.slots[_viewSlot]?.desc && _dispDescK[_viewSlot] >= 0) ? `D${_viewSlot}:${_dispDescK[_viewSlot]}:${_colorMode}:${_dials.view}`   // desc slots key on their OWN shared index, else the subtick paint-skip never fires for them (it keyed on _dispWk, which a desc slot never sets)
          : null;
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
      // ⊘VIEW (local): draw the viewed slot's hosted PLATE `p` — the STORED RECORD in the bank, with its damage.
      // IT IS DELIBERATELY STATIC: a plate is a frozen record (written once at store, rewritten only by occludebank),
      // so nothing steps it — that is the whole contrast. ⊘view OFF shows the slot's LIVE reconstruction (descBase),
      // which the register steps every frame. Static = the memory · moving = the recalled soliton. Dragging the damage
      // slider DOES update this image (each damage rewrites p); it simply does not evolve between changes.
      if (_occView && _recalledInto[_viewSlot] >= 0 && _plates[_recalledInto[_viewSlot]]?.p) {
        const dpl = _plates[_recalledInto[_viewSlot]]; _drawField(outCell, dpl.p);
        outCell.setLabel(`⊘STORED PLATE ${_recalledInto[_viewSlot] + 1} hosted by ${vnm}${dpl._dmg != null ? ` · ${(100 * (1 - dpl._dmg)).toFixed(0)}% removed` : ''} — the MEMORY ITSELF (a frozen record: STATIC by nature, updates only when you damage it) at the shared T=${_VIRT_T} · ⊘view OFF = ${vnm}'s LIVE reconstruction of this same plate (register-stepped, moving)`);
        _drawn = true; if (_viewSel.value !== vnm) _viewSel.value = vnm; _sX.setVal(tgtX); _sY.setVal(tgtY); return; }
      // FIELD-VIEW (residual/bare) forces the CPU field path (the GPU 𝔸 shader has no ψ−A): use the slot's live
      // descBase (or descDisp) as ψ, then _fieldViewApply subtracts A / shows A. Only when a transform is active.
      const _fvActive = _fieldView !== 'full' && vsl && (vsl.descBase || vsl.field);
      if (_fvActive) { vfield = vsl.descDisp || vsl.descBase || vsl.field; _drawn = false; }
      else if (!_drawn && vsl && vsl.desc && !_wViaMirror) { _drawn = _drawDesc(outCell, _viewSlot); if (!_drawn) vfield = _descProject(_viewSlot); }
      else if (_dials.view === 'desc') vfield = (_viewSlot === 0) ? att : (vsl ? vsl.att : null);
      if (!_drawn) _drawField(outCell, _lensedView(_viewSlot, _fieldViewApply(_viewSlot, vfield)));
      const vop = _lensOp[_viewSlot];
      outCell.setLabel(`ψ_${vnm}${(vsl && vsl.born) || _viewSlot === 0 ? '' : ' (unborn)'} · ∠${lensU1.wrap(lensU1.angle(vop)).toFixed(2)}${vop.beta !== 1 ? ` β${vop.beta}` : ''}${vop.omega ? ` ω${vop.omega}` : ''}${_wViaMirror ? ' · LIVE via MIRROR (the physics of the register; 𝔸 declaration on the view cycle)' : vsl && vsl.mirror ? ' · MIRROR: live PDE injection-locked to the register' : vsl && vsl.desc ? ' · 𝔸 PREDICTIVE slot (descriptor-only, 0 grid steps)' : _dials.view === 'lens' ? ' · ∠lens view' : _dials.view === 'desc' ? ' · 𝔸 DESCRIPTOR render (register prediction — not ψ)' : ''}${_viewSlot === 0 ? ` · transport lock ${_E.lockNow.toFixed(2)}` : ''}${_frameLock ? ` · film@k=${(vsl && vsl.desc && _dispDescK[_viewSlot] >= 0) ? _dispDescK[_viewSlot] : (_viewSlot === 1 && V.mirror ? _dispVk : _dispWk)} (shared index: identical k ⇒ identical pixels)` : ''}${_mirRegion && V.mirror ? ` · shard:${_mirRegionName} (outside R = the declaration)` : ''}${_edgeTag(_viewSlot)}${_viewAllOn && W.desc ? ` · Σ VIEW (linear superposition of the slot declarations — this RENDER does not couple; ${_anyEdge() ? 'but an edge IS live → the slots ARE interacting in the STATE, shown above' : 'and no edge is set → the slots are truly independent'})` : ''}`);
      }
      // reflect the selector to only-born slots (W always; V/P when born — S6)
      if (_viewSel.value !== vnm) _viewSel.value = vnm;
      _sX.setVal(tgtX); _sY.setVal(tgtY);
      // reflect the register strip to the TARGETED slot's live descriptor (the bar5 law: position mirrors state)
      const rsi = SLOTN.indexOf(_regSlot); if (rsi >= 0) { _sBeta.setVal(_lensOp[rsi].beta); _sOm.setVal(_lensOp[rsi].omega);
        _regReadout.textContent = ` ${_regSlot}:∠${lensU1.wrap(lensU1.angle(_lensOp[rsi])).toFixed(2)} β${_lensOp[rsi].beta.toFixed(2)} ω${_lensOp[rsi].omega.toFixed(2)}${_sb.slots[rsi].born || rsi === 0 ? '' : ' (unborn)'}`; }
      _sVirtT.setVal(_VIRT_T);   // reflect the replicated hologram depth (a peer's virtt change / a join updates the slider)
      _sTempo.setVal(_tempoDiv);   // reflect the replicated proper-time divisor: a peer's manual change, a JOIN, or the auto-tempo governor raising it all show here (the governor is otherwise invisible)
      if (_objSel.value !== _lensObj && document.activeElement !== _objSel) _objSel.value = _lensObj;   // reflect WHAT the lock holds (set by the lensobj verb handler on every peer; restored on join)
      // reflect the DAMAGE slider + method — from _occFrac/_occMode, which the occludebank VERB HANDLER sets on EVERY
      //   peer at the shared step (and the snapshot restores on join). This is the identical mechanism as the working
      //   _sVirtT←_VIRT_T reflection; reading the world node directly proved unreliable here.
      _occDmg.setVal(_occFrac);   // reflect the damage level — _occFrac is set by the occludebank VERB HANDLER (runs on every peer at the shared step), exactly like _sVirtT←_VIRT_T. setVal's DRAG guard (not focus) lets this update the moment the drag ends.
      if (_occSel.value !== String(_occMode) && document.activeElement !== _occSel) _occSel.value = String(_occMode);   // same for the method dropdown
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
      // GPU EXECUTOR ON BY DEFAULT: once the register is live on a FRESH leader (never fired yet, GPU ready),
      // switch to turbo. Replicated → joiners adopt via the snapshot's turboOn; a peer that turned it off stays
      // off (guarded by _turboArmed, disarmed on any explicit toggle). mu1.turbo(false) drops to CPU.
      if (_turboArmed && !_turboOn && W.desc && _gpu && _solSeeded && todo > 0) { _turboArmed = false;
        console.log('[MU1-BOOT] GPU executor ON by default (mu1.turbo(false) for the universal CPU executor)');
        injectEvent?.({ type: 'mediumVirt', mode: 'turbo', amp: 1 }); }
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
