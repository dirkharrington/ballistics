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

~~### CI-2 · Path-Filtered CI Jobs · DevSecOps · Size S~~ ✅ Done — PR #45

Each PR should only run the checks relevant to its changed files. Right now every PR triggers the full stack — Rust build, Maven + JaCoCo, and Jest — even when only one layer changed.

**Desired behaviour per PR:**

| Changed paths | Jobs that must run |
|---|---|
| `engine/**` (Rust/WASM) | `rust-build` only |
| `src/main/**/*.java`, `pom.xml`, `src/test/**/*.java` | `java-build` only |
| `src/main/resources/static/**`, `src/test/js/**`, `package.json`, `babel.config.json`, `vite.config.js` | `frontend-build` only |
| Any mix of the above | each affected job |
| Anything else (contracts, docs, CI config itself) | required checks run but skip expensive steps |

**Implementation approach:** Add a `changes` job that runs first using `dorny/paths-filter` (or equivalent) to detect which layers changed, then gate each downstream job on the corresponding output with `if: needs.changes.outputs.<layer> == 'true'`. The `rust-build` → `java-build` dependency from WA-1 (§8) is preserved when both run; when only `java-build` runs, it must not require the WASM artifact (use `-Dskip.wasm.pack=true` and skip the artifact download step when `rust-build` did not run).

**Acceptance:**
- A PR touching only `engine/` triggers `rust-build` and skips `java-build` and `frontend-build`.
- A PR touching only `src/main/resources/static/` triggers `frontend-build` and skips the others.
- A PR touching only `.java` files triggers `java-build` (with `-Dskip.wasm.pack=true`) and skips the others.
- A PR touching files from multiple layers triggers each affected job.
- A PR touching `ci.yml` or `contracts/` triggers all jobs (safe default).
- No existing check is silently dropped — all gates still run on a full-stack change.

**Note:** CI-1 (markdown-only skip) is a prerequisite and already merged.

---

### ⚠️ MH-5 · Rotate NVD API Key · DevSecOps · Size 1 — CI change ready, awaiting key rotation

The `NVD_API_KEY` GitHub Actions secret is expired. The OWASP Dependency-Check
job has `-DfailOnError=true` already set in `ci.yml`; the remaining step is
to rotate the key at nvd.nist.gov/developers/request-an-api-key and update
`secrets.NVD_API_KEY` in repo Settings → Secrets.

**Value:** Restores full dependency-CVE coverage. OWASP catches Java library
CVEs that Trivy (filesystem scan) can miss.

---

### ~~CI-3 · Toolchain & Runtime Version Alignment · DevSecOps · Size M~~ ✓ DONE (PR #69)

Standardise every tool and runtime on its current LTS release, eliminate
floating version references, and ensure the CI environment, Dockerfile, and
docker-compose images are internally consistent.

**Current inventory (audited 2026-11-09):**

| Tool | Location | Pinned to | Problem |
|------|----------|-----------|---------|
| Java (CI) | `.github/workflows/ci.yml` `java-version` | `21` (LTS) | Behind Dockerfile |
| Java (runtime) | `Dockerfile` stages `extract` / `jlink` / final | `eclipse-temurin:25` (LTS) | Ahead of CI |
| Java (build) | `Dockerfile` stage `build` | `maven:3-eclipse-temurin-27-alpine` | **27 is non-LTS**; mismatches runtime |
| Node (CI) | `.github/workflows/ci.yml` `node-version` | `22.14.0` | May be behind latest Node 22 LTS patch |
| Rust | CI + `engine/` | `stable` (floating) | No `rust-toolchain.toml`; can break silently on stable releases |
| Ubuntu (CI) | `.github/workflows/ci.yml` `runs-on` | `ubuntu-latest` (floating) | Floats; can break on GitHub-side runner upgrades |
| Alpine | `Dockerfile` final stage | `3.23` | Re-pin digest on upgrade |
| wasm-pack | CI | `0.15.1` | Check for newer release |
| cargo-llvm-cov | CI | `0.9.1` | Check for newer release |
| Trivy | CI | `v0.76.1` + checks bundle pinned | Update bundle digest when version bumps |
| Prometheus | `docker-compose.yml` | `v3.4.0` (digest-pinned) | Re-pin digest on upgrade |
| Grafana | `docker-compose.yml` | `12.0.0` (digest-pinned) | Re-pin digest on upgrade |

**Work items:**

1. **Standardise Java on 25 LTS everywhere.**
   - CI: bump `java-version` from `21` to `25`.
   - Dockerfile build stage: replace `maven:3-eclipse-temurin-27-alpine` with `maven:3-eclipse-temurin-25-alpine` and re-pin SHA digest.
   - `pom.xml`: confirm `<java.version>25</java.version>` and update `maven.compiler.source/target` if set.
   - Re-run `./mvnw verify` to confirm all tests pass on 25.

2. **Pin CI runner to `ubuntu-24.04`.**
   - Replace every `runs-on: ubuntu-latest` with `runs-on: ubuntu-24.04` (Ubuntu 24.04 LTS, Noble Numbat).
   - Update when Ubuntu 26.04 LTS ships and GitHub Actions supports it.

3. **Add `engine/rust-toolchain.toml` to pin Rust stable.**
   ```toml
   [toolchain]
   channel = "stable"
   # Update to the next stable release when upgrading; pin the exact version.
   # Example: channel = "1.84.0"
   ```
   CI's `rustup update stable` will still apply; the file makes the version
   explicit in the repo and surfaces breakage on new releases before it hits
   main.

4. **Bump Node to latest Node 22 LTS patch** in `ci.yml` `node-version`.

5. **Check and bump wasm-pack and cargo-llvm-cov** to their latest stable
   releases; update `--version` pins and re-run Rust CI.

6. **Bump Trivy** to its latest release; re-fetch the checks-bundle digest
   (`ghcr.io/aquasecurity/trivy-checks@sha256:...`) and update `TRIVY_CHECKS_BUNDLE_REPOSITORY` in `ci.yml`.

7. **Re-pin all Dockerfile image digests** after any base-image version change
   (`docker buildx imagetools inspect <image>:<tag>` → multi-arch index digest).

8. **Re-pin docker-compose image digests** for Prometheus and Grafana if either
   is bumped to a newer release.

**Acceptance:**
- Java version is `25` in CI, Dockerfile build stage, and runtime stages; `pom.xml` target matches.
- CI runners are pinned to `ubuntu-24.04`.
- `engine/rust-toolchain.toml` exists and specifies a concrete stable version.
- Node version in CI is the latest Node 22 LTS patch.
- All Dockerfile `FROM` lines use digest-pinned tags.
- `mvn verify` passes; Jest passes; Rust tests pass; Trivy scan exits 0.
- No floating `latest` or unversioned references remain in CI or Docker configs.

**Devsecops gate:** standard — PASS or PASS WITH NOTES before merge.

---

## WASM — Sprint 1 · Must Have (~6 weeks)

> **ADRs:** Rust + wasm-pack (not Emscripten/TeaVM/AssemblyScript). JSON at the
> WASM boundary (consistent with REST schema, same test fixtures). Java backend
> unchanged through Sprint 2 — WASM is additive, replacing the in-browser JS
> mirror only.

~~### WA-1 · Engine Scaffold & Toolchain · BE (Rust) · CI/CD · Size S~~ ✅ Done — PR #42

Set up a Cargo workspace at `engine/` in the repo root. Add wasm-pack config and
a Maven `exec-maven-plugin` step to run `wasm-pack build` during `mvn package`.
CI: install Rust toolchain (rustup) + wasm-pack in the GitHub Actions workflow.
Output: `engine/pkg/` → copied to `src/main/resources/static/wasm/`. Deliverable:
stub `hello_wasm()` proving the pipeline works end-to-end. No physics yet.

**Acceptance:** `mvn package` succeeds; WASM binary appears in
`src/main/resources/static/wasm/` in the built JAR.

---

### ~~WA-2 · Core Trajectory Engine in Rust · Rust · Size L~~ ✅ Done (PR #46)

---

~~### WA-3 · JS/TS Bindings & Loader · FE · Build · Size S~~ ✅ Done — PRs #65, #66, #67

Write `engine/loader.js` (ESM) that async-initialises the WASM module once and
exposes a typed `computeTrajectory(request, bullet)` function. Generate
TypeScript types via wasm-bindgen. Fallback: if `WebAssembly` is not defined,
throw a named error that the caller routes to the JS fallback.

**Acceptance:** Loader initialises once; subsequent calls are synchronous;
TypeScript types generated.

---

~~### WA-4 · Replace `simulateBullet()` with WASM · FE · Size M~~ ✅ Done — PRs #65, #66, #67

In `ballistics.js`, replace calls to `simulateBullet()` with the WASM loader.
Rename the existing JS implementation to `simulateBulletJS()` for use as
fallback. DOPE card, BC solver, and sweep preview all benefit automatically.
Jest tests mock the WASM loader and cover both WASM-success and fallback paths.
100% coverage maintained.

---

~~### WA-5 · Web Worker Offload · FE · Size S~~ ✅ Done — PRs #65, #66, #67

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

### ~~WA-7 · Client-Side Batch Sweep · FE · Size S~~ ✅ Done — PR #71

~~Rewrite MH-4 sweep mode to run all 5 condition variants in the WASM worker
instead of calling `POST /api/trajectories/batch`. Instant results, no network,
no rate-limit friction. Keep the API path as a fallback when WASM is unavailable.
No UI changes.~~

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
