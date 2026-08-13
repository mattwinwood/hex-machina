// How much does the day's *song* change the day's difficulty?
//
// Walls are quantised onto a beat grid folded into [BEAT_MIN, BEAT_MAX] =
// 0.42–0.95s. Since the daily's track is picked by the date, a slow song and a
// fast song are not just different music — they are different wall arrival
// rates. The other harnesses pin the grid at 0.6s and so are blind to this.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const VISIBLE = WORLD_HEIGHT / 2;
const EXPOSURE = +(process.env.EXPOSURE || 2400);

function hazard(grid, every) {
  let deaths = 0, elapsed = 0, seed = 1;
  while (elapsed < EXPOSURE) {
    let clock = 0;
    const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / grid - 1e-9) * grid - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = 0; g.daily = false; g.setView(1280, 720, 760);
    rng.scramble = () => rng.seed(seed * 7919);
    seed++;
    const ap = new Autopilot(g);
    g.start();
    let k = seed % 97;
    while (g.state === 'play' && g.t < 60) {
      clock += 1 / 120;
      const all = g.walls;
      g.walls = all.filter((w) => w.dist < VISIBLE);
      let want = ap.steer();
      g.walls = all;
      k++;
      if ((k % every) < 22) want = -want || 1;
      g.update(1 / 120, want);
    }
    elapsed += g.t;
    if (g.state !== 'play') deaths++;
  }
  return { rate: deaths / (elapsed / 60), deaths };
}

console.log(`deaths per minute vs beat grid period — ${EXPOSURE}s exposure per cell\n`);
console.log('grid (s)   deaths/min');
const out = [];
for (const grid of [0.42, 0.5, 0.6, 0.7, 0.8, 0.95]) {
  const r = hazard(grid, 300);
  const err = r.rate / Math.sqrt(Math.max(1, r.deaths));
  out.push({ grid, rate: r.rate });
  console.log(`${grid.toFixed(2).padStart(7)}   ${r.rate.toFixed(2)} ± ${err.toFixed(2)}`);
}
const lo = Math.min(...out.map((o) => o.rate));
const hi = Math.max(...out.map((o) => o.rate));
console.log(`\nrange across the legal grid: ${lo.toFixed(2)} – ${hi.toFixed(2)} deaths/min  (${(hi / lo).toFixed(1)}x)`);
