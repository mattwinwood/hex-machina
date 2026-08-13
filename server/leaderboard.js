// Daily Hex leaderboard service. Zero dependencies, JSON file storage.
//
// Scores are client-reported and therefore unverifiable — there is no replay
// validation here. That is a deliberate trade for a small game: the guards below
// stop casual nonsense (absurd times, spam, giant payloads) but a determined
// person can still post a fake score. Anything stronger needs server-side replay
// of the recorded input trace, which is a much larger piece of work.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3800;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data', 'scores.json');
const MAX_PER_DAY = 500; // ceiling on stored rows per date
const TOP_N = 25;
const MAX_TIME = 600; // seconds; nothing legitimate goes past this
const NAME_MAX = 16;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12; // submissions per IP per window

fs.mkdirSync(path.dirname(DATA), { recursive: true });

let board = {};
try {
  board = JSON.parse(fs.readFileSync(DATA, 'utf8'));
} catch {
  board = {};
}

let writeQueued = false;
function persist() {
  // Debounced atomic write: rename is atomic on the same filesystem, so a crash
  // mid-write can never leave a truncated scores file.
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    const tmp = `${DATA}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(board));
      fs.renameSync(tmp, DATA);
    } catch (err) {
      console.error('persist failed', err.message);
    }
  }, 400);
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, since: now };
  if (now - rec.since > RATE_WINDOW_MS) {
    rec.n = 0;
    rec.since = now;
  }
  rec.n++;
  hits.set(ip, rec);
  return rec.n > RATE_MAX;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function cleanName(raw) {
  return String(raw || '')
    .replace(/[^\p{L}\p{N} _.\-]/gu, '') // letters, digits and a little punctuation
    .trim()
    .slice(0, NAME_MAX)
    .toUpperCase();
}

function topFor(date) {
  return (board[date] || [])
    .slice()
    .sort((a, b) => b.t - a.t)
    .slice(0, TOP_N);
}

function send(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = (req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').toString();

    if (req.method === 'OPTIONS') return send(res, 204, {});

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, days: Object.keys(board).length });
    }

    if (req.method === 'GET' && url.pathname === '/api/board') {
      const date = url.searchParams.get('date');
      if (!isDate(date)) return send(res, 400, { error: 'bad date' });
      const rows = topFor(date);
      return send(res, 200, { date, count: (board[date] || []).length, top: rows });
    }

    if (req.method === 'POST' && url.pathname === '/api/score') {
      if (rateLimited(ip)) return send(res, 429, { error: 'slow down' });
      let body = '';
      let tooBig = false;
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2048) {
          tooBig = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooBig) return;
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          return send(res, 400, { error: 'bad json' });
        }
        const date = data.date;
        const t = Number(data.t);
        const name = cleanName(data.name);
        if (!isDate(date)) return send(res, 400, { error: 'bad date' });
        if (!Number.isFinite(t) || t <= 0 || t > MAX_TIME) return send(res, 400, { error: 'bad time' });
        if (!name) return send(res, 400, { error: 'bad name' });
        // Assisted runs are recorded but never ranked — mixing them with clean
        // runs would make the board meaningless.
        if (data.assist && Number(data.assist) !== 100) return send(res, 200, { ranked: false, top: topFor(date) });

        const list = board[date] || (board[date] = []);
        const existing = list.find((r) => r.name === name);
        if (existing) {
          if (t > existing.t) {
            existing.t = Math.round(t * 100) / 100;
            existing.at = Date.now();
          }
        } else {
          list.push({ name, t: Math.round(t * 100) / 100, at: Date.now() });
        }
        if (list.length > MAX_PER_DAY) {
          list.sort((a, b) => b.t - a.t);
          list.length = MAX_PER_DAY;
        }
        persist();
        const top = topFor(date);
        const rank = top.findIndex((r) => r.name === name);
        return send(res, 200, { ranked: true, rank: rank >= 0 ? rank + 1 : null, top });
      });
      return undefined;
    }

    return send(res, 404, { error: 'not found' });
  })
  .listen(PORT, () => console.log(`daily hex leaderboard on :${PORT}`));
