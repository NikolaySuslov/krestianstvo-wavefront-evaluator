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

    // GL resources
    this._psiA  = null; this._fboA = null;  // ping
    this._psiB  = null; this._fboB = null;  // pong
    this._ref   = null;                      // refField texture (RG32F)
    this._obj   = null;                      // objField texture (RG32F) — injection target
    this._plateA = null; this._fboPA = null; // plate ping (RGBA32F)
    this._plateB = null; this._fboPB = null; // plate pong (RGBA32F)
    this._plateSrc = 'A';
    this._plate = null; this._fboP = null;   // alias → current readable plate
    // Sweep psi — independent ping-pong for plate accumulation sweep
    this._swA = null; this._fboSwA = null;
    this._swB = null; this._fboSwB = null;
    this._swSrc = 'A';
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
    this._progPlatePhaseKick  = null;  // energy-conserving plate phase kick on sweep psi
    this._progDemodPhaseKick  = null;  // phase kick by demodulated object wavefront phase
    this._progAddSources      = null;  // add point sources texture to psi
    this._srcTex              = null;  // RG32F source texture for beam injection

    this._src  = 'A';  // which FBO currently holds latest psi
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

    // Create ping-pong psi textures
    [this._psiA, this._fboA] = this._makePsiTex();
    [this._psiB, this._fboB] = this._makePsiTex();

    // ref texture (RG32F, no FBO — read-only)
    this._ref = this._makeRGF32Tex();

    // plate ping-pong (RGBA32F) — accumulate reads plateA, writes plateB, then swaps
    [this._plateA, this._fboPA] = this._makePlateTex();
    [this._plateB, this._fboPB] = this._makePlateTex();
    this._plateSrc = 'A';  // current readable plate
    // Alias for backwards compat in destroy / readPlate
    this._plate = this._plateA; this._fboP = this._fboPA;

    // obj texture (RG32F, no FBO — injection target, read-only in shader)
    this._obj = this._makeRGF32Tex();

    // Sweep psi ping-pong (RG32F) — independent from display psi
    [this._swA, this._fboSwA] = this._makePsiTex();
    [this._swB, this._fboSwB] = this._makePsiTex();
    this._swSrc = 'A';
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
    this._progCopy        = this._compileStep(GLSL_COPY);
    this._progStepRecord  = this._compileStep(GLSL_STEP_RECORD);
    this._progReconCplx   = this._compileStep(GLSL_RECON_CPLX);
    this._progStepPlate   = this._compileStep(GLSL_STEP_PLATE);
    this._progStepHuygens = this._compileStep(GLSL_STEP_HUYGENS);
    this._progLensPhase       = this._compileStep(GLSL_LENS_PHASE);
    this._progStepPlateKernel = this._compileStep(GLSL_STEP_PLATE_KERNEL);
    this._progPlatePhaseKick  = this._compileStep(GLSL_PLATE_PHASE_KICK);
    this._progDemodPhaseKick  = this._compileStep(GLSL_DEMOD_PHASE_KICK);
    this._progAddSources      = this._compileStep(GLSL_ADD_SOURCES);
    this._srcTex              = this._makeRGF32Tex();
    this._progRenderField = this._compileStep(GLSL_RENDER_FIELD);
    this._progRenderPhase = this._compileStep(GLSL_RENDER_PHASE);
    this._progRenderPlate = this._compileStep(GLSL_RENDER_PLATE);

    // Cache uniform locations — getUniformLocation is expensive on the hot path
    const ul = (prog, name) => gl.getUniformLocation(prog, name);
    this._u = {
      step1:  { psi: ul(this._progStep1, 'u_psi'), rings: ul(this._progStep1, 'u_rings'), dt: ul(this._progStep1, 'u_dt'), G: ul(this._progStep1, 'u_G'), nRings: ul(this._progStep1, 'u_nRings'), ringCount: ul(this._progStep1, 'u_ringCount'), ringMeta: ul(this._progStep1, 'u_ringMeta') },
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
      platePhaseKick: { psi: ul(this._progPlatePhaseKick, 'u_psi'), plate: ul(this._progPlatePhaseKick, 'u_plate'), gamma: ul(this._progPlatePhaseKick, 'u_gamma'), smoothMaxPlate: ul(this._progPlatePhaseKick, 'u_smoothMaxPlate') },
      demodPhaseKick: { psi: ul(this._progDemodPhaseKick, 'u_psi'), obj: ul(this._progDemodPhaseKick, 'u_obj'), gamma: ul(this._progDemodPhaseKick, 'u_gamma') },
      addSources:  { psi: ul(this._progAddSources, 'u_psi'), src: ul(this._progAddSources, 'u_src') },
      copy:        { plate: ul(this._progCopy, 'u_plate') },
      renderField: { psi: ul(this._progRenderField, 'u_psi'), smoothMax: ul(this._progRenderField, 'u_smoothMax') },
      renderPhase: { psi: ul(this._progRenderPhase, 'u_psi'), smoothMax: ul(this._progRenderPhase, 'u_smoothMax') },
      renderPlate: { psi: ul(this._progRenderPlate, 'u_psi'), plate: ul(this._progRenderPlate, 'u_plate'), smoothMaxPlate: ul(this._progRenderPlate, 'u_smoothMaxPlate'), smoothMaxField: ul(this._progRenderPlate, 'u_smoothMaxField'), dir: ul(this._progRenderPlate, 'u_dir') },
    };
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
    const tex = this._src === 'A' ? this._psiA : this._psiB;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, G, G, gl.RG, gl.FLOAT, f32);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

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

    const psySrc = this._src === 'A' ? this._psiA : this._psiB;
    const psyDst = this._src === 'A' ? this._fboB  : this._fboA;
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
    this._src = this._src === 'A' ? 'B' : 'A';
  }

  // ── Public: one leapfrog step + SRC_ALPHA injection toward objField ─────────
  // Equivalent to JS _physStep in RECORD mode: step psi, then mix toward obj.
  // alpha: SRC_ALPHA constant
  stepRecord(dt, alpha) {
    this.step(dt);
    // Injection pass: psi += alpha * (obj - psi)  →  psi = (1-alpha)*psi + alpha*obj
    const gl  = this._gl, G = this._G;
    const src = this._src === 'A' ? this._psiA : this._psiB;
    const fbo = this._src === 'A' ? this._fboB : this._fboA;
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
    this._src = this._src === 'A' ? 'B' : 'A';
  }

  // ── Public: seed psi from plate for RECON (plate values as Re, Im=0) ────────
  seedRecon() {
    const gl  = this._gl, G = this._G;
    const plateTex = this._plateSrc === 'A' ? this._plateA : this._plateB;
    const fbo = this._src === 'A' ? this._fboA : this._fboB;
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
  readPsiAsync() {
    const gl = this._gl, G = this._G;
    const byteLen = G * G * 2 * 4; // RG32F
    const fbo = this._src === 'A' ? this._fboA : this._fboB;

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
    const src = this._src === 'A' ? this._psiA : this._psiB;
    const fbo = this._src === 'A' ? this._fboB : this._fboA;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(prog);
    gl.uniform1f(u.dt, dt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._ringTex);

    gl.bindVertexArray(this._vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._src = this._src === 'A' ? 'B' : 'A';
  }

  // ── Public: accumulate plate |ψ+ref|² ───────────────────────────────────────
  // decay: PLATE_DECAY coefficient (applied to existing plate value)
  accumulatePlate(decay) {
    const gl  = this._gl, G = this._G;
    const psiTex  = this._src      === 'A' ? this._psiA  : this._psiB;
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
    const fbo = this._src === 'A' ? this._fboA : this._fboB;
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
    for (const t of [this._psiA, this._psiB, this._ref, this._obj, this._plateA, this._plateB, this._swA, this._swB, this._ringTex, this._cplxA, this._cplxB, this._srcTex])
      if (t) gl.deleteTexture(t);
    for (const f of [this._fboA, this._fboB, this._fboPA, this._fboPB, this._fboSwA, this._fboSwB, this._fboCplxA, this._fboCplxB])
      if (f) gl.deleteFramebuffer(f);
    for (const p of [this._progStep1, this._progStep2, this._progStep3, this._progAccum, this._progAccumSweep, this._progCopy, this._progStepRecord, this._progReconCplx, this._progRenderField, this._progRenderPhase, this._progRenderPlate])
      if (p) gl.deleteProgram(p);
    this._gl = null;
  }

  // ── Public: render psi amplitude colormap to default framebuffer ────────────
  // Outputs hologram colormap of log-scaled |ψ|² to the WebGL canvas.
  // Call drawImage(gpu.canvas, 0, 0, RW, RH) afterward to blit to a 2D canvas.
  renderField(smoothMax) {
    const gl = this._gl, G = this._G;
    const psiTex = this._src === 'A' ? this._psiA : this._psiB;
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

  // ── Public: render psi phase colormap to default framebuffer ────────────────
  renderPhase(smoothMax) {
    const gl = this._gl, G = this._G;
    const psiTex = this._src === 'A' ? this._psiA : this._psiB;
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

  // Copy current sweep psi into display psi so renderField/renderPhase show frozen cube.
  freezeSweepToPsi() {
    const gl = this._gl, G = this._G;
    const swFbo  = this._swSrc === 'A' ? this._fboSwA : this._fboSwB;
    const dstTex = this._src   === 'A' ? this._psiA   : this._psiB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, swFbo);
    gl.bindTexture(gl.TEXTURE_2D, dstTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, G, G);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

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
    const psiTex   = this._src === 'A' ? this._psiA : this._psiB;
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
  // Standard NN Laplacian (nearest-neighbour stencil)
  int G  = u_G;
  ivec2 xp = ivec2((coord.x + 1) % G, coord.y);
  ivec2 xm = ivec2((coord.x - 1 + G) % G, coord.y);
  ivec2 yp = ivec2(coord.x, (coord.y + 1) % G);
  ivec2 ym = ivec2(coord.x, (coord.y - 1 + G) % G);
  float ctr = texelFetch(psi, coord, 0)[comp];
  float lap = texelFetch(psi, xp, 0)[comp]
            + texelFetch(psi, xm, 0)[comp]
            + texelFetch(psi, yp, 0)[comp]
            + texelFetch(psi, ym, 0)[comp]
            - 4.0 * ctr;

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
  if (amp < 0.015) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float hue = (atan(psi.y, psi.x) / (2.0 * 3.14159265) + 1.0);
  hue = hue - floor(hue);  // fract
  float v   = clamp(log(1.0 + 6.0 * amp) / log(7.0), 0.0, 1.0);
  // HSV → RGB (integer hi sector)
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
  fragColor = vec4(rgb, 1.0);
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
