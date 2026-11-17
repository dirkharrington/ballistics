# ADR 010: Sprint 9 performance decisions

**Status:** Proposed. Waiting for user approval.
**Date:** 2026-11-16
**Deciders:** Architect (proposal), user (approval)
**Stories:** PERF-4 to PERF-13 (`BACKLOG.md` § Sprint 9 — Performance)
**Related:** ADR 009 (PERF-1 web worker, `contracts/perf1-web-worker.md`), PERF-2 (SW precache), PERF-3 (lazy Chart.js)

---

## 1  Context

The app is a static SPA on GitHub Pages: Vite 8 (Rolldown) build, a TypeScript RK4 engine running in a module worker (PERF-1), Chart.js loaded lazily (PERF-3), and a service worker that precaches every hashed asset Vite emits (PERF-2). Jest coverage is locked at 100/100/100/100.

We read the code on `main` on 2026-11-16 and found the following:

| # | What we found | Where |
|---|---|---|
| O1 | `build` has no `target`, so Vite lowers syntax to its default browser baseline. `reportCompressedSize` defaults to `true`, so every build gzips each chunk just to print its size. | `vite.config.js` |
| O2 | Nothing in `<head>` preloads the 9 self-hosted woff2 faces. The browser only finds them after the CSS downloads and parses, and after an element that uses them is styled. `font-display: swap` then makes the header text visibly reflow. | `app/index.html`, `app/ballistics.css` |
| O3 | There are 9 `@font-face` faces, 123 KB in total. No CSS rule asks for Rajdhani 300 or 500. Rajdhani 700 is only reached by a `✓` glyph (U+2713), which is outside the faces' `unicode-range`, so the browser never draws it in Rajdhani. PERF-2 precaches every emitted woff2, so **every visitor downloads all 9 faces when the service worker installs**, used or not. | `app/ballistics.css`, `vite.config.js` `serviceWorkerPlugin` |
| O4 | No chunk strategy is configured. `ballistics.js` imports `TrajectoryInputError` from `physics/engine.ts`, so the main-thread bundle carries the whole engine plus the G1/G7/atmosphere tables. Only the worker runs that code. | `app/ballistics.js:6` |
| O5 | `interpolateDragTable` scans the table linearly (~40–45 rows). It runs 4 times per RK4 step, in both `findZeroAngleFps` (64 bisection passes) and `integrateTrajectoryFps`, which is tens of thousands of calls per bullet. At supersonic speeds the scan walks most of the table. | `app/physics/engine.ts:68` |
| O6 | `renderResults` and `renderSweepCharts` each run `await import('chart.js')` followed by `Chart.register(...)` on every render. The first fetch of the Chart.js chunk only starts *after* the worker returns results. | `app/ballistics.js:682`, `:1062` |
| O7 | The chart panels (5 per run, 3 per sweep) all lay out and paint, even though only 1–2 are on screen inside the scrolling `.chart-container`. | `app/ballistics.css` `.chart-panel` |
| O8 | The only scroll or touch listeners are two `touchmove` forwarders on chart canvases. They are `{ passive: false }` and call `preventDefault()` to stop page scrolling while the user scrubs a chart. There are no `scroll` or `wheel` listeners. | `app/ballistics.js:758`, `:856` |
| O9 | The service worker does not enable Navigation Preload. When the worker is idle-terminated (common on mobile), each navigation waits for it to boot before the `index.html` fetch can start. | `app/sw.js` |
| O10 | CI caches `~/.npm` but no build intermediates. | `.github/workflows/ci.yml` |

We have no field data (RUM). Each story must record before and after numbers in its PR. Section 4 says how.

---

## 2  Decisions

The ten stories are stacked PRs, merged in the order below. The order puts config-only and low-risk changes first. The changes that depend on behaviour (preload, SW) come later, so a regression can be bisected to a single PR.

| # | Story | Decision | Why | Alternatives rejected |
|---|---|---|---|---|
| D1 | PERF-4 | Set `build.target: 'esnext'` and `build.reportCompressedSize: false`. | The app already needs module workers and module service workers, so older browsers can't run it whatever the target is. Lowering syntax only makes the output bigger. Skipping the gzip size report shortens every local and CI build. | `es2022`: kept as the fallback if a target browser breaks. Leaving the default: pays for lowering we don't need. |
| D2 | PERF-5 | Preload exactly 3 faces, all `crossorigin`: Rajdhani 400 (`body`), Share Tech Mono 400 (subtitle, labels, inputs) and Orbitron 900 (`<h1>`). | These faces paint above the fold on first load. A cap of 3 stops font preloads from competing with the CSS and the entry JS. Without `crossorigin`, the preload is fetched in no-cors mode and downloaded a second time. | Preloading all 9: wastes bandwidth during the critical render. `font-display: optional`: changes how the page looks. |
| D3 | PERF-6 | Audit every family and weight that is actually used: CSS rules, UA-default bold, inline styles, JS-generated HTML and Chart.js canvas fonts. Delete faces with zero use. Add a Jest guard against orphaned fonts. | Because of O3, unused faces cost real bytes on every SW install. The guard also catches a preload (PERF-5) that points at a deleted face. | Variable fonts or re-subsetting: bigger change, new tooling. Deferred. |
| D4 | PERF-7 | Move `TrajectoryInputError` into `app/physics/errors.ts`. Add Rolldown `codeSplitting.groups`: `vendor` (chart.js and @kurkle only) and `physics` (`app/physics/`). | Taking the engine and drag tables out of the main thread is the real saving in bytes. Named groups keep chunk hashes stable, so UI-only deploys don't invalidate the physics and vendor caches. The `vendor` test is narrow on purpose. A broad `/node_modules/` match could pull Vite runtime helpers into `vendor`, which would make it, and therefore Chart.js, load eagerly and undo PERF-3. | `manualChunks`: the object form is unsupported in Vite 8 and the function form is deprecated. No split: leaves the O4 waste. |
| D5 | PERF-8 | Replace the linear scan with a lower-bound binary search. Keep the bracket selection and arithmetic exactly the same, so output stays bit-identical. | The search drops from O(n) to O(log n) (~6 comparisons instead of up to ~45) in the hottest function. The SPA-1 golden fixture locks the output, so we can't accept any numeric drift. | Caching the last bracket index (velocity only ever falls): faster again, but it adds mutable state to a pure function. Revisit if PERF-8 measurements call for it. Precomputed typed arrays: changes the `DragTable` type and touches more code. |
| D6 | PERF-9 | Add one memoized `loadChart()`: a single `import()` and a single `register()` per page, with the cache reset when the load fails. Warm it up in parallel with the worker call. Show a clear error if the chart library fails to load. | The repeated `import()` is cheap after the first call. **The real gains** are (a) the first Chart.js download overlapping the worker's computation, and (b) a failed chunk load (flaky or offline network) being retried on the next click instead of being cached as a rejection. | `<link rel="modulepreload">` for Chart.js: makes it load eagerly again and undoes PERF-3. |
| D7 | PERF-10 | Add `content-visibility: auto` and `contain-intrinsic-size: auto <measured px>` to `.chart-panel` only. | Off-screen panels skip style, layout and paint, both on the first render and on the crosshair re-render that touches every chart. The `auto` keyword remembers each panel's real size, so the scrollbar doesn't jump. | Table rows: `content-visibility` doesn't reliably apply to table-internal boxes. Tool cards: the panel is `display:none` until it's opened. |
| D8 | PERF-11 | Replace `preventDefault()` in the canvas `touchmove` forwarders with CSS `touch-action: none` on chart canvases. Register the forwarders `{ passive: true }` through one shared helper. Every other scroll, touch and wheel listener must be passive. | Touch behaviour stays the same (page scroll was already blocked over charts). The compositor no longer waits on the main thread for touches that start on a chart, and the Lighthouse "passive listeners" audit passes. | `touch-action: pan-y`: lets users scroll over charts, but it's a UX change and the crosshair jitters while scrolling. Offered to the user as a follow-up. |
| D9 | PERF-12 | Turn on Navigation Preload in `activate` (with a feature check). Make the navigation branch use `event.preloadResponse` first and fall back to `fetch`. Keep the network-first strategy with cache fallback. | The `index.html` request starts at the same time as SW boot instead of after it. GitHub Pages needs no server change; it ignores the `Service-Worker-Navigation-Preload` header. | Making navigations cache-first: deploys would go stale, which the existing design rejected. Removing the SW: loses offline support. |
| D10 | PERF-13 | **Measure first.** Cache `node_modules/.vite` (restored after `npm ci`) only if `vite build` provably reads it and saves ≥10%. Otherwise cache Jest's babel transform cache (`--cacheDirectory=.jest-cache`). | Vite documents `node_modules/.vite` as the dev-server cache for pre-bundled dependencies. It's not clear the production build reads it, and we won't merge a cache step that saves nothing. The Jest transform cache is a known cost on every CI run. | Caching `node_modules`: bypasses the `npm ci` integrity guarantee and widens the cache-poisoning surface. |

---

## 3  Consequences

**Positive**
- Less to download: the SW precaches fewer font bytes (PERF-6), and the main thread ships no engine or tables (PERF-7).
- The first render starts sooner (PERF-5, PERF-12), and the first chart render is faster on a cold Chart.js cache (PERF-9 warm-up).
- Each simulation spends less CPU on drag lookups (PERF-8) and less on layout and paint for off-screen charts (PERF-10).
- Builds and CI get faster (PERF-4, PERF-13 if the measurement supports it).

**Negative / risks**
- `esnext` passes through any modern syntax that a contributor or dependency introduces. Mitigation: the smoke test across Chrome, Firefox and Safari (desktop and iOS) in PERF-4's acceptance criteria. Fallback: `es2022`.
- The name of the Rolldown option (`codeSplitting` vs. the older `advancedChunks`) has changed between Vite 7 and 8. The builder must check it against the installed type definitions.
- Chart.js resizes through ResizeObserver, and that may interact with skipped `content-visibility` subtrees. PERF-10's acceptance criteria include drawing off-screen charts and exporting them to PNG.
- With `touch-action: none` on canvases, a swipe that starts on a chart can't scroll the page. This is the same as today's behaviour, and we're recording it as intentional.

**Neutral**
- The worker message protocol, the URL state, localStorage keys and the SW cache naming don't change. Nothing changes on the wire, because the app has no server.

---

## 4  Expected outcomes and how to verify them

We don't commit to numeric targets until a baseline exists. Process:

1. **Baseline**, before PERF-4 merges: run Lighthouse (mobile, simulated throttling, 3 runs, median) against the GitHub Pages deployment of `main`. Record LCP, TBT, total transfer and the SW precache byte total. Also record the median wall time of a 10-bullet, 2 000 m, 1 m-step simulation, measured in the worker with `performance.now()` around `simulate()` in a throwaway branch.
2. **Per PR**: each story's PR description includes the before and after numbers its acceptance criteria name.
3. **Sprint close**, after PERF-13: rerun the step-1 measurements and add them to this ADR as §5 "Results". Then set Status to Accepted.

Direction expected, with the story that drives each change:

| Metric | Expected direction | Driver |
|---|---|---|
| SW install bytes | Down by the deleted faces (~14 KB average per face) | PERF-6 |
| Entry JS bytes (main thread) | Down by the engine and drag tables | PERF-7 |
| LCP / visible font swap in the header | Earlier, less reflow | PERF-5 |
| Repeat-visit navigation start, SW cold | Earlier by the SW boot time | PERF-12 |
| Simulation wall time | Lower. Drag lookup is the measured target. | PERF-8 |
| First chart render, cold Chart.js cache | Earlier by the overlap with the worker | PERF-9 |
| Long tasks during crosshair hover over 5 charts | Fewer or shorter | PERF-10 |
| Lighthouse "passive listeners" audit | Pass | PERF-11 |
| `frontend-build` job time | Lower, or no change if the measurement says skip | PERF-4, PERF-13 |
