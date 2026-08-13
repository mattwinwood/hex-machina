// How many *distinct problems* does a run actually pose?
//
// Difficulty had been treated as a scalar — faster walls, tighter gaps — and
// tuning it that way kept failing. The complaint underneath was never "too
// slow", it was "too samey": one kind of demand, repeated, with rests between.
//
// This profiles a 60-second run the way a player experiences its *shape*: how
// many times the arena changes, how much of the run any mode is live, how many
// distinct patterns appear, and — the number that matters most — how often two
// mechanics are ever asked for at the same time. A run made of fifteen isolated
// single-demand moments is not the same thing as a run made of eight compound
// ones, even if the death rates match.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { PATTERNS } = await import(`${dir}/patterns.js`);
const TUNE = process.env.TUNE || 'classic';
const { rng, dailySeed, modesForSeed } = await import(`${dir}/rng.js`);

const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const DAYS = +(process.env.DAYS || 40);

const totals = { shapes: 0, changes: 0, patterns: 0, twinSec: 0, pulse: 0, shift: 0, twin: 0, overlap: 0, modeSec: 0, runs: 0 };
const changeHist = new Map();

for (let d = 0; d < DAYS; d++) {
  const date = new Date(Date.UTC(2026, 7, 13 + d, 12));
  let clock = 0;
  const g = new Game({ quantize: (a) => Math.ceil((clock + a) / GRID - 1e-9) * GRID - clock });
  g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
  g.daily = true;
  Object.defineProperty(g, 'runDate', { value: date, configurable: true });
  g.setView(390, 844, 620);
  g.tune = TUNE;
  const m = modesForSeed(dailySeed(date));
  rng.scramble = () => rng.seed(dailySeed(date));
  const ap = new Autopilot(g);
  g.start();

  const shapes = new Set([g.sides]);
  const pats = new Set();
  let changes = 0, prev = g.sides, twinSec = 0, modeSec = 0, overlap = 0;
  // A perfect bot so the profile is of the *design*, not of one player's luck.
  while (g.state === 'play' && g.t < 60) {
    clock += 1 / 120;
    const all = g.walls;
    g.walls = all.filter((w) => w.dist < VISIBLE);
    const want = ap.steer();
    g.walls = all;
    g.update(1 / 120, want);
    if (g.sides !== prev) { changes++; prev = g.sides; shapes.add(g.sides); }
    for (const w of g.walls) if (w.pattern) pats.add(w.pattern);
    const live = [g.twin, m.pulse, g.morph < 1].filter(Boolean).length;
    if (g.twin) twinSec += 1 / 120;
    if (live >= 1) modeSec += 1 / 120;
    if (live >= 2) overlap += 1 / 120;
  }
  totals.runs++;
  totals.shapes += shapes.size;
  totals.changes += changes;
  totals.patterns += pats.size;
  totals.twinSec += twinSec;
  totals.modeSec += modeSec;
  totals.overlap += overlap;
  totals.twin += m.twin ? 1 : 0;
  totals.pulse += m.pulse ? 1 : 0;
  totals.shift += m.shift ? 1 : 0;
  changeHist.set(changes, (changeHist.get(changes) || 0) + 1);
}

const n = totals.runs;
const avg = (k) => (totals[k] / n).toFixed(1);
console.log(`what a 60-second run poses — ${n} consecutive daily seeds, perfect bot\n`);
console.log(`distinct arena shapes seen   ${avg('shapes')}  (of 5 possible)`);
console.log(`shape changes per run        ${avg('changes')}`);
console.log(`distinct patterns per run    ${avg('patterns')}  (of ${PATTERNS.length})`);
console.log(`seconds with twin live       ${avg('twinSec')}s of 60`);
console.log(`seconds with ANY mode live   ${avg('modeSec')}s of 60`);
console.log(`seconds with TWO+ at once    ${avg('overlap')}s of 60   <- compound challenge`);
console.log();
console.log('shape changes per run, distribution:');
for (const [k, v] of [...changeHist.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${k} change${k === 1 ? ' ' : 's'}  ${'#'.repeat(v)} ${((v / n) * 100).toFixed(0)}%`);
}
console.log();
console.log(`seeds with twin  ${((totals.twin / n) * 100).toFixed(0)}%`);
console.log(`seeds with pulse ${((totals.pulse / n) * 100).toFixed(0)}%`);
console.log(`seeds with shift ${((totals.shift / n) * 100).toFixed(0)}%`);
