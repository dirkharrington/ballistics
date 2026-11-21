import { bulletForDragModel } from './custom-bullets.js';
import { simulateAsync } from './physics/engine-async.ts';
import { TrajectoryInputError } from './physics/errors.ts';
import { _setSimulationError } from './prefs.js';
import { normalizeUnitSystem, toDisplay, unitLabel, readMetricInputValue } from './units.js';
import {
  _loadChart, _warmChart, _chartAnimation, _lineTension, buildChartConfig,
  resetCrosshairState, _resetReadoutCache, destroyCharts,
  _observeChartCanvases, _attachTouchForwarder, _getChartState,
  _setChartEntry, _getChartMeta, CHART_LOAD_ERROR_MSG,
} from './charts.js';

// Five-step sweep color ramp (independent of bullet catalog colors)
export const SWEEP_COLORS = ['#00d4ff', '#4ADE80', '#f59e0b', '#f472b6', '#a78bfa'];

export const SWEEP_CHART_IDS = ['sweepDropChart', 'sweepWindChart', 'sweepVelChart'];

export const SWEEP_RANGES = {
  wind:        [0, 10, 20, 30, 40],
  altitude:    [0, 500, 1000, 2000, 3000],
  temperature: [0, 10, 20, 30, 40],
};

/** Toggle visibility of the parameter sweep controls based on selection count. */
export function updateSweepButtonVisibility(selected) {
  const count = typeof selected === 'number' ? selected : (selected?.size ?? 0);
  const sweepControls = document.getElementById('sweepControls');
  if (sweepControls) sweepControls.style.display = count > 0 ? 'block' : 'none';
}

/** Build the 5 simulation requests for a parameter sweep on a single bullet. */
export function buildSweepRequests(baseReq, sweepParam, bulletId) {
  const values = SWEEP_RANGES[sweepParam] ?? SWEEP_RANGES.wind;
  return values.map(v => {
    const r = { ...baseReq, bulletIds: [bulletId] };
    if (sweepParam === 'wind')        r.windSpeedKph   = v;
    if (sweepParam === 'altitude')    r.altitudeMeters = v;
    if (sweepParam === 'temperature') r.temperatureC   = v;
    return r;
  });
}

/** Render the 3 parameter sweep comparison charts (reusing instances in place). */
export async function renderSweepCharts(sweepResultsList, sweepParam, { onExportPNG, unitSystem = 'metric' } = {}) {
  const sys         = normalizeUnitSystem(unitSystem);
  const rUnit       = unitLabel('range', sys);
  const dUnit       = unitLabel('drop', sys);
  const drUnit      = unitLabel('drift', sys);
  const vUnit       = unitLabel('velocity', sys);
  const values      = SWEEP_RANGES[sweepParam] ?? SWEEP_RANGES.wind;
  const paramKind   = { wind: 'windSpeed', altitude: 'altitude', temperature: 'temp' }[sweepParam];
  const dispValues  = paramKind ? values.map(v => toDisplay(paramKind, v, sys)) : values;
  const labels      = {
    wind:        unitLabel('windSpeed', sys),
    altitude:    `${unitLabel('altitude', sys)} alt`,
    temperature: unitLabel('temp', sys),
  };
  const unit        = labels[sweepParam] ?? '';
  const subtitle    = `${sweepParam} sweep (${dispValues.join(', ')} ${unit})`;

  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';
  const cc = document.getElementById('chartContainer');

  resetCrosshairState();
  _resetReadoutCache();

  const sweepDefs = [
    { id: 'sweepDropChart', title: 'SWEEP — BULLET DROP', yLabel: `Drop (${dUnit})`,      key: 'dropCm',      unitKind: 'drop'     },
    { id: 'sweepWindChart', title: 'SWEEP — WIND DRIFT',  yLabel: `Drift (${drUnit})`,    key: 'windDriftCm', unitKind: 'drift'    },
    { id: 'sweepVelChart',  title: 'SWEEP — VELOCITY',    yLabel: `Velocity (${vUnit})`,  key: 'velocityMps', unitKind: 'velocity' },
  ];

  let ChartCtor;
  try {
    ({ Chart: ChartCtor } = await _loadChart());
  } catch (_) {
    _setSimulationError(CHART_LOAD_ERROR_MSG);
    return;
  }

  const buildSweepDatasets = def => sweepResultsList.map((r, i) => ({
    label:            `${dispValues[i]} ${unit}`,
    data:             r.points.map(p => ({
      x: toDisplay('range', p.rangeMeters, sys),
      y: toDisplay(def.unitKind, p[def.key], sys),
    })),
    borderColor:      SWEEP_COLORS[i % SWEEP_COLORS.length],
    backgroundColor:  'transparent',
    borderWidth:      2,
    pointRadius:      0,
    pointHoverRadius: 4,
    tension:          _lineTension(r.points),
  }));

  const { charts } = _getChartState();
  const canReuse = SWEEP_CHART_IDS.every(id => charts[id] && _getChartMeta(id) && document.getElementById(id));

  if (canReuse) {
    sweepDefs.forEach(def => {
      const subEl = document.getElementById(def.id)?.closest('.chart-panel')?.querySelector('.chart-subtitle');
      /* istanbul ignore else -- .chart-subtitle is always present inside .chart-panel */
      if (subEl) subEl.textContent = subtitle;
      const datasets = buildSweepDatasets(def);
      const meta = _getChartMeta(def.id);
      meta.results = sweepResultsList;
      meta.unitSystem = sys;
      const anim = _chartAnimation(datasets);
      charts[def.id].data.datasets = datasets;
      charts[def.id].options.scales.x.title.text = `Range (${rUnit})`;
      charts[def.id].options.scales.y.title.text = def.yLabel;
      charts[def.id].options.animation = anim;
      charts[def.id].update(anim ? undefined : 'none');
    });
    return;
  }

  cc.innerHTML = '';
  destroyCharts();

  sweepDefs.forEach(def => {
    cc.insertAdjacentHTML('beforeend', `
      <div class="chart-panel">
        <div class="chart-header">
          <div>
            <div class="chart-title"></div>
            <div class="chart-subtitle"></div>
          </div>
          <button class="export-btn" data-chart-id="${def.id}">PNG</button>
        </div>
        <div class="chart-wrap"><canvas id="${def.id}"></canvas></div>
      </div>`);
    const panel = cc.querySelector('.chart-panel:last-child');
    panel.querySelector('.chart-title').textContent = def.title;
    panel.querySelector('.chart-subtitle').textContent = subtitle;
    panel.querySelector('.export-btn')
      ?.addEventListener('click', () => onExportPNG?.(def.id));

    const datasets = buildSweepDatasets(def);
    const meta = { results: sweepResultsList, unitSystem: sys };
    const canvas = document.getElementById(def.id);
    const chart = new ChartCtor(canvas.getContext('2d'), buildChartConfig(def, datasets, sweepResultsList, { unitSystem: sys }));
    _setChartEntry(def.id, chart, meta);
    _attachTouchForwarder(canvas);
  });

  _observeChartCanvases(SWEEP_CHART_IDS);
}

/** Run a 5-step parameter sweep on the first selected bullet and render sweep charts. */
export async function runSweep({
  selectedIds,
  lastReq = null,
  getBulletById,
  nextSignal = null,
  onExportPNG = null,
  onSweepStateChange = null,
  unitSystem = 'metric',
}) {
  if (!selectedIds || selectedIds.size === 0) return;
  _setSimulationError(null);
  const sys        = normalizeUnitSystem(unitSystem);
  const bulletId   = [...selectedIds][0];
  const sweepParam = document.getElementById('sweepParam')?.value ?? 'wind';
  const btn        = document.getElementById('sweepBtn');
  if (btn) btn.querySelector('span').textContent = '⏳ SWEEPING...';

  const base = lastReq ?? {
    bulletIds:            [bulletId],
    zeroRangeMeters:      readMetricInputValue(document.getElementById('zeroRange'), 'range', sys),
    maxRangeMeters:       readMetricInputValue(document.getElementById('maxRange'), 'range', sys),
    stepMeters:           readMetricInputValue(document.getElementById('step'), 'step', sys),
    windSpeedKph:         readMetricInputValue(document.getElementById('windSpeed'), 'windSpeed', sys),
    windDirectionDeg:     +document.getElementById('windDir').value,
    altitudeMeters:       readMetricInputValue(document.getElementById('altitude'), 'altitude', sys),
    temperatureC:         readMetricInputValue(document.getElementById('temperature'), 'temp', sys),
    sightHeightMm:        readMetricInputValue(document.getElementById('sightHeight'), 'sightHeight', sys),
    shootingAngleDegrees: +document.getElementById('shootingAngle').value,
    dragModel:            document.getElementById('dragModel').value,
  };

  const requests = buildSweepRequests(base, sweepParam, bulletId);
  const bullet   = getBulletById?.(bulletId);

  if (!bullet) {
    if (btn) btn.querySelector('span').textContent = 'SWEEP';
    return;
  }

  _warmChart();
  const signal = nextSignal ? nextSignal() : undefined;
  let results;
  try {
    results = await Promise.all(
      requests.map(r => simulateAsync(
        bulletForDragModel(bullet, r.dragModel),
        r,
        signal ? { signal } : undefined,
      )),
    );
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (btn) btn.querySelector('span').textContent = 'SWEEP';
    /* istanbul ignore else -- simulate only throws TrajectoryInputError */
    if (err instanceof TrajectoryInputError) console.warn('[sweep]', err.message);
    return;
  }
  if (signal?.aborted) return;

  onSweepStateChange?.(true, results);
  await renderSweepCharts(results, sweepParam, { onExportPNG, unitSystem: sys });

  if (btn) btn.querySelector('span').textContent = 'SWEEP';
  const clearBtn = document.getElementById('clearSweepBtn');
  if (clearBtn) clearBtn.style.display = 'block';
}

/** Exit sweep mode and re-render the previous multi-bullet results if present. */
export async function clearSweep({
  lastResults = [],
  lastReq = null,
  renderResults = null,
  onSweepStateChange = null,
} = {}) {
  onSweepStateChange?.(false, null);
  const clearBtn = document.getElementById('clearSweepBtn');
  if (clearBtn) clearBtn.style.display = 'none';
  /* istanbul ignore else -- only callable after a simulation has run */
  if (lastResults.length && renderResults) await renderResults(lastResults, lastReq ?? {});
}
