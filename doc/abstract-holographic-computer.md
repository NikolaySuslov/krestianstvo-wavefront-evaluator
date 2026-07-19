# The Abstract Holographic Computer (U1)

*A complete overview of the system as it stands: a replicated, deterministic computer whose
processor is a nonlinear wave medium, whose memory is holographic, whose machine state is an
operator-algebra register, and whose physics executes inside that register — with the GPU
demoted to a rasterizer and every architectural claim backed by a measured, refusable number.*

Implementation: `public/apps/medium-u1.js` (the machine), `public/medium-core.js` (the pure
laws, headless-tested), `public/hologram_world_u1.js` (the replicated world reducer),
`public/ifs-gpu.js` (rasterization and the optional GPU oracle). Companion documents:
`doc/abstract-holography.md` (the categorical structure), `doc/computer.md` (the register
experiment ledger).

---

## 1. What the machine is

The U1 abstract holographic computer is four things at once, and its architecture is the
statement that they are the same thing:

1. **A wave medium.** A complex field ψ on a 128² torus, evolved by the engine map: a
   9-point + fractal-ring Laplacian (linear, dispersive), saturable self-phase modulation
   (nonlinear), an energy cap (dissipative closure), and an injection-lock pin (control).
   The fractal IFS clock rebuilds the ring kernel as it runs — the medium's dispersion is
   itself a running program.
2. **A register machine.** The machine state is a *register*: four slots (W, V, P1, P2),
   each a descriptor (∠ phase, β stiffness, ω precession, k tilt — a U(1)/ℂ* group element),
   a worldline clock τ, a leash (position + transport law), a compiled envelope, and a set
   of certified physical charges (§4). The register is small, replicated, and hashed
   (`regH`, `eH`, `eV`, `eP1`, `eP2`) — it *is* the determinism contract.
3. **A holographic memory.** Moments of the field are banked as plates by propagation
   (`store`: a ±T spectral leg turns a state into an interference record) and retrieved by
   correlation (`recall`): content-addressable, shift-invariant if asked, and *live* — a
   recalled moment is re-instantiated as a running worldline, not an image.
4. **A meta-circular evaluator.** The register does not describe the medium; since v7 it
   *runs* it: every evolution step is executed inside the register in f64 CPU arithmetic
   (`_regStep1`), on the f32 lattice that is simultaneously the wire format and the
   original engine's own grain. The GPU performs zero physics steps in the default mode —
   a claim proven live by counting (`mu1.pure()` → 0 substeps), not asserted.

The name is meant literally. *Abstract*: the machine state is algebra (descriptors, charges,
envelopes) and the algebra is closed under the machine's own operations. *Holographic*:
memory is distributed interference, read by correlation, tolerant of displacement.
*Computer*: deterministic, replicated, programmable by a small verb set, and instrumented so
that every one of its laws can be refused by measurement.

---

## 2. The engineering: how it runs

### 2.1 The replicated substrate (Croquet → Krestianstvo → KWE)

The machine inherits the Croquet/TeaTime model as realized in Krestianstvo's KWE: a
reflector carries **only stamped inputs** (verbs, the shared clock, a one-time join
snapshot); every peer computes the entire model locally; *subticks are model events* —
identical in count and order on every peer. There is no state synchronization because there
is no state to synchronize: identical inputs into identical deterministic laws yield
identical bytes. The reflector never sees a field, a plate, or a register — it sees button
presses with timestamps.

**The naturality law** is the single criterion from which every determinism rule in the
system follows: *every model morphism must be a pure function of (shared step k, shared
state).* Peer-local quantities — frame boundaries, rAF moments, point-samples of the
oscillating clock, end-of-frame values, the gaze — may inform *telemetry* and may be
*stamped into a verb at the injector*, but may never be read *at the drain*. Corollaries,
each independently learned and now enforced structurally:

- verbs resolve their targets at press time (stamped-carrier principle);
- observables derived from the oscillating clock are enveloped over the oscillation, never
  point-sampled;
- the canvas paints only shared-grid (bar) states — frame ends are peer-local events;
- a dynamical register field's lattice equals its wire's lattice **at every state the wire
  can observe** — hence the per-step f32 quantization (a join snapshot can land mid-bar).

### 2.2 Proper time

Time in the machine is layered, and every layer is shared:

- **Steps** (k): the atomic shared grid; ~19 per clock unit, gated by the shared clock's
  direction (the oscillating IFS clock's phase, not its sampled value).
- **Bars** (21 steps): the beat grid — aging, ω precession, leash advance, display film,
  envelope quantization.
- **Worldline clocks** (τ per slot): each slot ages by its own beat law; slots can be
  time-dilated relative to one another (live-verified: one slot aged 30 τ-units while
  another aged < 1, byte-identically on all peers).
- **Tempo** (the world proper-time divisor): a replicated dial that slows *matter's* clock
  world-wide when demand exceeds any peer's supply — the convoy law: one shared proper time
  means the world slows together or forks. A governor (autoTempo) measures locally and
  actuates by replicated verb.

### 2.3 The register engine (the physics, register-resident)

Per drained shared step, for every *living* slot:

```
ψ ← ψ + β·A            pin superpose      (β from the REPLICATED per-slot refAmp)
ψ ← F⁻¹ M(λ) F ψ       exact linear step  (gate D: the engine's discrete map, diagonalized)
ψ ← e^{iγI/(1+I/Isat)Δt} ψ   saturable SPM  (pointwise closed form)
ψ ← ψ·min(1, √(E₀/E))  energy cap         (a monoid reduction + one scale)
ψ ← fround(ψ)          f32 grain          (= the wire lattice = the original engine's grain)
```

All f64 CPU, ~3 ms/step at 128², amortized ~10 ms/frame at the net step rate. The λ(k) grid
is a per-kernelVer cache (stencil-DFT build); kernel swaps land at shared steps and re-key
the register's charges in closed form. W is always living (the driven worldline); any slot
becomes living by `recall`. The GPU's remaining jobs: rasterize the register's envelope
through the linOp view shader (colormap + pose — zero dynamics), and serve as an *optional
oracle* (the mirror: an independently integrated GPU copy, injection-locked to the register,
whose lock→A score is the register's live fidelity meter).

### 2.4 The verb set (the instruction set)

All replicated, all whitelisted and clamped by the world reducer, all drained at stamped
shared steps:

| verb | meaning |
|---|---|
| `store` | bank the current moment as a hologram plate (forward spectral leg, f32-quantized at creation) |
| `recall` / `recall@` | zero-lag retrieval: the moment re-instantiated **at its stored place**, born *living* |
| `recallx` / `recall⇄` | shift-invariant retrieval (`crossCorrScan`): finds a *moved* moment and **relocates it to the cue** |
| `recalla` / `recall𝔸` | descriptor-only retrieval: closed-form cue⊗bank on the plates' group elements — no field read at all |
| `record` | declare the current moment into a slot as a parked 𝔸-plate (optionally through a lens: the birth angle) |
| `wabs` | the door: close the register (compile) / materialize back into a GPU field (the oracle resumption test) |
| `mirror` | summon/dismiss the GPU verifier |
| `descgo` | transport a slot's leash target (the pin chase moves the soliton *through* the medium — wake included) |
| `aphase, refamp, lenstau, lensset` | write the register: phase, stiffness, precession, extended lens components |
| `edge` | couple slot phases (±κ): the register as an XY/Ising machine (MAXCUT solved on K₃/K₄, measured) |
| `tempo, autoc, xatt, coevo, …` | world dials: proper-time divisor, continuous compilation, exact spectral attractor, the Einstein gain-gate |

Two recall semantics are deliberate and both honest: *"bring that moment here"* (`recall⇄`,
the δ-law of the shift-invariant scan) and *"show me where it was"* (`recall@`). They are
different questions to the same memory.

### 2.5 Boot, wire, and proof

- **Boot**: a fresh leader is *register-born* — the symbol (probe) is injected directly
  into the abstract register at seed time; the dressing transient (~8 bars of SPM + kernel
  sculpting) happens in-register, visibly. There is no GPU compile pass and no physics
  prologue. A world restored in field mode re-closes to the register default one bar later.
- **Wire**: the join snapshot ships the register + envelopes + plates as f32-base64 (~KB
  scale); attractors and derived tiers are *regenerated* from register content (pure
  functions ship as nothing). Joiners land on the leader's exact bytes at any step.
- **Proof of purity**: `mu1.pure()` counts GPU physics substeps over a window. In the
  default mode the count is **0** — every evolution step was register arithmetic. The
  counter, not the architecture diagram, is the guarantee.

---

## 3. Operator algebra and harmonic analysis

### 3.1 The commutative sector: Gelfand duality as an engine component

The linear evolution operator L̂ (lap9 + fractal rings) is a **torus convolution** — an
element of the commutative C*-algebra generated by translations on (ℤ/G)². Gelfand duality
for this algebra is not an analogy here; it is a load-bearing component: the algebra's
character space is the dual group (the k-grid), and evaluating the Gelfand transform of L̂
at each character *is* the closed-form symbol λ(k) computed from the ring descriptor. The
engine's discrete step diagonalizes into per-mode 2×2 recurrences (gate D), verified
against the GPU at the f32 floor (max|Δ| ≈ 3.6e-7). The spectral register is Pontryagin
duality made executable:

- **translation = character multiplication** (`spectralShift`: unitary, Parseval-exact,
  used for relocation and the exact attractor);
- **correlation = pointwise dual product** (`crossCorrScan`: all N offsets in one dual
  pass — the shift-invariant memory read);
- **convolution operators = multiplication operators** (the λ-grid; the ±T holographic
  legs run entirely register-side).

### 3.2 The noncommutative sector is the physics

The SPM operator is diagonal in *position*; the kernel is diagonal in *momentum*. Their
commutator is the machine's dynamics — solitons, collapse, dressing are precisely the
failure of the two maximal commutative subalgebras to commute. The engine's Strang/Lie
splitting is an explicit Trotter product between the two. This is why "compress the state
in either basis alone" fails for dressed objects (a dot-built symbol lives at the Brillouin
edge; its dressing is broadband) and why the machine cannot be reduced to its spectral
register: the register *carries* the noncommutativity by executing both factors.

### 3.3 The observer algebra: U(1) ⊂ ℂ*

Each slot's descriptor is a ℂ* group element (phase × gain); the pinned discipline
restricts to the unitary subgroup U(1) (gain ≡ 1), and *unpinning* is literally passing
from U(1) to ℂ* — the amplitude degree of freedom becomes dynamical (the coevolution
gain-gate reads true field energy). Measurements are U(1)-invariant states on the algebra:
`ampCorr` = |⟨φ,ψ⟩|/‖φ‖‖ψ‖ — a normalized positive functional; the "abelian contract"
(predicted vs measured phase composition, algDefect ≡ 0) is checked live wherever
descriptors compose.

### 3.4 Functional-analytic frame

The state space is ℓ²((ℤ/G)², ℂ); the linear step is unitary per mode to the leapfrog's
band error; SPM is a unitary multiplication operator; the cap is a radial retraction onto
an energy sphere (the one non-unitary, non-local operation — its reduction tree is part of
the determinism contract); the pin is an affine contraction whose fixed-point structure is
*measured*: phase basins, capture range β\* ≈ 0.15, and the arrest law (a held state is
stationary in the sl(2) invariant: İ falls four orders through capture and zero-crosses at
β\*). The computable subspace is the f32 lattice — chosen because it is simultaneously the
GPU's arithmetic, the wire's format, and therefore the unique grain at which "the same
computation" is well-defined across machines.

### 3.5 The metaplectic sector: the groups behind the quadratic physics

The full symmetry story of the machine is a tower of three groups, and the machine
implements a representation of each — with the honest reach of each representation
*measured*, which is what distinguishes this from decoration.

**The Heisenberg–Weyl group (the kinematics).** Over the finite phase space
A = (ℤ/G)² × (ℤ/G)²̂, the machine carries both generator families of the finite
Heisenberg–Weyl group: **translations** T_a (implemented exactly as character
multiplication in the dual — `spectralShift`) and **modulations** M_b (phase tilts and
plate angles — the lens `kx, ky` and `attPhase` writes). Their commutation is a central
phase, T_a M_b = e^{2πi a·b/G} M_b T_a, and Stone–von Neumann says ℓ²((ℤ/G)²) carries the
unique irreducible representation — which is why *one* field buffer suffices as the state
space for every modality the register expresses, and why the "abelian contract" checks
(predicted vs measured phase composition, algDefect ≡ 0) are Weyl-relation checks in
disguise. Holographic storage itself is Heisenberg–Weyl arithmetic: a plate is a state
multiplied into a reference — a point of the group orbit — and correlation recall inverts
the group element.

**The symplectic group and the Weil representation (the linear optics).** Sp(2,ℝ) acts on
the Heisenberg group by automorphisms; its double cover, the metaplectic group Mp(2),
acts projectively on the state space — the Weil representation, which for finite ground
rings is exactly Weil's original setting. The engine's linear elements are a generating
set of Sp in ABCD form:

| Sp element | ABCD form | machine operator |
|---|---|---|
| free flight | (1 t; 0 1) | the kernel's quadratic slice (paraxial propagation) |
| thin lens / chirp | (1 0; C 1) | `lensPhase` quadratic phase; the chirped probe |
| squeeze / dilation | (s 0; 0 1/s) | the metric-lens dilation |
| rotation (fractional Fourier) | (cos sin; −sin cos) | the FFT itself is the π/2 element — the machine's change of basis *is* a group element |

The **Gaussian/q register is the orbit picture made executable**: Gaussians are the orbit
of the vacuum under Mp(2) (squeezed states), the complex width parameter w lives on the
upper half-plane ≅ SL(2,ℝ)/SO(2), and ABCD elements act on it by Möbius transformation
w′ = (Aw + B)/(Cw + D). The register's linear width law w ← w + iD̄·dt *is* the Möbius
action of the free element — gate C's evolution law is the coset geometry of SL(2,ℝ),
computed with two floats.

**sl(2,ℝ) as observables (the dynamical algebra).** On the state space the quadratic
moments close the algebra: V = ⟨r²⟩ (the generator K), the dilation D̂ ∝ V̇, and the
Hamiltonian H. Their closure *is* the virial identity V̈ = 4DH (engine convention,
measured to 2.6 % for smooth states), and the algebra's **Casimir I = V̈V − ½V̇²** is the
machine's conserved partner of H — the Ermakov–Lewis invariant of the quadratic sector.
Because the Casimir labels the coadjoint orbit of sl(2,ℝ)\*, the live triple (V, V̇, H)
is a point moving *on* an orbit under free flight and *across* orbits under drive: İ, the
Casimir flow, measures precisely the non-Hamiltonian work (pin, cap, kernel edits) — the
wear meter is coadjoint-orbit geometry. Kernel re-keys are closed-form orbit re-labelings
(ΔI = ΔV̈·V from the two descriptors, measured to 2 %), and the dated forecasts
(t\* = −V̇/V̈, V_min = I/V̈) are the orbit's turning points announced before the flow
reaches them — verified on the live kernel to 0.1 % of V₀.

**The honest reach of each representation.** The Weil representation is exact only for
*quadratic* symbols; the lattice symbol λ(k) is not quadratic, and the machine does not
pretend it is: exact linear evolution runs on the full character theory (the abelian
sector, gate D, f32-floor exact), while the metaplectic sector governs the *moment
observables* — where its laws hold at the few-percent level for smooth states and are
*measured to fail* in named ways beyond (the quadratic packet slice degrading 9→36 % with
probe bandwidth; total D-breaking for deep-supercritical states). The nonlinearity
selects its own subgroup: critical cubic SPM preserves the pseudo-conformal (Talanov)
element — which is *why* V̈ = 4DH survives the nonlinearity (the parabola persists,
measured RMS 4.6e-4) — while saturation breaks the K generator (the parabola bends ×14),
and that breaking is exactly why collapse arrests. The kernel's small non-centrosymmetric
part (the dipole) is the residue of the assumption that λ is even — a k-odd gain,
measured, sign-flipping with k, cancelling exactly in ±T round trips (which is why
holography is immune to it). In every case the group theory earns its place by declaring
where it ends.

### 3.6 Choosing the arithmetic subgroup: SL(2,ℝ) → SL(2,ℤ), the modular group by design

Within the continuous symplectic sector sits a discrete choice, and the machine's own
exactness lessons select it. The modular group PSL(2,ℤ) is generated by two elements —
**S: w ↦ −1/w** and **T: w ↦ w + 1** — and the machine implements both *exactly*:

- **S is the FFT.** The Fourier transform of a Gaussian of modulus w is a Gaussian of
  modulus −1/w — the machine's change of basis, already exact to f64 rounding, *is* the
  modular inversion acting on the q register's moduli coordinate;
- **T is a unit chirp** — an integer quadratic phase applied pointwise, exact by
  construction (no resampling, no band assumption).

So the orbit of the register's Gaussian states under {S, T} — the full modular group — is
computed with *zero* approximation error, while generic elements of SL(2,ℝ) (arbitrary
squeezes, fractional propagation distances) are only as exact as the quadratic slice they
ride on (§3.5). This is the same dichotomy the machine met at the translation sector —
integer torus shifts are exact and ring-free, fractional ones interpolate and ring on
dot-scale content — now stated at the level of the moduli action, and it sharpens into a
design thesis:

> **The continuous group is the physics; the arithmetic subgroup is the computation.**
> Continuous group elements are *measured* (with declared reach); arithmetic subgroup
> elements are *exact by choice*. When the machine can route an operation through S, T,
> and integer translations, it inherits number-theoretic exactness for free.

The theta reading (§6.3) closes the circle: finite theta functions transform under
precisely this modular action (the theta transformation formula), so the exactly-computable
orbit of the q register is the modular orbit of a theta structure — the classical bridge
from the symplectic group to arithmetic, present here as an engineering fact about which
buttons do not accumulate error. Whether to *restrict* a given operation to the modular
subgroup (exactness) or take the continuous element (physical fidelity to an arbitrary
parameter, with measured defect) is a per-operation choice the architecture leaves open —
both paths exist in the codebase (exact spectral attractor vs bilinear; integer-baked vs
render-side fractional pose), each with its instrument.

---

## 4. Group theory: the register as a ledger of charges

The register carries, per slot, the charges of every symmetry sector the medium has been
*measured* to respect — each gate below is a closed experiment with a pinned regression:

| sector | charge / law | measured |
|---|---|---|
| U(1) global phase | ∠, ω precession; recall aging Δ∠ = ω·Δτ predicted descriptor-side | write fidelity ≈ 1; ~5-bit phase register; bistable basins under strong probes |
| Translations (torus) | leash pose; exact character shifts; universal transport speed v\* ≈ 0.068 px/step | kernel symbol drift ≤ 0.2 % at all tested k (gate B) |
| Scale / squeeze (q) | (σ, b) evolved by the engine's own split projected on the ansatz; P_c = 2πD̄/γ | spread quantitative; collapse onset correct; free equilibrium = lattice filament (gate C) |
| sl(2,ℝ) / metaplectic | V̈ = 4DH (virial, engine convention); the Casimir **I = V̈V − ½V̇²**; dated forecasts t\* = −V̇/V̈, V_min = I/V̈ | waist called to 0.1 % of V₀, focal time to 1 %, on the live kernel (gates E, F) |
| Kernel re-keys | ΔI = ΔV̈·V closed-form from the two descriptors when the clock edits the ring | descriptor-predicted ΔV̈ ≡ measured to 2 % (register-side, FFT-free re-sum) |
| Injection lock | β\* (capture), arrest (holding ≈ free), ride cost ~linear in speed, shed regime below β\* | İ(β) zero-crossing at 0.15; cost ×2.5 for ×3 speed at tight lock |

The non-abelian content is real: SL(2,ℝ) acts on the quadratic sector (the ABCD/metaplectic
slice), and the machine's live watch (`[VPT]`) reports its Casimir, its flow İ (the
sl(2)-work of the drive — zero on free flight, so any drift *is* the maintenance power),
and a dated counterfactual ("freed: focus/collapse in N steps") — a forecast the mirror can
refuse.

The knee k_knee = j₀,₁/r_max — the first Bessel zero over the largest ring radius — is the
clock's own low-pass: it bounds the *free* dynamics band, while pin-maintained content
lives above it. It is the machine's built-in scale separation, derived from the descriptor.

---

## 5. Category theory: the structure that is measured, not assumed

Three categorical structures organize the machine, and each carries a *first-class measured
defect* rather than an axiom:

**Naturality (= determinism).** The shared step index is the base category; model morphisms
must be natural in it. Every historical fork class (frame-local reads, point-sampled
clocks, stale carriers, mid-bar wire states) is an instance of one failure: a morphism that
was not natural. The determinism hashes are the naturality check run forever.

**The adjunction of tiers.** compile (Field → Register) ⊣ materialize (Register → Field).
The unit (register → compile∘materialize) is exact by construction — the register cannot
tell which side of the abstraction it aged on. The counit (field → materialize∘compile)
carries the measured defect; the mirror is the counit made continuous, and `mu1.defTest()`
verifies the factorization law — a composite's fidelity equals the product of its arrows'
defects (measured residual ~4e-6; a composite losing more than its factors indicts a hidden
non-natural read). Since v7 the two tiers coincide on the evolution law itself: the
register runs the medium, so the counit defect reduces to the f64/f32 pipeline difference
between two implementations of one discrete map.

**The witness presheaf and local-to-global.** Regions of the torus form a site; regional
witnesses form a presheaf (restriction = shrinking the region). The gluing data is
measured: the cover cocycle is **bit-for-bit exact** (patches + 3·reach halos + fixed-order
gluing ≡ the whole-torus step, max|Δ| = 0), the energy cap is the one global obstruction
(its reduction tree is part of the contract), and the *light-cone law* bounds any wrong
boundary to the 3·reach seam band per step. Sheafification — recovering the global section
— is available two ways: **by wire** (halo exchange) or **by trust** (declaration-anchored
halos from the register + the pin's contraction). The second needs *no new communication*:
two browser tabs shard one world's physics regionally while the reflector carries ordinary
verbs only, and the gluing defect (seam-glue) prints per bar, factorized as
interior × state — the sharding itself contributes zero, proven bit-exactly outside the
region. This is Čech descent as an engineering budget.

---

## 6. Algebraic geometry: the finite torus, its dual, and theta structures

The machine's algebraic geometry is finite, commutative, and load-bearing where it is
load-bearing — this section states which identifications carry weight and which are
framing.

### 6.1 The spectral register as an affine scheme

The translation algebra ℂ[(ℤ/G)²] is the coordinate ring of its dual — a finite scheme of
G² points, the character grid. Under this reading, which is Gelfand duality restated
algebraically: the symbol λ is a **regular function** on the dual scheme; the kernel
descriptor → symbol map is **evaluation of a coordinate-ring element** (the stencil is the
element, the DFT is the evaluation at all points at once — the λ-grid build); and the
per-kernelVer λ cache is memoized evaluation. Diagonalizing the engine (gate D) is the
statement that the evolution operator lives in this coordinate ring; its f32-floor
agreement with the GPU is the claim's number.

### 6.2 Cartier duality and the Fourier–Mukai transform, finitely

(ℤ/G)² and its character group are **Cartier-dual finite group schemes**, and the FFT is
the finite **Fourier–Mukai transform** between them — the kernel of the transform is the
finite Poincaré bundle e^{2πi⟨x,ξ⟩/G}. The machine uses the transform's functoriality as
engineering, item by item: convolution ↦ multiplication (the spectral propagator),
translation ↦ character multiplication (`spectralShift`), correlation ↦ pointwise dual
product (`crossCorrScan` — the shift-invariant memory read is one Fourier–Mukai pass), and
the ±T holographic legs are the transform conjugating a diagonal flow. Nothing in this
paragraph is analogy: each clause names a function in `medium-core.js` and the pinned
regression that verifies it.

### 6.3 Theta structures: the Heisenberg module and the q register as a moduli path

The finite Heisenberg group of §3.5 is the group of Mumford's **algebraic theta theory**:
its unique irreducible module (Stone–von Neumann) is, classically, the space of sections
of an ample line bundle on an abelian variety, and a basis of that module is a system of
theta functions; the metaplectic group permutes theta structures. The machine inhabits the
finite, one-dimensional case of this picture:

- the state buffer ℓ²((ℤ/G)²) **is** the Heisenberg module; plates and attractors are
  vectors in it, and the Weyl operators the verbs apply (shifts, modulations) are the
  theta-group action;
- a **periodic Gaussian on the finite torus is a finite theta function**, and the q
  register's complex width w is precisely the modulus: w ranges over the upper half-plane
  — the genus-1 Siegel space — and the ABCD/Möbius action of §3.5 on w is the action on
  the moduli of theta structures. Gate C's width law (w ← w + iD̄dt, then the nonlinear
  correction) is therefore, verbatim, **a path in the moduli space of finite theta
  functions**, executed with two floats per slot;
- the machine's dressing/breathing of a Gaussian is the departure of the true state from
  the theta locus — measurable as the gap between the q register's prediction and the
  field, which is exactly how gate C reports its honest boundary.

The first two clauses are identifications; the last is the instrument that keeps them
honest. The moduli reading adds no new computation — it says what the existing two-float
register *is* a coordinate on.

### 6.4 The involution and the dipole

Centrosymmetric kernels have even symbols: λ descends to the quotient of the dual torus by
the inversion ξ ↦ −ξ (the finite Kummer quotient). The live clock's kernels are *not*
exactly centrosymmetric, and the obstruction to descent — the odd part of λ — is the
measured **dipole**: a k-odd gain that wanders with the fractal clock, flips sign with k,
and cancels exactly under the composition of inversion with time reversal, which is why ±T
holographic round trips are immune to it (rt = 1.00000, measured). A symmetry defect,
located precisely as a failure of a function to live on a quotient.

### 6.5 The state scheme over the wire ring, verbs as regular maps

The determinism contract has an arithmetic-geometry flavor worth stating plainly: every
observable state of the machine has coordinates in one **finite ring of definition** — the
f32 lattice, which is simultaneously the GPU's arithmetic, the wire's format, and the
quantization grain of the register engine. Peers agree because they compute the same
points of a state space *defined over that ring*; the hashes (`regH`, `eH…`) are point
membership tests. Above the states, the register's configuration space is a product of
group varieties — U(1) phases, ℝ₊ stiffnesses, torus positions, the affine lens components
— and the whitelisted verbs act as **regular maps with clamped (chart-bounded) domains**;
the reducer's clamps are the choice of affine chart made explicit. A plate bank is a
finite set of points in the moment space; zero-lag recall evaluates a correlation form on
that set; shift-aware recall maximizes it over a torus orbit — an orbit search performed,
again, through the dual (§6.2).

### 6.6 A Langlands remark (honestly bounded)

The tower §3.5→§6.3 (Heisenberg–Weyl → Weil representation → theta → the modular action)
is the seed material of the Langlands program — Weil's recasting of theta functions and
the theta correspondence built on it. Three identifications hold with no stretching: the
engine's hot path *is* the finite abelian Fourier–Mukai transform, i.e. the solved
(GL(1)) case of geometric Langlands, executed continuously; the q register's theta states
under continuous SL(2,ℝ) and exact SL(2,ℤ) realize the automorphic dichotomy Γ\G as an
engineering fact (§3.6); and every gate has the reciprocity *shape* — arithmetic-side
data (a descriptor) predicting spectral-side measurements (λ(k) → transport ≤0.2 %;
descriptor → V̈ re-key to 2 %), with the commuting kernel algebra's simultaneous
character diagonalization playing the Satake role. The honest verdict: U1 solves no open
Langlands problem — those live in the non-abelian, number-field regime; this machine
inhabits the classical corner. Its genuine niche is instrumental: a bit-exact laboratory
for the finite Weil/Fourier–Mukai/theta structures, and — via Kapustin–Witten's reading
of geometric Langlands as a field-theory duality — a tiny deterministic field theory in
which the abelian duality is exact and its **failure under interaction is measured**
(the metaplectic sector's quantified reach), which is the defect class the hard problems
generalize.

### 6.7 Singularities: discreteness as resolution

The flow's analytic singularity (critical self-focusing) is not resolvable by algebraic
means, and the machine does not resolve it — the lattice **arrests** it: collapse funnels
power past the knee into a stable px-scale lattice filament (measured: I_max ×15–17, then
stationary), a discrete soliton at the floor. The exceptional locus of a blow-up has, as
its physical counterpart, this family of filament states that the singular flow lands on
instead of diverging. Discreteness acts as the regularization, the knee as the mechanism,
and the arrest is a theorem of measurement here, not of geometry: the instrument called
the collapse onset correctly and then watched the parabola bend (the K-breaking, ×14) at
the moment saturation took over.

---

## 7. The computer-science reading

### 7.1 Meta-circularity (Lisp's eval, completed in physics)

A meta-circular evaluator defines `eval` in the language being evaluated. The U1 machine
closes the same circle one level lower: the register (the abstract description) *executes
the evolution law of the medium that produced it*, using operators (spectral step, SPM,
cap, pin) that are themselves register content (the kernel descriptor, the replicated β,
the slot's E₀). The fixed point of the tower is explicit: the model of the medium **is**
the medium — same discrete map, same grain, different substrate (CPU f64 vs GPU f32
pipelines), verified equal at the f32 floor. `wabs` is `quote`/`eval` — reify the running
field into data (compile), or evaluate the data back into a running field (materialize) —
and the resumption test is the round-trip law `(eval (quote x)) = x`, measured.

### 7.2 Lambda calculus, Y, and fixed points

Recursion enters three ways, each as a *physical* fixed point:

- **The IFS clock is a self-application**: the fresnel cascade feeds its own output scale
  back as input (the self-similar depth law) — a Y-combinator whose fixed point is the
  fractal kernel; the machine's dispersion is the recursion's attractor, recomputed live.
- **The soliton is the fixed point of the step map**: dressing is fixed-point iteration
  (visible at boot), and the injection lock is a contraction whose Banach fixed point the
  arrest law certifies (İ ≈ 0 held vs +8e5 free slide). Computation-by-relaxation — the
  M-f recall-by-relaxation results — is the same idea used as memory read-out.
- **A plate is a closure**: code (the descriptor: a group element and its aging law ω)
  plus captured environment (the envelope). `recall` applies the closure — and because the
  application is *live* (the slot is born into the engine), a recalled memory resumes
  computing, it does not merely display. Homoiconicity holds throughout: descriptors,
  envelopes, and plates are data the machine manipulates *and* the machine's own operating
  parts.

### 7.3 Smalltalk: uniform objects, modes not classes

The four slots are one type. Every slot is descriptor + envelope + worldline clock + leash;
what differs is *mode* — driven (W), living (engine-stepped), parked (a plate), mirror
(the GPU verifier), descriptor-only (an 𝔸 declaration). Verbs are messages, replicated and
stamped; the register strip and view selector are the inspector; the instruments
(`elTest`, `defTest`, `wearTest`, `coverTest`, `pure`, `vpt`…) live inside the image, in
the Smalltalk sense — the system carries its own laboratory and can interrogate itself
while running.

### 7.4 Feedback loops as first-class laws

- the **pin**: negative feedback = a PLL/optical injection lock — its stiffness β is the
  single dial that spans free flight → capture → rigid hold, with the capture threshold
  measured twice by independent instruments;
- the **coevolution gain-gate**: matter throttles geometry (the leash advances only as
  fast as the field keeps up) — a two-way feedback deliberately shaped like Einstein's
  loop, replicated because gx/gy is register state;
- the **tempo governor**: measurement local, actuation replicated — feedback across the
  distributed system without breaking determinism;
- **wear**: the thermodynamic ledger of feedback itself — İ prices what holding and moving
  cost in the medium's own invariant.

### 7.5 The lineage: Croquet → TeaTime → Krestianstvo → KWE, and the general-relativistic shape of replicated time

**Croquet / TeaTime.** The outer semantics descends from the Croquet architecture (Kay,
Reed, Smith — itself Smalltalk lineage): replicated *islands* of objects advance in
**pseudo-time**, a deterministic internal timeline decoupled from wall clocks; a stateless
reflector *stamps and reflects* external messages but computes nothing; and computation is
**pulled** — each peer advances its island to a stamped target time on its own schedule,
rather than being pushed state. Identity of worlds is identity of (initial snapshot +
stamped message sequence + deterministic laws); joining is snapshot restoration, not state
transfer negotiation. U1 uses this exactly: verbs are the stamped messages, the world
reducer is the island, and the whole physics is inside the deterministic replay.

**Krestianstvo's extension: continuous pull time and the observer.** Krestianstvo SDK
extends Croquet's discrete-heartbeat picture toward **continuous time**: the shared clock
is a continuous function each peer *pulls and samples at its own moments*, so a peer's
frames are its private samplings of one shared timeline — the observer becomes a
first-class participant with its own sampling worldline, without ever gaining the power to
fork the model. KWE (the Krestianstvo Wavefront Evaluator) completes the move by making
the clock *part of the model*: the fractal IFS clock is a model object with phase,
direction, and its own recursion (the medium's kernel is this clock's output), and
**subticks are model events** — the shared time grid is generated inside the world it
times. The two disciplines that make this safe are both naturality corollaries: stepping
is gated on the clock's shared *phase* (never its peer-sampled value), and any observable
derived from the oscillating clock is enveloped, never point-sampled.

**The general-relativistic shape.** What emerges is not an analogy pasted on afterwards
but the structure the constraints force, with each element *measured* in this machine:

- **Worldlines and proper time.** Each slot carries its own clock τ_i, advanced by its own
  beat law. Time dilation is real and byte-identical across peers: one slot aged 30
  τ-units while another aged less than 1, in the same world, deterministically.
- **The lapse.** `tempo` is a global lapse function: it dilates *matter's* proper time
  world-wide by a replicated integer, because one shared proper time admits no per-peer
  rate — the **convoy law**. The governor measures locally and actuates globally, which is
  the only causally consistent shape for feedback on a shared time.
- **Foliation as gauge.** The scheduler's global τ is telemetry only — a coordinate
  choice with no physical content, exactly a foliation gauge. What is physical is the
  event structure: shared steps and bars. Correspondingly there are *two bar scales*
  (clock-cycle bars vs step bars), and any cross-tier subtraction must name its scale —
  coordinate-time bookkeeping, learned the measured way.
- **Relativity of display simultaneity.** Frame ends are peer-local events; two peers
  never render "the same wall moment." What is invariant is the **shared film** — the
  bar-grid states, identical bytes at identical indices — and `frameLock` is the choice
  to display only invariant events. The sub-bar interpolation each peer adds is its own
  observer sampling: honest, local, and outside the contract.
- **Causal structure.** The engine's stencil defines a light cone: influence propagates
  at most 3·reach cells per step — pinned *bit-for-bit* (garbage placed outside a region
  cannot touch the interior beyond the seam band in one step). All sharding rests on this
  measured causality: declaration-anchored halos are honest because wrongness travels no
  faster than the cone, and the pin contracts what does arrive. The universal transport
  speed v\* ≈ 0.068 px/step is the matter-sector speed limit under the same stencil.
- **Matter tells geometry.** The coevolution gain-gate is a deliberate Einstein loop:
  the leash (geometry's instruction to matter) advances only as fast as the field's
  energy ratio permits (matter's back-reaction on geometry's advance) — implemented as a
  replicated law because the leash position is register state. Its companion is the
  **two-channel law**, dynamically confirmed: metric warps move *position* and deposit no
  momentum; forces deposit momentum — geometry and force are different channels in this
  medium, distinguishable by experiment.
- **Local-to-global.** The descent machinery (§5) is the spatial face of the same
  relativity: no peer needs the global section to act correctly locally; the global field
  is the sheaf-theoretic completion, reachable by wire (halo exchange) or by trust
  (declaration + contraction), with the gluing defect a measured number. Replication in
  time (every peer replays the same worldline) and sharding in space (peers own regions,
  agreeing bit-for-bit on overlaps) are the two halves of one statement: *the world is
  the invariant of its observers.*

What U1 adds to this lineage is the demonstration that an entire nonlinear physics —
dispersive, self-focusing, clock-modulated — lives inside the discipline with bit-exact
peers, and that the discipline's constraints, taken seriously, reproduce the conceptual
skeleton of general relativity not as metaphor but as the unique consistent way to run
one world on many machines.

---

## 8. The instrument deck (the machine's self-knowledge)

Every claim above is attached to a runnable meter; the machine's epistemology is that a
statement without a refusal channel is decoration.

| instrument | what it can refuse |
|---|---|
| `regH`, `eH/eV/eP1/eP2` per shared step | the entire determinism contract, per tier |
| `mu1.pure()` | "the GPU does no physics" (counts substeps; reads 0) |
| `mu1.defTest()` | the adjunction's factorization law; scissor leaks (bit-exact outside a shard region) |
| `mu1.coverTest()` | the descent cocycle on the live field (bit-for-bit); the fork-finder localizes a tainted halo |
| `mu1.elTest()` / `[VPT]` watch | gate F: Casimir conservation, dated focal/collapse forecasts, İ |
| `mu1.rekeyTest()` | the closed-form re-key of V̈ under a kernel edit |
| `mu1.wearTest()` / `mu1.wearGo()` | the arrest law; the two-regime transport cost |
| `mu1.kernTest/qTest/virialTest/specTest` | gates B/C/E/D respectively |
| the mirror + `lock→A` | the register's evolution law, continuously, against real GPU physics |
| `mu1.bankScan()` | recall integrity: a moved moment is found at its offset |

The localization gauge m (circular resultant length) is attached to spatial observables so
they *refuse themselves* when the state fills the torus — a meter that knows its own domain
of validity.

---

## 9. Boundaries and open edges

- **Precision**: the machine's truth grain is f32 at every observable state; f64 exists
  only between quantizations. This is a choice (wire = GPU = contract), not a limitation.
- **Cost**: register physics is ~3 ms/step per living slot at 128² — four living worldlines
  fit a frame budget; the tempo governor owns overload (the convoy law applies to CPU
  matter as it did to GPU matter).
- **The mirror is optional but valuable**: with it off, the register's assertions stand
  unverified by construction (stated in its own logs). The purity of ⌀PDE and the
  availability of an independent oracle are both features; using neither would be faith.
- **Open**: halo-exchange sharding (rung 3) for seam-exact regional witnesses; δ-residual
  plate compression (descriptor + truncated dressing residual); the exactAtt default
  (integer/exact split already in the transport path); a replicated calibration verb if
  the wear constants are ever to *retune* the drive rather than advise it.

---

## 10. Mobility: what can change without breaking the machine

The architecture separates an **invariant core** — the discipline — from a set of
**swappable parts** — the physics, the geometry, the groups, the views. The core is small:

1. **The naturality law** (morphisms pure in shared step + shared state) and its stamped-
   input replication;
2. **The wire-lattice law** (observable states live on the lattice the wire can carry);
3. **The measured-defect discipline** (every abstraction ships the instrument that can
   refuse it);
4. **The adjunction shape** (a compile/materialize pair between a small replicated model
   tier and a witness tier, with the counit defect first-class).

Nothing else is sacred. Concretely swappable, each along an existing seam:

- **The medium.** Any torus-convolution stencil is admissible: λ(k) derives automatically
  (the coordinate-ring evaluation), the spectral engine, the knee, virialRateX, and the
  re-key law all follow from the descriptor. Any splittable local nonlinearity slots into
  the same Strang position. The gates are *procedures*, not results tied to this kernel —
  a new medium re-runs them and earns its own numbers.
- **The geometry.** Any finite abelian group with a fast character transform can replace
  (ℤ/G)²: the Gelfand/Cartier/Fourier–Mukai layer (§6.1–6.2) is stated at that
  generality. Radix constraints (power-of-two today) are an implementation note, not
  architecture.
- **The group ledger.** Charges are appended per *measured* symmetry — the ledger grows by
  gates, never by decree. The SL(2,ℤ) restriction (§3.6) is a per-operation dial already;
  a genuinely non-abelian register sector (spin, polarization) becomes admissible exactly
  when a medium carries an observable to pin it to — the discipline states the entry
  condition rather than forbidding the extension.
- **The clock.** Any deterministic generator can drive the kernel schedule; the staging
  queue (swaps land at shared steps) is the only contract. The present fractal IFS clock
  is one program for the dispersion, not the only one.
- **The slot bank.** Slots are one type with modes; their number, and which are living, is
  configuration. Living costs ~3 ms/step each; the tempo governor owns the budget.
- **The view and the verifier.** Rendering is outside the contract entirely (any shader,
  any colormap, any pose law — the film discipline is the only rule). The oracle is
  pluggable: the GPU mirror today, any independent implementation of the same discrete map
  tomorrow — the mirror's role is defined by *lock→A*, not by its substrate.
- **The topology of execution.** One peer, many peers, regional shards across tabs or
  machines — the descent layer (§5) makes execution topology a view-tier choice with a
  measured gluing defect, invisible to the reflector.

The test for any proposed change is mechanical: does it preserve the four core items, and
does it arrive with its instrument? The v1→v7 history of the living declaration (recorded
in the ledger, omitted here) is the proof-by-construction that even the machine's own
evolution law was swappable under exactly this test.

### 10.1 Thin apps: self-hosted matter as the clock of not-rich matter

The register suggests — and earlier arcs of this project already demonstrated in field
mode — a two-tier matter economy:

- **Rich matter**: a full living worldline (the register engine, a dressed field, charges,
  breathing Ω, τ beats). Expensive (~ms/step), physical, self-hosting: it *generates*
  structured shared time — bar beats, τ ticks, kernel re-keys, breathing phase, precession
  ∠(t).
- **Not-rich (thin) matter**: sprites, geometry, sound schedules, UI state — anything that
  cannot afford (or does not need) a field. Thin matter stays deterministic *for free* by
  consuming **only replicated beats**: the register's τ/bar/Ω/∠/re-key events are pure
  functions of shared state, so any thin app driven exclusively by them inherits the
  entire determinism contract without touching a field or proving anything new.

This is the **beat bus** pattern: the register as a clock-and-phase generator for a
population of cheap replicated apps. The measured precedents are already in the project's
findings: an operator self-hosted as a *limit cycle* on a soliton clocks a second modality
exactly (temporal multiplexing at fidelity 1.000 — time separates, space does not);
sound lives in the per-step dt schedule (phase-rate demodulation), not in space; geometry
rides limit-cycle phase on the shared soliton rather than owning scratch fields. The
register engine upgrades the pattern: the beat source itself no longer needs a GPU, a
mirror, or a rich host application — a ⌀PDE register worldline is a self-contained,
snapshot-joinable, bit-verified metronome with physical texture (its beats carry the
medium's own breathing and re-key structure, not a synthetic LFO). One rich worldline can
clock arbitrarily many thin apps; the thin apps' only obligation is the naturality law's
easiest clause — *read beats, never frames*.

Demo recipes for all of the above: `doc/abstract-holographic-demos.md`.

---

## 11. One paragraph, plainly

U1 is a small distributed computer in which the machine state is a group-theoretic
register, the memory is interference read by correlation, and the processor is a wave
medium that the register executes on itself — Lisp's meta-circular trick performed on
physics instead of syntax, under Croquet-style replication where determinism is naturality
in shared proper time, with category theory supplying the honest bookkeeping (an adjunction
with measured defects, a presheaf of shardable witnesses with a measured gluing residue)
and harmonic analysis supplying the executable duality (characters as the spectral
register, correlation as the dual product). Its distinguishing discipline is not any single
mathematical identification but the rule that every identification must arrive with an
instrument that could refuse it — and that the numbers those instruments return (0.2 %,
1e-10, 3.6e-7, 0.1 %, 2 %, 0 GPU steps, max|Δ| = 0) are the actual content of the claim
that this is a computer made of physics rather than a picture of one.
