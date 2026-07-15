# The New Eye — the Hypervisor Architecture

*The architectural concept behind the one-world eye implementation in medium.js (⎙virt and its verb
family), as designed and built 2026-07-02/03. Every mechanism below is live, replicated, and was
validated against its own controls; the measured constants are quoted where they exist.*

---

## 1. The problem the new eye solves

The classic medium.js architecture has **two lens contexts**: the medium scope (the world lens on
the source) and the eye scope (a second, full perception stack — hologram → recon → recall/self —
running on the world's output). The eye owned its own machinery: template banks, matched filters,
recon solitons, plate/recall plumbing. It worked, but it duplicated the world instead of *being in*
it: the eye's memory was scratch state, not physics.

The new eye starts from a measured fact about this medium — **the two matter species are the
world/eye dial**:

| | world | eye |
|---|---|---|
| species | mobile / short-τ (pass-through) | bound / long-τ (trap) |
| role | the light path — wavefronts pass | the trap — wavefronts condense and persist |
| GR reading | radiation sector | matter sector |

A trap that holds a field for a long τ **is** a memory. So the eye does not need its own machinery:
it needs *verbs* on the one persistent soliton. The eye is a **hypervisor**.

## 2. The dictionary

Every hypervisor operation maps onto a proven medium primitive — nothing is introduced that the
medium did not already do:

| hypervisor concept | medium primitive | measured basis |
|---|---|---|
| **record** (snapshot a VM) | condensation: propagate W forward T steps → the hologram plate | linear round-trip ≈ 1.0 (T=16) |
| **lift** (boot a VM) | the reversed clock: propagate the plate −T steps (phase conjugation) | direct-back reconstruction, 100 % energy |
| **run** (a VM executes) | the same substrate + sustain stack (step, SPM, energy cap) | identical physics to W by construction |
| **compare** | bind: ψ_V ⊗ ψ_W = the lock (globally-normalized correlation) | the only self-fooling-proof observable |
| **VM slots** | §7.44 clock phases (time-division of the one step stream) | temporal-mux exactness 1.000 vs spatial 0.41 |
| **memory bank** | plates = long-τ matter; content-addressing = lock-sweep | Hopfield-IFS recall; recall = content-addressable clock |

The H-computing reading: **phases are the registers, bind is the ALU, the clock is the sequencer.**

## 3. The one-world structure

```
                    the ONE substrate (GPU eye buffer, one step stream)
                    ┌──────────────────────────────────────────────┐
   operator layer   │  W: the driven world soliton                 │
   (geometry,       │     att ← shift/orbit queues, ⟲coevo leash   │
    global clock) ──┤                                              │
                    │  V: the virtual phase (the dream)            │
                    │     free | mirrored | held                   │
                    └──────────────────────────────────────────────┘
                         ▲ record (+T)        │ lift (−T)
                         │                    ▼
                    _virtHolo (the plate) · _virtBank (≤4 plates + their atts)
```

- **W** — the world: the persistent soliton chased/leashed by the replicated operator.
- **V** — the virtual phase: a second live field lifted from a plate, running the *same* sustain.
- **The plate(s)** — holograms of recorded moments: immortal, snapshot-carried world state.

## 4. The verbs

All verbs ride one replicated event (`mediumVirt`), are stamped with the shared step
(`startStep = f(reflector time)`), and execute inside the drive loop at that exact step on every
peer — the standard KWE idiom (*ARM replicated, TRANSITION derived*; zero reflector traffic for
the physics itself).

| verb | effect |
|---|---|
| **⎙virt** (record) | hologram-record W (+T) → the plate; lift (−T) → V. Stashes the current att as V's operator. |
| **relift** | re-boot V from the immortal plate — repeatable time-travel to the recorded moment. |
| **swap** | V ↔ W with their energy budgets, at the stamped step. The dream becomes the world; the drive continues on it. |
| **mirror** | V receives the *same* operator drive as W. With W parked this is the Lyapunov configuration. |
| **hold** | V is driven toward *its own recorded att* — a world parked at the remembered moment (the live-memory view). |
| **mux** | §7.44 clock-phase time-sharing: W and V slice the one step stream (21-step slices), half proper rate each. |
| **store** | bank a plate of the current moment — **(ψ-plate, operator)**, both layers. |
| **recall** | record the current W as a *cue* plate, bind cue⊗bank, lift the argmax plate into V — the cue selects *which* moment resumes. |

### V's three drive modes (and why each is honest)

A measured law forces this structure: **a field with no operator cannot stay alive** — the drive's
superpose is the sustain; an operator-less field dies into halo within ~τ. So:

- **counterfactual** (free): V decays — honestly. Its truth is the decay itself; V⊗ reads the
  footprint of your interventions on W.
- **mirrored**: V lives under W's drive. V⊗ becomes the Lyapunov readout. Measured: **λ ≈ 0**
  (V⊗ flat at ~0.93 over 46 bars, |slope| < 10⁻³/bar) — the medium is *dissipative toward its
  command and conservative in everything else*: τ forgets perturbations relative to the drive;
  nothing forgets a difference.
- **held**: V lives under its *own recorded* operator — physically identical to a parked world.
  V⊗ = how far the world has departed from the remembered moment, and it *recovers* when W returns
  (the remembered moment is an attractor, not a snapshot). Priority: mirror > hold > free.

### Dual-layer memory

In a dual-layer world a moment is **(ψ, operator)** — the plate alone is half a memory. Bank
entries store both; recall restores both, so a recalled V is immediately alive under hold. This is
the coevolve loop closed *discretely*: the field (cue) selects the geometry (which att to run) —
matter tells geometry which geometry to be. W closes the same loop continuously (the ⟲coevo
leash); the eye closes it content-addressably (recall).

## 5. Time: parallel frames vs the clock-phase mux

Two execution models for V, both deterministic:

- **Parallel frame time** (mux off): V steps `todo` per frame on the same substrate,
  buffer-swapped around W's drive. Cost: 2× GPU work. V's step index equals the shared global
  index, so every per-step decision is batch-invariant.
- **⧉ Clock-phase mux** (mux on): `phase(k) = ⌊k/21⌋ mod 2` — a pure function of the shared step
  index. Even slices step W, odd slices step V; the off-phase field is frozen *exactly* in its
  buffer (storage is honest). Each world runs at **half proper rate** — the honest hypervisor
  semantics: *a VM costs the host time, not a second medium.*

Mux time-bookkeeping (the design decision): **global-time stamps + per-phase translation.** Every
queued event (kernel, shift, sig, verbs, pongs) keeps its global stamp and drains at the first
W-owned step ≥ the stamp. The operator/att stays on the **global** clock — geometry keeps world
time; mux slices only matter's proper time (in objorbit the command marches through V's slices and
W meets it where it is). The 21-step slice is 3 quanta, so W slices end exactly on the boundaries
where the reactor and coevo leash already test.

### The three clocks (kW re-clocking)

Mux forces a distinction the single-world medium never needed — **coordinate time vs proper time**:

| clock | what it counts | what runs on it |
|---|---|---|
| **k** (global) | every step of the shared schedule | event stamps (`startStep = f(reflector time)`), the mux slicing, θ/att schedules, queue drains |
| **kW** | steps W's matter actually executed | the channel protocol: sig slot gating, ear floors/warmup/refractory/cooldown, pong scheduling |
| **kV** | steps V's matter actually executed | the dream's own reactor and pongs |

The rule that forces it: every protocol constant (slot 480, cooldown 400, warmup 420, pong +57…)
is a **measured property of the medium's memory** — τ, echo time, propagation — and memory lives
in *matter* steps. Under mux, global time runs 2× matter time; a slot sized in global steps
contains only half the physical event, so the guard law ("slot ≥ the full event") silently breaks
— wrong-slot leaks and echo cascades return. Re-clocking the channel to kW restores the law in the
frame where it was measured. Stamps stay global (the coordinate system peers agree on); the
translation happens at the drain — *global-time stamps, per-phase translation*, now for clocks as
well as events. The GR reading is exact: processes run on proper time; only bookkeeping runs on
coordinate time.

### The leak channel and the dream's ears

Perfect phase isolation is the mux default (freezing is exact). The **leak** makes it imperfect on
purpose: `ψ_V += κ·ψ_W` (W frozen at the slice boundary — step-aligned, peer-identical) at shared
7-step boundaries, V's cap re-normalizing. It is mux-only *physics*: inter-slice coupling has no
home in parallel-frame time, and a frame-keyed coupling would fork peers. One-way W→V: the dream
hears the world faintly; the world cannot hear the dream. Verified live: a ⚡sig fired in W appears
in ψ_V attenuated by κ (control: κ=0 → ψ_V stays clean).

**Ears in the dream** close the loop inside V: the same CFAR edge reactor (8 posts, continuous
floors, edge = step-change) runs on ψ_V at shared V-boundaries, clocked in kV, posts ringing V's
*own* operator. A hit dream-pongs **inside** V — the reply propagates in the dream only. World
speaks → dream hears → dream answers itself: a complete perception-reaction arc in a virtual
phase, every stage derived state (zero reflector traffic).

## 6. The phase selector (scope toggle → phase selector)

The eye scope's input is no longer pinned to the world: a replicated selector (`eye⟵W / eye⟵V`,
`n.eyeSrc`) chooses **which phase the eye traps**. With `eye⟵V` the *entire* eye machinery —
hologram ◀, recon ▸, recall, self — runs on the dream. Perception is virtualized, not just
storage. Falls back to W when no V exists (and the label says so).

This is the first half of collapsing the old eye scope: the eye is now an instrument that can be
pointed at any phase of the one soliton, rather than a parallel world of its own.

## 7. Determinism (the covariance contract)

The hypervisor adds *no* new reflector traffic beyond the verb events. Everything else is derived:

- verbs execute at stamped shared steps inside the drive loop (identical on every peer);
- V's evolution is a pure function of the shared step index in both time modes (all per-step
  decisions — superpose, cap, boundary sponge — key on the global index, never frame boundaries);
- V, the plate, the bank (plates **and** atts), and all mode flags ship in the join snapshot
  (nested `{__f64}`, the recursive reviver);
- a shared re-anchor (obj/drive change) invalidates V (stale record) but the **bank survives** —
  memory is long-τ matter; recalling across world changes is the feature;
- V must hold byte identity for the same reason W does: `swap` can make it the world.

The physically-motivated invariant: **anything that multiplies ψ is physics and must land at a
shared step** (the boundary-sponge lesson: a per-frame sponge forks peers even when both have it
on).

## 8. What this replaces, and what remains

Already collapsed onto the primitives:

- **record/reconstruct** → record/lift (the trap's plate machinery is now two verbs);
- **recall** → lock-sweep over the plate bank (bind in plate space: the record op is near-unitary,
  so plate-space correlation ≈ field-space correlation — the deviation *is* the op's
  non-unitarity, itself measurable);
- **the eye's viewpoint** → the phase selector.

Remaining milestones:

- **M3 (rest) — DONE 2026-07-04**: `_lockSweep(cue, bank, corrFn)` is now the one recall of the
  whole medium — the hypervisor's plate recall (`_ampCorr` over `_virtBank` → *which moment*), the
  eye's genome recognition (`_corrLensed` over `_resoTemplates` → *which geometry*), and the
  resonance read are all the same three lines. The recall plumbing is {condensation, lock-sweep,
  round-trip}, literally.
- **M4 — DONE 2026-07-04**: N-phase mux. `virtBoot(slot)` lifts a bank plate into a live phase
  (≤2 extras; W + V + P1 + P2 = at most a 4-way clock, `phase(k) = ⌊k/21⌋ mod N`). Each booted
  phase is **held at its own recorded operator** (dual-layer memory booting whole) and runs at
  1/N proper rate — the honest budget. `virtKill()` releases the newest (its plate stays in the
  bank — re-bootable). The selector cycles `eye⟵W→V→P1→P2`: every phase is addressable — data
  *and* a running world at once, the operator/operand duality on the clock. Extras run only under
  ⧉mux (they *are* clock slices; without the clock they are frozen exactly — storage). V keeps the
  full feature set (mirror/hold/leak/ears); extras are minimal worlds (sustain + held att +
  sponge). Booted phases ship in the join snapshot and clear on re-anchor.
- **Independent command — DONE 2026-07-04**: `virtGo(dx, dy)` commands the **eye-selected phase**
  (V, or a booted P1/P2 — you steer the percept you are looking at) to a moving target; the phase
  coevolve-transports there, chasing a torus-translated copy of its recorded att (`_rollField` = an
  exact deterministic wavefront translation — the field-space analog of `makeProbeField` at a moving
  center, which the raw plate cannot regenerate parametrically), **lock-leashed**: it advances
  ≤1px/boundary × the ⟲coevo sigmoid on its *own* lock vs a slow-learning baseline (always-learning
  is transport-correct — the orbit lesson). The leash is one generalized primitive (`_leashAdvance`)
  over any "carrier" (V's module globals via an accessor view, or a phase's own fields), so the chase
  algebra composes onto **every** commandable phase, not just V — the operator algebra completed on
  the M4 register file. A virtual phase can now **evolve differently from W**. `virtGo(0,0)` at home
  releases the command (clean hand-back to hold/free). Priority mirror > independent > hold > free;
  leash state ships in the snapshot per phase.

## 9. The honest boundaries

- The lift is near-exact, not exact (linear round-trip ≈ 1.0; the ~7 % residual after a lift is
  real and, by the mirror measurement, conserved — λ ≈ 0).
- Freezing a phase (mux) is exact by construction (buffer storage), but the frozen phase's
  *protocol clocks* stretch: W-proper timings double in global steps while mux is on.
- Plate-space recall inherits the record op's non-unitarity; a control that can differ (cue near A
  vs near B flipping the argmax) is the required evidence for any recall claim.
- The hypervisor does not exempt V from the world's laws: no operator, no persistence; the halo
  law applies to differences (nothing forgets a difference); the boundary condition applies to V
  because there is only one substrate.

## 10. The two-execution-model boundary (verbs vs the `composeLens` stack)

The most important architectural fact about the new eye — and the one to keep honest — is that the
medium now has **two ways to transform ψ**, and the hypervisor lives in the second one:

| | the **[H] stack** model (`soliton-algebra.js`) | the **hypervisor** model (`medium.js`) |
|---|---|---|
| unit | a `LensOp`: `(field, gpu, ctx) → field'` | a **verb**: an imperative GPU sequence |
| composition | `composeLens(...ops)` = left-to-right `reduce` (ψ→op1→op2→…) | a `switch` in the drive loop, drained at a stamped shared step |
| granularity | **once per frame** (`_runScope` runs the built stack once) | **once per step** (`k >= startStep` inside the `for (todo)` loop) |
| record / read | `opHologram` (forward T) · `opRecon` (backward T) | `_gpu.stepEyeN(+T)` · `_gpu.stepEyeN(−T)` — the *same math*, called raw |
| bind / select | `opRecall` → `gpu.bindEyeField` (writes `ctx.selectedRank`) | `_ampCorr` (CPU correlation) → argmax → `_psiVirt` |
| the classic eye | `makeTrapStack = composeLens(opHologram, [opOcclude], opRecon, makePerception)` | — |
| the new eye | — | the `⎙virt` verb family |

**The new eye deliberately bypasses the `composeLens` stack.** record/lift is not `opHologram`/
`opRecon`; it is the *identical* forward/backward round-trip called imperatively in the drive loop.
It preserves the **physics** of the trap-as-composition (the round-trip that
[[feedback_direct_back_reconstruction]] validated) but not the **stack feature** — the verbs cannot
be reordered, inserted, or composed the way `composeLens` stages can.

### Why the split exists (it is not an accident)

The split is forced by the **determinism contract**, not by taste. A `LensOp` runs once per frame,
but `_frame` fires a *non-deterministic* number of times per logical tick (macro + every subtick
drain — the medium rides the IFS fractional subtick clock). Anything that multiplies ψ at frame
granularity therefore lands at a **peer-local step** → byte fork (this is the general bug class the
kernel/shift queues fixed). The hypervisor verbs *must* land at a **stamped shared step inside the
drive loop** to stay byte-identical (§7, the covariance contract). So the verbs went imperative-in-
loop precisely *because* the once-per-frame stack model cannot carry a shared-step stamp. The stack
stayed frame-granular because perception (`makePerception`) is a pure read of the already-settled
field — it has no mid-run ψ-multiply to mis-time.

**Rule of thumb (the honest boundary):** *a transform whose effect must land at a specific shared
step is a verb (in-loop); a transform that reads the settled field once per frame is a `LensOp` (in
the stack).* record/lift/swap/recall are the former (they mutate the live ψ mid-run); hologram→
recon→perceive is the latter (it reads).

### What the eye is, and is not, as an operator

- **Can a stack be pointed at the eye's output?** *Yes, today.* The phase selector (§6, `n.eyeSrc`)
  feeds `_psiVirt` as the trap input — the entire `composeLens` eye stack runs *on* V. This is
  "point the instrument at the dream."
- **Can the eye/V be a stage *inside* a stack?** *Not today.* V is a stored `Float64Array` in a
  closure, not a `LensOp`; `composeLens` cannot take it. This is the dual of the above and is
  currently missing.
- **Does the eye itself behave as an operator?** *In effect, yes; in type, not yet.* Every verb
  already has a `LensOp` *shape*: `record` is an identity-on-ψ with a ctx write (exactly like
  `opAutofocus`, which "only CHOOSES the plane — identity on ψ"); `lift`/`swap` are `field ↦
  field'`; `bind`/`recall` write a selection into ctx (like `opRecall`). What blocks the type is
  **timing**: a verb wrapped as a plain `LensOp` in a stack would fire at frame granularity and fork
  peers. The honest bridge is an **enqueue-at-stamped-step adapter**: the op *stamps and enqueues*;
  the drive loop *drains*. Same pattern already in place for every queue.

### The unification path (aligns with M3)

M3 already plans to "collapse the eye scope's recall onto the same lock-sweep primitive." The
generalization is to make the two models *one*: either

- **(a) verbs → library ops**: replace the raw `stepEyeN(±T)` / `_ampCorr` with `opHologram`/
  `opRecon`/`opRecall`, so record/lift/recall literally *are* stack operators (deferred to a shared
  step via the enqueue adapter); or
- **(b) V → `LensOp`**: wrap the virtual phase as a composable stage so a stack can contain the eye,
  not only be pointed at it.

Both are honest and both are small (the physics is already identical — it is a plumbing
unification), but both **touch the determinism contract**: the adapter that lets an in-stack op
defer its ψ-multiply to a stamped shared step is load-bearing and must be built first. Until then
the boundary stands: **the stack perceives; the verbs act; the two meet only at the phase selector.**

## 11. Design note (not yet built): deterministic-by-default compose via `ctx.stamp`

*This section sketches a generalization — making the `composeLens` path deterministic by construction
— without touching code yet. It is a design contract, not an implemented feature. The physics is
already identical to what runs today; this is a plumbing unification behind three design gates.*

### The core idea

The stack is **already** peer-deterministic — but by the *weaker* guarantee that every op keys its
state on the synced `ctx.bar` / `phaseT` and runs as a **pure read** off a saved buffer
(`_runScope` saves ψ, runs the stack, restores ψ). It is deterministic *because it is a read, not an
act*. The moment a `LensOp` mutates the **live** ψ that the drive loop is also stepping (exactly what
M3's record/lift/recall-as-stack-ops want), `bar`-granularity is too coarse — `bar` is a macro-tick,
but a live-ψ write must land at a **soliton step** (the `startStep` resolution).

The generalization: **enrich `ctx` with the shared step, and split the `LensOp` type by *what it
touches*.** Not "run the stack in the loop" — that erases the honest read/act distinction. Instead,
*name* the distinction and make the write-path the only door to a live-ψ mutation.

### The two op kinds (typed by effect, not by name)

```
  ReadOp  : (field, gpu, ctx) → field'          // pure read: runs on the saved buffer,
            keyed on synced ctx.bar / phaseT.    // deterministic already. Stamp is a no-op.
            e.g. opHologram→opRecon→makePerception, opAutofocus

  ActOp   : (field, gpu, ctx) → field            // identity on ψ; RETURNS by ENQUEUEING a
            (side effect: ctx.enqueue(effect))   // stamped effect. Never mutates live ψ directly.
            e.g. record, lift, swap, recall, and any future ψ-multiplying stage
```

An `ActOp` does **not** fire when the stack runs. It calls `ctx.enqueue({ startStep, kind, apply })`
and returns the field unchanged. The **drive loop is the single writer**: it drains the effect at
`k >= startStep`, exactly as the kernel/shift/sig/virt queues already do.

### The `ctx.stamp` contract

`_runScope` supplies the stamp so the stack never has to know the soliton clock itself:

```
  ctx.stamp    : (time?) → startStep             // = floor(((time ?? n.time)·_MON_RATE − _solClock0)·19)
                                                 // resolved by _runScope from the live soliton clock0
  ctx.enqueue  : (effect) → void                 // pushes onto the frame's pending act-queue
  effect       : { startStep, kind, apply(gpu, ctx) }   // apply = the deferred GPU mutation
```

The load-bearing invariant (this is what makes it *default*):

> **A `LensOp` may read the field freely. A `LensOp` that writes the live ψ MUST return an enqueued
> effect stamped with `ctx.stamp`, never a direct GPU mutation.** The only path to a live-ψ write is
> the stamped queue; the drive loop is the sole mutator, draining all effects in shared-step order.

Because the *only door* to a live-ψ write is the stamped queue, you **cannot accidentally write the
peer-forking version** — the frame-granular direct-mutation path simply isn't available to an op.
Stamping stops being a discipline you remember and becomes structural.

### The drain-order contract (the one genuinely new decision)

Today the five queues drain in a hand-fixed sequence inside the loop. Generalizing makes that order a
**declared contract** — two effects at the *same* `startStep` must apply in the same order on every
peer, or same-step ties fork. Proposed canonical priority (geometry before matter, reads never
mutate):

| order | queue / effect | why it goes here |
|---|---|---|
| 1 | **kernel** (`setRings`) | the medium's geometry — everything downstream reads the current lens |
| 2 | **att / shift** (operator position) | where the attractor is, before it superposes |
| 3 | **sig** (injected wavefronts) | external energy enters before the step integrates it |
| 4 | **virt verbs** (record/lift/swap/recall/store) | matter-layer state transitions on the settled pre-step field |
| 5 | **stack ActOps** (M3 record/lift/recall as ops) | same class as (4); share its slot, appended after |
| — | **step** (`stepEyeN`+SPM+cap) | the integrator — the single ψ advance, once per step |
| — | **ReadOps** (perception) | run once per frame off the saved buffer — never in this table |

The rule of thumb behind the table: **geometry → operator → injected energy → matter-state → integrate.**
ReadOps are absent by construction (they don't mutate live ψ). Ties within a queue break on the
queue's own monotonic id (`ver` / `seq`) — never on array index (the truncation-starvation lesson).

### The three design gates (must be settled before code)

1. **`clock0` scoping.** `ctx.stamp` must resolve the *same* `_solClock0` the drive uses. `_runScope`
   has it in scope, so the stack stays clock-agnostic (it calls `ctx.stamp`, never touches `clock0`).
   The coupling is real but contained to one injection point.
2. **Drain-order contract** (the table above) must be *declared*, not incidental — the single new
   invariant this introduces.
3. **Read/act classification** must be explicit per op (a flag or two constructors), so the framework
   can assert "an ActOp returned without enqueuing" / "a ReadOp mutated live ψ" — turning the boundary
   into a checkable property instead of a convention.
4. **Stamp-source rule (the fork hiding in "stamp now").** The stack runs once per *frame*, and
   frames sample logical time at peer-local moments — an ActOp that stamps with the frame's sampled
   "now" enqueues the same effect with *different* stamps on different peers → fork. The existing
   queues are safe precisely because they stamp with `e.time`, a **reflector-assigned** time
   identical on every peer. Contract: `ctx.stamp(time)` accepts **synced keys only** — reflector
   event times or bar-start logical times, never the frame's `n.time` sampled mid-bar. Equivalently:
   an ActOp may fire only *on a synced-key change*, not on every stack run.

### What this yields

- **ReadOps (perception) unchanged** — already deterministic, frame-granular, off the saved buffer.
- **ActOps (the M3 targets) fork-proof by construction** — the only write path is the stamped drain.
- **The five existing queues become instances of one write-primitive** — kernel/shift/att/sig/virt
  stop being five special cases and become the general "stamped live-ψ effect" with a declared order.
- **The §10 boundary is preserved, not erased** — it becomes a *typed* property of `ctx` (read vs
  act) rather than two parallel code models. The stack can then legitimately contain act-stages
  (record/lift/recall) *and* be pointed at any phase — unifying both directions the boundary noted
  were missing.

The prerequisite remains the **enqueue-at-stamped-step adapter** (§10): `ctx.enqueue` + `ctx.stamp`
wired through `_runScope`, plus the declared drain order. The physics is identical; this is the
covariance contract, generalized from "verbs" to "any live-ψ write, wherever it originates."

## 12. The functional reading — the eye as an algebra of operators on ψ

Underneath the hardware framing (§2, hypervisor/VMs/registers) is a functional one, and it is the
one that connects the new eye back to the `LensOp`/`composeLens`/[H] machinery it grew out of.

### `linOp` is the free operator; the verbs are its named specializations

`linOp` is the medium's *one universal operator* — `content·e^{i(k·x+ω·t)}` — a function `ψ ↦ ψ'`
parameterized by centers, `k`, `β`, winding. Everything the medium does is a specialization of it:
a phase-well is `linOp` with curvature; a momentum kick is `linOp` with a `k`-tilt; the IFS lens is
`linOp` with the genome's affine centers. The hypervisor verbs are **the same idea one level up** —
each is a function `ψ ↦ ψ'` (lift, swap, the moving-att superpose) or `ψ ↦ selection` (bind,
recall). record is `linOp`'s propagation run forward; lift is it run backward. So the eye did not
introduce a new kind of thing; it named a **basis of high-level operators** in the same operator
algebra `linOp` already spans. The recall unification (§8, `_lockSweep`) is the sharp evidence: one
function serves the plate recall *and* the genome-lens recognition because both are the same
operation — `bind`, the algebra's inner product — applied to different operands.

### [H] — bind as the product of the algebra

[H] (the holographic/bind primitive, `gpu.bindEyeField`, `ψ_A·ψ_B`) is the algebra's **multiply**.
It is what makes the operators *compose by content* rather than by wiring: recall is `bind(cue,
bank)` + argmax; correlation, extraction, the lock, the Lyapunov V⊗ — all are `bind`. In the
hardware reading `bind` is the ALU; in the functional reading it is the ring product that turns a
set of fields into an algebra (add = superpose, multiply = bind, the clock = the sequencer that
orders applications). The medium already told us this multiply is *exact only in time* (the
operatorSolitonCyc result: temporal-mux bind 1.000 vs spatial 0.41) — which is exactly why the mux
(§5) is the honest substrate for composing operators: **composition wants the clock, not space.**

### Operator ⇄ operand — the meta-circular property, made first-class by M4

The functional prize is that a phase is **both an operator and an operand**. As an operand it is a
`Float64Array` a `bind` can consume, a plate the selector can address (M4: `eye⟵P1`). As an
operator it is a *running world* that applies its own dynamics to whatever it holds. M4 makes this
literal: `virtBoot` takes a plate (operand) and instantiates it as a live phase (operator) on the
clock; `bind(P_i, P_j)` then treats two running worlds as data again. This is the
Smalltalk/lambda-calculus sense of **first-class**: the eye's objects can be passed to, returned
from, and applied by the medium's own operations. The recursive lens
([[finding_geometry_lens]]) was this in one direction (a lens is a clock); the phase register file
is it in both.

### Why the eye is not *yet* fully functional (and what closes it)

The honest gap (§10): a verb is not yet a `LensOp` you can drop into a `composeLens` stack, because
a stack stage runs at frame granularity and a live-ψ write must land at a stamped shared step. So
today the algebra is **applicative but not compositional** — you can apply the operators (call the
verbs) and point a stack at their output (the phase selector), but you cannot yet write
`composeLens(record, evolve, bind, lift)` as one expression. The `ctx.stamp`/`ActOp` design (§11)
is precisely the missing piece: it lets an operator defer its ψ-multiply to the stamped drain, so
composition becomes legal *without* losing determinism. When that lands, "the stack perceives, the
verbs act" collapses into one typed algebra where **every transform — `linOp`, a genome lens, a
hypervisor verb — is a first-class operator, composable by `bind`, sequenced by the clock, and
deterministic because the single write door is the stamped queue.** M3 unified the read side; M4
made the operands first-class; §11 will make the operators first-class. That is the whole functional
program, and two of its three legs are built.

## 13. The perception reading — the eye as a perceiver, V as an internally-generated percept

The eye is, mechanically, a **perceiver**: it does not store a scene, it *constructs a percept* from
an incoming wavefront by the trap round-trip — hologram (delocalize) → recon (re-localize) →
`makePerception` (the genome lens that interprets). What the new eye adds is a **phase selector** on
the *input* to that pipeline: the eye can perceive the world (`eye⟵W`) or a scene the medium is
generating **internally** (`eye⟵V`, `⟵P1`, `⟵P2`). The verbs on V are then not memory operations
but modes of **perception of an internally-generated scene** — and this reading, not the storage one,
is what the machinery actually implements.

- **`eye⟵V` is perceiving the internally-generated scene** rather than the sensory one. The trap
  runs its full pipeline on ψ_V; the recon ▸ is the eye's *percept of the dream*. The selector is
  the switch between exogenous (world-driven) and endogenous (internally-driven) perception, on one
  perceiver.
- **hold = a held percept.** The internal scene is kept stable — the perceptual machinery
  reconstructing a fixed image, the "mind's-eye" holding an object still.
- **independent (`virtGo`) = active / endogenous control of the percept.** The percept is *moved
  under internal command* — visual imagery rotated, covert attention swept across an imagined scene.
  Crucially, the leash is a **perceptual-coherence limit, not a memory rate**: V advances only while
  its own lock stays high, i.e. only as fast as the percept *holds together* under being driven —
  exactly the eye's recon degrading if you demand motion faster than the trap can re-form. `ℓ` in
  the label reads "how well the percept coheres as it is steered," not "how well remembered."
- **mirror = stimulus-driven perception.** The internal scene is slaved to the world's drive — the
  percept tracking the exogenous input, the baseline against which endogenous control is measured
  (the Lyapunov twin is, in perception terms, "imagery perfectly locked to the stimulus").
- **leak + dream-ears = endogenous perception that is not sealed from the world.** A small, one-way
  κ lets waking input faintly enter the internally-generated scene, and the dream's ears make that
  scene *reactive* to what enters — a percept→action loop running on the internal image. This is the
  honest model of imagery that is influenced by, but not identical to, live perception.
- **The two matter species are the two roles in perception.** Mobile / short-τ = the **light path** —
  the transient wavefront that carries the scene *to* the eye and passes through (radiation, W's
  input). Bound / long-τ = the **trap** — the persistent field that *catches and holds* a percept
  long enough to be interpreted. Perceiving is the mobility→persistence transition (the γ dial) run
  toward binding: the eye is precisely the long-τ end of that dial, which is why "the eye is a trap"
  and "perception is condensation of the incoming light into a held, interpretable state" are the
  same measured statement.

The one-line perception reading: **the eye is a single perceiver whose input is phase-selectable —
it perceives either the world or a scene the medium generates — and `virtGo` is the first endogenous
control of the percept, bounded not by memory but by how coherently the percept survives being
driven.** (The memory/engram framing of the same mechanisms — plate = consolidated trace, bank =
content-addressable recall, V = offline replay — is a valid *dual* reading; it is recorded in
[[finding_gr_probes]] rather than here, because what the code literally runs is the perception
pipeline, and the storage view is the interpretation, not the mechanism.)


## 14. Summary in one sentence

**The eye is no longer a second world looking at the first; it is the first world's own long-τ
phase, equipped with verbs — record, lift, bind, swap, hold, recall, boot, go — that make memory,
dreaming, imagination, time-travel, and virtualization ordinary physics on the one soliton.**
