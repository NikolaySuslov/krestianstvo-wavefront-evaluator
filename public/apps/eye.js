/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── Eye | IFS Live Holographic Observer ──────────────────────────────────────
//
// Live eye demo using IFSEye from holography.js.
// The object wavefront propagates T steps to the eye aperture (hologram domain),
// an optional H transform is applied, then T backward steps reconstruct the percept.
// The percept relaxes onto a stable IFS soliton eigenstate.
//
// Three eye canvases (always visible):
//   EYE |ψ_arrived|²   — received wavefront at aperture
//   EYE |ψ_percept|²   — settled soliton percept (memory + hysteresis)
//   EYE |ψ_evidence|²  — raw inverse (exact reconstruction / scored)
//
// Three main soliton canvases (toggleable via EYE ONLY):
//   IFS field, IFS phase, IFS plate
//
// Reuses hologram4WorldProgram (same IFS clock, same Croquet/Renkon world).

import { IFSGpu } from '../ifs-gpu.js';
import { IFSEye, IFSSound } from '../holography.js';
import '../holography-research.js';   // side-effect: augments IFSEye.prototype with the §9/§7.45-7.52 research probes
import { makeRegion, makeCarrier, regionEventSoliton, regionWaveSoliton, imageSoliton, gate, recognizeFull, operatorSoliton, operatorSolitonCyc, fitOperatorSoliton, unite, evalSolitonTemporalAt, measureCarrierCrosstalk } from '../soliton-algebra.js';
import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';
import {
  hologramWorldProgram,
  REFLECTOR_MS, SUBTICK_MS,
  GRID, N_CELLS, DT, REF_AMP, REF_KX, SRC_ALPHA, PLATE_DECAY, K_WAVE,
  T_RECORD, RENDER_SCALE, FRAC_ALPHA, MAX_IFS_BANDS, N_DEPTH_TIERS, TOMO_MODE,
  IFS_DEPTH, IFS_GEN_CAP, IFS_MIN_DELAY, IFS_BASE_DELAY, FRESNEL_DONE_DELAY,
  NEXT_STEP_DELAY, DELAY_SCALE,
  CAM_Z, PROJ_SCALE, INIT_ANGLE_Y, INIT_ANGLE_X, PTS_PER_EDGE,
  CUBE_PTS, PYRAMID_PTS, COMBINED_PTS,
} from '../hologram_world.js';

// Percept tracking steps: with seed=previous-percept, attractor=new-evidence, the
// percept migrates toward the new view. ~16 steps gives smooth tracking with retained
// hysteresis (60 was wasteful — probe showed convergence is near-instant per-step).
const EYE_RELAX_STEPS = 16;
const EYE_T_STEPS = 10; // forward/backward propagation depth — experiment: 10..T_RECORD

// ── Eye renderer ──────────────────────────────────────────────────────────────
function makeEyeRenderer(core) {
  const { _clientBadge, _renderAvatars } = core;

  const RW = GRID * RENDER_SCALE;
  const RH = GRID * RENDER_SCALE;

  // ── Canvas helpers ─────────────────────────────────────────────────────────
  const makeDataCell = (label, color) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'flex', flexDirection: 'column', flex: '1', minWidth: '0',
      border: `1px solid ${color}22`, borderRadius: '4px', overflow: 'hidden',
    });
    const lbl = document.createElement('div');
    Object.assign(lbl.style, {
      fontSize: '7px', color, padding: '2px 4px', background: '#000a',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      fontFamily: 'ui-monospace,monospace',
    });
    lbl.textContent = label;
    const canvas = document.createElement('canvas');
    canvas.width = RW; canvas.height = RH;
    Object.assign(canvas.style, { flex: '1', minHeight: '0', width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'auto', borderRadius: '3px', display: 'block', cursor: 'crosshair' });
    wrap.appendChild(lbl);
    wrap.appendChild(canvas);
    return { wrap, canvas, ctx: canvas.getContext('2d'), setLabel: (t) => { lbl.textContent = t; } };
  };

  const mkBtn = (label, bg, fg, handler) => {
    const b = document.createElement('button');
    b.textContent = label;
    b._offBg = bg;                 // remember the off-state background (for world-state-driven highlight)
    Object.assign(b.style, {
      background: bg, color: fg, border: 'none', borderRadius: '4px',
      padding: '4px 7px', fontSize: '8px', cursor: 'pointer', whiteSpace: 'nowrap',
      fontFamily: 'ui-monospace,monospace', fontWeight: 'bold', flexShrink: '0',
    });
    b.addEventListener('click', handler);
    return b;
  };

  return (world, peerId, containerId, sendCursorMove, _injectEvent) => {
    const injectEvent = _injectEvent
      ? (ev) => setTimeout(() => _injectEvent(ev), 0)
      : undefined;

    // ── Root ───────────────────────────────────────────────────────────────
    if (!document.getElementById('eye-wrap')) {
      const wrap = document.createElement('div'); wrap.id = 'eye-wrap';
      Object.assign(wrap.style, {
        display: 'flex', gap: '0', flexWrap: 'nowrap',
        alignItems: 'stretch', height: '100vh', width: '100%', overflow: 'hidden',
      });
      document.body.appendChild(wrap);
    }
    const root = document.createElement('div');
    root.id = containerId;
    Object.assign(root.style, {
      fontFamily: 'ui-monospace,monospace', background: '#000', color: '#eee',
      flex: '1', minWidth: '0', minHeight: '0', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', overflow: 'visible',
    });
    document.getElementById('eye-wrap').appendChild(root);

    // ── Main area: clock column + canvas area ─────────────────────────────
    const main = document.createElement('div');
    Object.assign(main.style, { display: 'flex', flex: '1', flexDirection: 'row', minHeight: '0', overflow: 'hidden' });
    root.appendChild(main);

    // Clock column (left)
    const clockCol = document.createElement('div');
    Object.assign(clockCol.style, {
      flexShrink: '0', width: '110px', display: 'flex', flexDirection: 'column',
      padding: '8px 6px', boxSizing: 'border-box', gap: '4px', overflow: 'hidden',
    });
    main.appendChild(clockCol);

    const clockTitle = document.createElement('div');
    Object.assign(clockTitle.style, {
      fontSize: '7px', fontWeight: 'bold', letterSpacing: '0.5px',
      color: '#9c4', textAlign: 'center', lineHeight: '1.4',
      height: '3em', overflow: 'hidden', flexShrink: '0',
    });
    clockCol.appendChild(clockTitle);

    const ifsClock = makeIFSClockPanel({ label: 'FRESNEL IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    clockCol.appendChild(ifsClock.el);

    const wireCvs = document.createElement('canvas');
    wireCvs.width = 120; wireCvs.height = 120;
    Object.assign(wireCvs.style, {
      width: '100%', height: 'auto', borderRadius: '3px',
      display: 'block', cursor: 'grab', flexShrink: '0',
    });
    clockCol.appendChild(wireCvs);
    const wireCtx = wireCvs.getContext('2d');

    // Canvas area
    const canvasArea = document.createElement('div');
    Object.assign(canvasArea.style, {
      display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', gap: '4px', padding: '4px',
    });
    main.appendChild(canvasArea);

    // Main soliton row
    const mainRow = document.createElement('div');
    Object.assign(mainRow.style, { display: 'flex', flex: '1', minHeight: '0', gap: '4px' });
    canvasArea.appendChild(mainRow);

    const fieldCell = makeDataCell('IFS WAVEFRONT  |ψ|²', '#f84');
    const phaseCell = makeDataCell('IFS PHASE  arg(ψ)', '#4af');
    const plateCell = makeDataCell('IFS OBJ  |ψ_obj|²  source field', '#9c4');
    mainRow.appendChild(fieldCell.wrap);
    mainRow.appendChild(phaseCell.wrap);
    mainRow.appendChild(plateCell.wrap);

    // Eye row
    const eyeRow = document.createElement('div');
    Object.assign(eyeRow.style, { display: 'flex', flex: '1', minHeight: '0', gap: '4px' });
    canvasArea.appendChild(eyeRow);

    const eyeFieldCell   = makeDataCell('EYE  |ψ_arrived|²  received wavefront', '#f84');
    const eyePerceptCell = makeDataCell('EYE  |ψ_percept|²  soliton (settled)',   '#4af');
    const eyeEvidCell    = makeDataCell('EYE  |ψ_evidence|²  raw inverse',         '#fa4');
    // 4th cell — only shown in UNITED mode: the IMAGE-ONLY reconstruction (event/voice regions
    // zeroed), so you see the clean image separate from panel 1's full field. Hidden otherwise.
    const eyeImgCell     = makeDataCell('RECON (from masked hologram)', '#9cf');
    eyeRow.appendChild(eyeFieldCell.wrap);
    eyeRow.appendChild(eyePerceptCell.wrap);
    eyeRow.appendChild(eyeEvidCell.wrap);
    eyeRow.appendChild(eyeImgCell.wrap);
    eyeImgCell.wrap.style.display = 'none';   // shown only in UNITED

    // ── Control bar ────────────────────────────────────────────────────────
    const controlBar = document.createElement('div');
    Object.assign(controlBar.style, {
      display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
      alignItems: 'center', gap: '4px', padding: '6px 8px',
      background: '#0a0a0a', borderTop: '1px solid #222',
      flexShrink: '0', boxSizing: 'border-box', overflowY: 'visible',
    });
    root.appendChild(controlBar);

    // LIVE toggle
    const btnLive = mkBtn('⟳ LIVE', '#363', '#af8', () => { _eyeShowLoaded = false; injectEvent?.({ type: 'setEyeDisplay', mode: '' }); injectEvent?.({ type: 'setLiveMode' }); });

    // PROBE — measure minimum useful T and relax steps. Logs two curves to console:
    // forward-leg mixing (where the hologram stops spreading) + relax convergence
    // (where the eigenstate stops moving). Fires one instrumented eye snap.
    const btnProbe = mkBtn('⊙ PROBE', '#530', '#fb8', () => {
      if (!_eye || !_localObjField) { console.warn('[EYE PROBE] enter LIVE + have an object first'); return; }
      _eye.probeForward(_localObjField, 120, 5);   // forward mixing curve
      _eye.probe = true; _eye.dirty = true;          // relax convergence on next compute
      console.log('[EYE PROBE] forward scan done; relax curve logs on next eye snap. (toggle off after.)');
    });
    btnProbe.title = 'Measure minimum T_RECORD (forward mixing) and relax steps (eigenstate convergence) — see console';

    // SWEEP — occlusion-redundancy curve at the current T. Logs score vs occlusion
    // fraction r=0..0.9 in one click. Linear falloff = photo; graceful = holographic.
    const btnSweep = mkBtn('⊙ SWEEP', '#350', '#bf8', () => {
      if (!_eye || !_localObjField) { console.warn('[EYE SWEEP] enter LIVE + have an object first'); return; }
      _eye.sweepOcclusion(_localObjField);
      _eye.dirty = true; // restore normal display next frame (sweep left the eye buffer dirty)
    });
    btnSweep.title = 'Occlusion sweep at current T: logs reconstruction score vs occluded fraction. Run at T=100 and T=350 and compare the curves.';

    // DEPTH-SWEEP — score vs T at fixed occlusion. Tests "is T still too shallow?":
    // sweeps T=50..1500 at r=0.5; flat score = redundancy saturated, climbing = go deeper.
    const btnDepth = mkBtn('⊙ DEPTH', '#530', '#fc8', () => {
      if (!_eye || !_localObjField) { console.warn('[EYE DEPTH] enter LIVE + have an object first'); return; }
      _eye.sweepT(_localObjField, 0.5);
      _eye.dirty = true;
    });
    btnDepth.title = 'Depth sweep: reconstruction score vs propagation depth T (50..1500) at fixed occlusion r=0.5. Flat across T = redundancy saturated; climbing = deeper T helps.';

    // MULTI-DEPTH — the TRUE holography test: a dense object spread across DEPTH layers
    // (staged injection), occlusion-swept. Tests whether depth-superposition gives the
    // redundancy that flat single-plane objects (cube/texture) cannot.
    const btnMDepth = mkBtn('⊙ 3D-HOLO', '#404', '#f9f', () => {
      if (!_eye) { console.warn('[EYE MULTI-DEPTH] enter LIVE first'); return; }
      if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS);
      _eye.sweepOcclusionDepth(_eyeDepthLayers);   // local ACTION: log the curve (one-shot, not shared)
      injectEvent?.({ type: 'setEyeDisplay', mode: 'mdepth' });   // shared display toggle
    });
    btnMDepth.title = 'Multi-depth holography test: dense object across N_DEPTH_TIERS depth layers (staged injection per depth), occlusion-swept. Graceful falloff = depth-superposition redundancy (true holography); linear = none.';

    // SLICES — depth-slice reconstruction: refocus each depth layer at its OWN backward
    // step and show the slices. THIS is "observe the depth object reconstructed" — each
    // shape (disc/ring/cross/frame) refocuses sharply at its depth. Panel 1 = hologram,
    // panels 2-3 = two layer slices; click cycles which layer pair is shown.
    const btnSlices = mkBtn('⊙ SLICES', '#406', '#c9f', () => {
      if (!_eye) { console.warn('[EYE SLICES] enter LIVE first'); return; }
      if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS);
      if (_eyeShowSlices) { _eyeSlicePair = (_eyeSlicePair + 1) % Math.ceil(N_DEPTH_TIERS / 2); _eyeSlicesDirty = true; } // already on → cycle pair (local view detail)
      else injectEvent?.({ type: 'setEyeDisplay', mode: 'slices' });  // shared display toggle
    });
    btnSlices.title = 'Depth-slice reconstruction (display): toggle on, then each click CYCLES the layer pair shown (panels 2-3). Panel 1 = hologram. Each shape refocused at its own depth.';

    // ISO — single-layer ground-truth test: refocus each layer ALONE (no cross-layer
    // interference). Logs per-layer round-trip score. Verifies the refocus math is correct
    // independent of the multi-layer blur that swamps the live slices.
    const btnIso = mkBtn('⊙ ISO', '#226', '#8cf', () => {
      if (!_eye) { console.warn('[EYE ISO] enter LIVE first'); return; }
      if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS);
      _eye.testDepthLayersIsolated(_eyeDepthLayers);
    });
    btnIso.title = 'Single-layer ground-truth: refocus each depth layer alone (no cross-layer interference) and log its round-trip score. ~1.0 = refocus math correct; the live multi-layer slices score low only because the 4 layers blur each other.';

    // EXPLORE — IFS-native DEPTH-SCRUB explorer. Depth is the IFS evolution clock τ, not a
    // plane stack: drag the τ slider to move the observation point THROUGH depth. The
    // driven-dissipative soliton holds focus at τ; out-of-focus depth blurs naturally (DoF).
    const btnExplore = mkBtn('◎ EXPLORE', '#446', '#fcf', () => {
      if (!_eye) { console.warn('[EYE EXPLORE] enter LIVE first'); return; }
      injectEvent?.({ type: 'setEyeDisplay', mode: 'explore' });
    });
    btnExplore.title = 'IFS-native depth explorer: depth = the fractal evolution clock τ (not Euclidean planes). Drag the τ slider to move through depth — in-focus structure sharp, other depths blur as natural depth-of-field. Frameless in time AND planeless in depth.';

    // ♪ SOUND — multimedia: toggle audio sonification of the IFS SOUND hologram, locked to
    // the SAME τ as the image depth. Scrubbing τ then moves image-depth AND sound together —
    // one fractal clock driving both modalities (structural sync, not timestamped streams).
    const btnSound = mkBtn('♪ SOUND', '#414', '#fbf', () => {
      // WebAudio MUST be created/resumed inside the user gesture (this click) — can't defer to a
      // render frame. Do that here; the actual play/stop state is world state (setEyeSound), so
      // all peers agree, but the AudioContext unlock is necessarily local to the clicking user.
      try {
        if (!_eyeAudioCtx) _eyeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (_eyeAudioCtx.state === 'suspended') _eyeAudioCtx.resume();
      } catch (e) {}
      injectEvent?.({ type: 'setEyeSound' });   // toggle shared sound state via reflector
    });
    btnSound.title = 'Multimedia IFS hologram: sonify a sound hologram reconstructed at the SAME τ as the image depth. Scrub τ in EXPLORE → image-depth and sound-time move together (one fractal clock). The sound waveform is also drawn as a strip on panel 3.';

    // ⊙ MM — COMBINED-FIELD multimedia hologram: image + sound encoded into ONE complex
    // field (carrier multiplex), holographed and reconstructed together, then split back.
    // Panel 1 = combined hologram, Panel 2 = reconstructed image, Panel 3 = recovered sound.
    // Logs image/sound separation scores (cross-talk is the IFS non-orthogonality cost).
    const btnMM = mkBtn('⊙ MM', '#414', '#fcf', () => {
      if (!_eye) { console.warn('[EYE MM] enter LIVE first'); return; }
      injectEvent?.({ type: 'setEyeDisplay', mode: 'mm' });
    });
    btnMM.title = 'Combined-field multimedia hologram: image + sound in ONE complex field (carrier multiplex), holographed & reconstructed together, split back on readout. Panel 1 = combined hologram, 2 = recovered image, 3 = recovered sound. Logs separation scores.';

    // ⊙ CLOCK — "no tricks" multimedia: sound is NOT placed in space. It modulates the
    // per-step dt of the SAME evolution that carries the image (dt_i = dt·(1+ε·s_i)), and
    // s_i IS the live IFS heartbeat (the per-cycle depth-energy envelope). Image refocuses
    // exactly; sound is read back by phase-rate demod. No carrier, no depth slot. Image and
    // sound have ORTHOGONAL failure modes — spatial occlusion hits the image, not the sound.
    const btnClock = mkBtn('⊙ CLOCK', '#143', '#bfd', () => {
      if (!_eye) { console.warn('[EYE CLOCK] enter LIVE first'); return; }
      injectEvent?.({ type: 'setEyeDisplay', mode: 'clock' });
    });
    btnClock.title = 'Clock-modulated multimedia ("no tricks"): the LIVE IFS heartbeat (per-cycle depth-energy envelope) modulates the evolution\'s per-step dt while the image rides the steps. One reversible field carries both; image refocuses exactly, sound recovered by phase-rate demod. No spatial carrier, no depth slot — sound lives in the clock. Occlude (r=, H=OCCL): image degrades, sound survives (orthogonal failure modes).';

    // ⊙ BEAT — EVENT-TIMING HOLOGRAPHY: the discrete rhythm itself stored in the field. The
    // live fresnelBeat events are encoded as localized impulses (time→depth, tier→cell),
    // reconstructed, and peak-detected back out. Panel 2 = TRUE groove, panel 3 = RECOVERED
    // groove with f1. ♪ SOUND plays the recovered groove as drums — occlusion punches holes.
    const btnBeat = mkBtn('⊙ BEAT', '#134', '#bdf', () => {
      if (!_eye) { console.warn('[EYE BEAT] enter LIVE first'); return; }
      injectEvent?.({ type: 'setEyeDisplay', mode: 'beat' });
    });
    btnBeat.title = 'THE UNIFIED FIELD: one substrate (the clock\'s fresnelBeat events, encoded once, biased to fine onsets with redundant impulses) read at THREE resolutions by one τ — panel 1 = IMAGE depth-slice (spatial face), panel 2 = RECOVERED groove + f1 (discrete face), panel 3 = derived WAVEFORM envelope (continuous face, free). The image rides the same field. ♪ SOUND plays the recovered drums; drag τ to scan the clock; occlude (r=, H=OCCL) → graceful break-up. Rotate / dblclick to capture beats.';

    // ♪ MEL — CARRIED CONTENT demo: holograph an AUTHORED melody (not the IFS\'s own beats),
    // occlude, recover, play. Proves the holographic event stream can carry a message of our
    // choosing and give it back — the "encode → holograph → decode" round-trip with our payload.
    const btnMel = mkBtn('♪ MEL', '#314', '#fbe', () => {
      if (!_eye) { console.warn('[EYE MEL] enter LIVE first'); return; }
      injectEvent?.({ type: 'setEyeDisplay', mode: 'melody' });
    });
    btnMel.title = 'Carried-content demo: holograph an AUTHORED melody (C D E G A — our content, NOT the IFS\'s own beats) into the event field, occlude (r=, H=OCCL), recover by peak-detect, and PLAY the recovered notes. Panel 2 shows the tune as a pitch×time grid — notes drop out where occlusion broke the hologram. Proves the holographic event stream can carry & return a message of our choosing. Toggle with ⊙ BEAT for the clock\'s own beats.';

    // ⊙ SEQ — HOLOGRAPHIC SAMPLER/SEQUENCER (§7.12): events TRANSPORT a waveform voice. ONE
    // field, two SPATIALLY-SEPARATED payloads — a waveform VOICE (left region) + an event
    // SEQUENCE (right region) — both recovered from one sweep (cross-talk measured clean with
    // separation). The recovered events become the trigger schedule that plays the recovered
    // voice. Panel 1 = the recovered voice waveform, panel 2 = the recovered sequence grid +
    // f1, panel 3 = field. ♪ SOUND plays the sequenced sampler. Occlude → pattern drops hits,
    // each surviving hit keeps the full voice.
    const btnSeq = mkBtn('⊙ SEQ', '#124', '#9cf', () => {
      if (!_eye) { console.warn('[EYE SEQ] enter LIVE first'); return; }
      injectEvent?.({ type: 'setEyeDisplay', mode: 'seq' });
    });
    btnSeq.title = 'Holographic sampler/sequencer (§7.12): one field carries a waveform VOICE (left region) AND an event SEQUENCE (right region), spatially separated so both recover cleanly (cross-talk measured). The recovered events transport/trigger the recovered voice — a sequenced instrument that survived the hologram round-trip. Panel 1 = recovered voice, panel 2 = recovered sequence + f1, panel 3 = field. ♪ SOUND plays it; occlude (r=, H=OCCL) → pattern drops hits gracefully, each surviving hit keeps its full voice.';

    // ⊙ MASK? — decisive measurement for the united field: sweep T × occlusion for the SAMPLER's
    // voice + events, logging how each survives MASKING at each depth. Answers whether sound/events
    // (like the image) NEED high T for masking-robustness, or survive at any T. One-shot ACTION
    // (local, like the other sweeps). Console table.
    const btnMask = mkBtn('⊙ MASK?', '#250', '#cf8', () => {
      if (!_eye) { console.warn('[EYE MASK?] enter LIVE first'); return; }
      const voice = _buildSeqVoice();
      _eye.sweepModalitiesVsT(voice, _seqEvents(), { nTiers: 4, nBins: 4, band: 0.7, voiceRows: 1 });
    });
    btnMask.title = 'Masking-robustness vs depth, per modality: sweeps T × occlusion for the sampler\'s voice (waveform) and events, logging voiceScore/f1 at each (T,r). Tells whether sound & events need HIGH T for holographic masking-robustness (like the image) or survive at any T — the decisive measurement for the united-field readout-depth design. Logs a table to the console.';

    // ⊙ UNITED — THE UNITED FIELD (§7.14): image + events + sound in ONE deep-T field, one clock,
    // three region-separated readouts. This action runs it at r=0 and r=0.5 and logs the three
    // modality scores — proving all three survive masking from one wavefront. (Live 3-panel render
    // is the next step once the method is confirmed.)
    const btnUnited = mkBtn('⊙ UNITED', '#403', '#f9c', () => {
      if (!_eye) { console.warn('[EYE UNITED] enter LIVE first'); return; }
      _eyeUnitedLoaded = null;       // explicit UNITED click = live recompute (drop any loaded file)
      _eyeUnitedDirty  = true;
      injectEvent?.({ type: 'setEyeDisplay', mode: 'united' });
    });
    btnUnited.title = 'THE UNITED FIELD: image (depth) + events (rhythm) + sound (voice) encoded in ONE wavefront at one deep T, region-separated, shared IFS clock — all three recovered from one reconstruction. Runs at r=0 and r=0.5, logs each modality\'s score to prove they survive masking together. The hologram-based multimedia goal.';

    // SOLITON — the LIVE continuous united field (§7.15). Content is injected at the entry plane
    // each bar and ADVECTED forward one IFS step/frame; image+events+voice FLOW, clock-locked.
    // age=depth: each bar refocuses at its own depth. Peer-synced via cycleCount (deterministic
    // recompute, no field exchange). Also runs the coherence-vs-age experiment.
    const btnSoliton = mkBtn('⊙ SOLITON', '#304', '#c9f', (ev) => {
      if (!_eye) { console.warn('[EYE SOLITON] enter LIVE first'); return; }
      if (ev?.altKey && ev?.shiftKey) {   // IFS-EIGENMODE GATE (§7.28): does float32 IFS stay unitary —
        // do two ORTHOGONAL fields STAY orthogonal under deep T? Decides whether eigenmodes are a
        // preserved orthogonal basis on the united field (the IFS-native composition substrate) BEFORE
        // building eigenmode machinery. Logs overlap(→0?) + normRatio(→1?) across T.
        _eye.eigenmodeGate({ Ts: [10, 50, 150, 350], trials: 3 });
        return;
      }
      if ((ev?.ctrlKey || ev?.metaKey) && ev?.shiftKey) {   // CARRIER CROSS-TALK (§7.29): can two
        // modalities share ONE field on orthogonal carriers (no spatial regions) and recover cleanly
        // through the IFS round-trip + H? Leakage matrix: diagonal≈1 + off-diag≈0 = region-free
        // interleaved composition works on the IFS medium. The decisive test for carrier-multiplexing.
        const carriers = [makeCarrier(0, 0), makeCarrier(1.6, 0), makeCarrier(0, 1.6)];   // well-separated k
        const patternsFn = (i, G) => {   // 3 distinct real test patterns (disc / ring / cross-ish)
          const f = new Float64Array(G * G), cx = (G-1)/2, cy = (G-1)/2;
          for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const dx=x-cx, dy=y-cy, r=Math.hypot(dx,dy), R=G*0.42;
            const inS = i===0 ? r < R*0.5 : i===1 ? (r>R*0.55 && r<R*0.85) : (Math.abs(dx)<R*0.15||Math.abs(dy)<R*0.15);
            if (inS) f[y*G+x] = 1; }
          return f;
        };
        const occ = (_eye.hMode===6||_eye.hMode===7||_eye.hMode===8) ? _eye.hParam : 0;
        console.log('— occl 0 —'); measureCarrierCrosstalk(_eye, carriers, patternsFn, { T: _eye.tSteps, occludeR: 0 });
        if (occ > 0) { console.log('— occl '+occ+' —'); measureCarrierCrosstalk(_eye, carriers, patternsFn, { T: _eye.tSteps, occludeR: occ }); }
        return;
      }
      if (ev?.shiftKey) {   // THE EXPERIMENT (§7.16): structure-gating, one-factor-at-a-time × DEPTH.
        // Isolates pitch-res / onset-res / note-density (one var per row) at T∈{40,100,350}, so we can
        // read which limit bites AT EACH depth. NO prior claim assumed — the prior "resolution
        // dominates" was GPU-refuted; this measures honestly and may be T-dependent (low T photographic).
        const img = (_eyeDepthLayers ?? (_eyeDepthLayers=_buildDepthLayers(N_DEPTH_TIERS)))[0];
        // per-config melody: `notes` evenly-spaced onsets, pitches walking the ladder (deterministic).
        const makeMelody = (nTiers, nBins, notes) => (bi) => {
          const evs = [];
          const stride = Math.max(1, Math.floor(nBins / notes));
          for (let k = 0; k < notes; k++) {
            const onset = (k * stride) % nBins;
            const tier = (k + bi) % nTiers;            // walk pitches, shift per bar
            evs.push({ tier, bin: onset });
          }
          return { events: evs, voice: null, image: img };
        };
        _eye.solitonStructureSweep(makeMelody, { imgRowsFrac: _EYE_ROLL_IMG_FRAC, barSteps: _EYE_SOL_BAR_STEPS, cycles: 6 });
        return;
      }
      if (ev?.altKey && (ev?.ctrlKey || ev?.metaKey)) {   // BINDING GATE (§9): does cross-modal
        // COMPUTATION work — does the IFS-domain field PRODUCT ψA·ψB compute the A·B CORRELATION
        // (matched-filter: strong when A≈B, weak when disjoint), or does the ring-kernel smear it?
        // The decisive cheap test BEFORE building composition-as-computation. contrast ≳ 2× = it computes.
        const carrierA = makeCarrier(1.4, 0.6), carrierB = makeCarrier(0.6, 1.4);   // distinct k; sum-k in range
        // patFn(frac, dx, G): a small filled square (the "feature"). frac<1 slides B off the base A so the
        // overlap = frac (graded test); dx shifts B by whole cells (lag test). frac=1,dx=0 → the base A.
        const patFn = (frac, dx, G) => {
          const f = new Float64Array(G * G), R = Math.max(3, Math.round(G*0.14));   // square half-width
          const bx = Math.round((G-1)/2), by = Math.round((G-1)/2);                 // base A is centered
          const off = Math.round((1 - frac) * 2 * R) + dx;                          // graded slide + lag shift, in x
          const cx = bx + off, cy = by;
          for (let y = cy-R; y <= cy+R; y++) for (let x = cx-R; x <= cx+R; x++)
            if (x>=0 && x<G && y>=0 && y<G) f[y*G+x] = 1;
          return f;
        };
        const occ = (_eye.hMode===6||_eye.hMode===7||_eye.hMode===8) ? _eye.hParam : 0;
        console.log('— occl 0 —'); _eye.bindingGate(carrierA, carrierB, patFn, { T: 50, occludeR: 0 });
        if (occ > 0) { console.log('— occl '+occ+' —'); _eye.bindingGate(carrierA, carrierB, patFn, { T: 50, occludeR: occ }); }
        // GATE OPERATOR (§9) — the first cross-modal binding USE: events gate image. Rhythm = every-other
        // column ON (a beat pattern in space); image = a filled disc. Recovered = the disc seen ONLY through
        // the beat-ON columns. The mechanism (above) made abstract; this is the concrete operator.
        const rhyCarrier = makeCarrier(1.2, 1.2);
        const imgFn = (G) => { const f = new Float64Array(G*G), cx=(G-1)/2, cy=(G-1)/2, R=G*0.4;
          for (let y=0;y<G;y++) for (let x=0;x<G;x++) if (Math.hypot(x-cx,y-cy) < R) f[y*G+x] = 1; return f; };
        const beatFn = (x, G) => (Math.floor(x / Math.max(1, Math.round(G/8))) % 2) === 0;   // 8 beat-columns, alternating
        console.log('— gate occl 0 —'); _eye.gateOperator(rhyCarrier, imgFn, beatFn, { T: 50, occludeR: 0 });
        if (occ > 0) { console.log('— gate occl '+occ+' —'); _eye.gateOperator(rhyCarrier, imgFn, beatFn, { T: 50, occludeR: occ }); }
        // RECOGNIZE GATE (§9, recognition mode) — "give a reference object → its occurrences light up."
        // Scene = 3 copies of an L-shape (the reference) + 2 distractors (a plus-shape), one field. Probe
        // with the reference via the matched-filter [H]; the correlation map should peak at the 3 L's, stay
        // low on the +'s. The SPATIAL face of the §7.32 correlation (your letter-A-lights-up example).
        const recCarrier = makeCarrier(0.9, -0.5);
        const refFn = (G) => { const f = new Float64Array(G*G), s = Math.max(2, Math.round(G*0.08));   // L-shape
          for (let k=0;k<s*2;k++){ const yy=(G>>1)-s+k; if(yy>=0&&yy<G) f[yy*G+((G>>1)-s)]=1; }          // vertical bar
          for (let k=0;k<s*2;k++){ const xx=(G>>1)-s+k; if(xx>=0&&xx<G) f[((G>>1)+s-1)*G+xx]=1; }        // bottom bar
          return f; };
        const disFn = (G) => { const f = new Float64Array(G*G), s = Math.max(2, Math.round(G*0.08));    // plus-shape
          for (let k=-s;k<s;k++){ const yy=(G>>1)+k; if(yy>=0&&yy<G) f[yy*G+(G>>1)]=1; const xx=(G>>1)+k; if(xx>=0&&xx<G) f[(G>>1)*G+xx]=1; }
          return f; };
        const sites = [{x:14,y:16},{x:40,y:20},{x:24,y:46}], distract = [{x:46,y:46},{x:12,y:44}];
        console.log('— recognize occl 0 —'); _eye.recognizeGate(recCarrier, refFn, sites, disFn, distract, { T: 50, occludeR: 0 });
        if (occ > 0) { console.log('— recognize occl '+occ+' —'); _eye.recognizeGate(recCarrier, refFn, sites, disFn, distract, { T: 50, occludeR: occ }); }
        // FFT-ANALOG GATE (§7.35) — is the IFS transform an FFT-analog for correlation? If YES, the WHOLE
        // dense correlation map = ONE multiply in the transform domain (3 round-trips total, not N). Tests
        // one-shot map + shift-covariance (position sweep) + superposition (K patterns, one map → K peaks).
        console.log('— FFT-analog —'); _eye.fftAnalogGate(refFn, { T: 50, superposK: 3 });
        // CONV-ANALOG (§7.36) — the follow-up: §7.35 used the LEAPFROG round-trip, but ONE IFS STEP is a
        // pure spatial CONVOLUTION (circulant → DFT-diagonal). Re-test the FFT theorem on the PURE ring
        // convolution (periodic boundary, no leapfrog) — should pass if §7.35 was a leapfrog/boundary
        // artifact. Plus the WAVELET question: is correlation SCALE-covariant (find the ref at any size)?
        console.log('— CONV-analog (pure conv + wavelet/scale) —'); _eye.convAnalogGate(refFn, { scales: [0.7, 1.0, 1.4] });
        // WAVELET/SCALE (§7.37) — is the fractal ring kernel WAVELET-like → SIZE-invariant recognition?
        // (1) scale-tolerance curve, (2) scale localization (which band tracks object size), (3) fractal
        // control (does multi-scale CAUSE the tolerance, vs single-ring). The deeper fractal-native test.
        console.log('— WAVELET/scale —'); _eye.waveletScaleGate(refFn, { scales: [0.5, 0.7, 1.0, 1.4, 2.0] });
        // IFS-NATIVE WAVELET (§7.38) — §7.37 tested uniform ring copies (no advantage). The codebase's REAL
        // ifsWavelet (krestianstvo-wavefront-physics.js) uses the FRACTAL CASCADE: per-depth ring scales from
        // the IFS CONTRACTION MAPS (the attractor). Re-test scale-localization on THAT decomposition.
        // IFS contraction maps (the attractor's scale ratios — IFS_MAPS_DEFAULT in krestianstvo-wavefront-physics.js).
        const ifsMaps = [0.3090169944, 0.4142135623, 0.5, 0.6180339887, 0.7071067812, 0.7320508075];
        console.log('— IFS-NATIVE wavelet (fractal cascade) —'); _eye.ifsWaveletGate(refFn, { ifsMaps, depth: 5 });
        // (§7.39 "why recognition fades at high T" is measured on the LIVE recognizer instead.)
        // ── §9 RECURSION/FEEDBACK (the conceptual-question build): clock-pure fixed-point loop → RECALL
        // (associative completion: store M patterns, noisy cue, relax → recover nearest) → SELF-APPLICATION
        // (can the operator-as-field be a fixed point of its own action). Measure-after, all three.
        // RECALL pushed to its REAL limits: N=256 bipolar space, RANDOM (non-orthogonal) patterns so the
        // textbook Hopfield capacity ~0.14N≈36 is reachable; M sweeps past it, noise to the ~45% basin edge.
        console.log('— §9 RECALL (capacity + basin sweep) —'); _eye.recallGate({ Nr:256, noises:[0.1,0.25,0.4,0.45], iters:15, trials:4 });
        console.log('— §9 SELF-APPLY (operator self-stability, controlled) —'); _eye.selfApplyGate(refFn, { T: 50, iters: 5 });
        // SELF-HOSTING done right (Q2): can ONE field Ω reproduce the binding op a·b on NOVEL inputs (vs a
        // random-Ω control + identity upper bound)? Expected NO (a bilinear map is rank-3, a field is not) —
        // the honest answer to "can the algebra host itself": objects yes (monoid), operator-as-one-field no.
        console.log('— §9 SELF-HOSTING (rank of the binding rule) —'); _eye.selfHostGate({ n: 16, ranks: [1, 2, 4, 8, 16] });
        // §9 OPERATOR-SOLITON (the CONSTRUCTIVE self-hosting): reify a binding RULE as a rank-K soliton stack
        // (fitOperatorSoliton) and test it computes the binding on NOVEL pairs, fidelity rising with K — the
        // algebra hosting its own operator as a value. Two targets: the gate product a·b, and a general bilinear.
        {
          const Nv = 16;
          let rg = 0x5EED >>> 0; const rnd = () => { rg=(rg*1664525+1013904223)>>>0; return rg/4294967296; };
          const rvec = () => { const v=new Float64Array(Nv); for(let i=0;i<Nv;i++) v[i]=rnd()*2-1; return v; };
          const cor = (a,b)=>{let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return d/Math.sqrt(Math.max(1e-12,na*nb));};
          // a known RANK-3 binding rule (3 random triples) — the case the SVD construction reconstructs.
          const tr=[]; for(let r=0;r<3;r++) tr.push({U:rvec(),V:rvec(),W:rvec()});
          const lowOp=(a,b)=>{const o=new Float64Array(Nv);for(const{U,V,W}of tr){let ua=0,vb=0;for(let i=0;i<Nv;i++){ua+=U[i]*a[i];vb+=V[i]*b[i];}const c=ua*vb;for(let k=0;k<Nv;k++)o[k]+=W[k]*c;}return o;};
          // its tensor T[k][i*N+j] (the rule AS DATA), for the exact-SVD reification:
          const lowTensor=(N)=>{const T=[];for(let k=0;k<N;k++){const r=new Float64Array(N*N);for(let i=0;i<N;i++)for(let j=0;j<N;j++){let s=0;for(const{U,V,W}of tr)s+=W[k]*U[i]*V[j];r[i*N+j]=s;}T.push(r);}return T;};
          const rows=['[§9 OPERATOR-SOLITON] reify a binding rule (3 tensor modes) as a rank-K rank-1-triple stack; NOVEL pairs:',
            '   budget K   actual #triples   corr(opSoliton(a,b), true binding op)'];
          for (const K of [1,2,3,6,9,12]) {
            const op = fitOperatorSoliton(lowTensor, { N:Nv, K });
            let a=0; for(let t=0;t<15;t++){const x=rvec(),y=rvec(); a+=cor(op.apply(x,y),lowOp(x,y));}
            rows.push(`   K=${String(K).padStart(2)}        ${String(op.rank).padStart(2)}              ${(a/15).toFixed(3)}${K===1?'  ← one soliton':op.rank>=9?'  ← EXACT (true bilinear rank reached)':''}`);
          }
          rows.push('   → fidelity RISES monotonically with K and reaches 1.0 at the TRUE bilinear rank (9 rank-1 triples for this');
          rows.push('     rule: 3 tensor modes × non-rank-1 U⊗V expansion). The σ-guard caps #triples at the real rank (no garbage).');
          rows.push('     The operator is reified EXACTLY as a soliton stack — a VALUE in the algebra. CONSTRUCTIVE self-hosting:');
          rows.push('     objects self-host (unite=monoid), AND operators self-host as rank-K multi-soliton composites. Q2: YES, exact.');
          console.log('— §9 OPERATOR-SOLITON (constructive self-hosting) —\n' + rows.join('\n'));

          // §9 OPERATOR IN THE MEDIUM (the carrier-packing idea): pack the rank-3 operator's triples onto 3
          // orthogonal carriers into ONE wavefront, apply through the IFS round-trip, measure fidelity vs the
          // abstract stack (does the orthogonal basis make the rank-K operator physically ONE soliton?).
          const opStack = fitOperatorSoliton(lowTensor, { N: Nv, K: 9 });   // K=9 = true bilinear rank → exact stack
          console.log('— §9 OPERATOR IN MEDIUM (carrier-packed) —');
          _eye.operatorSolitonMedium(opStack.triples, lowOp, { Nr: Nv, T: 30, trials: 12, carrierSep: 2.5 });
          // Follow-ups testing whether ANY basis collapses the stack to one field: wavelet-sparsity gate
          // (fractal ops ARE scale-sparser than random — partial) and sparse-vs-dense carrier packing (does
          // sparsity rescue carriers? — measured NO, sparsity made it worse). All three routes fail → the
          // operator stays the explicit K-field stack. Measured boundary, not a coding gap.
          console.log('— §9 WAVELET-SPARSITY gate —'); _eye.waveletSparsityGate({ G: 16, depth: 5 });
          console.log('— §9 SPARSE-vs-DENSE carrier packing —'); _eye.operatorPackSparsityCompare({ Nr: Nv, K: 3, sparsities: [0,0.5,0.8,0.95] });
          // §9 TEMPORAL route (the 4th): all three SPACE routes above force K dense ranks to COEXIST → crosstalk
          // caps fidelity at ~0.41 (verified: that 0.41 is crosstalk, present even with NO medium). Temporal mux
          // walks the K ranks across K sub-ticks — rank r alone at tick r → no crosstalk by construction (no-medium
          // corr = 1.000). Live question answered: the IFS round-trip PRESERVES each rank per sub-tick (medium=1.000).
          // Run on the K=9 EXACT stack → vs-TRUE should now read ~1.0 (the old 0.764 was the fitter ceiling, now fixed).
          console.log('— §9 OPERATOR-SOLITON TEMPORAL (space→time, the 4th route) —');
          _eye.operatorSolitonTemporal(opStack.triples, lowOp, { Nr: Nv, T: 30, trials: 12 });
          // §9 TEMPORAL K-SWEEP (control): separate the two contributions. temporal·medium-vs-STACK must stay ~1.0
          // at every K (temporal faithfully realizes whatever stack it carries); temporal·medium-vs-TRUE tracks the
          // fitter's fidelity and should now RISE MONOTONICALLY to 1.0 at the true bilinear rank (the rewritten
          // fitOperatorSoliton expands non-rank-1 modes + σ-guards garbage → no more K-dip, reaches exact).
          console.log('— §9 TEMPORAL K-SWEEP (separate temporal cost from fitter fidelity) —');
          const ksw = ['[TEMPORAL K-SWEEP §9]  K   stack-vs-true   temporal·medium-vs-stack   temporal·medium-vs-true'];
          for (const K of [1, 2, 3, 5, 9, 12]) {
            const st = fitOperatorSoliton(lowTensor, { N: Nv, K });
            let sT = 0; for (let t = 0; t < 15; t++) { const x = rvec(), y = rvec(); sT += cor(st.apply(x, y), lowOp(x, y)); }
            const r = _eye.operatorSolitonTemporal(st.triples, lowOp, { Nr: Nv, T: 30, trials: 8, quiet: true });
            ksw.push(`   ${String(K).padStart(2)}      ${(sT/15).toFixed(3)}           ${r.accMed.toFixed(3)}                    ${r.accTruth.toFixed(3)}`);
          }
          ksw.push('   → temporal·medium-vs-STACK stays ~1.0 at every K (time-mux is a faithful realization); vs-TRUE rises');
          ksw.push('     MONOTONICALLY to 1.0 at the true bilinear rank → the operator is exactly one field-in-time on the clock.');
          console.log(ksw.join('\n'));
          // §7.44 does the space→time result TRANSFER to MULTIMEDIA? Carriers leak for DENSE modalities (§7.29);
          // does time-phasing (modality m alone at its phase of the bar) keep them separate where carriers can't?
          // Measures TWO dense images packed both ways — carrier vs temporal — self-fidelity + cross-leak. The real
          // test is whether per-phase isolation survives the field PROPAGATING between phases (the source glossed this).
          console.log('— §7.44 MULTIMEDIA AS A LIMIT CYCLE (does space→time transfer to media?) —');
          _eye.multimediaTemporalGate({ T: 30, trials: 8, carrierSep: 2.5, phaseT: 6 });
        }
        return;
      }
      if (ev?.altKey) {   // SYNC EXPERIMENT (§7.22): is Ψ(cyc) a pure clock function (peer-synced)?
        // Compares memory models (window K / decay) for peer field agreement + cost → picks the model
        // for the future clock-pure "moving picture" soliton. corr=1.0 = frame-rate-independent sync.
        const geom = { nTiers: _EYE_ROLL_TIERS, nBins: _eyeRollBins, imgRowsFrac: _EYE_ROLL_IMG_FRAC, vLen: 0, barSecs: 2.0 };
        _eye.solitonSyncTest(geom, (bi) => ({ events: _rollMelody(bi) }), { barSteps: _EYE_SOL_BAR_STEPS, atCyc: 200 });
        return;
      }
      if (ev?.ctrlKey || ev?.metaKey) {   // HOLOGRAPHY PROOF (§7.23): measures the ACTUAL live unified
        // recon (reads Ψ(cyc), H on the live field, matured bar) across recon-depth × occlusion. f1
        // rising with depth = holographic from the live field; flat ≈ 1−r = photographic; junk at r=0 =
        // multi-bar contamination. This now tests exactly what the live SOLITON does.
        const geom = { nTiers: _EYE_ROLL_TIERS, nBins: _eyeRollBins, imgRowsFrac: _EYE_ROLL_IMG_FRAC, vLen: 0, barSecs: 2.0 };
        _eye.solitonOcclusionVsT(geom, (bi) => ({ events: _rollMelody(bi), imageLayers: _eyeDepthLayers }),
          { barSteps: _EYE_SOL_BAR_STEPS, readBars: 1, K: _EYE_SOL_K });
        return;
      }
      _eyeUnitedLoaded = null;
      injectEvent?.({ type: 'setEyeDisplay', mode: 'soliton' });
    });
    btnSoliton.title = 'LIVE clock-pure soliton Ψ(cyc): the united field as a pure function of the shared clock → identical on all peers at any T. Notes recovered FROM the field; H=OCCL degrades them by energy (notes quiet/drop). Click=enter. DBL-click=toggle FULL-GRID image (§7.29 dense test). Shift-click=structure sweep. Alt-click=peer-sync test. Ctrl/Cmd-click=occlusion-vs-T proof. Alt+Ctrl/Cmd-click=BINDING GATE (§9: does ψA·ψB compute the A·B correlation?).';
    // DOUBLE-CLICK: toggle the image between top-region and FULL GRID — tests whether a DENSE full-grid
    // image (the §7.29 floor case) corrupts the carrier event/wave modalities sharing the same cells.
    btnSoliton.addEventListener('dblclick', () => {
      _eyeImgFull = !_eyeImgFull; _eyeScene = null;   // force rebuild
      console.log(`[SOLITON] image span: ${_eyeImgFull ? 'FULL GRID (dense everywhere — §7.29 stress test)' : 'top region'}`);
    });
    // GATE MODE (§7.33) — composition-as-COMPUTATION live, on its OWN button (no click/dblclick-modifier
    // collision: shift/alt/ctrl on ⊙ SOLITON are bound to heavy sweeps, so a modified dbl-click fired
    // those twice → froze). Scene becomes unite([events, gate(events,image), wave]): the rhythm carves the
    // picture; panel 4 shows the beat-gated image (present only in the columns this bar plays). Audio intact.
    const btnGate = mkBtn('⊞ GATE', '#403', '#f9c', () => {
      if (!_eye) { console.warn('[EYE GATE] enter LIVE + SOLITON first'); return; }
      _eyeGateMode = !_eyeGateMode; _eyeScene = null; _eyeSolReadKey = '';   // force scene + render rebuild
      btnGate.style.outline = _eyeGateMode ? '2px solid #f9c' : '';
      console.log(`[SOLITON] GATE MODE ${_eyeGateMode ? 'ON — events×image: the beat carves the image (§7.33)' : 'OFF — plain recon'}`);
    });
    btnGate.title = 'GATE (§7.33) — composition-as-COMPUTATION: the rhythm soliton TRANSFORMS the image via the binding [H] (field product). Scene = unite([events, gate(events,image), wave]); panel 4 shows the image carved by the beat (visible only in the columns the current bar plays). Toggle while in ⊙ SOLITON mode.';

    // ⊕ OP-CYC — the OPERATOR LIMIT CYCLE as a scene combinator (§7.43), alongside GATE/RECOG. The reified
    // rank-K binding operator (as a clock trajectory, full-GPU) BINDS two live scene fields — events ⊗ image —
    // walking one rank per bar; the bound output renders on panel 4. Unlike GATE (a fixed beat-mask product),
    // this is the general bilinear operator computed on the GPU, the operator-as-clock driving real composition.
    const btnOpCyc = mkBtn('⊕ OP-CYC', '#143', '#9fd', () => {
      if (!_eye) { console.warn('[EYE OP-CYC] enter LIVE + SOLITON first'); return; }
      _eyeOpCycMode = !_eyeOpCycMode; _eyeOpCycObj = null; _eyeSolReadKey = '';
      btnOpCyc.style.outline = _eyeOpCycMode ? '2px solid #9fd' : '';
      console.log(`[SOLITON] OP-CYCLE ${_eyeOpCycMode ? 'ON — operator-as-clock binds events⊗image, rank per bar (§7.43, GPU)' : 'OFF'}`);
    });
    btnOpCyc.title = 'OP-CYCLE (§7.43) — the rank-K binding OPERATOR as a clock limit cycle, used as a scene combinator (alongside GATE/RECOG). It binds two live scene fields (events ⊗ image) via Σ_r W_r·(U_r·a)(V_r·b), one rank per bar, computed on the GPU (verified). Panel 4 = the bound output. The operator is a VALUE in the algebra driving composition. Toggle while in ⊙ SOLITON mode.';

    // ⟳ PHASE — SOLITON temporal display lock (§7.44, VISUAL only): which phase panel 1 + recon show. Cycles
    // CYCLE-ALL (live, panel 1 turns through events→image→wave) → LOCK IMAGE → LOCK EVENTS → LOCK WAVE → … .
    // The limit cycle architecture is unchanged regardless — this only picks which hologram panel 1 paints.
    const _phaseLabel = { live: '⟳ PHASE: CYCLE', image: '⟳ PHASE: IMG', event: '⟳ PHASE: EVT', wave: '⟳ PHASE: WAV' };
    const btnPhase = mkBtn(_phaseLabel.live, '#125', '#9cf', () => {
      if (!_eye) { console.warn('[EYE PHASE] enter LIVE + SOLITON first'); return; }
      const i = _TEMPORAL_LOCKS.indexOf(_eyeTemporalLock); _eyeTemporalLock = _TEMPORAL_LOCKS[(i + 1) % _TEMPORAL_LOCKS.length];
      btnPhase.textContent = _phaseLabel[_eyeTemporalLock]; _eyeSolReadKey = '';   // force re-render
      console.log(`[SOLITON] panel-1 display = ${_eyeTemporalLock === 'live' ? 'CYCLE all holograms' : 'LOCK ' + _eyeTemporalLock} (visual only; readouts unchanged)`);
    });
    btnPhase.title = 'PHASE display (§7.44, VISUAL only): which hologram panel 1 + its recon show. CYCLE = panel 1 turns through events→image→wave with the bar (see the limit cycle). LOCK IMG/EVT/WAV = hold panel 1 steady on that one modality. Does NOT change the architecture — all modalities are still time-separated and recovered; this only picks the displayed phase. Cycles on each click.';
    // RECOGNIZE — "give a reference object → its occurrences light up." THREE modes, each a DIFFERENT operator,
    // on its own button (click again to turn off). The image is a per-bar grid of L (reference) + (distractor)
    // glyphs at varying sizes; the matched recognizer marks the L's at any position/size on panel 4.
    //   ⊡ CAND  — candidate slots via the IFS leapfrog ROUND-TRIP (§7.34/§7.38); scale-search per slot.
    //   ∿ WAVE  — the IFS-native fractal-cascade WAVELET (§7.38 _ifsAnalyze): size reported by scale-band.
    //   ⊞ FFT   — the pure-conv DFT DENSE path (§7.36): every pixel scored at once, whole field glows.
    const _recogBtns = {};
    const _setRecog = (kind) => {
      if (!_eye) { console.warn('[EYE RECOG] enter LIVE + SOLITON first'); return; }
      _eyeRecogKind = (_eyeRecogKind === kind) ? null : kind;       // click same button = toggle off
      _eyeScene = null; _eyeSolReadKey = ''; _eyeRecogBar = -1; _eyeRecogDenseMap = null;
      for (const k in _recogBtns) _recogBtns[k].style.outline = (_eyeRecogKind === k) ? '2px solid #9fc' : '';
      console.log(`[SOLITON] RECOGNIZE mode → ${_eyeRecogKind ? _eyeRecogKind.toUpperCase() : 'OFF'}` +
        (_eyeRecogKind==='cand'?' (IFS round-trip, candidate slots §7.34)':_eyeRecogKind==='wave'?' (IFS fractal-cascade wavelet, RECON/photo §7.38)':_eyeRecogKind==='holo'?' (wavelet in the HOLOGRAM domain — improves with T §7.40)':_eyeRecogKind==='fft'?' (pure-conv DFT dense, every pixel §7.36)':''));
    };
    const btnRecogCand = mkBtn('⊡ CAND', '#043', '#9fc', () => _setRecog('cand'));
    const btnRecogWave = mkBtn('∿ WAVE', '#034', '#9cf', () => _setRecog('wave'));
    const btnRecogHolo = mkBtn('∿ HOLO', '#035', '#9bf', () => _setRecog('holo'));
    const btnRecogFFT  = mkBtn('⊞ FFT',  '#044', '#6fc', () => _setRecog('fft'));
    btnRecogCand.title = 'RECOGNIZE — CANDIDATE (§7.34/§7.38): scores 9 glyph slots via the IFS leapfrog ROUND-TRIP, scale-search per slot. The actual medium operator; slow at high T.';
    btnRecogWave.title = 'RECOGNIZE — WAVELET on the RECON/photo (§7.38): fractal-cascade on the refocused image. Sharp at moderate T but DEGRADES at high T (the photo blurs). A/B vs ∿ HOLO.';
    btnRecogHolo.title = 'RECOGNIZE — WAVELET in the HOLOGRAM domain (§7.40): the cascade matches the ref\'s HOLOGRAM against the scene\'s spread forward-T field. Discrimination IMPROVES with T (higher T = truer hologram) — the holographic way. Softer than recon but T-robust. A/B vs ∿ WAVE.';
    btnRecogFFT.title  = 'RECOGNIZE — FFT DENSE (§7.36): the pure-conv DFT path — every PIXEL scored at once via the convolution theorem. Whole field glows, O(N log N), independent of T.';
    _recogBtns.cand = btnRecogCand; _recogBtns.wave = btnRecogWave; _recogBtns.holo = btnRecogHolo; _recogBtns.fft = btnRecogFFT;

    // CLOCK MELODY — the COMPLEMENT of SOLITON. Here the note is generated DIRECTLY from the shared
    // clock formula (note = rollMelody(floor(cyc/nBins))[cyc%nBins]) — NOT recovered from the field.
    // Standalone benefit: PERFECT peer-sync (every peer plays the same note at the same cycle, no
    // warm-up, no drift, occlusion-independent) and the "clock IS the score" idea — depth=duration
    // played straight. SOLITON proves field/masking robustness; CLOCK MELODY proves clock determinism.
    const btnClockMel = mkBtn('♪ CLOCK-MEL', '#235', '#8df', () => {
      if (!_eye) { console.warn('[EYE CLOCK-MEL] enter LIVE first'); return; }
      _eyeUnitedLoaded = null;
      injectEvent?.({ type: 'setEyeDisplay', mode: 'clockmel' });
    });
    btnClockMel.title = 'MELODY FROM CLOCK: the note is generated from the shared clock formula (not reconstructed from the field) → perfect peer-sync, always clean, occlusion-independent. The complement to SOLITON (which recovers sound FROM the masked field). Same melody, two truths: clock-determinism vs field-holography.';

    // ⟳ CYCLE — the LIMIT-CYCLE demos (§7.43/§7.44): the binding OPERATOR and MULTIMEDIA as clock limit
    // cycles, turning live. Three explicit buttons: ⟳ CYCLE enters; ⟳ OP / ⟳ MEDIA pick the demo;
    // ⟳ CARRIER / ⟳ TEMPORAL pick the media packing (the 0.82↔1.0 dense self-fidelity comparison).
    const btnCycle = mkBtn('⟳ CYCLE', '#152', '#9fd', () => {
      if (!_eye) { console.warn('[EYE CYCLE] enter LIVE first'); return; }
      _eyeUnitedLoaded = null;
      injectEvent?.({ type: 'setEyeDisplay', mode: 'limitcycle' });
    });
    btnCycle.title = 'LIMIT CYCLE (§7.43/§7.44): "dense things can\'t share an instant, but they can share a clock." Enter, then use ⟳ OP / ⟳ MEDIA to pick a demo. OPERATOR — the rank-K binding operator walks its K ranks across K sub-ticks of the live clock, the bound output accumulating tick-by-tick over the bar (= the full binding, exact corr=1.0 at bar end). MEDIA — two DENSE images packed CARRIER (space, self≈0.82) vs TEMPORAL (time, self≈1.0), recovered live.';
    // demo selector (operator ↔ media)
    const btnCycleOp = mkBtn('⟳ OP', '#143', '#8fc', () => {
      if (!_eyeShowCycle) { console.warn('[CYCLE] enter ⟳ CYCLE first'); return; }
      _eyeCycleKind = 'operator'; _eyeCycleLastTick = -1; _eyeCycleAccum = null;
      console.log('[CYCLE] → OPERATOR demo'); });
    btnCycleOp.title = 'OPERATOR limit-cycle demo: the binding operator as a clock trajectory — one rank per tick, bound output accumulates over the bar to the exact full binding.';
    const btnCycleMedia = mkBtn('⟳ MEDIA', '#143', '#8fc', () => {
      if (!_eyeShowCycle) { console.warn('[CYCLE] enter ⟳ CYCLE first'); return; }
      _eyeCycleKind = 'media';
      console.log('[CYCLE] → MEDIA demo'); });
    btnCycleMedia.title = 'MULTIMEDIA limit-cycle demo: two DENSE images recovered live — toggle ⟳ CARRIER vs ⟳ TEMPORAL to watch the self-fidelity (0.82 dense-carrier vs 1.0 time-phased).';
    // media packing selector (carrier ↔ temporal)
    const btnCycleCarrier = mkBtn('⟳ CARRIER', '#134', '#9cf', () => {
      if (!_eyeShowCycle) { console.warn('[CYCLE] enter ⟳ CYCLE first'); return; }
      _eyeCycleKind = 'media'; _eyeCycleMediaUseTemporal = false;
      console.log('[CYCLE media] → CARRIER (space-mux, dense self≈0.82)'); });
    btnCycleCarrier.title = 'MEDIA packing = CARRIER (space orthogonal carriers). Dense modalities crosstalk → self-fidelity ≈0.82 (the §7.29 dense-leak regime).';
    const btnCycleTemporal = mkBtn('⟳ TEMPORAL', '#134', '#9cf', () => {
      if (!_eyeShowCycle) { console.warn('[CYCLE] enter ⟳ CYCLE first'); return; }
      _eyeCycleKind = 'media'; _eyeCycleMediaUseTemporal = true;
      console.log('[CYCLE media] → TEMPORAL (time-phased, self≈1.0)'); });
    btnCycleTemporal.title = 'MEDIA packing = TEMPORAL (time-phased on the clock). Each modality alone at its phase → self-fidelity ≈1.0 (the §7.44 result).';


    // RINGS — ring-band robustness sweep. Reconstructs with only one ring band at a
    // time and scores. Tests the band-limited MEDIUM (not hologram spectral redundancy).
    const btnRings = mkBtn('⊙ RINGS', '#053', '#8fd', () => {
      const n = world.getNodeState('hologram4');
      if (!_eye || !_localObjField || !n?.cachedRadii?.length) { console.warn('[EYE RING-BAND] enter LIVE + have an object first'); return; }
      _eye.sweepRingBands(_localObjField, n.cachedRadii, n.cachedWeights, n.cachedOffsets);
      _gpuKernelVersion = -1; // force kernel re-upload next frame (sweep restored it, but be safe)
      _eye.dirty = true;
    });
    btnRings.title = 'Ring-band redundancy: encode with the full kernel, decode with one ring band. Score reveals whether that band alone can invert the full hologram (mismatched legs → non-trivial).';

    // EYE ONLY toggle
    // EYE ONLY toggle — through reflector
    const btnEyeOnly = mkBtn('◎ EYE ONLY', '#333', '#888', () => injectEvent?.({ type: 'setEyeOnly' }));

    // H mode buttons — through reflector
    const _hModes = [
      { mode: 0, label: 'H=id',    title: 'Identity — exact round-trip' },
      { mode: 1, label: 'H=LP',    title: 'Low-pass aperture (r=param)' },
      { mode: 2, label: 'H=HP',    title: 'High-pass (r=param)' },
      { mode: 3, label: 'H=conj',  title: 'Phase conjugate' },
      { mode: 4, label: 'H=PKick', title: 'Plate phase kick (γ=param)' },
      { mode: 5, label: 'H=DKick', title: 'Demod phase kick (γ=param)' },
      { mode: 6, label: 'H=OCCL',  title: 'Left-column occlude (contiguous slab, r fraction)' },
      { mode: 7, label: 'H=RZero', title: 'Random-block ZERO (fraction=r, block=blk)' },
      { mode: 8, label: 'H=RNois', title: 'Random-block NOISE (fraction=r, block=blk)' },
    ];
    const _hBtns = _hModes.map(({ mode, label, title }) => {
      const b = mkBtn(label, mode === 0 ? '#363' : '#333', mode === 0 ? '#af8' : '#888',
        () => injectEvent?.({ type: 'setEyeH', hMode: mode }));
      b.title = title;
      Object.assign(b.style, { fontSize: '8px', padding: '3px 5px' });
      return b;
    });
    const hModeRow = document.createElement('div');
    Object.assign(hModeRow.style, { display: 'flex', gap: '1px', flexShrink: '0' });
    _hBtns.forEach(b => hModeRow.appendChild(b));

    // H param slider — through reflector
    const hParamWrap = document.createElement('div');
    Object.assign(hParamWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const hParamLbl = document.createElement('span');
    hParamLbl.style.cssText = 'color:#af8;font-size:8px;white-space:nowrap';
    hParamLbl.textContent = 'r=0.50';
    const hParamSlider = document.createElement('input');
    hParamSlider.type = 'range'; hParamSlider.min = '0'; hParamSlider.max = '1';
    hParamSlider.step = '0.02'; hParamSlider.value = '0.5';
    Object.assign(hParamSlider.style, { width: '60px', cursor: 'pointer' });
    hParamSlider.addEventListener('input', () => {
      injectEvent?.({ type: 'setEyeH', hParam: parseFloat(hParamSlider.value) });
      if (_eye) _eye.hParam = parseFloat(hParamSlider.value); // local, immediate (for depth render)
      if (_eyeShowDepth) _eyeDepthDirty = true;               // re-render 3D-HOLO at new occlusion
      if (_eyeShowSlices) _eyeSlicesDirty = true;             // re-render SLICES at new occlusion
      if (_eyeShowExplore) _eyeExploreDirty = true;           // re-render EXPLORE at new occlusion
      if (_eyeShowMM) _eyeMMDirty = true;                     // re-render MM at new occlusion
      if (_eyeShowClock) _eyeClockDirty = true;               // re-render CLOCK at new occlusion
      if (_eyeShowBeat) _eyeBeatDirty = true;                 // re-run event-timing at new occlusion
      if (_eyeShowSeq)  _eyeSeqDirty = true;                  // re-run sampler at new occlusion
      if (_eyeShowUnited) _eyeUnitedDirty = true;             // re-run united field at new occlusion
    });
    hParamWrap.appendChild(hParamLbl);
    hParamWrap.appendChild(hParamSlider);

    // Block size slider — through reflector
    const hBlockWrap = document.createElement('div');
    Object.assign(hBlockWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const hBlockLbl = document.createElement('span');
    hBlockLbl.style.cssText = 'color:#8fd;font-size:8px;white-space:nowrap';
    hBlockLbl.textContent = 'blk=8';
    const hBlockSlider = document.createElement('input');
    hBlockSlider.type = 'range'; hBlockSlider.min = '1'; hBlockSlider.max = '32';
    hBlockSlider.step = '1'; hBlockSlider.value = '8';
    Object.assign(hBlockSlider.style, { width: '50px', cursor: 'pointer' });
    hBlockSlider.addEventListener('input', () =>
      injectEvent?.({ type: 'setEyeH', hBlock: parseInt(hBlockSlider.value) }));
    hBlockWrap.appendChild(hBlockLbl);
    hBlockWrap.appendChild(hBlockSlider);

    // RECON-DEPTH slider (§7.22) — the soliton's RECOVERY round-trip depth, SEPARATE from the visual
    // T slider. Occlusion-robustness CROSSOVERS with this depth: shallow recon → notes concentrated →
    // heavy occlusion keeps ~(1−r); deep recon → notes spread → LIGHT occlusion fully recovers but
    // HEAVY occlusion wipes all (energy too thin). 0 = "follow visual T". Scrub it under H=OCCL to
    // SEE/HEAR the optimum. Local (exploration dial), not shared state.
    let _eyeReconT = 0;   // 0 = use visual T; >0 = explicit recon depth
    const reconWrap = document.createElement('div');
    Object.assign(reconWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const reconLbl = document.createElement('span');
    reconLbl.style.cssText = 'color:#fd8;font-size:8px;white-space:nowrap';
    reconLbl.textContent = 'recT=auto';
    const reconSlider = document.createElement('input');
    reconSlider.type = 'range'; reconSlider.min = '0'; reconSlider.max = '400'; reconSlider.step = '5'; reconSlider.value = '0';
    Object.assign(reconSlider.style, { width: '70px', cursor: 'pointer' });
    reconSlider.addEventListener('input', () => {
      _eyeReconT = parseInt(reconSlider.value);
      reconLbl.textContent = _eyeReconT === 0 ? 'recT=auto' : `recT=${_eyeReconT}`;
      _eyeSolReadKey = '';   // force soliton re-render at the new recon depth
    });
    reconWrap.appendChild(reconLbl);
    reconWrap.appendChild(reconSlider);

    // τ (depth-scrub) slider — IFS-native depth: scrub the observation point along the
    // evolution clock. Local (no reflector) so it's smooth/immediate for exploration.
    let _eyeTau = 0.0;
    const tauWrap = document.createElement('div');
    Object.assign(tauWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const tauLbl = document.createElement('span');
    tauLbl.style.cssText = 'color:#f9f;font-size:8px;white-space:nowrap';
    tauLbl.textContent = 'τ=0.00';
    const tauSlider = document.createElement('input');
    tauSlider.type = 'range'; tauSlider.min = '0'; tauSlider.max = '1';
    tauSlider.step = '0.02'; tauSlider.value = '0';
    Object.assign(tauSlider.style, { width: '70px', cursor: 'pointer' });
    // τ is SHARED world state (Krestianstvo compliance) — route through the reflector so all peers
    // scrub the same depth. Local _eyeTau is a derived cache, updated from n.eyeTau in the render
    // loop; the slider only injects. (Label updates optimistically for responsiveness.)
    tauSlider.addEventListener('input', () => {
      tauLbl.textContent = `τ=${parseFloat(tauSlider.value).toFixed(2)}`;
      injectEvent?.({ type: 'setEyeTau', tau: parseFloat(tauSlider.value) });
    });
    tauWrap.appendChild(tauLbl);
    tauWrap.appendChild(tauSlider);

    // SND-amp slider — combined-field multimedia (⊙ MM): image↔sound power balance. Low →
    // image dominates (img score ≈1, sound buried); high → balanced (both recover ~0.8).
    let _eyeSndAmp = 1.0;   // declared here (before the slider reads it — avoids TDZ)
    const sndWrap = document.createElement('div');
    Object.assign(sndWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const sndLbl = document.createElement('span');
    sndLbl.style.cssText = 'color:#fcf;font-size:8px;white-space:nowrap';
    sndLbl.textContent = `snd=${_eyeSndAmp.toFixed(1)}`;
    const sndSlider = document.createElement('input');
    sndSlider.type = 'range'; sndSlider.min = '0'; sndSlider.max = '3';
    sndSlider.step = '0.1'; sndSlider.value = String(_eyeSndAmp);
    Object.assign(sndSlider.style, { width: '60px', cursor: 'pointer' });
    sndSlider.addEventListener('input', () => {
      _eyeSndAmp = parseFloat(sndSlider.value);
      sndLbl.textContent = `snd=${_eyeSndAmp.toFixed(1)}`;
      if (_eyeShowMM) _eyeMMDirty = true;   // re-run MM round-trip at new balance
      if (_eyeShowSeq) _eyeSeqDirty = true; // in SEQ, snd= controls voice LAYERS (rows averaged)
    });
    sndWrap.appendChild(sndLbl);
    sndWrap.appendChild(sndSlider);

    // MIX slider — through reflector
    const mixWrap = document.createElement('div');
    Object.assign(mixWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const mixLbl = document.createElement('span');
    mixLbl.style.cssText = 'color:#af8;font-size:8px;white-space:nowrap';
    mixLbl.textContent = 'MIX 0';
    const mixSlider = document.createElement('input');
    mixSlider.type = 'range'; mixSlider.min = '0'; mixSlider.max = '1';
    mixSlider.step = '0.05'; mixSlider.value = '0';
    Object.assign(mixSlider.style, { width: '50px', cursor: 'pointer' });
    mixSlider.addEventListener('input', () =>
      injectEvent?.({ type: 'setEyeMix', mix: parseFloat(mixSlider.value) }));
    mixWrap.appendChild(mixLbl);
    mixWrap.appendChild(mixSlider);

    // Shape buttons
    const mkShapeBtn = (label, shape) => mkBtn(label, '#333', '#aaa', () => injectEvent?.({ type: 'setShape', shape }));
    const shapeRow = document.createElement('div');
    Object.assign(shapeRow.style, { display: 'flex', gap: '2px', flexShrink: '0' });
    shapeRow.appendChild(mkShapeBtn('■ CUBE', 'cube'));
    shapeRow.appendChild(mkShapeBtn('▲ PYRAMID', 'pyramid'));
    shapeRow.appendChild(mkShapeBtn('⬡ BOTH', 'combined'));
    // Dense objects — stress-test true holography (no sparse background to cheat the score).
    const bFilled  = mkShapeBtn('● FILLED', 'filled');   bFilled.title  = 'Dense filled disc — every cell nonzero. Stress-tests holography with a structured dense object.';
    const bTexture = mkShapeBtn('▦ TEXTURE', 'texture');  bTexture.title = 'Full-grid random complex texture — maximal information, zero sparse structure. The hardest holography test: if redundancy survives this, the result is airtight.';
    shapeRow.appendChild(bFilled);
    shapeRow.appendChild(bTexture);
    // Multi-depth structured object as a LIVE source — staged depth injection in the live
    // eye pipeline, so all sliders (occlusion, block, T) update the depth hologram live.
    const b3d = mkShapeBtn('◈ 3D', 'depth3d');  b3d.title = 'Multi-depth structured object (disc/ring/cross/frame across N depth layers) as a LIVE source — the real-scene holography proxy. All sliders update it continuously in LIVE mode.';
    shapeRow.appendChild(b3d);
    // Continuous depth-map object — the NATIVE 3D form: one wavefront, depth painted into
    // phase (no layers). Use with ◎ EXPLORE for smooth continuous depth scrubbing.
    const bMap = mkShapeBtn('◈ MAP', 'depthmap');  bMap.title = 'Continuous depth-map object — a smooth depth surface z(x,y) encoded as PROPAGATION DISTANCE (each pixel injected at the forward step set by its depth, finely binned ≈ continuous). Use with ◎ EXPLORE: τ scrubs REAL continuous depth-of-focus.';
    shapeRow.appendChild(bMap);

    const mkSep = () => {
      const s = document.createElement('div');
      Object.assign(s.style, { width:'1px', height:'18px', background:'#333', flexShrink:'0', alignSelf:'center' });
      return s;
    };

    // T slider — through reflector
    const tWrap = document.createElement('div');
    Object.assign(tWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const tLbl = document.createElement('span');
    tLbl.style.cssText = 'color:#fb8;font-size:8px;white-space:nowrap';
    tLbl.textContent = `T=${EYE_T_STEPS}`;
    const tSlider = document.createElement('input');
    tSlider.type = 'range'; tSlider.min = '1'; tSlider.max = '500';
    tSlider.step = '1'; tSlider.value = String(EYE_T_STEPS);
    Object.assign(tSlider.style, { width: '80px', cursor: 'pointer' });
    tSlider.addEventListener('input', () =>
      injectEvent?.({ type: 'setEyeT', tSteps: parseInt(tSlider.value) }));
    tWrap.appendChild(tLbl);
    tWrap.appendChild(tSlider);

    // SAVE / LOAD — local only (file I/O, not shared state)
    const btnSave = mkBtn('💾 SAVE', '#234', '#8ef', () => {
      if (!_eye) return;
      const n = world.getNodeState('hologram4');
      // UNITED mode: save the ONE wavefront carrying image+events+voice (+depth, intrinsic).
      // _eyeSeqLast holds the last unitedField result {holo, …}. Restored as one field.
      if (_eyeShowUnited && _eyeSeqLast?.holo) {
        _eye.downloadUnited(_eyeSeqLast, 'united_hologram.kwe',
          { angleY: n?.angleY, angleX: n?.angleX, shape: n?.shape ?? 'cube' });
      } else {
        _eye.download('eye_hologram.kwe', { angleY: n?.angleY, angleX: n?.angleX, shape: n?.shape ?? 'cube' });
      }
    });
    btnSave.title = 'Save hologram to .kwe (UNITED mode → one field: image+events+voice+depth)';

    const btnLoad = mkBtn('📂 LOAD', '#234', '#fa8', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.kwe,.ifsh,.bin';
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        if (!_eye) return;
        const rawBuf = await file.arrayBuffer();
        const buf    = await IFSEye.decompress(rawBuf);
        // Peek the type without consuming: united files carry type:'eye-united'.
        const _ml   = new Uint32Array(buf, 0, 1)[0];
        const _meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, _ml)));
        if (_meta.type === 'eye-united') {
          // UNITED: restore the ONE field, then replay all three readouts from it.
          const { holo, geom, meta } = _eye.loadUnited(buf);
          if (meta.tSteps !== undefined) injectEvent?.({ type: 'setEyeT', tSteps: meta.tSteps });
          if (meta.hMode !== undefined || meta.hParam !== undefined || meta.hSteps !== undefined)
            injectEvent?.({ type: 'setEyeH', hMode: meta.hMode, hParam: meta.hParam, hBlock: meta.hSteps });
          _eyeUnitedLoaded = { holo, geom };           // live render reads this in UNITED mode
          injectEvent?.({ type: 'setEyeDisplay', mode: 'united' }); // switch to UNITED so panels show
          _eyeUnitedDirty  = true;
          return;
        }
        const meta   = _eye.load(buf);
        _eyeUnitedLoaded = null;
        // Push loaded params into world state via reflector so they aren't overwritten
        if (meta.hMode  !== undefined || meta.hParam !== undefined || meta.hSteps !== undefined)
          injectEvent?.({ type: 'setEyeH', hMode: meta.hMode, hParam: meta.hParam, hBlock: meta.hSteps });
        if (meta.tSteps !== undefined)
          injectEvent?.({ type: 'setEyeT', tSteps: meta.tSteps });
        _eyeShowLoaded  = true;
        _eyeLoadedDirty = true; // trigger renderLoaded() on first frame
      };
      input.click();
    });
    btnLoad.title = 'Load .kwe eye hologram — restores evidence and params';

    const btnPlayer = mkBtn('▶ PLAYER', '#333', '#888', () => {
      _eyeShowLoaded  = false;
      _eyeLoadedDirty = false;
    });
    btnPlayer.title = 'Exit player mode — resume live eye pipeline';

    controlBar.appendChild(btnLive);
    controlBar.appendChild(btnEyeOnly);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(btnSave);
    controlBar.appendChild(btnLoad);
    controlBar.appendChild(btnPlayer);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(btnProbe);
    controlBar.appendChild(btnSweep);
    controlBar.appendChild(btnDepth);
    controlBar.appendChild(btnMDepth);
    controlBar.appendChild(btnSlices);
    controlBar.appendChild(btnIso);
    controlBar.appendChild(btnExplore);
    controlBar.appendChild(btnSound);
    controlBar.appendChild(btnMM);
    controlBar.appendChild(btnClock);
    controlBar.appendChild(btnBeat);
    controlBar.appendChild(btnMel);
    controlBar.appendChild(btnSeq);
    controlBar.appendChild(btnMask);
    controlBar.appendChild(btnUnited);
    controlBar.appendChild(btnSoliton);
    controlBar.appendChild(btnGate);
    controlBar.appendChild(btnOpCyc);
    controlBar.appendChild(btnPhase);
    controlBar.appendChild(btnRecogCand);
    controlBar.appendChild(btnRecogWave);
    controlBar.appendChild(btnRecogHolo);
    controlBar.appendChild(btnRecogFFT);
    controlBar.appendChild(btnClockMel);
    controlBar.appendChild(btnCycle);
    controlBar.appendChild(btnCycleOp);
    controlBar.appendChild(btnCycleMedia);
    controlBar.appendChild(btnCycleCarrier);
    controlBar.appendChild(btnCycleTemporal);
    controlBar.appendChild(btnRings);
    controlBar.appendChild(tWrap);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(hModeRow);
    controlBar.appendChild(hParamWrap);
    controlBar.appendChild(hBlockWrap);
    controlBar.appendChild(reconWrap);
    controlBar.appendChild(tauWrap);
    controlBar.appendChild(sndWrap);
    controlBar.appendChild(mixWrap);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(shapeRow);

    // ── Drag-to-rotate — pure Krestianstvo: all angles from world state only ──
    const ROTATE_THROTTLE_MS = 50;
    let _dragging = false, _dragX0 = 0, _dragY0 = 0, _lastRotateMs = 0;
    let _baseAngleY = INIT_ANGLE_Y, _baseAngleX = INIT_ANGLE_X;
    const _clientXY = (e) => { const t = e.touches ?? e.changedTouches; return t?.length ? [t[0].clientX, t[0].clientY] : [e.clientX, e.clientY]; };
    const _onStart  = (e) => { e.preventDefault(); _dragging = true; [_dragX0, _dragY0] = _clientXY(e); _baseAngleY = n_angle_Y(); _baseAngleX = n_angle_X(); _lastRotateMs = 0; _injectEvent?.({ type: 'dragStart' }); };
    const _onMove   = (e) => {
      if (!_dragging) return; e.preventDefault();
      const now = performance.now();
      if (now - _lastRotateMs < ROTATE_THROTTLE_MS) return;
      _lastRotateMs = now;
      const [cx, cy] = _clientXY(e);
      injectEvent?.({ type: 'rotate', angleY: _baseAngleY + (cx - _dragX0) * 0.012, angleX: _baseAngleX + (cy - _dragY0) * 0.012 });
    };
    const _onEnd    = (e) => { if (!_dragging) return; e.preventDefault(); _dragging = false; _injectEvent?.({ type: 'dragEnd' }); };
    const _attachDrag = (el) => { el.addEventListener('mousedown', _onStart, { passive: false }); el.addEventListener('touchstart', _onStart, { passive: false }); el.style.touchAction = 'none'; el.style.cursor = 'crosshair'; };
    // Current world angles (read at drag-start and for obj field rebuild)
    const n_angle_Y = () => world.getNodeState('hologram4')?.angleY ?? INIT_ANGLE_Y;
    const n_angle_X = () => world.getNodeState('hologram4')?.angleX ?? INIT_ANGLE_X;
    window.addEventListener('mousemove', _onMove);
    window.addEventListener('touchmove', _onMove, { passive: false });
    window.addEventListener('mouseup',   _onEnd);
    window.addEventListener('touchend',  _onEnd);

    // ── Local state ────────────────────────────────────────────────────────
    let _gpu             = null;
    let _gpuReady        = false;
    let _gpuKernelVersion = -1;
    let _liveMode        = false;
    let _eyeOnlyMode     = false;
    let _localObjField   = null;
    let _localPsi        = null;
    let _localAngleYSeen = null;
    let _localAngleXSeen = null;
    let _localShapeSeen  = null;
    let _localKernelVersion = -1;
    let _smoothMaxField  = 0;
    let _smoothMaxPlate  = 0;
    let _localPlate      = null;
    let _psiReadPending  = false;
    let _localStepCount  = 0;
    let _localDirection  = 1;
    let _eyeObjKeySeen   = '';
    let _eyeShowLoaded   = false; // true after load — show eye row + render evidence even without LIVE
    let _eyeLoadedDirty  = false; // true on first frame after load — triggers renderLoaded() once
    let _eyeShowDepth    = false; // 3D-HOLO display mode — render multi-depth staged hologram
    let _eyeDepthDirty   = false; // recompute the depth render (entry / occlusion change)
    let _eyeDepthLayers  = null;  // cached depth layers
    let _eyeShowSlices   = false; // SLICES display mode — per-layer refocused depth slices
    let _eyeSlicesDirty  = false; // recompute the slice render
    let _eyeSlicePair    = 0;     // which pair of layers the 2 slice panels show
    let _eyeShowExplore  = false; // EXPLORE mode — τ depth-scrub (IFS-native depth vision)
    let _eyeExploreDirty = false; // recompute the depth-scrub render (τ change)
    let _eyeDepthMap     = null;  // cached continuous depth-map wavefront (◈ MAP scene)
    // ── Multimedia: IFS sound hologram, locked to the SAME τ as the image depth explorer.
    // One fractal clock → image-depth and sound-time are the SAME axis (structural sync).
    let _eyeSound        = null;  // IFSSound instance
    let _eyeAudioCtx     = null;  // WebAudio context (created on first play)
    let _eyeSoundPlay    = false; // play the τ-reconstructed sound when scrubbing
    let _eyeShowMM       = false; // combined-field multimedia hologram display
    let _eyeMMDirty      = false; // recompute the MM round-trip
    let _eyeShowClock    = false; // CLOCK-MODULATED multimedia ("no tricks") display
    let _eyeClockDirty   = false; // recompute the clock-modulated round-trip
    let _eyeHeartbeat    = new Float64Array(8); // live IFS-depth energy envelope (the real heartbeat)
    const _eyeBeatHistLen = 128;                 // ring buffer of recent heartbeat samples → audio
    let _eyeBeatHist     = new Float64Array(_eyeBeatHistLen);
    let _eyeBeatHead     = 0;
    let _eyeShowBeat     = false; // BEAT mode — event-timing holography (rhythm IN the field)
    let _eyeBeatDirty    = false; // recompute the event-timing round-trip
    let _eyeBeatCapture  = [];    // captured live fresnelBeat events = the pattern to encode
    let _eyeBeatLastBar  = -1;    // phase-absolute bar index for BEAT/MEL playback (peer-synced loop)
    let _eyeBeatPulseMs  = 0;     // last nextCycle auto-pulse (keep the clock producing events)
    let _eyeBeatSeen     = null;  // content-key set for de-duplicating captured events
    let _eyeMelodyMode   = false; // BEAT carries an AUTHORED melody (our content) vs live clock beats
    let _eyeModeSeen     = '';    // last eyeDisplayMode applied from world state (change detection)
    let _eyeShowSeq      = false; // SEQ mode — holographic sampler (events transport a waveform voice)
    let _eyeSeqDirty     = false; // recompute the sampler round-trip (params changed)
    let _eyeSeqLast      = null;  // last recomputed sampler result — what the loop plays
    let _eyeSeqLastBar   = -1;    // last PHASE-ABSOLUTE bar index fired = floor(cycleCount/barCycles).
                                  // Absolute (not per-peer baseline) so all peers share bar boundaries.
    let _eyeSeqLastBarMs = 0;     // wall-time of that bar — only to MEASURE bar length (display timing)
    let _eyeSeqBarSecs   = 0;     // smoothed bar length (sec) — LAZY-INIT from first measured cadence (0 = unset)
    let _eyeBeatLastBarMs = 0;    // wall-time of last BEAT/MEL bar — to measure its span (bar length)
    let _eyeSeqCursor    = 0;     // audio-clock cursor: where the next bar's onset is scheduled
    let _eyeSeqDiagLastStart = 0; // diag: previous bar's scheduled audio start (→ onset gap)
    let _eyeSeqLogN;              // throttle the bar log (auto-caps at 30 lines)
    const _EYE_SEQ_BAR_CYCLES = 1; // bar = this many IFS fractal cycles (the cycle that made the events)
    let _eyeShowUnited   = false; // UNITED mode — image+events+sound in one field (§7.14)
    let _eyeUnitedDirty  = false; // recompute the united-field round-trip
    let _eyeUnitedLoaded = null;  // { holo, geom } from a LOADED united file → replay readouts (no forward pass)
    let _eyeShowSoliton  = false; // SOLITON mode — the LIVE continuous (advected) united field (§7.15)
    let _eyeShowClockMel = false; // CLOCK-MEL mode — note from the clock formula (peer-sync), not field
    let _eyeClockMelLastCyc = -1; // last CYCLE whose note was played (clock-mel: one note per cycle, u11)
    // ── LIMIT-CYCLE mode (§7.43/§7.44): the operator AND multimedia as clock limit cycles, LIVE ──
    let _eyeShowCycle    = false; // ⟳ CYCLE mode — visualize the limit cycle turning on the live clock
    let _eyeCycleKind    = 'operator'; // 'operator' (rank cycling + bound accumulation) | 'media' (carrier vs temporal)
    let _eyeCycleOp      = null;  // operatorSolitonCyc instance (built once); _eyeCycleA/_eyeCycleB its live inputs
    let _eyeCycleA = null, _eyeCycleB = null; // the two input vectors the operator binds (visualized as fields)
    let _eyeCycleAccum   = null;  // Float64Array(Nr) — the bound output accumulating tick-by-tick over the bar
    let _eyeCycleCells   = null;  // grid-cell indices the Nr operator dims live on (GPU lattice)
    let _eyeCycleLastTick= -1;    // last clock tick the operator advanced (one rank per tick)
    let _eyeCycleNr      = 64;    // operator dimension (Nr cells), small enough to render as an 8×8 tile
    let _eyeCycleMedia   = null;  // {imgA, imgB} the two dense images for the media demo (built once)
    let _eyeCycleMediaUseTemporal = false; // media sub-toggle: false=carrier, true=temporal (the live A/B comparison)
    let _eyeSolLogN      = 30;    // throttle soliton frame log
    let _eyeSolReadKey   = '';    // (cyc,τ,occ,T,K) signature of the last Ψ(cyc) render — cache key (§7.22)
    let _eyeScene        = null;  // composite Soliton (event ⊕ image ⊕ wave) from the algebra (§7.26)
    let _eyeSceneKey     = '';    // scene-build signature (img span + rows) — rebuild when it changes
    let _eyeImgFull      = false; // image spans FULL grid (dbl-click ⊙ SOLITON) vs top region — §7.29 test
    let _eyeGateMode     = false; // GATE mode (§7.33): scene = gate(events,image) — beat carves the image
    let _eyeOpCycMode    = false; // OP-CYCLE mode (§7.43): the rank-K operator-as-clock binds two scene fields
    let _eyeOpCycObj     = null;  // operatorSolitonCyc fitted to bind events×image (built once, on the scene Nr)
    let _eyeOpCycCells   = null;  // grid lattice for the operator's Nr dims (GPU path)
    let _eyeOpCycBound   = null;  // last bound output field (Nr) for panel-4 render
    let _eyeOpCycLastBar = -1;    // last bar the operator bound the scene (re-bind per bar, not per frame)
    // SOLITON temporal display lock (§7.44, VISUAL only): which phase panel 1 + recon show. 'live' = cycle all
    // three holograms; or lock to a modality ('image'|'event'|'wave'). Cycles via the ⟳ PHASE button.
    let _eyeTemporalLock = 'live';
    const _TEMPORAL_LOCKS = ['live', 'image', 'event', 'wave'];
    let _eyeRecogKind    = null;  // recognition mode: null=off | 'cand' (IFS round-trip slots, §7.34/§7.38)
    let _eyeHoloVsTRun   = false; // §7.40: run the hologram-vs-recon-domain recognition-vs-T probe ONCE
    window.holoVsT = () => { _eyeHoloVsTRun = true; console.log('[§7.40] will run hologram-vs-recon recog-vs-T on the next recog bar — enter ⊡/∿/⊞ RECOG'); };
    // §7.46 no-tricks truthness: does the WAVE compute the algebra (correlation), or the JS CPU? Runs the
    // operation through real IFS propagation + carrier demod, vs the CPU correlation. console: opTruthness()
    window.opTruthness = (T = 50, trials = 6) => { if (!_eye) { console.warn('[§7.46] enter LIVE first'); return; } return _eye.operatorTruthnessTest({ T, trials }); };
    // §7.47 the make-or-break for "full operator as PURE propagation": is a dot product computable as a FOCUS?
    // (A) IFS propagate→read-center vs (B) DFT DC term (ideal) vs CPU dot. console: propDot()
    window.propDot = (T = 50, trials = 12) => { if (!_eye) { console.warn('[§7.47] enter LIVE first'); return; } return _eye.propagationDotTest({ T, trials }); };
    // §7.48 the LENS fix: build a phase-conjugate Green's lens, see if it makes the leapfrog focus U·a to the
    // dot product (the −18% was the missing lens). console: lensDot()
    window.lensDot = (D = 30, trials = 12) => { if (!_eye) { console.warn('[§7.48] enter LIVE first'); return; } return _eye.lensFocusDotTest({ D, trials }); };
    // §7.49 the INVERSE-filter idea (M=1/L, not conjugate) + a reciprocity control that tests its core assumption
    // (is the forward-to-center map actually L?). console: invDot()
    window.invDot = (D = 30, trials = 12) => { if (!_eye) { console.warn('[§7.49] enter LIVE first'); return; } return _eye.inverseFilterDotTest({ D, trials }); };
    // §7.50 the IFS-native LENS the leapfrog isn't: a phase-carrying DFT-diagonal Fresnel propagator. Does it
    // focus U·a to the dot product? matched-vs-mismatched-lens control. console: fresnelDot()
    window.fresnelDot = (alpha = null, trials = 12) => { if (!_eye) { console.warn('[§7.50] enter LIVE first'); return; } return _eye.fresnelFocusDotTest({ alpha, trials }); };
    // §7.51 the NLS-NATIVE analog of "dot=DC Fourier mode": does the cubic nonlinearity self-focus a spread field's
    // conserved mass into a soliton? (the nonlinearity is the lens the linear leapfrog lacks). console: nlsFocus()
    window.nlsFocus = (T = 8, steps = 40, gamma = 0.5) => { if (!_eye) { console.warn('[§7.51] enter LIVE first'); return; } return _eye.nlsSelfFocusDot({ T, steps, gamma }); };
                                  //   | 'wave' (IFS fractal-cascade wavelet, §7.38) | 'fft' (pure-conv DFT dense, §7.36)
    let _eyeRecogDenseMap= null;  // {map:Float64(N), scaleAt:Float32(N)} last dense/wavelet recognition map
    let _eyeHoloPresence = null;  // {presence,aCorr,dCorr} — §7.40 hologram-domain PRESENCE meter (∿ HOLO)
    let _recogSharpPow   = 22;    // 18 recog quality dials (tune live: window.recogTune(sharpPow, energyGate, thr))
    let _recogEnergyGate = 3;
    let _recogThr        = 0.45;   // overlay glow threshold on the match map
    let _recogDisWeight  = 0.5;   // λ: subtract distractor-likeness (all distractors averaged); 0=off, ~0.5 gentle
    window.recogTune = (sp, eg, thr, dw) => { if(sp!=null) _recogSharpPow=sp; if(eg!=null) _recogEnergyGate=eg; if(thr!=null) _recogThr=thr; if(dw!=null) _recogDisWeight=dw;
      _eyeRecogBar=-1; console.log(`[recog tune] sharpPow=${_recogSharpPow} energyGate=${_recogEnergyGate} thr=${_recogThr} disWeight=${_recogDisWeight}`); };
    let _eyeRecogBar     = -1;    // last bar the recognizer ran (re-eval per bar, not per frame — cost control)
    let _eyeRecogHits    = null;  // [{x,y,score,isRef}] last recognition result for the overlay
    let _eyeRecogSlots   = null;  // [{x,y,isRef}] candidate glyph slots for the current bar
    const g_imgRows = () => Math.round(GRID * _EYE_ROLL_IMG_FRAC);  // image rows for the scene regions
    const _EYE_SOL_BAR_STEPS = 40; // (legacy) used by the structure/sync sweeps as their bar period
    let   _EYE_SOL_K     = 3;      // CLOCK-PURE soliton memory horizon: bars kept alive in Ψ(cyc). window
                                   // model (GPU-measured cheapest, peerCorr=1.0). Tunable dial (§7.22).
    const _EYE_ROLL_TIERS = 8;     // pitch ladder height (8 pitches → an octave). 8 pitches need more
                                   // vertical room than the 26-row default strip gives, so the roll geom
                                   // below uses imgRowsFrac=0.35 → ~42 event rows → ~5px/pitch, clean
                                   // ~3px footprint gaps (no touching). Trade: smaller image region (§7.16).
    const _eyeRollBins   = 4;      // onset resolution per bar — coarse (full-width → 16px col spacing)
    const _EYE_ROLL_IMG_FRAC = 0.35; // image region in roll mode (smaller, to give 8 pitches their rows)
    const _EYE_UNITED_T  = 350;   // deep T the masking measurement requires for all 3 modalities
    // _eyeSndAmp declared earlier (near the SND slider) to avoid temporal-dead-zone

    // IFSEye instance (created once GPU is ready)
    let _eye = null;

    // ── Physics helpers (same as hologram4_native._rendererPhysics) ────────
    const TWO_PI = 2 * Math.PI;
    const SHAPE_PTS = { cube: CUBE_PTS, pyramid: PYRAMID_PTS, combined: COMBINED_PTS, none: [] };

    const _projectSources = (angleY, angleX, shape = 'cube') => {
      const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
      const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
      const halfG = (GRID - 1) / 2;
      const fscale = halfG * PROJ_SCALE;
      const reconZ = Math.round(GRID / 16);
      const pts = SHAPE_PTS[shape] ?? CUBE_PTS;
      const total = pts.length;
      return pts.map(([ox, oy, oz]) => {
        const ry1 =  cosY * ox + sinY * oz;
        const rz1 = -sinY * ox + cosY * oz;
        const rx  =  ry1;
        const ry  =  cosX * oy - sinX * rz1;
        const rz  =  sinX * oy + cosX * rz1;
        const z   =  CAM_Z - rz;
        return {
          sx:  halfG + (rx / z) * fscale * CAM_Z,
          sy:  halfG - (ry / z) * fscale * CAM_Z,
          sz:  z * (reconZ / CAM_Z),
          amp: 200.0 * (0.5 + 0.5 * (rz + 1) / 2) / total,
        };
      });
    };

    // Dense objects — every cell nonzero, NO sparse background for back-flow to cheaply
    // refocus onto. These stress-test "true holography": with a dense source a bad decode
    // has nowhere to hide, so the reconstruction score can actually FAIL (unlike the sparse
    // wireframe, where any refocusing to the edge points scores ~1.0). Deterministic
    // (fixed hash, no RNG) so the cached snap is stable and the sweep is reproducible.
    const _denseHash = (i) => { let x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
    const _buildDenseField = (kind) => {
      const field = new Float64Array(2 * N_CELLS);
      const cx = (GRID - 1) / 2, cy = (GRID - 1) / 2, R = GRID * 0.4;
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const j = y * GRID + x;
          let amp = 0, ph = 0;
          if (kind === 'texture') {
            // Full-grid random complex texture — maximal information, zero sparse structure.
            amp = 0.5 + 0.5 * _denseHash(j);
            ph  = _denseHash(j + 99991) * Math.PI * 2;
          } else { // 'filled' — solid disc with smooth radial phase (dense but structured)
            const dx = x - cx, dy = y - cy, r = Math.sqrt(dx*dx + dy*dy);
            if (r > R) continue;
            amp = 1.0;
            ph  = (r / R) * Math.PI * 3 + Math.atan2(dy, dx);
          }
          field[j*2]   = amp * Math.cos(ph);
          field[j*2+1] = amp * Math.sin(ph);
        }
      }
      return field;
    };

    // Multi-depth STRUCTURED object: N depth layers, each a DISTINCT recognizable shape
    // (disc, ring, cross, frame…) at its own depth. Visible structure → the 3D-HOLO panels
    // show recognizable layered content (not just noise), while still being a genuine
    // multi-depth object that exercises the depth-superposition mechanism. Each shape's
    // interior is dense (filled), so it's not a sparse wireframe. Per-layer phase offset
    // keeps the layers independent. Returned near→far for staged-injection holography.
    const _buildDepthLayers = (nLayers) => {
      const cx = (GRID - 1) / 2, cy = (GRID - 1) / 2;
      const amp0 = 1.0 / nLayers;          // normalize total power across layers
      // per-layer shape predicate (dense fills, distinct per depth)
      const inShape = (kind, x, y) => {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
        const Rmax = GRID * 0.42;
        switch (kind) {
          case 0: return r < Rmax * 0.55;                          // solid disc (near)
          case 1: return r > Rmax * 0.6 && r < Rmax;               // annulus / ring
          case 2: return Math.abs(dx) < Rmax*0.18 || Math.abs(dy) < Rmax*0.18; // cross
          case 3: { const a = Math.max(Math.abs(dx), Math.abs(dy)); // square frame
                    return a > Rmax*0.5 && a < Rmax*0.75; }
          default: return r < Rmax;                                // fallback filled
        }
      };
      const layers = [];
      for (let d = 0; d < nLayers; d++) {
        const f = new Float64Array(2 * N_CELLS);
        const phOff = d * 1.7;             // per-layer phase offset → independent layers
        const kind  = d % 4;
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            if (!inShape(kind, x, y)) continue;
            const j = y * GRID + x;
            const amp = amp0;              // dense fill (constant amplitude inside the shape)
            const ph  = phOff + 0.04 * (x + y);  // mild ramp → some phase content
            f[j*2]   = amp * Math.cos(ph);
            f[j*2+1] = amp * Math.sin(ph);
          }
        }
        layers.push(f);
      }
      return layers;
    };

    // ── RECOGNITION glyphs (§7.34). A small centered L (the reference) and + (distractor), real fields.
    const _GLYPH_S = Math.max(2, Math.round(GRID * 0.07));   // glyph half-size unit (used by the CAND glow overlay)
    // ── LETTER recognition. Rasterize REAL letters via the browser font engine
    //    into the grid, then waveletRecognizePure (CPU-only) lights up occurrences of a reference letter
    //    among OTHER letters (none a pure analog of the target). Bigger than the 8px glyphs → the angular
    //    cascade has enough resolution to tell letter shapes apart. _letterFont caches one offscreen canvas.
    let _letterCvs = null, _letterCtx = null;
    // rasterize a single character centered in a cellSize×cellSize box → Float64Array(cellSize²) intensity.
    const _rasterLetter = (ch, cell) => {
      if (!_letterCvs) { _letterCvs = document.createElement('canvas'); _letterCtx = _letterCvs.getContext('2d', { willReadFrequently: true }); }
      _letterCvs.width = cell; _letterCvs.height = cell;
      const c = _letterCtx; c.clearRect(0,0,cell,cell); c.fillStyle = '#fff';
      c.font = `bold ${Math.round(cell*0.82)}px sans-serif`; c.textAlign='center'; c.textBaseline='middle';
      c.fillText(ch, cell/2, cell/2 + cell*0.04);
      const px = c.getImageData(0,0,cell,cell).data, out = new Float64Array(cell*cell);
      for (let i=0;i<cell*cell;i++) out[i] = px[i*4+3] / 255;   // alpha = ink coverage
      return out;
    };
    // rasterize a clean filled SHAPE ('tri'|'sq'|'circ') centered in a cell box → Float64Array(cell²) ink.
    // Geometric shapes are far more distinguishable than letters → cleaner recognition demo.
    const _rasterShape = (kind, cell) => {
      if (!_letterCvs) { _letterCvs = document.createElement('canvas'); _letterCtx = _letterCvs.getContext('2d', { willReadFrequently: true }); }
      _letterCvs.width = cell; _letterCvs.height = cell;
      const c = _letterCtx; c.clearRect(0,0,cell,cell);
      const m = cell*0.12, s = cell - 2*m;   // inset margin
      // OUTLINE (stroke), not FILL: a filled shape is bright everywhere inside → the angular descriptor is
      // dominated by the uniform fill (same for tri/sq/circ) and can't tell shapes apart (it matched circles).
      // The shape lives in the BOUNDARY: a triangle outline = 3-fold angular signature, square = 4-fold,
      // circle = rotationally uniform → the cascade separates them cleanly.
      c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, cell*0.10); c.lineJoin = 'round';
      c.beginPath();
      if (kind === 'tri')      { c.moveTo(cell/2, m); c.lineTo(cell-m, cell-m); c.lineTo(m, cell-m); c.closePath(); }
      else if (kind === 'sq')  { c.rect(m, m, s, s); }
      else /* circ */          { c.arc(cell/2, cell/2, s/2, 0, 7); }
      c.stroke();
      const px = c.getImageData(0,0,cell,cell).data, out = new Float64Array(cell*cell);
      for (let i=0;i<cell*cell;i++) out[i] = px[i*4+3] / 255;
      return out;
    };
    // ONE cell size shared by the reference AND the page shapes — they MUST match, or the angular descriptors
    // compare shapes at different scales (mismatch → wrong matches). Single source of truth, derived from the
    // SAME 3×3 pitch the page uses (non-overlapping layout) so ref size == page base size at scale 1.0.
    const _LETTER_SCALES_MAX = 1.35;
    const _LETTER_CELL = Math.round((GRID / 3 * 0.82) / _LETTER_SCALES_MAX);
    // a centered reference SHAPE as a Float64Array(N) (grid-sized), for waveletRecognizeGPU's ref arg.
    const _letterRef = (ch) => { const cell = _LETTER_CELL, g = _rasterShape(ch, cell);
      const f = new Float64Array(N_CELLS), cC = GRID>>1, o = cell>>1;
      // flip Y: canvas is top-down but the wavefront grid displays Y-up → invert so it reads right-side-up.
      for (let y=0;y<cell;y++) for (let x=0;x<cell;x++){ const v=g[(cell-1-y)*cell+x]; if(!v) continue;
        const X=cC+x-o, Y=cC+y-o; if(X>=0&&X<GRID&&Y>=0&&Y<GRID) f[Y*GRID+X]+=v; } return f; };
    // a PAGE of SHAPES in a 3×3 layout, chosen per-bar (clock-pure). TARGET = triangle ('tri'), DISTRACTORS
    // = square/circle. Geometric shapes are far more distinguishable than letters → clean recognition.
    const _LETTER_TARGET = 'tri', _LETTER_DISTRACT = ['sq', 'circ'];
    const _LETTER_SCALES = [0.65, 1.0, 1.35];   // letters appear at VARYING sizes → the recognizer must be scale-invariant
    const _LETTER_DEPTHS = 3;                    // letters live on N DEPTH PLANES (real 3D scene, not flat)
    // a PAGE of letters as a DEPTH-STAGED LAYER STACK (like the cube/depth scene): each 3×3 cell is assigned
    // to a depth plane (row → depth: top row = far, bottom = near), so the hologram carries real 3D and
    // refocusing (τ) racks through the planes. Returns { layers: Float64(2N)[], cells:[{x,y,ch,isRef,scale,depth}] }.
    const _buildLetterPage = (bar) => {
      // Layout from a fixed 3×3 PITCH so shapes NEVER overlap: each slot is GRID/3 wide; box=_LETTER_CELL is
      // already sized so the largest scale (×1.35) fills ≤82% of a slot → biggest shape stays inside its slot.
      const pitch = GRID / 3, box = _LETTER_CELL;
      const layers = Array.from({ length: _LETTER_DEPTHS }, () => new Float64Array(2*N_CELLS));
      const cells = []; let idx=0;
      for (let r=0;r<3;r++) for (let col=0;col<3;col++){
        const isRef = (((idx*2 + bar) % 3) === 0);    // ~1/3 are the target 'A', rotating per bar
        const ch = isRef ? _LETTER_TARGET : _LETTER_DISTRACT[(idx + bar) % _LETTER_DISTRACT.length];
        const sc = _LETTER_SCALES[((((idx/3)|0) + bar*2) % _LETTER_SCALES.length)];
        const cell = Math.max(4, Math.round(box * sc));
        const cx = Math.round((col + 0.5) * pitch), cy = Math.round((r + 0.5) * pitch);   // slot CENTER
        // ALL the A's on ONE plane (depth 0) so a single focal τ brings every A sharp at once; distractors
        // on the OTHER planes → out of focus at the A-plane. 3D scene, but the target shares one depth.
        const depth = isRef ? 0 : (1 + (idx % (_LETTER_DEPTHS - 1)));
        const f = layers[depth];                       // stamp this letter into ITS depth layer
        const phOff = depth * 1.7;                     // per-depth phase offset (independent planes, like _buildDepthLayers)
        const g = _rasterShape(ch, cell), o = cell>>1;
        for (let y=0;y<cell;y++) for (let x=0;x<cell;x++){ const v=g[(cell-1-y)*cell+x]; if(!v) continue;   // flip Y → right-side-up
          const X=cx+x-o, Y=cy+y-o; if(X>=0&&X<GRID&&Y>=0&&Y<GRID){ const k=(Y*GRID+X)*2;
            f[k] += v*Math.cos(phOff); f[k+1] += v*Math.sin(phOff); } }
        cells.push({ x: cx, y: cy, ch, isRef, scale: sc, depth }); idx++;
      }
      return { layers, cells };
    };


    // SPARSE DEPTH-MAP object — distinct shapes at WELL-SEPARATED depths with EMPTY depth
    // between them. Dense-in-depth scenes (every depth occupied) give weak focal contrast:
    // refocusing only subtly shifts which content is crispest because everything competes.
    // Sparse + separated → when you focus depth A, A's shape is sharp and there's little
    // else at that depth → τ visibly RACKS FOCUS between the shapes (like a camera pulling
    // focus between objects at different distances). Depth = propagation distance: each
    // shape's depth bin sets its injection step (the empty bins between create real depth
    // gaps). N_BINS bins total; shapes placed at a few separated bins.
    const DEPTH_LEVELS = 16;
    const _buildDepthMapLayers = () => {
      const cx = (GRID - 1) / 2, cy = (GRID - 1) / 2, Rmax = GRID * 0.42;
      // 3 distinct shapes at separated depth bins (near, mid, far) — empty bins between.
      const placements = [
        { bin: 1,  shape: 'ring' },   // near:  a ring
        { bin: 7,  shape: 'cross' },  // mid:   a cross
        { bin: 13, shape: 'frame' },  // far:   a square frame
      ];
      const inShape = (shape, x, y) => {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
        if (shape === 'ring')  return r > Rmax*0.62 && r < Rmax*0.82;
        if (shape === 'cross') return Math.abs(dx) < Rmax*0.12 || Math.abs(dy) < Rmax*0.12;
        if (shape === 'frame') { const a = Math.max(Math.abs(dx), Math.abs(dy)); return a > Rmax*0.8 && a < Rmax; }
        return false;
      };
      const bins = Array.from({ length: DEPTH_LEVELS }, () => new Float64Array(2 * N_CELLS));
      for (const { bin, shape } of placements) {
        const f = bins[bin];
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            if (!inShape(shape, x, y)) continue;
            const j = y * GRID + x;
            const ph = 0.05 * (x - y);
            f[j*2]   = Math.cos(ph);
            f[j*2+1] = Math.sin(ph);
          }
        }
      }
      return bins;   // keep empties — they create real depth spacing between the shapes
    };

    // ── AUTHORED MELODY → events (the hologram CARRIES OUR content, not the IFS's own beats).
    // A melody is a (pitch, time) sequence — which maps exactly onto the event substrate:
    // pitch → TIER (the note's level) and time → BIN (when it plays). So we encode OUR tune as
    // events, holograph it (unifiedField), occlude, recover, and play the recovered notes. The
    // pitch a recovered tier maps back to is fixed (a scale), so we can read the melody back.
    // A short recognizable phrase on a pentatonic scale (8 notes, one per time step).
    const _melodyScale = [262, 294, 330, 392, 440, 523]; // C D E G A C' (pentatonic, 6 levels)
    // an ARCH (rise then fall) using DISTINCT degrees so each note gets its own clean grid row →
    // f1=1.00 at r=0 (verified), then graceful falloff under occlusion.
    const _melodyNotes = [0, 2, 4, 5, 4, 2, 1, 0];        // C E A C' A E D C — the tune
    // build events: tier = note index, bin = time step, delay encodes the pitch finely too so
    // the recovered timbre matches. wt = the time step (timeKey:'wt').
    const _buildMelodyEvents = () => _melodyNotes.map((deg, step) => ({
      t: deg,                                   // tier = scale degree (the pitch level)
      d: deg,
      wt: step,                                 // time = step index
      delay: 0.10 + (deg / (_melodyScale.length - 1)) * 0.30, // map pitch → ring delay (0.10..0.40)
    }));

    // ── HOLOGRAPHIC SAMPLER voice: a short waveform = the INSTRUMENT the sequence triggers.
    // A plucked tone (decaying harmonic) — the "what it sounds like". Holographed in its own
    // grid region alongside the event sequence (which is "when it fires"); both recovered from
    // one field (cross-talk measured clean with region separation, §7.12).
    // Voice length DERIVES from GRID so it always fits its 2D region (bottom-right quadrant ≈
    // 0.4G rows × 0.5G cols ≈ 0.2·G² cells) → grid-robust: edit GRID, reload, voice auto-sizes.
    // Cap at 512 (plenty of audio detail) and floor at 64. At GRID=64: min(512, ~656)=512.
    const _SEQ_VOICE_N = Math.max(64, Math.min(512, Math.floor(GRID * GRID * 0.18)));
    const _buildSeqVoice = () => {
      const v = new Float64Array(_SEQ_VOICE_N);
      for (let i = 0; i < _SEQ_VOICE_N; i++) {
        const t = i / _SEQ_VOICE_N;
        // a pluck: fundamental + 2 harmonics, exponential decay
        v[i] = (Math.sin(2*Math.PI*8*t) + 0.5*Math.sin(2*Math.PI*16*t) + 0.25*Math.sin(2*Math.PI*24*t)) * Math.exp(-4*t);
      }
      return v;
    };
    // SEQ sequence = which tier fires when (the steps that trigger the voice). A small groove.
    // (A single-hit metronome `[{t:0,wt:0}]` is the clean test pattern if diagnosing timing.)
    const _seqEvents = () => [
      { t: 0, wt: 0 }, { t: 2, wt: 1 }, { t: 1, wt: 2 }, { t: 3, wt: 3 },
      { t: 0, wt: 0 }, { t: 2, wt: 2 }, { t: 3, wt: 1 },
    ];

    // ── SOLITON ROLL MELODY (§7.16): bar `bi` → a set of (pitch=tier, onset=bin) note atoms.
    // Deterministic per bar index (peer-identical, no exchange). A simple repeating melodic phrase
    // that walks the scale so you HEAR pitch flowing through the soliton — sparse/structured, so it
    // advects coherently (the whole point of voice-as-events vs the dense waveform).
    // Contour over the tier ladder (0.._EYE_ROLL_TIERS-1) — values are PITCH INDICES directly (not
    // scale degrees needing a %), so they actually span all pitches. One note PER onset (a full
    // arpeggio you can hear walk up/down), shifted by bar index so the line moves bar-to-bar.
    // UP-AND-DOWN loop over all 8 pitches: a TRIANGLE wave that loops SEAMLESSLY. Length is 16 =
    // exactly 4 bars (multiple of _eyeRollBins=4) so bars align to the phrase — no half-bar wrap, no
    // silence at the seam (the old 14-step phrase wasn't ÷4 → wrapped mid-bar → uneven/gappy loop).
    // Every adjacent step (incl. the wrap 15→0: …0,1|0,1…) differs by exactly 1 → smooth, no leaps.
    const _ROLL_PHRASE = [0,1,2,3,4,5,6,7,7,6,5,4,3,2,1,0];   // up 0→7 over 2 bars, down 7→0 over 2 bars, seamless repeat
    const _rollMelody = (bi) => {
      const notes = [];
      for (let onset = 0; onset < _eyeRollBins; onset++) {
        const step = bi * _eyeRollBins + onset;            // continuous position along the sweep
        const tier = _ROLL_PHRASE[step % _ROLL_PHRASE.length] % _EYE_ROLL_TIERS;
        notes.push({ tier, bin: onset });   // one note per onset → distinct pitch, sweeping up/down
      }
      return notes;
    };
    // WAVEFORM soliton harmonics (§7.31): the timbre as a few harmonic amplitudes, deterministic per
    // bar (peer-identical). Slowly morphs bar-to-bar so the recovered timbre audibly evolves. Sparse
    // (5 harmonics) → carrier-clean. These ARE the sound's spectrum, recovered + synthesized live.
    const _EYE_WAVE_H = 5;
    const _waveHarmonics = (bi) => {
      const a = new Float64Array(_EYE_WAVE_H);
      for (let h = 0; h < _EYE_WAVE_H; h++)
        a[h] = (1 / (h + 1)) * (0.6 + 0.4 * Math.sin(bi * 0.3 + h));   // 1/h falloff, morphing per bar
      return a;
    };
    // Play a recovered SCHEDULE by triggering the recovered VOICE waveform at each step.
    // Each trigger plays the voice through a WebAudio buffer, pitched by tier, at its time.
    // Schedule one bar's notes at an EXPLICIT bar-start time on the audio timeline. Each step's
    // offset is bin/nBins of the bar — a fixed grid. The caller fires this once per PHASE-ABSOLUTE
    // bar boundary (barIndex = floor(cycleCount/barCycles)), so all peers schedule the same bar.
    const _playSamplerAt = (voiceOut, schedule, nBins, barSecs, barStartTime) => {
      try {
        if (!_eyeAudioCtx) return;
        const ctx = _eyeAudioCtx, sr = ctx.sampleRate;
        const vSecs = 0.22, vlen = Math.floor(sr * vSecs);
        const buf = ctx.createBuffer(1, vlen, sr), ch = buf.getChannelData(0);
        for (let i = 0; i < vlen; i++) ch[i] = voiceOut[Math.min(voiceOut.length - 1, Math.floor(i / vlen * voiceOut.length))] * 0.5;
        const slot = barSecs / Math.max(1, nBins);
        for (const ev of schedule) {
          const src = ctx.createBufferSource(); src.buffer = buf;
          src.playbackRate.value = Math.pow(2, (ev.tier - 1) / 3);   // tier → pitch
          src.connect(ctx.destination);
          src.start(barStartTime + ev.bin * slot);                   // grid position, not "now"
        }
      } catch (e) { /* audio unavailable */ }
    };

    // ── VOICE-AS-EVENTS (§7.16): sound IS the event grid, a holographic PIANO ROLL. tier = pitch
    // (a scale degree), bin = onset (time in bar). A recovered atom = a NOTE. Synthesized at the
    // device edge by an oscillator per note → the sound is sparse/structured, so it advects as a
    // soliton (unlike the dense raw waveform it replaces). One substrate, played as pitched tones.
    // 8 tiers → a full C-major scale across an octave (C D E F G A B C), tier→pitch. The melody
    // sweeps up and down this ladder (§7.16). More pitches needs the wider roll geom (imgRowsFrac).
    const _ROLL_SCALE = [0, 2, 4, 5, 7, 9, 11, 12];    // semitones per tier (major scale)
    const _ROLL_NAMES = ['C4','D4','E4','F4','G4','A4','B4','C5'];
    const _ROLL_ROOT  = 261.63;                        // C4 root
    // Play the notes recovered AT THE CURRENT READ PLANE, all at the given instant (no bin-offset
    // scheduling). In arpeggio-soliton mode each onset sits at a different depth, so the clock's
    // advection — not an audio timer — is what spaces the notes: each readout instant surfaces only
    // the note(s) currently in focus. So the arpeggio tempo = the IFS clock, identical on all peers
    // (no client-side trick). barSecs/nTiers kept only for the note's sustain length.
    // recovered = [{tier,bin,gain}] (event soliton). harmonics = optional Float array (wave soliton's
    // RECOVERED harmonic amplitudes) → builds a PeriodicWave so the TIMBRE is SYNTHESIZED from the wave
    // soliton's recovered spectrum (§7.31). So all three modalities meet here: events=which/when (pitch
    // from tier), wave=timbre (harmonics), and occlusion dims both (note.gain + harmonic dropout).
    const _playRoll = (recovered, nTiers, barSecs, atTime, harmonics) => {
      try {
        if (!_eyeAudioCtx || !recovered || !recovered.length) return recovered;
        const ctx = _eyeAudioCtx;
        const noteDur = Math.min(0.45, Math.max(0.12, barSecs * 0.5));
        // build a periodic wave from recovered harmonics (DC=0); fall back to triangle if none/empty.
        let pw = null;
        if (harmonics && harmonics.length) {
          const H = harmonics.length, real = new Float32Array(H + 1), imag = new Float32Array(H + 1);
          let any = false; for (let h = 0; h < H; h++) { imag[h + 1] = harmonics[h]; if (harmonics[h]) any = true; }
          if (any) { try { pw = ctx.createPeriodicWave(real, imag, { disableNormalization: false }); } catch (e) { pw = null; } }
        }
        for (const a of recovered) {
          const deg = _ROLL_SCALE[Math.min(_ROLL_SCALE.length - 1, a.tier % _ROLL_SCALE.length)];
          const hz  = _ROLL_ROOT * Math.pow(2, deg / 12);
          const g   = a.gain != null ? a.gain : 1;
          const osc = ctx.createOscillator(), gn = ctx.createGain();
          if (pw) osc.setPeriodicWave(pw); else osc.type = 'triangle';   // timbre = recovered spectrum
          osc.frequency.value = hz;
          gn.gain.setValueAtTime(0, atTime);
          gn.gain.linearRampToValueAtTime(0.22 * g, atTime + 0.01);
          gn.gain.exponentialRampToValueAtTime(0.0008, atTime + noteDur);
          osc.connect(gn); gn.connect(ctx.destination);
          osc.start(atTime); osc.stop(atTime + noteDur + 0.02);
        }
        return recovered;
      } catch (e) { /* audio unavailable */ }
    };

    // ── MULTIMEDIA: build the IFS sound hologram. ─────────────────────────────────
    // A structured waveform = a few tone bursts at SEPARATED positions (the audio analog
    // of shapes at separated depths — sparse, so τ-scrub racks through them audibly). Same
    // tSteps/dt/depthBand as the image eye → ONE fractal clock drives both.
    const SOUND_N = 2048;
    const _buildSoundHologram = () => {
      const s = new Float64Array(SOUND_N);
      // 3 tone bursts (low/mid/high pitch) at separated time positions = "depths"
      const bursts = [
        { at: 0.15, freq: 0.04, dur: 0.18 },   // near: low tone
        { at: 0.45, freq: 0.09, dur: 0.18 },   // mid:  mid tone
        { at: 0.75, freq: 0.16, dur: 0.18 },   // far:  high tone
      ];
      for (const b of bursts) {
        const c = b.at * SOUND_N, w = b.dur * SOUND_N;
        for (let i = 0; i < SOUND_N; i++) {
          const env = Math.exp(-((i - c) * (i - c)) / (2 * (w/3) * (w/3)));
          s[i] += env * Math.sin(b.freq * i * 2 * Math.PI);
        }
      }
      const snd = new IFSSound({ tSteps: EYE_T_STEPS, dt: DT, depthBand: 0.35 });
      snd.setWaveform(s);
      console.log('[IFS SOUND] round-trip fidelity =', snd.testRoundTrip().toFixed(4));
      return snd;
    };
    // Draw a waveform as a thin overlay strip across the bottom of a panel.
    const _drawWaveform = (ctx, wave, W, H) => {
      const h = Math.round(H * 0.18), y0 = H - h;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, y0, W, h);
      ctx.strokeStyle = '#f9f'; ctx.lineWidth = 1; ctx.beginPath();
      let mx = 1e-9; for (let i = 0; i < wave.length; i++) mx = Math.max(mx, Math.abs(wave[i]));
      for (let px = 0; px < W; px++) {
        const i = Math.floor(px / W * wave.length);
        const v = wave[i] / mx;            // −1..1
        const y = y0 + h * 0.5 - v * h * 0.45;
        px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
      }
      ctx.stroke(); ctx.restore();
    };
    // Sonify a reconstructed waveform (short blip) via WebAudio.
    let _lastPlayMs = 0;
    const _playWaveform = (wave) => {
      const now = performance.now();
      if (now - _lastPlayMs < 180) return;   // throttle while dragging
      _lastPlayMs = now;
      try {
        if (!_eyeAudioCtx) _eyeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _eyeAudioCtx, sr = ctx.sampleRate, secs = 0.25;
        const len = Math.floor(sr * secs);
        const buf = ctx.createBuffer(1, len, sr);
        const ch = buf.getChannelData(0);
        let mx = 1e-9; for (let i = 0; i < wave.length; i++) mx = Math.max(mx, Math.abs(wave[i]));
        for (let i = 0; i < len; i++) ch[i] = (wave[Math.floor(i / len * wave.length)] / mx) * 0.25;
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
      } catch (e) { /* audio not available */ }
    };

    // Play a normalized waveform over a given duration (the unified field's fine waveform,
    // synthesized from the recovered events). Resamples the buffer to the bar length and adds a
    // tiny fade in/out so the start/end don't click.
    const _playAudioBuffer = (wave, secs = 1.6, startT = 0) => {
      try {
        if (!_eyeAudioCtx) _eyeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _eyeAudioCtx; if (ctx.state === 'suspended') ctx.resume();
        const sr = ctx.sampleRate, len = Math.floor(sr * secs);
        const buf = ctx.createBuffer(1, len, sr), ch = buf.getChannelData(0);
        const fade = Math.floor(sr * 0.01);
        for (let i = 0; i < len; i++) {
          let s = wave[Math.floor(i / len * wave.length)] * 0.5;
          if (i < fade) s *= i / fade;
          if (i > len - fade) s *= (len - i) / fade;
          ch[i] = s;
        }
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(startT > 0 ? startT : undefined);
      } catch (e) { /* audio not available */ }
    };

    // ── CLOCK-ANCHORED BAR TIMING (shared by SEQ + BEAT/MEL). ─────────────────────────
    // The CLOCK CROSSING is the only timing authority — we do NOT run a predictive cursor that
    // advances by a guessed barSecs (the IFS cycle cadence VARIES, e.g. 1.0→0.82s, so any
    // prediction is stale → persistent drift, the bug seen in the err log). Instead each bar
    // starts a hair after the crossing is detected, and its notes are spread over the MEASURED
    // duration of the bar that just elapsed (the last real interval). So bar-to-bar timing tracks
    // the clock exactly (sync = the architectural requirement), and notes are evenly spaced
    // WITHIN each bar. The unavoidable residual is ±1 detection frame at the boundary — which is
    // the honest floor when the clock cadence itself jitters; we absorb it by starting a small
    // lead ahead. Returns the bar start time; the caller passes the measured span as barSecs.
    const _barAnchor = (audioNow) => audioNow + 0.05;

    // ── RHYTHM sonifier — the clock's own EVENT STREAM. ───────────────────────────────
    // The most native sound of the medium: each fresnelBeat event is a discrete, timed,
    // depth-tagged firing — { d: IFS-depth, delay: Fresnel ring delay, wt: wall-time, t:
    // source tier }. We play ONE percussion hit per NEW event (tracked by wt), so the audio
    // IS the clock's event sequence — not a frame-sampled envelope. The ring `delay` (the
    // light-cone geometry) sets the pitch, the depth `d` sets the voice/decay → a fractal
    // polyrhythm imposed by nothing but the clock itself.
    let _lastBeatWt = 0;                            // wall-time of the last sonified event
    const _PENTA = [220, 247, 294, 330, 392, 440, 494, 587, 659]; // pentatonic-ish → pleasant
    const _triggerEvent = (ev) => {
      try {
        if (!_eyeAudioCtx) _eyeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _eyeAudioCtx; if (ctx.state === 'suspended') ctx.resume();
        const t0 = ctx.currentTime;
        const d  = ev.d ?? 0, delay = ev.delay ?? 1;
        // pitch from the ring delay (smaller delay = inner ring = higher), quantised to the
        // pentatonic scale so the polyrhythm is musical rather than atonal.
        const idx = Math.max(0, Math.min(_PENTA.length - 1,
          Math.round((1 / Math.max(1, delay)) * (_PENTA.length - 1) * 4)));
        const f   = _PENTA[idx] * (1 + d * 0.5);   // deeper IFS-depth → an octave-ish lift
        const dur = Math.max(0.05, 0.20 - d * 0.02); // deeper = tighter (light cone fires faster)
        const osc = ctx.createOscillator();
        osc.type = d % 2 ? 'triangle' : 'sine';     // alternate timbre per depth for clarity
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.22, t0 + 0.004);          // percussive attack
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
      } catch (e) { /* audio unavailable */ }
    };
    // Play every event newer than the last one we sonified (capped per frame to avoid spam).
    const _playEventRhythm = (events) => {
      if (!events || !events.length) return;
      const fresh = events.filter(e => (e.wt ?? 0) > _lastBeatWt).sort((a, b) => a.wt - b.wt);
      if (!fresh.length) return;
      _lastBeatWt = fresh[fresh.length - 1].wt;
      for (const ev of fresh.slice(-6)) _triggerEvent(ev);   // last few new beats this frame
    };

    // ── EVENT VOICE — the sound is DERIVED FROM THE BEAT'S OWN PHYSICS, not a drum-kit label.
    // Each event carries its Fresnel ring `delay` (the IFS clock's actual structural property:
    // small delay = inner/fast ring, large delay = outer/slow ring). We map that physical value
    // to the timbre directly: delay → PITCH (inner ring = higher) and delay → BRIGHTNESS/DECAY
    // (inner = brighter & tighter, outer = darker & longer). So the timbre IS the beat, not an
    // assignment I picked. tier only nudges the wave shape so co-firing voices stay distinguishable.
    // Expected delay range ≈ [0.10, 0.40] (from _launchSlot); normalize within the motif.
    let _voiceDmin = Infinity, _voiceDmax = 0;
    const _voiceNorm = (delay) => {
      // adapt the range to the motif actually present (so it spans the audible band)
      if (delay < _voiceDmin) _voiceDmin = delay;
      if (delay > _voiceDmax) _voiceDmax = delay;
      const sp = (_voiceDmax - _voiceDmin) || 1;
      return (delay - _voiceDmin) / sp;   // 0 = innermost (highest), 1 = outermost (lowest)
    };
    const _eventVoice = (ev, t0, ctx) => {
      const u = _voiceNorm(ev.delay ?? 0.2);     // 0..1 along the ring radius
      // pitch: inner ring (u→0) high, outer (u→1) low. Pentatonic-ish span ~3 octaves.
      const pitch = 880 * Math.pow(0.5, u * 3);  // 880 Hz → 110 Hz
      const dur   = 0.06 + u * 0.20;             // inner = tight (0.06s), outer = long (0.26s)
      const bright = 1 - u;                       // inner = bright (more harmonics)
      // a tone + a touch of ring-radius-shaped noise so each ring has its own grain
      const o = ctx.createOscillator();
      o.type = bright > 0.5 ? 'sawtooth' : 'triangle';   // inner rings buzz, outer rings soften
      o.frequency.setValueAtTime(pitch, t0);
      o.frequency.exponentialRampToValueAtTime(pitch * (0.6 + 0.4*u), t0 + dur); // slight drop
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 600 + bright * 6000;   // brightness from the ring
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(lp); lp.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    };
    // Play a recovered MELODY: each (tier, bin) → a note (tier = scale degree → pitch, bin =
    // time slot). This is the CARRIED content read back — you hear OUR tune, holes where
    // occlusion dropped notes. A clean tone per note so the melody is recognizable.
    const _playMelody = (recovered, nBins, barSecs = 2.0, startT = 0) => {
      try {
        if (!_eyeAudioCtx) _eyeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _eyeAudioCtx; if (ctx.state === 'suspended') ctx.resume();
        const t0 = startT > 0 ? startT : ctx.currentTime + 0.05, slot = barSecs / Math.max(1, nBins);
        for (const ev of recovered) {
          const freq = _melodyScale[Math.min(_melodyScale.length - 1, ev.tier)];
          const t = t0 + ev.bin * slot;
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'triangle'; o.frequency.value = freq;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.25, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + slot * 0.9);
          o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + slot);
        }
      } catch (e) { /* audio unavailable */ }
    };
    // Sequence a recovered grid as one bar. recovered = [{tier, bin, delay}], nBins = bar slots.
    // The RHYTHM is the holographically-reconstructed motif (which cells fired); the TIMBRE of
    // each hit is derived from that beat's own ring delay — sound AND rhythm are the clock's.
    const _playDrumGrid = (recovered, nBins, barSecs = 1.6) => {
      try {
        if (!_eyeAudioCtx) _eyeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _eyeAudioCtx; if (ctx.state === 'suspended') ctx.resume();
        // pre-scan the bar's delays so the pitch mapping spans the whole motif's ring range
        _voiceDmin = Infinity; _voiceDmax = 0;
        for (const ev of recovered) { const d = ev.delay ?? 0.2; if (d < _voiceDmin) _voiceDmin = d; if (d > _voiceDmax) _voiceDmax = d; }
        const t0 = ctx.currentTime + 0.05, slot = barSecs / Math.max(1, nBins);
        for (const ev of recovered) _eventVoice(ev, t0 + ev.bin * slot, ctx);
      } catch (e) { /* audio unavailable */ }
    };

    const _buildSrcFieldIFS = (angleY, angleX, extraPoints, shape = 'cube') => {
      // depthmap is a LAYERED (multi-step) object → handled in the explorer via depthScrub,
      // not as a flat source. As a flat fallback (e.g. main canvases), use its summed field.
      if (shape === 'depthmap') {
        const f = new Float64Array(2 * N_CELLS);
        for (const lyr of _buildDepthMapLayers()) for (let k = 0; k < f.length; k++) f[k] += lyr[k];
        return f;
      }
      if (shape === 'texture' || shape === 'filled') return _buildDenseField(shape);
      const sources = _projectSources(angleY, angleX, shape);
      const field = new Float64Array(2 * N_CELLS);
      let szMin = Infinity, szMax = -Infinity;
      for (const { sz } of sources) { if (sz < szMin) szMin = sz; if (sz > szMax) szMax = sz; }
      const szRange = Math.max(1e-4, szMax - szMin);
      for (const { sx, sy, sz, amp } of sources) {
        const ix = Math.round(sx) | 0, iy = Math.round(sy) | 0;
        if (ix < 0 || ix >= GRID || iy < 0 || iy >= GRID) continue;
        const j  = iy * GRID + ix;
        const t  = Math.max(0, Math.min(1, (sz - szMin) / szRange));
        const ph = t * Math.PI * 4;
        field[j*2]   += amp * Math.cos(ph);
        field[j*2+1] += amp * Math.sin(ph);
      }
      for (const pt of (extraPoints ?? [])) {
        const j = pt.gy * GRID + pt.gx;
        field[j*2]   += pt.amp * Math.cos(pt.ph);
        field[j*2+1] += pt.amp * Math.sin(pt.ph);
      }
      return field;
    };

    // ── GPU init ───────────────────────────────────────────────────────────
    let _gpuCanvas = null;
    if (IFSGpu.isSupported()) {
      _gpuCanvas = document.createElement('canvas');
      _gpuCanvas.width = GRID; _gpuCanvas.height = GRID;
      IFSGpu.create(_gpuCanvas, GRID).then(g => {
        _gpu = g;
        _gpuReady = true;
        _eye = new IFSEye(_gpu, { tSteps: EYE_T_STEPS, relaxSteps: EYE_RELAX_STEPS, dt: DT, srcAlpha: SRC_ALPHA });
        // dev handle for console verification (e.g. clock-modulated MM on the real GPU)
        if (typeof window !== 'undefined') { window._eye = _eye; window._eyeGpu = _gpu; }
        console.log('[EYE] IFSGpu + IFSEye ready');
      }).catch(err => {
        console.error('[EYE] IFSGpu init FAILED:', err);
      });
    }

    // Attach drag + right-click to canvases
    [fieldCell, phaseCell, plateCell, eyeFieldCell, eyePerceptCell, eyeEvidCell]
      .forEach(c => {
        _attachDrag(c.canvas);
        c.canvas.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const r  = c.canvas.getBoundingClientRect();
          const gx = Math.floor(((e.clientX - r.left) / r.width)  * GRID);
          const gy = Math.floor(((e.clientY - r.top)  / r.height) * GRID);
          if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID)
            injectEvent?.({ type: e.shiftKey ? 'addBeam' : 'addPoint', gx, gy });
        });
        c.canvas.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));
      });

    // _renderFrame is called by makeView's Renkon reactive loop on every world tick.
    const _renderFrame = () => {
      const n = world.getNodeState('hologram4');
      if (!n?.cachedRadii?.length) return;

      // ── Capture the LIVE FRACTAL HEARTBEAT — the per-cycle IFS-depth energy envelope the
      // clock produces from fresnelBeat events. This is the real KWE clock signal; CLOCK mode
      // uses it directly as the sound (the dt-modulation schedule), so the audio IS the beat. ──
      {
        const eA = n.slotEnergy_A ?? [], eB = n.slotEnergy_B ?? [];
        const L = Math.max(eA.length, eB.length, 1);
        if (_eyeHeartbeat.length !== L) _eyeHeartbeat = new Float64Array(L);
        // light temporal smoothing so the envelope breathes rather than jitters frame-to-frame
        let beatSum = 0;
        for (let i = 0; i < L; i++) {
          const v = Math.max(eA[i] ?? 0, eB[i] ?? 0);
          _eyeHeartbeat[i] = _eyeHeartbeat[i] * 0.7 + v * 0.3;
          // depth-weighted so deeper tiers (finer light-cone structure) shape the timbre
          beatSum += _eyeHeartbeat[i] * (1 + i * 0.25);
        }
        // push this tick's total beat into the heartbeat history ring (the audible envelope)
        _eyeBeatHist[_eyeBeatHead] = beatSum;
        _eyeBeatHead = (_eyeBeatHead + 1) % _eyeBeatHistLen;
        if (_eyeShowClock) _eyeClockDirty = true;   // heartbeat moved → re-run clock round-trip
        // HUMAN-ORIENTED RHYTHM: when CLOCK + ♪ SOUND are on, sonify the clock's own EVENT
        // STREAM — one percussion hit per new fresnelBeat (sample-accurate to the clock).
        if (_eyeShowClock && _eyeSoundPlay) {
          _playEventRhythm([...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])]);
        }
        // EVENT-TIMING HOLOGRAPHY capture: in BEAT mode, accumulate the live fresnelBeat
        // events — this growing set IS the pattern we encode→reconstruct→play (the clock's
        // own beat, round-tripped through the hologram).
        if (_eyeShowBeat) {
          // The clock's rhythm IS a tight, deterministic MOTIF: _launchSlot re-seeds the same
          // ~N_DEPTH_TIERS beats each cycle (and wipes slotEvents on launch, line 520 of
          // hologram_world.js). So we capture the DISTINCT beats of the current motif — keyed by
          // {tier:delay} (the structural identity, ignoring wt which just marks the repeat) — and
          // score THAT honestly. A 4-beat motif round-trips at whatever f1 it round-trips at.
          if (!_eyeBeatSeen) _eyeBeatSeen = new Set();
          const evs = [...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])];
          let added = 0;
          for (const e of evs) {
            const key = `${e.t ?? e.d}:${(e.delay ?? 0).toFixed(4)}`;   // structural beat identity
            if (!_eyeBeatSeen.has(key)) { _eyeBeatSeen.add(key); _eyeBeatCapture.push(e); added++; }
          }
          if (added) { _eyeBeatCapture = _eyeBeatCapture.slice(-32); _eyeBeatDirty = true; }
        }
      }

      const angleY     = n.angleY ?? INIT_ANGLE_Y;
      const angleX     = n.angleX ?? INIT_ANGLE_X;
      const dir        = n.direction ?? 1;
      const kernelVer  = n.cachedRadiiVersion ?? 0;
      const extraKey   = JSON.stringify(n.extraPoints ?? []);
      _liveMode        = n.liveMode ?? false;

      // Sync eye params from world state → _eye + UI
      if (_eye) {
        const eyeHMode  = n.eyeHMode  ?? 0;
        const eyeHParam = n.eyeHParam ?? 0.5;
        const eyeHBlock = n.eyeHBlock ?? 8;
        const eyeTSteps = n.eyeTSteps ?? EYE_T_STEPS;
        const eyeMix    = n.eyeMix    ?? 0;
        const eyeOnly   = n.eyeOnly   ?? false;
        // Mark the active display mode dirty too, so H changes re-render the static
        // views (EXPLORE/SLICES/3D-HOLO), not just the live compute() path.
        const _markDisplays = () => { _eyeExploreDirty = true; _eyeSlicesDirty = true; _eyeDepthDirty = true; _eyeMMDirty = true; _eyeClockDirty = true; _eyeBeatDirty = true; _eyeSeqDirty = true; _eyeUnitedDirty = true; };
        if (_eye.hMode  !== eyeHMode)  { _eye.hMode  = eyeHMode;  _eye.dirty = true; _markDisplays(); }
        if (_eye.hParam !== eyeHParam) { _eye.hParam = eyeHParam; if (eyeHMode !== 0) _eye.dirty = true; _markDisplays(); }
        if (_eye.hBlock !== eyeHBlock) { _eye.hBlock = eyeHBlock; if (eyeHMode >= 7) _eye.dirty = true; _markDisplays(); }
        if (_eye.tSteps !== eyeTSteps) { _eye.tSteps = eyeTSteps; _eye.dirty = true; _markDisplays(); }
        _eye.refMix = eyeMix;
        _eyeOnlyMode = eyeOnly;
        // Sync UI labels (don't update active sliders)
        if (!hParamSlider.matches(':active')) { hParamSlider.value = String(eyeHParam); hParamLbl.textContent = `r=${eyeHParam.toFixed(2)}`; }
        if (!hBlockSlider.matches(':active'))  { hBlockSlider.value  = String(eyeHBlock);  hBlockLbl.textContent  = `blk=${eyeHBlock}`; }
        if (!tSlider.matches(':active'))       { tSlider.value        = String(eyeTSteps);  tLbl.textContent        = `T=${eyeTSteps}`; }
        if (!mixSlider.matches(':active'))     { mixSlider.value      = String(eyeMix);     mixLbl.textContent      = `MIX ${eyeMix.toFixed(2)}`; }
        _hBtns.forEach((b, i) => { const active = _hModes[i].mode === eyeHMode; b.style.background = active ? '#363' : '#333'; b.style.color = active ? '#af8' : '#888'; });
        btnEyeOnly.textContent      = eyeOnly ? '◎ EYE ONLY on' : '◎ EYE ONLY';
        btnEyeOnly.style.background = eyeOnly ? '#246' : '#333';
        btnEyeOnly.style.color      = eyeOnly ? '#af8' : '#888';

        // ── DISPLAY MODE + SOUND from WORLD STATE (Krestianstvo compliance, doc §7.13). ──
        // The local _eyeShow* flags are a DERIVED CACHE of n.eyeDisplayMode — buttons inject the
        // mode, the reflector broadcasts it, every peer derives the same view here. On a mode
        // CHANGE we run the same setup the old click handlers did (dirty flags / fresh capture).
        const mode = n.eyeDisplayMode ?? '';
        const soundOn = n.eyeSoundOn ?? false;
        if (mode !== _eyeModeSeen) {
          _eyeModeSeen = mode;
          // derive the mutually-exclusive display flags
          _eyeShowDepth   = (mode === 'mdepth');
          _eyeShowSlices  = (mode === 'slices');
          _eyeShowExplore = (mode === 'explore');
          _eyeShowMM      = (mode === 'mm');
          _eyeShowClock   = (mode === 'clock');
          _eyeShowBeat    = (mode === 'beat' || mode === 'melody');
          _eyeMelodyMode  = (mode === 'melody');
          _eyeShowSeq     = (mode === 'seq');
          _eyeShowUnited  = (mode === 'united');
          _eyeShowSoliton = (mode === 'soliton');
          _eyeShowClockMel = (mode === 'clockmel');
          _eyeShowCycle   = (mode === 'limitcycle');
          _eyeShowLoaded  = false;
          eyeImgCell.wrap.style.display = (_eyeShowUnited || _eyeShowSoliton || _eyeShowCycle) ? '' : 'none'; // 4th canvas in UNITED + SOLITON + CYCLE
          // per-mode fresh setup (mirrors the old click handlers)
          if (mode === 'mdepth')  { if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS); _eyeDepthDirty = true; }
          if (mode === 'slices')  { if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS); _eyeSlicePair = 0; _eyeSlicesDirty = true; }
          if (mode === 'explore') { if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS); _eyeExploreDirty = true; }
          if (mode === 'mm')      { _eyeMMDirty = true; }
          if (mode === 'clock')   { _eyeClockDirty = true; }
          if (mode === 'beat' || mode === 'melody') { _eyeBeatCapture = []; _eyeBeatSeen = new Set(); _eyeBeatDirty = true; _eyeBeatLastBar = -1; _eyeBeatLastBarMs = 0; }
          if (mode === 'seq')     { _eyeSeqDirty = true; _eyeSeqLast = null; _eyeSeqLastBar = -1; _eyeSeqLastBarMs = 0; _eyeSeqCursor = 0; }
          if (mode === 'united')  { if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS); _eyeUnitedDirty = true; _eyeSeqLast = null; _eyeSeqLastBar = -1; _eyeSeqLastBarMs = 0; _eyeSeqCursor = 0; }
          if (mode === 'soliton') { if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS); _eyeSolReadKey = ''; _eyeSolLogN = 30; _eyeSeqLast = null; _eyeSeqLastBar = -1; _eyeSeqLastBarMs = 0; _eyeSeqCursor = 0; }
          if (mode === 'clockmel') { _eyeClockMelLastCyc = -1; _eyeSeqCursor = 0; }
          if (mode === 'limitcycle') { _eyeCycleOp = null; _eyeCycleMedia = null; _eyeCycleLastTick = -1; _eyeCycleAccum = null; }
        }
        if (soundOn !== _eyeSoundPlay) {
          _eyeSoundPlay = soundOn;
          if (soundOn) { try { if (!_eyeAudioCtx) _eyeAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (_eyeAudioCtx.state === 'suspended') _eyeAudioCtx.resume(); } catch(e){} }
          if (_eyeShowSeq || _eyeShowUnited) { _eyeSeqLastBar = -1; _eyeSeqLastBarMs = 0; _eyeSeqCursor = 0; }  // re-arm clock loop
          if (_eyeShowBeat) { _eyeBeatLastBar = -1; _eyeBeatLastBarMs = 0; } // re-arm BEAT/MEL loop
          if (_eyeShowMM)  _eyeMMDirty = true;
          if (_eyeShowClock) _eyeClockDirty = true;
          if (_eyeShowBeat)  _eyeBeatDirty = true;
        }
        // button highlights driven from world state (not from the click)
        const hl = (btn, on, onBg, onCol) => { btn.style.background = on ? onBg : btn._offBg; btn.style.outline = on ? `1px solid ${onCol}` : 'none'; };
        hl(btnMDepth, _eyeShowDepth, '#828', '#f9f');
        hl(btnSlices, _eyeShowSlices, '#80a', '#c9f');
        hl(btnExplore, _eyeShowExplore, '#66a', '#fcf');
        hl(btnMM, _eyeShowMM, '#828', '#fcf');
        hl(btnClock, _eyeShowClock, '#286', '#bfd');
        hl(btnBeat, _eyeShowBeat && !_eyeMelodyMode, '#268', '#bdf');
        hl(btnMel, _eyeMelodyMode, '#637', '#fbe');
        hl(btnSeq, _eyeShowSeq, '#258', '#9cf');
        hl(btnUnited, _eyeShowUnited, '#715', '#f9c');
        hl(btnSoliton, _eyeShowSoliton, '#629', '#d9f');
        hl(btnClockMel, _eyeShowClockMel, '#247', '#8df');
        hl(btnCycle, _eyeShowCycle, '#274', '#9fd');
        hl(btnCycleOp, _eyeShowCycle && _eyeCycleKind === 'operator', '#264', '#8fc');
        hl(btnCycleMedia, _eyeShowCycle && _eyeCycleKind === 'media', '#264', '#8fc');
        hl(btnCycleCarrier, _eyeShowCycle && _eyeCycleKind === 'media' && !_eyeCycleMediaUseTemporal, '#256', '#9cf');
        hl(btnCycleTemporal, _eyeShowCycle && _eyeCycleKind === 'media' && _eyeCycleMediaUseTemporal, '#256', '#9cf');
        hl(btnSound, _eyeSoundPlay, '#828', '#fbf');

        // τ from SHARED world state — all peers scrub the same depth. On change, mark the active
        // depth display dirty and sync the slider/label (unless the user is actively dragging it).
        const wTau = n.eyeTau ?? 0;
        if (Math.abs(wTau - _eyeTau) > 1e-4) {
          _eyeTau = wTau;
          if (_eyeShowExplore) _eyeExploreDirty = true;
          if (_eyeShowClock)   _eyeClockDirty   = true;
          if (_eyeShowBeat)    _eyeBeatDirty    = true;
          if (_eyeShowUnited)  _eyeUnitedDirty  = true;
          if (!tauSlider.matches(':active')) { tauSlider.value = String(wTau); tauLbl.textContent = `τ=${wTau.toFixed(2)}`; }
        }
      }

      // Sync GPU kernel
      if (_gpuReady && _gpuKernelVersion !== kernelVer && dir >= 0) {
        _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets);
        _gpuKernelVersion = kernelVer;
      }

      // Rebuild obj field when angle/shape/kernel changes
      const needObj = _localKernelVersion !== kernelVer
        || _localAngleYSeen !== angleY || _localAngleXSeen !== angleX
        || _localShapeSeen !== (n.shape ?? 'cube') || !_localObjField;
      if (needObj) {
        _localObjField = _buildSrcFieldIFS(angleY, angleX, n.extraPoints ?? [], n.shape ?? 'cube');
        _localAngleYSeen = angleY; _localAngleXSeen = angleX;
        _localShapeSeen  = n.shape ?? 'cube';
        _localKernelVersion = kernelVer;
        if (_gpuReady) _gpu.setObjField(_localObjField);
        if (_eye) _eye._refField = _localObjField; // MIX scores evidence against source
      }

      // Mark eye dirty when object changes
      const eyeObjKey = `${angleY}|${angleX}|${n.shape ?? 'cube'}|${extraKey}`;
      if (eyeObjKey !== _eyeObjKeySeen) {
        _eyeObjKeySeen = eyeObjKey;
        if (_eye) _eye.dirty = true;
        _eyeExploreDirty = true;   // shape changed → re-render the depth explorer (map vs layers)
      }

      // ── Soliton evolution ────────────────────────────────────────────────
      if (_gpuReady && _localObjField && n.cachedRadii.length && dir > 0) {
        for (let i = 0; i < 16; i++) _gpu.stepRecord(DT, SRC_ALPHA);
        if (!_psiReadPending) {
          _psiReadPending = true;
          _gpu.readPsiAsync().then(psi64 => { _psiReadPending = false; _localPsi = psi64; });
        }
      }

      // ── Normalization ────────────────────────────────────────────────────
      if (_gpuReady) {
        const peakSq = _gpu.readSwPeakSq();
        if (peakSq > _smoothMaxField) _smoothMaxField = peakSq;
        const newSmooth = _smoothMaxField * 0.97 + peakSq * 0.03;
        if (isFinite(newSmooth) && newSmooth > 1e-12) _smoothMaxField = newSmooth;
      }

      // ── Main soliton canvases ────────────────────────────────────────────
      if (_gpuReady && !(_eyeOnlyMode && _liveMode)) {
        const norm = Math.max(_smoothMaxField, 1e-9);
        _gpu.renderSweepField(norm);
        fieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
        _gpu.renderSweepPhase(norm);
        phaseCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
        // Show the object field ψ_obj as ground truth for eye comparison
        if (_localObjField) {
          _gpu.setSweepPsi(_localObjField);
          _gpu.renderSweepField(norm);
          plateCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          // Restore live soliton psi to sweep after using it as scratch
          if (_localPsi) _gpu.setSweepPsi(_localPsi);
        }
      }

      // ── Eye canvases ─────────────────────────────────────────────────────
      // Shared united-field panel painter (used by UNITED still + SOLITON live). u = readout result
      // with {viewTau, imgOnly, voiceOut, voiceScore, voiceStored, recovered, f1, trueSet, nBins, nTiers}.
      const _drawUnitedPanels = (u, tag, occ, usedT, extra, holoMode) => {
        const peak = (a) => { let m=0; for (let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v;} return Math.max(m,1e-12); };
        if (holoMode) {
          // HOLOGRAM / RECON pair (§7.24): panel 1 = the MASKED HOLOGRAM Ψ(cyc) (occlusion blocks
          // visible here — masking HITS the hologram); 4th canvas = the RECON back-propagated from that
          // masked hologram (stays stable despite the holes — the eye-cube hologram→recon relationship).
          const hol = u.holoMasked || u.field;
          _gpu.setEyePsi(hol); _gpu.renderEyeField(peak(hol));
          eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeFieldCell.setLabel(`${tag}  HOLOGRAM |ψ_holo|²${u.temporal?` [${u.panelKind||'?'} phase${u.nPhases?` ${(u.panelPhase??0)+1}/${u.nPhases}`:''}]`:''}${occ>0?` occl ${occ.toFixed(2)}`:''}${extra?`  ${extra}`:''}`);
          if (u.gatedField) {
            // GATE MODE (§7.33): panel 4 = the GATED image — the picture carved by the beat (events ×
            // image via the product [H]). Real per-cell field → wrap to complex (im=0) to render.
            const gf = u.gatedField, cx = new Float64Array(gf.length * 2);
            for (let i = 0; i < gf.length; i++) cx[i * 2] = gf[i];
            _gpu.setEyePsi(cx); _gpu.renderEyeField(peak(cx));
            eyeImgCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
            eyeImgCell.setLabel(u._opCyc
              ? `${tag}  ⊕ OP-CYCLE bound ◄ events⊗image  (rank-K operator-as-clock, GPU §7.43)`
              : `${tag}  GATED image ◄ events×image [H]  (carved by the beat)${occ>0?` occl ${occ.toFixed(2)}`:''}`);
          } else {
            _gpu.setEyePsi(u.viewTau); _gpu.renderEyeField(peak(u.viewTau));
            eyeImgCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
            eyeImgCell.setLabel(`${tag}  RECON ◄ masked hologram  τ=${_eyeTau.toFixed(2)} (stable)`);
          }
        } else {
          _gpu.setEyePsi(u.viewTau); _gpu.renderEyeField(peak(u.viewTau));
          eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeFieldCell.setLabel(`${tag}  full field |ψ(τ)|²  τ=${_eyeTau.toFixed(2)}${occ>0?` occl ${occ.toFixed(2)}`:''}${extra?` ${extra}`:''}`);
          _gpu.setEyePsi(u.imgOnly); _gpu.renderEyeField(peak(u.imgOnly));
          eyeImgCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeImgCell.setLabel(`IMAGE only  τ=${_eyeTau.toFixed(2)}`);
        }
        { const ctx = eyePerceptCell.ctx, W=RW, H=RH; ctx.fillStyle='#111'; ctx.fillRect(0,0,W,H);
          const mx=8,my=18,gw=(W-2*mx)/u.nBins,gh=(H-my-8)/u.nTiers;
          const lit=new Set(u.recovered.map(e=>e.tier+':'+e.bin));
          for(let t=0;t<u.nTiers;t++)for(let b=0;b<u.nBins;b++){const x=mx+b*gw,y=my+t*gh;ctx.strokeStyle='#333';ctx.strokeRect(x+1,y+1,gw-2,gh-2);if(lit.has(t+':'+b)){ctx.fillStyle=occ>0?'#fa4':'#4f8';ctx.fillRect(x+2,y+2,gw-4,gh-4);}}
          eyePerceptCell.setLabel(`${tag}  events f1=${u.f1.toFixed(2)} (${u.recovered.length}/${u.trueSet.length})`); }
        { const ctx = eyeEvidCell.ctx; ctx.fillStyle='#111'; ctx.fillRect(0,0,RW,RH);
          if (!u.voiceOut || u.voiceOut.length === 0) {
            // VOICE-AS-EVENTS (roll mode): no waveform — draw the recovered notes as a PIANO ROLL
            // (x=onset, y=pitch; higher pitch = higher on screen). This IS the sound (synthesized).
            const my=18, gw=(RW-16)/u.nBins, gh=(RH-my-8)/u.nTiers;
            for (const a of u.recovered) {
              const x=8+a.bin*gw, y=my+(u.nTiers-1-a.tier)*gh;   // invert so high pitch is up
              const g = a.gain != null ? a.gain : 1;             // dim notes whose energy the occlusion ate
              ctx.globalAlpha = Math.max(0.15, g); ctx.fillStyle='#fc6'; ctx.fillRect(x+2, y+2, gw-4, gh-4); ctx.globalAlpha = 1;
            }
            const tot = u.trueSet ? u.trueSet.length : u.recovered.length;
            eyeEvidCell.setLabel(`${tag}  PIANO ROLL  ${u.recovered.length}/${tot} notes${occ>0?` occl ${occ.toFixed(2)}`:''}`);
          } else {
            ctx.strokeStyle='#6cf'; ctx.lineWidth=1; ctx.beginPath();
            const w=u.voiceOut, nn=w.length;
            for(let px=0;px<RW;px++){const i=Math.min(nn-1,Math.floor(px/RW*nn)); const y=RH*0.5 - w[i]*RH*0.42; px===0?ctx.moveTo(px,y):ctx.lineTo(px,y);}
            ctx.stroke();
            const stored = u.voiceStored < 0.999 ? ` ${(u.voiceStored*100)|0}% fit` : '';
            eyeEvidCell.setLabel(`${tag}  voice fid=${u.voiceScore.toFixed(2)}  (T=${usedT}${stored})`);
          } }
      };

      if (_eyeShowUnited && _gpuReady && _eye) {
        // THE UNITED FIELD (§7.14) — image + events + sound in ONE deep-T wavefront, one clock.
        // Three region-separated readouts from one reconstruction: panel 1 = IMAGE depth-slice at τ
        // (spatial face), panel 2 = recovered EVENT grid + f1 (rhythm face), panel 3 = recovered
        // VOICE waveform (sound face). Playback: recovered events trigger the recovered voice,
        // clock-gated (reuses the SEQ scheduler + _eyeSeqLast). Runs at fixed deep T (masking).
        // ── audio first (plays previous _eyeSeqLast; stall-proof) — identical to SEQ ──
        if (_eyeSoundPlay && _eyeSeqLast && _eyeAudioCtx) {
          const cyc = n.cycleCount ?? 0, nowMs = performance.now(), audioNow = _eyeAudioCtx.currentTime;
          const barIndex = Math.floor(cyc / _EYE_SEQ_BAR_CYCLES);
          if (_eyeSeqLastBar < 0) _eyeSeqLastBar = barIndex - 1;
          if (barIndex > _eyeSeqLastBar) {
            const bars = barIndex - _eyeSeqLastBar;
            if (_eyeSeqLastBarMs > 0) { const span = Math.max(0.3, Math.min(6, (nowMs - _eyeSeqLastBarMs)/1000/bars)); _eyeSeqBarSecs = _eyeSeqBarSecs>0 ? (_eyeSeqBarSecs*0.6+span*0.4) : span; }
            _eyeSeqLastBar = barIndex; _eyeSeqLastBarMs = nowMs;
            if (_eyeSeqBarSecs > 0) {
              const TARGET = 0.12;
              if (_eyeSeqCursor <= 0) _eyeSeqCursor = audioNow + TARGET;
              const lead = _eyeSeqCursor - audioNow;
              if (lead < 0.02 || lead > _eyeSeqBarSecs + 0.25) _eyeSeqCursor = audioNow + TARGET;
              else _eyeSeqCursor -= (lead - TARGET) * 0.05;
              _playSamplerAt(_eyeSeqLast.voiceOut, _eyeSeqLast.schedule, _eyeSeqLast.nBins, _eyeSeqBarSecs, _eyeSeqCursor);
              _eyeSeqCursor += _eyeSeqBarSecs;
            }
          }
        }
        // ── recompute the united field (at fixed deep T) when dirty ──
        if (_eyeUnitedDirty || !_eyeSeqLast) {
          const peak = (a) => { let m=0; for (let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v;} return Math.max(m,1e-12); };
          const occ = (_eye.hMode === 6 || _eye.hMode === 7 || _eye.hMode === 8) ? _eye.hParam : 0;
          const nTiers = 4, nBins = 4;
          const layers = _eyeDepthLayers ?? (_eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS));
          const voice = _buildSeqVoice();
          // T = the slider's value directly (no floor) — full range 1..500. Deeper = more depth +
          // masking-robustness; at low T the hologram barely forms so image/events/voice degrade
          // and masking fails (honest, and lets you SEE the hologram→image formation across T).
          const usedT = _eye.tSteps;
          // LOADED united file → replay the three readouts from the ONE saved wavefront (no forward
          // pass; image+events+voice+depth all come back from that field). Else live forward+readout.
          const u = _eyeUnitedLoaded
            ? _eye.readoutUnited(_eyeUnitedLoaded.holo, _eyeUnitedLoaded.geom, _eyeTau, occ)
            : _eye.unitedField(layers, _seqEvents(), voice, _eyeTau,
                { nTiers, nBins, band: 0.7, occludeR: occ, barSecs: 2.0 });
          _eyeSeqLast = u;   // playback loop plays this (same {voiceOut, schedule, nBins} shape)
          _drawUnitedPanels(u, 'UNITED', occ, usedT);
          console.log(`[EYE UNITED] τ=${_eyeTau.toFixed(2)} occl=${occ.toFixed(2)} — voice ${u.voiceScore.toFixed(3)} (${((u.voiceStored??1)*100)|0}% fit) / events f1 ${u.f1.toFixed(3)} / image — one field, one clock`);
          _eyeUnitedDirty = false;
        }
      } else if (_eyeShowSoliton && _gpuReady && _eye) {
        // ── SOLITON (§7.22/§7.26) — CLOCK-PURE moving field Ψ(cyc), built from a COMPOSITE of first-
        // class solitons (event ⊕ image) via the soliton algebra (`evalSolitonTemporalAt`/`unite`). The field is
        // computed DIRECTLY from cycleCount each tick (last K bars recomputed from scratch), NOT
        // integrated frame-by-frame. So it is a pure function of the clock → every peer renders the
        // IDENTICAL moving picture regardless of frame rate (corr=1.0, measured) → SYNCED at any T,
        // no drift, no catch-up-skip. The "moving picture, not frames" goal: continuous f(clock).
        // Sound = the notes the field RECOVERS (H=occl audible). τ scrubs depth; T = bar depth.
        const occ = (_eye.hMode === 6 || _eye.hMode === 7 || _eye.hMode === 8) ? _eye.hParam : 0;
        const geom = { nTiers: _EYE_ROLL_TIERS, nBins: _eyeRollBins, imgRowsFrac: _EYE_ROLL_IMG_FRAC, vLen: 0, barSecs: 2.0 };
        const cyc = n.cycleCount ?? 0;
        const solBarSteps = Math.max(_eyeRollBins, Math.min(400, _eye.tSteps));   // bar PERIOD (≥nBins for onsets)
        const reconT = _eyeReconT > 0 ? _eyeReconT : Math.max(1, Math.min(400, _eye.tSteps));
        // ── SOLITON ALGEBRA (§7.26): build the scene as a COMPOSITE of first-class solitons — an event
        // soliton (pitch×onset roll, bottom region) ⊕ an image soliton (depth-staged layer stack, top
        // region), region-disjoint → cleanly readable. unite() returns ONE pure-cyc Soliton; evalSolitonTemporalAt
        // is the single engine (clock-pure K-bar recompute → H → back-prop → per-modality readout). Adding
        // a modality = one more soliton in unite([...]). Composite stays peer-synced by construction.
        const recogBar = Math.floor(cyc / _eyeRollBins);
        const sceneKey = (_eyeImgFull ? 'F' : 'T') + (_eyeGateMode ? 'G' : '_') + (_eyeOpCycMode ? 'O' : '_') + (_eyeRecogKind ? 'R'+recogBar : '_') + g_imgRows();
        if (!_eyeScene || _eyeSceneKey !== sceneKey) {
          const imgRows = g_imgRows();
          // EVENTS region-free on a CARRIER (§7.30) — notes spread across the WHOLE grid, separated by
          // carrier not by owning rows (sparse → clean, §7.29). They co-occupy cells with image+wave;
          // cross-basis separability is measured-clean for sparse carriers.
          // TEMPORAL scene (§7.44): modalities separate on the CLOCK (each alone in its bar phase) → NO carriers
          // needed. Region-placed events/wave put content directly in the real channel; the temporal engine
          // keeps them in distinct phases. (Carrier versions kept in the module for the carrier-mux comparison.)
          const sEvents = regionEventSoliton({ melodyFn: _rollMelody, nBins: _eyeRollBins });
          // IMAGE region: top band (default) OR FULL GRID (_eyeImgfull, dbl-click ⊙ SOLITON) — the test
          // of whether DENSE full-grid image (§7.29 floor case) breaks the carrier modalities sharing cells.
          const imgRegion = _eyeImgFull ? makeRegion(0, 0, GRID, GRID) : makeRegion(0, 0, GRID, imgRows);
          // RECOGNIZE mode: the image is a PAGE of real LETTERS — the target 'A' among distractor letters
          // (B,C,E,F,H,K,R,T — none a pure A-analog), rotating per bar. The recognizer finds the A's; matches
          // glow on panel 4. (Replaces the old L/+ glyphs — letters are more recognizable + better shape test.)
          let imgLayers;
          if (_eyeRecogKind) {
            const page = _buildLetterPage(recogBar);
            _eyeRecogSlots = page.cells;                // [{x,y,ch,isRef,depth}] — slots for CAND + overlay
            imgLayers = page.layers;                    // DEPTH-STAGED stack (3 planes) → real 3D scene
          }
          const sImage  = imageSoliton({ region: _eyeRecogKind ? makeRegion(0,0,GRID,GRID) : imgRegion,
                                         layersFn: _eyeRecogKind ? () => imgLayers : () => _eyeDepthLayers });
          // §7.54 RECOGNIZE via the FULL recognizer combinator (recognizeFull, soliton-algebra.js). It's a closed,
          // phase-native {kind:'recog',inject,readout} soliton (own clock phase, carrier-free, uniform §7.53) whose
          // app dependency — the GPU scale-search + discriminative subtraction (§7.38, the FULL recognizer the pure
          // single-scale `recognizePure` lacks) — is INJECTED as `score`. The node injects the letter page into its
          // phase; readout returns {field, result}. Here score just passes the phase field through; the actual GPU
          // dispatch (per recog kind) runs in the render block below where _eye + slots + tuning live (app scope).
          const sRecog = _eyeRecogKind
            ? recognizeFull({ target: sImage, score: (field) => field })   // result = the node's phase recon (real); GPU scoring below
            : null;
          // THIRD modality (§7.31): WAVEFORM soliton — timbre as sparse harmonics on its OWN carrier
          // (orthogonal to the event carrier: different k). Recovered harmonics SYNTHESIZE the sound.
          const sWave   = regionWaveSoliton({ harmonicsFn: _waveHarmonics, nBins: _eyeRollBins });
          if (_eyeGateMode) {
            // ── GATE MODE (§7.33 + §7.53) — composition-as-COMPUTATION, now PHASE-NATIVE. gate(events,image)
            // multiplies a beat-mask into the image so the picture survives ONLY where this bar's notes fire.
            // UNIFORM ISOLATION (§7.53): the temporal scene runs each combinator alone in its bar phase, so gate
            // needs NO carrier — its bound output is written directly into its phase and read back directly (the
            // binding still FUSES events·image in scratch; only placement/recovery is carrier-free). One mechanism.
            const maskFn = (g, cyc) => {                   // beat-mask: ON columns = this bar's onset bins
              const bar = Math.floor(cyc / _eyeRollBins), on = new Set(_rollMelody(bar).map(e => e.bin));
              const colW = Math.max(1, Math.round(g.G / _eyeRollBins)), m = new Float64Array(g.G * g.G);
              for (let y = 0; y < g.G; y++) for (let x = 0; x < g.G; x++) {
                const bin = Math.min(_eyeRollBins - 1, Math.floor(x / colW));
                if (on.has(bin)) m[y * g.G + x] = 1;
              }
              return m;
            };
            const sGate = gate(sEvents, sImage, maskFn, { temporal: true });   // §7.53 phase-native (carrier-free)
            _eyeScene = unite([sEvents, sGate, sWave], { name: 'scene-gated' });   // events ⊕ gated image ⊕ wave, each its own phase
          } else if (_eyeRecogKind) {
            // §7.54: the recognizer node OWNS the image phase (uniform combinator), replacing the bare image child.
            _eyeScene = unite([sEvents, sRecog, sWave], { name: 'scene-recog' });   // events ⊕ recog(image) ⊕ wave
          } else {
            _eyeScene = unite([sEvents, sImage, sWave], { name: 'scene' });   // events ⊕ image ⊕ wave, ONE field
          }
          _eyeSceneKey = sceneKey;
        }
        // ── RECOMPUTE Ψ(cyc) via the algebra (cached per cyc/τ/occ/T). Adapt the composite result to the
        // _eyeSeqLast shape the audio + panels below expect (recovered/f1/trueSet flattened from the event
        // readout; viewTau/holoMasked/readBar passthrough). H-occlusion lives in evalSolitonTemporalAt (§7.22).
        const renderKey = `${cyc}|${_eyeTau.toFixed(3)}|${occ.toFixed(3)}|${solBarSteps}|${reconT}|${_EYE_SOL_K}|${_eyeTemporalLock}`;
        if (renderKey !== _eyeSolReadKey) {
          // SOLITON now uses the TEMPORAL-MULTIPLEXED engine (§7.44): modalities are separated on the CLOCK
          // axis (each in its phase of the bar), not by carriers. Same composite, same return shape → panels,
          // audio, occlusion, τ all work unchanged; the field on panel 1 cycles through the modalities live.
          const r = evalSolitonTemporalAt(_eye, _eyeScene, cyc,
            { geom, barSteps: solBarSteps, reconT, readBars: 1, K: _EYE_SOL_K, tau: _eyeTau, occludeR: occ, displayLock: _eyeTemporalLock });
          const ev = r.readouts.event || { recovered: [], trueSet: [], f1: 0 };
          const wv = r.readouts.wave || null;   // recovered harmonics → synthesis timbre (§7.31)
          const gt = r.readouts.gate || null;   // gated image field (§7.33) — events × image, real per-cell
          _eyeSeqLast = { field: r.field, holoMasked: r.holoMasked, viewTau: r.viewTau,
            imageRecon: r.imageRecon || r.viewTau,   // §7.44: the IMAGE-phase recon, for recog regardless of display lock
            recovered: ev.recovered, trueSet: ev.trueSet, f1: ev.f1, harmonics: wv ? wv.harmonics : null,
            gatedField: gt ? gt.field : null,
            readBar: r.readBar, readAge: r.readAge, nowBar: r.nowBar, nTiers: r.nTiers, nBins: r.nBins };
          _eyeSolReadKey = renderKey;
        }

        // ── OP-CYCLE (§7.43): the operator-as-clock BINDS two scene fields (events ⊗ image) on the GPU. The
        // rank walks with the bar (rank = bar mod K). Sample the events-pattern and the image into Nr-vectors
        // on the operator lattice, run the GPU operator bar, keep the bound output for panel 4. Once per bar.
        if (_eyeOpCycMode && _eyeSeqLast) {
          const Nr = 64, barNow = Math.floor(cyc / _eyeRollBins);
          if (!_eyeOpCycObj) {
            let rs = 0x6C1D >>> 0; const rv = () => { const v = new Float64Array(Nr); for (let i=0;i<Nr;i++){ rs=(rs*1664525+1013904223)>>>0; v[i]=rs/4294967296*2-1; } return v; };
            const tr = []; for (let r=0;r<3;r++) tr.push({ U: rv(), V: rv(), W: rv() });   // a rank-3 binding rule
            const lowTensor = (N) => { const T=[]; for(let k=0;k<N;k++){ const row=new Float64Array(N*N); for(let i=0;i<N;i++)for(let j=0;j<N;j++){ let s=0; for(const{U,V,W}of tr) s+=W[k]*U[i]*V[j]; row[i*N+j]=s; } T.push(row); } return T; };
            _eyeOpCycObj = operatorSolitonCyc(fitOperatorSoliton(lowTensor, { N: Nr, K: 12 }).triples, { name: 'sceneΨ' });
            const sd = Math.ceil(Math.sqrt(Nr)), st = Math.max(1, Math.floor(GRID/sd));
            _eyeOpCycCells = []; for (let i=0;i<Nr;i++){ const gx=(i%sd)*st+(st>>1), gy=((i/sd)|0)*st+(st>>1); _eyeOpCycCells.push(Math.min(GRID-1,gy)*GRID+Math.min(GRID-1,gx)); }
            _gpu.opCycleInit();
            console.log(`[OP-CYCLE] operator built (period ${_eyeOpCycObj.period}); binds events⊗image, rank per bar, on the GPU.`);
          }
          if (barNow !== _eyeOpCycLastBar) {
            // a = this bar's EVENT pattern downsampled to Nr; b = the IMAGE (viewTau real) downsampled to Nr.
            const sampleToNr = (realField, isComplex) => { const v = new Float64Array(Nr), cells = _eyeOpCycCells;
              // nearest-cell sample (cheap, deterministic): the field value at each lattice cell.
              for (let i=0;i<Nr;i++){ const c = cells[i]; v[i] = isComplex ? realField[c*2] : realField[c]; } return v; };
            const aVec = (() => { const m = new Float64Array(GRID*GRID);   // events = this bar's onset columns
              const on = new Set(_rollMelody(barNow).map(e=>e.bin)), colW = Math.max(1, Math.round(GRID/_eyeRollBins));
              for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ const bin=Math.min(_eyeRollBins-1, Math.floor(x/colW)); if(on.has(bin)) m[y*GRID+x]=1; }
              return sampleToNr(m, false); })();
            const bVec = sampleToNr(_eyeSeqLast.imageRecon || _eyeSeqLast.viewTau || _eyeSeqLast.field, true);
            const res = _eye.operatorCycleBarGPU(_eyeOpCycObj.triples, aVec, bVec, _eyeOpCycCells);   // full GPU bar
            _eyeOpCycBound = res.bound;
            _eyeOpCycLastBar = barNow;
            if ((barNow & 3) === 0) console.log(`[OP-CYCLE] bar ${barNow} rank-cycle bound events⊗image — GPU vs JS corr=${res.corr.toFixed(3)}`);
          }
        }

        // ── RECOGNIZE (§7.34 + §7.38 SCALE-INVARIANT): once per BAR (each slot×scale is a GPU round-trip),
        // find the reference at ANY SIZE — recognizeLiveScale searches over scales per slot and returns the
        // best score AND the matched scale (the §7.38 scale-localization: the matched scale reports the
        // object's size). The scene scored is the recon image (viewTau real channel) — the reconstructed
        // wavefront. So the L's light up regardless of their size, and the glow reports each one's size.
        if (_eyeRecogKind && _eyeSeqLast && _eyeSeqLast.imageRecon && _eyeRecogSlots && recogBar !== _eyeRecogBar) {
          _eyeRecogBar = recogBar;
          // §7.44/§7.54: recog reads the recon of the RECOGNIZER COMBINATOR NODE's own clock phase (imageRecon =
          // the field-valued 'recog' child's phase recon — carrier-free, phase-isolated, uniform §7.53). The GPU
          // scale-search below runs on THIS phase field — the node's capability lives inside its phase.
          const vt = _eyeSeqLast.imageRecon, sceneR = new Float64Array(N_CELLS);
          for (let i=0;i<N_CELLS;i++) sceneR[i] = vt[i*2];           // real channel of the recog node's phase recon
          const _refA = _letterRef(_LETTER_TARGET);                  // reference = the target letter 'A', centered
          if (_eyeRecogKind === 'fft') {
            // ⊞ FFT DENSE (§7.36 pure-conv): score EVERY pixel via the convolution theorem (DFT = the pure
            // ring conv's diagonalizing transform). O(N log N), independent of T. Whole field glows.
            _eyeRecogDenseMap = _eye.denseRecognizeScale(sceneR, _refA, { scales: [0.7, 1.0, 1.4] });
            const mp = _eyeRecogDenseMap.map; let above=0; for (let i=0;i<mp.length;i++) if (mp[i]>0.6) above++;
            console.log(`[EYE RECOG ⊞FFT §7.36] bar=${recogBar} dense FFT map — ${above} cells >0.6 (occurrences, any pos/size)`);
            _eyeRecogHits = null;
          } else if (_eyeRecogKind === 'wave') {
            // ∿ WAVE (§7.38 IFS-native wavelet, cascade-ONLY): recognition by SCALE-BAND SIGNATURE MATCHING —
            // decompose the scene into the attractor-contracted ring bands and match each location's band
            // signature to the reference's. No FFT, no correlation — the fractal cascade does everything.
            // Glows over the whole object footprint (broad/bright), dominant band reports size (hue).
            _eyeRecogDenseMap = _eye.waveletRecognizeScaleGPU(sceneR, _refA, { depth: 6, sectors: 12, scales: _LETTER_SCALES,
              sharpPow: _recogSharpPow, energyGate: _recogEnergyGate,
              distractFn: _LETTER_DISTRACT.map(d => () => _letterRef(d)), disWeight: _recogDisWeight });   // subtract ALL distractors (sq+circ)
            const mp = _eyeRecogDenseMap.map; let above=0; for (let i=0;i<mp.length;i++) if (mp[i]>0.6) above++;
            console.log(`[EYE RECOG ∿WAVE §7.38 GPU] bar=${recogBar} scale-search [${_LETTER_SCALES.join(',')}] finding '${_LETTER_TARGET}' at ANY size — ${above} cells >0.6`);
            _eyeRecogHits = null;
          } else if (_eyeRecogKind === 'holo') {
            // ∿ HOLO (§7.40): the HOLOGRAM domain DELOCALIZES positions (each A spreads over the whole grid),
            // so it answers "is A PRESENT, how strongly" — NOT "where". A scalar PRESENCE = corr(sceneHolo,
            // A-holo) / corr(sceneHolo, distractor-holo); >1 = A-content dominates, and it RISES with T (truer
            // hologram), the opposite of the recon photo. Shown as a central strength meter, not a spatial map.
            const holoT = (_eyeReconT>0?_eyeReconT:reconT);
            const distractFn = () => _letterRef(_LETTER_DISTRACT[0]);   // a non-A hologram template ('B')
            _eyeHoloPresence = _eye.holoPresence(_eyeSeqLast.field, _refA, distractFn, { T: holoT, occludeR: occ });
            _eyeRecogDenseMap = null; _eyeRecogHits = null;             // presence meter, no per-cell map
            console.log(`[EYE RECOG ∿HOLO §7.40] bar=${recogBar} T=${holoT} 'A' PRESENCE ${_eyeHoloPresence.presence.toFixed(2)}× (A-holo/distractor-holo corr; >1=A present, RISES with T) — hologram delocalizes position, reports presence not where`);
          } else {
            // ⊡ CAND (§7.34/§7.38): candidate slots via the IFS leapfrog ROUND-TRIP, scale-search per slot.
            // Runs at the FULL slider T (no cap) — the whole T picture; cost 2T·9slots·5scales (slow at high T).
            _eyeRecogDenseMap = null;
            const recogT = (_eyeReconT>0?_eyeReconT:reconT);
            const scored = _eye.recognizeLiveScale(sceneR, _refA, _eyeRecogSlots,
              { T: recogT, occludeR: occ, scales: [0.6, 0.85, 1.0, 1.25, 1.6] });
            _eyeRecogHits = scored.map((h,i) => ({ ...h, isRef: _eyeRecogSlots[i].isRef, ch: _eyeRecogSlots[i].ch }));
            const lit = _eyeRecogHits.filter(h => h.score > 0.5).length, refs = _eyeRecogSlots.filter(s=>s.isRef).length;
            // discrimination = MEAN(ref raw) / MEAN(distractor raw) (>1 = refs lead). Sweep T → softens, not vanishes.
            const refRaws = _eyeRecogHits.filter(h=>h.isRef).map(h=>h.raw);
            const disRaws = _eyeRecogHits.filter(h=>!h.isRef).map(h=>h.raw);
            const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
            const discrim = mean(refRaws) / Math.max(1e-9, mean(disRaws));
            const liveT = (_eyeReconT>0?_eyeReconT:reconT);
            const litCh = _eyeRecogHits.filter(h=>h.score>0.5).map(h=>h.ch+(h.isRef?'✓':'✗')).join(' ');
            console.log(`[EYE RECOG ⊡CAND §7.39] T=${liveT} finding '${_LETTER_TARGET}' — discrimination ${discrim.toFixed(2)}× | lit ${lit}/${refs} [${litCh}]`);
          }
          // §7.40 ONE-SHOT: hologram-domain vs recon-domain recognition across T (answers "why does recon
          // recognition degrade at high T while the hologram gets truer?"). Set _eyeHoloVsTRun=true in console.
          if (_eyeHoloVsTRun) { _eyeHoloVsTRun = false;
            const aSites = _eyeRecogSlots.filter(s=>s.isRef), dSites = _eyeRecogSlots.filter(s=>!s.isRef);
            _eye.holoRecogVsT(sceneR, _refA, aSites, dSites, { Ts: [10, 50, 150, 350] });
          }
        }

        // ── AUDIO: play the RECON notes (_eyeSeqLast.recovered — FROM the masked-Ψ(cyc) back-prop), gated
        // on the actual READ-BAR advancing (not raw cyc) so each bar plays ITS OWN recon exactly once —
        // no stale replay, no wrong-bar notes. Scheduled on a drift-corrected audio cursor (clock grid,
        // span-measured) so the beat is steady and a heavy recompute can't break it. Catches up skips.
        if (_eyeSoundPlay && _eyeSeqLast && _eyeAudioCtx && _eyeSeqLast.readBar != null) {
          const readBar = _eyeSeqLast.readBar;
          if (_eyeSeqLastBar < 0) _eyeSeqLastBar = readBar - 1;
          if (readBar > _eyeSeqLastBar) {
            const nowMs = performance.now(), audioNow = _eyeAudioCtx.currentTime;
            const bars = readBar - _eyeSeqLastBar;
            if (_eyeSeqLastBarMs > 0) { const sp = Math.max(0.15, Math.min(6, (nowMs - _eyeSeqLastBarMs)/1000/bars)); _eyeSeqBarSecs = _eyeSeqBarSecs>0 ? (_eyeSeqBarSecs*0.6+sp*0.4) : sp; }
            _eyeSeqLastBar = readBar; _eyeSeqLastBarMs = nowMs;
            if (_eyeSeqBarSecs > 0) {
              const TARGET = 0.12, span = _eyeSeqBarSecs, slot = span / Math.max(1, _eyeRollBins);
              if (_eyeSeqCursor <= 0) _eyeSeqCursor = audioNow + TARGET;
              const lead = _eyeSeqCursor - audioNow;
              if (lead < 0.02 || lead > span + 0.25) _eyeSeqCursor = audioNow + TARGET;
              else _eyeSeqCursor -= (lead - TARGET) * 0.05;
              // current read-bar's RECON notes (this is the bar we just recovered)
              const cur = (_eyeSeqLast.recovered || []).slice().sort((a,b)=>a.bin-b.bin);
              const harm = _eyeSeqLast.harmonics;   // recovered timbre spectrum (wave soliton) → synthesis
              // TIMBRE LOG (once per bar): the recovered harmonic amplitudes that synthesize the tone
              // color — watch them MORPH bar-to-bar (wave soliton live) and DULL under H=OCCL.
              if (harm) console.log(`[WAVE timbre] readBar=${readBar} harmonics=[${[...harm].map(x=>x.toFixed(2)).join(', ')}] notes=${cur.length}/${_eyeSeqLast.trueSet?.length ?? '?'}${occ>0?` occl ${occ.toFixed(2)}`:''}`);
              // if bars were skipped, fill the gap bars from their OWN recon content (recovered≈content
              // for an un-occluded matured bar) so there's no silence — but the DUE bar uses the real recon.
              for (let b = 0; b < Math.min(bars, 2); b++) {
                const isCurrent = (b === bars - 1) || bars === 1;
                const notes = isCurrent ? cur
                  : _rollMelody(readBar - (bars - 1 - b)).slice().sort((a,b)=>a.bin-b.bin);
                for (const a of notes) _playRoll([a], _EYE_ROLL_TIERS, span, _eyeSeqCursor + a.bin * slot, harm);
                _eyeSeqCursor += span;
              }
            }
          }
        }
        const u = _eyeSeqLast;
        if (u) {
          const usedT = _eye.tSteps;
          // OP-CYCLE: render the operator-bound output on panel 4 (reuses the gatedField path = real per-cell
          // field). Scatter the Nr-vector back onto its lattice cells (with a small footprint so it's visible).
          if (_eyeOpCycMode && _eyeOpCycBound && _eyeOpCycCells) {
            const bf = new Float64Array(GRID * GRID); const cells = _eyeOpCycCells;
            for (let i = 0; i < _eyeOpCycBound.length; i++) { const c = cells[i], v = _eyeOpCycBound[i];
              const cx = c % GRID, cy = (c / GRID) | 0;   // 3×3 footprint so each dim is a visible blob
              for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = (cx+dx+GRID)%GRID, y = (cy+dy+GRID)%GRID; bf[y*GRID+x] = v; } }
            u.gatedField = bf; u._opCyc = true;
          } else { u._opCyc = false; }
          _drawUnitedPanels(u, 'SOLITON', occ, usedT, `recT=${reconT}${_eyeReconT>0?'*':''} readBar=${u.readBar ?? '-'}`, true);
          // REFERENCE inset — draw the PROPAGATED reference HOLOGRAM (the reference forward-propagated to the
          // live depth = the interference pattern matched in ∿ HOLO) overlaying the TOP-LEFT corner of the
          // EVENTS/NOTES panel (eyePerceptCell), so you SEE the spread template next to the events grid.
          // Drawn AFTER _drawUnitedPanels (which paints the events grid) so it sits on top.
          if (_eyeRecogKind) {
            const refF = _letterRef(_LETTER_TARGET), cplx = new Float64Array(2*N_CELLS);
            for (let i=0;i<N_CELLS;i++) cplx[i*2] = refF[i];
            const refDepth = Math.max(1, Math.min(400, (_eyeReconT>0?_eyeReconT:reconT)));
            _gpu.setEyePsi(cplx); _gpu.stepEyeN(refDepth, _eye.dt);   // forward-propagate → the ref HOLOGRAM
            const pk=(a)=>{let m=1e-12;for(let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1];if(v>m)m=v;}return m;};
            _gpu.renderEyeField(pk(_gpu.readEyePsi()));
            const ctx = eyePerceptCell.ctx, iw = RW*0.26, ih = RH*0.26, ix = 6, iy = 6;   // NOTES panel, top-left
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(ix-2, iy-2, iw+4, ih+16);   // backing so it reads over the grid
            ctx.drawImage(_gpuCanvas, ix, iy, iw, ih);
            ctx.strokeStyle = 'rgba(120,255,160,0.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(ix, iy, iw, ih);
            ctx.fillStyle = 'rgba(120,255,160,0.95)'; ctx.font = '10px monospace'; ctx.textAlign='left'; ctx.textBaseline='top';
            ctx.fillText(`REF: ${_LETTER_TARGET} @T=${refDepth}`, ix+2, iy+ih+2);
            ctx.restore();
            _gpu.setEyePsi(u.field || u.viewTau);   // restore the live field as the eye buffer
          }
          // RECOGNIZE overlay (§7.34): the matched L's GLOW. For each slot the recognizer scored high, paint
          // a green radial glow + trace the L's EDGES at that location, composited as ADDED LIGHT onto the
          // recon (so the recognized objects literally light up in the field). Score sets the glow intensity.
          // No dense map needed: we already know WHERE the L's are (the high-scoring slots) — we light those.
          if (_eyeRecogKind === 'holo' && _eyeHoloPresence) {
            // ∿ HOLO PRESENCE METER (§7.40): the hologram delocalizes position → no spatial map. Show a single
            // central glow whose SIZE+BRIGHTNESS = how strongly 'A' is present (presence ratio), + a vertical
            // strength bar. Watch it RISE as you raise T (truer hologram), unlike the recon glow that fades.
            const ctx = eyeImgCell.ctx, p = _eyeHoloPresence.presence;
            const lvl = Math.max(0, Math.min(1, (p - 1) / 2));   // map presence 1..3 → 0..1
            const pulse = 0.7 + 0.3 * Math.sin((n.cycleCount ?? 0) * 0.3);
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            const cx = RW/2, cy = RH/2, R = RW*(0.12 + 0.28*lvl);
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
            grad.addColorStop(0, `rgba(40,255,110,${(0.5+0.5*lvl)*pulse})`); grad.addColorStop(1, 'rgba(40,255,110,0)');
            ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
            // strength bar (left edge)
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(8, RH*0.15, 14, RH*0.7);
            ctx.fillStyle = `rgb(40,255,110)`; const bh = RH*0.7*lvl; ctx.fillRect(8, RH*0.85-bh, 14, bh);
            ctx.restore();
            eyeImgCell.setLabel(`SOLITON  ∿HOLO §7.40 — 'A' PRESENCE ${p.toFixed(2)}× (hologram: presence not position; ↑ with T)`);
          } else if (_eyeRecogKind && _eyeRecogDenseMap) {
            // DENSE overlay (∿WAVE §7.38 / ⊞FFT §7.36): paint the correlation/cascade MAP — every cell where
            // the reference occurs glows, intensity = map value, hue by detected/matched scale. Whole field.
            const ctx = eyeImgCell.ctx, sx = RW / GRID, sy = RH / GRID;
            const mp = _eyeRecogDenseMap.map, scAt = _eyeRecogDenseMap.scaleAt;
            const pulse = 0.7 + 0.3 * Math.sin((n.cycleCount ?? 0) * 0.3);
            // source-over (paint ON TOP), NOT additive — additive green over the bright-blue letters reads
            // cyan/white, never green. Every lit cell IS a matched target, so glow GREEN by match strength.
            ctx.save(); ctx.globalCompositeOperation = 'source-over';
            let occn = 0; const THR = _recogThr;   // tunable glow threshold on the match map (window.recogTune)
            // glow radius tracks the LETTER size but kept SMALLER (0.35×) so neighboring glows DON'T bleed into each other.
            const baseGlow = (_LETTER_CELL * 0.35) * sx;
            for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ const v = mp[y*GRID+x]; if (v <= THR) continue;
              occn++;
              const a = Math.min(1, (v-THR)/(1-THR)) * pulse;   // ramp above threshold (match strength)
              const sc = scAt[y*GRID+x] || 1;
              const col = '30,255,90';                          // GREEN — the matched target glows green
              const R = baseGlow * (0.6 + 0.5*sc), grad = ctx.createRadialGradient(x*sx, y*sy, 0, x*sx, y*sy, R);
              grad.addColorStop(0, `rgba(${col},${0.85*a})`); grad.addColorStop(0.55, `rgba(${col},${0.35*a})`); grad.addColorStop(1, `rgba(${col},0)`);
              ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x*sx, y*sy, R, 0, 7); ctx.fill();
            }
            ctx.restore();
            const tag = _eyeRecogKind==='wave' ? '∿WAVE §7.38 recon' : _eyeRecogKind==='holo' ? '∿HOLO §7.40 hologram (improves w/T)' : '⊞FFT §7.36 dense';
            eyeImgCell.setLabel(`SOLITON  RECOGNIZE ${tag} — ${occn} cells lit (any pos/size)${occ>0?` occl ${occ.toFixed(2)}`:''}`);
          } else if (_eyeRecogKind && _eyeRecogHits) {
            const ctx = eyeImgCell.ctx, sx = RW / GRID, sy = RH / GRID, gs = _GLYPH_S;
            const pulse = 0.7 + 0.3 * Math.sin((n.cycleCount ?? 0) * 0.3);   // gentle alive pulse
            ctx.save(); ctx.globalCompositeOperation = 'lighter';   // ADD light to the field
            for (const h of _eyeRecogHits) {
              if (h.score <= 0.5) continue;                          // only matches glow
              const cx = h.x * sx, cy = h.y * sy, a = Math.min(1, h.score) * pulse;
              const col = h.isRef ? '78,255,150' : '255,90,90';     // green = correct target, red = false hit
              const msc = h.scale ?? 1;                              // §7.38: glow + ring SIZED to the MATCHED scale
              // soft radial GLOW + ring around the matched letter, radius tracking the matched size
              const R = gs * sx * 2.4 * msc, grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
              grad.addColorStop(0, `rgba(${col},${0.55*a})`); grad.addColorStop(0.5, `rgba(${col},${0.22*a})`); grad.addColorStop(1, `rgba(${col},0)`);
              ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
              ctx.shadowColor = `rgb(${col})`; ctx.shadowBlur = 8 * a; ctx.strokeStyle = `rgba(${col},${a})`; ctx.lineWidth = 2.5;
              ctx.beginPath(); ctx.arc(cx, cy, R*0.7, 0, 7); ctx.stroke();   // ring around the found letter, sized to match
            }
            ctx.restore();
            const hits = _eyeRecogHits.filter(h=>h.score>0.5);
            eyeImgCell.setLabel(`SOLITON  RECOGNIZE §7.38 — found '${_LETTER_TARGET}' ×${hits.filter(h=>h.isRef).length} (${hits.length} lit)${occ>0?` occl ${occ.toFixed(2)}`:''}`);
          }
          if (!_eyeSolLogN || _eyeSolLogN-- > 0) {
            const nm = (t)=>(_ROLL_NAMES[t % _ROLL_NAMES.length]);
            const got = (u.recovered||[]).map(a=>nm(a.tier)).join(' ');
            console.log(`[EYE SOLITON Ψ(cyc)] cyc=${cyc} readBar=${u.readBar}(age ${u.readAge|0}) notes:[${got}] f1 ${u.f1?.toFixed?.(2)} — one live holographic soliton (H masks Ψ)`);
          }
        }
      } else if (_eyeShowCycle && _gpuReady && _eye) {
        // ── LIMIT CYCLE (§7.43/§7.44) — the binding OPERATOR and MULTIMEDIA as clock limit cycles, LIVE.
        // "Dense things can't share an instant, but they can share a clock": the K ranks (operator) / M
        // modalities (media) ride the CLOCK axis, one per sub-tick, instead of crosstalking in one frozen
        // field. Driven by the shared clock cyc (peer-synced: rank/phase = cyc mod period, a pure function).
        const cyc = n.cycleCount ?? 0;
        // tile painter: draw an Nr-vector as a side×side grid of signed cells (red=+ / blue=−), brightness=|v|.
        const drawTile = (ctx, vec, side, label, mx0) => {
          const W = RW, H = RH; ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, W, H);
          let mx = mx0 || 0; if (!mx) { for (let i = 0; i < vec.length; i++) mx = Math.max(mx, Math.abs(vec[i])); } mx = Math.max(mx, 1e-9);
          const pad = 14, gw = (W - 2 * pad) / side, gh = (H - pad - 8) / side;
          for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
            const i = y * side + x; if (i >= vec.length) continue; const v = vec[i] / mx;
            const a = Math.min(1, Math.abs(v)); const x0 = pad + x * gw, y0 = (pad - 6) + y * gh;
            ctx.fillStyle = v >= 0 ? `rgba(255,120,90,${a})` : `rgba(90,150,255,${a})`;
            ctx.fillRect(x0 + 1, y0 + 1, gw - 2, gh - 2);
          }
          ctx.fillStyle = '#9fd'; ctx.font = '8px ui-monospace,monospace'; ctx.fillText(label, 4, 9);
        };
        if (_eyeCycleKind === 'operator') {
          // ── OPERATOR limit cycle: build a rank-K operator once; walk one rank per clock tick; accumulate
          //    the bound output Σ_r W_r·(U_r·a)(V_r·b) tick-by-tick over the bar. At the end of a bar the
          //    accumulation EQUALS operatorSoliton.apply(a,b) (exact, §7.43). Panels: rank carrier W_r (this
          //    tick) | input A | input B | accumulating bound output + rank/bar indicator.
          if (!_eyeCycleOp) {
            const Nr = _eyeCycleNr; let rs = 0x51A3 >>> 0; const rv = () => { const v = new Float64Array(Nr); for (let i = 0; i < Nr; i++) { rs = (rs * 1664525 + 1013904223) >>> 0; v[i] = rs / 4294967296 * 2 - 1; } return v; };
            // a rank-3 binding rule reified exactly → its true bilinear rank of rank-1 triples (the limit cycle period)
            const tr = []; for (let r = 0; r < 3; r++) tr.push({ U: rv(), V: rv(), W: rv() });
            const lowTensor = (N) => { const T = []; for (let k = 0; k < N; k++) { const row = new Float64Array(N * N); for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { let s = 0; for (const { U, V, W } of tr) s += W[k] * U[i] * V[j]; row[i * N + j] = s; } T.push(row); } return T; };
            const stack = fitOperatorSoliton(lowTensor, { N: Nr, K: 12 });
            _eyeCycleOp = operatorSolitonCyc(stack.triples, { name: 'liveΨ' });
            _eyeCycleA = rv(); _eyeCycleB = rv();
            _eyeCycleAccum = new Float64Array(Nr); _eyeCycleLastTick = -1;
            // GPU lattice for the Nr cells (same scheme as operatorCycleBarGPU) + init the GPU accumulation textures.
            const sd = Math.ceil(Math.sqrt(Nr)), st = Math.max(1, Math.floor(GRID / sd));
            _eyeCycleCells = []; for (let i = 0; i < Nr; i++) { const gx = (i % sd) * st + (st >> 1), gy = ((i / sd) | 0) * st + (st >> 1); _eyeCycleCells.push(Math.min(GRID-1, gy) * GRID + Math.min(GRID-1, gx)); }
            _gpu.opCycleInit();
            console.log(`[CYCLE operator] built operatorSolitonCyc — period K=${_eyeCycleOp.period} ranks, Nr=${Nr}, GPU accumulation. Walking one rank per clock tick.`);
          }
          const op = _eyeCycleOp, K = op.period, side = Math.round(Math.sqrt(_eyeCycleNr));
          const rankNow = op.rankAt(cyc);
          const cells = _eyeCycleCells;
          const placeF = (v) => { const f = new Float64Array(GRID * GRID); for (let i = 0; i < _eyeCycleNr; i++) f[cells[i]] = v[i]; return f; };
          // advance ON THE GPU once per NEW clock tick: GPU dot products (U_r·a),(V_r·b) + scatter-MAD into the
          // persistent accumulation texture (reset on rank 0). JS reads back the accumulation only for rendering.
          if (cyc !== _eyeCycleLastTick) {
            const aF = placeF(_eyeCycleA), bF = placeF(_eyeCycleB), tri = op.triples[rankNow];
            _gpu.opCycleUpload('a', placeF(tri.U)); _gpu.opCycleUpload('b', aF); const ua = _gpu.opCycleDotAB();
            _gpu.opCycleUpload('a', placeF(tri.V)); _gpu.opCycleUpload('b', bF); const vb = _gpu.opCycleDotAB();
            _gpu.opCycleUpload('w', placeF(tri.W));
            _gpu.opCycleTick(ua * vb, rankNow === 0);                            // acc += W_r·(U_r·a)(V_r·b) on the GPU
            const accF = _gpu.opCycleReadAcc();
            _eyeCycleAccum = new Float64Array(_eyeCycleNr); for (let i = 0; i < _eyeCycleNr; i++) _eyeCycleAccum[i] = accF[cells[i]];
            _eyeCycleLastTick = cyc;
          }
          // DOM panel order (left→right): eyeFieldCell | eyePerceptCell | eyeEvidCell | eyeImgCell.
          // Paint them as: RANK W_r | input A | input B | BOUND output, so it reads naturally L→R.
          drawTile(eyeFieldCell.ctx, op.fieldAt(cyc), side, `RANK ${rankNow}/${K - 1}  W_${rankNow} (emitting now)`);
          eyeFieldCell.setLabel(`① ⟳ OPERATOR  rank ${rankNow}/${K - 1} live (cyc ${cyc})`);
          drawTile(eyePerceptCell.ctx, _eyeCycleA, side, 'input A');
          eyePerceptCell.setLabel('② input A (bound by the operator)');
          drawTile(eyeEvidCell.ctx, _eyeCycleB, side, 'input B');
          eyeEvidCell.setLabel('③ input B');
          // panel 4: GPU bound output (LEFT half) vs the JS exact reference (RIGHT half), shared color scale, so
          // the corr=1.000 is VISIBLE — the two halves should be cell-for-cell identical (GPU path verified live).
          { const ctx = eyeImgCell.ctx, W = RW, H = RH; ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, W, H);
            const exact = op.toStack().apply(_eyeCycleA, _eyeCycleB);   // JS reference (cheap at Nr=64)
            // shared max over BOTH so colors are comparable
            let mx = 1e-9; for (let i = 0; i < _eyeCycleNr; i++) { mx = Math.max(mx, Math.abs(_eyeCycleAccum[i]), Math.abs(exact[i])); }
            const pad = 14, halfW = (W - 3 * pad) / 2, gw = halfW / side, gh = (H - pad - 8) / side;
            const drawHalf = (vec, x0) => { for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) { const i = y*side+x; if (i>=vec.length) continue; const v = vec[i]/mx, a = Math.min(1, Math.abs(v)); ctx.fillStyle = v>=0?`rgba(255,120,90,${a})`:`rgba(90,150,255,${a})`; ctx.fillRect(x0 + x*gw + 1, (pad-6) + y*gh + 1, gw-2, gh-2); } };
            drawHalf(_eyeCycleAccum, pad); drawHalf(exact, 2*pad + halfW);
            ctx.fillStyle = '#9fd'; ctx.font = '8px ui-monospace,monospace'; ctx.fillText('GPU bound', pad, 9); ctx.fillText('JS exact', 2*pad + halfW, 9);
            const prog = (rankNow + 1) / K; ctx.fillStyle = '#274'; ctx.fillRect(0, H-6, W, 6); ctx.fillStyle = '#9fd'; ctx.fillRect(0, H-6, W*prog, 6);
            let d=0,na=0,nb=0; for (let i=0;i<_eyeCycleNr;i++){ d+=_eyeCycleAccum[i]*exact[i]; na+=_eyeCycleAccum[i]**2; nb+=exact[i]**2; }
            const corr = d/Math.sqrt(Math.max(1e-12,na*nb));
            eyeImgCell.setLabel(rankNow === K-1 ? `④ BOUND: GPU≡JS  corr=${corr.toFixed(3)} (bar complete)` : `④ BOUND accumulating (rank ${rankNow+1}/${K})  GPU vs JS corr=${corr.toFixed(3)}`);
          }
        } else {
          // ── MEDIA limit cycle (§7.44): two DENSE images, packed CARRIER (space, leaks→self≈0.82) vs
          //    TEMPORAL (time-phased, self≈1.0). Shift-click ⟳ CYCLE toggles. Panels: image A (truth) |
          //    recovered A | recovered B | image B (truth) + the live self-fidelity numbers for the active mode.
          const G = GRID, N = G * G;
          if (!_eyeCycleMedia) {
            let rs = 0x2D4B >>> 0; const rand = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
            const dense = () => { const m = new Float64Array(N); for (let i = 0; i < N; i++) m[i] = rand() * 2 - 1; return m; };
            _eyeCycleMedia = { imgA: dense(), imgB: dense() };
            console.log('[CYCLE media] built two DENSE images. Shift-click ⟳ CYCLE to toggle CARRIER (space) ↔ TEMPORAL (time).');
          }
          const M = _eyeCycleMedia, dt = _eye.dt, T = 30;
          const corrR = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(Math.max(1e-12, na * nb)); };
          let recA, recB, selfA, selfB, modeTag;
          if (!_eyeCycleMediaUseTemporal) {
            // CARRIER: both on orthogonal carriers, one round-trip, demod each (the dense-leak regime)
            const cA = { kx: 0.75, ky: 0.525 }, cB = { kx: 1.5, ky: 1.05 };
            const psi = new Float64Array(2 * N);
            for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const i = y * G + x, ph1 = cA.kx * x + cA.ky * y, ph2 = cB.kx * x + cB.ky * y; psi[i*2] += M.imgA[i] * Math.cos(ph1) + M.imgB[i] * Math.cos(ph2); psi[i*2+1] += M.imgA[i] * Math.sin(ph1) + M.imgB[i] * Math.sin(ph2); }
            _gpu.setEyePsi(psi); _gpu.stepEyeN(T, dt); _gpu.stepEyeN(T, -dt); const rt = _gpu.readEyePsi();
            recA = new Float64Array(N); recB = new Float64Array(N);
            for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const i = y * G + x, p1 = cA.kx * x + cA.ky * y, p2 = cB.kx * x + cB.ky * y; recA[i] = rt[i*2] * Math.cos(p1) + rt[i*2+1] * Math.sin(p1); recB[i] = rt[i*2] * Math.cos(p2) + rt[i*2+1] * Math.sin(p2); }
            modeTag = 'CARRIER (space-mux)';
          } else {
            // TEMPORAL: phase A then phase B within the bar; field propagates between phases; receiver subtracts
            // the known post-A field (clock-pure boundary) to isolate B. Self≈1.0 (matched reversible round-trip).
            const phaseT = 6;
            const pa = new Float64Array(2 * N); for (let i = 0; i < N; i++) pa[i*2] = M.imgA[i];
            _gpu.setEyePsi(pa); _gpu.stepEyeN(phaseT, dt); _gpu.stepEyeN(phaseT, -dt); const rtA = _gpu.readEyePsi();
            recA = new Float64Array(N); for (let i = 0; i < N; i++) recA[i] = rtA[i*2];
            const pb = new Float64Array(rtA); for (let i = 0; i < N; i++) pb[i*2] += M.imgB[i];
            _gpu.setEyePsi(pb); _gpu.stepEyeN(phaseT, dt); _gpu.stepEyeN(phaseT, -dt); const rtB = _gpu.readEyePsi();
            recB = new Float64Array(N); for (let i = 0; i < N; i++) recB[i] = rtB[i*2] - recA[i];   // isolate B
            modeTag = 'TEMPORAL (time-phased)';
          }
          selfA = corrR(recA, M.imgA); selfB = corrR(recB, M.imgB);
          const peak = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return Math.max(m, 1e-9); };
          const paintReal = (cell, field, label) => { const cx = new Float64Array(field.length * 2); for (let i = 0; i < field.length; i++) cx[i*2] = field[i]; let m = 0; for (let i = 0; i < field.length; i++) m = Math.max(m, field[i]*field[i]); _gpu.setEyePsi(cx); _gpu.renderEyeField(Math.max(m, 1e-9)); cell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH); cell.setLabel(label); };
          // DOM order L→R: Field | Percept | Evid | Img → image A | recovered A | recovered B | image B
          paintReal(eyeFieldCell, M.imgA, `⟳ MEDIA ${modeTag} — ① image A (truth)`);
          paintReal(eyePerceptCell, recA, `② recovered A   self-fid=${selfA.toFixed(3)}`);
          paintReal(eyeEvidCell, recB, `③ recovered B   self-fid=${selfB.toFixed(3)}`);
          paintReal(eyeImgCell, M.imgB, `④ image B (truth)  [${modeTag}]`);
          if ((cyc & 31) === 0) console.log(`[CYCLE media] ${modeTag} — self-fidelity A=${selfA.toFixed(3)} B=${selfB.toFixed(3)} (carrier≈0.82 dense / temporal≈1.0)`);
        }
      } else if (_eyeShowClockMel && _gpuReady && _eye) {
        // ── CLOCK MELODY (§7.21) — the COMPLEMENT of SOLITON. The note is a PURE FUNCTION of the
        // shared clock: note = rollMelody(floor(cyc/nBins))[cyc%nBins]. NOT recovered from any field →
        // no occlusion dependence, no warm-up, no drift: every peer (incl. late joiners) plays the SAME
        // note at the SAME cycle = perfect unison. This is the "clock IS the score" demonstration; it
        // sits alongside SOLITON (which proves the sound survives field masking). Standalone benefit. ──
        const cyc = n.cycleCount ?? 0;
        const barIdxNow = Math.floor(cyc / _eyeRollBins);
        // ONE NOTE PER CYCLE — the u11 "synced & straight" behaviour. The note for cycle c is exactly
        // noteAtCycle(c); each new clock tick fires exactly one note on the audio cursor. The RHYTHM
        // IS THE CLOCK (no measured/guessed bar span → no tempo jitter). _eyeClockMelLastCyc here is
        // repurposed to track the last CYCLE played (not bar) so we fire once per cycle.
        const noteAtCycle = (c) => {
          const m = _rollMelody(Math.floor(c / _eyeRollBins));
          const onset = ((c % _eyeRollBins) + _eyeRollBins) % _eyeRollBins;
          return m.find(a => a.bin === onset) || null;
        };
        if (_eyeClockMelLastCyc < 0) _eyeClockMelLastCyc = cyc - 1;   // (now holds last CYCLE, not bar)
        if (_eyeSoundPlay && _eyeAudioCtx && cyc > _eyeClockMelLastCyc) {
          let due = Math.min(8, cyc - _eyeClockMelLastCyc);          // bounded catch-up
          for (let k = cyc - due + 1; k <= cyc; k++) {
            const note = noteAtCycle(k);
            if (note) {
              const at = Math.max(_eyeAudioCtx.currentTime + 0.05, _eyeSeqCursor);
              _playRoll([note], _EYE_ROLL_TIERS, _eyeSeqBarSecs || 1.0, at);
              _eyeSeqCursor = at + 0.02;                             // advance cursor one tick (u11)
            }
          }
          _eyeClockMelLastCyc = cyc;
        }
        // panels: draw the CLOCK-TRUTH melody (the formula), not a field readout — always exact.
        const mel = _rollMelody(barIdxNow);
        const lit = new Set(mel.map(a => a.tier + ':' + a.bin));
        { const ctx = eyePerceptCell.ctx, W=RW, H=RH; ctx.fillStyle='#111'; ctx.fillRect(0,0,W,H);
          const mx=8,my=18,gw=(W-2*mx)/_eyeRollBins,gh=(H-my-8)/_EYE_ROLL_TIERS;
          for(let t=0;t<_EYE_ROLL_TIERS;t++)for(let b=0;b<_eyeRollBins;b++){const x=mx+b*gw,y=my+(_EYE_ROLL_TIERS-1-t)*gh;ctx.strokeStyle='#333';ctx.strokeRect(x+1,y+1,gw-2,gh-2);if(lit.has(t+':'+b)){ctx.fillStyle='#8df';ctx.fillRect(x+2,y+2,gw-4,gh-4);}}
          eyePerceptCell.setLabel(`CLOCK-MEL  bar ${barIdxNow}  (note = clock formula, peer-exact)`); }
        { const ctx = eyeEvidCell.ctx; ctx.fillStyle='#111'; ctx.fillRect(0,0,RW,RH);
          const my=18, gw=(RW-16)/_eyeRollBins, gh=(RH-my-8)/_EYE_ROLL_TIERS;
          for (const a of mel) { const x=8+a.bin*gw, y=my+(_EYE_ROLL_TIERS-1-a.tier)*gh; ctx.fillStyle='#8df'; ctx.fillRect(x+2,y+2,gw-4,gh-4); }
          eyeEvidCell.setLabel(`CLOCK PIANO ROLL  ${mel.length} notes (from clock, occl-independent)`); }
        // field-image panel: just show the live soliton field if present, else clear (this mode is sound-first)
        { const ctx = eyeFieldCell.ctx; ctx.fillStyle='#061018'; ctx.fillRect(0,0,RW,RH);
          eyeFieldCell.setLabel(`CLOCK-MEL  melody from the shared clock — perfect peer-sync, no field`); }
      } else if (_eyeShowSeq && _gpuReady && _eye) {
        // HOLOGRAPHIC SAMPLER/SEQUENCER (§7.12). ONE field, two SEPARATED payloads: a waveform
        // VOICE (left region) + an event SEQUENCE (right region), both recovered from one sweep.
        // The recovered events transport/trigger the recovered voice. Panel 1 = recovered voice
        // waveform, panel 2 = recovered sequence grid + f1 + voice-fidelity, panel 3 = field.
        // ── AUDIO SCHEDULING RUNS FIRST, before the (possibly heavy) recompute. ──────────
        // The bar plays from the PREVIOUS recompute's _eyeSeqLast, so a stally recompute frame
        // (e.g. high T) can't delay the beat. Measuring the bar span before the recompute also
        // keeps the stall out of the span measurement (was contaminating tempo on T change).
        if (_eyeSoundPlay && _eyeSeqLast && _eyeAudioCtx) {
          const cyc = n.cycleCount ?? 0, nowMs = performance.now();
          const audioNow = _eyeAudioCtx.currentTime;
          const barIndex = Math.floor(cyc / _EYE_SEQ_BAR_CYCLES);   // phase-absolute (peer-synced)
          if (_eyeSeqLastBar < 0) _eyeSeqLastBar = barIndex - 1;
          if (barIndex > _eyeSeqLastBar) {
            const bars = barIndex - _eyeSeqLastBar;
            if (_eyeSeqLastBarMs > 0) {
              const span = Math.max(0.3, Math.min(6, (nowMs - _eyeSeqLastBarMs) / 1000 / bars));
              _eyeSeqBarSecs = _eyeSeqBarSecs > 0 ? (_eyeSeqBarSecs * 0.6 + span * 0.4) : span;
            }
            _eyeSeqLastBar = barIndex; _eyeSeqLastBarMs = nowMs;
            if (_eyeSeqBarSecs > 0) {
              // Audio cursor places the onset (no RAF jitter). It must sit a small, CONSTANT lead
              // ahead of real time. Two corrections: (1) hard resync on a genuine fault (cursor in
              // the past = stall, or > a full bar ahead = runaway); (2) otherwise a GENTLE pull
              // toward a fixed target lead — 5% per bar, so excess latency (it had parked at
              // ~500ms) bleeds off smoothly over many bars (~20ms/bar, inaudible) and settles at
              // the target, instead of either snapping (narrow clamp) or parking late (wide clamp).
              const TARGET = 0.12;   // desired constant lead (s)
              if (_eyeSeqCursor <= 0) _eyeSeqCursor = audioNow + TARGET;
              const lead = _eyeSeqCursor - audioNow;
              if (lead < 0.02 || lead > _eyeSeqBarSecs + 0.25) _eyeSeqCursor = audioNow + TARGET;  // fault
              else _eyeSeqCursor -= (lead - TARGET) * 0.05;                                         // gentle pull
              const startT = _eyeSeqCursor;
              _playSamplerAt(_eyeSeqLast.voiceOut, _eyeSeqLast.schedule, _eyeSeqLast.nBins, _eyeSeqBarSecs, startT);
              _eyeSeqCursor += _eyeSeqBarSecs;
              if (_eyeSeqLogN === undefined) _eyeSeqLogN = 0;
              if (_eyeSeqLogN++ < 30) {
                const onsetGap = _eyeSeqDiagLastStart > 0 ? (startT - _eyeSeqDiagLastStart) : 0;
                console.log(`[SEQ DIAG] bar ${barIndex}  onsetGap ${(onsetGap*1000).toFixed(0)}ms  span ${(_eyeSeqBarSecs*1000).toFixed(0)}ms  lead ${((startT-audioNow)*1000).toFixed(0)}ms  bars ${bars}${bars>1?' ← SKIP':''}`);
              }
              _eyeSeqDiagLastStart = startT;
            }
          }
        }
        // RECOMPUTE only when params changed (the expensive GPU round-trip). Stores the result
        // in _eyeSeqLast; the playback loop above runs continuously off that, so sliders
        // *influence* the running loop rather than *triggering* the sound.
        if (_eyeSeqDirty || !_eyeSeqLast) {
          const peak = (a) => { let m=0; for (let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v;} return Math.max(m,1e-12); };
          const occ = (_eye.hMode === 6 || _eye.hMode === 7 || _eye.hMode === 8) ? _eye.hParam : 0;
          const nTiers = 4, nBins = 4;
          const voice = _buildSeqVoice();
          // snd= slider → voice LAYERS (rows averaged): snd 0 = 1 row (DRY voice, T-independent),
          // up = more rows = more 2D inter-row mixing folded in = LAYERED timbre. T stays = depth.
          const voiceRows = 1 + Math.round((_eyeSndAmp / 3) * (GRID / 2 - 1));
          const r = _eye.holographicSampler(voice, _seqEvents(),
            { nTiers, nBins, band: 0.7, occludeR: occ, barSecs: 2.0, voiceRows, hBlock: _eye.hBlock });
          _eyeSeqLast = r;                          // ← the loop plays/draws THIS
          // Panel 1 — recovered VOICE waveform (the instrument, restored from the left region)
          (() => {
            const ctx = eyeFieldCell.ctx; ctx.fillStyle = '#111'; ctx.fillRect(0,0,RW,RH);
            ctx.strokeStyle = '#6cf'; ctx.lineWidth = 1; ctx.beginPath();
            const w = r.voiceOut, n = w.length;
            for (let px = 0; px < RW; px++) { const i = Math.min(n-1, Math.floor(px/RW*n)); const y = RH*0.5 - w[i]*RH*0.42; px===0?ctx.moveTo(px,y):ctx.lineTo(px,y); }
            ctx.stroke();
            eyeFieldCell.setLabel(`EYE  recovered VOICE  fid=${r.voiceScore.toFixed(2)}  ${voiceRows===1?'dry':voiceRows+' layers'}${occ>0?` occl ${occ.toFixed(2)}`:''}`);
          })();
          // Panel 2 — recovered SEQUENCE grid (tier × bin) + f1
          (() => {
            const ctx = eyePerceptCell.ctx, W=RW, H=RH; ctx.fillStyle='#111'; ctx.fillRect(0,0,W,H);
            const mx=8,my=18,gw=(W-2*mx)/nBins,gh=(H-my-8)/nTiers;
            const lit=new Set(r.recovered.map(e=>e.tier+':'+e.bin));
            for(let t=0;t<nTiers;t++)for(let b=0;b<nBins;b++){const x=mx+b*gw,y=my+t*gh;ctx.strokeStyle='#333';ctx.strokeRect(x+1,y+1,gw-2,gh-2);if(lit.has(t+':'+b)){ctx.fillStyle=occ>0?'#fa4':'#4f8';ctx.fillRect(x+2,y+2,gw-4,gh-4);}}
            eyePerceptCell.setLabel(`SEQUENCE  f1=${r.f1.toFixed(2)} (voice×pattern, one field)`);
          })();
          // Panel 3 — the combined hologram field (both payloads, delocalized)
          _gpu.setEyePsi(r.holo); _gpu.renderEyeField(peak(r.holo));
          eyeEvidCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeEvidCell.setLabel('EYE  |ψ|²  voice+sequence field');
          // (Audio verified T-INDEPENDENT: recovered voice tailE/fid/event-count all flat across
          //  T=76→500 — holography does not change the sound. Any "high-T layering" was the old
          //  phantom-event bug, now fixed by the global-floor detector. Diagnostics removed.)
          _eyeSeqDirty = false;
        }
      } else if (_eyeShowBeat && _gpuReady && _eye) {
        // THE UNIFIED FIELD (§7.10). ONE substrate = the captured fresnelBeat events, encoded
        // once (biased to FINE ONSETS: redundant impulses, sparse bins). An image rides the
        // SAME staged forward. From ONE reconstruction, indexed by τ, we read all three faces:
        //   Panel 1 = IMAGE depth-slice at τ (spatial face)
        //   Panel 2 = RECOVERED groove grid (discrete face) + f1
        //   Panel 3 = derived WAVEFORM (continuous face) — the envelope of the same impulses
        // ♪ SOUND plays the recovered groove as drums; occlude → holes (structure-gated).
        // MELODY mode carries our AUTHORED tune (always ready); BEAT mode needs ≥2 captured beats.
        const beatReady = _eyeMelodyMode ? true : _eyeBeatCapture.length >= 2;
        if (_eyeBeatDirty && beatReady) {
          const peak = (a) => { let m=0; for (let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v;} return Math.max(m,1e-12); };
          const occ = (_eye.hMode === 6 || _eye.hMode === 7 || _eye.hMode === 8) ? _eye.hParam : 0;
          // MELODY: 6 pitch levels × 8 time steps, time = step (timeKey 'wt'). Our content.
          // BEAT: the clock's own motif, 4 tiers × 4 bins, time = ring delay.
          const events = _eyeMelodyMode ? _buildMelodyEvents() : _eyeBeatCapture;
          const nTiers = _eyeMelodyMode ? _melodyScale.length : 4;
          const nBins  = _eyeMelodyMode ? _melodyNotes.length : 4;
          const tKey   = _eyeMelodyMode ? 'wt' : 'delay';
          const imgField = _buildSrcFieldIFS(0, 0, [], 'depthmap');   // image rides the same field
          const r = _eye.unifiedField(events, _eyeTau,
            { nTiers, nBins, band: 0.7, occludeR: occ, imgField, redund: true, timeKey: tKey, hBlock: _eye.hBlock });
          // groove grid drawer (discrete face)
          const drawGrid = (cell, set, title, color) => {
            const ctx = cell.ctx, W = RW, H = RH;
            ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
            const mx = 8, my = 18, gw = (W - 2*mx) / nBins, gh = (H - my - 8) / nTiers;
            const lit = new Set(set.map(e => e.tier + ':' + e.bin));
            const names = ['kick','snare','hat','clave'];
            for (let t = 0; t < nTiers; t++) for (let b = 0; b < nBins; b++) {
              const x = mx + b*gw, y = my + t*gh;
              ctx.strokeStyle = '#333'; ctx.strokeRect(x+1, y+1, gw-2, gh-2);
              if (lit.has(t + ':' + b)) { ctx.fillStyle = color; ctx.fillRect(x+2, y+2, gw-4, gh-4); }
            }
            ctx.fillStyle = '#aaa'; ctx.font = '10px monospace';
            for (let t = 0; t < nTiers; t++) ctx.fillText(names[t], 1, my + t*gh + gh*0.6);
            cell.setLabel(title);
          };
          // Panel 1 — IMAGE depth-slice at τ (spatial face of the unified field)
          _gpu.setEyePsi(r.viewTau); _gpu.renderEyeField(peak(r.viewTau));
          eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeFieldCell.setLabel(`EYE  |ψ(τ)|²  image face  τ=${_eyeTau.toFixed(2)}${occ>0?` occl ${occ.toFixed(2)}`:''}`);
          // Panel 2 — RECOVERED pattern (discrete face) + f1. In MELODY mode this grid IS the
          // tune (pitch=row, time=col): you SEE our melody, holes where occlusion dropped notes.
          drawGrid(eyePerceptCell, r.recovered, _eyeMelodyMode
            ? `RECOVERED melody  f1=${r.f1.toFixed(2)} (notes ${r.recovered.length}/${r.trueSet.length})`
            : `RECOVERED motif  f1=${r.f1.toFixed(2)} (${r.trueSet.length}/${_eyeBeatCapture.length}ev)`,
            occ>0?'#fa4':'#4f8');
          // Panel 3 — derived FINE WAVEFORM (continuous face) — a full audio-rate buffer
          // SYNTHESIZED from the recovered events (each beat = damped sinusoid at its ring-pitch).
          // Same atoms as the groove → a true PLAYABLE waveform, not just an envelope.
          (() => {
            const ctx = eyeEvidCell.ctx; ctx.fillStyle = '#111'; ctx.fillRect(0,0,RW,RH);
            ctx.strokeStyle = '#fa6'; ctx.lineWidth = 1; ctx.beginPath();
            const w = r.audioWave; const n = w.length;
            for (let px = 0; px < RW; px++) {
              const i = Math.min(n-1, Math.floor(px / RW * n));
              const y = RH*0.5 - w[i] * RH*0.45;
              px===0 ? ctx.moveTo(px,y) : ctx.lineTo(px,y);
            }
            ctx.stroke();
            eyeEvidCell.setLabel('EYE  derived WAVEFORM (synth from recovered events)');
          })();
          // ♪ play the recovered groove, gated on the PHASE-ABSOLUTE bar grid (same shared
          // cycleCount boundaries as SEQ) so all peers loop IN PHASE regardless of join time —
          // not a per-peer wall-clock interval (that was the sync bug).
          if (_eyeSoundPlay && _eyeAudioCtx) {
            const cyc = n.cycleCount ?? 0, audioNow = _eyeAudioCtx.currentTime, nowMs = performance.now();
            const barIndex = Math.floor(cyc / _EYE_SEQ_BAR_CYCLES);
            if (_eyeBeatLastBar < 0) _eyeBeatLastBar = barIndex - 1;
            if (barIndex > _eyeBeatLastBar) {
              const bars = barIndex - _eyeBeatLastBar;
              if (_eyeBeatLastBarMs > 0) {
                const span = Math.max(0.3, Math.min(6, (nowMs - _eyeBeatLastBarMs) / 1000 / bars));
                _eyeSeqBarSecs = _eyeSeqBarSecs > 0 ? (_eyeSeqBarSecs * 0.5 + span * 0.5) : span;  // lazy-init
              }
              _eyeBeatLastBar = barIndex; _eyeBeatLastBarMs = nowMs;
              if (_eyeSeqBarSecs > 0) {                               // need one measured bar first
                const startT = _barAnchor(audioNow);                  // clock crossing = timing authority
                if (_eyeMelodyMode) _playMelody(r.recovered, nBins, _eyeSeqBarSecs, startT);  // OUR recovered tune
                else _playAudioBuffer(r.audioWave, _eyeSeqBarSecs, startT);                    // the clock's waveform
              }
            }
          }
          const tag = _eyeMelodyMode ? 'MELODY (carried)' : 'one field, 3 faces';
          console.log(`[EYE UNIFIED] ${r.trueSet.length} events  f1=${r.f1.toFixed(3)} onset=${r.onsetScore.toFixed(2)} tier=${r.tierScore.toFixed(2)}  τ=${_eyeTau.toFixed(2)} occl=${occ.toFixed(2)} — ${tag}`);
          _eyeBeatDirty = false;
        } else if (_eyeBeatCapture.length < 2) {
          eyeFieldCell.setLabel('EYE  BEAT — rotate / dblclick to capture beats…');
        }
      } else if (_eyeShowClock && _gpuReady && _eye) {
        // CLOCK-MODULATED "no tricks" multimedia. The sound is the LIVE IFS heartbeat; it
        // modulates the per-step dt of the same evolution carrying the image. No spatial
        // carrier, no depth slot — sound lives in the clock. Panel 1 = clock-modulated
        // hologram, 2 = refocused image (exact), 3 = recovered heartbeat (phase-rate demod).
        if (_eyeClockDirty) {
          const peak = (a) => { let m=0; for (let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v;} return Math.max(m,1e-12); };
          // DEPTH scene = the same staged layers EXPLORE uses (so panels 2/3 are real focused
          // depth slices, not a flat plane). MAP = continuous-depth bins, 3D = 4 structured.
          const useMap = (n.shape ?? 'cube') === 'depthmap';
          const layers = useMap
            ? (_eyeDepthMap   ?? (_eyeDepthMap   = _buildDepthMapLayers()))
            : (_eyeDepthLayers ?? (_eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS)));
          // ordered heartbeat history (oldest → newest), de-meaned = the sound source s_i
          const beat = new Float64Array(_eyeBeatHistLen);
          for (let i = 0; i < _eyeBeatHistLen; i++) beat[i] = _eyeBeatHist[(_eyeBeatHead + i) % _eyeBeatHistLen];
          let mean = 0; for (let i = 0; i < beat.length; i++) mean += beat[i]; mean /= beat.length;
          for (let i = 0; i < beat.length; i++) beat[i] -= mean;
          const occ = (_eye.hMode === 6 || _eye.hMode === 7 || _eye.hMode === 8) ? _eye.hParam : 0;
          // CLOCK-modulated DEPTH scrub at the current τ (heartbeat modulates dt of the SAME
          // staged depth evolution). Sound is recovered by phase-rate demod from the backward
          // leg — no carrier, no depth slot. Panel 2 = depth focus at τ, panel 3 = neighbor τ.
          const r  = _eye.clockDepthScrub(layers, beat, _eyeTau, 0.25, useMap);
          const r2 = _eye.clockDepthScrub(layers, beat, Math.max(0, _eyeTau - 0.2), 0.25, useMap);
          // Panel 1 — clock-modulated depth hologram
          _gpu.setEyePsi(r.holo); _gpu.renderEyeField(peak(r.holo));
          eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeFieldCell.setLabel(`EYE  |ψ|²  CLOCK depth-hologram (heartbeat→dt)${occ>0?` occl ${occ.toFixed(2)}`:''}`);
          // Panel 2 — focused depth slice at τ
          _gpu.setEyePsi(r.view); _gpu.renderEyeField(peak(r.view));
          eyePerceptCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyePerceptCell.setLabel(`EYE  |ψ(τ)|²  depth focus  τ=${_eyeTau.toFixed(2)}`);
          // Panel 3 — neighbor depth slice (depth-of-field shift) + recovered heartbeat overlay
          _gpu.setEyePsi(r2.view); _gpu.renderEyeField(peak(r2.view));
          eyeEvidCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          _drawWaveform(eyeEvidCell.ctx, r.sRec, RW, RH);   // the recovered heartbeat strip
          eyeEvidCell.setLabel(`EYE  |ψ(τ')|²  depth + HEARTBEAT  τ'=${Math.max(0,_eyeTau-0.2).toFixed(2)}`);
          // (Audio is the LIVE RHYTHM — fired per-frame in the heartbeat capture block, not a
          //  one-shot blip here — so you hear the clock's groove, not a buzz.)
          console.log(`[EYE CLOCK] depth+heartbeat (heartbeat→dt) at τ=${_eyeTau.toFixed(2)} — no carrier, no depth slot`);
          _eyeClockDirty = false;
        }
      } else if (_eyeShowMM && _gpuReady && _eye) {
        // COMBINED-FIELD multimedia: image + sound in ONE field, holographed together,
        // split back. Panel 1 = combined hologram, 2 = recovered image, 3 = recovered sound.
        if (_eyeMMDirty) {
          if (!_eyeSound) _eyeSound = _buildSoundHologram();
          // image = the depth-map summed field (a structured 2D scene); sound = the bursts.
          const imgField = _buildSrcFieldIFS(0, 0, [], 'depthmap');
          const sndSamples = _eyeSound._src ? (() => { const M = _eyeSound._N, w = new Float64Array(M); for (let i=0;i<M;i++) w[i] = _eyeSound._src[i*2]; return w; })() : new Float64Array(GRID*GRID);
          const occ = (_eye.hMode === 6 || _eye.hMode === 7 || _eye.hMode === 8) ? _eye.hParam : 0;
          const r = _eye.multimediaRoundTrip(imgField, sndSamples, GRID,
            { carrierKx: 1.7, sndAmp: _eyeSndAmp, hMode: _eye.hMode, hParam: _eye.hParam, hBlock: _eye.hBlock });
          const peak = (a) => { let m=0; for (let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v;} return Math.max(m,1e-12); };
          // Panel 1 — combined hologram
          _gpu.setEyePsi(r.holo); _gpu.renderEyeField(peak(r.holo));
          eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeFieldCell.setLabel(`EYE  |Ψ|²  COMBINED hologram (img+snd)${occ>0?` occl ${occ.toFixed(2)}`:''}`);
          // Panel 2 — recovered image
          _gpu.setEyePsi(r.recon); _gpu.renderEyeField(peak(r.recon));
          eyePerceptCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyePerceptCell.setLabel(`EYE  recovered IMAGE  score=${r.imgScore.toFixed(3)}`);
          // Panel 3 — recovered sound waveform
          _gpu.setEyePsi(r.recon); _gpu.renderEyeField(peak(r.recon));   // faint bg
          eyeEvidCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          _drawWaveform(eyeEvidCell.ctx, r.sndRec, RW, RH);
          eyeEvidCell.setLabel(`EYE  recovered SOUND  score=${r.sndScore.toFixed(3)}`);
          // Sonify the SOUND recovered FROM THE COMBINED FIELD (♪ SOUND on) — you hear the
          // audio that was multiplexed into the same wavefront as the image.
          if (_eyeSoundPlay) _playWaveform(r.sndRec);
          console.log(`[EYE MM] combined-field separation — image=${r.imgScore.toFixed(3)}  sound=${r.sndScore.toFixed(3)} (cross-talk = 1−score)`);
          _eyeMMDirty = false;
        }
      } else if (_eyeShowExplore && _gpuReady && _eye) {
        // DEPTH-SCRUB EXPLORER — depth = IFS evolution clock τ. Panel 1 = scene hologram,
        // panel 2 = the depth view at the current τ (the moving observation point), panel
        // 3 = a neighboring τ (shallower) to show the depth-of-field difference.
        if (_eyeExploreDirty) {
          const peak = (a) => { let m=0; for (let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v;} return Math.max(m,1e-12); };
          // Scene = CONTINUOUS depth-map (◈ MAP shape) → native phase-depth wavefront, OR
          // staged depth LAYERS (◈ 3D). The map gives smooth continuous depth; layers give
          // 4 discrete depths. Pick the scrub function accordingly.
          const useMap = (n.shape ?? 'cube') === 'depthmap';
          // Both go through the SAME staged depthScrub(layers, τ) — the τ-genuine depth path.
          // MAP = finely-binned continuous-depth layers; 3D = 4 structured layers.
          const imgLayers = useMap
            ? (_eyeDepthMap   ?? (_eyeDepthMap   = _buildDepthMapLayers()))
            : (_eyeDepthLayers ?? (_eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS)));
          // CONVERGED multimedia: when ♪ SOUND is on, multiplex the carrier-tagged sound
          // INTO the depth layers (one combined wavefront), so τ-scrub recovers focused
          // depth image AND sound from the SAME field — depth + sound + shared τ unified.
          let sceneLayers = imgLayers, mmSetup = null;
          if (_eyeSoundPlay) {
            if (!_eyeSound) _eyeSound = _buildSoundHologram();
            const snd = (() => { const M=_eyeSound._N, w=new Float64Array(M); for (let i=0;i<M;i++) w[i]=_eyeSound._src[i*2]; return w; })();
            mmSetup = _eye.depthScrubMMSetup(imgLayers, snd, GRID, { carrierKx: 1.7, sndAmp: _eyeSndAmp, sndDepth: 0.5 });
            sceneLayers = mmSetup.combined;
          }
          // MAP = shallow band (object present at all τ, focus sweeps depth — true DoF).
          // 3D = deep layers (τ sweeps the full reconstruction range across 4 planes).
          const scrub = (t) => _eye.depthScrub(sceneLayers, t, useMap);
          const kind = (useMap ? `continuous (${imgLayers.length} bins)` : 'layered') + (mmSetup ? ' +snd' : '');
          const occ = (_eye.hMode === 6 || _eye.hMode === 7 || _eye.hMode === 8) ? _eye.hParam : 0;
          // Panel 1 — the MASKED scene hologram itself (no back-scrub), so occlusion holes
          // are visible — the mask you apply here is what panels 2-3 reconstruct THROUGH.
          const holo = _eye.depthHologram(sceneLayers, useMap);  // combined (img[+snd]) hologram
          _gpu.setEyePsi(holo); _gpu.renderEyeField(peak(holo));
          eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeFieldCell.setLabel(occ > 0
            ? `EYE  |ψ_holo|²  ${mmSetup?'combined ':''}hologram (${kind}, occl ${occ.toFixed(2)})`
            : `EYE  |ψ_holo|²  ${mmSetup?'combined ':''}scene hologram (${kind})`);
          // Panel 2 — depth view at current τ (the observation point)
          const viewT = scrub(_eyeTau);
          _gpu.setEyePsi(viewT); _gpu.renderEyeField(peak(viewT));
          eyePerceptCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyePerceptCell.setLabel(`EYE  |ψ(τ)|²  depth focus  τ=${_eyeTau.toFixed(2)}`);
          // Panel 3 — a neighboring depth (τ - 0.2) → shows the depth-of-field shift
          const tau2 = Math.max(0, _eyeTau - 0.2);
          const viewN = scrub(tau2);
          _gpu.setEyePsi(viewN); _gpu.renderEyeField(peak(viewN));
          eyeEvidCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeEvidCell.setLabel(`EYE  |ψ(τ')|²  neighbor depth  τ'=${tau2.toFixed(2)}`);

          // ── MULTIMEDIA SOUND, recovered at the SAME τ. ──────────────────────────
          // When ♪ SOUND is on, the sound was multiplexed INTO the combined depth field —
          // so we demodulate it straight from viewT (the depth reconstruction at τ): one
          // wavefront, one τ, both image-depth and sound. Otherwise nothing to draw.
          if (_eyeSoundPlay && mmSetup) {
            const wave = _eye.splitSound(viewT, GRID, mmSetup.kx, mmSetup.M);
            _drawWaveform(eyeEvidCell.ctx, wave, RW, RH);   // overlay on panel 3
            _playWaveform(wave);
            eyePerceptCell.setLabel(`EYE  |ψ(τ)|²  depth+SOUND  τ=${_eyeTau.toFixed(2)}`);
          }
          _eyeExploreDirty = false;
        }
      } else if (_eyeShowSlices && _gpuReady && _eye) {
        // SLICES — per-layer refocused depth slices. Panel 1 = hologram; panels 2,3 =
        // the current layer pair refocused at their own depths. Recompute on dirty
        // (entry, pair change, occlusion) — hold otherwise.
        if (_eyeSlicesDirty) {
          if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS);
          const { slices, scores, holo } = _eye.reconstructDepthSlices(_eyeDepthLayers,
            (_eye.hMode === 6 || _eye.hMode === 7 || _eye.hMode === 8) ? _eye.hParam : 0);
          const peak = (a) => { let m=0; for (let j=0;j<a.length>>1;j++){const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v;} return Math.max(m,1e-12); };
          const names = ['disc','ring','cross','frame'];
          // panel 1 = hologram
          _gpu.setEyePsi(holo); _gpu.renderEyeField(peak(holo));
          eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeFieldCell.setLabel('EYE  |ψ_holo|²  3D hologram');
          // panels 2,3 = the current layer pair
          const dA = (_eyeSlicePair * 2) % N_DEPTH_TIERS;
          const dB = (dA + 1) % N_DEPTH_TIERS;
          [[eyePerceptCell, dA], [eyeEvidCell, dB]].forEach(([cell, d]) => {
            _gpu.setEyePsi(slices[d]); _gpu.renderEyeField(peak(slices[d]));
            cell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
            cell.setLabel(`EYE  layer ${d} (${names[d] ?? d}) refocus  score=${scores[d].toFixed(3)}`);
          });
          _eyeSlicesDirty = false;
        }
      } else if (_eyeShowDepth && _gpuReady && _eye) {
        // 3D-HOLO mode — render the multi-depth staged hologram + reconstruction.
        // Recompute only when dirty (entry or occlusion change); hold otherwise.
        if (_eyeDepthDirty) {
          if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS);
          _eye.computeDepth(_eyeDepthLayers, _gpuCanvas, eyeFieldCell, eyePerceptCell, eyeEvidCell, RW, RH);
          _eyeDepthDirty = false;
        }
      } else if (_eyeShowLoaded && _gpuReady && _eye?._evidence) {
        // PLAYER mode — render full three-panel pipeline from loaded evidence
        // Only recompute once; hold the result until LIVE clears the flag
        if (_eyeLoadedDirty) {
          _eye.renderLoaded(_gpuCanvas, eyeFieldCell, eyePerceptCell, eyeEvidCell, RW, RH);
          _eyeLoadedDirty = false;
        }
      } else if (_liveMode && _gpuReady && _eye && _localObjField) {
        // LIVE mode — reconstruct from live object stream.
        // 'depth3d' shape → feed the multi-depth layered source (staged injection in
        // compute), so the LIVE eye renders the depth hologram and ALL sliders update it
        // continuously — no need to click ⊙ 3D-HOLO. Flat shapes → normal single source.
        if ((n.shape ?? 'cube') === 'depth3d') {
          if (!_eyeDepthLayers) _eyeDepthLayers = _buildDepthLayers(N_DEPTH_TIERS);
          _eye.setLayers(_eyeDepthLayers);
        } else {
          _eye.setSource(_localObjField);
        }
        _eye.compute(
          _gpuCanvas,
          eyeFieldCell, eyePerceptCell, eyeEvidCell,
          RW, RH
        );
        if (_eye.probe) _eye.probe = false;
      }

      // ── IFS clock + title ───────────────────────────────────────────────
      const isRec    = (n.direction ?? 1) === 1;
      const isActive = !!(n.slotActive_A || n.slotActive_B);
      const lt       = world.ps.app.logicalTime ?? 0;
      clockTitle.style.color = isRec ? '#9c4' : '#4af';
      clockTitle.textContent =
        `EYE  s≈${(n.ifsSEff ?? 0).toFixed(3)}  ` +
        (n.slotActive_A ? '[A]' : '') + (n.slotActive_B ? '[B]' : '');
      const energyA      = n.slotEnergy_A ?? [], energyB = n.slotEnergy_B ?? [];
      const mergedEnergy = energyA.map((v, i) => Math.max(v, energyB[i] ?? 0));
      const mergedEvents = [...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])]
        .sort((a, b) => a.wt - b.wt).slice(-80);
      ifsClock.update({ energy: mergedEnergy, events: mergedEvents, isActive, lt });

      // ── Button UI ────────────────────────────────────────────────────────
      btnLive.textContent      = _liveMode ? '⟳ LIVE on' : '⟳ LIVE';
      btnLive.style.background = _liveMode ? '#4a2'      : '#363';
      btnLive.style.color      = _liveMode ? '#fff'      : '#af8';
      btnLive.style.outline    = _liveMode ? '1px solid #af8' : 'none';
      btnPlayer.textContent      = _eyeShowLoaded ? '▶ PLAYER on' : '▶ PLAYER';
      btnPlayer.style.background = _eyeShowLoaded ? '#642'        : '#333';
      btnPlayer.style.color      = _eyeShowLoaded ? '#fa8'        : '#888';
      btnPlayer.style.outline    = _eyeShowLoaded ? '1px solid #fa8' : 'none';
      eyeRow.style.display       = (_liveMode || _eyeShowLoaded || _eyeShowDepth || _eyeShowSlices || _eyeShowExplore || _eyeShowMM || _eyeShowClock || _eyeShowBeat || _eyeShowSeq || _eyeShowUnited) ? 'flex' : 'none';

      _localStepCount++;
    };

    // RAF loop — drives continuous animation (makeView fires on world ticks only)
    let _rafId = null, _lastRenderMs = 0;
    const RENDER_INTERVAL_MS = 33;
    const _rafLoop = (ts) => {
      _rafId = requestAnimationFrame(_rafLoop);
      if (ts - _lastRenderMs < RENDER_INTERVAL_MS) return;
      _lastRenderMs = ts;
      _renderFrame();
    };
    _rafId = requestAnimationFrame(_rafLoop);

    return _renderFrame;
  };
}

export default {
  title:       'Eye | IFS Live Holographic Observer',
  selo:        'hologram4',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologramWorldProgram + av],
  makeRenderer: makeEyeRenderer,
  wrapId:      'eye-wrap',
  hideTopBar:  true,
};
