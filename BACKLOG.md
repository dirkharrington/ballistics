# Backlog

_Baseline: 2026-11-03 · Spring Boot 4.1.1 / Java 21 · 100% coverage_  
_Last updated: 2026-11-04_

---

## Completed — Sprint 1

| Story | Description | PR |
|---|---|---|
| MH-1 | MOA/MRAD Adjustment Chart | #34 |
| MH-2 | Catalog Expansion (37 rounds) | #33 |
| MH-3 | Come-Ups / DOPE Card | #34 |
| MH-4 | Sensitivity Analysis — Condition Sweep | #34 |
| SH-1 | Spin Drift (Gyroscopic) | #33 (BE) · #34 (FE) |
| SH-2 | BC Back-Calculator | #34 |
| SH-3 | Density Altitude Output | #33 (BE) · #34 (FE) |

---

## P3 — Cleanup & Security · Size 1 each

### MH-5 · Rotate NVD API Key · DevSecOps

The `NVD_API_KEY` GitHub Actions secret is expired. The OWASP Dependency-Check
job runs but exits 0 with no report (`failOnError=false` masks the failure).
Trivy is the compensating control in the interim.

**Steps:** Rotate key at nvd.nist.gov/developers/request-an-api-key, update
`secrets.NVD_API_KEY` in repo Settings → Secrets, then flip `failOnError=false`
→ `true` so future expiry fails loudly.

**Value:** Restores full dependency-CVE coverage. OWASP catches Java library
CVEs that Trivy (filesystem scan) can miss.

---

### SH-4 · JSON-RPC Error Data Sanitisation · BE

`JsonRpcController:238` returns `e.getMessage()` from a `JacksonException` in
the `-32602` error `data` field. This leaks internal class names and schema
details to callers.

Replace with a fixed string `"Deserialization error"` and add a test asserting
the data field never contains a class name.

Source: PR #29 NOTE 1

---

### SH-5 · Align Contract §6.4 — 413 Response Format · BE

When a request body exceeds the size limit, `RequestBodySizeLimitFilter` returns
RFC 9457 `ProblemDetail`. Contract §6.4 specifies a JSON-RPC `-32003` error
envelope instead.

Either update the filter to return a JSON-RPC envelope, or update §6.4 to
document the ProblemDetail behaviour as intentional.

Source: PR #29 NOTE 2

---

### SH-6 · Add DEBUG Logging for JSON-RPC Method Names · BE

Contract §9.3 states method names are logged at DEBUG on each invocation.
No such logging exists in `JsonRpcController`. Either add
`log.debug("rpc method={}", method)` before dispatch, or remove the §9.3 claim.

Source: PR #29 NOTE 3

---

### SH-7 · Boundary Tests for `twistRateInchesPerTurn` Validation · BE

`BallisticsControllerTest` is missing explicit boundary tests for the
`twistRateInchesPerTurn` field:

- `0` → expect 400
- `101` → expect 400
- `100` → expect 200 (upper boundary passes)

JaCoCo at 100% doesn't catch missing validation-annotation coverage since
validation is framework-side.

Source: Sprint 1 devsecops review

---

### SH-8 · Document `sg` Clamping in `contracts/spin-drift.md` · Docs

`BallisticsEngine.convertInputs` clamps `dIn`, `massGr`, and `twist` via
`Math.max`/`Math.min` as a CodeQL taint-analysis guard. This is not documented
in `contracts/spin-drift.md`. Add a note explaining the clamping bounds and
the reason (CodeQL §CWE-190 guard, not a physics constraint).

Source: Sprint 1 devsecops review

---

### SH-9 · Spin Drift Value in Crosshair Readout · FE

The wind drift chart shows `spinDriftCm` as a dashed overlay (satisfies the
contract), but hovering the crosshair does not show a numeric value in the
floating readout table.

Add a `spinDriftCm` row to `updateReadout()` in `ballistics.js`, conditioned on
`p.spinDriftCm > 0` so it only appears when spin drift data is present.

Source: Sprint 1 devsecops review

---

## WASM — Sprint 1 · Must Have (~6 weeks)

> **ADRs:** Rust + wasm-pack (not Emscripten/TeaVM/AssemblyScript). JSON at the
> WASM boundary (consistent with REST schema, same test fixtures). Java backend
> unchanged through Sprint 2 — WASM is additive, replacing the in-browser JS
> mirror only.

### WA-1 · Engine Scaffold & Toolchain · BE (Rust) · CI/CD · Size S

Set up a Cargo workspace at `engine/` in the repo root. Add wasm-pack config and
a Maven `exec-maven-plugin` step to run `wasm-pack build` during `mvn package`.
CI: install Rust toolchain (rustup) + wasm-pack in the GitHub Actions workflow.
Output: `engine/pkg/` → copied to `src/main/resources/static/wasm/`. Deliverable:
stub `hello_wasm()` proving the pipeline works end-to-end. No physics yet.

**Acceptance:** `mvn package` succeeds; WASM binary appears in
`src/main/resources/static/wasm/` in the built JAR.

---

### WA-2 · Core Trajectory Engine in Rust · Rust · Size L

Port the RK4 integrator and G1/G7 drag tables from `BallisticsEngine.java` to
Rust. Same atmosphere model (ISA + altitude + temperature), Pejsa crosswind,
shooting-angle correction, and spin-drift computation when
`twistRateInchesPerTurn` is provided. Expose
`compute_trajectory(params_json: &str, bullet_json: &str) -> String` as a WASM
export.

**Parity test:** For each of the 10 original catalog rounds, every trajectory
point field must match the Java engine within ε = 0.01. Binary target: < 150 KB
gzip.

---

### WA-3 · JS/TS Bindings & Loader · FE · Build · Size S

Write `engine/loader.js` (ESM) that async-initialises the WASM module once and
exposes a typed `computeTrajectory(request, bullet)` function. Generate
TypeScript types via wasm-bindgen. Fallback: if `WebAssembly` is not defined,
throw a named error that the caller routes to the JS fallback.

**Acceptance:** Loader initialises once; subsequent calls are synchronous;
TypeScript types generated.

---

### WA-4 · Replace `simulateBullet()` with WASM · FE · Size M

In `ballistics.js`, replace calls to `simulateBullet()` with the WASM loader.
Rename the existing JS implementation to `simulateBulletJS()` for use as
fallback. DOPE card, BC solver, and sweep preview all benefit automatically.
Jest tests mock the WASM loader and cover both WASM-success and fallback paths.
100% coverage maintained.

---

### WA-5 · Web Worker Offload · FE · Size S

Move WASM computation to a dedicated Web Worker (`engine.worker.js`). Main
thread communicates via postMessage. Add a "Computing…" overlay for in-flight
requests. Worker terminates cleanly on page unload. Jest: mock Worker with a
synchronous stand-in. 100% coverage maintained.

---

## WASM — Sprint 2 · Should Have (~3 weeks)

### WA-6 · Offline Mode (Service Worker) · FE · PWA · Size M

Register a Service Worker that caches: the WASM binary, the bullets catalog
(`/api/bullets`), and all static assets. When offline, intercept API calls and
serve cached catalog; use the WASM engine for computation; return a synthetic
JSON-RPC response. Add an "Offline" indicator when `navigator.onLine === false`.
Version cache by WASM binary hash to bust on engine upgrades.

---

### WA-7 · Client-Side Batch Sweep · FE · Size S

Rewrite MH-4 sweep mode to run all 5 condition variants in the WASM worker
instead of calling `POST /api/trajectories/batch`. Instant results, no network,
no rate-limit friction. Keep the API path as a fallback when WASM is unavailable.
No UI changes.

---

### WA-8 · Physics Parity Audit + ADR · Test/Audit · Size S

Systematic comparison of Java engine vs Rust/WASM engine across the full catalog
at multiple ranges and conditions. Document any intentional differences. Write
`contracts/engine-parity.md` declaring which engine is authoritative for which
computation.

---

## WASM — Sprint 3+ · Could Have (Roadmap)

| ID | Story | Value | Size |
|---|---|---|---|
| WA-9 | SIMD acceleration — `#[target_feature(enable = "simd128")]` opt-in; scalar fallback | 2–4× faster on Chrome/Firefox. Most impactful on ELR trajectories (3000+ m). | M |
| WA-10 | Shared engine crate — `ballistics-engine` on crates.io, C FFI bindings via cbindgen | Enables future Rust backend and mobile SDKs (iOS/Android). | M |
| WA-11 | Rust backend — replace Spring Boot with Axum/Actix; native binary; <5 ms cold start | Highest infrastructure impact. Requires WA-10. | XL |
| WA-12 | Custom drag function — user-provided BC curve (CSV of Mach → CD) | For bullets outside G1/G7 (Berger Hybrid, Hornady ELD-X at transonic). | L |
| WA-13 | Coriolis effect — latitude + azimuth inputs; deflection alongside spin drift | Most-cited physics omission after spin drift. ~1+ MOA at 2000 m. | M |

**WASM build pipeline:**
```
1. rustup target add wasm32-unknown-unknown        # CI setup (cached)
2. cargo install wasm-pack                          # CI setup (cached)
3. wasm-pack build engine/ --target web --release  # → engine/pkg/
4. cp -r engine/pkg/ src/main/resources/static/wasm/  # Maven exec-plugin
5. ./mvnw verify                                   # Java + Jest (unchanged)
6. cargo test --manifest-path engine/Cargo.toml   # Rust unit tests (new gate)
```

**Open questions before WA-1:**
1. Rust expertise on the team? (unfamiliar: ~6 wks; experienced: ~4 wks)
2. `cargo-llvm-cov` for Rust coverage gate alongside JaCoCo and Jest
3. Java engine deprecation plan — decide before Sprint 3 (WA-10)
4. Source of truth for server responses — agree on ε before WA-8

---

## Open Items (pre-existing, not sprint work)

| Severity | Item | Source |
|---|---|---|
| HIGH | NVD API key expired — see MH-5 above | PR #28 NOTE 1 |
