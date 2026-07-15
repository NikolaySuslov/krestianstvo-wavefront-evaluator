# The Medium Demo App (`medium.js`) — Full Walkthrough

`public/apps/medium.js` is the concentrated demonstration of the meta-circular wavefront medium. It is
a **thin consumer**: all the physics lives in `soliton-algebra.js` (the lens-stack algebra) and
`ifs-gpu.js` (the GPU substrate); `medium.js` wires those into an interactive, peer-deterministic app
with two lenses (the **world** and the **eye**), a live genome, and the controls to drive them.

This document explains what the app *is*, what it *does*, and how its parts — the genome, the medium
world, and the eye — fit together. For the underlying algebra and the measured traces, see
[`native-ifs-medium.md`](native-ifs-medium.md).

---

## 1. The picture in one paragraph

The **world** is a meta-circular lens that transforms a wavefront at its source. There is one spatial
operator — `linOp = content·e^{iφ}`, the genome's affine maps acting as an optical chip — shone through
itself recursively. A **genome** (a small Iterated Function System) is at once the *image*, the *lens*,
and the *geometric operator*. The **eye** is a trap that catches the living world soliton, lifts it
into a holographic reconstruction (its own replica of the world), and perceives within it — running the
*same* genome modes on its recon. Because the eye operates on a lifted copy of the world using the same
operator the world uses, **the medium operates on the medium** — the meta-circle. Everything is a pure
function of the IFS clock, so two peers compute byte-identical fields.

The app shows **two canvases** at a time:
- **Medium scope:** `ψ_in` (the live source soliton) and `ψ_out` (the source through the world lens).
- **Eye scope:** `EYE ◀` (the held hologram) and `EYE ▸` (the reconstruction the eye perceives).
- In `self`-like modes a third row appears: the genome's **code glyph** and its **chaos-game
  attractor** — the meta-circle made visible (rule → generator → attractor → wave → rule).

---

## 2. The genome — the heart of everything

A genome is a list of K **affine maps**, each `{ s, θ, tx, ty }`:

- `s` — the contraction ratio (how much the map shrinks).
- `θ` — the rotation angle.
- `tx, ty` — the translation (normalized 0..1).

The default bank (`nlhoDefaultRules()`) holds **four genomes** of sizes 4 / 3 / 3 / 2 maps. The `rank`
button cycles which one is active.

### 2.1 The genome's triple identity

The single most important idea: the same `{s,θ,tx,ty}ᴷ` plays **three roles**, and the app lets you see
and drive each:

1. **As an image** — `nlhoGenInject` paints the genome as generator-impulses (a bright main + a
   θ-satellite per fixed point) into the field. This is the genome *as content* — what you see when
   the genome is shone through a lens, or the cue/program in recall.
2. **As an optical element (the lens)** — `makeGenomeLens` builds a phase plate `e^{iφ}` from the
   genome: quadratic focus `a=(1−s)·0.06`, shear `β=θ·0.04`, centred on the genome's fixed points. The
   field passing through is bent by the genome's geometry. This is the genome *as the lens*.
3. **As a geometric operator** — the genome's affine maps *are* a coordinate transformation. Run as an
   IFS (the Hutchinson operator), they rotate/scale/translate the image, and iterated, contract toward
   the genome's attractor (a fractal). This is the genome *as the operator* (the `⊕op` / `code⟳op`
   path in the eye).

### 2.2 The genome's geometry: fixed points

Each map's **fixed point** is `fp = t/(1−s)` — the point the map contracts toward. The K fixed points
laid out on the grid are the genome's *centres*: the lens plates sit on them, the satellites anchor to
them, and the chaos-game attractor lives among them. `genomeFpCenters` computes these pixel centres;
`genomeAggregate` reduces the K maps to a single characteristic geometry (dominant θ = the map with the
largest |θ|; mean s) — the value the lens uses globally and the `⊕base` button seeds onto the sliders.

### 2.3 The genome bank and the live preview

- **`_rules`** — the bank (the four default genomes), the durable store.
- **`_evolved`** — a *live preview*: when `self` mode evolves/grows a genome, it is published here, and
  pass/clock **auto-use** it (so what you evolved in self is what the world lens runs).
- **`⇪commit`** writes `_evolved` into the bank (durable; replicated so peers commit identically).
  **`⊘revert`** drops the preview. The `rank` button shows the live K and a `✎` flag when an evolved
  genome is overriding the bank (e.g. `rank 1·K7✎▸`).

---

## 3. The medium world — the source lens

In **medium scope** the app shows the world lens transforming a source object.

### 3.1 The source (`ψ_in`)

`ψ_in` is a **living soliton**: a source object propagated through the live IFS-world-clock kernel — a
persistent §7.44 limit cycle, driven each frame toward its target and stepped a clock-determined number
of times. The source object is chosen by `obj:` — one of the probe registry (cross, dot, …), the live
**rotatable 3D cube** (drag to rotate; its wavefront is the projected cube points), or the genome's own
**attractor**. In `self`-like modes `ψ_in` becomes the genome's *own code-field* (code=data — the input
is the program).

`world:active` turns on **source self-coevolution**: the world object migrates its own fixed points
toward where its lensed energy lands — the object reshaping itself at the source.

### 3.2 The world lens (`ψ_out`)

`ψ_out` is the source run through `makePerception(mode)` — the genome lens for the active mode. The five
modes are the heart of the demo:

- **`pass`** — one lens pass. The wavefront is bent once by the genome's phase plate.
- **`clock`** — the recursive lens = an **IFS clock**: iterate the lens (depth swept by the clock) →
  the field contracts toward the genome's attractor. The lens applied to its own output is the IFS.
- **`recall`** — **content-addressable**: a bar-keyed cue is correlated (the [H] matched filter) against
  the stored bank; the best match picks *which* genome to run. The label shows the per-genome scores
  and the winner (`▸`). The cue recalls its genome; the lens runs it.
- **`coevolve`** — the genome **migrates its own fixed points** toward where the lensed energy lands
  (peak-chase). The genome and the wavefront co-adapt: the model refines toward the source.
- **`self`** — **code=data**: the lens operates on its *own* genome code-field, reads θ back (the
  §7.100 complex-moment read), and writes it (the θ-walk). The genome evolves itself. `self:orbit`
  walks θ on a limit cycle (the attractor morphs); `self:contract` snaps θ to the fixed point.

### 3.3 The view toggle

`view:soliton` shows the *living* lensed soliton (the persistent limit cycle — the world as it
breathes); `view:crisp` shows the *direct* lens output (the eye-percept preview — a single clean pass,
no soliton settling).

---

## 4. The eye — the trap

Switch to **eye scope** (`ui:eye`) and the whole UI re-targets the eye's lens. The eye does not have a
source; it **traps the live world soliton** (`_psiLensed` — the medium keeps running underneath, so the
eye catches a moving wavefront, not a frozen snapshot) and reconstructs it.

### 4.1 The trap stack

`makeTrapStack(mode)` is `composeLens` of:

```
opAutofocus?  →  opHologram  →  opOcclude?  →  opCodeWarp?  →  opCodeMask?  →  opRecon  →  makePerception(mode)
```

- **`opHologram`** — propagate the trapped field *forward* by `holoT` into the diffraction domain →
  `EYE ◀` (the spread hologram). At high `holoT` the information is delocalized: every region carries
  the whole, so the record is occlusion-resistant.
- **`opOcclude?`** — damage the spread hologram (the `H=OCCL` family), if armed.
- **`opCodeWarp?` / `opCodeMask?`** — the genome acts on the wavefront before recon (see §5).
- **`opRecon`** — propagate *backward* by the matched depth → `EYE ▸` (the reconstruction). This is the
  eye's percept; the perception then runs *on it*.
- **`makePerception(mode)`** — the *same* clock/recall/self/coevolve perception body the world uses,
  now run on the eye's own recon. **This is the meta-circle**: the eye perceives its replica of the
  world with the same operator the world is.

Because the runner is untyped (just a `reduce`), **trap-vs-pass is emergent from ordering** —
recon-first makes it a trap. The world lens and the eye trap share the exact same ops; only the
arrangement differs.

### 4.2 Focus — manual and autofocus

The eye's focal plane (the recon depth) is set one of two ways:

- **`optics:off`** — the `focus` slider is a manual **rack-focus offset** from the in-focus plane
  (0 = sharp, ± = under/over-focus, defocusing the recon).
- **`optics:on`** — the eye **autofocuses**: it sweeps focal planes and keeps the one that maximizes
  percept sharpness (peak²/total energy). Memoized to run a few times per second (not every frame), and
  it walks the planes incrementally to avoid a readback storm.

### 4.3 The view toggle (eye)

`view:soliton` shows the living recon soliton (the recon driven as a persistent limit cycle);
`view:crisp` shows the direct reconstruction (the raw back-propagated field).

---

## 5. The code acts on the image — the eye's operators

These are eye-scope controls (the genome influencing the perceived image), in increasing depth:

- **`code→img` (gate, §7.90)** — the genome's field *masks* the image content via `gpu.bindEyeField`
  (the in-medium complex product). Where the code has footprint, content passes; elsewhere it is
  suppressed. Mutating the code reshapes *which* content survives.
- **`code⟳op` (the geometric operator, §7.97)** — the genome's affine maps **rotate / scale /
  translate** the image (the IFS warp, `gpu.ifsWarpEye`). The full K-map version is the Hutchinson
  operator: the K maps each warp a copy and the copies are **complex-superposed** (they interfere). The
  `warp DOF` strip isolates each geometric degree of freedom (`scale s`, `rot θ`, `transX`, `transY`) as
  0..1 fractions of the genome's value (shown as a suffix, e.g. `rot θ 1.00 ·θ4.0`), plus `copies` (how
  many of the genome's maps participate).
- **`⊕op`** arms the operator from the genome at full DOF (warp on, copies = K); **`⊕base`** seeds the
  lens phase-plate sliders from the genome; **`↺reset`** resets only the lens params (leaves the code
  operators alone).

---

## 6. Occlusion — terminate and resurrect, across all modalities

The `H=OCCL` strip (eye-only) damages the wavefront — and because the *program* (genome) is also a
wavefront here, occlusion is a **uniform medium property** that hits **every modality**:

- **Image** — damages the spread hologram (`H=LEFT` slab / `H=RZero` blocks / `H=RNois` noise; `r` =
  damaged fraction, `blk` = block px). At high `holoT` the recon survives more damage (holographic
  redundancy).
- **Program** — also damages the recall cue, the injected bank genomes, and the self code-field. A
  genome map whose code is destroyed **terminates** (its amplitude collapses → it drops out of the
  glyph/attractor as a "corpse dot" at its fixed point — physically real, shown not hidden). A clean
  per-bar re-derivation **resurrects** it. Higher `holoT` → the program survives bigger occlusions
  (the code is delocalized before damage).

The cycle is per-bar / peer-pure (the damage rides `seed = f(bar)`), so it is deterministic across
peers. Full extinction renders an empty "⚰ PROGRAM TERMINATED" panel.

---

## 7. Self-evolution and growth — `self` mode in depth

In `self`-like modes (`self`, `recall→self`) the genome evolves itself, and the four-canvas meta-circle
view appears:

- **`ψ_in`** — the genome's own code-field (code=data; the input is the program).
- **`ψ_out`** — the lensed/evolved code.
- **Code glyph** — the genome's W matrix (its phenotype as a value grid).
- **Chaos-game attractor** — the GPU full-resolution render of the evolving rule-set's IFS. As θ walks,
  the attractor morphs. Dead maps (under occlusion) drop out; grown maps add structure.

**Growth (`grow→K`):** the medium can grow *new* maps by reading its own evolved field
(`growMapFromField`). During the θ-walk it peak-detects its own deep-lensed code-field; an emergent peak
away from the existing fixed points is read into a new `{s,θ,tx,ty}` map and appended (the inverse of
inject — a genuine read-back, not a JS-invented map). An IFS is contractive, so growth only fires when
the dynamics actually throw a satellite (a tight genome births nothing — correct). The grown K shows in
the `rank` button (`K7✎`) and in the `copies` ceiling of the warp.

---

## 8. Peer determinism — the KWE contract

Everything is built to be **byte-identical across peers**:

- Every mode is `f(bar)`; the loop is clocked by `n.time` (peer-identical, no wall-clock).
- **Every control rides the reflector** — both the world lens (`setMedium` → `n.med*`) and the eye lens
  (`setEye` → `n.eye*`), plus `setShared` (growth) and `setGenome` (commit/revert). There is **no
  optimistic local mutation**: a control only *requests* the change; the renderer reflects the
  authoritative world state back onto the widgets and the physics each frame. The sender reads its own
  change back from the reflector, so two peers stay in lock-step.
- **Three header hashes** verify byte-match live: `stateH` (the replicated control state), `medH` (the
  medium ψ_out field), `eyeH` (the eye recon field). Two peers driving the same events show identical
  hashes; if `stateH` matches but `medH`/`eyeH` diverge, the divergence is in physics, not control
  replication.

`_uiScope` (which lens you are *viewing*) is intentionally local — each peer may look at a different
lens while both compute identical physics.

---

## 9. Architecture — how the app is wired

`medium.js` is deliberately thin. Its structure:

### 9.1 Two scopes, one UI

`_S = { medium, eye }` — two perception-state bags (`_mkScope()`), each holding mode / rank / view /
selectedRank / recallScores / selfRules / replicaRules + the memo keys + the cached `composeLens` stack.
`_uiScope` picks which the whole UI targets. `_lensP` / `_eyeLensP` are the two parameter sets the
sliders edit. The eye scope is *fed by* the medium's live world soliton but runs its own modes
independently on its own recon.

### 9.2 The per-frame loop

Each frame (gated until the IFS world-clock has produced its kernel):

1. **`_syncFromState(n)`** — reflect the authoritative world state (`n.med*` + `n.eye*` + genome
   overrides) onto the local mirrors (`_lensP`, `_eyeLensP`, `_S`, `_growMax`, the bank) **before**
   driving physics. This is what keeps peers identical.
2. **Drive the medium** — build the source field (`srcIn`), run the medium stack (`_runScope(M, …)` →
   the world lens output `lensedSource`), advance the living world soliton `_psiLensed` toward it.
3. **Drive the eye (eye scope only)** — `_runScope(E, true, _psiLensed, …)` runs the trap stack on the
   trapped world soliton → the recon.
4. **Render** — the scope picks which row shows; `view` picks soliton vs crisp; self modes draw the
   meta-circle canvases. Labels report the mode, recall scores, θ values, occlusion state, focus, and
   the genome's aggregate geometry.

### 9.3 `_runScope` and the cached stack

`_runScope(ctx, isEye, input, P, phaseT, bar)` refreshes the ctx (bar / phase / P / occlusion / growth),
runs the cached `composeLens` stack (`makePerception` for the medium, `makeTrapStack` for the eye), and
returns the field. The stack is rebuilt only when the mode/optics change (keyed on `ctx._stackKey`); the
live param object (`_lensP`/`_eyeLensP`) flows in as `ctx.P` so slider edits apply immediately without a
rebuild.

### 9.4 The library boundary

`medium.js` imports the *mechanics* from `soliton-algebra.js`:
- `makePerception`, `makeTrapStack` — the composed lens stacks.
- `nlhoGenInject`, `nlhoDefaultRules`, `genomeAggregate`, `genomeCodeField`, `runGenomeLens`,
  `barClockDepth`, `applyLife` — genome and lens helpers.
- `opCoevolve` — used by the determinism probe and the world self-transform.

and the *substrate* from `ifs-gpu.js` (`IFSGpu` — `stepEyeN`, `linOp`, `affineEyeCenters`,
`ifsWarpEye`, `bindEyeField`, `applyEyeHologram`, the chaos-game renderer). The app itself contains no
physics — only wiring, rendering, and the control surface.

---

## 10. The controls, at a glance

**Mode row:** `pass` `clock` `recall` `coevolve` `self` `recall→self` · `rank N·K…▸` (cycle genome) ·
`⊕base` (seed lens from genome) · `⊕op` (arm IFS operator) · `⇪commit` / `⊘revert` (persist/drop the
evolved genome) · `obj:` (source object, medium-only) · `self:orbit/contract` · `op:phase/gauge/metric`
(lens mode) · `world:static/active` (medium-only) · `view:soliton/crisp` · `ui:medium/eye` (the scope
toggle) · `optics:on/off` (eye autofocus) · `render:int/phase` (display: intensity or hue=phase, §11.7) ·
`hide:live/baked` (resonance objects: breathing or static hide, §11.2).

**Lens sliders:** `focus×` (scale) · `θ` (rotation) · `shiftX/Y` (translation) · `propT` (focal steps) ·
`focalDist` (sub-step focal distance) · `opSpeed` (lens/walk rate) · `holoT` (holographic depth) ·
`cueClean` (recall cue fidelity) · `grow→K` (self-evolution growth ceiling).

**Eye strip (`H=OCCL`, eye-only):** `H=id/LEFT/RZero/RNois` · `r` (damaged fraction) · `blk` (block px) ·
`focus` (manual rack-focus) · `code⟳op` (geometric operator gain) · `code→img` (content gate gain).

**Instanton:** `⚡amp` (kick strength) · `⚡hold` (bars to sustain the flash, for watchability; 0 = the
honest single transient) · `⚡kick` (fire a propagation kick into the active scope's soliton at the next bar
— flashes ×N then decays to the vacuum attractor) · `⚡tunnel:off/A→B` (arm the kick as a committed STATE
TRANSITION — tunnels the medium from attractor A to B=rank+1, and stays; off = the plain transient that
returns to A, showing the barrier) · `↩recon` (back-propagate the live field; LOW = the vacuum drive is
irreversible, the real one-way-transient signature, next to a labelled ≈1.0 pure-wave control). The native
instanton is a propagation kick, not a genome edit — see [`native-ifs-medium.md`](native-ifs-medium.md) §15
for why the genome-based forms don't fire, and §15.6 for the tunnel-as-state-transition (peer-deterministic:
arm replicated, transition derived locally).

**Warp-DOF strip (eye, when `code⟳op > 0`):** `copies` · `scale s` · `rot θ` · `transX` · `transY`
(each a fraction of the genome's value, shown as a suffix).

---

## 11. The resonance demos — "geometry sees geometry"

A family of source objects (`obj:hidden`, `obj:tight`, `obj:mixed`) demonstrate the deepest claim of the
medium: a **world object can BE a lens**, and the eye can **recall the lens carried inside an incoming
wavefront**. They share one construction and one recognition primitive.

### 11.1 The hidden wavefront — a lens woven into the field

`obj:hidden` builds its source like this:

1. A **Gaussian packet** `e^{-r²/2σ²}` (wide, σ ≈ grid/5) at the centre — a clean lump of light.
2. The **planted genome's phase lens** — the resonance bank `nlhoResonanceRules()` (four phase-distinct
   shapes: square / triangle / diamond-T / diamond-W, each a clean aggregate-θ "note"). The `rank` button
   (medium scope) picks which genome is planted.
3. **The hide** — push the packet through that lens *N* times (`HIDE_PASSES = 6`), each pass a phase-plate
   multiply `ψ·e^{iφ}` interleaved with real soliton propagation (`propT` steps). After six passes the
   packet is a **chaotic phase cloud** — the genome's geometry is *woven into the phase*, invisible in
   intensity.

The result `_hiddenCloud` is a wavefront that **carries its own generating operator**. In the medium
canvases it looks like blue speckle (the geometry is hidden); switch `render:phase` to see the genome's
phase signature as a colour field. See [`native-ifs-medium.md`](native-ifs-medium.md) §"world lens vs
wavefront-with-lens" for why this is the key distinction.

### 11.2 Live vs baked hide — `hide:live`

By default (`hide:live`) the hide depth **breathes**: a triangle wave 1 → 6 → 1 swept by the world clock
(`_monClock`, peer-identical), so the cloud winds up into the full scramble and unwinds back to the
packet (~8 s per cycle). It is genuine soliton physics re-run live each frame, not a baked field. Toggle
`hide:baked` for the old static cloud (one-time bake at depth 6). The label shows
`LIVE hide depth 4/6 (breathing)`. The toggle is **replicated** (it changes the field, so peers stay
byte-identical).

### 11.3 The recognition — a matched filter on lensed signatures

In `ui:eye` (with `op:phase`) the eye traps the cloud and runs the **resonance meter**: it correlates the
incoming wavefront against each genome's **lensed signature** (a packet run through that genome's lens —
the *same* representation as the cloud, which is why a plain impulse-template scores 0). The correlation
`|Σ cue·conj(tmpl)|/‖·‖` is the `bindEyeField` complex product; `argmax` is the recognized geometry.

Crucially, the templates are built at the **same hide depth** as the live cloud (a depth-6 template scores
~7 % on a depth-2 cloud — measured — and picks the wrong rank). Matched at depth, recognition is **100 %
at every depth, all ranks**. So the meter stays locked as the cloud breathes.

An interactive **θ-vernier** sits on top: the eye θ-slider applies a θ-shear correction to the cue, and
the score peaks when you dial out any residual shear — the "find the note" gesture.

### 11.4 `obj:tight` — the honest failure mode

`obj:tight` is the same hide with a **tight packet** (σ = 6). The packet sits where the plate phase
`a·r² + β·angle ≈ 0`, so it has no leverage — but only for the **θ-vernier**. The automatic matched filter
*still* recognizes the genome (~76 % cross-width, measured), because it correlates the whole cloud. The
label shows both: `RESONANCE 76% … · θ-vernier 2% — tight packet ⇒ vernier has no leverage (cf.
obj:hidden)`. It is a side-by-side demonstration that the bug was the *localized encoding*, never the
recognition — switch `obj:tight` ⇄ `obj:hidden` to see the vernier collapse while recognition survives.

### 11.5 `obj:mixed` — several genomes in one field, selected by the operator

`obj:mixed` **superposes two planted genomes' clouds** (rank `r` and `r+2` — visually distinct shapes) in
one normalized wavefront. The eye does two things:

- **Resonates with what's there.** The matched filter lights up **both** present ranks (measured 70 % /
  71 %) and leaves the absent ones near zero (4–5 %); the meter marks present ranks with ◆.
- **Selects one with the operator.** The eye's **selected rank** acts as an **extraction operator**: it
  projects the field onto that genome's signature — `extracted = (⟨cue|tmpl⟩/‖tmpl‖²)·tmpl`, the component
  of the field along that note — and (in `pass` mode) the recon ▸ shows the **isolated geometry**.
  Selecting a present rank extracts ~0.97–1.0 of the component; an absent rank only ~0.003 (~250×
  selectivity, measured). To extract different geometries: `ui:eye`, drive the `rank` dropdown.

### 11.6 Recall the lens — the loop closes

In the hidden family, the eye's **`recall` / `recall→self`** modes run the lens-in-the-wavefront loop:

- **`recall`** — the matched filter recognizes *which planted lens* generated the incoming wavefront and
  **runs that recalled genome** as the recon. The input is "wavefront *with* a lens"; recall reads the
  lens out and re-applies it.
- **`recall→self`** — recognizes the lens, then **self-evolves it** (the code=data θ-walk). The recalled
  genome becomes the seed of the meta-circle's self-evolution. *Input carries a lens → recall the lens →
  evolve it.*

Three details make this faithful (all measured): the library `opRecall`'s synthetic-cue select would
mis-recognize a lensed cloud, so the trap routes `recall→pass` / `recall→self→self` with the
matched-filter rank pre-set; the recalled genome resolves from the **resonance bank** (`_resoRules`) so
it seeds the *same* genome that made the wavefront; and the templates track the live depth (above). The
label reads `recalled the LENS → r2·diamond-T ✓ → EVOLVING it (code=data θ-walk)`.

This is the meta-circle in its sharpest form: world objects **are** lenses, the wavefront **carries its
own generating operator**, and the eye **recognizes and re-runs (or evolves) the lens it reads out of the
incoming field** — the medium operating on the medium in its own terms.

### 11.7 The phase render — making the invisible visible

The genome's signature lives entirely in the phase (`ψ·e^{iφ}` doesn't change `|ψ|²`), so the resonance
strength and the genome's note are **invisible in the intensity view**. The `render:int ⇄ render:phase`
toggle (a local display choice, GPU shader) maps **hue = ∠ψ, value = log|ψ|**, revealing the phase fringes
— the actual carrier of the hidden geometry.

---

## 12. A typical session

1. **Watch the world lens.** Medium scope, `obj:cube`, drag the cube → `ψ_in` shows the rotating
   wavefront, `ψ_out` the genome-lensed version. Try `pass` → `clock` (watch it contract to the
   attractor) → `recall` (the cue picks a genome) → `coevolve` (the genome migrates).
2. **Evolve a genome.** `self` mode → the meta-circle canvases appear; raise `grow→K` to grow new maps
   (`rank` shows `K7✎`). `⇪commit` to keep it.
3. **Look through the eye.** `ui:eye` → `EYE ◀` (hologram) / `EYE ▸` (recon). Raise `holoT` for a
   delocalized record. Drag `focus` (manual) or flip `optics:on` (autofocus).
4. **Make the code act on the image.** `⊕op` to arm the IFS warp from the genome → the image
   rotates/scales/replicates (interference fringes where copies overlap). Isolate a DOF on the `warp
   DOF` strip. Or `code→img` to gate content.
5. **Test occlusion.** `H=RZero`, drag `r` up → the image dims (holographic) and, in self mode, the
   program's maps terminate (corpse dots) and resurrect per bar; raise `holoT` to make the program
   survive more.
6. **Geometry sees geometry.** `obj:hidden`, `ui:eye`, `op:phase` → the `RESONANCE` meter recognizes the
   planted lens (try `render:phase` to see the hidden phase signature breathe with `hide:live`). Switch
   `obj:mixed` and drive `rank` to extract each planted geometry; `obj:tight` to watch the θ-vernier
   collapse while recognition survives. Then `recall` → the eye runs the recalled lens; `recall→self` →
   it evolves it (§11).
7. **Verify determinism.** Open a second peer, drive controls on one, watch `stateH` / `medH` / `eyeH`
   match in both headers.

---

## 13. Relation to the rest of the project

`medium.js` is the **minimal, concentrated** demo of the meta-circular medium — image + geometry
modalities, the world/eye lens stack, the genome's triple identity. The general lens mechanics were
factored into `soliton-algebra.js` so both the world lens and the eye trap compose from the same ops;
`eye.js` is the older, fuller holographic eye it was distilled from. For the algebra's structure and the
measured op-by-op traces, see [`native-ifs-medium.md`](native-ifs-medium.md); for the holographic
foundations, see [`native-ifs-holography.md`](native-ifs-holography.md) and
[`native-ifs-solitons.md`](native-ifs-solitons.md).
