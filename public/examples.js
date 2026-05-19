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

import hologramApp  from "./apps/hologram.js";
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
  hologram:  hologramApp,
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
