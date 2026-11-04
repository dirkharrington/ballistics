# WASM Backlog

_Created: 2026-11-04 · Stack: Spring Boot 4.1.1 / Java 21 + Rust/wasm-pack_

---

## Why WASM

| Driver | Detail |
|---|---|
| Client-side performance | JS `simulateBullet()` runs every DOPE card, BC solver, and sweep. WASM is 1.5–3× faster for tight numeric loops at 2000-step trajectories. |
| Offline mode | WASM + Service Worker = full trajectory computation with no network. Critical for field use at ranges without connectivity. |
| Single engine codebase | A Rust crate compiles to both WASM (browser) and native FFI. Eliminates Java ↔ JS drift between `BallisticsEngine` and `simulateBullet()`. |
| No rate-limit friction | Sweep mode currently hits the BATCH tier (10 req/min). Moving to in-browser WASM removes the ceiling entirely. |
| Non-blocking UI | WASM in a Web Worker frees the main thread during 5× sweep computations. |

---

## Architecture Decisions

**ADR-WASM-01 — Language: Rust + wasm-pack**  
Decision: Rust compiled to WASM via wasm-pack and wasm-bindgen, with JSON-serialized input/output at the JS boundary.  
Rejected: C/Emscripten (larger binaries, worse DX), TeaVM/j2wasm (large runtime, unproven perf), AssemblyScript (no path to native backend library).

**ADR-WASM-02 — Engine boundary: JSON at WASM interface**  
Decision: Pass request + bullet as JSON strings; return trajectory points as JSON (serde_json inside Rust). Keeps the interface consistent with the REST schema.

**ADR-WASM-03 — Java backend: keep as-is for Sprints 1–2**  
WASM is additive — it replaces the in-browser JS mirror only. Spring Boot backend unchanged. Sprint 3+ revisits a Rust backend.

---

## Sprint 1 — Initial WASM (Must Have, ~6 weeks)

### WA-1 · Engine Scaffold & Toolchain · Size S

Set up a Cargo workspace at `engine/` in the repo root. Add wasm-pack config and a Maven `exec-maven-plugin` step to run `wasm-pack build` during `mvn package`. CI: install Rust toolchain (rustup) + wasm-pack in the GitHub Actions workflow. Output: `engine/pkg/` → copied to `src/main/resources/static/wasm/`. Deliverable: stub `hello_wasm()` proving the pipeline works end-to-end.

**Layers:** BE (Rust), CI/CD  
**Acceptance:** `mvn package` succeeds; WASM binary appears in `src/main/resources/static/wasm/` in the built JAR.

---

### WA-2 · Core Trajectory Engine in Rust · Size L

Port the RK4 integrator and G1/G7 drag tables from `BallisticsEngine.java` to Rust. Implement the same atmosphere model (ISA + altitude + temperature correction), Pejsa constant-crosswind approximation, and shooting-angle correction. Include spin-drift computation when `twistRateInchesPerTurn` is provided. Expose `compute_trajectory(params_json: &str, bullet_json: &str) -> String` as a WASM export.

**Parity test:** For each of the 10 original catalog rounds, every trajectory point field must match the Java engine output within ε = 0.01 (drop cm, velocity, energy, time-of-flight).

**Layers:** Rust  
**Acceptance:** Parity tests pass for all catalog rounds; cargo test passes; binary < 150 KB gzip.

---

### WA-3 · JS/TS Bindings & Loader · Size S

Write `engine/loader.js` (ESM) that async-initialises the WASM module once and exposes a typed `computeTrajectory(request, bullet)` function. Generate TypeScript types via wasm-bindgen. Fallback: if `WebAssembly` is not defined, throw a named error that the caller routes to the JS fallback.

**Layers:** FE, Build  
**Acceptance:** Loader initialises once; subsequent calls are synchronous; TypeScript types generated.

---

### WA-4 · Replace `simulateBullet()` with WASM · Size M

In `ballistics.js`, replace calls to `simulateBullet()` with the WASM loader. Keep the existing JS implementation as `simulateBulletJS()` for fallback. DOPE card, BC solver, and sweep preview all benefit automatically. Jest tests mock the WASM loader and cover both WASM-success and fallback paths. 100% coverage maintained.

**Layers:** FE  
**Acceptance:** All existing Jest tests pass; WASM and fallback paths covered; no regression in DOPE card / BC solver / sweep.

---

### WA-5 · Web Worker Offload · Size S

Move WASM computation to a dedicated Web Worker (`engine.worker.js`). Main thread communicates via postMessage. Add "Computing…" overlay for in-flight requests. Jest: mock Worker with a synchronous stand-in. 100% coverage maintained.

**Layers:** FE  
**Acceptance:** Sweep of 5 conditions does not block the main thread; Worker terminates cleanly on page unload.

---

## Sprint 2 — Enhancement (Should Have, ~3 weeks)

### WA-6 · Offline Mode (Service Worker) · Size M

Register a Service Worker that caches: the WASM binary, the bullets catalog (`/api/bullets`), and all static assets. When offline, intercept API calls and serve cached catalog; use the WASM engine for trajectory computation; return a synthetic JSON-RPC response. Add an "Offline" indicator when `navigator.onLine === false`. Version cache by WASM binary hash to bust on engine upgrades.

**Layers:** FE, PWA  
**Acceptance:** App loads and computes trajectories with no network; "Offline" indicator appears; cache busts on new WASM binary.

---

### WA-7 · Client-Side Batch Sweep · Size S

Rewrite MH-4 sweep mode to run all 5 condition variants in the WASM worker instead of calling `POST /api/trajectories/batch`. Instant results, no network, no rate-limit. Keep the API path as a fallback when WASM is unavailable. No UI changes.

**Layers:** FE  
**Acceptance:** Sweep completes without a network request when WASM is loaded; API fallback still works.

---

### WA-8 · Physics Parity Audit + ADR · Size S

Systematic comparison of Java engine vs Rust/WASM engine across the full catalog at multiple ranges and conditions. Document any intentional differences. Write `contracts/engine-parity.md` declaring which engine is authoritative for which computation. Surface any bugs found in either implementation.

**Layers:** Test/Audit  
**Acceptance:** `contracts/engine-parity.md` committed; all intentional differences documented; no undocumented disagreements > ε.

---

## Sprint 3+ — Advanced Roadmap (Could Have)

| ID | Story | Value | Size |
|---|---|---|---|
| WA-9 | SIMD acceleration — `#[target_feature(enable = "simd128")]` opt-in; feature-detect at load time | 2–4× faster on Chrome/Firefox. Most impactful on ELR trajectories (3000+ m). | M |
| WA-10 | Shared engine crate — `ballistics-engine` on crates.io, C FFI bindings via cbindgen | Enables future Rust backend and mobile SDKs (iOS/Android). | M |
| WA-11 | Rust backend (replace Spring Boot) — Axum/Actix HTTP layer, native binary, <5 ms cold start | Highest infrastructure impact; requires WA-10 first. | XL |
| WA-12 | Custom drag function — user-provided BC curve (CSV of Mach → CD) | Required for bullets that don't fit G1/G7 (Berger Hybrid, Hornady ELD-X at transonic). | L |
| WA-13 | Coriolis effect — latitude + azimuth inputs; deflection alongside spin drift | Most-cited physics omission after spin drift. Significant at ELR ranges (1+ MOA at 2000 m). | M |

---

## Build Pipeline

```
1. rustup target add wasm32-unknown-unknown        # CI setup (cached)
2. cargo install wasm-pack                          # CI setup (cached)
3. wasm-pack build engine/ --target web --release  # → engine/pkg/
4. cp -r engine/pkg/ src/main/resources/static/wasm/  # Maven exec-plugin
5. ./mvnw verify                                   # Java + Jest (unchanged)
6. cargo test --manifest-path engine/Cargo.toml   # Rust unit tests
```

WASM binary size target: < 150 KB gzip.  
Rust coverage target: 100% for all public WASM exports; 90%+ for physics core.

---

## Open Questions

1. **Rust expertise?** Team Rust experience level affects Sprint 1 estimate (unfamiliar: ~6 wks; experienced: ~4 wks).
2. **WASM binary in the JAR?** < 200 KB is fine in `src/main/resources/static/`. If binary exceeds 1 MB, consider a CDN.
3. **Rust coverage tooling?** Add `cargo-llvm-cov` to CI for coverage enforcement.
4. **Java engine deprecation plan?** Decide before Sprint 3 whether `BallisticsEngine.java` is deprecated once WA-10 ships.
5. **Source of truth for server responses?** API consumers always get Java results until a Rust backend lands. WA-8 defines acceptable ε between engines.
