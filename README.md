# Daily Hex

A browser take on *Super Hexagon*. Dodge closing walls by orbiting a hexagonal
core. Survive 60 seconds. No build step, no dependencies — open `index.html`
and play.

## Credits and provenance

Recorded here because it is the question that decides whether this repo can ever
be public, and it should never have to be asked again.

- **Music** — the five tracks in `audio/` are Matt Winwood's own recordings.
  Original work, not licensed library music, so there is nothing restricting
  redistribution of the files themselves.
- **Type** — Archivo Black, SIL Open Font License, self-hosted in `assets/`
  with its licence alongside it in `archivo-black-OFL.txt`.
- **Art** — the wordmark and icons are original.
- **Concept** — *Super Hexagon* by Terry Cavanagh, credited on the title screen.
  Mechanics only; none of its code, art, audio or vocabulary is used, and the
  stage and phase ladders were deliberately renamed off it.

## Play

```bash
cd /Users/mattwinwood/git/hex-machina && node serve.js 4910
```

Then open http://localhost:4910. It needs to be served, not opened as
`file://` — the code uses ES modules. `serve.js` is a zero-dependency static
server that sends `no-store`; any static host works for playing, but browsers
cache ES modules hard enough that a stale one during development looks exactly
like a bug in your own code.

| Input | Action |
| --- | --- |
| ← → or A D | Orbit left / right |
| Space | Start, retry, resume |
| Enter | Pause mid-run; confirm everywhere else |
| ↑ ↓ | Step through the week of seeds (menu) |
| T | Toggle twin mode (menu) |
| Esc | Pause → menu |
| 777 | Autopilot demo (see below) |
| M | Mute |
| Tap / hold left or right | Orbit on touch — slide across to switch |
| On-screen buttons | Pause (in game), mute and fullscreen (menu) |

Six stages, three tiers deep and doubled: **SPARK** (Warm), **FORGE** (Hot) and
**CRUCIBLE** (Molten) are open from the start; each unlocks its **REDLINE**
counterpart — **FLARE**, **FURNACE**, **MELTDOWN** — by surviving 60 seconds. The
naming is this game's own rather than the original's; the debt is acknowledged in
the credit line instead. Ranks land at 10s (Line), 20s (Triangle), 30s (Square), 45s (Pentagon)
and 60s (Hexagon) — note the 15-second gaps at the end.

Stage speeds follow the ladder the genre settled on: FORGE is 1.2x SPARK and
CRUCIBLE is 2x, applied to **both** wall speed and cursor speed. Scaling both
is what actually shortens reaction time — see the note on `safety` below.
CRUCIBLE also gets a full-circle camera whip every ~13s.

The arena does not stay a hexagon. At a phase change it may collapse to a
pentagon, a square or a triangle, or open out to an octagon — a shift waits for
the field to drain first, so walls are never teleported into new slots. This
happens on every run; the seed's Shift Mode only means it happens at *every*
phase rather than some of them. A triangle has 120° slots and a completely
different rhythm, which is the point.

Escape spirals are in the base pool: the opening marches one slot per ring for
long enough that standing still is fatal and you have to commit to running. A
harder variant reverses direction halfway, so you commit and then have to unwind.

At 60 seconds a stage does not end: it turns inside out and redlines into its
harder counterpart. A redline stage begins at `startProgress: 1`,
which puts its opening speed at precisely the value its parent reaches at the
60-second mark. Each stage has a fixed colour (stage one is purple), and best times are stored
per stage and per mode. Music is **not** per stage on the daily: since the daily
is always the same stage, a fixed track meant every day sounded identical. The
day now walks `TRACKS` by a stride coprime with its length, so every track comes
up equally often and no two consecutive days share one — a plain hash cheerfully
gave the same song three days running, which reads as the rotation being broken.

Phases are named for what they do rather than for a mood. "CASCADE" told the
player nothing, so the phases are now called `WARMING UP`, `HARDER PATTERNS ·
FASTER SPIN`, `TIGHTER GAPS · FASTER SPIN`, `EVERYTHING IT HAS` and `YOU WON ·
KEEP GOING`. The ` · ` is load-bearing: the announcement breaks on it to stack
two clauses, and both the card and the corner label size themselves to fit, since
a name is now a sentence rather than a word.

A reshape cannot happen with walls in flight: they would teleport into slots of a
different polygon. So arming one stops the spawner, and the reshape lands as soon
as nothing is left ahead of the cursor — leftovers behind you dissolve over
`RETIRE_FADE` rather than blinking out. That still leaves the arena briefly bare
(measured at ~1.2s worst case) which is the pause you see after a phase card, and
is the price of changing the shape of the world mid-run.

### Slow motion

Slow motion is not an input, and it is not a reward either — it is a **rescue**.
Every fixed step the game asks a concrete question: can you still reach the next
opening? `escapeOdds()` answers it as a race. The ring lands in `t` seconds, the
nearest opening will by then have drifted to a known angle, and you can cover
exactly `playerSpeed * t` radians before it arrives. The ratio is your odds: 1
means you get there in time, below 1 means the wall arrives first. It is all in
radians, so it holds on a triangle exactly as well as on an octagon.

The moment that ratio drops below `RESCUE_AT`, the game spends a charge, slows
the world, and hands back the time you were short of — which multiplies the angle
you can still cover by `1 / SLOWMO_SCALE`, about 2.2x.

Two details make the estimate honest rather than noisy:

- **Rings closer than `RESCUE_MIN_LEAD` are ignored.** Their outcome is already
  settled — you are threading the gap or you are not, and bullet time cannot buy
  back ten milliseconds. Without this the estimate reads near-zero on *every*
  wall as it passes the cursor, because the distance-to-gap-centre term stops
  shrinking while `t` does. Measured: 602 spurious rescues per 30 runs became 17.
- **The threshold is 0.9, not 1.0.** At exactly 1.0 it fires on moments a
  competent player still recovers from, and spending the bank early leaves it
  empty for the crisis that follows. Measured on a clean bot: 26/30 runs reached
  60s at 1.0, 30/30 at 0.9.

Against a bot that plays well but commits the wrong way for ~180ms now and then —
which is how people actually die here, not constant lag — the rescue extends mean
survival by 19–75% depending on how often it stumbles.

The trick is that the cursor is exempt from the slowdown — in world time it
turns faster by exactly the factor the world slowed, so its real-world turning
rate is unchanged while the walls crawl. That relative gain (2.2x at the default
0.45 scale) is what gets you out of a corner you should not have been in.

It is not free: the survival clock slows with everything else, so every second
of bullet time is a second you do not score. The music drops pitch with it.

The bank fills only with time survived — one charge per five seconds, nothing
scattered on the field to collect — and near misses are the only thing that
spends it. The price is not flat: it scales with `1 - odds`, so a hopeless spot
costs more and buys a longer slowdown than a marginal one. A full bank is four
rescues at most, and closer to two if you keep getting into genuinely lost
positions. A bank too thin to cover the full price buys a proportionally shorter
slowdown rather than nothing — which is what "based on how much charge you have"
comes to in practice.

Grazing no longer buys time. It still scores and still drives the multiplier, but
the two systems are now cleanly separated: near misses are the reward mechanic,
charges are the survival mechanic.

### Autopilot (type 777)

Typing `777` anywhere hands the game to a bot that plays the entire thing:
every stage in order, each base stage carried past 60s so it redlines and
unlocks its counterpart, then the three redline stages, then twin mode, then a
deliberate death to show the game-over screen and retry. It engages slow motion
on a schedule and again whenever a wall is closing in with real distance still
to cover. A caption
strip names whatever it is currently demonstrating. Any key or tap drops out.

The whole tour takes about five and a half minutes and is the fastest way to
eyeball a change against the entire game rather than one screen at a time.

The steering brain is deliberately the same greedy policy used to prove pattern
fairness, with one upgrade: it aims for the **centre** of the nearest safe gap
rather than the nearest safe angle. Hugging a gap edge is what kills a greedy
policy once `safety` bottoms out on MELTDOWN, because any drift or ring
rotation eats the little clearance left. Six consecutive tours now finish with
zero unintended deaths.

### Touch and mobile

The layout is built for a phone first and adapts up, rather than the other way
round:

- **The field sits above your thumbs.** In portrait the core is lifted to 43% of
  the screen height instead of dead centre, so the hand holding the phone is not
  covering the walls you are trying to read. The spawn radius is computed from
  the furthest corner of that off-centre layout, not from a naive half-diagonal.
- **Held fingers can slide.** Drag across the midline and the cursor follows.
- **Multi-touch works the way thumbs do.** Each finger owns a direction, the most
  recent press wins, and lifting one falls back to the other. `pointercancel`
  and window blur release everything, so a system gesture or app switch can't
  leave the cursor stuck on.
- **Touch targets are grown, never shrunk.** Menu bands have a floor of ~52px
  regardless of how small the drawn text is, and the corner buttons are at least
  48px.
- **Safe areas are respected.** Notch and home-indicator insets are read from
  `env(safe-area-inset-*)` via a probe element and applied to the HUD.
- **Touch mode is live, not latched.** It starts from `pointer: coarse` /
  `maxTouchPoints`, then the last real input wins — so a hybrid laptop shows key
  hints once you touch the keyboard and tap hints once you touch the screen.
- Haptics fire on near miss, twin edges, redline and death where the platform supports it.

A ring stops turning once it is fully inside the cursor's orbit and is being
absorbed by the core — a wall sliding sideways against a core that does not turn
with it reads as the geometry coming apart. The cut-off is `absorbed()`, the
exact point the wall stops being collidable (`dist + len + COLLIDE_PAD <= orbit`),
not the point it visually touches the core: `hitsWall` can reach out to `orbit`,
so freezing anything closer would quietly change the game rather than the
picture. Verified by running 42 seeds with the freeze on and off — every result
identical, and every run had rings freeze.

### Walls on the beat

The obstacles are scheduled to *land* on the track's transients, so dodging is
playing along with the music rather than moving over the top of it.

Three pieces:

- **Onset detection** (`Sound.pulse`). This used to be an envelope follower on
  the bass band — a volume meter. A sustained bass note held it up and a kick
  inside a loud passage barely moved it. It now measures spectral flux, the sum
  of per-bin *rises* between frames, against a running average of itself, with
  the analyser's smoothing dropped from 0.5 to 0.12 because smoothing is exactly
  what blurs an attack into a swell. Measured on `dorian-overdrive-2`: 85 onsets
  over 16s, and 76% of the intervals landed at exactly 150ms — the eighth note at
  200bpm. It is genuinely locked to the grid, not firing at noise.
- **A phase-locked clock** (`noteOnset`, `nextGrid`). The first version projected
  the grid from the *most recent* onset, which measured as no better than random
  (median error 48ms against a 51ms random baseline) — obstacles are scheduled
  seconds ahead, so anchoring to the latest hit moves the target after the shot
  is fired. A free-running clock is now nudged toward each nearby onset (18% of
  the error, and only for hits within 30% of a period) and left alone otherwise.
  The lock belongs to the *track*, so retrying the daily keeps it.
- **Folding to the tapped pulse.** Detection locks onto *eighths* — 150ms on a
  200bpm track — and quantising to those did nothing perceptible, which is
  exactly what playtesting reported. 400 events a minute is not a rhythm. The
  measurement showed why: on a 150ms grid, rings landed 2.94 grid-units apart,
  musically nowhere. The raw interval is now doubled into the range a listener
  would tap (0.42-0.95s), so 150ms becomes 600ms and rings land **1.00 grid-units
  apart — one per beat**.
- **Quantised spawning** (`Game.onBeat`). Each ring's arrival time is rounded up
  to the next grid point. `BEAT_SNAP_MAX` must exceed the longest grid period, or
  a ring can never reach the next beat and silently falls back to unquantised
  spacing. Only ever later, never earlier: the incoming distance
  is already the minimum that keeps the gap reachable, so rounding up preserves
  fairness by construction — with a synthetic grid in the canary, 210/210 clean
  runs versus 207/210 without. With no beat detected (muted, still loading, a
  track with no clear pulse) the hook returns the time unchanged and spacing is
  exactly what it always was.

The camera pulse was briefly pushed to ±18% to match the original's ±32%; on
these faster tracks that read as the whole screen throbbing, so it is back to a
light 4.5% lift and the beat is expressed through the walls instead.

### Rests

Measured against a recording of Super Hexagon (Hyper Hexagoner): it sits at ~6%
wall coverage and leaves the arena genuinely empty for up to **4.6s** at a
stretch. We ran ~11% coverage with no quiet spell longer than **0.9s**, because
`maybeSpawn` fired the moment `frontier` fell inside `spawnDist` — every pattern
followed the last at the tightest legally-fair spacing, so the run read as one
unbroken stream rather than something with a rhythm.

The spawner now sometimes pushes the frontier out by `REST_MIN`–`REST_MAX`
wall-flights before the next pattern. Measured in wall-flights rather than
seconds so a rest lasts the same wall-clock time on any stage.

| | before | after | Super Hexagon |
| --- | --- | --- | --- |
| longest quiet spell | 1.2s | 4.3s | 4.6s |
| field empty | 6% of the time | 33% | — |
| walls on screen, median | 6 | 4 | — |

It does make the game easier, and unevenly so — which is the point. Against a bot
that plays well but commits the wrong way for ~180ms now and then (120 runs per
row, medians), a rarely-stumbling player gains 8% while a frequently-stumbling
one gains 67–90%. Rests raise the floor without moving the ceiling much.

### Framing and the beat

Measured against the same recording: their core occupies 14-20% of the screen's
half-height (5-7 core radii fit on screen); ours occupied 13.1% (7.6 radii). The
phase zooms moved from 1.00-1.12 to 1.24-1.36 to match.

Zooming in cuts how far ahead you can *see* — visible world radius is
`WORLD_HEIGHT / (2 * zoom)`, so 320 units became 258, a 24% cut in visible lead
time. That is invisible to the normal canary, which reads every wall including
ones off screen, so the difficulty question was measured with a bot restricted to
walls inside the visible radius. Medians were unchanged (10.0 / 5.9 / 2.2s vs
10.0 / 5.9 / 2.1s): a greedy policy only needs the nearest ring, and it still
sees that in time. A human planning two rings ahead uses more lookahead than this
bot does, so treat it as evidence the change is cheap rather than proof it is
free.

The camera pulse was a 4.5% wobble against their ±32%. `PULSE_ZOOM` is now 0.18.
The pulse *signal* already had the right shape — fast attack, eased release, read
off the track's 45-250Hz band — only the depth applied to the camera was wrong.

**The framing is aspect-aware, and that is not optional.** Their zoom is
calibrated against a landscape screen's short axis, which is its height. On a
phone held upright the short axis is the *width*, and visible world radius —
which is exactly how much warning a wall gives you — is set by the short axis
alone. Applying the same zoom everywhere made portrait brutal while landscape
looked right. `framingZoom()` therefore spends the tighter frame only where there
is room: wide screens get the full 1.24, tall ones fall back to ~1.00, the
roomier view they had before. Playtesting is what caught this; the visibility-
limited bot did not, because a greedy policy only needs the nearest ring while a
human is reading two ahead.

Walls are drawn in two passes — a darker body, then a fixed `WALL_EDGE` slice of
lit leading edge on top, all edges after all bodies so a nearer wall cannot cut
into a further one's edge. It gives the tunnel depth, and it puts the brightest
thing on screen on the edge you actually have to clear. The palette hue also
shimmers ±19° on a 2s period, measured off the original, which never holds a
completely static colour.

### Getting onto the board

The first time a run qualifies, the game asks for a name; after that submissions
are automatic and the server keeps only your best for the day.

"Qualifies" originally meant *beating the current leader*, which was wrong in a
way that only showed up once a day had any score on it at all: the board holds 25
rows, so a player who did not beat first place was never offered a name, could
therefore never be recorded, and never appeared — despite 24 open rows. Whether
you were invited also depended on whether your client had fetched the board yet,
so it was inconsistent between players on the same day.

It now asks whenever the score would actually land on the board — the board is
not full, or the score beats the lowest row shown. `BOARD_SIZE` mirrors the
server's `TOP_N`; getting it wrong only ever costs a redundant prompt, never a
lost score. Declining is remembered per day, so it is one prompt rather than one
per death.

### The auto-rescue was playing most of the game

Bullet time fires when the odds of reaching the next gap fall below `RESCUE_AT`.
That was 0.9 — which fires when you have a **90% chance of getting there
unaided**, not the "little to no chance" the mechanic was specified as. Measured
against a bot, the safety net was absorbing more than half the difficulty:

| trigger | deaths/min | reached 60s |
| --- | --- | --- |
| off | 2.60 | 4% |
| 0.90 (old) | 1.09 | 32% |
| **0.60 (now)** | **1.61** | **14%** |

The first real telemetry agreed: players took 2.8 rescues a minute — one every
~22 seconds — and still died with an empty bank 100% of the time. A net that
catches you constantly is not tension, it is the game playing itself, and it
fires so often it stops reading as a rescue at all.

Lowering it is safe: the fairness canary holds 210/210 at every value down to
0.4, because a greedy bot never needs the net. It exists only for imperfect play,
which is exactly why tuning it changes how the game *feels* without touching
whether it is winnable.

### The Architect (`/architect/`)

Play the game from the other side: you queue the next wall, an Autopilot tries to
live, and every knob that decides whether it can is a slider beside the arena.
The two halves are the same thing — the adversary in this game *is* its
difficulty.

The opponent is the real Autopilot with one addition: **reaction time**. At 0ms
it is the fairness canary and cannot be killed, which is the guarantee rather
than a bug; the lab says so on the slider. Every millisecond after that is the
difficulty the geometry knobs could never reach.

Two things it deliberately does not do. Queuing a pattern does not bypass the
spawner — it still places the wall where the fairness rule allows, so the
architect chooses the *problem*, not an impossible one. And the lab holds a
private copy of the stage (`game.diffOverride`); writing to `DIFFICULTIES` would
change the real game in the same tab, daily included.

The opponent's latency is not a clean skill dial: a pure reactive delay makes it
oscillate, so 180ms can die faster than 250ms. It is an opponent to beat, not a
calibrated measure of human skill — for that, use `tools/latency.mjs` and treat
the numbers as a floor.

`/architect/*` had to join the `no-store` rule in the Caddyfile. Without it the
zone's 4-hour Browser Cache TTL applies, and there is no purge-capable token on
the NAS — hence the `?v=` on the script tag.

### Difficulty is a named profile, not a dozen constants

Two days of "is it harder yet?" changed knobs one at a time across `game.js` and
`config.js`. When the answer came back as "put it the way it was", there was
nothing to put it back to: the repo's history starts *after* most of those
changes, so there was no commit to revert to. That is the real cost of starting
version control late, and the fix is not to be more careful — it is to make
difficulty one switchable thing.

`src/tuning.js` holds named profiles. `classic` is the game as it played on
2026-08-11; `gauntlet` is everything built on 08-12 and 08-13. `classic` is the
default. Switch with `?tuning=gauntlet`, and anything non-default is unranked and
labelled in the HUD, so a modified run can never be mistaken for the real one.

| | classic | gauntlet |
| --- | --- | --- |
| rescue trigger | 0.9 | 0.6 |
| safety decay | 0.15 | 0.50 |
| rest frequency | 0.20 | 0.45 |
| shuffled pattern bag | off | on |
| day character weighting | off | on |
| puzzle gauntlet | off | on |
| *arena shapes per run* | *2.6* | *4.9* |
| *shape changes per run* | *2.2* | *11.1* |
| *fairness* | *210/210* | *210/210* |

The harnesses take `TUNE=` so either profile can be measured, and both must
certify 210/210 — a profile is allowed to be easier or harder, never unfair.

**Bug fixes are deliberately not profiled.** The post-reshape clearance, the
twin/even-sided guard and the charge ring following the core's inradius apply to
both. A profile should never be able to select a bug.

### A run is a gauntlet of puzzles, not one demand repeated

Difficulty was treated as a scalar for far too long — faster walls, tighter gaps,
a stingier rescue — and every attempt failed. Profiling what a run actually
*posed* showed why:

| what a 60s run poses | before | after |
| --- | --- | --- |
| distinct arena shapes | 2.6 of 5 | **4.9** |
| shape changes | 2.1 (10% of runs: none) | **11.1** |
| distinct patterns | 8.3 of 18 | 8.1 |
| two+ mechanics at once | 3.2s of 60 | **5.5s** |

Ninety-five percent of a run asked for exactly one thing at a time. Making that
one thing arrive sooner was never going to make it harder.

A run is now `PUZZLE_COUNT` segments, each a distinct triple of *arena shape x
pattern family x modifier*, drawn from the seeded stream so everyone walks the
same gauntlet in the same order. No triple repeats within a run. Shape shifts and
modifiers move to segment boundaries rather than phase boundaries, which is what
makes them frequent enough to matter. The family is **weighted, not locked** —
locking gave the run its shape but dropped distinct patterns to 5.9.

Two fairness bugs surfaced, both invisible at two shape changes a run and fatal
at eleven:

- **Twin needs an even-sided arena.** `requestShift` had always guarded this;
  setting `shiftPending` directly from the scheduler walked past it. A triangle
  with a second cursor is not a hard puzzle, it is an unsurvivable one. This was
  the whole 162/210 regression — every failing run was a twin run, at identical
  times across different seeds.
- **A reshape set `frontier = -Infinity`**, so in `max(spawnDist, frontier +
  clear)` the clearance term was discarded and the first ring after every reshape
  ignored the fairness calculation. Now anchored to the cursor's own radius.

**Not shipped: twin as a per-puzzle modifier.** It measured better on every axis
(twin live 10.8s, compound 6.4s) and cost five canary runs — `openTwin` mirrors
the field onto opposite slots, and doing that while the scheduler is already
reshaping produces states a greedy bot cannot escape. It needs to wait for a
genuinely drained board.

### Each day has a character

A day used to differ from another only by which mode bits it rolled, which is a
thin kind of variety. Now that the pattern library spans distinct motions, the
seed leans the pool toward one of them: **SPIRAL DAY**, **PATIENCE**, **SWINGS**,
**WALL OF SOUND**, or plain **MIXED**. It shows on the menu badge beside the
day's modes, so it is something players can name and compare.

A lean, never a lock. Favoured patterns are entered into the draw `weight` times
rather than the pool being filtered, which measured at 48-56% of spawns from the
favoured set while **all 18 patterns still appeared on every flavour** — no day
loses vocabulary it needs, and the spacing rule is untouched (210/210).

The character has its own hash, so it is independent of the modes and the track
the same seed picked: spiral-days that were also twin days came out at 312 of
3000 seeds against 300 expected.

### Pattern choreography

Ring arrivals are quantised to the beat, so *spacing* no longer distinguishes one
pattern from another — what is left is choreography: how far you must travel
between one opening and the next. Profiling the library on that axis found ten of
fifteen patterns collapsed onto the same signature, "one slot, every beat":

| motion | before | after |
| --- | --- | --- |
| hold still (0 slots) | 1 | 3 |
| walk (1) | **10** | 7 |
| lunge (2) | 1 | 3 |
| sprint (3+) | 0 | 1 |
| mixed | 1 | 2 |

`hold`, `stutter-step` and `cross` are new; `zigzag`, `whiplash-spiral` and
`longspiral` were rewritten so they are not all the same walk under different
names. Fairness unaffected — 210/210 — since the spawner still widens any gap it
has to.

### Patterns are drawn from a bag, not picked at random

Independent draws let a run cluster on whichever patterns came up, and the pool
is not uniform in threat — `escape-spiral` is ~18% of all rings while accounting
for ~7% of deaths, and `pinwheel`, `rain` and `ladder` are close to harmless. A
run that happened to draw mostly soft patterns was a soft run, and because the
daily's seed fixes the sequence for everybody, that landed as a whole *day*
being unaccountably easy.

Measured across a week of real seeds, the daily swung from **0.42 to 2.64 deaths
per minute** — a sixfold spread in how lethal "the same game" was, invisible to
the player and fatal to comparing scores across days. Drawing without
replacement (`Game.drawPattern`) keeps the long-run mix and the day's character
— the flavour still enters its favourites more than once, so they still come up
more often — while removing the clustering. That took the spread to **0.67–2.37,
sd 0.75 → 0.46**. Fairness held at 210/210, all 18 patterns stayed reachable on
every flavour, favoured share stayed at 45–56%, and the rest structure was
unmoved (34% empty, longest quiet 4.7s).

The bag is reset in `start()`: a half-consumed bag carried into a retry would
make a second attempt at the daily differ from the first, which breaks the one
promise the daily makes.

### The difficulty curve was flat, and minClearFor is why

`minClearFor` is `travel * (speed / effective) * safety + 12`. The spacing is
**divided by the wall speed** — which means when walls speed up, they are spawned
proportionally further apart and the player's reaction time stays constant *by
construction*. Everything the phase table appears to ramp is cancelled:

| phase lever | what it actually does |
| --- | --- |
| wall speed +34% | divided straight back out by `minClearFor` |
| `spin` 1.0 → 2.4 | drives `cam.rot` only — harder to *read*, mechanically nothing |
| `zoom` 1.24 → 1.36 | marginal loss of lookahead |
| `tier` 0 → 3 | harder patterns need more travel, so they get *more* clearance |

That left `safety` as the only real escalation, and it was decaying at 0.15 —
1.95 to 1.80 over a full run, a 7.7% tightening that never approached its own
1.45 floor. Measured per 15-second window, the game did not get harder after the
first phase: 1.29 / 1.94 / 2.42 / **1.90** deaths per minute, with the window
called EVERYTHING IT HAS *easier* than the one before it.

At `safetyDecay: 0.50` the window travels the full 1.95 → 1.45 and the curve
appears: **1.34 / 2.10 / 2.40 / 2.50 / 3.06**, monotonic, fairness still 210/210.

### Pace is the only lever a good player feels

The fairness canary guarantees a **zero-latency** greedy bot clears every seed.
A skilled human is close to that bot plus a couple of hundred milliseconds, so
whatever the canary certifies as survivable, a good player can survive too. That
is why three rounds of tuning — rests, rescue trigger, safety decay — moved the
bot numbers without moving how the game felt.

Every lever except one changes *geometry*, and `minClearFor` normalises geometry
back into constant reaction time. `pace` scales wall speed and cursor speed
**together**: the geometry is identical, the fairness guarantee is untouched
(210/210 at every pace), and the only thing that changes is how many
milliseconds a human gets to read the field. It is invisible to the canary by
construction, which is exactly why it is the lever that works.

Measured against a bot playing perfectly on 100ms-stale information — which
lands near Matt's real telemetry (1.05 vs 1.63 deaths/min, 14% vs 17% reaching
60s) — pace is steep:

| pace | deaths/min | avg run | reached 60s |
| --- | --- | --- | --- |
| 1.00 | 1.05 | 49.2s | 14% |
| 1.20 | 3.87 | 15.5s | 0% |
| 1.40 | 6.44 | 9.3s | 0% |

`?pace=1.2` on the URL, or `dailyhex.setPace(1.2)` in the console. The URL is the
only source of truth — an earlier version remembered it for the session, which
meant the plain address still played at whatever had last been tried: a modified
game wearing the default's clothes. Retries do not reload and reloading keeps the
query string, so stickiness bought nothing. Labelled in the HUD and always
unranked; the board only compares like with like.

**Do not model the player.** Two attempts failed in opposite directions: a bot
with random wrong-way commits measures how punishing a blunder is, and a good
player does not blunder; a bot with pure reactive delay oscillates and dies in
nine seconds, while Matt clears seventy-nine. Humans anticipate. Use the bot for
fairness, which it measures exactly, and use a real player for feel.

### Rest frequency is per profile, because its safe floor is

Rests are load-bearing rather than decoration: the spawner uses them to buy the
clearance a greedy bot needs, so how far they can be cut depends on how much
margin the profile already leaves. Classic (margin decaying only 1.95 -> 1.80)
holds 210/210 all the way down to 0.10. Gauntlet (decaying to 1.45) has nothing
spare and loses a canary run at 0.20.

Shipped classic at **0.20**, down from 0.45: the opening fifteen seconds go from
73% empty to 60%, the late run to 38-46%, and walls on the approach rise from 1.5
to 2.1. Gauntlet stays at 0.45 because it cannot afford less.

That is why the value moved out of `config.js` and into the profile — a single
global constant was quietly unfair for one of the two settings it served.

### Idle time is bounded by the fairness invariant

More than half of a run has nothing on the approach — 72% of the first fifteen
seconds. That is not an oversight, it is the fairness guarantee made visible:
the spawner must leave a greedy bot room to always make it, and that room is
empty screen. Every lever was measured against it:

- **fewer rests** (0.45 → 0.20): canary drops to 208/210, and it front-loads
  difficulty, flattening the curve
- **shorter rests** (max 2.3 → 1.2): 209/210
- **rests fading out over the run**: 209/210 at any strength worth having
- **lower base safety** (1.95 → 1.60): idle unmoved at 71%
- **faster cursor** (5.0 → 8.0): idle unmoved; rests are measured in `spawnDist`
  units and are immune to every speed lever

Late-run idle falls out of the escalation fix on its own (56% → 51%). Cutting the
early figure further means relaxing the invariant that a greedy bot always
survives — a design decision about what the game *is*, not a tuning knob.

### Why the stage table resists tuning

Three separate attempts to re-tune the six stages produced nothing trustworthy.
The diagnosis is worth more than the tuning would have been, because the table
has four kinds of knob and three of them cannot do what they look like they do:

- **`spin`, `spinGain`, `flipEvery`, `spinBurst` are camera-only.** `this.spin`
  writes to `cam.rot` and nowhere else. They disorient a human and are completely
  invisible to a bot — trials that changed only spin returned byte-identical
  results. This is the dominant human-facing difficulty lever on the hard stages
  and no automated measure here can feel it.
- **`safety` is inert on fast stages.** `minClearFor` returns ~111 units for a
  one-slot move where the patterns' own authored spacing is ~100, so the two sit
  at their crossover and whichever binds wins. Loosening MELTDOWN's floor from
  1.13 to 0.80 changed actual spacing by 0.5%.
- **`factor` scales walls *and* cursor**, so it does not change reachability at
  all — only decision rate — and past a point it makes a stage easier. MELTDOWN
  at 2.0 / 2.3 / 2.5 / 2.7 measured 13.7 / 11.7 / 12.9 / 13.6s.
- **`baseTier` / `maxTier`** is what remains: real, but coarse and discrete.

Measured as a hazard rate (deaths per minute, 900s of exposure per cell, which
turns one heavy-tailed observation per run into many events), every
parent → redline pair is already correct: SPARK 0.57 → FLARE 1.47, FORGE 1.55 →
FURNACE 1.71, CRUCIBLE 2.04 → MELTDOWN 2.31. So the table is left alone, on
purpose. Retuning it on bot evidence would mean tuning the three knobs a bot can
see while the one that actually governs human difficulty stays untouched.

### Superseded: stage difficulty notes

An attempt to re-tune the six stages against the new mechanics did not converge,
and the reason is worth recording rather than papering over.

`minClearFor` returns `travel * (speed / playerSpeed) * safety + 12`. Both speeds
scale with a stage's `factor`, so the ratio is factor-independent — meaning
`factor` does not move ring spacing at all, it only makes the cursor faster
relative to distance-fixed patterns, which makes a stage *easier*. Measured:
MELTDOWN at factor 2.0 / 2.3 / 2.5 / 2.7 gave 13.7 / 11.7 / 12.9 / 13.6s —
non-monotonic.

Meanwhile the fairness minimum (~111 units for a one-slot move) and the patterns'
authored spacing (~100 units) sit almost exactly at their crossover, so `safety`
and a per-stage spacing multiplier each only bite when they happen to be the
binding term. Loosening MELTDOWN's floor 1.13 → 0.80 moved actual spacing by
0.5%.

And the survival probe resolves to roughly ±1s at the hard end, which is the same
size as the effects being chased. A FURNACE retune that looked like a 5s
improvement did not reproduce; it has been reverted rather than shipped on the
strength of noise.

What this needs before any stage tuning is trustworthy: a difficulty measure with
real resolution at 10-15s survival times, and a decision about which term should
own pacing now that the beat grid exists.

### Stage table, re-measured

Every redline stage is meant to be its parent, harder. Measured as *pairs* — 40
seeds, two sloppiness levels, trimmed to the middle of the distribution because
the tails here are seed luck rather than difficulty:

| pair | parent | redline | |
| --- | --- | --- | --- |
| SPARK → FLARE | 42.2s | 29.3s | ok |
| FORGE → FURNACE | 28.8s | **28.4s** | broken |
| CRUCIBLE → MELTDOWN | 13.8s | 11.6s | ok |

FURNACE had inherited its parent's dodging slack (`safety` 1.45 / floor 1.14,
identical to FORGE), so its higher pattern tier and faster start had nothing to
bite on. Tightened to 1.30 / 1.04, which lands it at 23.4s.

A first pass measured 20 seeds and concluded FLARE was easier than FORGE — but
those two are not meant to be ordered against each other (the ladder is
per-parent, not linear), and at 20 seeds the numbers moved ±5s between identical
runs. Tuning against that would have been tuning against noise.

### The design system lives in `ui.js`

The UI kept breaking in the same way: every call site invented its own number —
`mu * 3.4` for one gap, `h * 0.795` for another — so nothing lined up with
anything, and a change to the type size pushed copy straight through the panel
around it. `tokens(view)` is now the only place sizes are decided:

- **Type** is Apple's HIG ramp (`largeTitle 34 / title 28 / title3 20 /
  headline 17 / body 17 / subhead 15 / footnote 13 / caption 12`).
- **Spacing** is a 4pt grid (`xs 4 … xxl 32`), radii and touch targets alongside
  it — 44pt minimum, per Apple.
- Both ride one `scale`, clamped to 1–1.5×, so a phone renders at the HIG
  baseline and a desktop keeps the same proportions instead of shrinking.

Content is *declared*, not positioned. `layoutBlocks()` takes a list like
`{ kind: 'title' | 'body' | 'cta' | 'link', text }`, wraps each block once, and
returns rows that already carry their size and their `y`. Measuring and drawing
consume the same rows, which is the point: every overlap this UI has had came
from a measure pass and a draw pass disagreeing about how many lines there were.
A card sizes itself to its own copy and cannot land its title on its first line.

### The HUD was rendering below the legibility floor

The in-run labels were sized off `u` (`u * 2.2`), which on a phone is **8.25 CSS
px** — under Apple's 11pt absolute minimum. That is why the stage name, phase and
twin countdown were unreadable in the corner. They are on the token ramp now,
and the right-hand column is inset past any top-right corner button the same way
the left column already avoided the pause button — pausing used to draw the clock
straight underneath the close button.

### Game over is two anchored stacks

Every element used to be placed at its own fraction of the screen height
(`h * 0.2`, `h * 0.305`, `h * 0.788` …), so each one was positioned independently
of the others and an optional piece landed on whatever else owned that band —
which is how the lesson button ended up drawn over the practice buttons. The hero
now flows down from the top and the controls stack up from the bottom, so
anything optional (an unlock, the assist note, the practice row, the lesson
offer) displaces its own neighbours. Verified with every optional element present
at once on a 667pt-tall screen.

### Sizes are CSS pixels, and must not be multiplied by dpr

`main.js` does `ctx.setTransform(dpr, …)`, so the drawing space is *already* CSS
pixels. An earlier fix for Retina shrinkage multiplied type by `view.dpr` on top
of that, rendering every sheet 1.5× oversized — which is what pushed the copy out
of its panels. Sizes are plain CSS pixels; `dpr` belongs to the backing store.

### One font, shipped

The stack led with `"Arial Black"`, which does not exist on iOS. iPhones fell
through `"Arial Bold"` and `Gadget` (neither is a real family there) all the way
to **Helvetica Neue Regular** — so the game rendered in a light face on phones
and a heavy one on desktop. Archivo Black (SIL OFL, latin subset, 9.8KB) is now
self-hosted in `assets/`, which also keeps it working offline.

Canvas binds `ctx.font` at assignment time, so a size first set before the font
arrived stays bound to the fallback forever. `invalidateFontCache()` is called
once `document.fonts.ready` resolves, forcing every size to be re-bound — without
it the first frames' `measureText` layout is computed against the wrong metrics.

### The board is ten deep

A board that only shows a podium is not really a board, and being 7th is exactly
the near-miss that brings someone back. The top three get gold/silver/bronze hex
medals and a metallic sweep across their names — the shine is a *moving*
highlight stop rather than a static gradient, because a static gradient reads as
a gradient and a travelling one reads as metal. Names are stroked before they are
filled so the shine stays legible against the panel.

### The tutorial has to bypass the steering guard

`steering()` was `game.state === 'play' && !game.paused`, and the tutorial holds
the world with `paused = true` while waiting for a direction to release it. So on
touch a tap never pressed a direction — it fell through to `action()` — and the
lesson card could not be dismissed at all. Keyboard worked, because key handling
never consults that predicate, which is exactly why it looked fine on a desktop
and was completely broken on a phone. The guard now reads
`(!game.paused || tutorial.active)`.

Two things followed from that: `sound.unlock()` had only ever been reached via
`action()`, so it moved to `inputMode` (any first gesture unlocks audio), and the
SKIP target — drawn, hit-boxed, and exported as `teachSkipHit` — turned out never
to have been wired to anything. It is checked before steering, or the tap that
hits SKIP also presses a direction.

### First-run tutorial

A brand-new browser gets taught inside the real game rather than shown a wall of
text. `tutorialNeeded()` treats "no tutorial flag, no days played, no best time"
as new, so anyone who was already playing before this shipped is left alone.

Four lessons — orbit, find the gap, bullet time, go — each held still with the
world frozen and a card at the bottom, released the moment the player *performs*
the control being described. Pressing a direction is what dismisses a card, so
the tutorial cannot be clicked through without learning anything.

Details that turned out to matter:

- **Lesson one runs in an empty arena.** Teaching someone to move while walls are
  already closing in teaches them mostly to panic. The step clears walls and
  pushes the frontier out, on entry and every frame.
- **`game.paused` is re-asserted every frame while a card is up**, because
  `game.start()` clears it — a hold armed before a run finished loading was
  silently dropped, and the first thing a new player saw was themselves dying
  during the instructions.
- **The PAUSED sheet is suppressed during a hold**, along with the corner
  buttons, or it buries the very thing they are meant to read.
- **Nothing a learner does counts.** `game.tutorial` joins `demo` and `practice`
  in the guards on `die()`, `award()` and `markReached()`, so a first three-second
  death cannot post a score, burn a record or trigger the name prompt.
- Dying repeats the *same* lesson, not the whole sequence, and the copy escalates
  through `SNARK` — the joke is the game's patience, not the player's competence.
- Skippable with ESC or the SKIP target, and the flag is written on completion so
  it never asks twice.

### The title screen has no settings sheet

Sound was one row inside a sheet reached through a gear, which is three taps to
do the only thing anyone does in a hurry. The gear is now the mute button
itself. Best times and badges moved to a second link beside HOW TO PLAY rather
than disappearing with the sheet — twin mode belongs to the seed now and had no
business being a toggle, and resetting best times lives in the stats sheet where
the times it destroys are on screen.

The tagline is gone in favour of greeting a returning player by the name they
put on the board. Length is the whole problem: "GOOD AFTERNOON, CHAD
THUNDERBUTT" is over three times the width of "HI, JAS". Rather than shrink one
line until the longest name is unreadable, `drawWelcome` picks the longest
phrasing that fits at full size and only shrinks when even the bare name is too
wide. Someone who has never entered a name gets nothing — a greeting addressed
to no one is worse than no greeting.

### Add-to-home-screen instructions are per browser

Getting these wrong is worse than saying nothing: the player follows them, fails
to find the item, and concludes the game is broken. Chrome on iOS is the one
people get stuck on — it has a Share sheet like Safari, but "Add to Home Screen"
sits behind **View more** rather than in the first list. iPadOS is detected by
touch points, since it reports a desktop Mac user agent.

No step tells anyone to open their browser. They are reading this in it.

### Anonymous telemetry

Everything balanced so far was measured against a bot, and a bot is a floor
rather than a model of a player: it cannot see the camera spin, which is a large
part of what a human finds hard, and it never tilts, gets bored or gives up.
`src/telemetry.js` records one row per finished run so the questions the offline
harnesses answer can be asked of real hands — and `tools/telemetry.mjs` prints
them on **the same axes**, so a human number sits directly beside the bot number
used to tune it. Where the two disagree is where the bot was lying.

What it is for, concretely: which patterns actually kill (the bot has
`escape-spiral` at ~7% of deaths — if humans differ wildly, the pool is wrong),
whether a rescue arrived in time (dying with a full bank means the trigger is too
shy), whether a shape or a day character is disproportionately lethal, and
whether short runs mean a hard game or a failed tutorial.

**Anonymous means anonymous.** No name, though the game knows one. No account,
cookie or persistent id — the run is not linked to any other run, let alone to a
day. No IP is stored; the server drops it after rate limiting. No user agent,
only "touch or keyboard" and a coarse screen class, because the same seed really
is a different game on a phone. Nothing free-text, so nothing a player types can
reach the file. The server keeps an **allow-list** of fields rather than a filter,
so a client that started sending something unexpected could not quietly widen
what is collected, and strings are length- and character-restricted on arrival.

Players are told, in HOW TO PLAY, and can turn it off under BEST TIMES. A
browser-level `globalPrivacyControl` or `doNotTrack` signal counts as off without
being asked. Demo, tutorial and practice runs are never recorded — counting them
would claim the autopilot's deaths as a player's.

Storage is JSON lines on the same Docker volume as the scores, rotated at 64MB.
`TELEMETRY_FILE` must point *into* the volume: defaulting it inside the image
looks like it works and then vanishes on the next recreate.

### Installable

`manifest.json` plus the `apple-*` meta tags — iOS ignores the manifest's display
mode, so without them "Add to Home Screen" produces a Safari-chrome-wrapped page
rather than the game full screen. Icons are generated from the game's own core
hexagon (`assets/icon-*.png`, including a maskable variant with an Android safe
zone).

The title screen's top-right button becomes **install** whenever the game is not
already running standalone; stats move into the settings sheet while it is there.
Chrome hands us a deferred `beforeinstallprompt` which the button fires. iOS has
no equivalent API at all, so there the button opens step-by-step instructions
instead — the button shows regardless of whether a prompt exists, because on iOS
we can only ever know whether the game *is* installed, never whether it *could*
be.

Also fixed here: `og:image` had pointed at `assets/logo.png` since that file was
renamed to `wordmark.png`, so every link preview had been broken.

### "Someone passed you"

The point of a leaderboard is the rematch, so the board says out loud when you
have slipped rather than leaving you to notice: *ELSIE PASSED YOU — NOW #4*, or
*YOU TOOK BACK FIRST* on the way back up.

This is deliberately **not** notifications. Real push would mean a service worker
and VAPID/ECDH payload encryption in a zero-dependency server, and on iOS it only
works for home-screen-installed PWAs — which, for a mobile-first game, means the
main case silently does nothing. Email would mean collecting addresses, consent
and an unsubscribe path for a game with no accounts. And the board resets daily,
so the window is a few hours. An in-app nudge needs no permission, no address and
no identity beyond the name already typed, and it converts the visit you already
had into another attempt.

`dailyhex.rank-seen` stores where you stood per date, last seven days. On each
board poll, a worse rank names whoever is newly above you — the slice between
where you were and where you are, so it credits the player who actually passed
you rather than everyone ahead. The notice takes the footer slot the personal
best normally occupies (both are one-line summaries; this one is the urgent one)
and clears when you start a run, because starting a run is acting on it.

Names are self-chosen and unauthenticated, so this matches on the exact stored
name. Good enough for a nudge, and it gates nothing that matters.

### Long-open tabs

A tab left open does not age well: the loaded code is frozen at whatever build it
fetched, and this is a *daily* game, so leaving it open overnight leaves the menu
advertising yesterday's seed. On returning from more than `STALE_AFTER_MS` hidden,
the page checks whether it is out of date and reloads if so.

Two rules keep that from being obnoxious:

- **Never reload without a reason.** The reason is either a different calendar day
  or a genuinely different build, the latter detected by comparing the `etag` (or
  `last-modified`) of `src/main.js` against the one captured at load. A failed
  fetch returns null and is treated as "no information", not as "changed" —
  otherwise going offline would boot the player for nothing.
- **Never reload a run in progress.** The reload is deferred until the player is
  back at the menu. Destroying a run someone is in the middle of is a far worse
  bug than a stale tab.

`pageshow` with `persisted` is handled too: a page restored from the
back-forward cache can have been parked for days without ever firing
`visibilitychange`.

The dev server sends `etag` and `last-modified` for the same reason Caddy does —
without them this path could only ever be tested against production.

### The cursor rides the polygon

The arena, the core and every wall are polygons built from straight chords, and
a chord dips inward at the middle of a face by `cos(halfStep)`. The cursor used
to orbit a true **circle** through all of that, which needed a `cos` correction
in `hitsWall` and left it visually swinging away from the arena mid-face:

| arena | cursor's height above the core, face centre vs corner |
| --- | --- |
| hexagon | 1.28x |
| square | 1.61x |
| triangle | **2.05x** |

At a hexagon that reads as nothing. At a triangle the cursor is literally twice
as far from the core in the middle of a face as it is at a corner, and the whole
thing stops looking connected — which is exactly what a player notices as "the
shapes not lining up".

It now follows the polygon, sliding along each face at constant height the way
the original's does. `orbit` becomes a plain radial position on the same scale
walls use, so a wall reaches you at `dist === orbit` wherever you are in a slot —
which also deletes the `cos` correction and makes `escapeOdds()`'s
time-to-arrival exact rather than approximate. `orbitAt()` blends the factor
through a shape change so the cursor tracks the morphing arena rather than
snapping. Fairness measured before and after: 202/210 → 203/210.

### Only the incoming face kills

A wall used to be solid along its whole radial depth, so sliding sideways into a
lane a wall had already swept through killed you — brushing the flank of
something that was already being swallowed by the core. Now only the leading face
is lethal: `KILL_DEPTH` world units from `w.dist` inward, never the whole body.

The band has to be comfortably wider than the distance a wall covers in one
fixed step or a wall could step straight over it between frames and pass through
you. The worst case is 6.8 units per 240Hz step at the fastest stage's top speed,
against a 24-unit band. Verified by sweeping a wall past the cursor at every
sub-step phase offset on every stage: zero misses.

Grazing is keyed to the same window. Shaving the flank of a wall that could not
have killed you is not a near miss — there was nothing to miss.

This can only ever make the game more forgiving, so fairness is unaffected
(210/210), and it removes a death that reads as unfair because visually the wall
is already behind you.

### Rotating rings

Some rings arrive spinning, so their gap drifts around the field while it
closes on you. In the original the world's rotation is pure decoration — the
geometry underneath never moves — which means you can learn to ignore it. Here
the spin is *sometimes* real, so you have to read each ring rather than the
camera. The static background wedges stay fixed, which gives you a reference
frame to read the drift against.

Spin is capped at `RING_SPIN_FRACTION` (0.3) of the player's angular speed, so
a drifting gap can always be chased down.

### Twin mode

Two cursors, 180° apart, one input, both lethal. It's really a three-slot game
wearing a hexagon: every ring's openings get projected onto `slot % 3` and
mirrored, so an opening for one cursor is always an opening for the other. That
projection (`symmetrize` in `game.js`) is what makes arbitrary patterns
twin-safe without authoring a second pattern library.

Twin does not open a run, and it is a *window* rather than a switch. When the
seed enables it, the same seed fixes when the first window opens (a whole number
of seconds between 15 and 60) and how long each window lasts (8-20s). From there
it alternates on and off in equal blocks for the rest of the run, so a twin seed
has a rhythm instead of a one-way difficulty cliff, and everyone playing that day
crosses the same edges at the same seconds.

Opening a window is the delicate direction: the walls in flight were built for
one cursor, and mirroring the world underneath them would drop the second cursor
into a wall. So the spawner stops one wall-flight ahead of the edge (`twinPending`
gates `maybeSpawn`, exactly as `shiftPending` does) and the flip clears whatever
is left. Unlike a shape shift it does *not* wait for a clear board — the seeded
second is the contract, and clearing the last few walls is a gift rather than a
hazard. Closing a window is free: a field built for two cursors is trivially
passable by one, so that edge is seamless. If the arena is on an odd polygon when
a window opens it snaps back to the hexagon, since mirroring needs an even side
count.

Both edges are announced briefly and *out of the play area*: a short strip low on
the screen (`TWIN MODE` / `TWIN MODE OFF`, 0.9s), a particle burst where the
second cursor appears or leaves, and a sting that rises to arrive and falls to
leave. The corner HUD carries a live countdown to whichever edge is next. Records
are keyed by whether the *seed* is a twin seed, never by whether a window happened
to be open when the run ended.

## How it works

| File | Role |
| --- | --- |
| `src/config.js` | Geometry constants, difficulty table, ranks |
| `src/patterns.js` | Wall pattern library (shape only — see below) |
| `src/game.js` | Simulation: spawning, movement, collision |
| `src/render.js` | Canvas drawing and HUD |
| `src/audio.js` | Per-stage music playback + synthesised SFX |
| `audio/` | One track per stage |
| `src/input.js` | Keyboard and pointer handling |
| `src/autopilot.js` | The 777 demo: bot steering + scripted tour |
| `src/main.js` | Canvas sizing, RAF loop, wiring |

A few things are worth knowing if you want to change it:

**Walls are chords, not arcs.** A wall face is a straight line between two
points on a hexagon, so its distance from the centre varies across the face:
`d(ψ) = r·cos(30°)/cos(ψ)`. The hit test converts the player's circular orbit
into that same space rather than comparing raw radii, so collision matches
exactly what you see. Getting this wrong produces a ~13% mismatch between the
drawn gap and the real one.

**Patterns describe shape, not spacing.** The `dist` values in `patterns.js`
set the *order and character* of rings; the spawner then widens any gap that
would be too tight to physically dodge at the current wall speed
(`minClearFor` in `game.js`, scaled by the current `safety` margin).
That means adding a pattern can't accidentally create an impossible one, and
speed can keep climbing without the game becoming a coin flip. A greedy bot
that always walks to the nearest opening survives indefinitely on every
difficulty — the challenge is reaction time, not luck.

**Fairness is computed in angles, not slot indices.** This matters once rings
rotate. A ring spinning at 1.5 rad/s drifts around three whole slots during its
flight, so its slot index says nothing about where you will actually need to be
when it arrives. `arrivalAngles` projects each opening forward to its position
at the moment it reaches the cursor, and the spacing is solved against *that*.
Because a ring's arrival angle depends on its distance, and its distance depends
on the clearance in front of it, the spawner runs a short fixed-point iteration
— capping spin below the player's speed makes it a contraction, so three passes
settle it.

**Camera rotation is cosmetic; ring rotation is not.** The camera spin, the
zoom pulse and the CRUCIBLE whip never touch the simulation — player angles
and wall slots live in a fixed world space and only the renderer applies
`cam.rot`. A ring's own `spin`, by contrast, is real geometry. Updates run on a
fixed 240 Hz timestep so collision stays stable when walls move over 1000
units/second, and the renderer smooths over the leftover fraction of a step.

**Wall speed is not the difficulty knob.** Because the spawner sizes gaps
against cursor speed, the time you get between rings works out to
`travel x safety / playerSpeed` — wall speed cancels out entirely. Raising it
alone just spreads patterns further apart. What actually tightens a run is
`playerSpeed` (fixed per stage) and `safety` (decaying with progress).

**The pulse reads the music, not a BPM constant.** Each stage streams its track
through an AnalyserNode, and the core pulses off the 45–250 Hz band — so it locks
to whatever the track actually does instead of to a number that can be wrong.
(My own tempo estimator disagreed with itself across octaves on these files,
which is exactly why this is not a constant.) A per-stage `bpm` in `config.js`
drives a plain metronome as a fallback while the music is muted.

To reassign tracks, edit the `track` field in the stage table — the files live in
`audio/` and there are five for six stages, so MELTDOWN currently reuses
Glitch Dungeon Rush.

`window.dailyhex` exposes `{ game, input, sound, autopilot }` in the console for tuning.
