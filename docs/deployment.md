# Deployment

c64 is a static site behind a tiny Node server. Production at
<https://c64.bjk.ai> runs exactly the files in `deploy/`.

## Requirements

* Node 20+ (production uses Node 26; `npm ci` needs the dev dependency
  `typescript` only for `npm run build`).
* nginx with the `bjk.ai` wildcard certificate at
  `/etc/letsencrypt/live/bjk.ai/`.

## First deploy

```sh
git clone https://github.com/adminbjkai/c64.git /apps/c64
cd /apps/c64
./deploy/deploy.sh
```

`deploy.sh` installs dependencies, builds, installs the systemd unit and the
nginx vhost, enables and restarts the service, reloads nginx and checks
`/healthz` plus the public URL. Re-run it after every `git pull`.

## What gets installed

| Piece | Path | Notes |
|---|---|---|
| Service | `/etc/systemd/system/c64.bjk.ai.service` | `NODE_ENV=production HOST=127.0.0.1 PORT=8166`, hardened (`ProtectSystem=strict`, read-only app dir) |
| Vhost | `/etc/nginx/sites-available/c64.bjk.ai` (+ symlink in `sites-enabled`) | HTTP→HTTPS redirect, wildcard cert, proxy to 8166 |
| App | `/apps/c64` | `dist/` is the build output, `public/` the static files |

## Server behaviour

* Serves `/`, `/public/*`, `/dist/*` and the PWA root files
  (`/sw.js`, `/manifest.webmanifest`, `/icon*.{svg,png}`).
* `GET /healthz` → `{"ok":true,"version":"<package.json version>"}` (no caching).
* In production: `ETag` + `Last-Modified`, `Cache-Control: public, max-age=3600,
  stale-while-revalidate=86400` for assets, `no-cache` for the document and the
  service worker, brotli/gzip for text types, and the security headers
  (CSP, nosniff, no-referrer, frame-deny, COOP).
* Anything that is not one of those paths is a 404; there is no POST.

## Operations

```sh
sudo systemctl status c64.bjk.ai          # is it up?
sudo journalctl -u c64.bjk.ai -n 50       # logs
curl -s https://c64.bjk.ai/healthz        # liveness through nginx
```

Releases: bump `version` in `package.json`, add the CHANGELOG entry, commit,
`git tag vX.Y.Z && git push --tags`. CI builds, tests and attaches a tarball
to the GitHub release; `npm run build` stamps the version into the UI and the
service-worker cache name so clients refresh on the next visit.
