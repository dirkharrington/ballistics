# ADR 008: TypeScript port of the JS engine as the sole in-browser physics engine

Date: 2026-11-15
Status: **Proposed** (pending user review)
Deciders: Architect
Related story: SPA-1 (first story of the pure-browser TypeScript SPA refactor)
Contract: [`contracts/spa1-ts-engine.md`](../../contracts/spa1-ts-engine.md)
Supersedes on acceptance: [ADR 005](./005-wasm-runtime-integration.md) (WASM runtime and three-tier fallback). Retires the browser-delivery part of [`contracts/adr-004-wasm-engine.md`](../../contracts/adr-004-wasm-engine.md).

## Context

The browser currently has four copies of the trajectory physics:
- the Rust/WASM engine, behind a worker, then inline, then JS fallback chain (ADR 005)
- `simulateBulletJS()` in `ballistics.js`
- `simulateBulletSW()` in `sw.js`
- the Node runner used by Java `CrossValidationTest`

The project is moving to a pure-browser TypeScript SPA. The WASM path costs:
- a Rust toolchain in CI and Docker
- Maven staging
- a Vite virtual-module plugin
- a worker protocol with roughly 600 lines of dispatch code and tests
- a CSP `'wasm-unsafe-eval'` exception

Meanwhile `simulateBulletJS()` already produces the six point fields and three summary fields the UI uses.

## Options considered

1. **Keep WASM as the only engine and delete the JS copies.** This keeps spin drift and density altitude in local results. The cost is that it keeps the whole Rust/wasm-pack toolchain, the worker protocol, and the CSP exception, and makes the SPA depend on a second language.
2. **Port `simulateBulletJS()` to TypeScript as the only in-page engine and delete the WASM runtime (chosen).** One language, a synchronous API, and no worker. The CSP can be tightened. The cost is losing `spinDriftCm` and `densityAltitudeMeters` from local results until they are ported, and compute moves back onto the main thread.
3. **Status quo.** Rejected: it contradicts the SPA direction and keeps every duplicate.

## Decision

Option 2.

- The engine lives in `app/physics/engine.ts`, with type-only `types.ts`.
- Output stays bit-identical to `simulateBulletJS()` at `a63f361`. A golden fixture locks this in.
- Input validation mirrors the server's `TrajectoryRequest` bounds.

TypeScript toolchain:
- `typescript` runs type-check only (`tsc --noEmit`, `strict`), gated inside `npm test`.
- `@babel/preset-typescript` strips types for Jest.
- Vite compiles `.ts` natively for the build.
- Inside `physics/`, `lib: ["ES2022"]` and `types: []` enforce purity (no DOM, no `console`).

## Consequences

- **Positive:**
  - The browser has one engine, and it's typed.
  - The Rust/wasm-pack steps leave CI, Docker, and Maven.
  - `'wasm-unsafe-eval'` can be removed from the CSP.
  - About 1,000 lines of dispatch code and tests are deleted.
- **Negative:**
  - Local (offline) results lose spin drift and density altitude. Server results don't.
  - The BC solver's 64 sequential simulations now block the main thread (estimated well under 1 s).
  - The worker timeout no longer protects against pathological inputs; engine-side validation replaces it.
- **Follow-ups (open questions in the contract §15):**
  - port spin drift and density altitude
  - re-scope WA-12 and WA-13 for the TS engine
  - remove `sw.js` API interception once the SPA stops calling the server
  - decide whether to keep the Rust crate, given that WA-10 and WA-11 assume a Rust backend
- **Reversibility:** moderate. WASM could be reintroduced behind `simulate()` with the same types, but the build pipeline would have to be rebuilt.
