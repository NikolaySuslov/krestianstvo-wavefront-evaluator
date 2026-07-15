# KWE-GR, in one page

*Krestianstvo Wavefront Evaluator — the general-relativistic replication architecture.*
*Full document: [`kwe-gr.md`](./kwe-gr.md). Measurements: [`proper-time-metric.md`](./proper-time-metric.md), [`computer.md`](./computer.md).*

## The idea

Classical replicated worlds (Croquet/TeaTime, classical Krestianstvo) give every peer
**one shared clock**: a reflector orders events, identical deterministic programs replay
them, and `future(dt)` schedules work in the single logical time. Every part of the
world ages at the same rate — a special-relativistic universe at best.

KWE-GR adds one primitive and lets everything follow from it:

> **Every worldline inside the world may carry its own proper-time clock, advanced by
> its own beats — and the platform paces, replicates and schedules against that clock
> without ever knowing why it ticks.**

An object that is time-shared runs slower *in its own time*. A parked object does not
age — and costs nothing. `ctx.futureTau(dτ, msg)` fires when a node *has aged* by dτ,
not when the wall says so. The kernel knows **that** a worldline has a clock, never
**why** — the beat source can be a soliton's lock ripple, a fractal cascade's events,
a convergence loop, or literally a musical metronome.

## What it does (all measured, not metaphor)

- **Time dilation**: an n-way time-share runs each worldline at 1/n proper rate — one
  world aged 30 τ-units while its neighbor aged less than 1, on byte-identical peers.
- **The twin paradox**: journeys generate beats, standing doesn't; a traveling world's
  register accumulated Δφ = ω·Δτ (measured 2.078 vs 1.900 predicted) while the
  stay-home twin's control arm read exactly zero.
- **Clocks as observables**: registers precess ω per own beat — a phase comparator with
  measured slope = ω to 0.1%.
- **Observer-relative memory**: stored moments carry the recording observer's frame and
  age; recall reads the elapsed proper time back as a phase (measured exact) — and in
  the musical demo, you *hear* the remembered moment return aged.
- **Coupled clocks**: couple two registers and you get Kuramoto physics of proper-time
  oscillators — entrainment (a channel can *wake* a parked clock), suppression, and a
  measured, per-encounter consensus budget.
- **The deep result**: replication and simultaneity decouple. Peers stay byte-identical
  in every hash while the worldlines *inside* the shared world honestly disagree about
  "now" by ω·Δτ. History-level consensus is unconditional; a shared "now" has a
  relativistic budget.

## Why you don't need the heavy physics

The relativity lives in **temporal laws**, not in any particular substrate equation:
the step-budget law (time-sharing divides steps, not walls), per-worldline beats, and
registers that precess with aging. These operate on *any* deterministic state with an
inner product. The proof is in the repo: the full soliton laboratory
(`apps/medium.js`, where every law was discovered and calibrated) and two thin apps —
`apps/observers.js` (a 16×16 toy field) and `apps/rhythm.js` (a synth voice: ~8 floats
of matter per worldline, time dilation as an audible glissando) — run the **same**
kernel, the same experiments, the same meters.

An app owes the platform exactly four things: per-worldline **state**, a deterministic
**step function**, a **beat source**, and CPU-readable **canonical stores**. Everything
else — worldline clocks, τ-scheduling, observer descriptors with a composing lens
algebra, coupled-clock physics, observer-stamped memory, snapshot/replay join, two-peer
byte-verification — is imported law (`kwe-tau.js`, `medium-core.js`,
`soliton-algebra.js/lensU1`), about 300 lines of app for the whole apparatus.

## Classical vs KWE-GR

| | classical | KWE-GR |
|---|---|---|
| time | one clock per world | + a clock per worldline |
| scheduling | `future(dt)` | + `futureTau(dτ)` in the node's own aging |
| dilation | inexpressible | the step-budget law; parked = not aging |
| observers | implicit | first-class: (readOp, clock, register) |
| memory | snapshots | + plates that remember *who* recorded them, and *when in their life* |
| consensus | byte-identity = agreement | byte-identity ≠ shared "now" — phase consensus is budgeted |
| app's burden | the whole simulation | only the matter |

The classical stack answers *"do all peers compute the same world?"*
KWE-GR adds the question it couldn't ask: *"do the inhabitants of that world agree what
time it is?"* — and gives it a measured answer.
