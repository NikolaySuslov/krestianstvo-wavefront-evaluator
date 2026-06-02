# Native IFS Solitons, Instantons & the NLS Field — and the End of Frames

*How the Krestianstvo Wavefront Evaluator (KWE) replaces the frame-based picture of
computer graphics with a continuous, self-organizing nonlinear field — solitons that
persist, instantons that tunnel, and a display that is the physics, not a recording of it.*

---

## 1. The core idea

Conventional computer graphics produces **frames**: discrete images, computed one at a
time, swapped 60 times a second to fake motion. Each frame is stateless — the renderer
recomputes the world from scratch and throws the result away.

KWE proposes the opposite. The image is a **field** `ψ(x,t)` that **evolves continuously
and carries its own state**. What you see is not a sequence of rendered pictures but the
**live amplitude of a nonlinear wave** obeying the IFS-native Nonlinear Schrödinger (NLS)
equation. Motion, persistence, collision, and structure are not animated — they are
**solutions of the equation**. There are no frames; there is a field, and a clock.

This document covers the three native field objects — **solitons**, **instantons**, and
the **driven-dissipative display** — and the graphics vision they imply.

---

## 2. The IFS-native NLS field

### 2.1 The equation

The field obeys a 2D **Nonlinear Schrödinger equation** with a *fractional, fractal*
dispersion operator:

```
i ∂ₜ ψ  =  − L_IFS ψ  +  GAMMA · g(|ψ|²) · ψ
```

- `L_IFS` — the **IFS fractal Laplacian** (the ring operator from the holography work):
  a sum over IFS-emitted ring radii, evolved by a reversible symplectic leapfrog.
- `GAMMA = −0.25` — **focusing** cubic nonlinearity (negative → self-attraction).
- `g(|ψ|²)` — a **saturable** nonlinearity (`ISAT = 20`), so self-focusing arrests before
  blow-up: `g = |ψ|² / (1 + |ψ|²/ISAT)`. Saturation is what gives **stable** solitons
  rather than collapsing spikes.

### 2.2 The fractional order is *emergent*, not imposed

This is the defining novelty (see `nls3.js`). Classical fractional NLS imposes a Riesz
kernel `K(r) = 1/r^{2s}` with a chosen order `s`. KWE imposes **nothing**. The dispersion
weights come from the **IFS empirical measure** — the visit-count of the fractal clock over
each ring radius:

```
w(r) = FRAC_ALPHA · count(r) / totalBeats
```

The IFS attractor has log-uniform density `ρ(r) ~ 1/r`, which yields an **effective
fractional order s ≈ 0.5** — but `s` is **not a free parameter**. It *emerges* from the IFS
contraction ratios `{0.309, 0.414, 0.5, 0.618, 0.707, 0.732}` each cycle, and is estimated
live from the log-log slope of `w(r)` vs `r`. **Change the IFS geometry → change the
dispersion physics.** The fractal clock doesn't just time the simulation; it *defines* the
medium's wave law.

### 2.3 Why this matters

The medium is **self-defining**: the same IFS clock that advances time also sets the
Laplacian that governs propagation. The field and its law of motion share one fractal
substrate. This is the thread that unifies the soliton, instanton, and holography work —
all three are behaviors of *one* IFS-clocked NLS field.

---

## 3. Solitons — persistent, self-organizing structure

A **soliton** is a self-reinforcing wave packet: dispersion (which spreads it) is exactly
balanced by focusing nonlinearity (which pulls it together). The packet **holds its shape**
as it moves — a particle made of field.

In KWE solitons are not drawn; they are **injected and then left to live**:

- **Click the canvas → inject a soliton.** A `sech`-envelope packet is seeded; the NLS
  dynamics sustain it. (Replicated to all peers via Croquet determinism.)
- **They move, collide, and survive.** `nls4.js` seeds two counter-propagating solitons
  that collide at the screen boundary and **pass through each other with a phase shift** —
  the textbook signature of true soliton stability, here under *fractional IFS dispersion*.
- **They are stateful.** The packet at time `t` depends on its entire history. This is the
  opposite of a frame: nothing is recomputed from scratch.

`nls4.js` also splits one field across **two browser windows** (left/right halves on two
peers), and the soliton crosses the seam between physical screens — a single continuous
field rendered as a distributed display. The soliton is the unit of content, not the pixel
and not the frame.

---

## 4. Instantons — topological tunneling events

Where a soliton is a stable *thing*, an **instanton** is a stable *event*: a finite-action
trajectory by which the field tunnels between two topological vacua (`instanton3.js`).

The 2D focusing NLS field has distinct **topological sectors** indexed by a conserved
charge `Q` (a winding number of the phase):

- **Vacuum A (`Q = 0`)** — a single bright soliton at center.
- **Vacuum B (`Q = ±1`)** — three solitons with `2π/3` relative phase offsets, carrying net
  winding.

Injecting a **vortex** (`+1`) or **anti-vortex** (`−1`) drives an **A → B tunneling arc** —
the topological transition is the instanton. The charge `Q` is computed live from the phase
winding and displayed; it changes in integer steps as vortices are injected. This is
genuine topological physics: `Q` cannot change continuously, only by a discrete tunneling
event, and the instanton is the field's path through that event.

Controls: click → soliton; right-click → vortex (triggers the instanton); Phase A / Phase B
buttons reset the vacuum.

---

## 5. The instanton hologram — recording a topological event

`instanton_hologram.js` fuses the two threads: it **holograms an instanton**. Not an object,
not a static scene — a *topological tunneling event* recorded and reconstructed.

```
RECORD:  NLS + IFS propagation; plate accumulates |ψ + ψ_ref|²   (tilted plane-wave ref)
RECON:   plate × conj(ψ_ref) seeds ψ;  backward IFS steps refocus the arc
```

The reconstruction recovers the **A → B tunneling arc** — the instanton's worldline through
the topological transition. This is conceptually striking: the hologram stores not a shape
but a *process* — the field's trajectory between vacua. Because depth in the IFS medium is
*duration* (see the holography overview), and the instanton is itself a temporal event,
holographing it is natural: the time-axis of the recording *is* the instanton's evolution.

This is where solitons, instantons, holography, and the fractal clock meet in one demo:
a reversible, IFS-clocked NLS field recording and replaying a topological event of itself.

---

## 6. The driven-dissipative soliton display

A purely conservative soliton drifts and is sensitive to perturbation. For a **display** —
something you watch indefinitely and interact with — KWE uses a **driven-dissipative**
regime: the field is continuously *driven* toward a target and gently *damped*, so it
settles onto a **stable attractor** and stays there, while remaining live and responsive.

The mechanism is the relaxation injection (`SRC_ALPHA = 0.08`):

```
ψ  ←  ψ  +  α · (ψ_target − ψ)        each step
```

- **Driven**: pulled toward `ψ_target` (the injected soliton / object field).
- **Dissipative**: the pull damps deviations → bounded, stable steady state.
- **Result**: a soliton that **holds its form on screen indefinitely**, "breathes" with the
  fractal clock, and **responds continuously** to interaction (clicks inject, the attractor
  shifts, the field flows to the new state).

This is the display model that makes a frameless graphics system *usable*: a conservative
field would wander; a driven-dissipative field **locks onto a perceivable attractor** yet
never freezes. It is the same mechanism the holographic eye uses to settle a percept onto a
soliton eigenstate — perception and display are the same operation (relaxation onto a stable
orbit of the IFS-NLS medium).

**Note (subtlety carried from the holography work):** driving toward a target that *equals*
the current state is a no-op (`α·(ψ−ψ)=0`); the relaxation only does work when target and
state differ. Meaningful driven-dissipative behavior requires the target (interaction,
incoming wavefront, or a perturbed seed) to differ from the held state — which is exactly
the live, interactive case.

---

## 7. The vision: graphics without frames

Put together, these pieces sketch a different foundation for moving images.

### 7.1 What a frame-based system does

```
for each 1/60 s:
    clear buffer
    recompute entire scene from scratch
    render to pixels
    swap, discard
```

State lives in application data structures; the *image* is stateless and disposable. Motion
is an illusion assembled from independent snapshots. Continuity is faked.

### 7.2 What an IFS-NLS field does

```
once:   inject structure (solitons / vacua) into the field ψ
then:   ψ evolves continuously under IFS-NLS;  the field IS the image
        - motion = soliton propagation (a solution, not a tween)
        - persistence = soliton stability (state is intrinsic)
        - interaction = perturbing a living attractor
        - depth = duration of fractal-clock evolution
        - the display is the physics, sampled for viewing, never "rebuilt"
```

There are **no frames**. There is a field with memory, a fractal clock advancing it, and a
viewer sampling its amplitude. "Animation" is what the field *does*; "rendering" is just
reading `|ψ|²`. The distinction between *simulation* and *display* dissolves — they are the
same continuous object.

### 7.3 Properties this buys

- **Intrinsic continuity & persistence.** No tweening, no interpolation — motion and
  memory are properties of the solution. A soliton that moves right keeps moving right
  because that is what the equation says.
- **Content as structure, not pixels.** The unit of content is a soliton / vacuum / instanton
  — a coherent, addressable, physical object in the field — not an array of color samples.
- **Native interactivity.** Interaction perturbs a living attractor; the field flows to a
  new stable state. No event→rerender loop; the loop is the physics.
- **Distributed by construction.** The field is deterministic and Croquet-synchronized
  (`nls4.js`): the same evolving field across many peers and screens, with no frame
  shipping — only the clock and the events are shared.
- **Reversible & recordable.** Because the propagator is reversible, any state can be
  wound back, holographed, saved, and replayed (the instanton hologram). A "recording" is a
  hologram of a process, not a video of pixels.
- **Resolution-independent in time.** Depth and motion are *durations* of fractal-clock
  evolution, not sampled at a fixed frame rate. The clock is fractal — time itself has
  structure at every scale.

### 7.4 The claim

> The future of moving images is not faster frames but **no frames** — a continuous,
> stateful, self-organizing field whose evolution *is* the animation. Solitons are the
> objects, instantons are the events, the driven-dissipative regime is the display, and the
> IFS fractal clock is the time. Computer graphics becomes **live physics you sample**,
> not pictures you assemble.

---

## 8. Status

| Capability | Where | Status |
|---|---|---|
| IFS-native NLS field (emergent fractional `s`) | `nls3.js` | ✅ working, `s_eff` shown live |
| Stable saturable solitons | `nls3.js` | ✅ inject + persist |
| Soliton collision / pass-through (fractional dispersion) | `nls4.js` | ✅ two-soliton collision |
| Distributed field across screens | `nls4.js` | ✅ split-view, Croquet-synced |
| Topological vacua + charge `Q` | `instanton3.js` | ✅ A/B vacua, live `Q` |
| Instanton tunneling (vortex-driven A→B) | `instanton3.js` | ✅ vortex injection |
| Instanton hologram (record/reconstruct an event) | `instanton_hologram.js` | ✅ RECORD/RECON |
| Driven-dissipative stable display | `SRC_ALPHA` relaxation | ✅ across apps |
| Frameless graphics framework (general) | — | ◻ vision / research direction |

---

*Files: `public/apps/nls3.js` (IFS-native NLS, emergent order), `public/apps/nls4.js`
(distributed two-soliton), `public/apps/instanton3.js` (topological tunneling),
`public/apps/instanton_hologram.js` (hologram of an instanton). Constants: GAMMA=−0.25
(focusing), ISAT=20 (saturation), SRC_ALPHA=0.08 (driven-dissipative), DT=0.12. See also
`docs/native-ifs-holography.md`.*
