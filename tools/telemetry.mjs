// What the game does to real people.
//
// Deliberately prints the same axes as the bot harnesses — deaths per minute,
// pattern kill share, day-to-day spread — so a human number can be put straight
// next to the bot number that was used to tune it. Where those two disagree is
// where the bot is lying, and the bot lies in a known direction: it cannot see
// the camera spin, and it never tilts, gets bored, or gives up.
//
// Usage:
//   node telemetry.mjs [path/to/runs.jsonl]
//
// Pull the file off the NAS first:
//   ssh winwoodnas.local 'docker cp dailyhex-board:/app/data/runs.jsonl -' > runs.jsonl
import fs from 'fs';

const file = process.argv[2] || 'runs.jsonl';
if (!fs.existsSync(file)) {
  console.error(`no telemetry at ${file}`);
  console.error('copy it off the NAS first — see the header of this file.');
  process.exit(1);
}

const runs = fs.readFileSync(file, 'utf8').split('\n')
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean)
  .filter((r) => !r.practice);

if (!runs.length) {
  console.log('no runs yet.');
  process.exit(0);
}

const minutes = runs.reduce((s, r) => s + (r.t || 0), 0) / 60;
const deaths = runs.filter((r) => !r.finished).length;
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');
const err = (rate, n) => rate / Math.sqrt(Math.max(1, n));

console.log(`${runs.length} runs, ${minutes.toFixed(1)} minutes played, ${deaths} deaths`);
console.log(`overall: ${(deaths / minutes).toFixed(2)} ± ${err(deaths / minutes, deaths).toFixed(2)} deaths/min`);
console.log(`reached 60s: ${runs.filter((r) => r.finished).length} (${pct(runs.filter((r) => r.finished).length, runs.length)}%)\n`);

/** Group and report a hazard rate with an error bar, commonest first. */
function by(label, key, min = 3) {
  const g = new Map();
  for (const r of runs) {
    const k = typeof key === 'function' ? key(r) : r[key];
    if (k === undefined || k === null) continue;
    const e = g.get(k) || { n: 0, t: 0, d: 0 };
    e.n++; e.t += r.t || 0; e.d += r.finished ? 0 : 1;
    g.set(k, e);
  }
  const rows = [...g.entries()]
    .filter(([, e]) => e.n >= min)
    .map(([k, e]) => ({ k, n: e.n, rate: e.d / (e.t / 60), share: e.n / runs.length }))
    .sort((a, b) => b.rate - a.rate);
  if (!rows.length) return;
  console.log(`deaths/min by ${label}`);
  for (const r of rows) {
    console.log(`  ${String(r.k).padEnd(18)} ${r.rate.toFixed(2).padStart(6)} ± ${err(r.rate, r.n).toFixed(2)}   (${r.n} runs)`);
  }
  console.log();
}

by('day', 'date');
by('day character', 'flavour');
by('arena shape', 'sides');
by('input', 'input');
by('screen', 'shape');
// A device that cannot hold 60fps is playing a slower game. If this splits, the
// difficulty difference is the frame rate, not the design.
by('frame rate', (r) => (r.fps >= 55 ? '55+ fps' : r.fps >= 40 ? '40-55 fps' : 'under 40 fps'));

// --- what kills ------------------------------------------------------------
// Share of deaths per pattern. Compare against the bot's numbers from
// perpat.mjs: the bot has escape-spiral at ~7% of deaths, and a big gap there
// means humans are dying to something a perfect dodger never sees.
const kills = new Map();
for (const r of runs) {
  if (r.finished || !r.pattern) continue;
  kills.set(r.pattern, (kills.get(r.pattern) || 0) + 1);
}
if (kills.size) {
  const total = [...kills.values()].reduce((a, b) => a + b, 0);
  console.log('what kills people');
  for (const [k, n] of [...kills.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${pct(n, total).padStart(5)}%  (${n})`);
  }
  console.log();
}

// --- did the rescue arrive? -------------------------------------------------
// Bullet time is supposed to fire when the next gap has become unreachable. A
// death with a full bank means the trigger was too conservative to spend what
// the player had earned; a death with an empty one means they were simply
// outplayed, which is the intended way to lose.
const banked = runs.filter((r) => !r.finished && typeof r.charges === 'number');
if (banked.length) {
  const full = banked.filter((r) => r.charges >= 3).length;
  const empty = banked.filter((r) => r.charges < 1).length;
  console.log('bullet time at the moment of death');
  console.log(`  died with a full bank (3+):  ${pct(full, banked.length)}%  <- trigger too shy if high`);
  console.log(`  died with nothing left:      ${pct(empty, banked.length)}%  <- fair losses`);
  const used = runs.reduce((s, r) => s + (r.rescues || 0), 0);
  console.log(`  rescues spent per minute:    ${(used / minutes).toFixed(2)}\n`);
}

// --- how far people get -----------------------------------------------------
const buckets = [0, 5, 10, 15, 30, 45, 60];
console.log('how far people get');
for (let i = 0; i < buckets.length; i++) {
  const lo = buckets[i];
  const hi = buckets[i + 1] ?? Infinity;
  const n = runs.filter((r) => r.t >= lo && r.t < hi).length;
  const bar = '#'.repeat(Math.round((n / runs.length) * 40));
  const label = hi === Infinity ? `${lo}s+` : `${lo}-${hi}s`;
  console.log(`  ${label.padEnd(8)} ${String(n).padStart(4)}  ${bar}`);
}
// Dying in the first few seconds over and over is the signature of someone who
// has not understood the controls, not of a hard game.
const early = runs.filter((r) => r.t < 5).length;
console.log(`\n  ${pct(early, runs.length)}% of runs end inside 5 seconds` +
  (early / runs.length > 0.35 ? '  <- high: suspect onboarding, not difficulty' : ''));

// --- assist -----------------------------------------------------------------
const assisted = runs.filter((r) => r.assisted).length;
if (assisted) {
  console.log(`\n${pct(assisted, runs.length)}% of runs used the speed assist` +
    ` (median ${[...runs.filter((r) => r.assisted).map((r) => r.assist)].sort((a, b) => a - b)[Math.floor(assisted / 2)]}%)`);
}
