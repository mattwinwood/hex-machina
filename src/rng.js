// One seedable random stream for the whole simulation.
//
// Everything that affects what the player sees — pattern choice, mirroring,
// rotation, spin, shape shifts — draws from here, so seeding it makes a run
// exactly reproducible. That is what the Daily Hex depends on.

let state = (Math.random() * 0xffffffff) >>> 0;

/** mulberry32: small, fast, and good enough for gameplay variety. */
function next() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rng = {
  /** Seed the stream. Same seed + same code path = same run, every time. */
  seed(n) {
    state = (n >>> 0) || 1;
  },
  /** Reseed from entropy, for ordinary non-deterministic play. */
  scramble() {
    state = (Math.random() * 0xffffffff) >>> 0;
  },
  snapshot() {
    return state;
  },
  restore(s) {
    state = s >>> 0;
  },
  float: next,
  int: (n) => Math.floor(next() * n),
  pick: (arr) => arr[Math.floor(next() * arr.length)],
  range: (a, b) => a + next() * (b - a),
  chance: (p) => next() < p,
  sign: () => (next() < 0.5 ? -1 : 1),
};

/** Stable integer seed for a given calendar day, so everyone shares a run. */
export function dailySeed(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  let h = 2166136261 >>> 0;
  for (const ch of `${y}-${m}-${d}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Which optional modes today's run uses. Derived from the date seed with an
 * independent hash, so it is identical for everyone and cannot be influenced by
 * how far into the gameplay stream a player happens to be.
 */
export function modesForSeed(seed) {
  const hash = (n) => {
    let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x21f0aaad) >>> 0;
    h ^= h >>> 15;
    return h >>> 0;
  };
  const bit = (n) => (hash(n) & 1) === 1;
  const twin = bit(1);
  const pulse = bit(2);
  let shift = bit(3);
  // All three at once is a wall on day one; keep at most two.
  const pulseOn = twin && pulse && shift ? false : pulse;
  // Twin does not open the run — it arrives partway through, at a moment the
  // seed fixes so everyone meets the second cursor at the same second. It is
  // also a *window*, not a permanent state: it runs for twinFor seconds, steps
  // back out for the same length, and returns, for the whole run.
  const twinAt = twin ? 15 + (hash(4) % 46) : null; // whole seconds, so it can be announced
  const twinFor = twin ? 8 + (hash(5) % 13) : null; // 8-20s per window
  return { twin, pulse: pulseOn, shift, twinAt, twinFor };
}

/** Whole days since the epoch, from the calendar date rather than the clock. */
function dayNumber(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

/** The largest step below `n` that still walks every slot before repeating. */
function stride(n) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  for (let k = n - 1; k > 1; k--) if (gcd(k, n) === 1) return k;
  return 1;
}

/**
 * Which track the day plays. A hash would happily give the same song three days
 * running, which reads as the rotation being broken — so this walks the library
 * by a stride coprime with its length instead. Every track comes up equally
 * often, no two consecutive days share one, and it depends only on the date, so
 * everyone hears the same song on the same day.
 */
export function trackForDate(date, count) {
  if (count <= 1) return 0;
  return (((dayNumber(date) * stride(count)) % count) + count) % count;
}

/**
 * The day's character — which family of motions it leans on. Its own hash, so it
 * is independent of the modes and the track a seed picked.
 */
export function flavourForSeed(seed, count) {
  let h = (seed ^ 0x2545f491) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return h % count;
}

export function dateForOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export function dailyKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
