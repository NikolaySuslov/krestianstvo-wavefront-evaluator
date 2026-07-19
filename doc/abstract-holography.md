# Abstract Holography — the ⌀PDE arc

*medium-u1: closing the meta-circle of the U(1)/ℂ* register over the soliton medium.
The week of 2026-07-14 → 2026-07-17, consolidated. Every claim below carries the number
that earned it; every boundary is stated as a measurement, not a preference.*

---

## §1 The two organizing principles

The arc produced many gates, verbs, and instruments. In hindsight they are all instances
of two structures. We state them first so the rest of the document reads as their
unfolding.

### §1.1 The naturality law (the one determinism criterion)

Let **T** be the shared-time re-indexing of state: the grid of shared steps
`k = floor((monClock − c0)·spp/rate)`, the bars `k/21`, the subtick stream — all pure
functions of the replicated clock. The law:

> **Every model morphism must be natural in shared time.** A verb, drain, capture,
> anchor, or gate may read only `(k, shared state)`. Any read indexed by a peer-local
> coordinate — the frame boundary, the rAF moment, a point-sample of the oscillating
> clock — is a non-natural transformation, and it *will* fork.

This single criterion retro-dicts the project's entire fork ledger: the kernel swap
applied at the peer frame (the root fork), the beat-EMA sub-grid drift, W-aging at
frame-end, `W.field` read at drain (a previous frame-end value), the autoc anchors,
the tempo governor's back-swing sampling, end-of-frame `_lensOp` in mirror verbs.
Each was fixed by the same move: re-index the read to `(k, shared)`. The law is also
predictive — audit any new drain/capture path for a non-(k, shared) read *before* it
ships. The `makeStampedInput` pattern is this law as an API: handlers receive the
shared index and context and cannot reach anything else.

Corollary (the oscillating clock): the IFS world clock swings backward; any observable
derived from it must be **enveloped over the oscillation** (forward-phase peak per
window), never point-sampled. Three instruments have re-learned this independently
(the drive's monDir gate, the tempo governor, the virial fit window).

### §1.2 The adjunction of tiers (the honest boundary as a defect)

Two maps connect the tiers:

```
        compile  (wabs / store / autoc)
  Field ────────────────────────────────▶ Register
  Field ◀──────────────────────────────── Register
        materialize / project (𝔸 render, mirror seed)
```

They form an *approximate adjoint pair*, and the week's gates were measurements of its
unit and counit:

- **Register → compile∘materialize is exact by construction** — the register cannot
  tell which side of the abstraction it aged on (the abstract drive runs the *identical*
  beat/leash/verb laws as the field drive; this indistinguishability is deliberate).
- **Field → materialize∘compile has a measured defect** — the resumption test:
  materialize and re-step; lock→A recovers ≈1 iff the abstraction was faithful. The
  mirror is this counit made continuous (a live PDE injection-locked to the register);
  autoCompile is the counit iterated (declaration staleness ≤ N bars by construction).

The practical content: **defects compose along arrows.** Any pipeline's fidelity should
factor as the product of its arrows' measured defects; a composite that loses more than
its factors contains a hidden non-functorial read (see §1.1). This is a refusable
prediction and a one-evening instrument on existing machinery.

---

## §2 The architecture

One observer register (slots W/V/P1/P2: descriptor `(∠, β, ω, kx, ky, A)`, worldline
clock τᵢ, leash, flags), one soliton substrate, and four **modes** distinguished only by
where the field lives and whether anyone verifies it:

| mode | field | verified | use |
|---|---|---|---|
| physics + regTrace(true) | W's, model-tier | solH per Q-boundary | fork hunting |
| physics + regTrace(false) | W's, unverified ("W as its own mirror") | never | classic live world, full speed |
| **⌀PDE + mirror** (boot default) | V's, elective witness | never | the closed register; physics as a view |
| ⌀PDE pure | none | — | the declaration alone; joins ship no ψ |

- **⌀PDE close** (`wabs`): every born slot compiles to (envelope w0 + descriptor) at a
  shared drain step; the abstract drive advances the same laws with zero grid steps;
  **regH — a few dozen exact f64 scalars — becomes the entire determinism contract.**
- **Materialize** (`wabs 0`): bar-exact projection back into the medium (never with the
  render-frac — frame-local, §1.1); the ring re-uploads; the PDE resumes. The resumption
  *is* the oracle.
- **Mirror** (`mirror`): an independently integrated PDE copy injection-locked to the
  register's attractor, replaying the kernel and attractor *schedules* at shared steps
  (pure register functions). Deterministic by construction, verified never, causally
  inert — unless routed (below). Field-mode mirror = the classic Lyapunov instrument
  (λ≈0, differences conserved).
- **View routing**: in ⌀PDE+mirror, `view:W` raw shows the mirror ("LIVE via MIRROR") —
  the classic canvas, the closed architecture underneath; the 𝔸 declaration is the view
  cycle's `𝔸desc` mode; `mode:physics ⇄ mode:⌀register` is the one-press toggle.
- **Boot**: a fresh leader runs physics only as the *compiler pass* (seed → dress →
  lock, ~8 bars) then auto-fires the close pair once (`[MU1-BOOT]`); joiners adopt the
  world's mode from the snapshot; `mu1.autoClose(false)` keeps classic.
- **Mirror-sourced verbs**: in ⌀PDE, `⎙rec/store/recall(⇄)` split per §1.1 — register
  context snapshotted at the drain step, field bytes read in the mirror loop at the
  *same* k; births land in P1 as 𝔸-slots. Unpinned coevo remains field-mode-only
  (ordering: the register computes before the witness within a frame).

**The PDE's four roles** (its full demotion ladder): model (classic) → **compiler**
(dress envelopes: store/wabs/autoc) → **oracle** (materialize, kernTest/qTest/
virialTest/specTest) → **renderer-with-real-physics** (mirror).

**𝔸-slots** (descriptor-only): state = (dop, pos, obj, envelope, descBar); dynamics =
ω per shared bar + the one leash law; view = one fragment shader evaluating the linOp
`B(x−off)·e^{i(φ+k·(x−c))}` per pixel (~7 uniforms/frame, nothing read back — GPU floats
never enter the contract). `recall𝔸` = closed-form cue⊗bank on descriptors (0 steps).

---

## §3 The gates (each rung measured against the field)

| gate | claim | number |
|---|---|---|
| **A** — symbol | λ(k) of the ring kernel is closed-form from the descriptor (L̂ is a torus convolution; `iψ_t = −½L̂ψ`) | exact; D≈2.4·I, aniso 1.005; **dipole discovered** (below) |
| **B** — transport | packet drift = exact-symbol group velocity, packet-averaged | residual ≤0.2% at all k∈[0.05,0.3] (quadratic slice degrades 9→36% — its honest reach) |
| **C** — q register | (σ, b) evolved by *the engine's own recipe* projected on the Gaussian ansatz; cubic limit recovers ḃ=−γP/2πσ⁴ | P_c derived; spread quantitative (0.1–9%/1200 steps); collapse onset correct; free equilibrium = **tight core** (confirmed: I_max ×15–17) |
| **D** — spectral register | the engine's *discrete* step diagonalized per mode (`M = S1S2S1`, det 1; −dt exact inverse — the palindromic split proves why ±T round-trips are clean) | ≡ x-space leapfrog to 1e-10; **vs GPU: the f32 floor** (max|Δ| 3.6e-7; T=64 → 5.5e-7, pure f32 accumulation) |
| **E** — virial ledger | ansatz-free sl(2,ℝ) group identity, engine convention: **V̈ = 4·D·H** (the literature's 8H is the kinetic-coefficient-1 convention) | ratio **0.975**, parabola RMS 0.000%, H drift 0.002% — *and the instrument caught the wrong factor 8 first* (perfect parabola + perfect conservation + ratio 0.487≈½) |
| **F** — Ermakov–Lewis Casimir | the (V, V̇, H) triple carries the invariant **I = V̈·V − ½V̇²** — conserved, and *predictive*: a converging probe's focus is called from t≈0 register data alone, **t\* = −V̇₀/V̈, V_min = I/V̈**, with V̈ from the analytic ∇λ of the stencil (`virialRateX`); linear V(t) is an *exact* parabola for **any** dispersion (v_g is a per-mode constant of motion — no quadratic band assumed) | parabola RMS 9e-7·V0; curvature register-vs-measured 1.0001; Casimir drift 1.5e-3 (chirped linear); **waist called to 0.1% of V0, focal time to 1%**; cubic keeps the parabola (RMS 4.6e-4 — the group law survives NL); saturation bends it ×14 (the K-breaking measured). `mu1.elTest` = the GPU oracle. *The Casimir also caught its own instrument's bias: a centered-difference v_g (1.7% off) integrated into a 4.6e-2 drift — the invariant is a sharper curvature meter than the parabola fit.* **Wired live**: the `[VPT]` watch carries the Casimir tier — V̇ from consecutive shared-bar readings (Δt on the shared step clock), the boolean regime upgraded to a *dated* forecast ("freed: focus/V→0 in N steps", full quadratic — no chirpless assumption), and **İ = the sl(2)-work of the drive** (conserved on free flight ⇒ any drift is exactly the pin+cap maintenance power, as one scalar — kernel bumps are *bookkept out*: the re-key ΔI = ΔV̈·V is closed-form from the two descriptors, headless-pinned to 2%, `mu1.rekeyTest` = the GPU micro-gate). `mu1.wearTest` = Law 7's gauge: İ(β) under the verbatim pin sequence + the lock each β buys — the injection lock's cost-vs-hold trade as one measured table. |

Gate-C ansatz status: eliminated wherever exactness exists (D, E, recorded envelopes —
sech/Gaussian never entered a live path); retained only as a variational *instrument*
where no closed form exists (σ*, P_c); deliberately unwired from slot dynamics (a locked
state is stationary in q — a breathing display would be decoration).

**The sl(2) charges are register-resident** (gate F's meta-circular rung): V and V̈ are
anchor-invariant — pure functions of the compiled envelope + stencil, i.e. register
content — so `W.sl2 = {V, V̈, I}` is captured at the compile doors (wabs/autoc),
re-keyed in closed form when the clock moves the kernel, cleared at materialize, and
aged by the *measured* arrest law (a held state is stationary in the invariant). The
`[VPT]` watch prints the register's assertion beside the witness's measurement — the
lock→A pattern applied to the sl(2) sector. In ⌀PDE the register now carries the full
certified group ledger: U(1) phase · translation (leash) · scale (q) · sl(2) charges.
The wear constants are first-class too: β\*≈0.15 (capture, the Casimir-flow zero
crossing) and the two-regime cost law (below β\*: the walk *sheds*, ~50–380× dearer;
above: the ride costs ~linearly in speed) — `mu1.grip()` gives the verdict, the
transport log warns below capture; telemetry only, no silent drive retuning. Measured
observables now refuse themselves when invalid: the torus moment carries a localization
gauge m, and lag prints n/a when the state fills the torus.

---

## §4 Findings (new physics of this medium)

- **The kernel dipole**: live kernels are slightly non-centrosymmetric (s_x ≈ 2.4e-3,
  wandering with the fractal clock) → k-odd gain `e^{−(k·s)t}`, measured with sign flip;
  compounds ~25% over 28k steps; **cancels exactly in ±T round-trips** (rt=1.00000).
- **kKnee = j₀,₁/r_max is the clock's own low-pass — and the medium's collapse
  arrestor**: supercritical collapse pumps power past the knee where rings anti-couple;
  arrest at the lattice scale into a **stable pixel filament** (+ pedestal + halo).
- **The pin is load-bearing three ways** (injection-lock trilogy): phase basins
  (earlier), the width channel (the demo's wide soliton is pin-maintained; the free
  equilibrium is the filament), and spectral content (**pinned states live above the
  knee** — dressed-soliton fidelity 0.32 at a 2×kKnee cut; the knee bounds free
  *dynamics*, not maintained *states*; compression must be state-adaptive).
- **Compression belongs to the descriptor, not the spectrum**: the dressed state is
  point-structured (k50 ≈ 3.0 rad/px — letterA *is* dots); radial-k truncation gives ×1;
  the maximal compression of a nameable state is its descriptor (~10 floats).
- **The two-peer freeze (since the archived medium)**: fixed demand (clock×·spp ≈ 268
  steps/s) vs degraded supply (two tabs, one GPU → ~215) → permanent deficit → backlog
  spiral to the 1024 cap → multi-second frames. Not protocol. Remedies: the **convoy
  law** (`tempo`, replicated proper-time divisor — dilate matter's time, never drop
  steps; auto-governor with enveloped backlog per §1.1) and the structural one — ⌀PDE
  makes GPU demand *elective per peer*.
- **The join freeze**: 4 synchronous multi-MB JSON passes on heartbeat-carrying
  channels (head-of-line blocked clock). Fix: f32-base64 wire codec (f32 = GPU truth;
  ~15MB → ~344KB observed) + regenerate plate atts (pure register functions don't ride
  wires).
- **Determinism cost now scales with the model, not the field**: dropping field
  verification (solH etc.) was most of the measured mirror-mode speedup; physics cost
  was unchanged. Trust became ~free because it moved into regH.

---

## §5 The duality harvest ("gate D = Cartier duality", cashed)

FFT on (ℤ/G)² is finite Fourier/Cartier duality; everything it can buy this
architecture is now live or priced:

- **λ-grid fast build**: the symbol *as* a character sum — the stencil-DFT (one image +
  one FFT, ~100× over per-mode evaluation; was a live main-thread stall on young-world
  kernel churn).
- **Closed-form M^T**: Chebyshev power `M^T = U_{T−1}(x)M − U_{T−2}(x)I`, x = 1−hf,
  complex-safe (~5× fewer mode-loop flops; regression-pinned to the leapfrog).
- **spectralShift**: exact torus translation at any fractional offset (unitary,
  invertible; vs bilinear's ~18%/half-pixel). Live behind the replicated `xatt` toggle —
  it changes the *pin target*, so adoption follows the oracle protocol (watch lock→A).
- **crossCorrScan / recall⇄**: shift-invariant recall — all N offsets in one dual pass;
  finds a banked moment the state has moved away from and **relocates the lift** to the
  cue (δ-sign law regression-pinned). Default recall button; `bankScan` is the meter.
- **N/A by nature**: the live nonlinear loop — SPM is x-diagonal, the kernel k-diagonal;
  their interleaved non-commutativity *is* the PDE's irreducible content, and exactly
  where 6-float compression must fail (collective coordinates live on orbits where the
  commutator is controlled).

---

## §6 Display: the shared film

Frames are peer-local *events*; simultaneity is bounded by clock sync (TeaTime's own
property). But the trajectory is shared at every step (batch-invariant stepping), and
subticks are model events (same count, same order). Hence:

- smooth mode = peer-sampled indices of the shared film (max fluidity);
- `frameLock(on, grid)` / `subtickView()` = paint exactly the shared-boundary states,
  at most one paint per index, `film@k` stamped — **identical k ⇒ identical pixels**
  (same-GPU byte-exact; 𝔸 view exact across any GPUs); rAF degrades to a polling loop;
- the register's smooth ω/pose interpolation between bars is honest display of shared
  clock values, peer-sampled.

---

## §7 Rejected proposals (the no-tricks criterion at work)

A formalism/shift earns its place iff it is exact where it claims exactness, buys a
measured prediction/instrument/speedup, and remains vetoable by the oracle. Rejected
this week, each with its salvage:

1. **sech ansatz projection** (×3): no closed form exists for this saturable+IFS
   medium; 2D cubic has no stable soliton (Townes); "a picture can't collapse" removes
   the physics. Salvage: recorded envelopes (which became w0).
2. **Density-dependent Hutchinson maps**: Talanov's L(t) is global-time, not local
   density; a field-dependent kernel destroys the symbol, the spectral register, and
   the shared-kernel law. Salvage: none needed — saturation already lives in the SPM
   stage where the split keeps everything analyzable.
3. **"Lens-Time" local dt**: a garbled memory of dynamic rescaling (global dτ = dt/L²);
   local-intensity dt is incoherent and peer-forking. Salvage: the engine already
   contains the full Talanov element as first-class operators (metric lens ∘ lensPhase
   ∘ shared dt schedule) — usable as a symmetry test whose residual *is* the K-breaking.
4. **Sheaf/algebraic-geometry reformulation**: H¹⇒peer-honesty is a category error
   (peers hold copies of one global section, not local patches — gluing detects
   nothing; finite-space cohomology vanishes trivially); blow-ups resolve algebraic,
   not analytic singularities (the real collapse arrests at the *lattice* — measured).
   Salvage: the Cartier remark (§5), the Ermakov–Lewis invariant as a gate-F candidate,
   and descent/gluing parked as the *right* math iff worlds ever shard by region (a
   genuine local-to-global problem; today every peer holds the whole section).

The pattern across all four: each tried to relocate truth from measurement into
formalism. The arc's answer, every time: a formalism earns its place by predicting a
number the medium can refuse.

---

## §8 The honest boundary (current)

- **Linear propagation** — exact in the algebra (f32-floor proven; the holography
  verbs run register-side).
- **Virial/collapse law** — group-theoretic and verified for smooth states; D-breaking
  total for deep-supercritical (kin 0.85 vs |nl| 98 leaves the quadratic band at step
  one — the "D" in the identity loses meaning, honestly).
- **q-dynamics** — quantitative in spread, onset-correct in collapse, exits at the
  lattice floor (σ < 0.5 px = validity edge; never integrate through the singularity).
- **Nonlinear dressed shape** — compiled envelope + oracle (continuously via autoc).
- **Discovery** — the field's job, permanently: every law now in the register was found
  in the field first. The register replays knowledge; the medium creates it.

### §8.1 Descent rung 1 (the cover law — landed)

Can one peer carry the sharding structure for free? In this architecture, yes — and
the reason is the arc itself: the global model is the *register* (tiny, replicated
whole), the field is a *witness*, so a cover of the field is view-tier structure with
zero contract stakes. `medium-core` now pins the two facts (`leapfrogStepX`,
`coverStep`, `capReduce`, +5 regressions):

- **The cocycle, bit-for-bit**: for the local ops (kernel leapfrog, finite support
  ≤ reach/substep; pointwise SPM), stepping a P×P cover with halos of width 3·reach
  and gluing **equals the whole-torus step to the last bit** (2×2 and 4×4 pinned at
  max|Δ| = 0). Bit-exactness is an *order* property: the per-cell term order is fixed
  and shared between the paths.
- **The obstruction, named**: the energy cap is the one global datum. Per-patch local
  capping forks the glued field (demonstrated); the monoid reduce of per-patch
  partials reproduces the global cap — to f64 *order sensitivity*, so **the reduction
  tree is part of the contract**: shards must ship (partial, patchIndex) and fold in
  one shared order.

Rung 1.5 (live): `mu1.coverTest()` runs the law on the *real* current field — the
2×2 cover + glue vs the whole-torus step (must be bit-for-bit), the clean overlap
residual (exactly 0), and a deliberately tainted halo cell that must light up
*localized* (`coverResidual` — the spatial fork-finder: redundant overlap computation;
it answers WHERE a non-local read leaked, not just whether — the descent analog of
solH). A pass means the live medium is shardable as-is.

Rung 2 (regional mirrors) — **live** (`mu1.region`): each peer — or each *browser
tab* — runs the witness only for its region (the eye passes are GPU-scissored to R, so
cost ∝ |R|; the cap's reduce sees the whole texture but its scale never touches the
declaration band); outside R is held at the register's bar-exact declaration, kept
coherent across ping-pong parity by writing both buffers. The seam-glue meter
(witness vs declaration over the 16px inner band) prints per bar. Region choice is
peer-local — a view dial, not replicated. **Two protocols, both honest:**

- **No-exchange sharding (the default-KWE way — the reflector is untouched):** a
  regional witness takes its halo boundary from the **register's declaration** (the 𝔸
  projection) instead of from a neighbor. This is honest by the **light-cone law**
  (pinned bit-for-bit): wrong/stale boundary data can only touch the seam band of
  width 3·reach per step — the interior is *untouchable*; and the pin continuously
  contracts the band error (§7.80 contraction). Since every peer holds the whole
  register, no peer needs anything from any other peer beyond the ordinary replicated
  inputs. Two tabs regionally mirroring one world is then also the structural fix for
  the shared-GPU spiral: each tab pays only its region.
- **Halo-exchange sharding (rung 3 classic):** strips at bar cadence (~KB/bar/seam),
  cap partials folded in the shared tree, the overlap residual as the live
  wire-integrity meter — for when seam-band exactness matters.

**Where sheaves become part of the arc, not an instrument:** the witness tier *is* a
presheaf over the region poset — F(U) = the regional mirror with declaration boundary;
restriction = taking a smaller region; the **gluing defect is a measured number** (the
seam-band residual), zero in the interior by the light-cone law. The register is the
trivially-global object (the constant/base sheaf every peer holds in full), and the
exact global field is the *sheafification* of the witness presheaf — reachable two
ways: **by wire** (halo exchange) or **by trust** (declaration boundaries + the pin's
contraction). Same shape as §1.2: an approximate categorical structure whose defects
are first-class measurements. Sharding never touches the contract, because the
contract never left the register.

The composite-defect instrument (§1.2) is live: `mu1.defTest()` measures the three
arrows in one call — *door* (live bilinear materialize vs the exact spectral
projection: the door's own resample + border loss, ≡1 on the id path), *state*
(witness vs the exact declaration: staleness + dressing drift with the door's loss
removed), *composite* (witness vs the live declaration = lock→A) — and checks the
factorization composite ≈ door×state; a composite short of the product flags a hidden
non-functorial read. Under a shard region it adds the two sharding-specific refusals:
outside R the witness must equal f32(declaration) **bit-exactly** (a scissor leak or
ping-pong parity fault shows here before it ever reaches a seam), and the seam band
must be no worse than the interior (sharding contributes no defect of its own).

Open threads: δ-residual plate compression (descriptor + truncated dressing), dipole
Im-λ packet average (~20% residue at k=0.3), exactAtt default (pending its lock→A
session), bar-interleaved drive (would admit field-fed coevo in ⌀PDE), descent rung 3
(halo exchange for seam-exact witnesses — only when a world outgrows
declaration-quality seams).

---

## §9 One paragraph, for the record

The PDE was eliminated as a runtime, retained as a compiler and an oracle, and
superseded as a specification: the f64 register is now the more exact statement of the
medium's linear law, and the f32 medium is its slightly noisy realization — the
relationship of a theory to its laboratory. The instrument corrected the theory twice
(the virial factor, the knee narrative) and confirmed it everywhere it claimed a
domain; a one-way "pure algebra" architecture would have kept both errors silently.
The distance to "full abstraction" is not an engineering shortfall — it is the width
of the no-tricks principle, and the gates show that width can be measured, named, and
shrunk one law at a time.
