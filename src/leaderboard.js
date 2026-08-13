// Leaderboard client. Talks to the tiny service on the NAS.
//
// Every call fails soft: the game must stay fully playable with the network
// down, so a failed fetch degrades to "no board" rather than an error state.

const BASE = '/api';
const TIMEOUT = 6000;

async function call(path, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(BASE + path, { ...options, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // offline, blocked, or the service is down — all the same here
  } finally {
    clearTimeout(timer);
  }
}

export function fetchBoard(date) {
  return call(`/board?date=${encodeURIComponent(date)}`);
}

export function submitScore({ date, name, t, assist }) {
  return call('/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date, name, t, assist }),
  });
}
