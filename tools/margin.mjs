// Difficulty as a continuous margin, computed independently of the game's own
// escapeOdds (which clamps at 1 and so cannot separate the easy stages). The
// geometry is deliberately re-derived here: if it disagreed with the game, that
// would itself be worth knowing.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT, mod, angDiff } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const SEEDS = Array.from({ length: 24 }, (_, i) => 11 + i * 613);
const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const pct = (a, p) => a[Math.floor((a.length - 1) * p)];

/** How many times over you can cover the travel the next ring demands. */
function ratio(g) {
  let nearest = Infinity;
  for (const w of g.walls) if (w.dist > g.orbit && w.dist < nearest) nearest = w.dist;
  if (!isFinite(nearest)) return null;
  const t = (nearest - g.orbit) / Math.max(1, g.speed);
  if (t < 0.07) return null;
  const n = g.sides;
  const blocked = new Set();
  let phase = 0, spin = 0;
  for (const w of g.walls) {
    if (Math.abs(w.dist - nearest) > 6) continue;
    blocked.add(mod(w.slot, n)); phase = w.phase; spin = w.spin || 0;
  }
  if (blocked.size >= n) return 0;
  let needed = Infinity;
  for (let s = 0; s < n; s++) {
    if (blocked.has(s)) continue;
    const centre = (s + 0.5) * g.step + phase + spin * t;
    needed = Math.min(needed, Math.abs(angDiff(centre, g.player.angle)));
  }
  const reach = Math.max(0, needed - g.geom.halfStep * 0.75);
  if (reach <= 0) return 4; // already inside the opening: maximum comfort
  return Math.min(4, (g.playerSpeed * t) / reach);
}

export function marginOf(d) {
  const rs = [];
  let arrivals = 0, seconds = 0;
  for (const seed of SEEDS) {
    let clock = 0;
    const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
    rng.scramble = () => rng.seed(seed);
    const ap = new Autopilot(g);
    g.start();
    while (g.state === 'play' && g.t < 60) {
      clock += 1 / 120;
      const all = g.walls;
      g.walls = all.filter((w) => w.dist < VISIBLE);
      const want = ap.steer();
      g.walls = all;
      g.update(1 / 120, want);
      const r = ratio(g);
      if (r !== null) rs.push(r);
      for (const w of g.walls) {
        if (!w._seen && w.dist < g.orbit) { w._seen = true; arrivals++; }
      }
      seconds += 1 / 120;
    }
  }
  rs.sort((a, b) => a - b);
  // Decisions per second: a stage that gives twice the slack but three times
  // the decisions is harder, and slack alone cannot see that.
  const rate = arrivals / Math.max(1e-6, seconds) / Math.max(1, 5);
  const p05 = pct(rs, 0.05);
  return { n: rs.length, p05, rate, index: rate / p05 };
}

if (!process.env.QUIET) {
  console.log('stage        p05 slack   rings/sec   difficulty index  (higher = harder)');
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    const m = marginOf(d);
    console.log(`${DIFFICULTIES[d].id.padEnd(11)} ${m.p05.toFixed(3).padStart(9)}   ${m.rate.toFixed(3).padStart(9)}   ${m.index.toFixed(3).padStart(16)}`);
  }
}
