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

### ✅ SEC-1 · Pin vulnerable transitive Jest dependencies · DevSecOps · Size XS · DONE

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

### FEAT-1 · Gyroscopic spin drift in physics engine and data table · FE · Size S

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

### FEAT-2 · Coriolis deflection in physics engine · FE · Size S

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

### FEAT-3 · Wire custom drag CSV to physics engine · FE · Size M

The Custom Round panel has had a drag table CSV uploader since before Sprint 1. The engine marks `customDragTable` as RESERVED and ignores it — every trajectory still uses G1 or G7 regardless of what the user uploads.

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

### ACC-1 · Keyboard-navigable bullet selector · FE · Size S

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

### UX-4 · Spin drift column in DOPE card · FE · Size S

The DOPE card's `_buildDopeTable` already renders a "Cor. (cm)" column for Coriolis — that code activates automatically once FEAT-2 ships. Spin drift is not in the DOPE card at all. A shooter who has set a twist rate needs the lateral spin drift correction on the same DOPE card as the elevation come-ups.

**Work items:**

1. In `app/tools.js` `_buildDopeTable(results)`, mirror the `hasCoriolis` pattern:
   `const hasSpinDrift = results.some(r => r.points.some(p => p.spinDriftCm !== 0));`
2. Update `colSpan` to account for both optional columns.
3. Add `${hasSpinDrift ? '<th>Spin (cm)</th>' : ''}` alongside the existing Coriolis sub-header.
4. In `bodyRows`, use `interpolateAt(r.points, dist, 'spinDriftCm')` and render `${val >= 0 ? '+' : ''}${val.toFixed(1)}`, or `'–'` when null.

**Coverage:** 100% Jest. Tests: (a) non-zero spin drift — "Spin (cm)" column appears; (b) all-zero — column absent; (c) copied text includes the column when shown.

**Acceptance:**
- With twist rate set (FEAT-1 on main): DOPE card shows "Spin (cm)" alongside elevation come-ups.
- Without twist rate: column absent; existing Coriolis column behavior unchanged.
- `npm test` passes at 100/100/100/100.

**Dependencies: FEAT-1**

---

### UX-5 · Density altitude in result stat cards · FE · Size XS

The stat card template in `renderStatCards` already conditionally renders `r.densityAltitudeMeters` as "X m density alt", but `TrajectoryResult` has no such field and the branch is dead code today. Density altitude converts altitude plus temperature into a single number describing how the air behaves relative to sea level.

**Work items:**

1. In `app/physics/types.ts`, add `densityAltitudeMeters: number` to `TrajectoryResult`.
2. In `app/physics/engine.ts` `simulate()`, compute density altitude before the return statement:
   ```ts
   const isaTempC = 15 - 0.00198 * params.altitudeMeters;
   const densityAltitudeMeters = Math.round(params.altitudeMeters + 118.8 * (params.temperatureC - isaTempC));
   ```
3. No change to `renderStatCards` needed — the existing `r.densityAltitudeMeters !== undefined` conditional fires automatically.

**Coverage:** 100% Jest. Tests: (a) sea level 15°C → `densityAltitudeMeters ≈ 0`; (b) 1 500 m, 35°C → `densityAltitudeMeters > 1 500`; (c) stat card HTML contains the "density alt" string after simulation.

**Acceptance:**
- Stat cards show "X m density alt" after simulation for all runs.
- Sea level, ISA conditions: density altitude ≈ 0 m.
- 1 500 m, 35°C: `densityAltitudeMeters` noticeably greater than 1 500.
- `npm test` passes at 100/100/100/100.

---

### ACC-2 · Screen reader announcements for simulation lifecycle · FE · Size XS

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

### DM-1 · Re-import previously exported trajectory JSON · FE · Size S

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

### PERF-14 · Warm physics worker on idle · FE · Size XS

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

### UX-8 · Chart.js tooltip with many bullets · FE · Size S

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

### UX-9 · Light / dark mode toggle · FE · Size S

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

- **ACC-3 · Arrow-key roving tabindex in bullet list** — Follow-on to ACC-1; Up/Down arrows navigate within the bullet list. 2 pts.
- **FEAT-4 · G7 BC on custom bullets** — Custom bullets with `dragModel: 'G7'` currently use the G1 reference table. Add optional `bcG7` to the custom bullet form. 3 pts.
- **UX-7 · Print-friendly DOPE card** — `@media print` stylesheet + "Print DOPE" button formatted for A5 paper. 3 pts.
- **DX-2 · Named session saves** — Extend URL state module to let users name and persist sessions in `localStorage`. 5 pts.
- **SEC-3 · Content Security Policy header audit** — GitHub Pages does not support custom headers; evaluate `<meta http-equiv="Content-Security-Policy">` or Cloudflare Pages migration. 3 pts.
