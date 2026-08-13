// Dev server. Static files with caching disabled — browsers hold ES modules in
// memory aggressively, and a stale module during iteration looks exactly like a
// bug in your code. Not needed to play the game; any static host will do.
//
//   node serve.js [port]

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 4910;
const root = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.join(root, rel);

    // Never serve outside the project directory.
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    fs.stat(file, (statErr, st) => {
      if (statErr || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const head = {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store, no-cache, must-revalidate',
        'accept-ranges': 'bytes',
        // Caddy sends these in production and the client uses them to notice a
        // new build. Without them here, that path could only ever be tested live.
        'last-modified': st.mtime.toUTCString(),
        etag: `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`,
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, head).end();
        return;
      }

      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        res.writeHead(200, head);
        res.end(data);
      });
    });
  })
  .listen(port, () => console.log(`hex machina dev server → http://localhost:${port}`));
