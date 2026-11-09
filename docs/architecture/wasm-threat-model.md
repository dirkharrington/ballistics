# WASM Threat Model — Ballistics Engine

Date: 2026-11-09  
ADR: [`contracts/adr-004-wasm-engine.md`](../../contracts/adr-004-wasm-engine.md)  
Contract: [`contracts/wasm-engine.md`](../../contracts/wasm-engine.md)  
Status: **Active**

This document records the security threat model for the WASM physics engine introduced in Sprint 2 (stories WA-1 through WA-5). It covers the build supply chain, runtime CSP posture, the WASM/JS boundary design, and the future worker isolation story.

---

## 1. Supply chain

### Threat surface

The WASM binary shipped to browsers is the product of a compiler chain: Rust source → `cargo` toolchain → `wasm-pack` → `wasm-bindgen` → `.wasm`. Any compromise in this chain produces a tampered binary that executes in the user's browser.

### Mitigations in place

| Control | Status | Notes |
|---|---|---|
| **`Cargo.lock` committed** | Done | `engine/Cargo.lock` is committed and checked in. Dependency resolution is deterministic; `cargo update` is a deliberate, reviewable action. |
| **GitHub Actions SHA pinning** | Done (PR #58) | Every `uses:` step in `.github/workflows/ci.yml` is pinned to a full commit SHA (e.g. `actions/checkout@<sha>`), not a mutable tag such as `@v4`. A compromised tag cannot swap the action under a pinned SHA. |
| **Artifact handoff within the same run** | Done | The WASM binary is produced by the `rust-build` job, uploaded via `actions/upload-artifact`, and downloaded by `java-build` within the **same workflow run** (same `run_id`). GitHub does not expose upload-artifact storage to fork PRs on the `pull_request` event; there is no fork-poisoning path for artifacts uploaded and consumed in the same run. |
| **`wasm-pack` installed at build time** | Partial | `wasm-pack` is fetched from `rustwasm.github.io` via the official installer script. The installer itself is not SHA-pinned. A future hardening step is to cache a pinned version via `cargo install wasm-pack --locked` with a Cargo-verified source, or to pin the installer URL to a tagged release. |
| **No third-party Cargo plugins in the hot path** | Done | Only `wasm-bindgen`, `serde`, and `serde_json` are production dependencies. `cargo-llvm-cov` and `wasm-bindgen-test` are dev/CI-only. |

### Residual risk

The `wasm-pack` installer URL is not SHA-pinned. If the `rustwasm.github.io` CDN or GitHub Pages were compromised at build time, an attacker could substitute a malicious `wasm-pack` binary that produces a backdoored `.wasm`. This is a low-probability, high-impact risk. It should be addressed in a follow-up by moving to a pinned `cargo install wasm-pack --locked` step.

---

## 2. Content Security Policy (CSP)

### Context

Executing a WASM module requires the browser to compile a binary blob into a function at runtime. This is JIT-compilation of externally fetched bytes and is restricted by CSP.

### Named invariant: `wasm-unsafe-eval` must be used; `unsafe-eval` must not

**CSP directive added in PR #59:**
```
Content-Security-Policy: ... script-src 'self' 'wasm-unsafe-eval'; ...
```

`'wasm-unsafe-eval'` grants the **minimum necessary permission**: it allows `WebAssembly.compile()` and `WebAssembly.instantiate()` on bytes fetched from allowed sources, but it does **not** allow `eval()`, `new Function()`, or `setTimeout(string)` on JavaScript strings.

`'unsafe-eval'` is a superset of `'wasm-unsafe-eval'` that also permits arbitrary JS string evaluation. Using `'unsafe-eval'` to satisfy WASM instantiation would materially weaken the XSS posture of the entire application.

> **Invariant (named):** Any future CSP change that removes `'wasm-unsafe-eval'` or replaces it with `'unsafe-eval'` **must be reviewed against this document** before merge. The devsecops gate treats replacing `'wasm-unsafe-eval'` with `'unsafe-eval'` as a BLOCK finding.

### Fetch source constraint

The `.wasm` binary is served from `'self'` (the same origin) via the Spring Boot static resources path (`src/main/resources/static/wasm/`). No cross-origin WASM fetch is required. The existing `script-src 'self'` already covers the fetch; `'wasm-unsafe-eval'` covers only the compilation step.

---

## 3. WASM boundary

### JSON-at-the-boundary design (ADR-004 §Architecture, invariant 4)

The WASM export signature is:

```rust
pub fn compute_trajectory(params_json: &str, bullet_json: &str) -> String
```

Both inputs are JSON strings; the return value is a JSON string. No shared-memory buffers, no raw pointer passing. This design was chosen in ADR-004 for three reasons:

1. **Schema consistency.** The same `TrajectoryParams` and `Bullet` JSON schemas are used by the Java JSON-RPC API, the WASM boundary, and the Jest test fixtures. No translation layer.
2. **Isolation.** The JS caller serialises its objects to strings before the WASM call. There is no aliasing between JS heap objects and Rust memory.
3. **Auditability.** The boundary is visible in network/memory inspection tools as plain JSON, not opaque binary blobs.

### Input validation (PR #59)

`TrajectoryParams::validate()` and `Bullet::validate()` in `engine/src/types.rs` are called at the start of `compute_trajectory()` before any physics code runs. All field ranges in `contracts/wasm-engine.md` §3.1 and §3.2 are checked. On any validation failure, the function returns a JSON error envelope:

```json
{ "error": "<message>" }
```

No panic, no undefined behaviour, no partial computation. The JS loader (`engine/loader.js`) checks for the `error` key and throws a `BallisticsEngineError`.

> **Note (divergence):** As of PR #59, `validate()` enforces only the lower bounds for `windSpeedKph` (≥0) and `altitudeMeters` (≥0). The contract upper bounds (≤200 kph, ≤10000 m) are not yet enforced at the Rust level. See `contracts/wasm-engine.md` §3.1 divergence note. This is tracked for a future fix to `validate()`.

### Error envelope using `serde_json`

The `serde_json` crate serialises all outputs. Rust panics inside WASM become `unreachable` traps that propagate to the JS caller as a thrown `RuntimeError` from the WebAssembly runtime (not silently dropped). The `'abort'` panic profile (`panic = "abort"` in `Cargo.toml`) ensures that panics terminate execution immediately without stack unwinding, preventing partial state from leaking across the boundary.

---

## 4. Worker isolation (WA-5 — future)

### Design intent

WASM computation (the RK4 integrator loop) will run inside a `Web Worker` (`engine.worker.js`) to prevent millisecond-long trajectory integrations from blocking the main thread's rendering. The contract for the worker message protocol is defined in `contracts/wasm-engine.md` §5.

### Cross-origin isolation posture (TBD — WA-5)

`SharedArrayBuffer` and `performance.measureUserAgentSpecificMemory()` require the `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers (the COOP/COEP pair). The current deployment does not set these headers.

The WA-5 Web Worker design does **not** use `SharedArrayBuffer`; it uses `postMessage` for all data transfer. COOP/COEP are therefore not required for WA-5.

> **Decision deferred:** If a future story (e.g. WA-6 — offline mode, or WA-11 — server-side Rust) requires `SharedArrayBuffer` or high-resolution timers, the COOP/COEP posture and its impact on third-party iframes and popups must be assessed at that time. This is not a WA-5 concern.

### Worker termination

The main thread sends a graceful `{ "type": "terminate" }` message on page `beforeunload`; the worker calls `self.close()`. Production code must not call `worker.terminate()` (which would abandon in-flight work without a response). This is enforced as an acceptance checklist item in `contracts/wasm-engine.md` §9 (WA-5).
