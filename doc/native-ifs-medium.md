# Native IFS Medium — Lens Stack, Soliton Algebra, and the Eye Trap

This document explains and **measures** the meta-circular wavefront medium implemented in
`public/soliton-algebra.js` (the algebra + lens ops), `public/ifs-gpu.js` (the GPU substrate), and
`public/apps/medium.js` (the demo). Every number is from an actual run of the real ops — the tracers
only intercept GPU calls to observe; they never re-implement the physics.

**The guiding principle: physically correct, no tricks, no visual effects.** Renders show the real
medium state. Where a result looks degenerate — sparse code, interference fringes, dead-map corpse
dots, an IFS speckle instead of a smooth image — that is the *honest signal* of what the substrate is
doing, not a cosmetic artifact. A visual trick would lie about what the medium is, and the whole point
is a medium that *is* the computation.

Several sections below also record **corrections made during development** — places where an initial
framing was wrong and the measurement (or the user) overturned it. These are kept deliberately: the
wrong turns are part of understanding why the final design is what it is.

---

## 0. Orientation — what the medium is

The substrate is a wave field ψ on a grid (complex, re/im interleaved), evolved by an IFS world-clock.
A **genome** is a small set of K affine maps `{s, θ, tx, ty}ᴷ` — an Iterated Function System. The
genome plays three roles at once, and that triple identity is the heart of the system:

- **As an image** — injected as generator-impulses, it is field content.
- **As an optical element (lens)** — a phase plate the field passes through.
- **As a geometric operator** — its affine maps transform the space of the field.

The **eye** is a *trap*: it catches the living world soliton, lifts it into a held hologram, and
reconstructs it — then runs its own perception (clock / recall / self / coevolve) on that
reconstruction. "Looking through the lens" *is* reconstruction. Because the eye perceives on a lifted
replica of the world, and can run its own genome's evolution on it, the medium **operates on the
medium** — the meta-circle.

Everything is a pure function of the IFS clock (`bar`, `phaseT`), so the whole thing is
**peer-deterministic by construction** — two peers compute byte-identical fields (§7, verifiable via
the header hashes).

---

## 1. The two algebras, one substrate

There are two composable algebras in `soliton-algebra.js`, sharing one underlying type — *the field
operator*. This shared type is what lets the lens stack drop into the soliton algebra and vice-versa.

### 1.1 The Soliton Algebra (combinators over solitons)

A live soliton is a first-class value, defined entirely as a **pure function of IFS clock time**
(`cyc`):

```
Soliton = { kind, region(), inject(gpu,g,cyc,…), readout(g,recon,cyc,…) }
  inject  : HOW it writes content into the wavefront over a bar's propagation
  region  : WHICH grid region + depth band it owns (the orthogonality unit)
  readout : HOW to recover itself from a reconstruction
```

Combinators are **closed over the type** (Soliton → Soliton):

- `unite([...])` — superpose / region-mux into one wavefront (a **monoid**: a composite scene IS a
  soliton).
- `place(s, region)`, `atDepth(s, b0, b1)` — coexistence (region / depth multiplexing).
- `gate(controller, target)` — **computation**: a soliton taking two solitons, where one *transforms*
  the other via the binding `[H]` = the field product `ψ_A · ψ_B` (GPU-verified: `ψ_img · ψ_rhythm`
  reproduces the exact gated image at fidelity 1.000).

The governing law (measured, §7.20–7.23 in the source):

- **GUARANTEE — soundness is automatic.** The composite field is always deterministic and peer-synced,
  because everything is `f(cyc)`. You cannot compose your way into non-determinism.
- **CONDITION — legibility is conditional.** The *parts* are recoverable only if they stayed
  orthogonal (disjoint region OR depth OR sparse structure). `unite()` runs an orthogonality check and
  warns; soundness is automatic, legibility is the caller's discipline.

Coexistence has two realizations — **carrier-mux** (orthogonal in k, clean for sparse content) and
**temporal-mux** (each modality alone in its bar *phase*, carrier-free — "media as a limit cycle").
Computation is the third axis: coexistence *superposes-and-reads-separately*; computation
*multiplies-and-binds*.

### 1.2 The Lens Stack (operators over fields)

```
LensOp : (field:Float64[2N], gpu, ctx) → field'
ctx    : { bar, G, dt, rules, P, recon?, selectedRank?, recallScores?, ... }
```

A LensOp transforms ψ and may read/write the shared `ctx`. The composition primitive is the *entire
engine* — there is nothing more to it than this reduce:

```js
function composeLens(...ops) {
  const flat = ops.flat().filter(Boolean);
  return (field, gpu, ctx) => flat.reduce((f, op) => op(f, gpu, ctx) || f, field);
}
```

Three structural properties make this an algebra, not just a pipeline:

1. **Closed under composition.** `composeLens(...)` returns a LensOp — so a stack is itself an op and
   can be nested inside another stack (or dropped into `gate` / `operatorModality`, the bridge to
   §1.1). `makePerception` is *itself* a `composeLens` — stacks within stacks.
2. **The runner is UNTYPED.** There is no `if (trap) … else (pass)` branch anywhere. `reduce` just
   applies ops in order. **Trap-vs-pass is emergent from ordering** — `makeTrapStack` places `opRecon`
   (recon-first) into the sequence, and *that ordering* makes it a trap. The eye (trap) and the world
   lens (pass-through) compose from the *same* ops; they differ only in arrangement.
3. **State threads through `ctx`, not the field.** Ops that *select* rather than *transform* (e.g.
   `opRecall` picks a genome) return the field unchanged (identity on ψ) but write `ctx.selectedRank`.
   The held recon is first-class via `ctx.recon`. The field is the data bus; `ctx` is the shared
   blackboard the ops coordinate on, and the addressable record of every wavefront the stack produced.

### 1.3 How the two algebras meet — the unification

The crucial line in the source: *a LensOp is a FIELD OPERATOR, the same shape as a soliton's
transform.* So a LensOp and a soliton's `inject`/`xform` are the **same kind of thing**. That is why a
whole lens stack can be used as the `controller` in `gate`, or reified as an `operatorSoliton`. The two
algebras share one underlying type — the field operator — and both are closed under composition over
it, and both are pure in clock-time.

The deepest consequence is **self-hosting**: the binding *operator* is itself reified as a value in the
algebra (`operatorSoliton`, `operatorSolitonCyc` — a limit cycle, one field walking its K ranks across
K sub-ticks, the bound output accumulating, corr 1.000 on the GPU). *The operator is the same kind of
thing as the operands.* In the lens stack this shows up as the genome being both operator and data: in
`self` mode the genome acts on its *own* code-field — operator and operand are the same type (a field),
composed by the same `composeLens`. "The medium operates on the medium" is literally true at the type
level, not a metaphor.

---

## 2. The two physical operators — propagation vs phase-plate

Before tracing stacks, it matters to be precise about *what physically acts on the field*. Instrumenting
a single recon (intercepting every `gpu.*` call and classifying it) shows there are exactly **two
distinct physical operator families**, no third, no hidden path:

**1. The wave propagator — `stepEyeN(n, dt)`.** This is the real physics: `n` substeps of the
split-step nonlinear Schrödinger / NLHO integrator (the ring-Laplacian medium). It is **free
propagation of light through the medium** — diffraction/dispersion. `+dt` propagates forward (into the
diffraction/hologram domain), `−dt` propagates backward (reconstructs). It is **modality-agnostic** —
it propagates *any* ψ, image or code, identically, and is near-unitary (energy-conserving, reversible).

**2. The phase-plate — `linOp` (a.k.a. the genome lens).** A single GLSL pass that multiplies ψ by a
phase plate `e^{iφ}`, where φ is built from the genome: quadratic focus `a=(1−s)·0.06`, shear
`β=θ·0.04`, optional carrier `(kx,ky)`, centred on the genome's fixed points. This is **the genome
acting as an optical element** — the "geometry lens." It is pointwise (`ψ'(x)=ψ(x)·e^{iφ(x)}`),
unitary, local.

**Measured op stream for one recon** (intercepted, classified):

| mode | wave-prop (stepEyeN) | genome-plate (linOp) | other |
|---|---|---|---|
| image (pass) | 5 calls / 50 substeps | 1 | 0 |
| image (recall) | 13 / 82 | 1 (+ 4 corr round-trips) | 0 |
| code (self) | 77 / 674 | 25 | 0 |

Distinct physical operator families across all modes: **{ WAVE-PROP, GENOME-PLATE }** — and DAMAGE,
NL-KICK counts are 0 in clean recon (none of that machinery leaks in).

**The honest correction to a common mental picture.** It is tempting to imagine "a geometric lens for
the code and a wave lens for the image." That is *wrong*. There is **one wave propagator** doing all
spreading/reconstructing/focusing — identical for image and code — and **one genome plate** inserted
into that propagation path. Recon is:

```
if holoT>0:  stepEyeN(holoT, +dt)   // PROPAGATE forward → hologram domain (the wave operator)
             _plate()               // apply the genome phase-plate / metric resample
if holoT>0:  stepEyeN(holoT, −dt)   // PROPAGATE back → reconstruct (the wave operator)
if propT>0:  stepEyeN(propT, fdt)   // focal PROPAGATION → form the image (the wave operator)
```

So the two operators are not image-vs-code; they are **propagation (the medium)** and **the genome
plate (the program inserted into the medium)**, composed — and both act on whichever single modality
the eye is currently in. No modality gets a private lens. The `self` mode applies the plate 25× because
self *evolves* the code (the θ-walk iterates); the image modes apply it once.

---

## 3. The three lens modes — and the "not self-readable" correction

The genome plate (`makeGenomeLens`, `_plate()`) has **three** modes (`P.opMode`), not "two versions of
one medium." This distinction was clarified during development after an initial over-broad claim.

1. **`phase`** (`gpu.linOp` → `GLSL_LENS_GENOME`): `ψ'(x) = ψ(x)·e^{iφ}`, φ = `k·r` + the quadratic
   genome-lens phase (`a·r²` focus + `β·dx·dy` shear) about each centre. A **pointwise phase
   multiply** — `texelFetch` reads the pixel at its *own* coordinate; there is **no JS, no texture
   resample, no coordinate remap**. It never moves a value between cells; it only rotates the phase in
   place. **Unitary, local, self-readable** — the genuine `content·e^{iφ}` circular medium. This was
   built and tested byte-identical / peer-pure. **It is the purest form, and there is no trick in it.**

2. **`metric`** (`gpu.affineEyeCenters`): `ψ'(x) = ψ(M⁻¹·(x−t))` — a **coordinate remap** (the shader
   computes the pre-image coordinate and resamples there). This is the §7.97 *metric / curvature* law:
   *"a self-hosting wavefront operator must be a TRANSFORMATION OF THE SPACE (metric/coordinate map,
   residue-free — the operator is the curvature; space casts no shadow), NOT an OBJECT in it."*
   Measured residue-free and peer-pure. It is **required** for a true rotate/scale of an extended image
   — a phase tilt can shift, but cannot rotate or scale.

3. **`gauge`**: the mix — integer translate via metric (exact), fractional + focus/shear via phase.

**The correction (recorded because it matters).** An early framing cited the §7.92–7.100 *"real but
NOT self-readable"* result as if it applied to the geometric operator generally. That is a category
error. The "not self-readable" wall is about the **nonlinear collision / particle** operator — a thing
co-located *in* the field, whose readback couples through intensity + phase + position simultaneously
(every observable a 2-component field offers IS the coupling channel). The **phase lens** is neither a
metric resample nor a colliding particle — it is the `content·e^{iφ}` primitive, which is **self-hosting
and self-readable, IFS-native and holographic by construction.** Do not import the collision-wall caveat
onto the phase operator.

So the corrected fidelity hierarchy:

| mode | what it does | medium-honest? |
|---|---|---|
| **`phase`** | `ψ(x)·e^{iφ}` — pointwise phase, no resample | **purest**: unitary, local, self-readable, the circular medium. No trick. |
| **`metric`** | `ψ(M⁻¹x)` — coordinate remap | honest as the §7.97 metric/curvature law (residue-free, peer-pure); uses resampling (see §6 caveat) |
| **`gauge`** | integer-translate (metric) + sub-pixel/focus/shear (phase) | the engineering blend |

---

## 4. A field through the self-mode trap (op-by-op)

**Setup:** G=48, bar=4, holoT=8, a 3-map genome (with θ). Input = a localized blob (the world soliton
the eye traps). Stack = `composeLens(opHologram → opRecon → makePerception(self))`.

**Measured (`trace_self_stack.mjs`):**

```
INPUT (world soliton trapped):  energy 62.83  hash b5183b

ctx after the run (the first-class intermediates each op wrote):
  ctx.holoT      = 8
  ctx.hologram   : energy 62.84  hash 14382f   (EYE ◀ — the spread record)
  ctx.recon      : energy 62.84  hash b45208   (EYE ▸ — reconstructed from the hologram)
  ctx.selfRules  : 3 maps, θ=[0.97,2.21,4.38]  (opSelfEvolve: the θ-walked genome)
  ctx.selfLife   : [1.00,1.00,1.00]
  ctx._selfKey   = s   (memo key — re-derive only on change)

OUTPUT (perceived self-evolved wavefront): energy 9.84  hash 23db5b
```

**Op by op:**

- **Op 1 — `opHologram`** (`stepEyeN(8,+dt)`): propagates the blob *forward* into the diffraction
  domain. Writes `ctx.holoT=8`, `ctx.hologram` (EYE ◀). Energy 62.83→62.84 — forward propagation is
  near-unitary (conserved). The hash changes → the field genuinely transformed.
- **Op 2 — `opRecon`** (`stepEyeN(8,−dt)`): propagates *backward* (matched inverse) → the spread
  hologram collapses toward the localized image. Writes `ctx.recon` (EYE ▸). Energy still ≈ conserved;
  but the hash differs from the input (`b5183b` → `b45208`): forward-then-back is faithful **but not
  bit-perfect** on the finite grid (the resample/dispersion caveat). A faithful reconstruction, not a
  byte copy — and this is honest to state.
- **Op 3 — `makePerception(self)`** (a sub-stack): runs the **code=data** θ-walk. It ignores the recon
  as *content*, builds the genome's code-field, and walks θ to bar=4 — the θ's have advanced from their
  seed to `[0.97, 2.21, 4.38]`. Returns the lensed code (energy **9.84** — sparse generator-impulses, a
  *different modality* than the trapped image).

**Result.** The energy story is honest: 62.83 (image) → 62.84 (hologram, conserved) → 62.84 (recon,
conserved) → **9.84 (code)**. The drop is **not loss** — it is the perception *switching what it looks
at*, from the trapped image to the genome's own evolving code. This is the meta-circle, literal: the
input was a world image; the output is the genome evolving **itself**.

---

## 5. Ops entering the reduce — flipping occlusion / warp / mask ON

**Setup:** same input blob, self mode, varying the spec gains to arm each op; log which GPU primitives
fire (= which ops did work) and which `ctx` keys appear.

**Measured (`trace_stack_ops.mjs`), front-of-stack ops + ctx written:**

| Config | First ops in the reduce | `ctx` written | output energy |
|---|---|---|---|
| **A. baseline** | `stepEyeN(8,+)` → `stepEyeN(8,−)` → [self θ-walk] | hologram, recon, selfRules | 9.84 |
| **B. + occlusion** | `stepEyeN(8,+)` → **`applyEyeHologram(OCC)`** → `stepEyeN(8,−)` | hologram, recon, **occluded**, selfRules | **42.20** |
| **C. + code warp** | `stepEyeN(8,+)` → **`ifsWarpEye(WARP 3 maps)`** → `stepEyeN(8,−)` | hologram, recon, **codeWarped**, selfRules | 9.84 |
| **D. + code mask** | `stepEyeN(8,+)` → **`bindEyeField(MASK)`** → `stepEyeN(8,−)` | hologram, recon, **codeMasked**, selfRules | 9.84 |
| **E. all on** | `stepEyeN(8,+)` → `applyEyeHologram(OCC)` → `ifsWarpEye(WARP)` → `bindEyeField(MASK)` → `stepEyeN(8,−)` | all six intermediates | 42.20 |

**Result.**

1. **Ops compose by *entering the sequence*, not by branching.** Flipping a gain 0→>0 makes that op do
   work (vs identity) — it slots into the `reduce` at its fixed position. The runner never changes;
   only which ops are non-identity changes.
2. **Order is fixed by the stack definition; content by the gains.** The sequence is always
   `hologram → [occlude] → [warp] → [mask] → recon → perceive`. Each bracketed op is identity when its
   gain is 0 (no GPU call), active when armed. The composition is *declarative* — `makeTrapStack` lists
   the order once; the gains decide participation.
3. **Each op publishes exactly one named `ctx` intermediate** — the `ctx written` line grows by exactly
   the ops that fired. That is why EYE ◀/▸ and the side panels can display any intermediate without the
   runner knowing their names.
4. **The physics composes too** — occlusion changes the output energy (9.84→42.20): the occluded path
   reconstructs a *different, partially-damaged* field, which the self-perception then reads
   differently. The ops genuinely transform the field that flows downstream; they do not merely log.

---

## 6. The SEL op differs per mode (recall / coevolve / self / pass)

`makePerception(mode) = composeLens(SEL-op, opGeometryLens)`. The SEL op runs first, writes its
decision to `ctx`, then `opGeometryLens` runs the genome that `ctx` now points to. Each mode plugs a
**different SEL op** into the same slot.

**Measured (`trace_modes.mjs`):**

| mode | SEL op | first GPU op | `ctx` the SEL wrote | what the lens then runs |
|---|---|---|---|---|
| **pass** | none | `linOp` | (nothing) | `activeRank` genome, depth 1 |
| **clock** | none | `linOp` | (nothing) | `activeRank` genome, recursive-clock depth |
| **recall** | `opRecall` | **`bindEyeField`** ([H] correlate) | **selectedRank=3, recallScores=[4]** | the *recalled* genome (rank 3) |
| **coevolve** | `opCoevolve` | `linOp` (peak-chase) | **replicaRules=[3 maps]** | the *refined replica* genome |
| **self** | `opSelfEvolve` | `linOp` (θ-walk) | **selfRules=[3 maps]** | (none — self IS the evolution) |

- **`recall`** is fundamentally different: its first ops are **4× `bindEyeField + stepEyeN(+) +
  stepEyeN(−)`** — the **matched-filter [H] correlation** of the cue against each of the 4 bank
  genomes (bind the cue against each stored genome, round-trip-propagate to score). It picks the winner
  → `ctx.selectedRank=3`, then the normal `linOp` lens runs on the *recalled* genome. Recall =
  **content-addressable select-then-run**: the cue chooses *which* genome, the lens runs it.
- **`coevolve`** does no correlation; it is a long `linOp + stepEyeN` peak-chase loop — shine the
  source through a trial genome, find the brightest peak, migrate each map's `(tx,ty)` toward it,
  repeat — refining a **replica** genome to match the source. It writes `ctx.replicaRules`. Then the
  lens runs *that replica*. Coevolve = **adapt-a-model-to-a-source-then-run**.
- **`self`** is the θ-walk; it writes `ctx.selfRules` and returns the code-field directly (no
  geometry-lens after — self *is* the geometry evolution).

**Result.** All four are the same composition `composeLens(SEL, lens)` — they differ *only* in which
SEL op fills the slot, and the SEL op communicates with the lens **only through ctx**. The lens does
not know how the genome was chosen (correlate / adapt / walk / nothing) — it just reads the rules `ctx`
points to. The SEL ops are **interchangeable plugins** coordinating purely via `ctx` keys: you can swap
*how the genome is decided* without touching *how it is run*. Recall's distinctive `bindEyeField`
signature confirms it is the only mode doing field-product **computation** up front — the same §7.90
binding seen elsewhere as the code-mask, here in a **recognition** role (`gate = bind(op:mask)`;
`recognize = bind(op:conj)` — one binding operator, role selected by use).

---

## 7. Content-addressing is real (recall verification)

**Test:** build the recall **cue** from each bank genome k in turn → `opRecall` should select genome k.
Faithful stub: `bindEyeField` = the complex product ψ·B (the [H] bind); the round-trip transport is
exact-inverse (so the integrated correlation the score reads survives). This runs the *exact* score
`opRecall` computes: `|Σ cue·conj(gₖ)| / √(ecue·eₖ)`.

**Measured (`test_recall_content.mjs`):**

```
cue from genome 0 (4 maps) → selected 0  ✓   scores=[▸1.000 0.569 0.836 0.733]
cue from genome 1 (3 maps) → selected 1  ✓   scores=[0.569 ▸1.000 0.582 0.332]
cue from genome 2 (3 maps) → selected 2  ✓   scores=[0.836 0.582 ▸1.000 0.684]
cue from genome 3 (2 maps) → selected 3  ✓   scores=[0.733 0.332 0.684 ▸1.000]

CONTROL — noise cue (no genome): scores=[0.004 0.006 0.008 0.026] → max 0.026
```

**Result.**

1. **Self-match is perfect (1.000) on the diagonal** — when the cue is genome k, the matched filter
   against stored genome k peaks at exactly 1.0. The selection is driven by *which genome the cue
   resembles*, not fixed or random.
2. **Off-diagonal scores are graded and meaningful** — genome 0 vs 2 = 0.836 (shared structure),
   genome 1 vs 3 = 0.332 (dissimilar). The correlation measures real **similarity**, a graded
   recognition, not a binary hit.
3. **The control proves it is the cue, not the medium** — a structureless **noise cue** scores
   0.004–0.026 against *all four* (≈ zero). Only a probe carrying a genome's footprint selects that
   genome.

So `opRecall` is the §9 **content-addressable select** — Hopfield-style associative memory realized as
a soliton matched filter, peer-pure (`f(cue)` only): feed a different cue → it picks a different genome,
deterministically, by similarity. The same `bindEyeField` field-product seen as the code-mask (gating)
appears here in the *recognition* role — one binding operator, role selected by use.

---

## 8. How the code influences the image — optics vs content vs operator

The genome is code; the image is content. There are three measured ways the code influences the image,
in increasing depth.

### 8.1 As optics (the phase plate) — a weak modulation

By default the genome enters the image recon only as the phase plate (focus/shear about the genome's
fixed points). Measured (vary only the genome, reconstruct the same cross, rel-L2 of the recon change):

```
+Δθ=1.0 on map0  (plate β/shear):    0.0103
+Δs=0.3 on map0  (plate a/focus):    0.1132
+Δtx,ty on map0  (plate centres):    0.0027
CONTROL same genome twice:           0.0000   (deterministic, no hidden state)
DIFFERENT image, same genome:        1.0744   (image content dominates)
```

**Result.** As optics, the code influences the image **weakly** — `s` (focus) most (~0.11), `θ` (shear)
~0.01, position ~0.003 — all dwarfed by the image content itself (~1.07). The genome *refocuses /
shears / re-centres* the image; it does not rewrite it. The code is "the optics the image is viewed
through," and a gentle one.

### 8.2 As content (the §7.90 binding gate, in-medium)

`opCodeMask` multiplies the reconstructed image by the genome's field via `gpu.bindEyeField` (the GLSL
complex product — **the medium does the multiply, not a CPU loop**). Where the code has footprint,
image content passes; elsewhere it is suppressed. Measured (uniform image, gain 0→1):

```
gain=0 (off): energy 4096  (identity — image untouched)
gain=1 (on):  energy 39    (content suppressed where the code is absent)
Δθ mutation → content change 0.20    Δtx → 0.25    CONTROL same code twice 0.00
```

**Result.** This carves *which* image content survives — content-level, ~2–80× stronger than the optics
path, and a *qualitatively different* effect (optics bends focus; the gate carves content). The gate
footprint is built from the genome's fixed points spread across the whole grid (broad Gaussians), so a
moderate gain dims-where-absent rather than collapsing the image to bare blobs (a bug found and fixed:
the original footprint used the corner generator region, which nuked everything outside it).

### 8.3 As a geometric operator (the IFS warp) — the deepest

`opCodeWarp` executes the genome as an actual **coordinate transformation** of the image, via
`gpu.ifsWarpEye` (the §7.97 metric resample). The genome's `{s,θ,tx,ty}` *is* an affine map; mutating
the code rotates/scales/translates the image. Measured (warp the cross through the genome):

```
+Δθ=45°  → content change 1.328   (image ROTATES, spread 18.6→20.5)
+Δs      → content change 0.435   (image SCALES, spread 18.6→15.1)
+Δtx     → content change 1.023   (image TRANSLATES, centroid 32.7→38.7)
CONTROL same code twice  0.000
```

The full K-map version is the **Hutchinson operator** `W(image) = combine_k fₖ(image)`: each of the K
maps warps a copy of the image. Iterating W contracts toward the genome's attractor (measured:
576→361→…→36 bright pixels — the defining IFS contraction, drawing the fractal *by warping the image*).

**Result — the "data=code" answer.** The genome can act on the image as a genuine geometric operator,
**in the medium's own terms** (`affineEyeCenters` — a coordinate resample, no JS painting), with a
clean 0 control. This is the §7.97 self-hosting metric form — *the operator is the transformation of the
space.* It is the most profound of the three: not a picture injected, but a coordinate map executed by
the medium's own GPU operator. (See §6 for the honesty fixes applied to the combination rule and the
resampling.)

---

## 9. The geometric operator — honesty audit and fixes

The K-map IFS warp necessarily uses the metric/affine path (a geometric transform of an extended image
needs the resample; a phase tilt cannot rotate/scale). Two honesty fixes were applied so it conforms to
wave physics as closely as possible.

### 9.1 Combination rule: max-magnitude → complex superposition

The original union kept the **brightest** of the K warped copies per pixel — an IFS-attractor
*rendering* convention, not wave physics. A true linear medium **superposes** (adds complex amplitudes,
with interference). Changed to `ψ' = (1/√K)·Σₖ fₖ(ψ)`.

**Verified:**

```
K=1 identity maps, centre amp = 1.000   (√1)
K=2 identity maps, centre amp = 1.414   (√2 — constructive interference)
K=4 identity maps, centre amp = 2.000   (√4)
2 identity maps = 1.414  vs  max-union would give 1.000   (it is a linear complex SUM, not a max)
CONTROL same code twice = 0.000
```

The K warped wavefronts now **interfere** — constructive and destructive fringes where copies overlap,
exactly as wavefronts combine in a linear medium. Since each map's θ rotates the phase too, the fringe
pattern shifts as `rot θ` is dialed.

### 9.2 Resample: bilinear → bicubic (Catmull-Rom)

The metric remap interpolates (the pre-image coordinate rarely lands on a grid cell). Bilinear is a
low-pass filter — it smooths and is **not unitary** (energy isn't exactly conserved; warp-then-unwarp
isn't bit-perfect). This is the "geometric-optics idealization": the metric op *declares* "the value
here is now there" by a coordinate map (the ray/geometric-optics picture), executed with finite-grid
interpolation — as opposed to the wave-honest `stepEyeN`, where energy moves because the wave equation
evolves it.

Switched to Catmull-Rom bicubic (a 4×4 cubic kernel). **Verified energy round-trip** (non-integer
shift-and-back on a smooth field):

```
bilinear round-trip:  99.0% energy retained
bicubic  round-trip: 100.0% energy retained
edge sharpness: bicubic preserves high-frequency detail (cubic negative lobes counteract the blur)
```

The non-unitarity caveat is now negligible for the smooth soliton field. Cost: 16 texel fetches/map vs
4 (left the single-map metric lens and the rotate-shader on bilinear, as they are lighter and single-map).

**Result.** The geometric operator does **not** break the medium concept. The **phase lens** (§3) is a
genuinely pure, unitary, self-readable circular medium. The **metric warp** is the proven §7.97
self-hosting coordinate-transform — honest *as a metric* — now with near-zero numerical loss (bicubic)
and a true wave-combine (complex superposition). The remaining distinction is real but benign: phase = a
*dynamical* unitary operator; metric = an instantaneous *coordinate* transform (geometric-optics
idealization). Both are legitimate operators on the same field type.

---

## 10. Occlusion across all modalities — terminate and resurrect

Occlusion (`H=OCCL`, the `gpu.applyEyeHologram` primitive from the original holographic eye) is a
**uniform medium property** (`ctx.occ`) that damages **every wavefront**, not just the image — because
in this medium the *program* (genome) is also a wavefront (code=data).

- **Image modality** — `opOcclude` damages the spread hologram between `opHologram` and `opRecon`. At
  high `holoT` the info is delocalized (every region carries the whole), so damage **dims** rather than
  erases — the honest holographic-robustness test.
- **Program modality** — the occlusion also damages the recall **cue** + injected bank genomes
  (recognition input) and the self **code-field**. A genome map whose code is destroyed (energy at its
  centre below threshold) **terminates**: its contribution collapses (amplitude decays toward 0), so it
  *drops out* of the glyph and attractor — it does not freeze in place looking alive. A clean per-bar
  re-derivation (the program is present again) **resurrects** it.

The damage is holographic too (`occludeHolographic`): the code is spread by `holoT` *before* occlusion,
so **higher holoT lets the program survive bigger occlusions and resurrect better** (verified monotone
via a relaxing kill-threshold `0.25·e^{−T/8}`, so the direction holds regardless of recon fidelity). The
cycle is per-bar / peer-pure: damage rides `seed = f(bar)`, so it is deterministic and re-derives clean
each bar.

**Honesty notes recorded during development:** the dead-map "corpse dots" (the collapsed fixed points of
terminated maps) are **physically real** and are deliberately *shown*, not filtered — hiding them would
be the dishonest move. Full extinction (all maps dead) renders an empty panel ("⚰ PROGRAM TERMINATED"),
not the skeleton dots a degenerate `s≈0` IFS would otherwise plot.

---

## 11. Self-evolution grows the genome — in the medium

Self mode can **grow new maps** — not via a JS button, but by the medium reading its own evolved field
(`growMapFromField`, the §7.88 writable-operator-atlas, the inverse of the occlusion kill). During the
θ-walk, the medium peak-detects its *own deep-lensed code-field*; if a strong peak forms **away from the
existing fixed points** (the IFS dynamics grew a new satellite), it reads that peak into a new
`{s,θ,tx,ty}` map and appends it. It is the inverse of `nlhoGenInject` — a genuine read-back, no
JS-invented map.

**Honest findings:**

- An IFS is **contractive** — energy clusters at the fixed points, so the *single-pass* code-field
  stays tight (far-peak ≈ 0%) and growth could never fire from it. The fix reads the **accumulated
  deep-lensed field** (~18 passes — what the dynamics actually *run out to*, the attractor's spread),
  where emergent satellites reach ~16% of max. Growth only fires when real structure emerges; a
  genome that stays tight births nothing (correct — no fake maps).
- A **performance cliff** was found and fixed: the grow probe (a fresh code-field + 18 lens passes +
  full-grid scan) was running *inside* the per-iteration loop (~150×/re-derivation = thousands of GPU
  passes = a freeze). Moved out of the loop, bounded to ≤4 births/re-derivation: cost dropped from
  ~2700 extra passes to ≤72.

Verified: growMax=5 → 1 born, growMax=8 → 2 born, peer-pure, clamped at the ceiling.

---

## 12. The genome reaches pass/clock — preview, commit, observe

Self mode grows the genome into `ctx.selfRules`, but pass/clock read the bank — so the grown genome was
initially trapped in self mode. Now the meta-circle closes:

- **Auto-use (live preview):** the latest self-evolved genome is published to `_evolved`;
  `_activeGenome` makes pass/clock **run it automatically** (precedence: recall-selected → `_evolved` →
  bank). Evolve in self → switch to pass → the living soliton *is* the evolved genome.
- **Commit (durable):** `⇪commit` writes `_evolved` into the bank (replicated via `setGenome`, so peers
  commit identically; `_evolved` is peer-pure `f(bar)` so the committed maps are byte-identical).
  `⊘revert` drops the preview.
- **Observe:** the `rank` button shows the *active* genome's real K and an evolved flag —
  `rank 1·K3▸` (bank), `rank 1·K7✎▸` (running a grown K=7, `✎` = evolved preview), `rank 2·K3▸` (back
  to bank). Cycling `rank` clears `_evolved` (it means "use this bank slot"), which is why it "resets K"
  — not a cap, a reset to the bank.

The lens reads the genome's **aggregate** geometry (dominant θ, mean s — one shared `genomeAggregate`
definition used by both the lens internals and the UI `⊕base` seed, so the sliders show what the lens
applies). The sliders are **absolute** (the slider value *is* the lens parameter; the genome supplies
the fixed-point centres). `⊕base` seeds the lens sliders from the genome; `⊕op` arms the IFS operator
from the genome (full DOF, copies=K); `↺reset` resets only the lens params (not the code operators).

---

## 13. Peer determinism — every control replicated, hashes to verify

The medium is peer-deterministic by construction (every op keys off `ctx.bar`/`ctx.phaseT`). The eye UI
was found to be **local/optimistic** (it mutated `_eyeLensP`/`_S.eye` directly and never injected —
scaffolded as "testing"), so the eye could not be tested for cross-peer determinism. It was refactored
to the full KWE contract:

- Added `eye*` world-state (mirror of `med*`) + `setEye`/`setShared`/`setGenome` reducers (pure,
  clamped) in `hologram_world.js`.
- **Every eye control now injects a replicated event** — lens sliders, occlusion, code mask/warp, warp
  DOFs, optics, growth, commit/revert. No local mutation remains; state updates only when reflected
  back from the world model (the sender reads its own change from the reflector → both peers stay
  byte-identical).

Three FNV-1a digests in the header verify byte-match across peers:

- **`stateH`** — the replicated control state (med* + eye* + genome). Matches if the reducers stayed in
  sync.
- **`medH`** — the medium ψ_out field (computed every frame, both scopes) — the medium-physics
  byte-match.
- **`eyeH`** — the eye recon field (eye scope) — the trap-physics byte-match.

**Verified** (simulating two peers applying the same event stream): byte-identical world state, with
clamping. If `stateH` matches but `medH`/`eyeH` diverge, the divergence is in physics/GPU, not control
replication — which narrows any hunt. (`_uiScope` — which lens you are *viewing* — stays local and
correctly should: each peer can look at a different lens while both compute identical physics.)

---

## 14. World lens vs wavefront-with-lens — objects that ARE lenses, and recall on the operator

The resonance demos (`obj:hidden` / `tight` / `mixed`, walked through in
[`medium-app-demo.md`](medium-app-demo.md) §11) turn on a distinction that is worth stating plainly,
because it is what makes recall on the *operator* (not just on an image) possible.

### 14.1 Two readings of "an object through a lens"

- **A wavefront *from* a world lens.** The lens is a fixed optical element; light shines through it; the
  object is the **image that comes out**. The eye receives the *product* — the object already lensed — and
  the lens itself is gone. Only its effect on the image survives. This is the ordinary `obj:cube` →
  `ψ_out` path: the world lens acts, and the eye sees the result.

- **A wavefront *with* a world lens.** The lens — the genome — is **carried inside the wavefront itself**.
  The object *is* a lens: its phase structure encodes the genome that generated it. The eye receives a
  field that **contains its own generating operator**. This is the hidden cloud: `cloud = packet × (genome
  phase plate)⁶`. The genome is not applied-and-discarded; it is woven into the phase, recoverable.

The difference is not cosmetic. A "wavefront-from-lens" image is a **terminal** value — you can match its
pixels, but there is no operator left in it to recognize. A "wavefront-with-lens" carries the operator as
field structure, so it can be **read back, re-applied, composed, or evolved**. The hidden cloud is the
second kind by construction.

### 14.2 Why this is exactly what makes recall possible

Recall in this medium is the §9 / §7.90 matched filter: bind the cue against each stored signature
(`bindEyeField` complex product) and `argmax`. That operation only means anything if there is an operator
*in the field* to correlate against. Three consequences:

1. **The input is content-addressable by geometry.** The eye matches the incoming wavefront against the
   genomes' **lensed signatures** (a packet through each genome's lens — the same representation as the
   cloud). A delensed image has no operator to match; impulse-templates score 0 (measured). The lens being
   *in* the field, on both sides of the correlation, is what gives a non-trivial score.

2. **Recall becomes "recognize which lens generated this," not "find the nearest picture."** `argmax`
   returns a **generator**, not a stored image. `obj:mixed` makes the point sharp: project the field onto a
   genome's signature and the component generated by *that* lens comes out (~0.97–1.0 for a present lens,
   ~0.003 for an absent one — measured ~250× selectivity). The eye recalls an operator and can then *run*
   it (`recall`) or *evolve* it (`recall→self`).

3. **Composition stays in the medium.** Because a recalled lens is a field-object of the same type as its
   output, it can be applied again, bound against another (`bindEyeField`), or stacked — the "optical chip"
   property. A terminal image cannot do this.

### 14.3 The honest qualifier — which lenses self-host

This does not grant free self-readability to *every* operator. The readback law (§3, and the project's
collision/metric work) stands: a **metric / phase** lens — a transformation of the space — self-hosts and
is recallable; a co-located **nonlinear-collision** operator is real but not self-readable. The hidden
demos use the **phase** lens (`op:phase`), which is the self-readable kind, and that is *why* recall works
there. And the recall recognizes *which known lens* from the fixed bank, not an arbitrary unknown one;
reading out a never-seen operator is the deeper `nlhoReadGenerator` peak-detect → regrow path, not the
matched filter.

So the precise statement the demos establish: **world objects can BE lenses — the wavefront carries its
own generating operator — and that is what makes the eye's recall a recall of the operator: recognizing,
re-running, and evolving the lens that lives inside the incoming wavefront, not merely matching a delensed
image.** It is the meta-circle ("the medium reads and evolves its own operator") expressed at the level
of the eye's input.

---

## 15. The instanton — a measured negative, then the native form

A **soliton** is localized in space and persistent in time; an **instanton** is localized in space *and
time* — a transient that flashes between two vacua and leaves a changed state. The medium already has the
vacuum: a purely contractive genome (`s<1`) collapses any wavefront to the **IFS attractor**, and stays
there. The question was how to create the transient natively. Two genome-based mechanisms were proposed
(a "rogue map" expansion and a `linOp` "phase tear"); both were **probed first** — and both **fail in this
substrate**. The propagation-kick form works. All measured (faithful CPU reimplementations of the real
operators — `tanh` Hutchinson, complex IFS warp, `linOp` vortex, the leapfrog step).

### 15.1 Rogue-map flash — does not erupt (measured)

Inject an expansive map (`s>1`) into the genome for one bar. **Measured spread ×1.00** across every regime
(append / replace / suppress-base, `s` from 0.06 to 3.0, shear, weights to 3×):

```
append rogue s=1.6 w=1:   spread ×1.00  energy ×1.01   (no eruption)
REPLACE single rogue s=3: spread ×1.00  energy ×0.58   (no eruption)
SUPPRESS base + rogue:    spread ×1.00  energy ×0.99   (no eruption)
```

**Why.** The Hutchinson step reads **pre-images** `fᵢ⁻¹(x)=(x−t)/s`, so an *expansive* forward map is a
*contractive read* — the "energy explodes outward" intuition is backwards for an inverse-map formulation.
And the `tanh` saturation pins amplitude while the IFS attractor is a *strong* fixed point (it converges
from any input — that is what an IFS is). One bar of a rogue ruleset is snapped right back; the vacuum is
too rigid to flash from a genome edit.

### 15.2 linOp phase tear — no hole, and unstable (measured)

A π-vortex `linOp` at a structural node, then a complex IFS-warp union to let overlapping sub-images
destructively interfere. **Measured: node energy ×1.34 (rose, no hole); the "heal" warps blew up ×146.**
The complex superposition warp has **no amplitude saturation** (unlike the real `tanh` path), so it is not
contractive — it grows without bound. The two requirements (complex phase for the tear, contraction for
the heal) live in *different, incompatible* operators here.

### 15.3 The propagation kick — the native instanton (measured, works)

The eruption must come from the **propagation operator** (`stepEyeN`, the real wave dynamics), not a
genome edit. Add a strong localized complex spike to the living soliton at a deterministic bar; the
existing drive toward the attractor is the vacuum restoration. Measured (local peak amplitude, the right
observable for a localized defect — the global centroid barely moves):

```
kick amp  2: peak ×3.0 vac → decays 3.0→2.5→2.1→1.8→1.6→1.4→… → settles corr-to-vacuum 1.000
kick amp  5: peak ×6.0 vac → decays 6.0→4.8→3.8→3.1→…          → settles corr-to-vacuum 1.000
kick amp 12: peak ×13  vac → decays 13→10→7.7→6.0→4.6→…        → settles corr-to-vacuum 1.000
```

It is a genuine **time-localized flash**: the local peak spikes ×N, decays smoothly over its lifetime, and
the field returns to the vacuum (corr → 1.000). That is the instanton signature, and it is peer-pure (the
kick is `f(bar)`).

### 15.4 Reconstruct-peak — and why most versions of it are a trap

The proposal's sharpest claim: let the instanton disperse, then back-propagate (`stepEyeN(−dt)`) to
reconstruct the peak. This went through **three versions**, two of them wrong, and the failures are the
instructive part — a reconstruct test is only meaningful if it **passes a control**.

- **v1 — back-propagate the LIVE field by an elapsed-bar window.** Gave corr ~0.14. Looked like a failure;
  was dismissed as a bug.
- **v2 — "self-contained": disperse the peak snapshot by pure propagation `+T`, back-propagate `−T`,
  correlate.** Gave a clean `T8:1.000 T16:1.000 T32:1.000`. *Looked* like a triumph. **It is a trap.** The
  leapfrog `step(−dt)` is the exact algebraic inverse of `step(+dt)`, so this round-trip is **identically
  the identity** — `A⁻¹A = I` — for *any* input. The **control proves it**: a pure-noise field also
  round-trips to 1.0000. The number measures "is the integrator reversible," not "can the medium
  reconstruct the instanton." A 1.000 with no discriminating control means nothing.
- **v3 — the honest answer.** The only thing the instanton passes through that is *irreversible* is the
  soliton **drive** (`stepRecord` = propagate **+ inject toward the vacuum**). Back-propagating the **live**
  driven field is therefore the real test — and it is **LOW** (~0.1–0.3). That low number is not a failure:
  **the vacuum-restoration drive being irreversible is exactly what makes the instanton a one-way
  transient.** Low *is* the physics. The UI shows it alongside a labelled **control** (the v2 pure-wave
  round-trip, ≈1.0) so the trivial 1.0 is never mistaken for a reconstruction.

So v1's 0.14 was the honest number all along; v2 replaced it with an impressive-looking artifact. The
corrected statement: **the wave propagation is reversible (round-trips exactly, but that is trivial), while
the medium's dissipative vacuum-return is irreversible — and that irreversibility is the instanton's
defining property, not a reconstruction failure.** Time's arrow lives in the drive, not the propagation.

Methodology (the recurring lesson, here twice in one feature): **a reconstruct/round-trip number is
meaningless until a control shows it can come out *different*.** A noise control turning the impressive
1.000 into "trivial identity" is what caught v2. Trust the number only after the control fires.

### 15.5 What shipped

A `⚡kick` control (both scopes) fires the propagation kick into the active soliton at the next bar
(replicated via `setShared` → `instBar`/`instVer` → both peers kick the same bar); `⚡amp` sets the
strength; `⚡hold` sustains it for N bars so the erupt→collapse is *visible* (0 = the honest single
transient); `↩recon` reports the **live** back-propagation (~0.1–0.3, the real answer — the drive is
irreversible) next to a labelled pure-wave **control** (≈1.0, trivial; shown so it isn't mistaken for a
reconstruction). The header shows the live `bar` count; the label walks the cycle (`armed … fires in Nb` →
`fired barN (+Nb)` → recon readout). The two genome-based mechanisms were **not** shipped — they don't fire. This is the same substrate-conformance discipline the
rest of this document follows: an idea that is right in a CGLE framing can hit a wall in the IFS framing,
and the probe is what tells them apart **before** any code is wired.

### 15.6 The instanton as a USABLE state transition — tunnelling between attractors

The instanton's semantic value: a reversible playback-machine has no genuine "now" — any state can be
rewound, so it can't *commit*. An instanton is an **irreversible event** that consumes state, which lets the
medium do what reversible dynamics can't: **escape its attractor and switch to another one**. The vacuum
is a *strong* basin (an IFS converges from any input), so a reversible nudge slides back; an instanton is
the move that carries the field over the barrier. That makes the attractors the **states** of a machine and
the instantons the **transitions**.

Shipped as `⚡tunnel:A→B`: when armed, the `⚡kick` becomes a committed A→B jump. B = (medium rank)+1
(wrapped); the kick is **shaped toward B's attractor** (carries the field across), and after the fire the
medium's **source + lens locally retarget to genome B** so the world soliton settles into B's attractor and
**stays**. Verified live (browser; the CPU probe can't model the saturated attractor — same artifact class
as the resonance work, so the screen is the instrument):

```
bar 2  armed   medH 942de650  square (rank 0)        the vacuum, before fire
bar 4  fired   medH 942de650  A 53%→ B 0%  crossing  just kicked, not arrived
bar 6  +2b     medH b686fdf4  A 53%→ B 100% LANDED   the field is now the triangle (rank 1)
```

The **medH changes** (942de650 → b686fdf4) — the medium field genuinely transitioned, not a display
trick; the canvas morphs square → triangle and holds. The crossing takes **~2 bars** (the drive converging
to B), so a `+0b` low-B reads "crossing…", not "failed". `⚡tunnel:off` ships **both** modes: the plain
transient (kick-only, returns to A — shows the barrier) vs the committed jump.

**Peer-determinism, the KWE arc (the constraint):** the *arm* is replicated (a UI press → `setShared`),
but the *transition runs locally with no per-frame reflector exchange* — B is derived locally from the
already-replicated rank (`+1` is a pure function), the fire bar is the shared clock, and the medium tunnel
fires scope-independently (outside the eye/medium view split). So both peers compute the identical jump
from identical inputs and `medH` stays byte-matched. **Replicate the decision; derive the dynamics** — the
same pattern as the soliton drive, applied to an irreversible event.

Two measurement traps caught here (both by the user's screenshots, both the same lesson): (1) the landing
read must use the **lensed reference** (same representation as the live field) and exclude the held-kick
**injection artifact** — raw `nlhoGenInject` impulses read 0 against the propagated field, and a held kick
makes the field *look* like B by brute injection (a false "100%"); (2) **don't conclude from a partial
snapshot** — a late frame showed `medH` unchanged and "mid-barrier", which I wrongly read as "broken"; the
full bar-by-bar sequence showed `medH` *does* change and the jump *does* commit. The trajectory is the
evidence, not any single frame.

Honest scope: the transition is deterministic (`f(bar)`), so it doesn't yet produce *non-replayable*
novelty; it demonstrates the **mechanism** (irreversible state-switch) usable as a state-machine transition,
not yet a source of true branching. A committed tunnel **stays committed** across a subsequent plain kick
(a Gaussian transient fires on top of B without snapping back to A) — the jump is durable until re-tunnelled.

---

## 16. Summary — the medium concept, intact

- **One composition primitive** (`composeLens` = a `reduce` of field-operators), untyped runner,
  trap-from-ordering, state threaded through `ctx`. Closed under composition (stacks nest, self-host)
  and pure in clock-time (peer-deterministic).
- **Two physical operators** — the wave propagator (`stepEyeN`, the real near-unitary medium) and the
  genome phase-plate (`linOp`), composed. The geometric warp adds the §7.97 metric coordinate-transform
  for true rotate/scale, with complex superposition + bicubic for wave-honesty.
- **The genome is operator and data** — image, lens, and geometric operator at once. The medium reads,
  evolves, occludes, grows, and recalls *its own operator* — the meta-circle, measured.
- **Honesty maintained throughout** — degenerate looks are real signals; the phase lens is a pure
  circular medium; the metric warp is the proven self-hosting form with its numerical caveat driven to
  negligible; corpse dots and IFS speckle are shown, not masked; every control is a replicated event.

---

## Tracer scripts

Produced the traces above (scratchpad; reproduce with `node`). Each wraps the **real**
`makeTrapStack` / `makePerception` / `opRecall` / `opCodeWarp` and intercepts only the GPU calls to
observe — the physics is the production code.

- `trace_self_stack.mjs` — §4, a field + ctx through the self trap.
- `trace_stack_ops.mjs` — §5, ops entering the reduce (occlusion/warp/mask).
- `trace_modes.mjs` — §6, the SEL op per mode (pass/clock/recall/coevolve/self).
- `test_recall_content.mjs` — §7, content-addressing verification.
- `code_influences_image.mjs`, `code_as_operator.mjs` — §8, optics vs content vs operator.
- `trace_recon.mjs` — §2, the two physical operators classified.
- `probe_instanton.mjs`, `probe_instanton2.mjs`, `probe_kick_instanton.mjs` — §15, the instanton
  investigation (rogue-map ✗, phase-tear ✗, propagation-kick ✓, reconstruct graded).
