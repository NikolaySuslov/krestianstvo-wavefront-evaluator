// STREAMING CONTRACTION NODE — the IFS-clock's successor: emits the trajectory AND a certified endpoint.
// Run: node public/streaming-contraction.test.mjs
//
// The correction to "a convergence gate fires once and erases the stream": the intermediate iterates ALWAYS
// EXIST (computed per step, in node state) — whether they are EMITTED is a per-node choice, orthogonal to the
// gate. makeContractionNode emits only the endpoint (the pipeline app's use — the arrival is the product).
// makeStreamingContractionNode emits a BEAT PER STEP (the trajectory is the product, like the IFS clock) AND
// fires the certified futureContract endpoint. So it is STRICTLY RICHER than the IFS clock: the fractal beat
// texture PLUS a Banach convergence certificate (which the IFS clock lacks — it stops at minDelay, no 'done').
//
// PROVE against the REAL W.reduce: (1) it emits a beat PER STEP (the stream = the trajectory, length = steps);
// (2) it ALSO fires the certified endpoint (arrived ≤ bound); (3) the emitted stream is the actual iterate
// trajectory (each beat carries the true S at that step); (4) join-safe (byte-identical stream + endpoint);
// (5) contrast: the plain contraction node has the SAME trajectory in state but emits NO stream (proving the
// values exist either way — emission is the only difference).

import { W, makeStreamingContractionNode, makeContractionNode, makeHutchinson, seedRing } from './krestianstvo-wavefront-evaluator.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

const mkH = (rhos, r0 = 12) => makeHutchinson({ dim: 1, dedupEps: 1e-3, maps: rhos.map(r => ({ A: [r], t: [(1 - r) * r0 * 0.7], rho: r })) });
const drive = (handlers, id, N) => { let s = {}; for (let k = 1; k <= N; k++) s = W.reduce(s, { wallTime: k, logicalTime: k, _appRef: { _currentEvalGen: 0 } }, id, handlers); return s; };

const RHOS = [0.5, 0.68], TOL = 4e-3, R0 = 12;
// emit the full radius set per step → the beat IS the iterate (so we can check the stream == trajectory)
const EMIT = (S, k) => ({ k, S: Array.from(S) });

// ── (1) EMITS A BEAT PER STEP: the stream length equals the number of contraction steps taken (+1 for seed). ─
{
  const H = mkH(RHOS); const bound = H.bound(seedRing(R0), TOL);
  const node = makeStreamingContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound, emit: EMIT });
  const s = drive(node, "sc", bound + 10);
  ok('emits a beat PER STEP (the trajectory IS the product, IFS-clock-like)',
     s.beats.length === s.arrivedAt + 1,   // seed beat (k=0) + one per step up to arrival
     `${s.beats.length} beats for ${s.arrivedAt} steps (+1 seed) · beats k=[${s.beats.map(b => b.k).join(',')}]`);
}

// ── (2) ALSO fires the CERTIFIED endpoint (arrived ≤ bound) — the stream AND the Banach certificate together. ─
{
  const H = mkH(RHOS); const bound = H.bound(seedRing(R0), TOL);
  const node = makeStreamingContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound, emit: EMIT });
  const s = drive(node, "sc", bound + 10);
  ok('ALSO fires the certified endpoint (stream + Banach certificate)', s.arrived === true && s.arrivedAt <= bound,
     `arrived@${s.arrivedAt} ≤ bound ${bound}, with a ${s.beats.length}-beat stream`);
}

// ── (3) THE STREAM IS THE ACTUAL TRAJECTORY: each emitted beat carries the true iterate S at that step (so a
//     downstream consumer sees the real fractal-like descent, not just a count). ─────────────────────────────
{
  const H = mkH(RHOS); const bound = H.bound(seedRing(R0), TOL);
  const node = makeStreamingContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound, emit: EMIT });
  const s = drive(node, "sc", bound + 10);
  // replay the trajectory independently and compare to the emitted stream
  let S = seedRing(R0); let matches = JSON.stringify(Array.from(S)) === JSON.stringify(s.beats[0].S);
  for (let k = 1; k < s.beats.length; k++) { S = H.step(S); if (JSON.stringify(Array.from(S)) !== JSON.stringify(s.beats[k].S)) matches = false; }
  ok('the emitted stream IS the real iterate trajectory (usable downstream)', matches,
     `${s.beats.length} beats replay the exact W-step descent`);
}

// ── (4) JOIN-SAFE: two peers → byte-identical stream AND endpoint. ─────────────────────────────────────────
{
  const mk = () => { const H = mkH(RHOS); return makeStreamingContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound: H.bound(seedRing(R0), TOL), emit: EMIT }); };
  const a = drive(mk(), "sc", 60), b = drive(mk(), "sc", 60);
  const h = (s) => JSON.stringify({ beats: s.beats, at: s.arrivedAt });
  ok('streaming node byte-identical across peers (stream + endpoint join-safe)', h(a) === h(b), `${a.beats.length} beats, arrived@${a.arrivedAt}`);
}

// ── (5) THE CONTRAST (the correction, made explicit): the PLAIN contraction node computes the SAME trajectory
//     in state (S advances each step) but emits NO stream (no beats array). The intermediate values EXIST
//     either way — emission is the ONLY difference. Same fixpoint, same steps, stream vs no-stream. ──────────
{
  const H = mkH(RHOS); const bound = H.bound(seedRing(R0), TOL);
  const plain = makeContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound });
  const strm  = makeStreamingContractionNode({ step: S => H.step(S), residual: S => H.hausdorff(S, H.step(S)), seed: seedRing(R0), tol: TOL, bound, emit: EMIT });
  const sp = drive(plain, "p", bound + 10), ss = drive(strm, "s", bound + 10);
  const sameFixpoint = JSON.stringify(Array.from(sp.S)) === JSON.stringify(Array.from(ss.S)) && sp.arrivedAt === ss.arrivedAt;
  const streamDiffers = (sp.beats === undefined) && (ss.beats.length > 0);
  ok('plain vs streaming: SAME trajectory+fixpoint, emission is the only difference', sameFixpoint && streamDiffers,
     `both arrive@${sp.arrivedAt} at the same S · plain emits no stream, streaming emits ${ss.beats.length} beats`);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}  ${pass} passed, ${fail} failed`);
console.log('\nMEANING: the intermediate iterates ALWAYS exist (in state); EMITTING them is a per-node choice,');
console.log('orthogonal to the futureContract gate. A streaming contraction node emits the trajectory (the beat');
console.log('stream, like the IFS clock) AND fires the certified endpoint (bound()) — strictly richer than the');
console.log('IFS clock, which has the stream but no "done". Geometric scheduling ADDS the certificate; it never');
console.log('had to discard the stream. The synthesis: fractal beats + Banach certificate, join-safe.');
process.exit(fail === 0 ? 0 : 1);
