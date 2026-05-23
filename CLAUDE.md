# resilient-cache — Project Notes for Claude

## Known Issues & Intentional Decisions

### `npm ci || npm install` in publish pipeline

The publish pipeline uses `npm ci || npm install` as a deliberate fallback, not a workaround to clean up.

**Root cause:** `@rolldown/binding-wasm32-wasi` is a `cpu: ["wasm32"]` optional package pulled in transitively via `vitest → vite → rolldown`. On every real platform (macOS x64, macOS arm64, Linux x64), npm skips resolving its transitive deps (`@emnapi/core`, `@emnapi/runtime`) because the package doesn't apply. This leaves the lockfile with references to those packages but no entries for them, causing `npm ci` to fail with `EUSAGE`.

**Alternatives that were tried and rejected:**
- `npm install --package-lock-only` — npm still skips the wasm32 deps on all real platforms, so the lockfile stays incomplete
- `npm ci --omit=optional` — also skips `@rolldown/binding-darwin-x64` (the native rolldown binding vitest actually needs), causing a startup crash
- Pinning `@emnapi/core`/`@emnapi/runtime` in devDependencies — installs wasm32 runtime helpers on platforms where they serve no purpose

The fallback is safe: the missing packages are irrelevant on every platform we build or publish from.
