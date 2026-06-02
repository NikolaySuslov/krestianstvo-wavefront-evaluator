/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
// ── Hologram4 | Fully Native IFS Holography ──────────────────────────────────
//
// Strict native spacetime: object, reference, recording, and reconstruction are
// all generated solely by _linearStepIFS / fresnelBeat — no external math.
//
// Object wave:  depth-tier-encoded sources (sz → N_DEPTH_TIERS IFS delay buckets)
// Reference:    line of unit sources at y=0 → T_RECORD IFS steps (refField)
// Plate:        |ψ_obj_IFS + refField|²  accumulated with PLATE_DECAY
// Reconstruct:  psi_0 = plate × conj(refField) → T_RECORD backward IFS steps
//               → Lévy-flight tails collapse, source constellation re-focuses
//
// The "anomalous tails" in reconstruction are physical — proof of fractal medium.
//
// Mode RECORD  (+DT): source continuously drives ψ → fringes form on plate.
// Mode RECON   (−DT): reference×plate initialises ψ, propagates backward →
//                     cube wavefront reconstructs in the intensity canvas.
//
// Controls:
//   Drag any canvas or wireframe → rotate cube (updates source at next cycle)
//   [RECORD]  /  [RECONSTRUCT] buttons → toggle propagation direction
//   [RESET PLATE] button → clear accumulated exposure and return to init angle
//   Dbl-click any canvas → manual IFS next-cycle

import { makeIFSClockPanel, IFS_DEPTH_COLORS } from '../krestianstvo-wavefront-renderer.js';
import { IFSGpu } from '../ifs-gpu.js';
import {
  hologramWorldProgram,
  REFLECTOR_MS, SUBTICK_MS,
  GRID, N_CELLS, DT, REF_AMP, REF_KX, SRC_ALPHA, PLATE_DECAY, K_WAVE,
  T_RECORD, RENDER_SCALE, FRAC_ALPHA, MAX_IFS_BANDS, N_DEPTH_TIERS, TOMO_MODE,
  IFS_DEPTH, IFS_GEN_CAP, IFS_MIN_DELAY, IFS_BASE_DELAY, FRESNEL_DONE_DELAY,
  NEXT_STEP_DELAY, RECON_STEP_DELAY, RECON_HOLD_MS, DELAY_SCALE, WAVELENGTH,
  CAM_Z, PROJ_SCALE, INIT_ANGLE_Y, INIT_ANGLE_X, PTS_PER_EDGE,
  CUBE_PTS, PYRAMID_PTS, COMBINED_PTS,
  CUBE_VERTS, CUBE_EDGES, PYRAMID_VERTS, PYRAMID_EDGES,
  HOUSE_PYRAMID_VERTS, HOUSE_PYRAMID_EDGES,
} from '../hologram_world.js';
const hologram4WorldProgram = hologramWorldProgram;
import { colormaps } from '../krestianstvo-wavefront-physics.js';
// ── Renderer-local physics (mirror of world program, no network) ─────────────
// Build callable versions of the IFS physics functions for use in the renderer.
// These are the same algorithms the model uses, evaluated with the same constants.
const _rendererPhysics = (() => {
  const TWO_PI   = 2 * Math.PI;
  const NCELLS   = N_CELLS;
  const SHAPE_PTS = { cube: CUBE_PTS, pyramid: PYRAMID_PTS, combined: COMBINED_PTS, none: [] };

  // ── _buildRingOffsets and _linearStepIFS ────────────────────────────────
  const _buildRingOffsets = (fRadii) => fRadii.map(r => {
    const nSteps = Math.max(8, Math.ceil(2 * Math.PI * r));
    const flat = new Int16Array(nSteps * 2);
    for (let k = 0; k < nSteps; k++) {
      flat[k*2]   = Math.round(r * Math.cos(k * TWO_PI / nSteps));
      flat[k*2+1] = Math.round(r * Math.sin(k * TWO_PI / nSteps));
    }
    return flat;
  });

  // Jacobi leapfrog: compute full Laplacian from unmodified source array before
  // any cell is updated. This makes the step exactly time-reversible: -DT undoes +DT
  // to machine precision. The previous in-place (Gauss-Seidel) version was NOT
  // reversible because lower-index cells were read after being written.
  const _lapComp = (src, comp, G, offs, ringN, ringNorm, nF) => {
    const lap = new Float64Array(G * G);
    for (let y = 0; y < G; y++) {
      const ym = ((y - 1 + G) % G) * G;
      const yp = ((y + 1)     % G) * G;
      for (let x = 0; x < G; x++) {
        const id = y*G + x;
        const xm = (x - 1 + G) % G;
        const xp = (x + 1)     % G;
        let l = src[(y*G+xp)*2+comp] + src[(y*G+xm)*2+comp]
              + src[(yp+x)*2+comp]   + src[(ym+x)*2+comp]
              - 4*src[id*2+comp];
        for (let d = 0; d < nF; d++) {
          const flat = offs[d]; const n = ringN[d]; const sc = ringNorm[d];
          const cbase = src[id*2+comp];
          let acc = 0;
          for (let i = 0; i < n; i++) {
            const nx = ((x + flat[i*2])   % G + G) % G;
            const ny = ((y + flat[i*2+1]) % G + G) % G;
            acc += src[(ny*G + nx)*2 + comp];
          }
          l += sc * (acc - n * cbase);
        }
        lap[id] = l;
      }
    }
    return lap;
  };

  const _linearStepIFS = (psi, dt, fRadii, fWeights, fOffs) => {
    const out  = new Float64Array(psi);
    const h    = dt * 0.25;
    const G    = GRID;
    const nF   = fRadii.length;
    const offs = fOffs ?? _buildRingOffsets(fRadii);
    const ringN    = new Int32Array(nF);
    const ringNorm = new Float64Array(nF);
    for (let d = 0; d < nF; d++) {
      ringN[d]    = offs[d].length >> 1;
      ringNorm[d] = fWeights[d] * 4 / ringN[d];
    }
    // Step 1: Re -= (dt/4)·L[Im]  — Jacobi: lap computed from unmodified out
    const lap1 = _lapComp(out, 1, G, offs, ringN, ringNorm, nF);
    for (let j = 0; j < G*G; j++) out[j*2] -= h * lap1[j];
    // Step 2: Im += (dt/2)·L[Re]  — lap from updated Re, unmodified Im
    const lap2 = _lapComp(out, 0, G, offs, ringN, ringNorm, nF);
    for (let j = 0; j < G*G; j++) out[j*2+1] += dt * 0.5 * lap2[j];
    // Step 3: Re -= (dt/4)·L[Im]  — lap from updated Im, same form as step 1
    const lap3 = _lapComp(out, 1, G, offs, ringN, ringNorm, nF);
    for (let j = 0; j < G*G; j++) out[j*2] -= h * lap3[j];
    return out;
  };

  // ── Project cube sources ─────────────────────────────────────────────────
  const _projectSources = (angleY, angleX, shape = 'cube') => {
    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const halfG = (GRID - 1) / 2;
    const fscale = halfG * PROJ_SCALE;
    const reconZ = Math.round(GRID / 16);
    const pts    = SHAPE_PTS[shape] ?? CUBE_PTS;
    const total  = pts.length;
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

  // ── Point-pixel source field — used for objField (RECORD display + RECON attractor) ──
  const _buildSrcFieldIFS = (angleY, angleX, extraPoints, shape = 'cube') => {
    const sources = _projectSources(angleY, angleX, shape);
    const field   = new Float64Array(2 * NCELLS);
    let szMin = Infinity, szMax = -Infinity;
    for (const { sz } of sources) { if (sz < szMin) szMin = sz; if (sz > szMax) szMax = sz; }
    const szRange = Math.max(1e-4, szMax - szMin);
    for (let k = 0; k < sources.length; k++) {
      const { sx, sy, sz, amp } = sources[k];
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

  // ── IFS-depth source schedule ────────────────────────────────────────────────
  // Returns Array[tRecord] where each entry is a Float64Array injection field or null.
  // Point p at depth sz gets Tp propagation steps → injected at step (tRecord-1-Tp).
  // All vertices fire into the same running field → they interfere = the hologram.
  // Backward sweep from swPsi recovers each vertex at its Tp backward step.
  const _buildDepthSourceSchedule = (angleY, angleX, extraPoints, shape, tRecord) => {
    const sources = _projectSources(angleY, angleX, shape);
    let szMin = Infinity, szMax = -Infinity;
    for (const { sz } of sources) { if (sz < szMin) szMin = sz; if (sz > szMax) szMax = sz; }
    const szRange = Math.max(1e-4, szMax - szMin);
    const schedule = new Array(tRecord).fill(null);
    const addInj = (step, j, amp) => {
      if (step < 0 || step >= tRecord) return;
      if (!schedule[step]) schedule[step] = new Float64Array(2 * NCELLS);
      schedule[step][j*2] += amp;
    };
    for (const { sx, sy, sz, amp } of sources) {
      const ix = Math.round(sx) | 0, iy = Math.round(sy) | 0;
      if (ix < 0 || ix >= GRID || iy < 0 || iy >= GRID) continue;
      const t  = Math.max(0, Math.min(1, (sz - szMin) / szRange));
      const Tp = Math.round(t * (tRecord - 1));
      addInj(tRecord - 1 - Tp, iy * GRID + ix, amp);
    }
    for (const pt of (extraPoints ?? [])) addInj(tRecord - 1, pt.gy * GRID + pt.gx, pt.amp);
    return schedule;
  };

  // ── Volumetric source field — used for plate recording only ──────────────────
  // Each cube point emits a spherical wave across the grid, encoding all viewing
  // angles and depth in a single exposure (true Gabor hologram geometry).
  const VOL_DEPTH_SCALE = 8; // multiply per-point sz to increase fringe curvature
  const _buildVolSrcField = (angleY, angleX, extraPoints, shape = 'cube') => {
    const sources = _projectSources(angleY, angleX, shape);
    const field   = new Float64Array(2 * NCELLS);
    for (let k = 0; k < sources.length; k++) {
      const { sx, sy, sz, amp } = sources[k];
      const szScaled = sz * VOL_DEPTH_SCALE;
      for (let j = 0; j < NCELLS; j++) {
        const cx = j % GRID, cy = (j / GRID) | 0;
        const dx = cx - sx, dy = cy - sy;
        const r  = Math.sqrt(dx*dx + dy*dy + szScaled*szScaled);
        const ph = K_WAVE * r;
        const a  = amp / (r + 1);
        field[j*2]   += a * Math.cos(ph);
        field[j*2+1] += a * Math.sin(ph);
      }
    }
    for (const pt of (extraPoints ?? [])) {
      const j = pt.gy * GRID + pt.gx;
      field[j*2]   += pt.amp * Math.cos(pt.ph);
      field[j*2+1] += pt.amp * Math.sin(pt.ph);
    }
    return field;
  };

  // ── Reconstruction seed from plate ───────────────────────────────────────
  // Multiply DC-suppressed plate by conjugate of actual reference field.
  // refField: the real propagated reference (T_RECORD IFS steps from _initRefPsi).
  // Without refField falls back to plane-wave demodulation.
  const _buildReconField = (plate, dKX = 0, rotAngle = 0, refField = null, dKY = 0, shiftX = 0, shiftY = 0, scale = 1) => {
    // DC suppression
    let sumP = 0;
    for (let j = 0; j < NCELLS; j++) sumP += plate[j];
    const meanP = sumP / NCELLS;
    let maxAbs = 1e-9;
    for (let j = 0; j < NCELLS; j++) {
      const v = Math.abs(plate[j] - meanP);
      if (v > maxAbs) maxAbs = v;
    }
    const cosR = Math.cos(rotAngle), sinR = Math.sin(rotAngle);
    const halfG = (GRID - 1) / 2;
    const psi = new Float64Array(2 * NCELLS);
    for (let j = 0; j < NCELLS; j++) {
      const cx = j % GRID, cy = (j / GRID) | 0;
      const dx = cx - halfG, dy = cy - halfG;
      // rotate then scale then shift
      const rx = (dx * cosR - dy * sinR) / scale + halfG + shiftX;
      const ry = (dx * sinR + dy * cosR) / scale + halfG + shiftY;
      const x0 = Math.floor(rx), y0 = Math.floor(ry);
      const tx = rx - x0, ty = ry - y0;
      const inB = (x, y) => x >= 0 && x < GRID && y >= 0 && y < GRID;
      const sp = (x, y) => inB(x, y) ? Math.max(-maxAbs, Math.min(maxAbs, plate[y * GRID + x] - meanP)) / maxAbs : 0;
      const y1 = y0 + 1;
      const mod = (1-tx)*(1-ty)*sp(x0,y0) + tx*(1-ty)*sp(x0+1,y0)
                + (1-tx)*ty*sp(x0,y1)      + tx*ty*sp(x0+1,y1);
      let rr, ri;
      if (refField) {
        rr =  refField[j*2];
        ri = -refField[j*2+1];
      } else {
        const ph = (REF_KX + dKX) * cx + dKY * cy;
        rr =  Math.cos(ph);
        ri = -Math.sin(ph);
      }
      const wx = 0.5 * (1 - Math.cos(2 * Math.PI * cx / (GRID - 1)));
      const wy = 0.5 * (1 - Math.cos(2 * Math.PI * cy / (GRID - 1)));
      psi[j*2]   = mod * rr * wx * wy;
      psi[j*2+1] = mod * ri * wx * wy;
    }
    return psi;
  };

  // ── Reference wave initial condition ─────────────────────────────────────
  const _initRefPsi = () => {
    // Plane wave REF_AMP·exp(i·REF_KX·x) — off-axis carrier enables plate demodulation
    const psi = new Float64Array(2 * NCELLS);
    for (let j = 0; j < NCELLS; j++) {
      const x = j % GRID;
      psi[j*2]   = REF_AMP * Math.cos(REF_KX * x);
      psi[j*2+1] = REF_AMP * Math.sin(REF_KX * x);
    }
    return psi;
  };

  return { _linearStepIFS, _buildRingOffsets, _buildSrcFieldIFS, _buildVolSrcField, _buildReconField, _initRefPsi, _buildDepthSourceSchedule };
})();

// ── Renderer ──────────────────────────────────────────────────────────────────
function makeHologram4Renderer(core) {
  const { _clientBadge, _renderAvatars } = core;
  const { _linearStepIFS, _buildSrcFieldIFS, _buildVolSrcField, _buildReconField, _initRefPsi, _buildDepthSourceSchedule } = _rendererPhysics;

  const RW = GRID * RENDER_SCALE;
  const RH = GRID * RENDER_SCALE;

  const _project = (ox, oy, oz, angleY, angleX, W, H) => {
    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const halfG = (GRID - 1) / 2, fsc = halfG * PROJ_SCALE;
    const ry1 =  cosY*ox + sinY*oz, rz1 = -sinY*ox + cosY*oz;
    const rx = ry1, ry = cosX*oy - sinX*rz1, rz = sinX*oy + cosX*rz1;
    const z  = CAM_Z - rz;
    return { px: (halfG + (rx/z)*fsc*CAM_Z)/GRID*W, py: (halfG - (ry/z)*fsc*CAM_Z)/GRID*H, depth: rz };
  };

  const _WIRE_SHAPES = {
    cube:     { verts: CUBE_VERTS,    edges: CUBE_EDGES },
    pyramid:  { verts: PYRAMID_VERTS, edges: PYRAMID_EDGES },
    combined: { verts: [...CUBE_VERTS, ...HOUSE_PYRAMID_VERTS],
                edges: [...CUBE_EDGES, ...HOUSE_PYRAMID_EDGES.map(([a,b]) => [a + CUBE_VERTS.length, b + CUBE_VERTS.length])] },
  };
  const _drawCube = (ctx2d, angleY, angleX, glow, shape = 'cube') => {
    const CW = ctx2d.canvas.width, CH = ctx2d.canvas.height;
    ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, CW, CH);
    if (glow > 0.02) {
      const gr = ctx2d.createRadialGradient(CW/2,CH/2,CW*0.05, CW/2,CH/2,CW*0.6);
      gr.addColorStop(0, `rgba(60,180,255,${0.12*glow})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx2d.fillStyle = gr; ctx2d.fillRect(0, 0, CW, CH);
    }
    if (shape === 'none') return;
    const { verts, edges } = _WIRE_SHAPES[shape] ?? _WIRE_SHAPES.cube;
    const pts = verts.map(([ox,oy,oz]) => _project(ox,oy,oz,angleY,angleX,CW,CH));
    for (let pass = 0; pass < 2; pass++) {
      for (const [ai, bi] of edges) {
        const a = pts[ai], b = pts[bi];
        const avgD = (a.depth + b.depth) / 2, isBack = avgD < 0;
        if (pass === 0 && !isBack) continue;
        if (pass === 1 &&  isBack) continue;
        const t = (avgD + 1) / 2, bright = isBack ? 0.15 + t*0.1 : 0.5 + t*0.5;
        ctx2d.beginPath(); ctx2d.moveTo(a.px, a.py); ctx2d.lineTo(b.px, b.py);
        if (glow > 0.02 && !isBack) {
          ctx2d.strokeStyle = `rgba(${Math.floor(40+bright*180*(1-glow))},${Math.floor(160*glow+bright*100*(1-glow))},255,${isBack?0.2:0.9})`;
          ctx2d.lineWidth = 1.5 + glow;
          ctx2d.shadowColor = `rgba(60,180,255,${glow*0.7})`; ctx2d.shadowBlur = 5*glow;
        } else {
          ctx2d.strokeStyle = `rgba(${Math.floor(bright*220)},${Math.floor(bright*160)},${Math.floor(bright*30)},${isBack?0.22:0.85})`;
          ctx2d.lineWidth = isBack ? 0.8 : 1.4; ctx2d.shadowBlur = 0;
        }
        ctx2d.stroke(); ctx2d.shadowBlur = 0;
      }
    }
    for (const { px, py, depth } of pts) {
      const t = (depth+1)/2, bright = 0.4 + t*0.6;
      ctx2d.beginPath(); ctx2d.arc(px, py, 2 + t*2, 0, Math.PI*2);
      ctx2d.fillStyle = glow > 0.02
        ? `rgba(${Math.floor(bright*255*(1-glow)+60*glow)},${Math.floor(bright*180*(1-glow)+200*glow)},255,0.9)`
        : `rgba(${Math.floor(bright*255)},${Math.floor(bright*180)},${Math.floor(bright*40)},0.9)`;
      ctx2d.shadowColor = glow > 0.02 ? `rgba(80,200,255,${glow*0.8})` : 'transparent';
      ctx2d.shadowBlur  = glow > 0.02 ? 6*glow : 0;
      ctx2d.fill(); ctx2d.shadowBlur = 0;
    }
    ctx2d.fillStyle = glow > 0.3 ? `rgba(80,200,255,${0.3+glow*0.5})` : 'rgba(200,150,30,0.35)';
    ctx2d.font = '7px ui-monospace,monospace';
    ctx2d.fillText(`θY=${(angleY*180/Math.PI).toFixed(1)}° θX=${(angleX*180/Math.PI).toFixed(1)}°`, 4, CH-4);
  };

  return (world, peerId, containerId, sendCursorMove, _injectEvent) => {
    // Wrap injectEvent so dispatch always escapes the current synchronous frame.
    // On the sender peer, events fired during a render call would otherwise wait
    // until the render returns before hitting the network stack, adding a full
    // frame of latency that the receiver peer doesn't pay.
    const injectEvent = _injectEvent
      ? (ev) => setTimeout(() => _injectEvent(ev), 0)
      : undefined;
    if (!document.getElementById('hologram4-wrap')) {
      const wrap = document.createElement('div'); wrap.id = 'hologram4-wrap';
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
    document.getElementById('hologram4-wrap').appendChild(root);

    // ── Main layout ───────────────────────────────────────────────────────────
    const main = document.createElement('div');
    Object.assign(main.style, { display: 'flex', flex: '1', flexDirection: 'row', minHeight: '0', overflow: 'hidden' });
    root.appendChild(main);

    // ── Control bar (below canvases, horizontal) ──────────────────────────────
    const controlBar = document.createElement('div');
    Object.assign(controlBar.style, {
      display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
      alignItems: 'center', gap: '4px', padding: '6px 8px',
      background: '#0a0a0a', borderTop: '1px solid #222',
      flexShrink: '0', boxSizing: 'border-box',
      overflowY: 'visible',
    });
    root.appendChild(controlBar);

    // ── Canvas area: two rows (object row always visible, eye row in LIVE mode) ──
    const canvasArea = document.createElement('div');
    Object.assign(canvasArea.style, {
      flex: '1', minWidth: '0', minHeight: '0',
      display: 'flex', flexDirection: 'column', gap: '4px',
      padding: '8px', boxSizing: 'border-box',
    });
    main.appendChild(canvasArea);

    // Row 1: object canvases (always visible)
    const canvasCol = document.createElement('div');
    Object.assign(canvasCol.style, {
      flex: '1', minWidth: '0', minHeight: '0',
      display: 'flex', flexDirection: 'row',
      alignItems: 'stretch', gap: '4px',
    });
    canvasArea.appendChild(canvasCol);

    // Row 2: eye reconstruction canvases (LIVE mode only)
    const eyeRow = document.createElement('div');
    Object.assign(eyeRow.style, {
      flex: '1', minWidth: '0', minHeight: '0',
      display: 'none', flexDirection: 'row',
      alignItems: 'stretch', gap: '4px',
    });
    canvasArea.appendChild(eyeRow);

    const makeDataCell = (label, color) => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column' });
      const lbl = document.createElement('div');
      Object.assign(lbl.style, {
        fontSize: '8px', color, textAlign: 'center', marginBottom: '2px',
        letterSpacing: '0.5px', flexShrink: '0',
      });
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const canvas = document.createElement('canvas');
      canvas.width = RW; canvas.height = RH;
      Object.assign(canvas.style, {
        flex: '1', minHeight: '0', width: '100%', height: '100%',
        objectFit: 'contain', imageRendering: 'auto',
        borderRadius: '3px', display: 'block', cursor: 'crosshair',
      });
      wrap.appendChild(canvas);
      return { wrap, canvas, ctx: canvas.getContext('2d') };
    };

    const fieldCell = makeDataCell('IFS WAVEFRONT  |ψ|²  (drag = rotate)', '#f84');
    const phaseCell = makeDataCell('IFS PHASE  arg(ψ)  Lévy diffraction tails', '#4af');
    const plateCell = makeDataCell('IFS HOLOGRAM PLATE  |ψ_obj+ψ_ref|²  native', '#9c4');
    const cloudCell = makeDataCell('DEPTH CLOUD  tier tomography  (RECON only)', '#c8f');
    canvasCol.appendChild(fieldCell.wrap);
    canvasCol.appendChild(phaseCell.wrap);
    canvasCol.appendChild(plateCell.wrap);
    canvasCol.appendChild(cloudCell.wrap);

    // Eye row cells — shown only in LIVE mode
    const eyeFieldCell = makeDataCell('EYE  |ψ_arrived|²  received wavefront', '#f84');
    const eyePhaseCell = makeDataCell('EYE  |ψ_percept|²  soliton (relaxed)', '#4af');
    const eyeDiffCell  = makeDataCell('EYE  |ψ_perceived|²  inferred object', '#fa4');
    eyeRow.appendChild(eyeFieldCell.wrap);
    eyeRow.appendChild(eyePhaseCell.wrap);
    eyeRow.appendChild(eyeDiffCell.wrap);

    const fieldBuf = fieldCell.ctx.createImageData(RW, RH);
    const phaseBuf = phaseCell.ctx.createImageData(RW, RH);
    const plateBuf = plateCell.ctx.createImageData(RW, RH);

    // ── Local GPU physics (Deterministic Viewport) ───────────────────────────
    // All physics (psi evolution, plate accumulation) is local to this renderer.
    // Shared state only carries lightweight params: angles, kernels, direction, time.
    // GPU is a one-way mirror: data flows JS→GPU, never GPU→shared state.
    let _gpu = null;
    let _gpuReady = false;
    let _gpuKernelVersion = -1;
    // Snapshot of kernel at RECON start — backward steps must use the same
    // kernel that was used during recording, not the live evolving IFS kernel.
    let _snapReconRadii   = null;
    let _snapReconWeights = null;
    let _snapReconOffsets = null;

    // Local physics state — never sent to network
    let _localKernelVersion    = -1;  // tracks when to rebuild obj field
    let _localRefKernelVersion = -1;  // tracks when to rebuild ref field
    let _localPsi        = null;   // display wavefield (1 JS step/frame)
    let _localObjField   = null;   // object field (t=0 seed, rebuilt on angle/kernel change)
    let _localRefField   = null;   // reference field (T_RECORD forward IFS from y=0 line)
    let _localPlate      = null;   // accumulated hologram plate (Float32Array, N_CELLS)
    let _plateSeq        = 0;      // incremented when plate is frozen for RECON; guards stale async callbacks
    let _localAngleYSeen = null;
    let _localShapeSeen  = null;
    let _localAngleXSeen = null;
    let _localExtraSeen  = null;
    let _localPlateResetSeq = -1;
    let _localReconSeq      = -1;
    let _localReconStep     = 0;
    let _localReconHolding  = false;  // true during RECON_HOLD_MS pause
    let _localReconHoldUntil = 0;     // performance.now() timestamp to resume
    let _lastReconStepMs    = 0;      // timestamp of last backward step
    let _localReconSoliton  = false;  // true after focus found — continuous soliton mode
    let _reconSolitonField  = null;   // focused field used as soliton attractor
    let _reconDKX           = 0;      // current parallax k-offset X
    let _reconDKY           = 0;      // current parallax k-offset Y
    let _reconDKXSeen       = 0;      // phase accumulator (auto-rot) or last applied dKX (drag)
    let _reconDKXCurrent    = 0;      // actual current carrier shift applied to objField
    let _reconDKYSeen       = 0;      // last applied parallax Y
    let _reconLensFSeen     = -1;     // last applied lens focal length
    let _autoRotate         = false;
    const AUTO_ROT_SPEED    = 0.003;
    const AUTO_ROT_AMP      = 0.3;
    let _plateSeedFree      = false;
    let _plateKernelMode    = false;  // phase kick from raw plate fringes
    let _demodKickMode      = false;  // phase kick from demodulated object wavefront phase
    let _plateKernelGamma   = SRC_ALPHA;  // phase kick strength — matches SRC_ALPHA
    let _plateKernelDT      = DT;     // leapfrog timestep for plate kernel mode
    let _plateKernelSteps   = 16;     // steps per frame for plate kernel mode
    // Traversal parameters — each can be swept independently
    let _travPhase          = 0;      // shared phase accumulator for auto sweeps
    let _travDKX            = 0;      // carrier X shift
    let _travDKY            = 0;      // carrier Y shift
    let _travRot            = 0;      // plate rotation angle
    let _travShiftX         = 0;      // plate lateral shift X (grid units)
    let _travShiftY         = 0;      // plate lateral shift Y (grid units)
    let _travScale          = 1;      // plate zoom scale
    let _autoTravMode       = 'rot';  // which parameter auto-sweep drives: 'rot'|'dkx'|'dky'|'shift'|'scale'
    const TRAV_SPEED        = 0.008;  // phase increment per frame
    let _reconSnapBaseAngleY = 0;    // snap angle at RECON entry — parallax computed relative to this
    let _reconSnapBaseAngleX = 0;
    const PARALLAX_SCALE    = 0.06;  // radians→dK conversion; tune for visible but not destructive parallax
    let _breathVis          = true;   // show breathing (live stepRecord); false = freeze display psi
    let _recordSeeded       = false;  // RECORD soliton has been seeded; step persistently after
    let _localDirection     = 1;
    let _kernelChangeFrames = 0; // countdown after kernel switch — boosted SRC_ALPHA to re-anchor
    let _localStepCount     = 0;
    let _psiReadPending     = false;
    let _localRefReady      = false;  // true once GPU ref has been read back to JS for cplx plate
    let _cplxPlateObjReady  = false;  // true once cplx plate objField has been set as RECON attractor
    let _cplxPlateUploaded  = false;  // true after uploadCplxPlate with non-zero content
    let _cplxPlateField     = null;   // JS copy of ψ_sweep·conj(ψ_ref)

    // ── Plate sweep state ──────────────────────────────────────────────────────
    // Manual snap: seed sweep ping-pong from objField when plateSnapSeq changes,
    // run T_RECORD steps spread across frames, accumulate via accumulatePlateSweep.
    // Multi-angle: N_SNAP_ANGLES exposures per snap at stepped angleY for parallax.
    const GPU_STEPS_PER_FRAME = 4;
    const N_SNAP_ANGLES   = 1;
    const SNAP_ANGLE_STEP = 0.08;   // radians between exposures
    let _localPlateSnapSeq  = 0;
    let _hebbianWeights     = null; // Hebbian ring weights computed from RECORD soliton at snap
    let _plateDrivenMode    = true;  // true = plate attractor + noise seed (default); false = geometry seed
    let _nullPlateTest      = false; // proof test: zero plate → object must disappear if plate-driven
    let _noHebbTest         = false; // optional: add Hebbian weights on top of baseline kernel
    let _hamiltonianMode    = false; // plate as Hamiltonian potential: exp(i·γ·plate) baked into each IFS step
    let _liveMode           = false; // pure IFS round-trip eye: ψ_obj → F^T → F^-T → ψ_obj' each frame
    let _liveRefMix         = 0;    // mix weight of objField into eye diff panel (0=off)
    let _eyeReconNorm        = 1e-9;  // display normalization = peak |ψ_holo|²
    let _eyeDirty            = true;  // object changed — recompute the wavefront soliton
    let _eyeObjKeySeen       = '';    // object key (angle/shape/points) the eye last snapped
    let _eyeReady            = false; // true once ψ_holo sits in the eye texture
    let _eyeT                = 0;     // (animated version) current propagation depth 0..T_RECORD
    let _eyeDir              = +1;    // (animated version) direction: +1 obj→holo, -1 back
    const EYE_SPEED          = 2;     // (animated version) steps per displayed frame
    const EYE_RELAX_STEPS    = 60;    // feedback steps to settle the percept onto a soliton
    let _eyeHmode            = 0;     // hologram-domain [H] transform: 0=identity 1=lowpass 2=highpass 3=conj
    let _eyeHparam           = 0.5;   // [H] aperture fraction (0..1)
    let _eyeEvidence         = null;  // ψ_perceived = exact inverse (the perceptual evidence, held)
    let _eyeArrivedNorm      = 1e-9;  // display norm for ψ_arrived
    let _eyePerceptState     = null;  // settled percept, carried across object changes (memory)
    let _recordMode         = 'vol'; // sweep seed: 'vol'=volumetric Gabor, 'ifs'=point-source IFS, 'retina'=live retina, 'ifs_depth'=per-point step-timed injection
    let _depthSchedule      = null;  // Array[T_RECORD] of injection fields for 'ifs_depth' mode
    let _backPlateMode      = false; // Gerchberg-Saxton: forward + amp constraint + backward
    let _gsSteps            = 10;   // steps per half-trip per frame (keep small — 5-20 is fast enough)
    let _gsPropagator       = 'ifs'; // 'ifs' = IFS leapfrog, 'huygens' = Huygens wavelet
    let _gsNoiseSeed        = false; // true = seed GS from noise (tests plate drives convergence), false = demod seed
    let _snapSwPsi          = null;  // raw ψ_sweep at snap time — used for exact backward reconstruction
    let _directBackMode     = false; // upload snapSwPsi → backward T_RECORD steps → exact reconstruction
    let _directBackPsi      = null;  // frozen reconstruction from entry — protected from async overwrites
    let _directBackMax      = 1e-9;  // peak amplitude for stable normalization
    let _focusDepth         = 0;    // 0 = no focus; >0 = lens focal length applied after backward sweep (vol mode depth scan)
    let _gsPhase            = 'fwd'; // current half of GS round-trip: 'fwd' | 'constraint' | 'bwd'
    let _gsStepsDone        = 0;    // steps completed in current half
    let _plateDemodMode     = false; // test mode: demodulated plate as objField injector
    let _plateDemodField    = null;  // IFS-projected demodulated field — ready as eigenstate attractor
    let _plateDemodPending  = false; // true while IFS projection readback is in flight
    let _snapAngleQueue = [];       // [{angleY, angleX}] remaining exposures for current snap
    let _recordedPlates = [];       // [{angleY, angleX, plate}] one plate per recorded angle
    let _sweepPsi      = null;
    let _sweepStep     = T_RECORD; // T_RECORD = idle
    let _sweepAngleY   = null;
    let _sweepAngleX   = null;
    let _sweepExtraKey = null;
    let _sweepSnapRadii   = null;  // kernel frozen at sweep start — must match plate
    let _sweepSnapWeights = null;
    let _sweepSnapOffsets = null;
    let _lastKeepaliveMs = 0;
    let _localReconResetSeen = 0;

    let _gpuCanvas = null;
    if (IFSGpu.isSupported()) {
      _gpuCanvas = document.createElement('canvas');
      _gpuCanvas.width  = GRID;
      _gpuCanvas.height = GRID;
      IFSGpu.create(_gpuCanvas, GRID).then(g => {
        _gpu = g;
        _gpuReady = true;
        console.log('[hologram4] GPU ready, grid=' + GRID);
      }).catch(err => {
        console.error('[hologram4] IFSGpu init FAILED:', err);
      });
    }

    // Precompute bilinear sample tables — reused every frame
    const _bx0 = new Int32Array(RW), _bx1 = new Int32Array(RW);
    const _btx = new Float32Array(RW), _btx1 = new Float32Array(RW);
    for (let rx = 0; rx < RW; rx++) {
      const fx = (rx + 0.5) / RENDER_SCALE - 0.5;
      const x0 = Math.floor(fx);
      _bx0[rx] = Math.max(0, Math.min(GRID-1, x0));
      _bx1[rx] = Math.max(0, Math.min(GRID-1, x0 + 1));
      _btx[rx] = fx - x0; _btx1[rx] = 1 - _btx[rx];
    }
    const _by0 = new Int32Array(RH), _by1 = new Int32Array(RH);
    const _bty = new Float32Array(RH), _bty1 = new Float32Array(RH);
    for (let ry = 0; ry < RH; ry++) {
      const fy = (ry + 0.5) / RENDER_SCALE - 0.5;
      const y0 = Math.floor(fy);
      _by0[ry] = Math.max(0, Math.min(GRID-1, y0));
      _by1[ry] = Math.max(0, Math.min(GRID-1, y0 + 1));
      _bty[ry] = fy - y0; _bty1[ry] = 1 - _bty[ry];
    }

    let _smoothMaxField = 0, _smoothMaxPlate = 0, _smoothMeanField = 0, _smoothMeanPlate = 0;
    let _smoothMaxRecord = 0;  // separate normalization for RECORD canvas — insulated from RECON sweep


    // ── Clock column (slim: title + IFS clock + wireframe only) ──────────────
    const clockCol = document.createElement('div');
    Object.assign(clockCol.style, {
      flexShrink: '0', width: '110px', display: 'flex', flexDirection: 'column',
      padding: '8px 6px', boxSizing: 'border-box', gap: '4px', overflow: 'hidden',
    });
    main.appendChild(clockCol);

    const title = document.createElement('div');
    title.id = containerId + '-title';
    Object.assign(title.style, {
      fontSize: '7px', fontWeight: 'bold', letterSpacing: '0.5px',
      color: '#9c4', textAlign: 'center', lineHeight: '1.4',
      height: '3em', overflow: 'hidden', flexShrink: '0',
    });
    clockCol.appendChild(title);

    const ifsClock = makeIFSClockPanel({ label: 'FRESNEL IFS', depth: IFS_DEPTH, colors: IFS_DEPTH_COLORS });
    clockCol.appendChild(ifsClock.el);

    // Wireframe cube canvas in clock column
    const wireCvs = document.createElement('canvas');
    wireCvs.width = 120; wireCvs.height = 120;
    Object.assign(wireCvs.style, {
      width: '100%', height: 'auto', borderRadius: '3px',
      display: 'block', cursor: 'grab', flexShrink: '0',
    });
    clockCol.appendChild(wireCvs);
    const wireCtx = wireCvs.getContext('2d');

    const mkBtn = (label, bg, fg, handler) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: bg, color: fg ?? '#000', border: 'none', borderRadius: '4px',
        padding: '4px 7px', fontSize: '8px', cursor: 'pointer', whiteSpace: 'nowrap',
        fontFamily: 'ui-monospace,monospace', fontWeight: 'bold',
        touchAction: 'manipulation', flexShrink: '0',
      });
      b.addEventListener('click', handler);
      b.addEventListener('touchend', (e) => { e.preventDefault(); handler(e); }, { passive: false });
      return b;
    };

    const btnRecord = mkBtn('● RECORD',       '#9c4', '#000', () => {
      if ((world.getNodeState('hologram4')?.direction ?? 1) !== 1)
        injectEvent?.({ type: 'toggleMode' });
    });
    const btnRecon  = mkBtn('◎ RECONSTRUCT',  '#4af', '#000', () => {
      if ((world.getNodeState('hologram4')?.direction ?? 1) !== -1)
        injectEvent?.({ type: 'toggleMode' });
    });
    const btnSnap   = mkBtn('◉ SNAP PLATE',   '#fa4', '#000', () => injectEvent?.({ type: 'snapPlate' }));
    const btnReset  = mkBtn('↺ RESET PLATE',  '#333', '#aaa', () => injectEvent?.({ type: 'resetPlate' }));

    // ── Record mode selector ──────────────────────────────────────────────────
    const _recModes = [
      { mode: 'vol',    label: '◎ VOL',    bg: '#245', color: '#8cf', title: 'Volumetric Gabor wavefront (spherical waves)' },
      { mode: 'ifs',       label: '◎ IFS',   bg: '#245', color: '#fc8', title: 'Point-source IFS (matches display soliton eigenstate)' },
      { mode: 'ifs_depth', label: '◎ DEPTH', bg: '#245', color: '#f8a', title: 'IFS depth: per-point step-timed injection — depth = backward time axis' },
      { mode: 'retina',    label: '◎ RETINA',bg: '#245', color: '#af8', title: 'Live retina snapshot (record current psi as-is)' },
    ];
    const _recBtns = _recModes.map(({ mode, label, bg, color, title }) => {
      const b = mkBtn(label, bg, color, () => injectEvent?.({ type: 'setRecordMode', mode }));
      b.title = title;
      return b;
    });
    const _recRow = document.createElement('div');
    Object.assign(_recRow.style, { display: 'flex', gap: '2px', flexShrink: '0' });
    _recBtns.forEach(b => _recRow.appendChild(b));

    const btnLive = mkBtn('⟳ LIVE', '#363', '#af8', () => injectEvent?.({ type: 'setLiveMode' }));

    // Mix slider: blend reference objField into RECON display for diff test
    const mixWrap = document.createElement('div');
    Object.assign(mixWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const mixLbl = document.createElement('span');
    mixLbl.style.cssText = 'color:#af8;font-size:8px;white-space:nowrap';
    mixLbl.textContent = 'MIX 0';
    const mixSlider = document.createElement('input');
    mixSlider.type = 'range'; mixSlider.min = '0'; mixSlider.max = '1';
    mixSlider.step = '0.05'; mixSlider.value = '0';
    Object.assign(mixSlider.style, { width:'50px', cursor:'pointer' });
    mixSlider.addEventListener('input', () => {
      _liveRefMix = parseFloat(mixSlider.value);
      mixLbl.textContent = `MIX ${_liveRefMix.toFixed(2)}`;
      _eyeDirty = true; // eye holds between changes — force a re-render so MIX shows
    });
    mixWrap.appendChild(mixLbl);
    mixWrap.appendChild(mixSlider);

    // ── H-transform controls (hologram-domain operator between forward/backward legs) ──
    const _hModes = [
      { mode: 0, label: 'H=id',   title: 'Identity — exact round-trip, ψ_obj\'=ψ_obj' },
      { mode: 1, label: 'H=LP',   title: 'Low-pass aperture in hologram domain' },
      { mode: 2, label: 'H=HP',   title: 'High-pass (remove DC/low spatial freq)' },
      { mode: 3, label: 'H=conj', title: 'Complex conjugate — time-reverse the hologram' },
    ];
    const _hBtns = _hModes.map(({ mode, label, title }) => {
      const b = mkBtn(label, mode === 0 ? '#363' : '#333', mode === 0 ? '#af8' : '#888', () => {
        _eyeHmode = mode;
        _eyeDirty = true;
        _hBtns.forEach((bb, i) => {
          bb.style.background = i === mode ? '#363' : '#333';
          bb.style.color      = i === mode ? '#af8' : '#888';
        });
      });
      b.title = title;
      Object.assign(b.style, { fontSize: '8px', padding: '3px 5px' });
      return b;
    });
    const hModeRow = document.createElement('div');
    Object.assign(hModeRow.style, { display: 'flex', gap: '1px', flexShrink: '0' });
    _hBtns.forEach(b => hModeRow.appendChild(b));

    const hParamWrap = document.createElement('div');
    Object.assign(hParamWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const hParamLbl = document.createElement('span');
    hParamLbl.style.cssText = 'color:#af8;font-size:8px;white-space:nowrap';
    hParamLbl.textContent = `r=${_eyeHparam.toFixed(2)}`;
    const hParamSlider = document.createElement('input');
    hParamSlider.type = 'range'; hParamSlider.min = '0'; hParamSlider.max = '1';
    hParamSlider.step = '0.02'; hParamSlider.value = String(_eyeHparam);
    Object.assign(hParamSlider.style, { width:'50px', cursor:'pointer' });
    hParamSlider.addEventListener('input', () => {
      _eyeHparam = parseFloat(hParamSlider.value);
      hParamLbl.textContent = `r=${_eyeHparam.toFixed(2)}`;
      if (_eyeHmode !== 0) _eyeDirty = true;
    });
    hParamWrap.appendChild(hParamLbl);
    hParamWrap.appendChild(hParamSlider);

    const btnPointTest = mkBtn('⊙ PT TEST', '#520', '#fa8', () => injectEvent?.({ type: 'pointTest' }));
    btnPointTest.title = 'Single-point reversibility test: record one delta source at center (IFS mode), then GS-reconstruct — should collapse to a point';
    const _shapeRow = document.createElement('div');
    Object.assign(_shapeRow.style, { display: 'flex', gap: '2px', flexShrink: '0' });
    const _mkShapeBtn = (label, shape, bg) => {
      const b = mkBtn(label, bg, '#fff', () => injectEvent?.({ type: 'setShape', shape }));
      Object.assign(b.style, { fontSize: '8px', padding: '4px 5px' });
      return b;
    };
    const btnShapeCube     = _mkShapeBtn('■ CUBE',     'cube',     '#4af');
    const btnShapePyramid  = _mkShapeBtn('▲ PYRAMID',  'pyramid',  '#48f');
    const btnShapeCombined = _mkShapeBtn('⬡ BOTH',    'combined',  '#86f');
    _shapeRow.appendChild(btnShapeCube);
    _shapeRow.appendChild(btnShapePyramid);
    _shapeRow.appendChild(btnShapeCombined);
    const btnTomo   = mkBtn('⊕ TOMO',  '#555', '#aaa', () => injectEvent?.({ type: 'toggleTomo' }));
    const btnBreath = mkBtn('~ BREATH  on', '#226', '#8af', () => injectEvent?.({ type: 'setBreath' }));
    const btnHebb = mkBtn('⊛ PLATE on', '#633', '#faa', () => {
      if (_plateDemodMode) _plateDemodMode = false;
      injectEvent?.({ type: 'setPlateDriven' });
    });
    const btnNoHebb = mkBtn('⊛ +HEBB', '#555', '#aaa', () => {
      injectEvent?.({ type: 'setNoHebb' });
    });
    const btnNullPlate = mkBtn('∅ NULL PLATE', '#555', '#aaa', () => {
      injectEvent?.({ type: 'setNullPlate' });
    });
    const _travBtns = {};
    const _setTravMode = (mode) => {
      _autoRotate   = true;
      _autoTravMode = mode;
      _travPhase    = 0;
      _localReconSoliton = false;
      for (const [k, b] of Object.entries(_travBtns)) {
        b.style.background = k === mode ? '#363' : '#555';
        b.style.color      = k === mode ? '#afa' : '#aaa';
      }
    };
    const _makeTravBtn = (label, mode) => {
      const b = mkBtn(label, '#555', '#aaa', () => {
        if (_autoRotate && _autoTravMode === mode) {
          _autoRotate = false;
          b.style.background = '#555'; b.style.color = '#aaa';
        } else {
          _setTravMode(mode);
        }
      });
      _travBtns[mode] = b;
      return b;
    };
    // traversal buttons removed — don't affect soliton fixed point
    const btnPlateKernel  = mkBtn('⬡ PLATE KERN',  '#555', '#aaa', () => injectEvent?.({ type: 'setPlateKernel' }));
    const btnDemodKick    = mkBtn('⬡ DEMOD KICK',  '#555', '#aaa', () => injectEvent?.({ type: 'setDemodKick' }));
    const btnHamiltonian  = mkBtn('⬡ HAMILTONIAN', '#255', '#5cf', () => injectEvent?.({ type: 'setHamiltonian' }));

    // Gamma slider for plate kernel phase kick strength
    const gammaWrap = document.createElement('div');
    Object.assign(gammaWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const gammaLbl = document.createElement('span');
    gammaLbl.style.cssText = 'color:#aaa;font-size:8px;white-space:nowrap';
    gammaLbl.textContent = `γ ${_plateKernelGamma.toFixed(2)}`;
    const gammaSlider = document.createElement('input');
    gammaSlider.type = 'range'; gammaSlider.min = '0'; gammaSlider.max = '1';
    gammaSlider.step = '0.01'; gammaSlider.value = String(_plateKernelGamma);
    Object.assign(gammaSlider.style, { width:'60px', cursor:'pointer' });
    gammaSlider.addEventListener('input', () => {
      injectEvent?.({ type: 'setKickParams', gamma: parseFloat(gammaSlider.value) });
    });
    gammaWrap.appendChild(gammaLbl);
    gammaWrap.appendChild(gammaSlider);

    const mkSlider = (labelStr, min, max, step, val, onInput) => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
      const lbl = document.createElement('span');
      lbl.style.cssText = 'color:#aaa;font-size:8px;white-space:nowrap';
      lbl.textContent = labelStr;
      const sl = document.createElement('input');
      sl.type = 'range'; sl.min = String(min); sl.max = String(max);
      sl.step = String(step); sl.value = String(val);
      Object.assign(sl.style, { width:'60px', cursor:'pointer' });
      sl.addEventListener('input', () => onInput(sl, lbl));
      wrap.appendChild(lbl); wrap.appendChild(sl);
      return wrap;
    };

    const dtWrap = mkSlider(`dt ${_plateKernelDT.toFixed(2)}`, 0.01, 0.5, 0.01, _plateKernelDT, (sl, lbl) => {
      injectEvent?.({ type: 'setKickParams', dt: parseFloat(sl.value) });
    });
    const stepsWrap = mkSlider(`N ${_plateKernelSteps}`, 1, 64, 1, _plateKernelSteps, (sl, lbl) => {
      injectEvent?.({ type: 'setKickParams', steps: parseInt(sl.value) });
    });
    const gsStepsWrap = mkSlider(`GS ${_gsSteps}/fr`, 1, 40, 1, _gsSteps, (sl, lbl) => {
      const v = parseInt(sl.value);
      lbl.textContent = `GS ${v}/fr`;
      injectEvent?.({ type: 'setKickParams', gsSteps: v });
    });

    const btnPlateSeed  = mkBtn('⬡ FREE IFS',     '#555', '#aaa', () => injectEvent?.({ type: 'setPlateSeedFree' }));
    const btnReconReset  = mkBtn('↺ RECON RESET',  '#333', '#fa8', () => injectEvent?.({ type: 'setReconReset' }));
    const btnBackPlate   = mkBtn('↩ BACK+PLATE',   '#345', '#8cf', () => injectEvent?.({ type: 'setBackPlate' }));
    const btnPlateDemod = mkBtn('◈ PLATE DEMOD', '#446', '#aaf', () => {
      _plateDemodMode = !_plateDemodMode;
      btnPlateDemod.textContent      = _plateDemodMode ? '◈ PLATE DEMOD on' : '◈ PLATE DEMOD';
      btnPlateDemod.style.background = _plateDemodMode ? '#66a' : '#446';
      if (_plateDemodMode) injectEvent?.({ type: 'setPlateDriven', value: false });
      _localReconSoliton = false;
    });
    // ── GS propagator selector ────────────────────────────────────────────────
    const _gsPropModes = [
      { mode: 'ifs',     label: 'GS:IFS',  bg: '#345', color: '#fc8', title: 'GS round-trip via IFS leapfrog — use with IFS or RETINA plates' },
      { mode: 'huygens', label: 'GS:HUY',  bg: '#345', color: '#8cf', title: 'GS round-trip via Huygens wavelet — use with VOL plates' },
    ];
    const _gsPropBtns = _gsPropModes.map(({ mode, label, bg, color, title }) => {
      const b = mkBtn(label, bg, color, () => injectEvent?.({ type: 'setGsPropagator', mode }));
      b.title = title;
      Object.assign(b.style, { fontSize: '8px', padding: '4px 5px' });
      return b;
    });
    const _gsPropRow = document.createElement('div');
    Object.assign(_gsPropRow.style, { display: 'flex', gap: '2px', flexShrink: '0' });
    _gsPropBtns.forEach(b => _gsPropRow.appendChild(b));
    const btnGsNoise    = mkBtn('GS:NOISE',  '#333', '#fa8', () => injectEvent?.({ type: 'setGsNoiseSeed' }));
    const btnDirectBack = mkBtn('⟵ EXACT',   '#246', '#8ef', () => injectEvent?.({ type: 'setDirectBack' }));
    btnDirectBack.title = 'Exact backward reconstruction: upload ψ_sweep at snap, run T_RECORD backward leapfrog steps — no iteration, machine-precision inverse';

    // ── Depth focus slider (vol mode only) ───────────────────────────────────
    const focusWrap = document.createElement('div');
    Object.assign(focusWrap.style, { display:'flex', alignItems:'center', gap:'3px', flexShrink:'0' });
    const focusLbl = document.createElement('span');
    focusLbl.style.cssText = 'color:#8ef;font-size:8px;white-space:nowrap';
    focusLbl.textContent = 'Z off';
    const focusSlider = document.createElement('input');
    focusSlider.type = 'range'; focusSlider.min = '0'; focusSlider.max = '100';
    focusSlider.step = '1'; focusSlider.value = '0';
    Object.assign(focusSlider.style, { width:'60px', cursor:'pointer' });
    focusSlider.addEventListener('input', () => {
      _focusDepth = parseInt(focusSlider.value);
      focusLbl.textContent = _focusDepth > 0 ? `Z ${_focusDepth}` : 'Z off';
    });
    focusWrap.appendChild(focusLbl);
    focusWrap.appendChild(focusSlider);
    btnGsNoise.title = 'Seed GS from noise instead of demod plate — proves plate constraint drives convergence, not initial guess';

    // ── Hologram file save / load ─────────────────────────────────────────────
    const btnSaveHolo = mkBtn('💾 SAVE', '#234', '#8ef', () => {
      if (!_snapSwPsi) { console.warn('[SAVE] no swPsi — snap first'); return; }
      const meta = {
        grid: GRID, dt: DT, tRecord: T_RECORD,
        radii:   Array.from(_sweepSnapRadii   ?? []),
        weights: Array.from(_sweepSnapWeights ?? []),
        angleY:  _sweepAngleY, angleX: _sweepAngleX,
      };
      // Pack as Float32 to halve file size (matches GPU precision)
      const f32 = new Float32Array(_snapSwPsi.length);
      for (let i = 0; i < f32.length; i++) f32[i] = _snapSwPsi[i];
      const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
      const metaLen = new Uint32Array([metaBytes.length]);
      const blob = new Blob([metaLen.buffer, metaBytes.buffer, f32.buffer],
        { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'hologram.ifsh'; a.click();
      URL.revokeObjectURL(url);
      console.log('[SAVE] hologram.ifsh written, grid='+GRID+' T='+T_RECORD);
    });
    btnSaveHolo.title = 'Save swPsi + kernel metadata to hologram.ifsh';

    const btnLoadHolo = mkBtn('📂 LOAD', '#234', '#fa8', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.ifsh,.bin';
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        const buf = await file.arrayBuffer();
        const metaLen = new Uint32Array(buf, 0, 1)[0];
        const metaStr = new TextDecoder().decode(new Uint8Array(buf, 4, metaLen));
        const meta = JSON.parse(metaStr);
        const f32 = new Float32Array(buf.slice(4 + metaLen));
        const swPsi = new Float64Array(f32.length);
        for (let i = 0; i < f32.length; i++) swPsi[i] = f32[i];
        _snapSwPsi = swPsi;
        // Restore kernel from file metadata
        if (meta.radii?.length && _gpuReady) {
          const loadedOffs = meta.radii.map(r => {
            const n = Math.max(8, Math.ceil(2*Math.PI*r));
            const f = new Int16Array(n*2);
            for (let k=0;k<n;k++){f[k*2]=Math.round(r*Math.cos(k*2*Math.PI/n));f[k*2+1]=Math.round(r*Math.sin(k*2*Math.PI/n));}
            return f;
          });
          _gpu.setRings(meta.radii, meta.weights, loadedOffs);
          _sweepSnapRadii   = new Float64Array(meta.radii);
          _sweepSnapWeights = new Float64Array(meta.weights);
        }
        // Trigger reconstruction if already in direct-back mode
        _localReconSoliton = false;
        console.log('[LOAD] hologram.ifsh loaded, grid='+meta.grid+' T='+meta.tRecord);
      };
      input.click();
    });
    btnLoadHolo.title = 'Load hologram.ifsh and reconstruct with ⟵ EXACT';

    // ── Separator helper for control bar ──────────────────────────────────────
    const mkSep = () => {
      const s = document.createElement('div');
      Object.assign(s.style, { width: '1px', height: '18px', background: '#333', flexShrink: '0', alignSelf: 'center' });
      return s;
    };

    controlBar.appendChild(btnRecord);
    controlBar.appendChild(btnRecon);
    controlBar.appendChild(btnDirectBack);
    controlBar.appendChild(btnSaveHolo);
    controlBar.appendChild(btnLoadHolo);
    controlBar.appendChild(focusWrap);
    controlBar.appendChild(btnLive);
    controlBar.appendChild(mixWrap);
    controlBar.appendChild(hModeRow);
    controlBar.appendChild(hParamWrap);
    controlBar.appendChild(btnSnap);
    controlBar.appendChild(btnReset);
    controlBar.appendChild(btnPointTest);
    controlBar.appendChild(_recRow);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(_shapeRow);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(btnTomo);
    controlBar.appendChild(btnBreath);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(btnHebb);
    controlBar.appendChild(btnNoHebb);
    controlBar.appendChild(btnNullPlate);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(btnPlateKernel);
    controlBar.appendChild(btnDemodKick);
    controlBar.appendChild(btnHamiltonian);
    controlBar.appendChild(gammaWrap);
    controlBar.appendChild(dtWrap);
    controlBar.appendChild(stepsWrap);
    controlBar.appendChild(gsStepsWrap);
    controlBar.appendChild(btnPlateSeed);
    controlBar.appendChild(btnReconReset);
    controlBar.appendChild(btnBackPlate);
    controlBar.appendChild(_gsPropRow);
    controlBar.appendChild(btnGsNoise);
    controlBar.appendChild(btnPlateDemod);

    const modeLbl = document.createElement('div');
    modeLbl.id = containerId + '-mode';
    Object.assign(modeLbl.style, {
      fontSize: '8px', fontWeight: 'bold', color: '#9c4', whiteSpace: 'nowrap', flexShrink: '0',
    });
    controlBar.appendChild(modeLbl);

    // ── Depth probe slider ────────────────────────────────────────────────────
    const probeWrap = document.createElement('div');
    Object.assign(probeWrap.style, { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '3px', flexShrink: '0' });
    const probeLbl = document.createElement('div');
    Object.assign(probeLbl.style, { fontSize: '7px', color: '#555', whiteSpace: 'nowrap' });
    probeLbl.textContent = 'DEPTH  off';
    const probeSlider = document.createElement('input');
    probeSlider.type = 'range'; probeSlider.min = '0'; probeSlider.max = '100'; probeSlider.value = '0';
    probeSlider.disabled = true;
    Object.assign(probeSlider.style, { width: '70px', accentColor: '#f84', cursor: 'pointer', opacity: '0.3' });
    let _probeActive = false;
    let _probeTierSent = -1;
    const _updateProbeUI = (active, val) => {
      _probeActive = active;
      const _tmLbl = (world.getNodeState('hologram4')?.tomoMode ?? TOMO_MODE);
      probeLbl.textContent = active
        ? ((_tmLbl ? 'DEPTH TIER  ' : 'DEPTH  ') + val + '%')
        : (_tmLbl ? 'DEPTH TIER  off' : 'DEPTH  off');
      probeLbl.style.color = active ? '#f84' : '#555';
      probeSlider.disabled = !active;
      probeSlider.style.opacity = active ? '1' : '0.3';
      btnProbeOn.style.opacity  = active ? '0.4' : '1';
      btnProbeOff.style.opacity = active ? '1' : '0.4';
    };
    const _sendProbe = (val) => {
      const f    = val / 100;
      const _TM  = (world.getNodeState('hologram4')?.tomoMode ?? TOMO_MODE);
      // In tomo mode throttle to tier changes; in fast mode throttle to ~20 positions.
      const bucket = _TM
        ? Math.min(N_DEPTH_TIERS - 1, Math.floor(f * N_DEPTH_TIERS))
        : Math.floor(f * 20);
      if (bucket !== _probeTierSent) {
        _probeTierSent = bucket;
        injectEvent?.({ type: 'setDepthProbe', depthFraction: f });
      }
      _updateProbeUI(true, val);
    };
    probeSlider.addEventListener('input', () => _sendProbe(parseInt(probeSlider.value)));
    const btnProbeOn  = mkBtn('⦿ TIER ON',  '#f84', '#000', () => {
      _sendProbe(parseInt(probeSlider.value));
    });
    const btnProbeOff = mkBtn('✕ TIER OFF', '#222', '#888', () => {
      injectEvent?.({ type: 'setDepthProbe', depthFraction: undefined });
      _updateProbeUI(false, 0);
      _probeTierSent = -1;
    });
    probeWrap.appendChild(probeLbl);
    probeWrap.appendChild(probeSlider);
    probeWrap.appendChild(btnProbeOn);
    probeWrap.appendChild(btnProbeOff);

    // ── Lens focal length slider ───────────────────────────────────────────────
    const lensWrap  = document.createElement('div');
    lensWrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';
    const lensLbl   = document.createElement('span');
    lensLbl.style.cssText = 'color:#8cf;font-size:8px;white-space:nowrap;';
    lensLbl.textContent = 'LENS f=50';
    const lensSlider = document.createElement('input');
    lensSlider.type = 'range'; lensSlider.min = 5; lensSlider.max = 300;
    lensSlider.value = 50; lensSlider.style.width = '80px';
    lensSlider.addEventListener('input', () => {
      const f = parseInt(lensSlider.value);
      lensLbl.textContent = `LENS f=${f}`;
      injectEvent?.({ type: 'setLensF', f });
    });
    lensWrap.appendChild(lensLbl);
    lensWrap.appendChild(lensSlider);

    const stats = document.createElement('div');
    stats.id = containerId + '-stats';
    Object.assign(stats.style, { fontSize: '7px', color: '#444', lineHeight: '1.4', overflow: 'hidden', flexShrink: '0' });

    controlBar.appendChild(mkSep());
    controlBar.appendChild(probeWrap);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(lensWrap);
    controlBar.appendChild(mkSep());
    controlBar.appendChild(stats);

    // ── Drag-to-rotate (shared across all canvases + wireframe) ──────────────
    let _dragging = false, _dragX0 = 0, _dragY0 = 0, _baseAngleY = INIT_ANGLE_Y, _baseAngleX = INIT_ANGLE_X;
    let _localAngleY = INIT_ANGLE_Y, _localAngleX = INIT_ANGLE_X;
    let _wireGlow = 0, _wireRafId = null;
    let _lastRotateMs = 0;
    const ROTATE_THROTTLE_MS = 150;

    // Cloud has its own independent view angle (drag rotates the point stack locally)
    let _cloudDragging = false, _cloudDragX0 = 0, _cloudDragY0 = 0;
    let _cloudAngleY = 0.785, _cloudAngleX = 0.524;  // matches cube default: 45° az, 30° el
    let _cloudBaseAngleY = _cloudAngleY, _cloudBaseAngleX = _cloudAngleX;

    const _clientXY = (e) => {
      const t = e.touches ?? e.changedTouches;
      return t?.length ? [t[0].clientX, t[0].clientY] : [e.clientX, e.clientY];
    };
    const _onStart = (e) => {
      e.preventDefault();
      _dragging = true;
      [_dragX0, _dragY0] = _clientXY(e);
      _baseAngleY = _localAngleY; _baseAngleX = _localAngleX;
      _lastRotateMs = 0;
      wireCvs.style.cursor = 'grabbing';
      _injectEvent?.({ type: 'dragStart' });
    };
    const _onMove = (e) => {
      if (!_dragging) return;
      e.preventDefault();
      const [cx, cy] = _clientXY(e);
      _localAngleY = _baseAngleY + (cx - _dragX0) * 0.012;
      _localAngleX = _baseAngleX + (cy - _dragY0) * 0.012;
      _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow, world.getNodeState('hologram4')?.shape ?? 'cube');
      const now = performance.now();
      if (now - _lastRotateMs > ROTATE_THROTTLE_MS) {
        _lastRotateMs = now;
        injectEvent?.({ type: 'rotate', angleY: _localAngleY, angleX: _localAngleX });
      }
    };
    const _onEnd = (e) => {
      if (!_dragging) return;
      e.preventDefault();
      _dragging = false;
      wireCvs.style.cursor = 'grab';
      injectEvent?.({ type: 'rotate', angleY: _localAngleY, angleX: _localAngleX });
      _injectEvent?.({ type: 'dragEnd' });
    };

    // Cloud canvas drag — rotates point stack view, does NOT rotate the world
    cloudCell.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      _cloudDragging = true;
      [_cloudDragX0, _cloudDragY0] = _clientXY(e);
      _cloudBaseAngleY = _cloudAngleY; _cloudBaseAngleX = _cloudAngleX;
      cloudCell.canvas.style.cursor = 'grabbing';
    }, { passive: false });
    cloudCell.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      _cloudDragging = true;
      [_cloudDragX0, _cloudDragY0] = _clientXY(e);
      _cloudBaseAngleY = _cloudAngleY; _cloudBaseAngleX = _cloudAngleX;
    }, { passive: false });
    window.addEventListener('mousemove', (e) => {
      if (!_cloudDragging) return;
      const [cx, cy] = _clientXY(e);
      _cloudAngleY = _cloudBaseAngleY + (cx - _cloudDragX0) * 0.015;
      _cloudAngleX = _cloudBaseAngleX + (cy - _cloudDragY0) * 0.015;
    });
    window.addEventListener('mouseup', () => {
      if (_cloudDragging) { _cloudDragging = false; cloudCell.canvas.style.cursor = 'grab'; }
    });
    cloudCell.canvas.style.cursor = 'grab';

    const _attachDrag = (el) => {
      el.addEventListener('mousedown',  _onStart, { passive: false });
      el.addEventListener('touchstart', _onStart, { passive: false });
    };
    const allDragTargets = [fieldCell.canvas, phaseCell.canvas, plateCell.canvas, wireCvs];
    allDragTargets.forEach(_attachDrag);
    // Prevent browser scroll/pan from stealing touch events on drag canvases.
    allDragTargets.forEach(el => { el.style.touchAction = 'none'; });
    cloudCell.canvas.style.touchAction = 'none';
    window.addEventListener('mousemove',  _onMove);
    window.addEventListener('touchmove',  _onMove, { passive: false });
    window.addEventListener('mouseup',    _onEnd);
    window.addEventListener('touchend',   _onEnd);

    wireCvs.addEventListener('mouseenter', () => {
      _wireGlow = 1;
      const fade = () => { if (!_dragging) { _wireGlow = Math.max(0, _wireGlow - 0.05); } _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow, world.getNodeState('hologram4')?.shape ?? 'cube'); if (_wireGlow > 0.01 || _dragging) requestAnimationFrame(fade); };
      if (!_wireRafId) requestAnimationFrame(fade);
    });
    wireCvs.addEventListener('mouseleave', () => { if (!_dragging) _wireGlow = 0; });

    // Right-click → static point source; Shift+right-click → live oscillating beam
    fieldCell.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = fieldCell.canvas.getBoundingClientRect();
      const gx = Math.floor(((e.clientX - r.left) / r.width)  * GRID);
      const gy = Math.floor(((e.clientY - r.top)  / r.height) * GRID);
      if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID)
        injectEvent?.({ type: e.shiftKey ? 'addBeam' : 'addPoint', gx, gy });
    });

    [fieldCell.canvas, phaseCell.canvas, plateCell.canvas, cloudCell.canvas].forEach(c => {
      c.addEventListener('dblclick', () => injectEvent?.({ type: 'nextCycle' }));
    });

    // ── Main render ────────────────────────────────────────────────────────────
    const TWO_PI = 2 * Math.PI;
    const LOG_K = 99;
    const logS = 1 / Math.log(1 + LOG_K);

    let _lastRenderPhysicsMs = 0;
    const _renderFrame = () => {
      const n = world.getNodeState('hologram4');
      if (!n?.cachedRadii?.length) return;

      const dir = n.direction ?? 1;
      const lt  = world.ps.app.logicalTime ?? 0;

      // ── Sync renderer flags from world state (reflector round-trip) ──────────
      {
        const prev_plateDrivenMode = _plateDrivenMode;
        const prev_noHebbTest      = _noHebbTest;
        const prev_nullPlateTest   = _nullPlateTest;
        const prev_plateKernelMode = _plateKernelMode;
        const prev_demodKickMode   = _demodKickMode;
        const prev_plateSeedFree   = _plateSeedFree;
        const prev_backPlateMode   = _backPlateMode;
        const prev_hamiltonianMode = _hamiltonianMode;
        const prev_liveMode        = _liveMode;
        const prev_directBackMode  = _directBackMode;
        _breathVis        = n.breathVis        ?? true;
        _plateDrivenMode  = n.plateDrivenMode  ?? true;
        _noHebbTest       = n.noHebbTest       ?? false;
        _nullPlateTest    = n.nullPlateTest     ?? false;
        _plateKernelMode  = n.plateKernelMode  ?? false;
        _demodKickMode    = n.demodKickMode    ?? false;
        _plateSeedFree    = n.plateSeedFree    ?? false;
        _backPlateMode    = n.backPlateMode    ?? false;
        _hamiltonianMode  = n.hamiltonianMode  ?? false;
        _liveMode         = n.liveMode         ?? false;
        _recordMode       = n.recordMode       ?? 'vol';
        _plateKernelGamma = n.plateKernelGamma ?? SRC_ALPHA;
        _plateKernelDT    = n.plateKernelDT    ?? DT;
        _plateKernelSteps = n.plateKernelSteps ?? 16;
        _gsSteps          = Math.max(1, n.gsSteps ?? 10);
        _gsPropagator     = n.gsPropagator  ?? 'ifs';
        _gsNoiseSeed      = n.gsNoiseSeed    ?? false;
        _directBackMode   = n.directBackMode ?? false;
        const reconResetSeq     = n.reconResetSeq ?? 0;
        const reconResetChanged = reconResetSeq !== _localReconResetSeen;
        const modeChanged = _plateDrivenMode !== prev_plateDrivenMode ||
                            _noHebbTest      !== prev_noHebbTest      ||
                            _nullPlateTest   !== prev_nullPlateTest   ||
                            _plateKernelMode !== prev_plateKernelMode ||
                            _demodKickMode   !== prev_demodKickMode   ||
                            _plateSeedFree   !== prev_plateSeedFree   ||
                            _backPlateMode   !== prev_backPlateMode   ||
                            _hamiltonianMode !== prev_hamiltonianMode ||
                            _liveMode        !== prev_liveMode        ||
                            _directBackMode  !== prev_directBackMode;
        if (reconResetChanged || modeChanged) {
          _localReconResetSeen = reconResetSeq;
          if (reconResetChanged) _smoothMaxField = 0;
          _localReconSoliton = false;
          // When LIVE mode is turned on, start accumulating fresh from current soliton
          if (_directBackMode !== prev_directBackMode) {
            _directBackPsi = null; _directBackMax = 1e-9;
          }
          if (_liveMode && !prev_liveMode) {
            _eyeReconNorm = 1e-9;
            _eyeDirty = true; _eyeReady = false; // recompute evidence on entry
            _eyePerceptState = null; // fresh percept on entry
            _eyeT = 0; _eyeDir = +1;
          }
        }
        // ── Sync button UI ───────────────────────────────────────────────────
        const _activeShape = n.shape ?? 'cube';
        btnShapeCube.style.opacity     = _activeShape === 'cube'     ? '1' : '0.45';
        btnShapePyramid.style.opacity  = _activeShape === 'pyramid'  ? '1' : '0.45';
        btnShapeCombined.style.opacity = _activeShape === 'combined' ? '1' : '0.45';
        btnBreath.textContent      = _breathVis        ? '~ BREATH  on'      : '~ BREATH  off';
        btnHebb.textContent        = _plateDrivenMode  ? '⊛ PLATE on'        : '⊛ GEO+SEED';
        btnHebb.style.background   = _plateDrivenMode  ? '#633'              : '#363';
        btnHebb.style.color        = _plateDrivenMode  ? '#faa'              : '#afa';
        btnNoHebb.textContent      = _noHebbTest       ? '⊛ +HEBB on'        : '⊛ +HEBB';
        btnNoHebb.style.background = _noHebbTest       ? '#363'              : '#555';
        btnNoHebb.style.color      = _noHebbTest       ? '#afa'              : '#aaa';
        btnNullPlate.textContent      = _nullPlateTest ? '∅ NULL PLATE on'   : '∅ NULL PLATE';
        btnNullPlate.style.background = _nullPlateTest ? '#800'              : '#555';
        btnNullPlate.style.color      = _nullPlateTest ? '#f88'              : '#aaa';
        btnPlateKernel.textContent      = _plateKernelMode ? '⬡ PLATE KERN on' : '⬡ PLATE KERN';
        btnPlateKernel.style.background = _plateKernelMode ? '#633'            : '#555';
        btnPlateKernel.style.color      = _plateKernelMode ? '#faa'            : '#aaa';
        btnDemodKick.textContent      = _demodKickMode ? '⬡ DEMOD KICK on'  : '⬡ DEMOD KICK';
        btnDemodKick.style.background = _demodKickMode ? '#363'              : '#555';
        btnDemodKick.style.color      = _demodKickMode ? '#afa'              : '#aaa';
        btnPlateSeed.textContent      = _plateSeedFree ? '⬡ FREE IFS on'    : '⬡ FREE IFS';
        btnPlateSeed.style.background = _plateSeedFree ? '#363'              : '#555';
        btnPlateSeed.style.color      = _plateSeedFree ? '#afa'              : '#aaa';
        _gsPropModes.forEach(({ mode, bg, color }, i) => {
          const active = _gsPropagator === mode;
          _gsPropBtns[i].style.background = active ? '#468' : bg;
          _gsPropBtns[i].style.color      = active ? '#fff' : color;
          _gsPropBtns[i].style.outline    = active ? '1px solid #aaa' : 'none';
        });
        btnBackPlate.textContent      = _backPlateMode ? '↩ GS on' : '↩ GS';
        btnDirectBack.textContent      = _directBackMode ? '⟵ EXACT on' : '⟵ EXACT';
        btnDirectBack.style.background = _directBackMode ? '#048'       : '#246';
        btnDirectBack.style.outline    = _directBackMode ? '1px solid #8ef' : 'none';
        btnGsNoise.textContent        = _gsNoiseSeed   ? 'GS:NOISE on' : 'GS:NOISE';
        btnGsNoise.style.background   = _gsNoiseSeed   ? '#641' : '#333';
        btnGsNoise.style.color        = _gsNoiseSeed   ? '#fff' : '#fa8';
        btnGsNoise.style.outline      = _gsNoiseSeed   ? '1px solid #fa8' : 'none';
        btnBackPlate.style.background = _backPlateMode    ? '#246'              : '#345';
        btnBackPlate.style.color      = _backPlateMode    ? '#aef'              : '#8cf';
        btnHamiltonian.textContent      = _hamiltonianMode ? '⬡ HAMILTONIAN on' : '⬡ HAMILTONIAN';
        btnHamiltonian.style.background = _hamiltonianMode ? '#255'             : '#255';
        btnHamiltonian.style.color      = _hamiltonianMode ? '#fff'             : '#5cf';
        btnLive.textContent      = _liveMode ? '⟳ LIVE on' : '⟳ LIVE';
        btnLive.style.background = _liveMode ? '#4a2'      : '#363';
        btnLive.style.color      = _liveMode ? '#fff'      : '#af8';
        btnLive.style.outline    = _liveMode ? '1px solid #af8' : 'none';
        eyeRow.style.display     = _liveMode ? 'flex'      : 'none';
        _recModes.forEach(({ mode, bg, color }, i) => {
          const active = _recordMode === mode;
          _recBtns[i].style.background = active ? '#468' : bg;
          _recBtns[i].style.color      = active ? '#fff' : color;
          _recBtns[i].style.outline    = active ? '1px solid #8cf' : 'none';
        });
        gammaLbl.textContent = `γ ${_plateKernelGamma.toFixed(2)}`;
        if (!gammaSlider.matches(':active')) gammaSlider.value = String(_plateKernelGamma);
        const dtLbl = dtWrap.querySelector('span'), dtSl = dtWrap.querySelector('input');
        if (dtLbl) dtLbl.textContent = `dt ${_plateKernelDT.toFixed(2)}`;
        if (dtSl && !dtSl.matches(':active')) dtSl.value = String(_plateKernelDT);
        const stLbl = stepsWrap.querySelector('span'), stSl = stepsWrap.querySelector('input');
        if (stLbl) stLbl.textContent = `N ${_plateKernelSteps}`;
        if (stSl && !stSl.matches(':active')) stSl.value = String(_plateKernelSteps);
      }

      // Gate all physics/rendering to at most ~60fps.
      // Renkon may call _renderFrame on every model tick (every 1ms); skip the
      // expensive work between frames — only update UI labels on extra calls.
      const _now0 = performance.now();
      const _elapsed = _lastRenderPhysicsMs > 0 ? Math.min(_now0 - _lastRenderPhysicsMs, 50) : 16;
      const _doPhysics = _elapsed >= 16;
      if (_doPhysics) _lastRenderPhysicsMs = _now0;

      // ── Kernel update ─────────────────────────────────────────────────────
      // Frozen during RECON (backward propagation must use recording kernel).
      // Frozen during an active GPU sweep (ref and sweep must use same kernel).
      // Applied only when display psi is in RECORD mode and no sweep is running.
      const nowMs = performance.now();
      const kernelVer = n.cachedRadiiVersion ?? 0;
      const sweepActive = (_sweepStep < T_RECORD && _sweepPsi !== null);
      const extraKey = JSON.stringify(n.extraPoints ?? []);
      const reconSeq = n.reconSeq ?? 0;
      if (_gpuReady && _gpuKernelVersion !== kernelVer && dir >= 0 && !sweepActive) {
        _gpu.setRings(n.cachedRadii, n.cachedWeights, n.cachedOffsets);
        _gpuKernelVersion = kernelVer;
      }

      if (_doPhysics) {
      // ── Rebuild local obj/ref fields when kernel or angle changes ─────────
      const needObj  = _localKernelVersion !== kernelVer ||
                       _localAngleYSeen !== n.angleY || _localAngleXSeen !== n.angleX ||
                       _localExtraSeen !== extraKey || _localShapeSeen !== (n.shape ?? 'cube') || !_localObjField;
      // Eye re-snap is gated on the OBJECT (angle/shape/points) ONLY — never on the IFS
      // clock (kernelVer), which breathes continuously. Like a plate snap: record once,
      // freeze. Tying it to kernelVer would re-run the ~840-pass eye pipeline every tick.
      const eyeObjKey = `${n.angleY}|${n.angleX}|${n.shape ?? 'cube'}|${extraKey}`;
      if (eyeObjKey !== _eyeObjKeySeen) { _eyeDirty = true; _eyeObjKeySeen = eyeObjKey; }

      if (needObj) {
        _localObjField = _buildSrcFieldIFS(n.angleY ?? INIT_ANGLE_Y, n.angleX ?? INIT_ANGLE_X, n.extraPoints ?? [], n.shape ?? 'cube');
        _localAngleYSeen = n.angleY; _localAngleXSeen = n.angleX; _localExtraSeen = extraKey; _localShapeSeen = n.shape ?? 'cube';
        _localKernelVersion = kernelVer;
        if (_gpuReady && dir >= 0 && _localDirection >= 0) _gpu.setObjField(_localObjField);
      }
      // Don't rebuild ref while a sweep is in progress — ref and sweep must use same kernel.
      const needRef = (!_localRefField || _localRefKernelVersion !== kernelVer) && dir >= 0 && !sweepActive;
      if (needRef && n.cachedRadii.length) {
        const psiR0 = _initRefPsi();
        _localRefReady = false;
        if (_gpuReady) {
          // GPU path: seed sweep with ref init, run T_RECORD steps, bake into ref texture
          _gpu.setSweepPsi(psiR0);
          _gpu.buildRefFromSweep(T_RECORD, DT);
          _localRefField = psiR0; // placeholder — keeps needRef false until readback arrives
          _gpu.readSweepPsiAsync().then(refPsi64 => {
            _localRefField = refPsi64;
            _localRefReady = true;
            console.log('[REF] readback done, N_CELLS=', refPsi64.length / 2);
          });
        } else {
          let psiR = new Float64Array(psiR0);
          for (let i = 0; i < T_RECORD; i++) psiR = _linearStepIFS(psiR, DT, n.cachedRadii, n.cachedWeights, n.cachedOffsets);
          _localRefField = psiR;
          _localRefReady = true;
        }
        _localRefKernelVersion = kernelVer;
        _sweepStep = T_RECORD;
        _sweepPsi  = null;
        _lastKeepaliveMs = 0; // trigger next keepalive sweep immediately
      }

      // ── Plate reset ───────────────────────────────────────────────────────
      const resetSeq = n.plateResetSeq ?? 0;
      if (resetSeq !== _localPlateResetSeq) {
        _localPlateResetSeq  = resetSeq;
        _localPlate          = new Float32Array(N_CELLS);
        _localPsi            = null;
        _localReconStep      = 0;
        _localReconSeq       = -1;
        _localReconHolding   = false;
        _localReconHoldUntil = 0;
        _lastReconStepMs     = 0;
        _localDirection      = 1;
        _localReconSoliton   = false;
        _reconSolitonField   = null;
        _reconDKX = 0; _reconDKY = 0;
        _reconDKXSeen = 0; _reconDKXCurrent = 0; _reconDKYSeen = 0;
        _reconSnapBaseAngleY = 0; _reconSnapBaseAngleX = 0;
        _sweepStep = T_RECORD; _sweepPsi = null; _snapAngleQueue = []; _recordedPlates = [];
        _lastKeepaliveMs = 0;
        _localPlateSnapSeq   = n.plateSnapSeq ?? 0; // sync to current — don't auto-fire after reset
        // Force obj field + kernel re-upload so GPU is fully resynced
        _gpuKernelVersion    = -1;
        _localKernelVersion  = -1;
        _localRefKernelVersion = -1;
        _localRefReady = false;
        _cplxPlateUploaded = false;
        _cplxPlateField    = null;
        _snapSwPsi         = null;
        if (_gpuReady) { _gpu.resetPlate(); _gpu.resetCplxPlate(); }
      }

      // ── Ensure display psi is seeded ──────────────────────────────────────
      if (!_localPsi) {
        _localPsi = new Float64Array(2 * N_CELLS); // zero — soliton grows from vacuum
        if (_gpuReady) _gpu.setPsi(_localPsi);
      }

      // ── Mode change detected ──────────────────────────────────────────────
      if (dir !== _localDirection || reconSeq !== _localReconSeq) {
        _localDirection = dir;
        if (dir < 0) {
          _localReconSeq      = reconSeq;
          _localReconStep     = 0;
          _localReconHolding  = false;
          _localReconSoliton  = false;
          _reconSolitonField  = null;
          _cplxPlateObjReady  = false;
          _reconDKX = 0; _reconDKY = 0;
          _reconDKXSeen = 0; _reconDKXCurrent = 0; _reconDKYSeen = 0; _reconLensFSeen = -1;
          _plateDemodField = null; _plateDemodPending = false;
          _gsPhase = 'fwd'; _gsStepsDone = 0;
          _reconSnapBaseAngleY = _localAngleY;
          _reconSnapBaseAngleX = _localAngleX;
          _lastReconStepMs    = nowMs;
          // Use kernel from last sweep start — that's what the plate was built with.
          // Live cachedRadii may have drifted since then.
          _snapReconRadii   = (_sweepSnapRadii   ?? n.cachedRadii).slice();
          _snapReconWeights = (_sweepSnapWeights ?? n.cachedWeights).slice();
          _snapReconOffsets = (_sweepSnapOffsets ?? n.cachedOffsets).slice();
          // Sync plate from recorded plates — use center angle as default view.
          // Increment _plateSeq so any in-flight readPlateAsync callbacks are discarded.
          _plateSeq++;
          if (_recordedPlates.length > 0) {
            const center = Math.floor((_recordedPlates.length - 1) / 2);
            _localPlate = _recordedPlates[center].plate;
          }
          if (_gpuReady) {
            if (_localPlate) _gpu.uploadPlate(_localPlate);
            let reconWeights = _snapReconWeights;
            if (_noHebbTest && _hebbianWeights && _hebbianWeights.length === _snapReconWeights.length) {
              reconWeights = _snapReconWeights.map((w, i) => w + _hebbianWeights[i]);
            }
            _gpu.setRings(_snapReconRadii, reconWeights, _snapReconOffsets);
            _gpuKernelVersion = -1;
            if (_cplxPlateUploaded && !_plateDrivenMode) {
              // Seed sweep from complex plate and use as objField attractor
              _gpu.reconFromCplxPlate();
              _psiReadPending = false;
              _gpu.readSweepPsiAsync().then(psi64 => {
                let mx = 0;
                for (let j = 0; j < N_CELLS; j++) { const v = psi64[j*2]*psi64[j*2]+psi64[j*2+1]*psi64[j*2+1]; if(v>mx) mx=v; }
                console.log('[RECON] cplx plate recon, sweep max=', Math.sqrt(mx).toFixed(6));
                if (mx < 1e-12) {
                  console.log('[RECON] cplx plate empty after recon, using snapPsi attractor');
                  return;
                }
                const scale = REF_AMP / Math.sqrt(mx);
                const normed = new Float64Array(psi64.length);
                for (let j = 0; j < psi64.length; j++) normed[j] = psi64[j] * scale;
                _gpu.setObjField(normed);
                _localPsi = normed;
                _smoothMaxField = REF_AMP * REF_AMP;
                _localReconSoliton = true;
                _cplxPlateObjReady = true;
                console.log('[RECON] objField from cplx plate, scale=', scale.toFixed(2));
              });
            } else {
              console.log('[RECON] GEO+SEED mode, no cplx plate for GPU reconFromCplxPlate');
            }
          }
          let seed;
          if (_plateDrivenMode) {
            // Pure Hebbian: seed with weak noise so kernel fixed point emerges unbiased
            seed = new Float64Array(2 * N_CELLS);
            for (let j = 0; j < N_CELLS; j++) {
              seed[j*2]   = (Math.random() - 0.5) * REF_AMP * 0.1;
              seed[j*2+1] = (Math.random() - 0.5) * REF_AMP * 0.1;
            }
          } else {
            seed = new Float64Array(2 * N_CELLS);
          }
          _localPsi = seed;
          if (_gpuReady) _gpu.setSweepPsi(seed);
          else _gpu?.setSweepPsi(seed);
          let initMax = 1e-9;
          for (let j = 0; j < N_CELLS; j++) {
            const v = seed[j*2]*seed[j*2] + seed[j*2+1]*seed[j*2+1];
            if (v > initMax) initMax = v;
          }
          _smoothMaxField = initMax;
          _sweepStep = T_RECORD; _sweepPsi = null; _snapAngleQueue = [];
        } else {
          // Resuming RECORD: force GPU kernel + obj field resync to live state
          _gpuKernelVersion = -1;
          _localKernelVersion = -1; // force obj field rebuild + re-upload
          _snapReconRadii = null;
          _localReconSoliton = false;
          _reconSolitonField = null;
          _cplxPlateObjReady = false;
          _recordSeeded = false; // re-seed the persistent RECORD soliton from objField
          // Don't reset _smoothMaxRecord — carry forward so RECORD display stays stable on re-entry
          _lastKeepaliveMs = 0;
        }
      }

      // ── Display psi evolution ────────────────────────────────────────────────
      // RECORD: GPU stepRecord (fast); async readback for rendering (non-blocking).
      // RECON:  JS _linearStepIFS at RECON_STEP_DELAY cadence (1 step/16ms, cheap).
      if (_localObjField && n.cachedRadii.length) {
        if (dir > 0) {
          if (_gpuReady) {
            // During plate snap, retina runs free IFS from vol seed — no display injection
            const snapping = _sweepStep < T_RECORD && _sweepPsi !== null;
            // PERSISTENT evolving soliton: the field carries its state across frames and
            // evolves under the IFS dynamics — true to the physics (a wavefield has memory,
            // it breathes/drifts). objField is injected as a WEAK attractor each step (not a
            // hard reset), so the soliton stays bounded but keeps evolving. This differs from
            // the eye panel, which is a STATELESS eigenstate portrait (re-relaxed each snap).
            if (!snapping) {
              // Seed once: from the object field on first entry / after a mode reset. After
              // that, never overwrite — step the live sweep state forward.
              if (!_recordSeeded) {
                _gpu.setSweepPsi(_localObjField);
                _recordSeeded = true;
              }
              // A few steps/frame → continuous, persistent evolution (not a from-scratch
              // settle). The soliton remembers the previous frame.
              const _recSteps = _breathVis ? 16 : 0; // BREATH off → freeze the current state
              for (let _si = 0; _si < _recSteps; _si++) _gpu.stepRecordSweep(DT, SRC_ALPHA);
            }
            // Inject extra beams (Shift+right-click sources) into main GPU psi texture
            const beams = n.extraBeams;
            if (beams && beams.length > 0) {
              const t = n.time ?? 0;
              const src32 = new Float32Array(N_CELLS * 2);
              for (const b of beams) {
                const ph0 = b.freq * t + b.ph0;
                const ringCount = b.rings.length || 1;
                for (const ring of b.rings) {
                  const ph = ph0 + ring.phOff;
                  const scale = b.amp / (ring.cells.length * ringCount);
                  const cr = scale * Math.cos(ph), ci = scale * Math.sin(ph);
                  for (const j of ring.cells) { src32[j*2] += cr; src32[j*2+1] += ci; }
                }
                const jc = b.gy * GRID + b.gx;
                src32[jc*2]   += b.amp / ringCount * Math.cos(ph0);
                src32[jc*2+1] += b.amp / ringCount * Math.sin(ph0);
              }
              _gpu.addSourcesPsi(src32);
            }
            if (!_psiReadPending) {
              _psiReadPending = true;
              _gpu.readPsiAsync().then(psi64 => {
                _psiReadPending = false;
                _localPsi = psi64;
              });
            }
          } else {
            const _stepsThisFrame = Math.min(32, Math.max(1, Math.round(_elapsed)));
            for (let _si = 0; _si < _stepsThisFrame; _si++) {
              _localPsi = _linearStepIFS(_localPsi, DT, n.cachedRadii, n.cachedWeights, n.cachedOffsets);
              for (let j = 0; j < N_CELLS; j++) {
                _localPsi[j*2]   += SRC_ALPHA * (_localObjField[j*2]   - _localPsi[j*2]);
                _localPsi[j*2+1] += SRC_ALPHA * (_localObjField[j*2+1] - _localPsi[j*2+1]);
              }
              for (const b of (n.extraBeams ?? [])) {
                const t = n.time ?? 0;
                const ph0 = b.freq * t + b.ph0;
                const ringCount = b.rings.length || 1;
                for (const ring of b.rings) {
                  const ph = ph0 + ring.phOff;
                  const scale = b.amp / (ring.cells.length * ringCount);
                  const cr = scale * Math.cos(ph), ci = scale * Math.sin(ph);
                  for (const j of ring.cells) { _localPsi[j*2] += cr; _localPsi[j*2+1] += ci; }
                }
                const jc = b.gy * GRID + b.gx;
                _localPsi[jc*2]   += b.amp / ringCount * Math.cos(ph0);
                _localPsi[jc*2+1] += b.amp / ringCount * Math.sin(ph0);
              }
            }
          }
        } else {
            // RECON: compute focused field instantly (all T_RECORD steps in one RAF),
            // upload as objField attractor, then run stepRecordSweep as continuous soliton.
            // No frame-by-frame animation — the reconstruction IS the soliton fixed point.
            const probe = n.depthProbe;
            const targetSteps = probe
              ? Math.max(1, Math.round((probe.depthFraction ?? 0.5) * T_RECORD))
              : T_RECORD;

            // Attractor traversal: sweep plate demodulation parameters each frame.
            {
              const lensF = n.lensF ?? 50;
              const plate = _recordedPlates.length > 0 ? _recordedPlates[0].plate : _localPlate;
              // Live angle drag in RECON → update carrier tilt for parallax readout.
              // Use _localAngleY (updated immediately on drag) not n.reconAngleY (reflector round-trip).
              if (_plateDrivenMode && !_autoRotate) {
                const snapAY = _reconSnapBaseAngleY ?? INIT_ANGLE_Y;
                _travDKX = (_localAngleY - snapAY) * PARALLAX_SCALE;
              }
              if (_autoRotate && _plateDrivenMode) {
                _travPhase += TRAV_SPEED;
                const s = Math.sin(_travPhase);
                if      (_autoTravMode === 'rot')   { _travRot    = s * 0.6; }
                else if (_autoTravMode === 'dkx')   { _travDKX    = s * 0.25; }
                else if (_autoTravMode === 'dky')   { _travDKY    = s * 0.25; }
                else if (_autoTravMode === 'shift')  { _travShiftX = s * 12; _travShiftY = s * 8; }
                else if (_autoTravMode === 'scale')  { _travScale  = 1 + s * 0.5; }
              }
              const needUpdate = _autoRotate || Math.abs(_travDKX - _reconDKXCurrent) > 0.002 || lensF !== _reconLensFSeen;
              if (needUpdate && _gpuReady && plate?.length && !_plateDemodPending) {
                _reconDKXCurrent = _travDKX;
                _reconLensFSeen  = lensF;
                const raw = _buildReconField(plate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale);
                if (_plateDemodMode) {
                  // Project onto IFS eigenstates: free-propagate demod field for PROJ_STEPS
                  // then read back — result is the nearest IFS eigenstate to the object wave
                  const PROJ_STEPS = T_RECORD;
                  _plateDemodPending = true;
                  _plateDemodField = null;
                  _gpu.setSweepPsi(raw);
                  _gpu.stepSweepN(PROJ_STEPS, DT);
                  _gpu.readSweepPsiAsync().then(projected => {
                    _plateDemodField = projected;
                    _plateDemodPending = false;
                    _localReconSoliton = false; // re-trigger soliton entry with projected field
                  });
                } else if (_plateDrivenMode) {
                  // Live parallax: update objField attractor without resetting the soliton.
                  // Soliton keeps running; new demod shifts the fixed point it converges toward.
                  _plateDemodField = raw;
                  let dmMx = 0;
                  for (let j = 0; j < N_CELLS; j++) { const v = raw[j*2]*raw[j*2]+raw[j*2+1]*raw[j*2+1]; if (v > dmMx) dmMx = v; }
                  const dmScale = dmMx > 1e-12 ? REF_AMP / Math.sqrt(dmMx) : 1;
                  const plateObj = new Float64Array(raw.length);
                  for (let j = 0; j < raw.length; j++) plateObj[j] = raw[j] * dmScale;
                  _gpu.setObjField(plateObj);
                } else {
                  _plateDemodField = raw;
                  _gpu.setSweepPsi(raw);
                  _localReconSoliton = false;
                  _cplxPlateObjReady = false;
                }
              }
            }

            if (!_localReconSoliton && !_cplxPlateObjReady && _gpuReady) {
              _smoothMaxField = 1e-9;
              _localReconSoliton = true;
              if (_directBackMode && _snapSwPsi) {
                // Exact backward reconstruction: upload swPsi, run T backward steps, freeze result.
                _gpu.setSweepPsi(_snapSwPsi);
                _gpu.stepSweepN(T_RECORD, -DT);
                // Read result back immediately so continuous block can freeze it
                const reconResult = _gpu.readPsi();
                _gpu.setSweepPsi(reconResult);
                _localPsi = reconResult;
                _directBackPsi = reconResult; // protected copy
                let mx = 0, peakJ = 0, totalE = 0;
                for (let j=0;j<N_CELLS;j++){
                  const v=reconResult[j*2]*reconResult[j*2]+reconResult[j*2+1]*reconResult[j*2+1];
                  totalE += v;
                  if(v>mx){mx=v;peakJ=j;}
                }
                _smoothMaxField = mx;
                _directBackMax = mx;
                const fracAtPeak = totalE > 0 ? mx/totalE : 0;
                console.log('[DIRECT-BACK] done, peak amp=', Math.sqrt(mx).toFixed(4),
                  'at (', peakJ%GRID, ',', Math.floor(peakJ/GRID), ')',
                  'energy frac=', (fracAtPeak*100).toFixed(1)+'%');
              } else if (_directBackMode && !_snapSwPsi) {
                console.log('[DIRECT-BACK] no snapSwPsi — snap a plate first');
                _gpu.setSweepPsi(new Float64Array(2 * N_CELLS));
              } else if (_cplxPlateUploaded && !_plateDrivenMode) {
                // GEO+SEED with cplx plate: no snapPsi in retina arch — fall through to default
              } else if (_plateSeedFree) {
                const seed = _localPlate
                  ? _buildReconField(_localPlate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale)
                  : new Float64Array(2 * N_CELLS);
                _gpu.setSweepPsi(seed);
              } else if (_plateKernelMode) {
                const noiseSeed = new Float64Array(2 * N_CELLS);
                for (let j = 0; j < N_CELLS; j++) {
                  noiseSeed[j*2]   = (Math.random() - 0.5) * REF_AMP * 0.1;
                  noiseSeed[j*2+1] = (Math.random() - 0.5) * REF_AMP * 0.1;
                }
                _gpu.setSweepPsi(noiseSeed);
              } else if (_demodKickMode) {
                // Seed from demodulated plate — start near object wavefront, kick stabilizes it
                const demod = _localPlate
                  ? _buildReconField(_localPlate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale)
                  : new Float64Array(2 * N_CELLS);
                _gpu.setSweepPsi(demod);
                _gpu.setObjField(demod);
              } else if (_backPlateMode) {
                // GS entry: noise seed tests whether plate constraint drives convergence;
                // demod seed tests refinement quality. Switch with GS:NOISE button.
                let initGuess;
                if (_gsNoiseSeed) {
                  initGuess = new Float64Array(2 * N_CELLS);
                  for (let j = 0; j < N_CELLS; j++) {
                    initGuess[j*2]   = (Math.random() - 0.5) * REF_AMP * 0.1;
                    initGuess[j*2+1] = (Math.random() - 0.5) * REF_AMP * 0.1;
                  }
                  console.log('[GS] seeded from NOISE — plate must drive convergence');
                } else {
                  initGuess = _localPlate
                    ? _buildReconField(_localPlate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale)
                    : new Float64Array(2 * N_CELLS);
                  console.log('[GS] seeded from demod plate, propagator=' + _gsPropagator);
                }
                _gpu.setSweepPsi(initGuess);
                _gsPhase = 'fwd'; _gsStepsDone = 0;
              } else if (_plateDrivenMode) {
                if (_nullPlateTest) {
                  _gpu.setSweepPsi(new Float64Array(2 * N_CELLS));
                  _gpu.setObjField(new Float64Array(2 * N_CELLS));
                } else if (_localPlate) {
                  // Noise seed for both sweep and main psi — find plate attractor unbiased
                  const noiseSeed = new Float64Array(2 * N_CELLS);
                  for (let j = 0; j < N_CELLS; j++) {
                    noiseSeed[j*2]   = (Math.random() - 0.5) * REF_AMP * 0.1;
                    noiseSeed[j*2+1] = (Math.random() - 0.5) * REF_AMP * 0.1;
                  }
                  _gpu.setSweepPsi(noiseSeed);
                  // objField = demodulated plate, rescaled to REF_AMP so injection is strong
                  const plateObj = _buildReconField(_localPlate, _travDKX, _travRot, _localRefReady ? _localRefField : null, _travDKY, _travShiftX, _travShiftY, _travScale);
                  let dmMx = 0; for (let j=0; j<N_CELLS; j++) { const v=plateObj[j*2]*plateObj[j*2]+plateObj[j*2+1]*plateObj[j*2+1]; if(v>dmMx) dmMx=v; }
                  const dmScale = dmMx > 1e-12 ? REF_AMP / Math.sqrt(dmMx) : 1;
                  for (let j=0; j<N_CELLS*2; j++) plateObj[j] *= dmScale;
                  console.log('[RECON] plate demod objField, raw max=', Math.sqrt(dmMx).toFixed(6), 'scaled to REF_AMP');
                  _gpu.setObjField(plateObj);
                } else {
                  _gpu.setSweepPsi(new Float64Array(2 * N_CELLS));
                  _gpu.setObjField(new Float64Array(2 * N_CELLS));
                }
              } else if (_plateDemodMode && _plateDemodField) {
                // Plate demod: inject demodulated plate as attractor — no snapPsi used
                _gpu.setObjField(_plateDemodField);
              } else {
                _gpu.setObjField(new Float64Array(2 * N_CELLS));
              }
            } else if (_localReconSoliton && _gpuReady) {
              if (_directBackMode) {
                if (_snapSwPsi) {
                  _gpu.setSweepPsi(_snapSwPsi);
                  if (_recordMode === 'ifs_depth' && _focusDepth > 0) {
                    _gpu.stepSweepN(T_RECORD - _focusDepth, -DT);
                  } else {
                    _gpu.stepSweepN(T_RECORD, -DT);
                    if (_focusDepth > 0) {
                      for (let _s = 0; _s < _focusDepth; _s++)
                        _gpu.stepHuygensSweep(-K_WAVE);
                    }
                  }
                  // Pin normalization to entry snapshot — immune to async readback drift
                  if (_directBackMax > 1e-12) _smoothMaxField = _directBackMax;
                }
              } else if (_plateSeedFree) {
                for (let _si = 0; _si < 16; _si++) _gpu.stepSweep(DT);
              } else if (_backPlateMode) {
                if (_smoothMaxPlate < 1e-6) {
                  // No plate recorded yet — run plain IFS so field stays visible
                  for (let _si = 0; _si < 16; _si++) _gpu.stepSweep(DT);
                } else {
                // Gerchberg-Saxton — async state machine: _gsSteps draw calls per frame,
                // advancing fwd→constraint→bwd across frames.
                const budget = _gsSteps;
                let remaining = budget;
                while (remaining > 0) {
                  if (_gsPhase === 'fwd') {
                    const toRun = Math.min(remaining, T_RECORD - _gsStepsDone);
                    if (_gsPropagator === 'huygens') {
                      for (let _s = 0; _s < toRun; _s++) _gpu.stepHuygensSweep(K_WAVE);
                    } else {
                      _gpu.stepSweepN(toRun, DT);
                    }
                    _gsStepsDone += toRun;
                    remaining    -= toRun;
                    if (_gsStepsDone >= T_RECORD) { _gsPhase = 'constraint'; _gsStepsDone = 0; }
                  } else if (_gsPhase === 'constraint') {
                    _gpu.plateAmpConstraintSweep(_smoothMaxPlate);
                    _gsPhase = 'bwd'; _gsStepsDone = 0;
                    remaining--;
                  } else { // 'bwd'
                    const toRun = Math.min(remaining, T_RECORD - _gsStepsDone);
                    if (_gsPropagator === 'huygens') {
                      for (let _s = 0; _s < toRun; _s++) _gpu.stepHuygensSweep(-K_WAVE);
                    } else {
                      _gpu.stepSweepN(toRun, -DT);
                    }
                    _gsStepsDone += toRun;
                    remaining    -= toRun;
                    if (_gsStepsDone >= T_RECORD) { _gsPhase = 'fwd'; _gsStepsDone = 0; }
                  }
                }
                } // end else (plate ready)
              } else if (_plateKernelMode) {
                for (let _si = 0; _si < _plateKernelSteps; _si++) {
                  _gpu.stepSweep(_plateKernelDT);
                  _gpu.platePhaseKickSweep(_plateKernelGamma, _smoothMaxPlate);
                }
              } else if (_demodKickMode) {
                // IFS step + demodulated object wavefront phase kick
                for (let _si = 0; _si < _plateKernelSteps; _si++) {
                  _gpu.stepSweep(_plateKernelDT);
                  _gpu.demodPhaseKickSweep(_plateKernelGamma);
                }
              } else {
                if (_nullPlateTest || !_plateDrivenMode) _gpu.setObjField(new Float64Array(2 * N_CELLS));
                if (_hamiltonianMode && !_nullPlateTest && _smoothMaxPlate > 1e-9) {
                  for (let _si = 0; _si < 16; _si++)
                    _gpu.stepRecordSweepHamiltonian(DT, SRC_ALPHA, _plateKernelGamma, _smoothMaxPlate);
                } else {
                  for (let _si = 0; _si < 16; _si++) _gpu.stepRecordSweep(DT, SRC_ALPHA);
                }
              }
              // Periodic readback — keep _localPsi current for _smoothMaxField EMA
              if (!_psiReadPending) {
                _psiReadPending = true;
                _gpu.readSweepPsiAsync().then(psi64 => {
                  _psiReadPending = false;
                  _localPsi = psi64;
                });
              }
            } else {
              // JS fallback
              if (!_localReconHolding && nowMs - _lastReconStepMs >= RECON_STEP_DELAY) {
                if (_localReconStep >= targetSteps) {
                  _localReconHolding = true; _localReconHoldUntil = nowMs + RECON_HOLD_MS;
                } else {
                  const rR = _snapReconRadii ?? n.cachedRadii;
                  const rW = _snapReconWeights ?? n.cachedWeights;
                  const rO = _snapReconOffsets ?? n.cachedOffsets;
                  _localPsi = _linearStepIFS(_localPsi, -DT, rR, rW, rO);
                  _localReconStep++; _lastReconStepMs = nowMs;
                }
              }
            }
          }
        }
      }

      // ── Plate sweep (RECORD only, manual snap) ────────────────────────────────
      // Triggered when plateSnapSeq changes. Runs T_RECORD steps then accumulates.
      if (dir > 0 && _localRefField && n.cachedRadii.length) {
        const snapSeq = n.plateSnapSeq ?? 0;
        // New snap: queue N_SNAP_ANGLES exposures, each gets its own fresh plate
        if (snapSeq !== _localPlateSnapSeq && _snapAngleQueue.length === 0) {
          _localPlateSnapSeq = snapSeq;
          _recordedPlates = [];
          // Compute Hebbian ring weights from current RECORD soliton:
          // w_d = Σ_{x,i} Re(ψ(x) · conj(ψ(x+off_i))) / (N * n_d)
          if (_gpuReady) {
            _gpu.readPsiAsync().then(psi64 => {
              const radii   = n.cachedRadii;
              const offsets = n.cachedOffsets;
              if (!radii.length) return;
              const W = new Array(radii.length).fill(0);
              for (let d = 0; d < radii.length; d++) {
                const offs = offsets[d];
                const nd   = offs.length >> 1;
                if (!nd) continue;
                let acc = 0;
                for (let j = 0; j < N_CELLS; j++) {
                  const cx = j % GRID, cy = (j / GRID) | 0;
                  const re0 = psi64[j*2], im0 = psi64[j*2+1];
                  for (let i = 0; i < nd; i++) {
                    const nx = ((cx + offs[i*2]   % GRID) + GRID) % GRID;
                    const ny = ((cy + offs[i*2+1] % GRID) + GRID) % GRID;
                    const nb = ny * GRID + nx;
                    // Re(ψ · conj(ψ_nb)) = re0*re_nb + im0*im_nb
                    acc += re0 * psi64[nb*2] + im0 * psi64[nb*2+1];
                  }
                }
                W[d] = acc / (N_CELLS * nd);
              }
              // Normalize so max weight = FRAC_ALPHA
              const maxW = Math.max(...W.map(Math.abs), 1e-9);
              _hebbianWeights = W.map(w => (w / maxW) * FRAC_ALPHA);
              console.log('[HEBBIAN] weights=', _hebbianWeights.map(v => v.toFixed(4)));
            });
          }
          const baseY = n.angleY ?? INIT_ANGLE_Y;
          const baseX = n.angleX ?? INIT_ANGLE_X;
          const half = (N_SNAP_ANGLES - 1) / 2;
          for (let i = 0; i < N_SNAP_ANGLES; i++) {
            _snapAngleQueue.push({ angleY: baseY + (i - half) * SNAP_ANGLE_STEP, angleX: baseX });
          }
        }
        // Start next exposure when sweep is idle
        if (_sweepStep >= T_RECORD && _sweepPsi === null && _snapAngleQueue.length > 0) {
          const { angleY: qY, angleX: qX } = _snapAngleQueue.shift();
          if (_recordMode === 'retina') {
            // Retina mode: accumulate |ψ_retina + ψ_ref|² directly — no sweep needed.
            // Use the live retina psi already on GPU; just trigger plate accumulation.
            _sweepStep = T_RECORD - 1; // will complete next frame
            _sweepPsi  = new Float64Array(2); // sentinel — non-null to signal active
            _sweepAngleY = qY; _sweepAngleX = qX; _sweepExtraKey = extraKey;
            _sweepSnapRadii   = n.cachedRadii.slice();
            _sweepSnapWeights = n.cachedWeights.slice();
            _sweepSnapOffsets = n.cachedOffsets.slice();
            if (_gpuReady) {
              _gpu.resetPlate();
              _gpu.accumulatePlateSweep(PLATE_DECAY); // record current retina state
            }
          } else {
          if (_recordMode === 'ifs_depth') {
            // Mid-sweep injection: all vertices propagate together in one field.
            // Each vertex fires at its depth-appropriate step — they interfere = hologram.
            _depthSchedule = _buildDepthSourceSchedule(
              qY, qX, n.extraPoints ?? [], n.shape ?? 'cube', T_RECORD);
            _sweepPsi = new Float64Array(2 * N_CELLS); // zero — sources added mid-sweep
          } else {
            const seed = _recordMode === 'ifs'
              ? _buildSrcFieldIFS(qY, qX, n.extraPoints ?? [], n.shape ?? 'cube')
              : _buildVolSrcField(qY, qX, n.extraPoints ?? [], n.shape ?? 'cube');
            _sweepPsi = new Float64Array(seed);
            _depthSchedule = null;
          }
          _sweepAngleY = qY; _sweepAngleX = qX; _sweepExtraKey = extraKey;
          _sweepSnapRadii   = n.cachedRadii.slice();
          _sweepSnapWeights = n.cachedWeights.slice();
          _sweepSnapOffsets = n.cachedOffsets.slice();
          _sweepStep = 0;
          if (_gpuReady) { _gpu.resetPlate(); _gpu.setSweepPsi(_sweepPsi); }
          } // end else (non-retina sweep modes)
        }
        if (_sweepStep < T_RECORD && _sweepPsi) {
          if (_gpuReady) {
            const toRun = Math.min(GPU_STEPS_PER_FRAME, T_RECORD - _sweepStep);
            if (_depthSchedule) {
              for (let _s = 0; _s < toRun; _s++) {
                _gpu.stepSweep(DT);
                const inj = _depthSchedule[_sweepStep + _s];
                if (inj) _gpu.addSourcesPsi(new Float32Array(inj.map(v => Math.fround(v))));
              }
            } else {
              _gpu.stepSweepN(toRun, DT);
            }
            _sweepStep += toRun;
            if (_sweepStep >= T_RECORD) {
              _gpu.accumulatePlateSweep(PLATE_DECAY);
              // Synchronous readback of sweep psi before stepRecord resumes
              _snapSwPsi = _gpu.readPsi();
              console.log('[SNAP] swPsi captured synchronously, max=',
                Math.sqrt(_snapSwPsi.reduce((m,v,i)=>i%2===0?Math.max(m,v*v+_snapSwPsi[i+1]*_snapSwPsi[i+1]):m,0)).toFixed(4));
              // JS-side complex plate: read sweep psi (Float32→Float64), multiply by conj(ref) in Float64
              const _capturedRef = _localRefReady ? _localRefField : null;
              const _seqCplx = _plateSeq;
              _gpu.readSweepPsiAsync().then(swPsi => {
                if (_plateSeq !== _seqCplx) { console.log('[CPLX] aborted: plateSeq changed'); return; }
                if (!_capturedRef) { console.log('[CPLX] aborted: no ref field at snap time'); return; }
                if (swPsi.length !== _capturedRef.length) { console.log('[CPLX] aborted: length mismatch', swPsi.length, _capturedRef.length); return; }
                // _snapSwPsi already captured synchronously above
                const cplx = new Float32Array(N_CELLS * 2);
                let mx = 0;
                for (let j = 0; j < N_CELLS; j++) {
                  const pr = swPsi[j*2], pi = swPsi[j*2+1];
                  const rr = _capturedRef[j*2], ri = _capturedRef[j*2+1];
                  cplx[j*2]   = pr*rr + pi*ri;
                  cplx[j*2+1] = pi*rr - pr*ri;
                  const m = pr*pr+pi*pi; if (m>mx) mx=m;
                }
                _gpu.uploadCplxPlate(cplx);
                _cplxPlateUploaded = true;
                // Keep JS copy of ψ_sweep·conj(ψ_ref) for debug canvas
                const swMx = Math.sqrt(mx);
                let cplxMx = 0;
                for (let j = 0; j < N_CELLS; j++) { const v = cplx[j*2]*cplx[j*2]+cplx[j*2+1]*cplx[j*2+1]; if(v>cplxMx) cplxMx=v; }
                const cplxScale = cplxMx > 1e-12 ? REF_AMP / Math.sqrt(cplxMx) : 1;
                _cplxPlateField = new Float64Array(N_CELLS * 2);
                for (let j = 0; j < N_CELLS * 2; j++) _cplxPlateField[j] = cplx[j] * cplxScale;
                console.log('[CPLX-PLATE] uploaded, sweep max=', swMx.toFixed(6));
              });
              const capturedAngleY = _sweepAngleY;
              const capturedAngleX = _sweepAngleX;
              const _seq = _plateSeq;
              _gpu.readPlateAsync().then(pl => {
                if (_plateSeq !== _seq) return;
                _recordedPlates.push({ angleY: capturedAngleY, angleX: capturedAngleX, plate: pl });
                // Keep _localPlate pointing at the center-angle plate for display
                const center = Math.floor(_recordedPlates.length / 2);
                _localPlate = _recordedPlates[center].plate;
                console.log('[PLATE-ACCUM] angleY=', capturedAngleY?.toFixed(3), 'plates=', _recordedPlates.length);
              });
              _sweepPsi = null;
            }
          } else {
            // JS fallback: run synchronously
            while (_sweepStep < T_RECORD) {
              _sweepPsi = _linearStepIFS(_sweepPsi, DT, n.cachedRadii, n.cachedWeights, n.cachedOffsets);
              _sweepStep++;
            }
            const newPl = new Float32Array(N_CELLS);
            for (let j = 0; j < N_CELLS; j++) {
              const re = _sweepPsi[j*2]   + _localRefField[j*2];
              const im = _sweepPsi[j*2+1] + _localRefField[j*2+1];
              newPl[j] = (re*re + im*im);
            }
            _recordedPlates.push({ angleY: _sweepAngleY, angleX: _sweepAngleX, plate: newPl });
            _localPlate = newPl;
            _sweepPsi = null;
          }
        }
      }

      // Update local angle from world state (if not dragging).
      // In RECON use reconAngleY so the committed drag angle persists; in RECORD use angleY.
      if (!_dragging) {
        if (dir < 0) {
          _localAngleY = n.reconAngleY ?? INIT_ANGLE_Y;
          _localAngleX = n.reconAngleX ?? INIT_ANGLE_X;
        } else {
          _localAngleY = n.angleY ?? INIT_ANGLE_Y;
          _localAngleX = n.angleX ?? INIT_ANGLE_X;
        }
      }

      // ── Normalization ─────────────────────────────────────────────────────
      if (_localPsi) {
        let maxField = 1e-9;
        for (let j = 0; j < N_CELLS; j++) {
          const v = _localPsi[j*2]*_localPsi[j*2] + _localPsi[j*2+1]*_localPsi[j*2+1];
          if (v > maxField) maxField = v;
        }
        // Asymmetric EMA: jump instantly to spikes, decay slowly — eliminates flood flicker.
        const newSmooth = maxField > _smoothMaxField
          ? maxField
          : _smoothMaxField * 0.97 + maxField * 0.03;
        _smoothMaxField = isFinite(newSmooth) && newSmooth > 1e-12 ? newSmooth : 1e-9;
      }
      let maxPlate = 1e-9;
      if (_localPlate) {
        for (let j = 0; j < N_CELLS; j++) if (_localPlate[j] > maxPlate) maxPlate = _localPlate[j];
        _smoothMaxPlate = _smoothMaxPlate < 1e-9 ? maxPlate : _smoothMaxPlate * 0.96 + maxPlate * 0.04;
      }
      // LIVE mode: periodically read back GPU plate so _smoothMaxPlate stays current
      if (_liveMode && _gpuReady && !_psiReadPending && (_localStepCount % 60 === 0)) {
        _gpu.readPlateAsync().then(pl => {
          _localPlate = pl;
        });
      }

      // ── Rendering — single retina texture, always render from sweep ───────────
      if (_gpuReady) {
        // Sync peak readback every frame — catches flood spikes before they hit the display.
        // ~0.1ms on 128² GPU; eliminates the 1-frame lag that causes white flicker.
        const peakSq = _gpu.readSwPeakSq();
        if (peakSq > _smoothMaxField) _smoothMaxField = peakSq;
        const norm = Math.max(_smoothMaxField, 1e-9);
        _gpu.renderSweepField(norm);
        fieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);

        // Main row always shows normal rendering
        _gpu.renderSweepPhase(norm);
        phaseCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
        _gpu.renderSweepPlate(_smoothMaxPlate, norm);
        plateCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);

        // Eye row — EYE-AS-OBSERVER model. The object lives in the "world"; the eye
        // receives ONLY the wavefront that has propagated across the aperture, and must
        // infer the object from that field alone — it never reads ψ_obj.
        //
        //   WORLD:  ψ_obj ──F^D──► ψ_arrived        (object emits; field crosses to eye)
        //   EYE:    ψ_arrived ──F^-D──► ψ_perceived (eye back-propagates the ARRIVED field)
        //
        //   panel 1: |ψ_arrived|²   — what the eye RECEIVES (CACHED; changes on object change)
        //   panel 3: |ψ_perceive|²  — PERSISTENT evidence soliton: seeded from the exact inverse,
        //                             evolves freely (a living field, carries state across frames)
        //   panel 2: |ψ_percept|²   — PERSISTENT percept: evolves under IFS dynamics while WEAKLY
        //                             tracking the evidence (panel 3). Memory + hysteresis: the
        //                             percept flows toward incoming evidence, never resets.
        //
        //   [H] hologram-domain transform sits between the legs (CACHED stage), via applyEyeHologram.
        //
        // Discipline: the eye reconstructs from ψ_arrived, NEVER from ψ_obj. ψ_obj is the world's
        // hidden object — used only to emit the wavefront and (with MIX>0) score externally.
        if (_liveMode && _localObjField) {
          const D = T_RECORD;

          // ── CACHED stage (object change only): emit wavefront + exact inverse = evidence ──
          // CONVERGE-THEN-HOLD: all eye work happens ONLY on object change (_eyeDirty).
          // The evidence is held static (it's a measurement); the percept is relaxed onto
          // it until it SETTLES, then frozen. Between changes nothing steps → no drift, the
          // panels hold a stable percept. Each rotate re-locks onto the new view.
          if (_eyeDirty) {
            // WORLD: object emits; wavefront propagates D steps to the eye aperture.
            _gpu.setEyePsi(_localObjField);
            _gpu.stepEyeN(D, DT);
            _eyeArrivedNorm = _gpu.readEyePeakSq();
            if (_eyeArrivedNorm < 1e-12) _eyeArrivedNorm = Math.max(_smoothMaxField, 1e-9);
            // Panel 1 — received wavefront |ψ_arrived|² (held until next object change).
            _gpu.renderEyeField(_eyeArrivedNorm);
            eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
            eyeFieldCell.wrap.firstChild.textContent = 'EYE  |ψ_arrived|²  received wavefront';

            // [H] transform, then back-propagate → EVIDENCE (the exact inverse, static).
            _gpu.applyEyeHologram(_eyeHmode, _eyeHparam);
            _gpu.stepEyeN(D, -DT);
            _eyeEvidence = _gpu.readEyePsi();          // ψ_perceived — held static
            let pvNorm = _gpu.readEyePeakSq();
            if (pvNorm < 1e-12) pvNorm = Math.max(_smoothMaxField, 1e-9);
            // Panel 3 — the evidence (exact inverse), held static (a measurement, no drift).
            if (_liveRefMix > 0) {
              _gpu.renderEyeDiff(_localObjField, _liveRefMix, pvNorm);
              eyeDiffCell.wrap.firstChild.textContent = `EYE  ψ_perceive + ${_liveRefMix.toFixed(2)}·ψ_obj  (score)`;
            } else {
              _gpu.renderEyeField(pvNorm);
              eyeDiffCell.wrap.firstChild.textContent = 'EYE  |ψ_perceive|²  evidence (held)';
            }
            eyeDiffCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);

            // Panel 2 — PERCEPT: relax onto the evidence until it CONVERGES, then HOLD.
            // Seed from the previous percept (memory: it transitions from the old view),
            // attractor = new evidence, strong-enough α + enough steps to actually settle.
            if (_eyePerceptState) _gpu.setEyePsi(_eyePerceptState);
            else                  _gpu.setEyePsi(_eyeEvidence);
            _gpu.setEyeObjField(_eyeEvidence);
            for (let _ri = 0; _ri < EYE_RELAX_STEPS; _ri++) _gpu.stepRecordEye(DT, SRC_ALPHA);
            _eyePerceptState = _gpu.readEyePsi();       // store converged percept (held)
            let pcNorm = _gpu.readEyePeakSq();
            if (pcNorm < 1e-12) pcNorm = Math.max(_smoothMaxField, 1e-9);
            _gpu.renderEyeField(pcNorm);
            eyePhaseCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
            eyePhaseCell.wrap.firstChild.textContent = 'EYE  |ψ_percept|²  perceived (settled)';

            _eyeReconNorm = _eyeArrivedNorm;
            _eyeReady = true;
            _eyeDirty = false;
          }
          // Between changes: do nothing. Panels hold their settled images on their 2D
          // canvases — stable, no per-frame stepping, no drift.
        }

        /* ── Animated propagating-wavefront version (disabled) ──────────────────
        if (_liveMode && _localObjField) {
          _eyeT += _eyeDir * EYE_SPEED;
          if (_eyeT >= T_RECORD) { _eyeT = T_RECORD; _eyeDir = -1; }
          else if (_eyeT <= 0)   { _eyeT = 0;        _eyeDir = +1; }
          _gpu.setEyePsi(_localObjField);
          if (_eyeT > 0) _gpu.stepEyeN(_eyeT, DT);
          if (_eyeReconNorm < 1e-10 || (_localStepCount % 6) === 0) {
            const peakSq = _gpu.readEyePeakSq();
            _eyeReconNorm = _eyeReconNorm < 1e-10 ? Math.max(peakSq, 1e-9)
                                                  : _eyeReconNorm * 0.8 + Math.max(peakSq, 1e-12) * 0.2;
          }
          const depthPct = (100 * _eyeT / T_RECORD) | 0;
          _gpu.renderEyeField(_eyeReconNorm);
          eyeFieldCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyeFieldCell.wrap.firstChild.textContent =
            _eyeT === 0 ? 'EYE  |ψ|²  object plane (t=0)'
                        : `EYE  |ψ(t)|²  wavefront  t=${_eyeT}/${T_RECORD} (${depthPct}%)`;
          _gpu.renderEyePhase(_eyeReconNorm);
          eyePhaseCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
          eyePhaseCell.wrap.firstChild.textContent = 'EYE  arg(ψ(t))  phase';
          if (_liveRefMix > 0) {
            _gpu.renderEyeDiff(_localObjField, _liveRefMix, _eyeReconNorm);
            eyeDiffCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
            eyeDiffCell.wrap.firstChild.textContent = `EYE DIFF  |ψ(t) + ${_liveRefMix.toFixed(2)}·ψ_obj|`;
          } else {
            _gpu.renderEyeField(_eyeReconNorm);
            eyeDiffCell.ctx.drawImage(_gpuCanvas, 0, 0, RW, RH);
            eyeDiffCell.wrap.firstChild.textContent = 'EYE  |ψ(t)|  amplitude';
          }
        }
        ────────────────────────────────────────────────────────────────────── */
      } else if (_localPsi) {
        // CPU fallback (no GPU): bilinear upsample from _localPsi
        const psi   = _localPsi;
        const plate = _localPlate;
        const norm      = 1 / Math.sqrt(Math.max(_smoothMaxField, 1e-18));
        const plateNorm = 1 / Math.sqrt(Math.max(_smoothMaxPlate, 1e-18));
        for (let ry = 0; ry < RH; ry++) {
          const cy0 = _by0[ry], cy1 = _by1[ry];
          const ty1 = _bty1[ry], ty  = _bty[ry];
          for (let rx = 0; rx < RW; rx++) {
            const cx0 = _bx0[rx], cx1 = _bx1[rx];
            const tx1 = _btx1[rx], tx = _btx[rx];
            const j00 = (cy0 * GRID + cx0), j10 = (cy0 * GRID + cx1);
            const j01 = (cy1 * GRID + cx0), j11 = (cy1 * GRID + cx1);
            const w00 = tx1*ty1, w10 = tx*ty1, w01 = tx1*ty, w11 = tx*ty;
            const re = psi[j00*2]*w00 + psi[j10*2]*w10 + psi[j01*2]*w01 + psi[j11*2]*w11;
            const im = psi[j00*2+1]*w00 + psi[j10*2+1]*w10 + psi[j01*2+1]*w01 + psi[j11*2+1]*w11;
            const bi = (ry * RW + rx) * 4;

            const amp = Math.sqrt(re*re + im*im) * norm;
            const lv  = Math.log(1 + LOG_K * amp) * logS;
            const [fr, fg, fb] = colormaps.hologram(lv);
            fieldBuf.data[bi]   = fr; fieldBuf.data[bi+1] = fg;
            fieldBuf.data[bi+2] = fb; fieldBuf.data[bi+3] = 255;

            const [pr, pg, pb] = colormaps.phase(re, im, norm);
            phaseBuf.data[bi]   = pr; phaseBuf.data[bi+1] = pg;
            phaseBuf.data[bi+2] = pb; phaseBuf.data[bi+3] = 255;

            let rv;
            if (dir === 1 && plate) {
              const pl = plate[j00]*w00 + plate[j10]*w10 + plate[j01]*w01 + plate[j11]*w11;
              rv = Math.sqrt(pl) * plateNorm;
            } else {
              rv = amp;
            }
            const rlv  = Math.log(1 + LOG_K * rv) * logS;
            const [rr, rg, rb] = colormaps.hologram(rlv);
            plateBuf.data[bi]   = rr; plateBuf.data[bi+1] = rg;
            plateBuf.data[bi+2] = rb; plateBuf.data[bi+3] = 255;
          }
        }
        fieldCell.ctx.putImageData(fieldBuf, 0, 0);
        phaseCell.ctx.putImageData(phaseBuf, 0, 0);
        plateCell.ctx.putImageData(plateBuf, 0, 0);
      }

      // ── Depth point cloud ─────────────────────────────────────────────────
      {
        const cloud = null; // cloud tomography removed in Deterministic Viewport
        cloudCell.wrap.firstChild.textContent =
          dir === 1 ? 'DEPTH CLOUD  source tiers  live' : 'DEPTH CLOUD  tier tomography  live';
        const cw = cloudCell.canvas.width, ch = cloudCell.canvas.height;
        cloudCell.ctx.fillStyle = '#000';
        cloudCell.ctx.fillRect(0, 0, cw, ch);
        // Tier colors: hue sweep cyan→lime→orange→magenta across N_DEPTH_TIERS
        const TIER_COLORS = Array.from({ length: N_DEPTH_TIERS }, (_, i) => {
          const h = (180 - i * 180 / Math.max(1, N_DEPTH_TIERS - 1)) | 0;
          return `hsl(${h},100%,60%)`;
        });
        const cloudHasCells = cloud?.length === N_DEPTH_TIERS &&
          cloud.some(t => t.cells.length > 0);
        if (cloudHasCells) {
          // 3D perspective projection of stacked depth slabs — draggable view angle.
          // Each tier occupies a Z slice; focal spots are 3D points rotated by
          // _cloudAngleY / _cloudAngleX and projected with simple perspective.
          let gxMin = Infinity, gxMax = -Infinity, gyMin = Infinity, gyMax = -Infinity;
          for (const { cells } of cloud) {
            for (const { x, y } of cells) {
              if (x < gxMin) gxMin = x; if (x > gxMax) gxMax = x;
              if (y < gyMin) gyMin = y; if (y > gyMax) gyMax = y;
            }
          }
          if (!isFinite(gxMin)) { gxMin = 0; gxMax = GRID; gyMin = 0; gyMax = GRID; }
          const gxSpan = Math.max(4, gxMax - gxMin);
          const gySpan = Math.max(4, gyMax - gyMin);
          // Map sub-pixel grid coords → 3D in [-1,+1]³; tier → Z in [-1,+1]
          const toX3 = (gx) => ((gx - gxMin) / gxSpan - 0.5) * 2;
          const toY3 = (gy) => ((gy - gyMin) / gySpan - 0.5) * 2;
          const toZ3 = (d)  => ((d / Math.max(1, N_DEPTH_TIERS - 1)) - 0.5) * 2;

          const cosY = Math.cos(_cloudAngleY), sinY = Math.sin(_cloudAngleY);
          const cosX = Math.cos(_cloudAngleX), sinX = Math.sin(_cloudAngleX);

          // Rotate without translation — find bounding box first, then fit
          const rotateRaw = (x3, y3, z3) => {
            const rx  = cosY * x3 + sinY * z3;
            const rz1 = -sinY * x3 + cosY * z3;
            const ry  = cosX * y3 - sinX * rz1;
            const rz  = sinX * y3 + cosX * rz1;
            return { rx, ry, rz };
          };

          // Sample all 4 corners of every tier slab to find screen extents
          let rxMin = Infinity, rxMax = -Infinity, ryMin = Infinity, ryMax = -Infinity;
          for (let d = 0; d < N_DEPTH_TIERS; d++) {
            const z3 = toZ3(d);
            for (const [cx_, cy_] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
              const { rx, ry } = rotateRaw(cx_, cy_, z3);
              if (rx < rxMin) rxMin = rx; if (rx > rxMax) rxMax = rx;
              if (ry < ryMin) ryMin = ry; if (ry > ryMax) ryMax = ry;
            }
          }
          const pad = 24;  // px padding — enough for 6px label text on all sides
          const SC  = Math.min(
            (cw - 2 * pad) / Math.max(0.01, rxMax - rxMin),
            (ch - 2 * pad) / Math.max(0.01, ryMax - ryMin)
          ) * 0.82;  // 18% safety margin so splat radii don't clip edges
          // Center the rotated volume on canvas
          const cx0 = cw / 2 - ((rxMin + rxMax) / 2) * SC;
          const cy0 = ch / 2 - ((ryMin + ryMax) / 2) * SC;

          const rotate3 = (x3, y3, z3) => {
            const { rx, ry, rz } = rotateRaw(x3, y3, z3);
            return { sx: cx0 + rx * SC, sy: cy0 + ry * SC, rz };
          };

          // Collect all points with depth for painter's sort
          const pts3d = [];
          for (let d = 0; d < N_DEPTH_TIERS; d++) {
            const { cells } = cloud[d];
            const col = TIER_COLORS[d];
            const z3  = toZ3(d);
            for (const { x, y, amp } of cells) {
              const { sx, sy, rz } = rotate3(toX3(x), toY3(y), z3);
              pts3d.push({ sx, sy, rz, amp, col });
            }
          }
          // Far → near painter's sort
          pts3d.sort((a, b) => a.rz - b.rz);

          // Additive Gaussian splatting — light is strictly additive, splats bloom
          // into continuous surfaces where focal spots cluster (Airy disk rendering).
          cloudCell.ctx.globalCompositeOperation = 'lighter';
          cloudCell.ctx.shadowBlur = 0;
          for (const { sx, sy, amp, col } of pts3d) {
            const r = 3 + amp * 7;  // splat radius scales with intensity
            const grad = cloudCell.ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
            grad.addColorStop(0,   col.replace(')', `,${0.6 + amp * 0.4})`).replace('hsl', 'hsla'));
            grad.addColorStop(0.4, col.replace(')', `,${0.2 + amp * 0.2})`).replace('hsl', 'hsla'));
            grad.addColorStop(1,   col.replace(')', ',0)').replace('hsl', 'hsla'));
            cloudCell.ctx.fillStyle = grad;
            cloudCell.ctx.globalAlpha = 1;
            cloudCell.ctx.beginPath();
            cloudCell.ctx.arc(sx, sy, r, 0, Math.PI * 2);
            cloudCell.ctx.fill();
          }
          cloudCell.ctx.globalCompositeOperation = 'source-over';

          // Slab outlines — corners at ±1 in XY plane, each tier's Z
          cloudCell.ctx.shadowBlur = 0;
          for (let d = N_DEPTH_TIERS - 1; d >= 0; d--) {
            const col = TIER_COLORS[d];
            const z3  = toZ3(d);
            const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([cx_, cy_]) => {
              const { sx, sy } = rotate3(cx_, cy_, z3);
              return [sx, sy];
            });
            cloudCell.ctx.globalAlpha = 0.12;
            cloudCell.ctx.strokeStyle = col;
            cloudCell.ctx.lineWidth = 0.8;
            cloudCell.ctx.beginPath();
            cloudCell.ctx.moveTo(corners[3][0], corners[3][1]);
            for (const [px, py] of corners) cloudCell.ctx.lineTo(px, py);
            cloudCell.ctx.stroke();
            cloudCell.ctx.globalAlpha = 0.6;
            cloudCell.ctx.fillStyle = col;
            cloudCell.ctx.font = '6px ui-monospace,monospace';
            const label = d === 0 ? 'near' : d === N_DEPTH_TIERS - 1 ? 'far' : 'mid' + d;
            cloudCell.ctx.fillText('T' + d + ' ' + label, corners[0][0] + 2, corners[0][1] - 2);
          }
          cloudCell.ctx.globalAlpha = 1;
          cloudCell.ctx.shadowBlur  = 0;
        } else if (dir < 0 && (_cplxPlateField || _plateDemodField)) {
          // DEBUG: visualize the actual objField attractor
          const debugField = _cplxPlateField ?? _plateDemodField;
          cloudCell.wrap.firstChild.textContent = _cplxPlateField
            ? 'CPLX ATTRACTOR  ψ_sweep·conj(ψ_ref)  direct'
            : (_localRefReady ? 'DEMOD ATTRACTOR  plate·conj(ψ_ref)' : 'DEMOD ATTRACTOR  plate·exp(−iKx)');
          let maxD = 1e-9;
          for (let j = 0; j < N_CELLS; j++) {
            const v = debugField[j*2]*debugField[j*2] + debugField[j*2+1]*debugField[j*2+1];
            if (v > maxD) maxD = v;
          }
          const imgD = cloudCell.ctx.createImageData(cw, ch);
          for (let py = 0; py < ch; py++) {
            for (let px = 0; px < cw; px++) {
              const gx = Math.min(GRID-1, Math.floor(px * GRID / cw));
              const gy = Math.min(GRID-1, Math.floor(py * GRID / ch));
              const j = gy * GRID + gx;
              const re = debugField[j*2], im = debugField[j*2+1];
              const amp = Math.sqrt((re*re + im*im) / maxD);
              // Show both amplitude (brightness) and phase (hue) — object info may be in phase
              const ph = Math.atan2(im, re); // -π..π
              const hue = ((ph / Math.PI + 1) * 0.5); // 0..1
              const r = (0.5 + 0.5 * Math.cos(2 * Math.PI * hue))       * amp;
              const g = (0.5 + 0.5 * Math.cos(2 * Math.PI * (hue-0.33))) * amp;
              const b = (0.5 + 0.5 * Math.cos(2 * Math.PI * (hue-0.67))) * amp;
              const idx = (py * cw + px) * 4;
              imgD.data[idx]   = r * 255 | 0;
              imgD.data[idx+1] = g * 255 | 0;
              imgD.data[idx+2] = b * 255 | 0;
              imgD.data[idx+3] = 255;
            }
          }
          cloudCell.ctx.putImageData(imgD, 0, 0);
        } else {
          cloudCell.ctx.fillStyle = '#444';
          cloudCell.ctx.font = '7px ui-monospace,monospace';
          const msg = dir === 1 ? 'waiting for IFS cycle…' : 'record first, then reconstruct';
          cloudCell.ctx.fillText(msg, 8, ch / 2);
        }
      }

      // Wireframe
      _drawCube(wireCtx, _localAngleY, _localAngleX, _wireGlow, world.getNodeState('hologram4')?.shape ?? 'cube');

      // Mode indicator (runs every Renkon tick for responsive UI)
      const isRec  = dir === 1;
      plateCell.wrap.firstChild.textContent = isRec
        ? 'IFS HOLOGRAM PLATE  |ψ_obj+ψ_ref|²  native'
        : 'IFS RECON BEAM  |ψ|²  Lévy collapse';
      const ml = document.getElementById(containerId + '-mode');
      if (ml) {
        ml.textContent  = isRec ? '● RECORDING' : '◎ RECONSTRUCTING';
        ml.style.color  = isRec ? '#9c4' : '#4af';
      }
      btnRecord.style.opacity = isRec ? '1' : '0.4';
      btnRecon.style.opacity  = isRec ? '0.4' : '1';
      const TM = n.tomoMode ?? TOMO_MODE;
      btnTomo.textContent    = TM ? '⊕ TOMO  on' : '⊕ TOMO  off';
      btnTomo.style.background = TM ? '#a63' : '#555';
      btnTomo.style.color      = TM ? '#fff' : '#aaa';

      // Sync probe UI from world state (keeps second peer in sync)
      const wProbe   = n.depthProbe;
      const wFrac    = wProbe?.depthFraction ?? 0;
      const wBucket  = wProbe
        ? (TM
            ? Math.min(N_DEPTH_TIERS - 1, Math.floor(wFrac * N_DEPTH_TIERS))
            : Math.floor(wFrac * 20))
        : -1;
      if (!!wProbe !== _probeActive || (wProbe && wBucket !== _probeTierSent)) {
        const pct = wProbe ? Math.round(wFrac * 100) : 0;
        _updateProbeUI(!!wProbe, pct);
        if (wProbe) { probeSlider.value = pct; _probeTierSent = wBucket; }
        else _probeTierSent = -1;
      }
      if (wProbe && _probeActive) {
        if (TM) {
          const tier  = wProbe.tierIdx ?? 0;
          const steps = Math.round(T_RECORD * (tier + 1) / N_DEPTH_TIERS);
          const label = tier === 0 ? 'near' : tier === N_DEPTH_TIERS - 1 ? 'far' : 'mid-' + tier;
          probeLbl.textContent = 'DEPTH  tier' + tier + '  ' + label + '  [' + (isRec ? 'rec' : 'recon@' + steps + 'st') + ']';
        } else {
          const steps = Math.max(1, Math.round(wFrac * T_RECORD));
          probeLbl.textContent = 'DEPTH  ' + Math.round(wFrac * 100) + '%  [' + (isRec ? 'rec' : 'recon@' + steps + 'st') + ']';
        }
      }

      // Title
      const isActive = !!(n.slotActive_A || n.slotActive_B);
      title.style.color = isRec ? '#9c4' : '#4af';
      title.textContent =
        `PEER ${peerId} · HOLOGRAM4  s≈${(n.ifsSEff ?? 0).toFixed(3)}  ` +
        (n.slotActive_A ? '[A]' : '') + (n.slotActive_B ? '[B]' : '');

      // Stats
      const el = document.getElementById(containerId + '-stats');
      if (el) el.innerHTML =
        `t=${(n.time ?? 0).toFixed(1)}  cyc=${n.cycleCount ?? 0}` +
        `  R=[${n.ifsRadiiStr ?? ''}]  ${_clientBadge(world)}`;

      // IFS clock
      const energyA = n.slotEnergy_A ?? [], energyB = n.slotEnergy_B ?? [];
      const mergedEnergy = energyA.map((v, i) => Math.max(v, energyB[i] ?? 0));
      const mergedEvents = [...(n.slotEvents_A ?? []), ...(n.slotEvents_B ?? [])]
        .sort((a, b) => a.wt - b.wt).slice(-80);
      ifsClock.update({ energy: mergedEnergy, events: mergedEvents, isActive, lt });

      _renderAvatars(world, root);
    };

    // RAF loop — throttled to ~30 fps to keep main thread free for input events
    let _rafId = null, _lastRenderMs = 0;
    const RENDER_INTERVAL_MS = 33;  // ~30 fps
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
  title:       'Hologram4 | IFS-Native Real-Time Wavefront (GPU)',
  selo:        'hologram4',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [hologram4WorldProgram + av],
  makeRenderer: makeHologram4Renderer,
  wrapId:      'hologram4-wrap',
  hideTopBar:  true,
};
