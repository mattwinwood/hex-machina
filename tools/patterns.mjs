// What actually distinguishes one pattern from another now? Spacing used to,
// but arrivals are quantised to the beat, so all that is left is the gap
// choreography: how far you must travel between consecutive rings.
const { PATTERNS } = await import('../src/patterns.js');
const { rng } = await import('../src/rng.js');

const N = 6;
const mod = (a, b) => ((a % b) + b) % b;

function shape(p, seed) {
  rng.seed(seed);
  const walls = p.gen(N);
  const byDist = new Map();
  for (const w of walls) {
    const k = Math.round(w.dist);
    if (!byDist.has(k)) byDist.set(k, []);
    byDist.get(k).push(mod(w.slot, N));
  }
  const rings = [...byDist.entries()].sort((a, b) => a[0] - b[0])
    .map(([, slots]) => {
      const open = [];
      for (let s = 0; s < N; s++) if (!slots.includes(s)) open.push(s);
      return open;
    });
  return rings;
}

function travelBetween(a, b) {
  // Worst-case slots you must cross to get from some opening in a to one in b.
  let worst = 0;
  for (const x of a) {
    let best = 99;
    for (const y of b) {
      let d = Math.abs(x - y);
      d = Math.min(d, N - d);
      best = Math.min(best, d);
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

console.log('pattern           tier  rings  gaps/ring  travel per ring (slots)   signature');
for (const p of PATTERNS) {
  const travels = [];
  let rings = 0, gaps = 0;
  for (let s = 1; s <= 40; s++) {
    const r = shape(p, s * 7919);
    if (!r.length) continue;
    rings += r.length;
    gaps += r.reduce((a, x) => a + x.length, 0) / r.length;
    for (let i = 0; i + 1 < r.length; i++) travels.push(travelBetween(r[i], r[i + 1]));
  }
  const mean = travels.length ? travels.reduce((a, b) => a + b, 0) / travels.length : 0;
  const hist = [0, 0, 0, 0];
  for (const t of travels) hist[Math.min(3, t)]++;
  const sig = hist.map((n) => Math.round(n / Math.max(1, travels.length) * 9)).join('');
  console.log(`${p.name.padEnd(17)} ${String(p.tier).padStart(3)}  ${String(Math.round(rings / 40)).padStart(5)}  ${(gaps / 40).toFixed(2).padStart(8)}  ${mean.toFixed(2).padStart(12)}              ${sig}`);
}
console.log('\nsignature = share of ring-to-ring travels needing 0 / 1 / 2 / 3+ slots');
