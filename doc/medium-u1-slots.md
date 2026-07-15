# medium-u1: the slot-centric architecture (the U(1) register arc AS the app)

## The pivot

medium.js grew scope-first (medium vs eye) and mode-first (write/pass/clock/transport/…), with the
W/V/P observer register bolted on late (the u-register arc, after eye.js). medium-u1 inverts that:
**the register is the center, and every old concept is re-derived as a behavior of slots.** The
extracted substrate (medium-gpu engine, medium-core laws, kwe-tau, lensC1) stays; only the
orchestration's organizing principle changes — from "modes on a medium" to "behaviors of slots."

## The one abstraction: a SLOT

An observer slot is the tuple the whole arc converged on, made concrete:

```
Slot = {
  field,          // the living ψ on the shared substrate (or a stored plate)
  readOp,         // the observer descriptor (lensC1 element: mode, phase, gain, A, tx, ty, β, ω, prec)
  clock,          // the worldline clock τ_i (kwe-tau: beats + proper time; ticks on THIS slot's steps)
  register,       // the phase register (readOp.phase/prec + the [RECALL-∠] ledger)
  leash,          // { go, tx, ty, gx, gy, l0, lt, lk } — the chase command + eased position + cadence cursor
  movAtt(gx,gy),  // THE UNIFICATION: the slot's attractor at eased position (gx,gy):
                  //   · REGENERABLE slot (a live object, e.g. W)  → makeProbeField(obj, at 1+gx,1+gy)
                  //   · STORED-PLATE slot (a recorded moment, V/P) → rollField(att, round(gx), round(gy))
}
```

Slots share ONE GPU substrate, time-shared by the mux (§7.44): `muxClocks(k, nSl)` rotates which slot
owns the buffer each step. This is `_muxVirtualStep` — kept (fork-critical), but re-expressed as
"advance the owning slot," not "W plus virtual phases."

## The re-derivations (old concept → slot behavior)

### 1. shiftX/Y  →  W.leash.virtGo(tx, ty)
**The headline simplification.** In medium.js, W transports via a SEPARATE path (`_transPx/Py` ease +
`_rebuildAtt` + `_coevoLeash`), while V/P transport via the register leash (`_leashAdvance` + `rollField`).
The oracle's own comment (medium.js:1551) admits these are *"a different transport law for V than W."*

They unify: **transport = a slot's leash toward a target, where `movAtt` regenerates (W) or rolls (V/P).**
- `_leashAdvance(slot, ψ)` (already generic in medium-core-land) moves `gx/gy` toward `tx/ty` at
  ≤1px/beat × the lock-slack sigmoid — SAME for every slot.
- The only per-slot difference is `movAtt`: W's is `makeProbeField`-regenerable; V/P's is `rollField` of a
  stored plate. That difference is DATA (which kind of slot), not two code paths.

So `_transPx/_transPy/_transShift*/_rebuildAtt/_coevoLeash` (the transport special case) **collapse into**
`W.leash` + `W.movAtt = regenerable`. The shiftX/Y sliders become `W.virtGo(tx,ty)` — the same verb V/P
already use. **One leash law, N slots.** (Parity risk: W's `_coevoLeash` had its own ≤1px pacing tuned
against `_TRANSPORT_PULL_STEP`; the unified leash uses the register's sigmoid pacing — diff vs oracle to
confirm the chase feel matches; the arc believed they SHOULD be one law, so this tests that belief.)

### 2. drive:transport / objorbit  →  W.leash target = point / circle
Not global modes — the shape of W's leash target. `transport` = a fixed (tx,ty). `objorbit` = (tx,ty)
circling at `objOrbTheta` (the `_oorbAtt` angle). Both are `W.virtGo` with a moving vs static target.
Per-slot: any slot could orbit. The `_driveMode` dial becomes `W.leash.pathKind ∈ {point, circle}`.

### 3. eye / medium scopes  →  slot VIEWS
Not two lens contexts — "which slot am I looking at." The two-scope UI (`_S.eye`/`_eyeLensP`/`_uiScope`/
makeTrapStack/EYE_RECON) dissolves: there is ONE view that renders the SELECTED slot through its readOp.
"The eye" is the V slot (the dream/recon); "the medium" is the W slot (the world). Selecting a slot to
view = the old scope toggle. The eye's "trap = perception on a recon" is just "render V through V.readOp."

### 4. perception / render  →  render-through-readOp per slot
Already built by the u-register arc (`lensU1.apply(slot.readOp, slot.field, GRID)` — [[finding-new-eye-
reconstruction]]: ONE read primitive, ψ_out = Op·ψ_in). Each slot's canvas renders its field THROUGH its
own readOp (phase/metric/gauge). `lensView` toggles raw vs through-readOp. No scope-branched pipeline.

### 5. record / recall  →  freeze / compose a slot's (field, readOp)  [DUAL-LAYER HOLOGRAPHY]
A stored moment = BOTH plates ([[project-u-register-arc]] R-target):
- **field plate**: the 128KB ψ (GPU record = stepEyeN(+DT), lift = stepEyeN(−DT)) — the IMAGE.
- **descriptor plate**: the slot's `(M, O)` = readOp pair ≈ 6 floats — the register MOMENT.
- lift-aged = `lensC1.compose(plate, lensC1.invert(drift))`; recordVia(φ) = `lensC1.compose({phase:φ}, plate)`.
- The demo's HEADLINE: `[RECALL-∠] = ω·Δτ` matches from BOTH the field round-trip AND the 6-float compose
  — the field is the ground-truth oracle proving the descriptor path faithful.

### 6. ℂ* gain / self-host / unpin  →  what a slot CAN BE
First-class, not bolted on: a slot's readOp is a lensC1 element (ℂ* = ℝ₊×U(1)); `unpin` lets its gain
drift (non-compact), `capGain` bounds it (the energy law); a slot can self-host (makeSelfHost) as its own
clock. These are slot properties, available because the slot IS a lensC1 element.

## What stays (the fork-critical substrate — reused, not re-derived)

- **medium-gpu** `_E`: fields, clocks, stepSoliton, applyKick, rollField, saveEngine/restoreEngine.
- **medium-core**: makeObserverBank (the slots' readOps), muxClocks, makeCouplingStore, chainMeter,
  applyVirtVerb/applySettingsVerb (the verb tables), makeStepClock, **makeStampedInput**, and the
  **determinism primitives** `hashField` / `hashNums` / `opNums` / `ampCorr` + **`syncClockRate`** (below).
- **kwe-tau**: the worldline clocks τ_i + the shift/att/sig/virt queues (deterministic drains).
- **`_muxVirtualStep`** logic (the slot-rotation + park/reload + selfClk/τ + coupling) — kept, re-expressed
  as "advance the owning slot." This is fork-critical; transcribe faithfully, diff vs oracle.

### The determinism primitives → medium-core (`hashField` / `hashNums` / `opNums` / `ampCorr`)

The instruments EVERY replicated KWE app rebuilds to compare peers — factored so there is ONE implementation
(the two-tier hashes of the [determinism reframe](#the-c-observer-algebra-lensu1--lensc1--the-group-behind-the-descriptor)):

- **`hashNums(nums)`** — FNV over 1e-6-quantized doubles: the EXACT-ARITHMETIC tier. `regH` = a hashNums of
  the register scalars. Byte-identical across peers by construction (descriptor arithmetic + integer beats,
  no GPU/f32); the quantize only guards benign last-bit ω·τ accumulation. NaN/∞ → 0 (never poison the hash).
- **`opNums(op)`** — a lensC1/lensU1 element → its 13 scalars: the CANONICAL serialization of the group
  element (lives with `makeObserverBank`, which produces them). `regH` opNums-es each slot's readOp.
- **`hashField(f)`** — FNV over the Float32 VIEW of a ψ field (the GPU's f32 "truth"): the ψ tier. `solH`/
  `fieldH`. MAY drift on ULP — the LOCK, not this hash, is the honest cross-peer convergence measure.
- **`ampCorr(a, b)`** — normalized complex overlap ∈ [0,1] (U(1)-invariant): the lock / fidelity meter
  (lock→A, recall cue-match, lift fidelity). medium-core's verb table already EXPECTED an injected
  `S.ampCorr`; this is now the canonical one it can default to.

Rule of thumb: **descriptor state → `hashNums(opNums(...))` (the exact contract); field state → `hashField`
(may drift, compare via `ampCorr`).** That IS the two-tier determinism law, in two function calls.

### `syncClockRate(stepClk, tauK, k, nSl)` — mirror a rate flip onto the τ kernel

A one-liner that is a FORK LANDMINE if omitted. When the live-slot count `nSl` changes (V born → 1→2),
`stepClk.reanchor` halves the step budget (`target/nSl`, so the GPU keeps up), but if `tauK` keeps the OLD
rate its `stamp(t)` lands verbs ~nSl× AHEAD of the drive's real `solSteps` → a growing backlog → stamped
inputs (store/recall) fire seconds late (live-caught: store Δ=17 before V, Δ=1006 after). `syncClockRate`
mirrors the flip onto τ — keeping `k` continuous (`c0 += k·(rΔ)/spp`, a pure fn of shared k+rates →
byte-identical) and re-stamping τ's pending queue into the new epoch. **Call it every frame with the current
nSl; it is a no-op unless the rate actually changed.** No app should hand-roll or forget the mirror.

### The stamped replicated-input pattern → `makeStampedInput` (medium-core)

**The canonical way to feed ANY external input into a deterministic KWE app.** A UI slider / verb / mode is
replicated through the reflector as a monotonic-seq'd LOG on a world node; every peer MUST apply each entry
at the SAME shared step, never "whenever this peer's frame reads the latest value" (that applies it at a
peer-local step → the field forks whenever anyone drags a slider — [[finding_mux_determinism]], the single
most-repeated fork in the whole arc). The stamping QUEUE lives in kwe-tau (medium-agnostic); the pull /
cursor / drain / join BOILERPLATE around it is factored into `makeStampedInput(tauK, name)`:

```js
const si = makeStampedInput(tauK, 'shift');            // one handle per input stream
si.pull(n.shiftQueue, (e) => ({ toX: e.toX }));         // frame: push NEW entries (seq cursor), stamp each to its shared step
si.drain(k, (e) => applyIt(e, k));                      // drive loop: apply each at its stamped shared step k
// join codec:  save → si.saveCursor();  restore → si.reattach(); si.restoreCursor(v)
```

medium-u1's shift and register/holography verbs (refamp/aphase/lenstau/record/store/recall) are its two
consumers — each is ONE `.pull()`/`.drain()` instead of a 4-block dance. **THE LAW this encodes:** *every
external input is a pure function of (k, shared state), applied at a shared stamped step.* Reach for this
in any new KWE app with replicated controls; do NOT hand-roll a seq cursor + queue + join codec again.

**What is NOT routed through it (deliberately):** the IFS-kernel swap. Its far-behind cold-snap (`ver <
oldestQ−1`), version dedup, and cross-slot V-replay are kernel-specific; forcing them through the generic
helper would leak special-cases into it. The kernel swap stays app-local (medium-u1), stamping via the same
`_tauK` clock but with its own staging (`_pendKern` + `_kernApplied`). The boundary: `makeStampedInput` is
for a REPLICATED SEQ'd LOG of independent events; the kernel is a VERSIONED, gap-fillable ring stream — a
different shape that earns its own code.

## What's DORMANT (preserved, not in the slot model yet)

The tunnel/instanton/vortex/barrier arc + the 5 pre-U1 drives are quarantined in medium-u1-oracle + git
(the resurrect reservoir). They re-enter the slot model LATER as "a slot's operator can tunnel/kick" —
out of scope for the first slot-centric build.

## Build order

1. **Slot object + bank**: define `makeSlot(kind)` over `makeObserverBank` (readOp) + `_E` (field) +
   kwe-tau (clock) + leash. `kind ∈ {regenerable (W-like), plate (V/P-like)}` picks `movAtt`.
2. **The mux loop**: `_muxVirtualStep` re-expressed over the slot array (advance owner; park/reload).
3. **Transport = W.leash**: wire shiftX/Y → `W.virtGo`; W.movAtt = regenerable. Diff chase vs oracle.
4. **Register meters**: chainRead/chainSee/lensOps/regPhase over the slot array (already generic).
5. **Views**: one render that draws the selected slot through its readOp; slot selector = old scope toggle.
6. **Dual-layer holography**: record/recall freezing both plates; the [RECALL-∠] equivalence readout.
7. **Join**: `_E.saveEngine/restoreEngine` + the slot registers over `_snapHook`.

Each step diffed against the oracle for physics parity; determinism laws already extracted+tested.

## The honest risk

Transport-as-leash (step 3) is the one place physics might diverge from the hand-tuned
`driveSolitonTransport` — the arc believed W and V/P transport SHOULD be one law but ran two. This build
tests that belief live. If the unified leash chases differently (feel/lock/E), the oracle shows it, and
we either tune the unified leash to match or accept a documented, understood difference. Everything else
is re-organization of already-verified pieces.

---

# The ℂ* observer algebra (lensU1 / lensC1) — the group behind the descriptor

The slot's `readOp` is an element of a group implemented in `public/soliton-algebra.js` as `lensU1`
(aliased `lensC1`). This section states, precisely, what that group IS — because the project shorthand
"the ℂ* dop = 6 floats" is loose in two ways, and the precision matters for what the register can and
cannot do.

## The element (what a readOp actually holds)

```js
lensU1.id() = { mode, phase, gain, kx, ky, A:[a,b,c,d], tx, ty, beta, omega, prec }
```

`mode` is DERIVED (`modeOf(hasA, hasK) ∈ {id, phase, metric, gauge}`), `beta` is NOT part of the group
action (it is pin STIFFNESS — a dynamics parameter, deliberately never applied by `apply`, see below).
The genuine group coordinates are these ~9 scalars, in four roles:

| Fields | Dim | Role | Sub-structure |
|---|---|---|---|
| `phase` | 1 | U(1) rotation `e^{iφ}` | **abelian — phases ADD** |
| `gain` | 1 | ℂ* modulus `r` (element = `r·e^{iφ}`) | **abelian — gains MULTIPLY** |
| `A[2×2]`, `tx`, `ty` | 6 | affine metric warp (bilinear resample) | **GL(2,ℝ) ⋉ ℝ² — NON-abelian** |
| `kx`, `ky` | 2 | linear carrier / phase-tilt `k·x` | transforms under A (semidirect) |
| `omega`, `prec` | 2 | ω (clock rate), precession offset | abelian — ADD (the time DOF) |

## Is it "a 6-float Lie group"?

**The group is `ℂ* × [GL(2,ℝ) ⋉ ℝ²]` (plus the ω/prec time-shift ℝ²).** It is a genuine Lie group — but
neither 6-dimensional nor abelian. `compose`/`invert` implement its EXACT multiplication and inverse
(`compose(op, invert(op)) = id` holds by construction, not approximately):

- **ℂ\* core** — the `(phase, gain)` pair, `r·e^{iφ}` under complex multiplication. A 2-D abelian Lie
  group. Crucially **non-compact** (r ∈ ℝ₊ unbounded above): this is the one honest extension of U(1)
  that stays a Lie group AND makes RUNAWAY possible. `apply` is unitary only on the `gain=1` slice; off
  it, self-hosting can diverge in the amplitude dimension — the medium's energy is now a first-class lens
  coordinate. `capGain(op, rMax)` is the medium's energy CAP expressed as an algebra operation; `logGain
  = ln r` is the natural coordinate (it composes ADDITIVELY, so `(phase, logGain)` is a uniform 2-vector).
- **Metric part** — `A` composes by matrix product (`mul2(A_b, A_a)`), translations compose semidirect
  (`t = A_b·t_a + t_b`), and the carrier `k` co-transforms by `A⁻ᵀ` (`k_a·A_b⁻¹`). That is `GL(2)⋉ℝ²`, a
  real NON-abelian Lie group. This is what makes the readOp an actual optical-chip LENS (affine remap of
  space), not merely a phase multiply. The `phase` even picks up the `−k·t` cross-term under compose —
  the honest Heisenberg-like coupling between a carrier and a translation.
- **Time part** — `omega`, `prec` add; `evalAt(op, dτ) = phase + prec + ω·dτ` is the per-op worldline
  clock read (each op supplies its own proper-time increment dτ).

## Where "6 floats" comes from (and why it's the RIGHT shorthand for the REGISTER)

When the metric part is trivial (`A = id`, no resample → `mode ∈ {id, phase}`), the element COLLAPSES to
its **abelian core**: `(phase, gain, omega, prec, kx, ky)` ≈ 6 numbers. This is the descriptor plate —
the "dop" of the holography arc. On this slice `compose` is trivially abelian (everything adds/multiplies),
which is exactly why the register is EXACT and CHEAP: no GPU, no field bytes, no ULP. `regH` (the
determinism contract) hashes precisely `_opNums(op)` = these scalars across all four slots. So:

- **The group** (what `apply` can DO to a field): `ℂ* × (GL(2)⋉ℝ²)` + time — ~9 scalars, non-abelian.
- **The register descriptor** (what a slot REMEMBERS): the 6-float abelian core — phase/gain/ω/prec/k.

The 6-float dop is not the group; it is the group's abelian, determinism-carrying SLICE. The metric part
lives in the SAME element and is used by `apply` for perception (the real transformed views), but it is
not what the register content rides on.

## lensU1 vs lensC1 — the same object, two governances

`lensC1 === lensU1` (literally, line 2001). They are ONE element type; the two names encode a GOVERNANCE
choice about which subgroup rules a worldline:

- **lensU1** = the COMPACT unitary subgroup (`gain ≡ 1`, `pin`ned). Energy-preserving, runaway-proof.
  The thin apps' determinism-via-compactness DEPENDS on staying pinned: `apply` is unitary, norms are
  bounded, no amplitude drift to fork on.
- **lensC1** = the FULL ℂ* (gain free, `unpin`ned). The amplitude DOF is live; the worldline can grow/decay.

`unpin(op)` is the IDENTITY on the element (every element always carries all fields) — "unpinned" is a
choice the caller RECORDS, not a mutation. `pin(op)` projects `gain → 1` (energy renormalized). A worldline
moving `lensU1 → lensC1` is acquiring the amplitude degree of freedom; `repin` projects it back. **The
subgroup relation is load-bearing, not decorative:** the register's exactness is the statement "we stay on
the compact slice," and the medium's energy cap is the statement "we bound gain when we leave it."

---

# Abstract holography — memory as apply/invert on a group, not a plate

The dual-layer holography (section 5 above) is a specific instance of a more general claim the arc
converged on. State it abstractly, because it is the conceptual payload, and the medium is only ONE model
of it.

## The classical hologram vs the KWE generalization

A classical hologram stores an image as a FIELD (an interference pattern, `|ψ + ref|²`), and reconstructs
by re-illuminating — a field round-trip. In KWE the field round-trip is real and kept: `record =
stepEyeN(+DT)` (propagate to the plate), `lift = stepEyeN(−DT)` (reverse the clock — a reconstruction),
verified to lift the moment back with high fidelity. This is the **field plate**: 128 KB, carries the
IMAGE (the perception picture), NOT expressible in a few floats.

But the u-register arc MEASURED that the recalled moment returns **aged by exactly `ω·Δτ`** — a pure
DESCRIPTOR quantity. So for the REGISTER content (the observer's phase/gain/metric moment, not the picture),
the plate need not be a field at all: it is the group element `(M, O)` — the readOp — and the whole
record/lift/age round-trip becomes `apply` / `invert` / `compose` on that element. This is the
**descriptor plate**: ≈ 6 floats, EXACT under the group law, no GPU.

## The three verbs, as group operations

| Holography verb | Field-plate (image) | Descriptor-plate (register) |
|---|---|---|
| **record** | `stepEyeN(+DT)` → freeze ψ | freeze `(M, O)` — no GPU pass |
| **lift, aged** | `stepEyeN(−DT)` on the plate | `lensC1.compose(plate, invert(drift))` — resurrect aged by the register's OWN drift (ℂ* generalizes it: gain drift too, not only phase) |
| **record-through-a-lens φ** | inject φ into the field | `lensC1.compose({phase:φ}, plate)` — "record through a lens" IS a compose |

The forward/backward structure the MEDIUM has (propagate / reverse-propagate) is the SAME forward/backward
structure the GROUP has (`apply` / `invert`) — but on descriptors instead of fields. That is the
generalization: **holography is apply/invert on a group; the field is one representation of the group
element, the 6-float descriptor is another, and they agree.**

## The honesty gate — the two layers must AGREE, not replace each other

The point is NOT "throw away the 128 KB field and keep 6 floats." That would be a lossy trick, and the
whole medium arc forbids tricks ([[feedback-no-tricks]]). The point is the EQUIVALENCE:

- The **descriptor plate** carries what is expressible as a group element — phase / gain / metric drift,
  i.e. the `[RECALL-∠]` register readout. Exact under `lensC1` apply/invert. 6 floats. No GPU.
- The **field plate** carries what is NOT — the IMAGE, the actual reconstructed picture. The descriptor is
  the FRAME the field is read THROUGH ([[finding-new-eye-reconstruction]]: the phase-vs-texture line),
  never the field itself.

`medium-u1` records BOTH, and its `[RECALL-∠]` readout logs THREE numbers side by side (browser-verified
live, 2026-07-15):

- **(A) the MEASURED field aging** — `phaseCorr(plate, cue) = arg⟨plate, W-now⟩`, read from the 128 KB
  FIELD BYTES themselves (no descriptor). `cue` = W-now propagated to plate space; `plate` = W-at-store in
  the same space → their overlap phase is purely the aging (the common propagation cancels).
- **(B) the EXACT descriptor prediction** — `wrap(angle(readOp_now) − angle(plate.dop))`, the difference of
  two stored REGISTER PHASES. This is `lensC1.compose(plate, invert(now))` read as an angle: a pure 6-float
  op, no field. It equals `Σω` (the register accumulates ω PER BEAT), so it is exact **even when ω changes**.
- **(C) the CLOSED FORM** `ω·Δτ` — the constant-ω special case (`Σω = ω·N` only if ω never changed since
  store). Shown alongside, honestly flagged as valid only under constant ω.

**THE HEADLINE, corrected and measured:** the equivalence is **(A) ≡ (B)** — the measured field aging equals
the exact 6-float descriptor Δφ. Live: with ω=0.02 constant, A=0.054, B=0.060, C=0.060 rad, |A−B|=0.006 rad
(~0.3°) → all three converge. With ω set LATE (changed mid-flight): A and B still AGREE (both track the real
per-beat Σω — e.g. A=0.094, B=0.160 rad), but C=1.560 rad DIVERGES — correctly flagged, not hidden. So the
naive `[RECALL-∠] = ω·Δτ` shorthand (used loosely across earlier notes) is the CONSTANT-ω special case; the
EXACT law is the register Σφ difference, and THAT is what agrees with the field.

The GPU field is the ground-truth ORACLE proving the cheap descriptor path is faithful; the descriptor is not
a replacement but a live PROOF that the register moment is a pure group quantity. The residual |A−B| (~0.006
rad at rest) is honest physics: the soliton is not a perfect global-phase plane wave, so the energy-weighted
field phase carries a little spatial structure the single register angle does not — exactly the phase-vs-
texture line. Where a moment is expressible in the group, the 6 floats suffice and are exact; where it is not
(the image texture), the field is irreducible. Holography, honestly, is: **the part of a remembered moment
that lives in the group is 6 exact floats (and they measurably predict the field's aging); the rest is the
field.** The `[RECALL-∠]` log is the system continuously, MEASURABLY proving its own macro↔micro integrity —
not by assertion (the old descriptor-vs-descriptor check) but by comparing the equation against the bytes.

## Why this is the completion of `makeSelfHost`

`makeSelfHost` has the structure (matter M, operator O, compose-toward-fixpoint). A stored plate is that
structure FROZEN; a recall is it RESURRECTED. So the dual-layer holography "falls out for free" from the
self-host algebra: a plate is a paused self-host, the register drift is its clock, and aging a recalled
moment is running the compose one more step. Holography is not a separate subsystem bolted onto the medium
— it is the self-host algebra with a pause button, and the ℂ* group is what makes the pause exact.

---

# Proper time (τ) as prerequisite — the group is the SPACE of moments, τ is what MOVES through it

A natural question: **is proper time a prerequisite for the main KWE laws — abstract holography, the
register, determinism?** The code gives a precise, two-sided answer. τ is NOT required for the ℂ* algebra
or the storage structure (those are timeless group operations); τ IS required for everything that EVOLVES
— aging, precession, determinism stamping, multi-observer time-dilation. The group is the space of moments;
proper time is the motion through it. Abstract holography's STATIC half is group-only; its DYNAMIC half
(the headline equivalence) is τ-driven.

## What proper time IS (kwe-tau, the τ kernel)

`kwe-tau.js` is the PROPER-TIME KERNEL: per-worldline clocks + deterministic proper-time dispatch. Each
slot `i` has its OWN clock `τ_i`, advanced by that slot's OWN beats (its own physics detector), so two
slots on the same substrate accumulate DIFFERENT proper time — genuine time-dilation, not a copy.

- `beatsOf(name)` → integer beat count `N_i` of worldline `i` (the register's tick).
- `tauOf(name)` → the metric-weighted proper time `τ_i` (integer-snapped at beats; L1–L6 laws).
- The kernel also OWNS the stamping clock: `stamp(t) = ⌊(t·RATE − c0)·SPP / rate⌋` maps a replicated
  event time `t` to a SHARED step — the mechanism that makes every input deterministic (see below).

## The dependency, drawn

```
                    proper time τ  (kwe-tau: per-slot beat counters N_i, τ_i)
                    │
       ┌────────────┼───────────────────────┬───────────────────────────┐
       │            │                        │                           │
   (timeless:    supplies Δτ            supplies N_i               supplies stamp(t)
    NOT on τ)     (aging interval)      (register tick)            (shared-step gate)
       │            │                        │                           │
       ▼            ▼                        ▼                           ▼
  ℂ* ALGEBRA   ω·Δτ AGING            REGISTER PRECESSION         DETERMINISM
  compose/     (evalAt /             φ ← φ + ω per beat          every input stamped
  invert/apply the recall angle)     (regH hashes N_i)           at a shared step
  record/lift  = HOLOGRAPHY'S        = the U(1) register         = "every input a pure
  FREEZE       HEADLINE              file evolving in τ           fn of (k, shared state)"
```

## Half 1 — TIMELESS: the group and the storage need NO clock

The `lensC1` group law and record/lift-as-apply/invert are pure algebra — freeze the clock and they still
hold. In `medium-u1.js`:

- **record** (`_recordV`) — the record operator `{ mode:'id', phase, gain:1, kx:0, ky:0, … }` and the field
  round-trip `stepEyeN(+DT)` / `stepEyeN(−DT)` reference no τ.
- **store** — a plate freezes `dop` (the descriptor `(M,O)`) + `p` (the field). The `(M,O)` freeze is
  timeless.
- **compose / invert / apply** (`soliton-algebra.js`) — take no time input. `compose(op, invert(op)) = id`
  regardless of any clock.

So the statement **"holography = apply/invert on a group"** stands WITHOUT proper time. You can record, lift,
and record-through-a-lens with τ frozen. The group is the space of storable moments; it exists statically.

## Half 2 — τ-DRIVEN: everything that EVOLVES

### (a) The recall angle — holography's HEADLINE `[RECALL-∠] = ω·Δτ`

The equivalence that IS the demo — field-aging ≡ descriptor-aging — cannot be computed without the beat
clock. At store, the plate records the W-beat count; at recall, the aging interval is the beat DIFFERENCE:

```
store:   plate.bw = beatsOf('W')            // N_W at record time   (a τ quantity)
recall:  Δτ_W     = beatsOf('W') − plate.bw // = N_now − N_store    (beats elapsed on W's worldline)
         Δ_desc   = wrap( ω · Δτ_W )        // (B) the 6-float descriptor prediction
         Δ_field  = wrap( ∠(M_now) − ∠(M_plate) )   // (A) the 128 KB field round-trip
         EQUIVALENCE:  | Δ_field − Δ_desc | ≈ 0      // the two agree
```

`Δτ_W` is `beatsOf('W')_now − plate.bw` — a **worldline-clock read**. Remove the clock and there is no
`Δτ`, hence no `ω·Δτ`, hence no equivalence to prove. The descriptor half of holography is τ-gated; only
the field half survives without it (and then only as an un-predicted round-trip, not a demonstrated law).

The algebra even names the operation: `evalAt(op, dτ) = phase + prec + ω·dτ` — the predicted angle `dτ`
proper-time units AHEAD. The caller MUST supply `dτ` from a clock; the group provides the law, τ provides
the argument.

### (b) The U(1) register — precession per beat

The observer's phase is not static; it PRECESSES, and it precesses in proper time — once per beat:

```
per beat of worldline i:   φ_i  ←  wrap( φ_i + ω_i )        // ω = the lensTau dial (rad / beat)
so after N_i beats:        φ_i(N_i) = φ_i(0) + ω_i · N_i     // the register ages linearly in τ
```

In `medium-u1.js` this is the "W AGES" block, keyed to the SHARED 21-step bar so both peers precess at the
identical step: `if ((k+1)%21===0) { beat('W', …); φ_W ← wrap(φ_W + ω) }`. The register content `regH`
hashes `beatsOf(s.name)` per slot — so **the register's exact-arithmetic determinism INCLUDES proper time**.
The register file is a U(1) phase evolving in τ; freeze τ and the register stops being a clock-comparator.

### (c) Determinism — the stamping clock IS the τ kernel

Every fork the medium-u1 arc closed (kernel swap, refAmp slider, V's birth step) was fixed by the SAME
move: stamp the input to a shared step via `_tauK.makeQueue(...)` and drain it in the drive loop. The law
that closed the arc — **"every external input must be a pure function of (k, shared state), applied at a
shared stamped step"** — is a τ-kernel service (`stamp(t)`). So determinism, the precondition for ALL the
distributed laws, rides on the proper-time kernel's stamping. (See kwe-tau L1–L6: due-count not raw length,
epoch reanchor keeps k continuous, etc.)

### (d) Multi-observer time-dilation — the reason τ is PER-SLOT

Because each slot carries its OWN `τ_i` (not a global clock), a stored/booted worldline can age at a
different rate than the live one: the τ ledger measured **V aged ~30 τ-units while W aged <1, byte-identical
across peers.** That is what makes V a genuinely DIFFERENT observer than W — a different amount of proper
time under the same coordinate steps — rather than a mere copy. Per-slot τ is the prerequisite for the
multi-observer register having distinct clocks to compare (`link(a,b) = ∠b − ∠a`, the gauge-invariant
pairwise read).

## The one-line law

> **The ℂ* group is the space of moments; proper time τ is the parameter that moves through it.**
> Storage and the algebra are timeless (group-only); aging, precession, determinism-stamping, and
> time-dilation are τ-driven. Abstract holography's freeze/lift is group-only; its headline equivalence
> `[RECALL-∠] = ω·Δτ` — and with it the register-as-clock and the distributed determinism — are proper-time
> prerequisites. τ is not one law among the KWE laws; it is the evolution parameter the dynamic laws are
> written in.

(Full τ theory: [[proper-time-metric]] (the ledger, gates 1–3, the metric law), [[computer]] (the register
experiment). The kernel: `public/kwe-tau.js`, laws L1–L6.)

---

# medium.js vs medium-u1 — the drive loop, coevo vs virtGo, and where GR lives

The slot rearchitecture changed the transport *machinery* but not the *physics laws* — and it PARKED one
thing (the matter↔geometry feedback) that ℂ* can bring back more honestly. This section makes the diff
exact and answers where the honest GR / "speed of light" actually is.

## The drive loop, side by side

Both loops step the soliton identically at the innermost level — `applyEyeSuperpose(β·att)` → `stepEyeN(1)`
→ `applyEyeNlSpm(−γ, isat)` → `applyEyeEnergyCap(e0)`. The difference is the ARCHITECTURE around that step:

| | **medium.js (oracle)** | **medium-u1** |
|---|---|---|
| loop body | ~60 lines inline: kernel/shift/att/sig/virt/reactor drains, mux, coevo-leash, selfClk, τ, coupling | ~15 lines: kernel-swap, shift-drain, reg-drain, mux, one W-step, W-ages, Q-readback |
| the target | `_transPx/_transPy` (scalars) OR `_coevoGx/_coevoGy` (a SEPARATE leash), chosen by `_coevoOn` | `W.leash.state.gx/gy` — ONE path, no branch |
| att rebuild | `_rebuildAtt()` — a closure over `_lensObj/_coevoOn/_attAY/_attRot/_cubeField/…` (~7 deps) | `W.movAtt(gx,gy) = lensC1.apply(Op, ψ_base)` — a pure descriptor op |
| mux | `_muxVirtualStep(k, att, Q)` — W + special-cased "virtual phases" | `_mux.step(k, slots, att)` — a UNIFORM slot array |
| determinism | hunted per-input over months (each drain/cadence a survived fork, documented inline) | the SAME laws, FACTORED (`makeStampedInput`, `syncClockRate`, kernel staging) |

The oracle's loop IS the accumulated laboratory — every drain is a fork it survived. medium-u1's is the same
laws re-expressed as slot behaviors, with the fork-fixes lifted into reusable helpers. **No physics law was
dropped; the orchestration was reorganized and the special-cases (V-as-not-a-slot) were made uniform.**

## coevo (original) vs virtGo (U1) — and why it's PARKED, not lost

This is the sharpest difference, and it is conceptual.

- **`⟲coevo` (oracle, `_coevoLeash`)** is a CLOSED FEEDBACK LOOP between matter and geometry. The leash reads
  the FIELD: `l = ampCorr(field, att)`, learns a slow lock baseline, and advances the target by a step scaled
  by `sig = f(l/baseline)`. If the soliton loses coherence (falls behind), `sig→0` and **the target WAITS for
  matter to catch up.** Its own comment: *"matter tells geometry how far it may go — the Einstein loop at the
  transport level."* The soliton's state gates its target's motion.
- **`virtGo` + descriptor-only `leashAdvance` (U1)** advances `gx/gy` at the full deterministic ≤1px/beat
  rate with NO field read (`sig=1` always). The target moves on a fixed schedule; the pinned soliton follows.

So the movement law changed from **field-gated (coevolutionary)** to **descriptor-only (open-loop)**. This
was the DELIBERATE determinism decision (the `ampCorr(field)` read was a peer-local feedback that forked solH;
removing it made `gx/gy` pure arithmetic → in `regH` → the register decoupled from field determinism).

**It is PARKED, not lost:** `leashAdvance` keeps the field-fed branch dormant (`if (field && corr) …`), ready
for exactly the return described next.

## "If we have ℂ*, why can't the Einstein loop be achieved?" — IT CAN, more honestly

It can — and ℂ* is precisely what makes it honest. The "matter tells geometry how far to go" CONTENT does not
require reading the raw field; it requires a MATTER OBSERVABLE feeding back into the metric. ℂ* supplies one
that is ALREADY deterministic: the **`gain` coordinate** (the amplitude / energy DOF; `logGain = ln r`).

- On the **lensU1 (pinned) slice** `gain ≡ 1`: the soliton has NO amplitude freedom — that is WHY it is
  runaway-proof AND why there is no honest matter back-reaction. Geometry acts on matter; matter cannot act
  back through an amplitude it does not possess.
- On the **lensC1 (unpinned) slice** `gain` is free: the soliton's ENERGY is a first-class REGISTER
  coordinate. `capGain(op, rMax)` is literally the energy cap as an algebra op.

So the honest ℂ* Einstein loop is: **the leash advance gated by the soliton's `gain` (a DESCRIPTOR
observable), not by `ampCorr(field)` (a field read).** `sig = f(logGain)` in place of `sig = f(ampCorr(field,
att))`. The feedback SURVIVES — matter's energy state throttles its own transport — but the sensor moves from
FIELD to DESCRIPTOR, so it stays in `regH` (deterministic, no peer-local read).

**Why the ℂ* version is MORE honest, not just deterministic:** the medium's own conservation law
([[gr-medium-conclusions]] §4) states *"any closed-loop reference that includes the operator's own output
self-fools; only globally-normalized quality observables are honest."* The `ampCorr` coevo loop reads the
operator's OWN product (the pinned field ≈ att) — a partial self-fool. The `gain`-gated loop reads an
INDEPENDENT register coordinate — exactly the honest observable the law demands. So ℂ* does not merely restore
the Einstein loop; it fixes the self-reference flaw the field-fed version carried.

## Where is the honest GR? The "speed of light"?

The medium is honest that there are TWO SECTORS with two different answers ([[gr-medium-conclusions]] §2–3):

1. **Position channel (the operator / metric)** — **NO speed limit.** "Space itself may be commanded at any
   rate" (measured 1148 px/bar at full lock — the metric-evolution / inflation analog). Both `virtGo` and
   `coevo` live HERE. There is no `c` in this channel BY DESIGN: it is coordinate transport, not motion
   THROUGH space. What limits the outcome is memory (the halo law), not speed.
2. **Momentum channel (mobile matter)** — has a SATURATING `v(p)`: `v → v*` as momentum grows (the
   relativistic velocity SHAPE, measured on the bare substrate; band-structured on the native ring kernel).

**So the honest "speed of light" is `v*` in the MOMENTUM sector** — the ceiling a self-propelled soliton
approaches but never exceeds. It is MEASURED, EMERGENT from the medium's dispersion (the ring kernel's band
structure), NOT a hardcoded constant. The vacuum is Schrödinger-class (ω ∝ k², no Lorentz cone), so the
relativistic structure does NOT live in the vacuum — it lives in MATTER (the `v(p)` saturation) and in the
CLOCK layer (per-slot τ, the measured time-dilation).

**Where ℂ* makes GR more honest:** the original moved matter almost ENTIRELY through the POSITION channel (the
operator/metric warp), because a pinned soliton CANNOT self-advect (mobility ⊥ persistence — γ=20 wraps its
phase and won't accept momentum; γ=1 moves but won't bind). That is honest but ONE-SIDED: matter is a passive
rider on commanded space. **ℂ* opens the MOMENTUM channel to the register** — an `unpin`ned soliton has live
amplitude → can carry momentum → has a `v(p)` → approaches `v*`. So the "speed of light" becomes a property
of MATTER'S OWN DYNAMICS, not a metric command. The two-channel law (position: no limit; momentum: `v*`) is
ALREADY the honest GR; ℂ* is what lets a slot actually USE the momentum channel rather than only ride the
position one — which is also what re-enables the honest (gain-gated) Einstein loop above. They are the SAME
unlock: give matter its amplitude DOF back, and both back-reaction and a real velocity ceiling follow.

## The honest caveat (the determinism ↔ liveness trade)

medium-u1's default is the COMPACT / pinned slice (`lensU1`, gain≡1): runaway-proof, register-exact,
byte-deterministic — but with the momentum channel and the matter-back-reaction CLOSED (parked). The
non-compact slice (`lensC1`, unpinned) opens both — the honest `v*`, the gain-gated Einstein loop, genuine
self-modification — at the cost that `apply` is no longer unitary and a worldline can diverge in `r`
(`capGain` bounds it). So the choice is explicit and reversible per slot: **stay pinned for determinism, or
`unpin` a slot to give it momentum + back-reaction + a speed limit.** The physics is not missing; it is a
governance switch (`pin`/`unpin`) the slot architecture makes first-class. See the ℂ*-algebra section above
(lensU1 vs lensC1) and [[gr-medium-conclusions]] (the two-channel law, the mobility wall, `v*`).
