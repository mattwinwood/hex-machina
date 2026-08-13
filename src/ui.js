// Menu chrome primitives: panels, glow, keycaps and icons.
//
// Everything here is canvas-drawn so the UI inherits the stage colour and the
// beat pulse for free. Glow is done with shadowBlur, which is expensive enough
// that it belongs on menus and the core — not on every wall, every frame.

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Corner-cut rectangle — the hexagon motif applied to a button. */
export function chamferPath(ctx, x, y, w, h, cut) {
  const c = Math.min(cut, w / 3, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

export function hexPath(ctx, cx, cy, r, rotation = 0) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rotation + (i * Math.PI) / 3;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Run `draw` with a glow attached, then clear it. */
export function withGlow(ctx, color, blur, draw) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

/** A surface: faint fill, hairline border, optional accent glow. */
export function panel(ctx, x, y, w, h, opts = {}) {
  const {
    radius = h * 0.28,
    fill = 'rgba(255,255,255,0.035)',
    stroke = 'rgba(255,255,255,0.11)',
    lineWidth = 1.5,
    glow = null,
    glowBlur = 18,
  } = opts;
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (glow) {
    withGlow(ctx, glow, glowBlur, () => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    });
  } else {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** A keyboard key: small rounded square with a glyph in it. */
export function keycap(ctx, cx, cy, size, glyph, font, color) {
  const s = size;
  roundRectPath(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.24);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.font = `${(s * 0.52).toFixed(1)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(glyph, cx, cy + s * 0.02);
}

/** The four-key arrow cluster, drawn as one unit. */
export function arrowKeys(ctx, cx, cy, size, font, color) {
  const s = size;
  const gap = s * 0.22;
  const row = (s + gap) / 2;
  keycap(ctx, cx, cy - row, s, '↑', font, color);
  keycap(ctx, cx - (s + gap), cy + row, s, '←', font, color);
  keycap(ctx, cx, cy + row, s, '↓', font, color);
  keycap(ctx, cx + (s + gap), cy + row, s, '→', font, color);
}

/** Pill switch. `on` drives both the knob position and the accent. */
export function toggle(ctx, x, y, w, h, on, accent) {
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = on ? accent : 'rgba(255,255,255,0.10)';
  if (on) {
    withGlow(ctx, accent, 14, () => ctx.fill());
  } else {
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const r = h * 0.36;
  const kx = on ? x + w - h / 2 : x + h / 2;
  ctx.beginPath();
  ctx.arc(kx, y + h / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.65)';
  ctx.fill();
}

// --- icons ------------------------------------------------------------------
// All drawn into a box of half-extent `k` centred on (cx, cy).

export function iconGear(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.fillStyle = color;
  // Toothed ring drawn as one path, then a hole punched out of the middle —
  // reads as a gear at 20px, which a sunburst of spokes does not.
  const teeth = 8;
  const rOuter = k;
  const rRoot = k * 0.76;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i * Math.PI) / teeth;
    const a1 = ((i + 1) * Math.PI) / teeth;
    const r = i % 2 === 0 ? rOuter : rRoot;
    ctx.arc(cx, cy, r, a0 - 0.06, a1 + 0.06);
  }
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, k * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function iconChart(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.fillStyle = color;
  const bw = k * 0.34;
  const heights = [0.55, 1.0, 0.75];
  heights.forEach((hh, i) => {
    const bx = cx - k * 0.72 + i * (bw + k * 0.22);
    const bh = k * 1.3 * hh;
    roundRectPath(ctx, bx, cy + k * 0.65 - bh, bw, bh, bw * 0.3);
    ctx.fill();
  });
  ctx.restore();
}

/** Add to home screen: a device with a plus. Reads the same on every platform,
 *  where the actual gesture does not. */
export function iconInstall(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.6, k * 0.16);
  ctx.lineCap = 'round';
  const w = k * 1.05;
  const h = k * 1.5;
  roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, k * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - k * 0.36, cy);
  ctx.lineTo(cx + k * 0.36, cy);
  ctx.moveTo(cx, cy - k * 0.36);
  ctx.lineTo(cx, cy + k * 0.36);
  ctx.stroke();
  ctx.restore();
}

export function iconTwinHex(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.3, k * 0.16);
  hexPath(ctx, cx - k * 0.3, cy, k * 0.72, Math.PI / 6);
  ctx.stroke();
  hexPath(ctx, cx + k * 0.3, cy, k * 0.72, Math.PI / 6);
  ctx.stroke();
  ctx.restore();
}

export function iconTap(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.3, k * 0.15);
  ctx.lineCap = 'round';
  // finger
  roundRectPath(ctx, cx - k * 0.22, cy - k * 0.15, k * 0.44, k * 1.0, k * 0.22);
  ctx.fill();
  // taps radiating off it
  for (const s of [0.55, 0.95]) {
    ctx.beginPath();
    ctx.arc(cx, cy - k * 0.25, k * s, -Math.PI * 0.9, -Math.PI * 0.1);
    ctx.stroke();
  }
  ctx.restore();
}

export function iconInfo(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.3, k * 0.16);
  ctx.beginPath();
  ctx.arc(cx, cy, k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - k * 0.42, k * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy - k * 0.1);
  ctx.lineTo(cx, cy + k * 0.5);
  ctx.stroke();
  ctx.restore();
}

export function iconPlay(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - k * 0.6, cy - k);
  ctx.lineTo(cx + k * 0.85, cy);
  ctx.lineTo(cx - k * 0.6, cy + k);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function iconClose(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.6, k * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - k * 0.6, cy - k * 0.6);
  ctx.lineTo(cx + k * 0.6, cy + k * 0.6);
  ctx.moveTo(cx + k * 0.6, cy - k * 0.6);
  ctx.lineTo(cx - k * 0.6, cy + k * 0.6);
  ctx.stroke();
  ctx.restore();
}

export function iconSound(ctx, cx, cy, k, color, muted) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.3, k * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - k, cy - k * 0.34);
  ctx.lineTo(cx - k * 0.45, cy - k * 0.34);
  ctx.lineTo(cx + k * 0.08, cy - k * 0.85);
  ctx.lineTo(cx + k * 0.08, cy + k * 0.85);
  ctx.lineTo(cx - k * 0.45, cy + k * 0.34);
  ctx.lineTo(cx - k, cy + k * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  if (muted) {
    ctx.moveTo(cx + k * 0.42, cy - k * 0.42);
    ctx.lineTo(cx + k * 0.95, cy + k * 0.42);
    ctx.moveTo(cx + k * 0.95, cy - k * 0.42);
    ctx.lineTo(cx + k * 0.42, cy + k * 0.42);
  } else {
    ctx.arc(cx + k * 0.12, cy, k * 0.55, -0.9, 0.9);
    ctx.moveTo(cx + k * 1.0, cy - k * 0.55);
    ctx.arc(cx + k * 0.12, cy, k * 0.92, -0.85, 0.85);
  }
  ctx.stroke();
  ctx.restore();
}

export function iconExpand(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.6, k * 0.2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.moveTo(cx + dx * k, cy + dy * k * 0.45);
    ctx.lineTo(cx + dx * k, cy + dy * k);
    ctx.lineTo(cx + dx * k * 0.45, cy + dy * k);
  }
  ctx.stroke();
  ctx.restore();
}

export function iconPause(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.fillStyle = color;
  roundRectPath(ctx, cx - k * 0.6, cy - k, k * 0.42, k * 2, k * 0.14);
  ctx.fill();
  roundRectPath(ctx, cx + k * 0.18, cy - k, k * 0.42, k * 2, k * 0.14);
  ctx.fill();
  ctx.restore();
}

/** Concentric rings: the arena breathing. */
export function iconPulse(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, k * 0.15);
  [0.45, 0.75, 1.05].forEach((r, i) => {
    ctx.globalAlpha = 1 - i * 0.28;
    hexPath(ctx, cx, cy, k * r, Math.PI / 6);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** A hexagon becoming a square: the shape changing under you. */
export function iconShift(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, k * 0.15);
  hexPath(ctx, cx - k * 0.28, cy, k * 0.7, Math.PI / 6);
  ctx.stroke();
  ctx.beginPath();
  const s = k * 0.5;
  ctx.rect(cx + k * 0.05, cy - s, s * 2, s * 2);
  ctx.stroke();
  ctx.restore();
}

/** A calendar page: the same run for everyone, today only. */
export function iconDaily(ctx, cx, cy, k, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.2, k * 0.15);
  roundRectPath(ctx, cx - k * 0.85, cy - k * 0.7, k * 1.7, k * 1.5, k * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - k * 0.85, cy - k * 0.22);
  ctx.lineTo(cx + k * 0.85, cy - k * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy + k * 0.32, k * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export const ICONS = {
  sound: iconSound,
  pulse: iconPulse,
  shift: iconShift,
  daily: iconDaily,
  gear: iconGear,
  chart: iconChart,
  install: iconInstall,
  twin: iconTwinHex,
  tap: iconTap,
  info: iconInfo,
  play: iconPlay,
  close: iconClose,
  expand: iconExpand,
  pause: iconPause,
};

// ---------------------------------------------------------------------------
// Design system
// ---------------------------------------------------------------------------
// Everything above draws shapes. Everything below decides *sizes* — and it is
// the only place allowed to. Before this, each call site invented its own
// numbers (`mu * 3.4` here, `h * 0.795` there), which is why panels overlapped
// their own copy and no two surfaces looked related.
//
// The type ramp is Apple's (HIG "Text Styles"), spacing is a 4pt grid, and both
// ride one `scale` so proportions never drift between a phone and a desktop.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Design tokens for a viewport. Sizes are CSS pixels — the canvas context is
 * already transformed by dpr, so these are real points on the glass.
 */
export function tokens(view) {
  // A phone is the baseline. Bigger screens scale up so the UI keeps its
  // proportions rather than shrinking into the middle of a monitor.
  const scale = clamp(Math.min(view.w, view.h) / 390, 1, 1.5);
  const px = (n) => Math.round(n * scale);
  return {
    scale,
    // Apple's ramp, trimmed to the roles this game actually has.
    type: {
      largeTitle: px(34),
      title: px(28),
      title3: px(20),
      headline: px(17),
      body: px(17),
      subhead: px(15),
      footnote: px(13),
      caption: px(12),
    },
    // 4pt grid.
    space: { xs: px(4), sm: px(8), md: px(12), lg: px(16), xl: px(24), xxl: px(32) },
    radius: { sm: px(8), md: px(14), lg: px(22) },
    lineHeight: 1.32,
    // Text emphasis as alpha, so tone is a role rather than a hand-picked number.
    emphasis: { primary: 0.95, secondary: 0.72, tertiary: 0.45 },
    // Apple's minimum comfortable touch target.
    hit: Math.max(44, px(44)),
  };
}

/**
 * Wrap `str` and return the lines. Measuring and drawing share this one result,
 * which is the whole point: every overlap bug in this UI came from a measure
 * pass and a draw pass disagreeing about how many lines there were.
 */
export function wrapLines(ctx, str, maxW, setFont, size) {
  setFont(ctx, size);
  const out = [];
  let line = '';
  for (const word of String(str).split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out;
}

// How each block kind is typed, and how much room follows it. Adding a kind
// here is the only thing needed to use it in a card or a sheet.
const BLOCK = {
  eyebrow: { size: 'footnote', tone: 'accent', emphasis: 'primary', after: 'sm' },
  title: { size: 'title3', tone: 'accent', emphasis: 'primary', after: 'md' },
  heading: { size: 'headline', tone: 'accent', emphasis: 'primary', after: 'sm' },
  body: { size: 'body', tone: 'text', emphasis: 'secondary', after: 'lg' },
  cta: { size: 'headline', tone: 'accent', emphasis: 'primary', after: 'sm' },
  link: { size: 'subhead', tone: 'text', emphasis: 'tertiary', after: 'none' },
};

/**
 * Lay out a list of content blocks in a column of `width`.
 *
 * Returns `{ height, rows }`, where each row already knows its text, size, and
 * y offset from the top of the column. Callers measure first (to size a card),
 * then draw the exact same rows — the two can never disagree.
 *
 * Blocks look like `{ kind, text, trailing? }`. `scale` shrinks the whole run
 * uniformly when it has to fit somewhere it otherwise would not.
 */
export function layoutBlocks(ctx, blocks, t, width, setFont, scale = 1) {
  const rows = [];
  let y = 0;
  let last = null;
  for (const b of blocks) {
    const spec = BLOCK[b.kind];
    if (!spec) continue;
    if (last) y += (spec.before ? t.space[spec.before] : t.space[last.after] || 0);
    const size = t.type[spec.size] * scale;
    const lineH = size * t.lineHeight;
    const lines = wrapLines(ctx, b.text, width, setFont, size);
    lines.forEach((line, i) => {
      rows.push({
        text: line,
        size,
        tone: spec.tone,
        emphasis: spec.emphasis,
        // Trailing text (a step counter) and a leading gutter marker (a step
        // number) both ride the block's first line only.
        trailing: i === 0 ? b.trailing : undefined,
        leading: i === 0 ? b.leading : undefined,
        trailingSize: t.type.footnote * scale,
        y: y + lineH / 2 + i * lineH,
      });
    });
    y += lines.length * lineH;
    last = spec;
  }
  return { height: y, rows };
}

/** Draw the rows `layoutBlocks` produced, centred in a column at (x, y). */
export function drawBlocks(ctx, rows, x, y, width, pal, t, text, align = 'center') {
  const cx = align === 'center' ? x + width / 2 : x;
  for (const r of rows) {
    const color = r.tone === 'accent' ? pal.fg : pal.text;
    text(ctx, r.text, cx, y + r.y, r.size, color, align, t.emphasis[r.emphasis]);
    if (r.trailing) {
      text(ctx, r.trailing, x + width, y + r.y, r.trailingSize, pal.text, 'right', t.emphasis.tertiary);
    }
  }
}

/**
 * A list row: full-width surface, label on the left, one control on the right.
 * Settings, badges and score rows are all this shape, and each used to hand-roll
 * it — which is how the label ended up drawn underneath its own chevron.
 *
 * `gutter` is the width reserved for the control; the label is fitted into what
 * is left rather than being allowed to run into it.
 */
export function listRow(ctx, x, y, w, t, opts = {}) {
  const { height = t.hit, radius = t.radius.md, glow = null } = opts;
  panel(ctx, x, y, w, height, { radius, glow });
  return {
    padX: t.space.lg,
    labelX: x + t.space.lg,
    controlX: x + w - t.space.lg,
    midY: y + height / 2,
    height,
    // Room a label may occupy before it would meet the control.
    room: (gutter) => w - t.space.lg * 2 - gutter,
  };
}
