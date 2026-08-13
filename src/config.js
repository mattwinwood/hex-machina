// Core geometry + tuning constants. All distances are "world units";
// the renderer maps WORLD_HEIGHT world units onto the shorter viewport axis.

export const TAU = Math.PI * 2;

// The arena's side count is no longer fixed — Shift Mode changes it mid-run —
// so everything derived from it travels together in a small geometry object
// rather than living as module constants.
export const DEFAULT_SIDES = 6;
// Triangle included: huge slots, very different rhythm — closest to the
// original's habit of collapsing the arena to a smaller polygon.
export const SHIFT_SHAPES = [6, 5, 4, 3, 8];

export function geometryFor(sides) {
  const step = TAU / sides;
  return { sides, step, halfStep: step / 2, cosHalf: Math.cos(step / 2) };
}

export const GEOM = geometryFor(DEFAULT_SIDES);
// Kept for the handful of call sites that only ever mean "the default arena".
export const SIDES = DEFAULT_SIDES;
export const STEP = GEOM.step;

export const CORE_RADIUS = 42; // the hexagon you defend
export const PLAYER_ORBIT = 62; // cursor distance from centre
export const PLAYER_SIZE = 8; // 0.19 core-radii, matching the original's cursor
export const WORLD_HEIGHT = 640; // world units across the short screen axis

// Shown at the foot of the title screen. Kept here so the byline is one edit,
// not a string buried in the renderer.
export const GAME_NAME = 'DAILY HEX';
// Split on CREDIT_SEP when it will not fit on one line — keep the two in step.
export const CREDIT_SEP = '  |  ';
export const CREDIT = `DEVELOPED BY: MATT WINWOOD${CREDIT_SEP}ORIGINAL CONCEPT BY: TERRY CAVANAGH (SUPER HEXAGON)`;

// Rotating rings spin at most this fraction of the player's angular speed, so a
// drifting gap can always be chased down. Everything above ~0.5 stops being fair.
export const RING_SPIN_FRACTION = 0.3;

// In twin mode the two cursors sit 180° apart, so the field is really a
// half-slot-count game wearing a polygon: every ring's openings must be
// point-symmetric. Only possible when the side count is even.
export const twinHalf = (sides) => sides / 2;
// Twin mirrors every opening to the slot opposite it, so a one-gap pattern
// becomes two gaps out of `sides`. On a square that is 50% of the ring standing
// open — a corridor, not a challenge. 6 sides gives 33% and 8 gives 25%, which
// is where the second cursor actually costs something. Even-sided is necessary
// but not sufficient.
export const twinPossible = (sides) => sides % 2 === 0 && sides >= 6;

// --- Slow motion -----------------------------------------------------------
// Bullet time is earned, not issued. You start empty and bank one charge every
// CHARGE_SECONDS you stay alive, so the longer you go clean the deeper the
// reserve — and spending it is a real decision rather than a free reset.
export const CHARGE_SECONDS = 5;
export const MAX_CHARGES = 4;
export const SECONDS_PER_CHARGE = 0.8; // slow-motion seconds one charge buys
export const STAMINA_MAX = MAX_CHARGES * SECONDS_PER_CHARGE;
// How slowly the world runs while it is engaged.
export const SLOWMO_SCALE = 0.45;
// The cursor keeps its real-world turning rate while everything else crawls —
// that relative gain is the whole point of the ability.
export const SLOWMO_AGILITY = 1 / SLOWMO_SCALE;

// --- Stage table -----------------------------------------------------------
// Three base stages plus three REDLINE stages, each unlocked by surviving 60s on
// its parent. The speed ladder is the one the genre settled on: the second stage
// is 1.2x the first and the third is 2x — applied to *both* wall speed and cursor
// speed. Scaling both is what actually shortens reaction time; wall speed alone
// would just spread the patterns further apart (see minClearFor).
//
// Stage names are this game's own, deliberately not the original's. The debt is
// acknowledged in CREDIT; it should not be paid in borrowed nouns. Phases used to
// share this vocabulary and no longer do — they say what they change instead.
const REF_WALL = 315;
const REF_CURSOR = 5.0;

// A stage is one 60-second unit of progress. Redline stages begin at progress 1,
// i.e. exactly where their parent stood when it hit 60 seconds: the run picks up
// at the speed that broke you.
export const PROGRESS_SECONDS = 60;

// --- Milestones ------------------------------------------------------------
// 15/30/45/60 are not just speed steps: each one re-skins the run. Hue, camera
// behaviour, obstacle character and the music's filter all move together so a
// phase change is felt rather than read off a timer.
// A phase is named for what it does, not for a mood. "CASCADE" told the player
// nothing; "HARDER PATTERNS · FASTER SPIN" tells them exactly what just changed.
// The separator is meaningful — the renderer breaks on it to make two lines.
export const PHASES = [
  { t: 0, name: 'WARMING UP', hue: 0, spin: 1.0, tier: 0, cutoff: 20000, zoom: 1.24 },
  { t: 15, name: 'HARDER PATTERNS · FASTER SPIN', hue: 48, spin: 1.25, tier: 1, cutoff: 14000, zoom: 1.27 },
  { t: 30, name: 'TIGHTER GAPS · FASTER SPIN', hue: 132, spin: 1.55, tier: 2, cutoff: 9000, zoom: 1.30 },
  { t: 45, name: 'EVERYTHING IT HAS', hue: 214, spin: 1.9, tier: 3, cutoff: 5200, zoom: 1.33 },
  { t: 60, name: 'YOU WON · KEEP GOING', hue: 300, spin: 2.4, tier: 3, cutoff: 20000, zoom: 1.36 },
];

// --- Near miss -------------------------------------------------------------
// Grazing is scored *and* rewarded: shaving a wall trips a burst of slow motion
// automatically, so flirting with death is the skill that buys you time. The
// window is tight enough that it cannot be farmed from the middle of a gap.
export const GRAZE_WINDOW = 0.17; // radians of clearance that counts as a graze
export const GRAZE_DECAY = 2.6; // seconds of no graze before the chain drops
export const GRAZE_MAX_CHAIN = 99;
// A graze spends this much of the bank, and buys this long of a slowdown.
export const GRAZE_SLOWMO = 0.45; // seconds of bullet time a full-price graze buys
// What a near miss costs from the bank, in charges. A full bank is four rescues
// at most, and fewer than that as soon as the spots get hairy — the price moves
// with how bad the escape actually was, and so does the bullet time it buys.
export const GRAZE_COST_MIN = 1.0;  // a free shave still costs a whole charge
export const GRAZE_COST_MAX = 1.9;  // clawing out of a closing, nearly shut ring

// --- Daily character -------------------------------------------------------
// A day used to differ from another only by which mode bits it rolled, which is
// a thin kind of variety. Now that the pattern library actually spans distinct
// motions — hold, walk, lunge, sprint — a seed can lean the pool toward one of
// them and give the day a character a player can name and compare notes on.
//
// A lean, never a lock: every pattern stays reachable, so no day loses the
// vocabulary it needs, and the fairness spacing rule is untouched.
// Named for what they DO, not for a mood — the same rule the phase names follow.
// "PATIENCE" and "WALL OF SOUND" told a player nothing they could act on; the
// point of showing the day's character is that you know what you are walking
// into before you press play.
export const FLAVOURS = [
  { id: 'even', name: 'MIXED', favour: [], weight: 1 },
  { id: 'spirals', name: 'MOSTLY SPIRALS', favour: ['spiral', 'escape-spiral', 'whiplash-spiral', 'longspiral'], weight: 4 },
  { id: 'holds', name: 'HOLD AND WAIT', favour: ['hold', 'stutter', 'stutter-step', 'tunnel'], weight: 4 },
  { id: 'swings', name: 'SIDE TO SIDE', favour: ['zigzag', 'cross', 'pinwheel', 'rain'], weight: 4 },
  { id: 'walls', name: 'DENSE WALLS', favour: ['bat', 'ladder', 'opposite', 'double'], weight: 4 },
];

// --- Rests -----------------------------------------------------------------
// Measured against Super Hexagon: it leaves the arena genuinely empty for up to
// 4.6s at a stretch and sits at ~6% wall coverage, where we ran ~11% with no
// quiet spell longer than 0.9s. Every pattern used to follow the last at the
// tightest legally-fair spacing, which reads as one unbroken stream rather than
// something with a rhythm. A rest is measured in wall-flights, so it lasts the
// same wall-clock time regardless of stage speed.
// How often the spawner inserts breathing room. Rests are load-bearing — the
// spawner uses them to buy the clearance a greedy bot needs — so this cannot be
// dropped freely: verify the fairness canary after changing it. 0.45 left 73% of
// the opening fifteen seconds empty; 0.20 takes it to 60%.
export const REST_CHANCE = 0.2;
export const REST_MIN = 0.75;
export const REST_MAX = 2.3;
// A rest is spawned as a *distance* — a multiple of the spawn radius — but the
// player experiences it as *time*, and the two diverge badly. Early in a run,
// when walls are slowest, REST_MAX works out at 3.9 seconds of empty screen;
// the same multiple in overtime is 2.9s. So the long waits land exactly where
// they are least wanted, at the start, and no amount of tuning the multiple
// fixes that because the multiple is not the thing being felt.
export const REST_MAX_SECONDS = 1.5;
// Where a `ghost` wall stops being drawn, as a fraction of the spawn radius. It
// is still lethal below this — the player has already been shown it and now has
// to remember. Too low and it vanishes after the dodge is already made, which
// changes nothing; too high and it disappears before there was time to read it,
// which is luck rather than difficulty.
export const GHOST_HIDE_AT = 0.34;

// --- Pulse mode ------------------------------------------------------------
// The arena breathes with the track. Obstacles are untouched; what changes is
// how much room you have to read them.
export const PULSE_AMPLITUDE = 0.16;

// A light camera lift on the beat. This was briefly pushed to 0.18 to match the
// original's ±32% punch, which on these faster tracks read as the whole screen
// throbbing. The beat is expressed through the *walls* instead — see the grid
// quantisation in game.js — so the camera only needs to breathe.
export const PULSE_ZOOM = 0.045;

// Super Hexagon's palette is not static between phases: its hue oscillates about
// ±19° around the phase colour roughly every 2 seconds — a slow shimmer, not the
// full colour wheel (measured over 75s, the whole run stayed inside a 50° band).
// Ours held one hue per phase, which is why it looked comparatively inert.
// Damping on the framing zoom for tall screens — see framingZoom() in render.js.
// 1.24 x 0.81 lands portrait at ~1.00 — exactly the roomier view it had before
// the framing change. A phone held upright cannot spare the reaction time, and
// playtesting at 1.24 there was described as 'exceptionally difficult'.
export const PORTRAIT_FRAMING = 0.81;

export const HUE_SHIMMER = 19;
export const HUE_SHIMMER_PERIOD = 2.0; // seconds

// Every track in the library, so the daily can pick one from the seed. A stage's
// own `track` is only used off the daily; otherwise the day chooses, and the day
// is the same for everybody.
export const TRACKS = [
  'dungeon-run-loop',
  'dorian-overdrive',
  'glitch-dungeon-rush',
  'dorian-overdrive-2',
  'glitch-dungeon-rush-2',
];

// How many rows the leaderboard keeps per day. Mirrors TOP_N in
// server/leaderboard.js — the client needs it to know whether a score qualifies,
// and getting it wrong only ever costs a redundant prompt, never a lost score.
export const BOARD_SIZE = 25;

// --- Practice / daily ------------------------------------------------------
export const CHECKPOINTS = [30, 45]; // practice entry points, once legitimately reached

// --- Assist ----------------------------------------------------------------
// The daily has no hints, so the assist is time itself: the whole simulation
// runs slower in 5% steps. Same obstacles, same seed, more room to react.
// Assisted runs are never ranked — mixing them with clean runs would make the
// board meaningless — but they still count for badges and practice.
export const ASSIST_STEP = 5;
export const ASSIST_MIN = 60; // percent

// --- Badges ----------------------------------------------------------------
// Earned once and kept. Ordered easiest first so the sheet reads as a ladder.
export const BADGES = [
  { id: 'first-run', name: 'FIRST LIGHT', note: 'Play a daily run' },
  { id: 'thirty', name: 'HALF WAY', note: 'Reach 30 seconds' },
  { id: 'finish', name: 'FULL MINUTE', note: 'Survive 60 seconds' },
  { id: 'clean', name: 'NO ASSIST', note: 'Finish without slowing time' },
  { id: 'streak3', name: 'THREE DAY STREAK', note: 'Play three days running' },
  { id: 'streak7', name: 'SEVEN DAY STREAK', note: 'Play seven days running' },
  { id: 'graze25', name: 'CLOSE SHAVE', note: '25 grazes in one run' },
  { id: 'ranked', name: 'ON THE BOARD', note: 'Post a ranked score' },
];
export const SPEED_GAIN = 0.34; // wall speed added per stage of progress
export const SAFETY_DECAY = 0.22; // dodging slack removed per stage of progress

export const RANKS = [
  { t: 10, name: 'LINE' },
  { t: 20, name: 'TRIANGLE' },
  { t: 30, name: 'SQUARE' },
  { t: 45, name: 'PENTAGON' },
  { t: 60, name: 'HEXAGON' },
];

function stage(o) {
  return {
    // Only used to keep the core pulsing when the music is muted — while a
    // track is playing the pulse is read from the audio itself.
    bpm: 200,
    // Per-stage difficulty levers. Defaults match the harder stages; the first
    // stage overrides them so it is genuinely learnable rather than a wall.
    safetyDecay: SAFETY_DECAY, // how fast dodging slack erodes over a run
    maxTier: 3, // cap on pattern complexity, regardless of phase
    spinScale: 1, // damping on the phase-driven camera spin
    ringSpinChance: 0.45, // how often a pattern arrives rotating
    ringSpinFrom: 6, // seconds before rotating rings can appear
    ...o,
    wallSpeed: REF_WALL * o.factor,
    playerSpeed: REF_CURSOR * o.factor,
    maxSpeed: REF_WALL * o.factor * 2.6,
  };
}

export const DIFFICULTIES = [
  stage({
    id: 'spark',
    name: 'SPARK',
    subtitle: 'WARM',
    factor: 1.0,
    startProgress: 0,
    baseTier: 0,
    // Stage one is the on-ramp: wide dodging windows that erode slowly, rotation
    // held back, and a calmer camera. The target is a player clearing 60s inside
    // a hundred attempts, not inside a thousand.
    //
    // It used to cap at tier 2, which sounded like a gentle on-ramp and was in
    // fact a dead library: this is the stage the daily runs, so `zigzag`,
    // `longspiral`, `stutter` and `blackout` never appeared for anybody, ever.
    // Tier 3 unlocks at the 45s phase, so they arrive in the last quarter of a
    // run as an escalation rather than an opening. Fairness holds at 210/210.
    safety: 1.95,
    safetyFloor: 1.45,
    // 0.15 meant the dodging window went 1.95 -> 1.80 over a whole run: a 7.7%
    // tightening that never came near its own floor, and the entire real
    // escalation in the game. Everything else that "ramps" is cancelled out —
    // walls speed up 34%, but minClearFor divides the spacing by wall speed, so
    // reaction time stays constant by construction. At 0.50 the window actually
    // travels 1.95 -> 1.45 across the run and the curve appears: measured
    // 1.30 -> 3.14 deaths/min from the first window to the last, against
    // 1.29 -> 1.90 (flat) before. Fairness holds at 210/210.
    safetyDecay: 0.50,
    maxTier: 3,
    spinScale: 0.7,
    ringSpinChance: 0.28,
    ringSpinFrom: 12,
    spin: 0.4,
    spinGain: 0.014,
    flipEvery: [5.5, 9.5],
    hue: 300,
    track: 'dungeon-run-loop',
  }),
  stage({
    id: 'forge',
    name: 'FORGE',
    subtitle: 'HOT',
    factor: 1.2,
    startProgress: 0,
    baseTier: 1,
    safety: 1.45,
    safetyFloor: 1.14,
    spin: 0.7,
    spinGain: 0.026,
    flipEvery: [3.5, 7.0],
    hue: 42,
    track: 'dorian-overdrive',
  }),
  stage({
    id: 'crucible',
    name: 'CRUCIBLE',
    subtitle: 'MOLTEN',
    factor: 2.0,
    startProgress: 0,
    baseTier: 2,
    safety: 1.34,
    safetyFloor: 1.13,
    spin: 0.95,
    spinGain: 0.034,
    flipEvery: [2.5, 5.5],
    // CRUCIBLE's signature: the whole field whips through a full turn roughly
    // every 13 seconds. Camera-only, so it costs the player nothing but nerve.
    spinBurst: { every: 13, duration: 1.15, turns: 1 },
    hue: 190,
    track: 'glitch-dungeon-rush',
  }),
  stage({
    id: 'flare',
    name: 'FLARE',
    subtitle: 'SEARING',
    factor: 1.0,
    startProgress: 1,
    baseTier: 1,
    safety: 1.6,
    safetyFloor: 1.15,
    spin: 0.6,
    spinGain: 0.02,
    flipEvery: [4.0, 7.5],
    hue: 130,
    unlockedBy: 'spark',
    track: 'dorian-overdrive-2',
  }),
  stage({
    id: 'furnace',
    name: 'FURNACE',
    subtitle: 'WHITE HOT',
    factor: 1.2,
    startProgress: 1,
    baseTier: 2,
    safety: 1.45,
    safetyFloor: 1.14,
    spin: 0.85,
    spinGain: 0.028,
    flipEvery: [3.0, 6.0],
    hue: 15,
    unlockedBy: 'forge',
    track: 'glitch-dungeon-rush-2',
  }),
  stage({
    id: 'meltdown',
    name: 'MELTDOWN',
    subtitle: 'ABSOLUTE',
    factor: 2.0,
    startProgress: 1,
    baseTier: 3,
    safety: 1.34,
    safetyFloor: 1.13,
    spin: 1.1,
    spinGain: 0.038,
    flipEvery: [2.0, 4.5],
    spinBurst: { every: 11, duration: 1.0, turns: 1 },
    hue: 265,
    unlockedBy: 'crucible',
    track: 'glitch-dungeon-rush',
  }),
];

export const mod = (n, m) => ((n % m) + m) % m;

export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
