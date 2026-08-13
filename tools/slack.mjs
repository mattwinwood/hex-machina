// Difficulty measured as *slack*, not survival.
//
// Survival time is one heavy-tailed event per run — at 10-15s it resolves to
// about +/-1s, which is the same size as the effects worth tuning. But the game
// already computes escapeOdds() every step: how much of the travel you need to
// reach the next opening you can actually cover. Sampling that gives thousands
// of observations per run instead of one, and it measures the stage rather than
// the bot's luck.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

const SEEDS = Array.from({ length: 24 }, (_, i) => 11 + i * 613);
const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const pct = (a, p) => a[Math.floor((a.length - 1) * p)];

export function slackOf(d) {
  const odds = [];
  let tight = 0, n = 0;
  for (const seed of SEEDS) {
    let clock = 0;
    const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
    rng.scramble = () => rng.seed(seed);
    const ap = new Autopilot(g);
    g.start();
    // A clean bot: we are measuring the stage, not anybody's mistakes.
    while (g.state === 'play' && g.t < 60) {
      clock += 1 / 120;
      const all = g.walls;
      g.walls = all.filter((w) => w.dist < VISIBLE);
      const want = ap.steer();
      g.walls = all;
      g.update(1 / 120, want);
      const o = g.escapeOdds();
      if (o < 1) { odds.push(o); tight++; }
      n++;
    }
  }
  odds.sort((a, b) => a - b);
  return {
    samples: n,
    tightPct: tight / n * 100,          // share of time the next gap is not comfortably reachable
    p10: odds.length ? pct(odds, 0.10) : 1,
    median: odds.length ? pct(odds, 0.50) : 1,
  };
}

if (!process.env.QUIET) {
  console.log('stage       time under pressure   p10 odds   median odds');
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    const s = slackOf(d);
    console.log(`${DIFFICULTIES[d].id.padEnd(11)} ${s.tightPct.toFixed(2).padStart(17)}%   ${s.p10.toFixed(3).padStart(8)}   ${s.median.toFixed(3).padStart(11)}`);
  }
}
