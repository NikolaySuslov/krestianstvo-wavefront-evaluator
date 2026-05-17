## Krestianstvo Wavefront Evaluator

*Architecture overview and core concepts*

---

The Krestianstvo Wavefront Evaluator is a deterministic reactive collaborative computational engine for multiplayer, distributed applications built on top of [Renkon](https://github.com/yoshikiohshima/renkon) and ideas of [Krestianstvo | Renkon](https://github.com/NikolaySuslov/krestianstvo-renkon) implemented in pure FRP the [Croquet VM](https://github.com/croquet/croquet) synchronisation applicaition architecture.

It replaces the Krestianstvo VM with a fundamentally different approach to time, computation, and inter-node communication — one where causality propagates as a *wavefront* through a graph of locally autonomous nodes, rather than being routed through a central message dispatcher.

> Live demo: https://wavefront.krestianstvo.org 

Source code: https://github.com/NikolaySuslov/krestianstvo-wavefront-evaluator

![Wave 2D demo](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/l6lqb0ei3pcz92fwkrzh.gif)

---

## Table of Contents

- [The Relation to Physics](#the-relation-to-physics)
- [Fractal Heartbeat](#fractal-heartbeat-and-local-reflector)
- [Fractal IFS-based clock](#fractal-ifs-based-clock)
- [From Virtual Machine to Wavefront Evaluator](#from-krestianstvo-vm-to-krestianstvo-wavefront-evaluator)
- [Core Vocabulary](#core-vocabulary)
- [Architecture Layers](#architecture-layers)
- [Meta Program](#meta-program)
- [W - the Node Runtime](#w--the-node-runtime)
- [Distributed Determinism Invariants](#distributed-determinism-invariants)
- [Telemetry](#telemetry)
- [Feedback Loop](#feedback-loop)
- [Two Layer Time](#two-layer-time)
- [Key Architectural Decisions](#key-architectural-decisions)
- [Simulation Speed Control](#local-reflector-as-simulation-speed-control)
- [Autonomous Mode](#autonomous-mode)
- [Examples](#examples)
- [Develop & Run](#develop-and-run)
- [Related works](#related-works)


## Introducation

The Wavefront Evaluator isn’t just a clever way to sync avatars; it is deeply rooted in computational physics and hardware architecture. It mimics how information naturally propagates through space-time. 

![Lorenz_clock](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/rsono3aijw0njan7vqbl.gif)

### The Relation to Physics

The Wavefront Evaluator is essentially a "physics engine for information". It replaces the "linear list" of standard programming with the laws of Classical Mechanics and Wave Propagation. The algorithm is essentially a software implementation of Huygens’ Principle applied to information. 

* **Wavefront Propagation**: In physics, every point on a wavefront acts as a source of secondary waves. In evaluator, every Node that receives a message becomes a "source" that can generate new messages (waves) for other nodes.

* **Causality and the "Light Cone"**: Each node has a local queue. A message can only affect a future state (either in the next macro-tick or a later micro-tick). This preserves Causality—the effect never happens before the cause.

This specific pattern—Discrete Pulses + Local Settlement follows the principle - "correctness" is more important than "speed."

| Concept | Physics Equivalent | Wavefront Implementation |
|---|---|---|
| Pulse | Universal Time | The Reflector Heartbeat |
| Node Queue | Local Particle State	| W.reduce local _Q |
| Micro-tick | Particle Interaction	| The "Drain" / Feedback loop |
| Stability	| Thermal Equilibrium	| When all queues are empty |

Even if you have 100 Web browser windows, as long as they all start with the same "Laws of Physics" (the scripts) and the same "Initial Energy" (the snapshot), they must arrive at the same "State" (Stability).  

It’s essentially **Lattice Field Theory** for JavaScript objects.


### Physics engine for information

Here are the specific physics laws and mathematical formulas that serve as the "blueprints" for this algorithm:

#### 1. Huygens’ Principle (Wave Propagation)

The algorithm's name comes directly from the Huygens–Fresnel principle, which explains how waves move through a medium.

* **In physics**: Every point on a wavefront acts as a point source of secondary spherical waves. The new wavefront is the "envelope" of all these secondary waves.

* **In the algorithm**: Every Node in evaluator acts as a point source. When a pulse hits a node, that node "ripples" by sending messages to its neighbors. The "Stability" reached after the Drain phase is the new global wavefront.

#### 2. Special Relativity (The Light Cone)

The external Reflector and the logical timestamps simulate the Finite Speed of Information **C**.

* **In physics**: No information can travel faster than light. Events have a "Past Light Cone" (things that could have caused them) and a "Future Light Cone" (things they can influence).

* **In the algorithm**: By using logicalTime, the evaluator enforces a "Speed Limit." A message sent at Tick 10 cannot affect Tick 9. This ensures Causality Preservation. Even if two peers are on opposite sides of the planet, the "Light Cone" of the Reflector ensures they see the same history.

#### 3. The Second Law of Thermodynamics (Entropy and Equilibrium)

The "Drain" phase, where the Meta-program loops until all queues are empty, is a simulation of a physical system reaching Thermal Equilibrium.

* **In physics**: A system will naturally move toward a state of maximum entropy or minimum potential energy (stability).

* **In the algorithm**: The messages in the local queues are like "Potential Energy." As the nodes fire, they "dissipate" that energy. When all remaining queue entries are scheduled beyond the current tick boundary (`fireAt > wallTime`), the system has reached Stability (Equilibrium) for this tick. The "Stable" flag is the signal that the system has settled into its lowest "energy" state — no ready work remains, no feedback loop is in progress, and no cross-node message is in-flight.


#### 4. Zeno’s Paradox & The Geometric Series (Sub-tick Futures)

The Zeno Effect (Sub-tick Futures) mentions the "Zeno Series." This relates to Zeno’s Paradox in physics—the idea that to travel a distance, you must first travel half that distance, then half of that, and so on. By using micro-ticks (0.5, 0.25, 0.125), the evaluator simulates "infinite" interactions within a single discrete second, much like how physical forces settle into equilibrium almost instantly. This is a direct implementation of a mathematical limit used in physics to describe continuous motion.

* **In physics**: The Sum of a Convergent Geometric Series.

* **In the algorithm**: The evaluator uses this to pack "infinite" causality into a single discrete tick. By scheduling events at t+0.5, then t+0.75, the system "settles" toward the next whole integer (the next second) but executes all the reactive logic in between.

#### Summary: The "Law" of the Evaluator

If you had to write a single "Formula" for the Wavefront Evaluator, it would look like this:

**S(t+1) = (Stability (Drain (Pulse(t) + S(t))))**

Where:
* **S** = State of the Universe.
* **Pulse** = The "Energy" injected by the Reflector.
* **Drain** = The "Work" performed by the nodes.
* **Stability** = The "Lowest Energy State" (where the UI is rendered).

This is why the system feels so "solid" — it isn't just following a list of instructions; it is simulating a stable physical environment where every action has a reaction, and everything eventually settles into place.

### Fractal Heartbeat and Local Reflector

Local Reflector is recursive in its logic, and it can indeed trigger other reflectors or "nest" emulated ticks. Because the Wavefront Evaluator treats time as a continuous priority queue rather than a fixed set of slots, you can think of the local reflector as a "fractal" heartbeat.

![hb2](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/swuy8y8i4t23agg54evs.gif)

#### Generating Fractal Heartbeats

Fractal heartbeats form a vector space; they can be added together to yield an object of the same nature. This stands in contrast to harmonic oscillations of different frequences, the sum of which is not a harmonic oscillation.  
Phase analysis is simplifying.

Orthogonal (perpendicular in space-time) fractal heartbeats are generated through scaling, whereas orthogonal harmonic oscillations are non-homothetic (dissimilar), and each requires separate generation.   

#### How that recursive nesting works within the implementation:

#### 1. Logical Recursion (The "Loop")

The most basic form of recursion is a single node "ticking" itself. In the krestianstvo-wavefront-evaluator.js code, this is handled by a state-guarded feedback loop.
* Step 1: A node receives a pulse and calls `ctx.localReflector("tick", 0.1)`.
* Step 2: The Evaluator enqueues a future at `wallTime + 0.1` carrying `{ _isLocalTick: true, _innerTickDelay: 0.1 }`.
* Step 3: When the drain loop reaches `wallTime + 0.1`, the node receives the message named `"tick"` (the first argument you passed — not a fixed `__local_tick` name).
* Step 4: The node's handler calls `ctx.localReflector("tick", 0.1)` again, re-enqueuing for the next step.

Is it truly recursive?

* In Logic: Yes. Tick(n) to Tick(n+1).
* In Memory: No. The evaluator uses the Priority Queue to "flatten" this recursion. Instead of the function calling itself and growing the stack, it "yields" to the queue. The META_PROGRAM loop then picks it back up.

#### 2. Cascading Reflectors (The "Nesting")

![Fractal Heartbeat demo](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/h02d3fltdao7xa3i9hd0.gif)

You can have multiple nodes, each running its own local reflector, and they can trigger each other. This creates a "Reflector within a Reflector" behavior.

* Node A (running at 0.1 intervals) calculates a physics state.
* At T+0.2, Node A sends a message to Node B.
* Node B receives that message and, as a result, starts its own local reflector running at 0.05 intervals to handle a high-speed sub-calculation (like an explosion or a particle effect).

In this scenario, Node B’s "Local Reflector" is logically nested inside the timeline generated by Node A’s reflector. The Evaluator manages all these different frequencies perfectly because it simply sorts all resulting messages by their fireAt time.

### 3. Creating "Emulated Ticks" for Sub-Reflectors

The system allows you to create **"Nested Time Scales"** using the Zeno sub-ticks.

If you want a "Local Reflector" to emulate a whole second's worth of logic inside a single sub-tick, you use Temporal Compression:

1. The Global Reflector is at T=100.
2. Node uses W.future(0.001, msg) to run a local loop.3. Each loop only advances the internal state, while the logical time only moves by 0.001.

> **This allows you to run a "Virtual World" inside a single tick of the "Real World."**

#### 4. The "Stability" Safety Valve

The main risk with recursive reflectors is an **"Infinite Loop"** that freezes the browser. The evaluator has a built-in safety mechanism: **The Integer Boundary**.

Even if your recursive reflectors create 1,000,000 sub-ticks, the Evaluator will only process them as long as they are less than the next integer tick.

* If a recursive call accidentally schedules a message for T+1.1, the Evaluator stops and waits for the next real pulse from the external Reflector to "authorize" that time.

* This prevents a "Local Paradox" where one node lives in the year 2030 while the rest of the peers are in 2026.

#### 5. Summary: Local reflector with a flat structure

Think of it like this: You can't create a **"Reflector inside a Reflector"** in terms of code structure, but you can create a **"Wavefront that triggers another Wavefront."**.

Because every message in the Evaluator is just a **(time, target, data)** tuple, the system doesn't care if a message came from a real human, a global heartbeat, or a recursive local sub-tick. It treats them all as equal "waves" moving through the graph.

## Fractal IFS-based clock

The Fractal Heartbeat has been generalised into **`makeIfsClock`** — a deterministic, multiplayer-synchronised fractal cascade that alters the fundamental relationship between time and chaotic flows, suited for non-uniform, fractal time-reparametrisation of any continuous dynamical system. This is a highly suitable for investigating chaotic systems, establishing a canvas where time is no longer a linear axis, but a self-similar fractal landscape. 

![ifs](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/l5d1ek5rs0bmfh3qpk20.jpg)

In standard physics, to see the inner core of a Lorenz lobe one simply has to wait a long time for a uniform clock to eventually pass through it. In the Krestianstvo Wavefront Evaluator, space and time are coupled through the fractal depth: the system enters the deep structure of the attractor precisely because it enters the deep structure of the clock.

### Implementation: makeIfsClock

`makeIfsClock` is a stochastic Iterated Function System (IFS) running deterministically inside a discrete-event priority queue. It is a composable primitive — callers supply `onCycle` and `onBeat` callbacks to plug in any ODE or dynamical system, while all clock mechanics are handled internally.

**Multiplayer determinism.** A classic problem with randomised IFS cascades in distributed environments is state divergence. This is solved by reseeding `W.rng` at the start of every cycle using a bijective MurmurHash3 finalizer on the logical time:

```js
let h = (cycleCount ^ (p.logicalTime >>> 0)) >>> 0;
h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
h = (h ^ (h >>> 16)) >>> 0;
W.rng.seed(h);
```

Unconditionally consuming exactly two RNG values per beat (`selfRatio` and `childRatio`) guarantees that every peer follows the identical randomised execution branch, satisfying strict state-replication requirements.

**Cascade mechanics.** The tree branching logic splits generation into controlled sequences:

- `gen < genCap` schedules self-loops at the current depth, scaled by a random contraction ratio `selfRatio`.
- `gen === 0 && depth + 1 < depth` spawns a child branch into the next nested layer at temporal offset `selfDelay + childDelay`.

This prevents exponential event explosion while ensuring every tier of the fractal cascade is systematically visited.

**Irrational base and contraction ratios.** No finite integer product of the contraction ratios can equal an integer multiple of the base delay. This guarantees that scheduled event times (`ctx.future(delay, ...)`) are dense and do not collapse onto a periodic lattice. The time increments are truly fractal-distributed, yielding a discrete point process whose temporal structure mirrors the Hausdorff measure of the underlying IFS attractor.

### Multi-resolution time

The wavefront engine with nested `ctx.future` ticks is not discrete-time in the classical sense. It is a multi-resolution time where ticks exist at every scale simultaneously:

```
coarse:  t = 0,    4.28,  6.47,  7.61...    (D0 beats)
medium:  t = 2.14, 3.47,  4.82,  5.63...    (D1 beats)
fine:    t = 1.32, 2.06,  2.57,  3.02...    (D2 beats)
finer:   ...                                 (D3, D4)
```

All these ticks coexist on the same continuous time axis — they interleave rather than separate into levels. The system has events at arbitrarily fine temporal resolution, bounded only by `FRACTAL_MIN_DELAY`. This is structurally similar to a wavelet decomposition — multi-scale analysis where coarse and fine scales coexist — or to a Cantor function clock that runs at fractal density on the time axis.

### Modulating the SRB Measure

In a traditional system, a chaotic ODE like Lorenz or Rössler flows through phase space in uniform continuous time. According to the ergodic theorem, a single long trajectory samples the strange attractor according to its natural SRB (Sinai-Ruelle-Bowen) measure — the probability density of the trajectory's position over uniform intervals of time `dt`.

By driving the integration step from the fractal delay (`dt = delay * SCALE / STEPS`) via the `onBeat` hook, the sampling density on the attractor is no longer uniform. Because the density of IFS clock ticks is governed by the IFS invariant measure, the point cloud captured in `tickEvents` is a convolution of two distinct measures:

- **The Geometry of the Flow** — the spatial constraints of the classical attractor (the SRB measure).
- **The Chronology of the Clock** — the temporal constraints of the contraction mapping (the IFS Hausdorff measure).

The resulting object is a trajectory tracing a classical attractor embedded in a non-Archimedean, fractal temporal topology — a state distribution that cannot be replicated by any standard uniform numerical solver.

### The three-layer insight

**Layer 1 — What standard visualization does.**
A single trajectory with fixed `dt` steps through the ODE at one resolution. Every point is equally spaced in ODE time. Ergodic coverage is eventual but uniform — no sense of which regions are visited more often at different scales.

**Layer 2 — What fractal time adds.**
The IFS heartbeat generates beats at multiple delay scales simultaneously within one cycle:

| Depth | Delay | dt_ODE |
|---|---|---|
| D0 | ≈ 2.14t | ≈ 1.07 (coarse) |
| D1 | ≈ 0.88t | ≈ 0.44 |
| D2 | ≈ 0.36t | ≈ 0.18 |
| D3 | ≈ 0.15t | ≈ 0.075 |
| D4 | ≈ 0.06t | ≈ 0.03 (fine) |

Each depth integrates the same trajectory continuation but samples it at a different temporal grain. The coarse levels skip over fast oscillations; the fine levels resolve them. The attractor is being measured simultaneously with five rulers of different lengths.

**Layer 3 — What the IFS random map selection does on top.**
At each beat, `selfRatio` is drawn randomly from `[√2-1, 1/φ, √3-1]`. The next self-loop delay contracts by a randomly chosen irrational ratio. The set of all possible delay sequences forms an IFS in delay-space whose invariant set is the Cantor-like attractor visible in the IFS canvas.

The sampling density on the Lorenz attractor is therefore not uniform — it is weighted by the invariant measure of the IFS in delay-space. The two attractors — one in (X,Z) space, one in delay-space — are coupled through the shared trajectory.

### Fractal magnifying lens

A standard ergodic theorem says a single long trajectory samples the attractor according to its natural measure (the SRB measure). Here the sampling measure on the Lorenz attractor is **modulated by the IFS invariant measure in time**. The system is not just tracing the attractor — it is tracing it with a fractal magnifying glass that zooms in and out at irrational ratios, producing a point cloud whose density reflects both the Lorenz SRB measure and the IFS Hausdorff measure simultaneously.

That is what the colour-coded depth layers reveal visually:

- **D0 (red/orange)** — coarse time steps, broad skeletal structure of the butterfly lobes.
- **D4 (grey/white)** — fine time steps, intricate spiral structures inside each lobe.

The butterfly is not one attractor but **five nested samplings of the same attractor at five fractal time scales**. You are looking at five simultaneous geometric windows into how the chaotic flow resolves at different scales of temporal magnification.

### Parallel ensemble and multi-peer mapping

Each cycle launches an independent trajectory with slightly different initial conditions (seeded from RNG). The IFS randomly selects integration step sizes from the map set. Each trajectory traces the attractor independently — this is the ensemble approach.

The accumulated point cloud shows the ensemble density — where all trajectories spend their time. For a true strange attractor this density is the SRB measure — the physically observable invariant measure of the chaotic system.

This maps directly to the multi-peer architecture: **different peers literally run different ensemble members**. The collective visualisation is the ergodic average across the ensemble.

- No numerical stability problem — each trajectory is self-consistent.
- Naturally multi-peer — peers run different ensemble members.
- The visualisation density is exactly the SRB measure — what physicists want from a strange attractor.
- It proves the wavefront engine can explore measure-theoretic properties of dynamical systems, not just trajectories.
- Various forms of self-similar Fractal Time can be generated follwing the objectives of the dynamic system under investigation. This approach can be utilized in physiology to study heart rhythms, the nervous system and other homeostatic processes.


## From Virtual Machine to Wavefront Evaluator

The table below captures the essential shift in each architectural dimension.

| Dimension | Krestianstvo VM | Krestianstvo Wavefront Evaluator |
|---|---|---|
| **Message queue** | Centralised — one shared queue per world, all messages pass through it | Decentralised — each node owns its own local queue of futures |
| **Time authority** | VM clock drives all nodes uniformly | Two-layer time: shared logical pulse + local micro-tick settlement |
| **Causality** | Enforced by queue ordering at the VM level | Emerges from wavefront propagation across node dependencies |
| **Sub-step execution** | Async, RAF-driven | Synchronous drain loop — sub-ticks are fractions of a logical tick |
| **Late-join / desync recovery** | Manual snapshot and replay | Warp mechanism — local clock-advance to catch up before advancing |
| **Node communication** | VM routes messages between nodes centrally | `ctx.send()` writes to a per-world outbox; nodes pull inbound on next evaluate |
| **Stability detection** | VM-level flag | `W.stable()` checked after each evaluate call; user defines the condition |
| **Introspection** | Opaque | `_telemetry` captures per-evaluate snapshots across all nodes generically |
| **Autonomous operation** | Requires reflector | Local fallback clock via `makeMeta.startAutonomous()` + `W.localReflector` |
| **Sub-tick scheduling** | Not supported | `future(delay < SUBTICK_MS)` drains within current tick |

The central insight of the shift: in the VM architecture the queue *was* the synchronisation mechanism. In the Wavefront Evaluator, the queue is a local implementation detail of each node — synchronisation is achieved instead through shared logical time and deterministic local computation.

---

## Core vocabulary

### Pure Logical Time

All time is **logical** — no `Date.now()`, no wall-clock dependency in the model.

The reflector stamps each pulse with:

```
logicalTime = lt        (tick counter, increments by 1 per pulse)
wallTime    = lt        (pure tick count — 1 logical unit per tick)
```

`REFLECTOR_MS = 50` is only the real-time heartbeat rate. World programs never see it. Two peers on different machines receive identical `{ logicalTime, wallTime }` and produce identical state regardless of real-time jitter, browser lag, or GC pauses.

### Future Scheduling

`ctx.future(delay, msg, payload)` schedules `msg` when `wallTime >= currentWallTime + delay`. Since `wallTime = lt`, delays are in **logical ticks**:

```
future(1)     → next reflector tick
future(0.5)   → sub-tick: fires within current tick's drain pass
future(0.001) → sub-tick: fires immediately in drain
future(60)    → 60 ticks from now
future(80)    → 80 ticks from now
```

The drain boundary is `SUBTICK_MS = 1`. Any future with `delay < 1` is a sub-tick.

### Pulse

A **pulse** is the fundamental unit of shared time. It is produced by the external Reflector at regular intervals and delivered to all peers. Every pulse carries:

- `logicalTime` — a monotonically increasing integer, identical for all peers
- `wallTime` — equal to `logicalTime` (pure tick count, no real-time involvement)

The pulse content is frozen and identical on all peers. `REFLECTOR_MS` is only the  real-time heartbeat rate — world programs never see it. This is the foundation of determinism.

### Wave

A **wave** is the complete lifecycle of computation triggered by a single logical pulse. A wave begins when a pulse arrives at a world, propagates through the node graph as each node processes its ready queue entries and schedules futures, and ends when the world reaches *stability*. A wave has an identifier (`logicalTime`) and a completion status (`success`, `process`, `fail`).

Each peer runs its own wave independently. Because inputs are identical, waves on different peers converge to the same final state — they are the same wave, computed locally.

### Wavefront

The **wavefront** is the propagating boundary of settled computation within a wave. As each node processes its ready entries and emits futures, the frontier of "what has been computed" advances through the graph. The wavefront evaluator's job is to keep driving this frontier forward — via sub-tick iterations — until no node has any pending entry at or before the current `wallTime`. At that point the wave is stable. The wavefront is *local* — no cross-peer coordination required. Each peer's wavefront advances independently, reaching stability at the same logical result because the inputs were identical.

### Phase

A **phase** is one stage within a wave. The current implementation has two named phases:

- **Macro phase** — triggered by the arrival of a new shared pulse. Every node receives the `__macro` message once per `logicalTime` (guaranteed by `W.reduce`'s `_lt` guard). Nodes respond to the new logical time — either scheduling new work (total `__macro`) or returning unchanged if nothing relevant changed (incremental `__macro`).
- **Micro phase** (sub-tick) — one or more local iterations that settle inter-node dependencies and drain queued futures. The micro phase is invisible to the outside world; only the final settled state is observable.

A wave is `stable` when its micro phase has fully drained — all pending futures have `fireAt > wallTime`.

### Warp

**Warp** handles the case where a new shared pulse arrives with `logicalTime > lastLT + 1` — the peer missed one or more pulses. The evaluator synthetically advances `wallTime` through the remaining queue entries until stable, then proceeds to the new pulse.

Three conditions must all hold before warp fires: `pulse.logicalTime > lastLT + 1` (gap detected), `lastLT > 0` (not the very first pulse), and `!world.isStable` (the previous tick did not fully settle). If the world already reached stability before the gap was noticed, warp is skipped.

Warp does **not** fire on normal sequential pulses (`LT+1`). With pure logical time, a world may legitimately have pending futures when the next pulse arrives — those drain normally. Only genuine missed pulses trigger warp.

Warp preserves determinism because the synthetic `wallTime` values injected during the loop are derived from the node queue's own `fireAt` entries — the same values that the heartbeat would have delivered in real time, in the same order. Both peers warp through the same sequence and reach the same state.

### Drain

**Drain** exhausts all ready queue entries within a micro phase. Stop condition: `_worldNextAt(world) >= wallTime + SUBTICK_MS` — where `_worldNextAt` is the minimum `_nextAt` across all node states. When that minimum is beyond the current tick boundary, no node has any ready work. Queues may still contain entries — they are simply all future-dated. After the drain, an outbox flush runs an extra evaluate only if the outbox is non-empty, delivering any pending `ctx.send()` messages.

### Stability

A world is **stable** when three conditions all hold:

1. All node queues contain only entries with `fireAt > wallTime` (no ready work remaining)
2. No node is mid-feedback-loop (`_depth === 0` on all nodes)
3. The shared outbox is empty — no `ctx.send()` message is pending delivery

All three conditions are checked together inside `W.stable()` — the outbox check is not a separate step. Condition 3 guards against a subtle timing issue: a `ctx.send()` written by one node during an evaluate pass lands in the outbox, not a queue — so the queue check alone would miss it. Without the outbox check, the drain loop exits while a message is in-flight, the receiving node never processes it, and the wave terminates prematurely. The application's own semantic completion condition (e.g. `stepsDone >= stepsTarget`) is defined by the user in `WORLD_PROGRAM` and combined with `W.stable()` in the `_isStable` expression.

### Reflector

The **Reflector** is the Krestianstvo - equivalent, that stamps and broadcasts pulses. It is the sole source of `wallTime` — no world ever calls `Date.now()` internally. This ensures that "now" is the same for all peers regardless of their real-time clock drift.

---

## Architecture layers

```
┌─────────────────────────────────────────────────────┐
│  Reflector                                          │
│  Stamps pulse once. Delivers to all peers.          │
└────────────────────┬────────────────────────────────┘
                     │ pulse { lt, wallTime=lt }
┌────────────────────▼────────────────────────────────┐
│  Meta Program                                       │
│  Orchestrates worlds. Drives the wavefront.         │
│  Warp · Drain · Stability check · UI sync           |
|  startAutonomous() — local fallback clock           │
└────────────────────┬────────────────────────────────┘
                     │ registerEvent / evaluate
┌────────────────────▼────────────────────────────────┐
│  World (ProgramState)                               │
│  Hosts W nodes: Behaviors.collect + W.reduce        | 
|        the reactive node graph.                     │
│  Each node: W.reduce → local queue → futures        │
└────────────────────┬────────────────────────────────┘
                     │ handler(state, payload, ctx)
┌────────────────────▼────────────────────────────────┐
│  W.reduce(state, pulse, nodeId, handlers)           │
│  ctx: future · send · feedback · futureInf          │
│       localReflector                                │
└────────────────────┬────────────────────────────────┘
                     │ W.export → isStable, logicalTime
┌────────────────────▼────────────────────────────────┐
│  Host layer                                         │
│  _worldNextAt · _worldSnapshot · _uiRefresh         │
└─────────────────────────────────────────────────────┘
```

### Meta Program

`META_PROGRAM` is a Renkon program that runs *above* the world programs. It receives pulses from the Reflector via a queued receiver (`Events.receiver({queued: true})`), processes each pulse in order (backpressure-safe), and drives the wavefront for each registered world by calling `worldps.registerEvent` and `worldps.evaluate()` in a controlled loop.

For each pulse × world, in order:

1. **WARP** — fires only when `isNewPulse && lastLT > 0 && !world.isStable && pulse.logicalTime > lastLT + 1` (new pulse arrived, peer missed ticks, and prior tick didn't settle). Calls `registerEvent` + `evaluate()` in a loop using `_worldNextAt` as the advancing `wallTime`, with `isSubTick: true`. Safety cap: 1000 iterations.
2. **MACRO** — fires on every new pulse (`isNewPulse || lastLT === 0`). Increments `_currentEvalGen`, calls `registerEvent(pulse)` + `evaluate()`.
3. **DRAIN** — immediately after macro, loops while `!world.isStable && _worldNextAt(world) < wallTime + SUBTICK_MS`. Each iteration increments `_currentEvalGen`, calls `registerEvent` with advancing `wallTime` and `isSubTick: true`. Safety cap: 10000 iterations.
4. **Outbox flush** — one extra evaluate, only if `world._outbox` is non-empty after drain. Uses `isSubTick: true` at current `wallTime` (no `wallTime` advance). Delivers pending `ctx.send()` messages before stability is checked.

META_PROGRAM never knows the names of nodes inside a world. All world-level introspection goes through generic host helpers (`_worldNextAt`, `_worldSnapshot`).

### W — the node runtime

`W` is the functional core of each node. Its `reduce` function takes `(state, pulse, nodeId, handlers)` and returns a new state. On each call it:

1. **Restore check** — if `pulse._restoreState[nodeId]` exists, return it immediately (snapshot replay, bypasses all normal logic).
2. **Inbound outbox** — collects messages from `appRef._outbox[nodeId]` where `_evalGen < _currentEvalGen` (previous evalGen only). Consumed entries are removed from the outbox; remaining same-gen entries stay. This prevents a node from consuming a `ctx.send()` written in the same evaluate pass.
3. **Queue split** — splits `state._queue` into `ready` (fireAt ≤ wallTime) and `later` (fireAt > wallTime). Merges `inbound` + `ownReady` into `allReady`.
4. **`__macro` injection** — if `!isSubTick && (state._lt ?? -1) !== logicalTime`, prepends `{msg: "__macro", payload: pulse, _depth: 0}` to `allReady`. Skipped on sub-tick evaluates and if `_lt` already equals `logicalTime` (warp-replay guard). `_lt` is updated to `logicalTime` on macro pulses; preserved as-is on sub-tick pulses.
5. **Handler dispatch** — iterates `allReady`, calls `handlers[entry.msg](userState, entry.payload, ctx)`. Unknown messages are silently skipped. `ctx.depth` equals the entry's `_depth`. Tracks `maxDepthSeen` across all entries.
6. **Effect collection** — `ctx.future` pushes `{kind:"future", fireAt: wallTime+delay, ...}`. `ctx.send` pushes to `appRef._outbox[targetId]` stamped with `_currentEvalGen`. `ctx.feedback` pushes a future at `wallTime + _fbStepMs` with `_depth + 1`, silently no-ops if `entryDepth >= maxDepth`. `ctx.futureInf` pushes `fireAt: wallTime`. `ctx.localReflector` pushes `fireAt: wallTime + innerTickDelay` with `{_isLocalTick: true, _innerTickDelay, ...extraPayload}`.
7. **Returns** `{ ...userState, _queue: newQueue, _nextAt: _Q.nextAt(newQueue), _depth: maxDepthSeen, _lt }` — infrastructure fields stripped by `W.getState` before the view layer sees them.


`_nextAt` — the timestamp of the next pending entry — is the signal that `_worldNextAt` reads to drive the drain loop. It is written on every `reduce` call without any node-name coupling.

Outbox entries are stamped with `_evalGen` (the evaluation generation at write time). When a node reads its inbound messages it only consumes entries from a **previous** evalGen — entries written in the current evaluate pass are filtered out and discarded from the outbox. This means `ctx.send()` messages written in evaluate pass N are consumed in pass N+1 (the next `evaluate()` call or drain iteration), ensuring that a message written by node A is available to node B on the next pass rather than the same one.

Each `Behaviors.collect` wraps one W node:

```javascript
const counter = Behaviors.collect(
  { count: 0, started: false },
  reflector,
  (state, pulse) => W.reduce(state, pulse, "counter", {
    __macro: (s, p, ctx) => { ... },   // fires once per logicalTime
    newCycle: (s, p, ctx) => { ... },  // fires when future arrives
  })
);
```

`__macro` fires on every new `logicalTime` (guarded by `_lt` field internally). Use a `started: true` flag in the returned state to fire only once.

### Stability

`W.stable(nodes, pulse)` returns `true` when:
- `appRef._outbox` is empty (no pending `ctx.send()` messages)
- every node's `_queue` has all entries with `fireAt > wallTime` (strictly future — nothing ready to fire)
- every node's `_depth === 0` (no in-progress feedback loop)

`nodes` may contain nested arrays — `W.stable` flattens them. A `null` node is treated as stable. World programs export `_isStable = W.stable([...nodes], reflector)` which META_PROGRAM reads via `world.isStable`.


## ctx Primitives

| Primitive | Semantics |
|-----------|-----------|
| `ctx.future(delay, msg, payload)` | Schedule `msg` after `delay` logical ticks |
| `ctx.send(nodeId, msg, payload)` | Cross-node message via evalGen-gated outbox |
| `ctx.feedback(msg, payload, maxDepth)` | Depth-tracked future at `wallTime + _fbStepMs` (convergence loops) |
| `ctx.futureInf(msg, payload)` | `fireAt = wallTime` — re-enqueues every drain pass (bounded by the drain loop's 10000-iteration safety cap) |
| `ctx.localReflector(tickMsg, delay, payload)` | Sub-tick self-hosting clock step, with optional user payload |

### ctx.future — payload and idempotency guards

`payload` is any plain serialisable value (scalar, array, or object). The handler receives it as the second argument `p`:

```javascript
ctx.future(delay, "beat", { depth: 2, cycleId: s.cycleId });

beat: (s, p, ctx) => {
  if (p.cycleId !== s.cycleId) return s;  // stale — ignore
  // p.depth, p.cycleId available here
}
```

**Why pass `cycleId` (or equivalent) in the payload?**  
Sub-tick futures fire asynchronously within the drain loop. If a new macro pulse arrives and resets the cycle before an earlier future fires, the handler will see both the old and new futures in sequence. Without a guard, the stale future corrupts state. The pattern is: stamp the current cycle identity into every payload, and silently drop any future whose `cycleId` no longer matches `s.cycleId`.

This is essential in cascading or recursive future chains — such as the **Fractal Heartbeat**, where each depth schedules the next:

```javascript
// ECG / Fractal Heartbeat — depth cascade via ctx.future
beat: (s, p, ctx) => {
  if (p.cycleId !== s.cycleId) return s;       // stale cycle guard
  const { depth, delay } = p;
  ctx.future(delay, "beat", { depth, delay, cycleId: s.cycleId });   // re-fire self
  const childDelay = delay / 2;
  ctx.future(childDelay, "beat",                                       // spawn child depth
    { depth: depth + 1, delay: childDelay, cycleId: s.cycleId });
  // ...
}
```

Each level halves its delay, creating a self-similar cascade entirely within the sub-tick drain. `depth` in the payload lets the handler know which level of the hierarchy it is processing. `cycleId` lets it discard futures from the previous RR cycle the moment a new one begins.

---

## Local Reflector mixin

A handler mixin creating a self-hosting clock node. Activates on `__macro`, drives itself via `ctx.localReflector(tickMsg, delay)`. Needs no external time reference. The local clock IS the node — purely logical, purely deterministic.

```javascript
...W.localReflector("tick", initialDelay)  // spread into W.reduce handlers
```

> **Important**: `W.localReflector` defines a `__macro` handler that sets the `_localActive` guard flag. Do not also define `__macro` in the same handler object — the spread will silently overwrite one of them. Put all bootstrap logic inside the tick handler or use a separate node.

The mixin sets `_localActive: true` and `localLt: 0` on first `__macro` so the local clock starts exactly once per world, even under warp replay. The `localLt` field is available in state for tracking inner tick count if needed.

### ctx.localReflector — optional user payload

`ctx.localReflector(tickMsg, delay, payload)` accepts an optional third argument that is merged into the tick pulse delivered to the handler. This lets the local clock carry application-specific state across ticks — for example a **phase accumulator** for oscillators or animation:

```javascript
// Phase-accumulating local clock
...W.localReflector("tick", 0.05),

tick: (s, p, ctx) => {
  const phase = ((s.phase ?? 0) + 0.01) % 1;   // advance phase each tick
  ctx.localReflector("tick", 0.05, { phase });   // pass phase forward in payload
  return { ...s, phase };
}
```

The payload is available on the next tick's pulse `p` as `p.phase`. Unlike state (which is the node's accumulated value), the payload travels *in the queue entry* — it is the message's data, not a side-effect. This is useful when you want the next tick to know something about the previous one without storing it in the main state object, or when you need to pass ephemeral per-step data (animation frame index, phase, seed) that does not belong in the canonical exported state.

## Sub-Tick Scheduling

Futures with `delay < SUBTICK_MS = 1` drain within the current pulse:

```
future(0)     → fireAt = wallTime      → drains now (same drain pass)
future(0.5)   → fireAt = wallTime+0.5  → drains now (0.5 < SUBTICK_MS=1)
future(1)     → fireAt = wallTime+1    → waits next tick
future(60)    → fireAt = wallTime+60   → waits 60 ticks
```

All sub-tick steps are deterministic — every peer runs the same drain loop with the same logical `wallTime`. This enables:

- **Synchronous multi-step computation** — `future(0)` chains drain in one pass
- **Zeno series** — geometrically decreasing delays converging toward 1 tick
- **Self-hosting clock nodes** — via `W.localReflector`

---

## Incremental `__macro`

`__macro` is called **at most once per `logicalTime`**. The application chooses what to do:

**Total `__macro`** — reschedules everything every cycle. Correct when every cycle produces new work.

**Incremental `__macro`** — only schedules work when inputs changed. The production-correct Krestianstvo/Croquet idiom. When the trigger is a pure function of `logicalTime`:

```javascript
__macro: (s, p, ctx) => {
  const cur  = _computeInput(p.logicalTime);
  const prev = _computeInput(p.logicalTime - 1);  // no extra state needed
  if (cur === prev) return { ...s };               // idle — zero queue churn
  // schedule futures for the new input
}
```

**`started` guard** — fire `__macro` once to bootstrap, then let futures drive cycles:

```javascript
__macro: (s, p, ctx) => {
  if (s.started) return s;
  ctx.future(0, "startCycle", { cycleId: 1 });
  return { ...s, started: true };
}
```
When the trigger is **not** a pure function of time (message-driven state, accumulated values), use `Behaviors.collect`'s own previous state — the reducer's first argument — to detect changes:

```javascript
__macro: (s, p, ctx) => {
  if (p.someValue === s.lastValue) return { ...s, lt: p.logicalTime }; // idle
  // ... schedule work for the new value
  return { ...s, lastValue: p.someValue, lt: p.logicalTime };
}
```

The 2D wave example uses the pure-function approach: `_waveOrigin(t)` vs `_waveOrigin(t-1)`. When the origin hasn't moved, all 100 cells return immediately — zero futures scheduled.

---

### Host helpers

Three functions live in the host layer, registered on `meta.ps.app` and callable from inside the META_PROGRAM string as `Renkon.app.*`:

- **`_worldNextAt(world)`** — scans all node states for the minimum `_nextAt`, returns it or `null`. Used to advance `wallTime` correctly during drain and warp.
- **`_worldSnapshot(world, source, iter)`** — scans all W nodes (identified by having an array `_queue`) and captures their current scalar fields into a plain serialisable object. Used for telemetry and future network snapshot/restore. Optional — metas that don't need telemetry (e.g. wave worlds) simply don't register it; META_PROGRAM calls it with optional chaining (`?.`) so absent registration is silently skipped.

---

## Distributed determinism invariants

These invariants must hold for two peers to stay in sync across arbitrary network jitter:

1. **`wallTime = lt`** — pure logical tick count. No `Date.now()` in the model.

2. **The canonical pulse is frozen and delivered unchanged.** The Reflector stamps `wallTime` once and freezes the pulse object. Peers receive the original — delivery delay does not alter content.

3. **Warp uses queue-derived `wallTime`.** During warp, `wallTime` is advanced to `_worldNextAt` on each iteration — the actual `fireAt` values already in the queue — not to `Date.now()`. This ensures both peers traverse the same synthetic time sequence.

4. **No closures in queue payloads.** All future payloads are plain scalars or plain objects. This makes state fully serialisable and comparable across peers.

5. **Stability is locally determined.** Each peer settles its own wavefront independently. Because inputs are identical, independent local settlement converges to the same result — no cross-peer coordination is needed during a wave.

6. **Queued pulse receiver.** The META_PROGRAM receiver uses `{queued: true}` — no pulse is silently dropped under jitter or load. Each pulse is processed in arrival order.

7. **`__macro` fires at most once per `logicalTime`.** `W.reduce` tracks `_lt` and skips `__macro` injection if the node already processed this logical tick. This prevents double-firing under warp replay without any app-level guard.

---


## Telemetry

The evaluator captures a `_telemetry` map on each world, keyed by `logicalTime`. Each key holds an array of snapshots — one per `evaluate()` call during that wave:

```javascript
{ source: "macro" | "drain" | "warp", iter: Number, nodes: {
    [nodeName]: { ...userFields, queueLen, nextAt }
} }
```

Snapshots are produced by `_worldSnapshot` — generic, no node-name coupling. The telemetry window is bounded to the last 5 logical times to prevent unbounded growth.

`_lastDrainIters` and `_lastWarpIters` are stored as scalars for quick UI display.

The snapshot format is deliberately fully serialisable, positioning telemetry as a foundation for future network snapshot/restore: a late-joining peer could receive a stable snapshot, reconstruct node states and queues, inject a synthetic pulse at the correct `logicalTime`, and resume from that point — consistent with the Krestianstvo model of snapshot-plus-replay.

---

## Feedback Loop

A **feedback loop** is a wave that deepens through multiple iterations of inter-node exchange before reaching a fixed point. Unlike a linear chain of futures, a feedback loop involves nodes that respond to each other cyclically — each response potentially triggering another request, until a convergence condition is met.

The term *feedback loop* is preferred over *recursion* because there is no call stack involved. Each iteration is a new entry in a node's queue, processed in a subsequent drain iteration. The depth is a property of the *wave*, not of any function's activation frame.

### `ctx.feedback(msg, payload, maxDepth)`

Feedback loops are expressed through a dedicated effect type distinct from `ctx.future()` and `ctx.send()`:

```javascript
ctx.feedback("respond", { value, cycleId }, 64);
```

`ctx.feedback()` schedules a message at `wallTime + _fbStepMs` (where `_fbStepMs` defaults to `0`, making it equivalent to `ctx.future(0, ...)` in the default case), but increments the wave's depth counter by 1. `_fbStepMs` is configurable via `makeMeta` and allows feedback steps to carry a small non-zero delay when needed. If `depth >= maxDepth` the call is a silent no-op, enforcing termination without requiring the handler to check depth manually. The `maxDepth` parameter makes the termination budget explicit and local to each feedback relationship.

### Depth as a first-class wave property

Every queue entry and every outbox message carries a `_depth` field. `W.reduce` tracks the maximum depth seen across all ready entries in each evaluate call and writes it back as `_depth` on the node state. `W.stable()` requires `_depth === 0` on all nodes — a world with an in-progress feedback loop is never considered stable, keeping the drain loop running until the loop fully unwinds.

Depth propagates across node boundaries according to these rules:

| Effect | Depth carried |
|---|---|
| `ctx.feedback(msg, payload)` | `depth + 1` — explicit loop increment |
| `ctx.send(target, msg)` | `depth` — same wave, preserved across node boundary |
| `ctx.future(0, msg)` | `depth` — zero-delay, same wave phase |
| `ctx.future(N, msg)` where N > 0 | `0` — new real-time phase, depth resets |
| `__macro` injection | `0` — new wave boundary, always resets |

`ctx.send()` preserving depth is critical: without it, a feedback loop that crosses a node boundary via `send()` would reset depth to 0 on delivery, making the accumulating depth invisible to `W.stable()` and breaking convergence tracking.

### Wave depth diagram with feedback

```
Logical time  T
              │
           pulse
              ├── depth 0   estimator.__macro  → ctx.future(0, "sendObserve")
              ├── depth 0   estimator.sendObserve → ctx.send("corrector", "observe")
              ├── depth 0   corrector.observe   → ctx.feedback("respond")
              ├── depth 1   corrector.respond   → ctx.send("estimator", "refine")
              ├── depth 1   estimator.refine    → delta > ε → ctx.feedback("continueRefine")
              ├── depth 2   estimator.continueRefine → ctx.send("corrector", "observe")
              ├── depth 2   corrector.observe   → ctx.feedback("respond")
              ├── depth 3   ...loop continues...
              └── depth N   delta < ε → no ctx.feedback → queues drain → stable
```

### Example: fixed-point bisection

The reference implementation uses two nodes — `estimator` and `corrector` — running a bisection toward the nearest integer.

**estimator** proposes an initial value each macro pulse and refines it on each correction received:


```javascript
// estimator: proposes value, refines on correction
__macro: (s, p, ctx) => {
  if (p.logicalTime % FB_CYCLE_MS !== 1) return s;
  const initial = 50 + 49 * Math.sin(p.wallTime * 0.0023);
  ctx.future(0, "sendObserve", { value: initial, cycleId: p.logicalTime, wt: p.wallTime });
  return { ...s, value: initial, iterations: 0, cycleId: p.logicalTime, trace: [{n:0, v:initial}] };
},
sendObserve: (s, p, ctx) => {
  if (p.cycleId !== s.cycleId) return s;
  ctx.send("corrector", "observe", { value: p.value, cycleId: p.cycleId });
  return s;
},
refine: (s, p, ctx) => {
  if (p.cycleId !== s.cycleId) return s;
  const delta = Math.abs(p.correction - s.value);
  const refined = (s.value + p.correction) / 2;
  if (delta > 0.01)
    ctx.feedback("continueRefine", { value: refined, cycleId: s.cycleId }, MAX_FB_DEPTH);
  const newIter = s.iterations + 1;
  const newTrace = s.trace ? [...s.trace, {n: newIter, v: refined}] : [{n: newIter, v: refined}];
  return { ...s, value: refined, iterations: newIter, trace: newTrace };
},
continueRefine: (s, p, ctx) => {
  if (p.cycleId !== s.cycleId) return s;
  ctx.send("corrector", "observe", { value: p.value, cycleId: p.cycleId });
  return s;
},

// corrector: computes midpoint toward nearest integer
observe: (s, p, ctx) => {
  if (p.cycleId < s.cycleId) return s;
  const target = Math.round(p.value);
  const correction = (p.value + target) / 2;
  ctx.feedback("respond", { correction, cycleId: p.cycleId }, MAX_FB_DEPTH);
  return { ...s, correction, cycleId: p.cycleId };
},
respond: (s, p, ctx) => {
  if (p.cycleId !== s.cycleId) return s;
  ctx.send("estimator", "refine", { correction: p.correction, cycleId: p.cycleId });
  return s;
},
```
Convergence ratio 3/4 per step. For `delta_0 = 0.48`, `EPSILON = 0.01`: ~14 iterations.

The `trace` array is built inside the world program on each `refine` call and exported — the bisect canvas reads the complete convergence trajectory without RAF sampling artifacts.

---

## Two-layer time

```
Logical time  T ──────────────────────────────────────▶
              │          │          │
           pulse(lt=1) pulse(lt=2) pulse(lt=3)    shared, discrete
              │
              ├── sub-tick 0      (macro phase)
              ├── sub-tick 0.5    (Zeno step — if scheduled, depth 0..N for feedback loops)
              ├── sub-tick 0.75
              ├── ...
              └── stable          (all fireAt ≥ wallTime+1, all depths 0, outbox empty)

```

Macro time is shared and observable. Sub-tick time is local and transient. Feedback loops deepen the micro phase but remain invisible externally; only the converged result is exported. This is the same two-layer model described in the original Renkon/Krestianstvo design, made explicit and enforced by the wavefront evaluator.

---
## Deterministic Pseudo-Random Number Generator

The Krestianstvo Wavefront Evaluator includes a deterministic **xorshift128+** PRNG (`W.rng`) to ensure all peers produce identical random sequences from the same seed. All peers seeded identically will generate the same values in the same order — guaranteed consensus on randomness.

![Deterministic Pseudo-Random Number Generator](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/r0e9qenfag5wvx3i5tkz.jpg)

> **WARNING**: never use `Math.random()` inside world nodes — it is non-deterministic and will cause peers to desync.

### W.rng API

```javascript
W.rng.next()          // → float in [0, 1)
W.rng.nextInt(n)      // → integer in [0, n)
W.rng.seed(lt)        // re-seed from logicalTime (deterministic per-cycle reset)
W.rng.state()         // → { s0, s1, s2, s3 }  (snapshot)
W.rng.restore(state)  // restore from snapshot
```

The session seed is set once at startup via `makeMeta`:

```javascript
const SESSION_RNG_SEED = { s0: 0x12345678, s1: 0x9abcdef0, s2: 0xdeadbeef, s3: 0xcafebabe };
const meta = makeMeta(peerId, SESSION_RNG_SEED, REFLECTOR_MS);
// W.rng.restore(SESSION_RNG_SEED) is called internally
```

### RNG example — deterministic sequence per cycle

The RNG example generates `RNG_STEPS=20` values per cycle, re-seeding from `cycleId` at the start of each cycle so every peer produces the same sequence:

```javascript
const rngNode = Behaviors.collect(
  { values: [], cycleId: 0, started: false },
  reflector,
  (state, pulse) => W.reduce(state, pulse, "rngNode", {
    __macro: (s, p, ctx) => {
      if (s.started) return s;
      ctx.future(0, "generate", { cycleId: 1, step: 0, values: [] });
      return { ...s, started: true };
    },
    generate: (s, p, ctx) => {
      if (p.cycleId !== s.cycleId && p.cycleId > 1) return s;  // stale guard
      if (p.step === 0) W.rng.seed(p.cycleId);                 // re-seed per cycle
      const v      = W.rng.next();
      const values = [...(p.values || []), v];
      if (values.length < RNG_STEPS) {
        ctx.future(0, "generate", { cycleId: p.cycleId, step: p.step + 1, values });
      } else {
        ctx.future(RNG_CYCLE_TICKS, "generate", { cycleId: p.cycleId + 1, step: 0, values: [] });
      }
      return { ...s, values, cycleId: p.cycleId };
    },
  })
);
```

**Architecture:**
```
rngNode.__macro   → once (started guard): ctx.future(0, "generate", {cycleId:1, step:0, values:[]})
rngNode.generate  → stale guard (p.cycleId !== s.cycleId && p.cycleId > 1): drop
                  → step=0: W.rng.seed(cycleId)         // deterministic re-seed
                  → W.rng.next() → append to values[]   // carried in payload, not state
                  → if values.length < RNG_STEPS:
                      ctx.future(0, "generate", {cycleId, step+1, values})  // sub-tick chain
                  → else:
                      ctx.future(RNG_CYCLE_TICKS, "generate", {cycleId+1, step:0, values:[]})
```

Note: `values` accumulates in the **payload** across the sub-tick chain (not in node state) and is only committed to state on the final step. This avoids intermediate state exports mid-chain.

Parameters: `RNG_STEPS=20`, `RNG_CYCLE_TICKS=80 ticks`
---

## W API Reference

```javascript
// Node reducer — call inside Behaviors.collect
W.reduce(state, pulse, nodeId, handlers) → newState

// Stability check — use in _isStable
W.stable(nodes, pulse) → boolean

// Export world state to world.app (call from world program)
W.export(Renkon, { node1, node2, ... }, isStable)

// Self-hosting clock mixin — spread into handlers
W.localReflector(tickMsg, innerTickDelay) → handlersMixin

// Strip infrastructure fields (_queue, _nextAt, _depth, _lt)
W.getState(node) → { ...userFields }
```

---

### Handler Context (ctx)

```javascript
ctx.wallTime                            // current logical wallTime (= lt)
ctx.logicalTime                         // current logicalTime (= lt)
ctx.depth                               // current feedback depth

ctx.future(delay, msg, payload)         // schedule at wallTime + delay
ctx.send(targetId, msg, payload)        // cross-node via outbox
ctx.feedback(msg, payload, maxDepth)    // depth-tracked future at wallTime + _fbStepMs (convergence)
ctx.futureInf(msg, payload)             // fireAt = wallTime — re-enqueues every drain pass
ctx.localReflector(tickMsg, delay)      // sub-tick self-hosting clock step
```
---

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| `wallTime = lt` not `Date.now()` | Pure determinism — immune to real-time jitter |
| Single reflector for all worlds | One clock, all peers |
| Future delays in logical ticks | No unit confusion, scale-independent |
| `SUBTICK_MS = 1` boundary | Clean two-level clock without extra machinery |
| Warp only on `LT > lastLT + 1` | Logical gaps only — normal ticks drain naturally |
| `future(0)` chains drain synchronously | Arbitrary within-tick computation |
| `ctx.feedback` with depth tracking | Convergence loops as observable wavefront property |
| `W.localReflector` mixin | Self-hosting clock, autonomous operation |
| Outbox flush after drain | Cross-node sends settle before stability check |
| `setLt(n)` on reconnect | Prevents logicalTime regression after autonomous mode |
| `trace` array in world state | Full convergence path without RAF sampling |
| No separate wave shim | All worlds share one reflector — future-driven cycles only |

---

## Local Reflector as Simulation Speed Control

The local reflector's tick size directly defines the unit of computation — it can be used to decouple the **simulation resolution** from the **network synchronisation rate**.

### Concept

The outer reflector gives one tick per `REFLECTOR_MS` real time (e.g. 50ms). The local reflector subdivides each outer tick into `N` inner steps by setting `innerTickDelay = 1/N`:

```
outer tick  = network synchronisation boundary  (every 50ms real time)
inner tick  = simulation integration step       (every 1/N logical units)

ratio N = inner_ticks_per_outer_tick = 1 / innerTickDelay
```

Change `innerTickDelay` and you change how much computation happens per network tick — without touching the reflector rate, without changing real-time intervals, without breaking determinism. Both peers run exactly the same `N` inner steps per outer tick.

### Physics simulation example

```javascript
// PHYSICS_STEP_VAL and STEPS_VAL injected via .replace() chain
// PHYSICS_STEP_VAL = 0.1  → 10 steps per outer tick
// PHYSICS_STEP_VAL = 0.01 → 100 steps per outer tick

const physics = Behaviors.collect(
  { pos: 0, vel: 1, step: 0, _localActive: false },
  reflector,
  (state, pulse) => W.reduce(state, pulse, "physics", {

    // Bootstrap local clock on first __macro
    ...W.localReflector("simulate", PHYSICS_STEP_VAL),

    simulate: (s, p, ctx) => {
      // One integration step using innerTickDelay as dt
      const dt     = p._innerTickDelay;
      const newPos = s.pos + s.vel * dt;
      const newVel = s.vel * 0.99;         // damping
      const newStep = s.step + 1;

      if (newStep < STEPS_VAL) {
        ctx.localReflector("simulate", dt); // reschedule at same rate
      }
      // else: all steps done — world stable until next outer tick

      return { ...s, pos: newPos, vel: newVel, step: newStep };
    },

    // External event — arrives only at outer tick boundaries
    applyForce: (s, p, ctx) => {
      return { ...s, vel: s.vel + p.force };
    },
  })
);
```

### Speed multiplier table

| `innerTickDelay` | Steps per outer tick | Equivalent simulation rate |
|-----------------|---------------------|---------------------------|
| `0.5`           | 2                   | 2× per network tick        |
| `0.1`           | 10                  | 10× per network tick       |
| `0.01`          | 100                 | 100× per network tick      |
| `0.001`         | 1000                | 1000× (near float floor)   |

### Key properties

**Deterministic** — both peers run exactly `STEPS_PER_TICK` inner steps per outer tick. `innerTickDelay` is injected via `.replace()` so it's identical in both world instances.

**External events at outer tick boundaries** — `applyForce` (user input, collision with another peer) arrives via `ctx.send()` from the outer reflector pulse. The local clock runs "inside" each outer tick; external events "interrupt" only between outer ticks. This matches how multiplayer physics engines handle authority boundaries.

**Variable resolution** — different worlds can run at different inner rates on the same outer reflector. A physics world at `0.01` and an AI world at `0.1` both synchronise at the same outer tick boundary, each running its own number of inner steps.

**Analogous to game engine substeps** — physics at 300Hz, rendering at 60Hz, network sync at 20Hz. In Krestianstvo terms: local reflector at `1/300` ticks, outer reflector at `1/20` ticks, external events only at outer tick boundaries.

---

## Autonomous Mode

The **DISCONNECT / RECONNECT** button demonstrates peer autonomy.

### On Disconnect

If user disconected with outer reflector. `meta.startAutonomous()` on all metas starts a local `setInterval(REFLECTOR_MS)` injecting pulses:

```javascript
{ logicalTime: localLt++, wallTime: localLt, _isLocal: true }
```

All worlds continue animating using purely logical ticks. The local state is **deterministic and correct** for purely internal computation — it is exactly what the reflector would have produced, since world programs here have no external inputs beyond the logical clock itself. Every peer running autonomously produces identical state.

The state becomes **speculative** only in full Krestianstvo when the reflector carries external events (user input, peer messages, new joins). In that case, missing those events means the local computation since disconnect must be discarded and replayed from the authoritative event stream on reconnect. The current examples contain no external events, so no rollback occurs.

### On Reconnect

Animation resumes seamlessly. If any world diverged, warp fires and replays the authoritative state. The speculative work is cleanly discarded. In full Krestianstvo with external events, this becomes optimistic simulation — compute locally, correct authoritatively on reconnect. For purely internal worlds, it is simply correct deterministic continuation.

---

## Examples

### Example 1 — Counter (Wavefront Integrity Physical Trace)

![Counter demo](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/lb2cuyz2rozovpzio49w.gif)

Demonstrates the Krestianstvo consensus model. Two peers independently run sub-step chains. The view shows each peer's progress and marks **SUCCESS** only when both reach the same target — confirming deterministic consensus.

**Architecture:**
```
counter.__macro      → once (started guard): ctx.future(0, "newCycle", {cycleId:1})
counter.newCycle     → ctx.send("subcounter", "startSubCount", {cycleId})
                     → ctx.future(COUNTER_CYCLE_MS, "newCycle", {cycleId+1})
subcounter.startSubCount → guard (p.cycleId <= s.currentCycle): drop stale
                         → ctx.future(0, "step", cycleId)        // bootstrap first step
                         → reset subCount, stepsDone, stepsTarget
subcounter.step      → payload is scalar cycleId (not object)
                     → guard (cycleId !== s.currentCycle || stepsDone >= SUB_STEPS): drop
                     → if next < SUB_STEPS: ctx.future(STEP_MS, "step", cycleId)
```

Parameters: `STEP_MS=1 tick`, `SUB_STEPS=50`, `COUNTER_CYCLE_MS=60 ticks`

### Example 2 — Fixed-Point Bisection (Feedback Loop Convergence)

![Feedback Loop demo](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/t7ocpkhenkqms6n4f0lh.gif)

Demonstrates `ctx.feedback` — a convergence loop that animates step by step. Depth is a first-class observable property of the wavefront.

The initial value for each cycle uses a sine-based formula:
 
```
initial = 50 + 49 × sin(lt × 0.0023)
```
 
This produces values spread across `[1, 99]` with varying fractional parts on every cycle — the irrational multiplier `0.0023` ensures the sequence never repeats over any practical run. Some cycles land very close to an integer (fast convergence, 3–5 iterations), others land near the midpoint between two integers (slow convergence, 20+ iterations). The depth bar and canvas curve look different each cycle, making the wavefront depth visibly meaningful.

**Architecture:**
```
estimator.__macro     → every 80 ticks (logicalTime % 80 === 1)
                      → ctx.future(0, "sendObserve", {value, cycleId})
corrector.observe     → ctx.feedback("respond", correction, MAX_FB_DEPTH)
corrector.respond     → ctx.send("estimator", "refine", correction)
estimator.refine      → ctx.feedback("continueRefine") if delta > EPSILON
estimator.continueRefine → ctx.send("corrector", "observe", refined)
```

The bisect canvas shows the convergence trajectory (value vs iteration) for both peers, with a frozen arc between cycles and faded history traces. The `trace` array is built inside the world program and exported — bypassing the RAF sampling problem.

The number of refinement iterations varies per cycle depending on `|initial - target|`. Each iteration crosses the node boundary twice (estimator → corrector → estimator), so `estimator.iterations` equals the wavefront depth at convergence. Both peers start from the identical deterministic `initial` value and apply the same formula — they converge to the same result in the same number of steps, confirming distributed determinism.


Parameters: `EPSILON=0.01`, `MAX_FB_DEPTH=64`, `FB_STEP_MS=1 tick`, cycle every `80 ticks`

### Example 3 — 2D Wavefront Stress (225 independent W nodes, user-triggered waves)

![Wave 2D demo](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/l6lqb0ei3pcz92fwkrzh.gif)

A 15×15 grid of cell nodes. Waves are triggered by user interaction (mouse/touch click). The `clock` node receives injected `cellClick` events and broadcasts a `wave` message to all 225 cells. Each cell independently schedules its own propagation delay based on distance from the click origin.

### Architecture

```
clock (event)    → injectExternalEvent({type:"cellClick", ox, oy, wt, clientId})
                   enqueued directly onto clock._queue as a "userWave" entry
clock.userWave   → ctx.send("cell_N", "wave", {ox, oy, wt, clientId}) × 225
clock.__macro    → once (_alive guard): ctx.future(1, "_keepalive", {})
clock._keepalive → ctx.future(1, "_keepalive", {})   // perpetual heartbeat

cell.wave        → dist = sqrt((cx-ox)²+(cy-oy)²)
                   contribution = cos(dist*0.45) * exp(-dist*0.22) * 0.8
                   ctx.future(max(1, floor(dist * WAVE_STEP_MS)), "activate", {contribution, clientId})
cell.activate    → ctx.future(WAVE_DECAY_MS, "decay", {contribution})
                   amp += contribution, _count++, active = true
cell.decay       → _count--; amp -= contribution (or 0 if _count reaches 0)
                   active = _count > 0
```

Each cell captures its grid position `(cx, cy)` in a closure at construction time (`cx = id % GRID_W`, `cy = floor(id / GRID_W)`). The propagation delay `max(1, floor(dist × WAVE_STEP_MS))` is scheduled as a `ctx.future` in each cell's own local queue — 225 independent queues, no central structure.

**Overlapping waves**: `activate` accumulates `amp` and increments `_count`; `decay` decrements both. Multiple in-flight waves from the same or different users overlap additively and decay independently.

### Node generation via multi-script array

The 225 cell declarations are generated programmatically by `makeWave2dScripts()`, which builds a second script string via `Array.from({ length: GRID_W * GRID_H }, ...)` and returns `[wave2dWorldProgram, cellScript, avatarScript]`. The multi-script array is passed to `makeWorld` — each script is evaluated in the same Renkon scope, so `_makeCell` defined in script 1 is available when cell declarations in script 2 call it.

### W.stable under load

`W.stable([clock, cell_0, ..., cell_224], reflector)` checks all 226 node queues on every evaluate call. The world is stable only when every cell has both fired `activate` and `decay` for all in-flight waves — all queues empty, all `_depth` values 0.

Parameters: `GRID_W=15`, `GRID_H=15`, `WAVE_STEP_MS=2 ticks`, `WAVE_DECAY_MS=28 ticks`

### Example 4 — Zeno Series (Sub-Tick Futures + Local Reflector)


![Zeno Series demo](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/5fu9ktvx2hmzxepqyk5q.jpg)

Demonstrates sub-tick scheduling and the `W.localReflector` primitive.

A geometrically decreasing series of futures, all within one logical tick:

```
future(0.5)    → sum = 0.5
future(0.25)   → sum = 0.75
future(0.125)  → sum = 0.875
...            → converges to 1.0 (never reached, ~13 steps)
```

Uses `W.localReflector` — a handler mixin bootstrapping a self-hosting clock node:

```javascript
const zeno = Behaviors.collect(
  { n: 0, sum: 0, localLt: 0, cycleId: 0, _localActive: false },
  reflector,
  (state, pulse) => W.reduce(state, pulse, "zeno", {
    ...W.localReflector("tick", ZENO_INITIAL_DELAY),  // activate on first __macro

    tick: (s, p, ctx) => {
      const delay     = p._innerTickDelay ?? ZENO_INITIAL_DELAY;
      const newSum    = s.sum + delay;
      const nextDelay = delay / 2;
      if (nextDelay > ZENO_MIN_DELAY)
        ctx.localReflector("tick", nextDelay);              // halve and reschedule
      else
        ctx.future(ZENO_CYCLE_TICKS, "restart", {});        // series done, wait for next
      return { ...s, localLt: s.localLt + 1, n: s.n + 1, sum: newSum };
    },

    restart: (s, p, ctx) => {
      ctx.localReflector("tick", ZENO_INITIAL_DELAY);
      return { ...s, n: 0, sum: 0, cycleId: s.cycleId + 1 };
    },
  })
);
```

All `tick` steps fire within the current drain pass (`delay < SUBTICK_MS = 1`). Both peers run identical step counts — deterministic consensus on the Zeno series.

### Example 5: Fractal Heartbeat demo

[hb2](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/swuy8y8i4t23agg54evs.gif)

Demo that creates a "symphony" of events where the high-frequency notes are perfectly synchronized and nested within the low-frequency beats, all managed by the deterministic Wavefront algorithm.

Summary of the "Fractal" Parameters:

* FRACTAL_DEPTH (5): How many "generations" of sub-beats are allowed.

* FRACTAL_BASE_DELAY (0.5): The starting speed of the "root" beat.

* FRACTAL_DECAY (0.14): How quickly the visual "energy" fades after a pulse passes.

* FRACTAL_CYCLE (80): Every 80 logical ticks, the whole system "resets" and starts a fresh cascade.

The Fractal Heartbeat is a sophisticated stress test and architectural demonstration of the Wavefront Evaluator. It creates a recursive, self-propagating temporal structure where time "branches" like a tree.

Instead of one heartbeat, it generates a cascade of heartbeats that get faster and more frequent as they go deeper.

**1. The Core Logic: The "Beat and Split"**

The magic happens inside the beat handler in fractalHeartbeatWorldProgram. When a beat occurs, it does two things simultaneously:

* **Steady Continuity**: It schedules the next beat at the current depth with the same delay.

* **Recursive Branching**: If it hasn't reached the FRACTAL_DEPTH (5 levels), it "spawns" a new beat at the next depth with half the delay (delay * 0.5).

**2. Why it is "Fractal"**

In geometry, a fractal is a shape where the small parts look like the whole. In this code, you are creating a Fractal in Time:

* **Level 0**: Beats every 0.5 sub-ticks.

* **Level 1**: Beats every 0.25 sub-ticks.

* **Level 2**: Beats every 0.125 sub-ticks.

...and so on.

Because each level spawns its own sub-levels, a single initial trigger creates a "shower" of events. This is why the totalBeats counter rises exponentially.

**3. The "Zeno" Connection**

The code uses the Geometric Series. By halving the delay at every depth, the algorithm is attempting to pack a "cascade" of logic into the smallest possible slices of time. The FRACTAL_MIN_DELAY (0.005) acts as the **"Planck Length"** — the point where the simulation stops because the time slices are too small to process efficiently.

**5. The Visualizer (The Canvas)**

The _renderFractal function draws "Energy" on a canvas. Each "Depth" is assigned a different color. The history array tracks the "energy" (activity) at each level.

When you look at the canvas, you see the Wavefront itself—pulses of activity moving through the sub-tick timeline like ripples in water.

---

## Develop and Run

``` 
npm install
npm start
```
That will start local Reflector and server for hosting static files.

Open web browser:  
http://localhost:3000 - list demo apps.  

URL params for demo page:   
- ?app=appName&k=seloID

### Running in Renkon Pad
 
Load **kwe-index.renkon** in local/remote running instance of [Renkon Pad](https://github.com/yoshikiohshima/renkon-pad), the interactive browser-based environment for Renkon programs. The evaluator runs directly in Renkon Pad with no build step.

---

## Related works

* Hardware Description Languages (VHDL / Verilog) where computer chips are simulated.

The Macro-tick is the "Clock Signal" of the CPU. The Micro-ticks are called "Delta Cycles." Inside one clock cycle, electricity flows through gates; one gate flipping causes the next to flip. The simulator "drains" these flips until the circuit is stable before moving to the next clock pulse.

* Parallel Discrete Event Simulation (PDES)

In large-scale military or weather simulations, you can't have one central queue (it’s a bottleneck). They use the Chandy-Misra-Bryant algorithm or Time Warp (Jefferson). These allow different "Islands" of the simulation to process their own local queues and only sync up when they absolutely have to.

* Distributed Databases (Vector Clocks)

Systems like Amazon’s Dynamo use logical clocks to determine the order of events across different servers. While they don't usually use "Wavefronts", they rely on the same principle: Local time authority combined with a protocol for global agreement.


## Contributing

All code is published under the MIT license.