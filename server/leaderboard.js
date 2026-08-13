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

// --- telemetry ---------------------------------------------------------------
// Append-only JSON lines, one object per finished run, for tuning the game. The
// client sends nothing identifying (see src/telemetry.js); this end stores no IP
// either — the address is used for rate limiting and then dropped, so a stored
// record cannot be tied to a person even by whoever runs the server.
const TELEM = process.env.TELEMETRY_FILE || path.join(__dirname, 'data', 'runs.jsonl');
const TELEM_MAX_BYTES = 64 * 1024 * 1024; // rotate rather than fill the volume
// An allow-list, not a filter: a field that is not named here cannot be stored,
// so a client that starts sending something unexpected cannot quietly widen what
// is collected.
const TELEM_FIELDS = {
  v: 'number', date: 'string', stage: 'string', t: 'number', finished: 'boolean',
  phase: 'string', walls: 'number', sides: 'number', pattern: 'string',
  depth: 'number', spin: 'number', flavour: 'string', twinSeed: 'boolean',
  twinAt: 'boolean', charges: 'number', rescues: 'number', assist: 'number',
  assisted: 'boolean', grazes: 'number', bestChain: 'number', practice: 'boolean',
  input: 'string', fps: 'number', shape: 'string',
};

function cleanRun(data) {
  if (!data || typeof data !== 'object') return null;
  const out = {};
  for (const [k, kind] of Object.entries(TELEM_FIELDS)) {
    const v = data[k];
    if (v === undefined || v === null) continue;
    if (kind === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > 1e6) continue;
      out[k] = Math.round(n * 100) / 100;
    } else if (kind === 'boolean') {
      out[k] = !!v;
    } else if (typeof v === 'string') {
      // Short and character-restricted: nothing a player could type can survive
      // this, which is what keeps free text out of the file.
      // 40, not 24: every string here is a game constant (a stage, pattern,
      // phase or flavour name) and the longest phase name was being truncated
      // mid-word. Still far too short and too restricted for anything a player
      // could type to survive, which is the property that matters.
      const str = v.slice(0, 40).replace(/[^A-Za-z0-9 ·_.:-]/g, '');
      if (str) out[k] = str;
    }
  }
  if (typeof out.t !== 'number' || out.t < 0 || out.t > MAX_TIME) return null;
  if (!out.date || !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) return null;
  return out;
}

function appendRun(rec) {
  try {
    const st = fs.existsSync(TELEM) ? fs.statSync(TELEM) : null;
    if (st && st.size > TELEM_MAX_BYTES) fs.renameSync(TELEM, `${TELEM}.1`);
    // The server's own clock, not the client's: a timestamp a client can set is
    // a timestamp that cannot be trusted, and this one is only ever used to
    // bucket runs by day.
    fs.appendFileSync(TELEM, `${JSON.stringify({ ...rec, at: Date.now() })}\n`);
  } catch (err) {
    console.error('telemetry append failed', err.message);
  }
}

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
  // 204 means "no content" and a body makes it malformed. The pre-existing
  // OPTIONS reply was already sending one; telemetry replies 204 constantly, so
  // it is worth getting right rather than repeating.
  if (code === 204) {
    res.writeHead(204, {
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }
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

    if (req.method === 'POST' && url.pathname === '/api/telemetry') {
      // Always 204, even when dropped: telemetry is never worth telling a client
      // about, and a silent endpoint gives nothing back to poke at.
      if (rateLimited(ip)) return send(res, 204, null);
      let body = '';
      let tooBig = false;
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2048) { tooBig = true; req.destroy(); }
      });
      req.on('end', () => {
        if (tooBig) return;
        try {
          const rec = cleanRun(JSON.parse(body));
          if (rec) appendRun(rec);
        } catch { /* malformed telemetry is not worth a response */ }
        send(res, 204, null);
      });
      return undefined;
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
