# Changelog

All notable changes are documented here following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [SemVer](https://semver.org/).

## [Unreleased]

### Changed

- Added automatic one-time startup migration of legacy `localStorage['bv_customRounds']` presets (and `ballistics.customDragTable` if present) into Custom Bullets (`ballistics:custom-bullets:v1`) before clearing legacy storage keys (`CLN-11`).
- Replaced duplicate `_esc()` and inline MOA/MRAD arithmetic in `app/tools.js` with shared `escapeHtml` and `computeAdjustments` from `app/prefs.js`, collapsed tool unit tracking into `_toolsUnitSystem`, and simplified `initDopeCard()` / `initBcSolver()` to the worker-backed signature (`CLN-5`).
- Consolidated `customDragTable` `localStorage` validation in `app/ballistics.js` onto `isValidCustomDragTable` from `app/custom-bullets.js`, renamed `getMockBullets()` to `getBuiltInBullets()`, passed `{ signal }` to all static `init()` event listeners, and replaced raw Unicode bidi characters in `FORBIDDEN_CHARS_RE` with explicit escape sequences (`CLN-6`).
- Updated `docs/adr/008-typescript-sole-physics-engine.md` status to `Accepted`, refreshed `docs/sec2-innerHTML-audit.md` for the modular frontend architecture, converted broken relative links in `contracts/spa1-ts-engine.md` and ADR 008 to plain historical references, and updated `README.md` and `BACKLOG.md` (`CLN-9`).

### Removed

- Retired the legacy `<details class="custom-section">` accordion (`app/custom-rounds.js`, `tests/custom-rounds.test.js`, `#customForm`, `#customError`, `#savePresetBtn`, `#customPresetSection`, and `runCustom` orchestration in `app/ballistics.js`) in favor of the unified Custom Bullets workflow (`CLN-11`).
- Deleted 6 obsolete pre-SPA Java/Spring/WASM files under `docs/adr/` and `docs/architecture/` plus redundant `docs/screenshots/.gitkeep` (`CLN-9`).
- Removed dead `maven` and `docker` blocks from `.github/dependabot.yml`, `target/**` from `.github/workflows/ci.yml` CodeQL `paths-ignore`, `target/` from `.gitignore`, unused `bulletCatalogPlugin()` from `worker.plugins` in `vite.config.mjs`, and unused `@tootallnate/once` (`3.0.1`) override from `package.json` (`CLN-3`).
- Removed unused CSS tokens (`--green`, `--orange`, `--blue`, `--purple`), dead `@keyframes pulse-border`, dead `.bullet-custom-item:focus-visible` rule, and orphan Bootstrap HTML classes in `app/index.html` (`CLN-4`).
- Removed dead pre-worker `calcBC()` / `_bcSimulateFn` / `_simulateBulletFn` code from `app/tools.js` (`CLN-5`), unused `evalCompiledDrag()` / `interpolateDragTable()` helpers from `app/physics/engine.ts` (`CLN-7`), duplicate `updateSweepButtonVisibility` from `app/sweep.js`, dead internal `export` modifiers across `app/` (`CLN-6`, `CLN-7`), ~40 legacy passthrough re-exports from `app/ballistics.js`, and obsolete JSON-RPC / `fetch` / `alert` server mocks from `tests/ballistics.test.js` (`CLN-8`).

### Fixed

- Fixed undefined CSS custom property references in `app/ballistics.css` (`--hover`, `--input-bg`, `--bg-secondary`, `--color-error`, `--color-error-bg`, `--color-error-border`) and `app/tools.js` (`--warn`, `--surface`) across dark and light themes (`CLN-4`).
- Removed unreachable fallback loops and redundant post-render DOM syncs in `app/ballistics.js`, dead `nameOk` local and unused fallback branches in `app/custom-bullets.js`, and stale `WA-13` JSDoc reference in `app/physics/engine.ts` (`CLN-6`, `CLN-7`).

## [3.0.0] — 2026-11-19

### Added

- **Physics & external ballistics:**
  - Gyroscopic spin drift using the Litz simplified formula with barrel twist-rate input, displayed in the wind drift chart and data table (PR #139, #148).
  - First-order Coriolis horizontal deflection with latitude and azimuth inputs (PR #147), alongside Eötvös vertical correction.
  - Dual G1 and G7 drag model support across the 37-round built-in catalog and custom rounds.
  - Station pressure and relative humidity atmosphere parameters alongside altitude and temperature.
  - Custom drag table CSV upload (`Mach,CD`) overriding G1/G7 drag curves for custom-round runs (PR #144, #145).
  - Density altitude readout in simulation stat cards (PR #141).
- **UI, tools & accessibility:**
  - Metric / Imperial unit system toggle, Maximum Point Blank Range (MPBR) solver, printable DOPE cards, and named rifle profiles.
  - Light/dark theme toggle with `localStorage` persistence and `prefers-color-scheme` detection on first load (PR #137).
  - Trajectory JSON re-import with schema validation and sanitization (PR #138).
  - Trajectory CSV export with full physics columns and Markdown export (PR #113).
  - Custom bullet catalog — add, edit, and delete rounds persisted in `localStorage` (PR #113).
  - Keyboard-navigable bullet selector with ARIA roles, `Enter`/`Space` activation, and `:focus-visible` ring (PR #140), plus `aria-live` announcements for simulation status (PR #136).
  - Sticky "Compute Trajectories" action bar in the sidebar (PR #133) and nearest-mode tooltip readability for multi-bullet charts (PR #134).
  - VS Code workspace settings and extension recommendations (PR #131).
- **Performance & worker architecture (Sprints 9, 12, 13):**
  - Bounded multi-core Web Worker pool (`app/physics/engine.worker.ts`, `app/physics/engine-async.ts`) with `AbortSignal` stale-run cancellation, 64-entry LRU result memoization, idle warm-up, and zero-copy Transferable `Float64Array` point packing (`app/physics/packed-points.ts`) (PR #99, #135, #156, #157, #163).
  - Zero-allocation RK4 integration hot loops using compiled `Float64Array` drag tables and hoisted branchless lookup (PR #153, #164).
  - Safeguarded bracketed secant zero-angle solver and single-round-trip worker `solveBC` back-calculator with warm-hint bracketing (PR #154, #155, #164).
  - Tree-shaken Chart.js lazy wrapper (`app/chart-loader.js`) and code-split lazy chunks for `app/tools.js`, `app/io.js`, `app/drag-csv.js`, and `app/sweep.js` (PR #106, #160, #162).
  - Modular decomposition of `app/ballistics.js` into `app/prefs.js`, `app/charts.js`, `app/table.js`, `app/sweep.js`, `app/units.js`, and `app/profiles.js`.
  - Chart.js fast path: `parsing: false`, LTTB decimation, chart instance reuse across trajectory and sweep renders, `rAF`-coalesced crosshair sync, and `IntersectionObserver` viewport-aware `chart.draw()` (PR #152, #166).
  - Deferred hidden-tab Data Table and DOPE rendering with cached `Intl.NumberFormat`, cached row records, and `rAF`-chunked table insertion (PR #152).
  - Delegated sidebar event listeners, O(1) bullet `Map` index, debounced preference and URL persistence, compositor-only CSS transitions, `content-visibility: auto`, and passive touch listeners (PR #128, #152, #159, #165).
  - Service Worker navigation preload, deferred registration past `window.load`, deterministic SHA-256 precache manifest, and immutable hashed chunk reuse across deploys (PR #125, #128, #158).
  - Metric-matched fallback `@font-face` declarations, Orbitron variable font deduplication, and native HTML/SW/Lightning CSS minification in `vite.config.mjs` (PR #167, #168).

### Changed

- Moved the physics engine from Java/Spring Boot and Rust/WASM to TypeScript (`app/physics/engine.ts`) running wholly in the browser with no server required.
- Flattened source layout from Maven conventions (`src/main/resources/static/`) to `app/` and `tests/`, and moved build output from `target/classes/static/` to `dist/`.
- Upgraded the build pipeline to Vite 8 (`vite.config.mjs`) with Rolldown bundling, `esnext` target, Lightning CSS, and automated Service Worker precache manifest generation (PR #117, #168).
- Stripped unread `description` and `caliber` catalog prose from the `virtual:bullet-catalog` runtime bundle via `catalog-projection.cjs` (PR #161).
- Upgraded CI to Node.js 24 LTS, `actions/cache` v6, `actions/setup-node` v7, single-build GitHub Pages artifact reuse (PR #149, #150, #169), and Puppeteer E2E smoke tests running against built `dist/` (`vite preview`).
- Changed first-visit default from selecting all built-in bullets to selecting only the first built-in round, and capped simultaneous comparisons at 5 rounds.

### Removed

- Java/Spring Boot REST API (`POST /api/rpc`, `POST /api/trajectories/custom`, `GET /api/trajectories/compare/stream`, `POST /api/trajectories/compare`, `GET /api/bullets`).
- Rust/`wasm-pack` engine workspace (`engine/`), Docker / `docker-compose` infrastructure, Maven build (`pom.xml`, `mvnw`), `src/main/java/`, `src/test/java/`, `monitoring/` dashboards, and bundled `node/` binary.
- `#statusPill` online/offline indicator, retry timer, WASM loader, and `simulateBulletJS` JS fallback.
- Unused `rajdhani-700.woff2` and duplicate `orbitron-{400,700,900}.woff2` font files (PR #167), along with 28 obsolete backend/WASM contract documents from `contracts/`.

### Security

- Added a strict `<meta http-equiv="Content-Security-Policy">` policy (`default-src 'self'`, `script-src 'self'`, `worker-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`) with no `'unsafe-eval'`.
- Pinned `minimatch` (`11.0.8`, GHSA-g3hv-75wg-m249), `glob` (`14.0.6`, GHSA-3g3m-2fjr-6pw4), `deepmerge` (`4.3.1`, GHSA-gcqx-w48m-w2h4), and `@tootallnate/once` (`3.0.1`) via npm `overrides` for test-only transitive dependencies (PR #146).
- Pinned all GitHub Actions to full commit SHAs and added explicit job-level least-privilege `permissions` blocks.
- Added CodeQL JavaScript SAST and Trivy filesystem scanning to CI, plus HTML escaping and CSV formula-injection neutralization (PR #113).

## Migration notes — upgrading from 1.x (REST API) to 3.0.0

The REST API endpoints (`GET /api/bullets`, `POST /api/trajectories/compare`, `POST /api/trajectories/custom`, `GET /api/trajectories/compare/stream`, and `POST /api/rpc`) **no longer exist**. The application is a static site with no server-side component.

- **Calling the API programmatically:** use `simulate(bullet, params)` from `app/physics/engine.ts` directly in your own TypeScript/JavaScript project, or copy the engine file (MIT-licensed). The function signature is documented in `app/physics/types.ts`.
- **Hosting the Java/Spring Boot server:** the server can be decommissioned. Deploy the contents of `dist/` to any static host (GitHub Pages, Netlify, nginx, CDN). Run `npm run build` to produce `dist/`.
- **JSON exports from 1.x:** results exported before the SPA migration may contain `spinDriftCm: null`, `coriolisDeflectionCm: null`, or `densityAltitudeMeters: null`. The import feature treats `null` as `0` and renders correctly.
- **URL state:** existing bookmarked URLs using the `?` state parameter continue to work — the URL state format is backward-compatible.

[Unreleased]: https://github.com/dirkharrington/ballistics/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/dirkharrington/ballistics/releases/tag/v3.0.0
