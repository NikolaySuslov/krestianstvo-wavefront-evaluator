/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── Hologram | IFS Fractal Clock — symmetric emit & recon ────────────────────
//
// Both recording and reconstruction are driven by the same IFS fractal clock
// structure (cf. makeIfsClock in krestianstvo-wavefront-evaluator.js).
//
//   EMIT  beat(depth, delay, gen)
//         → accumulate plate for shell dist ≈ delay / DELAY_SCALE
//         → ctx.future(delay×selfR,          "beat",     { depth,   delay×selfR,   gen+1 })
//         → ctx.future(selfDelay+childDelay, "beat",     { depth+1, childDelay,    gen=0 })
//
//   finalizePlate → adds off-axis reference beam; launches recon IFS root
//
//   RECON reconBeat(depth, delay, gen)   ← identical IFS structure, mirrored space
//         → distTarget = delay/DELAY_SCALE
//         → for each recon pixel (rx,ry), loop plate cells (cx,cy):
//           if |dist3d(rx,ry,cx,cy) - distTarget| < 1.5: accumulate += contribution
//           (shell test on plate side — time-reverse of beat's shell test on plate pixels)
//         → ctx.future(delay×selfR,          "reconBeat", { depth,   ... })
//         → ctx.future(selfDelay+childDelay, "reconBeat", { depth+1, ... })
//
//   finalizeRecon → locks s._reconBuf → s.recon
//
// IFS maps [golden, silver] → shells sampled quasi-crystallographically on both
// sides of the hologram. The fractal temporal structure is the same forward and
// backward — the hologram clock is its own time-reverse.

// ── Infrastructure ────────────────────────────────────────────────────────────
const REFLECTOR_MS = 50;
const SUBTICK_MS   = 1;

// ── Primary parameters ────────────────────────────────────────────────────────
const GRID         = 64;
const PTS_PER_EDGE = 16;  // 12 edges × 16 = 192 sources

// ── Physical parameters ───────────────────────────────────────────────────────
const WAVELENGTH   = 4.0;
const DELAY_SCALE  = 0.02;

// ── Derived ───────────────────────────────────────────────────────────────────
const N_CELLS  = GRID * GRID;
const RECON_Z  = Math.round(GRID / 8);  // small z → more non-evanescent IFS shells
const REF_KX   = 0.08;  // off-axis carrier — well below Nyquist (0.5), clear of obj bandwidth

// ── IFS clock parameters ──────────────────────────────────────────────────────
const IFS_DEPTH     = 5;
// Denser maps: 6 incommensurable ratios fill the spatial gaps between shells
const IFS_MAPS      = [0.3090169944, 0.4142135623, 0.5, 0.6180339887, 0.7071067812, 0.7320508075];
const IFS_GEN_CAP   = 6;
const IFS_MIN_DELAY = 0.1;

// Emit side: shells 0 … MAX_DIST on the hologram plate
const MAX_DIST        = Math.ceil(Math.sqrt(2) * GRID);
const IFS_BASE_DELAY  = parseFloat((DELAY_SCALE * MAX_DIST).toFixed(6));
const PLATE_DONE_DELAY = parseFloat((IFS_BASE_DELAY * 10).toFixed(4));  // 10× — covers full depth tree

// Recon side: N_RECON_ROOTS roots fired at geometrically spaced delays covering
// [RECON_MIN_DELAY .. RECON_BASE_DELAY] to guarantee shell coverage across full r2d range.
const RECON_BASE_DELAY = parseFloat((DELAY_SCALE * MAX_DIST).toFixed(6));
const RECON_MIN_DELAY  = Math.max(IFS_MIN_DELAY * 1.1, parseFloat((DELAY_SCALE * (RECON_Z + 1)).toFixed(6))); // just above evanescent, never below IFS_MIN_DELAY
const N_RECON_ROOTS    = 16;
const RECON_DONE_DELAY = parseFloat((RECON_BASE_DELAY * 12).toFixed(4)); // 12× covers all subtrees

// ── Cycle timing ──────────────────────────────────────────────────────────────
// Guarantee: CYCLE × REFLECTOR_MS > (PLATE_DONE_DELAY + RECON_DONE_DELAY) × SUBTICK_MS
// i.e. next __macro must not fire before finalizeRecon completes.
// PLATE_DONE_DELAY + RECON_DONE_DELAY ≈ 40 sub-ticks = 40ms at SUBTICK_MS=1.
// CYCLE=60 → 60 × 50ms = 3000ms window — enough wall time for full-res scatter.
const CYCLE = 60;

// ── Level-of-Detail tables (indexed by IFS depth 0…4) ────────────────────────
// beat outer:  0 = skip plate accumulation loop at this depth
// recon outer: stride for output (ry,rx) scan; block-fill lod×lod patch
// recon inner: stride for plate (cy,cx) scan; amplitude × stride² compensation
//
// LoD note: with GRID=128, IFS_BASE_DELAY=9.1, RECON_Z=64, the IFS tree only
// produces real (non-evanescent) shells at depth 0–1. Depth 2+ shells have
// distTarget < RECON_Z → r2dSq < 0 → skipped in handler. LOD_OUTER at depth
// 2–3 is therefore inert — all meaningful work is at depth 0 (lodO=1).
// LoD would matter if DELAY_SCALE were reduced or GRID increased so the tree
// spans more octaves above the evanescent threshold.
const LOD_BEAT  = [1, 1, 1, 1, 0];  // emit plate stride (0 = skip)
const LOD_OUTER = [1, 1, 1, 2, 0];  // reconBeat plate stride (0 = skip)
const LOD_INNER = [1, 1, 1, 1, 0];  // display only

// ── Perspective ───────────────────────────────────────────────────────────────
const CAM_Z      = 4.5;
const PROJ_SCALE = 2 / (7 * (1 - 1 / GRID));

// ── Geometry ──────────────────────────────────────────────────────────────────
// Unit cube — 8 vertices, 12 edges
const CUBE_VERTS = [
  [-1,-1,-1], [ 1,-1,-1], [ 1, 1,-1], [-1, 1,-1],  // back face
  [-1,-1, 1], [ 1,-1, 1], [ 1, 1, 1], [-1, 1, 1],  // front face
];
const CUBE_EDGES = [
  [0,1],[1,2],[2,3],[3,0],  // back face
  [4,5],[5,6],[6,7],[7,4],  // front face
  [0,4],[1,5],[2,6],[3,7],  // connecting edges
];

// Random initial orientation — Euler angles baked in at load time so both peers agree
const INIT_ANGLE_Y = 0.7853981634;   // 45°  Y rotation
const INIT_ANGLE_X = 0.5235987756;   // 30°  X rotation (tilt)

function _sampleEdges() {
  const pts = [];
  for (const [ai, bi] of CUBE_EDGES) {
    const a = CUBE_VERTS[ai], b = CUBE_VERTS[bi];
    for (let t = 0; t < PTS_PER_EDGE; t++) {
      const u = (t + 0.5) / PTS_PER_EDGE;
      pts.push([
        a[0] + u * (b[0] - a[0]),
        a[1] + u * (b[1] - a[1]),
        a[2] + u * (b[2] - a[2]),
      ]);
    }
  }
  return pts;
}
const CUBE_PTS      = _sampleEdges();
const CUBE_PTS_JSON = JSON.stringify(CUBE_PTS);

// ── World program ─────────────────────────────────────────────────────────────
const hologram4WorldProgram = `
  const W         = Renkon.app.W;
  const reflector = Events.receiver();

  const GRID              = ${GRID};
  const N_CELLS           = ${N_CELLS};
  const WAVELENGTH        = ${WAVELENGTH};
  const RECON_Z           = ${RECON_Z};
  const DELAY_SCALE       = ${DELAY_SCALE};
  const TWO_PI            = 2 * Math.PI;
  const CUBE_PTS          = ${CUBE_PTS_JSON};
  const REF_KX            = ${REF_KX};
  const CYCLE             = ${CYCLE};
  const IFS_DEPTH         = ${IFS_DEPTH};
  const IFS_MAPS          = ${JSON.stringify(IFS_MAPS)};
  const IFS_GEN_CAP       = ${IFS_GEN_CAP};
  const IFS_MIN_DELAY     = ${IFS_MIN_DELAY};
  const IFS_BASE_DELAY    = ${IFS_BASE_DELAY};
  const PLATE_DONE_DELAY  = ${PLATE_DONE_DELAY};
  const RECON_BASE_DELAY  = ${RECON_BASE_DELAY};
  const RECON_MIN_DELAY   = ${RECON_MIN_DELAY};
  const N_RECON_ROOTS     = ${N_RECON_ROOTS};
  const RECON_DONE_DELAY  = ${RECON_DONE_DELAY};
  const LOD_BEAT          = ${JSON.stringify(LOD_BEAT)};
  const LOD_OUTER         = ${JSON.stringify(LOD_OUTER)};
  const LOD_INNER         = ${JSON.stringify(LOD_INNER)};
  const INIT_ANGLE_X      = ${INIT_ANGLE_X};
  const INIT_ANGLE_Y      = ${INIT_ANGLE_Y};

  // Off-axis reference: plane wave along +x with carrier REF_KX
  const _refPhase = (cx) => TWO_PI * REF_KX * cx;

  // Perspective projection of cube edge sources onto the hologram plate.
  // angle = Y-axis rotation (animated); INIT_ANGLE_X = fixed X-axis tilt.
  const _projectSources = (angle) => {
    const cosY = Math.cos(angle),  sinY = Math.sin(angle);
    const cosX = Math.cos(INIT_ANGLE_X), sinX = Math.sin(INIT_ANGLE_X);
    const halfG  = (GRID - 1) / 2;
    const fscale = halfG * ${PROJ_SCALE};
    const camZ   = ${CAM_Z};
    const total  = CUBE_PTS.length;
    return CUBE_PTS.map(([ox, oy, oz]) => {
      // Y rotation then X tilt
      const ry1 =  cosY * ox + sinY * oz;
      const ry2 =  oy;
      const rz1 = -sinY * ox + cosY * oz;
      const rx  =  ry1;
      const ry  =  cosX * ry2 - sinX * rz1;
      const rz  =  sinX * ry2 + cosX * rz1;
      const z   =  camZ - rz;
      return {
        sx:  halfG + (rx / z) * fscale * camZ,
        sy:  halfG - (ry / z) * fscale * camZ,
        sz:  z * (${RECON_Z} / camZ),
        amp: 8.0 * (0.5 + 0.5 * (rz + 1) / 2) / total,
      };
    });
  };

  const hologram4 = Behaviors.collect(
    {
      angle:           0,
      cycleId:         0,
      cycleCount:      0,
      plate:           new Array(2 * N_CELLS).fill(0),
      recon:           new Array(2 * N_CELLS).fill(0),
      _plateBuf:       null,
      _reconBuf:       null,
      _beatCount:      0,
      _beatDepth:      0,
      _reconBeatCount: 0,
      _reconBeatDepth: 0,
      _reconRowIdx:    0,
      emitEnergy:      new Array(IFS_DEPTH).fill(0),
      emitEvents:      [],
      reconEnergy:     new Array(IFS_DEPTH).fill(0),
      reconEvents:     [],
    },
    reflector,
    (state, pulse) => {
      let s = state;
      if (pulse?._isEvent && pulse._eventPayload?.type === 'nextCycle') {
        const entry = { fireAt: pulse.wallTime, msg: 'nextCycle', payload: {} };
        s = { ...state, _queue: [entry, ...(state._queue ?? [])] };
      }
      return W.reduce(s, pulse, "hologram4", {

      // ── Cycle driver ──────────────────────────────────────────────────────
      // First cycle fires automatically on tick=1.
      // Subsequent cycles fire only on 'nextCycle' external event (click on cube).
      // _keepalive loop keeps the node ticking so injected events are processed.
      __macro: (s, p, ctx) => {
        const tick = p.logicalTime;
        // Auto-start on first tick
        if (tick === 1) {
          const angle = INIT_ANGLE_Y;
          const angleInt = Math.round(angle * 1e6) >>> 0;
          let h = angleInt ^ 0xdeadbeef;
          h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
          h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
          h = (h ^ (h >>> 16)) >>> 0;
          W.rng.seed(h);
          ctx.future(100, '_keepalive', {});
          ctx.future(0, 'beat', { depth: 0, delay: IFS_BASE_DELAY, gen: 0, cycleId: tick, angle });
          ctx.future(PLATE_DONE_DELAY, 'finalizePlate', { cycleId: tick, angle });
          ctx.future(PLATE_DONE_DELAY + RECON_DONE_DELAY, 'finalizeRecon', { cycleId: tick });
          return {
            ...s, cycleId: tick, angle, cycleCount: 1, _emitActive: true, _reconActive: false,
            plate: new Array(2 * N_CELLS).fill(0), _plateBuf: null, _reconBuf: null,
            _beatCount: 0, _beatDepth: 0, _reconBeatCount: 0, _reconBeatDepth: 0, _reconRowIdx: 0,
            emitEnergy: new Array(IFS_DEPTH).fill(0), emitEvents: [],
            reconEnergy: new Array(IFS_DEPTH).fill(0), reconEvents: [],
          };
        }
        return s;
      },

      _keepalive: (s, p, ctx) => { ctx.future(100, '_keepalive', {}); return s; },

      // ── Manual cycle trigger — fired by click on cube wireframe ──────────
      nextCycle: (s, p, ctx) => {
        const tick = ctx.wallTime + 1;
        const cycleCount = (s.cycleCount ?? 0) + 1;
        const angle = ((s.angle ?? INIT_ANGLE_Y) + 0.41421356) % TWO_PI;
        const angleInt = Math.round(angle * 1e6) >>> 0;
        let h = angleInt ^ 0xdeadbeef;
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        W.rng.seed(h);
        ctx.future(1, 'beat', { depth: 0, delay: IFS_BASE_DELAY, gen: 0, cycleId: tick, angle });
        ctx.future(1 + PLATE_DONE_DELAY, 'finalizePlate', { cycleId: tick, angle });
        ctx.future(1 + PLATE_DONE_DELAY + RECON_DONE_DELAY, 'finalizeRecon', { cycleId: tick });
        return {
          ...s, cycleId: tick, angle, cycleCount, _emitActive: true, _reconActive: false,
          plate: new Array(2 * N_CELLS).fill(0), _plateBuf: null, _reconBuf: null,
          _beatCount: 0, _beatDepth: 0, _reconBeatCount: 0, _reconBeatDepth: 0, _reconRowIdx: 0,
          emitEnergy: new Array(IFS_DEPTH).fill(0), emitEvents: [],
          reconEnergy: new Array(IFS_DEPTH).fill(0), reconEvents: [],
        };
      },

      // ── IFS fractal beat ──────────────────────────────────────────────────
      // Processes one spherical shell of the wavefront at dist ≈ delay/DELAY_SCALE.
      // Self-fires at delay×selfR (same depth, finer scale).
      // Child-fires at depth+1 with childR (new octave, different offset).
      // LOD_BEAT[depth]=0 skips the pixel loop (fine shells, negligible contribution).
      beat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const { depth, delay, gen, angle } = p;

        // Always consume exactly 2 RNG values per beat for peer determinism
        const selfR      = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
        const childR     = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
        const selfDelay  = delay * selfR;
        const childDelay = delay * childR;

        // IFS clock fires regardless of LoD — maintains timing tree
        if (gen < IFS_GEN_CAP && selfDelay > IFS_MIN_DELAY)
          ctx.future(selfDelay, 'beat', {
            depth, delay: selfDelay, gen: gen + 1, cycleId: s.cycleId, angle,
          });
        if (gen === 0 && depth + 1 < IFS_DEPTH && childDelay > IFS_MIN_DELAY)
          ctx.future(selfDelay + childDelay, 'beat', {
            depth: depth + 1, delay: childDelay, gen: 0, cycleId: s.cycleId, angle,
          });

        const lodBeat = depth < LOD_BEAT.length ? LOD_BEAT[depth] : 0;
        if (!lodBeat) return { ...s, _beatCount: s._beatCount + 1, _beatDepth: depth };

        const distTarget = delay / DELAY_SCALE;
        const sources    = _projectSources(angle);
        const plate      = s.plate.slice();
        // Always stride=1 on the plate: any coarser stride leaves regular gaps
        // that alias into the intensity plate as moiré artifacts.
        for (const { sx, sy, sz, amp } of sources) {
          for (let cy = 0; cy < GRID; cy++) {
            for (let cx = 0; cx < GRID; cx++) {
              const dx     = cx - sx, dy = cy - sy;
              const dist2d = Math.sqrt(dx * dx + dy * dy);
              if (Math.abs(dist2d - distTarget) >= 1.5) continue;
              const dist3d = Math.sqrt(dx * dx + dy * dy + sz * sz);
              const phase  = (dist3d / WAVELENGTH) * TWO_PI;
              const id     = cy * GRID + cx;
              plate[id * 2]     += amp * Math.cos(phase);
              plate[id * 2 + 1] += amp * Math.sin(phase);
            }
          }
        }

        const emitEnergy = s.emitEnergy.slice();
        emitEnergy[depth] = Math.min(1, (emitEnergy[depth] ?? 0) + 0.3);
        const emitEvents = [...(s.emitEvents ?? []), { d: depth, delay, wt: ctx.wallTime }];
        return {
          ...s, plate, _plateBuf: plate,
          _beatCount: s._beatCount + 1, _beatDepth: depth,
          emitEnergy, emitEvents,
        };
      },

      // ── Extract +1 diffraction order for sparse reconstruction ───────────
      // Instead of storing the full intensity |E_obj+E_ref|², extract only the
      // +1 cross-term: E_obj · conj(E_ref) = (oRe+i·oIm)·exp(-i·rp).
      // This is the only term that reconstructs the real image; DC and -1 order
      // are discarded. The resulting plate is complex and spatially sparse —
      // values are significant only where the object field is strong, so the
      // hVal < threshold prune in reconBeat fires for most plate cells.
      finalizePlate: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const objField = s.plate;
        const plate    = new Array(2 * N_CELLS).fill(0);
        for (let cy = 0; cy < GRID; cy++) {
          for (let cx = 0; cx < GRID; cx++) {
            const id   = cy * GRID + cx;
            const rp   = _refPhase(cx);
            const oRe  = objField[id * 2], oIm = objField[id * 2 + 1];
            // +1 order cross-term: E_obj * conj(E_ref) = (oRe+i·oIm)*exp(-i·rp)
            plate[id * 2]     = oRe * Math.cos(rp) + oIm * Math.sin(rp);
            plate[id * 2 + 1] = oIm * Math.cos(rp) - oRe * Math.sin(rp);
          }
        }
        // Fire N_RECON_ROOTS IFS subtrees at geometrically spaced delays.
        // Logarithmic spacing covers [RECON_MIN_DELAY .. RECON_BASE_DELAY] uniformly
        // in log-space, guaranteeing shell coverage across the full r2d range.
        const logMin = Math.log(RECON_MIN_DELAY);
        const logMax = Math.log(RECON_BASE_DELAY);
        for (let i = 0; i < N_RECON_ROOTS; i++) {
          const t     = N_RECON_ROOTS === 1 ? 1 : i / (N_RECON_ROOTS - 1);
          const delay = Math.exp(logMin + t * (logMax - logMin));
          ctx.future(0, 'reconBeat', { depth: 0, delay, gen: 0, cycleId: p.cycleId });
        }
        return { ...s, plate, _plateBuf: plate, _emitActive: false, _reconActive: true };
      },

      // ── IFS fractal recon beat — true scattered time synchronization ────────
      // Exact time-reverse of beat. delay → r2d = sqrt((delay/DELAY_SCALE)²-RECON_Z²)
      // is the 2D radius of the back-propagating shell on the recon plane.
      //
      // Scatter topology (outer=plate cells, inner=annular recon pixels):
      //   beat:      for each source   → scatter to plate annulus at dist2d ≈ distTarget
      //   reconBeat: for each plate cell → scatter to recon annulus at dist2d ≈ r2d
      //
      // Each beat writes a sparse annular set of recon pixels. The full image
      // emerges only from += accumulation across the entire IFS tree.
      // Time (delay) is tethered to space (r2d) — the clock IS the wavefront.
      reconBeat: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        const { depth, delay, gen } = p;

        // Consume 2 RNG values — mirrors beat exactly for determinism
        const selfR      = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
        const childR     = IFS_MAPS[Math.floor(W.rng.next() * IFS_MAPS.length)];
        const selfDelay  = delay * selfR;
        const childDelay = delay * childR;

        // IFS clock fires regardless of LoD
        if (gen < IFS_GEN_CAP && selfDelay > IFS_MIN_DELAY)
          ctx.future(selfDelay, 'reconBeat', {
            depth, delay: selfDelay, gen: gen + 1, cycleId: s.cycleId,
          });
        if (gen === 0 && depth + 1 < IFS_DEPTH && childDelay > IFS_MIN_DELAY)
          ctx.future(selfDelay + childDelay, 'reconBeat', {
            depth: depth + 1, delay: childDelay, gen: 0, cycleId: s.cycleId,
          });

        const lodO = depth < LOD_OUTER.length ? LOD_OUTER[depth] : 0;
        if (!lodO) return { ...s, _reconBeatCount: s._reconBeatCount + 1, _reconBeatDepth: depth };

        const distTarget = delay / DELAY_SCALE;
        // r2d: 2D radius of back-propagating shell intersecting recon plane at RECON_Z
        const r2dSq = distTarget * distTarget - RECON_Z * RECON_Z;
        if (r2dSq < 0) return { ...s, _reconBeatCount: s._reconBeatCount + 1, _reconBeatDepth: depth };
        const r2d = Math.sqrt(r2dSq);

        const plate = s.plate;
        const recon = s._reconBuf ? s._reconBuf.slice() : new Array(2 * N_CELLS).fill(0);

        // Outer: plate cells (sources), strided by lodO.
        // Inner: bounding box of annulus at r2d ± 1.5, inline shell test.
        // plate stores +1 order cross-term — srcRe/srcIm read directly.
        for (let cy = 0; cy < GRID; cy += lodO) {
          for (let cx = 0; cx < GRID; cx += lodO) {
            const pid   = cy * GRID + cx;
            const srcRe = plate[pid * 2];
            const srcIm = plate[pid * 2 + 1];
            if (srcRe * srcRe + srcIm * srcIm < 1e-24) continue;

            const rMax = r2d + 1.5;
            const ry0  = Math.max(0,    Math.ceil (cy - rMax));
            const ry1  = Math.min(GRID, Math.floor(cy + rMax) + 1);
            const rx0  = Math.max(0,    Math.ceil (cx - rMax));
            const rx1  = Math.min(GRID, Math.floor(cx + rMax) + 1);

            for (let ry = ry0; ry < ry1; ry++) {
              const dy = ry - cy;
              for (let rx = rx0; rx < rx1; rx++) {
                const dx   = rx - cx;
                const d2   = Math.sqrt(dx * dx + dy * dy);
                if (Math.abs(d2 - r2d) >= 1.5) continue;
                const dist3d = Math.sqrt(dx * dx + dy * dy + RECON_Z * RECON_Z);
                const prop   = (dist3d / WAVELENGTH) * TWO_PI;
                const cosP   = Math.cos(prop), sinP = Math.sin(prop);
                const rid    = ry * GRID + rx;
                recon[rid * 2]     += (srcRe * cosP + srcIm * sinP) / dist3d;
                recon[rid * 2 + 1] += (-srcRe * sinP + srcIm * cosP) / dist3d;
              }
            }
          }
        }

        const reconEnergy = s.reconEnergy.slice();
        reconEnergy[depth] = Math.min(1, (reconEnergy[depth] ?? 0) + 0.3);
        const reconEvents = [...(s.reconEvents ?? []), { d: depth, delay, wt: ctx.wallTime }];
        return {
          ...s, _reconBuf: recon,
          _reconBeatCount: s._reconBeatCount + 1, _reconBeatDepth: depth,
          _reconRowIdx: s._reconRowIdx + 1,
          reconEnergy, reconEvents,
        };
      },

      // ── Lock in completed reconstruction ──────────────────────────────────
      finalizeRecon: (s, p, ctx) => {
        if (p.cycleId !== s.cycleId) return s;
        return { ...s, recon: s._reconBuf ? s._reconBuf.slice() : s.recon, _emitActive: false, _reconActive: false };
      },

    });
    }
  );

  const _isStable = W.stable([hologram4], reflector);
  const _export   = W.export(Renkon, { hologram4 }, _isStable);
`;

// ── Renderer ──────────────────────────────────────────────────────────────────
const DEPTH_COLORS = ['#E34A27', '#FEA655', '#FFD98E', '#566357', '#909473'];

function makeHologram4Renderer(core) {
  const { _seloInfo, _clientBadge, _renderAvatars } = core;

  return (world, peerId, containerId, sendCursorMove, injectEvent) => {
    if (!document.getElementById('hologram4-wrap')) {
      const wrap = document.createElement('div'); wrap.id = 'hologram4-wrap';
      Object.assign(wrap.style, { display: 'flex', gap: '0', flexWrap: 'wrap' });
      document.body.appendChild(wrap);
    }

    const root = document.createElement('div');
    root.id = containerId;
    Object.assign(root.style, {
      fontFamily: 'ui-monospace,monospace', padding: '12px',
      background: '#000', color: '#eee', borderRadius: '10px',
      margin: '10px', flex: '1', minWidth: '0', boxSizing: 'border-box',
      border: '1px solid #111',
    });
    document.getElementById('hologram4-wrap').appendChild(root);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '11px', fontWeight: 'bold',
      marginBottom: '8px', letterSpacing: '1px', textAlign: 'center',
    });
    root.appendChild(title);

    // ── Layout helpers ────────────────────────────────────────────────────────
    const makeCell = (label, color) => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { flex: '1', minWidth: '0' });
      const lbl = document.createElement('div');
      Object.assign(lbl.style, { fontSize: '8px', letterSpacing: '0.5px', textAlign: 'center', color, marginBottom: '3px' });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = GRID; canvas.height = GRID;
      Object.assign(canvas.style, { width: '100%', height: 'auto', imageRendering: 'pixelated', borderRadius: '3px', display: 'block' });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    const makeFullCell = (label, color) => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { flex: '1', minWidth: '0' });
      const lbl = document.createElement('div');
      Object.assign(lbl.style, { fontSize: '8px', letterSpacing: '0.5px', textAlign: 'center', color, marginBottom: '3px' });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 240;
      Object.assign(canvas.style, { width: '100%', height: 'auto', borderRadius: '3px', display: 'block', background: '#000' });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    const makeRow = (rowLabel) => {
      const section = document.createElement('div');
      Object.assign(section.style, { marginBottom: '12px' });
      if (rowLabel) {
        const rl = document.createElement('div');
        Object.assign(rl.style, { fontSize: '7px', color: '#222', letterSpacing: '1px', textAlign: 'center', marginBottom: '4px' });
        rl.textContent = rowLabel;
        section.appendChild(rl);
      }
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', gap: '6px' });
      section.appendChild(row);
      root.appendChild(section);
      return row;
    };

    // ── IFS clock viz panel (waterfall + phase rings + osc wheels) ───────────
    const makeIfsViz = (label, color) => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { width: '100%' });
      const lbl = document.createElement('div');
      Object.assign(lbl.style, { fontSize: '7px', letterSpacing: '0.5px', textAlign: 'center', color, marginBottom: '3px' });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const mkC = (w, h) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        Object.assign(c.style, { width: '100%', display: 'block', marginBottom: '2px' });
        wrap.appendChild(c);
        return c;
      };
      const wfCanvas     = mkC(115, 58);   // waterfall energy lines
      const ringsCanvas  = mkC(115, 115);  // phase rings
      const wheelsCanvas = mkC(115, 52);   // oscillator wheels
      return { wrap, wfCanvas, ringsCanvas, wheelsCanvas };
    };

    // ── Layout ────────────────────────────────────────────────────────────────
    // CSS grid: col1=clock(115px fixed) | col2=data | col3=data
    // Row 1: spacer | wireframe | orange wavefront
    // Row 2: emit IFS clock | blue hologram plate | (empty)
    // Row 3: recon IFS clock | recon log | recon contrast

    // Info stats (hidden, kept for render loop updates)
    const infoStats = document.createElement('div');
    infoStats.id = containerId + '-infostats';
    infoStats.style.display = 'none';

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: '115px 1fr 1fr',
      gap: '6px',
      alignItems: 'start',
    });
    root.appendChild(grid);

    const makeGridCell = (label, color, cw, ch) => {
      const wrap = document.createElement('div');
      const lbl = document.createElement('div');
      Object.assign(lbl.style, { fontSize: '8px', letterSpacing: '0.5px', textAlign: 'center', color, marginBottom: '3px' });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      Object.assign(canvas.style, { width: '100%', height: 'auto', imageRendering: 'pixelated', borderRadius: '3px', display: 'block' });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    // Row 1: empty col1 | orange wavefront col2 | wireframe col3
    const waveCell = makeGridCell('WAVEFRONT  (object field)', '#433', GRID, GRID);
    const objWire  = makeGridCell(`CUBE  (${CUBE_PTS.length} src) — click`, '#442', 240, 240);
    objWire.canvas.style.background = '#000';
    grid.appendChild(document.createElement('div'));
    grid.appendChild(waveCell.wrap);
    grid.appendChild(objWire.wrap);

    // Row 2: emit clock col1 | blue hologram col2 | info text col3
    const emitViz   = makeIfsViz('EMIT IFS', '#553');
    const plateCell = makeGridCell('HOLOGRAM PLATE  (+1 order)', '#226', GRID, GRID);
    const infoCell  = document.createElement('div');
    Object.assign(infoCell.style, { fontSize: '9px', color: '#444', lineHeight: '2.0', letterSpacing: '0.5px', paddingTop: '14px' });
    infoCell.innerHTML =
      `<div style="color:#553">PTS / EDGE</div><div style="color:#eee">${PTS_PER_EDGE}</div>` +
      `<div style="color:#553;margin-top:6px">PLATE GRID</div><div style="color:#eee">${GRID} × ${GRID}</div>` +
      `<div style="color:#553;margin-top:6px">WAVELENGTH</div><div style="color:#eee">${WAVELENGTH}</div>` +
      `<div style="color:#553;margin-top:6px">RECON Z</div><div style="color:#eee">${RECON_Z}</div>`;
    grid.appendChild(emitViz.wrap);
    grid.appendChild(plateCell.wrap);
    grid.appendChild(infoCell);

    // Row 3
    const reconViz    = makeIfsViz('RECON IFS', '#253');
    const reconCell   = makeGridCell('RECONSTRUCTION  (log scale)', '#0a5', GRID, GRID);
    const reconHiCell = makeGridCell('RECONSTRUCTION  (contrast)', '#143', GRID, GRID);
    grid.appendChild(reconViz.wrap);
    grid.appendChild(reconCell.wrap);
    grid.appendChild(reconHiCell.wrap);

    const waveCtx    = waveCell.ctx;
    // const refCtx  = refCell.ctx;
    const plateCtx   = plateCell.ctx;
    const reconCtx   = reconCell.ctx;
    const reconHiCtx = reconHiCell.ctx;

    const waveBuf    = waveCtx.createImageData(GRID, GRID);
    const plateBuf_  = plateCtx.createImageData(GRID, GRID);
    const reconBuf_  = reconCtx.createImageData(GRID, GRID);
    const reconHiBuf = reconHiCtx.createImageData(GRID, GRID);

    // Reference beam: commented out
    // (() => { ... refCtx.putImageData(buf, 0, 0); })();

    // ── Wireframe ─────────────────────────────────────────────────────────────
    const _project = (ox, oy, oz, angle, W, H) => {
      const cosY = Math.cos(angle), sinY = Math.sin(angle);
      const cosX = Math.cos(INIT_ANGLE_X), sinX = Math.sin(INIT_ANGLE_X);
      const ry1 =  cosY * ox + sinY * oz;
      const ry2 =  oy;
      const rz1 = -sinY * ox + cosY * oz;
      const rx  =  ry1;
      const ry  =  cosX * ry2 - sinX * rz1;
      const rz  =  sinX * ry2 + cosX * rz1;
      const halfG  = (GRID - 1) / 2;
      const fscale = halfG * PROJ_SCALE;
      const z = CAM_Z - rz;
      return {
        px: (halfG + (rx / z) * fscale * CAM_Z) / GRID * W,
        py: (halfG - (ry / z) * fscale * CAM_Z) / GRID * H,
        depth: rz,
      };
    };

    let _wireHover = 0;  // 0..1 glow intensity, client-only
    let _wireRafId = null;

    const _drawCube = (ctx, angle, glow) => {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

      // outer glow on hover
      if (glow > 0) {
        const gr = ctx.createRadialGradient(W/2, H/2, W*0.1, W/2, H/2, W*0.65);
        gr.addColorStop(0, `rgba(80,200,255,${0.10 * glow})`);
        gr.addColorStop(0.5, `rgba(40,120,220,${0.18 * glow})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      }

      const pts = CUBE_VERTS.map(([ox, oy, oz]) => _project(ox, oy, oz, angle, W, H));
      const glowBlue  = glow > 0;
      for (let pass = 0; pass < 2; pass++) {
        for (const [ai, bi] of CUBE_EDGES) {
          const a = pts[ai], b = pts[bi];
          const avgD  = (a.depth + b.depth) / 2;
          const isBack = avgD < 0;
          if (pass === 0 && !isBack) continue;
          if (pass === 1 &&  isBack) continue;
          const t      = (avgD + 1) / 2;
          const bright = isBack ? 0.15 + t * 0.1 : 0.5 + t * 0.5;
          const alpha  = isBack ? 0.25 : 0.9;
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
          if (glowBlue && !isBack) {
            // blue-cyan glow on front edges
            const r = Math.floor((bright*220)*(1-glow) + 40*glow);
            const g = Math.floor((bright*160)*(1-glow) + 180*glow);
            const bv = Math.floor((bright*30) *(1-glow) + 255*glow);
            ctx.strokeStyle = `rgba(${r},${g},${bv},${alpha})`;
            ctx.lineWidth = 1.5 + glow * 1.5;
            if (glow > 0.3) {
              ctx.shadowColor = `rgba(60,180,255,${glow * 0.8})`;
              ctx.shadowBlur  = 6 * glow;
            }
          } else {
            ctx.strokeStyle = `rgba(${Math.floor(bright*220)},${Math.floor(bright*160)},${Math.floor(bright*30)},${alpha})`;
            ctx.lineWidth = isBack ? 1 : 1.5;
            ctx.shadowBlur = 0;
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
      for (const { px, py, depth } of pts) {
        const t = (depth + 1) / 2, bright = 0.4 + t * 0.6;
        ctx.beginPath(); ctx.arc(px, py, 3 + t * 3, 0, Math.PI * 2);
        if (glowBlue) {
          const r = Math.floor(bright*255*(1-glow) + 60*glow);
          const g = Math.floor(bright*180*(1-glow) + 200*glow);
          const bv = Math.floor(bright*40*(1-glow) + 255*glow);
          ctx.fillStyle = `rgba(${r},${g},${bv},0.95)`;
          ctx.shadowColor = `rgba(80,200,255,${glow * 0.9})`;
          ctx.shadowBlur  = 8 * glow;
        } else {
          ctx.fillStyle = `rgba(${Math.floor(bright*255)},${Math.floor(bright*180)},${Math.floor(bright*40)},0.95)`;
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = glow > 0.3 ? `rgba(80,200,255,${0.4 + glow*0.4})` : 'rgba(200,150,30,0.3)';
      ctx.font = '7px ui-monospace,monospace';
      ctx.fillText(`cube ${CUBE_PTS.length} src  θ=${(angle * 180 / Math.PI).toFixed(1)}°`, 4, H - 4);
    };

    // ── Tone mapping ──────────────────────────────────────────────────────────
    const logScale = 1 / Math.log(1 + 9);

    const maxI = (field) => {
      let m = 1e-9;
      for (let i = 0; i < N_CELLS; i++) {
        const re = field[i*2], im = field[i*2+1];
        const v = re*re + im*im;
        if (v > m) m = v;
      }
      return m;
    };

    const paintLog = (buf, field, tint) => {
      const mi = maxI(field); if (mi < 1e-6) { buf.data.fill(0); return; }
      const norm = 1 / Math.sqrt(mi);
      for (let i = 0; i < N_CELLS; i++) {
        const re = field[i*2], im = field[i*2+1];
        const amp = Math.sqrt(re*re + im*im) * norm;
        const v = Math.log(1 + 9 * amp) * logScale;
        buf.data[i*4]   = Math.floor(v * tint[0]);
        buf.data[i*4+1] = Math.floor(v * tint[1]);
        buf.data[i*4+2] = Math.floor(v * tint[2]);
        buf.data[i*4+3] = 255;
      }
    };

    const paintReconHi = (buf, field) => {
      const mi = maxI(field); if (mi < 1e-6) { buf.data.fill(0); return; }
      const norm = 1 / Math.sqrt(mi);
      for (let i = 0; i < N_CELLS; i++) {
        const re = field[i*2], im = field[i*2+1];
        const amp = Math.sqrt(re*re + im*im) * norm;
        const t = Math.max(0, (amp - 0.2) / 0.8);
        const v = Math.pow(t, 0.35);
        buf.data[i*4]   = Math.floor(v * v * 255);
        buf.data[i*4+1] = Math.floor(v * 255);
        buf.data[i*4+2] = Math.floor(v * 255);
        buf.data[i*4+3] = 255;
      }
    };


    // ── IFS viz state ─────────────────────────────────────────────────────────
    const IFS_VIZ_DEPTH = IFS_DEPTH;
    const MAX_WF_HISTORY = 50;
    const emitWfHistory  = [];  // [{energy[]}]
    const reconWfHistory = [];
    let emitTlEvents = [], reconTlEvents = [];
    let emitLtPhase  = new Array(IFS_VIZ_DEPTH).fill(0);
    let reconLtPhase = new Array(IFS_VIZ_DEPTH).fill(0);
    let emitLastDelay  = new Array(IFS_VIZ_DEPTH).fill(IFS_BASE_DELAY);
    let reconLastDelay = new Array(IFS_VIZ_DEPTH).fill(RECON_BASE_DELAY);
    let _vizLt = -1;

    const _drawIfsViz = (viz, energy, tlEvents, ltPhase, lastDelay, tint) => {
      const DEPTH = IFS_VIZ_DEPTH;
      const depthColorsLocal = DEPTH_COLORS;

      // Waterfall
      const wf = viz.wfCanvas; const wc = wf.getContext('2d');
      const WW = wf.width, WH = wf.height;
      const wfHist = tint === 'emit' ? emitWfHistory : reconWfHistory;
      wc.clearRect(0, 0, WW, WH);
      if (wfHist.length > 1) {
        for (let d = DEPTH - 1; d >= 0; d--) {
          const col = depthColorsLocal[d] ?? '#888';
          wc.strokeStyle = col; wc.lineWidth = 1; wc.globalAlpha = 0.5 + d * 0.1;
          wc.beginPath();
          wfHist.forEach((snap, i) => {
            const x = (i / (MAX_WF_HISTORY - 1)) * WW;
            const e = Math.min(1, snap[d] ?? 0);
            const baseline = WH - 2 - d * (WH / DEPTH);
            const y = baseline - e * (WH / DEPTH - 2);
            if (i === 0) wc.moveTo(x, y); else wc.lineTo(x, y);
          });
          wc.stroke();
        }
        wc.globalAlpha = 1;
      }

      // Phase rings
      const rc = viz.ringsCanvas; const r2d = rc.getContext('2d');
      const RW = rc.width, RH = rc.height;
      const cx = RW / 2, cy = RH / 2;
      const R_MAX = Math.min(cx, cy) - 4, R_MIN = 8;
      const depthR = d => R_MAX - d * (R_MAX - R_MIN) / Math.max(1, DEPTH - 1);
      const RING_W = (R_MAX - R_MIN) / Math.max(1, DEPTH - 1) * 0.35;
      const ARC_W  = 0.06 * Math.PI;
      r2d.clearRect(0, 0, RW, RH);
      for (let d = 0; d < DEPTH; d++) {
        r2d.strokeStyle = depthColorsLocal[d]; r2d.lineWidth = 0.5; r2d.globalAlpha = 0.1;
        r2d.beginPath(); r2d.arc(cx, cy, depthR(d), 0, Math.PI * 2); r2d.stroke();
      }
      for (const { d, wt } of tlEvents) {
        if (d >= DEPTH) continue;
        const e   = Math.min(1, energy[d] ?? 0);
        const col = depthColorsLocal[d] ?? '#888';
        const r   = depthR(d);
        const angle = (wt % 1) * Math.PI * 2 - Math.PI / 2;
        r2d.fillStyle = col; r2d.globalAlpha = 0.15 + e * 0.7;
        r2d.shadowColor = col; r2d.shadowBlur = e * 6;
        r2d.beginPath();
        r2d.arc(cx, cy, r + RING_W, angle - ARC_W, angle + ARC_W);
        r2d.arc(cx, cy, r - RING_W, angle + ARC_W, angle - ARC_W, true);
        r2d.closePath(); r2d.fill();
        r2d.shadowBlur = 0;
      }
      // Hands
      const handAngle = ltPhase[0] * Math.PI * 2 - Math.PI / 2;
      for (let d = DEPTH - 1; d >= 0; d--) {
        const e = Math.min(1, energy[d] ?? 0);
        const dr = depthR(d); const col = depthColorsLocal[d];
        r2d.strokeStyle = col; r2d.lineWidth = 1 + e * 1.5;
        r2d.globalAlpha = 0.15 + e * 0.8;
        r2d.shadowColor = col; r2d.shadowBlur = e * 12;
        r2d.beginPath(); r2d.moveTo(cx, cy);
        r2d.lineTo(cx + dr * Math.cos(handAngle), cy + dr * Math.sin(handAngle)); r2d.stroke();
        r2d.shadowBlur = 0;
      }
      r2d.fillStyle = '#050508'; r2d.globalAlpha = 1;
      r2d.beginPath(); r2d.arc(cx, cy, R_MIN - 2, 0, Math.PI * 2); r2d.fill();
      r2d.globalAlpha = 1;

      // Oscillator wheels
      const pw = viz.wheelsCanvas; const pc = pw.getContext('2d');
      const PW = pw.width, PH = pw.height;
      const WR = 20, GAP = PW / DEPTH;
      pc.clearRect(0, 0, PW, PH);
      for (let d = 0; d < DEPTH; d++) {
        const wcx = GAP * d + GAP / 2, wcy = WR + 6;
        const e   = Math.min(1, energy[d] ?? 0);
        const col = depthColorsLocal[d];
        const periodTicks = lastDelay[d] > 0 ? lastDelay[d] : IFS_BASE_DELAY / Math.pow(2, d);
        const periodMs = periodTicks * REFLECTOR_MS;
        const cyclesElapsed = ltPhase[d];
        const spins = 16.7 / periodMs;
        const SAMPLES = Math.max(1, Math.min(24, Math.ceil(spins * 4)));
        const baseAlpha = (0.15 + e * 0.75) / Math.sqrt(SAMPLES);
        pc.strokeStyle = '#1a1a28'; pc.lineWidth = 0.5; pc.globalAlpha = 0.5;
        pc.beginPath(); pc.arc(wcx, wcy, WR, 0, Math.PI * 2); pc.stroke();
        pc.strokeStyle = col; pc.lineWidth = 1; pc.globalAlpha = baseAlpha;
        for (let s = 0; s < SAMPLES; s++) {
          const t = (s + 1) / SAMPLES;
          const phase = cyclesElapsed - spins * (1 - t);
          const a = phase * Math.PI * 2 - Math.PI / 2;
          pc.beginPath(); pc.moveTo(wcx, wcy); pc.lineTo(wcx + WR * Math.cos(a), wcy + WR * Math.sin(a)); pc.stroke();
        }
        const tipAngle = cyclesElapsed * Math.PI * 2 - Math.PI / 2;
        pc.strokeStyle = col; pc.lineWidth = 1.5; pc.globalAlpha = 0.9;
        pc.shadowColor = col; pc.shadowBlur = 4;
        pc.beginPath(); pc.moveTo(wcx, wcy); pc.lineTo(wcx + WR * Math.cos(tipAngle), wcy + WR * Math.sin(tipAngle)); pc.stroke();
        pc.shadowBlur = 0;
        pc.fillStyle = col; pc.globalAlpha = 0.4 + e * 0.5;
        pc.beginPath(); pc.arc(wcx, wcy, 1.5, 0, Math.PI * 2); pc.fill();
        pc.fillStyle = col; pc.globalAlpha = 0.5;
        pc.font = '5px ui-monospace'; pc.textAlign = 'center';
        pc.fillText('D' + d, wcx, wcy + WR + 8);
      }
      pc.globalAlpha = 1;
    };

    // ── Wireframe interactions ────────────────────────────────────────────────
    objWire.canvas.style.cursor = 'pointer';

    // Hover glow — client-only, RAF-driven smooth fade
    let _wireAngleSnap = 0;
    const _wireRafDraw = () => {
      _wireRafId = null;
      _drawCube(objWire.ctx, _wireAngleSnap, _wireHover);
      if (_wireHover > 0.01) _wireRafId = requestAnimationFrame(_wireRafDraw);
    };
    objWire.canvas.addEventListener('mouseenter', () => {
      _wireHover = 1;
      if (!_wireRafId) { _wireRafId = requestAnimationFrame(_wireRafDraw); }
    });
    objWire.canvas.addEventListener('mouseleave', () => {
      const fade = () => {
        _wireHover = Math.max(0, _wireHover - 0.06);
        _drawCube(objWire.ctx, _wireAngleSnap, _wireHover);
        if (_wireHover > 0.01) requestAnimationFrame(fade);
      };
      requestAnimationFrame(fade);
    });

    // Click + touch → replicated nextCycle event
    const _triggerCycle = () => injectEvent?.({ type: 'nextCycle' });
    objWire.canvas.addEventListener('click', _triggerCycle);
    objWire.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      _wireHover = 1;
      if (!_wireRafId) { _wireRafId = requestAnimationFrame(_wireRafDraw); }
    }, { passive: false });
    objWire.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      _triggerCycle();
    }, { passive: false });

    // ── IFS viz RAF loop — each panel animates only during its active phase ───
    let _vizRafId = null;
    let _emitVizActive = false, _reconVizActive = false;
    let _vizEmitSnap = [], _vizReconSnap = [];

    const _rafDrawViz = () => {
      _vizRafId = null;
      if (!_emitVizActive && !_reconVizActive) return;
      if (_emitVizActive)  _drawIfsViz(emitViz,  _vizEmitSnap,  emitTlEvents,  emitLtPhase,  emitLastDelay,  'emit');
      if (_reconVizActive) _drawIfsViz(reconViz, _vizReconSnap, reconTlEvents, reconLtPhase, reconLastDelay, 'recon');
      _vizRafId = requestAnimationFrame(_rafDrawViz);
    };

    // ── Render loop ───────────────────────────────────────────────────────────
    return () => {
      const h = world.getNodeState('hologram4');
      if (!h) return;

      const lt              = world.ps.app.logicalTime ?? 0;
      const angle           = h.angle ?? 0;
      const beatDepth       = h._beatDepth ?? 0;
      const beatCount       = h._beatCount ?? 0;
      const reconBeatCount  = h._reconBeatCount ?? 0;
      const reconBeatDepth  = h._reconBeatDepth ?? 0;
      const reconRowIdx     = h._reconRowIdx ?? 0;

      // Title color = current IFS depth color
      const depthCol = DEPTH_COLORS[beatDepth % DEPTH_COLORS.length];
      title.style.color = depthCol;
      const isEmitting = beatCount > 0 && reconBeatCount === 0;
      title.textContent =
        `PEER ${peerId} · HOLOGRAM  (IFS fractal clock)  ` +
        (isEmitting
          ? `[EMIT ◉ D${beatDepth} · ${beatCount} beats]`
          : `[RECON ◎ D${reconBeatDepth} · ${reconBeatCount} beats]`);

      // IFS viz update (once per lt)
      if (lt !== _vizLt) {
        _vizLt = lt;
        const eEnergy = h.emitEnergy ?? new Array(IFS_VIZ_DEPTH).fill(0);
        const rEnergy = h.reconEnergy ?? new Array(IFS_VIZ_DEPTH).fill(0);
        if (h._emitActive)  { emitWfHistory.push(eEnergy.slice());  if (emitWfHistory.length  > MAX_WF_HISTORY) emitWfHistory.shift(); }
        if (h._reconActive) { reconWfHistory.push(rEnergy.slice()); if (reconWfHistory.length > MAX_WF_HISTORY) reconWfHistory.shift(); }
        emitTlEvents  = (h.emitEvents  ?? []).slice(-60);
        reconTlEvents = (h.reconEvents ?? []).slice(-60);
        // Phase driven by beat wallTime / delay — frozen when no events
        for (const { d, delay, wt } of emitTlEvents) {
          if (d < IFS_VIZ_DEPTH && delay > 0) {
            emitLastDelay[d] = delay;
            emitLtPhase[d]   = (wt / delay) % 1;
          }
        }
        for (const { d, delay, wt } of reconTlEvents) {
          if (d < IFS_VIZ_DEPTH && delay > 0) {
            reconLastDelay[d] = delay;
            reconLtPhase[d]   = (wt / delay) % 1;
          }
        }
      }
      // Start/stop RAF viz: each panel animates only during its active phase
      _vizEmitSnap  = h.emitEnergy  ?? [];
      _vizReconSnap = h.reconEnergy ?? [];
      _emitVizActive  = !!h._emitActive;
      _reconVizActive = !!h._reconActive;
      if ((_emitVizActive || _reconVizActive) && !_vizRafId) {
        _vizRafId = requestAnimationFrame(_rafDrawViz);
      }

      _wireAngleSnap = angle;
      if (!_wireRafId) _drawCube(objWire.ctx, angle, _wireHover);

      const pbHas = h._plateBuf && maxI(h._plateBuf) > 1e-6;
      const rbHas = h._reconBuf && maxI(h._reconBuf) > 1e-6;
      const rawPlateHas = h.plate && maxI(h.plate) > 1e-6;

      // Row 1 col 3: orange object wavefront (raw accumulation before reference beam)
      const wf = rawPlateHas ? h.plate : null;
      if (wf) { paintLog(waveBuf, wf, [255, 120, 30]); waveCtx.putImageData(waveBuf, 0, 0); }

      // Row 2 col 3: hologram plate after +1 order extraction (blue)
      if (h.plate && maxI(h.plate) > 1e-6) {
        paintLog(plateBuf_, h.plate, [40, 60, 255]);
        plateCtx.putImageData(plateBuf_, 0, 0);
      }

      // Row 3 col 2+3: reconstruction log + contrast
      const rf = rbHas ? h._reconBuf : (h.recon && maxI(h.recon) > 1e-6 ? h.recon : null);
      if (rf) {
        paintLog(reconBuf_, rf, [30, 255, 140]);
        reconCtx.putImageData(reconBuf_, 0, 0);
        paintReconHi(reconHiBuf, rf);
        reconHiCtx.putImageData(reconHiBuf, 0, 0);
      }

      // Info cell
      const drain = world.ps.app._lastDrainIters ?? 0;
      const cycleCount = h.cycleCount ?? 0;
      const infoEl = document.getElementById(containerId + '-infostats');
      if (infoEl) infoEl.innerHTML =
        `PEER ${peerId}<br>` +
        `cycle ${cycleCount}  θ=${(angle * 180 / Math.PI).toFixed(1)}°<br>` +
        `lt=${lt}  drain=${drain}i<br>` +
        `emit=${beatCount}  recon=${reconBeatCount}<br>` +
        _clientBadge(world);

      _renderAvatars(world, root);
    };
  };
}

export default {
  title:       'Hologram | IFS Fractal Clock',
  selo:        'hologram',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologram4WorldProgram + av],
  makeRenderer: makeHologram4Renderer,
  wrapId:      'hologram-wrap',
  hideTopBar:  true,
};
