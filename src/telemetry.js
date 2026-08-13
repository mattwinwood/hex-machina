// Anonymous run telemetry, for tuning the game against real players.
//
// Everything shipped so far was balanced against a bot. A bot is a floor, not a
// model of a player: it cannot see the camera spin, which is a large part of
// what a human finds hard, and it never gets bored, tilts, or gives up. This
// records what actually happens to people so the same questions the offline
// harnesses answer — deaths per minute, which patterns kill, whether a rescue
// arrived in time — can be asked of real hands.
//
// ---------------------------------------------------------------------------
// What "anonymous" means here, concretely
// ---------------------------------------------------------------------------
// * No name, even though the game knows one for the leaderboard.
// * No account, cookie, or persistent identifier. The run id is random and
//   thrown away; nothing links two runs, let alone two days.
// * No IP is stored (the server drops it after rate limiting).
// * No user agent. Just "touch or keyboard" and a coarse screen shape, because
//   the same seed is genuinely a different game on a phone than on a desktop.
// * Nothing free-text, so nothing a player types can end up in the data.
//
// The result is a pile of runs that cannot be attributed to anybody, which is
// all that tuning needs. If that ever stops being true, this file is wrong.

const KEY = 'dailyhex.telemetry-off';
const ENDPOINT = '/api/telemetry';

/** Players can turn this off, and a browser-level privacy signal counts as off. */
export function telemetryOn() {
  try {
    if (localStorage.getItem(KEY)) return false;
  } catch {
    return false; // no storage, no way to honour an opt-out: assume opted out
  }
  // Global Privacy Control is a real, legally recognised opt-out in some places.
  // Do Not Track is deprecated but costs nothing to respect.
  if (navigator.globalPrivacyControl === true) return false;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return false;
  return true;
}

export function setTelemetry(on) {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, '1');
  } catch {
    /* nothing persists; the getter above then reports off, which is the safe way */
  }
}

/** Coarse enough to be a category, not a fingerprint. */
function shape() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (Math.min(w, h) < 500) return h > w ? 'phone-portrait' : 'phone-landscape';
  if (Math.min(w, h) < 900) return h > w ? 'tablet-portrait' : 'tablet-landscape';
  return 'desktop';
}

/**
 * One run, reduced to the things that could change a design decision.
 *
 * Deliberately not collected: anything identifying, and anything that only
 * describes the machine rather than the game.
 */
export function runRecord(g, extra = {}) {
  const killer = g.lastHit;
  const finished = g.t >= 60;
  return {
    v: 1,
    // The seed's date, not the wall-clock time of play — it is the run's
    // identity, and it is the same for everybody who played that day.
    date: g.dateKey,
    stage: g.diff?.id,
    // Where the run ended, and how far through the difficulty curve that was.
    t: Math.round(g.t * 100) / 100,
    finished,
    phase: g.phase?.name,
    walls: g.wallsCleared,
    // What the arena was doing at the moment it went wrong.
    sides: g.sides,
    pattern: killer ? killer.pattern : null,
    // Wall depth at the moment of contact says whether they clipped the leading
    // face or blundered into the flank of something already passing.
    depth: killer ? Math.round(killer.dist - g.orbit) : null,
    spin: killer ? Math.round(Math.abs(killer.spin || 0) * 100) / 100 : null,
    // The day's configuration, so a soft day can be told from a soft build.
    flavour: g.flavour?.id,
    twinSeed: !!g.twinSeed,
    twinAt: g.twin,          // was the second cursor actually live when they died
    // The assist systems: did the game have help left to give, and did it give it.
    charges: Math.round((g.stamina / 5) * 10) / 10,
    rescues: g.rescueCount | 0,
    assist: g.assist,
    assisted: !!g.assisted,
    // Engagement signals. A player who never grazes is playing a different game
    // from one who chains twenty.
    grazes: g.graze?.total | 0,
    bestChain: g.graze?.best | 0,
    practice: !!g.practice,
    ...extra,
  };
}

/**
 * Fire and forget. sendBeacon survives the tab closing, which is exactly when a
 * frustrated player leaves — the runs most worth hearing about are the ones a
 * normal fetch would lose.
 */
export function send(record) {
  if (!telemetryOn()) return;
  let body;
  try {
    body = JSON.stringify(record);
  } catch {
    return;
  }
  if (body.length > 1800) return; // never send something the server will reject
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } })
      .catch(() => {});
  } catch {
    /* telemetry must never be able to break a run */
  }
}

/** A run ended. The only call site that matters. */
export function runEnded(g, extra) {
  // Demo, tutorial and practice runs are not the game; counting them would
  // quietly claim the autopilot's deaths as a player's.
  if (g.demo || g.tutorial || g.practice) return;
  send(runRecord(g, extra));
}
