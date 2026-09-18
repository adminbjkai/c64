# Changelog

All notable changes to c64 are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Empty panes no longer ask twice. A brand-new pane shows "Pick a tool" with
  the tool grid (and a "Not sure? Try a … sample" button underneath); once a
  tool is chosen — from the sidebar, the header dropdown, the palette or the
  grid — the grid gives way to the tool's hint with Try a sample / Paste /
  Upload. Picking a tool in the sidebar now flashes the target pane's title
  bar, scrolls it into view and, with several panes open, names the pane it
  changed; Enter in the sidebar search clears the box after picking.

## [1.0.0] — 2026-09-18

First public release, live at <https://c64.bjk.ai>.

### Added
- **20 new tools** (32 total): URL encode/decode with URL breakdown, Query
  string ↔ JSON, HTML entities, Escape/Unescape (JSON, JS, CSV, shell, regex,
  XML, SQL), Case converter, Line tools, Text statistics, Markdown preview,
  HTML format/minify, SQL formatter, JSON → Types (TypeScript, Zod, Python,
  Go, JSON Schema), Hex/Binary/hexdump, Number base converter, Hash/HMAC
  (MD5, SHA-1/256/384/512, CRC32), UUID/ULID/nanoid/password generator and
  decoder, Unix time ↔ date, Cron expression describer with next runs, Text
  diff (line/word/char, side-by-side), Regex tester, Color converter.
- **Pipes**: a pane can read its input live from another pane's output
  ("Send on" / "Read input from…"), so tools chain — decode → format → convert.
- **Boards**: several named boards, switch/rename/duplicate/delete, export and
  import as JSON, and share links that carry the board in the URL fragment.
- **Command palette** (⌘/Ctrl+K) over tools, pane actions, panes and boards.
- Pane **maximise**, **duplicate**, **swap**, **rename**, **undo close**,
  per-pane **word wrap**, **find in output**, editor **line-number gutter**.
- Status bar, grouped shortcut help, adjustable content text size.
- **Offline support**: installable PWA with a service worker caching the shell.
- Production server: ETag, brotli/gzip, cache headers, full security headers.
- Deployment assets (`deploy/`), CI workflow, generated docs, screenshots.

### Changed
- Fresh visual design: tighter chrome, clearer active pane, responsive layout
  (sidebar becomes a drawer and panes stack below 900 px).
- Modes may now be asynchronous (used by WebCrypto digests).
- Sidebar and tool picker are grouped into seven categories.

### Removed
- The unused `file` mode-control kind and unused icons.

## [0.1.0] — 2026-09-16

Initial workspace: JSON format/validate, tree, path and graph views, XML,
YAML, CSV/TSV, Convert, Base64, JWT decode, Minify/Prettify and CSS, in
tileable panes with a Web Worker for large inputs and an Explain helper.

[Unreleased]: https://github.com/adminbjkai/c64/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/adminbjkai/c64/releases/tag/v1.0.0
[0.1.0]: https://github.com/adminbjkai/c64/commit/a2b5f36
