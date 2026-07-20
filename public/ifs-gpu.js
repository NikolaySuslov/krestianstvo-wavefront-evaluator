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

export class IFSGpu {

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
    this._progRotCenters  = this._compileStep(GLSL_ROTATE_CENTERS); // §7.92 θ-operator: rotate ψ about each main
    this._progAffineCenters = this._compileStep(GLSL_AFFINE_CENTERS); // §7.98 general metric op: affine ψ about each main
    this._progIfsWarp     = this._compileStep(GLSL_IFS_WARP);       // full K-map IFS Hutchinson union (one GPU pass, no readbacks)
    this._progLensGenome  = this._compileStep(GLSL_LENS_GENOME);   // §7.98 genome lens phase-plate (optical chip, 1 GPU pass)
    this._progCopy        = this._compileStep(GLSL_COPY);
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
    this._progEyeSuperpose    = this._compileStep(GLSL_EYE_SUPERPOSE);      // coevolve: ψ_eye += β·obj (GPU)
    this._progEyeContract     = this._compileStep(GLSL_EYE_CONTRACT);       // full-authority hold: ψ ← (1−λ)ψ + λ·obj (contraction, GPU)
    this._progEyeScale        = this._compileStep(GLSL_EYE_SCALE);          // coevolve: ψ *= s (energy-cap scale, GPU)
    this._progEyeCapScale     = this._compileStep(GLSL_EYE_CAP_SCALE);      // the NO-SYNC cap (reduce texture sampled in-shader — zero readback)
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
      step1:  { psi: ul(this._progStep1, 'u_psi'), rings: ul(this._progStep1, 'u_rings'), dt: ul(this._progStep1, 'u_dt'), G: ul(this._progStep1, 'u_G'), nRings: ul(this._progStep1, 'u_nRings'), ringCount: ul(this._progStep1, 'u_ringCount'), ringMeta: ul(this._progStep1, 'u_ringMeta') },
      cgle:   { psi: ul(this._progCgleStep,'u_psi'), rings: ul(this._progCgleStep,'u_rings'), G: ul(this._progCgleStep,'u_G'), nRings: ul(this._progCgleStep,'u_nRings'), ringCount: ul(this._progCgleStep,'u_ringCount'), ringMeta: ul(this._progCgleStep,'u_ringMeta'), delta: ul(this._progCgleStep,'u_delta'), beta: ul(this._progCgleStep,'u_beta'), dispd: ul(this._progCgleStep,'u_dispd'), eps: ul(this._progCgleStep,'u_eps'), c3: ul(this._progCgleStep,'u_c3'), mu: ul(this._progCgleStep,'u_mu'), c5: ul(this._progCgleStep,'u_c5'), cdt: ul(this._progCgleStep,'u_cdt') },
      nlho:   { psi: ul(this._progNlhoStep,'u_psi'), mapA: ul(this._progNlhoStep,'u_mapA'), mapB: ul(this._progNlhoStep,'u_mapB'), nMaps: ul(this._progNlhoStep,'u_nMaps'), G: ul(this._progNlhoStep,'u_G'), anchorTex: ul(this._progNlhoStep,'u_anchorTex'), anchorOn: ul(this._progNlhoStep,'u_anchorOn'), anchorScale: ul(this._progNlhoStep,'u_anchorScale'), anchorDom: ul(this._progNlhoStep,'u_anchorDom') },
      argInit:  { psi: ul(this._progArgmaxInit,'u_psi') },
      argReduce:{ src: ul(this._progArgmaxReduce,'u_src'), inW: ul(this._progArgmaxReduce,'u_inW'), inH: ul(this._progArgmaxReduce,'u_inH') },
      step2:  { psi: ul(this._progStep2, 'u_psi'), rings: ul(this._progStep2, 'u_rings'), dt: ul(this._progStep2, 'u_dt'), G: ul(this._progStep2, 'u_G'), nRings: ul(this._progStep2, 'u_nRings'), ringCount: ul(this._progStep2, 'u_ringCount'), ringMeta: ul(this._progStep2, 'u_ringMeta') },
      step3:  { psi: ul(this._progStep3, 'u_psi'), rings: ul(this._progStep3, 'u_rings'), dt: ul(this._progStep3, 'u_dt'), G: ul(this._progStep3, 'u_G'), nRings: ul(this._progStep3, 'u_nRings'), ringCount: ul(this._progStep3, 'u_ringCount'), ringMeta: ul(this._progStep3, 'u_ringMeta') },
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
      renderDesc:  { base: ul(this._progRenderDesc, 'u_base'), G: ul(this._progRenderDesc, 'u_G'), off: ul(this._progRenderDesc, 'u_off'), center: ul(this._progRenderDesc, 'u_center'), k: ul(this._progRenderDesc, 'u_k'), phi: ul(this._progRenderDesc, 'u_phi'), smoothMax: ul(this._progRenderDesc, 'u_smoothMax'), ampView: ul(this._progRenderDesc, 'u_ampView') },
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
      rotCenters:      { psi: ul(this._progRotCenters,'u_psi'), delta: ul(this._progRotCenters,'u_delta'), n: ul(this._progRotCenters,'u_n'), centers: ul(this._progRotCenters,'u_centers'), rad: ul(this._progRotCenters,'u_rad'), G: ul(this._progRotCenters,'u_G') },   // §7.92 θ-operator
      affineCenters:   { psi: ul(this._progAffineCenters,'u_psi'), minv: ul(this._progAffineCenters,'u_minv'), tinv: ul(this._progAffineCenters,'u_tinv'), n: ul(this._progAffineCenters,'u_n'), centers: ul(this._progAffineCenters,'u_centers'), rad: ul(this._progAffineCenters,'u_rad'), G: ul(this._progAffineCenters,'u_G') },   // §7.98 general metric op
      ifsWarp:         { psi: ul(this._progIfsWarp,'u_psi'), minv: ul(this._progIfsWarp,'u_minv'), tinv: ul(this._progIfsWarp,'u_tinv'), n: ul(this._progIfsWarp,'u_n'), G: ul(this._progIfsWarp,'u_G'), smooth: ul(this._progIfsWarp,'u_smooth') },   // full K-map IFS union (+ smooth: 0=bicubic, 1=bilinear)
      lensGenome:      { psi: ul(this._progLensGenome,'u_psi'), n: ul(this._progLensGenome,'u_n'), centers: ul(this._progLensGenome,'u_centers'), a: ul(this._progLensGenome,'u_a'), beta: ul(this._progLensGenome,'u_beta'), vtx: ul(this._progLensGenome,'u_vtx'), k: ul(this._progLensGenome,'u_k'), phaseT: ul(this._progLensGenome,'u_phaseT') },   // §7.98/§7.102 genome lens = GPU linOp (mul, SPACETIME)
      nlSpm:           { psi: ul(this._progNlSpm,'u_psi'), gamma: ul(this._progNlSpm,'u_gamma'), isat: ul(this._progNlSpm,'u_isat'), dt: ul(this._progNlSpm,'u_dt') },
      eyeSuperpose:    { psi: ul(this._progEyeSuperpose,'u_psi'), obj: ul(this._progEyeSuperpose,'u_obj'), beta: ul(this._progEyeSuperpose,'u_beta') },
      eyeContract:     { psi: ul(this._progEyeContract,'u_psi'), obj: ul(this._progEyeContract,'u_obj'), lambda: ul(this._progEyeContract,'u_lambda') },
      eyeScale:        { psi: ul(this._progEyeScale,'u_psi'), s: ul(this._progEyeScale,'u_s') },
      eyeCapScale:     { psi: ul(this._progEyeCapScale,'u_psi'), e: ul(this._progEyeCapScale,'u_e'), target: ul(this._progEyeCapScale,'u_target') },
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); gl.viewport(0, 0, G, G);
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progDotRows);
    gl.uniform1i(u.a, 0); gl.uniform1i(u.b, 1); gl.uniform1i(u.G, G);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tA);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tB);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
  }

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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); gl.viewport(0, 0, G, G);
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
  renderDescField({ ox = 0, oy = 0, cx = 0, cy = 0, kx = 0, ky = 0, phi = 0, ampView = 0 } = {}, smoothMax) {
    const gl = this._gl, G = this._G, u = this._u.renderDesc;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, G, G);
    gl.useProgram(this._progRenderDesc);
    gl.uniform1i(u.base, 0);
    gl.uniform1i(u.ampView, ampView ? 1 : 0);
    gl.uniform1i(u.G, G);
    gl.uniform2f(u.off, ox, oy);
    gl.uniform2f(u.center, cx, cy);
    gl.uniform2f(u.k, kx, ky);
    gl.uniform1f(u.phi, phi);
    gl.uniform1f(u.smoothMax, smoothMax);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._descTex);
    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // ── Public: N free leapfrog steps on the eye ping-pong (no injection) ────────
  // Used by the plate-free round-trip eye: stepEyeN(T, +dt) then stepEyeN(T, -dt).
  stepEyeN(n, dt) {
    for (let i = 0; i < n; i++) this.stepEye(dt);
  }

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
  // ── Public: FULL-AUTHORITY HOLD contraction ψ ← (1−λ)ψ + λ·obj (GPU). obj = the _obj texture (setObjField).
  //    A contraction (not the additive superpose): |ψ−obj| shrinks ×(1−λ) per call → cross-GPU float divergence
  //    on the unpinned halo decays, restoring peer-determinism the way W's re-locking drive does. λ=1 = projection.
  applyEyeContract(lambda) {
    const gl = this._gl, G = this._G;
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const fbo = this._eyeSrc === 'A' ? this._fboEyeB : this._fboEyeA;
    const u = this._u.eyeContract;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, G, G);
    gl.useProgram(this._progEyeContract);
    gl.uniform1i(u.psi, 0); gl.uniform1i(u.obj, 1); gl.uniform1f(u.lambda, lambda);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._obj);
    gl.bindVertexArray(this._vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._eyeSrc = this._eyeSrc === 'A' ? 'B' : 'A';
  }
  // ── Public: COEVOLVE energy-cap ψ *= sqrt(targetE / E) (GPU). E = Σ|ψ|² via a row-reduce → 1×1 readback (G floats, not G²) → scale shader.
  //    Far cheaper than the full-grid readback+JS-loop: one tiny scalar comes back, the scale stays on GPU.
  applyEyeEnergyCap(targetE) {
    const gl = this._gl, G = this._G;
    this.opCycleInit();   // ensure the reduction scratch/FBOs exist (idempotent)
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    // E = Σ|ψ|² (re²+im²): row-reduce → _opDotTex → col-finish → 1×1 scalar → read G... actually 1 float (no full-grid readback)
    const ur = this._u.energyRows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); gl.viewport(0, 0, G, G);
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
  // applyEyeEnergyCapNS(targetE) — the NO-SYNC cap: identical physics to applyEyeEnergyCap (reduce → full
  // normalization √(target/E), both directions) with the scale pass SAMPLING the 1×1 reduce texture instead of
  // reading it back — zero pipeline stalls. The turbo executor's cap (profiled: per-step readPixels was 57% of
  // the frame). The sync version stays for callers that want the E value CPU-side.
  applyEyeEnergyCapNS(targetE) {
    const gl = this._gl, G = this._G;
    this.opCycleInit();
    const src = this._eyeSrc === 'A' ? this._eyeA : this._eyeB;
    const ur = this._u.energyRows;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); gl.viewport(0, 0, G, G);
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opDotFbo); gl.viewport(0, 0, G, G);
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
highp float ringLap(sampler2D psi, ivec2 coord, int comp,
                    isampler2D rings, int nRings, int ringCount) {
  // 9-POINT ISOTROPIC LAPLACIAN (Oono-Puri / Mehrstellen): lap = (4·ortho + diag − 20·ctr)/6.
  // The 5-point NN stencil destroys DIAGONAL momentum (its dispersion error grows fast off-axis), so a
  // self-advecting soliton's group velocity breaks at the grid scale and it radiates a wake / pins to the
  // grid (Peierls-Nabarro). The 9-point stencil is isotropic to O(h⁴) — it pushes dispersion error far out
  // into the Brillouin zone, so a phase-gradient (momentum) actually GRIPS the grid and transports the mass
  // coherently. Weights sum to 0 (conserves constants) → drop-in safe for every stepEyeN/plate consumer.
  int G  = u_G;
  ivec2 xp   = ivec2((coord.x + 1) % G, coord.y);
  ivec2 xm   = ivec2((coord.x - 1 + G) % G, coord.y);
  ivec2 yp   = ivec2(coord.x, (coord.y + 1) % G);
  ivec2 ym   = ivec2(coord.x, (coord.y - 1 + G) % G);
  ivec2 xpyp = ivec2((coord.x + 1) % G, (coord.y + 1) % G);
  ivec2 xmym = ivec2((coord.x - 1 + G) % G, (coord.y - 1 + G) % G);
  ivec2 xpym = ivec2((coord.x + 1) % G, (coord.y - 1 + G) % G);
  ivec2 xmyp = ivec2((coord.x - 1 + G) % G, (coord.y + 1) % G);
  float ctr   = texelFetch(psi, coord, 0)[comp];
  float ortho = texelFetch(psi, xp, 0)[comp] + texelFetch(psi, xm, 0)[comp]
              + texelFetch(psi, yp, 0)[comp] + texelFetch(psi, ym, 0)[comp];
  float diag  = texelFetch(psi, xpyp, 0)[comp] + texelFetch(psi, xmym, 0)[comp]
              + texelFetch(psi, xpym, 0)[comp] + texelFetch(psi, xmyp, 0)[comp];
  float lap = (4.0 * ortho + diag - 20.0 * ctr) / 6.0;

  // IFS ring contributions
  for (int d = 0; d < nRings; d++) {
    int   start = int(u_ringMeta[d].x);
    int   n     = int(u_ringMeta[d].y);
    float norm  = u_ringMeta[d].z;
    float acc   = 0.0;
    for (int i = 0; i < n; i++) {
      ivec2 off = texelFetch(rings, ivec2(start + i, 0), 0).xy;
      ivec2 nb  = ivec2((coord.x + off.x + G * 4) % G,
                        (coord.y + off.y + G * 4) % G);
      acc += texelFetch(psi, nb, 0)[comp];
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

const GLSL_EYE_SCALE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_psi;
uniform float u_s;
out vec4 fragColor;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); fragColor = vec4(texelFetch(u_psi, c, 0).xy * u_s, 0.0, 1.0); }`;

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
const GLSL_RENDER_DESC = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D u_base;
uniform int   u_G;
uniform vec2  u_off;      // translation (cells): sample the envelope at x − off (torus wrap)
uniform vec2  u_center;   // wave-packet center (px) — the k-phasor reference point
uniform vec2  u_k;        // momentum phase tilt (rad/cell) — the linOp k·x term
uniform float u_phi;      // global register phase (φ + ω·frac, from the CPU f64 model)
uniform float u_smoothMax;
uniform int   u_ampView;  // 0 = phase colormap (hue = arg ψ — motion visible), 1 = amplitude hologram colormap (same convention as the field view; global phase honestly invisible)
in vec2 v_uv;
out vec4 fragColor;
${GLSL_HOLOGRAM_COLORMAP}
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
  float norm = 1.0 / sqrt(max(u_smoothMax, 1e-18));
  float amp  = sqrt(psi.x*psi.x + psi.y*psi.y) * norm;
  if (u_ampView == 1) {   // AMPLITUDE view — identical arithmetic to GLSL_RENDER_FIELD (the field view's colormap)
    float lva = log(1.0 + 99.0 * amp) / log(100.0);
    fragColor = vec4(hologramColor(lva), 1.0);
    return;
  }
  float hue  = (atan(psi.y, psi.x) / (2.0 * 3.14159265) + 1.0);
  hue = hue - floor(hue);
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
  float fade = smoothstep(0.004, 0.03, amp);
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
