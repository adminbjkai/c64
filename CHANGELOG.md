# Changelog

All notable changes to c64 are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.1] — 2026-09-19

### Fixed
- Options written by Auto detect (e.g. Base64 direction) no longer leak into a later manual tool pick or survive Clear.
- Auto detect keeps re-evaluating while you type until you pick a tool yourself, so a JWT is no longer locked in as Base64 after its first characters.
- The Pretty / Raw switch is hidden in Auto detect, where it has nothing to act on.
- The landing chip counts all tools including Auto detect, matching the docs.

## [1.2.0] — 2026-09-19

Paste-first redesign, planned against jsonformatter.org, base64decode.org,
jsoncrack.com and the Prettier playground: paste → result, one obvious action.

### Added
- **Auto detect** pseudo-tool (category *Start*, first in the sidebar): every
  new pane starts in it. Paste anything and the pane switches to the right
  tool — JSON, JWT, Base64, XML, CSS, CSV, YAML, hex, URL, URL-encoded text,
  query string or cron — showing a "Detected … · change" chip. Manual choices
  win; *Clear* returns the pane to Auto. Explain now recognises URL-encoded
  text, bare host/path URLs and cron expressions.
- **Primary action button** at the right of every options bar ("Format JSON",
  "Decode JWT", "Compare", "Show table", …); Shift+click runs and copies.
- Start chips under the empty Auto editor (JSON · Base64 · JWT · Diff · YAML ·
  Convert · All 53 tools ›).

### Changed
- New panes on boards ≥ 900 px wide put input and output **side by side**;
  saved boards keep their layout. The output status is the prominent line,
  with a green / red dot; an empty output reads "Result appears here as you type."
- Less chrome: the tool grid, topbar hint and Shortcuts button are gone (the
  shortcut list is in the palette as "Keyboard shortcuts" and on Alt+Shift+/).
  Layout, maximise, split, close and the ? panel moved into the pane's ⋯ menu
  (the icons return on multi-pane boards); Find and Download sit behind ⋯ in
  the output head; tools with more than three options fold the rest behind
  "Options ▾". One "+ Pane ▾" topbar button replaces the two split buttons.
  The sidebar starts collapsed on a first visit.
- The `fresh` pane flag is replaced by `detected`; legacy untouched panes load
  as Auto.
- **JSON Graph rebuilt** in the jsoncrack style: the canvas fills the pane,
  a floating pill holds zoom / fit / search / collapse controls, node search
  highlights and centres matches, clicking a card opens a details drawer
  (path, summary, raw subtree, copy / select in editor), and any container
  card can be collapsed. Very large documents start partially collapsed.

## [1.1.1] — 2026-09-19

### Fixed
- "New board" showed the wrong icon (missing `plus` glyph).
- Text Diff is listed under Compare, matching the README and its A / B editors.
- Rich-views paragraph in `docs/modes.md` covers the v1.1 views.

## [1.1.0] — 2026-09-19

Planned against what IT-Tools, DevToys, CyberChef, JSON Crack and the JSON
diff sites offer; closes the common gaps while staying local-only.

### Added
- **Compare tools** with proper side-by-side **A / B editors** (Swap button,
  per-editor counts): **JSON Compare**, **XML Compare** and **YAML Compare**
  share one structural diff engine (key-order insensitive; arrays by index,
  LCS, key field or set; move detection; ignore paths; case / whitespace /
  numeric-string normalisation) with a side-by-side or inline tree, filter
  chips, Prev / Next navigation and **JSON Patch (RFC 6902)** as the Raw
  output. **JSON Patch / Merge Patch** applies RFC 6902 or RFC 7386 patches.
  **List Compare** gives intersection, differences, union and symmetric
  difference of two lists. Text Diff now uses the A / B editors too.
- **JSON tools**: Schema Validate (draft-07 / 2019-09 / 2020-12 core keywords,
  `$ref`, formats, all errors listed with pointers), JSON → Table (flattened,
  sortable, filterable; CSV / TSV / Markdown output), Flatten / Unflatten,
  Sort & Normalise.
- **Formats**: TOML ↔ JSON, and TOML in the Convert matrix.
- **Encoding**: Gzip / Deflate (base64 or hex), Data URL / File Base64 with
  image preview — dropping or uploading a binary file now produces a data URL.
- **Generators**: QR Code (versions 1–40, ECC L–H, SVG / PNG download,
  Wi-Fi / vCard / email / SMS presets), TOTP / HOTP (RFC 6238 / 4226, otpauth
  URLs, live countdown), Lorem Ipsum / fake data.
- **Text**: HTML → Markdown, String Utilities (slugify, deburr, NATO, ROT13 /
  ROT47, obfuscate, roman numerals, unicode escapes, code points).
- **Developer**: Math Evaluator (exact BigInt integers, variables, percent),
  Unit Converter (13 categories incl. SI vs IEC data sizes and temperature),
  IP / Subnet Calculator (IPv4 / IPv6, ranges → CIDR, classification,
  reverse DNS, splitting), chmod Calculator.
- **Workspace**: syntax-highlighted output (JSON, XML, HTML, YAML, CSS, SQL,
  TOML, Markdown, TypeScript, Python, Go), **favourites** (star a tool) and
  **recent tools** at the top of the sidebar and palette, a per-tool **info
  panel** (what it does, options, limits, docs link).

### Changed
- 53 tools in nine categories (new: Compare, Generators).
- Empty pane flow: the tool grid only shows for a brand-new pane; after a tool
  is chosen the editor fills the pane with a compact hint and actions strip.
- The sidebar pick is confirmed with a title flash and, with several panes, a
  toast naming the target pane.

### Fixed
- Status bar updates immediately after a sidebar pick.

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

[Unreleased]: https://github.com/adminbjkai/c64/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/adminbjkai/c64/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/adminbjkai/c64/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/adminbjkai/c64/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/adminbjkai/c64/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/adminbjkai/c64/releases/tag/v1.0.0
[0.1.0]: https://github.com/adminbjkai/c64/commit/a2b5f36
