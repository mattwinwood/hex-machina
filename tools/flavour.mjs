// Does the day's character actually change the mix, and does every pattern stay
// reachable? A lean that becomes a lock would quietly shrink the vocabulary.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { Autopilot } = await import('../src/autopilot.js');
const { DIFFICULTIES, FLAVOURS } = await import('../src/config.js');
const { rng } = await import('../src/rng.js');
const { PATTERNS } = await import('../src/patterns.js');

console.log('flavour        favoured share of spawns   distinct patterns seen');
for (const f of FLAVOURS) {
  const counts = new Map();
  for (let seed = 1; seed <= 30; seed++) {
    const g = new Game({});
    g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
    g.diffIndex = 2; g.daily = false; g.setView(1280, 720, 760);
    Object.defineProperty(g, 'flavour', { get: () => f });
    rng.scramble = () => rng.seed(seed * 7919);
    const ap = new Autopilot(g);
    // Patterns are drawn by Game.drawPattern (a shuffled bag) rather than
    // rng.pick, so count them at the draw itself.
    const realPick = rng.pick;
    rng.pick = (bag) => {
      const v = realPick(bag);
      if (v && v.name && PATTERNS.includes(v)) counts.set(v.name, (counts.get(v.name) || 0) + 1);
      return v;
    };
    g.start();
    while (g.state === 'play' && g.t < 60) g.update(1 / 120, ap.steer());
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const fav = f.favour.reduce((a, n) => a + (counts.get(n) || 0), 0);
  console.log(`${f.name.padEnd(14)} ${(total ? fav / total * 100 : 0).toFixed(1).padStart(20)}%   ${String(counts.size).padStart(10)} / ${PATTERNS.length}`);
}
