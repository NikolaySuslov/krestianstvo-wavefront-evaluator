# The Fractal-Time Generator — IFS as a Self-Defining Attractor of Space-Time

*The clock at the core of the Krestianstvo Wavefront Evaluator (KWE) is not a metronome. It
is an Iterated Function System (IFS) strange attractor that generates its own time — a
fractal heartbeat whose microticks and light cones constitute the spacetime the physics
lives in. This document describes that generator: its construction, its self-defining
character (with the Lorenz attractor as the conceptual ancestor), and how it reaches down
into the KWE core.*

---

## 1. The thesis

In ordinary simulation, time is external and uniform: a fixed `dt`, a fixed frame rate, a
clock ticking from outside the world. In KWE, **time is generated from within** by an IFS
attractor. The same fractal process that schedules *when* things happen also defines the
*operator* governing *how* the field propagates (the IFS Laplacian) — so the clock and the
law of motion are one object. Time is not a backdrop; it is a **dynamical attractor**, with
structure at every scale.

The claim, in one line:

> The IFS clock is a **self-defining space-time generator** — an attractor that emits its
> own ticks, sets its own propagation law, and thereby constructs the medium it runs in.

---

## 2. The ancestor: Lorenz and self-defining dynamics

The Lorenz system is the canonical **strange attractor**: three coupled ODEs whose
trajectories never repeat, never escape, and never settle — they fold forever onto a
fractal set of measure zero, structured at every scale. Two of its properties are the
conceptual seeds of the KWE clock:

1. **Self-similarity across scale.** Zoom into the attractor and the same folded structure
   recurs. There is no smallest feature; detail is endless. Time, if read off the
   trajectory, has structure at every magnification.

2. **The attractor defines its own geometry.** The Lorenz set is not embedded in a
   pre-given grid — *it is its own coordinate system*. The dynamics carve out the space they
   inhabit. The trajectory and the manifold it lives on are inseparable; the system defines
   both "where" and "when" simultaneously.

KWE takes this literally and makes it constructive: replace the Lorenz flow with an **IFS**
(a set of contraction maps whose attractor is fractal), and use the attractor not as a
picture to plot but as a **time generator** — a process that emits scheduling events. The
result is a clock whose ticks form a Lorenz-like fractal set in time, and which, like the
Lorenz manifold, **defines the space it acts on**.

---

## 3. Construction of the fractal-time generator

### 3.1 The IFS maps — contraction ratios

The generator is built from a set of contraction ratios (`IFS_MAPS_DEFAULT` in
`krestianstvo-wavefront-physics.js`):

```
0.3090  cos(72°)   pentagonal / icosahedral
0.4142  √2 − 1     silver ratio
0.5     1/2        dyadic
0.6180  φ⁻¹        golden ratio
0.7071  1/√2       octagonal
0.7320  √3 − 1     hexagonal
```

These are not arbitrary: each is a self-similar ratio drawn from a symmetry group
(pentagonal, dyadic, golden, octagonal, hexagonal). The attractor of an IFS built from them
inherits quasi-crystalline / multi-scale structure — a fractal set with no characteristic
length, hence no characteristic *time*.

### 3.2 The scheduler — emitting a fractal heartbeat

The generator's heart is the **IFS scheduler** (`FRAG.ifsScheduler`), called at the start of
every "beat." It recursively spawns future beats by contracting the current delay:

```js
selfR      = random pick from IFS_MAPS
childR     = random pick from IFS_MAPS
selfDelay  = delay · selfR          // contract time toward the self-branch
childDelay = delay · childR         // contract time toward a deeper child

if (gen < IFS_GEN_CAP && selfDelay > IFS_MIN_DELAY)
    future(selfDelay, beat, { delay: selfDelay, gen: gen+1 })          // same depth, later

if (gen === 0 && depth+1 < IFS_DEPTH && childDelay > IFS_MIN_DELAY)
    future(selfDelay + childDelay, beat, { depth: depth+1, gen: 0 })   // next depth
```

Read this as a **time IFS**: each beat schedules its own continuations at *contracted*
delays, branching into a self-similar tree of future events. The set of firing times is the
**attractor of the time-IFS** — a Cantor-like, multi-scale set of ticks. Two cutoffs keep it
finite and live: `IFS_GEN_CAP` (recursion depth per branch) and `IFS_MIN_DELAY` (smallest
tick — the quantum of fractal time). `IFS_DEPTH` sets how many nested scales coexist.

This is the **fractal heartbeat**: not a steady pulse but a self-similar cascade of beats,
dense at fine scales, sparse at coarse ones, never exactly repeating.

### 3.3 The self-defining loop — time becomes the law of motion

The crucial step. The beats don't just *schedule* — as they fire (`fresnelBeat`), they
**accumulate the visit-count of each ring radius**, and at cycle end (`finalizeFresnelm`)
that visit-count *becomes the IFS Laplacian's weights*:

```
w(r) = FRAC_ALPHA · count(r) / totalBeats
```

So the **temporal attractor defines the spatial operator**. How often the clock visits a
radius sets how strongly the medium propagates at that scale. The fractal order of the
dispersion (`s_eff ≈ 0.5`) is *emergent* from the time-IFS geometry, not imposed (see
`docs/native-ifs-solitons.md`). Change the contraction ratios → change the heartbeat →
change the Laplacian → change the physics.

```
        IFS contraction maps
                 │
                 ▼
        time-IFS scheduler  ──emits──►  fractal heartbeat (microticks)
                 │                              │
                 │ visit-counts per radius      │
                 ▼                              ▼
        IFS Laplacian weights  ◄────────  the law of motion
                 │
                 ▼
        propagation of ψ  =  the space the clock acts on
```

The loop closes: **the clock generates the time, the time generates the operator, the
operator generates the space, and the space is what the clock ticks through.** A
self-defining space-time, in the Lorenz sense made constructive.

---

## 4. Microticks and light cones — down to the KWE core

The fractal heartbeat is realized by a **two-level clock** in the KWE core
(`krestianstvo-wavefront-evaluator.js`), reconciling continuous fractal time with discrete,
synchronized, multiplayer execution.

### 4.1 Macro ticks — the reflector pulse (logical time)

The outer clock is the **Croquet reflector pulse**: a network-synchronized heartbeat
carrying `logicalTime`. Every peer receives the identical pulse stream, so all worlds share
one master time axis. This is the coarse beat — the shared "now."

```
isNewPulse → world.logicalTime = pulse.logicalTime; evaluate()
```

### 4.2 Microticks — the sub-tick drain loop

Between two macro ticks, the IFS scheduler has emitted a **dense fractal cascade of future
events** at contracted delays. These are advanced by the **sub-tick drain loop**: after a
macro pulse, the core repeatedly fires the world's *next scheduled future event*
(`_worldNextAt`) as a **sub-tick**, until either the world is stable or the next event would
fall beyond the macro tick's window:

```js
while (!world.isStable && iters < 10000) {
    const _wn = _worldNextAt(world);          // next fractal beat time
    if (_wn === null) break;
    if (_wn >= p.wallTime + SUBTICK_MS) break; // outside this macro tick's cone
    registerEvent("reflector", { ...p, wallTime: _wn, isSubTick: true });
    worldps.evaluate();                        // fire the microtick
}
```

`SUBTICK_MS = 0.09` — microticks are ~0.09 ms apart at the floor, vastly finer than the
~50 ms (`REFLECTOR_MS`) macro pulse. **The macro tick is the coarse beat; the microticks are
the fractal subdivision within it** — the self-similar cascade between two heartbeats. This
*is* the fractal heartbeat made executable: coarse synchronized beats, each filled with a
dense, self-scheduled microtick storm.

### 4.3 Light cones — causal containment of the cascade

The condition `_wn >= p.wallTime + SUBTICK_MS` (and the `warp`/`drain` logic) is a **light
cone** in this model: it bounds how far the fractal cascade may propagate *within* one macro
tick before the next synchronized pulse. Events scheduled beyond the cone are deferred to a
future tick.

This gives **causal structure**:

- A microtick can only influence events **inside its forward cone** (later, within the
  current macro window). Nothing leaks across a macro boundary out of order.
- `isStable` is the local **causal closure** condition — the world has drained all events
  reachable within the cone; nothing more can happen "now."
- The **warp** path (`pulse.logicalTime > lastLT + 1`) replays missed macro ticks as
  sub-tick storms to catch a lagging peer up *causally* — re-running the cascade rather than
  jumping, so determinism (and the shared light-cone structure) is preserved across the
  network.

So the KWE core implements a discrete, networked **causal spacetime**: macro ticks are the
synchronized time slices, microticks are the fractal substructure within each slice, and the
`SUBTICK_MS` window is the light cone that keeps the cascade causal and replicable across all
peers.

---

## 5. Why this is a *space-time generator*, not just a scheduler

Three properties together justify the strong framing:

1. **It generates time.** Ticks are not externally imposed; they are the attractor of the
   time-IFS — a fractal set of firing instants, dense at fine scales (microticks), sparse at
   coarse ones (macro ticks), structured at every magnification.

2. **It generates space.** The same visit-count distribution that the ticks trace out
   *defines the propagation operator* — the IFS Laplacian — and thus the metric of how `ψ`
   spreads. The "distance" a wavefront covers is set by where the clock spent its time.
   (Depth, in the holography work, is literally *duration* of this clock — see
   `docs/native-ifs-holography.md`.)

3. **It is self-defining and causal.** Like the Lorenz attractor defining its own manifold,
   the IFS clock defines the spacetime it runs in — and the microtick/light-cone machinery
   gives that spacetime genuine causal structure, synchronized and deterministic across a
   distributed world.

A metronome times a simulation from outside. This generates the simulation's spacetime from
inside, fractally, and hands the physics a medium that is the clock's own shadow.

---

## 6. Construction summary & parameters

| Element | Role | Where / value |
|---|---|---|
| `IFS_MAPS_DEFAULT` | contraction ratios (the maps) | 6 self-similar ratios |
| `ifsScheduler` | emits the fractal heartbeat (time-IFS) | `FRAG.ifsScheduler` |
| `IFS_GEN_CAP` | recursion depth per branch | finiteness cutoff |
| `IFS_MIN_DELAY` | smallest tick — quantum of fractal time | microtick floor |
| `IFS_DEPTH` | number of coexisting time scales | `8` |
| `w(r)=α·count(r)/total` | time attractor → space operator | `finalizeFresnelm` |
| reflector pulse | macro tick (synchronized logical time) | `REFLECTOR_MS ≈ 50 ms` |
| sub-tick drain loop | microticks within a macro tick | `SUBTICK_MS = 0.09 ms` |
| `_wn ≥ wallTime+SUBTICK_MS` | light cone (causal containment) | core dispatch |
| `isStable` | causal closure ("now" is fully drained) | per world |
| warp replay | causal catch-up for lagging peers | core dispatch |

---

## 7. The arc

```
Lorenz strange attractor
        │  (self-similar, self-defining manifold — the conceptual ancestor)
        ▼
IFS time attractor  (contraction maps → fractal heartbeat)
        │  (the scheduler emits a Cantor-like set of ticks)
        ▼
Self-defining space-time
        │  • time attractor → Laplacian weights → propagation metric
        │  • macro ticks + microticks = fractal heartbeat
        │  • SUBTICK_MS window = light cone (causal, synchronized)
        ▼
KWE core: a networked causal spacetime the wavefront physics lives in
        ▼
(then) IFS-NLS solitons/instantons  +  native IFS holography  +  the holographic eye
        — all behaviors of a field clocked by this fractal-time generator
```

The fractal-time generator is the root. The solitons, instantons, holography, and the
holographic eye documented elsewhere are *what this self-defining spacetime does* once a
complex field is placed in it.

---

*Files: `public/krestianstvo-wavefront-physics.js` (`IFS_MAPS_DEFAULT`, `FRAG.ifsScheduler`,
`makeIFSParams`), `public/krestianstvo-wavefront-evaluator.js` (macro/sub-tick dispatch,
light-cone drain, warp), `public/hologram_world.js` (clock wired into the world program).
See also `docs/native-ifs-holography.md` and `docs/native-ifs-solitons.md`.*
