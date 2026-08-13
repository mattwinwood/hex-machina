// Difficulty as a *skilled* player experiences it: reaction time, not blunders.
//
// Every other harness here makes a bot hard-to-play by injecting random
// wrong-way commits. That measures how punishing a mistake is. It does not
// measure how hard the game is to keep up with, and a good player does not make
// those mistakes — which is why the bot numbers kept improving while Matt kept
// saying the game was easy.
//
// This bot never blunders. It plays perfectly on information that is `LAG`
// seconds stale, which is what a human actually is: ~250ms from photons to
// thumb. The fairness canary guarantees a *zero-latency* greedy bot always
// survives, so the real question is how much of the safety margin is left over
// for human lag — and that is the number that decides whether the game feels
// hard to someone good at it.
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
const EXPOSURE = +(process.env.EXPOSURE || 3000);
const STEP = 1 / 120;

/** @param lag seconds of reaction delay. 0 = the canary's bot. */
function play(lag, opts = {}) {
  const frames = Math.max(0, Math.round(lag / STEP));
  let deaths = 0, elapsed = 0, seed = 1, runs = 0, finishes = 0, longest = 0;
  while (elapsed < EXPOSURE) {
    let clock = 0;
    const g = new Game({ quantize: (a) => Math.ceil((clock + a) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = 0; g.daily = false; g.setView(390, 844, 620);
    rng.scramble = () => rng.seed(seed * 7919);
    seed++; runs++;
    if (opts.noRescue) g.maybeRescue = function (dt) {
      if (this.slowing) { this.slowT -= dt; if (this.slowT <= 0) this.slowing = false; }
    };
    const ap = new Autopilot(g);
    g.start();
    // A pipeline of decisions in flight: what the player saw `lag` ago is only
    // reaching their thumb now.
    const pipe = [];
    while (g.state === 'play' && g.t < 90) {
      clock += STEP;
      const all = g.walls;
      g.walls = all.filter((w) => w.dist < VISIBLE);
      pipe.push(ap.steer());
      g.walls = all;
      const want = pipe.length > frames ? pipe.shift() : 0;
      g.update(STEP, want);
    }
    elapsed += g.t;
    longest = Math.max(longest, g.t);
    if (g.state === 'play') finishes++; else deaths++;
  }
  return {
    rate: deaths / (elapsed / 60),
    deaths,
    finishPct: (finishes / runs) * 100,
    avg: elapsed / runs,
    longest,
  };
}

const lags = (process.env.LAGS || '0,0.1,0.15,0.2,0.25,0.3').split(',').map(Number);
console.log(`difficulty vs reaction time — ${EXPOSURE}s exposure per row, no blunders\n`);
console.log('reaction   deaths/min     avg run    reached 60s');
for (const lag of lags) {
  const r = play(lag);
  const e = r.rate / Math.sqrt(Math.max(1, r.deaths));
  const label = lag === 0 ? '0ms (bot)' : `${Math.round(lag * 1000)}ms`;
  console.log(
    `${label.padEnd(10)} ${r.rate.toFixed(2).padStart(5)} ± ${e.toFixed(2)}` +
    `${r.avg.toFixed(1).padStart(11)}s${r.finishPct.toFixed(0).padStart(13)}%`,
  );
}
console.log('\nA human is roughly 200-280ms. If the game only starts killing at 300ms+,');
console.log('it cannot feel hard to anyone with good reactions, whatever the bot says.');
