// Game simulation. Everything lives in *world* space: the camera rotation is
// cosmetic, so the player's angle and the walls' slots never care about it.
// Fixed-timestep updates keep collision stable at high wall speeds.

import {
  TAU, DEFAULT_SIDES, SHIFT_SHAPES, geometryFor, twinHalf, twinPossible,
  CORE_RADIUS, PLAYER_ORBIT, WORLD_HEIGHT, RING_SPIN_FRACTION,
  CHARGE_SECONDS, MAX_CHARGES, SECONDS_PER_CHARGE, STAMINA_MAX,
  SLOWMO_SCALE, SLOWMO_AGILITY, GRAZE_SLOWMO,
  PROGRESS_SECONDS, SPEED_GAIN, SAFETY_DECAY, PHASES,
  GRAZE_WINDOW, GRAZE_DECAY, GRAZE_COST_MIN, GRAZE_COST_MAX, PULSE_AMPLITUDE, PULSE_ZOOM,
  HUE_SHIMMER, HUE_SHIMMER_PERIOD,
  REST_CHANCE, REST_MIN, REST_MAX, REST_MAX_SECONDS, GRAZE_MAX_CHAIN,
  CHECKPOINTS, ASSIST_STEP, ASSIST_MIN, BADGES,
  RANKS, DIFFICULTIES, TRACKS, FLAVOURS, mod, angDiff, clamp,
} from './config.js';
import { poolFor } from './patterns.js';
import { rng, dailySeed, dailyKey, modesForSeed, trackForDate, flavourForSeed, dateForOffset } from './rng.js';

const FIXED_DT = 1 / 240;
const COLLIDE_PAD = 1.5;
// Only the face bearing down on you is lethal. Past that, the wall is being
// swallowed by the core and brushing its side is forgiven — sliding into a lane
// a wall has already swept through no longer kills you. Comfortably wider than
// the ~6.8 world units a wall covers in one 240Hz step at the fastest stage, so
// nothing can step over the band between frames.
const KILL_DEPTH = 24;
const WIN_AT = 60; // the machine breaks here; the run does not stop
// The twin cue is deliberately short: it fires mid-run, so it must register and
// then get out of the way rather than sit over the field you are reading.
const TWIN_CUE = 0.9;
// How long a wall takes to dissolve when a reshape retires it.
const RETIRE_FADE = 0.28;
// The most a ring may be delayed to catch a beat. Must exceed the longest grid
// period or a ring could never reach the next beat and would fall back to
// unquantised spacing, which is exactly the "nothing changed" failure.
const BEAT_SNAP_MAX = 0.98;
// Bullet time fires when the odds of clearing the next ring fall below this.
// Slightly under 1.0 rather than exactly at it: at 1.0 the estimate fires on
// moments a competent player still recovers from, and spending the bank early
// leaves it empty for the crisis that follows. Measured, 0.9 rescued more runs.
// Fire only when the next gap is genuinely slipping away. At 0.9 this rescued
// players from situations they had a 90% chance of escaping unaided — it fired
// every ~22 seconds, absorbed more than half the game's difficulty (2.60 -> 1.09
// deaths/min with it on) and took the 60-second finish rate from 4% to 32%.
// "Little to no chance" was always the spec; 0.9 was not that.
// The fairness canary holds 210/210 at every value down to 0.4, because a
// greedy bot never needs the net at all — it exists only for imperfect play.
const RESCUE_AT = 0.6;
const RESCUE_COOLDOWN = 0.35; // one bad ring must not drain the whole bank
// How much of a gap's half-width counts as "inside" rather than "at the centre".
const RESCUE_MARGIN = 0.75;
const RESCUE_MIN_LEAD = 0.07; // seconds; below this the ring's outcome is settled

const NS = 'dailyhex';
const LEGACY_NS = ['hexmachina.', 'hexagon.'];
const bestKey = (id, twin) => `${NS}.best.${id}${twin ? '.twin' : ''}`;
const UNLOCK_KEY = `${NS}.unlocked`;
const REACHED_KEY = `${NS}.reached2`;
const DAILY_KEY = `${NS}.daily`;
const BADGE_KEY = `${NS}.badges`;
const NAME_KEY = `${NS}.name`;
const PLAYED_KEY = `${NS}.played`;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing — nothing persists, which is survivable */
  }
}

export function loadBest(id, twin) {
  const v = parseFloat(localStorage.getItem(bestKey(id, twin)) || '0');
  return Number.isFinite(v) ? v : 0;
}

function saveBest(id, twin, t) {
  try {
    localStorage.setItem(bestKey(id, twin), String(t));
  } catch {
    /* scores just don't persist */
  }
}

// The game has been renamed twice (Hexagon → Hex Machina → Daily Hex). Carry
// saves forward through the whole chain rather than stranding anyone's records.
(function migrateLegacySaves() {
  try {
    if (localStorage.getItem(`${NS}.migrated`)) return;
    for (const prefix of LEGACY_NS) {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(prefix)) continue;
        const moved = `${NS}.${key.slice(prefix.length)}`;
        if (localStorage.getItem(moved) === null) localStorage.setItem(moved, localStorage.getItem(key));
      }
    }
    localStorage.setItem(`${NS}.migrated`, '1');
  } catch {
    /* nothing to migrate into */
  }
})();

// Stages were renamed off the original game's vocabulary. Their ids are baked
// into save keys, so remap instead of orphaning records. Matching is exact per
// id: substring replacement would corrupt these, since 'hexagon' is a prefix of
// 'hexagoner' and a substring of 'hyper-hexagon'.
const RENAMED_STAGES = {
  hexagon: 'spark',
  hexagoner: 'forge',
  hexagonest: 'crucible',
  'hyper-hexagon': 'flare',
  'hyper-hexagoner': 'furnace',
  'hyper-hexagonest': 'meltdown',
};

(function migrateStageIds() {
  try {
    if (localStorage.getItem(`${NS}.stages-renamed`)) return;
    const rename = (id) => RENAMED_STAGES[id] || id;

    for (const [from, to] of Object.entries(RENAMED_STAGES)) {
      for (const suffix of ['', '.twin']) {
        const old = `${NS}.best.${from}${suffix}`;
        const raw = localStorage.getItem(old);
        if (raw === null) continue;
        const moved = `${NS}.best.${to}${suffix}`;
        // Keep the better time if a record somehow exists under both names.
        if (parseFloat(raw) > parseFloat(localStorage.getItem(moved) || '0')) {
          localStorage.setItem(moved, raw);
        }
        localStorage.removeItem(old);
      }
    }

    const unlocked = readJSON(UNLOCK_KEY, null);
    if (Array.isArray(unlocked)) writeJSON(UNLOCK_KEY, [...new Set(unlocked.map(rename))]);

    // The old checkpoint unlock set is dead: practice entry points are derived
    // from what a run actually reached. Its entries could not be trusted anyway,
    // since the autopilot demo used to write them.
    localStorage.removeItem(`${NS}.checkpoints`);

    localStorage.setItem(`${NS}.stages-renamed`, '1');
  } catch {
    /* no store — nothing to carry forward */
  }
})();

export class Game {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.state = 'menu'; // menu | play | dead
    this.paused = false;
    this.overlay = null;
    this.loading = false;
    this.diffIndex = 0;
    this.view = { w: 1280, h: 720 };
    this.spawnDist = 900;
    this.acc = 0;
    this.alpha = 0;

    // --- modes
    // The daily is the game now: modes come from the seed, not from switches.
    this.daily = true;
    this.dayOffset = 0; // 0 = today, 1 = yesterday, ...
    this.twin = false;
    this.pulseMode = false;
    this.shiftMode = false;
    this.practice = false;
    this.practiceFrom = 0;
    this.demo = false; // set by the autopilot; nothing it does is credited
    this.tutorial = false; // first-run lessons; a beginner's deaths are not scores
    this.teach = null; // current lesson card, owned by Tutorial
    this.wallsCleared = 0; // walls survived this run
    this.assist = 100; // percent of normal speed
    this.badges = new Set(readJSON(BADGE_KEY, []));
    this.playerName = localStorage.getItem(NAME_KEY) || '';
    this.board = null; // leaderboard rows for the current date
    this.boardNews = null; // 'someone passed you' notice, set from the board poll
    this.pendingSubmit = null; // score awaiting a name
    this.applySeedModes();

    this.unlocked = new Set(readJSON(UNLOCK_KEY, []));
    this.reached = readJSON(REACHED_KEY, {}); // stage id -> furthest seconds survived
    this.best = loadBest(DIFFICULTIES[0].id, false);

    this.geom = geometryFor(DEFAULT_SIDES);
    this.walls = [];
    this.fading = [];
    this.particles = [];
    this.cam = { rot: 0, zoom: 1, shake: 0, flash: 0, invert: 0 };
    this.player = { angle: 0, prevAngle: 0 };
    this.charges = 0;
    this.stamina = 0;
    this.slowing = false;
    this.graze = { chain: 0, best: 0, timer: 0, flash: 0, total: 0 };
    this.autoSlow = 0;
    this.rescueCooldown = 0;
    this.lastOdds = 1;
    this.twinPending = false;
    this.twinTimer = 0;
    this.twinFlash = 0;
    this.twinNext = null;
    this.t = 0;
    this.hue = DIFFICULTIES[0].hue;
    this.targetHue = this.hue;
    this.rankIndex = -1;
    this.rankFlash = 0;
    this.rankName = '';
    this.phaseIndex = 0;
    this.broken = false;
    this.justUnlocked = null;
    this.deathT = 0;
    this.pulse = 0;
    this.lean = 0;
    this.shimmer = 0;
    this.orbitScale = 1;
    this.morph = 1; // 0..1 shape-change animation
    this.morphFrom = DEFAULT_SIDES;
    this.shiftPending = 0;
    this.frontier = -Infinity;
    this.lastExit = null;
    this.spin = 0;
  }

  // --- geometry ------------------------------------------------------------

  get sides() {
    return this.geom.sides;
  }

  get step() {
    return this.geom.step;
  }

  /** Cursor radius. Pulse Mode breathes this, which is the whole mechanic. */
  get orbit() {
    return PLAYER_ORBIT * this.orbitScale;
  }

  get coreRadius() {
    return CORE_RADIUS * this.orbitScale;
  }

  get diff() {
    // `diffOverride` lets a tool hold its own mutable copy of a stage. Writing
    // to DIFFICULTIES directly would leak into every other run in the tab,
    // including the daily — the architect lab must not be able to change the
    // real game out from under it.
    return this.diffOverride || DIFFICULTIES[this.diffIndex];
  }

  isUnlocked(d) {
    return !d.unlockedBy || this.unlocked.has(d.unlockedBy);
  }

  bestFor(id, twin) {
    return loadBest(id, twin);
  }

  get progress() {
    return this.diff.startProgress + this.t / PROGRESS_SECONDS;
  }

  /**
   * Pace scales wall speed and cursor speed together, so the *geometry* is
   * untouched and the fairness guarantee is unaffected — a zero-latency bot
   * still clears every seed. What it changes is the one thing that bot cannot
   * feel: how many milliseconds a human has to read the field and move. That is
   * why the canary reads 210/210 at every pace, and why pace is the only lever
   * that reliably makes the game harder for someone who is actually good at it.
   */
  get pace() {
    return this._pace || 1;
  }

  set pace(v) {
    this._pace = Math.max(0.5, Math.min(2.5, Number(v) || 1));
  }

  get speed() {
    return Math.min(this.diff.maxSpeed, this.diff.wallSpeed * (1 + SPEED_GAIN * this.progress)) * this.pace;
  }

  get playerSpeed() {
    return this.diff.playerSpeed * this.pace;
  }

  get safety() {
    return Math.max(this.diff.safetyFloor, this.diff.safety - (this.diff.safetyDecay ?? SAFETY_DECAY) * this.progress);
  }

  get phase() {
    return PHASES[this.phaseIndex];
  }

  /** Score multiplier earned by grazing. Surviving is the floor, not the ceiling. */
  get multiplier() {
    return 1 + this.graze.chain * 0.1;
  }

  setView(w, h, coverR) {
    if (!(w > 0) || !(h > 0)) return;
    this.view.w = w;
    this.view.h = h;
    const reach = coverR > 0 ? coverR : Math.hypot(w, h) / 2;
    this.spawnDist = reach * (WORLD_HEIGHT / Math.min(w, h)) + 70;
  }

  // --- menu state ----------------------------------------------------------

  toggleTwin() {
    if (this.state !== 'menu') return;
    this.twinSeed = !this.twinSeed;
    this.best = loadBest(this.diff.id, this.twinSeed);
    return this.twinSeed;
  }

  /** The date this run belongs to. */
  get runDate() {
    return dateForOffset(this.dayOffset);
  }

  get dateKey() {
    return dailyKey(this.runDate);
  }

  get seed() {
    return dailySeed(this.runDate);
  }

  /**
   * The day's music. A stage owning one fixed track meant every daily sounded
   * the same, since the daily is always the same stage — so on the daily the
   * seed picks, and everyone hears the same song that day.
   */
  get track() {
    if (!this.daily) return this.diff.track;
    return TRACKS[trackForDate(this.runDate, TRACKS.length)];
  }

  /** The day's character. Off the daily it is always the plain mixed pool. */
  get flavour() {
    if (!this.daily) return FLAVOURS[0];
    return FLAVOURS[flavourForSeed(this.seed, FLAVOURS.length)];
  }

  /** Modes are a property of the seed, identical for everyone playing that day. */
  applySeedModes() {
    const m = modesForSeed(this.seed);
    // Twin is armed by the seed but not switched on: it arrives mid-run at the
    // second the seed fixes, so everyone meets the second cursor together.
    this.twinSeed = m.twin;
    this.twinAt = m.twinAt;
    this.twinFor = m.twinFor;
    this.twin = false;
    this.pulseMode = m.pulse;
    this.shiftMode = m.shift;
    return m;
  }

  /** Step back and forth through the last week of seeds. */
  changeDay(delta) {
    if (this.state !== 'menu') return;
    this.dayOffset = clamp(this.dayOffset + delta, 0, 6);
    this.applySeedModes();
    this.best = loadBest(this.diff.id, this.twinSeed);
    this.board = null;
    this.hooks.onDayChange?.(this.dateKey);
  }

  /** Assist: run the whole world slower, in fixed steps. Never ranked. */
  changeAssist(delta) {
    this.assist = clamp(this.assist + delta * ASSIST_STEP, ASSIST_MIN, 100);
    return this.assist;
  }

  get assisted() {
    // A non-standard pace or profile is a different game, so it is unranked for
    // the same reason the speed assist is: the board only compares like with
    // like.
    return this.assist !== 100 || this.pace !== 1;
  }

  setName(name) {
    this.playerName = String(name || '').slice(0, 16).toUpperCase();
    try {
      localStorage.setItem(NAME_KEY, this.playerName);
    } catch {
      /* not persisted, but usable this session */
    }
    return this.playerName;
  }

  // --- badges --------------------------------------------------------------

  award(id) {
    if (this.demo || this.tutorial) return false; // neither earns on the player's behalf
    if (this.badges.has(id)) return false;
    this.badges.add(id);
    writeJSON(BADGE_KEY, [...this.badges]);
    this.hooks.onBadge?.(BADGES.find((b) => b.id === id));
    return true;
  }

  /** Days played, used for streak badges. */
  markPlayed() {
    const played = new Set(readJSON(PLAYED_KEY, []));
    played.add(this.dateKey);
    const list = [...played].sort().slice(-60);
    writeJSON(PLAYED_KEY, list);
    // Count back from today for the current streak.
    let streak = 0;
    for (let i = 0; i < 60; i++) {
      if (list.includes(dailyKey(dateForOffset(i)))) streak++;
      else if (i > 0) break;
    }
    this.streak = streak;
    if (streak >= 3) this.award('streak3');
    if (streak >= 7) this.award('streak7');
    return streak;
  }

  get streakCount() {
    if (this.streak == null) {
      const list = readJSON(PLAYED_KEY, []);
      let streak = 0;
      for (let i = 0; i < 60; i++) {
        if (list.includes(dailyKey(dateForOffset(i)))) streak++;
        else if (i > 0) break;
      }
      this.streak = streak;
    }
    return this.streak;
  }

  togglePause() {
    if (this.state !== 'play') return false;
    this.paused = !this.paused;
    this.hooks.onPause?.(this.paused);
    return this.paused;
  }

  openOverlay(id) {
    if (this.state !== 'menu') return;
    this.overlay = this.overlay === id ? null : id;
  }

  closeOverlay() {
    this.overlay = null;
  }

  changeDifficulty(delta) {
    if (this.state !== 'menu') return;
    for (let i = 0; i < DIFFICULTIES.length; i++) {
      this.diffIndex = mod(this.diffIndex + delta, DIFFICULTIES.length);
      if (this.isUnlocked(this.diff)) break;
    }
    this.best = loadBest(this.diff.id, this.twinSeed);
    this.hue = this.targetHue = this.diff.hue;
  }

  resetScores() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(`${NS}.best`) || key === UNLOCK_KEY
          || key === REACHED_KEY) localStorage.removeItem(key);
      }
    } catch {
      /* nothing to clear */
    }
    this.unlocked = new Set();
    this.reached = {};
    this.diffIndex = 0;
    this.best = 0;
    this.hue = this.targetHue = this.diff.hue;
  }

  // --- run lifecycle -------------------------------------------------------

  action() {
    if (this.overlay) {
      this.closeOverlay();
      return;
    }
    if (this.state === 'menu') this.armStart();
    else if (this.state === 'play' && this.paused) this.togglePause();
    else if (this.state === 'dead' && this.deathT > 0.65) this.armStart();
  }

  back() {
    if (this.overlay) {
      this.closeOverlay();
      return;
    }
    if (this.state === 'dead') this.toMenu();
    else if (this.state === 'play') {
      if (this.paused) this.toMenu();
      else this.togglePause();
    }
  }

  armStart(fromCheckpoint = null) {
    if (this.loading || this.state === 'play') return;
    const d = this.diff;
    if (!this.isUnlocked(d)) return;
    this.pendingCheckpoint = fromCheckpoint;
    this.loading = true;
    const ready = this.hooks.onPrepare?.(d) || Promise.resolve();
    ready.then(() => {
      if (!this.loading) return;
      this.loading = false;
      this.start(this.pendingCheckpoint);
    });
  }

  /** Checkpoint practice: start mid-run, and never write a record. */
  /**
   * A practice entry point is offered only once the player has actually survived
   * that far in a real run — not a demo, not a practice run, not an assisted one.
   * Derived from the furthest-reached record rather than a separate unlock set,
   * so the two can never disagree.
   */
  canPractice(seconds) {
    return (this.reached[this.diff.id] || 0) >= seconds;
  }

  start(fromCheckpoint = null) {
    const d = this.diff;
    if (!this.isUnlocked(d)) return;
    this.practice = fromCheckpoint != null;
    this.practiceFrom = fromCheckpoint || 0;

    // A daily run is the same sequence for everyone; anything else is fresh.
    if (this.daily) {
      this.applySeedModes();
      rng.seed(this.seed ^ (this.diffIndex * 2654435761));
    } else {
      rng.scramble();
    }

    // A half-consumed bag carried into the next run would make a retry of the
    // daily differ from a first attempt at it, which breaks the one promise the
    // daily makes: the same sequence for everyone, every time.
    this.rescueCount = 0;
    this.lastHit = null;

    this.state = 'play';
    this.loading = false;
    this.paused = false;
    this.boardNews = null; // starting a run is acting on it
    this.t = this.practice ? this.practiceFrom : 0;
    this.geom = geometryFor(DEFAULT_SIDES);
    this.morph = 1;
    this.morphFrom = DEFAULT_SIDES;
    this.shiftPending = 0;
    this.shiftTimer = 0;
    this.walls.length = 0;
    this.fading.length = 0;
    this.particles.length = 0;
    this.frontier = -Infinity;
    this.lastExit = null;
    this.wallsCleared = 0;
    this.player.angle = this.player.prevAngle = this.step * 0.5;
    this.charges = this.practice ? MAX_CHARGES : 0;
    this.stamina = this.charges * SECONDS_PER_CHARGE;
    this.slowing = false;
    this.graze = { chain: 0, best: 0, timer: 0, flash: 0, total: 0 };
    this.autoSlow = 0;
    this.rescueCooldown = 0;
    this.lastOdds = 1;
    // Windows alternate on/off from the first opening. A practice run starting
    // mid-way is dropped into whichever window it belongs to, rather than being
    // handed a schedule that no longer matches the clock.
    this.twin = false;
    this.twinPending = false;
    this.twinTimer = 0;
    this.twinFlash = 0;
    this.twinNext = this.twinSeed && this.twinAt != null ? this.twinAt : null;
    if (this.twinNext != null && this.t > this.twinAt) {
      const elapsed = this.t - this.twinAt;
      const cycle = Math.floor(elapsed / this.twinFor);
      this.twin = cycle % 2 === 0;
      this.twinNext = this.twinAt + (cycle + 1) * this.twinFor;
    }
    this.cam.rot = 0;
    this.cam.zoom = 1;
    this.cam.shake = 0;
    this.cam.flash = 0;
    this.cam.invert = 0;
    this.orbitScale = 1;
    this.spin = rng.sign() * d.spin;
    this.spinTimer = rng.range(d.flipEvery[0], d.flipEvery[1]);
    this.burst = 0;
    this.burstTimer = d.spinBurst ? d.spinBurst.every : Infinity;
    this.burstDir = 1;
    this.phaseIndex = 0;
    this.applyPhase(phaseFor(this.t), true);
    this.rankIndex = RANKS.filter((r) => r.t <= this.t).length - 1;
    this.rankFlash = 0;
    this.rankName = '';
    this.broken = false;
    this.justUnlocked = null;
    this.deathT = 0;
    this.best = loadBest(d.id, this.twinSeed);
    if (this.daily && !this.practice && !this.demo && !this.tutorial) {
      this.markPlayed();
      this.award('first-run');
    }
    this.hooks.onStart?.(d);
  }

  toMenu() {
    this.state = 'menu';
    this.paused = false;
    this.overlay = null;
    this.loading = false;
    this.practice = false;
    this.walls.length = 0;
    this.fading.length = 0;
    this.particles.length = 0;
    this.geom = geometryFor(DEFAULT_SIDES);
    this.morph = 1;
    this.cam.shake = 0;
    this.cam.zoom = 1;
    this.cam.invert = 0;
    this.orbitScale = 1;
    this.hue = this.targetHue = this.diff.hue;
    this.hooks.onMenu?.();
  }

  // --- main loop -----------------------------------------------------------

  update(dt, dir) {
    dt = Math.min(dt, 0.1);
    if (this.paused) {
      this.alpha = 0;
      return;
    }
    // Slow motion is not a button. It is spent by the simulation when a near
    // miss earns it, and runs itself down from there.
    if (this.autoSlow > 0 && this.state === 'play') this.autoSlow = Math.max(0, this.autoSlow - dt);
    this.slowing = this.autoSlow > 0 && this.state === 'play';
    // The assist slows the whole world, which is the only thing that genuinely
    // buys reaction time — wall speed alone cancels out against the spacing rule.
    const assistScale = this.state === 'play' ? this.assist / 100 : 1;
    const scale = (this.slowing ? SLOWMO_SCALE : 1) * assistScale;

    this.acc += dt * scale;
    let guard = 0;
    while (this.acc >= FIXED_DT && guard++ < 600) {
      this.acc -= FIXED_DT;
      this.step_(FIXED_DT, dir);
    }
    this.alpha = this.acc;
    this.updateCosmetics(dt);
  }

  step_(dt, dir) {
    if (this.state === 'play') {
      this.t += dt;
      this.earnCharge(dt);
      this.updateSpin(dt);
      this.movePlayer(dt, dir);
      this.moveWalls(dt);
      this.maybeTwin(dt);
      this.maybeShift(dt);
      this.maybeSpawn();
      this.maybeRescue(dt);
      this.scoreGrazes(dt);
      this.checkRank();
      if (this.playerHits(this.player.angle)) this.die();
    } else if (this.state === 'menu') {
      this.cam.rot += 0.28 * dt;
      this.player.angle += 0.9 * dt;
    } else if (this.state === 'dead') {
      this.deathT += dt;
      this.cam.rot += this.spin * dt * Math.max(0, 1 - this.deathT * 1.4);
    }
    this.updateParticles(dt);
  }

  /** Bullet time is banked by staying alive, never issued for free. */
  earnCharge(dt) {
    if (this.slowing) return;
    this.charges = Math.min(MAX_CHARGES, this.charges + dt / CHARGE_SECONDS);
    this.stamina = this.charges * SECONDS_PER_CHARGE;
  }

  updateSpin(dt) {
    const d = this.diff;
    const phaseSpin = this.phase.spin * (this.diff.spinScale ?? 1) * (this.broken ? 1 + (this.t - WIN_AT) * 0.012 : 1);
    this.spinTimer -= dt;
    if (this.spinTimer <= 0) {
      const mag = (d.spin + d.spinGain * this.t) * rng.range(0.65, 1.45);
      this.spin = -Math.sign(this.spin || 1) * mag;
      this.spinTimer = rng.range(d.flipEvery[0], d.flipEvery[1]);
    }
    this.cam.rot += this.spin * phaseSpin * dt;

    if (d.spinBurst) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0 && this.burst <= 0) {
        this.burst = d.spinBurst.duration;
        this.burstTimer = d.spinBurst.every;
        this.burstDir = Math.sign(this.spin || 1);
      }
      if (this.burst > 0) {
        const u = 1 - this.burst / d.spinBurst.duration;
        const rate = ((d.spinBurst.turns * TAU) / d.spinBurst.duration) * (Math.PI / 2) * Math.sin(Math.PI * u);
        this.cam.rot += this.burstDir * rate * dt;
        this.burst -= dt;
      }
    }
  }

  movePlayer(dt, dir) {
    this.player.prevAngle = this.player.angle;
    if (!dir) return;
    const speed = this.playerSpeed * (this.slowing ? SLOWMO_AGILITY : 1);
    const from = this.player.angle;
    const to = from + dir * speed * dt;
    this.player.angle = this.playerHits(to) ? this.slideBack(from, to) : to;
  }

  slideBack(from, to) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (this.playerHits(from + (to - from) * mid)) hi = mid;
      else lo = mid;
    }
    return from + (to - from) * lo;
  }

  playerHits(angle) {
    if (this.hitsWall(angle)) return true;
    return this.twin ? this.hitsWall(angle + Math.PI) : false;
  }

  /** Fully inside the cursor's orbit: decoration now, not an obstacle. */
  absorbed(w) {
    return w.dist + w.len + COLLIDE_PAD <= this.orbit;
  }

  moveWalls(dt) {
    const v = this.speed * dt;
    this.updateFading(dt, v);
    const walls = this.walls;
    let n = 0;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      w.dist -= v;
      // Did they get past anything at all? Dying without clearing a single wall
      // is the signature of not understanding the game rather than losing it.
      if (!w.passed && w.dist + w.len < this.orbit) {
        w.passed = true;
        this.wallsCleared++;
      }
      // A ring stops turning once it is being absorbed by the core: a wall
      // sliding sideways against a core that does not turn with it reads as the
      // geometry coming apart. The cut-off is the exact point the wall stops
      // being collidable rather than the point it visually touches the core —
      // hitsWall can only ever reach out to `orbit`, so freezing at anything
      // closer than that would quietly change the game instead of the picture.
      if (w.spin && !this.absorbed(w)) w.phase += w.spin * dt;
      if (w.dist + w.len > this.coreRadius) walls[n++] = w;
    }
    walls.length = n;

    this.frontier -= v;
  }

  // --- shift mode ----------------------------------------------------------

  /**
   * Change the arena's shape, but only into a clear field. Morphing while walls
   * are in flight would teleport them into new slots — so a shift waits for the
   * board to drain, and the spawner holds off until it lands.
   */
  maybeShift(dt) {
    if (!this.shiftPending) return;
    this.shiftTimer += dt;
    // Land as soon as nothing is left to dodge — every remaining wall is already
    // behind the cursor, so retiring them is invisible. Waiting for the board to
    // be *completely* empty instead left the arena bare for over a second while
    // the spawner sat held, which reads as the game having stopped.
    const ahead = this.walls.some((w) => w.dist + w.len > this.orbit);
    if (ahead && this.shiftTimer < 8) return;

    const from = this.sides;
    this.geom = geometryFor(this.shiftPending);
    this.shiftPending = 0;
    this.shiftTimer = 0;
    this.morphFrom = from;
    this.morph = 0;
    this.lastExit = null;
    // Not -Infinity. The spawner places the next ring at
    // `max(spawnDist, frontier + clear)`, so an infinitely negative frontier
    // discards the clearance term entirely and the first ring after a reshape
    // lands at spawnDist no matter how far the cursor has to travel to meet it.
    // Anchoring to the cursor's own radius makes that first ring obey the same
    // guarantee as every other one. Invisible at two reshapes a run; at seven it
    // cost 48 of 210 canary runs.
    this.frontier = this.orbit;
    this.retireWalls();
    this.player.angle = mod(this.player.angle, TAU);
    this.cam.flash = 0.7;
    this.hooks.onShift?.(this.sides);
  }

  /**
   * Twin arrives partway through the run. It cannot simply be switched on: the
   * walls already in flight were built for one cursor, and mirroring the world
   * underneath them would drop the second cursor straight into a wall. So the
   * trigger arms a pending flip, and the flip waits for a clear field exactly
   * as a shape shift does.
   */
  /**
   * Twin is a repeating window, not a switch thrown once. The seed fixes when
   * the first window opens and how long each one lasts; from there it alternates
   * on and off for the rest of the run, so a twin seed has a rhythm rather than
   * a one-way difficulty cliff.
   *
   * Turning it *on* cannot simply happen: the walls in flight were built for one
   * cursor, and mirroring the world underneath them would drop the second cursor
   * straight into a wall. So arming stops the spawner one wall-flight early (see
   * maybeSpawn) and the flip clears whatever is left. Turning it *off* is free —
   * a field built for two cursors is trivially passable by one — so that
   * transition is seamless and needs no drain.
   */
  maybeTwin(dt) {
    if (!this.twinSeed || this.twinAt == null || this.twinNext == null) return;

    if (!this.twin) {
      // Arm ahead of the opening so the field is nearly drained when it lands.
      if (!this.twinPending) {
        const lead = this.spawnDist / Math.max(1, this.speed);
        if (this.t < this.twinNext - lead) return;
        this.twinPending = true;
        this.twinTimer = 0;
        return;
      }
      this.twinTimer += dt;
      // Never early: the seeded second is a contract, so everyone meets the
      // second cursor together. Clearing the last few walls is a gift, not a
      // hazard, which is why this does not wait for a clear board.
      if (this.t < this.twinNext) return;
      this.openTwin();
      return;
    }

    if (this.t < this.twinNext) return;
    this.closeTwin();
  }

  openTwin() {
    this.twin = true;
    this.twinPending = false;
    this.twinNext = this.t + this.twinFor;
    this.retireWalls();
    this.lastExit = null;
    this.frontier = -Infinity;
    // Twin needs an even side count to mirror onto. If the arena is odd right
    // now, take it back to the default hexagon rather than mirroring badly.
    if (!twinPossible(this.sides)) {
      this.morphFrom = this.sides;
      this.geom = geometryFor(DEFAULT_SIDES);
      this.morph = 0;
    }
    this.shiftPending = 0;
    this.player.angle = mod(this.player.angle, TAU);
    this.twinFlash = TWIN_CUE;
    this.cam.flash = 0.45;
    this.burstCursor(this.player.angle + Math.PI);
    this.hooks.onTwin?.(true);
  }

  /**
   * Your odds of clearing the next ring, 0..1 — measured, not guessed.
   *
   * It is a straight race. The ring lands in `t` seconds; the nearest opening
   * will by then have drifted to a known angle; you can cover exactly
   * `playerSpeed * t` radians before it arrives. 1 means you get there in time.
   * Below 1 means the wall arrives first and no amount of skill in the next
   * 300ms changes that. All of it is in radians, so it holds on a triangle
   * exactly as well as on an octagon.
   */
  escapeOdds() {
    let nearest = Infinity;
    for (const w of this.walls) {
      if (w.dist > this.orbit && w.dist < nearest) nearest = w.dist;
    }
    if (!isFinite(nearest)) return 1; // nothing incoming

    const t = (nearest - this.orbit) / Math.max(1, this.speed);
    // A ring this close is already decided: you are either threading it or you
    // are not, and bullet time cannot buy back ten milliseconds. Without this
    // the estimate reads near-zero on *every* wall as it passes the cursor,
    // because the distance-to-gap-centre term stops shrinking while t does.
    if (t < RESCUE_MIN_LEAD) return 1;

    const n = this.sides;
    const blocked = new Set();
    let phase = 0;
    let spin = 0;
    for (const w of this.walls) {
      if (Math.abs(w.dist - nearest) > 6) continue;
      blocked.add(mod(w.slot, n));
      phase = w.phase;
      spin = w.spin || 0;
    }
    if (blocked.size >= n) return 0; // sealed; the spawner should never allow it

    // Where each opening will be when it *arrives*, not where it is now. Twin
    // needs no special case: symmetrize() guarantees a gap that works for one
    // cursor has a partner that works for the other.
    let needed = Infinity;
    for (let sl = 0; sl < n; sl++) {
      if (blocked.has(sl)) continue;
      const centre = (sl + 0.5) * this.step + phase + spin * t;
      needed = Math.min(needed, Math.abs(angDiff(centre, this.player.angle)));
    }
    // You have to get *inside* the gap, not to the middle of it.
    const reach = Math.max(0, needed - this.geom.halfStep * RESCUE_MARGIN);
    if (reach <= 0) return 1;

    return clamp((this.playerSpeed * t) / reach, 0, 1);
  }

  /**
   * Spend the bank on a rescue. Price and payout both scale with how hopeless
   * the spot was, so bullet time is rationed by the danger it is actually
   * rescuing you from. A bank too thin to cover the price buys a proportionally
   * shorter slowdown rather than nothing — which is what "based on how much
   * charge you have" comes to in practice: more banked, more chance.
   */
  /** Rescues spent this run. Telemetry only — the mechanic does not read it. */
  buyEscape(danger) {
    this.rescueCount = (this.rescueCount | 0) + 1;
    if (this.charges <= 0) return; // nothing banked: you are on your own
    const price = GRAZE_COST_MIN + (GRAZE_COST_MAX - GRAZE_COST_MIN) * danger;
    const paid = Math.min(price, this.charges);
    this.charges -= paid;
    this.stamina = this.charges * SECONDS_PER_CHARGE;
    this.lastEscape = { danger, price, paid };
    // Full price buys the full window; a partial payment buys its share.
    const bought = GRAZE_SLOWMO * (0.75 + 0.85 * danger) * (paid / price);
    this.autoSlow = Math.max(this.autoSlow, bought);
  }

  /**
   * Bullet time is a rescue, not a reward. Every step the game asks whether you
   * can still make the next opening, and the instant the answer is no it spends
   * charge to slow the world and hand back the time you were short of. The
   * alternative is watching you die on a wall you could not have reached.
   */
  maybeRescue(dt) {
    if (this.rescueCooldown > 0) this.rescueCooldown -= dt;
    if (this.autoSlow > 0 || this.rescueCooldown > 0 || this.charges <= 0) return;

    const odds = this.escapeOdds();
    // `rescueAt` is an instance override for the architect lab; the game itself
    // never sets it.
    if (odds >= (this.rescueAt ?? RESCUE_AT)) return;

    // Bullet time multiplies the angle you can cover before the wall lands by
    // 1 / SLOWMO_SCALE. Under about that, even this cannot save it — the charge
    // is still spent, because a slim chance beats a certainty.
    this.buyEscape(1 - odds);
    this.rescueCooldown = RESCUE_COOLDOWN;
    this.lastOdds = odds;
    this.hooks.onRescue?.(odds);
  }

  /** Closing needs no drain: one cursor can always use a two-cursor field. */
  closeTwin() {
    this.twin = false;
    this.twinPending = false;
    this.twinNext = this.t + this.twinFor; // equal off-window, then it returns
    this.twinFlash = TWIN_CUE;
    this.burstCursor(this.player.angle + Math.PI);
    this.hooks.onTwin?.(false);
  }

  requestShift(always = false) {
    // Collapsing the arena to a smaller polygon is a base mechanic, not a mode:
    // every run sometimes drops to a square or a triangle. Shift Mode only means
    // it happens at *every* phase instead of some of them.
    if (this.shiftPending) return;
    if (!always && !rng.chance(0.45)) return;
    const options = SHIFT_SHAPES.filter((n) => n !== this.sides && (!this.twin || twinPossible(n)));
    if (!options.length) return;
    this.shiftPending = rng.pick(options);
    this.shiftTimer = 0;
  }

  // --- spawning ------------------------------------------------------------

  minClearFor(travel, ringSpin = 0) {
    if (travel <= 0.01) return 24;
    const effective = this.playerSpeed - Math.abs(ringSpin);
    return travel * (this.speed / effective) * this.safety + 12;
  }

  arrivalAngles(gaps, dist, spin) {
    const drift = spin ? (spin * Math.max(0, dist - this.orbit)) / this.speed : 0;
    return gaps.map((g) => (g + 0.5) * this.step + drift);
  }

  maybeSpawn() {
    if (this.shiftPending || this.twinPending) return; // let the board drain first
    if (this.frontier > this.spawnDist) return;

    const n = this.sides;
    const tier = Math.min(this.diff.maxTier ?? 3, this.diff.baseTier + this.phase.tier);
    const pool = poolFor(tier, n);
    if (!pool.length) return;
    // Lean the day toward its character by entering its favoured patterns into
    // the draw more than once. A lean, not a lock: everything stays reachable.
    let bag = pool;
    if (bag === pool) {
      const f = this.flavour;
      if (f.favour.length) {
        bag = pool.slice();
        for (const p of pool) {
          if (f.favour.includes(p.name)) for (let k = 1; k < f.weight; k++) bag.push(p);
        }
      }
    }
    // A queued pattern is played once and cleared: the architect picks the next
    // wall, the spawner still decides where it can fairly go.
    let pattern;
    if (this.queued) {
      pattern = this.queued;
      this.queued = null;
    } else {
      pattern = rng.pick(bag);
    }
    const mirror = rng.chance(0.5);
    const rings = toRings(
      pattern.gen(n).map((w) => ({
        slot: mirror ? mod(n - 1 - w.slot, n) : mod(w.slot, n),
        dist: w.dist,
        len: w.len,
        ghost: w.ghost,
      })),
      n,
    );
    if (!rings.length) return;

    if (this.twin) symmetrize(rings, n);
    const live = rings.filter((r) => r.walls.length);
    if (!live.length) return;

    const spin = this.rollSpin(pattern);
    const offset = this.chooseOffset(live[0].gaps, spin);
    for (const r of live) {
      r.gaps = r.gaps.map((s) => mod(s + offset, n));
      for (const w of r.walls) w.slot = mod(w.slot + offset, n);
    }

    const entrySpin = Math.max(Math.abs(spin), Math.abs(this.lastExit?.spin || 0));
    let cursor = Math.max(this.spawnDist, this.frontier + 24);
    for (let i = 0; i < 3; i++) {
      const angles = this.arrivalAngles(live[0].gaps, cursor, spin);
      const travel = this.lastExit?.angles
        ? angularTravel(this.lastExit.angles, angles, this.step)
        : worstApproach(angles);
      const clear = this.minClearFor(travel, entrySpin);
      cursor = Math.max(this.spawnDist, this.frontier + clear);
    }

    for (let i = 0; i < live.length; i++) {
      const r = live[i];
      cursor = this.onBeat(cursor);
      for (const w of r.walls) {
        this.walls.push({ slot: w.slot, dist: cursor, len: w.len, phase: 0, spin, grazed: false, cleared: false, pattern: pattern.name, ghost: w.ghost });
      }
      const here = this.arrivalAngles(r.gaps, cursor, spin);
      cursor += r.len;

      const next = live[i + 1];
      if (!next) {
        this.lastExit = { angles: here, spin };
        break;
      }
      const designed = next.dist - (r.dist + r.len);
      let gap = designed;
      for (let k = 0; k < 3; k++) {
        const there = this.arrivalAngles(next.gaps, cursor + gap, spin);
        gap = Math.max(this.minClearFor(angularTravel(here, there, this.step), spin), designed);
      }
      cursor += gap;
    }

    // Breathe. Without this the next pattern follows at the minimum fair
    // spacing every single time, and the arena never actually empties.
    if (rng.chance(this.diff.restChance ?? REST_CHANCE)) {
      // Roll the distance, then clamp it to a wall-clock ceiling. Rolling in
      // seconds directly would change the shape of the distribution; clamping
      // keeps the short rests exactly as they were and only cuts the tail that
      // reads as the game having stopped.
      const units = rng.range(REST_MIN, REST_MAX);
      const ceiling = (REST_MAX_SECONDS * this.speed) / this.spawnDist;
      cursor += this.spawnDist * Math.min(units, ceiling);
    }
    this.frontier = cursor;
  }

  /**
   * Push a ring out to the next beat, so it *lands* on a transient rather than
   * whenever the spacing rule happened to allow. The player then dodges in time
   * with the track: the walls become the rhythm rather than decoration over it.
   *
   * Only ever later, never earlier — the incoming distance is already the
   * minimum that keeps the gap reachable, so rounding up preserves fairness by
   * construction. With no beat detected yet (muted, still loading, a track with
   * no clear pulse) the hook returns the time unchanged and spacing is exactly
   * what it always was.
   */
  onBeat(dist) {
    if (!this.hooks.quantize) return dist;
    const speed = Math.max(1, this.speed);
    const arrival = (dist - this.orbit) / speed;
    if (arrival <= 0) return dist;
    const snapped = this.hooks.quantize(arrival);
    if (!(snapped > arrival)) return dist;
    // Never let a single snap open an absurd hole if the estimate is off.
    const capped = Math.min(snapped, arrival + BEAT_SNAP_MAX);
    return this.orbit + capped * speed;
  }

  rollSpin(pattern) {
    if (!pattern.spinnable) return 0;
    const warmedUp = this.diff.baseTier >= 2 || this.t > (this.diff.ringSpinFrom ?? 6);
    if (!warmedUp || !rng.chance(this.diff.ringSpinChance ?? 0.45)) return 0;
    const cap = this.playerSpeed * RING_SPIN_FRACTION;
    return rng.sign() * rng.range(cap * 0.45, cap);
  }

  chooseOffset(gaps, spin) {
    const n = this.sides;
    if (!this.lastExit || !gaps.length) return rng.int(n);
    const guess = Math.max(this.spawnDist, this.frontier + 140);
    const scored = [];
    let best = Infinity;
    for (let off = 0; off < n; off++) {
      const angles = this.arrivalAngles(gaps.map((s) => mod(s + off, n)), guess, spin);
      const need = angularTravel(this.lastExit.angles, angles, this.step);
      scored.push({ off, need });
      if (need < best) best = need;
    }
    return rng.pick(scored.filter((s) => s.need <= best + this.step)).off;
  }

  // --- collision + grazing -------------------------------------------------

  /**
   * The cursor rides the arena's polygon, not a circle around it — it slides
   * along each face at a constant height, exactly as the original's does. That
   * makes `orbit` a plain radial position on the same scale walls use, so a wall
   * reaches you at `dist === orbit` no matter where you are within a slot.
   *
   * It used to orbit a true circle, which needed a cos correction here and left
   * the cursor visually swinging away from the arena mid-face: 1.28x on a
   * hexagon, but 2.05x on a triangle, which is what made triangles feel wrong.
   */
  hitsWall(angle) {
    const a = mod(angle, TAU);
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      if (w.dist > this.orbit * 1.3) continue;
      const psi = angDiff(a, (w.slot + 0.5) * this.step + w.phase);
      if (Math.abs(psi) >= this.geom.halfStep) continue;
      if (this.orbit > w.dist - COLLIDE_PAD && this.orbit < w.dist + lethalDepth(w)) {
        // Kept for telemetry: a death that cannot name its cause tells you when
        // the game is too hard but never which part of it to change.
        this.lastHit = w;
        return true;
      }
    }
    return false;
  }

  /**
   * A graze is passing a wall that is level with you by a hair. Counted once per
   * wall, and only while it is actually alongside — you cannot farm it by
   * loitering in open space.
   */
  scoreGrazes(dt) {
    const g = this.graze;
    g.timer -= dt;
    if (g.timer <= 0 && g.chain > 0) {
      g.chain = 0;
      g.timer = 0;
    }
    const cursors = this.twin ? [this.player.angle, this.player.angle + Math.PI] : [this.player.angle];
    for (const w of this.walls) {
      if (w.grazed) continue;
      // Only around the face that could actually have killed you. Shaving the
      // flank of a wall that is already being absorbed is not a near miss —
      // there was nothing to miss.
      if (w.dist > this.orbit + 6 || w.dist + lethalDepth(w) < this.orbit - 6) continue;
      let closest = Infinity;
      for (const c of cursors) {
        const psi = angDiff(mod(c, TAU), (w.slot + 0.5) * this.step + w.phase);
        closest = Math.min(closest, Math.abs(psi) - this.geom.halfStep);
      }
      if (closest >= 0 && closest < GRAZE_WINDOW) {
        w.grazed = true;
        g.chain = Math.min(GRAZE_MAX_CHAIN, g.chain + 1);
        g.best = Math.max(g.best, g.chain);
        g.total++;
        g.timer = GRAZE_DECAY;
        g.flash = 1;
        this.hooks.onGraze?.(g.chain);
      }
    }
  }

  // --- phases, ranks, the break -------------------------------------------

  applyPhase(index, silent = false) {
    if (index === this.phaseIndex && !silent) return;
    this.phaseIndex = index;
    const p = PHASES[index];
    this.targetHue = this.diff.hue + p.hue;
    this.hooks.onPhase?.(p, silent);
    if (!silent) {
      this.cam.flash = 0.9;
      this.cam.invert = 0.3;
      this.rankName = p.name;
      this.rankFlash = 1.8;
      this.requestShift(this.shiftMode);
    }
  }

  checkRank() {
    let next = RANKS[this.rankIndex + 1];
    while (next && this.t >= next.t) {
      this.rankIndex++;
      this.markReached(next.t);
      next = RANKS[this.rankIndex + 1];
    }
    const wantPhase = phaseFor(this.t);
    if (wantPhase !== this.phaseIndex) this.applyPhase(wantPhase);
    if (!this.broken && this.t >= WIN_AT) this.breakMachine();
  }

  /** Record how far this run actually got, for practice entry points. */
  markReached(seconds) {
    if (this.demo || this.practice || this.assisted || this.tutorial) return;
    const id = this.diff.id;
    if ((this.reached[id] || 0) >= seconds) return;
    this.reached[id] = seconds;
    writeJSON(REACHED_KEY, this.reached);
  }

  /** 60 seconds is the win. It is not the end. */
  breakMachine() {
    this.broken = true;
    this.cam.flash = 1;
    this.cam.invert = 1;
    this.rankName = 'YOU WON · KEEP GOING';
    this.rankFlash = 3;
    const child = DIFFICULTIES.find((d) => d.unlockedBy === this.diff.id);
    if (!this.practice && child && !this.unlocked.has(this.diff.id)) {
      this.unlocked.add(this.diff.id);
      writeJSON(UNLOCK_KEY, [...this.unlocked]);
      this.justUnlocked = child.name;
    }
    this.hooks.onBreak?.(child);
  }

  die(quiet = false) {
    if (this.state !== 'play') return;
    this.state = 'dead';
    this.paused = false;
    this.deathT = 0;
    this.cam.shake = 1;
    this.cam.flash = 1;
    this.burstCursor();
    this.newRecord = false;
    // The autopilot demo plays every stage past 60s. Letting it write records
    // handed out best times, badges, daily attempts and practice entry points
    // to a player who had not played a single run.
    if (!this.practice && !this.demo && !this.tutorial) {
      if (this.t > this.best) {
        this.best = this.t;
        this.newRecord = true;
        saveBest(this.diff.id, this.twinSeed, this.t);
      }
      if (this.daily) this.recordDaily();
      if (this.t >= 30) this.award('thirty');
      if (this.t >= WIN_AT) {
        this.award('finish');
        if (!this.assisted) this.award('clean');
      }
      if (this.graze.total >= 25) this.award('graze25');
      // Only an unassisted daily run can go to the board.
      if (this.daily && !this.assisted && this.t > 0) {
        this.pendingSubmit = { date: this.dateKey, t: this.t };
        this.hooks.onScore?.(this.pendingSubmit);
      }
    }
    if (!quiet) this.hooks.onDeath?.(this.t);
  }

  /** The cursor does not simply vanish — it comes apart. */
  burstCursor(at = null) {
    const cursors = at != null
      ? [at]
      : this.twin ? [this.player.angle, this.player.angle + Math.PI] : [this.player.angle];
    for (const a of cursors) {
      for (let i = 0; i < 26; i++) {
        const spread = a + rng.range(-0.7, 0.7);
        const speed = rng.range(40, 260);
        this.particles.push({
          x: Math.cos(a) * this.orbit,
          y: Math.sin(a) * this.orbit,
          vx: Math.cos(spread) * speed,
          vy: Math.sin(spread) * speed,
          life: rng.range(0.4, 1.1),
          age: 0,
          size: rng.range(1.4, 4.2),
        });
      }
    }
  }

  /**
   * Walls that have to go — a reshape or a twin window opening — dissolve rather
   * than vanish. They keep travelling and fade out over a few frames, carrying
   * the side count they were built for so they are still drawn correctly while
   * the arena morphs underneath them. They cannot be hit while fading.
   */
  retireWalls() {
    for (const w of this.walls) {
      this.fading.push({
        slot: w.slot, phase: w.phase, dist: w.dist, len: w.len,
        spin: w.spin, step: this.morphFrom ? TAU / this.morphFrom : this.step,
        age: 0, life: RETIRE_FADE,
      });
    }
    this.walls.length = 0;
  }

  updateFading(dt, v) {
    const fs = this.fading;
    let n = 0;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      f.age += dt;
      f.dist -= v;
      if (f.spin && !this.absorbed(f)) f.phase += f.spin * dt;
      if (f.age < f.life) fs[n++] = f;
    }
    fs.length = n;
  }

  updateParticles(dt) {
    const ps = this.particles;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.6 * dt;
      ps[n++] = p;
    }
    ps.length = n;
  }

  // --- daily ---------------------------------------------------------------

  recordDaily() {
    const key = dailyKey();
    const all = readJSON(DAILY_KEY, {});
    const entry = all[key] || { attempts: 0, best: 0 };
    entry.attempts++;
    entry.best = Math.max(entry.best, Math.round(this.t * 100) / 100);
    all[key] = entry;
    writeJSON(DAILY_KEY, all);
  }

  dailyBoard() {
    const all = readJSON(DAILY_KEY, {});
    return Object.entries(all)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 7)
      .map(([date, v]) => ({ date, ...v }));
  }

  // --- cosmetics -----------------------------------------------------------

  updateCosmetics(dt) {
    const travelled = angDiff(this.player.angle, this.player.prevAngle);
    const maxStep = this.playerSpeed * FIXED_DT * (this.slowing ? SLOWMO_AGILITY : 1);
    const target = this.state === 'play' && maxStep > 0 ? clamp(travelled / maxStep, -1, 1) : 0;
    this.lean += (target - this.lean) * Math.min(1, dt * 14);

    this.hue += angDiffDeg(this.targetHue, this.hue) * Math.min(1, dt * 2.5);
    // A slow shimmer on top of the phase colour, so the palette is never static.
    this.shimmer = this.state === 'play'
      ? HUE_SHIMMER * Math.sin((this.t / HUE_SHIMMER_PERIOD) * TAU)
      : 0;
    this.cam.flash = Math.max(0, this.cam.flash - dt * 3.2);
    this.cam.shake = Math.max(0, this.cam.shake - dt * 2.4);
    this.rankFlash = Math.max(0, this.rankFlash - dt);
    this.graze.flash = Math.max(0, this.graze.flash - dt * 4);
    this.twinFlash = Math.max(0, this.twinFlash - dt);
    this.morph = Math.min(1, this.morph + dt * 2.2);

    // Pulse Mode breathes the arena with the track. Obstacles are untouched —
    // what changes is how much room you have to read them.
    const wantScale = this.pulseMode && this.state === 'play'
      ? 1 + PULSE_AMPLITUDE * (this.pulse - 0.5) * 2
      : 1;
    this.orbitScale += (wantScale - this.orbitScale) * Math.min(1, dt * 12);

    let invertFloor = 0;
    if (this.state === 'play' && !this.broken && this.t > WIN_AT - 6) {
      const k = (this.t - (WIN_AT - 6)) / 6;
      invertFloor = k * 0.5 * (0.5 + 0.5 * Math.sin(this.t * (8 + 26 * k)));
    } else if (this.broken && this.state === 'play') {
      invertFloor = 0.18 + 0.12 * Math.sin(this.t * 5);
    }
    this.cam.invert = Math.max(invertFloor, this.cam.invert - dt * 1.6);

    const punch = this.state === 'dead' ? 0.5 * Math.exp(-this.deathT * 6) : 0;
    const phaseZoom = this.state === 'play' ? this.phase.zoom : 1;
    this.cam.zoom = clamp(phaseZoom + PULSE_ZOOM * this.pulse + punch, 1, 2.4);
  }
}

/** How deep into a wall is still lethal: its leading face, never its whole body. */
function lethalDepth(w) {
  return Math.min(w.len, KILL_DEPTH) + COLLIDE_PAD;
}

function phaseFor(t) {
  let i = 0;
  for (let k = 0; k < PHASES.length; k++) if (t >= PHASES[k].t) i = k;
  return i;
}

function toRings(walls, n) {
  const byDist = new Map();
  for (const w of walls) {
    const key = Math.round(w.dist);
    let r = byDist.get(key);
    if (!r) byDist.set(key, (r = { dist: key, len: 0, walls: [] }));
    r.walls.push(w);
    r.len = Math.max(r.len, w.len);
  }
  const rings = [...byDist.values()].sort((a, b) => a.dist - b.dist);
  for (const r of rings) {
    const blocked = new Set(r.walls.map((w) => w.slot));
    r.gaps = [];
    for (let s = 0; s < n; s++) if (!blocked.has(s)) r.gaps.push(s);
  }
  return rings;
}

/**
 * Collapse a pattern onto the 180°-symmetric field twin mode needs: every
 * opening is duplicated to the slot opposite it, so one cursor's gap is always
 * the other's too. Requires an even side count, which the shift picker enforces.
 */
function symmetrize(rings, n) {
  const half = twinHalf(n);
  for (const r of rings) {
    const gaps = new Set();
    for (const s of r.gaps) {
      const h = mod(s, half);
      gaps.add(h);
      gaps.add(h + half);
    }
    r.gaps = [...gaps].sort((a, b) => a - b);
    r.walls = r.walls.filter((w) => !gaps.has(w.slot));
    r.len = r.walls.reduce((m, w) => Math.max(m, w.len), 0);
  }
}

/** Worst-case angle from any opening in `from` to some opening in `to`. */
/**
 * The furthest any player angle can be from the nearest opening.
 *
 * With no previous exit to measure from — the first ring of a run, or the first
 * after the arena reshapes — the cursor may be anywhere, so the worst case is
 * the middle of the widest arc between two gaps. `angularTravel` fell back to a
 * single slot width, which quietly assumed the player was already nearly in
 * position: survivable at two shape changes a run, and not at seven.
 */
function worstApproach(angles) {
  if (!angles || !angles.length) return Math.PI;
  const sorted = angles.map((a) => mod(a, TAU)).sort((x, y) => x - y);
  let widest = 0;
  for (let i = 0; i < sorted.length; i++) {
    let arc = sorted[(i + 1) % sorted.length] - sorted[i];
    if (arc <= 0) arc += TAU;
    if (arc > widest) widest = arc;
  }
  return widest / 2;
}

function angularTravel(from, to, step) {
  if (!from || !from.length || !to || !to.length) return step;
  let worst = 0;
  for (const a of from) {
    let closest = Infinity;
    for (const b of to) closest = Math.min(closest, Math.abs(angDiff(a, b)));
    worst = Math.max(worst, closest);
  }
  return worst;
}

function angDiffDeg(target, current) {
  let d = (target - current) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
