#!/usr/bin/env bash
# Build and (re)start c64 on this host. Idempotent; safe to re-run after `git pull`.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
npm run build
sudo install -m 644 deploy/c64.bjk.ai.service /etc/systemd/system/c64.bjk.ai.service
sudo install -m 644 deploy/c64.bjk.ai.nginx.conf /etc/nginx/sites-available/c64.bjk.ai
sudo ln -sf /etc/nginx/sites-available/c64.bjk.ai /etc/nginx/sites-enabled/c64.bjk.ai
sudo systemctl daemon-reload
sudo systemctl enable --now c64.bjk.ai
sudo systemctl restart c64.bjk.ai
sudo nginx -t && sudo systemctl reload nginx
sleep 1
curl -fsS http://127.0.0.1:8166/healthz && echo
curl -fsSI https://c64.bjk.ai/ | head -1
