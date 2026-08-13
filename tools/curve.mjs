// Per-stage difficulty curve, measured the way a player experiences it: a bot
// that plays well but commits the wrong way for ~180ms now and then, only able
// to see what is on screen, with the beat grid active.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const SEEDS = [3,19,77,500,8123,4242,909,1234,5150,6060,7,88101,222,3141,2718,1618,4004,55,606,71];
const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

console.log('stage        clean-bot 75s   sloppy median   very-sloppy median   reached 60s');
for (let d = 0; d < DIFFICULTIES.length; d++) {
  const res = {};
  for (const [label, every] of [['clean', 0], ['sloppy', 600], ['messy', 300]]) {
    const times = []; let reached = 0, clean = 0;
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
        if (every && (k % every) < 22) want = -want || 1;
        g.update(1 / 120, want);
      }
      times.push(g.t);
      if (g.t >= 60) reached++;
      if (g.t >= 75) clean++;
    }
    res[label] = { med: med(times), reached, clean };
  }
  const D = DIFFICULTIES[d];
  console.log(`${D.id.padEnd(10)} ${String(res.clean.clean + '/' + SEEDS.length).padStart(9)}   ` +
    `${res.sloppy.med.toFixed(1).padStart(9)}s   ${res.messy.med.toFixed(1).padStart(14)}s   ` +
    `${String(res.sloppy.reached + '/' + SEEDS.length).padStart(9)}`);
}
