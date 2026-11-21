import BULLET_CATALOG from 'virtual:bullet-catalog';
import { escapeHtml, formatNumber, computeAdjustments, _setSimulationError } from './prefs.js';
import { normalizeUnitSystem, toDisplay, unitLabel } from './units.js';

// ── Constants & colour helpers ────────────────────────────────────────────────

/** Map of built-in bullet IDs to hex colour strings from bullets.yaml. */
export const BULLET_COLORS = Object.fromEntries(BULLET_CATALOG.map(b => [b.id, b.hexColor]));

/** Regex for a safe CSS hex colour — #rrggbb exactly. */
export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Returns the display colour for any bullet (custom or built-in). */
export function colorFor(bullet) {
  const hex = bullet.hexColor;
  const validHex = (typeof hex === 'string' && HEX_COLOR_RE.test(hex)) ? hex : null;
  return validHex || BULLET_COLORS[bullet.id] || '#4ADE80';
}

export const TRAJECTORY_CHART_IDS = ['dropChart', 'velocityChart', 'energyChart', 'windChart', 'adjustChart'];
export const CHART_LOAD_ERROR_MSG = "Couldn't load the chart library. Check your connection and try again.";

// ── Module state ──────────────────────────────────────────────────────────────

let charts = {};
let _chartMeta = {};
let crosshairIndex = null;
let crosshairPinned = false;
let _crosshairRafId = null;
let _pendingCrosshair = null;
let _chartObserver = null;
const _visibleChartIds = new Set();
const _dirtyCrosshairCharts = new Set();
let _readoutCache = null;
let _chartModPromise = null;
let _activeUnitSystem = 'metric';

// ── Lazy Chart.js loader (PERF-3 / PERF-23) ───────────────────────────────────

/** Load and register Chart.js components once; evict cached promise on rejection. */
export function _loadChart() {
  if (!_chartModPromise) {
    _chartModPromise = import('./chart-loader.js').then(mod => {
      mod.Chart.register(
        mod.LineController, mod.LineElement, mod.PointElement,
        mod.LinearScale, mod.Decimation, mod.Tooltip, mod.Legend,
      );
      return mod;
    }).catch(err => {
      _chartModPromise = null;
      throw err;
    });
  }
  return _chartModPromise;
}

/** Kick off the Chart.js chunk import early without throwing on failure (PERF-23). */
export function _warmChart() {
  return _loadChart().catch(() => {});
}

// ── Chart annotation helpers ──────────────────────────────────────────────────

/** Draw a vertical dashed annotation line with a text label. */
export function drawVLine(ctx, xScale, chartArea, ann) {
  // Clamp to scale.max so a value beyond the range doesn't escape the chart area
  const xPx = xScale.getPixelForValue(Math.min(ann.value, xScale.max));
  ctx.beginPath();
  ctx.moveTo(xPx, chartArea.top);
  ctx.lineTo(xPx, chartArea.bottom);
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.fillStyle = ann.color;
  ctx.font = '9px "Share Tech Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(ann.label, xPx + 3, chartArea.top + 10);
}

/** Draw a horizontal dashed annotation line with a text label. */
export function drawHLine(ctx, yScale, chartArea, ann) {
  const yPx = yScale.getPixelForValue(ann.value);
  ctx.beginPath();
  ctx.moveTo(chartArea.left, yPx);
  ctx.lineTo(chartArea.right, yPx);
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.fillStyle = ann.color;
  ctx.font = '9px "Share Tech Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(ann.label, chartArea.left + 3, yPx - 4);
}

/**
 * Build a Chart.js plugin that draws dashed annotation lines after each render.
 *
 * @param {Array<{type:'vertical'|'horizontal', value:number, label:string, color:string}>} annotations
 * @returns {object} Chart.js plugin object
 */
export function annotationPlugin(annotations) {
  return {
    id: 'ballistics-annotations',
    afterDraw(chart) {
      if (!annotations.length) return;
      const { ctx, scales: { x, y }, chartArea } = chart;
      ctx.save();
      for (const ann of annotations) {
        if (ann.type === 'vertical') drawVLine(ctx, x, chartArea, ann);
        else                         drawHLine(ctx, y, chartArea, ann);
      }
      ctx.restore();
    },
  };
}

/** Crosshair plugin — draws a vertical dashed line at the hovered/pinned data index. */
export const crosshairPlugin = {
  id: 'ballistics-crosshair',
  afterDraw(chart) {
    if (crosshairIndex === null) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data[crosshairIndex]) return;
    const x = meta.data[crosshairIndex].x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.strokeStyle = crosshairPinned ? 'rgba(0,212,255,0.7)' : 'rgba(0,212,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

// ── Touch forwarder (Item 4) ──────────────────────────────────────────────────

/** Translates touchmove to mousemove on chart canvases for mobile crosshair scrubbing. */
export function _attachTouchForwarder(canvas) {
  canvas.addEventListener('touchmove', e => {
    const t = e.touches[0];
    canvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: t.clientX, clientY: t.clientY,
      bubbles: true, cancelable: true,
    }));
  }, { passive: true });
}

// ── Range readout (PERF-32 cached cells) ──────────────────────────────────────

function _buildReadoutRow(r) {
  const row = document.createElement('tr');
  const nameCell = document.createElement('td');
  const dot = document.createElement('span');
  dot.className = 'bullet-dot';
  dot.setAttribute('style', `background:${colorFor(r.bullet)}`);
  nameCell.appendChild(dot);
  nameCell.appendChild(document.createTextNode(r.bullet.name));
  const dropCell   = document.createElement('td');
  const velCell    = document.createElement('td');
  const energyCell = document.createElement('td');
  const windCell   = document.createElement('td');
  row.append(nameCell, dropCell, velCell, energyCell, windCell);
  return {
    row,
    dropCell,
    velCell,
    energyCell,
    windCell,
    spinCell: document.createElement('td'),
    corCell:  document.createElement('td'),
  };
}

/** Populate the range readout panel below the charts for a given data point index. */
export function updateReadout(results, dataIndex, unitSystem = _activeUnitSystem) {
  const panel = document.getElementById('rangeReadout');
  if (!panel) return;
  const first = results[0];
  if (!first?.points[dataIndex]) return;

  const sys    = normalizeUnitSystem(unitSystem);
  const rUnit  = unitLabel('range', sys);
  const dUnit  = unitLabel('drop', sys);
  const vUnit  = unitLabel('velocity', sys);
  const eUnit  = unitLabel('energy', sys);
  const drUnit = unitLabel('drift', sys);

  const range = toDisplay('range', first.points[dataIndex].rangeMeters, sys);
  const rangeEl = document.getElementById('readoutRange');
  /* istanbul ignore else -- #readoutRange is always present in the app shell */
  if (rangeEl) rangeEl.textContent = `${range} ${rUnit}`;

  const tbody = document.getElementById('readoutBody');
  /* istanbul ignore else -- #readoutBody is always present in the app shell */
  if (tbody) {
    if (!_readoutCache || _readoutCache.results !== results || _readoutCache.tbody !== tbody) {
      const frag = document.createDocumentFragment();
      const rows = results.map(r => {
        const entry = _buildReadoutRow(r);
        frag.appendChild(entry.row);
        return entry;
      });
      tbody.textContent = '';
      tbody.appendChild(frag);
      _readoutCache = { results, tbody, rows };
    }

    const sign = v => v > 0 ? '+' : '';
    for (let i = 0; i < results.length; i++) {
      const entry = _readoutCache.rows[i];
      const p = results[i].points[dataIndex];
      if (!p) {
        entry.row.style.display = 'none';
        continue;
      }
      entry.row.style.display = '';
      const dropVal   = toDisplay('drop', p.dropCm, sys);
      const velVal    = toDisplay('velocity', p.velocityMps, sys);
      const energyVal = toDisplay('energy', p.energyJoules, sys);
      const windVal   = toDisplay('drift', p.windDriftCm, sys);
      entry.dropCell.textContent   = `${sign(dropVal)}${dropVal} ${dUnit}`;
      entry.velCell.textContent    = `${velVal} ${vUnit}`;
      entry.energyCell.textContent = `${energyVal} ${eUnit}`;
      entry.windCell.textContent   = `${sign(windVal)}${windVal} ${drUnit}`;

      if (p.spinDriftCm > 0) {
        const spinVal = toDisplay('drift', p.spinDriftCm, sys);
        entry.spinCell.textContent = `Spin Drift: ${spinVal.toFixed(1)} ${drUnit}`;
        if (entry.spinCell.parentNode !== entry.row) {
          entry.row.insertBefore(entry.spinCell, entry.corCell.parentNode === entry.row ? entry.corCell : null);
        }
      } else if (entry.spinCell.parentNode === entry.row) {
        entry.spinCell.remove();
      }

      if (p.coriolisDeflectionCm != null) {
        const corVal = toDisplay('drift', p.coriolisDeflectionCm, sys);
        entry.corCell.textContent = `Coriolis: ${corVal >= 0 ? '+' : ''}${corVal.toFixed(1)} ${drUnit}`;
        if (entry.corCell.parentNode !== entry.row) {
          entry.row.appendChild(entry.corCell);
        }
      } else if (entry.corCell.parentNode === entry.row) {
        entry.corCell.remove();
      }
    }
  }

  panel.style.display = 'block';
}

// ── Viewport-aware chart redraws & crosshair rAF coalescing (PERF-20, PERF-32) ─

export function _teardownChartObserver() {
  if (_chartObserver) {
    _chartObserver.disconnect();
    _chartObserver = null;
  }
  _visibleChartIds.clear();
  _dirtyCrosshairCharts.clear();
}

function _drawChart(chart) {
  if (typeof chart.draw === 'function') chart.draw();
  else chart.update('none');
}

function _redrawSiblingCharts(sourceChartId) {
  for (const [id, c] of Object.entries(charts)) {
    if (id === sourceChartId) continue;
    if (_chartObserver && !_visibleChartIds.has(id)) {
      _dirtyCrosshairCharts.add(id);
    } else {
      _drawChart(c);
    }
  }
}

export function _observeChartCanvases(ids) {
  _teardownChartObserver();
  if (typeof IntersectionObserver !== 'function') return;
  _chartObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const id = entry.target.id;
      if (entry.isIntersecting) {
        _visibleChartIds.add(id);
        if (_dirtyCrosshairCharts.has(id) && charts[id]) {
          _dirtyCrosshairCharts.delete(id);
          _drawChart(charts[id]);
        }
      } else {
        _visibleChartIds.delete(id);
      }
    }
  });
  for (const id of ids) {
    const el = document.getElementById(id);
    /* istanbul ignore else -- canvas is always present when chart is created */
    if (el) {
      _visibleChartIds.add(id);
      _chartObserver.observe(el);
    }
  }
}

function _cancelCrosshairRaf() {
  if (_crosshairRafId !== null) {
    cancelAnimationFrame(_crosshairRafId);
    _crosshairRafId = null;
  }
  _pendingCrosshair = null;
}

/** Coalesce crosshair hover updates via requestAnimationFrame and redraw visible siblings. */
export function scheduleCrosshairSync(nextIndex, sourceChartId, results, unitSystem = _activeUnitSystem) {
  if (nextIndex === crosshairIndex) return;
  crosshairIndex = nextIndex;
  _pendingCrosshair = { index: nextIndex, sourceChartId, results, unitSystem };
  if (_crosshairRafId === null) {
    _crosshairRafId = requestAnimationFrame(() => {
      _crosshairRafId = null;
      const { index, sourceChartId: srcId, results: res, unitSystem: sys } = _pendingCrosshair;
      _pendingCrosshair = null;
      if (index !== null) {
        updateReadout(res, index, sys);
      } else {
        const panel = document.getElementById('rangeReadout');
        /* istanbul ignore else -- #rangeReadout is always present in the app shell */
        if (panel) panel.style.display = 'none';
      }
      _redrawSiblingCharts(srcId);
    });
  }
}

function _handleChartClick(elements, results, unitSystem) {
  if (elements.length === 0) return;
  _cancelCrosshairRaf();
  crosshairPinned = !crosshairPinned;
  const btn = document.getElementById('readoutPin');
  /* istanbul ignore else -- #readoutPin is always present in the app shell */
  if (btn) {
    btn.textContent = crosshairPinned ? 'UNPIN' : 'PIN';
    btn.classList.toggle('pinned', crosshairPinned);
  }
  if (crosshairPinned) {
    crosshairIndex = elements[0].index;
    updateReadout(results, crosshairIndex, unitSystem);
  } else {
    crosshairIndex = null;
    const panel = document.getElementById('rangeReadout');
    /* istanbul ignore else -- #rangeReadout is always present in the app shell */
    if (panel) panel.style.display = 'none';
  }
  _redrawSiblingCharts(null);
}

/** Click handler for #readoutPin button. */
export function toggleReadoutPin() {
  crosshairPinned = !crosshairPinned;
  const btn = document.getElementById('readoutPin');
  /* istanbul ignore else -- #readoutPin is always present in the app shell */
  if (btn) {
    btn.textContent = crosshairPinned ? 'UNPIN' : 'PIN';
    btn.classList.toggle('pinned', crosshairPinned);
  }
  if (!crosshairPinned) {
    crosshairIndex = null;
    const panel = document.getElementById('rangeReadout');
    /* istanbul ignore else -- #rangeReadout is always present in the app shell */
    if (panel) panel.style.display = 'none';
    _redrawSiblingCharts(null);
  }
}

/** Reset crosshair to initial (no hover, no pin) state. */
export function resetCrosshairState() {
  _cancelCrosshairRaf();
  _dirtyCrosshairCharts.clear();
  crosshairIndex  = null;
  crosshairPinned = false;
  const pinBtn = document.getElementById('readoutPin');
  /* istanbul ignore else -- #readoutPin is always present in the app shell */
  if (pinBtn) { pinBtn.textContent = 'PIN'; pinBtn.classList.remove('pinned'); }
  const readout = document.getElementById('rangeReadout');
  /* istanbul ignore else -- #rangeReadout is always present in the app shell */
  if (readout) readout.style.display = 'none';
}

// ── Chart performance helpers (PERF-21) ───────────────────────────────────────

function _prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function _chartAnimation(datasets) {
  if (_prefersReducedMotion()) return false;
  let total = 0;
  for (const ds of datasets) total += ds.data.length;
  return total > 1000 ? false : { duration: 250 };
}

export function _lineTension(points) {
  return points.length > 200 ? 0 : 0.3;
}

// ── Stat cards ────────────────────────────────────────────────────────────────

function _statCardsHtml(results, unitSystem) {
  const sys    = normalizeUnitSystem(unitSystem);
  const vUnit  = unitLabel('velocity', sys);
  const wUnit  = unitLabel('weight', sys);
  const eUnit  = unitLabel('energy', sys);
  const rUnit  = unitLabel('range', sys);
  const dUnit  = unitLabel('drop', sys);
  const aUnit  = unitLabel('altitude', sys);
  return `
    <div class="stats-grid">
      ${results.map(r => {
        const color = colorFor(r.bullet);
        const daLine = r.densityAltitudeMeters !== undefined
          ? `<br><span style="color:var(--text)">${toDisplay('altitude', Number(r.densityAltitudeMeters), sys)}</span> ${aUnit} density alt`
          : '';
        const mvDisp = toDisplay('velocity', Number(r.bullet.muzzleVelocityMps), sys);
        const wtDisp = toDisplay('weight', Number(r.bullet.bulletWeightGrams), sys);
        const meDisp = toDisplay('energy', Number(r.bullet.muzzleEnergyJoules), sys);
        const supDisp = toDisplay('range', Number(r.supersonicLimitMeters), sys);
        const maxOrdDisp = toDisplay('drop', Number(r.maxOrdinateCm), sys);
        const maxOrdRangeDisp = toDisplay('range', Number(r.maxOrdinateRangeMeters), sys);
        return `
        <div class="stat-card" style="--bullet-color:${color}">
          <div class="stat-label" style="color:${color}">${escapeHtml(r.bullet.name)}</div>
          <div class="stat-value">${formatNumber(mvDisp)}</div>
          <div class="stat-unit">MV ${vUnit} &nbsp;·&nbsp; BC ${Number(r.bullet.ballisticCoefficient)} &nbsp;·&nbsp; ${wtDisp}${wUnit}</div>
          <div style="margin-top:8px; font-family:'Share Tech Mono',monospace; font-size:9px; color:var(--text-dim); letter-spacing:1px; line-height:1.8">
            <span style="color:var(--text)">⚡ ${formatNumber(meDisp)}</span> ${eUnit} muzzle energy<br>
            <span style="color:var(--text)">${supDisp}</span> ${rUnit} supersonic${daLine}<br>
            <span style="color:var(--text)">${maxOrdDisp}</span> ${dUnit} max ordinate @ ${maxOrdRangeDisp} ${rUnit}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/** Render per-bullet summary stat cards into container. */
export function renderStatCards(results, container, unitSystem = 'metric') {
  container.insertAdjacentHTML('beforeend', _statCardsHtml(results, unitSystem));
}

// ── Chart config & dataset builders ───────────────────────────────────────────

/** Human-readable wind subtitle showing speed and compass direction. */
export function windChartSubtitle(req, unitSystem = 'metric') {
  if (!req.windSpeedKph) return 'no wind';
  const sys   = normalizeUnitSystem(unitSystem);
  const dir   = req.windDirectionDeg ?? 90;
  const dirs  = ['N','NE','E','SE','S','SW','W','NW','N'];
  const label = dirs[Math.round(dir / 45) % 8];
  const speed = toDisplay('windSpeed', req.windSpeedKph, sys);
  return `${speed} ${unitLabel('windSpeed', sys)} from ${label}`;
}

/**
 * Build a Chart.js config for one trajectory or sweep chart panel.
 *
 * @param {{ id: string, title?: string, subtitle?: string, yLabel?: string, xLabel?: string,
 *           key?: string, annotations?: Array<object>, scales?: object }} def
 * @param {object[]} datasets  Pre-built Chart.js dataset array.
 * @param {object[]} results   Simulation results used by hover/click callbacks.
 * @param {{ unitSystem?: 'metric'|'imperial' }} [opts]
 * @returns {object} Chart.js config ready for `new Chart(ctx, config)`.
 */
export function buildChartConfig(def, datasets, results, { unitSystem = 'metric' } = {}) {
  const sys = normalizeUnitSystem(unitSystem);
  const getResults    = () => _chartMeta[def.id]?.results ?? results;
  const getUnitSystem = () => _chartMeta[def.id]?.unitSystem ?? sys;
  const scales = def.scales ?? {
    x: {
      type: 'linear',
      title: { display: true, text: `Range (${unitLabel('range', sys)})`, color: '#3a5060',
               font: { family: 'Share Tech Mono', size: 9 } },
      grid: { color: 'rgba(30,48,64,0.6)' },
      ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } },
    },
    y: {
      title: { display: true, text: def.yLabel, color: '#3a5060',
               font: { family: 'Share Tech Mono', size: 9 } },
      grid: { color: 'rgba(30,48,64,0.6)' },
      ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } },
    },
  };
  return {
    type: 'line',
    data: { datasets },
    plugins: [crosshairPlugin, annotationPlugin(def.annotations ?? [])],
    options: {
      responsive: true, maintainAspectRatio: false,
      parsing: false, normalized: true,
      animation: _chartAnimation(datasets),
      events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
      interaction: { mode: 'nearest', intersect: false },
      onHover: (event, elements) => {
        if (crosshairPinned) return;
        const nextIndex = elements.length > 0 ? elements[0].index : null;
        scheduleCrosshairSync(nextIndex, def.id, getResults(), getUnitSystem());
      },
      onClick: (event, elements) => {
        _handleChartClick(elements, getResults(), getUnitSystem());
      },
      scales,
      plugins: {
        decimation: { enabled: true, algorithm: 'lttb', samples: 250, threshold: 250 },
        legend: {
          labels: {
            color: '#c8dde8', font: { family: 'Rajdhani', size: 12, weight: '600' },
            usePointStyle: true, pointStyleWidth: 12,
          },
        },
        tooltip: {
          backgroundColor: '#141d26', borderColor: '#1e3040', borderWidth: 1,
          titleFont: { family: 'Share Tech Mono', size: 10 },
          bodyFont:  { family: 'Share Tech Mono', size: 10 },
          titleColor: '#00d4ff', bodyColor: '#c8dde8',
          padding: 10, displayColors: true,
        },
      },
    },
  };
}

function _buildTrajectoryDatasets(def, results, unitSystem) {
  const sys = normalizeUnitSystem(unitSystem);
  const datasets = results.map(r => ({
    label:            r.bullet.name,
    data:             r.points.map(p => ({
      x: toDisplay('range', p.rangeMeters, sys),
      y: toDisplay(def.unitKind, p[def.key], sys),
    })),
    borderColor:      colorFor(r.bullet),
    backgroundColor:  'transparent',
    borderWidth:      2,
    pointRadius:      0,
    pointHoverRadius: 4,
    tension:          _lineTension(r.points),
  }));

  if (def.id === 'windChart') {
    const hasSpinDrift = results.some(r => r.points.some(p => p.spinDriftCm));
    if (hasSpinDrift) {
      results.forEach(r => {
        datasets.push({
          label:            r.bullet.name + ' (spin drift)',
          data:             r.points.map(p => ({
            x: toDisplay('range', p.rangeMeters, sys),
            y: toDisplay('drift', p.spinDriftCm ?? 0, sys),
          })),
          borderColor:      colorFor(r.bullet),
          backgroundColor:  'transparent',
          borderWidth:      1.5,
          borderDash:       [5, 5],
          pointRadius:      0,
          pointHoverRadius: 4,
          tension:          _lineTension(r.points),
        });
      });
    }
    const hasCoriolisDrift = results.some(r => r.points.some(p => p.coriolisDeflectionCm));
    if (hasCoriolisDrift) {
      results.forEach(r => {
        datasets.push({
          label:            r.bullet.name + ' (coriolis)',
          data:             r.points.map(p => ({
            x: toDisplay('range', p.rangeMeters, sys),
            y: toDisplay('drift', p.coriolisDeflectionCm ?? 0, sys),
          })),
          borderColor:      colorFor(r.bullet),
          backgroundColor:  'transparent',
          borderWidth:      1.5,
          borderDash:       [2, 4],
          pointRadius:      0,
          pointHoverRadius: 4,
          tension:          _lineTension(r.points),
        });
      });
    }
  }
  return datasets;
}

function _buildAdjustmentDatasets(results, unitSystem) {
  const sys          = normalizeUnitSystem(unitSystem);
  const moaDatasets  = [];
  const mradDatasets = [];
  results.forEach(r => {
    const color   = colorFor(r.bullet);
    const tension = _lineTension(r.points);
    const len     = r.points.length;
    const moaData  = new Array(len);
    const mradData = new Array(len);
    for (let i = 0; i < len; i++) {
      const p = r.points[i];
      const a = computeAdjustments(p.dropCm, p.rangeMeters);
      const x = toDisplay('range', p.rangeMeters, sys);
      moaData[i]  = { x, y: a.moa };
      mradData[i] = { x, y: a.mrad };
    }
    moaDatasets.push({
      label:            r.bullet.name + ' MOA',
      data:             moaData,
      borderColor:      color,
      backgroundColor:  'transparent',
      borderWidth:      2,
      pointRadius:      0,
      pointHoverRadius: 4,
      tension,
      yAxisID:          'yMoa',
    });
    mradDatasets.push({
      label:            r.bullet.name + ' MRAD',
      data:             mradData,
      borderColor:      color,
      backgroundColor:  'transparent',
      borderWidth:      1.5,
      borderDash:       [4, 4],
      pointRadius:      0,
      pointHoverRadius: 4,
      tension,
      yAxisID:          'yMrad',
    });
  });
  return [...moaDatasets, ...mradDatasets];
}

// ── Chart lifecycle & rendering ───────────────────────────────────────────────

/** Destroy all active Chart.js instances and clear chart metadata & observer state. */
export function destroyCharts() {
  Object.values(charts).forEach(c => c.destroy());
  charts = {};
  _chartMeta = {};
  _teardownChartObserver();
}

/** Update Chart.js tooltip colours to match the active theme. */
export function _applyChartTheme(theme) {
  const isDark = theme === 'dark';
  const bg     = isDark ? '#141d26' : '#ffffff';
  const border = isDark ? '#1e3040' : '#b0c4d8';
  const title  = isDark ? '#00d4ff' : '#0077aa';
  const body   = isDark ? '#c8dde8' : '#1a2a38';
  Object.values(charts).forEach(chart => {
    if (chart.options?.plugins?.tooltip) {
      chart.options.plugins.tooltip.backgroundColor = bg;
      chart.options.plugins.tooltip.borderColor     = border;
      chart.options.plugins.tooltip.titleColor      = title;
      chart.options.plugins.tooltip.bodyColor       = body;
      chart.update('none');
    }
  });
}

/**
 * Render stat cards and the 5 trajectory charts (reusing existing Chart instances in place).
 * Returns the filtered valid results array.
 */
export async function renderCharts(rawResults, req = {}, { onExportPNG, unitSystem = 'metric' } = {}) {
  const sys     = normalizeUnitSystem(unitSystem);
  _activeUnitSystem = sys;
  const rUnit   = unitLabel('range', sys);
  const dUnit   = unitLabel('drop', sys);
  const vUnit   = unitLabel('velocity', sys);
  const eUnit   = unitLabel('energy', sys);
  const drUnit  = unitLabel('drift', sys);

  const results = rawResults.filter(r => r?.bullet);
  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';
  const cc = document.getElementById('chartContainer');
  const modelEl = document.getElementById('modelStatus');
  const isCustomModel = Boolean(req.customDragTable?.length || results.some(r => r.dragModel === 'custom'));
  /* istanbul ignore else -- #modelStatus is always present in the app shell */
  if (modelEl) modelEl.textContent = `MODEL: ${isCustomModel ? 'CUSTOM' : (req.dragModel ?? 'G1')}`;

  resetCrosshairState();
  _readoutCache = null;

  const first = results[0];
  const SONIC_COLOR = 'rgba(255,160,0,0.6)';
  const ORD_COLOR   = 'rgba(0,212,255,0.4)';
  const sonicAnn = first
    ? [{ type: 'vertical',   value: toDisplay('range', first.supersonicLimitMeters, sys),  label: 'SUPERSONIC ←', color: SONIC_COLOR }]
    : [];
  const dropAnns = first
    ? [
        ...sonicAnn,
        { type: 'horizontal', value: toDisplay('drop', first.maxOrdinateCm, sys),          label: 'MAX ORD', color: ORD_COLOR },
        { type: 'vertical',   value: toDisplay('range', first.maxOrdinateRangeMeters, sys), label: 'PEAK',    color: ORD_COLOR },
      ]
    : [];

  const zeroDisp = toDisplay('range', req.zeroRangeMeters, sys);
  const chartDefs = [
    { id: 'dropChart',     title: 'BULLET DROP',         subtitle: `zeroed at ${zeroDisp} ${rUnit}`,     yLabel: `Drop (${dUnit})`,      key: 'dropCm',       unitKind: 'drop',     annotations: [...dropAnns] },
    { id: 'velocityChart', title: 'VELOCITY RETENTION',  subtitle: `${vUnit} downrange`,                 yLabel: `Velocity (${vUnit})`,  key: 'velocityMps',  unitKind: 'velocity', annotations: [...sonicAnn] },
    { id: 'energyChart',   title: 'KINETIC ENERGY',      subtitle: `${sys === 'imperial' ? 'ft·lb' : 'joules'} downrange`, yLabel: `Energy (${eUnit})`, key: 'energyJoules', unitKind: 'energy', annotations: [...sonicAnn] },
    { id: 'windChart',     title: 'WIND DRIFT',          subtitle: windChartSubtitle(req, sys),          yLabel: `Drift (${drUnit})`,    key: 'windDriftCm',  unitKind: 'drift',    annotations: [...sonicAnn] },
  ];

  let ChartCtor = null;
  try {
    ({ Chart: ChartCtor } = await _loadChart());
  } catch (_) {
    _setSimulationError(CHART_LOAD_ERROR_MSG);
  }

  if (ChartCtor) {
    const canReuse = TRAJECTORY_CHART_IDS.every(id => charts[id] && _chartMeta[id] && document.getElementById(id));

    if (canReuse) {
      const existingStats = cc.querySelector('.stats-grid');
      /* istanbul ignore else -- .stats-grid is always created on initial renderCharts */
      if (existingStats) existingStats.outerHTML = _statCardsHtml(results, sys);

      chartDefs.forEach(def => {
        const subEl = document.getElementById(def.id)?.closest('.chart-panel')?.querySelector('.chart-subtitle');
        /* istanbul ignore else -- .chart-subtitle is always present inside .chart-panel */
        if (subEl) subEl.textContent = def.subtitle;
        const datasets = _buildTrajectoryDatasets(def, results, sys);
        const meta = _chartMeta[def.id];
        meta.results = results;
        meta.unitSystem = sys;
        meta.annotations.splice(0, meta.annotations.length, ...def.annotations);
        const anim = _chartAnimation(datasets);
        charts[def.id].data.datasets = datasets;
        charts[def.id].options.scales.x.title.text = `Range (${rUnit})`;
        charts[def.id].options.scales.y.title.text = def.yLabel;
        charts[def.id].options.animation = anim;
        charts[def.id].update(anim ? undefined : 'none');
      });

      const adjDatasets = _buildAdjustmentDatasets(results, sys);
      const adjMeta = _chartMeta.adjustChart;
      adjMeta.results = results;
      adjMeta.unitSystem = sys;
      adjMeta.annotations.splice(0, adjMeta.annotations.length, ...sonicAnn);
      const adjAnim = _chartAnimation(adjDatasets);
      charts.adjustChart.data.datasets = adjDatasets;
      charts.adjustChart.options.scales.x.title.text = `Range (${rUnit})`;
      charts.adjustChart.options.animation = adjAnim;
      charts.adjustChart.update(adjAnim ? undefined : 'none');
    } else {
      cc.innerHTML = '';
      destroyCharts();
      renderStatCards(results, cc, sys);

      chartDefs.forEach(def => {
        cc.insertAdjacentHTML('beforeend', `
          <div class="chart-panel">
            <div class="chart-header">
              <div>
                <div class="chart-title">${def.title}</div>
                <div class="chart-subtitle">${def.subtitle}</div>
              </div>
              <button class="export-btn" data-chart-id="${def.id}">PNG</button>
            </div>
            <div class="chart-wrap"><canvas id="${def.id}"></canvas></div>
          </div>`);
        cc.querySelector('.chart-panel:last-child .export-btn')
          ?.addEventListener('click', () => onExportPNG?.(def.id));

        const datasets = _buildTrajectoryDatasets(def, results, sys);
        _chartMeta[def.id] = { results, annotations: def.annotations, unitSystem: sys };
        const canvas = document.getElementById(def.id);
        charts[def.id] = new ChartCtor(canvas.getContext('2d'), buildChartConfig(def, datasets, results, { unitSystem: sys }));
        _attachTouchForwarder(canvas);
      });

      // MH-1: Elevation adjustment chart — dual y-axis (MOA left, MRAD right)
      cc.insertAdjacentHTML('beforeend', `
        <div class="chart-panel">
          <div class="chart-header">
            <div>
              <div class="chart-title">ELEVATION ADJUSTMENT</div>
              <div class="chart-subtitle">click-up (MOA / MRAD) vs range</div>
            </div>
            <button class="export-btn" data-chart-id="adjustChart">PNG</button>
          </div>
          <div class="chart-wrap"><canvas id="adjustChart"></canvas></div>
        </div>`);
      cc.querySelector('.chart-panel:last-child .export-btn')
        ?.addEventListener('click', () => onExportPNG?.('adjustChart'));

      const adjDatasets = _buildAdjustmentDatasets(results, sys);
      const adjAnns = [...sonicAnn];
      _chartMeta.adjustChart = { results, annotations: adjAnns, unitSystem: sys };
      const adjCanvas = document.getElementById('adjustChart');
      const adjDef = {
        id: 'adjustChart',
        annotations: adjAnns,
        scales: {
          x:     { type: 'linear', title: { display: true, text: `Range (${rUnit})`, color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { color: 'rgba(30,48,64,0.6)' }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
          yMoa:  { type: 'linear', position: 'left',  title: { display: true, text: 'MOA',  color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { color: 'rgba(30,48,64,0.6)' }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
          yMrad: { type: 'linear', position: 'right', title: { display: true, text: 'MRAD', color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { drawOnChartArea: false }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
        },
      };
      charts.adjustChart = new ChartCtor(adjCanvas.getContext('2d'), buildChartConfig(adjDef, adjDatasets, results, { unitSystem: sys }));
      _attachTouchForwarder(adjCanvas);

      _observeChartCanvases(TRAJECTORY_CHART_IDS);
    }
  }

  return results;
}

// ── State helpers (shared with sweep.js & tests) ──────────────────────────────

export function _getChartState() {
  return {
    charts,
    _chartMeta,
    crosshairIndex,
    crosshairPinned,
    _visibleChartIds,
    _dirtyCrosshairCharts,
  };
}

export function _setCharts(c) {
  charts = c;
}

export function _setChartEntry(id, chart, meta) {
  charts[id] = chart;
  _chartMeta[id] = meta;
}

export function _getChartMeta(id) {
  return _chartMeta[id];
}

export function _resetReadoutCache() {
  _readoutCache = null;
}

export function _resetChartState() {
  _cancelCrosshairRaf();
  _teardownChartObserver();
  _readoutCache = null;
  _activeUnitSystem = 'metric';
  charts = {};
  _chartMeta = {};
  crosshairIndex = null;
  crosshairPinned = false;
  _chartModPromise = null;
}
