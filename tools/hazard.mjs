// Player-facing difficulty as a hazard rate: deaths per minute of exposure.
//
// Median survival is one observation per run and heavy-tailed. Restarting on
// death and counting deaths over a fixed budget of game time turns the same work
// into a rate with many events, which is far better behaved.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const EXPOSURE = 900; // seconds of game time per stage per sloppiness level

function hazard(d, every) {
  let deaths = 0, elapsed = 0, seed = 1;
  while (elapsed < EXPOSURE) {
    let clock = 0;
    const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
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
  return deaths / (elapsed / 60);
}

console.log(`deaths per minute of play (${EXPOSURE}s exposure per cell)\n`);
console.log('stage        occasional slip   frequent slips');
for (let d = 0; d < DIFFICULTIES.length; d++) {
  const a = hazard(d, 600);
  const b = hazard(d, 300);
  console.log(`${DIFFICULTIES[d].id.padEnd(11)} ${a.toFixed(2).padStart(15)}   ${b.toFixed(2).padStart(14)}`);
}
