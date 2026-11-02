# Contract: data table column sort (FE-3)

Version: 1.0.0 — 2026-11-01
Scope: frontend only (`ballistics.js`, `index.html`, `ballistics.css`). No backend change.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Goal and non-goals

Goal: click a column header in the Data Table tab to sort the rows by that column. The first click sorts ascending, and each further click on the same header toggles the direction. Clicking a different header sorts that column ascending.

Non-goals: multi-column sort, persisting sort across reloads or simulations, and sorting the CSV/JSON/Markdown exports (they stay in natural order). The range-readout table is unaffected.

## Sort state

Module-level variables in `ballistics.js`:

```js
let sortColumn    = null;    // string | null. One of the SORTABLE_COLUMNS keys, or null = natural order
let sortDirection = 'asc';   // 'asc' | 'desc'
let tableResults  = null;    // results array last passed to renderTable (null = no simulation rendered yet)
```

`tableResults` is needed because header clicks re-render without a new simulation. `lastResults` can't be used for that: during SSE streaming it isn't updated until the stream ends, and it isn't filtered through `r?.bullet`.

`_resetState()` must also reset all three to `null` / `'asc'` / `null`.

## Sortable columns

```js
const SORTABLE_COLUMNS = Object.freeze({
  range:     (p, adj) => p.rangeMeters,
  drop:      (p, adj) => p.dropCm,
  velocity:  (p, adj) => p.velocityMps,
  energy:    (p, adj) => p.energyJoules,
  windDrift: (p, adj) => p.windDriftCm,
  time:      (p, adj) => p.timeOfFlightSec,
  moa:       (p, adj) => adj.moa,
  mrad:      (p, adj) => adj.mrad,
});
```

| Header text | `data-sort-key` | Sort value |
|---|---|---|
| Round | — (**not sortable**) | — |
| Range (m) | `range` | `point.rangeMeters` |
| Drop (cm) | `drop` | `point.dropCm` |
| Velocity (m/s) | `velocity` | `point.velocityMps` |
| Energy (J) | `energy` | `point.energyJoules` |
| Wind Drift (cm) | `windDrift` | `point.windDriftCm` |
| Time (s) | `time` | `point.timeOfFlightSec` |
| MOA | `moa` | `computeAdjustments(p.dropCm, p.rangeMeters).moa` |
| MRAD | `mrad` | `computeAdjustments(p.dropCm, p.rangeMeters).mrad` |

Comparison rules:
- Compare the **raw signed numbers**, never the rendered text. The text adds `+`, ` cm`, `s`, and `toLocaleString()` separators, which would break numeric order. Drop and wind drift are signed: ascending puts the most negative first.
- The sort must be **stable**: ties keep natural order (result order, then point order). `Array.prototype.sort` is stable in ES2019+, so sort a flat array of `{ r, p, adj }` rows directly.
- Non-finite values (`NaN`, `undefined`) always sort **last**, whatever the direction.
- `desc` is the exact reverse comparator of `asc` (not a reversed array). This keeps tie order stable in both directions.

## `renderTable` change

The signature stays `renderTable(results)`. Inside:

1. `tableResults = results`.
2. Flatten to rows `{ r, p, adj }` (natural order). Compute `adj` once per row and reuse it for both sorting and the MOA/MRAD cells.
3. If `sortColumn !== null`, sort with `SORTABLE_COLUMNS[sortColumn]` and `sortDirection`.
4. Build the `<tr>` strings exactly as today (same cells, same `escapeHtml` on the name) and set `tbody.innerHTML`.
5. Call `updateSortIndicators()`.

New helpers (export them alongside `renderTable` for tests):

```js
/** Header click logic. Same key → toggle direction. Different key → that key, 'asc'. Then renderTable(tableResults). No-op if tableResults === null or key is not in SORTABLE_COLUMNS. */
function onSortHeaderClick(key);

/** For every th[data-sort-key]: on the active one, set aria-sort="ascending"|"descending" and indicator text '▲'|'▼'. Clear the indicator and remove aria-sort on all others. */
function updateSortIndicators();

/** Test access. */
function _getSortState();   // → { column: sortColumn, direction: sortDirection }
```

## `renderResults` change

Immediately before its existing `renderTable(results)` call, `renderResults` sets `sortColumn = null; sortDirection = 'asc';`. A new simulation (or custom compute) therefore always renders in natural order with no indicator.

`renderResults` runs once per SSE event while streaming. A sort the user picks mid-stream is reset by the next arriving result. This is accepted: the simulation is still "new" until it finishes.

## Header markup and click wiring

`index.html` `#dataTable thead`. Each sortable `th` gets `data-sort-key` and wraps its label in a button, so keyboard users can sort (WAI-ARIA sortable-table pattern):

```
th[data-sort-key="range"]
  └ button.sort-btn[type=button]
      ├ text "Range (m)"
      └ span.sort-indicator[aria-hidden=true]     ← '' | '▲' | '▼'
```

The `Round` `th` stays plain: no `data-sort-key`, no button.

Wiring in `init()`: **one** delegated `click` listener on `#dataTable thead`. Use `e.target.closest('th[data-sort-key]')`; if it's found, call `onSortHeaderClick(th.dataset.sortKey)`. Don't add per-header listeners.

CSS: `.sort-btn` inherits the `th` typography and has no button chrome (transparent background, no border, `cursor: pointer`, visible `:focus-visible` outline). `.sort-indicator` has a small left margin.

Also fix the existing placeholder row while editing the markup: `colspan="7"` → `colspan="9"` (the table has 9 columns).

## Threat model

None of note. The feature only reorders data already rendered. The name cell keeps `escapeHtml`, and the sort key comes from a fixed allow-list (`SORTABLE_COLUMNS`), never from user text.

## Acceptance checklist

- [ ] Clicking `Range (m)` sorts ascending with ▲. A second click sorts descending with ▼. A third click sorts ascending again.
- [ ] Sorting by Drop, then clicking Energy → Energy ascending. The Drop header shows no indicator and has no `aria-sort`.
- [ ] Clicking `Round` does nothing.
- [ ] Rows sort by raw numeric value: velocity `1,050` vs `980` orders by number, and signed drop puts `-120` before `-5` before `+3` ascending.
- [ ] MOA/MRAD sort by the computed adjustment.
- [ ] Ties keep natural order in both directions (test with two bullets that share a range value).
- [ ] A `NaN` value sorts last in both `asc` and `desc`.
- [ ] A new simulation (`renderResults`) resets to natural order and clears every indicator.
- [ ] A header click before any simulation is a no-op: the "NO DATA" row stays and no indicator appears.
- [ ] Headers are reachable with Tab and sortable with Enter/Space (native button). `aria-sort` reflects the state.
- [ ] CSV/JSON/Markdown exports are unchanged (natural order).
- [ ] `_resetState()` resets the sort state. Jest coverage stays at 100 %. The `buildDOM()` fixture uses the new header markup.
