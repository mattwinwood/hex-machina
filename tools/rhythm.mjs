// Duty cycle: how often is the visible field actually empty, and how dense is
// it when it is not? Mirrors the pixel measurement taken from the video.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };

const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const VIS = WORLD_HEIGHT / 2;          // world units visible from the centre
const samples = [];
for (let d = 0; d < DIFFICULTIES.length; d++) {
  for (const seed of [3, 19, 77, 500, 8123]) {
    const g = new Game({});
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
    rng.scramble = () => rng.seed(seed);
    const ap = new Autopilot(g);
    g.start();
    let acc = 0;
    while (g.state === 'play' && g.t < 60) {
      g.update(1 / 120, ap.steer());
      acc += 1 / 120;
      if (acc >= 0.1) { acc = 0; samples.push(g.walls.filter((w) => w.dist < VIS).length); }
    }
  }
}
const n = samples.length;
const empty = samples.filter((x) => x === 0).length;
const dense = samples.filter((x) => x >= 6).length;
const runs = []; let cur = 0;
for (const x of samples) { if (x === 0) cur++; else if (cur) { runs.push(cur); cur = 0; } }
if (cur) runs.push(cur);
runs.sort((a, b) => a - b);
const sorted = [...samples].sort((a, b) => a - b);
console.log(`${dir}`);
console.log(`  walls on screen: median ${sorted[n >> 1]}  mean ${(samples.reduce((a, b) => a + b, 0) / n).toFixed(2)}`);
console.log(`  field empty: ${(empty / n * 100).toFixed(0)}% of the time`);
console.log(`  field dense (6+ walls): ${(dense / n * 100).toFixed(0)}% of the time`);
console.log(`  quiet spells: ${runs.length}, longest ${(runs[runs.length - 1] / 10).toFixed(1)}s, median ${(runs[runs.length >> 1] / 10).toFixed(1)}s`);
