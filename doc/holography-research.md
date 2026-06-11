# Native IFS Holography — Research Notes, Open Questions & Development Path

*The exploratory layer beneath [`native-ifs-holography.md`](native-ifs-holography.md): the open
questions, the development narrative, and the measure-first investigations (including the ones whose
conclusions are now folded into the overview). The overview states the current state; this file records
how it was reached and what remains open.*

> Companions: [`native-ifs-holography.md`](native-ifs-holography.md) (current-state overview),
> [`holography-demos.md`](holography-demos.md) (multimedia walkthroughs),
> [`native-ifs-holography-memory.md`](native-ifs-holography-memory.md) (full archived history incl.
> the superseded FFT/wavelet NOs and the operator-as-propagation "lens hunt" in complete detail).
> Section numbers are preserved from the original document for cross-reference.

---

## Open questions (current frontier)

The honest live frontier — what is NOT settled, gathered from across the work:

- **Computational universality.** The measured instruction set is bilinear binding (§7.32–7.34) +
  matched-filter recognition (§7.38/7.41) + temporal multiplexing (§7.43–7.44). Whether the soliton
  algebra is *computationally universal* — can express arbitrary programs, not just these — is **open**.
  "The medium is the processor" is demonstrated at small scale (Nr≈64, 3 modalities, rank-3 rules), not
  proven general. (See the synthesis §7.48 in the overview for the honest scope line.)
- **The native lens / self-focusing, dormant.** A genuine native focusing lens exists in the substrate —
  the NLS self-focusing nonlinearity — but the live medium runs the LINEAR limit (`GAMMA=0`). Waking it
  (focusing-NLS sign, norm above the soliton collapse threshold) is an untried operating regime. The dot
  product is the DC Fourier bin, reached by the DFT/pure-conv path, not the leapfrog (full detail of the
  whole lens investigation in `…-memory.md` §7.46–7.52).
- **Associative multi-object memory.** Hopfield-IFS recall works (§7.42, capacity ~0.14N, basin ~45%);
  multiplexing multiple stored objects into the live eye is **pending**.
- **`[H]` computational transforms.** The hologram-domain `[H]` slot is live (filter/occlude/conjugate);
  richer computational transforms through it are **pending**.
- **Cyberphysical I/O coupling.** Vision — coupling the holographic medium to external sensors/actuators.
- **Voice-as-events occlusion-robustness.** The piano-roll voice (demos §7.16) is only WEAKLY holographic
  under occlusion (survival ≈ 1−r, photographic at most depths); genuine redundancy appears only at light
  occlusion + deep T. Whether a sparser/structured voice encoding lifts this is open.
- **2D occlusion-redundancy GPU-verify** for the unified field (`⊙ BEAT`, demos §7.10) is pending.
- **Truest "one live holographic soliton."** Reconstructing from the masked `Ψ(cyc)` itself (vs the
  current recon) is the open option for the truest single-soliton readout (deferred, §7.23 in overview).
- **Stereo/parallax depth.** The depth explorer gives one moving viewpoint, not two simultaneous
  viewpoints (stereo/parallax) — future work (overview §6.3).

---

## Development path & exploratory findings

These sections record the investigation behind the current state — the recon-vs-hologram recognition
study (§7.40) and the full recursion/self-hosting/limit-cycle research narrative (§7.42). The overview
keeps the condensed current-state conclusions (and the §9 cyberphysical roadmap); the probe-by-probe
development is here.

### 7.22-dev The "two objects → one" step (how the live-soliton readout was unified)

The overview's §7.22 now states the final result (the recon back-propagates the actual `Ψ(cyc)`). The
development step behind it: initially the audio recon **re-holographed the bar's clock-content in
isolation** (`seed(events)→forward→occlude→backward`) rather than reading the live travelling field —
so "the soliton" (`Ψ(cyc)`) and "what you hear" were **two pure-clock objects, not one.** This was
deliberate: §7.20 found that back-propagating the multi-bar travelling field risked **contaminating** a
single bar's recovery. The unification (reading the matured bar `nowBar−readBars` at its true age from
the real `Ψ(cyc)`) was tried measure-first and the contamination risk **did not materialize** (r=0 stays
1.00 at every depth), AND it proved MORE robust than the isolated read (which got *worse* with deep T at
heavy occlusion, r=0.5→0.00). So the earlier "weakly holographic / crossover-collapse" verdict was an
artifact of the isolated path, now superseded. (Full GPU table in overview §7.22.)

### 7.40 Recognition is photographic in the recon, holographic in the hologram (`holoRecogVsT`)

A sharp user question: *higher T = truer hologram, so why does wavelet recognition DEGRADE at high T?* Because
the live recognizer reads `viewTau` — the **refocused photo** — which blurs under `[H]` + a deep round-trip
(float32 error over 2T steps). The **hologram** (`holoMasked`, the forward-T spread field) gets *richer* with
T. `holoRecogVsT` measures both, running the real `waveletRecognizeGPU` on the real fields at depth T with
`[H]` applied (recon uses the glyph descriptor; hologram uses the ref's *hologram* descriptor):

| T | recon-domain | hologram-domain |
|---|---|---|
| 10 | 349× | 1.66× |
| 50 | 157× | 2.23× |
| 150 | 40× | 2.95× |
| 350 | 97× | **3.41×** |

**Each column's TREND is the signal** (absolute scales differ — different operators, not comparable): recon
**falls** with T (the photo blurs — the user's observed degradation, confirmed; magnitudes inflated by near-
zero distractor denominators, untrustworthy), hologram **rises monotonically** (the hologram gets truer). So
recognition in the recon is **photographic** (degrades with depth); in the hologram it is genuinely
**holographic** (improves with depth) — the user's intuition, measured. Honest dual: hologram = robust +
improving-with-T but **soft** (single-digit×); recon = sharp but degrades. (Probe-v1 bug: it measured a global
inner product, which **unitarity** §7.28 conserves across T → a flat 1.49× no-op; the real degradation needs
`[H]` and the spatial cascade — v2 fixed it.) Trigger: console `holoVsT()` then enter a RECOG mode.

**Domain map of "[H] computing" (clarification).** `[H]` *always* lives in the hologram domain (the slot
between forward and backward legs — where the field is maximally spread, so a local edit is distributed). The
COMPUTATION (bind/correlate/gate) is therefore always hologram-domain; what differs is the **readout domain**,
and that is chosen by the QUESTION: a spatial answer (*where* — GATE's carved image, recognition's position)
is read in the **recon** (refocus → sharp, but T-fragile); a content answer (*is it present / how strongly* —
∿ HOLO) is read in the **hologram** (T-robust, improves with depth). GATE = compute-in-hologram, read-in-recon
(by choice, to *see* the carved picture). The recon is never a separate pipeline — it IS the hologram refocused:
`clean → forward T → HOLOGRAM → [H] → back T → RECON`. Refocusing is precisely the step that re-concentrates the
delocalized hologram back into positions, which is why "where" must refocus.

**recon ≠ hologram, and high T helps the hologram but HURTS the recon.** A clean `forward T → back T` is the
identity for any T (reversible) — so recon(T=1)=recon(T=500) for a clean field. T matters only via (a) `[H]` in
the middle: at low T the field is concentrated so masking is catastrophic, at high T it's spread so masking is
graceful → **higher T = more occlusion-robust hologram**; and (b) float32 error over 2T steps → **higher T =
blurrier recon**. These oppose: deeper = truer hologram (content) but worse refocus (position) — the §7.40 dual,
with a sweet-spot T (the `recT` dial; the §7.40 recon column was non-monotonic for this reason). The hologram
(panel 1 at high T) is interference speckle, NOT an image — it is never "equal to" the reconstruction.

**The letter page is FLAT (one plane), so high T only spreads it — no 3D payoff.** `_buildLetterPage` stamps all
glyphs into one depth-0 layer (unlike the depth-staged image soliton). A flat object has no depth content, so
deep propagation buys only spreading (occlusion-robustness via ∿ HOLO) + refocus blur, none of the true
holographic 3D payoff (rack-focus, cut-in-half, parallax) that a DEPTH-STAGED object would give.

**Refinement (live ∿ HOLO): the hologram reports PRESENCE, not POSITION.** Wiring hologram-domain recognition
live revealed the deeper truth: forward-propagating to depth T **delocalizes** every letter (each A's info
spreads over the whole grid and superposes with the others — the hologram's defining property), so a *spatial*
A-map dissolves (∿ HOLO at recT=400 gave one diffuse central glow, not three A marks). So the hologram answers
**"is A present, how strongly"**, not **"where"** — that is intrinsically a *recon* (refocus) question.
`holoPresence` returns the honest scalar: `corr(sceneHolo, A-holo) / corr(sceneHolo, distractor-holo)` (>1 = A-
content dominates), shown live as a **central strength meter** (∿ HOLO) that RISES with T. **The two domains are
complementary, not competing:** recon (⊡ CAND / ∿ WAVE / ⊞ FFT) = *where* the A's are (sharp, T-fragile);
hologram (∿ HOLO) = *whether/how strongly* A is present (soft, T-robust, improves with depth). That dual is the
real §7.40 result — sharper than "the hologram is better."

**Wired live (⊡ RECOG).** Scale-invariance is now in the running engine: the glyph grid shows the reference L
and distractor + at **varying sizes** (0.7×/1.0×/1.5×, rotating per bar), and `recognizeLiveScale` searches the
proven correlation operator over a scale ladder per slot — finding each L **regardless of size** and reporting
the matched scale (the §7.38 localization). Panel 4's glow + edges are **sized to the matched scale** (the ring
grows to fit the object it found), and the console logs per-bar `matched scales [...] scale-correct N/refs`. So
the live demo shows both faces together: the reference's occurrences light up at **any position and any size**.
Cost: 9 slots × 5 scales GPU round-trips per bar (per-bar, not per-frame; trim scales if it stutters).
**Verified live:** with three L's at distinct sizes per bar, the matched scales read e.g. `[1.00✓ 1.60✓ 0.60✓]`,
scale-correct 3/3, and panel-4 glows render at the matched sizes (small/medium/large rings on their L's, +'s
dark). **Process — three test-rig bugs en route** (all in the *demo*, not the recognizer): (i) size keyed to
ref-ness → every L always small; (ii) within-bar scale collapse (refs share idx mod 3) → all refs one size;
(iii) fixed by keying scale on slot-row → three sizes per bar. The first "scale-correct 3/3" was meaningless
(one size only); the verified pass has three *distinct* matched scales.

**Honest scope of recognition (§7.34).** It measures recognition at *candidate positions* (the proven
correlation operator, on the GPU, evaluated where we query) — the real matched-filter *discrimination*
question. It does **not** claim a dense every-pixel correlation map: §7.35 measured that the FFT-class
sliding operator does **not** hold on the ring-kernel (and 4096 round-trips is too slow to be live). Two earlier attempts were rejected en route — a real-
space pointwise product (reference parked at grid center → zero overlap with off-center copies → all-zeros,
a bug) and a pure-JS correlation (not the GPU medium — a measure-on-the-medium violation). The passing
version is the proven IFS operator, nothing mocked.

**Wired live (⊡ RECOG button).** In ⊙ SOLITON, the image becomes a 3×3 grid of glyphs — the reference **L**
and distractor **+**, which glyph sits in which slot rotating per bar (a deterministic function of the bar →
clock-pure, peer-identical). Once per bar, `recognizeLive` runs the proven correlation operator at each slot
against the *recon* image (so recognition operates on the reconstructed wavefront), and panel 4 **rings the
matches**: green ✓ where the reference L is correctly found, red ✗ on any false hit, dim grey on non-matches.
You watch the L-detector pick out the L's as the grid shuffles each bar — recognition, live, on the medium.
Cost is bounded (one round-trip per slot, re-evaluated per bar not per frame, like ⊞ GATE).


### 7.42 Recursion, feedback & self-hosting — the soliton algebra's closure (§9, two conceptual questions)

Two questions about the algebra's self-reference, each answered measure-first (with the usual several
artifacts caught and fixed en route — identity-kernel cheats, underpowered optimizers; the SVD construction
is what finally worked).

**Q1 — recursion / feedback.** *Structural* recursion is free: every combinator is closed over the Soliton
type, so `gate(a, gate(b,c))` nests arbitrarily (used live). *Temporal* feedback (output→own input) is only
sound as a **clock-pure fixed-point loop** — fixed iterations from a clock-seeded start stay a pure function
of the clock → peer-synced; open-ended state would break sync (forbidden by design). `fixedPointLoop` is the
primitive; **RECALL is its first real instance** (`recallGate`): Hopfield associative completion. GPU-measured
the **real surface** (random non-orthogonal bipolar patterns, N=256): corr falls toward the **capacity edge
M≈0.14N=36** and the **basin edge ~40–45% noise** (M=4/10%→1.00; M=36/45%→0.24) — the textbook Hopfield
limits, on the clock-pure feedback loop, deterministic (peer-synced). (Convergence degrades past capacity —
spurious attractors, also classic.) So feedback works, with measured limits, sync-safe.

**Q2 — can the algebra be a soliton / host itself?** Two layers. **Objects: YES, proven** — `unite` is a
monoid, so a composite scene IS a soliton (used live as `_eyeScene`). **Operator as ONE field: NO, a rank
theorem** — a binding rule (a,b)→bind(a,b) is a bilinear map = a rank-n tensor; one field is rank-1.
`selfHostGate` measures it exactly via SVD: rank-1 captures only **9%** of a general operator, rank-2 18%,
rank-4 34%, rank-8 61%, rank-16 100%. (And `selfApplyGate` confirms "reaching a fixed point" is generic — Ω
ties a random control — so fixed-point-reaching ≠ self-hosting.) **Operator as a rank-K STACK: YES,
constructive** — `operatorSoliton`/`fitOperatorSoliton` reify a binding rule as K (U,V,W) soliton-triples
(`apply(a,b)[k]=Σ_r W_r[k]·(U_r·a)(V_r·b)`), built exactly from the rule's truncated SVD. On a known rank-3
rule, fidelity rises **0.55→0.65→0.84 at K=3** and saturates — the operator becomes a VALUE in the algebra,
applicable like any soliton. **So the algebra hosts itself — objects as solitons, operators as rank-K
multi-soliton composites.** The rank is not a limitation to fix; it is the rank of the operation, and it tells
a self-hosting algebra exactly how to store its own rule: as a soliton stack. Trigger: ⊙ SOLITON + Alt+Ctrl/
Cmd-click (the §9 RECALL / SELF-APPLY / SELF-HOSTING / OPERATOR-SOLITON blocks).

**Operator in the medium — carrier-packing the stack into ONE field: NO for dense operators (measured).** The
rank-K operator-soliton is faithfully K *separate* fields (0.84). The natural next idea (the medium supports
orthogonal carrier-multiplexing, §7.28–7.30 — so pack the K triples on K orthogonal carriers into ONE wavefront,
rank living in the carrier dimension) was built (`operatorSolitonMedium`) and **measured: it does NOT hold for a
dense operator.** Carrier-packed vs the abstract stack ≈ **0.41** (Nr=16; ~0.6 at Nr=64 — more cells help but
don't close it). Crucially, **the IFS round-trip itself costs ZERO** (carrier-packed-vs-abstract = through-the-
medium, both 0.41) — the loss is **entirely carrier crosstalk on the DENSE triples**, exactly the §7.29 limit
(carrier-mux is clean for SPARSE content, leaks for dense). So: the orthogonal basis carries sparse *content*
losslessly but **not dense *operators*** — the faithful operator representation stays the explicit K-field stack.
Precise lead (then TESTED, below): a STRUCTURED/SPARSE operator might pack cleanly.

**Follow-up — does ANY orthogonal basis collapse the stack into one field? Measured NO (three routes tried).**
The lead above was tested honestly and **did not hold**: (1) **dense carriers** 0.41; (2) **wavelet-sparsity
gate** — a FRACTAL operator IS scale-sparser in the IFS-wavelet basis than random (wavelet PR 0.56 vs 0.95) so
the idea had real signal, BUT fractal ops are *even more* SPACE-sparse (0.15) → the wavelet isn't their best
basis; (3) **sparse-vs-dense carrier packing** — sparsifying the triples made carrier packing *WORSE* (0.70
dense → 0.21–0.35 sparse), because zeroing values removes signal without reducing the lattice/carrier crosstalk
(I'd conflated §7.29's "few lit cells" with "few non-zero values" — different things). **Conclusion: the rank-K
operator does NOT compress into one faithful field by carriers, sparse-carriers, or the wavelet premise — the
faithful representation stays the explicit K-FIELD STACK** (`operatorSoliton`). The rank genuinely needs K
slots. (A good hypothesis, properly refuted — the orthogonal basis carries sparse *content* but not rank-K
*operators*, in any **spatial/spectral** basis tried.) **But "space-like basis" was the hidden assumption** —
resolved next.

