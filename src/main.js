// Bootstrap: canvas sizing, the RAF loop, and the wiring between input,
// simulation, renderer and audio.

import { Game } from './game.js';
import { SLOWMO_SCALE, BOARD_SIZE } from './config.js';
import { render, menuHit, deathHitMenu, deathHitPractice, deathHitAssist, controlAt, overlayHit, menuCoreScale, setTouchMode, touchMode, teachSkipHit, deathHitRelearn, invalidateFontCache } from './render.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Autopilot } from './autopilot.js';
import { Tutorial, tutorialNeeded } from './tutorial.js';
import { fetchBoard, submitScore } from './leaderboard.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const sound = new Sound();

const game = new Game({
  onPrepare: (d) => {
    sound.uiConfirm();
    return sound.prepare(game.track);
  },
  onStart: () => sound.playTrack(game.track),
  onPhase: (phase, silent) => {
    sound.setTone(phase.cutoff);
    if (silent) return;
    sound.rank();
    buzz(18);
  },
  onBreak: () => {
    sound.breakSfx();
    buzz([0, 30, 30, 30, 30, 60]);
  },
  onShift: () => {
    sound.shiftSfx();
    buzz(24);
  },
  onTwin: (on) => {
    sound.twinSfx(on);
    // Doubled pulse arriving, single pulse leaving — the haptic says which way.
    buzz(on ? [0, 40, 60, 40] : 30);
  },
  // Walls are scheduled to land on the track's transients; see Game.onBeat.
  quantize: (seconds) => sound.nextGrid(seconds),
  onGraze: (chain) => {
    sound.grazeTick(chain);
    buzz(12);
  },
  onRescue: () => {
    sound.slowSfx();
    buzz(18);
  },
  onDeath: () => {
    sound.death();
    sound.stopMusic();
    buzz([0, 45, 40, 90]);
  },
  onMenu: () => {
    sound.stopMusic();
    sound.uiBack();
    refreshBoard();
  },
  onDayChange: () => {
    game.board = null;
    game.boardError = false;
    refreshBoard(true);
  },
  onScore: (entry) => postScore(entry),
  onBadge: () => sound.rank(),
  onPause: (paused) => (paused ? sound.pauseMusic() : sound.resumeMusic()),
});

game.muted = sound.muted;
const autopilot = new Autopilot(game);
const tutorial = new Tutorial(game);

// --- leaderboard ------------------------------------------------------------
const nameEntry = document.getElementById('nameEntry');
const nameForm = document.getElementById('nameForm');
const nameInput = document.getElementById('nameInput');

// The board is polled on a timer, never per frame. It used to be refreshed from
// inside the render loop, which fired sixty overlapping fetches a second and made
// the panel strobe between "loading", "offline" and real rows.
const BOARD_POLL_MS = 90_000;
let boardFetch = null;
let boardAt = 0;

async function refreshBoard(force = false) {
  const date = game.dateKey;
  if (boardFetch) return boardFetch; // one in flight is enough
  if (!force && performance.now() - boardAt < BOARD_POLL_MS) return undefined;

  boardFetch = fetchBoard(date);
  const data = await boardFetch;
  boardFetch = null;
  boardAt = performance.now();
  if (game.dateKey !== date) return undefined; // the player moved days while we waited

  if (data) {
    game.board = data;
    game.boardError = false;
    readRank(data);
  } else {
    // Keep whatever we last showed. A dropped poll is not a reason to blank a
    // board the player was already reading.
    game.boardError = !game.board;
  }
  return undefined;
}

// Days the player was asked for a name and declined. Without this, qualifying
// for a 25-row board means a prompt on almost every death.
const SKIPPED_KEY = 'dailyhex.name-skipped';
function skippedToday(date) {
  try {
    return (JSON.parse(localStorage.getItem(SKIPPED_KEY) || '[]') || []).includes(date);
  } catch {
    return false;
  }
}
function rememberSkip(date) {
  try {
    const all = JSON.parse(localStorage.getItem(SKIPPED_KEY) || '[]') || [];
    if (!all.includes(date)) all.push(date);
    localStorage.setItem(SKIPPED_KEY, JSON.stringify(all.slice(-30)));
  } catch {
    /* not persisted; they get asked again, which is the safe direction */
  }
}

// Where you stood on the board the last time you looked, per date. Comparing
// against it is what lets the game tell you someone passed you — without any
// notification permission, any address, or knowing who you are beyond the name
// you typed.
const RANK_KEY = 'dailyhex.rank-seen';

function readSeen() {
  try {
    return JSON.parse(localStorage.getItem(RANK_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/**
 * Work out whether the board moved under you since you last saw it, and say so.
 * Names are self-chosen and unauthenticated, so this matches on the exact name
 * the server stored — good enough for a nudge, and it is never used for anything
 * that matters.
 */
function readRank(board) {
  if (!board || !board.top || !game.playerName) return;
  const idx = board.top.findIndex((r) => r.name === game.playerName);
  if (idx < 0) return; // not on the board; nothing to have lost
  const rank = idx + 1;

  const seen = readSeen();
  const prev = seen[board.date];
  if (prev != null && rank > prev) {
    // Everyone now sitting between where you were and where you are.
    const passers = board.top.slice(prev - 1, idx)
      .map((r) => r.name).filter((n) => n !== game.playerName);
    game.boardNews = { kind: 'beaten', rank, passers };
  } else if (prev != null && rank < prev) {
    game.boardNews = { kind: 'gained', rank };
  }

  seen[board.date] = rank;
  try {
    // Only the last week is worth keeping.
    const trimmed = Object.fromEntries(Object.entries(seen).sort().slice(-7));
    localStorage.setItem(RANK_KEY, JSON.stringify(trimmed));
  } catch {
    /* private browsing: the nudge just will not persist */
  }
}

/** Post a score, asking for a name the first time. */
async function postScore(entry) {
  if (!entry) return;
  if (!game.playerName) {
    // Ask whenever the score would actually land on the board. This used to
    // require beating the *leader*, which meant that on any day with a score
    // already posted, nobody below first place was ever offered a name — so they
    // could never appear, despite 24 open rows.
    const rows = (game.board && game.board.top) || [];
    const full = rows.length >= BOARD_SIZE;
    const cutoff = rows.length ? rows[rows.length - 1].t : 0;
    if (full && entry.t <= cutoff) return;
    if (skippedToday(entry.date)) return;
    askName(entry);
    return;
  }
  const res = await submitScore({ ...entry, name: game.playerName, assist: game.assist });
  if (res && res.ranked) {
    game.award('ranked');
    game.board = { date: entry.date, top: res.top };
    game.lastRank = res.rank;
  }
}

function askName(entry) {
  game.pendingSubmit = entry;
  const score = document.getElementById('nameScore');
  if (score) {
    const secs = Math.floor(entry.t);
    score.textContent = `${secs}:${String(Math.floor((entry.t - secs) * 100)).padStart(2, '0')}`;
  }
  nameInput.value = game.playerName || '';
  nameEntry.hidden = false;
  // A direction held when the run ended would otherwise stay latched the whole
  // time the field is open, since its keyup now belongs to the field.
  input.releaseAll();
  setTimeout(() => {
    nameInput.focus();
    nameInput.select();
  }, 50);
}

function closeName() {
  nameEntry.hidden = true;
  game.pendingSubmit = null;
}

/** Declining is remembered for that day, so it is one prompt and not thirty. */
function skipName() {
  if (game.pendingSubmit) rememberSkip(game.pendingSubmit.date);
  closeName();
}

nameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const entry = game.pendingSubmit;
  const name = game.setName(nameInput.value);
  closeName();
  if (name && entry) {
    const res = await submitScore({ ...entry, name, assist: game.assist });
    if (res && res.ranked) {
      game.award('ranked');
      game.board = { date: entry.date, top: res.top };
      game.lastRank = res.rank;
    }
  }
});
document.getElementById('nameSkip').addEventListener('click', skipName);

const safeProbe = document.getElementById('safe');
const view = { w: 0, h: 0, cx: 0, cy: 0, coverR: 0, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0 };

/** Resolve the notch / home-indicator insets from the CSS env() probe. */
function readSafeInsets() {
  if (!safeProbe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const cs = getComputedStyle(safeProbe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

// Browsers reject (and noisily log) vibrate() before the user has touched the
// page, so gate on a real interaction rather than trying to catch the failure.
let interacted = false;

/** Try to vibrate. Android-only in practice, and always optional. */
function buzz(pattern) {
  if (!interacted || !touchMode() || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* blocked by the platform — never worth failing over */
  }
}

function measure() {
  // innerWidth can read 0 in a not-yet-laid-out or backgrounded tab; never let
  // a zero slip through, or the whole world transform goes NaN.
  return {
    w: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1280),
    h: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 720),
  };
}

function resize() {
  // The art is flat colour on big shapes, so rendering past 1.5x buys almost
  // nothing visually and costs a lot of fill rate on a phone or Retina panel.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const m = measure();
  view.w = m.w;
  view.h = m.h;

  // Kept for anything that needs the backing-store scale. Note the context is
  // transformed by dpr below, so drawing coordinates are CSS pixels already —
  // type sizes must NOT be multiplied by this.
  view.dpr = dpr;

  const inset = readSafeInsets();
  view.safeTop = inset.top;
  view.safeRight = inset.right;
  view.safeBottom = inset.bottom;
  view.safeLeft = inset.left;

  // On a tall phone the bottom of the screen is where the thumbs live, so lift
  // the field above them rather than centring it under your own hands.
  const portrait = view.h > view.w * 1.25;
  view.cx = view.w / 2;
  view.cy = portrait ? view.h * 0.43 + view.safeTop * 0.5 : view.h / 2;

  // Walls must be born beyond whichever screen corner is furthest from centre.
  view.coverR = Math.max(
    Math.hypot(view.cx, view.cy),
    Math.hypot(view.w - view.cx, view.cy),
    Math.hypot(view.cx, view.h - view.cy),
    Math.hypot(view.w - view.cx, view.h - view.cy),
  );

  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  canvas.style.width = `${view.w}px`;
  canvas.style.height = `${view.h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.setView(view.w, view.h, view.coverR);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
window.visualViewport?.addEventListener('resize', resize);
resize();

const input = new Input(canvas, {
  // x/y are only present for taps and clicks; keyboard confirms pass nothing.
  action: (x, y) => {
    sound.unlock();
    if (x !== undefined && game.overlay) {
      const row = overlayHit(view, x, y);
      if (row) {
        applySetting(row);
        return;
      }
      game.closeOverlay();
      sound.uiBack();
      return;
    }
    if (x !== undefined && game.state === 'menu') {
      const hit = menuHit(view, x, y);
      if (hit.type === 'board') {
        // Tapping the board steps back through the week of seeds.
        game.changeDay(x < view.w / 2 ? 1 : -1);
        sound.uiMove(1);
        return;
      }
      if (hit.type === 'howto' || hit.type === 'stats') {
        game.openOverlay(hit.type);
        sound.uiOpen();
        return;
      }
      if (hit.type === 'none') return; // dead space on the title screen
    }
    if (x !== undefined && game.state === 'dead' && game.deathT > 0.65) {
      const step = deathHitAssist(view, x, y);
      if (step) {
        game.changeAssist(step);
        sound.uiMove(step);
        return;
      }
      if (deathHitRelearn(view, x, y)) {
        game.action();
        tutorial.begin();
        sound.uiConfirm();
        return;
      }
      const cp = deathHitPractice(view, x, y);
      if (cp) {
        game.armStart(cp);
        sound.uiConfirm();
        return;
      }
      if (deathHitMenu(view, x, y)) {
        game.toMenu();
        return;
      }
    }
    game.action();
  },
  back: () => {
    if (tutorial.active) { tutorial.skip(); sound.uiBack(); return; }
    game.back();
  },
  pause: () => {
    // The tutorial owns the pause state while it is running; letting Enter
    // toggle it would fight the lesson card.
    if (tutorial.active) return;
    // One key, one meaning: interrupt whatever is happening.
    if (game.state === 'play' && !game.paused) game.togglePause();
    else game.action();
  },
  mute: () => {
    sound.unlock();
    game.muted = sound.toggleMute();
  },
  cycle: (d) => {
    game.changeDay(d > 0 ? 1 : -1);
    sound.uiMove(d);
  },
  twin: () => {
    // Modes belong to the seed now; the old toggle steps days instead.
    game.changeDay(1);
    sound.uiMove(1);
  },
  mode: () => {},
  cheat: () => {
    sound.unlock();
    autopilot.start();
  },
  demoActive: () => autopilot.active,
  stopDemo: () => {
    autopilot.stop();
    game.toMenu();
  },
  // The tutorial pauses the world *and* waits for a direction to release it, so
  // touch has to keep steering while it is up. Without this a tap fell through to
  // action() and the lesson card could never be dismissed on a phone — keyboard
  // worked only because key handling never consults this predicate.
  steering: () => game.state === 'play' && (!game.paused || tutorial.active),
  inputMode: (isTouch) => {
    interacted = true;
    setTouchMode(isTouch);
    // iOS only starts audio inside a gesture, and the tutorial's first tap now
    // steers rather than falling through to action(), which used to be the only
    // thing that unlocked it.
    sound.unlock();
  },
  hitControl: (x, y) => controlAt(game, view, x, y),
  // Checked before steering, or the tap that hits SKIP also presses a direction.
  skipTutorial: (x, y) => {
    if (!tutorial.active || !teachSkipHit(view, x, y)) return false;
    tutorial.skip();
    sound.uiBack();
    return true;
  },
  control: (id) => {
    sound.unlock();
    if (id === 'pause') game.togglePause();
    else if (id === 'close') {
      if (game.overlay) game.closeOverlay();
      else game.togglePause();
      sound.uiBack();
    } else if (id === 'install') {
      offerInstall();
      return;
    } else if (id === 'settings' || id === 'stats') {
      game.openOverlay(id);
      sound.uiOpen();
    } else if (id === 'mute') {
      game.muted = sound.toggleMute();
      sound.uiToggle(!game.muted);
    } else if (id === 'fullscreen') {
      toggleFullscreen();
      sound.uiConfirm();
    }
  },
});

/** A row tapped inside the settings sheet. */
function applySetting(id) {
  if (id === 'mute') {
    game.muted = sound.toggleMute();
    sound.uiToggle(!game.muted);
  } else if (id === 'twin') {
    sound.uiToggle(game.toggleTwin());
  } else if (id === 'fullscreen') {
    toggleFullscreen();
    sound.uiConfirm();
  } else if (id === 'stats') {
    game.openOverlay('stats');
    sound.uiOpen();
  } else if (id === 'install') {
    offerInstall();
  } else if (id === 'reset') {
    game.resetScores();
    sound.uiDeny(); // destructive: it should not sound like a reward
  }
}

function toggleFullscreen() {
  const el = document.documentElement;
  try {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  } catch {
    /* iOS Safari has no Fullscreen API on iPhone — the button just does nothing */
  }
}

// --- install ----------------------------------------------------------------
// Chrome hands us a deferred prompt; iOS Safari has no equivalent API at all, so
// there the button opens instructions instead. The button shows whenever the
// game is not already installed, because on iOS we can never know if it *could*
// be — only whether it currently is.
let installPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}
game.installed = isStandalone();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // we place the button ourselves, on the title screen
  installPrompt = e;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  game.installed = true;
  game.closeOverlay();
});

async function offerInstall() {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome === 'accepted') game.installed = true;
    return;
  }
  // No API here — walk them through it.
  game.openOverlay('install');
  sound.uiOpen();
}

// Console handle for tuning. refreshBoard/readRank are here so the leaderboard
// nudge can be exercised without waiting on a real poll.
window.dailyhex = { game, input, sound, autopilot, tutorial, refreshBoard, readRank };

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  const m = measure();
  if (m.w !== view.w || m.h !== view.h) resize();

  // Steering is the only thing the player supplies now — slow motion is earned
  // by near misses and applied by the simulation, never held down.
  let dir = 0;
  if (autopilot.active) {
    const cmd = autopilot.update(dt);
    dir = cmd.dir;
    game.demoLabel = autopilot.label;
  } else if (game.state === 'play' && !game.paused) {
    dir = input.dir;
  }

  // The tutorial reads the raw input, not `dir` — while it is holding the world
  // still `dir` is forced to 0, and pressing a direction is exactly what is
  // supposed to release it.
  if (tutorial.active) tutorial.update(dt, input.dir);

  const wasSlowing = game.slowing;
  game.update(dt, dir);
  if (game.slowing !== wasSlowing) sound.setRate(game.slowing ? SLOWMO_SCALE : 1);

  game.pulse = sound.pulse(dt, game.diff.bpm);
  game.menuCoreScale = game.state === 'menu' ? menuCoreScale(view) : 1;
  render(ctx, game, view);

  // Only the menu shows the board, and only on the poll interval.
  if (game.state === 'menu' && !game.overlay) refreshBoard();

  // Reload only from a standing start. Doing it mid-run would delete a run the
  // player is in the middle of, which is a far worse bug than a stale tab.
  if (wantReload && game.state === 'menu' && !game.overlay && !game.loading) {
    wantReload = false;
    location.reload();
    return;
  }

  requestAnimationFrame(frame);
}

// Start drawing immediately — the game must not wait on a network request — but
// re-bind every cached font size once Archivo Black arrives. Layout here is
// measureText-driven, so anything laid out against the fallback wraps wrong.
if (document.fonts?.load) {
  document.fonts.load('16px "Archivo Black"')
    .then(() => document.fonts.ready)
    .then(invalidateFontCache)
    .catch(() => { /* no webfont: the fallback stack still renders */ });
}

refreshBoard(true);
requestAnimationFrame(frame);

// --- staleness --------------------------------------------------------------
// A tab left open does not age well here. The loaded code is frozen at whatever
// build it fetched, and this is a *daily* game — leave it open overnight and the
// menu is still advertising yesterday's seed. Coming back after a long absence
// should quietly put you on the current build and the current day.
//
// Two rules make this safe rather than annoying: never reload a run in progress,
// and never reload without a reason. The reason is either a genuinely different
// build on the server or a genuinely different calendar day.
const STALE_AFTER_MS = 20 * 60_000;
const loadedDate = game.dateKey;
let buildTag = null;
let hiddenAt = 0;
let wantReload = false;

/** The server's fingerprint for the running build. `no-store` means this is
 *  always the origin's answer, never a cached one. */
async function fetchBuildTag() {
  try {
    const res = await fetch('src/main.js', { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return null;
    return res.headers.get('etag') || res.headers.get('last-modified');
  } catch {
    return null; // offline: nothing to compare against, so nothing to do
  }
}
fetchBuildTag().then((tag) => { buildTag = tag; });

async function checkStale(awayMs) {
  if (awayMs < STALE_AFTER_MS) return;
  if (game.dateKey !== loadedDate) { wantReload = true; return; }
  const tag = await fetchBuildTag();
  // A null tag means the check failed, not that the build changed — reloading on
  // a failed fetch would boot people offline for no reason.
  if (tag && buildTag && tag !== buildTag) wantReload = true;
}

// Keep the sim honest if the tab was hidden for a while, and put the audio back
// together. iOS suspends the AudioContext on backgrounding and does not restore
// it on return — without an explicit wake the game comes back permanently mute.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    if (game.state === 'play' && !game.paused) game.togglePause();
  } else {
    last = performance.now();
    sound.wake();
    if (hiddenAt) checkStale(Date.now() - hiddenAt);
    hiddenAt = 0;
  }
});

// Safari/Chrome on iOS restore from the back-forward cache without firing
// visibilitychange, so pageshow is the only signal on that path.
window.addEventListener('pageshow', (e) => {
  last = performance.now();
  sound.wake();
  // Restored from the back-forward cache: the page may have been parked for days
  // without ever firing visibilitychange, so treat it as a long absence.
  if (e.persisted) checkStale(STALE_AFTER_MS);
});

// The platform may refuse to resume outside a gesture. Every interaction is
// therefore also a repair attempt — cheap, and it makes the failure unnoticeable.
for (const evt of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(evt, () => sound.wake(), { passive: true });
}
