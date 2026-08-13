// Each redline stage is meant to be its parent, harder. Measured as pairs, with
// enough seeds that the answer is not noise: 40 seeds x 2 sloppiness levels.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const SEEDS = Array.from({ length: 40 }, (_, i) => 1 + i * 977);
const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)]; };

function measure(d, every) {
  const times = [];
  for (const seed of SEEDS) {
    let clock = 0;
    const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
    rng.scramble = () => rng.seed(seed);
    const ap = new Autopilot(g);
    g.start();
    let k = seed % 97;
    while (g.state === 'play' && g.t < 75) {
      clock += 1 / 120;
      const all = g.walls;
      g.walls = all.filter((w) => w.dist < VISIBLE);
      let want = ap.steer();
      g.walls = all;
      k++;
      if ((k % every) < 22) want = -want || 1;
      g.update(1 / 120, want);
    }
    times.push(g.t);
  }
  // Middle of the distribution: the tails here are seed luck, not difficulty.
  return (pct(times, 0.25) + pct(times, 0.5) + pct(times, 0.75)) / 3;
}

const byId = {};
DIFFICULTIES.forEach((d, i) => { byId[d.id] = i; });
console.log('pair                     parent   redline   harder?');
for (const [p, r] of [['spark', 'flare'], ['forge', 'furnace'], ['crucible', 'meltdown']]) {
  const a = (measure(byId[p], 600) + measure(byId[p], 300)) / 2;
  const b = (measure(byId[r], 600) + measure(byId[r], 300)) / 2;
  const ok = b < a * 0.85 ? 'yes' : (b < a ? 'barely' : 'NO — easier');
  console.log(`${(p + ' -> ' + r).padEnd(24)} ${a.toFixed(1).padStart(5)}s   ${b.toFixed(1).padStart(6)}s   ${ok}`);
}
