// ahc-scan-worklet.js — the AHC medium as sound (v4, 2026-09-26). Fed ONLY by measured properties of the medium, timed by the
//   MEDIUM'S OWN CLOCK, and written as a PURE FUNCTION OF VIRTUAL TIME: s(vt) = F(vt, replicated settings, bit-identical frames).
//
//   SAMPLE-EXACT, STATED PRECISELY. Every peer computes the same waveform as a function of the medium's virtual time vt (ticks):
//     · the settings (f0, gain, lens R, holo leg) carry the register tick of their change (`at`) and apply for vt ≥ at;
//     · the control data are frames stamped with the vt they measure — per SUB-STEP band frames from the GPU (bit-identical between
//       same-GPU peers) and per-beat look frames — interpolated at the sample's own vt, never on arrival;
//     · every oscillator phase is CLOSED FORM in vt (no phase accumulated from the moment this worklet started);
//     · each band's PHASE INTEGRAL (its measured frequency offset + phase diffusion, ∫ over the medium's whole life) is NOT integrated
//       here: it is derived STATE, integrated on the main thread once per GPU sub-step from the bit-identical band frames with
//       counter-hashed increments — the same numbers on every peer — and shipped to a joiner in the snapshot (like descSeed). Frames
//       carry it (phi); between two sub-steps this worklet adds the fine structure as a Brownian BRIDGE on a fixed virtual grid (GR
//       points per tick), hashed by (frame key, band, grid index) — pure and local, so any peer evaluates the same value at any vt.
//   What stays peer-local is only WHEN a given vt reaches the speaker (the audio device clock and output latency) — the worklet
//   servoes its vt to the anchored presentation clock, so peers play the same waveform, offset by their clock-sync error.
//   Conditions: frames for vt must be present when vt is played (the presentation runs one tick behind the newest measurement).
//
//   TIME LENS R (replicated). The medium's temporal frequencies are slow (carrier ≤ 1.2 Hz, offsets ≤ 1 Hz, linewidths 2–5 Hz).
//   R multiplies the STATIONARY ones — the carrier phase θ (a frequency multiplier: θ → R·θ), each band's offset and linewidth —
//   uniformly, so their relations are kept. MEASURED TRAJECTORIES (the sub-tick band energies) play in real time: a live signal
//   cannot be time-compressed. R = 1 is the medium as it is.
//
//   "add" — partial h = band h of the voiced slot's field (|q+k| of the display tilt), amplitude √(E_h/ΣE) from the SUB-STEP band
//     probe (160/s — the turbulence's own flicker), carrier = the slot's Kuramoto phase θ(vt), plus the band's phase integral Φ_h
//     (its measured offset and a phase diffusion whose one-beat decorrelation equals the measured coherence). Companions (coupled slots) sound their first partials at
//     THEIR θ. Cascade beats add accents.
//   "holo" — the HOLOGRAPHIC dispersion synth, legato: the ADD voice passed through the medium's own operator λ(k)^T. Partial h is
//     evaluated at its retarded time vt − τ_h and shifted by leg·R·T·Ω_h (Ω_h = the operator's per-step phase in band h, R the lens,
//     τ_h = −dφ/dω the group delay that phase implies), so every event of the medium arrives as a chirp across the partials. leg +1:
//     the plate (+T, events smear into the medium's chirp); 0: the recall (+T then −T — identical to add: the chirp refocuses); −1: the
//     conjugate leg (the chirp runs the other way). T is stamped with the register tick of its change. At R = 1 the medium's dispersion
//     spans ~10 ms at f0 = 110 Hz; the lens stretches it into an audible chirp.
//   comb M (replicated) — SOURCE–FILTER: a harmonic comb at f0/M (the instrument) under the measured shell spectrum as envelope (the medium).
//   "scan" — band-limited scanned synthesis of the picture (not vt-pure: it follows the canvas as painted).
const H = 64, HC = 6, NC = 3, REFN = 8;          // max partials (= the lattice's |k| shells to π at G 128; a frame carries its own count) · companion partials · max companions
const GR = 2400;                        // virtual grid points per tick (the bridge's resolution — 48 kHz at a 50 ms tick)
const GRC = 32;                         // control points every GRC grid points (1.5 kHz at a 50 ms tick) — see sampleAt
const STALE = 2;                        // ticks after its newest band frame at which a slot's spectrum counts as no longer measured
const ANCH_WIN = 3, ANCH_TC = 4, ANCH_MAX = 0.002;   // the clock fit: anchors of the last ANCH_WIN s · phase error corrected over ANCH_TC s · at most ±ANCH_MAX (0.2% = 3.5 cents)
const LG = 0.12;                        // holo grain length (s)
const TAU = 2 * Math.PI;
//   counter-based hash → uniform [0,1): the same (epoch, band, grid index) gives the same number on every peer
const hash01 = (a, b, c) => { let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x632BE5AB, 0x85EBCA77) ^ Math.imul((c | 0) + 0x5BD1E995, 0xC2B2AE3D)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846CA68B) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296; };
//   frames sorted by vt: index of the last frame with vt ≤ x (−1 if none)
const floorIdx = (q, x, hint = -1) => { if (hint >= 0 && hint < q.length && q[hint].vt <= x) { if (hint + 1 >= q.length || q[hint + 1].vt > x) return hint; if (hint + 2 >= q.length || q[hint + 2].vt > x) return hint + 1; }   // a search hint (the caller's last index): O(1) when time moves on by a little — never changes the answer
  let lo = 0, hi = q.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (q[m].vt <= x) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
//   THE IFS PITCH LATTICE — the multiplicative set the cascade's contraction ratios generate: products of up to LAT_D inverse maps
//   (1/0.309 … 1/0.732). Ring radii are delays = base · Π maps, so the operator's spatial scales sit on this lattice. Sorted, unique.
const LAT_D = 5;
const latticeOf = (maps) => { const inv = maps.map((m) => 1 / m); let set = [1];
  for (let d = 0; d < LAT_D; d++) { const nx = []; for (const a of set) for (const b of inv) nx.push(a * b); set = set.concat(nx); }
  const u = []; for (const v of set.sort((a, b) => a - b)) if (!u.length || v / u[u.length - 1] > 1 + 1e-6) u.push(v); return u; };
class AhcScan extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "add";
    this.cur = new Float32Array(256); this.nxt = new Float32Array(256); this.mix = 1; this.dmix = 0; this.ph = 0; this.loudScan = 0; this.gainScan = 0;
    this.sets = [{ at: -1e9, f0: 110, gain: 0, lens: 1, leg: 1, mode: "add", ref: 0, tilt: 0, comb: 1 }];   // settings history (by register tick)
    this.frames = [];                 // per-beat LOOK frames {vt, loud, panL, width, panB} (+ fallback amp/fOff/bw on the CPU path)
    this.sub = new Map();             // slot → per-sub-step band frames {vt, key, amp[H], phi[H] (the phase integral), bw[H] (Hz, lens applied)}
    this.holo = new Map();            // cycle n → {om[H]} (the operator's per-step phase per band)
    this.holoT = [{ at: -1e9, T: 350 }];   // ±T depth history, stamped with the register tick of each change
    this.clock = null; this.anchor = null; this.vt = null; this.tickSec = 0.05;
    this.bridges = new Map();         // frame key → Float32Array((n+1)·H) Brownian bridge (a pure fn of key, bw, n)
    this.hcache = new Map();          // holo: per (cycle, leg, f0, T) the partial phases/delays (a pure fn of those)
    this.port.onmessage = (e) => { const d = e.data || {};
      if (d.mode === "add" || d.mode === "scan" || d.mode === "holo") this.mode = d.mode;
      if (d.settings) { const s = { ...this.sets[this.sets.length - 1], ...d.settings }; const q = this.sets; while (q.length > 1 && q[q.length - 1].at >= s.at) q.pop(); q.push(s); if (q.length > 16) q.splice(0, q.length - 16); }
      if (Number.isFinite(d.gain)) this.gainScan = d.gain;
      if (d.table) { const L = d.table.length, from = new Float32Array(L), a = this.cur, b = this.nxt, m = this.mix;
        for (let i = 0; i < L; i++) { const ai = a.length === L ? a[i] : 0, bi = b.length === L ? b[i] : 0; from[i] = ai + (bi - ai) * m; }
        this.cur = from; this.nxt = Float32Array.from(d.table); this.mix = 0; this.dmix = 1 / Math.max(1, (d.xfade || 0.02) * sampleRate); }
      if (Number.isFinite(d.loud)) { this.loudScan = Math.max(0, Math.min(1, d.loud)); if (d.loud === 0) { this.frames = []; this.sub.clear(); } }
      if (d.anchor) { this.anchor = d.anchor; this.tickSec = d.anchor.tickSec || this.tickSec;
        //   keep the last ANCH_WIN seconds of anchors for the clock fit (see process); a tempo change restarts the fit
        const q = this.anchors || (this.anchors = []); if (q.length && q[q.length - 1].tickSec !== d.anchor.tickSec) q.length = 0;
        q.push(d.anchor); while (q.length > 2 && q[q.length - 1].at - q[0].at > ANCH_WIN) q.shift(); }
      if (d.clock) { this.clock = d.clock;   // + each slot's ANCHOR HISTORY: ∠ evaluated exactly at every replicated anchor (see thetaAt)
        const Hh = this.thHist || (this.thHist = new Map());
        for (const s of (d.clock.slots || [])) { if (!s || !Number.isFinite(s.anchorK)) continue; let q = Hh.get(s.i); if (!q) { q = []; Hh.set(s.i, q); }
          while (q.length && q[q.length - 1].k >= s.anchorK) q.pop(); q.push({ k: s.anchorK, th: this.theta(s, s.anchorK), s }); if (q.length > 64) q.splice(0, q.length - 64); } }
      if (Array.isArray(d.maps)) { this.maps = d.maps; this.lattice = null; this.prCache = null; }
      if (d.holoT) { const q = this.holoT; while (q.length > 1 && q[q.length - 1].at >= d.holoT.at) q.pop(); q.push(d.holoT); if (q.length > 16) q.splice(0, q.length - 16); }
      if (d.holo && Number.isFinite(d.holo.n)) { this.holo.set(d.holo.n | 0, d.holo); if (this.holo.size > 8) this.holo.delete(this.holo.keys().next().value); }
      if (d.frame) { const f = d.frame, q = this.frames; while (q.length && q[q.length - 1].vt >= f.vt) q.pop(); q.push(f); if (q.length > 64) q.splice(0, q.length - 64); }
      if (d.sub) for (const f of d.sub) { let q = this.sub.get(f.slot); if (!q) { q = []; this.sub.set(f.slot, q); }
        while (q.length && q[q.length - 1].vt >= f.vt) q.pop(); q.push(f); if (q.length > 4000) q.splice(0, q.length - 4000); } };
  }
  //   least-squares line vt ≈ a + b·(t − t0) through the recent anchors (null with fewer than 4, or a degenerate span)
  anchorFit() { const q = this.anchors; if (!q || q.length < 4) return null; const t0 = q[q.length - 1].at; let st = 0, sv = 0, stt = 0, stv = 0;
    for (const x of q) { const t = x.at - t0; st += t; sv += x.vt; stt += t * t; stv += t * x.vt; }
    const n = q.length, den = n * stt - st * st; if (!(den > 1e-9)) return null; const b = (n * stv - st * sv) / den; if (!(b > 0)) return null;
    return { t0, a: (sv - b * st) / n, b }; }
  setAt(vt) { const q = this.sets; let s = q[0]; for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= vt) { s = q[i]; break; } return s; }
  //   gain at vt: the settings' gain, ramped over 30 ms after its change (closed form — no smoothing state)
  gainAt(vt) { const q = this.sets; let i = q.length - 1; while (i > 0 && q[i].at > vt) i--; const s = q[i], p = i > 0 ? q[i - 1] : s;
    const u = Math.max(0, Math.min(1, (vt - s.at) * this.tickSec / 0.03)); return (p.gain ?? 0) + ((s.gain ?? 0) - (p.gain ?? 0)) * u; }
  //   linear interpolation of a frame list at vt (held at the ends); `i` = the index found (a hint for the next lookup)
  lerpAt(q, vt, hint = -1) { if (!q || !q.length) return null; const i = floorIdx(q, vt, hint); if (i < 0) return { a: q[0], b: q[0], w: 0, i: 0 };
    if (i >= q.length - 1) return { a: q[q.length - 1], b: q[q.length - 1], w: 0, i }; const a = q[i], b = q[i + 1]; return { a, b, w: (vt - a.vt) / Math.max(1e-9, b.vt - a.vt), i }; }
  //   the medium's clock in closed form (_ahcClockAt): the Kuramoto phase θ = ∠(vt) + lock, and the cascade age
  //   (phase, phaseBeat) is ONE generation — ∠ and the register beat it belongs to (regBeat alone ran a beat ahead of ∠ on every advance:
  //   a ±ω jump at each hand-over); a stopped slot holds its ∠. Used where no measured carrier exists (companions, register-only slots).
  theta(s, vt) { const back = (s.anchorK || 0) - vt, tau = (s.tau || 0) - (s.dtau || 0) * back; return (s.phase || 0) + (s.running === false ? 0 : (s.omega || 0)) * (tau - (s.phaseBeat ?? s.regBeat ?? Math.floor(s.tau || 0))) + (s.lock || 0); }
  //   ∠ of slot s at vt BETWEEN ITS ANCHORS. Each clock message is exact at its own anchor tick; extrapolated past it, the next message
  //   disagreed by ω·(the τ extrapolation error) — up to 0.064 rad at ω 0.3, a phase step on every partial at each hand-over. So ∠ is
  //   INTERPOLATED between the two replicated anchors around vt (shortest arc) — exact at every anchor, continuous between — and the
  //   closed form is used only past the newest anchor (the audio runs behind the clock, so rarely), where it continues from that anchor.
  thetaAt(s, vt) { const q = this.thHist && this.thHist.get(s.i); if (!q || !q.length) return this.theta(s, vt);
    if (vt >= q[q.length - 1].k) return this.theta(q[q.length - 1].s, vt); if (vt <= q[0].k) return this.theta(q[0].s, vt);
    let lo = 0, hi = q.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (q[m].k <= vt) lo = m; else hi = m; }
    const a = q[lo], b = q[hi], d = b.th - a.th; return a.th + Math.atan2(Math.sin(d), Math.cos(d)) * (vt - a.k) / (b.k - a.k); }
  //   the MEASURED carrier of `slot` at vt: the ∠ each sub-step injected (frame.car), shortest arc between sub-steps — the angle the band
  //   phases were demodulated by, so Φ + R·car = R·Σ arg C (the field's own path). null where the frames carry none (model path, stream start).
  carAt(slot, vt) { const q = this.sub.get(slot); if (!q || !q.length) return null; const F = this.lerpAt(q, vt); const a = F.a.car; if (a === undefined) return null;
    const b = F.b.car ?? a; return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * F.w; }
  age(s, vt) { return (s.age || 0) - (s.dage || 0) * ((s.anchorK || 0) - vt); }
  vtOfAge(s, a) { return (s.anchorK || 0) - ((s.age || 0) - a) / Math.max(1e-9, s.dage || 1); }
  //   the bridge between frames A and B (grid points m_A … m_B): B(j) − (j/n)·B(n), B a hashed random walk with A's per-band step size
  bridgeOf(A, n) { if (A.zbw === undefined) A.zbw = !(A.bw && A.bw.some((x) => x > 0)); if (A.zbw) return null;   // the medium's path carries no model linewidth
    const key = A.key + ":" + n; let br = this.bridges.get(key); if (br) return br;
    const dtg = this.tickSec / GR, L = (A.phi || []).length; br = new Float32Array((n + 1) * L); br.L = L;
    for (let h = 0; h < L; h++) { const sg = Math.sqrt(TAU * Math.max(0, Math.min(40, (A.bw && A.bw[h]) || 0)) * dtg) * Math.sqrt(3); if (!sg) continue; let w = 0;
      for (let j = 1; j <= n; j++) { w += sg * (2 * hash01(A.key | 0, h, j) - 1); br[j * L + h] = w; }
      const end = br[n * L + h]; for (let j = 1; j <= n; j++) br[j * L + h] -= (j / n) * end; }
    this.bridges.set(key, br); if (this.bridges.size > 16) this.bridges.delete(this.bridges.keys().next().value); return br; }
  //   Φ of band h of `slot` at vt: the frames' integral, linear between sub-steps, plus the bridge (hint = the last frame index)
  phiAt1(slot, vt, h, hint = -1) { const q = this.sub.get(slot); if (!q || !q.length) return 0; const i = floorIdx(q, vt, hint);
    if (i < 0) return (q[0].phi && q[0].phi[h]) || 0; const A = q[i], B = q[i + 1]; if (!A.phi) return 0; const pa = A.phi[h] || 0; if (!B || !B.phi) return pa;
    const mA = Math.round(A.vt * GR), mB = Math.round(B.vt * GR), n = mB - mA; if (n <= 0 || n > 8 * GR) return pa;
    const x = vt * GR - mA, j = Math.max(0, Math.min(n - 1, Math.floor(x))), fr = Math.max(0, Math.min(1, x - j)), u = Math.max(0, Math.min(1, x / n)), br = this.bridgeOf(A, n);
    const base = pa + ((B.phi[h] || 0) - pa) * u; if (!br) return base; const Lb = br.L;
    return base + br[j * Lb + h] + (br[(j + 1) * Lb + h] - br[j * Lb + h]) * fr; }
  //   the cascade beats around a block, as virtual times: [{vg, cyc, t, mult}] — exact values, whatever the block boundaries
  beatsNear(S, vtA, vtB) { const C = this.clock, out = []; if (!S || !C || !C.beats || !C.period) return out;
    const n0 = Math.floor(this.age(S, vtA) / C.period), n1 = Math.floor(this.age(S, vtB) / C.period);
    for (let cyc = n0 - 2; cyc <= n1; cyc++) { const bt = C.beats[cyc]; if (!bt) continue; const T = Array.isArray(bt) ? bt : (bt.t || []), Rr = Array.isArray(bt) ? null : bt.r;
      const seen = new Map(); for (let i = 0; i < T.length; i++) { const key = T[i] + "|" + (Rr ? Rr[i] : 0); const e = seen.get(key); if (e) e.mult++; else seen.set(key, { t: T[i], r: Rr ? Rr[i] : 0, mult: 1 }); }
      for (const e of seen.values()) { const vg = this.vtOfAge(S, cyc * C.period + e.t); if (vg <= vtB) out.push({ vg, cyc, t: e.t, mult: e.mult, r: e.r }); } }
    out.sort((a, b) => a.vg - b.vg); return out; }
  //   holo: partial phases and group delays of one cycle's operator (memoized: a pure fn of cycle, leg, f0, T, pitch axis) — the delay is
  //   −dφ/dω on the slot's own pitch axis (fr: its frequency ratios; harmonic spacing when absent)
  holoOf(cyc, leg, f0, R, T, fr = null, pm = "harmonic") { const ho = this.holo.get(cyc); if (!ho) return null; const key = cyc + ":" + leg + ":" + f0 + ":" + R + ":" + T + ":" + pm; let c = this.hcache.get(key);
    if (!c) { const hn = Math.min(H, ho.om.length), phi = new Float64Array(hn), del = new Float64Array(hn); let dmin = Infinity;
      for (let h = 0; h < hn; h++) phi[h] = leg * R * T * (ho.om[h] || 0);   // the lens multiplies the operator's temporal phase too
      for (let h = 0; h < hn; h++) { const hp = Math.min(hn - 1, h + 1), hm = Math.max(0, h - 1); del[h] = -(phi[hp] - phi[hm]) / (TAU * (fr ? Math.max(1e-6, f0 * (fr[hp] - fr[hm])) : f0 * Math.max(1, hp - hm))); if (del[h] < dmin) dmin = del[h]; }
      for (let h = 0; h < hn; h++) del[h] -= dmin;
      c = { phi, del }; this.hcache.set(key, c); if (this.hcache.size > 32) this.hcache.delete(this.hcache.keys().next().value); }
    return c; }
  //   PITCH AXIS per slot (replicated): "harmonic" — shell n at (n+1)·f0 (the spectrometer's linear axis); "ifs" — the same place,
  //   SNAPPED to the nearest lattice ratio (IFS intonation: the span kept, every pitch one the cascade's ratios can form); "lattice" —
  //   shell n at the n-th lattice ratio (the IFS SCALE: the spectrum folded into the lattice's own inharmonic, self-similar set).
  pitchRatios(mode, n) { const key = mode + ":" + n; this.prCache ??= new Map(); let r = this.prCache.get(key); if (r) return r;
    const L = this.lattice || (this.lattice = latticeOf(this.maps || [0.3090169944, 0.4142135623, 0.5, 0.6180339887, 0.7071067812, 0.7320508075]));
    r = new Float64Array(n);
    //   "k" — shell n at n·f0: frequency PROPORTIONAL to |k| (the harmonic axis without its +1 offset; DC = 0 Hz, not voiced). A periodic
    //   object's Bragg orders m·k_g then sound as a true harmonic series (the grid's, at shells 3, 6, 9 … → 3, 6, 9 × f0).
    for (let h = 0; h < n; h++) { if (mode === "k") r[h] = h; else if (mode === "lattice") r[h] = L[Math.min(L.length - 1, h)];
      else if (mode === "ifs") { const x = h + 1; let lo = 0, hi = L.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (L[m] < x) lo = m + 1; else hi = m; }
        const a = L[Math.max(0, lo - 1)], b = L[lo]; r[h] = (Math.abs(Math.log(x / a)) <= Math.abs(Math.log(b / x))) ? a : b; }
      else r[h] = h + 1; }
    this.prCache.set(key, r); return r; }
  pitchOf(st, slot) { const P = st.pitch; const m = Array.isArray(P) ? P[slot] : P; return (m === "ifs" || m === "lattice" || m === "k") ? m : "harmonic"; }
  //   GLIDE: the slot's glide phase G(vt) (ticks) from its band frames — the ∫(g − 1) of the register-angle detune (see the main thread);
  //   a partial of frequency f then advances 2π·f·tickSec·(vt + G)
  glAt(slot, vt) { const q = this.sub.get(slot); if (!q || !q.length) return 0; const F = this.lerpAt(q, vt); const a = F.a.gl || 0, b = F.b.gl ?? a; return a + (b - a) * F.w; }
  tAt(vt) { const q = this.holoT; for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= vt) return q[i].T; return q[0].T; }
  //   FRACTAL RHYTHM — a cascade beat is not a click on the whole spectrum: it is the ring (radius r cells) it adds to the medium's
  //   operator, and a ring acts at its own spatial scale, k ≈ j₀,₁/r. So a beat accents the shells around s(r) = (2.405/r)/π·nb (±~1
  //   shell, wider as s grows) — inner rings (short delays) higher, outer rings lower — at its exact fractal time. The burst that opens
  //   a cycle is heard as the cascade BUILDING its operator. Beats sent without rings (the old format) accent every shell alike.
  ringShell(r, nb) { return r > 0 ? (2.405 / r) / Math.PI * nb : -1; }
  //   accent at vt for shell h of nb (h < 0: every shell, the uniform accent): each beat of the last 0.5 s, decaying over 60 ms — weighted by
  //   its ring's scale when it carries one (a Gaussian in shells around s(r), peak +0.5), else +0.12 on every shell
  accentAt(beats, vt, k = 1, h = -1, nb = 64) { if (!(k > 0)) return 0; let lo = 0, hi = beats.length; while (lo < hi) { const m = (lo + hi) >> 1; if (beats[m].vg <= vt) lo = m + 1; else hi = m; }
    let env = 0; for (let i = lo - 1; i >= 0; i--) { const b = beats[i], dt = (vt - b.vg) * this.tickSec; if (dt >= 0.5) break; const e = Math.exp(-dt / 0.06);
      if (b.r > 0 && h >= 0) { const sb = this.ringShell(b.r, nb), sg = Math.max(0.75, 0.25 * sb), d = (h - sb) / sg; if (d * d < 16) env += 0.5 * k * b.mult * e * Math.exp(-0.5 * d * d); }
      else env += 0.12 * k * b.mult * e; }
    return Math.min(1.5 * k, env); }
  process(inputs, outputs) {
    const o = outputs[0], L = o[0], R = o[1] || o[0]; if (!L) return true;
    const n = L.length, sr = sampleRate;
    //   ── the virtual clock: advance by audio time, servo to the anchored presentation clock
    //   THE ANCHOR IS A NOISY MEASUREMENT. Each is (vt, ctx.currentTime) taken on a display frame, and currentTime moves in whole render
    //   quanta (128 samples = 2.7 ms), so one anchor's rate carries ±16–21% of timing noise (MEASURED on live recordings). Servoing to
    //   the newest anchor chased that noise: the vt rate wobbled 3–5% per block — ±52–81 cents of random vibrato on EVERY partial, the
    //   high ones smeared the most (a 1711 Hz grating order spread over 70 Hz). So the target is a LEAST-SQUARES LINE through the last
    //   ANCH_WIN s of anchors (the medium's real rate and phase, the quantisation averaged out), the rate follows its slope, and a phase
    //   error is corrected over ANCH_TC s, never faster than ±ANCH_MAX. A snap (|error| > 1 tick) still jumps.
    //   (RATE servo: the error is corrected by running up to ±10% fast/slow, never by stepping vt back — the phase integrators
    //   only run forward. A snap (|error| > 1 tick) jumps; the integrators then rebuild from their epoch origin.)
    let dvt = 1 / (sr * this.tickSec);
    if (this.anchor) { const fit = this.anchorFit(), tgt = fit ? fit.a + fit.b * (currentTime - fit.t0) : this.anchor.vt + (currentTime - this.anchor.at) / this.tickSec;
      if (this.vt === null || Math.abs(tgt - this.vt) > 1) { this.vt = tgt; this.rS = null; }
      else { const r0 = fit ? fit.b * this.tickSec : 1;   // the fitted rate, in nominal units (1 = one tick per tickSec)
        //   the medium's tick rate is nearly constant: the slope is itself low-passed (time constant ANCH_TC), so a window sliding
        //   over one late anchor does not bend the pitch
        //   (the filter's time constant grows with the span of anchors seen, so a first fit from a few anchors is not held for seconds)
        const q = this.anchors, span = q && q.length > 1 ? q[q.length - 1].at - q[0].at : 0, tauR = Math.max(0.2, Math.min(ANCH_TC, span));
        this.rS = (this.rS === undefined || this.rS === null) ? r0 : this.rS + (r0 - this.rS) * Math.min(1, n / (sr * tauR)); const r = this.rS;
        const err = tgt - this.vt, cap = Math.abs(err) > 0.25 ? 10 * ANCH_MAX : ANCH_MAX;   // a large error glides back (≤2%, brief) rather than snapping
        dvt *= Math.max(0.5, Math.min(2, r)) * (1 + Math.max(-cap, Math.min(cap, err * this.tickSec / ANCH_TC))); } }
    const vt0 = this.vt ?? 0; this.vt = vt0 + n * dvt;
    if (this.mode === "scan") {
      const a = this.cur, b = this.nxt, M = b.length, st = this.setAt(vt0), inc = (st.f0 || 110) / sr, g = this.gainScan * this.loudScan;
      for (let k = 0; k < n; k++) { const x = this.ph * M, i0 = Math.floor(x) % M, i1 = (i0 + 1) % M, fr = x - Math.floor(x);
        const va = a.length === M ? a[i0] + (a[i1] - a[i0]) * fr : 0, vb = b[i0] + (b[i1] - b[i0]) * fr;
        const v = Math.tanh((va + (vb - va) * this.mix) * g * 2) * 0.5; L[k] = v; if (R !== L) R[k] = v;
        this.mix = Math.min(1, this.mix + this.dmix); this.ph += inc; if (this.ph >= 1) this.ph -= 1; }
      return true;
    }
    const C = this.clock, S = C && C.slots && C.slots[0]; this.beats = this.beatsNear(S, vt0 - 8 / this.tickSec, vt0 + n * dvt + 2 * GRC / GR);   // 8 s back: holo delays + accent tails
    for (let k = 0; k < n; k++) { const v = this.sampleAt(vt0 + k * dvt); L[k] = v[0]; if (R !== L) R[k] = v[1]; }
    return true;
  }
  //   ── s(vt): ONE stereo sample at virtual time vt. Per partial: amp(vt)·sin(2π·frac(f·tickSec·vt) + P(vt)), panned — the oscillator term
  //   exact per sample, the CONTROLS (amp with its accent, phase offset P, pan gains) linearly interpolated between points of a fixed virtual
  //   grid (every GRC grid points, anchored in vt, not in the block) — each control point a pure fn of its grid index, so the result is pure
  //   in vt. The controls vary far below the control rate (frames at 160/s, linewidths ≤ 40 Hz), so nothing audible is lost; the cost drops
  //   from every lookup per partial per sample to one per control point.
  sampleAt(vt) {
    const x = vt * GR / GRC, M = Math.floor(x), fr = x - M, c0 = this.ctrlAt(M), c1 = this.ctrlAt(M + 1); if (!c0) return [0, 0];
    const look = this.lerpAt(this.frames, vt, this.hLook ?? -1); if (!look) return [0, 0]; this.hLook = look.i;
    const loud = (look.a.loud ?? 0) + (((look.b.loud ?? look.a.loud) ?? 0) - (look.a.loud ?? 0)) * look.w, g = this.gainAt(vt) * loud; if (!(g > 0)) return [0, 0];
    const same = c1 && c1.n === c0.n && c1.key === c0.key, ts = this.tickSec, u = same ? fr : 0, v1 = same ? c1 : c0; let l = 0, r = 0;
    //   the CARRIER channel C (an angle, wrapped): interpolated by the SHORTEST ARC between control points, then × R — a linear lerp across
    //   a ±π wrap swept 2π in one control interval (a click at every wrap of the carrier). Per pair (c0, v1), computed once.
    if (c0.cFor !== v1) { c0.cFor = v1; const n = c0.n, p0 = c0.Pc0 || (c0.Pc0 = new Float64Array(c0.C.length)), dp = c0.dPc || (c0.dPc = new Float64Array(c0.C.length));
      for (let i = 0; i < n; i++) { const a = c0.C[i], d = v1.C[i] - a; p0[i] = c0.R * a; dp[i] = v1.R * (a + Math.atan2(Math.sin(d), Math.cos(d))) - p0[i]; } }
    const Pc0 = c0.Pc0, dPc = c0.dPc;
    //   partial i: Re(A_ch·e^{i(ω t + P)}) per channel = A_re·sin + A_im·cos — the complex amplitude A (its sectors' measured phasors,
    //   panned by direction) and the real phase P (the carrier, holo terms) interpolated between control points, the oscillator exact
    for (let i = 0; i < c0.n; i++) { const f = c0.f[i], cyc = f * ts * vt, P = c0.P[i] + (v1.P[i] - c0.P[i]) * u + Pc0[i] + dPc[i] * u, ph = TAU * (cyc - Math.floor(cyc)) + P, sn = Math.sin(ph), cs = Math.cos(ph);
      l += (c0.Lr[i] + (v1.Lr[i] - c0.Lr[i]) * u) * sn + (c0.Li[i] + (v1.Li[i] - c0.Li[i]) * u) * cs;
      r += (c0.Rr[i] + (v1.Rr[i] - c0.Rr[i]) * u) * sn + (c0.Ri[i] + (v1.Ri[i] - c0.Ri[i]) * u) * cs; }
    return [Math.tanh(l * g), Math.tanh(r * g)];
  }
  //   the controls at grid point M (memoized: the last few points — a pure fn of M)
  ctrlAt(M) { const cc = this.cc || (this.cc = new Map()); let c = cc.get(M); if (c !== undefined) return c; c = this.ctrlCompute(M * GRC / GR); cc.set(M, c); if (cc.size > 4) cc.delete(cc.keys().next().value); return c; }
  ctrlCompute(vt) {
    const st = this.setAt(vt), C = this.clock, S = C && C.slots && C.slots[0], slot = S ? S.i : 0, ts = this.tickSec, beats = this.beats || [];
    const look = this.lerpAt(this.frames, vt); if (!look) return null;
    const lv = (key) => { const x = look.a[key] ?? 0, y = look.b[key] ?? x; return x + (y - x) * look.w; };
    const Rl = st.lens || 1, f0 = st.f0 || 110, ny = sampleRate * 0.45, pan = lv("panL"), wid = lv("width");
    //   FRESH frames only: a slot whose newest band frame is more than STALE ticks behind vt has stopped being measured (sound gated off,
    //   a slot switch, a stalled probe). Holding its last spectrum would play a FROZEN timbre that no longer follows the medium (it hid a
    //   gate bug: damage changes went unheard until a re-toggle). So stale frames are not used — a stopped data flow is heard as such.
    const fresh = (q) => (q && q.length && vt - q[q.length - 1].vt <= STALE) ? q : null;
    const sq = fresh(this.sub.get(slot)), SF = sq ? this.lerpAt(sq, vt, this.hSF ?? -1) : look; if (SF.i !== undefined) this.hSF = SF.i;
    //   a frame carries SEC sectors per shell (4 = the wavevector's directions; 1 = one path per shell)
    const SEC = Math.max(1, (SF.a.sec | 0) || 1), nb = Math.min(H, Math.floor((SF.a.amp || []).length / SEC)), hint = this.hint || (this.hint = new Int32Array(H).fill(-1));
    const ampOf = (F, j) => { const x = F.a.amp ? F.a.amp[j] || 0 : 0, y = F.b.amp ? (F.b.amp[j] ?? x) : x; return x + (y - x) * F.w; };
    const gL = (pl) => Math.sqrt(Math.max(0, (1 - pl) / 2)), gR = (pl) => Math.sqrt(Math.max(0, (1 + pl) / 2));
    //   STEREO. With sectors: each sector at its DIRECTION's x-component (right +0.8, left −0.8, up/down centred) around the picture's
    //   energy centroid — the waves heading +x lean right, −x left. With one path per shell: the old fan (odd left / even right by spread).
    const SECPAN = [0.8, 0, -0.8, 0];
    const panOf = (h, n) => { const sgn = (h & 1) ? 1 : -1; return Math.max(-1, Math.min(1, pan + sgn * wid * 0.6 * (0.3 + 0.7 * h / Math.max(1, n - 1)))); };
    //   the shell's complex amplitude per channel from ITS SECTORS' measured phasors (coherent sum — their relative drift is heard as the
    //   shell's own amplitude/phase motion); scale = accent × tilt. Returns [Lr, Li, Rr, Ri].
    //   PLACE (the app's space "place"): a frame carries pos[h] — WHERE shell h's energy is on the plate (−1 left … +1 right, × its
    //   concentration; measured from the spectrum by the shift theorem) — and every sector of the shell sits there instead
    const posOf = (F, h) => { if (!F.a.pos) return null; const x = F.a.pos[h] ?? 0, y = F.b.pos ? (F.b.pos[h] ?? x) : x; return x + (y - x) * F.w; };
    const shellA = (F, h, vtq, hi, scale, nS) => { let Lr = 0, Li = 0, Rr = 0, Ri = 0; const ps = posOf(F, h);
      for (let q = 0; q < SEC; q++) { const j = h * SEC + q, a = ampOf(F, j); if (!a) continue; const ph = this.phiAt1(slot, vtq, j, hi), c = Math.cos(ph), sn = Math.sin(ph);
        const pl = ps !== null ? Math.max(-1, Math.min(1, ps)) : SEC > 1 ? Math.max(-1, Math.min(1, pan + SECPAN[q % 4])) : panOf(h, nS), l = a * gL(pl), r = a * gR(pl);
        Lr += l * c; Li += l * sn; Rr += r * c; Ri += r * sn; }
      return [Lr * scale, Li * scale, Rr * scale, Ri * scale]; };
    const cap = 3 * H + NC * HC + REFN, out = { n: 0, key: "s" + SEC, R: Rl, f: new Float64Array(cap), P: new Float64Array(cap), C: new Float64Array(cap), Lr: new Float64Array(cap), Li: new Float64Array(cap), Rr: new Float64Array(cap), Ri: new Float64Array(cap) };
    const push = (f, P, A, c = 0) => { const i = out.n++; out.f[i] = f; out.P[i] = P; out.C[i] = c; out.Lr[i] = A[0]; out.Li[i] = A[1]; out.Rr[i] = A[2]; out.Ri[i] = A[3]; };
    //   TILT — a LISTENING EQ, not physics (replicated, labelled): partial h scaled by tilt dB per octave, 0 = the measured spectrum as is.
    //   REF — the ω REFERENCE (replicated level): the first REFN shells again WITHOUT the carrier term — the same field in the frame the
    //   register rotates against. With it, the carrier is heard as BEATING at exactly its frequency (ω·dτ/2π per tick × R): a slow swell,
    //   stopped at ω = 0, a jump at a Kuramoto kick. Its phase paths are the voice's own, so only the rotation beats.
    const tilt = st.tilt || 0, ref = Math.max(0, Math.min(1, st.ref || 0)), tg = (h) => tilt ? Math.pow(10, tilt * Math.log2(h + 1) / 20) : 1;
    //   RHYTHM (replicated `accent`, 0…1) — the INSTRUMENT's voicing of the cascade clock's beat events as short loudness accents. The
    //   events are real (the slot's Fresnel beats, their rate set by its proper-time clock — the ⧗ slider); the accent shape is ours.
    //   0 = the field's own continuous amplitudes only.
    const acK = Number.isFinite(st.accent) ? Math.max(0, Math.min(1, st.accent)) : 1;
    //   SOURCE–FILTER (replicated comb M = 1…3). The SOURCE is a harmonic comb at spacing f0/M — the instrument's, labelled as such. The
    //   FILTER is the medium: the measured shell spectrum as an ENVELOPE on the same frequency axis (shell s centred at (s+1)·f0). A comb
    //   partial between two shell centres takes the interpolated ENERGY per channel (divided among the M partials of a shell region) and the
    //   interpolated phase (shortest arc) — each shell's energy used once, in its own region; its real phase (carrier, holo delay) is
    //   interpolated along the same axis. M = 1 is the plain voice: partial n is shell n.
    //   PITCH AXIS of the sounding slot (pitchRatios) and its GLIDE phase G (glAt). The comb (a harmonic source) only on the harmonic axis.
    const pm = this.pitchOf(st, slot), PR = this.pitchRatios(pm, H), M = pm === "harmonic" ? Math.max(1, Math.min(3, (st.comb | 0) || 1)) : 1;
    const shA = this.shA || (this.shA = Array.from({ length: H }, () => [0, 0, 0, 0])), shP = this.shP || (this.shP = new Float64Array(H)), shD = this.shD || (this.shD = new Float64Array(H)), shG = this.shG || (this.shG = new Float64Array(H)), shC = this.shC || (this.shC = new Float64Array(H));   // shC: the carrier angle (× R in sampleAt); shP: the rest of the phase
    const emit = (nS, del) => { out.key += pm[0] + (M > 1 ? "m" + M : "") + "n" + nS;
      if (M === 1) { for (let h = 0; h < nS; h++) { const f = f0 * PR[h]; if (f > ny) break; if (!(f > 0)) continue; const t = tg(h), A = shA[h]; push(f, (del ? -TAU * f * del[h] : 0) + shP[h] + (shG[h] ? TAU * f * ts * shG[h] : 0), [A[0] * t, A[1] * t, A[2] * t, A[3] * t], shC[h]); } return; }
      const mix = (a0r, a0i, a1r, a1i, w) => { const e = ((1 - w) * (a0r * a0r + a0i * a0i) + w * (a1r * a1r + a1i * a1i)) / M; if (!(e > 0)) return [0, 0];
        const p0 = Math.atan2(a0i, a0r), p1 = Math.atan2(a1i, a1r), dp = Math.atan2(Math.sin(p1 - p0), Math.cos(p1 - p0)), p = p0 + w * dp, m = Math.sqrt(e); return [m * Math.cos(p), m * Math.sin(p)]; };
      for (let q = 1; q <= M * nS; q++) { const f = q * f0 / M; if (f > ny) break; const x = Math.max(0, q / M - 1), s0 = Math.min(nS - 1, Math.floor(x)), s1 = Math.min(nS - 1, s0 + 1), w = x - s0;
        const A0 = shA[s0], A1 = shA[s1], t = tg(x), Lc = mix(A0[0], A0[1], A1[0], A1[1], w), Rc = mix(A0[2], A0[3], A1[2], A1[3], w);
        const dl = del ? del[s0] + (del[s1] - del[s0]) * w : 0, gg = shG[s0] + (shG[s1] - shG[s0]) * w;
        const dC = shC[s1] - shC[s0];
        push(f, -TAU * f * dl + shP[s0] + (shP[s1] - shP[s0]) * w + (gg ? TAU * f * ts * gg : 0), [Lc[0] * t, Lc[1] * t, Rc[0] * t, Rc[1] * t], shC[s0] + Math.atan2(Math.sin(dC), Math.cos(dC)) * w); } };
    if ((st.mode || this.mode) === "holo") {
      //   HOLO (legato): the continuous voice passed through the medium's operator λ(k)^T — each partial is the ADD partial evaluated at its
      //   own RETARDED time vt − τ_h (τ_h the group delay the operator's phase implies, −dφ/dω) and shifted by that phase (leg·R·T·Ω_h).
      //   Everything the medium does — a cascade accent, a sub-tick flicker, a Kuramoto kick — arrives as a chirp across the partials.
      //   The operator's per-band phase is interpolated between cascade cycles by age, so the delays glide (no jump at a cycle edge).
      if (!S) return out;
      const cp = this.age(S, vt) / C.period, n0 = Math.floor(cp), u = cp - n0, T = this.tAt(vt), leg = st.leg ?? 1;
      let nA = n0; if (!this.holo.has(nA)) { let best = null; for (const k of this.holo.keys()) if (best === null || Math.abs(k - n0) < Math.abs(best - n0)) best = k; nA = best; }   // the nearest cycle the main thread sent
      const hA = nA === null ? null : this.holoOf(nA, leg, f0, Rl, T, PR, pm), hB = (nA === n0 && this.holoOf(n0 + 1, leg, f0, Rl, T, PR, pm)) || hA; if (!hA) return out;
      const hn = Math.min(nb, hA.phi.length, hB.phi.length); out.key += "h";
      for (let h = 0; h < hn; h++) {
        const del = hA.del[h] + (hB.del[h] - hA.del[h]) * u, ph = hA.phi[h] + (hB.phi[h] - hA.phi[h]) * u, vh = vt - del / ts;
        const F = sq ? this.lerpAt(sq, vh, hint[h]) : look; if (F.i !== undefined) hint[h] = F.i;
        //   sin(2π·f·ts·vh + …) = sin(2π·f·ts·vt − 2π·f·del + …): the oscillator term stays exact per sample, the delay is a phase offset
        shA[h] = shellA(F, h, vh, hint[h], 1 + this.accentAt(beats, vh, acK, h, hn), hn); shD[h] = del; const cv = sq ? this.carAt(slot, vh) : null; shC[h] = cv !== null ? cv : this.thetaAt(S, vh); shP[h] = ph; shG[h] = this.glAt(slot, vh); }
      emit(hn, shD);
      if (ref > 0) { out.key += "r"; for (let h = 0; h < Math.min(REFN, hn); h++) { const f = f0 * PR[h]; if (f > ny) break; if (!(f > 0)) continue;
        push(f, 0, shellA(SF, h, vt, this.hSF ?? -1, ref * tg(h) * (1 + this.accentAt(beats, vt, acK, h, hn)), hn)); } }   // the reference: unrotated, undispersed, unglided
      return out;
    }
    //   ADD: every partial on the carrier R·∠ — measured (car) where the frames carry it, else the closed form θ(vt) — its sectors on their measured phase paths
    const cA = sq ? this.carAt(slot, vt) : null, th = cA !== null ? cA : (S ? this.thetaAt(S, vt) : 0), G0 = sq ? this.glAt(slot, vt) : 0; out.key += "a";
    for (let h = 0; h < nb; h++) { shA[h] = shellA(SF, h, vt, this.hSF ?? -1, 1 + this.accentAt(beats, vt, acK, h, nb), nb); shC[h] = th; shP[h] = 0; shG[h] = G0; }
    emit(nb, null);
    if (ref > 0) { out.key += "r"; for (let h = 0; h < Math.min(REFN, nb); h++) { const f = f0 * PR[h]; if (f > ny) break; if (!(f > 0)) continue;
      push(f, 0, shellA(SF, h, vt, this.hSF ?? -1, ref * tg(h) * (1 + this.accentAt(beats, vt, acK, h, nb)), nb)); } }   // the reference: the same shells without the carrier (and without the glide)
    //   companions: their own first shells (energy of all their sectors), at their own Kuramoto phase
    const comp = C && C.slots ? C.slots.slice(1, 1 + NC) : [];
    for (let j = 0; j < comp.length; j++) { const s = comp[j], q = fresh(this.sub.get(s.i)), F = q ? this.lerpAt(q, vt) : null;
      const ca = F ? null : (look.a.comp && look.a.comp[j]); if (!F && !ca) continue; out.key += "c" + s.i;
      const tj = this.thetaAt(s, vt), pc = Math.max(-1, Math.min(1, -0.8 + 1.6 * (s.i / 3))), SJ = F ? Math.max(1, (F.a.sec | 0) || 1) : 1;
      const PRj = this.pitchRatios(this.pitchOf(st, s.i), H), Gj = q ? this.glAt(s.i, vt) : 0; out.key += this.pitchOf(st, s.i)[0];   // each companion on ITS OWN pitch axis, with its own glide
      for (let h = 0; h < HC; h++) { let e = 0; if (F) for (let q2 = 0; q2 < SJ; q2++) e += ampOf(F, h * SJ + q2) ** 2; const a = 0.6 * tg(h) * (F ? Math.sqrt(e) : (ca[h] || 0)), f = f0 * PRj[h]; if (!(f > 0)) continue;
        push(f, Gj ? TAU * f * ts * Gj : 0, [a * gL(pc), 0, a * gR(pc), 0], tj); } }
    return out;
  }
}
registerProcessor("ahc-scan", AhcScan);
