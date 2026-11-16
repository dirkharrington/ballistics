# Backlog

_Baseline: 2026-11-13 · Pure-browser SPA. All physics in TypeScript. No Rust, no Java, no server._
_Sprint history archived in git (through PR #82)._

---

## Milestone 1 — TypeScript physics engine

### ~~SPA-1 · Type the physics engine · FE · Size S~~ ✅ Done (PR #86)

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

### ~~SPA-2 · Remove server API calls · FE · Size M~~ · **DONE** (PR #TBD)

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

### ~~SPA-3 · Delete Java backend and Rust engine · DevSecOps · Size S~~ ✅ Done (PR #TBD)

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

### ~~SPA-4 · Flatten source layout · FE · Size S~~ ✅ Done (PR #93)

The Maven directory convention (`src/main/resources/static/`) is a Java
artefact. Rename it. Contract: `contracts/spa4-flatten-layout.md` v1.0.0.

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

### ~~SPA-5 · Static hosting · DevSecOps · Size S~~ ✅ Done (PR #107)

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

## Milestone 5 — Maintenance & Cleanup

### ~~CLN-1 · Remove stale artefacts · FE · Size S~~ ✅ Done (PR #95)

Delete files and folders that existed only to support the Java/Maven/Docker
stack. None are referenced by the app or tests.

**Delete:**
- `monitoring/` — Grafana dashboard JSON + `prometheus.yml`; no Docker Compose
  stack remains to run them
- `node/` — Node.js binary and npm scripts bundled by `frontend-maven-plugin`
  for offline Maven builds; npm runs from PATH now
- `.vscode/settings.json` — contains only `java.compile.nullAnalysis.mode` and
  `java.configuration.updateBuildConfiguration`; delete the file entirely (or
  the two keys if other settings exist)

**Update:**
- `.gitignore` — add `target/` (JaCoCo / Vite cache directory still present
  locally but not ignored); `target/` currently not in `.gitignore`
- `app/drag-csv.js` — remove stale comment "drag model override requires server
  update" from the file input help text; server is gone

**Acceptance:**
- `monitoring/`, `node/` are deleted from the repo
- `git grep -r 'java\.' .vscode/` returns nothing
- `target/` appears in `.gitignore`
- No comment in `app/drag-csv.js` references "server"

---

### ~~CLN-2 · Rewrite README.md · FE · Size M~~ ✅ Done (PR #96)

The README documents a Java/Spring Boot/Docker/REST stack that no longer exists.
Rewrite it to reflect the current pure-browser SPA.

**Remove entirely:**
- "Run with Maven", "Run with Docker", "Run with Monitoring Stack" sections
- "API Reference" section (all `/api/` endpoints)
- "Configuration" section (Spring properties)
- Architecture diagram showing `fetch /api/...` and Spring Boot
- Prerequisites: Java 21+, Maven 3.9+, Docker

**Replace with:**
- **Getting started:** `npm install && npm run dev` → `http://localhost:5173`
- **Tech stack table:** Vite 6, TypeScript, Chart.js, Jest (100% coverage),
  GitHub Actions CI, GitHub Pages
- **Architecture:** single-page app — Vite bundles `app/` → `dist/`; physics
  in `app/physics/engine.ts`; Service Worker caches assets for offline use
- **Project structure:** `app/` (source), `tests/` (Jest), `dist/` (build
  output), `contracts/` (design docs)
- **Build:** `npm run build` → `dist/`; `npm test` → Jest

**Keep:** Physics model section (RK4 integrator description is still accurate),
bullet catalog section (update path to `app/data/bullets.yaml`).

**Acceptance:**
- `grep -c 'maven\|spring\|java\|docker\|/api/' README.md` returns 0
  (case-insensitive)
- README passes a "cold read" — a developer with only Node installed can follow
  it to run the app

---

## Milestone 6 — Performance

### PERF-1 · Move `simulate()` to a Web Worker · FE · Size M · **Done — PR #99**

`simulate()` is synchronous and runs on the main thread. In worst-case usage
(10 bullets, 2 000 m range, 1 m step) it performs ~20 000 RK4 iterations per
click, blocking input and frame rendering for a visible stutter.

**Contract:** [`contracts/perf1-web-worker.md`](contracts/perf1-web-worker.md) v1.0.0 (2026-11-15)

**Work items:**
1. Create `app/physics/engine.worker.ts` — a module worker that receives
   `{ bullet, params }` via `postMessage` and replies with the
   `TrajectoryResult`.
2. Add a thin async wrapper `simulateAsync(bullet, params): Promise<TrajectoryResult>`
   in `app/ballistics.js` (or a new `app/physics/engine-client.ts`) that
   dispatches to the worker and resolves on `message`.
3. Pool or re-use the worker across calls; terminate on `pagehide`.
4. Update `runSimulation()`, `runCustom()`, and the sweep/compare paths to
   `await simulateAsync(...)`. Wrap the chart-render step in
   `requestAnimationFrame` to let the browser paint between computation and
   render.
5. Keep the synchronous `simulate()` export for Jest (workers are unavailable
   in jsdom); tests import the engine directly, not through the worker.

**Coverage:** 100% Jest. Worker dispatch logic is covered by mocking
`Worker` in `tests/`; physics tests continue to call `simulate()` directly.

**Acceptance:**
- UI remains responsive (no jank) during a 10-bullet, 2 000 m simulation.
- `npm test` passes at 100/100/100/100.
- Worker is terminated on `pagehide`.

---

### ~~PERF-2 · Service Worker: precache all Vite-hashed assets · FE · Size S~~ ✅ Done (PR #98)

The current `sw.js` precaches only four un-hashed URLs (`/`, `/index.html`,
`/ballistics.css`, `/manifest.json`). Hashed JS/CSS/font assets are cached
only on first use. A full offline load after cache warm-up still fetches
~10 network requests.

**Work items:**
1. Use Vite's `vite-plugin-pwa` (or a custom `generateSW`-style plugin) to
   inject the full Vite asset manifest into `sw.js` at build time as the
   precache list.
2. The `STATIC_ASSETS_TO_PRECACHE` constant becomes the generated manifest;
   remove the hand-maintained list.
3. Keep the existing `cacheFirstNetworkFallback` / `networkFirstCacheFallback`
   strategies and lifecycle handlers.

**Acceptance:**
- After one full page load, `chrome://serviceworker-internals` shows all
  hashed assets in the cache.
- Hard refresh with network set to "Offline" in DevTools loads the app fully.
- `npm test` passes at 100/100/100/100 (SW tests updated for new precache list).

---

### ~~PERF-3~~ · Lazy-load Chart.js · FE · Size XS ✅ Done (PR #106)

Chart.js adds ≈ 200 KB (gzipped ≈ 65 KB) to the initial bundle. It is not
needed until the user clicks "Simulate". Dynamic import reduces the initial
parse cost on mobile and slow connections.

**Work items:**
1. Replace the static `import { Chart, … } from 'chart.js'` at the top of
   `app/ballistics.js` with a dynamic `const { Chart, … } = await
   import('chart.js')` inside `renderCharts()`.
2. Register Chart.js components immediately after the dynamic import.
3. Show the existing "Computing…" spinner while the import resolves (it already
   covers the simulation; it also covers the first import latency).

**Coverage:** 100% Jest. Mock `import('chart.js')` in tests (already mocked
for Chart constructor; update mock path if needed).

**Acceptance:**
- `dist/` initial entry chunk no longer contains Chart.js code (verify with
  `vite build --reporter json` or `npx vite-bundle-visualizer`).
- First "Simulate" click loads Chart.js once; subsequent clicks use the
  cached module.
- `npm test` passes at 100/100/100/100.

---

## Milestone 7 — User Experience

### UX-3 · Bullet list selection UX · FE · Size S

The bullet list currently selects all rounds on first visit, has no way to
toggle all at once, and blocks simulation with a browser `alert()` when nothing
is selected. The user experience should start focused (one round), offer a
quick all/none toggle, and give the button itself the disabled feedback rather
than an interrupting dialog.

**Current behaviour (see `app/ballistics.js`):**
- `init()` line 1207: first visit selects all bullets (`bullets.forEach(b => selectedIds.add(b.id))`)
- `runSimulation()` line 169: zero-selection guard uses `alert('Select at least one round.')`
- No select-all control exists

**Work items:**
1. **First-visit default**: change line 1207 from selecting all bullets to
   selecting only `bullets[0]` (the first entry in the catalog).
   Returning visits still restore from `localStorage`; URL-driven selection is
   unchanged.
2. **Select-all / deselect-all checkbox**: add a `<label>` with an
   `<input type="checkbox" id="selectAllBullets">` above the `#bulletList`
   container in `index.html`. Wire it in `ballistics.js`:
   - **checked** → add every bullet id to `selectedIds`
   - **unchecked** → clear `selectedIds` (button becomes disabled; see below)
   - **indeterminate** (some but not all selected) → set
     `checkbox.indeterminate = true` whenever the count is between 0 and the
     total (exclusive)
   - Clicking an individual card must update the checkbox state to match.
3. **Disabled compute button**: replace the `alert()` guard in
   `runSimulation()` with a no-op early return; instead keep the `#runBtn`
   disabled while `selectedIds.size === 0` and re-enable it as soon as at
   least one bullet is selected. Update button disabled state in
   `updateBulletCards()` (called after every selection change).
4. Update `renderBulletList()` to call the new checkbox-sync helper so the
   state is correct after the initial render and after prefs/URL restore.

**Coverage:** 100% Jest. Test:
- First-visit default selects exactly one bullet (index 0).
- Selecting all individually checks the checkbox; deselecting one makes it
  indeterminate; deselecting the last unchecks it.
- Checking the select-all box adds all ids to `selectedIds`.
- Unchecking the select-all box clears `selectedIds`.
- `#runBtn` is disabled when `selectedIds` is empty; enabled when non-empty.
- `runSimulation()` returns early (no alert, no network/worker call) when
  `selectedIds` is empty.

**Acceptance:**
- Fresh load (cleared localStorage): exactly one bullet is selected and
  `#runBtn` is enabled.
- Unchecking that bullet disables `#runBtn`; checking any bullet re-enables it.
- The select-all checkbox reflects checked / indeterminate / unchecked
  accurately after every individual card click.
- Clicking select-all then deselect-all leaves zero bullets selected and
  `#runBtn` disabled.
- `npm test` passes at 100/100/100/100.

---

### UX-1 · Custom bullet catalog · FE · Size M

Users can only select bullets bundled at build time. Adding a custom load
(wildcat cartridge, handload, suppressor-specific subsonic) requires a code
change and a redeploy. This story lets users define and save custom bullets
locally without touching the source.

**Work items:**
1. Add a "Custom bullets" section to the bullet-selector UI with an **Add**
   button that opens an inline form: name, short name, mass (grains), BC G1,
   BC G7 (optional), diameter (inch), muzzle velocity (fps).
2. Validate inputs on submit (all required fields numeric and in range; name
   non-empty and unique within custom bullets).
3. Persist custom bullets to `localStorage` as a JSON array under a versioned
   key (e.g. `ballistics:custom-bullets:v1`). Wrap every read/write in
   try/catch — storage may be blocked or full.
4. Merge custom bullets with the bundled catalog at selector-population time.
   Custom bullets appear in a labelled group below built-in ones.
5. Add a **Delete** control per custom bullet (with a brief confirmation) that
   removes it from storage and from the selector. Prevent deletion of a bullet
   currently selected in either slot.
6. Pre-populate the form with the selected bullet when the user clicks an
   **Edit** control, saving back to the same entry.

**Coverage:** 100% Jest. Test: form validation (missing fields, out-of-range
values, duplicate name), localStorage serialisation/deserialisation, merge with
built-in catalog, delete guard when bullet is active, graceful degradation when
storage throws.

**Acceptance:**
- A custom bullet survives a hard refresh.
- Selecting a custom bullet and running Simulate produces a valid trajectory.
- Deleting a custom bullet removes it from the selector and storage.
- If `localStorage` is unavailable the UI renders with built-in bullets only
  and no uncaught error.
- `npm test` passes at 100/100/100/100.

---

### UX-2 · Trajectory export · FE · Size S

After a simulation the user has no way to take the data elsewhere — into a
spreadsheet, a ballistic card, or another tool. This story adds a one-click
CSV download of the full trajectory table.

**Work items:**
1. Add an **Export CSV** button to the results panel, visible only after a
   successful simulation (hidden or disabled before first run).
2. Build the CSV in-browser from the trajectory array:
   - Header row: `Range (m), Drop (cm), Wind Drift (cm), Velocity (m/s),
     Energy (J), Time of Flight (s), MOA Adjustment, MRAD Adjustment,
     Spin Drift (cm), Coriolis Deflection (cm)`
   - One data row per `TrajectoryPoint`; values rounded to two decimal places.
3. Trigger a download via a temporary `<a href="data:text/csv,...">` or
   `URL.createObjectURL` + `a.click()` pattern; revoke the object URL
   immediately after.
4. Name the file `<bullet-name>-<zero-range>m-zero.csv`
   (e.g. `Hornady-ELD-X-175gr-100m-zero.csv`), sanitising the bullet name
   (replace non-alphanumeric runs with `-`, trim leading/trailing dashes).
5. If the Compare tab is active, export both trajectories as a single CSV
   with a `Bullet` column prepended so rows are distinguishable.

**Coverage:** 100% Jest. Test: CSV header and row content, filename
sanitisation, compare-mode dual-trajectory output, button visibility state
before and after simulation.

**Acceptance:**
- Clicking Export CSV immediately downloads a file with the correct name.
- Opening the file in a spreadsheet shows labelled columns and one row per
  range step.
- Compare export contains rows for both bullets with the `Bullet` column
  populated.
- `npm test` passes at 100/100/100/100.

---

## Milestone 8 — Security hygiene

### SEC-1 · Pin vulnerable transitive Jest dependencies · DevSecOps · Size XS

Dependabot and Trivy report three open vulnerabilities (medium × 2, low × 1),
all transitive dependencies pulled in by Jest. None reach the browser bundle —
they exist only in the test environment — but they keep the security dashboard
red and will block any future devsecops gate that enforces zero open findings.

| Package | Version | Advisory | Severity | Via |
|---|---|---|---|---|
| `minimatch` | 10.2.6 | GHSA-g3hv-75wg-m249 | Medium | `jest` → `@jest/reporters` → `glob` → `minimatch` |
| `glob` | 13.0.6 | GHSA-3g3m-2fjr-6pw4 | Medium | `jest` → `@jest/reporters` → `glob` |
| `deepmerge` | 4.3.1 | GHSA-gcqx-w48m-w2h4 (CVE-2026-93753) | Low | `jest` → `jest-config` → `deepmerge` |

**Work items:**
1. Run `npm audit` and confirm all three are still open and unresolved upstream.
2. If a patched version is available for each package, add an `overrides` block
   to `package.json` to force the patched versions:
   ```json
   "overrides": {
     "minimatch": ">=<patched-version>",
     "glob": ">=<patched-version>",
     "deepmerge": ">=<patched-version>"
   }
   ```
3. Run `npm install` to regenerate `package-lock.json`, then `npm test` to
   confirm Jest still works with the pinned versions.
4. If no patched version exists for a package, dismiss the corresponding
   Dependabot alert with reason `tolerable_risk` and a note explaining the
   dev-only scope (these packages are never bundled into `dist/`).
5. Run `npm audit --audit-level=high` and confirm it exits 0 (medium/low
   findings that remain unresolvable are acceptable until upstream patches land).

**Coverage:** No coverage change — no app code changes.

**Acceptance:**
- `npm audit --audit-level=high` exits 0.
- Dependabot alerts #74 and #77 are closed (fixed or dismissed with rationale).
- Code-scanning alerts #83, #84, #85 are closed.
- `npm test` passes at 100/100/100/100.

---

### SEC-2 · Resolve stale CodeQL XSS alert and audit innerHTML usage · DevSecOps · Size XS

CodeQL alert #12 flags `innerHTML` usage as a potential DOM XSS vector at
`src/main/resources/static/tools.js` — a path that was deleted in SPA-4 (moved
to `app/tools.js`). The alert is stale: CodeQL's current analysis of the live
codebase does not re-raise it, suggesting the data flow does not reach a
sensitive sink. However, the alert remains open and the `innerHTML` calls in
`app/tools.js` should be audited before it is dismissed.

**Work items:**
1. Read `app/tools.js` lines ~110–145 (the two `innerHTML` assignments at the
   DOPE table render and the distance-input row render). Trace every value
   injected into the template literal:
   - `thCols`, `thSub` — confirm these come from computed constants, not
     user-controlled input.
   - `bodyRows` — confirm values are numeric trajectory results, not
     unsanitised strings.
   - `_dopeDistances[i]` in the input row — confirm values are validated
     integers before being written back into the DOM attribute.
2. If any path lets untrusted string data reach `innerHTML`:
   - Replace with `element.textContent`, `setAttribute`, or explicit
     `document.createElement` + `appendChild` calls so no HTML parsing occurs.
   - Write a regression test proving the sanitised path.
3. If all data flows are confirmed safe (computed numbers / controlled
   constants only):
   - Dismiss CodeQL alert #12 via the GitHub API with reason `false_positive`
     and a note that the flagged file no longer exists and the equivalent code
     in `app/tools.js` only writes numeric values.
4. Confirm no other `innerHTML`/`insertAdjacentHTML`/`outerHTML`/`document.write`
   calls exist elsewhere in `app/` that accept user-supplied strings without
   sanitisation (`grep -rn "innerHTML\|insertAdjacentHTML" app/`).

**Coverage:** If any `innerHTML` call is replaced, add or update tests for the
affected render function to cover the data-flow fix.

**Acceptance:**
- CodeQL alert #12 is closed (dismissed as false positive or fixed).
- `grep -rn "innerHTML" app/` shows only calls where every interpolated value
  is a numeric expression, a trusted constant, or explicitly sanitised.
- `npm test` passes at 100/100/100/100.

---

