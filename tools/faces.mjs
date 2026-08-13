// Only the incoming face should kill. Three things must hold: head-on still
// kills, brushing a wall that has already swept past does not, and nothing can
// step over the lethal band between frames even at the fastest stage.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const rk = Object.keys; Object.keys = (o) => (o === globalThis.localStorage ? [...store.keys()] : rk(o));
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { DIFFICULTIES } = await import('../src/config.js');

function fresh(d = 0) {
  const g = new Game({});
  g.unlocked = new Set(DIFFICULTIES.map((x) => x.unlockedBy).filter(Boolean));
  g.diffIndex = d; g.daily = false; g.setView(1280, 720, 760);
  g.start();
  g.walls.length = 0;
  return g;
}

// --- A: head-on. Sit in the lane, let a thick wall arrive.
{
  const g = fresh();
  g.player.angle = 0.5 * g.step;
  g.walls.push({ slot: 0, dist: g.orbit + 200, len: 200, phase: 0, spin: 0, grazed: false, cleared: false });
  let died = false, at = null;
  for (let i = 0; i < 4000 && !died; i++) {
    g.walls[0].dist -= 1;
    if (g.playerHits(g.player.angle)) { died = true; at = g.walls[0].dist - g.orbit; }
  }
  console.log(`A head-on into a 200-unit wall: ${died ? 'DIES' : 'SURVIVES (bug)'}  (leading edge ${at?.toFixed(1)} units past the cursor)`);
}

// --- B: brushing. The wall has already swept past; slide into its lane.
{
  const g = fresh();
  const w = { slot: 0, dist: g.orbit - 60, len: 200, phase: 0, spin: 0, grazed: false, cleared: false };
  g.walls.push(w);
  g.player.angle = 0.5 * g.step;           // dead inside the wall's lane
  const spans = w.dist < g.orbit && w.dist + w.len > g.orbit;
  console.log(`B brushing the side of a wall being absorbed: ${g.playerHits(g.player.angle) ? 'DIES (bug)' : 'SURVIVES'}  (wall still spans the orbit: ${spans})`);
}

// --- C: tunnelling. Step a wall past the cursor at the fastest stage's top
// speed and confirm the hit is caught.
{
  let worst = null, missed = 0;
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    const g = fresh(d);
    g.t = 60;                                  // wound up to max speed
    const step = g.speed / 240;
    g.player.angle = 0.5 * g.step;
    for (let off = 0; off < 40; off++) {       // every sub-step phase offset
      g.walls.length = 0;
      const w = { slot: 0, dist: g.orbit + 120 + off * step / 40, len: 60, phase: 0, spin: 0, grazed: false, cleared: false };
      g.walls.push(w);
      let hit = false;
      while (w.dist > g.orbit - 200 && !hit) { w.dist -= step; if (g.playerHits(g.player.angle)) hit = true; }
      if (!hit) missed++;
    }
    worst = Math.max(worst ?? 0, step);
  }
  console.log(`C tunnelling across all stages x40 sub-step phases: ${missed} misses (max travel ${worst.toFixed(2)} units/step vs a ${24} unit band)`);
}
