// The Architect — play the game from the other side, and tune it while you do.
//
// Two things that turned out to be one thing. The adversary in this game *is*
// its difficulty: whoever chooses the next wall and the numbers behind it
// decides how hard it is. So the lab lets you do both — queue the next pattern
// by hand, and move the knobs that decide whether the cursor can survive it.
//
// The opponent is the real Autopilot, the same one the fairness canary uses,
// with one addition: reaction time. At 0ms it is the canary and cannot lose —
// every seed is guaranteed survivable by construction. Every millisecond after
// that is the actual difficulty of the game, which is the thing no amount of
// tuning the geometry ever moved.
import { Game } from '../src/game.js';
import { Autopilot } from '../src/autopilot.js';
import { render } from '../src/render.js';
import { PATTERNS, poolFor } from '../src/patterns.js';
import { DIFFICULTIES, SHIFT_SHAPES } from '../src/config.js';
import { rng } from '../src/rng.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const view = { w: 0, h: 0, cx: 0, cy: 0, coverR: 0, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0, dpr: 1 };

// A private copy of the stage. Writing to DIFFICULTIES would change the real
// game in this tab, including the daily.
const base = DIFFICULTIES[0];
const stage = { ...base };

const game = new Game({});
game.diffOverride = stage;
game.daily = false;
game.unlocked = new Set(DIFFICULTIES.map((d) => d.unlockedBy).filter(Boolean));

let bot = new Autopilot(game);
let running = false;
let wallsSent = 0;
let best = null;
let seen = new WeakSet();
// Decisions in flight, so the opponent acts on what it saw `lag` ago.
let pipe = [];

// --- the knobs ---------------------------------------------------------------
// Anything here changes how hard the game is. Grouped by what it does to the
// player rather than by which file it happens to live in.
const KNOBS = [
  {
    id: 'lag', label: 'Reaction time', min: 0, max: 400, step: 10, value: 180, unit: 'ms',
    note: 'The opponent’s handicap. 0 is the fairness canary — unbeatable by design. A human is 200–280.',
    apply: (v) => { state.lag = v; },
  },
  {
    id: 'pace', label: 'Pace', min: 0.5, max: 2.2, step: 0.05, value: 1, unit: '×',
    note: 'Wall and cursor speed together. Geometry is unchanged, so fairness holds — only the milliseconds to read it change.',
    apply: (v) => { game.pace = v; },
  },
  {
    id: 'safety', label: 'Dodging margin', min: 1, max: 2.6, step: 0.05, value: base.safety,
    note: 'How much wider than the bare minimum the gaps are spaced. 1.0 is the theoretical floor — no room for human latency at all.',
    apply: (v) => { stage.safety = v; stage.safetyFloor = Math.min(stage.safetyFloor, v); },
  },
  {
    id: 'safetyDecay', label: 'Margin decay', min: 0, max: 1, step: 0.05, value: base.safetyDecay,
    note: 'How fast that margin erodes across a run. This is the only genuine escalation the game has.',
    apply: (v) => { stage.safetyDecay = v; },
  },
  {
    id: 'rescueAt', label: 'Bullet time trigger', min: 0, max: 1, step: 0.05, value: 0.9,
    note: 'Fires when the odds of reaching the next gap fall below this. 0 disables the rescue entirely.',
    apply: (v) => { game.rescueAt = v; },
  },
  {
    id: 'restChance', label: 'Rest frequency', min: 0, max: 1, step: 0.05, value: 0.45,
    note: 'How often the spawner inserts breathing room. Most of the empty screen in a run comes from here.',
    apply: (v) => { stage.restChance = v; },
  },
  {
    id: 'spinChance', label: 'Rotating rings', min: 0, max: 1, step: 0.05, value: base.ringSpinChance,
    note: 'How often a pattern arrives spinning. Rotation eats into the reachable window, so the spawner pays for it with spacing.',
    apply: (v) => { stage.ringSpinChance = v; },
  },
  {
    id: 'tier', label: 'Pattern complexity cap', min: 0, max: 3, step: 1, value: base.maxTier ?? 2,
    note: 'Highest tier the pool may draw. Raising it unlocks the nastier shapes.',
    apply: (v) => { stage.maxTier = v; },
  },
  {
    id: 'sides', label: 'Arena', min: 0, max: SHIFT_SHAPES.length - 1, step: 1, value: 0,
    format: (v) => `${SHIFT_SHAPES[v]} sides`,
    note: 'Fewer sides means a shorter trip between gaps but far less room to be wrong.',
    apply: (v) => { state.sides = SHIFT_SHAPES[v]; },
  },
];

const state = { lag: 180, sides: 6 };

// --- layout ------------------------------------------------------------------
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  view.w = Math.max(200, r.width);
  view.h = Math.max(200, r.height);
  view.dpr = dpr;
  view.cx = view.w / 2;
  view.cy = view.h / 2;
  view.coverR = Math.hypot(view.w, view.h) / 2 + 40;
  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  canvas.style.width = `${view.w}px`;
  canvas.style.height = `${view.h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.setView(view.w, view.h, view.coverR);
}
window.addEventListener('resize', resize);

// --- controls ----------------------------------------------------------------
const knobHost = document.getElementById('knobs');
const oppHost = document.getElementById('opponent');

function buildKnob(k) {
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  const value = document.createElement('b');
  const label = document.createElement('label');
  label.innerHTML = `<span>${k.label}</span>`;
  label.appendChild(value);
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min: k.min, max: k.max, step: k.step, value: k.value });
  input.id = `knob-${k.id}`;
  label.htmlFor = input.id;
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = k.note;

  const show = () => {
    const v = Number(input.value);
    value.textContent = k.format ? k.format(v) : `${v}${k.unit || ''}`;
    // Flag the settings that make the run meaningless rather than hard.
    wrap.classList.toggle('warn', (k.id === 'lag' && v === 0) || (k.id === 'safety' && v <= 1.05));
    if (k.id === 'lag' && v === 0) note.textContent = 'Zero latency: this is the fairness canary. It cannot be killed — that is the guarantee, not a bug.';
    else if (k.id === 'safety' && v <= 1.05) note.textContent = 'At the bare minimum the game is only survivable with zero reaction time.';
    else note.textContent = k.note;
    k.apply(v);
  };
  input.addEventListener('input', show);
  wrap.append(label, input, note);
  (k.id === 'lag' ? oppHost : knobHost).appendChild(wrap);
  k.show = show;
  k.input = input;
  return k;
}
KNOBS.forEach(buildKnob);

// --- the palette -------------------------------------------------------------
const palette = document.getElementById('palette');
const buttons = new Map();
for (const p of PATTERNS) {
  const b = document.createElement('button');
  b.textContent = p.name;
  b.title = `tier ${p.tier}${p.evenOnly ? ' · even-sided arenas only' : ''}`;
  b.addEventListener('click', () => {
    // Queue it. The spawner still decides where it can fairly land, so the
    // architect chooses the problem rather than bypassing the rules.
    game.queued = p;
    for (const [, other] of buttons) other.classList.remove('armed');
    b.classList.add('armed');
  });
  palette.appendChild(b);
  buttons.set(p.name, b);
}

/** Grey out what the current arena and tier cannot legally spawn. */
function refreshPalette() {
  const legal = new Set(poolFor(stage.maxTier ?? 3, game.sides).map((p) => p.name));
  for (const [name, b] of buttons) b.disabled = !legal.has(name);
}

// --- presets -----------------------------------------------------------------
const PRESETS = {
  'AS SHIPPED': { lag: 180, pace: 1, safety: base.safety, safetyDecay: base.safetyDecay, rescueAt: 0.9, restChance: 0.45, spinChance: base.ringSpinChance, tier: base.maxTier ?? 2, sides: 0 },
  'MEAN': { lag: 220, pace: 1.25, safety: 1.45, safetyDecay: 0.5, rescueAt: 0.6, restChance: 0.2, spinChance: 0.7, tier: 3, sides: 0 },
  'UNFAIR': { lag: 250, pace: 1.6, safety: 1.05, safetyDecay: 0.8, rescueAt: 0, restChance: 0, spinChance: 1, tier: 3, sides: 3 },
  'CANARY': { lag: 0, pace: 1, safety: base.safety, safetyDecay: base.safetyDecay, rescueAt: 0.9, restChance: 0.45, spinChance: base.ringSpinChance, tier: base.maxTier ?? 2, sides: 0 },
};
const presetHost = document.getElementById('presets');
for (const [name, values] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', () => {
    for (const k of KNOBS) {
      if (values[k.id] === undefined) continue;
      k.input.value = values[k.id];
      k.show();
    }
    reset();
  });
  presetHost.appendChild(b);
}

// --- run ---------------------------------------------------------------------
const els = {
  alive: document.getElementById('alive'),
  walls: document.getElementById('walls'),
  best: document.getElementById('best'),
  run: document.getElementById('run'),
  verdict: document.getElementById('verdict'),
};

function reset() {
  rng.scramble = () => rng.seed((Math.floor(performance.now()) % 100000) * 7919 + 13);
  game.queued = null;
  for (const [, b] of buttons) b.classList.remove('armed');
  wallsSent = 0;
  seen = new WeakSet();
  pipe = [];
  game.start();
  // Hold the arena the architect chose rather than letting the phase schedule
  // reshape it mid-experiment.
  if (state.sides !== game.sides) { game.shiftPending = state.sides; game.shiftTimer = 99; }
  bot = new Autopilot(game);
  els.verdict.hidden = true;
  refreshPalette();
}

els.run.addEventListener('click', () => {
  running = !running;
  els.run.textContent = running ? 'PAUSE' : 'RUN';
  els.run.dataset.running = running ? '1' : '0';
  if (running && game.state !== 'play') reset();
});
document.getElementById('reset').addEventListener('click', () => { reset(); });

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (running && game.state === 'play') {
    // The opponent decides on stale information — its only handicap.
    const frames = Math.max(0, Math.round((state.lag / 1000) / dt || 0));
    pipe.push(bot.steer());
    const want = pipe.length > frames ? pipe.shift() : 0;
    game.update(dt, want);
    for (const w of game.walls) {
      if (!seen.has(w)) { seen.add(w); wallsSent++; }
    }
    if (game.state !== 'play') {
      const t = game.t;
      if (best === null || t < best) best = t;
      els.verdict.hidden = false;
      els.verdict.textContent = `KILLED IT IN ${t.toFixed(2)}s — ${wallsSent} WALLS`;
      running = false;
      els.run.textContent = 'RUN';
      els.run.dataset.running = '0';
    }
  } else {
    game.updateCosmetics?.(dt);
  }

  els.alive.textContent = game.t.toFixed(1);
  els.walls.textContent = String(wallsSent);
  els.best.textContent = best === null ? '—' : `${best.toFixed(2)}s`;
  render(ctx, game, view);
  requestAnimationFrame(frame);
}

// Font first: the renderer measures text to lay itself out, and measuring
// against a fallback wraps everything wrong.
if (document.fonts?.load) {
  document.fonts.load('16px "Archivo Black"').catch(() => {});
}
resize();
KNOBS.forEach((k) => k.show());
reset();
requestAnimationFrame(frame);

// Handy from the console when poking at it.
window.architect = {
  game, stage, state, reset, KNOBS,
  get bot() { return bot; },
  /**
   * Run a whole trial without waiting on the render loop. The browser pane
   * throttles requestAnimationFrame when it is not visible, which makes a live
   * observation of "did it die" take minutes and sometimes never finish — this
   * answers the same question in milliseconds and is how the lab gets tested.
   */
  simulate(seconds = 60, lagMs = state.lag) {
    reset();
    const dt = 1 / 120;
    const frames = Math.max(0, Math.round((lagMs / 1000) / dt));
    const pipe = [];
    const seenLocal = new WeakSet();
    let sent = 0;
    while (game.state === 'play' && game.t < seconds) {
      pipe.push(bot.steer());
      const want = pipe.length > frames ? pipe.shift() : 0;
      game.update(dt, want);
      for (const w of game.walls) if (!seenLocal.has(w)) { seenLocal.add(w); sent++; }
    }
    return { survived: +game.t.toFixed(2), died: game.state !== 'play', walls: sent, lagMs };
  },
};
