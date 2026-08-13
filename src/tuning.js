// Every knob that decides how hard the game is, in one place.
//
// These were scattered across game.js and config.js as bare constants, changed
// one at a time over two days of "is it harder yet?" — and when the answer was
// "put it back how it was", there was no way to do it: the repo's history starts
// after most of the changes, so there was nothing to revert *to*.
//
// So difficulty is now a named profile rather than a dozen edits. Switching is
// one word, going back is one word, and comparing two of them is a URL. Nothing
// here changes what the code can do; it changes what a single line can undo.
//
// `classic` is the game as it played on 2026-08-11, before any of the
// difficulty work began. `gauntlet` is everything built on 08-12 and 08-13.
//
// NOT profiled, deliberately — these are bug fixes, not taste:
//   * the post-reshape clearance (`worstApproach`), which stopped the first ring
//     after a shape change from ignoring the fairness rule
//   * the twin/even-sided guard in the puzzle scheduler
//   * the charge ring following the core's inradius
// Both profiles get them. A profile should never be able to select a bug.

export const TUNING = {
  classic: {
    label: 'CLASSIC',
    note: 'The game as it played on 2026-08-11.',
    // Bullet time fires whenever the odds of reaching the next gap fall below
    // this. 0.9 rescues from situations with a 90% chance of being survived
    // unaided — generous, and what "too easy" was measured against.
    rescueAt: 0.9,
    // How fast the dodging window tightens across a run. 0.15 moves it 1.95 ->
    // 1.80 over 60s and never reaches the 1.45 floor.
    safetyDecay: 0.15,
    // Patterns drawn independently each spawn, and no day character.
    shuffledBag: false,
    flavourWeighting: false,
    // Arena reshapes only at phase boundaries, and only sometimes.
    puzzles: false,
  },

  gauntlet: {
    label: 'GAUNTLET',
    note: 'Everything built on 08-12 and 08-13.',
    rescueAt: 0.6,
    safetyDecay: 0.5,
    shuffledBag: true,
    flavourWeighting: true,
    puzzles: true,
  },
};

/** What a fresh load plays. */
export const DEFAULT_TUNING = 'classic';

export function tuningFor(name) {
  return TUNING[name] || TUNING[DEFAULT_TUNING];
}
