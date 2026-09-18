// Minimal static dev server. Zero dependencies — Node's http module only.
//
// Serves:
//   /            -> public/index.html
//   /public/*    -> static assets (CSS, icons)
//   /dist/*      -> compiled TypeScript output (ES modules)
//   /healthz     -> {"ok":true} for liveness probes
//
// It never receives user content: the app makes no requests beyond loading
// its own static files. There is intentionally no POST handling at all.
//
// Config: HOST (default 127.0.0.1) and PORT (default 8165) env vars.
// `--watch` additionally spawns `tsc --watch` so edits recompile live.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8165);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/** Resolve a URL path to a file under ROOT, refusing anything that escapes it. */
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? 'public/index.html' : decoded.replace(/^\/+/, '');
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end('{"ok":true}');
  }

  const file = resolveSafe(req.url || '/');
  if (!file) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      // Dev server: never cache, so a rebuild is always picked up on refresh.
      'Cache-Control': 'no-store',
      // Belt and braces for the local-only guarantee: the page may only talk
      // to itself. Any accidental fetch to another origin is blocked by the browser.
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'",
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`c64 workspace  →  http://${HOST}:${PORT}/   (health: /healthz)`);
});

if (process.argv.includes('--watch')) {
  const tsc = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--watch', '--preserveWatchOutput'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  process.on('exit', () => tsc.kill());
}
