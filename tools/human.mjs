const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const SEEDS = [3,19,77,500,8123,4242,909,1234,5150,6060,7,88101,222,3141,2718,1618,4004,55,606,71];
function stumbler(ap, every, forSteps, off) { let k = off; return () => { k++; return (k % every) < forSteps ? (-ap.steer() || 1) : ap.steer(); }; }
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

for (const every of [600, 360, 240]) {
  const times = [];
  let reached = 0;
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    for (const seed of SEEDS) {
      const g = new Game({});
      g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
      g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
      rng.scramble = () => rng.seed(seed);
      const ap = new Autopilot(g);
      g.start();
      const drive = stumbler(ap, every, 22, seed % 97);
      while (g.state === 'play' && g.t < 60) g.update(1 / 120, drive());
      times.push(g.t); if (g.t >= 60) reached++;
    }
  }
  console.log(`  stumble/${every}: median ${med(times).toFixed(1)}s  mean ${(times.reduce((a,b)=>a+b,0)/times.length).toFixed(1)}s  reached60 ${reached}/${times.length}`);
}
