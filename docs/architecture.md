# Architecture

c64 is a static, dependency-free web app: TypeScript compiled by `tsc` straight
to ES modules that the browser loads directly. There is no bundler, no
framework and no runtime dependency, which keeps the whole build auditable.

## Layout

```
server.mjs               zero-dependency static server (+ /healthz, gzip/brotli, ETag, CSP)
public/                  index.html, styles.css, PWA files (manifest, sw.js, icons)
src/main.ts              entry: theme + prefs, boards, sidebar, top/status bars, palette, shortcuts, SW
src/layout.ts            pure tiling-tree model (add / remove / swap / resize / sanitize)
src/board.ts             renders the tree to DOM; seams, zoom, pipes, undo-close
src/pane.ts              one pane: header + menu, options, editor with gutter, output + find, views
src/palette.ts           command palette (fuzzy search over tools, actions, panes, boards)
src/highlight.ts         regex tokenisers that colour the text output per language
src/store.ts             localStorage persistence: boards file, prefs, theme (with v0.1 migration)
src/shortcuts.ts         keyboard shortcut table (also feeds the help panel and docs)
src/runner.ts            runs a mode inline (small input) or in the Web Worker (large input)
src/worker.ts            the worker entry
src/explain.ts           local "what is this?" heuristics; explain-ui.ts is the floating panel
src/ui.ts                DOM helper h(), toast, clipboard, theme, popover menu
src/icons.ts             inline SVG icon set (no icon font)
src/version.ts           generated from package.json by scripts/sync-version.mjs
src/modes/               one file per tool — pure (input, ctx) → result, worker-safe
src/views/               DOM renderers for rich results (tree, graph, table, jwt, diff, …)
src/lib/                 hand-rolled parsers/formatters: json, xml, yaml, css, csv, html, sql,
                         markdown, jsonpath, base64, percent, entities, diff, md5, crc32, uuid, color…
tests/                   node:test suites for every lib and mode
scripts/                 sync-version, gen-docs, make-icons, screenshots
deploy/                  nginx vhost, systemd unit, deploy.sh
docs/                    this folder
```

## Data flow

1. The **board** is a tree of `SplitNode`s (row / column, sizes summing to 1)
   and `PaneNode`s. Every pane holds its own `PaneState`: mode id, input text,
   options, Pretty/Raw, layout, seam position, optional title, optional
   `sourceId` (pipe), wrap flag and a `fresh` flag (true until a tool is
   picked, input arrives or a pipe is linked — it decides which empty state
   the pane shows: the tool grid, or the mode's hint with Sample/Paste/Upload).
2. Typing in a pane debounces (180 ms) then calls `runMode(modeId, input, ctx)`.
   Inputs under 150 000 characters run on the main thread; larger ones are
   posted to the Web Worker so the UI never freezes. A "working" bar appears
   only if a run takes longer than ~120 ms.
3. A mode returns a `ModeResult`: text `output`, optional `error` (with
   line/col and hint), `notes`, a `status` line, and optionally a
   `view { kind, data }`. The pane renders text into a `<pre>` or hands the
   view to the matching renderer in `src/views/`.
4. When a pane's output changes, the board pushes it into every pane whose
   `sourceId` points at it — that is a **pipe**. Cycles are refused.
5. Every change persists (debounced) to `localStorage` under the boards file
   (`c64.boards.v1`). Several named boards coexist; one is current.

## Privacy model

* The page ships a strict Content-Security-Policy (`default-src 'self'`,
  `connect-src 'self'`, `frame-ancestors 'none'`). The server repeats it as a
  header. No script can call out even by accident.
* The server only answers `GET`/`HEAD` for its own files. There is no POST
  handler and no logging of query strings with content.
* Share links put the compressed board in the URL *fragment*, which browsers
  never send to the server.
* The service worker caches only the app shell; there is no user-content
  request for it to intercept.

## Adding things

* A new tool: see [adding-a-mode.md](adding-a-mode.md). Compare-style tools declare `inputs: 2` and receive the second editor as `ctx.inputB`.
* A new rich view: implement `ViewRenderer` in `src/views/` and register the
  `kind` in `src/views/index.ts`.
* A new shortcut: add a row to `buildShortcuts()` in `src/shortcuts.ts` — the
  help panel, the palette and `docs/shortcuts.md` pick it up.
* A new persistent preference: extend `Prefs` in `src/store.ts` and its
  loader; keep the loader tolerant of old data.

## Testing

`npm test` compiles everything and runs `node --test` over `dist/tests`.
Modes are pure, so tests call `run<Mode>(input, { pretty, options })` directly
and assert on strings and view data; `tests/modes.test.ts` additionally
checks that every registered mode's sample runs cleanly and that ids are
unique. Time-dependent modes read `options.now` so tests are deterministic.
