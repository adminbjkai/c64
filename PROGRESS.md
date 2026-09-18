# PROGRESS — c64 v1.0: rebuild, deploy at c64.bjk.ai, publish repo

> Live working memory for this task. Updated at every stage boundary.

**Goal (one line):** c64 live at https://c64.bjk.ai (nginx + wildcard cert + systemd), substantially upgraded in capability, layout and style, with clean consistent code/docs and a professional GitHub repo with a tagged release.
**Started:** 2026-09-18 · **Sandbox:** production host, only c64-scoped changes.
**Definition of done:** every stage below ✅ with cited evidence.

## Assumptions
- Port 8166 (8165 is taken by cdx64). systemd unit named `c64.bjk.ai.service` like the sibling apps.
- Repo published as `adminbjkai/c64` (public) — same GitHub account `gh` is logged into.
- "Local-first / no user content leaves the browser" stays a hard product guarantee; every new mode is pure and worker-safe.

## Stages

| # | Stage / deliverable | Acceptance criterion | Status | Evidence |
|---|---|---|---|---|
| 1 | Own git repo, baseline commit | `git log` shows baseline; tests 186/186 | ✅ | commit "Import c64 workspace baseline" |
| 2 | Core contract upgrades (async modes, new categories, icons, control kinds) | `npm test` green | ✅ | commit "Mode contract: async-capable run…", 186/186 |
| 3 | New tool modes (4 parallel lanes, 20 modes) each with tests | every mode registered, tests green | ✅ | `npm test`: tests 408 · pass 408 · fail 0 |
| 4 | Shell capabilities: command palette, pipe panes, maximize, duplicate/swap/rename, boards manager, export/import, share link, undo close, editor gutter, wrap, output find, PWA offline | manual + smoke | ✅ | `scripts/smoke.py`: "SMOKE OK: 32 tools, panes, pipes, palette, boards, persistence"; SW registered on live site |
| 5 | Layout & style restructure, responsive/mobile | screenshots light/dark/mobile | ✅ | docs/screenshots/*.png reviewed (dark, light, pipes, tools, picker, palette, mobile) |
| 6 | Server: caching, gzip, ETag, prod mode; systemd; nginx; ports/subdomain docs | `curl -sI https://c64.bjk.ai` 200; healthz | ✅ | HTTP/2 200, CSP header, br encoding, `{"ok":true,"version":"1.0.0"}`, service active; SERVER_PORTS/SUBDOMAINS rows added |
| 7 | Docs: README, docs/, CHANGELOG, CONTRIBUTING, LICENSE, screenshots | files exist and accurate | ✅ | files in repo; docs/modes.md + shortcuts.md generated from registries (CI checks sync) |
| 8 | GitHub repo + CI + release v1.0.0 | `gh release view v1.0.0` | ✅ | github.com/adminbjkai/c64; CI success on main + v1.0.0 (Node 20/22/24); release asset c64-v1.0.0.tar.gz |
| 9 | Fresh-context verification | verifier PASS | 🔶 | verifier running |

## Decisions log
- Keep zero runtime deps and no bundler (auditability is the product's point). Hash mode uses WebCrypto (async) → `run` may return a Promise. (2026-09-18)
- Lanes must not edit shared registries (modes/index.ts, views/index.ts, icons.ts, types.ts); orchestrator wires them. (2026-09-18)

## Blockers / needs user
- none

## Lessons
- Node 20's `node --test` does not expand glob patterns — use a shell glob in the npm script.
- `container-type: inline-size` zeroes an element's intrinsic width; give flex children an explicit `flex: 1` when converting them to containers.
- Board constructor fires events before the const is assigned — guard event handlers with a `ready` flag.
