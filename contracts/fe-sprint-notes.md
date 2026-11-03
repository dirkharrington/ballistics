# Frontend Sprint Notes — MH-1, MH-3, MH-4, SH-2

Version: 1.0.0 — 2026-11-03

Implementation notes for the FE builder. These are **not** formal contracts (no wire change needed); they describe UI and client-side logic only.

Read `spin-drift.md` and `density-altitude.md` for the new fields that will appear on `TrajectoryPoint` and `TrajectoryResult`.

---

## MH-1 · MOA/MRAD Adjustment Chart (5th panel)

### Decision: single panel with dual y-axis

Both `moaAdjustment` and `mradAdjustment` are already on every `TrajectoryPoint`. Display them together in one chart: MOA on the **left y-axis** (primary, matches the data table), MRAD on the **right y-axis** (secondary). This avoids a 5th and 6th panel and shows both adjustments at once so shooters can read either unit directly.

### Chart definition

```javascript
// Add after the windChart entry in chartDefs — but build outside the loop (see below):
{
  id:       'adjustmentChart',
  title:    'ADJUSTMENT',
  subtitle: 'MOA ·· MRAD uprange',
  yLabel:   'MOA',          // left axis label
  yLabelR:  'MRAD',         // right axis label
  keyL:     'moaAdjustment',
  keyR:     'mradAdjustment'
}
```

### Why it must be built outside the standard `chartDefs` loop

`buildChartConfig` takes a single `def.key` and renders a single y-axis. The adjustment chart needs two y-axis scales (`yL` and `yR`). Build this chart **after** the `chartDefs.forEach` loop, appending its `chart-panel` HTML then constructing a custom Chart.js config.

### HTML panel (append to `cc` after the loop)

```javascript
cc.insertAdjacentHTML('beforeend', `
  <div class="chart-panel">
    <div class="chart-header">
      <div>
        <div class="chart-title">ADJUSTMENT</div>
        <div class="chart-subtitle">MOA · MRAD uprange</div>
      </div>
      <button class="export-btn" data-chart-id="adjustmentChart">PNG</button>
    </div>
    <div class="chart-wrap"><canvas id="adjustmentChart"></canvas></div>
  </div>`);
cc.querySelector('.chart-panel:last-child .export-btn')
  ?.addEventListener('click', () => exportPNG('adjustmentChart'));
```

### Dataset construction

```javascript
const moaDatasets = results.map(r => ({
  label:            r.bullet.name + ' (MOA)',
  data:             r.points.map(p => ({ x: p.rangeMeters, y: p.moaAdjustment })),
  borderColor:      BULLET_COLORS[r.bullet.id] || '#4ADE80',
  backgroundColor:  'transparent',
  borderWidth:      2,
  pointRadius:      0,
  pointHoverRadius: 4,
  tension:          0.3,
  yAxisID:          'yL'
}));

const mradDatasets = results.map(r => ({
  label:            r.bullet.name + ' (MRAD)',
  data:             r.points.map(p => ({ x: p.rangeMeters, y: p.mradAdjustment })),
  borderColor:      BULLET_COLORS[r.bullet.id] || '#4ADE80',
  backgroundColor:  'transparent',
  borderWidth:      1,
  borderDash:       [4, 4],     // dashed to visually distinguish from MOA
  pointRadius:      0,
  pointHoverRadius: 4,
  tension:          0.3,
  yAxisID:          'yR'
}));
```

### Chart.js config

```javascript
const adjCtx = document.getElementById('adjustmentChart').getContext('2d');
charts['adjustmentChart'] = new Chart(adjCtx, {
  type: 'line',
  data: { datasets: [...moaDatasets, ...mradDatasets] },
  plugins: [crosshairPlugin, annotationPlugin([
    ...sonicAnn,
    { type: 'horizontal', value: 0, label: 'ZERO', color: 'rgba(0,212,255,0.3)' }
  ])],
  options: {
    responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
    events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
    interaction: { mode: 'index', intersect: false },
    onHover: (event, elements) => {
      if (crosshairPinned) return;
      if (elements.length > 0) {
        crosshairIndex = elements[0].index;
        updateReadout(results, crosshairIndex);
      } else {
        crosshairIndex = null;
        const panel = document.getElementById('rangeReadout');
        if (panel) panel.style.display = 'none';
      }
      Object.values(charts).forEach(c => {
        if (c !== charts['adjustmentChart']) c.update('none');
      });
    },
    onClick: (event, elements) => {
      if (elements.length === 0) return;
      crosshairPinned = !crosshairPinned;
      const btn = document.getElementById('readoutPin');
      if (btn) {
        btn.textContent = crosshairPinned ? 'UNPIN' : 'PIN';
        btn.classList.toggle('pinned', crosshairPinned);
      }
      if (crosshairPinned) {
        crosshairIndex = elements[0].index;
        updateReadout(results, crosshairIndex);
      }
      Object.values(charts).forEach(c => c.update('none'));
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Range (m)', color: '#3a5060',
                 font: { family: 'Share Tech Mono', size: 9 } },
        grid: { color: 'rgba(30,48,64,0.6)' },
        ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }
      },
      yL: {
        type: 'linear', position: 'left',
        title: { display: true, text: 'MOA', color: '#3a5060',
                 font: { family: 'Share Tech Mono', size: 9 } },
        grid: { color: 'rgba(30,48,64,0.6)' },
        ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }
      },
      yR: {
        type: 'linear', position: 'right',
        title: { display: true, text: 'MRAD', color: '#3a5060',
                 font: { family: 'Share Tech Mono', size: 9 } },
        grid: { drawOnChartArea: false },
        ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }
      }
    },
    plugins: {
      legend: {
        labels: {
          color: '#c8dde8', font: { family: 'Rajdhani', size: 12, weight: '600' },
          usePointStyle: true, pointStyleWidth: 12
        }
      },
      tooltip: {
        backgroundColor: '#141d26', borderColor: '#1e3040', borderWidth: 1,
        titleFont: { family: 'Share Tech Mono', size: 10 },
        bodyFont:  { family: 'Share Tech Mono', size: 10 },
        titleColor: '#00d4ff', bodyColor: '#c8dde8',
        padding: 10, displayColors: true
      }
    }
  }
});
```

### Zero reference line

The `{ type: 'horizontal', value: 0, label: 'ZERO', color: 'rgba(0,212,255,0.3)' }` annotation in `sonicAnn`-merged list produces a faint horizontal line at y=0 on the **left** (MOA) axis. Zero crossings naturally appear as the trajectory crosses the LoS (shot angle or mid-range bounce). This is intentional.

### Crosshair sync

`adjustmentChart` is registered in `charts`, so the existing `Object.values(charts).forEach(c => c.update('none'))` pattern syncs it automatically with all other panels.

### Touch support

Apply the same `touchmove → mousemove` forwarding pattern as the other canvases (see the forEach at the end of `renderResults`). Extend the existing loop:

```javascript
// existing loop already handles chartDefs panels; add adjustmentChart:
const adjCanvas = document.getElementById('adjustmentChart');
if (adjCanvas) {
  adjCanvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    adjCanvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: t.clientX, clientY: t.clientY, bubbles: true, cancelable: true
    }));
  }, { passive: false });
}
```

---

## MH-3 · Come-Ups / DOPE Card

### Placement

New card in the **Tools tab** (the tab that also contains the unit converter). Insert as the first card (above the unit converter) since DOPE is more frequently used.

### Distance input row

Default distances: `[100, 200, 300, 400, 500, 600, 700, 800, 1000]` metres (9 values). User can edit any value in-place (input type `number`, min 1, max 5000) and add/remove rows up to 10. Distances need not be sorted by the user, but sort them ascending before display.

**URL state:** encode as `dopeDistances=100,200,300,400,500,600,700,800,1000` (comma-separated integers). Read in `loadPrefsFromUrl()` / write in `syncUrl()`. Distances with 0 or negative values are ignored.

### Output table

One combined table. Layout:

```
| Range (m) | [Round A]         | [Round B]         |
|           | MOA ↑ | MRAD ↑ | Wind (cm) | MOA | MOA ↑ | MRAD ↑ | Wind (cm) | MOA |
|-----------|-------|--------|-----------|-----|-------|--------|-----------|-----|
| 100       | 0.0   | 0.0    | 0.0       | 0.0 | ...   | ...    | ...       | ... |
| 200       | 2.1   | 0.6    | 1.2       | 0.4 | ...   | ...    | ...       | ... |
```

Columns per round group:
- **MOA ↑** — `moaAdjustment` (elevation dial-up, positive = click up)
- **MRAD ↑** — `mradAdjustment`
- **Wind cm** — `windDriftCm` at a reference wind of **10 km/h** (see interpolation note)
- **Wind MOA** — `moaAdjustment` equivalent of the wind correction at 10 km/h

**Judgement call on Wind column:** The DOPE card shows wind correction at a fixed 10 km/h reference wind, not the simulated wind speed. This lets the user mentally scale (e.g., double for 20 km/h). The FE must run a separate client-side simulation (`simulateBullet`) or server call with `windSpeedKph: 10, windDirectionDeg: 90` for each selected bullet, using the same zero/altitude/temperature/step as the main simulation. Run these **client-side** (`simulateBullet`) to avoid a second batch API call.

### Data interpolation

For each requested distance:
1. Find the two adjacent trajectory points where `points[i].rangeMeters ≤ dist < points[i+1].rangeMeters`.
2. Linear interpolation: `val = p[i].field + (dist - p[i].rangeMeters) / (p[i+1].rangeMeters - p[i].rangeMeters) × (p[i+1].field - p[i].field)`.
3. If `dist > points[last].rangeMeters` → show `—` in that cell (out of range).
4. If `dist == 0` or matches a point exactly → use that point's value directly.

```javascript
function interpolateAt(points, distMeters, field) {
  if (points.length === 0) return null;
  if (distMeters > points[points.length - 1].rangeMeters) return null; // out of range
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].rangeMeters <= distMeters && distMeters <= points[i + 1].rangeMeters) {
      const t = (distMeters - points[i].rangeMeters) /
                (points[i + 1].rangeMeters - points[i].rangeMeters);
      return points[i][field] + t * (points[i + 1][field] - points[i][field]);
    }
  }
  return points[points.length - 1][field]; // exact last point
}
```

### "Copy text" button

Produces tab-separated plain text. Format:

```
Range	Round A MOA↑	Round A MRAD↑	Round A Wind cm	Round A Wind MOA	Round B ...
100	0.0	0.0	0.0	0.0	...
200	2.1	0.6	1.2	0.4	...
```

Header row tab-separated. Use `navigator.clipboard.writeText(text)` with a fallback `textarea.select(); document.execCommand('copy')`.

### HTML structure sketch

```html
<div class="tool-card" id="dopeCard">
  <div class="tool-card-title">COME-UPS / DOPE</div>
  <div id="dopeDistanceRow">
    <!-- distance inputs -->
  </div>
  <div id="dopeTableWrap" style="overflow-x: auto">
    <table id="dopeTable"><!-- rendered by renderDopeCard() --></table>
  </div>
  <button id="dopeCopyBtn">COPY TEXT</button>
</div>
```

Call `renderDopeCard()` whenever bullet selection or simulation results change, and whenever a distance input is edited.

---

## MH-4 · Sensitivity Analysis — Condition Sweep

### Entry point

A **SWEEP** toggle button in the sidebar, visible only when **exactly one bullet is selected** (`selectedIds.size === 1`). Position it below the existing RUN button. When active: button text changes to `SWEEP ACTIVE`; when inactive: `SWEEP`.

```javascript
// Update visibility in updateSweepButtonVisibility():
const sweepBtn = document.getElementById('sweepBtn');
if (sweepBtn) sweepBtn.style.display = selectedIds.size === 1 ? 'inline-block' : 'none';
```

### Sweep parameter selector

Dropdown (`<select id="sweepParam">`):
- `wind` — Wind speed (km/h): steps `[0, 8, 16, 24, 32]`
- `altitude` — Altitude (m): steps `[0, 500, 1000, 1500, 2000]`
- `temperature` — Temperature (°C): steps `[-10, 0, 15, 25, 35]`

Steps are **fixed** (non-configurable). Rationale: keeps the UI simple, avoids a step-size input that most users don't need, and the ranges cover practical field conditions.

### Request construction

Take the current `req` (the last submitted request), override only the swept parameter:

```javascript
const SWEEP_STEPS = {
  wind:        [0, 8, 16, 24, 32],
  altitude:    [0, 500, 1000, 1500, 2000],
  temperature: [-10, 0, 15, 25, 35]
};

function buildSweepRequests(baseReq, sweepParam, bulletId) {
  return SWEEP_STEPS[sweepParam].map(val => ({
    ...baseReq,
    bulletId,
    windSpeedKph:  sweepParam === 'wind'        ? val : baseReq.windSpeedKph,
    altitudeMeters: sweepParam === 'altitude'   ? val : baseReq.altitudeMeters,
    temperatureC:  sweepParam === 'temperature' ? val : baseReq.temperatureC
  }));
}
```

### Execution

Call `POST /api/trajectories/batch` (rate limit: `BATCH` tier, 10 req/min). Pass all 5 requests in one `trajectory.batch` JSON-RPC call:

```javascript
const sweepResults = await rpcBatch(buildSweepRequests(req, sweepParam, bulletId));
```

Handle 429 (`-32002`): show `retryAfterSeconds` countdown in the sidebar and re-enable the SWEEP button after the wait.

### Color ramp

Use a 5-step sequential ramp from cool to warm (blue → red), independent of `BULLET_COLORS`. Hard-code these or generate via HSL interpolation:

```javascript
const SWEEP_COLORS = ['#4a90d9', '#7cb8e8', '#f0c040', '#f08030', '#d04020'];
// or via function:
function sweepColor(i, total) {
  const hue = 220 - (i / (total - 1)) * 220; // 220 (blue) → 0 (red)
  return `hsl(${hue}, 70%, 55%)`;
}
```

Legend labels: for wind sweep, `"Wind 0 km/h"`, `"Wind 8 km/h"`, …; for altitude, `"Alt 0 m"`, …; for temperature, `"−10°C"`, ….

### Presentation

Replace the normal multi-bullet chart with the sweep chart when sweep mode is active. Use the same `chartContainer` div:

```javascript
// Set a module-level flag:
let sweepMode = false;
let sweepResults = null;

function activateSweep() {
  sweepMode = true;
  renderSweepCharts(sweepResults, req, sweepParam);
}

function clearSweep() {
  sweepMode = false;
  sweepResults = null;
  renderResults(lastResults, req); // restore normal multi-bullet view
}
```

The sweep chart replaces all 5 panels (drop, velocity, energy, wind, adjustment) with 5 corresponding sweep panels using the sweep color ramp and step labels. Build using the same `buildChartConfig`/`chartDefs` pattern but with `sweepResults` datasets instead of bullet-grouped datasets.

**"CLEAR SWEEP" button:** appears in the sidebar when `sweepMode === true`; on click, calls `clearSweep()`.

### No new REST endpoints

Use `trajectory.batch` JSON-RPC (`POST /api/rpc`). Do not add REST endpoints for the sweep.

---

## SH-2 · BC Back-Calculator

### Placement

New card in the **Tools tab**, **below** the unit converter.

### Input fields

Match styling of existing sidebar inputs. Fields (all numeric, metric):

| Label | Field | Validation |
|---|---|---|
| Bullet weight (g) | `bcCalcWeightG` | > 0, ≤ 30 |
| Muzzle velocity (m/s) | `bcCalcMvMps` | > 0, ≤ 2000 |
| Measured drop (cm) | `bcCalcDropCm` | any (negative = below LoS) |
| Target range (m) | `bcCalcRangeM` | > 0, ≤ 5000 |
| Altitude (m) | `bcCalcAltM` | ≥ 0, ≤ 5000 |
| Temperature (°C) | `bcCalcTempC` | −50 to 60 |

### Algorithm: bisection on G1 BC

```javascript
function calcBC(weightG, mvMps, measuredDropCm, rangeM, altM, tempC) {
  const CONV = {
    mvFps: mvMps * FPS_PER_MPS,
    wLbs:  weightG / G_PER_LB,
    rho:   airDensityRatio(altM * FT_PER_M, tempC * 9/5 + 32),
    zeroFt: 100 * FT_PER_M   // assume 100 m zero for the calculation
  };

  function dropAtBC(bc) {
    const angle = findZeroAngleFps(CONV.mvFps, bc, CONV.rho, CONV.zeroFt, 38.1 / 304.8);
    const { points } = integrateTrajectoryFps(
      CONV.mvFps, angle, bc, CONV.rho, CONV.wLbs,
      0,          // no wind for BC solving
      rangeM / M_PER_YARD + 1,
      rangeM / M_PER_YARD,
      1           // cosAngle = 1 (flat fire)
    );
    // find closest point to rangeM
    const pt = points.reduce((a, b) =>
      Math.abs(b.rangeMeters - rangeM) < Math.abs(a.rangeMeters - rangeM) ? b : a, points[0]);
    return pt ? pt.dropCm : NaN;
  }

  let lo = 0.05, hi = 1.5;
  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const drop = dropAtBC(mid);
    if (Math.abs(drop - measuredDropCm) < 0.5) return { bc: mid, solvedDrop: drop };
    if (drop > measuredDropCm) lo = mid; else hi = mid;
  }
  return null; // no convergence
}
```

**Judgement call on bisection direction:** `drop` values are negative (below LoS). Higher BC = less drop (less negative). If `drop > measuredDropCm` (current BC drops less than measured), the actual BC must be lower → `lo = mid` (tighten lower bound). This is correct for the sign convention where more negative = more drop.

**Zero assumption for the solver:** use a fixed 100 m zero. The solver's purpose is to match the drop at a specific range, and a reasonable zero just sets the angle. Using the same 100 m zero for the solve and reporting the solved drop makes the output internally consistent.

### Output

```
G1 BC:   0.4832
G7 BC:   0.9568  (G1 ÷ 0.505 — approximate)
Solved drop at [range] m:  −45.2 cm  (measured: −45.0 cm)
```

Display 4 decimal places for both BCs. G7 estimate = G1 BC / 0.505 (Litz conversion factor for typical match bullets). Label it "approx" since the conversion factor varies by bullet form.

**Error states:**
- No convergence after 50 iterations → `"No solution: check inputs (drop may be impossible for a BC in [0.05–1.5])"`.
- Range ≤ 0 → input validation error shown inline.

### HTML structure sketch

```html
<div class="tool-card" id="bcCalcCard">
  <div class="tool-card-title">BC BACK-CALCULATOR</div>
  <div class="tool-row">
    <label>Weight (g)</label><input id="bcCalcWeightG" type="number" step="0.01">
    <!-- ... other inputs ... -->
  </div>
  <button id="bcCalcBtn">CALCULATE</button>
  <div id="bcCalcResult" class="tool-result"></div>
</div>
```

Wire up `bcCalcBtn` click to run `calcBC()` and render results into `#bcCalcResult`.
