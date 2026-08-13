// How much of the game is the player, and how much is the auto-rescue?
//
// Bullet time fires whenever the odds of reaching the next gap drop below
// RESCUE_AT. At 0.9 that is "anything not close to certain", and the first real
// telemetry shows players taking 2.8 rescues a minute and dying with an empty
// bank 100% of the time — the safety net is being used constantly and is still
// fully consumed. If the game is doing that much of the dodging, it will feel
// easy no matter how the patterns are tuned.
//
// This sweeps the trigger to price it: how much difficulty is the rescue system
// currently absorbing, and what would tightening it buy?
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
const EXPOSURE = +(process.env.EXPOSURE || 2400);

/**
 * `at` replaces RESCUE_AT by intercepting maybeRescue: 0.9 is shipping
 * behaviour, 0 disables rescues entirely (the floor — pure player skill).
 */
function run(at, every) {
  let deaths = 0, elapsed = 0, seed = 1, rescues = 0, finishes = 0, runs = 0;
  while (elapsed < EXPOSURE) {
    let clock = 0;
    const g = new Game({ quantize: (a) => Math.ceil((clock + a) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = 0; g.daily = false; g.setView(390, 844, 620);
    rng.scramble = () => rng.seed(seed * 7919);
    seed++; runs++;
    // Re-implement the trigger with a different threshold. Everything else —
    // the odds model, the price, the slow-motion itself — is untouched.
    g.maybeRescue = function (dt) {
      if (this.slowing) { this.slowT -= dt; if (this.slowT <= 0) this.slowing = false; return; }
      if (at <= 0) return;
      const odds = this.escapeOdds();
      if (odds >= at) return;
      this.buyEscape(1 - odds);
    };
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
    rescues += g.rescueCount | 0;
    if (g.state === 'play') finishes++;
    else deaths++;
  }
  return {
    rate: deaths / (elapsed / 60),
    deaths,
    rescuesPerMin: rescues / (elapsed / 60),
    finishPct: (finishes / runs) * 100,
  };
}

console.log(`the price of the auto-rescue — ${EXPOSURE}s exposure per row, frequent-slip bot\n`);
console.log('trigger      deaths/min      rescues/min   reached 60s');
for (const at of [0, 0.5, 0.6, 0.7, 0.8, 0.9]) {
  const r = run(at, 300);
  const err = r.rate / Math.sqrt(Math.max(1, r.deaths));
  const label = at === 0 ? 'off' : at === 0.9 ? '0.90 (now)' : at.toFixed(2);
  console.log(
    `${label.padEnd(12)} ${r.rate.toFixed(2).padStart(5)} ± ${err.toFixed(2)}` +
    `${r.rescuesPerMin.toFixed(2).padStart(14)}${r.finishPct.toFixed(0).padStart(13)}%`,
  );
}
console.log('\nHumans (first 12 real runs): 1.63 deaths/min, 2.77 rescues/min, 17% reached 60s.');
