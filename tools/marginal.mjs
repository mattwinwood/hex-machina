// The closest thing to a build diff that is still possible.
//
// Today's rework added three patterns and rewrote three others. The rewrites
// cannot be undone without the old source, but the additions can simply be
// withheld from the pool — which measures their marginal contribution. If the
// pool without them is *harder*, the additions diluted the game.
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
const EXPOSURE = +(process.env.EXPOSURE || 4000);
const ADDED = new Set(['hold', 'stutter-step', 'cross']);

// Withhold the new patterns by filtering them out of every pool draw.
let filtering = false;
const realPick = rng.pick.bind(rng);
rng.pick = (arr) => {
  if (filtering && Array.isArray(arr) && arr.length && arr[0] && typeof arr[0].gen === 'function') {
    const keep = arr.filter((p) => !ADDED.has(p.name));
    if (keep.length) return realPick(keep);
  }
  return realPick(arr);
};

function hazard(every) {
  let deaths = 0, elapsed = 0, seed = 1;
  while (elapsed < EXPOSURE) {
    let clock = 0;
    const g = new Game({ quantize: (a) => Math.ceil((clock + a) / GRID - 1e-9) * GRID - clock });
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

filtering = false; const withNew = hazard(300);
filtering = true;  const without = hazard(300);
const e = (r) => r.rate / Math.sqrt(Math.max(1, r.deaths));
console.log(`marginal effect of the three added patterns — ${EXPOSURE}s exposure each\n`);
console.log(`pool WITH    hold/stutter-step/cross: ${withNew.rate.toFixed(2)} ± ${e(withNew).toFixed(2)} deaths/min`);
console.log(`pool WITHOUT them (approx. old pool): ${without.rate.toFixed(2)} ± ${e(without).toFixed(2)} deaths/min`);
const d = withNew.rate - without.rate;
const se = Math.sqrt(e(withNew) ** 2 + e(without) ** 2);
console.log(`\nwith − without = ${d >= 0 ? '+' : ''}${d.toFixed(2)} ± ${se.toFixed(2)}  (${Math.abs(d / se).toFixed(1)}σ)`);
console.log(d > 0 ? 'the additions made it HARDER' : 'the additions made it EASIER');
