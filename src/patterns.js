// Wall patterns, parametric in the arena's side count.
//
// A pattern is a list of walls in *pattern-local* space:
//   { slot: 0..n-1, dist: units ahead of the pattern's leading edge, len: thickness }
// The `dist` values describe a pattern's *shape*, not its final spacing: the
// spawner widens any ring gap too tight to dodge at the current wall speed
// (see minClearFor in game.js).
//
// Every generator takes `n`, because Shift Mode moves the arena between
// hexagon, pentagon, square and octagon mid-run. Patterns that only make sense
// on an even count declare it, and are skipped on a pentagon.

import { mod } from './config.js';
import { rng } from './rng.js';

const T = 44; // default wall thickness

// Ring arrivals are quantised to the beat now, so *spacing* no longer tells one
// pattern from another — the only thing left is choreography: how far you have
// to travel between one opening and the next. Profiled, ten of the fifteen
// patterns had collapsed onto "one slot, every beat", which is a single idea
// wearing fifteen hats. What follows deliberately spreads across the range:
// hold still (0), walk (1), lunge (2), and cross the arena (3+).

/** Every slot except `gaps` gets a wall at `dist`. */
function ring(n, dist, gaps, len = T) {
  const open = new Set(gaps.map((g) => mod(g, n)));
  const out = [];
  for (let s = 0; s < n; s++) {
    if (!open.has(s)) out.push({ slot: s, dist, len });
  }
  return out;
}

/**
 * A wall that is shown on the way in and then hidden for the last stretch.
 *
 * It stays lethal the whole time — only the drawing changes. The player gets a
 * full look while there is still time to plan, then has to execute from memory,
 * which cuts the *effective* reaction window without cutting the fair one. That
 * asymmetry is the point: a bot reads the wall list and is unaffected, so the
 * fairness canary is blind to this, and it is exactly the kind of difficulty a
 * good human player actually feels.
 */
function ghost(walls) {
  for (const w of walls) w.ghost = 1;
  return walls;
}

export const PATTERNS = [
  {
    name: 'single',
    spinnable: true,
    tier: 0,
    gen: (n) => ring(n, 0, [rng.int(n)]),
  },
  {
    name: 'double',
    spinnable: true,
    tier: 0,
    gen: (n) => {
      const g = rng.int(n);
      return [...ring(n, 0, [g]), ...ring(n, 150, [g + rng.sign()])];
    },
  },
  {
    name: 'opposite',
    spinnable: true,
    tier: 0,
    evenOnly: true,
    gen: (n) => {
      const g = rng.int(n);
      const h = n / 2;
      return [...ring(n, 0, [g, g + h]), ...ring(n, 160, [g + 1, g + h + 1])];
    },
  },
  {
    name: 'wide',
    spinnable: true,
    tier: 0,
    minSides: 5,
    gen: (n) => ring(n, 0, [rng.int(n), rng.int(n) + 1], 200),
  },
  {
    name: 'spiral',
    tier: 1,
    gen: (n) => {
      const d = rng.sign();
      const g0 = rng.int(n);
      const out = [];
      for (let k = 0; k < 5; k++) out.push(...ring(n, k * 112, [g0 + d * k]));
      return out;
    },
  },
  {
    name: 'tunnel',
    spinnable: true,
    tier: 1,
    gen: (n) => {
      const g = rng.int(n);
      return [...ring(n, 0, [g], 190), ...ring(n, 300, [g + rng.sign()])];
    },
  },
  {
    name: 'ladder',
    tier: 1,
    minSides: 5,
    gen: (n) => {
      const d = rng.sign();
      const g = rng.int(n);
      const out = [];
      for (let k = 0; k < 4; k++) {
        const a = g + d * k;
        out.push(...ring(n, k * 108, [a, a + d]));
      }
      return out;
    },
  },
  {
    name: 'bat',
    tier: 2,
    evenOnly: true,
    gen: (n) => {
      const p = rng.int(2);
      const out = [];
      for (let k = 0; k < 4; k++) {
        const o = (p + k) % 2;
        const gaps = [];
        for (let i = o; i < n; i += 2) gaps.push(i);
        out.push(...ring(n, k * 108, gaps, 56));
      }
      return out;
    },
  },
  {
    name: 'rain',
    tier: 2,
    minSides: 5,
    gen: (n) => {
      let g = rng.int(n);
      const out = [];
      for (let k = 0; k < 5; k++) {
        out.push(...ring(n, k * 106, [g, g + 1]));
        g += rng.pick([-2, -1, 1, 2]);
      }
      return out;
    },
  },
  {
    name: 'pinwheel',
    tier: 2,
    minSides: 5,
    gen: (n) => {
      const d = rng.sign();
      const g = rng.int(n);
      const out = [];
      for (let k = 0; k < 3; k++) {
        const a = g + d * 2 * k;
        out.push(...ring(n, k * 122, [a, a + d], 70));
      }
      return out;
    },
  },
  {
    // A real zig-zag: two slots each way, so it swings rather than shuffles.
    name: 'zigzag',
    tier: 3,
    gen: (n) => {
      let g = rng.int(n);
      let d = rng.sign();
      const out = [];
      for (let k = 0; k < 6; k++) {
        out.push(...ring(n, k * 104, [g]));
        g += d * 2;
        d = -d;
      }
      return out;
    },
  },
  {
    // Hold. The opening does not move for several rings — the hardest thing to
    // do in a game that has trained you to keep moving.
    name: 'hold',
    tier: 1,
    gen: (n) => {
      const g = rng.int(n);
      const out = [];
      for (let k = 0; k < 4; k++) out.push(...ring(n, k * 100, [g], 48));
      return out;
    },
  },
  {
    // Hold, then lunge. The rhythm break is the whole point: three rings still,
    // then two slots at once.
    name: 'stutter-step',
    tier: 2,
    gen: (n) => {
      let g = rng.int(n);
      const d = rng.sign();
      const out = [];
      for (let k = 0; k < 6; k++) {
        out.push(...ring(n, k * 100, [g], 48));
        if (k % 3 === 2) g += d * 2;
      }
      return out;
    },
  },
  {
    // Cross: the opening jumps to the far side. The spawner widens the ring gap
    // to keep it reachable, so this reads as one long committed sprint.
    name: 'cross',
    tier: 2,
    minSides: 5,
    gen: (n) => {
      let g = rng.int(n);
      const out = [];
      const jump = Math.max(2, Math.floor(n / 2));
      for (let k = 0; k < 4; k++) {
        out.push(...ring(n, k * 120, [g], 52));
        g += (k % 2 ? -1 : 1) * jump;
      }
      return out;
    },
  },
  {
    // The escape spiral: the opening marches one slot per ring for long enough
    // that you have to commit to running, not dodging. The signature shape of
    // the original, and the reason a stationary player cannot survive.
    name: 'escape-spiral',
    tier: 1,
    gen: (n) => {
      const d = rng.sign();
      let g = rng.int(n);
      const out = [];
      const rings = n <= 4 ? 7 : 11;
      for (let k = 0; k < rings; k++) {
        out.push(...ring(n, k * 96, [g], 46));
        g += d;
      }
      return out;
    },
  },
  {
    // Same idea, but the spiral reverses halfway — you commit, then have to
    // unwind. Nastier, so it arrives later.
    name: 'whiplash-spiral',
    tier: 2,
    gen: (n) => {
      let d = rng.sign();
      let g = rng.int(n);
      const out = [];
      // Two slots a ring, so it is a genuinely faster spiral than escape-spiral
      // rather than the same walk under a different name.
      for (let k = 0; k < 8; k++) {
        out.push(...ring(n, k * 104, [g], 48));
        if (k === 3) d = -d;
        g += d * 2;
      }
      return out;
    },
  },
  {
    name: 'longspiral',
    tier: 3,
    gen: (n) => {
      const d = rng.sign();
      let g = rng.int(n);
      const out = [];
      // Accelerating: one slot, then two, then one — the pace of the spiral
      // itself changes under you.
      for (let k = 0; k < 8; k++) {
        out.push(...ring(n, k * 100, [g], 52));
        g += d * (k % 3 === 1 ? 2 : 1);
      }
      return out;
    },
  },
  {
    // Spin your way out: the opening steps one slot the same way, ring after
    // ring, for long enough that you cannot dab at it — you commit to a
    // direction and hold it. The existing spirals move the gap too, but they
    // reverse or accelerate; this one never lets up.
    name: 'corkscrew',
    spinnable: false,
    tier: 2,
    minSides: 5,
    gen: (n) => {
      const dir = rng.sign();
      let g = rng.int(n);
      const out = [];
      for (let i = 0; i < 6; i++) {
        out.push(...ring(n, i * 132, [g]));
        g = mod(g + dir, n);
      }
      return out;
    },
  },
  {
    // Shown, then hidden. Three rings arrive with the opening walking one slot
    // at a time; you see the whole shape early and dodge the back half blind.
    name: 'blackout',
    spinnable: false,
    tier: 3,
    gen: (n) => {
      const dir = rng.sign();
      let g = rng.int(n);
      const out = [];
      for (let i = 0; i < 3; i++) {
        const r = ring(n, i * 165, [g]);
        out.push(...(i === 0 ? r : ghost(r)));
        g = mod(g + dir, n);
      }
      return out;
    },
  },
  {
    // A fork that closes. The first ring offers two ways through on opposite
    // sides; the second keeps only one of them. Committing early to the wrong
    // one means crossing the arena late, so it is a decision rather than a
    // reflex — which is the thing a zig-zag never asks for.
    name: 'fork',
    spinnable: false,
    tier: 2,
    minSides: 5,
    gen: (n) => {
      const a2 = rng.int(n);
      const b2 = mod(a2 + Math.floor(n / 2), n);
      const keep = rng.chance(0.5) ? a2 : b2;
      return [
        ...ring(n, 0, [a2, b2]),
        ...ring(n, 210, [keep]),
        ...ring(n, 380, [mod(keep + rng.sign(), n)]),
      ];
    },
  },
  {
    name: 'stutter',
    tier: 3,
    gen: (n) => {
      const d = rng.sign();
      let g = rng.int(n);
      const out = [];
      for (let k = 0; k < 5; k++) {
        out.push(...ring(n, k * 110, [g], k % 2 ? 130 : 50));
        if (k % 2) g += d;
      }
      return out;
    },
  },
];

/** Patterns valid at a given tier *and* a given arena shape. */
export function poolFor(tier, sides) {
  return PATTERNS.filter(
    (p) => p.tier <= tier
      && (!p.evenOnly || sides % 2 === 0)
      && (!p.minSides || sides >= p.minSides),
  );
}

export { rng };
