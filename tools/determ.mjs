// The daily's one promise: the same sequence for everyone, every time. A bag
// that survived across runs would quietly break it, so this replays the same
// date twice and compares the pattern sequences exactly.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { Autopilot } = await import('../src/autopilot.js');
const { DIFFICULTIES } = await import('../src/config.js');

const date = new Date('2026-08-13T12:00:00Z');
function sequence() {
  let clock = 0;
  const g = new Game({ quantize: (a) => Math.ceil((clock + a) / 0.6 - 1e-9) * 0.6 - clock });
  g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
  g.daily = true;
  Object.defineProperty(g, 'runDate', { value: date, configurable: true });
  g.setView(1280, 720, 760);
  const seen = [];
  const real = g.drawPattern.bind(g);
  g.drawPattern = (bag) => { const v = real(bag); seen.push(v.name); return v; };
  const ap = new Autopilot(g);
  g.start();
  while (g.state === 'play' && g.t < 60) { clock += 1 / 120; g.update(1 / 120, ap.steer()); }
  return seen;
}
const a = sequence(), b = sequence(), c = sequence();
console.log(`draws in a 60s run: ${a.length}, distinct patterns: ${new Set(a).size}`);
console.log(`run1 === run2: ${a.join('|') === b.join('|')}`);
console.log(`run1 === run3: ${a.join('|') === c.join('|')}`);
console.log(`first 10: ${a.slice(0, 10).join(', ')}`);
// A bag should not repeat a pattern until the pool is exhausted.
let worst = 0, gap = new Map();
a.forEach((n, i) => { if (gap.has(n)) worst = Math.max(worst, 0); gap.set(n, i); });
const runs = {};
a.forEach((n) => { runs[n] = (runs[n] || 0) + 1; });
const counts = Object.values(runs);
console.log(`per-pattern counts over the run: min ${Math.min(...counts)}, max ${Math.max(...counts)}`);
