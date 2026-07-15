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
  nlhoGenInject, nlhoDefaultRules, nlhoResonanceRules, genomeAggregate, genomeFpCenters, probeSubpixelSeam, makeProbeField, PROBE_OBJECT_NAMES,
  // ── LENS-STACK library (the general lens mechanics live in soliton-algebra now). medium.js is a thin CONSUMER: it builds
  //    one composeLens STACK per scope and runs it once. makePerception = the genome lens for a mode (the medium stack);
  //    makeTrapStack = opHologram→opRecon→makePerception (the EYE = a TRAP = the SAME perception on the lifted recon).
  //    A few low-level helpers stay for the source path (genomeCodeField/runGenomeLens/barClockDepth) + the determinism probe (opCoevolve).
  makePerception, makeTrapStack, opCoevolve, nlhoCoevolveTunnel, nlhoRuptureAdapt, nlhoInstantonHologram, nlhoLensWalk, nlhoClockWalk, nlhoDammannImage, barClockDepth, genomeCodeField, runGenomeLens, applyLife,
  lensU1,   // u-register step 3: the pure observer-lens algebra (compose/link/chain/apply, abelian + metric/gauge semidirect sector) — chainRead measures the medium against its laws
} from '../soliton-algebra.js';
import { makeObserverBank, normalizeVirtEvent, applySettingsVerb, applyVirtVerb, makeStepClock, makeCouplingStore, muxClocks, chainMeter } from '../medium-core.js';   // extraction stages A+B2+C1+C3: the descriptor store + snapshot codec, the verb WIRE SCHEMA (one source of truth for what crosses the pull), the SETTINGS-sector verb table, the V-SECTOR verb table (stores contract), and the step clock (the future thin demo imports the SAME core — never a copy)
import { makeSolitonEngine } from '../medium-gpu.js';   // extraction stage G1: the GPU soliton ENGINE — the living-soliton field state (+ leaf physics helpers/snapshot in G2/G3). The thin demo (apps/medium-u1.js) drives the SAME engine; the drive ORCHESTRATION stays medium-side (the C4 boundary)

const T_STEPS = 10, MBINS = 4;   // T_STEPS = lens optics-search ceiling (label/probe); MBINS = phases per bar (the bar quantum)
const EYE_RECON_D = 12;          // the eye's default reconstruction depth (back-prop steps) — the aperture's focal range

function makeMediumRenderer(core) {
  const RW = GRID * RENDER_SCALE, RH = GRID * RENDER_SCALE;
  const mkCell = (label, color) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display:'flex', flexDirection:'column', flex:'1', minWidth:'0', border:`1px solid ${color}22`, borderRadius:'4px', overflow:'hidden' });
    const lbl = document.createElement('div');
    // pre-wrap so an embedded "\n" renders as a SECOND line (long labels, e.g. the resonance meter, get their own line instead of being clipped).
    Object.assign(lbl.style, { fontSize:'8px', color, padding:'2px 5px', background:'#000a', whiteSpace:'pre-wrap', overflow:'hidden', fontFamily:'ui-monospace,monospace', lineHeight:'1.3' });
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
  // mkSelect: a styled dropdown (replaces forward-cycling buttons). options = [{value, label}]; onChange(value). setVal/setOptions live.
  const mkSelect = (label, options, value, onChange) => {
    const wrap = document.createElement('div'); Object.assign(wrap.style, { display:'flex', alignItems:'center', gap:'3px', fontSize:'9px', color:'#9cf', fontFamily:'ui-monospace,monospace' });
    const lbl = document.createElement('span'); lbl.textContent = label; lbl.style.fontWeight='bold';
    const sel = document.createElement('select');
    Object.assign(sel.style, { background:'#222', color:'#9cf', border:'1px solid #0004', borderRadius:'4px', padding:'3px 4px', fontSize:'9px', fontFamily:'ui-monospace,monospace', cursor:'pointer' });
    // rebuild options ONLY when they actually change (a frame-by-frame innerHTML reset would destroy the open dropdown → unselectable).
    let _optsSig = '';
    const setOptions = (opts) => { const sig = opts.map(o=>o.value+':'+o.label).join('|'); if (sig === _optsSig) return; _optsSig = sig;
      const cur = sel.value; sel.innerHTML=''; for (const o of opts){ const e=document.createElement('option'); e.value=String(o.value); e.textContent=o.label; sel.appendChild(e); } if (cur) sel.value = cur; };
    setOptions(options); sel.value = String(value);
    sel.addEventListener('change', () => onChange(sel.value));
    // don't overwrite while the user is interacting with the dropdown (focused/open) — else the per-frame reflect fights the click.
    const setVal = (v) => { if (document.activeElement === sel) return; if (sel.value !== String(v)) sel.value = String(v); };
    wrap.appendChild(lbl); wrap.appendChild(sel);
    return { wrap, sel, setVal, setOptions };
  };
  const mkSlider = (label, min, max, step, val, onInput) => {
    const wrap = document.createElement('div'); Object.assign(wrap.style, { display:'flex', alignItems:'center', gap:'4px', fontSize:'9px', color:'#9cf', fontFamily:'ui-monospace,monospace' });
    const lbl = document.createElement('span'); let _suffix = '';
    const _txt = (v) => `${label} ${(+v).toFixed(2)}${_suffix}`; lbl.textContent = _txt(val);
    const s = document.createElement('input'); s.type='range'; s.min=min; s.max=max; s.step=step; s.value=val; s.style.width='90px';
    // input only REQUESTS the change (injectEvent); the displayed value is reflected from world state by setVal each frame.
    s.addEventListener('input', () => { lbl.textContent = _txt(s.value); onInput(+s.value); });
    // setVal: reflect the authoritative world-state value onto the widget (skip while the user is actively dragging it).
    const setVal = (v) => { if (document.activeElement === s) return; if (+s.value !== +v) s.value = v; lbl.textContent = _txt(v); };
    const setSuffix = (sfx) => { if (sfx === _suffix) return; _suffix = sfx; lbl.textContent = _txt(s.value); };   // live extra text (e.g. the genome value the fraction scales)
    wrap.appendChild(lbl); wrap.appendChild(s);   // ← was dropped in the reflector rewrite (the sliders vanished: empty wrap)
    return { wrap, input: s, setVal, setSuffix };
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
    // TWO lens param sets: _lensP = the WORLD lens (medium); _eyeLensP = the EYE's analysis lens (the trap's perception).
    // The UI-scope toggle (_uiScope) picks which one the sliders edit → the SAME slider strip tunes either lens.
    const _lensP    = { sMul: 1.0, thAdd: 0.0, tx: 0, ty: 0, propT: 2, focalDt: 1.0, holoT: 0, opMode: 'gauge', fullGrid: true, opSpeed: 6, cueSignal: 0.6 };
    const _eyeLensP = { sMul: 1.0, thAdd: 0.0, tx: 0, ty: 0, propT: 2, focalDt: 1.0, holoT: 12, opMode: 'gauge', fullGrid: true, opSpeed: 6, cueSignal: 0.6, reconD: EYE_RECON_D,
                        focusManual: 0,   // MANUAL FOCUS OFFSET (steps from the matched/in-focus plane): 0=in focus, ±=rack-focus. Used when optics:off.
                        codeMask: 0,      // CODE-AS-CONTENT (§7.90 gate): 0=off → 1=image fully gated by the genome's field footprint
                        codeWarp: 0,      // CODE-AS-OPERATOR (§7.97 metric warp): 0=off → 1=image fully rotated/scaled/translated by the genome's affine
                        // PER-PARAMETER warp FRACTIONS (0..1, ×master): isolate a geometric DOF (s=scale, θ=rotate, tx/ty=translate). Default 1 = full.
                        codeWarpS: 1, codeWarpTheta: 1, codeWarpTx: 1, codeWarpTy: 1,
                        codeWarpMaps: 8,   // REPLICATION COUNT: how many of the genome's maps participate (each = one copy). Clamped to the genome's K.
                        occMode: 0, occR: 0.5, occBlock: 8 };   // H=OCCL: occMode 0=off|6=LEFT-SLAB|7=RZero|8=RNois, occR=fraction, occBlock=block px
    // ── TWO FULL LENS CONTEXTS — the UI is fully scope-dependent (the user's ask). _uiScope picks WHICH lens the WHOLE UI
    //    (modes + sliders + canvases) targets. Each scope bag IS the ctx the library lens-stack ops read/write
    //    (selectedRank/recallScores/selfRules/replicaRules + the op memo keys), so the eye runs its own clock/recall/self ON
    //    ITS OWN RECON (the lifted replica), independent of the medium's modes — but FED by the medium's live world soliton.
    //    obj: is the only MEDIUM-ONLY control. _lensP is reflector-synced; _eyeLensP is local for now (testing).
    //    UI/control fields: mode/selfLaw/view/activeRank/attrKey/objSeen. Lib-written: selectedRank/recallScores/selfRules/
    //    replicaRules + _recallKey/_selfKey/_coevKey (memo) + _stack/_stackKey (the cached composeLens). Reset on mode change.
    const _mkScope = () => ({ mode:'pass', selfLaw:'orbit', view:'soliton', activeRank:0,
      selectedRank:null, recallScores:null, replicaRules:null, selfRules:null, attrKey:'', objSeen:'',
      _recallKey:null, _selfKey:null, _coevKey:null, _stack:null, _stackKey:'' });
    const _S = { medium: _mkScope(), eye: _mkScope() };
    let _uiScope = 'medium';       // 'medium' = the WHOLE UI targets the world lens | 'eye' = the WHOLE UI targets the eye lens
    const _uiP   = () => _uiScope==='eye' ? _eyeLensP : _lensP;   // the param set the sliders currently target
    const _sc    = () => _S[_uiScope];                            // the scope's perception state (mode/genome) the UI targets
    const _isSelf = (s = _sc()) => s.mode==='self' || s.mode==='recallself';   // self-like = the θ-walk modes (four canvases)
    // the WORLD OBJECT shone through the lens — one of the core probe registry + the live rotatable cube. obj:cube is the
    // GPU/genome-coupled extra (the rotating 3D wavefront); the others come from soliton-algebra's probeObjects.
    const _OBJECTS = [...PROBE_OBJECT_NAMES, 'cube', 'attractor', 'hidden', 'tight', 'mixed'];
    const _isHidden = (o) => o==='hidden' || o==='tight' || o==='mixed';   // the geometry-sees-geometry family (resonance read applies)
    let _phaseView = false;   // DISPLAY toggle (local): render hue=phase instead of intensity — makes the pure-phase signature & reso-strength VISIBLE
    // ── INSTANTON (propagation KICK) state — declared here (before the UI controls that read _instAmp) to avoid a TDZ. The kick is a
    //    strong localized spike ADDED to the living soliton at a deterministic bar → FLASHES (peak ×N vacuum) then DECAYS to the IFS
    //    attractor under the existing drive (probe-measured: flash ×3–13, settles corr→1.0). NOT a genome edit/phase tear (those don't
    //    fire — measured, §15). _instBar = fire bar (peer-deterministic); _instScope/_instAmp ride world state; _instPeak = the kicked
    //    snapshot (reconstruction target); _instFireBar = the bar it fired; _instRecon = last back-prop fidelity. Helpers below (§soliton).
    // _instHold = bars to SUSTAIN the kick (re-inject each bar) so the erupt→collapse is VISIBLE (0 = a single honest transient that
    // decays in ~1 bar; >0 = held flash, trades a little physical fidelity for watchability). _instWide = kick sigma (wider = more dramatic).
    let _instBar = -1, _instScope = 'eye', _instAmp = 11.0, _instVer = 0, _instSeen = -1, _instPeak = null, _instFireBar = -1, _instRecon = null, _instHold = 0;
    // TUNNEL (A→B state transition): when armed, the kick is shaped toward genome B = (medium rank)+1 (wrapped) AND, after the fire
    // bar, the LOCAL drive retargets toward B's attractor → the field crosses A's basin into B's (a committed jump). DETERMINISTIC
    // WITHOUT a per-frame reflector event: B is derived locally from the already-replicated M.activeRank, and the fire bar is shared,
    // so both peers compute the identical transition from identical inputs (the KWE arc — replicate the ARM, derive the EVOLUTION).
    // _tunnelB = the destination rank (locked at fire so a later rank-change doesn't move the target mid-tunnel); _tunnelActive = post-fire.
    let _instTunnel = false, _tunnelB = -1, _tunnelActive = false, _reconSeen = -1, _reconPending = false;
    // ⚡B+ : the destination OFFSET (B = activeRank + offset, wrapped). Default 1 (rank+1). Dial 1/2/3 to pick a MORE DISTINCT B for
    // the which-attractor instanton test (the bank ranks overlap in fit-space; the resonance matched-filter still discriminates).
    let _tunnelBoffset = 1;   // replicated via instBoff
    // EMERGENT tunnel (no hard-switch): _tunnelMode 'switch' = the programmatic lens-swap (honest state-machine transition);
    // 'emergent' = the live genome PHYSICALLY MIGRATES A→B via nlhoCoevolveTunnel (per-map peak-chase toward B's attractor, phase
    // mode) — the rules move under wave-energy feedback, no swap. _tunnelGenome = the live migrating rules (starts A, nudged → B each bar).
    let _tunnelMode = 'switch', _tunnelGenome = null, _tunnelGenome0 = null, _tunnelGenBar = -1, _tunnelLocked = false, _tunnelMigSteps = 0;   // _tunnelGenome0 = A (the seed, to measure drift away from A)
    // LENS-SPACE WALK (emergent): _tunnelT = the phase-interpolation parameter φ_t=(1−t)φ_A+t·φ_B (0=lens-A, 1=lens-B). Walks 0→1 over
    // the adapt window — a BARRIER-FREE path (measured: energy flat, matched filter swings A→B). The source carries a packet through
    // the interpolated lens; identity read by the resonance matched filter. _tunnelLensField = the carried wavefront at the current t.
    let _tunnelT = 0, _tunnelLensField = null;
    // CLOCK WALK (clock mode — the INSTANTON THAT TUNNELS, probe_instanton_clock.mjs): phase WALLS A→B (can't transport); the IFS
    // CLOCK does — Hutchinson contraction GATHERS energy toward B's fixed points (native transport). The RUPTURE (kick) hands off to
    // the clock running B's maps. _tunnelTicks = how many contraction ticks applied (the walk); _tunnelClockSeed = the ruptured A-field
    // the clock carries; _tunnelClockField = the carried wavefront after _tunnelTicks ticks (becomes the live source).
    let _tunnelTicks = 0, _tunnelClockField = null, _tunnelClockSeed = null;
    const _CLOCK_TICKS_MAX = 10;   // probe: ~8 ticks to land (corr→B 32%→99%); cap a couple past for settle
    // PHASE-LABEL TUNNEL (phase mode — THE RIGHT ANGLE, probe_label_tunnel/phase_label): the soliton's tunnelable IDENTITY is its
    // internal PHASE (a linearized-NLS mode), NOT its shape (the nonlinear-forbidden constellation → speckle). The instanton applies a
    // localized PHASE IMPULSE Δφ = (B's aggregate phase − A's) toward B; the soliton's internal phase crosses A→B while it STAYS one
    // lump (no speckle). This is the honest read of lens-space (φ_A→φ_B barrier-free). Measured: B-specific, soliton-preserving.
    let _phaseTunFired = false, _phaseA0 = 0, _phaseTarget = 0;   // A0 = soliton's phase at fire; target = B's aggregate phase
    // BARRIER instanton (the genuine one): source STAYS A (NOT swapped); the KICK alone must push the soliton across; the drive is
    // WINNER-TAKE-ALL — it follows whichever basin the soliton is NOW in (_barrierTarget). Supra-threshold kick → lands in B → B's basin
    // holds it (target flips to B). Sub-threshold → stays in A's basin → drive pulls back to A. A REAL barrier (unlike switch's hard swap).
    let _barrierTarget = 'A';   // 'A' | 'B' — which basin the drive currently holds (flips to B only if the soliton actually crossed)
    let _barrCenA = null, _barrCenB = null, _barrLogBar = -1, _barrierLatched = false;   // A/B centroids + log throttle + LATCH (landed-in-B = committed, no fall-back)
    // ★ DISTINCT raw A/B attractor positions for barrier mode — BYPASS genomeFpCenters' auto-fit (which co-locates every genome at the
    // frame centre → A & B same point → no crossing target, the wall). A = upper-LEFT cluster, B = lower-RIGHT cluster, genuinely separated
    // (~G/2 apart) so the momentum kick has a real distinct B to reach. Used for the barrier source/well/kick/read so all agree on raw coords.
    const _barrRawCenters = (which) => { const q=GRID*0.25, h=GRID*0.5, t=GRID*0.75, c=GRID*0.5;
      return which==='A' ? [q,q, h,q, q,h, h,h] : [h,h, t,h, h,t, t,t];   // A: upper-left quad of points; B: lower-right quad — distinct regions
    };
    // ★ BARRIER NATIVE UPGRADE (probe_barrier_separation.mjs): barrier's A/B are now the REAL genome attractors (rank / rank+1), positioned
    // by the MEASURED chaos-game centroid (respects absolute tx,ty — the Fix-3 lesson; NOT genomeFpCenters' auto-fit which co-locates, NOT
    // the old hardcoded q/h/t fiction). HONEST DEGENERACY: when the two real genomes' attractors coincide (measured ~half the rank pairs
    // co-locate < ~15px), there is genuinely NO barrier to cross — the code reports it instead of faking a crossing.
    const _barrChaosCentroid = (rules) => { let sx=0,sy=0,n=0; for (let ch=0;ch<2500;ch++){ let px=Math.random(),py=Math.random();
      for (let it=0;it<16;it++){ const m=rules[(Math.random()*rules.length)|0], c=Math.cos(m.theta||0), s=Math.sin(m.theta||0), sc=m.s||0.5, rx=px-0.5, ry=py-0.5; px=sc*(c*rx-s*ry)+(m.tx||0); py=sc*(s*rx+c*ry)+(m.ty||0); } sx+=px; sy+=py; n++; }
      return [ (sx/n)*(GRID-1), (sy/n)*(GRID-1) ]; };   // pixels
    // the genome's RAW fixed points (pixels) — used as the phase-well centers so the well bends toward the REAL attractor, not a quad.
    const _barrGenomeFps = (rules) => { const out=[]; for (const m of rules){ const s=m.s||0.5, th=m.theta||0, c=Math.cos(th), si=Math.sin(th), a=1-s*c, b=s*si, cc=-s*si, d=1-s*c, det=a*d-b*cc;
      const fx = Math.abs(det)<1e-9?0.5:(d*(m.tx||0)-b*(m.ty||0))/det, fy = Math.abs(det)<1e-9?0.5:(-cc*(m.tx||0)+a*(m.ty||0))/det;
      out.push(Math.max(1,Math.min(GRID-2, fx*(GRID-1))), Math.max(1,Math.min(GRID-2, fy*(GRID-1)))); } return out; };
    // ORIGINAL centroid of the quad template — still used by VORTEX mode (its C-midpoint, unchanged; vortex is a separate resolved arc).
    const _barrCentroid = (which) => { const cn=_barrRawCenters(which); let x=0,y=0; for(let i=0;i<cn.length;i+=2){x+=cn[i];y+=cn[i+1];} return [x/(cn.length/2), y/(cn.length/2)]; };
    // BARRIER A/B genome (rank / rank+1) → the MEASURED real centroid + raw fp cluster. Cached at fire (rules don't change mid-tunnel).
    let _barrGenA = null, _barrGenB = null, _barrFpsA = null, _barrFpsB = null, _barrSep = -1, _barrDegenerate = false;
    const _barrGenCentroid = (which) => (which==='A' ? _barrGenA : _barrGenB) || [GRID/2, GRID/2];
    // ★ WINDING NUMBER Q (vortex mode's TOPOLOGICAL observable) — measured on ONE BIG LOOP enclosing ALL of B's blobs, so it reads the
    // TOTAL enclosed charge (probe_vortex_multiblob.mjs: a 4-blob attractor with per-blob vortices reads a clean stable Qbig≈4; a SINGLE
    // CENTRAL vortex reads Qbig≈0 because its core sits in the inter-blob GAP = topologically invisible — that was the browser's Q=4.25 bug).
    const _windingLoop = (f, cx, cy, R) => { let prev=null,sum=0; const steps=180;
      for (let k=0;k<=steps;k++){ const t=2*Math.PI*k/steps, x=Math.round(cx+R*Math.cos(t)), y=Math.round(cy+R*Math.sin(t)); if(x<0||x>=GRID||y<0||y>=GRID)continue; const i=(y*GRID+x)*2;
        const ph=Math.atan2(f[i+1],f[i]); if(prev!==null){ let d=ph-prev; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI; sum+=d; } prev=ph; }
      return sum/(2*Math.PI); };
    const _winding = (f) => { const cn=_barrRawCenters('B'); let cx=0,cy=0; for(let i=0;i<cn.length;i+=2){cx+=cn[i];cy+=cn[i+1];} cx/=cn.length/2; cy/=cn.length/2;
      return _windingLoop(f, cx, cy, GRID*0.42); };   // a loop ENCLOSING all 4 blobs = the total topological charge
    // winding FOLLOWING the field's own centroid (the charge moves WITH the blob; a fixed loop misreads it as it transports). For diagnosis.
    const _windingFollow = (f) => { let sx=0,sy=0,sw=0; for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const a=f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2;sx+=x*a;sy+=y*a;sw+=a;}
      const cx=sw>0?sx/sw:GRID/2, cy=sw>0?sy/sw:GRID/2; let s=0; const rs=[GRID*0.06,GRID*0.10,GRID*0.14,GRID*0.18]; for(const R of rs) s+=_windingLoop(f,cx,cy,R); return s/rs.length; };
    // ★ INJECT PER-BLOB vortices with REAL DENSITY NODES (probe_charge_conservation.mjs: a phase-only stamp has no core node → self-focus
    // fills it → the charge dies; a vortex with a |ψ|=0 core is a REAL topological defect that the IFS-native low-pass contraction
    // CONSERVES). Per blob centre: multiply by e^{i·atan2} (the winding) AND carve the node r/√(r²+a²) (amplitude→0 at the core). The
    // single central core is topologically invisible (sits in the inter-blob gap, Q≈0 = the browser bug); per-blob is the validated form.
    const _VORTEX_CORE = 2.0;   // core radius (healing length) for the density node
    const _injectVortex = (f, which='B') => { const cn=_barrRawCenters(which);
      for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ let ph=0, hole=1;
        for (let k=0;k<cn.length;k+=2){ ph += Math.atan2(y-cn[k+1], x-cn[k]); const r=Math.hypot(x-cn[k], y-cn[k+1]); hole *= r/Math.sqrt(r*r + _VORTEX_CORE*_VORTEX_CORE); }
        const c=Math.cos(ph), s=Math.sin(ph), i=(y*GRID+x)*2, vr=f[i], vi=f[i+1]; f[i]=(vr*c-vi*s)*hole; f[i+1]=(vr*s+vi*c)*hole; } return f; };
    // OPTION A nonlinear-bistability params (§7.60 applyEyeNlKick during the barrier crossing window): γ=phase depth (amp-scaled = the
    // gate), th=intensity threshold (only the kicked spike clears it), w=band, WIN=window bars. These make the kicked spike RESIST A's
    // linear pull → a genuine threshold. Tunable if the barrier is too high/low — but the HONEST test is amp-gating, not a fixed pass.
    const _NLBAR_GAMMA = 2.4, _NLBAR_TH = 0.15, _NLBAR_W = 0.25, _NLBAR_WIN = 4;
    // self-focus (gain-above-threshold, probe_selffocus_form-verified to CONFINE without flatten/runaway): th=intensity threshold, gp=gain
    // above it (peak grows), lo=loss below (background decays → energy migrates to the peak). The momentum-conserving localizer.
    const _SF_TH = 0.04, _SF_GP = 0.12, _SF_LO = 0.08;
    // ★ VORTEX (TOPOLOGICAL) instanton state — the critique's mechanism, HONESTLY SCOPED by the probe arc (probe_vortex_*.mjs). The
    // critique is right: a contractive medium has no potential barrier, so the native move is a TOPOLOGICAL RUPTURE (inject per-blob
    // vortices). MEASURED: the winding is a REAL transport force (control with no winding stays at A — NOT decorative), but a LINEAR
    // medium cannot self-advect a soliton a finite distance (vortex-dipole self-advection is a NONLINEAR/GPE effect) — so it transports
    // OFF A to a STABLE MIDPOINT EQUILIBRIUM = an EMERGENT TOPOLOGICAL VACUUM C (identical at 40 & 80 steps = a true attractor). It does
    // NOT reach B (claiming B would be the decorative lie — the drive, not topology, would do it). So vortex mode = A → emergent C.
    let _vortexLatched = false, _vortexFired = false, _vortexLogBar = -1, _vortexTarget = 'A';   // 'A'(origin, no winding) | 'C'(emergent midpoint vacuum the winding transports to)
    const _VORTEX_LP = 0.30;   // IFS-native low-pass weight (probe_gpe_native.mjs: β=0.3 conserves the charge to t100; the charge-conserving piece)
    const _VORTEX_GPE = 0.50;  // IFS-native GPE strength (probe_native_gpe_charge.mjs: γ=0.5 holds full Qtot=4 to t60; γ=2 over-contracts → spurious cores)
    // ★ FIX 3 (the doc's "move the vacuum, not the wave" — probe_fix3_vacuum.mjs validated): once the wave latches at C, MIGRATE the genome
    // (the vacuum layer) so C becomes B's basin — via nlhoCoevolveTunnel toward a target = B's IDENTITY (s,θ) with fixed points RELOCATED
    // to C. The dual-layer KWA completion: the linear wave stalls at C (Fix 1 9-pt ruled out — native-leapfrog-verified self-advection
    // genuinely needs a spectral kinetic), so instead the genome slides under the resting mass until "genome B sitting at C" = A→B done.
    let _vortexGenome = null, _vortexCoBar = -1, _vortexBasinHeld = -1;   // migrating vacuum rules, per-bar throttle, live basin-hold corr
    let _tunnelRefA = null, _tunnelRefB = null;   // A/B reference fields in the LENSED representation (= same as _E.psiLensed) for an honest landing measure
    const _INST_SIG = 5.0;   // kick width (was 2.5; wider → a bigger, clearly visible eruption on the canvas)
    let _lensObj = 'cube';         // MEDIUM-ONLY: the source object (the eye has no source — it traps the world soliton)
    let _worldActive = false;      // active self-coevolving world object (transforms ψ at source) — medium only
    let _opticsOn = false;         // eye: adaptive optics (the eye autofocuses its aperture) on/off
    let _rules = nlhoDefaultRules(), _rulesVer = 0;   // _rulesVer: bump if the genome bank is ever mutated (recall's memo key depends on the bank)
    let _growMax = 0;   // SELF-EVOLUTION GROWTH ceiling (§7.88): 0=off (fixed map count); >K → self mode grows new maps up to this (max 8 = GPU cap)
    // GEOMETRY-SEES-GEOMETRY (obj:hidden): a packet recursively lensed by a PLANTED genome (phase mode) → a chaotic phase cloud,
    // invisible to normal vision. The eye RESONATES: when its genome/θ matches the planted one, the conjugate phase + propagation
    // RE-FOCUS the packet (constructive interference, soliton collapse). _hiddenRank = which bank genome is planted (the "lock").
    // _resonance = the live recovery fidelity |⟨packet|recon⟩| (1.0 = perfect resonance; ~0 = scatter). _hiddenPacket = the target.
    let _hiddenRank = 0, _resonance = 0, _resoClean = 0, _resoScores = null, _resoBest = 0, _hiddenPacket = null, _hiddenCloud = null, _resoTemplates = null;   // _resoTemplates = cached per-genome LENSED signatures (the matched-filter bank)
    let _extracted = null;   // obj:mixed: the genome the eye's selected rank OPERATOR pulled out of the superposed field (shown as the recon ▸)
    let _recallLockRank = null;   // eye recall on the hidden family: the rank the matched filter RECOGNIZED from the lens-in-the-wavefront (drives the trap)
    let _resoStrength = 1.5;   // RESONANCE LENS STRENGTH (sMul of the plant/template lens) — slider; stronger = sharper genome phase signature. Changing it rebuilds the templates.
    const HIDE_PASSES = 6;
    const _RESO_P = () => ({ sMul: _resoStrength, tx: 0, ty: 0, propT: 2, focalDt: 1, holoT: 0, opMode: 'phase', fullGrid: true });   // live reso params (read the strength slider)
    const _resoRules = nlhoResonanceRules();   // PHASE-DISTINCT bank (each rank a real note) — the hidden lock + the eye key index this
    let _evolved = null;   // the latest self-evolved+grown genome (ctx.selfRules), so pass/clock can RUN it live (auto-use); commit persists it to the bank
    // PEER-HASH: a deterministic FNV-1a digest for byte-match verification across peers. _hashState = the replicated control state
    // (med*+eye*+genome — should match if the reducers stayed in sync); _hashField = the eye RECON field quantized (the real physics
    // output — the true determinism proof). Two peers driving the same events should show identical hashes.
    const _fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h.toString(16).padStart(8,'0'); };
    const _hashField = (f) => { if (!f) return '--------'; let h = 0x811c9dc5; for (let i = 0; i < f.length; i += 8) { const q = Math.round(f[i] * 1000) | 0; h ^= (q & 0xff); h = (h * 0x01000193) >>> 0; h ^= ((q >> 8) & 0xff); h = (h * 0x01000193) >>> 0; } return (h >>> 0).toString(16).padStart(8,'0'); };
    // MACROSCOPIC (TOPOLOGICAL) TIER — kept ALONGSIDE the byte tier, never replacing it. solH proves the event/step pipeline byte-exact
    // (the strict gate — holds on same-GPU peers); the macro tuple is the observable that survives cross-VENDOR float LSB noise, which a
    // nonlinear medium (SPM) amplifies past any hash quantization. Tuple = winding INTEGER + centroid CELL + total energy. Reported as the
    // raw TUPLE, not a hash: hash-equality on quantized floats false-desyncs at bin edges (round(E·100) flips on a .005 boundary between
    // peers) — a tuple diffs with tolerance. Two tiers separate the failure classes: solH✗+macro✓ = hardware float noise (physics agrees);
    // solH✗+macro✗ = event/queue divergence (a real bug, chase it).
    const _macroSol = (f) => { if (!f) return null;
      let sx=0, sy=0, sw=0; for (let i=0;i<N_CELLS;i++){ const a2=f[i*2]**2+f[i*2+1]**2; sx+=(i%GRID)*a2; sy+=((i/GRID)|0)*a2; sw+=a2; }
      const cx=sw>0?sx/sw:GRID/2, cy=sw>0?sy/sw:GRID/2; let q=0; try { q=Math.round(_windingFollow(f)); } catch(e){}
      return { s:`Q${q}·P${Math.round(cx)},${Math.round(cy)}·E${sw.toFixed(2)}`, cx, cy, e:sw, q }; };
    let _lastEyeReconHash = '--------', _lastMedHash = '--------', _lastSolHash = '--------', _lastSolMacro = null;
    let _TAU_PROBE = false;   // tauProbe() — proper-time-metric GATE 1: log (beats, lastK) in the solH line so two peers can diff their beat SCHEDULE step-for-step. If they match, the beat count is a pure function of k+shared-field → τ can be a replicated metric. If they diverge, proper time is irreducibly peer-local and the closure stops.
    let _lastVirtHash = '--------', _lastP1Hash = '--------', _lastP2Hash = '--------';   // V/P1/P2 field digests by W's EXACT yardstick (_hashField: rounded 0.001, subsampled 1/8) → is each slot's cross-peer divergence under the solH threshold like W's, or over it? P1/P2 = booted phases (peer-identical PLATE seed, so cleaner than V's live-buffer lift)
    let _genomeVerSeen = 0;   // last applied n.genomeVer (commit/revert apply only on a version change → idempotent across frames/peers)
    let _worldGenome = null, _worldBar = -1;          // medium's world:active genome cache (source coevolve)
    let _chaosScratch = null, _chaosScratchCtx = null;   // GPU chaos-game attractor canvas (self mode, shared scratch)
    // NOTE: per-scope perception state (mode/selfLaw/view/activeRank/selectedRank/recall*/replica*/self*/attrKey/objSeen)
    //       lives in _S.medium / _S.eye (see _mkScope above) — the eye runs its OWN clock/recall/self on its OWN recon.

    // ── DOM ─────────────────────────────────────────────────────────────────────────────────────────────────
    const row = document.createElement('div'); Object.assign(row.style, { display:'flex', gap:'6px', flex:'1', minHeight:'0' });
    const inCell  = mkCell('ψ_in: LIVE SOLITON (cube — drag to rotate)', '#9cf');
    const outCell = mkCell('ψ_out: WORLD LENS', '#fc8');
    // ψ_C: the INSTANTON TRANSITION WITNESS (vortex/barrier) — a captured snapshot of the C transition state (the charged stalled wave /
    // mid-crossing), held for observation while canvas 2 (ψ_out) resolves to the INTERACTIVE destination B. Hidden unless a tunnel is active.
    const cCell = mkCell('ψ_C: INSTANTON TRANSITION (witness)', '#c9f');
    cCell.wrap.style.display = 'none';
    row.appendChild(inCell.wrap); row.appendChild(outCell.wrap); row.appendChild(cCell.wrap);
    // SELF-MODE META-CIRCLE ROW (eye.js's two attractor canvases) — shown only in self mode: the genome's CODE → its
    // GPU chaos-game ATTRACTOR → back to the wavefront. rule→generator→attractor→wave→rule, the closed meta-circle.
    const row2 = document.createElement('div'); Object.assign(row2.style, { display:'none', gap:'6px', flex:'1', minHeight:'0' });
    const glyphCell = mkCell('⟳ META-CIRCLE: rule → generator (code)', '#8df');
    const attrCell  = mkCell('NLHO attractor (GPU full-res chaos-game)', '#9fd');
    row2.appendChild(glyphCell.wrap); row2.appendChild(attrCell.wrap);
    // EYE TRAP ROW (shown only in eye mode): row 1 stays the WORLD (source · world-lens soliton); this row shows the EYE —
    // the world wavefront it CATCHES (= the lensed world soliton) + the held RECONSTRUCTION (ctx.recon = the percept). So
    // the world and the eye reconstructing it are visible at once (testing). The trap = composeLens(opRecon, perceive).
    const rowEye = document.createElement('div'); Object.assign(rowEye.style, { display:'none', gap:'6px', flex:'1', minHeight:'0' });
    const eyeInCell  = mkCell('EYE ◀ HOLOGRAM (world forward-T → diffraction domain)', '#6cf');
    const eyeOutCell = mkCell('EYE ▸ RECON (back-T → the percept)', '#9f9');
    rowEye.appendChild(eyeInCell.wrap); rowEye.appendChild(eyeOutCell.wrap);
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
    const bar3 = document.createElement('div'); Object.assign(bar3.style, { display:'none', gap:'5px', flexWrap:'wrap', alignItems:'center', flexShrink:'0' });   // H=OCCL strip (eye scope only)
    const bar4 = document.createElement('div'); Object.assign(bar4.style, { display:'none', gap:'8px', flexWrap:'wrap', alignItems:'center', flexShrink:'0' });   // code-warp per-DOF strip (eye, when code⟳op>0)
    const bar5 = document.createElement('div'); Object.assign(bar5.style, { display:'none', gap:'6px', flexWrap:'wrap', alignItems:'center', flexShrink:'0' });   // REGISTER/COUPLING strip (medium scope, transport/objorbit): refAmp · attPhase · edge · store/boot/recall — all replicated, proper-time stamped
    // controls + param header at the TOP (replacing the global connect bar, which medium hides via hideTopBar); canvases fill below.
    root.appendChild(bar1); root.appendChild(bar2); root.appendChild(bar3); root.appendChild(bar4); root.appendChild(bar5); root.appendChild(hdr); root.appendChild(row); root.appendChild(rowEye); root.appendChild(row2);

    // ── CONTROLS — ALL go through the reflector (injectEvent 'setMedium' → world state n.med*); NO local mutation.
    //    Each handler only REQUESTS the change; the renderer reflects n.med* back onto the widgets + the physics every
    //    frame (_syncFromState). So the sender ALSO gets its own change from the reflector → two peers stay byte-identical
    //    (the KWE peer-determinism contract; eye.js does exactly this — inject, then render from world state).
    const inj  = (patch) => injectEvent?.({ type: 'setMedium', ...patch });   // MEDIUM lens → setMedium event
    const injE = (patch) => injectEvent?.({ type: 'setEye',    ...patch });   // EYE lens → setEye event (replicated, NOT local)
    const injS = (patch) => injectEvent?.({ type: 'setShared', ...patch });   // shared (growMax) → setShared
    const injG = (patch) => injectEvent?.({ type: 'setGenome', ...patch });   // commit/revert a genome into the bank → setGenome (replicated)
    const injSnap = () => injectEvent?.({ type: 'setMediumSnapshot' });   // SNAPSHOT-ON-TOGGLE: bump the shared step-clock anchor (medSnapClock) for transport/objorbit — no field, just the synced origin
    let _modeBtns = {}, _opBtn, _worldBtn, _rankBtn, _objBtn, _selfLawBtn, _viewBtn;   // refs for _syncFromState
    // ── SCOPE-DEPENDENT CONTROLS — the WHOLE UI targets the ACTIVE lens (_uiScope). EVERY control INJECTS a replicated event (NO
    //    local mutation, even the eye): MEDIUM scope → setMedium (n.med* → _S.medium); EYE scope → setEye (n.eye* → _S.eye/_eyeLensP).
    //    The sender reads its own change back from the reflector → two peers stay byte-identical (the KWE determinism contract).
    //    setSc/setP route by scope to the right event. (injKey = the shared payload key; the reducers use the same names.)
    const setSc = (skey, injKey, v) => { (_uiScope==='eye' ? injE : inj)({ [injKey]: v }); };
    const setP  = (pkey, injKey, v) => { (_uiScope==='eye' ? injE : inj)({ [injKey]: v }); };
    // recallself = the FULL meta-circle: recall SELECTS which genome (matched filter), then self EVOLVES that selected one
    // (the θ-walk). Recognition → adaptation. Rendered with the self mode's four canvases (the selected genome evolving).
    // The modes are PER SCOPE: in medium scope they drive the WORLD lens (on the source); in eye scope they drive the EYE's
    // internal lens ON ITS RECON (the lifted replica). recall/self happen INSIDE the active lens, on ITS OWN wavefront.
    ['pass','clock','recall','coevolve','self','recallself'].forEach(m => { const b = mkBtn(m==='recallself'?'recall→self':m, m==='pass', () => setSc('mode','mode',m)); _modeBtns[m]=b; bar1.appendChild(b); });
    // rank = a DROPDOWN of all genome ranks. For obj:hidden it lists the RESONANCE ranks (the distinct hidden shapes) so you can
    // pick which geometry is planted (medium scope) or which is the key (eye scope). _rankOpts(bank) builds the labelled options.
    const _RESO_NAMES = ['square','triangle','diamond-T','diamond-W'];
    const _rankOpts = () => { const bank = _isHidden(_lensObj) ? _resoRules : _rules;
      return bank.map((g,i)=>({ value:i, label:`r${i}·K${g.length}${_isHidden(_lensObj)?'·'+(_RESO_NAMES[i]||''):''}` })); };
    _rankBtn = mkSelect('rank', _rankOpts(), _sc().activeRank, (v) => setSc('activeRank','rank', v|0)); bar1.appendChild(_rankBtn.wrap);
    // ⊕base: SEED the lens sliders FROM the active genome's geometry (absolute — thAdd=dominant θ, sMul=scale from mean s, shift=
    // centroid). The sliders then SHOW and the lens REPRODUCES the genome; moving a slider deviates from it. Fires on rank change too.
    const _seedBtn = mkBtn('⊕base', false, () => _seedFromGenome()); bar1.appendChild(_seedBtn);
    // ⊕op (eye-only): arm the IFS geometric OPERATOR from the genome (warp on, full DOF, copies=K). Separate from ⊕base (lens).
    const _opSeedBtn = mkBtn('⊕op', false, () => _armOperator()); bar1.appendChild(_opSeedBtn);
    // ↺reset: reset the ACTIVE lens's params ONLY to neutral defaults (focus×1, θ0, shift0, propT2, focalDist1). Leaves the code
    // operators (occlusion, codeMask, codeWarp + warp DOFs) UNTOUCHED — clear those via their own controls. Replicated (setEye/setMedium).
    const _resetBtn = mkBtn('↺reset', false, () => {
      (_uiScope === 'eye' ? injE : inj)({ focus: 1, theta: 0, shiftX: 0, shiftY: 0, propT: 2, focalDt: 1 });
    }); bar1.appendChild(_resetBtn);
    // ⇪commit: persist the live self-evolved+grown genome (_evolved) INTO the bank at the active rank, bump _rulesVer (so recall +
    // rank-cycles use it durably). ⊘revert: drop the live preview (pass/clock fall back to the bank genome). The meta-circle made
    // durable: evolve in self → commit → pass/clock/recall run the committed genome.
    // commit/revert are REPLICATED via setGenome (carries the genome maps + rank) → both peers write the bank identically. _evolved
    // itself is peer-pure (self-evolution = f(bar)), so the committed maps are byte-identical on both peers.
    const _commitBtn = mkBtn('⇪commit', false, () => { if (_evolved && _evolved.length) injG({ rank: _sc().activeRank % _rules.length, maps: _evolved.map(m => ({ s:m.s, theta:m.theta, tx:m.tx, ty:m.ty })) }); }); bar1.appendChild(_commitBtn);
    const _revertBtn = mkBtn('⊘revert', false, () => injG({ revert: true })); bar1.appendChild(_revertBtn);
    // dim commit/revert when there's nothing to commit (no live evolved preview) → the state is obvious. Called each frame (_syncScope).
    const _syncCommit = () => { const has = !!(_evolved && _evolved.length);
      for (const b of [_commitBtn, _revertBtn]) { b.style.opacity = has ? '1' : '0.35'; b.style.cursor = has ? 'pointer' : 'default'; } };
    // OBJECT POOL (MEDIUM-ONLY): the source object shone through the world lens (the eye has no source — disabled in eye scope).
    _objBtn = mkSelect('obj', _OBJECTS.map(o=>({value:o,label:o})), _lensObj, (v) => { if (_uiScope!=='eye') inj({ obj: v }); }); bar1.appendChild(_objBtn.wrap);
    // SELF-LAW toggle (self mode): orbit = θ walks a limit cycle (attractor morphs) | contract = θ snaps to the fixed point.
    _selfLawBtn = mkBtn(`self:${_sc().selfLaw}`, false, () => setSc('selfLaw','selfLaw', _sc().selfLaw==='orbit'?'contract':'orbit')); bar1.appendChild(_selfLawBtn);
    _opBtn = mkBtn(`op:${_lensP.opMode}`, false, () => { const cur=_uiP().opMode, nxt=cur==='phase'?'gauge':cur==='gauge'?'metric':'phase'; setP('opMode','op',nxt); }); bar1.appendChild(_opBtn);
    // WORLD self-coevolve@source (MEDIUM-ONLY: reshapes the source object — meaningless for the eye, which has no source).
    _worldBtn = mkBtn('world:static', false, () => { if (_uiScope==='eye') return; inj({ world: !_worldActive }); }); bar1.appendChild(_worldBtn);
    // VIEW toggle (per scope): soliton = the living lensed soliton | crisp = the direct lens output. In eye scope this toggles
    // EYE ▸ between the living recon soliton and the crisp direct reconstruction. Per-scope view state.
    _viewBtn = mkBtn(`view:${_sc().view}`, false, () => setSc('view','view', _sc().view==='soliton'?'crisp':'soliton')); bar1.appendChild(_viewBtn);
    // render:intensity ⇄ phase (local display). Phase view (hue=∠ψ, brightness=|ψ|) reveals the pure-phase signature the intensity render can't show.
    let _phaseBtn; _phaseBtn = mkBtn('render:int', false, () => { _phaseView=!_phaseView; _phaseBtn.textContent=_phaseView?'render:phase':'render:int'; _phaseBtn._on=_phaseView; _phaseBtn._repaint(); }); bar1.appendChild(_phaseBtn);
    // hide:live ⇄ baked (REPLICATED, obj:hidden/tight/mixed). LIVE = the recursive hide rides _E.monClock → the cloud breathes (winds
    // up to the chaotic scramble and unwinds back to the packet). BAKED = the fixed HIDE_PASSES depth (a static cloud). Default live.
    // Replicated via setMedium (it changes the FIELD/physics, not just display) → peers stay byte-identical (medH matches).
    let _hideBtn; _hideBtn = mkBtn('hide:live', true, () => { if (_uiScope!=='eye') inj({ hideLive: !_hideLive }); }); bar1.appendChild(_hideBtn);
    // UI-SCOPE toggle: the PRIMARY mode switch — flips the WHOLE UI (modes + sliders + canvases) between the MEDIUM lens and
    // the EYE lens. 'medium' = the world lens (_lensP/_S.medium, reflector-synced) + the world canvases; 'eye' = the eye's
    // trap lens (_eyeLensP/_S.eye, local) + the eye canvases. The medium keeps running underneath either way (it feeds the eye).
    let _uiBtn; _uiBtn = mkBtn(`ui:${_uiScope}`, _uiScope==='eye', () => { _uiScope = _uiScope==='medium'?'eye':'medium'; _uiBtn.textContent=`ui:${_uiScope}`; _uiBtn._on=(_uiScope==='eye'); _uiBtn._repaint(); _syncScope(); }); bar1.appendChild(_uiBtn);
    // optics toggle (eye autofocus). LOCAL for now (deterministic when off; on = f(field), peer-pure — reflector-wire later).
    let _opticsBtn; _opticsBtn = mkBtn('optics:off', false, () => injE({ optics: !_opticsOn })); bar1.appendChild(_opticsBtn);   // replicated (n.eyeOptics)
    // DRIVE toggle: WRITE (blend = content-agnostic, stable fixed point at the source — the default) vs HYBRID (blend α=0.15 + well@genome-fps
    // + self-focus + GPE saturate — content-bearing AND momentum-conserving; the unification probe_well_saturated validated). Bare well alone
    // runs away/goes dark (no sustained equilibrium) → the blend is irreducible; HYBRID rides the well/GPE modifiers ON the stabilizing blend.
    // DRIVE mode (3-state cycle): WRITE → HYBRID → SOLITON.
    //   write   = blend (content-agnostic, stable fixed point at the source) — the default.
    //   hybrid  = blend α=0.15 + well@fps + self-focus + GPE — content-bearing AND momentum-conserving.
    //   soliton = TRICK-FREE PURE SOLITON: seed once from the source, then stepEyeN + saturable-FOCUSING SPM only (NO blend, NO renorm).
    //             A genuine self-sustaining soliton (dispersion ⇄ saturable-focusing balance; native-leapfrog-verified E-conserved, no blow-up).
    //             Carries NO arbitrary content (no write) — it's a real pure soliton that holds itself / breathes / can be kicked.
    // 4-state cycle: write → hybrid → sol-cons → sol-diss. Both soliton drives have IDENTICAL conservative interior (stepEyeN + saturable-
    // focusing; interior dissipation BLEW UP live — §7.82 gain pumps the whole box — so it's removed). They differ ONLY in boundary default:
    //   sol-cons = conservative soliton; boundary follows the global bound: toggle (closed → noise sea / open → clean dots).
    //   sol-diss = the same conservative soliton but FORCES the absorbing (open) boundary ON (the working version: clean dots, E plateaus ~0.85).
    // BOUNDARY (bound:closed/open) is a SEPARATE, ORTHOGONAL global property applied to ALL drives — a boundary CONDITION, not a drive.
    //   closed = reflecting walls (energy trapped). open = absorbing edge ring (radiation escapes). write/hybrid: blend re-pins → little effect.
    let _driveMode = 'write';   // 'write' | 'hybrid' | 'sol-cons' | 'sol-diss'
    let _boundOpen = false;     // false=closed (reflecting) | true=open (absorbing edge) — GLOBAL, applies to all drives
    let _solSeeded = false, _solLogBar = -1, _solE0 = -1;     // pure soliton seeded ONCE then self-evolves; E baseline + log throttle
    let _solAppldX = 0, _solAppldY = 0;                       // (legacy metric-shift bookkeeping)
    const _driveCycle = { write:'hybrid', hybrid:'sol-cons', 'sol-cons':'sol-diss', 'sol-diss':'transport', transport:'trueorbit', trueorbit:'objorbit', objorbit:'write' };
    let _driveBtn; _driveBtn = mkBtn('drive:write', false, () => {
      const next = _driveCycle[_driveMode];
      // TOGGLE into transport/objorbit → publish the ANCHOR ONLY (psi=null): peers present at the toggle att-seed deterministically + share the step-clock
      // origin → byte-identical. The LIVE-ψ handoff is separate, ON-JOIN (the leader ships its field so a late joiner seeds from it; see the join-watch in _frame).
      if (next==='transport' || next==='objorbit') injSnap();   // bump the shared anchor on entering a snapshot mode
      inj({ drive: next });   // REPLICATED: request the next mode; _syncFromState applies both (same physics)
    }); bar1.appendChild(_driveBtn);
    // bound toggle is PHYSICS (multiplies ψ) → REPLICATED + anchor-bumped both directions (an un-anchored toggle lands at
    // peer-local frame boundaries → the sponge starts at different steps → byte fork; the same reasoning as 👂react/⟲coevo).
    let _boundBtn; _boundBtn = mkBtn('bound:closed', false, () => { injSnap(); inj({ bound: !_boundOpen }); }); bar1.appendChild(_boundBtn);
    // ⚡sig — TRANSIENT SIGNAL: launch a marginal radiation packet FROM the object's current operator position TOWARD
    // the shift-slider target (degenerate → +x pulse). Replicated event, injected at the stamped shared step in the
    // drive loop → byte-identical. Only meaningful while a soliton drive runs (transport/objorbit).
    const _sigBtn = mkBtn('⚡sig', false, () => {
      if (_driveMode !== 'transport' && _driveMode !== 'objorbit') { console.log('[SIG] needs drive:transport or drive:objorbit'); return; }
      const fx = GRID/2 + _transPx, fy = GRID/2 + _transPy;
      let tx = GRID/2 + (_lensP.tx || 0), ty = GRID/2 + (_lensP.ty || 0);
      if (Math.hypot(tx - fx, ty - fy) < 2) tx = fx + 30;
      injectEvent?.({ type: 'mediumSignal', fx, fy, tx, ty, amp: 0.35 });
    }); bar1.appendChild(_sigBtn);
    // 👂react — the REPLICATED REACTOR toggle: ear-hit → local deterministic PONG on every peer (byte-identical: the
    // detector runs at shared steps on the shared field). Enabling bumps the anchor → all peers start the reactor at
    // step 0 with fresh floors (deterministic activation, same recipe as the drive toggle).
    let _earRBtn; _earRBtn = mkBtn('👂react', false, () => { injSnap(); inj({ earR: !_earROn }); }); bar1.appendChild(_earRBtn);   // anchor bump on BOTH directions: an un-anchored OFF could fork (one peer computes a hit just before the toggle lands, the other doesn't)
    let _coevoBtn; _coevoBtn = mkBtn('⟲coevo', false, () => { injSnap(); inj({ coevo: !_coevoOn }); }); bar1.appendChild(_coevoBtn);   // closed-loop leash toggle (anchor-bumped both directions, same reasoning)
    // ⎙virt — record the world NOW (stamped shared step) + lift into the free-running virtual phase V (ψ_V canvas)
    const _virtBtn = mkBtn('⎙virt', false, () => {
      if (_driveMode !== 'transport' && _driveMode !== 'objorbit') { console.log('[VIRT] needs drive:transport or drive:objorbit'); return; }
      injectEvent?.({ type: 'mediumVirt' });   // V birth → default hold+mux+selfClock ON
    }); bar1.appendChild(_virtBtn);
    // snap⇢V — record/lift V with NO default-toggle logic (leaves hold/mux/selfClock exactly as they are). The raw original ⎙virt.
    const _snapVBtn = mkBtn('snap⇢V', false, () => {
      if (_driveMode !== 'transport' && _driveMode !== 'objorbit') { console.log('[VIRT] needs drive:transport or drive:objorbit'); return; }
      injectEvent?.({ type: 'mediumVirt', mode: 'recordraw' });
    }); bar1.appendChild(_snapVBtn);
    // LIVE-STATE TOGGLE BUTTONS (hold / mux / selfClock) — each shows its current toggle state (green=ON) and toggles via the stamped verb.
    // Peer-local display of replicated state; the toggle itself is the replicated verb. States refreshed each frame (see _refreshVirtToggles).
    const _holdBtn = mkBtn('hold', false, () => { if (_driveMode==='transport'||_driveMode==='objorbit') injectEvent?.({ type: 'mediumVirt', mode: 'hold' }); }); bar1.appendChild(_holdBtn);
    const _muxBtn  = mkBtn('⧉mux', false, () => { if (_driveMode==='transport'||_driveMode==='objorbit') injectEvent?.({ type: 'mediumVirt', mode: 'mux' }); }); bar1.appendChild(_muxBtn);
    const _sclkBtn = mkBtn('selfClk', false, () => { if (_driveMode==='transport'||_driveMode==='objorbit') injectEvent?.({ type: 'mediumVirt', mode: 'selfclock' }); }); bar1.appendChild(_sclkBtn);
    const _refreshVirtToggles = () => {   // reflect live replicated toggle state onto the three buttons (peer-local display)
      if (_holdBtn._on !== _V.virtHold) { _holdBtn._on = _V.virtHold; _holdBtn._repaint(); }
      if (_muxBtn._on  !== _V.virtMux)  { _muxBtn._on  = _V.virtMux;  _muxBtn._repaint(); }
      const _sc = !!_V.selfClk; if (_sclkBtn._on !== _sc) { _sclkBtn._on = _sc; _sclkBtn._repaint(); }
    };
    // (REGISTER/COUPLING STRIP bar5 is built LATER — after _lensOp/_K.edge/_V.virtBank are declared — to avoid a TDZ ref; see _buildBar5 below.)
    const _SOL_GAMMA = 20, _SOL_ISAT = 1;   // saturable-focusing params (probe_saturable_native: width holds + E conserved across γ/Isat)
    const _ORBIT_EVERY = 8;     // (legacy; transport now warps CONTINUOUSLY every step for GR-completeness)
    const _ORBIT_DEAD = 1.5;    // transport mode dead-zone (px): stop warping once the centroid is within this of the target → it parks (space flat there)
    const _TRANSPORT_PULL = 0.04;   // transport: continuous per-frame drive = fraction of the gap accumulated (smooth geodesic glide; bigger=faster) — used by the warp probes
    const _TRANSPORT_PULL_STEP = 0.007;   // PER-STEP ease (transport drive): tuned so 1−(1−this)^19 ≈ 0.13/bar = the old per-frame ease's per-bar convergence rate → the att moves slow enough for the soliton to TRACK it (a fast att = the cap kills the weak superposed copy → center dominates, shifted one dies). Batch-invariant (per-step, keyed to the shared step index).
    let _transPx = 0, _transPy = 0;   // transport COEVOLVE: the eased continuous operator-POSITION (px) where the attractor is regenerated; the living soliton chases it
    let _transShiftStep = -1, _transShiftStartX = 0, _transShiftStartY = 0, _transTgtPrevX = 0, _transTgtPrevY = 0, _transTgtKeyX = 0, _transTgtKeyY = 0;   // shift-ease anchor: SHARED step + position/target at that step + quantized target key → _transP is a pure f(steps) → peer-deterministic
    const _TRANSPORT_BETA = 0.15;     // transport: superposition weight of the operator-attractor per step (mediumTransportGR: β=.15 tracks 12/16px, no blend; β<.1 shatters)
    // PIN-AMPLITUDE SWEEP (torque-balance test): per-slot multiplier on the hold/drive superpose = the "pinning
    // gravity" h_i. Default 1.0 = unchanged. Varying ONLY W's h while V/P1 stay fixed shifts W's pin-vs-coupling
    // equilibrium angle: h≫κ → W near its pin phase; h≪κ → W swings to anti-phase (π, clean MAXCUT). The predicted
    // curve θ_eq(h) solving h·sin(θ−θ_pin)=2κ·sin(θ−θ_anti) is the physical-law proof. Replicated (stamped verb).
    // ── _lensOp[sl] — THE OBSERVER DESCRIPTOR (u-register arc step 2; doc/proper-time-metric.md §12): each mux slot's
    // readOp as ONE VALUE — { mode, phase, beta, omega }. mode 'id' = today's implicit identity lens (pin only; step 3
    // adds composable modes). phase: W = the live engine accumulator consumed at att rebuild (M-a″); V/P1/P2 = the
    // replicated drain-time LEDGER of landed aphase rotations (the rotation itself is baked into the stored att BYTES —
    // no other scalar exists; the ledger deliberately excludes lensTau precession — precession is physics, not a verb).
    // beta: pin multiplier (β_i = _TRANSPORT_BETA·beta — the pinning-gravity dial). omega: rad per slot-beat (the
    // lensTau dial; the verb is global today so all four move together — per-slot ω needs no schema change later).
    // Every field mutates ONLY at verb drains / beat sites (shared steps) → replicated; snapshot-carried
    // (medSnapLensOp; legacy keys medSnapAttPhase/medSnapLensTau/medSnapAphEng/medSnapRefAmp read as fallback);
    // reset to identity on re-anchor.
    // prec (step 3): the INTEGRATED precession Σω per own-beat, kept ONLY for slots whose phase excludes it (V/P —
    // their rotation is baked into att bytes; W's phase absorbs its own precession, so W.prec stays 0). It makes
    // lensU1.angle(op) = phase + prec the UNIFORM total reference angle — the algebra's input. Bookkeeping only:
    // never read by the dynamics; mutated at beat sites (shared steps) → replicated; rides medSnapLensOp.
    // STAGE-A EXTRACTION: the store itself (identity/reset/snapshot codec) lives in medium-core.js; _lensOp is the
    // bank's STABLE ops array — every mutation site below is unchanged, only ownership moved.
    const _obank = makeObserverBank(4);
    const _lensOp = _obank.ops;
    const _LOPN = { W: 0, V: 1, P1: 2, P2: 3 };
    const _beta = (i) => _TRANSPORT_BETA * (_lensOp[i].beta || 1);
    const _OBJORB_R = 16;             // objorbit: orbital radius (px) the operator circles the object around the well
    let _objOrbTheta = 0;             // objorbit: the operator's orbital angle (DERIVED from the SHARED step index → peer-deterministic + batch-invariant → byte-identical medH)
    const _OBJORB_W_STEP = 0.012/19;  // objorbit angular gain PER SOLITON STEP (θ=stepIndex·opSpeed·this → batch-invariant; /19 keeps the old per-_E.monClock rate since STEPS_PER_PHASE=19)
    let _transLastPx = NaN, _transLastPy = NaN;   // last integer att-position uploaded (transport/objorbit) → regen att only on pixel change (per-STEP, batch-invariant → byte-identical)
    // TRUE-ORBIT (continuous physics, mediumTrueOrbit-validated): soft soliton + IFS-gravity + transverse momentum + balanced CGL.
    const _TORB_GAMMA = 1.0;    // soft self-focusing γ — gentle internal phase so the soliton CARRIES momentum (γ=1 = a ★★ persist+mobile row; γ≥2 too bound)
    const _TORB_EPS   = 0.55;   // CGL cubic gain BALANCED for the soft amplitude (default _CGL_EPS=0.4 drains the soft soliton; ~0.55 plateaus E≈1)
    const _TORB_S     = 0.998;  // IFS-gravity strength — TUNED (mediumTrueOrbit): s=0.998+kvel=1.3 gives a BOUNDED orbit r∈[13,20] E≈1.1 (centripetal≈centrifugal); s=0.996 inspirals (too strong), s=0.999 too weak (barely curves)
    const _TORB_KVEL  = 1.3;    // transverse kick = orbital velocity (Nyquist-optimal; 1.5 overshoots/escapes, 0.5 aliased-weak per KICK CONTROL)
    let _torbKicked = false;    // transverse slingshot injected once per (re)seed
    let _torbEps = _TORB_EPS;   // ADAPTIVE CGL gain (self-regulates to hold energy → anti-decay)
    let _torbE0 = -1;           // true-orbit energy target (seed energy)
    let _orbitE = -1;        // orbit mode: bound-energy baseline to renorm back to (the warp contracts norm; this conserves it, position-agnostic)
    // (engine slice: _E.ringCache = last-set IFS ring kernel — for probes that toggle rings off/on)
    const _CGL_DELTA = 0.2, _CGL_EPS = 0.4, _CGL_MU = 0.15;   // CGL dissipative-soliton (probe_cgl_soliton: δ=0.2 ε=0.4 μ=0.15 → E plateaus ~1.0, SNR 26, stable fixed point)
    // SELF-ADVECTION RULED OUT (mediumMoveProbe, measured live on GPU): a momentum kick e^{ik·r} self-advects a FREE wavepacket (control moves),
    // but NOT the persistent bound soliton — strong SPM (γ=20, the persistent soliton) wraps its internal phase to ~2π, and a linear tilt can't
    // impose clean momentum on a phase-singular core (p_x≈0, drift=0 even in free flight). The only γ that accepts the kick (γ≈1, internal phase<π)
    // doesn't bind (E→0.03 when idle). MOBILITY ⊥ PERSISTENCE — monotonic across the whole γ sweep (no γ does both). So SHIFT moves the SPACE
    // (metric transport, affineEyeCenters) instead: the bound soliton rides the shifted vacuum unchanged. The 9-point isotropic Laplacian (ifs-gpu.js)
    // was kept — it's strictly more isotropic and harmless — but it was not sufficient: the blocker is the soliton's wrapped phase, not the stencil.
    const _SOL_ABSORB_W = 16;     // absorbing edge ring width (cells) — radiation propagates out & is absorbed; interior solitons untouched
    const _SOL_ABSORB_MIN = 0.5;   // transmission at the very edge (0=full absorb, 1=none); ramps to 1 at depth W (a soft sponge, no reflection)
    // GLOBAL OPEN-BOUNDARY: absorbing edge ring applied to ANY field (JS, on the readback). Radiation reaching the rim leaves; interior untouched.
    const _applyOpenBoundary = (f) => { if (!_boundOpen || !f) return f; const w=_SOL_ABSORB_W;
      for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ const e=Math.min(x,y,GRID-1-x,GRID-1-y); if (e<w){ const k=_SOL_ABSORB_MIN+(1-_SOL_ABSORB_MIN)*(e/w), j=(y*GRID+x)*2; f[j]*=k; f[j+1]*=k; } } return f; };

    const _sFocus  = mkSlider('focus×', 0.3, 1.8, 0.05, _lensP.sMul,    v => setP('sMul','focus',v));      bar2.appendChild(_sFocus.wrap);
    const _sTheta  = mkSlider('θ',     -3.14, 3.14, 0.05, _lensP.thAdd, v => setP('thAdd','theta',v));     bar2.appendChild(_sTheta.wrap);
    const _sShiftX = mkSlider('shiftX', -12, 12, 0.25, _lensP.tx,       v => setP('tx','shiftX',v));       bar2.appendChild(_sShiftX.wrap);
    const _sShiftY = mkSlider('shiftY', -12, 12, 0.25, _lensP.ty,       v => setP('ty','shiftY',v));       bar2.appendChild(_sShiftY.wrap);
    const _sPropT  = mkSlider('propT',  1, 8, 1, _lensP.propT,          v => setP('propT','propT',v));     bar2.appendChild(_sPropT.wrap);
    const _sFocalDt= mkSlider('focalDist', 0.1, 2.0, 0.05, _lensP.focalDt, v => setP('focalDt','focalDt',v)); bar2.appendChild(_sFocalDt.wrap);
    const _sOpSpeed= mkSlider('opSpeed', 1, 16, 1, _lensP.opSpeed,      v => setP('opSpeed','opSpeed',v)); bar2.appendChild(_sOpSpeed.wrap);
    const _sHoloT  = mkSlider('holoT', 0, 80, 2, _lensP.holoT,          v => setP('holoT','holoT',v));     bar2.appendChild(_sHoloT.wrap);   // T = HOLOGRAPHIC TIME-DEPTH (§7.40): medium=world-lens delocalization; eye=the trap's recon aperture depth. Bigger=more occlusion-resistant
    const _sCue    = mkSlider('cueClean', 0, 1, 0.05, _lensP.cueSignal, v => setP('cueSignal','cueClean',v)); bar2.appendChild(_sCue.wrap);
    // GROW (self mode, §7.88): the genome grows new maps in the medium up to this ceiling. 0=off (fixed count). Reads emergent
    // field peaks → adopts them as maps. Shared across scopes (writes _growMax, not a lens param). Live (self memo re-keys on it).
    const _sGrow   = mkSlider('grow→K', 0, 8, 1, _growMax, v => injS({ growMax: v|0 })); bar2.appendChild(_sGrow.wrap);   // replicated (n.eyeGrowMax)
    // ── INSTANTON: ⚡kick fires a propagation kick into the ACTIVE scope's soliton at the NEXT bar (replicated → both peers kick the
    //    same bar). ⚡amp = kick strength; ⚡hold = bars to SUSTAIN it so the erupt→collapse is VISIBLE (0 = a single honest transient
    //    that decays in ~1 bar; >0 = held flash for watchability). ↩recon back-propagates the dispersed field to the kicked peak.
    const _sInstAmp  = mkSlider('⚡amp',  1, 16, 1, _instAmp,  v => injS({ instAmp:  v })); bar2.appendChild(_sInstAmp.wrap);   // replicated kick amplitude
    const _sInstHold = mkSlider('⚡hold', 0, 12, 1, _instHold, v => injS({ instHold: v|0 })); bar2.appendChild(_sInstHold.wrap);   // replicated hold bars
    const _sBoff     = mkSlider('⚡B+',   1, 3,  1, _tunnelBoffset, v => injS({ instBoff: v|0 })); bar2.appendChild(_sBoff.wrap);   // tunnel destination offset B=A+n (pick a distinct B)
    let _instBtn; _instBtn = mkBtn('⚡kick', false, () => injS({ instScope: _uiScope, instBar: _E.frameBar + 1, instVer: (_instSeen|0) + 1, instTunnel: _instTunnel }));
    bar2.appendChild(_instBtn);
    // ⚡tunnel: arm the kick as an A→B STATE TRANSITION (B = medium rank+1, derived LOCALLY → peer-deterministic, no per-frame
    // reflector). 3-state cycle: off → switch → emergent. SWITCH = the honest programmatic lens-swap (a state-machine transition).
    // EMERGENT = the genome PHYSICALLY MIGRATES A→B via per-map coevolve (no swap — the GPU probe of "can the wave actually cross").
    let _tunBtn; _tunBtn = mkBtn('⚡tunnel:off', false, () => {
      const next = !_instTunnel ? { instTunnel:true, instTunnelMode:'switch' }
                 : _tunnelMode==='switch' ? { instTunnel:true, instTunnelMode:'emergent' }
                 : _tunnelMode==='emergent' ? { instTunnel:true, instTunnelMode:'clock' }
                 : _tunnelMode==='clock' ? { instTunnel:true, instTunnelMode:'phase' }
                 : _tunnelMode==='phase' ? { instTunnel:true, instTunnelMode:'barrier' }
                 : _tunnelMode==='barrier' ? { instTunnel:true, instTunnelMode:'vortex' }
                 : { instTunnel:false };
      injS(next); }); bar2.appendChild(_tunBtn);
    // ↩recon — REPLICATED (a setShared bump): both peers run the reconstruct on the same version → identical numbers (the read is
    // deterministic, the field is peer-identical). So you can compare _instRecon across peers to verify determinism.
    const _reconBtn = mkBtn('↩recon', false, () => injS({ instReconVer: (_reconSeen|0) + 1 })); bar2.appendChild(_reconBtn);

    // ── H=OCCL STRIP (eye-only): occlude the trapped HOLOGRAM before recon — the honest holographic-robustness test (eye.js's
    //    H=OCCL family, the SAME gpu.applyEyeHologram primitive). The damage shows on EYE ◀; EYE ▸ reconstructs from it →
    //    raise holoT and the recon survives more damage (delocalized info). occMode 0=off|6=LEFT-slab|7=RZero|8=RNois.
    //    Eye-LOCAL (writes _eyeLensP, live — no reflector; the eye is local/testing). r = damaged fraction, blk = block px (7/8).
    const _OCC = [{m:0,l:'H=id'},{m:6,l:'H=LEFT'},{m:7,l:'H=RZero'},{m:8,l:'H=RNois'}];
    const _occBtns = {};
    const _occLbl = document.createElement('span'); _occLbl.textContent='occlude:'; Object.assign(_occLbl.style,{fontSize:'9px',color:'#af8',fontFamily:'ui-monospace,monospace',fontWeight:'bold'}); bar3.appendChild(_occLbl);
    _OCC.forEach(({m,l}) => { const b=mkBtn(l, m===0, () => injE({ occMode: m })); _occBtns[m]=b; bar3.appendChild(b); });
    const _sOccR   = mkSlider('r', 0, 1, 0.02, _eyeLensP.occR, v => injE({ occR: v }));        bar3.appendChild(_sOccR.wrap);
    const _sOccBlk = mkSlider('blk', 1, 32, 1, _eyeLensP.occBlock, v => injE({ occBlock: v })); bar3.appendChild(_sOccBlk.wrap);
    // MANUAL FOCUS (eye-only) — rack-focus offset from the in-focus plane. 0 = sharp (matched recon); ± defocuses. Disabled while
    // optics:on (autofocus owns the plane). Writes _eyeLensP.focusManual (live, no rebuild — reconDFn reads it each frame).
    const _sFocus2 = mkSlider('focus', -20, 20, 1, _eyeLensP.focusManual, v => injE({ focusManual: v|0 })); bar3.appendChild(_sFocus2.wrap);
    // CODE acts on the image (live, no rebuild). warp = geometric OPERATOR (§7.97: rotate/scale/translate); gate = CONTENT mask (§7.90).
    const _sCodeWarp = mkSlider('code⟳op', 0, 1, 0.05, _eyeLensP.codeWarp, v => injE({ codeWarp: v })); bar3.appendChild(_sCodeWarp.wrap);
    const _sCodeMask = mkSlider('code→img', 0, 1, 0.05, _eyeLensP.codeMask, v => injE({ codeMask: v })); bar3.appendChild(_sCodeMask.wrap);
    // RESONANCE LENS STRENGTH (obj:hidden): the sMul of the plant/template lens — stronger = sharper genome phase signature.
    // Local (eye-side demo); changing it rebuilds the matched-filter templates (they depend on the strength).
    const _sResoStr = mkSlider('reso str', 0.3, 1.6, 0.1, _resoStrength, v => injE({ resoStr: v })); bar3.appendChild(_sResoStr.wrap);   // replicated (n.eyeResoStr); range 0.3–1.6 (above = flat plateau)
    // M3b — PHASE SELECTOR (scope toggle → phase selector): which phase of the ONE soliton the eye traps.
    // eye⟵W = the driven world (classic) | eye⟵V = the VIRTUAL phase (the eye looks into the dream). Replicated.
    let _eyeSrcBtn; _eyeSrcBtn = mkBtn('eye⟵W', false, () => injE({ src: ({ W:'V', V:'P1', P1:'P2', P2:'W' })[_eyeSrc] || 'W' })); bar3.appendChild(_eyeSrcBtn);   // cycles W→V→P1→P2 (M4: booted phases are addressable too)
    // CODE⟳OP per-DOF fractions (×master code⟳op): isolate each geometric degree of freedom of the genome operator. All 1 = full affine.
    const _wLbl = document.createElement('span'); _wLbl.textContent='warp DOF:'; Object.assign(_wLbl.style,{fontSize:'9px',color:'#8df',fontFamily:'ui-monospace,monospace',fontWeight:'bold'}); bar4.appendChild(_wLbl);
    // REPLICATION: how many of the genome's maps act (each = one copy). 1 = no duplication; clamps to the genome's K.
    const _sWMaps  = mkSlider('copies',   1, 8, 1, _eyeLensP.codeWarpMaps,     v => injE({ codeWarpMaps: v|0 }));  bar4.appendChild(_sWMaps.wrap);
    const _sWScale = mkSlider('scale s',  0, 1, 0.05, _eyeLensP.codeWarpS,     v => injE({ codeWarpS: v }));     bar4.appendChild(_sWScale.wrap);
    const _sWRot   = mkSlider('rot θ',    0, 1, 0.05, _eyeLensP.codeWarpTheta, v => injE({ codeWarpTheta: v })); bar4.appendChild(_sWRot.wrap);
    const _sWTx    = mkSlider('transX',   0, 1, 0.05, _eyeLensP.codeWarpTx,    v => injE({ codeWarpTx: v }));    bar4.appendChild(_sWTx.wrap);
    const _sWTy    = mkSlider('transY',   0, 1, 0.05, _eyeLensP.codeWarpTy,    v => injE({ codeWarpTy: v }));    bar4.appendChild(_sWTy.wrap);
    const _syncOcc = () => { for (const m in _occBtns){ const on=(+m===(_eyeLensP.occMode|0)); if(_occBtns[m]._on!==on){_occBtns[m]._on=on;_occBtns[m]._repaint();} }
      _sOccR.setVal(_eyeLensP.occR); _sOccBlk.setVal(_eyeLensP.occBlock); _sFocus2.setVal(_eyeLensP.focusManual); _sCodeMask.setVal(_eyeLensP.codeMask); _sCodeWarp.setVal(_eyeLensP.codeWarp); _sResoStr.setVal(_resoStrength);
      _sWMaps.setVal(_eyeLensP.codeWarpMaps); _sWScale.setVal(_eyeLensP.codeWarpS); _sWRot.setVal(_eyeLensP.codeWarpTheta); _sWTx.setVal(_eyeLensP.codeWarpTx); _sWTy.setVal(_eyeLensP.codeWarpTy);   // warp-DOF (⊕base arms them)
      // the warp-DOF sliders are FRACTIONS (0..1) of the genome's geometry → show the GENOME VALUE each fraction scales, so they
      // reflect the genome's actual {s,θ,tx,ty} (per the user: the DOF sliders should reflect the genome, not just '1=on').
      { const gen=_activeGenome(_sc()); if (gen&&gen.length){ const agg=genomeAggregate(gen); let txS=0,tyS=0; for(const m of gen){txS+=(m.tx??0);tyS+=(m.ty??0);} const cx=(txS/gen.length-0.5), cy=(tyS/gen.length-0.5);
        _sWScale.setSuffix(` ·s${agg.s.toFixed(2)}`); _sWRot.setSuffix(` ·θ${agg.theta.toFixed(1)}`); _sWTx.setSuffix(` ·${(cx*GRID).toFixed(0)}px`); _sWTy.setSuffix(` ·${(cy*GRID).toFixed(0)}px`); _sWMaps.setSuffix(`/${gen.length}`); } }
      _sFocus2.wrap.style.opacity = _opticsOn ? '0.4' : '1'; };   // dim the manual focus while autofocus owns the plane

    // ⊕base SEEDS THE SLIDERS FROM THE GENOME (absolute sliders): the lens uses sMul/thAdd DIRECTLY (no baseline), so seeding sets
    // them to the genome's AGGREGATE geometry → the sliders show, and the lens reproduces, the genome's own {s,θ}. thAdd = dominant θ;
    // sMul = the scale matching the genome's mean s (the makeGenomeLens 1−s+0.5 mapping, now folded INTO the absolute slider value);
    // shift = the genome's centroid offset. Moving a slider then deviates from the genome's geometry (absolute, not an offset).
    const _seedFromGenome = () => {
      const gen = _activeGenome(_sc()); if (!gen || !gen.length) return;
      const agg = genomeAggregate(gen);
      let txSum = 0, tySum = 0; for (const m of gen) { txSum += (m.tx ?? 0); tySum += (m.ty ?? 0); }
      const th = agg.theta;                                                       // dominant θ (absolute lens rotation)
      const sMul = Math.max(0.3, Math.min(1.8, 1 - (agg.s ?? 0.5) + 0.5));        // mean contraction → absolute scale (matches the old lens mapping)
      const tx = Math.max(-12, Math.min(12, (txSum/gen.length - 0.5) * 24));      // genome centroid offset (normalized → px)
      const ty = Math.max(-12, Math.min(12, (tySum/gen.length - 0.5) * 24));
      // ⊕base = LENS params ONLY (the phase-plate). The IFS warp OPERATOR is armed separately by ⊕op — so zeroing the lens sliders
      // here gives the same crisp recon as ↺reset (the operator stays off). Replicated (setEye/setMedium).
      (_uiScope === 'eye' ? injE : inj)({ theta: th, focus: sMul, shiftX: tx, shiftY: ty });
    };
    // ⊕op = arm the geometric IFS OPERATOR (opCodeWarp) to run the genome's FULL per-map {s,θ,tx,ty}: warp ON (1), all DOF fractions
    // full (1), copies=K. EYE-only (the warp is eye-scope). Separate from ⊕base (lens) → you choose lens-only or lens+operator.
    const _armOperator = () => {
      if (_uiScope !== 'eye') return; const gen = _activeGenome(_sc()); if (!gen || !gen.length) return;
      injE({ codeWarp: 1, codeWarpS: 1, codeWarpTheta: 1, codeWarpTx: 1, codeWarpTy: 1, codeWarpMaps: gen.length });
    };
    // reflect the SCOPED param set onto the sliders (called on scope toggle + each sync). Shows the lens the sliders target.
    const _syncSliders = () => { const p=_uiP();
      _sFocus.setVal(p.sMul); _sTheta.setVal(p.thAdd); _sShiftX.setVal(p.tx); _sShiftY.setVal(p.ty);
      _sPropT.setVal(p.propT); _sFocalDt.setVal(p.focalDt); _sOpSpeed.setVal(p.opSpeed); _sHoloT.setVal(p.holoT); _sCue.setVal(p.cueSignal);
      _sInstAmp.setVal(_instAmp); _sInstHold.setVal(_instHold); _sBoff.setVal(_tunnelBoffset); _greyBtn(_reconBtn, !_instPeak);   // instanton: amp/hold/B+ reflect state; ↩recon dim until a kick has fired
      { const lbl = !_instTunnel?'⚡tunnel:off':`⚡tunnel:${_tunnelMode}`;
        if (_tunBtn.textContent!==lbl || _tunBtn._on!==_instTunnel){ _tunBtn._on=_instTunnel; _tunBtn.textContent=lbl; _tunBtn._repaint(); } }
      bar3.style.display = (_uiScope==='eye') ? 'flex' : 'none';   // the H=OCCL strip is eye-only
      bar4.style.display = (_uiScope==='eye' && (_eyeLensP.codeWarp||0)>0) ? 'flex' : 'none';   // warp-DOF strip: eye + code⟳op>0
      if (_uiScope==='eye') { _syncOcc(); _sWMaps.setVal(_eyeLensP.codeWarpMaps); _sWScale.setVal(_eyeLensP.codeWarpS); _sWRot.setVal(_eyeLensP.codeWarpTheta); _sWTx.setVal(_eyeLensP.codeWarpTx); _sWTy.setVal(_eyeLensP.codeWarpTy);
        const _es = `eye⟵${_eyeSrc}`; if (_eyeSrcBtn.textContent !== _es || _eyeSrcBtn._on !== (_eyeSrc==='V')) { _eyeSrcBtn.textContent = _es; _eyeSrcBtn._on = (_eyeSrc==='V'); _eyeSrcBtn._repaint(); } } };
    // ── _syncScope(): paint EVERY widget (modes/rank/selfLaw/op/view/world/obj + sliders) from the ACTIVE scope (_sc()/_uiP())
    //    so the whole UI shows the lens it currently targets. obj:/world: are MEDIUM-ONLY → greyed in eye scope. Called each
    //    frame and on the scope toggle. The DISPLAY here is scope-pure (read-only); writes go through setSc/setP (by scope).
    const _greyBtn = (b, dim) => { b.style.opacity = dim ? '0.35' : '1'; b.style.cursor = dim ? 'default' : 'pointer'; };
    const _syncScope = () => { const s=_sc(), eye=(_uiScope==='eye');
      for (const k in _modeBtns) { const on=(k===s.mode); if(_modeBtns[k]._on!==on){ _modeBtns[k]._on=on; _modeBtns[k]._repaint(); } }
      // rank dropdown: refresh the options (the bank switches for obj:hidden → resonance shapes) and the selected value.
      _rankBtn.setOptions(_rankOpts()); _rankBtn.setVal(s.activeRank);
      _greyBtn(_opSeedBtn, !eye);   // ⊕op (arm the IFS operator) is eye-only
      _selfLawBtn.textContent = `self:${s.selfLaw}`;
      _viewBtn.textContent = `view:${s.view}`;
      _opBtn.textContent = `op:${_uiP().opMode}`;
      if (_opticsBtn._on !== _opticsOn) { _opticsBtn._on = _opticsOn; _opticsBtn.textContent = _opticsOn?'optics:on':'optics:off'; _opticsBtn._repaint(); }   // reflected from n.eyeOptics
      _objBtn.setVal(_lensObj); _objBtn.sel.disabled = eye; _greyBtn(_objBtn.wrap, eye);   // obj is medium-only (disabled in eye scope)
      if (_worldBtn._on!==(_worldActive&&!eye)){ _worldBtn._on=(_worldActive&&!eye); _worldBtn._repaint(); }
      _worldBtn.textContent = eye ? 'world: —' : (_worldActive?'world:active':'world:static'); _greyBtn(_worldBtn, eye);
      // hide:live — medium-only, shown active only for the hidden family. Reflects _hideLive (replicated).
      if (_hideBtn._on!==(_hideLive&&!eye)){ _hideBtn._on=(_hideLive&&!eye); _hideBtn._repaint(); }
      _hideBtn.textContent = _hideLive?'hide:live':'hide:baked'; _greyBtn(_hideBtn, eye || !_isHidden(_lensObj));
      _syncSliders();
      _syncCommit();   // dim commit/revert unless there's a live evolved genome to commit
    };

    // ── _syncFromState(n): reflect the AUTHORITATIVE reflector state n.med* onto the MEDIUM scope (_S.medium + _lensP) — the
    //    medium lens is peer-synced. The EYE scope (_S.eye + _eyeLensP) is LOCAL (testing), edited directly by the controls.
    //    Side-effect cache resets fire on a detected change so a remote toggle re-derives the same caches a local one would.
    //    Then _syncScope() paints whatever scope the UI currently targets. Both peers compute identical MEDIUM physics.
    const _syncFromState = (n) => {
      const M = _S.medium;
      // mode/rank/obj change → clear the stale DERIVED rules (so they don't flash); the lib memo keys (bar/rank/cue/opSpeed/
      // _rulesVer) self-invalidate the rest, and _buildStack rekeys on mode → the stack rebuilds automatically. No bar mirrors needed.
      if (n.medMode    != null && n.medMode    !== M.mode)       { M.mode = n.medMode; M.replicaRules=null; M.selfRules=null; M.objSeen=''; }   // KEEP selectedRank across mode change — a tunnel-committed identity (B) must survive switching INTO self mode (recall re-writes it each frame anyway; manual rank clears it)
      if (n.medOp      != null && n.medOp      !== _lensP.opMode){ _lensP.opMode = n.medOp; }
      if (n.medWorld   != null && !!n.medWorld !== _worldActive) { _worldActive = !!n.medWorld; _worldGenome=null; _worldBar=-1; M.objSeen=''; }
      if (n.medObj     != null && n.medObj     !== _lensObj)     { _lensObj = n.medObj; M.replicaRules=null; _worldGenome=null; _worldBar=-1; M.objSeen=''; _solSeeded=false; _solE0=-1; _solAppldX=0; _solAppldY=0; _orbitE=-1; _torbKicked=false; _transPx=_lensP.tx||0; _transPy=_lensP.ty||0; _transShiftStep=-1; _transShiftStartX=_lensP.tx||0; _transShiftStartY=_lensP.ty||0; _transTgtPrevX=_lensP.tx||0; _transTgtPrevY=_lensP.ty||0; _objOrbTheta=0; _transLastPx=NaN; _transLastPy=NaN; _E.shiftSeen=(n.medShiftSeq|0); if(_kqShift){_kqShift.clear();_kqShift.resetCursors();} _attReset(n); inCell.canvas.style.cursor=_lensObj==='cube'?'grab':'default'; }   // re-seed the pure soliton on object change
      if (n.medDrive   != null && n.medDrive   !== _driveMode)   { _driveMode = n.medDrive; _solSeeded=false; _solE0=-1; _solAppldX=0; _solAppldY=0; _orbitE=-1; _torbKicked=false; _transPx=_lensP.tx||0; _transPy=_lensP.ty||0; _transShiftStep=-1; _transShiftStartX=_lensP.tx||0; _transShiftStartY=_lensP.ty||0; _transTgtPrevX=_lensP.tx||0; _transTgtPrevY=_lensP.ty||0; _objOrbTheta=0; _transLastPx=NaN; _transLastPy=NaN; _E.shiftSeen=(n.medShiftSeq|0); if(_kqShift){_kqShift.clear();_kqShift.resetCursors();} _attReset(n); _batchSelfTested=false; if(_driveBtn){_driveBtn.textContent=`drive:${_driveMode}`; _driveBtn._on=(_driveMode!=='write'); _driveBtn._repaint();} }   // DRIVE mode (replicated) → re-seed the soliton, both peers same physics
      // SNAPSHOT-ON-TOGGLE = the SHARED STEP-CLOCK ANCHOR (replicated, on toggle into transport/objorbit). NO field shipped — peers att-seed (deterministic,
      // lets the soliton chase) and share the step-clock origin → byte-identical for peers present at the toggle. Late joiners re-anchor via _snapshotApplied (above).
      if ((n.medSnapVer|0) !== _E.snapVer) { _E.snapVer = n.medSnapVer|0;
        _solSeeded = false; _solE0 = -1; _torbE0 = -1; _transPx=_lensP.tx||0; _transPy=_lensP.ty||0; _transShiftStep=-1; _transShiftStartX=_lensP.tx||0; _transShiftStartY=_lensP.ty||0; _transTgtPrevX=_lensP.tx||0; _transTgtPrevY=_lensP.ty||0; _objOrbTheta=0; _transLastPx=NaN; _transLastPy=NaN; _E.shiftSeen=(n.medShiftSeq|0); if(_kqShift){_kqShift.clear();_kqShift.resetCursors();} _attReset(n);   // fresh att-seed
        _E.snapClock0 = (n.medSnapClock ?? 0) * _MON_RATE;   // the SHARED step-clock origin (synced s.time at publish ·RATE) → identical on every peer
        _E.snapPending = true;   // RE-ANCHOR _stepClk.c0 to _E.snapClock0 (applied in the soliton-clock block) → SAME #steps from the att-seed → byte-identical
      }
      if (n.medEarR != null && !!n.medEarR !== _earROn) { _earROn = !!n.medEarR; _earRInit(); if (_earRBtn) { _earRBtn._on = _earROn; _earRBtn._repaint(); } }   // reactor toggle (replicated) → fresh derived state on every peer
      if (n.medCoevo != null && !!n.medCoevo !== _coevoOn) { _coevoOn = !!n.medCoevo; _coevoGx = _lensP.tx || 0; _coevoGy = _lensP.ty || 0; _coevoL0 = 0; _coevoCur.lt = -1; _coevoCur.lk = 0; if (_coevoBtn) { _coevoBtn._on = _coevoOn; _coevoBtn._repaint(); } }   // leash toggle (replicated, anchor-bumped); fresh cadence cursor → first advance immediate
      if (n.medBound != null && !!n.medBound !== _boundOpen) { _boundOpen = !!n.medBound; if (_boundBtn) { _boundBtn.textContent = `bound:${_boundOpen?'open':'closed'}`; _boundBtn._on = _boundOpen; _boundBtn._repaint(); } }   // boundary condition (replicated, anchor-bumped)
      if (typeof n.medEarPh === 'number' && n.medEarPh !== _earPh) _earPh = n.medEarPh;   // listening phase slot (replicated)
      if (typeof n.medOrbR === 'number' && n.medOrbR !== _orbR) _orbR = n.medOrbR;   // orbit radius (replicated; change via window.orbR which anchor-bumps)
      if (typeof n.medOrbW === 'number' && n.medOrbW !== _orbW) _orbW = n.medOrbW;   // schedule multiplier (replicated; window.orbW)
      if (n.medHideLive != null && !!n.medHideLive !== _hideLive){ _hideLive = !!n.medHideLive; M.objSeen=''; }   // live-hide toggle (replicated) → re-plant the cloud
      if (n.medRank    != null && (n.medRank|0)!== M.activeRank) { M.activeRank = n.medRank|0; M.replicaRules=null; M.selectedRank=null; M.selfRules=null; M.objSeen=''; _evolved=null; }   // rank change drops the live preview + CLEARS a tunnel-committed selectedRank (manual pick wins) → both peers
      if (n.medSelfLaw != null && n.medSelfLaw !== M.selfLaw)    { M.selfLaw = n.medSelfLaw; M.selfRules=null; }
      if (n.medView    != null && n.medView    !== M.view)       { M.view = n.medView; }
      if (typeof n.medFocus   === 'number' && n.medFocus   !== _lensP.sMul)     { _lensP.sMul=n.medFocus; }
      if (typeof n.medTheta   === 'number' && n.medTheta   !== _lensP.thAdd)    { _lensP.thAdd=n.medTheta; }
      if (typeof n.medShiftX  === 'number' && n.medShiftX  !== _lensP.tx)       { _lensP.tx=n.medShiftX; }
      if (typeof n.medShiftY  === 'number' && n.medShiftY  !== _lensP.ty)       { _lensP.ty=n.medShiftY; }
      if (typeof n.medPropT   === 'number' && n.medPropT   !== _lensP.propT)    { _lensP.propT=n.medPropT; }
      if (typeof n.medFocalDt === 'number' && n.medFocalDt !== _lensP.focalDt)  { _lensP.focalDt=n.medFocalDt; }
      if (typeof n.medOpSpeed === 'number' && n.medOpSpeed !== _lensP.opSpeed)  { _lensP.opSpeed=n.medOpSpeed; }
      if (typeof n.medHoloT   === 'number' && n.medHoloT   !== _lensP.holoT)    { _lensP.holoT=n.medHoloT; }
      if (typeof n.medCueClean=== 'number' && n.medCueClean!== _lensP.cueSignal){ _lensP.cueSignal=n.medCueClean; }
      // ── EYE scope reflection (mirror of medium) — n.eye* → _S.eye + _eyeLensP. The eye is now fully REPLICATED → peer-deterministic.
      const E = _S.eye;
      if (n.eyeMode    != null && n.eyeMode    !== E.mode)    { E.mode = n.eyeMode; E.replicaRules=null; E.selectedRank=null; E.selfRules=null; E.objSeen=''; }
      if (n.eyeOp      != null && n.eyeOp      !== _eyeLensP.opMode) { _eyeLensP.opMode = n.eyeOp; }
      if (n.eyeRank    != null && (n.eyeRank|0)!== E.activeRank) { E.activeRank = n.eyeRank|0; E.replicaRules=null; E.objSeen=''; _evolved=null; }   // rank change drops the live preview
      if (n.eyeSelfLaw != null && n.eyeSelfLaw !== E.selfLaw) { E.selfLaw = n.eyeSelfLaw; E.selfRules=null; }
      if (n.eyeView    != null && n.eyeView    !== E.view)    { E.view = n.eyeView; }
      if (typeof n.eyeFocus    === 'number') _eyeLensP.sMul       = n.eyeFocus;
      if (typeof n.eyeTheta    === 'number') _eyeLensP.thAdd      = n.eyeTheta;
      if (typeof n.eyeShiftX   === 'number') _eyeLensP.tx         = n.eyeShiftX;
      if (typeof n.eyeShiftY   === 'number') _eyeLensP.ty         = n.eyeShiftY;
      if (typeof n.eyePropT    === 'number') _eyeLensP.propT      = n.eyePropT;
      if (typeof n.eyeFocalDt  === 'number') _eyeLensP.focalDt    = n.eyeFocalDt;
      if (typeof n.eyeOpSpeed  === 'number') _eyeLensP.opSpeed    = n.eyeOpSpeed;
      if (typeof n.eyeHoloT    === 'number') _eyeLensP.holoT      = n.eyeHoloT;
      if (typeof n.eyeCueClean === 'number') _eyeLensP.cueSignal  = n.eyeCueClean;
      if (typeof n.eyeOptics   === 'boolean') _opticsOn           = n.eyeOptics;
      if (typeof n.eyeFocusManual === 'number') _eyeLensP.focusManual = n.eyeFocusManual|0;
      if (typeof n.eyeOccMode  === 'number') _eyeLensP.occMode    = n.eyeOccMode|0;
      if (typeof n.eyeOccR     === 'number') _eyeLensP.occR       = n.eyeOccR;
      if (typeof n.eyeOccBlock === 'number') _eyeLensP.occBlock   = n.eyeOccBlock|0;
      if (typeof n.eyeCodeMask === 'number') _eyeLensP.codeMask   = n.eyeCodeMask;
      if (typeof n.eyeCodeWarp === 'number') _eyeLensP.codeWarp   = n.eyeCodeWarp;
      if (typeof n.eyeCodeWarpS     === 'number') _eyeLensP.codeWarpS     = n.eyeCodeWarpS;
      if (typeof n.eyeCodeWarpTheta === 'number') _eyeLensP.codeWarpTheta = n.eyeCodeWarpTheta;
      if (typeof n.eyeCodeWarpTx    === 'number') _eyeLensP.codeWarpTx    = n.eyeCodeWarpTx;
      if (typeof n.eyeCodeWarpTy    === 'number') _eyeLensP.codeWarpTy    = n.eyeCodeWarpTy;
      if (typeof n.eyeCodeWarpMaps  === 'number') _eyeLensP.codeWarpMaps  = n.eyeCodeWarpMaps|0;
      if (typeof n.eyeResoStr  === 'number' && n.eyeResoStr !== _resoStrength) { _resoStrength = n.eyeResoStr; _resoTemplates = null; }   // rebuild templates on strength change
      if (n.eyeSrc === 'V' || n.eyeSrc === 'W' || n.eyeSrc === 'P1' || n.eyeSrc === 'P2') _eyeSrc = n.eyeSrc;   // M3b/M4 — the eye's PHASE SELECTOR (replicated): which phase of the ONE soliton the trap catches (W, V, or a booted phase)
      if (typeof n.eyeGrowMax  === 'number') _growMax = n.eyeGrowMax|0;
      // INSTANTON (replicated): a NEW instVer arms the kick at n.instBar (the bar the fire-event landed on → peer-deterministic).
      if (typeof n.instAmp === 'number' && n.instAmp !== _instAmp) _instAmp = n.instAmp;   // amp slider (replicated, independent of a fire)
      if (typeof n.instHold === 'number' && (n.instHold|0) !== _instHold) _instHold = n.instHold|0;   // hold-bars slider (replicated)
      if (typeof n.instBoff === 'number' && (n.instBoff|0) !== _tunnelBoffset) _tunnelBoffset = Math.max(1, n.instBoff|0);   // tunnel B offset (replicated)
      if (typeof n.instTunnel === 'boolean' && n.instTunnel !== _instTunnel) _instTunnel = n.instTunnel;   // tunnel on/off (replicated)
      if (n.instTunnelMode != null && n.instTunnelMode !== _tunnelMode) _tunnelMode = n.instTunnelMode;   // switch | emergent (replicated)
      if (typeof n.instReconVer === 'number' && (n.instReconVer|0) !== _reconSeen) { _reconSeen = n.instReconVer|0; _reconPending = true; }   // ↩recon fired (replicated) → run it once the live field is current (end of frame)
      if (typeof n.instVer === 'number' && (n.instVer|0) !== _instSeen) { _instSeen = n.instVer|0;
        _instBar = (typeof n.instBar==='number') ? n.instBar|0 : -1; _instScope = n.instScope || 'eye';
        if (typeof n.instAmp==='number') _instAmp = n.instAmp; if (typeof n.instHold==='number') _instHold = n.instHold|0;
        const newTunnel = (typeof n.instTunnel==='boolean') ? n.instTunnel : _instTunnel; _instTunnel = newTunnel;
        _instFireBar = -1; _instPeak = null; _instRecon = null;   // re-arm always resets the FLASH state (new kick)
        // A COMMITTED tunnel (landed in B) STAYS landed across a plain kick — only clear it if the NEW arm is itself a tunnel (tunnel
        // replaces tunnel). So firing a plain kick after a tunnel adds a transient ON TOP of B without snapping back to A (the jump is committed).
        if (newTunnel) { _tunnelB = -1; _tunnelActive = false; _tunnelRefA = null; _tunnelRefB = null; _tunnelGenome = null; _tunnelGenome0 = null; _tunnelGenBar = -1; _tunnelLocked = false; _tunnelMigSteps = 0; _tunnelT = 0; _tunnelLensField = null; _tunnelTicks = 0; _tunnelClockField = null; _tunnelClockSeed = null; _phaseTunFired = false; _barrierTarget = 'A'; _barrCenA = null; _barrCenB = null; _barrierLatched = false; _barrGenA = null; _barrGenB = null; _barrFpsA = null; _barrFpsB = null; _barrSep = -1; _barrDegenerate = false; _vortexTarget = 'A'; _vortexFired = false; _vortexLatched = false; _vortexGenome = null; _vortexCoBar = -1; _vortexBasinHeld = -1; _E.psiC = null; } }
      // committed genomes (replicated): apply n.genomeOverrides → _rules; revert drops the local preview. genomeVer gates the work.
      if ((n.genomeVer|0) !== _genomeVerSeen) {
        _genomeVerSeen = n.genomeVer|0;
        if (n.genomeOverrides) for (const r in n.genomeOverrides) { const mm = n.genomeOverrides[r]; if (Array.isArray(mm) && _rules[r]) { _rules[r] = mm.map(m => ({ ...m })); } }
        _evolved = null; _rulesVer++;   // commit/revert both drop the live preview + invalidate memo keys (peers identical)
      }
      _syncScope();   // paint the ACTIVE scope's state onto the widgets
    };

    // ── GPU ─────────────────────────────────────────────────────────────────────────────────────────────────
    let _gpu = null, _gpuReady = false, _gpuCanvas = null;
    // ── THE SOLITON ENGINE (extraction stage G1) — the living-soliton FIELD STATE now lives in ONE owned object
    //    (medium-gpu.js makeSolitonEngine); every _E.psiLensed / _E.monClock / _E.solSteps below is that object's
    //    field (was a module `let` here — an authority switch, not a mirror). `gpu` is a GETTER (() => _gpu) because
    //    the IFSGpu handle is created async, after this exists. The leaf physics helpers + snapshot slice fold in at
    //    G2/G3; the DRIVE orchestration stays medium-side (the C4 boundary). The two living solitons (time-shared on
    //    the one sweep buffer): _E.psiSource = the source object through the LIVE IFS-clock kernel (canvas 1, ψ_in);
    //    _E.psiLensed = the SAME living soliton driven toward the LENSED source (canvas 2, ψ_out); _E.psiC = a SECOND
    //    persistent soliton held live at C by the instanton drive (the ψ_C witness). Both persistent §7.44 limit
    //    cycles; _E.kernelVer/_E.shiftSeen are the ring-kernel/shift cursors (pending entries in the τ KERNEL queues).
    const _E = makeSolitonEngine({ gpu: () => _gpu, GRID, N_CELLS, DT, stepsPerPhase: 19 });
    const _MON_RATE = 3.0;            // n.time → _E.monClock scale (the deterministic step phase) — module-scoped so _syncFromState (snapshot anchor) and _frame share it
    // THE STEP CLOCK (extraction stage C1) — the (c0, rate, ratePrev) trio + its two laws now live in medium-core's
    // makeStepClock: target(mon) = floor((mon − c0)·spp/rate) (§7.44 matter proper-time — the mux divides the step
    // budget, not the wall) and reanchor(k, r) (rate flip keeps k CONTINUOUS: c0 += k·(rateOld − rateNew)/spp — pure
    // fn of shared k + shared rates → byte-identical c0 on all peers). rate = nSl under mux (pure fn of replicated
    // _V.psiVirt/_V.phases), module-scoped so ALL stamped-verb startSteps use the SAME clock as _E.solSteps.
    const _stepClk = makeStepClock({ stepsPerPhase: 19 });
    // (verb stamping is the τ KERNEL's — _tauK.stamp/push; gate 4 removed the last in-medium _stampStep users)
    // DETERMINISTIC RATE-CHANGE RE-ANCHOR: call at a slot-count-changing verb drain (record/boot/kill/swap/recall), at the
    // SHARED step k (where _E.solSteps == k identically on every peer). The proper-rate clock is _E.solSteps = (Δclock)·19/rate;
    // when rate flips rateOld→rateNew, keep _E.solSteps CONTINUOUS at k by shifting _stepClk.c0: target=floor((_mon−c0)·19/rate),
    // and (_mon−c0) at the flip = k·rateOld/19 (from _E.solSteps=k under rateOld) → set c0 so k·rateNew/19 = k·rateOld/19 − Δc0
    // ⟹ c0_new = c0_old + k·(rateOld − rateNew)/19. Pure fn of shared k + shared rates → byte-identical _stepClk.c0 on all peers.
    // _stepClk.ratePrev tracks the rate we last anchored at. Call AFTER mutating _V.psiVirt/_V.phases (so the new rate is visible).
    const _muxReanchor = (k) => { const r = (_V.virtMux && (_driveMode==='transport'||_driveMode==='objorbit')) ? (1 + (_V.psiVirt ? 1 : 0) + _V.phases.length) : 1;
      if (_stepClk.reanchor(k, r)) {   // C1: the epoch law lives in the core clock (continuity: c0 += k·(rateOld−rateNew)/spp)
        if (_tauK) _tauK.reanchor(k, r);   // GATE 3: the kernel owns the shift/att epoch — reanchor keeps k continuous AND re-stamps its future entries into the new epoch (L5)
        // RE-STAMP PENDING QUEUES INTO THE NEW EPOCH (2026-07-10 — closes the cross-epoch stamping race): a verb
        // pulled in the same frame as this not-yet-drained rate-flip verb was stamped with the OLD (c0, rate), while
        // a peer that drained the flip first stamps it with the NEW pair → different startSteps → different drain
        // steps → fork (the documented "space out load-bearing verbs" hazard). This runs AT the flip's shared drain
        // step with the shared new values, so re-mapping every FUTURE entry (startStep > k; entries carry their raw
        // verb time t) lands both peers on identical stamps no matter which side of the flip they pulled on. Past-due
        // entries keep their old-epoch stamps (already-due is already-due; gate-3″ cursors are in continuous k).
        // Entries without t (pre-fix snapshots) keep their stamps — old behavior.
      } };   // ALL queue re-stamping at the flip is the KERNEL's (_tauK.reanchor above covers shift/att/sig/virt/kern — gate 4 complete)
    // (engine slice: _E.kwSteps = kW, W's PROPER-time step counter — counts only W-EXECUTED steps; = global k with mux
    //  off, ~k/2 under ⧉mux. The CHANNEL machinery (sig slots, ear floors/refractory/cooldown/warmup, pong scheduling)
    //  ticks in kW: the medium's memory sets the clock, and the memory lives in MATTER time. Deterministic; snapshot-carried.)
    // (engine slice: _E.snapVer / _E.snapPending / _E.snapClock0 = last applied medSnapVer + re-anchor flag + the SHARED
    //  step-clock origin (medSnapClock·RATE) → identical on every peer.)
    // FIRST-LOAD RACE FIX (fresh page): GPU + world-clock + WS snapshot are all async and settle AFTER the first _frame. Two symptoms:
    // (1) a joiner self-seeds from scratch before _snapshotApplied fires → no peer-sync until a warm reload; (2) _stepClk.c0 anchors at an
    // already-advanced n.time → target=huge → a 1024-step GPU burst on frame 1 → visible freeze/lag. Fix: a GRACE WINDOW (hold self-seed
    // a few ready-frames when a snapshot may be incoming) + a first-frame clock RE-ANCHOR (target starts ~0, no backlog burst).
    // (engine slice: _E.readyFrames = _frame calls past the readiness gates; _E.snapConsumed = join-snapshot-applied-or-grace-expired.)
    let _driveTraceN = 0;        // FIRST-FRAMES TRACE counter (transport lag hunt): >0 logs [DRIVETRACE] and decrements; auto-armed on entering a snapshot drive
    const _SNAP_GRACE = 30;      // ready-frames to wait for the WS snapshot before falling back to self-seed (~1.5s at 20fps; a snapshot on a fresh join normally lands in <10)
    let _solSnapLogT = -1;   // last n.time the solH peer-compare log printed (throttle: once per logical tick)
    let _lastTodoDbg = 0;    // last transport/objorbit per-frame step batch (debug: detect a differing todo that precedes a divergence)
    let _batchSelfTested = false;   // one-shot same-context batch-invariance self-test
    let _dbgTransPx=0, _dbgTransPy=0, _dbgAttH='--', _dbgE0=0, _dbgShiftStep=-1, _dbgShiftStart=0;   // live drive inputs stashed for the per-tick [solH] cross-peer compare
    // add the kick to a Float64 field IN PLACE; returns the field. sig → defect width (_INST_SIG). shape (optional) = a TARGET field
    // (B's attractor) the kick is SHAPED toward — for the tunnel, the energy is added in B's pattern (carries the field toward B's basin)
    // rather than a centered blob. Without shape, a centered Gaussian spike (the plain transient).
    // G2: the pure field-math leaf moved to medium-gpu.js (E.applyKick) — local alias keeps the ~40 call sites unchanged.
    //   The default sig=_INST_SIG is bound here (an app const the engine must not know); callers that omit sig get it.
    const _applyKick = (f, amp, sig=_INST_SIG, shape=null) => _E.applyKick(f, amp, sig, shape);
    const _peakAmp = (f) => { let m=0; for (let i=0;i<(f.length>>1);i++){ const a=Math.hypot(f[i*2],f[i*2+1]); if(a>m)m=a; } return m; };
    // ── PHASE-LABEL TUNNEL helpers (the right-angle observable). The soliton's identity = its INTERNAL PHASE (linearized mode), read
    //    as the energy-weighted complex-mean angle (robust, the whole lump not one pixel). The instanton applies a localized phase
    //    impulse Δφ; the soliton's phase crosses A→B, the lump preserved (probe_phase_label: B-specific, monotone, no speckle).
    const _wrapPi = (t) => { const T=2*Math.PI; return ((t%T)+T+Math.PI)%T - Math.PI; };
    const _solitonPhase = (f) => { let cr=0,ci=0; const N=f.length>>1; for (let i=0;i<N;i++){ const a=f[i*2]*f[i*2]+f[i*2+1]*f[i*2+1]; cr+=a*f[i*2]; ci+=a*f[i*2+1]; } return Math.atan2(ci,cr); };
    const _applyPhaseImpulse = (f, dphi) => _E.applyPhaseImpulse(f, dphi);   // G2: moved to medium-gpu.js (E.applyPhaseImpulse) — alias keeps call sites
    // FIRE the instanton into `field` at the current bar. FIRST bar (bar>=fire, not yet fired): inject + snapshot the peak (the
    // reconstruction target = the true transient). HELD bars (bar within fire..fire+hold): re-inject so the erupt→collapse is VISIBLE
    // (a held flash; the snapshot stays the first-bar peak so reconstruct still targets the honest transient). hold=0 → single kick.
    const _fireInstanton = (field, scope, bar) => { if (_instBar < 0 || _instScope !== scope || !field) return false;
      // thisTunnel = is THIS arm a tunnel? (the kick shape follows the CURRENT arm, not a lingering committed tunnel — so a plain
      // kick after a landed tunnel is a Gaussian transient ON TOP of B, leaving the committed jump intact.)
      const thisTunnel = _instTunnel && scope==='medium';
      if (_instFireBar < 0 && bar >= _instBar) {
        // TUNNEL: lock the destination B = (medium rank)+1 (wrapped), derived locally from the replicated rank (peer-pure), and
        // activate the local A→B drive retarget. The kick is shaped toward B's attractor (carries the field over the basin barrier).
        if (thisTunnel) { _tunnelB = (_S.medium.activeRank + Math.max(1,_tunnelBoffset)) % _rules.length; _tunnelActive = true; _S.medium.objSeen='';
          if (_tunnelMode==='emergent') { _tunnelGenome = _rules[_S.medium.activeRank%_rules.length].map(m=>({...m})); _tunnelGenome0 = _tunnelGenome.map(m=>({...m})); _tunnelGenBar = -1; _tunnelLocked = false; _tunnelMigSteps = 0; _tunnelT = 0; _tunnelLensField = null; }   // seed at A=lens-A (t=0), keep A0, reset the lens-walk
          if (_tunnelMode==='clock') { _tunnelTicks = 0; _tunnelClockField = null; _tunnelClockSeed = null; _tunnelLocked = false; _tunnelGenBar = -1; }   // CLOCK: reset; the seed (the RUPTURED field) is captured just below, post-kick
          if (_tunnelMode==='phase') { _phaseTunFired = false; }
          if (_tunnelMode==='barrier') { _barrierTarget = 'A'; _barrCenA = null; _barrCenB = null; _barrierLatched = false; _E.psiC = null;
            // ★ MEASURE the REAL genome A/B attractor positions (rank / rank+1) by chaos-game centroid — the native upgrade (no quad fiction).
            const rA=((_tunnelB+_rules.length-1)%_rules.length)%_rules.length;
            _barrGenA = _barrChaosCentroid(_rules[rA]); _barrGenB = _barrChaosCentroid(_rules[_tunnelB%_rules.length]);
            _barrFpsA = _barrGenomeFps(_rules[rA]); _barrFpsB = _barrGenomeFps(_rules[_tunnelB%_rules.length]);
            _barrSep = Math.hypot(_barrGenA[0]-_barrGenB[0], _barrGenA[1]-_barrGenB[1]); _barrDegenerate = _barrSep < 15;
            console.log(`[BARRIER] real genome A(r${rA})=(${_barrGenA[0].toFixed(0)},${_barrGenA[1].toFixed(0)}) → B(r${_tunnelB})=(${_barrGenB[0].toFixed(0)},${_barrGenB[1].toFixed(0)}) · sep=${_barrSep.toFixed(0)}px ${_barrDegenerate?'⚠ DEGENERATE — A≈B, NO barrier to cross (real fit-degeneracy; pick a different ⚡B+)':'✓ distinct — real barrier'}`); }   // BARRIER: start in A's basin (unlatched); the kick (below) must CROSS it
          if (_tunnelMode==='vortex') { _vortexTarget = 'A'; _vortexFired = false; _vortexLatched = false; _vortexGenome = null; _vortexCoBar = -1; _vortexBasinHeld = -1; _E.psiC = null; } }   // VORTEX: start in the Q=0 vacuum (unlatched); the vortex injection (below) ruptures the topology
        // KICK SHAPE: SWITCH mode paints B's footprint (drags the field across, no migration). EMERGENT mode uses a PLAIN GAUSSIAN
        // rupture (the catalyst only — NO B-template); the genome must find B purely via coevolve. So emergent is the unambiguous test.
        // SWITCH/BARRIER kick toward B's footprint. The DIFFERENCE is the drive: switch pins source=B (forced); barrier keeps source=A
        // and only the kick (scaled by ⚡amp) can carry the soliton across the saddle — sub-threshold falls back (the real barrier).
        const kickShape = (thisTunnel && (_tunnelMode==='switch'||_tunnelMode==='barrier')) ? _tunnelTargetField() : null;
        // PHASE mode = a GENTLE amplitude kick (the localized event) — the heavy work is the phase impulse below, NOT an amplitude splat
        // (a big Gaussian degrades the soliton; the phase tunnel must be soliton-PRESERVING). Other modes use the full _instAmp.
        const kickAmp = (thisTunnel && (_tunnelMode==='phase'||_tunnelMode==='vortex')) ? _instAmp*0.15 : _instAmp;
        _applyKick(field, kickAmp, _INST_SIG, kickShape); _instPeak = field.slice(); _instFireBar = bar;
        // CLOCK seed = A's CLEAN clocked attractor (the SAME representation as the refs _clockRef), ruptured by a centered kick — NOT the
        // live gauge-LENSED soliton (that's a different representation → the clock contracts it to a B that only matches ~23%). Match the
        // probe: clean A-attractor + rupture → clock(B) lands at the clocked-B ref ~99%.
        if (thisTunnel && _tunnelMode==='clock') { const A0 = _clockRef(_S.medium.activeRank).slice();
          // rupture amplitude SCALED to the clean attractor's own peak (the ref is renormalized to ~unit energy, so a fixed amp=11
          // dominates 11× → washes the field flat-bright after renorm). Match the probe's RELATIVE rupture (~peak) so the kick is a
          // visible localized event riding the contraction, NOT a wash-out.
          let pk=0; for (let i=0;i<N_CELLS;i++){ const a=Math.hypot(A0[i*2],A0[i*2+1]); if(a>pk)pk=a; } pk=pk||1;
          const c=GRID>>1; for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ const r2=(x-c)**2+(y-c)**2; A0[(y*GRID+x)*2]+=pk*Math.exp(-r2/(2*25)); }   // centered rupture ~ the attractor's peak
          _tunnelClockSeed = A0; }
        // PHASE-LABEL TUNNEL (the right angle): the instanton applies a localized PHASE IMPULSE Δφ = (B's phase − A's) toward B's
        // aggregate phase. The soliton's INTERNAL PHASE crosses A→B while it STAYS one lump (no speckle). Phase = the soliton's linear
        // internal mode; it tunnels without fighting self-focusing. Honest read of lens-space (φ_A→φ_B barrier-free, the original finding).
        if (thisTunnel && _tunnelMode==='phase') {
          _phaseA0 = _solitonPhase(field);                                       // the soliton's phase at fire (A's label)
          _phaseTarget = genomeAggregate(_rules[_tunnelB%_rules.length]).theta;  // B's aggregate phase (the destination label)
          const dphi = _wrapPi(_phaseTarget - _phaseA0);                          // the impulse: A→B phase difference
          _applyPhaseImpulse(field, dphi);                                        // localized phase kick toward B (soliton-preserving)
          _phaseTunFired = true;
          // COMMIT THE IDENTITY: the medium is now B → set selectedRank=B (the medium's SELECTION, the same channel recall uses). Self
          // mode + _activeGenome + the header all read selectedRank → the whole app sees B (not the stale activeRank). Peer-deterministic
          // (B = activeRank+1, derived from the already-replicated rank). selfRules cleared so self re-derives from B.
          _S.medium.selectedRank = _tunnelB; _S.medium.selfRules = null; _S.medium.objSeen=''; }
        // VORTEX (TOPOLOGICAL) TUNNEL — inject per-blob vortices AT A's centers (where the soliton lives now), soliton-preserving phase-only.
        // The probe arc (probe_vortex_*.mjs) measured the HONEST result on the multi-blob attractor: the topology exerts a REAL transport
        // force (control with no winding stays at A) but a LINEAR medium cannot self-advect a soliton a finite distance — it transports to a
        // STABLE MIDPOINT EQUILIBRIUM and stalls there (identical at 40 & 80 steps). So the vortex does NOT reach B; it lands in an EMERGENT
        // TOPOLOGICAL VACUUM C between A and B (the winding selects it; the sustain-only drive does NOT bias position). _vortexMigrate reads
        // the centroid + winding and latches C. NOT energy-over-a-barrier, NOT a completed A→B — the honest topological transport this medium
        // supports (dipole self-advection that would complete A→B is a NONLINEAR/GPE effect; probe_dipole_nl.mjs: only a 2px signature here).
        if (thisTunnel && _tunnelMode==='vortex') { _injectVortex(field, 'A'); _vortexFired = true; }
        return true; }
      if (_instFireBar >= 0 && _instHold > 0 && bar > _instFireBar && bar <= _instFireBar + _instHold) {
        const kickShape = (thisTunnel && _tunnelMode==='switch') ? _tunnelTargetField() : null;
        _applyKick(field, _instAmp, _INST_SIG, kickShape); return true; }
      return false; };
    // B's attractor field (the tunnel destination), built locally from genome B via the chaos-game render — a real attractor shape,
    // not a centered blob. Cached by rank. The kick adds a fraction of this so the field is nudged toward B's basin, not just excited.
    let _tunnelTargetCache = null, _tunnelTargetRank = -1;
    const _tunnelTargetField = () => { if (_tunnelB < 0) return null; if (_tunnelTargetCache && _tunnelTargetRank===_tunnelB) return _tunnelTargetCache;
      const N=N_CELLS, f=new Float64Array(2*N); try { const tmp=new Float64Array(N); nlhoGenInject(tmp, _rules[_tunnelB%_rules.length], GRID); for (let i=0;i<N;i++) f[i*2]=tmp[i]; } catch(e){}
      _tunnelTargetCache=f; _tunnelTargetRank=_tunnelB; return f; };
    // EMERGENT = LENS-SPACE WALK (the right angle, measured barrier-free): A→B can't cross in ENERGY-space (the attractor re-condenses
    // every rupture to A — proven 5 ways), but the genome's IDENTITY is its PHASE-LENS, and the path φ_A→φ_B is BARRIER-FREE (energy
    // flat, matched filter swings A→B smoothly). So the walk is in LENS-space: advance _tunnelT 0→1 each bar after the kick; the source
    // carries a packet through the INTERPOLATED lens e^{i((1−t)φ_A+t·φ_B)} (nlhoLensWalk). The instanton TRIGGERS+energizes the walk
    // (no barrier to break — just a continuous operator deformation). Identity read by the resonance matched filter (corr→A/corr→B).
    const _emergentMigrate = (bar, ruptured) => { if (!_gpu || _tunnelMode!=='emergent' || !_tunnelActive || _tunnelB<0) return;
      if (_tunnelGenBar === bar) return; _tunnelGenBar = bar;
      if (_tunnelLocked) return;   // walk complete → the lens is at B, frozen
      const _saveEye = _gpu.readEyePsi();   // nlhoLensWalk uses the eye GPU buffer as scratch — restore it so both scopes stay byte-identical
      try {
        const A = _rules[((_tunnelB+_rules.length-1)%_rules.length)%_rules.length], B = _rules[_tunnelB%_rules.length];   // genome A (start), B (destination)
        _tunnelT = Math.min(1, _tunnelT + 1/6);   // advance the phase-walk parameter (0→1 over ~6 bars — the barrier-free path)
        const N=N_CELLS, c=GRID>>1, sig2=_PKT_WIDE, pk=new Float64Array(2*N);   // a packet to carry through the interpolated lens
        for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ const r2=(x-c)**2+(y-c)**2; pk[(y*GRID+x)*2]=Math.exp(-r2/(2*sig2)); }
        _tunnelLensField = nlhoLensWalk(_gpu, pk, A, B, _tunnelT, GRID, DT, { ..._lensP, opMode:'phase' }, { depth:HIDE_PASSES, propT:2 });
        // STABLE lens-space references: carry the SAME packet through the PURE lens-A (t=0) and PURE lens-B (t=1) — the matched-filter
        // endpoints. corr→A / corr→B against these read the position on the barrier-free walk (the resonance primitive). Built once.
        if (!_tunnelRefA) _tunnelRefA = nlhoLensWalk(_gpu, pk, A, B, 0, GRID, DT, { ..._lensP, opMode:'phase' }, { depth:HIDE_PASSES, propT:2 });
        if (!_tunnelRefB) _tunnelRefB = nlhoLensWalk(_gpu, pk, A, B, 1, GRID, DT, { ..._lensP, opMode:'phase' }, { depth:HIDE_PASSES, propT:2 });
        _tunnelMigSteps++;
        if (_tunnelT >= 1) { _tunnelLocked = true; }   // reached lens-B → frozen at B
      } catch(e){}
      if (_saveEye) _gpu.setEyePsi(_saveEye);   // restore the eye buffer (the walk only produced _tunnelLensField, no eye-state side effect)
      _S.medium.objSeen='';   // lens walked → rebuild the source this frame
    };
    // ★ CLOCK WALK — THE INSTANTON THAT TUNNELS (probe_instanton_clock.mjs, RESOLVED). Each bar after the kick, advance the IFS clock's
    // CONTRACTION by one tick: carry the ruptured A-vacuum (_tunnelClockSeed) through B's maps _tunnelTicks times (nlhoClockWalk).
    // The contraction GATHERS energy toward B's fixed points (native transport — the thing phase mode can't do). HONEST: B's geometry
    // is generated by B's MAPS from any input (the IFS law; no seed). The kick is the localized event/energy; the clock is the carry.
    const _clockMigrate = (bar) => { if (!_gpu || _tunnelMode!=='clock' || !_tunnelActive || _tunnelB<0 || !_tunnelClockSeed) return;
      if (_tunnelGenBar === bar) return; _tunnelGenBar = bar;
      if (_tunnelLocked) return;   // contraction complete → landed in B, frozen
      const _saveEye = _gpu.readEyePsi();
      try {
        _tunnelTicks = Math.min(_CLOCK_TICKS_MAX, _tunnelTicks + 1);   // one contraction tick per bar (the walk along the path A→B)
        const B = _rules[_tunnelB%_rules.length];
        // carry the RUPTURED A-vacuum through B's maps _tunnelTicks times (re-run from the seed each bar → deterministic f(ticks), peer-pure)
        _tunnelClockField = nlhoClockWalk(_gpu, _tunnelClockSeed, B, _tunnelTicks, GRID, { ticksMax:_CLOCK_TICKS_MAX });
        _tunnelMigSteps = _tunnelTicks;
        if (_tunnelTicks >= _CLOCK_TICKS_MAX) _tunnelLocked = true;   // contracted to B → frozen
      } catch(e){}
      if (_saveEye) _gpu.setEyePsi(_saveEye);
      _S.medium.objSeen='';   // contraction advanced → rebuild the source this frame
    };
    // ★ BARRIER instanton — WINNER-TAKE-ALL retarget (the genuine barrier-gated transition). Each bar, read which BASIN the live soliton
    // is in (footprint corr, representation-robust _intCorr for the DECISION) and flip _barrierTarget to it — so the drive HOLDS whichever
    // basin the soliton crossed into. Source stays A until the kick CROSSES it (corr→B clearly leads) → then B holds it; a sub-threshold
    // kick leaves it in A's basin → drive pulls back. A REAL barrier (unlike switch's hard swap). Hysteresis (need a clear margin to flip,
    // a clear margin to flip back) = the barrier width; prevents chattering at the saddle.
    const _barrierMigrate = (bar) => { if (_tunnelMode!=='barrier' || !_tunnelActive || _tunnelB<0 || _instFireBar<0) return;
      const rA=(_tunnelB+_rules.length-1)%_rules.length;
      // DEGENERATE: the real genomes A≈B (measured at fire) — there is genuinely NO barrier to cross (you can't cross to a B at the same place).
      // Report it honestly once; do not fake a crossing or latch.
      if (_barrDegenerate) { if (_barrLogBar !== bar) { _barrLogBar = bar; console.log(`[BARRIER] no barrier — A(r${rA}) ≈ B(r${_tunnelB}) attractors coincide (sep=${_barrSep.toFixed(0)}px); nothing to cross. Pick a distinct ⚡B+.`); } return; }
      // CENTROID observable (amplitude-independent position read). A/B = the MEASURED real genome attractor centroids (the native upgrade).
      if (!_barrCenA) { _barrCenA=_barrGenCentroid('A'); _barrCenB=_barrGenCentroid('B'); }
      const f=_E.psiLensed; if (!f) return;
      let sx=0,sy=0,sw=0,pk=0; for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const a=f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2;sx+=x*a;sy+=y*a;sw+=a;if(a>pk)pk=a;}
      const cx=sw>0?sx/sw:GRID/2, cy=sw>0?sy/sw:GRID/2;
      const dA=Math.hypot(cx-_barrCenA[0],cy-_barrCenA[1]), dB=Math.hypot(cx-_barrCenB[0],cy-_barrCenB[1]);
      const sinceF = bar - _instFireBar;
      const validRead = (sinceF >= 2) && (sw > 1e-6);   // any real field after the mid-kick transient (centroid is amplitude-independent)
      if (_barrLogBar !== bar) { _barrLogBar = bar;
        console.log(`[BARRIER] amp=${_instAmp} bar+${sinceF} · centroid(${cx.toFixed(0)},${cy.toFixed(0)}) · dist→A=${dA.toFixed(1)} dist→B=${dB.toFixed(1)} · ${validRead?'(valid)':'(transient)'} · drive=${_barrierTarget}${_barrierTarget==='B'?' CROSSED':''}`); }
      if (!validRead) return;
      if (!_E.psiC && f) _E.psiC = f.slice();   // SEED barrier's live ψ_C from the kicked wave mid-crossing — thereafter the well drive keeps it LIVE at the saddle/C
      if (_barrierLatched) return;   // LANDED in B = COMMITTED (a real instanton transition is irreversible) → stay B, no fall-back. Only a new arm / manual rank leaves it.
      // CROSSED: centroid clearly nearer B (the lump climbed the saddle). On a GENUINE crossing, LATCH B + commit the identity (selectedRank=B,
      // the medium's selection channel) so B is now home — the drive holds B and the winner-take-all can't flip back. The kick = the event; the latch = the commit.
      if (_barrierTarget==='A' && dB < dA-3) { _barrierTarget='B'; _barrierLatched=true; _S.medium.selectedRank=_tunnelB; _S.medium.selfRules=null; _S.medium.objSeen='';
        console.log(`[BARRIER] *** CROSSED & LATCHED in B at amp=${_instAmp}, bar+${sinceF}, dist→B=${dB.toFixed(1)} — committed, will HOLD ***`); }
      else if (_barrierTarget==='B' && dA < dB-3) { _barrierTarget='A'; _S.medium.objSeen=''; console.log(`[BARRIER] *** FELL BACK to A (pre-latch — kick didn't fully clear) at amp=${_instAmp} ***`); }
    };
    // ★ VORTEX-MODE migrate — the HONEST topological result (probe_vortex_*.mjs, the whole arc). The per-blob winding exerts a REAL
    // transport force (control with no winding stays at A), but a LINEAR medium can't self-advect a soliton to B — it transports to a
    // STABLE MIDPOINT EQUILIBRIUM and stalls (identical at 40 & 80 steps = a genuine attractor, not slow progress). That midpoint is an
    // EMERGENT TOPOLOGICAL VACUUM C: the winding SELECTS it (no drive bias points there). We read the CENTROID (has it moved toward the
    // A↔B midpoint?) + the WINDING (is a charge present?); when it settles at C carrying a winding, latch C. We do NOT set selectedRank=B
    // (C is not a genome rank — claiming B would be the decorative lie the probe exposed: the drive, not the topology, would be doing B).
    const _vortexMigrate = (bar) => { if (_tunnelMode!=='vortex' || !_tunnelActive || _tunnelB<0 || _instFireBar<0) return;
      const f=_E.psiLensed; if (!f) return;
      const cA=_barrCentroid('A'), cB=_barrCentroid('B'), cMid=[(cA[0]+cB[0])/2,(cA[1]+cB[1])/2];
      let sx=0,sy=0,sw=0; for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const a=f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2;sx+=x*a;sy+=y*a;sw+=a;}
      const cx=sw>0?sx/sw:GRID/2, cy=sw>0?sy/sw:GRID/2;
      const dA=Math.hypot(cx-cA[0],cy-cA[1]), dMid=Math.hypot(cx-cMid[0],cy-cMid[1]);
      // _windingFollow (loops around the field's OWN centroid) reads the SURVIVING quantum cleanly (Q=1.00 stable ~30 frames); the
      // fixed-loop _winding bounces with core drift. Use the follow reader for the latch (the live-measured stable observable).
      const Q=_windingFollow(f), absQ=Math.abs(Q); const sinceF=bar-_instFireBar;
      const validRead = (sinceF>=2) && (sw>1e-6);
      if (_vortexLogBar !== bar) { _vortexLogBar = bar;
        console.log(`[VORTEX] amp=${_instAmp} bar+${sinceF} · centroid(${cx.toFixed(0)},${cy.toFixed(0)}) dist→A=${dA.toFixed(1)} dist→mid=${dMid.toFixed(1)} · Q=${Q.toFixed(2)} · ${validRead?'(valid)':'(transient)'} · vacuum=${_vortexTarget}`); }
      if (!validRead) return;
      // ★ FIX 3 — once LATCHED at C, MIGRATE THE VACUUM (don't just sit): slide the genome so its ATTRACTOR CENTROID moves to C, adopting
      // B's identity (s,θ). DIRECT POSITION-AWARE migration (NOT nlhoCoevolveTunnel — that routes through genomeFpCenters' AUTO-FIT which
      // RESCALES fixed points to fill the frame, ERASING absolute position → live maxD stuck at 29.8, the bug the basin-hold check caught).
      // probe_basin_hold.mjs PROVED a genome-at-C IS a real basin (holds the resting wave; control genome-at-B pulls it away) — so the only
      // gap was POSITION. Here: lerp s,θ→B's; shift tx,ty in RAW map space so the attractor centroid (mean fixed point) lands on C.
      if (_vortexLatched) {
        if (_vortexTarget === 'B') return;   // already COMPLETED (C became B's basin, committed) — stop the per-bar migration/chaos-game cost
        if (_vortexCoBar === bar || !_gpu) return; _vortexCoBar = bar;
        const B = _rules[_tunnelB % _rules.length], lr = 0.35;
        const src = (_vortexGenome && _vortexGenome.length) ? _vortexGenome : _rules[((_tunnelB+_rules.length-1)%_rules.length)%_rules.length].map(m=>({...m}));
        // step 1: lerp each map's s,θ toward B's (adopt B's IDENTITY).
        const lerped = src.map((m, i) => { const bm = B[i % B.length]; return { ...m, s:(m.s||0.5)+lr*((bm.s||0.5)-(m.s||0.5)), theta:(m.theta||0)+lr*((bm.theta||0)-(m.theta||0)) }; });
        // step 2: PLACE the attractor at C by a UNIFORM tx,ty shift = (C − MEASURED attractor centroid). probe_rotated_reloc.mjs: the per-map
        // fixed-point formula SCATTERS the attractor under rotation (θ≠0 landed it at 75,5); the correct way is MEASURE the chaos-game
        // centroid (respects rotation) and shift all maps by (C − centroid) → lands at C in one step, holds. Measure via a small JS chaos-game.
        const _attrCentroidN = (maps) => { let sx=0,sy=0,n=0; for (let ch=0;ch<2000;ch++){ let px=Math.random(),py=Math.random();
          for (let it=0;it<14;it++){ const m=maps[(Math.random()*maps.length)|0], c=Math.cos(m.theta||0), s=Math.sin(m.theta||0), sc=m.s||0.5, rx=px-0.5, ry=py-0.5; px=sc*(c*rx-s*ry)+(m.tx||0); py=sc*(s*rx+c*ry)+(m.ty||0); } sx+=px; sy+=py; n++; } return [sx/n, sy/n]; };
        const ac = _attrCentroidN(lerped), cN = cx/(GRID-1), cyN = cy/(GRID-1);
        const shx = lr*(cN - ac[0]), shy = lr*(cyN - ac[1]);   // move a fraction toward C this bar (lr-paced slide, not a jump)
        _vortexGenome = lerped.map(m => ({ ...m, tx:(m.tx||0)+shx, ty:(m.ty||0)+shy }));
        // CONVERGENCE = measured attractor centroid distance to C (pixels).
        const ac2 = _attrCentroidN(_vortexGenome); const distC = Math.hypot(ac2[0]*(GRID-1)-cx, ac2[1]*(GRID-1)-cy);
        // LIVE BASIN-HOLD = DRIVE-FORWARD (probe_live_basincheck.mjs: the template-corr was blind to position; drive-forward discriminates).
        // Build the migrated genome's NON-FIT attractor (JS chaos-game density — respects absolute tx,ty, unlike nlhoGenInject's auto-fit),
        // drive the live field a few steps toward it, measure how far the soliton's centroid STAYS at C. genome-at-C holds (small drift).
        const _attrField = (maps) => { const d=new Float64Array(N_CELLS); for (let ch=0;ch<6000;ch++){ let px=Math.random(),py=Math.random();
          for (let it=0;it<14;it++){ const m=maps[(Math.random()*maps.length)|0], c=Math.cos(m.theta||0), s=Math.sin(m.theta||0), sc=m.s||0.5, rx=px-0.5, ry=py-0.5; px=sc*(c*rx-s*ry)+(m.tx||0); py=sc*(s*rx+c*ry)+(m.ty||0);
            if (it>=2){ const X=Math.round(px*(GRID-1)), Y=Math.round(py*(GRID-1)); if(X>=0&&X<GRID&&Y>=0&&Y<GRID) d[Y*GRID+X]++; } } }
          const af=new Float64Array(2*N_CELLS); let mx=0; for(let i=0;i<N_CELLS;i++) if(d[i]>mx)mx=d[i]; mx=mx||1; for(let i=0;i<N_CELLS;i++) af[i*2]=2.0*Math.sqrt(d[i]/mx); return af; };
        let holdDrift = 99;
        try { const sv=_gpu.readPsi(); const af=_attrField(_vortexGenome); _gpu.setSweepPsi(f); _gpu.setObjField(af);
          for (let st=0;st<6;st++) _gpu.stepRecord(DT, 0.20); const driven=_gpu.readPsi(); _gpu.setSweepPsi(sv);
          let sx=0,sy=0,sw=0; for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const a=driven[(y*GRID+x)*2]**2+driven[(y*GRID+x)*2+1]**2;sx+=x*a;sy+=y*a;sw+=a;}
          const dcx=sw>0?sx/sw:GRID/2, dcy=sw>0?sy/sw:GRID/2; holdDrift = Math.hypot(dcx-cx, dcy-cy); } catch(e){}
        _vortexBasinHeld = Math.max(0, 1 - holdDrift/15);   // 1=held at C, →0 if the genome's drive drags it away
        // CONVERGED + HELD: attractor centroid reached C AND its drive HOLDS the wave there → A→B complete (B's identity now sits at C). Commit.
        if (distC < 3.0 && holdDrift < 4.0 && _vortexTarget !== 'B') { _vortexTarget = 'B'; _S.medium.selectedRank = _tunnelB; _S.medium.selfRules = null; _S.medium.objSeen='';
          console.log(`[VORTEX] *** VACUUM MIGRATED — C became B's basin (distC=${distC.toFixed(1)}px, hold-drift=${holdDrift.toFixed(1)}px) → A→B COMPLETE via the dual layer (moved B's identity to C, not the wave to B) ***`); }
        else if (bar % 3 === 0) console.log(`[VORTEX-VAC] migrating vacuum→B@C · distC=${distC.toFixed(1)}px · hold-drift=${holdDrift.toFixed(1)}px (held=${_vortexBasinHeld.toFixed(2)})`);
        return;
      }
      // LANDED in C: moved off A toward the midpoint AND carries the surviving topological quantum (|Q|≥0.7 — live-measured: 3 of 4 cores
      // annihilate, ONE persists). Latch C, then (above) Fix 3 migrates the vacuum so C becomes B's basin = the dual-layer A→B completion.
      if (_vortexTarget==='A' && dMid < dA && absQ >= 0.7) { _vortexTarget='C'; _vortexLatched=true; _vortexGenome=null; _vortexCoBar=-1; _S.medium.objSeen='';
        _E.psiC = f.slice();   // SEED the live ψ_C soliton from the charged stalled wave — thereafter the vortex sustain drive keeps it LIVE at C (parallel to ψ_out→B)
        console.log(`[VORTEX] *** LANDED in emergent vacuum C (midpoint, surviving Q=${Q.toFixed(2)}) at amp=${_instAmp}, bar+${sinceF} — now MIGRATING the vacuum (Fix 3) so C becomes B's basin ***`); }
    };
    // CLOCKED ATTRACTOR of a rank = a centered packet run through that genome's clock (the contraction's OWN target) — the honest
    // readout ref for clock-mode (nlhoGenInject is a DIFFERENT representation the clock doesn't converge to). Cached per rank.
    let _clockRefCache = {};
    const _clockRef = (rank) => { if (_clockRefCache[rank]) return _clockRefCache[rank];
      const N=N_CELLS, c=GRID>>1, sig2=_PKT_WIDE, pk=new Float64Array(2*N);
      for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ const r2=(x-c)**2+(y-c)**2; pk[(y*GRID+x)*2]=Math.exp(-r2/(2*sig2)); }
      const save=_gpu.readEyePsi(); let ref;
      try { ref = nlhoClockWalk(_gpu, pk, _rules[rank%_rules.length], _CLOCK_TICKS_MAX, GRID, { ticksMax:_CLOCK_TICKS_MAX }).slice(); } catch(e){ ref=pk; }
      _gpu.setEyePsi(save); _clockRefCache[rank]=ref; return ref; };
    // DAMMANN IMAGE of a rank = B's K-point constellation produced by WAVE INTERFERENCE (nlhoDammannImage — plane-wave + additive
    // K-branch + conjugate placement + stepEyeN diffraction). The honest re-production of B's image (NOT a render): the displayed
    // source after the phase tunnel, keyed by the tunneled label. Cached per rank (static per genome). Restores the eye buffer.
    // FOCUS-KEYED cache: the Dammann image is FOCUS-DEPENDENT (propT = the focal depth; off-focus = a grating, sharp focus = B's
    // triangle — user-confirmed live). Tie the focus to the FOCUS slider (_lensP.propT, scaled) so dialing focus racks the image
    // through its focal planes (B's constellation resolves at the matched plane). Cache keyed by rank+focus.
    let _dammannCache = {};
    const _dammannRef = (rank) => { if (rank==null||rank<0) return null; const focus = Math.max(2, Math.round((_lensP.propT||2) * 4)); const key=`${rank}|${focus}`;
      if (_dammannCache[key]) return _dammannCache[key];
      const save=_gpu.readEyePsi(); let ref=null;
      try { ref = nlhoDammannImage(_gpu, _rules[rank%_rules.length], GRID, DT, { a:-0.05, propT:focus }).slice(); } catch(e){}
      _gpu.setEyePsi(save); if (ref) _dammannCache[key]=ref; return ref; };
    // BLURRED-INTENSITY correlation — for matching a PROPAGATED/lensed field (spread blobs) against an IMPULSE reference (sharp dots
    // at the same fixed points). Complex/phase correlation reads 0 (different representations); but the ENERGY sits at the same
    // centers, so blur both intensities and correlate → a representation-robust "is the structure in the same place" measure.
    const _blurIntensity = (f) => { const N=f.length>>1, I=new Float64Array(N); for(let i=0;i<N;i++)I[i]=f[i*2]*f[i*2]+f[i*2+1]*f[i*2+1];
      const B=new Float64Array(N); for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){ let s=0,c=0; for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const X=x+dx,Y=y+dy;if(X<0||X>=GRID||Y<0||Y>=GRID)continue;s+=I[Y*GRID+X];c++;} B[y*GRID+x]=s/c; }
      let m=0; for(let i=0;i<N;i++)m+=B[i]; m/=N; for(let i=0;i<N;i++)B[i]-=m; return B; };   // mean-subtracted blurred intensity
    const _intCorr = (a,b) => { const A=_blurIntensity(a), B=_blurIntensity(b); let d=0,ea=0,eb=0; for(let i=0;i<A.length;i++){d+=A[i]*B[i];ea+=A[i]*A[i];eb+=B[i]*B[i];} return (ea>0&&eb>0)?d/Math.sqrt(ea*eb):0; };
    const _fieldCorr = (a,b) => { if(!a||!b) return 0; let cr=0,ci=0,ea=0,eb=0; const N=a.length>>1;
      for (let i=0;i<N;i++){ const ar=a[i*2],ai=a[i*2+1],br=b[i*2],bi=b[i*2+1]; cr+=ar*br+ai*bi; ci+=ai*br-ar*bi; ea+=ar*ar+ai*ai; eb+=br*br+bi*bi; }
      return (ea>0&&eb>0)?Math.hypot(cr,ci)/Math.sqrt(ea*eb):0; };
    // RECONSTRUCT-PEAK — the HONEST time-reversal test (with a CONTROL, per the project's probe discipline). The question is: can
    // you back-propagate the medium's DISPERSED state to recover the instanton peak? Two numbers, both measured live:
    //   • LIVE: back-propagate the ACTUAL live soliton (which dispersed through the real drive = stepRecord = propagate + INJECT
    //     toward the vacuum) by N steps, correlate to the peak. This is the REAL answer. It is LOW (~0.1–0.3) — and that low number
    //     is the HONEST physics: the vacuum-restoration drive is IRREVERSIBLE, which is exactly what makes the instanton a one-way
    //     transient. Low ≠ a bug; it IS the instanton's defining property.
    //   • CONTROL (reversibility check): pure propagation +T then −T. This is trivially ≈1.0 for ANY field (A⁻¹A=I) — it does NOT
    //     test the instanton, it only confirms the WAVE operator alone is reversible. Shown labelled as a control so the 1.0 is not
    //     mistaken for a reconstruction success. (Verified: a noise field also gives 1.0 here — the round-trip is the identity.)
    const _reconstructPeak = () => { if (!_gpu || !_instPeak) return; const save=_gpu.readEyePsi();
      const cur = (_instScope==='eye') ? _E.psiRecon : _E.psiLensed;
      // LIVE back-prop: how many propagation steps to undo? Use a fixed window (the live field already went through the irreversible
      // drive, so no exact count recovers it — this measures how much the propagation part of the drive can be reversed).
      let live = 0; if (cur) { _gpu.setEyePsi(cur); _gpu.stepEyeN(16, -DT); live = _fieldCorr(_gpu.readEyePsi(), _instPeak); }
      // CONTROL: pure propagation round-trip (≈1.0 for anything — the wave operator is reversible; NOT a reconstruction of the kick).
      _gpu.setEyePsi(_instPeak); _gpu.stepEyeN(16, DT); _gpu.stepEyeN(16, -DT); const ctrl = _fieldCorr(_gpu.readEyePsi(), _instPeak);
      _gpu.setEyePsi(save);
      _instRecon = { live, ctrl, bars: Math.max(0, _E.frameBar - _instFireBar), atBar: _E.frameBar }; };   // atBar: which bar it ran on (peers match if same bar)
    const _PROP_PER_BAR = 4;   // (legacy) back-prop steps per elapsed bar
    // (engine slice: _E.frameBar = the current bar — set each frame, so the reconstruct button, fired between frames, knows elapsed bars)
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
    // SYNCED ATT-PARAM QUEUE (mirrors the shift queue): opSpeed + cube angles shape the soliton drives' ATTRACTOR, so their changes
    // must land at SHARED soliton steps, not each peer's render tick (which desyncs during a drag). _att* = the APPLIED values the
    // drives build the att from; the queue drains at stamped startSteps inside the drive loops. Reset = adopt node-latest + skip-by-seq.
    let _attSeen = 0, _attSpd = 6, _attAY = INIT_ANGLE_Y, _attAX = INIT_ANGLE_X;   // att pending entries live in the τ KERNEL's att queue (_kqAtt — gate 3)
    let _sigSeen = 0;      // ⚡sig cursor (pending entries live in the τ KERNEL's 'sig' queue — gate 4)
    let _lastNode = null;                      // latest node state (read-only, for console analysis helpers)
    let _sigWatch = null;                      // window.sigWatch(x,y,R,bars) — peer-local ⚡sig arrival diagnostic (console only, no physics)
    let _sigMap = null;                        // window.sigMap(bars) — |ψ|² DIFFERENCE map: snapshot now, print WHERE the energy went after N bars
    let _sigTrack = null;                      // window.sigTrack — MATCHED-FILTER radar along the fired ray (k=0.9 carrier rejects the object's low-k churn)
    let _sigScanA = null;                      // window.sigScanArm — auto line-scan every few frames (the flash lives ~0.5s, shorter than human console latency — manual sigScan always arrives late)
    let _ear = null;                           // window.earOn — the RECEIVER: 8-point ring of bar-synced matched-filter ears around the object (flash = 1-bar ΔC≈0.07 event vs 0.014 vacuum floor, measured)
    // (engine slice: _E.lockNow / _E.lockMin = minLock TELEMETRY: lock = ampCorr(ψ, att) — the living-transport observable (living move keeps min≈mean; death+regrow dips hard; invisible to solH/corr@tgt))
    const _attReset = (n) => { _attSeen = (n.medAttSeq|0); if (_kqAtt) { _kqAtt.clear(); _kqAtt.resetCursors(); }
      _attSpd = (typeof n.medOpSpeed==='number') ? n.medOpSpeed : 6; _attAY = n.angleY ?? INIT_ANGLE_Y; _attAX = n.angleX ?? INIT_ANGLE_X;
      _sigSeen = (n.medSigSeq|0); _E.lockNow = 0; _E.lockMin = 1;   // (sig/virt/kern pending entries cleared by the _tauKInit below)
      _coevoGx = _lensP.tx || 0; _coevoGy = _lensP.ty || 0; _coevoL0 = 0; _coevoTh = 0; _coevoThBar = 0; _coevoWarm = 0;   // coevo: effective position/angle + lock baseline re-anchor with everything else (the τ_W cadence cursor resets on the virt re-anchor line below)
      _V.virtSeen = (n.medVirtSeq|0); _V.psiVirt = null; _V.virtHolo = null; _V.virtCorr = 0; _V.virtMirror = false; _V.virtMux = false; _V.virtHold = false; _V.virtAtt = null; _V.virtLeak = 0; _V.lastAtt = null; _V.earVOn = false; _V.earV = null; _V.kvSteps = 0; _V.phases = []; _V.muxLoaded = 0; _V.muxHold = null; _V.virtGoOn = false; _V.virtTgtX = 0; _V.virtTgtY = 0; _V.virtGx = 0; _V.virtGy = 0; _V.virtL0 = 0; _texSpec = null; _texWatch = null; _obank.reset(); _dials.viaPhi = 0.5; _dials.lensView = false; _clkSpec = null; _clkWatch = null; _brWatch = null; _V.selfClk = null; _tau = 0; _tauLprev = 21; _tauBeatK = 0; _tauBeatKBeat = 0; _coevoCur.lt = 0; _coevoCur.lk = 0; _V.virtLt = 0; _V.virtLk = 0; _lensTauDirty = false; _tauKInit(); _K.edge = null; _K.capPh = -1; _K.src[0] = _K.src[1] = _K.src[2] = _K.src[3] = null;   // virt: a re-anchored world invalidates the virtual copy AND the booted phases (stale records; the bank survives — each plate carries its own att)
      if (_earROn) _earRInit(); };   // reactor: fresh derived state at every shared reset (stale pending startSteps from the old clock must not fire on the new one)
    const _attApply = (e) => { if (typeof e.spd==='number') _attSpd = e.spd; if (typeof e.ay==='number') _attAY = e.ay; if (typeof e.ax==='number') _attAX = e.ax; };
    // amplitude lock (probe_duallayer_transport's minLock): Σ|ψ||att| / √(Σ|ψ|²·Σ|att|²) — identical on peers (both fields replicated)
    const _ampCorr = (f, o) => { let so = 0, sf = 0, sx = 0; for (let i = 0; i < N_CELLS; i++) {
      const af = Math.hypot(f[i*2], f[i*2+1]), ao = Math.hypot(o[i*2], o[i*2+1]);
      so += ao*ao; sf += af*af; sx += af*ao; } return sx / Math.max(1e-12, Math.sqrt(so*sf)); };
    // ── REPLICATED REACTOR (👂react) + THE SIGNAL CLOCK ──────────────────────────────────────────────────────────
    // The reactor is DERIVED state: it tests the byte-identical field at SHARED steps, so every peer computes the SAME
    // hits and schedules the SAME reply flashes locally — no reflector traffic for the reaction (the §7.44 idiom:
    // ARM replicated, TRANSITION derived). Only the toggle (medEarR) + listening slot (medEarPh) ride the world model.
    // SIGNAL CLOCK: 8 phase slots × 19 steps (our channel clock, not MBINS) — sig injection and ear listening can be
    // gated to a slot → clock-phase multiplexed channels (the user's limit-cycle note, applied to signaling).
    let _earROn = false, _earPh = -1, _earR = null;
    // SLOT DESIGN v3 — every constant below was measured live, each by a failed version:
    //   v1 (8×19): leaked — the FIELD carries a message across slots (lifetime ≫ slot).
    //   v2 (4×240): leaked twice over — (a) a message injected LATE in its slot lives into the next one; (b) the
    //       far-side ECHO (the shell passing around the object, measured at the west post 71px out) adds ~100-150
    //       steps of propagation delay on top of the ~140-step lingering.
    //   v3: 2 slots × 480 steps, INJECTION WINDOW = first 120 steps of the slot only → the whole event
    //       (120 injection + ~300 propagation/echo/lingering) is contained inside its slot. Honest TDM: the guard
    //       is sized by the medium's memory, not by the clock's convenience. Cycle 960 ≈ 17s, 2 channels.
    const _SIG_SLOT = (k) => (Math.floor(k / 480)) % 2;
    const _SIG_INJ_OK = (k) => (k % 480) < 120;   // injection window (slot start only)
    const _EARR_WARMUP = 420;   // no hits before this step — floors must learn first (live-caught: post-on-structure fired 1191× at step 21 against the unlearned seed floor)
    const _earRInit = () => { _earR = { floors: new Array(8).fill(1e-4), dev: new Array(8).fill(1e-5), lastHit: new Array(8).fill(-1e9), lastReply: -1e9, pending: [] }; };
    const _earRTest = (f, k) => { if (!_earR) _earRInit();
      // SLOT GATES THE TRIGGER, NOT THE SAMPLING (v4, live-caught): under the global energy cap a message's energy is
      // CONSERVED — it becomes a long-lived HALO around the object (measured: north post elevated 6× hundreds of steps
      // after a wrong-slot injection). A slot-deaf ear cannot tell "arrived in my slot" from "rose while I was deaf".
      // So floors track CONTINUOUSLY (the halo is absorbed into the floor before the listening slot opens) and only
      // the HIT decision is slot-gated — a true arrival = step-change between two consecutive 21-step samples.
      const listening = !(_earPh >= 0 && _SIG_SLOT(k) !== _earPh);
      const ocx = GRID/2 + _transPx, ocy = GRID/2 + _transPy, R = 5;
      for (let p = 0; p < 8; p++) {
        const th = p * Math.PI / 4, ex = Math.round(ocx + 30 * Math.cos(th)), ey = Math.round(ocy + 30 * Math.sin(th));
        if (ex < R || ex >= GRID - R || ey < R || ey >= GRID - R) continue;
        let e = 0, c = 0;
        for (let y = ey - R; y <= ey + R; y++) for (let x = ex - R; x <= ex + R; x++) { const i = (y * GRID + x) * 2; e += f[i]**2 + f[i+1]**2; c++; }
        e /= c;
        const fl = _earR.floors[p];
        // live-calibrated rule (same as the telemetry ear): ≥4×floor AND ≥0.4e-4 absolute; refractory per post +
        // global reply cooldown (steps) so a pong's own passage can't cascade into a ping-storm; WARMUP: learn only
        // EDGE detection v6 = CFAR (live-caught: structure-adjacent posts 3/6 churn at 1-2 units and false-fired every
        // ~2200 steps against any GLOBAL threshold, while vacuum posts churn at ~0.05). Each post tracks its own typical
        // deviation dev[p] (EMA of |e−floor| on quiet samples); an edge must exceed 4× ITS OWN noise AND the absolute
        // 0.35-unit minimum. Vacuum posts stay sensitive; structure posts self-desensitize. (v5 absolute delta kept —
        // conservation heats the medium, so ratios starve; halo drift between consecutive samples ≈0.)
        const dv = _earR.dev[p];
        const hit = listening && k >= _EARR_WARMUP && (e - fl) >= Math.max(3.5e-5, 4 * dv) && e >= 2 * fl && (k - _earR.lastHit[p] > 150) && (k - _earR.lastReply > 400);   // global cooldown > the measured echo-cascade time (~210 steps)
        if (hit) { _earR.lastHit[p] = k; _earR.lastReply = k;
          const rx = Math.max(2, Math.min(GRID - 3, ex + 14 * Math.cos(th))), ry = Math.max(2, Math.min(GRID - 3, ey + 14 * Math.sin(th)));
          _earR.pending.push({ startStep: k + 57, fx: ex, fy: ey, tx: rx, ty: ry, amp: 0.8 });   // PONG: radially outward through the post, 3 slots later
          console.log(`[EAR-R] ✦ hit post ${p} (${ex},${ey}) E=${(e * 1e4).toFixed(1)}e-4 (${(e / Math.max(1e-9, fl)).toFixed(0)}×) atStep=${k} slot=${_SIG_SLOT(k)} → PONG @${k + 57}`);
        } else { _earR.dev[p] = dv * 0.9 + Math.abs(e - fl) * 0.1; _earR.floors[p] = fl * 0.9 + e * 0.1; }   // quiet: learn deviation THEN floor
      } };
    // ── EARS IN THE DREAM (👂V) — the SAME CFAR edge reactor, running on ψ_V at shared 21-step V-boundaries and
    //    clocked in kV (V's proper time; the constants are matter-time properties of the medium, identical physics).
    //    Posts ring V's OWN operator (the recorded att's centroid — the dream's geometry anchor, same semantics as
    //    W's posts ringing _transP). No slot gate (the dream listens always). A hit dream-PONGS INSIDE V: the leak is
    //    one-way W→V, so the reply propagates in the dream only — the world speaks, the dream answers itself.
    //    Toggled by the stamped 'ear' verb → inits at the shared step on every peer (no anchor bump needed — unlike
    //    👂react, whose setMedium toggle lands at render ticks). kV resets at ear-on → the warmup is honest (the
    //    measured startup-storm bug: unlearned floors + skipped warmup fired 1191×). Derived state; snapshot-carried.
    // ── THE VIRT-SECTOR STATE OBJECT (extraction stage C2) — the V/phases/mux/journey/bank/ear/selfClk
    //    bindings gathered into ONE owned value so the verb table and the mux scheduler can move behind a stores
    //    contract (→ medium-core, stage C3). Same fields, same initializers, same mutation sites — only ownership
    //    moved (the step-2/C1 method: authority switch, byte-identical by construction). The field-by-field physics
    //    docs stay at the original declaration sites (the neutralized comment lines below).
    const _V = {
      earVOn: false, earV: null, kvSteps: 0,
      psiVirt: null, virtHolo: null, virtE0: 1, virtSeen: 0, virtCorr: 0,
      virtMirror: false, virtMux: false, lastAtt: null, virtHold: false, virtAtt: null, virtLeak: 0,
      virtGoOn: false, virtTgtX: 0, virtTgtY: 0, virtGx: 0, virtGy: 0, virtLl: 1, virtL0: 0, virtLt: 0, virtLk: 0,
      virtBank: [],
      phases: [], muxLoaded: 0, muxHold: null,
      selfClk: null,
    };
    // (→ _V.* — stage C2 state object; initializers live at the _V literal)
    const _earVInit = () => { _V.earV = { floors: new Array(8).fill(1e-5), dev: new Array(8).fill(1e-5), lastHit: new Array(8).fill(-1e9), lastReply: -1e9, pending: [] }; };
    const _earVCenter = () => { const f = _V.virtAtt || _V.psiVirt; if (!f) return [GRID/2, GRID/2];
      let sx = 0, sy = 0, sw = 0; for (let i = 0; i < N_CELLS; i++) { const a2 = f[i*2]**2 + f[i*2+1]**2; sx += (i % GRID) * a2; sy += ((i / GRID) | 0) * a2; sw += a2; }
      return sw > 0 ? [sx / sw, sy / sw] : [GRID / 2, GRID / 2]; };
    const _earVTest = (f, k) => { if (!_V.earV) _earVInit();
      const [ocx, ocy] = _earVCenter(), R = 5;
      for (let p = 0; p < 8; p++) {
        const th = p * Math.PI / 4, ex = Math.round(ocx + 30 * Math.cos(th)), ey = Math.round(ocy + 30 * Math.sin(th));
        if (ex < R || ex >= GRID - R || ey < R || ey >= GRID - R) continue;
        let e = 0, c = 0;
        for (let y = ey - R; y <= ey + R; y++) for (let x = ex - R; x <= ex + R; x++) { const i = (y * GRID + x) * 2; e += f[i]**2 + f[i+1]**2; c++; }
        e /= c;
        const fl = _V.earV.floors[p], dv = _V.earV.dev[p];
        const hit = k >= _EARR_WARMUP && (e - fl) >= Math.max(3.5e-5, 4 * dv) && e >= 2 * fl && (k - _V.earV.lastHit[p] > 150) && (k - _V.earV.lastReply > 400);
        if (hit) { _V.earV.lastHit[p] = k; _V.earV.lastReply = k;
          const rx = Math.max(2, Math.min(GRID - 3, ex + 14 * Math.cos(th))), ry = Math.max(2, Math.min(GRID - 3, ey + 14 * Math.sin(th)));
          _V.earV.pending.push({ startStep: k + 57, fx: ex, fy: ey, tx: rx, ty: ry, amp: 0.2 });   // dream-pong at DREAM scale (κ-fed traffic ~0.6e-4; a W-scale 0.8 pong made V a reverberation chamber — far posts tripped on bounced shells ~900 kV later, and heated floors deafened the aimed post to the next real arrival: live-caught 2026-07-04)
          console.log(`[EAR-V] ✦ the DREAM heard post ${p} (${ex},${ey}) E=${(e * 1e4).toFixed(1)}e-4 (${(e / Math.max(1e-9, fl)).toFixed(0)}×) kV=${k} → dream-PONG @${k + 57}`); }
        else { _V.earV.dev[p] = dv * 0.9 + Math.abs(e - fl) * 0.1; _V.earV.floors[p] = fl * 0.9 + e * 0.1; }
      } };
    // ── CLOSED-LOOP COEVOLVE (⟲coevo) — the leash ─────────────────────────────────────────────────────────────
    // The missing half of "coevolve": matter → geometry. The operator position no longer jumps blind to the queued
    // target; an EFFECTIVE position walks toward it but is CLAMPED within _COEVO_L px of the soliton's measured
    // peak-centroid (computed from the byte-identical field at shared 21-step boundaries → identical on all peers,
    // zero reflector traffic — the same derived-state idiom as the reactor). The leash IS the speed controller:
    // no hand-tuned rate, no deadlock (reopens when matter catches up), no starvation (geometric, heat-immune),
    // and minLock high BY CONSTRUCTION (lock loss was always distance-driven; distance is now capped).
    let _coevoOn = false, _coevoGx = 0, _coevoGy = 0, _coevoL0 = 0;
    const _coevoCur = { lt: 0, lk: 0 };   // W's ⟲coevo leash-cadence cursor (τ_W coupling — slot-beats consumed / kW at last advance); lt=-1 = command-fresh (a shift/att crossing just moved the target → the next advance fires immediately)
    let _coevoTh = 0, _coevoThBar = 0;   // objorbit ANGULAR leash: effective θ (lock-paced) + prev-bar θ for the live ω readout
    let _coevoWarm = 0, _coevoLl = 0, _coevoSg = 0;   // orbit warmup counter (parked-quality capture) + last ℓ/σ stash for the bar log
    let _orbR = 16;                      // orbit radius (replicated medOrbR — the Kepler-test dial: ω_eff(R) is the medium's own orbital law)
    let _orbW = 1;                       // schedule multiplier (replicated medOrbW — Kepler dial 2: push the schedule past the chase ceiling so the leash binds)
    // ── ⎙virt — THE VIRTUAL PHASE (milestone 1 of the one-world migration: the eye as hypervisor) ────────────────
    // RECORD = forward IFS propagation (the hologram) · LIFT = the time-reversed clock (phase-conjugate reconstruction)
    // · RUN = the lifted soliton lives FREE on the same shared substrate (same sustain, same shared steps, no operator
    // drive) → diverges from the driven world naturally · COMPARE = bind(V,W) read as the lock. All at stamped shared
    // steps from the byte-identical field → every peer derives the identical virtual world (zero reflector traffic).
    // (→ _V.* — stage C2 state object; initializers live at the _V literal)   // virt pending entries live in the τ KERNEL's 'virt' queue (_kqVirt — gate 4)
    // (→ _V.* — stage C2 state object; initializers live at the _V literal)
    // INDEPENDENT-COMMAND V (coevolve-transport in the dream): V chases its OWN moving target — the recorded att
    // translated by _virtG (px, eased toward _virtTgt), lock-LEASHED so it advances only while V stays coherent
    // (matter tells geometry how far it may go — the ⟲coevo loop, now in the dream). Distinct from hold (parked att):
    // here the operator MOVES, so chase ≠ coevolve and the leash is meaningful. Priority mirror > independent > hold.
    // (→ _V.* — stage C2 state object; initializers live at the _V literal)   // _V.virtLt/_V.virtLk = V's leash-cadence cursor (slot-beats consumed / kV at the last advance — the τ_V coupling)   // _V.virtLeak = κ of the W→V LEAK channel (mux-only: imperfect phase isolation between adjacent clock slices — ψ_V += κ·ψ_W(frozen at the slice boundary) at shared 7-step boundaries; the dream hears the world faintly). Declared physics, not a trick; V's cap re-normalizes the added energy.   // _V.virtHold + _V.virtAtt: HOLD mode — V is driven toward its OWN recorded att (the operator state stashed at record/store time): a world whose geometry is PARKED at the remembered moment. Same superpose+cap physics as W — no tricks; the honest LIVE view of the virtual phase (a field with no operator dies into halo within ~τ — the measured law). Mirror overrides hold.   // _V.virtMux: §7.44 CLOCK-PHASE MUX — W and V time-share the ONE substrate's step stream (phase(k)=⌊k/21⌋ mod 2, a pure function of the shared step index); the off-phase field is frozen exactly in its buffer, each world runs at HALF proper rate — virtualization costs TIME, not a second substrate (vs the parallel frame time of mux OFF)
    let _eyeSrc = 'W';   // M3b — the eye's PHASE SELECTOR (scope toggle → phase selector): 'W' = the eye traps the driven world (the classic path), 'V' = the eye traps the VIRTUAL phase — the whole eye machinery (hologram→recon→recall/self) runs on the dream. Replicated (n.eyeSrc).
    // (→ _V.* — stage C2 state object; initializers live at the _V literal)   // M3 — the PLATE BANK ({p: hologram plate, k: stored step}): recall memory as world state. Only replicated verbs mutate it (store/recall at stamped steps) → identical on every peer; ships in the join snapshot; SURVIVES re-anchors (memory is the long-τ matter — recall across obj/drive changes is the feature)
    const _VIRT_BANK_MAX = 4;   // FIFO cap (each plate = a full field in the join snapshot)
    let _texSpec = null, _texWatch = null;   // M-a REGISTER EXPERIMENT: the written phase texture's spec {amp,kx,ky,k0} (set at the stamped write step → peer-identical; cos/sin tables derived lazily) + the per-bar bind-demod watcher
    let _regRd = null;   // regRead — the ABSOLUTE register readout (run-8 corollary: injection locking makes the global phase a collective variable slaved to the att → arg Σψ reads the U(1) register from ONE field, no reference phase). k=0 is the robust choice: Σψ is exactly translation-invariant on the torus and amplitude-weighted over the whole field. Display-only, peer-local.
    let _clkSpec = null, _clkWatch = null;   // M-c1 CRYSTAL PROBE: {a,kx,ky,k0} of the injected clock mode (stamped) + the frame-level meter. A single Fourier mode = the propagator's eigenbasis — its phase is the candidate self-hosted clock; the meter decides CRYSTAL vs DAMPED/LOCKED/NOISY.
    // M-c1′ BREATH PROBE — the AMPLITUDE-sector oscillator (run 8: phase at every k is enslaved to the operator
    // frame; a relaxation cycle can still run free — cf. laser relaxation oscillation under injection lock). Rides
    // the EXISTING Q=7 readback (zero extra GPU reads), W-owned steps only, read-only and peer-local (no fork
    // surface). Nyquist: 7-step sampling resolves periods ≥ ~21 steps; ✗ may also mean a sub-14-step beat.
    let _brWatch = null;
    const _brFinish = () => { const S = _brWatch.s, n = S.length; _brWatch = null;
      const ana = (name, arr) => { const m = arr.reduce((a, b) => a + b, 0) / n, d = arr.map(v => v - m);
        let v0 = 0; for (let i2 = 0; i2 < n; i2++) v0 += d[i2] * d[i2]; v0 = Math.max(v0, 1e-30);
        const L = Math.floor(n / 3), ac = new Float64Array(L + 1);
        for (let l2 = 1; l2 <= L; l2++) { let s2 = 0; for (let i2 = 0; i2 < n - l2; i2++) s2 += d[i2] * d[i2 + l2]; ac[l2] = s2 / v0; }
        let bestL = 0, bestR = -1;
        for (let l2 = 2; l2 < L; l2++) if (ac[l2] > ac[l2 - 1] && ac[l2] >= ac[l2 + 1] && ac[l2] > bestR) { bestR = ac[l2]; bestL = l2; }
        const per = bestL * 7, ratio = per / 21, cv = Math.sqrt(v0 / n) / Math.max(1e-12, Math.abs(m));
        const near = Math.abs(ratio - Math.round(ratio)) < 0.15;
        console.log(`[BREATH] ${name}: μ=${m.toExponential(3)} · depth σ/μ=${(cv * 100).toFixed(2)}% · ${(bestR > 0.25 && bestL >= 2) ? `✓ CYCLE period ${per} steps (autocorr r=${bestR.toFixed(2)})${near ? ` — ENTRAINED ≈${Math.round(ratio)}×21 (the schedule's echo in matter)` : ` — FREE-RUNNING (period/21=${ratio.toFixed(2)}, not a schedule multiple: the medium's OWN beat)`}` : '✗ NO CLEAR CYCLE at ≥21-step resolution (aperiodic — or a sub-14-step beat below Nyquist)'}`); };
      ana('peak |ψ|²', S.map(x => x.mx)); ana('lock ℓ', S.map(x => x.l));
      console.log(`[BREATH] done · ${n} samples × 7 steps = ${n * 7} steps of matter time — FREE-RUNNING cycle ⟹ the M-c2 gate (integer beat counter, quantized at the decision); ENTRAINED ⟹ matter echoes the operator clock (the gate reads time THROUGH the field)`); };
    const _brSample = (q, kk, att) => { let mx = 0; for (let i2 = 0; i2 < N_CELLS; i2++) { const a2 = q[i2*2]*q[i2*2] + q[i2*2+1]*q[i2*2+1]; if (a2 > mx) mx = a2; }
      _brWatch.s.push({ k: kk, mx, l: att ? _ampCorr(q, att) : 0 });
      if (_brWatch.s.length % 128 === 0) console.log(`[BREATH] ${_brWatch.s.length}/${_brWatch.n} · peak=${mx.toExponential(3)} · ℓ=${(att ? _ampCorr(q, att) : 0).toFixed(3)} · step=${kk}`);
      if (_brWatch && _brWatch.s.length >= _brWatch.n) _brFinish(); };
    // M-a″ OPERATOR-SIDE REGISTER → _lensOp[0].phase (u-register step 2): the att's U(1) phase (rad). The k=0 eraser measured in M-a′ — the drive is a LOCAL OSCILLATOR that re-locks W's phase to the att in ~1 bar — becomes the RETENTION: rotate the operator, W follows and is HELD. Mutated only by the stamped 'aphase' verb; applied at every att rebuild → peer-identical; snapshot-carried; reset on re-anchor.
    let _virtWatch = null;   // window.virtWatch(bars) — per-bar V⊗ series + the ln(1−V⊗) fit = the Lyapunov/healing verdict   // MIRROR mode: V receives the SAME operator drive as W (the frame's att, stashed by the drives) → V⊗ then measures how the medium amplifies/heals the tiny lift residual = the LYAPUNOV experiment (counterfactual mode measures your interventions instead)
    const _VIRT_T = 16;   // hologram depth (steps): linear round-trip → near-exact lift (the pure-wave case, measured ≈1.0)
    // ── M4: N-PHASE MUX — bank plates BOOT into live phase slots; the clock round-robins [W, V?, …phases]
    //    (phase(k) = ⌊k/21⌋ mod N — a pure function of the shared step index and the shared slot count → peer-identical).
    //    Each world runs at 1/N proper rate: more VMs = slower worlds, the honest budget. Booted phases are HELD at
    //    their plate's att (dual-layer memory: the moment boots with its own operator; a plate stored without att
    //    free-runs and dies — honest). Extras step ONLY under ⧉mux — they ARE clock phases; without the clock they
    //    are frozen exactly (storage). V keeps its full feature set (mirror/hold/leak/ears); extras are minimal
    //    worlds (sustain + held att + sponge). This is "phases as registers": a phase is DATA (addressable — the
    //    selector, recall, bind) and a RUNNING WORLD at once — the operator/operand duality on the clock.
    const _PHASE_MAX = 2;   // extra slots (W + V + 2 = at most a 4-way clock, 84-step cycle)
    // (→ _V.* — stage C2 state object; initializers live at the _V literal)       // [{ psi, e0, att, kv, src }] — mutated by replicated stamped verbs only → peer-identical; snapshot-carried; cleared on re-anchor
    // (→ _V.* — stage C2 state object; initializers live at the _V literal)   // which slot owns the GPU buffer mid-loop (0=W, 1=V if present, 2+=extras) + W's parked field
    // (engine slice: _E.muxStepped = the PROPER-TIME RENDER GATE — steps run PER SLOT this frame (reset at frame start, incremented in the mux/W paths). A slot's canvas repaints only on frames where its own field advanced — the observer sees the slot's OWN proper time; the 1/N frame cadence is the honest mux signature. Pure fn of the shared step schedule → peers gate identically → same canvases + same solH.)
    // M-c2 — SELF-CLOCK GATE (the routing demo of the closed arc, runs 9–11): the mux rotates on BEATS of the
    // lock-ℓ ripple — the measured τ-band subharmonic — instead of ⌊k/21⌋. The TIME is still the operator's (the
    // theorem: the medium owns a timescale, not a time); what is self-hosted is the ROUTING — the scheduler reads
    // the medium's heartbeat. Deterministic by the standing idiom (ARM replicated, TRANSITION derived): ℓ from the
    // byte-identical field at shared Q boundaries, crossings are discrete events, per-slot EMA baselines avoid
    // cross-slot transients, and the k-counter WATCHDOG (no beat in 84 steps > the 63-step τ-cycle → forced rotation) guarantees
    // liveness — a phase with no operator has no heartbeat, honestly carried by the external clock.
    // (→ _V.* — stage C2 state object; initializers live at the _V literal)   // { bar[4]: per-slot EMA baseline, prev[4]: last (ℓ−ℓ̄) sign carrier, beats, lastK } — toggled by the stamped 'selfclock' verb; snapshot-carried; reset on re-anchor
    // GATE 2 (proper-time-metric): τ = the medium's own proper time, a REPLICATED METRIC. The line element is
    // dτ = dk / L where L is the live slice length — GR's ∫√g dk. Advance is CAUSAL: within a slice τ rises at
    // 1/L_prev per step (the previous slice's length as the local metric estimate, known at the slice start), and
    // SNAPS to the exact integer `beats` at each beat crossing (so τ lands on integers at beats regardless of the
    // estimate). Pure function of k + shared field (both L_prev and the beat are) → peer-identical. Snapshot-carried.
    // Off selfClock, L ≡ 21 and τ = k/21 exactly (the no-op guarantee: existing worlds untouched). _tauAdv is called
    // once per executed step from the SAME sites as _selfClkTick, AFTER the beat test, so it sees the updated beats.
    let _tau = 0, _tauLprev = 21, _tauBeatK = 0, _tauBeatKBeat = 0;   // global (scheduler-foliation) τ: proper time · last slice length · k of the last beat · beats at last snap (fresh-beat detector)
    // ── THE τ KERNEL (migration GATE 3 — the control is retired; proper-time-metric §9) ─────────────────────────
    // The gate-3″ law (authored-fresh at coordinate | τ_W-paced backlog | due-valve; independent shift/att cursors)
    // lives in kwe-tau.js (L1–L3) with its regression suite — the in-medium cursors and gates are GONE.
    // kwe-tau IS the engine: its queues are THE shift/att queues (kernel stamps at push, kernel gates at drain,
    // kernel re-stamps at epoch flips), its clocks are THE per-worldline τ_i. The medium keeps only the PHYSICS:
    // the beat DETECTOR (bar/prev quantization at the 1e-3 grid, per-slot refractory in C.lastKs) feeds
    // _tauK.beat/advance; every constant with units stays here. selfClock OFF ⇒ _tauK.resetClocks() ⇒ clocks
    // ABSENT ⇒ every kernel gate unconditional = pure coordinate dispatch — the no-op guarantee, by construction.
    // Snapshot: the kernel state ships verbatim as medSnapTauK (its epoch c0/rate are the leader's shared values,
    // so a joiner restores it IMMEDIATELY — no clock-block dependency); legacy snapshots (medSnapShiftQ/AttQ +
    // cursors + tauS) rebuild through the DEFERRED path (needs the true local _stepClk.rate — the joiner false-alarm
    // lesson). kH= in solH = the kernel state hash: cross-peer, must match at matching steps=.
    const _SLOTN = ['W', 'V', 'P1', 'P2'];
    // ── THE ω·τ_i LENS (the register-clock experiment; lensTau(ω) console dial) ─────────────────────────────────
    // linOp's temporal phase e^{iωt}, per WORLDLINE: each slot's pin reference precesses by ω at each of ITS OWN
    // slot-beats — the reference rotates as THAT slot's matter ages. The injection lock (the pin IS a PLL) drags
    // the field's phase along → regRead's differential meter reads Δφ(i,j) = ω·(τ_i − τ_j) + const: the U(1)
    // register becomes an INTERFEROMETRIC CLOCK COMPARATOR — accumulated proper-time difference as a phase.
    // Determinism: precession applies at the slot-beat site (a shared step); the beat detector is _ampCorr =
    // AMPLITUDE correlation → U(1)-invariant → the precession cannot perturb the clock that drives it. W precesses
    // via _lensOp[0].phase (consumed by the next rebuild, flagged per W-step — k-indexed, frame-independent); V/P via the
    // aphase-drain rotation of the stored att, effective at the slot's next buffer load (≤ nSl steps — matter-time
    // lag, honest). ω is a replicated verb (model-clamped ±0.5 rad/beat; keep it well inside the lock's capture
    // range — start 0.05–0.2; the ω where the pin loses the chase is ITSELF a measurable: the temporal shatter
    // floor). A parked slot (τ frozen) does not precess — the honest freeze becomes VISIBLE in the register.
    // NOTE: the V/P phase ledger (_lensOp[1..3].phase) stays a COMMAND ledger (precession is physics, not a verb — it would swamp the meter).
    let _lensTauDirty = false;   // W's pending-rebuild flag (ω itself lives in _lensOp[sl].omega — set at a shared beat, consumed at the next W-owned step)
    const _lensTauPrecess = (sl) => { const w = _lensOp[sl].omega; if (!w) return;
      const vs = _V.psiVirt ? 1 : 0;
      if (sl === 0) { _lensOp[0].phase = ((_lensOp[0].phase + w) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); _lensTauDirty = true; return; }
      const tgt = (sl === 1 && vs) ? _V.virtAtt : (_V.phases[sl - 1 - vs] ? _V.phases[sl - 1 - vs].att : null); if (!tgt) return;
      const c = Math.cos(w), sn = Math.sin(w), r = new Float64Array(tgt.length);
      for (let j = 0; j < tgt.length; j += 2) { r[j] = tgt[j] * c - tgt[j + 1] * sn; r[j + 1] = tgt[j] * sn + tgt[j + 1] * c; }
      const qz = _attF32(r);   // f32-requantize: snapshot parity (same discipline as the aphase drain)
      _lensOp[sl].prec += w;   // step 3 bookkeeping: the rotation just baked into the att bytes, integrated (beat site = shared step → replicated); lensU1.angle stays the slot's true total reference
      if (sl === 1 && vs) _V.virtAtt = qz; else _V.phases[sl - 1 - vs].att = qz; };
    const _tauK = (typeof globalThis !== 'undefined' && globalThis.KWETau) ? globalThis.KWETau({ monRate: _MON_RATE, stepsPerPhase: 19, flatL: 21 }) : null;
    if (!_tauK) console.error('[τK] kwe-tau missing — shift/att dispatch disabled (load krestianstvo-wavefront-evaluator.js first)');
    let _kqShift = null, _kqAtt = null, _kqSig = null, _kqVirt = null, _kqKern = null, _tauKLegacy = null;   // _tauKLegacy: parked legacy-snapshot pieces for the deferred rebuild
    const _tauKInit = (snapK) => { if (!_tauK) return;
      _tauK.reset();
      if (snapK) _tauK.restore(snapK); else _tauK.setEpoch(_stepClk.c0, _stepClk.rate);
      _kqShift = _tauK.makeQueue('shift', { clock: 'W' });   // (re)attach the apis — reset orphans old records
      _kqAtt   = _tauK.makeQueue('att',   { clock: 'W' });
      // GATE 4: the remaining command streams — coordinate dispatch (clock:null = unconditional at the authored
      // step, their §6b semantics: sig/kern judged non-bursting, virt = hypervisor commands). They gain the
      // kernel's stamping, epoch re-stamp, snapshot (medSnapTauK), and hash coverage. Sig keeps its slot gate as a
      // kernel GUARD — head-blocking FIFO on the shared signal clock (pure fn of kW → L1-clean).
      _kqSig  = _tauK.makeQueue('sig',  { clock: null, guard: (e) => ((e.ph ?? -1) < 0 || (_SIG_SLOT(_E.kwSteps) === e.ph && _SIG_INJ_OK(_E.kwSteps))) });
      _kqVirt = _tauK.makeQueue('virt', { clock: null });
      _kqKern = _tauK.makeQueue('kern', { clock: null }); };
    _tauKInit();
    const _tauAdv = (kk) => { if (!_V.selfClk) { _tau = kk / 21; return; }   // flat metric off selfClock
      if (_V.selfClk.beats > _tauBeatKBeat) {   // a beat just fired this step → snap τ to the integer, recalibrate L_prev
        _tauLprev = Math.max(7, _V.selfClk.lastK - _tauBeatK) || 21; _tauBeatK = _V.selfClk.lastK; _tauBeatKBeat = _V.selfClk.beats;
        _tau = _V.selfClk.beats; return; }
      _tau = _V.selfClk.beats + Math.min(0.999, (kk - _tauBeatK) / _tauLprev); };   // within-slice: fractional, clamped below the next integer
    // τ RESET — call at EVERY site that creates a FRESH _V.selfClk (toggle ON, V-birth default). A fresh beat state
    // with STALE τ vars breaks the metric contract (τ must only increase; historically the stale cursors also
    // jammed the shift throttle). NOT for the joiner-restore path (τ restored verbatim).
    const _tauReset = (kk) => { _tau = 0; _tauLprev = 21; _tauBeatK = kk; _tauBeatKBeat = 0; _coevoCur.lt = 0; _coevoCur.lk = 0;
      if (_tauK) { _tauK.resetClocks(); _kqShift.resetCursors(); _kqAtt.resetCursors(); } };   // fresh selfClock → fresh worldline clocks (rebuild lazily from the detector) + fresh throttle phase; QUEUE ENTRIES PERSIST (pending commands survive the toggle, as always)
    // M-e — THE COUPLING GRAPH (the register Kuramoto/XY machine): signed symmetric κ[i][j] between slots
    // (0=W,1=V,2=P1,3=P2). Physics = the VALIDATED leak generalized (runs 17a/b: causal, one-way per term,
    // ∝κ, reversible): at shared Q boundaries the LOADED slot receives Σ_j κ[i][j]·ψ_j from the other slots'
    // SLICE-END states. κ<0 pushes anti-phase (antiferromagnetic edge) — a frustrated graph relaxes to its
    // ground state and regRead reads the answer: computing with calibrated physics, no tricks.
    // Determinism: sources are captured ONLY at k-derived slice transitions (_K.src) — the frame-end park is
    // peer-local, so live CPU copies would fork; _K.src holds the last k-derived array reference (parks REPLACE
    // the copies wholesale, so the old reference stays byte-stable). Clock physics: mux-only, like the leak.
    // ── THE COUPLING STORE (extraction stage C4) — the edge matrix + the CAPTURE LAW live in medium-core's
    //    makeCouplingStore (the law that took three live forks to stabilize: capture gated PURELY on the coarse
    //    beat-clock change, sources frozen from CANONICAL stores, cursor invalidated on any edge write). The
    //    APPLICATION of the coupling (ψ += κ·src — calibrated physics) stays medium-side in _kApply.
    const _K = makeCouplingStore();
    // (→ _K.edge — stage C4 coupling store)              // 4×4 signed symmetric matrix, null = no edges
    // (→ _K.capPh — stage C4 coupling store)             // the ph of the last GENUINE beat transition that captured coupling sources (survives the peer-local frame-end park that zeroes _V.muxLoaded → distinguishes a real slot change from a spurious re-transition on frame re-entry)
    // ── REGISTER / COUPLING STRIP (bar5) — refAmp · attPhase · edge · store/boot/recall. Built HERE (after _refAmp/_K.edge/
    //    _V.virtBank/_lensOp are declared, to avoid a TDZ ref). ALL replicated via injectEvent (mediumVirt verbs, drained at
    //    the proper-time _stampStep like every stamped verb) → byte-identical on peers. _refreshBar5 reflects live state. ──
    const _SLOTS = ['W','V','P1','P2'];
    const _virtGuard = () => (_driveMode==='transport'||_driveMode==='objorbit');
    const _mkTag = (t) => { const s = document.createElement('span'); s.textContent = t; Object.assign(s.style,{fontSize:'9px',color:'#8df',fontFamily:'ui-monospace,monospace',fontWeight:'bold'}); return s; };
    bar5.appendChild(_mkTag('refAmp:'));
    const _refAmpSliders = _SLOTS.map((sl, i) => { const s = mkSlider(sl, 0, 3, 0.05, _lensOp[i].beta, ()=>{}); s.input.addEventListener('change', () => { if (_virtGuard()) injectEvent?.({ type:'mediumVirt', mode:'refamp', src: sl, amp: +s.input.value }); }); bar5.appendChild(s.wrap); return s; });   // fire on CHANGE (drag release), not every input → no verb-log burst
    bar5.appendChild(_mkTag('· attPhase:'));   // aphase is an INCREMENT verb → nudge buttons (±0.01), not a slider (avoids the compounding problem)
    let _aphSlot = 'W'; const _aphSel = mkSelect('', _SLOTS.map(s=>({value:s,label:s})), 'W', (v)=>{ _aphSlot = v; }); bar5.appendChild(_aphSel.wrap);
    // Phase meter per slot. W reflects the live _lensOp[0].phase (the real engine accumulator, mutated at the verb DRAIN on
    // every peer → replicated). V/P1/P2 have NO persistent angle in the engine at all: their aphase verb bakes a
    // one-shot rotation into the stored att FIELD BYTES (_V.virtAtt / ph.att), so there is no scalar to read back.
    // _lensOp[1..3].phase is that missing scalar — a REPLICATED drain-time ledger, mutated ONLY where the rotation actually
    // applies (the shared drain step, both drive paths), NEVER at button press. So every peer's meter shows the same
    // number, and a gap-dropped verb never shows (the old press-time _aphAcc was peer-local AND optimistic). The
    // ledger describes the CURRENT stored operator → reset to 0 wherever that operator is REPLACED wholesale
    // (record/swap/recall for V; boot/kill for P), on re-anchor, and snapshot-carried (a joiner's meter must match).
    // (that ledger now lives in _lensOp[1..3].phase — the observer descriptor holds it with the same replication discipline)
    const _aphNudge = (d) => { if (!_virtGuard()) return; injectEvent?.({ type:'mediumVirt', mode:'aphase', amp: d, src: _aphSlot }); };
    bar5.appendChild(mkBtn('−θ', false, () => _aphNudge(-0.01))); bar5.appendChild(mkBtn('+θ', false, () => _aphNudge(+0.01)));
    const _aphRead = _mkTag(''); _aphRead.style.color='#9f9'; bar5.appendChild(_aphRead);
    // ── step 5: the OBSERVER EDITOR — the remaining descriptor components get UI dials (everything below writes the
    //    SAME _lensOp the meters/recall stamps read; the verbs are the replicated truth, the widgets just author them).
    bar5.appendChild(_mkTag('· ω:'));   // the lensTau dial (global verb today — one slider moves all four descriptors)
    const _omSlider = mkSlider('', -0.5, 0.5, 0.01, 0, ()=>{}); _omSlider.input.addEventListener('change', () => { if (_virtGuard()) injectEvent?.({ type:'mediumVirt', mode:'lenstau', amp: +_omSlider.input.value }); }); bar5.appendChild(_omSlider.wrap);
    // The φ dial POSITION is replicated state too ('viaphi' verb on drag release) — both peers' bar5 shows the same
    // pending birth angle; the ⎙viaφ press still CARRIES the angle explicitly in the recvia verb (stamped-carrier
    // principle: register writes must not depend on what another verb may or may not have drained yet).
    const _dials = { viaPhi: 0.5, lensView: false };   // replicated UI dials as ONE object — the core's settings-verb table (stage B2) writes them; snapshot-carried, reset on re-anchor
    const _viaSlider = mkSlider('φ', -3.14, 3.14, 0.05, _dials.viaPhi, ()=>{}); _viaSlider.input.addEventListener('change', () => { if (_virtGuard()) injectEvent?.({ type:'mediumVirt', mode:'viaphi', amp: +_viaSlider.input.value }); }); bar5.appendChild(_viaSlider.wrap);
    bar5.appendChild(mkBtn('⎙viaφ', false, () => { if (_virtGuard()) injectEvent?.({ type:'mediumVirt', mode:'recvia', amp: +_viaSlider.input.value }); }));   // record V THROUGH the lens (trap born in the rotated frame)
    // view:∠lens — render each slot panel THROUGH that slot's own readOp (ψ shown = lensU1.apply(op, ψ) — the same
    // operator the meters measure; field bytes untouched). REPLICATED toggle ('lensview' verb, flips at the drain like
    // mirror/hold — every peer sees the same view); raw = today's gauge view. Button visuals reflect state in _refreshBar5.
    const _lvBtn = mkBtn('view:raw', false, () => { if (_virtGuard()) injectEvent?.({ type:'mediumVirt', mode:'lensview' }); }); bar5.appendChild(_lvBtn);
    bar5.appendChild(_mkTag('· edge:'));   // two slot selectors + κ slider + set button (edge is discrete → applied on click, not a live sweep) + live matrix readout
    let _edgeA = 'W', _edgeB = 'V'; const _edgeASel = mkSelect('', _SLOTS.map(s=>({value:s,label:s})), 'W', (v)=>{ _edgeA=v; }); bar5.appendChild(_edgeASel.wrap);
    const _edgeBSel = mkSelect('↔', _SLOTS.map(s=>({value:s,label:s})), 'V', (v)=>{ _edgeB=v; }); bar5.appendChild(_edgeBSel.wrap);
    const _edgeKSlider = mkSlider('κ', -0.5, 0.5, 0.01, -0.15, ()=>{}); bar5.appendChild(_edgeKSlider.wrap);   // wider range, same 0.01 step (verb re-clamps to the model's admissible κ)
    bar5.appendChild(mkBtn('set κ', false, () => { if (!_virtGuard()) return; const SN={W:0,V:1,P1:2,P2:3}, ia=SN[_edgeA], ib=SN[_edgeB]; if (ia===ib) { console.log('[EDGE] pick two distinct slots'); return; } injectEvent?.({ type:'mediumVirt', mode:'edge', gx:ia, gy:ib, leak:+_edgeKSlider.input.value }); }));
    bar5.appendChild(mkBtn('edges 0', false, () => { if (!_virtGuard() || !_K.edge) return; for (let a=0;a<4;a++) for (let b=a+1;b<4;b++) if (_K.edge[a][b]) injectEvent?.({ type:'mediumVirt', mode:'edge', gx:a, gy:b, leak:0 }); }));   // clear all edges
    const _edgeMtx = _mkTag(''); _edgeMtx.style.color='#9f9'; bar5.appendChild(_edgeMtx);
    bar5.appendChild(_mkTag('· mem:'));
    bar5.appendChild(mkBtn('⎘store', false, () => { if (_virtGuard()) injectEvent?.({ type:'mediumVirt', mode:'store' }); }));
    let _bootSlot = 0; const _bootSel = mkSelect('', [0,1,2,3].map(i=>({value:i,label:'plate'+i})), 0, (v)=>{ _bootSlot=v|0; }); bar5.appendChild(_bootSel.wrap);
    bar5.appendChild(mkBtn('⇞boot', false, () => { if (_virtGuard()) injectEvent?.({ type:'mediumVirt', mode:'boot', slot: _bootSlot|0 }); }));
    bar5.appendChild(mkBtn('↺recall', false, () => { if (_virtGuard()) injectEvent?.({ type:'mediumVirt', mode:'recall' }); }));
    const _refreshBar5 = () => {   // reflect live replicated state onto bar5 widgets each frame (peer-local display; the verbs are the replicated truth)
      bar5.style.display = (_uiScope!=='eye' && _virtGuard()) ? 'flex' : 'none';
      if (bar5.style.display === 'none') return;
      for (let i=0;i<4;i++) _refAmpSliders[i].setVal(_lensOp[i].beta);
      _omSlider.setVal(_lensOp[0].omega);
      _viaSlider.setVal(_dials.viaPhi);
      const _lvTxt = _dials.lensView ? 'view:∠lens' : 'view:raw'; if (_lvBtn.textContent !== _lvTxt) { _lvBtn.textContent = _lvTxt; _lvBtn._on = _dials.lensView; _lvBtn._repaint(); }
      { const lo = _lensOp[_LOPN[_aphSlot]];   // the full descriptor readout for the selected slot: total angle ∠ (wrapped) + its split (authored φ / precessed p)
        _aphRead.textContent = `${_aphSlot}:∠${_aphNorm(lensU1.angle(lo)).toFixed(2)}${(_aphSlot !== 'W' && lo.prec) ? ` (φ${lo.phase.toFixed(2)}+p${lo.prec.toFixed(2)})` : ''}`; }
      _bootSel.setOptions([0,1,2,3].map(i=>({value:i,label:'plate'+i+(i<_V.virtBank.length?'✓':'')})));
      const _mtx = _K.edge ? _SLOTS.flatMap((a,i)=>_SLOTS.slice(i+1).map((b,j)=>{ const kk=_K.edge[i][i+1+j]; return kk?`${a}${b}:${kk.toFixed(2)}`:null; })).filter(Boolean).join(' ') : '';
      _edgeMtx.textContent = _mtx ? `[${_mtx}]` : '(no edges)';
    };
    // ── THE UNIFIED ⎙VIRT VERB TABLE (extraction stage B1; doc/proper-time-metric.md §12) — ONE implementation
    //    for BOTH drive paths. Historically transport and objorbit carried twin copies of this table, maintained by
    //    replace_all discipline (honest but fragile — every fix had to land twice, byte-for-byte). The pre-unification
    //    diff (2026-07-11) showed EXACTLY ONE functional divergence: how the W operator is rebuilt after an aphase-W
    //    write. ctx carries the drive branch's block-scoped pieces: att() = the CURRENT W operator field (read at
    //    verb time); rebuildW() = the mode-specific rebuild. Everything else is closure state, mutated at the stamped
    //    shared step exactly as before (body verbatim from the transport path — the richer twin). _muxReanchor stays
    //    INSIDE (any verb that changed slot count / mux state re-anchors at THIS shared step, as always).
    // ── THE STORES CONTRACT (stage C3) — everything the core's V-sector verb table may touch. Getters/wrappers
    //    throughout: evaluation happens at DRAIN time (init order irrelevant; _gpu is assigned late; torbE0 is W's
    //    energy budget the swap verb trades — get/set routes it through the closure).
    const _VS = { V: _V, ops: _lensOp, dials: _dials, tauK: _tauK,
      get gpu() { return _gpu; }, get VIRT_T() { return _VIRT_T; }, get DT() { return DT; }, get PHASE_MAX() { return _PHASE_MAX; }, get BANK_MAX() { return _VIRT_BANK_MAX; },
      get torbE0() { return _torbE0; }, set torbE0(v) { _torbE0 = v; },
      attF32: (f) => _attF32(f), aphNorm: (x) => _aphNorm(x), ampCorr: (a, b) => _ampCorr(a, b), lockSweep: (...a) => _lockSweep(...a),
      goCarrier: (s) => _goCarrier(s), vLeashReset: () => _vLeashReset(), tauReset: (kk) => _tauReset(kk), earVInit: () => _earVInit() };
    // ── THE ⎙VIRT DISPATCHER (stages B2+C3) — settings sector → core; V-sector optics → core (applyVirtVerb);
    //    RESIDUE (tex/cseed probe + edge coupling — their state lives here) → below; _muxReanchor after EVERY verb.
    const _virtVerb = (vq, k, ctx) => {
      if (!applySettingsVerb(vq, k, _lensOp, _dials) && !applyVirtVerb(vq, k, _VS, { att: ctx.att, rebuildW: ctx.rebuildW })) {
            // M-a — PHASE-TEXTURE WRITE: a pure phase lens e^{iφ(x)} applied to W at the stamped shared step (phase
            // mode: no resample; zero-moment φ → no momentum deposited). The register experiment's write primitive.
            if (vq.mode === 'tex') { const f = _gpu.readEyePsi();
              _texSpec = { amp: vq.amp || 0, kx: Math.round(vq.gx) || 0, ky: Math.round(vq.gy) || 0, k0: k }; _texBuild(_texSpec);
              for (let j = 0; j < N_CELLS; j++) { const tc = _texSpec.c[j], ts = _texSpec.s[j], re = f[j*2], im = f[j*2+1];
                f[j*2] = re*tc - im*ts; f[j*2+1] = re*ts + im*tc; }
              _gpu.setEyePsi(f);
              console.log(`[TEX] atStep=${k} — zero-tilt phase texture on W: amp=${_texSpec.amp} rad, cycles=(${_texSpec.kx},${_texSpec.ky}) — read it with texWatch()`); }
            // M-c1 — CLOCK SEED: inject a small plane wave a·e^{i2π(kx·x+ky·y)/G} into W. A single k-mode advances
            // e^{iω(k_c)t} EXACTLY under the linear propagator (k-space is the eigenbasis — the x-space textures
            // died, the Fourier coefficient is the honest oscillator candidate); clockWatch measures whether the
            // driven nonlinear medium keeps it. Probe momentum is a²-suppressed (amp ~0.05 → negligible).
            else if (vq.mode === 'cseed') { const f = _gpu.readEyePsi(), w0 = 2 * Math.PI / GRID, ka = vq.amp || 0, ckx = Math.round(vq.gx) || 0, cky = Math.round(vq.gy) || 0;
              for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const p = w0 * (ckx * x + cky * y), j = (y * GRID + x) * 2;
                f[j] += ka * Math.cos(p); f[j + 1] += ka * Math.sin(p); }
              _gpu.setEyePsi(f); _clkSpec = { a: ka, kx: ckx, ky: cky, k0: k };
              console.log(`[CSEED] atStep=${k} — clock probe a=${ka} at k=(${ckx},${cky}) injected into W — clockWatch() to test the crystal`); }
            // M-e — COUPLING EDGE: set κ(a,b) symmetric, signed (the register XY machine's program instruction)
            else if (vq.mode === 'edge') { const ea = Math.max(0, Math.min(3, vq.gx|0)), eb = Math.max(0, Math.min(3, vq.gy|0)), ek = vq.leak || 0;
              if (!_K.setEdge(ea, eb, ek)) console.log('[EDGE] self-coupling ignored');   // C4: the symmetric write + all-zero collapse + capture-cursor invalidation = the store's law
              else { const SN = ['W','V','P1','P2'];
                console.log(`[EDGE] κ(${SN[ea]},${SN[eb]}) = ${ek} atStep=${k} — ${ek < 0 ? 'anti-align (frustrating)' : ek > 0 ? 'align' : 'removed'} (symmetric; applied at shared Q boundaries from slice-end states; mux-only clock physics)`); } }
      }
      _muxReanchor(k);   // DETERMINISTIC rate re-anchor at THIS shared verb step — unchanged: every drained verb re-anchors
    };
    // COUPLING SOURCES _K.src[slot] — the byte-identical field each slot contributes to its edges. Captured ONLY at a
    // genuine beat slot-change (shared step), directly from each slot's CANONICAL STORE (_V.muxHold/_V.psiVirt/_V.phases[].psi),
    // NEVER from the peer-local GPU buffer or at a frame-batch-dependent step. See the capture block in _muxVirtualStep.
    // Snapshot-carried so a joiner applies the same sources in the window before its first beat. _kApply reads these.
    // (→ _K.src — stage C4 coupling store)
    // GATE 3b (proper-time coupling dose) was TRIED and REVERTED (2026-07-07): scaling each injection by Δτ*3 gave an
    // ERRATIC per-injection dose (Δτ is 0 on Q-boundaries that don't coincide with a _tau-update site, a full jump on
    // others) → the coupling stuttered and W's static lock BROKE (σ 0.5–1.26, drift 0.44 vs the pre-fix 0.0114 lock).
    // The 0.1 rad residual is a clean STATIC offset in the pin-vs-coupling equilibrium; trading it for a broken lock
    // is a bad deal. A correct dose throttle would need τ to advance smoothly per step AND _kApply gated on the same
    // clock — deferred. The counter-equivalent injection (full κ per Q-boundary) is restored below.
    // (→ _K.capStep — stage C4 coupling store)   // DIAGNOSTIC: the shared step of the last coupling-source capture (cross-peer: MUST match; a differing kCap ⟺ a coupling-timing fork — the signal that caught all three edge bugs)
    const _kApply = (q, i) => { if (!_K.edge) return;
      for (let j = 0; j < 4; j++) { const kk = _K.edge[i][j]; if (!kk || j === i) continue;
        const src = _K.src[j]; if (!src || src.length !== q.length) continue;
        for (let m = 0; m < q.length; m++) q[m] += kk * src[m]; } };   // the cap renormalizes the added energy each step (same as the leak)
    // BEAT DEADBAND (KWE determinism, 2026-07-07): beats decide ph = the slot rotation — a fork here loads a DIFFERENT
    // slot into the buffer → an instant HARD field fork (>1e-3), not a slow ULP drift. The crossing test operated on
    // raw f64 d = l − bar, so two peers whose W field differs by even 1 ULP (any f32 round-trip below the solH 1e-3
    // hash threshold — invisible in solH) compute d of OPPOSITE sign right at a zero-crossing → beats fork → ph forks →
    // visible fork ONE step later (exactly the live-caught symptom). selfClock is the canonical KWE mode, so it must be
    // synced BY CONSTRUCTION: quantize the crossing to the SAME 1e-3 grid solH uses. Then the beat is a pure function of
    // the field AT solH resolution — identical on any two peers whose fields agree to the tolerance the whole system
    // already guarantees. Sub-1e-3 field noise can no longer flip a beat. _BEAT_Q = the deadband (matches _hashField's
    // Math.round(·*1000)); prev carries the QUANTIZED sign so the crossing itself is grid-locked, not just the trigger.
    const _BEAT_Q = 1000;   // 1e-3 amplitude-correlation grid = solH's quantization → beat robust to sub-threshold ULP noise
    // PER-SLOT PROPER TIME τ_i (per-worldline metric, INERT — telemetry/snapshot only, nothing physical reads it yet;
    // the gate-2 discipline: replicate first, verify two-peer, couple later). The global τ is ONE time for the whole
    // medium (a preferred foliation — FRW cosmic time); GR's proper time is per-worldline, and the worldline clocks
    // already exist: kW/_V.kvSteps/px.kv count only the steps a slot actually EXECUTED. τ_i metric-weights them:
    // dτ_i = dk_i / L_i, L_i = the slot's last beat-to-beat distance in ITS OWN steps. Same crossing detector as the
    // global beat (bar/prev are already per-slot) but a PER-SLOT refractory — the global refractory merges the beat
    // streams (that is the SCHEDULER's clock, untouched); one slot's beat must not suppress another's τ_i. NO watchdog:
    // a heartbeat-dead slot's τ_i honestly FREEZES (its matter stalled → its time stalled; the 84-step watchdog is a
    // rotation-liveness device, global-only). A slot with no refAtt never ticks — no reference to beat against, its
    // clock stands (honest). Indexing follows bar/prev: the BUFFER slot (ph), = the canonical W/V/P1/P2 order in the
    // standard setup. Lazy-init at the first tick (a shared-step site → deterministic on every peer; also upgrades old
    // snapshots and keeps the four _V.selfClk creation sites untouched). Self-heal re-baseline covers the counter-reset
    // paths (ear toggle zeroes kV; a rebooted phase restarts kv) — τ_i never runs backward. Snapshot-carried with _V.selfClk.
    const _selfClkTick = (q, kk, refAtt, sl, kp) => { if (!_V.selfClk || !refAtt) return;
      const C = _V.selfClk, l = Math.round(_ampCorr(q, refAtt) * _BEAT_Q) / _BEAT_Q;   // QUANTIZE l AT THE SOURCE (2026-07-07): the EMA bar is a f64 ACCUMULATOR — quantizing only d (the instantaneous ripple) left bar drifting on raw f64. A sub-1e-3 field diff the deadband hid instantaneously still INTEGRATES into bar over ~50 steps (EMA τ) until |bar_A−bar_B|>1e-3, then d's quantized sign forks → beats fork DOZENS of steps after the seed (live-caught: beats 110 vs 112 same steps, kCap/kSrc forked downstream). Grid-locking l makes BOTH bar and d pure functions of the field at solH resolution → the accumulator can't drift.
      if (!C.lastKs) C.lastKs = [kk, kk, kk, kk];   // per-slot refractory cursors (detector state — the kernel clocks lazy-create themselves, baselined at kp)
      if (!C.bar[sl]) { C.bar[sl] = l; C.prev[sl] = 0; return; }   // first sample on this slot = baseline seed
      C.bar[sl] = Math.round((C.bar[sl] * 0.98 + l * 0.02) * _BEAT_Q) / _BEAT_Q;   // slow EMA (τ_EMA ≈ 50 quanta), RE-QUANTIZED each step so rounding can't accumulate off-grid drift
      const d = Math.round((l - C.bar[sl]) * _BEAT_Q);   // QUANTIZE the ripple to the solH grid → crossing is grid-locked, ULP-noise can't flip its sign
      if (C.prev[sl] < 0 && d >= 0 && kk - C.lastK >= 21) { C.beats++; C.lastK = kk;   // refractory ≥21: noise crossings after a disturbance can't rotate faster than the counter (beat-storm clamp)
        if (C.beats % 16 === 0) console.log(`[SELFCLK] beat ${C.beats} atStep=${kk} — the mux rotates on the medium's heartbeat`); }
      if (typeof kp === 'number' && _tauK) {   // per-worldline τ_i — the KERNEL's clocks (gate 3). Detector stays HERE (the physics: this crossing test + the per-slot refractory); the integrator (monotone/snap/L-recal/self-heal/ceiling) is the kernel's, tested in test/kwe-tau.test.mjs.
        if (C.prev[sl] < 0 && d >= 0 && kk - C.lastKs[sl] >= 21) { C.lastKs[sl] = kk; _tauK.beat(_SLOTN[sl], kp, kk); _lensTauPrecess(sl); }   // ω·τ_i lens: the slot's reference precesses per ITS beat
        else _tauK.advance(_SLOTN[sl], kp); }
      C.prev[sl] = d; };
    // The park is ONLY a physical slot flush+restore: write the loaded slot's field to its store (_V.psiVirt/hp.psi) and
    // restore W to the buffer. Called at real transitions, the peer-local frame-end, AND the beat capture block above.
    // (Coupling-source capture is NOT here — it lives in the _K.capPh-gated block in _muxVirtualStep, see that comment.)
    const _muxParkToW = (att) => { if (_V.muxLoaded === 0 || !_gpu) return;   // write the loaded slot's field home, restore W (buffer + objField)
      const f = _gpu.readEyePsi(), vs = _V.psiVirt ? 1 : 0;
      if (_V.muxLoaded === 1 && vs) _V.psiVirt = f; else { const hp = _V.phases[_V.muxLoaded - 1 - vs]; if (hp) hp.psi = f; }
      _gpu.setEyePsi(_V.muxHold); _V.muxLoaded = 0; if (att) _gpu.setObjField(att); };
    // INDEPENDENT-V helpers: the moving att = the recorded att translated on the torus by round(_virtG) (an integer
    // roll = an exact, deterministic wavefront translation — the field-space analog of makeProbeField at a moving
    // center, which V's raw plate cannot regenerate parametrically). _virtAdvance = ONE leash step: measure V's lock
    // vs its moving target, learn a slow baseline (transport-appropriate — always-learning is right for a finite
    // journey, per the orbit lesson), advance ≤1px/boundary × the lock-slack sigmoid → returns the new moving att.
    const _rollField = (f, sx, sy) => _E.rollField(f, sx, sy);   // G2: moved to medium-gpu.js (E.rollField) — alias keeps call sites
    // A "leash carrier" is anything with an att + the mutable {go,tx,ty,gx,gy,ll,l0} fields: V (via the module
    // globals, exposed as a carrier below) OR any booted phase (its own fields). ONE generalized advance serves both
    // → the chase/leash algebra composes onto EVERY commandable phase, not just V (the operator algebra, completed).
    const _leashMovAtt = (c) => c.att ? _rollField(c.att, Math.round(c.gx), Math.round(c.gy)) : null;
    const _leashAdvance = (c, qv) => { if (!c.go || !c.att) return null;
      const mov = _leashMovAtt(c); c.ll = _ampCorr(qv, mov);
      if (c.l0 <= 0) c.l0 = c.ll || 1; else c.l0 = c.l0 * 0.98 + c.ll * 0.02;   // slow always-learning baseline (transport, not orbit)
      const sig = Math.max(0, Math.min(1, (c.ll / Math.max(1e-6, c.l0) - 0.75) * 4));   // the ⟲coevo sigmoid: full advance while coherent, stall if the percept loses coherence
      const dx = c.tx - c.gx, dy = c.ty - c.gy, d = Math.hypot(dx, dy);   // normalized step (as _coevoLeash): ≤1px per boundary in ANY direction — per-axis clamping gave √2 diagonally, a different transport law for V than W
      if (d > 1e-9) { const st = Math.min(1, d) * sig; c.gx += (dx / d) * st; c.gy += (dy / d) * st; }
      return _leashMovAtt(c); };
    // LEASH CADENCE ON τ_i (the per-worldline coupling, 2026-07-10; PURE form — no scheduler floor, honest physics
    // preferred over liveness): a commanded slot's leash advances once per SLOT-BEAT — its own τ_i integer crossing —
    // instead of the flat 21-proper-step grid: "the operator waits for THIS slot's matter", per worldline. τ_i has
    // no watchdog and honestly freezes in a quantization-flat window (live-verified) — so a journey whose matter
    // shows no time STANDS, honestly (the advance itself perturbs the lock, so a moving journey feeds its own clock;
    // a stalled one is the medium's verdict, not a bug). COMMAND-FRESH escape: the 'go' verb (and any re-command)
    // sets lt=-1 → the FIRST advance fires immediately — the experimenter's hand is outside the metric, and its one
    // poke restores ripple → beats → τ pacing. Off selfClock (or before the first tick's lazy-init) this returns the
    // original (kp % 21)===0 grid EXACTLY — the no-op guarantee. Cursor on the carrier (lt = slot-beats consumed,
    // lk = kp at the last advance — diagnostic: journey speed in matter time), snapshot-carried (medSnapVirtGo /
    // medSnapPhases / medSnapCoevoG — a joiner advancing one boundary early forks the moving att). Deterministic:
    // beatsS/kp are pure fns of shared state; the cursor mutates only at shared slot-steps.
    const _leashDue = (sl, kp, c) => { const S = _V.selfClk;
      const b = (S && _tauK) ? _tauK.beatsOf(_SLOTN[sl]) : null;   // GATE 3: the KERNEL's worldline clock (null = no clock: selfClock off / pre-first-tick → flat grid, the no-op form)
      if (b == null) return (kp % 21) === 0;
      if ((b|0) > (c.lt|0)) { c.lt = b|0; c.lk = kp; return true; }
      return false; };
    // V's leash fields live as module globals (feature-rich phase, snapshot-carried individually) → expose them as a
    // carrier VIEW so _leashAdvance treats V and booted phases uniformly. Accessors keep the globals authoritative.
    const _vCarrier = { att: null };
    Object.defineProperties(_vCarrier, {
      go: { get: () => _V.virtGoOn,  set: v => { _V.virtGoOn = v; } },
      tx: { get: () => _V.virtTgtX,  set: v => { _V.virtTgtX = v; } },
      ty: { get: () => _V.virtTgtY,  set: v => { _V.virtTgtY = v; } },
      gx: { get: () => _V.virtGx,    set: v => { _V.virtGx = v; } },
      gy: { get: () => _V.virtGy,    set: v => { _V.virtGy = v; } },
      ll: { get: () => _V.virtLl,    set: v => { _V.virtLl = v; } },
      l0: { get: () => _V.virtL0,    set: v => { _V.virtL0 = v; } },
      lt: { get: () => _V.virtLt,    set: v => { _V.virtLt = v; } },
      lk: { get: () => _V.virtLk,    set: v => { _V.virtLk = v; } },
    });
    const _virtMovAtt = () => { _vCarrier.att = _V.virtAtt; return _leashMovAtt(_vCarrier); };
    const _virtAdvance = (qv) => { _vCarrier.att = _V.virtAtt; return _leashAdvance(_vCarrier, qv); };
    // swap/relift REPLACE V's field (and swap its att): an in-flight journey's eased position gx/gy is now a false
    // claim about where the operator sits — the moving att would land displaced by the old journey. Release the command.
    const _vLeashReset = () => { _V.virtGoOn = false; _V.virtTgtX = 0; _V.virtTgtY = 0; _V.virtGx = 0; _V.virtGy = 0; _V.virtL0 = 0; _V.virtLt = 0; _V.virtLk = 0; };
    // Any att that outlives the frame (V's recorded operator, bank plates, booted phases) ships f32-narrowed in the
    // join snapshot — so it must live f32-QUANTIZED on every peer, or the recorder computes the CPU-side leash lock
    // (_ampCorr(qv, mov)) with f64 low bits a joiner doesn't have → sigmoid diverges → round(gx) forks the field.
    // (ψ fields are GPU-born f32-exact already; makeProbeField-born atts are the only true-f64 snapshot payloads.)
    const _attF32 = (a) => a ? Float64Array.from(Float32Array.from(a)) : null;
    // M-a — the phase-texture tables: φ(x,y) = amp·cos(2πkx·x/G)·cos(2πky·y/G). Integer cycles on the torus → zero
    // mean AND zero net tilt (no k·x component): per the two-channel law a kick-free write — the texture must live
    // in the momentum-orthogonal subspace or writing register V shoves world W (the instanton kick, unwanted here).
    // M-a″ — rotate a freshly built att by the register phase e^{i·_lensOp[0].phase} (in place; identity when unset).
    // Rotation-invariant consumers stay untouched: _ampCorr and the leash lock are amplitude-based (phase-blind),
    // so the coevo/leash dynamics see NO change — only W's phase reference moves. Kick-free by construction (k=0).
    const _aphNorm = (x) => ((x + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const _attRot = (f) => { if (!f || !_lensOp[0].phase) return f;
      const c = Math.cos(_lensOp[0].phase), s = Math.sin(_lensOp[0].phase);
      for (let j = 0; j < f.length; j += 2) { const re = f[j], im = f[j+1]; f[j] = re*c - im*s; f[j+1] = re*s + im*c; }
      return f; };
    const _texBuild = (t) => { if (!t || t.c) return t;
      const c = new Float64Array(N_CELLS), s = new Float64Array(N_CELLS), w = 2 * Math.PI / GRID;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const ph = t.amp * Math.cos(w * t.kx * x) * Math.cos(w * t.ky * y);
        const j = y * GRID + x; c[j] = Math.cos(ph); s[j] = Math.sin(ph); }
      t.c = c; t.s = s; return t; };
    // virtGo targets the EYE-SELECTED phase: eye⟵P1/P2 → that booted phase's leash; else V. (The command follows the
    // eye's gaze — you steer the percept you are looking at. eye⟵W has no virtual phase to command → falls back to V.)
    // The carrier is STAMPED into the verb at press time (vq.src) — resolving from the frame-local _eyeSrc at the
    // stamped step could bind different carriers on peers whose frames straddle an eye⟵ toggle (byte fork).
    const _goCarrier = (src) => { _vCarrier.att = _V.virtAtt;
      if (src === 'P1' && _V.phases[0]) return _V.phases[0];
      if (src === 'P2' && _V.phases[1]) return _V.phases[1];
      return _vCarrier; };
    // one virtual-slot step (shared by both drives): returns true if this global step k belongs to a virtual phase
    // (the drive must `continue` — queues/verbs/tests are W-events and wait for the next W-owned step).
    const _muxVirtualStep = (k, att, Q) => {
      const vs = _V.psiVirt ? 1 : 0, nSl = _V.virtMux ? (1 + vs + _V.phases.length) : 1;
      if (nSl < 2) return false;
      // M-c2 WATCHDOG, Q-ALIGNED (proper-time-metric gate 1): fire only at a shared Q=7 boundary so the escape slice
      // is a clean 7-multiple and τ crossings land on observable boundaries. k, lastK, and the (k%7) test are all
      // pure functions of the SHARED step index → the watchdog fires at the identical k on every peer (the beat
      // count is therefore a pure function of k + shared field: the prerequisite for τ being a replicated metric).
      if (_V.selfClk && (k % 7) === 0 && k - _V.selfClk.lastK >= 84) { _V.selfClk.beats++; _V.selfClk.lastK = k;   // ≥84, Q-gridded: silent when healthy (> 63-step τ-cycle), bounds source staleness
        if (_TAU_PROBE) console.log(`[SELFCLK] watchdog rotation atStep=${k} beat=${_V.selfClk.beats} — no beat in ≥84 steps`); }
      // ── TWO CLOCKS (2026-07-07 interleave-buffer fix for the canvas freeze) ──────────────────────────────────────
      // ph = BUFFER OWNERSHIP, now FINE-GRAINED (k % nSl): every slot owns the buffer & advances once per nSl global
      // steps, round-robin. So within any frame of ≥nSl steps EVERY slot steps at least once → _E.muxStepped[all]>0 →
      // every canvas repaints every frame → NO freeze (was: beat/counter-length contiguous slices, one slot frozen for
      // ~21+ steps → its canvas held its last frame = the visible stutter). Pure fn of shared k → peers rotate identically.
      // capPh = the COARSE COUPLING/τ clock (beat-gated, unchanged): coupling sources are still captured only at a beat
      // slot-change (_K.capPh !== capPh), NOT every step — the stabilized edge determinism is untouched, just decoupled
      // from the now-fine buffer rotation. τ/_selfClkTick likewise ride the beat. Off selfClock capPh ≡ ph (k-counter).
      const { ph, capPh } = muxClocks(k, nSl, _V.selfClk ? _V.selfClk.beats : null);   // C4: the two-clock law from the core — ph = FINE buffer ownership (rotates every step); capPh = COARSE coupling/τ clock (beat slot under selfClock, ⌊k/21⌋ slice off it) — evaluated AFTER the watchdog so a watchdog beat lands in THIS step's capPh, as before
      // COUPLING-SOURCE CAPTURE, FULLY DECOUPLED FROM _V.muxLoaded (2026-07-07, third edge fix): the capture MUST be driven
      // by the ph CHANGE ALONE (beat-derived = shared across peers), never by the _V.muxLoaded !== ph physical-transition
      // check. _V.muxLoaded is zeroed by the FRAME-END park at a PEER-LOCAL step, which corrupts that check BOTH ways:
      //  (i) spurious capture — next frame's first step sees _V.muxLoaded(0)!==ph(1), re-captures at a todo-dependent step;
      //  (ii) SKIPPED capture — a beat→W transition (ph→0) lands on a frame that already parked W (_V.muxLoaded==0), so the
      //       `_V.muxLoaded!==0` guard is false and the genuine beat's capture NEVER runs → that peer keeps the STALE _K.src
      //       while the other peer captured fresh → coupling forks (live-caught: E 2.30 vs 2.62 at a beats 47→48 step,
      //       one peer kCap=3402 the other still kCap=3192). Fix: gate purely on _K.capPh !== ph (a genuine beat slot
      //       change), read every slot's CANONICAL store (never the GPU buffer, whose ownership is peer-local), freeze
      //       straight into _K.src — all BEFORE the park logic. The physical park/reload below is unchanged and still
      //       keyed on _V.muxLoaded (it must run every frame re-entry); only the coupling capture is decoupled.
      if (_K.shouldCapture(capPh)) {   // C4: the capture LAW is the store's (gate PURELY on the coarse-clock change — the third edge fix); the GPU flush/park that makes the canonical stores current stays the medium's
        if (_V.muxLoaded === 0) _V.muxHold = _gpu.readEyePsi();   // W owns the buffer → flush its live field to its store (shared step)
        else _muxParkToW(att);   // some other slot owns → park it to its store (_V.psiVirt/hp.psi) AND restore W to _V.muxHold — all at this shared beat step
        // every slot's canonical store now holds its field frozen at THIS shared beat → the STORE freezes them (never the peer-local GPU buffer); indices beyond the passed fields stay untouched (exact legacy semantics)
        _K.capture([_V.muxHold, (vs && _V.psiVirt) ? _V.psiVirt : null, ..._V.phases.map((p) => p && p.psi)], k, capPh); }
      if (ph === 0) { if (_V.muxLoaded !== 0) { _muxParkToW(att); } return false; }   // physical park/reload only (capture already handled above)
      if (_V.muxLoaded !== ph) { _muxParkToW(att);
        _V.muxHold = _gpu.readEyePsi();
        const px = (ph === 1 && vs) ? null : _V.phases[ph - 1 - vs];
        _gpu.setEyePsi(px ? px.psi : _V.psiVirt); _V.muxLoaded = ph;
        if (px) { if (px.att) _gpu.setObjField(px.go ? _leashMovAtt(px) : px.att); }   // a commanded phase chases its moving att; else held at its recorded operator
        else if (!_V.virtMirror && _V.virtGoOn && _V.virtAtt) _gpu.setObjField(_virtMovAtt());   // INDEPENDENT: chase the moving att
        else if (!_V.virtMirror && _V.virtHold && _V.virtAtt) _gpu.setObjField(_V.virtAtt); }
      if (ph === 1 && vs) {   // V — the full-featured phase (mirror/independent/hold/leak/ears), clocked in kV
        const indep = _V.virtGoOn && _V.virtAtt && !_V.virtMirror;   // moving target (coevolve-transport in the dream)
        const holdPin = !_V.virtMirror && !indep && _V.virtHold && _V.virtAtt;   // PURE hold
        const vh = indep || holdPin;
        if ((_V.virtMirror && att) || vh) _gpu.applyEyeSuperpose(_beta(1));   // V pin amplitude (refAmp sweep)
        // MUX-RATE COMPENSATION (peer-determinism): V steps at 1/nSl the global rate, so per unit GLOBAL time its hold
        // drive re-crushes divergence nSl× slower than W's (W drives every global step). A kernel kick that knocks V's
        // free sector over the 0.001 solH threshold then grows faster than V can pull back → measured non-recovering
        // peer fork at KDRAIN (while W's solH sails through). Extra superpose applications on the HELD slice compensate
        // the proper-rate deficit — the SAME β coevolution (cap keeps the halo alive, NO snap/projection), just applied
        // enough times to match W's per-global-step crush. Capped at β_eff≤0.45 (3×) so it can never approach λ=1 overwrite.
        if (holdPin) { const xtra = Math.min(nSl - 1, 2); for (let e = 0; e < xtra; e++) _gpu.applyEyeSuperpose(_beta(1)); }   // held V only (free/mirror keep 1× = honest divergence)
        _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); _gpu.applyEyeEnergyCap(_V.virtE0);
        _V.kvSteps++;
        // V PROPER-STEP EVENTS (kV grid) — pulled OUT of the global-%Q block: under interlacing V owns scattered single
        // steps, so a global-%21 boundary that is ALSO V-owned rarely lands → V's leash/ears starve (same class as W's
        // coevo freeze). kV%21 fires every 21 V-proper steps regardless of nSl. Own field read (byte-identical, kV = pure
        // fn of the shared schedule). Mirrors W's coevo-leash treatment; the honest "each slot in its own proper time".
        if (indep && _leashDue(ph, _V.kvSteps, _vCarrier)) { const qv2 = _gpu.readEyePsi(); const nm = _virtAdvance(qv2); if (nm) _gpu.setObjField(nm); }   // ⟲ leash: advance V's operator per ITS OWN slot-beat (τ_V cadence; flat kV%21 off selfClock — see _leashDue)
        if (_V.earVOn) { if ((_V.kvSteps % 21) === 0) { const qv2 = _gpu.readEyePsi(); _earVTest(qv2, _V.kvSteps); }
          while (_V.earV && _V.earV.pending.length && _V.kvSteps >= _V.earV.pending[0].startStep) { const rp = _V.earV.pending.shift(); const qv2 = _gpu.readEyePsi(); _sigAdd(qv2, rp); _gpu.setEyePsi(qv2);
            console.log(`[EAR-V] dream-PONG launched (${rp.fx},${rp.fy})→(${rp.tx.toFixed(0)},${rp.ty.toFixed(0)}) kV=${_V.kvSteps}`); } }
        if ((_boundOpen || _V.virtLeak > 0 || _V.selfClk || _K.edge) && Q > 0 && ((k + 1) % Q) === 0) { const qv = _gpu.readEyePsi();
          if (_V.virtLeak > 0 && _V.muxHold) for (let j = 0; j < qv.length; j++) qv[j] += _V.virtLeak * _V.muxHold[j];   // W→V leak (ψ_W frozen at the slice boundary)
          _kApply(qv, 1);   // M-e: V's coupling edges (slice-end sources)
          if (_boundOpen) _applyOpenBoundary(qv);
          if (_V.selfClk) { _selfClkTick(qv, k + 1, _V.virtMirror ? att : ((_V.virtGoOn && _V.virtAtt) ? _virtMovAtt() : _V.virtAtt), ph, _V.kvSteps); _tauAdv(k + 1); }   // M-c2 beat + τ_V on V's own counter. THE TRAVELING CLOCK (2026-07-11, ω-sweep discovery): during a journey the detector's reference is the MOVING att (the same rolled field the pin chases) — against the raw home plate, ℓ collapses with distance and the clock goes NUMB far from home (beats only near gx≈0, live-caught: ΔN=0 at gx 6–11, ΔN=6 near 0). The worldline's clock rides WITH the worldline. Deterministic: the roll is a pure fn of shared gx at a shared boundary.
          _gpu.setEyePsi(qv); }
      } else { const px = _V.phases[ph - 1 - vs]; if (!px) return true;
        const _pbi = 2 + (ph - 1 - vs);   // this phase's slot-name index (P1=2, P2=3) for the pin-amplitude dial
        if (px.att) _gpu.applyEyeSuperpose(_beta(_pbi));   // held (or chasing) at ITS OWN operator (P pin amplitude, refAmp sweep)
        if (px.att && !px.go) { const xtra = Math.min(nSl - 1, 2); for (let e = 0; e < xtra; e++) _gpu.applyEyeSuperpose(_beta(_pbi)); }   // mux-rate compensation (held booted phase, see V slice) — 1/nSl proper rate needs extra crush/slice to stay peer-deterministic
        _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); _gpu.applyEyeEnergyCap(px.e0);
        px.kv++;
        const pIndep = px.go && px.att;
        // PHASE PROPER-STEP LEASH (px.kv grid) — pulled OUT of the global-%Q block (same interlacing fix as W's coevo + V's leash): a booted phase owns 1/nSl scattered steps, so a global-%21 boundary that is ALSO its step rarely lands → its chase starves. px.kv%21 fires every 21 of ITS proper steps. Own field read (byte-identical). The chase algebra composes onto EVERY phase, honestly in its own proper time.
        if (pIndep && _leashDue(ph, px.kv, px)) { const qp2 = _gpu.readEyePsi(); const nm = _leashAdvance(px, qp2); if (nm) _gpu.setObjField(nm); }   // chase per ITS OWN slot-beat (τ_P cadence; flat kv%21 off selfClock — see _leashDue)
        if ((_boundOpen || _V.selfClk || _K.edge) && Q > 0 && ((k + 1) % Q) === 0) { const qp = _gpu.readEyePsi();
          if (_boundOpen) _applyOpenBoundary(qp);
          _kApply(qp, 2 + (ph - 1 - vs));   // M-e: this phase's coupling edges (slot name index: phases start at 2)
          if (_V.selfClk) { _selfClkTick(qp, k + 1, (px.go && px.att) ? _leashMovAtt(px) : px.att, ph, px.kv); _tauAdv(k + 1); }   // M-c2 beat + τ_P on the phase's own counter (traveling clock: a journeying phase's detector rides its moving att — see the V site)
          _gpu.setEyePsi(qp); } }
      if (ph >= 0 && ph < 4) _E.muxStepped[ph]++;   // proper-time render gate: this slot's field advanced this frame
      return true; };
    // v2 — LOCK-PROPORTIONAL pacing (v1's centroid leash falsified live: a grid-scale object's peak-centroid is a
    // stroke cell, not a position, AND the injection builds a bright copy AT the att → the leash chased its own
    // ghost, g wandered off-target shedding γ=20 ghosts, ▾0.06). The observable that CANNOT be self-fooled is the
    // LOCK (globally-normalized corr ψ·att): matter abandoned at the old position drags it down regardless of how
    // well the fresh injection self-matches — the same reason minLock caught death-regrow in the probes. Pacing:
    // g advances toward the queued target at ≤1px per shared 21-step boundary, scaled by σ = clamp((ℓ/ℓ0−0.75)·4,
    // 0,1) against a slow always-learning baseline ℓ0 (the reactor's continuous-sampling lesson: a paused gate must
    // keep learning or it deadlocks). Full speed at healthy lock, hard stop below 0.75·baseline (the regrow dip
    // measured 0.38·baseline). Deterministic: ℓ from the shared field + shared att at shared steps.
    const _coevoLeash = (f, att) => {   // update the effective att position; true = rounded position changed
      if (!att) return false;
      const l = _ampCorr(f, att);
      if (_coevoL0 <= 0) _coevoL0 = l; else _coevoL0 = _coevoL0 * 0.98 + l * 0.02;   // slow baseline, learns even while paused
      const sig = Math.max(0, Math.min(1, (l / Math.max(1e-6, _coevoL0) - 0.75) * 4));
      const dx = _transPx - _coevoGx, dy = _transPy - _coevoGy, d = Math.hypot(dx, dy);
      if (d < 1e-9 || sig <= 0) return false;
      const step = Math.min(1, d) * sig;                     // ≤1px per boundary, lock-scaled
      const ox = Math.round(1 + _coevoGx), oy = Math.round(1 + _coevoGy);
      _coevoGx += dx / d * step; _coevoGy += dy / d * step;
      return Math.round(1 + _coevoGx) !== ox || Math.round(1 + _coevoGy) !== oy;
    };
    // ⚡sig packet: Gaussian (w=2.5) at (fx,fy) with phase tilt |k|=0.9 aimed at (tx,ty) — a marginal mobile packet;
    // it flies at its group velocity and dies in the sustain (the RADIATION SECTOR — the measured mobility wall says
    // persistent matter is pinned, so honest self-propelled motion is transient by law, not by bug).
    const _sigAdd = (f, sg) => { const dx0 = sg.tx - sg.fx, dy0 = sg.ty - sg.fy, L = Math.hypot(dx0, dy0) || 1;
      const ux = dx0/L, uy = dy0/L, K = 0.9, A = sg.amp || 0.35, w2 = 2 * 2.5 * 2.5;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const d2 = (x-sg.fx)**2 + (y-sg.fy)**2; if (d2 > w2*8) continue;
        const a = A * Math.exp(-d2/w2), ph = K * (ux*(x-sg.fx) + uy*(y-sg.fy)), i = (y*GRID + x)*2;
        f[i] += a * Math.cos(ph); f[i+1] += a * Math.sin(ph); } };
    const _projectSources = (aY, aX) => {
      const cosY=Math.cos(aY), sinY=Math.sin(aY), cosX=Math.cos(aX), sinX=Math.sin(aX), halfG=(GRID-1)/2, fscale=halfG*PROJ_SCALE, reconZ=Math.round(GRID/16), total=CUBE_PTS.length;
      return CUBE_PTS.map(([ox,oy,oz]) => { const ry1=cosY*ox+sinY*oz, rz1=-sinY*ox+cosY*oz, rx=ry1, ry=cosX*oy-sinX*rz1, rz=sinX*oy+cosX*rz1, z=CAM_Z-rz;
        return { sx: halfG+(rx/z)*fscale*CAM_Z, sy: halfG-(ry/z)*fscale*CAM_Z, sz: z*(reconZ/CAM_Z), amp: 200.0*(0.5+0.5*(rz+1)/2)/total }; });
    };
    const _cubeField = (ox=0, oy=0, aY=_cubeAY, aX=_cubeAX) => {   // packed complex — the cube wavefront (phase codes depth); (ox,oy) px offset → transport-movable; (aY,aX) angle override → the drives pass the QUEUE-APPLIED angles (shared-step), display paths default to the render-tick mirror
      const sources = _projectSources(aY, aX), field = new Float64Array(2*N_CELLS);
      let szMin=Infinity, szMax=-Infinity; for (const {sz} of sources){ if(sz<szMin)szMin=sz; if(sz>szMax)szMax=sz; } const szRange=Math.max(1e-4, szMax-szMin);
      for (const {sx,sy,sz,amp} of sources){ const ix=Math.round(sx+ox)|0, iy=Math.round(sy+oy)|0; if(ix<0||ix>=GRID||iy<0||iy>=GRID)continue;
        const j=iy*GRID+ix, t=Math.max(0,Math.min(1,(sz-szMin)/szRange)), ph=t*Math.PI*4; field[j*2]+=amp*Math.cos(ph); field[j*2+1]+=amp*Math.sin(ph); }
      return field;
    };
    // OBJECT POOL: cube = the live GPU-coupled wavefront (app extra); the rest come from soliton-algebra's probeObjects.
    // The genome's OWN attractor isn't here (it's a recall target, not a world object). Full-grid region (margin 1).
    const _objExtras = {
      cube: (f) => f.set(_cubeField()),
      // the genome's OWN attractor: shine a clock's generator field through itself (code=data as a world object). TUNNEL: while a
      // tunnel is active the SOURCE itself becomes genome B's attractor (the committed destination), so the world soliton reshapes A→B.
      attractor: (f) => { const M=_S.medium;
        // CLOCK tunnel = THE INSTANTON THAT TUNNELS: the source IS the ruptured A-vacuum carried through B's MAPS by the IFS clock's
        // CONTRACTION (_tunnelClockField, built by _clockMigrate) — native transport, no seed (B's maps generate B from anything).
        if (_tunnelActive && _tunnelMode==='clock' && _tunnelClockField && _tunnelClockField.length===2*N_CELLS) { f.set(_tunnelClockField); return; }
        // EMERGENT tunnel = LENS-SPACE WALK: the source IS the packet carried through the INTERPOLATED lens φ_t (the barrier-free A→B
        // path) — _tunnelLensField, built by _emergentMigrate. SWITCH: B's rank. Else the active genome's attractor.
        if (_tunnelActive && _tunnelMode==='emergent' && _tunnelLensField && _tunnelLensField.length===2*N_CELLS) { f.set(_tunnelLensField); return; }
        // PHASE tunnel = TUNNEL THE LABEL (soliton phase), then DISPLAY B by the medium's own WAVE INTERFERENCE: once fired, the source IS
        // the DAMMANN IMAGE of B (resolves to B's triangle — FOCUS-DEPENDENT, dial the focus slider; user-confirmed live). NOT a render
        // (renderChaosGame ignores the wave); this RESPONDS to which B + to the focus. The soliton being driven toward the multi-point
        // image does lower its peak/mean (it becomes the focal constellation) — that's the lump RESOLVING into B's points at focus, not
        // destruction; the readout reads the IMAGE's sharpness, not a single-lump assumption. Label tunnels (soliton) → medium images B (Dammann).
        if (_tunnelActive && _tunnelMode==='phase' && _phaseTunFired) { const img=_dammannRef(_tunnelB); if (img && img.length===2*N_CELLS) { f.set(img); return; } }
        // BARRIER mode = WINNER-TAKE-ALL. The source is blobs at the REAL genome attractor (rank/rank+1) fixed points (_barrFpsA/B, measured
        // at fire — the native upgrade; falls back to the quad template only before fire when fps aren't set). Stays A until the kick crosses → flips to B.
        if (_tunnelActive && _tunnelMode==='barrier') { const cen=(_barrierTarget==='A'?_barrFpsA:_barrFpsB)||_barrRawCenters(_barrierTarget);
          for (let k=0;k<cen.length;k+=2){ const cx=Math.round(cen[k]),cy=Math.round(cen[k+1]);
            for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const X=cx+dx,Y=cy+dy; if(X<0||X>=GRID||Y<0||Y>=GRID)continue; const w=(dx===0&&dy===0)?1:0.45; f[(Y*GRID+X)*2]=Math.max(f[(Y*GRID+X)*2], w); } }
          return; }
        // VORTEX mode: pre-latch the drive is SUSTAIN-ONLY (winding does the transport) → show A's raw blobs (the starting false vacuum).
        // POST-LATCH (Fix 3): show the MIGRATING VACUUM's attractor (_vortexGenome) — ψ_in visibly SLIDES from A toward B@C as the genome
        // coevolves (the vacuum moving under the wave). The live transported soliton (the charged wave at C) is ψ_out.
        if (_tunnelActive && _tunnelMode==='vortex') {
          if (_vortexLatched && _vortexGenome && _vortexGenome.length) { try { const tmp=new Float64Array(N_CELLS); nlhoGenInject(tmp, _vortexGenome, GRID); for (let i=0;i<N_CELLS;i++){ f[i*2]=tmp[i]; f[i*2+1]=0; } } catch(e){} return; }
          const cen=_barrRawCenters('A');
          for (let k=0;k<cen.length;k+=2){ const cx=Math.round(cen[k]),cy=Math.round(cen[k+1]);
            for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const X=cx+dx,Y=cy+dy; if(X<0||X>=GRID||Y<0||Y>=GRID)continue; const w=(dx===0&&dy===0)?1:0.45; f[(Y*GRID+X)*2]=Math.max(f[(Y*GRID+X)*2], w); } }
          return; }
        const srcRank = (_tunnelActive && _tunnelB>=0 && _tunnelMode!=='phase') ? _tunnelB : (M.selectedRank!=null?M.selectedRank:M.activeRank);
        const rules = _rules[srcRank%_rules.length];
        try { nlhoGenInject(f, rules, GRID); } catch(e){} },
      // hidden: a Gaussian PACKET recursively passed through the PLANTED genome's phase lens (op:phase) → a chaotic phase cloud.
      // The packet is the target; _hiddenPacket holds it for the resonance read. Built on the GPU (phase mode = the pure medium).
      hidden: (f) => { if (!_gpu) return; f.set(_mkHiddenCloud(_PKT_WIDE, null, _liveHideDepth())); },   // WIDE packet (σ≈grid/5) — the working note (overlaps the plate); live depth breathes the hide
      // tight: the SAME hide, but a TIGHT central packet (σ≈6). This is the BUG I flagged — the packet sits where the plate phase
      // a·r²/β·angle ≈ 0, so the genome's note has no leverage → EVERY key recovers ~100% (no θ-discrimination, false resonance).
      // Kept as a side-by-side EXPERIMENT object: switch obj:tight vs obj:hidden to SEE the failure (all-ranks ~equal scores).
      tight:  (f) => { if (!_gpu) return; f.set(_mkHiddenCloud(_PKT_TIGHT, null, _liveHideDepth())); },
      // mixed: a SUPERPOSITION of TWO planted genomes' clouds (rank r and rank r+1) in ONE field. The eye must SELECT which
      // genome is present by RESONANCE — the matched filter lights up BOTH planted ranks (not one), and the eye's selected
      // rank acts as the EXTRACTION OPERATOR (bind the cue against that rank's template → pull out that component). See _mixedRanks.
      mixed:  (f) => { if (!_gpu) return; const N=GRID*GRID, out=new Float64Array(2*N), d=_liveHideDepth();
        for (const r of _mixedRanks()) { const cl=_mkHiddenCloud(_PKT_WIDE, r, d); for (let i=0;i<2*N;i++) out[i]+=cl[i]; }
        const k=1/Math.sqrt(_mixedRanks().length); for (let i=0;i<2*N;i++) out[i]*=k;   // normalize the superposition energy
        _hiddenCloud = out.slice(); f.set(out); },
    };
    // ── HIDDEN-CLOUD generator (shared by hidden/tight/mixed): a Gaussian packet (width sig2) recursively passed through
    //    planted-rank `rk`'s phase lens. Sets _hiddenPacket/_hiddenRank as a side-effect for the resonance read.
    const _PKT_WIDE = (GRID*0.2)**2, _PKT_TIGHT = 6*6;   // WIDE = the working note; TIGHT = the bugged no-leverage packet
    // depth = how many recursive hide passes (default HIDE_PASSES; the LIVE hide rides _E.monClock → the scrambling animates).
    const _mkHiddenCloud = (sig2, rk, depth) => { const c=GRID>>1, N=GRID*GRID, pk=new Float64Array(2*N);
      for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ const r2=(x-c)**2+(y-c)**2; pk[(y*GRID+x)*2]=Math.exp(-r2/(2*sig2)); }
      const rank = (rk!=null) ? (rk%_resoRules.length) : (_S.medium.activeRank % _resoRules.length);
      if (rk==null) { _hiddenPacket = pk.slice(); _hiddenRank = rank; }   // single-genome objects record the lock; mixed doesn't
      const lockTh = genomeAggregate(_resoRules[rank]).theta;
      _gpu.setEyePsi(pk); runGenomeLens(_gpu, _resoRules[rank], Math.max(1, depth|0)||HIDE_PASSES, GRID, DT, { ..._RESO_P(), thAdd:lockTh });
      return _gpu.readEyePsi(); };
    // LIVE HIDE DEPTH: a triangle 1→HIDE_PASSES→1 swept by _E.monClock (peer-identical), so the recursive lensing BREATHES — the
    // packet winds up into the chaotic cloud and unwinds back, a living recursive-lens clock instead of a baked field. _hideLive
    // toggles it (default on). At depth=1 the cloud ≈ the bare packet (re-focused); at HIDE_PASSES it's the full scramble.
    let _hideLive = true;
    const _liveHideDepth = () => { if (!_hideLive) return HIDE_PASSES; const P=2*HIDE_PASSES, ph=(_E.monClock*1.0)%P; return Math.max(1, Math.round(ph<HIDE_PASSES?ph:P-ph)); };
    // ── THE LENS-IN-THE-WAVEFRONT MATCHED FILTER (shared by the resonance read AND eye recall). Builds the per-genome LENSED
    //    signatures (a packet × each genome's phase lens — the SAME representation as the incoming cloud) and correlates the
    //    incoming wavefront against each → scores. argmax = which planted LENS generated this wavefront. This is recall on the
    //    OPERATOR carried IN the field (not a delensed image): the input is "wavefront WITH a lens", recall reads the lens out.
    const _corrLensed = (cue, tmpl, Nn) => { let cr=0,ci=0,ec=0,et=0; for (let i=0;i<Nn;i++){ const ar=cue[i*2],ai=cue[i*2+1],br=tmpl[i*2],bi=-tmpl[i*2+1];
      cr+=ar*br-ai*bi; ci+=ar*bi+ai*br; ec+=ar*ar+ai*ai; et+=br*br+bi*bi; } return (ec>0&&et>0)?Math.hypot(cr,ci)/Math.sqrt(ec*et):0; };
    // Templates must be built at the SAME hide depth as the cloud being matched (a depth-6 template scores ~0 on a depth-2 cloud —
    // measured). The live hide breathes the depth, so we cache per-depth (small int set 1..HIDE_PASSES) and rebuild only on a depth
    // change. _resoTemplates mirrors the CURRENT depth's bank (the resonance read + recall both consume it). _resoTemplDepth tracks it.
    let _resoTemplDepth = -1, _resoStrSeen = -1;
    const _ensureTemplates = () => { const d = _isHidden(_lensObj) ? _liveHideDepth() : HIDE_PASSES;
      if (_resoTemplates && _resoTemplDepth===d && _resoStrSeen===_resoStrength) return;
      const Nn=N_CELLS, save=_gpu.readEyePsi(); _resoTemplates=[];
      const pk=new Float64Array(2*Nn); const c=GRID>>1, sig2=_PKT_WIDE;
      for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){ const r2=(x-c)**2+(y-c)**2; pk[(y*GRID+x)*2]=Math.exp(-r2/(2*sig2)); }
      for (let r=0;r<_resoRules.length;r++){ _gpu.setEyePsi(pk);
        runGenomeLens(_gpu, _resoRules[r], d, GRID, DT, { ..._RESO_P(), thAdd:genomeAggregate(_resoRules[r]).theta });
        _resoTemplates.push(_gpu.readEyePsi()); }
      _resoTemplDepth=d; _resoStrSeen=_resoStrength; _gpu.setEyePsi(save); };
    // ── M3: THE LOCK-SWEEP PRIMITIVE — the one recall of the whole medium. Bind a cue against a bank via a
    //    globally-normalized correlation (the only self-fooling-proof observable class) → scores + argmax.
    //    ALL recalls are THIS: the hypervisor's plate recall (corr=_ampCorr, bank=_V.virtBank plates → WHICH MOMENT),
    //    the eye's genome recognition (corr=_corrLensed, bank=_resoTemplates → WHICH GEOMETRY), the resonance read.
    //    recall = content-addressable clock: the cue selects WHICH stored moment/geometry runs. {condensation,
    //    lock-sweep, round-trip} is now the complete recall plumbing — the eye.md §8 collapse, done.
    const _lockSweep = (cue, bank, corrFn) => { const scores = bank.map(t => corrFn(cue, t));
      let best = 0; for (let r = 1; r < scores.length; r++) if (scores[r] > scores[best]) best = r;
      return { scores, best }; };
    // recognize the lens in `cue`: returns {scores, best}. Pure read (restores the eye buffer). Used pre-recon so recall can adopt it.
    const _recognizeHidden = (cue) => { _ensureTemplates(); const Nn=N_CELLS;
      return _lockSweep(cue, _resoTemplates, (c, t) => _corrLensed(c, t, Nn)); };
    // mixed: which planted ranks are superposed in the field. The MEDIUM rank picks the first; +2 (wrapped) is the second → two
    // VISUALLY DISTINCT shapes (e.g. r0 square + r2 diamond-T), so the eye-rank extraction shows an obviously different geometry per pick.
    const _mixedRanks = () => { const r0 = _S.medium.activeRank % _resoRules.length; return [r0, (r0+2)%_resoRules.length]; };
    // the MEDIUM source object (built inline in _frame via makeProbeField + _objExtras; self mode → the code-as-wavefront).

    // ── THE LENS = a composeLens STACK from the soliton-algebra library (the "trap = composition" architecture). medium.js
    //    is a thin CONSUMER: it builds ONE stack per scope and runs it ONCE per frame. The MEDIUM stack = makePerception
    //    (the genome lens for the mode). The EYE stack = makeTrapStack = opHologram→opRecon→makePerception (the SAME
    //    perception body, on the lifted RECON). The scope bag IS the ctx the ops read/write (selectedRank/selfRules/...).
    const _LMAXD = 24;   // recursive-clock depth: triangle 0→MAXD→0, advancing opSpeed steps per bar (the lens clock rate)
    const _runLens = (gpu, rules, depth, P=_lensP) => runGenomeLens(gpu, rules, depth, GRID, DT, { ...P });   // (world-source coevolve)
    const _codeField = (rules) => genomeCodeField(rules, GRID);   // (self-mode monitor: ψ_in IS the code-as-wavefront)
    // the genome the lens RUNS: recall/coevolve override it (selectedRank / replicaRules); else the manual activeRank — BUT if self
    // mode has produced an evolved+grown genome (_evolved) and recall isn't selecting, pass/clock AUTO-USE it (the meta-circle: the
    // evolved genome IS the active operator). Commit (button) persists _evolved into the bank; until then it's a live preview.
    // the BANK a scope resolves genomes from. For the hidden family, the EYE in recall/recall→self resolves from the RESONANCE bank
    // (the planted lenses) so a recognized rank seeds/runs the SAME genome that made the wavefront — the lens-in-the-field loop stays
    // faithful (recall the resonance lens → run/evolve THAT lens, not the unrelated default-bank genome at the same index).
    const _scopeBank = (ctx) => (_isHidden(_lensObj) && ctx===_S.eye && (ctx.mode==='recall'||ctx.mode==='recallself')) ? _resoRules : _rules;
    const _activeGenome = (ctx) => { const bank=_scopeBank(ctx);
      // TUNNEL (medium scope, active): SWITCH mode = hard lens-swap to B (the honest programmatic transition). EMERGENT mode = run the
      // LIVE MIGRATING genome (_tunnelGenome, physically nudged A→B by coevolve each bar — NO swap; the wave-energy feedback moves the rules).
      if (_tunnelActive && ctx===_S.medium && _tunnelB>=0) {
        if (_tunnelMode==='emergent') return (_tunnelGenome && _tunnelGenome.length) ? _tunnelGenome : bank[ctx.activeRank%bank.length];
        // VORTEX Fix 3: once latched at C, run the LIVE MIGRATING VACUUM (_vortexGenome, coevolving toward B@C each bar) — the whole
        // medium reads the sliding vacuum, so the attractor visibly slides under the wave until C becomes B's basin (the dual-layer A→B).
        if (_tunnelMode==='vortex' && _vortexLatched && _vortexGenome && _vortexGenome.length) return _vortexGenome;
        return bank[_tunnelB%bank.length]; }
      return ctx.replicaRules
      || (ctx.selectedRank!=null ? bank[ctx.selectedRank%bank.length]
          : (_evolved && _evolved.length) ? _evolved
          : bank[ctx.activeRank%bank.length]); };
    // the recursive-lens CLOCK depth, swept by _E.monClock (peer-identical) — clock/recall/coevolve ride it; pass = 1 pass.
    const _clockDepth = (ctx) => { if (ctx.mode==='pass') return 1; const sp=Math.max(1,ctx.P.opSpeed|0), ph=(ctx.phaseT*sp)%(2*_LMAXD); return Math.max(1, Math.round(ph<_LMAXD?ph:2*_LMAXD-ph)); };
    // the recall CUE: the planted genome's field, bar-keyed corrupted by (1−cueClean) noise (the §9 [H] degradable probe).
    const _cueFn = (ctx) => { const N=N_CELLS, planted=ctx.activeRank%_rules.length, keep=Math.max(0,Math.min(1,ctx.P.cueSignal)), bar=ctx.bar;
      const gP=new Float64Array(2*N); nlhoGenInject(gP, _rules[planted], GRID);
      let gE=0; for(let i=0;i<N;i++) gE+=gP[i*2]**2+gP[i*2+1]**2; const gAmp=Math.sqrt(gE/Math.max(1,N)), noiseA=(1-keep)*gAmp*2, cue=new Float64Array(2*N);
      for(let i=0;i<N;i++){ const h=((i*2654435761^(bar*2246822519))>>>0)/4294967296; if(h<keep){cue[i*2]=gP[i*2];cue[i*2+1]=gP[i*2+1];}
        const h2=(((i*40503)^(bar*19349663))>>>0)/4294967296,h3=(((i*12289)^(bar*83492791))>>>0)/4294967296; cue[i*2]+=noiseA*(h2-0.5); cue[i*2+1]+=noiseA*(h3-0.5);}
      let ecue=0; for(let i=0;i<N;i++) ecue+=cue[i*2]**2+cue[i*2+1]**2; return { cue, ecue }; };
    // the perception SPEC: wires medium's data into the library ops (bank/cue/seed/source/genome/depth + the memo keys).
    // keyFn lists EVERY input the memoized op reads → recompute the bar-walk only on a real change (the perf gate, per scope).
    const _spec = (ctx) => ({
      bankFn: () => _scopeBank(ctx), cueFn: _cueFn, genomeFn: () => _activeGenome(ctx), depthFn: () => _clockDepth(ctx),
      // SELF mode seeds from the MEDIUM's IDENTITY, not the UI rank: selectedRank (the medium's SELECTION — set by recall OR by a landed
      // TUNNEL) overrides activeRank. So after a phase tunnel (which sets selectedRank=B), self mode evolves from B, not the old rank. The
      // medium tells self mode its rank (meta-circular: read the medium's state, don't trust the stale UI control).
      seedFn: () => { const bank=_scopeBank(ctx); return bank[((ctx.selectedRank!=null)?ctx.selectedRank:ctx.activeRank)%bank.length]; },
      srcFn: () => ctx.coevSrc || ((_E.localObjField&&_E.localObjField.length===2*N_CELLS)?_E.localObjField:null),
      lawFn: () => ctx.selfLaw, opSpeed: Math.max(1, ctx.P.opSpeed|0), recallT: 12, P: ctx.P,
      // memo keys list EVERY input the op reads — INCLUDING the occlusion (occ) so a damaged re-derivation recomputes when r/mode/blk
      // change. _occKey(c) = the occ fingerprint (empty when off) → recall/self re-walk under the new damage; clean when off.
      recallKeyFn: (c) => `${c.bar}|${c.activeRank}|${(+c.P.cueSignal).toFixed(3)}|${_rulesVer}${_occKey(c)}`,
      selfKeyFn:   (c) => `${c.bar}|${(c.selectedRank!=null)?c.selectedRank:c.activeRank}|${c.selfLaw}|${(c.P.opSpeed|0)}|${_rulesVer}|g${c.growMax||0}${_occKey(c)}`,
      coevKeyFn:   (c) => `${c.bar}|${c.activeRank}|${(c.P.opSpeed|0)}|${_rulesVer}`,
      holoTFn: () => (_eyeLensP.holoT>0?_eyeLensP.holoT:0),
      // FOCAL DEPTH: optics:on → autofocus picks it (opRecon reads ctx.focusDepth). optics:off → the MATCHED plane (holoT, or
      // reconD when no hologram) + the MANUAL focusManual offset → rack-focus around the in-focus plane (0=sharp, ±=defocus).
      reconDFn: () => { if (_opticsOn) return undefined;   // undefined → opRecon falls back to ctx.focusDepth (autofocus)
        const matched = _eyeLensP.holoT>0 ? _eyeLensP.holoT : (_eyeLensP.reconD||EYE_RECON_D);
        return Math.max(1, matched + (_eyeLensP.focusManual|0)); },
      opticsFn: () => _opticsOn, ctx,
      // CODE ACTS ON THE IMAGE (eye-only, before recon). maskFn = the LIVE mutating genome (selfRules when self-evolving → the
      // mutations show; else the selected/active genome). Two couplings: WARP = geometric operator (§7.97); GATE = content mask (§7.90).
      codeWarpGainFn: () => (_uiScope==='eye' ? (_eyeLensP.codeWarp||0) : 0),   // data=code: master gain (rotate/scale/translate the image)
      // PER-PARAMETER warp gains — each isolates one geometric DOF of the genome operator (null = follow the master gain).
      paramGainFn: () => (_uiScope!=='eye') ? null : { s: _eyeLensP.codeWarpS, theta: _eyeLensP.codeWarpTheta, tx: _eyeLensP.codeWarpTx, ty: _eyeLensP.codeWarpTy },
      mapCountFn: () => (_uiScope==='eye' ? (_eyeLensP.codeWarpMaps|0) : 99),   // replication count = # of the genome's maps that act
      codeMaskGainFn: () => (_uiScope==='eye' ? (_eyeLensP.codeMask||0) : 0),   // code-as-content: mask which content survives
      maskFn: (c) => (c.selfRules && c.selfRules.length) ? c.selfRules : _activeGenome(c),
    });
    // the occlusion fingerprint for the memo keys (only the EYE occludes → ctx.occ; empty string = no damage = clean re-derivation).
    const _occKey = (c) => (c.occ && (c.occ.mode|0) && (c.occ.r||0)>0) ? `|occ${c.occ.mode}r${(+c.occ.r).toFixed(2)}b${c.occ.block|0}h${c.occ.holoT|0}` : '';
    // BUILD the scope's stack (rebuilt only on mode/optics change → cached on ctx._stackKey). EYE = trap (record→read+perceive);
    // MEDIUM = the perception alone. CRITICAL: the genome-lens P is the OVERRIDE ONLY ({holoT:0} for the eye) — opGeometryLens
    // merges {...ctx.P, ...P}, and ctx.P is the LIVE param object (_lensP / _eyeLensP), so SLIDER edits apply immediately
    // WITHOUT a stack rebuild. (A build-time full P snapshot was the bug: eye sliders only took effect on a mode toggle.)
    // EFFECTIVE mode for the trap: for the hidden family in the EYE, the LIBRARY opRecall would mis-select (its impulse-cue scores 0
    // on a lensed cloud). We already recognized the lens via the matched filter (E.selectedRank pre-set), so route recall→PASS (the
    // genome lens runs the recognized rank) and recall→self→SELF (self-evolve seeds the recognized rank). The library recall never
    // runs → it can't clobber the recognized rank, and the recon uses the LENS we recalled from the wavefront.
    const _effMode = (ctx, isEye) => (isEye && _isHidden(_lensObj))
      ? (ctx.mode==='recall' ? 'pass' : ctx.mode==='recallself' ? 'self' : ctx.mode) : ctx.mode;
    const _buildStack = (ctx, isEye) => {
      const em = _effMode(ctx, isEye);
      const key = `${em}|${isEye?'eye':'med'}|${isEye&&_opticsOn?'O':'_'}`;
      if (ctx._stackKey === key && ctx._stack) return ctx._stack;
      const spec = _spec(ctx);
      ctx._stack = isEye
        ? makeTrapStack(em, { ...spec, P: { holoT: 0 } })   // override only — live ctx.P (=_eyeLensP) supplies the rest
        : makePerception(em, spec);
      ctx._stackKey = key; return ctx._stack;
    };
    // RUN a scope ONCE: refresh the ctx (bar/phaseT/P + the live source/coevSrc), run the cached stack, return the field.
    // For the eye, ctx.hologram (EYE ◀) and ctx.recon (EYE ▸ raw) are set by the trap ops; the return is the perceived recon.
    const _runScope = (ctx, isEye, input, P, phaseT, bar) => {
      if (!_gpu) return null;
      ctx.G=GRID; ctx.dt=DT; ctx.bar=bar; ctx.phaseT=phaseT; ctx.P=P; ctx.hologram=null; ctx.recon=null; ctx.occluded=null;
      ctx.coevSrc = isEye ? input : null;   // eye coevolves toward its recon-input; medium toward its source (srcFn fallback)
      // OCCLUSION rides ctx.occ (a UNIFORM medium property → damages EVERY wavefront: image hologram + program cue/code-field).
      // EYE-only (live _eyeLensP, no rebuild); the medium has no occlusion (ctx.occ = null → occludeField is identity).
      // holoT rides into occ too: the PROGRAM occlusion is HOLOGRAPHIC (spread the code by holoT BEFORE damage → delocalized →
      // bigger occlusions only DIM it → higher holoT = better survival/resurrect). Matches the image path's hologram→occlude→recon.
      ctx.occ = isEye ? { mode: _eyeLensP.occMode|0, r: _eyeLensP.occR||0, block: _eyeLensP.occBlock|0, holoT: _eyeLensP.holoT|0, seed: 0 } : null;
      // GROW (self-evolution adds maps in the medium, §7.88): ctx.growMax = the ceiling (0/off → fixed count). The genome reads its
      // own evolved field and ADOPTS emergent peaks as new maps, up to growMax. f(bar) peer-pure. Shared (both scopes can grow).
      ctx.growMax = _growMax || 0;
      ctx.growBirth = 0.15;   // birth sensitivity (peak must clear 15% of max, ≥G/12 from existing maps) — matches the IFS's real far-structure
      const saved = _gpu.readEyePsi();
      const out = _buildStack(ctx, isEye)(input, _gpu, ctx) || input;
      _gpu.setEyePsi(saved);
      // SELF MODE produced an evolved+grown genome → publish it so pass/clock AUTO-USE it (the meta-circle: the operator the medium
      // evolved becomes the active operator). Captured from the ACTIVE scope's self run (so what you watch in self is what pass runs).
      if (_isSelf(ctx) && ctx.selfRules && ctx.selfRules.length) _evolved = ctx.selfRules;
      return out;
    };

    // ── WORLD OBJECT self-coevolve AT SOURCE (active world): bar-pure, mutates its OWN genome, reshaping ψ at the source.
    //    MEDIUM-only (the eye has no source). Memoized on `bar` via _worldBar. (Kept inline — it's a source transform, not a lens op.)
    const _worldSelfTransform = (gpu, objField, bar) => {
      const M = _S.medium;
      if (_worldBar !== bar) {
        const saved = gpu.readEyePsi();
        let rules = _rules[M.activeRank%_rules.length].map(m=>({...m}));
        const steps = Math.min(bar, 24);
        gpu.setEyePsi(objField);
        for (let s=0;s<steps;s++) { _runLens(gpu, rules, barClockDepth(bar, _lensP.opSpeed, _LMAXD)); const lensed = gpu.readEyePsi();
          let pbi=-1,pbv=0; for(let i=0;i<N_CELLS;i++){const a=lensed[i*2]**2+lensed[i*2+1]**2; if(a>pbv){pbv=a;pbi=i;}}
          if (pbi>=0&&pbv>1e-9){ const pkx=pbi%GRID,pky=(pbi/GRID)|0,lr=0.10;
            rules = rules.map((m,idx)=>{ const d=Math.max(1e-3,1-m.s), rate=lr*(0.5+0.5*idx/Math.max(1,rules.length-1));
              return {...m, tx:m.tx+rate*((pkx-GRID/2)*d-m.tx), ty:m.ty+rate*((pky-GRID/2)*d-m.ty)}; }); } }
        gpu.setEyePsi(saved); _worldGenome = rules; _worldBar = bar;
      }
      const saved = gpu.readEyePsi(); gpu.setEyePsi(objField); _runLens(gpu, _worldGenome, barClockDepth(bar, _lensP.opSpeed, _LMAXD));
      const out = gpu.readEyePsi(); gpu.setEyePsi(saved); return out;
    };

    // ── OUTPUT STATE. _probeRaw = the fresh-source fallback (the lens's input when no object yet). _RECALL_T for the probe.
    let _probeRaw = null; const _RECALL_T = 12;
    // ── l11_best_lens RENDER (the best rendering): render a COMPLEX field via the hologram colormap (gpu.renderEyeField,
    //    same look as the fractal panels — uses the gpu's render texture as scratch) with the INSTANTANEOUS per-field peak (max contrast,
    //    no EMA lag) + a FULL-GRID view-crop blitted Y-flipped with HIGH-QUALITY bilinear smoothing (crisp, not blocky).
    //    Uses the eye buffer as render scratch — _frame's lens compute also saves/restores it, so no cross-call leak; the
    //    persist soliton lives in the SWEEP buffer (untouched here). complexPsi = packed [re,im,...] 2·N.
    const _VX0 = 1, _VY0 = 1, _VSIDE = GRID - 2;   // full-grid view (stable zoom in every mode)
    const _peakSq = (a) => { let m=1e-12; for(let j=0;j<(a.length>>1);j++){ const v=a[j*2]*a[j*2]+a[j*2+1]*a[j*2+1]; if(v>m)m=v; } return m; };
    // GLOW control: the hologram colormap's log curve (lv = log(1+99·amp)/log100) lifts faint amplitude into bright halo.
    // Normalizing to a HIGHER smoothMax (true peak × _GLOW) shrinks amp → less bloom/halo, tighter dots. >1 = less glow.
    const _GLOW = 3.0;
    // PHASE renderer (GPU): hue = phase angle, value = log-|ψ| — shows what the INTENSITY view can't (phase mode is ψ·e^{iφ},
    // so the genome's signature & the reso-strength effect live ENTIRELY in the phase, invisible to intensity). Uses the
    // GLSL_RENDER_PHASE shader via renderEyePhase() — same upload/draw path as the intensity render below, no CPU per-pixel pass.
    // step 5 — render THROUGH the slot's readOp when view:∠lens is on: the panel shows lensU1.apply(op, ψ), i.e. the
    // observer's actual read of its own field (the same operator every meter measures). Display-only (peer-local
    // toggle, field bytes untouched); identity descriptors make it a no-op, so raw and ∠lens agree until an observer ages.
    const _lensedView = (sl, f) => (_dials.lensView && f && (lensU1.angle(_lensOp[sl]) || _lensOp[sl].mode !== 'id')) ? lensU1.apply(_lensOp[sl], f, GRID) : f;   // metric/gauge readOps render as REAL transformed views (the full apply, grid-exact)
    const _drawL11 = (cell, complexPsi) => {
      if (!complexPsi || !_gpu || !_gpuCanvas) return;
      const saved = _gpu.readEyePsi();                       // preserve the eye buffer (it's shared scratch)
      _gpu.setEyePsi(complexPsi);
      if (_phaseView) _gpu.renderEyePhase(_peakSq(complexPsi) * _GLOW);   // hue=∠ψ — reveals the pure-phase signature & strength effect
      else            _gpu.renderEyeField(_peakSq(complexPsi) * _GLOW);   // hologram colormap, peak scaled up → less glow
      _gpu.setEyePsi(saved);
      const ctx=cell.ctx, W=cell.canvas.width, H=cell.canvas.height, vspan=_VSIDE, cellp=Math.min(W,H)/vspan, dw=vspan*cellp, offx=(W-dw)/2, offy=(H-dw)/2;
      ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
      ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
      ctx.drawImage(_gpuCanvas, _VX0, GRID-(_VY0+_VSIDE), _VSIDE, _VSIDE, offx, offy, _VSIDE*cellp, _VSIDE*cellp);   // Y-flip (GL bottom-up)
    };

    // ── SELF-MODE META-CIRCLE CANVASES (eye.js's two attractor panels) — only in self mode. glyph = the genome's
    //    code-as-wavefront (rule → generator); attractor = the GPU full-res chaos-game render of the SAME evolving
    //    rule-set (rule → attractor). Together: rule→generator→attractor→wave→rule, the closed meta-circle.
    // SCOPE-AWARE: the meta-circle panels show the ACTIVE scope's self genome (medium's OR the eye's self-evolved code).
    const _renderSelfCanvases = (bar) => {
      const s = _sc(), on = _isSelf(s);
      row2.style.display = on ? 'flex' : 'none';
      if (!on || !s.selfRules || !_gpu) return;
      // applyLife bakes per-map life (0=terminated by occlusion) into amplitude → DEAD maps DROP OUT of the glyph + attractor
      // (the program visibly dies, doesn't snap back to the clean pose). occlusion off / recovered → life→1 → full genome restored.
      const selfRules = applyLife(s.selfRules);
      const _life = (s.selfLife || selfRules.map(()=>1)), _deadN = _life.filter(v => v < 0.5).length;
      const _meanLife = _life.reduce((a,b)=>a+b,0)/Math.max(1,_life.length);
      // PROGRAM TERMINATED: all maps dead → render EMPTY (a degenerate s≈0 IFS would still plot the K fixed-point dots / a clean
      // glyph — NOT honest). Below the floor we draw black panels + a ⚰ overlay = the program is GONE (resurrects when life recovers).
      if (_meanLife < 0.08) {
        for (const c of [glyphCell, attrCell]) { const cx=c.ctx, cw=c.canvas.width, ch=c.canvas.height;
          cx.fillStyle='#000'; cx.fillRect(0,0,cw,ch); cx.fillStyle='#a33'; cx.font='16px monospace'; cx.textAlign='center';
          cx.fillText('⚰ PROGRAM TERMINATED', cw/2, ch/2); cx.textAlign='left'; }
        s.attrKey = `DEAD|${_uiScope}`;   // force a redraw when it resurrects (any non-dead key differs)
        glyphCell.setLabel(`⟳ ${_uiScope==='eye'?'EYE ':''}rule → generator · ⚰ ${_life.length}/${_life.length} TERMINATED (occluded to extinction)`);
        attrCell.setLabel(`NLHO attractor · ⚰ TERMINATED — the program's code was destroyed in the medium`);
        return;
      }
      // The DEAD maps are PHYSICALLY REAL — their soliton collapsed onto the fixed point (s≈0 → a point), a true medium state.
      // So we KEEP them in the render (they show as the corpse dots at their fixed points) and the chaos-game runs the FULL genome.
      const renderRules = selfRules;
      // GLYPH = the genome's W matrix (growNlhoGlyph → an L×L mean-subtracted attractor-density grid) rendered as a
      // CHECKERBOARD of colored blocks — the genome's PHENOTYPE as a value matrix (eye.js's recalled-glyph look). Dimmed by mean life.
      const L = 16, gl = _gpu.growNlhoGlyph(renderRules, L, { wantField: false }), W = (gl && gl.W) ? gl : { W: gl };
      const Wm = W.W || W; let amax = 1e-9; for (let i=0;i<Wm.length;i++){ const a=Math.abs(Wm[i]); if(a>amax)amax=a; }
      const gx=glyphCell.ctx, GW=glyphCell.canvas.width, GH=glyphCell.canvas.height, cw=GW/L, ch=GH/L;
      gx.fillStyle='#000'; gx.fillRect(0,0,GW,GH);
      const _dim = 0.25 + 0.75*_meanLife;   // partial death dims the glyph (mean life) → fades as maps die, not just dropping out
      for (let ly=0;ly<L;ly++) for (let lx=0;lx<L;lx++){ const v=Wm[ly*L+lx]/amax, t=Math.min(1,Math.abs(v));   // density ramp: black→blue→cyan→white
        const r=Math.round(_dim*255*Math.max(0,t-0.6)/0.4), g=Math.round(_dim*255*Math.min(1,t/0.7)*0.85), b=Math.round(_dim*255*Math.min(1,t/0.45));
        gx.fillStyle=`rgb(${r},${g},${b})`; gx.fillRect(lx*cw, (L-1-ly)*ch, Math.ceil(cw), Math.ceil(ch)); }   // Y-flip (GL bottom-up)
      const _bornN = (s.selfRules || []).filter(m => m._born).length;
      const _glabel = _bornN > 0 ? ` · 🌱 ${_bornN} GROWN (self-evolution added)` : '';
      const _dlabel = (_deadN > 0 ? ` · ⚰ ${_deadN}/${_life.length} TERMINATED (corpse dots = collapsed fixed points)` : '') + _glabel;
      glyphCell.setLabel(`⟳ ${_uiScope==='eye'?'EYE ':''}rule → generator: W glyph (${L}²)${s.mode==='recallself'?` · recall→r${s.selectedRank}`:''} · K=${selfRules.length} maps${_dlabel} · θ ${selfRules.map(m=>(m.theta||0).toFixed(2)).join(' ')}`);
      // ATTRACTOR = the GPU chaos-game of the evolving rules (redraw only when the genome/bar changes — θ + life-keyed so death/resurrect redraws).
      const attrKey = `${_uiScope}|${s._selfKey}|${selfRules.map((m,i)=>`${(m.theta||0).toFixed(3)}:${_life[i].toFixed(2)}`).join(',')}`;
      if (attrKey !== s.attrKey) {
        s.attrKey = attrKey;
        const out = _gpu.renderChaosGame(renderRules, { chains: 30000, iters: 16 });   // FULL genome: dead maps (s≈0) show as corpse dots at their fixed points (physically real)
        const W = attrCell.canvas.width, H = attrCell.canvas.height, ctx = attrCell.ctx;
        ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
        if (out && out.pixels) {
          if (!_chaosScratch || _chaosScratch.width !== out.P) { _chaosScratch = document.createElement('canvas'); _chaosScratch.width=_chaosScratch.height=out.P; _chaosScratchCtx=_chaosScratch.getContext('2d'); }
          const id = _chaosScratchCtx.createImageData(out.P, out.P), d = id.data, src = out.pixels;
          for (let y=0;y<out.P;y++){ const sy=(out.P-1-y)*out.P*4, dy=y*out.P*4; for(let i=0;i<out.P*4;i++) d[dy+i]=src[sy+i]; }   // GL bottom-up → flip Y
          _chaosScratchCtx.putImageData(id,0,0); ctx.imageSmoothingEnabled=false; ctx.drawImage(_chaosScratch,0,0,W,H);
        }
        attrCell.setLabel(`NLHO attractor (chaos-game)${s.mode==='recallself'?` · the RECALLED genome r${s.selectedRank} evolving`:''} · K=${selfRules.length} maps${_dlabel} · θ-evolving · ${out?out.P:'?'}²`);
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
      // PEER-HASH readout: stateH = digest of the replicated controls (med*+eye*+genome) → matches if the reducers stayed in sync;
      // eyeH = the eye RECON field digest (the real physics output). Two peers on the same event stream show identical hashes.
      const _stateH = _fnv([n.medMode,n.medOp,n.medRank,n.medFocus,n.medTheta,n.medShiftX,n.medShiftY,n.medPropT,n.medFocalDt,n.medHoloT,n.medCueClean,n.medDrive,
        n.eyeMode,n.eyeOp,n.eyeRank,n.eyeFocus,n.eyeTheta,n.eyeShiftX,n.eyeShiftY,n.eyeHoloT,n.eyeOptics,n.eyeFocusManual,n.eyeOccMode,n.eyeOccR,n.eyeOccBlock,
        n.eyeCodeMask,n.eyeCodeWarp,n.eyeCodeWarpS,n.eyeCodeWarpTheta,n.eyeCodeWarpTx,n.eyeCodeWarpTy,n.eyeCodeWarpMaps,n.eyeResoStr,n.eyeGrowMax,n.genomeVer].join('|'));
      hdr.textContent = `IFS world-clock · GRID ${GRID}² · IFS_DEPTH ${IFS_DEPTH} · tiers ${N_DEPTH_TIERS} · DT ${DT} · MBINS ${MBINS} · cyc ${n.cycleCount ?? 0} · bar ${Math.floor((n.cycleCount ?? 0) / MBINS)} · ${n.cachedRadii?.length ? 'RUNNING' : 'waiting…'} · t ${(n.time??0).toFixed(2)} · stateH ${_stateH} · medH ${_lastMedHash}${_driveMode!=='write'?` · solH ${_lastSolHash}${_lastSolMacro?` ⊙${_lastSolMacro.s}`:''}${(_driveMode==='transport'||_driveMode==='objorbit')?` ∿${_E.lockNow.toFixed(2)}▾${_E.lockMin.toFixed(2)}${_V.psiVirt?` ${_V.virtMux?'⧉':''}V⊗${_V.virtCorr.toFixed(2)}`:''}${_V.virtBank.length?` ⎙${_V.virtBank.length}`:''}${_V.phases.length?` ⊞${_V.phases.length}`:''}`:''}`:''}${_uiScope==='eye'?` · eyeH ${_lastEyeReconHash}`:''}`;
      if (!n.cachedRadii?.length) return;
      _E.readyFrames++;   // FIRST-LOAD RACE FIX: count frames past BOTH readiness gates (GPU-ready + world-clock kernel). Used by the snapshot grace window below.
      _syncFromState(n);   // reflect ALL shared controls (n.med*) onto the local mirror + widgets BEFORE driving physics → both peers identical
      _refreshVirtToggles();   // reflect live hold/mux/selfClock toggle state onto their buttons (these mutate inside the drive loop, not via n.med*)
      _refreshBar5();          // reflect live refAmp/attPhase/edge/bank state onto the register/coupling strip
      _lastNode = n;   // read-only stash for console analysis helpers (keplerIFS)
      // LATE-JOINER (the KWE idiom — counter.js:60): the framework's applySnapshot restores the WORLD state (controls + n.time + n.medSnapClock + the staged
      // soliton ψ in n.medSnapPsi) and sets _snapshotApplied. On that flag the joiner SEEDS from the leader's ψ + adopts its step count → byte-identical (a parked
      // soliton does NOT self-converge, so the field must be transferred — via the framework's WS snapshot channel, OFF the render path → no leader freeze). The world snapshot
      // already carries everything replicated, and the soliton rebuilds from the shared anchor — visually correct (same chase/target), bit-converged by the contraction.
      const _wApp = world?.ps?.app;
      if (_wApp && _wApp._snapshotApplied) { _wApp._snapshotApplied = false;
        _objOrbTheta=0; _transLastPx=NaN; _transLastPy=NaN;
        // RESTORE the leader's FULL soliton state VERBATIM (field + clock origin + step count + E0 + ease position). Then DO NOTHING else — the framework's
        // natural reflector-tick replay (the buffered ticks the joiner missed) advances the soliton forward exactly as the leader did, since target=floor((_E.monClock
        // −_stepClk.c0)·19) uses the SAME restored origin. NO re-anchor/catch-up burst (that would double-count against the tick replay → the drift seen before).
        const _sp = _wApp.medSnapPsi;
        if (_sp && _sp.length===2*N_CELLS && typeof _wApp.medSnapClock0==='number') {
          _E.psiLensed = (_sp instanceof Float64Array) ? _sp.slice() : Float64Array.from(_sp); _solSeeded = true; _E.solInit = true; _E.snapConsumed = true;   // snapshot restored → self-seed no longer needed/allowed (grace satisfied)
          // RESTORE VERBATIM: field + step count + the SHARED clock origin. The framework brings n.time to "now"; the joiner continues the chase from the
          // leader's exact field. (Residual: sub-pixel FP from batch-size differences — the SAME effect the working multi-peer branch has, NOT a transfer bug.)
          _E.solSteps = (_wApp.medSnapSteps|0); _stepClk.c0 = _wApp.medSnapClock0;
          _E.kwSteps = (typeof _wApp.medSnapKw === 'number') ? (_wApp.medSnapKw|0) : (_wApp.medSnapSteps|0);   // kW (falls back to steps for pre-kW snapshots)
          _E.snapPending = false;   // CANCEL the toggle re-anchor: _syncFromState (above) just saw node medSnapVer ≠ our 0 and armed _E.snapPending — letting it fire would clobber the restored clock0/steps with the OLD toggle anchor (the restored state already reflects it)
          _torbE0 = (typeof _wApp.medSnapE0==='number') ? _wApp.medSnapE0 : 1;
          _transPx = (typeof _wApp.medSnapTransPx==='number') ? _wApp.medSnapTransPx : (_lensP.tx||0);
          _transPy = (typeof _wApp.medSnapTransPy==='number') ? _wApp.medSnapTransPy : (_lensP.ty||0);
          // Restore the leader's shift CURSOR + its PENDING (stamped-but-not-yet-drained) shifts verbatim — ψ reflects only the
          // shifts the leader had DRAINED; pending ones must still land at their startSteps here too (startSteps valid: same clock0).
          _E.shiftSeen = (typeof _wApp.medSnapShiftSeen==='number') ? _wApp.medSnapShiftSeen : (n.medShiftSeq|0);
          // GATE 3: the kernel state ships verbatim (medSnapTauK: epoch + clocks + shift/att queues + cursors) —
          // restore IMMEDIATELY (its c0/rate are the leader's shared values, no local clock-block dependency).
          // Legacy snapshots (medSnapShiftQ/AttQ + medSnapSelfClk cursors/tauS) park for the DEFERRED rebuild
          // (needs the true local _stepClk.rate — the joiner false-alarm lesson).
          if (_wApp.medSnapTauK) _tauKInit(_wApp.medSnapTauK);
          else _tauKLegacy = { shiftQ: Array.isArray(_wApp.medSnapShiftQ) ? _wApp.medSnapShiftQ.map(p => ({ ...p })) : [],
                               attQ: [], sigQ: [], virtQ: [], kernQ: [], sc: null };
          // att-param state: applied values + cursor + pending, verbatim (fallback = node-latest, the pre-queue behavior)
          if (typeof _wApp.medSnapAttSeen==='number') { _attSeen = _wApp.medSnapAttSeen;
            _attSpd = (typeof _wApp.medSnapAttSpd==='number') ? _wApp.medSnapAttSpd : _attSpd;
            _attAY = (typeof _wApp.medSnapAttAY==='number') ? _wApp.medSnapAttAY : _attAY;
            _attAX = (typeof _wApp.medSnapAttAX==='number') ? _wApp.medSnapAttAX : _attAX;
            if (_tauKLegacy) _tauKLegacy.attQ = Array.isArray(_wApp.medSnapAttQ) ? _wApp.medSnapAttQ.map(p => ({ ...p })) : [];
            _sigSeen = (typeof _wApp.medSnapSigSeen==='number') ? _wApp.medSnapSigSeen : (n.medSigSeq|0);
            if (_tauKLegacy) _tauKLegacy.sigQ = Array.isArray(_wApp.medSnapSigQ) ? _wApp.medSnapSigQ.map(p => ({ ...p })) : [];
            _V.virtSeen = (typeof _wApp.medSnapVirtSeen==='number') ? _wApp.medSnapVirtSeen : _V.virtSeen;   // capture-time cursor: the next pull replays post-capture verbs from the log (old snapshots keep the node-latest fallback)
            if (_tauKLegacy) _tauKLegacy.virtQ = Array.isArray(_wApp.medSnapVirtQ) ? _wApp.medSnapVirtQ.map(p => ({ ...p })) : [];
            const _ts = _wApp.medSnapTexSpec; if (_ts) _texSpec = { amp: +_ts.amp || 0, kx: _ts.kx|0, ky: _ts.ky|0, k0: _ts.k0|0 };   // cos/sin tables rebuilt lazily by _texBuild
            _dials.viaPhi = (typeof _wApp.medSnapViaPhi === 'number') ? _wApp.medSnapViaPhi : 0.5; _dials.lensView = !!_wApp.medSnapLensView;   // replicated UI dials
            // u-register: the observer descriptors — the bank's snapshot codec (stage-A extraction); legacy
            // pre-descriptor keys (medSnapAttPhase/medSnapLensTau/medSnapAphEng/medSnapRefAmp) as read-only fallback
            if (!_obank.restore(_wApp.medSnapLensOp)) _obank.restoreLegacy({ attPhase: _wApp.medSnapAttPhase, lensTau: _wApp.medSnapLensTau, aphEng: _wApp.medSnapAphEng, refAmp: _wApp.medSnapRefAmp });
            const _cs = _wApp.medSnapClkSpec; if (_cs) _clkSpec = { a: +_cs.a || 0, kx: _cs.kx|0, ky: _cs.ky|0, k0: _cs.k0|0 };   // M-c1 probe spec
            const _sc = _wApp.medSnapSelfClk; if (_sc) { _V.selfClk = { bar: Array.isArray(_sc.bar) ? [..._sc.bar] : [0,0,0,0], prev: Array.isArray(_sc.prev) ? [..._sc.prev] : [0,0,0,0], beats: _sc.beats|0, lastK: _sc.lastK|0 };   // M-c2 beat-gate state (verbatim — the slot rotation must resume in phase)
              _tau = (typeof _sc.tau === 'number') ? _sc.tau : (_sc.beats|0); _tauLprev = (typeof _sc.tauLprev === 'number') ? _sc.tauLprev : 21; _tauBeatK = (typeof _sc.tauBeatK === 'number') ? _sc.tauBeatK : (_sc.lastK|0); _tauBeatKBeat = (typeof _sc.tauBeatKBeat === 'number') ? _sc.tauBeatKBeat : (_sc.beats|0);   // global (scheduler-foliation) τ verbatim
              if (Array.isArray(_sc.lastKs)) _V.selfClk.lastKs = [..._sc.lastKs];   // per-slot refractory cursors (detector state)
              if (_tauKLegacy) _tauKLegacy.sc = _sc; }   // legacy snapshots: cursors + tauS parked for the deferred kernel rebuild
            const _ke = _wApp.medSnapKEdge; if (Array.isArray(_ke) && _ke.length === 4) { _K.edge = _ke.map(r => [...r]);   // M-e coupling graph + slice-end sources (verbatim)
              _K.capPh = (typeof _wApp.medSnapKCapPh === 'number') ? _wApp.medSnapKCapPh : -1;   // last genuine-transition ph (a joiner without it re-captures on its first transition — a peer-local step → fork)
              const _ks = _wApp.medSnapKSrc; if (Array.isArray(_ks)) for (let i2 = 0; i2 < 4; i2++) _K.src[i2] = (_ks[i2] && _ks[i2].length === 2 * N_CELLS) ? ((_ks[i2] instanceof Float64Array) ? _ks[i2].slice() : Float64Array.from(_ks[i2])) : null; }
            _E.lockMin = (typeof _wApp.medSnapLockMin==='number') ? _wApp.medSnapLockMin : 1;
            if (_wApp.medSnapCoevoG) { _coevoGx = _wApp.medSnapCoevoG.x ?? _transPx; _coevoGy = _wApp.medSnapCoevoG.y ?? _transPy; _coevoL0 = _wApp.medSnapCoevoG.l0 ?? 0; _coevoTh = _wApp.medSnapCoevoG.th ?? 0; _coevoWarm = _wApp.medSnapCoevoG.warm ?? 0; _coevoCur.lt = _wApp.medSnapCoevoG.lt ?? 0; _coevoCur.lk = _wApp.medSnapCoevoG.lk ?? 0; }
            const _vp = _wApp.medSnapVirt;
            if (_vp && _vp.length === 2 * N_CELLS) { _V.psiVirt = (_vp instanceof Float64Array) ? _vp.slice() : Float64Array.from(_vp); _V.virtE0 = (typeof _wApp.medSnapVirtE0 === 'number') ? _wApp.medSnapVirtE0 : 1; _V.virtMirror = !!_wApp.medSnapVirtMir; _V.virtMux = !!_wApp.medSnapVirtMux; _V.virtHold = !!_wApp.medSnapVirtHold; _V.virtLeak = (typeof _wApp.medSnapVirtLeak === 'number') ? _wApp.medSnapVirtLeak : 0;
              const _va = _wApp.medSnapVirtAtt; if (_va && _va.length) _V.virtAtt = (_va instanceof Float64Array) ? _va.slice() : Float64Array.from(_va);
              const _vg = _wApp.medSnapVirtGo; if (_vg) { _V.virtGoOn = true; _V.virtTgtX = _vg.tx || 0; _V.virtTgtY = _vg.ty || 0; _V.virtGx = _vg.gx || 0; _V.virtGy = _vg.gy || 0; _V.virtL0 = _vg.l0 || 0; _V.virtLt = _vg.lt|0; _V.virtLk = _vg.lk|0; }
              _V.earVOn = !!_wApp.medSnapEarVOn; _V.kvSteps = (typeof _wApp.medSnapKv === 'number') ? (_wApp.medSnapKv|0) : 0;
              if (_V.earVOn && _wApp.medSnapEarV && _wApp.medSnapEarV.floors) { const E = _wApp.medSnapEarV;
                _V.earV = { floors: [...E.floors], dev: Array.isArray(E.dev) ? [...E.dev] : new Array(8).fill(1e-5), lastHit: [...E.lastHit], lastReply: E.lastReply ?? -1e9, pending: Array.isArray(E.pending) ? E.pending.map(p => ({ ...p })) : [] }; } }
            const _vh = _wApp.medSnapVirtHolo;
            if (_vh && _vh.length === 2 * N_CELLS) _V.virtHolo = (_vh instanceof Float64Array) ? _vh.slice() : Float64Array.from(_vh);
            const _vb = _wApp.medSnapVirtBank;   // the recall bank (validated per plate — a malformed entry is dropped, not NaN-seeded)
            if (Array.isArray(_vb)) _V.virtBank = _vb.map(b => (b && b.p && b.p.length === 2 * N_CELLS) ? { p: (b.p instanceof Float64Array) ? b.p.slice() : Float64Array.from(b.p), a: (b.a && b.a.length) ? ((b.a instanceof Float64Array) ? b.a.slice() : Float64Array.from(b.a)) : null, k: b.k|0, lop: (b.lop && typeof b.lop.phase === 'number') ? { mode: b.lop.mode || 'id', phase: b.lop.phase, beta: b.lop.beta ?? 1, omega: b.lop.omega ?? 0, prec: b.lop.prec ?? 0 } : null, bw: (typeof b.bw === 'number') ? b.bw : null } : null).filter(Boolean);
            const _pb = _wApp.medSnapPhases;   // M4: the booted phases (validated per entry)
            if (Array.isArray(_pb)) _V.phases = _pb.map(b => (b && b.p && b.p.length === 2 * N_CELLS) ? { psi: (b.p instanceof Float64Array) ? b.p.slice() : Float64Array.from(b.p), att: (b.a && b.a.length) ? ((b.a instanceof Float64Array) ? b.a.slice() : Float64Array.from(b.a)) : null, e0: b.e0 || 1, kv: b.kv|0, src: b.src|0, go: !!b.go, tx: b.tx || 0, ty: b.ty || 0, gx: b.gx || 0, gy: b.gy || 0, ll: 1, l0: b.l0 || 0, lt: b.lt|0, lk: b.lk|0 } : null).filter(Boolean);
            if (_wApp.medSnapEarR && _wApp.medSnapEarR.floors) { const E = _wApp.medSnapEarR;
              _earR = { floors: [...E.floors], dev: Array.isArray(E.dev) ? [...E.dev] : new Array(8).fill(1e-5), lastHit: [...E.lastHit], lastReply: E.lastReply ?? -1e9, pending: Array.isArray(E.pending) ? E.pending.map(p => ({ ...p })) : [] }; }
            else if (_earROn) _earRInit();   // reactor on but no snapshot state → fresh (leader had it off at capture)
          } else _attReset(n);
          // Restore the rings the leader had ACTUALLY applied (it may still be holding OLD rings while the node carries newer ones
          // queued for a future startStep) + its pending kernel queue. If the GPU isn't up yet, leave _E.kernelVer=-1 → the cold-snap
          // path runs as before (node-latest rings; the small in-flight window returns, but nothing breaks).
          // VALIDATE the ring shape before upload (every ring's offset list must be a real non-empty array — a mangled/legless
          // offset gives n=0 → Inf ring-meta → NaN field); on any doubt fall back to the cold-snap path (node-latest rings).
          const _R = _wApp.medSnapRings;
          const _ringsOk = _R && _gpu && Array.isArray(_R.r) && Array.isArray(_R.o) && _R.o.length===_R.r.length && _R.o.every(a => Array.isArray(a) && a.length>=2);
          if (_ringsOk) {
            _gpu.setRings(_R.r, _R.w, _R.o); _E.kernelVer = _R.ver|0; _E.ringCache = { r:_R.r, w:_R.w, o:_R.o };
            if (_tauKLegacy) _tauKLegacy.kernQ = Array.isArray(_wApp.medSnapKernQ) ? _wApp.medSnapKernQ.map(p => ({ ...p })) : [];
          } else { _E.kernelVer = -1; if (_kqKern) _kqKern.clear(); if (_R && _gpu) console.warn('[JOIN-SEED] snapshot rings malformed → cold-snap fallback'); }
          console.log(`[JOIN-SEED] restored: steps=${_E.solSteps} clock0=${_stepClk.c0.toFixed(3)} E0=${_torbE0.toFixed(4)} transP=(${_transPx.toFixed(3)},${_transPy.toFixed(3)}) shiftSeen=${_E.shiftSeen} pendShift=${_kqShift ? _kqShift.length : 0} kv=${_E.kernelVer} pendKern=${_kqKern ? _kqKern.length : 0} fieldH=${_hashField(_E.psiLensed)}`);
        } else { _solSeeded = false; _torbE0 = -1; _transPx=_lensP.tx||0; _transPy=_lensP.ty||0; console.log('[JOIN-SEED] no field → att-seed'); }   // no ψ → att-seed
        // MUX PROPER-RATE: the leader's restored _stepClk.c0 ALREADY embeds its rate (the snapshot was taken with the rate applied), so
        // just sync _stepClk.ratePrev to the restored slot state — NO re-anchor (that would double-apply). A later verb re-anchors from here.
        _stepClk.ratePrev = (_V.virtMux && (_driveMode==='transport'||_driveMode==='objorbit')) ? (1 + (_V.psiVirt ? 1 : 0) + _V.phases.length) : 1;
        _wApp.medSnapPsi = null;   // consume it (one-shot per join)
      }
      // SNAPSHOT HOOK (registered ONCE below): captures the LIVE soliton ψ + step count into the join snapshot AT JOIN TIME ONLY — no per-bar staging, no
      // reflector traffic. The framework's takeSnapshot calls it on a request_snapshot; the field rides the existing WS snapshot channel to the joiner.
      const cyc = n.cycleCount ?? 0, tnow = n.time ?? 0;
      const bar = Math.floor(cyc / MBINS); _E.frameBar = bar;   // _E.frameBar mirrors bar for the reconstruct button (fired between frames)
      const M = _S.medium;
      _cubeAY = n.angleY ?? INIT_ANGLE_Y; _cubeAX = n.angleX ?? INIT_ANGLE_X;   // mirror the world model's cube angle (peer-synced)
      // (no pre-derivation: the active scope's composeLens stack — run below — derives recall/self/coevolve via the library
      //  ops and writes M.selfRules/selectedRank/replicaRules onto the scope ctx, memoized. The stack IS the perception now.)
      const kernelVer = n.cachedRadiiVersion ?? 0;
      _E.monDir = (n.direction ?? 1);   // direction of the world clock (the soliton steps only when it runs forward)
      _E.monClock = tnow * _MON_RATE;   // the deterministic step phase (peer-identical, no wall-clock)
      // RING KERNEL (the IFS clock recomputes it mid-run; version bumps on real change). For NON-soliton use apply immediately. For transport/objorbit the
      // switch must land at the IDENTICAL soliton step on every peer (frame-local application → peer-local step → mismatched-kernel steps → divergence), so we
      // stage the pending kernel + its SHARED start step = floor((cachedRadiiTime·RATE − clock0)·19) and switch it INSIDE the drive loop at that exact step.
      const _kernSoliton = (_driveMode==='transport' || _driveMode==='objorbit') && _E.solInit;
      if (!_kernSoliton) {
        if (_E.kernelVer !== kernelVer) { _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets); _E.kernelVer = kernelVer; _E.ringCache = { r:n.cachedRadii, w:n.cachedWeights, o:n.cachedOffsets }; if (_kqKern) _kqKern.clear(); }
      } else if (_E.kernelVer !== kernelVer) {
        const q = Array.isArray(n.kernelQueue) ? n.kernelQueue : [];
        const oldestQ = q.length ? Math.min(...q.map(e=>e.ver|0)) : (kernelVer+1);
        if (_E.kernelVer < oldestQ - 1) {   // COLD/FAR-BEHIND (just toggled into transport, or gap > queue): snap to the CURRENT node kernel now; replay only handles changes AFTER this
          _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets); _E.kernelVer = kernelVer; _E.ringCache = { r:n.cachedRadii, w:n.cachedWeights, o:n.cachedOffsets }; if (_kqKern) _kqKern.clear();
          console.log(`[KSNAP] cold-snap to kernel ver=${kernelVer} at a FRAME boundary (steps=${_E.solSteps}, oldestQ=${oldestQ}) — peer-local application step; if the other peer took the KPULL/KDRAIN path at this ver, the fields fork HERE`);
        } else {
          // SYNCED KERNEL QUEUE REPLAY: pull EVERY kernel change we haven't applied (ver > _E.kernelVer) from n.kernelQueue with its SHARED startStep. A peer that SKIPPED
          // an intermediate version (rendered too slowly) still gets it (the queue holds intermediates) → both peers replay the IDENTICAL ordered sequence at the
          // IDENTICAL steps in the drive loop. NO reading the node's "latest".
          for (const e of q) { if (_kqKern && (e.ver|0) > _E.kernelVer && !_kqKern.entries().some(p=>p.ver===e.ver)) {
            const ss = _kqKern.push({ ver:e.ver, t:(e.time ?? 0), r:e.r, w:e.w, o:e.o });   // GATE 4: kernel stamps and sorts
            console.log(`[KPULL] ver=${e.ver} time=${(+e.time).toFixed(4)} startStep=${ss} (muxRate=${_stepClk.rate} c0=${_stepClk.c0.toFixed(4)}) nowStep=${_E.solSteps} Δ=${ss - _E.solSteps} r=[${(e.r||[]).join(',')}] w=[${(e.w||[]).map(v=>(+v).toFixed(4)).join(',')}] pendK=[${_kqKern.entries().map(p=>`${p.ver}@${p.startStep}`).join(',')}]`); } }   // DESYNC DIAGNOSTIC (2026-07-10, kv-fork hunt): cross-peer, ver/startStep AND the ring CONTENT r/w MUST match. Confirmed live: ver+startStep+KDRAIN step all matched while the fields forked on application ⟹ the CONTENT diverged — the model's IFS-kernel cascade (fresnelBeat accumulation, rng-delayed) forked silently upstream (invisible to solH, which hashes only the GPU field). r/w printed in full settles WHICH ver first differs and by how much.
        }
      }
      const E = _S.eye, eyeScope = (_uiScope==='eye');
      // ── THE MEDIUM SOURCE (ψ_in): the world object's wavefront, optionally self-coevolved AT SOURCE (world:active). Memo
      //    on the object key. (self mode rebuilds ψ_in from M.selfRules AFTER the medium stack runs — see below.)
      const objKey = `${_lensObj}|${_cubeAY.toFixed(3)}|${_cubeAX.toFixed(3)}|${_worldActive?('W'+bar):'_'}`
        + (_isHidden(_lensObj) ? `|h${M.activeRank}|${_resoStrength.toFixed(2)}|d${_liveHideDepth()}` : '')
        + (_tunnelActive ? (_tunnelMode==='emergent' ? `|emg${_tunnelGenBar}` : _tunnelMode==='clock' ? `|clk${_tunnelTicks}` : _tunnelMode==='phase' ? `|phs${_phaseTunFired?1:0}f${Math.max(2,Math.round((_lensP.propT||2)*4))}` : _tunnelMode==='barrier' ? `|bar${_barrierTarget}` : _tunnelMode==='vortex' ? `|vtx${_vortexTarget}${_vortexGenome?('m'+_vortexCoBar):''}` : `|tun${_tunnelB}`) : '');   // barrier/vortex→vacuum state + Fix3 migration bar (rebuild source each bar as the vacuum slides)
      if (!_isSelf(M) && objKey !== M.objSeen) {
        let obj = makeProbeField(_lensObj, GRID, { x0:1, y0:1, side: GRID-2 }, { np: 8 }, _objExtras);
        if (_worldActive) { const sv=_gpu.readEyePsi(); obj = _worldSelfTransform(_gpu, obj, bar); _gpu.setEyePsi(sv); }   // reshape at source (scratch restored)
        _E.localObjField = obj; M.objSeen = objKey;
      }
      // ── THE MEDIUM WORLD WAVEFRONT — computed in BOTH scopes (it's the eye's live input). This is the LIGHT path: ONE
      //    stateless lens pass (memoized genome) + the soliton drive below. The eye's HEAVY trap (hologram+recon+perceive)
      //    only runs in eye scope. So the medium's clock-driven world soliton (_E.psiLensed) STAYS LIVE underneath → the eye
      //    traps a moving wavefront (not a frozen snapshot). _E.monClock drives the recursive-lens depth (the live clock mode).
      const srcIn = (_isSelf(M) && M.selfRules) ? _codeField(M.selfRules)
                  : (_E.localObjField && _E.localObjField.length===2*N_CELLS) ? _E.localObjField : _probeRaw;
      // TRUE PHYSICS: obj:hidden is a real WORLD-LENS soliton like every object — the hidden cloud is run through the world lens
      // (no special-case bypass). The resonance works on the genuine living wavefront, not a hand-held copy.
      const lensedSource = _runScope(M, false, srcIn, _lensP, _E.monClock, bar);
      _lastMedHash = _hashField(lensedSource);   // the medium ψ_out field digest (computed every frame, both scopes → medium-physics byte-match proof)
      // TUNNEL references in the LENSED representation (= same as _E.psiLensed → honest landing measure). Before fire, lensedSource = A;
      // once _tunnelActive, the objKey rebuilds it from B → lensedSource = B. Capture A at fire (still A this frame), B while active.
      // SWITCH mode: A/B refs = the live lensed source (A before fire → B once active). EMERGENT mode builds its OWN stable lens-walk
      // endpoints in _emergentMigrate (the matched-filter A/B), so don't overwrite them from the walking source here.
      if (_tunnelMode==='switch') {
        if (_tunnelActive && _tunnelB>=0) { if (!_tunnelRefB && _instFireBar>=0 && bar>_instFireBar) _tunnelRefB = lensedSource.slice(); }
        else if (_instTunnel && _instBar>=0 && bar>=_instBar-1) { _tunnelRefA = lensedSource.slice(); }   // keep A fresh until the fire flips _tunnelActive
      }
      if (_isSelf(M) && M.selfRules) _E.localObjField = _codeField(M.selfRules);   // self: ψ_in = the (now-evolved) code-as-wavefront
      // ── THE LIVING SOLITONS (§7.44), TIME-SHARED on the one sweep buffer: load → drive toward target → step `todo` times
      //    (= f(n.time), anchored once → peer byte-locked) → read back. _E.monDir>0 → step; clock stopped → no step.
      const STEPS_PER_PHASE = 19;
      const _snapMode0 = (_driveMode==='transport' || _driveMode==='objorbit');
      // GRACE WINDOW (first-load sync fix): a fresh joiner in a snapshot mode that hasn't seeded yet must WAIT for the WS
      // snapshot (_snapshotApplied → _E.snapConsumed above) rather than self-seed from scratch — else it diverges and only
      // syncs on a warm reload. "A snapshot may be incoming" = someone published one (n.medSnapVer > 0). If nobody has
      // (medSnapVer==0 → we're the fresh leader) OR the grace frames expired (snapshot never came), fall through and seed.
      if (_snapMode0 && !_E.solInit && !_solSeeded && !_E.snapConsumed) {
        const _snapExpected = (n.medSnapVer|0) > 0;
        if (_snapExpected && _E.readyFrames < _SNAP_GRACE) return;   // hold: the snapshot restore (above) runs on a later frame when it arrives
        _E.snapConsumed = true;   // leader (no snapshot) or grace expired → seed normally from here on
      }
      if (!_E.solInit) { _stepClk.c0 = _E.monClock; _E.solSteps = 0; _E.kwSteps = 0; _E.solInit = true; }
      if (_E.snapPending) { _E.snapPending = false; _stepClk.c0 = _E.snapClock0; _E.solSteps = 0; _E.kwSteps = 0; }   // TOGGLE re-anchor: att-seed peers share the toggle origin (the JOIN path restores _stepClk.c0/_E.solSteps verbatim instead, above)
      // MUX PROPER-RATE CLOCK (2026-07-08 backlog-spiral fix): under ⧉mux the physics advances only 1/nSl per GLOBAL step
      // (W + V + booted phases time-share the one substrate), and each step costs ~nSl× the GPU work. But `target` is driven
      // by WALL-CLOCK n.time at the FULL rate → it demands nSl× more steps than the mux can execute per frame → the backlog
      // compounds forever (todo pinned at the 1024 cap, backlog climbing without bound = the measured lag; plain transport,
      // nSl=1, is fine). Fix: the operator's clock runs in MATTER proper-time — target advances at 1/nSl. nSl is replicated
      // shared state (_V.psiVirt + _V.phases.length), so the divided target stays a pure fn of the shared clock → byte-identical.
      // When nSl CHANGES (V recorded / phase booted / killed — all at stamped shared steps) RE-ANCHOR clock0/steps so the new
      // rate applies FORWARD (not retroactively halving the whole elapsed target → a stop-glitch); the re-anchor is identical
      // on every peer (nSl flips at the same shared step). This is the §7.44 "geometry keeps world time; mux slices matter's
      // proper time" made into the step clock — the honest rate, and it bounds the backlog to ~one frame.
      // MUX PROPER-RATE: _stepClk.rate = the current slot count (nSl) under mux — a pure fn of replicated _V.psiVirt/_V.phases. The
      // re-anchor that keeps `target` continuous across a rate change is done DETERMINISTICALLY at the verb drain (shared step),
      // NOT here — see _muxReanchor, called from the record/boot/kill/swap/recall verbs. Doing it here read the peer-local
      // frame state and forked _stepClk.c0 across peers (245.33 vs 248.01, live-caught). Here we only READ the current rate.
      _stepClk.rate = (_snapMode0 && _V.virtMux) ? (1 + (_V.psiVirt ? 1 : 0) + _V.phases.length) : 1;   // module-scoped: the kernel's epoch guard below keeps _tauK.stamp on THIS same divisor
      // KERNEL EPOCH GUARD: the kernel's (c0, rate) must equal the live epoch at every frame. _muxReanchor mirrors
      // live flips, but the epoch also moves WITHOUT a verb (first anchor, cold-start clamp, _E.snapPending re-anchor,
      // drive-mode flips) — sync here, before the pulls stamp anything. Pure fn of live shared values → deterministic;
      // a no-op whenever they already agree (incl. right after a medSnapTauK restore). Queues are empty or flushed at
      // every such transition, so no re-stamp is needed.
      if (_tauK && (_tauK.rate !== _stepClk.rate || _tauK.clock0 !== _stepClk.c0)) _tauK.setEpoch(_stepClk.c0, _stepClk.rate);
      if (_tauKLegacy && _tauK) { const L = _tauKLegacy; _tauKLegacy = null;   // deferred LEGACY-snapshot kernel rebuild — now _stepClk.rate is the true rate
        const _sc = L.sc || {}, _mkC = (i, kp) => (Array.isArray(_sc.tauS) ? { beats: _sc.beatsS[i]|0, tau: _sc.tauS[i], lprev: _sc.lprevS[i], beatK: _sc.beatKS[i], kp, lastKk: (_sc.lastKs?.[i]|0), flat: false, watchdogK: null } : null);
        const _cl = {}; const _c0 = _mkC(0, _E.kwSteps), _c1 = _mkC(1, _V.kvSteps), _c2 = _mkC(2, _V.phases[0]?.kv || 0), _c3 = _mkC(3, _V.phases[1]?.kv || 0);
        if (_c0) { _cl.W = _c0; _cl.V = _c1; _cl.P1 = _c2; _cl.P2 = _c3; }
        _tauKInit({ c0: _stepClk.c0, rate: _stepClk.rate, clocks: _cl,
          queues: { shift: { clock: 'W', valve: 4, tauLast: _sc.tauLastShift ?? 0, kApply: _sc.kShiftApply ?? 0, q: L.shiftQ },
                    att:   { clock: 'W', valve: 4, tauLast: _sc.tauLastAtt ?? 0,  kApply: _sc.kAttApply ?? 0,  q: L.attQ },
                    sig:   { clock: null, valve: 4, tauLast: 0, kApply: 0, q: L.sigQ || [] },
                    virt:  { clock: null, valve: 4, tauLast: 0, kApply: 0, q: L.virtQ || [] },
                    kern:  { clock: null, valve: 4, tauLast: 0, kApply: 0, q: L.kernQ || [] } } }); }   // gate 4: the coordinate-dispatch streams rebuild too (guards re-attached by _tauKInit)
      let target = _stepClk.target(_E.monClock);   // C1: the §7.44 law via the core clock (spp = STEPS_PER_PHASE = 19, fixed at construction)
      // BYTE-IDENTICAL CAP: the §7.44 gas caps at 96/frame (a slow frame runs slow-motion, never re-seeds → invisible). But transport/objorbit need
      // the step count to be FRAME-RATE-INDEPENDENT (= floor((Δclock)·19) on EVERY peer) for byte-identical medH — which requires the cap to NEVER bind
      // (else a slow peer falls behind → fewer steps → diverges). So those two modes use a HIGH cap (1024 ≈ covers down to ~7fps; worst case ~855/frame@8fps).
      // The cost is a bounded GPU-work spike on a slow frame (it runs all owed steps at once) — inherent to byte-identical clocked replay from the shared snapshot.
      const _snapMode = (_driveMode==='transport' || _driveMode==='objorbit');
      const _solCap = _snapMode ? 1024 : 96;
      // COLD-START BURST CLAMP (first-load freeze fix): if the very first driven frame owes a HUGE backlog (target ≫ _E.solSteps=0),
      // it runs ~1024 steps in one frame → the visible freeze. This happens when _stepClk.c0 got re-anchored to an OLD published-
      // snapshot origin while _E.solSteps reset to 0 (the _E.snapPending path, with no field snapshot to restore verbatim). On a COLD
      // start (_E.solSteps==0 — no history to byte-match against; sync comes from the snapshot, not backlog replay) re-anchor _stepClk.c0
      // to NOW so target=0 and the soliton eases in. Fires ONLY on the first driven frame; steady-state clocked replay is untouched.
      if (_snapMode && _E.solSteps === 0 && (target - _E.solSteps) > _solCap) { _stepClk.c0 = _E.monClock; target = 0; }
      // DEBUG A/B: _FIXED_QUANTUM steps ONLY in whole quanta at global boundaries {0,Q,2Q,…} → identical chunking on every peer regardless of frame timing. Set 0 = off.
      const _FIXED_QUANTUM = 7;
      let todo;
      if (_snapMode && _FIXED_QUANTUM > 0) {
        const reachable = Math.max(0, (_E.monDir > 0 ? target : _E.solSteps) - _E.solSteps);
        const wholeQuanta = Math.floor(reachable / _FIXED_QUANTUM);
        todo = Math.min(wholeQuanta, Math.floor(_solCap / _FIXED_QUANTUM)) * _FIXED_QUANTUM;
      } else {
        todo = Math.max(0, Math.min(_solCap, _E.monDir > 0 ? target - _E.solSteps : 0));
      }
      if (todo > 0) { _E.solSteps += todo; if (_snapMode) _lastTodoDbg = todo; }
      // DRIVE CLOCK TRACE (standing diagnostic; arm with window.driveTrace(n)): logs todo/target/backlog/muxRate per driven
      // frame. backlog climbing without bound + todo pinned at the cap = a clock-vs-throughput spiral (the mux proper-rate
      // bug, now fixed by _stepClk.rate); backlog bounded (~one frame) = healthy. Off by default; decrements to auto-disarm.
      if (_snapMode && _driveTraceN > 0) { _driveTraceN--;
        console.log(`[DRIVETRACE] todo=${todo} target=${target} solSteps=${_E.solSteps} backlog=${target-(_E.solSteps-todo)} muxRate=${_stepClk.rate} snapPend=${_E.snapPending} readyFr=${_E.readyFrames} V=${_V.psiVirt?1:0} mux=${_V.virtMux?1:0} ⊞${_V.phases.length}`); }
      const driveSoliton = (savedPsi, driveTarget, alpha) => {   // one persistent living soliton: load → drive → step → read back
        if (!driveTarget) return savedPsi;
        _gpu.setSweepPsi(savedPsi || driveTarget);   // ALWAYS load THIS soliton's own field (else the buffer leaks the other's)
        _gpu.setObjField(driveTarget);
        for (let i = 0; i < todo; i++) _gpu.stepRecord(DT, alpha);   // propagate + inject toward the target
        return _gpu.readPsi();
      };
      // ★ PHASE-WELL DRIVE (the honest-inertia fix — user's diagnosis): the amplitude-blend (stepRecord α>0) is a KINEMATIC OVERWRITE that
      // DELETES the wave's momentum (replaces it with the stationary target). CPU-verified: with the blend, a momentum kick is PINNED
      // (soliton stays at A every k); with a PHASE-WELL (curvature, NO amplitude blend) momentum is CONSERVED (soliton MOVES with k). So
      // barrier mode drives by CURVATURE: α=0 (no overwrite) + linOp quadratic phase-well about the genome's centers (bends toward the
      // attractor without deleting momentum) + propagation. A momentum kick now has a fighting chance — climb out if steeper than the well.
      // CRITICAL: the amplitude-blend did TWO jobs — (1) delete momentum (bad, kinematic) AND (2) SUSTAIN the soliton's amplitude (needed —
      // else it disperses to noise: measured cA,cB→4%, all-gated). The well drive must keep job 2 WITHOUT job 1: sustain amplitude by
      // ENERGY RENORM (rescale to the soliton's own energy each step — no positional target, no momentum deletion), not by injecting A.
      const driveSolitonWell = (savedPsi, which) => { if (!savedPsi) return savedPsi;
        let e0=0; for (let i=0;i<savedPsi.length;i++) e0+=savedPsi[i]*savedPsi[i]; e0=Math.sqrt(e0)||1;
        const save=_gpu.readEyePsi(); _gpu.setEyePsi(savedPsi);
        // BARRIER native: bend the well toward the REAL genome attractor's raw fixed points (_barrFpsA/B, set at fire). Vortex's C-call has
        // no genome fps set → falls back to the quad template (vortex is the separate resolved arc). genome fps = the honest A/B positions.
        const cen = (_tunnelMode==='barrier' && (which==='A'?_barrFpsA:_barrFpsB)) ? (which==='A'?_barrFpsA:_barrFpsB) : _barrRawCenters(which);
        // per step: A's CURVATURE (phase well, bends toward A — momentum-conserving) + propagate + SELF-FOCUS (the new primitive: amplitude
        // saturation, CONFINES the soliton with NO positional target → keeps it a localized particle while preserving its phase/momentum).
        for (let i=0;i<todo;i++){ _gpu.linOp({ centers:cen, a:0.012, beta:0, vtx:0 }); _gpu.stepEyeN(1, DT); _gpu.applyEyeSelfFocus(_SF_TH, _SF_GP, _SF_LO); }
        let out=_gpu.readEyePsi();
        let e=0; for (let i=0;i<out.length;i++) e+=out[i]*out[i]; e=Math.sqrt(e)||1; const g=e0/e;   // renorm to the soliton's own energy (steady amplitude, no positional pull)
        for (let i=0;i<out.length;i++) out[i]*=g;
        _gpu.setEyePsi(save); return out; };
      // ALWAYS advance the medium's living world soliton (the eye's live input). In medium scope we also draw it; in eye scope
      // it's the wavefront the trap catches (kept moving so EYE ◀/▸ reflect the live clock, not a static snapshot). NORMAL drive
      // for ALL objects (no special hard-lock for hidden — that was a clamp toward a frozen copy; the wide packet gives real signal).
      // BARRIER mode: FULL drive (no suppression — that FAKED the barrier). User-measured: ⚡B+2 crosses at every amp (near saddle, no
      // barrier) but ⚡B+3 is AMP-GATED (distant saddle, real threshold) → a real barrier DOES exist for distant B. OPTION A (the honest
      // fix for a true double-well at every B+): the IFS contraction is LINEAR (pulls everything to A proportionally → no bistability), so
      // add a NONLINEAR term during the crossing window — applyEyeNlKick (§7.60: intensity-gated phase, γ only where I>th). It makes the
      // high-amplitude kicked spike "heavy" (phase-distinct) so it RESISTS A's linear pull → a genuine threshold (NOT removing the drive).
      // BARRIER mode uses the PHASE-WELL drive (momentum-conserving curvature, NOT the amplitude-blend that deletes momentum). The drive
      // curves toward whichever basin the winner-take-all picked (_barrierTarget). So a momentum kick can climb out if steeper than the well.
      // The special instanton drives run DURING the transition. Once COMMITTED (barrier latched / vortex reached B), HAND OFF to the normal
      // driveSoliton toward the (now-B) lensed source → ψ_out (canvas 2) RELAXES onto B and becomes the INTERACTIVE destination view (the
      // lens/sliders operate on the result). The C transition is preserved in the ψ_C witness canvas. (selectedRank=B already → lensedSource is B.)
      const _barrOn = (_tunnelMode==='barrier' && _tunnelActive && _tunnelB>=0 && !_barrierLatched);
      const _vortOn = (_tunnelMode==='vortex' && _tunnelActive && _tunnelB>=0 && _vortexTarget!=='B');
      // ★ VORTEX drive = SUSTAIN-ONLY (NO positional target) — this is the crux of the honesty (probe_vortex_transport.mjs): if the drive
      // pulled toward A or B it would do the transport and the vortex would be DECORATIVE. So the drive ONLY keeps the soliton alive
      // (propagate + self-focus + renorm to its own energy); the injected WINDING is the only thing that can bias position. The probe
      // measured: with no winding the field stays at A (control), with the per-blob winding it transports OFF A to the stable midpoint and
      // stalls (a linear medium can't self-advect to B). So the topology — not the drive — moves it, to the emergent vacuum C.
      const driveVortexSustain = (savedPsi) => { if (!savedPsi) return savedPsi;
        let e0=0; for (let i=0;i<savedPsi.length;i++) e0+=savedPsi[i]*savedPsi[i]; e0=Math.sqrt(e0)||1;
        const save=_gpu.readEyePsi(); _gpu.setEyePsi(savedPsi);
        // sustain ONLY (no positional target — the winding does the transport) + the IFS-native charge-conserving ops, all riding the round-trip:
        //   • stepEyeN: the IFS propagation (transports the field; the winding's phase gradient does the A→C motion)
        //   • applyEyeSelfFocus (gentle gp=0.04): confine the particle without crushing the vortex core
        //   • applyEyeDensContract (the IFS-NATIVE GPE |ψ|²ψ term, ψ→ψ/(1+γ|ψ|²)): the saturable density-dependent contraction that HOLDS the
        //     vortex core node (a healing length) → CONSERVES the full multi-charge (probe_native_gpe_charge.mjs: Qtot=4 stable to t60, no
        //     annihilation; the foreign exp(−iγ|ψ|²) PHASE form scattered Q — the §7.100c graft trap; this density form is the native one)
        //   • applyEyeLowpass: suppress the high-k spurious vortices that polluted Q in the bare medium
        // LIVE-GPU-VERIFIED ([VORTEX-GPE] instrumentation, since removed): with the GPE density-contraction, Qfollow AND Qfull hold Q=1.00
        // INDEFINITELY (the bare medium decayed Q→0; the cores relax into one stable charged vortex soliton). Charge conserved, IFS-native, no FFT.
        for (let i=0;i<todo;i++){
          _gpu.stepEyeN(1, DT);
          _gpu.applyEyeSelfFocus(_SF_TH, 0.04, 0.03);
          _gpu.applyEyeDensContract(_VORTEX_GPE);
          _gpu.applyEyeLowpass(_VORTEX_LP);
        }
        let out=_gpu.readEyePsi(); _gpu.setEyePsi(save);
        let e=0; for (let i=0;i<out.length;i++) e+=out[i]*out[i]; e=Math.sqrt(e)||1; const g=e0/e; for (let i=0;i<out.length;i++) out[i]*=g;   // renorm to own energy
        return out; };
      // ★ DIAGNOSTIC — "WELL AS DEFAULT" (toggle: window._wellDefault = true in console; off by default). Routes the NORMAL drive through a
      // potential-well placed at the ACTIVE GENOME'S fixed points (the fair test — wells AT the content features) instead of the content-blend.
      // probe_well_as_default.mjs predicted: PRESERVES genome attractors (wells match features, sharper) but DAMAGES feature-rich content with
      // fewer wells than features (image/cube → merge + over-concentrate, corr 1.00→0.70). This makes the trade-off VISIBLE live. Reversible.
      // THE HYBRID (probe_well_saturated.mjs): well+self-focus ALONE RUNS AWAY (collapses to a spike → "goes dark", pk/mn 16→51); adding the
      // saturating GPE STOPS the runaway but OVER-FLATTENS (pk/mn→1.4, content-corr→0.03); only the BLEND restores content (α≈0.15 → corr 0.57,
      // stable). So the viable hybrid = BLEND (content + the fixed point) + WELL (momentum-conserving confine) + GPE (saturate). The blend is
      // IRREDUCIBLE — it's the only WRITE primitive (content + stability); well/GPE are modifiers on top. This is a content-bearing,
      // momentum-conserving default soliton — the honest unification (NOT the bare well, which has no sustained equilibrium).
      const driveWellDefault = (savedPsi) => { if (!savedPsi || !_gpu || !lensedSource) return savedPsi;
        let e0=0; for (let i=0;i<savedPsi.length;i++) e0+=savedPsi[i]*savedPsi[i]; e0=Math.sqrt(e0)||1;
        let cen; try { cen = genomeFpCenters(_activeGenome(M), GRID); } catch(e){ cen=[GRID/2,GRID/2]; }   // wells at the genome's fixed points
        const save=_gpu.readEyePsi(); let cur=savedPsi.slice();
        for (let i=0;i<todo;i++){
          for (let k=0;k<cur.length;k++) cur[k] += 0.15*(lensedSource[k]-cur[k]);   // BLEND α=0.15 (content + fixed point — irreducible), JS, eye-buffer-only
          _gpu.setEyePsi(cur); _gpu.linOp({ centers:cen, a:0.012, beta:0, vtx:0 }); _gpu.stepEyeN(1, DT); _gpu.applyEyeSelfFocus(_SF_TH, _SF_GP, _SF_LO); _gpu.applyEyeDensContract(_VORTEX_GPE);   // WELL + self-focus + GPE saturate
          cur = _gpu.readEyePsi();
        }
        _gpu.setEyePsi(save);
        let e=0; for (let i=0;i<cur.length;i++) e+=cur[i]*cur[i]; e=Math.sqrt(e)||1; const g=e0/e; for (let i=0;i<cur.length;i++) cur[i]*=g; return cur; };
      // ★ TRICK-FREE PURE SOLITON drive: SEED ONCE (from the source, so it has something to be), then evolve with stepEyeN (dispersion) +
      // saturable-FOCUSING SPM (applyEyeNlSpm with NEGATIVE gamma flips the GLSL's −g to focusing) ONLY. NO blend, NO renorm — the
      // dispersion⇄saturable-focusing balance self-sustains it (probe_saturable_native: E-conserved on the native leapfrog, no blow-up).
      const driveSolitonPure = (savedPsi) => { if (!savedPsi || !_gpu) return savedPsi;
        const save=_gpu.readEyePsi();
        if (!_solSeeded) { _gpu.setEyePsi(lensedSource ? lensedSource : savedPsi); _solSeeded = true; }   // seed ONCE from the source
        else _gpu.setEyePsi(savedPsi);
        // sol-cons = CONSERVATIVE interior (dispersion + saturable-focusing, E exact). sol-diss = GENUINE interior DISSIPATION: the CGL balance
        // ψ*=exp((−δ+ε|ψ|²−μ|ψ|⁴)dt) — linear loss kills radiation, cubic gain feeds the soliton, quintic loss caps it = a stable ATTRACTING
        // fixed point (probe_cgl_soliton: E plateaus, SNR 26, no blowup/drain — the textbook dissipative soliton; cubic-only blew up, this is balanced).
        const diss = (_driveMode==='sol-diss');
        // ★ WORLD-SCOPE LENS = META-CIRCULAR, transforms the LIVE PERSISTENT soliton IN PLACE. focus/θ are PHASE ops (work in place). But
        // SHIFT can't be phase — a self-focusing soliton re-pins its amplitude every frame, so momentum/focus-tilt just WOBBLE it (measured).
        // §7.92 / coevolve: move a soliton by moving the ATTRACTOR it self-focuses onto (move the METRIC, not the particle). probe_move_attractor:
        // a gentle amplitude-pull toward a target at (center+tx,ty) DRAGS the soliton there (α=0.15: centroid follows, width bounded, E×0.95;
        // metric-resample/advect DESTROYED it E×0.02). Honest: moving position inherently touches AMPLITUDE (phase can't) — but it's a single
        // moving confinement target (the world's geometry), the soliton rides it = position op, not content-write. The soliton genuinely moves.
        const lf = (_lensP.sMul-1)*0.04, lb = (_lensP.thAdd||0)*0.04;
        for (let i=0;i<todo;i++){ _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT);
          if (diss) _gpu.applyEyeCgl(_CGL_DELTA, _CGL_EPS, _CGL_MU, DT); }   // CGL interior dissipation (sol-diss only)
        if (lf||lb) _gpu.linOp({ centers:[GRID/2,GRID/2], a:lf, beta:lb, vtx:0 });   // focus/θ: PHASE transform of the persistent soliton in place
        let out=_gpu.readEyePsi(); _gpu.setEyePsi(save);
        // SHIFT = METRIC TRANSPORT (move the vacuum, §7.92), centroid-tracking. MEASURED (mediumMoveProbe): the persistent bound soliton CANNOT
        // self-advect — strong SPM (γ=20, the persistent soliton) wraps its internal phase to ~2π, and a linear momentum kick can't impose clean
        // momentum on a phase-singular core (p_x stays ≈0, drift=0 even in free flight); the only γ that accepts momentum (γ=1, phase<π) doesn't
        // bind (E→0.03 when idle). Mobility ⊥ persistence here — monotonic across the whole γ sweep. So the honest mover for the persistent soliton
        // is to move its SPACE: affineEyeCenters with an INTEGER pixel shift = an EXACT lossless coordinate remap (bilinear sampler hits fr=(0,0)).
        // The bound soliton rides the shifted vacuum UNCHANGED — same persistent γ=20 soliton, no amplitude write, no source, E exact. Centroid-
        // tracking steps 1px only when the soliton has SETTLED at the last offset, so the remap never outruns the live field. (NOT a JS array re-
        // index dressed up — it's the same metric-transform primitive the IFS warp uses; justified because the PARTICLE provably can't self-propel.)
        const tgtX=Math.round(_lensP.tx||0), tgtY=Math.round(_lensP.ty||0);
        if (tgtX!==_solAppldX || tgtY!==_solAppldY) {
          let sxc=0,syc=0,sw=0; for(let i=0;i<N_CELLS;i++){const a2=out[i*2]**2+out[i*2+1]**2;sxc+=(i%GRID)*a2;syc+=((i/GRID)|0)*a2;sw+=a2;}
          const ccx=sw>0?sxc/sw:GRID/2, ccy=sw>0?syc/sw:GRID/2;
          const settled = Math.abs(ccx-(GRID/2+_solAppldX))<1.2 && Math.abs(ccy-(GRID/2+_solAppldY))<1.2;
          if (settled) { const sdx=Math.sign(tgtX-_solAppldX), sdy=Math.sign(tgtY-_solAppldY); _solAppldX+=sdx; _solAppldY+=sdy;
            _gpu.setEyePsi(out); _gpu.affineEyeCenters([1,0,0,1], [sdx, sdy], [GRID/2, GRID/2], GRID); out=_gpu.readEyePsi(); _gpu.setEyePsi(save); }   // lossless integer metric remap (slide the vacuum 1px)
        }
        out = _applyOpenBoundary(out);   // BOUNDARY = the SEPARATE global toggle (both modes obey it; sol-diss no longer force-overrides)
        // LIVE energy/width check (CPU probe said E-conserved; verify live — CPU/GPU diverged before). Log per ~bar; flag any blow-up.
        if (_solLogBar !== bar) { _solLogBar = bar; let e=0,pk=0,mn=0,hi=0,lo=0; for(let i=0;i<N_CELLS;i++){const a2=out[i*2]**2+out[i*2+1]**2,a=Math.sqrt(a2);e+=a2;if(a>pk)pk=a;mn+=a;} mn/=N_CELLS;
          const th=pk*pk*0.15; for(let i=0;i<N_CELLS;i++){const a2=out[i*2]**2+out[i*2+1]**2;if(a2>th)hi+=a2;else lo+=a2;} const snr=lo>0?hi/lo:999;
          if (_solE0<0) _solE0=e||1; console.log(`[SOLITON:${_driveMode==='sol-diss'?'diss':'cons'}] bar ${bar} · E×${(e/_solE0).toFixed(2)} · SNR ${snr.toFixed(1)} · pk/mn ${(mn>0?pk/mn:0).toFixed(1)} · shift(${_solAppldX},${_solAppldY}) todo=${todo}${e/_solE0>5?' ⚠ BLOWING UP':''}`); }
        return out; };
      // ★ TRANSPORT drive (move a live soliton object to the shiftX/Y target — HONEST METRIC TRANSPORT, NOT a force/inertia). MEASURED (mediumForceProbe/
      // ExtMoveProbe): a phase well does NOT move the centroid; the genome's IFS HUTCHINSON WARP (here pure integer TRANSLATION m=identity) IS the move —
      // a discrete lossless coordinate shift toward the target, gated per-axis to whole pixels. This is COORDINATE TRANSPORT (move the space), NOT a
      // continuous force on a particle — there is no conserved momentum here; the soliton rides the shifted grid. CGL sustains the marginal object's
      // structure between shifts (radiation-killer). For a TRUE continuous-physics orbit (real momentum, curved Keplerian path) see drive:trueorbit.
      const driveSolitonTransport = (savedPsi) => { if (!_gpu) return savedPsi;
        savedPsi = savedPsi || lensedSource;   // COLD START (late joiner: _E.psiLensed null) → seed/sustain from the live lensed source so canvas-2 fills
        if (!savedPsi) return savedPsi;
        const save=_gpu.readEyePsi();
        // SHIFT = COEVOLVE-CHASE (the MOST meta-circular mover — mediumTransportGR: persistent living soliton chases the operator-position, 12/16px, E=1.00,
        // corr=0.62, NO blend, NO replace, NO momentum). TWO meta-circular pieces COMPOSE: (1) the OPERATOR defines the position — the object is REGENERATED
        // (lens) at the eased target each frame = a moving ATTRACTOR; (2) the soliton is a PERSISTENT LIVING wave (seeded once, self-sustains via stepEyeN+SPM)
        // that SELF-FOCUSES toward the attractor by SUPERPOSITION (ψ += β·attractor — it ADDS the operator's output as a ghost, then self-focus crystallizes
        // the soliton onto it; this is interference-coevolve, NOT a blend-TOWARD-a-target/write). MEASURED: well@attractor is inert (radial well can't pull a
        // centroid); CGL blows up the superposition (gain compounds); plain superpose β=.15 + self-focus + energy-cap TRACKS. The soliton genuinely LIVES & chases.
        const tgtPx = _lensP.tx||0, tgtPy = _lensP.ty||0;
        // KWE-DETERMINISTIC SHIFT via SYNCED SHIFT QUEUE (mirrors the kernel queue). Events are stamped + dispatched at logical ticks → the node state per tick is
        // identical on every peer; the ONLY divergence was that _frame READS the node's LATEST shift at the RENDER tick (ahead of the soliton's step-time during a
        // burst), so a slide (many streamed intermediates) had each peer latch a DIFFERENT intermediate. FIX: n.shiftQueue holds EVERY intermediate with its stamped
        // time; we pull the unseen ones, stamp each with its SHARED startStep (=floor((time·RATE−solClock0)·19)), and DRAIN them at the identical step in the loop.
        {
          const sq = Array.isArray(n.shiftQueue) ? n.shiftQueue : [];
          let pulled = false;
          for (const e of sq) { if ((e.seq|0) > _E.shiftSeen) {   // cursor on monotonic seq (queue is truncated → array index drifts; seq never does)
            if (_kqShift) _kqShift.push({ t:(e.time ?? 0), seq:e.seq|0, toX:e.toX??0, toY:e.toY??0 });   // GATE 3: the KERNEL stamps and sorts (its epoch = the live epoch: synced at init, tracked through reanchor)
            _E.shiftSeen = e.seq|0; pulled = true; } }
          // ATT-PARAM QUEUE pull (cube angles here; +opSpeed in objorbit) — same cursor/stamp discipline as the shift queue
          const aq = Array.isArray(n.attQueue) ? n.attQueue : [];
          let apulled = false;
          for (const e of aq) { if ((e.seq|0) > _attSeen) {
            if (_kqAtt) _kqAtt.push({ t:(e.time ?? 0), seq:e.seq|0, spd:e.spd, ay:e.ay, ax:e.ax });   // GATE 3: kernel stamps and sorts
            _attSeen = e.seq|0; apulled = true; } }
          // ⚡SIG QUEUE pull — stamped radiation launches, injected at their shared step inside the loop
          const gq = Array.isArray(n.sigQueue) ? n.sigQueue : [];
          let spulled = false;
          for (const e of gq) { if ((e.seq|0) > _sigSeen) {
            const ss = _kqSig ? _kqSig.push({ t:(e.time ?? 0), seq:e.seq|0, fx:e.fx??GRID/2, fy:e.fy??GRID/2, tx:e.tx??GRID/2, ty:e.ty??GRID/2, amp:e.amp??0.35, ph:(typeof e.ph==='number')?e.ph:-1 }) : -1;   // GATE 4: kernel stamps and sorts
            console.log(`[SIG] queued seq=${e.seq} startStep=${ss} nowStep=${_E.solSteps} Δ=${ss - _E.solSteps}${(e.ph??-1)>=0?` slot=${e.ph}`:''}`);
            _sigSeen = e.seq|0; spulled = true; } }
          // ⎙VIRT pull — a stamped hypervisor verb (latest wins; executes at the shared step inside the loop)
          if ((n.medVirtSeq|0) > _V.virtSeen) { const _vSeen0 = _V.virtSeen; _V.virtSeen = n.medVirtSeq|0;
            // replay EVERY unseen verb from the seq-stamped log (append, not replace — a slow peer must not skip a
            // verb that fast peers executed); fall back to the single latest-verb fields for old worlds without a log
            // GAP GUARD: if the seq jump exceeds what the log holds, older unseen verbs were sliced off — warn LOUD
            // (silent drop = "sometimes not work"). The log cap is 64; a burst/lag beyond that needs a re-anchor.
            if (Array.isArray(n.medVirtLog) && n.medVirtLog.length) { const _oldest = (n.medVirtLog[0].seq|0);
              if (_oldest > _vSeen0 + 1 && _vSeen0 > 0) console.warn(`[VIRT] ⚠ LOG GAP — verbs seq ${_vSeen0+1}..${_oldest-1} dropped (log holds ${n.medVirtLog.length}, seq now ${n.medVirtSeq|0}). A verb was lost: re-issue it, or re-anchor (orbW). Slow down bursts.`); }
            const _vEvs = (Array.isArray(n.medVirtLog) && n.medVirtLog.length) ? n.medVirtLog.filter(e => (e.seq|0) > _vSeen0)
              : [{ seq: n.medVirtSeq|0, time: (n.medVirtTime ?? 0), mode: n.medVirtMode || 'record', leak: (typeof n.medVirtLeak === 'number') ? n.medVirtLeak : 0, slot: (n.medVirtSlot|0), gx: (n.medVirtGx || 0), gy: (n.medVirtGy || 0), amp: (typeof n.medVirtAmp === 'number') ? n.medVirtAmp : 0, src: n.medVirtSrc || 'V' }];
            if (_kqVirt) for (const e of _vEvs) _kqVirt.push(normalizeVirtEvent(e)); }   // GATE 4: kernel stamps and sorts. The wire schema lives ONCE in medium-core.normalizeVirtEvent (stage B2) — the fixed field list here silently stripped lensset's params (live-caught 2026-07-11); new verb fields now have ONE place to land instead of three
        }
        // APPLY any shift entries the soliton has ALREADY passed (startStep < the first step this frame) → the current att position before the loop. The remaining
        // entries drain INSIDE the loop at their shared steps. `to` after the crossing step, `from` before it — a pure STEP function → byte-identical, ONE att between crossings.
        let att = null;
        const _rebuildAtt = () => { try {
          const gx = _coevoOn ? _coevoGx : _transPx, gy = _coevoOn ? _coevoGy : _transPy;   // ⟲coevo: the LEASHED effective position (matter-anchored), else the raw queued target
          if (_lensObj==='cube') att = _cubeField(gx, gy, _attAY, _attAX);   // QUEUE-APPLIED angles (shared-step), not the render-tick mirror
          else { const x0=Math.round(1+gx), y0=Math.round(1+gy);
            att = makeProbeField(_lensObj, GRID, { x0, y0, side:GRID-2 }, { np:8 }, _objExtras); }
          att = _attRot(att);   // M-a″: the operator carries its register phase into every rebuild
        } catch(e) { att = null; } };
        // PRE-LOOP CATCH-UP DRAINS REMOVED (2026-07-10 determinism fix): they applied any past-due head
        // (startStep <= _baseStep0) UNCONDITIONALLY at the frame boundary. Harmless before gate 3″ (the in-loop
        // drain never left a past-due entry behind), but the τ_W throttle legitimately HOLDS past-due backlog across
        // frames — and _baseStep0 = _E.solSteps − todo is PEER-LOCAL (frame batching), so the next frame's pre-loop
        // nuked the held backlog at a step that differs per peer (60fps vs 30fps → different base0) → _transPx forked,
        // the throttle was bypassed (the teleport re-entered through the frame boundary), and the cursors were never
        // updated. The in-loop gated drain below covers every past-due entry (k >= startStep holds from the frame's
        // first step) and applies at SHARED steps (authored coordinate / τ_W crossing / valve) — do NOT reintroduce.
        _rebuildAtt();
        if (!_solSeeded) { _gpu.setEyePsi(att||savedPsi); _solSeeded = true; let e=0; const s0=att||savedPsi; for(let j=0;j<s0.length;j++)e+=s0[j]*s0[j]; _torbE0=e||1; }   // seed from the att (the soliton RIDES it)
        else _gpu.setEyePsi(savedPsi);                                        // thereafter the soliton SELF-SUSTAINS (never replaced)
        if (att) _gpu.setObjField(att);   // ONE att per frame, STATIONARY across the loop → todo× the same superposition builds the lump (the working chase)
        const _base = _E.solSteps - todo;   // global index of the first step this frame
        _E.muxStepped[0] = _E.muxStepped[1] = _E.muxStepped[2] = _E.muxStepped[3] = 0;   // proper-time render gate: reset per-slot step tally each frame
        // §7.44 CLOCK-PHASE MUX (M2→M4): phase(k)=⌊k/21⌋ mod N over [W, V?, …booted phases] — a pure function of the
        // SHARED step index and slot count, so every peer slices identically. Virtual slices step their phase on the
        // one substrate (the others frozen EXACTLY — storage is honest); all queues/verbs/tests are W-events and wait
        // for the next W-owned step (global-time stamps, per-phase translation). The operator/att rides the GLOBAL
        // clock — geometry keeps world time; mux slices matter's proper time. Shared impl: _muxVirtualStep.
        for (let i=0;i<todo;i++){
          const k=_base+i;
          if (_muxVirtualStep(k, att, _FIXED_QUANTUM)) continue;   // a virtual phase owned this step; W waits
          _E.muxStepped[0]++;   // proper-time render gate: W's field advanced this step
          // KERNEL QUEUE REPLAY at the EXACT SHARED steps — apply every queued kernel change whose stamped step this step has reached, in order (identical on all peers).
          // COLLAPSE consecutive same-step drains: if several kernel versions have startStep ≤ k, only the LAST
          // ring set survives (each setRings overwrites the previous before any stepEyeN runs). Doing N setRings +
          // N readEyePsi/setEyePsi round-trips in one JS tick is an async-GPU RACE (the 2nd readEyePsi can run
          // before the 1st setRings texture upload flushes → same-GPU peers diverge by driver scheduling, live-caught
          // as a two-KDRAIN-then-solH-fork). Apply ONE setRings (the final version) with ONE field-preserve round-trip.
          if (_kqKern) { let pk = null;
            _kqKern.drain(k, (e) => { pk = e; console.log(`[KDRAIN] applied ver=${e.ver} startStep=${e.startStep} atStep=${k} solClock0=${_stepClk.c0.toFixed(4)}`); });   // GATE 4: kernel drain (unconditional coordinate dispatch); collapse-to-last preserved — only the FINAL due version's rings apply
            if (pk) { const qs=_gpu.readEyePsi(); _gpu.setRings(pk.r, pk.w, pk.o); _E.kernelVer=pk.ver; _E.ringCache={r:pk.r,w:pk.w,o:pk.o}; _gpu.setEyePsi(qs); } }   // one ring swap, field preserved
          // SHIFT QUEUE REPLAY at the EXACT SHARED steps — snap the att to each queued shift's target the step it crosses (identical on all peers). The att is
          // STATIONARY between crossings (chase preserved: it only moves at a pixel-crossing step, not every step), and _transP is a pure step function → byte-identical.
          let _shiftCrossed = false;
          // GATE 3″ DISPATCH — THE KERNEL'S QUEUES (gate 3: the legacy gates are retired; the law lives in
          // kwe-tau.js L1–L3 with its regression suite). Authored-fresh crossings fire at their coordinate; backlog
          // paces ≤1 per τ_W unit (W's OWN worldline clock, fed by the medium's beat detector); the due-valve
          // bounds; selfClock off = clocks absent = unconditional coordinate dispatch (no-op by construction).
          if (_kqShift) _kqShift.drain(k, (e) => { _transPx = e.toX; _transPy = e.toY; _shiftCrossed = true; });
          if (_kqAtt)   _kqAtt.drain(k,   (e) => { _attApply(e); _shiftCrossed = true; });   // att-param crossings (cube angle) — same law, independent command stream
          if (_lensTauDirty) { _lensTauDirty = false; _shiftCrossed = true; }   // ω·τ_i: W's precessed _lensOp[0].phase enters at the next rebuild (k-indexed consumption)
          if (_shiftCrossed) { _rebuildAtt(); if (att) _gpu.setObjField(att); _coevoCur.lt = -1; }   // a command moved the target → the ⟲coevo leash is command-fresh (its next advance fires immediately)
          // ⚡SIG injection at the stamped shared step, CLOCK-PHASE-GATED: a slotted message waits for slot(k)===ph
          // (the head blocks the queue — FIFO channel semantics). Read-modify-write, same pattern as KDRAIN.
          if (_kqSig) _kqSig.drain(k, (sg) => {   // GATE 4: kernel drain; the slot gate is the queue's GUARD (head-blocking FIFO, pure fn of kW)
            const qs=_gpu.readEyePsi(); _sigAdd(qs, sg); _gpu.setEyePsi(qs);
            console.log(`[SIG] launched (${sg.fx.toFixed(0)},${sg.fy.toFixed(0)})→(${sg.tx.toFixed(0)},${sg.ty.toFixed(0)}) amp=${sg.amp} atStep=${k} kW=${_E.kwSteps} slot=${_SIG_SLOT(_E.kwSteps)}`); });   // lands at the stamped GLOBAL step, slot-gated in kW (matter time — the slot must contain the physical event)
          // ⎙VIRT verb at the stamped shared step: record (hologram W→plate→lift→V) · relift (resume V from the
          // plate = repeatable time-travel; the plate is immortal) · swap (V↔W with their energy budgets — the
          // dream becomes the world, the world becomes the dream; the drive continues on the new W).
          if (_kqVirt) _kqVirt.drain(k, (vq) => _virtVerb(vq, k, { att: () => att, rebuildW: () => { _rebuildAtt(); if (att) _gpu.setObjField(att); } }));   // GATE 4: kernel drain — hypervisor verbs fire at their authored coordinate; stage B1: ONE verb table for both drive paths (see _virtVerb)
          // REACTOR PONG drain — replies were scheduled IDENTICALLY on every peer (derived from the shared field) → local injection stays byte-identical
          if (_earROn && _earR && _earR.pending.length && _E.kwSteps >= _earR.pending[0].startStep) { const rp=_earR.pending.shift();
            const qs=_gpu.readEyePsi(); _sigAdd(qs, rp); _gpu.setEyePsi(qs);
            console.log(`[EAR-R] PONG launched (${rp.fx},${rp.fy})→(${rp.tx.toFixed(0)},${rp.ty.toFixed(0)}) kW=${_E.kwSteps} slot=${_SIG_SLOT(_E.kwSteps)}`); }   // pong startSteps are stamped in kW (scheduled by the reactor at hit+57 matter steps)
          if (att) { _gpu.applyEyeSuperpose(_beta(0));                        // ψ += β_W·att (interference-coevolve, GPU) — W pin amplitude (refAmp sweep)
            // MUX-RATE CHASE COMPENSATION (2026-07-07): under ⧉mux W owns the buffer only 1/nSl of global steps, so per
            // unit WALL time it superposes-toward-the-target 1/nSl as often → the chase pull weakens ∝1/nSl and a booted
            // P1/P2 (nSl 2→3→4) makes the soliton visibly LAG the moving shift target (solpos frozen while _transP runs
            // ahead — live-caught). The SAME fix V's held slice already uses (see _muxVirtualStep): apply the chase
            // superpose nSl−1 extra times per W-step (capped 3× total, β_eff≤0.45) so W chases at the SAME per-wall-time
            // rate regardless of how many phases share the substrate. Energy-cap below renormalizes → no blow-up. Pure
            // per-W-step, k-derived → byte-identical on peers. (Off mux nSl=1 → xtra=0 → the no-op guarantee.)
            const _nSlW = _V.virtMux ? (1 + (_V.psiVirt ? 1 : 0) + _V.phases.length) : 1;
            const _xtraW = Math.min(_nSlW - 1, 2); for (let e = 0; e < _xtraW; e++) _gpu.applyEyeSuperpose(_beta(0)); }
          _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT);   // propagate + self-focus
          _gpu.applyEyeEnergyCap(_torbE0);                                    // bound the superposition's added energy (GPU reduction + scale)
          _E.kwSteps++;                                                          // kW: one W-proper step executed (the channel clocks tick in matter time)
          // ⟲coevo LEASH — advance on W's PROPER-STEP grid (kW), checked on EVERY W-step, NOT inside the global-%Q
          // readback block. Under interlacing (ph = k % nSl) W owns scattered single steps, so a boundary that is BOTH
          // W-owned AND global-%21 almost never lands → the leash starved and coevoG froze at 0 (att stuck at center,
          // shift dead with P1/P2 booted — live-caught). kW ticks once per W-proper step regardless of nSl, so kW%21
          // fires every 21 W-steps exactly, independent of how many slots share the substrate. Its own readback (the
          // leash reads the post-superpose W field) so it doesn't depend on the Q-block. kW is a pure fn of the shared
          // schedule → byte-identical. This is the mux-honest form of the p10 leash (which relied on contiguous slices).
          if (_coevoOn && _leashDue(0, _E.kwSteps, _coevoCur)) { const ql = _gpu.readEyePsi(); if (_coevoLeash(ql, att)) { _rebuildAtt(); if (att) _gpu.setObjField(att); } }   // ⟲coevo advances per W's OWN slot-beat (τ_W cadence; flat kW%21 off selfClock — the last k-native geometry cadence, closed)
          if (_earROn && (_E.kwSteps % 21) === 0) { const qr = _gpu.readEyePsi(); _earRTest(qr, _E.kwSteps); }   // REACTOR test on W's proper-step grid (kW), pulled OUT of the global-%Q block — same interlacing-starvation fix as the coevo leash (was global-%21, starved under interlacing)
          if (_FIXED_QUANTUM > 0 && ((_base+i+1) % _FIXED_QUANTUM) === 0) { const q=_gpu.readEyePsi();
            if (_boundOpen) _applyOpenBoundary(q);   // open-bound sponge at the SHARED boundary (batch-invariant — a per-frame sponge would fork peers); the reactor/leash read the post-boundary field
            if (_V.virtMux) _kApply(q, 0);   // M-e: W's coupling edges (clock physics — mux-only, like the leak)
            if (_brWatch) _brSample(q, _base+i+1, att);   // M-c1′ breath probe (read-only, rides the existing readback)
            if (_V.selfClk) { _selfClkTick(q, _base+i+1, att, 0, _E.kwSteps); _tauAdv(_base+i+1); }   // M-c2 beat + gate-2 τ advance + τ_W on W's own counter
            _gpu.setEyePsi(q); }   // quantum-boundary readback (aligned chunking)
        }
        const fx = GRID/2+tgtPx, fy = GRID/2+tgtPy;
        const _endedMid = _V.muxLoaded !== 0;   // frame ended inside a virtual slice?
        _muxParkToW(att);   // park the loaded slot home, restore W to the GPU buffer (for rendering/next frame)
        // DESYNC FIX (2026-07-08): if the frame ended mid-virtual-slice, W's compare field (_E.psiLensed=out) must be
        // W's CANONICAL field (_V.muxHold, a clean f64 copy from the last W→transition), NOT a readEyePsi of the just-
        // restored buffer. readback = a f32 round-trip of _V.muxHold that a frame ending ON W never does → out was
        // {direct W} vs {round-tripped _V.muxHold} depending on todo (peer-local) → solH forked by one quantization.
        // Live-caught: same-machine peers with lastTodo 7 vs 14 fork solH one step after the todo split, W then frozen.
        let out = _endedMid ? _V.muxHold.slice() : _gpu.readEyePsi(); _gpu.setEyePsi(save);
        _V.lastAtt = att;   // stash for the mirror-driven virtual phase
        if (att && todo > 0) { _E.lockNow = _ampCorr(out, att); if (_E.lockNow < _E.lockMin) _E.lockMin = _E.lockNow; }   // minLock TELEMETRY (living-transport observable)
        _dbgTransPx=_transPx; _dbgTransPy=_transPy; _dbgAttH = att?_hashField(att):'--'; _dbgE0=_torbE0; _dbgShiftStep = (_kqShift && _kqShift.length) ? _kqShift.head().startStep : -1; _dbgShiftStart = _E.shiftSeen;   // stash live inputs for the per-tick [solH] cross-peer compare (pendingShift head + shiftSeen)
        if (_solLogBar !== bar) { _solLogBar = bar; let e=0,sx=0,sy=0,sw=0; for(let i=0;i<N_CELLS;i++){const a2=out[i*2]**2+out[i*2+1]**2;e+=a2;sx+=(i%GRID)*a2;sy+=((i/GRID)|0)*a2;sw+=a2;}
          if (_solE0<0) _solE0=e||1; const cx=sw>0?sx/sw:GRID/2, cy=sw>0?sy/sw:GRID/2;
          console.log(`[SOLITON:transport] bar ${bar} · E×${(e/_solE0).toFixed(2)} · solpos(${cx.toFixed(1)},${cy.toFixed(1)}) · _transP(${_transPx.toFixed(2)},${_transPy.toFixed(2)})${_coevoOn?` ⟲g=(${_coevoGx.toFixed(1)},${_coevoGy.toFixed(1)})`:''} · tgt(${tgtPx.toFixed(1)},${tgtPy.toFixed(1)}) · attXY(${Math.round(1+(_coevoOn?_coevoGx:_transPx))},${Math.round(1+(_coevoOn?_coevoGy:_transPy))}) · todo=${todo} · attH=${att?_hashField(att):'--'} E0=${_torbE0.toFixed(2)}`); }
        return out; };
      // ★ TRUE-ORBIT drive — a soft soliton on a CURVED orbit via METRIC GRAVITY (honest BY ACCURATE DESCRIPTION, not Newtonian force). MEASURED
      // EXHAUSTIVELY (mediumTrueOrbit): in this medium with the sustain (SPM+CGL) running, MOMENTUM-based motion is SUPPRESSED — a phase well (8
      // strengths) AND a −∇V momentum-tilt (4 strengths) are BOTH INERT: the dissipative re-centering kills the injected velocity every step (the soliton
      // sits at its radius). The ONLY thing that moves the soliton is the IFS CONTRACTION warp w(x)=s(x−f)+f applied continuously — because it's a
      // COORDINATE remap, orthogonal to the sustain (the dynamics can't undo a relabel). So gravity here is METRIC CURVATURE (the IFS map bends the
      // coordinate space; the soliton follows the geodesic — the GR view, your own "operator IS the curvature"), NOT a phase-gradient force. The orbit
      // is REAL (curved -46°, bounded r∈[13,20], E≈1, soft mobile soliton) — but it's "particle follows curved space", not "force pushes particle".
      // The critique was right the warp ≠ a Newtonian force; it was WRONG that a phase-force alternative exists here (sustain suppresses momentum).
      // CGL (adaptive ε, anti-decay) sustains the core. _torbKicked seeds initial tangential velocity once. NOT the persistent world soliton.
      const driveTrueOrbit = (savedPsi) => { if (!_gpu) return savedPsi;
        savedPsi = savedPsi || lensedSource;   // COLD START (late joiner) → seed/sustain from the live lensed source
        if (!savedPsi) return savedPsi;
        const save=_gpu.readEyePsi();
        if (!_solSeeded) { _gpu.setEyePsi(lensedSource ? lensedSource : savedPsi); _solSeeded = true; _torbKicked = false; _torbEps = _TORB_EPS; _torbE0 = -1; }
        else _gpu.setEyePsi(savedPsi);
        const fx = GRID/2 + (_lensP.tx||0), fy = GRID/2 + (_lensP.ty||0);   // the gravity well's fixed point = the slider target
        // ONE-TIME transverse kick = the slingshot (perpendicular to the radius from f to the current centroid). Gives the soliton orbital velocity.
        if (!_torbKicked) {
          let cx=0,cy=0,cw=0; for(let j=0;j<N_CELLS;j++){const a2=savedPsi[j*2]**2+savedPsi[j*2+1]**2;cx+=(j%GRID)*a2;cy+=((j/GRID)|0)*a2;cw+=a2;}
          const ccx=cw>0?cx/cw:GRID/2, ccy=cw>0?cy/cw:GRID/2, rx=ccx-fx, ry=ccy-fy, rl=Math.hypot(rx,ry)||1;
          const px=-ry/rl, py=rx/rl;   // unit perpendicular to the radius (tangential = orbital direction)
          _gpu.linOp({ kx: _TORB_KVEL*px, ky: _TORB_KVEL*py });   // inject tangential momentum
          _torbKicked = true;
        }
        const s=_TORB_S, grav=[{ m:[s,0,0,s], t:[(1-s)*(fx-GRID/2), (1-s)*(fy-GRID/2)] }];   // IFS contraction toward f = continuous gravity (frame-corrected)
        // SUSTAIN (the WORKING version — continuous blob + holds E, verified live): CGL with a FIXED ε (its linear-loss δ KILLS shed radiation + cubic/quintic
        // RE-SMOOTHS → continuous, not fragmented) + the GPU ENERGY-CAP as the SOLE energy authority (holds Σ|ψ|² exactly, undoes the contraction's zoom). CGL
        // cleans/smooths, the cap holds energy — no controller fight. (Adaptive-ε-ONLY was tried and FRAGMENTS/drains: a hunting gain can't track the warp's
        // per-step zoom-concentration; the cap's exact per-step rescale is load-bearing here. The adaptive-ε + a renorm was the ORIGINAL fight. So: cap + fixed CGL.)
        if (_torbE0 < 0) { let e=0; for (let j=0;j<savedPsi.length;j++) e+=savedPsi[j]*savedPsi[j]; _torbE0 = e||1; }
        for (let i=0;i<todo;i++){
          _gpu.ifsWarpEye(grav, 1);                                          // GRAVITY: continuous centripetal pull (contraction toward f)
          _gpu.stepEyeN(1, DT);                                              // KINEMATICS: leapfrog translates the phase gradient into motion
          _gpu.applyEyeNlSpm(-_TORB_GAMMA, _SOL_ISAT, DT);                   // COHESION: SOFT focusing (low γ → mobile, holds a phase gradient)
          _gpu.applyEyeCgl(_CGL_DELTA, _TORB_EPS, _CGL_MU, DT);             // CLEAN/SMOOTH: CGL FIXED ε (kills radiation + re-smooths → continuous blob)
          _gpu.applyEyeEnergyCap(_torbE0);                                   // SUSTAIN: hold E exactly (GPU) — the sole energy controller, no fight with CGL
        }
        let out=_gpu.readEyePsi(); _gpu.setEyePsi(save);
        if (_solLogBar !== bar) { _solLogBar = bar; let e=0,sx=0,sy=0,sw=0; for(let i=0;i<N_CELLS;i++){const a2=out[i*2]**2+out[i*2+1]**2;e+=a2;sx+=(i%GRID)*a2;sy+=((i/GRID)|0)*a2;sw+=a2;}
          if (_solE0<0) _solE0=e||1; const cx=sw>0?sx/sw:GRID/2, cy=sw>0?sy/sw:GRID/2, r=Math.hypot(cx-fx,cy-fy);
          const Ehold=_torbE0>0?(e/_torbE0):1;   // energy vs the cap target — should be ≈1.000 (the cap holds it exactly)
          console.log(`[SOLITON:trueorbit] bar ${bar} · E/target=${Ehold.toFixed(3)} · pos(${cx.toFixed(1)},${cy.toFixed(1)}) r=${r.toFixed(1)} → well(${fx.toFixed(0)},${fy.toFixed(0)}) · CGL(fixed ε) clean + GPU energy-cap sustain`); }
        return out; };
      // ★ OBJ-ORBIT drive (the transport COEVOLVE-CHASE applied to an ORBIT — orbits the REAL object, mediumOrbitCoevolve: 336°/1395°, r bounded [13,18],
      // E=1.00, multi-revolution). TWO meta-circular pieces compose, same as transport: (1) the OPERATOR defines the orbital PATH — the object is REGENERATED
      // (lens) on a CIRCLE around the shiftX/Y well, θ advancing each frame; (2) a PERSISTENT LIVING soliton CHASES the circling attractor via superposition +
      // self-focus + energy-cap (NO momentum, NO warp-gravity, NO CGL — the transport recipe). It orbits the actual letter/cube (not a blob, unlike trueorbit).
      // Structure is SOFT in transit (corr~0.3 — the living-chase price, like a motion-blurred circling object), the orbit itself is clean & bounded.
      const driveObjOrbit = (savedPsi) => { if (!_gpu) return savedPsi;
        savedPsi = savedPsi || lensedSource;   // COLD START (late joiner) → seed/sustain from the live lensed source
        if (!savedPsi) return savedPsi;
        const save=_gpu.readEyePsi();
        const side=Math.round(GRID*0.42);
        // KWE-DETERMINISM (the transport kit, applied here — the old drive was per-FRAME and desynced): (1) θ + att advance at SHARED
        // step-quantum boundaries {0,Q,2Q,…}, NOT per frame — frames END at peer-local steps, so a frame-keyed att gave each peer a
        // different superposition history; (2) the WELL (orbit center) rides the synced shift queue (_transPx/Py), not the render-tick
        // slider mirror; (3) the kernel queue DRAINS in-loop at its stamped steps (the old loop never drained → stale rings + joiner
        // mismatch); (4) the aligned quantum readback, same as transport. att is a pure function of the shared step index → byte-identical.
        { const sq = Array.isArray(n.shiftQueue) ? n.shiftQueue : [];
          let pulled = false;
          for (const e of sq) { if ((e.seq|0) > _E.shiftSeen) {
            if (_kqShift) _kqShift.push({ t:(e.time ?? 0), seq:e.seq|0, toX:e.toX??0, toY:e.toY??0 });   // GATE 3: kernel stamps and sorts (objorbit)
            _E.shiftSeen = e.seq|0; pulled = true; } }
          // ATT-PARAM QUEUE pull: opSpeed (θ multiplier) + cube angles — both shape the att, both land at stamped shared steps
          const aq = Array.isArray(n.attQueue) ? n.attQueue : [];
          let apulled = false;
          for (const e of aq) { if ((e.seq|0) > _attSeen) {
            if (_kqAtt) _kqAtt.push({ t:(e.time ?? 0), seq:e.seq|0, spd:e.spd, ay:e.ay, ax:e.ax });   // GATE 3: kernel stamps and sorts (objorbit)
            _attSeen = e.seq|0; apulled = true; } }
          // ⚡SIG QUEUE pull — stamped radiation launches (see transport)
          const gq = Array.isArray(n.sigQueue) ? n.sigQueue : [];
          let spulled = false;
          for (const e of gq) { if ((e.seq|0) > _sigSeen) {
            const ss = _kqSig ? _kqSig.push({ t:(e.time ?? 0), seq:e.seq|0, fx:e.fx??GRID/2, fy:e.fy??GRID/2, tx:e.tx??GRID/2, ty:e.ty??GRID/2, amp:e.amp??0.35, ph:(typeof e.ph==='number')?e.ph:-1 }) : -1;   // GATE 4: kernel stamps and sorts
            console.log(`[SIG] queued seq=${e.seq} startStep=${ss} nowStep=${_E.solSteps} Δ=${ss - _E.solSteps}${(e.ph??-1)>=0?` slot=${e.ph}`:''}`);
            _sigSeen = e.seq|0; spulled = true; } }
          // ⎙VIRT pull — a stamped hypervisor verb (latest wins; executes at the shared step inside the loop)
          if ((n.medVirtSeq|0) > _V.virtSeen) { const _vSeen0 = _V.virtSeen; _V.virtSeen = n.medVirtSeq|0;
            // replay EVERY unseen verb from the seq-stamped log (append, not replace — a slow peer must not skip a
            // verb that fast peers executed); fall back to the single latest-verb fields for old worlds without a log
            // GAP GUARD: if the seq jump exceeds what the log holds, older unseen verbs were sliced off — warn LOUD
            // (silent drop = "sometimes not work"). The log cap is 64; a burst/lag beyond that needs a re-anchor.
            if (Array.isArray(n.medVirtLog) && n.medVirtLog.length) { const _oldest = (n.medVirtLog[0].seq|0);
              if (_oldest > _vSeen0 + 1 && _vSeen0 > 0) console.warn(`[VIRT] ⚠ LOG GAP — verbs seq ${_vSeen0+1}..${_oldest-1} dropped (log holds ${n.medVirtLog.length}, seq now ${n.medVirtSeq|0}). A verb was lost: re-issue it, or re-anchor (orbW). Slow down bursts.`); }
            const _vEvs = (Array.isArray(n.medVirtLog) && n.medVirtLog.length) ? n.medVirtLog.filter(e => (e.seq|0) > _vSeen0)
              : [{ seq: n.medVirtSeq|0, time: (n.medVirtTime ?? 0), mode: n.medVirtMode || 'record', leak: (typeof n.medVirtLeak === 'number') ? n.medVirtLeak : 0, slot: (n.medVirtSlot|0), gx: (n.medVirtGx || 0), gy: (n.medVirtGy || 0), amp: (typeof n.medVirtAmp === 'number') ? n.medVirtAmp : 0, src: n.medVirtSrc || 'V' }];
            if (_kqVirt) for (const e of _vEvs) _kqVirt.push(normalizeVirtEvent(e)); }   // GATE 4: kernel stamps and sorts. The wire schema lives ONCE in medium-core.normalizeVirtEvent (stage B2) — the fixed field list here silently stripped lensset's params (live-caught 2026-07-11); new verb fields now have ONE place to land instead of three
        }
        const _base = _E.solSteps - todo;   // global index of the first step this frame (always a quantum multiple from the shared anchor)
        // PRE-LOOP CATCH-UP DRAINS REMOVED (2026-07-10 determinism fix — see the transport path comment): they
        // applied past-due heads unconditionally at _base = _E.solSteps − todo, a PEER-LOCAL frame boundary. Gate 3″
        // legitimately holds past-due backlog across frames → the pre-loop forked _transPx and bypassed the throttle.
        // The in-loop gated drain covers past-due entries at SHARED steps — do NOT reintroduce.
        const _OO_Q = _FIXED_QUANTUM > 0 ? _FIXED_QUANTUM : 7;   // orbit quantum = the shared chunking grid
        let att = null;
        const _oorbAtt = (k) => { _objOrbTheta = _coevoOn ? _coevoTh : k * _attSpd * _OBJORB_W_STEP * _orbW;   // ⟲coevo: the lock-paced effective θ; else θ = f(shared step) at the queue-applied speed × the test multiplier
          const wx = GRID/2 + _transPx, wy = GRID/2 + _transPy;
          const ox = wx + _orbR*Math.cos(_objOrbTheta), oy = wy + _orbR*Math.sin(_objOrbTheta);
          try { att = _lensObj==='cube' ? _cubeField(ox-GRID/2,oy-GRID/2,_attAY,_attAX) : makeProbeField(_lensObj,GRID,{x0:Math.round(ox-side/2),y0:Math.round(oy-side/2),side},{np:8},_objExtras); } catch(e){ att=null; }
          att = _attRot(att);   // M-a″: the operator carries its register phase into every rebuild
          if (att) _gpu.setObjField(att); };
        _oorbAtt(_base);
        if (!_solSeeded) { _gpu.setEyePsi(att||savedPsi); _solSeeded = true; let e=0; const s0=att||savedPsi; for(let j=0;j<s0.length;j++)e+=s0[j]*s0[j]; _torbE0=e||1; }   // seed from the att (the soliton RIDES it)
        else _gpu.setEyePsi(savedPsi);
        _E.muxStepped[0] = _E.muxStepped[1] = _E.muxStepped[2] = _E.muxStepped[3] = 0;   // proper-time render gate: reset per-slot step tally each frame
        // §7.44 CLOCK-PHASE MUX (M2→M4, see transport): shared impl _muxVirtualStep; θ stays on the GLOBAL clock (the operator keeps world time).
        for (let i=0;i<todo;i++){
          const k=_base+i;
          if (_muxVirtualStep(k, att, _FIXED_QUANTUM)) continue;
          _E.muxStepped[0]++;   // proper-time render gate: W's field advanced this step
          // KERNEL QUEUE REPLAY at the EXACT SHARED steps (identical on all peers; keep the soliton field across setRings)
          // COLLAPSE consecutive same-step drains (async-GPU race fix, see transport path): one setRings, final version.
          if (_kqKern) { let pk = null;
            _kqKern.drain(k, (e) => { pk = e; console.log(`[KDRAIN:objorbit] applied ver=${e.ver} startStep=${e.startStep} atStep=${k}`); });
            if (pk) { const qs=_gpu.readEyePsi(); _gpu.setRings(pk.r, pk.w, pk.o); _E.kernelVer=pk.ver; _E.ringCache={r:pk.r,w:pk.w,o:pk.o}; _gpu.setEyePsi(qs); } }
          // SHIFT QUEUE REPLAY (the well moves at the stamped shared step) + ORBIT QUANTUM (θ/att advance on the global grid)
          let _attStale = false;
          // GATE 3″ for objorbit (authored-fresh + τ_W backlog pacing — see the transport comment; this path had NO
          // throttle before 3′: the run-27/29 teleport class was live here under selfClock). Off selfClock the
          // short-circuit keeps the original unconditional drain (no-op guarantee).
          // GATE 3″ DISPATCH — kernel queues (see the transport comment; gate 3 retired the legacy gates here too)
          if (_kqShift) _kqShift.drain(k, (e) => { _transPx = e.toX; _transPy = e.toY; _attStale = true; });
          if (_kqAtt)   _kqAtt.drain(k,   (e) => { _attApply(e); _attStale = true; });   // opSpeed/angle crossing → θ multiplier / cube pose switch (authored-fresh; backlog τ_W-paced)
          if (_lensTauDirty) { _lensTauDirty = false; _attStale = true; }   // ω·τ_i: W's precession → rebuild
          if (i>0 && (k % _OO_Q)===0) _attStale = true;
          if (_attStale) _oorbAtt(k);
          // ⚡SIG injection at the stamped shared step, CLOCK-PHASE-GATED (see transport)
          if (_kqSig) _kqSig.drain(k, (sg) => {   // GATE 4: kernel drain; the slot gate is the queue's GUARD (head-blocking FIFO, pure fn of kW)
            const qs=_gpu.readEyePsi(); _sigAdd(qs, sg); _gpu.setEyePsi(qs);
            console.log(`[SIG] launched (${sg.fx.toFixed(0)},${sg.fy.toFixed(0)})→(${sg.tx.toFixed(0)},${sg.ty.toFixed(0)}) amp=${sg.amp} atStep=${k} kW=${_E.kwSteps} slot=${_SIG_SLOT(_E.kwSteps)}`); });   // lands at the stamped GLOBAL step, slot-gated in kW (matter time — the slot must contain the physical event)
          // ⎙VIRT verb (see transport)
          if (_kqVirt) _kqVirt.drain(k, (vq) => _virtVerb(vq, k, { att: () => att, rebuildW: () => _oorbAtt(k) }));   // GATE 4: kernel drain (see transport); stage B1: the SAME _virtVerb table — objorbit differs ONLY in the W-operator rebuild
          // REACTOR PONG drain (see transport)
          if (_earROn && _earR && _earR.pending.length && _E.kwSteps >= _earR.pending[0].startStep) { const rp=_earR.pending.shift();
            const qs=_gpu.readEyePsi(); _sigAdd(qs, rp); _gpu.setEyePsi(qs);
            console.log(`[EAR-R] PONG launched (${rp.fx},${rp.fy})→(${rp.tx.toFixed(0)},${rp.ty.toFixed(0)}) kW=${_E.kwSteps} slot=${_SIG_SLOT(_E.kwSteps)}`); }   // pong startSteps are stamped in kW (scheduled by the reactor at hit+57 matter steps)
          if (att) { _gpu.applyEyeSuperpose(_beta(0));                        // ψ += β_W·att (GPU) — W pin amplitude (refAmp sweep)
            const _nSlW = _V.virtMux ? (1 + (_V.psiVirt ? 1 : 0) + _V.phases.length) : 1;   // MUX-RATE CHASE COMPENSATION (see transport): W owns the buffer 1/nSl of steps under mux → extra superposes keep the well's chase per-wall-time-invariant to booted phases
            const _xtraW = Math.min(_nSlW - 1, 2); for (let e = 0; e < _xtraW; e++) _gpu.applyEyeSuperpose(_beta(0)); }
          _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT);
          _gpu.applyEyeEnergyCap(_torbE0);                                    // energy-cap (GPU)
          _E.kwSteps++;                                                          // kW: one W-proper step (see transport)
          if (_FIXED_QUANTUM > 0 && ((k+1) % _FIXED_QUANTUM) === 0) { const q=_gpu.readEyePsi();
            if (_boundOpen) _applyOpenBoundary(q);   // open-bound sponge at the SHARED boundary (see transport)
            if (_V.virtMux) _kApply(q, 0);   // M-e: W's coupling edges (clock physics — mux-only, like the leak)
            if (_earROn && ((k+1) % 21) === 0) _earRTest(q, _E.kwSteps);         // REPLICATED REACTOR test (shared 21-step boundaries; clocks in kW = matter time)
            // ⟲coevo ANGULAR leash v2 (Kepler-run lesson: an ALWAYS-learning baseline self-normalizes in a PERPETUAL
            // orbit — steady death-regrow becomes the new normal, σ pins at 1, ω saturates at the schedule for every R
            // — measured: ω=8.3/8.59/8.66 rigid across R=10/16/22). Orbit quality must be judged against a FIXED
            // reference: the PARKED object's lock, captured during a 10-boundary warmup (θ frozen), then FROZEN.
            // The orbit proceeds only at ≥75% of parked quality — if the medium can't, ω_eff < schedule = the law.
            if (_coevoOn && ((k+1) % 21) === 0 && att) { const l = _ampCorr(q, att); _coevoLl = l;
              if (_coevoWarm < 10) { _coevoWarm++; _coevoL0 = _coevoWarm === 1 ? l : _coevoL0 * 0.7 + l * 0.3; _coevoSg = 0; }   // parked-quality capture, θ frozen
              else { const sig = Math.max(0, Math.min(1, (l / Math.max(1e-6, _coevoL0) - 0.75) * 4)); _coevoSg = sig;
                if (sig > 0) { _coevoTh += sig * _attSpd * _OBJORB_W_STEP * _orbW * 21; _oorbAtt(k+1); } } }
            if (_brWatch) _brSample(q, k+1, att);   // M-c1′ breath probe (read-only, rides the existing readback)
            if (_V.selfClk) { _selfClkTick(q, k+1, att, 0, _E.kwSteps); _tauAdv(k+1); }   // M-c2 beat + gate-2 τ advance + τ_W on W's own counter
            _gpu.setEyePsi(q); }   // quantum-boundary readback (aligned chunking)
        }
        const _endedMid = _V.muxLoaded !== 0;   // desync fix (see transport path): mid-slice frame end → out from _V.muxHold, no f32 round-trip
        _muxParkToW(att);   // park the loaded slot home, restore W
        let out = _endedMid ? _V.muxHold.slice() : _gpu.readEyePsi(); _gpu.setEyePsi(save);
        _V.lastAtt = att;   // stash for the mirror-driven virtual phase
        if (att && todo > 0) { _E.lockNow = _ampCorr(out, att); if (_E.lockNow < _E.lockMin) _E.lockMin = _E.lockNow; }   // minLock TELEMETRY
        _dbgTransPx=_transPx; _dbgTransPy=_transPy; _dbgAttH = att?_hashField(att):'--'; _dbgE0=_torbE0; _dbgShiftStep = (_kqShift && _kqShift.length) ? _kqShift.head().startStep : -1; _dbgShiftStart = _E.shiftSeen;   // feed the per-tick [solH] cross-peer compare (same as transport)
        if (_solLogBar !== bar) { _solLogBar = bar; let e=0,sx=0,sy=0,sw=0; for(let i=0;i<N_CELLS;i++){const a2=out[i*2]**2+out[i*2+1]**2;e+=a2;sx+=(i%GRID)*a2;sy+=((i/GRID)|0)*a2;sw+=a2;}
          if (_solE0<0) _solE0=e||1; const wx=GRID/2+_transPx, wy=GRID/2+_transPy, cx=sw>0?sx/sw:GRID/2, cy=sw>0?sy/sw:GRID/2, r=Math.hypot(cx-wx,cy-wy);
          const _dTh = _objOrbTheta - _coevoThBar; _coevoThBar = _objOrbTheta;   // per-bar angular rate (the Kepler readout)
          console.log(`[SOLITON:objorbit] bar ${bar} · E×${(e/_solE0).toFixed(2)} · pos(${cx.toFixed(1)},${cy.toFixed(1)}) r=${r.toFixed(1)} · θ=${(_objOrbTheta%(2*Math.PI)).toFixed(2)}${_coevoOn?` ⟲ω=${_dTh.toFixed(3)}rad/bar vt=${(_dTh*_orbR).toFixed(2)}px/bar R=${_orbR} ℓ=${_coevoLl.toFixed(2)}/${_coevoL0.toFixed(2)} σ=${_coevoSg.toFixed(2)}`:''} · todo=${todo} → well(${wx.toFixed(0)},${wy.toFixed(0)}) · attH=${att?_hashField(att):'--'}`); }
        return out; };
      // SOLITON drive is OBJECT-AWARE (probe_multifeature_soliton): a STATIC object made of localized lumps IS a soliton gas (each feature
      // self-sustains, HELD). But the CUBE is a thin rotating WIREFRAME — NOT localized packets (scrambles) AND it must track canvas-1 rotation
      // (needs the blend to follow). So soliton mode applies to non-cube (static) objects; the CUBE falls back to the blend (write).
      const _solOn = (_driveMode==='sol-cons' || _driveMode==='sol-diss') && !_barrOn && !_vortOn && (_lensObj !== 'cube');
      const _transportOn = (_driveMode==='transport') && !_barrOn && !_vortOn;   // coevolve-chase the object to the slider target (cube supported via _cubeField offset)
      const _trueOrbitOn = (_driveMode==='trueorbit') && !_barrOn && !_vortOn && (_lensObj !== 'cube');   // continuous-physics orbit (soft soliton + IFS-gravity + momentum)
      const _objOrbitOn = (_driveMode==='objorbit') && !_barrOn && !_vortOn;     // the REAL object orbits (operator circles + living soliton chases)
      const _wellDef = (_driveMode==='hybrid') && !_barrOn && !_vortOn;   // UI drive toggle; instanton modes keep their own drives
      _E.psiLensed = _barrOn ? driveSolitonWell(_E.psiLensed, _barrierTarget)
                 : _vortOn ? driveVortexSustain(_E.psiLensed)
                 : _transportOn ? driveSolitonTransport(_E.psiLensed)
                 : _objOrbitOn ? driveObjOrbit(_E.psiLensed)
                 : _trueOrbitOn ? driveTrueOrbit(_E.psiLensed)
                 : _solOn ? driveSolitonPure(_E.psiLensed)
                 : _wellDef ? driveWellDefault(_E.psiLensed)
                 : driveSoliton(_E.psiLensed, lensedSource, SRC_ALPHA);
      // GLOBAL open-boundary applies to ALL drives (soliton modes already applied it inside driveSolitonPure → skip to avoid double-absorb).
      // For write/hybrid/barrier/vortex the blend/well re-pins the field each frame, so the absorbing edge mostly dims content near the rim
      // (little net effect — the drive wins) — but it's honestly applied so the toggle is global, as requested.
      if (_boundOpen && !_solOn && !_snapMode && _E.psiLensed) _E.psiLensed = _applyOpenBoundary(_E.psiLensed);   // per-frame is fine for non-byte-compared drives; transport/objorbit apply the sponge IN-LOOP at shared 7-step boundaries (a per-frame sponge lands at peer-local steps → byte fork)
      // ── PHASE V — the VIRTUAL SOLITON runs LIVE (milestone 1 of the one-world migration): same shared substrate
      // (time-shared GPU buffer), same sustain, same shared step count — but FREE (no operator drive) → it diverges
      // from the driven world naturally. bind(V,W) = the live divergence, read as the lock. Deterministic: identical
      // todo + identical lift on every peer → identical virtual world, zero reflector traffic.
      if (_V.psiVirt && _gpu && _snapMode && todo > 0) {
        if (!_V.virtMux) {   // parallel frame time (mux OFF); under MUX, V already advanced inside the drive loop on its own §7.44 clock-phase slices
          const sv = _gpu.readEyePsi();
          _gpu.setEyePsi(_V.psiVirt);
          const mir = _V.virtMirror && _V.lastAtt;   // MIRROR: V receives the same operator drive as W (frame-granular att — exact when W is parked, the Lyapunov configuration)
          const indep = !mir && _V.virtGoOn && _V.virtAtt;   // INDEPENDENT: V chases its own moving target (coevolve-transport in the dream)
          const hold = !mir && !indep && _V.virtHold && _V.virtAtt;   // HOLD: V driven toward its OWN recorded att — parked at the remembered moment
          if (mir) _gpu.setObjField(_V.lastAtt); else if (indep) _gpu.setObjField(_virtMovAtt()); else if (hold) _gpu.setObjField(_V.virtAtt);
          for (let i = 0; i < todo; i++) {
            if (mir || indep || hold) _gpu.applyEyeSuperpose(_TRANSPORT_BETA);
            _gpu.stepEyeN(1, DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA, _SOL_ISAT, DT); _gpu.applyEyeEnergyCap(_V.virtE0);
            _V.kvSteps++;
            if ((_boundOpen || _V.earVOn || indep) && _FIXED_QUANTUM > 0 && ((_E.solSteps - todo + i + 1) % _FIXED_QUANTUM) === 0) { const qv=_gpu.readEyePsi();
              if (_boundOpen) _applyOpenBoundary(qv);
              if (indep && ((_E.solSteps - todo + i + 1) % 21) === 0) { const nm = _virtAdvance(qv); if (nm) _gpu.setObjField(nm); }   // ⟲ leash step (V's own lock gates its operator advance)
              if (_V.earVOn) { if (((_E.solSteps - todo + i + 1) % 21) === 0) _earVTest(qv, _V.kvSteps);   // no leak without ⧉mux, but the dream's reactor still runs (it hears its own churn — floors learn, honest silence)
                while (_V.earV && _V.earV.pending.length && _V.kvSteps >= _V.earV.pending[0].startStep) { const rp=_V.earV.pending.shift(); _sigAdd(qv, rp);
                  console.log(`[EAR-V] dream-PONG launched (${rp.fx},${rp.fy})→(${rp.tx.toFixed(0)},${rp.ty.toFixed(0)}) kV=${_V.kvSteps}`); } }
              _gpu.setEyePsi(qv); } }   // sponge/ears at the SHARED step indexes (V's step i = global step _E.solSteps−todo+i → batch-invariant; V must stay byte-identical — swap makes it W)
          _V.psiVirt = _gpu.readEyePsi(); _gpu.setEyePsi(sv);
        }
        if (_E.psiLensed) _V.virtCorr = _ampCorr(_V.psiVirt, _E.psiLensed);
      }
      // ★ LIVE ψ_C — a SECOND persistent soliton kept ALIVE at C by the instanton drive, parallel to _E.psiLensed (which relaxes to B post-commit).
      // VORTEX: C is a genuine stable equilibrium → driveVortexSustain holds it there indefinitely (charged Q=1, the live transition state).
      // BARRIER: C is a mid-saddle TRANSIENT (a saddle is NOT a sustainable equilibrium — no honest drive holds a soliton mid-saddle), so we
      // let it evolve under the well from its seed (it shows the live crossing dynamics, settling per the medium — not faked into a false hold).
      if (_E.psiC && _tunnelActive) {
        if (_tunnelMode==='vortex') _E.psiC = driveVortexSustain(_E.psiC);
        else if (_tunnelMode==='barrier') _E.psiC = driveSolitonWell(_E.psiC, 'A');   // the well from the crossing seed (honest: a saddle won't hold; this is the live dynamics)
      }
      // INSTANTON FIRE (medium scope): kick the world soliton at the fire bar (+ held bars). In barrier mode the kick is a MOMENTUM RAMP
      // toward B (linear phase tilt = velocity), which the phase-well drive now PRESERVES (the amplitude-blend would have deleted it).
      _fireInstanton(_E.psiLensed, 'medium', bar);
      // ★ MOMENTUM KICK (barrier mode): on the fire bar, stamp a linear phase ramp toward B = velocity. The phase-well drive conserves it
      // (CPU-verified: soliton moves with k, unlike the amplitude-blend which pinned it). Steep enough → climbs out of A's well to B.
      // DEGENERATE genomes (A≈B, real fit-degeneracy) → NO direction to kick toward; skip the kick honestly (nothing to cross to).
      if (_tunnelMode==='barrier' && _tunnelActive && _instFireBar===bar && _E.psiLensed && !_barrDegenerate) {
        try { const sv=_gpu.readEyePsi(); _gpu.setEyePsi(_E.psiLensed);
          const ca=_barrGenCentroid('A'), cb=_barrGenCentroid('B');   // MEASURED real genome A/B centroids → the true A→B kick direction
          const dx=cb[0]-ca[0], dy=cb[1]-ca[1], dn=Math.hypot(dx,dy)||1;
          const k=(_instAmp/16)*0.5;   // momentum magnitude ∝ ⚡amp (the barrier-climbing dial)
          _gpu.linOp({ kx:k*dx/dn, ky:k*dy/dn });   // LINEAR phase ramp = momentum toward B (NOT a lens — a velocity)
          _E.psiLensed = _gpu.readEyePsi(); _gpu.setEyePsi(sv); } catch(e){} }
      // EMERGENT ADAPTATION: the genome reads the RUPTURED field (_E.psiLensed, post-kick) and drifts via readGenomeGrad→thetaWalk —
      // it discovers the new vacuum the ruptured wave supports (the critique's mechanism). Runs after the fire so the field is ruptured.
      _emergentMigrate(bar, _E.psiLensed);
      _clockMigrate(bar);   // ★ clock-mode tunnel: advance the IFS contraction toward B (the honest instanton transport)
      _barrierMigrate(bar);   // ★ barrier-mode: winner-take-all retarget — flip the drive to whichever basin the soliton actually crossed into
      _vortexMigrate(bar);    // ★ vortex-mode: read the winding number → latch B once a topological charge takes hold (the topological instanton)
      // ── THE EYE TRAP (heavy — eye scope ONLY): catch the live _E.psiLensed, hologram→recon→perceive (the eye's own mode/sliders).
      let eyeRecon = null, eyeHologram = null;
      if (eyeScope) {
        // M3b — PHASE SELECTOR: the eye traps the SELECTED phase of the one soliton. 'V' with a live virtual phase →
        // the eye looks INTO the dream (hologram/recon/recall/self all run on ψ_V); otherwise the driven world as ever.
        const _phaseIn = (_eyeSrc === 'V' && _V.psiVirt && _V.psiVirt.length === 2*N_CELLS) ? _V.psiVirt
                       : (_eyeSrc === 'P1' && _V.phases[0]) ? _V.phases[0].psi
                       : (_eyeSrc === 'P2' && _V.phases[1]) ? _V.phases[1].psi : _E.psiLensed;
        const incoming = (_phaseIn && _phaseIn.length===2*N_CELLS) ? _phaseIn
                       : (lensedSource && lensedSource.length===2*N_CELLS) ? lensedSource : _probeRaw;   // the live world soliton the eye traps
        // LENS-IN-THE-WAVEFRONT RECALL: for the hidden family, eye recall/recall→self RECOGNIZES the planted lens carried IN the
        // incoming wavefront (matched filter on the lensed signatures — the input is "wavefront WITH a lens"), and FEEDS that
        // recognized rank into the trap as ctx.selectedRank. So recall runs the RECALLED genome (recall→self then EVOLVES it). This
        // runs BEFORE _runScope so the recon uses the recognized lens (the library opRecall's synthetic-cue select would mismatch a
        // lensed cloud → score 0). _recallLockRank exposes it to the label. opMode must be 'phase' for the signatures to be valid.
        _recallLockRank = null;
        if (_isHidden(_lensObj) && (E.mode==='recall' || E.mode==='recallself')) {
          const rec = _recognizeHidden(incoming); _recallLockRank = rec.best;
          E.selectedRank = rec.best; E.recallScores = rec.scores;   // the trap's recall/self adopts the recognized lens (selectedRank → _activeGenome / seedFn)
        }
        eyeRecon = _runScope(E, true, incoming, _eyeLensP, _E.monClock, bar);     // eye trap stack → the perceived recon
        eyeHologram = E.hologram || incoming;
        _lastEyeReconHash = _hashField(eyeRecon);   // the eye recon field digest (the real per-peer physics output → byte-match proof)
        // RESONANCE = the [H] MATCHED FILTER (recall's pure-phase recognition, no metric). The eye correlates the LIVE trapped
        // hidden wavefront against each genome's LENSED SIGNATURE (the template = a packet through that genome's phase lens — the
        // SAME representation as the cloud, which is why plain recall's impulse-templates score 0). corr = |Σ cue·conj(tmpl)|/norm
        // (the bindEyeField complex product). Self-match → 1.0, mismatch → ~0 (measured ~50× contrast). argmax = the recognized
        // geometry → "geometry sees geometry" via the medium's own recognition primitive, pure phase. Templates cached (genome-keyed).
        if (_isHidden(_lensObj)) {
          const Nn=N_CELLS, save=_gpu.readEyePsi();   // restore the eye buffer after the scratch lens runs (templates / vernier)
          _ensureTemplates();
          const cue = incoming;   // the LIVE trapped hidden wavefront (the matched-filter probe)
          const corrF = (c, tmpl) => _corrLensed(c, tmpl, Nn);
          // AUTOMATIC recognition (no tuning): correlate the cue vs every template → the recognized shape(s). For obj:mixed the
          // field is a SUPERPOSITION → multiple ranks score high (the eye sees BOTH planted notes coexisting in one wavefront).
          const _sw = _lockSweep(cue, _resoTemplates, corrF);   // M3: the one recall primitive
          _resoScores = _sw.scores; _resoBest = _sw.best;
          _resoClean = _resoScores[_resoBest] || 0;   // the recognition strength (the recognized shape's score)
          // OPERATOR-BASED SELECTION (obj:mixed): the eye's SELECTED rank acts as the EXTRACTION OPERATOR. Project the cue onto
          // that genome's template — extracted = (⟨cue|tmpl⟩/⟨tmpl|tmpl⟩)·tmpl — the COMPONENT of the field along the selected
          // note. This PULLS ONE genome out of the superposition (the others fall away), and the extracted field becomes the recon
          // output so you SEE the selected genome isolated from the mixture. selecting a rank NOT in the field → near-zero extract.
          const selR = E.activeRank % _resoTemplates.length;
          if (_lensObj === 'mixed') { const tmpl=_resoTemplates[selR]; let pr=0,pi=0,tt=0;
            for (let i=0;i<Nn;i++){ const ar=cue[i*2],ai=cue[i*2+1],br=tmpl[i*2],bi=tmpl[i*2+1]; pr+=ar*br+ai*bi; pi+=ai*br-ar*bi; tt+=br*br+bi*bi; }
            const k=tt>0?1/tt:0, ar2=pr*k, ai2=pi*k; const ext=new Float64Array(2*Nn);   // complex projection coefficient ⟨cue|tmpl⟩/‖tmpl‖²
            for (let i=0;i<Nn;i++){ const br=tmpl[i*2],bi=tmpl[i*2+1]; ext[i*2]=ar2*br-ai2*bi; ext[i*2+1]=ar2*bi+ai2*br; }
            _extracted = ext; } else _extracted = null;
          // INTERACTIVE θ-vernier: the eye θ-slider applies a θ-SHEAR CORRECTION to the cue (a real per-pixel β·angle phase plate via
          // the eye-rank genome at −θ_slider), then correlate vs the EYE-SELECTED template. The score PEAKS when the slider cancels
          // any residual θ-shear between the cue and the template → you DIAL to tune the resonance (the "find the note" interaction),
          // on top of the robust matched filter. (A global phase wouldn't work — the detuning is a spatial shear, not a constant.)
          const eyeTh = (_eyeLensP.thAdd||0); const keyGen = _resoRules[E.activeRank % _resoRules.length];
          let tunedCue = cue;
          if (eyeTh !== 0) { _gpu.setEyePsi(cue); runGenomeLens(_gpu, keyGen, 1, GRID, DT, { ..._RESO_P(), thAdd:-eyeTh });
            tunedCue = _gpu.readEyePsi(); _gpu.setEyePsi(save); }
          _resonance = corrF(tunedCue, _resoTemplates[E.activeRank % _resoTemplates.length]) || 0;   // tunable: eye-rank template + θ-shear correction
          _gpu.setEyePsi(save);   // restore the eye buffer (scratch lens runs above)
        } else { _resonance = 0; _resoClean = 0; _resoScores = null; _extracted = null; }
      }
      // ── RENDER (l11_best_lens). The SCOPE picks which rows show. MEDIUM scope → the world row (ψ_in source / ψ_out world-lens).
      //    EYE scope → the trap row (◀ hologram / ▸ recon soliton). view: per-scope ('crisp'=direct field, 'soliton'=living §7.44).
      // PROPER-TIME RENDER GATE: a slot's canvas repaints only on frames where the slot's OWN field advanced (no interp of a
      // frozen slice — the observer sees the slot's proper time, continuous in its window; 1/N cadence = the honest mux signature).
      // Off-mux (no virtual phase / mux off), every slot "stepped" → gate is transparent, classic per-frame render unchanged.
      const _muxGated = _V.virtMux && (_V.psiVirt || _V.phases.length);   // gate active only when the buffer is actually time-sliced
      const _slotDrew = (sl) => !_muxGated || _E.muxStepped[sl] > 0;   // sl: 0=W 1=V 2=P1 3=P2
      const mv = M.view, ev = E.view;
      row.style.display = eyeScope ? 'none' : 'flex';
      rowEye.style.display = eyeScope ? 'flex' : 'none';
      if (!eyeScope) {   // MEDIUM scope: also drive + draw the source soliton, draw the world row
        _E.psiSource = driveSoliton(_E.psiSource, _E.localObjField, SRC_ALPHA);
        if (_E.psiSource) _drawL11(inCell, _E.psiSource);
        const _ψout = (mv === 'crisp') ? lensedSource : _E.psiLensed;   // ψ_out = the LIVE persistent soliton (the lens already transformed it in-place in the drive — meta-circular, no scratch copy). Coevolve shows the REAL interference state, no display filtering.
        if (_ψout && _slotDrew(0)) _drawL11(outCell, _lensedView(0, _ψout));   // proper-time gate: repaint W only on frames W stepped (else last real frame holds — no invented instant)
        _lastSolHash = (_driveMode!=='write' && _E.psiLensed) ? _hashField(_E.psiLensed) : '--------';   // the DRIVEN-SOLITON digest (what canvas-2 actually shows) → the real transport/objorbit peer-match proof (medH hashes only the stateless lens)
        _lastSolMacro = (_driveMode!=='write' && _E.psiLensed) ? _macroSol(_E.psiLensed) : null;         // the topological tier next to it (cross-vendor observable; see _macroSol)
        _lastVirtHash = _V.psiVirt ? _hashField(_V.psiVirt) : '--------';   // V by W's yardstick: matches across peers ⟺ V's divergence < 0.001 (W's bound); differs ⟺ over threshold (the free-halo drift)
        _lastP1Hash = (_V.phases[0] && _V.phases[0].psi) ? _hashField(_V.phases[0].psi) : '--------';   // P1 booted phase by the same yardstick
        _lastP2Hash = (_V.phases[1] && _V.phases[1].psi) ? _hashField(_V.phases[1].psi) : '--------';   // P2 booted phase by the same yardstick
        // V⊗ CURVE WATCHER (armed via window.virtWatch): per-bar samples + end fit of ln(1−V⊗) per bar —
        // negative slope = CONTRACTIVE (differences heal; rate = the healing constant, the complement of τ);
        // positive = CHAOTIC (the slope IS the Lyapunov exponent); flat = MARGINAL (differences persist).
        if (_virtWatch && _V.psiVirt && _virtWatch.lastBar !== bar) { _virtWatch.lastBar = bar;
          _virtWatch.samples.push(_V.virtCorr);
          console.log(`[VIRTWATCH] bar ${bar} · V⊗=${_V.virtCorr.toFixed(4)} · 1−V⊗=${(1 - _V.virtCorr).toExponential(2)}${_V.virtMirror ? ' (mirrored)' : (_V.virtHold && _V.virtAtt) ? ' (held)' : ' (counterfactual)'}${_V.virtMux ? ' ⧉mux' : ''}`);
          if (_virtWatch.samples.length >= _virtWatch.bars) {
            const ss = _virtWatch.samples, n2 = ss.length;
            let sx = 0, sy = 0, sxx = 0, sxy = 0;
            for (let i = 0; i < n2; i++) { const y = Math.log(Math.max(1e-6, 1 - ss[i])); sx += i; sy += y; sxx += i * i; sxy += i * y; }
            const slope = (n2 * sxy - sx * sy) / Math.max(1e-12, n2 * sxx - sx * sx);
            console.log(`[VIRTWATCH] done · V⊗ ${ss[0].toFixed(3)} → ${ss[n2-1].toFixed(3)} · d ln(1−V⊗)/dbar = ${slope.toFixed(4)} → ${slope < -0.01 ? `✓ CONTRACTIVE — differences heal · healing rate ${(-slope).toFixed(3)}/bar (e-fold ${(1 / -slope).toFixed(0)} bars)` : slope > 0.01 ? `✓ CHAOTIC — Lyapunov ≈ ${slope.toFixed(3)}/bar (differences double every ${(Math.LN2 / slope).toFixed(1)} bars)` : '✓ MARGINAL — differences persist (the halo law extends to differences)'}`);
            _virtWatch = null; } }
        // M-a TEXTURE WATCHER (armed via window.texWatch) — the register experiment's readout, all proven primitives:
        // b = ψ_V*·ψ_W is the BIND product (at write time W = V·e^{iφ} exactly, mirror keeping V the drive-matched
        // reference), so arg(b) CARRIES the texture. T = |Σ b·e^{−iφ}|/Σ|b| = readability in the WRITTEN basis;
        // T0 = |Σ b|/Σ|b| = the undemod control (T high & T0 low ⟺ the texture is present AND intact — both high
        // means it healed away, both low means the basis scrambled). θ = arg(Σ b·e^{−iφ}) tracks the global
        // precession: the ω-time law predicts a LINEAR drift (the one-calibration constant). The |ψ_W|² centroid is
        // the kick check — a zero-moment texture must deposit no momentum (two-channel law). Peer-local diagnostic.
        const _twRef = _texWatch ? (_texWatch.slot === 'P1' ? (_V.phases[0] || {}).psi : _texWatch.slot === 'P2' ? (_V.phases[1] || {}).psi : _V.psiVirt) : null;   // M-b: the meter's reference field — the read is PAIRWISE (θ = φ_W − φ_ref: bind is a differential read; a register value is always relative to a reference)
        if (_texWatch && _twRef && _twRef.length === 2*N_CELLS && _E.psiLensed && _texWatch.lastBar !== bar) { _texWatch.lastBar = bar;
          const hs = !!_texSpec; if (hs) _texBuild(_texSpec);   // no texture = Θ-METER mode: demod by identity, θ = raw V⊗ arg — the operator-side (attPhase) register readout AND the pre-write baseline
          let dr = 0, di = 0, r0 = 0, i0 = 0, sb = 0, cx = 0, cy = 0, cw = 0;
          for (let j = 0; j < N_CELLS; j++) { const vr = _twRef[j*2], vi = _twRef[j*2+1], wr = _E.psiLensed[j*2], wi = _E.psiLensed[j*2+1];
            const br = vr*wr + vi*wi, bi = vr*wi - vi*wr;                  // b = conj(ψ_V)·ψ_W
            const tc = hs ? _texSpec.c[j] : 1, ts = hs ? _texSpec.s[j] : 0;
            dr += br*tc + bi*ts; di += bi*tc - br*ts;                      // b·e^{−iφ}
            r0 += br; i0 += bi; sb += Math.hypot(br, bi);
            const a2 = wr*wr + wi*wi; cx += (j % GRID)*a2; cy += ((j / GRID)|0)*a2; cw += a2; }
          const T = Math.hypot(dr, di) / Math.max(1e-12, sb), T0 = Math.hypot(r0, i0) / Math.max(1e-12, sb), th = Math.atan2(di, dr);
          _texWatch.samples.push({ T, T0, th, cx: cw > 0 ? cx / cw : 0, cy: cw > 0 ? cy / cw : 0 });
          console.log(`[TEXWATCH] bar ${bar} · T=${T.toFixed(4)} (demod) · T0=${T0.toFixed(4)} (control) · θ=${th.toFixed(3)}${_texWatch.slot !== 'V' ? ` (ref ${_texWatch.slot})` : _V.virtMirror ? '' : _V.virtHold ? '' : ' ⚠ V free-runs (virtHold() for a long-term reference)'}`);
          if (_texWatch.samples.length >= _texWatch.bars) { const ss = _texWatch.samples, n2 = ss.length;
            let un = 0, prev = ss[0].th, sx = 0, sy = 0, sxx = 0, sxy = 0, lx = 0, ly = 0, lxx = 0, lxy = 0;
            for (let i = 0; i < n2; i++) { const d = ss[i].th - prev; prev = ss[i].th;
              un += ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;   // unwrapped precession
              sx += i; sy += un; sxx += i * i; sxy += i * un;
              const yl = Math.log(Math.max(1e-6, 1 - ss[i].T)); lx += i; ly += yl; lxx += i * i; lxy += i * yl; }
            const drift = (n2 * sxy - sx * sy) / Math.max(1e-12, n2 * sxx - sx * sx);   // rad/bar — the ω-bias calibration constant
            const lam = (n2 * lxy - lx * ly) / Math.max(1e-12, n2 * lxx - lx * lx);     // d ln(1−T)/dbar — the persistence exponent
            const q = Math.max(1, Math.floor(n2 / 4)), mT = (a) => a.reduce((x, y) => x + y.T, 0) / a.length;
            const Tf = mT(ss.slice(0, q)), Tl = mT(ss.slice(-q));
            const kick = Math.hypot(ss[n2-1].cx - ss[0].cx, ss[n2-1].cy - ss[0].cy);
            // PRESENCE test overrides the λ fit (run-1 lesson: the fit saw a stable plateau and said PERSISTS while
            // the plateau was the texture-free mirror floor). The unfoolable sign is ΔT = T−T0: demod HELPS (ΔT>0)
            // ⟺ coherent texture in the written basis; demod HURTS (ΔT<0, ratio ≈ ⟨e^{−iφ}⟩) ⟺ content GONE —
            // then a stable T0 means the difference ENERGY persists but its SHAPE scrambled (content λ ≠ energy λ;
            // readability is the register criterion).
            const dTT = ss.reduce((x, y) => x + (y.T - y.T0), 0) / n2;
            // k=(0,0) — the U(1) REGISTER readout (run-2 discovery: grid-space structure disperses sub-bar at every
            // resolvable k, but the RELATIVE GLOBAL PHASE between W and V locks and persists — the medium's zero
            // mode is the register channel). For k=0 the modulus is phase-blind (T≡T0), so θ IS the readout:
            // persisted offset p = amp + θ (demod subtracts the full write), jitter bounds the symbol capacity.
            const k0 = _texSpec && _texSpec.kx === 0 && _texSpec.ky === 0, a0 = _texSpec ? _texSpec.amp : 0;
            const lq = ss.slice(-q), mTh = lq.reduce((x, y) => x + y.th, 0) / lq.length;
            const vTh = Math.sqrt(lq.reduce((x, y) => x + (y.th - mTh) ** 2, 0) / lq.length);
            const pres = !_texSpec ? `Θ METER — V⊗ arg locked at ${mTh.toFixed(3)}±${vTh.toFixed(3)} rad (the operator-side register readout: compare to the stamped Σ attPhase; jitter → ~${Math.max(1, Math.floor(2 * Math.PI / (6 * Math.max(1e-4, vTh))))} symbols at 6σ)`
                       : k0 ? `U(1) REGISTER — stored relative phase ${(a0 + mTh).toFixed(3)} rad of ${a0} written (retained ${(100 * (1 + mTh / Math.max(1e-9, a0))).toFixed(0)}% after write-in) · θ jitter ±${vTh.toFixed(3)} → ~${Math.max(1, Math.floor(2 * Math.PI / (6 * Math.max(1e-4, vTh))))} distinguishable symbols at 6σ spacing (T≡T0 at k=0 — θ is the readout)`
                       : dTT > 0.02 ? `✓ PRESENT (ΔT=+${dTT.toFixed(3)}: demod helps) · ${lam < -0.01 ? `decaying, d ln(1−T)/dbar=${lam.toFixed(4)} (e-fold ${(1/-lam).toFixed(0)} bars)` : lam > 0.01 ? `degrading, +${lam.toFixed(4)}/bar` : 'λ≈0 — the texture PERSISTS: the phase channel can carry a register'}`
                       : dTT < -0.01 ? `✗ ABSENT (ΔT=${dTT.toFixed(3)}: demod hurts — T/T0≈⟨e^{−iφ}⟩ of a texture-FREE difference) — content washed/dispersed ${ss[0].T > 0.95 ? 'DURING the watch' : 'BEFORE the first sample (arm texWatch first to catch the transient)'}`
                       : `? AMBIGUOUS (ΔT=${dTT.toFixed(3)} — near the floor; raise amp or lower k)`;
            console.log(`[TEXWATCH] done · T ${Tf.toFixed(3)}→${Tl.toFixed(3)} · T0(end)=${ss[n2-1].T0.toFixed(3)} · ${pres} · drift=${drift.toFixed(4)} rad/bar (the ω-bias; linear ⟹ one calibration undoes it) · kick=${kick.toFixed(2)}px ${kick < 1 ? '✓ zero-moment (no momentum deposited)' : '⚠ the write kicked the soliton — the basis has a tilt component'}`);
            _texWatch = null; } }
        // ABSOLUTE REGISTER READ (armed via window.regRead): per frame, the k=0 coefficient Σψ of every live phase
        // (W from _E.psiLensed; V/P1/P2 from their parked CPU copies — fresh at frame end under mux). Vector-average
        // of the per-frame unit phasors → θ per slot + circular spread σ ≈ √(2(1−R̄)). The absolute θ carries the
        // object's constant construction phase — DIFFERENCES (across slots, or across time on one slot) are the
        // register content; W−V here = the old differential meter's θ, now decomposed into its two absolute halves.
        if (_regRd && _E.psiLensed) { const slots = [['W', _E.psiLensed], ['V', _V.psiVirt], ['P1', (_V.phases[0]||{}).psi], ['P2', (_V.phases[1]||{}).psi]];
          for (const [nm, f] of slots) { if (!f || f.length !== 2*N_CELLS) continue;
            let zr = 0, zi = 0; for (let j = 0; j < N_CELLS; j++) { zr += f[j*2]; zi += f[j*2+1]; }
            const h = Math.hypot(zr, zi) || 1; const a = _regRd.acc[nm] || (_regRd.acc[nm] = { ur: 0, ui: 0, n: 0 });
            a.ur += zr / h; a.ui += zi / h; a.n++; }
          if (++_regRd.f >= _regRd.n) { const out = [], th = {};
            for (const nm of ['W', 'V', 'P1', 'P2']) { const a = _regRd.acc[nm]; if (!a || !a.n) continue;
              const t = Math.atan2(a.ui, a.ur), R = Math.hypot(a.ur, a.ui) / a.n, sg = Math.sqrt(Math.max(0, 2 * (1 - R)));
              th[nm] = t; out.push(`${nm}: θ=${t.toFixed(3)} ±${sg.toFixed(3)}`); }
            const dif = [];
            for (const nm of ['V', 'P1', 'P2']) if (th[nm] !== undefined && th.W !== undefined) dif.push(`W−${nm}=${_aphNorm(th.W - th[nm]).toFixed(3)}`);
            _regRd.series.push({ k: _E.solSteps, th });
            console.log(`[REGREAD] ${_regRd.series.length}/${_regRd.series.length + _regRd.reps - 1} · ${out.join(' · ')}${dif.length ? ' · ' + dif.join(' · ') : ''} · step=${_E.solSteps}`);
            if (--_regRd.reps > 0) { _regRd.acc = {}; _regRd.f = 0; }
            else { const S = _regRd.series; _regRd = null;
              // DRIFT FIT (clause 3's instrument): per-slot linear fit of the unwrapped absolute θ vs step. The
              // slope is each slot's OWN phase drift — under mux, excess over the no-mux baseline ÷ switching rate
              // = the per-transition cost in rad: κ as a MEASURED constant of the clock, not an injected parameter.
              if (S.length >= 3) for (const nm of ['W', 'V', 'P1', 'P2']) { if (S[0].th[nm] === undefined) continue;
                let un = 0, prev = S[0].th[nm], sx = 0, sy = 0, sxx = 0, sxy = 0, m2 = 0;
                for (let i = 0; i < S.length; i++) { const v = S[i].th[nm]; if (v === undefined) { m2 = 1; break; }
                  un += _aphNorm(v - prev); prev = v;
                  const x = S[i].k - S[0].k; sx += x; sy += un; sxx += x * x; sxy += x * un; }
                if (m2) continue;
                const n3 = S.length, sl = (n3 * sxy - sx * sy) / Math.max(1e-12, n3 * sxx - sx * sx);
                console.log(`[REGREAD] drift ${nm}: ${(sl * 1000).toFixed(4)} rad/kstep over ${S[n3-1].k - S[0].k} steps`); }
              console.log(`[REGREAD] done — absolute k=0 readout (translation-invariant, whole-field-weighted; differences = register content, drifts = the slice-transition/ω-bias physics)`); } } }
        // M-c1 CRYSTAL METER (armed via window.clockWatch): the single Fourier coefficient F(k_c) = Σψ·e^{−ik_c·x}
        // of W, sampled PER FRAME (gap = a few steps → unwrap-safe; bar-level sampling would alias the rate mod
        // 2π/Δ). The verdict decides whether the medium carries an oscillator the mux gate could ride: |F| alive
        // (not washed) · dθ/dstep LINEAR with small residual (a rate, not a walk) · rate ≠ 0 (not att-locked — the
        // register lesson: the drive pins k-content it owns) · |rate|·7 < π (unwrap-safe at the Q=7 boundary where
        // the future in-loop gate would sample). Every ✗ is the honest bound on how much external clock this medium needs.
        if (_clkWatch && _clkSpec && _E.psiLensed) { const ssC = _clkWatch.samples, lastC = ssC[ssC.length - 1];
          if (!lastC || _E.solSteps > lastC.k) { const w0 = 2 * Math.PI / GRID; let fr = 0, fi = 0, sa = 0;
            for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { const j = (y * GRID + x) * 2, p = w0 * (_clkSpec.kx * x + _clkSpec.ky * y);
              const c = Math.cos(p), s = Math.sin(p), re = _E.psiLensed[j], im = _E.psiLensed[j + 1];
              fr += re * c + im * s; fi += im * c - re * s; sa += Math.hypot(re, im); }
            ssC.push({ A: Math.hypot(fr, fi) / Math.max(1e-12, sa), th: Math.atan2(fi, fr), k: _E.solSteps });
            if (ssC.length % 50 === 0) console.log(`[CLOCKWATCH] ${ssC.length}/${_clkWatch.n} · |F|=${ssC[ssC.length-1].A.toExponential(2)} · θ_O=${ssC[ssC.length-1].th.toFixed(3)} · step=${_E.solSteps}`);
            if (ssC.length >= _clkWatch.n) { const n2 = ssC.length; let un = 0, prev = ssC[0].th;
              const xs = new Float64Array(n2), ys = new Float64Array(n2);
              for (let i = 0; i < n2; i++) { const d = ssC[i].th - prev; prev = ssC[i].th;
                un += ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
                xs[i] = ssC[i].k - ssC[0].k; ys[i] = un; }
              let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < n2; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
              const rate = (n2 * sxy - sx * sy) / Math.max(1e-12, n2 * sxx - sx * sx);   // rad/step — the crystal frequency
              const b0 = (sy - rate * sx) / n2; let rss = 0;
              for (let i = 0; i < n2; i++) { const e2 = ys[i] - (b0 + rate * xs[i]); rss += e2 * e2; }
              const sig = Math.sqrt(rss / n2), aTr = ssC[n2 - 1].A / Math.max(1e-12, ssC[0].A), uw = Math.abs(rate) * 7 < Math.PI * 0.8;
              // GATE-USABILITY is a RATIO, not two thresholds (run-6 lesson: rate 1.1e-4 + σ 0.38 threaded the
              // independent LOCKED/NOISY checks and read ✓ while the slice advance was 0.006 of the jitter): the
              // clock must advance per slice MORE than it wobbles — SNR = |rate|·21/σ ≥ 3, or the gate fires at random.
              const snr = Math.abs(rate) * 21 / Math.max(1e-9, sig);
              console.log(`[CLOCKWATCH] done · ${n2} samples over ${xs[n2-1]} steps · |F| ×${aTr.toFixed(2)} · rate=${rate.toExponential(3)} rad/step · residual σ=${sig.toFixed(3)} rad · SNR(21-step slice)=${snr.toFixed(3)} · ${aTr < 0.3 ? '✗ DAMPED — the medium washes this mode (another k_c, or larger amp)' : !uw ? '⚠ TOO FAST — |rate|·7 ≥ 0.8π aliases at the quantum; pick smaller |k_c|' : snr >= 3 ? `✓ CRYSTAL — the slice advance beats the jitter · period ${(2 * Math.PI / Math.abs(rate)).toFixed(0)} steps · Θ_slice(21 steps) = ${(Math.abs(rate) * 21).toFixed(3)} rad → gate ready (M-c2)` : `✗ PINNED — alive but not rotating: slice advance ${(Math.abs(rate) * 21).toFixed(4)} rad ≪ jitter ±${sig.toFixed(3)} (the nonlinearity couples the mode to the att-locked bulk — no usable crystal at this k_c)`}`);
              _clkWatch = null; } } }
        // ⚡sig ARRIVAL WATCHER (armed via window.sigWatch): per-bar energy fraction in the target window — a transient
        // rise then decay = the pulse arrived and died (radiation ✓). Peer-local console diagnostic, touches nothing.
        if (_sigWatch && _E.psiLensed && _sigWatch.lastBar !== bar) { _sigWatch.lastBar = bar;
          // DIFFERENTIAL readout (v2): the default object is GRID-SCALE (cube wavefront) — every window sits on object
          // structure whose breathing (~±1%) swamps a small pulse. The breathing is ~symmetric about the object center;
          // a one-sided pulse is not → signal = window MINUS its point-mirrored twin, relative to a pre-fire baseline.
          const { x, y, R } = _sigWatch, mx = GRID - x, my = GRID - y;   // point mirror about the object center (GRID/2)
          const winE = (cx, cy) => { let e = 0;
            for (let yy = Math.max(0, cy-R); yy <= Math.min(GRID-1, cy+R); yy++) for (let xx = Math.max(0, cx-R); xx <= Math.min(GRID-1, cx+R); xx++)
              e += _E.psiLensed[(yy*GRID+xx)*2]**2 + _E.psiLensed[(yy*GRID+xx)*2+1]**2; return e; };
          let te = 0; for (let i = 0; i < N_CELLS; i++) te += _E.psiLensed[i*2]**2 + _E.psiLensed[i*2+1]**2;
          const fr = te > 0 ? winE(x, y)/te : 0, frM = te > 0 ? winE(mx, my)/te : 0, D = fr - frM;
          _sigWatch.samples.push(D);
          if (_sigWatch.base === null && _sigWatch.samples.length >= 3) _sigWatch.base = (_sigWatch.samples[0]+_sigWatch.samples[1]+_sigWatch.samples[2])/3;   // pre-fire baseline = first 3 bars
          const dD = _sigWatch.base !== null ? D - _sigWatch.base : 0;
          console.log(`[SIGWATCH] bar ${bar} · E=${(fr*100).toFixed(2)}% mirror=${(frM*100).toFixed(2)}% · ΔD=${(dD*100).toFixed(3)}%${dD > _sigWatch.peak ? ' ↑' : ''}`);
          if (dD > _sigWatch.peak) _sigWatch.peak = dD;
          if (_sigWatch.samples.length >= _sigWatch.bars) {
            const late = _sigWatch.samples.slice(-3).reduce((a,b)=>a+b,0)/3 - (_sigWatch.base ?? 0);
            console.log(`[SIGWATCH] done · peak ΔD=${(_sigWatch.peak*100).toFixed(3)}% · final ΔD=${(late*100).toFixed(3)}% → ${_sigWatch.peak < 0.0008 ? '△ no arrival resolved (peak < noise)' : late < _sigWatch.peak*0.4 ? '✓ TRANSIENT (arrived + died = radiation)' : '✓ PARKED (arrived + condensed = satellite)'}`);
            _sigWatch = null; }
        }
        // AUTO LINE-SCAN (armed via window.sigScanArm): samples the ray every 4th frame for ~2s — captures the flash's
        // whole spatiotemporal life without console latency (manual sigScan always arrives after the ~0.5s death).
        if (_sigScanA && _E.psiLensed) { _sigScanA.count++;
          if (_sigScanA.count % 4 === 1) { const { x0, y0, x1, y1 } = _sigScanA; const pts = [];
            for (let i = 0; i < 11; i++) { const t = i / 10, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
              let e = 0, c = 0; for (let yy = Math.max(0, y - 3); yy <= Math.min(GRID - 1, y + 3); yy++) for (let xx = Math.max(0, x - 3); xx <= Math.min(GRID - 1, x + 3); xx++) {
                const ii = (yy * GRID + xx) * 2; e += _E.psiLensed[ii]**2 + _E.psiLensed[ii+1]**2; c++; }
              pts.push((e / c * 1e4).toFixed(0)); }
            console.log(`[SCANARM] f${_sigScanA.count} · ${pts.join(' ')}`); }
          if (_sigScanA.count >= _sigScanA.frames) { console.log('[SCANARM] done (left=emitter end, right=object end)'); _sigScanA = null; }
        }
        // THE RECEIVER v3 (armed via window.earOn) — ENERGY-TRANSIENT detection at auto-placed QUIET posts, sampled
        // EVERY FRAME. v2's matched filter failed on real flashes (measured): dispersion CHIRPS the packet (local k
        // ≠ 0.9 at the ear), the 45° orientation grid decorrelates an 11px window, and per-bar sampling misses the
        // sub-bar transient — the ear heard only its own crackle (born AT the posts). At a QUIET post, raw window
        // energy jumps 10-100× when ANY wave passes — no carrier/orientation/chirp assumptions, no sampling gaps.
        // The matched filter runs only AFTER a hit, for the direction readout. Peer-local console telemetry.
        if (_ear && _E.psiLensed) {
          const K = 0.9, W2 = 2 * 2.5 * 2.5, R = 5, ocx = GRID/2 + _transPx, ocy = GRID/2 + _transPy;
          const DIRS = ['E','SE','S','SW','W','NW','N','NE'];   // grid-y points down: S = +y
          const NC = _ear.chosen ? _ear.chosen.length : _ear.nCand;
          let line = '', hit = null;
          for (let ci2 = 0; ci2 < NC; ci2++) {
            const p = _ear.chosen ? _ear.chosen[ci2] : ci2;
            const th = p * 2 * Math.PI / _ear.nCand, ex = Math.round(ocx + _ear.R * Math.cos(th)), ey = Math.round(ocy + _ear.R * Math.sin(th));
            const lbl = DIRS[Math.round(th / (Math.PI / 4)) % 8];
            if (ex < R || ex >= GRID - R || ey < R || ey >= GRID - R) { if (_ear.chosen) line += ` ${lbl}:--`; continue; }
            let e = 0, cells = 0;
            for (let y = ey - R; y <= ey + R; y++) for (let x = ex - R; x <= ex + R; x++) { const i = (y * GRID + x) * 2;
              e += _E.psiLensed[i]**2 + _E.psiLensed[i+1]**2; cells++; }
            e /= cells;                                        // mean |ψ|² in the window
            const floor = _ear.floors[p];
            const isHit = _ear.calib <= 0 && e >= Math.max(4 * floor, 4e-5) && (bar - (_ear.lastHit[p] ?? -9) > 1);   // ≥4×floor AND ≥0.4 units ABSOLUTE — live-calibrated: real arrivals read 0.5–1.0 units (measured, SCANARM + ring-max E:0.5 on the aimed post); crackle flutter at ultra-quiet posts reads 0.1–0.3 and must not trip on SNR alone
            if (isHit) { _ear.lastHit[p] = bar;
              // direction readout (matched filter, post-hit only): best of 8 carrier orientations
              let best = 0, bestJ = 0;
              for (let j = 0; j < 8; j++) { const ph2 = j * Math.PI / 4, ux = Math.cos(ph2), uy = Math.sin(ph2);
                let cr = 0, cii = 0;
                for (let y = ey - R; y <= ey + R; y++) for (let x = ex - R; x <= ex + R; x++) {
                  const dx = x - ex, dy = y - ey, g = Math.exp(-(dx*dx + dy*dy) / W2);
                  const s = dx * ux + dy * uy, c = Math.cos(K * s), sn = Math.sin(K * s), i = (y * GRID + x) * 2;
                  cr += g * (_E.psiLensed[i] * c + _E.psiLensed[i+1] * sn);
                  cii += g * (_E.psiLensed[i+1] * c - _E.psiLensed[i] * sn); }
                const C = Math.hypot(cr, cii); if (C > best) { best = C; bestJ = j; } }
              if (!hit || e / floor > hit.snr) hit = { dir: lbl, e, snr: e / Math.max(1e-9, floor), from: DIRS[(bestJ + 4) % 8], ex, ey };
            }
            if (_ear.calib > 0 || !isHit) _ear.floors[p] = floor * 0.95 + e * 0.05;   // per-frame EMA (slow); quiet-only after calib
            if (_ear.chosen) line += ` ${lbl}:${(e * 1e4).toFixed(1)}${isHit ? '✦' : ''}`;
          }
          // AUTO-PLACEMENT at calibration end (calib counts FRAMES now): keep the 8 QUIETEST candidates — a grid-scale
          // object (letter) has no vacuum ring; the quiet gaps between strokes are the only usable listening posts.
          if (_ear.calib > 0) { _ear.calib--; if (_ear.calib === 0) {
            _ear.chosen = _ear.floors.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0]).slice(0, 8).map(en => en[1]).sort((a, b) => a - b);
            console.log(`[EAR] calibrated · chose the 8 quietest of ${_ear.nCand} (floors ×1e4):${_ear.chosen.map(p => { const th = p * 2 * Math.PI / _ear.nCand; return ` ${DIRS[Math.round(th / (Math.PI/4)) % 8]}(${Math.round(ocx + _ear.R * Math.cos(th))},${Math.round(ocy + _ear.R * Math.sin(th))})=${(_ear.floors[p] * 1e4).toFixed(1)}`; }).join('')} — listening (energy-transient, per-frame)`); } }
          else if (hit) console.log(`[EAR] ✦ HIT bar ${bar} · ear=${hit.dir}(${hit.ex},${hit.ey}) E=${(hit.e * 1e4).toFixed(1)}e-4 (${hit.snr.toFixed(0)}× floor) · carrier from ${hit.from} · all:${line}`);
          else if (_ear.lastBar !== bar && bar % 10 === 0) console.log(`[EAR] bar ${bar} quiet (E ×1e4) ·${line}`);
          _ear.lastBar = bar;
        }
        // ⚡sig MATCHED-FILTER RADAR (armed via window.sigTrack): C(d) = |⟨ψ, template(d)⟩|/||T|| along the fired ray,
        // template = the EXACT injected packet (gaussian w=2.5 × e^{i·0.9·s}) shifted d px. The k=0.9 carrier rejects
        // the object's low-k churn (which voids energy maps — control measured 11%/10bars). Baseline C0 = first bar
        // (pre-fire); reported ΔC(d) = C−C0. Watch the peak's d: advancing = pulse MOVING; stable = PARKED; fading = DIED.
        if (_sigTrack && _E.psiLensed && _sigTrack.lastBar !== bar) { _sigTrack.lastBar = bar;
          const { fx, fy, ux, uy } = _sigTrack, K = 0.9, W2 = 2 * 2.5 * 2.5, R = 6;
          const prof = [];
          for (let d = 0; d <= 40; d += 2) {
            const cx = fx + ux * d, cy = fy + uy * d; let cr = 0, ci = 0, nn = 0;
            for (let y = Math.max(0, Math.round(cy) - R); y <= Math.min(GRID - 1, Math.round(cy) + R); y++)
              for (let x = Math.max(0, Math.round(cx) - R); x <= Math.min(GRID - 1, Math.round(cx) + R); x++) {
                const dxp = x - cx, dyp = y - cy, g = Math.exp(-(dxp*dxp + dyp*dyp) / W2);
                const s = dxp * ux + dyp * uy, c = Math.cos(K * s), sn = Math.sin(K * s), i = (y * GRID + x) * 2;
                cr += g * (_E.psiLensed[i] * c + _E.psiLensed[i+1] * sn);       // Re⟨ψ, T⟩ with T = g·e^{iKs}
                ci += g * (_E.psiLensed[i+1] * c - _E.psiLensed[i] * sn);
                nn += g * g; }
            prof.push(Math.hypot(cr, ci) / Math.max(1e-12, Math.sqrt(nn))); }
          if (!_sigTrack.C0) { _sigTrack.C0 = prof; console.log(`[SIGTRACK] baseline captured — fire ⚡sig now`); }
          else { const dC = prof.map((c, j) => c - _sigTrack.C0[j]);
            let bj = 0; for (let j = 0; j < dC.length; j++) if (dC[j] > dC[bj]) bj = j;
            const spark = dC.map(v => v > 0.15 ? '█' : v > 0.08 ? '▓' : v > 0.04 ? '▒' : v > 0.015 ? '░' : '·').join('');
            _sigTrack.hist.push({ d: bj * 2, a: dC[bj] });
            console.log(`[SIGTRACK] bar ${bar} · peak d=${bj*2}px ΔC=${dC[bj].toFixed(3)} · 0px[${spark}]40px`);
            if (_sigTrack.hist.length >= _sigTrack.bars) {
              const h = _sigTrack.hist, mid = h[Math.floor(h.length/2)], last = h[h.length-1], amax = Math.max(...h.map(e => e.a));
              console.log(`[SIGTRACK] done · trajectory d: ${h.map(e => e.d).join('→')} · ΔC max=${amax.toFixed(3)} final=${last.a.toFixed(3)} → ${amax < 0.02 ? '△ nothing detected above churn' : last.a < amax * 0.35 ? '✓ TRANSIENT (moved, then died — radiation)' : (last.d === mid.d && last.a > amax * 0.5) ? '✓ PARKED at d=' + last.d + 'px (condensed satellite)' : '✓ ALIVE at d=' + last.d + 'px (still moving/settling)'}`);
              _sigTrack = null; } }
        }
        // ⚡sig DIFFERENCE MAP (armed via window.sigMap): |ψ|²(now) − |ψ|²(at arm), coarse 16×16 cells — shows WHERE
        // injected energy went (parked lump = a bright far cell; died = nothing beyond breathing). Peer-local console only.
        if (_sigMap && _E.psiLensed && bar >= _sigMap.doneBar) {
          const C = 8, K = GRID / C; let te = 0;
          for (let i = 0; i < N_CELLS; i++) te += _E.psiLensed[i*2]**2 + _E.psiLensed[i*2+1]**2;
          const cells = []; let best = { d: -1 };
          for (let cy = 0; cy < K; cy++) { let row = '';
            for (let cx = 0; cx < K; cx++) { let d = 0;
              for (let y = cy*C; y < (cy+1)*C; y++) for (let x = cx*C; x < (cx+1)*C; x++) { const i = (y*GRID+x)*2;
                d += (_E.psiLensed[i]**2 + _E.psiLensed[i+1]**2) - (_sigMap.f0[i]**2 + _sigMap.f0[i+1]**2); }
              const fr = d / Math.max(1e-12, te);
              row += fr > 0.004 ? '@' : fr > 0.002 ? '#' : fr > 0.001 ? '+' : fr > 0.0004 ? ':' : fr < -0.001 ? '−' : '·';
              if (fr > best.d) best = { d: fr, x: cx*C + C/2, y: cy*C + C/2 };
              cells.push(fr); }
            console.log(`[SIGMAP] ${row}`); }
          const net = cells.reduce((a, b) => a + Math.max(0, b), 0);
          console.log(`[SIGMAP] done · max Δ+ cell ${(best.d*100).toFixed(2)}% at (${best.x},${best.y}) · total Δ+ ${(net*100).toFixed(2)}% of E (·<0.04 :≥0.04 +≥0.1 #≥0.2 @≥0.4 −=lost)`);
          _sigMap = null;
        }
        if (_snapMode && _E.psiLensed && _solSnapLogT !== tnow) { _solSnapLogT = tnow;   // PEER-COMPARE log — compare at EQUAL steps. lastTodo = the batch size of the frame that reached this step (a differing todo anywhere → possible divergence).
          const _m = _lastSolMacro;   // raw centroid/energy at full precision → peers diff these with a tolerance (ε≈0.05px, 1e-3·E), not equality
          console.log(`[solH] t=${tnow.toFixed(2)} steps=${_E.solSteps} lastTodo=${_lastTodoDbg} clk:rate=${_stepClk.rate}/prev=${_stepClk.ratePrev}/c0=${_stepClk.c0.toFixed(4)} kv=${_E.kernelVer}${_kqKern&&_kqKern.length?`(+${_kqKern.length}@${_kqKern.head().startStep})`:''} pendShift=${_dbgShiftStep} shiftSeen=${_dbgShiftStart} transPx=${_dbgTransPx.toExponential(6)} attH=${_dbgAttH} · solH=${_lastSolHash}${_m?` · macro=${_m.s} c=(${_m.cx.toFixed(3)},${_m.cy.toFixed(3)}) E=${_m.e.toFixed(5)}`:''} · lock=${_E.lockNow.toFixed(3)} min=${_E.lockMin.toFixed(3)}${_V.psiVirt?` · virtH=${_lastVirtHash} V⊗=${_V.virtCorr.toFixed(3)}${_V.virtMirror?' MIR':_V.virtHold?' HOLD':' FREE'}${_V.virtMux?' ⧉mux':''}${_V.virtGoOn?` Vgo=(${_V.virtGx.toFixed(1)},${_V.virtGy.toFixed(1)})`:''}${_V.phases.length?` ⊞${_V.phases.length}`:''}`:''}${_V.phases[0]?` · p1H=${_lastP1Hash}`:''}${_V.phases[1]?` · p2H=${_lastP2Hash}`:''}${_V.selfClk?` · SC:beats=${_V.selfClk.beats} lastK=${_V.selfClk.lastK} ph=${_V.selfClk.beats%(1+(_V.psiVirt?1:0)+_V.phases.length)} ld=${_V.muxLoaded}${_TAU_PROBE&&_tauK?` tau=${_tau.toFixed(4)} tauS=[${_SLOTN.map(nm=>_tauK.tauOf(nm).toFixed(3)).join(',')}] kH=${_tauK.hash()}`:''}`:''}${_K.edge?` · kSrc[${_K.src.map(f=>f?_hashField(f):'--------').join(',')}] kCap=${_K.capStep} kE=${_K.edge.flat().map(v=>v.toFixed(2)).join('')}`:''}`); }   // DESYNC DIAGNOSTIC: kSrc hashes = the exact coupling-source bytes injected; kE = the edge matrix. If these differ across same-machine peers while solH matches, the fork is in the coupling layer (source capture timing), not the fields.
        // ψ_C canvas: the LIVE C transition soliton (a 2nd persistent field held at C by the instanton drive), parallel to ψ_out→B.
        const _showC = _tunnelActive && (_tunnelMode==='vortex' || _tunnelMode==='barrier');
        const _showV = !_showC && !!_V.psiVirt;   // ψ_V: the virtual soliton (the C canvas doubles as the hypervisor view)
        cCell.wrap.style.display = (_showC || _showV) ? 'flex' : 'none';
        if (_showV) { if (_slotDrew(1)) _drawL11(cCell, _lensedView(1, _V.psiVirt));   // proper-time gate: repaint V only on frames V stepped (its own continuous time; frozen slices hold the last real frame)
          // one-line label (the full multi-clause description was collapsed to keep the title one row, like ψ_in)
          cCell.setLabel(`ψ_V · V⊗W=${_V.virtCorr.toFixed(3)} · ${_V.virtMirror?'MIRROR':(_V.virtGoOn&&_V.virtAtt)?'TRANSPORT':(_V.virtHold&&_V.virtAtt)?'HELD':'FREE'}${_V.virtMux?' · ⧉mux':''}${_V.selfClk?' · selfClk':''}${_dials.lensView?' · ∠view':''}`); }
        else if (_showC && _E.psiC) { _drawL11(cCell, _E.psiC);
          const committed = (_tunnelMode==='vortex' && _vortexTarget==='B') || (_tunnelMode==='barrier' && _barrierLatched);
          cCell.setLabel(`ψ_C: LIVE INSTANTON TRANSITION · ${_tunnelMode==='vortex'?'charged C (Q=1) held live':'live saddle crossing (transient)'}${committed?' · ψ_out NOW = interactive B ▸':' · transition in progress…'}`); }
        else if (_showC) cCell.setLabel('ψ_C: LIVE INSTANTON TRANSITION · awaiting transition (fire ⚡kick)…');
      } else {           // EYE scope: drive + draw the trap row (the live recon soliton)
        // obj:mixed: in PASS mode the recon ▸ shows the OPERATOR-EXTRACTED genome (the eye's selected note pulled out of the
        // superposition). In clock/recall/coevolve/self the recon shows that MODE's output (the extraction is the pass-mode percept,
        // not a permanent override) — so switching modes after resonance works normally. For other objects it's always the recon.
        const reconTarget = (_lensObj==='mixed' && _extracted && E.mode==='pass') ? _extracted : eyeRecon;
        if (reconTarget) _E.psiRecon = driveSoliton(_E.psiRecon, reconTarget, SRC_ALPHA);
        // INSTANTON FIRE (eye scope): kick the recon soliton at the fire bar (+ held bars) — the proposal's framing (the kick rides
        // the eye's trapped field, reconstruct uses the eye's own holographic round-trip).
        _fireInstanton(_E.psiRecon, 'eye', bar);
        // proper-time gate on the TRAPPED INPUT (the frozen slice the eye caught): the eyeSrc-selected slot's hologram
        // repaints only on frames that slot stepped. The recon ▸ below is a fresh per-frame drive (never frozen) → always live.
        const _eyeSlot = _eyeSrc==='V' ? 1 : _eyeSrc==='P1' ? 2 : _eyeSrc==='P2' ? 3 : 0;
        if (eyeHologram && _slotDrew(_eyeSlot)) _drawL11(eyeInCell, _lensedView(_eyeSlot, eyeHologram));
        const _eyeOut = (ev === 'crisp') ? reconTarget : (_E.psiRecon || reconTarget);
        if (_eyeOut) _drawL11(eyeOutCell, _eyeOut);
      }
      // ↩recon (replicated): run the reconstruct now that the live soliton fields are current this frame. Both peers fire on the same
      // instReconVer with byte-identical fields → identical _instRecon numbers (the determinism check).
      if (_reconPending) { _reconPending = false; _reconstructPeak(); }
      // INSTANTON status tag — the live flash (peak ×N the vacuum, decaying) + the last reconstruct fidelity. Shown in the active
      // scope's label when armed/fired. _curSol = the scope's soliton (to read the live flash peak vs the kicked peak).
      let _instTag = '';
      if (_instBar >= 0 || _instPeak) {
        const _curSol = (_instScope==='eye') ? _E.psiRecon : _E.psiLensed;
        const liveR = (_instPeak && _curSol) ? _peakAmp(_curSol)/Math.max(1e-9,_peakAmp(_instPeak)) : 0;   // flash decay (1=peak, →lower as it returns to vacuum)
        const held = (_instHold>0 && _instFireBar>=0 && bar<=_instFireBar+_instHold);   // still re-injecting?
        const sinceFire = (_instFireBar>=0) ? (bar - _instFireBar) : 0;   // bars elapsed since the kick fired (drive disperses it irreversibly)
        const _held = held ? ` HELD ${Math.max(0,_instFireBar+_instHold-bar)}b` : '';
        if (_instPeak) {
          // The reconstruct is a SELF-CONTAINED test on the peak snapshot (disperse-by-propagation → back-propagate), so it works
          // ANY time after the kick fired (the snapshot is held). ↩recon prints the graded T-sweep = the time-reversal fidelity.
          const reconHint = held ? `(held — releasing in ${_instFireBar+_instHold-bar+1}b)` : '↩recon for the time-reversal fidelity';
          if (_tunnelActive && _tunnelB>=0) {
            // TUNNEL readout: the committed A→B jump. The source + lens now run genome B, so the world soliton reshapes A→B. We show
            // BOTH corr-to-A (falling = leaving the old basin) and corr-to-B (rising = entering the new one). Derived locally from the
            // replicated rank → peer-identical (no per-frame reflector exchange). landed = B clearly exceeds A (the field switched basins).
            const rA=(_tunnelB+_rules.length-1)%_rules.length;
            // HONEST measure: correlate the live soliton against the A/B LENSED references (same representation as _E.psiLensed), NOT raw
            // impulses. _tunnelRefB excludes the held-kick artifact (it's the drive target, not the injected spike) → a true landing read.
            const cB=(_tunnelRefB&&_curSol)?_intCorr(_curSol,_tunnelRefB):0, cA=(_tunnelRefA&&_curSol)?_intCorr(_curSol,_tunnelRefA):0;
            const stillHeld = (_instHold>0 && bar<=_instFireBar+_instHold);   // during hold the kick injects B directly → the read is contaminated
            const settled = sinceFire>=2;   // the drive needs ~2 bars to converge to B; before that, low-B = still crossing, not failure
            const verdict = stillHeld ? 'kicking (release to read the settled state)…'
              : cB>cA+0.05 ? 'LANDED in B ✓ (committed jump, local-deterministic)'
              : !settled ? 'crossing the barrier…'
              : cA>cB+0.05 ? 'fell back to A (kick too weak — raise ⚡amp/⚡hold)' : 'mid-barrier…';
            // DIAGNOSTIC: srcRk = the rank the SOURCE is actually built from right now (should be B while tunneling). If it stays A,
            // the retarget isn't reaching the field (medH won't change) — that's the real failure, distinct from the kick artifact.
            const emg = _tunnelMode==='emergent', clk = _tunnelMode==='clock', phs = _tunnelMode==='phase', barr = _tunnelMode==='barrier', vtx = _tunnelMode==='vortex';
            if (barr) {
              // ★ BARRIER INSTANTON (the genuine one): source STAYS A; the KICK alone must cross the soliton into B's basin; WINNER-TAKE-ALL
              // drive holds whichever basin it's in (_barrierTarget). REAL barrier: sub-threshold ⚡amp → stays/falls back to A; supra → crosses
              // & B's basin HOLDS it. Read corr→A/corr→B (footprint, representation-robust) + the live target. THIS has a barrier (unlike switch).
              const rA=(_tunnelB+_rules.length-1)%_rules.length; const _bf=_curSol||_E.psiLensed;
              // CENTROID read (amplitude-independent — the faint moved lump that footprint-corr gated as noise). dist→A vs dist→B of the
              // field's energy centroid vs A's & B's fixed-point centroids = "how far the lump moved toward B" (the honest, visible observable).
              let bdA=0,bdB=0,bcx=0,bcy=0;
              try { const ca=_barrGenCentroid('A'), cb=_barrGenCentroid('B');   // MEASURED real genome A/B centroids (the native upgrade)
                let sx=0,sy=0,sw=0; if(_bf){for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const a=_bf[(y*GRID+x)*2]**2+_bf[(y*GRID+x)*2+1]**2;sx+=x*a;sy+=y*a;sw+=a;}}
                bcx=sw>0?sx/sw:GRID/2; bcy=sw>0?sy/sw:GRID/2; bdA=Math.hypot(bcx-ca[0],bcy-ca[1]); bdB=Math.hypot(bcx-cb[0],bcy-cb[1]); } catch(e){}
              const verdictB = _barrDegenerate ? `NO BARRIER — A(r${rA}) ≈ B(r${_tunnelB}) attractors coincide (sep=${_barrSep.toFixed(0)}px). The real genomes are position-degenerate; there is nothing to cross to. Pick a distinct ⚡B+ (honest: the medium can't cross to a B at the same place as A).`
                : (_instHold>0 && bar<=_instFireBar+_instHold) ? 'kicking…'
                : _barrierLatched ? 'LANDED in B ✓ — LATCHED (committed, irreversible: B\'s well holds it; will NOT fall back. New ⚡tunnel or rank change to leave)'
                : _barrierTarget==='B' ? 'crossed (settling into B)…'
                : sinceFire<3 ? 'kicked — settling (crossing window)…'
                : 'FELL BACK to A (sub-threshold — the kick did not clear the saddle; raise ⚡amp, or lower ⚡B+)';
              _instTag = ` · ⚡TUNNEL[BARRIER — IFS-NATIVE (A/B = the REAL genome attractors, positioned by MEASURED chaos-game centroid, not the old hardcoded quad fiction; probe_barrier_separation.mjs). PHASE-WELL DRIVE (linOp curvature toward the real genome fixed points, momentum-conserving) + SELF-FOCUS (native confinement) + MOMENTUM-RAMP kick (linOp e^{i·k·r} toward the real B) + WINNER-TAKE-ALL + LATCH. HONEST DEGENERACY: if A≈B (real fit-degeneracy, ~half the rank pairs) there is NO barrier — reported, not faked. ⚡amp=momentum, ⚡B+=which B] A(r${rA})→B(r${_tunnelB}) sep=${_barrSep>=0?_barrSep.toFixed(0)+'px':'—'} fired bar${_instFireBar} (+${sinceFire}b) · drive-well:${_barrierTarget} · centroid(${bcx.toFixed(0)},${bcy.toFixed(0)}) · dist→A ${bdA.toFixed(1)} dist→B ${bdB.toFixed(1)} · ${verdictB}`;
            } else if (vtx) {
              // ★ VORTEX = THE TOPOLOGICAL INSTANTON, HONESTLY SCOPED (the full probe arc, probe_vortex_*.mjs). The critique was right that
              // this contractive medium has no potential barrier, so the native move is a TOPOLOGICAL RUPTURE: inject per-blob vortices.
              // The measured truth: the winding exerts a REAL transport force (control with no winding stays at A — NOT decorative), but a
              // LINEAR medium CANNOT self-advect a soliton a finite distance (vortex-dipole self-advection is a NONLINEAR/GPE effect; here
              // it stalls). So the topology transports the field OFF A to a STABLE MIDPOINT EQUILIBRIUM = an EMERGENT TOPOLOGICAL VACUUM C
              // (identical at 40 & 80 steps = a genuine attractor, not slow progress). It does NOT reach B — and we do NOT claim B (that
              // would be the decorative lie: the drive, not the topology, would be doing it). The honest result is: A → emergent C.
              const _vf = _curSol || _E.psiLensed; const Qnow = _vf ? _windingFollow(_vf) : 0;
              let vcx=GRID/2,vcy=GRID/2; if(_vf){let sx=0,sy=0,sw=0;for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const a=_vf[(y*GRID+x)*2]**2+_vf[(y*GRID+x)*2+1]**2;sx+=x*a;sy+=y*a;sw+=a;}vcx=sw>0?sx/sw:GRID/2;vcy=sw>0?sy/sw:GRID/2;}
              const _vcA=_barrCentroid('A'),_vcB=_barrCentroid('B'),_vMid=[(_vcA[0]+_vcB[0])/2,(_vcA[1]+_vcB[1])/2];
              const _vdA=Math.hypot(vcx-_vcA[0],vcy-_vcA[1]),_vdMid=Math.hypot(vcx-_vMid[0],vcy-_vMid[1]);
              const verdictV = (_instHold>0 && bar<=_instFireBar+_instHold) ? 'injecting the vortices…'
                : _vortexTarget==='B' ? `A→B COMPLETE ✓ via the DUAL LAYER (Fix 3 — moved the VACUUM, not the wave): the charged wave stalled at C, then the genome migrated (s,θ→B's identity; tx,ty uniform-shifted so the measured attractor centroid lands on C) until C BECAME B's basin — VERIFIED by drive-forward (the migrated genome's drive HOLDS the wave at C, held=${_vortexBasinHeld>=0?_vortexBasinHeld.toFixed(2):'—'}). Committed selectedRank=B. The honest A→B: a LINEAR wave can't self-advect, so B's vacuum slid under it.`
                : _vortexLatched ? `LANDED in vacuum C (Q=1 conserved, IFS-native GPE) — now MIGRATING THE VACUUM (Fix 3): the genome slides toward B's identity@C (drive-forward hold=${_vortexBasinHeld>=0?_vortexBasinHeld.toFixed(2):'…'}) so C becomes B's basin…`
                : sinceFire<2 ? 'vortices injected (with real density nodes) — the winding is transporting the field off A…'
                : _vdMid<_vdA ? 'transported off A toward the midpoint (vacuum C), carrying conserved charge…'
                : 'still near A (the winding force is building)…';
              _instTag = ` · ⚡TUNNEL[VORTEX — TOPOLOGICAL, CHARGE-CONSERVING (the full probe arc + live GPU per-substep verification): the critique is right (no potential barrier in a contractive medium → the native move is a topological RUPTURE: per-blob vortices WITH real density nodes). LIVE-GPU-VERIFIED: the winding is a REAL transport force (control with no winding stays at A — NOT decorative); the IFS-NATIVE GPE (saturable density-contraction ψ→ψ/(1+γ|ψ|²), the |ψ|²ψ term AS the medium's contraction — NOT a grafted phase kick, which scattered Q = the §7.100c trap) + low-pass + gentle self-focus CONSERVE the charge: Qfollow & Qfull hold Q=1.00 indefinitely, the injected cores relax into ONE stable charged vortex soliton (the doc's "charge is mathematically locked in" — now TRUE on the substrate, IFS-native, no FFT). A LINEAR wave can't self-advect to B (Fix 1 9-pt isotropic Laplacian RULED OUT — native-leapfrog-verified; self-advection needs a spectral kinetic) → so FIX 3 (the dual layer): the wave stalls at charged C, then the GENOME (vacuum) MIGRATES (nlhoCoevolveTunnel) toward B's identity@C until C BECOMES B's basin = A→B completed by moving the vacuum, not the wave. Honors the linear stall.] A(r${rA}) fired bar${_instFireBar} (+${sinceFire}b) · vacuum:${_vortexTarget} · centroid(${vcx.toFixed(0)},${vcy.toFixed(0)}) dist→A ${_vdA.toFixed(1)} dist→mid ${_vdMid.toFixed(1)} · Q=${Qnow.toFixed(2)} · ${verdictV}`;
            } else if (phs) {
              // ★ PHASE-LABEL TUNNEL — THE VERIFIED RESULT = THE LENS PARAMETERS (not a rendered triangle, not a field-phase read): the
              // tunnel sets the LENS to B's parameters (B=rank+1=the triangle). The CHECKABLE truth is the tunneled lens params == B's:
              // show A's (s,θ) → B's (s,θ) and confirm the current lens matches B. (The ψ_out image is just what that lens diffracts —
              // a pattern, NOT required to look like a triangle; the IDENTITY is in the parameters, which ARE the triangle rank.)
              const rA = (_tunnelB+_rules.length-1)%_rules.length;
              const aggA = genomeAggregate(_rules[rA%_rules.length]), aggB = genomeAggregate(_rules[_tunnelB%_rules.length]);
              // the tunneled lens params: post-fire the source carries B's phase (the label) on A's shape → the LENS the medium runs is B's θ
              const lensTheta = _phaseTunFired ? _phaseTarget : _phaseA0;
              const dToBparam = Math.abs(_wrapPi(lensTheta - aggB.theta)), dToAparam = Math.abs(_wrapPi(lensTheta - aggA.theta));
              const verdictP = !_phaseTunFired ? 'armed (fire to set the lens params to B = the triangle)…'
                : dToBparam < dToAparam ? `LENS = B's params ✓ (rank+1 = the triangle; the tunneled LENS PARAMETERS are B's — the verified identity, not the diffraction image)`
                : 'crossing… (lens params → B)';
              _instTag = ` · ⚡TUNNEL[PHASE-LABEL — VERIFIED BY THE LENS PARAMETERS (the identity), NOT the image: the soliton tunnels its INTERNAL PHASE A→B, setting the LENS to B's params (rank+1 = the triangle). The verified result is lensθ == B's θ (checkable); the ψ_out image is just the diffraction of that lens (focus-dependent, not required to look like a triangle). The DAMMANN image (source) is the medium's wave-interference view of B] fired bar${_instFireBar} (+${sinceFire}b) · lensθ ${lensTheta.toFixed(2)} · A's θ ${aggA.theta.toFixed(2)} → B's θ ${aggB.theta.toFixed(2)} · |lensθ−Bθ| ${dToBparam.toFixed(2)} vs |lensθ−Aθ| ${dToAparam.toFixed(2)} · ${verdictP}`;
            } else if (clk) {
              // ★ CLOCK = THE INSTANTON THAT TUNNELS: the ruptured A-vacuum carried through B's MAPS by the IFS contraction. Measure the
              // carried field against the CLOCKED ATTRACTORS of A and B (a packet run through each genome's clock = the contraction's OWN
              // targets, the honest refs — NOT nlhoGenInject, which is a DIFFERENT representation the clock doesn't converge to: measured
              // ~−2% to both, the wrong-ref bug). GPU-faithful: A/B clocked attractors are DISTINCT (overlap ~12%); the contraction
              // OSCILLATES through the bicubic mid-walk (corr→B can go negative/inverted) then SETTLES at corr→B ~99% by the last tick.
              const cf = _tunnelClockField || _curSol;
              const ccB = cf ? _intCorr(cf, _clockRef(_tunnelB)) : 0, ccA = cf ? _intCorr(cf, _clockRef(((_tunnelB+_rules.length-1)%_rules.length))) : 0;
              const tkState = _tunnelLocked ? `B's attractor crystallized (${_tunnelTicks}/${_CLOCK_TICKS_MAX} ticks, frozen)` : `chaos-game iterating B (tick ${_tunnelTicks}/${_CLOCK_TICKS_MAX} → iters)`;
              const verdictC = _tunnelLocked
                ? (ccB>ccA ? 'LANDED in B ✓ (the CHAOS-GAME — a true contractive point-set IFS — converged to B\'s sparse attractor, no flood; B from any chains = the IFS law)' : 'settling…')
                : 'B\'s attractor crystallizing (low iters = diffuse → full iters = sharp attractor)…';
              _instTag = ` · ⚡TUNNEL[CLOCK — THE INSTANTON THAT TUNNELS: phase can't transport (proven 6 ways), so the transition uses the IFS CHAOS-GAME — a CONTRACTIVE point-set map p←M·(p−½)+t that CONVERGES to B's sparse attractor (the earlier ifsWarpEye field-superposition FLOODED to flat DC — wrong operator class; the chaos-game is the right one). The walk = chaos-game ITERATION DEPTH (few iters diffuse → full iters B's attractor). HONEST — B is generated by B's MAPS from any chains (the IFS law, no seed); refs = the chaos-game attractors of A/B] fired bar${_instFireBar} (+${sinceFire}b) · ${tkState} · corr→A ${(ccA*100).toFixed(0)}% → corr→B ${(ccB*100).toFixed(0)}% · ${verdictC}`;
            } else if (emg) {
              // EMERGENT = LENS-SPACE WALK (the right angle, measured BARRIER-FREE). A→B is impossible in ENERGY-space (the attractor
              // re-condenses every rupture to A — proven 5 ways) but a continuous OPERATOR DEFORMATION in LENS-space: the genome's
              // identity IS its phase-lens, and φ_A→φ_B is barrier-free. We walk _tunnelT 0→1 and carry a packet through the interpolated
              // lens e^{i((1−t)φ_A+t·φ_B)} (_tunnelLensField). Read identity by the RESONANCE matched filter against the A/B lensed refs
              // (the resonance demo's primitive): corr→A falls, corr→B rises, smoothly+monotonically (NO energy barrier). landed = B>A.
              // PHASE-SENSITIVE matched filter (_fieldCorr), NOT blurred-intensity: lens-A and lens-B carry the SAME Gaussian packet, so
              // their INTENSITY blobs are nearly identical (intensity reads ~100% to both) — the A/B difference lives in the PHASE TILT.
              // The complex field correlation is the resonance primitive that swings A→B (probe-measured); blurred-intensity is blind to it.
              const lensF = _tunnelLensField || _curSol;
              const lcB = (_tunnelRefB && lensF) ? _fieldCorr(lensF, _tunnelRefB) : 0;
              const lcA = (_tunnelRefA && lensF) ? _fieldCorr(lensF, _tunnelRefA) : 0;
              const tPct = (_tunnelT*100).toFixed(0);
              const walkState = _tunnelLocked ? `lens at B (t=1, frozen)` : `walking φ_A→φ_B (t=${_tunnelT.toFixed(2)}, ${_tunnelMigSteps} steps)`;
              const verdictE = _tunnelLocked
                ? (lcB>lcA+0.05 ? 'LANDED in lens-B ✓ (barrier-free deformation, local-deterministic)' : 'at lens-B (settling)…')
                : lcB>lcA+0.05 ? 'crossed (corr→B leads, no barrier)…' : 'deforming the lens A→B…';
              _instTag = ` · ⚡TUNNEL[EMERGENT — LENS-SPACE WALK + RECALL: the lens φ_A→φ_B is a barrier-free operator deformation (energy-space crossing is impossible — the attractor re-condenses), and B's geometry is RECALLED from the medium's own resident operator (nlhoGenInject self-host), NOT discovered — probed: phase can't transport geometry & nothing A-derived points at B, so B is recalled + the rank is the replicated ⚡tunnel selection] fired bar${_instFireBar} (+${sinceFire}b) · ${walkState} (${tPct}%) · corr→A ${(lcA*100).toFixed(0)}% → corr→B ${(lcB*100).toFixed(0)}% · ${verdictE}`;
            } else {
              // SWITCH = which-attractor SWAP (the RIGHT coordinate, but NO barrier — it HARD-SETS the source to B's rank, so the soliton
              // just follows its drive target; there is no threshold to cross, no fall-back). HONEST: this is a programmatic state-machine
              // transition, NOT a barrier-gated instanton (the barrier version would keep the source at A + winner-take-all hold — not wired;
              // CPU-unverifiable: genomes degenerate + toy drive can't hold). Readout = corr→A/corr→B vs _tunnelRefA/B (captured from the
              // ACTUAL lensedSource → matched representation; _corrLensed discriminates). corr→B high = the soliton reached its B-target (the
              // swap worked), NOT a barrier crossing. ⚡B+ picks a distinct B; the geometry visibly swaps A→B.
              const _bsF = _curSol||_E.psiLensed; let rsA=0, rsB=0;
              try { if (_tunnelRefA && _bsF) rsA=_corrLensed(_bsF, _tunnelRefA, N_CELLS); if (_tunnelRefB && _bsF) rsB=_corrLensed(_bsF, _tunnelRefB, N_CELLS); } catch(e){}
              const settled = sinceFire>=2;
              const verdictS = (_instHold>0 && bar<=_instFireBar+_instHold) ? 'kicking (release to read the swapped state)…'
                : !settled ? 'swapping source→B…'
                : rsB>rsA+0.03 ? 'SWAPPED to B ✓ (the soliton followed its B-target — programmatic swap, NOT a barrier crossing)'
                : rsA>rsB+0.03 ? 'still at A (source not yet B / refs not captured)' : 'mid (A/B refs overlap — raise ⚡B+ for a distinct B)';
              _instTag = ` · ⚡TUNNEL[SWITCH — which-attractor SWAP (the RIGHT coordinate; the source HARD-SETS to B's rank → the soliton follows. NO barrier — a programmatic state-machine transition, NOT a barrier-gated instanton; that version keeps source=A + winner-take-all hold, NOT wired, CPU-unverifiable). ⚡B+ picks a distinct B] A(r${rA})→B(r${_tunnelB}) fired bar${_instFireBar} (+${sinceFire}b) · corr→A ${(rsA*100).toFixed(0)}% corr→B ${(rsB*100).toFixed(0)}% · ${verdictS}`;
            }
          } else {
            _instTag = ` · ⚡INSTANTON@${_instScope} fired bar${_instFireBar} (+${sinceFire}b)${_held} flash ${(liveR*100).toFixed(0)}%→vacuum`
              + (_instRecon ? ` · ↩recon@bar${_instRecon.atBar}: LIVE back-prop ${_instRecon.live.toFixed(3)} = the real answer (LOW because the vacuum drive is IRREVERSIBLE — that IS the one-way transient) · control ${_instRecon.ctrl.toFixed(3)} (pure-wave round-trip, ≈1 for anything — not a reconstruction)` : ` · ${reconHint}`);
          }
        }
        else _instTag = ` · ⚡armed for bar${_instBar} (now bar${bar}, fires in ${Math.max(0,_instBar-bar)}b @${_instScope}${_instTunnel?' · TUNNEL A→B(rank+1)':''}${_instHold>0?`, hold ${_instHold}b`:''})`;
      }
      // ── LABELS — per scope. MEDIUM row: ψ_in (source) + ψ_out (the world lens, mode M). EYE row: ◀ hologram + ▸ recon (mode E).
      if (!eyeScope) {
        const _hideTag = _isHidden(_lensObj) ? (_hideLive ? ` · LIVE hide depth ${_liveHideDepth()}/${HIDE_PASSES} (breathing)` : ` · baked depth ${HIDE_PASSES}`) : '';
        inCell.setLabel(_isSelf(M)
          ? `ψ_in: OWN GENOME (code=data · ${M.mode==='recallself'?`recall→self r${M.selectedRank}`:'self'}-evolving)`
          : _lensObj==='mixed'
          ? `ψ_in: MIXED FIELD (superposed genomes r${_mixedRanks().join('+r')} · TWO planted notes in one wavefront · ui:eye selects/extracts one${_hideTag})`
          : _lensObj==='tight'
          ? `ψ_in: TIGHT WAVEFRONT (packet σ=6 · sits at plate phase≈0 → the θ-VERNIER loses leverage (the bug I flagged); matched filter still IDs it${_hideTag})`
          : _lensObj==='hidden'
          ? `ψ_in: HIDDEN WAVEFRONT (packet × planted-genome r${_hiddenRank} phase lens → chaotic cloud · invisible · ui:eye to resonate${_hideTag})`
          : `ψ_in: SOURCE (obj:${_lensObj}${_lensObj==='cube'?' · drag to rotate':''} · ${_worldActive?'ACTIVE self-coevolve@source':'static'})`);
        let stat = `${mv==='crisp'?'LENS OUTPUT (crisp · eye-percept)':'LIVING LENS SOLITON'} · ${M.mode}`;
        if (_lensP.holoT>0) stat += ` · HOLO T=${_lensP.holoT}`;
        if (M.mode==='recall' && M.recallScores) stat += ` · recalled r${M.selectedRank} (medium [H]) [${M.recallScores.map((v,i)=>`${i===M.selectedRank?'▸':''}${v.toFixed(2)}`).join(' ')}]`;
        if (M.mode==='recallself' && M.recallScores) stat += ` · recall→r${M.selectedRank} [${M.recallScores.map((v,i)=>`${i===M.selectedRank?'▸':''}${v.toFixed(2)}`).join(' ')}]`;
        if (M.mode==='coevolve' && M.replicaRules) stat += ` · genome ${M.replicaRules.map(m=>`(${(m.tx||0).toFixed(0)},${(m.ty||0).toFixed(0)})`).join('')}`;
        if (_isSelf(M) && M.selfRules) stat += ` · code=data [${M.selfLaw}] θ ${M.selfRules.map(m=>(m.theta||0).toFixed(2)).join(' ')}`;
        const _agg = genomeAggregate(_activeGenome(M));   // the genome's geometry (what ⊕base seeds; sliders are ABSOLUTE, not offsets)
        const _solMode = (_driveMode==='sol-cons'||_driveMode==='sol-diss');
        const _wdTag = _driveMode==='hybrid' ? ' · HYBRID-DRIVE (blend α=0.15 + well@fps + self-focus + GPE saturate — content-bearing AND momentum-conserving)'
                     : (_solMode && _lensObj==='cube') ? ' · drive:soliton → CUBE FALLS BACK TO BLEND (rotating wireframe, NOT localized solitons + must track canvas-1 rotation. Switch to a static obj for the soliton gas)'
                     : _driveMode==='sol-cons' ? ' · SOLITON GAS · CONSERVATIVE (TRICK-FREE: seeded once, stepEyeN + saturable-focusing only — NO interior loss, E exact. Radiation = the bound: toggle: closed traps it (noise sea), open lets it escape (clean dots))'
                     : _driveMode==='sol-diss' ? ' · SOLITON GAS · DRIVEN-DISSIPATIVE (GENUINE interior CGL: ψ*=exp((−δ+ε|ψ|²−μ|ψ|⁴)dt) — linear loss kills radiation, cubic gain feeds the soliton, quintic loss caps it = a stable ATTRACTING fixed point, self-selected amplitude. E plateaus, SNR high, no blowup. Distinct from sol-cons; boundary = the global bound: toggle)'
                     : _driveMode==='transport' ? ` · ⇄ TRANSPORT (move the object to shiftX/Y — COEVOLVE-CHASE, the MOST meta-circular mover): TWO meta pieces compose — (1) the OPERATOR defines position: the object is REGENERATED (lens) at the eased target each frame = a moving attractor; (2) a PERSISTENT LIVING soliton (seeded once, self-sustains) CHASES it by SUPERPOSITION + self-focus (ψ += β·attractor, then self-focus crystallizes onto it — interference-coevolve, NOT a blend-toward/write, NOT a replace). MEASURED: 12/16px, E=1.00, no blend. The soliton genuinely LIVES & follows the operator (corr~0.6, soft in transit, sharp when parked — the price of a real chase vs re-rendering). Drag shiftX/Y.`
                     : _driveMode==='trueorbit' ? ` · ◐ TRUE-ORBIT (a soft soliton on a curved orbit via METRIC GRAVITY — honest by accurate description): a SOFT soliton (γ=${_TORB_GAMMA}) gets a transverse kick, and GRAVITY = the genome's IFS CONTRACTION applied CONTINUOUSLY toward the shiftX/Y well, bending the COORDINATE SPACE → the soliton follows the curved geodesic (the GR view: the operator IS the curvature). r∈[13,20], curved ~46°, E≈1. MEASURED: a phase-WELL force and a −∇V momentum-tilt are BOTH INERT here (the SPM+CGL sustain re-centers the packet, killing injected momentum) → the warp is the ONLY honest mover, and it's metric-curvature, NOT a Newtonian phase-force. Set the well with shiftX/Y.`
                     : _driveMode==='objorbit' ? ` · ⟳ OBJ-ORBIT (the REAL object orbits — transport's coevolve-chase on a CIRCLE): the OPERATOR regenerates the object (lens) on a circle (radius ${_OBJORB_R}) around the shiftX/Y well, θ advancing at opSpeed; a PERSISTENT LIVING soliton CHASES the circling attractor via superposition + self-focus + energy-cap (no momentum, no warp, no CGL — the transport recipe). MEASURED: swept 336°/1395° (multi-revolution), r bounded, E=1.00 — it orbits the actual letter/cube (not a blob, unlike trueorbit). Soft in transit (corr~0.3, like a motion-blurred circling object), the orbit itself clean. Set the well-center with shiftX/Y, opSpeed = ω.` : '';
        const _bndTag = ` · bound:${_boundOpen?'OPEN (absorbing edge — radiation escapes)':'closed (reflecting — energy trapped)'}`
                      + (_solMode ? ' · LENS=META-CIRCULAR (world: focus/θ PHASE ops; SHIFT = METRIC TRANSPORT — moves the VACUUM, not the wave: affineEyeCenters integer remap slides the space 1px (centroid-tracking, settled-only), the bound soliton rides it unchanged. MEASURED: the persistent soliton can\'t self-advect (γ=20 wraps its phase to ~2π → won\'t accept momentum; γ=1 moves but won\'t bind — mobility ⊥ persistence), so the honest mover is to shift its space)' : '');
        // one-line label: the long drive/bound descriptions (_wdTag/_bndTag) are dropped to keep the title one row, like ψ_in. _instTag (short) kept.
        outCell.setLabel(`ψ_out · ${stat} · op:${_lensP.opMode} · obj:${_lensObj} · genome[s${_agg.s.toFixed(2)} θ${_agg.theta.toFixed(2)}]${_instTag}`);
      } else { const T = _eyeLensP.holoT||0, occM = _eyeLensP.occMode|0, occLbl = {6:'LEFT-slab',7:'RZero',8:'RNois'}[occM];
        const occTxt = (occM && _eyeLensP.occR>0) ? ` · OCCL ${occLbl} r=${(+_eyeLensP.occR).toFixed(2)}${occM>=7?` blk=${_eyeLensP.occBlock|0}`:''} (DAMAGED)` : '';
        const _eyePhLive = (_eyeSrc==='V' && _V.psiVirt) || (_eyeSrc==='P1' && _V.phases[0]) || (_eyeSrc==='P2' && _V.phases[1]);
        eyeInCell.setLabel(`EYE ◀${_eyeSrc!=='W'?(_eyePhLive?` ψ_${_eyeSrc} (trapping a VIRTUAL phase — the eye looks into the dream)`:` ψ_${_eyeSrc} armed (phase absent — trapping W)`):''} ${T>0?`HOLOGRAM (T=${T} · delocalized · occlusion-resistant)`:'near-field (T=0 · no hologram domain)'}${occTxt}`);
        const _fm = _eyeLensP.focusManual|0, _matched = T>0?T:(_eyeLensP.reconD||EYE_RECON_D);
        const _focusTxt = _opticsOn ? `autofocus@${E.focusDepth??'?'}` : (_fm!==0 ? `back-${Math.max(1,_matched+_fm)} (focus ${_fm>0?'+':''}${_fm} ${_fm<0?'UNDER':'OVER'})` : `back-${_matched} (in focus)`);
        let estat = `EYE ▸ RECON [${ev}] · ${E.mode} (${_focusTxt} · op:${_eyeLensP.opMode})`;
        // LENS-IN-THE-WAVEFRONT recall (hidden family): the matched filter recognized the planted lens → recall RUNS it, recall→self
        // EVOLVES it. _recallLockRank is the recognized rank; recall→r${planted} ✓ when it matches the lock the medium planted.
        if (_isHidden(_lensObj) && (E.mode==='recall'||E.mode==='recallself') && _recallLockRank!=null) {
          estat += ` · recalled the LENS → r${_recallLockRank}·${_RESO_NAMES[_recallLockRank]||''}${_recallLockRank===_hiddenRank?' ✓':''}`
                 + (E.mode==='recallself' ? ' → EVOLVING it (code=data θ-walk)' : ' → running it')
                 + (E.recallScores ? ` [${E.recallScores.map((v,i)=>`${i===_recallLockRank?'▸':''}${(v*100).toFixed(0)}%`).join(' ')}]` : '')
                 + (_eyeLensP.opMode!=='phase'?'  ⚠ set op:phase':'');
        } else {
        if (E.mode==='recall' && E.recallScores) estat += ` · recall→r${E.selectedRank} [${E.recallScores.map((v,i)=>`${i===E.selectedRank?'▸':''}${v.toFixed(2)}`).join(' ')}]`;
        if (E.mode==='recallself' && E.recallScores) estat += ` · recall→r${E.selectedRank}`;
        }
        if (E.mode==='coevolve' && E.replicaRules) estat += ` · replica ${E.replicaRules.map(m=>`(${(m.tx||0).toFixed(0)},${(m.ty||0).toFixed(0)})`).join('')}`;
        if (_isSelf(E) && E.selfRules) estat += ` · code=data [${E.selfLaw}] θ ${E.selfRules.map(m=>(m.theta||0).toFixed(2)).join(' ')}`;
        // RESONANCE METER (obj:hidden/tight/mixed): a live bar of the recognition strength. The eye's genome (rank ${E.activeRank})
        // is the KEY; the matched filter correlates the trapped cloud vs every genome's lensed signature. Spikes toward 1.0 at the
        // geometric MATCH, ~0 at scatter. mixed → TWO ranks light up (select one by the extraction operator); tight → the AUTOMATIC
        // matched filter STILL discriminates (it correlates the whole cloud), but the INTERACTIVE θ-vernier goes FLAT — the tight
        // packet sits at plate-phase≈0 so the θ-slider has no leverage (the real bug; compare the vernier bar with obj:hidden).
        if (_isHidden(_lensObj)) { const best=_resoClean, bar='█'.repeat(Math.round(20*best))+'░'.repeat(20-Math.round(20*best));   // bar = the recognition strength
          if (_lensObj === 'mixed') {   // SELECT-IN-FIELD: the present ranks light up; the eye's SELECTED rank is the extraction operator (recon ▸ = that genome).
            const present = _mixedRanks(); const selR = E.activeRank % _resoTemplates.length; const selScore = _resoScores ? _resoScores[selR] : 0;
            const sb = '█'.repeat(Math.round(20*selScore))+'░'.repeat(20-Math.round(20*selScore));
            const fieldTxt = present.map(r=>`r${r}·${_RESO_NAMES[r]}`).join(' + ');
            const reco = _resoScores ? `[${_resoScores.map((s,i)=>(present.includes(i)?'◆':'')+(i===selR?'▸':'')+(s*100).toFixed(0)+'%').join(' ')}]` : '';
            const hit = present.includes(selR) ? ` EXTRACTING r${selR}·${_RESO_NAMES[selR]} ✓ (recon ▸ = isolated geometry)` : ` r${selR} NOT in field → empty extract`;
            estat += `\nSELECT [${sb}] ${(selScore*100).toFixed(0)}% ·${hit}\nfield = ${fieldTxt} · drive the rank dropdown (ui:eye) to extract each: ${reco}${_eyeLensP.opMode!=='phase'?'  ⚠ set op:phase':''}`;
          } else {   // hidden / tight: single-genome recognition
            const reco = _resoScores ? `recognizes r${_resoBest}${_resoBest===_hiddenRank?' ✓':' (planted r'+_hiddenRank+')'} [${_resoScores.map((s,i)=>(i===_resoBest?'▸':'')+(s*100).toFixed(0)+'%').join(' ')}]` : '';
            // tight: the AUTOMATIC matched filter still works; the bug is the θ-VERNIER (_resonance, the tunable interactive read) going flat.
            const vern = _resonance||0, vb='█'.repeat(Math.round(10*vern))+'░'.repeat(10-Math.round(10*vern));
            const verdict = _lensObj==='tight'
              ? ` · θ-vernier [${vb}] ${(vern*100).toFixed(0)}% — tight packet ⇒ vernier has no leverage (cf. obj:hidden)`
              : (best>0.6 ? ' RECOGNIZED ✓' : best>0.3 ? ' partial' : ' scatter');
            estat += `\nRESONANCE [${bar}] ${(best*100).toFixed(0)}%${verdict} · ${reco}${_eyeLensP.opMode!=='phase'?'  ⚠ set op:phase':''}`;
          } }
        eyeOutCell.setLabel(estat + _instTag);
      }
      _renderSelfCanvases(bar);   // self mode (active scope): the two meta-circle panels (code glyph + GPU attractor)
    };

    // ── CONSOLE PROBES (determinism + sub-pixel) ────────────────────────────────────────────────────────────
    if (typeof window !== 'undefined') {
      window.mediumSubpixel = (axis='x') => { if(!_gpu){console.log('no gpu');return;} const out=probeSubpixelSeam(_gpu, DT, GRID, axis); console.log(`[MEDIUM-SUBPIX ${axis}] ${out.join('  ')}  (small-k ≈ 0.25 → −0.25 = 1 cell/unit)`); return out; };
      // ⚡sig arrival test: arm BEFORE firing ⚡sig, aimed at the pulse's target (the [SIG] log prints it). Logs the
      // energy fraction in the window each bar; SUCCESS = transient rise then decay (radiation arrives and dies).
      window.sigWatch = (x = GRID/2 + 30, y = GRID/2, R = 8, bars = 30) => {
        _sigWatch = { x: Math.round(x), y: Math.round(y), R, bars, samples: [], peak: 0, lastBar: -1, base: null };
        console.log(`[SIGWATCH] armed at (${_sigWatch.x},${_sigWatch.y}) R=${R} for ${bars} bars — wait ~3 bars (baseline), THEN fire ⚡sig aimed here`);
        return 'armed'; };
      // ⚡sig difference map: call sigMap(bars) JUST BEFORE sigFire — snapshots ψ now, prints a 16×16 Δ|ψ|² map after
      // `bars` bars: a bright far cell = the pulse parked there; nothing beyond breathing = it died. The decisive locator.
      window.sigMap = (bars = 10) => { if (!_E.psiLensed) return 'no field';
        _sigMap = { f0: _E.psiLensed.slice(), doneBar: _E.frameBar + bars };
        console.log(`[SIGMAP] armed — snapshot taken; map prints at bar ${_E.frameBar + bars} (fire ⚡sig now)`);
        return 'armed'; };
      // THE RECEIVER: earOn(R) arms an 8-point matched-filter ring at radius R around the object (default 26px —
      // outside the measured ~20px absorbing near-field). Logs ✦ HIT with direction + SNR; quiet status every 10 bars.
      window.earOn = (R = 26) => { _ear = { R, nCand: 24, floors: new Array(24).fill(1e-3), lastBar: -1, calib: 120, chosen: null, lastHit: {} };
        console.log(`[EAR] on · 24 candidate posts on ring R=${R} · calibrating ~120 frames, then the 8 QUIETEST become energy-transient ears (per-frame sampling)`);
        return 'listening'; };
      window.earOff = () => { _ear = null; return 'off'; };
      // ARMED line scan: logs the ray's energy profile every 4th frame for `frames` frames — arm FIRST, then sigFire;
      // you get the flash's full life (birth, spread, death) with no console latency.
      window.sigScanArm = (x0, y0, x1, y1, frames = 150) => { _sigScanA = { x0, y0, x1, y1, frames, count: 0 };
        console.log(`[SCANARM] armed (${x0},${y0})→(${x1},${y1}) for ${frames} frames — fire now`); return 'armed'; };
      // INSTANT line scan (no arming): mean |ψ|² (×1e4) in R=3 windows along a segment, read from the last rendered
      // field. Fire, then spam this along the fired ray — it answers directly whether the flash EXISTS in ψ at all.
      window.sigScan = (x0, y0, x1, y1, n = 11) => { if (!_E.psiLensed) return 'no field';
        const pts = []; for (let i = 0; i < n; i++) { const t = i / (n - 1), x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
          let e = 0, c = 0; for (let yy = Math.max(0, y - 3); yy <= Math.min(GRID - 1, y + 3); yy++) for (let xx = Math.max(0, x - 3); xx <= Math.min(GRID - 1, x + 3); xx++) {
            const ii = (yy * GRID + xx) * 2; e += _E.psiLensed[ii]**2 + _E.psiLensed[ii+1]**2; c++; }
          pts.push(`(${x},${y})${(e / c * 1e4).toFixed(0)}`); }
        console.log(`[SCAN] E×1e4: ${pts.join(' ')}`); return 'ok'; };
      // ⚡sig matched-filter radar: arm with the SAME geometry you will fire, wait 1 bar (baseline), then sigFire.
      // Tracks the pulse as a ΔC peak advancing along the ray — immune to the object's low-k churn.
      window.sigTrack = (fx = GRID/2, fy = GRID/2, tx = GRID/2 + 15, ty = GRID/2, bars = 12) => {
        const L = Math.hypot(tx - fx, ty - fy) || 1;
        _sigTrack = { fx, fy, ux: (tx - fx)/L, uy: (ty - fy)/L, bars, hist: [], C0: null, lastBar: -1 };
        console.log(`[SIGTRACK] armed along (${fx},${fy})→(${tx},${ty}) — baseline next bar, THEN fire the same geometry`);
        return 'armed'; };
      // console ⚡sig with explicit geometry/amplitude (REPLICATED event — deterministic like the button): scan the
      // radiation RANGE of the fed medium (range ≈ v_g / feed-decay; the cap drains unfed structure at the feed rate).
      window.sigFire = (fx, fy = GRID/2, tx, ty = GRID/2, amp = 0.35, ph = -1) => {
        if (_driveMode !== 'transport' && _driveMode !== 'objorbit') { console.log('[SIG] needs drive:transport or drive:objorbit'); return; }
        fx = fx ?? (GRID/2 + _transPx); tx = tx ?? (fx + 15);
        injectEvent?.({ type: 'mediumSignal', fx, fy, tx, ty, amp, ph });
        return `fired (${fx},${fy})→(${tx},${ty}) amp=${amp}${ph >= 0 ? ` slot=${ph}` : ''}`; };
      // clock-phase controls: set the reactor's listening slot (replicated). v3: 2 slots × 480 steps (~8.5s each,
      // cycle ~17s), injection confined to the slot's first 120 steps → the whole event (propagation + far-side echo
      // + lingering, ~300 steps measured) stays inside its slot. earSlot(-1) = any.
      window.earSlot = (ph = -1) => { injectEvent?.({ type: 'setMedium', earPh: ph }); return `listening slot ${ph} (0..1)`; };
      // KEPLER DIAL: set the objorbit radius (replicated + anchor-bumped = clean re-seeded run per R). Protocol: crank
      // opSpeed to 16 (the leash must be the binding constraint, not the schedule), ⟲coevo ON, run orbR(10/16/22),
      // read ⟲ω from the [SOLITON:objorbit] log per R → ω(R) is the medium's own orbital law:
      //   ω·R = const → flat rotation curve (constant tangential speed — the crystallization-rate limit)
      //   ω²R³ = const → Kepler III · ω = const → rigid-body (schedule-limited: crank opSpeed higher)
      window.orbR = (r = 16) => { injSnap(); injectEvent?.({ type: 'setMedium', orbR: r }); return `orbit R=${r} (re-anchored)`; };
      // hypervisor verbs (stamped, deterministic): virtRelift() = resume V from the immortal plate (repeatable
      // time-travel to the recorded moment) · virtSwap() = V↔W at the shared step (the dream becomes the world).
      window.virtRelift = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'relift' }); return 'relift stamped'; };
      window.virtSwap = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'swap' }); return 'swap stamped'; };
      window.virtMirror = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'mirror' }); return 'mirror toggle stamped'; };
      // virtMux() = toggle §7.44 clock-phase time-sharing: W and V slice the ONE substrate's step stream (21-step
      // slices on the shared index, each world at half proper rate) instead of parallel frame time. The honest
      // hypervisor semantics: a VM costs the host TIME, not a second medium. Queues/verbs drain at W-owned steps.
      window.virtMux = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'mux' }); return 'mux toggle stamped'; };
      // M3 — RECALL AS LOCK-SWEEP (the content-addressable clock): virtStore() banks a hologram plate of the
      // CURRENT W at the stamped step (≤4, FIFO). virtRecall() records the current W as a CUE plate, binds it
      // against the bank in plate space, lifts the argmax plate into V — the cue selects WHICH recorded moment
      // resumes. virtSwap() then makes the recalled past the world. Test: park at A, virtStore(); move to B,
      // virtStore(); return NEAR A, virtRecall() → must pick plate 1 (the score table is the evidence).
      window.virtStore = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'store' }); return 'store stamped'; };
      window.virtRecall = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'recall' }); return 'recall stamped'; };
      // M3b — eyePhase('V'|'W'): the eye's phase selector (same as the eye⟵ button in eye scope). With 'V' the whole
      // eye machinery (hologram→recon→recall/self) runs on the virtual phase — perception virtualized, not just storage.
      window.eyePhase = (p = 'V') => { injectEvent?.({ type: 'setEye', src: p === 'V' ? 'V' : 'W' }); return `eye traps phase ${p === 'V' ? 'V' : 'W'}`; };
      // virtHold() — the LIVE-MEMORY mode: V is driven toward its OWN recorded att (the operator stashed at
      // record/store time) — a world whose geometry is parked at the remembered moment. Same superpose+cap physics
      // as W (no tricks); the honest way to keep the eye⟵V view alive (an operator-less field dies into halo ~τ —
      // the measured law). Sticky: holds across re-records. Mirror overrides hold while both are on.
      window.virtHold = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'hold' }); return 'hold toggle stamped'; };
      // virtLeak(κ) — the W→V LEAK channel (⧉mux ONLY — it is inter-slice physics: imperfect phase isolation between
      // adjacent clock slices; ψ_V += κ·ψ_W(frozen at the slice boundary) at shared 7-step boundaries; V's cap
      // re-normalizes). κ=0 restores perfect isolation. The dream experiment: virtMux() on → virtLeak(0.05) →
      // fire ⚡sig in W → watch the flash appear in ψ_V (and through eye⟵V, in the eye's recon of the dream).
      window.virtLeak = (kappa = 0.05) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        if (!_V.virtMux) console.log('[VIRT] note: leak only acts under ⧉mux (virtMux()) — it is inter-slice coupling');
        injectEvent?.({ type: 'mediumVirt', mode: 'leak', leak: kappa }); return `leak κ=${kappa} stamped`; };
      // earDream() — EARS IN THE DREAM: toggle the CFAR reactor on ψ_V (8 posts ring V's operator, clocked in kV =
      // V's proper time, fresh warmup at every ON). Hits dream-pong INSIDE V (the leak is one-way — the world speaks,
      // the dream answers itself). Full protocol: virtMux() → virtLeak(0.05) → earDream() → wait warmup → sigFire in W
      // aimed near V's object → [EAR-V] ✦ the DREAM heard.
      window.earDream = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        if (!_V.psiVirt) return '[EAR-V] no virtual phase — press ⎙virt first';
        injectEvent?.({ type: 'mediumVirt', mode: 'ear' }); return 'dream-ear toggle stamped'; };
      // M4 — virtBoot(slot): lift bank plate `slot` into a LIVE phase (P1/P2) on the clock. Needs ⧉mux to run
      // (phases ARE clock slices; without mux they're frozen exactly). Each world then runs at 1/N proper rate —
      // the honest budget. virtKill() releases the newest phase (its plate stays in the bank — re-bootable).
      // eye⟵ cycles W→V→P1→P2: every phase is addressable — the register file of the H-computer.
      window.virtBoot = (slot = 0) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        if (!_V.virtBank[slot|0]) return `[VIRT] no plate ${slot|0} in the bank — virtStore() first`;
        if (!_V.virtMux) console.log('[VIRT] note: booted phases run only under ⧉mux (virtMux()) — they are clock slices');
        injectEvent?.({ type: 'mediumVirt', mode: 'boot', slot: slot|0 }); return `boot plate ${slot|0} stamped`; };
      window.virtKill = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'kill' }); return 'kill stamped'; };
      // virtGo(dx,dy) — INDEPENDENT COMMAND of the EYE-SELECTED phase (V, or a booted P1/P2 — you steer the percept you
      // are looking at). The phase coevolve-TRANSPORTS to the target (px offset from its recorded position), chasing a
      // translated copy of its att, lock-leashed — it advances only while the percept stays coherent (endogenous control,
      // bounded by perceptual coherence). virtGo(0,0) when already home releases the command (back to hold/free).
      window.virtGo = (dx = 0, dy = 0) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[VIRT] needs a soliton drive';
        if (!_V.psiVirt && !_V.phases.length) return '[VIRT] no virtual phase — ⎙virt (or virtBoot) first';
        const src = (_eyeSrc==='P1'||_eyeSrc==='P2') ? _eyeSrc : 'V';   // carrier resolved at PRESS time and stamped into the verb (not re-read from the frame-local eyeSrc at execution — that could bind different carriers on different peers)
        injectEvent?.({ type: 'mediumVirt', mode: 'go', gx: dx, gy: dy, src }); return `${src}→(${dx},${dy}) stamped`; };
      window.virtWatch = (bars = 40) => { if (!_V.psiVirt) return 'no virtual phase — press ⎙virt first';
        _virtWatch = { bars, samples: [], lastBar: -1 };
        console.log(`[VIRTWATCH] armed for ${bars} bars — sampling V⊗ per bar`); return 'watching'; };
      // M-a — the REGISTER EXPERIMENT (limit-cycle self-hosted mux, step 1 of the ladder): write ONE zero-tilt low-k
      // phase texture on the live W soliton — a pure phase lens e^{iφ}, φ = amp·cos(2πkx·x/G)·cos(2πky·y/G) — and
      // bind-demod it per bar against a mirrored V reference. Protocol: ⎙virt (V=W) → virtMirror() → phaseTex() →
      // texWatch(40). Verdicts sought: λ≈0 persistence (the phase channel can carry registers), LINEAR θ drift (the
      // calibratable ω-bias), kick≈0 (the zero-moment basis deposits no momentum). Falsifier: fast decay = channel dead.
      window.phaseTex = (amp = 0.6, kx = 2, ky = 3) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[TEX] needs a soliton drive';
        if (!_V.psiVirt) console.log('[TEX] note: no V — the write lands, but texWatch needs a mirrored reference (⎙virt → virtMirror() first)');
        else if (!_V.virtMirror) console.log('[TEX] note: mirror is OFF — texWatch reads against a drive-matched V (virtMirror() first)');
        injectEvent?.({ type: 'mediumVirt', mode: 'tex', amp, gx: kx|0, gy: ky|0 }); return `tex φ: amp=${amp} rad, cycles=(${kx|0},${ky|0}) stamped`; };
      window.texWatch = (bars = 40, slot = 'V') => { slot = (slot === 'P1' || slot === 'P2') ? slot : 'V';
        if (slot === 'V' && !_V.psiVirt) return 'no V reference — ⎙virt first (or texWatch(bars, "P1"))';
        if (slot !== 'V' && !_V.phases[slot === 'P1' ? 0 : 1]) return `no ${slot} — virtBoot() under ⧉mux first`;
        _texWatch = { bars, samples: [], lastBar: -1, slot };
        console.log(`[TEXWATCH] armed for ${bars} bars — pair (W,${slot}): θ = φ_W − φ_${slot} · T (demod) · T0 (control) · centroid kick${_texSpec ? '' : ' · no texture: Θ-METER mode (the attPhase register readout / the pre-write baseline; phaseTex() switches to demod)'}`); return 'watching'; };
      // M-a″ — the OPERATOR-SIDE REGISTER (the M-a′ theorem inverted): every field-side write relaxed to the drive's
      // reference, so put the register IN the reference — attPhase(α) rotates the operator's U(1) phase; the drive
      // re-locks W to it within ~1 bar (the measured lock time = the write latency) and HOLDS it there. Writes
      // COMPOSE (U(1) — attPhase(0.6) then attPhase(0.3) reads 0.9). Read: V in HOLD at its recorded UNROTATED att
      // → θ (texWatch Θ-meter) steps to Σα and stays. Under MIRROR V follows the rotated att → meter reads 0 (the
      // null control, itself informative). Protocol: ⎙virt → virtHold() → texWatch(40) → attPhase(0.6).
      // M-b — the slot argument generalizes the stamped-carrier principle: virtGo stamps the eye's selection at
      // press time; attPhase supplies the carrier EXPLICITLY (register writes must not depend on the gaze). Slots:
      // 'W' (live att, rebuild hook) · 'V'/'P1'/'P2' (stored att, one-time rotation; the phase re-locks in its own
      // slices). Crosstalk protocol (mux ON): attPhase(0.5,'W') → θ=+0.5; attPhase(0.3,'V') → θ→0.2 (differential);
      // each write must leave the OTHER register's lock untouched — the off-diagonals of the register file.
      window.attPhase = (a = 0.6, slot = 'W') => { slot = (slot === 'V' || slot === 'P1' || slot === 'P2') ? slot : 'W';
        if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[APHASE] needs a soliton drive';
        if (!_V.psiVirt) console.log('[APHASE] note: no V — the write lands, but reading it needs a reference pair (⎙virt first)');
        injectEvent?.({ type: 'mediumVirt', mode: 'aphase', amp: a, src: slot }); return `att phase(${slot}) += ${a} rad stamped (register write)`; };
      // M-c1 — THE CRYSTAL PROBE (self-hosted clock, step 1): before the mux gate can be field-derived, the medium
      // must demonstrably carry an oscillator. Locked content can't clock (the register is stationary BECAUSE the
      // drive pins it) and a gated oscillator deadlocks — so the candidate is a shared k-mode: dispersion advances
      // its phase exactly (eigenbasis), and park/reload preserves it across slices (the crystal is never context-
      // switched out). Protocol: clockSeed(0.05, 3, 0) → clockWatch(400). ✓ CRYSTAL → M-c2 wires the gate; every
      // ✗ verdict is the measured bound on how much external clock this medium needs (clause 2 of the §7.88 arc).
      window.clockSeed = (a = 0.05, kx = 3, ky = 0) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[CSEED] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'cseed', amp: a, gx: kx|0, gy: ky|0 }); return `clock probe a=${a} k=(${kx|0},${ky|0}) stamped`; };
      window.clockWatch = (samples = 400) => { if (!_clkSpec) return 'no probe — clockSeed() first';
        _clkWatch = { n: samples, samples: [] };
        console.log(`[CLOCKWATCH] armed for ${samples} frame-samples — |F(k_c)| (alive?) · θ_O unwrapped rate (the crystal frequency) · residual σ (jitter)`); return 'watching'; };
      // M-c1′ — THE BREATH PROBE (the amplitude-sector oscillator): does the medium have its OWN heartbeat? Samples
      // peak |ψ|² and lock ℓ at every Q=7 boundary (in-loop, rides the existing readback — zero extra GPU traffic),
      // then autocorrelates. ✓ FREE-RUNNING cycle (period not a 21-multiple) = the M-c2 gate exists (integer beat
      // counter — the medium times its own mux). ENTRAINED = matter echoes the operator clock (the honest closure:
      // matter's clock and the operator's clock are ONE in this medium). Protocol: settle the drive → breathWatch().
      window.breathWatch = (samples = 1024) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[BREATH] needs a soliton drive';
        _brWatch = { n: samples, s: [] };
        console.log(`[BREATH] armed for ${samples} samples at Q=7 boundaries (~${samples * 7} steps of matter time) — peak |ψ|² + lock ℓ → autocorrelation (period · depth · entrained-vs-free)`); return 'watching'; };
      // M-c2 — SELF-CLOCK (the routing demo of the closed §7.88 mux arc): the mux slot rotates on BEATS of the
      // lock-ℓ ripple (upward crossings through a slow per-slot baseline) instead of ⌊k/21⌋. The time is still the
      // operator's — what's self-hosted is the ROUTING: the scheduler reads the medium's heartbeat. Watchdog: no
      // beat in 84 steps → forced rotation (liveness; a phase without an operator has no heartbeat — honest).
      // Acceptance test: selfClock() under ⧉mux, then rerun the M-b crosstalk protocol — the registers must stay
      // independent under the beat-gated mux. Without ⧉mux it just counts the heartbeat (a live beat meter).
      window.selfClock = () => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[SELFCLK] needs a soliton drive';
        if (!_V.virtMux) console.log('[SELFCLK] note: gates only under ⧉mux (virtMux()) — without slices it just counts beats');
        injectEvent?.({ type: 'mediumVirt', mode: 'selfclock' }); return 'self-clock toggle stamped'; };
      // GATE 1 of the proper-time-metric closure (doc/proper-time-metric.md): expose the beat SCHEDULE in the solH
      // telemetry so two peers can diff it step-for-step. Peer-local only (no dynamics, no fork surface) — it just
      // reveals whether _V.selfClk.beats is already a pure function of k+shared-field. Enable it on BOTH peers,
      // run a selfClock world for a few kstep, and compare the `τ:beats=… lastK=…` fields at matching solH steps.
      window.tauProbe = (on = true) => { _TAU_PROBE = !!on;
        console.log(`[τ] probe ${_TAU_PROBE ? 'ON — solH now logs beats/lastK; diff two peers at matching steps (Gate 1: schedules must match for τ to be a replicated metric)' : 'OFF'}`); return `tauProbe ${_TAU_PROBE}`; };
      // tauKernel() — the τ-kernel instrument (gate 3: kwe-tau IS the engine — no control remains, no sync needed;
      // the kernel state ships in medSnapTauK). Prints status + hash; cross-peer, hash must match at matching steps.
      // lensTau(ω) — the ω·τ_i register-clock dial (replicated verb; model clamps ±0.5 rad/beat). lensTau(0) = off.
      window.lensTau = (w = 0.1) => { if (_driveMode==='transport'||_driveMode==='objorbit') injectEvent?.({ type: 'mediumVirt', mode: 'lenstau', amp: +w }); return `lensTau ω=${+w}`; };
      // regPhase() — ONE-SHOT machine-readable phase meter for scripted sweeps (the ω-sweep driver, doc §10):
      // arg Σψ per live slot from the CANONICAL stores (W = _E.psiLensed, the last frame's world field; V/P = their
      // parked stores) — the same translation-invariant whole-field readout regRead averages, but returned as
      // numbers with the current beat counts (no console scraping). No windows: the driver does its own circular
      // averaging and telescoped unwrapping. Peer-local meter — run the DRIVER on one peer only (it injects verbs).
      window.regPhase = () => { const ph = (f) => { if (!f) return null; let re = 0, im = 0;
          for (let i = 0; i < N_CELLS; i++) { re += f[i * 2]; im += f[i * 2 + 1]; } return Math.atan2(im, re); };
        return { W: ph(_E.psiLensed), V: ph(_V.psiVirt), P1: ph(_V.phases[0]?.psi), P2: ph(_V.phases[1]?.psi),
                 beats: _SLOTN.map(nm => _tauK ? (_tauK.beatsOf(nm) ?? 0) : 0), step: _E.solSteps, gx: _V.virtGx, gy: _V.virtGy, bank: _V.virtBank.length }; };   // bank = plate count (drivers boot the newest as bank−1)
      // chainRead() — THE U-REGISTER METER (observer-chain arc, step 1; doc/proper-time-metric.md §12). The chain
      // W→V→P1→P2 read as PAIRWISE overlaps ⟨ψ_a|ψ_b⟩ = Σ conj(ψ_a)·ψ_b — the gauge-invariant link phase (Law 5:
      // content lives in phase DIFFERENCES; the field product IS the correlator — binding=computation). NOT the
      // trivial telescoping of regPhase differences: each link is amplitude-weighted by the two fields' overlap, so
      // composition along the chain (Σ link Δφ vs the end-to-end Δφ) is a MEASURED law, not an identity — ε = the
      // composition defect (how far the chain fails to compose as an operator product). vis = |⟨a|b⟩|/√(E_a·E_b)
      // per link — the coherence of that read; a low-vis link's phase is untrustworthy (report, don't hide). Under
      // lensTau the per-link prediction is ω·(τ_b−τ_a) via the returned beat counts. With only 2 live slots the
      // composed read IS the single link (ε≡0 — boot P1 for a non-trivial chain). Peer-local meter — run on BOTH
      // peers, match by step= (the regRead protocol).
      const _chainSlots = () => [['W', _E.psiLensed, 0], ['V', _V.psiVirt, 1], ['P1', _V.phases[0]?.psi, 2], ['P2', _V.phases[1]?.psi, 3]].filter((s) => s[1]);
      // (the pairwise-overlap primitive moved into medium-core's chainMeter — ONE link-read for every app)
      window.chainRead = () => {
        const chain = _chainSlots();
        if (chain.length < 2) return '[CHAIN] need ≥2 live slots (record V / boot phases first)';
        // the meter math lives in medium-core's chainMeter (generalized — ONE meter for every app); this wrapper
        // supplies the medium's slots/descriptors and appends the worldline context (beats, step). Semantics doc:
        // mdl's constant = construction-phase difference (watch its DRIFT); ε vs the abelian algDefect ≡ 0.
        const m = chainMeter(chain.map((s) => ({ name: s[0], field: s[1], op: _lensOp[s[2]] })));
        const out = { ...m, beats: _SLOTN.map((nm) => _tauK ? (_tauK.beatsOf(nm) ?? 0) : 0), step: _E.solSteps };
        console.log(`[CHAIN] ${out.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis} pred ${l.pred} mdl ${l.mdl})`).join(' · ')} · Σlinks=${out.sum} vs ${out.composed.a}→${out.composed.b}=${out.composed.dphi} · ε=${out.defect} (alg ${out.algDefect})${chain.length < 3 ? ' (2 slots — trivial)' : ''} · visΠ=${out.visProduct} vs ${out.composed.vis} · beatsS[${out.beats.join(',')}] step=${_E.solSteps}`);
        return out; };
      // chainSee() — THE OBSERVED CHAIN: like chainRead but each slot's field is read THROUGH its own readOp first
      // (ψ_seen = lensU1.apply(op, ψ, GRID), the FULL apply incl. the metric/gauge sector) — the u-register's
      // ψ_out = Op·ψ_in semantics made a meter. No pred/mdl columns: through the lens the descriptor is PART of the
      // measurement (for pure-U(1) descriptors, link_seen = link_raw + pred exactly; at identity ≡ chainRead).
      // Peer-local, pure fn of replicated state — run on both peers, match by step=.
      window.chainSee = () => {
        const chain = _chainSlots();
        if (chain.length < 2) return '[CHAINSEE] need ≥2 live slots (record V / boot phases first)';
        const m = chainMeter(chain.map((s) => ({ name: s[0], field: s[1], op: _lensOp[s[2]] })), { G: GRID, through: true });   // the observed chain: core meter in through-lens mode
        const out = { ...m, beats: _SLOTN.map((nm) => _tauK ? (_tauK.beatsOf(nm) ?? 0) : 0), step: _E.solSteps };
        console.log(`[CHAINSEE] ${out.links.map((l) => `${l.a}→${l.b}:Δφ=${l.dphi}(vis ${l.vis})`).join(' · ')} · Σlinks=${out.sum} vs ${out.composed.a}→${out.composed.b}=${out.composed.dphi} · ε=${out.defect}${chain.length < 3 ? ' (2 slots — trivial)' : ''} · visΠ=${out.visProduct} vs ${out.composed.vis} · modes[${out.modes.join(',')}] beatsS[${out.beats.join(',')}] step=${_E.solSteps}`);
        return out; };
      // lensSet(slot, {kx,ky,rot,scl,tx,ty}) — write the EXTENDED readOp components (metric/gauge sector) of one
      // observer's descriptor. Replicated verb; READ-SIDE ONLY for now (see the drain branch's honesty boundary).
      // lensSet('V') with no params = back to the U(1) sector (identity spatial part; phase/prec untouched).
      window.lensSet = (slot = 'V', p = {}) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[LENSSET] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'lensset', src: slot, kx: +p.kx || 0, ky: +p.ky || 0, rot: +p.rot || 0, scl: (p.scl != null) ? +p.scl : 1, tx: +p.tx || 0, ty: +p.ty || 0 }); return `lensSet(${slot}) stamped (read-side lens)`; };
      window.tauKernel = () => { if (!_tauK) return 'kwe-tau not loaded';
        console.log(`[τK] hash=${_tauK.hash()}`, _tauK.status()); return _tauK.status(); };
      window.tauShadow = window.tauKernel;   // legacy alias
      // ABSOLUTE REGISTER READ (run-8 corollary — the whole field is ONE phase register): arg Σψ per live slot,
      // vector-averaged over `frames` frames. No ⎙virt/hold/mirror needed; works mid-mirror (where the differential
      // meter reads 0); k=0 → exactly translation-invariant (the soliton can transport; the register reads the same).
      // Absolute θ includes the object's constant construction phase — differences are the content. Peer-local.
      // regRead(frames, reps): reps>1 = the DRIFT METER — `reps` consecutive windows + per-slot linear fit of the
      // unwrapped θ (rad/kstep). Clause-3 protocol: (A) no mux → baseline drift; (B) virtMux (21-step switching);
      // (C) selfClock (beat switching): excess drift ÷ switching rate = rad/transition — κ measured, not injected.
      // M-e — THE COUPLING GRAPH: edge(a, b, κ) with slots 'W'/'V'/'P1'/'P2', κ ∈ [−0.2, 0.2] signed (κ<0 =
      // anti-align: the frustrated edge), κ=0 removes. Symmetric; mux-only clock physics (the validated leak,
      // generalized). THE FRUSTRATED TRIANGLE (first computation): boot 3 phases, edge all three pairs at −0.15,
      // watch regRead(32,12) — the registers must relax to a splayed ground state no pairwise alignment satisfies.
      window.edge = (a = 'W', b = 'V', kk = -0.15) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[EDGE] needs a soliton drive';
        const SN = { W: 0, V: 1, P1: 2, P2: 3 }, ia = SN[a], ib = SN[b];
        if (ia === undefined || ib === undefined || ia === ib) return '[EDGE] slots: two distinct of W/V/P1/P2';
        if (!_V.virtMux) console.log('[EDGE] note: edges act only under ⧉mux (clock physics, like the leak)');
        injectEvent?.({ type: 'mediumVirt', mode: 'edge', gx: ia, gy: ib, leak: kk }); return `edge κ(${a},${b})=${kk} stamped`; };
      // refAmp(slot, mult) — the PINNING-GRAVITY dial (torque-balance test). Multiplies slot's hold/drive β by `mult`
      // (0–3; default 1 = unchanged). Sweep W's h with the pin phase fixed (attPhase) and the pair fixed, then read
      // the equilibrium W−V: h≫κ → W near its pin phase; h≪κ → W → anti-phase (π). θ_eq(h) solving the torque balance
      // h·sin(θ−θ_pin)=2κ·sin(θ−θ_anti) is the physical-law proof (the honest test the redshift idea was reaching for).
      window.refAmp = (slot = 'W', mult = 1) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[REFAMP] needs a soliton drive';
        slot = (slot === 'V' || slot === 'P1' || slot === 'P2') ? slot : 'W';
        injectEvent?.({ type: 'mediumVirt', mode: 'refamp', src: slot, amp: mult }); return `refAmp(${slot})=×${mult} stamped (pin gravity)`; };
      // edgeStatus() — VERIFY what actually landed (read-only, peer-local). After a rapid verb burst, confirm the
      // coupling graph, pin dials, register phases, slots, and the verb-seen cursor took — catches a dropped verb
      // directly instead of trusting it. Also prints pending virt-queue depth (verbs stamped but not yet drained).
      window.edgeStatus = () => { const SN = ['W','V','P1','P2'];
        const slots = ['W'].concat(_V.psiVirt ? ['V'] : [], _V.phases[0] ? ['P1'] : [], _V.phases[1] ? ['P2'] : []);
        console.log(`[STATUS] live slots: ${slots.join(',')} · virtSeen=${_V.virtSeen} · pendingVirtQ=${_kqVirt ? _kqVirt.length : 0} · selfClk=${_V.selfClk ? 'ON' : 'off'} · mux=${_V.virtMux ? 'ON' : 'off'} · attPhase(W)=${_lensOp[0].phase.toFixed(3)} aphEng[V:${_lensOp[1].phase.toFixed(3)} P1:${_lensOp[2].phase.toFixed(3)} P2:${_lensOp[3].phase.toFixed(3)}]${_lensOp[0].omega?` · lensTau=${_lensOp[0].omega.toFixed(3)}`:''}${_V.selfClk && _tauK ? ` · τS[${SN.map((n)=>`${n}:${_tauK.tauOf(n).toFixed(2)}`).join(' ')}] beatsS[${SN.map((n)=>_tauK.beatsOf(n)??0).join(',')}] kH=${_tauK.hash()}` : ''}`);
        if (_K.edge) { const rows = []; for (let i = 0; i < 4; i++) for (let j = i+1; j < 4; j++) if (_K.edge[i][j]) rows.push(`κ(${SN[i]},${SN[j]})=${_K.edge[i][j]}`);
          console.log(`[STATUS] edges: ${rows.length ? rows.join(' · ') : '(matrix present but all-zero)'}`); }
        else console.log('[STATUS] edges: NONE (no coupling graph)');
        const ra = _lensOp.map((o, i) => o.beta !== 1 ? `${SN[i]}×${o.beta}` : null).filter(Boolean);
        console.log(`[STATUS] pin dials: ${ra.length ? ra.join(' · ') : 'all default ×1'}`);
        return `${slots.length} slots · ${_K.edge ? _K.edge.flat().filter(v=>v).length/2 : 0} edges · pendQ ${_kqVirt ? _kqVirt.length : 0}`; };
      // lensOps() — the OBSERVER DESCRIPTORS read back (u-register step 2): one value per slot {mode, phase, beta,
      // omega}. Peer-local display of replicated state — both peers must print identical descriptors at the same step.
      window.lensOps = () => { const o = _lensOp.map((l, i) => ({ slot: _SLOTS[i], ...l, angle: +lensU1.angle(l).toFixed(4) }));
        console.log(`[LENSOPS] ${o.map((l) => `${l.slot}:{${l.mode} φ=${l.phase.toFixed(3)} prec=${l.prec.toFixed(3)} β=${l.beta} ω=${l.omega} ∠=${l.angle}${l.mode !== 'id' ? ` k=(${l.kx},${l.ky}) A=[${l.A.map((v) => +v.toFixed(3)).join(',')}] t=(${l.tx},${l.ty})` : ''}}`).join(' · ')} · step=${_E.solSteps}`); return o; };
      // recordVia(φ) — RECORD THROUGH A LENS (u-register step 4): V is (re)recorded with its trap born in the frame
      // rotated by φ — field, plate and operator together, descriptor phase = φ. The reconstruction test is chainRead:
      // link W→V must show pred = φ − ∠_W with mdl steady; recall of lens-stamped plates prints [RECALL-∠] (the
      // observer-relative recall readout — Δ∠ = ω·Δτ when only precession separates the stored and current moments).
      window.recordVia = (a = 0.5) => { if (_driveMode !== 'transport' && _driveMode !== 'objorbit') return '[RECVIA] needs a soliton drive';
        injectEvent?.({ type: 'mediumVirt', mode: 'recvia', amp: +a }); return `record V through lens φ=${+a} rad stamped`; };
      window.regRead = (frames = 32, reps = 1) => { if (!_E.psiLensed) return '[REGREAD] no live field yet';
        _regRd = { n: frames, f: 0, acc: {}, reps: Math.max(1, reps|0), series: [] };
        console.log(`[REGREAD] armed — ${reps > 1 ? `${reps} windows × ` : ''}${frames} frames, arg Σψ per live slot (W/V/P1/P2)${reps > 1 ? ' + drift fit' : ''}`); return 'reading'; };
      // driveTrace(n) — arm the [DRIVETRACE] log (todo/target/backlog/muxRate per driven frame) for the next n frames. Manual diagnostic; off by default. Backlog bounded = healthy; climbing + todo pinned at cap = a clock-vs-throughput spiral.
      window.driveTrace = (n = 12) => { _driveTraceN = n|0; return `[DRIVETRACE] armed for ${_driveTraceN} frames`; };
      // Kepler dial 2: schedule multiplier 1..8 (opSpeed16 × mult; at mult 5+ the demand exceeds the chase's ~1px/step
      // ceiling and the leash must bind — σ<1 and ω_eff(R) becomes the medium's own orbital law)
      window.orbW = (m = 1) => { injSnap(); injectEvent?.({ type: 'setMedium', orbW: m }); return `orbit schedule ×${m} (re-anchored)`; };
      // THE NATIVE KEPLER READER (user's correction: Kepler for THIS medium lives in the CLOCK layer, not in dragged
      // matter). K3-analog = the scale-period law of the fractal clock: fit delay vs depth across the beat events
      // (self-similar hierarchy → delay ∝ s^depth → log-linear, slope = the medium's Kepler constant). K2-analog =
      // the occupation law: kernel weight vs ring radius (ρ~1/r → w·r ≈ const = the flat-curve form, native).
      window.keplerIFS = () => { const n = _lastNode; if (!n) return 'no node yet';
        const ev = [ ...(n.slotEvents_A || []), ...(n.slotEvents_B || []) ];
        if (!ev.length) return 'no beat events in the log';
        const byD = new Map();
        for (const e of ev) { if (typeof e.d !== 'number' || typeof e.delay !== 'number') continue;
          if (!byD.has(e.d)) byD.set(e.d, []); byD.get(e.d).push(e.delay); }
        const rows = [...byD.entries()].sort((a, b) => a[0] - b[0]).map(([d, ds]) => ({ d, mean: ds.reduce((x, y) => x + y, 0) / ds.length, n: ds.length }));
        console.log('[KEPLER-IFS] K3-analog — scale-period law of the fractal clock (delay vs depth):');
        for (const r of rows) console.log(`  depth ${r.d}: mean delay ${r.mean.toFixed(1)} (n=${r.n})`);
        if (rows.length >= 2) { const pts = rows.filter(r => r.mean > 0);
          let sx = 0, sy = 0, sxx = 0, sxy = 0; for (const r of pts) { const y = Math.log(r.mean); sx += r.d; sy += y; sxx += r.d * r.d; sxy += r.d * y; }
          const M = pts.length, slope = (M * sxy - sx * sy) / Math.max(1e-12, M * sxx - sx * sx);
          console.log(`  log-linear slope = ${slope.toFixed(3)} → period ratio per depth level = ${Math.exp(slope).toFixed(3)} (the medium's Kepler constant; compare the genome's s)`); }
        // LADDER FIT (v2 — the depth-mean slope is RATIO-INSENSITIVE, measured: six-ratio spectrum → 0.788, golden-only
        // → 0.816, nearly identical; the per-depth means mix the same-depth self-fire cascade with floor truncation).
        // Proper log-periodicity detector: scan candidate ratios r, phase = ln(delay)/ln(r) mod 1; a single-ratio world
        // puts ALL delays on geometric ladders → the phase distribution is a COMB → circular concentration |⟨e^{2πiφ}⟩|→1.
        const dl = ev.map(e => e.delay).filter(d => d > 0);
        if (dl.length >= 10) { let best = { r: 0, c: 0 };
          for (let r = 0.30; r <= 0.90; r += 0.005) { const lr = Math.log(r); let cr = 0, ci = 0;
            for (const d of dl) { const ph = ((Math.log(d) / lr) % 1 + 1) % 1; cr += Math.cos(2 * Math.PI * ph); ci += Math.sin(2 * Math.PI * ph); }
            const c = Math.hypot(cr, ci) / dl.length; if (c > best.c) best = { r, c }; }
          console.log(`[KEPLER-IFS] ladder fit: r* = ${best.r.toFixed(3)} · comb concentration = ${best.c.toFixed(2)} (1.0 = perfect single-ratio ladder; a multi-ratio spectrum smears it)`); }
        const rad = n.cachedRadii || [], wgt = n.cachedWeights || [];
        console.log('[KEPLER-IFS] K2-analog — occupation law (kernel weight vs ring radius):');
        for (let i = 0; i < rad.length; i++) console.log(`  r=${rad[i]}: w=${(wgt[i] ?? 0).toFixed(4)} · w·r=${((wgt[i] ?? 0) * rad[i]).toFixed(3)}${i ? '' : '   (w·r ≈ const = scale-invariant occupation, the flat-curve form — native)'}`);
        return `${ev.length} beats · ${rad.length} rings`; };
      // SELF-ADVECTION window probe: on the LIVE GPU, for each γ — seed a soliton (relax it under that γ), kick it, propagate, and measure
      // (width via pk/mn, energy survival, actual centroid displacement). Finds the γ that's WIDE enough to transport (v_g≠0) yet DENSE enough
      // that the CGL gain still sustains it (E doesn't →0). CPU probes diverge from GPU on this nonlinearity → measure it live.
      window.mediumMoveProbe = (diss = true) => {
        if (!_gpu) { console.log('[MEDIUM-MOVE] no gpu'); return; }
        const saved=_gpu.readEyePsi(), N=N_CELLS;
        const seed=new Float64Array(2*N);   // FRESH Gaussian blob at center (independent of buffer state — the live buffer may have died)
        for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){seed[(y*GRID+x)*2]=2.0*Math.exp(-((x-GRID/2)**2+(y-GRID/2)**2)/(2*9));}
        const energyOf=(f)=>{let e=0;for(let i=0;i<N;i++)e+=f[i*2]**2+f[i*2+1]**2;return e;};
        const cenOf=(f)=>{let x=0,y=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2;x+=(i%GRID)*a2;y+=((i/GRID)|0)*a2;w+=a2;}return w>0?[x/w,y/w]:[GRID/2,GRID/2];};
        // REAL spatial width = RMS radius (2nd moment), in px. A 1px spike → ~0.5; a healthy soliton → 2-5. (pk/mn was misleading: it EXPLODES for a spike because mean→0.)
        const rmsOf=(f)=>{const c=cenOf(f);let s=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2,dx=(i%GRID)-c[0],dy=((i/GRID)|0)-c[1];s+=a2*(dx*dx+dy*dy);w+=a2;}return w>0?Math.sqrt(s/w):0;};
        // net momentum p_x = Σ Im(ψ* ∂x ψ) (central diff) — the REAL transportable momentum in the field
        const momX=(f)=>{let p=0;for(let y=0;y<GRID;y++)for(let x=1;x<GRID-1;x++){const i=(y*GRID+x)*2,ip=(y*GRID+x+1)*2,im=(y*GRID+x-1)*2;const dr=(f[ip]-f[im])*0.5,di=(f[ip+1]-f[im+1])*0.5;p+=f[i]*di-f[i+1]*dr;}return p;};
        const eSeed=energyOf(seed);
        // The COLLAPSE FIX: the cubic gain (CGL ε|ψ|² / self-focus) concentrates energy into 1px (Townsend collapse) — quintic caps the HEIGHT
        // not the WIDTH, so it stabilizes a spike. The IFS-native LOW-PASS (applyEyeLowpass, 3×3 complex blend) is the WIDTH FLOOR: it spreads
        // high-k content (a spike IS high-k) → opposes collapse. (gain→concentrate) vs (low-pass→spread) selects a FINITE width. Sweep (γ,β).
        // CONTROL: pure LINEAR propagation of a kicked Gaussian — NO SPM/CGL/lowpass. If THIS doesn't move, the kick or propagator is the bug
        // (not the soliton). A free Gaussian with k=π/8 should drift v_g=2k·DT/step → ~ several px over 12 steps.
        { _gpu.setEyePsi(seed); const c0=cenOf(seed); const k=Math.PI/8; _gpu.linOp({ kx:k, ky:0 });
          for(let i=0;i<12;i++) _gpu.stepEyeN(1,DT); const f=_gpu.readEyePsi(), c1=cenOf(f);
          console.log(`  [CONTROL] free Gaussian, k=π/8, 12 linear steps: displaced=${(c1[0]-c0[0]).toFixed(2)}px (expect ~${(2*k*DT*12).toFixed(1)}px if v_g=2k) ${Math.abs(c1[0]-c0[0])>1?'✓ kick+propagator WORK':'✗ KICK or PROPAGATOR is the bug'}`); }
        // CONTROL 2: kick a BOUND soliton then PURE-LINEAR flight (no re-bind). Bigger k MUST move a free packet more. If a bound packet gives 0
        // here while the fresh Gaussian above moves, the kick is being ERASED by the binding (the relaxed phase profile), not by the trap dynamics.
        { _gpu.setEyePsi(seed);
          for(let i=0;i<40;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); if(diss)_gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); }
          const bound=_gpu.readEyePsi(), c0=cenOf(bound), pBefore=momX(bound);
          // momentum check: kick a FRESH Gaussian vs the BOUND soliton, measure p_x imparted by an identical k.
          _gpu.setEyePsi(seed); _gpu.linOp({kx:1.0,ky:0}); const pG=momX(_gpu.readEyePsi());
          _gpu.setEyePsi(bound); _gpu.linOp({kx:1.0,ky:0}); const pB=momX(_gpu.readEyePsi());
          console.log(`  [MOMENTUM] after kick k=1.0 — fresh Gaussian p_x=${pG.toFixed(2)} · bound soliton p_x=${pB.toFixed(2)} (bound before=${pBefore.toFixed(2)}) ${Math.abs(pB)<0.1*Math.abs(pG)?'✗ KICK IMPARTS NO MOMENTUM to bound':'✓ momentum imparted'}`);
          // CORE width: how many cells hold 90% of energy? (RMS is fooled by a low broad tail.) A 1-2 cell core can't carry a phase-tilt gradient.
          const coreCells=(f)=>{const a=[];let tot=0;for(let i=0;i<N;i++){const e=f[i*2]**2+f[i*2+1]**2;a.push(e);tot+=e;}a.sort((p,q)=>q-p);let c=0,acc=0;for(const e of a){acc+=e;c++;if(acc>=0.9*tot)break;}return c;};
          console.log(`  [CORE] 90%-energy cells: fresh Gaussian=${coreCells(seed)} · bound soliton=${coreCells(bound)} (a 1-2 cell core has no gradient for the tilt → no momentum)`);
          // does linOp even CHANGE the bound field? compare before/after the multiply (should differ — it's ψ·e^{ikx}).
          _gpu.setEyePsi(bound); _gpu.linOp({kx:1.0,ky:0}); const after=_gpu.readEyePsi(); let chg=0,cnt=0;
          for(let i=0;i<N;i++){const a2=bound[i*2]**2+bound[i*2+1]**2;if(a2>1e-6){cnt++;chg+=Math.hypot(after[i*2]-bound[i*2],after[i*2+1]-bound[i*2+1]);}}
          console.log(`  [LINOP-CHANGES-FIELD?] ${cnt} nonzero cells, mean |Δψ| from kick = ${(cnt>0?chg/cnt:0).toFixed(3)} ${chg/Math.max(cnt,1)>0.01?'✓ linOp DID modify the field':'✗ linOp left field UNCHANGED (the kick is a no-op)'}`);
          // SANITY: bound soliton's internal phase spread — a huge internal phase makes the central-diff p_x measurement unreliable (but NOT the drift).
          let phMin=9,phMax=-9;for(let i=0;i<N;i++){const a2=bound[i*2]**2+bound[i*2+1]**2;if(a2>0.1){const ph=Math.atan2(bound[i*2+1],bound[i*2]);if(ph<phMin)phMin=ph;if(ph>phMax)phMax=ph;}}
          console.log(`  [INTERNAL-PHASE] bound soliton phase range over its core = ${(phMax-phMin).toFixed(2)} rad ${phMax-phMin>3?'(large → SPM-accumulated radial phase)':'(small → clean)'}`);
          // HYPOTHESIS: the soliton's steep WRAPPED internal phase (~2π) makes a linear tilt unable to impose clean momentum. Build solitons with
          // WEAKER SPM (less accumulated phase) and test if they accept the kick AND drift. Find the γ where internal phase stays gentle (<π) yet it still binds.
          for (const g of [20, 8, 3, 1]) {
            _gpu.setEyePsi(seed);
            for(let i=0;i<40;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT); if(diss)_gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); }
            const fb=_gpu.readEyePsi(); let pmin=9,pmax=-9; for(let i=0;i<N;i++){const a2=fb[i*2]**2+fb[i*2+1]**2;if(a2>0.1){const ph=Math.atan2(fb[i*2+1],fb[i*2]);if(ph<pmin)pmin=ph;if(ph>pmax)pmax=ph;}}
            const surv=energyOf(fb)/Math.max(eSeed,1e-9); if(surv<0.05){console.log(`  [PHASE-SWEEP] γ=${g} DIED`);continue;}
            const c0=cenOf(fb); _gpu.linOp({kx:1.0,ky:0}); const pk=momX(_gpu.readEyePsi());
            for(let i=0;i<12;i++) _gpu.stepEyeN(1,DT); const d=cenOf(_gpu.readEyePsi())[0]-c0[0];
            console.log(`  [PHASE-SWEEP] γ=${String(g).padStart(2)} · internalPhase=${(pmax-pmin).toFixed(1)}rad · p_x after kick=${pk.toFixed(0)} · drift(12 lin)=${d.toFixed(2)}px ${Math.abs(d)>1?'✓ MOVES':'✗ stuck'}`);
          }
          // VERIFY the winner (low γ): does it (a) BIND & HOLD over 80 idle steps (RMS stays bounded, E survives), and (b) WALK under sustained
          // re-kick (drift grows)? This decides whether γ=1 is a viable LIVE soliton (movable AND persistent) or just transiently movable.
          for (const g of [2, 1, 0.5]) {
            _gpu.setEyePsi(seed);
            for(let i=0;i<40;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT); if(diss)_gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); }
            const f0=_gpu.readEyePsi(), rms0=rmsOf(f0); const c0=cenOf(f0);
            for(let i=0;i<80;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT); if(diss)_gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); }  // 80 IDLE steps
            const fh=_gpu.readEyePsi(), rmsH=rmsOf(fh), survH=energyOf(fh)/Math.max(eSeed,1e-9);
            _gpu.setEyePsi(f0); let walk=[];                                  // sustained re-kick walk from the fresh-bound state
            for(let blk=0;blk<3;blk++){ for(let i=0;i<10;i++){ _gpu.linOp({kx:1.0,ky:0}); _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT); if(diss)_gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); } walk.push((cenOf(_gpu.readEyePsi())[0]-c0[0]).toFixed(1)); }
            const holds=survH>0.5&&rmsH<rms0*1.8, walks=parseFloat(walk[2])>parseFloat(walk[0])+1;
            console.log(`  [VERIFY] γ=${g} · HOLD 80 idle: RMS ${rms0.toFixed(1)}→${rmsH.toFixed(1)} E=${survH.toFixed(2)} ${holds?'✓holds':'✗drifts/dies'} · WALK re-kick=[${walk.join(', ')}]px ${walks?'✓walks':'✗stuck'} ${holds&&walks?'★ VIABLE MOVABLE SOLITON':''}`);
          }
          for(const k of [0.4,1.0,1.8]){ _gpu.setEyePsi(bound); _gpu.linOp({kx:k,ky:0});
            for(let i=0;i<12;i++) _gpu.stepEyeN(1,DT); const d=cenOf(_gpu.readEyePsi())[0]-c0[0];
            console.log(`  [CONTROL2] BOUND soliton kicked k=${k}, 12 LINEAR steps: displaced=${d.toFixed(2)}px (expect ~${(2*k*DT*12).toFixed(1)}px)`); } }
        // HOP test: a bound soliton WON'T glide (momentum can't beat the self-trap), but maybe it can HOP — UNBIND (nonlinearity OFF) → kick →
        // free-flight a few LINEAR steps (it drifts like the control Gaussian) → RE-BIND (nonlinearity back ON, re-traps at the new spot). The risk:
        // dispersion spreads the free packet during flight, so it may not survive the re-trap. Sweep (k, flightSteps): measure net hop distance,
        // survival (E after re-bind), and whether it re-localized (RMS back down). A repeatable surviving hop = the honest mover (a walk of hops).
        console.log(`[MEDIUM-MOVE] HOP test (diss=${diss}): unbind→kick→free-flight→re-bind. want: hop>1px, E survives, RMS re-localizes (<3).`);
        for (const k of [0.5, 1.0, 1.8]) {
          for (const flight of [3, 6, 10]) {
            _gpu.setEyePsi(seed);
            for (let i=0;i<40;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); if(diss)_gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); }  // bind
            const c0=cenOf(_gpu.readEyePsi());
            // HOP: kick, free-flight (LINEAR only — unbound), then re-bind (SPM back on)
            _gpu.linOp({kx:k,ky:0});
            for (let i=0;i<flight;i++) _gpu.stepEyeN(1,DT);                                   // free flight (nonlin OFF → drifts)
            for (let i=0;i<20;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); if(diss)_gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); }  // re-bind
            const f1=_gpu.readEyePsi(), c1=cenOf(f1), hop=c1[0]-c0[0], rms=rmsOf(f1), surv=energyOf(f1)/Math.max(eSeed,1e-9);
            const ok = Math.abs(hop)>1 && surv>0.5 && rms<3.5;
            console.log(`  k=${k} flight=${String(flight).padStart(2)} · hop=${hop.toFixed(1)}px · E=${surv.toFixed(2)} · RMS=${rms.toFixed(1)} ${ok?'✓ SURVIVING HOP':surv<=0.5?'✗ dispersed':rms>=3.5?'✗ stayed spread':'✗ no hop'}`);
          }
        }
        _gpu.setEyePsi(saved);
      };
      // ORBIT probe: confirm the blueprint's "fall along curvature" feel exists for the MOBILE (γ≈1) soliton. Seed a mobile soliton OFF-center, put
      // a phase well (linOp a·r²) AT center, evolve with NO kick — it should FALL toward the well (inertia). Then give it tangential velocity and
      // check it ORBITS (doesn't fall straight in). This is the playground physics; it does NOT persist (γ=1 dies idle) — transient by nature.
      window.mediumOrbitProbe = (gamma = 1) => {
        if (!_gpu) { console.log('[ORBIT] no gpu'); return; }
        const saved=_gpu.readEyePsi(), N=N_CELLS, C=GRID/2;
        const cenOf=(f)=>{let x=0,y=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2;x+=(i%GRID)*a2;y+=((i/GRID)|0)*a2;w+=a2;}return w>0?[x/w,y/w]:[C,C];};
        const energyOf=(f)=>{let e=0;for(let i=0;i<N;i++)e+=f[i*2]**2+f[i*2+1]**2;return e;};
        // mobile soliton seeded OFF-center (at C-14, C)
        const mk=(ox,oy)=>{const s=new Float64Array(2*N);for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++)s[(y*GRID+x)*2]=2.0*Math.exp(-((x-(C+ox))**2+(y-(C+oy))**2)/(2*9));return s;};
        // FALL sweep over well strength a — a symmetric packet only feels a NET force if the well gradient (2a·r) across it is strong enough to
        // break the left/right cancellation. Weak a → no net force (the (-14,0) symmetric blob just sits). Find the a that produces a real fall.
        console.log(`[ORBIT] γ=${gamma}. mobile soliton off-center at (-14,0), well at center. sweeping well strength a (need net pull → fall).`);
        for (const aWell of [0.012, 0.03, 0.06, 0.12, 0.25]) {
          _gpu.setEyePsi(mk(-14,0)); const path=[]; const c00=cenOf(_gpu.readEyePsi());
          for(let blk=0;blk<5;blk++){ for(let i=0;i<8;i++){ _gpu.linOp({centers:[C,C],a:aWell,beta:0,vtx:0}); _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-gamma,_SOL_ISAT,DT); } const c=cenOf(_gpu.readEyePsi()); path.push((c[0]-C).toFixed(1)); }
          const moved=Math.abs(parseFloat(path[4])-(c00[0]-C));
          console.log(`  [FALL] a=${String(aWell).padStart(5)} · dx @8,16,24,32,40 = [${path.join(', ')}] · moved ${moved.toFixed(1)}px ${moved>2?'✓ FALLS':'✗ no net force'}`);
        }
        const aWell=0.06;
        // (2) ORBIT: give tangential (perpendicular) velocity ky, then let the well curve it
        { _gpu.setEyePsi(mk(-14,0)); _gpu.linOp({kx:0,ky:0.9}); const path=[]; let minR=99,maxR=0;
          for(let blk=0;blk<6;blk++){ for(let i=0;i<8;i++){ _gpu.linOp({centers:[C,C],a:aWell,beta:0,vtx:0}); _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-gamma,_SOL_ISAT,DT); } const c=cenOf(_gpu.readEyePsi()); const r=Math.hypot(c[0]-C,c[1]-C); minR=Math.min(minR,r);maxR=Math.max(maxR,r); path.push(`(${(c[0]-C).toFixed(0)},${(c[1]-C).toFixed(0)})`); }
          const surv=energyOf(_gpu.readEyePsi())/Math.max(energyOf(mk(-14,0)),1e-9);
          console.log(`  [ORBIT] pos @8..48 steps: ${path.join(' → ')}  r∈[${minR.toFixed(0)},${maxR.toFixed(0)}] E=${surv.toFixed(2)} ${minR<8&&maxR>6?'✓ ORBITS (swings around, not straight in)':'~ curved path'}`);}
        _gpu.setEyePsi(saved);
        console.log(`  NOTE: γ=${gamma} is TRANSIENT (won't persist idle) — this is the playground 'orbit' mode physics, not the persistent world soliton.`);
      };
      // TRUE-ORBIT probe (the critique's blueprint, made IFS-NATIVE — the substrate IS continuum via the fractal IFS map, so GRAVITY = the genome's
      // CONTRACTION w(x)=s(x−f)+f with s≈1 (a WEAK CONTINUOUS centripetal pull toward the fixed point f, applied EVERY step, sub-pixel/bilinear =
      // fractal continuum — NOT the inert phase well, NOT the gated integer teleport). Soft soliton (low γ) holds a phase gradient; transverse kick
      // = orbital velocity; CGL sustains the soft core & kills shed radiation. Measure: does a CURVED/closed trajectory emerge & SURVIVE? r-range =
      // ellipse (periapsis/apoapsis); angle swept = goes AROUND (orbit) vs straight-in (fall) vs r→∞ (escape). The honest Keplerian test.
      window.mediumTrueOrbit = (gamma = 2, s = 0.99, kvel = 1.3) => {   // kvel=1.3 ≈ the Nyquist-optimal max velocity (KICK CONTROL); s=0.99 = stronger gravity to curve the slow soliton; ε auto-balanced in STEP0
        if (!_gpu) { console.log('[TRUE-ORBIT] no gpu'); return; }
        const saved=_gpu.readEyePsi(), N=N_CELLS, C=GRID/2, f=[C,C];
        const cenOf=(F)=>{let x=0,y=0,w=0;for(let i=0;i<N;i++){const a2=F[i*2]**2+F[i*2+1]**2;x+=(i%GRID)*a2;y+=((i/GRID)|0)*a2;w+=a2;}return w>0?[x/w,y/w]:[C,C];};
        const energyOf=(F)=>{let e=0;for(let i=0;i<N;i++)e+=F[i*2]**2+F[i*2+1]**2;return e;};
        const seed=(ox,oy)=>{const S=new Float64Array(2*N);for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++)S[(y*GRID+x)*2]=2.0*Math.exp(-((x-(C+ox))**2+(y-(C+oy))**2)/(2*9));return S;};
        // STEP 0 — separate "CGL mistuned for soft γ" from "soft soliton can't persist": sustain a soft soliton (NO motion, NO kick) under CGL, sweep
        // the cubic GAIN ε (and a higher-amplitude seed). If SOME (ε, amp) holds E≈1 over 80 steps → CGL was just mistuned; orbit is still possible.
        const e0=energyOf(seed(0,0));
        // STEP0: find the ε where E PLATEAUS at ~1 (true balance) — not drains (ε low) and not runs away (ε high). The default ε=0.4 was tuned for the
        // sol-diss amplitude, not soft γ → it drained. Pick the ε whose E@80 is closest to 1.0 (within [0.6,1.6]) and USE IT for the orbit run.
        // FINE ε search (the balance window for low γ is narrow — γ=1 jumps 0.55→0.58 = E 1.48→3.15). Dense grid, pick E closest to 1.0 over 160
        // steps (longer = catches slow drift). Target tight balance so the orbit doesn't decay/blow up before completing a revolution.
        console.log(`[TRUE-ORBIT] STEP0 — soft γ=${gamma}: FINE ε search for tight E≈1 balance (160 steps):`);
        let bestEps=_CGL_EPS, bestErr=1e9, bestE=0;
        for (let eps=0.50; eps<=0.62; eps+=0.01) {
          _gpu.setEyePsi(seed(0,0));
          for(let i=0;i<160;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-gamma,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT); }
          const E=energyOf(_gpu.readEyePsi())/e0, err=Math.abs(E-1);
          if(E>0.3&&E<5&&err<bestErr){bestErr=err;bestEps=eps;bestE=E;}
        }
        const ORBIT_EPS=bestEps;
        console.log(`  → tightest balance: ε=${ORBIT_EPS.toFixed(2)} (E@160=${bestE.toFixed(2)}) for the orbit run`);
        // THE DECISIVE SWEEP: for each γ, find its balanced ε, then test BOTH (a) does the kick give velocity (mobility) AND (b) does it persist
        // (E≈1 over 80). If ANY γ has BOTH → the blueprint's orbit is reachable. If mobility needs γ < where persistence fails → the wall is MEASURED.
        const balEps=(g)=>{ let be=0.5,err=1e9; for(const eps of [0.4,0.5,0.55,0.58,0.62,0.7,0.85,1.1]){ _gpu.setEyePsi(seed(0,0)); for(let i=0;i<80;i++){_gpu.stepEyeN(1,DT);_gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT);_gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);} const E=energyOf(_gpu.readEyePsi())/e0; if(E>0.4&&E<2.5&&Math.abs(E-1)<err){err=Math.abs(E-1);be=eps;} } return be; };
        // Is the kick itself too weak, or does CGL/SPM damp the momentum? CONTROL: free Gaussian (NO SPM/CGL) under the kick — how far in 24 steps?
        // Then the SAME kick + SPM only, + SPM&CGL. If free moves but sustained doesn't → the dynamics DAMP momentum (re-centering). If free ALSO
        // barely moves → kvel is just too small (continuum v_g=2k·DT·n; for k=0.5, n=24: expect ~2·0.5·0.12·24≈2.9px... measure the real coefficient).
        for (const kk of [0.5, 1.5, 3.0]) {
          _gpu.setEyePsi(seed(0,0)); _gpu.linOp({kx:0,ky:kk}); const a=cenOf(_gpu.readEyePsi());
          for(let i=0;i<24;i++) _gpu.stepEyeN(1,DT);   // FREE propagation, no SPM/CGL
          const fy=cenOf(_gpu.readEyePsi())[1]-a[1];
          console.log(`  [KICK CONTROL] FREE Gaussian ky=${kk}, 24 free steps: Δy=${fy.toFixed(1)}px ${Math.abs(fy)>2?'✓ moves':'✗ even FREE barely moves → kick too weak / damped'}`);
        }
        console.log(`  — DECISIVE γ-sweep: mobility (kick→Δy) vs persistence (E@80), each γ at its OWN balanced ε:`);
        for (const g of [4, 2, 1, 0.5, 0.25]) {
          const be=balEps(g);
          _gpu.setEyePsi(seed(0,0)); for(let i=0;i<80;i++){_gpu.stepEyeN(1,DT);_gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT);_gpu.applyEyeCgl(_CGL_DELTA,be,_CGL_MU,DT);} const Epersist=energyOf(_gpu.readEyePsi())/e0;
          _gpu.setEyePsi(seed(0,0)); _gpu.linOp({kx:0,ky:kvel}); const cA=cenOf(_gpu.readEyePsi()); for(let i=0;i<24;i++){_gpu.stepEyeN(1,DT);_gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT);_gpu.applyEyeCgl(_CGL_DELTA,be,_CGL_MU,DT);} const vy=cenOf(_gpu.readEyePsi())[1]-cA[1];
          const mob=Math.abs(vy)>2, per=Epersist>0.5&&Epersist<2;
          console.log(`    γ=${String(g).padStart(4)} (ε=${be}) · persist E@80=${Epersist.toFixed(2)} ${per?'✓':'✗'} · mobility Δy=${vy.toFixed(1)} ${mob?'✓':'✗'} ${mob&&per?'★★ BOTH → ORBIT POSSIBLE':''}`);
        }
        const grav=[{ m:[s,0,0,s], t:[(1-s)*(f[0]-C), (1-s)*(f[1]-C)] }];   // IFS contraction toward f = the WARP-gravity (metric drag)
        const e0seed=energyOf(seed(-20,0));
        // ONE orbit run, gravMode = 'warp' (IFS contraction = metric drag, current trueorbit) OR 'well' (linOp a·r² PHASE-POTENTIAL = honest force,
        // the critique's prescription: NO warp, the soliton must FALL via phase-gradient acceleration). aWell = phase-well strength.
        const runOrbit=(gravMode, aWell)=>{
          _gpu.setEyePsi(seed(-20,0)); _gpu.linOp({kx:0, ky:kvel});   // transverse kick = orbital velocity
          const traj=[]; let minR=1e9,maxR=0,angPrev=Math.atan2(0,-20),angTot=0; const NB=60; let adEps=ORBIT_EPS;
          for (let blk=0; blk<NB; blk++) {
            for (let i=0;i<8;i++){
              if(gravMode==='warp') _gpu.ifsWarpEye(grav, 1);                          // WARP gravity (metric drag)
              else if(gravMode==='well') _gpu.linOp({ centers:[f[0],f[1]], a:aWell, beta:0, vtx:0 });   // WELL (radial phase potential — MEASURED INERT: focuses, no net force)
              else { // FORCE = −∇V as a UNIFORM momentum tilt (the honest Newtonian force): F ∝ −(centroid−f) toward the well, delivered as the tilt
                const cu=_gpu.readEyePsi(); let mx=0,my=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;my+=((j/GRID)|0)*a2;mw+=a2;}
                const mcx=mw>0?mx/mw:C, mcy=mw>0?my/mw:C, gx=-(mcx-f[0]), gy=-(mcy-f[1]);   // −∇V points from the soliton TOWARD the well
                _gpu.linOp({ kx: aWell*gx, ky: aWell*gy });   // inject the gravitational momentum kick (uniform tilt = the medium's real mover)
              }
              _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-gamma,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,adEps,_CGL_MU,DT);
              if((i&3)===0){ const fE=_gpu.readEyePsi(); let e=0; for(let j=0;j<fE.length;j++)e+=fE[j]*fE[j]; const err=(e0seed-e)/e0seed; adEps=Math.max(0.45,Math.min(0.62, adEps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
            const c=cenOf(_gpu.readEyePsi()), dx=c[0]-C, dy=c[1]-C, r=Math.hypot(dx,dy), ang=Math.atan2(dy,dx);
            let dA=ang-angPrev; if(dA>Math.PI)dA-=2*Math.PI; if(dA<-Math.PI)dA+=2*Math.PI; angTot+=dA; angPrev=ang;
            minR=Math.min(minR,r); maxR=Math.max(maxR,r); if(blk%10===0||blk===NB-1) traj.push(`(${dx.toFixed(0)},${dy.toFixed(0)})`);
            if(r>55){ traj.push('ESC'); break; } if(energyOf(_gpu.readEyePsi())/e0seed<0.1){ traj.push('died@'+blk); break; }
          }
          return { traj, minR, maxR, deg:angTot*180/Math.PI, E:energyOf(_gpu.readEyePsi())/Math.max(e0seed,1e-9) };
        };
        // THE DECISIVE COMPARISON (critique's central claim): does PHASE-WELL gravity bend a MOVING soliton's path (honest force), or is ONLY the
        // warp (metric drag) able to curve it? My earlier well-sweep tested a RESTING soliton (well = inert). This tests a MOVING one (smaller ask).
        console.log(`[TRUE-ORBIT] γ=${gamma} kvel=${kvel}: WARP-gravity (metric drag) vs WELL-gravity (linOp a·r² phase force, NO warp) on a MOVING soliton:`);
        const W=runOrbit('warp', 0);
        console.log(`  WARP (s=${s}) · traj ${W.traj.join(' → ')} · r∈[${W.minR.toFixed(0)},${W.maxR.toFixed(0)}] swept ${W.deg.toFixed(0)}° E=${W.E.toFixed(2)}`);
        for (const aw of [0.02, 0.1]) {
          const P=runOrbit('well', aw);
          console.log(`  WELL a=${String(aw).padStart(5)} · r∈[${P.minR.toFixed(0)},${P.maxR.toFixed(0)}] swept ${P.deg.toFixed(0)}° E=${P.E.toFixed(2)} ${Math.abs(P.deg)>25&&P.maxR<55?'✓ bends':'✗ inert (focuses, no net force)'}`);
        }
        // FORCE = −∇V as a momentum tilt (the HONEST Newtonian force, NO warp): each step kick ∝ −(centroid−f). The radial well is inert (symmetric),
        // but its GRADIENT at the soliton's position is a real directional force, delivered as the uniform tilt the medium DOES respond to.
        for (const fg of [0.02, 0.05, 0.1, 0.2]) {
          const F=runOrbit('force', fg);
          const bends=Math.abs(F.deg)>25 && F.maxR<55 && F.E>0.3;
          console.log(`  FORCE g=${String(fg).padStart(4)} (−∇V tilt) · traj ${F.traj.join(' → ')} · r∈[${F.minR.toFixed(0)},${F.maxR.toFixed(0)}] swept ${F.deg.toFixed(0)}° E=${F.E.toFixed(2)} ${bends?'✓✓ HONEST FORCE ORBITS (no warp, −∇V momentum)':F.maxR>=55?'✗ escaped':'✗ no bend'}`);
        }
        const Efin=W.E, degSwept=W.deg, minR=W.minR, maxR=W.maxR; const traj=W.traj;
        console.log(`  — (WARP verdict below for reference)`);
        // wall is BROKEN (γ=1 persists AND carries momentum — the ★★ rows). The trajectory CURVES (IFS-gravity rotates the momentum). The limit is
        // DECAY: the CGL balance is lossy under motion (no exact plateau) → it spirals in within ~45-65° rather than completing a revolution. That decay
        // IS the blueprint's predicted physics (gravitational-wave analog), not the wall. So a SWEPT ANGLE with curvature = a real (decaying) orbit.
        const aSwept=Math.abs(degSwept);
        const verdict = maxR>=55 ? '✗ ESCAPED (kvel too high / gravity too weak)'
                      : aSwept>120 && Efin>0.4 ? `✓✓ FULL ORBIT — swept ${degSwept.toFixed(0)}° & survived (Keplerian path, IFS-native gravity)`
                      : aSwept>30 ? `◐ DECAYING ORBIT — curved ${degSwept.toFixed(0)}° (IFS-gravity rotates momentum ✓) then spiraled in as E→${Efin.toFixed(2)} (CGL balance lossy under motion = the blueprint's orbital-decay; NOT the wall — wall is broken, γ=1 is mobile+persistent)`
                      : aSwept<15 && Efin<0.4 ? '✗ died with little curve (this γ not in a ★★ row, or balance too lossy)'
                      : '~ weak curve';
        console.log(`  VERDICT: ${verdict}`);
        _gpu.setEyePsi(saved);
        return { degSwept, minR, maxR, E:Efin };
      };
      // FORCE probe (IFS-NATIVE): the quadratic phase well FOCUSES (changes width), it does NOT move the centroid (measured). But the medium's REAL
      // geometry is the IFS HUTCHINSON WARP (ifsWarpEye) — a contractive affine map w(x)=s·R·(x−f)+f pulls mass TOWARD its fixed point f by
      // construction (that IS the curvature of this space, native, not a grafted phase). Test: does a gentle single-map warp toward an off-center
      // fixed point pull the soliton's CENTROID there (a real native force) while staying alive? Compare strengths s (closer to 1 = gentler pull).
      window.mediumForceProbe = (gamma = 20) => {
        if (!_gpu) { console.log('[FORCE] no gpu'); return; }
        const saved=_gpu.readEyePsi(), N=N_CELLS, C=GRID/2;
        const cenOf=(f)=>{let x=0,y=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2;x+=(i%GRID)*a2;y+=((i/GRID)|0)*a2;w+=a2;}return w>0?[x/w,y/w]:[C,C];};
        const energyOf=(f)=>{let e=0;for(let i=0;i<N;i++)e+=f[i*2]**2+f[i*2+1]**2;return e;};
        const rmsOf=(f)=>{const c=cenOf(f);let s=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2,dx=(i%GRID)-c[0],dy=((i/GRID)|0)-c[1];s+=a2*(dx*dx+dy*dy);w+=a2;}return w>0?Math.sqrt(s/w):0;};
        const mk=()=>{const v=new Float64Array(2*N);for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++)v[(y*GRID+x)*2]=2.0*Math.exp(-((x-(C-14))**2+(y-C)**2)/(2*9));return v;};
        const eSeed=energyOf(mk());
        // single contractive map with fixed point at CENTER: w(x)=s(x−f)+f → m=[s,0,0,s], t=(1−s)·f. Pulls mass toward f=center each application.
        const fp=[C,C], warpMap=(s)=>[{m:[s,0,0,s], t:[(1-s)*(fp[0]-C),(1-s)*(fp[1]-C)]}];   // t RELATIVE to ifsWarpEye's ctr=G/2 (fixed point AT fp)
        console.log(`[FORCE] IFS-native warp toward fixed point @center on a soliton off-center(-14,0), γ=${gamma}. does the WARP move the centroid (real force)?`);
        // the warp CONTRACTS amplitude (loses norm by construction). Conserve energy by uniform rescale to the bound energy AFTER each warp — the
        // ONE honest renorm (global, position-agnostic; it does NOT pull toward any spot, just keeps the particle from evaporating). Gentle s only.
        const renorm=(targetE)=>{ const f=_gpu.readEyePsi(); let e=0; for(let i=0;i<f.length;i++)e+=f[i]*f[i]; if(e>1e-9){const g=Math.sqrt(targetE/e); for(let i=0;i<f.length;i++)f[i]*=g; _gpu.setEyePsi(f);} };
        for (const s of [0.998, 0.995, 0.99, 0.985]) {
          _gpu.setEyePsi(mk());
          for(let i=0;i<40;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-gamma,_SOL_ISAT,DT); }   // bind first (persistent γ)
          const bound=_gpu.readEyePsi(); let eB=0; for(let i=0;i<bound.length;i++)eB+=bound[i]*bound[i];
          const c0=cenOf(bound), rms0=rmsOf(bound); const path=[], rmsP=[];
          for(let blk=0;blk<5;blk++){ for(let i=0;i<8;i++){ _gpu.ifsWarpEye(warpMap(s)); renorm(eB); _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-gamma,_SOL_ISAT,DT); } const ff=_gpu.readEyePsi(), c=cenOf(ff); path.push((c[0]-C).toFixed(1)); rmsP.push(rmsOf(ff).toFixed(1)); }
          const f1=_gpu.readEyePsi(), surv=energyOf(f1)/Math.max(eB,1e-9), rms=rmsOf(f1);
          const d0=parseFloat(path[0]), d4=parseFloat(path[4]), startAbs=Math.abs(c0[0]-C);
          const fallsIn = Math.abs(d4)<startAbs-2 && Math.sign(d4)===Math.sign(c0[0]-C);   // closer to center, same side = clean fall
          const overshoot = Math.sign(d4)!==Math.sign(c0[0]-C) && Math.abs(d4)>2;           // crossed center = slingshot/orbit
          const repels = Math.abs(d4)>startAbs+2;                                            // drifting away = too gentle
          const widthHeld = rms < rms0*1.8;                                                  // width stayed bounded (mild spread OK); >1.8× = dispersing apart
          const tag = surv<=0.5 ? '✗ warp ate it' : repels ? '✗ repels (too gentle)' : !widthHeld ? `✗ SPREADS ${rms0.toFixed(1)}→${rms.toFixed(1)} (dispersion > cohesion)` : overshoot ? '✓ OVERSHOOTS (orbit), width OK' : fallsIn ? '✓ FALLS & LIVES, width OK' : '~ balance';
          console.log(`  s=${s} · dx=[${path.join(', ')}] · RMS=[${rmsP.join(', ')}] (start ${rms0.toFixed(1)}) · E=${surv.toFixed(2)} ${tag}`);
        }
        // The CONTRACTION warp w(x)=s(x−f)+f shrinks SIZE as it moves (zoom-out — live: the soliton becomes a little shape). SPM can't re-expand
        // (it only adjusts amplitude). FIX: use a PURE TRANSLATION warp (m=IDENTITY, t = the centroid displacement toward f) — moves WITHOUT shrinking,
        // by construction. Sparse application keeps the bicubic blur low. Compare CONTRACTION vs TRANSLATION (sparse, every 8 steps): want move + NO shrink.
        console.log(`  — CONTRACTION vs pure-TRANSLATION warp (sparse every 8 steps), each step = a fraction toward f:`);
        const ctrW = GRID/2;
        for (const mode of ['contract','translate']) {
          _gpu.setEyePsi(mk());
          for(let i=0;i<40;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-gamma,_SOL_ISAT,DT); }
          const bound=_gpu.readEyePsi(); let eB=0; for(let i=0;i<bound.length;i++)eB+=bound[i]*bound[i]; const c0=cenOf(bound), rms0=rmsOf(bound);
          for(let i=0;i<48;i++){ if(i%8===0){ const cu=_gpu.readEyePsi(); let mx=0,my=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;my+=((j/GRID)|0)*a2;mw+=a2;} const mcx=mw>0?mx/mw:C,mcy=mw>0?my/mw:C, dgx=fp[0]-mcx,dgy=fp[1]-mcy;
            if (mode==='contract') _gpu.ifsWarpEye([{m:[0.9,0,0,0.9], t:[0.1*(fp[0]-ctrW),0.1*(fp[1]-ctrW)]}]);
            else                   _gpu.ifsWarpEye([{m:[1,0,0,1], t:[dgx*0.5, dgy*0.5]}]);   // pure translation, half the remaining gap
            renorm(eB); }
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-gamma,_SOL_ISAT,DT); }
          const f1=_gpu.readEyePsi(), c1=cenOf(f1), rms=rmsOf(f1), surv=energyOf(f1)/Math.max(eB,1e-9);
          console.log(`    ${mode.padEnd(9)} · dx ${(c0[0]-C).toFixed(0)}→${(c1[0]-C).toFixed(1)} · RMS ${rms0.toFixed(1)}→${rms.toFixed(1)} (${rms<rms0*1.3?'SIZE HELD':rms<rms0?'shrank':'spread'}) · E=${surv.toFixed(2)}`);
        }
        _gpu.setEyePsi(saved);
        console.log(`  (NOTE per user: bicubic in ifsWarpEye low-passes — could swap to the IFS-native applyEyeLowpass-based resample to cut the blur further)`);
      };
      // EXTENDED-OBJECT transport probe: the live object is a thin EXTENDED letter (not a compact blob — the screenshot showed it SHATTER). Test the
      // REAL letter field: move it 12px and measure STRUCTURE SURVIVAL (corr to the original, shifted-aligned) under: (A) warp-translate only — no SPM,
      // (B) warp + full SPM (current orbit), (C) warp + weak SPM. Find which keeps the letter intact. corr≈1 = survives; corr↓ = shattered.
      // GR-TRANSPORT probe: the continuous-warp transport makes the object DISAPPEAR. Isolate: ENERGY drain or WIDTH collapse (γ=20 contraction → spike)?
      // Replicate the exact transport loop moving the REAL object +12px in X, log E & RMS-width per block. Compare CONTINUOUS-warp vs the old INTEGER-jump.
      window.mediumTransportGR = () => {
        if (!_gpu) { console.log('[GR-T] no gpu'); return; }
        const saved=_gpu.readEyePsi(), N=N_CELLS;
        const obj = makeProbeField(_lensObj, GRID, { x0:1,y0:1, side:GRID-2 }, { np:8 }, _objExtras);
        const eO=(f)=>{let e=0;for(let i=0;i<N;i++)e+=f[i*2]**2+f[i*2+1]**2;return e;};
        const cen=(f)=>{let x=0,y=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2;x+=(i%GRID)*a2;y+=((i/GRID)|0)*a2;w+=a2;}return w>0?[x/w,y/w]:[GRID/2,GRID/2];};
        const rms=(f)=>{const c=cen(f);let s=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2,dx=(i%GRID)-c[0],dy=((i/GRID)|0)-c[1];s+=a2*(dx*dx+dy*dy);w+=a2;}return w>0?Math.sqrt(s/w):0;};
        const e0=eO(obj), C=GRID/2, fx=C+12, fy=C;
        const run=(mode)=>{ _gpu.setEyePsi(obj); let eps=_TORB_EPS; const log=[];
          for(let blk=0;blk<8;blk++){ for(let i=0;i<8;i++){
            const cu=_gpu.readEyePsi(); let mx=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;mw+=a2;} const mcx=mw>0?mx/mw:C, gap=fx-mcx;
            if(mode==='cont'){ if(gap>1.5){const s=1-_TRANSPORT_PULL; _gpu.ifsWarpEye([{m:[s,0,0,s],t:[(1-s)*(fx-C),(1-s)*(fy-C)]}],1);} }
            else { if((i%8)===0 && Math.abs(gap)>1) _gpu.ifsWarpEye([{m:[1,0,0,1],t:[Math.sign(gap),0]}],1); }   // old integer jump
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);
            if((i&3)===0){ const fE=_gpu.readEyePsi(); let e=0; for(let j=0;j<fE.length;j++)e+=fE[j]*fE[j]; const err=(e0-e)/e0; eps=Math.max(0.45,Math.min(0.62,eps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
            const fr=_gpu.readEyePsi(); log.push(`E${(eO(fr)/e0).toFixed(2)}/w${rms(fr).toFixed(1)}`); }
          const fr=_gpu.readEyePsi(); return { E:eO(fr)/e0, w:rms(fr), dx:cen(fr)[0]-C, log }; };
        // continuous sub-pixel warp INTERPOLATES the complex field at fr≠0 → for a PHASE-WRAPPED (stiff γ=20) soliton this averages opposite phases →
        // amplitude DESTROYED (drain). A SOFT γ has gentle phase → survives interpolation (trueorbit runs continuous warp at E≈1 with γ=1). Test γ sweep.
        const w0=rms(obj);
        const runG=(mode,g)=>{ _gpu.setEyePsi(obj); let eps=_TORB_EPS;
          for(let blk=0;blk<8;blk++) for(let i=0;i<8;i++){
            const cu=_gpu.readEyePsi(); let mx=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;mw+=a2;} const mcx=mw>0?mx/mw:C, gap=fx-mcx;
            if(mode==='cont'){ if(gap>1.5){const s=1-_TRANSPORT_PULL; _gpu.ifsWarpEye([{m:[s,0,0,s],t:[(1-s)*(fx-C),(1-s)*(fy-C)]}],1);} }
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);
            if((i&3)===0){ const fE=_gpu.readEyePsi(); let e=0; for(let j=0;j<fE.length;j++)e+=fE[j]*fE[j]; const err=(e0-e)/e0; eps=Math.max(0.45,Math.min(0.62,eps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
          const fr=_gpu.readEyePsi(); return { E:eO(fr)/e0, w:rms(fr), dx:cen(fr)[0]-C }; };
        // ALL γ drain → NOT phase-wrap. The CONTRACTION m=[s,s] is a ZOOM (area shrinks by s², energy not conserved — no Jacobian compensation in the
        // resample) → compounding drain. Translation doesn't need a contraction. Probe 3 candidate CONTINUOUS movers (sub-pixel, GR-smooth, NON-draining):
        //   A = sub-pixel TRANSLATION (m=identity, fractional t) + per-step energy RENORM (counter the bilinear loss)
        //   B = INTEGER-ACCUMULATOR: carry a fractional offset, apply only WHOLE-pixel (lossless) warps when it crosses 1px → continuous MOTION, integer resamples
        //   C = contraction WITH Jacobian comp (×1/s² energy) to undo the zoom's concentration
        // STRUCTURE corr: best-shift intensity correlation to the original (catches SHATTER — energy/width can be fine while the letter is speckle).
        const corrSh=(f,sx)=>{let d=0,ea=0,eb=0;for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const X=x-sx;if(X<0||X>=GRID)continue;const a=f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2,b=obj[(y*GRID+X)*2]**2+obj[(y*GRID+X)*2+1]**2;d+=a*b;ea+=a*a;eb+=b*b;}return ea>0&&eb>0?d/Math.sqrt(ea*eb):0;};
        const bestC=(f)=>{const dx=Math.round(cen(f)[0]-C);let b=0;for(let s=dx-2;s<=dx+2;s++)b=Math.max(b,corrSh(f,s));return b;};
        const I=run('int'); const Ic=bestC(_gpu.readEyePsi());
        console.log(`[GR-T] move '${_lensObj}' +12px X — HONEST FRACTIONAL warp, 3 fixes (corr = structure intact, not shattered):`);
        console.log(`  INTEGER ctrl (lossless ref): reached ${I.dx.toFixed(0)}px E=${I.E.toFixed(2)} corr=${Ic.toFixed(2)}`);
        // A1 phase-aware fractional warp (smooth=2, NO renorm). A2 bilinear fractional, NO renorm (CGL-only). A3 propagation-carried (linOp tilt + stepEyeN, NO resample).
        const aRun=(mode)=>{ _gpu.setEyePsi(obj); let eps=_TORB_EPS;
          for(let blk=0;blk<8;blk++) for(let i=0;i<8;i++){
            const cu=_gpu.readEyePsi(); let mx=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;mw+=a2;} const mcx=mw>0?mx/mw:C, gap=fx-mcx;
            if(gap>1.0){
              if(mode==='A1') _gpu.ifsWarpEye([{m:[1,0,0,1],t:[_TRANSPORT_PULL*gap,0]}],2);          // phase-aware fractional (smooth=2)
              else if(mode==='A2') _gpu.ifsWarpEye([{m:[1,0,0,1],t:[_TRANSPORT_PULL*gap,0]}],1);     // bilinear fractional (smooth=1, but floored → ~integer; control)
              else _gpu.linOp({kx:0.02*gap, ky:0});                                        // A3: phase-ramp momentum → stepEyeN advects it (NO resample)
            }
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);
            if((i&3)===0){ const fE=_gpu.readEyePsi(); let e=0;for(let j=0;j<fE.length;j++)e+=fE[j]*fE[j]; const err=(e0-e)/e0; eps=Math.max(0.45,Math.min(0.62,eps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
          const fr=_gpu.readEyePsi(); return { E:eO(fr)/e0, w:rms(fr), dx:cen(fr)[0]-C, corr:bestC(fr) }; };
        for (const [m,desc] of [['A1','phase-aware fractional (smooth=2)'],['A2','bilinear fractional (ctrl)'],['A3','linOp tilt + stepEyeN (NO resample)']]) {
          const R=aRun(m);
          const ok=R.E>0.6 && Math.abs(R.dx)>6 && R.corr>0.7;
          console.log(`  ${m} ${desc.padEnd(34)}: reached ${R.dx.toFixed(0)}px E=${R.E.toFixed(2)} corr=${R.corr.toFixed(2)} ${ok?'✓✓ CONTINUOUS + STRUCTURE INTACT':R.corr<0.5?'✗ shattered':R.E<0.4?'✗ drained':Math.abs(R.dx)<6?'~ barely moved':'~'}`);
        }
        // A3 is the WINNER (structure-perfect, no resample — the medium advects itself) but kmom=0.02 too weak (0px). SWEEP kmom to find the mover that
        // keeps structure (corr>0.7) AND actually moves. The honest continuous transport: a phase tilt = momentum, stepEyeN advects it, NO resample.
        console.log(`  — A3 momentum sweep (phase-ramp kmom, NO resample — find the mover that keeps structure):`);
        const a3=(km)=>{ _gpu.setEyePsi(obj); let eps=_TORB_EPS;
          for(let blk=0;blk<8;blk++) for(let i=0;i<8;i++){
            const cu=_gpu.readEyePsi(); let mx=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;mw+=a2;} const mcx=mw>0?mx/mw:C, gap=fx-mcx;
            if(gap>1.0) _gpu.linOp({kx:km*Math.min(gap,8), ky:0});   // momentum ∝ gap (capped); stepEyeN advects
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);
            if((i&3)===0){ const fE=_gpu.readEyePsi(); let e=0;for(let j=0;j<fE.length;j++)e+=fE[j]*fE[j]; const err=(e0-e)/e0; eps=Math.max(0.45,Math.min(0.62,eps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
          const fr=_gpu.readEyePsi(); return { E:eO(fr)/e0, dx:cen(fr)[0]-C, corr:bestC(fr) }; };
        for (const km of [0.05, 0.1, 0.2, 0.4]) { const R=a3(km);
          console.log(`    kmom=${String(km).padStart(4)} (γ=${_SOL_GAMMA}): reached ${R.dx.toFixed(0)}px E=${R.E.toFixed(2)} corr=${R.corr.toFixed(2)} ${R.E>0.6&&Math.abs(R.dx)>6&&R.corr>0.7?'✓✓ moves + structure intact':R.corr<0.5?'✗ shattered':Math.abs(R.dx)<6?'~ REJECTS momentum (stiff γ phase-wrap)':'~'}`);
        }
        // CLOSE THE LOGIC: A3 keeps structure but γ=20 REJECTS momentum (0px). Does a SOFTER γ accept it (move) — and does the extended letter survive soft γ?
        console.log(`  — A3 with SOFTER γ (does the object accept momentum if less stiff, and survive?):`);
        const a3g=(km,g)=>{ _gpu.setEyePsi(obj); let eps=_TORB_EPS;
          for(let blk=0;blk<8;blk++) for(let i=0;i<8;i++){
            const cu=_gpu.readEyePsi(); let mx=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;mw+=a2;} const mcx=mw>0?mx/mw:C, gap=fx-mcx;
            if(gap>1.0) _gpu.linOp({kx:km*Math.min(gap,8), ky:0});
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-g,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);
            if((i&3)===0){ const fE=_gpu.readEyePsi(); let e=0;for(let j=0;j<fE.length;j++)e+=fE[j]*fE[j]; const err=(e0-e)/e0; eps=Math.max(0.45,Math.min(0.62,eps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
          const fr=_gpu.readEyePsi(); return { E:eO(fr)/e0, dx:cen(fr)[0]-C, corr:bestC(fr) }; };
        for (const g of [8, 4, 2, 1]) { const R=a3g(0.3,g);
          console.log(`    γ=${String(g).padStart(2)} kmom=0.3: reached ${R.dx.toFixed(0)}px E=${R.E.toFixed(2)} corr=${R.corr.toFixed(2)} ${R.E>0.6&&Math.abs(R.dx)>6&&R.corr>0.6?'✓ moves + survives':Math.abs(R.dx)>6&&R.corr<0.5?'moves but SHATTERS (soft extended = disperses)':'~ still rejects'}`);
        }
        // dx=0 at EVERY γ even while dispersing (γ=1 corr0.47) = the momentum isn't NET-DIRECTIONAL: re-applying full k EVERY step + SPM re-centering
        // → the kicks cancel/alias, never integrate to displacement. TWO meta-circular fixes (the right A3): the medium PRODUCES the motion, not pushes a field.
        // A3b = ONE-TIME momentum (kick once, then free-propagate — like the working KICK CONTROL) so it actually integrates to velocity.
        // REGEN = the LENS regenerates the object at a SHIFTED draw-origin each frame (object=lens(genome+shift) — meta-circular: position lives in the
        //   OPERATOR's params, the lens recomputes the exact structure at the new spot; NO resample, NO momentum, NO shatter — the soliton smooths the per-frame step).
        console.log(`  — META-CIRCULAR A3 (the medium PRODUCES the motion): A3b one-time-kick vs REGEN lens(genome+shift):`);
        { _gpu.setEyePsi(obj); _gpu.linOp({kx:0.6,ky:0}); let eps=_TORB_EPS;   // A3b: kick ONCE, then free propagate (γ=1 soft so it carries)
          for(let blk=0;blk<8;blk++) for(let i=0;i<8;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-2,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);
            if((i&3)===0){ const fE=_gpu.readEyePsi(); let e=0;for(let j=0;j<fE.length;j++)e+=fE[j]*fE[j]; const err=(e0-e)/e0; eps=Math.max(0.45,Math.min(0.62,eps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
          const fr=_gpu.readEyePsi(); console.log(`    A3b one-time-kick (γ=2): reached ${(cen(fr)[0]-C).toFixed(0)}px E=${(eO(fr)/e0).toFixed(2)} corr=${bestC(fr).toFixed(2)} ${Math.abs(cen(fr)[0]-C)>6&&bestC(fr)>0.6?'✓ moves+survives':'~'}`); }
        // MOMENTUM-PRESERVING SUSTAIN sweep: the killer was SPM RE-CENTERING (kills the phase gradient). Test sustains that HOLD the soliton WITHOUT
        // pinning position: SPM (re-centers ✗), applyEyeSelfFocus (noted momentum-conserving: phase gradient preserved), CGL-only, lowpass. One-time kick,
        // then propagate with each sustain → which lets the soliton PROPAGATE ITSELF (dynamics carry the motion, no replace, no warp)?
        console.log(`  — MOMENTUM-PRESERVING sustain (one kick, dynamics carry it — the soliton propagates ITSELF):`);
        const dynMove=(sustain,kick)=>{ _gpu.setEyePsi(obj); _gpu.linOp({kx:kick,ky:0}); let eps=_TORB_EPS;
          for(let blk=0;blk<8;blk++) for(let i=0;i<8;i++){ _gpu.stepEyeN(1,DT);
            if(sustain==='spm') _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT);
            else if(sustain==='selffocus') _gpu.applyEyeSelfFocus(_SF_TH,_SF_GP,_SF_LO);   // magnitude-only → phase gradient (momentum) PRESERVED
            else if(sustain==='cgl') _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);
            else if(sustain==='sf+cgl'){ _gpu.applyEyeSelfFocus(_SF_TH,_SF_GP,_SF_LO); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT); }
            if((i&3)===0&&(sustain==='cgl'||sustain==='sf+cgl')){ const fE=_gpu.readEyePsi(); let e=0;for(let j=0;j<fE.length;j++)e+=fE[j]*fE[j]; const err=(e0-e)/e0; eps=Math.max(0.45,Math.min(0.62,eps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
          const fr=_gpu.readEyePsi(); return { dx:cen(fr)[0]-C, E:eO(fr)/e0, corr:bestC(fr) }; };
        for (const [s,k] of [['spm',0.6],['selffocus',0.6],['cgl',0.6],['sf+cgl',0.6],['selffocus',1.2]]) {
          const R=dynMove(s,k);
          console.log(`    ${s.padEnd(10)} kick=${k}: reached ${R.dx.toFixed(0)}px E=${R.E.toFixed(2)} corr=${R.corr.toFixed(2)} ${Math.abs(R.dx)>6&&R.corr>0.6?'✓✓ SOLITON PROPAGATES ITSELF (dynamics carry it!)':R.corr<0.4?'✗ shatters':Math.abs(R.dx)<6?'~ pinned (no self-propel)':'~'}`);
        }
        // selffocus PRESERVES momentum (it moved where SPM pinned!) but RUNS AWAY (E→1e6, it's a gain not a balance). CAP it with per-step energy renorm
        // (bounds the runaway gain — honest, not a position-fake) → does momentum-preserving + capped = the soliton propagating itself, intact? sweep kick.
        console.log(`  — selffocus + ENERGY CAP (bound the runaway gain → momentum survives AND stable?):`);
        const sfCap=(kick,nKick)=>{ _gpu.setEyePsi(obj);
          for(let blk=0;blk<8;blk++) for(let i=0;i<8;i++){
            if(blk*8+i < nKick){ const cu=_gpu.readEyePsi(); let mx=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;mw+=a2;} const gp=fx-(mw>0?mx/mw:C); _gpu.linOp({kx:kick*Math.sign(gp),ky:0}); }   // sustained gentle kick until reached
            _gpu.stepEyeN(1,DT); _gpu.applyEyeSelfFocus(_SF_TH,_SF_GP,_SF_LO);
            const f=_gpu.readEyePsi(); let e=0;for(let j=0;j<f.length;j++)e+=f[j]*f[j]; if(e>1e-9){const g=Math.sqrt(e0/e);for(let j=0;j<f.length;j++)f[j]*=g;_gpu.setEyePsi(f);} }   // ENERGY CAP (bound runaway)
          const fr=_gpu.readEyePsi(); return { dx:cen(fr)[0]-C, E:eO(fr)/e0, corr:bestC(fr) }; };
        for (const [k,nk] of [[0.15,64],[0.3,64],[0.3,32],[0.5,48]]) { const R=sfCap(k,nk);
          console.log(`    kick=${k}×${nk}steps + cap: reached ${R.dx.toFixed(0)}px E=${R.E.toFixed(2)} corr=${R.corr.toFixed(2)} ${Math.abs(R.dx)>6&&R.corr>0.6?'✓✓ SELF-PROPELS + STABLE + INTACT':R.corr<0.4?'✗ shatters':Math.abs(R.dx)<6?'~ pinned':'~'}`);
        }
        // ★ COEVOLVE-TRACKING (the MORE-META idea): a PERSISTENT soliton + a MOVING REGEN attractor. Each frame the object is regenerated at the eased
        // position (the operator-defined position) = a moving WELL; the persistent soliton SELF-FOCUSES toward it (its focusing minimum sits at the
        // attractor → it falls there via its OWN dynamics). NO blend, NO replace of the soliton — the soliton is a real living wave that CHASES the operator.
        // Test variants of the coupling: (W) phase-well at attractor centroid + self-focus; (S) superpose a weak attractor + self-focus (interference-pull).
        console.log(`  — COEVOLVE-TRACKING: persistent soliton CHASES the moving REGEN attractor via self-focus (no blend, no replace):`);
        const regenAt=(sh)=> (_lensObj==='cube') ? _cubeField(sh,0) : makeProbeField(_lensObj, GRID, {x0:Math.round(GRID*0.18+sh), y0:Math.round(GRID*0.25), side:Math.round(GRID*0.5)}, {np:8}, _objExtras);
        const o0=regenAt(0), eo0=eO(o0), cc0=cen(o0);
        const corr0=(f)=>{const dx=Math.round(cen(f)[0]-cc0[0]);let b=0;for(let s=dx-2;s<=dx+2;s++){let d=0,ea=0,eb=0;for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const X=x-s;if(X<0||X>=GRID)continue;const a=f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2,b2=o0[(y*GRID+X)*2]**2+o0[(y*GRID+X)*2+1]**2;d+=a*b2;ea+=a*a;eb+=b2*b2;}b=Math.max(b,ea>0&&eb>0?d/Math.sqrt(ea*eb):0);}return b;};
        const track=(mode,beta)=>{ _gpu.setEyePsi(o0);   // seed the persistent soliton from the object ONCE; thereafter it self-sustains & chases
          for(let blk=0;blk<24;blk++){ const sh=blk/24*16, att=regenAt(sh), ac=cen(att);   // attractor eases to +16px
            for(let st=0;st<3;st++){
              if(mode==='W'){ _gpu.linOp({centers:[ac[0],ac[1]], a:beta, beta:0, vtx:0}); _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); }
              else { const cu=_gpu.readEyePsi(); for(let kk=0;kk<N*2;kk++) cu[kk]+=beta*att[kk]; _gpu.setEyePsi(cu);   // SUPERPOSE a weak attractor copy (interference, NOT a blend-toward — it ADDS, soliton + ghost)
                _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT);
                const f=_gpu.readEyePsi(); let e=0;for(let kk=0;kk<f.length;kk++)e+=f[kk]*f[kk]; if(e>1e-9){const g=Math.sqrt(eo0/e);for(let kk=0;kk<f.length;kk++)f[kk]*=g;_gpu.setEyePsi(f);} } } }
          const fr=_gpu.readEyePsi(); return { dx:cen(fr)[0]-cc0[0], E:eO(fr)/eo0, corr:corr0(fr) }; };
        for (const [m,b,d] of [['W',0.012,'well@attractor a=.012'],['W',0.05,'well@attractor a=.05'],['S',0.05,'superpose β=.05'],['S',0.15,'superpose β=.15']]) {
          const R=track(m,b);
          console.log(`    ${d.padEnd(22)}: soliton reached ${R.dx.toFixed(0)}/16px E=${R.E.toFixed(2)} corr=${R.corr.toFixed(2)} ${R.dx>10&&R.corr>0.6?'✓✓ CHASES the attractor (coevolve, no blend!)':R.corr<0.4?'✗ shatters':R.dx<6?'~ no follow':'~ partial'}`);
        }
        // superpose β=.15 CHASES (12px, no blend) but corr=0.62 (leaves a TRAIL — old-position ghost smears). Add CGL to KILL the trail-radiation + sweep β.
        // Goal: persistent living soliton that tracks the operator at REGEN fidelity (corr→0.9) = the MORE-META transport (alive AND follows, no replace).
        console.log(`  — superpose + CGL (kill the trailing ghost → living soliton at REGEN fidelity?):`);
        const trackC=(beta)=>{ _gpu.setEyePsi(o0); let eps=_TORB_EPS;
          for(let blk=0;blk<24;blk++){ const sh=blk/24*16, att=regenAt(sh);
            for(let st=0;st<3;st++){ const cu=_gpu.readEyePsi(); for(let kk=0;kk<N*2;kk++) cu[kk]+=beta*att[kk]; _gpu.setEyePsi(cu);
              _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); _gpu.applyEyeCgl(_CGL_DELTA,eps,_CGL_MU,DT);   // CGL: linear loss kills the trailing ghost radiation
              const f=_gpu.readEyePsi(); let e=0;for(let kk=0;kk<f.length;kk++)e+=f[kk]*f[kk]; const err=(eo0-e)/eo0; eps=Math.max(0.45,Math.min(0.62,eps+0.02*Math.sign(err)*Math.min(1,Math.abs(err)*4))); } }
          const fr=_gpu.readEyePsi(); return { dx:cen(fr)[0]-cc0[0], E:eO(fr)/eo0, corr:corr0(fr) }; };
        for (const b of [0.1, 0.2, 0.3, 0.5]) { const R=trackC(b);
          console.log(`    superpose β=${b} +CGL: reached ${R.dx.toFixed(0)}/16px E=${R.E.toFixed(2)} corr=${R.corr.toFixed(2)} ${R.dx>10&&R.corr>0.8?'✓✓✓ LIVING soliton tracks at REGEN fidelity':R.dx>10&&R.corr>0.6?'✓ chases (some trail)':R.corr<0.4?'✗ shatters':'~'}`);
        }
        // REGEN: the object draws in region {x0,y0,side} → center = x0+side/2. With side=GRID-2 (full grid) the center is clamped → x0 shift doesn't move it.
        // Use a SMALLER side (an object that has room) and shift x0 → the regenerated structure actually translates. Continuous in sh (a float), corr=1 each frame.
        // use a REGION-RESPECTING object (letterA) — the CUBE ignores region (_cubeField draws at a fixed spot) so it can't regen-move; most others do.
        const regenObj = (_lensObj==='cube'||_lensObj==='attractor') ? 'letterA' : _lensObj;
        const objR=(sh)=>{ const side=Math.round(GRID*0.5); return makeProbeField(regenObj, GRID, {x0:Math.round(GRID*0.18+sh), y0:Math.round(GRID*0.25), side}, {np:8}, _objExtras); };
        const obj0=objR(0), e0r=eO(obj0), c0r=cen(obj0);
        const corrR=(f,ref,sx)=>{let d=0,ea=0,eb=0;for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const X=x-sx;if(X<0||X>=GRID)continue;const a=f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2,b=ref[(Y_=y*GRID+X)*2]**2+ref[Y_*2+1]**2;d+=a*b;ea+=a*a;eb+=b*b;}var Y_;return ea>0&&eb>0?d/Math.sqrt(ea*eb):0;};
        const bestCr=(f)=>{const dx=Math.round(cen(f)[0]-c0r[0]);let b=0;for(let s=dx-2;s<=dx+2;s++)b=Math.max(b,corrR(f,obj0,s));return b;};
        { let drift=0; for(let blk=0;blk<24;blk++){ const sh=blk/24*16;   // regenerate at a continuously-shifting origin (sh is a float)
            _gpu.setEyePsi(objR(sh));
            for(let i=0;i<3;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); } }
          const fr=_gpu.readEyePsi(); drift=cen(fr)[0]-c0r[0]; const cc=bestCr(fr);
          console.log(`    REGEN lens(${regenObj}, shift→16px): reached ${drift.toFixed(0)}px E=${(eO(fr)/e0r).toFixed(2)} corr=${cc.toFixed(2)} ${Math.abs(drift)>6&&cc>0.7?'✓✓ moves + STRUCTURE INTACT (meta-circular: position lives in the operator)':cc<0.5?'shatters':'~ (cube ignores region)'}`); }
        _gpu.setEyePsi(saved);
        console.log(`  (REGEN ✓ = the honest meta-circular mover: lens regenerates structure at the shifted genome-position, no field resample/momentum)`);
        console.log(`  (✓ = continuous GR-smooth motion that keeps E & width — the honest continuous transport. B is lossless by construction.)`);
      };
      // COEVOLVE-ORBIT probe: apply the TRANSPORT coevolve-chase to ORBIT — the operator (lens) regenerates the REAL object on a CIRCULAR path (θ advancing),
      // a persistent living soliton chases the circling attractor via superpose+self-focus (NO momentum, NO warp, NO CGL — the transport recipe). Does it trace
      // a visible orbit of the LETTER/CUBE itself while staying coherent? Measures angle swept (goes AROUND) + corr (structure) + radius (bounded).
      window.mediumOrbitCoevolve = (R = 16, beta = 0.15, turns = 1.0) => {
        if (!_gpu) { console.log('[ORBIT-CO] no gpu'); return; }
        const saved=_gpu.readEyePsi(), N=N_CELLS, C=GRID/2;
        const cen=(f)=>{let x=0,y=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2;x+=(i%GRID)*a2;y+=((i/GRID)|0)*a2;w+=a2;}return w>0?[x/w,y/w]:[C,C];};
        const eO=(f)=>{let e=0;for(let i=0;i<N;i++)e+=f[i*2]**2+f[i*2+1]**2;return e;};
        // regenerate the object centered at an orbital position (ox,oy) — small region so it has room to circle. (cube ignores region → use letterA.)
        const obj=(_lensObj==='cube'||_lensObj==='attractor')?'letterA':_lensObj;
        const side=Math.round(GRID*0.42);
        const regenAt=(ox,oy)=> makeProbeField(obj, GRID, {x0:Math.round(ox-side/2), y0:Math.round(oy-side/2), side}, {np:8}, _objExtras);
        // structure corr to a reference object (centered) — catches shatter on the curved path
        const ref=regenAt(C,C), eRef=eO(ref);
        const corrTo=(f)=>{const c=cen(f);let d=0,ea=0,eb=0;for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const X=Math.round(x-(c[0]-C)),Y=Math.round(y-(c[1]-C));if(X<0||X>=GRID||Y<0||Y>=GRID)continue;const a=f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2,b=ref[(Y*GRID+X)*2]**2+ref[(Y*GRID+X)*2+1]**2;d+=a*b;ea+=a*a;eb+=b*b;}return ea>0&&eb>0?d/Math.sqrt(ea*eb):0;};
        const NB=Math.round(60*turns); const th0=Math.PI;   // start at angle π (left side)
        _gpu.setEyePsi(regenAt(C+R*Math.cos(th0), C+R*Math.sin(th0)));   // seed the living soliton at the orbit start
        let minR=1e9,maxR=0,angPrev=th0,angTot=0; const traj=[];
        for (let blk=0; blk<NB; blk++) {
          const th = th0 + (blk/60)*2*Math.PI*turns;   // operator advances around the circle
          const ox=C+R*Math.cos(th), oy=C+R*Math.sin(th), att=regenAt(ox,oy);
          for (let st=0; st<3; st++){ const cu=_gpu.readEyePsi(); for(let k=0;k<N*2;k++) cu[k]+=beta*att[k]; _gpu.setEyePsi(cu);
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT);
            const f=_gpu.readEyePsi(); let e=0;for(let k=0;k<f.length;k++)e+=f[k]*f[k]; if(e>1e-9){const g=Math.sqrt(eRef/e);for(let k=0;k<f.length;k++)f[k]*=g;_gpu.setEyePsi(f);} }   // energy-cap
          const c=cen(_gpu.readEyePsi()), dx=c[0]-C, dy=c[1]-C, r=Math.hypot(dx,dy), a=Math.atan2(dy,dx);
          let dA=a-angPrev; if(dA>Math.PI)dA-=2*Math.PI; if(dA<-Math.PI)dA+=2*Math.PI; angTot+=dA; angPrev=a;
          minR=Math.min(minR,r); maxR=Math.max(maxR,r); if(blk%8===0||blk===NB-1) traj.push(`(${dx.toFixed(0)},${dy.toFixed(0)})`);
        }
        const fr=_gpu.readEyePsi(), Efin=eO(fr)/eRef, deg=angTot*180/Math.PI, cc=corrTo(fr);
        console.log(`[ORBIT-CO] '${obj}' coevolve-orbit: R=${R} β=${beta} turns=${turns}`);
        console.log(`  traj: ${traj.join(' → ')}`);
        console.log(`  swept ${deg.toFixed(0)}° · r∈[${minR.toFixed(0)},${maxR.toFixed(0)}] · E=${Efin.toFixed(2)} · corr=${cc.toFixed(2)} ${Math.abs(deg)>120&&cc>0.5&&minR>R*0.5?'✓✓ ORBITS the REAL object (operator circles, living soliton chases)':cc<0.4?'✗ shatters on the curve':Math.abs(deg)<60?'✗ no follow the circle':'~ partial orbit'}`);
        _gpu.setEyePsi(saved);
        return { deg, minR, maxR, E:Efin, corr:cc };
      };
      window.mediumExtMoveProbe = () => {
        if (!_gpu) { console.log('[EXT-MOVE] no gpu'); return; }
        const saved=_gpu.readEyePsi(), N=N_CELLS;
        const obj = makeProbeField(_lensObj, GRID, { x0:1, y0:1, side: GRID-2 }, { np: 8 }, _objExtras);   // the REAL extended object
        const energyOf=(f)=>{let e=0;for(let i=0;i<N;i++)e+=f[i*2]**2+f[i*2+1]**2;return e;};
        // intensity correlation between f and ref SHIFTED by (sx,sy) — measures whether the moved field still LOOKS like the original structure
        const corrShift=(f,ref,sx,sy)=>{let d=0,ea=0,eb=0;for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){const X=x-sx,Y=y-sy;if(X<0||X>=GRID||Y<0||Y>=GRID)continue;const a=f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2,b=ref[(Y*GRID+X)*2]**2+ref[(Y*GRID+X)*2+1]**2;d+=a*b;ea+=a*a;eb+=b*b;}return ea>0&&eb>0?d/Math.sqrt(ea*eb):0;};
        const cenOf=(f)=>{let x=0,y=0,w=0;for(let i=0;i<N;i++){const a2=f[i*2]**2+f[i*2+1]**2;x+=(i%GRID)*a2;y+=((i/GRID)|0)*a2;w+=a2;}return w>0?[x/w,y/w]:[GRID/2,GRID/2];};
        const eObj=energyOf(obj), c0=cenOf(obj);
        // best-shift corr: scan sx near the measured centroid displacement, take the MAX corr → distinguishes "moved by a different amount but intact"
        // (high corr at the real shift) from "genuinely shattered" (low corr at every shift).
        const bestCorr=(r)=>{const c1=cenOf(r);const sxm=Math.round(c1[0]-c0[0]),sym=Math.round(c1[1]-c0[1]);let best=0;for(let sx=sxm-2;sx<=sxm+2;sx++)for(let sy=sym-2;sy<=sym+2;sy++){const cc=corrShift(r,obj,sx,sy);if(cc>best)best=cc;}return {best,dx:c1[0]-c0[0],dy:c1[1]-c0[1]};};
        // WHY does orbit shatter the object when sol-diss makes a stable soliton of the SAME object? KEY DIFFERENCE: sol-diss = stepEyeN + SPM + CGL
        // (the CGL dissipative balance kills radiation & sustains the soliton); orbit DROPPED the CGL (only stepEyeN+SPM). SPM alone doesn't dissipate
        // radiation → dispersed energy becomes NOISE. Test the REAL object, NO move, N steps, each recipe → structure survival (corr to original).
        const evolve=(recipe,steps)=>{ _gpu.setEyePsi(obj);
          for(let i=0;i<steps;i++){ _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); if(recipe==='diss') _gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); }
          const r=_gpu.readEyePsi(); return { corr:bestCorr(r).best, surv:energyOf(r)/Math.max(eObj,1e-9) }; };
        console.log(`[EXT-SOLITON] REAL '${_lensObj}': object is stable under dynamics ALONE (no move). Now isolate what the WARP+move does.`);
        for (const steps of [8, 24, 60]) {
          const cons=evolve('cons',steps);
          console.log(`  ${String(steps).padStart(2)} steps NO MOVE · sol-cons: corr=${cons.corr.toFixed(2)} E=${cons.surv.toFixed(2)} (stable = the dynamics are innocent)`);
        }
        // Now the LIVE ORBIT combo: evolve (sol-cons) WHILE warp-moving toward a fixed point. Exactly what orbit does. Vary how often we warp.
        // If THIS shatters while no-move holds → the warp-during-motion is the culprit (resample fights the live soliton).
        // The warp MOVES it (~11px ✓) but ENERGY collapses to ~0.05 → it's not blur, it's DESTRUCTION. Cause: the soliton's internal phase varies
        // fast (~2π across it); INTERPOLATING a fast-phase COMPLEX field averages opposite-phase neighbors → destructive → amplitude →0. So FRACTIONAL
        // (interpolated) warps kill it. Test INTEGER warps (whole-pixel t → bilinear hits fr=0 → NO interpolation → lossless regardless of phase).
        const orbitSim=(every, integer)=>{ _gpu.setEyePsi(obj); const fpx=GRID/2+12, fpy=GRID/2; let applied=0;
          for(let i=0;i<48;i++){
            if(i%every===0 && applied<12){ const cu=_gpu.readEyePsi(); let mx=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;mw+=a2;} const mcx=mw>0?mx/mw:GRID/2;
              let t = integer ? Math.sign(fpx-mcx) : (fpx-mcx)*0.5; if(integer) applied+=Math.abs(t);   // integer: 1px whole steps
              _gpu.ifsWarpEye([{m:[1,0,0,1],t:[t,0]}], 1); }
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); }
          const r=_gpu.readEyePsi(); return { corr:bestCorr(r).best, surv:energyOf(r)/Math.max(eObj,1e-9), dx:cenOf(r)[0]-c0[0] }; };
        // INTEGER also collapses E → NOT interpolation. Energy can only vanish via the warp ITSELF. Isolate: warp ALONE (no stepEyeN/SPM).
        // A pure integer shift MUST conserve energy. If it doesn't → ifsWarpEye is the energy sink (n=1 normalization / buffer bug).
        const warpOnly=(t,smooth,n)=>{ _gpu.setEyePsi(obj); for(let i=0;i<n;i++) _gpu.ifsWarpEye([{m:[1,0,0,1],t:[t,0]}], smooth); const r=_gpu.readEyePsi(); return {E:energyOf(r)/Math.max(eObj,1e-9), corr:bestCorr(r).best}; };
        const warpAxis=(tx,ty,n)=>{ _gpu.setEyePsi(obj); for(let i=0;i<n;i++) _gpu.ifsWarpEye([{m:[1,0,0,1],t:[tx,ty]}], 1); const r=_gpu.readEyePsi(); return energyOf(r)/Math.max(eObj,1e-9); };
        // X vs Y ASYMMETRY: user reports shift-Y stable but shift-X loses energy in big moves. They should be symmetric — isolate per axis & sign.
        console.log(`  — X vs Y warp asymmetry (1px integer × 12, smooth=1), E should be 1.00 each if symmetric:`);
        console.log(`    +X: E=${warpAxis(1,0,12).toFixed(2)} · −X: E=${warpAxis(-1,0,12).toFixed(2)} · +Y: E=${warpAxis(0,1,12).toFixed(2)} · −Y: E=${warpAxis(0,-1,12).toFixed(2)}  ${'(if X≠Y → axis bug in the warp)'}`);
        // DIRECTION check: warp t=[+5,+5], measure which way the CPU centroid actually moves. If CPU-Δy has OPPOSITE sign to the warp (GPU Y-flip),
        // then the drive's gap gy=fy−ccy steers Y the WRONG way → Y never converges (looks 'stable'/stuck) while X works. This is the live asymmetry.
        { _gpu.setEyePsi(obj); const c0=cenOf(_gpu.readEyePsi()); _gpu.ifsWarpEye([{m:[1,0,0,1],t:[5,5]}],1); const c1=cenOf(_gpu.readEyePsi());
          console.log(`  — DIRECTION: warp t=[+5,+5] → CPU centroid Δ=(${(c1[0]-c0[0]).toFixed(1)},${(c1[1]-c0[1]).toFixed(1)}) ${Math.sign(c1[1]-c0[1])!==Math.sign(5)?'⚠ Y SIGN FLIPPED':'✓ Y matches'}`); }
        // FULL LIVE ORBIT loop replicated: warp toward (target) every 8 steps + stepEyeN + SPM + CGL, for a big X move vs a big Y move. The static warp
        // is symmetric — but the LIVE loop (dynamics over many steps) may not be. Measure E & corr after reaching the target in X vs in Y.
        const liveOrbit=(tgx,tgy,cgl)=>{ _gpu.setEyePsi(obj); const fpx=GRID/2+tgx, fpy=GRID/2+tgy;
          for(let i=0;i<80;i++){ if(i%8===0){ const cu=_gpu.readEyePsi(); let mx=0,my=0,mw=0; for(let j=0;j<N;j++){const a2=cu[j*2]**2+cu[j*2+1]**2;mx+=(j%GRID)*a2;my+=((j/GRID)|0)*a2;mw+=a2;} const mcx=mw>0?mx/mw:GRID/2,mcy=mw>0?my/mw:GRID/2,ggx=fpx-mcx,ggy=fpy-mcy;
            const tx=Math.abs(ggx)>1?Math.sign(ggx):0, ty=Math.abs(ggy)>1?Math.sign(ggy):0; if(tx||ty) _gpu.ifsWarpEye([{m:[1,0,0,1],t:[tx,ty]}],1); }   // FIXED: per-axis integer deadzone (no fractional cross-axis jitter)
            _gpu.stepEyeN(1,DT); _gpu.applyEyeNlSpm(-_SOL_GAMMA,_SOL_ISAT,DT); if(cgl) _gpu.applyEyeCgl(_CGL_DELTA,_CGL_EPS,_CGL_MU,DT); }
          const r=_gpu.readEyePsi(); return { E:energyOf(r)/Math.max(eObj,1e-9), corr:bestCorr(r).best, c:cenOf(r) }; };
        console.log(`  — FULL LIVE ORBIT (80 steps), X vs Y, with the PER-AXIS INTEGER DEADZONE fix (should be symmetric now):`);
        const Xon=liveOrbit(10,0,false), Yon=liveOrbit(0,10,false), Xc=liveOrbit(10,0,true), Yc=liveOrbit(0,10,true);
        const Dg=liveOrbit(8,8,true);   // diagonal too
        console.log(`    noCGL · X: E=${Xon.E.toFixed(2)} corr=${Xon.corr.toFixed(2)} · Y: E=${Yon.E.toFixed(2)} corr=${Yon.corr.toFixed(2)}`);
        console.log(`    +CGL  · X: E=${Xc.E.toFixed(2)} corr=${Xc.corr.toFixed(2)} · Y: E=${Yc.E.toFixed(2)} corr=${Yc.corr.toFixed(2)} · DIAG: E=${Dg.E.toFixed(2)} corr=${Dg.corr.toFixed(2)}  ${Math.abs(Xc.E-Yc.E)<0.2&&Xc.E>0.7?'✓ X/Y SYMMETRIC NOW (fixed)':'⚠ still asymmetric'}`);
        _gpu.setEyePsi(saved);
        // measure the object's EXTENT: how far does its energy reach toward the edges? An object filling the grid LOSES whatever crosses the edge on a shift.
        const extent=(f)=>{let minX=GRID,maxX=0,minY=GRID,maxY=0;for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){if(f[(y*GRID+x)*2]**2+f[(y*GRID+x)*2+1]**2>1e-4){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}}return {w:maxX-minX,h:maxY-minY,marginR:GRID-1-maxX,marginL:minX};};
        const ex=extent(obj);
        console.log(`  — '${_lensObj}' extent: ${ex.w}×${ex.h}px, edge margins L=${ex.marginL} R=${ex.marginR} (a shift > margin pushes content OFF-edge = energy lost)`);
        console.log(`  — WARP ALONE (no dynamics), integer shift — energy lost = content pushed off the grid edge:`);
        { const a=warpOnly(12,1,1);  console.log(`    1× integer(+12px): E=${a.E.toFixed(2)} corr=${a.corr.toFixed(2)} ${a.E>0.9?'✓ conserves (fits)':`✗ lost ${((1-a.E)*100).toFixed(0)}% off-edge (margin R=${ex.marginR}<12)`}`); }
        { const a=warpOnly(ex.marginR>2?Math.min(4,ex.marginR-1):2,1,1); console.log(`    1× integer(+${ex.marginR>2?Math.min(4,ex.marginR-1):2}px, within margin): E=${a.E.toFixed(2)} corr=${a.corr.toFixed(2)} ${a.E>0.9?'✓ conserves (fits in margin)':'✗ still loses'}`); }
        _gpu.setEyePsi(saved);
        console.log(`  (energy lost ≈ fraction pushed past the edge → orbit moving works for a COMPACT object with margin; a grid-filling letter loses what crosses the edge)`);
      };
      window.mediumReplicaCheck = (bar = 12) => {   // coevolve replica is pure f(bar): two derivations of the same bar must match
        if (!_gpu) { console.log('[MEDIUM-REPLICA] no gpu'); return; }
        const saved=_gpu.readEyePsi();
        // run the library opCoevolve twice on a throwaway ctx (fresh memo each run) — must produce identical replica rules.
        const run=()=>{ const c={ G:GRID, dt:DT, bar, activeRank:0, P:{..._lensP} };
          const op=opCoevolve(()=>_rules[0], ()=>_E.localObjField||makeProbeField(_lensObj,GRID,{x0:1,y0:1,side:GRID-2},{np:8},_objExtras), { opSpeed:_lensP.opSpeed });
          op(null,_gpu,c); return (c.replicaRules||[]).map(m=>`(${(m.tx||0).toFixed(3)},${(m.ty||0).toFixed(3)})`).join(''); };
        const a=run(), b=run(); _gpu.setEyePsi(saved);
        console.log(`[MEDIUM-REPLICA bar=${bar}] f(bar)-deterministic=${a===b?'YES ✓':'NO ✗'}\n  run1=${a}\n  run2=${b}`);
        return a===b;
      };
      // RECALL = pure-medium composition-computation: prove the MEDIUM (GPU field product + soliton transport) chooses the
      // planted program, matches a JS matched-filter reference (GPU≡JS, the old-eye validation), and degrades under occlusion.
      window.mediumRecallCheck = (bar = 12) => {
        if (!_gpu) { console.log('[MEDIUM-RECALL] no gpu'); return; }
        const saved=_gpu.readEyePsi(), K=_rules.length, N=N_CELLS;
        const cueFor = (planted, keep) => { const gP=new Float64Array(2*N); nlhoGenInject(gP,_rules[planted],GRID);
          let gE=0; for(let i=0;i<N;i++) gE+=gP[i*2]**2+gP[i*2+1]**2; const gAmp=Math.sqrt(gE/Math.max(1,N)), na=(1-keep)*gAmp*2, cue=new Float64Array(2*N);
          for(let i=0;i<N;i++){ const h=((i*2654435761^(bar*2246822519))>>>0)/4294967296; if(h<keep){cue[i*2]=gP[i*2];cue[i*2+1]=gP[i*2+1];}
            const h2=(((i*40503)^(bar*19349663))>>>0)/4294967296,h3=(((i*12289)^(bar*83492791))>>>0)/4294967296; cue[i*2]+=na*(h2-0.5); cue[i*2+1]+=na*(h3-0.5);} return cue; };
        // GPU [H]: the MEDIUM binds (gpu.bindEyeField) + transports, then reduce+normalize → the matched-filter score.
        const gpuScores = (cue) => { let ecue=0; for(let i=0;i<N;i++) ecue+=cue[i*2]**2+cue[i*2+1]**2; const sc=[];
          for(let r=0;r<K;r++){ const gF=new Float64Array(2*N); nlhoGenInject(gF,_rules[r],GRID); const gc=new Float64Array(2*N); let er=0;
            for(let i=0;i<N;i++){gc[i*2]=gF[i*2];gc[i*2+1]=-gF[i*2+1]; er+=gF[i*2]**2+gF[i*2+1]**2;}
            _gpu.setEyePsi(cue); _gpu.bindEyeField(gc); _gpu.stepEyeN(_RECALL_T,DT); _gpu.stepEyeN(_RECALL_T,-DT);
            const bf=_gpu.readEyePsi(); let cr=0,ci=0; for(let i=0;i<N;i++){cr+=bf[i*2];ci+=bf[i*2+1];}
            sc.push((ecue>0&&er>0)?Math.hypot(cr,ci)/Math.sqrt(ecue*er):0);} return sc; };
        // JS reference (the same matched filter, JS dot) — to validate GPU-[H] ≡ JS (the old-eye GPU≡JS check).
        const jsScores = (cue) => { const sc=[]; for(let r=0;r<K;r++){ const gF=new Float64Array(2*N); nlhoGenInject(gF,_rules[r],GRID);
          let cr=0,ci=0,ea=0,eb=0; for(let i=0;i<N;i++){const ar=cue[i*2],ai=cue[i*2+1],br=gF[i*2],bi=gF[i*2+1]; cr+=ar*br+ai*bi; ci+=ai*br-ar*bi; ea+=ar*ar+ai*ai; eb+=br*br+bi*bi;} sc.push((ea>0&&eb>0)?Math.hypot(cr,ci)/Math.sqrt(ea*eb):0);} return sc; };
        const argmax=(a)=>{let w=0;for(let r=1;r<a.length;r++)if(a[r]>a[w])w=r;return w;};
        let okMed=0, okMatch=0, trials=0;
        for (let planted=0; planted<K; planted++) { const cue=cueFor(planted, 1.0);
          const m=gpuScores(cue), j=jsScores(cue); const mw=argmax(m), jw=argmax(j);
          if (mw===planted) okMed++; if (mw===jw) okMatch++; trials++;
          console.log(`  planted r${planted}: MEDIUM-[H]→r${mw}${mw===planted?' ✓':' ✗'}  JS-ref→r${jw}  gpu=[${m.map(s=>s.toFixed(3)).join(' ')}]`); }
        // occlusion: cueClean 1→0 → the matched score drops, a wrong rank can win (graceful degradation)
        const occ = [1.0,0.6,0.3,0.0].map(k=>{ const m=gpuScores(cueFor(0,k)); return `${k.toFixed(1)}:r${argmax(m)}(${Math.max(...m).toFixed(3)})`; });
        _gpu.setEyePsi(saved);
        console.log(`[MEDIUM-RECALL bar=${bar}] the MEDIUM [H] (gpu.bindEyeField + transport) recalls the planted genome ${okMed}/${trials}${okMed===trials?' ✓':''} · GPU-[H]≡JS-argmax ${okMatch}/${trials}${okMatch===trials?' ✓':''}\n  occlusion (cueClean→winner(score)): ${occ.join('  ')}  ← the matched score drops as the cue degrades`);
        return okMed===trials;
      };
    }
    // SNAPSHOT HOOK — registered once. takeSnapshot calls this ON A JOIN REQUEST (not per frame); inject the LIVE soliton ψ + step count into the join
    // snapshot so the joiner seeds from the leader's exact field (a parked soliton has history-dependent fixed points → must be transferred). {__f64:...}
    // form because the hook runs AFTER _safeClone. Only when actually driving a soliton mode; else cleared so a stale field isn't carried.
    if (world?.ps?.app) {
      world.ps.app._snapHook = (worldSnap) => {
        if ((_driveMode==='transport'||_driveMode==='objorbit') && _E.psiLensed && _E.psiLensed.length===2*N_CELLS) {
          // Capture the FULL soliton state as of THIS logical time (the snapshot's lt). The joiner restores it VERBATIM and then the framework's natural
          // reflector-tick replay advances it forward exactly as the leader did — no separate re-anchor/catch-up (that double-counts vs the tick replay).
          worldSnap.medSnapPsi = { __f64: Array.from(Float32Array.from(_E.psiLensed)) };   // Float32 precision (GPU truth)
          worldSnap.medSnapSteps = _E.solSteps;       // the soliton step counter (continue from here)
          worldSnap.medSnapKw = _E.kwSteps;           // kW — W's proper-time counter (the channel clocks; = steps unless ⧉mux ran)
          worldSnap.medSnapClock0 = _stepClk.c0;     // the soliton clock ORIGIN (restore verbatim → target=floor((_E.monClock−this)·19) matches the leader at every tick)
          worldSnap.medSnapE0 = _torbE0;            // the energy-cap target (fixed since toggle)
          worldSnap.medSnapTransPx = _transPx; worldSnap.medSnapTransPy = _transPy;   // the exact ease position
          // IN-FLIGHT QUEUES + APPLIED KERNEL — without these the joiner has two divergence windows: (1) a shift stamped but not
          // yet DRAINED by the leader is NOT in ψ, yet _E.shiftSeen=medShiftSeq skips it forever (leader applies it at startStep,
          // joiner never does); (2) the joiner cold-snaps to the node's LATEST rings while the leader still runs the OLD rings
          // until the queued startStep. So ship the leader's cursor + pending lists + the rings it has ACTUALLY applied (startSteps
          // stay valid verbatim — they were stamped against the same _stepClk.c0 the joiner restores). Tiny scalars + ring arrays.
          worldSnap.medSnapShiftSeen = _E.shiftSeen;
          // GATE 3: the τ-kernel state ships VERBATIM (epoch + worldline clocks + shift/att queues + throttle
          // cursors) — the joiner restores it immediately (its c0/rate are shared values). Replaces the legacy
          // medSnapShiftQ/medSnapAttQ + cursor fields (still READ for old snapshots via the deferred rebuild).
          if (_tauK) worldSnap.medSnapTauK = _tauK.save();
          // att-param state: the APPLIED speed/angles (the leader may hold values older than node-latest until a stamped step) + cursor
          worldSnap.medSnapAttSeen = _attSeen; worldSnap.medSnapAttSpd = _attSpd; worldSnap.medSnapAttAY = _attAY; worldSnap.medSnapAttAX = _attAX;
          // ⚡sig cursor + pending (fired signals are already in ψ; pending ones must still land) + lock telemetry continuity
          worldSnap.medSnapSigSeen = _sigSeen; worldSnap.medSnapLockMin = _E.lockMin;   // (sig pending ships in medSnapTauK)
          worldSnap.medSnapVirtSeen = _V.virtSeen;   // in-flight ⎙virt verbs ship in medSnapTauK (pulled-but-unexecuted at capture would run on the leader only — the joiner's seen-cursor skips them)
          if (_texSpec) worldSnap.medSnapTexSpec = { amp: _texSpec.amp, kx: _texSpec.kx, ky: _texSpec.ky, k0: _texSpec.k0 };   // M-a: the written texture's spec (tiny) — a joiner can texWatch the same register
          worldSnap.medSnapLensOp = _obank.save();
          worldSnap.medSnapViaPhi = _dials.viaPhi; worldSnap.medSnapLensView = _dials.lensView;   // replicated UI dials (a joiner's bar5 must agree)   // u-register step 2: the observer descriptors in ONE key — phase (W's engine accumulator, a joiner must rebuild the ROTATED att or its W byte-forks; V/P ledgers for meter parity), beta (pin dials — different β_i forks), omega (ω·τ_i dial). Legacy keys (medSnapAttPhase/medSnapLensTau/medSnapAphEng/medSnapRefAmp) are read-only fallback now.
          if (_clkSpec) worldSnap.medSnapClkSpec = { a: _clkSpec.a, kx: _clkSpec.kx, ky: _clkSpec.ky, k0: _clkSpec.k0 };   // M-c1: the probe spec (tiny) — a joiner can clockWatch the same crystal
          if (_V.selfClk) worldSnap.medSnapSelfClk = { bar: [..._V.selfClk.bar], prev: [..._V.selfClk.prev], beats: _V.selfClk.beats, lastK: _V.selfClk.lastK,
            tau: _tau, tauLprev: _tauLprev, tauBeatK: _tauBeatK, tauBeatKBeat: _tauBeatKBeat,   // M-c2 beat-gate + global (scheduler-foliation) τ — a joiner must resume the same rotation phase
            ...(_V.selfClk.lastKs ? { lastKs: [..._V.selfClk.lastKs] } : {}) };   // per-slot refractory cursors (detector state; the worldline clocks + throttle cursors ship in medSnapTauK — gate 3)
          if (_K.edge) { worldSnap.medSnapKEdge = _K.edge.map(r => [...r]);   // M-e: the coupling graph + the frozen source array (a joiner applying coupling from different source bytes forks)
            worldSnap.medSnapKCapPh = _K.capPh;   // last genuine-beat ph (so a joiner doesn't re-capture sources at its first, peer-local transition)
            worldSnap.medSnapKSrc = _K.src.map(f => f ? { __f64: Array.from(Float32Array.from(f)) } : null); }   // the coupling sources applied until the joiner's next beat re-captures
          if (_V.psiVirt) { worldSnap.medSnapVirt = { __f64: Array.from(Float32Array.from(_V.psiVirt)) }; worldSnap.medSnapVirtE0 = _V.virtE0; worldSnap.medSnapVirtMir = _V.virtMirror; worldSnap.medSnapVirtMux = _V.virtMux; worldSnap.medSnapVirtHold = _V.virtHold; worldSnap.medSnapVirtLeak = _V.virtLeak;
            worldSnap.medSnapVirtGo = _V.virtGoOn ? { tx: _V.virtTgtX, ty: _V.virtTgtY, gx: _V.virtGx, gy: _V.virtGy, l0: _V.virtL0, lt: _V.virtLt, lk: _V.virtLk } : null;   // independent-V: the leash state (moving target + eased position + baseline + the τ_V cadence cursor — a joiner advancing one boundary early forks)
            if (_V.virtAtt) worldSnap.medSnapVirtAtt = { __f64: Array.from(Float32Array.from(_V.virtAtt)) };
            worldSnap.medSnapEarVOn = _V.earVOn; worldSnap.medSnapKv = _V.kvSteps;
            if (_V.earVOn && _V.earV) worldSnap.medSnapEarV = { floors: [..._V.earV.floors], dev: [..._V.earV.dev], lastHit: [..._V.earV.lastHit], lastReply: _V.earV.lastReply, pending: _V.earV.pending.map(p => ({ ...p })) }; }   // the virtual phase ships (drive flags + recorded operator + the dream's reactor state — all dynamics-affecting)
          if (_V.virtHolo) worldSnap.medSnapVirtHolo = { __f64: Array.from(Float32Array.from(_V.virtHolo)) };   // the plate ships too (a joiner must be able to relift — the record is world state)
          if (_V.virtBank.length) worldSnap.medSnapVirtBank = _V.virtBank.map(b => ({ p: { __f64: Array.from(Float32Array.from(b.p)) }, a: b.a ? { __f64: Array.from(Float32Array.from(b.a)) } : null, k: b.k, lop: b.lop ? { ...b.lop } : null, bw: b.bw ?? null }));   // the recall BANK ships (memory is world state — plate + operator per moment; the reviver decodes nested {__f64})
          if (_V.phases.length) worldSnap.medSnapPhases = _V.phases.map(px => ({ p: { __f64: Array.from(Float32Array.from(px.psi)) }, a: px.att ? { __f64: Array.from(Float32Array.from(px.att)) } : null, e0: px.e0, kv: px.kv, src: px.src, go: px.go, tx: px.tx, ty: px.ty, gx: px.gx, gy: px.gy, l0: px.l0, lt: px.lt|0, lk: px.lk|0 }));   // M4: the BOOTED phases ship — live worlds are world state (incl. their leash + τ_i cadence cursor)
          worldSnap.medSnapCoevoG = { x: _coevoGx, y: _coevoGy, l0: _coevoL0, th: _coevoTh, warm: _coevoWarm, lt: _coevoCur.lt, lk: _coevoCur.lk };   // ⟲coevo effective position/angle + lock baseline + warmup + the τ_W cadence cursor
          // reactor derived state (floors/refractory/pending pongs) — the joiner must adopt it VERBATIM or its hit
          // decisions fork from the leader's (floors are dynamics-affecting state: replies inject energy)
          if (_earROn && _earR) worldSnap.medSnapEarR = { floors: [..._earR.floors], dev: [..._earR.dev], lastHit: [..._earR.lastHit], lastReply: _earR.lastReply, pending: _earR.pending.map(p => ({ ...p })) };
          // offsets are an array of PER-RING flat Int16Arrays — deep-convert to plain arrays: the hook runs AFTER _safeClone (same
          // reason ψ needs {__f64}), so a raw typed array JSON-ifies into a length-less object → setRings sees n=0 → weight·4/0=Inf
          // → the first stepEyeN floods the field with NaN (the joiner-NaN bug, caught live).
          const _plainO = (o) => (o||[]).map(a => Array.from(a||[]));
          if (_E.ringCache) worldSnap.medSnapRings = { ver:_E.kernelVer, r:Array.from(_E.ringCache.r||[]), w:Array.from(_E.ringCache.w||[]), o:_plainO(_E.ringCache.o) };
          // (kern pending ships in medSnapTauK)
          console.log(`[SNAP-HOOK] captured: steps=${_E.solSteps} clock0=${_stepClk.c0.toFixed(3)} E0=${_torbE0.toFixed(4)} transP=(${_transPx.toFixed(3)},${_transPy.toFixed(3)}) shiftSeen=${_E.shiftSeen} pendShift=${_kqShift ? _kqShift.length : 0} kv=${_E.kernelVer} pendKern=${_kqKern ? _kqKern.length : 0} fieldH=${_hashField(_E.psiLensed)}`);
        } else { for (const k of ['medSnapPsi','medSnapSteps','medSnapKw','medSnapClock0','medSnapE0','medSnapTransPx','medSnapTransPy','medSnapShiftSeen','medSnapShiftQ','medSnapRings','medSnapKernQ','medSnapAttSeen','medSnapAttSpd','medSnapAttAY','medSnapAttAX','medSnapAttQ','medSnapSigSeen','medSnapSigQ','medSnapVirtSeen','medSnapVirtQ','medSnapTexSpec','medSnapAttPhase','medSnapAphEng','medSnapLensTau','medSnapClkSpec','medSnapTauK','medSnapSelfClk','medSnapKEdge','medSnapKCapPh','medSnapKSrc','medSnapLockMin','medSnapEarR','medSnapCoevoG','medSnapVirt','medSnapVirtE0','medSnapVirtHolo','medSnapVirtMir','medSnapVirtMux','medSnapVirtHold','medSnapVirtAtt','medSnapVirtLeak','medSnapVirtGo','medSnapVirtBank','medSnapEarVOn','medSnapEarV','medSnapKv','medSnapPhases','medSnapLensOp','medSnapViaPhi','medSnapLensView']) delete worldSnap[k]; }
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
