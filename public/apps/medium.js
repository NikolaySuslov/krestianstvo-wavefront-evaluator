/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// medium.js — STEP 1: the META-CIRCULAR WORLD LENS (the concentrated latest work). Pure demonstration.
//
//   THE PICTURE: the WORLD is a meta-circular lens that transforms the wavefront AT SOURCE. ONE spatial operator —
//   linOp = content·e^{iφ} (the genome's affine maps AS an optical chip) — shone through itself recursively. Modes:
//     pass     — one lens pass (the wavefront bent by the genome).
//     clock    — recursive lens = IFS clock (iterate → contracts to the genome's attractor).
//     recall   — content-addressable: a bar-keyed cue correlated vs the stored bank picks WHICH genome (clock).
//     coevolve — the genome migrates its own fixed points toward where the lensed energy lands (genome↔wavefront).
//     self     — code=data: the lens operates on its OWN genome code, reads θ back (complex-moment), writes it back.
//   Canvas 1 = the live IFS soliton (the object propagated through the world-clock kernel). Canvas 2 = the lens output.
//   Deterministic: every control rides the reflector (n.med*); every mode is f(bar); the loop is clocked by n.time
//   (peer-identical, no wall-clock). Modalities: IMAGE + GEOMETRY. Engine in soliton-algebra.js / ifs-gpu.js.
//
//   STEP 2 (NOT here, future): the EYE — a lens STACK [depthRecon, perceive] that LIFTS the wavefront into a
//   reconstruction (its replica) and perceives WITHIN it. Its controls show greyed/disabled below (honest, not wired).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

import { IFSGpu } from '../ifs-gpu.js';
import {
  hologramWorldProgram, REFLECTOR_MS, SUBTICK_MS, GRID, N_CELLS, DT, SRC_ALPHA, RENDER_SCALE,
  IFS_DEPTH, N_DEPTH_TIERS, CUBE_PTS, CAM_Z, PROJ_SCALE, INIT_ANGLE_Y, INIT_ANGLE_X,
} from '../hologram_world.js';
import {
  nlhoGenInject, nlhoDefaultRules, makeGenomeLens, probeSubpixelSeam, makeProbeField, PROBE_OBJECT_NAMES, nlhoFixedPointFit,
} from '../soliton-algebra.js';

const T_STEPS = 10, MBINS = 4;   // T_STEPS = lens optics-search ceiling (label/probe); MBINS = phases per bar (the bar quantum)

function makeMediumRenderer(core) {
  const RW = GRID * RENDER_SCALE, RH = GRID * RENDER_SCALE;
  const mkCell = (label, color) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display:'flex', flexDirection:'column', flex:'1', minWidth:'0', border:`1px solid ${color}22`, borderRadius:'4px', overflow:'hidden' });
    const lbl = document.createElement('div');
    Object.assign(lbl.style, { fontSize:'8px', color, padding:'2px 5px', background:'#000a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontFamily:'ui-monospace,monospace' });
    lbl.textContent = label;
    const canvas = document.createElement('canvas'); canvas.width = RW; canvas.height = RH;
    Object.assign(canvas.style, { flex:'1', minHeight:'0', width:'100%', height:'100%', objectFit:'contain', borderRadius:'3px', display:'block' });
    wrap.appendChild(lbl); wrap.appendChild(canvas);
    return { wrap, canvas, ctx: canvas.getContext('2d'), setLabel: (t) => { lbl.textContent = t; } };
  };
  const mkBtn = (label, on, handler) => {
    const b = document.createElement('button'); b.textContent = label; b._on = !!on;
    const paint = () => Object.assign(b.style, { background: b._on ? '#264' : '#222', color: b._on ? '#9f9' : '#9cf', border:'1px solid #0004', borderRadius:'4px', padding:'4px 8px', fontSize:'9px', cursor:'pointer', whiteSpace:'nowrap', fontFamily:'ui-monospace,monospace', fontWeight:'bold' });
    paint(); b.addEventListener('click', () => { handler(b); paint(); }); b._repaint = paint;
    return b;
  };
  const mkSlider = (label, min, max, step, val, onInput) => {
    const wrap = document.createElement('div'); Object.assign(wrap.style, { display:'flex', alignItems:'center', gap:'4px', fontSize:'9px', color:'#9cf', fontFamily:'ui-monospace,monospace' });
    const lbl = document.createElement('span'); lbl.textContent = `${label} ${(+val).toFixed(2)}`;
    const s = document.createElement('input'); s.type='range'; s.min=min; s.max=max; s.step=step; s.value=val; s.style.width='90px';
    // input only REQUESTS the change (injectEvent); the displayed value is reflected from world state by setVal each frame.
    s.addEventListener('input', () => { lbl.textContent = `${label} ${(+s.value).toFixed(2)}`; onInput(+s.value); });
    // setVal: reflect the authoritative world-state value onto the widget (skip while the user is actively dragging it).
    const setVal = (v) => { if (document.activeElement === s) return; if (+s.value !== +v) s.value = v; lbl.textContent = `${label} ${(+v).toFixed(2)}`; };
    wrap.appendChild(lbl); wrap.appendChild(s);   // ← was dropped in the reflector rewrite (the sliders vanished: empty wrap)
    return { wrap, input: s, setVal };
  };

  return (world, peerId, containerId, sendCursorMove, _injectEvent) => {
    const injectEvent = _injectEvent ? (ev) => setTimeout(() => _injectEvent(ev), 0) : undefined;
    // create the wrap if absent (eye.js pattern): a VIEWPORT-bounded flex container (100vh) so root's flex:1 + minHeight:0
    // resolves — otherwise height:100% has no bound, the canvas rows grow unbounded and push the control bars off-screen.
    if (!document.getElementById('medium-wrap')) { const wrap=document.createElement('div'); wrap.id='medium-wrap';
      Object.assign(wrap.style, { display:'flex', alignItems:'stretch', height:'100vh', width:'100%', overflow:'hidden' }); document.body.appendChild(wrap); }
    const root = document.createElement('div'); root.id = containerId;
    Object.assign(root.style, { display:'flex', flexDirection:'column', gap:'6px', padding:'6px', background:'#000', color:'#9cf', fontFamily:'ui-monospace,monospace', flex:'1', minWidth:'0', minHeight:'0', boxSizing:'border-box', overflow:'hidden' });
    document.getElementById('medium-wrap').appendChild(root);

    // ── STATE (all peer-pure; UI flags are local view, the field is f(clock) on the shared soliton) ───────────
    const _lensP = { sMul: 1.0, thAdd: 0.0, tx: 0, ty: 0, propT: 2, holoT: 0, opMode: 'gauge', fullGrid: true, opSpeed: 6, cueSignal: 0.6 };
    let _mode = 'pass';            // pass | clock | recall | coevolve  (the eye's perception mode)
    // the WORLD OBJECT shone through the lens — one of the core probe registry + the live rotatable cube. obj:cube is the
    // GPU/genome-coupled extra (the rotating 3D wavefront); the others come from soliton-algebra's probeObjects.
    const _OBJECTS = [...PROBE_OBJECT_NAMES, 'cube', 'attractor'];
    let _lensObj = 'cube';
    let _worldActive = false;      // active self-coevolving world object (transforms ψ at source)
    let _activeRank = 0;           // which stored genome (manual / recall base)
    let _rules = nlhoDefaultRules();
    // perception genome state (the meta-circular world lens's modes — recall pick / coevolve replica / self θ-walk)
    let _replicaRules = null, _replicaBar = -1, _selectedRank = null, _recallScores = null;
    let _worldGenome = null, _worldBar = -1;
    let _selfRules = null, _selfBar = -1;   // SELF mode: the genome's per-bar self-evolved code (code=data, meta-circular)
    let _selfLaw = 'orbit';   // 'orbit' = θ walks a limit cycle (attractor morphs) | 'contract' = θ snaps to the fixed point and holds
    let _chaosScratch = null, _chaosScratchCtx = null, _attrKey = '';   // GPU chaos-game attractor canvas (self mode)

    // ── DOM ─────────────────────────────────────────────────────────────────────────────────────────────────
    const row = document.createElement('div'); Object.assign(row.style, { display:'flex', gap:'6px', flex:'1', minHeight:'0' });
    const inCell  = mkCell('ψ_in: LIVE SOLITON (cube — drag to rotate)', '#9cf');
    const outCell = mkCell('ψ_out: WORLD LENS', '#fc8');
    row.appendChild(inCell.wrap); row.appendChild(outCell.wrap);
    // SELF-MODE META-CIRCLE ROW (eye.js's two attractor canvases) — shown only in self mode: the genome's CODE → its
    // GPU chaos-game ATTRACTOR → back to the wavefront. rule→generator→attractor→wave→rule, the closed meta-circle.
    const row2 = document.createElement('div'); Object.assign(row2.style, { display:'none', gap:'6px', flex:'1', minHeight:'0' });
    const glyphCell = mkCell('⟳ META-CIRCLE: rule → generator (code)', '#8df');
    const attrCell  = mkCell('NLHO attractor (GPU full-res chaos-game)', '#9fd');
    row2.appendChild(glyphCell.wrap); row2.appendChild(attrCell.wrap);
    // CUBE DRAG-ROTATE on canvas 1 — the KWE-CONFORMANT way: rotation goes through the WORLD MODEL (injectEvent
    // 'rotate' → reflector → n.angleY/angleX, peer-synced). The inject reads the angle from the world state, so the
    // cube rides the deterministic clock and the PERSIST SOLITON is not thrashed (no local forced re-eval).
    { let drag=false, x0=0, y0=0, bY=0, bX=0; const xy=(e)=>{const r=inCell.canvas.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top];};
      const nA = () => world.getNodeState('hologram4') || {};
      inCell.canvas.style.cursor='grab';
      inCell.canvas.addEventListener('mousedown', (e)=>{ if(_lensObj!=='cube')return; e.preventDefault(); drag=true; [x0,y0]=xy(e); const n=nA(); bY=n.angleY??INIT_ANGLE_Y; bX=n.angleX??INIT_ANGLE_X; inCell.canvas.style.cursor='grabbing'; });
      window.addEventListener('mousemove', (e)=>{ if(!drag)return; const [cx,cy]=xy(e); injectEvent?.({ type:'rotate', angleY: bY+(cx-x0)*0.012, angleX: bX+(cy-y0)*0.012 }); });
      window.addEventListener('mouseup', ()=>{ if(drag){drag=false; inCell.canvas.style.cursor='grab';} }); }

    // KWE PARAM HEADER (read-only): shows this demo runs on the real IFS world-clock (hologram_world) + its params.
    const hdr = document.createElement('div');
    Object.assign(hdr.style, { fontSize:'9px', color:'#6ad', fontFamily:'ui-monospace,monospace', padding:'1px 4px', borderBottom:'1px solid #234' });
    const bar1 = document.createElement('div'); Object.assign(bar1.style, { display:'flex', gap:'5px', flexWrap:'wrap', alignItems:'center', flexShrink:'0' });
    const bar2 = document.createElement('div'); Object.assign(bar2.style, { display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center', flexShrink:'0' });
    // controls + param header at the TOP (replacing the global connect bar, which medium hides via hideTopBar); canvases fill below.
    root.appendChild(bar1); root.appendChild(bar2); root.appendChild(hdr); root.appendChild(row); root.appendChild(row2);

    // ── CONTROLS — ALL go through the reflector (injectEvent 'setMedium' → world state n.med*); NO local mutation.
    //    Each handler only REQUESTS the change; the renderer reflects n.med* back onto the widgets + the physics every
    //    frame (_syncFromState). So the sender ALSO gets its own change from the reflector → two peers stay byte-identical
    //    (the KWE peer-determinism contract; eye.js does exactly this — inject, then render from world state).
    const inj = (patch) => injectEvent?.({ type: 'setMedium', ...patch });
    let _modeBtns = {}, _opBtn, _worldBtn, _rankBtn, _objBtn, _selfLawBtn;   // refs for _syncFromState
    ['pass','clock','recall','coevolve','self'].forEach(m => { const b = mkBtn(m, m==='pass', () => inj({ mode: m })); _modeBtns[m]=b; bar1.appendChild(b); });
    _rankBtn = mkBtn(`rank ${_activeRank}▸`, false, () => inj({ rank: (_activeRank+1)%_rules.length })); bar1.appendChild(_rankBtn);
    // OBJECT POOL: which world object we shine through the lens (the rotating cube is one of them).
    _objBtn = mkBtn(`obj:${_lensObj}▸`, false, () => { const i=_OBJECTS.indexOf(_lensObj); inj({ obj: _OBJECTS[(i+1)%_OBJECTS.length] }); }); bar1.appendChild(_objBtn);
    // SELF-LAW toggle (self mode): orbit = θ walks a limit cycle (attractor morphs) | contract = θ snaps to the fixed point.
    _selfLawBtn = mkBtn(`self:${_selfLaw}`, false, () => inj({ selfLaw: _selfLaw==='orbit'?'contract':'orbit' })); bar1.appendChild(_selfLawBtn);
    _opBtn = mkBtn(`op:${_lensP.opMode}`, false, () => inj({ op: _lensP.opMode==='phase'?'gauge':_lensP.opMode==='gauge'?'metric':'phase' })); bar1.appendChild(_opBtn);
    _worldBtn = mkBtn('world:static', false, () => inj({ world: !_worldActive })); bar1.appendChild(_worldBtn);
    // STEP-2 (the EYE: recon + optics) controls — shown but VISIBLY DISABLED (greyed, non-clickable). NOT fake-active.
    const mkDisabled = (label) => { const b=document.createElement('button'); b.textContent=label; b.disabled=true;
      Object.assign(b.style, { background:'#1a1a1a', color:'#555', border:'1px dashed #333', borderRadius:'4px', padding:'4px 8px', fontSize:'9px', fontFamily:'ui-monospace,monospace', fontWeight:'bold', cursor:'not-allowed' }); b.title='step 2 (the eye) — not wired in step 1'; return b; };
    bar1.appendChild(mkDisabled('EYE recon (step 2)'));
    bar1.appendChild(mkDisabled('optics (step 2)'));

    const _sFocus  = mkSlider('focus×', 0.3, 1.8, 0.05, _lensP.sMul, v => inj({ focus: v }));   bar2.appendChild(_sFocus.wrap);
    const _sTheta  = mkSlider('θ',     -3.14, 3.14, 0.05, _lensP.thAdd, v => inj({ theta: v }));  bar2.appendChild(_sTheta.wrap);
    const _sShiftX = mkSlider('shiftX', -12, 12, 0.25, _lensP.tx, v => inj({ shiftX: v }));        bar2.appendChild(_sShiftX.wrap);
    const _sShiftY = mkSlider('shiftY', -12, 12, 0.25, _lensP.ty, v => inj({ shiftY: v }));        bar2.appendChild(_sShiftY.wrap);
    const _sPropT  = mkSlider('propT',  1, 8, 1, _lensP.propT, v => inj({ propT: v }));            bar2.appendChild(_sPropT.wrap);
    const _sOpSpeed= mkSlider('opSpeed', 1, 16, 1, _lensP.opSpeed, v => inj({ opSpeed: v }));      bar2.appendChild(_sOpSpeed.wrap);   // clock/coevolve/self speed
    const _sHoloT  = mkSlider('holoT', 0, 80, 2, _lensP.holoT, v => inj({ holoT: v }));            bar2.appendChild(_sHoloT.wrap);   // §7.40 holographic depth
    const _sCue    = mkSlider('cueClean', 0, 1, 0.05, _lensP.cueSignal, v => inj({ cueClean: v }));bar2.appendChild(_sCue.wrap);   // recall cue cleanliness

    // ── _syncFromState(n): reflect the AUTHORITATIVE world state n.med* onto the local mirror + the widgets, every
    //    frame. The local vars are now a pure MIRROR (not a source of truth) — they only ever change here, from n.*,
    //    so both peers compute identical physics. Side-effect resets (clearing replica/world/self caches) fire on a
    //    detected change so a remote toggle re-derives the same caches a local toggle would have.
    const _syncFromState = (n) => {
      if (n.medMode    != null && n.medMode    !== _mode)        { _mode = n.medMode; _replicaRules=null; _replicaBar=-1; _selectedRank=null; _selfRules=null; _selfBar=-1; _objSeen=''; }
      if (n.medOp      != null && n.medOp      !== _lensP.opMode){ _lensP.opMode = n.medOp; }
      if (n.medWorld   != null && !!n.medWorld !== _worldActive) { _worldActive = !!n.medWorld; _worldGenome=null; _worldBar=-1; _objSeen=''; }
      if (n.medObj     != null && n.medObj     !== _lensObj)     { _lensObj = n.medObj; _replicaRules=null; _worldGenome=null; _worldBar=-1; _objSeen=''; inCell.canvas.style.cursor=_lensObj==='cube'?'grab':'default'; }
      if (n.medRank    != null && (n.medRank|0)!== _activeRank)  { _activeRank = n.medRank|0; _replicaRules=null; _selfBar=-1; _objSeen=''; }
      if (n.medSelfLaw != null && n.medSelfLaw !== _selfLaw)     { _selfLaw = n.medSelfLaw; _selfBar=-1; }
      if (typeof n.medFocus   === 'number' && n.medFocus   !== _lensP.sMul)     { _lensP.sMul=n.medFocus; }
      if (typeof n.medTheta   === 'number' && n.medTheta   !== _lensP.thAdd)    { _lensP.thAdd=n.medTheta; }
      if (typeof n.medShiftX  === 'number' && n.medShiftX  !== _lensP.tx)       { _lensP.tx=n.medShiftX; }
      if (typeof n.medShiftY  === 'number' && n.medShiftY  !== _lensP.ty)       { _lensP.ty=n.medShiftY; }
      if (typeof n.medPropT   === 'number' && n.medPropT   !== _lensP.propT)    { _lensP.propT=n.medPropT; }
      if (typeof n.medOpSpeed === 'number' && n.medOpSpeed !== _lensP.opSpeed)  { _lensP.opSpeed=n.medOpSpeed; _selfBar=-1; }
      if (typeof n.medHoloT   === 'number' && n.medHoloT   !== _lensP.holoT)    { _lensP.holoT=n.medHoloT; }
      if (typeof n.medCueClean=== 'number' && n.medCueClean!== _lensP.cueSignal){ _lensP.cueSignal=n.medCueClean; _replicaBar=-1; }
      // reflect onto the widgets (buttons + sliders) so the UI shows the SHARED state, not a stale local guess.
      for (const k in _modeBtns) { const on=(k===_mode); if(_modeBtns[k]._on!==on){ _modeBtns[k]._on=on; _modeBtns[k]._repaint(); } }
      _rankBtn.textContent = `rank ${_activeRank}▸`;
      _objBtn.textContent = `obj:${_lensObj}▸`;
      _selfLawBtn.textContent = `self:${_selfLaw}`;
      _opBtn.textContent = `op:${_lensP.opMode}`;
      if (_worldBtn._on!==_worldActive){ _worldBtn._on=_worldActive; _worldBtn._repaint(); } _worldBtn.textContent = _worldActive?'world:active':'world:static';
      _sFocus.setVal(_lensP.sMul); _sTheta.setVal(_lensP.thAdd); _sShiftX.setVal(_lensP.tx); _sShiftY.setVal(_lensP.ty);
      _sPropT.setVal(_lensP.propT); _sOpSpeed.setVal(_lensP.opSpeed); _sHoloT.setVal(_lensP.holoT); _sCue.setVal(_lensP.cueSignal);
    };

    // ── GPU ─────────────────────────────────────────────────────────────────────────────────────────────────
    let _gpu = null, _gpuReady = false, _gpuCanvas = null;
    // ── IFS SOLITON MONITOR state: the object propagated through the LIVE IFS-clock kernel (setRings + stepRecord). ─
    let _localObjField = null, _localPsi = null, _kernelVer = -1, _objSeen = '', _psiReadPending = false;
    let _monDir = 1, _monClock = 0;   // _monDir = clock direction (from world tick); _monClock = n.time·RATE = the deterministic depth/step phase (peer-identical, no wall-clock)
    let _solSteps = 0, _solClock0 = 0, _solInit = false;   // canvas-1 soliton: accumulated stepRecord count + the n.time anchor (set ONCE) → steps = f(n.time), peer-locked; tracks rotation continuously (no per-frame reset)
    if (IFSGpu.isSupported()) {
      _gpuCanvas = document.createElement('canvas'); _gpuCanvas.width = GRID; _gpuCanvas.height = GRID;
      IFSGpu.create(_gpuCanvas, GRID).then(g => {
        _gpu = g; _gpuReady = true;
        if (typeof window !== 'undefined') { window._mediumGpu = _gpu; }
        console.log('[MEDIUM] IFSGpu ready');
      }).catch(err => console.error('[MEDIUM] IFSGpu init FAILED:', err));
    }

    // ── THE WORLD OBJECT = the rotating 3D CUBE wavefront (the real IFS object from eye.js). _projectSources rotates
    //    + projects CUBE_PTS; _buildSrcFieldIFS turns the projected points into a complex wavefront (phase = depth). ─
    let _cubeAY = INIT_ANGLE_Y, _cubeAX = INIT_ANGLE_X;   // mirror of n.angleY/angleX (the world model — peer-synced), refreshed each frame
    const _projectSources = (aY, aX) => {
      const cosY=Math.cos(aY), sinY=Math.sin(aY), cosX=Math.cos(aX), sinX=Math.sin(aX), halfG=(GRID-1)/2, fscale=halfG*PROJ_SCALE, reconZ=Math.round(GRID/16), total=CUBE_PTS.length;
      return CUBE_PTS.map(([ox,oy,oz]) => { const ry1=cosY*ox+sinY*oz, rz1=-sinY*ox+cosY*oz, rx=ry1, ry=cosX*oy-sinX*rz1, rz=sinX*oy+cosX*rz1, z=CAM_Z-rz;
        return { sx: halfG+(rx/z)*fscale*CAM_Z, sy: halfG-(ry/z)*fscale*CAM_Z, sz: z*(reconZ/CAM_Z), amp: 200.0*(0.5+0.5*(rz+1)/2)/total }; });
    };
    const _cubeField = () => {   // packed complex — the cube wavefront (phase codes depth)
      const sources = _projectSources(_cubeAY, _cubeAX), field = new Float64Array(2*N_CELLS);
      let szMin=Infinity, szMax=-Infinity; for (const {sz} of sources){ if(sz<szMin)szMin=sz; if(sz>szMax)szMax=sz; } const szRange=Math.max(1e-4, szMax-szMin);
      for (const {sx,sy,sz,amp} of sources){ const ix=Math.round(sx)|0, iy=Math.round(sy)|0; if(ix<0||ix>=GRID||iy<0||iy>=GRID)continue;
        const j=iy*GRID+ix, t=Math.max(0,Math.min(1,(sz-szMin)/szRange)), ph=t*Math.PI*4; field[j*2]+=amp*Math.cos(ph); field[j*2+1]+=amp*Math.sin(ph); }
      return field;
    };
    // OBJECT POOL: cube = the live GPU-coupled wavefront (app extra); the rest come from soliton-algebra's probeObjects.
    // The genome's OWN attractor isn't here (it's a recall target, not a world object). Full-grid region (margin 1).
    const _objExtras = {
      cube: (f) => f.set(_cubeField()),
      // the genome's OWN attractor: shine a clock's generator field through itself (code=data as a world object).
      attractor: (f) => { try { nlhoGenInject(f, _rules[(_selectedRank!=null?_selectedRank:_activeRank)%_rules.length], GRID); } catch(e){} },
    };
    const _imageField = () => {
      // SELF mode: ψ_in IS the genome's evolving code-as-wavefront (code=data) — canvas 1 shows the code self-evolving.
      if (_mode === 'self' && _selfRules) return _codeField(_selfRules);
      return makeProbeField(_lensObj, GRID, { x0:1, y0:1, side: GRID-2 }, { np: 8 }, _objExtras);
    };
    const _imageFieldOLD = () => {   // (kept for reference: the old cross)
      const f = new Float64Array(2*N_CELLS), c = GRID>>1, arm = (GRID*0.3)|0, w = 2;
      for (let d=-arm; d<=arm; d++) { for (let t=-w; t<=w; t++) {
        const a=((c+d)*GRID+(c+t))*2, b=((c+t)*GRID+(c+d))*2; f[a]=1; f[b]=1; } }
      return f;
    };

    // ── THE GENOME LENS = linOp (the medium's operator) — `depth` GPU passes on the current field. ────────────
    const _activeGenome = (bar) => _replicaRules || (_selectedRank!=null ? _rules[_selectedRank%_rules.length] : _rules[_activeRank%_rules.length]);
    const _LMAXD = 24;   // recursive-clock depth: triangle 0→MAXD→0, advancing opSpeed steps per bar (the lens clock rate)
    const _barDepth = (bar) => { const sp = Math.max(1, _lensP.opSpeed|0), ph = ((bar|0)*sp) % (2*_LMAXD); return Math.max(1, ph<_LMAXD ? ph : 2*_LMAXD-ph); };
    const _runLens = (gpu, rules, depth) => { const lg = makeGenomeLens(gpu, rules, DT, GRID, { ..._lensP }); for (let q=0;q<depth;q++) lg.run(); };

    // ── WORLD OBJECT self-coevolve AT SOURCE (active world): bar-pure, mutates its OWN genome, before the eye. ─
    const _worldSelfTransform = (gpu, objField, bar) => {
      if (_worldBar !== bar) {   // re-derive the world genome to `bar` from the seed object (f(bar), peer-pure)
        const saved = gpu.readEyePsi();
        let rules = _rules[_activeRank%_rules.length].map(m=>({...m}));
        const seed = new Float64Array(2*N_CELLS); nlhoGenInject(seed, rules, GRID);
        const steps = Math.min(bar, 24);
        gpu.setEyePsi(objField);
        for (let s=0;s<steps;s++) { _runLens(gpu, rules, _barDepth(bar)); const lensed = gpu.readEyePsi();
          let pbi=-1,pbv=0; for(let i=0;i<N_CELLS;i++){const a=lensed[i*2]**2+lensed[i*2+1]**2; if(a>pbv){pbv=a;pbi=i;}}
          if (pbi>=0&&pbv>1e-9){ const pkx=pbi%GRID,pky=(pbi/GRID)|0,lr=0.10;
            rules = rules.map((m,idx)=>{ const d=Math.max(1e-3,1-m.s), rate=lr*(0.5+0.5*idx/Math.max(1,rules.length-1));
              return {...m, tx:m.tx+rate*((pkx-GRID/2)*d-m.tx), ty:m.ty+rate*((pky-GRID/2)*d-m.ty)}; }); } }
        gpu.setEyePsi(saved); _worldGenome = rules; _worldBar = bar;
      }
      const saved = gpu.readEyePsi(); gpu.setEyePsi(objField); _runLens(gpu, _worldGenome, _barDepth(bar));
      const out = gpu.readEyePsi(); gpu.setEyePsi(saved); return out;
    };

    // ── SELF MODE (code=data, meta-circular): the lens operates on ITS OWN GENOME. ψ_in IS the genome's code-as-wavefront
    //    (a blob + θ-satellite at each full-grid fixed point); the lens transforms it; we READ θ back per centre by
    //    COMPLEX-MOMENT (§7.100) → write back → the genome self-evolves. Derived to `bar` (peer-pure), like _worldSelfTransform.
    const _fpCenters = (rules) => { const fit = nlhoFixedPointFit(rules, GRID), cen = [];
      for (const mm of fit.fps){ const vx=fit.pad+(mm.fx-fit.minX)*fit.sc, vy=fit.pad+(mm.fy-fit.minY)*fit.sc; cen.push(1+Math.round(vx*(GRID-3)), 1+Math.round(vy*(GRID-3))); } return cen; };
    const _codeField = (rules) => {   // the genome's code AS a wavefront: main blob + θ-satellite at each fixed point
      const cen = _fpCenters(rules), f = new Float64Array(2*N_CELLS), r = 4;
      const put = (X,Y,a) => { if(X>=0&&X<GRID&&Y>=0&&Y<GRID) f[(Y*GRID+X)*2]+=a; };
      for (let i=0;i<rules.length;i++){ const cx=cen[i*2],cy=cen[i*2+1], th=rules[i].theta||0;
        put(cx,cy,0.9); put(cx+Math.round(r*Math.cos(th)), cy+Math.round(r*Math.sin(th)), 0.5); }
      return f;
    };
    // read the lensed field's local phase-gradient direction at each centre by COMPLEX-MOMENT (§7.100).
    const _readGrad = (rules, lensed) => { const cen = _fpCenters(rules);
      return rules.map((m,i) => { const cx0=cen[i*2], cy0=cen[i*2+1], RR=6;
        let Mxr=0,Mxi=0,Myr=0,Myi=0; const at=(X,Y)=>{const k=(Y*GRID+X)*2; return [lensed[k],lensed[k+1]];};
        for (let dy=-RR;dy<=RR;dy++) for (let dx=-RR;dx<=RR;dx++){ const X=cx0+dx,Y=cy0+dy; if(X<1||X>=GRID-1||Y<1||Y>=GRID-1)continue;
          const [r0,i0]=at(X,Y); const a2=r0*r0+i0*i0; if(a2<1e-3)continue; const [rx,ix]=at(X+1,Y),[ry,iy]=at(X,Y+1);
          Mxr+=a2*(rx*r0+ix*i0); Mxi+=a2*(ix*r0-rx*i0); Myr+=a2*(ry*r0+iy*i0); Myi+=a2*(iy*r0-ry*i0); }
        const gx=Math.atan2(Mxi,Mxr), gy=Math.atan2(Myi,Myr);
        return (Math.abs(gx)+Math.abs(gy)<1e-4) ? null : Math.atan2(gy,gx); });
    };
    // CONTRACT (§7.100d): θ ← absolute gradient read → snaps to the fixed point θ* and HOLDS (a focus/contraction).
    const _readThetaContract = (gpu, rules, lensed) => { const g = _readGrad(rules, lensed);
      return rules.map((m,i) => ({ ...m, theta: g[i]==null ? (m.theta||0) : ((g[i]%(2*Math.PI))+2*Math.PI)%(2*Math.PI) })); };
    // ORBIT (§7.100/d linear wavefront operator): θ INCREMENTS by a constant rotation ω (a free limit-cycle walk that
    // never locks) PLUS a small read-coupled perturbation (the shear modulates the orbit). Constant ω DOMINATES the
    // sin term → no fixed point: θ walks around the circle forever, the attractor morphs continuously.
    const _readThetaOrbit = (gpu, rules, lensed) => { const g = _readGrad(rules, lensed), omega = 0.30, kappa = 0.12;
      return rules.map((m,i) => { const th=m.theta||0;
        const nth = th + omega + (g[i]==null ? 0 : kappa*Math.sin(g[i]-th));   // pure rotation ω + bounded read coupling κ<ω
        return { ...m, theta:((nth%(2*Math.PI))+2*Math.PI)%(2*Math.PI) }; }); };
    const _readThetaBack = (gpu, rules, lensed) => (_selfLaw==='orbit' ? _readThetaOrbit : _readThetaContract)(gpu, rules, lensed);
    const _selfEvolve = (gpu, bar) => {   // re-derive the self-evolved genome to `bar` (peer-pure). returns {rules, codeIn, lensedOut}
      // PEER-PURE f(bar): re-derive the self-evolved genome FROM THE BASE RANK to `bar` (no path-dependence — every peer
      // computes the same θ at bar N regardless of when it joined). opSpeed = θ-walk steps PER BAR → total evolve
      // iterations = bar·opSpeed (capped), so a higher opSpeed walks the genome's θ further per bar (the evolution rate).
      const sp = Math.max(1, _lensP.opSpeed|0), nIter = Math.min(bar*sp, 600);
      if (_selfBar !== bar) {
        const saved = gpu.readEyePsi();
        let rules = _rules[_activeRank%_rules.length].map(m=>({...m}));
        for (let s=0;s<nIter;s++) { const codeF = _codeField(rules);
          gpu.setEyePsi(codeF); _runLens(gpu, rules, 1); const lensed = gpu.readEyePsi();   // ONE lens pass per evolve step (the θ-walk increment)
          rules = _readThetaBack(gpu, rules, lensed); }
        gpu.setEyePsi(saved); _selfRules = rules; _selfBar = bar;
      }
      const saved = gpu.readEyePsi(), codeIn = _codeField(_selfRules);
      gpu.setEyePsi(codeIn); _runLens(gpu, _selfRules, 1); const lensedOut = gpu.readEyePsi();
      gpu.setEyePsi(saved);
      return { rules: _selfRules, codeIn, lensedOut };
    };

    // ── COMPUTE ψ_out (canvas 2 = the WORLD LENS): shine the fresh source through the genome lens. `phaseT` = _monClock
    //    (= n.time·RATE, peer-identical) drives the recursive-lens depth sweep. The GENOME is f(bar) (peer-synced —
    //    _selfEvolve/_replicaRules/_activeRank). Returns the FULL COMPLEX lensed wavefront (2·N) → |ψ|²=re²+im² = the
    //    smooth standing-wave. STATELESS (re-seed the fresh source each call) → no accumulation, no ghost.
    const _computeOutField = (bar, phaseT) => {
      if (!_gpu) return null;
      if (_mode === 'self') { const { lensedOut } = _selfEvolve(_gpu, bar); return Float64Array.from(lensedOut); }
      const src = (_localObjField && _localObjField.length===2*N_CELLS) ? _localObjField : (_probeRaw || null);
      if (!src) return null;
      let depth = 1;
      if (_mode==='clock'||_mode==='coevolve'||_mode==='recall') { const sp=Math.max(1,_lensP.opSpeed|0), ph=(phaseT*sp)%(2*_LMAXD); depth=Math.max(1, Math.round(ph<_LMAXD?ph:2*_LMAXD-ph)); }
      const saved = _gpu.readEyePsi();
      _gpu.setEyePsi(src); _runLens(_gpu, _activeGenome(bar), depth);   // FRESH source (stateless, no ghost) → lens
      const out = _gpu.readEyePsi(); _gpu.setEyePsi(saved); return out;   // FULL complex (2·N)
    };

    // ── OUTPUT STATE. _outField = the lensed wavefront (canvas 2). _probeRaw = the fresh source fallback for the lens. ─
    let _outField = null, _probeRaw = null;
    // recall: the medium reads its OWN bank — correlate a bar-keyed cue vs all stored genomes, pick the winner.
    const _opRecall = (gpu, ctx) => {
      const bar = ctx.readBar, K = _rules.length, N = N_CELLS, planted = _activeRank%K, keep = Math.max(0, Math.min(1, _lensP.cueSignal));
      const gP = new Float64Array(2*N); nlhoGenInject(gP, _rules[planted], GRID);
      let gE=0; for(let i=0;i<N;i++) gE+=gP[i*2]**2+gP[i*2+1]**2; const gAmp=Math.sqrt(gE/Math.max(1,N)), noiseA=(1-keep)*gAmp*2;
      const cue = new Float64Array(2*N);
      for(let i=0;i<N;i++){ const h=((i*2654435761 ^ (bar*2246822519))>>>0)/4294967296;
        if (h<keep){ cue[i*2]=gP[i*2]; cue[i*2+1]=gP[i*2+1]; }
        const h2=(((i*40503)^(bar*19349663))>>>0)/4294967296, h3=(((i*12289)^(bar*83492791))>>>0)/4294967296;
        cue[i*2]+=noiseA*(h2-0.5); cue[i*2+1]+=noiseA*(h3-0.5); }
      const scores=[]; for(let r=0;r<K;r++){ const gF=new Float64Array(2*N); nlhoGenInject(gF, _rules[r], GRID);
        let cr=0,ci=0,ea=0,eb=0; for(let i=0;i<N;i++){const ar=cue[i*2],ai=cue[i*2+1],br=gF[i*2],bi=gF[i*2+1]; cr+=ar*br+ai*bi; ci+=ai*br-ar*bi; ea+=ar*ar+ai*ai; eb+=br*br+bi*bi;}
        scores.push((ea>0&&eb>0)?Math.hypot(cr,ci)/Math.sqrt(ea*eb):0); }
      let win=0; for(let r=1;r<K;r++) if(scores[r]>scores[win]) win=r;
      _selectedRank=win; _recallScores=scores;
    };
    // coevolve: the eye refines its REPLICA model. PEER-PURE f(bar) — re-derive from the DETERMINISTIC SOURCE (the
    //    fresh _imageField, which rides the peer-synced cube angle n.angleY/angleX), NOT the persistent travelling field
    //    (which is only pure-modulo-JOIN §7.66 → diverges between peers). Same bar-strategy as _selfEvolve/_worldSelfTransform:
    //    walk the genome `bar` steps from the base rank, each step = lens → peak-detect → migrate fixed points toward the peak.
    const _opCoevolveReplica = (gpu, ctx) => {
      const bar = ctx.readBar, N = N_CELLS;
      if (_replicaBar !== bar) {
        const saved = gpu.readEyePsi();
        const src = _imageField();   // peer-pure deterministic source (cube @ synced angle / the chosen object)
        let rules = _rules[_activeRank%_rules.length].map(m=>({...m}));
        const steps = Math.min(bar, 24);
        for (let s=0;s<steps;s++) { gpu.setEyePsi(src); _runLens(gpu, rules, _barDepth(bar)); const lensed = gpu.readEyePsi();
          let pbi=-1,pbv=0; for(let i=0;i<N;i++){const a=lensed[i*2]**2+lensed[i*2+1]**2; if(a>pbv){pbv=a;pbi=i;}}
          if (pbi>=0&&pbv>1e-9){ const pkx=pbi%GRID,pky=(pbi/GRID)|0,lr=0.10;
            rules = rules.map((m,idx)=>{ const d=Math.max(1e-3,1-m.s), rate=lr*(0.5+0.5*idx/Math.max(1,rules.length-1));
              return {...m, tx:m.tx+rate*((pkx-GRID/2)*d-m.tx), ty:m.ty+rate*((pky-GRID/2)*d-m.ty)}; }); } }
        gpu.setEyePsi(saved); _replicaRules = rules; _replicaBar = bar;
      }
    };
    // ── l11_best_lens RENDER (the best rendering): render a COMPLEX field via the hologram colormap (gpu.renderEyeField,
    //    same look as the fractal panels — uses the gpu's render texture as scratch) with the INSTANTANEOUS per-field peak (max contrast,
    //    no EMA lag) + a FULL-GRID view-crop blitted Y-flipped with HIGH-QUALITY bilinear smoothing (crisp, not blocky).
    //    Uses the eye buffer as render scratch — _frame's lens compute also saves/restores it, so no cross-call leak; the
    //    persist soliton lives in the SWEEP buffer (untouched here). complexPsi = packed [re,im,...] 2·N.
    const _VX0 = 1, _VY0 = 1, _VSIDE = GRID - 2;   // full-grid view (stable zoom in every mode)
    const _peakSq = (a) => { let m=1e-12; for(let j=0;j<(a.length>>1);j++){ const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v; } return m; };
    const _drawL11 = (cell, complexPsi) => {
      if (!complexPsi || !_gpu || !_gpuCanvas) return;
      const saved = _gpu.readEyePsi();                       // preserve the eye buffer (it's shared scratch)
      _gpu.setEyePsi(complexPsi); _gpu.renderEyeField(_peakSq(complexPsi));   // hologram colormap, instantaneous peak
      _gpu.setEyePsi(saved);
      const ctx=cell.ctx, W=cell.canvas.width, H=cell.canvas.height, vspan=_VSIDE, cellp=Math.min(W,H)/vspan, dw=vspan*cellp, offx=(W-dw)/2, offy=(H-dw)/2;
      ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
      ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
      ctx.drawImage(_gpuCanvas, _VX0, GRID-(_VY0+_VSIDE), _VSIDE, _VSIDE, offx, offy, _VSIDE*cellp, _VSIDE*cellp);   // Y-flip (GL bottom-up)
    };

    // ── SELF-MODE META-CIRCLE CANVASES (eye.js's two attractor panels) — only in self mode. glyph = the genome's
    //    code-as-wavefront (rule → generator); attractor = the GPU full-res chaos-game render of the SAME evolving
    //    rule-set (rule → attractor). Together: rule→generator→attractor→wave→rule, the closed meta-circle.
    const _renderSelfCanvases = (bar) => {
      const on = (_mode === 'self');
      row2.style.display = on ? 'flex' : 'none';
      if (!on || !_selfRules || !_gpu) return;
      // GLYPH = the genome's W matrix (growNlhoGlyph → an L×L mean-subtracted attractor-density grid) rendered as a
      // CHECKERBOARD of colored blocks — the genome's PHENOTYPE as a value matrix (eye.js's recalled-glyph look).
      const L = 16, gl = _gpu.growNlhoGlyph(_selfRules, L, { wantField: false }), W = (gl && gl.W) ? gl : { W: gl };
      const Wm = W.W || W; let amax = 1e-9; for (let i=0;i<Wm.length;i++){ const a=Math.abs(Wm[i]); if(a>amax)amax=a; }
      const gx=glyphCell.ctx, GW=glyphCell.canvas.width, GH=glyphCell.canvas.height, cw=GW/L, ch=GH/L;
      gx.fillStyle='#000'; gx.fillRect(0,0,GW,GH);
      for (let ly=0;ly<L;ly++) for (let lx=0;lx<L;lx++){ const v=Wm[ly*L+lx]/amax, t=Math.min(1,Math.abs(v));   // density ramp: black→blue→cyan→white
        const r=Math.round(255*Math.max(0,t-0.6)/0.4), g=Math.round(255*Math.min(1,t/0.7)*0.85), b=Math.round(255*Math.min(1,t/0.45));
        gx.fillStyle=`rgb(${r},${g},${b})`; gx.fillRect(lx*cw, (L-1-ly)*ch, Math.ceil(cw), Math.ceil(ch)); }   // Y-flip (GL bottom-up)
      glyphCell.setLabel(`⟳ rule → generator: W glyph (${L}²) · K=${_selfRules.length} maps · θ ${_selfRules.map(m=>(m.theta||0).toFixed(2)).join(' ')}`);
      // ATTRACTOR = the GPU chaos-game of the evolving rules (redraw only when the genome/bar changes — θ-keyed).
      const attrKey = `${bar}|${_activeRank}|${_selfRules.map(m=>(m.theta||0).toFixed(3)).join(',')}`;
      if (attrKey !== _attrKey) {
        _attrKey = attrKey;
        const out = _gpu.renderChaosGame(_selfRules, { chains: 30000, iters: 16 });
        const W = attrCell.canvas.width, H = attrCell.canvas.height, ctx = attrCell.ctx;
        ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
        if (out && out.pixels) {
          if (!_chaosScratch || _chaosScratch.width !== out.P) { _chaosScratch = document.createElement('canvas'); _chaosScratch.width=_chaosScratch.height=out.P; _chaosScratchCtx=_chaosScratch.getContext('2d'); }
          const id = _chaosScratchCtx.createImageData(out.P, out.P), d = id.data, src = out.pixels;
          for (let y=0;y<out.P;y++){ const sy=(out.P-1-y)*out.P*4, dy=y*out.P*4; for(let i=0;i<out.P*4;i++) d[dy+i]=src[sy+i]; }   // GL bottom-up → flip Y
          _chaosScratchCtx.putImageData(id,0,0); ctx.imageSmoothingEnabled=false; ctx.drawImage(_chaosScratch,0,0,W,H);
        }
        attrCell.setLabel(`NLHO attractor (GPU chaos-game) · K=${_selfRules.length} maps · θ-evolving · ${out?out.P:'?'}²`);
      }
      // (glyph draws colored blocks directly; chaos-game uses its own scratch; growNlhoGlyph saves/restores the eye
      //  buffer — NONE touch the sweep, so the persist soliton is untouched here. No restore needed.)
    };

    // ── RENDER FN — called by makeView's Renkon reactive loop EACH world tick (NOT a self-driven RAF). f(clock):
    //    the live persistent soliton advanced by cycleCount; ψ_out's recursive depth interpolated by n.time. ─
    const _frame = () => {
      if (!_gpuReady || !_gpu) return;
      const n = world.getNodeState('hologram4') || {};
      // KWE GATE: wait for the IFS world-clock to produce its kernel (cachedRadii) before driving the medium — the
      // proper conformance pattern (eye.js does the same). The clock auto-starts (hologramWorldProgram __macro).
      hdr.textContent = `IFS world-clock · GRID ${GRID}² · IFS_DEPTH ${IFS_DEPTH} · tiers ${N_DEPTH_TIERS} · DT ${DT} · T-steps ${T_STEPS} · MBINS ${MBINS} · cyc ${n.cycleCount ?? 0} · ${n.cachedRadii?.length ? 'RUNNING' : 'waiting for clock…'}`;
      if (!n.cachedRadii?.length) return;
      _syncFromState(n);   // reflect ALL shared controls (n.med*) onto the local mirror + widgets BEFORE driving physics → both peers identical
      const cyc = n.cycleCount ?? 0, tnow = n.time ?? 0;
      const bar = Math.floor(cyc / MBINS);
      _cubeAY = n.angleY ?? INIT_ANGLE_Y; _cubeAX = n.angleX ?? INIT_ANGLE_X;   // mirror the world model's cube angle (peer-synced)
      if (_mode === 'self') _selfEvolve(_gpu, bar);   // derive the self-evolved genome to `bar` FIRST → _codeField(_selfRules) is ready for the monitor
      // ── IFS SOLITON MONITOR (canvas 1) — the object propagated through the LIVE IFS-clock kernel. Load the kernel
      //    rings, set the object field, propagate stepRecord → _localPsi = the live IFS soliton (the bright glowing |ψ|).
      const kernelVer = n.cachedRadiiVersion ?? 0;
      if (_kernelVer !== kernelVer) { _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets); _kernelVer = kernelVer; }
      // WORLD:ACTIVE → the world object self-coevolves its OWN genome AT SOURCE → it reshapes the cube field BEFORE the
      // IFS propagation, so CANVAS 1 (the live soliton) ALSO transforms under coevolve (the meta-circle reaches the source).
      const objKey = `${_lensObj}|${_cubeAY.toFixed(3)}|${_cubeAX.toFixed(3)}|${kernelVer}|${_worldActive?('W'+bar):'_'}|${_mode==='self'?('S'+bar):'_'}`;
      if (objKey !== _objSeen) {
        let obj = _imageField();
        if (_worldActive) { const sv=_gpu.readEyePsi(); obj = _worldSelfTransform(_gpu, obj, bar); _gpu.setEyePsi(sv); }   // reshape at source (eye buffer scratch, restored)
        _localObjField = obj; _gpu.setObjField(_localObjField); _objSeen = objKey;
      }
      _monDir = (n.direction ?? 1);   // direction of the world clock (the soliton steps only when it runs forward)
      // PERCEPTION GENOME (pure step-1, f(bar), peer-deterministic): recall = correlate a bar-keyed cue vs the bank →
      // _selectedRank; coevolve = walk the replica genome `bar` steps from the deterministic source → _replicaRules.
      // Called DIRECTLY (no eye eval) — they only SET the genome _computeOutField then shines through the lens. self =
      // _selfEvolve (already run above). pass/clock = the stored genome straight. (The §7.55 eval + the depthRecon/optics
      // EYE stack are STEP 2 — removed here; this file is the pure meta-circular WORLD LENS.)
      if (_mode === 'recall')   _opRecall(_gpu, { readBar: bar });
      if (_mode === 'coevolve') _opCoevolveReplica(_gpu, { readBar: bar });
      // ── THE LOOP, CLOCKED BY n.time (PURE DETERMINISTIC, NO performance.now / NO RAF). _frame is renderFn, which the
      //    framework fires PER SUBTICK (the KWE granular future-send drain: a future-send with fireAt < the next atom tick
      //    EVALUATES IMMEDIATELY → worldUpdate → renderFn, like the zeno/IFS examples). So n.time advances finely between
      //    reflector ticks and renderFn sees each step → SMOOTH motion from the SHARED deterministic clock alone, no wall
      //    interpolation. _monClock = n.time·RATE is peer-IDENTICAL at every render → both peers byte-locked, no offset.
      const _MON_RATE = 3.0;                 // phase per unit n.time (was K=3; n.time IS the clock now, no wall term)
      _monClock = tnow * _MON_RATE;
      const STEPS_PER_PHASE = 19;            // soliton evolution speed (≈ the old 16/frame)
      if (!_solInit) { _solClock0 = _monClock; _solSteps = 0; _solInit = true; }   // anchor ONCE; tracks rotation continuously (no reset)
      if (_monDir > 0) {
        const target = Math.floor((_monClock - _solClock0) * STEPS_PER_PHASE);
        const todo = Math.max(0, Math.min(96, target - _solSteps));   // clamp catch-up so a lagging peer never stalls the frame
        for (let i = 0; i < todo; i++) _gpu.stepRecord(DT, SRC_ALPHA);
        _solSteps += todo;
        if (todo > 0 && !_psiReadPending) { _psiReadPending = true; _gpu.readPsiAsync().then(p => { _psiReadPending = false; _localPsi = p; }); }
      }
      _outField = _computeOutField(bar, _monClock);   // canvas-2 lens depth rides _monClock (n.time, peer-identical)
      // RENDER both canvases the l11_best_lens way (renderEyeField colormap + instantaneous peak + bilinear blit).
      if (_localPsi) _drawL11(inCell, _localPsi);     // CANVAS 1 = the live persist soliton
      if (_outField) _drawL11(outCell, _outField);    // CANVAS 2 = the world-lens output (full complex → smooth |ψ|)
      // labels — STEP 1: canvas 2 is the WORLD META-CIRCULAR LENS (no eye recon yet).
      inCell.setLabel(_mode==='self'
        ? `ψ_in: OWN GENOME (code=data · self-evolving)`
        : `ψ_in: LIVE SOLITON (obj:${_lensObj}${_lensObj==='cube'?' · drag to rotate':''} · ${_worldActive?'ACTIVE self-coevolve@source':'static'})`);
      let stat = `WORLD LENS · ${_mode}`;
      if (_lensP.holoT>0) stat += ` · HOLO T=${_lensP.holoT}`;
      if (_mode==='recall' && _recallScores) stat += ` · WON r${_selectedRank} [${_recallScores.map((v,i)=>`${i===_selectedRank?'▸':''}${v.toFixed(2)}`).join(' ')}]`;
      if (_mode==='coevolve' && _replicaRules) stat += ` · genome ${_replicaRules.map(m=>`(${(m.tx||0).toFixed(0)},${(m.ty||0).toFixed(0)})`).join('')}`;
      if (_mode==='self' && _selfRules) stat += ` · code=data [${_selfLaw}] θ ${_selfRules.map(m=>(m.theta||0).toFixed(2)).join(' ')}`;
      outCell.setLabel(`ψ_out · ${stat} · op:${_lensP.opMode} · obj:${_lensObj}`);
      _renderSelfCanvases(bar);   // self mode: the two meta-circle panels (code glyph + GPU attractor)
    };

    // ── CONSOLE PROBES (determinism + sub-pixel) ────────────────────────────────────────────────────────────
    if (typeof window !== 'undefined') {
      window.mediumSubpixel = (axis='x') => { if(!_gpu){console.log('no gpu');return;} const out=probeSubpixelSeam(_gpu, DT, GRID, axis); console.log(`[MEDIUM-SUBPIX ${axis}] ${out.join('  ')}  (small-k ≈ 0.25 → −0.25 = 1 cell/unit)`); return out; };
      window.mediumReplicaCheck = (bar = 12) => {   // coevolve replica is pure f(bar): two derivations of the same bar must match
        if (!_gpu) { console.log('[MEDIUM-REPLICA] no gpu'); return; }
        const saved=_gpu.readEyePsi();
        const run=()=>{ _replicaBar=-1; _opCoevolveReplica(_gpu,{readBar:bar}); return _replicaRules.map(m=>`(${(m.tx||0).toFixed(3)},${(m.ty||0).toFixed(3)})`).join(''); };
        const a=run(), b=run(); _gpu.setEyePsi(saved); _replicaBar=-1;
        console.log(`[MEDIUM-REPLICA bar=${bar}] f(bar)-deterministic=${a===b?'YES ✓':'NO ✗'}\n  run1=${a}\n  run2=${b}`);
        return a===b;
      };
    }
    return _frame;   // the framework (makeView) calls this each world tick as renderFn
  };
}

export default {
  title:       'Medium | Meta-circular world lens (linOp · pass/clock/recall/coevolve/self)',
  selo:        'hologram4',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologramWorldProgram + av],
  makeRenderer: makeMediumRenderer,
  wrapId:      'medium-wrap',
  hideTopBar:  true,   // hide the global connect/disconnect bar — the medium UI sits at the top instead (selo.html honors this)
};
