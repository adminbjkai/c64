# c64 — local-first encode / decode / format workspace

A dependency-free browser workspace for decoding, formatting, validating,
converting and exploring structured text — JSON, XML, YAML, CSV, Base64, JWT,
CSS — in resizable panes you tile across one board.

**Everything runs in your browser.** No user content is ever sent anywhere:
there are no API calls, no analytics, no sync. The page ships with a
Content-Security-Policy that only allows requests to its own origin, so even
an accidental `fetch` elsewhere would be blocked by the browser. Your board
(layout + each pane's input) is saved in `localStorage` on your machine only.

## Run

```sh
npm install        # dev-only: TypeScript compiler, nothing at runtime
npm start          # builds, then serves http://127.0.0.1:8165/
npm run dev        # same, plus `tsc --watch` for live recompiles (refresh to see changes)
npm test           # unit tests (node --test): parsers, layout model, every mode
```

Override the bind address with `HOST` / `PORT`:

```sh
HOST=0.0.0.0 PORT=3000 npm start
```

`GET /healthz` returns `{"ok":true}`.

## Modes (the dropdown in every pane header)

| Mode | Pretty | Raw | Extras |
|---|---|---|---|
| JSON Format / Validate | indented (2/4/tab), sort keys | minified | trailing commas, smart/single quotes, comments and bare keys are tolerated and reported; errors give line/col + a fix hint, click to jump |
| JSON Tree View | collapsible tree | — | expand/collapse all, copy value / copy path per node, click selects the value in the editor, paged for huge arrays |
| JSON Path | tree + path bar | — | click any node → `$.a.b[0].c` (dot/bracket toggle), live JSONPath query box (`..`, `[*]`, slices, unions, `[?(@.x > 1)]`) |
| JSON Graph | tidy tree of cards | — | zoom (wheel / + −), pan (drag / arrows), Fit (0), click a card → selected in editor |
| XML Format / Validate | indented | minified | well-formedness errors with line/col |
| YAML | reformatted YAML | equivalent JSON | validation with line/col |
| CSV / TSV | table preview | re-serialised CSV | delimiter auto-detect, header toggle, ragged-row warnings |
| Convert | — | — | JSON ↔ XML ↔ YAML ↔ CSV (any pair), source auto-detect, typed CSV cells |
| Base64 | decoded JSON pretty-printed | literal decoded text | auto encode/decode, URL-safe, `.txt` upload, byte counts, exact error position |
| JWT (decode only) | header / claims / signature | — | exp / iat / nbf as dates, Expired / Not-yet-valid badges, permanent "not verified" notice |
| Minify / Prettify | prettified | minified | JSON / XML / CSS auto-detected |
| CSS | beautified | minified | structural validation |

**Explain** (button in every header, `Alt+Shift+E`): a movable panel that
identifies what the input looks like (JWT, Base64-wrapped JSON, minified XML,
CSV, YAML, …), explains why, and offers one-click next steps. Pure heuristics,
runs locally.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `⌘/Ctrl+Enter` | Format now (skip the debounce) |
| `Alt+Shift+R` / `B` | Add pane right / below |
| `Alt+Shift+W` | Close pane (the last one always stays) |
| `Alt+Shift+C` | Copy output |
| `Alt+Shift+P` | Toggle Raw / Pretty |
| `Alt+Shift+E` | Explain this input |
| `Alt+Shift+L` | Stacked / side-by-side layout |
| `Alt+Shift+K` | Search tools |
| `Alt+Shift+M` | Focus the mode selector |
| `Alt+Shift+]` / `[` | Focus next / previous pane |
| `Alt+Shift+T` | Toggle dark / light theme |
| `Alt+Shift+/` | Show the shortcut list |
| `Tab` to a seam, then arrows | Resize (Shift = bigger steps); double-click a seam to reset |
| In the tree: `↑↓←→`, `Enter`, `c`, `p` | Move, expand/collapse, select, copy value, copy path |
| In the graph: `+ − 0`, arrows | Zoom, fit, pan |

## Layout

```
server.mjs            zero-dependency static server (+ /healthz)
public/               index.html, styles.css
src/main.ts           entry: theme, restore board, shortcuts, help panel
src/layout.ts         pure tiling-tree model (add/remove/resize/sanitize)
src/board.ts          renders the tree to DOM; seam dragging
src/pane.ts           one pane: header controls, editor, inner seam, output / rich view
src/runner.ts         runs a mode inline (small input) or in the Web Worker (large input)
src/worker.ts         the worker entry
src/explain.ts        local "what is this?" heuristics; explain-ui.ts is the floating panel
src/icons.ts          inline SVG icon set (no icon font)
src/modes/            one file per tool mode — pure (input, ctx) → result, worker-safe
src/views/            DOM renderers for rich results (tree, graph, JWT, table)
src/lib/              hand-rolled parsers/formatters: xml, yaml, css, csv, jsonpath, base64, graph-layout
tests/                node:test suites for every lib and mode
```

Adding a mode = implement `ToolMode` in `src/modes/` and register it in
`src/modes/index.ts`; the pane header's dropdown and option controls are
generated from it. A mode that needs a rich display returns a serializable
`view` and gets a renderer in `src/views/`.

## Design notes / assumptions

- **Zero runtime dependencies, no bundler.** Plain `tsc` emits ES modules the
  browser loads directly. The YAML, XML, CSS, CSV and JSONPath parsers are
  hand-rolled subsets (see each file's header for the exact scope and
  limitations — e.g. YAML has no anchors/aliases/tags, XML has no DTD
  entity expansion). A battle-tested library would need a bundler; that is a
  deliberate trade for a dependency-free, auditable build.
- **Shortcuts use `Alt+Shift+<key>`** rather than `Cmd/Ctrl+Shift` because the
  latter collides with text selection inside the editor and browser tab
  shortcuts. Matching is on `event.code`, so macOS Option-key symbols don't
  leak into the editor.
- **JSON parsing** tries native `JSON.parse` first (fast path); only on failure
  does the tolerant parser run. Tree / Path / Graph always use the tolerant
  parser because it records source spans for click-to-select.
- **Web Worker** kicks in above 150 000 characters; below that the mode runs
  inline so results are instant. A "working…" hint appears only if a run takes
  longer than ~120 ms.
- A new pane inherits its neighbour's mode and options (handy for side-by-side
  comparison); its input starts empty.
- Not done: a service worker for offline use after first load (the app has no
  network needs, so it already works with the tab open; caching for cold loads
  is a follow-up).
