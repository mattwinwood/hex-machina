# Measurement harnesses

Node scripts that drive the real `src/` against a bot and report a number.
They exist because this game's difficulty is not something you can eyeball: it
is a rate, it is heavy-tailed, and every time it has been argued about from
memory the answer turned out to be wrong.

Run from this directory. `SRC=../some/other/src` points a harness at a different
build, which is how two builds get compared.

```bash
node main.mjs        # fairness canary — MUST stay 210/210
node days.mjs        # daily difficulty by date, with error bars
node hazard.mjs      # deaths per minute, by stage and sloppiness
node rhythm.mjs      # pacing: how much of the time the field is empty
```

## The test suite

```bash
node test.mjs            # 26 invariants; exits non-zero on failure
node test.mjs twin rest  # only tests whose names contain these words
```

Written because too much here has been *presumed* working. The list of things
that were silently dead or lying, every one found by accident rather than by a
test: the SKIP button was drawn, hit-boxed and never wired to anything; the
tutorial was undismissable on touch; `blackout` could never spawn because the
daily's stage capped a tier below it; twin turned a square into a corridor; the
menu advertised a day character the pool was not biased toward; a rest was
measured in distance and lasted four seconds.

So each test drives the real simulation and asserts on what it *observes*, never
on what the code appears to say. "This function exists" is not a test.

A warning from writing it: the first run had four failures and **all four were
bugs in the tests**, not the game — a badge award that lived in `main.js` where
the scan did not look, walls spawned in the same tick as a reshape counted as
survivors, rests conflated with reshape drains, and pattern *draws* counted as
walls. A failing test is a hypothesis, not a verdict. Confirm which side is
wrong before changing either.

## The one that must not move

`main.mjs` is the **fairness canary**. Patterns describe shape; the spawner
widens spacing so a greedy bot always survives. Difficulty is meant to be
reaction time, never luck. If this stops reading 210/210, a change has made the
game unfair rather than hard, and it should be reverted before anything else is
discussed.

## Reading a difficulty number

Deaths per minute, not median survival: median survival is one observation per
run and heavy-tailed, while restarting on death over a fixed budget of game time
gives many events and behaves. Poisson error on the death count is roughly
`rate / sqrt(deaths)`, which most of these print — a difference smaller than the
bars is not a difference. Raise `EXPOSURE` to tighten them.

Bots are blind to anything a bot cannot see. Camera spin is invisible to them
and is a large part of what a human finds hard, so a stage change that measures
flat here may still be felt. Treat these as a floor on difficulty, not a model
of the player.

## Notable results

- `days.mjs` found the daily swinging **0.42–2.64 deaths/min** across a week —
  a sixfold spread in a game whose whole premise is that everyone plays the same
  thing. That produced the shuffled-bag draw in `Game.drawPattern`, which took
  it to 0.67–2.37 (sd 0.75 → 0.46).
- `perpat.mjs` attributes deaths to the pattern that caused them. `escape-spiral`
  is ~18% of all rings and ~7% of deaths; `pinwheel`, `rain` and `ladder` are
  close to harmless. That is where the remaining softness lives.
- `marginal.mjs` withholds patterns from the pool to measure what they are
  worth, which is the closest thing to a build diff when the old build is gone.
- `grid.mjs` found the beat grid mostly neutral (1.55–1.67) with a real
  resonance dip at 0.50s (0.84, five sigma down) — worth remembering if a track
  ever folds near that period.
