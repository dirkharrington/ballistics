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

### ✅ PERF-1 · Move `simulate()` to a Web Worker · FE · Size M · DONE

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

### ✅ UX-3 · Bullet list selection UX · FE · Size S · DONE

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

### ✅ UX-1 · Custom bullet catalog · FE · Size M · DONE

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

### ✅ UX-2 · Trajectory export · FE · Size S · DONE

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

### ✅ SEC-1 · Pin vulnerable transitive Jest dependencies · DevSecOps · Size XS · DONE (PR #146)

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

### ✅ SEC-2 · Resolve stale CodeQL XSS alert and audit innerHTML usage · DevSecOps · Size XS · DONE

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


## Sprint 9 — Performance

These ten stories ship as **stacked PRs**, merged in the order listed. Each branch is cut from the one before it. The decisions and rationale are in ADR 010, [`contracts/adr-sprint9-performance.md`](contracts/adr-sprint9-performance.md). Before PERF-4 merges, record the baseline from ADR 010 §4: Lighthouse mobile, the SW precache byte total, and the timing of a 10-bullet, 2 000 m, 1 m-step simulation.

Stack: PERF-4 → PERF-5 → PERF-6 → PERF-7 → PERF-8 → PERF-9 → PERF-10 → PERF-11 → PERF-12 → PERF-13

---

### ~~PERF-4 · Vite build target `esnext` and disable `reportCompressedSize` · DevSecOps · Size XS~~ ✅ Done (PR #115)

`vite.config.js` doesn't set `build.target`, so Vite 8 lowers syntax to its default browser baseline. The app already needs module workers (`create-physics-worker.ts`) and a module service worker (`navigator.serviceWorker.register(..., { type: 'module' })`), so lowering gains no browsers and only makes the output bigger. `reportCompressedSize` defaults to `true`, so every build gzips each chunk just to print a size column.

**Work items:**
1. In `vite.config.js`, add `target: 'esnext'` and `reportCompressedSize: false` to `build`.
2. Leave `build.cssTarget` unset, so it inherits `target`. Leave the `worker` block unchanged, since worker output also follows `build.target`.
3. Above `target`, add a one-line comment saying why: the browser floor is already set by module workers and module SWs. The fallback is `'es2022'` if a target browser breaks.
4. Record `npm run build` wall time before and after (median of 3 runs, `time npm run build`) in the PR description.

**Coverage:** No app code changes, so coverage is unchanged.

**Acceptance:**
- `npm run build` no longer prints the gzip size column.
- Served with `npm run build && npx vite preview`, the built app loads and completes a simulation in current Chrome, Firefox and Safari, on desktop and iOS.
- Build time is not slower.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-5 · Preload critical fonts · FE · Size XS~~ ✅ Done (PR #118)

`app/index.html` has no font preloads. The browser finds the woff2 files only after `ballistics.css` downloads and parses and an element that uses them is styled. With `font-display: swap`, the header then reflows visibly.

**Work items:**
1. In `app/index.html`, add three preloads immediately **before** `<link rel="stylesheet" href="./ballistics.css">`. Use the same root-relative `/fonts/…` form that `ballistics.css` uses, so Vite resolves both to the same fingerprinted asset:
   ```html
   <link rel="preload" href="/fonts/rajdhani-400.woff2"        as="font" type="font/woff2" crossorigin>
   <link rel="preload" href="/fonts/share-tech-mono-400.woff2" as="font" type="font/woff2" crossorigin>
   <link rel="preload" href="/fonts/orbitron-900.woff2"        as="font" type="font/woff2" crossorigin>
   ```
   Why these three: Rajdhani 400 is the `body` face. Share Tech Mono 400 is used by the header subtitle, `.section-label`, `.param-group label` and the inputs. Orbitron 900 is the `<h1>`. Orbitron 700 and Rajdhani 600 are left to normal discovery, so preloads stay capped at 3 and don't compete with the CSS and entry JS.
2. `crossorigin` is **required**. Without it the preload is fetched in no-cors mode, `@font-face` can't reuse it, and the font downloads twice.
3. Check that `vite build` rewrites the preload `href`s to the same `/ballistics/assets/<name>-<hash>.woff2` URLs that the built CSS references. If Vite leaves them untouched, inject the links from a `transformIndexHtml` hook (`order: 'post'`) in `vite.config.js` that looks up the emitted file names in `ctx.bundle`. Don't move the fonts to `public/`, because `serviceWorkerPlugin` only precaches bundled assets (PERF-2).
4. Add `tests/index-html.test.js` (Node-side, `fs` read only). It asserts the three preload tags exist with `as="font"`, `type="font/woff2"` and `crossorigin`.

**Coverage:** HTML only, plus a file-reading test. The JS coverage denominator is unchanged.

**Acceptance:**
- In `dist/index.html`, each of the three preload `href`s **exactly matches** a font URL referenced in `dist/assets/*.css`.
- DevTools → Network (cold cache, Fast 4G): each preloaded font is requested **once**, at Highest priority, with `index.html` as the initiator. The console has no "preloaded but not used within a few seconds" warning.
- The header text no longer swaps visibly on a throttled cold load. Attach before and after filmstrip screenshots to the PR.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-6 · Audit and drop unused font weights · FE · Size S~~ ✅ Done (PR #119)

`ballistics.css` declares 9 `@font-face` faces (123 KB). The PERF-2 SW precaches **every** woff2 Vite emits, so every visitor downloads all 9 on SW install. A preliminary audit found no rule that uses Rajdhani 300 or 500. Rajdhani 700 is only requested for a `✓` glyph that falls outside the faces' `unicode-range`.

**Contract:** [`contracts/perf6-font-audit.md`](contracts/perf6-font-audit.md) v1.0.0 (2026-11-16)

**Work items:**
1. Build the family × weight usage matrix from CSS rules (resolving inheritance), UA-default bold elements, inline `style=` attributes, JS-generated markup and Chart.js canvas `font` configs. The method is in contract §3.1. Put the matrix in the PR description.
2. For each face with zero use, delete its `@font-face` block and `git rm` its woff2. Expected: `rajdhani-300` and `rajdhani-500`, plus `rajdhani-700` if the audit confirms it's unused.
3. Update the per-family weight comments and the stale file-header comment ("served by Spring Boot").
4. Add `tests/fonts.test.js`. It checks: every `src` exists, no file in `app/fonts/` is orphaned, no duplicate family/weight, and every PERF-5 preload has a matching `@font-face`.

**Coverage:** No app JS changes. The new test reads files only. `npm test` stays at 100/100/100/100.

**Acceptance:**
- `app/fonts/` and `dist/assets/` contain only the faces in use.
- The precache list in `dist/sw.js` no longer contains the deleted faces. The PR states the byte savings.
- Visual check on desktop and at ≤500 px width (screenshots in the PR): no glyph changes weight or falls back to a system font.
- No `.woff2` 404s during a full UI walk-through.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-7 · Vite manual chunk split (physics + vendor) · FE · Size XS~~ ✅ Done (PR #120)

No chunk strategy is configured. `app/ballistics.js` imports `TrajectoryInputError` from `./physics/engine.ts`, so the **main-thread** bundle carries the whole RK4 engine plus the G1/G7/atmosphere tables, even though only the worker runs them. Every UI-only deploy also changes the hash of the single entry chunk.

Vite 8 builds with Rolldown. The object form of `manualChunks` is no longer supported and the function form is deprecated, so use `codeSplitting.groups`.

**Work items:**
1. Create `app/physics/errors.ts` and move `TrajectoryInputError` into it, verbatim. In `engine.ts`, replace the class with `export { TrajectoryInputError } from './errors.ts';` so `engine.worker.ts` and the tests that import from `engine.ts` keep working. Point `app/ballistics.js` and `app/physics/engine-async.ts` at `./physics/errors.ts` and `./errors.ts`. Add `app/physics/errors.ts` to `collectCoverageFrom` in `package.json`.
2. In `vite.config.js`, add:
   ```js
   build: {
     // …PERF-4 keys…
     rolldownOptions: {
       output: {
         codeSplitting: {
           groups: [
             { name: 'vendor',  test: /[\\/]node_modules[\\/](chart\.js|@kurkle)[\\/]/, priority: 20 },
             { name: 'physics', test: /[\\/]app[\\/]physics[\\/]/,                     priority: 10 },
           ],
         },
       },
     },
   },
   ```
   Check the option name against the installed Rolldown type definitions (`OutputOptions`). If this Vite 8 release only exposes `advancedChunks`, use that with the same `groups` shape.
3. Keep the `vendor` test **narrow**. A broad `/node_modules/` can pull Vite's preload helper or modulepreload polyfill into `vendor`. That makes `vendor` a static dependency of the entry, so Chart.js would load eagerly again and PERF-3 would regress.
4. Don't add groups under `worker`. The worker is already its own bundle.

**Coverage:** `errors.ts` is covered by the existing `TrajectoryInputError` tests. `npm test` stays at 100/100/100/100.

**Acceptance:**
- `dist/assets/` contains `vendor-*.js` (Chart.js) and `physics-*.js`.
- `dist/index.html` has no `modulepreload` for the `vendor` chunk, and the entry chunk has no static import of it. Network shows Chart.js fetched only on the first Compute.
- The entry and `physics` chunks contain no drag-table data (grep for a distinctive G1 table constant). Only the worker chunk does. The PR states the entry-JS byte reduction.
- If two builds differ only in a change to `app/ballistics.js`, only the entry chunk hash changes. `vendor-*` and `physics-*` hashes stay the same.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-8 · Binary search in `interpolateDragTable` · FE · Size S~~ ✅ Done (PR #121)

`interpolateDragTable` (`app/physics/engine.ts:68`) scans the 40–45-row drag table linearly. It runs 4 times per RK4 step in both the 64-pass zero-angle bisection and the trajectory integration, which is tens of thousands of calls per bullet.

**Contract:** [`contracts/perf8-binary-search.md`](contracts/perf8-binary-search.md) v1.0.0 (2026-11-16)

**Work items:**
1. Replace the linear loop with a lower-bound binary search over `[1, n-1]`. It must pick the **same** bracket as the scan: the smallest `i` with `|v| <= table[i][0]`.
2. Keep the clamps, the `NaN → NaN` result (now an explicit `Number.isNaN` guard) and the exact arithmetic order `a[1] + t * (b[1] - a[1])`, so output stays bit-identical.
3. Write the precondition (table `v` strictly ascending) in the JSDoc.
4. Leave the signature, the `DragTable` type and every caller unchanged.

**Coverage:** 100% Jest. Add an equivalence property test against a verbatim copy of the old linear scan, compared with `Object.is` on breakpoints, ±ε around them, midpoints, signed zeros, ±Infinity, `NaN` and 10 000 seeded-PRNG samples on both tables. Also add 2- and 3-row edge tables and a strictly-ascending check on `G1_TABLE`/`G7_TABLE`. The SPA-1 golden fixture must pass **without** being regenerated.

**Acceptance:**
- No linear loop remains in `interpolateDragTable`.
- The golden fixture and the equivalence test pass.
- The PR description gives the median of 5 runs of a 10-bullet, 2 000 m, 1 m-step `simulate()`, before and after. "After" is not slower.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-9 · Memoize Chart.js dynamic import and registration · FE · Size XS~~ ✅ Done (PR #122)

`renderResults` (~line 682) and `renderSweepCharts` (~line 1062) each run `await import('chart.js')` plus `Chart.register(...)` on every render. On a cold cache, the chunk fetch starts only **after** the worker returns. A failed chunk load causes an unhandled rejection inside an un-awaited `requestAnimationFrame` callback, so the user gets no charts and no message.

**Contract:** [`contracts/perf9-chart-memoize.md`](contracts/perf9-chart-memoize.md) v1.0.0 (2026-11-16)

**Work items:**
1. Add a module-level `loadChart()` that imports and registers the 7 components once, caches the promise, and **resets the cache on rejection** so the next call retries. Add `_resetChartLoader()` for tests and export both.
2. Replace both inline import/register pairs with `await loadChart()`.
3. Add `warmChart()`, which calls `loadChart().catch(_noop)`. Call it in `runSimulation`, `runCustom` and `runSweep` **before** awaiting the worker, so the chunk download overlaps the computation.
4. When the loader fails, `renderResults` shows "Couldn't load the chart library. Check your connection and try again." through `_setSimulationError`, skips the charts, and still renders the data table and DOPE card. `renderSweepCharts` shows the same message and returns.
5. Add `_setSimulationError(null)` at the start of `runCustom` and `runSweep`, so a stale error clears.

**Coverage:** 100% Jest. Tests: `Chart.register` is called exactly once across repeated renders, the cache resets after a failure, both renderer failure paths, the warm-up runs before the worker resolves, warm-up failures are swallowed, and the error clears. Contract §4 has the full list.

**Acceptance:**
- `app/ballistics.js` contains exactly one `import('chart.js')` and one `Chart.register`.
- On a cold cache, the Chart.js chunk request starts before the worker result returns.
- Offline with Chart.js not yet cached: you see the error message plus the data table and no uncaught error. Going back online and clicking Compute again renders the charts.
- `dist/index.html` still has no modulepreload for Chart.js.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-10 · `content-visibility: auto` on lazy result sections · FE · Size XS~~ ✅ Done (PR #123)

Each run renders 5 `.chart-panel`s (3 per sweep) into the scrolling `.chart-container`, but only 1–2 are on screen. All of them get style, layout and paint, both on the first render and on every crosshair hover, because `onHover` calls `update('none')` on every chart.

**Work items:**
1. In `app/ballistics.css`, add to `.chart-panel`:
   ```css
   content-visibility: auto;
   contain-intrinsic-size: auto 332px; /* chart-h 240 + padding 40 + header ~34 + gap 16 + border 2 */
   ```
   Measure the real panel height in DevTools and use that number. Inside the existing `@media (max-width: 900px)` and `@media (max-width: 500px)` blocks that change `.chart-wrap` height, override `contain-intrinsic-size` with the measured heights (about `auto 292px` and `auto 272px`).
2. Don't apply it to `.stats-grid`, `.range-readout` (positioned or sticky), table rows (`content-visibility` doesn't reliably apply to table-internal boxes) or `.tool-card` (that panel is `display:none` until it's opened).
3. Don't change any JS. Chart.js still draws to every canvas; only browser rendering of off-screen panels is skipped.

**Coverage:** CSS only. The JS coverage denominator is unchanged.

**Acceptance:**
- DevTools Performance: on a 5-bullet run, and while the crosshair hovers, Rendering/Painting time is lower than before. Attach before and after traces or summaries to the PR.
- Scrolling down shows every chart fully drawn at the correct size. The scrollbar thumb doesn't jump visibly as panels come into view.
- PNG export of a chart that hasn't been scrolled into view gives a correct, non-blank image.
- Crosshair hover and pin stay in sync across all charts, including off-screen ones once they're scrolled into view.
- Find-in-page (Ctrl/Cmd+F) finds the "WIND DRIFT" title while it's off-screen.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-11 · Passive event listeners for scroll and touch · FE · Size XS~~ ✅ Done (PR #124)

An audit on 2026-11-16 found **no** `scroll` or `wheel` listeners. It found exactly two `touchmove` listeners, both on chart canvases in `renderResults` (`app/ballistics.js` ~758 and ~856). They are registered `{ passive: false }` and call `preventDefault()` so the page doesn't scroll while the user scrubs a chart. Non-passive touch listeners make the compositor wait for the main thread, and Lighthouse flags them.

**Work items:**
1. Add `.chart-wrap canvas { touch-action: none; }` to `app/ballistics.css`. The browser then stops page panning on chart canvases without any JS involved. Users see the same behaviour as today, where `preventDefault` already blocks the scroll.
2. Replace the two inline forwarders with one helper, `forwardTouchAsMouse(canvas)`. It registers `touchmove` with `{ passive: true }`, **doesn't** call `preventDefault()`, and dispatches the synthetic `mousemove` exactly as today. Export it for tests and use it at both sites.
3. Repeat the audit and paste the output into the PR: `grep -rnE "addEventListener\(\s*'(scroll|wheel|mousewheel|touchstart|touchmove|touchend|touchcancel|pointermove)'" app/`. Any new match must be `{ passive: true }`. The only exception is a listener that genuinely calls `preventDefault()`, which needs a comment explaining why.
4. Don't change Chart.js's own `events` options. Chart.js already registers its listeners as passive.

**Coverage:** 100% Jest. Tests: the helper registers `touchmove` with `{ passive: true }` (spy on `addEventListener`), a dispatched `touchmove` produces one `mousemove` with the touch's `clientX`/`clientY`, `preventDefault` is not called, and both chart creation paths use the helper.

**Acceptance:**
- The Lighthouse "Uses passive listeners to improve scrolling performance" audit passes.
- On a real touch device (iOS Safari and Android Chrome), scrubbing a chart moves the crosshair and readout and doesn't scroll the page, the same as before.
- Scrolling the page outside the charts is unaffected.
- `npm test` passes at 100/100/100/100.

> Follow-up, needs user input and is not in scope: `touch-action: pan-y` would let users scroll vertically over charts while still scrubbing horizontally. It's a UX change, so raise it as its own story if you want it.

---

### ~~PERF-12 · Service Worker NavigationPreload · FE · Size S~~ ✅ Done (PR #125)

`app/sw.js` serves navigations network-first, but the `fetch` can't start until the SW has booted. Idle SWs are stopped often, especially on mobile, so every repeat visit pays the boot time before `index.html` is even requested. Navigation Preload sends the request at the same time as SW boot.

**Contract:** [`contracts/perf12-sw-nav-preload.md`](contracts/perf12-sw-nav-preload.md) v1.0.0 (2026-11-16)

**Work items:**
1. Add and export `enableNavigationPreload(registration)`. It feature-detects `registration.navigationPreload`, calls `enable()`, never throws, and returns a boolean.
2. Have `handleActivate()` call `await enableNavigationPreload(self.registration)` after the old-cache cleanup and before `clients.claim()`.
3. Give `networkFirstCacheFallback(request, preloadResponse?)` the response `(await preloadResponse) ?? await fetch(request)`. Keep the existing `response.ok` cache-put and the cache/503 fallback. A rejected preload (offline) goes to the fallback.
4. Have `handleFetch`'s navigate branch pass `event.preloadResponse`. Non-navigate requests stay unchanged.
5. Keep the `vite.config.js` substitution anchors (`let CACHE_VERSION = 'v1';`, `'__VITE_PRECACHE_MANIFEST__'`) byte-identical.

**Coverage:** 100% Jest (`tests/sw.test.js`, Node environment). Tests: all four `enableNavigationPreload` outcomes, the activate ordering, and that the preload is used without calling `fetch`. Also: an `undefined` preload falls back to `fetch`, a non-ok preload isn't cached, a rejected preload uses the cache or returns 503, the navigate branch passes `preloadResponse`, and non-navigate requests ignore it.

**Acceptance:**
- `(await navigator.serviceWorker.ready).navigationPreload.getState()` reports `enabled: true` after activation.
- After stopping the SW in DevTools and reloading, the document request carries `Service-Worker-Navigation-Preload: true` and starts before the SW finishes booting.
- An offline reload still serves the cached app (PERF-2 behaviour).
- The console has no "preload request was cancelled" warning.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-13 · CI Vite build-cache via `actions/cache` · DevSecOps · Size XS~~ ✅ Done (PR #126)

`ci.yml` caches `~/.npm` but no build or test intermediates. Vite documents `node_modules/.vite` as the dev-server dependency pre-bundling cache, so it's **not yet established** that `vite build` reads it. This story measures first and only merges a cache that pays off.

**Work items:**
1. **Measure.** Run `rm -rf node_modules/.vite && npm run build` and then `npm run build` again, 3 times each, locally or in a scratch CI run. Record whether `vite build` creates or reads `node_modules/.vite` and the median build-step times.
2. **If** the warm build is ≥10% faster, add a cache step to both `frontend-build` and `pages-build`, placed **after** `Install` (because `npm ci` deletes `node_modules`) and before `Build`:
   ```yaml
   - name: Cache Vite build cache
     if: needs.changes.outputs.frontend == 'true'   # omit in pages-build
     uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25 # v5
     with:
       path: node_modules/.vite
       key: ${{ runner.os }}-vite-${{ hashFiles('package-lock.json', 'vite.config.js') }}
       restore-keys: ${{ runner.os }}-vite-
   ```
3. **Otherwise**, don't add a cache that does nothing. Cache Jest's babel transform cache in `frontend-build` instead. Change the test step to `npm test -- --ci --cacheDirectory=.jest-cache`, add an `actions/cache` step (same pinned SHA) for `.jest-cache` keyed on `hashFiles('package-lock.json', 'babel.config.js', 'tsconfig.json')`, and add `.jest-cache/` to `.gitignore`. Measure the `Test` step the same way.
4. Reuse the existing SHA-pinned `actions/cache`. Don't add any new action.
5. Don't cache `node_modules` itself, because it bypasses the `npm ci` integrity check.

**Coverage:** No app code changes, so coverage is unchanged.

**Acceptance:**
- The PR description has the step-1 measurement and states which branch (2 or 3) was taken, with before and after medians for the affected step.
- A second CI run on the PR logs a cache hit for the new key.
- No merged cache step saves less than 10% on the step it targets.
- CI passes. The deployed site is byte-identical apart from the SW `CACHE_VERSION` timestamp.
- `npm test` passes at 100/100/100/100.

---

## Sprint 10 — Physics Completeness & Accessibility

**Sprint Goal:** Spin drift and Coriolis are computed by the engine and appear in charts, data table, and DOPE card; the custom drag CSV changes the trajectory; the bullet selector is fully usable with a keyboard or screen reader; density altitude appears in stat cards.

Stack order for physics stories: FEAT-1 → FEAT-2 → FEAT-3 (all three touch `app/physics/engine.ts`, `app/physics/types.ts`, and `tests/fixtures/spa1-golden.json`; merge in sequence). UX-6 may merge independently before FEAT-3. ACC-1, ACC-2, UX-5, and DM-1 are fully independent and can run in parallel.

---

### FEAT-1 · Gyroscopic spin drift in physics engine and data table · FE · Size S · DONE (PR #139)

The barrel twist rate input has existed since Sprint 7 and round-trips through URL state, but the engine marks `twistRateInchesPerTurn` as IGNORED. The chart and readout rendering code already checks for `p.spinDriftCm` and will activate automatically; this story implements the Litz simplified formula in the TypeScript engine, adds `spinDriftCm` to `TrajectoryPoint`, and adds the missing "Spin Drift (cm)" header to the data table.

**Work items:**

1. In `app/physics/types.ts`, add `spinDriftCm: number` as the last field on `TrajectoryPoint`. It is a primitive (never optional): `0` when twist rate is absent; positive = rightward for a right-hand-twist barrel.
2. In `app/physics/engine.ts`, compute the Litz simplified formula inside `integrateTrajectoryFps`. Compute once before the loop:
   - `SG = (150 × d_in³) / (twist² × massGr × 21.25)` where `d_in = bullet.bulletDiameterMm / 25.4`, `massGr = bullet.bulletWeightGrams × 15.4324`, and `21.25 = 1 + 4.5²` (fixed L/d = 4.5 approximation).
   - Per point: `spinDriftCm = round1(1.25 × (SG + 1.2) × tof^1.83 × rangeMeters × π / 10800 × 100)`.
   - `spinDriftCm = 0` when `twistRateInchesPerTurn` is null/absent.
3. Remove the `IGNORED` comment from `twistRateInchesPerTurn` on `TrajectoryParams` in `types.ts`. Thread the value from `simulate()` into `integrateTrajectoryFps`; add it as an optional trailing parameter to avoid breaking existing test call sites.
4. In `app/index.html` `#dataTable`, add `<th id="spinDriftColHeader" style="display:none">Spin Drift (cm)</th>` immediately before the existing `id="coriolisColHeader"` column header.
5. In `app/ballistics.js` `renderTable()`, mirror the existing `showCoriolis` pattern: `const showSpinDrift = results.some(r => r.points.some(p => p.spinDriftCm !== 0))`. Show/hide `#spinDriftColHeader` and emit the cell formatted as `+3.2 cm` (sign-prefixed, 1 decimal) in each row.
6. Update `tests/fixtures/spa1-golden.json`: add `"spinDriftCm": 0` to every point (the golden run sends no twist rate; all zeros are correct).

**Coverage:** 100% Jest. Tests: (a) twist rate 1:10, `.308 Win 168gr`, 500 m — `spinDriftCm` is in the range 3–6 cm; (b) no twist rate — all `spinDriftCm = 0`; (c) `renderTable` shows the column when non-zero and hides it when all-zero; (d) golden fixture still passes.

**Acceptance:**
- `.308 Win 168gr`, 1:10 twist, 1 000 m: `spinDriftCm` ≈ 15–25 cm at 1 000 m.
- No twist rate: all `spinDriftCm = 0`, "Spin Drift (cm)" column hidden in data table.
- Spin drift dashed series appears on the wind drift chart (existing `hasSpinDrift` guard activates).
- Range readout shows "Spin Drift: X.X cm" cell when non-zero.
- `npm test` passes at 100/100/100/100.

**Out of scope:** Left-hand twist (negative values), bullet-length input for exact L/d, DOPE card spin drift column (UX-4).

---

### FEAT-2 · Coriolis deflection in physics engine · FE · Size S ✓ Done

The latitude and azimuth inputs were added in Sprint 7 and encoded in URL state. The engine marks both RESERVED. The chart, range readout, data table column, and DOPE card rendering code **all already conditionally handle `coriolisDeflectionCm`**; they never activate because the engine never produces the field.

**Work items:**

1. In `app/physics/types.ts`, add `coriolisDeflectionCm: number` as the last field on `TrajectoryPoint` (after `spinDriftCm`). Primitive, never optional: `0` when `latitudeDeg` is absent.
2. In `app/physics/engine.ts` `integrateTrajectoryFps`, after spin drift:
   - `coriolisDeflectionCm = 0` when `latitudeDeg` is null/undefined.
   - Otherwise: `const OMEGA = 7.2921e-5; const deflM = OMEGA * Math.sin(latitudeDeg * Math.PI / 180) * muzzleVelocityMps * tof * tof; coriolisDeflectionCm = round1(deflM * 100);`
   - Positive = right of bore (Northern Hemisphere). `azimuthDeg` is accepted but does not appear in this first-order formula.
3. Remove the `RESERVED, IGNORED` comments from `latitudeDeg` and `azimuthDeg` on `TrajectoryParams`. Thread `latitudeDeg` into `integrateTrajectoryFps` as a trailing optional parameter.
4. Update `tests/fixtures/spa1-golden.json`: add `"coriolisDeflectionCm": 0` to every point (golden run has no latitude).

**Coverage:** 100% Jest. Tests: (a) `.338 Lapua 250gr`, latitude 45°, 2 000 m — `coriolisDeflectionCm` ≈ 20–25 cm; (b) latitude −33° — all values negative; (c) latitude 0 or absent — all zeros; (d) golden fixture passes.

**Acceptance:**
- `.338 Lapua 250gr`, latitude 45°, 2 000 m: `coriolisDeflectionCm` ≈ 20–25 cm.
- Latitude −33°: all `coriolisDeflectionCm` values are negative.
- No latitude: all zeros; Coriolis chart series, data table column, and DOPE card column remain hidden.
- Setting latitude makes the DOPE card "Cor. (cm)" column appear (existing code activates without further changes).
- `npm test` passes at 100/100/100/100.

**Out of scope:** Higher-accuracy per-step velocity integral, azimuth-dependent magnitude, DOPE card spin drift column (UX-4).

---

### FEAT-3 · Wire custom drag CSV to physics engine · FE · Size M ✅ Done (PR #144)

The Custom Round panel has had a drag table CSV uploader since before Sprint 1. The engine marks `customDragTable` as RESERVED and ignores it — every trajectory still uses G1 or G7 regardless of what the user uploads.

**Engine work is delivered by FEAT-3 (PR #144). §6 UI copy (MODEL pill + drag-table help text) was intentionally deferred from #144 and completed in a follow-up PR (PR #145). `contracts/wa12-custom-drag.md` §2–§4 (Rust/Java) remain on hold.**

**Work items:**

1. In `app/physics/engine.ts` `simulate()`, when `params.customDragTable` is non-null and `.length >= 3`:
   - Convert each `{ mach, cd }` entry to `[fps, cd]` using `fps = mach * SOUND_FPS` (existing constant: 1125). Sort ascending by fps.
   - Pass the converted table to `findZeroAngleFps` and `integrateTrajectoryFps` instead of the G1/G7 reference table.
2. Add custom drag table validation inside `validate()`: `customDragTable.length >= 3` (throw `TrajectoryInputError` on `'customDragTable'`); every `mach` ∈ [0, 5] and every `cd > 0`.
3. In `app/physics/types.ts`, remove the `RESERVED, IGNORED` comment from `customDragTable` on `TrajectoryParams`.
4. Update help text in three places (matches UX-6; merge UX-6 first or together):
   - `app/index.html` `#dragTableHelp` → `"Mach,CD columns. Overrides G1/G7 drag when loaded."`
   - `app/ballistics.js` `_updateDragTableStatus()` → same string.
   - `app/ballistics.js` `_clearCustomDragTable()` → same string.

**Coverage:** 100% Jest. Tests: (a) sample table produces different `dropCm` than G1 for the same params; (b) table with 2 entries throws `TrajectoryInputError` on `'customDragTable'`; (c) table with `mach = 6` throws; (d) `customDragTable: null` or `[]` — G1 behavior byte-identical to current.

**Acceptance:**
- Uploading a sample custom table and clicking "Compute Custom" produces a trajectory different from G1 at supersonic ranges.
- An uploaded table with fewer than 3 rows shows the existing inline validation error; no trajectory is computed.
- Clearing the custom drag table reverts to G1 behavior.
- Help text reads "Mach,CD columns. Overrides G1/G7 drag when loaded." — no "server update" text anywhere.
- `npm test` passes at 100/100/100/100.

**Out of scope:** Custom drag for catalog bullets (Custom Round panel only), G7-indexed CSV format.

---

### UX-6 · Remove stale "server update" drag table help text · FE · Size XS ✅ Done (PR #130)

The drag table help text reads "Stored for future use — drag model override requires server update" in three places. The server was removed in Sprint 5 (SPA-3). CLN-1 fixed `app/drag-csv.js` but missed `app/ballistics.js` (two functions) and `app/index.html`. With FEAT-3 shipping this sprint the custom drag table is live; the copy must be accurate before it merges.

**Work items:**

1. `app/index.html` `#dragTableHelp` initial text → `"Mach,CD columns. Overrides G1/G7 drag when loaded."`.
2. `app/ballistics.js` `_updateDragTableStatus()` `helpEl.textContent` assignment → same string.
3. `app/ballistics.js` `_clearCustomDragTable()` `helpEl.textContent` assignment → same string.
4. Update any assertion in `tests/ballistics.test.js` that checks the old help text string.

**Coverage:** No new logic. Update text assertions in existing tests only.

**Acceptance:**
- `git grep -rn "server update\|stored for future use" app/` returns zero results.
- Help text in the Custom Round section reads "Mach,CD columns. Overrides G1/G7 drag when loaded."
- `npm test` passes at 100/100/100/100.

---

### ~~ACC-1 · Keyboard-navigable bullet selector · FE · Size S~~ — DONE

Bullet selection cards are `<div>` elements with click listeners only. They are unreachable by Tab and cannot be activated with Enter or Space. A keyboard-only user or screen reader user cannot select a round without a mouse.

**Work items:**

1. In `app/ballistics.js` `renderBulletList()`, add `role="checkbox"`, `tabindex="0"`, and `aria-checked="false"` (or `"true"` for pre-selected cards) to each card `<div>`.
2. In `updateBulletCards()`, toggle `aria-checked` between `"true"` and `"false"` in sync with the `.active` class.
3. In `renderBulletList()`, alongside each card's `click` listener, add a `keydown` listener: when `key === 'Enter' || key === ' '`, call `toggleBullet(b.id)` and `e.preventDefault()`.
4. In `app/custom-bullets.js` `renderCustomBulletGroup()`, apply the same `role="checkbox"`, `tabindex="0"`, `aria-checked`, and `keydown` pattern to custom bullet cards.
5. In `app/ballistics.css`, add an explicit `:focus-visible` rule to `.bullet-card`: `outline: 2px solid #00d4ff; outline-offset: 2px;`.

**Coverage:** 100% Jest. Tests: (a) `keydown` Enter calls `toggleBullet`; (b) `keydown` Space calls `toggleBullet` and calls `e.preventDefault()`; (c) `aria-checked` is `"true"` after selecting and `"false"` after deselecting; (d) rendered cards have `tabindex="0"`.

**Acceptance:**
- Tabbing through the sidebar reaches every built-in and custom bullet card in sequence.
- Pressing Enter or Space on a focused card toggles its selection.
- Focus ring (`:focus-visible` outline) is visible in Chrome, Firefox, and Safari.
- `npm test` passes at 100/100/100/100.

**Out of scope:** Arrow-key roving tabindex within the bullet list, grouping bullets under a `role="group"` container.

---

### UX-4 · Spin drift column in trajectory table · FE · Size S · DONE (PR #TBD)

Add `spinDriftCm` from FEAT-1 to the trajectory data table and per-range readout in `ballistics.js`.

**Delivered:**
- `app/index.html`: added `<th id="spinDriftColHeader">` before the Coriolis header
- `app/ballistics.js` `renderTable`: shows/hides "Spin Drift (cm)" column when any point has `spinDriftCm > 0`
- `app/ballistics.js` `updateReadout`: existing code verified correct — shows "Spin Drift: X.X cm" cell when `spinDriftCm > 0`
- 3 new Jest tests for `renderTable` spin drift; `updateReadout` spin drift tests already present

**Dependencies: FEAT-1**

---

### ~~UX-5 · Density altitude in result stat cards · FE · Size XS~~ DONE

The stat card template in `renderStatCards` already conditionally renders `r.densityAltitudeMeters` as "X m density alt", but `TrajectoryResult` has no such field and the branch is dead code today. Density altitude converts altitude plus temperature into a single number describing how the air behaves relative to sea level.

**Work items:**

1. In `app/physics/types.ts`, add `densityAltitudeMeters: number` to `TrajectoryResult`.
2. In `app/physics/engine.ts` `simulate()`, compute density altitude before the return statement:
   ```ts
   const isa = 15 - 0.0065 * params.altitudeMeters;   // ISA temperature at altitude (°C/m lapse)
   const densityAltitudeMeters = Math.round(params.altitudeMeters + 36.2 * (params.temperatureC - isa));
   // 36.2 = 118.8 ft/°C × 0.3048 m/ft
   ```
3. No change to `renderStatCards` needed — the existing `r.densityAltitudeMeters !== undefined` conditional fires automatically.

**Coverage:** 100% Jest. Tests: (a) sea level 15°C → `densityAltitudeMeters ≈ 0`; (b) 1 500 m, 35°C → `densityAltitudeMeters > 1 500`; (c) stat card HTML contains the "density alt" string after simulation.

**Acceptance:**
- Stat cards show "X m density alt" after simulation for all runs.
- Sea level, ISA conditions: density altitude ≈ 0 m.
- 1 500 m, 35°C: `densityAltitudeMeters` noticeably greater than 1 500.
- `npm test` passes at 100/100/100/100.

---

### ~~ACC-2 · Screen reader announcements for simulation lifecycle · FE · Size XS~~ ✓ DONE

A screen reader user clicking "Compute Trajectories" receives no feedback that the simulation is running or complete. `#simulationError` handles errors (`aria-live="assertive"`) and `#toast` handles toasts, but neither fires for in-progress or success states.

**Work items:**

1. In `app/index.html`, add a visually-hidden live region:
   ```html
   <div id="simStatus" class="sr-only" aria-live="polite" aria-atomic="true"></div>
   ```
2. In `app/ballistics.css`, add `.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }` if not already present.
3. In `runSimulation()`: set `#simStatus` to `"Computing trajectories…"` at entry; on success set it to `"Simulation complete. ${results.length} bullet(s) computed to ${req.maxRangeMeters} m."`; on error clear it. Apply the same pattern to `runCustom()` and `runSweep()`.

**Coverage:** 100% Jest. Tests: (a) `#simStatus` reads "Computing trajectories…" at start; (b) reads success string after render; (c) is cleared on error.

**Acceptance:**
- VoiceOver/NVDA announces "Computing trajectories…" when Compute is clicked.
- Announces a completion message when charts and table render.
- `npm test` passes at 100/100/100/100.

---

### ~~DM-1 · Re-import previously exported trajectory JSON · FE · Size S~~ — DONE (PR #TBD)

Users can export trajectory results as JSON but have no way to reload a saved session. The exported JSON file contains everything needed to redisplay the results.

**Work items:**

1. In `app/index.html`, add a hidden file input and visible import button near the export dropdown:
   ```html
   <input type="file" id="importJsonFile" accept=".json,application/json"
          style="display:none" aria-label="Import trajectory JSON">
   <button class="export-toggle" id="importJsonBtn">↑ IMPORT JSON</button>
   ```
2. In `app/ballistics.js`, wire `#importJsonBtn` to click `#importJsonFile`. On `change`: read with `FileReader.readAsText`, `JSON.parse` in a try/catch, validate structure (non-empty array, each element has `bullet.id`, `bullet.name`, `points`, `request`), call `_setSimulationError` on any failure.
3. On success: set `lastResults = parsed`, `lastReq = parsed[0].request`, call `renderResults(parsed, lastReq)`, reveal `#exportCsvBtn`. Do not re-simulate.
4. Import button always visible (not gated on existing results).

**Coverage:** 100% Jest. Tests: (a) valid JSON restores `lastResults` and calls `renderResults`; (b) non-array JSON shows error; (c) element missing `points` shows error; (d) `JSON.parse` failure shows error; (e) export buttons produce valid output on imported results.

**Acceptance:**
- Export a 2-bullet run to JSON then import it — identical charts and data table result.
- Importing a CSV (wrong format) shows error and leaves existing results intact.
- After import all three export formats produce valid output.
- `npm test` passes at 100/100/100/100.

**Out of scope:** Merging imports with existing results, importing CSV or from a URL, re-running simulation from imported data.

---

### ~~PERF-14 · Warm physics worker on idle · FE · Size XS~~ ✓ Done

The physics Web Worker is created lazily on the first `simulateAsync()` call. Worker startup on a mid-range mobile is 20–60 ms. Triggering `_getWorker()` during the idle period after `init()` completes removes that startup cost from the critical path of the first click.

**Work items:**

1. In `app/physics/engine-async.ts`, add and export `export function warmWorker(): void { try { _getWorker(); } catch (_) {} }`.
2. In `app/ballistics.js` `init()`, after the initial render:
   ```js
   const ric = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 100));
   ric(() => warmWorker());
   ```
3. `warmWorker` must not throw when Worker creation fails.

**Coverage:** 100% Jest. Tests: (a) `warmWorker` invokes the worker factory exactly once; (b) second call does not create a second worker (singleton); (c) does not throw when creation fails.

**Acceptance:**
- After page load (before any Compute click), the Worker instance exists.
- Worker startup cost does not appear on the critical path of the first Compute click.
- `npm test` passes at 100/100/100/100.

---

### ~~DX-3 · VS Code workspace settings · DX · Size XS~~ ✅ Done (PR #131)

The repo has no `.vscode/` directory. Developers opening the project in VS Code get no TypeScript path resolution, no recommended extensions, no task shortcuts, and the editor may index `dist/`, `node_modules/`, and `.claude/worktrees/` unnecessarily. This is a one-time setup cost that affects every contributor from their first checkout.

**Work items:**

1. Create `.vscode/settings.json`:
   - `"typescript.tsdk": "node_modules/typescript/lib"` — use the project's own TypeScript, not VS Code's bundled version.
   - `"editor.formatOnSave": false` — the project has no formatter configured; don't auto-corrupt files.
   - `"search.exclude"` and `"files.exclude"`: add `dist/`, `coverage/`, `.jest-cache/`, `.claude/worktrees/`, `node_modules/`.
   - `"jest.jestCommandLine": "npm test --"` — if the Jest extension is installed, point it at the npm script.
   - `"typescript.preferences.importModuleSpecifier": "relative"`.
2. Create `.vscode/extensions.json` with `"recommendations"`:
   - `"dbaeumer.vscode-eslint"` (if an ESLint config is ever added)
   - `"esbenp.prettier-vscode"` (if Prettier is ever added)
   - `"orta.vscode-jest"` — Jest test runner sidebar.
   - `"antfu.vite"` — Vite project support.
   - `"ms-vscode.vscode-typescript-next"` — latest TS language service.
3. Add `.vscode/` to `.gitignore`? No — commit it. These are project-level settings, not personal overrides. Personal overrides go in `.vscode/*.code-workspace` (gitignored).
4. Verify: open the repo in VS Code, check that TypeScript "Go to Definition" works for imports in `app/physics/engine.ts`, that the Jest sidebar shows tests, and that `dist/` and `.claude/` are absent from the Explorer tree.

**Coverage:** No app code changes; no test changes needed.

**Acceptance:**
- `git show HEAD:.vscode/settings.json` and `.vscode/extensions.json` are present and valid JSON.
- Opening `app/physics/engine.ts` in VS Code shows no "Cannot find module" errors.
- `dist/`, `coverage/`, `.jest-cache/`, and `.claude/worktrees/` do not appear in the VS Code Explorer or search results.
- `npm test` passes at 100/100/100/100 (no test changes).

---

### ~~UX-8 · Chart.js tooltip with many bullets · FE · Size S~~ ✅ Done

When 6 or more bullets are selected and the user hovers over the trajectory charts, the tooltip renders one item per dataset per chart — easily 10–15 lines for a full bullet selection — overflowing the viewport and obscuring the chart data the user is trying to read. The issue is that `interaction: { mode: 'index' }` shows all series at the hovered x-position simultaneously.

**Work items:**

1. In `app/ballistics.js`, in the trajectory chart options (the `buildChartConfig` helper, or wherever `interaction` is set for the main drop/velocity charts), change the tooltip filter strategy:
   - Keep `mode: 'index'` so all series fire (the crosshair plugin needs this), but add a `tooltip.filter` callback that limits displayed items to the **nearest 4 datasets** to the cursor's y-position (sorted by `Math.abs(item.parsed.y - pointerY)`). Pass `pointerY` through the `external` context or capture it in `onHover`.
   - Alternatively, if `filter` alone is sufficient: limit to `item.datasetIndex < maxVisible` where `maxVisible = Math.min(datasets.length, 5)`.
   - Add a `tooltip.footer` callback that, when datasets exceed the limit, appends `"+ N more"` so the user knows they're not seeing all series.
2. Apply the same change to the wind drift chart and the sweep chart.
3. Add a `tooltip.callbacks.label` that trims the bullet name to 20 characters with `…` to prevent long custom-bullet names from causing overflow.
4. If a `maxWidth` CSS constraint on `.chartjs-tooltip` exists (or if Chart.js allows `options.plugins.tooltip.boxWidth`), set a max-width of `280px`.

**Coverage:** 100% Jest. Tests: (a) `tooltip.filter` with 8 datasets returns at most 5 items; (b) `footer` callback appends `"+ 3 more"` when 8 datasets are present and filter cap is 5; (c) label callback truncates a 30-character bullet name to `"…"` at 20 chars.

**Acceptance:**
- With 8 bullets selected, hover shows at most 5 tooltip rows plus a `"+ 3 more"` footer.
- With 3 bullets selected, all 3 rows are shown and no footer appears.
- Tooltip never overflows the chart canvas boundary.
- Crosshair line and range readout still update for all visible series on hover.
- `npm test` passes at 100/100/100/100.

---

### ~~UX-9 · Light / dark mode toggle · FE · Size S~~ ✅ Done (PR #TBD)

The app ships with a fixed dark theme (deep navy/cyan). Users in bright environments or with accessibility needs that prefer high-contrast light backgrounds have no way to switch. The CSS already uses custom properties (`--bg`, `--text`, `--accent`, etc.) on `:root`, making a light theme a matter of overriding those variables. The toggle state persists in `localStorage` and respects `prefers-color-scheme` on first load.

**Work items:**

1. In `app/ballistics.css`, add a `[data-theme="light"]` selector on `:root` that overrides the core colour tokens:
   - `--bg: #f4f6f8; --bg-panel: #ffffff; --bg-raised: #e8ecf0;`
   - `--text: #1a2530; --text-dim: #4a5568; --border: #cbd5e0;`
   - `--accent: #0077b6; --accent-dim: #90caf9;`
   - Adjust chart canvas background (`--chart-bg: #ffffff`) and any hardcoded `#141d26` or `#1e3040` values in inline styles to use CSS variables instead.
2. In `app/index.html`, add a theme toggle button in the top-right of the `<header>`:
   ```html
   <button id="themeToggle" class="theme-btn" aria-label="Toggle light/dark mode" title="Toggle theme">☀</button>
   ```
3. In `app/ballistics.js` `init()`:
   - On load: read `localStorage.getItem('theme')` or fall back to `window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'`. Apply `document.documentElement.dataset.theme = theme`.
   - `#themeToggle` click: toggle between `'light'` and `'dark'`, update `document.documentElement.dataset.theme`, persist to `localStorage`, and update the button icon (`☀` / `☾`).
4. Chart.js chart instances must re-render with updated colours after a theme switch. In the click handler, after applying the theme, call `Chart.instances` and `chart.update('none')` on each active chart (or re-render results if `lastResults` is set).
5. In `app/ballistics.css`, add `.theme-btn` with appropriate sizing and placement.

**Coverage:** 100% Jest. Tests: (a) `init()` reads `localStorage.getItem('theme')` and sets `document.documentElement.dataset.theme`; (b) clicking `#themeToggle` toggles `dataset.theme` between `'light'` and `'dark'`; (c) the new value is written to `localStorage`; (d) on first load with no `localStorage` value, `prefers-color-scheme: light` media query result is used.

**Acceptance:**
- Clicking the toggle visibly switches the UI between dark (default) and light themes.
- Charts re-render with appropriate background and text colours in both themes.
- Theme preference persists across page reloads.
- On first load with no stored preference, `prefers-color-scheme: light` users see the light theme.
- `npm test` passes at 100/100/100/100.

---

### ~~UX-10 · Sticky compute button in sidebar · FE · Size XS~~ DONE

The "COMPUTE TRAJECTORIES" button (`#runBtn`) sits below the entire parameter form in the sidebar — after the bullet list, custom bullet panel, and 10+ parameter inputs. On a typical laptop screen the button is off-screen below the fold when several bullets are selected or the custom bullet form is expanded, requiring users to scroll to the bottom of the sidebar to trigger a simulation.

**Work items:**

1. In `app/ballistics.css`, modify `.sidebar` to use `display: flex; flex-direction: column` (it may already be a flex column; verify). Give the scrollable content area above the button `flex: 1; overflow-y: auto; min-height: 0` via a new wrapper `<div class="sidebar-scroll">`.
2. In `app/index.html`, wrap the content above `#runBtn` in `<div class="sidebar-scroll">` (from the opening `<aside>` content through the end of the parameter form at line ~224). Leave `#runBtn`, `#sweepControls`, `#simulationError`, the export dropdown, and `#copyLinkBtn` outside that wrapper — they stay pinned to the bottom.
3. In `app/ballistics.css`, give the sticky bottom area (`#runBtn` and siblings outside `.sidebar-scroll`) `flex-shrink: 0; padding: 8px var(--space-sm) var(--space-sm)` with a `border-top: 1px solid var(--border)` separator.
4. On mobile (≤ 900 px the sidebar is a bottom drawer), verify the sticky bottom bar still looks correct inside the drawer. The drawer already has its own height constraints; test that the scrollable content doesn't push the button off the bottom edge of the drawer.

**Coverage:** No JS logic change; no test changes needed. If any existing test checks sidebar DOM structure, update the assertions to account for the new `.sidebar-scroll` wrapper.

**Acceptance:**
- `#runBtn` is always visible in the sidebar without scrolling, regardless of how many bullets are in the list or whether the custom bullet panel is expanded.
- The bullet list and parameter form scroll independently within their container.
- On mobile (drawer open), the compute button is visible at the bottom of the drawer when the drawer is fully open.
- Existing layout and spacing is preserved — no content is clipped or overlaps the button.
- `npm test` passes at 100/100/100/100.


---

### Icebox (future sprints)

- **ACC-3 · Arrow-key roving tabindex in bullet list** — Follow-on to ACC-1; Up/Down arrows navigate within the bullet list. 2 pts. ✅ Done
- **FEAT-4 · G7 BC on custom bullets** — Custom bullets with `dragModel: 'G7'` currently use the G1 reference table. Add optional `bcG7` to the custom bullet form. 3 pts.
- **UX-7 · Print-friendly DOPE card** — `@media print` stylesheet + "Print DOPE" button formatted for A5 paper. 3 pts. ✅ Done
- **DX-2 · Named session saves** — Extend URL state module to let users name and persist sessions in `localStorage`. 5 pts.
- **SEC-3 · Content Security Policy header audit** — GitHub Pages does not support custom headers; evaluate `<meta http-equiv="Content-Security-Policy">` or Cloudflare Pages migration. 3 pts.


---

## Sprint 11 — Release Prep (3.0.0)

**Sprint Goal:** By end of sprint the repo is tagged v3.0.0 with a published GitHub Release, a user-readable root `CHANGELOG.md` documenting all changes since the original Java/REST API baseline, the `contracts/` directory contains only current-era documents, and all project documentation accurately reflects the pure-browser SPA.

Merge order: REL-1 first (reduces noise in subsequent diffs). REL-2, REL-3, REL-4, and REL-5 are independent of each other and can run in parallel once REL-1 has landed on main. REL-4 must have REL-2 merged before the GitHub Release is created with release notes.

---

### REL-1 · Delete stale backend/WASM contracts · DX · Size S [Must Have]

The `contracts/` directory carries 28 artefacts from the deleted Java/Spring Boot backend and Rust/WASM engine. They describe interfaces that have not existed since Sprint 5 (SPA-3, PR #92), confuse new contributors about what the project does today, and add surface area to `git grep` and editor indexing. The opening paragraph of `contracts/CHANGELOG.md` still names "springdoc" and the REST API as the subject of that file, which is misleading.

**Work items:**

1. Delete each of the following files from `contracts/` (run from the repo root):
   ```
   git rm contracts/adr-004-wasm-engine.md
   git rm contracts/adr-006-ballistics-engine-crate.md
   git rm contracts/adr-007-rust-backend-framework.md
   git rm contracts/api-hardening.md
   git rm contracts/be-ballistics-engine-extraction.md
   git rm contracts/be-cacheable-key-fix.md
   git rm contracts/be-jsonrpc-contract.md
   git rm contracts/be-jsonrpc.md
   git rm contracts/be-modern-idioms.md
   git rm contracts/be-rk4-stepper-dedup.md
   git rm contracts/be-spring-boot-upgrade.md
   git rm contracts/ci-pipeline.md
   git rm contracts/compare-request-fields.md
   git rm contracts/density-altitude.md
   git rm contracts/engine-parity.md
   git rm contracts/physics-tables-bean.md
   git rm contracts/rate-limit-config.md
   git rm contracts/spin-drift.md
   git rm contracts/trajectory-service.md
   git rm contracts/wa9-simd.md
   git rm contracts/wa10-shared-crate.md
   git rm contracts/wa11-rust-backend.md
   git rm contracts/wa12-custom-drag.md
   git rm contracts/wa13-coriolis.md
   git rm contracts/wasm-build-pipeline.md
   git rm contracts/wasm-engine.md
   git rm contracts/wasm-integration.md
   git rm contracts/wasm-sprint3-overview.md
   ```
   Notes: `density-altitude.md` and `spin-drift.md` are the original Java BE versions; the TS implementations are in `feat1-spin-drift-ts.md` and engine.ts. `wa12-custom-drag.md` and `wa13-coriolis.md` referenced Java/WASM sections that were put on hold in FEAT-3 / FEAT-2 and were never implemented; the TS contracts (`feat3-custom-drag-ts.md`, `feat2-coriolis-ts.md`) supersede them.
2. Replace the opening two paragraphs of `contracts/CHANGELOG.md` (the lines referencing "springdoc" and "REST API spec") with:
   ```
   # Contracts changelog — pure-browser SPA

   This file tracks internal interface contract changes. All physics runs in
   the browser; there is no server-side API.
   ```
3. Verify no CI workflow or script references the deleted paths: `git grep -r 'adr-004\|be-jsonrpc\|wasm-integration\|rate-limit-config\|trajectory-service\|spin-drift\.md\|density-altitude\.md' -- .github/` should return nothing.

**Acceptance:**

- `ls contracts/ | wc -l` returns 24. The surviving files are exactly: `CHANGELOG.md`, `adr-sprint9-performance.md`, `catalog-expansion.md`, `custom-round-library.md`, `fe-esm-migration.md`, `fe-prefs-map-loop.md`, `fe-runSimulation-error-handling.md`, `fe-sprint-notes.md`, `feat1-spin-drift-ts.md`, `feat2-coriolis-ts.md`, `feat3-custom-drag-ts.md`, `perf1-web-worker.md`, `perf6-font-audit.md`, `perf8-binary-search.md`, `perf9-chart-memoize.md`, `perf12-sw-nav-preload.md`, `spa1-ts-engine.md`, `spa2-remove-api-calls.md`, `spa3-delete-backend.md`, `spa4-flatten-layout.md`, `spa5-github-pages.md`, `table-sort.md`, `url-state.md`, `ux1-custom-bullet-catalog.md`.
- `contracts/CHANGELOG.md` contains no reference to "springdoc" or "REST API spec".
- CI passes with no broken references.
- `npm test` passes at 100/100/100/100 (no code changes).

---

### REL-2 · Write root CHANGELOG.md in Keep a Changelog format · DX · Size M [Must Have]

No user-readable `CHANGELOG.md` exists at the repo root. GitHub's auto-generated release notes are just PR titles and are not meaningful to a user or deployer. The app has gone through three distinct eras (Java/REST API baseline → SPA migration → physics completeness) and anyone who deployed or integrated the old API needs an explicit migration guide. This file will also serve as the body of the GitHub Release created in REL-4.

**Work items:**

1. Create `CHANGELOG.md` at the repo root. Begin with the two-line link header required by Keep a Changelog:
   ```markdown
   # Changelog

   All notable changes are documented here following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [SemVer](https://semver.org/).
   ```
   Add an `## [Unreleased]` section immediately below (empty body).
2. Add `## [3.0.0] — 2026-11-18` with the following subsections. Use `git log --oneline` and `BACKLOG.md` to verify PR numbers and merge dates where needed.
   - **Added:** Gyroscopic spin drift (Litz simplified formula, twist rate input; displayed in wind drift chart and data table, PR #139). Coriolis deflection (first-order formula; latitude input; PR #147). Custom drag table CSV upload — overrides G1/G7 drag for the custom round (PR #144 / #145). Density altitude in simulation stat cards (PR #141). Light/dark mode toggle with `localStorage` persistence and `prefers-color-scheme` on first load (PR #137). Re-import previously exported trajectory JSON (PR #138). Keyboard-navigable bullet selector: `role="checkbox"`, `tabindex="0"`, Enter/Space activation, `:focus-visible` ring (PR #140). Screen-reader `aria-live` announcements for simulation lifecycle (PR #136). Select-all / deselect-all bullet checkbox with indeterminate state (PR #113). Trajectory CSV export with all columns including spin drift and Coriolis (PR #113). Custom bullet catalog — add, edit, delete, persist to `localStorage` (PR #113). Web Worker physics engine — simulation no longer blocks the UI thread (PR #99). Service Worker navigation preload (PR #125 via PERF-12 stack). Lazy Chart.js dynamic import — chart library not in initial bundle (PR #106). Vite chunk split: `vendor` (Chart.js) and `physics` chunks with stable hashes (PERF-13 stack). `content-visibility: auto` on chart panels for off-screen rendering savings (PERF-13 stack). Passive touch listeners on chart canvases with `touch-action: none` (PERF-13 stack). Warm-up of physics Web Worker on `requestIdleCallback` (PR #135). VS Code workspace settings and extension recommendations (PR #131). Sticky "Compute Trajectories" button in sidebar (PR #133). Tooltip truncation and "N more" footer with many bullets selected (PR #134).
   - **Changed:** Physics engine moved from Java/Spring Boot + Rust/WASM to TypeScript running fully in the browser — no server required. Build output moved from `target/classes/static/` to `dist/`. Source layout flattened from Maven convention (`src/main/resources/static/`) to `app/`. Service Worker precache list is now generated from the full Vite asset manifest (no manual list). Vite upgraded to 8.x with `esnext` build target. Node.js 24 LTS in CI. `actions/cache` upgraded to v6; `actions/setup-node` upgraded to v7. First-visit default changed from all bullets selected to only the first bullet selected.
   - **Removed:** Java/Spring Boot REST API (`POST /api/rpc`, `POST /api/trajectories/custom`, `GET /api/trajectories/compare/stream`, `POST /api/trajectories/compare`, `GET /api/bullets`). Rust/wasm-pack build pipeline. Docker / docker-compose infrastructure. Maven build (`pom.xml`, `mvnw`). `src/main/java/` and `src/test/java/`. `engine/` Rust workspace. `monitoring/` (Grafana/Prometheus dashboards). `node/` (bundled Node.js binary for `frontend-maven-plugin`). `#statusPill` online/offline indicator and retry timer. WASM loader, Web Worker dispatch layer. `simulateBulletJS` JS fallback. Font weights Rajdhani 300, 500, 700 (unused — saves ~38 KB from precache).
   - **Security:** Pinned `minimatch` to 11.0.8 (GHSA-g3hv-75wg-m249), `glob` to 14.0.6 (GHSA-3g3m-2fjr-6pw4), `deepmerge` to 4.3.1 (GHSA-gcqx-w48m-w2h4) via npm `overrides` — all test-only transitive dependencies not reachable in the browser bundle (PR #146). All GitHub Actions pinned to full commit SHAs. CodeQL JavaScript SAST and Trivy filesystem scan added to CI.
3. After the version section add a `## Migration notes` section:
   ```markdown
   ## Migration notes — upgrading from 1.x (REST API) to 3.0.0

   The REST API endpoints **no longer exist**. The application is a static site
   with no server-side component.

   - **Calling the API programmatically:** use `simulate(bullet, params)` from
     `app/physics/engine.ts` directly in your own TypeScript/JavaScript project,
     or copy the engine file (MIT-licensed). The function signature is documented
     in `app/physics/types.ts`.
   - **Hosting the Java/Spring Boot server:** the server can be decommissioned.
     Deploy the contents of `dist/` to any static host (GitHub Pages, Netlify,
     nginx, CDN). Run `npm run build` to produce `dist/`.
   - **JSON exports from 1.x:** results exported before the SPA migration may
     contain `spinDriftCm: null`, `coriolisDeflectionCm: null`, or
     `densityAltitudeMeters: null`. The import feature treats `null` as `0` and
     renders correctly.
   - **URL state:** existing bookmarked URLs using the `?` state parameter
     continue to work — the URL state format is backward-compatible.
   ```
4. Add a bare link at the bottom of the file: `[3.0.0]: https://github.com/dirkharrington/ballistics/releases/tag/v3.0.0`

**Acceptance:**

- `CHANGELOG.md` exists at the repo root and passes `npx markdownlint CHANGELOG.md --config '{"MD013": false}'` (long lines expected in migration notes).
- File contains `## [Unreleased]`, `## [3.0.0]`, and `## Migration notes` sections.
- Each of the four subsections (Added, Changed, Removed, Security) under `[3.0.0]` is non-empty.
- Migration notes section names the three REST API endpoint paths explicitly.
- `npm test` passes at 100/100/100/100 (no code changes).

---

### REL-3 · Fix BACKLOG.md hygiene and README accuracy · DX · Size XS [Must Have]

`BACKLOG.md` has 15 stories marked done but missing PR numbers (`PR #TBD` or no PR annotation at all), and done-story headings use at least five different formats (`✅ Done`, `✓ Done`, `DONE`, `— DONE`, `~~strikethrough~~ ✅ Done (PR #N)`) making the file inconsistent. `README.md` has two factual inaccuracies: the Tech Stack table says "Vite 6" (the app uses Vite 8), and the Architecture section says `simulate()` "runs synchronously on the main thread" (PERF-1 moved it to a Web Worker in PR #99). Three Sprint 10 features (spin drift, Coriolis deflection, custom drag table) and two Sprint 9 test files are absent from the README.

**Work items:**

1. In `BACKLOG.md`, fill in all missing PR numbers using the table below. For each story, replace `PR #TBD` with the actual PR number, or append `(PR #N)` after the done marker where none exists:

   | Story | PR |
   |---|---|
   | SPA-2 | #89 |
   | SPA-3 | #92 |
   | PERF-1 | #99 |
   | UX-3 | #113 |
   | UX-1 | #113 |
   | UX-2 | #113 |
   | FEAT-2 | #147 |
   | UX-4 | #148 |
   | UX-5 | #141 |
   | UX-8 | #134 |
   | UX-9 | #137 |
   | UX-10 | #133 |
   | ACC-1 | #140 |
   | ACC-2 | #136 |
   | DM-1 | #138 |
   | PERF-14 | #135 |

2. Normalize all done-story heading formats to: `### ~~STORY-ID · Title · Role · Size~~ ✅ Done (PR #N)`. Stories delivered together in one PR (e.g. UX-3, UX-1, UX-2 in PR #113) may each note the shared PR number. Existing entries that already match this pattern do not need to change.

3. In `README.md`, make the following targeted edits:
   - In the Tech Stack table, change `Vite 6` to `Vite 8`.
   - In the Architecture section **Physics pipeline** paragraph, replace "runs synchronously on the main thread. All inputs come from" with "runs in a dedicated Web Worker (`app/physics/engine.worker.ts`), keeping the UI thread responsive. All inputs come from".
   - In the Features table, insert three new rows after the "CSV / PNG export" row:
     ```
     | **Spin drift** | Litz simplified formula; displayed in wind drift chart and data table when twist rate is set |
     | **Coriolis deflection** | First-order formula; displayed when latitude is set |
     | **Custom drag table** | Upload a Mach,CD CSV for the custom round; overrides G1/G7 drag |
     ```
   - In the Test suites table, insert two rows after the `drag-csv.test.js` row:
     ```
     | `tests/fonts.test.js` | Font file existence, orphan check, preload and CSS consistency |
     | `tests/index-html.test.js` | Preload tag presence and href consistency with built CSS |
     ```
   - In the Project Structure tree under `physics/`, add `engine.worker.ts` and `engine-async.ts` as siblings of `engine.ts`.

**Acceptance:**

- `grep -c 'PR #TBD' BACKLOG.md` returns `0`.
- `grep -ic 'vite 6' README.md` returns `0`.
- `grep -ic 'synchronously on the main thread' README.md` returns `0`.
- README Features table contains rows for "Spin drift", "Coriolis deflection", and "Custom drag table".
- `npm test` passes at 100/100/100/100 (no code changes).

---

### REL-4 · Bump version to 3.0.0 and create GitHub Release · DevSecOps · Size XS [Must Have]

`package.json` still declares `"version": "1.0.0"`. There is no git tag or GitHub Release for the current state of the project. The 3.0.0 release represents a complete architectural rewrite (SPA migration from Java/REST) and two full feature sprints (Sprint 9 performance, Sprint 10 physics). Anyone checking `package.json` or the repository releases page cannot determine what version is running in production.

**Work items:**

1. In `package.json`, change `"version": "1.0.0"` to `"version": "3.0.0"`. Commit: `git commit -m "chore(release): bump version to 3.0.0"`.
2. Create and push an annotated tag:
   ```
   git tag -a v3.0.0 -m "Release 3.0.0 — pure-browser SPA"
   git push origin v3.0.0
   ```
3. Create the GitHub Release from the tag, using the root `CHANGELOG.md` as the release body (requires REL-2 merged first). If running in parallel with REL-2, use `--generate-notes` and edit the body after REL-2 lands:
   ```
   gh release create v3.0.0 \
     --title "v3.0.0 — Pure-Browser SPA" \
     --notes-file CHANGELOG.md \
     --latest
   ```
4. Verify the GitHub Pages deploy CI workflow triggers on the resulting push to `main`. Confirm the deployed app at the GitHub Pages URL loads successfully after the release commit lands.

**Acceptance:**

- `node -e "console.log(require('./package.json').version)"` prints `3.0.0`.
- `git tag -l 'v3.0.0'` returns `v3.0.0`.
- The GitHub Releases page shows v3.0.0 as the latest release with a non-empty description.
- `npm test` passes at 100/100/100/100.

**Dependencies:** REL-2 (`CHANGELOG.md`) should merge before the GitHub Release body is finalized.

---

### REL-5 · Add explicit job-level CI permissions and dismiss remaining code scanning alert · DevSecOps · Size XS [Must Have]

The CI workflow has a workflow-level `permissions: contents: read` block but the `changes` and `frontend-build` jobs do not declare their own `permissions:` blocks; they silently inherit whatever the workflow-level sets. Principle of least privilege requires every job to explicitly state what it needs so a future workflow expansion cannot accidentally broaden a job's access. Additionally, one code scanning alert for GHSA-gcqx-w48m-w2h4 (deepmerge, Prototype Pollution) has been open since the Dependabot alert was dismissed in PR #146; the GitHub code scanning alert was not separately closed, leaving the Security dashboard partially red.

**Work items:**

1. In `.github/workflows/ci.yml`, add `permissions: contents: read` as an explicit block to the `changes` job, immediately after the `runs-on:` line.
2. Add the same `permissions: contents: read` block to the `frontend-build` job immediately after `timeout-minutes:`. The `actions/upload-artifact` step uses the GITHUB_TOKEN internally and does not require a declared permission beyond `contents: read`.
3. Navigate to the repository's **Security → Code scanning → Alerts** page. Find the open alert for GHSA-gcqx-w48m-w2h4 (deepmerge, Prototype Pollution). Dismiss it with:
   - Reason: "Used in tests only"
   - Note: "deepmerge is a transitive Jest dependency and is never included in the browser bundle (dist/). No upstream patch is available. Risk is tolerable in the test-only scope. Dependabot alert dismissed in PR #146."
4. Navigate to **Security → Dependabot alerts**. Confirm all alerts are closed. If any remain open, assess whether they are dev-only transitive dependencies and dismiss with rationale, or pin via npm `overrides` in `package.json` if a patched version exists.

**Acceptance:**

- In `.github/workflows/ci.yml`, both the `changes` job and the `frontend-build` job have an explicit `permissions:` block with at least `contents: read`.
- `git grep 'permissions:' .github/workflows/ci.yml` returns a line inside the `changes` job and a line inside the `frontend-build` job in addition to the existing workflow-level block.
- The GitHub Code scanning alerts page shows zero open alerts.
- The GitHub Dependabot alerts page shows zero open alerts.
- CI passes on the PR (`npm test` 100/100/100/100 and all checks green).

---

### ~~REL-6 · Arrow-key roving tabindex in bullet list (from icebox) · FE · Size XS [Should Have — stretch]~~ ✅ Done

ACC-1 (PR #140) made bullet cards reachable by Tab and activatable with Enter/Space, but left roving tabindex as an explicit out-of-scope follow-on. Users navigating the bullet list with keyboard currently must Tab through every card in sequence; there is no way to jump down with the arrow keys, which is the standard interaction pattern for a list of `role="checkbox"` items. The pattern and CSS are already established by ACC-1, making this a contained follow-on.

**Work items:**

1. In `app/ballistics.js` `renderBulletList()`, after attaching the existing click and keydown listeners to each card, also attach an `ArrowDown` / `ArrowUp` keydown handler:
   - Set `tabindex="-1"` on every card during the initial render (all cards unreachable by Tab by default).
   - Set `tabindex="0"` only on the currently focused card. Track the focused index in a module-level variable `_focusedBulletIdx` (initialise to 0).
   - `ArrowDown`: move `_focusedBulletIdx` to `Math.min(idx + 1, cards.length - 1)`, call `cards[_focusedBulletIdx].focus()`. Call `e.preventDefault()` to stop the page from scrolling.
   - `ArrowUp`: move `_focusedBulletIdx` to `Math.max(idx - 1, 0)`, call `cards[_focusedBulletIdx].focus()`. Call `e.preventDefault()`.
   - On `focus` of any card, update `_focusedBulletIdx` to that card's index (handles mouse clicks that move focus).
2. The first card in the list (`tabindex="0"`) must be reachable via Tab from whatever element precedes the bullet list (REL-7 removes the select-all checkbox; the card list becomes the first Tab stop in the bullet-selector region).
3. Apply the same roving-tabindex pattern to `app/custom-bullets.js` `renderCustomBulletGroup()` if custom bullet cards also received `tabindex="0"` in ACC-1. If the custom bullet group is a separate region, give it its own roving index independent of the built-in list.

**Coverage:** 100% Jest. Tests: (a) initial render sets `tabindex="0"` on first card and `tabindex="-1"` on all others; (b) `ArrowDown` keydown on card 0 focuses card 1 and sets its `tabindex="0"`, resets card 0 to `tabindex="-1"`; (c) `ArrowUp` on card 0 stays on card 0 (no underflow); (d) `ArrowDown` on last card stays on last card (no overflow); (e) `e.preventDefault()` is called on both arrow keys; (f) the first card is the first Tab stop in the bullet-selector region.

**Acceptance:**

- Tab from outside the bullet list reaches the first bullet card.
- ArrowDown and ArrowUp move focus through the card list; only one card has `tabindex="0"` at any time.
- Pressing ArrowDown at the last card does not wrap or scroll the page.
- Mouse click on a card updates `_focusedBulletIdx` so subsequent arrow-key navigation starts from the clicked card.
- `npm test` passes at 100/100/100/100.

**Dependencies:** ACC-1 (PR #140). Implement after REL-7 (select-all removal).

---

### ~~REL-7 · Remove select-all and enforce 5-munition selection limit · FE · Size S [Must Have]~~ ✅ Done

The select-all / deselect-all checkbox currently allows every bullet in the catalog to be selected simultaneously. With an unbounded selection, the chart and physics worker receive an arbitrary number of trajectories, producing an overcrowded, unreadable chart and unbounded computation cost. The checkbox also adds UI complexity that conflicts with the more intentional per-bullet selection model. This story removes the select-all control entirely and caps simultaneous selection at five munitions; attempting to activate a sixth is silently ignored with a visual cue on the blocked card.

**Work items:**

1. In `app/index.html`, remove the select-all checkbox element and its associated label (search for `selectAll`, `select-all`, or `checkAll` — confirm the exact id/class by reading the file). Remove any wrapping container that becomes empty after the removal.
2. In `app/ballistics.js`:
   - Remove the `selectAll` / `checkAll` event listener and handler entirely.
   - Remove the `updateSelectAllState()` function (or equivalent indeterminate-state updater) if it exists.
   - In `renderBulletList()` (and `renderCustomBulletGroup()` in `app/custom-bullets.js` if it also has a select-all), remove any code that wires or resets the select-all checkbox state.
   - In the per-card click/keydown handler (the same handler that toggles bullet selection), add a guard before activating a bullet: if the card is not yet selected AND `selectedBulletIds.size >= 5` (or whatever the existing selection-state structure is — read the code to confirm), do not toggle the selection. Instead, add a CSS class such as `bullet-card--limit-reached` to the card being clicked and remove it after 600 ms (a brief visual shake or dim). Do not throw or log an error.
   - Export or expose a `MAX_SELECTED_BULLETS = 5` constant at the top of the module for testability.
3. Update CSS (in `app/index.html` `<style>` or the linked stylesheet) to add a `.bullet-card--limit-reached` rule — a subtle visual response such as a brief shake animation or a red border flash. Keep it accessible: do not rely on color alone; use `animation: shake 0.2s` or similar.
4. Update `tests/ballistics.test.js`:
   - Remove any tests that reference the select-all checkbox or `updateSelectAllState`.
   - Add tests: (a) selecting 5 bullets succeeds; (b) attempting to select a 6th bullet leaves the selection count at 5 and the 6th card unselected; (c) deselecting one of the 5 then selecting a different bullet succeeds (limit is on current count, not cumulative); (d) the `bullet-card--limit-reached` class is added to the blocked card on a blocked click attempt.
5. Update `BACKLOG.md` in this PR: mark REL-7 Done with its PR number.

**Acceptance:**

- The select-all / deselect-all checkbox is absent from the rendered HTML.
- Selecting 5 bullets works normally; a 6th click does not change the selection set.
- After deselecting any bullet, the next click on an unselected bullet succeeds.
- The blocked card receives the `bullet-card--limit-reached` CSS class momentarily.
- `grep -c 'selectAll\|checkAll\|select-all' app/index.html` returns 0 (or confirms the element is gone — verify the exact identifier first by reading the file).
- `npm test` passes at 100/100/100/100.

---

## Sprint 12 — Maximum Performance

**Sprint Goal:** Cut worst-case simulation wall time by an order of magnitude (zero-allocation RK4 hot loop, fast zero-angle convergence, worker-side BC solver, multi-core worker pool, and LRU result memoization), eliminate main-thread frame drops during chart rendering, crosshair scrubbing, table rendering, and input typing, and minimize first-load and repeat-deploy transfer cost.

**Baseline requirement:** Before PERF-15 merges, record baseline numbers on `main` (median of 5 runs):
1. Engine benchmark: 5-bullet, 2 000 m, 1 m-step `simulate()` wall time and heap allocation delta.
2. BC back-calculator wall time (`.308 Win 168gr`, 500 m drop) in Chrome DevTools Performance.
3. Crosshair hover over 5 charts (1 000 m, 10 m step): Scripting + Rendering ms/s and max frame time.
4. Repeat Compute click (unchanged inputs, then 1 modified param): total click-to-paint latency (INP).
5. Lighthouse mobile (throttled cold load & repeat-deploy SW update transfer bytes).

**Merge & parallelization plan:**
- **Track A (Physics Engine — stacked):** `PERF-15 → PERF-16 → PERF-17` (all three touch `app/physics/engine.ts`; merge in sequence).
- **Track B (Worker Concurrency & Caching — stacked):** `PERF-18 → PERF-19` (both touch `app/physics/engine-async.ts`; can run in parallel with Track A, except PERF-17's worker message type merges cleanly before or after PERF-18).
- **Track C (UI & Chart Rendering — stacked):** `PERF-20 → PERF-21 → PERF-22 → PERF-23` (all touch `app/ballistics.js`; merge in sequence).
- **Track D (Loading, SW Caching & CSS — independent):** `PERF-24` and `PERF-25` can run in parallel with Tracks A–C.

---

### ~~PERF-15 · Zero-allocation RK4 hot loop & flat `Float64Array` drag lookup · FE · Size S~~ ✅ Done

Every RK4 step in `findZeroAngleFps` (`app/physics/engine.ts:191-213`) and `integrateTrajectoryFps` (`app/physics/engine.ts:226-283`) invokes a nested `deriv` closure that allocates a 2-element `[ax, ay]` tuple 4 times per step and calls `Math.hypot(vx, vy)` 4 times per step. Over a 2 000 m trajectory plus 64 zero-finding passes (~23 000 RK4 steps per bullet), this creates ~92 000 short-lived array allocations and ~92 000 `Math.hypot` calls per bullet. `Math.hypot` performs IEEE overflow/underflow scaling that is unnecessary for bullet speeds (`0–5 000 fps`, where `vx² + vy² ≤ 2.5×10⁷`). Meanwhile `G1_TABLE` and `G7_TABLE` are arrays of boxed `[v, f]` tuples requiring double indirection and binary search on every drag lookup even though projectile speed decreases monotonically during flight.

**Work items:**

1. In `app/physics/engine.ts`, add an internal compiled table representation:
   ```ts
   interface CompiledDragTable {
     readonly v: Float64Array;
     readonly f: Float64Array;
     readonly dv: Float64Array; // dv[i] = v[i] - v[i - 1], length n (dv[0] unused)
     readonly df: Float64Array; // df[i] = f[i] - f[i - 1]
     readonly last: number;
   }
   ```
   Pre-compile `G1_COMPILED` and `G7_COMPILED` once at module load; compile custom tables once per `simulate()` call via `compileDragTable(table)`. Keep `interpolateDragTable(v, table)` pure, exported, and unchanged for external callers and existing tests.
2. Add an internal scalar lookup helper that uses a caller-local bracket index (`idx`) initialized via binary search on the first sample and decremented/incremented locally when `v` crosses a breakpoint (O(1) amortized — >99.8% single-comparison hit rate as speed decays monotonically). Preserve the exact arithmetic `f[lo - 1] + ((v - v[lo - 1]) / dv[lo]) * df[lo]` so output stays bit-identical.
3. In both `findZeroAngleFps` and `integrateTrajectoryFps`:
   - Inline the 4 RK4 stage derivatives into scalar locals (`ax1, ay1, … ax4, ay4`) — zero tuple allocations inside the `while` loop.
   - Replace `Math.hypot(vx, vy)` with `Math.sqrt(vx * vx + vy * vy)` (speed is strictly non-negative and bounded well within float64 normal range; drop the redundant `Math.abs(vel)`).
   - Precompute loop invariants before the loop: `const rhoOverBc = rho / bc`, `const halfDt = 0.5 * DT_S`, `const sixthDt = DT_S / 6`, `const tanAngle = Math.tan(angle)`, `const halfMassOverG = 0.5 * (wLbs / G_FPS2)`.
4. Record median wall time of 5 runs of a 5-bullet, 2 000 m, 1 m-step `simulate()` before and after in the PR description.

**Coverage:** 100% Jest. All existing tests plus unit tests for `compileDragTable` and the local-bracket lookup (covering monotonic decrease, brief speed increase on downhill shots, below-min/above-max clamps, and equivalence against `interpolateDragTable`). `tests/fixtures/spa1-golden.json` must pass **without** regeneration.

**Acceptance:**

- Zero array/object allocations occur inside the RK4 `while` loops in `findZeroAngleFps` and `integrateTrajectoryFps`.
- `Math.hypot` does not appear inside `app/physics/engine.ts`.
- `tests/fixtures/spa1-golden.json` passes bit-identically without changes.
- 5-bullet, 2 000 m, 1 m-step `simulate()` median wall time improves by ≥40%.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-16 · Fast bracketed secant/Brent zero-angle solver in `findZeroAngleFps` · FE · Size S~~ ✅ Done

`findZeroAngleFps` (`app/physics/engine.ts:196`) unconditionally runs **64 full RK4 integrations** from `x = 0` to `zeroFt` on every `simulate()` call. Because IEEE-754 float64 only has 53 bits of significand, iterations 53–64 make zero progress (`mid === lo || mid === hi`), and for a typical 100 m–300 m zero the zero-finder accounts for 50–70% of total simulation CPU time. Moreover, `f(θ) = y(θ; zeroFt) - sightHtFt` is smooth, strictly monotonic, and nearly linear over `[-0.05, 0.05]`, so a safeguarded secant/Illinois regula-falsi solver converges to sub-picoradian accuracy in 5–9 iterations instead of 64.

**Work items:**

1. Extract the single-pass zero-range integration into an internal helper `evalHeightAtZero(angle, mvFps, rhoOverBc, zeroFt, table): number`.
2. In `findZeroAngleFps`:
   - Start with bracket `[lo, hi] = [-0.05, 0.05]`. Evaluate `fLo` and `fHi` (if the root is outside the bracket, preserve the existing clamped boundary behavior).
   - At each step (up to 64 max iterations), compute a safeguarded secant candidate `s = hi - fHi * (hi - lo) / (fHi - fLo)` (or Illinois-damped regula falsi). Fall back to bisection `(lo + hi) / 2` whenever `s` is not strictly inside `(lo + 0.1 * (hi - lo), hi - 0.1 * (hi - lo))` or `fHi === fLo`.
   - Terminate early as soon as `Math.abs(fMid) <= 1e-9` (1 nanometre at zero range) OR `hi - lo <= 1e-13` OR `mid === lo || mid === hi`.
3. Verify against all cases in `tests/fixtures/spa1-golden.json` (plus extreme inputs: 3 000 m zero, 0 mm sight height, ultra-slow bullet hitting `vel < 50`).
4. Record median `findZeroAngleFps` iteration count and full `simulate()` wall time before and after in the PR description.

**Coverage:** 100% Jest. Tests: (a) solver converges in ≤12 iterations for standard catalog bullets at 100 m, 300 m, and 1 000 m zero; (b) agrees with 64-pass bisection within `1e-9` rad across a seeded sweep of velocities, BCs, altitudes, and sight heights; (c) handles ultra-slow bullet (`vel < 50`) and out-of-bracket roots via bisection fallback without infinite loops; (d) `spa1-golden.json` passes unchanged.

**Acceptance:**

- Typical zero-angle convergence takes ≤10 RK4 passes (down from 64 — ≥6× reduction in zero-finder work).
- `tests/fixtures/spa1-golden.json` passes **without** regeneration.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-15.

---

### ~~PERF-17 · Move BC back-calculator solver into physics worker with tight tolerance · FE · Size S~~ ✅ Done

`calcBC` (`app/tools.js:220-255`) executes **64 sequential `await simulateBulletFn(bullet, req)` calls** across the main-thread ↔ Web Worker `postMessage` boundary. Each iteration runs a full `simulate()` (including full zero-angle solve, allocating every 25 m `TrajectoryPoint` object, and structured-cloning the entire `TrajectoryResult` back to the main thread) just to read a single `dropCm` value, even though `calcBC` rounds its final output to 4 decimal places (`0.0001`). Over `[0.001, 1.5]`, 4-decimal precision needs only ~17 bisection iterations (or ~7–10 safeguarded secant iterations); the remaining ~47 full worker round-trips are pure waste.

**Work items:**

1. In `app/physics/engine.ts`, add and export `solveBC(params: SolveBCParams): number | null`:
   - Precomputes `rho`, `mvFps`, `sightHtFt`, `zeroFt`, and `targetFt` once before the solver loop.
   - Runs a lightweight trajectory pass that tracks only `dropCm` at `rangeM` (no `TrajectoryPoint[]` array allocation, no spin drift / Coriolis / energy / wind drift math).
   - Uses safeguarded secant with bisection fallback over `[0.001, 1.5]`, terminating once `hi - lo < 1e-5` or `Math.abs(dropCm - measuredDropCm) < 1e-4` (capped at 40 iterations), returning `Math.round((lo + hi) / 2 * 10000) / 10000`.
2. In `app/physics/engine.worker.ts` and `app/physics/engine-async.ts`, add a `'solveBC'` worker message type and export `solveBCAsync(params): Promise<number | null>` so the entire BC solve executes in **1 worker round-trip** instead of 64.
3. In `app/tools.js`, update `initBcSolver` to use `solveBCAsync` when provided (keeping `calcBC(simulateBulletFn, …)` working with early termination at `hi - lo < 1e-5` so existing injected-mock tests remain supported).
4. Record BC back-calculator wall time before and after (`.308 Win 168gr`, 500 m) in the PR description.

**Coverage:** 100% Jest. Tests: (a) `solveBC` recovers known G1 BCs to within `±0.0002` for `.223`, `.308`, and `.338 Lapua` at 300 m, 500 m, and 1 000 m; (b) handles non-convergent/invalid drops by returning `null`; (c) `solveBCAsync` sends exactly **1** `postMessage` to the worker; (d) `calcBC` early-exits in ≤18 calls.

**Acceptance:**

- Clicking CALCULATE in BC Back-Calculator sends **1** worker message instead of 64.
- Wall time drops by ≥10× (e.g. from ~150–400 ms to <15 ms).
- Solved BC values match the previous implementation to within `±0.0001`.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-16.

---

### ~~PERF-18 · Bounded Web Worker pool & stale-run cancellation in `engine-async.ts` · FE · Size M~~ ✅ Done

`app/physics/engine-async.ts` maintains a single `_worker` instance. When `computeClientSide()` (`app/ballistics.js:144`) dispatches 5 selected bullets via `Promise.all(...)` or `runSweep()` (`app/ballistics.js:1295`) dispatches 5 sweep runs, all 5 tasks queue sequentially on a single CPU core. Additionally, rapid re-clicks or parameter changes have no cancellation mechanism, so stale work continues occupying workers and can overwrite newer UI state if not guarded.

**Work items:**

1. In `app/physics/engine-async.ts`, replace the single `_worker` with a bounded lazy pool of up to `POOL_SIZE = Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4))` workers:
   - `prewarmPhysicsWorker()` still warms **only 1** worker on idle (zero extra startup cost for 1-bullet runs).
   - Additional workers (up to `POOL_SIZE`) are spawned lazily only when concurrent in-flight jobs exceed currently idle workers.
   - Maintain a FIFO task queue with least-busy dispatch (each worker runs 1 active job at a time so no worker starves another).
   - Terminate all pool workers and reject all pending/queued promises on `pagehide` and `_resetForTest()`.
2. Add optional `{ signal?: AbortSignal }` support to `simulateAsync(bullet, params, options)`:
   - If aborted while queued (not yet sent to a worker), remove from the queue immediately and reject with `DOMException('Aborted', 'AbortError')` without running `simulate()`.
   - If aborted while in-flight, reject immediately and discard the worker's response when it arrives.
3. In `app/ballistics.js`, track a module-level `AbortController` for `runSimulation`, `runCustom`, and `runSweep`: starting a new run aborts any superseded run and ignores `AbortError` cleanly without flashing an error banner.

**Coverage:** 100% Jest. Tests: (a) single job creates 1 worker; (b) 5 concurrent jobs fan out across `POOL_SIZE` workers and resolve in input order; (c) queued jobs beyond `POOL_SIZE` drain as workers finish; (d) aborting a queued job prevents `postMessage` from ever being called for it; (e) aborting an in-flight job rejects with `AbortError` and ignores late worker replies; (f) `pagehide` terminates every spawned worker; (g) rapid double-click on Compute discards the stale run.

**Acceptance:**

- 5-bullet simulation and 5-step sweep execute in parallel across up to 4 CPU cores, cutting multi-bullet wall time by ≥2× on 4+ core machines.
- Single-bullet runs spawn only 1 worker (same memory footprint as today).
- Rapidly clicking Compute twice cancels queued work from the first run and never renders stale results.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-19 · Bounded LRU memoization cache for simulation results · FE · Size XS~~ ✅ Done

Every Compute click recomputes every selected bullet from scratch, even when the user only adds or removes one bullet from an existing comparison, re-clicks Compute without changing parameters, or switches between Sweep mode and Trajectory mode (`clearSweep` or repeating a sweep). Because `simulate(bullet, params)` is a pure deterministic function of the physics fields, identical inputs always yield identical trajectories.

**Work items:**

1. In `app/physics/engine-async.ts`, add a bounded LRU `Map<string, TrajectoryResult>` (`MAX_CACHE_ENTRIES = 64`).
2. Build a canonical cache key `simulationCacheKey(bullet, params)` from **only** the physics-affecting fields:
   - Bullet: `bulletWeightGrams`, `muzzleVelocityMps`, `ballisticCoefficient`, `bulletDiameterMm` (only when `twistRateInchesPerTurn != null`).
   - Params: `zeroRangeMeters`, `maxRangeMeters`, `stepMeters`, `windSpeedKph`, `windDirectionDeg ?? 90`, `altitudeMeters`, `temperatureC`, `sightHeightMm ?? 38.1`, `shootingAngleDegrees ?? 0`, `dragModel ?? 'G1'`, `twistRateInchesPerTurn ?? null`, `latitudeDeg ?? null`, `azimuthDeg ?? null`, and `customDragTable` (when non-empty).
   - Exclude non-physics display fields (`bulletIds`, `description`, `hexColor`, `name`) from the key, and attach the caller's `{ ...cached, bullet, request: params }` on a hit so display metadata and object references stay accurate.
3. On cache hit, promote the entry (delete + re-insert in `Map`) and return `Promise.resolve(result)` without touching any worker. On cache miss, store the resolved result and evict the oldest entry when `size > MAX_CACHE_ENTRIES`. Never cache rejected/aborted promises.
4. Clear the cache inside `_resetForTest()` and export `_getCacheStatsForTest()` (or `_clearCacheForTest()`).

**Coverage:** 100% Jest. Tests: (a) identical `(bullet, params)` hits cache and sends 0 worker messages on the second call; (b) changing any single physics param (e.g. `windSpeedKph`, `temperatureC`, `customDragTable`) misses cache; (c) changing display-only `hexColor` or `name` still reuses cached physics points with updated `bullet` metadata; (d) LRU evicts the least-recently-used entry past 64 entries; (e) validation errors and aborted calls are not cached.

**Acceptance:**

- Adding a 2nd bullet to an already-computed 1-bullet run dispatches only **1** worker job (for the new bullet) instead of 2.
- Re-clicking Compute with unchanged parameters resolves in <1 ms with 0 worker messages.
- Cache memory is strictly bounded at 64 entries.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-18.

---

### ~~PERF-20 · Coalesce crosshair hover updates with `rAF` & index-change guard · FE · Size XS~~ ✅ Done

Both `buildChartConfig`'s `onHover` (`app/ballistics.js:844-859`) and `adjustChart`'s `onHover` (`app/ballistics.js:1095-1107`) run synchronously on every `mousemove` / `touchmove` event without checking whether `crosshairIndex` actually changed. Moving the pointer a few pixels inside the same range bucket (90%+ of pointer events) repeatedly rewrites `#readoutBody.innerHTML` and invokes `c.update('none')` on all 4 sibling Chart.js instances, causing continuous main-thread scripting and canvas redraw spikes on 60–120 Hz displays.

**Work items:**

1. Extract a single shared helper `scheduleCrosshairSync(nextIndex, sourceChartId, results)` in `app/ballistics.js` and use it in both `buildChartConfig` and `adjustChart` (removing the duplicated `onHover` bodies).
2. Add an immediate no-op guard: if `nextIndex === crosshairIndex`, return immediately (zero DOM writes, zero `chart.update('none')` calls).
3. Update `crosshairIndex = nextIndex` and coalesce DOM + sibling-chart updates into a single pending `requestAnimationFrame` callback (`_crosshairRafId`):
   - If a frame callback is already scheduled, simply overwrite the pending target `{ index, sourceChartId, results }` — at most **1** readout update and **1** sibling redraw batch execute per display frame.
   - Inside the `rAF` callback, update `#rangeReadout` (or hide when `index === null`) and call `c.update('none')` only on sibling charts that are currently intersecting or mounted.
4. Cancel any pending `_crosshairRafId` inside `resetCrosshairState()` and `_resetState()`.
5. Attach DevTools Performance trace summaries (hovering across 5 charts for 3 s, before vs. after) in the PR description.

**Coverage:** 100% Jest. Tests: (a) consecutive `onHover` events at the same `elements[0].index` trigger 0 `updateReadout` calls and 0 `chart.update('none')` calls; (b) 5 rapid `onHover` events with different indices within one frame coalesce into 1 `rAF` execution using the latest index; (c) `resetCrosshairState` cancels a pending `rAF`; (d) both `buildChartConfig` charts and `adjustChart` use the shared helper.

**Acceptance:**

- Hovering slowly across a chart fires `#readoutBody` updates and sibling `chart.update('none')` only when the range index actually changes, and never more than once per animation frame.
- DevTools Performance shows ≥75% reduction in Scripting + Painting time during continuous crosshair scrubbing.
- Hovering, pinning, unpinning, and touch-scrubbing behave identically to before.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-21 · Chart.js fast path: `parsing: false`, LTTB decimation, instance reuse & single-pass MOA/MRAD · FE · Size M~~ ✅ Done

Every `renderResults()` call (`app/ballistics.js:930-1135`) destroys all 5 Chart.js instances, wipes `#chartContainer.innerHTML`, rebuilds all 5 panel DOM trees, and constructs 5 brand-new charts with a 600 ms animation (`animation: { duration: 600 }`) running across all 5 canvases simultaneously. Every dataset is passed as `{ x, y }` objects with Chart.js's default `parsing: true` and `normalized: false`, forcing Chart.js to re-parse and sort-check every point even though `x` (`rangeMeters`) is already numeric and strictly ascending. For fine step sizes (e.g. 2 000 m at 1 m step = 2 001 points × 5 bullets = 10 005 points per chart), bezier smoothing (`tension: 0.3`) and un-decimated rendering create multi-hundred-millisecond paint stalls. In addition, `adjustChart` (`app/ballistics.js:1062-1085`) calls `computeAdjustments()` **twice** per point (once for MOA, once for MRAD), and `Chart.register` (`app/ballistics.js:84`) still registers unused `CategoryScale`.

**Work items:**

1. In `_loadChart()` (`app/ballistics.js:82-85`), remove unused `CategoryScale` (every chart uses `x: { type: 'linear' }`) and register `Decimation` so Rolldown drops `CategoryScale` and enables built-in LTTB decimation.
2. In `buildChartConfig` and `adjustChart`:
   - Set `parsing: false` and `normalized: true` on chart options (all datasets are already `{ x: number, y: number }[]` sorted ascending by `x`).
   - Enable `plugins.decimation = { enabled: true, algorithm: 'lttb', samples: 250, threshold: 250 }` so fine-step trajectories (>250 points) decimate visually accurately in O(N) while coarse trajectories (≤250 points) draw every point untouched.
   - Adapt `animation` and `tension`: disable animation (`animation: false`) when `window.matchMedia('(prefers-reduced-motion: reduce)').matches` OR when total plotted points across datasets exceed 1 000 (otherwise keep a crisp `duration: 250`); set `tension: 0` when per-dataset points exceed 200 (at ≤10 m spacing, straight segments are visually indistinguishable from cubic splines and avoid 4× bezier control-point computation).
3. In `adjustChart`, compute `computeAdjustments(p.dropCm, p.rangeMeters)` **once** per point and populate both the MOA and MRAD point arrays in a single pass.
4. Reuse existing Chart.js instances on subsequent trajectory-mode renders:
   - When all 5 expected chart canvases (`dropChart`, `velocityChart`, `energyChart`, `windChart`, `adjustChart`) already exist in `charts` and we are not transitioning from sweep mode, update the stat cards container in place, update subtitles/annotations, replace `chart.data.datasets`, update hover/click `results` closure reference, and call `chart.update(animMode)` instead of `cc.innerHTML = ''` + `c.destroy()` + `new Chart(...)`.
   - Keep full teardown + rebuild when transitioning between sweep mode and trajectory mode (or on first render).

**Coverage:** 100% Jest. Tests: (a) `Chart.register` registers `Decimation` and does **not** register `CategoryScale`; (b) chart configs set `parsing: false`, `normalized: true`, and `decimation`; (c) `prefers-reduced-motion: reduce` or >1 000 points disables animation; (d) `computeAdjustments` is called once per point (not twice) for `adjustChart`; (e) two consecutive `renderResults` calls reuse existing Chart instances (`destroy` called 0 times, `update` called once per chart); (f) transitioning from sweep mode back to trajectory mode rebuilds cleanly.

**Acceptance:**

- `dist/assets/vendor-*.js` shrinks by removing `CategoryScale` (record before/after byte size in PR).
- Second Compute click (updating parameters) reuses all 5 Chart instances with zero canvas reallocations and ≥50% faster click-to-paint time.
- A 5-bullet, 2 000 m, 1 m-step simulation renders smoothly without >50 ms long tasks during chart draw.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-20.

---

### ~~PERF-22 · Lazy hidden-tab table/DOPE rendering, cached `Intl.NumberFormat` & cached sort rows · FE · Size S~~ ✅ Done

At the end of `renderResults()` (`app/ballistics.js:1139-1140`), the app synchronously builds and parses the full HTML for `#tableBody` (up to 10 000+ `<tr>` rows on small steps) AND `#dopeTable` even when the user is on the default **Trajectory Charts** tab and both `#dataPanel` and `#toolsPanel` are `display: none`. Inside `renderTable()` (`app/ballistics.js:1199-1200`), `p.velocityMps.toLocaleString()` and `p.energyJoules.toLocaleString()` are invoked on every row (each call does a slow locale lookup), and `onSortHeaderClick()` (`app/ballistics.js:1221`) re-runs `computeAdjustments()` and `escapeHtml()` for every single row on every sort click. Meanwhile `interpolateAt()` in `app/tools.js:68` still uses a linear scan over trajectory points.

**Work items:**

1. Add a single module-level cached formatter `const _numFmt = new Intl.NumberFormat();` in `app/ballistics.js` and replace per-row / per-card `.toLocaleString()` calls (`renderStatCards`, `renderTable`) with `_numFmt.format(...)`.
2. Defer hidden-tab rendering with dirty flags (`_tableDirty`, `_dopeDirty`, `_pendingDopeReq`):
   - In `renderResults(results, req)`: store `tableResults = results`, clear cached row records (`_cachedTableRows = null`), mark `_tableDirty = true` and `_dopeDirty = true`.
   - Call `renderTable(results)` immediately **only if** `#dataPanel` has `.active`; call `renderDopeCard(results, req)` immediately **only if** `#toolsPanel` has `.active`.
   - In `switchTab(name, el)`: when switching to `'data'` while `_tableDirty` is true, flush `renderTable(tableResults)` and clear `_tableDirty`; when switching to `'tools'` while `_dopeDirty` is true, flush `renderDopeCard(tableResults, _pendingDopeReq)` and clear `_dopeDirty`.
3. Cache precomputed table row objects (`{ r, p, adj, color, escapedName }`) in `_cachedTableRows` when `tableResults` changes, so `onSortHeaderClick` sorts the cached array in place without recomputing `computeAdjustments()`, `colorFor()`, or `escapeHtml()` on every click.
4. For large tables (>500 rows), render the first 250 rows synchronously and append remaining rows in `requestAnimationFrame` chunks (cancelled if a new render or sort starts), keeping Data Table tab-switch and sort INP under 50 ms.
5. In `app/tools.js`, replace the linear loop in `interpolateAt()` (line 68) with lower-bound binary search (same pattern as `PERF-8`).

**Coverage:** 100% Jest. Tests: (a) `renderResults` while on Charts tab does not populate `#tableBody` or `#dopeTable`; (b) switching to Data Table flushes `renderTable` once and clears `_tableDirty` (switching back and forth does not re-render); (c) switching to Tools tab flushes `renderDopeCard` once; (d) `renderResults` while Data Table is active renders immediately; (e) `onSortHeaderClick` reuses cached `adj` without calling `computeAdjustments` again; (f) chunked rendering appends all rows and cancels stale chunks on re-sort; (g) `interpolateAt` binary search matches linear scan across edge cases.

**Acceptance:**

- Clicking Compute while on the Charts tab performs **zero** `#dataTable` or `#dopeTable` DOM mutations.
- Sorting a 2 000-row table completes in <16 ms.
- Formatting 2 000 rows via cached `Intl.NumberFormat` is ≥5× faster than per-call `.toLocaleString()`.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-21.

---

### ~~PERF-23 · Debounce sidebar input persistence (`savePrefs` / `syncUrl`) & overlap Chart.js warm-up · FE · Size XS~~ ✅ Done

Two subtle main-thread and waterfall issues remain in `app/ballistics.js`:
1. Parameter inputs (`app/ballistics.js:1556-1559`) run `savePrefs()` (11 synchronous `localStorage.setItem` calls) and `syncUrl()` (12 DOM lookups, 3 `URLSearchParams` allocations, and `history.replaceState`) on **every single `input` event** — causing keystroke jitter and risking Safari's `SecurityError` when `history.replaceState` is called >100 times within 30 s (e.g. holding a number-input spinner).
2. In `_loadChart()` (`app/ballistics.js:78-90`), a rejected dynamic import is never evicted from `_chartModPromise` (permanently breaking charts until reload after a transient offline error), and `runSimulation`, `runCustom`, and `runSweep` do not start `_loadChart()` before awaiting the worker — leaving Chart.js download serialized **after** worker completion on cold cache (this warm-up overlap was planned in PERF-9 but is absent on `main`).

**Work items:**

1. Add a lightweight trailing `debounce(fn, 200)` helper in `app/ballistics.js` with a `.flush()` method:
   - Wire the 10 parameter inputs (plus `twistRate`, `latitudeDeg`, `azimuthDeg`) to a debounced `persistInputs()` that calls `savePrefs()` + `syncUrl()`.
   - Flush any pending debounced persistence immediately inside `runSimulation()`, `runCustom()`, `copyLink()`, and a `pagehide` listener so no edit is ever lost.
   - Also optimize `savePrefs()` to write only keys whose serialized value changed since the last write (in-memory `_lastSavedPrefs` mirror, reset in `_resetState()`).
2. Fix `_loadChart()` and add `_warmChart()`:
   - Clear `_chartModPromise = null` in `.catch(...)` before rethrowing so subsequent clicks retry after transient failures.
   - Add `_warmChart()` (`_loadChart().catch(() => {})`) and call it at the start of `runSimulation()`, `runCustom()`, and `runSweep()` **before** awaiting `computeClientSide` / `simulateAsync`, overlapping the cold Chart.js chunk fetch with physics computation.
   - Handle `_loadChart()` rejection in `renderResults` and `renderSweepCharts` via `_setSimulationError("Couldn't load the chart library. Check your connection and try again.")` while still rendering the data table / DOPE card (no unhandled rejection).

**Coverage:** 100% Jest. Tests: (a) 5 rapid `input` events within 200 ms trigger `savePrefs` and `replaceState` only once after timer advances; (b) clicking Compute or Copy Link flushes pending persistence immediately; (c) `savePrefs` skips `localStorage.setItem` for unchanged keys; (d) `_loadChart` resets its cached promise after rejection and succeeds on retry; (e) `_warmChart` starts `import('chart.js')` before the worker promise settles; (f) `renderResults` shows error banner and preserves table on chart load failure.

**Acceptance:**

- Holding an input spinner for 2 s triggers ≤2 `history.replaceState` calls instead of 30–60.
- Cold-cache Network waterfall shows `vendor-*.js` (Chart.js) fetch starting simultaneously with the physics worker run, not after it.
- Transient offline failure on Chart.js chunk recovers cleanly on the next click once back online.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-22.

---

### ~~PERF-24 · Defer SW registration & preserve immutable hashed chunks across deploys · FE / DevSecOps · Size S~~ ✅ Done

Three loading/caching inefficiencies penalize both first visits and repeat-visit deploys:
1. `app/ballistics.js:1490-1496` registers `sw.js` immediately inside `init()` (before `window.load`). On first visit, `handleInstall()` (`app/sw.js:64-70`) immediately fetches every URL in `STATIC_ASSETS_TO_PRECACHE` — including the lazy ~200 KB `vendor-*.js` (Chart.js) chunk and all 7 `.woff2` fonts — directly competing with critical-path CSS, entry JS, and preloaded fonts for mobile bandwidth.
2. `vite.config.js:20` stamps `CACHE_VERSION` with `Date.now().toString(36)` on every build, and `handleInstall()` fetches every precache URL from the network into the new cache. Whenever a 1-line UI fix deploys, every returning user re-downloads ~300 KB of unchanged content-hashed `vendor-*.js` and `.woff2` files.
3. Duplicate unreferenced root assets (`app/apple-touch-icon.png`, `app/favicon.svg`) exist alongside `app/public/`, and `app/index.html:507-510` emits a second inline `<script type="module">` importing `tools.js` even though `ballistics.js` already imports `tools.js`.

**Work items:**

1. In `app/ballistics.js` `init()`, defer `navigator.serviceWorker.register(...)` until `window` `'load'` (or immediately if `document.readyState === 'complete'`) so SW install never competes with initial LCP/FCP.
2. In `vite.config.js` `serviceWorkerPlugin()`:
   - Replace `Date.now().toString(36)` with a deterministic 12-char SHA-256 hash (`crypto.createHash('sha256')`) of the sorted `allAssets` manifest list (so identical builds produce byte-identical `sw.js`).
   - Exclude the lazy `vendor-*.js` (Chart.js) chunk from the synchronous install-time precache list (let `cacheFirstNetworkFallback` cache it on first Compute, or warm it opportunistically after `activate` on idle) so first-visit SW install doesn't eagerly download 200 KB of unused JS.
3. In `app/sw.js` `handleInstall()`:
   - For immutable Vite-hashed assets (matching `/\/assets\/.+-[A-Za-z0-9_-]{8}\./`), check `await caches.match(url)` across existing `ballistics-sw-*` caches first; if already present, `cache.put(url, cached)` directly instead of re-fetching over the network. Fall back to `cache.add(url)` only on a cache miss.
4. Remove the duplicate root files `app/apple-touch-icon.png` and `app/favicon.svg` (keep `app/public/apple-touch-icon.png` and `app/public/favicon.svg`), and fold `initTools()` into `app/ballistics.js` `init()` so the redundant inline `<script type="module">` block at `app/index.html:507-510` is removed.

**Coverage:** 100% Jest (`tests/sw.test.js`, `tests/ballistics.test.js`, `tests/index-html.test.js`). Tests: (a) SW registration waits for `load` when `readyState !== 'complete'` and registers immediately when `'complete'`; (b) `handleInstall` copies already-cached immutable hashed assets without calling `fetch`/`cache.add` and fetches uncached or unhashed URLs normally; (c) deterministic build check verifies two back-to-back builds produce identical `dist/sw.js`.

**Acceptance:**

- First-visit cold load (Fast 4G): zero SW precache requests fire before `window.load`; `vendor-*.js` is not downloaded until Compute is clicked.
- Deploying a UI-only change to `ballistics.js` causes returning visitors' SW update to fetch only the changed entry chunk + `index.html` (~15–25 KB) instead of re-fetching fonts and unchanged chunks (~300 KB).
- Two consecutive `npm run build` runs emit byte-identical `dist/sw.js`.
- `app/index.html` contains only one `<script type="module">` tag.
- `npm test` passes at 100/100/100/100.

---

### ~~PERF-25 · CSS compositor & paint hygiene · FE · Size XS~~ ✅ Done

Audit of `app/ballistics.css` revealed four concrete layout/paint inefficiencies:
1. `body::before` (`app/ballistics.css:138-151`) renders a full-viewport `position: fixed; z-index: 9999` `repeating-linear-gradient` scanline overlay without layer promotion or containment, forcing full-viewport alpha compositing/repainting over scrolling panels and animating canvases on lower-end GPUs.
2. Ten rules use `transition: all 0.15s` (lines 291, 408, 461, 775, 794, 822, 840, 1128, 1167, 1208), and `.bullet-card::before` (line 303) animates layout-triggering `width: 3px → 4px` instead of compositor-only `transform: scaleX(...)`.
3. `PERF-10` added `contain-intrinsic-block-size: auto 380px` on `.chart-panel` (line 488), but the `@media (max-width: 900px)` (line 729) and `@media (max-width: 500px)` (line 735) breakpoints shrink `.chart-wrap` height without overriding `contain-intrinsic-block-size`, causing scrollbar jumps on mobile.
4. `#dataTable` uses default `table-layout: auto` (two-pass column sizing on every table render/sort), and `.empty-state .crosshair-big svg` runs an infinite 20 s rotation animation without a `@media (prefers-reduced-motion: reduce)` pause.

**Work items:**

1. On `body::before`, add `contain: strict; will-change: transform;` (or `transform: translateZ(0)`) so the scanline overlay stays on an isolated compositor layer and never invalidates paint on scroll/chart redraws.
2. Replace all 10 `transition: all 0.15s` declarations with explicit paint-cheap property lists (e.g., `transition: border-color 0.15s, background-color 0.15s, color 0.15s`).
3. Refactor `.bullet-card::before` to fixed `width: 4px; transform: scaleX(0.75); transform-origin: left; transition: transform 0.2s;` and `.bullet-card.active::before { transform: scaleX(1); }` so bullet selection animates strictly on the compositor thread.
4. Add measured `contain-intrinsic-block-size` overrides for `.chart-panel` inside `@media (max-width: 900px)` (`auto 340px`) and `@media (max-width: 500px)` (`auto 320px`).
5. Add `table-layout: fixed;` with explicit `<colgroup>` / column widths on `#dataTable` so large table renders skip two-pass intrinsic column measurement.
6. Extend `@media (prefers-reduced-motion: reduce)` (`app/ballistics.css:1374`) to disable `.empty-state .crosshair-big svg` animation and sidebar/button transitions.

**Coverage:** CSS-only change (plus optional `<colgroup>` in `app/index.html`). Existing JS coverage stays at 100/100/100/100; add a lightweight regex check in `tests/` (or verify in PR) that `transition: all` count in `app/ballistics.css` is `0`.

**Acceptance:**

- `grep -c 'transition: all' app/ballistics.css` returns `0`.
- DevTools Rendering → "Paint flashing" shows scrolling `.chart-container` and toggling `.bullet-card` no longer flashes the full viewport or sibling cards.
- Mobile (≤500 px) scrolling through chart panels shows no scrollbar jump as off-screen panels enter view.
- `prefers-reduced-motion: reduce` stops the empty-state SVG spin animation.
- `npm test` passes at 100/100/100/100.

---

## Sprint 13 — Deep Performance Optimization

**Sprint Goal:** Unlock true Chart.js tree-shaking (−70–90 kB from `vendor-*.js`), cut critical-path initial entry JS by ~35% (strip unused catalog metadata + code-split Tools, CSV drag parser, and Export/Import), eliminate worker structured-clone stalls via zero-copy Transferable `Float64Array` buffers, accelerate `solveBC` and the RK4 inner loop by another 3–5× / 15–25%, remove O(N) sidebar/crosshair DOM overhead, eliminate dead/duplicate font assets & font-swap CLS, minify HTML/SW/CSS natively in Vite 8, and remove duplicate `npm ci` + `npm run build` from CI Pages deploys.

**Measured post-Sprint-12 baseline (`main` @ `799e10c`):**
- `dist/assets/vendor-*.js`: **204,706 B (204.70 kB)** — still bundles 13+ unused Chart.js controllers/scales/plugins (`BarController`, `BubbleController`, `CategoryScale`, `DoughnutController`, `Filler`, `LogarithmicScale`, `PieController`, `PolarAreaController`, `RadarController`, `RadialLinearScale`, `ScatterController`, `SubTitle`, `TimeScale`) because `import('chart.js')` is a dynamic namespace import.
- `dist/assets/index-*.js`: **84,560 B (84.56 kB)** — includes 14,983 B of `virtual:bullet-catalog` (of which 7,234 B are unread `description`/`caliber` strings), eager `app/tools.js` (15,397 B source), eager `app/drag-csv.js` (3,078 B source), and eager export/import handlers (~8.5 kB source).
- `dist/index.html`: **24,366 B** (5,386 B / 22.1% comments and indentation whitespace).
- `dist/assets/index-*.css`: **24,540 B** (includes 3 duplicate Orbitron `@font-face` blocks, 1 unused `rajdhani-700` `@font-face` block, and dead `.retry-btn` rules).
- `dist/sw.js`: **5,573 B** (unminified copy of `app/sw.js` with comments and whitespace).
- `app/fonts/`: **95,296 B** across 7 files (`orbitron-{400,700,900}.woff2` are 3 byte-identical 11,800 B copies of the same variable font; `rajdhani-700.woff2` is 15,688 B and renders zero glyphs in its `unicode-range`).
- Worker transport: `engine.worker.ts` structured-clones up to 5,001 `TrajectoryPoint` objects per bullet (25,005 objects for 5 bullets at 5 000 m / 1 m step) plus echoes `bullet` and `params`.
- `solveBC`: runs 18 fixed pure-bisection iterations, each calling `findZeroAngleFps` cold over `[-0.05, 0.05]`.
- CI deploy (`push` to `main`): `pages-build` spins up a second runner and repeats `npm ci` + `npm run build` after `frontend-build` already built `dist/`.

**Merge & parallelization plan:**
- **Track A (Bundle & Code-Splitting — stacked):** `PERF-26 → PERF-27 → PERF-28` (all touch `app/ballistics.js` / `vite.config.js` bundle boundaries; merge in sequence).
- **Track B (Physics Engine & Zero-Copy Worker — stacked):** `PERF-29 → PERF-30` (touch `app/physics/*`; can run in parallel with Track A).
- **Track C (UI Runtime, Viewport-Aware Crosshair & DOM — stacked):** `PERF-31 → PERF-32` (touch `app/ballistics.js` runtime hot paths; stack cleanly after Track A or rebase onto `main`).
- **Track D (Fonts, Build Pipeline & CI — independent/stacked):** `PERF-33 → PERF-34 → PERF-35` (fonts/CSS/HTML, Vite config & minification, CI deploy pipeline).

---

### ~~PERF-26 · Tree-shake Chart.js via static named-import lazy wrapper (`app/chart-loader.js`) · FE · Size XS~~ ✅ Done

`PERF-21` removed `CategoryScale` from `Chart.register(...)`, yet `dist/assets/vendor-ClZs5zoC.js` stayed **204,706 bytes (204.70 kB)**. Because `_loadChart()` (`app/ballistics.js:111-125`) calls `import('chart.js')` directly — a dynamic namespace import — Rolldown must preserve every export of the `chart.js` barrel. Verified via grep on `dist/assets/vendor-*.js`, at least 13 unused controllers, scales, and plugins (`BarController`, `BubbleController`, `CategoryScale`, `DoughnutController`, `Filler`, `LogarithmicScale`, `PieController`, `PolarAreaController`, `RadarController`, `RadialLinearScale`, `ScatterController`, `SubTitle`, `TimeScale`) are still shipped on first Compute.

**Work items:**

1. Create `app/chart-loader.js` containing only static named re-exports of the 8 symbols actually used by the app:
   ```js
   export {
     Chart,
     LineController,
     LineElement,
     PointElement,
     LinearScale,
     Decimation,
     Tooltip,
     Legend,
   } from 'chart.js';
   ```
2. Update `_loadChart()` in `app/ballistics.js:113` to call `import('./chart-loader.js')` instead of `import('chart.js')`, preserving `mod.Chart.register(...)`, promise memoization, rejection eviction, and `_warmChart()` overlap.
3. Verify `vite.config.js` `codeSplitting.groups` still places `chart.js` + `@kurkle` in the lazy `vendor-*.js` chunk (not pulled into `index-*.js`) and that `sw.js` precache still excludes `vendor-*.js`.
4. Add a build-verification check (or test against built `dist/` / PR check) confirming none of `BarController`, `PieController`, `DoughnutController`, `CategoryScale`, `TimeScale`, or `RadarController` remain in `dist/assets/vendor-*.js`, and record exact before/after byte sizes in the PR description.

**Coverage:** 100% Jest (`tests/ballistics.test.js` + `tests/__mocks__/chart.js`). Update any Jest mock/spy targeting `import('chart.js')` to work seamlessly through `app/chart-loader.js` (`moduleNameMapper` still maps `^chart\.js$` to `tests/__mocks__/chart.js`). Note: pure re-export files have 0 executable statements; if any helper logic is placed in `app/chart-loader.js`, add it to `package.json` `collectCoverageFrom` at 100%.

**Acceptance:**

- `dist/assets/vendor-*.js` shrinks by ≥30% (from 204.70 kB to ≤140 kB raw).
- Zero unused Chart.js controllers/scales (`BarController`, `PieController`, `DoughnutController`, `CategoryScale`, `TimeScale`, `RadarController`) appear in `dist/assets/vendor-*.js`.
- `vendor-*.js` remains lazy-loaded (not modulepreloaded in `dist/index.html` and not precached in `dist/sw.js`).
- `npm test` passes at 100/100/100/100.

**Dependencies:** None.

---

### ~~PERF-27 · Strip unread catalog prose from `virtual:bullet-catalog` & prune dead chart config code · FE · Size XS~~ ✅ Done

`virtual:bullet-catalog` (`vite.config.js:45-62`) embeds all 37 rounds from `app/data/bullets.yaml` into the initial `dist/assets/index-*.js` entry bundle (**14,983 bytes**). Audit of `app/*.js`, `app/physics/*.ts`, and `app/index.html` confirms **zero runtime reads** of `.description` (37 entries = **6,350 bytes**) and **zero runtime reads** of `.caliber` (37 entries = **884 bytes**) — **7,234 bytes (48.3%)** of the bundled catalog is dead payload downloaded and parsed before first paint. Additionally, `buildChartConfig()` (`app/ballistics.js:976-987`) builds an unused local `annotations = { refLine: ... }` object (leftover from `chartjs-plugin-annotation`), and `velocityChart` (`app/ballistics.js:1179`) passes an unused `refLine` property.

**Work items:**

1. In `vite.config.js` `bulletCatalogPlugin()`, project each entry of `data.app.bullets` to only the 8 runtime-consumed fields (`id`, `name`, `bulletWeightGrams`, `muzzleVelocityMps`, `ballisticCoefficient`, `bulletDiameterMm`, `muzzleEnergyJoules`, `hexColor`), omitting `description` and `caliber` from the emitted virtual module while leaving `app/data/bullets.yaml` untouched as documentation.
2. In `app/physics/types.ts:21`, change `readonly caliber: string` to `readonly caliber?: string` (matching `description?: string` on line 27). Keep `caliber: 'Custom'` in `app/custom-bullets.js:317` so `tests/custom-bullets.test.js:744` stays unchanged.
3. Remove the dead `annotations` / `def.refLine` block in `buildChartConfig()` (`app/ballistics.js:976-987`), remove the unused `refLine` property on `velocityChart` (`app/ballistics.js:1179`), and remove/update the dead-code coverage tests at `tests/ballistics.test.js:881-968`.
4. Verify `dist/assets/index-*.js` contains zero `description:` keys and record before/after entry-chunk byte size in the PR description.

**Coverage:** 100% Jest. Add a unit check (e.g. in a lightweight Vite plugin test or `tests/`) verifying the catalog projection preserves all 8 required physics/UI fields for every round in `app/data/bullets.yaml` and strips `description` and `caliber`.

**Acceptance:**

- `dist/assets/index-*.js` shrinks by ≥7.0 kB (from 84.56 kB to ≤77.5 kB).
- `grep -c 'description:' dist/assets/index-*.js` returns `0`.
- All 37 built-in bullets render and simulate identically; `tests/fixtures/spa1-golden.json` passes unchanged.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-26.

---

### ~~PERF-28 · Lazy-load secondary feature modules (`tools.js`, `drag-csv.js`, extracted `io.js`) out of initial entry bundle · FE · Size M~~ ✅ Done

Even after `PERF-27`, `app/ballistics.js:1-13` eagerly statically imports modules that are hidden or unused on initial page load:
- `app/tools.js` (**15,397 B** source) — only used when the user opens the hidden **Tools** tab (`#toolsPanel`), yet initialized eagerly inside `init()` (`app/ballistics.js:1926-1928`).
- `app/drag-csv.js` (**3,078 B** source) — only used when the user uploads a custom drag-curve CSV (`#dragTableFile` `change` event at `app/ballistics.js:1966`).
- Export / Import handlers (`_downloadBlob`, `csvCell`, `exportTrajectoryCSV`, `exportCSV`, `exportJSON`, `importResultsFromFile`, `exportMarkdown`, `exportPNG` at `app/ballistics.js:61-65, 395-615`, ~230 lines / ~8.5 kB source) — only executed on user Export/Import clicks.

**Work items:**

1. Extract the pure/self-contained export & import routines into a new `app/io.js` module (accepting dependencies such as `computeAdjustments`, `escapeHtml`, `HEX_COLOR_RE`, `onError`, `onImported` as clean parameters so there are zero import cycles with `app/ballistics.js`).
2. Add memoized lazy loaders `_loadIo()`, `_loadTools()`, and `_loadDragCsv()` in `app/ballistics.js` (each clearing its cached promise on rejection so transient offline failures can retry, matching `_loadChart()`).
3. Remove the eager static imports of `tools.js` and `drag-csv.js` from `app/ballistics.js:1,5`:
   - Wire `#dragTableFile` `change` handler to `await _loadDragCsv()` before calling `parseDragCsv(...)`.
   - Defer `initTools()`, `initDopeCard(simulateAsync)`, and `initBcSolver(simulateAsync, solveBCAsync)` until the first time the Tools tab activates (`switchTab('tools', ...)`, initializing once via `_toolsInitialized` guard and immediately flushing `renderDopeCard` when `_dopeDirty` is true). If `location.search` already contains `dopeDistances=`, preserve URL restoration when Tools initializes.
   - Wire export/import button handlers and the thin `app/ballistics.js` wrapper exports (`exportTrajectoryCSV`, `exportCSV`, `exportJSON`, `exportMarkdown`, `exportPNG`, `importResultsFromFile`) to delegate lazily to `_loadIo()`. Update synchronous call sites in `tests/ballistics.test.js:2185-2300` to `await` the async wrappers, and add dedicated unit tests for `app/io.js` in `tests/io.test.js`.
4. Add `app/io.js` to `package.json` `collectCoverageFrom`. Keep the small lazy feature chunks (`tools-*.js`, `io-*.js`, `drag-csv-*.js`) in `dist/sw.js` post-`load` precache so offline PWA support for Tools/Export stays 100% intact without impacting FCP/LCP/TTI (since SW install is deferred past `window.load` by `PERF-24`).

**Coverage:** 100% Jest across `app/ballistics.js`, `app/io.js`, `app/tools.js`, and `app/drag-csv.js`. Tests: (a) initial `init()` does not initialize Tools or parse CSV; (b) first `switchTab('tools', ...)` loads and initializes Tools once and renders dirty DOPE data; (c) failed dynamic import resets loader promise and recovers on retry; (d) CSV/JSON/Markdown/PNG export and JSON import sanitization paths retain 100% branch coverage in `tests/io.test.js` and `tests/ballistics.test.js`.

**Acceptance:**

- `dist/assets/index-*.js` shrinks to ≤60 kB (down from 84.56 kB baseline — ≥28% reduction in critical-path entry JS).
- Vite emits separate lazy chunks for `tools`, `io`, and `drag-csv` that are **not** `<link rel="modulepreload">`ed in `dist/index.html`.
- Initial page load (Charts tab) downloads and evaluates zero bytes of `tools`, `io`, or `drag-csv`.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-27.

---

### ~~PERF-29 · Zero-copy Transferable `Float64Array` worker protocol for trajectory results · FE · Size M~~ ✅ Done

`app/physics/engine.worker.ts:52-53` posts `{ id, result }` across the Web Worker boundary via structured clone. At fine step sizes (`maxRangeMeters: 5000, stepMeters: 1`), a single bullet produces **5,001 `TrajectoryPoint` objects** (25,005 objects / ~200,000 named properties for 5 bullets), causing noticeable structured-clone serialization stalls on the worker and polymorphic deserialization GC pauses on the main thread. In addition, the worker echoes back copies of `bullet` and `params` that the main thread already holds in memory.

**Work items:**

1. Create `app/physics/packed-points.ts` (added to `package.json` `collectCoverageFrom`):
   - Define `export const POINT_STRIDE = 8;` laying out `[rangeMeters, dropCm, velocityMps, energyJoules, windDriftCm, timeOfFlightSec, spinDriftCm, coriolisDeflectionCm]` per point inside a flat `Float64Array` (storing `NaN` in slot 7 when `coriolisDeflectionCm` is absent).
   - Export `packPoints(points: readonly TrajectoryPoint[]): { buffer: Float64Array; hasCoriolis: boolean }` and `unpackPoints(buffer: Float64Array, hasCoriolis: boolean): TrajectoryPoint[]` (pre-allocating `new Array(count)` and writing monomorphic object literals — omitting `coriolisDeflectionCm` when `!hasCoriolis` or `Number.isNaN(cor)` so output is structurally and bit-identically equal to `simulate()`).
2. Update `app/physics/engine.worker.ts` to pack `result.points` via `packPoints(result.points)`, omit echoing `bullet` and `request`, and transfer ownership zero-copy with `self.postMessage(response, [buffer.buffer])`.
3. Update `app/physics/engine-async.ts` to store `{ bullet, params }` on the pending simulation task, reconstruct `TrajectoryResult` on worker response by re-attaching the caller's exact `bullet` and `params` references plus `unpackPoints(evt.data.pointsBuffer, evt.data.hasCoriolis)`, and keep the LRU cache storing the reconstructed `TrajectoryResult`.
4. Benchmark 5-bullet, 5 000 m, 1 m-step (25 005 points) worker transfer & unpack latency before and after in the PR description.

**Coverage:** 100% Jest (`tests/physics/packed-points.test.ts` + updated `tests/physics/engine-async.test.ts`). Tests: (a) `packPoints` / `unpackPoints` round-trips empty, standard (no Coriolis), Coriolis-enabled, and mixed/negative-zero points identically; (b) `engine.worker.ts` passes `[buffer.buffer]` in the `postMessage` transfer list and does not echo `bullet`/`request`; (c) `simulateAsync` returns the caller's exact `bullet` and `params` references (`toBe`) and identical `points` array.

**Acceptance:**

- `engine.worker.ts` transfers `Float64Array.buffer` in the `postMessage` transfer list (zero-copy handoff) and stops echoing `bullet` and `params`.
- `unpackPoints(packPoints(result.points))` matches every case in `tests/fixtures/spa1-golden.json` bit-identically (including exact key presence/absence for `coriolisDeflectionCm`).
- 5-bullet, 5 000 m, 1 m-step worker round-trip overhead drops by ≥50%.
- `npm test` passes at 100/100/100/100.

**Dependencies:** None.

---

### ~~PERF-30 · Safeguarded secant + warm-bracket `solveBC` & hoisted branchless RK4 inner loop · FE · Size S~~ ✅ Done

Two CPU hot paths remain in `app/physics/engine.ts`:
1. `solveBC()` (`app/physics/engine.ts:549-577`) still uses **pure bisection** (`hi - lo > 1e-5` over `[0.001, 1.5]`), unconditionally running **18 full trajectory integrations** (`evalDropCmAtRange`), and every call to `evalDropCmAtRange` (`app/physics/engine.ts:491`) invokes `findZeroAngleFps` cold over `[-0.05, 0.05]` (~8 zero-angle passes × 18 = ~144 zero-range RK4 passes + 18 full-range passes per BC solve).
2. Inside the RK4 inner loops (`evalHeightAtZero:267-300`, `integrateTrajectoryFps:360-422`, `evalDropCmAtRange:501-537`), each of the 4 RK4 stages calls `findBracket(v, ct, idx)` followed immediately by `evalCompiledDrag(v, ct, idx)`, running duplicate boundary checks (`v <= ct.v[0]` and `v >= ct.v[ct.last]` checked **8 times per step** instead of 4) plus repeated property lookups (`ct.v`, `ct.f`, `ct.dv`, `ct.df`, `ct.last`) on every stage.

**Work items:**

1. In `solveBC()` (`app/physics/engine.ts:569-576`), replace pure bisection with **safeguarded secant + bisection fallback** (evaluating bracket endpoints `lo = 0.001, hi = 1.5`, falling back to `(lo + hi) / 2` whenever the secant estimate exits `(lo + 0.05 * span, hi - 0.05 * span)` or denominator is zero, and terminating once `Math.abs(drop - measuredDropCm) <= 1e-3` or `hi - lo <= 1e-5`), cutting typical BC iterations from 18 down to ~5–7.
2. Add an optional `hintAngle?: number` parameter to `findZeroAngleFps` (defaulting to cold `[-0.05, 0.05]` so existing callers/tests are unchanged): when provided by `evalDropCmAtRange` from the previous BC candidate's converged angle, probe a tight bracket `[hint - 0.002, hint + 0.002]` first and fall back to `[-0.05, 0.05]` only if the root is not bracketed, cutting inner zero-finder passes per BC step by ~2×.
3. In `evalHeightAtZero`, `integrateTrajectoryFps`, and `evalDropCmAtRange`, hoist `vArr = ct.v`, `fArr = ct.f`, `dvArr = ct.dv`, `dfArr = ct.df`, `last = ct.last`, `vMin = vArr[0]!`, `vMax = vArr[last]!`, `fMin = fArr[0]!`, `fMax = fArr[last]!` into loop-invariant locals and fuse bracket advance + piecewise linear interpolation into a single bounds-checked step per RK4 stage — preserving the **exact** IEEE-754 arithmetic order `fArr[idx - 1]! + ((v - vArr[idx - 1]!) / dvArr[idx]!) * dfArr[idx]!` and `-(vx / vel) * d` so `tests/fixtures/spa1-golden.json` remains 100% bit-identical. Keep exported `findBracket` and `evalCompiledDrag` intact for unit tests.
4. Record median wall time before and after for (a) `solveBC` (`.308 Win 168gr`, 500 m & 1 000 m) and (b) 5-bullet, 2 000 m, 1 m-step `simulate()` in the PR description.

**Coverage:** 100% Jest (`tests/physics-engine.test.js`). Tests: (a) `solveBC` matches known G1 BCs to within `±0.0002` across `.223`, `.308`, `.338 Lapua`, edge clamps (out-of-bracket drop returning clamped bound or `null`), and bisection-fallback branch; (b) `findZeroAngleFps` warm-hint hit and wide-bracket fallback branches are both covered; (c) `tests/fixtures/spa1-golden.json` passes **without** regeneration.

**Acceptance:**

- `solveBC` wall time drops by ≥3× (typical convergence in ≤8 BC iterations vs. 18).
- 5-bullet, 2 000 m, 1 m-step `simulate()` median wall time improves by ≥15% on top of `PERF-15`/`PERF-16`.
- `tests/fixtures/spa1-golden.json` passes bit-identically without regeneration.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-29.

---

### ~~PERF-31 · Sidebar event delegation, O(1) bullet Map lookup, targeted single-card toggle & single-pass boot render · FE · Size S~~ ✅ Done

Four unnecessary `O(N)` DOM and JS loops remain in the sidebar and lookup paths of `app/ballistics.js`:
1. `renderBulletList()` (`app/ballistics.js:218-260`) runs 37 `document.getElementById('card-' + b.id)` queries and registers **74 individual `click`/`keydown` closures** on every render.
2. `init()` (`app/ballistics.js:1787-1814`) calls `renderBulletList()` while `selectedIds` is still empty, then 27 lines later calls `updateBulletCards()`, touching all 37 card DOM nodes a second time on page boot.
3. `toggleBullet(id)` (`app/ballistics.js:262-269`) invokes `updateBulletCards()` (`app/ballistics.js:271-285`), scanning and mutating **all 37+ cards** via 37+ `getElementById` calls whenever a user toggles **1** bullet.
4. `computeClientSide()` (`app/ballistics.js:208`) and `runSweep()` (`app/ballistics.js:1522`) perform linear `bullets.find(b => b.id === id)` scans on every dispatch.

**Work items:**

1. Add a module-level `_bulletById = new Map()` index maintained by a single `_setBullets(list)` helper (used everywhere `bullets` is assigned, plus `_resetState()`), and replace `bullets.find(b => b.id === id)` in `computeClientSide` and `runSweep` with `_bulletById.get(id)`.
2. Emit `data-bullet-id="${escapeHtml(b.id)}"` and conditional `active` class directly on built-in `.bullet-card` elements in `renderBulletList()`, and wire **one** delegated `click` + **one** delegated `keydown` (`Enter` / `' '`) listener on `#bulletList` in `init()` (with `{ signal }`, ignoring clicks inside `.bullet-card-actions` or custom bullet buttons so custom Edit/Delete behavior is unchanged). Remove the 74 per-card `addEventListener` calls in `renderBulletList()`.
3. In `init()`, restore `selectedIds` from URL/prefs **before** calling `renderBulletList()` so initial markup already reflects active cards in a single DOM write pass (skipping the redundant full-list `updateBulletCards()` loop on startup; keep `syncSelectAllCheckbox()` and `syncRunButton()`).
4. Add `_syncSingleBulletCard(id)` and call it from `toggleBullet(id)` instead of scanning all 37+ cards via `updateBulletCards()` (keep `updateBulletCards()` for bulk operations such as `selectAllBullets` and custom-bullet mutations).

**Coverage:** 100% Jest (`tests/ballistics.test.js`). Tests: (a) clicking and pressing Enter/Space on delegated built-in cards toggles selection; (b) clicks inside `.bullet-card-actions` do not toggle the card; (c) `toggleBullet` updates only the target card's `active` class and `aria-pressed` attribute without querying sibling cards; (d) `init()` renders selected cards `.active` in one pass; (e) `_bulletById` stays synced after `_setBullets` and custom bullet add/delete.

**Acceptance:**

- `renderBulletList()` attaches 0 per-card listeners for built-in bullets (only 2 delegated listeners on `#bulletList`).
- Toggling a bullet mutates 1 `.bullet-card` node instead of 37+.
- Page boot renders `#bulletList` with initial `.active` state in a single pass.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-28 (or rebase cleanly on `app/ballistics.js`).

---

### ~~PERF-32 · Viewport-aware crosshair redraws (`IntersectionObserver` + `chart.draw()`), cached readout cells & sweep chart reuse · FE · Size S~~ ✅ Done

Three rendering hot spots remain after `PERF-20` and `PERF-21`:
1. In `scheduleCrosshairSync` (`app/ballistics.js:878-880`), every crosshair index change invokes `c.update('none')` on **all 4 sibling Chart.js instances**, running Chart.js's full `update()` pipeline (datasets, scales, layout) even though only `crosshairPlugin.afterDraw`'s vertical dashed line changed — AND redrawing charts that are scrolled completely off-screen!
2. `updateReadout()` (`app/ballistics.js:818-850`) rebuilds and re-parses the entire `#readoutBody.innerHTML` HTML string on every hovered range index, creating steady DOM/GC churn during fast scrubbing.
3. `renderSweepCharts()` (`app/ballistics.js:1558-1619`) still tears down and reconstructs all 3 Chart.js instances (`cc.innerHTML = ''` + `c.destroy()` + `new Chart(...)`) every time the user switches sweep parameter (`wind` / `altitude` / `temperature`).

**Work items:**

1. Maintain a single `IntersectionObserver` (`_chartObserver`) tracking currently visible chart IDs in `_visibleChartIds` (gracefully treating all charts as visible when `IntersectionObserver` is unavailable, and disconnecting/clearing on teardown and `_resetState()`). Track skipped off-screen charts in `_dirtyCrosshairCharts`; when a dirty chart scrolls into view, redraw it immediately.
2. In `scheduleCrosshairSync`, redraw only visible sibling charts using lightweight `c.draw()` (which invokes canvas redraw + `afterDraw` plugins without recalculating datasets, scales, or layout; fall back to `c.update('none')` if `typeof c.draw !== 'function'` for mock safety). Add `_mockDraw` / `draw` to `tests/__mocks__/chart.js`.
3. Cache `#readoutBody` `<tr>` / `<td>` element references per active `results` identity (invalidated in `renderResults` / `_resetState`): on subsequent `updateReadout()` calls for the same result set, update only `.textContent` on existing cells instead of re-parsing `tbody.innerHTML`.
4. Extend `PERF-21`'s in-place instance reuse to `renderSweepCharts()` (`SWEEP_CHART_IDS = ['sweepDropChart', 'sweepWindChart', 'sweepVelChart']`): when all 3 sweep charts already exist, update subtitles, `data.datasets`, `_chartMeta` references, and `options.animation` in place instead of destroying and recreating the canvases.

**Coverage:** 100% Jest (`tests/ballistics.test.js`). Tests: (a) off-screen sibling charts are skipped during `scheduleCrosshairSync` and drawn when `IntersectionObserver` marks them intersecting; (b) visible sibling charts call `draw()` instead of `update('none')`; (c) fallback path when `IntersectionObserver` is unavailable redraws all sibling charts; (d) consecutive `updateReadout` calls on the same `results` reuse existing `<tr>` nodes without replacing `tbody.innerHTML`; (e) consecutive `renderSweepCharts` calls reuse existing Chart instances (`destroy` called 0 times, `update` called once per sweep chart).

**Acceptance:**

- Hovering across Chart 1 while Charts 3–5 are below the fold invokes `draw()` only on visible sibling charts (0 `update('none')` calls during scrub).
- Zero `#readoutBody.innerHTML` reparses occur after the first hover frame of a simulation result.
- Switching Sweep parameter (`wind` → `altitude` → `temperature`) reuses all 3 sweep Chart instances with zero canvas reallocations.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-31.

---

### ~~PERF-33 · Font deduplication, dead weight removal (`rajdhani-700`) & metric-matched fallback fonts for 0.000 CLS · FE · Size XS~~ ✅ Done

Audit of `app/fonts/`, `app/ballistics.css`, and `app/index.html` revealed three concrete font wastes:
1. `app/fonts/orbitron-400.woff2`, `orbitron-700.woff2`, and `orbitron-900.woff2` are **3 byte-for-byte identical copies** (11,800 B each, SHA-256 `c25a9f9da5d9f3db...`) of the Orbitron variable font, emitting 3 redundant `@font-face` blocks in `dist/assets/index-*.css`.
2. `app/fonts/rajdhani-700.woff2` (**15,688 bytes**) never renders a single glyph: the only non-Orbitron `font-weight: 700` rule in all of `app/ballistics.css` is `.bullet-card.active .check::after { content: '✓'; font-weight: 700; }` (line 340), and `✓` (U+2713) is outside `rajdhani-700.woff2`'s `unicode-range`! Yet it ships in `dist/assets/` and is eagerly precached by `dist/sw.js`.
3. `rajdhani-600.woff2` (15,732 B) is used by all 37 above-the-fold `.bullet-name` cards (`app/ballistics.css:343-350`) but is not preloaded in `app/index.html:17-19`, and none of the 3 webfont families declare metric-adjusted fallback `@font-face` descriptors (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`) to prevent CLS during `font-display: swap`.

**Work items:**

1. Replace the 3 identical `orbitron-{400,700,900}.woff2` files in `app/fonts/` with a single `app/fonts/orbitron.woff2` (11,800 B), collapse `app/ballistics.css:8-37` into one variable `@font-face` declaring `font-weight: 400 900;`, and update `app/index.html` to preload `/fonts/orbitron.woff2`.
2. Delete `app/fonts/rajdhani-700.woff2` (−15,688 B from `dist/` and SW precache), remove its `@font-face` block (`app/ballistics.css:60-69`), and change `.bullet-card.active .check::after` (`app/ballistics.css:340`) to `font-weight: 600;` (or `font-family: system-ui, sans-serif;`).
3. Add `<link rel="preload" href="/fonts/rajdhani-600.woff2" as="font" type="font/woff2" crossorigin>` in `app/index.html` so above-the-fold bullet card names paint without a late font fetch.
4. Add metric-matched fallback `@font-face` declarations (`'Rajdhani Fallback'`, `'Orbitron Fallback'`, `'Share Tech Mono Fallback'` using `local(...)` + measured `size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`) in `app/ballistics.css` and insert them before `sans-serif`/`monospace` in font-family stacks.
5. Update `tests/fonts.test.js` (to support variable weight ranges like `400 900` and allow `local()` fallback `@font-face` blocks) and `tests/index-html.test.js` (`REQUIRED_PRELOADS`).

**Coverage:** 100% Jest (`tests/fonts.test.js`, `tests/index-html.test.js`, `tests/css-perf.test.js`). Add an assertion in `tests/fonts.test.js` verifying no two `.woff2` files in `app/fonts/` have identical SHA-256 hashes.

**Acceptance:**

- `app/fonts/` drops from 7 files (95.3 kB) to 4 unique files (56.0 kB — −39.3 kB); `dist/assets/` & `dist/sw.js` precache drop `rajdhani-700-*.woff2` (−15.7 kB).
- `dist/assets/index-*.css` contains 4 webfont `@font-face` blocks (down from 7) plus metric-matched fallback blocks.
- Lighthouse CLS on throttled cold load is `0.000`.
- `npm test` passes at 100/100/100/100.

**Dependencies:** None.

---

### ~~PERF-34 · Build pipeline optimization: native ESM `vite.config.mjs`, HTML/SW minification & Lightning CSS · FE / DevOps · Size S~~ ✅ Done

Four build-output and build-speed inefficiencies remain in `vite.config.js`:
1. `vite.config.js` uses ESM `import`/`export` without `"type": "module"` in `package.json`, forcing Vite 8 to log an `ESM syntax in a file loaded as CommonJS` warning and bundle the config via CJS fallback on every run.
2. `dist/index.html` is **24,366 bytes** unminified — containing HTML comments and **5,386 bytes (22.1%)** of indentation/inter-tag whitespace shipped on every cold navigation.
3. `dist/sw.js` is **5,573 bytes** unminified because `serviceWorkerPlugin()` copies `app/sw.js` verbatim with comments and whitespace.
4. Vite 8 already includes `lightningcss` (`^1.33.0`) and `rolldown` (`~1.2.18`), yet CSS uses the legacy minifier and `app/ballistics.css` still retains dead `.retry-btn` rules left over from the deleted Java backend.

**Work items:**

1. Rename `vite.config.js` → `vite.config.mjs` and update `.github/workflows/ci.yml:36` `paths-filter` to watch `'vite.config.mjs'`, eliminating the Vite CJS-fallback warning and speeding up build startup.
2. Add a zero-dependency `htmlMinifyPlugin()` in `vite.config.mjs` (`transformIndexHtml` with `enforce: 'post'`) that strips `<!-- ... -->` comments and collapses inter-tag whitespace/indentation while preserving `<script>`, `<style>`, `<pre>`, `<textarea>`, and attribute spacing.
3. Inside `serviceWorkerPlugin()`, minify the emitted `dist/sw.js` deterministically using Vite 8's built-in Oxc/Rolldown minifier (verify exact Vite 8 API such as `transformWithOxc` / `rolldown` — zero new npm dependencies!) while preserving `CACHE_VERSION`, `STATIC_ASSETS_TO_PRECACHE`, and ES module exports.
4. Enable `css: { transformer: 'lightningcss' }` and `build: { cssMinify: 'lightningcss' }` in `vite.config.mjs` (verifying `dist/assets/index-*.css` renders identically and shrinks or matches size) and remove dead `.retry-btn` CSS rules from `app/ballistics.css`.
5. Record exact before/after sizes of `dist/index.html`, `dist/sw.js`, and `dist/assets/index-*.css`, plus verify two back-to-back builds emit byte-identical `dist/sw.js` and `dist/index.html`, in the PR description.

**Coverage:** 100% Jest (add/update `tests/css-perf.test.js` or build check if appropriate; no runtime JS changes in `app/`).

**Acceptance:**

- `npm run build` outputs zero `ESM syntax in a file loaded as CommonJS` warnings.
- `dist/index.html` shrinks from 24.37 kB to ≤19.5 kB (−20%+).
- `dist/sw.js` shrinks from 5.57 kB to ≤3.5 kB (−35%+), and two consecutive builds produce byte-identical `dist/sw.js`.
- `.retry-btn` is removed from `app/ballistics.css`.
- `npm test` passes at 100/100/100/100.

**Dependencies:** PERF-33.

---

### ~~PERF-35 · Eliminate duplicate `npm ci` + `npm run build` in CI GitHub Pages deploy pipeline · DevSecOps / CI · Size XS~~ ✅ Done

On every push to `main`, `.github/workflows/ci.yml:188-228` runs `pages-build` (`needs: [frontend-build]`), which boots a brand-new `ubuntu-24.04` runner and repeats `actions/checkout`, `actions/setup-node`, `~/.npm` cache restore, `npm ci`, and `npm run build` solely to upload `dist/` via `actions/upload-pages-artifact` — even though `frontend-build` (which has the exact same unprivileged `contents: read` permissions) just completed `npm run build` and `npm test -- --ci` seconds earlier.

**Work items:**

1. Check GitHub branch protection rules first (via `gh api`) to confirm whether `Pages Build` is a required status check:
   - **Preferred (when `Pages Build` is not a required status check):** Move `actions/configure-pages` and `actions/upload-pages-artifact` (`path: dist`) to the end of `frontend-build` (after `npm test -- --ci` succeeds), gated on `if: github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.changes.outputs.frontend == 'true'`. Remove the redundant `pages-build` job and update `deploy` to `needs: [changes, frontend-build, codeql, trivy]` with `if: github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.changes.outputs.frontend == 'true'` so non-frontend pushes to `main` never fail looking for a missing Pages artifact.
   - **Fallback (if `Pages Build` must remain as a named job):** Upload `dist/` from `frontend-build` on `main` pushes via `actions/upload-artifact` and have `pages-build` download `dist/` directly and run only `configure-pages` + `upload-pages-artifact` (zero `checkout`, `setup-node`, `npm ci`, or `npm run build`).
2. Keep the privileged `deploy` job strictly isolated (`pages: write`, `id-token: write`, `environment: github-pages`), preserving the existing least-privilege security boundary.
3. Record end-to-end push-to-`main` workflow wall-clock time before and after in the PR description.

**Coverage:** CI workflow-only change; verify workflow YAML validity and that PR checks (`changes`, `frontend-build`, `codeql`, `trivy`) and `main` deploy run cleanly on GitHub Actions.

**Acceptance:**

- Pushing to `main` runs `npm ci` and `npm run build` **once** (inside `frontend-build`) instead of twice.
- Privileged `deploy` job remains isolated with `pages: write` and `id-token: write` and still gates on `frontend-build`, `codeql`, and `trivy`.
- Non-frontend pushes to `main` (e.g. `.github/dependabot.yml`) do not fail in `deploy`.
- Merge-to-Pages-live wall time decreases by ≥30 seconds.

**Dependencies:** PERF-34 (so `vite.config.mjs` is already in `paths-filter`).

---


## Sprint 14 — Field-Grade Ballistics, Units, UX & Architecture

**Sprint Goal:** Elevate the ballistics workbench from a metric-only engineering simulator into a complete field-ready ballistic solver and modular codebase — adding real G7 ballistic coefficients for all 37 catalog rounds, station barometric pressure & humidity plus opt-in vertical Coriolis (Eötvös), a global Metric/Imperial unit toggle, field DOPE windage + print layout + MPBR calculator, named rifle profiles & unified custom drag-CSV workflow, capped/searchable/keyboard-accessible sidebar controls with debounced auto-compute, modular decomposition of `app/ballistics.js` with lazy Sweep loading, modernized E2E smoke CI against built `dist/`, and clean `v3.0.0` release hygiene.

Supersedes / closes open Sprint 11 and Icebox items: `REL-1`, `REL-2`, `REL-3`, `REL-4`, `REL-5`, `REL-6`, `REL-7`, `ACC-3`, `UX-7`, `DX-2`, `SEC-3`.

---

### ~~ENH-1 · Built-in G7 ballistic coefficients for all 37 catalog rounds · Physics · Size XS [Must Have]~~ ✅ Done

`app/custom-bullets.js` (`bulletForDragModel`) already supports switching to `bullet.ballisticCoefficientG7` when `dragModel === 'G7'`, and rounds 11–37 in `app/data/bullets.yaml` already annotate their G7 equivalents in comments, yet `ballisticCoefficientG7` is absent from all 37 catalog YAML entries and `catalog-projection.cjs` strips fields outside its explicit projection list. As a result, switching the Drag Model selector to G7 still runs built-in rounds against their G1 BC.

**Work items:**

1. Add `ballisticCoefficientG7` (numeric, verified published G7 BCs where available and conservative boat-tail/flat-base G7 conversions for remaining hunting/pistol/rimfire rounds) to all 37 bullets in `app/data/bullets.yaml`.
2. Add `ballisticCoefficientG7` to `projectBulletCatalog` in `catalog-projection.cjs` and mirror it in `app/physics/types.ts` (`Bullet`), `app/io.js` (`BULLET_NUMERIC_FIELDS`), and `tests/__mocks__/bullet-catalog.js`.
3. Add unit tests verifying every round in `app/data/bullets.yaml` defines `ballisticCoefficientG7 > 0` (`< ballisticCoefficient`), `projectBulletCatalog` preserves `ballisticCoefficientG7`, and `bulletForDragModel(bullet, 'G7')` selects `ballisticCoefficientG7`.

**Coverage:** 100% Jest (`tests/bullet-catalog.test.js`, `tests/custom-bullets.test.js`, `tests/io.test.js`).

**Acceptance:**

- All 37 built-in rounds carry numeric `ballisticCoefficientG7` in `virtual:bullet-catalog` and pass schema/range validation.
- Selecting `dragModel: 'G7'` uses `ballisticCoefficientG7` for built-in rounds while preserving G1 fallback if absent.
- `npm test` passes at 100/100/100/100 and `tests/fixtures/spa1-golden.json` passes untouched.

**Dependencies:** None.

---

### ~~ENH-2 · Station barometric pressure, relative humidity & opt-in vertical Coriolis (Eötvös) · Physics · Size M [Must Have]~~ ✅ Done

External ballistics atmospheric correction currently models only altitude + temperature (`airDensityRatio`), omitting barometric pressure and relative humidity, while Coriolis deflection models horizontal drift (`coriolisDeflectionCm`) without vertical Eötvös deflection (`coriolisVerticalCm`). Care must be taken to keep all 28 existing cases in `tests/fixtures/spa1-golden.json` (including the horizontal Coriolis case) 100% key- and bit-identical.

**Work items:**

1. Extend `app/physics/types.ts`:
   - `TrajectoryParams`: optional `pressureHpa?: number | null` (`[500, 1100]`), `humidityPercent?: number | null` (`[0, 100]`), and `includeEotvos?: boolean | null`.
   - `TrajectoryPoint`: optional `coriolisVerticalCm?: number` (positive = high when firing East; key omitted unless `includeEotvos === true` and both `latitudeDeg` and `azimuthDeg` are set).
2. In `app/physics/engine.ts`:
   - Validate `pressureHpa`, `humidityPercent`, and `includeEotvos`.
   - Keep `airDensityRatio(altFt, tempF)` untouched; add exported `stationAirDensityRatio(altFt, tempF, pressureHpa, humidityPercent)` that delegates verbatim to `airDensityRatio` when both `pressureHpa` and `humidityPercent` are null/undefined, and otherwise computes moist-air density ratio via Tetens vapor pressure relative to ICAO sea-level dry air (`1013.25 hPa`, `15 °C`).
   - Compute opt-in Eötvös vertical deflection `coriolisVerticalCm = round1(EARTH_OMEGA_RADS * cos(lat) * sin(az) * mvMps * t * t * 100) + 0` when `includeEotvos === true` and both `latitudeDeg` and `azimuthDeg` are set.
3. Bump `POINT_STRIDE` in `app/physics/packed-points.ts` from `8` to `9` (`hasEotvos` + slot 8 = `coriolisVerticalCm`), propagate through `app/physics/engine.worker.ts` and `app/physics/engine-async.ts` (including `simulationCacheKey`), add `'coriolisVerticalCm'` to `POINT_NUMERIC_FIELDS` in `app/io.js`, and persist `pressureHpa`, `humidityPercent`, and `includeEotvos` in `app/url-state.js`.

**Coverage:** 100% Jest across `tests/physics-engine.test.js`, `tests/physics/` worker/packed-points tests, `tests/url-state.test.js`, and `tests/io.test.js`.

**Acceptance:**

- All 28 golden fixture cases in `tests/fixtures/spa1-golden.json` pass bit- and key-identically untouched.
- Moist air produces lower air density than dry air; higher station pressure produces higher air density; East azimuth (`90°`) yields positive `coriolisVerticalCm`, West (`270°`) yields negative, North/South yields `0`.
- Transferable stride-9 pack/unpack and URL state round-trips preserve all new fields cleanly.
- `npm test` passes at 100/100/100/100.

**Dependencies:** ENH-1 (stacked cleanly on Track A).

---

### ~~ENH-3 · Global Metric / Imperial unit system (`app/units.js`, `#unitToggle`) · FE · Size M [Must Have]~~ ✅ Done

Long-range shooters frequently work in yards, grains, feet per second, inches, °F, and inHg rather than purely SI metric units. Adding a first-class unit system toggle lets users operate seamlessly in Metric or Imperial across inputs, charts, stat cards, hover readout, data table, DOPE/MPBR tools, exports, and shared URLs while keeping physics engine internals and JSON exports canonical Metric.

**Work items:**

1. Create `app/units.js` (and add to `package.json` `jest.collectCoverageFrom`) exporting `UNIT_LABELS`, `normalizeUnitSystem`, `getUnitSystem`, `toDisplay`, `fromDisplay`, and unit conversion/formatting helpers for range (`m`/`yd`), small distance/drop/wind/spin/Coriolis (`cm`/`in`), velocity (`m/s`/`fps`), wind speed (`km/h`/`mph`), energy (`J`/`ft·lb`), weight (`g`/`gr`), temperature (`°C`/`°F`), sight height (`mm`/`in`), and pressure (`hPa`/`inHg`).
2. Add `<button type="button" id="unitToggle" class="unit-toggle" aria-pressed="false">` in `app/index.html` header next to `#themeToggle`, persist in `localStorage`, and update sidebar labels (`data-unit-kind`) plus converted input values on toggle without drift.
3. Support optional `units` query parameter in `app/url-state.js` (omit when default `'metric'`, serialize `units=imperial` when Imperial).
4. Wire unit-aware axis labels, subtitles, tick formatting, stat cards, hover readout, Data Table headers/cells, Sweep labels, DOPE/MPBR tools, and CSV/Markdown exports across `app/ballistics.js`, `app/prefs.js`, `app/charts.js`, `app/table.js`, `app/sweep.js`, `app/tools.js`, and `app/io.js` (while keeping `exportJSON` canonical Metric for lossless round-trip import).

**Coverage:** 100% Jest (`tests/units.test.js` plus unit tests across `charts`, `table`, `tools`, `io`, `url-state`, `ballistics`).

**Acceptance:**

- Toggling `#unitToggle` converts sidebar inputs, re-renders labels/charts/tables/readout/tools in Imperial (`yd`, `fps`, `in`, `ft·lb`, `mph`, `°F`, `inHg`) and restores cleanly back to Metric.
- URL sharing preserves `units=imperial` while keeping default Metric URLs backward-compatible.
- `npm test` passes at 100/100/100/100.

**Dependencies:** ENH-4, ENH-7 (built after `ENH-4` & modular split in Wave 2).

---

### ~~ENH-4 · Field DOPE windage MOA/MRAD, `@media print` pocket DOPE card (`UX-7`), & MPBR calculator · FE / UX · Size S [Must Have]~~ ✅ Done

The Tools tab DOPE card currently outputs elevation come-ups (MOA↑ / MRAD↑) only and lacks windage holds or a clean printable pocket card (`UX-7`). Hunters and field shooters also rely on Maximum Point-Blank Range (MPBR) for a target vital-zone diameter (`20 cm` / `8 in` default).

**Work items:**

1. Update `_buildDopeTable` in `app/tools.js` to include `Wind MOA` and `Wind MRAD` columns per round whenever non-zero wind drift is present (`Math.atan2(windDriftCm / 100, dist)`), keeping dynamic `colSpan` alignment with optional Coriolis columns.
2. Add `#dopePrintBtn` (`PRINT DOPE`) wired to `window.print()` plus a dedicated `@media print` stylesheet in `app/ballistics.css` hiding chrome/sidebars/tabs/other cards and formatting `#dopeTable` for crisp high-contrast pocket/A5 printing (`UX-7`).
3. Implement `calcMpbr(points, vitalZoneCm = 20)`, `initMpbrTool()`, and `renderMpbrTool(results)` in `app/tools.js` plus the `#mpbrCard` UI (`#mpbrVitalCm`, `#mpbrResults`) in `app/index.html`, hooked into `app/ballistics.js`.

**Coverage:** 100% Jest (`tests/tools.test.js`, `tests/ballistics.test.js`).

**Acceptance:**

- DOPE table includes signed `Wind MOA` and `Wind MRAD` columns when wind drift is non-zero and omits them cleanly in zero-wind runs.
- `@media print` isolates the DOPE card cleanly without nav/sidebar clutter (`UX-7`).
- MPBR calculator computes peak rise, warns if trajectory exceeds `+vitalZoneCm / 2`, and interpolates maximum point-blank range.
- `npm test` passes at 100/100/100/100.

**Dependencies:** None (Wave 1 independent track, stacked after ENH-7).

---

### ~~ENH-5 · Named rifle/setup profiles (`DX-2`), atmosphere & Eötvös controls, & unified custom drag-CSV · FE · Size M [Should Have]~~ ✅ Done

URL state allows sharing individual setups (`DX-2`), but users have no in-app way to save, switch, and delete named rifle/load profiles locally. Meanwhile, the new `ENH-2` atmosphere & Eötvös physics parameters need clean sidebar inputs, `#latitudeDeg` still displays an obsolete `"sent with computation requests over HTTPS"` tooltip from the deleted server era, and uploading a custom Mach→Cd drag CSV lives inside the legacy custom accordion rather than `#customBulletForm`.

**Work items:**

1. Create `app/profiles.js` (add to `package.json` `jest.collectCoverageFrom`) providing `loadProfiles`, `saveProfile`, `deleteProfile`, schema validation/sanitization, and `localStorage` persistence (`ballistics_profiles`, cap 20 named profiles).
2. Add `#profileBar` (`#profileSelect`, `#profileNameInput`, `#saveProfileBtn`, `#deleteProfileBtn`) to `app/index.html` sidebar (no `window.prompt`).
3. Add sidebar inputs for `#pressureHpa` (optional; `hPa` / `inHg` unit-aware), `#humidityPercent` (optional `0–100%`), and `#includeEotvos` checkbox ("Vertical Coriolis (Eötvös)"), remove stale HTTPS server wording on `#latitudeDeg`, and display `coriolisVerticalCm` in `app/table.js` and `app/tools.js` DOPE card when active.
4. Add optional Mach→Cd `.csv` input (`#cbDragCsv`) directly inside `#customBulletForm` so custom bullet creation/editing and custom drag-curve selection are unified cleanly with `app/drag-csv.js`.

**Coverage:** 100% Jest (`tests/profiles.test.js`, `tests/ballistics.test.js`, `tests/table.test.js`, `tests/tools.test.js`, `tests/custom-bullets.test.js`).

**Acceptance:**

- Users can save, load, overwrite, and delete named rifle setups across page reloads (`DX-2`).
- Sidebar atmosphere & Eötvös inputs flow end-to-end into physics worker, URL state, Data Table, and DOPE card.
- Stale `"requests over HTTPS"` copy is gone from `app/index.html`.
- `#cbDragCsv` inside `#customBulletForm` attaches validated custom drag CSV curves seamlessly.
- `npm test` passes at 100/100/100/100.

**Dependencies:** ENH-2, ENH-3, ENH-4, ENH-6, ENH-7 (Wave 2).

---

### ~~ENH-6 · Interactive sidebar UX — bullet search, 5-round cap (`REL-7`), roving arrow keys (`REL-6`), & debounced auto-compute · FE / ACC · Size M [Must Have]~~ ✅ Done

Selecting all 37 catalog rounds at once via `#selectAllBullets` causes chart clutter (`REL-7`), browsing 37+ rounds lacks live search filtering, keyboard users lack ArrowDown/ArrowUp roving focus across cards (`REL-6` / `ACC-3`), and users must click Compute repeatedly after minor sidebar tweaks instead of getting debounced live updates.

**Work items:**

1. Remove `#selectAllBullets` from `app/index.html` and `app/ballistics.js` (`REL-7`), and replace with `#bulletSearch` + `#bulletSearchClear`, `#selectedCount` (`N / 5 selected`), and `#clearSelectionBtn` above `#bulletList`.
2. Enforce `MAX_SELECTED_BULLETS = 5`: clamp saved/URL selections to 5, block activating a 6th card while briefly applying `.bullet-card--limit-reached` (`600 ms`) + announcement/toast (`REL-7`).
3. Implement live substring search filtering over `#bulletList` (`name` and `id`) while preserving selected state and showing an empty-filter hint when zero rounds match.
4. Add roving `tabindex` (`0` on active focused card, `-1` on siblings) with `ArrowDown`, `ArrowUp`, `Home`, `End` navigation across visible `.bullet-card` items and `focus` index tracking (`REL-6` / `ACC-3`).
5. Add `#autoComputeToggle` (default checked, persisted via `localStorage`) triggering a `250 ms` debounced `runSimulation()` on parameter input changes or bullet toggles when selected count > 0; clicking `#runBtn` cancels any pending debounce and runs immediately.

**Coverage:** 100% Jest (`tests/ballistics.test.js`).

**Acceptance:**

- `#selectAllBullets` is removed from `app/index.html` and `app/ballistics.js` (`REL-7`).
- Maximum 5 rounds can be active simultaneously; attempting a 6th triggers `.bullet-card--limit-reached` (`REL-7`).
- Arrow keys move focus across `#bulletList` with single roving `tabindex="0"` (`REL-6`).
- Search filters visible rounds cleanly and debounced auto-compute refreshes charts automatically when enabled.
- `npm test` passes at 100/100/100/100.

**Dependencies:** None (Wave 1 Track C).

---

### ~~ENH-7 · Decompose `app/ballistics.js` monolith into `prefs`, `charts`, `table` & lazy `sweep` · FE / Architecture · Size M [Should Have]~~ ✅ Done

`app/ballistics.js` has grown to ~2,500 lines mixing `localStorage`/theme/toast helpers, Chart.js rendering & crosshair management, Data Table DOM construction/sorting, and Parameter Sensitivity Sweep calculation/rendering (which is loaded eagerly on initial boot even though Sweep is secondary). Splitting these concerns clarifies ownership and reduces initial critical-path JS.

**Work items:**

1. Extract cohesive modules with explicit unit test suites and add all 4 to `package.json` `jest.collectCoverageFrom`:
   - `app/prefs.js`: `PREF_KEYS`, `PREF_DEFAULTS`, `savePrefs`, `loadPrefs`, `applyTheme`, `initThemeToggle`, `updateToggleLabel`, `escapeHtml`, `showToast`.
   - `app/charts.js`: `BULLET_COLORS`, `SWEEP_COLORS`, `crosshairPlugin`, `annotationPlugin`, `drawVLine`, `drawHLine`, `windChartSubtitle`, `buildChartConfig`, chart rendering & in-place reuse, viewport observer, hover readout sync, `_applyChartTheme`.
   - `app/table.js`: `SORTABLE_COLUMNS`, table rendering, chunked RAF row insertion, sorting (`onSortHeaderClick`, `updateSortIndicators`).
   - `app/sweep.js`: `SWEEP_RANGES`, `buildSweepRequests`, `runSweep`, `clearSweep`, `renderSweepCharts`, `updateSweepButtonVisibility` — **dynamically imported** (`import('./sweep.js')`) by `app/ballistics.js` when Sweep controls are shown or invoked.
2. Keep `app/ballistics.js` as a lean orchestrator and re-export extracted public helpers so existing tests and external callers remain compatible.
3. Add `tests/prefs.test.js`, `tests/charts.test.js`, `tests/table.test.js`, `tests/sweep.test.js`.

**Coverage:** 100% Jest across all extracted modules + `tests/ballistics.test.js`.

**Acceptance:**

- `app/prefs.js`, `app/charts.js`, `app/table.js`, and `app/sweep.js` are separate tested ES6 modules at 100/100/100/100 coverage.
- `npm run build` emits a separate lazy-loaded `sweep-*.js` chunk and reduces main entry bundle size.
- `npm test` passes at 100/100/100/100.

**Dependencies:** ENH-6 (built directly atop Sprint 14 sidebar state).

---

### ENH-8 · Modernize Puppeteer E2E smoke suite on built `dist/` (`vite preview`) & add CI job · QA / DevOps · Size S [Must Have]

`tests/e2e/app.e2e.test.js` and `jest-puppeteer.config.cjs` are broken relics of the pre-SPA era (asserting deleted `#statusPill`, `.status-offline`, 10 pre-selected cards, and localhost:5173 without `/ballistics/`), and `.github/workflows/ci.yml` never runs E2E tests. Running a fast smoke suite against production `dist/` via `vite preview` catches real bundling, worker, base-path (`/ballistics/`), and CSP regressions.

**Work items:**

1. Update `jest-puppeteer.config.cjs`:
   - Serve built `dist/` using `./node_modules/.bin/vite preview --port 4173 --strictPort --host 127.0.0.1`.
   - Resolve `executablePath` from `process.env.PUPPETEER_EXECUTABLE_PATH` or standard Linux/macOS Chrome/Chromium paths (`/usr/bin/google-chrome`, `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, etc.) so CI runs cleanly with `PUPPETEER_SKIP_DOWNLOAD: 'true'`.
2. Rewrite `tests/e2e/app.e2e.test.js` against `http://127.0.0.1:4173/ballistics/` asserting zero `pageerror` / console errors (including zero CSP errors), initial load of 37 built-in rounds, Web Worker compute & 5 rendered canvases, Data Table lazy render + sorting, and Tools tab lazy load + DOPE table rendering.
3. Add `'jest.e2e.config.cjs'` and `'jest-puppeteer.config.cjs'` to CI `paths-filter`, add an `e2e-smoke` job in `.github/workflows/ci.yml` (`needs: [changes]`, gated on `frontend == 'true'`), and add `e2e-smoke` to `deploy.needs`.

**Coverage:** `npm test` remains 100/100/100/100; `npm run test:e2e` passes end-to-end against `npm run build` output.

**Acceptance:**

- `npm run build && npm run test:e2e` passes locally with zero page/console/CSP errors.
- `.github/workflows/ci.yml` runs `e2e-smoke` on PRs and pushes to `main`.

**Dependencies:** ENH-9 (verifies `<meta http-equiv="Content-Security-Policy">` under real browser execution).

---

### ENH-9 · Release hygiene (`REL-1`–`REL-3`) & Content-Security-Policy meta tag (`SEC-3`) · DevSecOps / DX · Size S [Must Have]

Consolidates Sprint 11 documentation cleanup and Icebox security hardening: removes the 28 dead backend/WASM/Rust specs in `contracts/` (`REL-1`), creates root `CHANGELOG.md` (`REL-2`), brings `README.md` up to date (`REL-3`), and adds a strict `<meta http-equiv="Content-Security-Policy">` tag (`SEC-3`) compatible with static GitHub Pages hosting and Vite 8 assets/module workers.

**Work items:**

1. `REL-1`: Delete the 28 stale backend/WASM contract docs from `contracts/` listed in Sprint 11 `REL-1`, update `contracts/CHANGELOG.md` header to reference the pure-browser SPA, and verify zero CI/code references break.
2. `REL-2`: Create root `CHANGELOG.md` in Keep a Changelog format covering `[Unreleased]`, `[3.0.0]`, and `Migration notes`.
3. `REL-3`: Update `README.md` Tech Stack, Architecture, Features, Testing, and Project Structure sections to accurately reflect Vite 8, Web Worker pool, Transferables, Sprint 14 features, and modular files.
4. `SEC-3`: Add `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">` in `app/index.html` (no `frame-ancestors` in `<meta>`, no `unsafe-eval`), plus assertion coverage in `tests/index-html.test.js`.

**Coverage:** 100% Jest (`tests/index-html.test.js`); `npm run build` preserves quoted CSP directives cleanly.

**Acceptance:**

- `contracts/` contains only the 24 current-era SPA docs (`REL-1`).
- `CHANGELOG.md` and `README.md` accurately describe `v3.0.0` (`REL-2`, `REL-3`).
- `app/index.html` and `dist/index.html` enforce the `<meta http-equiv="Content-Security-Policy">` policy (`SEC-3`) without blocking scripts, workers, CSS, fonts, or PNG exports.
- `npm test` passes at 100/100/100/100.

**Dependencies:** None cleanly when stacked above Wave 2 feature edits (`app/index.html`, `README.md`).

---

### ENH-10 · Explicit job-level CI permissions (`REL-5`) & `v3.0.0` version bump (`REL-4`) · DevSecOps · Size XS [Must Have]

Finalizes Sprint 14 release readiness by ensuring every job in `.github/workflows/ci.yml` explicitly declares least-privilege `permissions:` (`REL-5`: `changes` and `frontend-build` join `codeql`, `trivy`, `e2e-smoke`, and `deploy`) and bumping `package.json` + `package-lock.json` from `1.0.0` to `3.0.0` (`REL-4`).

**Work items:**

1. Add explicit `permissions: { contents: read }` blocks to `changes` and `frontend-build` in `.github/workflows/ci.yml` (`REL-5`).
2. Bump `"version"` to `"3.0.0"` in `package.json` and `package-lock.json` (`REL-4`).

**Coverage:** `npm test` 100/100/100/100, `npm run build`, and `npm run test:e2e`.

**Acceptance:**

- Every job in `.github/workflows/ci.yml` declares explicit `permissions:`.
- `package.json` and `package-lock.json` report version `3.0.0`.
- `npm test`, `npm run build`, and `npm run test:e2e` all pass.

**Dependencies:** ENH-8, ENH-9.

---
