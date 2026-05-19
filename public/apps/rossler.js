/*
The MIT License (MIT)
Copyright (c) 2026 Nikolay Suslov and the Krestianstvo.org project contributors
*/
import { makeIfsClock } from "../krestianstvo-wavefront-evaluator.js";

const REFLECTOR_MS = 50;
const SUBTICK_MS   = 1;

const rosslerWorldProgram = makeIfsClock({
  depth:     5,
  baseDelay: 2.1415926535,
  minDelay:  0.1,
  cycle:     8,
  decay:     0.1,
  maps:      [0.4142135623, 0.6180339887, 0.7320508075],
  genCap:    6,
  onCycle: `(cycleCount, p, W) => {
    const r1 = W.rng.next(), r2 = W.rng.next(), r3 = W.rng.next();
    return { rx: (r1 - 0.5) * 4, ry: (r2 - 0.5) * 4, rz: r3 * 2 };
  }`,
  onBeat: `(p, ctx, W) => {
    const { delay, rx = 0.1, ry = 0, rz = 0.1 } = p;
    const A = 0.2, B = 0.2, C = 5.7, SCALE = 0.5, STEPS = 8;
    const dt = delay * SCALE / STEPS;
    const f = (x, y, z) => [-y - z, x + A * y, B + z * (x - C)];
    let nx = rx, ny = ry, nz = rz;
    for (let _s = 0; _s < STEPS; _s++) {
      const [k1x,k1y,k1z] = f(nx, ny, nz);
      const [k2x,k2y,k2z] = f(nx+k1x*dt/2, ny+k1y*dt/2, nz+k1z*dt/2);
      const [k3x,k3y,k3z] = f(nx+k2x*dt/2, ny+k2y*dt/2, nz+k2z*dt/2);
      const [k4x,k4y,k4z] = f(nx+k3x*dt,   ny+k3y*dt,   nz+k3z*dt);
      nx += (k1x+2*k2x+2*k3x+k4x)*dt/6;
      ny += (k1y+2*k2y+2*k3y+k4y)*dt/6;
      nz += (k1z+2*k2z+2*k3z+k4z)*dt/6;
      if (!isFinite(nx)||!isFinite(ny)||!isFinite(nz)) { nx=rx; ny=ry; nz=rz; break; }
    }
    return { rx: nx, ry: ny, rz: nz };
  }`,
}) + `
  const _wtFloor  = Math.floor(reflector.wallTime ?? 0);
  const _isStable = (fractal._nextAt ?? Infinity) >= _wtFloor + 1 && W.stable([fractal], reflector);
  const _export   = W.export(Renkon, { fractal }, _isStable);
`;

function makeRosslerRenderer(core) {
  const DEPTH_COLORS = ['#E34A27', '#FEA655', '#FFD98E', '#566357', '#909473'];

  return (world, peerId, containerId) => {
    const _rosslerPoints = [];

    if (!document.getElementById('fractal-wrap')) {
      const wrap = document.createElement('div'); wrap.id = 'fractal-wrap';
      Object.assign(wrap.style, { display:'flex', gap:'0', flexWrap:'wrap' });
      document.body.appendChild(wrap);
    }
    const root = document.createElement('div');
    root.id = containerId;
    Object.assign(root.style, {
      fontFamily: 'ui-monospace,monospace', padding: '20px',
      background: '#0d0d0d', color: '#eee', borderRadius: '10px',
      margin: '10px', flex: '1', minWidth: '300px', border: '1px solid #222',
    });
    document.getElementById('fractal-wrap').appendChild(root);

    const title = document.createElement('div');
    title.textContent = `PEER ${peerId} · RÖSSLER ATTRACTOR  (IFS clock)`;
    Object.assign(title.style, { fontSize:'11px', fontWeight:'bold', color:'#444',
      marginBottom:'12px', letterSpacing:'1px', textAlign:'center' });
    root.appendChild(title);

    const lbl = document.createElement('div');
    lbl.textContent = 'RÖSSLER  a=0.2  b=0.2  c=5.7    x=X · y=Y · color=depth';
    Object.assign(lbl.style, { fontSize:'9px', color:'#333', marginBottom:'3px', letterSpacing:'0.5px' });
    root.appendChild(lbl);

    const cv = document.createElement('canvas');
    cv.id = containerId + '-cv'; cv.width = 700; cv.height = 700;
    Object.assign(cv.style, { width:'100%', borderRadius:'4px', background:'#00000f', display:'block' });
    root.appendChild(cv);

    return () => {
      const f = world.getNodeState('fractal');
      if (!f) return;

      for (const { d, rx, ry } of (f.tickEvents ?? [])) {
        if (rx !== undefined && ry !== undefined && isFinite(rx) && isFinite(ry)
            && rx > -12 && rx < 14 && ry > -13 && ry < 11) {
          _rosslerPoints.push({ rx, ry, col: DEPTH_COLORS[d] ?? '#888' });
        }
      }

      if (_rosslerPoints.length === 0) return;

      const CW = cv.width, CH = cv.height, PAD = 14;
      const AW = CW - PAD*2, AH = CH - PAD*2;
      const X0 = -11, X1 = 13, Y0 = -12, Y1 = 10;
      const toX = rx => PAD + ((rx - X0) / (X1 - X0)) * AW;
      const toY = ry => PAD + AH - ((ry - Y0) / (Y1 - Y0)) * AH;
      const ac = cv.getContext('2d');

      if (cv._drawn === undefined) {
        ac.clearRect(0, 0, CW, CH);
        ac.fillStyle = '#888'; ac.font = '7px ui-monospace'; ac.textAlign = 'center';
        ac.fillText('X', CW/2, CH - 2);
        ac.save(); ac.translate(8, CH/2); ac.rotate(-Math.PI/2);
        ac.fillText('Y', 0, 0); ac.restore();
        cv._drawn = 0;
      }

      const from = cv._drawn;
      for (let i = from; i < _rosslerPoints.length; i++) {
        const { rx, ry, col } = _rosslerPoints[i];
        const px = toX(rx), py = toY(ry);
        ac.fillStyle = col;
        ac.globalAlpha = 0.08; ac.beginPath(); ac.arc(px, py, 3, 0, Math.PI*2); ac.fill();
        ac.globalAlpha = 0.85; ac.beginPath(); ac.arc(px, py, 0.8, 0, Math.PI*2); ac.fill();
      }
      cv._drawn = _rosslerPoints.length;
      ac.globalAlpha = 1;
    };
  };
}

export default {
  title:       'Rössler Attractor | IFS Clock',
  selo:        'rossler',
  reflectorMs: REFLECTOR_MS,
  metaOptions: { _subtickMs: SUBTICK_MS },
  makeScripts: (av) => [rosslerWorldProgram + av],
  makeRenderer: makeRosslerRenderer,
  wrapId:      'fractal-wrap',
};
