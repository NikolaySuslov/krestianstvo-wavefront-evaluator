# Native IFS Holography in the Krestianstvo Wavefront Evaluator

*An overview of holography performed not with light and lenses, but with a fractal-time
generator — and the path from it toward a holographic computer.*

> **This is the current-state overview.** It keeps only what the system IS now; the development path,
> open questions, demo walkthroughs, and full archived history live in companion files (section numbers
> are preserved across all of them, so cross-references like "§7.16" or "§9" resolve):
> - [`holography-research.md`](holography-research.md) — **open questions**, the development path, and
>   exploratory investigations (recon-vs-hologram recognition §7.40, the recursion/self-hosting research
>   narrative §7.42). *(The cyberphysical roadmap §9 lives in this overview.)*
> - [`holography-demos.md`](holography-demos.md) — the multimedia DEMO walkthroughs (sound, clock-modulated
>   sound, the unified/united field, the live SOLITON, voice-as-events, arpeggio, clock melody; original §7.1–7.21).
> - [`native-ifs-holography-memory.md`](native-ifs-holography-memory.md) — full archived history (the
>   superseded FFT/wavelet NOs and the operator-as-propagation "lens hunt" in complete detail).

---

## 1. What this is

The Krestianstvo Wavefront Evaluator (KWE) performs **holography natively**, inside a
simulated medium whose propagation law is an **Iterated Function System (IFS) fractal
clock**, not the wave equation of classical optics. There is no laser, no lens, no
photographic plate. There is a complex field `ψ` on a grid, evolved by a reversible
operator built from the IFS ring kernel, and the holographic properties — encoding,
reconstruction, redundancy — *emerge* from that operator.

The central object is the **holographic eye**: a live observer that receives a
propagated wavefront, optionally transforms it in the hologram domain, and reconstructs
a percept. The reconstruction is a **soliton** — a self-sustaining eigenstate of the IFS
medium — rather than a passive image.

This document explains the method, contrasts it with classical holography, presents the
measured results that establish it as *true* holography (graceful degradation under
occlusion), and sketches the longer arc: **IFS as a fractal-time generator** underpinning
a **holographic computer** and a **cyberphysical engine**.

---

## 2. Classical holography in one paragraph

A classical hologram records the **interference** of an object wave `O` with a reference
wave `R` onto a square-law (intensity-only) medium:

```
I = |O + R|²  =  |O|² + |R|² + O·R* + O*·R
```

The cross-term `O·R*` carries the object's full **phase**, which the intensity recording
would otherwise lose. Reconstruction re-illuminates the plate with `R`; diffraction
re-emits `O`. The defining, almost magical property is **distributed redundancy**: because
free-space (Fresnel/Fourier) propagation sends every object point to *every* location on
the plate, **any fragment of the plate reconstructs the whole scene** (at reduced
resolution). Cut a hologram in half — you still see the entire object.

Two ingredients make this work:

1. **A reference wave** to encode phase into intensity.
2. **Globally-spreading propagation** (Fresnel/Fourier) so information is delocalized.

---

## 3. Native IFS holography — how KWE differs

KWE keeps the *idea* of holography (encode a wavefront, reconstruct it) but replaces both
ingredients with native, fractal-medium machinery.

### 3.1 The propagator is the IFS fractal Laplacian, not free space

The field evolves by a **symplectic Störmer–Verlet leapfrog** of a Schrödinger-type
equation `i∂ₜψ = −Lψ`, where `L` is an **IFS ring operator**: a sum over rings of radius
`r_d` with weights `w_d`,

```
L = Σ_d w_d ( R_d − n_d·I )
```

`R_d` sums the field around a discrete ring of radius `r_d`. The ring radii come from the
IFS fractal clock (the "Fresnel IFS" depth schedule). Key properties, all verified:

- **Reversible.** The leapfrog is palindromic (kick–drift–kick), so `F⁻ᵀ Fᵀ = I` to
  machine precision. Forward T steps then backward T steps returns the input exactly.
- **Symplectic / norm-preserving.** It rotates phase space; it does not dissipate. This is
  why backward propagation *reconstructs* rather than smears.
- **Diffusive, not instantaneous.** Unlike Fresnel/Fourier (which fill the aperture in one
  step), the IFS ring operator spreads the field **gradually and locally** — energy creeps
  outward over many steps. *This single fact drives the central result below.*

Because `L` is a convolution (translation-invariant ring sums), its true spectral basis is
**Fourier** — the rings are a *stencil*, not an orthogonal basis. There is no separate
"ring-frequency basis"; band-limiting the kernel changes the *medium*, not a spectral
channel.

### 3.2 No reference wave is needed — the field is complex

Classical holography needs a reference beam only because detectors measure **intensity**
and lose phase. KWE carries the **full complex field** `ψ` (real + imaginary) end to end.
Nothing is ever collapsed to `|ψ|²` during the pipeline. Therefore:

- **No reference wave, no `|·|²` recording, no DC term, no twin image.**
- **No Gerchberg–Saxton, no phase-shifting.** Those exist only to recover phase lost to an
  intensity bottleneck KWE never imposes.

Reconstruction is simply running the reversible operator backward. This was confirmed with
a single point source: `point → Fᵀ → swPsi (hologram) → F⁻ᵀ → exact point`, 100 % energy
back at the source pixel — **no iteration, no phase recovery** (see §5.1).

### 3.3 Depth is duration, not Euclidean distance

In classical optics, depth `z` is a spatial coordinate baked into wavefront curvature
(`e^{ikr(z)}`). In the IFS medium there is **no `z` axis**. Depth is encoded as the
**number of IFS steps** a point propagates — *depth is duration of fractal-clock
evolution*. Near points evolve fewer steps (tight, high-frequency fringes); far points
evolve more (spread, low-frequency). Reconstruction depth-scans by watching where each
point refocuses along the backward sweep. **The third dimension is the clock.**

### Comparison table

| | Classical holography | Native IFS holography (KWE) |
|---|---|---|
| Medium | physical light + plate | complex field `ψ` on a grid |
| Propagator | Fresnel / Fourier (wave eq.) | IFS fractal Laplacian (leapfrog) |
| Reference wave | **required** (encode phase → intensity) | **none** (full complex field kept) |
| Recording | `\|O+R\|²` intensity (lossy) | complex `ψ` (lossless) |
| Phase recovery | needs GS / phase-shifting | not needed (phase never lost) |
| Reconstruction | re-illuminate with `R`, diffract | run operator backward `F⁻ᵀ` (exact) |
| Spread | global, instantaneous | diffusive; redundancy **gated by structure/compressibility** — holographic for structured & depth-bearing objects, fragile for incompressible noise (see §5) |
| Depth encoding | Euclidean `z` (curvature) | **duration** = # of IFS steps |
| Spectral basis | Fourier | Fourier (rings are a stencil, not a basis) |
| Twin image | present (must separate) | none |

---

## 4. The holographic eye, and `[H]` — computing in the hologram domain

The eye is the live pipeline (`IFSEye` in `holography.js`, driven by `eye.js`):

```
   ψ_obj  ──Fᵀ──►  ψ_holo  ──[H]──►  ψ_holo'  ──F⁻ᵀ──►  ψ_evidence  ──relax──►  ψ_percept
  object         hologram        transform        reconstruction        soliton
  plane           domain          (optional)        (exact inverse)       percept
```

Five stages, each a panel in the UI:

1. **ψ_obj** — the source wavefront (geometry as points/edges, or a received field). In the
   *eye-as-observer* framing the eye never sees this directly — it lives in the "world."
2. **ψ_holo = Fᵀ(ψ_obj)** — the spread hologram-domain field. *This is the wavefront on the
   hologram.* The maximally-mixed representation.
3. **[H]** — the **hologram-domain transform slot**. Because the field is maximally spread
   here, a **local edit in H-space is a distributed edit in object-space** — the
   holographic property that makes this the natural place to *compute*. Implemented modes:
   identity, low/high-pass aperture, phase conjugate, left-occlusion, random-block
   zero/noise. This slot is the seed of "holographic computing" (§7).
4. **ψ_evidence = F⁻ᵀ(ψ_holo')** — the reconstruction (exact inverse when `[H]=identity`).
5. **ψ_percept** — the evidence **relaxed onto a soliton eigenstate** of the IFS medium via
   feedback injection (`stepRecordEye`). Perception is not a copy of the measurement; it is
   the **stable attractor nearest the evidence**. With memory/hysteresis across frames, the
   percept *tracks* a changing object rather than snapping — a living percept.

The eye supports **save/load** of the hologram-domain field (`.kwe`): the file stores
`ψ_holo'` (post-`[H]`), and loading **re-runs the backward leg** to reconstruct, then
**settles a fresh soliton** from noise toward the loaded evidence — so a recalled memory is
perceived as the medium's canonical eigenstate, not a verbatim echo.

---

## 5. Results — establishing *true* holography

The decisive question: does the IFS medium exhibit **distributed redundancy** — the
cut-in-half property — or is it merely a reversible blur (a photo)? The test: occlude a
fraction `r` of the hologram-domain field (`[H]` mask), reconstruct, and score the
reconstruction by correlation with the object. **Linear falloff (score ≈ 1−r) = photographic
(local); graceful/concave falloff = holographic (global).**

### 5.1 Exact reconstruction (foundation)

A single point source reconstructs **exactly** — `point → Fᵀ → F⁻ᵀ → point`, 100 % energy
at the origin pixel, ~2.8 × 10⁻⁶ error after 100 GPU (Float32) steps. No GS, no
phase-shifting. This proves the pipeline is a faithful, reversible encoder/decoder before
any redundancy question is asked.

### 5.2 The occlusion-redundancy curve — sparse vs. dense object

Measured reconstruction score vs. occluded fraction `r`, for the **sparse wireframe cube**
and a **dense random-texture** object, at shallow (`T=100`) and deep (`T=350`) propagation:

```
            SPARSE cube              DENSE texture          photo
  r       T=100    T=350           T=100    T=350          (1−r)
 0.00     1.000    1.000           1.000    1.000          1.00
 0.10       —        —             0.591    0.566          0.90
 0.25     0.981    0.952           0.427    0.404          0.75
 0.40     0.872    0.917           0.255    0.256          0.60
 0.50     0.707    0.857           0.183    0.186          0.50
 0.75     0.234    0.559           0.109    0.099          0.25
 0.90     0.000    0.258           0.049    0.057          0.10
```

The **sparse cube** appears to show depth-gated holography: at `T=350` it degrades
gracefully (0.258 at r=0.9) vs. collapsing to 0 at `T=100`. **But the dense-texture test
overturns this reading**, and the dense object is the one whose score can actually *fail*
(no empty background to inflate the correlation, no sparse points for the back-flow to
cheaply refocus onto):

- **Depth-gating vanishes.** For the dense object, `T=100 ≈ T=350` at every `r`
  (0.59≈0.57, 0.43≈0.40, 0.18≈0.19…). Deep propagation gives **no** redundancy advantage.
- **The dense curve collapses fast — below the photo line.** Occluding just 10% drops the
  score to ~0.57; occlusion is *worse than proportional*. Dense reconstruction is **fragile,
  not redundant**.

### 5.2b Depth sweep — redundancy vs propagation depth, by object type

Fix the occlusion at `r=0.5` and sweep `T` over 30× (50→1500), for three object types —
sparse wireframe, structured-dense (filled disc), unstructured-dense (random texture):

```
 T:        50    100   200   350   500   750  1000  1500   behavior
 CUBE     0.708 0.866 0.943 0.953 0.954 0.962 0.971 0.976  ← CLIMBS to 0.98 (depth-gated, real)
 FILLED   0.535 0.599 0.559 0.528 0.521 0.520 0.483 0.444  ← flat ~0.5 (saturated)
 TEXTURE  0.213 0.183 0.191 0.184 0.185 0.175 0.173 0.151  ← flat ~0.18 (saturated)
 CUBE spread:  9% → 14% → 22% → 44% → 46% → 41% → 48% → 49%   (climbs, then plateaus ~49%)
```

This is the decisive measurement, and it is **structure-dependent**:

- **Sparse cube** — score **climbs strongly with depth**, reaching 0.976 at `T=1500` even
  with half the hologram occluded. Genuinely depth-gated holographic redundancy. (Note: it
  keeps climbing 0.95→0.98 *after* the spread plateaus at ~49% — so beyond raw spatial
  spread, finer **phase mixing** at deep `T` still adds redundancy.)
- **Dense objects** (filled, texture) — score is **flat in `T`** (drifts slightly *down*
  from Float32). Deeper propagation gives no redundancy gain. The achievable level is set by
  the object's intrinsic spatial **compressibility**: structured filled ~0.5, incompressible
  random ~0.18.

### 5.2c Multi-depth object — the fair "real scene" test

The cube and texture are both **flat single-plane** objects. But classical holographic
redundancy comes from **depth** — points at different distances emit wavefronts of different
curvature, and their superposition fills the plate. A fair test must give the object *depth*.
Built a dense object across `N_DEPTH_TIERS = 4` depth layers via **staged injection** (each
layer injected at its own forward step — far early, near late: depth = duration), then
occlusion-swept (`⊙ 3D-HOLO`):

```
  r       flat texture    MULTI-DEPTH (T=148 / 376 / 500)     photo (1−r)
 0.10        —            0.884 / 0.871 / 0.868               0.90
 0.25       0.40          0.767 / 0.760 / 0.744               0.75
 0.50       0.18          0.466 / 0.470 / 0.448               0.50
 0.75       0.11          0.268 / 0.267 / 0.272               0.25
 0.90       0.05          0.121 / 0.126 / 0.116               0.10
```

**Depth roughly doubles dense-object redundancy** (r=0.5: 0.18 → 0.47). The flat-plane test
*was* unfair — giving the object depth substantially restores robustness. **But** the
multi-depth curve sits **on the photo line (≈ 1−r)**, not above it → it is *photographic*
redundancy (lose what you occlude, evenly), not the *super-linear* holographic curve the
sparse cube reaches. Depth-gating is also absent here (T=148≈376≈500) — the gain is from
depth *diversity*, not deeper propagation.

### 5.2d Structured multi-depth — the real-scene proxy *is* holographic

Random-texture depth layers (§5.2c) only reach the photo line. But a *real scene* is
**structured**, not random noise. Repeating the multi-depth test with **distinct structured
shapes per depth layer** (disc near, ring, cross, square-frame far — each a dense fill):

```
  r      structured multi-depth (T=370)   photo (1−r)
 0.00    1.000                            1.00
 0.10    0.897                            0.90
 0.25    0.791                            0.75
 0.40    0.630                            0.60
 0.50    0.569                            0.50   ← ABOVE the line
 0.75    0.377                            0.25   ← clearly above
 0.90    0.271                            0.10   ← 2.7× above
```

The structured multi-depth object sits **above the photo line at every `r`** →
**super-photographic = genuinely holographic.** And it is **visually confirmed** in the
`⊙ 3D-HOLO` panels: panel 1 shows ~50% of the hologram block-occluded (visible missing
squares), yet panel 3 still reconstructs the **whole** structured object — degraded and
blurred, but complete, retaining its central core and fourfold symmetry. **That is the
cut-the-hologram-in-half property, made visible.**

### 5.3 Honest conclusion — structure & depth, not sparsity, is the axis

Scoring each object against the photographic baseline `1−r` (at r=0.5):

| Object | score @ r=0.5 | vs photo line | regime |
|---|---|---|---|
| Flat dense **random** texture | 0.18 | below | sub-photographic (fragile) |
| Multi-depth **random** layers | 0.47 | on the line | photographic |
| **Multi-depth structured** (real-scene proxy) | **0.57** | **above** | **holographic** ✓ |
| Sparse cube (deep T) | 0.95 | well above | strongly holographic |

The determining factor is **object structure / compressibility**, *not* sparsity per se:

- **Structured / compressible content** (sparse geometry, or structured multi-depth — i.e.
  *real scenes*) → **above** the photo line → genuine holographic redundancy.
- **Incompressible random content** → **on or below** the line → photographic or fragile.

> The IFS medium **does provide holographic ("cut-in-half") redundancy for structured,
> depth-bearing objects** — the closest proxy we have to a real scene. It fails only for
> incompressible noise (which has no redundancy in *any* medium). This mirrors real holography
> being **compressibility-bounded**.

This conclusion was reached after several iterations, each corrected by a better test: "true
general holography" (sparse cube only) → "not holographic, sparse was an artifact" (flat
random went flat — over-generalized) → "depth restores photographic" (random multi-depth) →
the final **structure-gated** picture, in which a *structured* depth object — the fair
real-scene test the earlier objection (rightly) demanded — is genuinely holographic.

**What remains solidly true:** the IFS medium is a **faithful reversible encoder/decoder** —
a single point reconstructs exactly (§5.1, 100% energy, ~machine precision).

### 5.4 Methodological lesson & caveats

- **A test only informs when it can fail.** The sparse cube + intensity-correlation score
  could not fail (sparse refocusing + black background → inflated score). The dense texture
  can fail, and did. Holography/redundancy claims must be validated on **dense** objects.
  (The same lesson recurred elsewhere: same-kernel ring round-trips are trivially perfect;
  seed=attractor relaxation is a no-op; ring-band intensity scores saturate on sparse data.)
- **Float32 precision** is *not* the culprit here — at `T=350` the `r=0` score is still
  1.000, so the dense collapse is physics, not rounding.
- **Spectral redundancy is confounded** and was never cleanly established: the rings are a
  convolution stencil, not an orthogonal basis (the rigorous spectral axis is Fourier).

Use the dense source buttons (**● FILLED**, **▦ TEXTURE**) with ⊙ SWEEP to reproduce.

---

## 6. The Depth Explorer — IFS-native depth vision

The multi-depth results above (§5.2c–d) were obtained by treating a scene as a **stack of
planes** and reconstructing each by back-propagation distance — i.e. **optical
tomography**, borrowed into the IFS medium. It works (the refocus math is exact — single
layers round-trip to score 1.000), but it inherits tomography's problems: the planes are
discrete, and refocusing one plane leaves the others as **cross-layer interference** that
swamps it. That interference is a *defect* in the tomographic framing.

But depth in this medium is **duration of fractal-clock evolution** (§3.3), not Euclidean
distance. So the planes-and-distances picture is a borrowed metaphor, not the native one.
The **Depth Explorer** (`⊙ EXPLORE` + the `τ` slider) reimagines depth accordingly.

### 6.1 Depth as a coordinate on the evolution clock τ

The scene is a soliton; its depth structure **is** its trajectory through IFS time. A single
continuous parameter `τ ∈ [0,1]` is the observation point along that trajectory:

```
ψ_holo  ──F⁻ᵗ (t = τ·T)──►  ψ(τ)        the depth view at evolution-time τ
   τ=0  (far / fully spread)              τ=1  (near / fully refocused)
```

Scrubbing `τ` **moves the observation point through depth** — continuously, not plane by
plane. Whatever structure focuses at `τ` is sharp; everything at other depths is softly
blurred. Crucially, **that blur is depth-of-field, not interference** — the exact same
cross-layer bleed that was a *defect* in the tomographic framing is, in the native framing,
the thing that makes 3D vision feel volumetric. The defect became the feature.

The focus is held by the **driven-dissipative soliton** (the display mechanism from the
solitons work): a few relax steps toward the scrubbed view settle the monitor onto a stable
soliton with a *depth-of-attention*. Move `τ` → the soliton smoothly tracks to a new depth.

### 6.2 Contrast with optical tomographic holography

| | Optical / tomographic depth (§5.2) | IFS-native depth explorer (§6) |
|---|---|---|
| Depth primitive | Euclidean distance | **evolution time `τ` (fractal clock)** |
| Scene model | discrete stack of planes | **continuous soliton trajectory** |
| Reconstruction | back-propagate each plane separately | **scrub `τ` — one moving observation point** |
| Out-of-focus content | cross-plane **interference** (defect) | **depth-of-field** (feature) |
| Depth resolution | number of planes (discrete) | **continuous; fractal — detail at every scale** |
| The "monitor" | a focal plane | **a driven-dissipative soliton with depth-of-attention** |
| Occlusion test | per-plane refocus from masked plate | **scrub depth *through* a masked hologram** (`[H]` applied before the τ-scrub) |

The headline: **depth vision = scrubbing the fractal clock of a living soliton scene.** This
extends the "no frames" thesis (§7 of the solitons doc) from time into depth: there are **no
frames in time and no planes in depth** — both axes are continuous evolution of *one* field,
because in this medium time and depth are the *same* coordinate (`τ`). That unification is a
direct prediction of the IFS-as-fractal-time-generator thesis (§7 here).

### 6.3 What it is — and isn't

- It **is** *monocular volumetric* depth: you move *through* the depth of a coherent scene,
  with natural depth-of-field, and you can do so **through an occluded hologram** (`[H]`
  applied before the scrub) — the depth-resolved occlusion-robustness test, live.
- It is **not** stereo/parallax (two simultaneous viewpoints). That remains future work
  (angular multi-snap multiplexing). The Explorer is the depth-of-focus axis, not the
  parallax axis.

Reuses only proven machinery: `τ` motion = exact-reversible backward IFS stepping (§5.1);
focus hold = the driven-dissipative soliton. UI: `⊙ EXPLORE` toggles it; the `τ` slider
scrubs depth; the `[H]` modes + `r=` occlusion slider mask the hologram so you can explore
depth through a damaged hologram. Panels show the masked scene hologram (holes visible), the
depth view at `τ`, and a neighboring depth `τ−0.2` (the depth-of-field difference, side by
side). Confirmed live: with a sparse depth-map (distinct shapes at separated depths), `τ`
visibly **racks focus** between the shapes (ring → cross → frame) — *through a 50%-occluded
hologram* — demonstrating depth-resolved holographic redundancy.

**Two display characteristics to expect (not bugs):**
- **Dense-depth scenes show weak focal contrast.** A scene occupying *every* depth (smooth
  surface, concentric rings at all radii) refocuses only subtly, because all depths compete
  in every view — the continuous analog of the multi-layer cross-blur (§6.below). Visible
  focus-racking needs **sparse, well-separated** depths (the `◈ MAP` object uses 3 separated
  shapes for this reason).
- **Axis banding (bright H+V central cross).** Reconstructions show bright horizontal+vertical
  bands through the centre. This is a **genuine IFS-medium signature**, not a logic error: the
  ring offsets are discretised by `Math.round(r·cos θ, r·sin θ)`, which samples the grid axes
  more strongly than diagonals, so the operator is mildly **axis-anisotropic** and concentrates
  low-frequency/DC energy on the axes. It is the same axis-aligned mode seen throughout (it is
  why an *unstable* backward step would produce horizontal stripes). We leave it visible rather
  than cosmetically suppress it — it is a true property of this fractal medium.

### 6.4 How the 3D object is defined — and what "a wavefront contains depth" means

There are two ways to *define* depth, and a critical subtlety about which one `τ` can read.

**Two depth encodings:**

1. **Propagation-distance depth** (`◈ 3D` layers, and `◈ MAP`) — a point at depth `z` is
   **injected at forward step `(1−z)·T`**, so it actually *propagates* `z·T` steps before
   reaching the hologram. Depth = how far it traveled.
2. **Phase-offset depth** — every point placed at one plane with a starting phase tint
   `φ=z·Φ`. Depth = a per-point phase constant.

**Only #1 is `τ`-selectable, and this is the crux.** `τ`-scrubbing applies a *uniform*
backward propagation `F^(−τT)` to the whole field. A point that actually traveled `z·T` steps
refocuses when back-propagated `z·T` steps — i.e. **at `τ = z`**: each depth comes into focus
at its own `τ`. But a flat phase offset `φ=z·Φ` is just a constant multiplier `e^{iz·Φ}` that
**propagation does not convert into a focal distance** — all such points still refocus
together at `τ=1`. So phase-offset "depth" makes `τ` scrub *reconstruction progress*
(spread → focused), **not depth**.

> This corrects an earlier conflation. In *classical optics* phase-curvature does encode
> depth — but only because optical curvature `e^{ik·r²/2z}` is the **propagation-matched**
> phase the lens inverts into a focus. A flat phase tint is not that, and the fractal IFS
> propagator has no closed-form focal phase to paint — so the only faithful way to get
> `τ`-selectable depth is to **actually propagate each point by its depth** (encoding #1).

**`◈ MAP` therefore encodes depth as propagation distance**, not phase: a smooth surface
`z(x,y)` sets each pixel's injection step, finely binned (~24 levels ≈ continuous). It flows
through the same staged scrub as the layers, so `τ` genuinely sweeps **continuous
depth-of-focus** through the surface. `◈ 3D` is the same idea with 4 structured planes.

**What "a wavefront contains depth" means, correctly:** a 2D *image* `|ψ|²` is irreversibly
flat (a photograph discards phase). A 2D *wavefront* keeps the complex field, and the depth is
recoverable because each depth's contribution carries the **propagation-matched phase** of
having traveled its distance — which the inverse propagation refocuses at the right `τ`. In
this medium **depth = propagation duration** (§3.3): a 3D object is a field whose components
have each evolved for their own number of fractal-clock steps, and `τ` reads them out depth by
depth.

> **Caveat on the `τ` axis:** for objects built *without* propagation-distance depth (e.g. a
> flat plane, or a phase-tinted field), the `τ` slider is the **hologram↔reconstruction**
> (spread↔focused) axis, not a depth axis. Genuine depth-scrub requires propagation-distance
> encoding (`◈ 3D` / `◈ MAP`).

---

## 7. The soliton algebra & the holographic-computing API

The IFS medium carries not just an image but a full **multimedia hologram** — image + sound + events
in one wavefront, on one fractal clock. That multimedia build (sound holography, the shared clock,
combined-field multiplexing, the heartbeat/clock-modulated sound, the unified and united fields, the
live `⊙ SOLITON`, voice-as-events, the arpeggio, and clock melody) is documented as a step-by-step
walkthrough in **[`holography-demos.md`](holography-demos.md)** (the original §7.1–7.21).

This chapter continues from there into what the system became: live solitons as **first-class algebraic
values** (`⊙ SOLITON`, the definition in §7.22), the **soliton algebra** (§7.26 — composable `cyc→field`
solitons), the **`[H]` holographic-computing API** (§7.32–7.34 — composition-as-computation: `bind`/`gate`/
`recognize`/`recall`), the **recognition** results (§7.36–7.41), and **recursion / self-hosting / the limit-
cycle architecture** (§7.42–7.48). Sections are numbered as in the original document.


### 7.22 What "the live soliton" IS — `Ψ(cyc)` is the soliton; the recon reads the live field

Precise statement, because the term gets overloaded. **The live soliton is `Ψ(cyc)` — the hologram
WAVEFRONT**, a pure function of the shared clock:

```
Ψ(cyc) = forward-evolve( the last K bars of clock-derived content ) to the present
```

`solitonFieldAt(cyc)` recomputes it from scratch each tick — inject bar `cyc−K+1`, step, … , bar
`cyc` — **no accumulated state, no frame history**. Given `cyc`, every peer computes the identical
field → frame-rate-independent → peer-synced by construction (corr=1.0, measured). That is the "moving
picture, not frames": a travelling wavefront whose state at any instant is closed-form in the clock.
This — the **hologram field** — is the soliton.

**The recon is NOT a second soliton; it is a READOUT of `Ψ(cyc)`.** Recovering the bar's notes
(back-prop + peak-detect, parametrized by τ / occlusion / recon-depth) is how you *observe* the
soliton, not the moving structure itself:

| object | what | role |
|---|---|---|
| **`Ψ(cyc)`** (hologram field) | the travelling wavefront, last K bars forward-evolved | **the soliton** (visual; pure clock; synced) |
| **recon** | back-prop of `Ψ(cyc)` → recovered notes | a **readout** (audio; pure clock; τ/occ/recT-parametrized) |

**One live holographic soliton — the recon reads `Ψ(cyc)` itself.** The audio/note recovery
back-propagates the **actual `Ψ(cyc)` travelling field** (with `H`/occlusion applied to *that* field),
not an isolated re-holograph. So the soliton and what-you-hear are ONE object, and `H=OCCL` genuinely
masks the live wavefront. The physics forces one design choice: `Ψ(cyc)` superposes the last K bars at
different depths; the **freshest bar is too shallow to be holographic** (hasn't spread), so the read
targets bar `nowBar − readBars` at its **true age** (`readBars·barSteps + curAge`) — back-propagating
`Ψ(cyc)` by that age refocuses the matured bar to its cells while the other bars stay diffuse (natural
depth separation, no re-seed). Per-note energy ratio is taken vs the **same live field un-masked**, so
occlusion's effect is honest. Cost: audio lags note-entry by `readBars` bars (the price of reading a
matured, genuinely-holographic bar instead of the raw-fresh one); `recT` overrides the recon depth.

**GPU RESULT — it works, and is MORE robust than an isolated read.** f1 surviving (recon-depth recT ×
occlusion r):

| recT \ r | 0 | 0.25 | 0.5 | 0.75 |
|---|---|---|---|---|
| 1 | 1.00 | 0.75 | 0.25 | 0.25 |
| 4 | 1.00 | 0.75 | 0.25 | 0.25 |
| 20 | 1.00 | 1.00 | 0.75 | 0.50 |
| 200 | 1.00 | 1.00 | 0.75 | 0.50 |
| 350 | 1.00 | 1.00 | 0.75 | 0.50 |

Three clean readings: **(a) r=0 is 1.00 at every depth → NO multi-bar contamination** (back-prop of
the real `Ψ(cyc)` cleanly isolates the matured bar). **(b) shallow recT ≈ 1−r → photographic** (no
spreading yet). **(c) deep recT is genuinely HOLOGRAPHIC and HOLDS:** r=0.5 climbs 0.25→0.75, r=0.75
climbs 0.25→0.50, r=0.25→1.00 — survival rises with depth and does not collapse, preserving more
distributed redundancy than a fresh isolated round-trip. **So "one live holographic soliton" is
confirmed: `H` masks the actual `Ψ(cyc)` wavefront; recovery is clean at r=0 and degrades gracefully +
improves with depth — no contamination, no deep-T collapse.**

### 7.24 Hologram / recon panels — observe masking-stability (eye-cube relationship)

The SOLITON panels are a **hologram→recon pair**: panel 1 = `Ψ(cyc)` with `H` applied (the masked
hologram — occlusion blocks visible, masking *hits here*); the 4th canvas = the reconstruction
back-propagated from that masked hologram (stays stable despite the holes). `solitonRenderAt` returns
`holoMasked` (field after `H`, before back-prop) and `viewTau` (recon). The recon depth is
`readAge·(0.5+τ)` (never 0, so it always reconstructs; τ scrubs around the matured bar's refocus
depth). You watch masking degrade the hologram while the reconstruction holds — the eye-cube demo,
live on the travelling soliton.

### 7.25 Depth-staged image per bar — image WITH depth (not a flat shape, not a cube)

The soliton's per-bar image is a real **depth-staged object**, not one flat layer. `contentFn` returns
`imageLayers` (the full stack: disc / annulus / cross / square frame — diagnostic shapes, *not* a
cube — `_buildDepthLayers`); `solitonFieldAt`'s `runBar` stages them across the bar's propagation —
layer `d` injected at sub-step `round(steps·(nL−1−d)/nL)` (far layers early/deep, near late/shallow),
events at step 0. So each bar holds the shapes at distinct depths; scrubbing `τ` on the recon refocuses
them in turn. (The image content is still diagnostic test shapes, like the test arpeggio — the
*mechanism* of depth-encoded multi-layer imagery flowing in time is what's real.)

### 7.26 Soliton ALGEBRA — first-class, composable solitons (`soliton-algebra.js`)

The hard-coded event+image union is refactored into a small **algebra** so live solitons are
first-class values that compose like higher-order functions. The type:
`Soliton = { region(), inject(gpu,g,cyc,subStep,total), readout(g,recon,cyc,clean), trueCells?(cyc) }`,
all **pure in `cyc`**. Primitives: `eventSoliton` (pitch×onset roll), `imageSoliton` (depth-staged
stack). Combinators **closed over the type** (so they nest): `unite([...])` (superpose/region-mux into
one pure-cyc soliton), `place(s,region)`, `atDepth(s,b0,b1)`. The engine `evalSolitonAt(eye,composite,
cyc,opts)` is the single pure-cyc runtime (clock-pure K-bar recompute → `H` → back-prop → per-child
readout); any composite flows through unchanged. **Closure is the point:** `cyc → field` is closed
under superposition/region-mux/depth-stage, so a composite is automatically a pure function of IFS
time → peer-synced by construction (corr=1.0). Adding a modality = one more soliton in `unite([...])`.
The live SOLITON branch is wired to it (the monolithic `solitonRenderAt` is kept only for the
ctrl-click occlusion sweep). **Guarantee vs condition:** composition is always *sound* (deterministic,
synced); it is *legible* (parts recoverable) only if the parts stay orthogonal — `unite` runs an
orthogonality check and warns. Frontier (unbuilt): composition-as-COMPUTATION — a soliton transforming
another via `[H]` (§9) — is expressible in the type but unmeasured.

### 7.27 Subspace projectors — orthogonality is not (only) spatial

Separability ≠ spatial-disjointness. Many solitons can superpose in ONE shared field (preserving the
united-wavefront thesis: one object, masked together, cross-modal-capable) and stay perfectly
recoverable **iff they occupy orthogonal SUBSPACES — and the subspace need not be a region of space.**
The conforming structure is a direct sum of orthogonal projectors `Ψ = Σ Pᵢ Ψ`; region-mux is the
trivial (wasteful) special case `Pᵢ` = spatial mask. The general algebra: a `Subspace` descriptor with
`coherence(other) → 0..1` (0 = orthogonal/clean, 1 = collinear/leaks); `unite` checks pairwise
coherence (basis-agnostic, quantified). Implemented bases (descriptors): `makeRegion` (working),
`makeCarrier(kx,ky)` (reference/angle-multiplex — the holographically-native one), `makeBand` (spectral),
`makeDepthBand` (the IFS-proven depth axis). Whether IFS *preserves* a given basis's orthogonality is a
measured question (§7.28–7.29).

### 7.28 The unitarity gate — IFS preserves orthogonality on the united field (GPU-measured)

The IFS step `U` is linear + norm-preserving ⇒ **unitary** ⇒ its eigenmodes are orthonormal and
propagation is *diagonal* on them ⇒ a modality placed in an orthogonal subspace **stays** there, zero
leakage, **by construction** — the basis the united field preserves for free. True in exact arithmetic;
the only question is whether **float32** GPU stepping holds it. `eigenmodeGate` (Alt+Shift-click ⊙
SOLITON) tests it: two orthogonal random fields, propagate both by T, measure overlap (→0?) + norm
(→1?). **Result:**

| T | overlap (0=orthogonal) | normRatio (1=unitary) |
|---|---|---|
| 10 | 0.0002 | 1.0001 |
| 50 | 0.0003 | 1.0002 |
| 150 | 0.0011 | 1.0009 |
| 350 | 0.0012 | 1.0040 |

**PASS:** overlap stays ~0.001 (1000× below collinear) across full depth; norm holds to 0.4%; both
drift *linearly* (round-off), not exponentially (coupling) — the unitary signature. Float32 IFS
preserves orthogonality on the physical united field. **Stronger than expected:** it holds for ANY two
orthogonal fields, not just eigenvectors — so one needn't compute eigenmodes; *any* fixed orthonormal
basis stays separable. Eigenmodes remain canonical (also phase-diagonal, ideal for cross-modal `[H]`)
but aren't a prerequisite.

### 7.29 Carrier cross-talk — region-free composition is gated by sparsity, not the medium

Carrier (angle-)multiplex: encode modality_i as `content·e^{i kᵢ·x}` summed into the SAME cells,
recover by demodulating with `e^{-i kᵢ·x}` (`makeCarrier.embed/extract`). `measureCarrierCrosstalk`
(Ctrl/Cmd+Shift-click) builds the leakage matrix `L[i][j] = corr(recover_i, true_j)` through the IFS
round-trip. **Result (3 modalities, one field):**

- Diagonal (self-recovery) ≈ 0.6–0.75; **off-diagonal ≈ 0.37** for dense overlapping shapes.
- GPU off-diagonal (T=10 **and** T=427) = the **unitary-mock** off-diagonal, all 0.37 → **the ring-
  kernel adds NO carrier mixing at any depth** (the §7.28 result, confirmed for carriers; thesis holds).
- The 0.37 floor is **not** the medium: removing the DC carrier, increasing `|Δk|`, and complex-
  magnitude demod (worse — phase carries the separation) all failed to lower it. It is intrinsic to
  carrier-muxing **spatially-overlapping** content (a carrier only shifts in k; overlapping content
  still overlaps).
- **Sparse content → off-diagonal 0.06** (diagonal 0.67) — confirming the cause.

**Conclusion:** the IFS medium preserves carrier orthogonality at all depths; **region-free interleaved
composition is gated only by content SPARSITY** (sparse 0.06 / dense 0.37) — the same structure-gating
law as masking (§5.3), soliton coherence (§7.16), occlusion (§7.22), now shown for the carrier basis.
**One law, every basis.** (Note: carrier-orthogonality is depth-INDEPENDENT — unlike occlusion-
robustness which crosses over with depth — because it's about whether `U` mixes subspaces, which
unitarity settles at every T. Measured, not assumed.)

> **This sparsity gate is exactly WHY the live architecture moved off carriers (→ §7.44, §7.47).** Carriers are
> clean only for SPARSE content (0.06); dense modalities leak (0.37). The fix is to stop sharing the instant:
> TEMPORAL multiplexing gives each modality its own clock phase, so even DENSE content recovers at ≈1.0 (no
> co-residence → no carrier crosstalk, by construction). The live `carrierEventSoliton`/`carrierWaveSoliton`
> (§7.30–7.31) have carrier-free counterparts `regionEventSoliton`/`regionWaveSoliton`, and the ⊙ SOLITON scene
> + every `[H]` combinator run through `evalSolitonTemporalAt`. Carriers stay valid for the sparse/non-temporal
> path; time-mux is the current default.

### 7.30 Region-free carrier events — confirmed live (`carrierEventSoliton`)

`carrierEventSoliton` puts the note atoms on a carrier spread across the WHOLE grid (no region):
`inject` = `carrier.embed(notePattern)`, `readout` = demodulate the recon then the §7.22 per-note
energy gate (basis-aware clean reference via `cleanEnergy`). The live scene is
`unite([ carrierEventSoliton(makeCarrier(1.4,1.4)), imageSoliton(top region) ])` — events region-free,
image keeps its (dense) region; they co-occupy cells. **GPU-confirmed live** (T=10, occl 0): events
**f1=1.00 (4/4)**; panel 1 shows both modalities **interleaved in one field** (depth-staged image +
carrier-spread events sharing cells); panel 4 reconstructs the image **clean** — the carrier-spread
events do NOT noise the image recon (the one untested cross-term). Why clean both ways: the carrier
puts events at a spatial frequency the image back-prop doesn't couple to (events = high-freq fringes,
image = low-freq structure) — events recover by demod, image by the carrier being off-frequency.

**The orthogonal-region constraint is dissolved** — not by abandoning unification (still ONE physical
wavefront, maskable together by `H`) but via the medium's own carrier-orthogonality. Remaining rigor:
verify at deep T + `H=OCCL` (carrier cross-talk was flat to T=427, so expected to hold).

**The architecture arc:** first-class composable solitons (§7.26) → subspace projector API, orthogonality
≠ spatial (§7.27) → unitarity gate PASS, IFS preserves orthogonality (§7.28) → carrier cross-talk
medium-clean, sparsity-gated (§7.29) → region-free carrier composition confirmed live (§7.30). Each
link measured; the result is an interleaved, holographic, peer-synced, multimodal soliton on the
medium's native (unitary) structure.

### 7.31 Waveform soliton — sound SYNTHESIZED from recovered harmonics (third modality)

The third modality, encoded the right way. A dense raw waveform (512 samples) decayed under advection
(§7.16) — but a waveform's *information* is a few **harmonic amplitudes** (a pluck = `[1, 0.5, 0.25]`,
not 512 samples), which is **sparse in the harmonic domain** → carrier-clean. `carrierWaveSoliton`
puts `H` harmonic-amplitude atoms (each cell carries its *amplitude*, not 1) on its own carrier
(`makeCarrier(-1.4,1.4)` — orthogonal to the event carrier `(1.4,1.4)`, `|Δk|=2.8`), region-free.
Recovery: demodulate → recovered amplitude `= (demod_h / cleanDemod_h)·trueAmp_h` (gate on the ratio
for presence, return the value). **Synthesis:** `_playRoll` builds a `PeriodicWave` from the recovered
harmonics — so the note's **timbre IS the recovered spectrum**. All three modalities meet at synthesis:
events = pitch/timing, wave = timbre, image = depth; occlusion dims both (note gain + harmonic ratio).

Live scene: `unite([ carrierEventSoliton, imageSoliton(region), carrierWaveSoliton ])` — events ⊕ image
⊕ wave in ONE pure-cyc wavefront. **Mock-verified:** events f1=1.0, wave harmonics corr=1.0
(`[0.86,0.50,0.25,0.10,0.04]` — the true 1/h spectrum, holding under occl 0.5), image present; the two
carriers mutually orthogonal. (A bug was caught: normalizing the recovered amplitude by √energy
saturated every harmonic to ±1 and lost the spectrum shape (corr 0.76) — fixed to ratio·trueAmp →
corr 1.0.) This completes the united multimedia soliton: **image + events + sound, one wavefront,
region-free where sparse (carriers) + region where dense (image), pure-cyc, peer-synced, holographic,
composed via the algebra.** GPU-pending: live timbre should evolve bar-to-bar and dull/drop under `H`.

### 7.32 Binding gate — composition-as-COMPUTATION is real on the IFS medium (`bindingGate`, §9 opens)

§7.26–7.31 established **coexistence**: many solitons share one wavefront, masked together, recovered
separately. The open frontier was **computation** — one soliton *transforming* another via an operator
in the shared field, so the field carries the *result of A acting on B*, not just their superposition.
The natural holographic operator is field **multiplication**: `ψA·ψB` in space = **convolution/correlation**
in the carrier domain (the matched-filter / associative-recall mechanism). Whether that multiply↔convolve
relation — exact for Fourier — holds for the IFS **ring-kernel** was unmeasured. `bindingGate` decides it.

Two carrier-embedded patterns are bound by **pointwise complex product** (`ψA·ψB`, the binding `[H]`),
the bound field is round-tripped through the IFS medium (forward T → optional occlusion → back T), and
demodulated at the **sum carrier** `kA+kB` (where the product lands). A clean matched filter must do two
things a mere energy-conserving round-trip cannot fake:

- **(1) Graded** — recovered must *track the value* of the true `Σ A·B` as overlap goes 100%→0%.
  **Result: exact** — recovered = true to three decimals at every overlap (`1.000, 0.737, 0.526, 0.263,
  0.053`), curve-fit **1.000**. (The first attempt scored an illusory ∞× with *disjoint* patterns that
  shared no cell — the product was identically zero, nothing to smear; the graded test removed that trap.)
- **(2) Lag** — shift B by δ cells; a matched filter *peaks at δ=0 and falls off*. **Result: a textbook
  triangular peak** — `1.00` at δ=0, monotone symmetric to `0.00` once the shift exceeds the feature
  width (±20 cells, feature half-width 9). Peak@δ=0 **YES**, monotone both sides **YES**. (A first run's
  weak 1.2× falloff was a *test* artifact — shifting a 9-cell feature by only 3 cells; scaling the lag to
  the feature size revealed the true peak.)

**Verdict: BINDING COMPUTES.** The IFS field product reproduces both the *value* and the *location* of
the A·B correlation. Composition-as-computation is not just expressible in the soliton type (a Soliton
taking a Soliton) — it is **physically realized by the medium**. `[H]` in composition is therefore not
only a shared mask (§7.26): it can be a **cross-modal operator** where one modality's field acts on
another's, and the IFS round-trip carries out the correlation by physics. This is the concrete entry to
§9 (events×image gating, holographic associative recall). Trigger: ⊙ SOLITON + Alt+Ctrl/Cmd-click.

### 7.33 Gate operator — the first cross-modal binding operator, verified (`gate`, `gateOperator`)

§7.32 proved the *mechanism* (`ψA·ψB` → correlation); §7.33 turns it into a *usable operator* and the first
combinator that is **composition-as-computation**, not coexistence. `gate(controller, target)` is a Soliton
that **takes two Solitons**: the `controller` (a rhythm/event soliton on a carrier) **transforms** the
`target` (an image) by the binding `[H]` = pointwise field **product** in the shared wavefront — the target
survives *only where the controller's field is present*: **"image sampled where the beat fires."** Unlike
`unite` (§7.26, superpose-and-read-separately), here one modality *computes on* another.

`gateOperator` verifies it end-to-end on the GPU: a filled-disc image, an alternating 8-column beat mask,
gated by `ψ_img·ψ_rhythm`, round-tripped through the IFS medium, demodulated at the rhythm carrier.
**Result: fidelity 1.000** — the recovered field IS the exact gated image `c·r` (disc seen only through the
beat-ON columns), with **no measurable beat-OFF leakage** (OFF-column energy = 0; the earlier ∞× "selectivity"
was that zero, reported now as "no leakage" rather than a 12-digit ratio — the same degeneracy the binding
gate's graded test was built to avoid). The operator is wired as a closed combinator (`gate` in
`soliton-algebra.js`, result itself a Soliton, recovered via the controller carrier) and the engine routes
its field-valued readout through the panel recon. **The rhythm soliton physically transforms the image
soliton in one wavefront** — §9's "holographic computer" step is no longer abstract. Trigger: same as §7.32.

**Wired live (Shift+dbl-click ⊙ SOLITON):** the live scene becomes `unite([events, gate(events,image), wave])`
— audio (events/wave) untouched, panel 4 shows the **beat-gated image**: the picture appears only in the
columns the current bar plays, carved bar-by-bar by the rhythm. The gate is *coexistence-safe inside unite*:
the product `target·mask` is formed in an isolated scratch buffer (so it can't corrupt the other modalities'
already-superposed field) and only the gated result is added back, on its own carrier `(0.7,−0.7)` — distinct
from the event `(1.4,1.4)` and wave `(−1.4,1.4)` carriers, so all three stay demod-separable. This is the
first time the *computation* (not just the coexistence) of solitons is visible in the running engine.

### 7.34 The holographic-computing API — one `[H]` product, three readouts (`bind`)

§7.33's `gate` was one instance of a more general thing. The binding `[H]` is a small **instruction set on
one wavefront**, captured as a single primitive `bind(controller, target, {op, readout, refFn})` with
`gate`/`recognize`/`recall` as thin wrappers. **Three faces of the same IFS-correlation we proved in §7.32:**

| wrapper | op | readout | what it does | example |
|---|---|---|---|---|
| `gate` | `mask` (`ψ·r`) | `field` | **transform** — target where the mask passes | the beat carves the image (§7.33) |
| `recognizePure` | `conj` (`ψ·conj(ψ_ref)`) | `map` | **detect** (single-scale) — bright where the reference *occurs* | "give letter **A** → all A's light up" |
| `recall` | `conj` | `recall` (peak-select) | **complete** — recall the matched stored pattern from a noisy cue | Hopfield-IFS in the eye |

The unification answers the open question directly: **recall and recognition are the same operator** —
recognition keeps the *spatial* correlation map (**where** the reference occurs), recall reads the *peak*
and uses it to pull back **what** was stored. `gate` is the third face, where the reference is a selector
that *transforms* rather than *reports*. So the "holographic computer" (§9) is: pick an `op` (mask / product
/ conj) and a `readout` (field / map / recall) on one shared wavefront. **Proven so far:** the `product→
correlation` core (§7.32) and `mask/field` gating (§7.33). **New, ship-behind-measurement:** the `conj`
matched-filter op and the `map`/`recall` readouts — each gated by a `…Gate` probe before its wrapper is
trusted. `recognizeGate` is the first, and it **PASSES** (GPU-measured): a scene of 3 L-shapes (reference) +
2 +-shapes (distractors) in one field; the **proven** operator (`scene·ref_u → IFS round-trip → correlation
scalar`, §7.32) evaluated at each location scores **TRUE sites 1.00/1.00/1.00 vs distractors 0.11/0.11 —
9.5× ratio, every true site beats every distractor.** The L-detector discriminates *shape* (not energy)
through the medium → "give a reference, its occurrences score highest." Trigger: ⊙ SOLITON + Alt+Ctrl/Cmd
(logs after binding + gate).

> **Current state of the `[H]` combinators (→ §7.47):** the carrier-based `bind`/`gate`/`recognize`/`recall`
> described here (result demod-separated on a carrier out of a shared grid) are the ORIGINAL form, used by the
> non-temporal `evalSolitonAt` scene. In the live limit-cycle scene each combinator runs ALONE in its own clock
> phase, so the carrier is unnecessary: `regionBind` (and `gate(...,{temporal:true})`) writes the bound result
> directly into its phase and reads it back directly — carrier-free, no grid-mixing. The binding still FUSES its
> operands inside the phase (binding requires co-presence); only placement/recovery is carrier-free. The live
> recognizer is `recognizeFull({target,score})` (the FULL scale-search + discriminative recognizer as a closed
> node); `recognizePure` keeps the single-scale matched-filter for the pure case. So `[H]` computation is
> uniform with the modalities: **every node — object, operator, and bound result — is one field on the clock.**

### 7.35 Is the IFS LEAPFROG an FFT-analog for correlation? — NO (superseded; see §7.36)

The leapfrog round-trip is NOT shift-covariant (peak drifts 5–9 cells, superposition interferes), so it is not
an FFT-analog — but this was operator-specific and reframed by §7.36 (the pure ring convolution IS DFT-diagonal).
Full measurement detail in `native-ifs-holography-memory.md`. Net: the dense every-pixel map needs the pure-conv
path, not the leapfrog; candidate-position scoring (§7.34) is the correct primitive on the leapfrog.

### 7.36 The follow-up — the pure ring CONVOLUTION *is* DFT-diagonal (`convAnalogGate`)

§7.35's NO was operator-specific, and a sharp question reframed it: **one IFS step is a spatial CONVOLUTION**
(the ring stencil) → it *is* shift-invariant; §7.35 failed because it propagated the **leapfrog round-trip** (a
3-substep integrator + finite boundary + depth-staging), not the pure convolution. A convolution on a uniform
grid is **circulant ⇒ diagonalized by the DFT ⇒ the convolution theorem must hold.** `convAnalogGate` re-tests
the FFT claim against the **pure ring convolution** (periodic boundary, no leapfrog, in JS to remove all
confounds) and it **PASSES cleanly:**
- **(A) Shift-covariance: peak drift 0 cells** — the correlation peak tracks position 1:1 → the pure conv is
  DFT-diagonal, the convolution theorem holds.
- **(B) Superposition: [1.00, 1.00, 1.00]** — 3 patterns → 3 clean equal peaks in ONE map. The dense
  "all occurrences at once" map is real *on the pure convolution*.
- **(C) Scale: 0.7×→1.00, 1.0×→1.00, 1.4×→0.68** — *asymmetric* scale tolerance. I initially read this as a
  wavelet/fractal hint. **§7.37 REFUTED that:** the asymmetry is a mundane **downsampling artifact** (a shrunk
  pattern fits inside the reference footprint and still correlates; an enlarged one spills out and decorrelates)
  — not scale-covariance. Treat this row as an artifact, not a lead. See §7.37.

**Reconciling §7.35 and §7.36 (both true, different operators):** the medium *as it runs* (leapfrog) is NOT an
FFT-analog (§7.35); the *underlying convolution* IS (§7.36). **Consequence: the dense O(1) correlation map is
available IF a pure-convolution forward path is exposed** (one ring-convolution/step, periodic boundary) instead
of the leapfrog — a buildable unlock, not free today. **Process note:** the first §7.36 run *underclaimed* — its
verdict trusted a buggy sub-test (B sampled the wrong cell → false 0.00) and declared a negative that (A)
contradicted on the same run; fixed to rest the verdict on (A) (shift-covariance IS the theorem test). Trigger:
with §7.34/§7.35.

### 7.37 Is the IFS ring kernel WAVELET-like? — NO for uniform ring copies (superseded; see §7.38)

Testing *uniformly-scaled ring copies* gave no scale-covariance — but that was the WRONG construction. §7.38
shows the real fractal cascade (attractor-contraction scale ladder) IS scale-covariant. Detail in
`native-ifs-holography-memory.md`. Net: size-invariance comes from the cascade (§7.38), not uniform ring scaling.

### 7.38 The IFS fractal cascade IS wavelet-like — scale-covariant (`ifsWaveletGate`)

§7.37's NO was an artifact: it tested *uniformly-scaled copies* of one radius list, not the **fractal cascade**.
The codebase already has an IFS-native wavelet transform (`krestianstvo-wavefront-physics.js`: `ifsWavelet` /
`_ifsAnalyze` / `_ifsSynthesize` / `_buildDepthKernels`). Its scale ladder is the **attractor's contraction
cascade**: the IFS clock fires beat-tree children at delays scaled by the contraction maps (cos72°, √2−1, ½,
φ⁻¹, …), so each tree DEPTH emits ring radii at a contracted scale → a genuine multiresolution ladder generated
by the fractal. The insight (user): *the wavelet ≈ the fractal cascade*, and IFS's power is the kernel changing
dynamically across depth, not a static kernel. `ifsWaveletGate` re-tests on the REAL cascade with a proper
scale-selective (difference-of-scales / DoG) metric, and it **PASSES decisively:**
- **(1) Band scales [26,13,7,3,2]** — a genuine dyadic-like multiresolution ladder (not copies).
- **(2) Scale localization — 3/3 distinct bands, monotone:** disc R=4 → band r=3, R=9 → r=7, R=18 → r=13. Each
  object size lights up the band whose ring straddles its edge, **in order.** Size LOCALIZES to scale.
- **(3) Reconstruction corr 0.89** — `_ifsAnalyze`/`_ifsSynthesize` is a valid information-preserving transform.

**Verdict: the IFS ring kernel IS wavelet-like (scale-covariant) on the attractor-contracted cascade.** Combined
with §7.36 (the pure convolution is shift-covariant / DFT-diagonal), the medium gives **both** shift- AND scale-
covariance → position+size-invariant recognition: find a reference at any location AND any size, and report which
scale. This is strictly more than single-scale FFT. **Process (two corrections, user caught the premise):** §7.37
tested uniform copies (wrong construction); §7.38-v1 used a raw-energy metric that always picked the finest ring
(measured proximity, not scale-match) + an overshooting ladder — both fixed (clean dyadic ladder + DoG metric).
*Strict scope:* one radius per band (the production tree emits a set per depth) and intensity-domain analysis
(the `_ifsAnalyze` design) — so this validates the **scale-covariance of the cascade**, the basis for a full
wavelet recognition path, measured on the real transform. Trigger: with §7.34–7.37.

**Letter recognition on the GPU (∿ WAVE).** The cascade wavelet is ported to a fragment shader
(`recognizeWaveletGPU` / `GLSL_WAVELET_RECOG`): each cell builds its angular descriptor (bands × sectors)
and cosine-matches a reference descriptor uniform — the whole field in ONE pass (replaces ~500k JS
samples/bar), like the solitons. The demo recognizes the **letter A** rasterized (browser font) among
distractors B,C,E,F,H,K,R,T at GRID=128. Working settings found by iteration: **6 bands × 12 sectors**;
reference and page letters MUST share one cell size (a 0.42 vs 0.30 mismatch made it match denser letters);
the cosine match is **sharpened `cos^14`** because all letters score cosine in a narrow high band (~0.85–0.98,
every shape is "letter-ish") — the power stretches small differences so the exact A stays bright and K/R/B
collapse (lit-cell count dropped 2489 → 24). Result: **the A's light up brighter than the distractors** —
discrimination is real but *soft* (A-vs-E/F/H/K is near the descriptor's ceiling at 38px letters; the dial is
the cos power). This is end-to-end: IFS fractal-cascade wavelet, on the GPU, recognizing a letter shape.

### 7.40 Recognition: photographic in the recon, holographic in the hologram (summary)

Recognition reading the refocused recon (`viewTau`) DEGRADES with T (the photo blurs under `[H]` + deep
round-trip); recognition in the HOLOGRAM domain (`holoMasked`) HOLDS/RISES with T (delocalizes position →
reports PRESENCE, not where). Two complementary readouts, not competing. The ∿ HOLO mode reads presence as
a scalar meter. Full measurement (`holoRecogVsT`, the T-by-T study) in
[`holography-research.md`](holography-research.md) §7.40.
### 7.41 Working shape recognizer — triangle among square/circle, GPU, live (the demo that succeeded)

The recognition thread (§7.34–7.40) culminated in a clean, live demonstration: the **IFS fractal-cascade
wavelet recognizing a target SHAPE among distractors**, on the GPU, at any size, depth-staged. The scene
(∿ WAVE mode) is a non-overlapping 3×3 grid of geometric shapes — **target = triangle**, distractors =
square + circle — rotating per bar (clock-pure). The recognizer lights up the triangles; squares and circles
stay dark. The engineering that made the discrimination actually work (each found by measurement, several of
my over-claims/bugs corrected en route — the user caught them):

- **Outline shapes, not filled.** A filled shape is bright everywhere inside → the angular descriptor reads
  "blob" (identical for all shapes; it matched circles). The shape lives in the **boundary**: a triangle
  outline = 3-fold angular signature, square = 4-fold, circle = uniform → the cascade separates them.
- **Energy gates presence, doesn't scale the match.** `match = cos^sharpPow · clamp(energy·gate)` — the old
  `cos × energy` biased toward the densest shape (filled circles won).
- **Discriminative subtraction** (the leak killer): `match = relu(cos(target) − λ·cos(distractors))^sharpPow`,
  where the distractor descriptor is the **average of ALL distractors** (subtracting only one let the others
  leak — a bug that made it worse). λ≈0.5 moderate (1.0 over-penalized the target).
- **Scale-search** (§7.38): the reference is matched at several sizes (per-cell max) → triangles found at any
  size, glow sized to the matched scale. **Scale-consistency**: reference and page shapes share one cell size
  (a 0.42-vs-0.30 mismatch had made it match the wrong shape).
- **Non-overlapping layout**: fixed 3×3 pitch (`GRID/3`), base size so the largest scale fills ≤82% of a slot.
- **Tunable live**: `window.recogTune(sharpPow, energyGate, thr, disWeight)`.
- **Reference inset**: the propagated reference hologram is shown overlaying the events panel's corner, so the
  matched template is visible (spreads into interference as T rises — §7.40).

GPU path: `recognizeWaveletGPU`/`GLSL_WAVELET_RECOG` (each cell builds its angular descriptor + match in one
shader pass), `waveletRecognizeScaleGPU` (scale-search). **The full §7.36+§7.38 result, live and visible:**
shift-covariance (find anywhere) + scale-covariance (find any size) + shape discrimination, the fractal
cascade doing the work. *Honest scope:* discrimination is strong but tuning-dependent; geometric shapes
separate cleanly where 18px letters were near the descriptor's ceiling (§7.38).

### 7.42 Recursion, feedback & self-hosting — the soliton algebra's closure (current state)

Two questions about the algebra's self-reference, both answered measure-first. *(Full development
narrative — the carrier-packing failures, the SVD-fix iteration, the artifacts caught — is in
[`holography-research.md`](holography-research.md) §7.42.)*

- **Recursion / feedback.** Structural recursion is free (combinators closed over the Soliton type →
  `gate(a,gate(b,c))` nests, live). Temporal feedback is sound only as a **clock-pure fixed-point loop**
  (`fixedPointLoop` — fixed iterations from a clock seed → peer-synced). **RECALL is its first instance**
  (`recallGate`): Hopfield completion with measured limits (capacity M≈0.14N, basin ~45% noise),
  deterministic and sync-safe.
- **Self-hosting (the algebra as a soliton).** Objects: **yes** (`unite` is a monoid → a scene IS a
  soliton). Operator as ONE static field: **no** (a binding rule is a rank-n bilinear tensor; rank-1
  captures ~9%). Operator as a rank-K **stack**: **yes, constructive** (`operatorSoliton`/
  `fitOperatorSoliton` — K (U,V,W) triples from the rule's exact SVD). Operator as ONE field in **TIME**:
  **yes, exact** — `operatorSolitonCyc` walks the K ranks across K sub-ticks of the clock, the binding
  accumulating over one bar (GPU-verified corr **1.000** at the true bilinear rank). The space routes
  capped at 0.41 (dense ranks crosstalk when forced to coexist at one instant); time-multiplexing removes
  the coexistence. **DoF conserved, not cheated**: capacity = N_space × K_time.

**The unifying result (§7.43–7.44):** *dense things cannot share an instant, but they can share a clock.*
The binding **operator** (`operatorSolitonCyc`) and the **multimedia field** (`evalSolitonTemporalAt`,
`multimediaTemporalGate`) are the **same theorem** — the K ranks / M modalities that won't fit one frozen
instant ride the clock axis losslessly. Measured: temporal operator = 1.000 (vs space 0.41); temporal
media self-fidelity ≈1.0 (vs dense carrier ≈0.82). So the binding rule is no longer outside the algebra —
it is a soliton *in* it, a limit cycle on the same clock the objects use. **Everything — values and the
rule that combines them — is one field evolving on the one shared clock.**

**Wired live:** ⟳ CYCLE mode (⟳ OP = the operator walking its ranks, GPU≡JS corr 1.000; ⟳ MEDIA = carrier
≈0.82 vs temporal ≈1.0); the ⊙ SOLITON scene runs `evalSolitonTemporalAt` (modalities on the clock axis,
panel 1 cycles events→image→wave); ⊕ OP-CYC binds events⊗image on the GPU. Full-GPU operator path in
`ifs-gpu.js` (`opCycle*`, GLSL_DOT_ROWS + GLSL_SCATTER_MAD); engine `evalSolitonTemporalAt` in
`soliton-algebra.js`. The path from here toward a cyberphysical engine is in §9 below; the full
self-hosting development narrative (the carrier-packing failures, the SVD-fix iteration) is in
[`holography-research.md`](holography-research.md) §7.42.

### 7.43 — the operator IS one soliton, in TIME (`operatorSolitonCyc`, measured exact, GPU).
All three routes
above failed for the *same* structural reason: they force the K dense ranks to **coexist at one instant**, so
they crosstalk (the 0.41 wall is crosstalk, present even with NO medium — verified). The capacity theorem is
real and unbeatable: a dense rank-K operator needs K·(2N+1) numbers, more than one static N-cell field holds.
**Temporal multiplexing doesn't break that law — it trades the axis the K lives on.** The operator becomes ONE
field walking a **K-step limit cycle** on the shared IFS clock: at sub-tick `r = cyc mod K`, rank r is the
*only* one present, so its inner product `(U_r·a)(V_r·b)` is computed against zero interference; the binding
`Σ_r W_r·(U_r·a)(V_r·b)` accumulates by **temporal integration over one bar** (K ticks). Measured live on the
GPU (`operatorSolitonTemporal`): temporal-mux-NO-medium vs abstract **1.000**, through-the-IFS-medium vs abstract
**1.000** (the round-trip preserves each rank per tick), and through-medium vs the TRUE operator **1.000** at the
true bilinear rank — vs the space routes' 0.41. A K-sweep confirms `temporal·medium-vs-stack = 1.000` at every K
(faithful realization) while `stack-vs-true` rises **monotonically to 1.000** at the true rank.

Two things this also fixed/clarified: (a) the binding "rank" people quote is the tensor's **mode** count, but
`apply` sums **rank-1 bilinear** terms — a rank-3 *tensor* with non-rank-1 modes needs **9 rank-1 triples** to be
exact. `fitOperatorSoliton` was rewritten to **expand non-rank-1 modes** (the old "force rank-1" lost 18–35%/mode
→ ~0.83 ceiling) and **σ-guard garbage triples** past the true rank (the old version divided by σ≈0 → a
non-monotonic K-sweep dip). It now reaches 1.000 monotonically and caps `#triples` at the real rank. (b) The DoF
is **conserved, not cheated**: capacity = N_space × K_time; the K simply moved from K-side-by-side-in-space to
K-one-after-another-in-time.

**`operatorSolitonCyc(triples)`** reifies this as a value in the algebra: `rankAt(cyc)=cyc mod K` (pure clock
function → peer-synced by construction), `fieldAt(cyc)` = the live rank's output carrier, `applyTick(a,b,cyc)` =
the live rank's one-tick contribution, `applyCyc(a,b,cyc0)` = the full binding (one-bar integral, **=1.000 vs
`operatorSoliton.apply`**, bar-shift-invariant). **This is the constructive answer to Q2 (self-hosting):** the
objects are `cyc→field` (clock-pure, peer-synced) and now the *operator* is too — a limit cycle on the same
clock. The binding rule is no longer outside the algebra; it is a soliton *in* it. Everything — values and the
rule that combines them — is one field evolving on the one shared clock. Self-hosting achieved as a **limit
cycle**, not a static spatial stack: spatially one field at every instant, conceptually one soliton, with the
rank carried losslessly on the clock axis the medium already runs.

### 7.44 — the result GENERALIZES: "media as a limit cycle" (`multimediaTemporalGate`, measured).
The same question for MULTIMEDIA: the §7.3 scheme packs M modalities on M orthogonal CARRIERS in one field — clean for
SPARSE modalities (image 1.0 / sound 0.999) but it pays a DENSE cost (§7.29). Does time-phasing help, as it did
for the operator? Measured on TWO DENSE images, carrier-mux vs temporal-mux (modality A in phase-A ticks, B in
phase-B ticks of one bar, **the field propagating between phases** — the real risk): **CARRIER** self-fidelity
**0.817/0.816**, cross-leak 0.005; **TEMPORAL** self-fidelity **1.000/1.000**, cross-leak 0.006. Separation
margin (mean self − leak): temporal **0.994** vs carrier **0.811** → **temporal wins, the result TRANSFERS.**
Two honest refinements over the naive "phases at different frequencies, all clean" story: (a) the dense cost
showed up here as **self-degradation** (carrier 0.82), not cross-leak — so for the operator time removed
*crosstalk* (0.41→1.0), for media it removes *self-degradation* (0.82→1.0); **same axis-trade, different
symptom.** (b) The inter-phase drift risk did NOT materialize — each phase is a *matched, reversible* round-trip
and the receiver knows the phase boundary from the shared clock (it's `cyc`-pure), so it isolates each phase
exactly; the win is from **time-ordering + reversibility + clock-known boundaries**, NOT from any frequency-band
trick. The cost the framing omits is **refresh rate**: M phases → each modality updates M× slower; DoF conserved
as N_space × M_time, exactly as for the operator.

**The unifying statement, measured on both:** *dense things cannot share an instant, but they can share a clock.*
The operator (algebra) and the multimedia field are the **same theorem** — the K (ranks) or M (modalities) that
won't fit at one frozen instant ride the clock axis losslessly, on the same `cyc→field` machinery the solitons
already use. This is *why* the sound channel was already temporal (§7.6, the dt-schedule): it was the first
instance of a general principle.

**WIRED LIVE (⟳ CYCLE mode + the SOLITON scene).** Both limit cycles now run in the live UI: (1) ⟳ CYCLE
dedicated mode — ⟳ OP shows the operator walking its K ranks one-per-tick with the bound output accumulating
on the GPU (panel 4 shows GPU≡JS corr=1.000, the full-GPU dot-reduction + scatter-MAD accumulation verified
live); ⟳ MEDIA shows two dense images recovered CARRIER (≈0.82) vs TEMPORAL (≈1.0). (2) The ⊙ SOLITON scene
itself now runs through `evalSolitonTemporalAt` — the three modalities (events/image/wave) are separated on the
CLOCK axis (each alone in its bar phase), not by carriers: panel 1 visibly CYCLES events→image→wave bar-by-bar,
and events recover at f1=1.0 with a clean sharp image (the shortened per-phase propagation window did not hurt
the readouts). (3) ⊕ OP-CYC scene combinator (alongside GATE/RECOG) — the operator-as-clock binds events⊗image
on the GPU, one rank per bar, bound output on panel 4. The operator and the multimedia field are BOTH live
clock limit cycles now — "the algebra is one soliton on the shared clock," demonstrated, not just measured.
GPU path: `ifs-gpu.js` `opCycleInit/Upload/DotAB/Tick/ReadAcc` (GLSL_DOT_ROWS reduction + GLSL_SCATTER_MAD
accumulation textures); engine `evalSolitonTemporalAt` in `soliton-algebra.js`.

### 7.45 No-tricks truthness test — the WAVE computes the correlation, and unitarity preserves it (`operatorTruthnessTest`)

A "does the medium really compute this, or is it the JS CPU?" test, under strict rules: no `operatorSoliton.apply()`
(that is CPU matrix math), the operation must happen via real IFS propagation (`gpu.stepEyeN`), and the result
must be extracted by carrier DEMOD, not array reads. Two design corrections were needed before the test could
be honest — both instructive:

1. **The naive script compares the wrong operations.** "Embed A,B → propagate both → complex-multiply the
   holograms → back-propagate → compare to pointwise A∘B" fails, but NOT because the physics fails: forward-prop
   is ≈ a convolution, so a product of propagated holograms is a convolution-domain operation, not the pointwise
   product — a false FAIL. The operation the medium actually performs (§7.32) is: bind by product BEFORE
   propagation, then the demod at the SUM carrier reads the **correlation** Σ A·B. So the correct CPU ground
   truth is the correlation, and A,B go on **distinct** carriers (same-carrier embedding injects crosstalk into
   the test, not the engine).
2. **A forward+back round-trip is a no-op (the reversibility trap).** `stepEyeN(T,+dt)` then `stepEyeN(T,−dt)`
   is the exact inverse → returns the un-propagated field → the demod trivially matches the CPU at **100.00%
   with ~0 effective propagation**. This is the "perfect 1.0 is statistically impossible in a real sim" red flag,
   and it fired correctly. Fix: propagate **forward only** into the dispersed hologram domain and demod there,
   PLUS a divergence control measuring how far the propagated field moved from the input.

**Result (GPU, measured):** forward propagation **divergence = 1.40** (the field dispersed to 140% RMS change —
it genuinely transformed, looks like an interference pattern, not the input), **yet the hologram-domain demod
tracks Σ A·B to ~3 decimals at every overlap step** (1.000/0.806/0.602/0.380/0.185 vs CPU 1.000/0.803/0.603/
0.384/0.186). The combination — large divergence AND faithful tracking — cannot be a no-op fake. **The wave
computes the correlation through real dispersion.**

**Why the fidelity is ~1.0 and that is NOT suspicious here (the key insight):** the IFS forward step is
(near-)UNITARY (§7.28 — it preserves inner products). A carrier demod at kA+kB IS an inner product of the field
with a plane wave. Unitary propagation preserves inner products → the carrier-projected correlation amplitude is
**conserved** as the field disperses. So the ~1.0 is not luck and not the CPU — it is the medium being a
*lossless* analog correlator, which is exactly the property a faithful wave computer should have. The only
departure from a literal 1.000000 is float32 + boundary, below 3-decimal display at T=50.

**Honest scope boundary.** This proves the **correlation / matched-filter binding** (§7.32) is genuinely
wave-computed — one *atom* of the instruction set, now stress-tested under dispersion. It does NOT by itself
prove the full rank-K operator `Σ_r W_r·(U_r·a)(V_r·b)` is computed end-to-end by propagation: that path uses
the GPU dot-reduction + limit-cycle accumulation (GPU arithmetic, §7.43), which is GPU-but-not-wave-propagation.
So: the binding **atom is wave-physical (proven, lossless via unitarity)**; the operator **composition** of many
atoms is GPU-computed. That is the accurate line. Console: `opTruthness(T, trials)`.

### 7.46 Can the full operator be PURE PROPAGATION (no GPU reductions)? — NO on this medium (archived)

A long arc (`propagationDotTest`, `lensFocusDotTest`, `inverseFilterDotTest`, `fresnelFocusDotTest`,
`nlsSelfFocusDot`) asked whether the rank-K operator can be all-propagation. **Resolution: no native focusing
lens on this medium.** The IFS leapfrog is unitary but NOT Fourier-class (fails shift §7.35, focus, conjugate
lens, inverse filter, and Fresnel — five angles). The dot product Σψ IS the DC Fourier bin, recovered exactly by
the `_fft2d` / pure-conv path (§7.36, the asymptotic full-Fourier limit of the medium’s own Fresnel propagation),
but NOT by a finite leapfrog step. Nonlinear self-focusing (the genuine native lens) exists in the substrate but
is dormant at `GAMMA=0` (the live medium runs the LINEAR limit). **What stands:** the binding ATOM is
wave-physical and lossless via unitarity (§7.45); the operator COMPOSITION stays GPU arithmetic (or the DFT
eigenbasis). Full measurement detail (the lens hunt, the GAMMA=0 finding, the NLS analog) in
`native-ifs-holography-memory.md` §7.46–7.52.

### 7.47 Uniform combinators — every node is a clock phase, carrier-free (`regionBind`)

The temporal scene (§7.44) separates modalities by clock PHASE, but the combinators (`gate`/`recognize`/`recall`)
still isolated their output by a CARRIER — two different isolation mechanisms, non-uniform. Resolved: under
`evalSolitonTemporalAt` each combinator already runs ALONE in its bar phase, so the carrier (whose only job was
to demod the bound result out of a SHARED grid) is unnecessary. `regionBind` is the phase-native form — the
binding still FUSES its operands (forms target·controller in a scratch buffer; binding REQUIRES co-presence of
the operands, it cannot be spread across phases without un-fusing the multiply), but the result is written
DIRECTLY into the real channel and read back DIRECTLY (no e^{ikx} embed, no demod) — the `regionEventSoliton`
pattern applied to the operator. `gate(c,t,m,{temporal:true})` / `recognize(...,{temporal:true})` /
`recall(...,{temporal:true})` select it; `operatorSolitonCyc`/`operatorCycleBarGPU` were already carrier-free
(the prototype of the pattern). Verified (node, exact): gate field = image·mask 256/256; recognize map peaks at
the ref·target overlap (1.000); recall locates the peak (1.000).

**The uniform principle (closes the architecture).** FUSION happens *inside* a phase — a binding's operands, a
note + its timbre — because those must be co-present at one instant. SEQUENCING happens *across* phases — every
combinator and every modality is one clock phase. The limit cycle is the single isolation mechanism; the carrier
was a special case now subsumed. So every node of the algebra (objects AND operators AND bound results) is a
field on its own clock phase: no grid-mixing, one mental model. The carrier `bind`/`gate` path is retained for
the non-temporal `evalSolitonAt` scene (nothing regressed).

**The live recognizer, routed through the uniform node.** Before: the recognizer was procedural render-loop
code scoring `imageRecon` on the side; the recognizer combinator existed but wasn't in the scene. Now there are
TWO recognizer combinators in `soliton-algebra.js`: `recognizePure` (the pure single-scale matched-filter, kept
for future use) and `recognizeFull({target, score})` (the FULL recognizer — scale-search + discriminative
subtraction §7.38 — as a closed factory whose app/GPU dependency is INJECTED as `score`, keeping the algebra
module import-free). The live scene uses `recognizeFull` as a phase-native `'recog'` node in
`unite([events, recog(image), wave])` — it OWNS the
image clock phase (carrier-free, phase-isolated, uniform with gate), its `inject` places the letter page in its
phase, its `readout` returns that phase's recon, and the proven GPU scale-search (§7.38: scale-search +
discriminative subtraction) runs on the node's phase field — the recognition CAPABILITY lives inside the node's
phase (same principle as gate keeping its bind-fusion internal, §7.47). The GPU internals are unchanged (no
regression to the §7.38/7.41 demo); only the source of the scored field is now a uniform scene node, not a bare
image child read on the side. So the whole live scene — events, waveform, gate, recognizer — is combinator-uniform:
every node a clock phase.

### 7.48 The algebraic soliton field — the medium IS the processor (synthesis)

Step back from the individual results and what they add up to is a different *architecture*, not just a
clever encoding. Each piece was measured; here is what they jointly mean.

**The pieces, and what each proved.**
- **Objects are solitons** (§7.22, §7.26): a scene is `Ψ(cyc)` — a pure function of the shared clock, hence
  peer-synced by construction. The data is a wavefront.
- **Composition is computation** (§7.32–7.34): the field product `ψ_A·ψ_B` through the IFS round-trip
  *computes* the A·B correlation (matched filter, measured exact). `bind`/`gate`/`recognize`/`recall` are the
  instruction set — one `[H]` product, three readouts. Combining two solitons doesn't just overlay them; it
  **runs an operation** by physics.
- **Recognition is a physical read** (§7.38, §7.41): the fractal ring cascade is scale-covariant, so "find this
  shape at any size" is the medium decomposing the field into its own attractor-contracted scale bands — no
  external feature extractor.
- **Feedback / recall** (§7.42): recurrence exists as a clock-pure fixed-point loop, and associative recall is
  Hopfield completion in the field (measured capacity/basin). Memory is an attractor of the medium, not a
  lookup in separate RAM.
- **The operator is itself a soliton** (§7.43): the binding *rule* — not just the data — is reified as a value
  in the algebra, `Σ_r W_r·(U_r·a)(V_r·b)`, and it lives as a **clock limit cycle** (`operatorSolitonCyc`):
  one field walking its K ranks across K sub-ticks, the bound output accumulating over the bar to the exact
  result (GPU-verified corr=1.000). The thing that *operates* is the same kind of thing it operates on.
- **The whole multimedia field is a limit cycle too** (§7.44): modalities ride the clock axis, one per phase,
  carrier-free (`regionEventSoliton`/`regionWaveSoliton`) — "dense things can't share an instant, but they can
  share a clock."

**What it adds up to — and the honest claim.** Put together: the data is a wavefront; the operator that
transforms it is *also* a wavefront on the same clock; combining them runs the computation by propagation;
memory and feedback are attractors and fixed points of the same medium. **There is no separate CPU acting on
passive RAM.** The wave medium is the processor, the solitons are the programs *and* the data, and the field's
own geometry — its ring kernel, its fractal clock, its phase relationships — is the instruction set that
computes the next state. The soliton is, quite literally, **processing itself through time**: each tick the
clock advances, the rank/phase the rule is in advances, the field evolves, and the next state is computed by
the medium's physics rather than decoded by anything external. This is not a Von Neumann machine with a
fetch-execute loop over inert memory; it is an **algebraic soliton field** — a self-sorting, self-operating
geometric program. Calling it that is not metaphor: it is the system's mathematical reality, the way "the
operator is one field on the shared clock" is a theorem (§7.43) and not a slogan.

**Where the honesty line sits.** The *mechanisms* above are each GPU-measured (correlation-as-product, exact
operator-cycle, recall capacity, scale-covariance, temporal mux). What remains interpretive — and is flagged
as such — is the *reach*: this is demonstrated at small scale (Nr≈64 operator dims, a 3-modality scene, rank-3
rules), not as a general-purpose computer. The architecture is real and the primitives compose; whether the
algebra is *computationally universal* (can express arbitrary programs, not just bilinear bindings and
matched-filter reads) is **open** — an honest frontier, not a settled claim. The accurate statement is: within
its measured instruction set, the medium genuinely is the processor and the data is genuinely self-operating;
how far that instruction set extends is the next question, not a finished result.

---

## 8. IFS as a fractal-time generator

The IFS clock is not a detail of the propagator — it *is* the substrate. Each "tick" is a
fractal subdivision of time (the Fresnel IFS depth schedule), and the ring radii that
define the Laplacian are emitted by this clock. Consequences:

- **Depth = duration.** 3D structure is encoded in *how long* a wavefront evolves, not in a
  spatial coordinate. The clock is literally the depth axis (§3.3).
- **Reversibility = time symmetry.** Reconstruction is running the clock backward. The
  hologram is a *time-reversal* operation, not a spatial diffraction trick.
- **The medium has its own eigenstates** (solitons). Perception, memory, and reconstruction
  are all expressed as relaxation onto these eigenstates — the clock's stable orbits.

Calling IFS a **fractal-time generator** is precise: it generates the temporal scaffold on
which wavefronts live, spread, and refocus. Holography here is what that scaffold *does* to
a complex field.

---

## 9. The path: holographic computer → cyberphysical engine

The `[H]` slot (§4) is the doorway from holographic *imaging* to holographic *computing*.
Because operations in the hologram domain are distributed in object space, `[H]` is a place
to compute on whole wavefronts at once:

1. **Holographic memory (associative).** Superpose multiple objects' hologram fields into
   one; recall the nearest with a partial cue via soliton relaxation. The Hopfield-IFS
   associative memory already works in this engine — note this is a **nonlinear attractor**
   recall mechanism (eigenstate relaxation), *distinct* from the linear spatial redundancy
   that §5 shows the medium lacks for dense objects. Associative recall does not depend on
   the cut-in-half property; it competes stored patterns dynamically.

2. **Holographic transforms as computation.** Filters, phase masks, conjugation, and
   learned kernels placed in `[H]` perform wavefront-wide operations — a single pass that
   touches every object point. This is the kernel of a **holographic computer**: compute by
   transforming spread wavefronts, not by addressing individual cells.

3. **Multiplexing.** Multiple snaps at different angles (carrier-tagged) or different
   objects (associative) stored in one field — parallax, multi-view, and memory in a single
   complex medium.

4. **Cyberphysical engine.** KWE already runs the field as a **live, multiplayer, reactive
   world** (IFS fractal clock + Croquet synchronization + Renkon reactive model). The eye is
   a *continuous observer* of an evolving field, with persistence and hysteresis — a living
   perceptual loop, not a batch renderer. Coupling this loop to external sensors/actuators
   turns the holographic medium into a **cyberphysical engine**: a shared, synchronized,
   reversible wavefront substrate that perceives, remembers, and computes — clocked by
   fractal time.

The progression is therefore:

```
IFS fractal-time generator
        │  (defines a reversible wavefront medium)
        ▼
Native IFS holography           ← exact reversible reconstruction [PROVEN];
        │                          holographic redundancy for STRUCTURED + depth objects (real scenes); fragile only for incompressible noise (§5)
        │  (add the [H] transform slot)
        ▼
Holographic computer            ← associative memory, wavefront-wide transforms [IN PROGRESS]
        │  (couple to a live, synced, reactive world + I/O)
        ▼
Cyberphysical engine            ← perceiving/remembering/computing shared medium [VISION]
```

---


## 10. Status summary

| Capability | Status |
|---|---|
| Reversible IFS propagator (leapfrog, symplectic) | ✅ verified to machine precision |
| Exact reconstruction (no GS / phase-shift) | ✅ point source, 100 % energy |
| Distributed spatial redundancy (cut-in-half) | ✅ for STRUCTURED + depth objects (real-scene proxy above photo line, visually confirmed); fragile only for incompressible noise (§5) |
| Holographic eye (5-stage live pipeline) | ✅ working, with soliton percept |
| `[H]` hologram-domain transform slot | ✅ several modes (filter/occlude/conjugate) |
| Save / load hologram field (`.kwe`) | ✅ stores `ψ_holo'`, reconstructs on load |
| Depth = evolution time τ (3D from duration) | ✅ staged multi-depth injection in the eye (§5.2c–d) |
| Depth Explorer (τ-scrub, native depth vision) | ✅ `⊙ EXPLORE` + τ slider; depth-of-field; masks the hologram (§6) |
| Per-layer depth-slice refocus (tomographic) | ✅ exact in isolation (score 1.000); multi-layer swamped by cross-layer blur (§6) |
| IFS sound holography (1D, reversible) | ✅ round-trip fidelity 1.000 (§7.1) |
| Combined-field multimedia (image+sound, 1 field) | ✅ carrier multiplex, balanced & tunable (`⊙ MM`, §7.3) |
| Converged depth+sound, one field, one τ | ✅ `◎ EXPLORE` + `♪ SOUND` (§7.4) |
| Clock-modulated sound (no carrier/depth slot) | ✅ "no tricks" — image 1.000 / sound 0.999, orthogonal failure modes (§7.6) |
| Sound = the live IFS heartbeat (clock → dt) | ✅ `⊙ CLOCK` — fresnelBeat envelope modulates dt; GPU-verified (§7.7) |
| Event-timing holography (rhythm IN the field) | ✅ discrete events stored & peak-detected back; structure-gated f1≈1@r=0 (§7.9) |
| **Unified field** — one substrate, 3 faces, one τ | ✅ `⊙ BEAT` — events encoded once (fine-onset biased); image/groove/waveform all read from one recon (§7.10); 2D occlusion-redundancy GPU-verify pending |
| **United field** — image+events+voice, 1 wavefront | ✅ `⊙ UNITED` (§7.14), GPU-verified r=0/0.5; SAVE/LOAD stores the one `holo` + geom, replays all 3 readouts + depth on load |
| **United SOLITON** — live continuous advected field | ✅ `⊙ SOLITON` (§7.15) GPU-measured: events (rhythm) FLAT f1≈0.85 across D = true soliton; dense voice decays to ~0.31 (structure-gated, events ⟂ voice). Image-depth + rhythm flow coherently |
| **Voice-as-events** — sound as holographic piano roll | ⚠️ `⊙ SOLITON` roll (§7.16): melody recovered from field, clear arpeggio, clock-pure & peer-synced. But occlusion-vs-T (ctrl-click) shows recovery is only WEAKLY holographic: survival ≈ 1−r (PHOTOGRAPHIC) at most depths; genuine redundancy appears ONLY at light occl + deep T (r=0.25,T≥200→1.0); heavy occl (r=0.75) gets WORSE with T (0.25→0.00, spreading thins each note). Sparse melody flows & syncs; holographic occl-robustness is marginal, not the headline |
| One live holographic soliton `Ψ(cyc)` — peer-synced at any T | ✅ `⊙ SOLITON` (§7.22): field is a pure fn of cycleCount (no integration) → two peers at different frame rates compute identical field (corr=1.0). The recon reads the actual masked `Ψ(cyc)` (one object, not an isolated re-holograph): `H` masks the live wavefront, recovery is clean at r=0, degrades gracefully + improves with depth, no multi-bar contamination |
| Soliton ALGEBRA — first-class composable solitons | ✅ `soliton-algebra.js` (§7.26): `Soliton = cyc→field`; `unite/place/atDepth` combinators closed over the type; composite auto pure-cyc → peer-synced; live SOLITON wired to it |
| Subspace projectors — orthogonality ≠ spatial | ✅ (§7.27) `Subspace.coherence`; region/carrier/band/depth descriptors; `unite` basis-agnostic check |
| Unitarity gate — IFS preserves orthogonality | ✅ GPU-measured (§7.28): two orthogonal fields stay orthogonal (overlap ~0.001) + norm ~1 to T=350 → ANY orthonormal basis preserved on the united field by construction |
| Carrier (region-free) composition | ✅ GPU-measured (§7.29–7.30): medium adds zero carrier mixing (off-diag flat 0.37 @ T=10/427 = unitary mock); gated by SPARSITY (sparse 0.06 / dense 0.37). `carrierEventSoliton` wired live: events region-free, image clean, one wavefront — orthogonal-region constraint DISSOLVED for sparse modalities |
| Waveform soliton — timbre synthesized from harmonics | ✅ (§7.31) `carrierWaveSoliton`: sound = sparse harmonic-amplitude atoms on own carrier; recovered harmonics → `PeriodicWave` (timbre IS the recovered spectrum). Live scene = `unite([events, image, wave])` — 3 modalities, one wavefront. Mock: wave corr=1.0, events f1=1.0, holds under occl |
| Associative multi-object memory | ◻ Hopfield-IFS works; multiplex into eye pending |
| Cross-modal `[H]` — composition-as-COMPUTATION | ✅ GPU-measured (§7.32–7.33). MECHANISM (`bindingGate`): field product `ψA·ψB` reproduces the A·B **correlation** — graded curve-fit **1.000** + textbook lag peak at δ=0 → multiply↔convolve HOLDS on the ring-kernel. OPERATOR (`gate` + `gateOperator`): events GATE image, **fidelity 1.000** (exact `c·r`, "image where the beat fires"). Wired live (⊞ GATE button). First Soliton-taking-Solitons combinator → `[H]` is a cross-modal operator, not just a shared mask |
| Holographic-computing API — `bind(op, readout)` | ✅ structure (§7.34) `bind`/`gate`/`recognize`/`recall`: one `[H]` primitive, op∈{mask,product,conj} × readout∈{field,map,recall} → transform / detect / complete. Unifies recall=recognition (same operator, map vs peak readout). `gate`+`product` proven; `conj`+`map`/`recall` ship behind measurement |
| Recognition — "give a reference → occurrences light up" | ✅ GPU-measured (§7.34) `recognizeGate`: proven correlation operator (scene·ref_u → IFS round-trip, §7.32) at each location → TRUE sites **1.00** vs distractors **0.11** (9.5×, every true site wins). L-detector discriminates SHAPE through the medium. Scope: candidate-position discrimination (not a dense every-pixel map). **Wired live: ⊡ RECOG** — per-bar glyph grid (L vs +), `recognizeLive` lights up the matched L's (green glow + edges). |
| IFS LEAPFROG as FFT-analog (dense map) | ❌ §7.35 `fftAnalogGate`: the leapfrog ROUND-TRIP is NOT shift-covariant (peak 5–9 cells off, systematic offset, superposition interferes). The medium as it runs gives no free dense map |
| IFS pure CONVOLUTION is DFT-diagonal | ✅ §7.36 `convAnalogGate`: ONE IFS step = spatial convolution = circulant ⇒ DFT-diagonal. Pure conv (periodic boundary, no leapfrog): peak drift **0** (shift-covariant), superposition **[1,1,1]** (K peaks, one map). §7.35's NO was the leapfrog/boundary, NOT the convolution |
| THREE live recognition modes, three operators | ✅ Three buttons on the toolbar, each a DIFFERENT operator: **⊡ CAND** (§7.34/§7.38) candidate slots via the IFS leapfrog ROUND-TRIP, scale-search per slot (the medium operator; slow at high T); **∿ WAVE** (§7.38) the IFS-native fractal-cascade WAVELET (`waveletRecognize`/_ifsAnalyze) — size reported by scale-band, dense glow hue-by-size; **⊞ FFT** (§7.36) pure-conv DFT dense (`denseRecognizeScale`) — every pixel via the convolution theorem, O(N log N), T-independent. Click a button to select, click again = off. Each labeled by which operator runs |
| Wavelet (multi-scale) / scale-covariance | ✅ §7.38 `ifsWaveletGate` (supersedes §7.37): on the REAL fractal cascade (`ifsWavelet`/_ifsAnalyze, attractor-contracted bands [26,13,7,3,2]) + DoG metric → object size LOCALIZES to scale-band 3/3 monotone (disc R=4→r3, 9→r7, 18→r13), recon 0.89. The IFS ring kernel IS wavelet-like. With §7.36: shift AND scale covariance = position+size-invariant recognition |
| **Live shape recognizer (the working demo)** | ✅ §7.41 ∿ WAVE: GPU fractal-cascade wavelet recognizes a **triangle** among square/circle distractors — any position, any size (scale-search), depth-staged, non-overlapping 3×3 scene. Clean discrimination via: OUTLINE shapes (boundary not fill), energy-gates-not-scales, **discriminative subtraction** `relu(cos(tgt)−λ·cos(distractors))` (avg ALL distractors), `cos^sharpPow` sharpen. Tunable `recogTune(sharpPow,energyGate,thr,disWeight)`; ref-hologram inset shown. `recognizeWaveletGPU`/`GLSL_WAVELET_RECOG` (one shader pass). The full §7.36+§7.38 (shift+scale+shape) live |
| Recursion / feedback / self-hosting (§9) | ✅ §7.42: structural recursion free (closed combinators nest); temporal feedback = clock-pure fixed-point loop (peer-synced); RECALL = Hopfield completion (capacity ~0.14N, basin ~45%); operator self-hosts as a rank-K STACK (`operatorSoliton`/`fitOperatorSoliton`, exact-SVD, → 1.0 at true bilinear rank) |
| Operator as a clock LIMIT CYCLE (§7.43) | ✅ `operatorSolitonCyc`: the rank-K binding operator walks its K ranks across K sub-ticks → one field-in-time = the exact operator (GPU-verified corr 1.000). Full-GPU path (`opCycle*` + GLSL_DOT_ROWS/SCATTER_MAD). Live: ⟳ CYCLE / ⟳ OP |
| Media as a limit cycle (§7.44) | ✅ `multimediaTemporalGate` + `evalSolitonTemporalAt`: modalities separated on the CLOCK axis (each alone in its bar phase, carrier-free `regionEventSoliton`/`regionWaveSoliton`) — dense self-fid ≈1.0 (vs carrier ≈0.82). Live ⊙ SOLITON scene runs temporal; ⟳ PHASE picks the displayed phase |
| No-tricks truthness — wave computes the correlation | ✅ §7.45 `operatorTruthnessTest`: bind→real forward propagation→carrier demod tracks Σ A·B through full dispersion (divergence 1.4) — the WAVE computes it, lossless via unitarity. Atom wave-physical; composition GPU (console `opTruthness`) |
| Uniform combinators — every node a clock phase (§7.47) | ✅ `regionBind`: gate/recognize/recall carrier-free, each its own phase (`{temporal:true}`); binding fuses operands inside the phase, sequences across phases. Live gate = `gate(...,{temporal:true})`; recognizer = `recognizeFull({target,score})` node. `recognizePure` kept for the single-scale case |
| Holographic computing via `[H]` | ◻ slot live; computational transforms pending |
| Cyberphysical I/O coupling | ◻ vision |

---

*Files: `public/hologram_world.js` (IFS clock + world program; `GAMMA=0` → linear-limit NLS),
`public/holography.js` (`IFSEye`, `IFSHologram`, `IFSSound` + multimedia + all §7.32–7.46 measurement
probes), `public/ifs-gpu.js` (GPU leapfrog + `[H]` shaders + operator-cycle reduction/scatter shaders),
`public/krestianstvo-wavefront-physics.js` (the NLS Strang-split substrate, `ifsWavelet`, instanton/vortex),
`public/apps/eye.js` (live eye + depth explorer + multimedia + ⟳ CYCLE limit-cycle demos),
`public/soliton-algebra.js` (first-class composable solitons; `unite`/`place`/`atDepth`; the
`bind`/`gate`/`recognizePure`/`recognizeFull`/`recall` API; carrier AND carrier-free `regionBind` (§7.47);
`operatorSoliton`/`operatorSolitonCyc`/`fitOperatorSoliton` (§7.43); `evalSolitonAt` (carrier scene) and
`evalSolitonTemporalAt` (limit-cycle scene)).
Full research history (superseded paths, the lens hunt, NLS analog) archived in
`native-ifs-holography-memory.md`.
Constants: GRID, DT=0.12, T_RECORD=100, N_DEPTH_TIERS=4, IFS_DEPTH=8.*
