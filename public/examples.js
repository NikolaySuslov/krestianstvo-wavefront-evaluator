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

import hologram2App from "./apps/hologram2.js";
import hologram3App from "./apps/hologram3.js";
import hologram4App from "./apps/hologram4.js";
import hologram4NativeApp from "./apps/hologram4_native.js";
import hologram4NativeNoGpuApp from "./apps/hologram4_native_nogpu.js";
import eyeApp from "./apps/eye.js";
import mediumApp from "./apps/medium.js";
import mediumU1App from "./apps/medium-u1.js";               // medium.js's SUCCESSOR (clean rebuild): transport → U(1) register → dual-layer holography on the extracted engine + laws + cloned world
import observersApp from "./apps/observers.js";
import rhythmApp from "./apps/rhythm.js";
import ifsClockApp from "./apps/ifsclock.js";
import ifsHutchinsonApp from "./apps/ifs-hutchinson.js";   // the Banach set-attractor face: setwise W via ifs-core.js (vs ifsclock's chaos-game)
import ifsSelfhostApp from "./apps/ifs-selfhost.js";       // Idea 3 LIVE: living cascade ⇄ Hutchinson-W generator reconciled in the replicated world (descriptor self-host)
import contractPipelineApp from "./apps/contract-pipeline.js";   // the futureContract gate LIVE: A⊸B⊸C pipeline where each stage starts when its upstream CONVERGES (geometric scheduling)
import selfhostApp from "./apps/selfhost.js";
import nls3App from "./apps/nls3.js";
import nls4App from "./apps/nls4.js";
import instanton3App from "./apps/instanton3.js";
import instantonHologramApp from "./apps/instanton_hologram.js";
import wavelet1App from "./apps/wavelet1.js";
import counterApp from "./apps/counter.js";
import feedbackApp from "./apps/feedback.js";
import zenoApp from "./apps/zeno.js";
import rngApp from "./apps/rng.js";
import wave2dApp from "./apps/wave2d.js";
import fieldNodesApp from "./apps/field-nodes.js";          // MIXED-RADIX: one engine, ANY power-of-two G picks its factorization (16=[16], 128=[16×8], 256=[16×16]) — exact medium-u1 ring at f64 floor, 1-3 stages any size
import ahcMixedRadixApp from "./apps/ahc-mixed-radix.js";    // the FULL AHC (4 worldlines + spectral pin + native ±T holography + edges + dilation) on the EXACT mixed-radix medium — ahc-butterfly's sibling, transform=mixed-radix           // INFINITE-SCROLL a big deterministic field: a 256² sky of patch-nodes explored through a 64² crop-camera — only the crop+halo patches are DRIVEN (rest PARK), so per-frame cost is bounded by the VIEWPORT not the sky (same handful of patches whether 256² or 1024²). The frontier arc's payoff: run the frontier of what you're looking at
import fractal0App from "./apps/fractal0.js";
import fractalApp from "./apps/fractal.js";
import rosslerApp from "./apps/rossler.js";
import fractal1App from "./apps/fractal1.js";

export const APPS = {
  'ahc-mixed-radix': ahcMixedRadixApp,
  'medium-u1': mediumU1App,
  'field-nodes': fieldNodesApp,
  'ifs-hutchinson': ifsHutchinsonApp,
  'ifs-selfhost': ifsSelfhostApp,
  'contract-pipeline': contractPipelineApp,
  selfhost: selfhostApp,
  observers: observersApp,
  rhythm: rhythmApp,
  ifsclock: ifsClockApp,
  medium: mediumApp,
  eye: eyeApp,
  hologram4_native: hologram4NativeApp,
  hologram4_native_nogpu: hologram4NativeNoGpuApp,
  hologram4: hologram4App,
  hologram2: hologram2App,
  hologram3: hologram3App,
  nls3: nls3App,
  nls4: nls4App,
  instanton3: instanton3App,
  instanton_hologram: instantonHologramApp,
  wavelet1: wavelet1App,
  wave2d: wave2dApp,
  fractal0: fractal0App,
  fractal1: fractal1App,
  fractal: fractalApp,
  rossler: rosslerApp,
  feedback: feedbackApp,
  zeno: zenoApp,
  counter: counterApp,
  rng: rngApp,
};
