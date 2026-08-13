// Is `safety` still the thing that sets ring spacing, or has the beat grid taken
// over? Measure the fair spacing the spawner asks for, and what it becomes after
// quantisation.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { Autopilot } = await import('../src/autopilot.js');
const { DIFFICULTIES } = await import('../src/config.js');
const { rng } = await import('../src/rng.js');
const GRID = 0.6;

console.log('stage      safety@30s   fair gap (s)   after beat-snap (s)   snapped up?');
for (let d = 0; d < DIFFICULTIES.length; d++) {
  let clock = 0;
  const asked = [], got = [];
  const g = new Game({
    quantize: (ahead) => {
      const q = Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock;
      asked.push(ahead); got.push(q);
      return q;
    },
  });
  g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
  g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
  rng.scramble = () => rng.seed(4242);
  const ap = new Autopilot(g);
  g.start();
  let safetyAt30 = 0;
  while (g.state === 'play' && g.t < 45) {
    clock += 1 / 120;
    g.update(1 / 120, ap.steer());
    if (g.t > 30 && !safetyAt30) safetyAt30 = g.safety;
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const lifted = asked.filter((v, i) => got[i] > v + 1e-6).length / Math.max(1, asked.length);
  console.log(`${DIFFICULTIES[d].id.padEnd(10)} ${safetyAt30.toFixed(2).padStart(8)}   ${mean(asked).toFixed(3).padStart(11)}   ${mean(got).toFixed(3).padStart(18)}   ${(lifted * 100).toFixed(0)}%`);
}
