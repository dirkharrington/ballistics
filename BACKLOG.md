# Backlog

_Baseline: 2026-11-13 · Pure-browser SPA. All physics in TypeScript. No Rust, no Java, no server._
_Sprint history archived in git (through PR #82)._

---

## Milestone 1 — TypeScript physics engine

### SPA-1 · Type the physics engine · FE · Size S

`simulateBulletJS()` already implements the full physics correctly and is the
current no-WASM fallback. This story promotes it to the one and only engine by
adding TypeScript types and removing everything above it in the stack (the WASM
loader, the web worker, and the WASM/JS dispatch layer).

**Work items:**

1. Add TypeScript to the project. Vite already transpiles TS natively — just add
   `tsconfig.json` and rename files from `.js` to `.ts` (or keep `.js` with JSDoc
   types if preferred; both work with Vite).
2. Define typed interfaces for the physics boundary:
   ```ts
   interface Bullet { id: string; name: string; massGrains: number; bcG1: number; bcG7?: number; diameterInch: number; muzzleVelocityFps: number; /* … */ }
   interface TrajectoryParams { rangeMeters: number; zeroRangeMeters: number; windSpeedMps: number; windAngleDeg: number; altitudeMeters: number; temperatureCelsius: number; shootingAngleDeg?: number; latitudeDeg?: number; azimuthDeg?: number; customDragTable?: DragPoint[]; }
   interface DragPoint { mach: number; cd: number; }
   interface TrajectoryPoint { rangeMeters: number; dropCm: number; windDriftCm: number; velocityMps: number; energyJ: number; timeOfFlightSec: number; moaAdjustment: number; mradAdjustment: number; spinDriftCm: number; coriolisDeflectionCm: number; }
   ```
3. Remove `engine-client.js`, `engine/loader.js`, `engine.worker.js`, the WASM
   init chain, and the `virtual:wasm-engine` Vite plugin. Delete the WASM
   dispatch logic in `ballistics.js` (the `try { WASM } catch { simulateBulletJS }`
   wrapper). `simulateBulletJS` becomes `simulate` — the only path.
4. Remove `virtual:physics-tables` plugin (the TS engine inlines its own
   constants, same as `simulateBulletJS` does today).
5. Keep the `virtual:bullet-catalog` Vite plugin — bullets still bundled at build
   time from `bullets.yaml`.
6. Keep the Service Worker — it still caches static assets for offline and repeat
   visits.

**Coverage:** 100% Jest. The JS fallback tests already cover the physics; rename
and retype them. Remove tests that exercised WASM loading, worker messaging, and
the WASM/JS dispatch path.

**Acceptance:**
- `npm run build` completes with no Rust toolchain present.
- `npm test` passes at 100/100/100/100.
- `simulateBulletJS` and all WASM references are gone from the codebase.

---

## Milestone 2 — Drop the server

### SPA-2 · Remove server API calls · FE · Size M

Replace every `fetch('/api/...')` call with direct calls to the TS engine from
SPA-1. No network requests are made at runtime.

**Call sites:**

| Call | Replacement |
|---|---|
| `POST /api/rpc` (trajectory, 2 sites) | `simulate(bullet, params)` — synchronous, inline |
| `POST /api/trajectories/custom` | `simulate(bullet, params)` — same call, custom fields already in `TrajectoryParams` |
| `GET /api/trajectories/compare/stream` (SSE) | `Promise.all([simulate(b1, req), simulate(b2, req)])` — both results arrive in one microtask; progressive rendering via `requestAnimationFrame` if needed |
| `POST /api/trajectories/compare` (non-streaming fallback) | Same `Promise.all` call |
| `POST /api/rpc` (`bullets.list` online probe) | Delete — remove all online/offline toggle logic; with no server the app is always "ready" |

**Coverage:** 100% Jest. All replaced paths need tests covering the TS engine call and the UI update that follows.

**Acceptance:**
- Loading `index.html` from `file://` (no server) works end-to-end.
- No requests to `/api/` under any interaction (verify with browser network tab).
- Compare tab returns both results.
- The "Offline" indicator and online-probe logic are gone.
- Jest passes at 100/100/100/100.

---

### SPA-3 · Delete Java backend and Rust engine · DevSecOps · Size S

Delete every artefact the Java backend and WASM pipeline produced. After SPA-1
and SPA-2, nothing in the runtime references them.

**Delete:**
- `src/main/java/` — Spring Boot application code
- `src/test/java/` — JUnit / JaCoCo tests
- `pom.xml`, `mvnw`, `mvnw.cmd`, `.mvn/`
- `engine/` — entire Rust / wasm-pack workspace (`ballistics-core`, `ballistics-wasm`)
- `Dockerfile`, `docker-compose.yml`, `docker-compose.monitoring.yml`
- `src/main/resources/physics-tables.yaml` — only consumed by Java engine
- `src/main/resources/application*.yml` — Spring config
- `engine/pkg/`, `src/main/resources/static/wasm/` build artefacts (if committed)

**Keep:**
- `src/main/resources/static/` — the entire frontend
- `src/main/resources/bullets.yaml` — bullet catalog source of truth

**CI:** Remove `rust-build` and `java-build` jobs and all `needs:` references to
them. Remove OWASP dependency check (Java-only). Remove Trivy container scan
(no container). Keep: `frontend-build` (Jest + Vite). Keep: Trivy filesystem
scan for npm dependencies. Keep: CodeQL JavaScript.

**Acceptance:**
- `git grep -r 'import.*java\|\.java\|pom\.xml\|wasm-pack\|ballistics-core'` returns nothing.
- CI has one job: `frontend-build`.
- `npm run build` succeeds from a clean checkout with only Node installed.

---

## Milestone 3 — Clean project structure

### SPA-4 · Flatten source layout · FE · Size S

The Maven directory convention (`src/main/resources/static/`) is a Java
artefact. Rename it.

**Move:**
- `src/main/resources/static/` → `app/`
- `src/main/resources/bullets.yaml` → `app/data/bullets.yaml`
- `src/test/js/` → `app/tests/` (or keep at root `tests/` — pick one)

**Update:**
- `vite.config.js`: `root: 'app'`, `outDir: '../dist'`, update all
  `resolve(__dirname, 'src/main/resources/...')` paths in plugins
- `package.json` Jest `roots` and `testMatch`
- CI `paths-filter` entries
- `.gitignore` — add `dist/`, remove `target/`

**Acceptance:**
- No path in the repo references `src/main/resources`
- `npm run build` outputs to `dist/`
- `npm test` finds and runs all suites

---

## Milestone 4 — Deploy

### SPA-5 · Static hosting · DevSecOps · Size S

Publish the Vite output to a static host on every push to `main`.

**Recommended host:** GitHub Pages (zero infra, same repo).

**Work items:**
1. Add `deploy` job in `ci.yml` — runs after `frontend-build`, conditioned on
   `github.ref == 'refs/heads/main'` and `github.event_name == 'push'`
2. Use `actions/deploy-pages` to publish `dist/`
3. Set Vite `base` to match the deployed path (`/ballistics/` for a project site,
   `/` for a custom domain or org site)
4. Update Service Worker scope to match
5. Add `CNAME` file if using a custom domain

**Acceptance:**
- Push to `main` → site live at the configured URL within 2 minutes
- Service Worker registers and caches assets on first load
- Hard refresh at the deployed URL loads the app

---

## Open questions

1. **Custom domain?** GitHub Pages works under `username.github.io/ballistics`; a custom domain needs a `CNAME` and DNS record.
2. **Bullet catalog editing?** Currently read-only (bundled at build time). Should users be able to add/edit bullets locally (e.g. saved to `localStorage`)? Raise as a new story if yes.
3. **Trajectory export?** CSV / PDF download is pure-client and straightforward — raise as a new story if wanted.
