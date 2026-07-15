# The H-Computer

**Registers, couplings, and computation in the KWE medium — statements, conclusions, and runnable protocols.**

This document records the register-machine program conducted live on the `medium` app
(2026-07-04 … 2026-07-05, runs 18–27 plus the foundations they stand on). It is written
to be **read and repeated**: every claim carries the run that produced it, and every
experiment carries the exact console protocol. Nothing is simplified; where a result was
first misread and later corrected, both the misreading and the correction are recorded,
because the corrections carried most of the discoveries.

All experiments run in the browser console of the `medium` app (`public/apps/medium.js`),
drive mode **transport** (or objorbit), on a Croquet-replicated world. Every verb is a
stamped replicated event — all peers compute byte-identical physics; every readout is
peer-local and reads the shared field, so all peers see identical numbers.

---

## 0. Contents

1. Foundations — what the machine is made of
2. The instruction set (verbs) and the instruments
3. Machine constants — the spec sheet, with provenance
4. The computation runs, in order (18–27): protocols, data, verdicts
5. The laws
6. Operating procedure and hygiene checklist
7. M-f — the recall program (perception as relaxation), full protocol
8. Provenance and prior theorems

---

## 1. Foundations

### 1.1 The theorem: field = processor, not RAM

Three experiment ladders (phase textures M-a, k-space crystal M-c1, breathing M-c1′)
established, by exhaustive elimination:

- **Field-side memory relaxes to the drive's reference.** Amplitude structure is washed
  by the gain/cap (enzyme wash); spatial phase structure disperses sub-bar at every
  resolvable k; the k=0 global phase is re-locked to the operator (att) within ~1 bar —
  the drive acts as a **local oscillator**.
- **Field phase has no frame of its own.** A probe mode at k=(8,0) — eight cycles away
  from the object's spectrum — *followed a register write on the operator* in real time
  (shifted by +0.5 rad when `attPhase(0.5,'W')` was stamped). Every Fourier mode of the
  field sits in the operator's phase frame. Injection locking through the nonlinearity is
  total.
- **The medium owns a timescale, not a time.** The lock-ripple carries a coherent
  subharmonic cycle (42 steps = 6×Q7 non-mux; re-commensurating to 63 = 3×21-proper under
  mux — same τ ≈ 40–60 proper-step band). It is a resonance (injection-locked divider),
  not an oscillator: it re-locks when the forcing changes instead of keeping its period.

Consequences: **persistent state lives in the operator layer** (att phases, plates),
the field is the processor that binds them, and time is the operator's (the founding
KWE fractal-clock premise, rediscovered by measurement).

### 1.2 The register: an operator U(1) phase

- **Write** — `attPhase(α, slot)`: rotates the target operator's phase by α (stamped
  verb, additive: U(1) writes compose; erase = inverse write; clamp ±π per write).
  For W the rotation is applied inside the att rebuild (`_attPhase`), so every rebuild
  carries it; for V/P1/P2 it is a one-time rotation of the stored att (f32-requantized
  for snapshot parity).
- **Retention** — the same phase-lock that *erases* field-side writes *holds*
  operator-side ones: the drive re-locks the field to the rotated reference within
  ~1 bar and keeps it there. Verified: writes compose (0.6 then 0.3 reads 0.9), a 2π
  round trip returns to identity, values held ±0.02 rad over 13,000 steps, two config
  toggles, and ~200 mux rotations.
- **Read** — `regRead()`: the absolute k=0 readout, `arg Σψ` per live slot,
  vector-averaged over 32 frames. Translation-invariant on the torus (Σψ is exactly
  invariant under displacement — the soliton can transport, the register reads the
  same), whole-field-weighted, needs **no reference phase** (the grid is the reference).
  Works with no virtual machinery at all: W's register is complete in plain transport.
- **Write fidelity is unity.** ΔW = +0.504 for a 0.5 write (absolute readout). The
  earlier "retention factors" r = 0.81/0.91/0.92 measured by the differential
  (bind-vs-V) protocol were **reference-side artifacts** — V's weak hold lock wandering
  was billed to W's register. Lesson: never fuse register and reference in one number.

### 1.3 The slots and the pinning hierarchy

| slot | matter | pinning (h) | notes |
|---|---|---|---|
| W | the driven world soliton | **strong** (full transport β) | exists in any soliton drive; the anchor |
| V | ⎙virt record | weak (hold-β) | the noisier register; also the classic differential reference |
| P1, P2 | booted bank plates | weak (hold at boot att) | boot does not consume the plate — `virtBoot(0)` twice gives two identical lifts; two stores give two distinct memories |

The pinning magnitudes are **not equal** (W ≫ holds) and the pinning *directions* are
the atts' construction phases plus any accumulated `attPhase` rotations —
**references are program state** (see hygiene, §6).

**What the pin physically is** — the pin operation is `applyEyeSuperpose(β)` = the GPU
shader `ψ ← ψ + β·obj` followed by the energy-cap renormalize. Written as amplitude·e^{iθ},
adding the reference obj (phase θ_plate) and renormalizing rotates the soliton's phase by
≈(βB/A)·sin(θ_plate − θ) per step. That is **optical injection locking** — a phase-locked
loop at the scale of the whole soliton: the stored plate is a local oscillator, and the
live phase is continuously dragged onto it. The `h·sin(θ − θ_plate)` restoring torque used
throughout this document is not coded — it *falls out* of `ψ += β·obj` + renormalize (honest,
not a trick). β (= `_TRANSPORT_BETA · refAmp`, the `refAmp` dial) is the **lock stiffness**;
β = 0 (`refAmp 0`) removes the reference entirely → a free-running oscillator with only the
neighbour coupling acting (a pure Kuramoto/XY node, free absolute phase). The same primitive
serves chase (obj = a *moving* target), hold/pin (obj = a *stationary* plate), and mirror
(obj = W's live att) — pin is the stationary case. Note the documented **β < 0.1 shatter
floor is a lock-bandwidth limit on the CHASE** (tracking a moving target), **not** a survival
limit: a stationary held slot at β = 0 stays alive on stepEyeN + SPM(γ=20) + energy-cap alone
(the cap+SPM is a complete self-trapping sustain). See Law 9 for the register's PLL behaviour.

### 1.4 The scheduler

- `virtMux()` — the N-way clock (W + V + booted phases time-share the one substrate;
  each runs at 1/N proper rate). **Mandatory for coupling physics** (edges act at slice
  boundaries) and for booted phases to step at all.
  - **The step clock runs in matter proper-time.** The soliton's step target is driven by
    the shared world clock: `target = floor((Δclock)·19 / N)` — divided by the slot count N.
    Off mux (N=1) this is the plain wall-clocked target; under mux it advances at 1/N, matching
    the demand to what the time-shared substrate can execute (each mux step also costs ~N× the
    GPU work). Without the ÷N the wall-clock demands N× more steps than the frame can run → the
    backlog compounds unbounded (the step cap binds, the world lags and never catches up — the
    measured transport+virt stall). N is replicated state, so the divided target stays a pure
    function of the shared clock → byte-identical across peers; a change in N (record/boot/kill)
    re-anchors the clock so the new rate applies forward with no discontinuity. This is the
    §7.44 principle — *geometry keeps world time; the mux slices matter's proper time* — made
    into the step clock: N solitons on one substrate means each advances N× slower in world time.
- `selfClock()` — M-c2: the mux rotates on **beats of the lock-ℓ ripple** (upward
  crossings of a per-slot EMA baseline) instead of ⌊k/21⌋; k-counter watchdog forces a
  rotation after 168 beat-less steps. Beat commutation switches at coherence peaks:
  measurably gentler on the references, and it removes the beat between the 21-step
  slicing and the medium's τ-cycle that the k-counter gate introduces.

### 1.5 The coupling: `edge(a, b, κ)`

Signed, symmetric, per-pair field-level coupling — the validated leak generalized:

- At every shared Q=7 boundary the **loaded** slot receives `Σ_j κ[i][j]·ψ_j` from the
  other slots' **slice-end states** (sources captured only at k-derived mux transitions;
  the frame-end park is peer-local and would fork). The energy cap renormalizes the
  addition. Mux-only clock physics.
- κ ∈ [−0.2, +0.2]. κ>0 aligns phases (ferromagnetic), κ<0 anti-aligns
  (antiferromagnetic / frustrating), κ=0 removes the edge.
- Lineage: the single W→V leak was validated first (runs 17a/b): coupling **absent when
  undeclared** (κ_phase ≤ 0.04 rad/rad — a register write on W left V's trace flat),
  **causal** (onset at the toggle window), **directional** (as declared), **proportional**
  (equilibrium shift ≈ 2× for 2× the dial), **reversible** (V home in one window at κ=0).
  "Worlds interact through declared physics", operationally.

Coupling mechanism detail that matters for computing: `edge` adds *fields*, not phase
torques. `ψᵢ += κψⱼ` reinforces amplitude fully only at exact alignment (κ>0) or exact
anti-alignment (κ<0); intermediate angles partially cancel and the cap renormalizes the
loss. This *suggests* a collinear ({0, π}) preference — see run 25 for how that
hypothesis fared.

---

## 2. The instruction set and the instruments

Console verbs (all stamped/replicated unless marked read-only):

| verb | role |
|---|---|
| `attPhase(α, slot)` | register write (U(1), additive; slot 'W' default, 'V', 'P1', 'P2') |
| `regRead(frames=32, reps=1)` | **read-only.** absolute register read; reps>1 = drift meter (per-slot linear fit of unwrapped θ, rad/kstep) |
| `edge(a, b, κ)` | program a coupling edge (signed, symmetric; 0 removes) |
| `⎙virt` (UI) | record: V = lifted copy of W (the cue-maker) |
| `virtHold()` | V driven toward its recorded att (V becomes a pinned register) |
| `virtMux()` | the N-way clock (required for edges and booted phases) |
| `selfClock()` | beat-gated scheduler (recommended over the k-counter) |
| `virtStore()` | bank a plate of the current W (memory write to the bank) |
| `virtBoot(slot)` | lift bank plate into P1/P2 (plate not consumed) |
| `virtRecall()` | CPU recall: lock-sweep cue⊗bank, argmax lifted into V; logs the scores |
| `virtLeak(κ)` | legacy one-way W→V coupling (validated; superseded by `edge` for graphs) |

Lab instruments (read-only, peer-local):
`texWatch(bars, slot)` (bind-demod / Θ-meter), `clockWatch(n)` (single-k crystal probe),
`breathWatch(n)` (amplitude/lock autocorrelation), and the `regRead` drift meter.

### How to read `regRead` output

```
[REGREAD] 12/24 · W: θ=2.030 ±0.019 · V: θ=2.042 ±0.026 · W−V=-0.012 · step=6573
[REGREAD] drift W: 0.0079 rad/kstep over 3808 steps
```

- θ per slot = absolute register value (includes the object's constant construction
  phase — **differences across slots or across time are the content**).
- ± = circular spread within the 32-frame window (healthy: 0.005–0.03; a slot showing
  ±0.3+ is mid-transit or degraded).
- Sign flips of a difference between +3.1 and −3.1 are the ±π wrap of a value sitting
  at anti-phase — not motion.
- **drift** = the state diagnostic: ≈0.02 rad/kstep = locked (the ω-bias floor);
  0.2–0.8 = running node (phase slips) or rigid collective rotation (all slots equal);
  the drift column also identifies *which* registers a reprogramming moved.

---

## 3. Machine constants (spec sheet)

| constant | value | provenance |
|---|---|---|
| register write fidelity | ≈ 1.00 (absolute readout) | run 14 (+0.536/−0.482 cycle), run 13 (ΔW=+0.504) |
| write latency | ~1 bar (≈2× under mux — half proper rate) | runs 4-era lock time; run 16 relock ~5 windows |
| read noise | σ ≈ 0.02–0.03 per 32-frame window | runs 13–15 |
| capacity per register | ~40 distinguishable symbols at 6σ ≈ 5.4 bits | from σ; averaging buys more |
| retention | ±0.02 rad over 13k steps, config changes included | run 15 session |
| slice-transition phase cost | ≤ 0.5 mrad/transition, consistent with 0 | run 15 (A/B/C drift scan, 115 rotations) |
| cross-register coupling, undeclared | ≤ 0.04 rad/rad, consistent with 0 | run 16 |
| depinning (single weak node) | total conflicting load between 0.18 (slips) and 0.09×2 (locks) — bracket **0.09 < h_c < 0.15** per-node load | runs 19/20 |
| per-node load budget (static instances) | Σ\|κ\| ≤ ~0.12–0.15 for weak slots | runs 20–22 statics vs 25–26 dynamics |
| κ clamp | ±0.2 (model) | hologram_world.js |
| observed slip rate (over-driven node) | ~2.0 rad/kstep | run 19 |
| observed rigid-rotation rate (collinear + pinning-unstable pair) | ~0.23 rad/kstep, all slots equal | run 20 |
| medium τ-band (relaxation cycle) | 40–60 proper steps (42 = 6×7 non-mux; 63 = 3×21 mux) | breathWatch runs |

**Caveat on brackets**: the static-load budget was measured on instances with discrete
optima. It does **not** transfer to frustrated continuously-degenerate instances
(runs 25–26) — see Law 2.

---

## 4. The computation runs

Setup stack used throughout (fresh world):

```
drive: transport, target parked, soliton settled
⎙virt → virtHold() → virtMux() → selfClock()
virtStore() → virtBoot(0) [→ virtBoot(0) again for P2, same plate; or store twice for distinct plates]
regRead()          ← baseline / health audit
```

### Run 18 — the frustrated triangle (first computation)

**Instance**: W, V, P1; all three edges AF.

```
regRead()                       ← baseline: three θ's near-equal (common construction phase)
edge('W','V', -0.15)
edge('W','P1', -0.15)
edge('V','P1', -0.15)
regRead(32, 24)
```

**Data**: three acts — SEARCH (windows 1–15: hopping between configurations, σ up to 1.2),
SETTLEMENT (window 16+): W−V ≈ 2.91, W−P1 ≈ 3.05, V−P1 ≈ 0.13
(cos = −0.97 / −1.00 / +0.99), then residual stress: the unsatisfied V−P1 edge visibly
"gnaws" (late excursions; ±π wrap flickers on W−P1).

**Verdict**: the machine relaxed to **two-aligned-one-opposed** — *not* the free-XY 120°
splay (Σcos −1.5) but Σcos ≈ −0.98. This is the **correct ground state of the actual
Hamiltonian**: the three hold references all point at a common phase — a local field
uniform in *direction* (magnitudes were never equal: W's transport β ≫ the holds, which
is why W stayed and V/P1 flipped; see Law 6) — and an AF triangle in such a field
prefers the aligned-pair state (the collinear state has |Σe^{iθ}| = 1 and harvests the
field −h; the splay is zero-sum and harvests nothing; collinear wins when the harvest
exceeds the splay's edge-energy advantage, h > κ′/2). **The machine solves the problem
as programmed, not as imagined — pinning fields are part of every program.**
(Run 28 later completes this: ablate one node's *effective* pinning magnitude and the
same instance yields the splay.)

### Run 19 — pre-splayed references (the limit-cycle regime)

**Intent**: make the pinning agree with the 120° splay.

```
attPhase(2.094, 'V')
attPhase(-2.094, 'P1')
regRead(32, 24)          (κ still −0.15 everywhere)
```

**Data**: energy improved (−0.98 → −1.37 best window; W−V = −2.103 ≈ the splay to three
decimals) **but V RUNS**: drift 2.0 rad/kstep — a full 2π sweep visible across windows
5–15. A **phase-slip limit cycle**: V's hold pinning is below the depinning threshold
against 2×0.15 of edge pull. The whole pattern is quasi-rigid but displaced ~2 rad and
slowly turning (edges overwhelm pinning at this κ).

**Conclusions**: (i) the machine has **fixed-point and limit-cycle attractors**;
(ii) `regRead`'s drift column distinguishes them (≈0 = locked answer; ≫0 = running node);
(iii) the **operating envelope** exists: couplings must stay below the weakest node's
depinning threshold or that node runs.

### Run 20 — clean reload, κ = −0.09 (MAXCUT(K₃) solved; reproducibility)

**Instance**: same AF triangle, κ = −0.09, on a **fresh world** (uniform refs by
construction, no attPhase history).

```
(fresh world, setup stack)
edge('W','V', -0.09) · edge('W','P1', -0.09) · edge('V','P1', -0.09)
regRead(32, 24)
```

**Data**: internal configuration locked at machine precision —
W−V = 3.139, V−P1 = 3.121, W−P1 = −0.023 (cos −1.000 / −1.000 / +1.000, σ down to 0.007).
Partition **{W,P1 | V}**: 2 of 3 edges cut = **optimal MAXCUT(K₃), exact**.
All three drifts identical (+0.23 rad/kstep): the pattern rotates **rigidly** while the
differences (the answer) stay exact.

**Conclusions**:
- **Reproducibility**: defined start → programmed instance → exact answer. Slips gone at
  0.09 (bracket 0.09 < h_c < 0.15).
- **Ising-like discretization observed on a clean world** — exact {0, π} locks with
  nothing pointing there. (Correctly qualified later: see run 25 — this is a *landscape*
  property; and note the triangle *cannot* discriminate hardware- from pinning-Ising,
  because its collinear state harvests the uniform field while the splay is field-blind.)
- **Degeneracy branch is initial-condition-seeded** (boot transients pre-displace nodes;
  the relaxation sharpens the pre-existing split). Per-world deterministic: every peer
  reads the same branch.
- **Intrinsic rotating ground state**: the rigid rotation is *not* reference torque
  (refs were uniform); the flipped pair sits at the pinning-unstable point (π = pinning
  energy maximum), so the pattern slides, averaging their pinning cost. The answer lives
  in differences and is immune.

### Runs 21–22 — four nodes: instances A and B (the ISA demonstrated)

**Setup**: boot P2 (`virtBoot(0)` again — same plate twice = symmetric start).
Four slots on the clock (each at 1/4 proper rate — allow ~2× wall time; use
`regRead(32, 32)`).

**Instance A — satisfiable AF 4-cycle** (bipartite, zero frustration):

```
regRead(32, 32)            ← arm FIRST (catch the search)
edge('W','V', -0.09)
edge('V','P1', -0.09)
edge('P1','P2', -0.09)
edge('P2','W', -0.09)      ← NO diagonals
```

Result: **{W,P1 | V,P2}**, all four edges cut, Σcos ≈ −3.99 — exact. Stamping edges
one at a time mid-read shows **constraint-by-constraint assembly** (each edge arrival
visibly reorganizes the state).

**Persistence**: A's answer stood for ~20,000 idle steps at σ ±0.001–0.005 before B —
**a computed answer is durable world state** (output = memory; no store step).

**Instance B — mixed signs, live reprogramming** (re-stamp the same edges):

```
regRead(32, 32)
edge('W','V', +0.09)       ← ferro now
edge('V','P1', -0.09)
edge('P1','P2', +0.09)
edge('P2','W', -0.09)
```

Result: **{W,V | P1,P2}**, all four edges satisfied at cos = ±1.000, reached from A's
answer by **exactly the two required π-flips** (P1 flips at window 17, caught mid-transit
with σ = 1.11; V at windows 19–21). The drift column identifies the movers
(V −0.61, P1 +0.67 rad/kstep vs spectators ≈ 0.02) — **a which-bits-changed register**.

### Run 23 — the accidental satisfiable K₄ (the parity rule)

Two AF diagonals (−0.06) were added on top of B's mixed cycle. **Parity check**: a cycle
is frustrated iff it has an odd number of negative edges — every triangle of this graph
came out even → fully satisfiable, and B's answer was already its exact ground state.
The machine correctly did not move: all six edges read satisfied at cos = ±1.000
(σ ±0.000–0.005, the tightest windows of the program).

**New ISA property**: **consistent constraint addition is non-disruptive** — instances
grow monotonically without re-solving the already-consistent part.

### Run 24 — all-AF K₄, first attempt (the continuous manifold)

The four cycle edges re-stamped −0.06 (diagonals already −0.06): every triangle now odd —
maximal frustration.

**Prediction** (half right): partition holds; W−V and P1−P2 gnaw; Σcos ≈ −2.

**Data**: Act 1 ✓ — the gnaw appeared exactly on W−V (stress ≈ 0.25, windows 17–24),
partition held. Act 2 ✗ — P1 then walked away (W−P1: π → 1.8), the system left the −2
optimum and ended mid-transit at Σcos ≈ −1.1, still moving.

**Two discoveries**:
1. **AF K₄'s ground state is a continuous manifold**: Σ_pairs cos = (|Σe^{iθ}|² − 4)/2,
   so *every* zero-phasor-sum configuration has Σcos = −2 — collinear 2+2, the symmetric
   cross, every rhombus. No discrete protection.
2. The walk was steered by **leftover reference rotations** (run 19's ±2.094 on V/P1,
   never undone). On a flat valley, pinning inhomogeneity is the only force.
   **Hygiene law: reference rotations are program state; audit and clear them between
   instances.**

Also derived here: the **uniform-field blindness theorem** — on the zero-sum manifold,
Σ h·cos(θᵢ−ref) = h·Re(e^{−iref}·Σe^{iθ}) ≡ 0 for equal h; only *unequal* magnitudes
(W ≫ holds) or unequal directions lift the degeneracy.

### Run 25 — the discriminator (fresh world, κ = −0.06): hardware vs landscape

**Question**: is the Ising (collinear) behavior hardware (the field-coupling argument)
or landscape (discrete optima + pinning harvest)?

```
(fresh world, full stack, P1 AND P2 booted)
regRead(32, 48)            ← arm first
edge all six pairs at -0.06
```

**Data, three acts**: assembly → the system **visits the collinear 2+2**
({W,P1 | V,P2}, windows 14–21, Σcos reaching ≈ −1.5) → **and leaves it** →
sustained **structured running**: W static (drift 0.014 — the strong pinning froze it),
V/P1/P2 running at three *different* rates (0.71 / 0.41 / 0.25 rad/kstep —
incommensurate), energy hovering ≈ −1.1 off-manifold.

**Verdicts**:
- **Hardware-Ising disfavored**: collinear was occupied and abandoned — its best chance
  to lock, declined. **Ising-nativity is a landscape property.**
- "XY on continuous" confirmed in strong form: flat manifold + frustration + weak
  pinning yields **motion, not marginality**. Per-node load 3×0.06 = 0.18 exceeded the
  weak nodes' static bracket with *conflicting* pulls: the K₄ reduced to a frustrated
  triangle of weak nodes dancing around the frozen W.

### Run 26 — the κ = −0.04 anneal (the machine law)

Lowering the drive on the live running state (an annealing quench; per-node load
0.12, inside the static bracket):

```
regRead(32, 48)            ← arm first
edge all six pairs at -0.04
```

**Data**: still no condensation in 10k steps — now **all four nodes run**
(W +0.49, V +0.31, P1 +0.80, P2 −0.40 rad/kstep: four incommensurate rates, two
directions; even W entrained, which had held at 0.18 load). Intermittent partial
pairings (W–V co-rotate for ~10 windows, then break). Fully turbulent.

**The machine law is engraved** (see Law 2). Footnote, honestly unresolved: weaker κ
being *more* turbulent is either an order-threshold effect (−0.06 organized what −0.04
cannot) or hysteresis from the 66k intervening steps.

### Run 27 — edges → 0 (the wear finding)

**Prediction**: with the graph removed, drifts collapse to the ω-bias floor and each
node falls back to its reference.

```
edge all six pairs to 0
regRead(32, 12)
```

**Data — prediction falsified**: all four nodes still run (W 0.29, V 0.31,
**P1 2.83** — a hard slip with no edges to blame, P2 0.49); σ up to 1.3; V barely
coherent within a window; W only pseudo-settled ~1 rad off its reference.

**The finding: the register file has WEAR.** ~130k steps ending in two turbulent regimes
degraded the *matter* carrying the registers: P1's field no longer overlaps its att
enough for capture (the run-19 slip mechanism, now edge-free), V spread/churning, W's
k=0 read polluted by accumulated halo. The registers are an abstraction on living
solitons; prolonged frustrated driving erodes the abstraction, **and the damage outlives
the program**. Re-initialization (fresh records/boots or a clean reload) is a real step
of the operating cycle. Diagnostic to localize wear (optional): fresh `⎙virt` re-record →
`regRead(32,6)`; fresh-V-tight + P1/P2-wild = matter degraded; fresh-V-wobbly =
substrate ringing.

### Run 28 — the pinning-ablated triangle (Law 3 by demonstration)

A re-run of the run-18 instance (K₃, all edges −0.15) on a world where the **baseline
audit failed**: V entered degraded (σ = 0.827 within one window, field displaced 2.1 rad
from the common phase), while W and P1 were healthy.

**Precision — what actually changed vs run 18**: not the reference *direction* (the
stored att is program state, moved only by `attPhase`; no rotations were applied) but
the **effective pinning magnitude**: the hold superposes the att into V's field each
step, and a churned, barely-overlapping field cannot be captured by that injection —
h_V → ~0 with the reference direction intact. The actual Hamiltonian therefore had
h_W strong, h_P1 weak, h_V ≈ 0: with the harvest gutted, the splay's edge-energy
advantage (−1.5 vs −1) finally outweighed it. **Effective pinning magnitudes depend on
matter health, not just on programmed references** — the doctrine "the machine solves
the actual Hamiltonian" includes the matter's condition in "actual".
(Caveat: reference direction is inferred from `attPhase` history; the trace reads
fields, not atts — the certain part is the field degradation.)

**Result**: the machine settled a **distorted 120° splay** — W−V ≈ 2.20,
W−P1 ≈ −1.68, V−P1 ≈ 2.41 (closure: 2.20 + 2.41 ≡ −1.67 ✓), **Σcos ≈ −1.43** vs the
ideal splay's −1.5 — and *not* run 18's Ising state (−0.98). Quasi-static (drifts
0.02–0.10, P1 breathing ±0.3). The splay signature: **all three cosines negative**
(−0.59, −0.11, −0.74) — no pair aligned, frustration shared by all edges, which binary
states cannot do. Why not exactly −1.5: only V's pinning was ablated; W and P1 still
harvested theirs, tugging and distorting the splay — the true optimum of *that*
Hamiltonian lies between −1.43 and −1.5, so the machine was at or near its own ground
state, not the textbook pure-edge one. (As a MAXCUT answer this run "fails" only in
the certificate sense: nothing thresholds to {0, π}.)

**Conclusion (as first read)**: same instance, same κ — healthy pinning → Ising state;
one node's pinning ablated by wear → near-XY splay: Law 3 by ablation.

**⚠ Interpretation contested by run 29.** Run 18 ran WITHOUT `selfClock` (mux + hold,
k-counter gate); run 28 ran on the full stack (beat gate presumed on). Run 29 —
the same instance, clock OFF as in 18 — reproduced the Ising state *despite an equally
noisy baseline* (V σ = 1.15). Two candidate causes for run 28's splay now stand:
(a) V's effective pinning ablated by matter degradation, (b) **the scheduler**:
beat-gated slices are longer and state-dependent — in a frustrated state a slot whose
att-lock is broken never beats, rotation falls to the 168-step watchdog, and coupling
sources go up to 8× staler than under the 21-step k-counter. Stale sources lag moving
targets and can stabilize different attractors: **κ is per-injection, but the schedule
shapes the effective coupling — the scheduler is part of the Hamiltonian.**
Discriminator (queued): one healthy world, triangle solved twice, toggling ONLY
`selfClock` between solves. Hygiene refinement: a one-shot `regRead()` immediately
after boot reads boot *transient*, not health — audit with `regRead(32,3)` after a
settle pause.

**RESOLVED (2026-07-07) — selfClock ≡ counter, after the proper-time-metric closure.**
The discriminator was run cleanly (fresh reload per arm; both baselines V/P1 σ=0.000
locked, W in normal gauge-run). Arm 1 (counter) and Arm 2 (selfClock) produced the
**identical answer**: V−P1 ≲ 0.02 aligned (cos ≈ +1) across all 24 windows in both,
W−V ≈ W−P1 every window (W equidistant from the aligned pair, gauge-wandering per
Law 5) = the {W,P1 | V} partition in both. So candidate (b) — the scheduler shaping
effective coupling via source staleness — was **removed by the proper-time metric**
(`doc/proper-time-metric.md`, gates 1–3): geometry now advances on the medium's own τ,
so slice length no longer changes effective κ. The scheduler LEFT the Hamiltonian; the
frustrated triangle is scheduler-invariant by construction. Run 28's splay was therefore
candidate (a), effective-pinning ablation (matter health), not the scheduler.
Method note that ended a long confusion: **W's absolute-phase wander at baseline is the
gauge mode (Law 5), NOT a health failure** — the doc's clean answers (runs 18/20/28/29)
all came from exactly such noisy-W baselines. The audit that matters is whether the
*differences* lock after edges, not whether W's absolute σ is small before them.

### Run 29 — replication of run 18 under original conditions (clock OFF)

Same instance (K₃ ×−0.15), mux + hold, **no selfClock** — matching run 18's actual
configuration.

```
(setup WITHOUT selfClock)
edge('W','V', -0.15) · edge('W','P1', -0.15) · edge('V','P1', -0.15)
regRead(32, 24)
```

**Result**: **{W | V, P1}** — V−P1 = −0.013…−0.066 (aligned), W−V → π (wrap at the
final window), W−P1 → 3.08; Σcos ≈ −0.98…−1.0. **Exact replication of run 18**: same
partition, same odd node, same energy, with the full W transit to anti-phase visible.
Baseline was noisy (V σ = 1.15, P1 σ = 0.72 — post-boot transient) and the Ising state
emerged regardless — which is what contests run 28's ablation reading above.

---

## 4b. How an answer is verified (the certificate)

"Solved" is not a statement of trust in the dynamics — it is a machine-independent
check on the read numbers. Two problems live on every graph: the **binary/Ising**
instance (MAXCUT-type) and the **continuous/XY** instance. The certificate differs:

**Binary (MAXCUT) certificate** — valid only if every pairwise Δθ thresholds cleanly
to {0, π} (residuals ≲ 0.1 rad; the solved runs give *millirads*):
1. classify each pair aligned/anti → extract the partition;
2. count cut (anti) edges; compare with the combinatorial optimum, proved without the
   machine (triangle: odd cycle ⟹ max cut = 2; bipartite 4-cycle: 4; all-even-parity
   graphs: all edges);
3. cross-check the energy identity Σcos = E_uncut − E_cut = (#edges) − 2·(cut count).
   Run 20: 3 − 2·2 = −1 predicted; −1.000 measured.

**Continuous (XY) reading** — when phases do NOT threshold to binary, there is no
MAXCUT certificate; the output is an XY configuration, judged by Σcos against the XY
optimum (triangle splay: 3·cos(2π/3) = −1.5; measured −1.43 in run 28, with pairwise
differences averaging ≈ 2.1 ≈ 2π/3). Note Σcos below the binary optimum (−1.43 < −1)
does not mean "better than MAXCUT" — continuous relaxation lowers the edge energy by
leaving the binary domain, which invalidates the binary certificate.

**Which answer the machine returns is selected by the pinning term** (Law 3): collinear
states harvest the uniform field (|Σe^{iθ}| = 1 → −h), the splay is field-blind (0);
collinear wins when h > κ′/2. The 120° splay is therefore not absent from the solved
runs — it is outcompeted, and it appears, measured, exactly when the pinning is weak
or misaligned (runs 19, 28: W−V = −2.103 ≈ −2π/3 to 0.01).

---

## 5. The laws

1. **Discrete-optimum law.** Instances whose ground states are discrete (satisfiable
   graphs; frustrated graphs with discrete optima such as the AF triangle in a uniform
   field) are solved **exactly and statically**: cos = ±1.000 to three decimals,
   reproducible from a defined initial state. Score: 5/5
   (K₃ ×2, AF 4-cycle, mixed 4-cycle, satisfiable K₄).

2. **Frustrated-degeneracy law.** Instances that are frustrated **and** continuously
   degenerate (all-AF K₄: the zero-phasor-sum manifold) have **no static answer at any
   admissible κ**. The machine's response is sustained multi-rate dynamics:
   *structured* at stronger coupling (the strongest-pinned node freezes; the rest orbit
   incommensurately), *turbulent* at weaker coupling (all nodes run, mixed directions,
   transient pairings). The static load bracket does not transfer — on a flat frustrated
   manifold no configuration has zero residual torque.

3. **Ising-nativity is a landscape property, not hardware.** The {0, π} discretization
   appears when the landscape has discrete attractors and/or the pinning harvest favors
   collinear states; on the flat K₄ manifold, collinear was visited and abandoned
   (run 25), and on the triangle itself the answer flipped between the Ising state
   (Σcos −0.98; runs 18, 29) and the near-XY splay (−1.43; run 28) — same graph, same κ.
   Which variable selected the answer is under test (run 28 ⚠): candidate (a) one node's
   effective pinning ablated by matter degradation, candidate (b) the scheduler
   (beat-gate source staleness). Either way the selection is not the coupling hardware. Corollary: the triangle cannot discriminate the two hypotheses (its
   collinear state harvests the uniform field, |Σe^{iθ}| = 1; the splay is blind);
   only zero-sum-vs-zero-sum comparisons (K₄) can.

4. **Parity rule.** A cycle is frustrated iff it carries an odd number of negative
   edges. All-even graphs are satisfiable and gauge-equivalent to ferromagnetic;
   the machine solves them exactly (and, per run 23, does not stir when consistent
   constraints are added to a satisfied instance).

5. **Gauge law.** The answer lives in phase *differences*; the collective phase may
   rotate (rigidly, at ~0.23 rad/kstep in run 20) without touching it. Absolute values
   matter only as the reference/pinning audit.

6. **Blindness theorem and its two loopholes.** A uniform equal-magnitude field is
   exactly blind on the zero-sum manifold. The loopholes: unequal magnitudes
   (W ≫ holds — favors configurations parking strong nodes on-reference) and unequal
   directions (leftover `attPhase` rotations). Both are part of every program whether
   declared or not.

7. **Wear law.** Sustained turbulent regimes degrade the matter carrying the registers;
   the degradation persists after the program is removed. Budget the duty cycle of
   pathological instances; re-initialize after them; treat the pre-instance `regRead()`
   audit as a health check (window σ > ~0.1 on a supposedly idle slot = degraded).

8. **Ambiguity theorem (for perception, M-f).** Frustration the machine cannot
   discharge into a discrete optimum does not freeze into compromise — it oscillates,
   each contested node at its own rate around whatever is anchored. Demonstrated at two
   coupling scales (runs 25, 26). The dial: strong coupling → structured alternation
   (one anchored, others cycle); weak → roaming.

9. **Pin = PLL; the register is a bistable injection-locked memory (run 33).** The pin
   is a phase-locked loop (§1.3): it holds the register phase against perturbation up to a
   **finite capture range**, and it is **not** a single infinitely-deep well. A replicated
   off-phase probe (`sigFire`) below the capture threshold is corrected back to the stored
   value (a read the medium *heals*); above it, the probe **rewrites** the register into a
   *second* stable phase basin (a write). Measured on W: locked at 2.37 (σ 0.024); probe
   amp 0.5 → kicked then re-locks to 2.37 in ~230 steps (PLL recovery); amp 1.0 → capture
   exceeded, basin-hops to 2.19 and locks *harder* (σ 0.002); amp 2.0 → same 2.19 basin.
   Corollary — **the register forgets, honestly and controllably**: a strong enough phase
   probe is a *write*, not merely a corrupting read. (This corrects the folk claim that the
   holographic phase channel is "incapable of forgetting" — it has ≥ 2 basins and a finite
   barrier. It is also distinct from associative recall, which rebuilds a stored *pattern*
   from a cue — that is the M-f relaxation program, §7, not the pin.) The basin-hop is
   byte-deterministic across peers **endpoint and full transit** (both peers climb
   2.19→2.5→2.65→2.72 value-for-value at matching `step=`; a nonlinear basin-hopping rewrite
   replicates step-for-step) — the register's dynamics, not only its fixed points, are
   replicated physics.

---

## 6. Operating procedure and hygiene

**Standard bring-up (fresh world):**

```
1. drive: transport, target parked; wait for lock to settle (solH log)
2. ⎙virt → virtHold() → virtMux() → selfClock()
3. virtStore() → virtBoot(0) [→ virtBoot(0) | → virtStore() → virtBoot(1)]
      same plate twice  = symmetric spins (instances)
      two distinct stores = distinct memories (recall)
4. regRead()              ← HEALTH AUDIT: all θ coherent, σ ≤ ~0.03, and the
                             absolute values reveal any leftover reference rotations
```

**Programming rules:**

- Budget per-node load: Σ|κ| over a node's edges ≤ ~0.12 for static answers on weak
  slots (V/P1/P2); W tolerates more (its pinning held 0.18 in run 25).
- Keep W out of graphs where it should be an anchor, in them where it should compute.
- Arm `regRead(32, N)` *before* stamping edges to capture the search/assembly.
- Read the drift column: ~0.02 locked · equal-and-large = rigid gauge rotation
  (answer still valid in differences) · unequal-and-large = running nodes (no static
  answer, or over-load) · large on exactly the reprogrammed nodes = the flip transits.
- After an instance: `edge(...,0)` all pairs; `attPhase` any reference rotations back;
  re-audit. After a *turbulent* instance: expect wear; re-record/re-boot or reload.
- To keep a result: save the world — the coupling matrix, sources, registers, beat-gate
  state, and plates all ship in the `.kwe` snapshot; **opening the file resumes the
  computation** (a joiner reads the same answer because the computation is the world).

---

## 7. M-f — the recall program (perception as relaxation)

**The synthesis**: recall is a 1-of-N optimization currently solved by a host-side
argmax (`virtRecall`'s lock-sweep). Its native implementation on this machine:
candidate plates as phases, **cue-evidence as ferromagnetic edges weighted by the bind
scores, lateral inhibition as an AF edge between candidates** — Hopfield recall as
physical relaxation, read by `regRead`. Coevolve is the dynamic pinning h(t) (the
lock); the lens trap is the port where percepts enter the graph. Fetch (recall) →
decode (boot) → execute (relaxation + leashed geometry) → writeback (store; answers
persist as world state).

**Distinctness dial**: the lock-sweep scores are `_ampCorr` — amplitude-based,
phase-blind — so memories must differ in *amplitude structure*: store the plates with
the soliton at two different transport positions.

### Part 0 — setup (clean reload; health baseline per run 27)

```
transport, target at position A → settle
⎙virt → virtHold() → virtMux() → selfClock()
virtStore()                         ← plate 0 = memory A
move target to position B → let the coevo transport settle
virtStore()                         ← plate 1 = memory B
virtBoot(0) → virtBoot(1)           ← P1 = A, P2 = B (distinct)
regRead()                           ← audit: four coherent θ's, tight σ
```

### Part 1 — distinct cue (recall-by-relaxation vs the argmax ground truth)

```
(target still at B)
⎙virt                    ← V = cue resembling memory B
virtRecall()             ← logs cue⊗bank=[s₁, s₂] and the argmax winner (ground truth)
⎙virt                    ← re-record the cue (recall replaced V with the winner plate)
edge('V','P1', 0.12*s1)   ← evidence edges: s1, s2 = the two numbers from the
edge('V','P2', 0.12*s2)      recall log line "cue⊗bank=[s1, s2]" — type them in,
edge('P1','P2', -0.08)       JS multiplication `*` (the doc's earlier `·` was math
regRead(32, 32)              notation and throws a SyntaxError if pasted)
```

No edges to W (the world stays the anchor). Loads: V ≈ 0.12·(s₁+s₂) ≲ 0.13 —
inside budget; each P ≈ 0.12·sᵢ + 0.08 ≲ 0.14.

**Prediction**: θ_V − θ_P2 → 0 (the winner aligns with the cue), θ_V − θ_P1 → π —
the Hopfield answer as phases, agreeing with `virtRecall`'s argmax; drifts → floor.

### Part 2 — tied cue (rivalry: the ambiguity theorem's first cognitive instance)

```
move target to the midpoint of A and B → settle
⎙virt                    ← ambiguous cue
virtRecall()             ← scores should log near-equal (the tie certificate)
⎙virt
edge('V','P1', +0.09)
edge('V','P2', +0.09)
edge('P1','P2', -0.08)
regRead(32, 48)
```

**Prediction (Law 8, now with a face)**: no static winner. Expect the *structured* form —
the cue-anchored V steady, P1/P2 trading alignment: θ_V−θ_P1 and θ_V−θ_P2 flipping in
anti-correlation across windows, nonzero drifts on the P's, and the **alternation period
= the machine's rivalry rate**, a new constant. Binding-by-synchrony and binocular-style
rivalry, literal rather than metaphorical: ferro = belongs-together, AF = competing
interpretations, unresolvable tie = oscillating percept.

**Post-run**: zero the edges promptly (Law 7 — don't let rivalry ring for 100k steps);
save the world at the interesting moments (`.kwe` = the experiment as an artifact any
peer can join).

### Run 30 — the accidental tie: FUSION, not rivalry (Law 8 refined)

Part 1 was run with flat couplings (0.12 to both P's — equal declared evidence = the
tie condition) and inhibition −0.08.

**Result**: no winner — **and no oscillation**. V, P1, P2 co-aligned near a common
phase, internally locked at σ 0.002–0.06 with floor drifts; P1−P2 squeezed apart only
0.10–0.45 rad. A **static fusion state**: both interpretations partially accepted.
The XY equilibrium explains it: evidence 2×0.12 vs inhibition 0.08 gives a genuine
static minimum (symmetric splay cos δ = 0.75 → P1−P2 ≈ 1.45 pinning-free; the holds
compress it to the observed 0.1–0.45). Meanwhile W — deliberately outside the graph —
churned violently (σ up to 0.95) and the graph nodes never felt it: **no edge, no
influence** (coupling isolation demonstrated under adversarial conditions).

### Runs 31–32 — M-f Parts 1 and 2 executed

**Run 31 (Part 1, scores 0.742/0.354) — PASS, with a graded readout.** Clean audit
(all σ ≤ 0.010; W drift 0.002 all session). Settled: V−P1 ≈ 0.34 (winner = P1 = the
argmax ✓), V−P2 ≈ 0.68, P1−P2 ≈ 1.0. **The evidence ratio is encoded as analog
geometry**: angle ratio 0.34/0.68 = 0.50 vs torque-balance prediction κ₂/κ₁ = 0.477 —
each memory's angular distance from the cue inversely proportional to its coupling.
Recall-by-relaxation returns a confidence-weighted posterior, richer than the argmax
it was verified against. (At inhibition −0.08 the state is graded/fusion-regime, not
binary — consistent with run 30.)

**Run 32 (Part 2, equal 0.09s) — competition transient, symmetry breaking, still no
rivalry.** Protocol deviation (both runs): the re-`⎙virt` after `virtRecall()` was
skipped, so V was the recalled winner-plate lift — V's field content = memory A's
matter. Trace: V starts phase-proximal to P2 (V−P2 ≈ −0.03), a three-way struggle runs
~12 windows, **P1 captures V by window 13** (V−P1 → 0.07, held ±0.1 to the end; P2
expelled to a stable 0.39). Static — a declared tie broke to a persistent winner
rather than oscillating: −0.08 remains below the fusion→rivalry threshold.

**Hypothesis (testable): the coupling implicitly weighs CONTENT.** P1 won from a
phase-losing start, and V was made of memory-A matter: `edge` injects whole fields, so
matched amplitude structures cohere more effectively per unit κ — content similarity
as a hidden evidence term in the physics, i.e. the machine is content-addressable
below the declared weights.

**The content-bias test (three arms; only the cue's content varies).** Mechanism note:
`virtRecall()` uses the *current W* as its cue and replaces V with the winner's lift —
so per arm, call it first to *measure* content overlap, then `⎙virt` to make V the
fresh cue (the step whose omission shaped runs 31–32). Per arm, identically:

```
1. move target to <POSITION>; settle          (arm 1: midpoint · arm 2: A · arm 3: B)
2. virtRecall()        ← log [s₁,s₂] = measured content overlap (mid: s₁≈s₂ = tie certificate)
3. ⎙virt               ← V = fresh cue with <POSITION>'s content
4. edge('V','P1',0.09) · edge('V','P2',0.09) · edge('P1','P2',-0.08)   ← declared evidence TIED in all arms
5. regRead(32, 24)     ← winner: settled |V−P1| vs |V−P2| (capture ≤0.15 vs ≥0.35; fusion = equal ±0.1)
6. edge all three to 0 before the next arm
```

Verdicts: **arm 2 → P1 and arm 3 → P2** (winner follows content; the sign flip rules
out slot asymmetry) = confirmed. **Same slot wins both** = falsified (slot asymmetry —
plate depth/hold/boot order — re-explains run 32). Arm 1 symmetric = the first clean
tie on record (save it); arm 1 capturing anyway = the residual asymmetry floor,
quantified and subtracted when judging arms 2–3. Keep the target parked during reads,
κ fixed at 0.09/0.09/−0.08 in all arms, same scheduler as runs 31–32. Determinism note:
one run per arm suffices — the between-arm sign flip is the statistics.

### Run 33 — the pin is a PLL; the register is bistable (Law 9)

Single slot W under the strong transport pin, one held V as an undisturbed control, no
edges. The pin operation is optical injection locking (§1.3), so this run probes it as
a phase-locked loop: **can a mismatched probe corrupt the stored phase, and where does
the lock break?** The probe is `sigFire(fx,fy,tx,ty,amp,-1)` — a replicated Gaussian
packet with a phase-tilt carrier (an "any wave"), fired into the soliton; read with
`regRead(16,6)` (V never moves off 2.37 = the built-in control).

**Baseline**: unpinned W tumbles (σ ≈ 1.2, drift −4.5 rad/kstep). The pin (`refAmp 1`)
locks it at **θ = 2.37, σ 0.024, drift 0.01** — a 50× tightening. That stable phase is
the reference we perturb (no `attPhase` needed; the plate's own phase is the stored value).

**Amp sweep** (baseline θ = 2.37):

| probe amp | W trajectory | reading |
|---|---|---|
| 0.2 | stays 2.37, σ ~0.018 | below threshold — lock absorbs it |
| 0.5 | 2.457 → **re-locks to 2.37** in ~2 windows (~230 steps), σ 0.106→0.028 | **PLL recovery** (return-to-baseline) |
| 1.0 | 2.50 → 2.75 → **crashes to 2.19**, locks *harder* (σ 0.002; W−V = −0.187) | **capture exceeded → basin hop** |
| 2.0 | bigger excursion, same **2.19** endpoint | 2.19 is a genuine 2nd basin, not noise |

**Result — the U(1) register is a bistable injection-locked memory** (Law 9). Two stable
phase basins (~2.37, ~2.19), a finite capture range (threshold between amp 0.5 and 1.0),
and a strong off-phase probe **rewrites** between them. This falsifies the folk claim that
the holographic phase channel is "physically incapable of forgetting" — it forgets, honestly
and controllably; a strong probe is a *write*. (Distinct from associative recall, §7, which
rebuilds a *pattern* from a cue — a different mechanism than the pin.)

**Determinism (two-peer, verified endpoint *and* transit).** `regRead` is a peer-local
meter (it does **not** replicate — run it on both peers and compare by `step=`, since frame
windows are peer-local); `sigFire` **does** replicate (`mediumSignal`). At amp 1.0 both peers
land at W ≈ 2.19, V ≈ 2.37, W−V ≈ −0.186 (matched at nearest `step=`), and both take the
*same path* out — 2.19 → 2.5 → 2.62 → 2.65 → 2.72 value-for-value at matching steps (the
one-sample offsets, including a −2.04 pre-jump dip one peer caught, are frame-boundary
sampling only). A nonlinear, phase-slip-adjacent, basin-hopping **rewrite replicates
step-for-step** — the register's dynamics, not merely its fixed points, are replicated
physics. This is the sharpest validation of the interlaced-mux determinism to date.


---

## 8. Provenance and prior theorems

The machine stands on the §7.88 meta-circular arc, closed by measurement in the same
program (17 prior runs): registers/plates = operator-side state (M-a theorem);
time = the operator's clock (crystal + breathing ladders; the mux routes on the
medium's heartbeat via `selfClock`, k-counter demoted to watchdog); coupling only where
declared (leak validation); the eye's reads are all the one bind primitive (clause 4,
consolidation pending). Determinism throughout is the KWE discipline: stamped verbs,
shared-step transitions, k-derived sources, f32 snapshot parity, integer quantization
at every decision — all peers compute the identical machine.

Implementation: `public/apps/medium.js` (verbs, instruments, mux, couplings),
`public/hologram_world.js` (the replicated verb model). Session memory:
`memory/project_register_experiment.md` in the Claude project memory carries the
run-by-run ledger this document consolidates.

*Runs 18–27: 2026-07-04 … 2026-07-05. Runs 28–33: 2026-07-07 … 2026-07-08 (28–29:
scheduler/gauge; 30–32: M-f recall; 33: pin-PLL / bistable register, on the interlaced
4-slot mux). Instruments and foundations: the same sessions, runs 1–17.*
