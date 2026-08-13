// Does the first-run tutorial actually complete?
//
// It shipped broken on touch: `steering()` was `state === 'play' && !paused`,
// and the tutorial holds the world with paused = true while waiting for a
// direction to release it — so on a phone a tap never pressed a direction and
// the lesson card could not be dismissed at all. Keyboard worked, because key
// handling never consults that predicate, which is exactly why it looked fine on
// a desktop and was completely dead on a phone.
//
// The state machine is pure logic, so it can be driven without a browser. This
// walks all four lessons with a held direction and asserts each one advances,
// which is the check that would have caught it.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { Tutorial } = await import(`${dir}/tutorial.js`);
const { DIFFICULTIES } = await import(`${dir}/config.js`);

let clock = 0;
const g = new Game({ quantize: (a) => Math.ceil((clock + a) / 0.6 - 1e-9) * 0.6 - clock });
g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
g.daily = false;
g.setView(390, 844, 620);
const ap = new Autopilot(g);
const t = new Tutorial(g);

t.begin();
g.start();

const seen = [];
const stepAt = [];
let held = 1;          // a finger down on one side, never lifted
let frames = 0;
const DT = 1 / 120;

while (t.active && frames < 120 * 90) {
  frames++;
  clock += DT;
  const id = t.active && t.step ? t.step.id : 'finished';
  if (seen[seen.length - 1] !== id) { seen.push(id); stepAt.push(+(frames * DT).toFixed(1)); }

  // While a card is up the only input that matters is "a direction is held".
  // Once it is running, steer properly so lesson two can actually clear walls.
  const want = t.waiting ? held : (g.walls.length ? ap.steer() : held);
  t.update(DT, t.waiting ? held : want);
  g.update(DT, g.paused ? 0 : want);

  // A death mid-lesson should rewind to the same lesson, not end the run.
  if (g.state === 'dead') held = -held;
}

const finished = !t.active;
console.log(`lessons reached: ${seen.join(' -> ')}${finished ? ' -> finished' : ''}`);
console.log(`at seconds:      ${stepAt.join(', ')}`);
console.log(`deaths during:   ${t.deaths}`);
console.log(`completed:       ${finished}`);
console.log(`marked done:     ${!!localStorage.getItem('dailyhex.tutorial')}`);

const want = ['orbit', 'gap', 'charges', 'go'];
const missing = want.filter((s) => !seen.includes(s));
if (missing.length) {
  console.log(`\nFAIL — never reached: ${missing.join(', ')}`);
  process.exit(1);
}
if (!finished) {
  console.log('\nFAIL — walked every lesson but never finished');
  process.exit(1);
}
console.log('\nPASS — all four lessons advance on a held direction, and it ends.');
