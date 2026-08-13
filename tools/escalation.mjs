// Does the game actually get harder as a run goes on, and how much of a run is
// spent doing nothing?
//
// Two claims to test, both Matt's, both about *feel* rather than outcome:
//   1. there is too much idle time
//   2. the challenge does not escalate
//
// A hazard rate alone cannot answer either — it is an average over a whole run
// and hides the shape. This measures per 15-second phase window: the exposure a
// bot spends there, the deaths it takes there, how much of the time nothing is
// within reach, and what the mechanical parameters are actually doing.
//
// Survivorship is the trap here. Measuring humans, whoever reaches 45s is better
// than whoever did not, so late buckets look easy for the wrong reason. A bot at
// a fixed slip rate has constant skill, so per-bucket rates are comparable.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const dir = process.env.SRC || '../src';
const { Game } = await import(`${dir}/game.js`);
const { Autopilot } = await import(`${dir}/autopilot.js`);
const { DIFFICULTIES, WORLD_HEIGHT, PHASES } = await import(`${dir}/config.js`);
const TUNE = process.env.TUNE || 'classic';
const { rng } = await import(`${dir}/rng.js`);

const GRID = 0.6, VISIBLE = WORLD_HEIGHT / 2;
const EXPOSURE = +(process.env.EXPOSURE || 9000);
const EDGES = [0, 15, 30, 45, 60, 75];
const bucketOf = (t) => Math.min(EDGES.length - 2, EDGES.findIndex((e, i) => t >= e && t < EDGES[i + 1]));

const B = EDGES.slice(0, -1).map(() => ({ time: 0, deaths: 0, idle: 0, frames: 0, speed: 0, spin: 0, walls: 0 }));

let elapsed = 0, seed = 1;
while (elapsed < EXPOSURE) {
  let clock = 0;
  const g = new Game({ quantize: (a) => Math.ceil((clock + a) / GRID - 1e-9) * GRID - clock });
  g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
  g.diffIndex = 0; g.daily = false; g.setView(390, 844, 620);
  g.tune = TUNE;
  rng.scramble = () => rng.seed(seed * 7919);
  seed++;
  const ap = new Autopilot(g);
  g.start();
  let k = seed % 97;
  while (g.state === 'play' && g.t < 75) {
    clock += 1 / 120;
    const all = g.walls;
    g.walls = all.filter((w) => w.dist < VISIBLE);
    let want = ap.steer();
    g.walls = all;
    k++;
    if ((k % 300) < 22) want = -want || 1;
    const b = B[bucketOf(g.t)];
    b.time += 1 / 120;
    b.frames++;
    b.speed += g.speed;
    b.spin += Math.abs(g.spin);
    // "Idle" = nothing on the approach that has to be dodged. Rings already
    // absorbed behind the cursor are scenery, not a demand on attention.
    const live = g.walls.filter((w) => w.dist > g.orbit && w.dist < VISIBLE);
    b.walls += live.length;
    if (!live.length) b.idle += 1 / 120;
    g.update(1 / 120, want);
    if (g.state !== 'play') b.deaths++;
  }
  elapsed += g.t;
}

console.log(`escalation within a run — ${EXPOSURE}s of exposure, frequent-slip bot\n`);
console.log('window     deaths/min        idle%   walls on approach   wall speed   camera spin');
B.forEach((b, i) => {
  if (b.time < 1) return;
  const rate = b.deaths / (b.time / 60);
  const e = rate / Math.sqrt(Math.max(1, b.deaths));
  const label = `${EDGES[i]}-${EDGES[i + 1]}s`;
  console.log(
    `${label.padEnd(10)} ${rate.toFixed(2).padStart(5)} ± ${e.toFixed(2)}` +
    `${((b.idle / b.time) * 100).toFixed(0).padStart(11)}%` +
    `${(b.walls / b.frames).toFixed(2).padStart(18)}` +
    `${(b.speed / b.frames).toFixed(0).padStart(13)}` +
    `${(b.spin / b.frames).toFixed(2).padStart(14)}`,
  );
});

const first = B[0], last = B.find((b, i) => i === 3 && b.time > 1) || B[2];
if (first.time > 1 && last.time > 1) {
  const r0 = first.deaths / (first.time / 60);
  const r1 = last.deaths / (last.time / 60);
  console.log(`\nfirst window ${r0.toFixed(2)} -> last ${r1.toFixed(2)} deaths/min  (${(r1 / r0).toFixed(2)}x)`);
  console.log(`wall speed   ${(first.speed / first.frames).toFixed(0)} -> ${(last.speed / last.frames).toFixed(0)}` +
    `  (${((last.speed / last.frames) / (first.speed / first.frames)).toFixed(2)}x)`);
  console.log(`idle         ${((first.idle / first.time) * 100).toFixed(0)}% -> ${((last.idle / last.time) * 100).toFixed(0)}%`);
}
console.log('\nphase table (what it is *meant* to do):');
for (const p of PHASES) console.log(`  ${String(p.t).padStart(2)}s  tier ${p.tier}  spin ${p.spin}  zoom ${p.zoom}   ${p.name}`);
console.log('\nNote: `spin` drives cam.rot only — it makes the field harder to READ for a');
console.log('human but changes nothing a bot has to do, so the bot understates its effect.');
