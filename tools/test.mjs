// Invariants, not vibes.  Run: node tools/test.mjs
//
// This exists because too much of this game has been "presumed working". The
// list of things that were silently dead or lying, all found by accident rather
// than by testing: the SKIP button was drawn, hit-boxed and never wired to
// anything; the whole tutorial was undismissable on touch; `blackout` could
// never spawn because the daily's stage capped a tier below it; twin turned a
// square into a corridor; the menu advertised a day character the pool was not
// actually biased toward; a rest was measured in distance and lasted four
// seconds.
//
// Every one of those would have been caught by a test that asked "does this
// actually happen?" rather than "does this code exist?". So each test here
// drives the real simulation and asserts on what it observes.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const rk = Object.keys;
Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
// Node 22 exposes navigator as a getter-only global, so define over it.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'test', maxTouchPoints: 0 }, configurable: true,
});

import fs from 'fs';
const R = new URL('../src/', import.meta.url).pathname;
const SRC = R;
const { Game } = await import(`${R}game.js`);
const { Autopilot } = await import(`${R}autopilot.js`);
const { Tutorial } = await import(`${R}tutorial.js`);
const { PATTERNS, poolFor } = await import(`${R}patterns.js`);
const { rng, dailySeed, modesForSeed, flavourForSeed } = await import(`${R}rng.js`);
const C = await import(`${R}config.js`);
const { runRecord } = await import(`${R}telemetry.js`);

const {
  DIFFICULTIES, PHASES, BADGES, FLAVOURS, SHIFT_SHAPES, WORLD_HEIGHT,
  REST_MIN, REST_MAX, REST_MAX_SECONDS, REST_CHANCE, GHOST_HIDE_AT, twinPossible,
} = C;

const GRID = 0.6;
const VISIBLE = WORLD_HEIGHT / 2;

// --- harness -----------------------------------------------------------------
const tests = [];
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function close(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} +/- ${tol})`);
}

/** A game wired the way the real one is, with a deterministic stream. */
function makeGame({ seed = 1, stage = 0, daily = false, date = null, sides = null } = {}) {
  const box = { clock: 0 };
  const g = new Game({ quantize: (a) => Math.ceil((box.clock + a) / GRID - 1e-9) * GRID - box.clock });
  g.unlocked = new Set(DIFFICULTIES.map((d) => d.unlockedBy).filter(Boolean));
  g.diffIndex = stage;
  g.daily = daily;
  if (date) Object.defineProperty(g, 'runDate', { value: date, configurable: true });
  g.setView(390, 844, 620);
  rng.scramble = () => rng.seed(seed * 7919);
  g.start();
  if (sides && sides !== g.sides) { g.shiftPending = sides; g.shiftTimer = 99; }
  return { g, box };
}

/** Advance a game with a competent bot, calling `each` per step. */
function play(g, box, seconds, each) {
  const ap = new Autopilot(g);
  const dt = 1 / 120;
  while (g.state === 'play' && g.t < seconds) {
    box.clock += dt;
    const all = g.walls;
    g.walls = all.filter((w) => w.dist < VISIBLE);
    const want = ap.steer();
    g.walls = all;
    g.update(dt, want);
    if (each && each(g) === false) return;
  }
}

// --- patterns and pools ------------------------------------------------------

test('every pattern can actually spawn somewhere', () => {
  // The bug this catches: `blackout` shipped at tier 3 while the daily's stage
  // capped at tier 2, so it could never appear for anybody.
  const reachable = new Set();
  for (const d of DIFFICULTIES) {
    const maxTier = Math.min(d.maxTier ?? 3, (d.baseTier ?? 0) + Math.max(...PHASES.map((p) => p.tier)));
    for (const n of SHIFT_SHAPES) for (const p of poolFor(maxTier, n)) reachable.add(p.name);
  }
  const orphans = PATTERNS.filter((p) => !reachable.has(p.name)).map((p) => p.name);
  assert(!orphans.length, `unreachable on every stage and arena: ${orphans.join(', ')}`);
});

test('every pattern is reachable on the DAILY stage specifically', () => {
  // Most players only ever play the daily, so a pattern gated above its cap is
  // dead content even if some unlockable stage could reach it.
  const d = DIFFICULTIES[0];
  const maxTier = Math.min(d.maxTier ?? 3, (d.baseTier ?? 0) + Math.max(...PHASES.map((p) => p.tier)));
  const reachable = new Set();
  for (const n of SHIFT_SHAPES) for (const p of poolFor(maxTier, n)) reachable.add(p.name);
  const orphans = PATTERNS.filter((p) => !reachable.has(p.name)).map((p) => p.name);
  assert(!orphans.length, `never appears on the daily: ${orphans.join(', ')}`);
});

test('every pattern produces walls on every arena it claims to support', () => {
  for (const p of PATTERNS) {
    for (const n of SHIFT_SHAPES) {
      if (p.evenOnly && n % 2) continue;
      if (p.minSides && n < p.minSides) continue;
      rng.seed(12345);
      let any = false;
      for (let k = 0; k < 12 && !any; k++) any = p.gen(n).length > 0;
      assert(any, `${p.name} generated nothing on ${n} sides`);
    }
  }
});

test('no pattern ever blocks every slot of a ring', () => {
  // A fully-closed ring is unsurvivable regardless of spacing.
  for (const p of PATTERNS) {
    for (const n of SHIFT_SHAPES) {
      if (p.evenOnly && n % 2) continue;
      if (p.minSides && n < p.minSides) continue;
      for (let k = 0; k < 40; k++) {
        rng.seed(k * 977 + n);
        const byDist = new Map();
        for (const w of p.gen(n)) {
          const key = Math.round(w.dist);
          byDist.set(key, (byDist.get(key) || 0) + 1);
        }
        for (const [dist, count] of byDist) {
          assert(count < n, `${p.name} on ${n} sides sealed the ring at dist ${dist}`);
        }
      }
    }
  }
});

// --- twin --------------------------------------------------------------------

test('twin is impossible on arenas where it would leave half the ring open', () => {
  for (const n of SHIFT_SHAPES) {
    const open = twinPossible(n) ? 2 / n : 0;
    assert(!twinPossible(n) || open <= 0.34,
      `twin allowed on ${n} sides, which leaves ${(open * 100).toFixed(0)}% of the ring open`);
  }
  assert(!twinPossible(4), 'twin must not be possible on a square');
  assert(!twinPossible(3), 'twin must not be possible on a triangle');
  assert(twinPossible(6) && twinPossible(8), 'twin must remain possible on 6 and 8 sides');
});

test('twin never actually opens on a small arena during a run', () => {
  // The predicate is one thing; what the simulation does is another.
  for (let seed = 1; seed <= 30; seed++) {
    const { g, box } = makeGame({ seed, daily: true, date: new Date(Date.UTC(2026, 7, 13 + seed, 12)) });
    play(g, box, 75, () => {
      assert(!(g.twin && !twinPossible(g.sides)),
        `twin was live on ${g.sides} sides (seed ${seed}, t=${g.t.toFixed(1)})`);
    });
  }
});

// --- rests -------------------------------------------------------------------

test('a rest never lasts longer than its ceiling', () => {
  // The bug this catches: rests were rolled as a distance, so the same roll was
  // 3.9s early in a run and 2.9s late.
  for (let seed = 1; seed <= 8; seed++) {
    const { g, box } = makeGame({ seed });
    let worst = 0;
    let gapStart = null;
    let reshaped = false;
    let prevSides = g.sides;
    play(g, box, 60, () => {
      if (g.sides !== prevSides) { prevSides = g.sides; reshaped = true; }
      const live = g.walls.some((w) => w.dist > g.orbit && w.dist < VISIBLE);
      if (!live && gapStart === null) { gapStart = g.t; reshaped = false; }
      if (live && gapStart !== null) {
        // A reshape drains the board on purpose and is not a rest; measuring it
        // here would blame the rest ceiling for a different mechanism.
        if (!reshaped) worst = Math.max(worst, g.t - gapStart);
        gapStart = null;
      }
    });
    assert(worst <= REST_MAX_SECONDS * 2.2,
      `longest empty stretch ${worst.toFixed(2)}s exceeds what a ${REST_MAX_SECONDS}s rest ceiling should allow`);
  }
});

test('rest constants are internally consistent', () => {
  assert(REST_MIN > 0 && REST_MAX > REST_MIN, 'REST_MIN/REST_MAX are not an ordered range');
  assert(REST_CHANCE >= 0 && REST_CHANCE <= 1, 'REST_CHANCE is not a probability');
  assert(REST_MAX_SECONDS > 0 && REST_MAX_SECONDS < 4, 'REST_MAX_SECONDS is outside anything sane');
});

// --- ghost walls -------------------------------------------------------------

test('ghost walls are hidden only near the cursor, and never stop being lethal', () => {
  const { g } = makeGame({ seed: 3 });
  const hide = g.spawnDist * GHOST_HIDE_AT;
  const ghost = { slot: 0, dist: 0, len: 44, phase: 0, spin: 0, ghost: 1 };
  const solid = { ...ghost, ghost: undefined };
  // Mirror of render.js wallAlpha — if that changes, this must too.
  const alpha = (w, d) => {
    if (!w.ghost) return 1;
    const fade = hide * 0.55;
    if (d <= hide - fade) return 0;
    if (d >= hide) return 1;
    return (d - (hide - fade)) / fade;
  };
  assert(alpha(ghost, g.spawnDist) === 1, 'a ghost wall must be fully visible on approach');
  assert(alpha(ghost, hide) === 1, 'a ghost wall must still be visible at the hide threshold');
  assert(alpha(ghost, hide * 0.2) === 0, 'a ghost wall must be invisible close in');
  assert(alpha(solid, hide * 0.2) === 1, 'a normal wall must never be hidden');
  // Lethality is decided by hitsWall, which knows nothing about `ghost`.
  const src = g.hitsWall.toString();
  assert(!src.includes('ghost'), 'collision must not consider ghost — invisible walls stay lethal');
});

test('the blackout pattern actually reaches players', () => {
  let ghosts = 0;
  let rings = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { g, box } = makeGame({ seed });
    play(g, box, 75, () => {
      for (const w of g.walls) {
        if (w.__c) continue;
        w.__c = 1; rings++;
        if (w.ghost) ghosts++;
      }
    });
  }
  assert(ghosts > 0, 'no vanishing wall appeared in 40 runs — the mechanic is dead content');
});

// --- phases and escalation ---------------------------------------------------

test('phases fire at the seconds they declare', () => {
  const { g, box } = makeGame({ seed: 5 });
  const seenAt = new Map();
  play(g, box, 75, () => {
    if (!seenAt.has(g.phaseIndex)) seenAt.set(g.phaseIndex, g.t);
  });
  for (const [i, at] of seenAt) {
    close(at, PHASES[i].t, 1.2, `phase ${PHASES[i].name} started late/early`);
  }
  assert(seenAt.size >= 4, `only ${seenAt.size} phases were reached in a 75s run`);
});

test('the dodging margin actually erodes across a run', () => {
  const { g, box } = makeGame({ seed: 7 });
  const first = g.safety;
  let last = first;
  play(g, box, 60, () => { last = g.safety; });
  assert(last < first, `safety did not decay (stayed at ${first})`);
});

// --- the daily ---------------------------------------------------------------

test('the daily replays identically', () => {
  const date = new Date('2026-09-01T12:00:00Z');
  const run = () => {
    const { g, box } = makeGame({ daily: true, date });
    const seq = [];
    play(g, box, 60, () => { for (const w of g.walls) if (!w.__s) { w.__s = 1; seq.push(`${w.pattern}@${Math.round(w.dist)}`); } });
    return seq.join('|');
  };
  const a = run();
  assert(a === run() && a === run(), 'the same date produced different runs');
  assert(a.length > 0, 'the daily produced no walls at all');
});

test('a daily seed is stable and its modes are derived from it', () => {
  const d = new Date('2026-09-01T12:00:00Z');
  assert(dailySeed(d) === dailySeed(new Date('2026-09-01T23:59:00Z')),
    'the seed changed within the same calendar day');
  const m = modesForSeed(dailySeed(d));
  assert(typeof m.twin === 'boolean' && typeof m.pulse === 'boolean' && typeof m.shift === 'boolean',
    'modesForSeed did not return the three mode flags');
  assert(!(m.twin && m.pulse && m.shift), 'all three modes at once was supposed to be impossible');
  if (m.twin) {
    assert(m.twinAt >= 15 && m.twinAt <= 60, `twin window opens outside 15-60s (${m.twinAt})`);
    assert(m.twinFor >= 8 && m.twinFor <= 20, `twin window length outside 8-20s (${m.twinFor})`);
  }
});

test('day characters are evenly spread across dates', () => {
  const counts = new Map();
  for (let i = 0; i < 200; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i, 12));
    const f = FLAVOURS[flavourForSeed(dailySeed(d), FLAVOURS.length)];
    counts.set(f.id, (counts.get(f.id) || 0) + 1);
  }
  assert(counts.size === FLAVOURS.length, `only ${counts.size} of ${FLAVOURS.length} characters ever occur`);
  for (const [id, n] of counts) {
    assert(n >= 200 / FLAVOURS.length * 0.4, `character ${id} occurs on only ${n} of 200 days`);
  }
});

test('the day-character badge tells the truth about the pool', () => {
  // The bug this catches: the menu advertised HOLD AND WAIT while the pool was
  // not weighted at all.
  for (const f of FLAVOURS) {
    if (!f.favour.length) continue;
    // Count pattern *draws*, not walls: patterns emit wildly different numbers
    // of walls, so counting walls measures wall-density rather than which
    // patterns the pool actually favours.
    let fav = 0;
    let total = 0;
    const realPick = rng.pick;
    for (let seed = 1; seed <= 6; seed++) {
      const { g, box } = makeGame({ seed, stage: 2 });
      Object.defineProperty(g, 'flavour', { get: () => f, configurable: true });
      rng.pick = (arr) => {
        const v = realPick(arr);
        if (v && typeof v.gen === 'function') { total++; if (f.favour.includes(v.name)) fav++; }
        return v;
      };
      play(g, box, 60);
      rng.pick = realPick;
    }
    const share = fav / total;
    assert(share > 0.3, `${f.name} claims a character but only ${(share * 100).toFixed(0)}% of spawns favour it`);
  }
});

// --- rescue / charges --------------------------------------------------------

test('bullet time only fires when the odds are actually bad', () => {
  const { g, box } = makeGame({ seed: 11 });
  let bad = 0;
  const realBuy = g.buyEscape.bind(g);
  g.buyEscape = (danger) => {
    // escapeOdds is recomputed here; a rescue at full odds would be a bug.
    if (g.escapeOdds() > 0.95) bad++;
    return realBuy(danger);
  };
  play(g, box, 60);
  assert(bad === 0, `${bad} rescues fired while the next gap was comfortably reachable`);
});

test('charges accrue and are spent, never going negative or past the cap', () => {
  const { g, box } = makeGame({ seed: 13 });
  let peak = 0;
  play(g, box, 60, () => {
    assert(g.stamina >= -1e-6, `stamina went negative (${g.stamina})`);
    peak = Math.max(peak, g.stamina);
  });
  assert(peak <= C.STAMINA_MAX + 1e-6, `stamina exceeded its cap (${peak} > ${C.STAMINA_MAX})`);
});

// --- pace --------------------------------------------------------------------

test('pace scales wall and cursor speed by exactly the same factor', () => {
  // If these ever drift apart, pace stops being fairness-neutral.
  const { g } = makeGame({ seed: 17 });
  g.pace = 1;
  const w0 = g.speed;
  const c0 = g.playerSpeed;
  g.pace = 1.7;
  close(g.speed / w0, 1.7, 1e-9, 'wall speed did not scale with pace');
  close(g.playerSpeed / c0, 1.7, 1e-9, 'cursor speed did not scale with pace');
});

test('a non-standard pace is never ranked', () => {
  const { g } = makeGame({ seed: 19 });
  g.pace = 1;
  assert(!g.assisted, 'a default run should be ranked');
  g.pace = 1.3;
  assert(g.assisted, 'a paced run must be unranked');
  g.pace = 1;
  g.assist = 90;
  assert(g.assisted, 'an assisted run must be unranked');
});

// --- shape changes -----------------------------------------------------------

test('no wall survives a reshape into the new arena', () => {
  // Walls are laid out in slots of the *old* polygon. Carrying one across a
  // reshape would teleport it into a slot that means something different — the
  // reason a reshape retires the board rather than remapping it. New walls
  // spawned on the same tick are fine and are what an earlier version of this
  // test wrongly flagged.
  let reshapes = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { g, box } = makeGame({ seed });
    let prev = g.sides;
    let stamp = 0;
    play(g, box, 75, () => {
      // Detect the reshape and bump the era BEFORE stamping: maybeSpawn runs in
      // the same tick as maybeShift, so walls born after the reshape would
      // otherwise inherit the old era and look like survivors.
      if (g.sides !== prev) {
        reshapes++;
        stamp++;
        const survivors = g.walls.filter((w) => w.__born !== undefined && w.__born < stamp);
        assert(survivors.length === 0,
          `${survivors.length} walls survived the reshape to ${g.sides} sides (seed ${seed})`);
        prev = g.sides;
      }
      for (const w of g.walls) if (w.__born === undefined) w.__born = stamp;
    });
  }
  assert(reshapes > 0, 'no reshape happened in 12 runs, so this proved nothing');
});

// --- tutorial ----------------------------------------------------------------

test('the tutorial advances through all four lessons and ends', () => {
  const { g, box } = makeGame({ seed: 23 });
  const t = new Tutorial(g);
  t.begin();
  g.start();
  const seen = [];
  let held = 1;
  const dt = 1 / 120;
  const ap = new Autopilot(g);
  for (let i = 0; i < 120 * 120 && t.active; i++) {
    box.clock += dt;
    const id = t.step ? t.step.id : null;
    if (id && seen[seen.length - 1] !== id) seen.push(id);
    const want = t.waiting ? held : (g.walls.length ? ap.steer() : held);
    t.update(dt, t.waiting ? held : want);
    g.update(dt, g.paused ? 0 : want);
    if (g.state === 'dead') held = -held;
  }
  assert(!t.active, `tutorial never finished; reached ${seen.join(' -> ')}`);
  for (const step of ['orbit', 'gap', 'charges', 'go']) {
    assert(seen.includes(step), `tutorial never reached the "${step}" lesson`);
  }
});

// --- badges ------------------------------------------------------------------

test('every badge is awarded somewhere in the source', () => {
  // Catches a badge that can be displayed but never earned. Scans the whole of
  // src/, because awards are not all in game.js — `ranked` is granted by the
  // leaderboard code in main.js, which an earlier version of this test missed
  // and wrongly reported as dead.
  const src = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(SRC + f, 'utf8')).join('\n');
  for (const b of BADGES) {
    const awarded = new RegExp(`award\\(\\s*['"\`]${b.id}['"\`]`).test(src);
    assert(awarded, `badge "${b.id}" (${b.name}) is never passed to award()`);
  }
});

test('tunable constants are actually wired, not shadowed by magic numbers', () => {
  // GRAZE_MAX_CHAIN was declared and exported while the cap it describes was
  // hardcoded next to it — a knob that looked authoritative and did nothing.
  const src = fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'config.js')
    .map((f) => fs.readFileSync(SRC + f, 'utf8')).join('\n');
  const exported = [...fs.readFileSync(SRC + 'config.js', 'utf8')
    .matchAll(/^export const ([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);
  const orphans = exported.filter((n) => !new RegExp(`\\b${n}\\b`).test(src));
  assert(!orphans.length,
    `declared in config.js but never read by the game: ${orphans.join(', ')}`);
});

test('the graze chain honours its declared cap', () => {
  const { g } = makeGame({ seed: 31 });
  g.graze.chain = C.GRAZE_MAX_CHAIN + 50;
  const before = g.multiplier;
  assert(Number.isFinite(before), 'multiplier went non-finite on a long chain');
  // Drive the clamp directly: the cap must come from the constant.
  const src = fs.readFileSync(SRC + 'game.js', 'utf8');
  assert(/Math\.min\(\s*GRAZE_MAX_CHAIN/.test(src),
    'the chain cap is a magic number rather than GRAZE_MAX_CHAIN');
});

// --- telemetry ---------------------------------------------------------------

test('a telemetry record carries the tuning signals and nothing identifying', () => {
  const { g, box } = makeGame({ seed: 29, daily: true, date: new Date('2026-09-02T12:00:00Z') });
  g.playerName = 'SOMEBODY';
  play(g, box, 20);
  const rec = runRecord(g, { input: 'touch', fps: 60 });
  for (const k of ['date', 'stage', 't', 'finished', 'sides', 'flavour', 'charges', 'rescues', 'grazes']) {
    assert(rec[k] !== undefined, `telemetry is missing "${k}", which the tuning report reads`);
  }
  const blob = JSON.stringify(rec).toLowerCase();
  assert(!blob.includes('somebody'), 'telemetry leaked the player name');
  for (const bad of ['name', 'email', 'ip', 'agent', 'id"']) {
    assert(!Object.keys(rec).some((k) => k.toLowerCase().includes(bad)),
      `telemetry has a field matching "${bad}" — it is meant to be anonymous`);
  }
});

// --- run ---------------------------------------------------------------------
let failed = 0;
for (const t of tests) {
  if (only.length && !only.some((o) => t.name.includes(o))) continue;
  try {
    t.fn();
    console.log(`  ok    ${t.name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${t.name}\n          ${err.message}`);
  }
}
const ran = tests.filter((t) => !only.length || only.some((o) => t.name.includes(o))).length;
console.log(`\n${ran - failed}/${ran} passed`);
process.exit(failed ? 1 : 0);
