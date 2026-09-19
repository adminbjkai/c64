# Adding a tool mode

Every tool in c64 is a **mode**: a pure function from `(input, ctx)` to a
`ModeResult`, plus a small descriptor the shell uses to build the sidebar
entry, the pane header dropdown, the option controls, the primary action
button (`primaryLabel()` in `src/pane.ts` — add a case if "Run" is not the
right verb) and the empty-pane hint.
Modes never touch the DOM, so they run unchanged inside the Web Worker and are
unit-tested with `node --test`.

## Contract (`src/modes/types.ts`)

```ts
export interface ToolMode {
  id: string;             // stable, kebab-case, used in saved boards
  label: string;          // "URL Encode / Decode"
  description: string;    // one sentence, ends with a period
  category: ToolCategory; // one of CATEGORIES ('Start' is reserved for Auto detect)
  icon: string;           // key in src/icons.ts
  keywords?: string[];    // extra search terms for the sidebar / palette
  emptyHint: string;      // one line shown in an empty pane
  sample: string;         // "Try a sample" (empty pane, ⋯ menu, ? panel) inserts this — must run without error
  sampleOptions?: {…};    // options the sample sets too (e.g. a regex pattern)
  inputs?: 1 | 2;         // 2 = compare-style tool: the pane shows A/B editors, B arrives as ctx.inputB
  inputLabels?: [a, b];   // editor labels for two-input tools, e.g. ['Original', 'Changed']
  sampleB?: string;       // sample for the second editor
  outputLanguage?: …;     // 'json' | 'xml' | 'yaml' | 'css' | 'sql' | … (or a function of ctx) for output colouring
  controls: ModeControl[];// header options: select | toggle | text
  supportsPretty: boolean;// does the Pretty / Raw switch change the output?
  run(input, ctx): ModeResult | Promise<ModeResult>;
}
```

`ModeResult` carries `output` (plain text — Copy / Download always use it),
optional `error` (a `Diagnostic` with message and, when known, 1-based
`line`/`col` and a plain-English `hint`), optional `notes` (things that were
tolerated), a short `status` line, and optionally a `view` for a rich
renderer.

Rules every mode follows:

1. **Empty input returns `{ output: '', status: '' }`.** No error for nothing.
2. **Never throw.** Wrap parsing in try/catch and return `failure('What', e)`
   (from `types.ts`) or a hand-built `error`.
3. **Pure and worker-safe.** No `document`, `window`, `localStorage`, timers or
   network. `crypto.subtle` and `TextEncoder` are fine (available in workers).
4. **Structured-clone safe.** `view.data` may contain plain objects, arrays,
   strings, numbers, booleans, `Map`s and `Set`s — not functions or DOM nodes.
5. **Options are untrusted.** Read them defensively:
   `typeof ctx.options['x'] === 'string' ? … : default`.
6. **Status lines are short and factual**, e.g. `Valid JSON · object · 3 keys · 1.2 KB`.

## Steps

1. Create `src/modes/<id>.ts` exporting `run<Name>` and `<name>Mode`.
   Put reusable parsing in `src/lib/<thing>.ts` with a header comment stating
   exactly what subset it implements.
2. If the result needs a rich display, return `view: { kind, data }` and add a
   renderer in `src/views/<kind>.ts` (`ViewRenderer`), then register the kind
   in `src/views/index.ts`. Renderers get a `ViewContext` with `copy`,
   `selectInEditor`, `setOption` and `toast`.
3. Register the mode in `src/modes/index.ts` (order = sidebar order).
4. Add an icon path to `src/icons.ts` if none fits.
5. Write `tests/<id>.test.ts` covering: the sample, empty input, the Raw/Pretty
   split if `supportsPretty`, every control, and at least one error path with
   line/col when the parser can locate it.
6. Add a row to the modes table in `README.md` and `docs/modes.md`.

`npm test` builds and runs everything; the "every registered mode has a sample
that runs without error" test in `tests/modes.test.ts` will catch a bad sample
or a duplicate id.
