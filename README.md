# Krestianstvo Wavefront Evaluator

*Architecture overview and core concepts*

---

## What it is

The Krestianstvo Wavefront Evaluator is a deterministic reactive execution engine for multiplayer, distributed applications built on top of [Renkon](https://github.com/yoshikiohshima/renkon) and ideas of [Krestianstvo | Renkon](https://github.com/NikolaySuslov/krestianstvo-renkon) implementing [Croquet VM](https://github.com/croquet/croquet) synchronisation model in pure FRP.

It replaces the previous Krestianstvo VM with a fundamentally different approach to time, computation, and inter-node communication — one where causality propagates as a *wavefront* through a graph of locally autonomous nodes, rather than being routed through a central message dispatcher.

![](/doc/2D_wave.gif)

---

## From Krestianstvo VM to Krestianstvo Wavefront Evaluator

The table below captures the essential shift in each architectural dimension.

| Dimension | Krestianstvo VM | Krestianstvo Wavefront Evaluator |
|---|---|---|
| **Message queue** | Centralised — one shared queue per world, all messages pass through it | Decentralised — each node owns its own local queue of futures |
| **Time authority** | VM clock drives all nodes uniformly | Two-layer time: shared logical pulse + local micro-tick settlement |
| **Causality** | Enforced by queue ordering at the VM level | Emerges from wavefront propagation across node dependencies |
| **Sub-step execution** | Async, RAF-driven — each sub-tick fires one frame later | Synchronous drain loop (STEP_MS=0) or real-time heartbeat (STEP_MS>0) |
| **Late-join / desync recovery** | Manual snapshot and replay | Warp mechanism — local clock-advance to catch up before advancing |
| **Node communication** | VM routes messages between nodes centrally | `ctx.send()` writes to a per-world outbox; nodes pull inbound on next evaluate |
| **Stability detection** | VM-level flag | `W.stable()` checked after each evaluate call; user defines the condition |
| **Introspection** | Opaque | `_telemetry` captures per-evaluate snapshots across all nodes generically |

The central insight of the shift: in the VM architecture the queue *was* the synchronisation mechanism. In the Wavefront Evaluator, the queue is a local implementation detail of each node — synchronisation is achieved instead through shared logical time and deterministic local computation.

---

## Core vocabulary

### Pulse

A **pulse** is the fundamental unit of shared time. It is produced by the Reflector (the Krestianstvo server shim) at regular intervals and delivered to all peers. Every pulse carries:

- `logicalTime` — a monotonically increasing integer, identical for all peers
- `wallTime` — a real-time timestamp stamped *once* at the Reflector, never overwritten at delivery
- `isSubTick` — whether this pulse is a local micro-step rather than a shared macro step

Peers may receive the same pulse at slightly different real times due to network jitter, but the pulse *content* is identical. This is the foundation of determinism.

### Wave

A **wave** is the complete lifecycle of computation triggered by a single logical pulse. A wave begins when a pulse arrives at a world, propagates through the node graph as each node processes its ready queue entries and schedules futures, and ends when the world reaches *stability*. A wave has an identifier (`logicalTime`) and a completion status (`success`, `process`, `fail`).

Each peer runs its own wave independently. Because inputs are identical, waves on different peers converge to the same final state — they are the same wave, computed locally.

### Wavefront

The **wavefront** is the propagating boundary of settled computation within a wave. As each node processes its ready entries and emits futures, the frontier of "what has been computed" advances through the graph. The wavefront evaluator's job is to keep driving this frontier forward — via sub-tick iterations — until no node has any pending entry at or before the current `wallTime`. At that point the wave is stable.

The wavefront is *local*. It does not require coordination between peers. Each peer's wavefront advances independently, reaching stability at the same logical result because the inputs were identical.

### Phase

A **phase** is one stage within a wave. The current implementation has two named phases:

- **Macro phase** — triggered by the arrival of a new shared pulse. Every node receives the `__macro` message and responds to the new logical time.
- **Micro phase** (sub-tick) — one or more local iterations that settle inter-node dependencies and drain queued futures. The micro phase is invisible to the outside world; only the final settled state is observable.

A wave is `stable` when its micro phase has fully drained — all pending futures have `fireAt > wallTime`.

### Warp

**Warp** is the mechanism that handles the case where a new shared pulse arrives before the previous wave has reached stability. Rather than abandoning the in-progress wave and desyncing from peers that completed it, the evaluator *warps* local time forward — synthetically advancing `wallTime` through the remaining queue entries in a synchronous loop — until the previous wave reaches stability, then proceeds to the new pulse.

Warp preserves determinism because the synthetic `wallTime` values injected during the loop are derived from the node queue's own `fireAt` entries — the same values that the heartbeat would have delivered in real time, in the same order. Both peers warp through the same sequence and reach the same state.

### Drain

**Drain** is the process of exhausting all ready queue entries within a micro phase. There are two drain modes:

- **Sync drain** (`STEP_MS = 0`) — all micro-steps share the same `wallTime`. The evaluator loops synchronously until stable, completing the entire wave in one JS call stack.
- **Real-time drain** (`STEP_MS > 0`) — micro-steps are scheduled at future wall-clock times. The heartbeat ticker advances `wallTime` with each RAF frame, releasing one step at a time as real time passes. The wave is visible to the UI as it fills.

### Stability

A world is **stable** when three conditions all hold:

1. All node queues contain only entries with `fireAt > wallTime` (no ready work remaining)
2. No node is mid-feedback-loop (`_depth === 0` on all nodes)
3. The shared outbox is empty — no `ctx.send()` message is pending delivery

Conditions 1 and 2 are checked by `W.stable()` generically across all nodes. Condition 3 guards against a subtle timing issue: a `ctx.send()` written by one node during an evaluate pass lands in the outbox, not a queue — so the queue check alone would miss it. Without the outbox check, the drain loop exits while a message is in-flight, the receiving node never processes it, and the wave terminates prematurely. The application's own semantic completion condition (e.g. `stepsDone >= stepsTarget`) is defined by the user in `WORLD_PROGRAM` and combined with `W.stable()` in the `_isStable` expression.

### Reflector

The **Reflector** is the Krestianstvo-equivalent shim that stamps and broadcasts pulses. It is the sole source of `wallTime` — no world ever calls `Date.now()` internally. This ensures that "now" is the same for all peers regardless of their real-time clock drift.

In the current implementation the Reflector is simulated by `makeShim`, which stamps pulses once and delivers them with randomised jitter to simulate network latency.

---

## Architecture layers

```
┌─────────────────────────────────────────────────────┐
│  Reflector (shim)                                   │
│  Stamps pulse once. Delivers to all peers.          │
└────────────────────┬────────────────────────────────┘
                     │ pulse { logicalTime, wallTime }
┌────────────────────▼────────────────────────────────┐
│  Meta Program                                       │
│  Orchestrates worlds. Drives the wavefront.         │
│  Warp · Drain · Stability check · UI sync           │
└────────────────────┬────────────────────────────────┘
                     │ registerEvent / evaluate
┌────────────────────▼────────────────────────────────┐
│  World (ProgramState)                               │
│  Hosts the reactive node graph.                     │
│  Each node: W.reduce → local queue → futures        │
└────────────────────┬────────────────────────────────┘
                     │ W.export → isStable, logicalTime
┌────────────────────▼────────────────────────────────┐
│  Host layer                                         │
│  _worldNextAt · _worldSnapshot · _uiRefresh         │
│  Registered on meta.ps.app. No node-name coupling.  │
└─────────────────────────────────────────────────────┘
```

### Meta Program

`META_PROGRAM` is a Renkon program that runs *above* the world programs. It receives pulses from the Reflector via a queued receiver (`Events.receiver({queued: true})`), processes each pulse in order (backpressure-safe), and drives the wavefront for each registered world by calling `worldps.registerEvent` and `worldps.evaluate()` in a controlled loop.

META_PROGRAM never knows the names of nodes inside a world. All world-level introspection goes through generic host helpers (`_worldNextAt`, `_worldSnapshot`).

### W — the node runtime

`W` is the functional core of each node. Its `reduce` function takes `(state, pulse, nodeId, handlers)` and returns a new state. On each call it:

1. Clears the shared outbox if this is a new evaluation generation
2. Collects inbound `send()` messages for this node from the outbox
3. Splits the node's own queue into ready (fireAt ≤ wallTime) and later entries
4. Injects `__macro` at the front of the ready list on non-sub-tick pulses
5. Runs each ready entry through its handler, collecting `future` and `send` effects
6. Enqueues futures into the node's new queue; deposits sends into the outbox
7. Returns the new state with updated `_queue` and `_nextAt`

`_nextAt` — the timestamp of the next pending entry — is the signal that `_worldNextAt` reads to drive the drain loop. It is written on every `reduce` call without any node-name coupling.

Outbox entries are stamped with `_evalGen` (the evaluation generation at write time). When a node reads its inbound messages it only consumes entries from a **previous** evalGen — entries written in the current evaluate pass are left for the next pass. This ensures that a `ctx.send()` message written by node A is not destroyed before node B reads it, even when both nodes evaluate in the same `evaluate()` call.

### Host helpers

Three functions live in the host layer, registered on `meta.ps.app` and callable from inside the META_PROGRAM string as `Renkon.app.*`:

- **`_worldNextAt(world)`** — scans all node states for the minimum `_nextAt`, returns it or `null`. Used to advance `wallTime` correctly during drain and warp.
- **`_worldSnapshot(world, source, iter)`** — scans all W nodes (identified by having an array `_queue`) and captures their current scalar fields into a plain serialisable object. Used for telemetry and future network snapshot/restore.
- **`_uiRefresh()`** — called synchronously after warp and drain to push state to the DOM immediately, bypassing the RAF timer gate.

---

## Distributed determinism invariants

These invariants must hold for two peers to stay in sync across arbitrary network jitter:

1. **`wallTime` is injected, never read locally.** No world or node calls `Date.now()`. All time comes from the Reflector pulse or from the drain loop advancing `wallTime` via `_worldNextAt`.

2. **The canonical pulse is frozen and delivered unchanged.** The Reflector stamps `wallTime` once and freezes the pulse object. Peers receive the original — delivery delay does not alter content.

3. **Warp uses queue-derived `wallTime`.** During warp, `wallTime` is advanced to `_worldNextAt` on each iteration — the actual `fireAt` values already in the queue — not to `Date.now()`. This ensures both peers traverse the same synthetic time sequence.

4. **No closures in queue payloads.** All future payloads are plain scalars or plain objects. This makes state fully serialisable and comparable across peers.

5. **Stability is locally determined.** Each peer settles its own wavefront independently. Because inputs are identical, independent local settlement converges to the same result — no cross-peer coordination is needed during a wave.

6. **Queued pulse receiver.** The META_PROGRAM receiver uses `{queued: true}` — no pulse is silently dropped under jitter or load. Each pulse is processed in arrival order.

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

### Example: fixed-point bisection

The reference implementation uses two nodes — `estimator` and `corrector` — running a bisection toward the nearest integer.

**estimator** proposes an initial value each macro pulse and refines it on each correction received:

```javascript
__macro: (s, p, ctx) => {
  // sin with irrational multiplier produces values in [1,99] with
  // varying fractional parts — convergence depth differs each cycle.
  const initial = 50 + 49 * Math.sin(p.logicalTime * 2.3);
  ctx.send("corrector", "observe", { value: initial, cycleId: p.logicalTime });
  return { ...s, value: initial, iterations: 0, cycleId: p.logicalTime };
},
refine: (s, p, ctx) => {
  if (p.cycleId !== s.cycleId) return s;
  const delta = Math.abs(p.correction - s.value);
  const refined = (s.value + p.correction) / 2;
  if (delta > EPSILON) {
    ctx.send("corrector", "observe", { value: refined, cycleId: s.cycleId });
  }
  return { ...s, value: refined, iterations: s.iterations + 1 };
},
```

**corrector** computes the midpoint toward the nearest integer and delivers it back via `ctx.feedback()`:

```javascript
observe: (s, p, ctx) => {
  if (p.cycleId < s.cycleId) return s; // reject stale cycles
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

![](/doc/feedback_loop.gif)

### Starting formula and convergence depth
 
The initial value for each cycle uses a sine-based formula:
 
```
initial = 50 + 49 × sin(lt × 2.3)
```
 
This produces values spread across `[1, 99]` with varying fractional parts on every cycle — the irrational multiplier `2.3` ensures the sequence never repeats over any practical run. Some cycles land very close to an integer (fast convergence, 3–5 iterations), others land near the midpoint between two integers (slow convergence, 20+ iterations). The depth bar and canvas curve look different each cycle, making the wavefront depth visibly meaningful.
 
### Convergence trace (worked example)
 
The trace below shows one representative cycle. The actual values differ each LT because `initial = 50 + 49 × sin(lt × 2.3)` varies. Each iteration applies the bisection recurrence:
 
```
correction = (value + target) / 2
refined    = (value + correction) / 2
           = (3·value + target) / 4
```
 
Convergence ratio is 3/4 per step. For `lt = 72` the formula gives:
 
```
initial = 50 + 49 × sin(72 × 2.3) ≈ 88.517
target  = Math.round(88.517) = 89
delta_0 ≈ 0.483
```
 
```
n=0    value = 88.5170    delta = 0.4830
n=1    value = 88.6377    delta = 0.3623
n=2    value = 88.7283    delta = 0.2717
n=3    value = 88.7962    delta = 0.2038
n=4    value = 88.8472    delta = 0.1528
n=5    value = 88.8854    delta = 0.1146
n=6    value = 88.9141    delta = 0.0859
n=7    value = 88.9355    delta = 0.0645
n=8    value = 88.9517    delta = 0.0483
n=9    value = 88.9638    delta = 0.0362
n=10   value = 88.9728    delta = 0.0272
n=11   value = 88.9796    delta = 0.0204
n=12   value = 88.9847    delta = 0.0153
n=13   value = 88.9885    delta = 0.0115
n=14   value = 88.9914    delta = 0.0086  ← < EPSILON (0.01), terminates
```
 
The number of refinement iterations varies per cycle depending on `|initial - target|`. Each iteration crosses the node boundary twice (estimator → corrector → estimator), so `estimator.iterations` equals the wavefront depth at convergence. Both peers start from the identical deterministic `initial` value and apply the same formula — they converge to the same result in the same number of steps, confirming distributed determinism.
 
Number of iterations bounded by:
 
```
N ≈ log(|initial - target| / EPSILON) / log(4/3)
```
 
For the worked example above (`lt=72`, `delta_0 ≈ 0.483`, `EPSILON = 0.01`): `N ≈ log(48.3) / 0.288 ≈ 14`.
With `EPSILON = 0.1` and a near-integer starting value (`delta_0 ≈ 0.05`): `N ≈ 2`.
With `EPSILON = 0.001` and a midpoint starting value (`delta_0 ≈ 0.499`): `N ≈ 18`.
The depth bar in the UI fills to a different level each cycle, reflecting the actual `N` for that LT's starting value.

### Canvas coordinate space visualisation

The bisection canvas renders the convergence trajectory in `(iteration, value)` coordinate space:

- **X axis** — iteration number (wavefront depth), 0 to final convergence step
- **Y axis** — value, auto-scaled with padding around `[initial, target]`
- **Purple solid line** — peer A's value at each iteration, with dots per step
- **Teal dashed line** — peer B's value, each peer plotted against its own iteration count
- **Dashed horizontal** — the integer target for this LT
- **Ring dot** — the current live value with `δ=` annotation (remaining delta)
- **Faded historical traces** — last 5 completed cycles at low opacity

Each peer is tracked with its **own** iteration count as the X coordinate. When jitter causes a phase offset, both lines trace the same mathematical curve — peer B's dots appear at the same Y positions as peer A's but may be shifted slightly along X if it received the macro pulse later. The overlap of the curves confirms determinism: the bisection path is identical regardless of delivery timing. Any horizontal separation between the two curves is purely the network jitter, made visible as a phase difference.

The canvas updates in real time as the drain loop runs, with one new point added per heartbeat tick when `FB_STEP_MS > 0`. Historical traces show how different LTs produce different starting points and convergence depths — some cycles fill nearly the full X axis, others terminate after just 3–4 iterations.

### Wave depth diagram with feedback

```
Logical time  T
              │
           pulse
              │
              ├── depth 0   macro phase — __macro fires
              │             estimator proposes initial value
              │             ctx.send("corrector", "observe") → outbox
              │
              ├── depth 0   corrector receives "observe"
              │             ctx.feedback("respond", ...) → queue at wallTime
              │
              ├── depth 1   corrector fires "respond"
              │             ctx.send("estimator", "refine") → outbox
              │
              ├── depth 1   estimator receives "refine"
              │             delta > ε → ctx.send("corrector", "observe") → outbox
              │             iterations++
              │
              ├── depth 1   corrector receives "observe" again
              │             ctx.feedback("respond", ...) → queue at wallTime
              │
              ├── depth 2   corrector fires "respond"
              │             ctx.send("estimator", "refine") → outbox
              │
              ├── ...       loop continues, depth accumulates
              │
              └── depth N   delta < ε — estimator does not re-send
                            queues drain, outbox empties, _depth → 0
                            wave stable
```

---

## Two-layer time

```
Logical time  T ──────────────────────────────────────▶
              │         │         │
           pulse       pulse     pulse       (shared, discrete, reflector-stamped)
              │
              ├── sub 0  (macro phase — depth 0)
              ├── sub 1  (micro phase — drain, depth 0..N for feedback loops)
              ├── sub 2
              ├── ...
              └── sub N  (stable — wave complete, all depths 0, outbox empty)

              ↑ transient, local, not observable from outside
```

Macro time is shared and observable. Micro time is local and transient — to an external observer, only the final stable state after each pulse is visible. Feedback loops deepen the micro phase but remain invisible externally; only the converged result is exported. This is the same two-layer model described in the original Renkon/Krestianstvo design, made explicit and enforced by the wavefront evaluator.

---

## Experimentation Guide

The following parameters can be adjusted at the top of the program file to explore different behaviours. All changes take effect on the next page reload.

### Network delay (shim)

By default pulses are delivered synchronously with no delay — ideal network conditions. To simulate jitter, pass a latency range to `makeShim`:

```javascript
// Ideal network (default)
const shim = makeShim(PULSE_MS);

// Simulate jitter: 10–300ms random delivery delay per peer
const shim = makeShim(PULSE_MS, { min: 10, max: 300 });

// Same for the feedback shim
const fbShim = makeShim(FB_PULSE_MS, { min: 10, max: 100 });
```

With jitter enabled you will see the warp mechanism fire (console: `[WARP] worldX LT N → N+1`), the bisection canvas show two slightly offset curves (same convergence path, different phase), and occasional `PROCESS` status on counter rows during the jitter window.

### Macro pulse interval

`PULSE_MS` is simply a `setInterval` delay — there is no architectural minimum. It can be set to 50ms, 16ms, or even 1ms. The only practical constraint is:

```
PULSE_MS > SUB_STEPS × STEP_MS
```

Otherwise the next pulse arrives before the current cycle finishes draining and warp fires every cycle. The default values (`PULSE_MS=5000`, `SUB_STEPS=50`, `STEP_MS=100`) sit at exactly the limit: `50 × 100 = 5000ms`. To cycle faster, reduce `STEP_MS` or `SUB_STEPS`:

```javascript
// Fast animated cycling — 500ms per macro pulse
const PULSE_MS  = 500;
const SUB_STEPS = 10;
const STEP_MS   = 40;   // 10 × 40 = 400ms < 500ms ✓

// Instant drain, very fast cycling
const PULSE_MS  = 50;
const STEP_MS   = 0;    // sync drain
```

The same constraint applies to the feedback shim:

```
FB_PULSE_MS > estimated_convergence_steps × FB_STEP_MS
```

If `FB_PULSE_MS` is too small, warp fires on every cycle and the animation collapses to instant.

### Sub-step animation (STEP_MS)

```javascript
const STEP_MS = 0;    // instant sync drain — bar fills in one frame
const STEP_MS = 100;  // animated — one step per 100ms (default)
const STEP_MS = 50;   // faster animation
```

With `STEP_MS > 0` the counter heartbeat runs via `requestAnimationFrame` (~16ms ticks). Effective step granularity is `max(STEP_MS, ~16ms)`. To use a fixed interval instead of RAF — useful when `STEP_MS < 16ms` or for deterministic testing:

```javascript
// Replace inside the heartbeat:
requestAnimationFrame(tick)
// with:
setTimeout(tick, STEP_MS)
```

### Feedback loop animation (FB_STEP_MS)

```javascript
const FB_STEP_MS = 0;    // instant sync — canvas fills in one frame
const FB_STEP_MS = 150;  // animated — one iteration per 150ms (default)
const FB_STEP_MS = 50;   // faster, more iterations visible simultaneously
```

### Convergence depth (EPSILON / formula)

```javascript
const EPSILON = 0.1;    // terminates quickly (~3–5 steps)
const EPSILON = 0.01;   // default (~3–25 steps depending on initial value)
const EPSILON = 0.001;  // more iterations (~18–20 steps)
```

The starting formula controls how much depth varies between cycles:

```javascript
// Default: varying depth, 3–25 steps per cycle
50 + 49 * Math.sin(lt * 2.3)

// Legacy: always exactly 13 steps (X.5 starting values)
(lt * 7 % 100) + 0.5

// WARNING: never use Math.random() — non-deterministic, peers desync
```

---

## Running in Renkon Pad

[Renkon Pad](https://yoshikiohshima.github.io/renkon/) is the interactive browser-based environment for Renkon programs. The evaluator runs directly in Renkon Pad with no build step.

### Steps

1. **Open Renkon Pad** — instructions on running in browser [renkon-pad](https://github.com/yoshikiohshima/renkon-pad) (Chrome recommended).

2. **Create a new code window** — click the `Code`

3. **Paste the contents of file** — copy the entire contents of `wavefront-evaluator.js` and paste it into the code window.

4. **Create a new runner window** — press the **Run** button (▶). The evaluator bootstraps, the shim fires its first pulse immediately, and the DOM panels appear below the cell within ~100ms.

5. **Observe** — four panels render:
   - **VM INTEGRITY PHYSICAL TRACE** — counter sub-steps for both peers, warp badges on completed rows
   - **FEEDBACK LOOP CONVERGENCE TRACE** — depth bar, peer values, convergence status
   - **BISECTION COORDINATE SPACE** — canvas animation of the bisection curve
   - **2D Wavefront (10×10 grid, 100 nodes)** - the wavefront spreads outward with divs

6. **Experiment** — edit any constant at the top of the cell (`PULSE_MS`, `STEP_MS`, `FB_STEP_MS`, `EPSILON`, shim latency) and press Run again. Each run starts a fresh instance.

7. **Enable jitter** — change line `const shim = makeShim(PULSE_MS);` to `const shim = makeShim(PULSE_MS, { min: 10, max: 300 });` and re-run. The warp mechanism and bisection phase offset become visible.


## Contributing

All code is published under the MIT license