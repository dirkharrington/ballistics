# ADR 004 — Client-Side WASM Physics Engine

Date: 2026-11-08  
Status: **Accepted**  
Deciders: Architect  
Related stories: WA-1, WA-2, WA-3, WA-4, WA-5  
Contract: [`wasm-engine.md`](./wasm-engine.md), [`wasm-build-pipeline.md`](./wasm-build-pipeline.md)

---

## Context

The ballistics application currently runs all trajectory computations server-side in a Spring Boot Java service. The client-side `simulateBullet()` function in `ballistics.js` mirrors the Java engine in JS and is used by the BC solver, sweep preview, and DOPE card — features that benefit from immediate local computation without a server round-trip.

Sprint 2 (stories WA-1 through WA-5) adds a compiled physics engine that runs entirely in the browser, eliminating network latency for trajectory computations and enabling future offline operation (WA-6). The implementation must:

1. Match the Java engine's numerical output within ε = 0.01 on all rendered fields.
2. Fit within 150 KB gzip to avoid a first-load penalty.
3. Build from a single source of truth (the Rust code) without manual JS maintenance.
4. Integrate into the existing Maven build and CI pipeline.
5. Be achievable by a team with limited Rust experience (~6 weeks estimated).

Four open questions from the BACKLOG were resolved during this sprint's planning:

1. **Rust experience on the team?** — Minor (confirmed: ~6 weeks). Affects estimate, not architecture choice.
2. **Rust coverage tool?** — `cargo-llvm-cov` (decided; 99% gate).
3. **Java engine deprecation plan?** — Deferred to Sprint 3 / WA-10; Java stays authoritative through Sprint 2.
4. **Source of truth for parity testing?** — Java engine output is the source of truth; ε = 0.01 on all rendered fields.

---

## Decision

**Use Rust compiled to WebAssembly via `wasm-pack`.** The compiled module (`ballistics_engine.wasm`) is loaded at runtime by a hand-written ESM loader (`engine/loader.js`) and executes in a Web Worker (`engine.worker.js`).

The `compute_trajectory(params_json, bullet_json)` WASM export takes JSON strings and returns a JSON string, keeping the boundary consistent with the existing JSON-RPC schema and allowing the same test fixtures to be used for both server-side and client-side parity tests.

---

## Alternatives considered

### AssemblyScript

TypeScript-like syntax compiled to WASM. Faster onboarding for JS-fluent teams.

**Rejected.** AssemblyScript has limited standard library support (no `f64::powi`, no easy `serde`-equivalent), which would require manual IEEE-754 rounding to match the Java `r1()` function. Physics table representation would be less idiomatic. The resulting code would diverge more from the Java reference than Rust would, making parity harder to maintain.

### TeaVM (Java → WASM)

Compiles Java bytecode directly to WASM or JS.

**Rejected.** Would allow sharing the exact `BallisticsEngine.java` source, but TeaVM's WASM output is experimental as of 2026, the binary size is significantly larger than a Rust equivalent (3–5× for numeric code), and it ties the WASM output directly to the Java runtime (class loading, exception handling overhead).

### Emscripten (C/C++)

Mature toolchain; large ecosystem of numerical C libraries.

**Rejected.** No existing C implementation exists in this codebase. Writing a new C implementation would take as long as Rust with less memory safety. Emscripten output is typically larger than wasm-pack/wasm-bindgen output for small modules.

### Keep the existing JS mirror (`simulateBullet()`)

No new language or build toolchain.

**Rejected.** The JS implementation already diverges from the Java engine (missing `moaAdjustment`, `mradAdjustment`, `spinDriftCm` on points; slightly different floating-point rounding). A compiled engine closes the parity gap permanently without ongoing manual JS maintenance.

---

## Open questions and resolutions

### Q1: Rust experience on the team?

**Resolution:** Minor (~6 weeks). The estimate accounts for the learning curve. The physics algorithm itself is a straightforward port of an already-working Java implementation; it does not require advanced Rust features (no lifetimes beyond the WASM boundary, no async). The Rust code is confined to `engine/` and does not affect any other part of the codebase.

### Q2: Coverage tool for Rust?

**Resolution:** `cargo-llvm-cov`, gating at **99%** (not 100%).

Rationale: `cargo-llvm-cov` is the de facto standard for Rust coverage and integrates cleanly with `cargo test`. The 99% threshold (not 100%) accounts for:
- `unreachable!()` macro arms in exhaustive `match` statements that cannot be exercised by host-target tests.
- `#[cfg(target_arch = "wasm32")]` branches that only execute inside a browser and cannot be covered by `cargo test` on the host target.

A 100% gate would require `wasm-bindgen-test` running in a headless browser on every CI run, which adds significant build time and flakiness. 99% provides strong coverage assurance without that overhead.

### Q3: Java engine deprecation plan?

**Resolution:** **Deferred to Sprint 3 / WA-10.** The Java engine (`BallisticsEngine.java`) remains unchanged through Sprint 2. It is the production computation path for all server-side API calls. The WASM engine is **additive** — it replaces the client-side `simulateBullet()` JS function only.

Sprint 2 does not change the JSON-RPC API surface. All six methods (`bullets.list`, `trajectory.compute`, `trajectory.compare`, `trajectory.computeCustom`, `trajectory.batch`, `cache.stats`) continue to work unchanged. The Java engine remains the source of truth for parity testing.

The question of whether to run a Rust binary on the server (WA-11, `axum`/`actix`) or publish `ballistics-engine` as a shared library (WA-10) is out of scope for Sprint 2.

### Q4: Source of truth for parity testing (ε decision)?

**Resolution:** **Java engine output is the source of truth; ε = 0.01 on all rendered fields.**

Rationale for ε = 0.01:
- Both engines round all `TrajectoryPoint` fields to one decimal place (Java's `r1()` = `Math.round(v * 10.0) / 10.0`; Rust must apply equivalent rounding).
- After rounding, the maximum representable difference between two values that round to the same decimal place is 0.05. Setting ε = 0.01 is tighter than the rounding granularity, which means any failure at ε = 0.01 represents a genuine physics divergence rather than a rounding artefact.
- Tolerances tighter than 0.01 (e.g. 0.001) would be meaningless because the rounded outputs are already quantised at 0.1.
- The single tolerance across all fields avoids field-specific special cases that could mask genuine errors.

Golden fixtures are generated by the Java engine and committed to `engine/tests/fixtures/`. They are the reference values for all parity tests.

---

## Architecture: Java-authoritative, WASM-mirror split

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                         │
│                                                                 │
│  Main thread                                                    │
│  ┌────────────────┐   postMessage     ┌─────────────────────┐  │
│  │  ballistics.js ├──────────────────►│  engine.worker.js   │  │
│  │  (UI / charts) │◄──────────────────┤  computeTrajectory()│  │
│  └────────────────┘   result / error  └──────────┬──────────┘  │
│                                                   │ JS call     │
│                                       ┌───────────▼──────────┐ │
│                                       │   engine/loader.js   │ │
│                                       │   (initEngine once)  │ │
│                                       └───────────┬──────────┘ │
│                                                   │ WASM call  │
│                                       ┌───────────▼──────────┐ │
│                                       │  ballistics_engine   │ │
│                                       │  .wasm (Rust/RK4)    │ │
│                                       └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Server                                                          │
│                                                                 │
│  POST /api/rpc                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  BallisticsEngine.java  (authoritative; unchanged)     │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Key invariants of this split:**

1. **The Java engine is authoritative.** Server responses come from `BallisticsEngine.java`. The Rust WASM engine must match its output within ε = 0.01. If they diverge, the Rust engine is wrong.

2. **WASM is additive.** No Java code changes in Sprint 2. The `be-jsonrpc-contract.md` schema is unchanged. Existing API consumers are unaffected.

3. **The JS `simulateBulletJS()` is a fallback, not a primary path.** After WA-4, the production code path is `simulateBullet()` → WASM loader → Rust engine. The JS implementation (`simulateBulletJS()`) is retained as a named fallback for environments where WASM is unavailable. It is not the parity reference.

4. **JSON at the boundary.** The WASM function takes and returns JSON strings. This matches the existing server schema, allows the same Jest test fixtures to cover both server responses and WASM output, and avoids the complexity of shared-memory buffer protocols.

5. **Worker isolation.** WASM computation runs in a Web Worker so that RK4 integration (which loops for milliseconds) does not block the main thread's rendering. The Worker is the caller of the loader; the loader is not imported by the main thread directly.

---

## Consequences

**Positive:**
- Trajectory computation in the browser becomes instant and network-independent.
- Physics bug fixes apply to both server and client once the Rust port is validated.
- Parity test corpus (golden JSON fixtures) doubles as integration test coverage for the Java engine.
- Binary size (< 150 KB gzip) is acceptable for a first-load asset.
- Worker isolation prevents RK4 loops from janking the UI.

**Negative / risks:**
- Adds Rust to the build toolchain; every developer must install `rustup` and `wasm-pack`.
- `java-build` CI job now has a `needs` dependency on `rust-build`, serialising part of the pipeline.
- Rust parity must be maintained manually when the Java engine physics change. This is mitigated by the golden fixture workflow: regenerate fixtures when Java changes, re-run parity tests.
- `cargo-llvm-cov` and `wasm-pack` add ~2 minutes to CI.

---

## References

- `contracts/wasm-engine.md` — full interface contract (WASM exports, loader API, worker protocol, parity table, CI job spec)
- `contracts/wasm-build-pipeline.md` — Maven exec-plugin config, directory layout, cache keys
- `contracts/be-jsonrpc-contract.md` — existing server schema (`TrajectoryParams`, `Bullet`, `TrajectoryPoint`)
- `contracts/spin-drift.md` — `spinDriftCm` field specification (must be ported to Rust)
- `contracts/ci-pipeline.md` — existing CI job definitions; `rust-build` is additive
