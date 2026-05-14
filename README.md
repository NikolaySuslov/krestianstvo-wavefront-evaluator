# Krestianstvo Wavefront Evaluator

*Architecture overview and core concepts*

---

The Krestianstvo Wavefront Evaluator is a deterministic reactive collaborative computational engine for multiplayer, distributed applications built on top of [Renkon](https://github.com/yoshikiohshima/renkon) and ideas of [Krestianstvo | Renkon](https://github.com/NikolaySuslov/krestianstvo-renkon) implemented in pure FRP the [Croquet VM](https://github.com/croquet/croquet) synchronisation applicaition architecture.

It replaces the Krestianstvo VM with a fundamentally different approach to time, computation, and inter-node communication — one where causality propagates as a *wavefront* through a graph of locally autonomous nodes, rather than being routed through a central message dispatcher.

#### Live demo: https://wavefront.krestianstvo.org

![](/doc/img/wave2d.gif)

---

## Table of Contents

- [The Relation to Physics](#the-relation-to-physics)
- [Fractal Heartbeat](#fractal-heartbeat-and-local-reflector)
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

![](/doc/img/fractal.gif)

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

* **In the algorithm**: The messages in the local queues are like "Potential Energy." As the nodes fire, they "dissipate" that energy. When the queues are empty, the system has reached Stability (Equilibrium). The "Stable" flag in code is literally the signal that the system has settled into its lowest "energy" state for that tick.


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

#### Generating Fractal Heartbeats

Fractal heartbeats form a vector space; they can be added together to yield an object of the same nature. This stands in contrast to harmonic oscillations of different frequences, the sum of which is not a harmonic oscillation.  
Phase analysis is simplifying.

Orthogonal (perpendicular in space-time) fractal heartbeats are generated through scaling, whereas orthogonal harmonic oscillations are non-homothetic (dissimilar), and each requires separate generation.   

#### How that recursive nesting works within the implementation:

#### 1. Logical Recursion (The "Loop")

The most basic form of recursion is a single node "ticking" itself. In the krestianstvo-wavefront-evaluator.js code, this is handled by a state-guarded feedback loop.
* Step 1: A node receives a pulse and calls ctx.localReflector(0.1).
* Step 2: The Evaluator puts a message in the queue for T + 0.1.
* Step 3: When the clock hits 0.1, the node receives a __local_tick message.
* Step 4: The node's logic immediately calls ctx.localReflector(0.1) again.

Is it truly recursive?

* In Logic: Yes. Tick(n) to Tick(n+1).
* In Memory: No. The evaluator uses the Priority Queue to "flatten" this recursion. Instead of the function calling itself and growing the stack, it "yields" to the queue. The META_PROGRAM loop then picks it back up.

#### 2. Cascading Reflectors (The "Nesting")

You can have multiple nodes, each running its own local reflector, and they can trigger each other. This creates a "Reflector within a Reflector" behavior.

* Node A (running at 0.1 intervals) calculates a physics state.
* At T+0.2, Node A sends a message to Node B.
* Node B receives that message and, as a result, starts its own local reflector running at 0.05 intervals to handle a high-speed sub-calculation (like an explosion or a particle effect).

In this scenario, Node B’s "Local Reflector" is logically nested inside the timeline generated by Node A’s reflector. The Evaluator manages all these different frequencies perfectly because it simply sorts all resulting messages by their fireAt time.

### 3. Creating "Emulated Ticks" for Sub-Reflectors

The system allows you to create **"Nested Time Scales"** using the Zeno sub-ticks.

If you want a "Local Reflector" to emulate a whole second's worth of logic inside a single sub-tick, you use Temporal Compression:

1. The Global Reflector is at T=100.
2. Your node uses W.future(0.001, msg) to run a local loop.3. Each loop only advances the internal state, while the logical time only moves by 0.001.

> **This allows you to run a "Virtual World" inside a single tick of the "Real World."**

#### 4. The "Stability" Safety Valve

The main risk with recursive reflectors is an **"Infinite Loop"** that freezes the browser. The evaluator has a built-in safety mechanism: **The Integer Boundary**.

Even if your recursive reflectors create 1,000,000 sub-ticks, the Evaluator will only process them as long as they are less than the next integer tick.

* If a recursive call accidentally schedules a message for T+1.1, the Evaluator stops and waits for the next real pulse from the external Reflector to "authorize" that time.

* This prevents a "Local Paradox" where one node lives in the year 2030 while the rest of the peers are in 2026.

#### 5. Summary: Local reflector with a flat structure

Think of it like this: You can't create a **"Reflector inside a Reflector"** in terms of code structure, but you can create a **"Wavefront that triggers another Wavefront."**.

Because every message in the Evaluator is just a **(time, target, data)** tuple, the system doesn't care if a message came from a real human, a global heartbeat, or a recursive local sub-tick. It treats them all as equal "waves" moving through the graph.


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

Warp does **not** fire on normal sequential pulses (`LT+1`). With pure logical time, a world may legitimately have pending futures when the next pulse arrives — those drain normally. Only genuine missed pulses trigger warp.

Warp preserves determinism because the synthetic `wallTime` values injected during the loop are derived from the node queue's own `fireAt` entries — the same values that the heartbeat would have delivered in real time, in the same order. Both peers warp through the same sequence and reach the same state.

### Drain

**Drain** exhausts all ready queue entries within a micro phase. Condition: stop when `_worldNextAt >= wallTime + SUBTICK_MS` — the next future is in the next tick or later. After the drain, an outbox flush delivers any pending `ctx.send()` messages.

### Stability

A world is **stable** when three conditions all hold:

1. All node queues contain only entries with `fireAt > wallTime` (no ready work remaining)
2. No node is mid-feedback-loop (`_depth === 0` on all nodes)
3. The shared outbox is empty — no `ctx.send()` message is pending delivery

Conditions 1 and 2 are checked by `W.stable()` generically across all nodes. Condition 3 guards against a subtle timing issue: a `ctx.send()` written by one node during an evaluate pass lands in the outbox, not a queue — so the queue check alone would miss it. Without the outbox check, the drain loop exits while a message is in-flight, the receiving node never processes it, and the wave terminates prematurely. The application's own semantic completion condition (e.g. `stepsDone >= stepsTarget`) is defined by the user in `WORLD_PROGRAM` and combined with `W.stable()` in the `_isStable` expression.

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

Order:

1. **WARP** — fires only when `logicalTime > lastLT + 1` (peer missed pulses). Drains world synchronously via `_worldNextAt` until stable. Catches up a lagged peer to authoritative state.
2. **DRAIN** — fires all futures with `fireAt < wallTime + SUBTICK_MS`. Stops when next future is in the next tick.
3. **Outbox flush** — one extra evaluate to deliver pending `ctx.send()` messages.

META_PROGRAM never knows the names of nodes inside a world. All world-level introspection goes through generic host helpers (`_worldNextAt`, `_worldSnapshot`).

### W — the node runtime

`W` is the functional core of each node. Its `reduce` function takes `(state, pulse, nodeId, handlers)` and returns a new state. On each call it:

1. Collects inbound outbox messages written by a *previous* evalGen — same-gen messages are deferred to the next evaluate pass, preventing a node from consuming a message written by another node in the same pass
2. Collects inbound `send()` messages for this node from the outbox
3. Splits the node's own queue into ready (fireAt ≤ wallTime) and later entries
4. Injects `__macro` at the front of the ready list on non-sub-tick pulses — **once per `logicalTime`**. `W.reduce` tracks `_lt` (the last `logicalTime` for which `__macro` was injected) as infrastructure state alongside `_queue` and `_nextAt`. If `_lt === logicalTime`, `__macro` is skipped — preventing double-firing under warp replay. This makes incremental `__macro` the default: the handler is guaranteed to be called at most once per logical tick, and can freely choose to do nothing when its inputs haven't changed
5. Runs each ready entry through its handler, collecting `future` and `send` effects
6. Enqueues futures into the node's new queue; deposits sends into the outbox
7. Returns the new state with updated `_queue`, `_nextAt`, `_depth`, and `_lt` (infrastructure fields stripped by `W.getState` before the view layer sees them)


`_nextAt` — the timestamp of the next pending entry — is the signal that `_worldNextAt` reads to drive the drain loop. It is written on every `reduce` call without any node-name coupling.

Outbox entries are stamped with `_evalGen` (the evaluation generation at write time). When a node reads its inbound messages it only consumes entries from a **previous** evalGen — entries written in the current evaluate pass are left for the next pass. This ensures that a `ctx.send()` message written by node A is not destroyed before node B reads it, even when both nodes evaluate in the same `evaluate()` call.

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

`W.stable(nodes, pulse)` returns `true` when all node queues have only future-dated entries, no node is mid-feedback, and the outbox is empty. World programs export `_isStable = W.stable([...nodes], reflector)` which META_PROGRAM reads via `world.isStable`.


## ctx Primitives

| Primitive | Semantics |
|-----------|-----------|
| `ctx.future(delay, msg, payload)` | Schedule `msg` after `delay` logical ticks |
| `ctx.send(nodeId, msg, payload)` | Cross-node message via evalGen-gated outbox |
| `ctx.feedback(msg, payload, maxDepth)` | Depth-tracked same-tick future (convergence loops) |
| `ctx.futureInf(msg, payload)` | `fireAt = wallTime` — re-enqueues every drain pass |
| `ctx.localReflector(tickMsg, delay)` | Sub-tick self-hosting clock step |

---

## Local Reflector mixin

A handler mixin creating a self-hosting clock node. Activates on `__macro`, drives itself via `ctx.localReflector(tickMsg, delay)`. Needs no external time reference. The local clock IS the node — purely logical, purely deterministic.

```javascript
...W.localReflector("tick", initialDelay)  // spread into W.reduce handlers
```

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

`ctx.feedback()` schedules a message at the same `wallTime` (like `ctx.future(0, ...)`), but increments the wave's depth counter by 1. If `depth >= maxDepth` the call is a silent no-op, enforcing termination without requiring the handler to check depth manually. The `maxDepth` parameter makes the termination budget explicit and local to each feedback relationship.

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
              ├── depth 0   __macro fires → ctx.send("corrector", "observe")
              ├── depth 0   corrector.observe → ctx.feedback("respond")
              ├── depth 1   corrector.respond → ctx.send("estimator", "refine")
              ├── depth 1   estimator.refine → delta > ε → send back to corrector
              ├── depth 2   ...loop continues...
              └── depth N   delta < ε → no re-send → queues drain → stable
```

### Example: fixed-point bisection

The reference implementation uses two nodes — `estimator` and `corrector` — running a bisection toward the nearest integer.

**estimator** proposes an initial value each macro pulse and refines it on each correction received:


```javascript
// estimator: proposes value, refines on correction
__macro: (s, p, ctx) => {
  if (p.logicalTime % 80 !== 1) return s;  // new cycle every 80 ticks
  const initial = 50 + 49 * Math.sin(p.wallTime * 0.13);
  ctx.future(0, "sendObserve", { value: initial, cycleId: p.logicalTime });
  return { ...s, value: initial, iterations: 0, cycleId: p.logicalTime };
},
refine: (s, p, ctx) => {
  if (p.cycleId !== s.cycleId) return s;
  const delta = Math.abs(p.correction - s.value);
  const refined = (s.value + p.correction) / 2;
  if (delta > EPSILON)
    ctx.feedback("continueRefine", { value: refined, cycleId: s.cycleId }, MAX_FB_DEPTH);
  return { ...s, value: refined, iterations: s.iterations + 1 };
},

// corrector: computes midpoint toward nearest integer
observe: (s, p, ctx) => {
  const target = Math.round(p.value);
  const correction = (p.value + target) / 2;
  ctx.feedback("respond", { correction, cycleId: p.cycleId }, MAX_FB_DEPTH);
  return { ...s, correction, cycleId: p.cycleId };
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

The Krestianstvo Wavefront Evaluator uses a deterministic XOROSHIRO128+ Pseudo-Random Number Generator (PRNG) to ensure that all peers in a distributed simulation arrive at the exact same state, even when "random" events occur. The PRNG is implemented as a core utility that can be seeded and restored to a specific state. 

![](/doc/img/prng.jpg)

>  WARNING: never use the default web browser internal Math.random() — non-deterministic PRNG inside nodes. As that will entail peers desync.
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
ctx.feedback(msg, payload, maxDepth)    // depth-tracked future (convergence)
ctx.futureInf(msg, payload)             // fire every drain pass (capped at 10000)
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

![](/doc/img/counter.gif)

Demonstrates the Krestianstvo consensus model. Two peers independently run sub-step chains. The view shows each peer's progress and marks **SUCCESS** only when both reach the same target — confirming deterministic consensus.

**Architecture:**
```
counter.__macro  → once (started guard): ctx.future(0, "newCycle", {cycleId:1})
counter.newCycle → ctx.send("subcounter", "startSubCount", cycleId)
                 → ctx.future(60, "newCycle", {cycleId+1})    // 60 ticks
subcounter.step  → ctx.future(1, "step", cycleId)             // 1 tick/step × 50 steps
```

Parameters: `STEP_MS=1 tick`, `SUB_STEPS=50`, `COUNTER_CYCLE_MS=60 ticks`

### Example 2 — Fixed-Point Bisection (Feedback Loop Convergence)

![](/doc/img/feedback_loop.gif)

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

### Example 3 — 2D Wavefront Stress (100 independent W nodes, zero inter-node communication)

![](/doc/img/wave2d.gif)

This example is the purest demonstration of the local-queue-of-futures architecture: 100 fully autonomous cell nodes arranged in a 10×10 grid, each receiving the reflector pulse directly, each computing its own wave timing independently. There is no coordinator, no broadcast, no `ctx.send` between nodes (in auto simulation without mouse events).

### Architecture

```
clock.__macro    → once: ctx.future(0, "startWave", {wt: p.wallTime})
clock.startWave  → ctx.send("cell_N", "wave", {ox, oy, wt}) × 100
                 → ctx.future(80, "startWave", {wt+80})    // 80 ticks
cell.wave        → ctx.future(dist * 2, "activate", {wt})   // 2 ticks/unit
cell.activate    → ctx.future(12, "decay", {wt})            // 12 ticks
```

Each cell permanently captures its grid position `(cx, cy)` in a closure at construction time (`cx = id % 10`, `cy = floor(id / 10)`). On every macro pulse each cell independently computes the same deterministic origin — a pure function of `logicalTime` — and derives its own propagation delay. No two cells share any computation or communicate in any way.

### Zero inter-node communication

Wave origin evolves over logical time: `ox = sin(wt * 0.07)`, `oy = sin(wt * 0.05)`. Cells guard with `wt` (the `wallTime` of their wave) not `logicalTime` — correctly ignoring stale futures from previous waves. The origin formula is a pure deterministic function of `logicalTime` — every cell computes it independently and gets the same result. All worlds share the single main reflector — no separate shim.

The wave propagation delay `floor(dist × 80ms)` is scheduled as a `ctx.future` entry in each cell's own local queue. Cell 0 (at the origin) schedules `activate` at `wallTime + 0ms`. A corner cell at distance 8 schedules at `wallTime + 640ms`. These 100 different `fireAt` values live in 100 independent queues — there is no central structure holding all of them. The heartbeat advances `wallTime` and `_worldNextAt` finds the minimum across all 100 `_nextAt` values to know when to fire next. Propagation timing is genuinely distributed across 100 independent queues.

### W.stable and _worldNextAt under load

`W.stable([cell_0, ..., cell_99], reflector)` checks all 100 node queues on every evaluate call. The world is stable only when every cell has both fired its `activate` and its `decay` — all 100 queues are empty and all `_depth` values are 0. This is a genuine distributed fixed point, not a flag set by a central node.

### Node generation via `updateProgram`

The 100 cell declarations cannot be written as a static list in the source — that would require hardcoded `const cell_0 = ...` through `const cell_99 = ...`. Instead, `_waveScript2` is a JavaScript string built at load time by `Array.from({ length: GRID_W * GRID_H }, ...)`, and injected into the world's program via `updateProgram([script1, script2])`. This is the correct call site: outside any evaluation cycle, no mid-evaluation conflict.

Parameters: `GRID_W=10`, `WAVE_STEP_MS=2 ticks`, `WAVE_DECAY_MS=12 ticks`, `WAVE_CYCLE_MS=80 ticks`

### Example 4 — Zeno Series (Sub-Tick Futures + Local Reflector)

![](/doc/img/zeno.jpg)

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
  { n: 0, sum: 0, localLt: 0, _localActive: false },
  reflector,
  (state, pulse) => W.reduce(state, pulse, "zeno", {
    ...W.localReflector("tick", 0.5),      // activate on first __macro

    tick: (s, p, ctx) => {
      const nextDelay = p._innerTickDelay / 2;
      if (nextDelay > MIN_DELAY)
        ctx.localReflector("tick", nextDelay);       // halve and reschedule
      else
        ctx.future(CYCLE_TICKS, "restart", {});      // new series
      return { ...s, n: s.n + 1, sum: s.sum + p._innerTickDelay };
    },

    restart: (s, p, ctx) => {
      ctx.localReflector("tick", 0.5);
      return { ...s, n: 0, sum: 0 };
    },
  })
);
```

All `tick` steps fire within the current drain pass (`delay < SUBTICK_MS = 1`). Both peers run identical step counts — deterministic consensus on the Zeno series.

### Example 5: Fractal Heartbeat demo

![](/doc/img/fractal.gif)

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

Because each level spawns its own sub-levels, a single initial trigger creates a "shower" of events. This is why the totalBeats counter in your code rises exponentially.

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