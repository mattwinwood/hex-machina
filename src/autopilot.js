// Autopilot: a demo that plays the whole game by itself. Typing 777 starts it.
//
// It exists to exercise the entire surface in one sitting — every stage, the
// redline handover, twin mode, pause/resume, death and
// retry — so a change can be eyeballed end to end rather than one screen at a
// time. The steering brain is the same greedy "walk to the nearest opening"
// policy used to prove pattern fairness, so it does not die of bad luck.

import { TAU, DIFFICULTIES, angDiff } from './config.js';

const SAMPLES = 360; // angular resolution of the safety scan
const MARGIN = 0.10; // clearance that qualifies an angle as inside a gap
const DEADBAND = 0.05; // stop steering once this close to the target

export class Autopilot {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.label = '';
    this.queue = [];
    this.task = null;
    this.taskT = 0;
    this.scratch = {};
  }

  start() {
    this.active = true;
    this.queue = this.buildTour();
    this.task = null;
    this.taskT = 0;
    this.game.demo = true;
  }

  stop() {
    this.active = false;
    this.task = null;
    this.queue.length = 0;
    this.label = '';
    this.game.demo = false;
  }

  /**
   * The tour. Base stages are played to 62s so each one redlines and unlocks its
   * counterpart; the unlocked stages then get a shorter showing.
   */
  buildTour() {
    const q = [];
    const base = ['spark', 'forge', 'crucible'];
    const hyper = ['flare', 'furnace', 'meltdown'];

    q.push(this.wait('STARTING DEMO', 1.4));
    base.forEach((id, i) => {
      q.push(this.select(id, false));
      q.push(
        this.play(`${id.toUpperCase()} — TO REDLINE`, 62, {
          pauseAt: i === 0 ? 20 : null, // demonstrate pause once
        }),
      );
      q.push(this.toMenu(1.0));
    });

    hyper.forEach((id) => {
      q.push(this.select(id, false));
      q.push(this.play(`${id.toUpperCase()}`, 22));
      q.push(this.toMenu(1.0));
    });

    q.push(this.select('spark', true));
    q.push(this.play('TWIN MODE', 24));
    q.push(this.toMenu(1.0));

    // Finish by dying on purpose so the game-over screen and retry are covered.
    q.push(this.select('forge', false));
    q.push(this.play('DELIBERATE DEATH — GAME OVER SCREEN', 10, { dieAt: 7 }));
    q.push(this.wait('GAME OVER', 3.2));
    q.push(this.retry());
    q.push(this.play('RETRY WORKS', 8, {}));
    q.push(this.toMenu(1.2));
    q.push(this.wait('DEMO COMPLETE', 3));
    return q;
  }

  // --- task builders --------------------------------------------------------

  wait(label, seconds) {
    return { label, enter: () => {}, tick: (t) => t >= seconds };
  }

  select(id, twin) {
    return {
      label: `SELECT ${id.toUpperCase()}${twin ? ' — TWIN' : ''}`,
      enter: (g) => {
        if (g.state !== 'menu') g.toMenu();
        g.unlocked.add('spark');
        g.unlocked.add('forge');
        g.unlocked.add('crucible');
        const i = DIFFICULTIES.findIndex((d) => d.id === id);
        if (i >= 0) g.diffIndex = i;
        g.twinSeed = twin;
        g.twinAt = twin ? 8 : null; // the demo should not wait 15s to show it off
        g.twinFor = 10;
        g.hue = g.targetHue = g.diff.hue;
      },
      tick: (t) => t >= 0.7,
    };
  }

  play(label, seconds, opts = {}) {
    return {
      label,
      opts,
      play: true,
      enter: (g) => g.start(),
      tick: (t, g) => g.state !== 'play' || g.t >= seconds,
    };
  }

  retry() {
    return {
      label: 'RETRY',
      enter: (g) => g.action(),
      tick: (t, g) => g.state === 'play' || t > 1.5,
    };
  }

  toMenu(pause) {
    return {
      label: 'BACK TO MENU',
      enter: (g) => g.toMenu(),
      tick: (t) => t >= pause,
    };
  }

  // --- per-frame driving ----------------------------------------------------

  /** Returns the input the game should use this frame. */
  update(dt) {
    if (!this.active) return { dir: 0 };
    const g = this.game;

    if (!this.task) {
      if (!this.queue.length) {
        this.stop();
        return { dir: 0 };
      }
      this.task = this.queue.shift();
      this.taskT = 0;
      this.scratch = {}; // per-task scratch, so set pieces fire exactly once
      this.label = this.task.label;
      this.task.enter?.(g);
    }

    this.taskT += dt;
    let input = { dir: 0 };

    if (this.task.play && g.state === 'play') {
      input = this.drive(dt);
    }

    if (this.task.tick(this.taskT, g)) {
      this.task = null;
    }
    return input;
  }

  /** Steering, plus the scripted set pieces for a play task. */
  drive(dt) {
    const g = this.game;
    const o = this.task.opts || {};

    // Scripted pause: hold for a beat, then resume. `pauseDone` latches so the
    // resume cannot immediately re-trigger the pause and stall the tour.
    const sc = this.scratch;
    if (o.pauseAt != null && !sc.pauseDone && g.t >= o.pauseAt) {
      if (!sc.pauseStarted) {
        sc.pauseStarted = true;
        sc.pauseUntil = this.taskT + 2.0;
        g.togglePause();
      } else if (this.taskT >= sc.pauseUntil) {
        sc.pauseDone = true;
        if (g.paused) g.togglePause();
      }
      if (g.paused) return { dir: 0 };
    }

    // Scripted death: stand still in front of a wall until it lands.
    if (o.dieAt != null && g.t >= o.dieAt) return { dir: 0 };

    // Nothing to schedule any more: bullet time is not an input, so the demo
    // meets it the same way a player does — by shaving a wall.
    return { dir: this.steer() };
  }

  /**
   * Aim for the *centre* of the nearest safe gap, not merely the nearest safe
   * angle. Hugging a gap's edge is what kills a greedy policy once the slack
   * margin drops to its floor on the hardest stages, because any drift or
   * rotation eats the little clearance that is left.
   */
  steer() {
    const g = this.game;
    let best = Infinity;
    for (const w of g.walls) if (w.dist + w.len > g.orbit + 2) best = Math.min(best, w.dist);
    if (!isFinite(best)) return 0;

    const band = [];
    for (const w of g.walls) if (w.dist < best + 20) band.push(w);
    if (!band.length) return 0;

    const tta = Math.max(0, (best - g.orbit) / g.speed);
    const centres = band.map((w) => (w.slot + 0.5) * g.step + (w.phase || 0) + (w.spin || 0) * tta);

    // Mark every sampled angle that clears the whole band.
    const safe = new Uint8Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * TAU;
      let clear = Infinity;
      for (const c of centres) {
        clear = Math.min(clear, Math.abs(angDiff(a, c)) - g.step / 2);
        if (g.twin) clear = Math.min(clear, Math.abs(angDiff(a + Math.PI, c)) - g.step / 2);
        if (clear < MARGIN) break;
      }
      safe[i] = clear >= MARGIN ? 1 : 0;
    }

    // Collect contiguous safe runs, joining across the wrap point.
    const runs = [];
    let i = 0;
    while (i < SAMPLES) {
      if (!safe[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < SAMPLES && safe[j]) j++;
      runs.push([i, j - 1]);
      i = j;
    }
    if (!runs.length) return 0;
    if (runs.length > 1 && safe[0] && safe[SAMPLES - 1]) {
      const first = runs.shift();
      runs[runs.length - 1][1] = first[1] + SAMPLES; // unwrap onto the tail
    }

    let target = null;
    let bestScore = Infinity;
    for (const [lo, hi] of runs) {
      const mid = ((lo + hi) / 2) % SAMPLES;
      const a = (mid / SAMPLES) * TAU;
      const score = Math.abs(angDiff(a, g.player.angle));
      if (score < bestScore) { bestScore = score; target = a; }
    }
    if (target == null) return 0;
    const d = angDiff(target, g.player.angle);
    if (Math.abs(d) < DEADBAND) return 0;
    return d > 0 ? 1 : -1;
  }
}
