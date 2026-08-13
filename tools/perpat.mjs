// Which patterns actually kill?
//
// The pattern library was reworked today: `hold`, `stutter-step` and `cross`
// were added, and `zigzag`, `whiplash-spiral` and `longspiral` were rewritten.
// The old build is gone (no git, no backup), so a direct before/after diff is
// impossible — but the question underneath "did it get easier" can still be
// answered: are the six touched patterns systematically softer than the twelve
// that were left alone? If they are, the rework diluted the pool.
//
// Kill share is attributed to the nearest incoming ring at the moment of death,
// and compared against that pattern's share of spawns. A pattern that is 10% of
// spawns and 10% of deaths is pulling its weight; one at 10% of spawns and 2%
// of deaths is a rest disguised as an obstacle.
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
const EXPOSURE = +(process.env.EXPOSURE || 6000);
const TOUCHED = new Set(['hold', 'stutter-step', 'cross', 'zigzag', 'whiplash-spiral', 'longspiral']);

// Walls carry no pattern tag in the game itself, so record which pattern was
// last drawn from the pool and stamp it onto the rings that appear next.
let lastPattern = '(none)';
const realPick = rng.pick.bind(rng);
rng.pick = (arr) => {
  const v = realPick(arr);
  if (v && typeof v.gen === 'function' && v.name) lastPattern = v.name;
  return v;
};

const spawns = new Map();
const kills = new Map();
let deaths = 0, elapsed = 0, seed = 1;

while (elapsed < EXPOSURE) {
  let clock = 0;
  const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock });
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
    if ((k % every()) < 22) want = -want || 1;
    for (const w of g.walls) {
      if (!w.__seen) { w.__seen = 1; w.__pat = lastPattern; spawns.set(w.__pat, (spawns.get(w.__pat) || 0) + 1); }
    }
    // Remember the closest ring still outside the player, before the step that
    // might kill them.
    let near = null;
    for (const w of g.walls) {
      if (w.dist >= g.orbit - 40 && (!near || w.dist < near.dist)) near = w;
    }
    g.update(1 / 120, want);
    if (g.state !== 'play') {
      const id = near ? (near.__pat || '(none)') : '(none)';
      kills.set(id, (kills.get(id) || 0) + 1);
      deaths++;
      break;
    }
  }
  elapsed += g.t;
}
function every() { return 300; }

const total = [...spawns.values()].reduce((a, b) => a + b, 0);
console.log(`pattern pull — ${EXPOSURE}s exposure, ${deaths} deaths, ${total} rings\n`);
console.log('pattern            spawn%   kill%    pull   touched');
const rows = [...spawns.keys()].map((id) => {
  const sp = (spawns.get(id) / total) * 100;
  const kl = ((kills.get(id) || 0) / Math.max(1, deaths)) * 100;
  return { id, sp, kl, pull: kl / sp, touched: TOUCHED.has(id) };
}).sort((a, b) => a.pull - b.pull);
for (const r of rows) {
  console.log(
    `${r.id.padEnd(18)} ${r.sp.toFixed(1).padStart(5)}   ${r.kl.toFixed(1).padStart(5)}   ` +
    `${r.pull.toFixed(2).padStart(5)}   ${r.touched ? 'yes' : ''}`,
  );
}
const avg = (f) => {
  const g2 = rows.filter(f);
  const sp = g2.reduce((s, r) => s + r.sp, 0);
  const kl = g2.reduce((s, r) => s + r.kl, 0);
  return { sp, kl, pull: kl / sp, n: g2.length };
};
const t = avg((r) => r.touched);
const u = avg((r) => !r.touched);
console.log(`\ntouched  (${t.n}): ${t.sp.toFixed(1)}% of rings, ${t.kl.toFixed(1)}% of deaths → pull ${t.pull.toFixed(2)}`);
console.log(`untouched(${u.n}): ${u.sp.toFixed(1)}% of rings, ${u.kl.toFixed(1)}% of deaths → pull ${u.pull.toFixed(2)}`);
