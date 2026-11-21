# SEC-2 innerHTML Audit (Sprint 15 Baseline)

## Scope

All `innerHTML`, `insertAdjacentHTML`, `outerHTML`, and `document.write` sinks across `app/` in the modular post-Sprint 15 architecture (excluding `tests/` and `node_modules/`).

- **`document.write`:** 0 occurrences across `app/`.
- **DOM-node-only modules:** `app/custom-bullets.js` (`renderCustomBulletGroup`), `app/profiles.js`, `app/prefs.js` (`showToast`, `_setSimStatus`, `_setSimulationError`), `app/io.js`, `app/drag-csv.js`, `app/units.js`, and `app/url-state.js` use `document.createElement` / `textContent` / `replaceChildren` with zero `innerHTML` sinks.

## Findings by Module

### `app/ballistics.js`

| Function | Sink | Data flowing in | Safe? |
|---|---|---|---|
| `renderBulletList()` | `list.innerHTML` | `escapeHtml(b.id)`, `escapeHtml(b.name)`, `escapeHtml(String(b.ballisticCoefficient))`, `escapeHtml(String(mvDisp))`, `escapeHtml(mvUnit)`, `colorFor(b)` (hex-validated), static state strings (`' active'`, `'0'` / `'-1'`, `'true'` / `'false'`) | ✅ |

Custom bullet cards are appended inside `#bulletList` by `renderCustomBulletGroup()` (`app/custom-bullets.js`) using `document.createElement` and `textContent` (no `innerHTML`).

### `app/charts.js`

| Function | Sink | Data flowing in | Safe? |
|---|---|---|---|
| `renderStatCards()` / `_statCardsHtml()` | `container.insertAdjacentHTML('beforeend', ...)` | `colorFor(r.bullet)` (hex-validated), `escapeHtml(r.bullet.name)`, `toDisplay()` / `formatNumber()` / `Number()` numbers, static unit labels (`vUnit`, `wUnit`, `eUnit`, `rUnit`, `dUnit`, `aUnit`) | ✅ |
| `renderCharts()` (reuse path) | `existingStats.outerHTML = _statCardsHtml(...)` | Same `_statCardsHtml()` template as above | ✅ |
| `renderCharts()` (initial build) | `cc.innerHTML = ''` | Empty string (container clear) | ✅ |
| `renderCharts()` (initial build) | `cc.insertAdjacentHTML('beforeend', ...)` (×2: 4 standard charts + `#adjustChart`) | Internal `chartDefs` literals (`def.id`, `def.title`, `'adjustChart'`) and `def.subtitle` (numeric `toDisplay()`, static compass label from `windChartSubtitle()`, `unitLabel()`) | ✅ |

Hover readout rows in `updateReadout()` are constructed via `document.createElement` and updated via `textContent`.

### `app/table.js`

| Function | Sink | Data flowing in | Safe? |
|---|---|---|---|
| `renderTable()` / `_formatTableRow()` | `tbody.innerHTML` | Pre-escaped `escapeHtml(r.bullet.name)`, `colorFor(r.bullet)` (hex-validated), numeric `toDisplay()` / `formatNumber()` / `computeAdjustments()` / `.toFixed(1)` values, static unit labels (`dUnit`, `drUnit`) | ✅ |
| `renderTable()` (`rAF` chunked append) | `tbody.insertAdjacentHTML('beforeend', chunk)` | Same `_formatTableRow()` output as above | ✅ |

### `app/sweep.js`

| Function | Sink | Data flowing in | Safe? |
|---|---|---|---|
| `renderSweepCharts()` | `cc.innerHTML = ''` | Empty string (container clear) | ✅ |
| `renderSweepCharts()` | `cc.insertAdjacentHTML('beforeend', ...)` | Static `SWEEP_CHART_IDS` (`def.id`); `.chart-title` and `.chart-subtitle` text is assigned afterward via `.textContent` | ✅ |

### `app/tools.js`

| Function | Sink | Data flowing in | Safe? |
|---|---|---|---|
| `_buildDopeTable()` | `table.innerHTML` | `escapeHtml(r.bullet.name)` (imported from `app/prefs.js`), numeric `colSpan`, unit labels (`rUnit`, `dUnit`, `drUnit`), numeric `computeAdjustments()` / `toDisplay()` / `interpolateAt()` / `.toFixed(1)` values | ✅ |
| `_renderDopeDistanceInputs()` | `row.innerHTML` | Numeric index `i` and positive numeric `_dopeDistances[i]` | ✅ |
| `renderMpbrTool()` | `container.innerHTML = ''` | Empty string (container clear when results empty) | ✅ |
| `renderMpbrTool()` | `container.innerHTML` | `escapeHtml(r.bullet.name)` (imported from `app/prefs.js`), unit labels (`rUnit`, `dUnit`, `vUnit`), numeric `toDisplay()` / `calcMpbr()` values | ✅ |

## Defense-in-Depth Controls

- **Centralized HTML escaping (`app/prefs.js`):** `escapeHtml(str)` encodes all five HTML special characters (`&`, `<`, `>`, `"`, `'`) and is shared across `ballistics.js`, `charts.js`, `table.js`, `tools.js`, and `io.js`.
- **CSS color validation (`app/charts.js`):** `colorFor(bullet)` enforces `HEX_COLOR_RE = /^#[0-9a-f]{6}$/i` before interpolating color values into inline `style` attributes, falling back to `BULLET_COLORS[bullet.id]` or `'#4ADE80'`.
- **Untrusted JSON import sanitization (`app/io.js`):** `importResultsFromFile()` enforces a 5 MB file-size limit, caps payloads at 10 results / 2,000 points per result / 200-char string fields, copies only allowlisted finite numeric keys (`BULLET_NUMERIC_FIELDS`, `RESULT_NUMERIC_FIELDS`, `POINT_NUMERIC_FIELDS`) into new objects, and validates `hexColor` against `HEX_COLOR_RE`.
- **Content Security Policy (`app/index.html`):** `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">` blocks inline `<script>` tags, `'unsafe-eval'`, external script origins, and `<object>`/`<embed>` elements.

## Historical Note — CodeQL Alert #12

Alert #12 originally flagged `src/main/resources/static/tools.js`, which was deleted in `SPA-4` (PR #93). It was dismissed as a **false positive**: the live modular code in `app/tools.js` escapes bullet names via `escapeHtml()` and interpolates only numeric expressions and static constants.

## Conclusion

No DOM XSS vectors found. Every non-static string interpolated into `innerHTML`, `insertAdjacentHTML`, or `outerHTML` passes through `escapeHtml()` or strict `HEX_COLOR_RE` validation, and all remaining interpolations are finite computed numbers or static constants protected by a strict `'self'` CSP.
