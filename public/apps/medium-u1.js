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
import { makeObserverBank, makeStepClock, makeCouplingStore, muxClocks, chainMeter, makeStampedInput, hashField as _hashField, hashNums as _hashNums, opNums as _opNums, ampCorr as _ampCorr, phaseCorr, syncClockRate } from '../medium-core.js';
import { makeSolitonEngine } from '../medium-gpu.js';
import { makeSlotBank, makeSlotMux, leashAdvance, leashDue } from '../medium-u1-slots.js';

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
    const _kernStep = (t) => Math.floor((t * _MON_RATE - _stepClk.c0) * STEPS_PER_PHASE / (_stepClk.rate || 1));
    let _solH = '--------', _solHStep = -1;   // solH = the FIELD hash captured at the last SHARED Q-boundary step (both peers pass through it identically → comparable across peers, unlike a frame-end hash)
    let _detEvery = 1;   // [DET] log every Q-boundary (7 steps) BY DEFAULT — fine enough to catch the first fork; regTrace(true,N) to coarsen
    // THE PIN STRENGTH (β) — the injection-lock stiffness (finding_pin_injection_lock). A stronger β makes the shared
    // attractor A dominate the field faster → lock→A tightens → each peer's ψ ≈ A ≈ every peer's ψ (images converge,
    // no field exchange). Tunable to find where the lock is tight without over-pinning (the original capped ~0.45).
    // LOCAL/peer-independent by default (a render-quality dial, not replicated) — but see mu1.pin() to sync it.
    let _pinBeta = _TRANSPORT_BETA;
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
      if (e.mode === 'record' || e.mode === 'recvia') { _recordV(e.amp || 0, k); return; }
      if (e.mode === 'store') { _storeMoment(k); return; }
      if (e.mode === 'recall') { _recallMoment(k); return; }
      if (e.mode === 'refamp') { if (si >= 0) { _lensOp[si].beta = (typeof e.amp === 'number') ? e.amp : 1; console.log(`[MU1] refAmp ${e.src} β=${_lensOp[si].beta.toFixed(2)} @step=${_E.solSteps}`); } }
      else if (e.mode === 'lenstau') { const w = e.amp || 0; for (const o of _lensOp) o.omega = w; console.log(`[MU1] lensTau ω=${w.toFixed(3)} @step=${_E.solSteps}`); }
      else if (e.mode === 'aphase') { if (si >= 0) { _lensOp[si].phase = ((_lensOp[si].phase + (e.amp || 0)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (si === 1 && V.att) { const c = Math.cos(e.amp || 0), s = Math.sin(e.amp || 0), r = new Float64Array(V.att.length);   // V/P: rotate the STORED att too (the register write lands in the field bytes)
          for (let j = 0; j < V.att.length; j += 2) { r[j] = V.att[j] * c - V.att[j + 1] * s; r[j + 1] = V.att[j] * s + V.att[j + 1] * c; } V.att = r; }
        console.log(`[MU1] aphase ${e.src} → ∠${_lensOp[si].phase.toFixed(3)} @step=${_E.solSteps}`); } } };
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
    W.movAtt = (gx, gy) => { if (!_psiBase) _rebuildBase(); if (!_psiBase) return null;
      // Op = the W readOp's exact scalars + the leash translation. A pure translation (tx,ty)=(gx,gy) reproduces the moved
      // probe exactly; W's register phase rides via Op.phase (lensC1.apply rotates by it). Deterministic: pure fn of Op+base.
      const op = { ...W.readOp, mode: 'metric', tx: gx, ty: gy };
      try { return lensC1.apply(op, _psiBase, GRID); } catch (e) { return null; } };

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
    const _drawField = (cell, f) => { if (!f || !_gpu || !_gpuCanvas) { cell.ctx.clearRect(0, 0, RW, RH); return; }
      const saved = _gpu.readEyePsi();                         // preserve the shared eye buffer
      _gpu.setEyePsi(f);
      _gpu.renderEyeField(_peakSq(f) * _GLOW);                 // AMPLITUDE hologram colormap (peak-scaled → less glow)
      _gpu.setEyePsi(saved);
      const ctx = cell.ctx, cw = cell.canvas.width, ch = cell.canvas.height, cellp = Math.min(cw, ch) / _VSIDE, dw = _VSIDE * cellp, offx = (cw - dw) / 2, offy = (ch - dw) / 2;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(_gpuCanvas, _VX0, GRID - (_VY0 + _VSIDE), _VSIDE, _VSIDE, offx, offy, _VSIDE * cellp, _VSIDE * cellp);   // Y-flip (GL bottom-up)
    };

    // ── SLOT VIEWS (S5): "eye/medium scopes" are re-derived as slot VIEWS. There is ONE view slot the observer looks
    //    at (default W = the world; select V/P to look at those). PERCEPTION = render the selected slot THROUGH its
    //    own readOp (lensU1.apply — the ψ_out = Op·ψ_in read primitive) when lensView is on; raw ψ otherwise. This
    //    dissolves the old two-scope UI: "which scope" becomes "which slot", and "the eye" is just viewing V. ──
    let _viewSlot = 0;                                       // which slot the outCell shows (0=W, 1=V, 2=P1, 3=P2)
    const _dials = { lensView: false };                     // raw ↔ through-readOp (the ∠lens perception view)
    const _lensedView = (sl, f) => (_dials.lensView && f && (lensU1.angle(_lensOp[sl]) || _lensOp[sl].mode !== 'id')) ? lensU1.apply(_lensOp[sl], f, GRID) : f;   // render THROUGH the slot's readOp (metric/gauge = real transformed views, grid-exact)

    // ── S6: RECORD (births V) + STORE (banks a moment) + RECALL — the dual-layer holography verbs (peer-replicated
    //    via the reflector, applied at the shared drain step). record: freeze W → V's field (GPU round-trip) AND set
    //    V's descriptor phase — the DUAL plate born together. store: bank BOTH plates. recall: cue⊗bank → lift best +
    //    the [RECALL-∠] equivalence (field aging Δ∠ vs the descriptor-only ω·Δτ prediction — the headline). ──
    const _recordV = (phi, k) => { if (!_gpu || !W.field) return;
      const wSave = _gpu.readEyePsi();
      const rvOp = { mode: 'id', phase: phi || 0, beta: 1, omega: 0, prec: 0 };
      // V's held OPERATOR = W's current ATTRACTOR (the probe field at W's leash position — the operator W was living
      // UNDER), NOT W's field. This is the fix for "view:V frozen after record": holding V toward a copy of its OWN
      // field pins it rigidly (att≈field → the pin does nothing → static); holding it toward the OPERATOR gives it a
      // distinct attractor to live at (like recall, which holds toward the banked probe att pl.a). Matches the oracle
      // (virtAtt = io.att() = the W attractor, line 317), not W.field.
      const wAtt = W.movAtt(W.leash.state.gx, W.leash.state.gy) || W.field;
      V.att = phi ? lensU1.apply(rvOp, wAtt) : wAtt.slice();
      _gpu.setEyePsi(W.field);
      _gpu.stepEyeN(_VIRT_T, DT); const holo = _gpu.readEyePsi();        // RECORD: the hologram plate (forward)
      _gpu.stepEyeN(_VIRT_T, -DT); let lift = _gpu.readEyePsi();         // LIFT: reversed clock → live copy (backward)
      if (phi) lift = lensU1.apply(rvOp, lift);
      _gpu.setEyePsi(wSave);
      let ve = 0; for (let j = 0; j < lift.length; j++) ve += lift[j] * lift[j];
      V.field = lift; V.e0 = ve || 1; V.born = true; V.hold = true;     // V born: its OWN recorded att, held (parked at the remembered moment)
      _lensOp[1].phase = phi ? ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : 0; _lensOp[1].prec = 0; _lensOp[1].omega = _lensOp[0].omega;   // V's descriptor = the birth lens (DUAL plate: the register moment)
      V.leash.release();
      console.log(`[MU1-VIRT] recorded+lifted V atStep=${k}${phi ? ` · THROUGH LENS φ=${phi.toFixed(3)}` : ''} · lift fidelity vs W = ${_ampCorr(lift, wSave).toFixed(4)} (T=${_VIRT_T}) · V BORN (dual plate: field + descriptor ∠${lensU1.wrap(lensU1.angle(_lensOp[1])).toFixed(3)})`); };
    const _storeMoment = (k) => { if (!_gpu || !W.field) return;
      const wSave = _gpu.readEyePsi(); _gpu.setEyePsi(W.field); _gpu.stepEyeN(_VIRT_T, DT); const plate = _gpu.readEyePsi(); _gpu.setEyePsi(wSave);
      _plates.push({ p: plate, a: W.movAtt(W.leash.state.gx, W.leash.state.gy), dop: { ..._lensOp[0] }, bw: _tauK ? (_tauK.beatsOf('W') ?? 0) : 0, k });   // BOTH plates: field (p) + descriptor (dop = W's (M,O) copy)
      if (_plates.length > BANK_MAX) _plates.shift();
      console.log(`[MU1-VIRT] STORE atStep=${k} — plate ${_plates.length}/${BANK_MAX} banked (dual: field + descriptor ∠${lensU1.wrap(lensU1.angle(_plates[_plates.length - 1].dop)).toFixed(3)}, bw=${_tauK ? (_tauK.beatsOf('W') ?? 0) : 0})`); };
    const _recallMoment = (k) => { if (!_gpu || !_plates.length || !W.field) return;
      // cue = W now, propagated to plate space; bind against the bank (content-addressed); best = argmax overlap
      const wSave = _gpu.readEyePsi(); _gpu.setEyePsi(W.field); _gpu.stepEyeN(_VIRT_T, DT); const cue = _gpu.readEyePsi(); _gpu.setEyePsi(wSave);
      let best = 0, bc = -1; const scores = _plates.map((pl, i) => { const c = _ampCorr(cue, pl.p); if (c > bc) { bc = c; best = i; } return +c.toFixed(3); });
      const pl = _plates[best];
      // FIELD-PLATE lift (the IMAGE): reversed clock on the stored plate → V's field
      _gpu.setEyePsi(pl.p); _gpu.stepEyeN(_VIRT_T, -DT); V.field = _gpu.readEyePsi(); _gpu.setEyePsi(wSave);
      let ve = 0; for (let j = 0; j < V.field.length; j++) ve += V.field[j] * V.field[j]; V.e0 = ve || 1; V.att = pl.a || V.att; V.born = true; V.hold = true;
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

    // ── S7: JOIN SNAPSHOT (the medium.js idiom, user-preferred: snapshot AT JOIN, not a periodic checkpoint). The
    //    platform asks a live peer for a state snapshot via world.ps.app._snapHook, ships it OFF the render path, and
    //    sets _snapshotApplied on the joiner — who restores VERBATIM then tracks forward. Engine SLICE via the G3 codec
    //    (_E.saveEngine/restoreEngine, the app owning _stepClk.c0); the SLOT registers (bank + leash/flags) + the plate
    //    bank ride alongside. Typed fields ship as plain arrays (the framework reviver handles the wire). ──
    const _takeSnap = () => { const eng = _E.saveEngine({ stepClkC0: _stepClk.c0, torbE0: W.e0, transPx: W.leash.state.gx, transPy: W.leash.state.gy });
      return {
      eng: { ...eng, psiLensed: eng.psiLensed ? Array.from(eng.psiLensed) : null },   // WIRE: the typed field → a plain array (the framework serializer can't carry Float64Array; the app owns this boundary, per G3)
      stepClk: { rate: _stepClk.rate, ratePrev: _stepClk.ratePrev },
      bank: _bank.save(),                                             // the observer readOps (all 4 descriptors)
      slots: _sb.save(),                                             // per-slot leash/flags/kind (S1 codec)
      slotFields: _sb.slots.map((s) => s.field ? Array.from(s.field) : null),   // each slot's canonical ψ (the plate/live fields)
      slotAtt: _sb.slots.map((s) => s.att ? Array.from(s.att) : null),
      K: { edge: _K.edge ? _K.edge.map((r) => [...r]) : null, capPh: _K.capPh, capStep: _K.capStep, src: _K.src.map((s) => s ? Array.from(s) : null) },
      plates: _plates.map((pl) => ({ p: Array.from(pl.p), a: pl.a ? Array.from(pl.a) : null, dop: { ...pl.dop }, bw: pl.bw, k: pl.k })),
      tauK: _tauK ? _tauK.save() : null,
      shiftSeen: _siShift.saveCursor(), regSeen: _siReg.saveCursor(),   // the shift + register-verb cursors (+ pending stamped entries ride tauK.save via the 'shift'/'reg' queues — a mid-slide joiner applies them at their startSteps)
      lastTgt: [_lastTgtX, _lastTgtY], driveMode: _driveMode,
      // THE IFS KERNEL THE LEADER WAS STEPPING THROUGH AT THE SNAPSHOT STEP — version-matched to the shipped field. The
      // joiner MUST step through THIS ring, NOT the node's live ring: if the fractal clock advanced the ring version between
      // the leader's capture and the joiner's apply (a join landing at/after a kernel bump), the node's ring is a DIFFERENT
      // version than the field → the joiner steps a vN field through a v(N+1) kernel → intermittent post-restore fork.
      // DEEP-copy the offsets (array-of-arrays, per tier) to PLAIN nested number arrays so they survive the JSON wire
      // (a shallow Array.from keeps inner typed arrays that can serialize to length-less objects → 0 offset points → freeze).
      kernelVer: _E.kernelVer, ring: _E.ringCache ? { r: Array.from(_E.ringCache.r), w: Array.from(_E.ringCache.w), o: (_E.ringCache.o || []).map((tier) => Array.from(tier || [])) } : null,
    }; };
    const _restoreSnap = (s, n) => { if (!s) return;
      _E.restoreEngine(s.eng, { setStepClkC0: (c0) => { _stepClk.c0 = c0; }, setTorbE0: (e0) => { W.e0 = e0; }, setTransP: (x, y) => { W.leash.state.gx = x; W.leash.state.gy = y; } });
      if (s.stepClk) { _stepClk.rate = s.stepClk.rate ?? 1; _stepClk.ratePrev = s.stepClk.ratePrev ?? 1; }
      _bank.restore(s.bank); _sb.restore(s.slots);
      for (let i = 0; i < _sb.slots.length; i++) { _sb.slots[i].field = s.slotFields?.[i] ? Float64Array.from(s.slotFields[i]) : _sb.slots[i].field;
        _sb.slots[i].att = s.slotAtt?.[i] ? Float64Array.from(s.slotAtt[i]) : _sb.slots[i].att; }
      W.field = _E.psiLensed;   // the engine slice restored psiLensed = W's field (they are the same store)
      _K.edge = s.K?.edge ? s.K.edge.map((r) => [...r]) : null; _K.capPh = s.K?.capPh ?? -1; _K.capStep = s.K?.capStep ?? -1;
      for (let i = 0; i < 4; i++) _K.src[i] = s.K?.src?.[i] ? Float64Array.from(s.K.src[i]) : null;
      _plates.length = 0; for (const pl of (s.plates || [])) _plates.push({ p: Float64Array.from(pl.p), a: pl.a ? Float64Array.from(pl.a) : null, dop: { ...pl.dop }, bw: pl.bw, k: pl.k });
      if (_tauK && s.tauK) { _tauK.restore(s.tauK); _siShift.reattach(); _siReg.reattach(); }   // restore replaces the queue RECORDS → re-attach BOTH handles (they closed over the old records); pending mid-slide shifts + register verbs now drain at their stamped startSteps
      _siShift.restoreCursor(s.shiftSeen | 0); _siReg.restoreCursor(s.regSeen | 0);
      _lastTgtX = s.lastTgt?.[0] ?? NaN; _lastTgtY = s.lastTgt?.[1] ?? NaN; if (typeof s.driveMode === 'string') _driveMode = s.driveMode;
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
    if (world?.ps?.app) world.ps.app._snapHook = (worldSnap) => { if (_solSeeded && W.field) { worldSnap.medSnapU1 = _takeSnap();
      console.log(`[MU1-SNAP] leader captured @ solStep=${_E.solSteps} · fieldH=${_hashField(W.field)} (the joiner's restoredFieldH MUST equal this) · c0=${_stepClk.c0.toFixed(4)}`); }
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
    // lensView: render the viewed slot RAW or THROUGH its readOp (the perception ∠lens view). LOCAL display toggle.
    const _lvBtn = mkBtn('view:raw', false, () => { _dials.lensView = !_dials.lensView; _lvBtn.textContent = _dials.lensView ? 'view:∠lens' : 'view:raw'; _lvBtn._on = _dials.lensView; }); bar1.appendChild(_lvBtn);
    // S6 dual-layer holography controls (replicated verbs):
    bar1.appendChild(mkBtn('⎙rec', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'record' })));   // record → births V (dual plate)
    bar1.appendChild(mkBtn('store', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'store' })));    // bank the moment (both plates)
    bar1.appendChild(mkBtn('recall', false, () => injectEvent?.({ type: 'mediumVirt', mode: 'recall' })));  // cue⊗bank → lift + [RECALL-∠] equivalence

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
    const _chainSlots = () => _sb.slots.filter((s) => s.born || s.field).map((s) => ({ name: s.name, field: s.field, op: s.readOp }));
    // ── regH: THE DESCRIPTOR-TIER DETERMINISM HASH (the contract — two peers MUST match at equal step). It hashes ONLY
    //    exact-arithmetic state: every readOp's scalars, each slot's τ_i beat count + born flag, the coupling edges, the
    //    plate descriptors (M,O) + their bw, and the shared step k. NO field bytes → no GPU/f32/ULP → byte-identical
    //    across peers BY CONSTRUCTION. This is the ℂ*-descriptor payoff: the register (what computes/ages/remembers) is
    //    deterministic for free; the field (fieldH) is a peer-local image that MAY drift. regH✗ = a real fork; fieldH✗
    //    alone = benign float noise (the physics agrees — the register is intact).
    const _regH = () => _hashNums([
      _E.solSteps, _stepClk.rate,
      ..._lensOp.flatMap((op) => _opNums(op)),
      ..._sb.slots.flatMap((s) => [s.born ? 1 : 0, _tauK ? (_tauK.beatsOf(s.name) ?? 0) : 0, s.leash.state.go ? 1 : 0, Math.round(s.leash.state.gx * 100), Math.round(s.leash.state.gy * 100)]),
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
        aphase: (a = 0.1, slot = 'W') => injectEvent?.({ type: 'mediumVirt', mode: 'aphase', amp: +a, src: slot }),
        lensTau: (w = 0.1) => injectEvent?.({ type: 'mediumVirt', mode: 'lenstau', amp: +w }),
        // regTrace(on) — the DETERMINISM GATE instrument: log [REGH] step=… regH=… fieldH=… on a SHARED cadence (every
        // 200 steps, a pure fn of the shared step so both peers log at the SAME step= values). Compare the two consoles:
        // regH MUST match line-for-line at equal step= (the contract); fieldH may differ (benign). Off by default.
        regTrace: (on = true, every = 4) => { _regTraceOn = !!on; _detEvery = Math.max(1, every | 0); return `[DET] trace ${_regTraceOn ? `ON — every ${_detEvery * Q} steps · compare regH + solH across peers at equal solStep= (regTrace(true,1) = every ${Q} steps to find the first fork)` : 'OFF'}`; },
        // pin(β) — the IMAGE-CONVERGENCE tuner (finding_pin_injection_lock): raise β to tighten lock→A. A tight lock means
        // each peer's ψ ≈ the shared attractor A ≈ every peer's ψ → the images converge (no field exchange, pure local
        // lock to a regH-shared reference). Watch 'lock→A' in the status climb toward 1 as you raise β. Set the SAME β on
        // both peers to compare fairly (it's a local render dial, not replicated). Original capped ~0.45; try 0.3–0.45.
        pin: (b) => { if (typeof b === 'number') _pinBeta = Math.max(0, Math.min(1, b)); return `[PIN] β=${_pinBeta.toFixed(2)} · lock→A now ${_E.lockNow.toFixed(3)} (→1 = images converge to the shared attractor)`; },
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
      hdr.textContent = `medium-u1 (SLOT-CENTRIC) · ${n.cachedRadii?.length ? 'RUNNING' : 'waiting…'} · drive:${_driveMode} · β ${_pinBeta.toFixed(2)} · lock→A ${_E.lockNow.toFixed(2)} · step ${_E.solSteps} · regH ${_regH()} (MUST match) · solH@${_solHStep} ${_solH} (field @ shared boundary — compare peers here)`;
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
        : ((n.medVirtSeq | 0) > _siReg.seen ? [{ seq: n.medVirtSeq | 0, time: n.medVirtTime ?? 0, mode: n.medVirtMode || 'record', amp: (typeof n.medVirtAmp === 'number') ? n.medVirtAmp : 0, src: n.medVirtSrc || 'W' }] : []);
      _siReg.pull(_vlog, (e) => ({ mode: e.mode, src: e.src || 'W', amp: (typeof e.amp === 'number') ? e.amp : 0 }));

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
      if (!_E.solInit) { _stepClk.c0 = _E.monClock; _E.solSteps = 0; _E.kwSteps = 0; _E.solInit = true; console.log(`[MU1-SEED] self-seed (fresh leader or snapshot grace expired) @ readyFrames=${_E.readyFrames} n.time=${(n.time ?? 0).toFixed(2)} kernelVer=${n.cachedRadiiVersion | 0}`); }
      // MUX PROPER-RATE CLOCK (the backlog-spiral fix, [[finding-mux-proper-rate-clock]]): each live slot beyond W adds
      // a FULL todo-loop of GPU work per frame (W-drive + V-drive + … = nSl×todo), but `target` is driven by WALL-CLOCK
      // at the full rate → it demands nSl× more steps than the frame can execute → the backlog COMPOUNDS (live-caught:
      // todo 41→191→411→602 after V born, recordV's 31ms stall seeding it). Fix: the operator's clock runs in MATTER
      // proper-time — `target` advances at 1/nSl. nSl = live slots (a pure fn of replicated born-state → byte-identical).
      // Re-anchor c0 at a rate CHANGE so the step count stays CONTINUOUS (c0 += k·(rateOld−rateNew)/spp).
      const _nSl = _sb.slots.reduce((a, s) => a + (s.born ? 1 : 0), 0) || 1;
      // MIRROR the step-clock rate flip onto the τ KERNEL when the live-slot count changes (V born → nSl 1→2). Factored into
      // medium-core.syncClockRate — without it _tauK keeps the old rate while the drive runs at nSl proper-rate → verb stamps
      // land ~nSl× ahead of the drive → a growing backlog → store/recall fire seconds late (see the helper's comment).
      syncClockRate(_stepClk, _tauK, _E.solSteps, _nSl);
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

      // W-HOME DRIVE (the buffer home; the coevolve-chase). Seed once from the att, then self-sustain: each step
      // superpose toward W.movAtt(gx,gy) + stepSoliton. The leash advances gx/gy per W's proper-step (τ_W cadence).
      const save = _gpu.readEyePsi();
      let att = W.movAtt(W.leash.state.gx, W.leash.state.gy);
      if (!_solSeeded) { _gpu.setEyePsi(att || save); _solSeeded = true; W.born = true;
        let e = 0; const s0 = att || save; if (s0) for (let j = 0; j < s0.length; j++) e += s0[j] * s0[j]; W.e0 = e || 1; _solE0 = -1; }
      else _gpu.setEyePsi(W.field || save);
      if (att) _gpu.setObjField(att);
      const _base = _E.solSteps - todo;
      _E.muxStepped[0] = _E.muxStepped[1] = _E.muxStepped[2] = _E.muxStepped[3] = 0;
      _kernApplied.length = 0;   // per-frame record of kernel swaps applied in W's loop (step→ring) → V replays them identically
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
          // DESCRIPTOR-ONLY leash (field=null → replay-safe): gx/gy advance is a pure fn of the leash state (no field
          // read), so it stays exact-arithmetic (in regH). The soliton is always locked to A=Op·ψ_base, so the field-fed
          // coherence-stall isn't needed — the descriptor moves at the steady ≤1px/beat and the pinned field follows.
          const _gx0 = W.leash.state.gx, _gy0 = W.leash.state.gy;
          if (leashDue(W.leash.state, _E.kwSteps, null)) leashAdvance(W.leash.state, null, (gx, gy) => W.movAtt(gx, gy), null);
          // REGENERATE att ONLY WHEN gx/gy ACTUALLY MOVED — the oracle's "ONE att per frame, stationary across the loop"
          // form (line 2529): keep the obj texture loaded and stationary until the target moves. A pure efficiency/clarity
          // match to the oracle (att = Op·ψ_base is deterministic either way, so this isn't the determinism mechanism —
          // the FIELD fork was the IFS kernel, synced separately; see the shared-step kernel swap at the loop top).
          if (W.leash.state.gx !== _gx0 || W.leash.state.gy !== _gy0) { att = W.movAtt(W.leash.state.gx, W.leash.state.gy); if (att) _gpu.setObjField(att); }
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
          _solH = _hashField(q); _solHStep = k + 1;
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
      const out = _gpu.readEyePsi(); _gpu.setEyePsi(save);
      W.field = out; _E.psiLensed = out;
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
        console.log(`[MU1:${_driveMode}] bar ${_E.frameBar} · E×${(e / _solE0).toFixed(2)} · Wpos(${cx.toFixed(1)},${cy.toFixed(1)}) · leash g=(${W.leash.state.gx.toFixed(2)},${W.leash.state.gy.toFixed(2)}) → tgt(${tgtX},${tgtY}) · lock ${_E.lockNow.toFixed(3)} · todo=${todo} · wH=${_hashField(out)}`); }
      // [DET] is now emitted INSIDE the drive loop at every shared Q-boundary (see above) — the frame-end emit is gone
      // (it only saw the last boundary of the frame, hiding mid-frame forks). _regTraceLast retired.

      // render: outCell = the SELECTED slot, THROUGH its readOp (perception view). "which scope" is now "which slot"
      // (the eye/medium scopes re-derived as slot views, S5). The source canvas (inCell) is HIDDEN — no draw needed.
      const vsl = _sb.slots[_viewSlot], vfield = (vsl && vsl.born) ? vsl.field : (_viewSlot === 0 ? out : null);
      _drawField(outCell, _lensedView(_viewSlot, vfield));
      const vnm = SLOTN[_viewSlot], vop = _lensOp[_viewSlot];
      outCell.setLabel(`ψ_${vnm}${(vsl && vsl.born) || _viewSlot === 0 ? '' : ' (unborn)'} · ∠${lensU1.wrap(lensU1.angle(vop)).toFixed(2)}${vop.beta !== 1 ? ` β${vop.beta}` : ''}${vop.omega ? ` ω${vop.omega}` : ''}${_dials.lensView ? ' · ∠lens view' : ''}${_viewSlot === 0 ? ` · transport lock ${_E.lockNow.toFixed(2)}` : ''}`);
      // reflect the selector to only-born slots (W always; V/P when born — S6)
      if (_viewSel.value !== vnm) _viewSel.value = vnm;
      _sX.setVal(tgtX); _sY.setVal(tgtY);
      // reflect the register strip to the TARGETED slot's live descriptor (the bar5 law: position mirrors state)
      const rsi = SLOTN.indexOf(_regSlot); if (rsi >= 0) { _sBeta.setVal(_lensOp[rsi].beta); _sOm.setVal(_lensOp[rsi].omega);
        _regReadout.textContent = ` ${_regSlot}:∠${lensU1.wrap(lensU1.angle(_lensOp[rsi])).toFixed(2)} β${_lensOp[rsi].beta.toFixed(2)} ω${_lensOp[rsi].omega.toFixed(2)}${_sb.slots[rsi].born || rsi === 0 ? '' : ' (unborn)'}`; }
      if (core._renderAvatars) core._renderAvatars(world, root);
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
