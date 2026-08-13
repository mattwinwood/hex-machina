// Keyboard + pointer input. Steering reports the most recently pressed
// direction, so tapping the opposite key reverses instantly. Steering is all
// this does: slow motion is no longer a gesture, it is earned by near misses
// and applied by the simulation.

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const ACTION_KEYS = new Set(['Space']);
// Enter pauses mid-run and confirms everywhere else, so it reads as one key
// with one meaning: "interrupt what is happening".
const PAUSE_KEYS = new Set(['Enter', 'NumpadEnter', 'KeyP', 'Pause']);
const CHEAT = '777';

/**
 * True when a real form control owns the keyboard — the leaderboard name entry,
 * mainly. The game listens on `window` and preventDefaults arrows, space and
 * Enter, and maps bare letters to mute / day / mode toggles, so without this
 * guard typing a name both failed to type and fired half the game's shortcuts.
 */
function typingInAField(e) {
  const el = e.target;
  if (!el || el === window || el === document || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON'
    || el.isContentEditable === true;
}

export class Input {
  constructor(target, handlers = {}) {
    this.handlers = handlers;
    this.stack = []; // -1 / +1 in press order
    this.pointers = new Map();
    this.typed = ''; // rolling buffer for the cheat code

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.releaseAll());

    target.addEventListener('pointerdown', (e) => this.onPointerDown(e, target));
    target.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: true });
    target.addEventListener('pointerup', (e) => this.onPointerUp(e));
    target.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    this.target = target;
  }

  get dir() {
    return this.stack.length ? this.stack[this.stack.length - 1] : 0;
  }

  releaseAll() {
    this.stack.length = 0;
    this.pointers.clear();
  }

  press(d) {
    if (!this.stack.includes(d)) this.stack.push(d);
  }

  release(d) {
    const i = this.stack.indexOf(d);
    if (i >= 0) this.stack.splice(i, 1);
  }

  onKeyDown(e) {
    if (typingInAField(e)) return; // the field gets every key, untouched
    this.handlers.inputMode?.(false); // a real key press means: speak in keys
    if (!e.repeat && this.trackCheat(e)) return;
    if (this.handlers.demoActive?.()) {
      this.handlers.stopDemo?.(); // any key drops out of the autopilot
      return;
    }
    if (e.repeat) {
      if (LEFT_KEYS.has(e.code) || RIGHT_KEYS.has(e.code) || ACTION_KEYS.has(e.code)) e.preventDefault();
      return;
    }
    if (LEFT_KEYS.has(e.code)) {
      this.press(-1);
      e.preventDefault();
    } else if (RIGHT_KEYS.has(e.code)) {
      this.press(1);
      e.preventDefault();
    } else if (ACTION_KEYS.has(e.code)) {
      this.handlers.action?.();
      e.preventDefault();
    } else if (PAUSE_KEYS.has(e.code)) {
      this.handlers.pause?.();
      e.preventDefault();
    } else if (e.code === 'Escape') {
      this.handlers.back?.();
    } else if (e.code === 'KeyM') {
      this.handlers.mute?.();
    } else if (e.code === 'KeyT') {
      this.handlers.twin?.();
    } else if (e.code === 'KeyU') {
      this.handlers.mode?.('pulse');
    } else if (e.code === 'KeyH') {
      this.handlers.mode?.('shift');
    } else if (e.code === 'KeyY') {
      this.handlers.mode?.('daily');
    } else if (UP_KEYS.has(e.code)) {
      this.handlers.cycle?.(-1);
      e.preventDefault();
    } else if (DOWN_KEYS.has(e.code)) {
      this.handlers.cycle?.(1);
      e.preventDefault();
    }
  }

  /** Rolling buffer so typing 777 anywhere fires the demo. */
  trackCheat(e) {
    if (!/^Digit\d$|^Numpad\d$/.test(e.code)) {
      if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') this.typed = '';
      return false;
    }
    this.typed = (this.typed + e.code.slice(-1)).slice(-CHEAT.length);
    if (this.typed === CHEAT) {
      this.typed = '';
      this.handlers.cheat?.();
      return true;
    }
    return true; // digits never fall through to gameplay
  }

  onKeyUp(e) {
    if (typingInAField(e)) return;
    if (LEFT_KEYS.has(e.code)) this.release(-1);
    else if (RIGHT_KEYS.has(e.code)) this.release(1);
  }

  /** Which half of the canvas a point falls in. Measured off the element, not
   *  the window, so it stays right if the canvas is ever inset or letterboxed. */
  sideOf(clientX) {
    const r = this.target.getBoundingClientRect();
    return clientX < r.left + r.width / 2 ? -1 : 1;
  }

  onPointerDown(e, target) {
    this.handlers.inputMode?.(e.pointerType === 'touch' || e.pointerType === 'pen');
    // Capture keeps a drag alive outside the canvas, but it is optional — never
    // let it throw and take the rest of the tap handling down with it.
    try {
      target.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already gone */
    }

    // Buttons win over everything, including steering.
    const control = this.handlers.hitControl?.(e.clientX, e.clientY);
    if (control) {
      this.handlers.control?.(control);
      e.preventDefault();
      return;
    }

    if (this.handlers.demoActive?.()) {
      this.handlers.stopDemo?.();
      e.preventDefault();
      return;
    }

    // Before steering: while the tutorial is up every tap is a direction, so a
    // tap on SKIP would otherwise just advance the lesson it was trying to leave.
    if (this.handlers.skipTutorial?.(e.clientX, e.clientY)) {
      e.preventDefault();
      return;
    }

    if (this.handlers.steering?.()) {
      const d = this.sideOf(e.clientX);
      this.pointers.set(e.pointerId, d);
      this.press(d);
    } else {
      this.handlers.action?.(e.clientX, e.clientY);
    }
    e.preventDefault();
  }

  /** Let a held finger slide across the midline and have the cursor follow. */
  onPointerMove(e) {
    const old = this.pointers.get(e.pointerId);
    if (old === undefined) return;
    const d = this.sideOf(e.clientX);
    if (d === old) return;
    this.pointers.set(e.pointerId, d);
    if (![...this.pointers.values()].includes(old)) this.release(old);
    if (!this.stack.includes(d)) this.stack.push(d);
  }

  onPointerUp(e) {
    const d = this.pointers.get(e.pointerId);
    if (d !== undefined) {
      this.pointers.delete(e.pointerId);
      if (![...this.pointers.values()].includes(d)) this.release(d);
    }
  }
}
