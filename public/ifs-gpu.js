/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── ifs-gpu.js ────────────────────────────────────────────────────────────────
//
// WebGL2 compute backend for _linearStepIFS.
//
// Public API:
//   const gpu = await IFSGpu.create(canvas, grid);
//   gpu.setPsi(Float64Array);               // upload psi from JS
//   gpu.setRef(Float64Array);               // upload refField from JS
//   gpu.setRings(fRadii, fWeights, fOffs);  // upload kernel (call when kernel changes)
//   gpu.step(dt);                           // one full leapfrog step (3 substeps)
//   gpu.stepN(n, dt);                       // n leapfrog steps
//   gpu.accumulatePlate(decay);             // |ψ+ref|² → plate texture (blended)
//   gpu.resetPlate();                       // zero plate texture
//   gpu.readPsi()  → Float64Array(2*G*G)   // download psi  (slow — avoid hot path)
//   gpu.readPlate() → Float32Array(G*G)    // download plate (call once per sweep)
//   gpu.destroy();                          // free GL resources
//
// Design notes:
//   • psi is stored as RG32F: R=Re, G=Im.  Two ping-pong FBOs (A↔B).
//   • ref is stored as RG32F in a third texture (read-only).
//   • ring offsets are packed into a RGB32I texture: R=dx, G=dy, B=ring-index d.
//     Total texels = Σ ringN[d].  Shader iterates all texels in a loop.
//   • plate is R32F, accumulated with EXT_color_buffer_float.
//   • Three substep shaders (step1/step2/step3) match the JS leapfrog exactly.
//   • Periodic boundary: texture wrap mode REPEAT — free hardware wrap.
//   • No readPixels in the hot path. readPlate() is called once per sweep end.
//
// WebGL2 + EXT_color_buffer_float required (Chrome 56+, Firefox 51+, Safari 15+).

import { kernelLambdaGrid } from './medium-core.js';   // stepEyeJump: λ(k) of the rings set (the spectral twin of the ring stencil)

export class IFSGpu {
  static jumpMin = 12;   // stepEyeN runs of this length or more take the one-pass spectral jump (stepEyeJump)

  // ── Static factory ──────────────────────────────────────────────────────────
  static async create(canvas, grid) {
    const gpu = new IFSGpu(canvas, grid);
    gpu._init();
    return gpu;
  }

  constructor(canvas, grid) {
    this._canvas = canvas;
    this._G  = grid;
    this._gl = null;

    // GL resources — single retina psi ping-pong (was: separate main + sweep)
    this._swA = null; this._fboSwA = null;  // ping
    this._swB = null; this._fboSwB = null;  // pong
    this._swSrc = 'A';
    // Second independent eye soliton ping-pong — for LIVE eye row (no interference with main)
    this._eyeA = null; this._fboEyeA = null;
    this._eyeB = null; this._fboEyeB = null;
    this._eyeSrc = 'A';
    this._objEye = null; // eye soliton's own objField texture — independent from _obj
    this._ref   = null;                      // refField texture (RG32F)
    this._obj   = null;                      // objField texture (RG32F) — injection target
    this._plateA = null; this._fboPA = null; // plate ping (RGBA32F)
    this._plateB = null; this._fboPB = null; // plate pong (RGBA32F)
    this._plateSrc = 'A';
    this._plate = null; this._fboP = null;   // alias → current readable plate
    this._ringTex = null;                   // ring offsets (RGB32I)
    this._ringCount = 0;                    // total texels in ring texture
    this._ringMeta  = null;                 // Float32Array: [start, n, weight, pad] × nRings

    // Shader programs
    this._progStep1      = null;
    this._progStep2      = null;
    this._progStep3      = null;
    this._progAccum      = null;
    this._progAccumSweep = null;  // |sweepPsi + ref|² → plate (uses sweep ping-pong)
    this._progCopy       = null;
    this._progStepRecord = null;  // step + SRC_ALPHA injection toward objField
    this._progReconCplx  = null;  // sweepPsi = cplxPlate · ψ_ref
    this._cplxA = null; this._fboCplxA = null;
    this._cplxB = null; this._fboCplxB = null;
    this._cplxSrc = 'A';
    this._progStepPlate       = null;
    this._progStepHuygens     = null;
    this._progLensPhase       = null;
    this._progStepPlateKernel = null;
    this._progPlatePhaseKick       = null;  // energy-conserving plate phase kick on sweep psi
    this._progPlateAmpConstraint   = null;  // GS amplitude constraint: |psi| → sqrt(plate), keep phase
    this._progDemodPhaseKick       = null;  // phase kick by demodulated object wavefront phase
    this._progStepRecordHamiltonian = null; // IFS inject + exp(i·γ·plate) Hamiltonian in one pass
    this._progAddSources      = null;  // add point sources texture to psi
    this._srcTex              = null;  // RG32F source texture for beam injection

    this._nRings = 0;
  }

  // ── Initialise GL context and all static resources ──────────────────────────
  _init() {
    const gl = this._canvas.getContext('webgl2', {
      antialias: false, depth: false, stencil: false, alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('IFSGpu: WebGL2 not available');
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('IFSGpu: EXT_color_buffer_float not available');
    this._gl = gl;

    const G = this._G;
    gl.canvas.width  = G;
    gl.canvas.height = G;
    gl.viewport(0, 0, G, G);

    // Quad VAO — one triangle-pair covering [-1,+1]²
    this._vao  = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  1,-1,  -1,1,
       1,-1,  1, 1,  -1,1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Single retina psi ping-pong — used for everything (display, plate accum, recon)
    [this._swA, this._fboSwA] = this._makePsiTex();
    [this._swB, this._fboSwB] = this._makePsiTex();
    this._swSrc = 'A';
    // Eye soliton ping-pong — independent from main retina
    [this._eyeA, this._fboEyeA] = this._makePsiTex();
    [this._eyeB, this._fboEyeB] = this._makePsiTex();
    this._eyeSrc = 'A';
    // ── U1 TURBO: per-slot RESIDENT eye buffers (lazy). The register (CPU descBase) stays canonical — these are
    //    a between-sync CACHE of it, swapped into the active eye slot by selectEyeSlot(id). Nothing here is
    //    state the determinism contract reads; every observable step still refreshes descBase from the texture
    //    (readback) on the app side. This is the SAME ping-pong the eye already uses, just one pair per slot so
    //    the executor need not readback+re-upload between bars.
    this._slotEye = {};   // id → { A, fA, B, fB, src }
    this._slotDefault = { A: this._eyeA, fA: this._fboEyeA, B: this._eyeB, fB: this._fboEyeB };
    this._objEye = this._makeRGF32Tex();
    this._bindB  = this._makeRGF32Tex();   // §7.90 operand-B field for the pure-medium binding (ψA·ψB)
    // §7.91-fix DEDICATED bind ping-pong — the binding's field-mul + soliton round-trip run HERE, never on the eye
    // ping-pong, so the operator binding can't corrupt the live travelling field the grow/self-evolve share.
    [this._bindPA, this._fboBindPA] = this._makePsiTex();
    [this._bindPB, this._fboBindPB] = this._makePsiTex();
    this._bindSrc = 'A';

    // wavelet-recognition output (RG32F: R=match, G=detectedSize) + its own FBO for the single-pass readback
    this._recogTex = this._makeRGF32Tex();
    this._fboRecog = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboRecog);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._recogTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // ref texture (RG32F, no FBO — read-only)
    this._ref = this._makeRGF32Tex();

    // plate ping-pong (RGBA32F)
    [this._plateA, this._fboPA] = this._makePlateTex();
    [this._plateB, this._fboPB] = this._makePlateTex();
    this._plateSrc = 'A';
    this._plate = this._plateA; this._fboP = this._fboPA;

    // obj texture (RG32F, no FBO — injection target, read-only in shader)
    this._obj = this._makeRGF32Tex();
    this._cplxA = this._makeRGF32Tex(); this._cplxB = this._makeRGF32Tex();
    this._fboCplxA = gl.createFramebuffer(); this._fboCplxB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboCplxA);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._cplxA, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboCplxB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._cplxB, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._cplxSrc = 'A';

    // Compile shaders
    this._progStep1       = this._compileStep(GLSL_STEP1);
    this._progStep2       = this._compileStep(GLSL_STEP2);
    this._progStep3       = this._compileStep(GLSL_STEP3);
    this._progAccum       = this._compileStep(GLSL_ACCUM);
    this._progAccumSweep  = this._compileStep(GLSL_ACCUM_SWEEP);
    this._progFieldMul    = this._compileStep(GLSL_FIELD_MUL);   // §7.90 pure-medium binding (complex ψA·ψB)
    this._progQuatMix     = this._compileStep(GLSL_QUAT_MIX);    // FIELD-LEVEL qedge: SU(2) mix u·ψ_ℍ over a slot PAIR (GPU-resident, zero readback)
    this._progDualQmix    = this._compileStep(GLSL_DUAL_QMIX);   // FIELD-LEVEL dqedge: SE(3) screw U·ψ̂ over FOUR slots (GPU-resident, zero readback)
    this._progRotCenters  = this._compileStep(GLSL_ROTATE_CENTERS); // §7.92 θ-operator: rotate ψ about each main
    this._progAffineCenters = this._compileStep(GLSL_AFFINE_CENTERS); // §7.98 general metric op: affine ψ about each main
    this._progIfsWarp     = this._compileStep(GLSL_IFS_WARP);       // full K-map IFS Hutchinson union (one GPU pass, no readbacks)
    this._progLensGenome  = this._compileStep(GLSL_LENS_GENOME);   // §7.98 genome lens phase-plate (optical chip, 1 GPU pass)
    this._progCopy        = this._compileStep(GLSL_COPY);
    this._progFilmCopy    = this._compileStep(GLSL_FILM_COPY);   // texture-direct DISPLAY film (complex-preserving)
    this._progFilmPeak    = this._compileStep(GLSL_FILM_PEAK);   // |ψ|² max, level 0
    this._progPeakStep    = this._compileStep(GLSL_PEAK_STEP);   // |ψ|² max, levels 1..n (passthrough of .x)
    this._progStepRecord  = this._compileStep(GLSL_STEP_RECORD);
    this._progReconCplx   = this._compileStep(GLSL_RECON_CPLX);
    this._progStepPlate   = this._compileStep(GLSL_STEP_PLATE);
    this._progStepHuygens = this._compileStep(GLSL_STEP_HUYGENS);
    this._progLensPhase       = this._compileStep(GLSL_LENS_PHASE);
    this._progStepPlateKernel = this._compileStep(GLSL_STEP_PLATE_KERNEL);
    this._progPlatePhaseKick      = this._compileStep(GLSL_PLATE_PHASE_KICK);
    this._progPlateAmpConstraint  = this._compileStep(GLSL_PLATE_AMP_CONSTRAINT);
    this._progDemodPhaseKick      = this._compileStep(GLSL_DEMOD_PHASE_KICK);
    this._progStepRecordHamiltonian = this._compileStep(GLSL_STEP_RECORD_HAMILTONIAN);
    this._progAddSources            = this._compileStep(GLSL_ADD_SOURCES);
    this._srcTex              = this._makeRGF32Tex();
    this._progRenderField = this._compileStep(GLSL_RENDER_FIELD);
    this._progRenderDesc  = this._compileStep(GLSL_RENDER_DESC);   // ℂ*-descriptor projection view (medium-u1 𝔸-slots): linOp phasor over a recorded envelope, final-pixel arithmetic only
    this._descTex             = this._makeRGF32Tex();              // the 𝔸-slot's recorded envelope (uploaded once per recall, read-only)
    this._progRenderDiff  = this._compileStep(GLSL_RENDER_DIFF);
    this._progEyeHologram = this._compileStep(GLSL_EYE_HOLOGRAM);
    this._progRenderPhase = this._compileStep(GLSL_RENDER_PHASE);
    this._progRenderPlate = this._compileStep(GLSL_RENDER_PLATE);
    this._progWaveletRecog = this._compileStep(GLSL_WAVELET_RECOG);
    this._progDotRows    = this._compileStep(GLSL_DOT_ROWS);
    this._progScatterMad = this._compileStep(GLSL_SCATTER_MAD);
    this._progColFinish     = this._compileStep(GLSL_COL_FINISH);       // §7.58 GPU-resident scalar pipe
    this._progScatterMadTex = this._compileStep(GLSL_SCATTER_MAD_TEX);
    this._progOpDotUA         = this._compileStep(GLSL_OP_DOT_UA_ROWS);     // §7.58b rank atlas
    this._progScatterMadAtlas = this._compileStep(GLSL_SCATTER_MAD_ATLAS);
    this._progNlKick          = this._compileStep(GLSL_NL_KICK);            // §7.60 nonlinear decision kick
    this._progSelfFocus       = this._compileStep(GLSL_SELF_FOCUS);         // self-focus: amplitude saturation, momentum-conserving localizer
    this._progLowpass         = this._compileStep(GLSL_LOWPASS);            // IFS-native low-pass contraction (suppresses high-k spurious vortices → charge-conserving)
    this._progDensContract    = this._compileStep(GLSL_DENS_CONTRACT);      // IFS-native GPE: saturable density-dependent contraction (the |ψ|²ψ term, real-space, no FFT)
    this._progCgl             = this._compileStep(GLSL_CGL);                // CGL dissipative-soliton balance (linear loss + cubic gain + quintic saturation)
    this._progNlSpm           = this._compileStep(GLSL_NL_SPM);             // §7.82 saturable SPM (the real _nlHalf)
    this._progNlIntens        = this._compileStep(GLSL_NL_INTENS);          // NONLOCAL Kerr: |ψ|² into a scratch field
    this._progMulK            = this._compileStep(GLSL_MUL_K);              // NONLOCAL Kerr: a spectrum × a real symbol K̂(k)
    this._progNlSpmV          = this._compileStep(GLSL_NL_SPM_V);           // NONLOCAL Kerr: the saturable phase from V = K ⋆ |ψ|²
    this._progFftPerm         = this._compileStep(GLSL_FFT_PERM);           // mixed-radix digit-reversal permutation (one pass per axis)
    this._progFftStage        = this._compileStep(GLSL_FFT_STAGE);          // mixed-radix FFT stage — the GPU port of mixedRadix1d
    this._progFftNorm         = this._compileStep(GLSL_FFT_NORM);           // inverse 1/N normalisation pass
    this._progFftSplit        = this._compileStep(GLSL_FFT_SPLIT);          // split ψ → (Re,0) / (Im,0) for the two-field propagator
    this._progFftBlock        = this._compileStep(GLSL_FFT_BLOCK);          // the FAITHFUL per-mode 2×2 propagator (mixedRadixPropagate T=1)
    this._progFftSpring       = this._compileStep(GLSL_FFT_SPRING);         // spectral spring: ĥat += k·(âhat − ĥat) per mode
    this._progFftMerge        = this._compileStep(GLSL_FFT_MERGE);          // recombine ψ' = (Re R', Re I') after the inverse FFTs
    this._progEyeSuperpose    = this._compileStep(GLSL_EYE_SUPERPOSE);      // coevolve: ψ_eye += β·obj (GPU)
    this._progEyeContract     = this._compileStep(GLSL_EYE_CONTRACT);       // full-authority hold: ψ ← (1−λ)ψ + λ·obj (contraction, GPU)
    this._progEyeScale        = this._compileStep(GLSL_EYE_SCALE);          // coevolve: ψ *= s (energy-cap scale, GPU)
    this._progEyePhaseTilt    = this._compileStep(GLSL_EYE_PHASE_TILT);     // global precession ω + momentum tilt k·x (per-pixel phase)
    this._progEyeCapScale     = this._compileStep(GLSL_EYE_CAP_SCALE);      // the NO-SYNC cap (reduce texture sampled in-shader — zero readback)
    this._progGroupSpm        = this._compileStep(GLSL_GROUP_SPM);          // pair/body-covariant SPM: one phase per cell from the GROUP density (ℍ spinor / ℍ⊗𝔻 rotation pair)
    this._progGroupCap        = this._compileStep(GLSL_GROUP_CAP);          // pair/body-covariant energy cap: ONE scale for every member from the GROUP energy
    this._progEnergyRows      = this._compileStep(GLSL_ENERGY_ROWS);        // coevolve: row-reduce Σ|ψ|² (energy)
    this._progDissip          = this._compileStep(GLSL_DISSIP);             // §7.82 driven-dissipative pass
    this._progAddForce        = this._compileStep(GLSL_ADD_FORCE);          // §7.82 GPU-resident clock forcing
    this._progPhaseAccum      = this._compileStep(GLSL_PHASE_ACCUM);        // §7.82 on-GPU phase accumulator
    this._progNlQuantize      = this._compileStep(GLSL_NL_QUANTIZE);        // §7.77 bistable physical quantizer
    this._progPhaseWell       = this._compileStep(GLSL_PHASE_WELL);         // §7.83 N-ary phase-well quantizer
    this._progSoftPhaseWell   = this._compileStep(GLSL_SOFT_PHASE_WELL);    // §7.84 generative soft phase-heal
    this._progCgleStep        = this._compileStep(GLSL_CGLE_STEP);          // §7.86 cubic-quintic CGLE substrate
    this._progNlhoStep        = this._compileStep(GLSL_NLHO_STEP);          // §7.87 non-linear Hutchinson operator
    this._progArgmaxInit      = this._compileStep(GLSL_ARGMAX_INIT);        // §7.87 argmax: lift field → (v,x,y)
    this._progArgmaxReduce    = this._compileStep(GLSL_ARGMAX_REDUCE);      // §7.87 argmax: 2×2 max-pool pyramid
    this._progSclMul          = this._compileStep(GLSL_SCL_MUL);            // §7.61 resident quantizer
    this._progOpDecide        = this._compileStep(GLSL_OP_DECIDE);
    this._progScatterMadDecided = this._compileStep(GLSL_SCATTER_MAD_DECIDED);  // §7.62 field-selected emission

    // Cache uniform locations — getUniformLocation is expensive on the hot path
    const ul = (prog, name) => gl.getUniformLocation(prog, name);
    this._u = {
      step1:  { psi: ul(this._progStep1, 'u_psi'), rings: ul(this._progStep1, 'u_rings'), dt: ul(this._progStep1, 'u_dt'), G: ul(this._progStep1, 'u_G'), nRings: ul(this._progStep1, 'u_nRings'), ringCount: ul(this._progStep1, 'u_ringCount'), ringMeta: ul(this._progStep1, 'u_ringMeta'), nh: ul(this._progStep1, 'u_nhL') },
      cgle:   { psi: ul(this._progCgleStep,'u_psi'), rings: ul(this._progCgleStep,'u_rings'), G: ul(this._progCgleStep,'u_G'), nRings: ul(this._progCgleStep,'u_nRings'), ringCount: ul(this._progCgleStep,'u_ringCount'), ringMeta: ul(this._progCgleStep,'u_ringMeta'), delta: ul(this._progCgleStep,'u_delta'), beta: ul(this._progCgleStep,'u_beta'), dispd: ul(this._progCgleStep,'u_dispd'), eps: ul(this._progCgleStep,'u_eps'), c3: ul(this._progCgleStep,'u_c3'), mu: ul(this._progCgleStep,'u_mu'), c5: ul(this._progCgleStep,'u_c5'), cdt: ul(this._progCgleStep,'u_cdt') },
      nlho:   { psi: ul(this._progNlhoStep,'u_psi'), mapA: ul(this._progNlhoStep,'u_mapA'), mapB: ul(this._progNlhoStep,'u_mapB'), nMaps: ul(this._progNlhoStep,'u_nMaps'), G: ul(this._progNlhoStep,'u_G'), anchorTex: ul(this._progNlhoStep,'u_anchorTex'), anchorOn: ul(this._progNlhoStep,'u_anchorOn'), anchorScale: ul(this._progNlhoStep,'u_anchorScale'), anchorDom: ul(this._progNlhoStep,'u_anchorDom') },
      argInit:  { psi: ul(this._progArgmaxInit,'u_psi') },
      argReduce:{ src: ul(this._progArgmaxReduce,'u_src'), inW: ul(this._progArgmaxReduce,'u_inW'), inH: ul(this._progArgmaxReduce,'u_inH') },
      step2:  { psi: ul(this._progStep2, 'u_psi'), rings: ul(this._progStep2, 'u_rings'), dt: ul(this._progStep2, 'u_dt'), G: ul(this._progStep2, 'u_G'), nRings: ul(this._progStep2, 'u_nRings'), ringCount: ul(this._progStep2, 'u_ringCount'), ringMeta: ul(this._progStep2, 'u_ringMeta'), nh: ul(this._progStep2, 'u_nhL') },
      step3:  { psi: ul(this._progStep3, 'u_psi'), rings: ul(this._progStep3, 'u_rings'), dt: ul(this._progStep3, 'u_dt'), G: ul(this._progStep3, 'u_G'), nRings: ul(this._progStep3, 'u_nRings'), ringCount: ul(this._progStep3, 'u_ringCount'), ringMeta: ul(this._progStep3, 'u_ringMeta'), nh: ul(this._progStep3, 'u_nhL') },
      accum:      { psi: ul(this._progAccum, 'u_psi'), ref: ul(this._progAccum, 'u_ref'), plate: ul(this._progAccum, 'u_plate'), decay: ul(this._progAccum, 'u_decay') },
      accumSweep: { sw: ul(this._progAccumSweep, 'u_sw'), ref: ul(this._progAccumSweep, 'u_ref'), plate: ul(this._progAccumSweep, 'u_plate'), decay: ul(this._progAccumSweep, 'u_decay') },
      stepRec:   { psi: ul(this._progStepRecord, 'u_psi'), obj: ul(this._progStepRecord, 'u_obj'), alpha: ul(this._progStepRecord, 'u_alpha') },
      reconCplx: { cplx: ul(this._progReconCplx, 'u_cplx'), ref: ul(this._progReconCplx, 'u_ref') },
      stepPlate:   { psi: ul(this._progStepPlate, 'u_psi'), plate: ul(this._progStepPlate, 'u_plate'), gamma: ul(this._progStepPlate, 'u_gamma'), smoothMaxPlate: ul(this._progStepPlate, 'u_smoothMaxPlate') },
      stepHuygens: { psi: ul(this._progStepHuygens, 'u_psi'), rings: ul(this._progStepHuygens, 'u_rings'), G: ul(this._progStepHuygens, 'u_G'), nRings: ul(this._progStepHuygens, 'u_nRings'), ringCount: ul(this._progStepHuygens, 'u_ringCount'), ringMeta: ul(this._progStepHuygens, 'u_ringMeta'), radii: ul(this._progStepHuygens, 'u_radii'), kwave: ul(this._progStepHuygens, 'u_kwave') },
      lensPhase:       { psi: ul(this._progLensPhase, 'u_psi'), kwave: ul(this._progLensPhase, 'u_kwave'), f: ul(this._progLensPhase, 'u_f'), G: ul(this._progLensPhase, 'u_G') },
      stepPlateKernel: { psi: ul(this._progStepPlateKernel, 'u_psi'), plate: ul(this._progStepPlateKernel, 'u_plate'), rings: ul(this._progStepPlateKernel, 'u_rings'), G: ul(this._progStepPlateKernel, 'u_G'), nRings: ul(this._progStepPlateKernel, 'u_nRings'), ringCount: ul(this._progStepPlateKernel, 'u_ringCount'), ringMeta: ul(this._progStepPlateKernel, 'u_ringMeta'), radii: ul(this._progStepPlateKernel, 'u_radii'), kwave: ul(this._progStepPlateKernel, 'u_kwave'), smoothMaxPlate: ul(this._progStepPlateKernel, 'u_smoothMaxPlate'), alpha: ul(this._progStepPlateKernel, 'u_alpha') },
      platePhaseKick:    { psi: ul(this._progPlatePhaseKick,    'u_psi'), plate: ul(this._progPlatePhaseKick,    'u_plate'), gamma: ul(this._progPlatePhaseKick,    'u_gamma'), smoothMaxPlate: ul(this._progPlatePhaseKick,    'u_smoothMaxPlate') },
      plateAmpConstraint:{ psi: ul(this._progPlateAmpConstraint,'u_psi'), plate: ul(this._progPlateAmpConstraint,'u_plate'), smoothMaxPlate: ul(this._progPlateAmpConstraint,'u_smoothMaxPlate') },
      demodPhaseKick: { psi: ul(this._progDemodPhaseKick, 'u_psi'), obj: ul(this._progDemodPhaseKick, 'u_obj'), gamma: ul(this._progDemodPhaseKick, 'u_gamma') },
      stepRecHam: { psi: ul(this._progStepRecordHamiltonian, 'u_psi'), obj: ul(this._progStepRecordHamiltonian, 'u_obj'), plate: ul(this._progStepRecordHamiltonian, 'u_plate'), alpha: ul(this._progStepRecordHamiltonian, 'u_alpha'), gamma: ul(this._progStepRecordHamiltonian, 'u_gamma'), smoothMaxPlate: ul(this._progStepRecordHamiltonian, 'u_smoothMaxPlate') },
      addSources:  { psi: ul(this._progAddSources, 'u_psi'), src: ul(this._progAddSources, 'u_src') },
      copy:        { plate: ul(this._progCopy, 'u_plate') },
      renderField: { psi: ul(this._progRenderField, 'u_psi'), smoothMax: ul(this._progRenderField, 'u_smoothMax') },
      renderDiff:  { psi: ul(this._progRenderDiff, 'u_psi'), obj: ul(this._progRenderDiff, 'u_obj'), alpha: ul(this._progRenderDiff, 'u_alpha'), smoothMax: ul(this._progRenderDiff, 'u_smoothMax') },
      eyeHologram: { psi: ul(this._progEyeHologram, 'u_psi'), G: ul(this._progEyeHologram, 'u_G'), mode: ul(this._progEyeHologram, 'u_mode'), param: ul(this._progEyeHologram, 'u_param'), block: ul(this._progEyeHologram, 'u_block'), seed: ul(this._progEyeHologram, 'u_seed') },
      renderPhase: { psi: ul(this._progRenderPhase, 'u_psi'), smoothMax: ul(this._progRenderPhase, 'u_smoothMax') },
      renderDesc:  { base: ul(this._progRenderDesc, 'u_base'), G: ul(this._progRenderDesc, 'u_G'), off: ul(this._progRenderDesc, 'u_off'), center: ul(this._progRenderDesc, 'u_center'), k: ul(this._progRenderDesc, 'u_k'), phi: ul(this._progRenderDesc, 'u_phi'), smoothMax: ul(this._progRenderDesc, 'u_smoothMax'), peakTex: ul(this._progRenderDesc, 'u_peakTex'), usePeakTex: ul(this._progRenderDesc, 'u_usePeakTex'), peakGain: ul(this._progRenderDesc, 'u_peakGain'), ampView: ul(this._progRenderDesc, 'u_ampView'), phaseFloor: ul(this._progRenderDesc, 'u_phaseFloor') },
      renderPlate: { psi: ul(this._progRenderPlate, 'u_psi'), plate: ul(this._progRenderPlate, 'u_plate'), smoothMaxPlate: ul(this._progRenderPlate, 'u_smoothMaxPlate'), smoothMaxField: ul(this._progRenderPlate, 'u_smoothMaxField'), dir: ul(this._progRenderPlate, 'u_dir') },
      waveletRecog: { scene: ul(this._progWaveletRecog,'u_scene'), G: ul(this._progWaveletRecog,'u_G'), nBands: ul(this._progWaveletRecog,'u_nBands'), nSectors: ul(this._progWaveletRecog,'u_nSectors'), bandR: ul(this._progWaveletRecog,'u_bandR'), refDesc: ul(this._progWaveletRecog,'u_refDesc'), refNorm: ul(this._progWaveletRecog,'u_refNorm'), refR: ul(this._progWaveletRecog,'u_refR'), sharpPow: ul(this._progWaveletRecog,'u_sharpPow'), energyGate: ul(this._progWaveletRecog,'u_energyGate'), disDesc: ul(this._progWaveletRecog,'u_disDesc'), disNorm: ul(this._progWaveletRecog,'u_disNorm'), disWeight: ul(this._progWaveletRecog,'u_disWeight') },
      dotRows:    { a: ul(this._progDotRows,'u_a'), b: ul(this._progDotRows,'u_b'), G: ul(this._progDotRows,'u_G') },
      scatterMad: { acc: ul(this._progScatterMad,'u_acc'), w: ul(this._progScatterMad,'u_w'), scale: ul(this._progScatterMad,'u_scale'), reset: ul(this._progScatterMad,'u_reset') },
      colFinish:     { rows: ul(this._progColFinish,'u_rows'), G: ul(this._progColFinish,'u_G') },
      scatterMadTex: { acc: ul(this._progScatterMadTex,'u_acc'), w: ul(this._progScatterMadTex,'u_w'), sA: ul(this._progScatterMadTex,'u_sA'), sB: ul(this._progScatterMadTex,'u_sB'), reset: ul(this._progScatterMadTex,'u_reset') },
      opDotUA:         { atlasU: ul(this._progOpDotUA,'u_atlasU'), atlasA: ul(this._progOpDotUA,'u_atlasA'), cyc: ul(this._progOpDotUA,'u_cyc'), K: ul(this._progOpDotUA,'u_K'), nBins: ul(this._progOpDotUA,'u_nBins'), G: ul(this._progOpDotUA,'u_G') },
      nlKick:          { psi: ul(this._progNlKick,'u_psi'), gamma: ul(this._progNlKick,'u_gamma'), th: ul(this._progNlKick,'u_th'), w: ul(this._progNlKick,'u_w') },
      selfFocus:       { psi: ul(this._progSelfFocus,'u_psi'), th: ul(this._progSelfFocus,'u_th'), gp: ul(this._progSelfFocus,'u_gp'), lo: ul(this._progSelfFocus,'u_lo') },   // self-focus localizer (gain-above-threshold)
      lowpass:         { psi: ul(this._progLowpass,'u_psi'), beta: ul(this._progLowpass,'u_beta'), G: ul(this._progLowpass,'u_G') },   // IFS-native low-pass (3x3 blend, charge-conserving)
      densContract:    { psi: ul(this._progDensContract,'u_psi'), gamma: ul(this._progDensContract,'u_gamma') },   // IFS-native GPE density-dependent contraction
      cgl:             { psi: ul(this._progCgl,'u_psi'), delta: ul(this._progCgl,'u_delta'), eps: ul(this._progCgl,'u_eps'), mu: ul(this._progCgl,'u_mu'), dt: ul(this._progCgl,'u_dt') },   // CGL dissipative-soliton
      fieldMul:        { a: ul(this._progFieldMul,'u_a'), b: ul(this._progFieldMul,'u_b') },   // §7.90 pure-medium binding
      quatMix:         { a: ul(this._progQuatMix,'u_a'), b: ul(this._progQuatMix,'u_b'), u0: ul(this._progQuatMix,'u_u0'), u1: ul(this._progQuatMix,'u_u1'), which: ul(this._progQuatMix,'u_which') },   // FIELD-LEVEL qedge SU(2) mix
      dualQmix:        { rA: ul(this._progDualQmix,'u_rA'), rB: ul(this._progDualQmix,'u_rB'), dA: ul(this._progDualQmix,'u_dA'), dB: ul(this._progDualQmix,'u_dB'), ur0: ul(this._progDualQmix,'u_ur0'), ur1: ul(this._progDualQmix,'u_ur1'), ud0: ul(this._progDualQmix,'u_ud0'), ud1: ul(this._progDualQmix,'u_ud1'), which: ul(this._progDualQmix,'u_which') },   // FIELD-LEVEL dqedge SE(3) screw
      rotCenters:      { psi: ul(this._progRotCenters,'u_psi'), delta: ul(this._progRotCenters,'u_delta'), n: ul(this._progRotCenters,'u_n'), centers: ul(this._progRotCenters,'u_centers'), rad: ul(this._progRotCenters,'u_rad'), G: ul(this._progRotCenters,'u_G') },   // §7.92 θ-operator
      affineCenters:   { psi: ul(this._progAffineCenters,'u_psi'), minv: ul(this._progAffineCenters,'u_minv'), tinv: ul(this._progAffineCenters,'u_tinv'), n: ul(this._progAffineCenters,'u_n'), centers: ul(this._progAffineCenters,'u_centers'), rad: ul(this._progAffineCenters,'u_rad'), G: ul(this._progAffineCenters,'u_G') },   // §7.98 general metric op
      ifsWarp:         { psi: ul(this._progIfsWarp,'u_psi'), minv: ul(this._progIfsWarp,'u_minv'), tinv: ul(this._progIfsWarp,'u_tinv'), n: ul(this._progIfsWarp,'u_n'), G: ul(this._progIfsWarp,'u_G'), smooth: ul(this._progIfsWarp,'u_smooth') },   // full K-map IFS union (+ smooth: 0=bicubic, 1=bilinear)
      lensGenome:      { psi: ul(this._progLensGenome,'u_psi'), n: ul(this._progLensGenome,'u_n'), centers: ul(this._progLensGenome,'u_centers'), a: ul(this._progLensGenome,'u_a'), beta: ul(this._progLensGenome,'u_beta'), vtx: ul(this._progLensGenome,'u_vtx'), k: ul(this._progLensGenome,'u_k'), phaseT: ul(this._progLensGenome,'u_phaseT') },   // §7.98/§7.102 genome lens = GPU linOp (mul, SPACETIME)
      nlSpm:           { psi: ul(this._progNlSpm,'u_psi'), gamma: ul(this._progNlSpm,'u_gamma'), isat: ul(this._progNlSpm,'u_isat'), dt: ul(this._progNlSpm,'u_dt') },
      nlIntens:        { psi: ul(this._progNlIntens,'u_psi') },
      mulK:            { psi: ul(this._progMulK,'u_psi'), k: ul(this._progMulK,'u_k') },
      nlSpmV:          { psi: ul(this._progNlSpmV,'u_psi'), v: ul(this._progNlSpmV,'u_v'), gamma: ul(this._progNlSpmV,'u_gamma'), isat: ul(this._progNlSpmV,'u_isat'), dt: ul(this._progNlSpmV,'u_dt') },
      eyePhaseTilt:    { pot: ul(this._progEyePhaseTilt,'u_pot'), kern: ul(this._progEyePhaseTilt,'u_kern'), psi: ul(this._progEyePhaseTilt,'u_psi'), om: ul(this._progEyePhaseTilt,'u_om'), kx: ul(this._progEyePhaseTilt,'u_kx'), ky: ul(this._progEyePhaseTilt,'u_ky'), m: ul(this._progEyePhaseTilt,'u_m'), cc: ul(this._progEyePhaseTilt,'u_cc'), trap: ul(this._progEyePhaseTilt,'u_trap'), g: ul(this._progEyePhaseTilt,'u_g'), well: ul(this._progEyePhaseTilt,'u_well'), c0: ul(this._progEyePhaseTilt,'u_c0') },
      fftPerm:         { psi: ul(this._progFftPerm,'u_psi'), axis: ul(this._progFftPerm,'u_axis'), G: ul(this._progFftPerm,'u_G'), nfac: ul(this._progFftPerm,'u_nfac'), fac: ul(this._progFftPerm,'u_fac') },
      fftStage:        { psi: ul(this._progFftStage,'u_psi'), axis: ul(this._progFftStage,'u_axis'), radix: ul(this._progFftStage,'u_radix'), len: ul(this._progFftStage,'u_len'), G: ul(this._progFftStage,'u_G'), sign: ul(this._progFftStage,'u_sign') },
      fftNorm:         { psi: ul(this._progFftNorm,'u_psi'), inv: ul(this._progFftNorm,'u_inv') },
      fftSplit:        { psi: ul(this._progFftSplit,'u_psi'), part: ul(this._progFftSplit,'u_part') },
      fftBlock:        { rhat: ul(this._progFftBlock,'u_rhat'), ihat: ul(this._progFftBlock,'u_ihat'), lam: ul(this._progFftBlock,'u_lam'), dt: ul(this._progFftBlock,'u_dt'), which: ul(this._progFftBlock,'u_which'), T: ul(this._progFftBlock,'u_T') },
      fftSpring:       { hat: ul(this._progFftSpring,'u_hat'), ahat: ul(this._progFftSpring,'u_ahat'), k: ul(this._progFftSpring,'u_k') },
      fftMerge:        { rfield: ul(this._progFftMerge,'u_rfield'), ifield: ul(this._progFftMerge,'u_ifield') },
      eyeSuperpose:    { psi: ul(this._progEyeSuperpose,'u_psi'), obj: ul(this._progEyeSuperpose,'u_obj'), beta: ul(this._progEyeSuperpose,'u_beta') },
      eyeContract:     { psi: ul(this._progEyeContract,'u_psi'), obj: ul(this._progEyeContract,'u_obj'), lambda: ul(this._progEyeContract,'u_lambda') },
      eyeScale:        { psi: ul(this._progEyeScale,'u_psi'), s: ul(this._progEyeScale,'u_s') },
      eyeCapScale:     { psi: ul(this._progEyeCapScale,'u_psi'), e: ul(this._progEyeCapScale,'u_e'), target: ul(this._progEyeCapScale,'u_target') },
      groupSpm:        { psi: ul(this._progGroupSpm,'u_psi'), d0: ul(this._progGroupSpm,'u_d0'), d1: ul(this._progGroupSpm,'u_d1'), nd: ul(this._progGroupSpm,'u_nd'), gamma: ul(this._progGroupSpm,'u_gamma'), isat: ul(this._progGroupSpm,'u_isat'), dt: ul(this._progGroupSpm,'u_dt') },
      groupCap:        { psi: ul(this._progGroupCap,'u_psi'), ea: ul(this._progGroupCap,'u_ea'), eb: ul(this._progGroupCap,'u_eb'), nd: ul(this._progGroupCap,'u_nd'), target: ul(this._progGroupCap,'u_target') },
      energyRows:      { a: ul(this._progEnergyRows,'u_a'), G: ul(this._progEnergyRows,'u_G') },
      dissip:          { psi: ul(this._progDissip,'u_psi'), alpha: ul(this._progDissip,'u_alpha'), pump: ul(this._progDissip,'u_pump'), ptarget: ul(this._progDissip,'u_ptarget'), dt: ul(this._progDissip,'u_dt') },
      addForce:        { psi: ul(this._progAddForce,'u_psi'), amp: ul(this._progAddForce,'u_amp'), sig2: ul(this._progAddForce,'u_sig2'), G: ul(this._progAddForce,'u_G') },
      phaseAccum:      { psi: ul(this._progPhaseAccum,'u_psi'), acc: ul(this._progPhaseAccum,'u_acc'), ox: ul(this._progPhaseAccum,'u_ox'), oy: ul(this._progPhaseAccum,'u_oy') },
      nlQuantize:      { psi: ul(this._progNlQuantize,'u_psi'), prev: ul(this._progNlQuantize,'u_prev'), pk: ul(this._progNlQuantize,'u_pk'), thLo: ul(this._progNlQuantize,'u_thLo'), thHi: ul(this._progNlQuantize,'u_thHi') },
      phaseWell:       { psi: ul(this._progPhaseWell,'u_psi'), prev: ul(this._progPhaseWell,'u_prev'), q: ul(this._progPhaseWell,'u_q'), hold: ul(this._progPhaseWell,'u_hold') },
      softPhaseWell:   { psi: ul(this._progSoftPhaseWell,'u_psi'), prev: ul(this._progSoftPhaseWell,'u_prev'), q: ul(this._progSoftPhaseWell,'u_q'), snap: ul(this._progSoftPhaseWell,'u_snap'), hold: ul(this._progSoftPhaseWell,'u_hold'), hasPrev: ul(this._progSoftPhaseWell,'u_hasPrev') },
      sclMul:          { sA: ul(this._progSclMul,'u_sA'), sB: ul(this._progSclMul,'u_sB') },
      opDecide:        { match: ul(this._progOpDecide,'u_match'), K: ul(this._progOpDecide,'u_K'), theta: ul(this._progOpDecide,'u_theta') },
      scatterMadDecided: { acc: ul(this._progScatterMadDecided,'u_acc'), atlasW: ul(this._progScatterMadDecided,'u_atlasW'), sA: ul(this._progScatterMadDecided,'u_sA'), sB: ul(this._progScatterMadDecided,'u_sB'), decision: ul(this._progScatterMadDecided,'u_decision'), cyc: ul(this._progScatterMadDecided,'u_cyc'), K: ul(this._progScatterMadDecided,'u_K') },
      scatterMadAtlas: { acc: ul(this._progScatterMadAtlas,'u_acc'), atlasW: ul(this._progScatterMadAtlas,'u_atlasW'), sA: ul(this._progScatterMadAtlas,'u_sA'), sB: ul(this._progScatterMadAtlas,'u_sB'), cyc: ul(this._progScatterMadAtlas,'u_cyc'), K: ul(this._progScatterMadAtlas,'u_K') },
    };
    // operator-cycle scratch textures (lazily allocated in opCycleInit): a, b, W, dot-rows out, accumulation ping-pong
    this._opTexA = null; this._opTexB = null; this._opTexW = null;
    this._opDotTex = null; this._opDotFbo = null;
    this._opAcc = null; this._opAccTmp = null; this._opAccFbo = null; this._opAccTmpFbo = null;
    this._opSclA = null; this._opSclB = null; this._opSclAFbo = null; this._opSclBFbo = null;   // §7.58 1×1 scalars
    this._opAtlasU = null; this._opAtlasA = null; this._opAtlasW = null; this._opTexV = null;   // §7.58b genotype atlases
    this._opAtlasK = 0; this._opNBins = 0;
    this._opMatch = null; this._opMatchFbo = null; this._opDecision = null; this._opDecisionFbo = null;  // §7.61 quantizer
    this._opDecideK = 0;
  }

  // ── Texture helpers ─────────────────────────────────────────────────────────
  _makePsiTex() {
    const gl = this._gl, G = this._G;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, G, G);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [tex, fbo];
  }

  _makeRGF32Tex() {
    const gl = this._gl, G = this._G;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, G, G);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  _makePlateTex() {
    const gl = this._gl, G = this._G;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // RGBA32F for universal readPixels/texSubImage2D compatibility.
    // We only use the R channel for the plate value; GBA are always 0.
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, G, G);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [tex, fbo];
  }

  // ── Shader compilation ──────────────────────────────────────────────────────
  _compileStep(fragSrc) {
    const gl   = this._gl;
    const vert = this._compileShader(gl.VERTEX_SHADER,   GLSL_VERT);
    const frag = this._compileShader(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('IFSGpu shader link: ' + gl.getProgramInfoLog(prog));
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return prog;
  }

  _compileShader(type, src) {
    const gl = this._gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error('IFSGpu shader: ' + gl.getShaderInfoLog(sh) + '\n---\n' + src);
    return sh;
  }

  // ── Public: upload psi from JS Float64Array(2*G*G) ─────────────────────────
  setPsi(psi64) {
    const gl = this._gl, G = this._G;
    const N  = G * G;
    const f32 = new Float32Array(N * 2);
    for (let j = 0; j < N; j++) {
      f32[j*2]   = psi64[j*2];
      f32[j*2+1] = psi64[j*2+1];
    }
    const tex = this._swSrc === 'A' ? this._swA : this._swB;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  setSweepPsi(psi64) { this.setPsi(psi64); }

  // ── Public: upload ref from JS Float64Array(2*G*G) ─────────────────────────
  setRef(ref64) {
    const gl = this._gl, G = this._G;
    const N  = G * G;
    const f32 = new Float32Array(N * 2);
    for (let j = 0; j < N; j++) {
      f32[j*2]   = ref64[j*2];
      f32[j*2+1] = ref64[j*2+1];
    }
    gl.bindTexture(gl.TEXTURE_2D, this._ref);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── Public: upload object field for per-step injection ─────────────────────
  setObjField(obj64) {
    const gl = this._gl, G = this._G;
    const N  = G * G;
    const f32 = new Float32Array(N * 2);
    for (let j = 0; j < N; j++) {
      f32[j*2]   = obj64[j*2];
      f32[j*2+1] = obj64[j*2+1];
    }
    gl.bindTexture(gl.TEXTURE_2D, this._obj);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── Public: upload a sources field (RG32F) and add it to the current psi ─────
  // src32: Float32Array(2*G*G) with (re,im) at each cell — zero elsewhere
  addSourcesPsi(src32) {
    const gl = this._gl, G = this._G;
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, src32);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const psySrc = this._swSrc === 'A' ? this._swA : this._swB;
    const psyDst = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, psyDst);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progAddSources);
    const u = this._u.addSources;
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.src, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, psySrc);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._srcTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: one leapfrog step + SRC_ALPHA injection toward objField ─────────
  // Equivalent to JS _physStep in RECORD mode: step psi, then mix toward obj.
  // alpha: SRC_ALPHA constant
  stepRecord(dt, alpha) { this.stepRecordSweep(dt, alpha); }

  // ── Public: seed psi from plate for RECON (plate values as Re, Im=0) ────────
  seedRecon() {
    const gl  = this._gl, G = this._G;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    const fbo = this._swSrc === 'A' ? this._fboSwA : this._fboSwB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progCopy);
    gl.uniform1i(this._u.copy.plate, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Public: async psi readback via PBO — for display only ───────────────────
  readPsiAsync() { return this.readSweepPsiAsync(); }

  _readPsiAsync_unused() {
    const gl = this._gl, G = this._G;
    const byteLen = G * G * 2 * 4; // RG32F
    const fbo = this._fboSwA; // unused — kept for reference

    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLen, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();

    return new Promise((resolve) => {
      const poll = () => {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 1); return; }
        gl.deleteSync(fence);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        const f32 = new Float32Array(byteLen / 4);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f32);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteBuffer(pbo);
        const out = new Float64Array(G * G * 2);
        for (let i = 0; i < G * G * 2; i++) out[i] = f32[i];
        resolve(out);
      };
      setTimeout(poll, 1);
    });
  }

  readRefAsync() {
    const gl = this._gl, G = this._G;
    const byteLen = G * G * 2 * 4;
    // Temporarily attach _ref to an FBO so we can readPixels from it
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._ref, 0);
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLen, gl.STREAM_READ);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return new Promise((resolve) => {
      const poll = () => {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 1); return; }
        gl.deleteSync(fence);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        const f32 = new Float32Array(byteLen / 4);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f32);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteBuffer(pbo);
        const out = new Float64Array(G * G * 2);
        for (let i = 0; i < G * G * 2; i++) out[i] = f32[i];
        resolve(out);
      };
      setTimeout(poll, 1);
    });
  }

  readSweepPsiAsync() {
    const gl = this._gl, G = this._G;
    const byteLen = G * G * 2 * 4;
    const fbo = this._swSrc === 'A' ? this._fboSwA : this._fboSwB;
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLen, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return new Promise((resolve) => {
      const poll = () => {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 1); return; }
        gl.deleteSync(fence);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        const f32 = new Float32Array(byteLen / 4);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f32);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteBuffer(pbo);
        const out = new Float64Array(G * G * 2);
        for (let i = 0; i < G * G * 2; i++) out[i] = f32[i];
        resolve(out);
      };
      setTimeout(poll, 1);
    });
  }

  // ── Public: upload IFS kernel ───────────────────────────────────────────────
  // fRadii:  number[]  ring radii
  // fWeights: number[] ring weights (same length)
  // fOffs:   Int16Array[] per-ring flat [dx0,dy0,...] offset arrays
  setRings(fRadii, fWeights, fOffs) {
    const gl = this._gl;
    const nRings = fRadii.length;
    this._nRings = nRings;

    // Pack all ring offsets into one flat Int32Array for the ring texture.
    // Layout per texel: (dx, dy)  — we also store which ring via ringMeta.
    // ringMeta[d] = { start: texel index, n: count, weight_norm: fWeights[d]*4/n }
    const totalPts = fOffs.reduce((s, o) => s + (o.length >> 1), 0);
    const ringData = new Int32Array(totalPts * 2);  // R=dx, G=dy per texel
    const meta     = new Float32Array(nRings * 3);  // start, n, norm per ring
    let   ptr      = 0;
    for (let d = 0; d < nRings; d++) {
      const flat = fOffs[d];
      const n    = flat.length >> 1;
      meta[d*3]   = ptr;          // texel start index
      meta[d*3+1] = n;            // point count
      meta[d*3+2] = fWeights[d] * 4 / n;  // normalised weight (×4 matches JS)
      for (let i = 0; i < n; i++) {
        ringData[(ptr + i) * 2]     = flat[i*2];
        ringData[(ptr + i) * 2 + 1] = flat[i*2+1];
      }
      ptr += n;
    }
    this._ringCount = totalPts;
    this._ringMeta  = meta;
    this._ringRadii = fRadii.slice();
    this._ringW = Array.from(fWeights); this._ringOffs = fOffs; this._ringVer = (this._ringVer | 0) + 1;   // (stepEyeJump's λ follows the rings)
    { let h = 2166136261 >>> 0; for (const ring of (fOffs || [])) { const v = ring && ring.length !== undefined ? ring : Object.values(ring || {}); for (let k = 0; k < v.length; k++) h = Math.imul(h ^ (v[k] | 0), 16777619) >>> 0; h = Math.imul(h ^ 0x9e37, 16777619) >>> 0; }
      this._ringKey = this._ringRadii.join(",") + "|" + this._ringW.join(",") + "|" + h; }   // (the CONTENT: λ is a pure fn of it — stepEyeJump keeps λ per key)
    this._ringNh = null;   // a new ring is symmetric until setRingNh says otherwise
    // Pre-pad to vec4 alignment once here, not per draw call
    const padded = new Float32Array(nRings * 4);
    for (let d = 0; d < nRings; d++) {
      padded[d*4] = meta[d*3]; padded[d*4+1] = meta[d*3+1]; padded[d*4+2] = meta[d*3+2];
    }
    this._ringMetaPadded = padded;

    // Set static uniforms (kernel-dependent, not per-step) on all step programs
    const G = this._G;
    for (const [prog, u] of [
      [this._progStep1, this._u.step1],
      [this._progStep2, this._u.step2],
      [this._progStep3, this._u.step3],
    ]) {
      gl.useProgram(prog);
      gl.uniform1i(u.psi,       0);
      gl.uniform1i(u.rings,     1);
      gl.uniform1i(u.G,         G);
      gl.uniform1i(u.nRings,    nRings);
      gl.uniform1i(u.ringCount, totalPts);
      gl.uniform4fv(u.ringMeta, padded);
    }

    // Upload ring offset texture: RG32I, width=totalPts, height=1
    if (!this._ringTex) this._ringTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._ringTex);
    // Use texImage2D (not texStorage) so we can resize when kernel changes.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32I, totalPts, 1, 0, gl.RG_INTEGER, gl.INT, ringData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── Public: upload sweep psi from JS Float64Array(2*G*G) ────────────────────
  setSweepPsi(psi64) {
    const gl = this._gl, G = this._G;
    const N  = G * G;
    const f32 = new Float32Array(N * 2);
    for (let j = 0; j < N; j++) {
      f32[j*2]   = psi64[j*2];
      f32[j*2+1] = psi64[j*2+1];
    }
    const tex = this._swSrc === 'A' ? this._swA : this._swB;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── Public: one full leapfrog step on the sweep psi ─────────────────────────
  stepSweep(dt) {
    const u = this._u;
    this._runSubstepSw(this._progStep1, dt, u.step1);
    this._runSubstepSw(this._progStep2, dt, u.step2);
    this._runSubstepSw(this._progStep3, dt, u.step3);
  }

  // ── Public: N leapfrog steps on sweep psi ───────────────────────────────────
  stepSweepN(n, dt) {
    for (let i = 0; i < n; i++) this.stepSweep(dt);
  }

  // ── Eye soliton — independent second texture, no interference with main retina ──
  setEyeObjField(psi64) {
    const gl = this._gl, G = this._G, N = G * G;
    const f32 = new Float32Array(N * 2);
    for (let j = 0; j < N; j++) { f32[j*2] = psi64[j*2]; f32[j*2+1] = psi64[j*2+1]; }
    gl.bindTexture(gl.TEXTURE_2D, this._objEye);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── WAVELET RECOGNITION on the GPU (§7.38). One shader pass: each cell builds its angular-cascade
  //    descriptor (bands × sectors) from the scene and cosine-matches the reference descriptor. Replaces the
  //    ~500k-sample/bar JS loop with a single parallel pass + ONE readback. Inputs:
  //      sceneR: Float64(N) real scene intensity (uploaded to _objEye's R channel)
  //      refDesc: Float32(nBands*nSectors) reference angular-cascade descriptor (built in JS once)
  //      bandR: number[] ring radii per band ; opts: { nSectors, refR }
  //    Returns { map: Float64(N) (peak 1), scaleAt: Float32(N) (detected size / refR) }.
  recognizeWaveletGPU(sceneR, refDesc, bandR, opts = {}) {
    const { nSectors = 8, refR = 4, sharpPow = 18, energyGate = 3, disWeight = 0 } = opts;
    const gl = this._gl, G = this._G, N = G * G;
    // upload scene → _objEye (R = intensity, G = 0)
    const f32 = new Float32Array(N * 2); for (let j=0;j<N;j++) f32[j*2] = sceneR[j];
    gl.bindTexture(gl.TEXTURE_2D, this._objEye);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
    // ref + distractor descriptor norms
    let refNorm = 0; for (let i=0;i<refDesc.length;i++) refNorm += refDesc[i]*refDesc[i]; refNorm = Math.sqrt(Math.max(1e-12, refNorm));
    const disDesc = opts.disDesc || new Float32Array(refDesc.length);   // distractor descriptor (zeros = no subtraction)
    let disNorm = 0; for (let i=0;i<disDesc.length;i++) disNorm += disDesc[i]*disDesc[i]; disNorm = Math.sqrt(Math.max(1e-12, disNorm));
    const bandPad = new Float32Array(8); for (let i=0;i<Math.min(8,bandR.length);i++) bandPad[i] = bandR[i];
    const descPad = new Float32Array(96); for (let i=0;i<Math.min(96,refDesc.length);i++) descPad[i] = refDesc[i];
    const disPad  = new Float32Array(96); for (let i=0;i<Math.min(96,disDesc.length);i++) disPad[i]  = disDesc[i];
    const u = this._u.waveletRecog;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboRecog);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progWaveletRecog);
    gl.uniform1i(u.scene, 0); gl.uniform1i(u.G, G);
    gl.uniform1i(u.nBands, Math.min(8, bandR.length)); gl.uniform1i(u.nSectors, nSectors);
    gl.uniform1fv(u.bandR, bandPad); gl.uniform1fv(u.refDesc, descPad);
    gl.uniform1f(u.refNorm, refNorm); gl.uniform1f(u.refR, refR);
    gl.uniform1f(u.sharpPow, sharpPow); gl.uniform1f(u.energyGate, energyGate);
    gl.uniform1fv(u.disDesc, disPad); gl.uniform1f(u.disNorm, disNorm); gl.uniform1f(u.disWeight, disWeight);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._objEye);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    // read back the (match, size) map
    const out = new Float32Array(N * 2);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const map = new Float64Array(N), scaleAt = new Float32Array(N); let mx = 0;
    for (let i=0;i<N;i++){ map[i] = out[i*2]; scaleAt[i] = out[i*2+1]; if (map[i] > mx) mx = map[i]; }
    if (mx > 0) for (let i=0;i<N;i++) map[i] /= mx;
    return { map, scaleAt };
  }

  // ── §7.77 BISTABLE PHYSICAL QUANTIZER — the genome level-restorer, on the GPU (replaces the JS §7.65 Schmitt
  //    `h>0.6·pk?1:h<0.4·pk?0:prev`). `hPatch` = Float64(M) amplitudes (the harvested |ψ| per cell, any length M
  //    ≤ N — laid into the first M cells); `prevW` = Float64(M) previous bits (hysteresis memory); `pk` = patch
  //    peak; thresholds ×pk. Returns Float64(M) restored bits {0,1}. The DECISION is computed by the medium
  //    (the shader), not a JS `if`. Peer-deterministic because of the hold band (probe-verified).
  quantizePatchGPU(hPatch, prevW, pk, { thLo = 0.4, thHi = 0.6 } = {}) {
    const gl = this._gl, G = this._G, N = G * G, M = hPatch.length;
    if (!this._qPrevTex) { this._qPrevTex = this._makeRGF32Tex(); }   // lazy: prev-bit input texture
    // upload amplitudes h → _objEye.R (the field's real channel = |ψ|, so the shader's length(psi)=h), prev → _qPrevTex.R
    const fH = new Float32Array(N * 2), fP = new Float32Array(N * 2);
    for (let i = 0; i < M; i++) { fH[i*2] = hPatch[i]; fP[i*2] = prevW[i] ? 1 : 0; }
    gl.bindTexture(gl.TEXTURE_2D, this._objEye); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, fH);
    gl.bindTexture(gl.TEXTURE_2D, this._qPrevTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, fP);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const u = this._u.nlQuantize;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboRecog); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progNlQuantize);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.prev, 1);
    gl.uniform1f(u.pk, pk); gl.uniform1f(u.thLo, thLo); gl.uniform1f(u.thHi, thHi);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._objEye);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._qPrevTex);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    const out = new Float32Array(N * 2); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const bits = new Float64Array(M); for (let i = 0; i < M; i++) bits[i] = out[i*2];
    return bits;
  }

  // ── §7.83 PHASE-WELL QUANTIZER (GPU) — the N-ary, pk-invariant, tileable genome quantizer. `psiPatch` =
  //    Float64(2·M) complex (re,im interleaved; only the PHASE matters — pk-invariant); `prevSym` = Float64(M)
  //    previous well indices (hysteresis memory; use -1 to take nearest); q = #wells; hold = hold-band arc (rad).
  //    Returns Float64(M) restored symbol indices {0..q-1}. The medium (shader) computes the verdict, not JS.
  phaseWellPatchGPU(psiPatch, prevSym, q, hold = 0.4) {
    const gl = this._gl, G = this._G, N = G * G, M = psiPatch.length >> 1;
    if (!this._pwPrevTex) { this._pwPrevTex = this._makeRGF32Tex(); }   // lazy: prev-symbol input texture
    const fPsi = new Float32Array(N * 2), fP = new Float32Array(N * 2);
    for (let i = 0; i < M; i++) { fPsi[i*2] = psiPatch[i*2]; fPsi[i*2+1] = psiPatch[i*2+1]; fP[i*2] = prevSym[i]; }
    gl.bindTexture(gl.TEXTURE_2D, this._objEye); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, fPsi);
    gl.bindTexture(gl.TEXTURE_2D, this._pwPrevTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, fP);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const u = this._u.phaseWell;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboRecog); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progPhaseWell);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.prev, 1); gl.uniform1f(u.q, q); gl.uniform1f(u.hold, hold);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._objEye);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._pwPrevTex);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    const out = new Float32Array(N * 2); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sym = new Float64Array(M); for (let i = 0; i < M; i++) sym[i] = out[i*2];
    return sym;
  }

  // ── OPERATOR LIMIT-CYCLE on the GPU (§7.43). The rank-K binding operator as a clock trajectory, computed
  //    fully on the GPU: per rank, two row-reduced dot products give (U_r·a),(V_r·b); a scatter-MAD pass adds
  //    W_r·(scalar) into a persistent accumulation texture across the bar. JS only reads back G row-sums (exact
  //    finish, no float-tree drift) and the final accumulation. opCycleInit allocates the scratch textures once.
  opCycleInit() {
    if (this._opTexA) return;
    const gl = this._gl, G = this._G;
    this._opTexA = this._makeRGF32Tex(); this._opTexB = this._makeRGF32Tex(); this._opTexW = this._makeRGF32Tex();
    // dot-rows output: a G×G RG32F (we only read column 0 → G row-sums), with its FBO.
    this._opDotTex = this._makeRGF32Tex();
    this._opDotFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._opDotTex, 0);
    // accumulation ping-pong (scatter-MAD reads one, writes the other) + FBOs.
    this._opAcc = this._makeRGF32Tex(); this._opAccTmp = this._makeRGF32Tex();
    this._opAccFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opAccFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._opAcc, 0);
    this._opAccTmpFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opAccTmpFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._opAccTmp, 0);
    // §7.58 GPU-resident scalar pipe: two 1×1 scalar textures (ua, vb) the scatter shader samples directly.
    const mk1 = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, 1, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return [t, f];
    };
    [this._opSclA, this._opSclAFbo] = mk1();
    [this._opSclB, this._opSclBFbo] = mk1();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // upload a real Float64(N) field into one of the operator scratch textures ('a'|'b'|'w'|'v').
  // 'v' = the static V probe (§7.58b — uploaded once, reused every tick by the VB dot).
  opCycleUpload(which, field) {
    const gl = this._gl, G = this._G, N = G * G;
    const f32 = new Float32Array(N * 2); for (let j = 0; j < N; j++) f32[j*2] = field[j];
    const tex = which === 'a' ? this._opTexA : which === 'b' ? this._opTexB : which === 'v' ? this._opTexV : this._opTexW;
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32); gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── §7.58b RANK ATLAS: preload the operator's GENOTYPE once — K layers each of U keys, bar-input keys
  //    a(bar mod K), and output carriers W — into 2D-array textures. After this, rank selection, bar-key
  //    selection, and the bar-start reset all happen IN-SHADER from one u_cyc integer.
  opCycleAtlasInit(K, nBins) {
    const gl = this._gl, G = this._G;
    if (this._opAtlasU && this._opAtlasK === K && this._opNBins === nBins) return;
    const mkArr = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG32F, G, G, K);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null); return t;
    };
    this._opAtlasU = mkArr(); this._opAtlasA = mkArr(); this._opAtlasW = mkArr();
    if (!this._opTexV) this._opTexV = this._makeRGF32Tex();
    this._opAtlasK = K; this._opNBins = nBins;
  }

  // upload one genotype layer ('U'|'A'|'W', layer index, real Float64(N) field). Called K times at build.
  opCycleAtlasUpload(which, layer, field) {
    const gl = this._gl, G = this._G, N = G * G;
    const f32 = new Float32Array(N * 2); for (let j = 0; j < N; j++) f32[j*2] = field[j];
    const t = which === 'U' ? this._opAtlasU : which === 'A' ? this._opAtlasA : this._opAtlasW;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, G, G, 1, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }

  // GPU dot product of two scratch textures (real channel): row-reduce on the GPU, finish G row-sums in JS.
  _opDot(texA, texB) {
    const gl = this._gl, G = this._G, u = this._u.dotRows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G);
    gl.useProgram(this._progDotRows);
    gl.uniform1i(u.a, 0); gl.uniform1i(u.b, 1); gl.uniform1i(u.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    const out = new Float32Array(G * G * 2); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let s = 0; for (let y = 0; y < G; y++) s += out[(y * G) * 2];   // column-0 texel of each row = that row's sum
    return s;
  }

  // one operator sub-tick on the GPU: scale = (U_r·a)(V_r·b) [computed via _opDot on pre-uploaded a/Ur, b/Vr],
  // then acc += scale·W_r. `reset` clears the accumulation (start of a bar). Returns the scalar (for logging).
  opCycleTick(uaVbScale, reset) {
    const gl = this._gl, G = this._G, u = this._u.scatterMad;
    const srcAcc = reset ? this._opAcc : this._opAcc, dstFbo = this._opAccTmpFbo;   // read _opAcc → write _opAccTmp
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progScatterMad);
    gl.uniform1i(u.acc, 0); gl.uniform1i(u.w, 1); gl.uniform1f(u.scale, uaVbScale); gl.uniform1f(u.reset, reset ? 1.0 : 0.0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opAcc);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._opTexW);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // swap: the freshly written _opAccTmp becomes the live accumulation
    const t = this._opAcc; this._opAcc = this._opAccTmp; this._opAccTmp = t;
    const f = this._opAccFbo; this._opAccFbo = this._opAccTmpFbo; this._opAccTmpFbo = f;
    return uaVbScale;
  }

  // dot product of the two currently-uploaded operator textures (a·b across the grid). Used by the engine to
  // compute (U_r·a) and (V_r·b): upload U_r→'a' slot & a→'b' slot, call; upload V_r & b, call.
  opCycleDotAB() { return this._opDot(this._opTexA, this._opTexB); }

  // ── §7.58 GPU-RESIDENT SCALAR PIPE (bootstrap step 1). The JS-scalar path (opCycleDotAB → JS multiply →
  //    u_scale uniform) read back G row-sums per dot and re-uploaded the product — the one place genuine
  //    computation passed through JS in the operator cycle (§7.45 honest-scope gap). These three methods
  //    close it: the dot FINISHES on the GPU into a 1×1 scalar texture ('A' or 'B' slot), and the scatter
  //    samples both scalars directly. Per tick, JS only issues draw calls — the MODEL/MEDIUM seam in code:
  //    JS conducts (content-blind), the GPU computes; readbacks remain only as telemetry (opCycleReadScalar)
  //    and verification (opCycleReadAcc), never feeding the computation.
  // pass 1 helper: row-reduce tA·tB → dot-rows texture (column 0 = the G row-sums). Stays on GPU.
  _opDotRowsPass(tA, tB) {
    const gl = this._gl, G = this._G, u = this._u.dotRows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G);
    gl.useProgram(this._progDotRows);
    gl.uniform1i(u.a, 0); gl.uniform1i(u.b, 1); gl.uniform1i(u.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tA);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tB);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
  }

  // ── THE ROW PASSES' VIEWPORT (optional, 2026-10-22). Every row reduction into _opDotFbo (energy, dots) sums a whole row PER FRAGMENT,
  //   and _opColFinish reads column 0 only — over a G×G viewport each row was summed G times (G³ texel reads: 134 M at G 512, run by the
  //   energy cap once per sub-step per slot). With _rowsNarrow the pass draws the one column that is read: the same fragment, the same loop,
  //   the same bits — G× less work. Off by default (an app opts in).
  _rowsVp(G) { this._gl.viewport(0, 0, this._rowsNarrow ? 1 : G, G); }

  // pass 2 helper: column-finish the dot-rows texture → the 1×1 scalar texture ('A'|'B').
  _opColFinish(slot) {
    const gl = this._gl, G = this._G, uf = this._u.colFinish;
    gl.bindFramebuffer(gl.FRAMEBUFFER, slot === 'A' ? this._opSclAFbo : this._opSclBFbo); gl.viewport(0, 0, 1, 1);
    gl.useProgram(this._progColFinish);
    gl.uniform1i(uf.rows, 0); gl.uniform1i(uf.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opDotTex);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // dot of the two currently-uploaded textures, finished ON the GPU into scalar slot 'A'|'B'. No readback.
  opCycleDotToTex(slot) {
    this._opDotRowsPass(this._opTexA, this._opTexB);
    this._opColFinish(slot);
  }

  // §7.58b (U_r·a) fully from the GENOTYPE ATLASES: rank layer and bar-key layer selected IN-SHADER from
  // u_cyc. JS contributes nothing but the clock integer. Result → scalar slot 'A'.
  opCycleDotUAToTex(cyc) {
    const gl = this._gl, G = this._G, u = this._u.opDotUA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G);
    gl.useProgram(this._progOpDotUA);
    gl.uniform1i(u.atlasU, 0); gl.uniform1i(u.atlasA, 1);
    gl.uniform1i(u.cyc, cyc | 0); gl.uniform1i(u.K, this._opAtlasK); gl.uniform1i(u.nBins, this._opNBins); gl.uniform1i(u.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._opAtlasU);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._opAtlasA);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    this._opColFinish('A');
  }

  // ── §7.91 PURE-MEDIUM ARM BINDING — compute an operator arm's scalar (U_r·a) or (V·b) NOT as a dot reduction
  //    but as the §7.90 binding: field-multiply A·B → soliton round-trip → read back → demod the response. The
  //    medium computes the product. Writes the scalar into slot 'A'|'B' (the 1×1 the rest of the pipe consumes).
  //    refKx/refKy = the demod carrier (0,0 → energy demod Σ|ψ|², the carrier-free lattice form). T = transit depth.
  //    SAVES/RESTORES the eye field (the operator pipe doesn't use the eye ping-pong, but be safe). ─
  opCycleBindArm(slot, aField64, bField64, { T = 12, refKx = 0, refKy = 0, dt = 0.12 } = {}) {
    const gl = this._gl, G = this._G, N = G * G;
    // §7.91-fix DEDICATED BIND BUFFERS: the binding's field-mul + soliton round-trip must NOT run on the eye
    // ping-pong (the grow/self-evolve share it — concurrent round-trips corrupted the live field → genome decay).
    // Point the eye-step machinery at the bind ping-pong for the duration, then restore. The eye field is untouched.
    const sA = this._eyeA, sB = this._eyeB, sfA = this._fboEyeA, sfB = this._fboEyeB, sSrc = this._eyeSrc;
    this._eyeA = this._bindPA; this._eyeB = this._bindPB; this._fboEyeA = this._fboBindPA; this._fboEyeB = this._fboBindPB; this._eyeSrc = this._bindSrc;
    this.setEyePsi(aField64);            // ψ_bind = A
    this.bindEyeField(bField64);         // §7.90 ψ_bind ·= B  (the medium product)
    this.stepEyeN(T, dt); this.stepEyeN(T, -dt);   // soliton round-trip transports the bound field
    const r = this.readEyePsi();
    this._bindSrc = this._eyeSrc;        // remember the bind buffer's parity for next time
    this._eyeA = sA; this._eyeB = sB; this._fboEyeA = sfA; this._fboEyeB = sfB; this._eyeSrc = sSrc;   // restore eye buffers untouched
    let s = 0;
    if (refKx === 0 && refKy === 0) { for (let i = 0; i < N; i++) s += Math.hypot(r[i*2], r[i*2+1]); }   // energy demod (carrier-free)
    else { for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const i = y*G+x, ph = refKx*x + refKy*y; s += r[i*2]*Math.cos(ph) + r[i*2+1]*Math.sin(ph); } }
    // write the scalar into the 1×1 slot — via the FBO clear (same target the dot pipe's _opColFinish renders to),
    // NOT texSubImage2D on a possibly-still-bound texture (that didn't sync → the scatter shader read 0 → empty
    // bound output, the §7.91 bug). glClear to a 1×1 RG32F attachment is immediate and correct.
    const fbo = slot === 'A' ? this._opSclAFbo : this._opSclBFbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, 1, 1);
    gl.clearColor(s, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return s;
  }

  // §7.58b (V·b): the static V probe (uploaded once to 'v') against the live b field → scalar slot 'B'.
  opCycleDotVBToTex() {
    this._opDotRowsPass(this._opTexV, this._opTexB);
    this._opColFinish('B');
  }

  // §7.58b one fully-resident sub-tick: acc += (sclA·sclB)·atlasW[cyc % K], bar-start reset in-shader.
  opCycleTickAtlas(cyc) {
    const gl = this._gl, G = this._G, u = this._u.scatterMadAtlas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opAccTmpFbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progScatterMadAtlas);
    gl.uniform1i(u.acc, 0); gl.uniform1i(u.atlasW, 1); gl.uniform1i(u.sA, 2); gl.uniform1i(u.sB, 3);
    gl.uniform1i(u.cyc, cyc | 0); gl.uniform1i(u.K, this._opAtlasK);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opAcc);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._opAtlasW);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._opSclA);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this._opSclB);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t = this._opAcc; this._opAcc = this._opAccTmp; this._opAccTmp = t;
    const f = this._opAccFbo; this._opAccFbo = this._opAccTmpFbo; this._opAccTmpFbo = f;
  }

  // one operator sub-tick, fully GPU-resident: acc += (sclA·sclB)·W — the scale formed in-shader from the
  // two 1×1 scalar textures. `reset` clears the accumulation (start of a bar/cycle).
  opCycleTickTex(reset) {
    const gl = this._gl, G = this._G, u = this._u.scatterMadTex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opAccTmpFbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progScatterMadTex);
    gl.uniform1i(u.acc, 0); gl.uniform1i(u.w, 1); gl.uniform1i(u.sA, 2); gl.uniform1i(u.sB, 3);
    gl.uniform1f(u.reset, reset ? 1.0 : 0.0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opAcc);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._opTexW);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._opSclA);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this._opSclB);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // swap: the freshly written _opAccTmp becomes the live accumulation
    const t = this._opAcc; this._opAcc = this._opAccTmp; this._opAccTmp = t;
    const f = this._opAccFbo; this._opAccFbo = this._opAccTmpFbo; this._opAccTmpFbo = f;
  }

  // TELEMETRY/VERIFICATION ONLY (1-pixel readback, never in the data path): the live scalar in 'A'|'B'.
  opCycleReadScalar(slot) {
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, slot === 'A' ? this._opSclAFbo : this._opSclBFbo);
    const out = new Float32Array(2); gl.readPixels(0, 0, 1, 1, gl.RG, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out[0];
  }

  // ── §7.61 RESIDENT QUANTIZER: K×1 match row + 1×1 decision texel (winner, scalar, fired) on the GPU.
  opCycleDecideInit(K) {
    const gl = this._gl;
    if (this._opMatch && this._opDecideK === K) return;
    const mk = (w, h, fmt) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); return [t, f];
    };
    [this._opMatch, this._opMatchFbo] = mk(K, 1, gl.RG32F);
    [this._opDecision, this._opDecisionFbo] = mk(1, 1, gl.RGBA32F);
    this._opDecideK = K;
  }

  // per tick: drop this rank's (sclA·sclB) into its match-row slot (scissored single-texel write; the
  // slot index is clock arithmetic — conductor work; the VERDICT itself stays on the GPU).
  opCycleMatchWrite(rank) {
    const gl = this._gl, K = this._opDecideK, u = this._u.sclMul;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opMatchFbo); gl.viewport(0, 0, K, 1);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(rank, 0, 1, 1);
    gl.useProgram(this._progSclMul);
    gl.uniform1i(u.sA, 0); gl.uniform1i(u.sB, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opSclA);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._opSclB);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // bar end: the LEVEL-RESTORED DECISION, in-shader — argmax + threshold over the match row → 1×1 texel.
  opCycleDecide(theta) {
    const gl = this._gl, u = this._u.opDecide;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDecisionFbo); gl.viewport(0, 0, 1, 1);
    gl.useProgram(this._progOpDecide);
    gl.uniform1i(u.match, 0); gl.uniform1i(u.K, this._opDecideK); gl.uniform1f(u.theta, theta);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opMatch);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // §7.62 one FIELD-SELECTED sub-tick: like opCycleTickAtlas, but the emitted W layer is chosen by the
  // DECISION texture (the field's previous-bar verdict) and the emission is gated by its fired bit.
  opCycleTickDecided(cyc) {
    const gl = this._gl, G = this._G, u = this._u.scatterMadDecided;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opAccTmpFbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progScatterMadDecided);
    gl.uniform1i(u.acc, 0); gl.uniform1i(u.atlasW, 1); gl.uniform1i(u.sA, 2); gl.uniform1i(u.sB, 3); gl.uniform1i(u.decision, 4);
    gl.uniform1i(u.cyc, cyc | 0); gl.uniform1i(u.K, this._opAtlasK);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opAcc);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._opAtlasW);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._opSclA);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this._opSclB);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this._opDecision);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t = this._opAcc; this._opAcc = this._opAccTmp; this._opAccTmp = t;
    const f = this._opAccFbo; this._opAccFbo = this._opAccTmpFbo; this._opAccTmpFbo = f;
  }

  // TESTIMONY: read the decided BITS (winner, scalar, fired) — JS receives the decision, not the analog.
  opCycleReadDecision() {
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDecisionFbo);
    const out = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { r: out[0] | 0, s: out[1], fired: out[2] > 0.5 };
  }

  // read back the accumulation texture (the bound output) as Float64(N) real values.
  opCycleReadAcc() {
    const gl = this._gl, G = this._G, N = G * G;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opAccFbo);
    const out = new Float32Array(N * 2); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const o = new Float64Array(N); for (let i = 0; i < N; i++) o[i] = out[i*2]; return o;
  }

  setEyePsi(psi64) {
    const gl = this._gl, G = this._G, N = G * G;
    const f32 = new Float32Array(N * 2);
    for (let j = 0; j < N; j++) { f32[j*2] = psi64[j*2]; f32[j*2+1] = psi64[j*2+1]; }
    const tex = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  _runSubstepEye(prog, dt, u) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    this._scB();
    gl.useProgram(prog);
    gl.uniform1f(u.dt, dt);
    if (u.nh) { const h = this._ringNh; gl.uniform3f(u.nh, h ? h[0] : 0, h ? h[1] : 0, h ? h[2] : 0); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ringTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    this._scE();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  stepEye(dt) {
    const u = this._u;
    this._runSubstepEye(this._progStep1, dt, u.step1);
    this._runSubstepEye(this._progStep2, dt, u.step2);
    this._runSubstepEye(this._progStep3, dt, u.step3);
  }

  stepRecordEye(dt, alpha) {
    this.stepEye(dt);
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progStepRecord);
    gl.uniform1i(this._u.stepRec.psi,   0);
    gl.uniform1i(this._u.stepRec.obj,   1);
    gl.uniform1f(this._u.stepRec.alpha, alpha);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._objEye);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  renderEyeField(smoothMax) {
    const gl = this._gl, G = this._G;
    const tex = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderField);
    gl.uniform1i(this._u.renderField.psi,       0);
    gl.uniform1f(this._u.renderField.smoothMax,  smoothMax);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  renderEyePhase(smoothMax) {
    const gl = this._gl, G = this._G;
    const tex = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderPhase);
    gl.uniform1i(this._u.renderPhase.psi,       0);
    gl.uniform1f(this._u.renderPhase.smoothMax,  smoothMax);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // ── REGIONAL WITNESS SUPPORT (descent rung 2): scissor the EYE passes to a region so a regional mirror
  //    pays GPU only for its cells. Outside-region texels are NEVER written by the scissored passes — the app
  //    keeps them at the register's declaration (setEyePsiBoth writes BOTH ping-pong textures so the untouched
  //    outside stays coherent across substep parity). The cap's SCALE pass is scissored too: the declaration
  //    band is never renormalized — only the witness's own region is capped.
  setEyeScissor(x, y, w, h) { this._eyeScissor = (w > 0 && h > 0) ? [x | 0, y | 0, w | 0, h | 0] : null; }
  _scB() { if (this._eyeScissor) { const gl = this._gl; gl.enable(gl.SCISSOR_TEST);
    gl.scissor(this._eyeScissor[0], this._eyeScissor[1], this._eyeScissor[2], this._eyeScissor[3]); } }
  _scE() { if (this._eyeScissor) this._gl.disable(this._gl.SCISSOR_TEST); }
  setEyePsiBoth(psi64) { this.setEyePsi(psi64);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; this.setEyePsi(psi64);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }

  // ── U1 TURBO RESIDENT SLOTS ──────────────────────────────────────────────────────────────────────
  // selectEyeSlot(id): make slot `id`'s resident ping-pong pair the ACTIVE eye buffer (lazy-create). id=null
  // restores the default eye buffer. The register stays canonical: this only chooses WHICH GPU texture the
  // eye ops read/write, so the executor can keep a slot resident across bars (no readback+re-upload). Parity
  // (src) is remembered per slot — the step count between visits is a pure fn of shared steps, so it stays
  // peer-deterministic.
  selectEyeSlot(id) {
    if (id == null) { this._eyeA = this._slotDefault.A; this._fboEyeA = this._slotDefault.fA;
      this._eyeB = this._slotDefault.B; this._fboEyeB = this._slotDefault.fB; return; }
    let s = this._slotEye[id];
    if (!s) { const [A, fA] = this._makePsiTex(), [B, fB] = this._makePsiTex(); s = { A, fA, B, fB, src: 'A', primed: false }; this._slotEye[id] = s; }
    this._eyeA = s.A; this._fboEyeA = s.fA; this._eyeB = s.B; this._fboEyeB = s.fB; this._eyeSrc = s.src;
    return s;
  }
  // remember the active parity back onto a slot (call after advancing a selected slot)
  commitEyeSlot(id) { const s = this._slotEye[id]; if (s) s.src = this._eyeSrc; }
  // has this slot been primed with an upload since creation? (the app uploads descBase once, then keeps resident)
  eyeSlotPrimed(id) { const s = this._slotEye[id]; return !!(s && s.primed); }
  markEyeSlotPrimed(id) { const s = this._slotEye[id]; if (s) s.primed = true; }
  // which half of the slot's ping-pong pair currently holds the field ('A'/'B'), or '-' if the slot has no eye yet.
  // PEER-LOCAL by construction: created per GL context and flipped by every op this peer has run on the slot, so it
  // is NOT part of the replicated state and never rides the join snapshot. Exposed for cross-peer diagnosis — two
  // peers holding OPPOSITE parity at the same shared step step different physical textures, which no CPU-side hash
  // (regH/attH/descBase) can reveal because each peer is internally consistent.
  eyeSlotParity(id) { const s = this._slotEye[id]; return s ? s.src : '-'; }
  dropEyeSlot(id) { const s = this._slotEye[id]; if (!s) return; const gl = this._gl;
    gl.deleteTexture(s.A); gl.deleteTexture(s.B); gl.deleteFramebuffer(s.fA); gl.deleteFramebuffer(s.fB); delete this._slotEye[id]; }

  // ── DESCRIPTOR PROJECTION (the ℂ* register's VIEW tier — medium-u1 𝔸-slots) ──────────────────────
  // setDescBase uploads a recorded complex envelope ONCE (per recall); renderDescField then evaluates the
  // linOp primitive content·e^{i(φ + k·(x−c))}, sampled at x−off (torus bilinear), as FINAL PIXEL ARITHMETIC
  // directly to the canvas — no ping-pong, no state, and NOTHING is ever read back, so GPU float precision
  // stays a display concern, never a determinism surface (the model is the CPU f64 register). This is the
  // meta-circular split: model = the 6-float descriptor; view = one fragment shader.
  setDescBase(psi64) {
    const gl = this._gl, G = this._G, N = G * G;
    const f32 = new Float32Array(N * 2);
    for (let j = 0; j < N * 2; j++) f32[j] = psi64[j];
    gl.bindTexture(gl.TEXTURE_2D, this._descTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  // ── TEXTURE-DIRECT DISPLAY FILM (2026-07-30) ──────────────────────────────
  //   THE PROBLEM: the display path was texture → readPixels → descBase → descDisp → upload → shader. readPixels is
  //   a hard GPU PIPELINE STALL (profiled at 83–91% of all readbacks, ~2.6 MB/s per peer), and with two peers on one
  //   GPU each stall drains the SHARED queue, so they serialize — the measured "lag with a second browser open".
  //   It also round-tripped DISPLAY bytes through descBase, which is in regH: a view concern touching model storage.
  //   THE FIX: copy the slot's live texture into a per-slot FILM texture, GPU-side, AT THE SHARED STEP (the same
  //   instant descDisp used to refresh — so peers still show the same moment, which is why descDisp existed), then
  //   render from the film. Nothing is read back. This is what the renderDescField comment already claimed.
  //   The film is DISPLAY-ONLY: it never re-enters the register, so GPU float precision stays a view concern.
  filmCapture(id, srcId = id) {   // (srcId, optional 2026-10-23: capture ANOTHER eye slot into id's film — the app's ◎ stroboscopic frame)
    const gl = this._gl, G = this._G;
    const s = this._slotEye[srcId] || this._slotEye[id]; if (!s) return false;
    if (!this._film) this._film = {};
    let f = this._film[id];
    if (!f) { const t = this._makeRGF32Tex(); const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      f = { tex: t, fbo: fb }; this._film[id] = f; }
    const src = s.src === 'A' ? s.A : s.B;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progFilmCopy);
    gl.uniform1i(gl.getUniformLocation(this._progFilmCopy, 'u_src'), 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._filmPeak(id);
    return true;
  }
  // log-step max-reduction of |ψ|² over the film into a 1×1 texture the render shader SAMPLES (never read back).
  _filmPeak(id) {
    const gl = this._gl, G = this._G, f = this._film[id];
    if (!f.pyr) { f.pyr = []; let n = G;
      while (n > 1) { n = Math.max(1, n >> 1);
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, n, n);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        f.pyr.push({ tex: t, fbo: fb, n }); } }
    let srcTex = f.tex, srcN = G;
    for (let i = 0; i < f.pyr.length; i++) { const lv = f.pyr[i];
      const prog = i === 0 ? this._progFilmPeak : this._progPeakStep;
      gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fbo);
      gl.viewport(0, 0, lv.n, lv.n);
      gl.useProgram(prog);
      gl.uniform1i(gl.getUniformLocation(prog, 'u_src'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'u_srcN'), srcN);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
      srcTex = lv.tex; srcN = lv.n; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  hasFilm(id) { return !!(this._film && this._film[id]); }
  dropFilm(id) { const gl = this._gl; const f = this._film && this._film[id]; if (!f) return;
    gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo);
    for (const lv of (f.pyr || [])) { gl.deleteTexture(lv.tex); gl.deleteFramebuffer(lv.fbo); }
    delete this._film[id]; }

  // filmId (optional): render DIRECTLY from that slot's GPU film + its GPU-reduced peak — no CPU array, no upload,
  //   no readback. Omit it and the legacy path (setDescBase + a CPU smoothMax) is used unchanged.
  renderDescField({ ox = 0, oy = 0, cx = 0, cy = 0, kx = 0, ky = 0, phi = 0, ampView = 0, filmId = null, peakGain = 1, phaseFloor = 0, spec = null } = {}, smoothMax) {
    const gl = this._gl, G = this._G, u = this._u.renderDesc;
    const sp = spec ? this._specSlot(spec.id) : null; if (!u.spec) { const p = this._progRenderDesc; u.spec = gl.getUniformLocation(p, 'u_spec'); u.specTex = gl.getUniformLocation(p, 'u_specTex'); u.specMap = gl.getUniformLocation(p, 'u_specMap');
      u.bank = [0, 1, 2, 3].map((k) => gl.getUniformLocation(p, 'u_bank' + k)); u.bankXYZ = gl.getUniformLocation(p, 'u_bankXYZ'); u.specVg = gl.getUniformLocation(p, 'u_specVg'); }   // (a spectrum not yet sampled is dark, not another colormap)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderDesc);
    gl.uniform1i(u.base, 0);
    gl.uniform1i(u.ampView, ampView ? 1 : 0);
    if (u.phaseFloor) gl.uniform1f(u.phaseFloor, phaseFloor);   // >0 = full-field phase (CPU-like floor); 0 = legacy fade-to-black
    gl.uniform1i(u.G, G);
    gl.uniform2f(u.off, ox, oy);
    gl.uniform2f(u.center, cx, cy);
    gl.uniform2f(u.k, kx, ky);
    gl.uniform1f(u.phi, phi);
    gl.uniform1f(u.smoothMax, smoothMax || 1);
    const film = (filmId != null && this._film) ? this._film[filmId] : null;
    const useFilm = !!(film && film.pyr && film.pyr.length);
    gl.uniform1i(u.usePeakTex, useFilm ? 1 : 0);
    if (useFilm) { gl.uniform1i(u.peakTex, 1); gl.uniform1f(u.peakGain, peakGain);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, film.pyr[film.pyr.length - 1].tex); }
    const bk = sp && spec.mode === "bank" && spec.bankXYZ ? (this._specBank(spec.id), this._spec[spec.id].bank2) : null;   // (the second stage is what the eye sees)
    const bpw = bk && spec.exp && this._spec[spec.id].bankP ? this._spec[spec.id].bankP : null;   // ⧗: the exposed band POWERS
    const ft = sp && spec.fts && this._spec[spec.id] && this._spec[spec.id].ftsA ? this._spec[spec.id].ftsA : null;   // ◈ the FT spectrometer (its accumulator)
    const fc = ft && spec.coh && this._spec[spec.id].ftsC ? this._spec[spec.id].ftsC : null;   // ◈ g: its coherence accumulator (specFtsCoh)
    gl.uniform1i(u.spec, sp ? (fc ? 5 : ft ? 4 : bpw ? 3 : bk ? 2 : 1) : 0);
    if (ft) { gl.uniform1i(u.bank[0], 3); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, (fc || ft).T[(fc || ft).src]); }
    if (bk) { gl.uniform3fv(u.bankXYZ, spec.bankXYZ); const T = bpw ? [...bpw.T[bpw.src], ...bpw.T[bpw.src]] : bk.T[bk.src]; for (let k = 0; k < 4; k++) { gl.uniform1i(u.bank[k], 3 + k); gl.activeTexture(gl.TEXTURE3 + k); gl.bindTexture(gl.TEXTURE_2D, T[k]); } }
    if (sp) { gl.uniform1f(u.specVg, +spec.vg || 1); gl.uniform1i(u.specTex, 2); gl.uniform4f(u.specMap, +spec.centre || 0, +spec.span || 1, +spec.minNm || 4, spec.exp ? 1 : 0); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sp.src === 'A' ? sp.A : sp.B); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, useFilm ? film.tex : this._descTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // ── ◈ SPECTRAL ACCUMULATOR (the app's native colour, see GLSL_SPECTRAL_OBSERVER): per id an RGBA32F (S.re, S.im, E, dt) ping-pong + the
  //    previous sub-step's field. specAccum(id, a, refC, refS, dt) after a sub-step of the ACTIVE eye field (the first call only primes the
  //    previous field); specUpload(id, f32) writes a host accumulator (the CPU twin); specDrop(id) frees. Display only: nothing is read back.
  _specTex4() { const gl = this._gl, G = this._G, tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, G, G);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null); return [tex, fbo]; }
  _specSlot(id) { const gl = this._gl; if (!this._specP) { const ul = (p, n) => gl.getUniformLocation(p, n), acc = this._compileStep(GLSL_SPEC_ACC), copy = this._compileStep(GLSL_SPEC_COPY);
      this._specP = { acc, copy, u: { psi: ul(acc, 'u_psi'), prev: ul(acc, 'u_prev'), acc: ul(acc, 'u_acc'), a: ul(acc, 'u_a'), dt: ul(acc, 'u_dt'), ref: ul(acc, 'u_ref'), x: ul(copy, 'u_x') } }; this._spec = {}; }
    let s = this._spec[id]; if (!s) { const [A, fA] = this._specTex4(), [B, fB] = this._specTex4(), [P, fP] = this._makePsiTex(); s = this._spec[id] = { A, fA, B, fB, P, fP, src: 'A', primed: false }; } return s; }
  specAccum(id, a, refC, refS, dt) { const gl = this._gl, s = this._specSlot(id), P = this._specP, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    if (s.primed) { this._nlPass(P.acc, s.src === 'A' ? s.fB : s.fA, [psi, s.P, s.src === 'A' ? s.A : s.B], () => { gl.uniform1i(P.u.psi, 0); gl.uniform1i(P.u.prev, 1); gl.uniform1i(P.u.acc, 2);
        gl.uniform1f(P.u.a, a); gl.uniform1f(P.u.dt, dt); gl.uniform2f(P.u.ref, refC, refS); }); s.src = s.src === 'A' ? 'B' : 'A'; }
    this._nlPass(P.copy, s.fP, [psi], () => gl.uniform1i(P.u.x, 0)); s.primed = true; }
  //   the RESONATOR BANK per id (see GLSL_SPEC_BANK): 4 RGBA32F textures (8 complex) × ping-pong, one MRT pass a sub-step; specBankUpload(id, f32 16·G²)
  //   writes a host bank (the CPU twin; layout [texture k][cell][4]); specBankRead(id) → that layout (diagnostics)
  _specBank(id) { const gl = this._gl, s = this._specSlot(id); if (s.bank) return s.bank;
    if (!this._specBankP) { const p = this._compileStep(GLSL_SPEC_BANK), ul = (n) => gl.getUniformLocation(p, n); this._specBankP = { p, u: { psi: ul('u_psi'), b: [0, 1, 2, 3].map((k) => ul('u_b' + k)), a: ul('u_a'), rot: ul('u_rot') } }; }
    const mk = () => { const T = [], f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      for (let k = 0; k < 4; k++) { const [t, f1] = this._specTex4(); gl.deleteFramebuffer(f1); T.push(t); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0); }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { T, f }; };
    const A = mk(), B = mk(), A2 = mk(), B2 = mk(); s.bank2 = { T: [A2.T, B2.T], F: [A2.f, B2.f], src: 0 }; return (s.bank = { T: [A.T, B.T], F: [A.f, B.f], src: 0 }); }   // (bank2: the second stage — what is seen)
  specBankAccum(id, a, rot) { const gl = this._gl, b = this._specBank(id), P = this._specBankP, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB; 
    this._nlPass(P.p, b.F[1 - b.src], [psi, ...b.T[b.src]], () => { gl.uniform1i(P.u.psi, 0); for (let k = 0; k < 4; k++) gl.uniform1i(P.u.b[k], 1 + k); gl.uniform1f(P.u.a, a); gl.uniform2fv(P.u.rot, rot); }); b.src = 1 - b.src;
    const s = this._spec[id], b2 = s.bank2; if (!this._specBank2P) { const p = this._compileStep(GLSL_SPEC_BANK2), ul = (n) => gl.getUniformLocation(p, n); this._specBank2P = { p, u: { s: [0, 1, 2, 3].map((k) => ul('u_s' + k)), b: [0, 1, 2, 3].map((k) => ul('u_b' + k)), a: ul('u_a'), rot: ul('u_rot') } }; }
    const Q = this._specBank2P; this._nlPass(Q.p, b2.F[1 - b2.src], [...b.T[b.src], ...b2.T[b2.src]], () => { for (let k = 0; k < 4; k++) { gl.uniform1i(Q.u.s[k], k); gl.uniform1i(Q.u.b[k], 4 + k); } gl.uniform1f(Q.u.a, a); gl.uniform2fv(Q.u.rot, rot); }); b2.src = 1 - b2.src; }
  //   ◈ THE FOURIER-TRANSFORM SPECTROMETER (2026-10-19), per id: its own HISTORY — L ∈ {8, 16} field samples taken every Δ of proper time (two per
  //   RGBA texture, ping-pong, pushed in groups of 4 targets) — and an ACCUMULATOR (X, Y, Z, P) updated EVERY sub-step: the current field
  //   against each stored sample at its exact age, weighted by the app's Wiener–Khinchin quadrature for those ages (the carrier folded in):
  //   XYZ_t = |ψ|²·Q₀ + Σ_ℓ Re(ψ_t·ψ̄_ℓ·Q_ℓ), P likewise with V — then mix(acc, ·, a). Continuous like the line's; one pass a sub-step + a push every Δ.
  //   specFtsAccum(id, L, a, Q) · specFtsPush(id, L) · Q = { Q0: vec3, V0, Qr, Qi: Float32Array(3L), Vr, Vi: Float32Array(L) }
  _ftsSlot(id, L) { const gl = this._gl, s = this._specSlot(id); if (s.ftsL === L && s.ftsH) return s;
    const K = L >> 1, set = () => Array.from({ length: K }, () => { const [t, f] = this._specTex4(); gl.deleteFramebuffer(f); return t; }), grp = (T) => { const F = []; for (let g = 0; g < K; g += 4) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        const n = Math.min(4, K - g); for (let k = 0; k < n; k++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, T[g + k], 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3].slice(0, n)); F.push(f); } gl.bindFramebuffer(gl.FRAMEBUFFER, null); return F; };
    const A = set(), B = set(), [a0, f0] = this._specTex4(), [a1, f1] = this._specTex4(), [b0, g0] = this._specTex4(), [b1, g1] = this._specTex4();
    s.ftsH = { T: [A, B], F: [grp(A), grp(B)], src: 0 }; s.ftsA = { T: [a0, a1], F: [f0, f1], src: 0 }; s.ftsB = { T: [b0, b1], F: [g0, g1], src: 0 }; s.ftsL = L; return s; }
  _ftsProgs(L) { const gl = this._gl; this._ftsP = this._ftsP || {}; if (this._ftsP[L]) return this._ftsP[L]; const K = L >> 1, ul = (p, n) => gl.getUniformLocation(p, n);
    let body = ""; for (let k = 0; k < K; k++) body += `{ vec4 h = texelFetch(u_h${k}, q, 0); vec2 z = cm(x, vec2(h.x, -h.y)); XYZ += z.x * u_Qr[${2 * k}] - z.y * u_Qi[${2 * k}]; P += z.x * u_Vr[${2 * k}] - z.y * u_Vi[${2 * k}];
      z = cm(x, vec2(h.z, -h.w)); XYZ += z.x * u_Qr[${2 * k + 1}] - z.y * u_Qi[${2 * k + 1}]; P += z.x * u_Vr[${2 * k + 1}] - z.y * u_Vi[${2 * k + 1}]; }\n`;
    const acc = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_acc, ${Array.from({ length: K }, (_, k) => "u_h" + k).join(", ")}; uniform float u_a, u_V0; uniform vec2 u_rot; uniform vec3 u_Q0, u_Qr[${L}], u_Qi[${L}]; uniform float u_Vr[${L}], u_Vi[${L}];
out vec4 fragColor; vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 x = cm(texelFetch(u_psi, q, 0).xy, u_rot); float E = dot(x, x); vec3 XYZ = E * u_Q0; float P = E * u_V0;
${body}  fragColor = mix(texelFetch(u_acc, q, 0), vec4(XYZ, P), u_a); }`);
    const push = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p, u_t0, u_t1, u_t2, u_t3; uniform int u_first; uniform float u_sc;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 pv = u_first == 1 ? u_sc * texelFetch(u_psi, q, 0).xy : texelFetch(u_p, q, 0).zw; vec4 t0 = texelFetch(u_t0, q, 0), t1 = texelFetch(u_t1, q, 0), t2 = texelFetch(u_t2, q, 0), t3 = texelFetch(u_t3, q, 0);
  o0 = vec4(pv, t0.xy); o1 = vec4(t0.zw, t1.xy); o2 = vec4(t1.zw, t2.xy); o3 = vec4(t2.zw, t3.xy); }`);
    const box = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_box; uniform vec2 u_rot; uniform int u_first; out vec4 fragColor;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 x = texelFetch(u_psi, q, 0).xy; x = vec2(x.x * u_rot.x - x.y * u_rot.y, x.x * u_rot.y + x.y * u_rot.x);
  fragColor = vec4((u_first == 1 ? vec2(0.0) : texelFetch(u_box, q, 0).xy) + x, 0.0, 1.0); }`);
    return (this._ftsP[L] = { acc, push, box, ub: { psi: ul(box, 'u_psi'), box: ul(box, 'u_box'), rot: ul(box, 'u_rot'), first: ul(box, 'u_first') }, ua: { psi: ul(acc, 'u_psi'), acc: ul(acc, 'u_acc'), h: Array.from({ length: K }, (_, k) => ul(acc, 'u_h' + k)), a: ul(acc, 'u_a'), rot: ul(acc, 'u_rot'), Q0: ul(acc, 'u_Q0'), V0: ul(acc, 'u_V0'), Qr: ul(acc, 'u_Qr'), Qi: ul(acc, 'u_Qi'), Vr: ul(acc, 'u_Vr'), Vi: ul(acc, 'u_Vi') },
      up: { psi: ul(push, 'u_psi'), p: ul(push, 'u_p'), t: [0, 1, 2, 3].map((k) => ul(push, 'u_t' + k)), first: ul(push, 'u_first'), sc: ul(push, 'u_sc') } }); }
  //   specFtsReset(id) — optional (2026-10-31): drops id's FT-spectrometer state (history, accumulator, box); the next use re-allocates it at zero.
  //   For a view that was re-seeded: its stored samples belong to another scene (and a poisoned NaN accumulator cannot recover by mixing). Inert unless called.
  specFtsReset(id) { const gl = this._gl, s = this._spec && this._spec[id]; if (!s || !s.ftsH) return; const del = (o) => { for (const t of o.T.flat()) gl.deleteTexture(t); for (const f of o.F.flat()) gl.deleteFramebuffer(f); };
    del(s.ftsH); del(s.ftsA); del(s.ftsB); s.ftsH = s.ftsA = s.ftsB = null; s.ftsL = 0; }
  specFtsAccum(id, L, a, Q, rot = [1, 0]) { const gl = this._gl, s = this._ftsSlot(id, L), P = this._ftsProgs(L), H = s.ftsH, A = s.ftsA, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    this._nlPass(P.acc, A.F[1 - A.src], [psi, A.T[A.src], ...H.T[H.src]], () => { gl.uniform1i(P.ua.psi, 0); gl.uniform1i(P.ua.acc, 1); P.ua.h.forEach((u, k) => gl.uniform1i(u, 2 + k)); gl.uniform1f(P.ua.a, a); gl.uniform2f(P.ua.rot, rot[0], rot[1]);
      gl.uniform3fv(P.ua.Q0, Q.Q0); gl.uniform1f(P.ua.V0, Q.V0); gl.uniform3fv(P.ua.Qr, Q.Qr); gl.uniform3fv(P.ua.Qi, Q.Qi); gl.uniform1fv(P.ua.Vr, Q.Vr); gl.uniform1fv(P.ua.Vi, Q.Vi); }); A.src = 1 - A.src; }
  //   specFtsCoh(id, L, a, rot) — ◈ g, THE LIGHT'S TEMPORAL COHERENCE per cell (2026-10-20, optional): (E, Re, Im) of x·conj(the OLDEST stored
  //   sample) under the accumulator's memory a, x the field in the carrier-free frame (rot, as the box) — |g(τ_L)| = |C(τ_L)| / C(0) at the
  //   history's longest delay: near 1 where the light is one steady coherent mode, low where it decorrelates. Read by the render (u_spec 5)
  //   and specCohReadStart. Call it before specFtsPush (the oldest slot is the one about to leave).
  specFtsCoh(id, L, a, rot = [1, 0]) { const gl = this._gl, s = this._ftsSlot(id, L), psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, K = L >> 1;
    if (!s.ftsC) { const [c0, f0] = this._specTex4(), [c1, f1] = this._specTex4(); s.ftsC = { T: [c0, c1], F: [f0, f1], src: 0 }; }
    if (!this._ftsCohP) { const p = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_h, u_c; uniform vec2 u_rot; uniform float u_a; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 a = texelFetch(u_psi, q, 0).xy, x = vec2(a.x * u_rot.x - a.y * u_rot.y, a.x * u_rot.y + a.y * u_rot.x), h = texelFetch(u_h, q, 0).zw;
  o = mix(texelFetch(u_c, q, 0), vec4(dot(x, x), x.x * h.x + x.y * h.y, x.y * h.x - x.x * h.y, 1.0), u_a); }`), ul = (n) => gl.getUniformLocation(p, n); this._ftsCohP = { p, u: { psi: ul('u_psi'), h: ul('u_h'), c: ul('u_c'), rot: ul('u_rot'), a: ul('u_a') } }; }
    const P = this._ftsCohP, C = s.ftsC, H = s.ftsH; this._nlPass(P.p, C.F[1 - C.src], [psi, H.T[H.src][K - 1], C.T[C.src]], () => { gl.uniform1i(P.u.psi, 0); gl.uniform1i(P.u.h, 1); gl.uniform1i(P.u.c, 2); gl.uniform2f(P.u.rot, rot[0], rot[1]); gl.uniform1f(P.u.a, a); }); C.src = 1 - C.src; }
  specCohReadStart(id) { const gl = this._gl, G = this._G, s = this._spec && this._spec[id], C = s && s.ftsC; if (!C) return null; const n = G * G * 4, pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ); gl.bindFramebuffer(gl.FRAMEBUFFER, C.F[C.src]); gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n }; }
  //   specFtsBox(id, L, rot, first): the ANTI-ALIAS box — B ← (first ? 0 : B) + ψ·rot (ψ in the carrier-free frame) · specFtsPush(id, L, sc): push
  //   sc·B (the interval's mean) into the history. Each stored sample is the field averaged over its Δ (a camera integrating over its shutter
  //   interval), so light outside the band does not fold into it.
  specFtsBox(id, L, rot, first) { const gl = this._gl, s = this._ftsSlot(id, L), P = this._ftsProgs(L), Bx = s.ftsB, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    this._nlPass(P.box, Bx.F[1 - Bx.src], [psi, Bx.T[Bx.src]], () => { gl.uniform1i(P.ub.psi, 0); gl.uniform1i(P.ub.box, 1); gl.uniform2f(P.ub.rot, rot[0], rot[1]); gl.uniform1i(P.ub.first, first ? 1 : 0); }); Bx.src = 1 - Bx.src; }
  specFtsPush(id, L, sc = 1) { const gl = this._gl, s = this._ftsSlot(id, L), P = this._ftsProgs(L), H = s.ftsH, src = s.ftsB.T[s.ftsB.src], T = H.T[H.src], K = L >> 1;
    for (let g = 0; g < K; g += 4) this._nlPass(P.push, H.F[1 - H.src][g >> 2], [src, g ? T[g - 1] : T[0], ...[0, 1, 2, 3].map((k) => T[Math.min(K - 1, g + k)])], () => { gl.uniform1i(P.up.psi, 0); gl.uniform1i(P.up.p, 1); P.up.t.forEach((u, k) => gl.uniform1i(u, 2 + k)); gl.uniform1i(P.up.first, g ? 0 : 1); gl.uniform1f(P.up.sc, sc); });
    H.src = 1 - H.src; }
  //   ≋ THE BREATHING ON THE GPU (2026-10-20, an optional addition: the app's attractor-breathing analyser, peer-local). Per id: the field of the
  //   selected eye slot, demodulated by its carrier and transformed HERE (the band probe's own FFT, no readback), each beat:
  //     · the per-mode state (A = ⟨ψ̃⟩ the locked part, P = ⟨|ψ̃|²⟩, R0 = ⟨|r|²⟩, r = ψ̃ − A) under the window weight w;
  //     · r stored in a ring (one entry per beat) and met by the entries τ beats old: C(τ) ← mix(C(τ), r·r̄_τ, wl_τ) per mode, 2 delays a texture;
  //     · the tiles (real space): ⟨mean ψ̃⟩, ⟨|mean|²⟩, ⟨e⟩, ⟨e²⟩ per tile.
  //   Reduced per band (|q + k| bands, the pose's k) and read ONCE per emission (breathRead): the analyser's own CPU twin keeps the arithmetic.
  //   breathBeat(id, { car, w, slot, lags: [ring slot per delay, −1 = none], wl: [per delay], R, T, tw }) · breathReadStart(id, { nb, kx, ky }) → h, breathReadReady(h), breathReadFinish(h) · breathFree(id)
  _brG(id, LN, R, T) { const gl = this._gl, G = this._G; this._br = this._br || {}; let b = this._br[id]; if (b && b.LN === LN && b.R === R && b.T === T) return b; if (b) this.breathFree(id);
    const mk = (w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return [t, f]; };
    const mrt = (T2) => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); T2.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0)); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3].slice(0, T2.length)); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return f; };
    const [xa, fxa] = this._makePsiTex(), [xb, fxb] = this._makePsiTex(), nC = Math.ceil(LN / 2), nG = Math.ceil(nC / 4);
    const sA = [mk(G, G), mk(G, G)], ring = Array.from({ length: R }, () => this._makePsiTex()),   /* (2 floats: r) */ C = [0, 1].map(() => Array.from({ length: nC }, () => mk(G, G)[0]));
    const CF = [0, 1].map((p) => Array.from({ length: nG }, (_, g) => mrt(C[p].slice(4 * g, 4 * g + 4)))), tS = [0, 1].map(() => [mk(T, T)[0], mk(T, T)[0]]), tF = tS.map((P) => mrt(P));
    b = this._br[id] = { LN, R, T, nC, nG, S: { A: xa, fA: fxa, B: xb, fB: fxb, src: 'A' }, sA, sAs: 0, ring, C, CF, Cs: 0, tS, tF, tSs: 0, red: null }; return b; }
  _brProgs() { if (this._brP) return this._brP; const gl = this._gl, H = '#version 300 es\nprecision highp float;\n', ul = (p, n) => gl.getUniformLocation(p, n);
    const demod = this._compileStep(H + 'uniform sampler2D u_psi; uniform vec2 u_c; out vec4 o; void main() { vec2 a = texelFetch(u_psi, ivec2(gl_FragCoord.xy), 0).xy; o = vec4(a.x * u_c.x + a.y * u_c.y, a.y * u_c.x - a.x * u_c.y, 0.0, 1.0); }');
    const tiles = this._compileStep(H + `uniform sampler2D u_x, u_s0, u_s1; uniform int u_TB; uniform float u_w; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main() { ivec2 t = ivec2(gl_FragCoord.xy); float se = 0.0, sr = 0.0, si = 0.0; for (int y = 0; y < 256; y++) { if (y >= u_TB) break; for (int x = 0; x < 256; x++) { if (x >= u_TB) break; vec2 a = texelFetch(u_x, t * u_TB + ivec2(x, y), 0).xy; se += dot(a, a); sr += a.x; si += a.y; } }
  float inv = 1.0 / float(u_TB * u_TB); vec2 m = vec2(sr, si) * inv; float e = se * inv; vec4 s0 = texelFetch(u_s0, t, 0), s1 = texelFetch(u_s1, t, 0);
  o0 = s0 + u_w * (vec4(m, dot(m, m), e) - s0); o1 = s1 + u_w * (vec4(e * e, 0.0, 0.0, 0.0) - s1); }`);
    const upd = this._compileStep(H + 'uniform sampler2D u_X, u_s; uniform float u_w; out vec4 o; void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 x = texelFetch(u_X, q, 0).xy; vec4 s = texelFetch(u_s, q, 0); vec2 r = x - s.xy; o = vec4(s.xy + u_w * (x - s.xy), s.z + u_w * (dot(x, x) - s.z), s.w + u_w * (dot(r, r) - s.w)); }');
    const res = this._compileStep(H + 'uniform sampler2D u_X, u_s; out vec4 o; void main() { ivec2 q = ivec2(gl_FragCoord.xy); o = vec4(texelFetch(u_X, q, 0).xy - texelFetch(u_s, q, 0).xy, 0.0, 1.0); }');
    let lb = ''; for (let k = 0; k < 4; k++) lb += `{ vec4 c = texelFetch(u_c${k}, q, 0); vec2 h1 = texelFetch(u_h${2 * k}, q, 0).xy, h2 = texelFetch(u_h${2 * k + 1}, q, 0).xy; vec2 z1 = vec2(r.x * h1.x + r.y * h1.y, r.y * h1.x - r.x * h1.y), z2 = vec2(r.x * h2.x + r.y * h2.y, r.y * h2.x - r.x * h2.y); o${k} = vec4(c.xy + u_wl[${2 * k}] * (z1 - c.xy), c.zw + u_wl[${2 * k + 1}] * (z2 - c.zw)); }\n`;
    const lag = this._compileStep(H + `uniform sampler2D u_r, ${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => 'u_h' + k).join(', ')}, u_c0, u_c1, u_c2, u_c3; uniform float u_wl[8];
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 r = texelFetch(u_r, q, 0).xy;
${lb}}`);
    const row = this._compileStep(H + `uniform sampler2D u_src; uniform int u_G, u_nb, u_mode; uniform vec2 u_k; out vec4 o;
const float PI = 3.141592653589793; float wr(float v) { return v - 2.0 * PI * floor((v + PI) / (2.0 * PI)); }
void main() { int b = int(gl_FragCoord.x), y = int(gl_FragCoord.y); float k1 = 2.0 * PI / float(u_G), qy = wr(float(y <= u_G / 2 ? y : y - u_G) * k1 + u_k.y); vec4 acc = vec4(0.0);
  //   only the band's own x-range (2026-10-20: was every x for every band — ×nb the work; MEASURED the read 76 ms at G 256): |q_x| ∈ [qa, qb]
  //   for this row, the two signs separately (each cell counted once), widened a cell and tested exactly as before
  float lo = float(b) * PI / float(u_nb), hi = b == u_nb - 1 ? PI : float(b + 1) * PI / float(u_nb), hy = hi * hi - qy * qy;
  if (hy >= 0.0) { float lx = lo * lo - qy * qy, qa = lx > 0.0 ? sqrt(lx) : 0.0, qb = sqrt(hy);
    for (int sg = 0; sg < 2; sg++) { float u0 = sg == 0 ? qa : -qb, u1 = sg == 0 ? qb : -qa; int x0 = int(floor((u0 - u_k.x) / k1)) - 1, n = int(ceil((u1 - u_k.x) / k1)) + 1 - x0;
      for (int t = 0; t <= 4096; t++) { if (t > n) break; int x = ((x0 + t) % u_G + u_G) % u_G; float qx = wr(float(x <= u_G / 2 ? x : x - u_G) * k1 + u_k.x);
        if ((sg == 0) != (qx >= 0.0)) continue; float k = length(vec2(qx, qy)); if (k > PI) continue; if (min(u_nb - 1, int(floor(k / PI * float(u_nb)))) != b) continue;
        vec4 s = texelFetch(u_src, ivec2(x, y), 0); acc += u_mode == 1 ? vec4(s.z, dot(s.xy, s.xy), s.w, 0.0) : s; } } }
  o = acc; }`);
    const col = this._compileStep(H + 'uniform sampler2D u_src; uniform int u_G; out vec4 o; void main() { int b = int(gl_FragCoord.x); vec4 acc = vec4(0.0); for (int y = 0; y < 2048; y++) { if (y >= u_G) break; acc += texelFetch(u_src, ivec2(b, y), 0); } o = acc; }');
    return (this._brP = { demod, tiles, upd, res, lag, row, col, ul }); }
  breathBeat(id, o) { const gl = this._gl, G = this._G, P = this._brProgs(), ul = P.ul, b = this._brG(id, o.LN, o.R, o.T), st = this._saveGL(), S = b.S, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    S.src = 'A'; this._nlPass(P.demod, S.fA, [psi], () => { gl.uniform1i(ul(P.demod, 'u_psi'), 0); gl.uniform2f(ul(P.demod, 'u_c'), Math.cos(o.car), Math.sin(o.car)); });
    { const n = 1 - b.tSs; gl.bindFramebuffer(gl.FRAMEBUFFER, b.tF[n]); gl.viewport(0, 0, b.T, b.T); gl.useProgram(P.tiles); [S.A, ...b.tS[b.tSs]].forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); });
      gl.uniform1i(ul(P.tiles, 'u_x'), 0); gl.uniform1i(ul(P.tiles, 'u_s0'), 1); gl.uniform1i(ul(P.tiles, 'u_s1'), 2); gl.uniform1i(ul(P.tiles, 'u_TB'), (G / b.T) | 0); gl.uniform1f(ul(P.tiles, 'u_w'), o.tw);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); b.tSs = n; }
    this._fft2dS(S, false); const X = S.src === 'A' ? S.A : S.B, s0 = b.sA[b.sAs][0];
    this._nlPass(P.res, b.ring[o.slot][1], [X, s0], () => { gl.uniform1i(ul(P.res, 'u_X'), 0); gl.uniform1i(ul(P.res, 'u_s'), 1); });
    this._nlPass(P.upd, b.sA[1 - b.sAs][1], [X, s0], () => { gl.uniform1i(ul(P.upd, 'u_X'), 0); gl.uniform1i(ul(P.upd, 'u_s'), 1); gl.uniform1f(ul(P.upd, 'u_w'), o.w); }); b.sAs = 1 - b.sAs;
    const rN = b.ring[o.slot][0], n = 1 - b.Cs;
    for (let g = 0; g < b.nG; g++) { const wl = new Float32Array(8), hs = []; for (let j = 0; j < 8; j++) { const l = 8 * g + j, rs = l < b.LN ? o.lags[l] : -1; wl[j] = rs >= 0 ? o.wl[l] : 0; hs.push(rs >= 0 ? b.ring[rs][0] : rN); }
      const cs = [0, 1, 2, 3].map((k) => b.C[b.Cs][Math.min(b.nC - 1, 4 * g + k)]);
      this._nlPass(P.lag, b.CF[n][g], [rN, ...hs, ...cs], () => { gl.uniform1i(ul(P.lag, 'u_r'), 0); for (let k = 0; k < 8; k++) gl.uniform1i(ul(P.lag, 'u_h' + k), 1 + k); for (let k = 0; k < 4; k++) gl.uniform1i(ul(P.lag, 'u_c' + k), 9 + k); gl.uniform1fv(ul(P.lag, 'u_wl'), wl); }); }
    b.Cs = n; this._restoreGL(st); }
  breathReadStart(id, o) { const gl = this._gl, G = this._G, b = this._br && this._br[id]; if (!b) return null; const P = this._brProgs(), ul = P.ul, nb = o.nb, rows = 1 + b.nC, st = this._saveGL();
    if (!b.red || b.red.nb !== nb || b.red.rows !== rows) { const mk = (w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return [t, f]; };
      b.red = { nb, rows, row: mk(nb, G), atl: mk(nb, rows) }; }
    const srcs = [b.sA[b.sAs][0], ...b.C[b.Cs]];
    srcs.forEach((t, r) => { gl.bindFramebuffer(gl.FRAMEBUFFER, b.red.row[1]); gl.viewport(0, 0, nb, G); gl.useProgram(P.row); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(ul(P.row, 'u_src'), 0); gl.uniform1i(ul(P.row, 'u_G'), G); gl.uniform1i(ul(P.row, 'u_nb'), nb); gl.uniform1i(ul(P.row, 'u_mode'), r === 0 ? 1 : 0); gl.uniform2f(ul(P.row, 'u_k'), +o.kx || 0, +o.ky || 0);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.red.atl[1]); gl.viewport(0, r, nb, 1); gl.useProgram(P.col); gl.bindTexture(gl.TEXTURE_2D, b.red.row[0]); gl.uniform1i(ul(P.col, 'u_src'), 0); gl.uniform1i(ul(P.col, 'u_G'), G);
      gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); });
    //   the read WITHOUT a stall (2026-10-20): one PBO (atlas, then the two tile planes) + a fence — poll breathReadReady, then breathReadFinish
    const T = b.T, nA = nb * rows * 4, nT = T * T * 4, pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, (nA + 2 * nT) * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.red.atl[1]); gl.readPixels(0, 0, nb, rows, gl.RGBA, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.tF[b.tSs]); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, T, T, gl.RGBA, gl.FLOAT, nA * 4); gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, T, T, gl.RGBA, gl.FLOAT, (nA + nT) * 4); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); this._restoreGL(st); return { pbo, fence, nb, rows, nA, nT }; }
  breathReadReady(h) { return !!h && this.readEyePsiReady(h); }
  breathReadFinish(h) { const gl = this._gl, o = new Float32Array(h.nA + 2 * h.nT); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, o); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); this.readEyePsiDrop(h);
    return { nb: h.nb, rows: h.rows, atlas: o.subarray(0, h.nA), tiles: o.subarray(h.nA) }; }
  breathFree(id) { const gl = this._gl, b = this._br && this._br[id]; if (!b) return; const del = (t) => t && gl.deleteTexture(t);
    del(b.S.A); del(b.S.B); for (const [t] of [...b.sA, ...b.ring]) del(t); for (const P of b.C) P.forEach(del); for (const P of b.tS) P.forEach(del); if (b.red) { del(b.red.row[0]); del(b.red.atl[0]); } delete this._br[id]; }
  //   specBankPow(id, a) — the exposed band powers after a bank sub-step (see GLSL_SPEC_BANKP); specBankPowUpload(id, f32) writes host powers (8 per cell: m·N + j)
  _specBankPw(id) { const gl = this._gl, s = this._spec[id]; if (s.bankP) return s.bankP;
    const mk = () => { const T = [], f = gl.createFramebuffer(); for (let k = 0; k < 2; k++) { const [t, f1] = this._specTex4(); gl.deleteFramebuffer(f1); T.push(t); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0); }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { T, f }; };
    const A = mk(), B = mk(); return (s.bankP = { T: [A.T, B.T], F: [A.f, B.f], src: 0 }); }
  specBankPow(id, a) { const gl = this._gl, s = this._spec && this._spec[id]; if (!s || !s.bank2) return; const bp = this._specBankPw(id), b2 = s.bank2;
    if (!this._specBankPP) { const p = this._compileStep(GLSL_SPEC_BANKP), ul = (n) => gl.getUniformLocation(p, n); this._specBankPP = { p, u: { b: [0, 1, 2, 3].map((k) => ul('u_b' + k)), p: [0, 1].map((k) => ul('u_p' + k)), a: ul('u_a') } }; }
    const P = this._specBankPP; this._nlPass(P.p, bp.F[1 - bp.src], [...b2.T[b2.src], ...bp.T[bp.src]], () => { for (let k = 0; k < 4; k++) gl.uniform1i(P.u.b[k], k); gl.uniform1i(P.u.p[0], 4); gl.uniform1i(P.u.p[1], 5); gl.uniform1f(P.u.a, a); }); bp.src = 1 - bp.src; }
  specBankPowUpload(id, P8) { const gl = this._gl, G = this._G, N = G * G; this._specBank(id); const bp = this._specBankPw(id), f = new Float32Array(4 * N);
    for (let k = 0; k < 2; k++) { for (let j = 0; j < N; j++) for (let q = 0; q < 4; q++) f[4 * j + q] = P8[(4 * k + q) * N + j]; gl.bindTexture(gl.TEXTURE_2D, bp.T[bp.src][k]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RGBA, gl.FLOAT, f); } gl.bindTexture(gl.TEXTURE_2D, null); }
  specBankUpload(id, f32) { const gl = this._gl, G = this._G, n = G * G * 4; this._specBank(id); const b = this._spec[id].bank2; for (let k = 0; k < 4; k++) { gl.bindTexture(gl.TEXTURE_2D, b.T[b.src][k]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RGBA, gl.FLOAT, f32.subarray(k * n, (k + 1) * n)); } gl.bindTexture(gl.TEXTURE_2D, null); }
  specBankRead(id) { const gl = this._gl, G = this._G, n = G * G * 4, s = this._spec && this._spec[id]; if (!s || !s.bank) return null; const o = new Float32Array(4 * n), b = s.bank2 || s.bank;
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.F[b.src]); for (let k = 0; k < 4; k++) { gl.readBuffer(gl.COLOR_ATTACHMENT0 + k); gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, o.subarray(k * n, (k + 1) * n)); } gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return o; }
  //   ◐ HOLO VIEW passes (see GLSL_VIEW_GATE / GLSL_HOLO_VIEW): viewCopy(srcId, dstId) makes slot dstId the ACTIVE eye holding slot srcId's field;
  //   viewGate({ r2, bs, bsr2, hp }) on the active eye IN k; holoViewPass(mode, Aq, mx, my, ang0, z1, z2) on the active eye in real space.
  //   Display only: the app keeps its CPU path for the numbers (fidelities) and for what these do not cover.
  _viewProgs() { if (this._vwP) return this._vwP; const gl = this._gl, g = this._compileStep(GLSL_VIEW_GATE), h = this._compileStep(GLSL_HOLO_VIEW), c = this._compileStep(GLSL_SPEC_COPY), ul = (p, n) => gl.getUniformLocation(p, n);
    return (this._vwP = { g, h, c, ug: Object.fromEntries(['x', 'G', 'r2', 'nb', 'bs', 'bsr2', 'hp', 'kcm', 'kc2'].map((n) => [n, ul(g, 'u_' + n)])), uh: Object.fromEntries(['x', 'e', 'G', 'mode', 'Aq', 'mx', 'my', 'ang0', 'z1', 'z2', 'th', 'tw', 'tr', 'hm', 'hasHm'].map((n) => [n, ul(h, 'u_' + n)])), uc: ul(c, 'u_x') }); }
  //   ◷ / ◠ F^a ON THE GPU (2026-10-20, optional): a SEPARABLE complex matrix M (G×G, row x = output cell, column u = input cell — the app's
  //   native-fft frftMatrix) applied along x, then along y: out(x, y) = Σ_u M[x][u]·in(u, y), then Σ_v M[y][v]·(·)(x, v). Two passes, G reads a
  //   fragment. viewSepMat(M) on the selected eye slot; _sepMatS(S, M) on a scratch ping-pong ({A, fA, B, fB, src}, the band probe's).
  _sepMatTex(M) { const gl = this._gl, G = this._G; this._smT = this._smT || new Map(); let t = this._smT.get(M.key); if (t) return t;
    const f = new Float32Array(2 * G * G); for (let x = 0; x < G; x++) for (let u = 0; u < G; u++) { f[2 * (x * G + u)] = M.re[x * G + u]; f[2 * (x * G + u) + 1] = M.im[x * G + u]; }
    t = this._makeRGF32Tex(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null);
    if (this._smT.size > 8) { for (const v of this._smT.values()) gl.deleteTexture(v); this._smT.clear(); } this._smT.set(M.key, t); return t; }
  _sepMatProg() { if (this._smP) return this._smP; const gl = this._gl, p = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_src, u_M; uniform int u_axis, u_G; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); int x = u_axis == 0 ? q.x : q.y; vec2 acc = vec2(0.0);
  for (int u = 0; u < 4096; u++) { if (u >= u_G) break; vec2 m = texelFetch(u_M, ivec2(u, x), 0).xy, v = texelFetch(u_src, u_axis == 0 ? ivec2(u, q.y) : ivec2(q.x, u), 0).xy; acc += vec2(m.x * v.x - m.y * v.y, m.x * v.y + m.y * v.x); }
  o = vec4(acc, 0.0, 1.0); }`), ul = (n) => gl.getUniformLocation(p, n); return (this._smP = { p, u: { src: ul('u_src'), M: ul('u_M'), axis: ul('u_axis'), G: ul('u_G') } }); }
  //   ◷ THE CLOCK FORM FAST (2026-10-20): per axis F^a = Σ b_k·F_c^k, and every power of the centred DFT is the FFT or a reflection — with X =
  //   (x + G/2) mod G and W = FFT_axis(w), w[U] = v[(U + G/2) mod G]: (F_c v)[x] = W[X]/√G, (P·F_c v)[x] = W[(G − X) mod G]/√G, (P v)[x] = v at
  //   ((G − X) mod G + G/2) mod G. One copy, one roll, one 1-D native FFT and one combine per axis (G 512: 10 short passes) instead of two
  //   passes of G taps a pixel. Needs the native Stockham FFT (_fftStockham); the matrix path otherwise and for the lattice GRIN ◠.
  _clockProgs() { if (this._ckP) return this._ckP; const gl = this._gl;
    const roll = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_v; uniform int u_axis, u_G; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); int H = u_G / 2; ivec2 s = u_axis == 0 ? ivec2((q.x + H) % u_G, q.y) : ivec2(q.x, (q.y + H) % u_G); o = vec4(texelFetch(u_v, s, 0).xy, 0.0, 1.0); }`);
    const comb = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_v, u_W; uniform int u_axis, u_G; uniform vec2 u_b[4]; uniform float u_s; out vec4 o;
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
ivec2 at(ivec2 q, int i) { return u_axis == 0 ? ivec2(i, q.y) : ivec2(q.x, i); }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); int G = u_G, H = G / 2, x = u_axis == 0 ? q.x : q.y, X = (x + H) % G, Xm = (G - X) % G;
  vec2 v = texelFetch(u_v, q, 0).xy, f = texelFetch(u_W, at(q, X), 0).xy * u_s, pv = texelFetch(u_v, at(q, (Xm + H) % G), 0).xy, pf = texelFetch(u_W, at(q, Xm), 0).xy * u_s;
  o = vec4(cm(u_b[0], v) + cm(u_b[1], f) + cm(u_b[2], pv) + cm(u_b[3], pf), 0.0, 1.0); }`);
    const cp = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_v; out vec4 o; void main() { o = vec4(texelFetch(u_v, ivec2(gl_FragCoord.xy), 0).xy, 0.0, 1.0); }`);
    const [vt, vf] = this._makePsiTex(), ul = (p, n) => gl.getUniformLocation(p, n);
    return (this._ckP = { roll, comb, cp, vt, vf, u: { rv: ul(roll, 'u_v'), ra: ul(roll, 'u_axis'), rG: ul(roll, 'u_G'), cv: ul(comb, 'u_v'), cW: ul(comb, 'u_W'), ca: ul(comb, 'u_axis'), cG: ul(comb, 'u_G'), cb: ul(comb, 'u_b'), cs: ul(comb, 'u_s'), pv: ul(cp, 'u_v') } }); }
  _clockS(st, B) { const gl = this._gl, G = this._G, P = this._clockProgs(), U = P.u, b = new Float32Array(8); for (let k = 0; k < 4; k++) { b[2 * k] = B[k][0]; b[2 * k + 1] = B[k][1]; }
    const cur = () => (st.src === 'A' ? st.A : st.B), other = () => (st.src === 'A' ? st.fB : st.fA), flip = () => { st.src = st.src === 'A' ? 'B' : 'A'; };
    for (const axis of [0, 1]) {
      this._nlPass(P.cp, P.vf, [cur()], () => gl.uniform1i(U.pv, 0));   // v kept
      this._nlPass(P.roll, other(), [P.vt], () => { gl.uniform1i(U.rv, 0); gl.uniform1i(U.ra, axis); gl.uniform1i(U.rG, G); }); flip();   // w = v rolled by G/2
      this._stkAxes = [axis]; try { this._fft2dStockham(st, false); } finally { this._stkAxes = null; }   // W = the axis FFT (natural order)
      this._nlPass(P.comb, other(), [P.vt, cur()], () => { gl.uniform1i(U.cv, 0); gl.uniform1i(U.cW, 1); gl.uniform1i(U.ca, axis); gl.uniform1i(U.cG, G); gl.uniform2fv(U.cb, b); gl.uniform1f(U.cs, 1 / Math.sqrt(G)); }); flip(); } }
  viewSepMat(M) { const gl = this._gl;
    if (M.clock && this._fftStockham) { const self = this; return this._clockS({ get A() { return self._eyeA; }, get fA() { return self._fboEyeA; }, get B() { return self._eyeB; }, get fB() { return self._fboEyeB; }, get src() { return self._eyeSrc; }, set src(v) { self._eyeSrc = v; } }, M.clock); }
    const P = this._sepMatProg(), T = this._sepMatTex(M);
    for (const axis of [0, 1]) this._eyePass(P.p, [T], () => { gl.uniform1i(P.u.src, 0); gl.uniform1i(P.u.M, 1); gl.uniform1i(P.u.axis, axis); gl.uniform1i(P.u.G, this._G); }); }
  _sepMatS(S, M) { if (M.clock && this._fftStockham) return this._clockS(S, M.clock); const gl = this._gl, P = this._sepMatProg(), T = this._sepMatTex(M);
    for (const axis of [0, 1]) { const src = S.src === 'A' ? S.A : S.B, fbo = S.src === 'A' ? S.fB : S.fA; this._nlPass(P.p, fbo, [src, T], () => { gl.uniform1i(P.u.src, 0); gl.uniform1i(P.u.M, 1); gl.uniform1i(P.u.axis, axis); gl.uniform1i(P.u.G, this._G); }); S.src = S.src === 'A' ? 'B' : 'A'; } }
  _eyePass(prog, binds, uni) { const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA; this._nlPass(prog, fbo, [this._eyeSrc === 'A' ? this._eyeA : this._eyeB, ...binds], uni); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  viewCopy(srcId, dstId) { const gl = this._gl, s = this._slotEye[srcId]; if (!s) return false; const src = s.src === 'A' ? s.A : s.B, P = this._viewProgs(); this.selectEyeSlot(dstId);
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA; this._nlPass(P.c, fbo, [src], () => gl.uniform1i(P.uc, 0)); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; this.commitEyeSlot(dstId); return true; }
  //   ⚛ THE CONDENSATE's PHASE SPACE ON THE GPU (2026-11-08 — INERT additions: only the ahc app's ⚛ condensate calls them). becGpuStep(srcId, o) at a
  //   read's due beat: the slot's field copied to a scratch eye ('becS'), forward FFT → the k average (accK += a·(|ψ̂|²/N − accK): the time-of-flight
  //   texture), the band |k| < kb, inverse FFT → ψ band-limited, the LAG products f(x, s) = h(s)·Σ_{y0..y1} ψ*(x−s, y)ψ(x+s, y) (Tukey lag window over
  //   |s| < Q/2), the 64-term DFT over s → W(x, k) (row mm = (m + Q/2) mod Q), averaged into accW. Same arithmetic as the app's CPU pseudo-Wigner.
  //   becGpuReadWStart(Q) — a fenced read of accW's G×Q region (RG; W in .x), finished by readEyePsiFinish. becGpuReset / becGpuSetW (a joiner's seed).
  _becG(tag = 'acc') { this._becAll = this._becAll || {}; if (this._becAll[tag]) return this._becAll[tag]; const gl = this._gl, mk = () => { const [t, f] = this._makePsiTex(); return { t, f }; }, pp = () => ({ a: mk(), b: mk(), cur: 'a' }), ul = (p, ns) => Object.fromEntries(ns.map((n) => [n, gl.getUniformLocation(p, 'u_' + n)]));
    if (!this._becPr) { const pk = this._compileStep(GLSL_BEC_KACC), pb = this._compileStep(GLSL_BEC_BAND), pl = this._compileStep(GLSL_BEC_LAG), pw = this._compileStep(GLSL_BEC_WDFT);
      this._becPr = { pk, pb, pl, pw, uk: ul(pk, ['x', 'acc', 'a', 'n']), ub: ul(pb, ['x', 'G', 'kb']), ul: ul(pl, ['x', 'G', 'Q', 'y0', 'y1']), uw: ul(pw, ['f', 'acc', 'Q', 'a']) }; }
    const S = { K: pp(), W: pp(), L: mk(), scratch: tag === 'acc' ? 'becS' : 'becV', ...this._becPr }; if (tag === 'acc') this._becGS = S; return (this._becAll[tag] = S); }
  becGpuReset() { const S = this._becG(), gl = this._gl, G = this._G, z = new Float32Array(2 * G * G); for (const P of [S.K, S.W]) for (const h of [P.a, P.b]) { gl.bindTexture(gl.TEXTURE_2D, h.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, z); } gl.bindTexture(gl.TEXTURE_2D, null); }
  becGpuSetW(wg, Q) { const S = this._becG(), gl = this._gl, G = this._G, f = new Float32Array(2 * G * G); for (let x = 0; x < G; x++) for (let mm = 0; mm < Q; mm++) f[2 * (mm * G + x)] = +wg[x * Q + mm] || 0; gl.bindTexture(gl.TEXTURE_2D, S.W[S.W.cur].t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); }
  becGpuStep(srcId, o = {}) { return this._becPipe('acc', srcId, o); }
  _becPipe(tag, srcId, { a = 1, kb = 0, y0 = 0, y1 = 0, Q = 0 } = {}) { if (!this._slotEye[srcId]) return false; const gl = this._gl, G = this._G, S = this._becG(tag), cur = () => (this._eyeSrc === 'A' ? this._eyeA : this._eyeB);
    this.viewCopy(srcId, S.scratch); this.fftEye(false);
    { const P = S.K, i = P[P.cur], o = P[P.cur === 'a' ? 'b' : 'a']; this._nlPass(S.pk, o.f, [cur(), i.t], () => { gl.uniform1i(S.uk.x, 0); gl.uniform1i(S.uk.acc, 1); gl.uniform1f(S.uk.a, a); gl.uniform1f(S.uk.n, 1 / (G * G)); }); P.cur = P.cur === 'a' ? 'b' : 'a'; }
    this._eyePass(S.pb, [], () => { gl.uniform1i(S.ub.x, 0); gl.uniform1i(S.ub.G, G); gl.uniform1i(S.ub.kb, kb | 0); }); this.fftEye(true);
    this._nlPass(S.pl, S.L.f, [cur()], () => { gl.uniform1i(S.ul.x, 0); gl.uniform1i(S.ul.G, G); gl.uniform1i(S.ul.Q, Q | 0); gl.uniform1i(S.ul.y0, y0 | 0); gl.uniform1i(S.ul.y1, y1 | 0); });
    { const P = S.W, i = P[P.cur], o = P[P.cur === 'a' ? 'b' : 'a']; this._nlPass(S.pw, o.f, [S.L.t, i.t], () => { gl.uniform1i(S.uw.f, 0); gl.uniform1i(S.uw.acc, 1); gl.uniform1i(S.uw.Q, Q | 0); gl.uniform1f(S.uw.a, a); }); P.cur = P.cur === 'a' ? 'b' : 'a'; }
    this.commitEyeSlot(S.scratch); this.selectEyeSlot(null); return true; }
  //   ⚛ THE SPACE VIEWS (2026-11-08, inert — the app's "space" button): spaceRender(srcId, 'k' | 'phase', { acc }) draws into the default framebuffer (the canvas
  //   the field is rendered to): k — |ψ̂(k)|² (log, k 0 at the centre), or the condensate's replicated k AVERAGE (acc); phase — W(x, k_x) (x across, k_x up,
  //   orange > 0, blue < 0), the condensate's replicated W average (acc) or the field's own W summed over all rows. Normalised by a GPU max (2 reductions,
  //   sampled by the render — nothing read back).
  spaceRender(srcId, space, { acc = false } = {}) { const gl = this._gl, G = this._G, Q = G >> 1, cur = () => (this._eyeSrc === 'A' ? this._eyeA : this._eyeB); let tex, mode;
    if (acc && this._becGS) { const S = this._becGS; if (space === 'k') { tex = S.K[S.K.cur].t; mode = 2; } else { tex = S.W[S.W.cur].t; mode = 1; } }
    else if (space === 'k') { if (!this._slotEye[srcId]) return false; this.viewCopy(srcId, 'spk'); this.fftEye(false); tex = cur(); this.commitEyeSlot('spk'); this.selectEyeSlot(null); mode = 0; }
    else if (space === 'amb') { if (!this._becPipe('view', srcId, { a: 1, kb: G >> 2, y0: 0, y1: G - 1, Q })) return false; const S = this._becAll.view;   /* the AMBIGUITY function A(τ, ν) = Σ_x f(x, s)·e^{iνx} — W's Fourier transform: the lag products transformed along x */
      if (!this._ambT) { this._ambT = this._rgbaTex(G, G); this._ambP = this._compileStep(GLSL_AMB); this._ambU = Object.fromEntries(['f', 'G', 'Q'].map((n) => [n, gl.getUniformLocation(this._ambP, 'u_' + n)])); }
      this._drawTo(this._ambP, this._ambT.f, G, G, [S.L.t], () => { gl.uniform1i(this._ambU.f, 0); gl.uniform1i(this._ambU.G, G); gl.uniform1i(this._ambU.Q, Q); }); tex = this._ambT.t; mode = 3; }
    else { if (!this._becPipe('view', srcId, { a: 1, kb: G >> 2, y0: 0, y1: G - 1, Q })) return false; const S = this._becAll.view; tex = S.W[S.W.cur].t; mode = 1; }
    if (!this._spR) { const p = this._compileStep(GLSL_SPACE_MAXROW), c = this._compileStep(GLSL_SPACE_MAXCOL), r = this._compileStep(GLSL_SPACE_RENDER), ul = (q, ns) => Object.fromEntries(ns.map((n) => [n, gl.getUniformLocation(q, 'u_' + n)]));
      const mkR = (w) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, w, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f }; };
      this._spR = { p, c, r, up: ul(p, ['t', 'G', 'mode']), uc: ul(c, ['t', 'G']), ur: ul(r, ['t', 'mx', 'G', 'Q', 'mode']), row: mkR(G), one: mkR(1) }; }
    const R = this._spR, draw = (prog, fbo, w, h, texs, uni) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prog); uni(); texs.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); }); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); };
    draw(R.p, R.row.f, G, 1, [tex], () => { gl.uniform1i(R.up.t, 0); gl.uniform1i(R.up.G, G); gl.uniform1i(R.up.mode, mode); });
    draw(R.c, R.one.f, 1, 1, [R.row.t], () => { gl.uniform1i(R.uc.t, 0); gl.uniform1i(R.uc.G, G); });
    draw(R.r, null, G, G, [tex, R.one.t], () => { gl.uniform1i(R.ur.t, 0); gl.uniform1i(R.ur.mx, 1); gl.uniform1i(R.ur.G, G); gl.uniform1i(R.ur.Q, Q); gl.uniform1i(R.ur.mode, mode); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); return true; }
  becGpuReadWStart(Q) { const gl = this._gl, G = this._G, S = this._becG(), n = G * Q * 2, pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.W[S.W.cur].f); gl.readPixels(0, 0, G, Q, gl.RG, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n }; }
  //   ⚛ THE MEDIUM's TIME SERIES AT ONE CELL (2026-11-08, inert — the app's t-f view): tfSample(x, y, beat) copies the SELECTED eye's ψ(x, y) into a ring
  //   texture (L × 1, RG) at column beat mod L — called inside the stepping at each beat boundary, so the series is taken at the beats themselves (the same on
  //   every peer). tfReadStart → a fenced read of the ring (finish with readEyePsiFinish); tfReset clears it.
  _tfRing(L) { if (this._tfR && this._tfR.L === L) return this._tfR; const gl = this._gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, L, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const p = this._tfR?.p || this._compileStep(GLSL_TF_SAMPLE), pr = this._tfR?.pr || this._compileStep(GLSL_TF_ROWSUM), row = this._tfR?.row || this._rgbaTex(this._G, 1); return (this._tfR = { L, t, f, p, pr, row, ux: gl.getUniformLocation(p, 'u_x'), up: gl.getUniformLocation(p, 'u_p'), um: gl.getUniformLocation(p, 'u_mode'), urw: gl.getUniformLocation(p, 'u_row'), uG: gl.getUniformLocation(p, 'u_G'), urx: gl.getUniformLocation(pr, 'u_x'), urG: gl.getUniformLocation(pr, 'u_G') }); }
  //   (+ mode, 2026-11-09 — user: "a different signal": 0 the cell, 1 the 5 × 5 average about it, 2 the WHOLE field's k = 0 mode Σψ/N (a column-sum pass, then the sum))
  tfSample(x, y, beat, L = 512, mode = 0) { const gl = this._gl, R = this._tfRing(L), G = this._G, src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    if (mode === 2) this._drawTo(R.pr, R.row.f, G, 1, [src], () => { gl.uniform1i(R.urx, 0); gl.uniform1i(R.urG, G); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.f); gl.viewport(((beat % L) + L) % L, 0, 1, 1); gl.useProgram(R.p); gl.uniform1i(R.ux, 0); gl.uniform1i(R.urw, 1); gl.uniform2i(R.up, x | 0, y | 0); gl.uniform1i(R.um, mode | 0); gl.uniform1i(R.uG, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.row.t); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  tfReset(L = 512) { const gl = this._gl, R = this._tfRing(L); gl.bindTexture(gl.TEXTURE_2D, R.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, L, 1, gl.RG, gl.FLOAT, new Float32Array(2 * L)); gl.bindTexture(gl.TEXTURE_2D, null); }
  tfReadStart(L = 512) { const gl = this._gl, R = this._tfRing(L), n = 2 * L, pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ); gl.bindFramebuffer(gl.FRAMEBUFFER, R.f); gl.readPixels(0, 0, L, 1, gl.RG, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n }; }
  //   ◌ THE VORTEX OVERLAY (2026-11-08, inert — the app's ◌ button): the slot's field copied, band-limited to |k| < kb (the grid's noise off), and every plaquette's
  //   phase WINDING drawn OVER the canvas (blended: + red, − cyan, one cell), at the display's pose offset (the field render samples x − off); a plaquette
  //   counts only where its four corners hold density ≥ nmin. The counts by two reductions, read asynchronously: returns the last finished [n+, n−].
  //   Optional (inert at 0): kenv > 0 — a smooth ENVELOPE, the field band-limited to |k| < kenv (the cores filled in); a plaquette where the envelope's density is
  //   below nfl is a halo GHOST — drawn dim, not counted (the counts are then the FLUID's).
  vortexRender(srcId, { ox = 0, oy = 0, nmin = 0, kb = 0, kenv = 0, nfl = 0 } = {}) { if (!this._slotEye[srcId]) return null; const gl = this._gl, G = this._G, S = this._becG('view'), cur = () => (this._eyeSrc === 'A' ? this._eyeA : this._eyeB);
    this.viewCopy(srcId, 'vtxS'); this.fftEye(false); this._eyePass(S.pb, [], () => { gl.uniform1i(S.ub.x, 0); gl.uniform1i(S.ub.G, G); gl.uniform1i(S.ub.kb, (kb | 0) || (G >> 2)); }); this.fftEye(true); const src = cur(); this.commitEyeSlot('vtxS'); this.selectEyeSlot(null);
    let env = src; if (kenv > 0) { this.viewCopy(srcId, 'vtxE'); this.fftEye(false); this._eyePass(S.pb, [], () => { gl.uniform1i(S.ub.x, 0); gl.uniform1i(S.ub.G, G); gl.uniform1i(S.ub.kb, kenv | 0); }); this.fftEye(true); env = cur(); this.commitEyeSlot('vtxE'); this.selectEyeSlot(null); }
    if (!this._vtx) { const ul = (q, ns) => Object.fromEntries(ns.map((n) => [n, gl.getUniformLocation(q, 'u_' + n)])), po = this._compileStep(GLSL_VTX_OVL), pc = this._compileStep(GLSL_VTX_COL), ps = this._compileStep(GLSL_VTX_SUM);
      const mk = (w) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, w, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f }; };
      this._vtx = { po, pc, ps, uo: ul(po, ['x', 'G', 'off', 'nmin', 'e', 'nfl']), uc: ul(pc, ['x', 'G', 'nmin', 'e', 'nfl']), us: ul(ps, ['t', 'G']), row: mk(G), one: mk(1), rd: null, n: null }; }
    const V = this._vtx, draw = (prog, fbo, w, h, texs, uni) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prog); uni(); texs.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); }); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); };
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); draw(V.po, null, G, G, [src, env], () => { gl.uniform1i(V.uo.x, 0); gl.uniform1i(V.uo.e, 1); gl.uniform1i(V.uo.G, G); gl.uniform2f(V.uo.off, +ox || 0, +oy || 0); gl.uniform1f(V.uo.nmin, +nmin || 0); gl.uniform1f(V.uo.nfl, kenv > 0 ? +nfl || 0 : 0); }); gl.disable(gl.BLEND);
    if (V.rd) { let ok = false; try { ok = gl.getSyncParameter(V.rd.fence, gl.SYNC_STATUS) === gl.SIGNALED; } catch (e) { ok = true; } if (ok) { const f = new Float32Array(2); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, V.rd.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(V.rd.pbo); gl.deleteSync(V.rd.fence); V.rd = null; V.n = [Math.round(f[0]), Math.round(f[1])]; } }
    if (!V.rd) { draw(V.pc, V.row.f, G, 1, [src, env], () => { gl.uniform1i(V.uc.x, 0); gl.uniform1i(V.uc.e, 1); gl.uniform1i(V.uc.G, G); gl.uniform1f(V.uc.nmin, +nmin || 0); gl.uniform1f(V.uc.nfl, kenv > 0 ? +nfl || 0 : 0); }); draw(V.ps, V.one.f, 1, 1, [V.row.t], () => { gl.uniform1i(V.us.t, 0); gl.uniform1i(V.us.G, G); });
      const pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 8, gl.STREAM_READ); gl.bindFramebuffer(gl.FRAMEBUFFER, V.one.f); gl.readPixels(0, 0, 1, 1, gl.RG, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); V.rd = { pbo, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) }; gl.flush(); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); return V.n; }
  //   ⚛ THE HUSIMI PATCHES (2026-11-08, inert — the app's T(x, y) view): husimiSample(a) — on the SELECTED eye (called inside the stepping at a beat boundary):
  //   the field cut into (G/P)² patches of P × P cells (P 16), each × a Gaussian window (σ P/4, centred), its P × P DFT → |·|² — the local momentum
  //   distribution (the Husimi function: the Wigner smoothed, never negative) — averaged into an accumulator (EMA weight a). Texel (px·P + kx, py·P + ky) = patch
  //   (px, py), local k (kx, ky). husimiReadStart → a fenced read (RG; .x), finished by readEyePsiFinish; husimiReset clears it.
  //   (+ the STRIDE st, 2026-11-09 — user: "a finer temperature map": a P-window centred every st cells, OVERLAPPING — (G/st)² patches, the accumulator (G/st·P)²;
  //   st = P: the old tiling)
  _husG(P = 16, st = 16) { const A = (this._G / st) * P; if (this._husS && this._husS.A === A && this._husS.st === st) return this._husS; const gl = this._gl, mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, A, A); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f }; }, p = this._husS?.p || this._compileStep(GLSL_HUSIMI);
    return (this._husS = { A, st, P, a: mk(), b: mk(), cur: 'a', p, u: Object.fromEntries(['x', 'acc', 'a', 'P', 'st', 'G'].map((n) => [n, gl.getUniformLocation(p, 'u_' + n)])) }); }
  husimiSample(a = 1, P = 16, st = 16) { const gl = this._gl, S = this._husG(P, st), src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, i = S[S.cur], o = S[S.cur === 'a' ? 'b' : 'a'];
    this._drawTo(S.p, o.f, S.A, S.A, [src, i.t], () => { gl.uniform1i(S.u.x, 0); gl.uniform1i(S.u.acc, 1); gl.uniform1f(S.u.a, a); gl.uniform1i(S.u.P, P); gl.uniform1i(S.u.st, st); gl.uniform1i(S.u.G, this._G); }); S.cur = S.cur === 'a' ? 'b' : 'a'; }
  husimiReset(P = 16, st = 16) { const S = this._husG(P, st), gl = this._gl, z = new Float32Array(2 * S.A * S.A); for (const h of [S.a, S.b]) { gl.bindTexture(gl.TEXTURE_2D, h.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S.A, S.A, gl.RG, gl.FLOAT, z); } gl.bindTexture(gl.TEXTURE_2D, null); }
  husimiReadStart() { const gl = this._gl, G = this._G, S = this._husG(), n = G * G * 2, pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ); gl.bindFramebuffer(gl.FRAMEBUFFER, S[S.cur].f); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n }; }
  //   ⚛ LIVE ANALYSES (2026-11-08, inert — the app's t-f and T(x, y) views, user: "lively like spectral"): rendered every frame from GPU textures, nothing
  //   read back but a few label numbers (async). _rgbaTex(w, h) — a small RGBA32F target. tfRender — the Wigner–Ville of the ring (beats b0 … b1): the carrier
  //   f_c (1 × 1: arg Σ z(b+1)·z*(b)), W into G × G (time across, f = f_c ± F up, Hann over ±Mh), the max, the colour + the first-moment line to the canvas;
  //   tfStatsStart → [f_c, the latest column's moment] (fenced). husimiEps(f) — the ε table (P × P RG: ε, use) for the fit; husimiRender — the per-patch
  //   Rayleigh–Jeans fit (binned: T, r, density) into NP × NP, then the map blended over the canvas at the pose offset; husimiStatsStart → the NP × NP fit (fenced).
  _rgbaTex(w, h) { const gl = this._gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f, w, h }; }
  _drawTo(prog, fbo, w, h, texs, uni, blend = false) { const gl = this._gl; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prog); uni(); texs.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); });
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); } gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); if (blend) gl.disable(gl.BLEND); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  _readSmall(fbo, w, h) { const gl = this._gl, n = 4 * w * h, pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n }; }
  tfRender({ b0 = 0, b1 = 0, Mh = 48, F = 0.25, L = 512, Lt = 0, refs = [] } = {}) { const gl = this._gl, G = this._G, R = this._tfRing(L); if (b1 - b0 < 2 * Mh + 2 * (Lt | 0) + 4) return false;
    if (!this._tfV) { const ul = (q, ns) => Object.fromEntries(ns.map((n) => [n, gl.getUniformLocation(q, 'u_' + n)])), pf = this._compileStep(GLSL_TF_FC), pw = this._compileStep(GLSL_TF_WVD), pr = this._compileStep(GLSL_TF_RENDER), ps = this._compileStep(GLSL_TF_STATS);
      this._tfV = { pf, pw, pr, ps, uf: ul(pf, ['r', 'L', 'b0', 'b1']), uw: ul(pw, ['r', 'fc', 'L', 'b0', 'b1', 'Mh', 'F', 'G', 'Lt']), ur: ul(pr, ['w', 'mx', 'G', 'fc', 'F', 'nref', 'ref']), us: ul(ps, ['w', 'fc', 'G', 'F']), fc: this._rgbaTex(1, 1), W: this._rgbaTex(G, G), st: this._rgbaTex(1, 1), mxRow: this._rgbaTex(G, 1), mx: this._rgbaTex(1, 1), rd: null, stats: null };
      this._tfV.pmr = this._compileStep(GLSL_SPACE_MAXROW); this._tfV.pmc = this._compileStep(GLSL_SPACE_MAXCOL); this._tfV.umr = ul(this._tfV.pmr, ['t', 'G', 'mode']); this._tfV.umc = ul(this._tfV.pmc, ['t', 'G']); }
    const V = this._tfV;
    this._drawTo(V.pf, V.fc.f, 1, 1, [R.t], () => { gl.uniform1i(V.uf.r, 0); gl.uniform1i(V.uf.L, L); gl.uniform1i(V.uf.b0, b0); gl.uniform1i(V.uf.b1, b1); });
    this._drawTo(V.pw, V.W.f, G, G, [R.t, V.fc.t], () => { gl.uniform1i(V.uw.r, 0); gl.uniform1i(V.uw.fc, 1); gl.uniform1i(V.uw.L, L); gl.uniform1i(V.uw.b0, b0); gl.uniform1i(V.uw.b1, b1); gl.uniform1i(V.uw.Mh, Mh); gl.uniform1f(V.uw.F, F); gl.uniform1i(V.uw.G, G); gl.uniform1i(V.uw.Lt, Lt | 0); });
    this._drawTo(V.pmr, V.mxRow.f, G, 1, [V.W.t], () => { gl.uniform1i(V.umr.t, 0); gl.uniform1i(V.umr.G, G); gl.uniform1i(V.umr.mode, 1); });
    this._drawTo(V.pmc, V.mx.f, 1, 1, [V.mxRow.t], () => { gl.uniform1i(V.umc.t, 0); gl.uniform1i(V.umc.G, G); });
    const rf = new Float32Array(8); const nr = Math.min(8, refs.length); for (let k = 0; k < nr; k++) rf[k] = +refs[k] || 0;
    this._drawTo(V.pr, null, G, G, [V.W.t, V.mx.t, V.fc.t], () => { gl.uniform1i(V.ur.w, 0); gl.uniform1i(V.ur.mx, 1); gl.uniform1i(V.ur.G, G); gl.uniform1i(V.ur.fc, 2); gl.uniform1f(V.ur.F, F); gl.uniform1i(V.ur.nref, nr); gl.uniform1fv(V.ur.ref, rf); });
    if (V.rd) { let ok = false; try { ok = gl.getSyncParameter(V.rd.fence, gl.SYNC_STATUS) === gl.SIGNALED; } catch (e) { ok = true; } if (ok) { const f = new Float32Array(4); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, V.rd.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(V.rd.pbo); gl.deleteSync(V.rd.fence); V.rd = null; V.stats = { fc: f[0], fNow: f[1] }; } }
    if (!V.rd && (!V.at || performance.now() - V.at > 400)) { V.at = performance.now(); this._drawTo(V.ps, V.st.f, 1, 1, [V.W.t, V.fc.t], () => { gl.uniform1i(V.us.w, 0); gl.uniform1i(V.us.fc, 1); gl.uniform1i(V.us.G, G); gl.uniform1f(V.us.F, F); }); V.rd = this._readSmall(V.st.f, 1, 1); }
    return V.stats || {}; }
  husimiEps(f, P = 16) { const gl = this._gl; if (!this._husE || this._husE.P !== P) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, P, P); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); this._husE = { t, P }; }
    gl.bindTexture(gl.TEXTURE_2D, this._husE.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, P, P, gl.RG, gl.FLOAT, f instanceof Float32Array ? f : Float32Array.from(f)); gl.bindTexture(gl.TEXTURE_2D, null); }
  husimiRender({ ox = 0, oy = 0, P = 16, e0 = 0, e1 = 1, sw2 = 1, ref = 0 } = {}) { const gl = this._gl, G = this._G, S = this._husS; if (!S || !this._husE) return false; const NP = G / S.st;
    if (!this._husV || this._husV.NP !== NP) { const ul = (q, ns) => Object.fromEntries(ns.map((n) => [n, gl.getUniformLocation(q, 'u_' + n)])), pf = this._husV?.pf || this._compileStep(GLSL_HUS_FIT), pr = this._husV?.pr || this._compileStep(GLSL_HUS_RENDER); this._husV = { NP, pf, pr, uf: ul(pf, ['h', 'eps', 'P', 'e0', 'e1', 'sw2']), ur: ul(pr, ['fit', 'NP', 'P', 'off', 'ref', 'G']), fit: this._rgbaTex(NP, NP), rd: null, stats: null }; }
    const V = this._husV;
    this._drawTo(V.pf, V.fit.f, NP, NP, [S[S.cur].t, this._husE.t], () => { gl.uniform1i(V.uf.h, 0); gl.uniform1i(V.uf.eps, 1); gl.uniform1i(V.uf.P, P); gl.uniform1f(V.uf.e0, e0); gl.uniform1f(V.uf.e1, e1); gl.uniform1f(V.uf.sw2, sw2); });
    this._drawTo(V.pr, null, G, G, [V.fit.t], () => { gl.uniform1i(V.ur.fit, 0); gl.uniform1i(V.ur.NP, NP); gl.uniform1i(V.ur.P, S.st); gl.uniform2f(V.ur.off, ox, oy); gl.uniform1f(V.ur.ref, ref); gl.uniform1i(V.ur.G, G); }, true);
    if (V.rd) { let ok = false; try { ok = gl.getSyncParameter(V.rd.fence, gl.SYNC_STATUS) === gl.SIGNALED; } catch (e) { ok = true; } if (ok) { const f = new Float32Array(V.rd.n); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, V.rd.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(V.rd.pbo); gl.deleteSync(V.rd.fence); V.rd = null; V.stats = f; } }
    if (!V.rd && (!V.at || performance.now() - V.at > 700)) { V.at = performance.now(); V.rd = this._readSmall(V.fit.f, NP, NP); }
    return V.stats; }
  //   ⚛ THE STIRRER (2026-11-09, inert — the app's ⚛ ⑧): applyEyeStir(phi, cx, cy, w) on the SELECTED eye: ψ ← ψ·e^{−i·phi·exp(−d²/w²)}, d the torus distance to
  //   (cx, cy) — a repulsive Gaussian obstacle for one sub-step (phi = V·dt); the app moves (cx, cy) on a circle per sub-step, by the beat.
  applyEyeStir(phi, cx, cy, w) { const gl = this._gl; if (!this._stirP) { this._stirP = this._compileStep(GLSL_STIR); this._stirU = Object.fromEntries(['x', 'G', 'c', 'w', 'phi'].map((n) => [n, gl.getUniformLocation(this._stirP, 'u_' + n)])); } const U = this._stirU;
    this._eyePass(this._stirP, [], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.G, this._G); gl.uniform2f(U.c, cx, cy); gl.uniform1f(U.w, w); gl.uniform1f(U.phi, phi); }); }
  //   applyEyeLz(a, cx, cy) — ψ ← ψ + a·L_z ψ, L_z = −i(X∂_Y − Y∂_X) about (cx, cy) (central differences, wrapped): one Euler step of the ROTATING-FRAME
  //   term in an imaginary-time (damping) step — e^{a·L_z} to first order, a = γd·dt·Ω small (inert unless called); R > 0: only within r < R (tapered over 6 cells)
  applyEyeLz(a, cx, cy, R = 0) { if (!a) return; const gl = this._gl; if (!this._lzP) { this._lzP = this._compileStep(GLSL_LZ); this._lzU = Object.fromEntries(['x', 'G', 'c', 'a', 'R'].map((n) => [n, gl.getUniformLocation(this._lzP, 'u_' + n)])); } const U = this._lzU;
    this._eyePass(this._lzP, [], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.G, this._G); gl.uniform2f(U.c, cx, cy); gl.uniform1f(U.a, a); gl.uniform1f(U.R, +R || 0); }); }
  //   applyEyeEos(lut, L, Imax, s, amp) — a declared EQUATION OF STATE f(I), I = |ψ|², tabulated (L entries over [0, Imax], packed row-major in a G×G R32F
  //   texture from makePhaseTex; linear between entries, clamped past Imax): ψ ← ψ·e^{i·s·f(I)} (the unitary step), or with amp ψ ← ψ·e^{s·f(I)} (a damping
  //   step in imaginary time) — inert unless called
  applyEyeEos(lut, L, Imax, s, amp = false) { if (!lut || !s || !(L > 1) || !(Imax > 0)) return; const gl = this._gl; if (!this._eosP) { this._eosP = this._compileStep(GLSL_EOS); this._eosU = Object.fromEntries(['x', 'lut', 'G', 'L', 'Imax', 's', 'amp'].map((n) => [n, gl.getUniformLocation(this._eosP, 'u_' + n)])); } const U = this._eosU;
    this._eyePass(this._eosP, [lut], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.lut, 1); gl.uniform1i(U.G, this._G); gl.uniform1i(U.L, L | 0); gl.uniform1f(U.Imax, Imax); gl.uniform1f(U.s, s); gl.uniform1i(U.amp, amp ? 1 : 0); }); }
  //   ⚛F DENSE PROJECTIONS OVER THE LATTICE (2026-11-09 — the live BdG's M_c²·P products, measured 3.2 s of 15 on the CPU at 30 a spin; inert unless called):
  //   linPhi(f32, M, P) — the orbitals Φ (M rows × P sites) as an R32F texture (re-uploaded on call); linProjStart(v, Mc, P) — D_ab = Σ_p Φ_ap Φ_bp v_p (Mc × Mc);
  //   linBackStart(K1, K2, Mc, P) — (Σ_ab Φ_ap K1_ab Φ_bp, Σ_ab Φ_ap K2_ab Φ_bp) at every site p (two passes: W = K·Φ, then the column sums); each read fenced:
  //   linReady(h), linFinish(h) → Float32Array (RG pairs). Returns null when P exceeds the texture limit (the caller stays on the CPU)
  _linT(w, h, fmt) { const gl = this._gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  _linRT(key, w, h) { const L = (this._lin = this._lin || {}), o = L[key]; if (o && o.w === w && o.h === h) return o; const gl = this._gl; if (o) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); } const t = this._linT(w, h, gl.RG32F), f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return (L[key] = { t, f, w, h }); }
  _linIn(key, f32, w, h, fmt, ch) { const gl = this._gl, L = (this._lin = this._lin || {}); let o = L[key]; if (!o || o.w !== w || o.h !== h) { if (o) gl.deleteTexture(o.t); o = L[key] = { t: this._linT(w, h, fmt), w, h }; } gl.bindTexture(gl.TEXTURE_2D, o.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, ch, gl.FLOAT, f32); gl.bindTexture(gl.TEXTURE_2D, null); return o; }
  _linProg(key, src, names) { const L = (this._lin = this._lin || {}); if (!L["p" + key]) { const gl = this._gl, q = this._compileStep(src); L["p" + key] = { q, u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(q, 'u_' + n)])) }; } return L["p" + key]; }
  _linRun(pr, rt, texs, uni) { const gl = this._gl; gl.bindFramebuffer(gl.FRAMEBUFFER, rt.f); gl.viewport(0, 0, rt.w, rt.h); gl.useProgram(pr.q); uni(pr.u); texs.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); }); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this._G, this._G); }
  _linRead(rt) { const gl = this._gl, n = rt.w * rt.h * 2, pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ); gl.bindFramebuffer(gl.FRAMEBUFFER, rt.f); gl.readPixels(0, 0, rt.w, rt.h, gl.RG, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n }; }
  linOk(P) { const gl = this._gl; return P > 0 && P <= gl.getParameter(gl.MAX_TEXTURE_SIZE); }
  linPhi(f32, M, P) { if (!this.linOk(P)) return false; const gl = this._gl, rt = this._linRT("phi", P, M), d = new Float32Array(2 * M * P); for (let i = 0; i < M * P; i++) d[2 * i] = f32[i]; gl.bindTexture(gl.TEXTURE_2D, rt.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, P, M, gl.RG, gl.FLOAT, d); gl.bindTexture(gl.TEXTURE_2D, null); return true; }
  //   THE RELAXATION ON THE GPU too (2026-11-10; MEASURED at 30 a spin: its CPU Gram + rotation 1.0 s of 15, ~20 MB read back a sweep): the disc's sites (linSites: their
  //   grid cells, and the grid's site index); linScatter(k) — orbitals 2k, 2k+1 of Φ into the SELECTED eye (re, im), zero off the disc; linGather(key, k) — the eye's
  //   (re, im) back into rows 2k, 2k+1 of the matrix texture `key` (P × M); linGramStart(M, P) — (Σ G1_a G1_b, Σ G1_a G2_b) read back (M × M); linRotate(C, M, P) —
  //   Φ ← Cᵀ·G1 written INTO Φ on the GPU, read back fenced (the CPU's copy). Inert unless called
  linSites(pid, P) { const gl = this._gl, G = this._G, L = (this._lin = this._lin || {}), key = P + "|" + pid[0] + "|" + pid[P - 1]; if (L.sitesKey === key) return; const pt = new Float32Array(2 * P), iv = new Float32Array(G * G).fill(-1);
    for (let p = 0; p < P; p++) { pt[2 * p] = pid[p] % G; pt[2 * p + 1] = Math.floor(pid[p] / G); iv[pid[p]] = p; } this._linIn("pidT", pt, P, 1, gl.RG32F, gl.RG); this._linIn("invT", iv, G, G, gl.R32F, gl.RED); L.sitesKey = key; }
  linScatter(k, M) { const gl = this._gl, L = this._lin, pr = this._linProg("scat", GLSL_LIN_SCAT, ['phi', 'inv', 'k2', 'M']); this._eyePass(pr.q, [L.phi.t, L.invT.t], () => { gl.uniform1i(pr.u.phi, 1); gl.uniform1i(pr.u.inv, 2); gl.uniform1i(pr.u.k2, 2 * k); gl.uniform1i(pr.u.M, M); }); }
  linGather(key, k, M, P) { const gl = this._gl, L = this._lin, rt = this._linRT(key, P, M), pr = this._linProg("gath", GLSL_LIN_GATH, ['e', 'pid', 'k2']), rows = Math.min(2, M - 2 * k), e = this._eyeSrc === 'A' ? this._eyeA : this._eyeB; if (rows <= 0) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.f); gl.viewport(0, 2 * k, P, rows); gl.useProgram(pr.q); gl.uniform1i(pr.u.e, 0); gl.uniform1i(pr.u.pid, 1); gl.uniform1i(pr.u.k2, 2 * k); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, e); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.pidT.t);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this._G, this._G); }
  linGramStart(M, P) { const gl = this._gl, L = this._lin, rt = this._linRT("gram", M, M), pr = this._linProg("gram", GLSL_LIN_GRAM, ['a', 'b', 'P']); this._linRun(pr, rt, [L.G1.t, L.G2.t], (u) => { gl.uniform1i(u.a, 0); gl.uniform1i(u.b, 1); gl.uniform1i(u.P, P); }); return this._linRead(rt); }
  linRotateStart(C, M, P) { const gl = this._gl, L = this._lin, ct = this._linIn("C", C instanceof Float32Array ? C : Float32Array.from(C), M, M, gl.R32F, gl.RED), rt = this._linRT("phi", P, M), pr = this._linProg("rot", GLSL_LIN_ROT, ['c', 'g', 'M']);
    this._linRun(pr, rt, [ct.t, L.G1.t], (u) => { gl.uniform1i(u.c, 0); gl.uniform1i(u.g, 1); gl.uniform1i(u.M, M); }); return this._linRead(rt); }
  linProjStart(v, Mc, P) { const gl = this._gl, L = this._lin; if (!L?.phi) return null; const vt = this._linIn("v", v, P, 1, gl.R32F, gl.RED), rt = this._linRT("D", Mc, Mc), pr = this._linProg("proj", GLSL_LIN_PROJ, ['phi', 'v', 'P']);
    this._linRun(pr, rt, [L.phi.t, vt.t], (u) => { gl.uniform1i(u.phi, 0); gl.uniform1i(u.v, 1); gl.uniform1i(u.P, P); }); return this._linRead(rt); }
  linBackStart(K1, K2, Mc, P) { const gl = this._gl, L = this._lin; if (!L?.phi) return null; const kk = new Float32Array(2 * Mc * Mc); for (let i = 0; i < Mc * Mc; i++) { kk[2 * i] = K1[i]; kk[2 * i + 1] = K2[i]; } const kt = this._linIn("K", kk, Mc, Mc, gl.RG32F, gl.RG);
    const W = this._linRT("W", P, Mc), out = this._linRT("nk", P, 1), pw = this._linProg("w", GLSL_LIN_W, ['phi', 'k', 'Mc']), pd = this._linProg("d", GLSL_LIN_DIAG, ['phi', 'w', 'Mc']);
    this._linRun(pw, W, [L.phi.t, kt.t], (u) => { gl.uniform1i(u.phi, 0); gl.uniform1i(u.k, 1); gl.uniform1i(u.Mc, Mc); });
    this._linRun(pd, out, [L.phi.t, W.t], (u) => { gl.uniform1i(u.phi, 0); gl.uniform1i(u.w, 1); gl.uniform1i(u.Mc, Mc); }); return this._linRead(out); }
  linReady(h) { const gl = this._gl; try { return gl.getSyncParameter(h.fence, gl.SYNC_STATUS) === gl.SIGNALED; } catch (e) { return true; } }
  linFinish(h) { const gl = this._gl, f = new Float32Array(h.n); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(h.pbo); gl.deleteSync(h.fence); return f; }
  //   ⚛F RUNG 2's LOCAL TERM (2026-11-10, inert unless called): makeLutTex(f32, w, h) — an R32F w × h table; applyEyeLut2(lut, idx, nr, nd, phiMax, s) — ψ ← ψ·e^{s·w(i(x), |ψ|)},
  //   w bilinear in (i — the cell's row index from the G×G R32F `idx`, |ψ| over [0, φmax] across nd columns), the exponent clamped to ±30
  makeLutTex(f32, w, h) { const gl = this._gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, f32); gl.bindTexture(gl.TEXTURE_2D, null); return t; }
  applyEyeLut2(lut, idx, nr, nd, phiMax, s) { if (!lut || !idx || !s) return; const gl = this._gl; if (!this._l2P) { this._l2P = this._compileStep(GLSL_LUT2); this._l2U = Object.fromEntries(['x', 'l', 'i', 'nr', 'nd', 'pm', 's'].map((n) => [n, gl.getUniformLocation(this._l2P, 'u_' + n)])); } const U = this._l2U;
    this._eyePass(this._l2P, [lut, idx], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.l, 1); gl.uniform1i(U.i, 2); gl.uniform1i(U.nr, nr | 0); gl.uniform1i(U.nd, nd | 0); gl.uniform1f(U.pm, +phiMax || 1); gl.uniform1f(U.s, +s || 0); }); }
  becGpuTex() { const S = this._becGS; return S ? { k: S.K[S.K.cur].t, w: S.W[S.W.cur].t } : null; }   // (the k average and W)   // (the k average and W — for a view to render from)
  viewGate({ r2 = 0, bs = null, bsr2 = 0, hp = null, kcm = 0, kc2 = 0 } = {}) { const gl = this._gl, P = this._viewProgs(), U = P.ug, b = new Float32Array(16); const nb = bs ? Math.min(8, bs.length) : 0; for (let k = 0; k < nb; k++) { b[2 * k] = +bs[k][0]; b[2 * k + 1] = +bs[k][1]; }
    this._eyePass(P.g, [], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.G, this._G); gl.uniform1f(U.r2, +r2 || 0); gl.uniform1i(U.nb, nb); gl.uniform2fv(U.bs, b); gl.uniform1f(U.bsr2, +bsr2 || 0); gl.uniform3f(U.hp, hp ? +hp[0] : 0, hp ? +hp[1] : 0, hp ? 1 : 0); gl.uniform1i(U.kcm, kcm | 0); gl.uniform1f(U.kc2, +kc2 || 0); }); }
  //   viewTheta(w, r) — the θ key's two phase screens (G² Float32: the writer's, the reader's) for holoViewPass(…, th = true); viewMedGather(b2x, b2y, r2) on the active eye IN k
  viewTheta(w, r) { const gl = this._gl, G = this._G; if (!this._vwTh) this._vwTh = [0, 1].map(() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, G, G, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; });
    [w, r].forEach((a, k) => { gl.bindTexture(gl.TEXTURE_2D, this._vwTh[k]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RED, gl.FLOAT, a instanceof Float32Array ? a : Float32Array.from(a)); }); gl.bindTexture(gl.TEXTURE_2D, null); }
  viewMedGather(b2x, b2y, r2) { const gl = this._gl, P = this._viewProgs(); if (!P.m) { P.m = this._compileStep(GLSL_MED_GATHER); P.um = Object.fromEntries(['x', 'G', 'b2', 'r2'].map((n) => [n, gl.getUniformLocation(P.m, 'u_' + n)])); } const U = P.um;
    this._eyePass(P.m, [], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.G, this._G); gl.uniform2i(U.b2, b2x | 0, b2y | 0); gl.uniform1f(U.r2, +r2 || 0); }); }
  //   ◐ THE EYE's CHAIN on the GPU (2026-10-18): eye-lens's per-cell kinds as generic passes on the active eye — viewTable(obj, re, im) an RG32F
  //   table per host array (a WeakMap on its identity: the app's tables are memoised), viewMul (applySpace: phase quantize qL, amplitude mix,
  //   × the table, + |ψ|·noise), viewRelabel (applyRelabelX: conjugate, the analyser θ); the gate above takes the spectral cut too
  viewTable(obj, re, im) { const gl = this._gl, G = this._G, N = G * G; if (!this._vwTab) this._vwTab = new WeakMap(); let t = this._vwTab.get(obj); if (t) return t;
    const f = new Float32Array(2 * N); for (let c = 0; c < N; c++) { f[2 * c] = +re[c] || 0; f[2 * c + 1] = im ? (+im[c] || 0) : 0; }
    t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, G, G, 0, gl.RG, gl.FLOAT, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null); this._vwTab.set(obj, t); return t; }
  viewMul({ m = null, mi = null, n1 = null, n2 = null, qL = 0, amix = 0 } = {}) { const gl = this._gl, P = this._viewProgs(); if (!P.mu) { P.mu = this._compileStep(GLSL_VIEW_MUL); P.umu = Object.fromEntries(['x', 'm', 'n', 'hasM', 'hasN', 'qL', 'amix'].map((n) => [n, gl.getUniformLocation(P.mu, 'u_' + n)])); } const U = P.umu;
    const tm = m ? this.viewTable(m, m, mi) : null, tn = n1 ? this.viewTable(n1, n1, n2) : null;
    this._eyePass(P.mu, [tm || this._opSclA, tn || this._opSclA], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.m, 1); gl.uniform1i(U.n, 2); gl.uniform1i(U.hasM, tm ? 1 : 0); gl.uniform1i(U.hasN, tn ? 1 : 0); gl.uniform1f(U.qL, +qL || 0); gl.uniform1f(U.amix, +amix || 0); }); }
  viewRelabel(cj, pol) { const gl = this._gl, P = this._viewProgs(); if (!P.rl) { P.rl = this._compileStep(GLSL_VIEW_RELABEL); P.url = Object.fromEntries(['x', 'cj', 'pol', 'c2', 's2'].map((n) => [n, gl.getUniformLocation(P.rl, 'u_' + n)])); } const U = P.url;
    this._eyePass(P.rl, [], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.cj, cj ? 1 : 0); gl.uniform1i(U.pol, pol ? 1 : 0); gl.uniform1f(U.c2, Math.cos(2 * (+pol || 0))); gl.uniform1f(U.s2, Math.sin(2 * (+pol || 0))); }); }
  //   ℍ PAIR COMPOSITE (the app's _paintQuat): |q|² of two eye slots into the active eye (its film's peak = the normaliser), then drawn: brightness
  //   min(1, 1.4·√(|q|²/(peak·gain)))^0.8, colour the Hopf direction n = (2Re a·b̄, 2Im a·b̄, |a|² − |b|²)/|q|² as (0.15 + 0.85·(1 + n)/2)
  quatRender(idA, idB, gain = 1) { const gl = this._gl, G = this._G, P = this._viewProgs(), sa = this._slotEye[idA], sb = this._slotEye[idB]; if (!sa || !sb) return false;
    if (!P.qm) { P.qm = this._compileStep(GLSL_QUAT_M2); P.uqm = Object.fromEntries(['a', 'b'].map((n) => [n, gl.getUniformLocation(P.qm, 'u_' + n)])); P.qr = this._compileStep(GLSL_QUAT_RENDER); P.uqr = Object.fromEntries(['a', 'b', 'pk', 'gain'].map((n) => [n, gl.getUniformLocation(P.qr, 'u_' + n)])); }
    const ta = sa.src === 'A' ? sa.A : sa.B, tb = sb.src === 'A' ? sb.A : sb.B; if (!this.viewCopy(idA, 'hvq')) return false; this.selectEyeSlot('hvq');
    this._eyePass(P.qm, [ta, tb], () => { gl.uniform1i(P.uqm.a, 1); gl.uniform1i(P.uqm.b, 2); }); this.commitEyeSlot('hvq'); this.filmCapture('hvq'); this.selectEyeSlot(null);
    const f = this._film.hvq; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, G, G); gl.useProgram(P.qr);
    [ta, tb, f.pyr[f.pyr.length - 1].tex].forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); });
    gl.uniform1i(P.uqr.a, 0); gl.uniform1i(P.uqr.b, 1); gl.uniform1i(P.uqr.pk, 2); gl.uniform1f(P.uqr.gain, +gain || 1);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); return true; }
  //   viewLin(idA, idB, ca, cb, dstId) — dst = ca·A + cb·B (two eye slots; real weights): an ANALYSER on an ℍ pair (a Jones vector) — the app's
  //   polarization view E = cos α·a + sin α·b
  //   viewDotStart(idA, idB) — the dot of two eye slots (see GLSL_VDOT_ROWS), its one texel read without a stall: poll readEyePsiReady(h),
  //   then specReadFinish(h) → [Re Σ a·b̄, Im Σ a·b̄, Σ|a|², Σ|b|²]
  viewDotStart(idA, idB) { const gl = this._gl, G = this._G, sa = this._slotEye[idA], sb = this._slotEye[idB]; if (!sa || !sb) return null; const P = this._viewProgs();
    if (!P.dr) { P.dr = this._compileStep(GLSL_VDOT_ROWS); P.dc = this._compileStep(GLSL_VDOT_COL); P.udr = Object.fromEntries(['a', 'b', 'G'].map((n) => [n, gl.getUniformLocation(P.dr, 'u_' + n)])); P.udc = Object.fromEntries(['r', 'G'].map((n) => [n, gl.getUniformLocation(P.dc, 'u_' + n)]));
      const mk = (w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f }; };
      P.drT = mk(1, G); P.dcT = mk(1, 1); }
    const draw = (prog, fbo, w, h, binds, uni) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prog); uni(); binds.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); }); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); };
    draw(P.dr, P.drT.f, 1, G, [sa.src === 'A' ? sa.A : sa.B, sb.src === 'A' ? sb.A : sb.B], () => { gl.uniform1i(P.udr.a, 0); gl.uniform1i(P.udr.b, 1); gl.uniform1i(P.udr.G, G); });
    draw(P.dc, P.dcT.f, 1, 1, [P.drT.t], () => { gl.uniform1i(P.udc.r, 0); gl.uniform1i(P.udc.G, G); });
    const pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n: 4 }; }
  //   viewBinsStart(id, kx, ky, nb, ns) — the eye slot's spectral power per synth section (see GLSL_VBIN_ROWS), read without a stall: poll
  //   readEyePsiReady(h), then specReadFinish(h) → RGBA per bin (the power in .x, every 4th value)
  viewBinsStart(id, kx, ky, nb, ns) { const gl = this._gl, G = this._G, s0 = this._slotEye[id]; if (!s0) return null; const P = this._viewProgs(), NB = nb * ns;
    if (!P.br) { P.br = this._compileStep(GLSL_VBIN_ROWS); P.bc = this._compileStep(GLSL_VBIN_COL); P.ubr = Object.fromEntries(['x', 'G', 'nb', 'ns', 'k'].map((n) => [n, gl.getUniformLocation(P.br, 'u_' + n)])); P.ubc = Object.fromEntries(['r', 'G'].map((n) => [n, gl.getUniformLocation(P.bc, 'u_' + n)])); }
    if (!this._vbScr) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); this._vbScr = { A: a, fA: fa, B: b, fB: fb, src: 'A' }; }
    const mk = (w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f }; };
    if (!this._vbT || this._vbT.NB !== NB) this._vbT = { r: mk(NB, G), c: mk(NB, 1), NB };
    const S = this._vbScr; S.src = 'A';
    if (this._fftDirectOK()) this._fftFrom(s0.src === 'A' ? s0.A : s0.B, S);   // (no copy: the FFT reads the slot — see _fftFrom)
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, S.fA); gl.viewport(0, 0, G, G); gl.useProgram(this._progFilmCopy); gl.uniform1i(gl.getUniformLocation(this._progFilmCopy, 'u_src'), 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s0.src === 'A' ? s0.A : s0.B); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._fft2dS(S, false); }
    const spec = S.src === 'A' ? S.A : S.B;
    const draw = (prog, fbo, w, h, tex, uni) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prog); uni(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); };
    draw(P.br, this._vbT.r.f, NB, G, spec, () => { gl.uniform1i(P.ubr.x, 0); gl.uniform1i(P.ubr.G, G); gl.uniform1i(P.ubr.nb, nb); gl.uniform1i(P.ubr.ns, ns); gl.uniform2f(P.ubr.k, +kx || 0, +ky || 0); });
    draw(P.bc, this._vbT.c.f, NB, 1, this._vbT.r.t, () => { gl.uniform1i(P.ubc.r, 0); gl.uniform1i(P.ubc.G, G); });
    const pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, NB * 16, gl.STREAM_READ); gl.readPixels(0, 0, NB, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n: 4 * NB }; }
  //   canvasReadStart() — the canvas's just-rendered picture (the default framebuffer, RGBA8) copied into a PBO behind a fence: the app's synth
  //   reads its LOOK from it without a stall (a 2D canvas getImageData of a GPU-drawn picture forces a GPU → CPU sync); canvasReadFinish(h) → bytes
  canvasReadStart() { const gl = this._gl, G = this._G, pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, G * G * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, G, G, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n: G * G * 4 }; }
  canvasReadFinish(h) { const gl = this._gl, o = new Uint8Array(h.n); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, o); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); this.readEyePsiDrop(h); return o; }
  //   viewAffine(op) — soliton-algebra's lensU1.apply on the active eye, cell for cell: the inverse affine map about the centre (G−1)/2 (minus the
  //   shift), bilinear, ZERO outside the plate (no torus wrap — as lensU1), then × gain·e^{i(φ + prec + k·ξ)}
  viewAffine(op) { const gl = this._gl, P = this._viewProgs(), A = op.A || [1, 0, 0, 1], d = A[0] * A[3] - A[1] * A[2]; if (!d) return false; const Ai = [A[3] / d, -A[1] / d, -A[2] / d, A[0] / d];
    const mA = A[0] !== 1 || A[1] !== 0 || A[2] !== 0 || A[3] !== 1 || !!(op.tx || op.ty);
    if (!P.af) { P.af = this._compileStep(GLSL_VIEW_AFFINE); P.uaf = Object.fromEntries(['x', 'G', 'mA', 'Ai', 't', 'ph', 'k', 'gn'].map((n) => [n, gl.getUniformLocation(P.af, 'u_' + n)])); } const U = P.uaf;
    this._eyePass(P.af, [], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.G, this._G); gl.uniform1i(U.mA, mA ? 1 : 0); gl.uniform4f(U.Ai, Ai[0], Ai[1], Ai[2], Ai[3]); gl.uniform2f(U.t, +op.tx || 0, +op.ty || 0);
      gl.uniform1f(U.ph, (+op.phase || 0) + (+op.prec || 0)); gl.uniform2f(U.k, +op.kx || 0, +op.ky || 0); gl.uniform1f(U.gn, op.gain ?? 1); }); return true; }
  //   viewBox(W, ct) — eye-lens applyBox on the active eye (the W×W box centred on the grid, the ideal drift e^{−i·ct·k²} on its sine modes)
  viewBox(W, ct) { const gl = this._gl, G = this._G, P = this._viewProgs(); W = Math.max(2, Math.min(G, W | 0)); const a = Math.floor((G - W) / 2);
    if (!P.bx) { P.bx = this._compileStep(GLSL_VIEW_BOX); P.ubx = Object.fromEntries(['x', 'S', 'P', 'W', 'a', 'axis', 'mode'].map((n) => [n, gl.getUniformLocation(P.bx, 'u_' + n)])); P.bxS = new Map(); }
    let St = P.bxS.get(W); if (!St) { const c = Math.sqrt(2 / (W + 1)), f = new Float32Array(W * W); for (let n = 0; n < W; n++) for (let u = 0; u < W; u++) f[n * W + u] = c * Math.sin(Math.PI * (n + 1) * (u + 1) / (W + 1));
      St = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, St); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, W, 0, gl.RED, gl.FLOAT, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); if (P.bxS.size > 4) P.bxS.clear(); P.bxS.set(W, St); }
    const ph = new Float32Array(2 * W); for (let n = 0; n < W; n++) { const k = Math.PI * (n + 1) / (W + 1), th = -ct * k * k, r = th - 2 * Math.PI * Math.round(th / (2 * Math.PI)); ph[2 * n] = Math.cos(r); ph[2 * n + 1] = Math.sin(r); }
    if (!P.bxP) { P.bxP = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, P.bxP); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); }
    gl.bindTexture(gl.TEXTURE_2D, P.bxP); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, W, 1, 0, gl.RG, gl.FLOAT, ph); gl.bindTexture(gl.TEXTURE_2D, null);
    for (const [axis, mode] of [[0, 0], [0, 1], [1, 0], [1, 1]]) this._eyePass(P.bx, [St, P.bxP], () => { gl.uniform1i(P.ubx.x, 0); gl.uniform1i(P.ubx.S, 1); gl.uniform1i(P.ubx.P, 2); gl.uniform1i(P.ubx.W, W); gl.uniform1i(P.ubx.a, a); gl.uniform1i(P.ubx.axis, axis); gl.uniform1i(P.ubx.mode, mode); });
    return true; }
  //   viewCorr(ref) / viewCorrBank(refs) — eye-lens correlate / correlateBank on the active eye (ref = refSupport's { dx, dy, wr, wi, box, mr, mi })
  _vcProgs() { const gl = this._gl, P = this._viewProgs(); if (P.cr) return P; const ul = (p, n) => gl.getUniformLocation(p, n);
    P.bs = this._compileStep(GLSL_VIEW_BOXSUM); P.cr = this._compileStep(GLSL_VIEW_CORR); P.ba = this._compileStep(GLSL_VIEW_BANKACC); P.sq = this._compileStep(GLSL_VIEW_SQRT);
    P.ubs = Object.fromEntries(['x', 'G', 'axis', 'lo', 'hi'].map((n) => [n, ul(P.bs, 'u_' + n)])); P.ucr = Object.fromEntries(['x', 'tp', 'bx', 'G', 'K', 'hasBox', 'mu'].map((n) => [n, ul(P.cr, 'u_' + n)]));
    P.uba = Object.fromEntries(['acc', 'c', 'e0', 'er', 'first'].map((n) => [n, ul(P.ba, 'u_' + n)])); P.usq = Object.fromEntries(['x', 'a'].map((n) => [n, ul(P.sq, 'u_' + n)]));
    if (!this._vcT) { this._vcT = {}; for (const k of ['in', 'c', 'b1', 'b2', 'a0', 'a1']) { const [t, f] = this._makePsiTex(); this._vcT[k] = { t, f }; } this._vcTap = new WeakMap(); } return P; }
  _vcTaps(ref) { const gl = this._gl; let t = this._vcTap.get(ref); if (t) return t; const K = ref.wr.length, f = new Float32Array(4 * Math.max(1, K)); for (let j = 0; j < K; j++) { f[4 * j] = ref.dx[j]; f[4 * j + 1] = ref.dy[j]; f[4 * j + 2] = ref.wr[j]; f[4 * j + 3] = ref.wi[j]; }
    t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, Math.max(1, K), 1, 0, gl.RGBA, gl.FLOAT, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.bindTexture(gl.TEXTURE_2D, null); this._vcTap.set(ref, t); return t; }
  _vcCorrInto(srcTex, ref, fbo, eyeOut) { const gl = this._gl, G = this._G, P = this._vcProgs(), T = this._vcT, box = ref.box;
    if (box) { this._nlPass(P.bs, T.b1.f, [srcTex], () => { gl.uniform1i(P.ubs.x, 0); gl.uniform1i(P.ubs.G, G); gl.uniform1i(P.ubs.axis, 0); gl.uniform1i(P.ubs.lo, box.x0); gl.uniform1i(P.ubs.hi, box.x1); });
      this._nlPass(P.bs, T.b2.f, [T.b1.t], () => { gl.uniform1i(P.ubs.x, 0); gl.uniform1i(P.ubs.G, G); gl.uniform1i(P.ubs.axis, 1); gl.uniform1i(P.ubs.lo, box.y0); gl.uniform1i(P.ubs.hi, box.y1); }); }
    const uni = () => { gl.uniform1i(P.ucr.x, 0); gl.uniform1i(P.ucr.tp, 1); gl.uniform1i(P.ucr.bx, 2); gl.uniform1i(P.ucr.G, G); gl.uniform1i(P.ucr.K, ref.wr.length); gl.uniform1i(P.ucr.hasBox, box ? 1 : 0); gl.uniform2f(P.ucr.mu, box ? +ref.mr : 0, box ? +ref.mi : 0); };
    if (eyeOut) this._eyePass(P.cr, [this._vcTaps(ref), T.b2.t], uni); else this._nlPass(P.cr, fbo, [srcTex, this._vcTaps(ref), T.b2.t], uni); }
  viewCorr(ref) { if (!ref || !ref.wr || !ref.wr.length) return false; this._vcProgs(); this._vcCorrInto(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, ref, null, true); return true; }
  _viewEnergy(tex, slot) { const gl = this._gl, G = this._G, ur = this._u.energyRows; this.opCycleInit(); gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G); gl.useProgram(this._progEnergyRows); gl.uniform1i(ur.a, 0); gl.uniform1i(ur.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); this._opColFinish(slot); return slot === 'A' ? this._opSclA : this._opSclB; }
  viewCorrBank(refs) { if (!refs || !refs.length) return false; const gl = this._gl, P = this._vcProgs(), T = this._vcT, P0 = this._viewProgs();
    this._nlPass(P0.c, T.in.f, [this._eyeSrc === 'A' ? this._eyeA : this._eyeB], () => gl.uniform1i(P0.uc, 0));   // the input, kept
    const e0 = this._viewEnergy(T.in.t, 'A'); let acc = 0;
    refs.forEach((ref, r) => { this._vcCorrInto(T.in.t, ref, T.c.f, false); const er = this._viewEnergy(T.c.t, 'B'), dst = acc ? T.a0 : T.a1, src = acc ? T.a1 : T.a0;
      this._nlPass(P.ba, dst.f, [src.t, T.c.t, e0, er], () => { gl.uniform1i(P.uba.acc, 0); gl.uniform1i(P.uba.c, 1); gl.uniform1i(P.uba.e0, 2); gl.uniform1i(P.uba.er, 3); gl.uniform1i(P.uba.first, r === 0 ? 1 : 0); }); acc = 1 - acc; });
    const fin = acc ? T.a1 : T.a0; this._eyePass(P.sq, [fin.t], () => { gl.uniform1i(P.usq.x, 0); gl.uniform1i(P.usq.a, 1); }); return true; }
  //   viewCavityRaw(key) (optional, 2026-11-04) — the fold's kept state D under `key` (as the last round trip left it, not renormalised) into the
  //   active eye; false if that fold has not run. Inert unless called.
  viewCavityRaw(key) { const S = this._cvSt && this._cvSt.get(key); if (!S || !S.primed) return false; const gl = this._gl, P = this._viewProgs(), fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._nlPass(P.c, fbo, [S.t], () => gl.uniform1i(P.uc, 0)); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; return true; }
  //   viewCavity(key, groups, kk, pu, trav) — on the active eye (its field f): one round trip of the fold kept under `key` (D starts at f);
  //   groups [{ A, t: [[tx, ty]…], sg, taps }] (the maps grouped by linear part, whole-cell shifts; taps = eye-lens naTaps for a cut copy), pu the
  //   pupil table (or null), trav { lam, t } (the round trip's travel through that operator, forward). The eye then holds D at f's energy.
  //   natCopy (optional, 2026-10-19): (srcTex, group) → a texture holding that group's copy made by NATIVE optics (the caller's lens elements —
  //   a rotator's shears, a telescope — run on a scratch eye slot), in place of the affine resample; such a copy carries its own band, so no
  //   aperture taps, and the energy it lets through is what the element keeps (like a cut copy: never re-amplified)
  //   planKey (optional, 2026-11-04): a cavPlanSet plan (the app's native element — optics chains, the exact pull) makes the copy w = W(D) instead
  //   of the groups' rolls: cavW on the pupil-limited D, kept as is (the element renormalises nothing); the fold then as before
  //   frame (optional, 2026-11-04) { pre, post } — the frame as OPTICS around the fixed element: w = F(W(F⁻¹·D)) (the app's native chains), so a turn
  //   or zoom of the lens moves no plan — a few passes a frame (was: a new element per angle — the fern's lens drag lagged)
  viewCavity(key, groups, kk, pu, trav, natCopy = null, planKey = null, frame = null) { const gl = this._gl, G = this._G, P = this._viewProgs(), ul = (p, n) => gl.getUniformLocation(p, n);
    if (!P.cv) { P.cv = this._compileStep(GLSL_VIEW_CONV); P.ro = this._compileStep(GLSL_VIEW_ROLLS); P.es = this._compileStep(GLSL_VIEW_ESCALE); P.sm = this._compileStep(GLSL_SCAL_MAD);
      P.ucv = Object.fromEntries(['x', 'h', 'G', 'M', 'axis'].map((n) => [n, ul(P.cv, 'u_' + n)])); P.uro = Object.fromEntries(['o', 'acc', 'G', 'n', 'first', 't'].map((n) => [n, ul(P.ro, 'u_' + n)]));
      P.ues = Object.fromEntries(['x', 'n', 'd'].map((n) => [n, ul(P.es, 'u_' + n)])); P.usm = Object.fromEntries(['acc', 'e', 'w', 'first'].map((n) => [n, ul(P.sm, 'u_' + n)]));
      if (!P.mu) this.viewMul({}); }   // (compiles the multiply pass)
    if (!this._cvT) { this._cvT = {}; for (const k of ['f', 'cur', 'src', 'tmp', 'o', 'oA', 'oB']) { const [t, f] = this._makePsiTex(); this._cvT[k] = { t, f }; }
      const mk1 = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f }; };
      this._cvT.s0 = mk1(); this._cvT.s1 = mk1(); this._cvT.eA = mk1(); this._cvSt = new Map(); this._cvTap = new WeakMap(); }
    const T = this._cvT, copy = (src, fbo) => this._nlPass(P.c, fbo, [src], () => gl.uniform1i(P.uc, 0));
    const tapTex = (h) => { let t = this._cvTap.get(h); if (t) return t; const f = Float32Array.from(h); t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, f.length, 1, 0, gl.RED, gl.FLOAT, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.bindTexture(gl.TEXTURE_2D, null); this._cvTap.set(h, t); return t; };
    copy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, T.f.f);   // f, kept
    let S = this._cvSt.get(key); if (!S) { const [t, f] = this._makePsiTex(); S = { t, f, primed: false }; if (this._cvSt.size > 16) { const k0 = this._cvSt.keys().next().value, o = this._cvSt.get(k0); gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); this._cvSt.delete(k0); } this._cvSt.set(key, S); }
    const prev = S.primed ? S.t : T.f.t;
    if (pu) { const tm = this.viewTable(pu, pu, null); this._nlPass(P.mu, T.cur.f, [prev, tm, tm], () => { gl.uniform1i(P.umu.x, 0); gl.uniform1i(P.umu.m, 1); gl.uniform1i(P.umu.n, 2); gl.uniform1i(P.umu.hasM, 1); gl.uniform1i(P.umu.hasN, 0); gl.uniform1f(P.umu.qL, 0); gl.uniform1f(P.umu.amix, 0); }); }
    else copy(prev, T.cur.f);
    const e0 = this._viewEnergy(T.cur.t, 'A'); copy(e0, T.eA.f);   // (e0 kept: slots A / B are reused below)
    const VS = this._vcStat || (this._vcStat = { plan: 0, framed: 0, groups: 0 }); let srcP = T.cur.t; if (planKey && frame && frame.pre && this.natChainTex(T.cur.t, frame.pre, [T.tmp.t, T.tmp.f])) { srcP = T.tmp.t; VS.framed++; }   // (VS: which fold path ran — a diagnostic, ahc.hvPath)   // F⁻¹ (the frame's inverse optics) — (the scratch is { t, f }: the chain's dst is a [tex, fbo] pair — 2026-11-04 a turned / zoomed frame drew into nothing: the cavity vanished)
    if (planKey && this._cvPl && this._cvPl.has(planKey) && this.cavW('eyecv', srcP, planKey, 1, 0, 1, 0)) { let Wt = this._cvS.get('eyecv').term[0]; VS.plan++; if (frame && frame.post && this.natChainTex(Wt, frame.post, [T.src.t, T.src.f])) Wt = T.src.t; const e1 = this._viewEnergy(Wt, 'B');   // ⟲ the native element's copy (note above), then F
      this._eyePass(P.es, [Wt, e1, e1], () => { gl.uniform1i(P.ues.x, 1); gl.uniform1i(P.ues.n, 2); gl.uniform1i(P.ues.d, 3); });
      if (trav && (trav.t | 0) > 0) this.stepEyeJumpLam(trav.lam, trav.t | 0, +trav.dt);
      if (!P.ln) this.viewLin && (P.ln = this._compileStep(GLSL_VIEW_LIN), P.uln = Object.fromEntries(['x', 'b', 'ca', 'cb'].map((n) => [n, ul(P.ln, 'u_' + n)])));
      this._eyePass(P.ln, [T.f.t], () => { gl.uniform1i(P.uln.x, 0); gl.uniform1i(P.uln.b, 1); gl.uniform1f(P.uln.ca, kk); gl.uniform1f(P.uln.cb, 1); });   // D = f + κ·w
      copy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, S.f); S.primed = true; const ef = this._viewEnergy(T.f.t, 'A'), eD = this._viewEnergy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, 'B');
      this._eyePass(P.es, [ef, eD], () => { gl.uniform1i(P.ues.x, 0); gl.uniform1i(P.ues.n, 1); gl.uniform1i(P.ues.d, 2); }); return true; }
    VS.groups++; let nS = 0, cut = false; for (const g of groups) { nS += g.t.length; if ((pu && g.sg < 1) || (natCopy && g.nat)) cut = true; }
    let out = 0, sAcc = 0, firstS = true;
    groups.forEach((g, gi) => { let src = T.cur.t;
      const nat = !!(natCopy && g.nat), oN = nat ? natCopy(T.cur.t, g) : null;   // (a native copy: made first — its energy is what this group keeps)
      if (!nat && pu && g.sg < 1 && g.taps) { const h = tapTex(g.taps), M = (g.taps.length - 1) >> 1;
        this._nlPass(P.cv, T.tmp.f, [T.cur.t, h], () => { gl.uniform1i(P.ucv.x, 0); gl.uniform1i(P.ucv.h, 1); gl.uniform1i(P.ucv.G, G); gl.uniform1i(P.ucv.M, M); gl.uniform1i(P.ucv.axis, 0); });
        this._nlPass(P.cv, T.src.f, [T.tmp.t, h], () => { gl.uniform1i(P.ucv.x, 0); gl.uniform1i(P.ucv.h, 1); gl.uniform1i(P.ucv.G, G); gl.uniform1i(P.ucv.M, M); gl.uniform1i(P.ucv.axis, 1); }); src = T.src.t; }
      if (cut) { const es = nat ? this._viewEnergy(oN, 'B') : src === T.cur.t ? T.eA.t : this._viewEnergy(src, 'B'), dst = sAcc ? T.s0 : T.s1, from = sAcc ? T.s1 : T.s0;
        this._nlPass(P.sm, dst.f, [from.t, es], () => { gl.uniform1i(P.usm.acc, 0); gl.uniform1i(P.usm.e, 1); gl.uniform1f(P.usm.w, g.t.length / nS); gl.uniform1i(P.usm.first, firstS ? 1 : 0); }); sAcc = 1 - sAcc; firstS = false; }
      const A = g.A, id = A[0] === 1 && !A[1] && !A[2] && A[3] === 1; let o = nat ? oN : T.cur.t;
      if (!id && !nat) { const d = A[0] * A[3] - A[1] * A[2], Ai = [A[3] / d, -A[1] / d, -A[2] / d, A[0] / d]; if (!P.af) this.viewAffine({ A: [1, 0, 0, 1] });
        this._nlPass(P.af, T.o.f, [src], () => { const U = P.uaf; gl.uniform1i(U.x, 0); gl.uniform1i(U.G, G); gl.uniform1i(U.mA, 1); gl.uniform4f(U.Ai, Ai[0], Ai[1], Ai[2], Ai[3]); gl.uniform2f(U.t, 0, 0); gl.uniform1f(U.ph, 0); gl.uniform2f(U.k, 0, 0); gl.uniform1f(U.gn, 1); }); o = T.o.t; }
      for (let b = 0; b < g.t.length; b += 16) { const part = g.t.slice(b, b + 16), tv = new Int32Array(32); part.forEach(([tx, ty], j) => { tv[2 * j] = ((tx % G) + G) % G; tv[2 * j + 1] = ((ty % G) + G) % G; });
        const dst = out ? T.oA : T.oB, from = out ? T.oB : T.oA, first = gi === 0 && b === 0;
        this._nlPass(P.ro, dst.f, [o, from.t], () => { gl.uniform1i(P.uro.o, 0); gl.uniform1i(P.uro.acc, 1); gl.uniform1i(P.uro.G, G); gl.uniform1i(P.uro.n, part.length); gl.uniform1i(P.uro.first, first ? 1 : 0); gl.uniform2iv(P.uro.t, tv); }); out = 1 - out; } });
    const W = out ? T.oB : T.oA, e1 = this._viewEnergy(W.t, 'B'), tgt = cut ? (sAcc ? T.s1 : T.s0) : T.eA;
    this._eyePass(P.es, [W.t, tgt.t, e1], () => { gl.uniform1i(P.ues.x, 1); gl.uniform1i(P.ues.n, 2); gl.uniform1i(P.ues.d, 3); });   // the eye ← w = W(D) at the kept energy
    if (trav && (trav.t | 0) > 0) this.stepEyeJumpLam(trav.lam, trav.t | 0, +trav.dt);   // (forward: the caller's step)
    if (!P.ln) this.viewLin && (P.ln = this._compileStep(GLSL_VIEW_LIN), P.uln = Object.fromEntries(['x', 'b', 'ca', 'cb'].map((n) => [n, ul(P.ln, 'u_' + n)])));
    this._eyePass(P.ln, [T.f.t], () => { gl.uniform1i(P.uln.x, 0); gl.uniform1i(P.uln.b, 1); gl.uniform1f(P.uln.ca, kk); gl.uniform1f(P.uln.cb, 1); });   // D = f + κ·w
    copy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, S.f); S.primed = true;   // the fold's state
    const ef = this._viewEnergy(T.f.t, 'A'), eD = this._viewEnergy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, 'B');
    this._eyePass(P.es, [ef, eD], () => { gl.uniform1i(P.ues.x, 0); gl.uniform1i(P.ues.n, 1); gl.uniform1i(P.ues.d, 2); }); return true; }
  //   viewEnergyKeep() — the active eye's energy kept in a 1×1 texel (for viewPerceive); viewPerceive({ R0, Rp, Aq, ph, attId, nat }) — the hologram pass (nat: nothing subtracted)
  viewEnergyKeep() { const gl = this._gl, P = this._viewProgs(); if (!this._pcE) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); this._pcE = { t, f }; }
    const e = this._viewEnergy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, 'A'); this._nlPass(P.c, this._pcE.f, [e], () => gl.uniform1i(P.uc, 0)); return true; }
  viewPerceive({ R0, Rp, RpTex = null, Aq = 2, ph = 0, attId = null, nat = false } = {}) { const gl = this._gl, P = this._viewProgs(); if (!this._pcE) return false;   // (RpTex: the shaped reference already a texture, RG = re, im — e.g. built on the GPU)
    if (!P.pc) { P.pc = this._compileStep(GLSL_PERCEIVE); P.upc = Object.fromEntries(['x', 'e', 'r0', 'rp', 'att', 'pk', 'G', 'hasAtt', 'Aq', 'ph', 'nat'].map((n) => [n, gl.getUniformLocation(P.pc, 'u_' + n)])); } const U = P.upc;
    const r0 = this.viewTable(R0.re, R0.re, R0.im), rp = RpTex || this.viewTable(Rp.re, Rp.re, Rp.im), sa = attId != null ? this._slotEye[attId] : null, fa = attId != null && this._film ? this._film[attId] : null, hasAtt = !!(sa && fa && fa.pyr);
    const at = hasAtt ? (sa.src === 'A' ? sa.A : sa.B) : r0, pk = hasAtt ? fa.pyr[fa.pyr.length - 1].tex : this._pcE.t;
    this._eyePass(P.pc, [this._pcE.t, r0, rp, at, pk], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.e, 1); gl.uniform1i(U.r0, 2); gl.uniform1i(U.rp, 3); gl.uniform1i(U.att, 4); gl.uniform1i(U.pk, 5); gl.uniform1i(U.G, this._G); gl.uniform1i(U.hasAtt, hasAtt ? 1 : 0); gl.uniform1f(U.Aq, +Aq || 2); gl.uniform1f(U.ph, +ph || 0); gl.uniform1i(U.nat, nat ? 1 : 0); }); return true; }
  //   THE TIME FILTER (2026-10-21, the ◉ chain's lenses in TIME: dichroic, Fabry–Pérot, Mach–Zehnder) — per cell, on the ACTIVE eye's
  //   texture, one call per medium sub-step: y_t = a·x_t + b·x_{t−n} + c·y_{t−n} (a, b, c complex). Two rings of n + 1 textures (x and y)
  //   under `key`; textures start zeroed, so the history before the start is dark. tfOut(key) = the latest y; tfDrop(key) frees it.
  //   (2026-10-22) n up to 256, and only the history a filter reads is kept: the x ring when b ≠ 0, the y ring (n + 1) when c ≠ 0 — else one
  //   y texture (the output); a ring not read is bound as a stand-in (never the target). The arithmetic is unchanged.
  tfStep(key, n, a, b, c) { const gl = this._gl; n = Math.max(1, Math.min(256, n | 0)); this._tf = this._tf || {}; let F = this._tf[key];
    const nx = (b[0] || b[1]) ? n + 1 : 1, ny = (c[0] || c[1]) ? n + 1 : 2;
    if (F && (F.n !== n || F.nx !== nx || F.ny !== ny)) { this.tfDrop(key); F = null; }
    if (!F) { F = this._tf[key] = { n, nx, ny, X: [], Y: [], t: 0, last: -1 }; for (let k = 0; k < nx; k++) F.X.push(this._makePsiTex()); for (let k = 0; k < ny; k++) F.Y.push(this._makePsiTex()); }
    if (!this._tfP) { const p = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_x, u_xn, u_yn; uniform vec2 u_a, u_b, u_c; out vec4 o;
vec2 cm(vec2 p, vec2 q) { return vec2(p.x * q.x - p.y * q.y, p.x * q.y + p.y * q.x); }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); o = vec4(cm(u_a, texelFetch(u_x, q, 0).xy) + cm(u_b, texelFetch(u_xn, q, 0).xy) + cm(u_c, texelFetch(u_yn, q, 0).xy), 0.0, 1.0); }`), cp = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_x; out vec4 o; void main() { o = vec4(texelFetch(u_x, ivec2(gl_FragCoord.xy), 0).xy, 0.0, 1.0); }`), ul = (pr, nm) => gl.getUniformLocation(pr, nm);
      this._tfP = { p, cp, u: { x: ul(p, 'u_x'), xn: ul(p, 'u_xn'), yn: ul(p, 'u_yn'), a: ul(p, 'u_a'), b: ul(p, 'u_b'), c: ul(p, 'u_c'), cx: ul(cp, 'u_x') } }; }
    const P = this._tfP, U = P.u, x = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, kx = F.t % F.nx, knx = (kx + 1) % F.nx, ky = F.t % F.ny, kny = (ky + 1) % F.ny;   // slot k ← t, slot kn holds t − n
    const xn = F.nx > 1 ? F.X[knx][0] : x, yn = F.ny === n + 1 ? F.Y[kny][0] : x;   // (a ring not read: the input as a stand-in — its coefficient is 0)
    this._nlPass(P.p, F.Y[ky][1], [x, xn, yn], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.xn, 1); gl.uniform1i(U.yn, 2); gl.uniform2f(U.a, a[0], a[1]); gl.uniform2f(U.b, b[0], b[1]); gl.uniform2f(U.c, c[0], c[1]); });
    if (F.nx > 1) this._nlPass(P.cp, F.X[kx][1], [x], () => gl.uniform1i(U.cx, 0));
    F.last = ky; F.t++; return true; }
  tfOut(key) { const F = this._tf && this._tf[key]; return F && F.last >= 0 ? F.Y[F.last][0] : null; }
  tfDrop(key) { const gl = this._gl, F = this._tf && this._tf[key]; if (!F) return; for (const [t, f] of [...F.X, ...F.Y]) { gl.deleteTexture(t); gl.deleteFramebuffer(f); } delete this._tf[key]; }
  //   eyeSlotTex(id) — the slot's current texture (read-only use) · viewLoadTex(dstId, tex) — copy a texture into a slot and leave it selected
  eyeSlotTex(id) { const s = this._slotEye[id]; return s ? (s.src === 'A' ? s.A : s.B) : null; }
  viewLoadTex(dstId, tex) { const gl = this._gl, P = this._viewProgs(); this.selectEyeSlot(dstId); const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._nlPass(P.c, fbo, [tex], () => gl.uniform1i(P.uc, 0)); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; this.commitEyeSlot(dstId); return true; }
  //   viewShear(axis, s) — eye-lens applyShear on the active eye: each line moved by s·(l − c) through its band-limited shift kernel (the inverse
  //   DFT of e^{−2πiq·d/G}, a G-tap circular convolution per line, kernels per line in one G×G texture, memoised per s)
  //   viewQuatAbs(idA, idB, dstId) (optional, 2026-11-05) — an ℍ pair's TOTAL amplitude (√(|a|² + |b|²), 0) into dstId: what an eye without a
  //   polarizer sees (Stokes S0 = |a|² + |b|²). specCombine(dst, idA, idB) (optional) — the INCOHERENT sum of two ids' ◈ accumulators (orthogonal
  //   components: their powers add, no cross term): the line correlation / energy, the ⧗ band powers, the FT spectrometer's (X, Y, Z, P) and the
  //   coherence sums added; the bank's complex amplitudes combined as √(|a|² + |b|²) (its colour reads only |·|²). dst is a composed id (render
  //   only — never accumulated into). Both inert unless called.
  _qcP() { if (this._qcPr) return this._qcPr; const gl = this._gl, ul = (p, n) => gl.getUniformLocation(p, n), hd = `#version 300 es
precision highp float;
uniform sampler2D u_a, u_b; out vec4 o; void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec4 a = texelFetch(u_a, q, 0), b = texelFetch(u_b, q, 0); `;
    const abs = this._compileStep(hd + `o = vec4(sqrt(dot(a.xy, a.xy) + dot(b.xy, b.xy)), 0.0, 0.0, 1.0); }`), add = this._compileStep(hd + `o = a + b; }`), mag = this._compileStep(hd + `o = vec4(sqrt(dot(a.xy, a.xy) + dot(b.xy, b.xy)), 0.0, sqrt(dot(a.zw, a.zw) + dot(b.zw, b.zw)), 0.0); }`);
    return (this._qcPr = { abs, add, mag, u: (p) => [ul(p, 'u_a'), ul(p, 'u_b')] }); }
  viewQuatAbs(idA, idB, dstId) { const sa = this._slotEye[idA], sb = this._slotEye[idB]; if (!sa || !sb) return false; const gl = this._gl, P = this._qcP(), [ua, ub] = P.u(P.abs);
    this.selectEyeSlot(dstId); const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA; this._nlPass(P.abs, fbo, [sa.src === 'A' ? sa.A : sa.B, sb.src === 'A' ? sb.A : sb.B], () => { gl.uniform1i(ua, 0); gl.uniform1i(ub, 1); });
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; this.commitEyeSlot(dstId); this.selectEyeSlot(null); return true; }
  specCombine(dst, idA, idB) { const A = this._spec && this._spec[idA], B = this._spec && this._spec[idB]; if (!A || !B || !A.primed || !B.primed) return false; const gl = this._gl, P = this._qcP();
    const D = this._spec[dst] || (this._spec[dst] = { primed: true, src: 'A', composed: true }), tex = (slot, k) => { const key = slot + k; if (!D['_' + key]) D['_' + key] = this._specTex4(); return D['_' + key]; };
    const pass = (prog, ta, tb, out) => { const [ua, ub] = P.u(prog); this._nlPass(prog, out[1], [ta, tb], () => { gl.uniform1i(ua, 0); gl.uniform1i(ub, 1); }); return out[0]; };
    { const t = pass(P.add, A.src === 'A' ? A.A : A.B, B.src === 'A' ? B.A : B.B, tex('ln', 0)); D.A = D.B = t; D.src = 'A'; }
    const two = (name, prog) => { const a = A[name], b = B[name]; if (!a || !b) { D[name] = null; return; } const ta = a.T[a.src], tb = b.T[b.src], arr = Array.isArray(ta) ? ta : [ta], brr = Array.isArray(tb) ? tb : [tb], outT = arr.map((t, k) => pass(prog, t, brr[k], tex(name, k))); D[name] = { T: [Array.isArray(ta) ? outT : outT[0], Array.isArray(ta) ? outT : outT[0]], src: 0 }; };
    two('bank2', P.mag); two('bankP', P.add); two('ftsA', P.add); two('ftsC', P.add); D.bank = D.bank2 ? D.bank2 : null; return true; }
  //   _shH(s, axis) / _shearFftS(F, axis, s) (optional, 2026-11-05) — THE SHEAR IN THE DUAL OF ITS AXIS: each line's Dirichlet kernel (_shK) is a
  //   convolution, so its DFT is diagonal — e^{−2πi·k̃·s(l − c)/G}, k̃ the signed bin (−G/2 < k̃ ≤ G/2), built in f64 (the 1-D inverse's scale folded
  //   in: the Stockham inverse scales only after axis 1, by 1/G²); then axis FFT · table · axis IFFT — the same operator (MEASURED vs the dense
  //   pass), ~2·log₃₂G passes of ≤ 32 reads instead of one of G reads per texel. Inert unless this._shearFft (and the Stockham driver).
  _shH(s, axis) { const gl = this._gl, G = this._G; this._shHM = this._shHM || new Map(); const key = s.toFixed(12) + "|" + axis; let T = this._shHM.get(key); if (T) return T;
    const c = (G - 1) / 2, H = G >> 1, sc = axis === 1 ? G : 1 / G, f = new Float32Array(2 * G * G);
    for (let l = 0; l < G; l++) { const d = s * (l - c); for (let k = 0; k < G; k++) { const kk = k <= H ? k : k - G, t = kk * d / G, a = -2 * Math.PI * (t - Math.round(t)), o = axis === 0 ? l * G + k : k * G + l; f[2 * o] = sc * Math.cos(a); f[2 * o + 1] = sc * Math.sin(a); } }
    T = this._makeRGF32Tex(); gl.bindTexture(gl.TEXTURE_2D, T); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null);
    if (this._shHM.size > 64) { for (const t of this._shHM.values()) gl.deleteTexture(t); this._shHM.clear(); } this._shHM.set(key, T); return T; }
  _shearFftS(F, axis, s) { const gl = this._gl, P = this._cvProgs(), T = this._shH(s, axis), ax = (inv) => { this._stkAxes = [axis]; try { this._fft2dStockham(F, inv); } finally { this._stkAxes = null; } };
    ax(false); this._nlPass(P.mul.p, F.src === 'A' ? F.fB : F.fA, [F.src === 'A' ? F.A : F.B, T], () => { gl.uniform1i(P.mul.u.x, 0); gl.uniform1i(P.mul.u.t, 1); }); F.src = F.src === 'A' ? 'B' : 'A'; ax(true); }
  viewShear(axis, s) { const gl = this._gl, G = this._G, P = this._viewProgs(); s = +s || 0; if (!s) return true;
    if (this._shearFft && this._fftStockham) { const self = this; this._shearFftS({ get A() { return self._eyeA; }, get fA() { return self._fboEyeA; }, get B() { return self._eyeB; }, get fB() { return self._fboEyeB; }, get src() { return self._eyeSrc; }, set src(v) { self._eyeSrc = v; } }, axis | 0, s); return true; }
    const K = this._shK(s);
    this._eyePass(P.sh, [K], () => { gl.uniform1i(P.ush.x, 0); gl.uniform1i(P.ush.K, 1); gl.uniform1i(P.ush.G, G); gl.uniform1i(P.ush.axis, axis | 0); }); return true; }
  //   _shK(s) — the shear's per-line band-limited shift kernels (memoised per s; viewShear's, and the native cavity's — cavW)
  _shK(s) { const gl = this._gl, G = this._G, P = this._viewProgs();
    if (!P.sh) { P.sh = this._compileStep(GLSL_VIEW_SHEAR); P.ush = Object.fromEntries(['x', 'K', 'G', 'axis'].map((n) => [n, gl.getUniformLocation(P.sh, 'u_' + n)])); P.shK = new Map(); }
    const key = s.toFixed(12); let K = P.shK.get(key);
    if (!K) { const c = (G - 1) / 2, H = G >> 1, f = new Float32Array(2 * G * G);
      for (let l = 0; l < G; l++) { const d = s * (l - c); for (let n = 0; n < G; n++) { const al = 2 * Math.PI * (n - d) / G, sh = Math.sin(al / 2), D = Math.abs(sh) < 1e-12 ? G * Math.cos(G * al / 2) / Math.cos(al / 2) : Math.sin(G * al / 2) / sh; f[2 * (l * G + n)] = Math.cos(al / 2) * D / G; f[2 * (l * G + n) + 1] = Math.sin(al / 2) * D / G; } }   // (the Dirichlet kernel in CLOSED form, Σ_{k=−G/2+1}^{G/2} e^{iαk} = e^{iα/2}·sin(Gα/2)/sin(α/2): O(G²) per kernel, was the O(G³) sum — a turn dragged rebuilt dozens: the freeze)
      K = this._makeRGF32Tex(); gl.bindTexture(gl.TEXTURE_2D, K); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); if (P.shK.size > 64) { for (const t of P.shK.values()) gl.deleteTexture(t); P.shK.clear(); } P.shK.set(key, K); }
    return K; }
  viewLin(idA, idB, ca, cb, dstId) { const gl = this._gl, P = this._viewProgs(), sb = this._slotEye[idB]; if (!sb || !this.viewCopy(idA, dstId)) return false;
    if (!P.ln) { P.ln = this._compileStep(GLSL_VIEW_LIN); P.uln = Object.fromEntries(['x', 'b', 'ca', 'cb'].map((n) => [n, gl.getUniformLocation(P.ln, 'u_' + n)])); }
    this.selectEyeSlot(dstId); this._eyePass(P.ln, [sb.src === 'A' ? sb.A : sb.B], () => { gl.uniform1i(P.uln.x, 0); gl.uniform1i(P.uln.b, 1); gl.uniform1f(P.uln.ca, +ca || 0); gl.uniform1f(P.uln.cb, +cb || 0); }); this.commitEyeSlot(dstId); this.selectEyeSlot(null); return true; }
  holoViewPass(mode, Aq, mx, my, ang0, z1, z2, th = false, hm = null) { const gl = this._gl, G = this._G, P = this._viewProgs(), U = P.uh; this.opCycleInit(); const thOn = !!(th && this._vwTh), hmT = hm ? this.viewTable(hm, hm, null) : null; const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, ur = this._u.energyRows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G); gl.useProgram(this._progEnergyRows); gl.uniform1i(ur.a, 0); gl.uniform1i(ur.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); this._opColFinish('A');   // E = Σ|P|² → _opSclA
    this._eyePass(P.h, [this._opSclA, thOn ? this._vwTh[0] : this._opSclA, thOn ? this._vwTh[1] : this._opSclA, hmT || this._opSclA], () => { gl.uniform1i(U.x, 0); gl.uniform1i(U.e, 1); gl.uniform1i(U.th, thOn ? 1 : 0); gl.uniform1i(U.tw, 2); gl.uniform1i(U.tr, 3); gl.uniform1i(U.hm, 4); gl.uniform1i(U.hasHm, hmT ? 1 : 0); gl.uniform1i(U.G, G); gl.uniform1i(U.mode, mode | 0); gl.uniform1f(U.Aq, +Aq || 0); gl.uniform1f(U.mx, +mx || 0); gl.uniform1f(U.my, +my || 0); gl.uniform1f(U.ang0, +ang0 || 0); gl.uniform1f(U.z1, z1 ? 1 : 0); gl.uniform1f(U.z2, z2 ? 1 : 0); }); }
  specUpload(id, f32) { const gl = this._gl, G = this._G, s = this._specSlot(id); gl.bindTexture(gl.TEXTURE_2D, s.src === 'A' ? s.A : s.B); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RGBA, gl.FLOAT, f32); gl.bindTexture(gl.TEXTURE_2D, null); }
  specRead(id) { const gl = this._gl, G = this._G, s = this._spec && this._spec[id]; if (!s) return null; const o = new Float32Array(G * G * 4);   // (tests / ahc.spectrum: a sync read)
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.src === 'A' ? s.fA : s.fB); gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, o); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return o; }
  //   specReadStart(id) / specReadFinish(h) — the accumulator read WITHOUT a stall (PBO + fence, as xsReadStart): the app's ◈ purity readout polls it
  specReadStart(id) { const gl = this._gl, G = this._G, s = this._spec && this._spec[id]; if (!s) return null; const n = G * G * 4, pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ); gl.bindFramebuffer(gl.FRAMEBUFFER, s.src === 'A' ? s.fA : s.fB);
    gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n }; }
  specReadFinish(h) { const gl = this._gl, o = new Float32Array(h.n); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, o); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); this.readEyePsiDrop(h); return o; }
  specDrop(id) { const gl = this._gl, s = this._spec && this._spec[id]; if (!s) return; for (const t of [s.A, s.B, s.P]) gl.deleteTexture(t); for (const f of [s.fA, s.fB, s.fP]) gl.deleteFramebuffer(f);
    for (const bb of [s.bank, s.bank2]) if (bb) { for (const T of bb.T) for (const t of T) gl.deleteTexture(t); for (const f of bb.F) gl.deleteFramebuffer(f); } delete this._spec[id]; }

  // ── Public: N free leapfrog steps on the eye ping-pong (no injection) ────────
  // Used by the plate-free round-trip eye: stepEyeN(T, +dt) then stepEyeN(T, -dt).
  //   stepEyeN(n, dt) — n linear leapfrog steps. A LONG run (n ≥ IFSGpu.jumpMin) is ONE spectral pass (stepEyeJump: M^n by binary powering —
  //   MEASURED equal to the stepwise loop to the f32 floor, rel 6e-7 … 2e-6, energy equal; T 120: 81 → 2.6 ms, T 300: 194 → 2.6 ms), unless an
  //   eye SCISSOR (the two-browser shard region) restricts the step to a rectangle — the spectral pass cannot. IFSGpu.jumpMin = Infinity: off.
  stepEyeN(n, dt) {
    if (n >= IFSGpu.jumpMin && !this._eyeScissor && !this._ringNh && this._ringOffs && this._progFftBlock && this._u.fftBlock.T) { this.stepEyeJump(n, dt); return; }
    this._stepEyeLoop(n, dt);
  }
  _stepEyeLoop(n, dt) { for (let i = 0; i < n; i++) this.stepEye(dt); }

  // ── Public: peak |ψ|² of the current eye texture (for self-normalization) ────
  // Small synchronous readback — call only when the eye is recomputed, never per
  // frame. Returns the max intensity so the display normalizes to its own field.
  readEyePeakSq() {
    const gl = this._gl, G = this._G;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeA : this._fboEyeB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const f32 = new Float32Array(G * G * 2);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let mx = 0;
    for (let j = 0; j < G * G; j++) {
      const m = f32[j*2]*f32[j*2] + f32[j*2+1]*f32[j*2+1];
      if (m > mx) mx = m;
    }
    return mx;
  }

  // ── Public: download the current eye psi → Float64Array(2*G*G) (sync) ────────
  // For the eye-as-observer pipeline: capture ψ_perceived to re-seed the soliton
  // relaxation. Synchronous — call only on recompute, never per frame.
  readEyePsi() {
    const gl = this._gl, G = this._G;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeA : this._fboEyeB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const f32 = new Float32Array(G * G * 2);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Float64Array(G * G * 2);
    for (let i = 0; i < G * G * 2; i++) out[i] = f32[i];
    return out;
  }

  // ── ASYNC eye readback (2026-09-26) — readEyePsi without the pipeline stall. A synchronous readPixels waits for EVERY
  //   queued GPU command (and, with two tabs on one GPU, for the other tab's work too): measured on a leader during a join
  //   + damage drag, readPixels was 90% of main-thread time at a constant ~20 reads/s. Start copies the CURRENT eye texture
  //   into a pixel-pack buffer — command order guarantees the copy sees exactly this state, whatever is stepped after it —
  //   and fences it. Ready polls the fence (no wait; WebGL updates it between tasks). Finish returns the Float64Array(2·G²);
  //   called before Ready it blocks like readEyePsi, so a caller with a deadline can always force it. Drop discards.
  readEyePsiStart() {
    const gl = this._gl, G = this._G, n = G * G * 2;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeA : this._fboEyeB;
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return { pbo, fence, n };
  }
  readEyePsiReady(h) { const gl = this._gl; return gl.getSyncParameter(h.fence, gl.SYNC_STATUS) === gl.SIGNALED; }
  readEyePsiFinish(h) {
    const gl = this._gl, f32 = new Float32Array(h.n);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f32);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.readEyePsiDrop(h);
    const out = new Float64Array(h.n);
    for (let i = 0; i < h.n; i++) out[i] = f32[i];
    return out;
  }
  readEyePsiDrop(h) { const gl = this._gl; if (h.fence) { gl.deleteSync(h.fence); h.fence = null; } if (h.pbo) { gl.deleteBuffer(h.pbo); h.pbo = null; } }

  // ── TILE PROBE (2026-09-24, ahc's live lane) — reduce the CURRENT eye texture to a T×T tile grid ON THE GPU, into block
  //   `col` of a small RGBA32F atlas (T·cols × T). Per tile: R = mean |ψ|², G = mean Re ψ, B = mean Im ψ, A = mean |∇ψ|²
  //   (periodic forward differences — the local wavenumber² × energy, a per-tile spectrometer with no FFT). Many probes (one per
  //   sub-step, every slot) land in the atlas and ONE readProbeAtlas() collects them: readback is T²·4 floats per probe instead
  //   of the whole field. READ-ONLY on the eye: it samples the current parity and restores every piece of GL state it touches
  //   (program, framebuffer, viewport, unit-0 texture), so it cannot perturb the stepping passes around it.
  //   pose (optional) — sample the field IN THE DISPLAY'S FRAME: ψ_view(x) = B(x − off)·e^{i(φ + k·(x − c))}, the same register pose
  //   renderDescField applies (the A-model keeps the k-tilt glide and phase out of the stepped texture). Omit it for the raw texture.
  probeTiles(T, col, cols = 64, pose = null) {
    const gl = this._gl, G = this._G, B = (G / T) | 0;
    if (!this._progTileProbe) { this._progTileProbe = this._compileStep(GLSL_TILE_PROBE);
      const pr = this._progTileProbe; this._uTileProbe = { psi: gl.getUniformLocation(pr, 'u_psi'), G: gl.getUniformLocation(pr, 'u_G'), B: gl.getUniformLocation(pr, 'u_B'), off: gl.getUniformLocation(pr, 'u_off'),
        shift: gl.getUniformLocation(pr, 'u_shift'), k: gl.getUniformLocation(pr, 'u_k'), center: gl.getUniformLocation(pr, 'u_center'), phi: gl.getUniformLocation(pr, 'u_phi') }; }
    if (!this._probeAtlas || this._probeAtlas.T !== T || this._probeAtlas.cols !== cols) {
      if (this._probeAtlas) { gl.deleteTexture(this._probeAtlas.tex); gl.deleteFramebuffer(this._probeAtlas.fbo); }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, T * cols, T);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this._probeAtlas = { tex, fbo, T, cols }; }
    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM), prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), prevVp = gl.getParameter(gl.VIEWPORT);
    const prevAct = gl.getParameter(gl.ACTIVE_TEXTURE); gl.activeTexture(gl.TEXTURE0); const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, pr = this._progTileProbe, u = this._uTileProbe;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._probeAtlas.fbo);
    gl.viewport(col * T, 0, T, T);
    gl.useProgram(pr);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.G, G); gl.uniform1i(u.B, B); gl.uniform2i(u.off, col * T, 0);
    gl.uniform2f(u.shift, pose ? +pose.ox || 0 : 0, pose ? +pose.oy || 0 : 0); gl.uniform2f(u.k, pose ? +pose.kx || 0 : 0, pose ? +pose.ky || 0 : 0);
    gl.uniform2f(u.center, pose ? (pose.cx ?? G / 2) : G / 2, pose ? (pose.cy ?? G / 2) : G / 2); gl.uniform1f(u.phi, pose ? +pose.phi || 0 : 0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0); gl.activeTexture(prevAct);
    gl.useProgram(prevProg); gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb); gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
  }
  // ── FILM RING + USER SHADERS (2026-09-24, ahc's "medium as the source"). A per-key ring of RG32F frames holding the field
  //   at successive sub-steps (GPU copy of the CURRENT eye, or a CPU upload), and a user fragment shader that reads two
  //   frames and their blend. The field stays on the GPU: a user shader sees every pixel of the raw complex field.
  //   Every call restores the GL state it touches (program, framebuffer, viewport, texture units 0/1).
  _saveGL() { const gl = this._gl, st = { prog: gl.getParameter(gl.CURRENT_PROGRAM), fb: gl.getParameter(gl.FRAMEBUFFER_BINDING), vp: gl.getParameter(gl.VIEWPORT), act: gl.getParameter(gl.ACTIVE_TEXTURE) };
    gl.activeTexture(gl.TEXTURE0); st.t0 = gl.getParameter(gl.TEXTURE_BINDING_2D); gl.activeTexture(gl.TEXTURE1); st.t1 = gl.getParameter(gl.TEXTURE_BINDING_2D); return st; }
  _restoreGL(st) { const gl = this._gl; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, st.t1); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.t0);
    gl.activeTexture(st.act); gl.useProgram(st.prog); gl.bindFramebuffer(gl.FRAMEBUFFER, st.fb); gl.viewport(st.vp[0], st.vp[1], st.vp[2], st.vp[3]); }
  _ring(key, R) { if (!this._rings) this._rings = {}; let r = this._rings[key];
    if (!r || r.R !== R) { if (r) for (const f of r.f) { this._gl.deleteTexture(f[0]); this._gl.deleteFramebuffer(f[1]); }
      r = { R, f: [] }; for (let k = 0; k < R; k++) r.f.push(this._makePsiTex()); this._rings[key] = r; }
    return r; }
  filmRingPush(key, idx, R) {   // copy the CURRENTLY SELECTED eye (mid-loop parity) into ring[key][idx]
    const gl = this._gl, G = this._G, r = this._ring(key, R), st = this._saveGL(), src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.f[idx % R][1]); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progFilmCopy); gl.uniform1i(gl.getUniformLocation(this._progFilmCopy, 'u_src'), 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._restoreGL(st); }
  filmRingUpload(key, idx, R, flat) {   // CPU field (interleaved re,im) → ring[key][idx]
    const gl = this._gl, G = this._G, r = this._ring(key, R), st = this._saveGL(), f32 = flat instanceof Float32Array ? flat : Float32Array.from(flat);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.f[idx % R][0]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    this._restoreGL(st); }
  //   renderUserShader(body, key, iA, iB, mix, uniforms) — compile (cached by source) the user's `vec4 medium(vec2 uv, vec2 psi)`
  //   inside GLSL_USER_HEAD, bind frames iA/iB of the ring, set the float/vec uniforms, draw to the DEFAULT framebuffer (the
  //   offscreen canvas) at G×G. The caller copies the canvas out at once. Returns null or the compile error text.
  renderUserShader(body, key, iA, iB, mix, uniforms = {}) {
    const gl = this._gl, G = this._G; if (!this._userProgs) this._userProgs = new Map();
    let up = this._userProgs.get(body);
    if (!up) { try { const pr = this._compileStep(GLSL_USER_HEAD + body + GLSL_USER_TAIL); up = { pr, loc: new Map() }; } catch (e) { return String(e.message || e); }
      if (this._userProgs.size > 16) this._userProgs.delete(this._userProgs.keys().next().value); this._userProgs.set(body, up); }
    const r = this._rings && this._rings[key]; if (!r) return "no film";
    const st = this._saveGL(), L = (n) => { if (!up.loc.has(n)) up.loc.set(n, gl.getUniformLocation(up.pr, n)); return up.loc.get(n); };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, G, G); gl.useProgram(up.pr);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.f[iA % r.R][0]); gl.uniform1i(L('u_psiA'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, r.f[iB % r.R][0]); gl.uniform1i(L('u_psiB'), 1);
    gl.uniform1f(L('u_mix'), mix); gl.uniform1i(L('u_G'), G);
    for (const [n, v] of Object.entries(uniforms)) { const l = L(n); if (!l) continue;
      if (typeof v === 'number') gl.uniform1f(l, v); else if (v.length === 2) gl.uniform2f(l, v[0], v[1]); else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]); }
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._restoreGL(st); return null; }

  // ── BAND PROBE (2026-09-26, ahc's synth "time lens") — the CURRENT eye field's SPECTRUM reduced to nb |k| bands, per sub-step.
  //   copy eye → scratch, mixed-radix FFT (the same Stockham passes as the spectral stepper), keep the spectrum in a per-key ring of
  //   R = lag+1 frames, then two reduction passes into column `col` of an RGBA32F band atlas (nb·cols × 1):
  //     per band b:  R = E_b = Σ|ψ̂(k)|²   ·   G,B = C_b = Σ ψ̂_t(k)·conj(ψ̂_{t−lag}(k))  (the lag-`lag` correlation; = E_b when no lagged frame yet)
  //   binning is the breathing analyser's: q = the lattice wavenumber + the display tilt (kx,ky), wrapped to [−π,π)²; band ⌊|q|/π·nb⌋, |q|>π out.
  //   Pure GPU arithmetic on a bit-identical texture → bit-identical on same-GPU peers. Restores every piece of GL state it touches.
  //   `cur` is the sub-step cursor this spectrum belongs to (the ring slot is cur % R; `hasLag` = the ring still holds cur−lag).
  probeBands(key, cur, lag, nb, col, cols, kx, ky, ringOnly = false) {
    const gl = this._gl, G = this._G, R = lag + 1, st = this._saveGL();
    if (!this._progBandRow) { this._progBandRow = this._compileStep(GLSL_BAND_ROW); this._progBandCol = this._compileStep(GLSL_BAND_COL); }
    if (!this._bandScr) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); this._bandScr = { A: a, fA: fa, B: b, fB: fb, src: 'A' }; }
    if (!this._bandRows || this._bandRows.nb !== nb) { if (this._bandRows) { gl.deleteTexture(this._bandRows.tex); gl.deleteFramebuffer(this._bandRows.fbo); }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, nb, G);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this._bandRows = { tex, fbo, nb }; }
    if (!this._bandAtlas || this._bandAtlas.nb !== nb || this._bandAtlas.cols !== cols) { if (this._bandAtlas) { gl.deleteTexture(this._bandAtlas.tex); gl.deleteFramebuffer(this._bandAtlas.fbo); }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, nb * cols, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this._bandAtlas = { tex, fbo, nb, cols }; }
    const ring = this._ring('band:' + key, R); ring.cur = ring.cur || new Array(R).fill(-1);
    const copy = (srcTex, fbo) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G); gl.useProgram(this._progFilmCopy);
      gl.uniform1i(gl.getUniformLocation(this._progFilmCopy, 'u_src'), 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); };
    const S = this._bandScr; S.src = 'A';
    copy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, S.fA);
    this._fft2dS(S, false);
    const slot = ((cur % R) + R) % R, lagSlot = (((cur - lag) % R) + R) % R;
    copy(S.src === 'A' ? S.A : S.B, ring.f[slot][1]); ring.cur[slot] = cur;
    const hasLag = ring.cur[lagSlot] === cur - lag;
    if (ringOnly) { this._restoreGL(st); return hasLag; }   // a SEED: its spectrum only enters the ring (the next probe's lag), nothing is reduced
    const pr = this._progBandRow, L = (p, n) => gl.getUniformLocation(p, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._bandRows.fbo); gl.viewport(0, 0, nb, G); gl.useProgram(pr);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ring.f[slot][0]); gl.uniform1i(L(pr, 'u_cur'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ring.f[hasLag ? lagSlot : slot][0]); gl.uniform1i(L(pr, 'u_lag'), 1);
    gl.uniform1i(L(pr, 'u_G'), G); gl.uniform1i(L(pr, 'u_nb'), nb); gl.uniform2f(L(pr, 'u_k'), kx, ky);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    const pc = this._progBandCol;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._bandAtlas.fbo); gl.viewport(col * nb, 0, nb, 1); gl.useProgram(pc);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._bandRows.tex); gl.uniform1i(L(pc, 'u_rows'), 0);
    gl.uniform1i(L(pc, 'u_G'), G); gl.uniform1i(L(pc, 'u_x0'), col * nb);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._restoreGL(st);
    return hasLag;
  }
  // ── SECTOR BAND PROBE (2026-09-26) — probeBands with each |k| shell split into 4 angular SECTORS of the wavevector q = lattice k + the
  //   display tilt: sector 0 = right (−45°…45°), 1 = up, 2 = left, 3 = down. One pass over the spectrum per (band, row) as before, but it
  //   writes THREE render targets at once (energy, lag-correlation re, im — 4 sectors in RGBA each), so the cost stays one loop; the column
  //   pass sums the rows into a 3-row atlas. Same ring, same lag rule, same state hygiene as probeBands.
  //   refl = { b2x, b2y, b2xL, b2yL, r2 } (optional): a SECOND row pass reads the same spectrum MIRRORED — bin q ← conj F((2b − q) mod G)
  //   on |q|² < r2, the ◐medium analyser's image in the dual — and its energies go to atlas row 3. mirror (same shape, optional): the MAIN
  //   pass (rows 0–2: energy and lag correlation) reads mirrored too — the lag frame at its own beam bin (b2xL, b2yL)
  //   gather = { id, M, qs, b2x, b2y } (optional): the DISK GATHER — the mirrored image's M modes (qs = their lattice q, 2 per mode) read
  //   from this sub-step's spectrum, conj F((2b − q) mod G), into the gather atlas (column = col; 2 modes per RGBA texel, 128 texels a
  //   row) — the input of the native lock-in (see the app's _lockStep). Runs before ringOnly returns.
  //   eyeOp (optional) — THE EYE's H-COMPUTE ON THE SOUND (the app's stamped op): { key, data (RGBA per cell: mr, mi, n1, n2), cj, qL, amix,
  //   kcm, kc2 }. Each sub-step the field goes through it (GLSL_EYE_OP) and is transformed once more into an EYE RING beside the field's
  //   ring; the main pass (rows 0–2: energy and the lag correlation → the pitch paths Φ) and row 3 read the eye ring, the spectral cut
  //   gates the plate's modes in both. The gather (the lock-in) keeps the field's own ring. The lag needs the SAME op at the lag frame
  //   (the ring stamps each entry with the op's key) — else that sub-step has no lag, on every peer alike.
  probeBandsSec(key, cur, lag, nb, col, cols, kx, ky, ringOnly = false, refl = null, mirror = null, gather = null, eyeOp = null) {
    const gl = this._gl, G = this._G, R = lag + 1, st = this._saveGL();
    if (!this._progBandRowSec) { this._progBandRowSec = this._compileStep(GLSL_BAND_ROW_SEC); this._progBandColSec = this._compileStep(GLSL_BAND_COL_SEC); }
    if (!this._bandScr) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); this._bandScr = { A: a, fA: fa, B: b, fB: fb, src: 'A' }; }
    const mk = (w, h) => { const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return tex; };
    if (!this._bandRowsSec || this._bandRowsSec.nb !== nb) { if (this._bandRowsSec) { for (const t of this._bandRowsSec.tex) gl.deleteTexture(t); gl.deleteFramebuffer(this._bandRowsSec.fbo); }
      const tex = [mk(nb, G), mk(nb, G), mk(nb, G), mk(nb, G)], fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      for (let i = 0; i < 4; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex[i], 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);   // per-FBO state: only this FBO draws to four targets (the 4th: the shell's PLACE, see the row shader)
      this._bandRowsSec = { tex, fbo, nb }; }
    if (!this._bandAtlasSec || this._bandAtlasSec.nb !== nb || this._bandAtlasSec.cols !== cols) { if (this._bandAtlasSec) { gl.deleteTexture(this._bandAtlasSec.tex); gl.deleteFramebuffer(this._bandAtlasSec.fbo); }
      const tex = mk(nb * cols, 6), fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this._bandAtlasSec = { tex, fbo, nb, cols }; }
    const ring = this._ring('band:' + key, R); ring.cur = ring.cur || new Array(R).fill(-1);
    const copy = (srcTex, fbo) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G); gl.useProgram(this._progFilmCopy);
      gl.uniform1i(gl.getUniformLocation(this._progFilmCopy, 'u_src'), 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); };
    const S = this._bandScr; S.src = 'A';
    const slot = ((cur % R) + R) % R, lagSlot = (((cur - lag) % R) + R) % R;
    //   _probeDirect (optional, 2026-10-22): the Stockham FFT READS THE FIELD and its last pass WRITES THE RING SLOT — the two full-field copies
    //   around it (field → scratch, result → ring) were exact copies, so the same passes give the same bits without them. The getters hand
    //   the driver the field as the first source and the ring as the last target; the scratch pair carries the passes between.
    if (this._fftDirectOK()) this._fftFrom(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, S, ring.f[slot][1]);
    else { copy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, S.fA); this._fft2dS(S, false); copy(S.src === 'A' ? S.A : S.B, ring.f[slot][1]); }
    ring.cur[slot] = cur;
    if (this._mark) this._mark("probe · copy+fft");   // (optional: a profiler's marker — IFSGpu._mark, null unless set)
    let hasLag = ring.cur[lagSlot] === cur - lag;
    if (gather) this._gatherDisk(ring.f[slot][0], col, cols, gather);
    if (this._mark) this._mark("probe · ring+gather");
    let eR = null;
    if (eyeOp && (eyeOp.data || eyeOp.frft)) { const E = eyeOp;   // (only a SPATIAL op needs the eye ring: the k-space ones are relabels/gates in the row pass) · (+ F^a: E.frft, a separable matrix after the table)
      if (!E.data) { copy(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, S.fA); S.src = 'A'; this._sepMatS(S, E.frft); this._fft2dS(S, false); }
      else {
      if (!this._progEyeOp) this._progEyeOp = this._compileStep(GLSL_EYE_OP);
      if (!this._eyeMsk || this._eyeMsk.key !== E.key) { if (!this._eyeMsk) this._eyeMsk = { tex: mk(G, G) };
        gl.bindTexture(gl.TEXTURE_2D, this._eyeMsk.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RGBA, gl.FLOAT, E.data); this._eyeMsk.key = E.key; }
      const po = this._progEyeOp, Lo = (n) => gl.getUniformLocation(po, n); gl.bindFramebuffer(gl.FRAMEBUFFER, S.fA); gl.viewport(0, 0, G, G); gl.useProgram(po);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._eyeSrc === 'A' ? this._eyeA : this._eyeB); gl.uniform1i(Lo('u_src'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._eyeMsk.tex); gl.uniform1i(Lo('u_msk'), 1);
      gl.uniform1f(Lo('u_cj'), 1); gl.uniform1f(Lo('u_qL'), +E.qL || 0); gl.uniform1f(Lo('u_amix'), +E.amix || 0);   // (the conjugate is a RELABEL in the row pass — u_cjk — applied to this ring: never here too)
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
      S.src = 'A'; if (E.frft) this._sepMatS(S, E.frft); this._fft2dS(S, false); }
      eR = this._ring('beye:' + key, R); eR.cur = eR.cur || new Array(R).fill(-1); eR.ek = eR.ek || new Array(R).fill('');
      copy(S.src === 'A' ? S.A : S.B, eR.f[slot][1]); eR.cur[slot] = cur; eR.ek[slot] = E.key;
      hasLag = eR.cur[lagSlot] === cur - lag && eR.ek[lagSlot] === E.key; }
    if (this._mark) this._mark("probe · eye");
    if (ringOnly) { this._restoreGL(st); return hasLag; }
    const curT = eR ? eR.f[slot][0] : ring.f[slot][0], lagT = eR ? eR.f[hasLag ? lagSlot : slot][0] : ring.f[hasLag ? lagSlot : slot][0];
    const pr = this._progBandRowSec, L = (p, n) => gl.getUniformLocation(p, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._bandRowsSec.fbo); gl.viewport(0, 0, nb, G); gl.useProgram(pr);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, curT); gl.uniform1i(L(pr, 'u_cur'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lagT); gl.uniform1i(L(pr, 'u_lag'), 1);
    gl.uniform1i(L(pr, 'u_G'), G); gl.uniform1i(L(pr, 'u_nb'), nb); gl.uniform2f(L(pr, 'u_k'), kx, ky); gl.uniform1i(L(pr, 'u_full'), this._bandFullRow ? 1 : 0);
    const _mir = (m) => { gl.uniform1i(L(pr, 'u_rf'), m ? (m.direct ? 2 : 1) : 0); if (m) { gl.uniform2i(L(pr, 'u_b2'), m.b2x | 0, m.b2y | 0); gl.uniform2i(L(pr, 'u_b2L'), (m.b2xL ?? m.b2x) | 0, (m.b2yL ?? m.b2y) | 0); gl.uniform1f(L(pr, 'u_r2'), +m.r2 || 0); } };
    const _eyeU = (E) => { gl.uniform1i(L(pr, 'u_kcm'), (E && E.kcm) | 0); gl.uniform1f(L(pr, 'u_kc2'), +(E && E.kc2) || 0); gl.uniform1i(L(pr, 'u_cjk'), E && E.cjk ? 1 : 0);
      gl.uniform3f(L(pr, 'u_pol'), E && E.pol ? 1 : 0, E && E.pol ? Math.cos(2 * E.pol) : 1, E && E.pol ? Math.sin(2 * E.pol) : 0);
      const bs = (E && E.bs) || []; gl.uniform1i(L(pr, 'u_bsN'), Math.min(4, bs.length)); for (let k = 0; k < 4; k++) gl.uniform2i(L(pr, 'u_bs' + k), (bs[k] ? bs[k][0] : 0) | 0, (bs[k] ? bs[k][1] : 0) | 0); gl.uniform1f(L(pr, 'u_bsr2'), +(E && E.bsr2) || 0); };
    _mir(mirror); _eyeU(eyeOp);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    if (this._mark) this._mark("probe · rows");
    const pc = this._progBandColSec, T = this._bandRowsSec.tex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._bandAtlasSec.fbo); gl.viewport(col * nb, 0, nb, 3); gl.useProgram(pc);
    for (let i = 0; i < 3; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, T[i]); }
    gl.uniform1i(L(pc, 'u_e'), 0); gl.uniform1i(L(pc, 'u_cr'), 1); gl.uniform1i(L(pc, 'u_ci'), 2); gl.uniform1i(L(pc, 'u_G'), G); gl.uniform1i(L(pc, 'u_x0'), col * nb); gl.uniform1i(L(pc, 'u_ry'), 0);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    //   atlas row 5 — the shell's PLACE (the main pass's 4th target, summed like the others: r = 5 − u_ry = 3)
    gl.viewport(col * nb, 5, nb, 1); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, T[3]); gl.uniform1i(L(pc, 'u_p'), 3); gl.uniform1i(L(pc, 'u_ry'), 2);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, null);
    if (refl) {   // the mirrored pass → atlas row 3 (energy only)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bandRowsSec.fbo); gl.viewport(0, 0, nb, G); gl.useProgram(pr);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, curT); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lagT);
      _mir(refl); _eyeU(eyeOp);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bandAtlasSec.fbo); gl.viewport(col * nb, 3, nb, 1); gl.useProgram(pc);
      for (let i = 0; i < 3; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, T[i]); }
      gl.uniform1i(L(pc, 'u_ry'), 3);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); }
    if (eyeOp) {   // atlas row 4 — the DRY read: what the ear would hear WITHOUT the eye (the same read — refl, else the main mirror/direct — on the field's own ring, no eye op): the eye's transmitted energy, for the loudness
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bandRowsSec.fbo); gl.viewport(0, 0, nb, G); gl.useProgram(pr);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ring.f[slot][0]); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ring.f[slot][0]);
      _mir(refl || mirror); _eyeU(null);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bandAtlasSec.fbo); gl.viewport(col * nb, 4, nb, 1); gl.useProgram(pc);
      for (let i = 0; i < 3; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, T[i]); }
      gl.uniform1i(L(pc, 'u_ry'), 4);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);   // unit 2 is outside _saveGL's set: leave it clean
    this._restoreGL(st);
    return hasLag;
  }
  //   the DISK GATHER pass (see probeBandsSec): the index texture (the modes' q, cached per id) and the atlas (cols × H rows of 128 texels)
  _gatherDisk(spec, col, cols, g) {
    const gl = this._gl, G = this._G, M = g.M | 0, H = Math.max(1, Math.ceil(M / 256));
    if (!this._progGather) this._progGather = this._compileStep(GLSL_GATHER_DISK);
    const mk = (w, h) => { const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return tex; };
    if (!this._gatherIdx || this._gatherIdx.id !== g.id) { if (this._gatherIdx) gl.deleteTexture(this._gatherIdx.tex);
      const d = new Float32Array(128 * H * 4); for (let t = 0; t < M; t++) { d[2 * t] = g.qs[2 * t]; d[2 * t + 1] = g.qs[2 * t + 1]; }   // texel u holds modes 2u, 2u+1: (qx0, qy0, qx1, qy1)
      const tex = mk(128, H); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, H, gl.RGBA, gl.FLOAT, d); this._gatherIdx = { id: g.id, tex, H }; }
    if (!this._gatherAtlas || this._gatherAtlas.H !== H || this._gatherAtlas.cols !== cols) { if (this._gatherAtlas) { gl.deleteTexture(this._gatherAtlas.tex); gl.deleteFramebuffer(this._gatherAtlas.fbo); }
      const tex = mk(128, H * cols), fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this._gatherAtlas = { tex, fbo, H, cols }; }
    const pr = this._progGather, L = (n) => gl.getUniformLocation(pr, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._gatherAtlas.fbo); gl.viewport(0, col * H, 128, H); gl.useProgram(pr);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, spec); gl.uniform1i(L('u_spec'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._gatherIdx.tex); gl.uniform1i(L('u_idx'), 1);
    gl.uniform1i(L('u_G'), G); gl.uniform1i(L('u_M'), M); gl.uniform1i(L('u_y0'), col * H); gl.uniform2i(L('u_b2'), g.b2x | 0, g.b2y | 0); gl.uniform1i(L('u_direct'), g.direct ? 1 : 0);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
  }
  //   async read of the gather atlas (the first n columns), like readBandAtlasSecStart; finish → { data: Float32Array(n·H·128·4), H }
  //   ═══ THE NATIVE LOCK-IN ON THE GPU (2026-10-21, inert: only an app that calls these) ════════════════════════════════════════════════════
  //   The app's native lock-in (◐medium·lock / field·lock) — derived state stepped once per sub-step from the gathered disk — kept HERE, in the
  //   gather's layout (128 × H RGBA32F, two complex modes a texel: mode t at texel (t>>1)%128, (t>>1)/128, half t&1), so nothing is read back
  //   per sub-step. Sets (each ping-pong, one MRT framebuffer per parity): C = the channels (≤ 3), D = the delay line (X1, Y1, Nm), Q = the
  //   shutter's open accumulators. lkStep = the CPU _lockStep's per-mode arithmetic, expression for expression; lkSyn = its sound outputs per
  //   bin (a mode list per bin: each bin sums its own modes) into a small atlas read with the band batch; lkRead / lkUpload = the snapshot
  //   and the restore; lkScatter = the lock image into the active eye (k-space), for the GPU pictures.
  _lkMk(H, n) { const gl = this._gl, mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 128, H);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
    return [0, 1].map(() => { const tex = Array.from({ length: n }, mk), fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      tex.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0)); gl.drawBuffers(tex.map((_, k) => gl.COLOR_ATTACHMENT0 + k)); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { tex, fbo }; }); }
  lkDrop(key) { const gl = this._gl, S = this._lk && this._lk[key]; if (!S) return; for (const set of [S.C, S.D, S.Q]) if (set) for (const b of set) { b.tex.forEach((t) => gl.deleteTexture(t)); gl.deleteFramebuffer(b.fbo); } delete this._lk[key]; }
  lkEnsure(key, H, nch, dli, shut) { this._lk = this._lk || {}; let S = this._lk[key]; const sig = H + "|" + nch + "|" + !!dli + "|" + !!shut;
    if (S && S.sig === sig) return S; if (S) this.lkDrop(key);
    S = this._lk[key] = { sig, H, nch, pC: 0, pD: 0, pQ: 0, C: this._lkMk(H, nch), D: dli ? this._lkMk(H, 3) : null, Q: shut ? this._lkMk(H, nch) : null };
    if (!this._lkP) { const gl = this._gl, src = (nOut) => `#version 300 es
precision highp float;
uniform sampler2D u_g, u_A0, u_A1, u_A2, u_X1, u_Y1, u_Nm; uniform int u_y0, u_nch, u_dli, u_hasDl, u_two, u_out;
uniform vec2 u_r0, u_r1, u_r2, u_e1, u_rr, u_gg; uniform float u_dec, u_sc;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
vec2 rot(vec2 x, vec2 r) { return vec2(x.x * r.x - x.y * r.y, x.x * r.y + x.y * r.x); }
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void lkHalf(vec2 x, vec2 p0, vec2 p1, vec2 p2, vec2 X1, vec2 Y1, vec2 Nm, out vec2 n0, out vec2 n1, out vec2 n2, out vec2 X1n, out vec2 Y1n, out vec2 Nmn) {
  vec2 a0 = rot(x, u_r0); n0 = p0 * u_dec + a0; n1 = p1 * u_dec + rot(x, u_r1); n2 = p2 * u_dec + rot(x, u_r2);
  X1n = X1; Y1n = Y1; Nmn = Nm;
  if (u_dli == 1) { if (u_hasDl == 1) { vec2 y = a0 - cm(u_e1, X1); vec2 z = u_two == 1 ? y - cm(u_rr, Y1) : y;
      Nmn = Nm * u_dec + vec2(u_gg.x * z.x + u_gg.y * z.y, u_gg.x * z.y - u_gg.y * z.x); Y1n = y; }
    X1n = a0; n0 = Nmn * u_sc; } }
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec4 x = texelFetch(u_g, ivec2(c.x, c.y + u_y0), 0);
  vec4 A0 = texelFetch(u_A0, c, 0), A1 = u_nch > 1 ? texelFetch(u_A1, c, 0) : vec4(0.0), A2 = u_nch > 2 ? texelFetch(u_A2, c, 0) : vec4(0.0);
  vec4 X1 = u_dli == 1 ? texelFetch(u_X1, c, 0) : vec4(0.0), Y1 = u_dli == 1 ? texelFetch(u_Y1, c, 0) : vec4(0.0), Nm = u_dli == 1 ? texelFetch(u_Nm, c, 0) : vec4(0.0);
  vec2 a0, a1, a2, x1, y1, nm, b0, b1, b2, xb, yb, nb;
  lkHalf(x.xy, A0.xy, A1.xy, A2.xy, X1.xy, Y1.xy, Nm.xy, a0, a1, a2, x1, y1, nm);
  lkHalf(x.zw, A0.zw, A1.zw, A2.zw, X1.zw, Y1.zw, Nm.zw, b0, b1, b2, xb, yb, nb);
  if (u_out == 0) { o0 = vec4(a0, b0); o1 = vec4(a1, b1); o2 = vec4(a2, b2); } else { o0 = vec4(x1, xb); o1 = vec4(y1, yb); o2 = vec4(nm, nb); } }`;
      const p = this._compileStep(src(3)), ul = (n) => gl.getUniformLocation(p, n), U = {}; for (const n of ['g', 'A0', 'A1', 'A2', 'X1', 'Y1', 'Nm', 'y0', 'nch', 'dli', 'hasDl', 'two', 'out', 'r0', 'r1', 'r2', 'e1', 'rr', 'gg', 'dec', 'sc']) U[n] = ul('u_' + n);
      const sp = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_new, u_old, u_g, u_list, u_off; uniform int u_y0, u_nb;
out vec4 o;
vec2 md(sampler2D t, int m, int y0) { ivec2 c = ivec2((m >> 1) % 128, (m >> 1) / 128 + y0); vec4 v = texelFetch(t, c, 0); return (m & 1) == 1 ? v.zw : v.xy; }
void main() { int j = int(gl_FragCoord.x); if (j > u_nb) { o = vec4(0.0); return; }
  int a = int(texelFetch(u_off, ivec2(j, 0), 0).x), b = int(texelFetch(u_off, ivec2(j + 1, 0), 0).x); vec4 acc = vec4(0.0);
  for (int k = 0; k < 1048576; k++) { int q = a + k; if (q >= b) break; int m = int(texelFetch(u_list, ivec2(q % 1024, q / 1024), 0).x);
    vec2 n = md(u_new, m, 0), ol = md(u_old, m, 0), x = md(u_g, m, u_y0);
    acc += vec4(dot(n, n), n.x * ol.x + n.y * ol.y, n.y * ol.x - n.x * ol.y, dot(x, x)); }
  o = acc; }`), ul2 = (n) => gl.getUniformLocation(sp, n);
      const cp = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_a, u_b, u_c; uniform float u_s; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); o0 = texelFetch(u_a, c, 0) * u_s; o1 = texelFetch(u_b, c, 0) * u_s; o2 = texelFetch(u_c, c, 0) * u_s; }`);
      const sc = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_lk, u_idx; uniform int u_G, u_half; uniform float u_r2, u_s; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int G = u_G, m = int(texelFetch(u_idx, c, 0).x); int qx = c.x <= G / 2 ? c.x : c.x - G, qy = c.y <= G / 2 ? c.y : c.y - G;
  if (m < 0 || float(qx * qx + qy * qy) >= u_r2) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 v = texelFetch(u_lk, ivec2((m >> 1) % 128, (m >> 1) / 128), 0); o = vec4(((m & 1) == 1 ? v.zw : v.xy) * u_s, 0.0, 1.0); }`);
      this._lkP = { p, U, sp, US: { new: ul2('u_new'), old: ul2('u_old'), g: ul2('u_g'), list: ul2('u_list'), off: ul2('u_off'), y0: ul2('u_y0'), nb: ul2('u_nb') },
        cp, UC: { a: gl.getUniformLocation(cp, 'u_a'), b: gl.getUniformLocation(cp, 'u_b'), c: gl.getUniformLocation(cp, 'u_c'), s: gl.getUniformLocation(cp, 'u_s') },
        sc, UK: { lk: gl.getUniformLocation(sc, 'u_lk'), idx: gl.getUniformLocation(sc, 'u_idx'), G: gl.getUniformLocation(sc, 'u_G'), r2: gl.getUniformLocation(sc, 'u_r2'), s: gl.getUniformLocation(sc, 'u_s') } }; }
    return S; }
  _lkPass(prog, fbo, w, h, binds, uni) { const gl = this._gl; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prog); uni();
    binds.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); });
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  //   lkStep(key, col, p): one sub-step from the gather atlas column col. p = { rots: [[c,s]…nch], dec, shut, dli: null | { hasDl, e1r, e1i, rr, ri, gr, gi, two, sc } }
  lkStep(key, col, p) { const gl = this._gl, S = this._lk[key], P = this._lkP, U = P.U, a = this._gatherAtlas; if (!S || !a) return false; const st = this._saveGL();
    try { const inSet = p.shut ? S.Q : S.C, pi = p.shut ? S.pQ : S.pC, src = inSet[pi], dst = inSet[1 - pi], D = S.D, dl = p.dli, dsrc = D ? D[S.pD] : null, z = src.tex[0];
      const binds = [a.tex, src.tex[0], src.tex[1] || z, src.tex[2] || z, dsrc ? dsrc.tex[0] : z, dsrc ? dsrc.tex[1] : z, dsrc ? dsrc.tex[2] : z];
      const uni = (out) => () => { [U.g, U.A0, U.A1, U.A2, U.X1, U.Y1, U.Nm].forEach((u, k) => gl.uniform1i(u, k)); gl.uniform1i(U.y0, col * a.H); gl.uniform1i(U.nch, S.nch); gl.uniform1i(U.dli, dl ? 1 : 0);
        gl.uniform1i(U.hasDl, dl && dl.hasDl ? 1 : 0); gl.uniform1i(U.two, dl && dl.two ? 1 : 0); gl.uniform1i(U.out, out); const r = p.rots; gl.uniform2f(U.r0, r[0][0], r[0][1]); gl.uniform2f(U.r1, r[1] ? r[1][0] : 1, r[1] ? r[1][1] : 0); gl.uniform2f(U.r2, r[2] ? r[2][0] : 1, r[2] ? r[2][1] : 0);
        gl.uniform2f(U.e1, dl ? dl.e1r : 1, dl ? dl.e1i : 0); gl.uniform2f(U.rr, dl ? dl.rr : 0, dl ? dl.ri : 0); gl.uniform2f(U.gg, dl ? dl.gr : 0, dl ? dl.gi : 0); gl.uniform1f(U.dec, p.dec); gl.uniform1f(U.sc, dl ? dl.sc : 0); };
      this._lkPass(P.p, dst.fbo, 128, S.H, binds, uni(0));
      if (D) { this._lkPass(P.p, D[1 - S.pD].fbo, 128, S.H, binds, uni(1)); S.pD = 1 - S.pD; }
      S.prevTex = src.tex; if (p.shut) S.pQ = 1 - S.pQ; else S.pC = 1 - S.pC; S.lastShut = !!p.shut; return true; } finally { this._restoreGL(st); } }
  //   the shutter's frame closes: C ← Q (the accumulated frame), Q ← 0
  lkDump(key) { const gl = this._gl, S = this._lk[key], P = this._lkP; if (!S || !S.Q) return; const st = this._saveGL();
    try { const q = S.Q[S.pQ].tex, z = q[0]; this._lkPass(P.cp, S.C[1 - S.pC].fbo, 128, S.H, [q[0], q[1] || z, q[2] || z], () => { gl.uniform1i(P.UC.a, 0); gl.uniform1i(P.UC.b, 1); gl.uniform1i(P.UC.c, 2); gl.uniform1f(P.UC.s, 1); }); S.pC = 1 - S.pC;
      this._lkPass(P.cp, S.Q[1 - S.pQ].fbo, 128, S.H, [q[0], q[1] || z, q[2] || z], () => { gl.uniform1i(P.UC.a, 0); gl.uniform1i(P.UC.b, 1); gl.uniform1i(P.UC.c, 2); gl.uniform1f(P.UC.s, 0); }); S.pQ = 1 - S.pQ; } finally { this._restoreGL(st); } }
  //   the sound's outputs of the step just taken: per bin j (and j = nb: the modes in no bin) Σ|new|², Σ new·conj(old) (re, im), Σ|x|² — into row
  //   `col` of the syn atlas (nb + 1 wide, `cols` high). Bins: a mode list per bin (CSR: list = mode indices, off = nb + 2 offsets), made by the app.
  lkSynSetBins(key, list, off) { const gl = this._gl; this._lkBins = this._lkBins || {}; const old = this._lkBins[key]; if (old) { gl.deleteTexture(old.l); gl.deleteTexture(old.o); }
    const L = Math.max(1, list.length), w = 1024, h = Math.ceil(L / w), ld = new Float32Array(w * h); ld.set(list); const od = Float32Array.from(off);
    const mk = (W, Hh, d) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, Hh, 0, gl.RED, gl.FLOAT, d); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
    this._lkBins[key] = { l: mk(w, h, ld), o: mk(od.length, 1, od), nb: off.length - 2 }; }
  lkSyn(key, col, cols, sh) { const gl = this._gl, S = this._lk[key], B = this._lkBins && this._lkBins[key], P = this._lkP, a = this._gatherAtlas; if (!S || !B || !a) return false; const nb = B.nb, W = nb + 1;
    if (!this._lkSynA || this._lkSynA.W !== W || this._lkSynA.cols !== cols) { if (this._lkSynA) { gl.deleteTexture(this._lkSynA.tex); gl.deleteFramebuffer(this._lkSynA.fbo); }
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, W, cols); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); this._lkSynA = { tex: t, fbo: f, W, cols }; }
    const st = this._saveGL();
    try { const cur = (S.lastShut ? S.Q[S.pQ] : S.C[S.pC]).tex[sh], old = S.prevTex[sh]; gl.bindFramebuffer(gl.FRAMEBUFFER, this._lkSynA.fbo); gl.viewport(0, col, W, 1); gl.useProgram(P.sp);
      [cur, old, a.tex, B.l, B.o].forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); });
      gl.uniform1i(P.US.new, 0); gl.uniform1i(P.US.old, 1); gl.uniform1i(P.US.g, 2); gl.uniform1i(P.US.list, 3); gl.uniform1i(P.US.off, 4); gl.uniform1i(P.US.y0, col * a.H); gl.uniform1i(P.US.nb, nb);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return true; } finally { this._restoreGL(st); } }
  lkSynReadStart(n) { const gl = this._gl, A = this._lkSynA; if (!A || n <= 0) return null; const pbo = gl.createBuffer(), prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, A.W * n * 16, gl.STREAM_READ); gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo); gl.readPixels(0, 0, A.W, n, gl.RGBA, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, W: A.W, n }; }
  lkSynReadFinish(h) { const gl = this._gl, d = new Float32Array(h.W * h.n * 4); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, d); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); this.readEyePsiDrop(h); return { data: d, W: h.W }; }
  //   lkRead(key) → { C: [Float32Array(128·H·4)…], D, Q } (synchronous: the snapshot) · lkUpload(key, same) (the restore)
  lkRead(key) { const gl = this._gl, S = this._lk && this._lk[key]; if (!S) return null; const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), rd = (set, pi) => set ? set[pi].tex.map((t) => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); const o = new Float32Array(128 * S.H * 4); gl.readPixels(0, 0, 128, S.H, gl.RGBA, gl.FLOAT, o); gl.deleteFramebuffer(f); return o; }) : null;
    const r = { C: rd(S.C, S.pC), D: rd(S.D, S.pD), Q: rd(S.Q, S.pQ) }; gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb); return r; }
  //   lkReadStart(key) / lkReadReady(h) / lkReadFinish(h) — the same read WITHOUT the stall (PBO + fence), for the app's mirror
  lkReadStart(key) { const gl = this._gl, S = this._lk && this._lk[key]; if (!S) return null; const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), n = 128 * S.H * 4, parts = [];
    const one = (set, pi, tag) => { if (!set) return; set[pi].tex.forEach((t, k) => { const f = gl.createFramebuffer(), pbo = gl.createBuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ); gl.readPixels(0, 0, 128, S.H, gl.RGBA, gl.FLOAT, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteFramebuffer(f); parts.push({ tag, k, pbo }); }); };
    one(S.C, S.pC, "C"); one(S.D, S.pD, "D"); one(S.Q, S.pQ, "Q"); gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { parts, fence, n }; }
  lkReadReady(h) { const gl = this._gl; return !!h && gl.getSyncParameter(h.fence, gl.SYNC_STATUS) === gl.SIGNALED; }
  lkReadFinish(h) { const gl = this._gl, r = { C: [], D: null, Q: null }; for (const p of h.parts) { const o = new Float32Array(h.n); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, o); gl.deleteBuffer(p.pbo);
      if (p.tag === "C") r.C[p.k] = o; else (r[p.tag] = r[p.tag] || [])[p.k] = o; } gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteSync(h.fence); return r; }
  lkUpload(key, d) { const gl = this._gl, S = this._lk && this._lk[key]; if (!S) return false; const up = (set, pi, arr) => { if (!set || !arr) return; set[pi].tex.forEach((t, k) => { if (!arr[k]) return; gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, S.H, gl.RGBA, gl.FLOAT, arr[k]); }); };
    up(S.C, S.pC, d.C); up(S.D, S.pD, d.D); up(S.Q, S.pQ, d.Q); gl.bindTexture(gl.TEXTURE_2D, null); return true; }
  //   lkScatter(key, ch, idxTex, r2, s): channel ch's modes into the ACTIVE eye at their cells (k-space; |q|² < r2), × s; elsewhere 0
  lkIdxTex(id, idx) { const gl = this._gl, G = this._G; this._lkIdx = this._lkIdx || new Map(); let t = this._lkIdx.get(id); if (t) return t; const f = Float32Array.from(idx);
    t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, G, G, 0, gl.RED, gl.FLOAT, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    if (this._lkIdx.size > 6) { for (const v of this._lkIdx.values()) gl.deleteTexture(v); this._lkIdx.clear(); } this._lkIdx.set(id, t); return t; }
  lkScatter(key, ch, idxTex, r2, s) { const gl = this._gl, S = this._lk && this._lk[key], P = this._lkP; if (!S) return false; const lk = S.C[S.pC].tex[ch] || S.C[S.pC].tex[0];
    this._eyePass(P.sc, [lk, idxTex], () => { gl.uniform1i(P.UK.lk, 1); gl.uniform1i(P.UK.idx, 2); gl.uniform1i(P.UK.G, this._G); gl.uniform1f(P.UK.r2, r2); gl.uniform1f(P.UK.s, s); }); return true; }
  readGatherStart(n) {

    const gl = this._gl, a = this._gatherAtlas; if (!a || n <= 0) return null;
    const pbo = gl.createBuffer(), prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), rows = n * a.H;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 128 * rows * 4 * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo); gl.readPixels(0, 0, 128, rows, gl.RGBA, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    return { pbo, fence, rows, H: a.H };
  }
  readGatherFinish(h) {
    const gl = this._gl, data = new Float32Array(128 * h.rows * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.readEyePsiDrop(h); return { data, H: h.H };
  }
  //   readBandAtlasSec(n) — Float32Array(n·nb·12): probe p, band b → [E s0..s3, Cre s0..s3, Cim s0..s3] at (p·nb + b)·12 (+ .refl, see _bandSecUnpack)
  readBandAtlasSec(n) {
    const gl = this._gl, a = this._bandAtlasSec; if (!a || n <= 0) return null;
    const W = n * a.nb, raw = new Float32Array(W * 6 * 4), prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo); gl.readPixels(0, 0, W, 6, gl.RGBA, gl.FLOAT, raw); gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    return this._bandSecUnpack(raw, W);
  }
  //   ASYNC twin of readBandAtlasSec: copy the first n probes into a PBO behind a fence and return at once (no pipeline stall). The
  //   atlas may be drawn into again right away — GL executes commands in order, so the copy reads the probes as they were. Finish
  //   when readBandAtlasSecReady(h) (or force it: it then waits for exactly those commands).
  readBandAtlasSecStart(n) {
    const gl = this._gl, a = this._bandAtlasSec; if (!a || n <= 0) return null;
    const W = n * a.nb, pbo = gl.createBuffer(), prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, W * 6 * 4 * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo); gl.readPixels(0, 0, W, 6, gl.RGBA, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    return { pbo, fence, W };
  }
  readBandAtlasSecReady(h) { const gl = this._gl; return !!h && !!h.fence && gl.getSyncParameter(h.fence, gl.SYNC_STATUS) === gl.SIGNALED; }
  readBandAtlasSecFinish(h) {
    const gl = this._gl, W = h.W, raw = new Float32Array(W * 6 * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.readEyePsiDrop(h);
    return this._bandSecUnpack(raw, W);
  }
  //   the atlas rows → out (the field: [E, Cre, Cim] × 4 sectors at x·12, as always) + out.refl (row 3, the mirrored energies at x·4 —
  //   meaningful only for a probe drawn with refl)
  _bandSecUnpack(raw, W) {
    const out = new Float32Array(W * 12), rf = new Float32Array(W * 4), dry = new Float32Array(W * 4), pos = new Float32Array(W * 4);
    for (let x = 0; x < W; x++) { for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) out[x * 12 + r * 4 + c] = raw[(r * W + x) * 4 + c]; for (let c = 0; c < 4; c++) { rf[x * 4 + c] = raw[(3 * W + x) * 4 + c]; dry[x * 4 + c] = raw[(4 * W + x) * 4 + c]; pos[x * 4 + c] = raw[(5 * W + x) * 4 + c]; } }
    out.refl = rf; out.dry = dry; out.pos = pos; return out;   // pos: row 5 (per shell: Zx re, im, Zy re, im — the shell's place)   // dry: row 4 (the read without the eye — meaningful only for a probe drawn with an eye op)
  }
  //   readBandAtlas(n) — the first n band probes: Float32Array(n·nb·4), probe p band b at (p·nb + b)·4 = (E, Cre, Cim, 0)
  readBandAtlas(n) {
    const gl = this._gl, a = this._bandAtlas; if (!a || n <= 0) return null;
    const out = new Float32Array(n * a.nb * 4), prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo); gl.readPixels(0, 0, n * a.nb, 1, gl.RGBA, gl.FLOAT, out); gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    return out;
  }

  //   readProbeAtlas(n) — the first n probe blocks as Float32Array(n·T·T·4), block-major: block b, tile (tx,ty) at
  //   ((b·T·T) + ty·T + tx)·4. One readPixels for every probe since the last read.
  readProbeAtlas(n) {
    const gl = this._gl, a = this._probeAtlas; if (!a || n <= 0) return null;
    const T = a.T, raw = new Float32Array(n * T * T * 4);
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.readPixels(0, 0, n * T, T, gl.RGBA, gl.FLOAT, raw);   // row-major over the atlas: (y·(n·T) + x)·4
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    const out = new Float32Array(n * T * T * 4), W = n * T;
    for (let b = 0; b < n; b++) for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
      const si = (ty * W + b * T + tx) * 4, di = ((b * T + ty) * T + tx) * 4;
      out[di] = raw[si]; out[di + 1] = raw[si + 1]; out[di + 2] = raw[si + 2]; out[di + 3] = raw[si + 3]; }
    return out;
  }

  // DIAGNOSTIC: read back the shared _obj (injection att) texture as Float64(2N). Attaches _obj to a scratch FBO.
  //   Used only by the join-fork probe to hash the ACTUAL resident att the superpose reads (RG32F).
  readObjField() {
    const gl = this._gl, G = this._G;
    if (!this._obj) return null;
    if (!this._dbgFbo) this._dbgFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._dbgFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._obj, 0);
    const f32 = new Float32Array(G * G * 2);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Float64Array(G * G * 2);
    for (let i = 0; i < G * G * 2; i++) out[i] = f32[i];
    return out;
  }

  // ── Public: hologram-domain transform [H] on the eye field, in place ─────────
  // Acts on ψ between the forward and backward legs of the eye round-trip — the slot
  // where the wavefront is maximally spread, so operations here are holographic
  // (local edit in H-space = distributed edit in object space). Modes:
  //   0 = identity (no-op; round-trip stays exact)
  //   1 = low-pass aperture  (keep radius < param·R: blurs/smooths the percept)
  //   2 = high-pass aperture (keep radius > param·R: edge/detail emphasis)
  //   3 = phase conjugate    (ψ → conj(ψ): time-reversal / twin)
  // param ∈ [0,1] is the aperture fraction. Runs on the eye ping-pong, swaps buffers.
  applyEyeHologram(mode, param, opts = {}) {
    if (!mode) return;                 // mode 0 / falsy = identity, skip entirely
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.eyeHologram;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progEyeHologram);
    gl.uniform1i(u.psi,   0);
    gl.uniform1i(u.G,     G);
    gl.uniform1i(u.mode,  mode);
    gl.uniform1f(u.param, param);
    gl.uniform1i(u.block, opts.block ?? 8);     // random-block size px (modes 7/8)
    gl.uniform1f(u.seed,  opts.seed  ?? 0.0);   // reshuffle the random pattern
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // §7.60: the nonlinear decision kick on the eye field — unitary intensity-thresholded phase rotation.
  // Apply ONLY inside the dedicated nonlinear phase (the persistent engine's bar boundary); applying it
  // during transport/binding phases would break the linearity those results depend on.
  applyEyeNlKick(gamma, th, w) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.nlKick;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progNlKick);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.gamma, gamma); gl.uniform1f(u.th, th); gl.uniform1f(u.w, w);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // SELF-FOCUS the eye field: amplitude saturation |ψ|→tanh(gain·|ψ|)/gain, phase preserved. The momentum-conserving localizer the medium
  // lacked — confines a soliton as a stable particle WITHOUT a positional target (so a momentum kick survives). One GPU pass, ping-pong.
  applyEyeSelfFocus(th, gp, lo) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.selfFocus;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progSelfFocus);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.th, th); gl.uniform1f(u.gp, gp); gl.uniform1f(u.lo, lo);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: IFS-native LOW-PASS contraction on the eye field (charge-conserving smoothing — suppresses high-k spurious vortices).
  //    β = smoothing weight (0.3 validated). Ping-pongs the eye buffer like applyEyeSelfFocus.
  applyEyeLowpass(beta) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.lowpass;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progLowpass);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.beta, beta); gl.uniform1f(u.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: IFS-native GPE density-dependent contraction ψ→ψ/(1+γ|ψ|²) on the eye field (charge-conserving; holds the vortex core node).
  //    γ = GPE strength (0.5 validated). Ping-pongs the eye buffer like applyEyeLowpass.
  applyEyeDensContract(gamma) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.densContract;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progDensContract);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.gamma, gamma);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: CGL dissipative-soliton balance ψ*=exp((−δ+ε|ψ|²−μ|ψ|⁴)dt) on the eye field. linear loss δ + cubic gain ε + quintic loss μ
  //    → a stable interior dissipative soliton (attracting fixed point). Ping-pongs the eye buffer.
  applyEyeCgl(delta, eps, mu, dt) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.cgl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progCgl);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.delta, delta); gl.uniform1f(u.eps, eps); gl.uniform1f(u.mu, mu); gl.uniform1f(u.dt, dt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── §7.90 Public: PURE-MEDIUM BINDING — multiply the eye field by an operand field B, in place, ON THE GPU
  //    (complex ψ_eye·ψ_B per cell, no JS dot product). This is the operator's binding done AS A MEDIUM OPERATION:
  //    the two fields interact cell-by-cell, the product becomes eye field content, and the soliton/IFS dynamics
  //    then transport it (§9 proved propagating ψA·ψB recovers the A·B correlation). bField64 = Float64(2N) the
  //    operand B (re,im interleaved). The medium operating on the medium — the "optical chip" in this substrate. ─
  bindEyeField(bField64) {
    const gl = this._gl, G = this._G, N = G * G;
    // upload B into _bindB (RG float)
    const fB = new Float32Array(2 * N); for (let j = 0; j < N; j++) { fB[j*2] = bField64[j*2]; fB[j*2+1] = bField64[j*2+1]; }
    gl.bindTexture(gl.TEXTURE_2D, this._bindB);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, fB);
    // ψ_eye ·= B  (ping-pong: read src, write dst, swap)
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.fieldMul;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progFieldMul);
    gl.uniform1i(u.a, 0); gl.uniform1i(u.b, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._bindB);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // FIELD-LEVEL qedge, GPU-RESIDENT: apply the SU(2) element u=(u0,u1) to the slot PAIR (i,j) as ONE quaternion field
  //   ψ_ℍ ← ψ_ℍ·u (quaternion-pair.js su2ApplyField), entirely on the GPU — NO readback, NO upload. Both slots' resident
  //   textures are sampled; the two rotated channels are written into each slot's OTHER ping-pong half, then parity flips.
  //   Because the output pair depends on BOTH inputs, the two source textures are held STABLE across both passes (parity
  //   flips only AFTER both writes) — no read-after-write hazard. u0/u1 are the SHARED replicated register element →
  //   deterministic same-device (display-grade f32, exactly like stepEye; never read back into regH). Slots must be primed.
  quatMixEyeSlots(i, j, u0, u1) {
    const gl = this._gl, G = this._G;
    const si = this._slotEye[i], sj = this._slotEye[j];
    if (!si || !sj || !si.primed || !sj.primed) return false;   // both pair slots must have a resident field
    const srcI = si.src === 'A' ? si.A : si.B, dstI = si.src === 'A' ? si.fB : si.fA;   // read current, write the other half
    const srcJ = sj.src === 'A' ? sj.A : sj.B, dstJ = sj.src === 'A' ? sj.fB : sj.fA;
    const u = this._u.quatMix;
    gl.useProgram(this._progQuatMix);
    gl.viewport(0, 0, G, G);
    gl.uniform1i(u.a, 0); gl.uniform1i(u.b, 1);
    gl.uniform2f(u.u0, u0[0], u0[1]); gl.uniform2f(u.u1, u1[0], u1[1]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcI);   // u_a = slot i's field (ψ_A)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, srcJ);   // u_b = slot j's field (ψ_B)
    gl.bindVertexArray(this._vao);
    // pass 1: pA (slot i output) → slot i's dest (the non-src half)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstI); gl.uniform1i(u.which, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
    // pass 2: pB (slot j output) → slot j's dest  (still reading the SAME srcI/srcJ — parity not yet flipped → no hazard)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstJ); gl.uniform1i(u.which, 1); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    // The mix wrote ONLY the non-src half of each slot. But the turbo stepper ping-pongs BOTH halves and the render
    //   reads whichever half src points at — so if the two halves differ, consecutive draws show ALTERNATING fields
    //   (rotated / un-rotated) → the coupling visually AVERAGES OUT to nothing (the observed bug). Fix: copy the
    //   rotated result into the OTHER half too, so BOTH halves hold the rotated field (the CPU path's setEyePsiBoth
    //   equivalent). Now no matter which parity the stepper/render lands on, it reads the rotated field.
    const dstTexI = si.src === 'A' ? si.B : si.A, srcTexI = si.src === 'A' ? si.A : si.B;   // dst = the just-written half's TEXTURE; src = the old (to be overwritten)
    const dstTexJ = sj.src === 'A' ? sj.B : sj.A, srcTexJ = sj.src === 'A' ? sj.A : sj.B;
    const fboSrcI = si.src === 'A' ? si.fA : si.fB, fboSrcJ = sj.src === 'A' ? sj.fA : sj.fB;   // FBO of the OLD half (copy target)
    gl.useProgram(this._progFilmCopy);
    gl.uniform1i(gl.getUniformLocation(this._progFilmCopy, 'u_src'), 0);
    gl.bindVertexArray(this._vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboSrcI); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dstTexI); gl.drawArrays(gl.TRIANGLES, 0, 6);   // copy rotated pA into the other half
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboSrcJ); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dstTexJ); gl.drawArrays(gl.TRIANGLES, 0, 6);   // copy rotated pB into the other half
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // BOTH halves now hold the rotated field → leave src UNCHANGED (both identical). The stepper's next ping-pong
    //   reads the rotated field regardless of parity; the render always shows it. (No src flip needed.)
    this.dropFilm(i); this.dropFilm(j);   // drop the stale films → the draw path re-captures the rotated texture
    return true;
  }

  // FIELD-LEVEL dqedge, GPU-RESIDENT: apply the SE(3) screw U=(u_r,u_d) to the FOUR slots [ia,ib,ic,id] as ONE
  //   dual-quaternion field ψ̂ (dual-quaternion.js dqApplyField), entirely on the GPU — NO readback. (ia,ib)=q_r
  //   rotation pair, (ic,id)=q_d translation pair. The FOUR src textures are read STABLE across all four output
  //   passes (parity flips only AFTER — no read-after-write hazard). Each output is written to its slot's non-src
  //   half, then copied into the sibling half (both halves hold the rotated field — the parity-flicker fix). u_r/u_d
  //   are the SHARED replicated screw → deterministic same-device (display-grade f32; never read into regH). Primed.
  dualQmixEyeSlots(ia, ib, ic, id, ur0, ur1, ud0, ud1) {
    const gl = this._gl, G = this._G;
    const S = [this._slotEye[ia], this._slotEye[ib], this._slotEye[ic], this._slotEye[id]];
    for (const s of S) if (!s || !s.primed) return false;   // all four slots must have a resident field
    const src = S.map((s) => s.src === 'A' ? s.A : s.B);       // the 4 current textures (ψ_rA, ψ_rB, ψ_dA, ψ_dB)
    const dstFbo = S.map((s) => s.src === 'A' ? s.fB : s.fA);  // write into each slot's OTHER half's FBO
    const u = this._u.dualQmix;
    gl.useProgram(this._progDualQmix);
    gl.viewport(0, 0, G, G);
    gl.uniform1i(u.rA, 0); gl.uniform1i(u.rB, 1); gl.uniform1i(u.dA, 2); gl.uniform1i(u.dB, 3);
    gl.uniform2f(u.ur0, ur0[0], ur0[1]); gl.uniform2f(u.ur1, ur1[0], ur1[1]);
    gl.uniform2f(u.ud0, ud0[0], ud0[1]); gl.uniform2f(u.ud1, ud1[0], ud1[1]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src[0]);   // u_rA = ψ_r z0 (slot ia)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src[1]);   // u_rB = ψ_r z1 (slot ib)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, src[2]);   // u_dA = ψ_d z0 (slot ic)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, src[3]);   // u_dB = ψ_d z1 (slot id)
    gl.bindVertexArray(this._vao);
    for (let w = 0; w < 4; w++) {   // outputs: 0→rA(ia), 1→rB(ib), 2→dA(ic), 3→dB(id) — all reading the SAME 4 src textures
      gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo[w]); gl.uniform1i(u.which, w); gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);
    // copy each rotated result into the OTHER (src) half so BOTH halves hold the rotated field (parity-flicker fix)
    gl.useProgram(this._progFilmCopy);
    gl.uniform1i(gl.getUniformLocation(this._progFilmCopy, 'u_src'), 0);
    gl.bindVertexArray(this._vao);
    for (let w = 0; w < 4; w++) { const s = S[w];
      const dstTex = s.src === 'A' ? s.B : s.A;                // the just-written half's TEXTURE
      const fboSrc = s.src === 'A' ? s.fA : s.fB;              // the OLD half's FBO (copy target)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboSrc); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dstTex); gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dropFilm(ia); this.dropFilm(ib); this.dropFilm(ic); this.dropFilm(id);   // re-capture the rotated textures
    return true;
  }

  // ── PAIR / BODY-COVARIANT STEP PRIMITIVES (2026-09-23) ─────────────────────────────────────────────────────────
  //   A slot PAIR is one spinor field (ψ_A, ψ_B) and four slots one ℍ⊗𝔻 body (ψ_r = (rA,rB), ψ_d = (dA,dB)). The
  //   register rotates them by a RIGHT action, which commutes with the per-channel propagator — but NOT with a
  //   per-slot SPM or a per-slot energy cap: those see |ψ_A|² and |ψ_B|² separately, while a rotation only
  //   preserves their SUM. MEASURED (CPU model of this step): per-slot cap wiped a 32% A→B transfer to 0.1% within
  //   8 sub-steps; with the group forms below the rotation commutes with the whole unpinned step to 7e-16.
  //   So the covariant forms use the GROUP density: dens = the members whose |ψ|² is the invariant (both slots of
  //   an ℍ pair; the ROTATION pair of an ℍ⊗𝔻 body, since translation changes |ψ_d| — see dual-quaternion.js).
  //   A one-member group reduces EXACTLY to applyEyeNlSpm / applyEyeEnergyCapNS (the conservative slice).
  //   Both write every member's NON-src half from the members' SRC halves, and flip parity only after all writes,
  //   so no member is read after it has been written (the quatMixEyeSlots discipline). Returns false if a member is
  //   not resident. The caller must selectEyeSlot() again before any single-slot op (the active _eyeSrc is stale).
  _slotSrcTex(s) { return s.src === 'A' ? s.A : s.B; }
  applyGroupSpm(ids, densIds, gamma, isat, dt) {
    const S = ids.map((id) => this._slotEye[id]), D = densIds.map((id) => this._slotEye[id]);
    if (S.some((s) => !s || !s.primed) || !D.length || D.some((s) => !s || !s.primed)) return false;
    const gl = this._gl, G = this._G, u = this._u.groupSpm;
    gl.useProgram(this._progGroupSpm); gl.viewport(0, 0, G, G); this._scB();
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.d0, 1); gl.uniform1i(u.d1, 2); gl.uniform1i(u.nd, Math.min(2, D.length));
    gl.uniform1f(u.gamma, gamma); gl.uniform1f(u.isat, isat); gl.uniform1f(u.dt, dt);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._slotSrcTex(D[0]));
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._slotSrcTex(D[D.length > 1 ? 1 : 0]));
    gl.bindVertexArray(this._vao);
    for (const s of S) { gl.bindFramebuffer(gl.FRAMEBUFFER, s.src === 'A' ? s.fB : s.fA);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._slotSrcTex(s)); gl.drawArrays(gl.TRIANGLES, 0, 6); }
    gl.bindVertexArray(null); this._scE(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.activeTexture(gl.TEXTURE0);
    for (const s of S) s.src = s.src === 'A' ? 'B' : 'A';
    return true;
  }
  applyGroupCap(ids, densIds, target) {
    const S = ids.map((id) => this._slotEye[id]), D = densIds.map((id) => this._slotEye[id]);
    if (S.some((s) => !s || !s.primed) || !D.length || D.some((s) => !s || !s.primed) || !(target > 0)) return false;
    const gl = this._gl, G = this._G;
    this.opCycleInit();
    const ur = this._u.energyRows;
    D.slice(0, 2).forEach((d, k) => {   // E of each density member → the 1×1 scalar textures A / B (no readback)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G);
      gl.useProgram(this._progEnergyRows); gl.uniform1i(ur.a, 0); gl.uniform1i(ur.G, G);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._slotSrcTex(d));
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
      this._opColFinish(k === 0 ? 'A' : 'B');
    });
    const u = this._u.groupCap;
    gl.useProgram(this._progGroupCap); gl.viewport(0, 0, G, G); this._scB();
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.ea, 1); gl.uniform1i(u.eb, 2); gl.uniform1i(u.nd, Math.min(2, D.length)); gl.uniform1f(u.target, target);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._opSclA);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._opSclB);
    gl.bindVertexArray(this._vao);
    for (const s of S) { gl.bindFramebuffer(gl.FRAMEBUFFER, s.src === 'A' ? s.fB : s.fA);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._slotSrcTex(s)); gl.drawArrays(gl.TRIANGLES, 0, 6); }
    gl.bindVertexArray(null); this._scE(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.activeTexture(gl.TEXTURE0);
    for (const s of S) s.src = s.src === 'A' ? 'B' : 'A';
    return true;
  }
  // useSlotObj(id): point the injection target (_obj, read by applyEyeSuperpose / the spring / contract) at slot
  //   id's OWN obj texture, so members stepped in lockstep keep their per-beat att without re-uploading it every
  //   sub-step. id=null restores the shared default. Lazy-created, RG32F like _obj.
  useSlotObj(id) {
    if (!this._objDefault) this._objDefault = this._obj;
    if (id == null) { this._obj = this._objDefault; return; }
    this._slotObj ??= {};
    if (!this._slotObj[id]) this._slotObj[id] = this._makeRGF32Tex();
    this._obj = this._slotObj[id];
  }

  // §7.92 ROTATE the eye field by delta (rad) about each center pixel, within radius rad. One ping-pong pass — the
  // θ-operator as a pure-medium field transform (resample, moves |ψ|). centers = Float array [x0,y0,x1,y1,...] in
  // pixel coords (≤16). The medium operates on the medium: ψ_eye ← R_delta·ψ_eye locally about the mains.
  rotateEyeCenters(delta, centers, rad) {
    const gl = this._gl, G = this._G;
    const n = Math.min(16, centers.length >> 1);
    const flat = new Float32Array(32); for (let i = 0; i < n * 2; i++) flat[i] = centers[i];
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.rotCenters;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRotCenters);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.delta, delta); gl.uniform1i(u.n, n);
    gl.uniform2fv(u.centers, flat); gl.uniform1f(u.rad, rad); gl.uniform1i(u.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // §7.98 GENERAL METRIC OP: apply a FORWARD affine ψ'(x)=M·(x−c)+c+t about each center, within rad. m=[m00,m01,
  // m10,m11] (forward 2×2), t=[tx,ty] (forward translation, px). Inverted host-side (the shader samples the pre-
  // image). Covers rotate/scale/shear/translate with one pass — the §7.97 metric family. centers=[x0,y0,...] (≤16).
  affineEyeCenters(m, t, centers, rad) {
    const gl = this._gl, G = this._G;
    const det = m[0]*m[3] - m[1]*m[2], id = Math.abs(det) > 1e-9 ? 1/det : 0;
    const mi = [m[3]*id, -m[1]*id, -m[2]*id, m[0]*id];   // inverse 2×2
    const ti = [mi[0]*t[0] + mi[1]*t[1], mi[2]*t[0] + mi[3]*t[1]];   // Minv·t (subtracted in pre-image coords)
    const n = Math.min(16, centers.length >> 1);
    const flat = new Float32Array(32); for (let i = 0; i < n * 2; i++) flat[i] = centers[i];
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.affineCenters;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progAffineCenters);
    gl.uniform1i(u.psi, 0); gl.uniform4f(u.minv, mi[0], mi[1], mi[2], mi[3]); gl.uniform2f(u.tinv, ti[0], ti[1]);
    gl.uniform1i(u.n, n); gl.uniform2fv(u.centers, flat); gl.uniform1f(u.rad, rad); gl.uniform1i(u.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: FULL K-MAP IFS WARP (Hutchinson union) on the eye field — ONE GPU pass, no per-map readbacks. maps = array of
  //    { m:[m00,m01,m10,m11], t:[tx,ty] } (each map's forward affine, centred at the grid middle). The shader inverts each map,
  //    samples the K pre-images, keeps the max-magnitude → W(image)=⋃ₖ fₖ(image). Replaces the K-readback CPU loop in opCodeWarp.
  ifsWarpEye(maps, smooth = 0) {   // smooth=1 → bilinear (non-ringing, orbit transport); default 0 → Catmull-Rom (sharp, IFS render — unchanged)
    const gl = this._gl, G = this._G, n = Math.min(8, maps.length);
    const minv = new Float32Array(8 * 4), tinv = new Float32Array(8 * 2);
    for (let k = 0; k < n; k++) { const m = maps[k].m, t = maps[k].t || [0, 0];
      const det = m[0]*m[3] - m[1]*m[2], id = Math.abs(det) > 1e-9 ? 1/det : 0;
      const mi = [m[3]*id, -m[1]*id, -m[2]*id, m[0]*id];
      minv[k*4]=mi[0]; minv[k*4+1]=mi[1]; minv[k*4+2]=mi[2]; minv[k*4+3]=mi[3];
      tinv[k*2]=mi[0]*t[0] + mi[1]*t[1]; tinv[k*2+1]=mi[2]*t[0] + mi[3]*t[1]; }
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.ifsWarp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progIfsWarp);
    gl.uniform1i(u.psi, 0); gl.uniform4fv(u.minv, minv); gl.uniform2fv(u.tinv, tinv); gl.uniform1i(u.n, n); gl.uniform1i(u.G, G);
    if (u.smooth) gl.uniform1f(u.smooth, smooth);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── §7.102 Public: linOp (transform/mul form) on the eye field — ψ ·= e^{iφ}, one GPU pass, no readback. THE medium's
  //    spatial operator content·e^{iφ} (here content=ψ, mode=mul), φ = linear k·r + genome-lens quadratic (focus/shear/
  //    vortex). opts: { kx, ky, centers, a, beta, vtx }. centers=[] + lens coeffs=0 ⇒ pure linear carrier/θ-shift.
  //    Proven byte-identical to the §7.98 lens shader (the lens IS linOp); the strict "the eye literally calls linOp" form.
  linOp({ kx = 0, ky = 0, centers = null, a = 0, beta = 0, vtx = 0, phaseT = 0 } = {}) {
    const gl = this._gl, G = this._G;
    const n = centers ? Math.min(16, centers.length >> 1) : 0;
    const flat = new Float32Array(32); for (let i = 0; i < n * 2; i++) flat[i] = centers[i];
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.lensGenome;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progLensGenome);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.n, n); gl.uniform2fv(u.centers, flat);
    gl.uniform1f(u.a, a); gl.uniform1f(u.beta, beta); gl.uniform1f(u.vtx, vtx || 0); gl.uniform2f(u.k, kx, ky); gl.uniform1f(u.phaseT, phaseT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }
  // §7.98 back-compat alias: the genome lens IS linOp (mul, quadratic phase, no linear carrier).
  applyEyeLensGenome(centers, a, beta, vtx) { this.linOp({ centers, a, beta, vtx }); }

  // ── §7.82 Public: saturable SPM half-step on the eye field (the real _nlHalf). γ=0 ⇒ no-op (linear). ─
  applyEyeNlSpm(gamma, isat, dt) {
    const gl = this._gl, G = this._G; this._scB();
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.nlSpm;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progNlSpm);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.gamma, gamma); gl.uniform1f(u.isat, isat); gl.uniform1f(u.dt, dt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    this._scE();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── NONLOCAL KERR (2026-10-12): the phase from V = K ⋆ |ψ|², K̂(k) a real symbol (the app passes the screened Green's function of the
  //    medium's own ring operator). |ψ|² → a scratch field → this file's mixed-radix FFT → × K̂ → inverse → the saturable phase by V. The
  //    phase keeps |ψ|, like applyEyeNlSpm; the FFT passes are full-field, the final phase pass is scissored like the local one.
  setNlKernel(K64) { const gl = this._gl, G = this._G, N = G * G; if (!this._nlKTex) this._nlKTex = this._makeRGF32Tex();
    const f32 = new Float32Array(N * 2); for (let i = 0; i < N; i++) { f32[2 * i] = K64[i]; f32[2 * i + 1] = 0; }
    gl.bindTexture(gl.TEXTURE_2D, this._nlKTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32); gl.bindTexture(gl.TEXTURE_2D, null); }
  _nlPass(prog, fbo, binds, uni) { const gl = this._gl, G = this._G; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G); gl.useProgram(prog); uni();
    binds.forEach((t, k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); });
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  applyEyeNlSpmNonlocal(gamma, isat, dt) { const gl = this._gl; if (!this._nlKTex) return;
    if (!this._nlS) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); this._nlS = { A: a, fA: fa, B: b, fB: fb, src: 'A' }; }
    const S = this._nlS, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    S.src = 'A'; this._nlPass(this._progNlIntens, S.fA, [psi], () => gl.uniform1i(this._u.nlIntens.psi, 0));   // |ψ|² → S.A
    this._fft2dS(S, false);
    { const src = S.src === 'A' ? S.A : S.B, fbo = S.src === 'A' ? S.fB : S.fA, u = this._u.mulK;
      this._nlPass(this._progMulK, fbo, [src, this._nlKTex], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.k, 1); }); S.src = S.src === 'A' ? 'B' : 'A'; }
    this._fft2dS(S, true);
    const V = S.src === 'A' ? S.A : S.B, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, u = this._u.nlSpmV;
    this._scB(); this._nlPass(this._progNlSpmV, fbo, [psi, V], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.v, 1); gl.uniform1f(u.gamma, gamma); gl.uniform1f(u.isat, isat); gl.uniform1f(u.dt, dt); }); this._scE();
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }

  // ── ⇋ DS-II EXACT (2026-10-16, the app's linMode 4 — module note at its _dsTables): one step = the exact spectral phase e^{+iλ(k)dt} (λ the
  //    hyperbolic table) then the mean field e^{+iγ·V·dt}, V = K ⋆ |ψ|² (K the DS-II kernel), signed, unsaturated — the CPU _dsStep's twin.
  //    setDs(L, K) uploads the two real tables once; dsStep(dt, γ) steps the selected eye slot.
  setDs(L64, K64) { const gl = this._gl, G = this._G, N = G * G; if (!this._dsLTex) { this._dsLTex = this._makeRGF32Tex(); this._dsKTex = this._makeRGF32Tex(); }
    const up = (tex, v) => { const f = new Float32Array(2 * N); for (let i = 0; i < N; i++) f[2 * i] = v[i]; gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); };
    up(this._dsLTex, L64); up(this._dsKTex, K64); }
  dsStep(dt, gamma) { const gl = this._gl; if (!this._dsLTex) return;
    if (!this._progDsCopy) { this._progDsCopy = this._compileStep(GLSL_LIVE_COPY); this._progDsLin = this._compileStep(GLSL_DS_LIN); this._progDsNl = this._compileStep(GLSL_DS_NL);
      const ul = (p, n) => gl.getUniformLocation(p, n); this._uDs = { cpsi: ul(this._progDsCopy, 'u_psi'), lpsi: ul(this._progDsLin, 'u_psi'), llam: ul(this._progDsLin, 'u_lam'), ldt: ul(this._progDsLin, 'u_dt'),
        npsi: ul(this._progDsNl, 'u_psi'), nv: ul(this._progDsNl, 'u_v'), ng: ul(this._progDsNl, 'u_gamma'), ndt: ul(this._progDsNl, 'u_dt') }; }
    if (!this._nlS) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); this._nlS = { A: a, fA: fa, B: b, fB: fb, src: 'A' }; }
    const S = this._nlS, U = this._uDs, flip = () => { S.src = S.src === 'A' ? 'B' : 'A'; };
    // the dispersion: ψ → S, FFT, × e^{iλdt}, inverse, back into the eye
    S.src = 'A'; this._nlPass(this._progDsCopy, S.fA, [this._eyeSrc === 'A' ? this._eyeA : this._eyeB], () => gl.uniform1i(U.cpsi, 0));
    this._fft2dS(S, false);
    this._nlPass(this._progDsLin, S.src === 'A' ? S.fB : S.fA, [S.src === 'A' ? S.A : S.B, this._dsLTex], () => { gl.uniform1i(U.lpsi, 0); gl.uniform1i(U.llam, 1); gl.uniform1f(U.ldt, dt); }); flip();
    this._fft2dS(S, true);
    this._scB(); this._nlPass(this._progDsCopy, this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, [S.src === 'A' ? S.A : S.B], () => gl.uniform1i(U.cpsi, 0)); this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
    // the mean field: |ψ|² → S, FFT, × K, inverse → V; the phase γ·V·dt
    const psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    S.src = 'A'; this._nlPass(this._progNlIntens, S.fA, [psi], () => gl.uniform1i(this._u.nlIntens.psi, 0));
    this._fft2dS(S, false);
    { const u = this._u.mulK; this._nlPass(this._progMulK, S.src === 'A' ? S.fB : S.fA, [S.src === 'A' ? S.A : S.B, this._dsKTex], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.k, 1); }); flip(); }
    this._fft2dS(S, true);
    this._scB(); this._nlPass(this._progDsNl, this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, [psi, S.src === 'A' ? S.A : S.B], () => { gl.uniform1i(U.npsi, 0); gl.uniform1i(U.nv, 1); gl.uniform1f(U.ng, gamma); gl.uniform1f(U.ndt, dt); }); this._scE();
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }

  // ── ◇EXACT GPU STEP (2026-10-12): the bit-exact nonlinear law (the app's _bitLeg) on the GPU, for ⚡turbo. The state is INTEGER (RGBA32I
  //    per slot: copy A in .xy, copy B in .zw, quantum q = 2^-XQ_BITS, |ψ| < 128) and every sub-step is a bijection on it: the leapfrog's three
  //    shears through the turbo's own ring stencil, the Kerr rotation of each copy by an angle from the OTHER copy (three integer shears;
  //    local |ψ|² or the ◎ nonlocal V = K ⋆ |ψ|² through this file's FFT), and Tao's binding (the copies' difference turned by 2 rad, the
  //    sum kept, via the integer S-transform). Each pass computes its increment at ONE code site and the sign only multiplies the integer,
  //    so the inverse (sign −1, the passes in reverse order) recomputes the very same floats and undoes every step exactly however chaotic.
  //    The law is the turbo's (f32 ring stencil), not bit-equal to the CPU's _bitLeg; the state is per peer (GPU floats are not portable).
  _xsInit() { if (this._xsP) return this._xsP; const gl = this._gl, ul = (p, n) => gl.getUniformLocation(p, n);
    const P = { shear: this._compileStep(GLSL_X_SHEAR), rot: this._compileStep(GLSL_X_ROT), bind: this._compileStep(GLSL_X_BIND), pack: this._compileStep(GLSL_X_PACK),
      unpack: this._compileStep(GLSL_X_UNPACK), intens: this._compileStep(GLSL_X_INTENS) };
    P.u = { shear: Object.fromEntries(['x', 'rings', 'G', 'nRings', 'ringMeta', 'comp', 'c', 's', 'nh'].map((n) => [n, ul(P.shear, 'u_' + n)])),
      rot: Object.fromEntries(['x', 'v', 'nloc', 'which', 'g', 'isat', 'dt', 's', 'pot', 'vw'].map((n) => [n, ul(P.rot, 'u_' + n)])),
      bind: { x: ul(P.bind, 'u_x'), s: ul(P.bind, 'u_s') }, pack: { psi: ul(P.pack, 'u_psi') }, unpack: { x: ul(P.unpack, 'u_x') },
      intens: { x: ul(P.intens, 'u_x'), which: ul(P.intens, 'u_which') } };
    this._xsSlots = {}; return (this._xsP = P); }
  _xsTex() { const gl = this._gl, G = this._G, tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32I, G, G);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null); return [tex, fbo]; }
  _xsSlot(id) { this._xsInit(); let s = this._xsSlots[id]; if (!s) { const [A, fA] = this._xsTex(), [B, fB] = this._xsTex(); s = this._xsSlots[id] = { A, fA, B, fB, src: 'A' }; } return s; }
  get xsQ() { return 2 ** -XQ_BITS; }   // the exact state's quantum
  xsHas(id) { return !!(this._xsSlots && this._xsSlots[id]); }
  xsDrop(id) { const s = this._xsSlots && this._xsSlots[id]; if (!s) return; const gl = this._gl;
    gl.deleteTexture(s.A); gl.deleteTexture(s.B); gl.deleteFramebuffer(s.fA); gl.deleteFramebuffer(s.fB); delete this._xsSlots[id]; }
  _xsPass(s, prog, binds, uni) { const gl = this._gl, src = s.src === 'A' ? s.A : s.B; this._nlPass(prog, s.src === 'A' ? s.fB : s.fA, [src, ...binds], uni); s.src = s.src === 'A' ? 'B' : 'A'; }
  // pack the ACTIVE eye field into slot id's exact state (both copies = round(ψ/q))
  xsPackFromEye(id) { const gl = this._gl, s = this._xsSlot(id), P = this._xsP, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    this._nlPass(P.pack, s.src === 'A' ? s.fB : s.fA, [psi], () => gl.uniform1i(P.u.pack.psi, 0)); s.src = s.src === 'A' ? 'B' : 'A'; }
  // write copy A (× q) into the active eye field (one flip, like every eye pass)
  xsUnpackToEye(id) { const gl = this._gl, s = this._xsSlots[id], P = this._xsP; if (!s) return;
    this._nlPass(P.unpack, this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, [s.src === 'A' ? s.A : s.B], () => gl.uniform1i(P.u.unpack.x, 0));
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  // the ◎ nonlocal V of copy `which` (0 A, 1 B) into the _nlS scratch (needs setNlKernel); returns the V texture
  _xsV(s, which) { const gl = this._gl, P = this._xsP;
    if (!this._nlS) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); this._nlS = { A: a, fA: fa, B: b, fB: fb, src: 'A' }; }
    const S = this._nlS; S.src = 'A'; this._nlPass(P.intens, S.fA, [s.src === 'A' ? s.A : s.B], () => { gl.uniform1i(P.u.intens.x, 0); gl.uniform1i(P.u.intens.which, which); });
    this._fft2dS(S, false);
    { const src = S.src === 'A' ? S.A : S.B, fbo = S.src === 'A' ? S.fB : S.fA, u = this._u.mulK;
      this._nlPass(this._progMulK, fbo, [src, this._nlKTex], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.k, 1); }); S.src = S.src === 'A' ? 'B' : 'A'; }
    this._fft2dS(S, true); return S.src === 'A' ? S.A : S.B; }
  // ONE exact sub-step of slot id: sign +1 forward (leap, rotA by B, rotB by A, bind) or −1 its exact inverse (the same passes reversed).
  //   g = 0 → the leapfrog alone (still both copies, still bound). nonlocal = true uses the kernel set by setNlKernel.
  //   vw (the app's ✍ written guide): the slot's guide texture (setGuideField id) adds V = vw·S to the rotation angle beside the Kerr one —
  //   a fixed potential, so each copy's turn is still a pure fn of the other copy: the law stays a bijection on integers.
  // setNh(a, cx, cy) — the declared non-Hermitian part of the ring (the app's κ/m and n̂): the ◇exact shear weighs offset o by 1 + a·n̂·sin(2π·o/G),
  //   a real LOPSIDED stencil whose symbol is λ.re + i·λ.im (λ.im odd) — the shears stay bijections on integers. a = 0 (the default) = the symmetric ring.
  setNh(a = 0, cx = 0, cy = 0) { this._nhU = [+a || 0, +cx || 0, +cy || 0]; }
  //   setRingNh(a, cx, cy) — the same lopsided weights for the LEAPFROG (stepEye's ring-Laplacian, GLSL_LAP_FUNC) on the CURRENT ring; setRings resets it
  //   (a ring is symmetric until told otherwise). A shear is a bijection for any real ring, so the leapfrog carries λ.re + i·λ.im exactly as ◇exact does.
  setRingNh(a = 0, cx = 0, cy = 0) { this._ringNh = (+a || 0) ? [+a, +cx || 0, +cy || 0] : null; }
  xsStep(id, sign, dt, g, isat, nonlocal, vw = 0) { const gl = this._gl, s = this._xsSlot(id), P = this._xsP, U = P.u, sg = sign < 0 ? -1 : 1, nl = !!(nonlocal && this._nlKTex), gT = vw ? (this._gdTex && this._gdTex.get(id)) || null : null;
    const shear = (comp, c) => this._xsPass(s, P.shear, [this._ringTex], () => { const u = U.shear; gl.uniform1i(u.x, 0); gl.uniform1i(u.rings, 1); gl.uniform1i(u.G, this._G);
      gl.uniform1i(u.nRings, this._nRings | 0); if (this._ringMetaPadded) gl.uniform4fv(u.ringMeta, this._ringMetaPadded); gl.uniform1i(u.comp, comp); gl.uniform1f(u.c, c); gl.uniform1i(u.s, sg); const h = this._nhU || [0, 0, 0]; gl.uniform3f(u.nh, h[0], h[1], h[2]); });
    const leap = () => { shear(0, -dt / 4); shear(1, dt / 2); shear(0, -dt / 4); };   // the inverse is the same three with s −1 (shears 1 and 3 coincide)
    const rot = (which) => { if (!g && !gT) return; const V = nl && g ? this._xsV(s, 1 - which) : null;
      this._xsPass(s, P.rot, [V || this._eyeA, gT || this._eyeA], () => { const u = U.rot;   // (float textures on units 1, 2 either way — the sampler's type must match)
 gl.uniform1i(u.pot, 2); gl.uniform1f(u.vw, gT ? vw : 0);
 gl.uniform1i(u.x, 0); gl.uniform1i(u.v, 1); gl.uniform1i(u.nloc, V ? 1 : 0); gl.uniform1i(u.which, which);
        gl.uniform1f(u.g, g); gl.uniform1f(u.isat, isat); gl.uniform1f(u.dt, dt); gl.uniform1i(u.s, sg); }); };
    const bind = () => this._xsPass(s, P.bind, [], () => { gl.uniform1i(U.bind.x, 0); gl.uniform1i(U.bind.s, sg); });
    if (sg > 0) { leap(); rot(0); rot(1); bind(); } else { bind(); rot(1); rot(0); leap(); } }
  // xsPackFrom(id, re, im, bRe, bIm) — slot id's exact state from host arrays (copy A = round(ψ/q), copy B = round(B/q); B absent → B = A):
  //   a plate leg starts here (the app's GPU ◇NL exact legs). Values are rounded on the host, so a field that is already a multiple of q
  //   (a plate this law cut) packs back to the very same integers.
  xsPackFrom(id, re, im, bRe, bIm) { const gl = this._gl, G = this._G, n2 = G * G, s = this._xsSlot(id), iq = 2 ** XQ_BITS, d = new Int32Array(n2 * 4);
    for (let j = 0; j < n2; j++) { d[4 * j] = Math.round((+re[j] || 0) * iq); d[4 * j + 1] = Math.round((im ? +im[j] || 0 : 0) * iq);
      d[4 * j + 2] = bRe ? Math.round((+bRe[j] || 0) * iq) : d[4 * j]; d[4 * j + 3] = bIm ? Math.round((+bIm[j] || 0) * iq) : d[4 * j + 1]; }
    gl.bindTexture(gl.TEXTURE_2D, s.src === 'A' ? s.A : s.B); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RGBA_INTEGER, gl.INT, d); gl.bindTexture(gl.TEXTURE_2D, null); }
  // xsReadStart(id) / xsReadReady(h) / xsReadFinishF(h) / xsReadDrop(h) — the exact state read WITHOUT the pipeline stall (as readEyePsiStart): the copy
  //   is queued after every pass already issued on it (command order), fenced; Finish before Ready blocks like xsRead, so a caller with a deadline can force it.
  xsReadStart(id) { const gl = this._gl, G = this._G, s = this._xsSlots && this._xsSlots[id]; if (!s) return null; const n = G * G * 4, pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.src === 'A' ? s.fA : s.fB); gl.readPixels(0, 0, G, G, gl.RGBA_INTEGER, gl.INT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n }; }
  xsReadReady(h) { const gl = this._gl; return !!h && gl.getSyncParameter(h.fence, gl.SYNC_STATUS) === gl.SIGNALED; }
  xsReadFinishF(h) { const gl = this._gl, a = new Int32Array(h.n); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, a); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); this.readEyePsiDrop(h);
    const n2 = h.n >> 2, q = 2 ** -XQ_BITS, re = new Array(n2), im = new Array(n2), bRe = new Array(n2), bIm = new Array(n2);
    for (let j = 0; j < n2; j++) { re[j] = a[4 * j] * q; im[j] = a[4 * j + 1] * q; bRe[j] = a[4 * j + 2] * q; bIm[j] = a[4 * j + 3] * q; } return { re, im, bRe, bIm }; }
  xsReadDrop(h) { if (h) this.readEyePsiDrop(h); }
  // xsReadF(id) — the exact state as host floats: { re, im, bRe, bIm } (integers × q, so exact in f64)
  xsReadF(id) { const a = this.xsRead(id); if (!a) return null; const n2 = this._G * this._G, q = 2 ** -XQ_BITS, re = new Array(n2), im = new Array(n2), bRe = new Array(n2), bIm = new Array(n2);
    for (let j = 0; j < n2; j++) { re[j] = a[4 * j] * q; im[j] = a[4 * j + 1] * q; bRe[j] = a[4 * j + 2] * q; bIm[j] = a[4 * j + 3] * q; } return { re, im, bRe, bIm }; }
  // read slot id's exact state (Int32Array G·G·4: Are, Aim, Bre, Bim per cell) — tests and hashes
  xsRead(id) { const gl = this._gl, G = this._G, s = this._xsSlots && this._xsSlots[id]; if (!s) return null; const out = new Int32Array(G * G * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.src === 'A' ? s.fA : s.fB); gl.readPixels(0, 0, G, G, gl.RGBA_INTEGER, gl.INT, out); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return out; }

  // ── MIXED-RADIX FFT (Stockham) on the active eye buffer ─────────────────────────────────────────────
  // factor(G): largest-radix-first stage sequence, base radix 16 — MIRRORS mixed-radix-core.js factor().
  _fftFactors(G) {
    if (this._fftFacCache && this._fftFacCache.G === G) return this._fftFacCache.f;
    const f = []; let n = G;
    for (const r of [16, 8, 4, 2]) { while (n % r === 0 && n > 1) { f.push(r); n /= r; } }
    if (n > 1) f.push(n);   // any leftover prime (shouldn't happen for power-of-two)
    this._fftFacCache = { G, f };
    return f;
  }
  // ── STATE-PARAMETRIC FFT — operates on a ping-pong state {A,fA,B,fB,src} so it can drive ANY field
  //    (the eye buffer OR the spectral scratch fields), not just _eyeA/_eyeB. Each pass reads st's src
  //    texture, writes the other, flips st.src. ────────────────────────────────────────────────────────
  _fftPermPassS(st, axis, factors) {
    const gl = this._gl, G = this._G;
    const src = st.src === 'A' ? st.A : st.B, fbo = st.src === 'A' ? st.fB : st.fA;
    const u = this._u.fftPerm;
    const fac = new Int32Array(8); for (let i = 0; i < factors.length && i < 8; i++) fac[i] = factors[i];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progFftPerm);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.axis, axis); gl.uniform1i(u.G, G);
    gl.uniform1i(u.nfac, factors.length); gl.uniform1iv(u.fac, fac);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    st.src = st.src === 'A' ? 'B' : 'A';
  }
  _fftStagePassS(st, axis, radix, len, sign) {
    const gl = this._gl, G = this._G;
    const src = st.src === 'A' ? st.A : st.B, fbo = st.src === 'A' ? st.fB : st.fA;
    const u = this._u.fftStage;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progFftStage);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.axis, axis); gl.uniform1i(u.radix, radix);
    gl.uniform1i(u.len, len); gl.uniform1i(u.G, G); gl.uniform1f(u.sign, sign);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    st.src = st.src === 'A' ? 'B' : 'A';
  }
  // FULL 2D FFT on a state field. inv=false forward. Rows then cols (matches mixedRadix2d). 1/N once if inv.
  //   fftBench(n) — the eye slot's 2D transform, forward + inverse n times each way, gl.finish-timed: { ms per transform, max|Δ| of the round trip }
  fftBench(n = 20) { const gl = this._gl, G = this._G, self = this, st = { get A() { return self._eyeA; }, get fA() { return self._fboEyeA; }, get B() { return self._eyeB; }, get fB() { return self._fboEyeB; }, get src() { return self._eyeSrc; }, set src(v) { self._eyeSrc = v; } };
    const before = this.readEyePsi(); gl.finish(); const t0 = performance.now(); for (let k = 0; k < n; k++) { this._fft2dS(st, false); this._fft2dS(st, true); } gl.finish(); const ms = (performance.now() - t0) / (2 * n);
    const after = this.readEyePsi(); let d = 0, mx = 0; for (let i = 0; i < after.length; i++) { d = Math.max(d, Math.abs(after[i] - before[i])); mx = Math.max(mx, Math.abs(before[i])); } return { ms, roundTrip: d / Math.max(mx, 1e-30) }; }
  //   THE NATIVE SELF-SORTING FFT (2026-10-20, opt-in: this._fftStockham — off unless an app sets it): the medium's own operations fused,
  //   radix 16 / 8 / 4 / 2 (the same factors as _fftFactors) — each stage ONE pass: an output cell gathers its r inputs through the radix-r
  //   IFS shuffle (x[q + s·(p + j·m)]), meets the r-way coupler (the r-th roots, a uniform table) and its phase plate (e^{∓2πi·pk/n}), and is
  //   written in NATURAL order: no reordering pass; the inverse's 1/(G·G) folds into the last stage. Same conventions as below.
  //   (radix up to 32, 2026-10-20: the FEWEST passes, the bits split evenly — G 512 = 32·16, 2 passes an axis instead of 16·16·2; G 64 = 8·8)
  _stkFactors(G) { if (this._stkFac && this._stkFac.G === G) return this._stkFac.f; let n = 0; while ((1 << n) < G) n++;
    if ((1 << n) !== G || n === 0) return this._fftFactors(G);
    const p = Math.ceil(n / 5), f = []; let left = n; for (let i = p; i > 0; i--) { const b = Math.ceil(left / i); f.push(1 << b); left -= b; }
    this._stkFac = { G, f }; return f; }
  _fft2dStockham(st, inv) { const gl = this._gl, G = this._G, factors = this._stkFactors(G), sg = inv ? 1 : -1;
    if (!this._stkP) { const p = this._compileStep(this._stkSrc = `#version 300 es
precision highp float;
uniform sampler2D u_src; uniform int u_axis, u_r, u_m, u_s, u_n; uniform float u_sg, u_scale; uniform vec2 u_root[32]; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int oi = u_axis == 0 ? c.x : c.y, q = oi % u_s, t = oi / u_s, k = t % u_r, p = t / u_r; vec2 acc = vec2(0.0);
  for (int j = 0; j < 32; j++) { if (j >= u_r) break; int ii = q + u_s * (p + j * u_m); vec2 x = texelFetch(u_src, u_axis == 0 ? ivec2(ii, c.y) : ivec2(c.x, ii), 0).xy; vec2 w = u_root[(j * k) % u_r]; w.y *= u_sg;
    acc += vec2(x.x * w.x - x.y * w.y, x.x * w.y + x.y * w.x); }
  float a = u_sg * 6.283185307179586 * float(p * k) / float(u_n); vec2 tw = vec2(cos(a), sin(a)); o = vec4(u_scale * vec2(acc.x * tw.x - acc.y * tw.y, acc.x * tw.y + acc.y * tw.x), 0.0, 1.0); }`), ul = (n) => gl.getUniformLocation(p, n);
      this._stkP = { p, u: { src: ul('u_src'), axis: ul('u_axis'), r: ul('u_r'), m: ul('u_m'), s: ul('u_s'), n: ul('u_n'), sg: ul('u_sg'), scale: ul('u_scale'), root: ul('u_root') }, roots: {}, src: this._stkSrc }; }
    const P = this._stkP, rootsOf = (r) => P.roots[r] || (P.roots[r] = Float32Array.from({ length: 64 }, (_, i) => { const j = i >> 1; if (j >= r) return 0; const a = 2 * Math.PI * j / r; return i & 1 ? Math.sin(a) : Math.cos(a); }));   // e^{+2πij/r} (the sign by u_sg)
    //   (optional, 2026-10-28 — this._stkPrecomp; off unless an app sets it): ONE program per pass configuration (axis, stage, direction, the last inverse's
    //   1/(G·G)) with its uniforms set ONCE — a program keeps its uniform state — so a pass only binds and draws: the same shader, the same values, the
    //   same bits; MEASURED uniform uploads were a third of the main thread at G 128 (8 uniforms + a 64-float root table per pass, 16 passes a sub-step).
    if (this._stkPrecomp) { P.v ||= new Map(); for (const axis of (this._stkAxes || [0, 1])) { let n = G, s = 1; factors.forEach((r, idx) => { const m = n / r, last = axis === 1 && idx === factors.length - 1, sc = inv && last ? 1 / (G * G) : 1, key = G + "|" + axis + "|" + idx + "|" + sg + "|" + sc;
        let v = P.v.get(key); if (!v) { const p2 = this._compileStep(P.src), ul = (q) => gl.getUniformLocation(p2, q); gl.useProgram(p2); gl.uniform1i(ul('u_src'), 0); gl.uniform1i(ul('u_axis'), axis); gl.uniform1i(ul('u_r'), r); gl.uniform1i(ul('u_m'), m); gl.uniform1i(ul('u_s'), s); gl.uniform1i(ul('u_n'), n); gl.uniform1f(ul('u_sg'), sg); gl.uniform1f(ul('u_scale'), sc); gl.uniform2fv(ul('u_root'), rootsOf(r)); v = p2; P.v.set(key, v); }
        const src = st.src === 'A' ? st.A : st.B, fbo = st.src === 'A' ? st.fB : st.fA; this._nlPass(v, fbo, [src], () => {}); st.src = st.src === 'A' ? 'B' : 'A'; n = m; s *= r; }); } return; }
    for (const axis of (this._stkAxes || [0, 1])) { let n = G, s = 1; factors.forEach((r, idx) => { const m = n / r, last = axis === 1 && idx === factors.length - 1, src = st.src === 'A' ? st.A : st.B, fbo = st.src === 'A' ? st.fB : st.fA;
        this._nlPass(P.p, fbo, [src], () => { gl.uniform1i(P.u.src, 0); gl.uniform1i(P.u.axis, axis); gl.uniform1i(P.u.r, r); gl.uniform1i(P.u.m, m); gl.uniform1i(P.u.s, s); gl.uniform1i(P.u.n, n); gl.uniform1f(P.u.sg, sg); gl.uniform1f(P.u.scale, inv && last ? 1 / (G * G) : 1); gl.uniform2fv(P.u.root, rootsOf(r)); });
        st.src = st.src === 'A' ? 'B' : 'A'; n = m; s *= r; }); } }
  //   _fftFrom(srcTex, S, dstFbo) — the forward Stockham FFT READING srcTex (its first pass) through the scratch pair S, its last pass written
  //   to dstFbo (null: the result stays in S, S.src names it). It replaces "copy srcTex → S; FFT; copy → dst": the copies were exact, so the
  //   same passes give the same bits. Only under _fftDirect (optional, 2026-10-22) with the Stockham driver on both axes (_fftDirectOK).
  _fftDirectOK() { return !!((this._fftDirect || this._probeDirect) && this._fftStockham && !this._stkAxes); }
  _fftFrom(srcTex, S, dstFbo = null) { const nP = 2 * this._stkFactors(this._G).length; let k = 0;
    const D = { _s: 'A', get src() { return this._s; }, set src(v) { this._s = v; k++; },
      get A() { return k === 0 ? srcTex : S.A; }, get B() { return S.B; }, get fA() { return dstFbo && k === nP - 1 ? dstFbo : S.fA; }, get fB() { return dstFbo && k === nP - 1 ? dstFbo : S.fB; } };
    this._fft2dStockham(D, false); S.src = D.src; }
  _fft2dS(st, inv) { if (this._fftStockham) return this._fft2dStockham(st, inv);
    const gl = this._gl, G = this._G, sign = inv ? 1.0 : -1.0, factors = this._fftFactors(G);
    for (let axis = 0; axis < 2; axis++) {
      this._fftPermPassS(st, axis, factors);
      let len = 1; for (const r of factors) { this._fftStagePassS(st, axis, r, len, sign); len *= r; }
    }
    if (inv) {
      const src = st.src === 'A' ? st.A : st.B, fbo = st.src === 'A' ? st.fB : st.fA, u = this._u.fftNorm;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
      gl.useProgram(this._progFftNorm);
      gl.uniform1i(u.psi, 0); gl.uniform1f(u.inv, 1.0 / (G * G));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      st.src = st.src === 'A' ? 'B' : 'A';
    }
  }
  fftEye(inv) {
    const self = this;
    const st = { get A(){return self._eyeA;}, get fA(){return self._fboEyeA;}, get B(){return self._eyeB;}, get fB(){return self._fboEyeB;}, get src(){return self._eyeSrc;}, set src(v){self._eyeSrc=v;} };
    this._fft2dS(st, inv);
  }
  // upload a λ(k) texture (Float64Array(2N) re,im) for the spectral propagator block.
  setLamField(lam64) {
    const gl = this._gl, G = this._G, N = G * G;
    if (!this._lamTex) { this._lamTex = this._makeRGF32Tex(); }
    const f32 = new Float32Array(N * 2); for (let i = 0; i < N * 2; i++) f32[i] = lam64[i];
    gl.bindTexture(gl.TEXTURE_2D, this._lamTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  // lazily allocate the spectral scratch: R and I ping-pong pairs + one draw helper.
  _ensureSpec() {
    if (this._specR) return;
    const [rA, frA] = this._makePsiTex(), [rB, frB] = this._makePsiTex();
    const [iA, fiA] = this._makePsiTex(), [iB, fiB] = this._makePsiTex();
    this._specR = { A: rA, fA: frA, B: rB, fB: frB, src: 'A' };
    this._specI = { A: iA, fA: fiA, B: iB, fB: fiB, src: 'A' };
  }
  _ensureAttSpec() {
    if (this._specAr) return;
    const [rA, frA] = this._makePsiTex(), [rB, frB] = this._makePsiTex();
    const [iA, fiA] = this._makePsiTex(), [iB, fiB] = this._makePsiTex();
    this._specAr = { A: rA, fA: frA, B: rB, fB: frB, src: 'A' };   // FFT(att.re)
    this._specAi = { A: iA, fA: fiA, B: iB, fB: fiB, src: 'A' };   // FFT(att.im)
  }
  // Stage the CURRENT att (the _obj texture set by setObjField) into its spectrum, in the SAME split+FFT layout as
  //   stepEyeSpectral's ψ (Re→_specAr, Im→_specAi). Call ONCE when the att changes (a lock event / att-phase beat),
  //   not per step — the spectral spring then blends toward these cached buffers. keyed by u_attSpecKey.
  setSpringAtt() {
    const gl = this._gl, G = this._G;
    this._ensureAttSpec();
    const Ar = this._specAr, Ai = this._specAi;
    Ar.src = 'A'; Ai.src = 'A';
    // split _obj → (Re,0)/(Im,0), then forward-FFT each (matches steps 1-2 of stepEyeSpectral)
    this._drawPass(this._progFftSplit, this._u.fftSplit, [this._obj], Ar.fA, (u) => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.part, 0); });
    this._drawPass(this._progFftSplit, this._u.fftSplit, [this._obj], Ai.fA, (u) => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.part, 1); });
    this._fft2dS(Ar, false); this._fft2dS(Ai, false);
    this._attSpecReady = true;
  }
  // one full-screen pass: bind `prog`, set uniforms via cb(u), read `srcs` (array of textures on TEXTURE0..),
  //   draw into `fbo`. A tiny helper for the split/block/merge passes.
  _drawPass(prog, u, srcs, fbo, cb) {
    const gl = this._gl, G = this._G;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(prog); cb(u);
    for (let t = 0; t < srcs.length; t++) { gl.activeTexture(gl.TEXTURE0 + t); gl.bindTexture(gl.TEXTURE_2D, srcs[t]); }
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // ONE spectral step on the active eye buffer — the FAITHFUL mixedRadixPropagate (T=1) two-field 2×2 block.
  //   split → FFT(R), FFT(I) → 2×2 block → IFFT(R'), IFFT(I') → merge. GPU port verified vs CPU (f64) headless.
  stepEyeSpectral(dt, springK = 0) { if (!this._lamTex) return; this._spectralPass(dt, springK, this._lamTex, 1); }   // no λ uploaded → nothing to propagate
  //   stepEyeJump(T, dt) — T LINEAR steps (stepEyeN's leapfrog of the rings set) in ONE spectral pass: per mode the one-step map M has det 1, so
  //   M^T = α·I + β·N by binary powering in the block shader (log₂T multiplies) — the same map stepEyeN iterates, its λ = kernelLambdaGrid of
  //   the rings (a texture of its own: ahc's λ cache is untouched). ~30 draws instead of 3·T; short runs keep stepEyeN. Linear only: nothing may
  //   act between the steps (no SPM, no injection) — exactly stepEyeN's contract.
  stepEyeJump(T, dt) { T = T | 0; if (T <= 0) return;
    if (T < 2 || this._eyeScissor || !this._ringOffs || !this._progFftBlock || !this._u.fftBlock.T) { this._stepEyeLoop(T, dt); return; }
    //   λ per RING CONTENT (2026-10-21): the views set their cycle's rings each draw and the stepping sets its own back, so a version count
    //   changed every frame and λ (kernelLambdaGrid, G² on the CPU) was rebuilt every frame — MEASURED 13 % of the main thread in ◉ rec at G 256.
    //   The same rings give the same λ: the last 8 ring sets keep their textures.
    const _jm = this._lamJMemo || (this._lamJMemo = new Map()), _jk = this._ringKey, _jt = _jk ? _jm.get(_jk) : null;
    if (_jt) { this._lamTexJ = _jt; this._lamJVer = this._ringVer; }
    if (this._lamJVer !== this._ringVer) { if (_jk) { this._lamTexJ = null; if (_jm.size >= 8) { const [k0, t0] = _jm.entries().next().value; this._gl.deleteTexture(t0); _jm.delete(k0); } }
      const G = this._G, N = G * G, L = kernelLambdaGrid(this._ringRadii, this._ringW, this._ringOffs, G), f32 = new Float32Array(2 * N);
      for (let i = 0; i < N; i++) { f32[2 * i] = L.re[i]; f32[2 * i + 1] = L.im[i]; }
      const gl = this._gl; if (!this._lamTexJ) this._lamTexJ = this._makeRGF32Tex(); gl.bindTexture(gl.TEXTURE_2D, this._lamTexJ); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32); gl.bindTexture(gl.TEXTURE_2D, null);
      this._lamJVer = this._ringVer; if (_jk) _jm.set(_jk, this._lamTexJ); }
    this._spectralPass(dt, 0, this._lamTexJ, T); }
  //   stepEyeJumpLam(lam, T, dt) — the same T-step spectral jump with ANY operator's λ ({ re, im }, G²): its texture made once per λ object
  //   (a WeakMap — the app's operators are memoised), so a lens through another medium (an ideal GRIN drift, a ✿ genome glass) runs on the GPU too
  stepEyeJumpLam(lam, T, dt) { T = T | 0; if (T <= 0 || !lam || !lam.re || !this._progFftBlock) return false; const gl = this._gl, G = this._G, N = G * G;
    if (!this._lamTexW) this._lamTexW = new WeakMap(); let t = this._lamTexW.get(lam);
    if (!t) { const f = new Float32Array(2 * N); for (let i = 0; i < N; i++) { f[2 * i] = +lam.re[i] || 0; f[2 * i + 1] = lam.im ? (+lam.im[i] || 0) : 0; } t = this._makeRGF32Tex(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); this._lamTexW.set(lam, t); }
    this._spectralPass(dt, 0, t, T); return true; }
  //   THE COMPLEX SPECTRAL STEP (2026-10-20, opt-in: this._specComplex — AHC on): R = Re ψ and I = Im ψ are REAL, so both spectra come from
  //   ONE transform: R̂(k) = (ψ̂(k) + ψ̂*(−k))/2, Î(k) = (ψ̂(k) − ψ̂*(−k))/(2i). One pass applies the same 2×2 block (GLSL_FFT_BLOCK's) and
  //   writes R̂' + i·Î', and ONE inverse transform is ψ' = R' + i·I' (linearity). 2 transforms + 1 pass on the eye itself instead of 4 + split,
  //   2 block passes and merge on scratch fields (G 128: 9 passes a step, was 21). The spring keeps the two-field path.
  _spectralPassC(dt, lamTex, T) { const gl = this._gl, G = this._G, self = this;
    if (!this._blkC) { const p = this._compileStep(GLSL_FFT_BLOCKC), ul = (n) => gl.getUniformLocation(p, n); this._blkC = { p, u: { hat: ul('u_hat'), lam: ul('u_lam'), dt: ul('u_dt'), T: ul('u_T'), G: ul('u_G') } }; }
    const st = { get A() { return self._eyeA; }, get fA() { return self._fboEyeA; }, get B() { return self._eyeB; }, get fB() { return self._fboEyeB; }, get src() { return self._eyeSrc; }, set src(v) { self._eyeSrc = v; } };
    this._fft2dS(st, false);
    const B = this._blkC, hat = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._nlPass(B.p, fbo, [hat, lamTex], () => { gl.uniform1i(B.u.hat, 0); gl.uniform1i(B.u.lam, 1); gl.uniform1f(B.u.dt, dt); gl.uniform1i(B.u.T, T | 0); gl.uniform1i(B.u.G, G); });
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
    if (this._specPost) { const q = this._specPost; this._specPost = null; this.applyEyePhaseTex(q.tex, q.s); this._specPostUsed = true; }   // (optional, 2026-10-28; inert unless set: a k-diagonal phase e^{i·s·Θ} in the step's OWN dual, before its inverse transform — saves a caller's separate FFT pair)
    this._fft2dS(st, true); }
  _spectralPass(dt, springK, lamTex, T) {
    const gl = this._gl, G = this._G;
    if (this._specComplex && !(springK > 0 && this._attSpecReady && this._specAr)) return this._spectralPassC(dt, lamTex, T);
    this._ensureSpec();
    const eye = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const eyeFbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;   // where the merged result lands
    const R = this._specR, I = this._specI;
    // 1) split Re/Im into the two real scratch fields (reset src to A)
    R.src = 'A'; I.src = 'A';
    this._drawPass(this._progFftSplit, this._u.fftSplit, [eye], R.fA, (u) => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.part, 0); });
    this._drawPass(this._progFftSplit, this._u.fftSplit, [eye], I.fA, (u) => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.part, 1); });
    // 2) forward FFT each (leaves the result in R.src / I.src current texture)
    this._fft2dS(R, false); this._fft2dS(I, false);
    const Rh = R.src === 'A' ? R.A : R.B, Ih = I.src === 'A' ? I.A : I.B;
    // 3) 2×2 block: write R̂' into the OTHER R buffer, Î' into the OTHER I buffer (read both, no in-place hazard)
    const RhOutFbo = R.src === 'A' ? R.fB : R.fA, IhOutFbo = I.src === 'A' ? I.fB : I.fA;
    this._drawPass(this._progFftBlock, this._u.fftBlock, [Rh, Ih, lamTex], RhOutFbo, (u) => { gl.uniform1i(u.rhat,0); gl.uniform1i(u.ihat,1); gl.uniform1i(u.lam,2); gl.uniform1f(u.dt,dt); if (u.T) gl.uniform1i(u.T, T | 0); gl.uniform1i(u.which,0); });
    this._drawPass(this._progFftBlock, this._u.fftBlock, [Rh, Ih, lamTex], IhOutFbo, (u) => { gl.uniform1i(u.rhat,0); gl.uniform1i(u.ihat,1); gl.uniform1i(u.lam,2); gl.uniform1f(u.dt,dt); if (u.T) gl.uniform1i(u.T, T | 0); gl.uniform1i(u.which,1); });
    R.src = R.src === 'A' ? 'B' : 'A'; I.src = I.src === 'A' ? 'B' : 'A';
    // 3b) SPECTRAL SPRING (optional): R̂ ← R̂ + k·(Âr − R̂), Î ← Î + k·(Âi − Î) — the momentum-space soft lock
    //   toward the att's spectrum (faithful to the CPU spring). Needs setSpringAtt() staged (att spectrum cached).
    if (springK > 0 && this._attSpecReady && this._specAr) {
      const Ar = this._specAr, Ai = this._specAi;
      const Rc = R.src === 'A' ? R.A : R.B, RoFbo = R.src === 'A' ? R.fB : R.fA;
      const Ic = I.src === 'A' ? I.A : I.B, IoFbo = I.src === 'A' ? I.fB : I.fA;
      const Arc = Ar.src === 'A' ? Ar.A : Ar.B, Aic = Ai.src === 'A' ? Ai.A : Ai.B;
      this._drawPass(this._progFftSpring, this._u.fftSpring, [Rc, Arc], RoFbo, (u) => { gl.uniform1i(u.hat,0); gl.uniform1i(u.ahat,1); gl.uniform1f(u.k, springK); });
      this._drawPass(this._progFftSpring, this._u.fftSpring, [Ic, Aic], IoFbo, (u) => { gl.uniform1i(u.hat,0); gl.uniform1i(u.ahat,1); gl.uniform1f(u.k, springK); });
      R.src = R.src === 'A' ? 'B' : 'A'; I.src = I.src === 'A' ? 'B' : 'A';
    }
    // 4) inverse FFT each
    this._fft2dS(R, true); this._fft2dS(I, true);
    const Rf = R.src === 'A' ? R.A : R.B, If = I.src === 'A' ? I.A : I.B;
    // 5) merge → ψ' = (Re from R, Re from I) into the eye's other buffer, then flip _eyeSrc
    this._drawPass(this._progFftMerge, this._u.fftMerge, [Rf, If], eyeFbo, (u) => { gl.uniform1i(u.rfield,0); gl.uniform1i(u.ifield,1); });
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }
  // SMOKE TEST helper: upload psi64 to the default eye buffer, forward-FFT it, read back (Float64Array(2N)).
  fftForwardReadback(psi64) {
    this.selectEyeSlot(null);
    this.setEyePsiBoth(psi64);
    this.fftEye(false);
    return this.readEyePsi();
  }
  // SPECTRAL-STEP SMOKE TEST: upload psi64, run ONE stepEyeSpectral(dt), read back. Caller compares to CPU
  //   mixedRadixPropagate. Needs setLamField() called first.
  spectralStepReadback(psi64, dt) {
    this.selectEyeSlot(null);
    this.setEyePsiBoth(psi64);
    this.stepEyeSpectral(dt);
    return this.readEyePsi();
  }

  // ── Public: COEVOLVE superpose ψ_eye += β·obj (GPU). obj = the _obj texture (set via setObjField). One shader pass, ping-pongs the eye buffer.
  applyEyeSuperpose(beta) {
    const gl = this._gl, G = this._G; this._scB();
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.eyeSuperpose;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progEyeSuperpose);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.obj, 1); gl.uniform1f(u.beta, beta);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._obj);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._scE();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }
  // ── META LIGHT (optional, 2026-10-22): a light source added at EVERY sub-step with its own exact coefficient — the app keeps up to 6 unit
  //   patterns per key (srcTexSet: channel k, Float32 RG 2·G²) and adds ψ += Σ c_k·T_k (srcAdd: c = Float32Array(2·n), complex) in one pass on
  //   the active eye (scissored and ping-ponged like every eye pass). The pattern changes rarely (per beat at most); only c changes per sub-step.
  srcTexSet(key, k, f) { const gl = this._gl, G = this._G; this._srcT = this._srcT || {}; const S = this._srcT[key] || (this._srcT[key] = []); if (!S[k]) S[k] = this._makeRGF32Tex();
    gl.bindTexture(gl.TEXTURE_2D, S[k]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); }
  srcAdd(key, n, c) { const S = this._srcT && this._srcT[key]; n = Math.min(6, n | 0, S ? S.length : 0); if (!(n > 0)) return; const gl = this._gl, G = this._G;
    if (!this._srcP) { const p = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_t0, u_t1, u_t2, u_t3, u_t4, u_t5; uniform vec2 u_c[6]; uniform int u_n; out vec4 o;
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy;
  if (u_n > 0) v += cm(u_c[0], texelFetch(u_t0, q, 0).xy); if (u_n > 1) v += cm(u_c[1], texelFetch(u_t1, q, 0).xy); if (u_n > 2) v += cm(u_c[2], texelFetch(u_t2, q, 0).xy);
  if (u_n > 3) v += cm(u_c[3], texelFetch(u_t3, q, 0).xy); if (u_n > 4) v += cm(u_c[4], texelFetch(u_t4, q, 0).xy); if (u_n > 5) v += cm(u_c[5], texelFetch(u_t5, q, 0).xy);
  o = vec4(v, 0.0, 1.0); }`), ul = (nm) => gl.getUniformLocation(p, nm); this._srcP = { p, psi: ul('u_psi'), t: [0, 1, 2, 3, 4, 5].map((k) => ul('u_t' + k)), c: ul('u_c'), n: ul('u_n') }; }
    const P = this._srcP, src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, cc = new Float32Array(12); for (let k = 0; k < 2 * n; k++) cc[k] = +c[k] || 0;
    this._scB(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G); gl.useProgram(P.p); gl.uniform1i(P.psi, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    for (let k = 0; k < 6; k++) { gl.activeTexture(gl.TEXTURE1 + k); gl.bindTexture(gl.TEXTURE_2D, S[Math.min(k, n - 1)]); gl.uniform1i(P.t[k], 1 + k); }
    gl.uniform2fv(P.c, cc); gl.uniform1i(P.n, n); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    this._scE(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  // ── SELF-CLOCKED SOURCE (optional, 2026-10-22): ψ += β·T·z/|z| with z = ⟨T|ψ⟩ = Σ conj(T)·ψ — the pattern T (srcTexSet channel k) added at
  //   the phase the FIELD's own projection onto it has now, so the source keeps no clock of its own (it follows the medium's). z is reduced
  //   and used on the GPU (rows → one 1×1 texel → sampled by the add pass): nothing is read back. |z| ≈ 0 falls back to the unit phase c0; w ∈ [0, 1] hands the phase back to c0 (the unit phasor's normalised blend — a reverse handover).
  srcAddSelf(key, k, beta, c0, w = 0, pll = null, dly = null, maskId = null) {   /* (maskId, optional 2026-10-23: the injection × clamp(1 − S/0.8, 0, 1), S that id's guide texture — the pin fading where the structure has grown) */ const S = this._srcT && this._srcT[key], T = S && S[k | 0]; if (!T) return; const gl = this._gl, G = this._G; this.opCycleInit();
    if (!this._selfP) { const mk = (src) => { const p = this._compileStep(src); return { p, ul: (nm) => gl.getUniformLocation(p, nm) }; };
      const r = mk(`#version 300 es
precision highp float;
uniform sampler2D u_t, u_psi; uniform int u_G; out vec4 o;
void main() { int y = int(gl_FragCoord.y); vec2 s = vec2(0.0);
  for (int x = 0; x < u_G; x++) { ivec2 q = ivec2(x, y); vec2 t = texelFetch(u_t, q, 0).xy, v = texelFetch(u_psi, q, 0).xy; s += vec2(t.x * v.x + t.y * v.y, t.x * v.y - t.y * v.x); }
  o = vec4(s, 0.0, 1.0); }`), f = mk(`#version 300 es
precision highp float;
uniform sampler2D u_rows; uniform int u_G; out vec4 o;
void main() { vec2 s = vec2(0.0); for (int y = 0; y < u_G; y++) s += texelFetch(u_rows, ivec2(0, y), 0).xy; o = vec4(s, 0.0, 1.0); }`), a = mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_t, u_z, u_m; uniform float u_b, u_w, u_hm; uniform vec2 u_c0; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 z = texelFetch(u_z, ivec2(0), 0).xy, t = texelFetch(u_t, q, 0).xy; float m = length(z);
  vec2 u = m > 1e-30 ? z / m : u_c0; if (u_w > 0.0) { vec2 b = mix(u, u_c0, u_w); float lb = length(b); u = lb > 1e-6 ? b / lb : u_c0; } float mk = u_hm > 0.5 ? clamp(1.0 - texelFetch(u_m, q, 0).r / 0.8, 0.0, 1.0) : 1.0; o = vec4(texelFetch(u_psi, q, 0).xy + mk * u_b * vec2(t.x * u.x - t.y * u.y, t.x * u.y + t.y * u.x), 0.0, 1.0); }`);
      const zt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, zt); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, 1, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const zf = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, zf); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, zt, 0);
      this._selfP = { r, f, a, zt, zf }; }
    const P = this._selfP, src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, draw = () => { gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G); gl.useProgram(P.r.p); gl.uniform1i(P.r.ul('u_t'), 0); gl.uniform1i(P.r.ul('u_psi'), 1); gl.uniform1i(P.r.ul('u_G'), G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src); draw();
    gl.bindFramebuffer(gl.FRAMEBUFFER, P.zf); gl.viewport(0, 0, 1, 1); gl.useProgram(P.f.p); gl.uniform1i(P.f.ul('u_rows'), 0); gl.uniform1i(P.f.ul('u_G'), G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opDotTex); draw();
    const uz = pll ? this._pllStep(pll, P.zt, c0) : dly ? this._zDelay(dly, P.zf) : P.zt; if (pll) w = 0;   // (a delay: the add pass reads z from d sub-steps ago)   // (a PLL: the add pass reads the oscillator's phasor instead of z)
    this._scB(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G); gl.useProgram(P.a.p); gl.uniform1i(P.a.ul('u_psi'), 0); gl.uniform1i(P.a.ul('u_t'), 1); gl.uniform1i(P.a.ul('u_z'), 2);
    gl.uniform1f(P.a.ul('u_b'), +beta || 0); gl.uniform2f(P.a.ul('u_c0'), c0 ? +c0[0] || 0 : 1, c0 ? +c0[1] || 0 : 0); gl.uniform1f(P.a.ul('u_w'), Math.max(0, Math.min(1, +w || 0))); const _mt = maskId != null && this._gdTex ? this._gdTex.get(maskId) : null; gl.uniform1f(P.a.ul('u_hm'), _mt ? 1 : 0); gl.uniform1i(P.a.ul('u_m'), 3); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, _mt || T);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, uz); draw();
    gl.activeTexture(gl.TEXTURE0); this._scE(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  //   THE LOOP DELAY (optional, 2026-10-23 — Lang–Kobayashi): srcAddSelf's 8th argument dly = { id, d } — the source takes the phase z had d sub-steps
  //   AGO: a ring of past z per id (an R×1 RG32F texture; each sub-step's z copied in on the GPU, the delayed one copied out; nothing read back).
  //   Until the ring holds d samples there is no feedback yet (the fallback phase c0). zDelayDrop(id): forget it (a reseed / a new delay).
  _zDelay(o, zf) { const gl = this._gl, R = 1024; this._zR = this._zR || new Map(); let M = this._zR.get(o.id);
    const mk = (w) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, w, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, 1, gl.RG, gl.FLOAT, new Float32Array(2 * w)); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return [t, f]; };
    if (!M) { const [rt, rf] = mk(R), [dt] = mk(1); M = { rt, rf, dt, head: 0, n: 0 }; this._zR.set(o.id, M); }
    if (!zf) return M.dt; const d = Math.max(1, Math.min(R - 1, o.d | 0));
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, zf); gl.bindTexture(gl.TEXTURE_2D, M.rt); gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, M.head, 0, 0, 0, 1, 1);   // z now → the ring
    const col = (M.head - d + R) % R; gl.bindFramebuffer(gl.READ_FRAMEBUFFER, M.rf); gl.bindTexture(gl.TEXTURE_2D, M.dt);
    if (M.n >= d) gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, col, 0, 1, 1); else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RG, gl.FLOAT, new Float32Array(2));   // z d sub-steps ago (none yet: zero → c0)
    gl.bindTexture(gl.TEXTURE_2D, null); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); M.head = (M.head + 1) % R; M.n = Math.min(R, M.n + 1); return M.dt; }
  zDelayRead(id) { const M = this._zR && this._zR.get(id); if (!M) return null; const gl = this._gl, f = new Float32Array(2 * 1024); gl.bindFramebuffer(gl.FRAMEBUFFER, M.rf); gl.readPixels(0, 0, 1024, 1, gl.RG, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { ring: f, head: M.head, n: M.n }; }
  zDelaySet(id, o) { if (!o || !o.ring) return; const gl = this._gl; this._zR = this._zR || new Map(); let M = this._zR.get(id); if (!M) { this._zDelay({ id, d: 1 }, null); M = this._zR.get(id); M.head = 0; M.n = 0; }
    gl.bindTexture(gl.TEXTURE_2D, M.rt); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, 1, gl.RG, gl.FLOAT, Float32Array.from(o.ring).subarray(0, 2048)); gl.bindTexture(gl.TEXTURE_2D, null); M.head = (o.head | 0) % 1024; M.n = Math.min(1024, o.n | 0); }   // (the join seed: the ring, its head and fill)
  zDelayDrop(id) { const M = this._zR && this._zR.get(id); if (!M) return; const gl = this._gl; gl.deleteTexture(M.rt); gl.deleteTexture(M.dt); gl.deleteFramebuffer(M.rf); this._zR.delete(id); }
  //   THE MESSENGER (optional, 2026-10-23 — local AND delayed feedback): the source's phase from a messenger field f driven by q = T*·ψ and relaxing in
  //   time τ while it screens over a length w — kept in k-space and stepped exactly: f̂ ← (f̂ + a·q̂)/(1 + a·(1 + w²k²)), a = dt/τ (setMsgKernel kid:
  //   Float32Array G² of 1 + w²k²). Steady: f = q screened over w (a Yukawa kernel); dynamics: the long range (k → 0) arrives last (rate 1/τ), the
  //   local first — causal, like a diffusing carrier. ψ += β·T·f/|f| (c0 where |f| ≈ 0). msgDrop(id): forget it.
  setMsgKernel(kid, D) { this.setLocalKernel(kid, D); }
  srcAddMsg(key, k, beta, c0, id, kid, a) { const Sx = this._srcT && this._srcT[key], T = Sx && Sx[k | 0], Dt = this._lkT && this._lkT.get(kid); if (!T || !Dt) return; const gl = this._gl;
    if (!this._msgP) { const p = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_f, u_q, u_d; uniform float u_a; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); o = vec4((texelFetch(u_f, c, 0).xy + u_a * texelFetch(u_q, c, 0).xy) / (1.0 + u_a * texelFetch(u_d, c, 0).x), 0.0, 1.0); }`), ul = (n) => gl.getUniformLocation(p, 'u_' + n); this._msgP = { p, f: ul('f'), q: ul('q'), d: ul('d'), a: ul('a') };
      this._progCopyRG = this._progCopyRG || this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi; out vec4 o;
void main() { o = vec4(texelFetch(u_psi, ivec2(gl_FragCoord.xy), 0).xy, 0.0, 1.0); }`); this._uCopyRG = gl.getUniformLocation(this._progCopyRG, 'u_psi'); }
    this._lsInit();
    this._msg = this._msg || new Map(); let M = this._msg.get(id); if (!M) { const [A, fA] = this._makePsiTex(), [B, fB] = this._makePsiTex(); M = { A, fA, B, fB, cur: 'A' }; this._msg.set(id, M); this._glClear(M); }
    if (!this._nlS) { const [a2, fa] = this._makePsiTex(), [b2, fb] = this._makePsiTex(); this._nlS = { A: a2, fA: fa, B: b2, fB: fb, src: 'A' }; }
    const S = this._nlS, P = this._lsP, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    S.src = 'A'; this._nlPass(P.q.p, S.fA, [psi, T], () => { gl.uniform1i(P.q.u.psi, 0); gl.uniform1i(P.q.u.t, 1); }); this._fft2dS(S, false);   // q̂
    const qh = S.src === 'A' ? S.A : S.B, fIn = M.cur === 'A' ? M.A : M.B, fOut = M.cur === 'A' ? M.fB : M.fA, mp = this._msgP;
    this._nlPass(mp.p, fOut, [fIn, qh, Dt], () => { gl.uniform1i(mp.f, 0); gl.uniform1i(mp.q, 1); gl.uniform1i(mp.d, 2); gl.uniform1f(mp.a, Math.max(0, +a || 0)); }); M.cur = M.cur === 'A' ? 'B' : 'A';   // f̂ stepped
    const fh = M.cur === 'A' ? M.A : M.B; S.src = 'A'; this._nlPass(this._progCopyRG, S.fA, [fh], () => gl.uniform1i(this._uCopyRG, 0)); this._fft2dS(S, true);   // f in space
    const fx = S.src === 'A' ? S.A : S.B, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._scB(); this._nlPass(P.a.p, fbo, [psi, T, fx], () => { gl.uniform1i(P.a.u.psi, 0); gl.uniform1i(P.a.u.t, 1); gl.uniform1i(P.a.u.q, 2); gl.uniform1f(P.a.u.b, +beta || 0); gl.uniform2f(P.a.u.c0, c0 ? +c0[0] || 0 : 1, c0 ? +c0[1] || 0 : 0); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  //   THE LIGHT MESSENGER (optional, 2026-10-23 — N1 of the native feedback): the messenger IS LIGHT — a copy of the field travelling through the
  //   medium's own linear step: f̂ ← e^{−a}·K·f̂ + (1 − e^{−a})·ψ̂, K = e^{iθ_k} the medium's per-mode turn this step (setPropKernel kid: re, im G²),
  //   a = dt/τ its loss; then ψ += β·|T|·f/|f| — the symbol only as a SHAPE (an aperture: att·att*/|att| = |att|), the phase what the travelled light
  //   brings back (c0·T where |f| ≈ 0). Locality and delay from the medium's dispersion (no w); state per id in k-space (msgRead / msgSet / msgDrop).
  setPropKernel(kid, re, im) { const gl = this._gl, G = this._G; this._lkT = this._lkT || new Map(); let t = this._lkT.get(kid); if (!t) { t = this._makeRGF32Tex(); this._lkT.set(kid, t); }
    const f = new Float32Array(2 * G * G); for (let i = 0; i < G * G; i++) { f[2 * i] = +re[i] || 0; f[2 * i + 1] = +im[i] || 0; } gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); }
  srcAddProp(key, k, beta, c0, id, kid, a) { const Sx = this._srcT && this._srcT[key], T = Sx && Sx[k | 0], Kt = this._lkT && this._lkT.get(kid); if (!T || !Kt) return; const gl = this._gl; this._lsInit();
    if (!this._propP) { const mk = (src, names) => { const p = this._compileStep(src), u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, 'u_' + n); return { p, u }; };
      this._propP = { up: mk(`#version 300 es
precision highp float;
uniform sampler2D u_f, u_q, u_k; uniform float u_e, u_b; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 f = texelFetch(u_f, c, 0).xy, q = texelFetch(u_q, c, 0).xy, k = texelFetch(u_k, c, 0).xy;
  o = vec4(u_e * vec2(k.x * f.x - k.y * f.y, k.x * f.y + k.y * f.x) + u_b * q, 0.0, 1.0); }`, ['f', 'q', 'k', 'e', 'b']), add: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_t, u_f; uniform float u_bt; uniform vec2 u_c0; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 f = texelFetch(u_f, c, 0).xy, t = texelFetch(u_t, c, 0).xy; float m = length(f);
  vec2 inj = m > 1e-30 ? length(t) * f / m : vec2(t.x * u_c0.x - t.y * u_c0.y, t.x * u_c0.y + t.y * u_c0.x); o = vec4(texelFetch(u_psi, c, 0).xy + u_bt * inj, 0.0, 1.0); }`, ['psi', 't', 'f', 'bt', 'c0']) };
      this._progCopyRG = this._progCopyRG || this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi; out vec4 o;
void main() { o = vec4(texelFetch(u_psi, ivec2(gl_FragCoord.xy), 0).xy, 0.0, 1.0); }`); this._uCopyRG = gl.getUniformLocation(this._progCopyRG, 'u_psi'); }
    this._msg = this._msg || new Map(); let M = this._msg.get(id); if (!M) { const [A, fA] = this._makePsiTex(), [B, fB] = this._makePsiTex(); M = { A, fA, B, fB, cur: 'A' }; this._msg.set(id, M); this._glClear(M); }
    const S = this._nlS, P = this._propP, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, e = Math.exp(-Math.max(0, +a || 0));
    S.src = 'A'; this._nlPass(this._progCopyRG, S.fA, [psi], () => gl.uniform1i(this._uCopyRG, 0)); this._fft2dS(S, false);   // ψ̂
    const ph = S.src === 'A' ? S.A : S.B, fIn = M.cur === 'A' ? M.A : M.B, fOut = M.cur === 'A' ? M.fB : M.fA;
    this._nlPass(P.up.p, fOut, [fIn, ph, Kt], () => { gl.uniform1i(P.up.u.f, 0); gl.uniform1i(P.up.u.q, 1); gl.uniform1i(P.up.u.k, 2); gl.uniform1f(P.up.u.e, e); gl.uniform1f(P.up.u.b, 1 - e); }); M.cur = M.cur === 'A' ? 'B' : 'A';   // f̂ travelled one step
    const fh = M.cur === 'A' ? M.A : M.B; S.src = 'A'; this._nlPass(this._progCopyRG, S.fA, [fh], () => gl.uniform1i(this._uCopyRG, 0)); this._fft2dS(S, true);   // f in space
    const fx = S.src === 'A' ? S.A : S.B, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._scB(); this._nlPass(P.add.p, fbo, [psi, T, fx], () => { gl.uniform1i(P.add.u.psi, 0); gl.uniform1i(P.add.u.t, 1); gl.uniform1i(P.add.u.f, 2); gl.uniform1f(P.add.u.bt, +beta || 0); gl.uniform2f(P.add.u.c0, c0 ? +c0[0] || 0 : 1, c0 ? +c0[1] || 0 : 0); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  //   N2 — THE LIGHT TRAVELS THE STRUCTURE (optional, 2026-10-23): the messenger f (x-space, per id, the same store as msgRead) takes the medium's
  //   whole linear step INCLUDING the slot's written guide: f ← e^{−a}·e^{i·vdt·P}·F⁻¹[K·F f] + (1 − e^{−a})·ψ (K = e^{iθ_k} setPropKernel kid, P the
  //   guide texture of id, vdt = V·dt; kerr = { g: γ·dt, is }: the INDEX THE FIELD WRITES, γ·|ψ|²/(1 + |ψ|²/Is)·dt — cross-phase modulation: a probe in a Kerr
  //   medium feels the strong field's index, so the messenger's clock is the field's), and ψ += β·P·(f − ψ) — a PASSIVE external cavity through the structure as the coupling mask: light out, the travelled copy back;
  //   zero at resonance, a damping of what does not propagate as the structure says (MEASURED: the per-cell unit phase f/|f| pumped noisy phases into the
  //   skirt — 10–15 % shed; the ACTIVE linear β·P·f ran away with the gain and, capped, collapsed the letter into the single most-bound mode).
  srcAddPropS(id, beta, c0, kid, a, vdt, kerr = null) { const Pt = this._gdTex && this._gdTex.get(id), Kt = this._lkT && this._lkT.get(kid); if (!Pt || !Kt) return; const gl = this._gl; this._lsInit();
    if (!this._propS) { const mk = (src, names) => { const p = this._compileStep(src), u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, 'u_' + n); return { p, u }; };
      this._propS = { mul: mk(`#version 300 es
precision highp float;
uniform sampler2D u_f, u_k; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 f = texelFetch(u_f, c, 0).xy, k = texelFetch(u_k, c, 0).xy; o = vec4(k.x * f.x - k.y * f.y, k.x * f.y + k.y * f.x, 0.0, 1.0); }`, ['f', 'k']), mix: mk(`#version 300 es
precision highp float;
uniform sampler2D u_f, u_psi, u_p; uniform float u_e, u_v, u_g, u_is; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 f = texelFetch(u_f, c, 0).xy, w = texelFetch(u_psi, c, 0).xy; float I = dot(w, w), th = u_v * texelFetch(u_p, c, 0).r + u_g * I / (1.0 + I / u_is), cs = cos(th), sn = sin(th);
  o = vec4(u_e * vec2(cs * f.x - sn * f.y, cs * f.y + sn * f.x) + (1.0 - u_e) * texelFetch(u_psi, c, 0).xy, 0.0, 1.0); }`, ['f', 'psi', 'p', 'e', 'v', 'g', 'is']), add: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p, u_f; uniform float u_bt; uniform vec2 u_c0; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 f = texelFetch(u_f, c, 0).xy; float A = max(texelFetch(u_p, c, 0).r, 0.0);
  vec2 v = texelFetch(u_psi, c, 0).xy; o = vec4(v + u_bt * A * (f - v), 0.0, 1.0); }`, ['psi', 'p', 'f', 'bt', 'c0']) };
      this._progCopyRG = this._progCopyRG || this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi; out vec4 o;
void main() { o = vec4(texelFetch(u_psi, ivec2(gl_FragCoord.xy), 0).xy, 0.0, 1.0); }`); this._uCopyRG = gl.getUniformLocation(this._progCopyRG, 'u_psi'); }
    this._msg = this._msg || new Map(); let M = this._msg.get(id); if (!M) { const [A, fA] = this._makePsiTex(), [B, fB] = this._makePsiTex(); M = { A, fA, B, fB, cur: 'A' }; this._msg.set(id, M); this._glClear(M); }
    const S = this._nlS, P = this._propS, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, e = Math.exp(-Math.max(0, +a || 0));
    S.src = 'A'; this._nlPass(this._progCopyRG, S.fA, [M.cur === 'A' ? M.A : M.B], () => gl.uniform1i(this._uCopyRG, 0)); this._fft2dS(S, false);   // F f
    { const src = S.src === 'A' ? S.A : S.B, fbo = S.src === 'A' ? S.fB : S.fA; this._nlPass(P.mul.p, fbo, [src, Kt], () => { gl.uniform1i(P.mul.u.f, 0); gl.uniform1i(P.mul.u.k, 1); }); S.src = S.src === 'A' ? 'B' : 'A'; }   // × K
    this._fft2dS(S, true);   // back to space
    const fp = S.src === 'A' ? S.A : S.B, fOut = M.cur === 'A' ? M.fB : M.fA;
    this._nlPass(P.mix.p, fOut, [fp, psi, Pt], () => { gl.uniform1i(P.mix.u.f, 0); gl.uniform1i(P.mix.u.psi, 1); gl.uniform1i(P.mix.u.p, 2); gl.uniform1f(P.mix.u.e, e); gl.uniform1f(P.mix.u.v, +vdt || 0); gl.uniform1f(P.mix.u.g, kerr ? +kerr.g || 0 : 0); gl.uniform1f(P.mix.u.is, Math.max(1e-12, kerr ? +kerr.is || 1 : 1)); }); M.cur = M.cur === 'A' ? 'B' : 'A';   // × the well, lost, fed
    const fx = M.cur === 'A' ? M.A : M.B, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._scB(); this._nlPass(P.add.p, fbo, [psi, Pt, fx], () => { gl.uniform1i(P.add.u.psi, 0); gl.uniform1i(P.add.u.p, 1); gl.uniform1i(P.add.u.f, 2); gl.uniform1f(P.add.u.bt, +beta || 0); gl.uniform2f(P.add.u.c0, c0 ? +c0[0] || 0 : 1, c0 ? +c0[1] || 0 : 0); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  msgRead(id) { const M = this._msg && this._msg.get(id); if (!M) return null; const gl = this._gl, G = this._G, f = new Float32Array(2 * G * G); gl.bindFramebuffer(gl.FRAMEBUFFER, M.cur === 'A' ? M.fA : M.fB); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return f; }
  msgSet(id, f) { this._msg = this._msg || new Map(); let M = this._msg.get(id); if (!M) { const [A, fA] = this._makePsiTex(), [B, fB] = this._makePsiTex(); M = { A, fA, B, fB, cur: 'A' }; this._msg.set(id, M); } if (!f) { this._glClear(M); return; } const gl = this._gl, G = this._G; gl.bindTexture(gl.TEXTURE_2D, M.cur === 'A' ? M.A : M.B); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, Float32Array.from(f)); gl.bindTexture(gl.TEXTURE_2D, null); }
  msgDrop(id) { const M = this._msg && this._msg.get(id); if (!M) return; const gl = this._gl; for (const t of [M.A, M.B]) gl.deleteTexture(t); for (const f of [M.fA, M.fB]) gl.deleteFramebuffer(f); this._msg.delete(id); }
  //   LOCAL SELF-PHASE (optional, 2026-10-23): ψ += β·T·q̃/|q̃|, q̃ = K ⋆ (T*·ψ) — the source takes, cell by cell, the phase of the field's LOCAL
  //   projection on it, K a real k-space kernel (setLocalKernel kid: Float32Array G², K̂(0) = 1; a Gaussian of width w: w → ∞ the global overlap,
  //   w → 0 ψ += β·|T|·ψ/|ψ| — a saturable gain shaped by T). The convolution is the GPU's own FFT (the scratch pair). |q̃| ≈ 0 falls back to c0.
  setLocalKernel(kid, K) { const gl = this._gl, G = this._G; this._lkT = this._lkT || new Map(); let t = this._lkT.get(kid); if (!t) { t = this._makeRGF32Tex(); this._lkT.set(kid, t); }
    const f = new Float32Array(2 * G * G); for (let i = 0; i < G * G; i++) f[2 * i] = +K[i] || 0; gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); }
  _lsInit() { const gl = this._gl; if (!this._lsP) { const mk = (src, names) => { const p = this._compileStep(src), u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, 'u_' + n); return { p, u }; };
      this._lsP = { q: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_t; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 t = texelFetch(u_t, q, 0).xy, v = texelFetch(u_psi, q, 0).xy; o = vec4(t.x * v.x + t.y * v.y, t.x * v.y - t.y * v.x, 0.0, 1.0); }`, ['psi', 't']), a: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_t, u_q; uniform float u_b; uniform vec2 u_c0; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 z = texelFetch(u_q, q, 0).xy, t = texelFetch(u_t, q, 0).xy; float m = length(z); vec2 u = m > 1e-30 ? z / m : u_c0;
  o = vec4(texelFetch(u_psi, q, 0).xy + u_b * vec2(t.x * u.x - t.y * u.y, t.x * u.y + t.y * u.x), 0.0, 1.0); }`, ['psi', 't', 'q', 'b', 'c0']) }; }
    if (!this._nlS) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); this._nlS = { A: a, fA: fa, B: b, fB: fb, src: 'A' }; }
  }
  srcAddLocal(key, k, beta, c0, kid) { const Sx = this._srcT && this._srcT[key], T = Sx && Sx[k | 0], Kt = this._lkT && this._lkT.get(kid); if (!T || !Kt) return; const gl = this._gl; this._lsInit();
    const S = this._nlS, P = this._lsP, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    S.src = 'A'; this._nlPass(P.q.p, S.fA, [psi, T], () => { gl.uniform1i(P.q.u.psi, 0); gl.uniform1i(P.q.u.t, 1); });
    this._fft2dS(S, false);
    { const src = S.src === 'A' ? S.A : S.B, fbo = S.src === 'A' ? S.fB : S.fA, u = this._u.mulK; this._nlPass(this._progMulK, fbo, [src, Kt], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.k, 1); }); S.src = S.src === 'A' ? 'B' : 'A'; }
    this._fft2dS(S, true);
    const qb = S.src === 'A' ? S.A : S.B, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._scB(); this._nlPass(P.a.p, fbo, [psi, T, qb], () => { gl.uniform1i(P.a.u.psi, 0); gl.uniform1i(P.a.u.t, 1); gl.uniform1i(P.a.u.q, 2); gl.uniform1f(P.a.u.b, +beta || 0); gl.uniform2f(P.a.u.c0, c0 ? +c0[0] || 0 : 1, c0 ? +c0[1] || 0 : 0); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  //   THE PLL (optional, 2026-10-23): srcAddSelf's 7th argument pll = { id, mode, kp, ki, kf, sl, dt, init, w0 } makes the source's phase an OSCILLATOR —
  //   its own state per id, a 2×1 RGBA32F texture ping-ponged on the GPU (nothing read back): texel 0 (cos, sin, Ω, ω_i), texel 1 the previous target
  //   phasor. A PHASE-FREQUENCY loop: the target is z (mode 0: the field's projection) or c0 (mode 1: an external reference); e = arg(target · ū) the
  //   phase error, f = arg(target · prev̄)/dt the target's frequency (the frequency detector — pull-in at any offset: a phase-only loop slips cycles
  //   when the offset ≫ its bandwidth); ω_i += (ki·e + kf·(f − ω_i))·dt; the oscillator's TUNING Ω slews toward ω_i by at most sl·dt
  //   (a bounded chirp) and u advances by (Ω + kp·e)·dt — the proportional path corrects PHASE directly (through the slewed frequency it made a limit
  //   cycle); far from lock (|Ω − ω_i| > kp) the phase terms are off (a slipping phase would undo the ramp). init 1: u = c0, 2: u = z/|z| (Ω = ω_i = w0). pllRead / pllSet / pllDrop: the state (a join seed ships it).
  _pllStep(o, zt, c0) { const gl = this._gl; if (!this._pllP) { const p = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_s, u_z; uniform int u_mode, u_init; uniform vec2 u_c0; uniform float u_kp, u_ki, u_kf, u_sl, u_dt, u_w0; out vec4 o;
void main() { vec4 S = texelFetch(u_s, ivec2(0, 0), 0); vec2 pv = texelFetch(u_s, ivec2(1, 0), 0).xy, z = texelFetch(u_z, ivec2(0), 0).xy; float mz = length(z);
  vec2 tg = u_mode == 0 ? z : u_c0; float mt = length(tg); vec2 tn = mt > 1e-30 ? tg / mt : vec2(1.0, 0.0);
  if (u_init == 1) S = vec4(u_c0, u_w0, u_w0); else if (u_init == 2) S = vec4(mz > 1e-30 ? z / mz : u_c0, u_w0, u_w0);
  if (u_init != 0 || length(pv) < 0.5) pv = tn;
  vec2 u = S.xy; float e = mt > 1e-30 ? atan(u.x * tn.y - u.y * tn.x, u.x * tn.x + u.y * tn.y) : 0.0, f = atan(pv.x * tn.y - pv.y * tn.x, pv.x * tn.x + pv.y * tn.y) / max(u_dt, 1e-9);
  bool far = abs(S.z - S.w) > u_kp; float wi = S.w + ((far ? 0.0 : u_ki * e) + u_kf * (f - S.w)) * u_dt, lim = u_sl * u_dt, W = S.z + clamp(wi - S.z, -lim, lim);
  float a = (W + (far ? 0.0 : u_kp * e)) * u_dt; vec2 un = vec2(u.x * cos(a) - u.y * sin(a), u.x * sin(a) + u.y * cos(a)); un /= max(length(un), 1e-30);
  o = int(gl_FragCoord.x) == 0 ? vec4(un, W, wi) : vec4(tn, 0.0, 0.0); }`), ul = (n) => gl.getUniformLocation(p, 'u_' + n);
      this._pllP = { p, u: Object.fromEntries(['s', 'z', 'mode', 'init', 'c0', 'kp', 'ki', 'kf', 'sl', 'dt', 'w0'].map((n) => [n, ul(n)])) }; }
    this._pll = this._pll || new Map(); let M = this._pll.get(o.id); if (!M) { M = this._pllMk(); this._pll.set(o.id, M); }
    const P = this._pllP, u = P.u, sIn = M.cur === 'A' ? M.A : M.B, fOut = M.cur === 'A' ? M.fB : M.fA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fOut); gl.viewport(0, 0, 2, 1); gl.useProgram(P.p); gl.uniform1i(u.s, 0); gl.uniform1i(u.z, 1); gl.uniform1i(u.mode, o.mode | 0); gl.uniform1i(u.init, o.init | 0); gl.uniform2f(u.c0, c0 ? +c0[0] || 0 : 1, c0 ? +c0[1] || 0 : 0);
    gl.uniform1f(u.kp, +o.kp || 0); gl.uniform1f(u.ki, +o.ki || 0); gl.uniform1f(u.kf, +o.kf || 0); gl.uniform1f(u.sl, Math.max(0, +o.sl || 0)); gl.uniform1f(u.dt, +o.dt || 0); gl.uniform1f(u.w0, +o.w0 || 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sIn); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, zt); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    M.cur = M.cur === 'A' ? 'B' : 'A'; return M.cur === 'A' ? M.A : M.B; }
  _pllMk() { const gl = this._gl, mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 2, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 1, gl.RGBA, gl.FLOAT, new Float32Array([1, 0, 0, 0, 0, 0, 0, 0])); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return [t, f]; };
    const [A, fA] = mk(), [B, fB] = mk(); return { A, fA, B, fB, cur: 'A' }; }
  pllRead(id) { const M = this._pll && this._pll.get(id); if (!M) return null; const gl = this._gl, f = new Float32Array(8); gl.bindFramebuffer(gl.FRAMEBUFFER, M.cur === 'A' ? M.fA : M.fB); gl.readPixels(0, 0, 2, 1, gl.RGBA, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return f; }
  pllSet(id, f) { if (!f || f.length < 4) return; const gl = this._gl; this._pll = this._pll || new Map(); let M = this._pll.get(id); if (!M) { M = this._pllMk(); this._pll.set(id, M); }
    const d = new Float32Array(8); for (let k = 0; k < Math.min(8, f.length); k++) d[k] = +f[k] || 0; gl.bindTexture(gl.TEXTURE_2D, M.cur === 'A' ? M.A : M.B); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 1, gl.RGBA, gl.FLOAT, d); gl.bindTexture(gl.TEXTURE_2D, null); }
  pllDrop(id) { const M = this._pll && this._pll.get(id); if (!M) return; const gl = this._gl; for (const t of [M.A, M.B]) gl.deleteTexture(t); for (const f of [M.fA, M.fB]) gl.deleteFramebuffer(f); this._pll.delete(id); }
  // ── Public: FULL-AUTHORITY HOLD contraction ψ ← (1−λ)ψ + λ·obj (GPU). obj = the _obj texture (setObjField).
  //    A contraction (not the additive superpose): |ψ−obj| shrinks ×(1−λ) per call → cross-GPU float divergence
  //    on the unpinned halo decays, restoring peer-determinism the way W's re-locking drive does. λ=1 = projection.
  applyEyeContract(lambda, neutral) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const dstFbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;   // the OTHER buffer's framebuffer
    const dstTex = this._eyeSrc === 'A' ? this._eyeB : this._eyeA;         // the OTHER buffer's texture
    const u = this._u.eyeContract;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progEyeContract);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.obj, 1); gl.uniform1f(u.lambda, lambda);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._obj);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    if (neutral) {
      // PARITY-NEUTRAL: the contraction wrote the result into dstTex. Copy it BACK into src (a GPU-side copy, NO readback)
      //   and LEAVE _eyeSrc unchanged → the ping-pong parity is NET-EVEN. A frame stall / console pause can't catch the
      //   pair at an odd parity (the flipping contraction was the intermittent post-pause fragility). src now holds the result.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, dstFbo);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, G, G);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // _eyeSrc unchanged (net-even parity)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
    }
  }
  // ── Public: COEVOLVE energy-cap ψ *= sqrt(targetE / E) (GPU). E = Σ|ψ|² via a row-reduce → 1×1 readback (G floats, not G²) → scale shader.
  //    Far cheaper than the full-grid readback+JS-loop: one tiny scalar comes back, the scale stays on GPU.
  applyEyeEnergyCap(targetE) {
    const gl = this._gl, G = this._G;
    this.opCycleInit();   // ensure the reduction scratch/FBOs exist (idempotent)
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    // E = Σ|ψ|² (re²+im²): row-reduce → _opDotTex → col-finish → 1×1 scalar → read G... actually 1 float (no full-grid readback)
    const ur = this._u.energyRows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G);
    gl.useProgram(this._progEnergyRows); gl.uniform1i(ur.a, 0); gl.uniform1i(ur.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._opColFinish('A');   // sum the G row-sums → 1×1 scalar slot A
    const sf = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, this._opSclAFbo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, sf); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const E = sf[0]; if (!(E > 1e-9) || !(targetE > 0)) return;
    const s = Math.sqrt(targetE / E);
    const src2 = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.eyeScale;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    this._scB();
    gl.useProgram(this._progEyeScale);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.s, s);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src2);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._scE();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }
  // applyEyeScale(s) — ψ ← s·ψ, a plain LINEAR scalar multiply (no reduce, no readback). Used by the linear
  // SHARP TRAP: a fixed linear damping s=(1−leak) that balances the pin's injection at a sharp fixed point.
  applyEyeScale(s) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.eyeScale;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    this._scB();
    gl.useProgram(this._progEyeScale);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.s, s);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._scE();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }
  // applyEyePhaseTilt(om, kx, ky) — ψ ← ψ·e^{i·(om + kx·S(x) + ky·S(y))}, S(u) = (G/2π)·sin(2π(u−c0)/G) (periodic; ≈ u−c0 near the centre): global precession + momentum tilt.
  //   The mixedRadix-app stepField's precess+tilt, on the GPU (one per-pixel phase pass). c0=(G−1)/2.
  applyEyePhaseTilt(om, kx, ky, opts = null) {   // opts (2026-10-01): { m, cx, cy, trap, g, well, lin } — the k→field potential's parameters; null = the original tilt
    //   well = a static isotropic well (phase well·Q per axis, beside the k part) · lin = S = u−c exactly (the ⇥roll kick: k = 2π·m/G, integer m → periodic)
    if (!om && !kx && !ky && !opts?.well && !opts?.kernW) return;   // nothing to rotate
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.eyePhaseTilt;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    this._scB();
    gl.useProgram(this._progEyePhaseTilt);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.om, om); gl.uniform1f(u.kx, kx); gl.uniform1f(u.ky, ky); gl.uniform1f(u.c0, (G - 1) / 2);
    gl.uniform1f(u.m, opts?.m || 1); gl.uniform2f(u.cc, opts?.cx ?? (G - 1) / 2, opts?.cy ?? (G - 1) / 2); gl.uniform1f(u.trap, opts?.kern && this._potTex ? 3 : (opts?.lin ? 2 : (opts?.trap ? 1 : 0))); gl.uniform1f(u.g, opts?.g || 0); gl.uniform1f(u.well, opts?.well || 0); gl.uniform1f(u.kern, this._potTex ? (opts?.kernW || 0) : 0);
    //   u_pot MUST be set on EVERY draw: once pointed at unit 1 it stays there, and unit 1 may hold a texture another pass left — if that is
    //   THIS pass's render target, WebGL rejects the draw as a FEEDBACK LOOP (INVALID_OPERATION, the pass silently dropped: MEASURED 1256
    //   failed draws — tilt / trap / roll did nothing after the kernel was once used). Unused → unit 0, the source (as before the kernel).
    const _kernUse = !!((opts?.kern || opts?.kernW) && this._potTex);
    gl.uniform1i(u.pot, _kernUse ? 1 : 0);
    if (_kernUse) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._potTex); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._scE();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }
  //   setPotField(S) — a G×G real profile (Float32Array) for applyEyePhaseTilt's sampled mode (opts.kern): the app's IFS-native
  //   potential (its operator's Green's function). R32F, read with texelFetch (no filtering).
  setPotField(S) { const gl = this._gl, G = this._G; if (!S || S.length !== G * G) return; gl.activeTexture(gl.TEXTURE0);   // upload on unit 0 (every pass rebinds its source there)
    if (!this._potTex) { this._potTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this._potTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
    gl.bindTexture(gl.TEXTURE_2D, this._potTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, G, G, 0, gl.RED, gl.FLOAT, S); gl.bindTexture(gl.TEXTURE_2D, null); }
  //   setGuideField(id, S) / applyEyeGuide(id, w) — a slot's WRITTEN GUIDE (the app's ✍): its own R32F profile per id (slots share this GPU,
  //   so the guide cannot share the potential texture), applied by the same sampled phase pass: ψ ← ψ·e^{i·w·S}. S null drops the texture.
  setGuideField(id, S) { const gl = this._gl, G = this._G; this._gdTex = this._gdTex || new Map(); let t = this._gdTex.get(id);
    if (!S) { if (t) { gl.deleteTexture(t); this._gdTex.delete(id); } return; } if (S.length !== G * G) return;
    const keep = this._potTex; this._potTex = t || null; this.setPotField(S); this._gdTex.set(id, this._potTex); this._potTex = keep; }
  //   ✺ THE LIVE HOLOGRAM on the GPU (the app's _liveRecord, per sub-step): the slot's hologram V lives in an RG32F pair (.x = V) — the very texture
  //   applyEyeGuide samples (.r). liveInit(id, Rre, Rim, mask): the beam's spatial pattern (complex, its window; the time phase comes per step) and
  //   the k-space notch (1, 0 about the beam's bins), V reset to 0. liveStep(id, c, s, rate, eta): g = the field minus the beam's own peaks (copy,
  //   FFT, × notch, inverse), then V ← V + rate·(eta·I − V), I = −Im(conj(R·e^{iΦ})·g) — the energy-removing diffusion grating (c, s = cos Φ, sin Φ).
  liveInit(id, Rre, Rim, mask) { const gl = this._gl, G = this._G, N = G * G; this._live = this._live || new Map(); let L = this._live.get(id);
    if (!this._progLiveCopy) { this._progLiveCopy = this._compileStep(GLSL_LIVE_COPY); this._progLiveUpd = this._compileStep(GLSL_LIVE_UPD); const ul = (n) => gl.getUniformLocation(this._progLiveUpd, n);
      this._uLive = { cpsi: gl.getUniformLocation(this._progLiveCopy, 'u_psi'), g: ul('u_g'), r: ul('u_r'), v: ul('u_v'), c: ul('u_c'), s: ul('u_s'), rate: ul('u_rate'), eta: ul('u_eta') }; }
    if (!L) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); L = { A: a, fA: fa, B: b, fB: fb, cur: 'A', R: this._makeRGF32Tex(), M: this._makeRGF32Tex() }; this._live.set(id, L); }
    const up = (tex, re, im) => { const f = new Float32Array(2 * N); for (let i = 0; i < N; i++) { f[2 * i] = re ? +re[i] || 0 : 0; f[2 * i + 1] = im ? +im[i] || 0 : 0; }
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); };
    up(L.R, Rre, Rim); up(L.M, mask, null); up(L.A, null, null); up(L.B, null, null); L.cur = 'A';
    this._gdTex = this._gdTex || new Map(); this._gdTex.set(id, L.A); }
  liveStep(id, c, s, rate, eta) { const L = this._live && this._live.get(id); if (!L || !this._progLiveUpd) return; const gl = this._gl;
    if (!this._nlS) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); this._nlS = { A: a, fA: fa, B: b, fB: fb, src: 'A' }; }
    const S = this._nlS, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    S.src = 'A'; this._nlPass(this._progLiveCopy, S.fA, [psi], () => gl.uniform1i(this._uLive.cpsi, 0));
    this._fft2dS(S, false);
    { const src = S.src === 'A' ? S.A : S.B, fbo = S.src === 'A' ? S.fB : S.fA, u = this._u.mulK; this._nlPass(this._progMulK, fbo, [src, L.M], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.k, 1); }); S.src = S.src === 'A' ? 'B' : 'A'; }
    this._fft2dS(S, true);
    const g = S.src === 'A' ? S.A : S.B, vIn = L.cur === 'A' ? L.A : L.B, fOut = L.cur === 'A' ? L.fB : L.fA, u = this._uLive;
    this._nlPass(this._progLiveUpd, fOut, [g, L.R, vIn], () => { gl.uniform1i(u.g, 0); gl.uniform1i(u.r, 1); gl.uniform1i(u.v, 2); gl.uniform1f(u.c, c); gl.uniform1f(u.s, s); gl.uniform1f(u.rate, rate); gl.uniform1f(u.eta, eta); });
    L.cur = L.cur === 'A' ? 'B' : 'A'; this._gdTex.set(id, L.cur === 'A' ? L.A : L.B); }
  //   liveRead(id) → Float32Array(N): the slot's current V (the join snapshot ships it beside the field) · liveSetV(id, V): restore it (the joiner)
  liveRead(id) { const L = this._live && this._live.get(id); if (!L) return null; const gl = this._gl, G = this._G, N = G * G, f = new Float32Array(2 * N);
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.cur === 'A' ? L.fA : L.fB); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const v = new Float32Array(N); for (let i = 0; i < N; i++) v[i] = f[2 * i]; return v; }
  liveSetV(id, V) { const L = this._live && this._live.get(id); if (!L || !V) return; const gl = this._gl, G = this._G, N = G * G, f = new Float32Array(2 * N); for (let i = 0; i < N; i++) f[2 * i] = +V[i] || 0;
    gl.bindTexture(gl.TEXTURE_2D, L.cur === 'A' ? L.A : L.B); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindTexture(gl.TEXTURE_2D, null); }
  liveDrop(id) { const L = this._live && this._live.get(id); if (!L) return; const gl = this._gl; for (const t of [L.A, L.B, L.R, L.M]) gl.deleteTexture(t); for (const f of [L.fA, L.fB]) gl.deleteFramebuffer(f); this._live.delete(id); if (this._gdTex) this._gdTex.delete(id); }
  //   setGlassField(id, V) / applyEyeGlass(id, w) — a slot's ◌ GLASS PLATE (the app's tile item kind "glass", 2026-10-16): a static random index
  //   screen (a disordered potential) as its own R32F texture per id, applied like the guide (the phase-tilt pass's sampled kern)
  setGlassField(id, V) { const gl = this._gl, G = this._G; this._glTex = this._glTex || new Map(); let tx = this._glTex.get(id); if (tx && this._mtGown && this._mtGown.has(tx)) { this._glTex.delete(id); tx = null; }   // (a ⛰ GPU material's texture is not this slot's upload target)
    if (!V) { if (tx) { gl.deleteTexture(tx); this._glTex.delete(id); } return; } if (V.length !== G * G) return;
    const keep = this._potTex; this._potTex = tx || null; this.setPotField(V); this._glTex.set(id, this._potTex); this._potTex = keep; }
  applyEyeGlass(id, w) { const tx = this._glTex && this._glTex.get(id); if (!tx || !w) return; const keep = this._potTex; this._potTex = tx;
    try { this.applyEyePhaseTilt(0, 0, 0, { kernW: w }); } finally { this._potTex = keep; } }
  //   applyEyeConj() — ψ → ψ* on the selected eye slot (the app's ⟲ conjugate: a phase-conjugate mirror — the medium's own forward law then runs the
  //   light's history backward; exact for a time-symmetric step, 2026-10-16)
  applyEyeConj() { const gl = this._gl; if (!this._progConj) { this._progConj = this._compileStep(GLSL_CONJ); this._uConj = gl.getUniformLocation(this._progConj, 'u_psi'); }
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._scB(); this._nlPass(this._progConj, fbo, [src], () => gl.uniform1i(this._uConj, 0)); this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  applyEyeGuide(id, w) { const t = this._gdTex && this._gdTex.get(id); if (!t || !w) return; const keep = this._potTex; this._potTex = t;
    try { this.applyEyePhaseTilt(0, 0, 0, { kernW: w }); } finally { this._potTex = keep; } }
  //   THE SELF-WRITTEN WELL (optional, 2026-10-23): a slot's written structure as STATE in the symbol's own BODY FRAME, rewritten by the light it holds.
  //   selfWriteInit(id, P): B = P (body frame; an RG32F pair, .x). selfWritePose(id, pose): S = B seen at the pose {sx, sy, r, z} — the guide texture the
  //   medium uses (applyEyeGuide / the gain / the masks): S(x) = B(c + R(r)·(x − s − c)/z), bilinear, periodic (the transform of the app's posed guides).
  //   selfWriteStep(id, rate, Iw, pose): B(b) ← B + rate·(I/(I + Iw) − B), I = |ψ|² sampled at the posed place of b, c + s + z·R(−r)·(b − c) (a saturable,
  //   bounded exposure). One fresh resample each way — never of its own output: no accumulated blur. selfWriteRead (B) / selfWriteReadPosed (S) / Drop.
  _swShaders() { const gl = this._gl; if (this._swP2) return this._swP2; const mk = (src, names) => { const p = this._compileStep(src), u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, 'u_' + n); return { p, u }; };
    const bil = `float bl(sampler2D t, vec2 p, int G) { vec2 f = floor(p), w = p - f; int x0 = int(mod(f.x, float(G))), y0 = int(mod(f.y, float(G))), x1 = (x0 + 1) % G, y1 = (y0 + 1) % G;
  return mix(mix(texelFetch(t, ivec2(x0, y0), 0).x, texelFetch(t, ivec2(x1, y0), 0).x, w.x), mix(texelFetch(t, ivec2(x0, y1), 0).x, texelFetch(t, ivec2(x1, y1), 0).x, w.x), w.y); }`;
    this._swP2 = { pose: mk(`#version 300 es
precision highp float;
uniform sampler2D u_b; uniform vec2 u_s; uniform float u_r, u_z; uniform int u_G; out vec4 o;
${bil}
void main() { float c = (float(u_G) - 1.0) / 2.0; vec2 d = gl_FragCoord.xy - 0.5 - u_s - vec2(c); float cs = cos(u_r), sn = sin(u_r); vec2 src = vec2(c) + vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs) / u_z; o = vec4(bl(u_b, src, u_G), 0.0, 0.0, 1.0); }`, ['b', 's', 'r', 'z', 'G']), write: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p; uniform vec2 u_s; uniform float u_r, u_z, u_rate, u_iw; uniform int u_G; out vec4 o;
float I(ivec2 q) { vec2 v = texelFetch(u_psi, q, 0).xy; return dot(v, v); }
void main() { ivec2 b = ivec2(gl_FragCoord.xy); float c = (float(u_G) - 1.0) / 2.0; vec2 d = vec2(b) - vec2(c); float cs = cos(-u_r), sn = sin(-u_r); vec2 x = vec2(c) + u_s + u_z * vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
  vec2 f = floor(x), w = x - f; int x0 = int(mod(f.x, float(u_G))), y0 = int(mod(f.y, float(u_G))), x1 = (x0 + 1) % u_G, y1 = (y0 + 1) % u_G;
  float i = mix(mix(I(ivec2(x0, y0)), I(ivec2(x1, y0)), w.x), mix(I(ivec2(x0, y1)), I(ivec2(x1, y1)), w.x), w.y), P = texelFetch(u_p, b, 0).x; o = vec4(P + u_rate * (i / (i + u_iw) - P), 0.0, 0.0, 1.0); }`, ['psi', 'p', 's', 'r', 'z', 'rate', 'iw', 'G']), writeH: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p; uniform vec2 u_s; uniform float u_r, u_z, u_rate, u_iw; uniform int u_G, u_K; uniform vec4 u_ai[8]; uniform vec2 u_t[8]; uniform float u_w[8]; uniform float u_pr, u_rho; out vec4 o;
float I(ivec2 q) { vec2 v = texelFetch(u_psi, q, 0).xy; return dot(v, v); }
float Ib(vec2 x) { vec2 f = floor(x), w = x - f; int x0 = int(mod(f.x, float(u_G))), y0 = int(mod(f.y, float(u_G))), x1 = (x0 + 1) % u_G, y1 = (y0 + 1) % u_G;
  return mix(mix(I(ivec2(x0, y0)), I(ivec2(x1, y0)), w.x), mix(I(ivec2(x0, y1)), I(ivec2(x1, y1)), w.x), w.y); }
${bil}
void main() { ivec2 b = ivec2(gl_FragCoord.xy); float c = (float(u_G) - 1.0) / 2.0, cs = cos(-u_r), sn = sin(-u_r), acc = 0.0, accP = 0.0;
  for (int k = 0; k < 8; k++) { if (k >= u_K) break; vec2 uv = vec2(b) - vec2(c) - u_t[k], bk = vec2(u_ai[k].x * uv.x + u_ai[k].y * uv.y, u_ai[k].z * uv.x + u_ai[k].w * uv.y) + vec2(c);
    if (bk.x < 0.0 || bk.y < 0.0 || bk.x > float(u_G - 1) || bk.y > float(u_G - 1)) continue; vec2 d = bk - vec2(c); float pw = u_pr > 0.0 ? exp(-1.386294 * pow(length(d) / u_pr, 8.0)) : 1.0; acc += pw * u_w[k] * Ib(vec2(c) + u_s + u_z * vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs)); if (u_rho > 0.0) accP += u_w[k] * bl(u_p, bk, u_G); }
  acc += u_rho * u_iw * accP; float P = texelFetch(u_p, b, 0).x; o = vec4(P + u_rate * (acc / (acc + u_iw) - P), 0.0, 0.0, 1.0); }`, ['psi', 'p', 's', 'r', 'z', 'rate', 'iw', 'G', 'K', 'ai', 't', 'w', 'pr', 'rho']) };
    return this._swP2; }
  selfWriteInit(id, P) { const gl = this._gl, G = this._G, N = G * G; this._sw = this._sw || new Map(); let M = this._sw.get(id);
    if (!M) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(), [sT, sF] = this._makePsiTex(); M = { A: a, fA: fa, B: b, fB: fb, S: sT, fS: sF, cur: 'A' }; this._sw.set(id, M); }
    const f = new Float32Array(2 * N); for (let i = 0; i < N; i++) f[2 * i] = P ? +P[i] || 0 : 0; for (const t of [M.A, M.B, M.S]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); } gl.bindTexture(gl.TEXTURE_2D, null);
    M.cur = 'A'; M.dirty = true; M.pk = null; this._gdTex = this._gdTex || new Map(); this._gdTex.set(id, M.S); }
  selfWritePose(id, pose) { const M = this._sw && this._sw.get(id); if (!M) return; const q = pose || {}, sx = +q.sx || 0, sy = +q.sy || 0, r = +q.r || 0, z = +q.z > 0 ? +q.z : 1, pk = sx + "|" + sy + "|" + r + "|" + z;
    if (!M.dirty && M.pk === pk) return; const gl = this._gl, P = this._swShaders().pose, bIn = M.cur === 'A' ? M.A : M.B;
    if (q.nat && Array.isArray(q.nat.toField) && this.natChainTex(bIn, q.nat.toField, [M.S, M.fS])) { M.dirty = false; M.pk = pk; this._gdTex.set(id, M.S); return; }   // (optional, 2026-11-04) q.nat: the pose as OPTICS (the app's chain) — no bilinear read
    this._nlPass(P.p, M.fS, [bIn], () => { gl.uniform1i(P.u.b, 0); gl.uniform2f(P.u.s, sx, sy); gl.uniform1f(P.u.r, r); gl.uniform1f(P.u.z, z); gl.uniform1i(P.u.G, this._G); });
    M.dirty = false; M.pk = pk; this._gdTex.set(id, M.S); }
  //   (optional, 2026-11-02) hut: [{ ai: A⁻¹ (4), tx, ty, w }] (≤ 8) — the exposure is the intensity's HUTCHINSON image instead, Σ_k w_k·I(w_k⁻¹(b)) taken in
  //   the body frame, then posed (the self-written FRACTAL glass). Absent: the write as before.
  //   rho (optional, with hut, 2026-11-03): the MATERIAL's own copies join the exposure — E = Σ_k w_k·I(…) + rho·Iw·Σ_k w_k·B(w_k⁻¹(b)) (B the written
  //   state, body frame): the light writes through the fractal's resolvent (scale memory rho; 0 or absent: the write as before, the same arithmetic)
  //   pupil (optional, with hut): ρ < 1 — the intensity passes a soft ROUND stop (super-Gaussian, half-amplitude at ρ·G/2; its square for intensity) before the copies; ≥ 1 or absent: the field's square edge
  //   (optional, 2026-11-04) a plan group may carry nx = { sh: four dual tables, a, beta } (the app's exact pull — a type-2 NUFFT: the field's own Fourier series at each preimage) or nat = [{ el, S }, …] (the app's native copy: space / kmul tables, shears, per-line zooms, exact flips, then the
  //   translations' dual hologram S): cavW then makes that group's copy by those optics instead of the pull-back rows. Absent: as before.
  //   (optional, 2026-11-03) THE SLOT's CAVITY ON THE GPU — a SUB-TICK computation, nothing read back — running the app's HUTCHINSON ELEMENT as real optics
  //   (its _hmPlan): cavPlanSet(key, plan) uploads { K, tab (Float32 4·G·G·K, row o·G + y: the source point, the amplitude 1/√(K·|J|), 0), groups
  //   [{ k0, k1, mask (Float64 N, the copy's numerical aperture in k) }], ap (Float64 N, the round aperture) }; cavW(id, src, key, k, isat, cr, ci): src × ap,
  //   per group FFT × mask, inverse, the rows' bilinear pull-back × amplitude, summed (NOTHING renormalised), × κ_eff = k/(1 + Ī/isat) (isat > 0, Ī = src's
  //   mean intensity) × (cr + i·ci) — kept as id's term; cavObjAdd(id): the object field (the injection target) += id's term. curEyeTex / ringTex: the
  //   selected eye's texture, a filmRingPush ring's texture. Inert unless called.
  cavPlanSet(key, P) { const gl = this._gl, G = this._G, K = Math.min(32, P.K | 0); this._cvPl = this._cvPl || new Map(); if (this._cvPl.has(key)) return; const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, G, G * K); for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G * K, gl.RGBA, gl.FLOAT, P.tab.subarray(0, 4 * G * G * K)); gl.bindTexture(gl.TEXTURE_2D, null);
    if (this._cvPl.size >= 8) { const k0 = this._cvPl.keys().next().value; gl.deleteTexture(this._cvPl.get(k0).tex); this._cvPl.delete(k0); }
    const natOne = (q) => { if (!q || !Array.isArray(q.el) || !q.S) return null; const el = this._natEls(q.el); if (!el) return null;
      return { el, S: this.viewTable(q.S, q.S.m, q.S.mi) }; }, natOf = (q) => { if (!Array.isArray(q.nat) || !q.nat.length) return null; const L = q.nat.map(natOne); return L.every(Boolean) ? L : null; };   // (a group's chains: one, or one per graph node)
    const _unused = (q) => { const el = [];
      for (const e of q.el) { if (e.kind === 'space' || e.kind === 'kmul') el.push({ kind: e.kind, t: this.viewTable(e, e.m, e.mi || null) }); else if (e.kind === 'shear') el.push({ kind: 'shear', axis: e.axis | 0, s: +e.s || 0 });
        else if (e.kind === 'zoom' && e.m && e.mi) el.push({ kind: 'zoom', axis: e.axis | 0, t: this.viewTable(e.m, e.m, e.mi) });   // (a per-line Dirichlet resample — keyed by its table, shared by both axes)
        else if (e.kind === 'u1' && e.op && Array.isArray(e.op.A) && !e.op.A[1] && !e.op.A[2] && Math.abs(Math.abs(e.op.A[0]) - 1) < 1e-9 && Math.abs(Math.abs(e.op.A[3]) - 1) < 1e-9) el.push({ kind: 'flip', fx: e.op.A[0] < 0 ? 1 : 0, fy: e.op.A[3] < 0 ? 1 : 0 }); else return null; }
      return el; }; void _unused;
    const nxOf = (q) => q.nx && Array.isArray(q.nx.sh) && q.nx.sh.length === 4 ? { sh: q.nx.sh.map((T) => this.viewTable(T, T.m, T.mi)), a: +q.nx.a, b: +q.nx.beta } : null;   // ⟲ the exact pull (the app's _nxES): four dual tables, the kernel's half-width and β
    this._cvPl.set(key, { tex, K, ap: this.viewTable(P.ap, P.ap, null), groups: P.groups.filter((q) => q.k0 < K).map((q) => ({ k0: q.k0, k1: Math.min(K, q.k1), m: this.viewTable(q.mask, q.mask, null), nat: natOf(q), nx: nxOf(q) })) }); }
  //   _natEls(els) — the app's native chain (space / kmul tables, shears, zooms, exact flips / quarter turns) as GPU elements (memoised per array); null if a kind is unknown
  _natEls(els) { this._neM = this._neM || new WeakMap(); if (this._neM.has(els)) return this._neM.get(els); const el = [];
    for (const e of els) { if (e.kind === 'space' || e.kind === 'kmul') el.push({ kind: e.kind, t: this.viewTable(e, e.m, e.mi || null) }); else if (e.kind === 'shear') el.push({ kind: 'shear', axis: e.axis | 0, s: +e.s || 0 });
      else if (e.kind === 'zoom' && e.m && e.mi) el.push({ kind: 'zoom', axis: e.axis | 0, t: this.viewTable(e.m, e.m, e.mi) });
      else if (e.kind === 'rot90') el.push({ kind: 'rot90', q: e.q | 0 });
      else if (e.kind === 'u1' && e.op && Array.isArray(e.op.A) && !e.op.A[1] && !e.op.A[2] && Math.abs(Math.abs(e.op.A[0]) - 1) < 1e-9 && Math.abs(Math.abs(e.op.A[3]) - 1) < 1e-9) el.push({ kind: 'flip', fx: e.op.A[0] < 0 ? 1 : 0, fy: e.op.A[3] < 0 ? 1 : 0 }); else { this._neM.set(els, null); return null; } }
    this._neM.set(els, el); return el; }
  //   _natRun(el, F) — run converted elements on the ping-pong F in place (the current texture is the field; x domain in and out)
  _natRun(el, F) { const gl = this._gl, P = this._cvProgs(), cur = () => (F.src === 'A' ? F.A : F.B), other = () => (F.src === 'A' ? F.fB : F.fA), flip = () => { F.src = F.src === 'A' ? 'B' : 'A'; };
    const mul = (t) => { this._nlPass(P.mul.p, other(), [cur(), t], () => { gl.uniform1i(P.mul.u.x, 0); gl.uniform1i(P.mul.u.t, 1); }); flip(); };
    for (const e of el) { if (e.kind === 'space') mul(e.t); else if (e.kind === 'kmul') { this._fft2dS(F, false); mul(e.t); this._fft2dS(F, true); }
      else if (e.kind === 'shear') { if (!e.s) continue; if (this._shearFft && this._fftStockham) { this._shearFftS(F, e.axis | 0, e.s); continue; } const K = this._shK(e.s), V = this._viewProgs(); this._nlPass(V.sh, other(), [cur(), K], () => { gl.uniform1i(V.ush.x, 0); gl.uniform1i(V.ush.K, 1); gl.uniform1i(V.ush.G, this._G); gl.uniform1i(V.ush.axis, e.axis | 0); }); flip(); }
      else if (e.kind === 'zoom') { this._nlPass(P.zm.p, other(), [cur(), e.t], () => { gl.uniform1i(P.zm.u.a, 0); gl.uniform1i(P.zm.u.K, 1); gl.uniform1i(P.zm.u.G, this._G); gl.uniform1i(P.zm.u.axis, e.axis | 0); }); flip(); }
      else if (e.kind === 'flip') { this._nlPass(P.fl.p, other(), [cur()], () => { gl.uniform1i(P.fl.u.a, 0); gl.uniform2i(P.fl.u.f, e.fx | 0, e.fy | 0); gl.uniform1i(P.fl.u.G, this._G); }); flip(); }
      else if (e.kind === 'rot90') { for (let k = 0; k < (e.q | 0); k++) { this._nlPass(P.r9.p, other(), [cur()], () => { gl.uniform1i(P.r9.u.a, 0); gl.uniform1i(P.r9.u.G, this._G); }); flip(); } } } }
  //   natChainTex(src, els, dst) (optional, 2026-11-04) — the app's native chain on a texture, the result copied into dst ([tex, fbo]); false if a kind is unknown
  natChainTex(src, els, dst) { const el = this._natEls(els); if (!el) return false; const gl = this._gl, P = this._cvProgs(); if (!this._cvX) { const mk = () => this._makePsiTex(); const a = mk(), b = mk(), c = mk(), d = mk(), e = mk(); this._cvX = { ap: a, accA: b, accB: c, F: { A: d[0], fA: d[1], B: e[0], fB: e[1], src: 'A' } }; }
    const F = this._cvX.F; F.src = 'A'; this._nlPass(P.cp.p, F.fA, [src], () => gl.uniform1i(P.cp.u.a, 0)); this._natRun(el, F); this._nlPass(P.cp.p, dst[1], [F.src === 'A' ? F.A : F.B], () => gl.uniform1i(P.cp.u.a, 0)); return true; }
  //   viewNatChain(els) (optional, 2026-11-04) — the app's native chain on the ACTIVE eye in place (x in, x out); false if a kind is unknown
  viewNatChain(els) { if (!this._vnT) this._vnT = this._makePsiTex(); if (!this.natChainTex(this._eyeSrc === 'A' ? this._eyeA : this._eyeB, els, this._vnT)) return false; const gl = this._gl, P = this._cvProgs(), fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    this._nlPass(P.cp.p, fbo, [this._vnT[0]], () => gl.uniform1i(P.cp.u.a, 0)); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; return true; }
  //   THE ⛰ MATERIAL ON THE GPU (optional, 2026-11-04 — the app's fractal material, r ← r + e·(ρ·M_p r + (1 − ρ)·s − r), advanced per cascade beat
  //   here instead of the CPU): matPlanSet(key, M) uploads one LAW's step — M = { tab: Float32 4·G·G·Kg (rows kk·G + y: the preimage (x, y), its
  //   weight a, 0 — the gathered maps by group), groups [{ k0, k1, sh: four dual tables }], ka, kb (the semicircle kernel), pts: Float32 5·P
  //   (sx, sy, tx, ty, w — the scattered maps' rows, drawn as additive points), nP, src (Float64 N | null) }; matInit(id, r) / matStep(id, key, rho, e)
  //   / matSnap(id, tag) / matRestore(id, tag) / matRead(id) / matGlass(id, base, win, q) (the slot's glass texture = base + q·win·u/(1 + u),
  //   u = r/⟨r⟩ — ⟨r⟩ from the step's own spectrum, the DC bin). False (nothing done) without EXT_float_blend or a plan.
  _matProgs() { if (this._mtP) return this._mtP; const gl = this._gl; if (!gl.getExtension('EXT_float_blend')) return (this._mtP = null);
    const mk = (src, names) => { const p = this._compileStep(src), u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, 'u_' + n); return { p, u }; };
    const vs = this._compileShader(gl.VERTEX_SHADER, `#version 300 es
in vec4 a_st; in float a_w; uniform sampler2D u_r; uniform int u_G; out float v;
void main() { v = a_w * texelFetch(u_r, ivec2(a_st.xy), 0).x; vec2 p = (a_st.zw + 0.5) / float(u_G) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); gl_PointSize = 1.0; }`), fs = this._compileShader(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; in float v; out vec4 o; void main() { o = vec4(v, 0.0, 0.0, 1.0); }`);
    const pp = gl.createProgram(); gl.attachShader(pp, vs); gl.attachShader(pp, fs); gl.bindAttribLocation(pp, 0, 'a_st'); gl.bindAttribLocation(pp, 1, 'a_w'); gl.linkProgram(pp); if (!gl.getProgramParameter(pp, gl.LINK_STATUS)) throw new Error('mat pt link: ' + gl.getProgramInfoLog(pp));
    this._mtP = { pt: { p: pp, u: { r: gl.getUniformLocation(pp, 'u_r'), G: gl.getUniformLocation(pp, 'u_G') } }, cb: mk(`#version 300 es
precision highp float;
uniform sampler2D u_r, u_g, u_sc, u_s; uniform float u_rho, u_e; uniform int u_hasS; out vec4 o;
void main() { ivec2 b = ivec2(gl_FragCoord.xy); float r = texelFetch(u_r, b, 0).x, m = texelFetch(u_g, b, 0).x + texelFetch(u_sc, b, 0).x, s = u_hasS == 1 ? texelFetch(u_s, b, 0).x : 0.0; o = vec4(r + u_e * (u_rho * m + (1.0 - u_rho) * s - r), 0.0, 0.0, 1.0); }`, ['r', 'g', 'sc', 's', 'rho', 'e', 'hasS']), gi: mk(`#version 300 es
precision highp float;
uniform sampler2D u_r, u_k, u_b, u_w; uniform float u_q, u_N; uniform int u_hasB; out vec4 o;
void main() { ivec2 b = ivec2(gl_FragCoord.xy); float mu = texelFetch(u_k, ivec2(0, 0), 0).x / u_N, u = mu > 0.0 ? texelFetch(u_r, b, 0).x / mu : 0.0, v = u > 0.0 ? u / (1.0 + u) : 0.0;
  o = vec4((u_hasB == 1 ? texelFetch(u_b, b, 0).x : 0.0) + u_q * texelFetch(u_w, b, 0).x * v, 0.0, 0.0, 1.0); }`, ['r', 'k', 'b', 'w', 'q', 'N', 'hasB']) };
    return this._mtP; }
  matOK() { try { return !!this._matProgs(); } catch (e) { return false; } }
  matPlanSet(key, M) { if (!this._matProgs()) return false; this._mtPl = this._mtPl || new Map(); if (this._mtPl.has(key)) return true; const gl = this._gl, G = this._G, Kg = Math.max(0, M.Kg | 0);
    let tex = null; if (Kg > 0) { tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, G, G * Kg); for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G * Kg, gl.RGBA, gl.FLOAT, M.tab); gl.bindTexture(gl.TEXTURE_2D, null); }
    let vao = null, vbo = null; const nP = M.nP | 0; if (nP > 0) { vao = gl.createVertexArray(); vbo = gl.createBuffer(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, M.pts.subarray(0, 5 * nP), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16); gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null); }
    if (this._mtPl.size >= 8) { const k0 = this._mtPl.keys().next().value, o = this._mtPl.get(k0); if (o.tex) gl.deleteTexture(o.tex); if (o.vbo) gl.deleteBuffer(o.vbo); if (o.vao) gl.deleteVertexArray(o.vao); this._mtPl.delete(k0); }
    this._mtPl.set(key, { tex, vao, vbo, nP, groups: (M.groups || []).map((g) => ({ k0: g.k0 | 0, k1: g.k1 | 0, sh: g.sh.map((T) => this.viewTable(T, T.m, T.mi)) })), ka: +M.ka, kb: +M.kb, src: M.src ? this.viewTable(M.src, M.src, null) : null }); return true; }
  matPlanHas(key) { return !!(this._mtPl && this._mtPl.has(key)); }
  _matS(id) { this._mtS = this._mtS || new Map(); let S = this._mtS.get(id); if (!S) { S = { A: this._makePsiTex(), B: this._makePsiTex(), cur: 'A', ring: [], spec: this._makePsiTex() }; this._mtS.set(id, S); } return S; }
  matInit(id, r) { if (!this._matProgs()) return false; const gl = this._gl, G = this._G, N = G * G, S = this._matS(id), f = new Float32Array(2 * N); for (let j = 0; j < N; j++) f[2 * j] = +r[j] || 0;
    for (const t of [S.A[0], S.B[0]]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f); } gl.bindTexture(gl.TEXTURE_2D, null); S.cur = 'A'; return true; }
  matStep(id, key, rho, e) { const MP = this._matProgs(), PL = this._mtPl && this._mtPl.get(key); if (!MP || !PL) return false; const gl = this._gl, G = this._G, P = this._cvProgs(), S = this._matS(id);
    if (!this._cvX) { const mk = () => this._makePsiTex(); const a = mk(), b = mk(), c = mk(), d = mk(), e2 = mk(); this._cvX = { ap: a, accA: b, accB: c, F: { A: d[0], fA: d[1], B: e2[0], fB: e2[1], src: 'A' } }; }
    if (!this._mtX) { const mk = () => this._makePsiTex(); this._mtX = { n: [mk(), mk(), mk(), mk()], g: [mk(), mk()], sc: mk() }; } const X = this._cvX, F = X.F, W = this._mtX, cur = () => (F.src === 'A' ? F.A : F.B), rIn = S.cur === 'A' ? S.A : S.B, rOut = S.cur === 'A' ? S.B : S.A;
    F.src = 'A'; this._nlPass(P.cp.p, F.fA, [rIn[0]], () => gl.uniform1i(P.cp.u.a, 0)); this._fft2dS(F, false); this._nlPass(P.cp.p, S.spec[1], [cur()], () => gl.uniform1i(P.cp.u.a, 0));   // the spectrum (kept: its DC is Σr — the index's mean)
    this._nlPass(P.zero.p, W.g[0][1], [], () => {}); let ig = 0;
    for (const g of PL.groups) { g.sh.forEach((T, n) => { F.src = 'A'; this._nlPass(P.mul.p, F.fA, [S.spec[0], T], () => { gl.uniform1i(P.mul.u.x, 0); gl.uniform1i(P.mul.u.t, 1); }); this._fft2dS(F, true); this._nlPass(P.cp.p, W.n[n][1], [cur()], () => gl.uniform1i(P.cp.u.a, 0)); });
      this._nlPass(P.pnx.p, W.g[1 - ig][1], [W.n[0][0], W.n[1][0], W.n[2][0], W.n[3][0], PL.tex, W.g[ig][0]], () => { const u = P.pnx.u; gl.uniform1i(u.n0, 0); gl.uniform1i(u.n1, 1); gl.uniform1i(u.n2, 2); gl.uniform1i(u.n3, 3); gl.uniform1i(u.tab, 4); gl.uniform1i(u.acc, 5); gl.uniform1i(u.G, G); gl.uniform1i(u.k0, g.k0); gl.uniform1i(u.k1, g.k1); gl.uniform1f(u.ka, PL.ka); gl.uniform1f(u.kb, PL.kb); }); ig = 1 - ig; }
    this._nlPass(P.zero.p, W.sc[1], [], () => {});
    if (PL.nP > 0) { gl.bindFramebuffer(gl.FRAMEBUFFER, W.sc[1]); gl.viewport(0, 0, G, G); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(MP.pt.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rIn[0]); gl.uniform1i(MP.pt.u.r, 0); gl.uniform1i(MP.pt.u.G, G);
      gl.bindVertexArray(PL.vao); gl.drawArrays(gl.POINTS, 0, PL.nP); gl.bindVertexArray(null); gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }   // the scattered maps: each row's share of r, added at its target (blending keeps the primitives' order: the same sum on every peer)
    this._nlPass(MP.cb.p, rOut[1], [rIn[0], W.g[ig][0], W.sc[0], PL.src || rIn[0]], () => { const u = MP.cb.u; gl.uniform1i(u.r, 0); gl.uniform1i(u.g, 1); gl.uniform1i(u.sc, 2); gl.uniform1i(u.s, 3); gl.uniform1f(u.rho, +rho); gl.uniform1f(u.e, +e); gl.uniform1i(u.hasS, PL.src ? 1 : 0); });
    S.cur = S.cur === 'A' ? 'B' : 'A'; return true; }
  matSnap(id, tag) { const S = this._matS(id), gl = this._gl, P = this._cvProgs(), rIn = S.cur === 'A' ? S.A : S.B; let e = S.ring.find((x) => x.tag === tag); if (!e) { e = S.ring.length >= 8 ? S.ring.shift() : { t: this._makePsiTex() }; e.tag = tag; S.ring.push(e); }
    this._nlPass(P.cp.p, e.t[1], [rIn[0]], () => gl.uniform1i(P.cp.u.a, 0)); }
  matRestore(id, tag) { const S = this._matS(id), gl = this._gl, P = this._cvProgs(), e = S.ring.find((x) => x.tag === tag); if (!e) return false; const rIn = S.cur === 'A' ? S.A : S.B; this._nlPass(P.cp.p, rIn[1], [e.t[0]], () => gl.uniform1i(P.cp.u.a, 0)); return true; }
  matHasSnap(id, tag) { return !!(this._mtS && this._mtS.get(id) && this._mtS.get(id).ring.some((x) => x.tag === tag)); }
  matRead(id) { const S = this._mtS && this._mtS.get(id); if (!S) return null; const gl = this._gl, G = this._G, f = new Float32Array(2 * G * G), r = S.cur === 'A' ? S.A : S.B; gl.bindFramebuffer(gl.FRAMEBUFFER, r[1]); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null); const o = new Float32Array(G * G); for (let j = 0; j < G * G; j++) o[j] = f[2 * j]; return o; }
  matGlass(id, base, win, q) { const MP = this._matProgs(), S = this._mtS && this._mtS.get(id); if (!MP || !S) return false; const gl = this._gl, G = this._G; this._glTex = this._glTex || new Map(); this._mtG = this._mtG || new Map(); let T = this._mtG.get(id); if (!T) { T = this._makePsiTex(); this._mtG.set(id, T); }
    if (!this._cvX) { const mk = () => this._makePsiTex(); const a = mk(), b = mk(), c = mk(), d = mk(), e2 = mk(); this._cvX = { ap: a, accA: b, accB: c, F: { A: d[0], fA: d[1], B: e2[0], fB: e2[1], src: 'A' } }; }
    const P = this._cvProgs(), rIn = S.cur === 'A' ? S.A : S.B, X = this._cvX, F = X.F; F.src = 'A'; this._nlPass(P.cp.p, F.fA, [rIn[0]], () => gl.uniform1i(P.cp.u.a, 0)); this._fft2dS(F, false); this._nlPass(P.cp.p, S.spec[1], [F.src === 'A' ? F.A : F.B], () => gl.uniform1i(P.cp.u.a, 0));   // (the current state's spectrum: its DC)
    const bt = base ? this.viewTable(base, base, null) : null, wt = this.viewTable(win, win, null);
    this._nlPass(MP.gi.p, T[1], [rIn[0], S.spec[0], bt || rIn[0], wt], () => { const u = MP.gi.u; gl.uniform1i(u.r, 0); gl.uniform1i(u.k, 1); gl.uniform1i(u.b, 2); gl.uniform1i(u.w, 3); gl.uniform1f(u.q, +q); gl.uniform1f(u.N, G * G); gl.uniform1i(u.hasB, bt ? 1 : 0); });
    const old = this._glTex.get(id); if (old && old !== T[0] && !this._mtGown?.has(old)) gl.deleteTexture(old); this._mtGown = this._mtGown || new Set(); this._mtGown.add(T[0]); this._glTex.set(id, T[0]); return true; }
  cavPlanHas(key) { return !!(this._cvPl && this._cvPl.has(key)); }
  curEyeTex() { return this._eyeSrc === 'A' ? this._eyeA : this._eyeB; }
  ringTex(key, idx) { const r = this._rings && this._rings[key]; return r ? r.f[((idx % r.R) + r.R) % r.R][0] : null; }
  _cvProgs() { if (this._cvP) return this._cvP; const gl = this._gl, mk = (src, names) => { const p = this._compileStep(src), u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, 'u_' + n); return { p, u }; };
    this._cvP = { mul: mk(`#version 300 es
precision highp float;
uniform sampler2D u_x, u_t; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 a = texelFetch(u_x, q, 0).xy, t = texelFetch(u_t, q, 0).xy; o = vec4(a.x * t.x - a.y * t.y, a.x * t.y + a.y * t.x, 0.0, 1.0); }`, ['x', 't']), pull: mk(`#version 300 es
precision highp float;
uniform sampler2D u_src, u_tab, u_acc; uniform int u_G, u_k0, u_k1; out vec4 o;
vec2 B(vec2 x) { vec2 X = clamp(x, vec2(0.0), vec2(float(u_G - 1))), f0 = min(floor(X), vec2(float(u_G - 2))), w = X - f0; ivec2 a = ivec2(f0);
  return mix(mix(texelFetch(u_src, a, 0).xy, texelFetch(u_src, a + ivec2(1, 0), 0).xy, w.x), mix(texelFetch(u_src, a + ivec2(0, 1), 0).xy, texelFetch(u_src, a + ivec2(1, 1), 0).xy, w.x), w.y); }
void main() { ivec2 b = ivec2(gl_FragCoord.xy); vec2 acc = texelFetch(u_acc, b, 0).xy;
  for (int k = 0; k < 32; k++) { if (k < u_k0) continue; if (k >= u_k1) break; vec4 e = texelFetch(u_tab, ivec2(b.x, b.y + k * u_G), 0); if (e.z <= 0.0) continue; acc += e.z * B(e.xy); }
  o = vec4(acc, 0.0, 1.0); }`, ['src', 'tab', 'acc', 'G', 'k0', 'k1']), sc: mk(`#version 300 es
precision highp float;
uniform sampler2D u_w, u_es; uniform float u_k, u_is, u_N; uniform vec2 u_c; out vec4 o;
void main() { float es = texelFetch(u_es, ivec2(0, 0), 0).x, f = u_is > 0.0 ? u_k / (1.0 + es / u_N / u_is) : u_k;
  vec2 w = texelFetch(u_w, ivec2(gl_FragCoord.xy), 0).xy * f; o = vec4(u_c.x * w.x - u_c.y * w.y, u_c.x * w.y + u_c.y * w.x, 0.0, 1.0); }`, ['w', 'es', 'k', 'is', 'N', 'c']), add: mk(`#version 300 es
precision highp float;
uniform sampler2D u_a, u_b; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); o = vec4(texelFetch(u_a, q, 0).xy + texelFetch(u_b, q, 0).xy, 0.0, 1.0); }`, ['a', 'b']), cp: mk(`#version 300 es
precision highp float;
uniform sampler2D u_a; out vec4 o;
void main() { o = vec4(texelFetch(u_a, ivec2(gl_FragCoord.xy), 0).xy, 0.0, 1.0); }`, ['a']), fl: mk(`#version 300 es
precision highp float;
uniform sampler2D u_a; uniform ivec2 u_f; uniform int u_G; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); o = vec4(texelFetch(u_a, ivec2(u_f.x == 1 ? u_G - 1 - q.x : q.x, u_f.y == 1 ? u_G - 1 - q.y : q.y), 0).xy, 0.0, 1.0); }`, ['a', 'f', 'G']), r9: mk(`#version 300 es
precision highp float;
uniform sampler2D u_a; uniform int u_G; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); o = vec4(texelFetch(u_a, ivec2(q.y, u_G - 1 - q.x), 0).xy, 0.0, 1.0); }`, ['a', 'G']), zm: mk(`#version 300 es
precision highp float;
uniform sampler2D u_a, u_K; uniform int u_G, u_axis; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int l = u_axis == 0 ? c.y : c.x, u = u_axis == 0 ? c.x : c.y; vec2 acc = vec2(0.0);
  for (int n = 0; n < 2048; n++) { if (n >= u_G) break; vec2 k = texelFetch(u_K, ivec2(n, u), 0).xy; if (k.x == 0.0 && k.y == 0.0) continue; vec2 p = texelFetch(u_a, u_axis == 0 ? ivec2(n, l) : ivec2(l, n), 0).xy; acc += vec2(p.x * k.x - p.y * k.y, p.x * k.y + p.y * k.x); }
  o = vec4(acc, 0.0, 1.0); }`, ['a', 'K', 'G', 'axis']), pnx: mk(`#version 300 es
precision highp float;
uniform sampler2D u_n0, u_n1, u_n2, u_n3, u_tab, u_acc; uniform int u_G, u_k0, u_k1; uniform float u_ka, u_kb; out vec4 o;
float ph(float t) { float u = t / u_ka; return abs(u) >= 1.0 ? 0.0 : exp(u_kb * (sqrt(1.0 - u * u) - 1.0)); }
int wrap(int v, int m) { return v - m * int(floor(float(v) / float(m))); }
vec2 fF(int xi, int yi) { ivec2 q = ivec2(xi / 2, yi / 2); int px = xi - 2 * q.x, py = yi - 2 * q.y; if (px == 0 && py == 0) return texelFetch(u_n0, q, 0).xy; if (px == 1 && py == 0) return texelFetch(u_n1, q, 0).xy; if (px == 0) return texelFetch(u_n2, q, 0).xy; return texelFetch(u_n3, q, 0).xy; }
void main() { ivec2 b = ivec2(gl_FragCoord.xy); vec2 acc = texelFetch(u_acc, b, 0).xy; int G2 = 2 * u_G;
  for (int k = 0; k < 32; k++) { if (k < u_k0) continue; if (k >= u_k1) break; vec4 e = texelFetch(u_tab, ivec2(b.x, b.y + k * u_G), 0); if (e.z <= 0.0) continue;
    float X = 2.0 * e.x, Y = 2.0 * e.y; int mx0 = int(ceil(X - u_ka)), my0 = int(ceil(Y - u_ka)); vec2 s = vec2(0.0);
    for (int dy = 0; dy < 8; dy++) { int my = my0 + dy; float wy = ph(Y - float(my)); if (wy == 0.0) continue; int yi = wrap(my, G2);
      for (int dx = 0; dx < 8; dx++) { int mx = mx0 + dx; float ww = wy * ph(X - float(mx)); if (ww == 0.0) continue; s += ww * fF(wrap(mx, G2), yi); } }
    acc += e.z * s; }
  o = vec4(acc, 0.0, 1.0); }`, ['n0', 'n1', 'n2', 'n3', 'tab', 'acc', 'G', 'k0', 'k1', 'ka', 'kb']), pnxW: mk(`#version 300 es
precision highp float;
uniform sampler2D u_n0, u_n1, u_n2, u_n3, u_tab, u_acc; uniform int u_G, u_k0, u_k1, u_mode; uniform float u_ka, u_kb, u_r, u_z, u_pr; uniform vec2 u_s; out vec4 o;
float ph(float t) { float u = t / u_ka; return abs(u) >= 1.0 ? 0.0 : exp(u_kb * (sqrt(1.0 - u * u) - 1.0)); }
int wrap(int v, int m) { return v - m * int(floor(float(v) / float(m))); }
vec2 fF(int xi, int yi) { ivec2 q = ivec2(xi / 2, yi / 2); int px = xi - 2 * q.x, py = yi - 2 * q.y; if (px == 0 && py == 0) return texelFetch(u_n0, q, 0).xy; if (px == 1 && py == 0) return texelFetch(u_n1, q, 0).xy; if (px == 0) return texelFetch(u_n2, q, 0).xy; return texelFetch(u_n3, q, 0).xy; }
void main() { ivec2 b = ivec2(gl_FragCoord.xy); float acc = texelFetch(u_acc, b, 0).x; int G2 = 2 * u_G; float c = (float(u_G) - 1.0) / 2.0, cs = cos(-u_r), sn = sin(-u_r);
  for (int k = 0; k < 32; k++) { if (k < u_k0) continue; if (k >= u_k1) break; vec4 e = texelFetch(u_tab, ivec2(b.x, b.y + k * u_G), 0); if (e.z <= 0.0) continue;
    vec2 d = e.xy - vec2(c), p = e.xy; float pw = 1.0; if (u_mode == 0) { p = vec2(c) + u_s + u_z * vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs); if (u_pr > 0.0) pw = exp(-1.386294 * pow(length(d) / u_pr, 8.0)); }
    float X = 2.0 * p.x, Y = 2.0 * p.y; int mx0 = int(ceil(X - u_ka)), my0 = int(ceil(Y - u_ka)); vec2 s = vec2(0.0);
    for (int dy = 0; dy < 8; dy++) { int my = my0 + dy; float wy = ph(Y - float(my)); if (wy == 0.0) continue; int yi = wrap(my, G2);
      for (int dx = 0; dx < 8; dx++) { int mx = mx0 + dx; float ww = wy * ph(X - float(mx)); if (ww == 0.0) continue; s += ww * fF(wrap(mx, G2), yi); } }
    acc += e.z * e.z * pw * (u_mode == 0 ? dot(s, s) : s.x); }
  o = vec4(acc, 0.0, 0.0, 1.0); }`, ['n0', 'n1', 'n2', 'n3', 'tab', 'acc', 'G', 'k0', 'k1', 'mode', 'ka', 'kb', 'r', 'z', 'pr', 's']), swW: mk(`#version 300 es
precision highp float;
uniform sampler2D u_p, u_aI, u_aP; uniform float u_rate, u_iw, u_rho; out vec4 o;
void main() { ivec2 b = ivec2(gl_FragCoord.xy); float E = texelFetch(u_aI, b, 0).x + u_rho * u_iw * texelFetch(u_aP, b, 0).x, P = texelFetch(u_p, b, 0).x; o = vec4(P + u_rate * (E / (E + u_iw) - P), 0.0, 0.0, 1.0); }`, ['p', 'aI', 'aP', 'rate', 'iw', 'rho']), zero: mk(`#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`, []) };
    return this._cvP; }
  cavW(id, src, key, k, isat, cr, ci) { const PL = this._cvPl && this._cvPl.get(key); if (!PL || !src) return false; const gl = this._gl, P = this._cvProgs(); this._cvS = this._cvS || new Map();
    let M = this._cvS.get(id); if (!M) { M = { term: this._makePsiTex() }; this._cvS.set(id, M); }
    if (!this._cvX) { const mk = () => this._makePsiTex(); const a = mk(), b = mk(), c = mk(), d = mk(), e = mk(); this._cvX = { ap: a, accA: b, accB: c, F: { A: d[0], fA: d[1], B: e[0], fB: e[1], src: 'A' } }; }
    const X = this._cvX, F = X.F, cur = () => (F.src === 'A' ? F.A : F.B), other = () => (F.src === 'A' ? F.fB : F.fA), flip = () => { F.src = F.src === 'A' ? 'B' : 'A'; };
    this._nlPass(P.mul.p, X.ap[1], [src, PL.ap], () => { gl.uniform1i(P.mul.u.x, 0); gl.uniform1i(P.mul.u.t, 1); });   // the round aperture
    this._nlPass(P.zero.p, X.accA[1], [], () => {}); let acc = X.accA, nxt = X.accB;
    for (const g of PL.groups) { F.src = 'A'; this._nlPass(P.cp.p, F.fA, [X.ap[0]], () => gl.uniform1i(P.cp.u.a, 0));
      if (g.nat) { const mul = (t) => { this._nlPass(P.mul.p, other(), [cur(), t], () => { gl.uniform1i(P.mul.u.x, 0); gl.uniform1i(P.mul.u.t, 1); }); flip(); };   // ⟲ NATIVE: the group's optics (the app's _natGL2 chain), then its translations in the dual
        for (const nt of g.nat) { F.src = 'A'; this._nlPass(P.cp.p, F.fA, [X.ap[0]], () => gl.uniform1i(P.cp.u.a, 0));
        this._natRun(nt.el, F);
        this._fft2dS(F, false); mul(nt.S); this._fft2dS(F, true);
        this._nlPass(P.add.p, nxt[1], [acc[0], cur()], () => { gl.uniform1i(P.add.u.a, 0); gl.uniform1i(P.add.u.b, 1); }); const t2 = acc; acc = nxt; nxt = t2; } continue; }
      if (g.nx) { if (!X.nx) { X.nx = [0, 1, 2, 3].map(() => this._makePsiTex()); X.nk = this._makePsiTex(); } this._fft2dS(F, false); this._nlPass(P.cp.p, X.nk[1], [cur()], () => gl.uniform1i(P.cp.u.a, 0));   // ⟲ THE EXACT PULL: the spectrum once (kept), four shifted inverse transforms = the field on the 2× grid, then the kernel gather
        g.nx.sh.forEach((T, n) => { F.src = 'A'; this._nlPass(P.mul.p, F.fA, [X.nk[0], T], () => { gl.uniform1i(P.mul.u.x, 0); gl.uniform1i(P.mul.u.t, 1); }); this._fft2dS(F, true); this._nlPass(P.cp.p, X.nx[n][1], [cur()], () => gl.uniform1i(P.cp.u.a, 0)); });
        this._nlPass(P.pnx.p, nxt[1], [X.nx[0][0], X.nx[1][0], X.nx[2][0], X.nx[3][0], PL.tex, acc[0]], () => { const u = P.pnx.u; gl.uniform1i(u.n0, 0); gl.uniform1i(u.n1, 1); gl.uniform1i(u.n2, 2); gl.uniform1i(u.n3, 3); gl.uniform1i(u.tab, 4); gl.uniform1i(u.acc, 5); gl.uniform1i(u.G, this._G); gl.uniform1i(u.k0, g.k0); gl.uniform1i(u.k1, g.k1); gl.uniform1f(u.ka, g.nx.a); gl.uniform1f(u.kb, g.nx.b); });
        const t3 = acc; acc = nxt; nxt = t3; continue; }
      this._fft2dS(F, false); const s0 = cur(); this._nlPass(P.mul.p, other(), [s0, g.m], () => { gl.uniform1i(P.mul.u.x, 0); gl.uniform1i(P.mul.u.t, 1); }); flip(); this._fft2dS(F, true);   // the copy's numerical aperture
      this._nlPass(P.pull.p, nxt[1], [cur(), PL.tex, acc[0]], () => { gl.uniform1i(P.pull.u.src, 0); gl.uniform1i(P.pull.u.tab, 1); gl.uniform1i(P.pull.u.acc, 2); gl.uniform1i(P.pull.u.G, this._G); gl.uniform1i(P.pull.u.k0, g.k0); gl.uniform1i(P.pull.u.k1, g.k1); });
      const t = acc; acc = nxt; nxt = t; }
    const es = this._viewEnergy(src, 'A');
    this._nlPass(P.sc.p, M.term[1], [acc[0], es], () => { gl.uniform1i(P.sc.u.w, 0); gl.uniform1i(P.sc.u.es, 1); gl.uniform1f(P.sc.u.k, +k || 0); gl.uniform1f(P.sc.u.is, Math.max(0, +isat || 0)); gl.uniform1f(P.sc.u.N, this._G * this._G); gl.uniform2f(P.sc.u.c, +cr || 0, +ci || 0); });
    return true; }
  cavObjAdd(id) { const M = this._cvS && this._cvS.get(id); if (!M) return false; const gl = this._gl, P = this._cvProgs();
    if (!this._objF) { this._objF = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this._objF); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._obj, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); this._objT = this._makePsiTex(); }
    this._nlPass(P.add.p, this._objT[1], [this._obj, M.term[0]], () => { gl.uniform1i(P.add.u.a, 0); gl.uniform1i(P.add.u.b, 1); });
    this._nlPass(P.cp.p, this._objF, [this._objT[0]], () => gl.uniform1i(P.cp.u.a, 0));   // (back into the object texture the superpose reads)
    return true; }
  cavTabHas(key) { return this.cavPlanHas(key); }
  swTabHas(key) { return !!(this._swTab && this._swTab.has(key)); }   // (a table may have been evicted — the caller re-uploads)
  //   (optional, 2026-11-03) THE EXPOSURE TABLE — any map kind (affine, exact torus, conformal, graph-directed), any K ≤ 32: swTabSet(key, data, K)
  //   uploads data = Float32Array(4·G·G·K), row k·G + y, column x: (the body-frame source point w_k⁻¹(b), its weight, 0), weight 0 off w_k's
  //   image; selfWriteStep(…, { tab: key }, pupil) then exposes Σ_k w·I(source) (bilinear, posed as writeH). Inert unless called.
  swTabSet(key, data, K) { const gl = this._gl, G = this._G; this._swTab = this._swTab || new Map(); if (this._swTab.has(key)) return; const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, G, G * K); for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G * K, gl.RGBA, gl.FLOAT, data); gl.bindTexture(gl.TEXTURE_2D, null);
    if (this._swTab.size >= 8) { const k0 = this._swTab.keys().next().value; gl.deleteTexture(this._swTab.get(k0).tex); this._swTab.delete(k0); } this._swTab.set(key, { tex, K: Math.min(32, K | 0) }); }
  _swShaderT() { if (this._swPT) return this._swPT; const gl = this._gl, p = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p, u_tab; uniform vec2 u_s; uniform float u_r, u_z, u_rate, u_iw, u_pr, u_rho; uniform int u_G, u_K; out vec4 o;
float I(ivec2 q) { vec2 v = texelFetch(u_psi, q, 0).xy; return dot(v, v); }
float Ib(vec2 x) { vec2 f = floor(x), w = x - f; int x0 = int(mod(f.x, float(u_G))), y0 = int(mod(f.y, float(u_G))), x1 = (x0 + 1) % u_G, y1 = (y0 + 1) % u_G;
  return mix(mix(I(ivec2(x0, y0)), I(ivec2(x1, y0)), w.x), mix(I(ivec2(x0, y1)), I(ivec2(x1, y1)), w.x), w.y); }
float Pb(vec2 x) { vec2 f = floor(x), w = x - f; int x0 = int(mod(f.x, float(u_G))), y0 = int(mod(f.y, float(u_G))), x1 = (x0 + 1) % u_G, y1 = (y0 + 1) % u_G;
  return mix(mix(texelFetch(u_p, ivec2(x0, y0), 0).x, texelFetch(u_p, ivec2(x1, y0), 0).x, w.x), mix(texelFetch(u_p, ivec2(x0, y1), 0).x, texelFetch(u_p, ivec2(x1, y1), 0).x, w.x), w.y); }
void main() { ivec2 b = ivec2(gl_FragCoord.xy); float c = (float(u_G) - 1.0) / 2.0, cs = cos(-u_r), sn = sin(-u_r), acc = 0.0, accP = 0.0;
  for (int k = 0; k < 32; k++) { if (k >= u_K) break; vec4 e = texelFetch(u_tab, ivec2(b.x, b.y + k * u_G), 0); if (e.z <= 0.0) continue; vec2 d = e.xy - vec2(c);
    float pw = u_pr > 0.0 ? exp(-1.386294 * pow(length(d) / u_pr, 8.0)) : 1.0; acc += pw * e.z * Ib(vec2(c) + u_s + u_z * vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs)); if (u_rho > 0.0) accP += e.z * Pb(e.xy); }
  acc += u_rho * u_iw * accP; float P = texelFetch(u_p, b, 0).x; o = vec4(P + u_rate * (acc / (acc + u_iw) - P), 0.0, 0.0, 1.0); }`), u = {}; for (const n of ['psi', 'p', 'tab', 's', 'r', 'z', 'rate', 'iw', 'pr', 'rho', 'G', 'K']) u[n] = gl.getUniformLocation(p, 'u_' + n); return (this._swPT = { p, u }); }
  selfWriteStep(id, rate, Iw, pose, hut, pupil, rho) { const M = this._sw && this._sw.get(id); if (!M) return; const TB = hut && !Array.isArray(hut) && hut.tab && this._swTab ? this._swTab.get(hut.tab) : null;
    if (TB) { const gl = this._gl, P = this._swShaderT(), q = pose || {}, psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, pIn = M.cur === 'A' ? M.A : M.B, fOut = M.cur === 'A' ? M.fB : M.fA, pr = Number.isFinite(+pupil) && +pupil > 0 && +pupil < 1 ? +pupil * this._G / 2 : 0;
      this._nlPass(P.p, fOut, [psi, pIn, TB.tex], () => { const u = P.u; gl.uniform1i(u.psi, 0); gl.uniform1i(u.p, 1); gl.uniform1i(u.tab, 2); gl.uniform2f(u.s, +q.sx || 0, +q.sy || 0); gl.uniform1f(u.r, +q.r || 0); gl.uniform1f(u.z, +q.z > 0 ? +q.z : 1); gl.uniform1f(u.rate, Math.max(0, Math.min(1, +rate || 0))); gl.uniform1f(u.iw, Math.max(1e-12, +Iw || 1)); gl.uniform1f(u.pr, pr); gl.uniform1f(u.rho, Math.max(0, Math.min(0.99, +rho || 0))); gl.uniform1i(u.G, this._G); gl.uniform1i(u.K, TB.K); });
      M.cur = M.cur === 'A' ? 'B' : 'A'; M.dirty = true; return; }
    const H = Array.isArray(hut) && hut.length ? hut.slice(0, 8) : null, gl = this._gl, P = H ? this._swShaders().writeH : this._swShaders().write; let q = pose || {};
    let psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB; const pIn = M.cur === 'A' ? M.A : M.B, fOut = M.cur === 'A' ? M.fB : M.fA;
    if (!H && q.nat && Array.isArray(q.nat.toBody)) { if (!this._swPT2) this._swPT2 = this._makePsiTex(); if (this.natChainTex(psi, q.nat.toBody, this._swPT2)) { psi = this._swPT2[0]; q = {}; } }   // (optional, 2026-11-04) the field carried into the body frame by the pose's OPTICS, then read at the cell itself
    this._nlPass(P.p, fOut, [psi, pIn], () => { const u = P.u; gl.uniform1i(u.psi, 0); gl.uniform1i(u.p, 1); gl.uniform2f(u.s, +q.sx || 0, +q.sy || 0); gl.uniform1f(u.r, +q.r || 0); gl.uniform1f(u.z, +q.z > 0 ? +q.z : 1); gl.uniform1f(u.rate, Math.max(0, Math.min(1, +rate || 0))); gl.uniform1f(u.iw, Math.max(1e-12, +Iw || 1)); gl.uniform1i(u.G, this._G);
      if (H) { const ai = new Float32Array(32), t = new Float32Array(16), w = new Float32Array(8); H.forEach((m, k) => { ai.set(m.ai, 4 * k); t[2 * k] = +m.tx || 0; t[2 * k + 1] = +m.ty || 0; w[k] = +m.w || 0; }); gl.uniform1i(u.K, H.length); gl.uniform4fv(u.ai, ai); gl.uniform2fv(u.t, t); gl.uniform1fv(u.w, w); gl.uniform1f(u.pr, +pupil > 0 && +pupil < 1 ? +pupil * this._G / 2 : 0); gl.uniform1f(u.rho, Math.max(0, Math.min(0.99, +rho || 0))); } });
    M.cur = M.cur === 'A' ? 'B' : 'A'; M.dirty = true; }
  //   selfWriteStepNx(id, rate, Iw, pose, planKey, pupil, rho) (optional, 2026-11-04) — the ✍✿ write by the EXACT PULL: planKey a cavPlanSet plan of the
  //   genome's maps (every group nx — the app's "nx" plan, body frame): each group's 2× grid of ψ (the eye's field) and of the written state B, then
  //   E(b) = Σ_k z_k²·pupil·|ψ(posed w_k⁻¹ b)|² + rho·Iw·Σ_k z_k²·B(w_k⁻¹ b) and B ← B + rate·(E/(E + Iw) − B). Returns false (nothing done) without the plan.
  selfWriteStepNx(id, rate, Iw, pose, planKey, pupil, rho) { const M = this._sw && this._sw.get(id), PL = this._cvPl && this._cvPl.get(planKey); if (!M || !PL) return false; const gl = this._gl, G = this._G, P = this._cvProgs(), q = pose || {};
    if (!this._cvX) { const mk = () => this._makePsiTex(); const a = mk(), b = mk(), c = mk(), d = mk(), e = mk(); this._cvX = { ap: a, accA: b, accB: c, F: { A: d[0], fA: d[1], B: e[0], fB: e[1], src: 'A' } }; }
    const X = this._cvX, F = X.F, cur = () => (F.src === 'A' ? F.A : F.B); if (!this._swNx) { const mk = () => this._makePsiTex(); this._swNx = { n: [mk(), mk(), mk(), mk()], kI: mk(), kP: mk(), aI: [mk(), mk()], aP: [mk(), mk()] }; } const W = this._swNx;
    const psi = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, pIn = M.cur === 'A' ? M.A : M.B, fOut = M.cur === 'A' ? M.fB : M.fA, spec = (src, dst) => { F.src = 'A'; this._nlPass(P.cp.p, F.fA, [src], () => gl.uniform1i(P.cp.u.a, 0)); this._fft2dS(F, false); this._nlPass(P.cp.p, dst[1], [cur()], () => gl.uniform1i(P.cp.u.a, 0)); };
    spec(psi, W.kI); spec(pIn, W.kP); for (const a of [W.aI[0], W.aP[0]]) this._nlPass(P.zero.p, a[1], [], () => {}); let iI = 0, iP = 0; const pr = Number.isFinite(+pupil) && +pupil > 0 && +pupil < 1 ? +pupil * G / 2 : 0;
    for (const g of PL.groups) { if (!g.nx) continue; for (const [mode, kk] of [[0, W.kI], [1, W.kP]]) { g.nx.sh.forEach((T, n) => { F.src = 'A'; this._nlPass(P.mul.p, F.fA, [kk[0], T], () => { gl.uniform1i(P.mul.u.x, 0); gl.uniform1i(P.mul.u.t, 1); }); this._fft2dS(F, true); this._nlPass(P.cp.p, W.n[n][1], [cur()], () => gl.uniform1i(P.cp.u.a, 0)); });
      const A = mode ? W.aP : W.aI, ix = mode ? iP : iI, src = A[ix], dst = A[1 - ix];
      this._nlPass(P.pnxW.p, dst[1], [W.n[0][0], W.n[1][0], W.n[2][0], W.n[3][0], PL.tex, src[0]], () => { const u = P.pnxW.u; gl.uniform1i(u.n0, 0); gl.uniform1i(u.n1, 1); gl.uniform1i(u.n2, 2); gl.uniform1i(u.n3, 3); gl.uniform1i(u.tab, 4); gl.uniform1i(u.acc, 5); gl.uniform1i(u.G, G); gl.uniform1i(u.k0, g.k0); gl.uniform1i(u.k1, g.k1); gl.uniform1i(u.mode, mode); gl.uniform1f(u.ka, g.nx.a); gl.uniform1f(u.kb, g.nx.b); gl.uniform1f(u.r, +q.r || 0); gl.uniform1f(u.z, +q.z > 0 ? +q.z : 1); gl.uniform1f(u.pr, pr); gl.uniform2f(u.s, +q.sx || 0, +q.sy || 0); });
      if (mode) iP = 1 - iP; else iI = 1 - iI; if (!(+rho > 0)) break; } }
    this._nlPass(P.swW.p, fOut, [pIn, W.aI[iI][0], W.aP[iP][0]], () => { const u = P.swW.u; gl.uniform1i(u.p, 0); gl.uniform1i(u.aI, 1); gl.uniform1i(u.aP, 2); gl.uniform1f(u.rate, Math.max(0, Math.min(1, +rate || 0))); gl.uniform1f(u.iw, Math.max(1e-12, +Iw || 1)); gl.uniform1f(u.rho, Math.max(0, Math.min(0.99, +rho || 0))); });
    M.cur = M.cur === 'A' ? 'B' : 'A'; M.dirty = true; return true; }
  selfWriteReadPosed(id) { const M = this._sw && this._sw.get(id); if (!M) return null; const gl = this._gl, G = this._G, f = new Float32Array(2 * G * G); gl.bindFramebuffer(gl.FRAMEBUFFER, M.fS); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null); const P = new Float32Array(G * G); for (let i = 0; i < G * G; i++) P[i] = f[2 * i]; return P; }
  selfWriteRead(id) { const M = this._sw && this._sw.get(id); if (!M) return null; const gl = this._gl, G = this._G, f = new Float32Array(2 * G * G); gl.bindFramebuffer(gl.FRAMEBUFFER, M.cur === 'A' ? M.fA : M.fB); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null); const P = new Float32Array(G * G); for (let i = 0; i < G * G; i++) P[i] = f[2 * i]; return P; }
  selfWriteDrop(id) { const M = this._sw && this._sw.get(id); if (!M) return; const gl = this._gl; for (const t of [M.A, M.B, M.S]) if (t) gl.deleteTexture(t); for (const f of [M.fA, M.fB, M.fS]) if (f) gl.deleteFramebuffer(f); this._sw.delete(id); if (this._gdTex) this._gdTex.delete(id); }
  //   applyEyePCF(id, k, c2, s2) (optional, 2026-10-23) — WEAK PHASE-CONJUGATE FEEDBACK inside the slot's written guide: ψ += k·S·e^{2iθ}·ψ*, S the guide
  //   texture, (c2, s2) = e^{2iθ} the pumps' phase (degenerate four-wave mixing: the light returns at 2Ω_pump − ω, so it couples the modes in pairs
  //   symmetric about the pumps' clock). k = κ·dt. Inert unless called.
  applyEyePCF(id, k, c2, s2) { const t = this._gdTex && this._gdTex.get(id); if (!t || !k) return; const gl = this._gl;
    if (!this._progPCF) { this._progPCF = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_s; uniform float u_k; uniform vec2 u_e; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy; float S = max(texelFetch(u_s, q, 0).r, 0.0);
  o = vec4(v + u_k * S * vec2(u_e.x * v.x + u_e.y * v.y, u_e.y * v.x - u_e.x * v.y), 0.0, 1.0); }`); const ul = (n) => gl.getUniformLocation(this._progPCF, n); this._uPCF = { psi: ul('u_psi'), s: ul('u_s'), k: ul('u_k'), e: ul('u_e') }; }
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, u = this._uPCF;
    this._scB(); this._nlPass(this._progPCF, fbo, [src, t], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.s, 1); gl.uniform1f(u.k, +k || 0); gl.uniform2f(u.e, +c2 || 0, +s2 || 0); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  //   applyEyeAmpTex(tex, s) — ψ ← ψ·e^{s·tex} (a real per-cell / per-mode AMPLITUDE factor, the exponent clamped to ±30): with tex = Ω(k) after fftEye
  //   it is the kinetic half of a step in IMAGINARY time. applyEyeDampGuide(id, wV, g, isat, s) — ψ ← ψ·e^{s·(wV·P(x) + g·I/(1 + I/isat))} (P the slot's guide
  //   texture, I = |ψ|²): the potential + Kerr half. Together, with the norm held, the DAMPING of the stochastic Gross–Pitaevskii equation (the
  //   medium stepping a little in complex time). Inert unless called.
  applyEyeAmpTex(tex, s) { if (!tex || !s) return; const gl = this._gl;
    if (!this._progAmpTex) { this._progAmpTex = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_t; uniform float u_s; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy; float a = exp(clamp(u_s * texelFetch(u_t, q, 0).r, -30.0, 30.0)); o = vec4(a * v, 0.0, 1.0); }`);
      const ul = (n) => gl.getUniformLocation(this._progAmpTex, n); this._uAmpTex = { psi: ul('u_psi'), t: ul('u_t'), s: ul('u_s') }; }
    const u = this._uAmpTex; this._scB(); this._eyePass(this._progAmpTex, [tex], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.t, 1); gl.uniform1f(u.s, +s); }); this._scE(); }
  applyEyeDampGuide(id, wV, g, isat, s, mu = 0) { if (!s) return;   /* (mu, optional 2026-10-28: the grand-canonical chemical potential — e^{s·(wV·P + gI/(1+I/is) − mu)}) */ const gl = this._gl, t = (this._gdTex && this._gdTex.get(id)) || null;
    if (!this._progDampG) { this._progDampG = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p; uniform float u_w, u_g, u_is, u_s, u_hp, u_mu; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy; float I = dot(v, v), P = u_hp > 0.5 ? texelFetch(u_p, q, 0).r : 0.0;
  float a = exp(clamp(u_s * (u_w * P + u_g * I / (1.0 + I / max(u_is, 1e-6)) - u_mu), -30.0, 30.0)); o = vec4(a * v, 0.0, 1.0); }`);
      const ul = (n) => gl.getUniformLocation(this._progDampG, n); this._uDampG = { psi: ul('u_psi'), p: ul('u_p'), w: ul('u_w'), g: ul('u_g'), is: ul('u_is'), s: ul('u_s'), hp: ul('u_hp'), mu: ul('u_mu') }; }
    const u = this._uDampG; this._scB(); if (!t && !this._dampDummy) this._dampDummy = this._makeRGF32Tex(); this._eyePass(this._progDampG, [t || this._dampDummy], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.p, 1); gl.uniform1f(u.w, +wV || 0); gl.uniform1f(u.g, +g || 0); gl.uniform1f(u.is, +isat || 1); gl.uniform1f(u.s, +s); gl.uniform1f(u.hp, t ? 1 : 0); gl.uniform1f(u.mu, +mu || 0); }); this._scE(); }
  //   ── THE PAIR LOG (optional, 2026-10-28; inert unless called) ──────────────────────────────────────────────────────────────────────────
  //   pairDotLog(idA, idB, k) — for two slots' CURRENT eye textures: (Re⟨a|b⟩, Im⟨a|b⟩, Σ|a|², Σ|b|²) reduced on the GPU (a row pass, then a
  //   column finish) into pixel k (0…127) of a 128×1 RGBA32F log — no readback. pairLogStart(k0, n) / pairLogReady(h) / pairLogFinish(h): an
  //   ASYNC read of n log pixels from k0 (one round trip for many beats, where a full-field read per beat cost one each).
  pairDotLog(idA, idB, k) { const gl = this._gl, G = this._G, sa = this._slotEye[idA], sb = this._slotEye[idB]; if (!sa || !sb) return false;
    if (!this._plg) { const mk = (w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null); return [t, f]; };
      const [rT, rF] = mk(1, G), [lT, lF] = mk(128, 1);
      const pr = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_a, u_b; uniform int u_G; out vec4 o;
void main() { int y = int(gl_FragCoord.y); vec4 s = vec4(0.0); for (int x = 0; x < u_G; x++) { vec2 a = texelFetch(u_a, ivec2(x, y), 0).xy, b = texelFetch(u_b, ivec2(x, y), 0).xy; s += vec4(a.x * b.x + a.y * b.y, a.x * b.y - a.y * b.x, dot(a, a), dot(b, b)); } o = s; }`);
      const pf = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_r; uniform int u_G; out vec4 o;
void main() { vec4 s = vec4(0.0); for (int y = 0; y < u_G; y++) s += texelFetch(u_r, ivec2(0, y), 0); o = s; }`);
      this._plg = { rT, rF, lT, lF, pr, pf, ur: { a: gl.getUniformLocation(pr, 'u_a'), b: gl.getUniformLocation(pr, 'u_b'), G: gl.getUniformLocation(pr, 'u_G') }, uf: { r: gl.getUniformLocation(pf, 'u_r'), G: gl.getUniformLocation(pf, 'u_G') } }; }
    const P = this._plg, ta = sa.src === 'A' ? sa.A : sa.B, tb = sb.src === 'A' ? sb.A : sb.B;
    const _sc = gl.isEnabled(gl.SCISSOR_TEST); if (_sc) gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, P.rF); gl.viewport(0, 0, 1, G); gl.useProgram(P.pr); gl.uniform1i(P.ur.a, 0); gl.uniform1i(P.ur.b, 1); gl.uniform1i(P.ur.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ta); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tb); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, P.lF); gl.viewport(k | 0, 0, 1, 1); gl.useProgram(P.pf); gl.uniform1i(P.uf.r, 0); gl.uniform1i(P.uf.G, G); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.rT); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.activeTexture(gl.TEXTURE0); if (_sc) gl.enable(gl.SCISSOR_TEST); return true; }
  pairLogStart(k0, n) { const gl = this._gl, P = this._plg; if (!P) return null; const pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 16, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, P.lF); gl.readPixels(k0 | 0, 0, n | 0, 1, gl.RGBA, gl.FLOAT, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return { pbo, fence, n: n * 4 }; }
  pairLogReady(h) { return this.readEyePsiReady(h); }
  pairLogFinish(h) { const gl = this._gl, o = new Float32Array(h.n); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, h.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, o); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); this.readEyePsiDrop(h); return o; }
  //   applyEyeBath(sig, seed, slot, step) — ψ += sig·(ξ_r + i·ξ_i), ξ ~ N(0, 1) per cell from a uint hash of (seed, slot, step, cell) + Box–Muller:
  //   a REPLICATED Langevin force (the same draw on every peer and every replay of that step). Inert unless called.
  applyEyeBath(sig, seed, slot, step) { if (!(sig > 0)) return; const gl = this._gl;
    if (!this._progBath) { this._progBath = this._compileStep(`#version 300 es
precision highp float; precision highp int;
uniform sampler2D u_psi; uniform float u_s; uniform uvec3 u_k; uniform int u_G; out vec4 o;
uint hh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy; uint c = uint(q.y * u_G + q.x);
  uint h1 = hh(c ^ hh(u_k.z ^ hh(u_k.y ^ hh(u_k.x)))), h2 = hh(h1 ^ 0x9e3779b9u);
  float a = (float(h1 >> 8) + 0.5) / 16777216.0, b = float(h2 >> 8) / 16777216.0, r = sqrt(-2.0 * log(a));
  o = vec4(v + u_s * r * vec2(cos(6.283185307179586 * b), sin(6.283185307179586 * b)), 0.0, 1.0); }`); const ul = (n) => gl.getUniformLocation(this._progBath, n); this._uBath = { psi: ul('u_psi'), s: ul('u_s'), k: ul('u_k'), G: ul('u_G') }; }
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, u = this._uBath;
    this._scB(); this._nlPass(this._progBath, fbo, [src], () => { gl.uniform1i(u.psi, 0); gl.uniform1f(u.s, sig); gl.uniform3ui(u.k, seed >>> 0, slot >>> 0, step >>> 0); gl.uniform1i(u.G, this._G); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  //   _zPof(t) — z_P = Σ S·ψ, the light's projection through a structure texture t (rows → one 1×1 texel; nothing read back): returns the pump
  //   programs with z in .zt / .zf. zRecP(id, ring): appends this sub-step's z_P (id's guide texture) to a GPU ring (R = 4096, RG32F) — a
  //   CLOCK RECORDER at the sub-step rate (no aliasing: the frame-rate samples alias above π/dt_frame); zRecRead(ring) → { z, head, n }; zRecDrop.
  //   Measurement only: the field is not touched. Inert unless called.
  _zPof(t) { const gl = this._gl, G = this._G; this._pumpInit(); const P = this._pumpP, src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, draw = () => { gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G); gl.useProgram(P.r); gl.uniform1i(P.ur.s, 0); gl.uniform1i(P.ur.psi, 1); gl.uniform1i(P.ur.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src); draw();
    gl.bindFramebuffer(gl.FRAMEBUFFER, P.zf); gl.viewport(0, 0, 1, 1); gl.useProgram(P.f); gl.uniform1i(P.uf.rows, 0); gl.uniform1i(P.uf.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._opDotTex); draw(); gl.activeTexture(gl.TEXTURE0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return P; }
  zRecP(id, ring, wTex = null) { const t = wTex || (this._gdTex && this._gdTex.get(id)); if (!t) return;   /* wTex (optional): another weight texture (.r) — e.g. the pin's symbol (srcTexOf) for an unbiased projection */ const gl = this._gl, R = 4096, P = this._zPof(t); this._zRec = this._zRec || new Map(); let M = this._zRec.get(ring);
    if (!M) { const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, R, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); M = { tx, f, head: 0, n: 0, R }; this._zRec.set(ring, M); }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, P.zf); gl.bindTexture(gl.TEXTURE_2D, M.tx); gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, M.head, 0, 0, 0, 1, 1); gl.bindTexture(gl.TEXTURE_2D, null); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    M.head = (M.head + 1) % R; M.n = Math.min(R, M.n + 1); }
  srcTexOf(key, k = 0) { const S = this._srcT && this._srcT[key]; return S ? (S[k | 0] || null) : null; }   // the texture of a source channel (read-only access, for a measurement weight)
  zRecRead(ring) { const M = this._zRec && this._zRec.get(ring); if (!M) return null; const gl = this._gl, z = new Float32Array(2 * M.R); gl.bindFramebuffer(gl.FRAMEBUFFER, M.f); gl.readPixels(0, 0, M.R, 1, gl.RG, gl.FLOAT, z); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { z, head: M.head, n: M.n, R: M.R }; }
  zRecDrop(ring) { const M = this._zRec && this._zRec.get(ring); if (!M) return; const gl = this._gl; gl.deleteTexture(M.tx); gl.deleteFramebuffer(M.f); this._zRec.delete(ring); }
  //   applyEyePCFpll(id, k, pll) (optional, 2026-10-23) — applyEyePCF with SELF-PUMPED pumps: their phase is an OSCILLATOR (the _pllStep loop, state
  //   per pll.id) locked to the light's own projection through the structure z = Σ S·ψ (mode-matched detection through the written well — no
  //   template, no computed clock): e^{2iθ} = u², u the oscillator's phasor. pll = { id, kp, ki, kf, sl, dt, init, w0 } (init 2: u = z/|z|, Ω = w0).
  //   The state is read / set / dropped with pllRead / pllSet / pllDrop(pll.id). Inert unless called.
  applyEyePCFpll(id, k, pll, bal = 0) {   /* bal 1: the conjugation BALANCED by an equal loss, ψ += k·S·(u²ψ* − ψ) — a degenerate parametric amplifier at its depleted-pump steady state (gain = loss): the in-phase quadrature kept, the other damped; no energy added */ const t = this._gdTex && this._gdTex.get(id); if (!t || !k) return; const gl = this._gl;   /* pll null: the pumps ARE the light's instant projection, u = z/|z| (no oscillator — the literal self-pumped conjugator) */
    const P = this._zPof(t), src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const uz = pll ? this._pllStep({ ...pll, mode: 0 }, P.zt, [1, 0]) : P.zt;   // the pumps' oscillator, locked to z (or z itself)
    this._scB(); this._nlPass(P.a, fbo, [src, t, uz], () => { gl.uniform1i(P.ua.psi, 0); gl.uniform1i(P.ua.s, 1); gl.uniform1i(P.ua.u, 2); gl.uniform1f(P.ua.k, +k || 0); gl.uniform1f(P.ua.bal, +bal || 0); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  _pumpInit() { const gl = this._gl;
    if (!this._pumpP) { const mk = (src) => this._compileStep(src);
      const r = mk(`#version 300 es
precision highp float;
uniform sampler2D u_s, u_psi; uniform int u_G; out vec4 o;
void main() { int y = int(gl_FragCoord.y); vec2 a = vec2(0.0);
  for (int x = 0; x < u_G; x++) { ivec2 q = ivec2(x, y); a += max(texelFetch(u_s, q, 0).r, 0.0) * texelFetch(u_psi, q, 0).xy; }
  o = vec4(a, 0.0, 1.0); }`), f = mk(`#version 300 es
precision highp float;
uniform sampler2D u_rows; uniform int u_G; out vec4 o;
void main() { vec2 a = vec2(0.0); for (int y = 0; y < u_G; y++) a += texelFetch(u_rows, ivec2(0, y), 0).xy; o = vec4(a, 0.0, 1.0); }`), a = mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_s, u_u; uniform float u_k, u_bal; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy, u = texelFetch(u_u, ivec2(0), 0).xy; float S = max(texelFetch(u_s, q, 0).r, 0.0), mu = length(u); u = mu > 1e-30 ? u / mu : vec2(1.0, 0.0);
  vec2 e = vec2(u.x * u.x - u.y * u.y, 2.0 * u.x * u.y);
  o = vec4(v + u_k * S * (vec2(e.x * v.x + e.y * v.y, e.y * v.x - e.x * v.y) - u_bal * v), 0.0, 1.0); }`);
      const zt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, zt); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, 1, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const zf = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, zf); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, zt, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const ul = (p, n) => gl.getUniformLocation(p, n); this._pumpP = { r, f, a, zt, zf, ur: { s: ul(r, 'u_s'), psi: ul(r, 'u_psi'), G: ul(r, 'u_G') }, uf: { rows: ul(f, 'u_rows'), G: ul(f, 'u_G') }, ua: { psi: ul(a, 'u_psi'), s: ul(a, 'u_s'), u: ul(a, 'u_u'), k: ul(a, 'u_k'), bal: ul(a, 'u_bal') } }; }
  }
  //   ── THE COUPLING SHEAF's OPERATOR EDGES (optional, 2026-10-26; inert unless called) ──────────────────────────────────────────────────────
  //   makePhaseTex(f32) — an R32F G×G table Θ (e.g. the medium's own per-mode phase Ω(k), natural FFT order); applyEyePhaseTex(tex, s) —
  //   ψ ← ψ·e^{i·s·Θ} on the active eye buffer (in whatever domain it holds: after fftEye(false) it multiplies the spectrum — a Fourier–Mukai
  //   kernel diagonal on the dual torus, e.g. the medium's propagator made unitary, P(τ) = e^{iτΩ(k)}).
  makePhaseTex(f32) { const gl = this._gl, G = this._G, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, G, G);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RED, gl.FLOAT, f32); gl.bindTexture(gl.TEXTURE_2D, null); return t; }
  freePhaseTex(t) { if (t) this._gl.deleteTexture(t); }
  applyEyePhaseTex(tex, s) { if (!tex || !s) return; const gl = this._gl;
    if (!this._progPhTex) { this._progPhTex = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_th; uniform float u_s; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy; float a = u_s * texelFetch(u_th, q, 0).r, c = cos(a), n = sin(a); o = vec4(c * v.x - n * v.y, n * v.x + c * v.y, 0.0, 1.0); }`);
      const ul = (n) => gl.getUniformLocation(this._progPhTex, n); this._uPhTex = { psi: ul('u_psi'), th: ul('u_th'), s: ul('u_s') }; }
    const u = this._uPhTex; this._scB(); this._eyePass(this._progPhTex, [tex], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.th, 1); gl.uniform1f(u.s, +s); }); this._scE(); }
  //   applyEyeMetricK(gTex, s) — THE MEDIUM's OWN METRIC on a spectrum (the active eye buffer after fftEye(false)): the medium's linear step is, per mode,
  //   a 2×2 SYMPLECTIC map on (R̂, Î) (the spectra of Re ψ and Im ψ) conserving Q = |R̂|² + r(k)·|Î|²; in METRIC coordinates (R̂, √r·Î) it is a pure
  //   rotation. This pass scales Î by g^s (g = √r, the table gTex, even in k), R̂ untouched: ψ̂′(k) = ½(1 + g^s)·ψ̂(k) + ½(1 − g^s)·conj ψ̂(−k)
  //   (R-linear: it reads the mode and its mirror). s = +1 into metric coordinates, −1 back. Inert unless called.
  applyEyeMetricK(gTex, s = 1) { if (!gTex) return; const gl = this._gl, G = this._G;
    if (!this._progMetK) { this._progMetK = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_hat, u_g; uniform float u_s; uniform int u_G; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy), m = ivec2((u_G - q.x) % u_G, (u_G - q.y) % u_G); vec2 h = texelFetch(u_hat, q, 0).xy, hm = texelFetch(u_hat, m, 0).xy;
  float g = texelFetch(u_g, q, 0).r; g = u_s > 0.0 ? g : 1.0 / max(g, 1e-6); float a = 0.5 * (1.0 + g), b = 0.5 * (1.0 - g);
  o = vec4(a * h.x + b * hm.x, a * h.y - b * hm.y, 0.0, 1.0); }`);
      const ul = (n) => gl.getUniformLocation(this._progMetK, n); this._uMetK = { hat: ul('u_hat'), g: ul('u_g'), s: ul('u_s'), G: ul('u_G') }; }
    const u = this._uMetK; this._scB(); this._eyePass(this._progMetK, [gTex], () => { gl.uniform1i(u.hat, 0); gl.uniform1i(u.g, 1); gl.uniform1f(u.s, +s); gl.uniform1i(u.G, G); }); this._scE(); }
  //   cplExactSlots(ids, edges, dt, dom, omTex) — THE POINTWISE EXACT STEP of a component of up to 4 slots: at every point p (a cell, dom 0; a mode
  //   after fftEye, dom 1) ψ(p) ← exp(−i·H(p)·dt)·ψ(p), H(p) the n×n connection matrix with each edge's phase φ_e + its operator's phase at p
  //   (dom 0: the prism 2π(mx·dx + my·dy)/G and the lens lens·(Qx + Qy) — applyEyePhaseTilt's formulas; dom 1: τ_e·Ω(p), Ω from omTex).
  //   Exact (Taylor to order 16 on the vector; ‖H·dt‖ ≲ 1, f32-limited), no splitting, no ordering — the holonomy may vary from point to point
  //   (a loop whose operators do not cancel). Reads every slot's resident field and writes each one's other half, then flips the parities
  //   (the sources held stable across the n passes, as quatMixEyeSlots). edges: [{ a, b (indices into ids), k, ph, mx, my, lens, tau, dir }] ≤ 8;
  //   dir: a ONE-WAY arrow a → b (H gets only its b-row term: exp of a nilpotent part — exact; the source does not feel it).
  //   diag (optional, 2026-10-26): [d0..d3] added to H's diagonal (the native form's degree term); xom (optional): in dom 0 read omTex too and add
  //   tau·Ω(x) to an edge's phase (the medium's propagator's Fourier dual — the native lens; omTex then indexed by the cell). Defaults: as before.
  //   e.taui (optional, 2026-10-26): s ≥ 0 — in dom 1 the edge's term × e^{s·min(Ω, 0)} ≤ 1 (a COMPLEX τ − i·s on the contracting side: a loss arrow); 0 = as before.
  cplExactSlots(ids, edges, dt, dom = 0, omTex = null, diag = null, xom = false) { const gl = this._gl, G = this._G, n = ids.length; if (n < 2 || n > 4 || !edges.length || edges.length > 8) return false;
    const S = ids.map((id) => this._slotEye[id]); if (S.some((s) => !s || !s.primed)) return false;
    if (!this._progCplX) { this._progCplX = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_s0, u_s1, u_s2, u_s3, u_om; uniform int u_n, u_t, u_m, u_dom, u_xom; uniform vec4 u_e0[8], u_e1[8], u_dg; uniform float u_dir[8], u_ls[8]; uniform float u_dt, u_G; out vec4 o;
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 H[16]; for (int i = 0; i < 16; i++) H[i] = vec2(0.0);
  float c0 = (u_G - 1.0) * 0.5, w = 6.283185307179586 / u_G, dx = float(q.x) - c0, dy = float(q.y) - c0, Q = -(1.0 - cos(w * dx)) / (w * w) - (1.0 - cos(w * dy)) / (w * w), Om = (u_dom == 1 || u_xom == 1) ? texelFetch(u_om, q, 0).r : 0.0;
  for (int e = 0; e < 8; e++) { if (e >= u_m) break; int a = int(u_e0[e].x), b = int(u_e0[e].y); float k = u_e0[e].z, p = u_e0[e].w + (u_dom == 0 ? (w * (u_e1[e].x * dx + u_e1[e].y * dy) + u_e1[e].z * Q + (u_xom == 1 ? u_e1[e].w * Om : 0.0)) : u_e1[e].w * Om);
    float am = (u_dom == 1 && u_ls[e] > 0.0) ? exp(u_ls[e] * min(Om, 0.0)) : 1.0; vec2 h = k * am * vec2(cos(p), sin(p)); if (u_dir[e] > 0.5) H[b * 4 + a] += h; else { H[a * 4 + b] += h; H[b * 4 + a] += vec2(h.x, -h.y); } }
  for (int i = 0; i < 4; i++) H[i * 4 + i] += vec2(u_dg[i], 0.0);   /* diag: H's diagonal (the degree term, optional; zero = as before) */   /* dir: a ONE-WAY arrow a → b (ψ_b += −i·κ·dt·O(ψ_a), the source untouched — an observation re-injected) */
  vec2 v[4]; v[0] = texelFetch(u_s0, q, 0).xy; v[1] = u_n > 1 ? texelFetch(u_s1, q, 0).xy : vec2(0.0); v[2] = u_n > 2 ? texelFetch(u_s2, q, 0).xy : vec2(0.0); v[3] = u_n > 3 ? texelFetch(u_s3, q, 0).xy : vec2(0.0);
  vec2 acc[4], tm[4]; for (int i = 0; i < 4; i++) { acc[i] = v[i]; tm[i] = v[i]; }
  for (int j = 1; j <= 16; j++) { vec2 nx[4]; for (int i = 0; i < 4; i++) { vec2 s = vec2(0.0); for (int l = 0; l < 4; l++) s += cm(H[i * 4 + l], tm[l]); nx[i] = vec2(s.y, -s.x) * (u_dt / float(j)); }   /* (−i·dt·H)·term / j */
    for (int i = 0; i < 4; i++) { tm[i] = nx[i]; acc[i] += nx[i]; } }
  vec2 r = acc[0]; for (int i = 1; i < 4; i++) if (i == u_t) r = acc[i]; o = vec4(r, 0.0, 1.0); }`);
      const ul = (nm) => gl.getUniformLocation(this._progCplX, nm); this._uCplX = { s: [0, 1, 2, 3].map((i) => ul('u_s' + i)), om: ul('u_om'), n: ul('u_n'), t: ul('u_t'), m: ul('u_m'), dom: ul('u_dom'), e0: ul('u_e0'), e1: ul('u_e1'), dir: ul('u_dir'), dt: ul('u_dt'), G: ul('u_G'), dg: ul('u_dg'), xom: ul('u_xom'), ls: ul('u_ls') }; }
    const P = this._progCplX, u = this._uCplX, e0 = new Float32Array(32), e1 = new Float32Array(32), dr = new Float32Array(8), ls = new Float32Array(8);
    edges.forEach((e, k) => { e0.set([e.a, e.b, +e.k || 0, +e.ph || 0], 4 * k); e1.set([+e.mx || 0, +e.my || 0, +e.lens || 0, +e.tau || 0], 4 * k); dr[k] = e.dir ? 1 : 0; ls[k] = Math.max(0, +e.taui || 0); });
    const srcs = S.map((s) => s.src === 'A' ? s.A : s.B), dsts = S.map((s) => s.src === 'A' ? s.fB : s.fA);
    gl.useProgram(P); gl.viewport(0, 0, G, G); gl.uniform1i(u.n, n); gl.uniform1i(u.m, edges.length); gl.uniform1i(u.dom, dom | 0); gl.uniform4fv(u.e0, e0); gl.uniform4fv(u.e1, e1); gl.uniform1fv(u.dir, dr); gl.uniform1fv(u.ls, ls); gl.uniform1f(u.dt, +dt); gl.uniform1f(u.G, G); gl.uniform4f(u.dg, +(diag?.[0]) || 0, +(diag?.[1]) || 0, +(diag?.[2]) || 0, +(diag?.[3]) || 0); gl.uniform1i(u.xom, xom ? 1 : 0);
    for (let i = 0; i < 4; i++) { gl.uniform1i(u.s[i], i); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, srcs[Math.min(i, n - 1)]); }
    gl.uniform1i(u.om, 4); gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, omTex || srcs[0]);
    gl.bindVertexArray(this._vao); for (let t = 0; t < n; t++) { gl.bindFramebuffer(gl.FRAMEBUFFER, dsts[t]); gl.uniform1i(u.t, t); gl.drawArrays(gl.TRIANGLES, 0, 6); } gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.activeTexture(gl.TEXTURE0); for (const s of S) s.src = s.src === 'A' ? 'B' : 'A'; return true; }
  //   cplLeapSlots(ids, edges, dt, dom, omTex, diag, xom, sub) (optional, 2026-10-26) — THE COUPLERS IN THE MEDIUM's OWN INTEGRATOR: at every point p
  //   (a cell, dom 0; a mode after fftEye, dom 1) the component's ψ̇ = −i·H(p)·ψ (n ≤ 8 slots, ≤ 16 undirected edges, the same phases as cplExactSlots:
  //   prism / lens / xtau·Ω(x) in dom 0, tau·Ω(k) in dom 1; diag = H's diagonal) integrated by STÖRMER–VERLET on (R, I) for H's real symmetric part
  //   (R += h/2·H_r·I; I −= h·H_r·R; R += h/2·H_r·I — the medium's own leapfrog form) and EXACT rotations for its antisymmetric part H_i (per edge,
  //   palindromic: half forward, half back), sub sub-steps of h = dt/sub — in a GAUGE frame per point (a spanning-tree phase θ_v: every tree edge real,
  //   the loops keep their holonomy), so a component without flux is entirely real and its sections are fixed EXACTLY. Explicit, local, symplectic (a modified energy conserved; the plain norm
  //   breathes O(h²), as the medium's own); a section with real phases is fixed EXACTLY (H_r·x = 0). Writes every slot's other half, flips parities.
  cplLeapSlots(ids, edges, dt, dom = 0, omTex = null, diag = null, xom = false, sub = 1) { const gl = this._gl, G = this._G, n = ids.length, ne = edges.length; if (n < 2 || n > 8 || !ne || ne > 16) return false;
    const S = ids.map((id) => this._slotEye[id]); if (S.some((s) => !s || !s.primed)) return false;
    const ord = [0], par = new Array(n).fill(-1), dirB = new Array(n).fill(0), seen = new Set([0]);   /* the spanning tree (BFS from slot 0) */
    for (let h = 0; h < ord.length; h++) { const v = ord[h]; edges.forEach((e, k) => { const w = e.a === v ? e.b : e.b === v ? e.a : -1; if (w < 0 || seen.has(w)) return; seen.add(w); par[w] = k; dirB[w] = e.a === v ? 1 : -1; ord.push(w); }); }
    //   THE GRAPH COMPILED INTO THE STENCIL: the program is generated per structure (n, the edges' ends, the tree, the domain) — every slot and edge index a
    //   literal (registers, no dynamic indexing), only κ, φ and the operators' parameters uniforms; cached per structure key.
    const key = n + "|" + edges.map((e) => e.a + "-" + e.b).join(",") + "|" + (dom | 0) + (xom ? "x" : "") + "|" + par.join(",") + "|" + dirB.join(",");
    this._cplLP = this._cplLP || new Map(); let P = this._cplLP.get(key);
    if (!P) { const L = [], I = (i) => i, rng = (k) => Array.from({ length: k }, (_, q) => q);
      L.push("#version 300 es", "precision highp float;", "uniform sampler2D " + rng(n).map((i) => "u_s" + i).join(", ") + ", u_om; uniform int u_sub; uniform vec4 u_e0[" + ne + "], u_e1[" + ne + "]; uniform float u_dg[" + n + "]; uniform float u_h, u_G;");
      L.push(rng(n).map((i) => "layout(location = " + i + ") out vec4 o" + i + ";").join(" "));
      L.push("void main() { ivec2 q = ivec2(gl_FragCoord.xy); float c0 = (u_G - 1.0) * 0.5, w = 6.283185307179586 / u_G, dx = float(q.x) - c0, dy = float(q.y) - c0, Q = -(1.0 - cos(w * dx)) / (w * w) - (1.0 - cos(w * dy)) / (w * w), Om = " + ((dom | 0) === 1 || xom ? "texelFetch(u_om, q, 0).r" : "0.0") + ";");
      edges.forEach((e, k) => L.push("  float p" + k + " = u_e0[" + k + "].w + " + ((dom | 0) === 0 ? "(w * (u_e1[" + k + "].x * dx + u_e1[" + k + "].y * dy) + u_e1[" + k + "].z * Q" + (xom ? " + u_e1[" + k + "].w * Om" : "") + ")" : "u_e1[" + k + "].w * Om") + ";"));
      L.push("  float t0 = 0.0;"); for (let v = 1; v < n; v++) if (!seen.has(v)) L.push("  float t" + v + " = 0.0;");   /* (a slot no edge reaches: no gauge) */ for (let h = 1; h < ord.length; h++) { const v = ord[h], k = par[v], e = edges[k]; L.push("  float t" + v + " = " + (dirB[v] > 0 ? "t" + e.a + " - p" + k : "t" + e.b + " + p" + k) + ";"); }   /* the gauge θ (every tree edge real) */
      edges.forEach((e, k) => L.push("  float pq" + k + " = p" + k + " + t" + e.b + " - t" + e.a + ", ec" + k + " = u_e0[" + k + "].z * cos(pq" + k + "), es" + k + " = u_e0[" + k + "].z * sin(pq" + k + ");"));
      rng(n).forEach((i) => L.push("  vec2 z" + i + " = texelFetch(u_s" + i + ", q, 0).xy; float g" + i + "c = cos(t" + I(i) + "), g" + i + "s = sin(t" + I(i) + "); vec2 v" + i + " = vec2(g" + i + "c * z" + i + ".x + g" + i + "s * z" + i + ".y, g" + i + "c * z" + i + ".y - g" + i + "s * z" + i + ".x);"));
      const Hx = (i, comp) => { const t = ["u_dg[" + i + "] * v" + i + "." + comp]; edges.forEach((e, k) => { if (e.a === i) t.push("ec" + k + " * v" + e.b + "." + comp); else if (e.b === i) t.push("ec" + k + " * v" + e.a + "." + comp); }); return t.join(" + "); };
      const rot = (k) => { const e = edges[k]; return "    { float r = es" + k + " * u_h * 0.5, cc = cos(r), sn = sin(r); vec2 za = v" + e.a + ", zb = v" + e.b + "; v" + e.a + " = cc * za + sn * zb; v" + e.b + " = -sn * za + cc * zb; }"; };
      L.push("  for (int st = 0; st < 256; st++) { if (st >= u_sub) break;");
      rng(ne).forEach((k) => L.push(rot(k)));   /* ψ̇ = H_i·ψ, exact, half — forward */
      L.push("    { " + rng(n).map((i) => "float a" + i + " = " + Hx(i, "y") + ";").join(" ") + " " + rng(n).map((i) => "v" + i + ".x += 0.5 * u_h * a" + i + ";").join(" ") + " }");   /* R += h/2·H_r·I */
      L.push("    { " + rng(n).map((i) => "float b" + i + " = " + Hx(i, "x") + ";").join(" ") + " " + rng(n).map((i) => "v" + i + ".y -= u_h * b" + i + ";").join(" ") + " }");   /* I −= h·H_r·R */
      L.push("    { " + rng(n).map((i) => "float a" + i + " = " + Hx(i, "y") + ";").join(" ") + " " + rng(n).map((i) => "v" + i + ".x += 0.5 * u_h * a" + i + ";").join(" ") + " }");
      rng(ne).reverse().forEach((k) => L.push(rot(k)));   /* the other half, reversed */
      L.push("  }"); rng(n).forEach((i) => L.push("  o" + i + " = vec4(g" + i + "c * v" + i + ".x - g" + i + "s * v" + i + ".y, g" + i + "s * v" + i + ".x + g" + i + "c * v" + i + ".y, 0.0, 1.0);")); L.push("}");
      const prog = this._compileStep(L.join("\n")), ul = (nm) => gl.getUniformLocation(prog, nm);
      P = { prog, u: { s: rng(n).map((i) => ul("u_s" + i)), om: ul("u_om"), sub: ul("u_sub"), e0: ul("u_e0"), e1: ul("u_e1"), dg: ul("u_dg"), h: ul("u_h"), G: ul("u_G") } }; this._cplLP.set(key, P); }
    const u = P.u, e0 = new Float32Array(4 * ne), e1 = new Float32Array(4 * ne), dg = new Float32Array(n), m = Math.max(1, Math.min(256, sub | 0));
    edges.forEach((e, k) => { e0.set([e.a, e.b, +e.k || 0, +e.ph || 0], 4 * k); e1.set([+e.mx || 0, +e.my || 0, +e.lens || 0, +e.tau || 0], 4 * k); }); if (diag) for (let i = 0; i < n; i++) dg[i] = +diag[i] || 0;
    const srcs = S.map((s) => s.src === 'A' ? s.A : s.B), dtx = S.map((s) => s.src === 'A' ? s.B : s.A);
    gl.useProgram(P.prog); gl.viewport(0, 0, G, G); gl.uniform1i(u.sub, m); gl.uniform4fv(u.e0, e0); gl.uniform4fv(u.e1, e1); gl.uniform1fv(u.dg, dg); gl.uniform1f(u.h, +dt / m); gl.uniform1f(u.G, G);
    for (let i = 0; i < n; i++) { gl.uniform1i(u.s[i], i); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, srcs[i]); }
    gl.uniform1i(u.om, 8); gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, omTex || srcs[0]);
    this._cplLF = this._cplLF || new Map(); this._cplTexN = this._cplTexN || 0; const fk = dtx.map((t) => t._cplId || (t._cplId = ++this._cplTexN)).join(",");   /* one framebuffer per set of target textures (2 per component: the parities), attached once — a re-attach per call made the driver rebuild its render pass */
    let fb = this._cplLF.get(fk); if (!fb) { fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); for (let i = 0; i < n; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, dtx[i], 0); gl.drawBuffers(Array.from({ length: n }, (_, i) => gl.COLOR_ATTACHMENT0 + i)); this._cplLF.set(fk, fb); if (this._cplLF.size > 64) { const [k0, f0] = this._cplLF.entries().next().value; this._cplLF.delete(k0); gl.deleteFramebuffer(f0); } }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.activeTexture(gl.TEXTURE0); for (const s of S) s.src = s.src === 'A' ? 'B' : 'A'; return true; }
  //   cplExpSlots(ids, edges, dt, dom, omTex, diag, xom, sub) (optional, 2026-10-26) — THE EXACT POINTWISE STEP, COMPILED: cplExactSlots' law (at every point
  //   ψ ← exp(−i·H(p)·dt)·ψ, the same phases, diag, one-way arrows e.dir, the contracting factor e.taui in dom 1) for n ≤ 8 slots and ≤ 16 edges, the program
  //   generated per structure (literal slot / edge indices, H sparse), a 16-term Taylor per sub-step, sub sub-steps of dt/sub (exact composition), every
  //   slot written in one pass (multiple render targets). Inert unless called.
  cplExpSlots(ids, edges, dt, dom = 0, omTex = null, diag = null, xom = false, sub = 1) { const gl = this._gl, G = this._G, n = ids.length, ne = edges.length; if (n < 2 || n > 8 || !ne || ne > 16) return false;
    const S = ids.map((id) => this._slotEye[id]); if (S.some((s) => !s || !s.primed)) return false;
    const key = n + "|" + edges.map((e) => e.a + "-" + e.b + (e.dir ? ">" : "") + (+e.taui > 0 ? "L" : "")).join(",") + "|" + (dom | 0) + (xom ? "x" : "");
    this._cplXP = this._cplXP || new Map(); let P = this._cplXP.get(key);
    if (!P) { const L = [], rng = (k) => Array.from({ length: k }, (_, q) => q), d1 = (dom | 0) === 1;
      L.push("#version 300 es", "precision highp float;", "uniform sampler2D " + rng(n).map((i) => "u_s" + i).join(", ") + ", u_om; uniform int u_sub; uniform vec4 u_e0[" + ne + "], u_e1[" + ne + "]; uniform float u_ls[" + ne + "], u_dg[" + n + "]; uniform float u_h, u_G;");
      L.push(rng(n).map((i) => "layout(location = " + i + ") out vec4 o" + i + ";").join(" "));
      L.push("vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }");
      L.push("void main() { ivec2 q = ivec2(gl_FragCoord.xy); float c0 = (u_G - 1.0) * 0.5, w = 6.283185307179586 / u_G, dx = float(q.x) - c0, dy = float(q.y) - c0, Q = -(1.0 - cos(w * dx)) / (w * w) - (1.0 - cos(w * dy)) / (w * w), Om = " + (d1 || xom ? "texelFetch(u_om, q, 0).r" : "0.0") + ";");
      edges.forEach((e, k) => { L.push("  float p" + k + " = u_e0[" + k + "].w + " + (!d1 ? "(w * (u_e1[" + k + "].x * dx + u_e1[" + k + "].y * dy) + u_e1[" + k + "].z * Q" + (xom ? " + u_e1[" + k + "].w * Om" : "") + ")" : "u_e1[" + k + "].w * Om") + ";");
        L.push("  vec2 h" + k + " = u_e0[" + k + "].z * " + (d1 && +e.taui > 0 ? "exp(u_ls[" + k + "] * min(Om, 0.0)) * " : "") + "vec2(cos(p" + k + "), sin(p" + k + "));"); });
      const row = (i) => { const t = ["u_dg[" + i + "] * x" + i]; edges.forEach((e, k) => { if (e.dir) { if (e.b === i) t.push("cm(h" + k + ", x" + e.a + ")"); } else { if (e.a === i) t.push("cm(h" + k + ", x" + e.b + ")"); if (e.b === i) t.push("cm(vec2(h" + k + ".x, -h" + k + ".y), x" + e.a + ")"); } }); return t.join(" + "); };   /* (H·x)_i: diag + H_ab = κe^{ip} (h.c. back; an arrow only its b-row) */
      rng(n).forEach((i) => L.push("  vec2 v" + i + " = texelFetch(u_s" + i + ", q, 0).xy;"));
      L.push("  for (int st = 0; st < 256; st++) { if (st >= u_sub) break;", "    " + rng(n).map((i) => "vec2 x" + i + " = v" + i + ", a" + i + " = v" + i + ";").join(" "));
      L.push("    for (int j = 1; j <= 16; j++) { float f = u_h / float(j); " + rng(n).map((i) => "vec2 y" + i + " = " + row(i) + ";").join(" ") + " " + rng(n).map((i) => "x" + i + " = vec2(y" + i + ".y, -y" + i + ".x) * f; a" + i + " += x" + i + ";").join(" ") + " }");   /* (−i·h·H)·term / j */
      L.push("    " + rng(n).map((i) => "v" + i + " = a" + i + ";").join(" ") + " }");
      rng(n).forEach((i) => L.push("  o" + i + " = vec4(v" + i + ", 0.0, 1.0);")); L.push("}");
      const prog = this._compileStep(L.join("\n")), ul = (nm) => gl.getUniformLocation(prog, nm);
      P = { prog, u: { s: rng(n).map((i) => ul("u_s" + i)), om: ul("u_om"), sub: ul("u_sub"), e0: ul("u_e0"), e1: ul("u_e1"), ls: ul("u_ls"), dg: ul("u_dg"), h: ul("u_h"), G: ul("u_G") } }; this._cplXP.set(key, P); }
    const u = P.u, e0 = new Float32Array(4 * ne), e1 = new Float32Array(4 * ne), ls = new Float32Array(ne), dg = new Float32Array(n), m = Math.max(1, Math.min(256, sub | 0));
    edges.forEach((e, k) => { e0.set([e.a, e.b, +e.k || 0, +e.ph || 0], 4 * k); e1.set([+e.mx || 0, +e.my || 0, +e.lens || 0, +e.tau || 0], 4 * k); ls[k] = Math.max(0, +e.taui || 0); }); if (diag) for (let i = 0; i < n; i++) dg[i] = +diag[i] || 0;
    const srcs = S.map((s) => s.src === 'A' ? s.A : s.B), dtx = S.map((s) => s.src === 'A' ? s.B : s.A);
    gl.useProgram(P.prog); gl.viewport(0, 0, G, G); gl.uniform1i(u.sub, m); gl.uniform4fv(u.e0, e0); gl.uniform4fv(u.e1, e1); if (u.ls) gl.uniform1fv(u.ls, ls); gl.uniform1fv(u.dg, dg); gl.uniform1f(u.h, +dt / m); gl.uniform1f(u.G, G);
    for (let i = 0; i < n; i++) { gl.uniform1i(u.s[i], i); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, srcs[i]); }
    gl.uniform1i(u.om, 8); gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, omTex || srcs[0]);
    this._cplLF = this._cplLF || new Map(); this._cplTexN = this._cplTexN || 0; const fk = dtx.map((t) => t._cplId || (t._cplId = ++this._cplTexN)).join(",");
    let fb = this._cplLF.get(fk); if (!fb) { fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); for (let i = 0; i < n; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, dtx[i], 0); gl.drawBuffers(Array.from({ length: n }, (_, i) => gl.COLOR_ATTACHMENT0 + i)); this._cplLF.set(fk, fb); if (this._cplLF.size > 64) { const [k0, f0] = this._cplLF.entries().next().value; this._cplLF.delete(k0); gl.deleteFramebuffer(f0); } }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.activeTexture(gl.TEXTURE0); for (const s of S) s.src = s.src === 'A' ? 'B' : 'A'; return true; }
  //   applyEyeGain(id, g, l, Is, dt) (optional, 2026-10-22) — a GAIN MEDIUM where the slot's written guide is: ψ ← ψ·e^{(g·S/(1 + |ψ|²/Is) − l)·dt},
  //   S the guide texture (setGuideField id): saturable gain in the structure, a uniform real loss everywhere — local, per cell (a laser's active
  //   core in an absorbing host). Inert unless called. capE > 0 and capP ∈ (0, 1]: the energy cap's PART in the same pass — ψ ·= (capE/E)^(capP/2)
  //   (E = Σ|ψ|² reduced on the GPU, sampled, nothing read back): the global cap and the local gain blended (a handover between the two).
  applyEyeGain(id, g, l, Is, dt, capE = 0, capP = 0) { const t = this._gdTex && this._gdTex.get(id); if (!t) return; const gl = this._gl;
    if (!this._progGain) { this._progGain = this._compileStep(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_s, u_e; uniform float u_g, u_l, u_is, u_dt, u_ce, u_cp; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy; float I = dot(v, v), S = texelFetch(u_s, q, 0).r;
  float c = 1.0; if (u_cp > 0.0) { float E = texelFetch(u_e, ivec2(0), 0).x; if (E > 1e-9) c = pow(u_ce / E, 0.5 * u_cp); }
  o = vec4(v * c * exp((u_g * S / (1.0 + I / u_is) - u_l) * u_dt), 0.0, 1.0); }`); const ul = (n) => gl.getUniformLocation(this._progGain, n); this._uGain = { psi: ul('u_psi'), s: ul('u_s'), e: ul('u_e'), g: ul('u_g'), l: ul('u_l'), is: ul('u_is'), dt: ul('u_dt'), ce: ul('u_ce'), cp: ul('u_cp') }; }
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, u = this._uGain, cp = (+capE > 0) ? Math.max(0, Math.min(1, +capP || 0)) : 0;
    if (cp > 0) { this.opCycleInit(); const ur = this._u.energyRows; gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(this._G); gl.useProgram(this._progEnergyRows); gl.uniform1i(ur.a, 0); gl.uniform1i(ur.G, this._G);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); this._opColFinish('A'); }
    this._scB(); this._nlPass(this._progGain, fbo, [src, t, cp > 0 ? this._opSclA : t], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.s, 1); gl.uniform1i(u.e, 2); gl.uniform1f(u.g, +g || 0); gl.uniform1f(u.l, +l || 0); gl.uniform1f(u.is, Math.max(1e-12, +Is || 1)); gl.uniform1f(u.dt, +dt || 0); gl.uniform1f(u.ce, +capE || 0); gl.uniform1f(u.cp, cp); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  //   gainLineStep(id, g, l, Is, dt, capE, capP, om, gam) (optional, 2026-10-22) — the GAIN MEDIUM with a LINE: a resonant memory p per cell (its own
  //   RG32F pair per id) p ← e^{(−gam + i·om)·dt}·p + (1 − e^{−gam·dt})·ψ (at ψ ∝ e^{i·om·t} p = ψ exactly; off resonance a Lorentzian of width gam),
  //   then ψ ← c·e^{−l·dt}·(ψ + (e^{G·dt} − 1)·p), G = g·S/(1 + |p|²/Is) — only the light at the line's frequency is amplified (and saturates the
  //   gain); everything else meets the host's loss. c = the energy cap's part (capE/E)^(capP/2) as applyEyeGain. gainLineRead / Set / Drop: the
  //   memory as state (a join seed ships it). Inert unless called.
  //   learn > 0 (optional, 2026-10-23 — N3, spectral hole burning): the line's centre is a per-cell texture Ω(x) (initialised to om) that drifts toward
  //   the frequency of the light it amplifies: Ω ← Ω + learn·dt·arg(ψ·p̄) — the light leads the line's memory when it is bluer (a local error, no sum).
  //   gainOmRead / gainOmSet: that texture as state (a join seed ships it).
  gainLineStep(id, g, l, Is, dt, capE = 0, capP = 0, om = 0, gam = 1, learn = 0) { const t = this._gdTex && this._gdTex.get(id); if (!t) return; const gl = this._gl, G = this._G;
    if (!this._glP) { const mk = (src, names) => { const p = this._compileStep(src), u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, 'u_' + n); return { p, u }; };
      this._glP = { pol: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p; uniform vec2 u_a; uniform float u_b; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 p = texelFetch(u_p, q, 0).xy, v = texelFetch(u_psi, q, 0).xy;
  o = vec4(vec2(u_a.x * p.x - u_a.y * p.y, u_a.x * p.y + u_a.y * p.x) + u_b * v, 0.0, 1.0); }`, ['psi', 'p', 'a', 'b']), amp: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p, u_s, u_e; uniform float u_g, u_l, u_is, u_dt, u_ce, u_cp; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy, p = texelFetch(u_p, q, 0).xy; float S = texelFetch(u_s, q, 0).r;
  float c = 1.0; if (u_cp > 0.0) { float E = texelFetch(u_e, ivec2(0), 0).x; if (E > 1e-9) c = pow(u_ce / E, 0.5 * u_cp); }
  float Gn = u_g * S / (1.0 + dot(p, p) / u_is); o = vec4(c * exp(-u_l * u_dt) * (v + (exp(Gn * u_dt) - 1.0) * p), 0.0, 1.0); }`, ['psi', 'p', 's', 'e', 'g', 'l', 'is', 'dt', 'ce', 'cp']), polL: mk(`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_p, u_om; uniform float u_ea, u_dt, u_b; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 p = texelFetch(u_p, q, 0).xy, v = texelFetch(u_psi, q, 0).xy; float w = texelFetch(u_om, q, 0).x * u_dt; vec2 a = u_ea * vec2(cos(w), sin(w));
  o = vec4(vec2(a.x * p.x - a.y * p.y, a.x * p.y + a.y * p.x) + u_b * v, 0.0, 1.0); }`, ['psi', 'p', 'om', 'ea', 'dt', 'b']), omu: mk(`#version 300 es
precision highp float;
uniform sampler2D u_om, u_psi, u_p; uniform float u_k; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy, p = texelFetch(u_p, q, 0).xy; float W = texelFetch(u_om, q, 0).x;
  float e = (dot(v, v) > 1e-24 && dot(p, p) > 1e-24) ? atan(v.y * p.x - v.x * p.y, v.x * p.x + v.y * p.y) : 0.0; o = vec4(W + u_k * e, 0.0, 0.0, 1.0); }`, ['om', 'psi', 'p', 'k']) }; }
    this._glM = this._glM || new Map(); let M = this._glM.get(id); if (!M) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); M = { A: a, fA: fa, B: b, fB: fb, cur: 'A' }; this._glM.set(id, M); this._glClear(M); }
    const P = this._glP, src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB, cp = (+capE > 0) ? Math.max(0, Math.min(1, +capP || 0)) : 0;
    if (cp > 0) { this.opCycleInit(); const ur = this._u.energyRows; gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G); gl.useProgram(this._progEnergyRows); gl.uniform1i(ur.a, 0); gl.uniform1i(ur.G, G);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null); this._opColFinish('A'); }
    const ea = Math.exp(-Math.max(0, +gam || 0) * dt), pIn = M.cur === 'A' ? M.A : M.B, fOut = M.cur === 'A' ? M.fB : M.fA, pOut = M.cur === 'A' ? M.B : M.A;
    if (learn > 0) { if (!M.O) { const [a2, fa2] = this._makePsiTex(), [b2, fb2] = this._makePsiTex(); M.O = { A: a2, fA: fa2, B: b2, fB: fb2, cur: 'A' }; this._omFill(M.O, om); }
      const O = M.O, oIn = O.cur === 'A' ? O.A : O.B; this._nlPass(P.polL.p, fOut, [src, pIn, oIn], () => { gl.uniform1i(P.polL.u.psi, 0); gl.uniform1i(P.polL.u.p, 1); gl.uniform1i(P.polL.u.om, 2); gl.uniform1f(P.polL.u.ea, ea); gl.uniform1f(P.polL.u.dt, +dt || 0); gl.uniform1f(P.polL.u.b, 1 - ea); });
      const oOut = O.cur === 'A' ? O.fB : O.fA; this._nlPass(P.omu.p, oOut, [oIn, src, pOut], () => { gl.uniform1i(P.omu.u.om, 0); gl.uniform1i(P.omu.u.psi, 1); gl.uniform1i(P.omu.u.p, 2); gl.uniform1f(P.omu.u.k, (+learn || 0) * (+dt || 0)); }); O.cur = O.cur === 'A' ? 'B' : 'A'; }
    else this._nlPass(P.pol.p, fOut, [src, pIn], () => { gl.uniform1i(P.pol.u.psi, 0); gl.uniform1i(P.pol.u.p, 1); gl.uniform2f(P.pol.u.a, ea * Math.cos(om * dt), ea * Math.sin(om * dt)); gl.uniform1f(P.pol.u.b, 1 - ea); });
    M.cur = M.cur === 'A' ? 'B' : 'A';
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA, u = P.amp.u;
    this._scB(); this._nlPass(P.amp.p, fbo, [src, pOut, t, cp > 0 ? this._opSclA : t], () => { gl.uniform1i(u.psi, 0); gl.uniform1i(u.p, 1); gl.uniform1i(u.s, 2); gl.uniform1i(u.e, 3); gl.uniform1f(u.g, +g || 0); gl.uniform1f(u.l, +l || 0); gl.uniform1f(u.is, Math.max(1e-12, +Is || 1)); gl.uniform1f(u.dt, +dt || 0); gl.uniform1f(u.ce, +capE || 0); gl.uniform1f(u.cp, cp); });
    this._scE(); this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A'; }
  _omFill(O, om) { const gl = this._gl, G = this._G, z = new Float32Array(2 * G * G); for (let i = 0; i < G * G; i++) z[2 * i] = +om || 0; for (const t of [O.A, O.B]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, z); } gl.bindTexture(gl.TEXTURE_2D, null); }
  gainOmRead(id) { const M = this._glM && this._glM.get(id), O = M && M.O; if (!O) return null; const gl = this._gl, G = this._G, f = new Float32Array(2 * G * G); gl.bindFramebuffer(gl.FRAMEBUFFER, O.cur === 'A' ? O.fA : O.fB); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null); const w = new Float32Array(G * G); for (let i = 0; i < G * G; i++) w[i] = f[2 * i]; return w; }
  gainOmSet(id, w) { const M = this._glM && this._glM.get(id); if (!M || !w) return; const gl = this._gl, G = this._G; if (!M.O) { const [a2, fa2] = this._makePsiTex(), [b2, fb2] = this._makePsiTex(); M.O = { A: a2, fA: fa2, B: b2, fB: fb2, cur: 'A' }; } const z = new Float32Array(2 * G * G); for (let i = 0; i < G * G; i++) z[2 * i] = +w[i] || 0; gl.bindTexture(gl.TEXTURE_2D, M.O.cur === 'A' ? M.O.A : M.O.B); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, z); gl.bindTexture(gl.TEXTURE_2D, null); }
  _glClear(M) { const gl = this._gl, G = this._G, z = new Float32Array(2 * G * G); for (const t of [M.A, M.B]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, z); } gl.bindTexture(gl.TEXTURE_2D, null); }
  gainLineRead(id) { const M = this._glM && this._glM.get(id); if (!M) return null; const gl = this._gl, G = this._G, f = new Float32Array(2 * G * G);
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.cur === 'A' ? M.fA : M.fB); gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return f; }
  gainLineSet(id, f) { const gl = this._gl, G = this._G; this._glM = this._glM || new Map(); let M = this._glM.get(id); if (!M) { const [a, fa] = this._makePsiTex(), [b, fb] = this._makePsiTex(); M = { A: a, fA: fa, B: b, fB: fb, cur: 'A' }; this._glM.set(id, M); }
    if (!f) { this._glClear(M); return; } const d = f instanceof Float32Array ? f : Float32Array.from(f); gl.bindTexture(gl.TEXTURE_2D, M.cur === 'A' ? M.A : M.B); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, d); gl.bindTexture(gl.TEXTURE_2D, null); }
  gainLineDrop(id) { const M = this._glM && this._glM.get(id); if (!M) return; const gl = this._gl; for (const t of [M.A, M.B]) gl.deleteTexture(t); for (const f of [M.fA, M.fB]) gl.deleteFramebuffer(f); if (M.O) { for (const t of [M.O.A, M.O.B]) gl.deleteTexture(t); for (const f of [M.O.fA, M.O.fB]) gl.deleteFramebuffer(f); } this._glM.delete(id); }
  // applyEyeEnergyCapNS(targetE) — the NO-SYNC cap: identical physics to applyEyeEnergyCap (reduce → full
  // normalization √(target/E), both directions) with the scale pass SAMPLING the 1×1 reduce texture instead of
  // reading it back — zero pipeline stalls. The turbo executor's cap (profiled: per-step readPixels was 57% of
  // the frame). The sync version stays for callers that want the E value CPU-side.
  applyEyeEnergyCapNS(targetE) {
    const gl = this._gl, G = this._G;
    this.opCycleInit();
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const ur = this._u.energyRows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G);
    gl.useProgram(this._progEnergyRows); gl.uniform1i(ur.a, 0); gl.uniform1i(ur.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._opColFinish('A');
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.eyeCapScale;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    this._scB();
    gl.useProgram(this._progEyeCapScale);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.e, 1); gl.uniform1f(u.target, targetE);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._opSclA);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._scE();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }
  // ── Public: GPU Σ|ψ|² of the eye field (1-float readback, no full-grid loop). For controllers that MEASURE energy without rescaling (adaptive-ε).
  readEyeEnergy() {
    const gl = this._gl, G = this._G;
    this.opCycleInit();
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const ur = this._u.energyRows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); this._rowsVp(G);
    gl.useProgram(this._progEnergyRows); gl.uniform1i(ur.a, 0); gl.uniform1i(ur.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    this._opColFinish('A');
    const sf = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, this._opSclAFbo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, sf); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return sf[0];
  }

  // ── §7.82 Public: driven-dissipative pass on the eye field (loss α + saturable gain pump→Pt). NON-unitary. ─
  applyEyeDissip(alpha, pump, ptarget, dt) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.dissip;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progDissip);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.alpha, alpha); gl.uniform1f(u.pump, pump);
    gl.uniform1f(u.ptarget, ptarget); gl.uniform1f(u.dt, dt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── §7.86 Public: one cubic-quintic CGLE step on the eye field (the dissipative-soliton substrate). Params:
  //    {delta,beta,dispd,eps,c3,mu,c5,dt}. Run every step; pair with applyEyeSoftPhaseWell at the BAR BOUNDARY
  //    → the §7.86 phase-locked soliton (live, multi-symbol phase alphabet, peer-deterministic). ─
  stepEyeCGLE(p) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.cgle;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progCgleStep);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.rings, 1);
    gl.uniform1i(u.G, G); gl.uniform1i(u.nRings, this._nRings); gl.uniform1i(u.ringCount, this._ringCount);
    gl.uniform4fv(u.ringMeta, this._ringMetaPadded);
    gl.uniform1f(u.delta, p.delta); gl.uniform1f(u.beta, p.beta); gl.uniform1f(u.dispd, p.dispd);
    gl.uniform1f(u.eps, p.eps); gl.uniform1f(u.c3, p.c3); gl.uniform1f(u.mu, p.mu); gl.uniform1f(u.c5, p.c5);
    gl.uniform1f(u.cdt, p.dt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ringTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── §7.87 Public: iterate the Non-Linear Hutchinson Operator on the eye field. `maps` = [{s,theta,tx,ty,w}]
  //    (affine contraction maps; tx,ty in [0,1) normalized coords). Runs `iters` iterations of
  //    ψ' = tanh(Σ wᵢ ψ(fᵢ⁻¹(x))) on the eye ping-pong → collapses to the IFS attractor (the spatial symbol).
  //    Peer-deterministic for ASYMMETRIC rule-sets; symmetric ones (RING) need a notch map (§7.87). ─
  //    `anchor` (optional): { tex, scale, dom } → the GPU-resident auto-anchor (a dominant map at the argmax point
  //    read from `tex`, the 1×1 argmax result). When present, base weights auto-scale to (1-dom) IN-SHADER.
  iterateHutchinson(maps, iters, anchor = null) {
    const gl = this._gl, G = this._G, n = Math.min(12, maps.length);
    const A = new Float32Array(12 * 4), B = new Float32Array(12 * 4);
    for (let i = 0; i < n; i++) { const m = maps[i], th = m.theta || 0;
      A[i*4] = m.s; A[i*4+1] = Math.cos(th); A[i*4+2] = Math.sin(th); A[i*4+3] = m.tx;
      B[i*4] = m.ty; B[i*4+1] = (m.w != null ? m.w : 1/n); }
    const u = this._u.nlho;
    for (let k = 0; k < iters; k++) {
      const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
      const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, G, G);
      gl.useProgram(this._progNlhoStep);
      gl.uniform1i(u.psi, 0); gl.uniform1i(u.G, G); gl.uniform1i(u.nMaps, n);
      gl.uniform4fv(u.mapA, A); gl.uniform4fv(u.mapB, B);
      if (anchor) { gl.uniform1i(u.anchorOn, 1); gl.uniform1i(u.anchorTex, 1);
        gl.uniform1f(u.anchorScale, anchor.scale); gl.uniform1f(u.anchorDom, anchor.dom);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, anchor.tex); }
      else gl.uniform1i(u.anchorOn, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      gl.bindVertexArray(this._vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
    }
  }

  // ── §7.87 build the argmax pyramid textures (RGBA32F levels G, G/2, … , 1), lazily. ─
  _ensureArgmaxPyramid() {
    if (this._argLevels) return;
    const gl = this._gl; let s = this._G; const lv = [];
    const mk = (w) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, w);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t, f, w }; };
    while (s >= 1) { lv.push(mk(s)); if (s === 1) break; s = Math.ceil(s / 2); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._argLevels = lv;
  }

  // ── §7.87 PURE-GPU argmax of the current eye field's REAL channel → a 1×1 RGBA32F texture (maxVal, winX, winY).
  //    INIT lifts field→(v,x,y); REDUCE max-pools the pyramid to 1×1. NO readback — the result texture is sampled
  //    directly by the anchored NLHO step. Returns the 1×1 texture (this._argLevels[last].t). ─
  gpuArgmax() {
    this._ensureArgmaxPyramid();
    const gl = this._gl, lv = this._argLevels, src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    // INIT: field → level 0 (v,x,y,1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, lv[0].f); gl.viewport(0, 0, lv[0].w, lv[0].w);
    gl.useProgram(this._progArgmaxInit); gl.uniform1i(this._u.argInit.psi, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    // REDUCE down the pyramid
    const u = this._u.argReduce;
    for (let i = 1; i < lv.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, lv[i].f); gl.viewport(0, 0, lv[i].w, lv[i].w);
      gl.useProgram(this._progArgmaxReduce);
      gl.uniform1i(u.src, 0); gl.uniform1i(u.inW, lv[i-1].w); gl.uniform1i(u.inH, lv[i-1].w);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lv[i-1].t);
      gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return lv[lv.length - 1].t;   // 1×1 (maxVal, winX, winY, valid)
  }

  // ── §7.88i write an EXPLICIT anchor coord (px) into the 1×1 argmax-result texture — bypasses the field-dependent
  //    reduction so the anchor is a MACHINE-INDEPENDENT function of the rule-set (not the GPU's float32 argmax of a
  //    degenerate field, which flipped per-machine for diffuse rule-sets → "same genome, different attractor").
  setAnchorCoord(xPx, yPx) {
    this._ensureArgmaxPyramid();
    const gl = this._gl, t = this._argLevels[this._argLevels.length - 1].t;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array([1.0, xPx, yPx, 1.0]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  }

  // ── §7.87 Public: AUTO-ANCHORED Hutchinson iteration — the GENERAL per-symbol fix, PURE GPU (no readback).
  //    1) probe-iterate raw maps → expose the attractor peak; 2) gpuArgmax → 1×1 (winX,winY) texture; 3) re-seed,
  //    run the full iteration with the anchor ON (a dominant map at the argmax point, added IN-SHADER from that
  //    texture). The densest-point derivation is entirely GPU-resident — no glReadPixels in the path. Robust recipe
  //    (measured §7.87): anchorScale≈0.20, dominance≈0.65. Diffuse rule-sets (RING, ladder) become peer-det. ─
  iterateHutchinsonAnchored(maps, iters, { anchorScale = 0.20, dominance = 0.65, probeIters = 6, reseed = null, anchorPx = null } = {}) {
    if (reseed) this.setEyePsi(reseed);
    // anchorPx (px coord) = an EXPLICIT, machine-independent anchor (computed in JS from the rule-set). When given,
    // skip the field-dependent GPU argmax (which flipped per-machine for degenerate/diffuse rule-sets). §7.88i.
    let argTex;
    if (anchorPx) { argTex = this.setAnchorCoord(anchorPx[0], anchorPx[1]); }
    else { this.iterateHutchinson(maps, probeIters); argTex = this.gpuArgmax(); if (reseed) this.setEyePsi(reseed); }
    this.iterateHutchinson(maps, iters, { tex: argTex, scale: anchorScale, dom: dominance });  // anchored run
  }

  // ── §7.87 Public: GROW an NLHO attractor (auto-anchored) from a rule-set and AREA-DOWNSAMPLE to an L×L genome
  //    field (the OP-CYC operator's W grid). The attractor is peer-deterministic (auto-anchor) → every peer that
  //    grows the SAME rule-set gets the SAME W, with NO wire traffic (the live-NLHO genome's peer-purity). The W
  //    is MEAN-SUBTRACTED so its structure (not the saturated DC) is the content — matching the evolved-polar
  //    phenotype class. `maps` = [{s,theta,tx,ty,w}]; `L` = output side (16). One readback — setup/mutation-time,
  //    not per-frame (only when a rule-set is (re)grown). Returns Float64(L*L). ─
  growNlhoGlyph(maps, L = 16, { iters = 14, seedSigma = 30, wantField = false } = {}) {
    const G = this._G, N = G * G;
    // §7.89b a DAMAGE-COLLAPSED rank (occlusion dropped all its maps) → no attractor: return an empty glyph/field.
    if (!maps || maps.length === 0) { const out = new Float64Array(L * L); return wantField ? { W: out, field: new Float64Array(N), G } : out; }
    // growing uses the eye ping-pong (setEyePsi/iterate/readEyePsi) — which is the LIVE travelling field. SAVE it,
    // grow on it, RESTORE it, so a mutation/regrow does NOT corrupt the running soliton (panel 1 / the recon).
    const saved = this.readEyePsi();
    // deterministic seed (a centred gaussian) so the grown attractor is a pure function of the rule-set.
    const seed = new Float64Array(N * 2);
    const c = (G - 1) / 2;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) seed[(y*G+x)*2] = 0.6 * Math.exp(-(((x-c)**2+(y-c)**2)) / (seedSigma * (G/64)));
    // §7.88i ANALYTIC anchor (machine-independent): the IFS attractor's centre ≈ the mean of the maps' FIXED
    // POINTS. Each map f(p)=s·R·p+t has fixed point ≈ t/(1-s) (rotation negligible for the centre). Computing it
    // in JS (not the per-GPU argmax of a degenerate field) makes the grown attractor IDENTICAL on every peer.
    let ax = 0, ay = 0, wsum = 0;
    for (const m of maps) { const w = (m.w != null ? m.w : 1), d = Math.max(1e-3, 1 - m.s);
      ax += w * m.tx / d; ay += w * m.ty / d; wsum += w; }
    if (wsum > 0) { ax /= wsum; ay /= wsum; }
    const anchorPx = [Math.max(0, Math.min(G-1, ax * G)), Math.max(0, Math.min(G-1, ay * G))];
    this.iterateHutchinsonAnchored(maps, iters, { reseed: seed, anchorPx });
    const f = this.readEyePsi();                         // Float64(2N) — real channel = the attractor
    // area-downsample G×G → L×L (mean of each block), then mean-subtract.
    const bs = G / L, out = new Float64Array(L * L);
    for (let ly = 0; ly < L; ly++) for (let lx = 0; lx < L; lx++) { let s = 0, n = 0;
      for (let dy = 0; dy < bs; dy++) for (let dx = 0; dx < bs; dx++) { const gx = lx*bs+dx, gy = ly*bs+dy;
        if (gx < G && gy < G) { s += f[(gy*G+gx)*2]; n++; } }
      out[ly*L+lx] = n ? s/n : 0; }
    let m = 0; for (let i = 0; i < out.length; i++) m += out[i]; m /= out.length;
    for (let i = 0; i < out.length; i++) out[i] -= m;     // mean-subtract: structure, not DC
    // §7.88n: optionally also return the FULL-RESOLUTION attractor density (the real channel of the grown field,
    // G×G, peer-deterministic by the same anchor). Unlike the 16×16 mean-subtracted W (a coarse genome), this is
    // the actual PHENOTYPE GEOMETRY — the fractal density of the recalled rule-set — for echoing into panel 1.
    let field = null;
    if (wantField) { field = new Float64Array(N); for (let i = 0; i < N; i++) field[i] = f[i * 2]; }
    this.setEyePsi(saved);                                // RESTORE the live field (grow was non-destructive)
    return wantField ? { W: out, field, G } : out;
  }

  // ── §7.88cc Public: GPU CHAOS GAME — render the IFS attractor as a crisp point cloud (NOT the tanh field, which
  //    saturates). Many PARALLEL chains (one per vertex), each seeded from gl_VertexID, iterated u_iters times in
  //    the vertex shader, the final point splatted ADDITIVELY into a float accumulator; a 2nd pass log-normalizes.
  //    Deterministic (seed = f(VertexID)). maps = [{s,theta,tx,ty,w}]. Returns {pixels, P} (RGBA P×P). §7.88dd: P
  //    DEFAULTS TO THE HOLOGRAM GRID _G — the fractal is rendered at the SAME resolution the medium's NLS operations
  //    (grow W, soliton transport) actually run at, so it's an HONEST view of what the medium computes, not a
  //    prettied-up higher-res standalone. (Pass an explicit P only to deliberately over/under-sample.) ─
  renderChaosGame(maps, { P = this._G, chains = 24000, iters = 14 } = {}) {
    const gl = this._gl;
    if (!maps || maps.length === 0) return { pixels: new Uint8Array((P * P) * 4), P };   // §7.89b damage-collapsed rank → blank canvas (the attractor is gone, because the code was in the destroyed field)
    if (!this._progChaosPt) {
      gl.getExtension('EXT_float_blend');   // additive blend INTO an R32F target (no-op if already core/unavailable)
      // point program: vertex iterates the maps, fragment emits 1.0 (additive count)
      const K = 8;   // max maps the shader handles (pad/ignore extras)
      const vsrc = `#version 300 es
        precision highp float;
        uniform vec4 u_mapA[${K}];   // (s, theta, tx, ty)
        uniform float u_cum[${K}];   // cumulative weights
        uniform int   u_nmaps;
        uniform int   u_iters;
        uniform float u_seed;
        uniform vec3  u_fit;   // §7.88dd (offX, offY, scale) — fit the attractor bbox into the frame (mutations slide it out)
        float hash(float n){ return fract(sin(n*12.9898+u_seed)*43758.5453); }
        void main(){
          float id = float(gl_VertexID);
          vec2 p = vec2(hash(id), hash(id+7.0));   // per-chain start
          for(int it=0; it<64; it++){
            if(it>=u_iters) break;
            float u = hash(id + 13.0 + float(it)*1.7);
            int k = 0; for(int j=0;j<${K};j++){ if(j<u_nmaps && u>u_cum[j]) k=j+1; }
            if(k>=u_nmaps) k=u_nmaps-1;
            vec4 m = u_mapA[k];
            float ct=cos(m.y), sf=sin(m.y);
            vec2 d = p-0.5;
            p = vec2(m.x*(ct*d.x - sf*d.y)+m.z, m.x*(sf*d.x + ct*d.y)+m.w);
          }
          vec2 fp = (p - u_fit.xy) * u_fit.z;        // bbox-fit → [0,1]
          gl_Position = vec4(fp*2.0-1.0, 0.0, 1.0);  // → clip; off-frame points clip away
          gl_PointSize = 1.0;
        }`;
      const fsrc = `#version 300 es
        precision highp float; out vec4 o; void main(){ o = vec4(1.0,0.0,0.0,1.0); }`;
      const vs = this._compileShader(gl.VERTEX_SHADER, vsrc), fs = this._compileShader(gl.FRAGMENT_SHADER, fsrc);
      const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('chaos pt link: ' + gl.getProgramInfoLog(pr));
      this._progChaosPt = pr;
      this._uChaos = { mapA: gl.getUniformLocation(pr,'u_mapA'), cum: gl.getUniformLocation(pr,'u_cum'),
        nmaps: gl.getUniformLocation(pr,'u_nmaps'), iters: gl.getUniformLocation(pr,'u_iters'), seed: gl.getUniformLocation(pr,'u_seed'),
        fit: gl.getUniformLocation(pr,'u_fit') };
      // resolve program: log-normalize the accumulator → a TRUE DENSITY heatmap. §7.88dd: color AND brightness
      // both encode the chaos-game DENSITY (the attractor's invariant measure) — nothing borrowed/faked. Ramp:
      // black → deep blue → cyan → white as density rises (perceptual, monotone in luminance).
      this._progChaosResolve = this._compileStep(`#version 300 es
        precision highp float; uniform sampler2D u_acc; uniform float u_norm; in vec2 v_uv; out vec4 fragColor;
        vec3 densityRamp(float t){           // 0=black, .35=deep blue, .7=cyan, 1=white
          t = clamp(t, 0.0, 1.0);
          vec3 c = mix(vec3(0.0,0.02,0.09), vec3(0.0,0.35,0.85), smoothstep(0.0,0.45,t));   // black→blue
          c = mix(c, vec3(0.25,0.85,1.0), smoothstep(0.4,0.8,t));                            // →cyan
          c = mix(c, vec3(1.0,1.0,1.0),  smoothstep(0.8,1.0,t));                             // →white (densest)
          return c;
        }
        void main(){ float c = texture(u_acc, v_uv).r;   // density count (acc is P×P, viewport G×G — sample by UV)
          float lv = c>0.0 ? log(1.0+c)*u_norm : 0.0; fragColor = vec4(densityRamp(min(lv,1.0)), 1.0); }`);
      this._uChaosRes = { acc: gl.getUniformLocation(this._progChaosResolve,'u_acc'), norm: gl.getUniformLocation(this._progChaosResolve,'u_norm') };
    }
    // (re)alloc P×P float accumulator
    if (!this._chaosAcc || this._chaosP !== P) {
      if (this._chaosAcc) { gl.deleteTexture(this._chaosAcc); gl.deleteFramebuffer(this._fboChaos); }
      this._chaosP = P; this._chaosAcc = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._chaosAcc);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, P, P, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this._fboChaos = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboChaos);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._chaosAcc, 0);
    }
    // map params → uniforms
    const K = 8, mapA = new Float32Array(K*4), cum = new Float32Array(K);
    let wsum = 0; for (const m of maps) wsum += (m.w != null ? m.w : 1); let acc = 0;
    for (let i = 0; i < Math.min(K, maps.length); i++) { const m = maps[i];
      mapA[i*4]=m.s; mapA[i*4+1]=m.theta||0; mapA[i*4+2]=m.tx; mapA[i*4+3]=m.ty;
      acc += (m.w != null ? m.w : 1)/wsum; cum[i]=acc; }
    // §7.88dd AUTO-FIT: a quick CPU chaos-game pass to measure the attractor's real bbox (mutations slide tx,ty →
    // the attractor drifts out of [0,1] and clips). Fit that bbox into the frame with a small pad. Same RNG as the
    // shader's hash isn't needed — any sampling estimates the bbox; deterministic seed keeps the fit stable.
    let mnX = 1/0, mnY = 1/0, mxX = -1/0, mxY = -1/0;
    { let s = 0x12345 >>> 0; const rnd = () => { s = (s*1664525+1013904223)>>>0; return s/2**32; };
      let px = rnd(), py = rnd();
      for (let i = 0; i < 3000; i++) { const u = rnd(); let k = 0; while (k < maps.length-1 && u > cum[k]) k++;
        const m = maps[k], ct = Math.cos(m.theta||0), sf = Math.sin(m.theta||0), dx = px-0.5, dy = py-0.5;
        px = m.s*(ct*dx - sf*dy) + m.tx; py = m.s*(sf*dx + ct*dy) + m.ty;
        if (i > 20) { if (px<mnX)mnX=px; if (px>mxX)mxX=px; if (py<mnY)mnY=py; if (py>mxY)mxY=py; } } }
    const pad = 0.08, spanX = Math.max(1e-3, mxX-mnX), spanY = Math.max(1e-3, mxY-mnY), span = Math.max(spanX, spanY);
    const scale = (1 - 2*pad) / span;
    const cxA = (mnX+mxX)/2, cyA = (mnY+mxY)/2;                // attractor centre
    const offX = cxA - 0.5/scale, offY = cyA - 0.5/scale;       // fit: (p-off)*scale maps centre→0.5, span→1-2pad
    // PASS 1: additive splat into the accumulator
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboChaos); gl.viewport(0,0,P,P);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);   // additive accumulation
    gl.useProgram(this._progChaosPt);
    gl.uniform4fv(this._uChaos.mapA, mapA); gl.uniform1fv(this._uChaos.cum, cum);
    gl.uniform1i(this._uChaos.nmaps, Math.min(K, maps.length)); gl.uniform1i(this._uChaos.iters, iters);
    gl.uniform1f(this._uChaos.seed, 0.3137);
    gl.uniform3f(this._uChaos.fit, offX, offY, scale);   // §7.88dd auto-fit the attractor bbox into the frame
    gl.bindVertexArray(this._vao);   // no attributes used; gl_VertexID drives it
    gl.drawArrays(gl.POINTS, 0, chains);
    gl.disable(gl.BLEND);
    // PASS 2: log-normalize → an RGBA8 colour texture at FULL P resolution (the chaos game's quality is its OWN P,
    // DECOUPLED from the hologram grid _G — they only shared _gpuCanvas by coincidence, which capped it at _G). Then
    // read it back to the chaos game's own ImageData so the caller blits a crisp P×P image, not a _G-downsampled one.
    if (!this._chaosOut || this._chaosOutP !== P) {
      if (this._chaosOut) { gl.deleteTexture(this._chaosOut); gl.deleteFramebuffer(this._fboChaosOut); }
      this._chaosOutP = P; this._chaosOut = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._chaosOut);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, P, P, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this._fboChaosOut = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboChaosOut);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._chaosOut, 0);
      this._chaosPixels = new Uint8Array(P * P * 4); this._chaosImageData = null;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboChaosOut); gl.viewport(0, 0, P, P);
    gl.useProgram(this._progChaosResolve);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._chaosAcc);
    gl.uniform1i(this._uChaosRes.acc, 0);
    const avg = Math.max(1, (chains * 1) / (P * P)); gl.uniform1f(this._uChaosRes.norm, 1.0 / Math.log(1 + 8 * avg));
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.readPixels(0, 0, P, P, gl.RGBA, gl.UNSIGNED_BYTE, this._chaosPixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { pixels: this._chaosPixels, P };   // caller draws this P×P RGBA into its cell (crisp, _G-independent)
  }

  // ── §7.84 Public: generative SOFT PHASE-WELL HEAL — rotate each cell's phase toward a q-well (|ψ| preserved),
  //    with STATEFUL hysteresis against the PREVIOUS bar's healed field (the memory that makes it peer-deterministic
  //    under propagation). Run ONCE PER BAR (not in the leapfrog). snap=pull 0..1, hold=separatrix deadband.
  //    resetPhaseHeal() clears the memory (call before a fresh sequence). ─
  resetPhaseHeal() { this._phHealHasPrev = false; }
  applyEyeSoftPhaseWell(q, snap, hold) {
    const gl = this._gl, G = this._G;
    if (!this._phHealPrev) { this._phHealPrev = this._makeRGF32Tex(); this._phHealHasPrev = false; }
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.softPhaseWell;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progSoftPhaseWell);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.prev, 1);
    gl.uniform1f(u.q, q); gl.uniform1f(u.snap, snap); gl.uniform1f(u.hold, hold);
    gl.uniform1f(u.hasPrev, this._phHealHasPrev ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._phHealPrev);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
    // snapshot the healed field → memory for next bar (copy the new src into _phHealPrev)
    const healed = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._eyeSrc === 'A' ? this._fboEyeA : this._fboEyeB);
    gl.bindTexture(gl.TEXTURE_2D, this._phHealPrev);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, G, G);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._phHealHasPrev = true;
  }

  // ── §7.82 Public: GPU-resident additive clock forcing — ψ.re += amp·gaussian(centre). No readback/upload. ─
  //    amp = A·cos(Ω·t)·dt (scalar, computed by caller); sig2 = mask variance (px²).
  applyEyeAddForce(amp, sig2) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.addForce;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progAddForce);
    gl.uniform1i(u.psi, 0); gl.uniform1f(u.amp, amp); gl.uniform1f(u.sig2, sig2); gl.uniform1i(u.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }

  // ── §7.82 Public: read a SINGLE eye pixel (re,im) — cheap probe for phase tracking (no full-field stall). ─
  readEyePixel(x, y) {
    const gl = this._gl;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeA : this._fboEyeB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const px = new Float32Array(2);
    gl.readPixels(x, y, 1, 1, gl.RG, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  // ── §7.82 On-GPU phase accumulator — track an OBS pixel's unwrapped phase WITHOUT a per-step readback. ─
  //    resetPhaseAccum() → accumPhaseStep(ox,oy) each step → readPhaseAccum() ONCE at the end. This is what
  //    makes the dissipative-Arnold sweep fast at G=128 (the per-step glReadPixels sync was the wall).
  _ensurePhaseAccum() {
    if (this._phAccA) return;
    const gl = this._gl;
    const mk1 = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return [t, f]; };
    [this._phAccA, this._phAccAFbo] = mk1();
    [this._phAccB, this._phAccBFbo] = mk1();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._phAccSrc = 'A';
  }
  resetPhaseAccum() {
    this._ensurePhaseAccum();
    const gl = this._gl;
    gl.bindTexture(gl.TEXTURE_2D, this._phAccA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array([0,0,0,0]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    this._phAccSrc = 'A';
  }
  accumPhaseStep(ox, oy) {
    const gl = this._gl;
    const psiTex = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const accSrc = this._phAccSrc === 'A' ? this._phAccA : this._phAccB;
    const accFbo = this._phAccSrc === 'A' ? this._phAccBFbo : this._phAccAFbo;
    const u = this._u.phaseAccum;
    gl.bindFramebuffer(gl.FRAMEBUFFER, accFbo);
    gl.viewport(0, 0, 1, 1);
    gl.useProgram(this._progPhaseAccum);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.acc, 1); gl.uniform1i(u.ox, ox); gl.uniform1i(u.oy, oy);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, psiTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, accSrc);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._phAccSrc = this._phAccSrc === 'A' ? 'B' : 'A';
  }
  readPhaseAccum() {
    const gl = this._gl;
    const fbo = this._phAccSrc === 'A' ? this._phAccAFbo : this._phAccBFbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const px = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px[1];   // total unwrapped phase
  }

  // ── Public: render |ψ_eye + α·obj| to the canvas, fully on GPU (no readback) ─
  // obj is uploaded into _objEye (the eye's scratch obj texture). Used by the eye
  // DIFF panel so the synchronous readPsi()+CPU-mix path is eliminated.
  renderEyeDiff(objField, alpha, smoothMax) {
    this.setEyeObjField(objField);   // obj → _objEye
    const gl = this._gl, G = this._G;
    const tex = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderDiff);
    const ud = this._u.renderDiff;
    gl.uniform1i(ud.psi,       0);
    gl.uniform1i(ud.obj,       1);
    gl.uniform1f(ud.alpha,     alpha);
    gl.uniform1f(ud.smoothMax, smoothMax);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._objEye);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // ── Public: leapfrog step + SRC_ALPHA injection on sweep ping-pong ───────────
  // Same as stepRecord but operates on _swA/_swB instead of _psiA/_psiB.
  stepRecordSweep(dt, alpha) {
    this.stepSweep(dt);
    const gl  = this._gl, G = this._G;
    const src = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progStepRecord);
    gl.uniform1i(this._u.stepRec.psi,   0);
    gl.uniform1i(this._u.stepRec.obj,   1);
    gl.uniform1f(this._u.stepRec.alpha, alpha);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._obj);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: Hamiltonian plate coupling — IFS step + inject + exp(i·γ·plate) ──
  // psi' = (IFS·psi + α(obj−psi)) · exp(i·γ·plateNorm·2π)
  // The plate acts as a spatially varying phase potential baked into the propagator,
  // not a post-hoc kick. Unitary (phase-only), preserves amplitude after injection.
  stepRecordSweepHamiltonian(dt, alpha, gamma, smoothMaxPlate) {
    this.stepSweep(dt);
    const gl  = this._gl, G = this._G;
    const src = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progStepRecordHamiltonian);
    gl.uniform1i(this._u.stepRecHam.psi,           0);
    gl.uniform1i(this._u.stepRecHam.obj,           1);
    gl.uniform1i(this._u.stepRecHam.plate,         2);
    gl.uniform1f(this._u.stepRecHam.alpha,         alpha);
    gl.uniform1f(this._u.stepRecHam.gamma,         gamma);
    gl.uniform1f(this._u.stepRecHam.smoothMaxPlate, smoothMaxPlate);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._obj);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: plate spatial gain on sweep psi — plate warps IFS attractor ──────
  // psi += gamma * (plate/maxPlate) * psi  →  high-fringe regions amplify, trap soliton
  stepPlateSweep(gamma, smoothMaxPlate) {
    const gl  = this._gl, G = this._G;
    const src = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progStepPlate);
    gl.uniform1i(this._u.stepPlate.psi,            0);
    gl.uniform1i(this._u.stepPlate.plate,          1);
    gl.uniform1f(this._u.stepPlate.gamma,          gamma);
    gl.uniform1f(this._u.stepPlate.smoothMaxPlate, smoothMaxPlate);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: energy-conserving plate phase kick on sweep psi ──────────────────
  // psi *= exp(i * gamma * plateNorm * 2π) — shifts phase, preserves amplitude.
  platePhaseKickSweep(gamma, smoothMaxPlate) {
    const gl  = this._gl, G = this._G;
    const src      = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo      = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    const u        = this._u.platePhaseKick;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progPlatePhaseKick);
    gl.uniform1i(u.psi,            0);
    gl.uniform1i(u.plate,          1);
    gl.uniform1f(u.gamma,          gamma);
    gl.uniform1f(u.smoothMaxPlate, smoothMaxPlate);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: GS amplitude constraint on sweep psi ─────────────────────────────
  // Replaces |psi[j]| with sqrt(plate[j]), keeping phase: psi' = sqrt(plate) · exp(i·arg(psi))
  // This is the missing second half of every Gerchberg-Saxton round-trip.
  plateAmpConstraintSweep(smoothMaxPlate) {
    const gl  = this._gl, G = this._G;
    const src      = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo      = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    const u        = this._u.plateAmpConstraint;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progPlateAmpConstraint);
    gl.uniform1i(u.psi,            0);
    gl.uniform1i(u.plate,          1);
    gl.uniform1f(u.smoothMaxPlate, smoothMaxPlate);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: demodulated-field phase kick on sweep psi ────────────────────────
  // psi *= exp(i * gamma * arg(objField)) — kicks phase by object wavefront phase.
  // Call setObjField first with the demodulated plate field.
  demodPhaseKickSweep(gamma) {
    const gl  = this._gl, G = this._G;
    const src = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    const u   = this._u.demodPhaseKick;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progDemodPhaseKick);
    gl.uniform1i(u.psi,   0);
    gl.uniform1i(u.obj,   1);
    gl.uniform1f(u.gamma, gamma);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._objA);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: one Huygens step on sweep ping-pong ──────────────────────────────
  // Each IFS ring becomes a Huygens wavelet with phase exp(i*k*r). Replaces IFS
  // leapfrog with wave-physics back-propagation using the same ring geometry.
  stepHuygensSweep(kwave) {
    const gl  = this._gl, G = this._G;
    const nRings = this._nRings;
    if (!nRings) return;
    const src = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    const u   = this._u.stepHuygens;
    const radiiPadded = new Float32Array(16);
    for (let d = 0; d < nRings; d++) radiiPadded[d] = this._ringRadii[d];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progStepHuygens);
    gl.uniform1i(u.psi,       0);
    gl.uniform1i(u.rings,     1);
    gl.uniform1i(u.G,         G);
    gl.uniform1i(u.nRings,    nRings);
    gl.uniform1i(u.ringCount, this._ringCount);
    gl.uniform4fv(u.ringMeta, this._ringMetaPadded);
    gl.uniform1fv(u.radii,    radiiPadded);
    gl.uniform1f(u.kwave,     kwave);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ringTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: thin lens phase mask on sweep psi ────────────────────────────────
  // psi *= exp(i * kwave * r² / (2*f))  — focuses reconstruction at depth f.
  applyLensSweep(kwave, f) {
    const gl  = this._gl, G = this._G;
    const src = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    const u   = this._u.lensPhase;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progLensPhase);
    gl.uniform1i(u.psi,   0);
    gl.uniform1f(u.kwave, kwave);
    gl.uniform1f(u.f,     f);
    gl.uniform1i(u.G,     G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: plate-modulated complex kernel step on sweep ─────────────────────
  // psi_new = Σ_d exp(i*k*r_d) * plateRingAvg_d * psiRingAvg_d
  stepPlateKernelSweep(kwave, smoothMaxPlate, alpha = 0.1) {
    const gl  = this._gl, G = this._G;
    const nRings = this._nRings;
    if (!nRings) return;
    const src      = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo      = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    const u        = this._u.stepPlateKernel;
    const radiiPadded = new Float32Array(16);
    for (let d = 0; d < nRings; d++) radiiPadded[d] = this._ringRadii[d];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progStepPlateKernel);
    gl.uniform1i(u.psi,            0);
    gl.uniform1i(u.plate,          1);
    gl.uniform1i(u.rings,          2);
    gl.uniform1i(u.G,              G);
    gl.uniform1i(u.nRings,         nRings);
    gl.uniform1i(u.ringCount,      this._ringCount);
    gl.uniform4fv(u.ringMeta,      this._ringMetaPadded);
    gl.uniform1fv(u.radii,         radiiPadded);
    gl.uniform1f(u.kwave,          kwave);
    gl.uniform1f(u.smoothMaxPlate, smoothMaxPlate);
    gl.uniform1f(u.alpha,          alpha);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._ringTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Internal: run one substep on sweep ping-pong ────────────────────────────
  _runSubstepSw(prog, dt, u) {
    const gl  = this._gl, G = this._G;
    const src = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(prog);
    gl.uniform1f(u.dt, dt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ringTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: run T steps on sweep psi and bake result into ref texture ────────
  // Used to compute refField entirely on GPU: seed sweep with _initRefPsi, then
  // call buildRefFromSweep(T_RECORD). Avoids JS _linearStepIFS loop on kernel change.
  buildRefFromSweep(steps, dt) {
    this.stepSweepN(steps, dt);
    // Copy current sweep psi texture into _ref using a temporary FBO readback.
    // We read the sweep src texture via its FBO and copyTexSubImage2D into _ref.
    const gl = this._gl, G = this._G;
    const swFbo = this._swSrc === 'A' ? this._fboSwA : this._fboSwB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, swFbo);
    gl.bindTexture(gl.TEXTURE_2D, this._ref);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, G, G);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Public: accumulate plate from sweep psi: |sweepPsi + ref|² → plate ──────
  accumulatePlateSweep(decay) {
    const gl  = this._gl, G = this._G;
    const swTex    = this._swSrc  === 'A' ? this._swA    : this._swB;
    const plateSrc = this._plateSrc === 'A' ? this._plateA : this._plateB;
    const plateDst = this._plateSrc === 'A' ? this._fboPB  : this._fboPA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, plateDst);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progAccumSweep);

    const ua = this._u.accumSweep;
    gl.uniform1i(ua.sw,    0);
    gl.uniform1i(ua.ref,   1);
    gl.uniform1i(ua.plate, 2);
    gl.uniform1f(ua.decay, decay);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, swTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ref);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, plateSrc);

    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._plateSrc = this._plateSrc === 'A' ? 'B' : 'A';
    this._plate = this._plateSrc === 'A' ? this._plateA : this._plateB;
    this._fboP  = this._plateSrc === 'A' ? this._fboPA  : this._fboPB;
  }

  // ── Public: one full leapfrog step (3 substeps) ─────────────────────────────
  step(dt) {
    const u = this._u;
    this._runSubstep(this._progStep1, dt, u.step1);
    this._runSubstep(this._progStep2, dt, u.step2);
    this._runSubstep(this._progStep3, dt, u.step3);
  }

  stepN(n, dt) {
    for (let i = 0; i < n; i++) this.step(dt);
  }

  // ── Public: read peak |ψ|² from current sweep texture (sync, cheap-ish) ──────
  readSwPeakSq() {
    const gl = this._gl, G = this._G;
    const fbo = this._swSrc === 'A' ? this._fboSwA : this._fboSwB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const f32 = new Float32Array(G * G * 2);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let mx = 0;
    for (let j = 0; j < G * G; j++) {
      const m = f32[j*2]*f32[j*2] + f32[j*2+1]*f32[j*2+1];
      if (m > mx) mx = m;
    }
    return mx;
  }

  // ── Internal: run one leapfrog substep ──────────────────────────────────────
  // The ping-pong strategy: read from src FBO, write to dst FBO, swap pointers.
  // All three substeps of one IFS step use the same ping-pong pair; we swap
  // only once per full step to keep memory traffic minimal — but we need
  // in-place update semantics (substep 2 needs the Re written by substep 1).
  // Solution: use a copy pass after substep 1 and 3 to make in-place look-alike.
  // Actually simpler: always write to the *other* buffer, swap after each substep.
  _runSubstep(prog, dt, u) {
    const gl  = this._gl;
    const G   = this._G;
    const src = this._swSrc === 'A' ? this._swA : this._swB;
    const fbo = this._swSrc === 'A' ? this._fboSwB : this._fboSwA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(prog);
    gl.uniform1f(u.dt, dt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ringTex);

    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._swSrc = this._swSrc === 'A' ? 'B' : 'A';
  }

  // ── Public: accumulate plate |ψ+ref|² ───────────────────────────────────────
  // decay: PLATE_DECAY coefficient (applied to existing plate value)
  accumulatePlate(decay) { this.accumulatePlateSweep(decay); }

  _accumulatePlate_unused(decay) {
    const gl  = this._gl, G = this._G;
    const psiTex  = this._swSrc === 'A' ? this._swA : this._swB;
    const plateSrc = this._plateSrc === 'A' ? this._plateA : this._plateB;
    const plateDst = this._plateSrc === 'A' ? this._fboPB  : this._fboPA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, plateDst);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progAccum);

    const ua = this._u.accum;
    gl.uniform1i(ua.psi,   0);
    gl.uniform1i(ua.ref,   1);
    gl.uniform1i(ua.plate, 2);
    gl.uniform1f(ua.decay, decay);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, psiTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ref);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, plateSrc);

    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Swap — dst is now the readable plate
    this._plateSrc = this._plateSrc === 'A' ? 'B' : 'A';
    this._plate = this._plateSrc === 'A' ? this._plateA : this._plateB;
    this._fboP  = this._plateSrc === 'A' ? this._fboPA  : this._fboPB;
  }

  // ── Public: zero both plate buffers ────────────────────────────────────────
  resetPlate() {
    const gl = this._gl;
    for (const fbo of [this._fboPA, this._fboPB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._plateSrc = 'A';
    this._plate = this._plateA; this._fboP = this._fboPA;
  }

  // ── Public: upload plate from JS Float32Array(G*G) ──────────────────────────
  uploadPlate(plate32) {
    const gl = this._gl, G = this._G;
    const rgba = new Float32Array(G * G * 4);
    for (let j = 0; j < G * G; j++) rgba[j * 4] = plate32[j];
    // Upload into both ping-pong buffers so whichever is src has the right data.
    for (const tex of [this._plateA, this._plateB]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RGBA, gl.FLOAT, rgba);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── Public: download psi → Float64Array(2*G*G) ─────────────────────────────
  // Slow — avoid in hot path. Used for Croquet state sync when needed.
  readPsi() {
    const gl = this._gl, G = this._G;
    const fbo = this._swSrc === 'A' ? this._fboSwA : this._fboSwB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const f32 = new Float32Array(G * G * 2);
    gl.readPixels(0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Float64Array(G * G * 2);
    for (let i = 0; i < G * G * 2; i++) out[i] = f32[i];
    return out;
  }

  // ── Public: download plate → Float32Array(G*G) (sync, blocks GPU pipeline) ───
  readPlate() {
    const gl = this._gl, G = this._G;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboP);
    const rgba = new Float32Array(G * G * 4);
    gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Float32Array(G * G);
    for (let j = 0; j < G * G; j++) out[j] = rgba[j * 4];
    return out;
  }

  // ── Public: async plate readback via PBO — never blocks the main thread ───────
  // Issues readPixels into a PBO, inserts a fence, then polls the fence via
  // setTimeout until the GPU is done. Resolves with Float32Array(G*G).
  readPlateAsync() {
    const gl = this._gl, G = this._G;
    const byteLen = G * G * 4 * 4; // RGBA32F

    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLen, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboP);
    gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, 0); // async into PBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();

    return new Promise((resolve) => {
      const poll = () => {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) {
          setTimeout(poll, 1);
          return;
        }
        gl.deleteSync(fence);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        const rgba = new Float32Array(byteLen / 4);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, rgba);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteBuffer(pbo);
        const out = new Float32Array(G * G);
        for (let j = 0; j < G * G; j++) out[j] = rgba[j * 4];
        resolve(out);
      };
      setTimeout(poll, 1);
    });
  }

  // ── Public: free all GL resources ───────────────────────────────────────────
  uploadCplxPlate(cplxF32) {
    const gl = this._gl, G = this._G;
    const tex = this._cplxSrc === 'A' ? this._cplxA : this._cplxB;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, G, G, 0, gl.RG, gl.FLOAT, cplxF32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  reconFromCplxPlate() {
    const gl = this._gl, G = this._G;
    const cplxTex = this._cplxSrc === 'A' ? this._cplxA : this._cplxB;
    const fbo     = this._swSrc   === 'A' ? this._fboSwA : this._fboSwB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progReconCplx);
    gl.uniform1i(this._u.reconCplx.cplx, 0);
    gl.uniform1i(this._u.reconCplx.ref,  1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cplxTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ref);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resetCplxPlate() {
    const gl = this._gl, G = this._G;
    for (const fbo of [this._fboCplxA, this._fboCplxB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, G, G);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._cplxSrc = 'A';
  }

  destroy() {
    const gl = this._gl;
    if (!gl) return;
    for (const t of [this._swA, this._swB, this._ref, this._obj, this._plateA, this._plateB, this._ringTex, this._cplxA, this._cplxB, this._srcTex])
      if (t) gl.deleteTexture(t);
    for (const f of [this._fboSwA, this._fboSwB, this._fboPA, this._fboPB, this._fboCplxA, this._fboCplxB])
      if (f) gl.deleteFramebuffer(f);
    for (const p of [this._progStep1, this._progStep2, this._progStep3, this._progAccum, this._progAccumSweep, this._progCopy, this._progStepRecord, this._progReconCplx, this._progRenderField, this._progRenderPhase, this._progRenderPlate])
      if (p) gl.deleteProgram(p);
    this._gl = null;
  }

  // ── Public: render psi amplitude colormap to default framebuffer ────────────
  // Outputs hologram colormap of log-scaled |ψ|² to the WebGL canvas.
  // Call drawImage(gpu.canvas, 0, 0, RW, RH) afterward to blit to a 2D canvas.
  renderField(smoothMax) { this.renderSweepField(smoothMax); }
  renderPhase(smoothMax) { this.renderSweepPhase(smoothMax); }

  freezeSweepToPsi() { /* no-op: single retina texture, sweep IS display */ }

  renderSweepPlate(smoothMaxPlate, smoothMaxField) {
    const gl = this._gl, G = this._G;
    const psiTex   = this._swSrc === 'A' ? this._swA  : this._swB;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderPlate);
    gl.uniform1i(this._u.renderPlate.psi,            0);
    gl.uniform1i(this._u.renderPlate.plate,          1);
    gl.uniform1f(this._u.renderPlate.smoothMaxPlate, smoothMaxPlate);
    gl.uniform1f(this._u.renderPlate.smoothMaxField, smoothMaxField);
    gl.uniform1i(this._u.renderPlate.dir,            -1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, psiTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  renderSweepField(smoothMax) {
    const gl = this._gl, G = this._G;
    const psiTex = this._swSrc === 'A' ? this._swA : this._swB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderField);
    gl.uniform1i(this._u.renderField.psi,       0);
    gl.uniform1f(this._u.renderField.smoothMax, smoothMax);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, psiTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  renderSweepPhase(smoothMax) {
    const gl = this._gl, G = this._G;
    const psiTex = this._swSrc === 'A' ? this._swA : this._swB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderPhase);
    gl.uniform1i(this._u.renderPhase.psi,       0);
    gl.uniform1f(this._u.renderPhase.smoothMax, smoothMax);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, psiTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // ── Public: render plate colormap to default framebuffer ────────────────────
  // dir: 1 = RECORD (show plate), -1 = RECON (show psi amplitude instead)
  renderPlate(smoothMaxPlate, smoothMaxField, dir) {
    const gl = this._gl, G = this._G;
    const psiTex   = this._swSrc === 'A' ? this._swA : this._swB;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderPlate);
    gl.uniform1i(this._u.renderPlate.psi,            0);
    gl.uniform1i(this._u.renderPlate.plate,          1);
    gl.uniform1f(this._u.renderPlate.smoothMaxPlate, smoothMaxPlate);
    gl.uniform1f(this._u.renderPlate.smoothMaxField, smoothMaxField);
    gl.uniform1i(this._u.renderPlate.dir,            dir > 0 ? 1 : -1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, psiTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // ── Capability check (static) ────────────────────────────────────────────────
  static isSupported() {
    try {
      const c  = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return false;
      return !!gl.getExtension('EXT_color_buffer_float');
    } catch { return false; }
  }
}

// ── GLSL sources ──────────────────────────────────────────────────────────────

const GLSL_VERT = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Shared ring-Laplacian macro — inlined into each substep.
// Reads component COMP (0=Re, 1=Im) from u_psi, accumulates ring sum.
// Returns: standard-stencil lap + Σ_d norm_d * (ring_sum_d - n_d * center)
// u_ringMeta: vec4 array, .x=start .y=n .z=norm per ring
// u_rings: isampler2D of (dx,dy) pairs, width=ringCount
const GLSL_LAP_FUNC = /* glsl */`
// the declared non-Hermitian part of the ring (setRingNh, 0 = the symmetric ring, unchanged): offset o weighs 1 + a·n̂·sin(2π·o/G) — as GLSL_X_SHEAR's nhW
uniform vec3 u_nhL;
float nhL(ivec2 o, int G) { return u_nhL.x == 0.0 ? 1.0 : 1.0 + u_nhL.x * (u_nhL.y * sin(6.283185307179586 * float(o.x) / float(G)) + u_nhL.z * sin(6.283185307179586 * float(o.y) / float(G))); }
highp float ringLap(sampler2D psi, ivec2 coord, int comp,
                    isampler2D rings, int nRings, int ringCount) {
  // 9-POINT ISOTROPIC LAPLACIAN (Oono-Puri / Mehrstellen): lap = (4·ortho + diag − 20·ctr)/6.
  // The 5-point NN stencil destroys DIAGONAL momentum (its dispersion error grows fast off-axis), so a
  // self-advecting soliton's group velocity breaks at the grid scale and it radiates a wake / pins to the
  // grid (Peierls-Nabarro). The 9-point stencil is isotropic to O(h⁴) — it pushes dispersion error far out
  // into the Brillouin zone, so a phase-gradient (momentum) actually GRIPS the grid and transports the mass
  // coherently. Weights sum to 0 (conserves constants) → drop-in safe for every stepEyeN/plate consumer.
  int G  = u_G;
  // FAST TORUS WRAP: G is always a power of 2 (128/256/...), so x AND (G-1) equals ((x mod G)+G) mod G but with a
  //   single bitwise AND instead of a slow integer modulo. Add G first so small negatives wrap correctly.
  int M = G - 1;   // (G-1) is the wrap mask iff G is a power of 2 (true for every app grid)
  ivec2 xp   = ivec2((coord.x + 1) & M, coord.y);
  ivec2 xm   = ivec2((coord.x - 1 + G) & M, coord.y);
  ivec2 yp   = ivec2(coord.x, (coord.y + 1) & M);
  ivec2 ym   = ivec2(coord.x, (coord.y - 1 + G) & M);
  ivec2 xpyp = ivec2((coord.x + 1) & M, (coord.y + 1) & M);
  ivec2 xmym = ivec2((coord.x - 1 + G) & M, (coord.y - 1 + G) & M);
  ivec2 xpym = ivec2((coord.x + 1) & M, (coord.y - 1 + G) & M);
  ivec2 xmyp = ivec2((coord.x - 1 + G) & M, (coord.y + 1) & M);
  float ctr   = texelFetch(psi, coord, 0)[comp];
  float ortho = nhL(ivec2(1, 0), G) * texelFetch(psi, xp, 0)[comp] + nhL(ivec2(-1, 0), G) * texelFetch(psi, xm, 0)[comp]
              + nhL(ivec2(0, 1), G) * texelFetch(psi, yp, 0)[comp] + nhL(ivec2(0, -1), G) * texelFetch(psi, ym, 0)[comp];
  float diag  = nhL(ivec2(1, 1), G) * texelFetch(psi, xpyp, 0)[comp] + nhL(ivec2(-1, -1), G) * texelFetch(psi, xmym, 0)[comp]
              + nhL(ivec2(1, -1), G) * texelFetch(psi, xpym, 0)[comp] + nhL(ivec2(-1, 1), G) * texelFetch(psi, xmyp, 0)[comp];
  float lap = (4.0 * ortho + diag - 20.0 * ctr) / 6.0;

  // IFS ring contributions
  for (int d = 0; d < nRings; d++) {
    int   start = int(u_ringMeta[d].x);
    int   n     = int(u_ringMeta[d].y);
    float norm  = u_ringMeta[d].z;
    float acc   = 0.0;
    for (int i = 0; i < n; i++) {
      ivec2 off = texelFetch(rings, ivec2(start + i, 0), 0).xy;
      ivec2 nb  = ivec2((coord.x + off.x + G * 4) & M,   // & M (=G-1) instead of % G — offsets are ≤ ~G so +G*4 keeps it ≥0
                        (coord.y + off.y + G * 4) & M);
      acc += nhL(off, G) * texelFetch(psi, nb, 0)[comp];
    }
    lap += norm * (acc - float(n) * ctr);
  }
  return lap;
}`;

// Max rings supported by GLSL uniform array — 16 is safe on all hardware.
// If nRings > 16 the kernel merging in JS already caps it (MAX_IFS_BANDS=4).
const GLSL_UNIFORMS = /* glsl */`
uniform sampler2D  u_psi;
uniform isampler2D u_rings;
uniform sampler2D  u_ref;
uniform sampler2D  u_plate;
uniform float u_dt;
uniform int   u_G;
uniform int   u_nRings;
uniform int   u_ringCount;
uniform vec4  u_ringMeta[16];`;

// Substep 1: Re -= (dt/4) · lap(Im)
// Reads Im from src (comp 1), subtracts from Re (comp 0), writes full RG.
const GLSL_STEP1 = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
${GLSL_UNIFORMS}
in vec2 v_uv;
out vec4 fragColor;
${GLSL_LAP_FUNC}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  float h     = u_dt * 0.25;
  float lapIm = ringLap(u_psi, coord, 1, u_rings, u_nRings, u_ringCount);
  fragColor = vec4(psi.x - h * lapIm, psi.y, 0.0, 1.0);
}`;

// Substep 2: Im += (dt/2) · lap(Re)
// Re was updated by substep 1 — now in current src texture.
const GLSL_STEP2 = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
${GLSL_UNIFORMS}
in vec2 v_uv;
out vec4 fragColor;
${GLSL_LAP_FUNC}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  float f     = u_dt * 0.5;
  float lapRe = ringLap(u_psi, coord, 0, u_rings, u_nRings, u_ringCount);
  fragColor = vec4(psi.x, psi.y + f * lapRe, 0.0, 1.0);
}`;

// Substep 3: Re -= (dt/4) · lap(Im)  [same as step 1, on updated Im]
const GLSL_STEP3 = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
${GLSL_UNIFORMS}
in vec2 v_uv;
out vec4 fragColor;
${GLSL_LAP_FUNC}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  float h     = u_dt * 0.25;
  float lapIm = ringLap(u_psi, coord, 1, u_rings, u_nRings, u_ringCount);
  fragColor = vec4(psi.x - h * lapIm, psi.y, 0.0, 1.0);
}`;

// Plate accumulation: plate = plate * decay + |ψ + ref|² * (1 - decay)
// R32F plate FBO — reads from u_plate (previous), u_psi, u_ref.
const GLSL_ACCUM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_ref;
uniform sampler2D u_plate;
uniform float     u_decay;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi,   coord, 0).xy;
  vec2  ref   = texelFetch(u_ref,   coord, 0).xy;
  float prev  = texelFetch(u_plate, coord, 0).x;
  float re    = psi.x + ref.x;
  float im    = psi.y + ref.y;
  float inten = re*re + im*im;
  fragColor   = vec4(prev * u_decay + inten * (1.0 - u_decay), 0.0, 0.0, 1.0);
}`;

// Sweep plate accumulation: plate = plate * decay + |sweepPsi + ref|²
// Uses u_sw (sweep psi texture) instead of display u_psi — keeps display psi untouched.
const GLSL_ACCUM_SWEEP = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_sw;
uniform sampler2D u_ref;
uniform sampler2D u_plate;
uniform float     u_decay;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_sw,    coord, 0).xy;
  vec2  ref   = texelFetch(u_ref,   coord, 0).xy;
  float prev  = texelFetch(u_plate, coord, 0).x;
  float re    = psi.x + ref.x;
  float im    = psi.y + ref.y;
  float inten = re*re + im*im;
  fragColor   = vec4(prev * u_decay + inten * (1.0 - u_decay), 0.0, 0.0, 1.0);
}`;

// §7.90 FIELD MULTIPLY — pointwise COMPLEX product ψ_eye · ψ_b, written back into the eye field. This is the
// BINDING done as a MEDIUM operation: two field textures interact cell-by-cell on the GPU (no JS dot product),
// the result IS field content that the soliton/IFS dynamics then transport (§9 proved propagating ψA·ψB recovers
// the A·B correlation). The medium operates on the medium — the "optical chip" in THIS substrate's terms (soliton
// lenses + IFS clocks, not orthogonal Fourier carriers). u_a = eye ψ, u_b = the second operand field.
const GLSL_FIELD_MUL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_a;   // eye field ψ_A (.xy = re, im)
uniform sampler2D u_b;   // operand field ψ_B
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 a = texelFetch(u_a, coord, 0).xy;
  vec2 b = texelFetch(u_b, coord, 0).xy;
  // complex multiply: (ar+i·ai)(br+i·bi) = (ar·br − ai·bi) + i(ar·bi + ai·br)
  fragColor = vec4(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x, 0.0, 1.0);
}`;

// QUATERNION SU(2) MIX — the FIELD-LEVEL qedge, fully GPU-resident (zero readback). A quaternion FIELD is the PAIR
// (ψ_A = z0, ψ_B = z1) of two eye slots (quaternion-pair.js: ℍ = ℂ⊕ℂ·j). This shader applies the SU(2) register
// u·ψ_ℍ per cell, in the pair basis (Cayley–Dickson, from qmulField with Q=u constant, R=ψ):
//     pA = u0·ψ_A − conj(ψ_B)·u1        (slot A output)
//     pB = u1·conj(ψ_A) + ψ_B·u0        (slot B output)
//   u = (u0, u1) the unit quaternion (u0=[cos(θ/2), nz·sin], u1=[nx·sin, ny·sin]); the U(1) slice (u1=0) reduces to
//   a per-channel e^{i∠} on both slots — today's lensU1 aging, byte-exact (proven headless). u_which selects the
//   output channel (0 → pA, 1 → pB) so ONE two-input shader run twice produces BOTH rotated slots. Peer-pure: u is
//   a SHARED constant (the replicated register element), sampling is fixed-function → deterministic same-device.
const GLSL_QUAT_MIX = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_a;    // slot-A field ψ_A (.xy = re, im)
uniform sampler2D u_b;    // slot-B field ψ_B
uniform vec2 u_u0;        // SU(2) element z0 = [cos(θ/2), nz·sin(θ/2)]
uniform vec2 u_u1;        // SU(2) element z1 = [nx·sin(θ/2), ny·sin(θ/2)]
uniform int  u_which;     // 0 → output pA (slot A), 1 → output pB (slot B)
out vec4 fragColor;
vec2 cmul(vec2 p, vec2 q) { return vec2(p.x*q.x - p.y*q.y, p.x*q.y + p.y*q.x); }   // complex ·
vec2 cconj(vec2 p) { return vec2(p.x, -p.y); }                                     // z̄
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 a = texelFetch(u_a, coord, 0).xy;   // ψ_A at this cell
  vec2 b = texelFetch(u_b, coord, 0).xy;   // ψ_B at this cell
  vec2 outv;
  // RIGHT action ψ_ℍ·u (quaternion-pair.js su2ApplyField): the ℂ-LINEAR spinor rotation [[u0,−ū1],[u1,ū0]]·(ψ_A,ψ_B).
  //   (It was the LEFT action u·ψ_ℍ, which is antilinear and does not commute with the medium's own step.)
  if (u_which == 0) outv = cmul(u_u0, a) - cmul(cconj(u_u1), b);   // pA = u0·ψ_A − ū1·ψ_B
  else              outv = cmul(u_u1, a) + cmul(cconj(u_u0), b);   // pB = u1·ψ_A + ū0·ψ_B
  fragColor = vec4(outv, 0.0, 1.0);
}`;

// DUAL-QUATERNION SE(3) MIX — the FOUR-slot dqedge, GPU-resident (doc/dual-quaternion-torus.md). A dual-quaternion
// FIELD is (q_r, q_d) = two quaternion pairs: (A,B)=q_r ROTATION, (C,D)=q_d TRANSLATION. This applies a CONSTANT unit
// dual quaternion U=(u_r, u_d) (the SE(3) screw register) by RIGHT multiply ψ̂·U per cell (dqApplyField). From ε²=0:
//     P.r = ψ_r·u_r                       (rotation output — the ℍ product, decoupled from the dual part)
//     P.d = ψ_r·u_d + ψ_d·u_r             (translation output — the nilpotent CROSS term)
//   with the pair-basis quaternion product qmul((a,b),(c,d)) = ( a·c − conj(d)·b , b·conj(c) + d·a ) → (p0, p1).
// u_which ∈ {0,1,2,3} selects the output channel (rA, rB, dA, dB) so ONE 4-input shader run four times produces the
// whole rotated dual-quaternion field. u_d=0 ⇒ the dual part passes through unrotated by the translation → the SU(2)
// slice = the ℍ pair on (A,B) (pitch=0). Peer-pure: U is the SHARED replicated screw → deterministic same-device.
const GLSL_DUAL_QMIX = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_rA;   // ψ_r pair: rotation-quaternion z0 (slot A) and z1 (slot B)
uniform sampler2D u_rB;
uniform sampler2D u_dA;   // ψ_d pair: translation-quaternion z0 (slot C) and z1 (slot D)
uniform sampler2D u_dB;
uniform vec2 u_ur0;       // U.r (rotation quaternion of the SE(3) screw): z0, z1
uniform vec2 u_ur1;
uniform vec2 u_ud0;       // U.d (dual/translation quaternion of the screw): z0, z1
uniform vec2 u_ud1;
uniform int  u_which;     // 0→rA, 1→rB, 2→dA, 3→dB
out vec4 fragColor;
vec2 cmul(vec2 p, vec2 q) { return vec2(p.x*q.x - p.y*q.y, p.x*q.y + p.y*q.x); }
vec2 cconj(vec2 p) { return vec2(p.x, -p.y); }
// pair-basis quaternion product qmul((a,b),(c,d)) → returns p0 (which=0) or p1 (which=1):
//   p0 = a·c − conj(d)·b ; p1 = b·conj(c) + d·a
vec2 qmulZ(vec2 a, vec2 b, vec2 c, vec2 d, int part) {
  if (part == 0) return cmul(a, c) - cmul(cconj(d), b);
  else           return cmul(b, cconj(c)) + cmul(d, a);
}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 rA = texelFetch(u_rA, coord, 0).xy, rB = texelFetch(u_rB, coord, 0).xy;   // ψ_r = (rA, rB)
  vec2 dA = texelFetch(u_dA, coord, 0).xy, dB = texelFetch(u_dB, coord, 0).xy;   // ψ_d = (dA, dB)
  vec2 outv;
  // RIGHT action ψ̂·Û (dual-quaternion.js dqApplyField) — the field is the LEFT factor of every product.
  if (u_which == 0 || u_which == 1) {
    // rotation output = ψ_r · u_r
    outv = qmulZ(rA, rB, u_ur0, u_ur1, u_which);
  } else {
    // translation output = ψ_r · u_d + ψ_d · u_r   (part = which−2)
    int part = u_which - 2;
    outv = qmulZ(rA, rB, u_ud0, u_ud1, part) + qmulZ(dA, dB, u_ur0, u_ur1, part);
  }
  fragColor = vec4(outv, 0.0, 1.0);
}`;

// §7.92 ROTATE-ABOUT-CENTERS — the θ-operator as a pure-medium field transform. A coordinate REMAP (resample),
// not a phase multiply: ψ'(x) = ψ( R⁻¹·(x−c) + c ) inside each main's annulus, with R = rotation by u_delta.
// This is medium-native (a GPU field op, same class as FIELD_MUL) and MOVES |ψ| — so the integer peak-detect read
// sees the satellite at its new angle (the §7.92 fix: phase couldn't move pixel-geometry data; a remap does).
// Peer-pure by construction: u_delta is a shared constant, bilinear resample is fixed-function, centers are the
// peer-identical main pixels. Outside every annulus the field passes through unchanged (rigid local rotation).
const GLSL_ROTATE_CENTERS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_delta;          // rotation angle (rad), SHARED constant
uniform int   u_n;              // number of centers
uniform vec2  u_centers[16];    // main pixel coords (x,y), up to 16 maps
uniform float u_rad;            // annulus outer radius (px) — the satellite ring + margin
uniform int   u_G;
out vec4 fragColor;
vec2 fetchBilinear(vec2 p) {    // bilinear sample of ψ at fractional pixel p
  vec2 f = floor(p), fr = p - f;
  ivec2 i00 = ivec2(f);
  vec2 a = texelFetch(u_psi, clamp(i00,            ivec2(0), ivec2(u_G-1)), 0).xy;
  vec2 b = texelFetch(u_psi, clamp(i00+ivec2(1,0), ivec2(0), ivec2(u_G-1)), 0).xy;
  vec2 c = texelFetch(u_psi, clamp(i00+ivec2(0,1), ivec2(0), ivec2(u_G-1)), 0).xy;
  vec2 d = texelFetch(u_psi, clamp(i00+ivec2(1,1), ivec2(0), ivec2(u_G-1)), 0).xy;
  return mix(mix(a,b,fr.x), mix(c,d,fr.x), fr.y);
}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 x = vec2(coord);
  // which center's annulus is this pixel in? (nearest within u_rad; annuli shouldn't overlap by design)
  int hit = -1; float bd = u_rad;
  for (int i = 0; i < 16; i++) { if (i >= u_n) break;
    float d = distance(x, u_centers[i]); if (d <= u_rad && d < bd) { bd = d; hit = i; } }
  if (hit < 0) { fragColor = vec4(texelFetch(u_psi, coord, 0).xy, 0.0, 1.0); return; }
  vec2 c = u_centers[hit], rel = x - c;
  float cs = cos(-u_delta), sn = sin(-u_delta);   // INVERSE rotation (sample the pre-image)
  vec2 src = vec2(cs*rel.x - sn*rel.y, sn*rel.x + cs*rel.y) + c;
  fragColor = vec4(fetchBilinear(src), 0.0, 1.0);
}`;

// §7.98 AFFINE-ABOUT-CENTERS — the GENERAL metric operator (§7.97 prediction): ψ'(x)=ψ(Minv·(x−c−t)+c) inside each
// main's annulus, where Minv = the INVERSE 2×2 linear map (sample the pre-image) and t = translation. Covers the
// WHOLE affine family with one shader: rotation (Minv=R⁻¹), SCALE (Minv=diag(1/s) → s-channel), SHEAR, TRANSLATION
// (t → tx,ty). Same residue-free metric op as §7.92 rotate (a coordinate remap, no second field) → predicted to
// self-host + be peer-pure identically. The host passes the INVERSE map so the shader just samples the pre-image.
const GLSL_AFFINE_CENTERS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform vec4  u_minv;           // inverse linear map [m00,m01,m10,m11], row-major (sample pre-image)
uniform vec2  u_tinv;           // inverse translation (subtracted before the linear map)
uniform int   u_n;
uniform vec2  u_centers[16];
uniform float u_rad;
uniform int   u_G;
out vec4 fragColor;
vec2 fetchBilinear(vec2 p) {
  vec2 f = floor(p), fr = p - f; ivec2 i00 = ivec2(f);
  vec2 a = texelFetch(u_psi, clamp(i00,            ivec2(0), ivec2(u_G-1)), 0).xy;
  vec2 b = texelFetch(u_psi, clamp(i00+ivec2(1,0), ivec2(0), ivec2(u_G-1)), 0).xy;
  vec2 c = texelFetch(u_psi, clamp(i00+ivec2(0,1), ivec2(0), ivec2(u_G-1)), 0).xy;
  vec2 d = texelFetch(u_psi, clamp(i00+ivec2(1,1), ivec2(0), ivec2(u_G-1)), 0).xy;
  return mix(mix(a,b,fr.x), mix(c,d,fr.x), fr.y);
}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 x = vec2(coord);
  int hit = -1; float bd = u_rad;
  for (int i = 0; i < 16; i++) { if (i >= u_n) break;
    float d = distance(x, u_centers[i]); if (d <= u_rad && d < bd) { bd = d; hit = i; } }
  if (hit < 0) { fragColor = vec4(texelFetch(u_psi, coord, 0).xy, 0.0, 1.0); return; }
  vec2 c = u_centers[hit], rel = (x - c) - u_tinv;
  vec2 src = vec2(u_minv.x*rel.x + u_minv.y*rel.y, u_minv.z*rel.x + u_minv.w*rel.y) + c;
  fragColor = vec4(fetchBilinear(src), 0.0, 1.0);
}`;

// FULL K-MAP IFS WARP — the K affine maps applied + COMPLEX SUPERPOSED in ONE GPU pass (no per-map readbacks). For each output
// pixel x, loop the K maps; each map fₖ has inverse-linear u_minv[k] and inverse-translate u_tinv[k]; sample the pre-image
// src = Minv·(x−t) (centered at grid middle), and SUM the K complex samples ((1/√K)·Σ fₖ(ψ)) → the warped wavefronts INTERFERE
// (honest wave-combine, not the max-magnitude attractor-render convention). One pass, the medium combines the K maps. u_n ≤ 8.
const GLSL_IFS_WARP = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform vec4  u_minv[8];     // per-map inverse linear [m00,m01,m10,m11]
uniform vec2  u_tinv[8];     // per-map inverse translation
uniform int   u_n;
uniform int   u_G;
uniform float u_smooth;      // 0 = Catmull-Rom (sharp, default — IFS render); 1 = bilinear (non-ringing, orbit transport)
out vec4 fragColor;
vec2 tap(ivec2 i) { return texelFetch(u_psi, clamp(i, ivec2(0), ivec2(u_G-1)), 0).xy; }
// BICUBIC (Catmull-Rom) sample of ψ at fractional pixel p — a 4×4 cubic kernel. Sharper than bilinear (much less low-pass
// smoothing) and near energy-preserving for smooth fields → reduces the per-resample loss of the metric remap. The complex
// (re,im) channels are interpolated together (the Catmull-Rom kernel is linear, so it commutes with the complex structure).
float cr(float t, float a0, float a1, float a2, float a3) {   // 1-D Catmull-Rom at fraction t over 4 samples
  return a1 + 0.5*t*(a2 - a0 + t*(2.0*a0 - 5.0*a1 + 4.0*a2 - a3 + t*(3.0*(a1 - a2) + a3 - a0)));
}
vec2 fetchBicubic(vec2 p) {
  vec2 f = floor(p), fr = p - f; ivec2 i = ivec2(f);
  vec2 row[4];
  for (int r = 0; r < 4; r++) {
    vec2 s0 = tap(i + ivec2(-1, r-1)), s1 = tap(i + ivec2(0, r-1)), s2 = tap(i + ivec2(1, r-1)), s3 = tap(i + ivec2(2, r-1));
    row[r] = vec2(cr(fr.x, s0.x, s1.x, s2.x, s3.x), cr(fr.x, s0.y, s1.y, s2.y, s3.y));
  }
  return vec2(cr(fr.y, row[0].x, row[1].x, row[2].x, row[3].x), cr(fr.y, row[0].y, row[1].y, row[2].y, row[3].y));
}
// BILINEAR (tent) sample — NON-RINGING (no negative lobes/overshoot). Catmull-Rom is sharp but RINGS at edges (negative overshoot), and chained
// over many warps the ringing compounds into high-frequency NOISE (orbit's degradation). Bilinear is gently low-pass (slight blur) but injects NO
// ringing → no noise accumulation. Used by orbit (u_smooth=1); the IFS attractor render keeps Catmull-Rom (u_smooth=0, byte-identical to before).
vec2 fetchBilinear(vec2 p) {
  vec2 f = floor(p), fr = p - f; ivec2 i = ivec2(f);
  vec2 s00 = tap(i), s10 = tap(i+ivec2(1,0)), s01 = tap(i+ivec2(0,1)), s11 = tap(i+ivec2(1,1));
  vec2 a = mix(s00, s10, fr.x), b = mix(s01, s11, fr.x);
  return mix(a, b, fr.y);
}
// PHASE-AWARE bilinear (u_smooth=2): interpolate MAGNITUDE and PHASE separately, not re/im. Bilinear of re/im AVERAGES neighbors → for a phase-varying
// field opposite phases CANCEL → amplitude destroyed (the fractional-warp shatter/drain). Here: magnitudes interp bilinearly (no cancellation); phase via
// the COMPLEX-VECTOR sum direction (mix of unit phasors, robust to wrap). Recombine |ψ|·e^{iφ}. A fractional shift then PRESERVES a complex structured field.
vec2 fetchPhaseAware(vec2 p) {
  vec2 f = floor(p), fr = p - f; ivec2 i = ivec2(f);
  vec2 s00 = tap(i), s10 = tap(i+ivec2(1,0)), s01 = tap(i+ivec2(0,1)), s11 = tap(i+ivec2(1,1));
  // bilinear MAGNITUDE (no phase cancellation)
  float m00=length(s00), m10=length(s10), m01=length(s01), m11=length(s11);
  float mag = mix(mix(m00,m10,fr.x), mix(m01,m11,fr.x), fr.y);
  // bilinear PHASE as a vector sum of unit phasors (each weighted by bilinear weight) → robust direction, no 2π-wrap artifacts
  vec2 d = mix(mix(s00,s10,fr.x), mix(s01,s11,fr.x), fr.y);   // re/im mix gives the right ANGLE even though its magnitude cancels
  float dl = length(d);
  return (dl > 1e-12) ? mag * (d/dl) : vec2(0.0);             // |ψ| from magnitude-interp, e^{iφ} from the (normalized) re/im-mix direction
}
vec2 fetchSample(vec2 p) { return (u_smooth > 1.5) ? fetchPhaseAware(p) : (u_smooth > 0.5) ? fetchBilinear(p) : fetchBicubic(p); }
void main() {
  // gl_FragCoord is the pixel CENTER (x+0.5). For the ORBIT path (u_smooth=1) use the integer texel coord so an integer translation lands on integers
  // (fr=0 = lossless); otherwise every sample sits at fr=0.5 = max interpolation, which for a complex (phase-varying) field averages neighbors and
  // DESTROYS ~18% of magnitude per warp (measured: orbit's energy sink). The IFS-render path (u_smooth=0) keeps gl_FragCoord.xy EXACTLY (unchanged).
  // smooth=1 (bilinear, integer-warp path) floors so integer t lands on fr=0 (lossless). smooth=2 (phase-aware, FRACTIONAL warp) keeps the −0.5 pixel-
  // center so fractional t samples fractionally (the honest continuous metric). smooth=0 (IFS render) keeps gl_FragCoord exactly.
  vec2 x = (u_smooth > 1.5) ? (gl_FragCoord.xy - 0.5) : (u_smooth > 0.5) ? floor(gl_FragCoord.xy) : gl_FragCoord.xy;
  vec2 ctr = vec2(float(u_G)*0.5);
  // COMPLEX SUPERPOSITION (honest wave-combine): ψ'(x) = (1/√K)·Σₖ fₖ(ψ)(x). The K warped wavefronts ADD as complex amplitudes
  // → they INTERFERE (constructive/destructive), the true way K transformed fields combine in a linear medium. (Was max-magnitude,
  // an IFS-attractor rendering convention, NOT wave physics.) 1/√K = energy-preserving normalization for K equal-amplitude fields.
  vec2 sum = vec2(0.0);
  for (int k = 0; k < 8; k++) { if (k >= u_n) break;
    vec2 rel = (x - ctr) - u_tinv[k];
    vec2 src = vec2(u_minv[k].x*rel.x + u_minv[k].y*rel.y, u_minv[k].z*rel.x + u_minv[k].w*rel.y) + ctr;
    sum += fetchSample(src);   // complex add (re,im) → interference; bicubic (sharp) or bilinear (non-ringing, orbit) per u_smooth
  }
  float norm = (u_n > 0) ? inversesqrt(float(u_n)) : 1.0;
  fragColor = vec4(sum * norm, 0.0, 1.0);
}`;

// §7.98 GENOME LENS PHASE-PLATE (GPU port of eye.js lensXform's per-pixel loop): at each cell, find the NEAREST
// genome main (center), then multiply by the genome's compound phase about it — quadratic FOCUS a·(dx²+dy²),
// cross-quadratic SHEAR β·dx·dy (the genome's satellite θ), and an optional OPTICAL VORTEX vtx·atan2(dy,dx).
// One GPU pass, zero CPU readback → the "optical chip" lens runs natively (the recursive clock at frame rate).
// §7.102 GPU linOp (transform/mul form): ψ ·= e^{iφ}, φ = LINEAR (kx·x+ky·y) + the GENOME-LENS QUADRATIC phase about
// the nearest center (a·r² FOCUS + β·dx·dy SHEAR + vtx·atan2 VORTEX). The full content·e^{iφ} operator on the GPU,
// φ spanning linear (carrier/θ-shift) → quadratic (the optical-chip lens). u_n=0 + lens coeffs=0 ⇒ pure linear carrier.
const GLSL_LENS_GENOME = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform int   u_n;
uniform vec2  u_centers[16];   // genome mains (px), already offset by (tx,ty) on the JS side
uniform float u_a;             // quadratic focus coeff = (1-s)*0.06
uniform float u_beta;          // cross-quadratic shear = theta*0.04
uniform float u_vtx;           // vortex charge (0 = off)
uniform vec2  u_k;             // §7.102 LINEAR carrier wavevector (kx,ky) — 0 = no carrier term
uniform float u_phaseT;        // §7.101d/§7.102 TEMPORAL carrier phase ω·t — makes it SPACETIME content·e^{i(k·r+ωt)}. 0 = spatial-only.
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  if (psi.x == 0.0 && psi.y == 0.0) { fragColor = vec4(psi, 0.0, 1.0); return; }
  vec2 x = vec2(coord);
  float phi = u_k.x*x.x + u_k.y*x.y + u_phaseT;   // SPACETIME carrier k·r + ω·t (the §7.101d stamped-time axis; LOSSY — space exact, time disperses)
  if (u_n > 0) {                        // + the QUADRATIC genome-lens phase about the nearest center
    vec2 bc = u_centers[0]; float bd = 1e30;
    for (int i = 0; i < 16; i++) { if (i >= u_n) break;
      float d = distance(x, u_centers[i]); if (d < bd) { bd = d; bc = u_centers[i]; } }
    vec2 dxy = x - bc;
    phi += u_a*(dxy.x*dxy.x + dxy.y*dxy.y) + u_beta*dxy.x*dxy.y;
    if (u_vtx != 0.0) phi += u_vtx * atan(dxy.y, dxy.x);
  }
  float cr = cos(phi), si = sin(phi);
  fragColor = vec4(psi.x*cr - psi.y*si, psi.x*si + psi.y*cr, 0.0, 1.0);
}`;

// Thin lens phase mask: psi *= exp(i * kwave * r² / (2*f)), r² = (x-cx)²+(y-cy)²
// Applied to sweep psi after backward propagation to focus reconstruction at depth f.
const GLSL_LENS_PHASE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float     u_kwave;
uniform float     u_f;
uniform int       u_G;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  float cx    = float(coord.x) - float(u_G) * 0.5;
  float cy    = float(coord.y) - float(u_G) * 0.5;
  float r2    = cx*cx + cy*cy;
  float ph    = u_kwave * r2 / (2.0 * u_f);
  float cr    = cos(ph), si = sin(ph);
  fragColor   = vec4(psi.x*cr - psi.y*si, psi.x*si + psi.y*cr, 0.0, 1.0);
}`;

// Copy pass — used for RECON seed: plate → psi (plate values as Re, Im=0)
// FILM COPY (RG, complex-preserving): the DISPLAY snapshot of a slot's live field, taken GPU-side at the SHARED
// step. GLSL_COPY above is single-channel (.x) and would drop Im; the film must carry the full complex field
// because renderDescField evaluates content·e^{i(...)} on it. Nothing here is ever read back — that is the point:
// the old path was texture→readPixels→descBase→descDisp→upload, which round-tripped DISPLAY bytes through the
// model's own storage (descBase is in regH) and stalled the GPU pipeline on every refresh.
const GLSL_FILM_COPY = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_src;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 c      = texelFetch(u_src, coord, 0).xy;
  fragColor   = vec4(c, 0.0, 1.0);
}`;

// FILM PEAK (log-step reduction): max |ψ|² over the film, computed GPU-side into a 1×1 texture the render shader
// SAMPLES — never read back, so no pipeline stall. A DISPLAY quantity only (the colormap normalizer): it never
// enters the register, so GPU float precision stays a view concern, exactly as the meta-circular split requires.
// USER SHADER over the live field — the user supplies `vec4 medium(vec2 uv, vec2 psi)`. field(uv) samples the complex field
//   (blended between two sub-step frames); the u_* uniforms are the medium's clock and register at the presented virtual time.
const GLSL_USER_HEAD = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psiA;
uniform sampler2D u_psiB;
uniform float u_mix;
uniform int u_G;
uniform float u_vt, u_tickFrac, u_tau, u_beatFrac, u_age, u_cyc, u_phase, u_omega, u_beta, u_E, u_lock, u_qtheta, u_slot;
uniform vec2 u_k, u_shift;
out vec4 fragColor;
const float PI = 3.141592653589793;
vec2 field(vec2 uv) { ivec2 c = ivec2(floor(fract(uv) * float(u_G))); return mix(texelFetch(u_psiA, c, 0).xy, texelFetch(u_psiB, c, 0).xy, u_mix); }
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
`;
const GLSL_USER_TAIL = /* glsl */`
void main() { vec2 uv = gl_FragCoord.xy / float(u_G); fragColor = medium(uv, field(uv)); }`;

// TILE PROBE — one output texel per tile of B×B cells: (mean|ψ|², mean Re ψ, mean Im ψ, mean |∇ψ|²), periodic differences.
//   BAND PROBE, pass 1: pixel (b, y) = Σ over x of row y's modes in band b of (|S|², S·conj(P)) — S the spectrum now, P one lag earlier
const GLSL_BAND_ROW = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_cur, u_lag;
uniform int u_G, u_nb;
uniform vec2 u_k;
out vec4 fragColor;
const float PI = 3.141592653589793;
float wrapPi(float v) { return mod(v + PI, 2.0 * PI) - PI; }
void main() {
  int b = int(gl_FragCoord.x), y = int(gl_FragCoord.y), G = u_G;
  float qy = wrapPi(float(y <= G / 2 ? y : y - G) * 2.0 * PI / float(G) + u_k.y);
  float se = 0.0, cr = 0.0, ci = 0.0;
  for (int x = 0; x < G; x++) {
    float qx = wrapPi(float(x <= G / 2 ? x : x - G) * 2.0 * PI / float(G) + u_k.x), k = length(vec2(qx, qy));
    if (k > PI) continue;
    int bb = min(u_nb - 1, int(floor(k / PI * float(u_nb) + 1e-5)));   // +1e-5: a lattice mode exactly on a band edge falls where the f64 binning puts it
    if (bb != b) continue;
    vec2 s = texelFetch(u_cur, ivec2(x, y), 0).xy, p = texelFetch(u_lag, ivec2(x, y), 0).xy;
    se += dot(s, s); cr += s.x * p.x + s.y * p.y; ci += s.y * p.x - s.x * p.y;
  }
  fragColor = vec4(se, cr, ci, 0.0);
}`;
//   SECTOR BAND PROBE, pass 1: pixel (b, y) → three targets, each RGBA = sectors 0..3 of row y's modes in band b: |S|², re and im of S·conj(P)
const GLSL_BAND_ROW_SEC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_cur, u_lag;
uniform int u_G, u_nb;
uniform vec2 u_k;
uniform int u_rf;
uniform ivec2 u_b2, u_b2L;
uniform float u_r2;
uniform int u_kcm;     // the EYE's spectral H-compute on the PLATE's mode read (rows 0–3 under an eye op): 0 none · 1 low-pass keep |p|² ≤ u_kc2 · 2 high-pass keep > u_kc2
uniform float u_kc2;
//   the EYE's k-space ops — RELABELS of the plate's own spectrum, no transform (the ear "in the dual", like ◐medium's mirror):
//   conjugate (ψ → ψ̄): F̃(p) = conj F(−p) · the ANALYSER θ (Malus on the phasor): ψ̃ = ½(ψ + e^{2iθ}·ψ̄) → F̃(p) = ½(F(p) + e^{2iθ}·conj F(−p))
//   · the BEAM STOP: no plate mode within √u_bsr2 of a beam bin (a block in the Fourier plane)
uniform int u_cjk;
uniform vec3 u_pol;    // (on, cos 2θ, sin 2θ)
uniform int u_bsN;
uniform ivec2 u_bs0, u_bs1, u_bs2, u_bs3;
uniform float u_bsr2;
uniform int u_full;    // 1: the whole row, as before the windows (A/B and diagnosis only)
layout(location = 0) out vec4 oE;
layout(location = 1) out vec4 oCr;
layout(location = 2) out vec4 oCi;
layout(location = 3) out vec4 oP;   // the shell's PLACE: Σ s(q+e_x)·conj s(q), Σ s(q+e_y)·conj s(q) — the shift theorem: N·Σ|ψ|²·e^{−2πi x/G} (the shell's centroid and concentration)
const float PI = 3.141592653589793;
float wrapPi(float v) { return v > PI ? v - 2.0 * PI : (v < -PI ? v + 2.0 * PI : v); }   // exact inside [−π, π] (no mod rounding: ±x stay exact opposites)
int wq(int v, int G) { v = ((v % G) + G) % G; return v <= G / 2 ? v : v - G; }
vec2 rdF(sampler2D t, int px, int py, int G) { vec2 v = texelFetch(t, ivec2(px, py), 0).xy;
  if (u_cjk == 1 || u_pol.x > 0.5) { vec2 w = texelFetch(t, ivec2((G - px) % G, (G - py) % G), 0).xy * vec2(1.0, -1.0);
    v = u_cjk == 1 ? w : 0.5 * (v + vec2(u_pol.y * w.x - u_pol.z * w.y, u_pol.y * w.y + u_pol.z * w.x)); }
  return v; }
bool gated(int px, int py, int G) { int ax = wq(px, G), ay = wq(py, G);
  if (u_kcm != 0) { float d2 = float(ax * ax + ay * ay); if (u_kcm == 1 ? d2 > u_kc2 : d2 <= u_kc2) return true; }
  for (int k = 0; k < 4; k++) { if (k >= u_bsN) break; ivec2 bk = k == 0 ? u_bs0 : (k == 1 ? u_bs1 : (k == 2 ? u_bs2 : u_bs3)); int dx = wq(px - bk.x, G), dy = wq(py - bk.y, G); if (float(dx * dx + dy * dy) < u_bsr2) return true; }
  return false; }
//   ONE CELL of the row (the loop body): every test exact as before — a cell outside band b, the disk or a gate adds nothing
void cell(int x, int y, int qyi, float qy, int b, int G, inout vec4 E, inout vec4 CR, inout vec4 CI, inout vec4 P) {
    int qxi = x <= G / 2 ? x : x - G;
    float qx = wrapPi(float(qxi) * 2.0 * PI / float(G) + u_k.x), k = length(vec2(qx, qy));
    if (k > PI) return;
    int bb = min(u_nb - 1, int(floor(k / PI * float(u_nb) + 1e-5)));
    if (bb != b) return;
    int sec = abs(qx) >= abs(qy) ? (qx >= 0.0 ? 0 : 2) : (qy >= 0.0 ? 1 : 3);   // exact comparisons: a lattice mode on a diagonal goes to the horizontal sector in f32 and f64 alike
    vec4 m = vec4(float(sec == 0), float(sec == 1), float(sec == 2), float(sec == 3));
    vec2 s, p;
    if (u_rf == 1) {   // the MIRRORED read (the ◐medium analyser in the dual): the shown bin q holds conj F((2b − q) mod G) on the disk |q| < r — now and at the lag (its own b)
      if (float(qxi * qxi + qyi * qyi) >= u_r2) return;
      int px = (u_b2.x - qxi + 2 * G) % G, py = (u_b2.y - qyi + 2 * G) % G; if (gated(px, py, G)) return;
      s = rdF(u_cur, px, py, G) * vec2(1.0, -1.0);
      p = rdF(u_lag, (u_b2L.x - qxi + 2 * G) % G, (u_b2L.y - qyi + 2 * G) % G, G) * vec2(1.0, -1.0);
      { int nx = (px + G - 1) % G, ny = (py + G - 1) % G;   // the shown neighbours q + e_x, q + e_y are the plate's p − e_x, p − e_y
        if (float((qxi + 1) * (qxi + 1) + qyi * qyi) < u_r2 && !gated(nx, py, G)) { vec2 n = rdF(u_cur, nx, py, G) * vec2(1.0, -1.0); P.xy += vec2(n.x * s.x + n.y * s.y, n.y * s.x - n.x * s.y); }
        if (float(qxi * qxi + (qyi + 1) * (qyi + 1)) < u_r2 && !gated(px, ny, G)) { vec2 n = rdF(u_cur, px, ny, G) * vec2(1.0, -1.0); P.zw += vec2(n.x * s.x + n.y * s.y, n.y * s.x - n.x * s.y); } } }
    else { if (u_rf == 2 && float(qxi * qxi + qyi * qyi) >= u_r2) return;   // u_rf 2: the field read DIRECTLY on the disk (the ear res)
      if (gated(x, y, G)) return;
      s = rdF(u_cur, x, y, G); p = rdF(u_lag, x, y, G);
      { int nx = (x + 1) % G, ny = (y + 1) % G, wx = wq(x + 1, G), wy = wq(y + 1, G);
        if (!(u_rf == 2 && float(wx * wx + qyi * qyi) >= u_r2) && !gated(nx, y, G)) { vec2 n = rdF(u_cur, nx, y, G); P.xy += vec2(n.x * s.x + n.y * s.y, n.y * s.x - n.x * s.y); }
        if (!(u_rf == 2 && float(qxi * qxi + wy * wy) >= u_r2) && !gated(x, ny, G)) { vec2 n = rdF(u_cur, x, ny, G); P.zw += vec2(n.x * s.x + n.y * s.y, n.y * s.x - n.x * s.y); } } }
    E += m * dot(s, s); CR += m * (s.x * p.x + s.y * p.y); CI += m * (s.y * p.x - s.x * p.y);
}
//   ONLY THE CELLS THAT CAN BE IN BAND b (2026-10-20): band b is the slice r0 ≤ |q| < r1 of [0, π] (r = b·π/nb), so on row y its cells lie in
//   two x-intervals, |q_x| ∈ [√(r0² − q_y²), √(r1² − q_y²)] — padded by a cell in q and two in x, the wrap (and the tilt) folded in by x mod G,
//   and every cell still passes the exact test above. The row reads ~G²/nb cells per band instead of G (all nb bands: ~G² instead of nb·G²).
//   A window as wide as the row falls back to the whole row.
void main() {
  int b = int(gl_FragCoord.x), y = int(gl_FragCoord.y), G = u_G, qyi = y <= G / 2 ? y : y - G;
  float qy = wrapPi(float(qyi) * 2.0 * PI / float(G) + u_k.y);
  vec4 E = vec4(0.0), CR = vec4(0.0), CI = vec4(0.0), P = vec4(0.0);
  float s2p = float(G) / (2.0 * PI), dq = 1.0 / s2p, r0 = float(b) * PI / float(u_nb) - dq, r1 = (b == u_nb - 1 ? PI : float(b + 1) * PI / float(u_nb)) + dq;
  if (u_full == 1 || abs(qy) <= r1) {
    float a1 = sqrt(max(0.0, r1 * r1 - qy * qy)), a0 = r0 > 0.0 ? sqrt(max(0.0, r0 * r0 - qy * qy)) : 0.0;
    int lo1 = int(floor((-a1 - u_k.x) * s2p)) - 2, hi1 = int(ceil((-a0 - u_k.x) * s2p)) + 2, lo2 = int(floor((a0 - u_k.x) * s2p)) - 2, hi2 = int(ceil((a1 - u_k.x) * s2p)) + 2;
    if (lo2 <= hi1 + 1) { hi1 = hi2; lo2 = 1; hi2 = 0; }   // the two touch: one window
    else hi2 = min(hi2, lo1 + G - 1);   // near |q| = π the windows meet ACROSS the wrap (x ≈ ±G/2 are the same cells): never a cell twice
    if (u_full == 1 || (hi1 - lo1 + 1) + max(0, hi2 - lo2 + 1) >= G) { for (int x = 0; x < G; x++) cell(x, y, qyi, qy, b, G, E, CR, CI, P); }
    else { for (int i = lo1; i <= hi1; i++) cell((i + 4 * G) % G, y, qyi, qy, b, G, E, CR, CI, P);
      for (int i = lo2; i <= hi2; i++) cell((i + 4 * G) % G, y, qyi, qy, b, G, E, CR, CI, P); } }
  oE = E; oCr = CR; oCi = CI; oP = P;
}`;
//   THE EYE's PLATE OP (the ear under the eye): s = (re, cj·im) → phase quantised to qL levels (0 = off) → mixed toward the intensity-only
//   record (|s|, 0) by amix → out = (mr + i·mi)·s + (|ψ| + 1e-4)·(n1 + i·n2). Per cell (mr, mi, n1, n2) from the app's table (_eyeTab):
//   masks (mr 0/1), phase screens (e^{iθ}), mu1's noise fill — the app's CPU twin is the same algebra
const GLSL_EYE_OP = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_src, u_msk;
uniform float u_cj, u_qL, u_amix;
out vec4 fragColor;
const float TAU = 6.283185307179586;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec2 s0 = texelFetch(u_src, c, 0).xy; vec4 m = texelFetch(u_msk, c, 0); float a = length(s0) + 1e-4;
  vec2 s = vec2(s0.x, u_cj * s0.y);
  if (u_qL > 0.0) { float st = TAU / u_qL, th = floor(atan(s.y, s.x) / st + 0.5) * st, r = length(s); s = vec2(r * cos(th), r * sin(th)); }
  if (u_amix > 0.0) s = mix(s, vec2(length(s), 0.0), u_amix);
  fragColor = vec4(m.x * s.x - m.y * s.y + a * m.z, m.x * s.y + m.y * s.x + a * m.w, 0.0, 1.0);
}`;
//   DISK GATHER: texel (u, y0 + v) = modes 2(v·128 + u), +1 of the disk — the mirrored, conjugated spectrum at (2b − q) mod G
const GLSL_GATHER_DISK = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_spec, u_idx;
uniform int u_G, u_M, u_y0, u_direct;
uniform ivec2 u_b2;
out vec4 fragColor;
vec2 rd(vec2 q) { if (u_direct == 1) return texelFetch(u_spec, ivec2((int(q.x) + 2 * u_G) % u_G, (int(q.y) + 2 * u_G) % u_G), 0).xy;   // the field itself (the lock ear)
  ivec2 s = ivec2((u_b2.x - int(q.x) + 2 * u_G) % u_G, (u_b2.y - int(q.y) + 2 * u_G) % u_G); return texelFetch(u_spec, s, 0).xy * vec2(1.0, -1.0); }
void main() {
  int u = int(gl_FragCoord.x), v = int(gl_FragCoord.y) - u_y0, t = (v * 128 + u) * 2;
  vec4 q = texelFetch(u_idx, ivec2(u, v), 0);
  vec2 a = t < u_M ? rd(q.xy) : vec2(0.0), b = t + 1 < u_M ? rd(q.zw) : vec2(0.0);
  fragColor = vec4(a, b);
}`;
//   SECTOR BAND PROBE, pass 2: atlas pixel (x0 + b, r) = Σ over the G rows of target r's column b (r = 0 energy, 1 re, 2 im)
const GLSL_BAND_COL_SEC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_e, u_cr, u_ci, u_p;
uniform int u_G, u_x0, u_ry;
out vec4 fragColor;
void main() {
  int b = int(gl_FragCoord.x) - u_x0, r = int(gl_FragCoord.y) - u_ry; vec4 acc = vec4(0.0);
  for (int y = 0; y < u_G; y++) acc += r == 0 ? texelFetch(u_e, ivec2(b, y), 0) : (r == 1 ? texelFetch(u_cr, ivec2(b, y), 0) : (r == 2 ? texelFetch(u_ci, ivec2(b, y), 0) : texelFetch(u_p, ivec2(b, y), 0)));
  fragColor = acc;
}`;
//   BAND PROBE, pass 2: atlas pixel (x0 + b) = Σ over the G rows of pass 1's column b
const GLSL_BAND_COL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_rows;
uniform int u_G, u_x0;
out vec4 fragColor;
void main() {
  int b = int(gl_FragCoord.x) - u_x0; vec4 acc = vec4(0.0);
  for (int y = 0; y < u_G; y++) acc += texelFetch(u_rows, ivec2(b, y), 0);
  fragColor = acc;
}`;
const GLSL_TILE_PROBE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform int u_G;
uniform int u_B;
uniform ivec2 u_off;
uniform vec2 u_shift, u_k, u_center;   // the display pose (zero = the raw texture)
uniform float u_phi;
out vec4 fragColor;
vec2 torus(vec2 p) {   // bilinear, periodic — renderDescField's sampleTorus
  vec2 f = fract(p); ivec2 i0 = ivec2(floor(p)), G2 = ivec2(u_G), a = ((i0 % G2) + G2) % G2, b = (((i0 + 1) % G2) + G2) % G2;
  return mix(mix(texelFetch(u_psi, a, 0).xy, texelFetch(u_psi, ivec2(b.x, a.y), 0).xy, f.x), mix(texelFetch(u_psi, ivec2(a.x, b.y), 0).xy, texelFetch(u_psi, b, 0).xy, f.x), f.y); }
vec2 posed(vec2 x) { vec2 B = torus(x - u_shift); float th = u_phi + dot(u_k, x - u_center); float c = cos(th), s = sin(th); return vec2(B.x * c - B.y * s, B.x * s + B.y * c); }
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy) - u_off;
  float se = 0.0, sr = 0.0, si = 0.0, sg = 0.0;
  for (int dy = 0; dy < u_B; dy++) for (int dx = 0; dx < u_B; dx++) {
    vec2 c = vec2(t * u_B + ivec2(dx, dy));
    vec2 v  = posed(c);
    vec2 vx = posed(c + vec2(1.0, 0.0)) - v;
    vec2 vy = posed(c + vec2(0.0, 1.0)) - v;
    se += dot(v, v); sr += v.x; si += v.y; sg += dot(vx, vx) + dot(vy, vy);
  }
  float inv = 1.0 / float(u_B * u_B);
  fragColor = vec4(se * inv, sr * inv, si * inv, sg * inv);
}`;

const GLSL_FILM_PEAK = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform int u_srcN;      // source edge length
out vec4 fragColor;
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy) * 2;
  float m = 0.0;
  for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
    ivec2 c = o + ivec2(dx, dy);
    if (c.x < u_srcN && c.y < u_srcN) {
      vec2 v = texelFetch(u_src, c, 0).xy;
      m = max(m, v.x * v.x + v.y * v.y);
    }
  }
  fragColor = vec4(m, 0.0, 0.0, 1.0);
}`;

// PEAK PASSTHROUGH for levels after the first: the source already holds |ψ|² maxima, so take max of .x directly.
const GLSL_PEAK_STEP = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform int u_srcN;
out vec4 fragColor;
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy) * 2;
  float m = 0.0;
  for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
    ivec2 c = o + ivec2(dx, dy);
    if (c.x < u_srcN && c.y < u_srcN) m = max(m, texelFetch(u_src, c, 0).x);
  }
  fragColor = vec4(m, 0.0, 0.0, 1.0);
}`;

const GLSL_COPY = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_plate;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  float v     = texelFetch(u_plate, coord, 0).x;
  fragColor   = vec4(v, 0.0, 0.0, 1.0);
}`;

// Huygens ring convolution with complex phase: psi_new = Σ_d exp(i*k*r_d)/r_d * ring_avg_d(psi)
// Each IFS ring becomes a Huygens wavelet source at radius r_d with phase k*r_d.
// Applied to sweep ping-pong for holographic back-propagation.
const GLSL_STEP_HUYGENS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
uniform sampler2D  u_psi;
uniform isampler2D u_rings;
uniform int        u_G;
uniform int        u_nRings;
uniform int        u_ringCount;
uniform vec4       u_ringMeta[16];  // .x=start .y=n .z=unused
uniform float      u_radii[16];     // ring radii in pixels
uniform float      u_kwave;         // wave number k
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  int G = u_G;
  vec2 acc = vec2(0.0);
  for (int d = 0; d < u_nRings; d++) {
    int   start = int(u_ringMeta[d].x);
    int   n     = int(u_ringMeta[d].y);
    float r     = u_radii[d];
    float ph    = u_kwave * r;
    float cr    = cos(ph) / (r * float(n));
    float ci    = sin(ph) / (r * float(n));
    vec2  rsum  = vec2(0.0);
    for (int i = 0; i < n; i++) {
      ivec2 off = texelFetch(u_rings, ivec2(start + i, 0), 0).xy;
      ivec2 nb  = ivec2((coord.x + off.x + G*4) % G, (coord.y + off.y + G*4) % G);
      rsum += texelFetch(u_psi, nb, 0).xy;
    }
    // complex multiply: (cr + i*ci) * (rsum.x + i*rsum.y)
    acc.x += cr * rsum.x - ci * rsum.y;
    acc.y += cr * rsum.y + ci * rsum.x;
  }
  fragColor = vec4(acc.x, acc.y, 0.0, 1.0);
}`;

// Injection pass: psi += alpha * (obj - psi)  →  mix(psi, obj, alpha)
// Runs after each leapfrog step in RECORD mode. Keeps psi bounded near objField.
const GLSL_STEP_RECORD = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_obj;
uniform float     u_alpha;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  vec2  obj   = texelFetch(u_obj, coord, 0).xy;
  vec2  out_  = psi + u_alpha * (obj - psi);
  fragColor   = vec4(out_.x, out_.y, 0.0, 1.0);
}`;

// Plate as spatial gain landscape: psi += gamma * plate * psi (photorefractive lock-in).
// High-fringe plate regions amplify; low regions decay. Breaks generic IFS attractor.
// Plate as dissipative potential: high-fringe regions survive, low regions decay.
// psi *= (1 - gamma) + gamma * norm  →  selective amplification/suppression by plate.
const GLSL_RECON_CPLX = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_cplx;
uniform sampler2D u_ref;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 c = texelFetch(u_cplx, coord, 0).xy;
  vec2 r = texelFetch(u_ref,  coord, 0).xy;
  vec2 out_ = vec2(c.x*r.x - c.y*r.y, c.x*r.y + c.y*r.x);
  fragColor = vec4(out_.x, out_.y, 0.0, 1.0);
}`;

const GLSL_STEP_PLATE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_plate;
uniform float     u_gamma;
uniform float     u_smoothMaxPlate;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi,   coord, 0).xy;
  float pl    = texelFetch(u_plate, coord, 0).x;
  float norm  = pl / max(u_smoothMaxPlate, 1e-18);  // [0,1]
  float mask  = (1.0 - u_gamma) + u_gamma * norm;   // 1 where plate bright, (1-gamma) where dark
  fragColor   = vec4(psi.x * mask, psi.y * mask, 0.0, 1.0);
}`;

// GS amplitude constraint: replace |psi| with sqrt(plate[j] / smoothMaxPlate) * REF_AMP_SCALE,
// keeping the current phase. This is the plate-plane projection step of Gerchberg-Saxton.
// After forward IFS propagation, this snaps the amplitude to match the recorded hologram,
// then backward propagation brings the constrained field back to the object plane.
const GLSL_PLATE_AMP_CONSTRAINT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_plate;
uniform float     u_smoothMaxPlate;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord  = ivec2(gl_FragCoord.xy);
  vec2  psi    = texelFetch(u_psi,   coord, 0).xy;
  float pl     = texelFetch(u_plate, coord, 0).x;
  float curAmp = length(psi);
  // Target amplitude = sqrt(plate / maxPlate) — matches recorded hologram intensity
  float tgtAmp = sqrt(max(pl, 0.0) / max(u_smoothMaxPlate, 1e-18));
  // Keep phase, replace amplitude (safe fallback to zero-phase if psi ≈ 0)
  vec2  out_ = curAmp > 1e-12 ? (psi / curAmp) * tgtAmp : vec2(tgtAmp, 0.0);
  fragColor  = vec4(out_.x, out_.y, 0.0, 1.0);
}`;

// Hamiltonian plate step: inject toward objField then apply exp(i·γ·plateNorm·2π).
// Combines source injection and plate phase potential in one pass so the plate
// acts as part of the propagator rather than a post-hoc correction.
const GLSL_STEP_RECORD_HAMILTONIAN = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_obj;
uniform sampler2D u_plate;
uniform float     u_alpha;
uniform float     u_gamma;
uniform float     u_smoothMaxPlate;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi,   coord, 0).xy;
  vec2  obj   = texelFetch(u_obj,   coord, 0).xy;
  float pl    = texelFetch(u_plate, coord, 0).x;
  // Source injection: relax toward objField attractor
  vec2  inj   = psi + u_alpha * (obj - psi);
  // Plate Hamiltonian: exp(i·γ·plateNorm·2π) — unitary phase modulation
  float norm  = pl / max(u_smoothMaxPlate, 1e-18);
  float ph    = u_gamma * norm * 6.28318;
  float cr = cos(ph), si = sin(ph);
  fragColor = vec4(cr*inj.x - si*inj.y, si*inj.x + cr*inj.y, 0.0, 1.0);
}`;

// Plate phase kick: psi *= exp(i * gamma * plateNorm * 2π)
// Energy-conserving — only shifts phase, fringe/non-fringe regions accumulate different phases.
// IFS kernel then separates them by frequency — no amplitude drain.
const GLSL_PLATE_PHASE_KICK = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_plate;
uniform float     u_gamma;
uniform float     u_smoothMaxPlate;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi  = texelFetch(u_psi,   coord, 0).xy;
  float pl   = texelFetch(u_plate, coord, 0).x;
  float norm = pl / max(u_smoothMaxPlate, 1e-18);
  float ph   = u_gamma * norm * 6.28318;
  float cr   = cos(ph), si = sin(ph);
  fragColor  = vec4(cr*psi.x - si*psi.y, si*psi.x + cr*psi.y, 0.0, 1.0);
}`;

// Demodulated-field phase kick: psi *= exp(i * gamma * arg(objField))
// Energy-conserving — kicks phase by the object wavefront phase structure.
// objField is the demodulated plate (complex), stored in u_obj (RGBA32F or RG32F).
const GLSL_DEMOD_PHASE_KICK = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_obj;   // demodulated plate field (complex: RG = re,im)
uniform float     u_gamma;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord  = ivec2(gl_FragCoord.xy);
  vec2  psi    = texelFetch(u_psi, coord, 0).xy;
  vec2  obj    = texelFetch(u_obj, coord, 0).xy;
  float objAmp = length(obj);
  // Phase of demodulated field — use as kick angle weighted by local amplitude
  float ph     = objAmp > 1e-12 ? u_gamma * atan(obj.y, obj.x) : 0.0;
  float cr = cos(ph), si = sin(ph);
  fragColor = vec4(cr*psi.x - si*psi.y, si*psi.x + cr*psi.y, 0.0, 1.0);
}`;

// Plate-modulated kernel step on sweep psi:
const GLSL_STEP_PLATE_KERNEL = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
uniform sampler2D  u_psi;
uniform sampler2D  u_plate;
uniform isampler2D u_rings;
uniform int        u_G;
uniform int        u_nRings;
uniform int        u_ringCount;
uniform vec4       u_ringMeta[16];
uniform float      u_radii[16];
uniform float      u_kwave;
uniform float      u_smoothMaxPlate;
uniform float      u_alpha;  // plate modulation strength [0..1]
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  int G = u_G;
  vec2 psi = texelFetch(u_psi, coord, 0).xy;
  // Standard IFS ring accumulator (same as stepSweep)
  vec2 acc = vec2(0.0);
  float totalW = 0.0;
  for (int d = 0; d < u_nRings; d++) {
    int   start = int(u_ringMeta[d].x);
    int   n     = int(u_ringMeta[d].y);
    float r     = u_radii[d];
    float ph    = u_kwave * r;
    float cr    = cos(ph); float si = sin(ph);
    vec2  psiSum   = vec2(0.0);
    float plateSum = 0.0;
    for (int i = 0; i < n; i++) {
      ivec2 off = texelFetch(u_rings, ivec2(start + i, 0), 0).xy;
      ivec2 nb  = ivec2((coord.x + off.x + G*4) % G, (coord.y + off.y + G*4) % G);
      psiSum   += texelFetch(u_psi,   nb, 0).xy;
      plateSum += texelFetch(u_plate, nb, 0).x;
    }
    vec2  psiAvg   = psiSum / float(n);
    // plate weight centered at 1: low-fringe → slightly below 1, high-fringe → slightly above 1
    float plateW   = 1.0 + u_alpha * ((plateSum / float(n)) / max(u_smoothMaxPlate, 1e-18) - 0.5);
    acc   += vec2(cr * psiAvg.x - si * psiAvg.y, cr * psiAvg.y + si * psiAvg.x) * plateW;
    totalW += plateW;
  }
  // Normalize by totalW so energy is conserved regardless of plate content
  vec2 out_ = float(u_nRings) > 0.0 ? acc / totalW * float(u_nRings) : psi;
  fragColor = vec4(out_.x, out_.y, 0.0, 1.0);
}`;

const GLSL_ADD_SOURCES = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_src;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, coord, 0).xy;
  vec2 src = texelFetch(u_src, coord, 0).xy;
  fragColor = vec4(psi.x + src.x, psi.y + src.y, 0.0, 1.0);
}`;

// Shared hologram colormap function — matches JS colormaps.hologram(v)
// v in [0,1]: b = min(1, v*2), g = clamp(v*3-1, 0,1), r = clamp(v*4-3, 0,1)
const GLSL_HOLOGRAM_COLORMAP = /* glsl */`
vec3 hologramColor(float v) {
  float b = clamp(v * 2.0, 0.0, 1.0);
  float g = clamp(v * 3.0 - 1.0, 0.0, 1.0);
  float r = clamp(v * 4.0 - 3.0, 0.0, 1.0);
  return vec3(r, g, b);
}`;

// ── WAVELET RECOGNITION (§7.38) on the GPU — the pure-JS waveletRecognizePure ported to a fragment shader.
// Each fragment (cell) samples its ring BANDS × angular SECTORS from the scene (u_scene.R = intensity),
// builds the local (depth×sectors) descriptor, cosine-matches it to the reference descriptor (u_refDesc
// uniform array), and writes (match, dominantScale). One parallel pass over the whole field — replaces the
// per-cell JS loops. u_bandR = ring radii (up to 8 bands), u_nBands, u_nSectors, u_refR (glyph radius).
const GLSL_WAVELET_RECOG = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_scene;     // RG32F; .r = scene intensity (real)
uniform int   u_G;
uniform int   u_nBands;
uniform int   u_nSectors;      // S
uniform float u_bandR[8];      // ring radii per band
uniform float u_refDesc[96];   // reference descriptor, nBands*nSectors (≤64), L2 baked in via u_refNorm
uniform float u_refNorm;       // ||refDesc||
uniform float u_refR;          // reference glyph radius (for size normalization)
uniform float u_sharpPow;      // cosine-match sharpening exponent (higher = stricter discrimination)
uniform float u_energyGate;    // presence gate: full match once boundary ink·gate ≥ 1 (higher = more sensitive)
uniform float u_disDesc[96];   // DISTRACTOR descriptor (subtracted to cancel distractor-likeness)
uniform float u_disNorm;       // ||disDesc||
uniform float u_disWeight;     // λ: how much distractor-similarity to subtract (0 = off, ~1 = full)
out vec4 fragColor;
const float TWO_PI = 6.2831853;
float sceneAt(int x, int y) {
  int G = u_G;
  return texelFetch(u_scene, ivec2((x%G+G)%G, (y%G+G)%G), 0).r;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  // build the local angular-cascade descriptor: per band, sample the ring at many angles, bin |v|² to sectors.
  float desc[96];
  for (int i=0;i<96;i++) desc[i]=0.0;
  float energy = 0.0;
  for (int k=0;k<u_nBands;k++) {
    float r = u_bandR[k];
    int steps = int(max(float(u_nSectors)*3.0, ceil(TWO_PI*r)));
    for (int s=0;s<512;s++) {        // bounded loop; break at steps
      if (s>=steps) break;
      float ang = TWO_PI*float(s)/float(steps);
      int X = c.x + int(floor(r*cos(ang)+0.5));
      int Y = c.y + int(floor(r*sin(ang)+0.5));
      float v = sceneAt(X, Y);
      int sec = int(floor((ang/TWO_PI)*float(u_nSectors)));
      sec = sec - (sec/u_nSectors)*u_nSectors;      // mod S
      desc[k*u_nSectors + sec] += v*v;
      energy += v*v;
    }
  }
  if (energy < 1e-7) { fragColor = vec4(0.0,1.0,0.0,1.0); return; }
  // cosine similarity with the TARGET descriptor AND the DISTRACTOR descriptor.
  float dot=0.0, sn=0.0, dotD=0.0;
  int D = u_nBands*u_nSectors;
  for (int i=0;i<96;i++) { if (i>=D) break; dot += desc[i]*u_refDesc[i]; dotD += desc[i]*u_disDesc[i]; sn += desc[i]*desc[i]; }
  float nrm = sqrt(max(1e-12,sn));
  float cosv  = dot  / (nrm*max(1e-12,u_refNorm));
  float cosD  = dotD / (nrm*max(1e-12,u_disNorm));
  // DISCRIMINATIVE match: subtract distractor-likeness. A circle scores high on BOTH cos(triangle) and
  // cos(circle), so cosv − λ·cosD cancels it; a triangle scores high on cosv, low on cosD → survives.
  // relu so non-target cells go to 0, then sharpen. λ = u_disWeight.
  float discr = max(0.0, cosv - u_disWeight * cosD);
  float sharp = pow(clamp(discr, 0.0, 1.0), u_sharpPow);
  // energy only GATES (presence floor), it does NOT scale the match — scaling by energy biased toward the
  // densest shape (filled circles won). A soft gate: full match once there's enough boundary ink present.
  float gate = clamp(energy * u_energyGate, 0.0, 1.0);
  float match = sharp * gate;
  // dominant band → detected size (multiple of ref radius)
  int domB=0; float domE=-1.0;
  for (int k=0;k<u_nBands;k++){ float e=0.0; for (int s=0;s<32;s++){ if(s>=u_nSectors) break; e+=desc[k*u_nSectors+s]; } if(e>domE){domE=e;domB=k;} }
  float size = u_bandR[domB] / max(1e-6, u_refR);
  fragColor = vec4(match, size, 0.0, 1.0);
}`;

// ── OPERATOR LIMIT-CYCLE shaders (§7.43). The operator binds two real fields a,b via rank-1 terms
//    out += W_r · (U_r·a)(V_r·b). Two field-scale primitives done on the GPU:
//    (1) GLSL_DOT_ROWS — partial dot product: output texel (0,y) = Σ_x texA(x,y)·texB(x,y) (one row).
//        A second JS pass sums the G row-sums → the scalar dot (G≈128 row-sums = exact, no float-tree drift).
//    (2) GLSL_SCATTER_MAD — accumulation: acc += u_scale · W(texel). Multiply-add a weighted field into the
//        persistent accumulation texture (the bound output building up over the bar). u_reset clears it first.
const GLSL_DOT_ROWS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform int u_G;
out vec4 fragColor;
void main() {
  int y = int(gl_FragCoord.y);
  float s = 0.0;
  for (int x = 0; x < u_G; x++) {
    ivec2 c = ivec2(x, y);
    s += texelFetch(u_a, c, 0).x * texelFetch(u_b, c, 0).x;   // real-channel dot, this row
  }
  fragColor = vec4(s, 0.0, 0.0, 1.0);
}`;

// ENERGY row-reduce: per row y, sum |ψ|² = re²+im² across x (DOT_ROWS sums only the real channel — energy needs both). Pairs with GLSL_COL_FINISH.
const GLSL_ENERGY_ROWS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_a;
uniform int u_G;
out vec4 fragColor;
void main() {
  int y = int(gl_FragCoord.y);
  float s = 0.0;
  for (int x = 0; x < u_G; x++) { vec2 p = texelFetch(u_a, ivec2(x,y), 0).xy; s += p.x*p.x + p.y*p.y; }
  fragColor = vec4(s, 0.0, 0.0, 1.0);
}`;

const GLSL_SCATTER_MAD = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_acc;     // current accumulation (R = value)
uniform sampler2D u_w;       // the W_r field to add (R = value)
uniform float u_scale;       // (U_r·a)(V_r·b) scalar for this rank
uniform float u_reset;       // 1.0 = start fresh (ignore u_acc), 0.0 = accumulate
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  float prev = u_reset > 0.5 ? 0.0 : texelFetch(u_acc, coord, 0).x;
  float w    = texelFetch(u_w, coord, 0).x;
  fragColor  = vec4(prev + u_scale * w, 0.0, 0.0, 1.0);
}`;

// ── §7.58 GPU-RESIDENT SCALAR PIPE (bootstrap step 1) — the two shaders that close the JS scalar bus.
//    (3) GLSL_COL_FINISH — completes the dot ON the GPU: sums the G row-sums (column 0 of the dot-rows
//        texture) into ONE 1×1 texel. The old JS finish summed the same G values in a fixed JS-loop order;
//        this sums them in a fixed shader-loop order — same serial-sum class, deterministic per device.
//    (4) GLSL_SCATTER_MAD_TEX — scatter-MAD with the scale SAMPLED from two 1×1 scalar textures:
//        acc += (U_r·a)(V_r·b)·W, the product formed in-shader. Per tick JS only issues draw calls;
//        no scalar crosses to the CPU anywhere in the data path.
const GLSL_COL_FINISH = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_rows;    // dot-rows output: texel (0,y) = row y's partial dot
uniform int u_G;
out vec4 fragColor;
void main() {
  float s = 0.0;
  for (int y = 0; y < u_G; y++) s += texelFetch(u_rows, ivec2(0, y), 0).x;
  fragColor = vec4(s, 0.0, 0.0, 1.0);
}`;

const GLSL_SCATTER_MAD_TEX = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_acc;     // current accumulation (R = value)
uniform sampler2D u_w;       // the W_r field to add (R = value)
uniform sampler2D u_sA;      // 1×1 scalar: (U_r·a)
uniform sampler2D u_sB;      // 1×1 scalar: (V_r·b)
uniform float u_reset;       // 1.0 = start fresh, 0.0 = accumulate
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  float prev  = u_reset > 0.5 ? 0.0 : texelFetch(u_acc, coord, 0).x;
  float scale = texelFetch(u_sA, ivec2(0,0), 0).x * texelFetch(u_sB, ivec2(0,0), 0).x;
  fragColor   = vec4(prev + scale * texelFetch(u_w, coord, 0).x, 0.0, 0.0, 1.0);
}`;

// ── §7.58b RANK ATLAS (bootstrap step 1, completed): the operator's GENOTYPE — all K ranks' U keys, the
//    K bar-input keys a(bar mod K), and the K output carriers W_r — preloaded ONCE into 2D-ARRAY textures.
//    The live rank AND the live bar-key are selected IN-SHADER from a single u_cyc integer (rank = cyc % K,
//    key layer = (cyc/nBins) % K), and the accumulation reset (rank 0 = bar start) is computed in-shader
//    too — selection is no longer a JS act at all. Per tick, JS uploads only the live b-arm field and
//    issues 4 draws with one integer uniform: a fixed, content-blind render graph driven by the clock.
//    This is the substrate for bootstrap step 3: once selection is in-shader, a DECISION texture can
//    replace the clock uniform as the selector — field-gated branching with no JS in the loop.
// ── §7.60 NONLINEAR DECISION KICK (bootstrap step 2): the medium's "transistor". A UNITARY, intensity-
//    thresholded phase rotation ψ *= exp(i·γ·smoothstep(I_th, I_th+w, |ψ|²)) — phase-only (energy
//    conserving, same family as GLSL_PLATE_PHASE_KICK) but SELECTIVE: only content whose local intensity
//    crosses I_th acquires phase. Below threshold the medium stays exactly LINEAR (the wire — preserving
//    every §7.32–7.45 exactness result); above it, bright structures mark THEMSELVES (the transistor).
//    NEVER applied globally: confined to the dedicated NONLINEAR PHASE at the bar boundary (temporal-mux
//    of the PHYSICS itself — linear phases for transport/binding, one nonlinear instant for decisions).
//    The smoothstep width w is the analog band the level-restorer must out-margin (§7.59).
// ── §7.62 FIELD-SELECTED EMISSION (bootstrap step 3 proper): the DECISION texture replaces the clock as
//    the program selector. Sensing is unchanged (every rank's verdict still lands in the match row each
//    bar), but the EMITTED output carrier W is chosen by the field's previous-bar decision — sampled
//    in-shader from u_decision — and the whole emission is GATED by its fired bit: a vetoed bar emits
//    NOTHING (not dimmed — off). The loop closes: medium verdict → decision texture → program selection →
//    medium. JS carries time and the audit log; the choice itself never touches it.
const GLSL_SCATTER_MAD_DECIDED = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D u_acc;
uniform sampler2DArray u_atlasW;
uniform sampler2D u_sA;          // 1×1: this tick's (U_r·a) — sensing scalar
uniform sampler2D u_sB;          // 1×1: this tick's (V·b)
uniform sampler2D u_decision;    // 1×1: (winner, scalar, fired) — the FIELD's previous-bar verdict
uniform int u_cyc;
uniform int u_K;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  int r = u_cyc % u_K;
  float prev = (r == 0) ? 0.0 : texelFetch(u_acc, coord, 0).x;
  vec3 dec   = texelFetch(u_decision, ivec2(0,0), 0).xyz;
  int  wSel  = int(dec.x + 0.5);                                  // the program the FIELD chose
  float scale = dec.z * texelFetch(u_sA, ivec2(0,0), 0).x * texelFetch(u_sB, ivec2(0,0), 0).x;   // gated by fired
  fragColor = vec4(prev + scale * texelFetch(u_atlasW, ivec3(coord, wSel), 0).x, 0.0, 0.0, 1.0);
}`;

const GLSL_NL_KICK = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_gamma;   // phase depth (radians at full activation)
uniform float u_th;      // intensity threshold I_th
uniform float u_w;       // activation band width
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, coord, 0).xy;
  float I  = psi.x*psi.x + psi.y*psi.y;
  float ph = u_gamma * smoothstep(u_th, u_th + u_w, I);
  float c = cos(ph), s = sin(ph);
  fragColor = vec4(c*psi.x - s*psi.y, s*psi.x + c*psi.y, 0.0, 1.0);
}`;

// SELF-FOCUS (the missing momentum-conserving localizer): amplitude SATURATION |ψ|→tanh(s·|ψ|)/s, phase UNCHANGED. A cubic-NLS-like
// confinement WITHOUT a positional target — it concentrates energy toward the saturation level (low amp boosted, high amp capped) so a
// soliton stays localized as a stable PARTICLE, but its PHASE GRADIENT (momentum) is preserved (we only rescale magnitude). This is the
// piece the medium lacked: stepRecord's only localizer was the amplitude-BLEND toward a static target (which deletes momentum). Self-focus
// confines with NO target → a momentum kick survives → the soliton can be thrown across a barrier. u_gain = saturation steepness s.
const GLSL_SELF_FOCUS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_th;     // intensity threshold (peak above it GAINS, background below DECAYS)
uniform float u_gp;     // gain above threshold (per pass)
uniform float u_lo;     // loss below threshold (per pass)
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, coord, 0).xy;
  float I = psi.x*psi.x + psi.y*psi.y;
  // GAIN-ABOVE-THRESHOLD self-focus (probe_selffocus_form: tanh FLATTENS, cubic RUNS AWAY, this STAYS stable): high-I peak grows, low-I
  // background decays → energy migrates to the peak = CONFINEMENT, no flatten/no collapse. MAGNITUDE only (phase kept) → momentum preserved.
  float g = I > u_th ? (1.0 + u_gp) : (1.0 - u_lo);
  fragColor = vec4(psi.x * g, psi.y * g, 0.0, 1.0);
}`;

// CGL — the COMPLEX GINZBURG-LANDAU dissipative-soliton balance (probe_cgl_soliton.mjs: a genuine ATTRACTING fixed point, E plateaus,
// no blowup/drain). ψ *= exp((−δ + ε|ψ|² − μ|ψ|⁴)·dt): LINEAR LOSS −δ kills radiation (clean background); CUBIC GAIN +ε|ψ|² feeds the
// soliton core; QUINTIC LOSS −μ|ψ|⁴ caps it (sets a self-selected stable amplitude — can't blow up). Cubic-only blows up, linear-only
// drains; ALL THREE balanced = a real interior dissipative soliton (no boundary needed). Magnitude only (phase kept → momentum preserved).
const GLSL_CGL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_delta;   // linear loss δ (kills radiation)
uniform float u_eps;     // cubic gain ε (feeds the soliton)
uniform float u_mu;      // quintic loss μ (saturates → stable amplitude, no blowup)
uniform float u_dt;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float a2 = psi.x*psi.x + psi.y*psi.y;
  float g = exp((-u_delta + u_eps*a2 - u_mu*a2*a2) * u_dt);
  fragColor = vec4(psi.x * g, psi.y * g, 0.0, 1.0);
}`;

// IFS-NATIVE LOW-PASS CONTRACTION — the charge-conserving piece (probe_gpe_native.mjs). A topological winding IS conserved in the
// continuum, but a discrete propagator NUCLEATES spurious vortex-antivortex pairs at the GRID SCALE (high-k) that pollute the charge
// (bare ring-Laplacian: a clean Q=1 drifts to Q=−11 by t100). The IFS contraction is NATIVELY LOW-PASS (a smoothing/averaging round-trip);
// applying it SUPPRESSES those high-k spurious pairs while leaving the smooth large-scale winding intact → Q=1.00 stays clean to t100
// across all radii (β=0.3 validated; the full native GPE = this + density-contract also holds). A 3×3 blend: ψ→(1−β)ψ + β·mean(3×3).
// COMPLEX (re+im together) so the phase winding is smoothed coherently (not the amplitude alone). β = smoothing weight (0=off).
const GLSL_LOWPASS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_beta;   // smoothing weight (0..1); 0.3 validated charge-conserving
uniform float u_G;      // grid size
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int G = int(u_G);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  vec2 sum = vec2(0.0); float cnt = 0.0;
  for (int dy=-1; dy<=1; dy++) for (int dx=-1; dx<=1; dx++) {
    ivec2 p = c + ivec2(dx,dy);
    if (p.x<0 || p.x>=G || p.y<0 || p.y>=G) continue;
    sum += texelFetch(u_psi, p, 0).xy; cnt += 1.0;
  }
  vec2 mean = cnt>0.0 ? sum/cnt : psi;
  fragColor = vec4(mix(psi, mean, u_beta), 0.0, 1.0);
}`;

// EYE SUPERPOSE — ψ_eye += β·obj (complex add of the operator-attractor texture into the eye). The interference-coevolve step of transport/objorbit,
// on the GPU (was a CPU readback + JS loop + upload per step). u_obj = the regenerated object (uploaded once/frame via setObjField).
const GLSL_EYE_SUPERPOSE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_obj;
uniform float u_beta;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  vec2 obj = texelFetch(u_obj, c, 0).xy;
  fragColor = vec4(psi + u_beta*obj, 0.0, 1.0);
}`;

// SPECTRAL SPRING blend — ĥat ← ĥat + k·(âhat − ĥat), applied per MODE (in momentum space), on ONE real-FFT
// field (the two-field spectral propagator keeps Re and Im FFT'd separately, so this runs once per field with the
// matching att-spectrum field). Faithful to the CPU spring (medium-core spring: ψ̂ += kEff·(ât−ψ̂)); a soft,
// frequency-selective pull toward the att's spectrum — gentler than the additive real-space superpose.
const GLSL_FFT_SPRING = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_hat;   // the current spectral field (R̂ or Î)
uniform sampler2D u_ahat;  // the att's matching spectral field (Âr or Âi)
uniform float u_k;         // spring stiffness kEff
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 h  = texelFetch(u_hat,  c, 0).xy;
  vec2 ah = texelFetch(u_ahat, c, 0).xy;
  fragColor = vec4(h + u_k*(ah - h), 0.0, 1.0);
}`;

// EYE CONTRACT — ψ ← (1−λ)·ψ + λ·obj, a CONTRACTION toward the operator (full-authority hold). Unlike superpose
// (ψ += β·obj, additive → the previous field's GPU-float deviation survives forever), this SHRINKS |ψ−obj| by
// factor (1−λ) each application → cross-GPU float spread on the unpinned halo decays geometrically, the same
// re-locking that keeps the driven W peer-deterministic. λ=1 ⇒ exact projection onto obj (byte = obj's bytes).
const GLSL_EYE_CONTRACT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_obj;
uniform float u_lambda;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  vec2 obj = texelFetch(u_obj, c, 0).xy;
  fragColor = vec4(mix(psi, obj, u_lambda), 0.0, 1.0);
}`;

// EYE SCALE — ψ *= s, a uniform real scale (the energy-cap, given the precomputed factor s=sqrt(E0/E)). Pairs with the GPU energy sum (opDot machinery).
// the NO-SYNC energy-cap scale: reads the 1×1 reduce result AS A TEXTURE and computes s = √(target/E)
// in-shader — no readPixels, no pipeline stall (the profiled 57%-of-frame readback under turbo). Semantics
// identical to the sync path: full normalization, both directions.
const GLSL_EYE_CAP_SCALE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_e;
uniform float u_target;
out vec4 fragColor;
void main() { float E = texelFetch(u_e, ivec2(0,0), 0).x;
  float s = (E > 1e-9 && u_target > 0.0) ? sqrt(u_target / E) : 1.0;
  ivec2 c = ivec2(gl_FragCoord.xy); fragColor = vec4(texelFetch(u_psi, c, 0).xy * s, 0.0, 1.0); }`;

// GROUP SPM — the saturable SPM of GLSL_NL_SPM with the intensity taken over the GROUP density (u_nd = 1 or 2 inputs):
//   I = |d0|² (+ |d1|²),  ψ ← ψ·e^{−i·γ·dt·I/(1+I/Isat)}. One common phase per cell for every member ⇒ it commutes
//   with the pair's SU(2) / the body's SE(3) right action (both preserve I). u_nd = 1 with d0 = ψ is GLSL_NL_SPM exactly.
const GLSL_GROUP_SPM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_d0;
uniform sampler2D u_d1;
uniform int u_nd;
uniform float u_gamma;
uniform float u_isat;
uniform float u_dt;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  vec2 a = texelFetch(u_d0, c, 0).xy;
  float I = a.x*a.x + a.y*a.y;
  if (u_nd > 1) { vec2 b = texelFetch(u_d1, c, 0).xy; I += b.x*b.x + b.y*b.y; }
  float g  = u_gamma * I / (1.0 + I / u_isat);
  float ph = -g * u_dt;
  float cs = cos(ph), sn = sin(ph);
  fragColor = vec4(cs*psi.x - sn*psi.y, sn*psi.x + cs*psi.y, 0.0, 1.0);
}`;

// GROUP CAP — ONE scale s = √(target / (E_a (+ E_b))) for every member, E read from the 1×1 reduce textures (no
//   readback). A common scale preserves every member ratio, so the pair's spin direction / the body's translation
//   b = 2ψ_r⁻¹ψ_d are untouched by it. u_nd = 1 is GLSL_EYE_CAP_SCALE exactly.
const GLSL_GROUP_CAP = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_ea;
uniform sampler2D u_eb;
uniform int u_nd;
uniform float u_target;
out vec4 fragColor;
void main() {
  float E = texelFetch(u_ea, ivec2(0,0), 0).x;
  if (u_nd > 1) E += texelFetch(u_eb, ivec2(0,0), 0).x;
  float s = (E > 1e-9 && u_target > 0.0) ? sqrt(u_target / E) : 1.0;
  ivec2 c = ivec2(gl_FragCoord.xy); fragColor = vec4(texelFetch(u_psi, c, 0).xy * s, 0.0, 1.0); }`;

const GLSL_EYE_SCALE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_s;
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); fragColor = vec4(texelFetch(u_psi, c, 0).xy * u_s, 0.0, 1.0); }`;

// ── GLSL_EYE_PHASE_TILT — global precession ω + momentum tilt k·x, in ONE per-pixel phase multiply. ──
//    Mirrors mixedRadix-app stepField's precess + tilt: ψ ← ψ·e^{i·(u_om + u_kx·(x−c0) + u_ky·(y−c0))},
//    c0 = (G−1)/2. Both are pure phase (amplitude-invariant), but they matter: the field precessing between
//    steps means the REAL injected att adds at a rotating relative phase → the beat/interference that shapes
//    the turbulence (without it the lock is static/smooth — the "looks like leapfrog" symptom).
const GLSL_EYE_PHASE_TILT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_om;   // global precession angle this step (omEff)
uniform float u_kx;   // momentum tilt kxE
uniform float u_ky;   // momentum tilt kyE
uniform float u_c0;   // (G−1)/2 centering
uniform float u_m;    // harmonic (1 = the original single hill/valley across the torus)
uniform vec2 u_cc;    // the potential's centre (x, y) — (c0, c0) by default
uniform float u_trap; // 0 = tilt S = sin(w(u−c))/w · 1 = trap Q = (1−cos(w(u−c)))/w² (≈ ½(u−c)²)
uniform float u_g;    // gain: the potential is (1 + i·g)·θ → amp·e^{−g·θ} (declared non-Hermitian drive)
uniform float u_well; // a static isotropic well beside the k part: phase u_well·(Qx + Qy), Q = −(1−cos(w·d))/w² (Hermitian, no gain)
uniform sampler2D u_pot; // trap 3: a sampled profile S(x, y) (the app's IFS-native kernel well) — the k part is u_kx·S
uniform float u_kern;    // the STATIC native well beside any shape: phase u_kern·S (Hermitian, no gain)
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  // PERIODIC TILT POTENTIAL (2026-09-23): S(u) = (G/2π)·sin(2π(u−c0)/G) — equal to (u−c0) near the centre (within 1%
  //   over ±G/10) and periodic on the torus. A linear ramp k·(u−c0) is a potential V = −F·x, which a torus cannot
  //   hold: it jumped by k·G across the edge (a phase SEAM every sub-step). Same force where the symbol sits, no seam.
  float Gf = 2.0 * u_c0 + 1.0, w = 6.283185307179586 * max(1.0, u_m) / Gf;
  float dx = float(c.x) - u_cc.x, dy = float(c.y) - u_cc.y;
  float Qx = -(1.0 - cos(w * dx)) / (w * w), Qy = -(1.0 - cos(w * dy)) / (w * w);   // trap: −Q so k > 0 is a WELL (V = −k·S; see the CPU _potProfile)
  float Sx = (u_trap > 1.5) ? dx : ((u_trap > 0.5) ? Qx : sin(w * dx) / w);   // 2 = linear (the ⇥roll kick; periodic only for an integer lattice k)
  float Sy = (u_trap > 1.5) ? dy : ((u_trap > 0.5) ? Qy : sin(w * dy) / w);
  float tk = (u_trap > 2.5) ? u_kx * texelFetch(u_pot, c, 0).r : u_kx * Sx + u_ky * Sy, th = u_om + tk + u_well * (Qx + Qy) + (u_kern != 0.0 ? u_kern * texelFetch(u_pot, c, 0).r : 0.0), am = exp(-u_g * tk);
  float cs = cos(th) * am, sn = sin(th) * am;
  fragColor = vec4(cs*psi.x - sn*psi.y, sn*psi.x + cs*psi.y, 0.0, 1.0);
}`;

// IFS-NATIVE GPE — saturable DENSITY-DEPENDENT CONTRACTION ψ→ψ/(1+γ|ψ|²). The |ψ|²ψ Gross-Pitaevskii term expressed AS the medium's own
// contraction biased by intensity (NOT a grafted explicit exp(−iγ|ψ|²dt) phase kick — probe_native_gpe_charge.mjs measured that the PHASE
// form DESTABILIZES the vortex/scatters Q = the §7.100c foreign-graft trap, while THIS density-contraction CONSERVES the full multi-charge:
// Qtot=4 stable to t60, no annihilation, with low-pass). Amplitude-only (phase kept → winding untouched); the saturable 1/(1+γ|ψ|²) carves
// & holds the vortex core node from the dynamics (a healing length). γ=0.5 validated (γ=2 over-contracts → spurious cores). Rides the round-trip.
const GLSL_DENS_CONTRACT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_gamma;   // GPE interaction strength (0.5 validated charge-conserving; higher over-contracts)
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float a2 = psi.x*psi.x + psi.y*psi.y;
  float sc = 1.0 / (1.0 + u_gamma * a2);   // saturable density-dependent contraction (amplitude only → phase/winding preserved)
  fragColor = vec4(psi.x * sc, psi.y * sc, 0.0, 1.0);
}`;

// ── §7.82 LEAVE THE LINEAR/UNITARY LIMIT — the two passes that host the attractor-genome (§7.80/§7.81).
//    The live medium runs LINEAR (GAMMA=0) + CONSERVATIVE (unitary leapfrog). §7.80/§7.81 proved the
//    attractor-genome (a clock-mode-locked limit cycle whose rational rotation number is the heritable symbol)
//    needs BOTH: (a) nonlinearity to create Arnold tongues, (b) dissipation to make them peer-deterministic.
//    These are the two GPU passes; each ping-pongs the eye field exactly like applyEyeNlKick.
//
//  (a) GLSL_NL_SPM — the real _nlHalf: saturable self-phase modulation ψ → ψ·exp(−i·g·dt), g = γ·|ψ|²/(1+|ψ|²/Isat).
//      UNITARY (phase only, conserves |ψ| per cell). γ=0 ⇒ identity = the live linear medium. Makes the tongues.
const GLSL_NL_SPM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_gamma;   // SPM strength γ
uniform float u_isat;    // saturation intensity Isat
uniform float u_dt;      // step (this is a HALF step in the Strang split; caller passes dt/2 or dt as needed)
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float a2 = psi.x*psi.x + psi.y*psi.y;
  float g  = u_gamma * a2 / (1.0 + a2 / u_isat);
  float ph = -g * u_dt;
  float cs = cos(ph), sn = sin(ph);
  fragColor = vec4(cs*psi.x - sn*psi.y, sn*psi.x + cs*psi.y, 0.0, 1.0);
}`;

//  NONLOCAL KERR passes (see applyEyeNlSpmNonlocal): the intensity, a spectrum × a real symbol, and the phase by V (the same sign and
//  saturation as GLSL_NL_SPM, with the local |ψ|² replaced by V = K ⋆ |ψ|²).
const GLSL_NL_INTENS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
out vec4 fragColor;
void main() { vec2 p = texelFetch(u_psi, ivec2(gl_FragCoord.xy), 0).xy; fragColor = vec4(p.x*p.x + p.y*p.y, 0.0, 0.0, 1.0); }`;
const GLSL_CONJ = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
out vec4 fragColor;
void main() { vec2 v = texelFetch(u_psi, ivec2(gl_FragCoord.xy), 0).xy; fragColor = vec4(v.x, -v.y, 0.0, 1.0); }`;
const GLSL_LIVE_COPY = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
out vec4 fragColor;
void main() { fragColor = vec4(texelFetch(u_psi, ivec2(gl_FragCoord.xy), 0).xy, 0.0, 1.0); }`;
//  ✺ the live hologram's update (liveStep): I = −Im(conj(R·e^{iΦ})·g), V ← V + rate·(eta·I − V)
const GLSL_LIVE_UPD = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_g;
uniform sampler2D u_r;
uniform sampler2D u_v;
uniform float u_c;
uniform float u_s;
uniform float u_rate;
uniform float u_eta;
out vec4 fragColor;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 g = texelFetch(u_g, q, 0).xy, r = texelFetch(u_r, q, 0).xy; float v = texelFetch(u_v, q, 0).x;
  float rr = r.x * u_c - r.y * u_s, ri = r.x * u_s + r.y * u_c, I = -(rr * g.y - ri * g.x);
  fragColor = vec4(v + u_rate * (u_eta * I - v), 0.0, 0.0, 1.0); }`;
//  ⇋ DS-II: the exact spectral phase ψ̂·e^{+iλdt} (λ a real table) · the mean-field phase ψ·e^{+iγVdt} (V signed, unsaturated)
const GLSL_DS_LIN = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_lam;
uniform float u_dt;
out vec4 fragColor;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy; float ph = texelFetch(u_lam, q, 0).x * u_dt, cs = cos(ph), sn = sin(ph);
  fragColor = vec4(cs * v.x - sn * v.y, sn * v.x + cs * v.y, 0.0, 1.0); }`;
const GLSL_DS_NL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_v;
uniform float u_gamma;
uniform float u_dt;
out vec4 fragColor;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, q, 0).xy; float ph = u_gamma * texelFetch(u_v, q, 0).x * u_dt, cs = cos(ph), sn = sin(ph);
  fragColor = vec4(cs * v.x - sn * v.y, sn * v.x + cs * v.y, 0.0, 1.0); }`;
const GLSL_MUL_K = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_k;
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, c, 0).xy; float k = texelFetch(u_k, c, 0).x; fragColor = vec4(v * k, 0.0, 1.0); }`;
const GLSL_NL_SPM_V = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_v;
uniform float u_gamma;
uniform float u_isat;
uniform float u_dt;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float V = max(0.0, texelFetch(u_v, c, 0).x);
  float g = u_gamma * V / (1.0 + V / u_isat);
  float ph = -g * u_dt, cs = cos(ph), sn = sin(ph);
  fragColor = vec4(cs*psi.x - sn*psi.y, sn*psi.x + cs*psi.y, 0.0, 1.0);
}`;

const XQ_BITS = 24;   // the exact state's quantum q = 2^-24: |ψ| < 128 in int32
//  ◇EXACT GPU STEP passes (see xsStep): integer state ivec4 (A re, A im, B re, B im) in quanta q = 2^-XQ_BITS. XQ(v) = the nearest integer, taken
//  ONCE per increment; the sign u_s only multiplies that integer, so a pass and its inverse share every float they compute.
const GLSL_X_HEAD = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
const float XQ_Q = ${(2 ** -XQ_BITS).toExponential(17)};   // 2^-XQ_BITS
int XQ(float v) { return int(floor(v + 0.5)); }`;
//  the leapfrog shear: comp 0 → re += s·XQ(c·L(im)), comp 1 → im += s·XQ(c·L(re)), both copies; L = the turbo's ring stencil (ringLap) in quanta
const GLSL_X_SHEAR = /* glsl */`${GLSL_X_HEAD}
uniform isampler2D u_x;
uniform isampler2D u_rings;
uniform int u_G;
uniform int u_nRings;
uniform vec4 u_ringMeta[16];
uniform int u_comp;
uniform float u_c;
uniform int u_s;
uniform vec3 u_nh;   // the declared non-Hermitian part (setNh): a = κ/m, n̂ — offset o weighs 1 + a·n̂·sin(2π·o/G) (0: the symmetric ring, unchanged)
out ivec4 o;
float nhW(ivec2 o, int G) { return u_nh.x == 0.0 ? 1.0 : 1.0 + u_nh.x * (u_nh.y * sin(6.283185307179586 * float(o.x) / float(G)) + u_nh.z * sin(6.283185307179586 * float(o.y) / float(G))); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); int G = u_G, M = G - 1;
  ivec4 v = texelFetch(u_x, c, 0);
  int ka = u_comp == 0 ? 1 : 0, kb = ka + 2;   // the component the Laplacian reads (the other quadrature), both copies
  vec2 ctr = vec2(float(v[ka]), float(v[kb]));
  vec2 ortho = vec2(0.0), diag = vec2(0.0);
  ivec4 t;
  t = texelFetch(u_x, ivec2((c.x + 1) & M, c.y), 0); ortho += nhW(ivec2(1, 0), G) * vec2(float(t[ka]), float(t[kb]));
  t = texelFetch(u_x, ivec2((c.x - 1 + G) & M, c.y), 0); ortho += nhW(ivec2(-1, 0), G) * vec2(float(t[ka]), float(t[kb]));
  t = texelFetch(u_x, ivec2(c.x, (c.y + 1) & M), 0); ortho += nhW(ivec2(0, 1), G) * vec2(float(t[ka]), float(t[kb]));
  t = texelFetch(u_x, ivec2(c.x, (c.y - 1 + G) & M), 0); ortho += nhW(ivec2(0, -1), G) * vec2(float(t[ka]), float(t[kb]));
  t = texelFetch(u_x, ivec2((c.x + 1) & M, (c.y + 1) & M), 0); diag += nhW(ivec2(1, 1), G) * vec2(float(t[ka]), float(t[kb]));
  t = texelFetch(u_x, ivec2((c.x - 1 + G) & M, (c.y - 1 + G) & M), 0); diag += nhW(ivec2(-1, -1), G) * vec2(float(t[ka]), float(t[kb]));
  t = texelFetch(u_x, ivec2((c.x + 1) & M, (c.y - 1 + G) & M), 0); diag += nhW(ivec2(1, -1), G) * vec2(float(t[ka]), float(t[kb]));
  t = texelFetch(u_x, ivec2((c.x - 1 + G) & M, (c.y + 1) & M), 0); diag += nhW(ivec2(-1, 1), G) * vec2(float(t[ka]), float(t[kb]));
  vec2 lap = (4.0 * ortho + diag - 20.0 * ctr) / 6.0;
  for (int d = 0; d < u_nRings; d++) {
    int start = int(u_ringMeta[d].x), n = int(u_ringMeta[d].y); float norm = u_ringMeta[d].z; vec2 acc = vec2(0.0);
    for (int i = 0; i < n; i++) { ivec2 off = texelFetch(u_rings, ivec2(start + i, 0), 0).xy;
      t = texelFetch(u_x, ivec2((c.x + off.x + G * 4) & M, (c.y + off.y + G * 4) & M), 0); acc += nhW(off, G) * vec2(float(t[ka]), float(t[kb])); }
    lap += norm * (acc - float(n) * ctr);
  }
  int ia = XQ(u_c * lap.x), ib = XQ(u_c * lap.y);
  int ra = 1 - ka, rb = ra + 2;   // the component it moves
  v[ra] += u_s * ia; v[rb] += u_s * ib;
  o = v;
}`;
//  the Kerr rotation of copy u_which (0 A, 1 B) by a = +γ·p/(1+p/Isat)·dt (the physical γ: the turbo's SPM call, applyEyeNlSpm(−γ), lands on the same phase), p from the OTHER copy: its |ψ|² or the ◎ V
//  texture. Three shears x += s·XQ(−tan(a/2)·y), y += s·XQ(sin a·x), x += s·XQ(−tan(a/2)·y): s −1 undoes them in reverse (1 and 3 coincide).
const GLSL_X_ROT = /* glsl */`${GLSL_X_HEAD}
uniform isampler2D u_x;
uniform sampler2D u_v;
uniform int u_nloc;
uniform int u_which;
uniform float u_g;
uniform float u_isat;
uniform float u_dt;
uniform int u_s;
uniform sampler2D u_pot;   // the ✍ guide profile (R32F) — its weight u_vw (0 = none)
uniform float u_vw;
out ivec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec4 v = texelFetch(u_x, c, 0);
  ivec2 z = u_which == 0 ? v.xy : v.zw, w = u_which == 0 ? v.zw : v.xy;
  float p;
  if (u_nloc == 1) p = texelFetch(u_v, c, 0).x; else { float a = float(w.x) * XQ_Q, b = float(w.y) * XQ_Q; p = a * a + b * b; }
  p = max(0.0, p);
  float ang = (u_g * p / (1.0 + p / u_isat) + (u_vw != 0.0 ? u_vw * texelFetch(u_pot, c, 0).r : 0.0)) * u_dt, th = tan(0.5 * ang), sn = sin(ang);
  z.x += u_s * XQ(-th * float(z.y)); z.y += u_s * XQ(sn * float(z.x)); z.x += u_s * XQ(-th * float(z.y));
  o = u_which == 0 ? ivec4(z, v.zw) : ivec4(v.xy, z);
}`;
//  Tao's binding: d = A − B, m = B + (d >> 1); d turned by 2 rad (three shears, s ±1); B = m − (d >> 1), A = B + d. The same code is its own
//  inverse with s −1 (it recovers d and m from A, B first).
const GLSL_X_BIND = /* glsl */`${GLSL_X_HEAD}
uniform isampler2D u_x;
uniform int u_s;
out ivec4 o;
void main() {
  ivec4 v = texelFetch(u_x, ivec2(gl_FragCoord.xy), 0);
  ivec2 d = v.xy - v.zw, m = v.zw + (d >> 1);
  const float tW = 1.5574077246549023, sW = 0.9092974268256817;   // tan 1, sin 2
  d.x += u_s * XQ(-tW * float(d.y)); d.y += u_s * XQ(sW * float(d.x)); d.x += u_s * XQ(-tW * float(d.y));
  ivec2 b = m - (d >> 1);
  o = ivec4(b + d, b);
}`;
const GLSL_X_PACK = /* glsl */`${GLSL_X_HEAD}
uniform sampler2D u_psi;
out ivec4 o;
void main() { vec2 p = texelFetch(u_psi, ivec2(gl_FragCoord.xy), 0).xy; ivec2 a = ivec2(XQ(p.x / XQ_Q), XQ(p.y / XQ_Q)); o = ivec4(a, a); }`;
const GLSL_X_UNPACK = /* glsl */`${GLSL_X_HEAD}
uniform isampler2D u_x;
out vec4 fragColor;
void main() { ivec4 v = texelFetch(u_x, ivec2(gl_FragCoord.xy), 0); fragColor = vec4(float(v.x) * XQ_Q, float(v.y) * XQ_Q, 0.0, 1.0); }`;
const GLSL_X_INTENS = /* glsl */`${GLSL_X_HEAD}
uniform isampler2D u_x;
uniform int u_which;
out vec4 fragColor;
void main() { ivec4 v = texelFetch(u_x, ivec2(gl_FragCoord.xy), 0); ivec2 z = u_which == 0 ? v.xy : v.zw; float a = float(z.x) * XQ_Q, b = float(z.y) * XQ_Q;
  fragColor = vec4(a * a + b * b, 0.0, 0.0, 1.0); }`;

// ── GLSL_FFT_STAGE — ONE Stockham mixed-radix FFT stage along one axis (rows or cols). ──────────────
//    Ports mixed-radix-core.js's mixedRadix1d stage loop to the GPU (Stockham auto-sort: no separate
//    digit-reversal pass — each stage reads r inputs at stride u_len and writes them contiguously, so the
//    output ends naturally ordered after the last stage). The r-point cores (_dft2/4/8/16) MIRROR the CPU
//    _dftR bit-for-bit, INCLUDING the twiddle sign wi = -s·sin (the CPU's "-s·w[1]" convention). u_axis
//    picks the transform direction; the OTHER coordinate just passes through. u_sign = -1 fwd / +1 inv (the
//    CPU's S). The 1/N inverse normalisation is done ONCE by the caller (u_norm pass), not per stage.
//    THE MATH per output index j along the axis (Stockham):
//      Ns = u_len (product of already-done radices); r = u_radix.
//      k  = j % Ns;  base = (j / Ns) * (Ns*r) + k;   input q ∈ [0,r): idx = base + q*Ns.
//      twiddle each input by exp(sign·2πi·q·k / (Ns*r)) BEFORE the r-point DFT (matches the CPU's _gr build).
//      the r outputs write to j_out = (j/Ns)*(Ns*r) + p*Ns + k  for p ∈ [0,r) — but since THIS invocation
//      computes ONE output pixel, we invert: given our out-index j, find which (group,p,k) it is and emit p.
//    To keep it one-pixel-one-output we compute the WHOLE r-point core for this pixel's group and select p.
const GLSL_FFT_STAGE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform int   u_axis;    // 0 = transform along X (rows), 1 = along Y (cols)
uniform int   u_radix;   // r for this stage (2,4,8,16)
uniform int   u_len;     // Ns = product of radices already applied (1 on the first stage)
uniform int   u_G;       // grid size along the axis
uniform float u_sign;    // -1.0 forward, +1.0 inverse (the CPU's S / s)
out vec4 fragColor;
const float TAU = 6.28318530717958647692;
// complex helpers
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
// twiddle exp(sign·2πi·num/den) with the sign carried in u_sign (angle = sign·TAU·num/den)
vec2 tw(float num, float den) { float ang = u_sign * TAU * num / den; return vec2(cos(ang), sin(ang)); }
// r-point DFT of the r complex inputs x[0..r-1] (already twiddled). Returns output p. Mirrors _dftR:
//   the CPU cores use s = inv?1:-1 = u_sign, and twiddle imag = -s·sin. We build cores with the SAME sign.
// _dft4 (twiddle-free ±1,±i): j = (∓i)·t3 with the -s convention.
void dft4(vec2 x0, vec2 x1, vec2 x2, vec2 x3, out vec2 o0, out vec2 o1, out vec2 o2, out vec2 o3) {
  vec2 t0 = x0 + x2, t1 = x0 - x2, t2 = x1 + x3, t3 = x1 - x3;
  // jr = -s·t3.y, ji = s·t3.x   (s = u_sign)
  vec2 j = vec2(-u_sign * t3.y, u_sign * t3.x);
  o0 = t0 + t2; o1 = t1 + j; o2 = t0 - t2; o3 = t1 - j;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int j    = (u_axis == 0) ? c.x : c.y;    // our output index ALONG the axis
  int other= (u_axis == 0) ? c.y : c.x;    // the pass-through coordinate
  int len  = u_len;                         // CPU len = product of radices already applied
  int r    = u_radix;
  int nlen = len * r;
  // invert the CPU stage's OUTPUT index j = base + k + p·len  (base multiple of nlen):
  int base = (j / nlen) * nlen;
  int rem  = j - base;                      // rem = k + p·len,  k∈[0,len), p∈[0,r)
  int p    = rem / len;                     // which r-point output THIS pixel is
  int k    = rem - p * len;                 // index within the length-len sub-DFT
  // gather + pre-twiddle the r inputs (CPU: idx = base+k+q·len; _gr[q] = x·exp(sign·2π·q·k/nlen))
  float den = float(nlen);
  vec2 xr[16];
  for (int q = 0; q < 16; q++) {
    if (q >= r) break;
    int idx = base + k + q * len;
    ivec2 fc = (u_axis == 0) ? ivec2(idx, other) : ivec2(other, idx);
    vec2 v = texelFetch(u_psi, fc, 0).xy;
    xr[q] = cmul(v, tw(float(q * k), den));
  }
  vec2 outp;
  if (r == 2) {
    outp = (p == 0) ? (xr[0] + xr[1]) : (xr[0] - xr[1]);
  } else if (r == 4) {
    vec2 o0,o1,o2,o3; dft4(xr[0],xr[1],xr[2],xr[3], o0,o1,o2,o3);
    outp = (p==0)?o0:(p==1)?o1:(p==2)?o2:o3;
  } else {
    // r = 8 or 16: nested cores (mirror _dft8 / _dft16). Do the FULL r-point DFT directly here via
    // the O(r²) sum for correctness parity — r≤16 so it's cheap in a fragment. Twiddle imag sign = u_sign
    // (matches the direct-DFT reference _dftDirect: a = s·2π·k·n/r, so exp(i·a) with s=u_sign).
    vec2 acc = vec2(0.0);
    for (int n = 0; n < 16; n++) {
      if (n >= r) break;
      float ang = u_sign * TAU * float(p * n) / float(r);
      vec2 w = vec2(cos(ang), sin(ang));
      acc += cmul(xr[n], w);
    }
    outp = acc;
  }
  fragColor = vec4(outp, 0.0, 1.0);
}`;

// ── GLSL_FFT_PERM — mixed-radix DIGIT-REVERSAL permutation along one axis (one pass before the stages). ──
//    Mirrors mixed-radix-core.js _buildPerm: out[i] = in[digitReverse(i)]. The reversal is computed inline
//    from the factor list (passed as u_fac[0..u_nfac-1], MSD→LSD as factor() returns). For output index i,
//    the source is rev(i). CPU: for each factor r (in order), rem/=r; rev += (x%r)*rem; x/=r.
const GLSL_FFT_PERM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform int u_axis;
uniform int u_G;
uniform int u_nfac;
uniform int u_fac[8];   // the factor sequence (same order as factor()), max 8 stages
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int i     = (u_axis == 0) ? c.x : c.y;
  int other = (u_axis == 0) ? c.y : c.x;
  // rev(i): the CPU digit-reversal
  int x = i, rev = 0, rem = u_G;
  for (int s = 0; s < 8; s++) {
    if (s >= u_nfac) break;
    int r = u_fac[s];
    rem /= r;
    rev += (x - (x / r) * r) * rem;   // (x % r) * rem
    x /= r;
  }
  ivec2 fc = (u_axis == 0) ? ivec2(rev, other) : ivec2(other, rev);
  fragColor = vec4(texelFetch(u_psi, fc, 0).xy, 0.0, 1.0);
}`;

// ── GLSL_FFT_NORM — the inverse 1/N normalisation (one pass after a full inverse 2D FFT). ────────────
const GLSL_FFT_NORM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_inv;   // 1.0/float(N) for inverse, else 1.0
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, c, 0).xy; fragColor = vec4(v*u_inv, 0.0, 1.0); }`;

// ── GLSL_FFT_BLOCK — the FAITHFUL per-mode 2×2 propagator (mixedRadixPropagate, T=1). ────────────────
//    The CPU op is NOT a scalar exp(iλdt): it FFTs Re(ψ) and Im(ψ) as TWO separate real fields → two
//    COMPLEX spectral fields R̂ (u_rhat) and Î (u_ihat), then couples them per-mode by the 2×2 block:
//        R̂' = A11·R̂ + A12·Î ;  Î' = A21·R̂ + A11·Î
//    with (T=1)  x = 1 − hf,  hf = (dt/4·λ)·(dt/2·λ);  A11 = x;  A12 = −h·(2 − hf), h = (dt/4)·λ;
//    A21 = f = (dt/2)·λ  — all COMPLEX (λ complex). u_which selects the output field (0 = R̂', 1 = Î').
//    Byte-verified vs mixedRadixPropagate at the f64 floor (scratchpad/prop-verify.mjs). ───────────────
const GLSL_FFT_BLOCK = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_rhat;   // R̂ = FFT(Re ψ)  (complex)
uniform sampler2D u_ihat;   // Î = FFT(Im ψ)  (complex)
uniform sampler2D u_lam;    // λ(k) = (re, im) per mode
uniform float u_dt;
uniform int   u_which;      // 0 → output R̂' , 1 → output Î'
uniform int   u_T;          // ≤ 1: one step (unchanged) · > 1: M^T by binary powering (stepEyeJump)
out vec4 fragColor;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 Rh = texelFetch(u_rhat, c, 0).xy;
  vec2 Ih = texelFetch(u_ihat, c, 0).xy;
  vec2 lam= texelFetch(u_lam,  c, 0).xy;
  // build the block (all complex), MIRRORING mixedRadixPropagate T=1:
  vec2 h  = 0.25 * u_dt * lam;              // h  = (dt/4)·λ
  vec2 f  = 0.5  * u_dt * lam;              // f  = (dt/2)·λ
  vec2 hf = cmul(h, f);                     // hf = h·f
  vec2 x  = vec2(1.0, 0.0) - hf;            // x  = 1 − hf   (= A11)
  vec2 t2 = vec2(2.0, 0.0) - hf;            // t2 = 2 − hf
  vec2 A12= -cmul(h, t2);                   // A12 = −h·t2
  vec2 A21= f;                               // A21 = f
  vec2 A11= x;
  if (u_T > 1) {   // M = x·I + N, N² = q·I, det M = 1 → M^T = a·I + b·N (a = T_T(x), b = U_{T−1}(x)), by squaring
    vec2 q = cmul(A12, f), a = vec2(1.0, 0.0), b = vec2(0.0), p = x, s = vec2(1.0, 0.0); int n = u_T;
    for (int it = 0; it < 31; it++) { if (n <= 0) break;
      if ((n & 1) == 1) { vec2 bs = cmul(b, s); vec2 na = cmul(a, p) + cmul(bs, q); vec2 nb = cmul(a, s) + cmul(b, p); a = na; b = nb; }
      n = n >> 1; if (n > 0) { vec2 ss = cmul(s, s); vec2 np = cmul(p, p) + cmul(ss, q); vec2 ns = 2.0 * cmul(p, s); p = np; s = ns; } }
    A11 = a; A12 = cmul(b, A12); A21 = cmul(b, f);
  }
  vec2 outv = (u_which == 0)
      ? (cmul(A11, Rh) + cmul(A12, Ih))     // R̂' = A11·R̂ + A12·Î
      : (cmul(A21, Rh) + cmul(A11, Ih));    // Î' = A21·R̂ + A11·Î
  fragColor = vec4(outv, 0.0, 1.0);
}`;

// ── GLSL_FFT_BLOCKC — the same per-mode block on ONE complex spectrum ψ̂ (see _spectralPassC): R̂, Î from ψ̂(k) and ψ̂(−k), out R̂' + i·Î'.
const GLSL_FFT_BLOCKC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_hat; uniform sampler2D u_lam; uniform float u_dt; uniform int u_T; uniform int u_G;
out vec4 fragColor;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), m = ivec2((u_G - c.x) % u_G, (u_G - c.y) % u_G);
  vec2 a = texelFetch(u_hat, c, 0).xy, b = texelFetch(u_hat, m, 0).xy, bc = vec2(b.x, -b.y);
  vec2 Rh = 0.5 * (a + bc), d = 0.5 * (a - bc), Ih = vec2(d.y, -d.x);   // Î = (a − b*)/(2i)
  vec2 lam = texelFetch(u_lam, c, 0).xy;
  vec2 h = 0.25 * u_dt * lam, f = 0.5 * u_dt * lam, hf = cmul(h, f), x = vec2(1.0, 0.0) - hf, t2 = vec2(2.0, 0.0) - hf;
  vec2 A12 = -cmul(h, t2), A21 = f, A11 = x;
  if (u_T > 1) { vec2 q = cmul(A12, f), aa = vec2(1.0, 0.0), bb = vec2(0.0), p = x, s = vec2(1.0, 0.0); int n = u_T;
    for (int it = 0; it < 31; it++) { if (n <= 0) break;
      if ((n & 1) == 1) { vec2 bs = cmul(bb, s); vec2 na = cmul(aa, p) + cmul(bs, q); vec2 nb = cmul(aa, s) + cmul(bb, p); aa = na; bb = nb; }
      n = n >> 1; if (n > 0) { vec2 ss = cmul(s, s); vec2 np = cmul(p, p) + cmul(ss, q); vec2 ns = 2.0 * cmul(p, s); p = np; s = ns; } }
    A11 = aa; A12 = cmul(bb, A12); A21 = cmul(bb, f); }
  vec2 Ro = cmul(A11, Rh) + cmul(A12, Ih), Io = cmul(A21, Rh) + cmul(A11, Ih);
  fragColor = vec4(Ro + vec2(-Io.y, Io.x), 0.0, 1.0);   // R̂' + i·Î'
}`;

// ── GLSL_FFT_SPLIT — extract Re(ψ) or Im(ψ) into a real field (imag part = 0), for the two-field FFT. ──
const GLSL_FFT_SPLIT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform int u_part;   // 0 → (Re ψ, 0) , 1 → (Im ψ, 0)
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 v = texelFetch(u_psi, c, 0).xy;
  fragColor = vec4((u_part == 0) ? v.x : v.y, 0.0, 0.0, 1.0); }`;

// ── GLSL_FFT_MERGE — recombine ψ' = (Re from Rfield, Re from Ifield) after the inverse FFTs. ──────────
const GLSL_FFT_MERGE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_rfield;   // IFFT(R̂') — take .x = Re
uniform sampler2D u_ifield;   // IFFT(Î') — take .x = Im
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy);
  fragColor = vec4(texelFetch(u_rfield, c, 0).x, texelFetch(u_ifield, c, 0).x, 0.0, 1.0); }`;

//  (b) GLSL_DISSIP — driven-dissipative amplitude relaxation: ψ → ψ·exp((−α + pump·max(0,1−|ψ|²/Pt))·dt).
//      NON-UNITARY (a saturable gain/absorber = a CGL-style cavity). α=loss, pump+Pt=saturable gain toward
//      target intensity Pt. This is what CONTRACTS peer divergence onto the locked tongue (§7.80 escape hatch:
//      residual peer-Δ scales LINEARLY with the seed perturbation = a contracting map, not chaos).
const GLSL_DISSIP = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_alpha;   // linear loss α
uniform float u_pump;    // saturable gain strength
uniform float u_ptarget; // gain target intensity Pt
uniform float u_dt;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float a2 = psi.x*psi.x + psi.y*psi.y;
  float gain = -u_alpha + u_pump * max(0.0, 1.0 - a2 / u_ptarget);
  float s = exp(gain * u_dt);
  fragColor = vec4(s*psi.x, s*psi.y, 0.0, 1.0);
}`;

//  (c) GLSL_ADD_FORCE — additive clock forcing on Re, GPU-resident: ψ.re += u_amp·exp(−r²/u_sig2) (centred mask).
//      Keeps the dissipative-Arnold step fully on-GPU (no per-step readback/upload). u_amp = A·cos(Ω·t)·dt,
//      computed CPU-side once per step (a scalar) and passed as a uniform. This is also the pass a LIVE wiring
//      needs (the clock injecting into the medium without a JS round-trip).
const GLSL_ADD_FORCE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_amp;     // A·cos(Ω·t)·dt this step (scalar)
uniform float u_sig2;    // gaussian mask variance (px²)
uniform int   u_G;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float dx = float(c.x) - float(u_G)*0.5, dy = float(c.y) - float(u_G)*0.5;
  float m  = exp(-(dx*dx + dy*dy) / u_sig2);
  fragColor = vec4(psi.x + u_amp*m, psi.y, 0.0, 1.0);
}`;

//  (d) GLSL_PHASE_ACCUM — on-GPU phase-unwrap accumulator (PERF: read back ONCE per run, not per step).
//      Samples the OBS pixel of u_psi, the previous accumulator state in u_acc (1×1: .x=prevAngle .y=total
//      .z=hasPrev), computes the wrapped Δ, accumulates. Removes the per-step glReadPixels sync that was the
//      G=128 bottleneck. Reset by uploading (0,0,0); after T steps, readPhaseAccum().y = total unwrapped phase.
const GLSL_PHASE_ACCUM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_acc;   // 1×1: (prevAngle, total, hasPrev, _)
uniform int u_ox;
uniform int u_oy;
out vec4 fragColor;
const float PI = 3.14159265358979;
void main() {
  vec2 p = texelFetch(u_psi, ivec2(u_ox, u_oy), 0).xy;
  float a = atan(p.y, p.x);
  vec3 s = texelFetch(u_acc, ivec2(0,0), 0).xyz;   // prev, total, hasPrev
  float total = s.y;
  if (s.z > 0.5) {
    float d = a - s.x;
    d -= 2.0*PI * floor((d + PI) / (2.0*PI));       // wrap to (−π,π]
    total += d;
  }
  fragColor = vec4(a, total, 1.0, 1.0);
}`;

// ── §7.83 PHASE-WELL QUANTIZER — the N-ary, pk-invariant, tileable successor to GLSL_NL_QUANTIZE.
//    Each cell's PHASE (arg ψ) snaps to one of q wells at 2πk/q (a local cos(qφ) potential's minima). The symbol
//    is the well index → a q-symbol alphabet PER CELL (vs §7.77's binary), pk-INVARIANT (phase ignores |ψ| — no
//    snap-to-snap drift), LOCAL (each cell decides alone → tiles to a q^M register, unlike non-local winding), and
//    INSTANT (a snap, not Arnold's multi-cycle lock). HYSTERESIS (the §7.77 fix, generalized N-ary): a cell keeps
//    its PREVIOUS well unless the phase is past the basin boundary by an arc margin u_hold — this tames the
//    separatrix knife-edge (probe: bare snap flips ~25% of boundary cells at eps=1e-6; with hold → 0 to eps=1e-1).
//    u_psi = complex field (arg = the symbol carrier); u_prev = previous symbol index (R channel, the hysteresis
//    memory); u_q = #wells; u_hold = hold-band arc (radians). Output R = the restored symbol index (0..q-1).
const GLSL_PHASE_WELL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;     // complex field; arg(ψ) is the symbol
uniform sampler2D u_prev;    // previous symbol index per cell (R ∈ {0..q-1}) — hysteresis memory
uniform float u_q;           // number of phase wells
uniform float u_hold;        // hold-band: arc (rad) the phase must pass the boundary by to switch wells
out vec4 fragColor;
const float TAU = 6.28318530717959;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float phi = atan(psi.y, psi.x);                 // (−π,π]
  if (phi < 0.0) phi += TAU;                       // [0,2π)
  float step = TAU / u_q;
  float nf   = floor(phi / step + 0.5);            // nearest well index (real)
  int nearest = int(mod(nf, u_q));
  int prev = int(texelFetch(u_prev, c, 0).x + 0.5);
  int sym;
  if (prev < 0 || prev >= int(u_q + 0.5)) {
    sym = nearest;                                  // no valid previous → take nearest
  } else if (nearest == prev) {
    sym = prev;
  } else {
    // angular distance phi→well(k), on the circle
    float dPrev = abs(phi - float(prev)*step); dPrev = min(dPrev, TAU - dPrev);
    float dNew  = abs(phi - float(nearest)*step); dNew = min(dNew, TAU - dNew);
    sym = (dNew < dPrev - u_hold) ? nearest : prev; // switch only if CLEARLY past the boundary (hysteresis)
  }
  fragColor = vec4(float(sym), 0.0, 0.0, 1.0);
}`;

// ── §7.84 SOFT PHASE-WELL HEAL — the GENERATIVE form of GLSL_PHASE_WELL for the LIVE travelling field.
//    GLSL_PHASE_WELL (§7.83) READS a symbol (degenerate on the real operator patch: R≈0.9, mono-phase). This one
//    WRITES instead: it gently rotates each cell's PHASE toward the nearest of q wells, preserving |ψ| (pk-invariant
//    by construction). Run ONCE PER BAR at the boundary (the §7.60 nonlinear-decision slot) — NOT in the leapfrog
//    (snapping every dt would destroy the linear superposition the wave needs to propagate/diffract/correlate;
//    the medium stays exactly linear between boundaries, one non-unitary instant per bar). Over bars the field
//    HEALS to the alphabet → the phase distribution becomes multi-symbol the passive harvest couldn't find.
//    u_snap = pull strength (1.0 hard quantize, ~0.2 soft continuous pull — keeps the field analog). u_hold =
//    deadband (fraction of a half-well, 0..0.5): cells within u_hold of a separatrix are NOT pulled (the §7.83
//    hysteresis, stateless form — refuse to commit on the knife-edge, let the next bar decide). PROBE-GATED:
//    soft-snap embedded in PROPAGATION is a new dynamical system; peer-determinism under transport is unmeasured
//    until phaseHealTest passes.
const GLSL_SOFT_PHASE_WELL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;     // current field
uniform sampler2D u_prev;    // PREVIOUS bar's healed field — the hysteresis MEMORY (its phase = the held well)
uniform float u_q;        // #wells
uniform float u_snap;     // pull strength 0..1
uniform float u_hold;     // deadband as fraction of half-well (0..0.5)
uniform float u_hasPrev;  // 1.0 if u_prev is valid (after bar 0)
out vec4 fragColor;
const float TAU = 6.28318530717959;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float amp = length(psi);
  if (amp < 1e-6) { fragColor = vec4(psi, 0.0, 1.0); return; }   // don't snap vacuum
  float phase = atan(psi.y, psi.x); if (phase < 0.0) phase += TAU;
  float step = TAU / u_q;
  float wellSpace = phase / step;
  float nearest   = floor(wellSpace + 0.5);
  float distSep   = abs(wellSpace - floor(wellSpace) - 0.5);     // 0=on separatrix, 0.5=on a well centre
  // STATEFUL HYSTERESIS (the fix the stateless deadband lacked): in the deadband near a separatrix, snap toward
  // the PREVIOUS bar's well (derived from u_prev's phase), not the ambiguous 'nearest'. Outside the deadband,
  // commit to nearest. This is the §7.83 phase-Schmitt made stateful across PROPAGATION — the previous healed
  // field IS the memory, so float drift that rotated a cell across the boundary can't flip its symbol.
  float target;
  if (u_hasPrev > 0.5 && distSep < u_hold) {
    vec2 pv = texelFetch(u_prev, c, 0).xy;
    float pphase = atan(pv.y, pv.x); if (pphase < 0.0) pphase += TAU;
    float pWell = floor(pphase / step + 0.5);                    // the held well index
    target = pWell * step;                                       // hold the previous symbol
  } else {
    target = nearest * step;                                     // commit to nearest
  }
  float d = target - phase; d -= TAU * floor((d + TAU*0.5) / TAU);   // short arc, wrap (−π,π]
  float finalPhase = phase + u_snap * d;
  fragColor = vec4(amp * cos(finalPhase), amp * sin(finalPhase), 0.0, 1.0);
}`;

// ── §7.86 CUBIC-QUINTIC CGLE STEP — the dissipative-soliton substrate, on the GPU. One explicit-Euler step of
//    ψ_t = δ·ψ + (β + i·d)·∇²ψ + (ε + i·c3)|ψ|²·ψ + (μ + i·c5)|ψ|⁴·ψ  (∇² = ring-Laplacian, the live medium's).
//    δ linear loss (<0), β spectral filter, d dispersion, ε cubic GAIN (>0), μ quintic LOSS (<0) → amplitude is
//    PINNED to a dissipative-soliton attractor that scrubs amplitude+position peer-divergence (§7.85 fieldCorr=1.0).
//    Combined with GLSL_SOFT_PHASE_WELL at the BAR BOUNDARY (not every step) → the §7.86 phase-locked soliton:
//    a LIVE, multi-symbol (q-ary phase), peer-deterministic alphabet. Matches the §7.86 CPU probe exactly.
const GLSL_CGLE_STEP = /* glsl */`#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
${GLSL_UNIFORMS}
in vec2 v_uv;
out vec4 fragColor;
${GLSL_LAP_FUNC}
uniform float u_delta, u_beta, u_dispd, u_eps, u_c3, u_mu, u_c5, u_cdt;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi = texelFetch(u_psi, coord, 0).xy;
  float re = psi.x, im = psi.y;
  float lapRe = ringLap(u_psi, coord, 0, u_rings, u_nRings, u_ringCount);
  float lapIm = ringLap(u_psi, coord, 1, u_rings, u_nRings, u_ringCount);
  float a2 = re*re + im*im, a4 = a2*a2;
  // linear: δψ + (β + i d)∇²ψ
  float dr = u_delta*re + u_beta*lapRe - u_dispd*lapIm;
  float di = u_delta*im + u_beta*lapIm + u_dispd*lapRe;
  // cubic: (ε + i c3)|ψ|²ψ
  dr += u_eps*a2*re - u_c3*a2*im;   di += u_eps*a2*im + u_c3*a2*re;
  // quintic: (μ + i c5)|ψ|⁴ψ
  dr += u_mu*a4*re - u_c5*a4*im;    di += u_mu*a4*im + u_c5*a4*re;
  fragColor = vec4(re + u_cdt*dr, im + u_cdt*di, 0.0, 1.0);
}`;

// ── §7.87 NON-LINEAR HUTCHINSON OPERATOR (NLHO) STEP — the native-IFS spatial quantizer. One iteration of
//    ψ'(x) = tanh( Σ wᵢ · ψ(fᵢ⁻¹(x)) ), where fᵢ are affine contraction maps. Mapping many source pixels → one
//    dest is non-invertible = real contraction; iterating collapses the field to the IFS fractal ATTRACTOR (the
//    symbol). The tanh is the saturable amplitude pin. Run ~8 iterations at the bar boundary. Peer-deterministic
//    for ASYMMETRIC attractors (a unique structural datum); symmetric/featureless rule-sets need a notch (§7.87).
//    Maps in u_maps: per map [s, cosθ, sinθ, tx], with ty,w packed via parallel arrays (GLSL vec4 + 2 floats).
//    We pack each map as TWO vec4s: A=(s, cosθ, sinθ, tx), B=(ty, w, 0, 0). u_nMaps = count.
const GLSL_NLHO_STEP = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform vec4 u_mapA[12];   // per map: (s, cosθ, sinθ, tx)
uniform vec4 u_mapB[12];   // per map: (ty, w, _, _)
uniform int  u_nMaps;
uniform int  u_G;
// §7.87 GPU-resident auto-anchor: when u_anchorOn=1, an extra dominant map is added IN-SHADER whose fixed point is
// read from u_anchorTex (a 1×1 RGBA32F = argmax result: .y=winX px, .z=winY px). No JS placement — the anchor
// coord comes from the GPU argmax reduction. u_anchorScale, u_anchorDom = the §7.87 robust recipe (0.20, 0.65).
uniform sampler2D u_anchorTex;
uniform int   u_anchorOn;
uniform float u_anchorScale;
uniform float u_anchorDom;
out vec4 fragColor;
// manual bilinear sample of the REAL channel at fractional pixel (fx,fy), wrap.
float samp(vec2 f) {
  float G = float(u_G);
  float x0 = floor(f.x), y0 = floor(f.y), ax = f.x - x0, ay = f.y - y0;
  ivec2 p00 = ivec2(int(mod(x0, G)),     int(mod(y0, G)));
  ivec2 p10 = ivec2(int(mod(x0+1.0, G)), int(mod(y0, G)));
  ivec2 p01 = ivec2(int(mod(x0, G)),     int(mod(y0+1.0, G)));
  ivec2 p11 = ivec2(int(mod(x0+1.0, G)), int(mod(y0+1.0, G)));
  float v00 = texelFetch(u_psi, p00, 0).x, v10 = texelFetch(u_psi, p10, 0).x;
  float v01 = texelFetch(u_psi, p01, 0).x, v11 = texelFetch(u_psi, p11, 0).x;
  return v00*(1.0-ax)*(1.0-ay) + v10*ax*(1.0-ay) + v01*(1.0-ax)*ay + v11*ax*ay;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float Gf = float(u_G);
  float nx = float(c.x) / Gf, ny = float(c.y) / Gf;   // dest in [0,1)
  // base-map total weight scale: when anchored, base maps share (1-dom), anchor gets dom.
  float baseScale = (u_anchorOn == 1) ? (1.0 - u_anchorDom) : 1.0;
  float acc = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= u_nMaps) break;
    float s = u_mapA[i].x, co = u_mapA[i].y, si = u_mapA[i].z, tx = u_mapA[i].w;
    float ty = u_mapB[i].x, w = u_mapB[i].y * baseScale;
    float qx = (nx - tx)/s, qy = (ny - ty)/s;
    vec2 src = vec2(co*qx + si*qy, -si*qx + co*qy);
    acc += w * samp(src * Gf);
  }
  // GPU-resident anchor: one dominant localized map at the argmax point (read from u_anchorTex). fixed pt =
  // (winX,winY)/G; for f(p)=s·p+t with no rotation, t = (1-s)·target ⇒ inverse src = (dest - t)/s.
  if (u_anchorOn == 1) {
    vec4 am = texelFetch(u_anchorTex, ivec2(0,0), 0);   // (maxVal, winX, winY, _)
    float ax2 = am.y / Gf, ay2 = am.z / Gf;             // anchor target in [0,1)
    float s = u_anchorScale, tx = (1.0 - s)*ax2, ty = (1.0 - s)*ay2;
    vec2 src = vec2((nx - tx)/s, (ny - ty)/s);
    acc += u_anchorDom * samp(src * Gf);
  }
  float v = tanh(acc);
  fragColor = vec4(v, 0.0, 0.0, 1.0);   // real-valued attractor field (symbol carrier)
}`;

// ── §7.87 ARGMAX REDUCTION — find the densest texel's (value, x, y) PURELY on GPU (no readback). Two shaders:
//    INIT lifts the field into (val, x, y, 1) per texel; REDUCE max-pools 2×2 blocks carrying the WINNING coord
//    down a pyramid to 1×1. The NLHO step then reads the anchor coord from that 1×1 texture (u_anchorTex) — so the
//    whole auto-anchor (find peak → place dominant anchor there) is GPU-resident; no glReadPixels in the path.
const GLSL_ARGMAX_INIT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;   // field; REAL channel = the value to argmax
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float v = texelFetch(u_psi, c, 0).x;
  fragColor = vec4(v, float(c.x), float(c.y), 1.0);   // (value, x, y, valid)
}`;
const GLSL_ARGMAX_REDUCE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_src;   // (val,x,y,valid) at the finer level
uniform int u_inW, u_inH;  // dimensions of the finer (input) level
out vec4 fragColor;
void main() {
  ivec2 d = ivec2(gl_FragCoord.xy);   // dest texel in the coarser level
  ivec2 b = d * 2;                    // top-left of the 2×2 block in the input
  vec4 best = vec4(-1e30, 0.0, 0.0, 0.0);
  for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
    ivec2 p = b + ivec2(dx, dy);
    if (p.x >= u_inW || p.y >= u_inH) continue;   // ragged edge (odd dims)
    vec4 s = texelFetch(u_src, p, 0);
    if (s.w < 0.5) continue;
    // §7.88i DETERMINISTIC TIE-BREAK: a degenerate field (multiple near-equal peaks — diffuse/symmetric rule-sets
    // like the spiral/diagonal) makes a strict '>' resolve DIFFERENTLY per GPU's float32 rounding → the anchor
    // lands elsewhere → a totally different attractor (the "same genome, different image" for SOME ranks). Fix:
    // within an epsilon band treat values as TIED and pick by LOWER linear coordinate (a rule every GPU agrees on).
    if (best.w < 0.5) { best = vec4(s.x, s.y, s.z, 1.0); continue; }
    float EPS = 1e-5;
    if (s.x > best.x + EPS) best = vec4(s.x, s.y, s.z, 1.0);            // clearly bigger
    else if (s.x > best.x - EPS) {                                      // ~tie → lowest coord wins (deterministic)
      float si = s.y + s.z * float(u_inW), bi = best.y + best.z * float(u_inW);
      if (si < bi) best = vec4(s.x, s.y, s.z, 1.0);
    }
  }
  fragColor = best;
}`;

// ── §7.77 BISTABLE PHYSICAL QUANTIZER — the per-cell genome level-restorer moved from JS into the medium.
//    The §7.65 "sticky quantizer" in _opCycHarvest (h>0.6·pk → 1, h<0.4·pk → 0, else KEEP previous) is a
//    Schmitt trigger: two thresholds + a HOLD region. The hold region (hysteresis) is what makes the verdict
//    PEER-DETERMINISTIC — a cell on the knife-edge keeps its previous bit on every peer, so float32 drift can't
//    flip it (probe-verified: hard threshold breaks at ~1e-3 field divergence, the hysteretic form stays
//    bit-identical to 3e-2). This shader IS that Schmitt, as physics: u_psi = current field, u_prev = the
//    previous bit-field (W, the hysteresis memory), u_pk = the patch peak |ψ| (normalizer, computed once on the
//    CPU/GPU readback). The cell relaxes its AMPLITUDE toward the 0-well or 1-well (NON-unitary — a saturable
//    gain/absorber: it pumps cells to 0 or 1, unlike the unitary §7.60 kick which only rotates phase). Output's
//    real channel = the restored bit level (0 or 1) so the harvest reads an already-quantized field — the
//    medium computes the verdict, not a JS `if`. The two wells + hold-band = a bistable element with memory.
const GLSL_NL_QUANTIZE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;    // current field (complex; |ψ| is the harvest amplitude h)
uniform sampler2D u_prev;   // previous bit-field W (R channel ∈ {0,1}) — the hysteresis memory
uniform float u_pk;         // patch peak |ψ| (h normalized to this, matching _opCycHarvest)
uniform float u_thLo;       // low threshold (×pk): below → 0-well   (§7.65 = 0.4)
uniform float u_thHi;       // high threshold (×pk): above → 1-well  (§7.65 = 0.6)
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = texelFetch(u_psi, c, 0).xy;
  float h  = length(psi) / max(1e-9, u_pk);          // normalized amplitude (= h/pk in the JS harvest)
  float prev = texelFetch(u_prev, c, 0).x;           // previous bit (0 or 1) — hysteresis memory
  // SCHMITT decision: above hi → 1-well, below lo → 0-well, in the hold band → keep previous (the bistable hold).
  float bit = h > u_thHi ? 1.0 : (h < u_thLo ? 0.0 : prev);
  fragColor = vec4(bit, 0.0, 0.0, 1.0);              // level-restored: the cell sits in its well (0 or 1)
}`;

// ── §7.61 THE RESIDENT QUANTIZER (bootstrap step 3, core): the level-restored DECISION computed ON the
//    GPU. Per tick a scissored write drops this rank's (U_r·a)(V·b) into its slot of a K×1 MATCH row; at
//    bar end GLSL_OP_DECIDE runs argmax + threshold over the row into a 1×1 DECISION texel
//    (winner, best, fired). JS reads back BITS — the decided texel — never the analog scalars: the
//    testimony layer now carries decisions only. The decision texture is also the step-3 selector-in-
//    waiting: a GLSL_OP_DOT_UA_ROWS variant that samples it instead of u_cyc makes the FIELD choose the
//    next program — field-gated branching with no JS in the loop.
const GLSL_SCL_MUL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_sA;
uniform sampler2D u_sB;
out vec4 fragColor;
void main() {
  fragColor = vec4(texelFetch(u_sA, ivec2(0,0), 0).x * texelFetch(u_sB, ivec2(0,0), 0).x, 0.0, 0.0, 1.0);
}`;

const GLSL_OP_DECIDE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_match;   // K×1 row: per-rank (U_r·a)(V·b) for this bar
uniform int u_K;
uniform float u_theta;       // the level-restorer's threshold (margins ≫ drift)
out vec4 fragColor;
void main() {
  float best = -1.0e30; int win = 0;
  for (int k = 0; k < u_K; k++) { float s = texelFetch(u_match, ivec2(k, 0), 0).x; if (s > best) { best = s; win = k; } }
  fragColor = vec4(float(win), best, best > u_theta ? 1.0 : 0.0, 1.0);   // (winner, scalar, fired)
}`;

const GLSL_OP_DOT_UA_ROWS = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_atlasU;   // K layers: stored rank keys U_r (normalized)
uniform sampler2DArray u_atlasA;   // K layers: bar input keys a(bar mod K) (raw masks)
uniform int u_cyc;
uniform int u_K;
uniform int u_nBins;
uniform int u_G;
out vec4 fragColor;
void main() {
  int y  = int(gl_FragCoord.y);
  int rU = u_cyc % u_K;               // live rank — selected by the clock, in-shader
  int rA = (u_cyc / u_nBins) % u_K;   // this bar's input key (melody is K-bar periodic)
  float s = 0.0;
  for (int x = 0; x < u_G; x++)
    s += texelFetch(u_atlasU, ivec3(x, y, rU), 0).x * texelFetch(u_atlasA, ivec3(x, y, rA), 0).x;
  fragColor = vec4(s, 0.0, 0.0, 1.0);
}`;

const GLSL_SCATTER_MAD_ATLAS = /* glsl */`#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D u_acc;
uniform sampler2DArray u_atlasW;   // K layers: output carriers W_r
uniform sampler2D u_sA;            // 1×1 scalar: (U_r·a)
uniform sampler2D u_sB;            // 1×1 scalar: (V·b)
uniform int u_cyc;
uniform int u_K;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  int r = u_cyc % u_K;
  float prev  = (r == 0) ? 0.0 : texelFetch(u_acc, coord, 0).x;   // bar-start reset — in-shader, not a JS flag
  float scale = texelFetch(u_sA, ivec2(0,0), 0).x * texelFetch(u_sB, ivec2(0,0), 0).x;
  fragColor   = vec4(prev + scale * texelFetch(u_atlasW, ivec3(coord, r), 0).x, 0.0, 0.0, 1.0);
}`;

// Render psi amplitude: log-scaled |ψ|² → hologram colormap.
// u_smoothMax = smoothed max intensity for normalization.
const GLSL_RENDER_FIELD = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float     u_smoothMax;
in vec2 v_uv;
out vec4 fragColor;
${GLSL_HOLOGRAM_COLORMAP}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  float norm  = 1.0 / sqrt(max(u_smoothMax, 1e-18));
  float amp   = sqrt(psi.x*psi.x + psi.y*psi.y) * norm;
  float lv    = log(1.0 + 99.0 * amp) / log(100.0);
  fragColor   = vec4(hologramColor(lv), 1.0);
}`;

// Render |ψ + α·obj| amplitude — eye DIFF panel, computed entirely on GPU so the
// synchronous readPsi()+CPU-mix path is removed. Same colormap as GLSL_RENDER_FIELD.
const GLSL_RENDER_DIFF = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_obj;
uniform float     u_alpha;
uniform float     u_smoothMax;
in vec2 v_uv;
out vec4 fragColor;
${GLSL_HOLOGRAM_COLORMAP}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  vec2  obj   = texelFetch(u_obj, coord, 0).xy;
  vec2  mix   = psi + u_alpha * obj;
  float norm  = 1.0 / sqrt(max(u_smoothMax, 1e-18));
  float amp   = sqrt(mix.x*mix.x + mix.y*mix.y) * norm;
  float lv    = log(1.0 + 99.0 * amp) / log(100.0);
  fragColor   = vec4(hologramColor(lv), 1.0);
}`;

// Hologram-domain transform [H] — operates on the spread eye wavefront between the
// forward and backward legs. mode: 1=low-pass, 2=high-pass (radial aperture), 3=phase
// conjugate, 7=random-block ZERO (scattered occlusion), 8=random-block NOISE (corruption).
// u_param = aperture radius / masked-fraction; u_block = block size px; u_seed = reshuffle.
const GLSL_EYE_HOLOGRAM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform int   u_G;
uniform int   u_mode;
uniform float u_param;
uniform int   u_block;   // random-block size in pixels (modes 7/8)
uniform float u_seed;    // reshuffle the random pattern (modes 7/8)
out vec4 fragColor;
// Deterministic per-value hash → [0,1). Stable across frames (no flicker) for a fixed
// seed, so the cached snap holds; bump u_seed to draw a new random pattern.
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + u_seed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2  psi = texelFetch(u_psi, c, 0).xy;
  float halfG = float(u_G) * 0.5;
  vec2  d   = vec2(float(c.x) - halfG, float(c.y) - halfG);
  float r   = length(d) / halfG;            // normalized radius 0..~1.4
  float rc  = max(u_param, 0.001);          // aperture cutoff fraction
  if (u_mode == 1) {                        // low-pass: keep centre
    if (r > rc) psi = vec2(0.0);
  } else if (u_mode == 2) {                 // high-pass: keep outside
    if (r < rc) psi = vec2(0.0);
  } else if (u_mode == 3) {                 // phase conjugate
    psi.y = -psi.y;
  } else if (u_mode == 6) {                 // LEFT-COLUMN occlude: zero the left u_param
    if (float(c.x) < u_param * float(u_G))  // fraction of columns (contiguous slab).
      psi = vec2(0.0);
  } else if (u_mode == 7 || u_mode == 8) {  // RANDOM-BLOCK mask (scattered, square pixels)
    int b = max(u_block, 1);
    vec2 blk = floor(vec2(c) / float(b));   // which block this cell belongs to
    if (hash(blk) < u_param) {              // this block is masked (u_param = fraction)
      if (u_mode == 7) {
        psi = vec2(0.0);                    // mode 7: ZERO (random occlusion)
      } else {
        // mode 8: replace with random complex NOISE at the local amplitude scale.
        float amp = length(psi) + 1e-4;
        float a1 = hash(vec2(c) + 7.1);
        float a2 = hash(vec2(c) + 19.7);
        psi = amp * vec2(a1 - 0.5, a2 - 0.5) * 2.0;
      }
    }
  }
  fragColor = vec4(psi, 0.0, 1.0);
}`;

// Render psi phase: hue wheel with log-amplitude value — matches JS colormaps.phase().
// Amplitude cutoff: pixels below 0.015 * norm render black.
const GLSL_RENDER_PHASE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float     u_smoothMax;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2  psi   = texelFetch(u_psi, coord, 0).xy;
  float norm  = 1.0 / sqrt(max(u_smoothMax, 1e-18));
  float amp   = sqrt(psi.x*psi.x + psi.y*psi.y) * norm;
  float hue = (atan(psi.y, psi.x) / (2.0 * 3.14159265) + 1.0);
  hue = hue - floor(hue);  // fract
  float v   = clamp(log(1.0 + 6.0 * amp) / log(7.0), 0.0, 1.0);
  // FULL-SATURATION hue → RGB (integer hi sector), value = v — the honest phase color, unchanged
  float h6  = hue * 6.0;
  float hi  = floor(h6);
  float f   = h6 - hi;
  float q   = v * (1.0 - f);
  float t0  = v * f;
  int   sec = int(mod(hi, 6.0));
  vec3  rgb;
  if      (sec == 0) rgb = vec3(v,  t0, 0.0);
  else if (sec == 1) rgb = vec3(q,  v,  0.0);
  else if (sec == 2) rgb = vec3(0.0,v,  t0);
  else if (sec == 3) rgb = vec3(0.0,q,  v);
  else if (sec == 4) rgb = vec3(t0, 0.0,v);
  else               rgb = vec3(v,  0.0,q);
  // SMOOTH EDGE FADE (was: a hard amp<0.015 to-black clip, which BIT the continuous wave into jagged
  // pixelated black holes wherever the amplitude rippled below threshold -- "wave broken by pixels in dark").
  // smoothstep fades the wave continuously to black across a small amplitude band, so the edge stays smooth
  // and the phase color is honest and untouched. The low tail dims to black gracefully instead of clipping.
  float fade = smoothstep(0.004, 0.03, amp);
  rgb *= fade;
  fragColor = vec4(rgb, 1.0);
}`;

// ℂ*-DESCRIPTOR PROJECTION (medium-u1 𝔸-slots) — the register's VIEW as pure final-pixel arithmetic:
//   ψ(x) = B(x − off) · e^{i(φ + k·(x − c))}
// B = the recorded envelope (torus bilinear sample — matches rollField/lensC1 conventions), φ = the register
// phase (+ fractional-bar ω from the model), k = the linOp momentum tilt (rad/cell). With ω and k both set the
// phase fronts FLOW through the envelope at ω/|k| — the travelling-wave primitive content·e^{i(k·x+ω·t)},
// evaluated per pixel per frame. Colormap = the SAME honest phase convention as GLSL_RENDER_PHASE (hue = arg ψ,
// value = |ψ|, smoothstep edge fade): the full complex state shown, nothing invented, nothing hidden.
// ── ◈ THE SPECTRAL OBSERVER (2026-10-17, the app's native colour): a cell's light is a LINE — its mean frequency ω̄ = arg S / dt
//    (= +arg S / dt: the turn in the REGISTER's sense, ∠ — a cell turning faster than the medium's zero mode is bluer, so the ω slider and the colour agree) and its width from the lag-one coherence |S| / E
//    (a Gaussian line keeps |⟨e^{−iω dt}⟩| = e^{−σ²dt²/2}). The DECLARED scale puts ω on the visible band (centre → 565 nm, ±span → 380 /
//    750 nm); the eye is the CIE 1931 2° observer (x̄ ȳ z̄ — Wyman, Sloan & Shirley's analytic fit) integrated over the line, 380–770 nm.
//    Chromaticity from the spectrum; brightness = the amp view's curve × the line's VISIBLE share (a line in the infrared / ultraviolet
//    is unseen); out-of-gamut spectral colours are pulled toward white at the same brightness (the display's limit, not the light's).
const GLSL_SPECTRAL_OBSERVER = /* glsl */`
float g3(float l, float m, float s1, float s2) { float t = (l - m) / (l < m ? s1 : s2); return exp(-0.5 * t * t); }
vec3 cieXYZ(float l) { return vec3(1.056 * g3(l, 599.8, 37.9, 31.0) + 0.362 * g3(l, 442.0, 16.0, 26.7) - 0.065 * g3(l, 501.1, 20.4, 26.2),
  0.821 * g3(l, 568.8, 46.9, 40.5) + 0.286 * g3(l, 530.9, 16.3, 31.1), 1.217 * g3(l, 437.0, 11.8, 36.0) + 0.681 * g3(l, 459.0, 26.0, 13.8)); }
vec3 spectralColor(vec4 A, vec4 map, float lum) {
  float E = A.z, D = max(A.w, 1e-9); if (!(E > 1e-30)) return vec3(0.0);
  float coh = clamp(length(A.xy) / E, 1e-6, 1.0), w = atan(A.y, A.x) / D, sw = sqrt(-2.0 * log(coh)) / D;
  float lam = 565.0 - 185.0 * (w - map.x) / max(map.y, 1e-9), sl = max(map.z, 185.0 * sw / max(map.y, 1e-9));
  vec3 XYZ = vec3(0.0); float vis = 0.0;
  for (int n = 0; n < 40; n++) { float l = 380.0 + 10.0 * float(n), t = (l - lam) / sl, p = exp(-0.5 * t * t); XYZ += p * cieXYZ(l); vis += p; }
  vis = clamp(vis * 10.0 / (sl * 2.5066283), 0.0, 1.0);   // the line's share inside 380–770 nm
  if (XYZ.y < 1e-6) return vec3(0.0);
  vec3 c = mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570) * (XYZ / XYZ.y);   // linear sRGB at Y = 1
  float m = min(c.r, min(c.g, c.b)); if (m < 0.0) c = mix(c, vec3(1.0), m / (m - 1.0));   // gamut: toward white, the same Y
  c /= max(1.0, max(c.r, max(c.g, c.b)));
  return pow(c, vec3(1.0 / 2.2)) * clamp(lum * vis, 0.0, 1.0); }
// ◈ bank mode: the spectrum is the 8 resonators' powers (no line shape assumed); the visible share = their total over the cell's energy
vec3 bankColor(vec3 XYZ, float P, float E, float lum) { if (!(P > 1e-30) || XYZ.y < 1e-12) return vec3(0.0); float vis = clamp(P / max(E, 1e-30), 0.0, 1.0);
  vec3 c = mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570) * (XYZ / XYZ.y);
  float m = min(c.r, min(c.g, c.b)); if (m < 0.0) c = mix(c, vec3(1.0), m / (m - 1.0)); c /= max(1.0, max(c.r, max(c.g, c.b)));
  return pow(c, vec3(1.0 / 2.2)) * clamp(lum * vis, 0.0, 1.0); }`;
// ◈ the RESONATOR BANK, one sub-step: y_m ← (1−a)·y_m·r_m + a·ψ (r_m = e^{i(ω_m·dt + the carrier's turn)}) — 8 complex resonators tuned across the
//    declared visible band; a tone at ω_m builds y_m up to its own amplitude, others beat away (bandwidth ≈ a / dt, set to the bins' spacing)
// ◈ the SECOND stage (2026-10-17, the plan's upkeep): each resonator fed by its own first stage — y2 ← (1−a)·y2·r + a·y1 — skirts 1/(1+x²)² (one stage
//    leaked 2–8 % of a pure line into the far bins)
//    ◈ the bank's EXPOSED POWERS (2026-10-18): the eye integrates each band's POWER, not its amplitude — P_m ← (1−a)·P_m + a·|y_m|² over the
//    second stage's 8 resonators (two RGBA targets: m 0–3, 4–7); a the exposure's weight (the app's ⧗)
const GLSL_SPEC_BANKP = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_b0, u_b1, u_b2, u_b3, u_p0, u_p1; uniform float u_a;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec4 b0 = texelFetch(u_b0, c, 0), b1 = texelFetch(u_b1, c, 0), b2 = texelFetch(u_b2, c, 0), b3 = texelFetch(u_b3, c, 0);
  o0 = mix(texelFetch(u_p0, c, 0), vec4(dot(b0.xy, b0.xy), dot(b0.zw, b0.zw), dot(b1.xy, b1.xy), dot(b1.zw, b1.zw)), u_a);
  o1 = mix(texelFetch(u_p1, c, 0), vec4(dot(b2.xy, b2.xy), dot(b2.zw, b2.zw), dot(b3.xy, b3.xy), dot(b3.zw, b3.zw)), u_a); }`;
const GLSL_SPEC_BANK2 = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_s0, u_s1, u_s2, u_s3, u_b0, u_b1, u_b2, u_b3;
uniform float u_a; uniform vec2 u_rot[8];
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec4 st2(vec4 b, vec4 s, int m) { return vec4((1.0 - u_a) * cm(b.xy, u_rot[m]) + u_a * s.xy, (1.0 - u_a) * cm(b.zw, u_rot[m + 1]) + u_a * s.zw); }
void main() { ivec2 c = ivec2(gl_FragCoord.xy);
  o0 = st2(texelFetch(u_b0, c, 0), texelFetch(u_s0, c, 0), 0); o1 = st2(texelFetch(u_b1, c, 0), texelFetch(u_s1, c, 0), 2); o2 = st2(texelFetch(u_b2, c, 0), texelFetch(u_s2, c, 0), 4); o3 = st2(texelFetch(u_b3, c, 0), texelFetch(u_s3, c, 0), 6); }`;
const GLSL_SPEC_BANK = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_b0, u_b1, u_b2, u_b3;
uniform float u_a; uniform vec2 u_rot[8];
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec4 st2(vec4 b, int m, vec2 x) { return vec4((1.0 - u_a) * cm(b.xy, u_rot[m]) + u_a * x, (1.0 - u_a) * cm(b.zw, u_rot[m + 1]) + u_a * x); }
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 x = texelFetch(u_psi, c, 0).xy;
  o0 = st2(texelFetch(u_b0, c, 0), 0, x); o1 = st2(texelFetch(u_b1, c, 0), 2, x); o2 = st2(texelFetch(u_b2, c, 0), 4, x); o3 = st2(texelFetch(u_b3, c, 0), 6, x); }`;
// ◈ accumulate one sub-step into the cell's spectrum: S ← (1−a)S + a·ψ_t·ψ̄_{t−1}·ḡ₀ (ḡ₀ = the zero mode's own turn, removed), E, dt likewise
const GLSL_SPEC_ACC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi, u_prev, u_acc;
uniform float u_a, u_dt; uniform vec2 u_ref;
in vec2 v_uv; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 p = texelFetch(u_psi, c, 0).xy, q = texelFetch(u_prev, c, 0).xy; vec4 A = texelFetch(u_acc, c, 0);
  vec2 z = vec2(p.x * q.x + p.y * q.y, p.y * q.x - p.x * q.y); z = vec2(z.x * u_ref.x + z.y * u_ref.y, z.y * u_ref.x - z.x * u_ref.y);
  fragColor = mix(A, vec4(z, dot(p, p), u_dt), u_a); }`;
//   ⚛ the condensate's phase-space passes (becGpuStep — inert unless called)
const GLSL_BEC_KACC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_acc; uniform float u_a, u_n; in vec2 v_uv; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 z = texelFetch(u_x, q, 0).xy; float p = texelFetch(u_acc, q, 0).x; o = vec4((1.0 - u_a) * p + u_a * dot(z, z) * u_n, 0.0, 0.0, 1.0); }`;
const GLSL_BEC_BAND = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G, u_kb; in vec2 v_uv; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); int kx = q.x < u_G / 2 ? q.x : q.x - u_G, ky = q.y < u_G / 2 ? q.y : q.y - u_G; o = (abs(kx) < u_kb && abs(ky) < u_kb) ? vec4(texelFetch(u_x, q, 0).xy, 0.0, 1.0) : vec4(0.0, 0.0, 0.0, 1.0); }`;
const GLSL_BEC_LAG = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G, u_Q, u_y0, u_y1; in vec2 v_uv; out vec4 o;
float hw(int s) { float u = abs(float(s)) / float(u_Q / 2); if (u <= 0.75) return 1.0; if (u >= 1.0) return 0.0; float c = cos(1.5707963267948966 * (u - 0.75) / 0.25); return c * c; }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); int x = q.x, j = q.y; o = vec4(0.0, 0.0, 0.0, 1.0); if (j >= u_Q) return; int s = j < u_Q / 2 ? j : j - u_Q; float h = hw(s); if (h == 0.0) return;
  int xm = ((x - s) % u_G + u_G) % u_G, xp = ((x + s) % u_G + u_G) % u_G; vec2 acc = vec2(0.0);
  for (int y = u_y0; y <= u_y1; y++) { int yy = (y % u_G + u_G) % u_G; vec2 a = texelFetch(u_x, ivec2(xm, yy), 0).xy, b = texelFetch(u_x, ivec2(xp, yy), 0).xy; acc += vec2(a.x * b.x + a.y * b.y, a.x * b.y - a.y * b.x); }
  o = vec4(h * acc, 0.0, 1.0); }`;
const GLSL_BEC_WDFT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_f, u_acc; uniform int u_Q; uniform float u_a; in vec2 v_uv; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); int x = q.x, mm = q.y; if (mm >= u_Q) { o = vec4(0.0, 0.0, 0.0, 1.0); return; } int m = (mm + u_Q / 2) % u_Q; float re = 0.0;
  for (int j = 0; j < u_Q; j++) { vec2 f = texelFetch(u_f, ivec2(x, j), 0).xy; float ang = -6.283185307179586 * float((j * m) % u_Q) / float(u_Q); re += f.x * cos(ang) - f.y * sin(ang); }
  float p = texelFetch(u_acc, q, 0).x; o = vec4((1.0 - u_a) * p + u_a * re, 0.0, 0.0, 1.0); }`;
//   ⚛ the space views (spaceRender — inert unless called): a column max per x, the max of those, the colour map
const GLSL_HUSIMI = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_acc; uniform float u_a; uniform int u_P, u_st, u_G; in vec2 v_uv; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy), pc = q / u_P, kk = q - pc * u_P, x0 = pc * u_st + u_st / 2 - u_P / 2; float c = 0.5 * float(u_P - 1), s2 = 2.0 * pow(float(u_P) / 4.0, 2.0); vec2 acc = vec2(0.0);
  for (int v = 0; v < u_P; v++) for (int u = 0; u < u_P; u++) { vec2 z = texelFetch(u_x, ((x0 + ivec2(u, v)) % u_G + u_G) % u_G, 0).xy; float w = exp(-((float(u) - c) * (float(u) - c) + (float(v) - c) * (float(v) - c)) / s2), th = -6.283185307179586 * float(kk.x * u + kk.y * v) / float(u_P);
    acc += w * vec2(z.x * cos(th) - z.y * sin(th), z.x * sin(th) + z.y * cos(th)); }
  float p = texelFetch(u_acc, q, 0).x; o = vec4((1.0 - u_a) * p + u_a * dot(acc, acc), 0.0, 0.0, 1.0); }`;
//   ⚛ the live analyses: the t-f Wigner–Ville from the ring, the Husimi patch fit
const GLSL_TF_RING = `vec2 ring(sampler2D r, int b, int L) { return texelFetch(r, ivec2(((b % L) + L) % L, 0), 0).xy; }`;
const GLSL_TF_FC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_r; uniform int u_L, u_b0, u_b1; in vec2 v_uv; out vec4 o;` + GLSL_TF_RING + `
void main() { vec2 a = vec2(0.0); for (int b = u_b0; b < u_b1; b++) { vec2 p = ring(u_r, b + 1, u_L), q = ring(u_r, b, u_L); a += vec2(p.x * q.x + p.y * q.y, p.y * q.x - p.x * q.y); } o = vec4(atan(a.y, a.x), 0.0, 0.0, 1.0); }`;
const GLSL_TF_WVD = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_r, u_fc; uniform int u_L, u_b0, u_b1, u_Mh, u_G, u_Lt; uniform float u_F; in vec2 v_uv; out vec4 o;` + GLSL_TF_RING + `
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int span = u_b1 - u_b0 - 2 * u_Mh - 2 * u_Lt; int n0 = u_b0 + u_Mh + u_Lt + int(round(float(c.x) * float(max(span, 0)) / float(u_G - 1)));
  float fc = texelFetch(u_fc, ivec2(0), 0).x, f = fc - u_F + 2.0 * u_F * (float(c.y) + 0.5) / float(u_G), a = 0.0;
  for (int t = -u_Lt; t <= u_Lt; t++) { float g = u_Lt > 0 ? pow(cos(3.141592653589793 * float(t) / float(2 * u_Lt + 2)), 2.0) : 1.0; int n = n0 + t;   /* the SMOOTHED pseudo-Wigner–Ville: a time window g over ±Lt — the oscillating cross terms average out */
    for (int m = -u_Mh; m <= u_Mh; m++) { vec2 zp = ring(u_r, n + m, u_L), zm = ring(u_r, n - m, u_L); float pr = zp.x * zm.x + zp.y * zm.y, pi = zp.y * zm.x - zp.x * zm.y, th = 2.0 * f * float(m), h = cos(3.141592653589793 * float(m) / float(2 * u_Mh + 2)); a += g * h * h * (pr * cos(th) + pi * sin(th)); } }
  o = vec4(a, 0.0, 0.0, 1.0); }`;
const GLSL_TF_RENDER = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_w, u_mx, u_fc; uniform int u_G, u_nref; uniform float u_F, u_ref[8]; in vec2 v_uv; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); float m = max(texelFetch(u_mx, ivec2(0), 0).x, 1e-30), v = texelFetch(u_w, c, 0).x / m, a = sqrt(abs(v)); float sw = 0.0, sy = 0.0;
  float fc = texelFetch(u_fc, ivec2(0), 0).x; for (int k = 0; k < 8; k++) { if (k >= u_nref) break; float d = u_ref[k] - fc; d -= 6.283185307179586 * floor(d / 6.283185307179586 + 0.5); float yr = (d + u_F) / (2.0 * u_F) * float(u_G) - 0.5; if (abs(float(c.y) - yr) < 0.6 && (c.x % 4) < 2) { o = vec4(0.35, 0.85, 1.0, 1.0); return; } }   /* the medium's own frequencies: dashed cyan */
  for (int y = 0; y < u_G; y++) { float w = max(texelFetch(u_w, ivec2(c.x, y), 0).x, 0.0); sw += w; sy += w * float(y); } float ym = sw > 0.0 ? sy / sw : -10.0;
  if (abs(float(c.y) - ym) < 0.7) { o = vec4(0.9, 0.93, 0.95, 1.0); return; }
  o = v >= 0.0 ? vec4(min(1.0, 1.5 * a), clamp(1.5 * a - 0.4, 0.0, 1.0), 0.16 * a, 1.0) : vec4(0.12 * a, 0.63 * a, min(1.0, 1.6 * a), 1.0); }`;
const GLSL_TF_STATS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_w, u_fc; uniform int u_G; uniform float u_F; in vec2 v_uv; out vec4 o;
void main() { float fc = texelFetch(u_fc, ivec2(0), 0).x, sw = 0.0, sf = 0.0; for (int y = 0; y < u_G; y++) { float w = max(texelFetch(u_w, ivec2(u_G - 1, y), 0).x, 0.0), f = fc - u_F + 2.0 * u_F * (float(y) + 0.5) / float(u_G); sw += w; sf += w * f; } o = vec4(fc, sw > 0.0 ? sf / sw : fc, 0.0, 1.0); }`;
const GLSL_HUS_FIT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_h, u_eps; uniform int u_P; uniform float u_e0, u_e1, u_sw2; in vec2 v_uv; out vec4 o;
void main() { ivec2 pc = ivec2(gl_FragCoord.xy); float bn[10], be[10], bc[10]; for (int b = 0; b < 10; b++) { bn[b] = 0.0; be[b] = 0.0; bc[b] = 0.0; } float tot = 0.0;
  for (int ky = 0; ky < u_P; ky++) for (int kx = 0; kx < u_P; kx++) { float h = texelFetch(u_h, pc * u_P + ivec2(kx, ky), 0).x / u_sw2; tot += h; vec2 e = texelFetch(u_eps, ivec2(kx, ky), 0).xy; if (e.y < 0.5) continue; int b = min(9, int(floor(10.0 * (e.x - u_e0) / (u_e1 - u_e0 + 1e-12)))); bn[b] += h; be[b] += e.x; bc[b] += 1.0; }
  float n = 0.0, mx = 0.0, my = 0.0; for (int b = 0; b < 10; b++) if (bc[b] > 0.0 && bn[b] > 0.0) { n += 1.0; mx += be[b] / bc[b]; my += bc[b] / bn[b]; } if (n < 4.0) { o = vec4(-1.0, 0.0, tot, 1.0); return; } mx /= n; my /= n;
  float sxx = 0.0, sxy = 0.0, syy = 0.0; for (int b = 0; b < 10; b++) if (bc[b] > 0.0 && bn[b] > 0.0) { float X = be[b] / bc[b] - mx, Y = bc[b] / bn[b] - my; sxx += X * X; sxy += X * Y; syy += Y * Y; }
  float sl = sxy / max(sxx, 1e-30); o = vec4(sl > 0.0 ? 1.0 / sl : -1.0, sxy / sqrt(max(sxx * syy, 1e-30)), tot, 1.0); }`;
const GLSL_HUS_RENDER = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_fit; uniform int u_NP, u_P, u_G; uniform vec2 u_off; uniform float u_ref; in vec2 v_uv; out vec4 o;
void main() { float dmx = 0.0; for (int j = 0; j < u_NP * u_NP; j++) dmx = max(dmx, texelFetch(u_fit, ivec2(j % u_NP, j / u_NP), 0).z);
  float ref = u_ref; if (ref <= 0.0) { float s = 0.0, c = 0.0; for (int j = 0; j < u_NP * u_NP; j++) { vec4 v = texelFetch(u_fit, ivec2(j % u_NP, j / u_NP), 0); if (v.z >= 0.05 * dmx && v.y >= 0.6 && v.x > 0.0) { s += v.x; c += 1.0; } } ref = c > 0.0 ? s / c : 1.0; }
  vec2 qf = mod(gl_FragCoord.xy - u_off, float(u_G)), uf = (qf - 0.5 * float(u_P)) / float(u_P); ivec2 i0 = ivec2(floor(uf)); vec2 fr = uf - floor(uf);   /* bilinear over the patch centres (u_P = the stride) */
  float sl = 0.0, sw = 0.0, sd = 0.0, sb = 0.0; for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) { ivec2 pi = ((i0 + ivec2(i, j)) % u_NP + u_NP) % u_NP; vec4 v = texelFetch(u_fit, pi, 0); float w = (i == 0 ? 1.0 - fr.x : fr.x) * (j == 0 ? 1.0 - fr.y : fr.y); sd += w * v.z;
    if (v.z >= 0.05 * dmx && v.y >= 0.6 && v.x > 0.0) { sl += w * log2(v.x / ref); sw += w; } else sb += w; }
  if (sd < 0.05 * dmx) { o = vec4(0.08, 0.094, 0.118, 0.55); return; } if (sw < 0.5 * (sw + sb)) { o = vec4(0.43, 0.46, 0.5, 0.6); return; }
  float t = clamp((sl / sw) / 1.5, -1.0, 1.0), w = 1.0 - abs(t); o = t >= 0.0 ? vec4(1.0, (90.0 + 165.0 * w) / 255.0, (90.0 + 165.0 * w) / 255.0, 0.62) : vec4((90.0 + 165.0 * w) / 255.0, (150.0 + 105.0 * w) / 255.0, 1.0, 0.62); }`;
const GLSL_STIR = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G; uniform vec2 u_c; uniform float u_w, u_phi; in vec2 v_uv; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 z = texelFetch(u_x, q, 0).xy, d = vec2(q) - u_c; d -= float(u_G) * floor(d / float(u_G) + 0.5); float a = -u_phi * exp(-dot(d, d) / (u_w * u_w)), c = cos(a), s = sin(a); o = vec4(z.x * c - z.y * s, z.x * s + z.y * c, 0.0, 1.0); }`;
const GLSL_EOS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_lut; uniform int u_G, u_L, u_amp; uniform float u_Imax, u_s; in vec2 v_uv; out vec4 o;
float lut(int i) { return texelFetch(u_lut, ivec2(i % u_G, i / u_G), 0).x; }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 z = texelFetch(u_x, q, 0).xy; float t = clamp(dot(z, z) / u_Imax, 0.0, 1.0) * float(u_L - 1); int i0 = min(int(floor(t)), u_L - 2); float w = t - float(i0), f = mix(lut(i0), lut(i0 + 1), w);
  if (u_amp == 1) { o = vec4(z * exp(clamp(u_s * f, -30.0, 30.0)), 0.0, 1.0); } else { float a = u_s * f, c = cos(a), sn = sin(a); o = vec4(z.x * c - z.y * sn, z.x * sn + z.y * c, 0.0, 1.0); } }`;
const GLSL_LIN_PROJ = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_phi, u_v; uniform int u_P; in vec2 v_uv; out vec4 o;
void main() { int b = int(gl_FragCoord.x), a = int(gl_FragCoord.y); float s = 0.0; for (int p = 0; p < 16384; p++) { if (p >= u_P) break; s += texelFetch(u_phi, ivec2(p, a), 0).x * texelFetch(u_phi, ivec2(p, b), 0).x * texelFetch(u_v, ivec2(p, 0), 0).x; } o = vec4(s, 0.0, 0.0, 1.0); }`;
const GLSL_LIN_W = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_phi, u_k; uniform int u_Mc; in vec2 v_uv; out vec4 o;
void main() { int p = int(gl_FragCoord.x), a = int(gl_FragCoord.y); vec2 s = vec2(0.0); for (int b = 0; b < 4096; b++) { if (b >= u_Mc) break; s += texelFetch(u_k, ivec2(b, a), 0).xy * texelFetch(u_phi, ivec2(p, b), 0).x; } o = vec4(s, 0.0, 1.0); }`;
const GLSL_LIN_DIAG = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_phi, u_w; uniform int u_Mc; in vec2 v_uv; out vec4 o;
void main() { int p = int(gl_FragCoord.x); vec2 s = vec2(0.0); for (int a = 0; a < 4096; a++) { if (a >= u_Mc) break; s += texelFetch(u_phi, ivec2(p, a), 0).x * texelFetch(u_w, ivec2(p, a), 0).xy; } o = vec4(s, 0.0, 1.0); }`;
const GLSL_LIN_SCAT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_phi, u_inv; uniform int u_k2, u_M; in vec2 v_uv; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); float fi = texelFetch(u_inv, q, 0).x; if (fi < 0.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; } int p = int(fi + 0.5);
  float a = texelFetch(u_phi, ivec2(p, u_k2), 0).x, b = u_k2 + 1 < u_M ? texelFetch(u_phi, ivec2(p, u_k2 + 1), 0).x : 0.0; o = vec4(a, b, 0.0, 1.0); }`;
const GLSL_LIN_GATH = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_e, u_pid; uniform int u_k2; in vec2 v_uv; out vec4 o;
void main() { int p = int(gl_FragCoord.x), r = int(gl_FragCoord.y); vec2 c = texelFetch(u_pid, ivec2(p, 0), 0).xy; vec2 z = texelFetch(u_e, ivec2(int(c.x + 0.5), int(c.y + 0.5)), 0).xy; o = vec4(r == u_k2 ? z.x : z.y, 0.0, 0.0, 1.0); }`;
const GLSL_LIN_GRAM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_a, u_b; uniform int u_P; in vec2 v_uv; out vec4 o;
void main() { int b = int(gl_FragCoord.x), a = int(gl_FragCoord.y); vec2 s = vec2(0.0); for (int p = 0; p < 16384; p++) { if (p >= u_P) break; float x = texelFetch(u_a, ivec2(p, a), 0).x; s += x * vec2(texelFetch(u_a, ivec2(p, b), 0).x, texelFetch(u_b, ivec2(p, b), 0).x); } o = vec4(s, 0.0, 1.0); }`;
const GLSL_LIN_ROT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_c, u_g; uniform int u_M; in vec2 v_uv; out vec4 o;
void main() { int p = int(gl_FragCoord.x), k = int(gl_FragCoord.y); float s = 0.0; for (int i = 0; i < 4096; i++) { if (i >= u_M) break; s += texelFetch(u_c, ivec2(k, i), 0).x * texelFetch(u_g, ivec2(p, i), 0).x; } o = vec4(s, 0.0, 0.0, 1.0); }`;
const GLSL_LUT2 = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_l, u_i; uniform int u_nr, u_nd; uniform float u_pm, u_s; in vec2 v_uv; out vec4 o;
float L(int a, int b) { return texelFetch(u_l, ivec2(clamp(b, 0, u_nd - 1), clamp(a, 0, u_nr - 1)), 0).x; }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec2 z = texelFetch(u_x, q, 0).xy; float r = clamp(texelFetch(u_i, q, 0).x, 0.0, float(u_nr - 1)), c = clamp(length(z) / u_pm * float(u_nd - 1), 0.0, float(u_nd - 1));
  int a0 = min(int(floor(r)), u_nr - 2), b0 = min(int(floor(c)), u_nd - 2); float u = r - float(a0), w = c - float(b0); float v = mix(mix(L(a0, b0), L(a0, b0 + 1), w), mix(L(a0 + 1, b0), L(a0 + 1, b0 + 1), w), u);
  o = vec4(z * exp(clamp(u_s * v, -30.0, 30.0)), 0.0, 1.0); }`;
const GLSL_LZ = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G; uniform vec2 u_c; uniform float u_a, u_R; in vec2 v_uv; out vec4 o;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); int G = u_G; vec2 z = texelFetch(u_x, q, 0).xy;
  vec2 xp = texelFetch(u_x, ivec2((q.x + 1) % G, q.y), 0).xy, xm = texelFetch(u_x, ivec2((q.x + G - 1) % G, q.y), 0).xy, yp = texelFetch(u_x, ivec2(q.x, (q.y + 1) % G), 0).xy, ym = texelFetch(u_x, ivec2(q.x, (q.y + G - 1) % G), 0).xy;
  vec2 d = vec2(q) - u_c; d -= float(G) * floor(d / float(G) + 0.5); vec2 dx = 0.5 * (xp - xm), dy = 0.5 * (yp - ym);
  vec2 w = d.x * dy - d.y * dx; float r = length(d), m = u_R > 0.0 ? clamp(1.0 - (r - u_R) / 6.0, 0.0, 1.0) : 1.0; o = vec4(z.x + m * u_a * w.y, z.y - m * u_a * w.x, 0.0, 1.0); }`;
const GLSL_TF_SAMPLE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_row; uniform ivec2 u_p; uniform int u_mode, u_G; in vec2 v_uv; out vec4 o;
void main() { vec2 z = vec2(0.0); if (u_mode == 0) z = texelFetch(u_x, u_p, 0).xy;
  else if (u_mode == 1) { for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) z += texelFetch(u_x, ((u_p + ivec2(i, j)) % u_G + u_G) % u_G, 0).xy; z /= 25.0; }
  else { for (int x = 0; x < u_G; x++) z += texelFetch(u_row, ivec2(x, 0), 0).xy; z /= float(u_G * u_G); }
  o = vec4(z, 0.0, 1.0); }`;
const GLSL_TF_ROWSUM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G; in vec2 v_uv; out vec4 o;
void main() { int x = int(gl_FragCoord.x); vec2 a = vec2(0.0); for (int y = 0; y < u_G; y++) a += texelFetch(u_x, ivec2(x, y), 0).xy; o = vec4(a, 0.0, 1.0); }`;
//   ◌ the vortex overlay: the phase winding of a plaquette (four corners ≥ nmin), one cell per vortex at the display offset; the column counts
const GLSL_VTX_FN = `
float wr(float d) { return d - 6.283185307179586 * floor(d / 6.283185307179586 + 0.5); }
int wind(sampler2D t, ivec2 p, int G, float nmin) { ivec2 q0 = (p % G + G) % G, q1 = ((p + ivec2(1, 0)) % G + G) % G, q2 = ((p + ivec2(1, 1)) % G + G) % G, q3 = ((p + ivec2(0, 1)) % G + G) % G;
  vec2 a = texelFetch(t, q0, 0).xy, b = texelFetch(t, q1, 0).xy, c = texelFetch(t, q2, 0).xy, d = texelFetch(t, q3, 0).xy; if (min(min(dot(a, a), dot(b, b)), min(dot(c, c), dot(d, d))) < nmin) return 0;
  float s = wr(atan(b.y, b.x) - atan(a.y, a.x)) + wr(atan(c.y, c.x) - atan(b.y, b.x)) + wr(atan(d.y, d.x) - atan(c.y, c.x)) + wr(atan(a.y, a.x) - atan(d.y, d.x)); return int(round(s / 6.283185307179586)); }`;
const GLSL_VTX_OVL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_e; uniform int u_G; uniform vec2 u_off; uniform float u_nmin, u_nfl; in vec2 v_uv; out vec4 o;` + GLSL_VTX_FN + `
void main() { ivec2 p = ivec2(floor(gl_FragCoord.xy - u_off)); int w = wind(u_x, p, u_G, u_nmin);   /* (one cell a vortex — the plaquette's own corner: a hot field's thousand defects stay readable) */
  vec2 e = texelFetch(u_e, (p % u_G + u_G) % u_G, 0).xy; float al = dot(e, e) >= u_nfl ? 0.9 : 0.3;   /* (a halo ghost — the envelope below the fluid's floor — dim) */
  o = w > 0 ? vec4(1.0, 0.25, 0.25, al) : w < 0 ? vec4(0.25, 0.85, 1.0, al) : vec4(0.0); }`;
const GLSL_VTX_SUM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_t; uniform int u_G; in vec2 v_uv; out vec4 o;
void main() { vec2 a = vec2(0.0); for (int x = 0; x < u_G; x++) a += texelFetch(u_t, ivec2(x, 0), 0).xy; o = vec4(a, 0.0, 1.0); }`;
const GLSL_VTX_COL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_e; uniform int u_G; uniform float u_nmin, u_nfl; in vec2 v_uv; out vec4 o;` + GLSL_VTX_FN + `
void main() { int x = int(gl_FragCoord.x); float pp = 0.0, mm = 0.0; for (int y = 0; y < u_G; y++) { int v = wind(u_x, ivec2(x, y), u_G, u_nmin); if (v == 0) continue; vec2 e = texelFetch(u_e, ivec2(x, y), 0).xy; if (dot(e, e) < u_nfl) continue; if (v > 0) pp += 1.0; else mm += 1.0; } o = vec4(pp, mm, 0.0, 1.0); }`;
//   ⚛ the ambiguity function: column → the lag s (τ = 2s, 0 at the middle), row → ν (0 at the middle); A = Σ_x f(x, s)·e^{iνx}
const GLSL_AMB = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_f; uniform int u_G, u_Q; in vec2 v_uv; out vec4 o;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int s = int(floor(float(c.x) * float(u_Q) / float(u_G))) - u_Q / 2, j = ((s % u_Q) + u_Q) % u_Q; float nu = 6.283185307179586 * float(c.y - u_G / 2) / float(u_G); vec2 a = vec2(0.0);
  for (int x = 0; x < u_G; x++) { vec2 f = texelFetch(u_f, ivec2(x, j), 0).xy; float th = nu * float(x); a += vec2(f.x * cos(th) - f.y * sin(th), f.x * sin(th) + f.y * cos(th)); } o = vec4(a, 0.0, 1.0); }`;
const GLSL_SPACE_MAXROW = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_t; uniform int u_G, u_mode; in vec2 v_uv; out vec4 o;
void main() { int x = int(gl_FragCoord.x); float m = 0.0; for (int y = 0; y < u_G; y++) { vec2 z = texelFetch(u_t, ivec2(x, y), 0).xy; float v = (u_mode == 0 || u_mode == 3) ? dot(z, z) : abs(z.x); m = max(m, v); } o = vec4(m, 0.0, 0.0, 1.0); }`;
const GLSL_SPACE_MAXCOL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_t; uniform int u_G; in vec2 v_uv; out vec4 o;
void main() { float m = 0.0; for (int x = 0; x < u_G; x++) m = max(m, texelFetch(u_t, ivec2(x, 0), 0).x); o = vec4(m, 0.0, 0.0, 1.0); }`;
const GLSL_SPACE_RENDER = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_t, u_mx; uniform int u_G, u_Q, u_mode; in vec2 v_uv; out vec4 o;
vec3 heat(float l) { return vec3(clamp(1.6 * l, 0.0, 1.0), clamp(1.6 * l - 0.35, 0.0, 1.0), clamp(2.2 * l - 1.2, 0.0, 1.0)); }
void main() { float m = max(texelFetch(u_mx, ivec2(0), 0).x, 1e-30); ivec2 c = ivec2(gl_FragCoord.xy);
  if (u_mode == 3) { vec2 z = texelFetch(u_t, c, 0).xy; float v = dot(z, z), l = v > 0.0 ? clamp(1.0 + log(v / m) / (4.0 * log(10.0)), 0.0, 1.0) : 0.0; o = vec4(heat(l), 1.0); return; }   /* (A(τ, ν): already centred) */
  if (u_mode != 1) { ivec2 q = (c + u_G / 2) % u_G; vec2 z = texelFetch(u_t, q, 0).xy; float v = u_mode == 0 ? dot(z, z) : z.x; float l = v > 0.0 ? clamp(1.0 + log(v / m) / (4.0 * log(10.0)), 0.0, 1.0) : 0.0; o = vec4(heat(l), 1.0); return; }
  int mm = int(float(c.y) * float(u_Q) / float(u_G)); float v = texelFetch(u_t, ivec2(c.x, mm), 0).x / m, a = sqrt(abs(v));
  o = v >= 0.0 ? vec4(min(1.0, 1.5 * a), clamp(1.5 * a - 0.4, 0.0, 1.0), 0.16 * a, 1.0) : vec4(0.12 * a, 0.63 * a, min(1.0, 1.6 * a), 1.0); }`;
const GLSL_SPEC_COPY = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; in vec2 v_uv; out vec4 fragColor;
void main() { fragColor = vec4(texelFetch(u_x, ivec2(gl_FragCoord.xy), 0).xy, 0.0, 1.0); }`;

// ◐ THE APP's HOLO VIEW ON THE GPU (2026-10-18, user: "port the ◐ views to the GPU"): display-only passes on an eye slot of its own.
//    GLSL_VIEW_GATE — the eye's stops in k (the lattice's signed modes, as eye-lens gated): the res disk (keep |q|² < r2), beam stops (bs, bsr2,
//    the torus distance), the ⇠back half-plane (hp.z on: cut q·n ≥ 0). GLSL_HOLO_VIEW — the plate at the slot: H = |P + R|² (mode 0 → (√H, 0))
//    or the illuminated plate U = (H − z1·A² − z2·|P|²)·R/A² (mode 1), R = A·e^{i(∠0 + 2π(mx·x + my·y)/G)}, A = Aq·√(E/N), E = Σ|P|² reduced on
//    the GPU (sampled, never read back) — the CPU's _holoField, cell for cell.
const GLSL_VIEW_GATE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G; uniform float u_r2; uniform int u_nb; uniform vec2 u_bs[8]; uniform float u_bsr2; uniform vec3 u_hp; uniform int u_kcm; uniform float u_kc2;
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int H2 = u_G / 2; float px = float(c.x <= H2 ? c.x : c.x - u_G), py = float(c.y <= H2 ? c.y : c.y - u_G), g = float(u_G), h = float(H2), d2 = px * px + py * py;
  bool cut = (u_r2 > 0.0 && d2 >= u_r2) || (u_kcm == 1 && d2 > u_kc2) || (u_kcm == 2 && d2 <= u_kc2);   // (kcm: eye-lens gated's spectral cut — 1 keep ≤, 2 keep >)
  for (int k = 0; k < 8; k++) { if (k >= u_nb) break; vec2 d = vec2(px, py) - u_bs[k]; d = mod(d + h, g) - h; if (dot(d, d) < u_bsr2) cut = true; }
  if (u_hp.z > 0.5 && px * u_hp.x + py * u_hp.y >= 0.0) cut = true;
  fragColor = vec4(cut ? vec2(0.0) : texelFetch(u_x, c, 0).xy, 0.0, 1.0); }`;
const GLSL_HOLO_VIEW = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_e, u_tw, u_tr, u_hm; uniform int u_G, u_mode, u_th, u_hasHm; uniform float u_Aq, u_mx, u_my, u_ang0, u_z1, u_z2;
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 P = texelFetch(u_x, c, 0).xy; float g = float(u_G), A = u_Aq * sqrt(max(texelFetch(u_e, ivec2(0, 0), 0).x, 0.0) / (g * g));
  float ph = u_ang0 + 6.283185307179586 * (u_mx * float(c.x) + u_my * float(c.y)) / g, pw = u_th == 1 ? texelFetch(u_tw, c, 0).x : 0.0, pr = u_th == 1 ? texelFetch(u_tr, c, 0).x : 0.0;   // (θ key: the writer's / reader's phase screens)
  vec2 R = A * vec2(cos(ph + pw), sin(ph + pw)), Q = A * vec2(cos(ph + pr), sin(ph + pr)), S = P + R; float h = dot(S, S);
  if (u_hasHm == 1) h *= texelFetch(u_hm, c, 0).x;   // (the eye's hand on the plate: H × its amplitude mask)
  if (u_mode == 0) { fragColor = vec4(sqrt(h), 0.0, 0.0, 1.0); return; }
  float hz = h - u_z1 * A * A - u_z2 * dot(P, P); fragColor = vec4(hz * Q / max(A * A, 1e-30), 0.0, 1.0); }`;
const GLSL_VIEW_MUL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_m, u_n; uniform int u_hasM, u_hasN; uniform float u_qL, u_amix;
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 z = texelFetch(u_x, c, 0).xy, s = z; float a = length(z) + 1e-4;
  if (u_qL > 0.0) { float st = 6.283185307179586 / u_qL, th = floor(atan(s.y, s.x) / st + 0.5) * st, rr = length(s); s = rr * vec2(cos(th), sin(th)); }
  if (u_amix > 0.0) { float rr = length(s); s.x += (rr - s.x) * u_amix; s.y *= 1.0 - u_amix; }
  vec2 m = u_hasM == 1 ? texelFetch(u_m, c, 0).xy : vec2(1.0, 0.0), o = vec2(m.x * s.x - m.y * s.y, m.x * s.y + m.y * s.x);
  if (u_hasN == 1) o += a * texelFetch(u_n, c, 0).xy;
  fragColor = vec4(o, 0.0, 1.0); }`;
const GLSL_VIEW_RELABEL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_cj, u_pol; uniform float u_c2, u_s2;
out vec4 fragColor;
void main() { vec2 z = texelFetch(u_x, ivec2(gl_FragCoord.xy), 0).xy; if (u_cj == 1) z.y = -z.y;
  if (u_pol == 1) z = vec2(0.5 * (z.x + u_c2 * z.x + u_s2 * z.y), 0.5 * (z.y + u_s2 * z.x - u_c2 * z.y));
  fragColor = vec4(z, 0.0, 1.0); }`;
//    ◐ the view's NUMBERS on the GPU (2026-10-19): Σ (Re a·b̄, Im a·b̄, |a|², |b|²) over two eye slots — per row, then the column (fixed loop
//    orders: deterministic per device) — read back as ONE texel without a stall (PBO + fence). Parseval: the same ratios as the k-space sums.
const GLSL_VDOT_ROWS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_a, u_b; uniform int u_G; out vec4 fragColor;
void main() { int y = int(gl_FragCoord.y); vec4 s = vec4(0.0);
  for (int x = 0; x < u_G; x++) { vec2 a = texelFetch(u_a, ivec2(x, y), 0).xy, b = texelFetch(u_b, ivec2(x, y), 0).xy; s += vec4(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y, dot(a, a), dot(b, b)); }
  fragColor = s; }`;
const GLSL_VDOT_COL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_r; uniform int u_G; out vec4 fragColor;
void main() { vec4 s = vec4(0.0); for (int y = 0; y < u_G; y++) s += texelFetch(u_r, ivec2(0, y), 0); fragColor = s; }`;
//    ◐ the view's TIMBRE on the GPU (2026-10-19): the spectrum's power per synth section — shell b of nb (|q + k| / π) × sector (±x, ±y: the larger
//    component, ties → horizontal) — the app's _synSecK, cell for cell; rows (bin, y) then the column, one row of nb·ns values read without a stall
const GLSL_VBIN_ROWS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G, u_nb, u_ns; uniform vec2 u_k; out vec4 fragColor;
void main() { int bi = int(gl_FragCoord.x), y = int(gl_FragCoord.y), H2 = u_G / 2; float g = float(u_G), s = 0.0, P = 3.141592653589793;
  float sy = float(y <= H2 ? y : y - u_G), qy = sy * 2.0 * P / g + u_k.y; qy = qy > P ? qy - 2.0 * P : (qy < -P ? qy + 2.0 * P : qy);
  for (int x = 0; x < u_G; x++) { float sx = float(x <= H2 ? x : x - u_G), qx = sx * 2.0 * P / g + u_k.x; qx = qx > P ? qx - 2.0 * P : (qx < -P ? qx + 2.0 * P : qx);
    float k = sqrt(qx * qx + qy * qy); if (k > P) continue; int b = min(u_nb - 1, int(floor(k / P * float(u_nb) + 1e-9)));
    int sec = abs(qx) >= abs(qy) ? (qx >= 0.0 ? 0 : 2) : (qy >= 0.0 ? 1 : 3); if (b * u_ns + sec != bi) continue;
    vec2 z = texelFetch(u_x, ivec2(x, y), 0).xy; s += dot(z, z); }
  fragColor = vec4(s, 0.0, 0.0, 1.0); }`;
const GLSL_VBIN_COL = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_r; uniform int u_G; out vec4 fragColor;
void main() { int bi = int(gl_FragCoord.x); float s = 0.0; for (int y = 0; y < u_G; y++) s += texelFetch(u_r, ivec2(bi, y), 0).x; fragColor = vec4(s, 0.0, 0.0, 1.0); }`;
const GLSL_VIEW_AFFINE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G, u_mA; uniform vec4 u_Ai; uniform vec2 u_t, u_k; uniform float u_ph, u_gn; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); float c0 = (float(u_G) - 1.0) / 2.0; vec2 xi = vec2(c) - c0, s = vec2(0.0);
  if (u_mA == 1) { vec2 u = xi - u_t, sp = vec2(u_Ai.x * u.x + u_Ai.y * u.y, u_Ai.z * u.x + u_Ai.w * u.y) + c0; ivec2 p0 = ivec2(floor(sp)); vec2 f = sp - floor(sp);
    for (int dy = 0; dy <= 1; dy++) for (int dx = 0; dx <= 1; dx++) { ivec2 q = p0 + ivec2(dx, dy); if (q.x < 0 || q.y < 0 || q.x >= u_G || q.y >= u_G) continue;
      float w = (dx == 1 ? f.x : 1.0 - f.x) * (dy == 1 ? f.y : 1.0 - f.y); s += w * texelFetch(u_x, q, 0).xy; } }
  else s = texelFetch(u_x, c, 0).xy;
  float th = u_ph + dot(u_k, xi); vec2 e = u_gn * vec2(cos(th), sin(th)); fragColor = vec4(s.x * e.x - s.y * e.y, s.x * e.y + s.y * e.x, 0.0, 1.0); }`;
//    ▭ the BOX LENS (eye-lens applyBox) on the GPU: the box's sine transform (DST-I, its own inverse) along one axis — mode 0 forward × the
//    mode's phase (a W-texel table, its angle reduced mod 2π in f64 on the host: ct·k² reaches ~10⁵ rad), mode 1 back; zero outside the box
const GLSL_VIEW_BOX = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_S, u_P; uniform int u_W, u_a, u_axis, u_mode; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int n = (u_axis == 0 ? c.x : c.y) - u_a, o = (u_axis == 0 ? c.y : c.x) - u_a;
  if (n < 0 || n >= u_W || o < 0 || o >= u_W) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 s = vec2(0.0); for (int u = 0; u < u_W; u++) { float w = u_mode == 0 ? texelFetch(u_S, ivec2(u, n), 0).x : texelFetch(u_S, ivec2(n, u), 0).x; ivec2 q = u_axis == 0 ? ivec2(u_a + u, c.y) : ivec2(c.x, u_a + u); s += w * texelFetch(u_x, q, 0).xy; }
  if (u_mode == 0) { vec2 p = texelFetch(u_P, ivec2(n, 0), 0).xy; s = vec2(s.x * p.x - s.y * p.y, s.x * p.y + s.y * p.x); }
  fragColor = vec4(s, 0.0, 1.0); }`;
//    ⊛ RECOGNITION (eye-lens correlate / correlateBank) on the GPU: out(x) = Σ_j ψ(x + d_j)·conj(w_j) − conj(μ)·Σ_box ψ (the zero-mean term, a
//    separable box sum on the torus); the bank: √Σ_r |c_r|²·(e0 / e_r) (each scale at the input's energy, the energies GPU sums SAMPLED, no readback)
const GLSL_VIEW_BOXSUM = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G, u_axis, u_lo, u_hi; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 s = vec2(0.0); for (int d = u_lo; d <= u_hi; d++) { ivec2 q = u_axis == 0 ? ivec2(((c.x + d) % u_G + u_G) % u_G, c.y) : ivec2(c.x, ((c.y + d) % u_G + u_G) % u_G); s += texelFetch(u_x, q, 0).xy; }
  fragColor = vec4(s, 0.0, 1.0); }`;
const GLSL_VIEW_CORR = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_tp, u_bx; uniform int u_G, u_K, u_hasBox; uniform vec2 u_mu; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 o = vec2(0.0);
  for (int j = 0; j < u_K; j++) { vec4 t = texelFetch(u_tp, ivec2(j, 0), 0); ivec2 q = ivec2(((c.x + int(t.x)) % u_G + u_G) % u_G, ((c.y + int(t.y)) % u_G + u_G) % u_G); vec2 z = texelFetch(u_x, q, 0).xy;
    o += vec2(z.x * t.z + z.y * t.w, z.y * t.z - z.x * t.w); }
  if (u_hasBox == 1) { vec2 b = texelFetch(u_bx, c, 0).xy; o -= vec2(b.x * u_mu.x + b.y * u_mu.y, b.y * u_mu.x - b.x * u_mu.y); }
  fragColor = vec4(o, 0.0, 1.0); }`;
const GLSL_VIEW_BANKACC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_acc, u_c, u_e0, u_er; uniform int u_first; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 z = texelFetch(u_c, c, 0).xy; float er = texelFetch(u_er, ivec2(0, 0), 0).x, e0 = texelFetch(u_e0, ivec2(0, 0), 0).x;
  float a = (u_first == 1 ? 0.0 : texelFetch(u_acc, c, 0).x) + (er > 0.0 ? dot(z, z) * e0 / er : 0.0); fragColor = vec4(a, 0.0, 0.0, 1.0); }`;
const GLSL_VIEW_SQRT = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_a; out vec4 fragColor;
void main() { fragColor = vec4(sqrt(max(texelFetch(u_a, ivec2(gl_FragCoord.xy), 0).x, 0.0)), 0.0, 0.0, 1.0); }`;
//    ⟲ THE EYE's CAVITY (eye-lens cavityStep — the live fold, one round trip per read) on the GPU: hutchSum's lattice pass (the pupil stop; per
//    group of maps sharing a linear part: the aperture cut _naCut (separable taps) when shrunk, the linear map (lensU1, as viewAffine), the sum of
//    its whole-cell rolls; the energy kept — or the apertures' share when cut), the travel, D = ψ + κ·W(D), shown at the input's energy
const GLSL_VIEW_CONV = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_h; uniform int u_G, u_M, u_axis; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 s = vec2(0.0); for (int j = 0; j <= 2 * u_M; j++) { int d = j - u_M; ivec2 q = u_axis == 0 ? ivec2(((c.x + d) % u_G + u_G) % u_G, c.y) : ivec2(c.x, ((c.y + d) % u_G + u_G) % u_G);
    s += texelFetch(u_h, ivec2(j, 0), 0).x * texelFetch(u_x, q, 0).xy; } fragColor = vec4(s, 0.0, 1.0); }`;
const GLSL_VIEW_ROLLS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_o, u_acc; uniform int u_G, u_n, u_first; uniform ivec2 u_t[16]; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 s = u_first == 1 ? vec2(0.0) : texelFetch(u_acc, c, 0).xy;
  for (int j = 0; j < 16; j++) { if (j >= u_n) break; ivec2 q = ((c - u_t[j]) % u_G + u_G) % u_G; s += texelFetch(u_o, q, 0).xy; } fragColor = vec4(s, 0.0, 1.0); }`;
const GLSL_VIEW_ESCALE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_n, u_d; out vec4 fragColor;
void main() { float n = texelFetch(u_n, ivec2(0, 0), 0).x, d = texelFetch(u_d, ivec2(0, 0), 0).x; fragColor = vec4(texelFetch(u_x, ivec2(gl_FragCoord.xy), 0).xy * (d > 0.0 ? sqrt(n / d) : 0.0), 0.0, 1.0); }`;
const GLSL_SCAL_MAD = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_acc, u_e; uniform float u_w; uniform int u_first; out vec4 fragColor;
void main() { fragColor = vec4((u_first == 1 ? 0.0 : texelFetch(u_acc, ivec2(0, 0), 0).x) + u_w * texelFetch(u_e, ivec2(0, 0), 0).x, 0.0, 0.0, 1.0); }`;
//    ◉ THE EYE's PERCEPTION (the app's _perceive) — its own hologram of the light, read with its shaped reference: A = Aq·√(e/N) (e the light's
//    energy kept on entry), U = (|p + A·R0·e^{iφ}|² − A² − |p|²)·w·Rp·e^{iφ} / A, w = the ⊛ attention |c| / max|c| (or 1)
const GLSL_PERCEIVE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_e, u_r0, u_rp, u_att, u_pk; uniform int u_G, u_hasAtt, u_nat; uniform float u_Aq, u_ph; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 p = texelFetch(u_x, c, 0).xy; float g = float(u_G), A = u_Aq * sqrt(max(texelFetch(u_e, ivec2(0, 0), 0).x, 0.0) / (g * g));
  vec2 e = vec2(cos(u_ph), sin(u_ph)), r0 = texelFetch(u_r0, c, 0).xy, rp = texelFetch(u_rp, c, 0).xy; r0 = A * vec2(r0.x * e.x - r0.y * e.y, r0.x * e.y + r0.y * e.x);
  vec2 s = p + r0; float hz = dot(s, s) - (u_nat == 1 ? 0.0 : A * A + dot(p, p)), w = 1.0;   // u_nat: the whole |ψ + R|² (the pupil separates the orders)
  if (u_hasAtt == 1) { float pk = texelFetch(u_pk, ivec2(0, 0), 0).x; w = pk > 0.0 ? length(texelFetch(u_att, c, 0).xy) / sqrt(pk) : 0.0; }
  vec2 b = w * vec2(rp.x * e.x - rp.y * e.y, rp.x * e.y + rp.y * e.x); fragColor = vec4(hz * b / max(A, 1e-30), 0.0, 1.0); }`;
const GLSL_VIEW_SHEAR = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_K; uniform int u_G, u_axis; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int l = u_axis == 0 ? c.y : c.x, u = u_axis == 0 ? c.x : c.y; vec2 acc = vec2(0.0);
  for (int n = 0; n < 2048; n++) { if (n >= u_G) break; int v = (u - n + u_G) % u_G; vec2 p = texelFetch(u_x, u_axis == 0 ? ivec2(v, l) : ivec2(l, v), 0).xy, k = texelFetch(u_K, ivec2(n, l), 0).xy;
    acc += vec2(p.x * k.x - p.y * k.y, p.x * k.y + p.y * k.x); }
  fragColor = vec4(acc, 0.0, 1.0); }`;
const GLSL_VIEW_LIN = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x, u_b; uniform float u_ca, u_cb; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); fragColor = vec4(u_ca * texelFetch(u_x, c, 0).xy + u_cb * texelFetch(u_b, c, 0).xy, 0.0, 1.0); }`;
const GLSL_QUAT_M2 = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_a, u_b; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 a = texelFetch(u_a, c, 0).xy, b = texelFetch(u_b, c, 0).xy; fragColor = vec4(sqrt(dot(a, a) + dot(b, b)), 0.0, 0.0, 1.0); }`;
const GLSL_QUAT_RENDER = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_a, u_b, u_pk; uniform float u_gain; out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec2 a = texelFetch(u_a, c, 0).xy, b = texelFetch(u_b, c, 0).xy; float m2 = dot(a, a) + dot(b, b), pk = max(texelFetch(u_pk, ivec2(0, 0), 0).x * u_gain, 1e-12);
  float mag = min(1.0, sqrt(m2 / pk) * 1.4), g = pow(mag, 0.8); vec3 n = vec3(0.0);
  if (m2 > 0.0) n = vec3(2.0 * (a.x * b.x + a.y * b.y), 2.0 * (a.y * b.x - a.x * b.y), dot(a, a) - dot(b, b)) / m2;
  fragColor = vec4(g * (0.15 + 0.85 * (1.0 + n) / 2.0), 1.0); }`;
//    GLSL_MED_GATHER — ◐medium's analyser in k: the order about 2k_R brought to the baseband and conjugated, est̂(q) = conj(F̂(b2 − q)) on the disk
//    |q|² < r2 (the torus's signed modes), 0 elsewhere — the CPU's _holoMedium gather, cell for cell
const GLSL_MED_GATHER = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_x; uniform int u_G; uniform ivec2 u_b2; uniform float u_r2;
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); int H2 = u_G / 2, qx = c.x <= H2 ? c.x : c.x - u_G, qy = c.y <= H2 ? c.y : c.y - u_G;
  if (float(qx * qx + qy * qy) >= u_r2) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 z = texelFetch(u_x, ivec2(((u_b2.x - qx) % u_G + 2 * u_G) % u_G, ((u_b2.y - qy) % u_G + 2 * u_G) % u_G), 0).xy; fragColor = vec4(z.x, -z.y, 0.0, 1.0); }`;

const GLSL_RENDER_DESC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_base;
uniform int   u_G;
uniform vec2  u_off;      // translation (cells): sample the envelope at x − off (torus wrap)
uniform vec2  u_center;   // wave-packet center (px) — the k-phasor reference point
uniform vec2  u_k;        // momentum phase tilt (rad/cell) — the linOp k·x term
uniform float u_phi;      // global register phase (φ + ω·frac, from the CPU f64 model)
uniform float u_smoothMax;   // CPU-supplied peak (legacy path, still used when no film is bound)
uniform sampler2D u_peakTex; // GPU-reduced peak (1x1) — texture-direct path; SAMPLED, never read back
uniform int   u_usePeakTex;  // 1 = take the normalizer from u_peakTex instead of u_smoothMax
uniform float u_peakGain;    // display gain applied to the sampled peak (the legacy path's _GLOW factor)
uniform int   u_ampView;  // 0 = phase colormap (hue = arg ψ — motion visible), 1 = amplitude hologram colormap (same convention as the field view; global phase honestly invisible)
uniform float u_phaseFloor;  // phase view: brightness FLOOR (0 = fade low-amp to black [default, other callers]; >0 = a constant floor so the WHOLE field's phase stays visible, like the CPU hsl 0.12 floor)
uniform int   u_spec;        // ◈ 1 = the SPECTRAL view (the app's): chromaticity from the cell's own frequency (u_specTex), brightness = the amp curve. 0 (default) = unchanged
uniform sampler2D u_specTex; // (S.re, S.im, E, dt): the cell's lag-one correlation ⟨ψ_t·ψ̄_{t−1}·ḡ₀⟩, energy ⟨|ψ|²⟩, mean step dt (IFSGpu.specAccum)
uniform sampler2D u_bank0, u_bank1, u_bank2, u_bank3;   // ◈ bank mode (u_spec 2): 8 tuned resonators' complex outputs, two per texel
uniform vec3  u_bankXYZ[8]; uniform float u_specVg;   // ◈ vis × (a declared display gain on the visible share)
  // each resonator's band through the CIE observer (its λ band's integrated x̄ ȳ z̄)
uniform vec4  u_specMap;     // the DECLARED observer scale: x centre ω, y span (ω = centre ∓ span → 750 / 380 nm), z the narrowest line drawn (nm), w 1 = EXPOSURE: brightness from the window's ⟨|ψ|²⟩ (the eye's integrated power), not the instant |ψ| (0, default: unchanged)
in vec2 v_uv;
out vec4 fragColor;
${GLSL_HOLOGRAM_COLORMAP}
${GLSL_SPECTRAL_OBSERVER}
vec2 sampleTorus(vec2 p) {
  vec2  f  = fract(p);
  ivec2 i0 = ivec2(floor(p)), G2 = ivec2(u_G);
  ivec2 a  = ((i0 % G2) + G2) % G2;
  ivec2 b  = (((i0 + 1) % G2) + G2) % G2;
  vec2 b00 = texelFetch(u_base, ivec2(a.x, a.y), 0).xy;
  vec2 b10 = texelFetch(u_base, ivec2(b.x, a.y), 0).xy;
  vec2 b01 = texelFetch(u_base, ivec2(a.x, b.y), 0).xy;
  vec2 b11 = texelFetch(u_base, ivec2(b.x, b.y), 0).xy;
  return mix(mix(b00, b10, f.x), mix(b01, b11, f.x), f.y);
}
void main() {
  vec2  x   = gl_FragCoord.xy - 0.5;
  vec2  B   = sampleTorus(x - u_off);
  float th  = u_phi + dot(u_k, x - u_center);
  float c   = cos(th), s = sin(th);
  vec2  psi = vec2(B.x*c - B.y*s, B.x*s + B.y*c);
  // u_peakGain carries the SAME multiplier the legacy path folded into smoothMax (_descPeak * _GLOW) — without it
  // the film normalizes by the raw peak and the picture comes out _GLOW times too bright.
  float pk   = (u_usePeakTex == 1) ? (texelFetch(u_peakTex, ivec2(0, 0), 0).x * u_peakGain) : u_smoothMax;
  float norm = 1.0 / sqrt(max(pk, 1e-18));
  float amp  = sqrt(psi.x*psi.x + psi.y*psi.y) * norm;
  if (u_spec == 1) { ivec2 G2 = ivec2(u_G), q = ((ivec2(floor(x - u_off + 0.5)) % G2) + G2) % G2; vec4 A = texelFetch(u_specTex, q, 0); if (u_specMap.w > 0.5) amp = sqrt(max(A.z, 0.0)) * norm;
    fragColor = vec4(spectralColor(A, u_specMap, u_specVg * log(1.0 + 99.0 * amp) / log(100.0)), 1.0); return; }
  if (u_spec == 5) { ivec2 G2 = ivec2(u_G), q = ((ivec2(floor(x - u_off + 0.5)) % G2) + G2) % G2; vec4 C = texelFetch(u_bank0, q, 0); float g = clamp(length(C.yz) / max(C.x, 1e-30), 0.0, 1.0);   // ◈ g: the light's temporal coherence |g(τ)|
    vec3 col = g < 0.5 ? mix(vec3(0.85, 0.15, 0.10), vec3(0.95, 0.80, 0.20), g * 2.0) : mix(vec3(0.95, 0.80, 0.20), vec3(0.20, 0.85, 1.00), g * 2.0 - 1.0);   // incoherent red → yellow → coherent cyan
    fragColor = vec4(col * (log(1.0 + 99.0 * amp) / log(100.0)), 1.0); return; }
  if (u_spec == 4) { ivec2 G2 = ivec2(u_G), q = ((ivec2(floor(x - u_off + 0.5)) % G2) + G2) % G2; float E = texelFetch(u_specTex, q, 0).z; if (u_specMap.w > 0.5) amp = sqrt(max(E, 0.0)) * norm;   // ◈ FT spectrometer: its accumulated (X, Y, Z, P)
    vec4 F = texelFetch(u_bank0, q, 0); fragColor = vec4(bankColor(max(F.xyz, vec3(0.0)), u_specVg * F.w, E, log(1.0 + 99.0 * amp) / log(100.0)), 1.0); return; }
  if (u_spec == 2) { ivec2 G2 = ivec2(u_G), q = ((ivec2(floor(x - u_off + 0.5)) % G2) + G2) % G2; if (u_specMap.w > 0.5) amp = sqrt(max(texelFetch(u_specTex, q, 0).z, 0.0)) * norm; vec4 b[4]; b[0] = texelFetch(u_bank0, q, 0); b[1] = texelFetch(u_bank1, q, 0); b[2] = texelFetch(u_bank2, q, 0); b[3] = texelFetch(u_bank3, q, 0);
    vec3 XYZ = vec3(0.0); float P = 0.0; for (int m = 0; m < 4; m++) { float p0 = dot(b[m].xy, b[m].xy), p1 = dot(b[m].zw, b[m].zw); XYZ += p0 * u_bankXYZ[2 * m] + p1 * u_bankXYZ[2 * m + 1]; P += p0 + p1; }
    fragColor = vec4(bankColor(XYZ, u_specVg * P, texelFetch(u_specTex, q, 0).z, log(1.0 + 99.0 * amp) / log(100.0)), 1.0); return; }
  if (u_spec == 3) { ivec2 G2 = ivec2(u_G), q = ((ivec2(floor(x - u_off + 0.5)) % G2) + G2) % G2; vec4 A = texelFetch(u_specTex, q, 0); amp = sqrt(max(A.z, 0.0)) * norm;   // ◈ bank under ⧗: the exposed powers (u_bank0 = m 0–3, u_bank1 = m 4–7)
    vec4 p0 = texelFetch(u_bank0, q, 0), p1 = texelFetch(u_bank1, q, 0); vec3 XYZ = vec3(0.0); float P = 0.0;
    for (int m = 0; m < 4; m++) { XYZ += p0[m] * u_bankXYZ[m] + p1[m] * u_bankXYZ[4 + m]; P += p0[m] + p1[m]; }
    fragColor = vec4(bankColor(XYZ, u_specVg * P, A.z, log(1.0 + 99.0 * amp) / log(100.0)), 1.0); return; }
  if (u_ampView == 1) {   // AMPLITUDE view — identical arithmetic to GLSL_RENDER_FIELD (the field view's colormap)
    float lva = log(1.0 + 99.0 * amp) / log(100.0);
    fragColor = vec4(hologramColor(lva), 1.0);
    return;
  }
  float hue  = (atan(psi.y, psi.x) / (2.0 * 3.14159265) + 1.0);
  hue = hue - floor(hue);
  if (u_phaseFloor > 0.0) {
    // CPU-MATCH phase colormap: HSL with lightness = floor + mag·0.48, saturation 0.70 (the _paintCPU hsl2rgb
    //   formula). mag uses a gentle log lift of the peak-normalized amp so the whole field's phase reads like
    //   the CPU (which maps raw |ψ| with a 0.12 floor). This keeps the background visibly coloured, not black.
    float mag = clamp(log(1.0 + 12.0 * amp) / log(13.0), 0.0, 1.0);
    float L = u_phaseFloor + mag * 0.48;   // CPU: 0.12 + mag·0.48
    float S = 0.70;
    // HSL → RGB (matches hsl2rgb in the app)
    float a = S * min(L, 1.0 - L);
    vec3 rgb;
    for (int ch = 0; ch < 3; ch++) {
      float n = (ch == 0) ? 0.0 : (ch == 1) ? 8.0 : 4.0;
      float k = mod(n + hue * 12.0, 12.0);
      rgb[ch] = L - a * clamp(min(k - 3.0, min(9.0 - k, 1.0)), -1.0, 1.0);
    }
    fragColor = vec4(rgb, 1.0);
    return;
  }
  float v  = clamp(log(1.0 + 6.0 * amp) / log(7.0), 0.0, 1.0);
  float h6 = hue * 6.0;
  float hi = floor(h6);
  float f  = h6 - hi;
  float q  = v * (1.0 - f);
  float t0 = v * f;
  int  sec = int(mod(hi, 6.0));
  vec3 rgb;
  if      (sec == 0) rgb = vec3(v,  t0, 0.0);
  else if (sec == 1) rgb = vec3(q,  v,  0.0);
  else if (sec == 2) rgb = vec3(0.0,v,  t0);
  else if (sec == 3) rgb = vec3(0.0,q,  v);
  else if (sec == 4) rgb = vec3(t0, 0.0,v);
  else               rgb = vec3(v,  0.0,q);
  float fade = smoothstep(0.004, 0.03, amp);   // legacy fade-to-black (floor=0 callers)
  fragColor = vec4(rgb * fade, 1.0);
}`;

// Render plate (RECORD mode) or psi amplitude (RECON mode).
// dir=1: show plate with hologram colormap; dir=-1: show |ψ|² amplitude.
const GLSL_RENDER_PLATE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform sampler2D u_plate;
uniform float     u_smoothMaxPlate;
uniform float     u_smoothMaxField;
uniform int       u_dir;
in vec2 v_uv;
out vec4 fragColor;
${GLSL_HOLOGRAM_COLORMAP}
void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  float rv;
  if (u_dir == 1) {
    float pl   = texelFetch(u_plate, coord, 0).x;
    float norm = 1.0 / sqrt(max(u_smoothMaxPlate, 1e-18));
    rv = sqrt(pl) * norm;
  } else {
    vec2  psi  = texelFetch(u_psi, coord, 0).xy;
    float norm = 1.0 / sqrt(max(u_smoothMaxField, 1e-18));
    rv = sqrt(psi.x*psi.x + psi.y*psi.y) * norm;
  }
  float lv  = log(1.0 + 99.0 * rv) / log(100.0);
  fragColor = vec4(hologramColor(lv), 1.0);
}`;
