// Fairness canary: the shipped Autopilot brain must survive every stage, shape
// and mode combination. If it dies, the spawner produced something no reaction
// time could clear.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const realKeys = Object.keys;
Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : realKeys(o));
globalThis.window = { addEventListener() {} };

const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, SHIFT_SHAPES } = await import(`${dir}/config.js`);
const { rng } = await import(`${dir}/rng.js`);

export async function run(diffIndex, { seed, twin, pulse, shift, forceSides }, limit = 75) {
  // A synthetic 150ms grid (the eighth-note spacing measured off our tracks) so
  // the beat-quantised spawn path is the one under test.
  const GRID = 0.15;
  let clock = 0;
  const g = new Game({ quantize: (ahead) => Math.ceil((clock + ahead) / GRID) * GRID - clock });
  g.unlocked = new Set(DIFFICULTIES.map((d) => d.unlockedBy).filter(Boolean));
  g.diffIndex = diffIndex;
  g.daily = false;
  g.setView(1280, 720, 760);
  const ap = new Autopilot(g);
  g.twinSeed = twin; g.twinAt = twin ? 15 : null; g.twinFor = 12;
  g.pulseMode = pulse; g.shiftMode = shift;
  rng.scramble = () => rng.seed(seed);
  g.start();
  if (forceSides) { g.shiftPending = forceSides; g.maybeShift(9); }
  const shapes = new Set([g.sides]);
  let guard = 0;
  while (g.state === 'play' && g.t < limit && guard++ < limit * 200) {
    clock += 1 / 120;
    g.update(1 / 120, ap.steer());
    shapes.add(g.sides);
  }
  return { t: g.t, died: g.state !== 'play', shapes: [...shapes] };
}
export { DIFFICULTIES, SHIFT_SHAPES };
