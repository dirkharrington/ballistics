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

## Milestone 5 — Performance

> **Prerequisite:** SPA-1 through SPA-5 merged. Measure before cutting — every
> story here starts with a Lighthouse / DevTools profile to establish a baseline
> and ends with a before/after comparison.

### OPT-1 · Profiling baseline and Core Web Vitals targets · FE · Size S

Establish concrete numbers before any optimization work starts, so every
subsequent story has a measurable acceptance criterion.

**Work items:**
1. Run Lighthouse on the deployed URL (GitHub Pages, mobile + desktop preset).
   Record LCP, INP, CLS, TTI, Total Blocking Time, and bundle size.
2. Run the trajectory simulation in DevTools Performance panel for one round at
   1000 m, 2000 m, and 3000 m. Record scripting time and frame budget used.
3. Record the bundle breakdown: `npm run build -- --report` (Vite bundle
   visualizer or `rollup-plugin-visualizer`). Identify the top-5 largest modules.
4. Set targets for OPT-2 through OPT-5:
   - LCP < 1.5 s on a simulated mobile 4G connection
   - INP < 100 ms for all interactions
   - CLS = 0
   - Trajectory simulation < 5 ms at 3000 m (single round)
   - Initial JS bundle < 100 KB gzipped

**Acceptance:** A markdown report committed to `docs/perf-baseline.md` with the
raw numbers and the targets above annotated pass/fail. Any target already met is
noted; any that fails becomes the acceptance criterion for the relevant OPT story.

---

### OPT-2 · Chart rendering — downsampling and table virtualization · FE · Size S

Rendering 3000 Chart.js data points and 3000 DOM table rows on every trajectory
is the dominant rendering cost. Neither is perceptible at higher resolution than
~200 visual points.

**Work items:**

1. **Downsample for charts.** Add a `downsample(points, n)` utility that returns
   `n` evenly-spaced points from the trajectory array (default `n = 200`). Pass
   the downsampled array to every Chart.js dataset. Keep the full array for the
   DOPE card and CSV export, which need every point.
2. **Virtualize the trajectory table.** Replace the current `innerHTML` loop that
   renders all points with a virtual scroller: render only the rows in the
   viewport plus a small overscan buffer (~20 rows). Re-render on scroll via
   `IntersectionObserver` or a simple scroll listener.
3. **Lazy-evaluate annotations.** Zero-crossing, supersonic-limit, and
   max-ordinate annotations are computed on every chart update. Cache them and
   recompute only when the trajectory data changes.

**Coverage:** 100% Jest. Test `downsample` for edge cases (n > array length, n = 1,
empty input). Virtual scroller: test that only the visible slice is rendered.

**Acceptance:**
- Chart render time (measured in DevTools Rendering → Frame Rendering Stats)
  drops by ≥ 60% vs. the OPT-1 baseline at 3000 m.
- INP for the "Compare" action is < 100 ms.
- Trajectory output values are unchanged (the full array is still computed;
  only the display is downsampled).

---

### OPT-3 · Code splitting — defer charts and tools panel · FE · Size S

The Chart.js library (~200 KB minified) and the tools panel (DOPE card, BC
solver, sweep mode) are loaded eagerly on page init even when the user never
opens those tabs. Dynamic `import()` defers them to first use.

**Work items:**

1. Wrap the Chart.js import in `ballistics.js` with a dynamic import gated on
   first "Trajectory Charts" tab activation:
   ```ts
   let chartsModule: typeof import('./charts') | null = null;
   async function getCharts() {
     if (!chartsModule) chartsModule = await import('./charts');
     return chartsModule;
   }
   ```
2. Do the same for the tools panel (`tools.ts`).
3. Add a lightweight skeleton / spinner that shows while the deferred module
   loads (typically < 200 ms on a warm cache; invisible on subsequent visits).
4. Vite handles the chunk split automatically — verify with the bundle visualizer
   that Chart.js is in a separate chunk.

**Coverage:** 100% Jest. Mock `import()` to verify the deferred load is triggered
only on first tab activation and not on page init.

**Acceptance:**
- Initial JS bundle (the chunk loaded on page open) is < 100 KB gzipped.
- Chart.js chunk is loaded only after the user opens the Charts tab.
- LCP improves by ≥ 20% vs. the OPT-1 baseline (Chart.js no longer blocks
  the critical render path).

---

### OPT-4 · Physics engine — typed arrays and hot-loop tightening · FE · Size S

The trajectory integrator runs in a tight loop (up to 3000 iterations). Two
changes reduce allocation and branch cost: pre-allocate the output array and
eliminate per-iteration object literals.

**Work items:**

1. **Pre-allocate output.** Replace `points.push({ ... })` inside the loop with
   a pre-sized `Float64Array` per field (one array per `TrajectoryPoint` scalar
   field). Return a typed `TrajectoryData` struct that tools and charts read by
   index. Keep a `toPointArray(): TrajectoryPoint[]` helper for the table and
   DOPE card, called outside the hot loop.
2. **Inline constants.** The drag coefficient lookup (G1/G7 binary search) runs
   on every step. Cache the lookup table reference outside the loop.
3. **Profile before committing.** Run the DevTools Performance panel on the
   changed code at 3000 m; keep the change only if scripting time drops by ≥ 20%.
   If the gain is below threshold, document the measurement and close the story
   as "investigated — no change warranted."

**Coverage:** 100% Jest. The typed-array output must produce identical results to
the object-array output within floating-point equality (use existing test
fixtures as the oracle).

**Acceptance:**
- Physics computation at 3000 m (single round) is < 5 ms in DevTools.
- All existing trajectory-value tests pass unchanged.

---

### OPT-5 · Service Worker cache strategy tuning · FE · Size S

With no server, the Service Worker no longer needs to intercept `/api/` calls or
synthesize JSON-RPC responses. Simplify it to a pure asset cache with an
optimal strategy for the static hosting layout.

**Work items:**

1. Remove all `/api/` interception logic from `sw.js` — it was the offline
   server-response synthesizer, now dead code.
2. Adopt a cache-first strategy for all static assets (JS, CSS, fonts):
   - On install: pre-cache the full asset manifest Vite emits (`dist/manifest.json`)
   - On fetch: cache-first with network fallback and background revalidation
     (`stale-while-revalidate` semantics)
3. Use a content-hash version key (Vite already appends content hashes to asset
   filenames) instead of the current `_wasmHash` timestamp approach.
4. Add a `skipWaiting` + `clients.claim()` pattern so new deploys activate
   immediately on next page load rather than waiting for all tabs to close.

**Coverage:** 100% Jest. Test the revised `sw.js` install, fetch, and activate
handlers using the existing Service Worker test harness.

**Acceptance:**
- Repeat visits (warm cache) load with zero network requests (all assets served
  from cache).
- After a new deploy: on the next page load the new Service Worker activates and
  fetches the updated asset manifest; stale assets are replaced.
- No `/api/` route handling remains in `sw.js`.

---

### OPT-6 · Minimize network requests · FE / DevSecOps · Size S

A pure-browser SPA should load from zero network requests on a repeat visit and
from as few as possible on first visit. This story audits every outbound request
the app makes and eliminates or pre-stages anything avoidable.

**Targets:**
- **First visit:** ≤ 5 network requests (HTML + main JS chunk + CSS + manifest + SW registration)
- **Repeat visit:** 0 network requests (Service Worker serves everything from cache)
- **Third-party domains:** 0 (no calls to CDNs, font services, analytics, or beacons)

**Work items:**

1. **Audit.** Open DevTools Network panel on the deployed URL with the cache
   disabled. List every request: URL, initiator, size, type. Identify any
   third-party domains (Google Fonts, cdnjs, unpkg, analytics, etc.).

2. **Self-host all external resources.** Bundle every dependency through Vite
   (npm install it; don't load from CDN). Common culprits:
   - Google Fonts → download the font files and serve from `app/fonts/`; update
     `@font-face` declarations in CSS; remove the `<link>` preconnect and
     stylesheet tags from `index.html`
   - Chart.js, Bootstrap, or any other library loaded via CDN `<script>` →
     replace with the npm package already in `node_modules`
   - Any tracking pixel, beacon, or analytics script → remove entirely (this is
     a privacy-sensitive ballistics tool; no third-party data collection)

3. **Preload deferred chunks.** The code-split chunks from OPT-3 (Chart.js,
   tools panel) are fetched on first tab activation. Add
   `<link rel="modulepreload">` hints for them in `index.html` (Vite can emit
   these automatically via `build.modulePreload`). The browser fetches them
   during idle time before the user clicks, so the tab switch feels instant and
   the request happens before it's needed rather than blocking the interaction.

4. **Inline critical CSS.** If the CSS bundle is small (< 10 KB), inline it in
   `index.html` via Vite's `vite-plugin-critical` or a simple `transformIndexHtml`
   hook. Eliminates one render-blocking network request on first visit.

5. **Verify SW precache coverage.** After OPT-5, the Service Worker installs a
   precache manifest. Confirm the manifest includes every asset emitted by the
   Vite build — including font files and the code-split chunks. Missing entries
   mean a network request on second visit for those assets.

**Coverage:** 100% Jest. Test that `index.html` contains no external `<link>` or
`<script>` `src` attributes pointing outside the origin. Test that the SW
precache manifest (or the install handler) lists every file in `dist/`.

**Acceptance:**
- DevTools Network panel (cache disabled, fresh profile): ≤ 5 requests on first
  load, all from the same origin.
- DevTools Network panel (cache enabled): 0 requests on repeat load (304s or
  service-worker-served, no outbound fetches).
- `grep -r 'fonts.googleapis\|cdn\.\|unpkg\.\|cdnjs\.' dist/` returns nothing.
- Lighthouse "Avoids third-party code" audit passes.

---

## Open questions

1. **Custom domain?** GitHub Pages works under `username.github.io/ballistics`; a custom domain needs a `CNAME` and DNS record.
2. **Bullet catalog editing?** Currently read-only (bundled at build time). Should users be able to add/edit bullets locally (e.g. saved to `localStorage`)? Raise as a new story if yes.
3. **Trajectory export?** CSV / PDF download is pure-client and straightforward — raise as a new story if wanted.
