/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── App registry ──────────────────────────────────────────────────────────────
// Each entry in APPS describes one example.
// All implementation details live in public/apps/<name>.js — fully self-contained.
//
// App module shape (default export):
//   title           — display name
//   selo            — WebSocket selo namespace
//   reflectorMs     — shim tick interval
//   metaOptions     — object merged onto meta.ps.app after creation
//   makeScripts(avatarScript) → string[]   world program(s) passed to makeWorld
//   makeRenderer(core)        → rendererFactory
//   wrapId          — DOM id of the flex container that holds both peer panels

import hologram2App  from "./apps/hologram2.js";
import hologram3App  from "./apps/hologram3.js";
import hologram4App       from "./apps/hologram4.js";
import hologram4NativeApp    from "./apps/hologram4_native.js";
import hologram4NativeNoGpuApp from "./apps/hologram4_native_nogpu.js";
import nls3App        from "./apps/nls3.js";
import nls4App        from "./apps/nls4.js";
import instanton3App        from "./apps/instanton3.js";
import instantonHologramApp from "./apps/instanton_hologram.js";
import wavelet1App   from "./apps/wavelet1.js";
import counterApp   from "./apps/counter.js";
import feedbackApp from "./apps/feedback.js";
import zenoApp     from "./apps/zeno.js";
import rngApp      from "./apps/rng.js";
import wave2dApp   from "./apps/wave2d.js";
import fractal0App from "./apps/fractal0.js";
import fractalApp  from "./apps/fractal.js";
import rosslerApp  from "./apps/rossler.js";
import fractal1App from "./apps/fractal1.js";

export const APPS = {
  hologram4_native: hologram4NativeApp,
  hologram4_native_nogpu: hologram4NativeNoGpuApp,
  hologram4:        hologram4App,
  hologram2:  hologram2App,
  hologram3:  hologram3App,
  nls3:       nls3App,
  nls4:       nls4App,
  instanton3:        instanton3App,
  instanton_hologram: instantonHologramApp,
  wavelet1:   wavelet1App,
  wave2d:    wave2dApp,
  fractal0: fractal0App,
  fractal1: fractal1App,
  fractal:  fractalApp,
  rossler:  rosslerApp,
  feedback: feedbackApp,
  zeno:     zenoApp,
  counter:  counterApp,
  rng:      rngApp,
};
