# Native IFS Holography — Demos & Multimedia Walkthroughs

*The step-by-step build of the multimedia IFS hologram: sound, the shared clock, combined-field
multiplexing, the heartbeat-driven and clock-modulated sound, the unified/united field, the live
SOLITON, voice-as-events, the arpeggio, and clock melody.*

> **Companion to [`native-ifs-holography.md`](native-ifs-holography.md)** — that is the current-state
> overview (the medium, the soliton algebra, the `[H]` holographic-computing API, the limit-cycle
> architecture, and results). This file holds the multimedia DEMO arc (originally §7.1–7.21) — the
> build history and walkthroughs. Section numbers below are preserved from the original document for
> cross-reference. Full superseded research history is in
> [`native-ifs-holography-memory.md`](native-ifs-holography-memory.md).
>
> **Architecture note:** the multiplexing described here (carrier-based) was the ORIGINAL scheme; the
> current live architecture uses TEMPORAL / clock-phase multiplexing (see §7.44/§7.47 in the overview).
> Read these as the foundational build; the overview has the current realization.

---

## 7. The Multimedia IFS Hologram — image + sound in one wavefront

The IFS method was never really about *images* — it propagates a complex field through
fractal time and reconstructs it reversibly. A **sound** is also a field in time. So the same
machinery extends to audio, and — because both modalities share the **one fractal clock** —
they compose natively into a single multimedia hologram. This was built in three converging
steps; the end state is one wavefront carrying a depth-resolved image *and* its soundtrack,
both read out by scrubbing one `τ`.

### 7.1 IFS sound holography (`IFSSound`)

The image pipeline, one dimension down. A sound is a 1D complex field `ψ(t)` (waveform as the
analytic signal). The propagator is a **symmetric multi-tap dispersive operator** — the *line*
analog of the 2D ring operator — evolved by the same symplectic leapfrog, so it is **exactly
reversible** (round-trip fidelity measured at **1.000**). Forward IFS *disperses* (chirps) the
signal; backward refocuses it. "A sound wavefront contains depth": its phase carries
timing/pitch, exactly as image phase carried spatial depth. Same structure-gated redundancy is
expected (structured sound holographs; noise does not). *Sound is arguably the more native
medium — the IFS clock is intrinsically temporal; images had to borrow it as a spatial operator.*

### 7.2 Shared-clock synchronisation (step 3)

Both holograms are driven by the **same fractal clock** — image-`τ` and sound-`τ` are the
*same* `τ`. This is **structural sync, not timestamped streams**: there is no separate clock to
drift, because the microtick/light-cone heartbeat (the fractal-time generator, §8) *is*
the shared time for both. Since depth = duration (image) ≡ time (sound), the image's depth axis
and the sound's time axis are **literally the same coordinate**. Scrub `τ` → traverse both.

### 7.3 Combined-field multiplexing (step 2)

> **Architecture note (current state):** carrier multiplexing — described in this section and used throughout
> §7.4–§7.14 — was the **original** scheme: all modalities share ONE grid at one instant, separated by orthogonal
> carriers (and gated by sparsity, §7.29). The **current live architecture replaces it with TEMPORAL (clock-phase)
> multiplexing** (§7.44, §7.47): each modality — and each `[H]` combinator (`gate`/`recognize`/…) — occupies its
> own PHASE of the bar, alone in the field, carrier-free (`regionEventSoliton`/`regionWaveSoliton`/`regionBind`,
> via `evalSolitonTemporalAt`). Why: carriers leak for DENSE content (the 0.56/0.65 capacity trade below is that
> cost), while time-separation recovers each modality at ≈1.0 — "dense things can't share an instant, but they
> can share a clock." So carriers remain the proven mechanism for the non-temporal `evalSolitonAt` scene and the
> sparse case, but the live ⊙ SOLITON scene and every combinator in it are temporal. Read this section as the
> foundation; §7.44/§7.47 are the current realization.

A single complex field `Ψ` holds **both** modalities, separable on readout — a true multimedia
wavefront (like one plate storing multiple images):

```
Ψ = ψ_image  +  ψ_sound · e^{i·k·x}        carrier-multiplexed
Ψ ──F^T──► combined hologram ──[H]──► ──F^-T──► reconstruction
         ├─ image: read directly
         └─ sound: demodulate conj(carrier)
```

Carrier multiplexing (not an orthogonal basis — the IFS medium has none, §5.4) is the proven
real-holography scheme; separation is **measurable** and tunable. Measured at balance: e.g.
**image ≈ 0.56, sound ≈ 0.65** (the `snd=` slider trades image↔sound power — they share one
field's capacity). The residual cross-talk is the expected, quantified non-orthogonality cost.

### 7.4 Convergence — depth + sound + shared `τ`, one field

The full vision unifies all three: the carrier-tagged sound is injected as an extra **layer at
its own depth position** in the *staged depth* forward that builds the 3D image. So one combined
wavefront carries the **depth-resolved image** *and* the **sound**, and **one `τ`-scrub recovers
both**:

```
combined = depth_layers  ⊕  sound_layer(carrier, at depth d)
view(τ)  = depthScrub(combined, τ)           → focused depth image at τ
soundOut = splitSound(view(τ), carrier)      → sound demodulated from the SAME field
```

Dragging `τ` moves the **visual focal depth** through the 3D scene **and** advances/recovers the
**sound** — from one wavefront, on one fractal clock, occlusion-robust (`[H]` masks the combined
hologram; both modalities degrade gracefully together).

> **This is the multimedia IFS hologram:** frameless in time, planeless in depth, and
> single-field in modality — image-depth and sound-time are two read-outs of *one* fractal-time
> evolution. Audiovisual not as aligned streams but as **projections of a single wavefront.**

### 7.5 Status & honest caveats

| Capability | Status |
|---|---|
| IFS sound operator (1D, reversible) | ✅ round-trip fidelity 1.000 |
| Shared-clock image+sound sync (step 3) | ✅ one `τ` drives both |
| Combined-field multiplex (step 2) | ✅ balanced separation, tunable (`snd=`) |
| Converged depth+sound, one field, one `τ` | ✅ `◎ EXPLORE` + `♪ SOUND` |

- **Cross-talk tradeoff** — image and sound share one field's capacity (`snd=` balances; adding
  sound slightly degrades the image). Phase-shifting separation would clean it further (future).
- **Sound is a monaural prototype** — analytic signal is approximate (faithful for the round-trip
  and demo; not a rigorous Hilbert transform).
- **Axis banding** (§6.3) and **structure-gating** (§5.3) apply to the multimedia case too.
- **Monocular** — depth is depth-of-focus, not stereo/parallax (future angular multiplexing).

UI: `LIVE → ◈ MAP → ◎ EXPLORE → ♪ SOUND`, drag `τ` (depth+sound), `snd=` (balance), `r=`+`H=OCCL`
(occlusion). `⊙ MM` shows the flat combined-field round-trip with separation scores.

### 7.6 Clock-modulated sound — "no tricks at all"

The combined-field scheme (§7.3–7.4) is honest but carries two **authored seams**: the sound is given
a *spatial carrier* `e^{i·k·x}` (a fake spatial frequency) and a *depth slot* `sndDepth` (a fake
distance) — both only because the sound was forced into the *image's space* as "another layer." Sound
has no native spatial frequency and no native distance, so those tags are placed by hand.

The native encoding removes both: **sound lives in the time axis, not in space.** The IFS leapfrog
advances by `dt` each step; here the audio *modulates that per-step `dt`*:

```
dt_i = dt · (1 + ε · s_i)          s_i = audio sample at tick i (resampled to D ticks)
forward:  for i in 0..D:  step(dt_i)     ← the 2D image rides the steps
recover:  for i in D..0:  step(−dt_i)    ← same schedule reversed → image refocuses EXACTLY
          measure ⟨Δarg ψ⟩ per step  →  divide by constant-dt baseline  →  ŝ_i
```

The **image is carried by the steps; the audio *is* the steps' tempo.** No grid placement, no carrier
tag, no depth slot — sound is the clock's own breathing. Reversibility is untouched: each leapfrog step
is individually reversible for *any* `dt`, so reversing the same schedule refocuses the field to machine
precision. Recovery is **phase-rate demod** — the receiver re-steps and measures the mean per-step phase
advance (amplitude-weighted), calibrated against a constant-`dt` back-pass; the ratio recovers `s_i`.

Measured (1D operator, `IFSSound.clockRoundTrip`, image = 4 bumps + structure, audio = 2 tones + chirp):

```
 eps     image      sound
 0.10    1.0000     0.9994
 0.25    1.0000     0.9995
 0.50    1.0000     0.9997
 pure-audio carrier: image 1.0000   sound 1.0000
```

The decisive new property is **orthogonal failure modes**. Occluding the hologram *in space*:

```
 occl r   image   sound
 0.00     1.000   0.999
 0.25     0.876   0.999
 0.50     0.709   0.999
 0.75     0.463   0.999
```

Spatial occlusion degrades the **image** with the expected holographic falloff, but the **sound is
essentially untouched** — it lives on the *time* axis (a global per-step phase quantity over surviving
cells), not in any spatial region. This is *better* multiplexing than the carrier scheme, where image
and sound shared one field's spatial capacity and cross-talk coupled them. Here the two modalities fail
independently: lose half the plate spatially, keep all the sound. (`IFSEye.clockModMM` carries the same
encoding on the real GPU 2D image.)

| Capability | Status |
|---|---|
| Clock-modulated sound (no carrier, no depth slot) | ✅ 1D verified, image 1.000 / sound 0.999 |
| Orthogonal failure modes (spatial occl ⟂ sound) | ✅ sound 0.999 through r=0.75 image loss |
| 2D GPU clock-modulated multimedia (`clockModMM`) | ✅ runs on the real GPU; `⊙ CLOCK` live UI |

Remaining honesty: `ε` (modulation depth) is the *one* parameter — but it's a physical gain, not a fake
coordinate. Phase-rate demod is approximate on highly structured fields (calibration cancels most of the
structure-dependence); the 0.999 holds for the tested signals.

### 7.7 Sound *is* the heartbeat — driving dt from the real KWE clock

§7.6 modulates the step tempo with *an* audio stream; the genuinely native version asks: what audio?
The answer that needs no external signal at all — **the clock's own fractal heartbeat.** Each macro
reflector cycle accumulates `fresnelBeat` events into a per-`IFS_DEPTH` energy envelope (`slotEnergy_A/B`,
the light-cone tiers filling in); the renderer already merges these. The `⊙ CLOCK` mode collects that
envelope over a rolling window (depth-weighted, so deeper tiers shape the timbre) and feeds it as the
`s_i` that modulates `dt`. So:

```
fresnelBeat events → per-cycle depth-energy envelope → rolling heartbeat s_i → dt_i = dt·(1+ε·s_i)
                                                                                    ↓
                              the SAME field carries the image; refocus is exact; ♪ plays the heartbeat
```

The sound you hear *is* the IFS clock's rhythm, encoded into the very time-steps that carry the image —
not a waveform placed beside it. There is no external audio, no spatial carrier, no depth slot: a single
fractal-time evolution, read two ways (refocused image, demodulated heartbeat). This is the literal
realisation of the doc's opening claim — *audiovisual as projections of one fractal-time evolution.*

UI: `⟳ LIVE → ◈ MAP/3D → ⊙ CLOCK` (panel 1 = clock-modulated depth hologram, 2 = focused depth slice
at τ, 3 = neighbour depth + recovered heartbeat strip), drag `τ` to rack focus, `♪ SOUND` to hear it,
`r=`+`H=OCCL` to watch the image degrade while the heartbeat survives (orthogonal failure modes, live).
`IFSEye.clockDepthScrub(layers, beat, τ, ε, shallow)` is the depth+clock method; verify on the real GPU
via `window._eye`.

### 7.8 Rhythm is the native sound — sonifying the heartbeat for human ears

The recovered heartbeat is a slow, sub-audio envelope (it updates once per reflector cycle); played as
a sample buffer it is just a blip. Making it *musical* is an interpretation choice — and the honest one
follows the medium's own geometry:

- the **image** lives in **space** (where energy sits on the grid);
- the **clock** lives in **time** (when `fresnelBeat` events fire — the light-cone depth tiers filling
  in each cycle).

So the native sound of this medium is **rhythm, not melody.** Pitch is a spatial-frequency concept;
importing it onto a temporal signal would be a new small "trick." Rhythm is what the clock *is*:
discrete beats at depth tiers, recurring each cycle.

**The implemented sonifier reads the clock's own event stream directly.** Each `fresnelBeat` is a
discrete, timed, depth-tagged firing — `{ d: IFS-depth, delay: Fresnel ring delay, wt: wall-time,
t: source tier }`. The sonifier (`_playEventRhythm` / `_triggerEvent`) plays **one percussion hit per
new event** (tracked by `wt`, so it's sample-accurate to the clock, not frame-sampled):

- **pitch** ← the ring `delay` (the light-cone geometry: inner ring → higher), quantised to a
  pentatonic scale so the result is musical rather than atonal;
- **octave lift + decay + timbre** ← the IFS-depth `d` (deeper fires tighter/higher, sine↔triangle
  alternating per depth for clarity).

The depth structure thus becomes a **fractal polyrhythm imposed by nothing but the clock** — you
literally *hear the `fresnelBeat` sequence*.

**These are two distinct channels, not a replacement — they do different jobs and coexist:**

| | dt-modulation (§7.6–7.7) | event-stream rhythm (here) |
|---|---|---|
| Encodes | a **waveform** into `dt_i = dt·(1+ε·s_i)` | nothing — *reads* existing `fresnelBeat` events |
| In the field? | **yes** — part of the wavefront | **no** — never touches the field |
| Reconstructable? | **yes** — phase-rate demod recovers it; occlusion-robust | **no** — it is a live readout, not stored |
| Role | **the recording** — sound that *is the hologram* (transmit / store) | **the live performance** — the clock playing itself *now* (monitor) |

So we still encode a waveform — that is the holographic sound channel, and it is untouched. The
event rhythm is a *separate* sonification: the most native one possible, because it invents no signal
at all (the clock's discrete events are the music) — but for exactly that reason it is **not
holographic** (nothing is encoded, transmitted, or reconstructed). The phrase "removes the waveform
assumption" applies only to *this* channel as a sonification idea: the dt-modulation channel still
*needs* you to bring a waveform; the event rhythm needs none.

**How they live together:** the *same* `fresnelBeat` events the rhythm plays discretely and live are
*also* what fill the depth-energy envelope the dt-modulation uses as its waveform. So the holographic
channel encodes a smoothed, continuous version of the very events the rhythm voices. In `⊙ CLOCK` you
get both at once — the panels *show* the depth image and the demodulated waveform strip (the stored,
reconstructed channel); the speakers *play* the event rhythm (the live channel). Recording and
performance of one fractal clock.

With `⟳ LIVE → ◈ MAP/3D → ⊙ CLOCK → ♪ SOUND` you hear the clock beating, its groove shaped by depth.
Drive fresh beats by rotating the object or double-clicking a canvas (`nextCycle`); an idle clock is
quiet by design.

### 7.9 Event-timing holography — putting the rhythm *back into the field*

§7.8 left an open seam: the event rhythm is the most native sonification but it is **not holographic**
— it only *reads* the live clock, it is not encoded, transmitted, or reconstructed. §7.6's dt-modulation
*is* holographic but encodes a *smoothed waveform*, not the discrete events. The missing third option:
make the **discrete polyrhythm itself** holographic — encode the events and reconstruct them.

It maps cleanly onto machinery already proven reversible. An event is `{ tier, wt }`, and an event is
not decoration — the `fresnelBeat`'s `delay → ring radius` *builds the operator itself*, so events are
structural. We encode each as a **localized impulse**: its **time → a forward-injection step** (time =
depth, the medium's own rule — the same staged injection as the depth scenes) and its **tier → a fixed,
deterministic grid cell** (not tuned per event — that would be the "depth slot" trick again). The
reversible field carries the impulses; back-propagation refocuses each at its own step. Recovery is
**honest peak-detection**: we read which tier-cells are lit in the *reconstructed* field at each focus
step — recovering `(onset, tier)` from the field, not replaying the input — so the score can **fail**.

`IFSEye.eventTimingHologram(events, {nTiers, nBins, band, occludeR})` returns the recovered event set
and `f1` (precision×recall of onset *and* tier). Verified (1D reversible stand-in):

```
                                  f1 at occlusion r =
 config                    0.00   0.25   0.50   0.75
 nBins=6, band=0.5 (dense) 0.86   0.46   0.20   —      ← cross-bin blur (time-analog of dense depth)
 nBins=3, band=0.6 (sparse)1.00   0.57   0.36   —      ← clean reconstruct, graceful falloff
```

The result is the **same structure-gating** as image depth (§5.3), now on the *time* axis: sparse,
well-separated events reconstruct perfectly and degrade gracefully under occlusion (holographic);
densely-packed events blur, exactly as dense-in-depth scenes lose focal contrast. f1≈1 at r=0 only when
bins are separated; the falloff under occlusion proves the score is real (it can and does fail).

This closes the loop opened in §7.8. There are now **three** sound relationships to the field, each
honest about what it is:

| channel | encodes | in field? | reconstructable? | role |
|---|---|---|---|---|
| dt-modulation (§7.6–7.7) | continuous **waveform** | yes | yes (phase-rate demod) | transmit / store |
| event rhythm (§7.8) | nothing (*reads* events) | no | n/a | live monitor |
| **event-timing holography (§7.9)** | **discrete events** (onset+tier) | **yes** | **yes (peak-detect)** | **store the rhythm** |

The rhythm is no longer only something you *hear live* — it is something the hologram *contains and
gives back*, structure-gated like everything else in the medium.

**Live UI (`⊙ BEAT`):** the demo uses the **real clock's own events** as the pattern — `⟳ LIVE → ⊙ BEAT`,
then rotate the object / double-click a canvas to capture live `fresnelBeat`s. Panel 1 = the event
hologram field, panel 2 = the TRUE captured groove (a drum grid: kick / snare / hat / clave × time
bins), panel 3 = the RECOVERED groove with `f1`. `♪ SOUND` plays the recovered groove as drums; raise
`r=` with `H=OCCL` and you *hear and see* the groove punch holes / sprout ghosts exactly where occlusion
broke the reconstruction — the clock's own beat, stored in the hologram and given back, degrading
gracefully. (Method runs on the real GPU; the f1 numbers above are from the 1D headless harness.)

### 7.10 The unified field — one evolution, read at three resolutions (architecture)

We arrived at three sound channels (§7.6–7.9) and an image-depth channel (§6) somewhat separately. The
natural question: **combine them into one — and does the rhythm drive the waveform, or the reverse?**
The honest answer is *neither drives the other* — that framing assumes they are different signals
chained in a pipeline. They are not. **They are one signal read at three resolutions.**

**The hierarchy (not a pipeline):**

```
        fresnelBeat EVENTS         ← the ATOMS: discrete, exact (when a beat fires, which tier)
              │
              ├─ smoothed over time ───────────►  CONTINUOUS WAVEFORM   (the events' envelope)
              ├─ injected as impulses, stored ─►  EVENT-TIMING HOLOGRAM (the events, reconstructable)
              └─ played as they happen ────────►  LIVE RHYTHM           (the events, heard now)
```

The waveform *is* the event stream sampled coarsely; the rhythm *is* the event stream at full grain.
This is the fractal idea itself — **self-similar structure across scales**: the same fractal-time
signal, zoomed in (discrete events) or out (continuous envelope). "Should the rhythm drive the
waveform" dissolves: the waveform is the rhythm, low-pass-filtered. You don't choose between them; you
**choose a resolution to read the one signal at.**

**So "combine in one" is not three encodings in one field — it is one encoding, three readouts.**
Encode the *substrate* once; read it out at whichever resolution is asked. The image rides the **same
staged forward** (depth = the same time axis the events live on), so the whole thing collapses onto a
**single knob**:

> **`τ` is your position along the fractal clock.** At any `τ`, from one reconstructed field, ask for:
> the **image depth-slice** (spatial face), the **waveform amplitude** (continuous face), or the
> **beat events** (discrete face). One field, one `τ`, one event-substrate — three resolutions plus the
> image as the spatial projection of the same evolution.

**There is only one substrate — and "choosing" was a mis-statement.** If they are genuinely one signal
at different resolutions, there is nothing to choose between for *what to store*: you encode the
**events** (the finest grain, the clock's atoms) **once**, and the waveform is simply a *coarse reading*
of that same reconstruction — its low-pass envelope. Resolution is how finely you *look*, not a separate
thing to *store*. In a **lossless** medium that is the whole story: one encoding, free multi-resolution
readout, no decision.

**The only reason any decision survives is that the medium is lossy — and lossy *unequally* across
resolutions.** The two grains do not degrade the same way: discrete onsets degrade by *structure-gating*
(dense beats blur, §7.9), while the continuous envelope degrades by *orthogonal failure modes* (it lives
on the time axis and barely feels spatial occlusion, §7.6). So encoding-then-reconstructing treats the
fine grain and the coarse grain differently. This does **not** contradict the unification — it is its
**caveat**: unification holds exactly for *readout*; the lossy channel reintroduces an asymmetry only at
*encode* time. The remaining knob is therefore not "which signal to store" but **which grain to spend
robustness on**, and it is optional (you may accept whatever each resolution naturally gives).

**Decision (chosen): bias the single events-substrate toward preserving fine onsets.** Since events are
the atoms and the operator is literally built from `fresnelBeat` radii, we protect the finest grain.
Concretely that means, on the one event encoding: **sharper, well-separated impulses** (wider time
spacing / fewer bins per window — the §7.9 sparse regime that gives f1≈1), **redundant placement** of
each event (so spatial occlusion cannot erase a tier-cell), and **onset-locked peak detection** on
read-back. The waveform is then *derived* as the envelope of those recovered impulses — it rides for
free on the same field, at whatever fidelity the fine-grain encoding leaves it. We store the clock
faithfully (atoms first); transmission-robustness of the smooth envelope is the secondary, free readout.

**Built (`IFSEye.unifiedField(events, τ, opts)` → `⊙ BEAT`).** One staged forward encodes the events as
**redundant impulses** (a 2D plus-footprint per event, so scattered-block occlusion must hit *all* of a
voice's cells to erase its onset) with **sparse bins** (the f1≈1 regime); an optional **image rides the
same forward**. From the *one* reconstruction, indexed by τ, it returns all three faces — the
peak-detected **groove** (discrete), the per-bin energy **waveform** (continuous, derived for free), and
the **image depth-slice** at τ (spatial). The UI shows them on the three panels; `♪ SOUND` plays the
groove; dragging `τ` scans the clock; `r=`+`H=OCCL` breaks it up gracefully.

**The timbre is the clock's too, not a drum kit.** Each recovered event carries its Fresnel ring
`delay` (the IFS clock's actual structural property: inner/fast ring = small delay, outer/slow = large).
The voice is *derived* from it — `delay → pitch` (inner ring higher), `delay → brightness & decay`
(inner = bright/tight, outer = dark/long) — so the *sound itself* is the beat's physics, not an
assignment. The rhythm is the reconstructed motif (which cells fired); the timbre of each hit is that
beat's own ring. Sound *and* rhythm are the clock's — the last authored label (kick/snare/hat/clave)
removed.

**Detector correction (live-tested).** The first GPU run exposed a real bug in the fine-onset
encoding: with redundant footprints + deep `T`, the per-event crosses **bleed together**, so every
tier-cell carries some energy at every bin. Detecting by "brightest tier *within a bin*" then
**saturated** — `onset=tier=1.0` trivially (everything lit), but `f1≈0.32` (precision dead, the
recovered grid almost fully on). Fix: detect by **temporal contrast within a tier** — a voice fires at
a bin only if its intensity stands out above *that same voice's* baseline across the other bins (a true
event = "this voice spikes at its own focus step"). Re-verified (1D harness, a groove with holes — 6
events of 16 cells, so precision *can* fail):

```
 occl r   f1     precision  recall
 0.00    1.000    1.00       1.00     ← exact recovery (holes preserved)
 0.10    1.000    1.00       1.00
 0.25    0.800    1.00       0.67     ← loses events, never hallucinates
 0.50    0.500    1.00       0.33
```

Precision stays 1.0 throughout; occlusion degrades by *dropping* true events (recall falls), the honest
failure mode. The architecture and clean-channel f1=1 are solid. The redundant 2D footprint's
*quantified* occlusion benefit (plus-footprint vs scattered blocks should beat the 1D contiguous-block
case) remains the open GPU measurement.

**GPU-VERIFIED on the real clock (live).** Two further bugs surfaced and were fixed against the live
clock: (1) the capture filtered new beats by `wt > lastWt`, but the clock re-seeds the same motif each
cycle and *wipes* `slotEvents` on launch (`_launchSlot`, hologram_world.js:520), so `wt`-filtering
froze the input at ~4 events — fixed by de-duplicating on the beat's **structural key** `{tier:delay}`;
(2) the clock's rhythm is a deterministic **8-beat motif** whose `wt` only marks the repeat, so binning
must use the beat **`delay`** (its Fresnel ring = structural time), not `wt` — added `timeKey:'delay'`.
With both, the live `⊙ BEAT` reports **8 events → 7 distinct (tier,bin) cells, `f1 = 0.857`, onset =
tier = 1.0 at r = 0** — stable across frames. The 0.857 (not 1.0) is a true property of *this* motif:
every tier shares a beat at the shortest delay (bin 0), so a couple of cells collide. The clock's own
motif, stored in the hologram and recovered at ~0.86 — the unified field, confirmed on the real GPU.

### 7.11 Carrying *our* content — a melody through the hologram (`♪ MEL`)

Everything above sonifies the clock *itself*. The decisive demonstration that this is a **medium**, not
just a self-display, is to make it **carry a payload of our choosing** — encode → holograph → occlude →
recover → play *our* message, not the IFS's own beats. A melody is the natural payload: a `(pitch, time)`
sequence maps exactly onto the event substrate — **pitch → tier**, **time → bin** — so it rides the same
`unifiedField` with no new mechanism. We author a short arch (`C E A C′ A E D C`, distinct scale degrees
so each note owns a clean grid row), encode it as events, and recover by peak-detect. Verified
(1D harness):

```
 true melody (degrees):   0 2 4 5 4 2 1 0
 occl r   f1     recovered
 0.00    1.00    0 2 4 5 4 2 1 0    ← OUR tune, recovered exactly
 0.25    0.93    notes start dropping (·) — survivors stay the correct pitch
 0.50    0.57    sparser, never a WRONG note — degradation = loss, not corruption
```

At r=0 the melody returns **exactly** (f1=1.0); under occlusion notes **drop out** but the surviving
pitches are always right — the holographic property *carrying a message*: damage the store, lose some
notes, keep a recognizable tune, never hallucinate a wrong one. `♪ MEL` shows the tune as a pitch×time
grid (notes vanishing as you raise `r=`) and plays the recovered notes; `⊙ BEAT` toggles back to the
clock's own motif. Honest scope: we recover the *(pitch,time) score* and replay it as clean tones —
faithful to the score, not a recording of a performance (we encoded notes, we recover notes); and like
all of §5.3 it works because the melody is sparse/structured, not a dense note-cloud.

This closes the arc: the IFS wavefront is not only *its own* image+rhythm+waveform (§7.10) — it is a
**carrier** that encodes, holographically protects, and returns content we put into it.

### 7.12 Events as the transport — a holographic sequencer (architecture)

The original sound channel (§7.3–7.7) played a waveform along a *synthetic schedule* — a hand-authored
timeline. The event-stream (§7.9–7.11) gives us **discrete, timed, holographically-recovered events**.
The natural composition: **let the recovered event-stream BE the schedule that plays the waveform.** The
events stop being "a thing we also store" and become the **transport/sequencer** — the clock track that
triggers the voice. This is not a new mechanism; it is recognizing that an event's `(tier, bin)` already
*is* a sequencer step (tier = which voice, bin = when).

**The two channels have complementary, non-overlapping jobs — that is why layering them wins:**

| channel | stores | recovers | role | degrades by |
|---|---|---|---|---|
| MM waveform (§7.3–7.7) | a continuous **waveform** (the voice/timbre) | the *samples* (~0.999) | **instrument** — what it sounds like | orthogonal failure modes (time axis) |
| event-stream (§7.9–7.11) | discrete **events** (the pattern) | the *(tier,bin) onsets* (f1) | **sequencer** — when/which fires | structure-gating (sparse survives) |

Composed: one field holds **both**; on readout the recovered events become the **trigger list** that
plays the recovered waveform at each onset/tier. The result is a **holographic sampler/sequencer**:

```
field = waveform(voice)  ⊕  event-stream(pattern)        — one wavefront, one τ
recover → voice samples  +  [{tier,bin}] schedule
play    → for each recovered event: trigger voice-waveform at bin·slot, on tier's pitch/voice
```

Why this is *better* than either alone, and better than the synthetic schedule we began with:

- **The schedule is no longer synthetic** — it is the *recovered* events, themselves holographically
  stored and protected. The sequence survived a round-trip; it wasn't hand-fed at playback.
- **Robustness AND fidelity, separated cleanly** — events give occlusion-graceful *timing* (lose hits,
  keep the groove); the waveform gives full *timbre* on every surviving hit. Neither channel alone has
  both; layered, the pattern degrades gracefully while each surviving note keeps its real voice.
- **One field, one τ** still holds — τ scrubs the whole sequence; depth/image ride along (§7.10).

**Cross-talk measured (the go/no-go gate) — GATE PASSED.** The two channels use *different* field
encodings (waveform = continuous seed, events = localized impulse-staging), so in one field they
interact. Measured on the 1D reversible operator at r=0:

```
 each ALONE:               waveform 1.000   events 1.000
 SHARED region (compete):  waveAmp/evAmp 1.0/1.0 → wave 0.969  events 0.833
                                          0.5/1.0 → wave 0.892  events 1.000   (power-sharing tension)
 SEPARATED regions:        every balance         → wave 1.000  events 1.000   ✓
```

In a **shared** region they compete for field amplitude — a genuine tension (raise one, the other
softens), the §7.3 non-orthogonality, now three-way. But it is **not fundamental**: giving the waveform
its own spatial region and the events theirs (e.g. left/right halves or a sub-band split) recovers
**both at 1.000, at any amplitude balance**. The IFS diffusion still delocalizes each across the whole
field (holographic robustness intact); only their *injection regions* are disjoint, so reconstruction
reads each cleanly. So the build recipe is settled: **spatially separate voice-region and
sequencer-region**; then `snd=` is a *mix* knob (voice vs. hits loudness), not a *survival* tradeoff.
Two variants remain a free choice — **single shared voice** (events trigger one waveform) or **per-tier
voices** (each tier its own waveform, a multi-voice drum machine); with separation the cross-talk budget
is no longer the limit, so per-tier is viable too.

This is the natural endpoint of the sound thread: not three separate sound tricks, but a **sequenced
instrument in one wavefront** — the holographically-recovered event-stream transporting the
holographically-recovered voice, image riding the same clock, all scrubbed by one τ.

**Built (`IFSEye.holographicSampler(voice, events, opts)` → `⊙ SEQ`).** One field, two disjoint
regions: the waveform **voice** seeded into the **left** grid columns, the event **sequence** staged as
impulses in the **right** columns. One backward sweep recovers the voice (read the left region back as
samples, `voiceScore`); a per-bin focal back-prop + temporal-contrast detect recovers the sequence
(`f1`). The recovered events become a **schedule** `[{tier, bin, tSec}]` that triggers the recovered
voice (`_playSampler` plays the voice buffer at each step, re-pitched by tier). Panel 1 = recovered
voice waveform, panel 2 = recovered sequence grid + f1, panel 3 = the combined field; `♪ SOUND` plays
the sequenced sampler; `r=`+`H=OCCL` drops hits gracefully while each surviving hit keeps its full
voice.

**GPU-CONFIRMED (live), and stronger than the 1D proof predicted:**

```
 occl r   voice fid   sequence f1
 0.00     1.000       1.000        ← both perfect — matches the 1D separation proof exactly
 0.52     0.988       1.000        ← HALF the field occluded, both essentially intact
```

At r=0 both payloads recover perfectly on the real GPU. At r=0.52 — half the hologram blacked out — the
**sequence is still fully intact** (f1=1.0; redundant 2D footprints + delocalization protect the pattern)
and the **voice barely moves** (0.988; the waveform delocalized across its whole region survives losing
half of it). The architecture's claim, measured live: *lose half the storage, keep the instrument and
its sequence.* It also finally demonstrates the **2D redundancy** the 1D contiguous-block test could not
(a 1D block wipes whole footprints; scattered 2D blocks vs 2D footprints degrade gracefully) — the open
measurement from §7.9–7.10, now closed.

### 7.13 Krestianstvo compliance — the sequencer as a clock-deterministic recompute (built)

The sampler/sequencer must obey the engine's golden rule, the same one all other UI controls follow:
**every shared-state change goes `injectEvent → reflector → world state → renderer reads back`; no
optimistic client-only dispatch** (the one exception is local file I/O, SAVE/LOAD). An audit found a
real violation: the mode toggles (`⊙ SEQ`, `⊙ BEAT`, `⊙ CLOCK`, `⊙ MM`, `♪ SOUND`) flip *client-local*
variables (`_eyeShowSeq = !_eyeShowSeq`, `_eyeSoundPlay = …`) and never reach the reflector — so a second
peer, or a replay, would not reproduce them. By contrast `setEyeH` / `setEyeT` / `setLiveMode` are
correctly routed and replayable. The mode and sound state must move into world state the same way.

The deeper, correct model for the sequencer itself: **it is a deterministic recompute from the shared
clock, not a streamed signal.** The chain is entirely virtual-time and reflector-derived:

```
reflector pulse → logicalTime → IFS fractal cycles → cycleCount → bar boundary → schedule
                                                       (world state, identical on every peer)
```

Given `cycleCount` (broadcast identically by the reflector), the encoded events (world state), and `T`
(world state), **every peer computes the same bar at the same virtual time with zero per-note network
traffic.** This is exactly the soliton-field pattern: the field is never transmitted, it is *recomputed*
from the synchronized clock; the reflector supplies only the *when*, the IFS determinism supplies the
*what*. The sequencer needs the clock for sync — and nothing else over the wire.

**PHASE-absolute, not per-peer-baselined (sync bug found & fixed).** A first build still mis-synced: a
joining peer baselined its loop to *its own* join `cycleCount`, so all peers ran the same cadence but at
different *phase* (offset by join time) — "not in correct loop position." Fix: the bar index is an
**absolute** function of the shared clock, `barIndex = floor(cycleCount / barCycles)`, computed the same
on every peer. A peer joining at any cycle snaps to the *same* bar boundary, because `cycleCount` is in
the snapshot it receives. The same fix applies to the `⊙ BEAT`/`♪ MEL` loop (was looping on a per-peer
`performance.now()` interval → same phase drift; now gated on the same absolute bar index). Late joiners
wait for the next shared boundary (silence ≤ one bar, then in phase) rather than starting at their own
step 0.

**Within-bar drift — clock is the only timing authority.** After phase-sync, a predictive cursor that
advanced by a *guessed* bar length still drifted: the IFS cycle cadence *varies*, so any prediction is
stale (the `err` log parked at ~140ms, never zeroed). Fix: there is **no cursor** — each bar starts at
its own clock crossing (`_barAnchor`, a small lead past detection), and its notes are spread over the
*measured* span of the bar that just elapsed. So bar boundaries track the clock exactly (sync), and
notes are even *within* each bar. Measured steady-state: **~0.80 s ± 0.03 s (±4 %)** — tight; the early
1.0→0.82 s swing was just the clock's startup transient. **Tempo decision: tempo = the clock** (bar
length follows the live cadence). The ±4 % wobble is the IFS clock's own jitter, kept as faithful
rubato — the music literally *is* the fractal clock's pace, not a metronome phased to it. (The
alternative — fixed tempo, clock sets phase only — is a one-line change if a steady metronome is ever
wanted; deliberately not taken.) The unavoidable floor is ±1 detection frame at the boundary, which is
intrinsic when the clock cadence itself jitters.

So the compliance refactor (planned, not yet built) is:

1. **World state:** add `eyeDisplayMode` (one mutually-exclusive enum replacing the scattered display
   booleans) and `eyeSoundOn`, with reducers `setEyeDisplay` / `setEyeSound`, added to the event
   whitelist beside `setEyeH`/`setEyeT`.
2. **Buttons** fire `injectEvent({type:'setEyeDisplay', mode:'seq'})` / `setEyeSound` instead of
   flipping locals; the **render loop derives its display flags from `n.eyeDisplayMode`/`n.eyeSoundOn`**
   each frame, and button highlights are driven from world state (the `:active`-guarded read-back
   pattern already used for the T slider).
3. The bar gate already reads `n.cycleCount` (world state) — once the *mode* is world state too, the
   whole chain is deterministic end to end: **the same reflector clock that runs the soliton runs the
   sequencer, recomputed per peer, no audio exchanged.**

Audio rendering still crosses to WebAudio wall-time at the very edge (the speaker's hardware clock, like
drawing pixels), and nothing downstream of that crossing re-enters state — so the determinism is intact
up to the device boundary. With this, the holographic instrument is a first-class Krestianstvo object:
shared, deterministic, replayable, peer-synced by the clock alone.

**Built (2026-06-05).** World state gained `eyeDisplayMode` (one mutually-exclusive enum:
`''|mdepth|slices|explore|mm|clock|beat|melody|seq`) and `eyeSoundOn`, with reducers
`setEyeDisplay`/`setEyeSound` on the event whitelist beside `setEyeH`/`setEyeT`. Every display-mode
button and `♪ SOUND` now fire `injectEvent` only; the local `_eyeShow*`/`_eyeSoundPlay` flags are a
*derived cache* recomputed from `n.eyeDisplayMode`/`n.eyeSoundOn` each frame, and button highlights are
driven from world state (off-color stored as `btn._offBg`, applied by an `hl()` helper — the same
read-back pattern the sliders use). Per-mode entry setup (fresh capture, dirty flags) runs in the derive
block on a *mode change*, so it is identical on every peer. The only deliberately-local pieces are the
WebAudio context unlock (must occur in the click gesture) and one-shot ACTIONS (sweeps, ISO, RINGS,
SAVE/LOAD) — which are computations, not shared state, exactly the documented file-I/O-style exception.
The bar gate already read `n.cycleCount`; with the mode now shared too, the chain reflector → cycleCount
→ bar → schedule is deterministic end to end. The sampler is now peer-synced by the clock alone.

### 7.14 The united field — image + events + sound in one wavefront, per-modality readout (spec)

The goal is a single "hologram-based multimedia" object: **one field carrying image (with depth), the
event/rhythm stream, and sound, all on the shared IFS clock** — recovered cleanly. The work of §§7.6–7.13
converged on *how*, and on one decisive empirical fact:

**The recovered content is propagation-depth-independent.** Measured directly (single-event sampler,
occ=0, T = 76 → 500): recovered-voice tail 0.152→0.155, fidelity 0.998→0.997, event count 1/1 — flat.
Holography does **not** change the sound; reversibility holds. (A long hunt for "sound changes with T"
found the cause was a detector bug — a per-tier-relative gate firing noise-floor tiers as phantom events
— not the physics; fixed with a global-floor gate. Diagnostic lesson, logged: measure the actual field
values before theorising.)

That fact is what makes the united field tractable. The design:

- **Encode once, region-separated, shared clock.** Image, events, and sound occupy disjoint regions of
  one grid (cross-talk measured clean with separation, §7.12), injected into one forward evolution gated
  by `cycleCount`. One field, one clock — the unification is structural, not a bundle of three holograms.
- **Reconstruct ALL modalities at ONE deep `T`.** *(Corrected from an earlier per-modality-depth idea —
  the requirement that masking-robustness be guaranteed for every modality, and the measurement below,
  overturned it.)* The core requirement is the holography test itself: **full recon from masked/partial
  data, for every modality, not just the image.** Measured (`sweepModalitiesVsT`, T × occlusion):

  ```
            event f1            voice masking-survival
   T \ r   0    .25  .5  .75    0    .25  .5  .75
    50    .92  .67 .83 .73     .65  .55 .25 .23
   200   1.0  .91 .80 .50     .65  .65 .63 .57
   350   1.0  1.0 1.0 1.0     .65  .64 .63 .61   ← events PERFECT at all occlusion; voice plateaued
  ```

  **Events climb to f1 = 1.0 at every occlusion level by T≈350** — redundancy grows with depth exactly
  like the image (§5.2b). Voice's occlusion-survival also improves with T (r=.75: .23→.61) and plateaus.
  So masking-robustness *requires* deep `T` for events and helps the voice — the same depth the image
  needs. **The united field therefore uses ONE deep `T` for all three.** (The earlier "events at moderate
  T for sharpness" was wrong: moderate T leaves events fragile under occlusion. The **global-floor event
  detector** keeps deep-T events phantom-free, which is what makes the all-deep design viable.) Simpler
  than per-modality depths, and it satisfies the masking requirement for every modality.

- **One `τ` drives all readouts.** Scrubbing the shared clock position moves image-depth, event-time,
  and sound-time together (§7.4) — audiovisual as projections of one fractal-time evolution.

**Known limitation:** voice fidelity plateaus at ~0.65 even unmasked (a waveform-into-grid tiling /
readback loss, not a masking failure) — the voice is recognisable but not pristine; a later refinement.

**Open engineering item (not physics):** deep `T` recompute is heavy (≈1 s RAF stall observed),
disrupting *bar timing* under interaction. Handled by **debouncing the recompute** (recompute on
parameter *settle*, not every frame; the audio loop keeps playing the last reconstruction meanwhile).

**Built & GPU-verified (`IFSEye.unitedField` → `⊙ UNITED`).** Three region-separated payloads in one
deep-`T` field, one clock, three readouts from one reconstruction. Measured at T=350:

```
        voice fid   events f1     image
 r=0.00   0.647     1.000 (6/6)   present
 r=0.50   0.610     1.000 (6/6)   present     ← 50% masked: events PERFECT, voice barely drops
```

All three recovered from one wavefront and **surviving 50% occlusion** — the masking requirement met for
every modality. (At a shallow T=10 the same field gives voice 0.21 / events 5/6 under masking — the deep
`T` the *image* needs is exactly what protects the *sound and events* too; one depth serves all, which is
why the all-deep design is correct.) The hologram-based multimedia united field works.

**Live render built (`⊙ UNITED`).** The mode runs `unitedField` at a fixed deep `T` (350) and shows all
three faces from the one reconstruction: **panel 1 = image depth-slice at τ**, **panel 2 = recovered
event grid + f1**, **panel 3 = recovered voice waveform**. `♪ SOUND` plays the recovered events
triggering the recovered voice, clock-gated on `cycleCount` (reuses the SEQ scheduler — phase-absolute,
drift-corrected). `τ` scrubs the image depth; `r=`+`H=OCCL` masks the shared field (all three degrade
gracefully together). It is a first-class peer-synced display mode (world-state `eyeDisplayMode='united'`).
Remaining refinement: the voice 0.65 fidelity ceiling.

**Save/load (`⊙ UNITED` → 💾/📂):** the file stores the **one wavefront** `u.holo` (a single G×G
complex field carrying all three modalities, region-separated) + a geometry descriptor
(`nTiers, nBins, imgRowsFrac, vLen, barSecs, trueSet, voice`), `type:'eye-united'`. On load,
`readoutUnited(holo, geom, τ)` replays the **same three readouts** the live render uses — image,
events, voice all fall out of the one field, and **depth is intrinsic** (depth = duration is baked
into the staged forward; `τ`-scrub re-extracts it, no extra channel). One file = one wavefront =
all three modalities + depth.

### 7.15 The united-field SOLITON — live, continuous, advected multimedia (`⊙ SOLITON`)

The still united field is one frozen deep-T window. The **soliton** makes it *flow*: content is
injected at the **entry plane** each bar and the IFS dynamics **advect it forward one step per
clock tick** — image, events, and voice evolve continuously instead of cutting frame-to-frame.

Key idea: **age = depth.** A bar injected k ticks ago has propagated k steps, so it refocuses with
k *backward* steps — not a fixed D-step back-prop. The travelling window holds a continuum of ages
0..D; the bar "due now" is the one ~one period old, read at its own depth. Old bars fall off past
depth D and drop. This is a genuine soliton (the physics transports the structure, **O(1 step)/frame**,
not a per-frame re-encode), distinct from a flipbook of independent stills.

**Clock-native sync (bounded drive).** A new bar **enters on each `cycleCount` tick** (the clock
decides the rhythm), while the field **advects at a fixed rate per frame** (smooth flow). Bar-entry
is clock-locked → peers inject the same bars at the same cycles deterministically (no field/audio
exchange). Crucially the drive does **not** chase an absolute step target (`age = cycleCount·k`) — an
early version did, and under a free-running clock the capped catch-up fell permanently behind
(observed `bars=143`, `dueAge=24<barSteps`). The fixed-rate + tick-injection drive is bounded: the
bar ring is capped at `keepBars·barSteps` (independent of the image `T` slider), so it never
balloons at high T nor vanishes at low T. World-state mode `eyeDisplayMode='soliton'`.

**HONEST OPEN QUESTION (the experiment).** The still field's masking-robustness came from each item's
*full* deep-T propagation. Under continuous advection a bar only ever sees a sliding *partial* window,
shared with younger/older bars in the same grid. Whether region-separation + reconstruction survive
that is **unproven**. `solitonCoherenceSweep()` (shift-click `⊙ SOLITON`) runs at its **own deep horizon**
(`depthT=350`, restoring the live `T` slider after — so a small slider value can't collapse the
sweep to ages `0,1,3,4,5` scoring 0.000, as an early run did) and scores each bar vs its intended
content at every age 0..D as it ages out:
- **flat across age** → true soliton; the field carries multimedia through advection.
- **decays with age** → the medium has a *coherence length* shorter than D — itself a finding (the
  travelling window is holographic only within that depth).
A reversible CPU mock confirms the control flow (no NaN, bars cap, due-bar tracked, voice ≈ 1.0).

**GPU RESULT (2026-06-06, T=350, 8 bars).** The two modalities answer the coherence question
*differently*, along the same sparse-vs-dense axis that governs IFS holography everywhere else
(§5.3, §7):

| bar age (steps) | voiceScore | eventF1 |
|---|---|---|
| 0   | 0.647 | 0.847 |
| 88  | 0.452 | 0.837 |
| 175 | 0.332 | 0.854 |
| 263 | 0.305 | 0.899 |
| 350 | 0.329 | 0.885 |

- **Events (rhythm) = TRUE SOLITON.** f1 is FLAT (and high) across the full depth — 0.84→0.89, no
  decay. Sparse, structured event-timing advects through the travelling window without losing
  coherence. The discrete rhythm flows.
- **Voice (waveform) = decays to a plateau.** ~0.65 → floors at ~0.31 by age ~175. Dense/
  incompressible content (512 samples filling a quadrant — the fragile "flat-texture" case) does
  NOT advect coherently; it has a coherence length shorter than D. This is the *same* failure mode
  the masking sweep showed (events ⟂ voice).

So **the united field is a soliton for its STRUCTURED modalities (image-depth, rhythm) and only
partially for its dense one (raw waveform)** — coherence is structure-gated, consistent with the
whole project. (Caveat noted, not chased: the voice *plateau* at ~⅓ rather than →0 is plausibly
tinged by inter-bar superposition of identical per-bar voices + real-part-only readout; a distinct-
voice + magnitude readout could lift it. Accepted as-is — the qualitative split (sparse soliton,
dense not) is the finding.)

Two earlier sweep bugs were fixed to get this: (1) the sweep inherited the live `T` slider (=5)
→ ages collapsed to 0,1,3,4,5 and 0.000 everywhere; now uses its own `depthT=350` and restores the
slider; (2) `solitonInject` updated the GPU buffer but not the JS mirror `s.psi`, so `_scoreBarAtAge`
back-propagated a stale field → flat 0.000 voice / frozen 0.476 f1. Fixed (`s.psi = psi` after
inject); age-0 voice then scores 1.0 on the mock, confirming the readout.

### 7.16 Voice-as-events — sound as a holographic piano roll (`⊙ SOLITON`, roll mode)

The §7.15 result said: the dense raw waveform decays under advection, but sparse/structured events
flow as a true soliton. The fix follows directly — **make the voice structured too.** Drop the dense
waveform region entirely; represent sound as **note ATOMS in the event grid**: `tier = pitch` (a
scale degree), `bin = onset` (time in bar). A recovered atom = a note. This is a **holographic piano
roll** — and a piano roll is exactly the sparse, structured payload the soliton transports flat.

The audio is **synthesized at the device edge**: `_playRoll()` fires one oscillator per recovered
atom at its pitch (major-scale degree → Hz) and onset (bin → time), with a soft pluck envelope. So
the sound is no longer sampled-and-reconstructed; it is *generated* from the recovered atoms — which
is the truest expression of "one substrate, multiple resolutions": image is the dense spatial face,
sound is the sparse symbolic face, both read from the one travelling field.

Geometry: with no voice region (`vLen=0`) the events get the **full bottom width** (not the left
half), and the footprint radius **adapts to cell spacing**. Trade-off vs §7.15: sound loses
raw-waveform timbre/fidelity (synthesized monophonic-ish tones) but gains soliton coherence — a
melody that flows. Deterministic per-bar phrase → peer-identical, clock-locked.

**GPU tuning — cell COARSENESS is the dominant coherence lever (not note count).** First roll
(6 pitches × 8 onsets, every-other-onset ≈ 4 notes/bar): eventF1 decayed 0.865 → 0.619 over age
0..350. Thinning to ~2 notes/bar (every-3rd-onset) lifted it only ~+0.07 (0.870 → 0.690) — still
decaying. The real cause: a 6×8 grid packs 48 small cells into the bottom strip → adaptive footprint
shrinks to `rr=1` → tiny low-energy features that **blur into neighbours faster** under deep
propagation. The flat rhythm-soliton (§7.15) had big, far-apart 4×4 cells (`rr=2`). So the fix is to
**match that geometry**: the roll is now **4 pitches × 4 onsets, `rr=2`** — geometrically identical
to the flat rhythm, with `tier` reinterpreted as pitch (4 well-spread pitches C-E-G-C5 = an arpeggio,
spanning an octave so few cells still sound musical).

**GPU RESULT — confirmed (2026-06-06).** The coarse 4×4 roll: eventF1 = 0.925 / 0.900 / 0.850 /
0.800 / 0.800 over age 0..350. Fresh notes match the bare rhythm-soliton (0.925) and the curve
**plateaus at 0.80 from age ~263** (stops decaying — the signature of a stable advected structure,
vs the fine grid's continued collapse). This is a **melodic soliton**: a clear arpeggio melody that
flows through the travelling field and holds its shape to full depth (~1-in-5 deepest notes wobble).
**THE DECISIVE FINDING (GPU-measured, one-factor-at-a-time × depth, 2026-06-06).** Coherence is gated
by **DENSITY (notes per bar), not resolution** — and the density limit is a **deep-T (holographic)
phenomenon**. The isolated OFAT×depth sweep (`solitonStructureSweep`, shift-click `⊙ SOLITON`):

| variant (Δ mean f1 vs that-T baseline) | T=40 | T=100 | T=350 |
|---|---|---|---|
| +pitches 4→8 (resolution) | +0.00 | +0.00 | +0.00 |
| +pitches 4→12 (resolution) | +0.00 | +0.00 | +0.00 |
| +onsets 4→8 (time-resolution) | +0.00 | +0.00 | +0.00 |
| +notes 2→3 (density) | −0.05 | −0.06 | **−0.13** |
| +notes 2→4 (density) | −0.05 | −0.06 | **−0.17** |

Reading it: **resolution is free** — 4→12 pitches, and 4→8 onsets, cost *nothing* at any depth.
**Density is the only limit**, and it **grows with depth**: negligible when shallow (−0.05 at T=40,
where the field is photographic — round-trip ≈ identity, nothing to gate) and substantial when deep
(−0.17 at T=350, the holographic regime). So **sparse content advects coherently at any depth; dense
content blurs increasingly as it propagates deeper** (more notes superpose over a longer advection).

This *replaces* the earlier "resolution dominates / fine-grained blurs" claim, which was wrong: it
came from mock reasoning + footprint arithmetic and an axis-confounded matrix, and was GPU-refuted.
The true law is **density-gated, depth-dependent** — the same structure-gating spirit as image
holography (§5.3, §7: sparse/structured survives, dense/incompressible is fragile), now measured in
the symbolic/time domain, with the added, measured nuance that the gating only emerges at holographic
depth. (And it vindicates the instinct to distrust low-T tests: at low T the limit is nearly invisible.)
Voice-as-events still delivers the goal — clear, continuous, peer-synced multimedia sound that does
NOT break the soliton — provided the melody stays sparse (few notes/bar); pitch range is unrestricted.

**WHERE THE STRUCTURE QUESTION LIVES IN THE CODE:** the *live* soliton plays a clean isolated
per-bar read (`solitonReadBar`) and deliberately does NOT exercise the cross-bar coherence regime —
clean demo, by design. The structure question is carried by the **measurement**, reproducible on
demand: **shift-click `⊙ SOLITON`** runs `solitonStructureSweep` — now a **one-factor-at-a-time**
sweep from baseline 4×4/2, varying pitch-count, onset-count, and note-density *one at a time* so each
row attributes its effect cleanly (the earlier 4-config matrix confounded tiers with bins). The first
GPU run of the (flawed) matrix already overturned the "resolution dominates" theory — density moved
f1, resolution did not (see the retraction above). **The OFAT table is the source of truth; read it,
then write down what it actually shows.** Live mode = spectacle; sweep = physics-that-can-fail.

**IS THE RECOVERY ACTUALLY HOLOGRAPHIC? (occlusion-vs-T, ctrl-click, GPU-measured 2026-06-06).**
The honest test: holographic redundancy means survival should RISE with recon depth T (deep
propagation spreads each note's energy → masking a fraction still leaves enough). Result (fraction
of 4 notes surviving, blk=8):

| T \ r | 0 | 0.25 | 0.5 | 0.75 |
|---|---|---|---|---|
| 1 | 1.00 | 0.75 | 0.50 | 0.25 |
| 80 | 1.00 | 0.75 | 0.50 | 0.25 |
| 200 | 1.00 | **1.00** | 0.50 | **0.00** |
| 350 | 1.00 | **1.00** | 0.50 | **0.00** |

The verdict is **mixed, and mostly NOT holographic**: at low–mid T survival = exactly **1−r** — the
*photographic* signature (mask fraction r → lose fraction r, linearly, no redundancy). A genuine
holographic effect appears **only in a narrow corner**: light occlusion + deep T (r=0.25, T≥200 →
1.00, i.e. notes that would drop are recovered). At r=0.5 depth does nothing (flat 0.50); at heavy
occlusion **r=0.75 depth makes it WORSE** (0.25→0.00) — deep propagation spreads each note thin, so
heavy masking takes a bigger bite of its now-distributed energy and it falls below threshold
everywhere. **So: the sparse-melody soliton flows and is clock-pure/peer-synced (the real wins), but
its occlusion-robustness is marginal — weakly holographic at best, photographic at worst.** The
earlier "2/4 survive at r=0.5" that looked like a win was the photographic 1−r, not redundancy. This
is the T-dependence test doing its job: it separated genuine (small) redundancy from the photographic
baseline that was masquerading as holography.

> **UPDATE — it's a CROSSOVER, and the metric was NOT the cause (dual-metric GPU run, 2026-06-06).**
> Suspecting the per-note self-ratio metric had regressed the recovery (hiding holographic refocus),
> I ran occlusion-vs-T reporting BOTH metrics — ratio AND the old top-K/absolute-bar detector — per
> cell. They came out **identical in every cell** → the metric is not the culprit; the recovery is
> honest. The real structure is a **depth crossover**: at r=0.25 survival is non-monotonic and
> reaches **1.00 at deep T** (holographic redundancy wins for LIGHT occlusion); at r=0.5 it goes
> **0.50→0.00 as T deepens**; at r=0.75 **0.25→0.00**. So **deep propagation HELPS light occlusion
> but RUINS heavy occlusion** — spreading each note's energy thin means masking ≥50% of the grid
> drops every note below threshold. There is an *optimal moderate recon depth*, not "deeper = better".
> The live soliton ran recon at the full deep slider T (past the optimum) — which is why heavy-occl
> looked catastrophic. FIX: recon depth is now its OWN dial (`recT` slider, §7.22) separate from the
> visual T, so the crossover is scrubbable live — find the depth where H=OCCL degrades gracefully.
> Net correction to the line above: not "weakly holographic" but "holographic in a *depth-and-occl
> band*"; the demo now exposes that band instead of pinning recon to a depth that's wrong for it.

### 7.17 Clock-paced arpeggio — slow melody as a property of the field, not a player

To hear each arpeggio note distinctly, the wrong way is a client-side playback timer (stretch the
audio schedule per listener) — that's a trick, not in the medium, and not peer-synced. The right way:
**make the onset a real propagation delay in the field.** A note with onset `bin` is injected
`bin · onsetSteps` forward steps after its bar starts (`solitonInject` queues it in `s.pending`;
`solitonAdvance` injects each note when its step arrives). So the bar's notes enter the travelling
field at **different depths**, and as the soliton advects they **arrive at the read plane one at a
time, in onset order**. `solitonReadNow(τ, readDepth=onsetSteps)` reads the shallow plane where the
freshly-emerged onset is in focus; the live drive advances `onsetSteps` per IFS **cycle** and sounds
only the newly-appeared note (set-diff vs the previous cycle).

The consequence: **the arpeggio's tempo IS the IFS clock** — one note per cycle. Slow the world
clock, the arpeggio slows; every peer hears the same pace because they advect the same field by the
same shared `cycleCount`. No audio scheduling, no per-client preference — the spacing lives in the
wavefront's depth axis (depth = duration, §5.2c, applied to melody). `onsetSteps = barSteps / nBins`
so a bar spans all its onsets. This is the honest "slow mode": a demo of the melody emerging from the
field note-by-note, driven entirely by the clock.

### 7.18 Peer sync on join — phase-sync, not field replication

A joining peer started the soliton from age 0 while the shared clock was already far along → its
arpeggio was out of phase. The instinct (replay recent bars to rebuild the field) fails on principle:
a soliton's full ψ field at cycle N is N cycles of accumulated advection, and on a (near-)lossless
IFS propagator old energy never fully leaves — so a late joiner **cannot** reconstruct the exact
field from only recent bars (measured: warm-replaying the last few bars gives field-correlation ~0.12
vs a peer that ran from the start). Exact field replication across peers is not achievable for a
free-running continuous soliton.

The right, honest semantics is **phase-sync, not field-sync**: guarantee the audible/visible thing.
The note a peer plays at absolute cycle `c` is a *pure function of the shared clock* —
`bar = floor(c/nBins)`, `onset = c % nBins`, `note = rollMelody(bar)[onset]`. Every peer (including
late joiners) therefore plays the **same note at the same cycle = unison**, with no warm-up and no
drift (verified: a peer joining at cycle 500 plays an identical note sequence to one running since 0).
The ψ field remains the *live visual* (seeded with a couple of recent bars so it isn't empty), but the
**clock formula is the source of truth for playback**, not what the field happens to recover. This is
the same principle as all KWE shared state: derive from the reflector clock, don't exchange/replicate
local state. (If bit-exact field match were ever required, the lever is dissipation — a bounded-memory
field where old bars decay within `keepBars` — but that trades the pure reversible dynamics for it.)

### 7.19 Sound must come FROM the hologram (else occlusion is a lie)

The phase-sync fix (§7.18) had a side effect caught by ear+eye: playing the note from the clock
formula `noteAtCycle(c)` means the audio **bypasses the field** — so masking the hologram (`H=occl`)
degraded the *panels* but never the *sound*. The melody kept playing clean through occl 0.46. That's
dishonest: the demo looked masked but didn't sound masked. The sound was decoration, not the hologram.

Fix: **play the notes the field actually RECOVERS** (`solitonReadNow().recovered`), not the formula.
Now `H=occl` audibly drops/glitches notes — the sound *is* the holography test, and masking robustness
(or failure) is provable by ear. Cost: under heavy local masking peers can differ (each masks its own
field); at occl=0 they agree. This is the honest trade chosen over peer-perfect-but-fake-clean.

Two coupled bugs surfaced together and were fixed: (a) **8 fine pitches + depth-stagger exceeded the
medium's resolution** — on the real GPU the staggered 8-tier readout collapsed to the extreme tiers
(f1=0, only top+bottom rows lit). Removing the onset-stagger (`onsetSteps=0`, inject a bar's notes at
one depth, read the whole bar at the due-bar depth — the config measured coherent) restores clean
recovery. The arpeggio feel now comes from spreading the *recovered* notes by onset at render time, not
from depth-staggering. (b) bars are clock-locked by **absolute bar index** (`floor(cycleCount/nBins)`)
so they stay peer-aligned. Net: 8-pitch up/down melody, recovered from the field, audibly maskable.

### 7.21 Clock melody — the complement to the soliton (`♪ CLOCK-MEL`)

Two ways to drive the same melody, each demonstrating a *different* property — kept side by side as
distinct modes:

| mode | sound source | what it proves |
|---|---|---|
| `⊙ SOLITON` | notes **recovered from the (maskable) field** | field holography — survives `H=OCCL`, audibly degrades |
| `♪ CLOCK-MEL` | notes **generated from the clock formula** | clock determinism — perfect peer-sync, always clean |

`CLOCK-MEL` plays `note = rollMelody(floor(cyc/nBins))[cyc%nBins]` straight from the shared
`cycleCount` — no field in the path. Therefore: every peer (including late joiners) plays the **same
note at the same cycle = exact unison**, with no warm-up, no drift, and **occlusion has zero effect**
(there is nothing to mask). Its panels draw the clock-truth melody (the formula), so what you see
always equals what you hear — no field phantoms possible. This is the "the clock IS the score"
demonstration: §7.18's phase-sync principle as a first-class standalone benefit, not just a fallback.

The pair makes the dichotomy concrete: turn on `H=OCCL` and **CLOCK-MEL stays pristine while SOLITON
degrades** — the same melody, two truths (clock-determinism vs field-holography). Neither replaces the
other; they answer different questions about what the medium guarantees.
