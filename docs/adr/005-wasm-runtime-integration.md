# ADR 005: WASM runtime integration and fallback chain

Date: 2026-11-09
Status: **Proposed** (pending user review)
Deciders: Architect
Related stories: WA-3 (gap), WA-4, WA-5
Contract: [`contracts/wasm-integration.md`](../../contracts/wasm-integration.md)
Amends: [`contracts/adr-004-wasm-engine.md`](../../contracts/adr-004-wasm-engine.md), invariant 5 ("the loader is not imported by the main thread directly")

## Context

ADR-004 chose a Rust/WASM engine running in a Web Worker. Turning that into a shippable feature requires three decisions:

1. **How the artifacts reach the browser.**
   - `maven-resources-plugin` excludes `static/**`, so static content in the JAR is only Vite's output.
   - Vite emits only files reachable from `index.html`, and `emptyOutDir` wipes everything else.
   - The Vite build also runs before `wasm-pack` in the Maven lifecycle.
   - As a result, `/wasm/*` was never in the JAR.
2. **How the worker is loaded.** `engine/loader.js` and the `wasm-pack --target web` glue are ES modules.
3. **What happens when the worker or WASM is unavailable.**
   - Possible causes: module workers unsupported (Firefox < 114), CSP or fetch failure, the WASM not built (CI frontend-only jobs, the current Docker image), or an engine fault.
   - Also, `initEngine()` is async, while the current `simulateBullet()` is synchronous.

## Options considered

### A. Delivery
| Option | Verdict |
|---|---|
| A1. Serve `static/wasm/` verbatim under `/wasm/*` (Vite `publicDir`) | Rejected. The files are unhashed, so caches can serve a mismatched glue/WASM pair after a deploy, and `WebConfig` would serve them `no-cache` on every load. WA-6 wants hash-versioned caching. |
| **A2. Bundle through Vite via a `virtual:wasm-engine` plugin that resolves to the staged files, or to a stub when absent** | **Chosen.** Engine assets become content-hashed `/assets/*` files with immutable caching. The worker and `.wasm` are discovered through the standard `new URL(..., import.meta.url)` pattern. A build without WASM still succeeds, and `WASM_REQUIRED=true` enforces WASM where it's needed. This follows the repo's existing virtual-module plugin pattern. |

### B. Worker type
| Option | Verdict |
|---|---|
| B1. Classic worker plus a second `wasm-pack --target no-modules` build | Rejected. It needs two build targets and two loaders. |
| **B2. Module worker (`{ type: 'module' }`)** | **Chosen.** It's baseline in all evergreen browsers. Older browsers are covered by the inline tier (C). |

### C. Fallback chain
| Option | Verdict |
|---|---|
| C1. Worker → JS | Simpler, but any worker startup failure loses WASM accuracy entirely, including spin drift and Java parity. |
| C2. Inline WASM only (no worker) | Rejected. It blocks the main thread, which defeats WA-5. |
| **C3. Worker WASM → inline WASM → JS `simulateBulletJS()`** | **Chosen**, as requested in the brief. The main bundle gains the small glue module. The `.wasm` is fetched only on `initEngine()`. |

## Decision

1. **Delivery (A2):**
   - `engine/stage.sh` stages an explicit allowlist into `src/main/resources/static/wasm/` during `generate-sources`, before Vite runs.
   - Vite resolves `virtual:wasm-engine` to the staged `engine-entry.js`, or to a stub that reports WASM as unavailable.
2. **Module worker (B2):** `engine.worker.js` → `worker-core.js` → `loader.js`. Messages are correlated by an integer id.
3. **Three tiers (C3), with these demotion rules:**
   - *Startup* failure of the worker (cannot construct, `init_error`, script error, 10 s timeout) → try **inline**. These failures are environmental.
   - *Runtime* failure of a ready worker (`EngineFault`, `error`/`messageerror`, 15 s request timeout) → **JS** for the rest of the session. These failures are engine bugs, so reusing the instance isn't safe.
   - `BallisticsEngineError` (the engine rejected this input) → JS for **that call only**, with no demotion.
4. **Async facade:**
   - `simulateBullet()` becomes `async` and **never rejects**.
   - The old body becomes `simulateBulletJS()`.
   - `tools.js` keeps receiving the facade as an injected `computeFn` and never imports the engine.
5. **Lifecycle:**
   - Graceful `{type:'terminate'}` on `pagehide`, and restart on `pageshow` when the page comes back from the back/forward cache.
   - `worker.terminate()` only for a wedged worker (request timeout).

## Consequences

**Positive**
- WASM actually ships. Assets are cache-safe (hashed) and deploy-consistent.
- No CSP change is needed. The same-origin module worker falls back to `script-src 'self'`.
- The UI never breaks because of the engine: every failure ends in the JS fallback.
- Frontend CI stays Rust-free thanks to the stub module.

**Negative / risks**
- Every client-compute call site becomes async: four sites in `ballistics.js`, plus `calcBC` in `tools.js`. About 40 existing physics tests are renamed to `simulateBulletJS`.
- A build without WASM silently produces a JS-only bundle unless `WASM_REQUIRED=true`. The production Docker image currently can't build WASM (contract Q1).
- `engine/engine-entry.js` (3 lines, `import.meta`) sits outside Jest coverage. It's verified by the CI JAR check and e2e instead.
- The JS tier silently lacks spin drift. Making the tier visible to users is open question Q3.
