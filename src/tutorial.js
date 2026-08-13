// First-run tutorial. Not a separate mode — this is the real game, held still
// between lessons so there is time to read, and released the moment the player
// does the thing being described.
//
// Every step is advanced by *performing* the control rather than by tapping a
// "next" button: the only way past the orbit lesson is to orbit. That way the
// tutorial cannot be clicked through without learning anything.

const KEY = 'dailyhex.tutorial';

// Shown above the lesson when a run has already ended badly. Escalating, and
// meant to be funny rather than discouraging — the joke is the game's patience,
// not the player's competence.
const SNARK = [
  '',
  'Right. Again.',
  'Again. The gap is the part with no wall.',
  'Take your time. Genuinely. No rush.',
  'I have nothing but time. Evidently, so do you.',
  'We can keep doing this. I am not going anywhere.',
  'At this point I am invested.',
];

const STEPS = [
  {
    id: 'orbit',
    title: 'ORBIT',
    touch: 'Hold the left or right side of the screen. Your cursor runs around the outside of the hexagon.',
    keys: 'Hold the left or right arrow key. Your cursor runs around the outside of the hexagon.',
    hint: { touch: 'HOLD EITHER SIDE TO BEGIN', keys: 'HOLD ← OR → TO BEGIN' },
    // An empty arena, so the very first thing anyone does here is move without
    // being punished for it.
    empty: true,
    // Long enough to have gone right round and felt it, not just twitched: a
    // rotation threshold alone was satisfied in 0.28s.
    done: (t) => t.turned > 5 && t.sinceResume > 1.4,
  },
  {
    id: 'gap',
    title: 'FIND THE GAP',
    touch: 'Every wall has one opening. Get to it before the wall gets to you.',
    keys: 'Every wall has one opening. Get to it before the wall gets to you.',
    hint: { touch: 'CLEAR TWO WALLS', keys: 'CLEAR TWO WALLS' },
    done: (t) => t.cleared >= 2,
  },
  {
    id: 'charges',
    title: 'BULLET TIME',
    touch: 'The ring inside the hexagon is your charge. When you can no longer reach the next gap, the game spends one and slows the world down to give you the room. There is no button for it.',
    keys: 'The ring inside the hexagon is your charge. When you can no longer reach the next gap, the game spends one and slows the world down to give you the room. There is no button for it.',
    hint: { touch: 'HOLD A SIDE TO CARRY ON', keys: 'HOLD A DIRECTION TO CARRY ON' },
    pointAtCore: true,
    done: (t) => t.sinceResume > 1.2,
  },
  {
    id: 'go',
    title: "THAT'S EVERYTHING",
    touch: 'Survive 60 seconds. The walls land on the beat, so listen as much as you look.',
    keys: 'Survive 60 seconds. The walls land on the beat, so listen as much as you look.',
    hint: { touch: 'HOLD A SIDE TO PLAY', keys: 'HOLD A DIRECTION TO PLAY' },
    done: (t) => t.sinceResume > 0.4,
  },
];

/** Has this browser already learned, or clearly been here before? */
export function tutorialNeeded() {
  try {
    if (localStorage.getItem(KEY)) return false;
    // Someone who was already playing before this existed should not be sent
    // back to school. Any real history counts.
    if (JSON.parse(localStorage.getItem('dailyhex.played') || '[]').length) return false;
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('dailyhex.best') && parseFloat(localStorage.getItem(k)) > 0) return false;
    }
    return true;
  } catch {
    return false; // no storage: never nag
  }
}

function markDone() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ done: 1, at: Date.now() }));
  } catch {
    /* nothing persists; they may see it again, which is the safe direction */
  }
}

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.index = 0;
    this.waiting = false; // held still, showing a card
    this.deaths = 0;
    this.turned = 0;
    this.cleared = 0;
    this.sinceResume = 0;
    this.lastAngle = 0;
    this.seen = new Set();
    this.deadFor = 0;
  }

  get step() {
    return STEPS[this.index];
  }

  begin() {
    this.active = true;
    this.index = 0;
    this.deaths = 0;
    this.game.tutorial = true;
    this.arm();
  }

  /** Hold the world still and put the current lesson on screen. */
  arm() {
    this.waiting = true;
    this.turned = 0;
    this.cleared = 0;
    this.sinceResume = 0;
    this.seen = new Set();
    this.game.paused = true;
    this.publish();
  }

  resume() {
    this.waiting = false;
    this.sinceResume = 0;
    // Clear on the way out too, or the frame that releases the hold still shows
    // the walls that were on screen when it was armed.
    if (this.step.empty) {
      this.game.walls.length = 0;
      this.game.fading.length = 0;
      this.game.frontier = this.game.spawnDist * 2;
    }
    this.lastAngle = this.game.player.angle;
    this.game.paused = false;
    this.publish();
  }

  next() {
    this.index++;
    if (this.index >= STEPS.length) return this.finish();
    this.arm();
  }

  finish() {
    this.active = false;
    this.waiting = false;
    this.game.paused = false;
    this.game.tutorial = false;
    this.game.teach = null;
    markDone();
  }

  skip() {
    if (!this.active) return;
    this.finish();
  }

  /** What the renderer draws. Kept as plain data so render.js owns no state. */
  publish() {
    const s = this.step;
    this.game.teach = s && {
      id: s.id,
      title: s.title,
      touch: s.touch,
      keys: s.keys,
      hint: s.hint,
      pointAtCore: !!s.pointAtCore,
      snark: SNARK[Math.min(this.deaths, SNARK.length - 1)],
      waiting: this.waiting,
      stepNo: this.index + 1,
      stepCount: STEPS.length,
    };
  }

  /**
   * Called every frame before the simulation runs. `dir` is the player's current
   * steering input — pressing a direction is what dismisses a card, so the only
   * way forward is to use the control being taught.
   */
  update(dt, dir) {
    if (!this.active) return;
    const g = this.game;

    // Died mid-lesson: rewind to the same lesson rather than the start, and let
    // the copy get a little tired of us.
    if (g.state === 'dead') {
      this.deadFor += dt;
      if (this.deadFor > 0.9) {
        this.deadFor = 0;
        this.deaths++;
        g.start();
        this.arm();
      }
      return;
    }
    this.deadFor = 0;
    if (g.state !== 'play') return;

    if (this.waiting) {
      // Re-assert every frame rather than setting it once: game.start() clears
      // `paused`, so a hold armed before a run finished loading was silently
      // dropped and the player watched themselves die during the lesson.
      g.paused = true;
      if (dir !== 0) this.resume();
      return;
    }

    this.sinceResume += dt;

    // Lesson one happens in an empty arena. Teaching someone to move while
    // walls are already closing in teaches them mostly to panic.
    if (this.step.empty) {
      g.walls.length = 0;
      g.fading.length = 0;
      g.frontier = g.spawnDist * 2;
    }

    // Progress toward the current lesson's goal.
    const a = g.player.angle;
    let d = a - this.lastAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.turned += Math.abs(d);
    this.lastAngle = a;

    for (const w of g.walls) {
      if (w.dist < g.orbit && !this.seen.has(w)) {
        this.seen.add(w);
        this.cleared += 1 / Math.max(1, g.sides - 1); // a whole ring, not each wall
      }
    }

    if (this.step.done(this)) this.next();
  }
}
