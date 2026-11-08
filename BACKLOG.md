# Sprint Backlog

_Baseline: 2026-11-03 · Spring Boot 4.1.1 / Java 21 · 354 tests · 100% coverage_

---

## P1 — Must Have

~~### MH-1 · MOA / MRAD Adjustment Chart · FE · Size S~~ ✅ Done — PR #34

Add a 5th Chart.js panel to the Trajectory Charts tab showing scope elevation
adjustment (MOA primary axis, MRAD secondary) vs. range. Zero crossing,
supersonic limit, and max-ordinate annotations mirror the existing panels;
crosshair syncs with all existing charts.

`moaAdjustment` and `mradAdjustment` are already present on every `TrajectoryPoint`
— this is a pure frontend change with no backend or contract work.

**Value:** Scope click data vs. range is the primary daily-use output for
competitive shooters. The data is computed on every request; only the
visualization is missing.

---

~~### MH-2 · Catalog Expansion — 50+ Rounds · BE · Size M~~ ✅ Done — PR #32

~~### MH-3 · Come-Ups / DOPE Card · FE · Size M~~ ✅ Done — PR #34

Add a "DOPE Card" panel to the Tools tab. The user enters 4–8 target distances;
the tool generates a come-ups table (distance → MOA up → MRAD up → windage at
10 km/h) for each selected round. One-click copy as plain text; distances encoded
in the URL state for sharing.

No new backend endpoint required — all data is present in the computed trajectory
points.

**Value:** A come-ups table is the standard deliverable a shooter takes to the
range. Completes the "compute → verify → shoot" workflow that defines the tool's
core use case.

---

~~### MH-4 · Sensitivity Analysis — Condition Sweep · FE · Size S~~ ✅ Done — PR #34

Add a "Sweep" mode to the sidebar. The user locks one bullet and sweeps a single
parameter (wind speed, altitude, or temperature) across 3–5 values. The tool
calls `POST /api/trajectories/batch` with the generated requests and renders a
family of curves on the drop or drift chart, one curve per condition value.

The batch endpoint already supports this; the UI surface is entirely absent.

**Value:** Primary research workflow for engineers and ammunition developers.
Turns the backend's parallel execution capability into a visible user feature.

---

## P2 — Should Have

~~### SH-1 · Spin Drift (Gyroscopic) · BE + FE · Size M~~ ✅ Done — PR #32 (BE), PR #34 (FE)

~~### SH-2 · BC Back-Calculator · FE · Size S~~ ✅ Done — PR #34

Add a "Solve BC" card to the Tools tab. Inputs: bullet weight (g), muzzle
velocity (m/s), measured drop (cm), measured range (m), same environmental
parameters as the main form. Solver iterates the client-side physics (bisection
on BC) to find the G1 effective BC that reproduces the observed drop within 0.5
cm. Outputs the solved BC and implied G7 BC (÷ 0.505).

Pure client-side calculation using the existing ballistics engine already imported
into `ballistics.js`. No backend work required.

**Value:** Handloaders routinely measure actual drop and back-calculate effective
BC to compare against published values. Common load-development task.

---

~~### SH-3 · Density Altitude Output · BE + FE · Size S~~ ✅ Done — PR #32 (BE), PR #34 (FE)

## P3 — Cleanup / Security

~~### CI-1 · Skip full CI on markdown-only PRs · DevSecOps · Size 1~~ ✅ Done — PR #40

The `pull_request` trigger in `.github/workflows/ci.yml` has no path filters.
Every PR that touches only `.md` files (backlog updates, contract docs, ADRs)
runs the full Maven build + JaCoCo + Jest + Trivy + OWASP stack — roughly 5–8
minutes of CI for a documentation change.

Add `paths-ignore` filters to both the `push` and `pull_request` triggers so
that commits where every changed file matches `**/*.md` skip the workflow
entirely. The push trigger on `main` should also exclude `*.md`-only merges.

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ['**/*.md']
  pull_request:
    paths-ignore: ['**/*.md']
```

**Acceptance:** A PR that changes only `BACKLOG.md` shows a green "skipped" CI
status rather than a full run. A PR that changes any `.java` or `.js` file still
triggers the full suite.

**Note:** Any PR that touches both code and `.md` files still runs CI — the
filter only fires when every changed path is ignored.

Source: recurring cost of backlog/contract doc PRs triggering full builds

---

### ⚠️ MH-5 · Rotate NVD API Key · DevSecOps · Size 1 — CI change ready, awaiting key rotation

The `NVD_API_KEY` GitHub Actions secret is expired. The OWASP Dependency-Check
job has `-DfailOnError=true` already set in `ci.yml`; the remaining step is
to rotate the key at nvd.nist.gov/developers/request-an-api-key and update
`secrets.NVD_API_KEY` in repo Settings → Secrets.

**Value:** Restores full dependency-CVE coverage. OWASP catches Java library
CVEs that Trivy (filesystem scan) can miss.

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
