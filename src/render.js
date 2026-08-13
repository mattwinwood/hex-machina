// Canvas renderer. World space is drawn under a translate/rotate/scale
// transform so wall geometry can be written in plain world units; the HUD is
// drawn afterwards in screen space.

import {
  TAU, CORE_RADIUS, PLAYER_ORBIT, PLAYER_SIZE, WORLD_HEIGHT,
  MAX_CHARGES, SECONDS_PER_CHARGE, DIFFICULTIES, CREDIT, CREDIT_SEP,
  CHECKPOINTS, RANKS, BADGES, ASSIST_MIN, PORTRAIT_FRAMING, mod, lerp, clamp,
} from './config.js';
import {
  roundRectPath, chamferPath, hexPath, withGlow, panel, toggle, ICONS,
  tokens, layoutBlocks, drawBlocks, listRow,
} from './ui.js';

const FONT = '"Archivo Black", "Arial Black", "Helvetica Neue", sans-serif';

// Whether to speak in taps or in keys. Evaluated live rather than latched at
// load: hybrid laptops, devtools device emulation and a plugged-in keyboard can
// all change the answer mid-session. `setTouchMode` lets the actual last input
// win, which beats guessing from the media query alone.
const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
const MOBILE_UA = IOS || /Android|Mobile/i.test(navigator.userAgent);

// Only a real input event pins this. Until one arrives the capability checks are
// re-read every time rather than latched at import, because a media query can
// resolve differently once the page has actually laid out.
let touchOverride = null;
function detectTouch() {
  if (touchOverride !== null) return touchOverride;
  return !!(coarse && coarse.matches) || (navigator.maxTouchPoints || 0) > 0 || MOBILE_UA;
}
export function setTouchMode(isTouch) {
  touchOverride = isTouch;
}
export function touchMode() {
  return detectTouch();
}

/** iOS has no Fullscreen API on the phone, so the control must not be offered. */
export function fullscreenSupported() {
  const el = document.documentElement;
  return !IOS && !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

// The menu is laid out once per frame and the result cached here, so hit
// testing reads the exact rectangles that were drawn. Fractional guesses drift
// the moment a row changes height.
let menuBoxes = null;

// The wordmark is a bitmap with its glow already baked in, so it must never be
// tinted or re-glowed — just drawn at the right size. Falls back to type if it
// hasn't decoded yet (or fails to), so the title screen is never empty.
const logo = new Image();
let logoReady = false;
logo.onload = () => { logoReady = true; };
logo.src = 'assets/wordmark.png';

// Recolouring the mark per stage means hue-rotating a bitmap, which is far too
// costly to do every frame — so it is baked once per hue bucket and reused.
// White stays white under hue-rotate (zero saturation), so "HEX" is unaffected
// and only the magenta half takes the stage colour.
const LOGO_BASE_HUE = 300;
let tintCanvas = null;
let tintKey = '';

function tintedLogo(hue) {
  const bucket = Math.round(mod(hue, 360) / 4) * 4;
  const key = String(bucket);
  if (key === tintKey && tintCanvas) return tintCanvas;
  if (!logoReady || !logo.naturalWidth) return null;
  if (!tintCanvas) tintCanvas = document.createElement('canvas');
  tintCanvas.width = logo.naturalWidth;
  tintCanvas.height = logo.naturalHeight;
  const c = tintCanvas.getContext('2d');
  c.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
  const shift = bucket - LOGO_BASE_HUE;
  // Browsers without canvas filter support just get the artwork untouched.
  if ('filter' in c) c.filter = `hue-rotate(${shift}deg)`;
  c.drawImage(logo, 0, 0);
  if ('filter' in c) c.filter = 'none';
  tintKey = key;
  return tintCanvas;
}

// Shared by the game-over "menu" link and its hit test, so the label and the
// tappable band cannot drift apart.
const MENU_LINK_ROW = 0.88;

function hit(box, x, y, slop = 0) {
  return !!box && x >= box.x - slop && x <= box.x + box.w + slop && y >= box.y - slop && y <= box.y + box.h + slop;
}

/** What a tap on the menu means. Returns null when it hits nothing. */
export function menuHit(view, x, y) {
  const b = menuBoxes;
  if (!b) return { type: 'start' };
  if (hit(b.board, x, y)) return { type: 'board' };
  if (hit(b.play, x, y, 8)) return { type: 'start' };
  if (hit(b.howto, x, y, 10)) return { type: 'howto' };
  if (b.stats && hit(b.stats, x, y, 10)) return { type: 'stats' };
  return { type: 'none' };
}

/** True when a tap on the game-over screen landed on the "menu" link. */
export function deathHitMenu(view, x, y) {
  const u = Math.min(view.w, view.h) / 100;
  const slop = detectTouch() ? Math.max(u * 4, 26) : u * 4;
  return Math.abs(y - view.h * 0.955) <= slop;
}

/**
 * Corner buttons. One definition drives both drawing and hit-testing so the
 * icon and its tap target can never drift apart.
 */
export function controlRects(g, view) {
  const u = Math.min(view.w, view.h) / 100;
  const size = Math.max(detectTouch() ? 48 : 40, u * 9.5);
  const pad = Math.max(12, u * 3);
  const left = (view.safeLeft || 0) + pad;
  const right = view.w - (view.safeRight || 0) - pad - size;
  const top = (view.safeTop || 0) + pad;
  const bottom = view.h - (view.safeBottom || 0) - pad - size;
  const out = [];
  if (g.state === 'play' && !g.paused) {
    out.push({ id: 'pause', icon: 'pause', x: left, y: top, w: size, h: size });
  }
  if (g.state === 'menu' && !g.overlay) {
    // The title screen carries its own top bar: music and scoreboard. Sound was
    // one row inside a settings sheet; it is the only setting anyone reaches for
    // in a hurry, so it is now the button itself rather than a door to a sheet.
    out.push({ id: 'mute', icon: g.muted ? 'muted' : 'sound', x: left, y: top, w: size, h: size });
    // Installing is the more valuable action for someone who does not have the
    // game on their home screen yet; stats move into settings while it is there.
    out.push(g.installed
      ? { id: 'stats', icon: 'chart', x: right, y: top, w: size, h: size }
      : { id: 'install', icon: 'install', x: right, y: top, w: size, h: size });
  }
  if ((g.overlay || g.paused) && !(g.teach && g.teach.waiting)) {
    out.push({ id: 'close', icon: 'close', x: right, y: top, w: size, h: size });
  }
  if (g.paused && !(g.teach && g.teach.waiting)) {
    out.push({ id: 'mute', icon: g.muted ? 'muted' : 'sound', x: left, y: bottom, w: size, h: size });
    if (fullscreenSupported()) {
      out.push({ id: 'fullscreen', icon: 'expand', x: right, y: bottom, w: size, h: size });
    }
  }
  return out;
}

/** Which button a press landed on, if any. Generous by a fifth of a button. */
export function controlAt(g, view, x, y) {
  const rects = controlRects(g, view);
  for (const r of rects) {
    if (hit(r, x, y, r.w * 0.22)) return r.id;
  }
  return null;
}

function hsl(h, s, l) {
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
}

// Rebuilding six colour strings every frame is pure garbage; the palette only
// changes meaningfully every degree of hue or 2% of inversion.
let palCache = null;
let palKey = '';

export function palette(hue, invert = 0) {
  const H = mod(hue, 360);
  const key = `${H | 0}:${(invert * 50) | 0}`;
  if (key === palKey) return palCache;
  palKey = key;
  palCache = {
    H,
    bgA: hsl(H, 62, lerp(14, 40, invert)),
    bgB: hsl(H, 58, lerp(8, 26, invert)),
    core: hsl(H, 55, lerp(6, 20, invert)),
    fg: hsl(H, 88, lerp(62, 94, invert)),
    // The body of a wall, behind its lit leading edge. Super Hexagon's walls
    // read as extruded blocks rather than flat bands: a bright face towards the
    // core and a darker mass behind it. That depth is also a readability win —
    // the edge you actually have to clear is the brightest thing on screen.
    wallSide: hsl(H, 80, lerp(38, 66, invert)),
    player: hsl(H, 40, lerp(97, 100, invert)),
    accent: hsl(mod(H + 150, 360), 90, 70),
    text: hsl(H, 30, lerp(95, 100, invert)),
  };
  return palCache;
}

// How deep the lit leading edge of a wall is, in world units.
const WALL_EDGE = 13;

/**
 * The framing zoom copied from Super Hexagon assumes a landscape screen: it is
 * calibrated against the *short* axis, and on a 16:9 phone held upright that
 * axis is the width, which is tiny. The result was a playable-looking landscape
 * frame and a brutal portrait one, because visible world radius — and therefore
 * how much warning a wall gives — is set by the short axis alone.
 *
 * So the tighter framing is spent only where there is room for it. Wide screens
 * get the full zoom; tall ones keep the older, roomier view.
 */
function framingZoom(w, h) {
  const aspect = w / h;
  return lerp(PORTRAIT_FRAMING, 1, clamp((aspect - 0.62) / (1.2 - 0.62), 0, 1));
}

const cosT = (a) => Math.cos(a);
const sinT = (a) => Math.sin(a);

function polyPath(ctx, r, sides) {
  ctx.beginPath();
  const step = TAU / sides;
  for (let i = 0; i < sides; i++) {
    const a = i * step;
    const x = cosT(a) * r;
    const y = sinT(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Shape change, drawn as a blend. Sampling both polygons' radii around the
 * circle and interpolating gives a shape that grows and loses corners smoothly,
 * which a straight vertex-to-vertex tween cannot do across differing counts.
 */
function morphPath(ctx, r, fromSides, toSides, k) {
  if (k >= 1 || fromSides === toSides) return polyPath(ctx, r, toSides);
  const N = 96;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const ra = lerp(polyRadius(a, fromSides), polyRadius(a, toSides), k) * r;
    const x = cosT(a) * ra;
    const y = sinT(a) * ra;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Radius of a unit polygon (circumradius 1) at angle `a`. */
function polyRadius(a, sides) {
  const step = TAU / sides;
  const half = step / 2;
  const off = mod(a, step) - half;
  return Math.cos(half) / Math.cos(off);
}

/** A wall face: a straight chord ring segment between two radii. */
function wallPath(ctx, slot, phase, r0, r1, step) {
  const a0 = slot * step + phase;
  const a1 = a0 + step;
  const c0 = cosT(a0);
  const s0 = sinT(a0);
  const c1 = cosT(a1);
  const s1 = sinT(a1);
  ctx.beginPath();
  ctx.moveTo(c0 * r0, s0 * r0);
  ctx.lineTo(c1 * r0, s1 * r0);
  ctx.lineTo(c1 * r1, s1 * r1);
  ctx.lineTo(c0 * r1, s0 * r1);
  ctx.closePath();
}

export function render(ctx, g, view) {
  const { w, h } = view;
  const pal = palette(g.hue + (g.shimmer || 0), g.cam.invert);
  const scale = (Math.min(w, h) / WORLD_HEIGHT) * g.cam.zoom * framingZoom(w, h);

  // Smooth over the slice of time the fixed-step sim has not simulated yet.
  const ahead = g.state === 'play' && !g.paused ? g.alpha : 0;
  // A few degrees of camera lead in the direction of travel: enough to feel
  // like momentum, small enough that it never disorients.
  const rot = g.cam.rot + (g.spin || 0) * ahead - (g.lean || 0) * 0.045;
  const slide = g.speed * ahead;
  const viewR = (view.coverR ?? Math.hypot(w, h) / 2) / scale + 40;
  // The menu core is decorative and must not overlap the panels, so it scales to
  // whatever vertical band the stack leaves free.
  const band = g.state === 'menu' ? Math.max(60, menuMetrics(view).stackTop - menuMetrics(view).titleBottom) : 0;

  ctx.save();
  ctx.fillStyle = pal.bgB;
  ctx.fillRect(0, 0, w, h);

  const shake = g.cam.shake * 16;
  const sx = shake ? (Math.random() - 0.5) * shake : 0;
  const sy = shake ? (Math.random() - 0.5) * shake : 0;

  const centreY = g.state === 'menu' ? menuCoreY(view) : (view.cy ?? h / 2);
  ctx.translate((view.cx ?? w / 2) + sx, centreY + sy);
  ctx.scale(scale, scale);
  ctx.rotate(rot);

  drawBackground(ctx, pal, viewR, g.sides, g.step);
  drawWalls(ctx, g, pal, slide, viewR);
  drawCore(ctx, g, pal);
  drawPlayer(ctx, g, pal);
  drawParticles(ctx, g, pal);

  ctx.restore();

  if (g.slowing) drawSlowMo(ctx, view, pal);

  if (g.cam.flash > 0.001) {
    ctx.fillStyle = `rgba(255,255,255,${(g.cam.flash * 0.5).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }

  drawHud(ctx, g, view, pal);
}

/** Bullet time reads as a cool vignette closing in from the edges. */
function drawSlowMo(ctx, view, pal) {
  const { w, h } = view;
  const cx = view.cx ?? w / 2;
  const cy = view.cy ?? h / 2;
  const r = Math.max(w, h) * 0.75;
  const grad = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
  grad.addColorStop(0, 'rgba(120,190,255,0)');
  grad.addColorStop(1, 'rgba(90,150,255,0.34)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawBackground(ctx, pal, viewR, sides, step) {
  const R = viewR * 1.2;
  ctx.fillStyle = pal.bgA;
  // An odd side count cannot alternate over whole faces, so odd arenas are
  // striped at half-face resolution instead — which always alternates cleanly
  // and keeps the pentagon from showing one huge asymmetric seam.
  const odd = sides % 2 === 1;
  const count = odd ? sides * 2 : sides;
  const wedge = odd ? step / 2 : step;
  for (let i = 0; i < count; i += 2) {
    const a0 = i * wedge;
    const a1 = a0 + wedge;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(cosT(a0) * R, sinT(a0) * R);
    ctx.lineTo(cosT(a1) * R, sinT(a1) * R);
    ctx.closePath();
    ctx.fill();
  }
}

function drawWalls(ctx, g, pal, slide, viewR) {
  ctx.fillStyle = pal.fg;

  // Walls retired by a reshape dissolve on their own step count, so they stay
  // correctly drawn while the arena morphs out from under them.
  for (const f of g.fading) {
    const d = f.dist - slide;
    if (d > viewR) continue;
    const r0 = d > CORE_RADIUS ? d : CORE_RADIUS;
    let r1 = d + f.len;
    if (r1 <= r0) continue;
    if (r1 > viewR) r1 = viewR;
    ctx.globalAlpha = Math.max(0, 1 - f.age / f.life);
    wallPath(ctx, f.slot, f.phase, r0, r1, f.step);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const walls = g.walls;
  // Two passes so the lit edges all sit on top of the bodies, rather than a
  // nearer wall's body cutting into a further wall's edge.
  ctx.fillStyle = pal.wallSide;
  for (let i = 0; i < walls.length; i++) {
    const wl = walls[i];
    const d = wl.dist - slide;
    if (d > viewR) continue; // still off screen — nothing to rasterise
    const r0 = d > CORE_RADIUS ? d : CORE_RADIUS;
    let r1 = d + wl.len;
    if (r1 <= r0) continue;
    if (r1 > viewR) r1 = viewR; // clip enormous off-screen polygons
    wallPath(ctx, wl.slot, wl.phase, r0, r1, g.step);
    ctx.fill();
  }

  ctx.fillStyle = pal.fg;
  for (let i = 0; i < walls.length; i++) {
    const wl = walls[i];
    const d = wl.dist - slide;
    if (d > viewR) continue;
    const r0 = d > CORE_RADIUS ? d : CORE_RADIUS;
    const r1 = Math.min(d + wl.len, viewR);
    if (r1 <= r0) continue;
    // The lit face: a fixed slice of the leading edge, never the whole wall, so
    // a 200-unit tunnel wall still reads as one edge rather than a slab.
    const lip = Math.min(r1, r0 + Math.min(WALL_EDGE, (r1 - r0) * 0.55));
    wallPath(ctx, wl.slot, wl.phase, r0, lip, g.step);
    ctx.fill();
  }
}

/**
 * The charge meter, inside the core. Segmented rather than continuous because
 * charges are the unit you spend — a smooth bar would hide how many you hold.
 */
function drawCharges(ctx, g, pal, coreR) {
  const held = g.stamina / SECONDS_PER_CHARGE;
  // The core is a polygon, and its *inradius* — the distance to the middle of an
  // edge, which is where it comes closest to the middle — collapses as it loses
  // sides: cos(pi/6) = 0.87 of the circumradius for a hexagon, but cos(pi/3) =
  // 0.50 for a triangle. A ring at a fixed fraction of the circumradius
  // therefore sat comfortably inside a hexagon and *outside the edges* of a
  // triangle. Anchoring to the inradius keeps the gap constant in every shape,
  // and interpolating it through a morph exactly as morphPath does keeps it
  // constant while the shape is changing too.
  const inr = g.morph >= 1 || g.morphFrom === g.sides
    ? Math.cos(Math.PI / g.sides)
    : lerp(Math.cos(Math.PI / g.morphFrom), Math.cos(Math.PI / g.sides), g.morph);
  // 0.716 of the inradius is what 0.62 of the circumradius used to be on a
  // hexagon, so the shape everyone sees most is left looking exactly as it did.
  const r = coreR * inr * 0.716;
  const step = TAU / MAX_CHARGES;
  const inset = step * 0.14;

  for (let i = 0; i < MAX_CHARGES; i++) {
    const fill = Math.max(0, Math.min(1, held - i));
    const a0 = -Math.PI / 2 + i * step + inset;
    const a1 = -Math.PI / 2 + (i + 1) * step - inset;

    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 4;
    ctx.stroke();

    if (fill <= 0.001) continue;
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a0 + (a1 - a0) * fill);
    ctx.strokeStyle = g.slowing ? pal.player : pal.accent;
    ctx.lineWidth = g.slowing ? 6 : 4.6;
    ctx.stroke();
  }
}

/** Debris from the cursor coming apart. */
function drawParticles(ctx, g, pal) {
  if (!g.particles.length) return;
  ctx.fillStyle = pal.player;
  for (const p of g.particles) {
    const k = 1 - p.age / p.life;
    ctx.globalAlpha = Math.max(0, k);
    const s = p.size * (0.4 + k * 0.6);
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

function drawCore(ctx, g, pal) {
  const menu = g.state === 'menu';
  const r = g.coreRadius * (1 + 0.07 * g.pulse) * (menu ? (g.menuCoreScale ?? 1.2) : 1);

  if (g.pulse > 0.02) {
    ctx.globalAlpha = 0.28 * g.pulse;
    ctx.strokeStyle = pal.fg;
    ctx.lineWidth = 3;
    morphPath(ctx, r * 1.62, g.morphFrom, g.sides, g.morph);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Opaque fill first, glowing stroke second. shadowBlur bleeds inward as well
  // as outward, so the fill has to be underneath it — and the glowing stroke has
  // to be last, or a crisp stroke on top erases the glow it was meant to have.
  ctx.lineJoin = 'miter';
  morphPath(ctx, r, g.morphFrom, g.sides, g.morph);
  ctx.fillStyle = menu ? '#07030a' : pal.core;
  ctx.fill();
  // Neon is two passes: a wide soft bloom, then a tight bright filament on top.
  // One pass just looks like a blurry line.
  withGlow(ctx, pal.fg, menu ? 30 : 16, () => {
    ctx.strokeStyle = pal.fg;
    ctx.lineWidth = menu ? 6 : 4.5;
    ctx.stroke();
  });
  withGlow(ctx, pal.fg, menu ? 10 : 6, () => {
    ctx.strokeStyle = pal.player;
    ctx.lineWidth = menu ? 2.2 : 1.8;
    ctx.stroke();
  });

  // Pass the core's drawn radius, not g.coreRadius: the core breathes with the
  // beat, and a meter that ignored the breathing had a gap that changed size.
  if (g.state === 'play' || g.state === 'dead') drawCharges(ctx, g, pal, r);
}

function drawPlayer(ctx, g, pal) {
  if (g.state === 'dead') return; // the cursor is debris now
  if (g.graze.flash > 0.01) {
    withGlow(ctx, pal.accent, 18 * g.graze.flash, () => {
      ctx.beginPath();
      const gr = orbitAt(g, g.player.angle);
      ctx.arc(cosT(g.player.angle) * gr, sinT(g.player.angle) * gr,
        PLAYER_SIZE * (1.4 + g.graze.flash), 0, TAU);
      ctx.strokeStyle = pal.accent;
      ctx.globalAlpha = g.graze.flash;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }
  drawCursor(ctx, g.player.angle, g, pal);
  if (g.twin) drawCursor(ctx, g.player.angle + Math.PI, g, pal);
}

/**
 * How far out the cursor sits at a given angle. The arena is a polygon, so a
 * constant radius would be a circle floating above it — the cursor follows the
 * faces instead, keeping the same clearance all the way along each one. Blended
 * through a shape change so it tracks the morphing arena rather than snapping.
 */
function orbitAt(g, a) {
  const to = polyRadius(a, g.sides);
  const from = g.morph >= 1 || g.morphFrom === g.sides ? to : polyRadius(a, g.morphFrom);
  return (g.orbit || PLAYER_ORBIT) * lerp(from, to, g.morph);
}

function drawCursor(ctx, a, g, pal) {
  // Bank into the turn and stretch along the direction of travel. Both are
  // render-only: `player.angle` — the thing collision uses — never moves.
  const lean = g.lean || 0;
  const banked = a + lean * 0.20;
  const ux = cosT(banked);
  const uy = sinT(banked);
  const vx = -uy;
  const vy = ux;
  const speedy = Math.abs(lean);
  const ring = orbitAt(g, a);
  const base = ring - 3;
  const tip = ring + PLAYER_SIZE * (g.slowing ? 1.25 : 1) * (1 + 0.22 * speedy);
  const half = PLAYER_SIZE * 0.72 * (1 - 0.28 * speedy);

  // A smear trailing the direction of travel, strongest at full turn rate.
  const smear = g.slowing ? 1 : speedy;
  if (smear > 0.08) {
    const back = a - lean * 0.30;
    const bx = cosT(back);
    const by = sinT(back);
    ctx.globalAlpha = 0.42 * smear;
    ctx.fillStyle = pal.player;
    ctx.beginPath();
    ctx.moveTo(ux * tip, uy * tip);
    ctx.lineTo(bx * (base - 2) + -by * half * 0.55, by * (base - 2) + bx * half * 0.55);
    ctx.lineTo(bx * (base - 2) - -by * half * 0.55, by * (base - 2) - bx * half * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.moveTo(ux * tip, uy * tip);
  ctx.lineTo(ux * base + vx * half, uy * base + vy * half);
  ctx.lineTo(ux * base - vx * half, uy * base - vy * half);
  ctx.closePath();
  ctx.fillStyle = pal.player;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke();
}

function fmtTime(t) {
  const s = Math.floor(t);
  const cs = Math.floor((t - s) * 100);
  return `${s}:${String(cs).padStart(2, '0')}`;
}

// Setting ctx.font re-parses the font shorthand every time, so only touch it
// when it actually changes — the HUD draws a dozen strings a frame.
let lastFont = '';
/**
 * Canvas resolves `ctx.font` at assignment time, so any size first set while the
 * webfont was still loading stays bound to the fallback — and `lastFont` would
 * stop us ever reassigning it. Called once the font arrives.
 */
export function invalidateFontCache() {
  lastFont = '';
}

function setFont(ctx, size) {
  const f = `${size.toFixed(1)}px ${FONT}`;
  if (f !== lastFont) {
    ctx.font = f;
    lastFont = f;
  }
}

// Outlined rather than drop-shadowed: the field behind the HUD can be any
// colour from near-black to full-brightness wall, and only a stroke survives both.
function text(ctx, str, x, y, size, color, align = 'center', alpha = 1) {
  setFont(ctx, size);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.globalAlpha = 1;
}

/**
 * Largest size at or below `size` that still fits `str` inside `maxW`. Phase
 * names describe what changed now, so they are sentences rather than single
 * words and can no longer be drawn at a fixed size.
 */
function fitSize(ctx, str, size, maxW) {
  setFont(ctx, size);
  const wide = ctx.measureText(str).width;
  return wide <= maxW ? size : Math.max(8, size * (maxW / wide));
}

function drawHud(ctx, g, view, pal) {
  const { w, h } = view;
  const u = Math.min(w, h) / 100;
  const padR = (view.safeRight || 0) + u * 3;
  const padL = (view.safeLeft || 0) + u * 3;
  const padT = (view.safeTop || 0);
  // The pause button owns the top-left corner whenever it is drawn — on every
  // device, not just touch — so the labels start to the right of it rather than
  // underneath. Autopilot is what made the collision obvious.
  const pauseW = controlRects(g, view).reduce(
    (m, r) => (r.y < h * 0.5 && r.x < w * 0.5 ? Math.max(m, r.x + r.w) : m), 0,
  );
  const labelX = pauseW > 0 ? pauseW + u * 2.5 : padL;
  // The mirror of the above. Pausing puts a close button in the top-right, and
  // the clock was being drawn straight underneath it.
  const topRightX = controlRects(g, view).reduce(
    (m, r) => (r.y < h * 0.5 && r.x > w * 0.5 ? Math.min(m, r.x) : m), w,
  );
  const rightX = Math.min(w - padR, topRightX - u * 2.5);

  // The game-over sheet shows the clock at size; duplicating it in the corner
  // just competes with itself.
  if (g.state === 'play') {
    // Sizes come from the token ramp, not from `u`. At u*2.2 the status lines
    // were rendering at 8.25 CSS px on a phone — below Apple's 11pt absolute
    // floor, and the reason the top-left stack was unreadable.
    const t9 = tokens(view);
    const lineH = t9.type.footnote * t9.lineHeight;

    // Right column: the clock, and whatever stacks under it.
    let ry = padT + t9.space.lg + t9.type.title3 / 2;
    text(ctx, `TIME  ${fmtTime(g.t)}`, rightX, ry, t9.type.title3, pal.text, 'right');
    ry += t9.type.title3 / 2 + lineH * 0.8;
    text(ctx, `BEST  ${fmtTime(g.best)}`, rightX, ry, t9.type.footnote, pal.text, 'right', t9.emphasis.secondary);

    // Left column, top-aligned with the clock and clear of the pause button.
    let ly = padT + t9.space.lg + t9.type.title3 / 2;
    // The stage name is a title card, not a permanent label: it identifies the
    // run for a couple of seconds and then gets out of the way.
    const nameFade = Math.max(0, Math.min(1, (2.6 - g.t) * 1.4));
    if (nameFade > 0.01) {
      text(ctx, g.diff.name, labelX, ly, t9.type.footnote, pal.text, 'left', t9.emphasis.secondary * nameFade);
    }
    ly += lineH;
    // One status line, never two stacked on the same baseline. Whatever is most
    // urgent owns it; the rest are joined onto the row beneath.
    {
      // Keep clear of the clock on the other side of the top bar.
      const room = w - padR - labelX - t9.space.xxl * 3;
      const blink = g.broken ? 0.6 + 0.4 * Math.sin(performance.now() / 120) : 0.45;
      const want = g.broken ? t9.type.subhead : t9.type.footnote;
      const size = fitSize(ctx, g.phase.name, want, room);
      text(ctx, g.phase.name, labelX, ly, size, g.broken ? pal.fg : pal.text, 'left', blink);
      ly += lineH;
    }
    // Twin runs in windows, so the label counts down to whichever edge is next.
    if (g.twinSeed && g.twinNext != null) {
      const left = Math.max(0, Math.ceil(g.twinNext - g.t));
      const near = !g.twin && g.twinNext - g.t < 5;
      const blink = near ? 0.45 + 0.45 * Math.sin(g.t * 12) : 0.5;
      const label = g.twin ? `TWIN MODE  ${left}s` : `TWIN IN ${left}s`;
      text(ctx, label, labelX, ly, t9.type.footnote, g.twin || near ? pal.fg : pal.text, 'left', blink);
    }
    if (g.practice) {
      text(ctx, `PRACTICE FROM ${g.practiceFrom}s  ·  NO RECORD`, w / 2, padT + t9.space.xxl,
        t9.type.footnote, pal.text, 'center', t9.emphasis.secondary);
    }
    // Graze chain sits under the clock: it is the other score.
    if (g.graze.chain > 0) {
      const pop = 1 + g.graze.flash * 0.35;
      ry += lineH * 0.9 + t9.type.title3 / 2;
      text(ctx, `x${g.multiplier.toFixed(1)}`, rightX, ry, t9.type.title3 * pop, pal.accent, 'right', 1);
      ry += t9.type.title3 / 2 + lineH * 0.7;
      text(ctx, `${g.graze.chain} GRAZE`, rightX, ry, t9.type.caption, pal.text, 'right', t9.emphasis.secondary);
    }
  }

  // The twin cue fires mid-run, while you are reading the field, so it stays out
  // of the play area entirely: a brief strip low on the screen, well below the
  // arena, rather than a card across the middle. The particle burst at the
  // arrival point and the sting carry the actual "look here".
  if (g.twinFlash > 0 && g.state === 'play') {
    const a = Math.min(1, g.twinFlash * 2.2); // fades out over the last ~0.45s
    const cueY = h - (view.safeBottom || 0) - u * (g.demo ? 12 : 6);
    const label = g.twin ? 'TWIN MODE' : 'TWIN MODE OFF';
    const tone = g.twin ? pal.fg : pal.text;
    setFont(ctx, u * 2.8);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(w / 2 - tw / 2 - u * 2, cueY - u * 2.2, tw + u * 4, u * 4.4);
    text(ctx, label, w / 2, cueY, u * 2.8, tone, 'center', a);
  }

  if (g.rankFlash > 0 && g.rankName && g.state === 'play') {
    const k = Math.min(1, (1.6 - g.rankFlash) * 6);
    const a = Math.min(1, g.rankFlash * 1.6);
    ctx.save();
    ctx.translate(w / 2, h * 0.24);
    const s = lerp(1.6, 1, k);
    ctx.scale(s, s);
    // Two clauses read better stacked than strung across the screen, and the
    // fit is computed inside the scaled space so the zoom-in never overflows.
    const lines = g.rankName.split(' · ');
    const maxW = (w * 0.88) / s;
    const size = Math.min(...lines.map((ln) => fitSize(ctx, ln, u * 6, maxW)));
    lines.forEach((ln, i) => {
      text(ctx, ln, 0, (i - (lines.length - 1) / 2) * size * 1.2, size, pal.text, 'center', a);
    });
    ctx.restore();
  }

  if (g.teach) drawTeach(ctx, g, view, pal, u);
  if (g.overlay) drawOverlay(ctx, g, view, pal, u);
  else if (g.state === 'menu') drawMenu(ctx, g, view, pal, u);
  else if (g.state === 'dead') drawGameOver(ctx, g, view, pal, u);
  // A tutorial hold is a pause, but the lesson card is the message — the
  // PAUSED sheet on top of it just buries the thing they are meant to read.
  else if (g.paused && !(g.teach && g.teach.waiting)) drawPaused(ctx, g, view, pal, u);

  if (g.slowing) {
    text(ctx, 'SLOW', w / 2, (view.safeTop || 0) + u * 5, u * 3.4, pal.player, 'center', 0.9);
  }

  if (g.demo) {
    const y = h - (view.safeBottom || 0) - u * 4;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, y - u * 3.4, w, u * 6.4);
    text(ctx, 'AUTOPILOT', u * 3, y, u * 2.6, pal.fg, 'left', 0.95);
    text(ctx, g.demoLabel || '', w / 2, y, u * 2.4, pal.text, 'center', 0.9);
    text(ctx, 'ANY KEY / TAP TO STOP', w - u * 3, y, u * 2, pal.text, 'right', 0.6);
  } else if (g.muted && !detectTouch()) {
    text(ctx, 'MUTED', u * 3, h - u * 3.5, u * 2.2, pal.text, 'left', 0.5);
  }
  drawControls(ctx, g, view, pal);
}

/** Corner buttons: the only way to pause or mute without a keyboard. */
/** Corner buttons: hexagon frames, matching the core's geometry. */
function drawControls(ctx, g, view, pal) {
  const rects = controlRects(g, view);
  for (const r of rects) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    hexPath(ctx, cx, cy, r.w * 0.52, Math.PI / 6);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const k = r.w * 0.26;
    if (r.icon === 'sound' || r.icon === 'muted') ICONS.sound?.(ctx, cx, cy, k, pal.text, r.icon === 'muted');
    else ICONS[r.icon]?.(ctx, cx, cy, k, pal.text);
  }
}

let teachSkipBox = null;

/** Where a tap counts as "skip the tutorial", if the card is up. */
export function teachSkipHit(view, x, y) {
  const b = teachSkipBox;
  return !!b && x >= b.x - 12 && x <= b.x + b.w + 12 && y >= b.y - 12 && y <= b.y + b.h + 12;
}

/**
 * The lesson card. Anchored to the bottom so the arena stays visible — the
 * player is being asked to look at the thing being described, not at a wall of
 * text over the top of it.
 */
function drawTeach(ctx, g, view, pal, u) {
  const { w, h } = view;
  const t = g.teach;
  teachSkipBox = null;
  if (!t) return;

  const touch = detectTouch();
  const body = touch ? t.touch : t.keys;
  const hint = touch ? t.hint.touch : t.hint.keys;

  // While the world is held still, dim it so the card is unmistakably the thing
  // to read. Once running, the card thins out and gets out of the way.
  if (t.waiting) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
  }

  // Content is declared, not positioned. ui.js types each block, wraps it and
  // hands back rows that already know their y — so the card can size itself to
  // its own copy and the title can never land on the first line again.
  const t9 = tokens(view);
  const padX = t9.space.xl;
  const padY = t9.space.lg;
  const cardW = Math.min(w - t9.space.lg * 2, t9.space.xxl * 13);
  const cx = w / 2;
  const colW = cardW - padX * 2;

  const blocks = [];
  if (t.waiting && t.snark) blocks.push({ kind: 'eyebrow', text: t.snark });
  blocks.push({ kind: 'title', text: t.title, trailing: `${t.stepNo}/${t.stepCount}` });
  if (t.waiting) blocks.push({ kind: 'body', text: body });
  blocks.push({ kind: 'cta', text: hint });
  if (t.waiting) blocks.push({ kind: 'link', text: touch ? 'SKIP' : 'SKIP  (ESC)' });

  const { height, rows } = layoutBlocks(ctx, blocks, t9, colW, setFont);
  const cardH = height + padY * 2;
  const cardY = h - (view.safeBottom || 0) - t9.space.xl - cardH;

  if (t.waiting) {
    panel(ctx, cx - cardW / 2, cardY, cardW, cardH, {
      radius: t9.radius.lg,
      fill: 'rgba(10,4,14,0.82)',
      glow: pal.fg,
      glowBlur: 18,
    });
  }

  // The call-to-action pulses; everything else holds still so the eye is drawn
  // to the one line that says what to do.
  const blink = 0.6 + 0.4 * Math.sin(performance.now() / 300);
  const colX = cx - colW / 2;
  const colY = cardY + padY;
  for (const r of rows) {
    const isCta = r.emphasis === 'primary' && r.size === t9.type.headline;
    const alpha = isCta ? (t.waiting ? blink : 0.55) : t9.emphasis[r.emphasis];
    const color = r.tone === 'accent' ? pal.fg : pal.text;
    if (r.size === t9.type.title3) {
      withGlow(ctx, pal.fg, 10, () => text(ctx, r.text, cx, colY + r.y, r.size, color, 'center', alpha));
    } else {
      text(ctx, r.text, cx, colY + r.y, r.size, color, 'center', alpha);
    }
    if (r.trailing) {
      text(ctx, r.trailing, colX + colW, colY + r.y, r.trailingSize, pal.text, 'right', t9.emphasis.tertiary);
    }
    // The skip target is the last row, sized to Apple's 44pt minimum.
    if (t.waiting && r.text.startsWith('SKIP')) {
      teachSkipBox = { x: cx - t9.hit, y: colY + r.y - t9.hit / 2, w: t9.hit * 2, h: t9.hit };
    }
  }

  // Point at the charge ring when that is what we are talking about.
  if (t.pointAtCore && t.waiting) {
    const scale = (Math.min(w, h) / WORLD_HEIGHT) * g.cam.zoom * framingZoom(w, h);
    const r = g.coreRadius * scale * 1.5;
    ctx.save();
    ctx.translate(w / 2, h * 0.43);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}


/**
 * The route to the home screen, which is genuinely different per browser — and
 * getting it wrong is worse than saying nothing, because the player follows the
 * instructions, fails to find the item, and concludes the game is broken.
 *
 * Chrome on iOS is the one people get stuck on: it has a Share sheet like
 * Safari, but "Add to Home Screen" is hidden behind "View more" rather than
 * sitting in the first list.
 *
 * No step tells anyone to open their browser. They are reading this in it.
 */
function installSteps() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const chromeIOS = /CriOS/.test(ua);
  const firefoxIOS = /FxiOS/.test(ua);

  if (ios && chromeIOS) {
    return [
      ['1', 'Tap the Share icon in the address bar.'],
      ['2', 'Tap "View more" to open the full list.'],
      ['3', 'Choose "Add to Home Screen", then Add.'],
    ];
  }
  if (ios && firefoxIOS) {
    return [
      ['1', 'Tap the menu button, then Share.'],
      ['2', 'Choose "Add to Home Screen", then Add.'],
    ];
  }
  if (ios) {
    return [
      ['1', 'Tap the Share icon at the bottom of Safari.'],
      ['2', 'Scroll down and choose "Add to Home Screen".'],
      ['3', 'Tap Add. Daily Hex opens full screen, no browser bars.'],
    ];
  }
  if (android) {
    return [
      ['1', 'Tap the ⋮ menu, top right.'],
      ['2', 'Choose "Install app" or "Add to Home screen".'],
      ['3', 'Confirm. Daily Hex opens in its own window.'],
    ];
  }
  return [
    ['1', 'Click the install icon in the address bar, or the ⋮ menu.'],
    ['2', 'Choose "Install Daily Hex".'],
    ['3', 'It opens in its own window, with no browser bars.'],
  ];
}

/** Full-screen sheet used by settings, scores and how-to-play. */
function drawOverlay(ctx, g, view, pal, u) {
  const { w, h } = view;
  // Type in real CSS pixels. Apple's floors: 17pt body, 13pt caption, 11pt
  // absolute minimum — none of which survive being specified in device pixels.
  // Identity: main.js does ctx.setTransform(dpr,...), so the drawing space is
  // already CSS pixels. Multiplying by dpr again drew every sheet 1.5x oversized,
  // which is what pushed the copy past its panels.
  const t9 = tokens(view);
  ctx.fillStyle = 'rgba(0,0,0,0.86)';
  ctx.fillRect(0, 0, w, h);

  const mu = Math.min(u, (h - (view.safeTop || 0) - (view.safeBottom || 0)) / 78);
  const panelW = Math.min(w * 0.9, mu * 108);
  const px = (w - panelW) / 2;
  let y = (view.safeTop || 0) + mu * 17;

  // Reset every frame: rows belong to whichever sheet is open right now. Leaving
  // the previous sheet's rows in place made them hittable behind the next one.
  overlayRows = [];

  const titles = { settings: 'SETTINGS', stats: 'BEST TIMES', howto: 'HOW TO PLAY', install: 'ADD TO HOME SCREEN' };
  const title = titles[g.overlay] || '';
  // The close button lives in the same band, so the title gets the width
  // between the corners — not the whole screen, which it was overrunning.
  // Start below the close button rather than beside it, then let a long title
  // wrap at full size: shrinking "ADD TO HOME SCREEN" to fit made the heading
  // smaller than the body text under it.
  const btn = controlRects(g, view).find((c) => c.id === 'close');
  if (btn) y = Math.max(y, btn.y + btn.h + mu * 3);
  // A little shrink before wrapping, floored well above body size: at full size
  // the longest title took three lines and dominated a short sheet.
  const tsize = Math.max(t9.type.title * 0.7, fitSize(ctx, title, t9.type.largeTitle, panelW));
  let titleEnd = y;
  withGlow(ctx, pal.fg, mu * 4, () => {
    titleEnd = wrapText(ctx, title, w / 2, y, panelW, tsize, tsize * 1.15, pal.fg, 1, 'center');
  });
  y = titleEnd + tsize * 0.6 + mu * 3;

  if (g.overlay === 'install') {
    // Only reached when the browser gave us no install prompt to fire — which
    // in practice means iOS, where the gesture is manual and unguessable.
    const steps = installSteps();
    const gutter = t9.space.xl;
    const colX = px + gutter;
    const colW = panelW - gutter;
    const blocks = steps.map(([n, line]) => ({ kind: 'body', text: line, leading: n }));
    const laid = layoutBlocks(ctx, blocks, t9, colW, setFont);
    for (const r of laid.rows) {
      text(ctx, r.text, colX, y + r.y, r.size, pal.text, 'left', t9.emphasis[r.emphasis]);
      if (r.leading) text(ctx, r.leading, px + gutter * 0.4, y + r.y, r.size, pal.fg, 'center', 0.9);
    }
    y += laid.height + t9.space.xl;
    const foot = layoutBlocks(ctx, [{ kind: 'link', text: 'It plays the same either way — installing just loses the browser bars.' }], t9, panelW - t9.space.xl, setFont);
    drawBlocks(ctx, foot.rows, px + t9.space.lg, y, panelW - t9.space.xl, pal, t9, text, 'center');
  } else if (g.overlay === 'stats') {
    // Streak and badges first — the daily framing puts habit above raw score.
    text(ctx, `STREAK  ${g.streakCount} DAY${g.streakCount === 1 ? '' : 'S'}`, w / 2, y,
      t9.type.headline, pal.fg, 'center', 0.95);
    y += t9.type.headline + t9.space.lg;
    // One column in portrait. Two half-width cells cannot hold a badge name and
    // its note at readable type on a phone — they spilled over each other.
    const cols = w > h ? 2 : 1;
    const gut = t9.space.md;
    const bw2 = (panelW - gut * (cols - 1)) / cols;
    const lineH = t9.type.footnote * t9.lineHeight;
    const cellH = Math.max(t9.hit, lineH * 2 + t9.space.lg);
    const step = cellH + t9.space.sm;
    const markX = t9.space.lg;
    const textX = markX + t9.space.lg;
    const room = bw2 - textX - t9.space.md;
    BADGES.forEach((b, i) => {
      const bx = px + (i % cols) * (bw2 + gut);
      const by = y + Math.floor(i / cols) * step;
      const got = g.badges.has(b.id);
      const row = listRow(ctx, bx, by, bw2, t9, { height: cellH, radius: t9.radius.md });
      hexPath(ctx, bx + markX, row.midY, t9.space.sm, Math.PI / 6);
      if (got) {
        withGlow(ctx, pal.fg, t9.space.md, () => { ctx.fillStyle = pal.fg; ctx.fill(); });
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      const nameSize = fitSize(ctx, b.name, t9.type.footnote, room);
      const noteSize = fitSize(ctx, b.note, t9.type.caption, room);
      text(ctx, b.name, bx + textX, row.midY - lineH * 0.5, nameSize, pal.text, 'left',
        got ? t9.emphasis.primary : t9.emphasis.tertiary);
      text(ctx, b.note, bx + textX, row.midY + lineH * 0.5, noteSize, pal.text, 'left',
        got ? t9.emphasis.secondary : 0.3);
    });
    y += Math.ceil(BADGES.length / cols) * step + t9.space.lg;
  }

  if (g.overlay === 'stats-times') {
    DIFFICULTIES.forEach((d) => {
      const locked = !g.isUnlocked(d);
      const lineH = t9.type.footnote * t9.lineHeight;
      const rowH = Math.max(t9.hit, lineH * 2 + t9.space.lg);
      const row = listRow(ctx, px, y, panelW, t9, { height: rowH });
      text(ctx, d.name, row.labelX, row.midY - lineH * 0.5, t9.type.body, pal.text, 'left',
        locked ? t9.emphasis.tertiary : t9.emphasis.primary);
      text(ctx, d.subtitle, row.labelX, row.midY + lineH * 0.5, t9.type.caption, pal.text, 'left', t9.emphasis.tertiary);
      if (locked) {
        text(ctx, 'LOCKED', row.controlX, row.midY, t9.type.footnote, pal.text, 'right', t9.emphasis.tertiary);
      } else {
        text(ctx, fmtTime(g.bestFor(d.id, false)), row.controlX, row.midY - lineH * 0.5, t9.type.body, pal.fg, 'right', 1);
        text(ctx, `TWIN ${fmtTime(g.bestFor(d.id, true))}`, row.controlX, row.midY + lineH * 0.5, t9.type.caption, pal.text, 'right', t9.emphasis.tertiary);
      }
      y += rowH + t9.space.sm;
    });
  } else if (g.overlay === 'settings') {
    const rows = [
      { label: 'SOUND', on: !g.muted, id: 'mute' },
      // Stats live here while the title screen's top-right is an install button.
      ...(g.installed ? [] : [{ label: 'BEST TIMES & BADGES', on: null, id: 'stats' }]),
      { label: 'TWIN MODE', on: g.twinSeed, id: 'twin' },
      // iOS exposes no Fullscreen API on the phone, so offering it there would
      // just be a button that silently does nothing.
      ...(fullscreenSupported() ? [{ label: 'FULLSCREEN', on: null, id: 'fullscreen' }] : []),
      { label: 'RESET BEST TIMES', on: null, id: 'reset', danger: true },
    ];
    const toggleW = t9.space.xxl;
    const toggleH = t9.space.lg;
    rows.forEach((r) => {
      const row = listRow(ctx, px, y, panelW, t9);
      // The control owns its lane; the label is fitted into what is left rather
      // than being allowed to run underneath it.
      const lane = r.on === null ? t9.space.xl : toggleW + t9.space.md;
      const size = fitSize(ctx, r.label, t9.type.body, row.room(lane));
      text(ctx, r.label, row.labelX, row.midY, size, r.danger ? '#ff6b8a' : pal.text, 'left', t9.emphasis.primary);
      if (r.on === null) {
        text(ctx, '›', row.controlX, row.midY, t9.type.title3, pal.text, 'right', t9.emphasis.secondary);
      } else {
        toggle(ctx, row.controlX - toggleW, row.midY - toggleH / 2, toggleW, toggleH, r.on, pal.fg);
      }
      overlayRows.push({ id: r.id, x: px, y, w: panelW, h: row.height });
      y += row.height + t9.space.sm;
    });
  } else if (g.overlay === 'howto') {
    // Explicit, not a catch-all: a bare `else` here meant any overlay id that
    // was not handled above silently rendered the how-to sheet underneath it.
    const lines = [
      ['ORBIT', detectTouch() ? 'Hold the left or right half of the screen. Slide across to switch.' : 'Hold ← or → (or A / D). Most recent press wins.'],
      ['BULLET TIME', 'No button. The game works out whether you can still reach the next opening, and the moment you cannot it spends a charge to slow the world and give you the room.'],
      ['CHARGES', 'The ring inside the core. One charge every five seconds survived. A full ring is four rescues at most — the more hopeless the spot, the more it costs and the longer it slows.'],
      ['NEAR MISS', 'Shaving a wall builds your multiplier. It no longer buys time — that is what the charges are for.'],
      ['SHAPES', 'The arena collapses to a pentagon, square or triangle, or opens to an octagon.'],
      ['SURVIVE', 'Reach 60 seconds and the stage redlines, unlocking its harder twin.'],
      ['TWIN MODE', 'On some seeds a second cursor arrives partway through, opposite the first. One input moves both, and both are lethal.'],
    ];
    const colW = panelW - t9.space.md;
    const colX = px + t9.space.sm;
    const blocks = [];
    for (const [k, v] of lines) {
      blocks.push({ kind: 'heading', text: k });
      blocks.push({ kind: 'body', text: v });
    }
    // The sheet does not scroll, so it has to fit. layoutBlocks measures exactly
    // rather than estimating, so a fit is a straight search on one scale — the
    // old shrink-then-grow-back dance was compensating for a measure that
    // disagreed with the draw.
    const avail = h - (view.safeBottom || 0) - t9.space.lg - y;
    let laid = layoutBlocks(ctx, blocks, t9, colW, setFont);
    if (laid.height > avail) {
      // Floor at 11/17: body must never shrink below Apple's absolute minimum
      // legible size. A screen too short even for that clips rather than
      // rendering something nobody can read.
      let lo = 11 / 17;
      let hi = 1;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (layoutBlocks(ctx, blocks, t9, colW, setFont, mid).height <= avail) lo = mid;
        else hi = mid;
      }
      laid = layoutBlocks(ctx, blocks, t9, colW, setFont, lo);
    }
    drawBlocks(ctx, laid.rows, colX, y, colW, pal, t9, text, 'left');
  }
}

let overlayRows = [];
let deathBoxes = [];
let assistBox = null;

/** Which assist control a tap on the game-over screen hit, if any. */
export function deathHitAssist(view, x, y) {
  if (!assistBox) return 0;
  if (hit(assistBox.minus, x, y, 6)) return -1;
  if (hit(assistBox.plus, x, y, 6)) return 1;
  return 0;
}

/** Practice buttons on the game-over screen, for hit testing. */
export function deathHitPractice(view, x, y) {
  for (const b of deathBoxes) {
    if (hit(b, x, y, 6)) return b.id;
  }
  return null;
}

let relearnBox = null;

/** True when the game-over sheet's "show me again" button was tapped. */
export function deathHitRelearn(view, x, y) {
  return !!relearnBox && hit(relearnBox, x, y, 10);
}

/** Rows inside the settings sheet, for hit testing. */
export function overlayHit(view, x, y) {
  for (const r of overlayRows) {
    if (hit(r, x, y)) return r.id;
  }
  return null;
}

/**
 * Returns the y of the last line drawn. Callers advance from that rather than
 * assuming a line count: guessing was why two- and three-line copy landed on
 * top of whatever came next.
 */
function wrapText(ctx, str, x, y, maxW, size, lineH, color, alpha, align = 'left') {
  setFont(ctx, size);
  const words = str.split(' ');
  let line = '';
  let ly = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      text(ctx, line, x, ly, size, color, align, alpha);
      line = word;
      ly += lineH;
    } else {
      line = test;
    }
  }
  if (line) text(ctx, line, x, ly, size, color, align, alpha);
  return ly;
}

function drawPaused(ctx, g, view, pal, u) {
  const { w, h } = view;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, w, h);
  // A stack, not four hand-placed fractions of the screen height.
  const t9 = tokens(view);
  let y = h * 0.42;
  text(ctx, 'PAUSED', w / 2, y, t9.type.largeTitle, pal.text);
  y += t9.type.largeTitle * 0.6 + t9.space.xl;
  text(ctx, `TIME  ${fmtTime(g.t)}`, w / 2, y, t9.type.title, pal.fg);
  y += t9.type.title * 0.6 + t9.space.xxl;
  text(ctx, detectTouch() ? 'TAP TO RESUME' : 'SPACE OR P TO RESUME', w / 2, y,
    t9.type.headline, pal.text, 'center', t9.emphasis.primary);
  if (!detectTouch()) {
    y += t9.type.headline * 0.6 + t9.space.lg;
    text(ctx, 'ESC FOR MENU', w / 2, y, t9.type.footnote, pal.text, 'center', t9.emphasis.tertiary);
  }
}

/**
 * Geometry of the title screen, computed without drawing. The renderer needs
 * the top of the panel stack to know where the core can sit, and drawMenu needs
 * the same numbers to draw it — deriving them twice is how they drift apart.
 */
/**
 * Title-screen layout, computed without drawing.
 *
 * Sized against Apple's HIG floors rather than a pure fraction of the viewport:
 * 44pt minimum tap targets, 11pt minimum text, spacing on an 8pt grid. When the
 * budget doesn't fit a phone, content is *cut* (modes collapse to a 2x2 grid,
 * the keyboard legend drops) rather than shrunk below those floors — scaling
 * everything down is what made the old menu illegible on a handset.
 */
export function menuMetrics(view) {
  const w = view.w;
  const h = view.h;
  const safeT = view.safeTop || 0;
  const safeB = view.safeBottom || 0;
  const touch = detectTouch();

  const compact = Math.min(w, h) < 520 || h < 680;
  const grid = 8;
  const margin = Math.max(16, Math.min(w * 0.06, 40));
  const panelW = Math.min(w - margin * 2, compact ? 460 : 560);
  const px = (w - panelW) / 2;

  // Row heights: never below the 44pt target, comfortable above it.
  const rowH = Math.max(touch ? 56 : 48, Math.min(h * 0.07, 68));
  const infoH = Math.max(44, Math.min(h * 0.055, 56));
  const modeH = Math.max(touch ? 52 : 44, Math.min(h * 0.058, 60));
  const playH = Math.max(touch ? 60 : 54, Math.min(h * 0.078, 76));
  const linkH = 44; // HOW TO PLAY needs a real target, not just a text row
  const creditH = Math.min(w, 520) < 420 ? 34 : 20;

  // The board replaces the mode switches: modes now come from the seed, so the
  // space is better spent on who you are chasing today.
  // Ten deep: a leaderboard that only shows a podium is not really a board, and
  // being 7th is exactly the kind of near-miss that brings someone back.
  const boardRows = 10;
  const boardRowH = Math.max(24, Math.min(h * 0.030, 34));
  const boardH = boardRowH * (boardRows + 2) + grid * 2; // +1 header, +1 your-best
  const modesH = boardH;
  const modeCols = 1;
  const modeRows = 0;

  const stackH = modesH + grid * 2
    + playH + grid * 1.5
    + linkH
    + grid + creditH;

  const stackTop = h - safeB - grid * 2 - stackH;

  return {
    w, h, safeT, safeB, touch, compact, grid, margin, panelW, px,
    rowH, infoH, modeH, playH, linkH, creditH,
    modeCols, modeRows, modesH, stackH, stackTop,
    boardRows, boardRowH, boardH,
    titleTop: safeT + Math.max(grid * 2, 20),
    titleBand: Math.max(80, stackTop - safeT - grid * 4),
    // Type scale, floored for legibility at arm's length.
    fs: {
      caption: Math.max(11, Math.min(w * 0.028, 15)),
      label: Math.max(13, Math.min(w * 0.038, 20)),
      value: Math.max(15, Math.min(w * 0.046, 26)),
      stage: Math.max(20, Math.min(w * 0.065, 40)),
      action: Math.max(17, Math.min(w * 0.05, 28)),
    },
  };
}

/** Height the wordmark will occupy, so the core can be placed beneath it. */
function titleHeight(m) {
  if (!logoReady || !logo.naturalWidth) return Math.min(m.titleBand * 0.3, m.w * 0.16) * 2.7;
  const maxW = Math.min(m.w * 0.84, 620);
  const scale = Math.min(maxW / logo.naturalWidth, (m.titleBand * 0.74) / logo.naturalHeight);
  return logo.naturalHeight * scale + m.fs.caption * 2;
}

/**
 * Where the core sits on the title screen: centred in whatever gap is left
 * between the wordmark and the panel stack, so it can never sit behind either.
 */
export function menuCoreY(view) {
  const m = menuMetrics(view);
  const top = m.titleTop + titleHeight(m);
  return (top + m.stackTop) / 2;
}

/** How big the decorative core may be without touching the panels. */
export function menuCoreScale(view) {
  const m = menuMetrics(view);
  const gap = m.stackTop - (m.titleTop + titleHeight(m));
  const worldScale = (Math.min(m.w, m.h) / WORLD_HEIGHT);
  // CORE_RADIUS is in world units; convert the free gap into the same space.
  return Math.max(0.45, Math.min(1.5, (gap * 0.30) / (CORE_RADIUS * worldScale)));
}

function drawMenu(ctx, g, view, pal) {
  const m = menuMetrics(view);
  const { w, h, px, panelW, grid, fs } = m;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, h);

  drawTitle(ctx, g, view, pal, m);

  // The daily is one fixed configuration, so there is nothing to choose here:
  // no stage picker, no difficulty row. The board is the first thing you see.
  const boxes = { modes: [] };
  let y = m.stackTop;

  // --- leaderboard
  boxes.board = { x: px, y, w: panelW, h: m.boardH };
  drawBoard(ctx, g, px, y, panelW, m, pal);
  y += m.modesH + grid * 2;

  // --- play
  boxes.play = { x: px, y, w: panelW, h: m.playH };
  drawPlayButton(ctx, boxes.play, g, pal, fs);
  y += m.playH + grid * 1.5;

  // --- how to play
  // Two links, because the settings sheet was the only way to reach best times
  // and badges and that sheet is gone. Split down the middle so both keep a full
  // 44pt target.
  const linkMid = y + m.linkH / 2;
  const halfW = panelW / 2;
  boxes.howto = { x: px, y, w: halfW, h: m.linkH };
  boxes.stats = { x: px + halfW, y, w: halfW, h: m.linkH };
  const leftMid = px + halfW / 2;
  const rightMid = px + halfW + halfW / 2;
  const linkSize = fitSize(ctx, 'HOW TO PLAY', fs.label, halfW - grid * 5);
  ICONS.info(ctx, leftMid - ctx.measureText('HOW TO PLAY').width / 2 - grid * 1.6, linkMid, linkSize * 0.55, pal.fg);
  text(ctx, 'HOW TO PLAY', leftMid + grid * 0.8, linkMid, linkSize, pal.fg, 'center', 0.95);
  ICONS.chart(ctx, rightMid - ctx.measureText('BEST TIMES').width / 2 - grid * 1.6, linkMid, linkSize * 0.55, pal.fg);
  text(ctx, 'BEST TIMES', rightMid + grid * 0.8, linkMid, linkSize, pal.fg, 'center', 0.95);
  y += m.linkH;

  y += grid;
  const creditSize = Math.max(10, fs.caption * 0.8);
  setFont(ctx, creditSize);
  if (ctx.measureText(CREDIT).width <= panelW) {
    text(ctx, CREDIT, w / 2, y + m.creditH / 2, creditSize, pal.text, 'center', 0.38);
  } else {
    // Break at the separator rather than letting it bleed off both edges.
    const [a, b] = CREDIT.split(CREDIT_SEP);
    text(ctx, a, w / 2, y + m.creditH * 0.28, creditSize, pal.text, 'center', 0.38);
    text(ctx, b, w / 2, y + m.creditH * 0.92, creditSize, pal.text, 'center', 0.38);
  }

  menuBoxes = boxes;
}

/**
 * Your own best for this seed, along the board's bottom edge. The home screen no
 * longer has a difficulty row to carry it, and it is the one number you check
 * before deciding whether to play again.
 */
function drawYourBest(ctx, g, x, y, w, m, pal) {
  if (!(g.best > 0)) return;
  const { grid, fs } = m;
  const by = y + m.boardH - grid - m.boardRowH * 0.4;
  text(ctx, 'YOUR BEST', x + grid * 2, by, fs.caption, pal.text, 'left', 0.4);
  text(ctx, fmtTime(g.best), x + w - grid * 2, by, fs.caption * 1.15, pal.fg, 'right', 0.8);
}

/**
 * "Someone passed you." The whole point of a leaderboard is the rematch, and
 * nothing prompts one like finding out you slipped — so the board says it out
 * loud instead of leaving you to notice.
 */
function drawBoardNews(ctx, g, x, y, w, m, pal) {
  const news = g.boardNews;
  if (!news) return false;
  const { grid, fs } = m;
  // Takes the footer slot rather than claiming a row of its own: it and YOUR
  // BEST are both one-line summaries, and this one is the urgent one.
  const ny = y + m.boardH - grid - m.boardRowH * 0.4;
  let line;
  if (news.kind === 'gained') {
    line = news.rank === 1 ? 'YOU TOOK BACK FIRST' : `YOU CLIMBED TO #${news.rank}`;
  } else if (news.passers.length === 1) {
    line = `${news.passers[0]} PASSED YOU — NOW #${news.rank}`;
  } else if (news.passers.length) {
    line = `${news.passers.length} PLAYERS PASSED YOU — NOW #${news.rank}`;
  } else {
    line = `YOU SLIPPED TO #${news.rank}`;
  }
  const tone = news.kind === 'gained' ? pal.fg : pal.accent;
  const pulse = 0.72 + 0.28 * Math.sin(performance.now() / 420);
  text(ctx, line, x + w / 2, ny, fs.caption * 1.05, tone, 'center', pulse);
  return true;
}

// Podium colours, and the sweep that runs across them. Gold/silver/bronze read
// instantly, which a single accent colour for "top three" does not.
const MEDALS = [
  { base: '#ffd257', lo: '#a9761a', hi: '#fff6cf' },
  { base: '#dfe6ee', lo: '#8d9aa8', hi: '#ffffff' },
  { base: '#e2924f', lo: '#8a4f22', hi: '#ffd9b0' },
];

/**
 * A moving metallic sweep for the podium names. A plain gradient looks like a
 * gradient; what reads as metal is a highlight travelling across the glyphs, so
 * the stop positions animate rather than the colours.
 */
function medalFill(ctx, x, w, i, t) {
  const m = MEDALS[i];
  const sweep = ((t / 2600) % 1);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  const at = (p) => Math.max(0, Math.min(1, p));
  g.addColorStop(0, m.lo);
  g.addColorStop(at(sweep - 0.18), m.base);
  g.addColorStop(at(sweep), m.hi);
  g.addColorStop(at(sweep + 0.18), m.base);
  g.addColorStop(1, m.lo);
  return g;
}

/** Podium marker: a laurel-ish hex badge with the place cut into it. */
function drawMedal(ctx, cx, cy, r, i, t) {
  const m = MEDALS[i];
  ctx.save();
  const bob = Math.sin(t / 700 + i) * r * 0.06;
  hexPath(ctx, cx, cy + bob, r, Math.PI / 6);
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, m.hi);
  g.addColorStop(0.5, m.base);
  g.addColorStop(1, m.lo);
  ctx.fillStyle = g;
  withGlow(ctx, m.base, r * 0.9, () => ctx.fill());
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.stroke();
  setFont(ctx, r * 1.15);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillText(String(i + 1), cx, cy + bob + r * 0.06);
  ctx.restore();
}

/**
 * Today's board. Shows who you are chasing and the seed's active modes — the
 * modes are information now, not switches, so they read as a badge row.
 */
function drawBoard(ctx, g, x, y, w, m, pal) {
  const { grid, fs, boardRowH } = m;
  panel(ctx, x, y, w, m.boardH, { radius: 12 });

  const headY = y + grid + boardRowH * 0.5;
  const label = g.dayOffset === 0 ? "TODAY'S BOARD" : `${g.dateKey}`;
  text(ctx, label, x + grid * 2, headY, fs.caption, pal.text, 'left', 0.55);

  // Active modes for this seed, as compact badges. Twin carries the second it
  // arrives, because that is the one thing about today's run worth knowing
  // before you start.
  const active = [];
  if (g.flavour && g.flavour.id !== 'even') active.push(g.flavour.name);
  if (g.twinSeed) active.push(g.twinAt != null ? `TWIN ${g.twinAt}s · ${g.twinFor}s ON` : 'TWIN');
  if (g.pulseMode) active.push('PULSE');
  if (g.shiftMode) active.push('SHIFT');
  // The badge line grew when days gained a character, and it ran straight into
  // the header. Size it to the room actually left, and drop the least important
  // items rather than shrink past legibility.
  setFont(ctx, fs.caption);
  const room = w - grid * 4 - ctx.measureText(label).width - grid * 3; // leave a gap
  let badges = active.length ? active.join(' · ') : 'STANDARD';
  let bsize = fitSize(ctx, badges, fs.caption, room);
  if (bsize < fs.caption * 0.8 && active.length > 1) {
    badges = active.slice(0, 2).join(' · ');
    bsize = fitSize(ctx, badges, fs.caption, room);
  }
  text(ctx, badges, x + w - grid * 2, headY, bsize, pal.fg, 'right', 0.85);

  if (!drawBoardNews(ctx, g, x, y, w, m, pal)) drawYourBest(ctx, g, x, y, w, m, pal);

  const rows = g.board && g.board.top ? g.board.top.slice(0, m.boardRows) : null;
  let ry = y + grid + boardRowH;

  if (!rows) {
    // Only claim the board is down once a fetch has actually failed. The panel
    // used to flip between these two every frame, which read as a fault.
    text(ctx, g.boardError ? 'LEADERBOARD OFFLINE' : 'LOADING BOARD…', x + w / 2,
      ry + boardRowH * 1.2, fs.caption, pal.text, 'center', 0.4);
    return;
  }
  if (!rows.length) {
    text(ctx, 'NO SCORES YET — BE FIRST', x + w / 2, ry + boardRowH * 1.2,
      fs.caption, pal.fg, 'center', 0.6);
    return;
  }

  const now = performance.now();
  rows.forEach((r, i) => {
    const mine = g.playerName && r.name === g.playerName;
    const podium = i < 3;
    const cy = ry + boardRowH * 0.5;
    const size = fs.caption * (podium ? 1.3 : 1.12);

    if (podium) {
      drawMedal(ctx, x + grid * 3.2, cy, boardRowH * 0.34, i, now);
    } else {
      text(ctx, String(i + 1), x + grid * 3.2, cy, fs.caption, pal.text, 'center', 0.4);
    }

    const nameX = x + grid * 6;
    if (podium) {
      // Metal, swept. Stroke first so the shine sits on a dark edge and stays
      // readable against the panel rather than glowing into it.
      setFont(ctx, size);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, size * 0.18);
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(r.name, nameX, cy);
      ctx.fillStyle = medalFill(ctx, nameX, ctx.measureText(r.name).width || 1, i, now);
      ctx.fillText(r.name, nameX, cy);
      text(ctx, fmtTime(r.t), x + w - grid * 2, cy, size, MEDALS[i].base, 'right', 1);
    } else {
      const alpha = mine ? 1 : 0.72;
      text(ctx, r.name, nameX, cy, size, mine ? pal.fg : pal.text, 'left', alpha);
      text(ctx, fmtTime(r.t), x + w - grid * 2, cy, size, mine ? pal.fg : pal.text, 'right', alpha);
    }
    ry += boardRowH;
  });
}

function drawTitle(ctx, g, view, pal, m) {
  const { w } = view;
  const top = m.titleTop;
  const mark = tintedLogo(g.hue);

  if (mark) {
    const maxW = Math.min(w * 0.84, 620);
    // Fit both axes. Width alone let the wordmark run straight through the menu
    // on anything that wasn't tall and narrow.
    const scale = Math.min(maxW / logo.naturalWidth, (m.titleBand * 0.74) / logo.naturalHeight);
    const lw = logo.naturalWidth * scale;
    const lh = logo.naturalHeight * scale;
    ctx.drawImage(mark, w / 2 - lw / 2, top, lw, lh);
    drawWelcome(ctx, g, w, top + lh + m.grid * 1.5, pal, m);
    return;
  }

  const size = Math.min(m.titleBand * 0.3, w * 0.16);
  withGlow(ctx, 'rgba(255,255,255,0.35)', 10, () => {
    text(ctx, 'DAILY', w / 2, top + size * 0.6, size, '#fff', 'center', 1);
  });
  withGlow(ctx, pal.fg, 16, () => {
    text(ctx, 'HEX', w / 2, top + size * 1.7, size, pal.fg, 'center', 1);
  });
  drawWelcome(ctx, g, w, top + size * 2.5, pal, m);
}

/** Which half of the day it is, in the player's own clock. */
function greetingFor(hour) {
  if (hour < 5) return 'UP LATE';
  if (hour < 12) return 'GOOD MORNING';
  if (hour < 17) return 'GOOD AFTERNOON';
  if (hour < 22) return 'GOOD EVENING';
  return 'UP LATE';
}

/**
 * Greet a returning player by the name they put on the board.
 *
 * Length is the whole problem here: "GOOD AFTERNOON, CHAD THUNDERBUTT" is over
 * three times the width of "HI, JAS". Rather than shrink one line until the
 * longest name is illegible, this picks the longest phrasing that actually fits
 * at full size and only falls back to shrinking when even the bare name is too
 * wide. Someone who has never entered a name gets nothing at all — a greeting
 * addressed to no one is worse than no greeting.
 */
function drawWelcome(ctx, g, w, y, pal, m) {
  const name = (g.playerName || '').trim();
  if (!name) return;
  const size = m.fs.caption;
  const room = w * 0.86;
  const forms = [`${greetingFor(new Date().getHours())}, ${name}`, `HI, ${name}`, name];
  for (const form of forms) {
    setFont(ctx, size);
    if (ctx.measureText(form).width <= room) {
      text(ctx, form, w / 2, y, size, pal.text, 'center', 0.55);
      return;
    }
  }
  text(ctx, name, w / 2, y, fitSize(ctx, name, size, room), pal.text, 'center', 0.55);
}

function drawPlayButton(ctx, r, g, pal, fs) {
  const period = g.loading ? 220 : 620;
  const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(performance.now() / period));
  const cut = Math.min(r.h * 0.32, 22);
  ctx.save();
  withGlow(ctx, pal.fg, 22 * pulse, () => {
    chamferPath(ctx, r.x, r.y, r.w, r.h, cut);
    ctx.fillStyle = pal.fg;
    ctx.fill();
  });
  chamferPath(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, cut * 0.85);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  const label = g.loading ? 'LOADING' : detectTouch() ? 'TAP TO PLAY' : 'PRESS SPACE TO PLAY';
  const size = fs.action;
  setFont(ctx, size);
  const textW = ctx.measureText(label).width;
  const arrowW = size * 1.5;
  const left = r.x + r.w / 2 - (textW + arrowW) / 2;
  const midY = r.y + r.h / 2;
  text(ctx, label, left, midY, size, '#12000f', 'left', 1);
  ICONS.play(ctx, left + textW + arrowW * 0.55, midY, size * 0.4, '#12000f');
}

function drawGameOver(ctx, g, view, pal, u) {
  const { w, h } = view;
  const a = Math.min(1, Math.max(0, (g.deathT - 0.25) * 2.5));
  if (a <= 0) return;
  ctx.fillStyle = `rgba(0,0,0,${0.78 * a})`;
  ctx.fillRect(0, 0, w, h);

  // Two stacks, not a list of screen fractions. The hero flows down from the
  // top and the controls stack up from the bottom, so an optional piece
  // (an unlock, the practice row, the lesson offer) shifts its own neighbours
  // instead of landing on top of whatever happened to own that fraction of the
  // screen — which is exactly how the lesson button ended up over the practice
  // buttons.
  const t9 = tokens(view);
  const cx = w / 2;
  const ready = g.deathT > 0.65;

  // --- hero, top down -------------------------------------------------------
  const heroTime = t9.type.largeTitle * 1.7;
  let y = (view.safeTop || 0) + h * 0.13;
  text(ctx, 'GAME OVER', cx, y, t9.type.title, pal.text, 'center', a * t9.emphasis.secondary);
  y += t9.type.title * 0.5 + t9.space.xxl;

  text(ctx, 'TIME', cx, y, t9.type.footnote, pal.text, 'center', a * t9.emphasis.tertiary);
  y += t9.type.footnote * 0.5 + heroTime * 0.5 + t9.space.md;
  withGlow(ctx, pal.fg, t9.space.lg, () => {
    text(ctx, fmtTime(g.t), cx, y, heroTime, pal.fg, 'center', a);
  });
  y += heroTime * 0.5 + t9.space.xl;

  const isBest = g.newRecord;
  const bestTone = isBest ? pal.accent : pal.text;
  text(ctx, isBest ? 'NEW RECORD' : 'BEST', cx, y, t9.type.footnote, bestTone, 'center',
    a * (isBest ? t9.emphasis.primary : t9.emphasis.tertiary));
  y += t9.type.footnote * 0.5 + t9.type.largeTitle * 0.5 + t9.space.sm;
  text(ctx, fmtTime(g.best), cx, y, t9.type.largeTitle, bestTone, 'center',
    a * (isBest ? 1 : t9.emphasis.primary));
  y += t9.type.largeTitle * 0.5 + t9.space.lg;

  // Secondary readouts on one line: rank, grazes, and the phase reached.
  const bits = [g.rankIndex >= 0 ? RANKS[Math.min(g.rankIndex, RANKS.length - 1)].name : 'POINT'];
  if (g.graze.best > 0) bits.push(`${g.graze.total} GRAZE  ·  BEST CHAIN ${g.graze.best}`);
  if (g.practice) bits.push('PRACTICE — NOT RECORDED');
  const line = bits.join('   ·   ');
  text(ctx, line, cx, y, fitSize(ctx, line, t9.type.footnote, w - t9.space.xl * 2),
    pal.text, 'center', a * t9.emphasis.secondary);

  if (g.justUnlocked) {
    y += t9.type.footnote * 0.5 + t9.space.lg;
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    text(ctx, `UNLOCKED  ${g.justUnlocked}`, cx, y, t9.type.headline, pal.fg, 'center', a * blink);
  }

  // --- controls, bottom up --------------------------------------------------
  assistBox = null;
  relearnBox = null;
  deathBoxes = [];
  if (!ready) return;

  let by = h - (view.safeBottom || 0) - t9.space.xl;
  text(ctx, detectTouch() ? 'MENU' : 'ESC FOR MENU', cx, by, t9.type.footnote, pal.text,
    'center', a * t9.emphasis.secondary);
  by -= t9.type.footnote * 0.5 + t9.space.xl;

  const blink = 0.55 + 0.45 * Math.sin(performance.now() / 260);
  const retry = g.loading ? 'LOADING' : detectTouch() ? 'TAP TO RETRY' : 'SPACE TO RETRY';
  by -= t9.type.headline * 0.5;
  text(ctx, retry, cx, by, t9.type.headline, pal.text, 'center', a * blink);
  by -= t9.type.headline * 0.5 + t9.space.xl;

  // Someone who died without getting past a single wall is not losing, they are
  // lost. Offer the lessons back rather than another identical run.
  const relearnOn = g.wallsCleared === 0 && !g.practice;
  if (relearnOn) {
    const bw = Math.min(w - t9.space.xl * 2, t9.space.xxl * 9);
    const bh = t9.hit;
    by -= bh;
    panel(ctx, cx - bw / 2, by, bw, bh, { radius: t9.radius.md, glow: pal.fg, glowBlur: 10 });
    text(ctx, 'SHOW ME HOW AGAIN', cx, by + bh / 2, t9.type.subhead, pal.fg, 'center', a * t9.emphasis.primary);
    relearnBox = { x: cx - bw / 2, y: by, w: bw, h: bh };
    by -= t9.space.xl;
  } else if (!g.practice) {
    // Checkpoint practice, offered only where it has been earned. Never beside
    // the lesson offer: "practise from 30s" is useless advice to someone who
    // never reached wall one.
    const avail = CHECKPOINTS.filter((c) => g.canPractice(c));
    if (avail.length) {
      const bw = t9.space.xxl * 2.2;
      const bh = t9.hit;
      const total = avail.length * bw + (avail.length - 1) * t9.space.sm;
      by -= bh;
      let bx = cx - total / 2;
      for (const c of avail) {
        panel(ctx, bx, by, bw, bh, { radius: t9.radius.md });
        text(ctx, `${c}s`, bx + bw / 2, by + bh / 2, t9.type.body, pal.fg, 'center', a);
        deathBoxes.push({ id: c, x: bx, y: by, w: bw, h: bh });
        bx += bw + t9.space.sm;
      }
      by -= t9.space.sm + t9.type.footnote * 0.5;
      text(ctx, 'PRACTICE FROM', cx, by, t9.type.footnote, pal.text, 'center', a * t9.emphasis.tertiary);
      by -= t9.type.footnote * 0.5 + t9.space.xl;
    }
  }

  // Speed assist. The daily has no hints, so the help on offer is time: 5%
  // slower per step, same seed, same obstacles — and never ranked.
  if (g.assisted) {
    by -= t9.type.caption * 0.5;
    text(ctx, 'ASSISTED — NOT RANKED', cx, by, t9.type.caption, pal.accent, 'center', a * t9.emphasis.secondary);
    by -= t9.type.caption * 0.5 + t9.space.sm;
  }
  const sh = t9.hit;
  const sw = Math.min(w - t9.space.xl * 2, t9.space.xxl * 7);
  by -= sh;
  panel(ctx, cx - sw / 2, by, sw, sh, { radius: t9.radius.md });
  const step = sw * 0.3;
  assistBox = {
    minus: { x: cx - sw / 2, y: by, w: step, h: sh },
    plus: { x: cx + sw / 2 - step, y: by, w: step, h: sh },
  };
  text(ctx, '−', cx - sw / 2 + step / 2, by + sh / 2, t9.type.title, g.assist > ASSIST_MIN ? pal.fg : pal.text,
    'center', a * (g.assist > ASSIST_MIN ? 1 : 0.3));
  text(ctx, '+', cx + sw / 2 - step / 2, by + sh / 2, t9.type.title, g.assist < 100 ? pal.fg : pal.text,
    'center', a * (g.assist < 100 ? 1 : 0.3));
  text(ctx, `${g.assist}%`, cx, by + sh / 2, t9.type.body, g.assisted ? pal.accent : pal.text, 'center', a);
  by -= t9.space.sm + t9.type.footnote * 0.5;
  text(ctx, 'SPEED', cx, by, t9.type.footnote, pal.text, 'center', a * t9.emphasis.tertiary);
}
