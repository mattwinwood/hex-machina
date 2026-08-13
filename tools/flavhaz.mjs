// Does a day's *character* change its difficulty?
//
// Flavours were shipped as texture: a day leans on spirals, or on holds, or on
// walls. When they went in I verified pattern reachability and fairness, but not
// that the five flavours are equally hard — which is the property that actually
// matters, because a daily whose difficulty swings with its flavour is a daily
// that feels arbitrarily easy or brutal for reasons the player cannot see.
//
// Measured as a hazard rate: deaths per minute of exposure, under a bot that
// slips on a fixed schedule. Same instrument as hazard.mjs, sliced by flavour.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT, FLAVOURS } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const EXPOSURE = +(process.env.EXPOSURE || 1200);
const STAGE = +(process.env.STAGE || 0);

function hazard(flavourId, every) {
  let deaths = 0, elapsed = 0, seed = 1, spawns = 0;
  const seen = new Map();
  while (elapsed < EXPOSURE) {
    let clock = 0;
    const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = STAGE; g.daily = false; g.setView(1280, 720, 760);
    rng.scramble = () => rng.seed(seed * 7919);
    seed++;
    // Pin the flavour rather than letting the date pick it.
    Object.defineProperty(g, 'flavour', {
      value: FLAVOURS.find((f) => f.id === flavourId), configurable: true,
    });
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
      const before = g.walls.length;
      g.update(1 / 120, want);
      for (const w of g.walls) {
        if (!w.__seen) { w.__seen = 1; seen.set(w.pattern, (seen.get(w.pattern) || 0) + 1); spawns++; }
      }
      void before;
    }
    elapsed += g.t;
    if (g.state !== 'play') deaths++;
  }
  return { rate: deaths / (elapsed / 60), seen, spawns };
}

const label = DIFFICULTIES[STAGE].id;
console.log(`deaths per minute by day character — stage ${label}, ${EXPOSURE}s exposure per cell\n`);
console.log('flavour              occasional slip   frequent slips');
const rows = [];
for (const f of FLAVOURS) {
  const a = hazard(f.id, 600);
  const b = hazard(f.id, 300);
  rows.push({ id: f.id, name: f.name, a: a.rate, b: b.rate });
  console.log(`${f.name.padEnd(20)} ${a.rate.toFixed(2).padStart(13)}   ${b.rate.toFixed(2).padStart(14)}`);
}
const spread = (k) => {
  const v = rows.map((r) => r[k]);
  const lo = Math.min(...v), hi = Math.max(...v);
  return { lo, hi, pct: ((hi - lo) / lo) * 100 };
};
const sa = spread('a'), sb = spread('b');
console.log(`\nspread  occasional: ${sa.lo.toFixed(2)}–${sa.hi.toFixed(2)}  (+${sa.pct.toFixed(0)}%)`);
console.log(`spread    frequent: ${sb.lo.toFixed(2)}–${sb.hi.toFixed(2)}  (+${sb.pct.toFixed(0)}%)`);
const easiest = rows.reduce((m, r) => (r.b < m.b ? r : m));
const hardest = rows.reduce((m, r) => (r.b > m.b ? r : m));
console.log(`easiest: ${easiest.name}   hardest: ${hardest.name}`);
