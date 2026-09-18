# Contributing

Thanks for helping make c64 better. The bar is simple: keep it local-first,
dependency-free and tested.

## Ground rules

1. **No runtime dependencies, no bundler.** `tsc` emits ES modules the browser
   loads directly. If a feature seems to need a library, write the subset you
   need in `src/lib/` with a header comment stating its scope.
2. **No network.** The CSP forbids it and the tests would not catch it, so
   please do not add `fetch`, beacons, fonts from CDNs or analytics.
3. **Modes are pure.** No DOM in `src/modes/` or `src/lib/`; they run in a
   Web Worker. Rich output goes through a `view` and a renderer in `src/views/`.
4. **Every change has tests.** `npm test` must stay green (TypeScript strict
   mode, `noUncheckedIndexedAccess` on).

## Workflow

```sh
npm install
npm run dev          # serves http://127.0.0.1:8166 and recompiles on save
npm test
node scripts/gen-docs.mjs   # after changing a mode or a shortcut
```

* New tool: follow [docs/adding-a-mode.md](docs/adding-a-mode.md).
* Keep commits focused; describe *why* in the body when it is not obvious.
* Update `CHANGELOG.md` under **Unreleased**.
* Open a PR; CI runs the test matrix and checks the generated docs are in sync.

## Style

Two-space indent, single quotes, trailing commas, 140-column lines. Prefer
small pure functions and explicit types at module boundaries. File headers
explain the file's job in a few sentences — keep them accurate when you
change behaviour.
