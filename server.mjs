// Static server for c64. Zero dependencies — Node's http and zlib only.
//
// Serves:
//   /                       -> public/index.html
//   /public/*               -> static assets (CSS)
//   /dist/*                 -> compiled TypeScript output (ES modules)
//   /sw.js /manifest.webmanifest /icon*.{svg,png}  -> from public/ at the root
//   /healthz                -> {"ok":true,"version":"…"} for liveness probes
//
// It never receives user content: the app makes no requests beyond loading
// its own static files. There is intentionally no POST handling at all.
//
// Config (env): HOST (default 127.0.0.1), PORT (default 8166),
//   NODE_ENV=production enables long-lived caching (ETag + max-age) for
//   /dist and /public; development serves everything with no-store.
// `--watch` additionally spawns `tsc --watch` so edits recompile live.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8166);
const PROD = process.env.NODE_ENV === 'production';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

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
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.map', '.css', '.json', '.svg', '.webmanifest', '.txt']);
/** Files that live in public/ but are addressed at the site root (PWA needs). */
const ROOT_FILES = new Set(['sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'favicon.ico', 'robots.txt']);

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Resolve a URL path to a file under ROOT, refusing anything that escapes it. */
function resolveSafe(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const rel = decoded.replace(/^\/+/, '');
  let target;
  if (rel === '') target = 'public/index.html';
  else if (ROOT_FILES.has(rel)) target = `public/${rel}`;
  else if (rel.startsWith('public/') || rel.startsWith('dist/')) target = rel;
  else return null;
  const abs = path.resolve(ROOT, target);
  if (!abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function cacheControl(file) {
  if (!PROD) return 'no-store';
  const base = path.basename(file);
  // The document and the service worker must always be revalidated so a new
  // deploy is picked up; everything else can sit in caches for a while.
  if (base === 'index.html' || base === 'sw.js') return 'no-cache';
  return 'public, max-age=3600, stale-while-revalidate=86400';
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, version: VERSION }));
  }

  const file = resolveSafe(req.url || '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(file);
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl(file),
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
      Vary: 'Accept-Encoding',
    };
    if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    const accept = String(req.headers['accept-encoding'] || '');
    const encoding = COMPRESSIBLE.has(ext) && stat.size > 1024 ? (accept.includes('br') ? 'br' : accept.includes('gzip') ? 'gzip' : null) : null;
    if (encoding) headers['Content-Encoding'] = encoding;
    else headers['Content-Length'] = stat.size;

    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    if (encoding === 'br') stream.pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })).pipe(res);
    else if (encoding === 'gzip') stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
    else stream.pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`c64 v${VERSION} ${PROD ? '(production)' : '(dev)'}  →  http://${HOST}:${PORT}/   (health: /healthz)`);
});

if (process.argv.includes('--watch')) {
  const tsc = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--watch', '--preserveWatchOutput'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  process.on('exit', () => tsc.kill());
}
