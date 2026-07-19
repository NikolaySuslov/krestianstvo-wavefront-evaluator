# The Abstract Holographic Computer (U1) — Abstract

*Krestianstvo Wavefront Evaluator · medium-u1*

**U1 is a small distributed computer whose processor is a nonlinear wave medium, whose
memory is holographic, whose machine state is an operator-algebra register — and whose
physics executes inside that register**, with the GPU reduced to a rasterizer. Every
architectural claim in the system is attached to an instrument that can refuse it, and the
numbers those instruments return are the content of the claims.

**The machine.** A complex field on a 128² torus evolves under a discrete engine map: a
fractal-ring Laplacian whose kernel is rebuilt live by a self-similar IFS clock (the
medium's dispersion is itself a running program), saturable self-phase modulation, an
energy cap, and an injection-lock pin. The machine state is a *register* of four uniform
slots — each a U(1)/ℂ* descriptor (phase, stiffness, precession, tilt), a worldline clock,
a leash, a compiled envelope, and a set of certified physical charges. Memory is
holographic: moments are banked as interference plates by spectral propagation and
retrieved by correlation — zero-lag ("show me where it was"), shift-invariant ("bring that
moment here"), or descriptor-only (a closed-form read with no field at all) — and a
recalled moment is born *living*: re-instantiated as a running worldline, not an image.
Since the register-engine rung, every evolution step runs register-side in CPU f64
arithmetic on the f32 lattice that is simultaneously the wire format and the GPU's own
grain; a live counter proves the GPU executes zero physics steps in the default mode.

**Replication and time.** The system is a KWE world in the Croquet/TeaTime lineage: a
stateless reflector stamps verbs; every peer deterministically replays the whole model;
joining is snapshot restoration. Krestianstvo's continuous-pull time makes each peer's
frames private samplings of one shared timeline, and KWE places the clock inside the model
it times. The single determinism criterion is a **naturality law** — every model morphism
must be a pure function of (shared step, shared state) — whose corollaries organize the
engineering: verbs stamp their targets at press time; clock-derived observables are
enveloped, never point-sampled; displays paint only shared-grid states; a dynamical field's
lattice equals its wire's lattice at every observable state. Taken seriously, these
constraints reproduce the conceptual skeleton of general relativity, each element measured
in-machine: per-slot proper time with live dilation, a replicated lapse (tempo, the convoy
law), foliation as gauge, relativity of display simultaneity with the bar-grid film as the
invariant events, a bit-exact light-cone bounding all influence, and a matter-tells-geometry
feedback gate. Space follows time: the witness tier is a presheaf over regions whose gluing
data is measured — a bit-for-bit cover cocycle, the energy cap as the one global
obstruction, declaration-anchored halos that let two browsers shard one world's physics
with no new wire, and a per-bar seam-glue defect that factorizes as predicted.

**The mathematics, load-bearing.** The linear engine lives in the commutative C*-algebra
of torus convolutions; Gelfand/Pontryagin duality is an executable component: characters
diagonalize the step (verified against the GPU at the f32 floor, max|Δ| ≈ 3.6e-7),
translation is character multiplication, correlation is one pass through the dual — the
FFT acting as the finite Fourier–Mukai transform with the Poincaré bundle as kernel. The
noncommutativity of the position-diagonal nonlinearity with the momentum-diagonal kernel
*is* the physics. Above the kinematics sits the group tower: the finite Heisenberg–Weyl
group (Stone–von Neumann explaining why one buffer carries every modality; holography as
group arithmetic), the symplectic/metaplectic sector (engine operators as ABCD generators,
the FFT as the π/2 element; the Gaussian register's complex width evolving by Möbius
action on SL(2,ℝ)/SO(2)), and sl(2,ℝ) as observables — the virial identity V̈ = 4DH, its
Casimir I = V̈V − ½V̇² as a conserved charge whose flow İ meters the drive's work
(coadjoint-orbit geometry as a wear gauge), and dated forecasts (focal time, waist) called
from register data and verified on the live kernel to 0.1 %. Algebraically, the state
buffer is Mumford's theta module in the finite case: a periodic Gaussian is a finite theta
function and the width register is a two-float path in the genus-1 moduli of theta
structures; the kernel's measured dipole is the obstruction to descent to the Kummer
quotient, cancelling exactly in ±T round trips. Each representation's reach is measured,
not assumed: the quadratic (metaplectic) laws hold at the few-percent level for smooth
states and fail in named, quantified ways beyond.

**The computer science.** The system is a meta-circular evaluator completed in physics:
the register runs the evolution law of the medium that produced it — the model of the
medium *is* the medium, at the same grain. `wabs` is quote/eval (reify a running field
into data; evaluate data back into a running field), with the round-trip law measured. The
IFS clock is a Y-combinator whose fixed point is the kernel; the soliton is the fixed point
of the step map, reached by the injection lock's contraction (the arrest law: holding is
free; İ zero-crosses at the capture threshold β\* ≈ 0.15, matching an independent
measurement); a plate is a closure — descriptor as code, envelope as environment — and
recall is live closure application. Slots are one type with modes (driven, living, parked,
mirror, declaration), Smalltalk-style; the instrument deck lives inside the image.

**The discipline.** regH and per-slot envelope hashes check naturality forever; `pure()`
counts GPU physics steps (0); `defTest` verifies that pipeline fidelity factors into its
arrows' measured defects (residual ~4e-6); `coverTest` re-proves the descent cocycle on
the live field; the mirror — an independently integrated GPU copy injection-locked to the
register — stands as a permanent oracle. The machine's epistemology is that a claim
without a refusal channel is decoration; its distinguishing results are the refusals it
survived: ≤0.2 % transport, 1e-10 spectral identity, f32-floor GPU agreement, bit-for-bit
gluing, 0 GPU steps, and a register that names the medium's focal events before the medium
reaches them.

*Full treatment: `doc/abstract-holographic-computer.md`. Structure and defect ledger:
`doc/abstract-holography.md`. Run ledger: `doc/computer.md`.*
