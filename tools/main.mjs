const { run, DIFFICULTIES, SHIFT_SHAPES } = await import('./fair.mjs');
// TUNE=gauntlet measures the other profile; see src/tuning.js.
const TUNE = process.env.TUNE || 'classic';
let fails = 0, runs = 0;
const modeSets = [
  { twin: false, pulse: false, shift: false, label: 'base' },
  { twin: true, pulse: false, shift: false, label: 'twin' },
  { twin: false, pulse: true, shift: false, label: 'pulse' },
  { twin: false, pulse: false, shift: true, label: 'shift' },
  { twin: true, pulse: false, shift: true, label: 'twin+shift' },
];
for (let d = 0; d < DIFFICULTIES.length; d++) {
  for (const m of modeSets) {
    for (const seed of [1, 7, 12345, 99991]) {
      const r = await run(d, { seed, ...m });
      runs++;
      if (r.died) { fails++; console.log(`DIED ${DIFFICULTIES[d].id} ${m.label} seed=${seed} t=${r.t.toFixed(2)}`); }
    }
  }
}
for (const sides of SHIFT_SHAPES) {
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    for (const seed of [3, 42, 777]) {
      const r = await run(d, { seed, twin: false, pulse: false, shift: false, forceSides: sides });
      runs++;
      if (r.died) { fails++; console.log(`DIED n=${sides} ${DIFFICULTIES[d].id} seed=${seed} t=${r.t.toFixed(2)}`); }
    }
  }
}
console.log(`\n${runs - fails}/${runs} clean 75s runs`);
