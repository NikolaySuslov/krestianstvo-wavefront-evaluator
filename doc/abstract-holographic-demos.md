# Abstract Holographic Computer — Demos and Thin-App Patterns

Runnable scenes on `medium-u1` (the U1 abstract holographic computer), each exercising a
named claim of `doc/abstract-holographic-computer.md`, plus the thin-app (beat bus)
patterns for building not-rich matter on top of the register. Every demo lists: steps,
what to watch, and which claim it makes refusable.

Conventions: fresh load boots **register-born** (⌀PDE; the mode button reads
`mode:⌀register`); the console API is `mu1.*`; the register strip's slot selector and the
`view:` selector both exist — memory verbs target the *viewed* slot when it is V/P1/P2.

---

## 1. The boot: dressing as the boot animation

**Steps.** Load a fresh world. Do nothing.

**Watch.** The bare symbol (the letter probe) appears immediately and *dresses* over ~8
bars — SPM and the ring kernel sculpt it into the medium's locked profile, live on the
canvas, with zero GPU physics. `[MU1-SEED] REGISTER-BORN` in the console; `[VPT]`
(every 4th bar) reporting H, V, the Casimir I, and İ.

**Claim exercised.** The compile pass is unnecessary: the register engine performs the
dressing that used to be a hidden GPU prologue. The transient is physics, not a timer.

---

## 2. The purity proof

**Steps.** `mu1.pure()` in ⌀register mode. For contrast: press `mode:physics`, run
`mu1.pure()` again, then `mode:⌀register` (the world re-closes; a reload also re-closes
by default).

**Watch.** `GPU physics substeps in 3s: 0` in register mode; a large count in physics
mode. Same canvas, same breathing, different executor.

**Claim.** "The GPU does no physics here" is counted, not asserted. The identical look of
the two modes is the point: one discrete map, two substrates.

---

## 3. The memory scene: two recall semantics, living slots

**Steps.**
1. Let the boot dressing settle. `store` (banks the moment as a plate).
2. Drag `shiftX` a few px — W swims through the medium (wake behind, chase lag).
3. `view:V` → `recall⇄` — the moment is found *shift-invariantly* and **relocated to the
   cue**: V is born living at W's current position.
4. `view:P1` → `recall@` — the same plate lands **at its stored place**: P1 born living
   where the moment originally happened.
5. `mu1.descGo(x, y, 'P1')` — walk the living memory; its pin chases its own leash.

**Watch.** `[MU1-RECALLX] … → V born LIVING` vs `[MU1-RECALL] … → P1 born LIVING`;
`[DET-⌀]` growing `eV=`, `eP1=` hashes; up to four breathing worldlines at once (W driven,
V/P1/P2 resurrected), each with its own β dial in the register strip.

**Claims.** Recall is closure application (the moment resumes computing); the two recall
buttons answer different questions ("bring it here" vs "show me where it was") — both
honest; slots are one type with modes.

---

## 4. Two browsers, one world: join and shard

**Steps.**
1. Open the world in tab A; let it dress. Open the same world in tab B (joins by
   snapshot).
2. In both consoles: compare `[DET-⌀]` lines at equal `solStep` — `regH`, `eH` (and any
   living-slot hashes) must match byte-for-byte from the joiner's first line.
3. Optional regional shard (needs a mirror as the physics witness): press `mirror` in
   both tabs, then tab A: `mu1.region('left')`, tab B: `mu1.region('right')`.

**Watch.** Identical hash columns; under sharding, each tab's GPU integrates only its
half, the other half rendered from the register's declaration; `[MIRROR] … seam-glue=`
per bar — the live gluing defect, which factorizes as interior × state.

**Claims.** Replication is bit-exact through a mid-bar join (the wire-lattice law);
descent rung 2 — two machines carry one world's witness with no new wire, and the seam
defect is the declaration's own, measured.

---

## 5. The forecast theater (the register predicts the medium)

**Steps.** `mu1.elTest()` — a converging chirped probe on the live kernel.
Then watch the standing `[VPT]` line on the resting world.

**Watch.** elTest: the focal call — `t*` and `V_min` predicted from t≈0 register data,
then the measured minimum (live result: time to 1 %, waist to 0.01 % of V₀); Casimir
drift ~0.15 % (the f32 floor). `[VPT]`: `freed: FOCUS/V→0 in N steps` — a dated
counterfactual, refreshed per bar; `re-key ΔI` lines when the clock edits the kernel
(bookkept out of İ, closed-form).

**Claims.** Gate F: the sl(2) Casimir is conserved and *predictive*; kernel edits re-key
the invariant by descriptor arithmetic (rekeyTest pins it to 2 %).

---

## 6. The wear lab (what holding and moving cost)

**Steps.** `mu1.wearTest()` (the arrest curve), `mu1.wearGo()` and
`mu1.wearGo({vpx: 3})` (transport cost at two speeds), `mu1.grip()` (the verdict for the
current β).

**Watch.** İ(β) falling ~4 orders and zero-crossing at β\* ≈ 0.15 (the capture threshold,
in the medium's own invariant); cost columns: shedding below capture (expensive), riding
above it (~linear in speed); the transport log's `grip:⚠` marker if β sits below β\*.

**Claims.** Law 7's two faces: *holding is arrest* (a locked state is stationary in the
invariant — the pin spends nothing on a parked memory), *moving costs only what slips*.

---

## 7. Modular-group play (exact by choice)

**Steps.** Compare integer vs fractional operations on the dot-built symbol:
integer `shiftX` drags (ring-free) vs the fractional spectral attractor (`x𝔸tt` toggle —
watch for hairline ringing on dot content, then toggle back); `mu1.bankScan()` after
moving a stored moment (the dual-pass orbit search).

**Watch.** The clean/ringing contrast is §3.6's thesis made visible: integer translations,
the FFT (the S element), and unit chirps are *arithmetic-subgroup* operations — exact by
choice; generic fractional elements are *continuous-group* operations — physical, with
measured interpolation defects on Brillouin-edge content.

**Claim.** The continuous group is the physics; the arithmetic (modular) subgroup is the
computation.

---

## 8. Thin apps: the beat bus

The register is a **clock-and-phase generator**: every living worldline continuously
produces replicated, bit-identical, physically-textured time signals. A thin app is any
component that consumes *only* these signals — it then inherits the full determinism
contract without owning a field, running physics, or proving anything.

### 8.1 The bus (what a worldline emits)

| signal | source | character |
|---|---|---|
| bar beat | shared step grid (21 steps) | the metronome; the display film grid |
| τ tick | the slot's worldline clock | per-slot proper time — beats can dilate per worldline |
| ∠(t) | descriptor phase + ω precession | a continuous replicated phase (an LFO with a physical worldline behind it) |
| Ω breathing | the q register's derived frequency | the medium's own breathing rate, kernel-dependent |
| re-key event | kernelVer moves (the fractal clock) | structured aperiodic accents — the clock's own rhythm |
| İ, lock, charges | the [VPT] tier | slow expressive envelopes (maintenance effort, grip) |

All are pure functions of shared state — the bus needs no new replication machinery.

### 8.2 The one rule for thin matter

**Read beats, never frames.** A thin app may sample the bus at its own render moments for
*display interpolation* (the observer's private sampling — outside the contract), but any
state it *keeps* must advance only on bus events. This is the naturality law's easiest
clause, and it is sufficient: a sprite animator, a sequencer, a geometry morpher driven
this way is deterministic across peers by construction.

### 8.3 Patterns with measured precedents

- **Sound from the time schedule.** The project's finding: sound lives in the per-step dt
  schedule (phase-rate demodulation), not in space — a synth voiced by bar beats, ∠(t) as
  slow pitch/phase, re-keys as accents, and Ω as tremolo is a direct port of the
  clock-modulated-sound result onto the bus, with the register (not a scratch field) as
  the source.
- **Geometry as limit-cycle phase.** The one-world finding: modalities coexist by
  *temporal* multiplexing on shared matter (measured exact at fidelity 1.000), not by
  owning scratch fields. Thin geometry binds its parameters to ∠(t) and τ of a chosen
  worldline — a shape that breathes with a memory, stiffens with its β, accents on the
  clock's re-keys.
- **Many thin apps, one rich worldline.** The economics: a living slot costs ~3 ms/step;
  a bus consumer costs nothing measurable. One register worldline can clock an arbitrary
  population of thin apps — the *self-hosting matter* pattern: rich matter generates the
  time that poor matter lives in. In ⌀PDE the source itself is GPU-free, snapshot-
  joinable, and byte-verified, so the whole tower — one physical metronome plus its
  population — replicates as a unit.

### 8.4 What a thin app must not do

Read a field buffer, sample a frame time into kept state, resolve a slot at drain time,
or invent local randomness. Each prohibition is one of the machine's measured fork
classes; the bus exists so that thin authors never meet them.

---

## 9. Instrument tour (five minutes, every major claim)

```
mu1.pure()        → 0 GPU substeps           (the executor)
mu1.defTest()     → door/state/composite      (the adjunction's factorization)
mu1.coverTest()   → max|Δ|=0 cocycle          (descent, on the live field)
mu1.elTest()      → waist + Casimir           (gate F on the live kernel)
mu1.rekeyTest()   → ΔV̈ ratio ≈ 1.000          (the clock's edits, predicted)
mu1.wearTest()    → the arrest curve          (Law 7, face one)
mu1.wearGo()      → the cost columns          (Law 7, face two)
mu1.bankScan()    → moved moments found       (holography's shift invariance)
mirror + lock→A   → the standing oracle       (the register's evolution law)
[DET-⌀] hashes    → the whole contract        (naturality, forever)
```
