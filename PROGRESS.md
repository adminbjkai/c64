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
| 9 | Fresh-context verification | verifier PASS | ✅ | fable-verifier: PASS on all 8 criteria (tests, registries, docs sync, leftovers, live site, browser, privacy, GitHub) |

## Round 2 (2026-09-19) — v1.1: compare tools + competitive gap closure

| # | Stage | Acceptance | Status | Evidence |
|---|---|---|---|---|
| R2-1 | UX audit + fix: sidebar pick asks once (fresh/ready states) | verifier PASS, live | ✅ | verifier 12/12; deployed |
| R2-2 | Competitive research brief (IT-Tools, DevToys, CyberChef, jsondiff…) | decided gap list | ✅ | researcher brief, 18 tools + 8 UX items |
| R2-3 | Two-input (A/B) editor contract; Text Diff uses it | tests + smoke | ✅ | 410/410, SMOKE OK, commit "Two-input tools" |
| R2-4 | Lane 1 Compare: json-diff, xml-diff, yaml-diff, json-patch, list-compare | tests green | ✅ | 34 tests; fuzz 4000 pairs round-trip OK |
| R2-5 | Lane 2 Data: json-schema, json-table, json-flatten, json-sort, toml (+Convert), gzip | tests green | ✅ | 102 tests |
| R2-6 | Lane 3 Generators: qr-code, totp, lorem, string-utils, math-eval | tests green | ✅ | 55 tests; RFC 4226/6238 vectors |
| R2-7 | Lane 4 Utilities: unit-convert, ip-subnet, html-to-markdown, data-url, chmod | tests green | ✅ | 73 tests |
| R2-8 | Shell: highlighting, favourites/recent, info panel, swap, data-URL uploads | browser check | ✅ | 24 hl spans, favourites section, no errors (screenshot) |
| R2-9 | Register + style all lanes, docs/README/CHANGELOG, screenshots, v1.1.0 release, deploy | verifier PASS, CI green, live | ✅ | verifier PASS (3 minor gaps fixed in v1.1.1: plus icon, Text Diff category, stale comment); CI success main + v1.1.0; release asset c64-v1.1.0.tar.gz; live healthz 1.1.x |

## Round 3 (2026-09-19) — v1.2: paste-first UX

| # | Stage | Acceptance | Status | Evidence |
|---|---|---|---|---|
| R3-1 | UX spec from jsonformatter / base64decode / jsoncrack / prettier | decided design | ✅ | specialist brief (editor 108px → dominant) |
| R3-2 | Auto detect tool, smart detection, primary button, chrome reduction, side-by-side default | tests + smoke + screenshots | ✅ | 683/683; SMOKE OK 54 tools … auto-detect; first-visit screenshots reviewed |
| R3-3 | JSON Graph rebuilt (canvas, pill, search, drawer, collapse) | tests + screenshots | ✅ | graph tests 10/10; /tmp/graph.png reviewed |
| R3-4 | Release v1.2.0, deploy, verify | verifier PASS, CI, live | ✅ | verifier PASS-with-concerns; CI success; healthz 1.2.0 |
| R3-5 | Patch v1.2.1: option leak, re-detect while typing, Pretty/Raw in Auto, chip count | repro passes | ✅ | repro script: manual Base64 → "Decode / Encode", direction auto, 0 errors |

## Round 4 (2026-09-19) — v1.3: design system

| # | Stage | Acceptance | Status | Evidence |
|---|---|---|---|---|
| R4-1 | Design lead spec: identity, tokens, layout anatomy, view primitives, interactivity, copy rules, 3 lanes | decided spec | ✅ | /tmp/spec/design-spec.md (72 lines) |
| R4-2 | Lane A tokens/type (JetBrains Mono self-hosted)/frame/pane chrome | tests, smoke, screenshots | ✅ | fonts 105 KB; heights measured 40/32/36/28/24 |
| R4-3 | Lane B view primitives (src/views/ui.ts) + all 26 views migrated | tests, screenshots | ✅ | 12 screenshots reviewed by lane; overflow probe clean |
| R4-4 | Lane C drag-reorder, view-as, inline copy, keyboard, palette groups | tests, browser | ✅ | 39/39 browser checks; +17 tests |
| R4-5 | Merge, verify, docs, release v1.3.0, deploy | verifier PASS, CI, live | 🔶 | 704/704, SMOKE OK, healthz 1.3.0 live, tag pushed; verifier running |

## Decisions log
- Accent moves from green to indigo (#4a5bd8 / #8b97ff) so green means "valid"; JetBrains Mono self-hosted is the one bold typographic choice. (2026-09-19)
- Keep zero runtime deps and no bundler (auditability is the product's point). Hash mode uses WebCrypto (async) → `run` may return a Promise. (2026-09-18)
- Lanes must not edit shared registries (modes/index.ts, views/index.ts, icons.ts, types.ts); orchestrator wires them. (2026-09-18)

## Blockers / needs user
- none

## Lessons
- Node 20's `node --test` does not expand glob patterns — use a shell glob in the npm script.
- `container-type: inline-size` zeroes an element's intrinsic width; give flex children an explicit `flex: 1` when converting them to containers.
- Board constructor fires events before the const is assigned — guard event handlers with a `ready` flag.
