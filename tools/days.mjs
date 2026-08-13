// Day-by-day difficulty of the actual daily, as the daily is actually built.
//
// "Yesterday felt harder" has two possible causes and they need separating:
// the code changed, or the seed did. A daily is *designed* to vary day to day,
// so before blaming a build regression it is worth knowing how big the normal
// day-to-day swing is — and whether yesterday sits above today inside it.
//
// Runs the real daily config for each date (seed, modes, twin window, flavour)
// and reports a hazard rate with a Poisson error bar, so "harder" is a claim
// with a confidence attached rather than a vibe.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT } = await import(`${dir}/config.js`);
const { rng, dailySeed, modesForSeed, flavourForSeed } = await import(`${dir}/rng.js`);
const { FLAVOURS } = await import(`${dir}/config.js`);

const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const EXPOSURE = +(process.env.EXPOSURE || 2400);

/** Hazard for one calendar date, run exactly as the daily runs it. */
function dayHazard(date, every) {
  let deaths = 0, elapsed = 0, n = 0;
  const patterns = new Map();
  while (elapsed < EXPOSURE) {
    let clock = 0;
    const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID - 1e-9) * GRID - clock });
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.daily = true;
    // runDate is a getter off dayOffset; override it directly so the harness can
    // replay any calendar date rather than only today.
    Object.defineProperty(g, 'runDate', { value: date, configurable: true });
    g.setView(1280, 720, 760);
    // The seed fixes the day; the bot's slip phase is what varies between runs.
    n++;
    const base = dailySeed(date);
    rng.scramble = () => rng.seed(base * 7919 + n);
    const ap = new Autopilot(g);
    g.start();
    let k = n % 97;
    while (g.state === 'play' && g.t < 60) {
      clock += 1 / 120;
      const all = g.walls;
      g.walls = all.filter((w) => w.dist < VISIBLE);
      let want = ap.steer();
      g.walls = all;
      k++;
      if ((k % every) < 22) want = -want || 1;
      g.update(1 / 120, want);
      for (const w of g.walls) {
        if (!w.__seen) { w.__seen = 1; patterns.set(w.pattern, (patterns.get(w.pattern) || 0) + 1); }
      }
    }
    elapsed += g.t;
    if (g.state !== 'play') deaths++;
  }
  return { rate: deaths / (elapsed / 60), deaths, minutes: elapsed / 60, patterns };
}

const days = +(process.env.DAYS || 8);
const today = new Date('2026-08-12T12:00:00Z');
console.log(`daily difficulty by date — ${EXPOSURE}s exposure per day, frequent-slip bot`);
console.log('(± is one Poisson standard error on the death count)\n');
console.log('date         seed        character        twin      deaths/min');
const rows = [];
for (let i = days - 1; i >= 0; i--) {
  const d = new Date(today.getTime() - i * 86400000);
  const key = d.toISOString().slice(0, 10);
  const seed = dailySeed(d);
  const m = modesForSeed(seed);
  const fl = FLAVOURS[flavourForSeed(seed, FLAVOURS.length)];
  const r = dayHazard(d, 300);
  const err = r.rate / Math.sqrt(Math.max(1, r.deaths));
  rows.push({ key, rate: r.rate, err, fl: fl.name, patterns: r.patterns });
  const twin = m.twin ? `${m.twinAt}s/${m.twinFor}s` : '—';
  console.log(
    `${key}   ${String(seed).padStart(9)}   ${fl.name.padEnd(14)} ${twin.padEnd(9)} ` +
    `${r.rate.toFixed(2)} ± ${err.toFixed(2)}`,
  );
}

const t = rows[rows.length - 1];
const y = rows[rows.length - 2];
const others = rows.slice(0, -1);
const mean = others.reduce((s, r) => s + r.rate, 0) / others.length;
const sd = Math.sqrt(others.reduce((s, r) => s + (r.rate - mean) ** 2, 0) / (others.length - 1));
console.log(`\nprior ${others.length} days: mean ${mean.toFixed(2)}, sd ${sd.toFixed(2)} deaths/min`);
console.log(`yesterday (${y.key}): ${y.rate.toFixed(2)}   today (${t.key}): ${t.rate.toFixed(2)}`);
const diff = y.rate - t.rate;
const se = Math.sqrt(y.err ** 2 + t.err ** 2);
console.log(`yesterday − today = ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ± ${se.toFixed(2)}  (${Math.abs(diff / se).toFixed(1)}σ)`);
console.log(`today vs prior-day mean: ${((t.rate - mean) / sd).toFixed(1)}σ`);
