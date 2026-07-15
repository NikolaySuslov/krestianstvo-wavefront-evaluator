# KWE-GR — the general-relativistic Krestianstvo Wavefront Evaluator

*The new architecture, 2026-07: what it is, what it measured, how to build on it.*
*Companion documents: `computer.md` (the register-machine ledger), `proper-time-metric.md`
(the τ arc §§1–12, run-by-run), `kwe-tau.js` / `medium-core.js` headers (the laws in code).*

---

## 0. The thesis in one sentence

**Proper time is a platform law; physics is the app's.**

The classical Croquet/TeaTime replication model gives every peer one shared logical clock.
The new arc gives every *worldline inside the world* its own clock — a clock the platform
paces, snapshots, replicates and dispatches against, without ever knowing *why* it ticks.
That separation — the kernel knows **that** a worldline has a clock, never **why** — turned
out to be the entire architecture. Everything below is that sentence unfolded.

---

## 1. The classical baseline: one clock per world

Croquet/TeaTime (and classical Krestianstvo on top of it) achieves deterministic
replication with three moves:

- a **reflector** orders all events and stamps them with one logical time;
- every peer runs the **same deterministic world program** against that stream;
- **futures** (`ctx.future(dt, msg)`) schedule computation *in that one time*.

This is a special-relativistic world at best: there is a single global "now", every part
of the world ages at the same rate, and `future(dt)` means "dt units of *the* time". It
is byte-perfect and it is rigid: an object that computes slower, sleeps, or lives inside
a time-shared slice has no way to say so — the wall drags everything at one rate.

KWE inherits all three moves unchanged (the reflector, `W.reduce`, verbs as stamped
events). What it adds is the fourth:

- every worldline may carry a **proper-time clock τᵢ**, advanced by its own **beats**,
  and computation can be scheduled *in that clock* (`ctx.futureTau(dτ, msg)`).

---

## 2. What "GR" means here — operationally, not metaphorically

Each claim below is a **measured result** from the medium laboratory (references in
`proper-time-metric.md` §§9–12 and the `computer.md` ledger):

| GR notion | KWE realization | measured |
|---|---|---|
| worldline | a mux slot / node with its own executed-step counter kᵢ | per-slot τᵢ live since gate 3 |
| proper time | τᵢ = beats + fraction, advanced only by the slot's own beats | τ monotone, snapshot-carried, byte-identical |
| time dilation | an n-way mux runs each slot at 1/n proper rate; parked slots don't age | V aged 30 τ-units while W aged <1, byte-identical peers |
| the twin paradox | journeys make beats; standing doesn't; precession ∫ω·dτ is monotone | Δφ_V = ω·Δτ = 2.078 vs 1.900 predicted; W's null arm exactly 0 |
| clocks as observables | the register precesses ω per own beat → phase = ω·τᵢ | comparator slope = ω to 0.1% |
| path-dependent aging read from memory | plates stamp the recording observer's frame + beat count | [RECALL-∠] Δ = ω·Δτ_W = 0.800 exact |
| coupled clocks | edges between registers = Kuramoto of proper-time oscillators | entrainment, suppression, per-encounter P_lock — all live |
| simultaneity is not global | ledger-level consensus (byte-identical history) ≠ phase-level consensus (a shared "now") | the Adler tongue is the consensus budget |

The deep finding: **replication and simultaneity decouple.** Two peers can be
byte-identical in every hash while the worldlines *inside* their shared world age at
different rates and honestly disagree about "now" by ω·Δτ. Consensus at the history
level is unconditional; consensus at the phase level has a relativistic budget.

---

## 3. The kernel stack (the laws, all importable)

Everything below is app-independent, node-tested, and imported by both the full medium
and the thin apps. This *is* the new KWE kernel.

### 3.1 `kwe-tau.js` — worldline clocks and τ-dispatch

```
makeTauKernel({ stepsPerPhase, flatL })
  .beat(name, kp, k)      a worldline's clock ticked (kp = its proper counter, k = shared step)
  .advance(name, kp)      no beat this step (τ advances fractionally, clamped below the next integer)
  .tauOf / .beatsOf       read a worldline's clock
  .makeQueue(name, {clock, guard})   a verb queue; drained against COORDINATES or against a CLOCK
  .stamp / .reanchor / .setEpoch     shared-step stamping + the epoch flip law (L5)
  .save / .restore / .hash           full snapshot codec (queues + clocks + epoch)
```

The determinism laws it encodes (each one paid for by a live fork):

- **L1** — every dispatch gate is a pure function of (k, shared state). Queue *length* is
  not shared (pull-timing is peer-local); *due-count* is.
- **L2** — no frame-boundary application: verbs act at stamped shared steps only.
- **L3** — authored-fresh: an external command acts once at its authored coordinate;
  everything beyond moves only as local matter's clock ticks (backlog ≤ 1/τ-unit).
- **L4** — τ is monotone and self-healing; a fresh beat state requires a τ reset.
- **L5** — epoch safety: at a rate flip, re-stamp every future entry from its raw time.
- **L6** — snapshot-carry *everything* the state depends on (the kv-fork was one RNG).

**`ctx.futureTau(dτ, msg)`** at the world-program level: a node declares `__clock:
(state) => number` and futures fire when *the node has aged*, not when the wall moved.
No clock ⇒ `futureTau ≡ future` exactly (the no-op guarantee). A τ-parked node is
STABLE — sleeping worlds cost nothing and are woken by whatever advances their clock.

### 3.2 `medium-core.js` — the engine laws (extraction stages A–C4)

```
makeStepClock({stepsPerPhase})   §7.44: target(mon) = ⌊(mon−c0)·spp/rate⌋ — the mux divides
                                 the STEP BUDGET, not the wall; reanchor(k,r) keeps k continuous
                                 at rate flips (bit-exact vs the legacy inline law)
muxClocks(k, nSl, beats)         the two-clock law: fine buffer-ownership ph = k % nSl;
                                 coarse coupling/τ clock capPh rides BEATS, not the rotation
makeCouplingStore()              the edge matrix + the capture law (capture gated PURELY on the
                                 coarse-clock change; sources frozen from canonical stores;
                                 any edge write invalidates the cursor)
makeObserverBank(n)              observer descriptors as ONE store: {mode, phase, kx, ky, A,
                                 tx, ty, beta, omega, prec} per slot + snapshot codec (+ legacy)
lensU1                           the observer-lens algebra (see §6)
chainMeter(slots, {G, through})  the one link-read: pairwise overlaps, raw (pred/mdl/algDefect)
                                 or through-lens (the observed chain)
normalizeVirtEvent(e)            the verb WIRE SCHEMA — one source of truth at the pull
applySettingsVerb(vq,k,ops,dials) the settings-sector verb table (lensset/lenstau/refamp/…)
applyVirtVerb(vq,k,S,io)         the V-sector optics verb table behind a stores contract
```

The boundary rule that shaped every extraction decision: **the core knows THAT observers
have descriptors, clocks and queues — the physics (beat detectors, grids, calibrated
constants, operator content) stays app-side.** The mux scheduler's *laws* moved to the
core; its *orchestration* (what a step does) did not, because moving it would let the
core know why the medium ticks.

---

## 4. Matter's contract — what an app must provide

To run "on GR KWE", an app supplies exactly four things:

1. **State** for each worldline (a field, a voice, a cell — anything), mutated only at
   kernel-stamped shared steps, in deterministic float-op order.
2. **A step function**: what one proper step does to one worldline's state. This is the
   physics. The engine calls it for the slot that owns the current step (`muxClocks.ph`)
   — the mux time-shares the *step budget*, which is what makes proper rate 1/n real.
3. **A beat source** per worldline — anything that deterministically says "this worldline
   just ticked" from (its state, its proper counter):
   - the medium's **lock-ripple detector** (amplitude correlation vs the pin — matter beats);
   - a **metronome** in proper steps (the *musical* beat — `rhythm.js`);
   - an **IFS cascade** (beats = the fractal clock's own events — `hologram_world`);
   - a **convergence clock** (beats = iterations of a relaxation) — designed, deadlock-safe
     via the launch-chain liveness law.
   The kernel receives `beat(name, kp, k)` / `advance(name, kp)` and never asks which.
4. **Canonical stores** — CPU-readable truth for every worldline's state, because the
   coupling capture law and every meter read *stores*, never transient buffers.

What the app must **not** do: read wall time, gate anything on peer-local quantities
(frame boundaries, queue lengths, GPU buffer ownership), or mutate replicated state
outside a stamped step. Every one of those rules is a named fork in the ledger.

---

## 5. Why GR does **not** need the full soliton equations

This was the decisive question, and the answer is measured: **yes, it is possible —
the relativity lives in the temporal laws, not in the substrate's PDE.**

The decomposition:

- Time dilation is the **step-budget law** (`makeStepClock`): an n-way mux gives each
  worldline 1/n of the steps. That is scheduling, not hydrodynamics.
- Aging is **beats**, and a beat source only needs to be a deterministic function of the
  worldline's own state and counter. The medium's beats emerge from soliton lock ripple;
  `rhythm.js` proves an 8-float harmonic voice — or a bare metronome — feeds the same
  kernel and produces the same twin experiments, comparator slopes and recall stamps.
- The registers, the ω·τ precession, the chain meter, the recall stamps — all operate on
  *any* complex state with an inner product. `chainMeter` doesn't know whether its 
  fields are 256×256 solitons or four harmonics.

So the **thin GR app is real**: `observers.js` (a 16×16 Schrödinger toy) and `rhythm.js`
(a synth voice; ~8 floats of matter per worldline) run the full relativistic apparatus —
worldline clocks, differential aging on a metronome (twin paradox *without journeys*:
two tempos + lensTau), audible time dilation, observer-relative musical memory.

What the full soliton medium still uniquely provides — and why it remains the
laboratory:

- **emergent** beats (the clock arises from the matter's own lock dynamics, not from an
  authored tempo — the difference between *finding* a clock and *declaring* one);
- self-hosting operators (the genome/lens as matter, §7.88–§7.101);
- content-addressable memory with genuine capture basins (the bistable register);
- calibrated interaction physics (β, κ, leak — *measured*, with honest failure modes:
  wear, shatter floors, capture ranges).

The slogan: **the kernel makes any matter relativistic; the medium is where the laws
were discovered and are still tested.**

---

## 6. The observer layer — u-register and the lens algebra

The second half of the arc: observers as first-class *values*.

**The observer tuple** — every slot already is one:
`(readOp, __clock, register)` = (its lens descriptor, its worldline clock τᵢ, its
plate + phase register). The **u-register** is the chain W→V→P1→P2 — world lens
through observer traps — and it is *measured* as a path-ordered product:

- **`lensU1`** — the algebra. Elements `{mode, phase, kx, ky, A, tx, ty, beta, omega,
  prec}`; the id/phase sector is abelian U(1) (link phases add exactly — chain defect
  ≡ 0 is the stated model law); metric/gauge compose by the **semidirect product**
  (A_b·A_a; tilts pull back k·A⁻¹; translations contribute the exact phase correction),
  with `invert` closing to identity and `apply` proven exact on lattice-exact maps.
  β is *deliberately not applied* by reads — pin stiffness is dynamics, not what a read
  does to a field.
- **Two readout channels**: `chainRead` (raw fields + the algebra's prediction per link;
  mdl = measured − predicted, whose *drift* is the physics) and `chainSee` (each field
  read *through its own readOp* — ψ_out = Op·ψ_in as a meter; through the lens the
  descriptor is part of the measurement). Measured: mdl at the milliradian level; the
  U(1) identity link_seen = link_raw + pred exact; a metric lens costs **coherence,
  almost no phase** (vis 0.91→0.18 under rot 0.3 while the phase moved ~0.01).
- **The read-side honesty boundary**: the metric/tilt sector shapes what observers *see*
  (meters, the ∠lens render); dynamics consume only the U(1) phase. Making the resample
  act on stored operators is a real transform of matter — its own future chapter.
- **Observer-relative memory**: plates stamp the recording observer's frame and beat
  count; recall prints the age difference as a phase (`[RECALL-∠]`), verified exact at
  the ledger level and at the field level (the recalled world *is* aged).

**τ enters the lens**: `lensTau(ω)` makes each slot's reference precess ω per **its own
beat** — the register becomes an interferometric clock comparator, and every observer's
view depends on its own aging. That is the fourth, temporal component of the lens
algebra, and it is what ties the memory arc to the relativity arc.

---

## 7. IFS clocks, the geometry operator, and futureTau — one composition

How the pieces the arc grew separately compose into one kernel story:

- **The IFS cascade is a clock made of geometry.** The genome's affine maps are a lens;
  run recursively they are a fractal clock whose *intra-cascade delays are genome
  content in time* — therefore permanently coordinate-authored (a clock's mechanism
  cannot wait on the clock it defines). Only the **inter-cycle glue** rides τ:
  `ctx.futureTau(N_FRESNEL_ROOTS, launchSibling)` staggers the slots in matter time,
  with the finalize fallback supplying liveness (the law: a τ-paced schedule whose
  target can *refuse* the event needs a liveness path independent of the clock the
  refused event carried — the halt was live-caught and fixed).
- **The geometry operator is matter** (§7.97/98): a self-hosted operator is a
  transformation of space, not an object in it — which is why the metric sector of the
  lens algebra composes as affine maps and why "record through a lens" is a *birth in a
  rotated frame*, not a decoration.
- **futureTau generalizes all of it**: any node with a `__clock` schedules in its own
  aging. The IFS clock, the ripple clock, the metronome, a convergence loop — all are
  just different answers to "why does this worldline tick", and the platform never asks.

---

## 8. The verb surface (the replicated API)

All state changes are **verbs**: reflector-stamped events, clamped by the world model,
carried by the wire schema, drained at kernel-stamped shared steps. Three schema sites
— world clamp → **pull** (`normalizeVirtEvent`, the single source of truth) → drain
table — with the pull being the historically forgotten one (it silently stripped new
fields until it was centralized).

| verb | sector | meaning |
|---|---|---|
| `record` / `recvia(φ)` | optics | V born as W's copy — *through a lens* for recvia (field+plate+operator rotated together; the trap starts in the rotated frame) |
| `aphase(a, slot)` | optics | rotate a register's reference (the M-a″ retention write) |
| `lenstau(ω)` | settings | every reference precesses ω per its own beat (the comparator dial) |
| `lensset(slot,{kx,ky,rot,scl,tx,ty})` | settings | the extended readOp (metric/gauge) — read-side |
| `refamp(slot, m)` | settings | pin stiffness β dial (torque-balance) |
| `edge(a,b,κ)` | coupling | signed symmetric register coupling (the XY/Kuramoto machine) |
| `store` / `recall` | memory | plate bank with observer stamps; recall = content-addressed resume + [RECALL-∠] |
| `boot` / `kill` | slots | lift a plate into a live slot / release one |
| `mux` / `hold` / `mirror` / `selfclock` | medium | time-share, pin, counterfactual mirror, beat-driven rotation |
| `tempo(slot,n)` / `beatmode(slot)` | thin apps | the musical dial of proper time; choose the beat source live |
| `checkpoint` | join | park a full engine snapshot in the world; prune the log behind it |

**Meters** (peer-local, pure functions of replicated state — peers match at equal step):
`lensOps` (the descriptors), `chainRead`/`chainSee` (the two channels), `regPhase`
(angles + beats + hashes), `edgeStatus`, `tauKernel`. The console drivers
(`gates-console.js`, the sweep/twin/Kuramoto drivers) are built from these.

---

## 9. Two join architectures — and how each fails

| | snapshot join (medium) | total-replay join (thin apps) |
|---|---|---|
| ships | full state verbatim (medSnap*, ~MBs) | (time, verb log ≤512) + optional checkpoint |
| joiner | resumes at the leader's k | re-derives the universe from k=0 (or the checkpoint) |
| strength | O(1) join time | the replay *is* the verification — a joiner must re-arrive at the same hash |
| failure mode | **missing state** (the kv-fork: one unshipped RNG) | **stale goalposts** (the replay law below) |

**The stale-target replay law** (live-caught, sim-confirmed): a step loop that can cross
a rate flip must recompute its target after every drained verb; the budget cap bounds
the frame's *work*, never freezes the goalpost. (A frozen target overshoots by
(chunk·Δrate/rate) phantom steps, then the joiner sits frozen until the wall catches up.)
Live frames hide this (≤ one frame in flight, identical on peers); replay chunks expose
it. With the fix, a cold replay and a live history land byte-equal — which is also the
strongest verification of the kernel's L5 re-stamping.

---

## 10. Recipe: writing a new thin app

`observers.js` (visual toy) and `rhythm.js` (musical matter) are the two templates; both
are ~300 lines, ~80 of which are physics. The skeleton:

1. **World program**: hold `(time, seq, log, snap)` only. Clamp verbs; append to the log;
   handle `checkpoint` by storing the snap and pruning the log. Nothing else.
2. **Engine** (in the renderer closure — a pure function of shared time + verb history):
   instantiate the laws — `makeObserverBank`, `makeStepClock`, `makeTauKernel` + a verb
   queue, `makeCouplingStore`; keep per-slot state + canonical stores.
3. **The frame loop**: pull unseen verbs (`normalizeVirtEvent`, stamp with the *same*
   clock scale as the target — reflector `wallTime` counts pulses, not ms); then
   `while (done < CAP) { tgt = clk.target(now); if (k >= tgt) break; drain(k) →
   applySettingsVerb ∥ your verb table → reanchor; {ph} = muxClocks; capture if due;
   stepSlot(ph); k++; done++; }` — target recomputed every step (§9).
4. **Physics**: your `stepSlot` + your beat source, feeding `tauK.beat/advance`.
5. **Render**: draw/play *the replicated state* — panels through the observer's own
   readOp if you honor the ∠lens toggle; audio plucked when the shared engine crosses a
   beat. Renders are peer-local; the state never is.
6. **Instruments**: wire `chainMeter`, `lensOps`, hashes into a status line; carry a
   halt-catcher (a thrown engine must say so once, not freeze silently).

What you get for those ~300 lines: replicated worldline clocks, time dilation, the twin
experiments, observer descriptors with a composing lens algebra, coupled-clock physics,
observer-stamped memory, and two-peer byte-verification — none of it written by you.

---

## 11. The difference from classical Croquet/Krestianstvo, summarized

| | classical | KWE-GR |
|---|---|---|
| time | one logical clock per world | + a proper-time clock per worldline |
| scheduling | `future(dt)` in wall/logical time | + `futureTau(dτ)` in the node's own aging |
| dilation | impossible to express | the step-budget law; parked = not aging |
| observers | implicit (the view) | first-class values: (readOp, __clock, register) |
| observation | render = state | render = Op·state, and Op composes as a group |
| memory | state snapshots | + observer-stamped plates; recall reads the age gap |
| coupling | message passing | + calibrated register coupling (Kuramoto of clocks) with a measured consensus budget |
| consensus | byte-identity = agreement | byte-identity ≠ shared "now": phase consensus has a relativistic budget (the Adler tongle) |
| the app's burden | the whole simulation | ONLY the matter: state + step + beat source |

The classical stack answers "do all peers compute the same world?" The GR stack adds the
question the classical stack could not ask: **"do the inhabitants of that world agree
what time it is?"** — and gives it a measured, budgeted, per-encounter answer.

---

## 12. Grounding index (where each claim was measured)

- τ gates 1–3, per-slot worldlines, live time dilation — `proper-time-metric.md` §§1–8.
- Kernelization gates 1–4, futureTau, launch-chain liveness — §9.
- ω·τ comparator, temporal shatter floor, the twin run — §10.
- Kuramoto-of-clocks: entrainment / suppression / P_lock, instrument laws — §11 (runs 1–7).
- u-register steps 1–5, lens algebra, metric sector, recall results, chainSee two-channel
  law, extraction ladder A–C4, thin apps, replay law — §12.
- The register machine itself (field=processor, MAXCUT, GAUGE, wear, recall-by-relaxation)
  — `computer.md`.
