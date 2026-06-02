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
import { IFSEye } from '../holography.js';
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
    eyeRow.appendChild(eyeFieldCell.wrap);
    eyeRow.appendChild(eyePerceptCell.wrap);
    eyeRow.appendChild(eyeEvidCell.wrap);

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
    const btnLive = mkBtn('⟳ LIVE', '#363', '#af8', () => { _eyeShowLoaded = false; injectEvent?.({ type: 'setLiveMode' }); });

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
    hParamSlider.addEventListener('input', () =>
      injectEvent?.({ type: 'setEyeH', hParam: parseFloat(hParamSlider.value) }));
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
      _eye.download('eye_hologram.kwe', { angleY: n?.angleY, angleX: n?.angleX, shape: n?.shape ?? 'cube' });
    });
    btnSave.title = 'Save eye evidence + params to .kwe';

    const btnLoad = mkBtn('📂 LOAD', '#234', '#fa8', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.kwe,.ifsh,.bin';
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        if (!_eye) return;
        const rawBuf = await file.arrayBuffer();
        const buf    = await IFSEye.decompress(rawBuf);
        const meta   = _eye.load(buf);
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
    controlBar.appendChild(btnRings);
    controlBar.appendChild(tWrap);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(hModeRow);
    controlBar.appendChild(hParamWrap);
    controlBar.appendChild(hBlockWrap);
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

    const _buildSrcFieldIFS = (angleY, angleX, extraPoints, shape = 'cube') => {
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
        if (_eye.hMode  !== eyeHMode)  { _eye.hMode  = eyeHMode;  _eye.dirty = true; }
        if (_eye.hParam !== eyeHParam) { _eye.hParam = eyeHParam; if (eyeHMode !== 0) _eye.dirty = true; }
        if (_eye.hBlock !== eyeHBlock) { _eye.hBlock = eyeHBlock; if (eyeHMode >= 7) _eye.dirty = true; }
        if (_eye.tSteps !== eyeTSteps) { _eye.tSteps = eyeTSteps; _eye.dirty = true; }
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
      if (_eyeShowLoaded && _gpuReady && _eye?._evidence) {
        // PLAYER mode — render full three-panel pipeline from loaded evidence
        // Only recompute once; hold the result until LIVE clears the flag
        if (_eyeLoadedDirty) {
          _eye.renderLoaded(_gpuCanvas, eyeFieldCell, eyePerceptCell, eyeEvidCell, RW, RH);
          _eyeLoadedDirty = false;
        }
      } else if (_liveMode && _gpuReady && _eye && _localObjField) {
        // LIVE mode — reconstruct from live object stream
        _eye.setSource(_localObjField);
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
      eyeRow.style.display       = (_liveMode || _eyeShowLoaded) ? 'flex' : 'none';

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
