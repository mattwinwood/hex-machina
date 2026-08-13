// The autopilot normally sees every wall, including ones off screen. A player
// cannot. This bot only reacts to walls inside the visible radius, which is what
// makes camera zoom a difficulty knob rather than pure decoration.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const ZOOM = Number(process.env.ZOOM || 1);
const SEEDS = [3,19,77,500,8123,4242,909,1234,5150,6060,7,88101,222,3141,2718,1618,4004,55,606,71];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

for (const every of [600, 360, 240]) {
  const times = []; let reached = 0;
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    for (const seed of SEEDS) {
      const g = new Game({});
      g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
      g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
      rng.scramble = () => rng.seed(seed);
      const ap = new Autopilot(g);
      g.start();
      let k = seed % 97;
      const visible = WORLD_HEIGHT / (2 * ZOOM);
      const drive = () => {
        const all = g.walls;
        g.walls = all.filter((w) => w.dist < visible);   // only what is on screen
        const want = ap.steer();
        g.walls = all;
        k++;
        return (k % every) < 22 ? (-want || 1) : want;
      };
      while (g.state === 'play' && g.t < 60) g.update(1 / 120, drive());
      times.push(g.t); if (g.t >= 60) reached++;
    }
  }
  console.log(`  zoom ${ZOOM}  stumble/${every}: median ${med(times).toFixed(1)}s  reached60 ${reached}/${times.length}`);
}
