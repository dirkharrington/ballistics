# PERF-9: Memoize the Chart.js dynamic import and registration

**Version:** 1.0.0
**Status:** Contract written, builder pending
**Date:** 2026-11-16
**Author:** Architect
**ADR:** 010 (`contracts/adr-sprint9-performance.md`, decision D6)
**Builds on:** PERF-3 (lazy-load Chart.js, PR #106)

---

## 1  Problem

`app/ballistics.js` loads and registers Chart.js inline in two places, and does so on every render:

| Function | Line (main, 2026-11-16) |
|---|---|
| `renderResults(rawResults, req)` | ~682–683 |
| `renderSweepCharts(sweepResultsList, sweepParam)` | ~1062–1063 |

Both run this:

```js
const { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend } = await import('chart.js');
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);
```

This causes three problems. They are listed from most to least important:

1. **The first load is serialised.** Fetching the Chart.js chunk can't start until the worker has returned results and the `requestAnimationFrame` callback runs. On a cold cache, the user waits for the computation, then for the download.
2. **Failures are handled badly.** If the chunk fails to load (flaky network, or offline before the SW has cached the chunk), `renderResults` rejects inside a `requestAnimationFrame` callback that nobody awaits. The result is an unhandled rejection: no charts, no table and no message for the user.
3. **The same work is repeated.** After the first load, `import()` resolves from the module map, which is cheap. `Chart.register` still walks the registry on every render. This is a small cost, but it isn't needed.

---

## 2  Interface changes (internal to `app/ballistics.js`)

### 2.1  New functions

```js
/**
 * Resolve the Chart constructor, importing and registering Chart.js at most
 * once per page. A rejected load is not cached; the next call retries.
 * @returns {Promise<typeof import('chart.js').Chart>}
 */
function loadChart();

/** Test-only: forget the memoized promise. */
function _resetChartLoader();
```

Add both to the `export { … }` block at the end of the file, next to the existing `_reset*` / `_set*` test helpers.

### 2.2  Changed functions

| Function | Change |
|---|---|
| `renderResults` | Replace the two lines with `Chart = await loadChart()` inside a try/catch (§3.3). |
| `renderSweepCharts` | Same as `renderResults`. |
| `runSimulation` | Call `warmChart()` once validation passes and **before** `await computeClientSide(req)`. |
| `runCustom` | Call `warmChart()` before `await simulateAsync(bullet, req)`. |
| `runSweep` | Call `warmChart()` before `await Promise.all(...)`. |

`warmChart` is a module-private one-liner: `function warmChart() { loadChart().catch(_noop); }`, where `const _noop = () => {};` is a named module-level function. It is named so coverage can attribute it. It must be invoked in a test.

There are no DOM, CSS, worker-protocol or URL-state changes.

---

## 3  Implementation notes

### 3.1  Loader

```js
const CHART_COMPONENTS = ['LineController', 'LineElement', 'PointElement',
                          'LinearScale', 'CategoryScale', 'Tooltip', 'Legend'];
let _chartPromise = null;

function loadChart() {
  if (!_chartPromise) {
    _chartPromise = import('chart.js')
      .then(mod => {
        mod.Chart.register(...CHART_COMPONENTS.map(k => mod[k]));
        return mod.Chart;
      })
      .catch(err => { _chartPromise = null; throw err; });
  }
  return _chartPromise;
}

function _resetChartLoader() { _chartPromise = null; }
```

- Keep `import('chart.js')` as a static string literal. Vite needs that to emit the separate chunk (PERF-3), and PERF-7's `vendor` group depends on it.
- Don't add `<link rel="modulepreload">` for Chart.js and don't add a top-level `import`. Either would make it load eagerly and undo PERF-3.
- The registered component set stays exactly the 7 listed. Don't change chart configs.

### 3.2  Warm-up

`warmChart()` starts the chunk fetch while the worker computes. If the warm-up fails, the error is swallowed, and because the loader resets on rejection, the real `loadChart()` call in the renderer retries the fetch.

### 3.3  Failure handling in the renderers

```js
let Chart;
try {
  Chart = await loadChart();
} catch (err) {
  console.error(err);
  _setSimulationError("Couldn't load the chart library. Check your connection and try again.");
  // renderResults only: still render the data table and DOPE card, then return.
  return;
}
```

- In `renderResults`, the stat cards are already rendered before this point. On failure, skip chart creation, but still call `renderTable(results)` and `renderDopeCard(results, req)` before returning, so the numbers are still available. Reset `sortColumn`/`sortDirection` exactly as the success path does.
- In `renderSweepCharts`, return after setting the error. The container has already been cleared.
- On success, the existing path doesn't change. A later successful run must clear the error. `runSimulation` already calls `_setSimulationError(null)` at its start. `runSweep` and `runCustom` don't call it today; add `_setSimulationError(null)` at their start as part of this story.

---

## 4  Test requirements (`tests/ballistics.test.js`)

The existing `moduleNameMapper` already maps `chart.js` to `tests/__mocks__/chart.js`, where `Chart.register` is a `jest.fn()`. Call `_resetChartLoader()` and `Chart.register.mockClear()` in `beforeEach`.

1. **Memoized registration.** `renderResults` called twice, then `renderSweepCharts` called once, gives `Chart.register` exactly **1** call with the 7 component objects.
2. **Same constructor.** `await loadChart()` twice returns the same `Chart` reference.
3. **Failure resets the cache.** Make `Chart.register` throw once (`mockImplementationOnce`). The first `loadChart()` rejects, and the second resolves and registers. Total register calls: 2.
4. **`renderResults` failure path.** With the loader failing once: `#simulationError` is visible with the message from §3.3, no `Chart` constructor calls happen, `#tableBody` contains the result rows, `console.error` is called (spy and silence it), and the returned promise resolves.
5. **`renderSweepCharts` failure path.** The error is shown, no `Chart` constructor calls happen, and the promise resolves.
6. **Warm-up.** `runSimulation` with a pending `simulateAsync` mock: `loadChart` (observed through `Chart.register` after flushing microtasks) has started before `simulateAsync` resolves. Run the same warm-up check for `runCustom` and `runSweep`.
7. **Warm-up failure is swallowed.** Loader fails during warm-up: no unhandled rejection, `_noop` runs, and the renderer's retry succeeds.
8. **Error is cleared.** `runSweep` and `runCustom` clear a previously shown `#simulationError`.

Coverage must stay at 100/100/100/100. `_noop`, the `.catch` reset arrow and both renderer catch blocks must each run in at least one test.

---

## 5  Acceptance criteria

1. `grep -n "import('chart.js')" app/ballistics.js` finds exactly **one** occurrence, inside `loadChart`. `grep -n "Chart.register" app/ballistics.js` finds exactly one.
2. On a cold cache, DevTools → Network shows the Chart.js chunk request **starting before** the worker's result returns. Check in the Performance panel that the chunk fetch overlaps the worker task.
3. With DevTools offline and the Chart.js chunk not yet cached (unregister the SW first), clicking Compute shows the §3.3 message plus the data table, and there is no uncaught error in the console. Going back online and clicking Compute again renders the charts.
4. Repeated computes (≥3) make no further chart-chunk requests, and `Chart.register` runs once. Check with a temporary breakpoint or log, removed before merge.
5. The `dist/index.html` modulepreload list still doesn't include the Chart.js chunk.
6. `npm test` passes at 100/100/100/100.
