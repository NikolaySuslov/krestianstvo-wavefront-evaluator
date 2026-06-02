# Native IFS Holography in the Krestianstvo Wavefront Evaluator

*An overview of holography performed not with light and lenses, but with a fractal-time
generator — and the path from it toward a holographic computer.*

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
| Spread | global, instantaneous | diffusive, **depth-gated** (see §5) |
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

### 5.2 The occlusion-redundancy curve — *holography is depth-gated*

Measured reconstruction score vs. occluded fraction `r`, at shallow (`T=100`) and deep
(`T=350`) propagation:

```
  r       T=100     T=350      photo line (1−r)
 0.00     1.000     1.000      1.00     ← T=350 r=0 still perfect: Float32 NOT eroding result
 0.25     0.981     0.952      0.75
 0.40     0.872     0.917      0.60     ← curves diverge past r≈0.4 (redundancy starts to matter)
 0.50     0.707     0.857      0.50
 0.75     0.234     0.559      0.25     ← T=350 more than 2× T=100
 0.90     0.000     0.258      0.10     ← decisive: same object & occlusion, only T differs
```

- **T=100** tracks the photo line and **collapses to 0.000 at r=0.9** — convex, photographic.
  Shallow propagation leaves the spread **local**: occluding a region deletes the object
  points whose energy landed there.
- **T=350** stays **far above** the photo line and **never collapses** (0.258 at r=0.9) —
  concave, graceful degradation. Deep propagation makes the spread **global**: every point's
  energy reaches the whole grid, so any fragment carries the whole object.

This is the **cut-the-hologram-in-half property**, reproduced in a fractal medium, and
**quantified**: the holographic regime switches on with propagation depth `T`.

### 5.3 Interpretation — and a corrected earlier conclusion

An earlier result held that "the holographic plate approach fails for the IFS soliton."
The occlusion curves **refine** this: it didn't fail fundamentally — the test had been run
**too shallow**. The IFS ring operator is *diffusive* (slow, local) where Fresnel/Fourier is
*instantaneous and global*. Holographic redundancy requires global spread, which the
diffusive operator only reaches at **deep T**. The transition from local→global spread is
the transition from photographic→holographic behavior. KWE is genuinely holographic; the
control parameter is the **fractal-clock duration**.

### 5.4 Honest caveats

- **Float32 precision.** At deep T (700+ steps for a round trip) rounding accumulates;
  the `r=0` score is the ceiling. At `T=350` that ceiling is still 1.000, so the §5.2 result
  is clean — graceful degradation is physics, not precision.
- **Spectral redundancy is confounded.** The rings are a convolution stencil, not an
  orthogonal basis; the only rigorous spectral axis is Fourier. Same-kernel ring-band tests
  are trivially perfect (any band-limited operator is self-invertible) and intensity-scored
  band tests saturate on sparse geometry — both are uninformative. **Spatial** redundancy
  (§5.2) is the clean, established result.

---

## 6. IFS as a fractal-time generator

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

## 7. The path: holographic computer → cyberphysical engine

The `[H]` slot (§4) is the doorway from holographic *imaging* to holographic *computing*.
Because operations in the hologram domain are distributed in object space, `[H]` is a place
to compute on whole wavefronts at once:

1. **Holographic memory (associative).** Superpose multiple objects' hologram fields into
   one; recall the nearest with a partial cue via soliton relaxation. The Hopfield-IFS
   associative memory already works in this engine; the depth-gated global spread (§5.2) is
   the substrate that makes content-addressable recall robust to partial input.

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
        │  (defines a reversible, depth-gated wavefront medium)
        ▼
Native IFS holography           ← exact reconstruction + true (depth-gated) redundancy [PROVEN]
        │  (add the [H] transform slot)
        ▼
Holographic computer            ← associative memory, wavefront-wide transforms [IN PROGRESS]
        │  (couple to a live, synced, reactive world + I/O)
        ▼
Cyberphysical engine            ← perceiving/remembering/computing shared medium [VISION]
```

---

## 8. Status summary

| Capability | Status |
|---|---|
| Reversible IFS propagator (leapfrog, symplectic) | ✅ verified to machine precision |
| Exact reconstruction (no GS / phase-shift) | ✅ point source, 100 % energy |
| True holographic redundancy (cut-in-half) | ✅ proven, depth-gated (T≈350) |
| Holographic eye (5-stage live pipeline) | ✅ working, with soliton percept |
| `[H]` hologram-domain transform slot | ✅ several modes (filter/occlude/conjugate) |
| Save / load hologram field (`.kwe`) | ✅ stores `ψ_holo'`, reconstructs on load |
| Per-point depth encoding (3D from duration) | ◻ designed (tier schedule), not in eye yet |
| Associative multi-object memory | ◻ Hopfield-IFS works; multiplex into eye pending |
| Holographic computing via `[H]` | ◻ slot live; computational transforms pending |
| Cyberphysical I/O coupling | ◻ vision |

---

*Files: `public/hologram_world.js` (IFS clock + world program), `public/holography.js`
(`IFSEye`, `IFSHologram`), `public/ifs-gpu.js` (GPU leapfrog + `[H]` shaders),
`public/apps/eye.js` (live eye demo). Constants: GRID, DT=0.12, T_RECORD=100,
N_DEPTH_TIERS=4, IFS_DEPTH=8.*
