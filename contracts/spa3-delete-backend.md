# Contract: Delete Backend (SPA-3)

Version: 1.0.0 — 2026-11-15
Status: **Proposed** (pending user review)
Owners: frontend builder (§3, §5, §6, §10.1), devsecops (§4, §10.2, §9 review)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0. Deviations from the brief

| Brief | This contract | Reason |
|---|---|---|
| Delete `mvnw`, `mvnw.cmd`, `.mvn/` | No action | These files do not exist in the repo; confirmed by filesystem inspection |
| Delete `docker-compose.monitoring.yml` | No action | This file does not exist in the repo; confirmed by filesystem inspection |
| "OWASP dep-check job removed" | Also delete `owasp-suppressions.xml` | The file is exclusively consumed by the OWASP Maven plugin, which is deleted with Maven. Dead root-level file. |
| `engine/` JS stubs already deleted by SPA-1 | `loader.js`, `loader.d.ts`, `protocol.d.ts` remain | SPA-1 FE deleted most `engine/*.js` files but these three were not removed. SPA-3 finishes the cleanup. |

---

## 1. Scope

### 1.1 Goals

1. Delete the entire Java/Spring Boot application layer, its tests, and its build tooling (`pom.xml`).
2. Delete the Rust/WASM workspace (`engine/`) in full, including remaining JS stubs not yet cleaned by SPA-1.
3. Delete all Docker infrastructure (`Dockerfile`, `docker-compose.yml`, `.dockerignore`).
4. Update `sw.js`: remove all `/api/` intercepts, all offline physics engine code, all WASM cache-version logic. The service worker becomes a minimal static-asset caching SW.
5. Update `ci.yml`: remove `rust-build`, `java-build`, `dependency-check` jobs; simplify `changes` to `frontend` only; shrink `codeql` matrix to `javascript` only; strip Maven prerequisites from `trivy`.
6. Update `vite.config.js`: rename the `_wasmHash` Vite-injected build variable to `CACHE_VERSION`.
7. Delete `src/test/js/cross-validate-runner.cjs`, which only exists to call a Java subprocess that will no longer exist.

### 1.2 Non-goals

- No physics or UI changes.
- CSP headers replacement (`_headers` file, CDN config) is a follow-on for SPA-4/SPA-5; documented in §7.
- `bullets.yaml`, `physics-tables.yaml`, and `src/main/resources/static/` are kept — they are frontend source, not backend.
- `src/test/js/` test files other than `sw.test.js` and `cross-validate-runner.cjs` are unaffected.

---

## 2. Exact delete list

All paths are relative to the repo root. Directories marked with `/` include their entire subtree.

### 2.1 Java application layer

```
src/main/java/
```

(All Spring Boot application code under `com/ballistics/`.)

### 2.2 Java test layer

```
src/test/java/
```

(All JUnit / JaCoCo tests under `com/ballistics/`.)

### 2.3 Maven build files

```
pom.xml
owasp-suppressions.xml
```

`mvnw`, `mvnw.cmd`, `.mvn/` do **not** exist — no action.

Also delete Spring Boot runtime configuration that is exclusively Java-consumed:

```
src/main/resources/application.properties
src/main/resources/application-prod.properties
```

If `src/main/resources/logback-spring.xml` exists, delete it too. `bullets.yaml` and `physics-tables.yaml` **stay** — they are consumed by the Vite virtual-module plugins.

### 2.4 Rust workspace

```
engine/
```

Delete the entire directory, including:

| Subpath | Contents |
|---|---|
| `Cargo.toml`, `Cargo.lock` | Workspace manifest and lock |
| `ballistics-core/` | Core Rust crate |
| `ballistics-wasm/` | WASM crate |
| `cbindgen.toml` | C binding codegen config |
| `rust-toolchain.toml` | Toolchain pin |
| `include/` | cbindgen-generated C header |
| `loader.js`, `loader.d.ts`, `protocol.d.ts` | WASM JS stubs not yet removed by SPA-1 FE |

The `engine/stage.sh` and all `engine/*.test.js` / `engine/*.worker.js` files were already deleted by SPA-1 BE and FE respectively.

### 2.5 Docker infrastructure

```
Dockerfile
docker-compose.yml
.dockerignore
```

`docker-compose.monitoring.yml` does **not** exist — no action.

### 2.6 Dead test infrastructure

```
src/test/js/cross-validate-runner.cjs
```

This was the Node subprocess shim for Java's `CrossValidationTest`. With `src/test/java/` deleted it has no caller.

---

## 3. `sw.js` update

File: `src/main/resources/static/sw.js`

After SPA-2, this file still contains the full offline-API interception engine. SPA-3 strips it to a minimal static-asset service worker.

### 3.1 Symbols to delete

| Symbol | Lines (approx.) | Reason |
|---|---|---|
| `BULLETS_API_URL` | 8 | No `/api/` server exists |
| `_wasmHash`, `_getWasmHash`, `_setWasmHash`, `extractWasmHash` | 15–24 | WASM is gone; cache version mechanism is renamed (§3.2) |
| `getCacheName` | 18 | Replaced (§3.2) |
| G1/G7 drag tables (`G1_TABLE`, `G7_TABLE`) | 29–53 | Physics computation removed |
| Atmosphere constants (`ATM`) | 56–59 | Physics removed |
| Physics constants (`G_FPS2` … `MPH_PER_KPH`) | 62–73 | Physics removed |
| `interpolateDragTable` | 77–87 | Physics removed |
| `airDensityRatio` | 89–94 | Physics removed |
| `findZeroAngleFps` | 96–124 | Physics removed |
| `integrateTrajectoryFps` | 126–179 | Physics removed |
| `simulateBulletSW` | 182–210 | Physics removed |
| `computeOfflineTrajectories` | 214–220 | No bullets catalog API |
| `computeOfflineCustom` | 222–234 | No custom-trajectory API |
| `handleTrajectoriesCompareOffline` | 268–291 | No `/api/trajectories/compare` |
| `handleTrajectoriesCustomOffline` | 293–309 | No `/api/trajectories/custom` |

### 3.2 Symbols to modify or add

**Cache version variable.** Replace the WASM-hash block with a build-timestamp injection:

```js
// Vite injects a build timestamp here at bundle time.
let CACHE_VERSION = 'v1';
export function getCacheName() { return `${CACHE_PREFIX}-${CACHE_VERSION}`; }
```

The Vite `serviceWorkerPlugin` currently replaces the string `'v1'` (the `_wasmHash` default) with `Date.now().toString(36)`. After this rename, update `vite.config.js` to replace the string token in `CACHE_VERSION = 'v1'` instead (§6).

**`handleInstall`.** Remove the `fetch(BULLETS_API_URL)` block. Precache only static assets:

```js
export async function handleInstall() {
  const cache = await caches.open(getCacheName());
  await Promise.allSettled(
    STATIC_ASSETS_TO_PRECACHE.map(url => cache.add(url).catch(() => null)),
  );
  await self.skipWaiting();
}
```

**`handleFetch`.** Remove three intercepts and their surrounding comments:

1. `POST /api/trajectories/compare` block (calls `handleTrajectoriesCompareOffline`).
2. `POST /api/trajectories/custom` block (calls `handleTrajectoriesCustomOffline`).
3. `.wasm` block (extracts WASM hash, calls `cacheFirstNetworkFallback`).
4. The `url.pathname.startsWith('/api/')` passthrough guard (`return` early for other API GETs).

The only paths remaining in `handleFetch`:
- Non-GET → `return` (no intercept).
- `request.mode === 'navigate'` → `networkFirstCacheFallback`.
- Everything else → `cacheFirstNetworkFallback`.

### 3.3 Updated precache manifest

```js
export const STATIC_ASSETS_TO_PRECACHE = [
  '/', '/index.html', '/ballistics.css', '/manifest.json',
];
```

Unchanged from the current value. No `/api/bullets` entry (the fetch was removed).

### 3.4 `sw.test.js` updates

The frontend builder must update `src/test/js/sw.test.js` to maintain 100% coverage on the simplified `sw.js`. Blocks to delete from the test file:

| Test block | Covers |
|---|---|
| `BULLETS_API_URL` and `extractWasmHash` tests | Deleted constants |
| `_getWasmHash` / `_setWasmHash` tests | Deleted symbols |
| G1/G7 tables, physics constants, `interpolateDragTable`, `airDensityRatio`, `findZeroAngleFps`, `integrateTrajectoryFps` tests | Deleted symbols |
| `simulateBulletSW` tests | Deleted |
| `computeOfflineTrajectories` / `computeOfflineCustom` tests | Deleted |
| `handleTrajectoriesCompareOffline` / `handleTrajectoriesCustomOffline` tests | Deleted |
| `handleFetch` cases for POST `/api/trajectories/*` and `.wasm` intercept | Deleted intercepts |
| `handleInstall` case asserting `BULLETS_API_URL` is cached | Deleted behavior |

Blocks to keep (update mock/fixture only if needed):

- `getCacheName` / `CACHE_VERSION` tests (rename `_wasmHash` references to `CACHE_VERSION`).
- `cacheFirstNetworkFallback` / `networkFirstCacheFallback` tests.
- `handleInstall` test asserting `STATIC_ASSETS_TO_PRECACHE` are cached.
- `handleActivate` / `registerListeners` tests.
- `handleFetch` cases for navigation and static assets.

Coverage threshold: 100/100/100/100 (global).

---

## 4. CI changes (`.github/workflows/ci.yml`)

### 4.1 `changes` job

**Remove** the following outputs and their corresponding path filters:

```yaml
# Remove these outputs:
engine:    ${{ steps.filter.outputs.engine }}
java:      ${{ steps.filter.outputs.java }}
container: ${{ steps.filter.outputs.container }}
```

**Remove** the following filters from the `dorny/paths-filter` step:

```yaml
# Remove:
engine:
  - 'engine/Cargo.toml'
  - 'engine/Cargo.lock'
  - 'engine/ballistics-core/**'
  - 'engine/ballistics-wasm/**'
  - 'engine/cbindgen.toml'
java:
  - 'src/main/java/**'
  - 'src/test/java/**'
  - 'src/main/resources/application*.properties'
  - 'src/main/resources/bullets.yaml'
  - 'src/main/resources/physics-tables.yaml'
  - 'src/main/resources/logback-spring.xml'
  - 'pom.xml'
  - 'owasp-suppressions.xml'
  - '.github/workflows/ci.yml'
container:
  - 'Dockerfile'
  - 'docker-compose.yml'
  - '.dockerignore'
  - '.github/workflows/ci.yml'
```

**Keep** the `frontend` filter exactly as it currently reads. The result is a `changes` job with a single output:

```yaml
outputs:
  frontend: ${{ steps.filter.outputs.frontend }}
```

### 4.2 Jobs to remove entirely

Delete the following complete job definitions:

| Job key | Why |
|---|---|
| `rust-build` | No Rust workspace remains |
| `java-build` | No Maven/Java remains |
| `dependency-check` | OWASP Maven plugin requires `pom.xml`; Trivy filesystem scan is the compensating CVE gate |

After deleting `java-build`, the `codeql` job no longer needs `needs: [changes]` to guard against a `java-build` failure — it already does not `need: [java-build]`. No change to `codeql`'s `needs` line is required beyond step cleanup (§4.3).

### 4.3 `codeql` job

The job currently has `matrix: language: [java, javascript]`. After SPA-3:

```yaml
strategy:
  fail-fast: false
  matrix:
    language: [javascript]
```

Remove all Java-conditional steps:

| Step | Remove condition |
|---|---|
| `Set up JDK 21` | Remove entirely (`matrix.language == 'java'` only) |
| `Cache Maven repository` (CodeQL step) | Remove entirely |
| `Build Java (CodeQL traces javac)` | Remove entirely |

The `Initialize CodeQL` and `Perform CodeQL Analysis` steps currently have an `if:` that guards on both `java` and `javascript` layers. With `java` removed from the matrix, simplify both to:

```yaml
if: needs.changes.outputs.frontend == 'true'
```

The checkout step simplifies the same way.

### 4.4 `trivy` job

**Rename** (comment/name only): "Trivy Container Scan" → "Trivy Filesystem Scan".

**Update trigger conditions.** All `if:` conditions in this job currently gate on `java`, `frontend`, `engine`, or `container`. Remove `java`, `engine`, and `container`; keep `frontend` only:

```yaml
if: needs.changes.outputs.frontend == 'true'
```

Apply this simplified condition to: checkout, (removed JDK step), (removed cache step), (removed Maven step), trivy scan step, SARIF upload step.

**Remove** the following steps entirely (they depend on Maven and `pom.xml`):

| Step | Why removed |
|---|---|
| `Set up JDK 21` | No Maven |
| `Cache Maven repository` | No Maven |
| `Populate Maven local cache` (`mvn --batch-mode dependency:resolve`) | No Maven |

The Trivy filesystem scan step itself is unchanged. `skip-dirs: 'target,node_modules'` can stay — `target/` is still created by Jest for JS coverage output.

---

## 5. `package.json` / Jest config

The current `package.json` jest config (after SPA-1) already has:

- `roots: ["src/test/js"]` — no `engine` entry. **No change.**
- `collectCoverageFrom` includes `src/main/resources/static/sw.js` — stays (sw.js is modified, not deleted). **No change.**
- `transform: {"^.+\\.[jt]s$": "babel-jest"}` — covers both JS and TS. **No change.**
- `moduleNameMapper` has no `virtual:wasm-engine`. **No change.**
- `coverageThreshold` at 100/100/100/100. **No change.**

No `package.json` or jest config changes are required by SPA-3. The 100% coverage gate is maintained by the `sw.test.js` updates described in §3.4.

---

## 6. `vite.config.js`

The `serviceWorkerPlugin.closeBundle` currently injects a build timestamp by string-replacing the literal `'v1'` default of `_wasmHash` in the copied `sw.js`. After §3.2 renames the variable to `CACHE_VERSION`, the token being replaced (`'v1'`) does not change — only its variable context does. The Vite plugin injection remains valid.

However, the plugin's internal comments and any `_wasmHash` references in `vite.config.js` itself should be updated to reflect `CACHE_VERSION`. This is a comment/naming change only; no behavioral change.

Verify: after `npm run build`, the copied `sw.js` in the build output must contain `CACHE_VERSION = '<timestamp-hex>'`, not the literal `'v1'`.

---

## 7. CSP and headers

`SecurityHeadersFilter.java` is deleted with the Java layer. It set:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self';        ← /api/ already removed by SPA-2
  font-src 'self';
  frame-ancestors 'none'
```

(`'wasm-unsafe-eval'` was removed by SPA1-BE-2.)

With no server, there is no origin to set response headers. The browser receives assets from wherever they are hosted. This is a **follow-on for SPA-4/SPA-5**:

- **SPA-4** (GitHub Pages): add a `_headers` file (Cloudflare Pages style) or investigate GitHub Pages header support.
- **SPA-5** (CI/CD for Pages): enforce the CSP in CI lint or deployment config.

**SPA-3 blocker? No.** The same CSP that applied before SPA-3 applies in development (`npm run dev`'s Vite dev server does not enforce CSP). Production hosting of the SPA before SPA-5 is a manual deployment; document and accept the gap.

**SSDF PW.6 mapping:** "Implement the software to meet security requirements" — the missing CSP is a known gap, tracked here and in BACKLOG.md, to be addressed in SPA-4/SPA-5.

---

## 8. `application.properties` and frontend

`application.properties` and `application-prod.properties` are Spring Boot configuration files. No frontend code reads them:

- Vite virtual modules (`virtual:bullet-catalog`, `virtual:physics-tables`) read `bullets.yaml` and `physics-tables.yaml` directly — these files stay.
- No `import` or `fetch` of `.properties` files exists anywhere under `src/main/resources/static/` or `src/test/js/`.

Both files are deleted with the Java layer (§2.3). No frontend change required.

---

## 9. Threat model delta (STRIDE-lite, NIST SSDF SP 800-218)

### What is removed

| Capability | Gone with SPA-3 | Compensating control |
|---|---|---|
| Server-side rate limiting | Spring Boot `RateLimitInterceptor` | None needed — no server. UI computes locally. |
| JaCoCo 100% backend coverage gate | Deleted with Java tests | Jest 100% coverage gate remains for frontend |
| OWASP Maven dependency-check | CI job removed | Trivy filesystem scan (`package-lock.json`) remains as the hard CVE gate |
| Trivy container scan | No container | Trivy filesystem scan remains |
| `SecurityHeadersFilter` CSP | Deleted with Java | Follow-on: SPA-4/SPA-5 |
| Server-side input validation (bean validation) | Deleted | `TrajectoryInputError` in `physics/engine.ts` already mirrors all constraints |
| Server-side audit logging | Deleted | No server state to audit |

### New STRIDE considerations

| # | STRIDE | Threat | Status |
|---|---|---|---|
| T1 | DoS | No server to overload. The main-thread DoS risk (unbounded RK4) is already mitigated by M-1 (`physics/engine.ts` input validation). | Retained M-1 from spa1-ts-engine §12 |
| T2 | Tampering | Location data (`latitudeDeg`, `azimuthDeg`) is reserved but typed. With no server, it never leaves the browser even when WA-13 lands. | No change |
| T3 | Information disclosure | No server logs, no server state. No data transit to any backend. | Improved |
| T4 | Elevation of privilege | No server-side auth/authz surface. | Eliminated |
| T5 | Supply chain | Java/Maven deps eliminated, Rust deps eliminated. Only npm supply chain remains. `npm audit --audit-level=high` and Trivy fs scan on `package-lock.json` are the gates. | Reduced surface |
| T6 | CSP gap | No server to set response headers. `connect-src` tightening from SPA-2 is not enforced until SPA-4/SPA-5. | Known gap; tracked |

**SSDF mappings:**
- **PW.1.1** (design to meet security requirements): server-side controls removed by design; compensating controls documented above.
- **RV.1.1** (identify vulnerabilities on an ongoing basis): Trivy fs scan remains as required status check.
- **PW.5.1** (create source code adhering to security practices): no backend code remains; frontend coverage gate stays at 100%.

---

## 10. Task split

### 10.1 Frontend / DevSecOps: 1 combined delete PR

A single PR is preferred for SPA-3 because the deletions span layers, the CI file must land with the file deletions (otherwise `java-build` and `rust-build` trigger on a half-deleted repo), and there is no code to write — only deletes.

**Merge order: CI changes (`ci.yml`) must ship in the same PR as the file deletions.** Do not split them. If a large PR is impractical, merge CI changes first (without file deletions), then merge file deletions — but never the reverse.

| ID | Task | Acceptance |
|---|---|---|
| **SPA3-FE-1** | Delete file trees (§2). Update `sw.js` (§3.2–§3.3). Update `src/test/js/sw.test.js` (§3.4). Delete `cross-validate-runner.cjs`. Update `vite.config.js` comment/variable reference (§6). | No `src/main/java/`, `src/test/java/`, `pom.xml`, `engine/`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `owasp-suppressions.xml`, or `cross-validate-runner.cjs` remain. `npm test` passes. `npm run build` succeeds. 100% Jest coverage. |
| **SPA3-OPS-1** | Update `ci.yml`: remove `rust-build`, `java-build`, `dependency-check`; simplify `changes`; update `codeql`; update `trivy` (§4). | All removed jobs are absent. `frontend-build`, `codeql (javascript)`, and `trivy` jobs remain and pass. No Maven or Rust steps remain in CI. |

Both tasks ship in the same PR (or OPS-1 merges first). Devsecops reviews the combined PR for SSDF compliance.

### 10.2 Follow-on (not SPA-3)

- CSP/headers for static hosting → SPA-4/SPA-5.
- Delete `sw.js` once the app no longer needs offline caching at all (optional, post-SPA-5).

---

## 11. Acceptance checklist

- [ ] `src/main/java/`, `src/test/java/`, `pom.xml`, `owasp-suppressions.xml`, `src/main/resources/application*.properties` are deleted.
- [ ] `engine/` directory is deleted entirely (including `loader.js`, `loader.d.ts`, `protocol.d.ts`).
- [ ] `Dockerfile`, `docker-compose.yml`, `.dockerignore` are deleted.
- [ ] `src/test/js/cross-validate-runner.cjs` is deleted.
- [ ] `sw.js` has no reference to `/api/` routes, no physics engine code, no WASM hash logic.
- [ ] `sw.js` exports `CACHE_VERSION` (not `_wasmHash`); `getCacheName()` uses it.
- [ ] `sw.js` `STATIC_ASSETS_TO_PRECACHE` is `['/', '/index.html', '/ballistics.css', '/manifest.json']`.
- [ ] `npm test` passes (typecheck + Jest at 100/100/100/100). No Java or Rust toolchain required.
- [ ] `npm run build` produces a working static bundle. Vite injects a build timestamp into the copied `sw.js` as `CACHE_VERSION`.
- [ ] CI: `rust-build`, `java-build`, `dependency-check` jobs are absent.
- [ ] CI: `changes` job has only the `frontend` output.
- [ ] CI: `codeql` matrix is `[javascript]` only; no JDK/Maven steps remain.
- [ ] CI: `trivy` job has no JDK/Maven steps; triggers only on `frontend` changes.
- [ ] `BACKLOG.md` updated: SPA-3 marked done in the same PR.
