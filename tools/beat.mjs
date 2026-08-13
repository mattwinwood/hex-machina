// Does quantisation actually put ring arrivals on the grid? No audio involved —
// a synthetic metronome, so this isolates the scheduling maths from detection.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { Autopilot } = await import('../src/autopilot.js');
const { DIFFICULTIES } = await import('../src/config.js');
const { rng } = await import('../src/rng.js');

const GRID = Number(process.env.GRID || 0.15);
const errs = [], gaps = [];
for (let d = 0; d < 3; d++) {
  for (const seed of [3, 19, 77, 500]) {
    let clock = 0;
    const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
    rng.scramble = () => rng.seed(seed);
    const ap = new Autopilot(g);
    g.start();
    const seen = new Set();
    let lastArrival = null;
    while (g.state === 'play' && g.t < 55) {
      clock += 1 / 120;
      g.update(1 / 120, ap.steer());
      for (const w of g.walls) {
        if (w.dist <= g.orbit && !seen.has(w)) {
          seen.add(w);
          const off = ((clock % GRID) + GRID) % GRID;
          errs.push(Math.min(off, GRID - off) * 1000);
          if (lastArrival !== null && clock - lastArrival > 0.02) gaps.push(clock - lastArrival);
          lastArrival = clock;
        }
      }
    }
  }
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const within = (ms) => Math.round(errs.filter((e) => e <= ms).length / errs.length * 100);
console.log(`grid ${(GRID * 1000).toFixed(0)}ms | ${errs.length} ring arrivals`);
console.log(`  median error off the grid: ${med(errs).toFixed(1)}ms   (random would be ${(GRID * 250).toFixed(0)}ms)`);
console.log(`  within 10ms: ${within(10)}%   within 25ms: ${within(25)}%`);
const gi = gaps.map((x) => x / GRID);
console.log(`  arrival gaps in grid units: median ${med(gi).toFixed(2)}  (whole numbers = on the beat)`);
