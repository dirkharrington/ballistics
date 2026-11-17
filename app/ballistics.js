import { parseDragCsv } from './drag-csv.js';
import BULLET_CATALOG from 'virtual:bullet-catalog';
import { decodeState, mergeIntoSearch } from './url-state.js';
import { loadPresets, savePreset, deletePreset, renderPresetList } from './custom-rounds.js';
import { initDopeCard, renderDopeCard, initBcSolver } from './tools.js';
import { TrajectoryInputError } from './physics/errors.ts';
import { simulateAsync } from './physics/engine-async.ts';
import {
  loadCustomBullets, saveCustomBullets, mergeCatalog, isCustomBulletId,
  renderCustomBulletGroup, syncCustomDeleteGuards, upsertCustomBullet,
  removeCustomBullet, validateCustomBulletInput, bulletForDragModel,
  CUSTOM_BULLET_PALETTE,
} from './custom-bullets.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// Derived from bullets.yaml via virtual:bullet-catalog at build time
const BULLET_COLORS = Object.fromEntries(BULLET_CATALOG.map(b => [b.id, b.hexColor]));

// ── Colour helper ─────────────────────────────────────────────────────────────
/** Returns the display colour for any bullet (custom or built-in). */
export function colorFor(bullet) {
  return bullet.hexColor || BULLET_COLORS[bullet.id] || '#4ADE80';
}

// Five-step sweep color ramp (independent of bullet catalog colors)
const SWEEP_COLORS = ['#00d4ff', '#4ADE80', '#f59e0b', '#f472b6', '#a78bfa'];

// ── HTML escaping – used wherever user-supplied strings enter innerHTML ────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Scope-adjustment angles ───────────────────────────────────────────────────
// Computes the elevation correction a shooter must dial to bring the bullet back
// to the line of sight at the given range.
//   positive = click up  (bullet below LoS, drop < 0)
//   negative = click down (bullet above LoS, drop > 0)
//   zero     = at muzzle (range = 0) or when drop is exactly 0
function computeAdjustments(dropCm, rangeMeters) {
  if (rangeMeters === 0) return { moa: 0, mrad: 0 };
  const angleRad = Math.atan2(Math.abs(dropCm) / 100, rangeMeters);
  const sign = dropCm < 0 ? 1 : (dropCm > 0 ? -1 : 0);
  return {
    moa:  Math.round(sign * angleRad * (180 / Math.PI) * 60 * 10) / 10,
    mrad: Math.round(sign * angleRad * 1000 * 10) / 10,
  };
}

// ── CSV cell escaping – doubles internal quotes, prefixes formula triggers ─────
function csvCell(str) {
  const s = String(str).replace(/"/g, '""');
  // Prevent formula injection in spreadsheet apps (Excel, Google Sheets)
  return /^[=+\-@\t\r]/.test(s) ? `"'${s}"` : `"${s}"`;
}

// ── Module state ──────────────────────────────────────────────────────────────
const CUSTOM_DRAG_TABLE_KEY = 'ballistics.customDragTable';
let _customDragTable = null;

let bullets = [];
let selectedIds = new Set();
let lastResults = [];
let charts = {};

// Memoised chart.js import — resolved once, reused on every renderResults /
// renderSweepCharts call, so Chart.register() fires at most once per page load.
let _chartModPromise = null;
function _loadChart() {
  if (!_chartModPromise) {
    _chartModPromise = import('chart.js').then(mod => {
      mod.Chart.register(
        mod.LineController, mod.LineElement, mod.PointElement,
        mod.LinearScale, mod.CategoryScale, mod.Tooltip, mod.Legend,
      );
      return mod;
    });
  }
  return _chartModPromise;
}

// UX-1: Custom bullet catalog state
let customRecords       = [];    // CustomBulletRecordV1[] — mirror of storage
let customStorageStatus = 'ok';  // 'ok' | 'empty' | 'corrupt' | 'unavailable'
let editingCustomId     = null;  // string | null
let pendingDeleteId     = null;  // string | null
// Crosshair state (task 5)
let crosshairIndex  = null;  // data-point index currently under the cursor
let crosshairPinned = false; // true after user clicks a range to lock the readout
// Table sort state (FE-3)
let sortColumn    = null;   // string | null
let sortDirection = 'asc';  // 'asc' | 'desc'
let tableResults  = null;   // results last passed to renderTable
// Sweep state (MH-4)
let sweepMode    = false;
let sweepResults = null;
let lastReq      = null;

// ── Custom drag table helpers ─────────────────────────────────────────────────
function _updateDragTableStatus(fileName, rowCount) {
  const statusDiv = document.getElementById('dragTableStatus');
  const nameEl    = document.getElementById('dragTableName');
  const helpEl    = document.getElementById('dragTableHelp');
  /* istanbul ignore else -- #dragTableStatus is always present in the app shell */
  if (statusDiv) statusDiv.style.display = (fileName || _customDragTable) ? 'block' : 'none';
  /* istanbul ignore else -- #dragTableName is always present in the app shell */
  if (nameEl)    nameEl.textContent = fileName
    ? `${fileName} (${rowCount} rows)`
    : (_customDragTable ? `Loaded (${_customDragTable.length} rows)` : '');
  if (helpEl && !fileName) helpEl.textContent = 'Mach,CD columns. Stored for future use — drag model override requires server update.';
}

function _clearCustomDragTable() {
  _customDragTable = null;
  try { localStorage.removeItem(CUSTOM_DRAG_TABLE_KEY); } catch (_) {}
  const statusDiv  = document.getElementById('dragTableStatus');
  const fileInput  = document.getElementById('dragTableFile');
  const helpEl     = document.getElementById('dragTableHelp');
  /* istanbul ignore else -- #dragTableStatus is always present in the app shell */
  if (statusDiv)  statusDiv.style.display = 'none';
  /* istanbul ignore else -- #dragTableFile is always present in the app shell */
  if (fileInput)  fileInput.value = '';
  /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
  if (helpEl)     helpEl.textContent = 'Mach,CD columns. Stored for future use — drag model override requires server update.';
}

// ── Mock data (offline fallback) — sourced from bullets.yaml via virtual:bullet-catalog ──
function getMockBullets() {
  return BULLET_CATALOG;
}


// ── Compute trajectories client-side for all selected bullet IDs ──────────────
async function computeClientSide(req) {
  const promises = req.bulletIds.map(id => {
    const bullet = bullets.find(b => b.id === id);
    if (!bullet) return null;
    return simulateAsync(bulletForDragModel(bullet, req.dragModel), req);
  });
  const results = await Promise.all(promises.filter(Boolean));
  return results;
}

// ── Bullet list UI ────────────────────────────────────────────────────────────
function renderBulletList() {
  const list = document.getElementById('bulletList');
  const builtIns = bullets.filter(b => !isCustomBulletId(b.id));
  const customs  = bullets.filter(b =>  isCustomBulletId(b.id));

  list.innerHTML = builtIns.map(b => `
    <div class="bullet-card" id="card-${escapeHtml(b.id)}"
         style="--bullet-color:${colorFor(b)}">
      <div class="bullet-name">${escapeHtml(b.name)}</div>
      <div class="bullet-specs">
        BC: ${escapeHtml(String(b.ballisticCoefficient))} &nbsp;|&nbsp; MV: ${escapeHtml(String(b.muzzleVelocityMps))} m/s
      </div>
      <div class="check"></div>
    </div>
  `).join('');
  builtIns.forEach(b => {
    const card = document.getElementById('card-' + b.id);
    /* istanbul ignore else -- card is always present after innerHTML is set */
    if (card) card.addEventListener('click', () => toggleBullet(b.id));
  });

  // Append custom group (always rendered, even with 0 customs)
  renderCustomBulletGroup(list, customs, {
    selectedIds,
    storageStatus: customStorageStatus,
    onToggle: toggleBullet,
    onEdit:   openCustomBulletEdit,
    onDelete: requestCustomBulletDelete,
  });
  pendingDeleteId = null;

  syncSelectAllCheckbox();
}

function toggleBullet(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateBulletCards();
  savePrefs();
  syncUrl();
  updateSweepButtonVisibility();
}

function updateBulletCards() {
  bullets.forEach(b => {
    const card = document.getElementById('card-' + b.id);
    if (card) card.classList.toggle('active', selectedIds.has(b.id));
  });
  syncSelectAllCheckbox();
  syncRunButton();
  // UX-1: sync delete guards and reset any pending delete confirmation
  syncCustomDeleteGuards(document.getElementById('bulletList'), selectedIds);
  pendingDeleteId = null;
}

function syncSelectAllCheckbox() {
  const cb = document.getElementById('selectAllBullets');
  if (!cb) return;
  if (selectedIds.size === 0) {
    cb.checked = false;
    cb.indeterminate = false;
  } else if (selectedIds.size === bullets.length) {
    cb.checked = true;
    cb.indeterminate = false;
  } else {
    cb.indeterminate = true;
  }
}

function syncRunButton() {
  const btn = document.getElementById('runBtn');
  if (btn) btn.disabled = selectedIds.size === 0;
}

// ── Error handling helpers ────────────────────────────────────────────────────

/** Shows or hides the inline simulation error banner. */
function _setSimulationError(message) {
  const el = document.getElementById('simulationError');
  /* istanbul ignore next -- #simulationError is always present in the app shell */
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.removeAttribute('hidden');
  } else {
    el.setAttribute('hidden', '');
    el.textContent = '';
  }
}

// ── Simulation ────────────────────────────────────────────────────────────────
async function runSimulation() {
  if (selectedIds.size === 0) { return; }
  _setSimulationError(null);

  const latRaw = document.getElementById('latitudeDeg')?.value;
  const azRaw  = document.getElementById('azimuthDeg')?.value;
  if (latRaw && (+latRaw < -90 || +latRaw > 90)) { _setSimulationError('Latitude must be between −90 and 90.'); return; }
  if (azRaw  && (+azRaw  < 0  || +azRaw  > 360)) { _setSimulationError('Azimuth must be between 0 and 360.'); return; }

  const btn = document.getElementById('runBtn');
  btn.classList.add('loading');

  const twistRaw = document.getElementById('twistRate')?.value;
  const req = {
    bulletIds:                [...selectedIds],
    zeroRangeMeters:          +document.getElementById('zeroRange').value,
    maxRangeMeters:           +document.getElementById('maxRange').value,
    stepMeters:               +document.getElementById('step').value,
    windSpeedKph:             +document.getElementById('windSpeed').value,
    windDirectionDeg:         +document.getElementById('windDir').value,
    altitudeMeters:           +document.getElementById('altitude').value,
    temperatureC:             +document.getElementById('temperature').value,
    sightHeightMm:            +document.getElementById('sightHeight').value,
    shootingAngleDegrees:     +document.getElementById('shootingAngle').value,
    dragModel:                document.getElementById('dragModel').value,
    ...(twistRaw ? { twistRateInchesPerTurn: +twistRaw } : {}),
    ...(latRaw   ? { latitudeDeg: +latRaw } : {}),
    ...(azRaw    ? { azimuthDeg:  +azRaw  } : {}),
  };
  lastReq = req;

  try {
    const results = await computeClientSide(req);
    requestAnimationFrame(() => {
      renderResults(results, req);
      lastResults = results;
      updateSweepButtonVisibility();
      const exportBtn = document.getElementById('exportCsvBtn');
      /* istanbul ignore else -- #exportCsvBtn is always present in the app shell */
      if (exportBtn) exportBtn.style.display = '';
      btn.classList.remove('loading');
      btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
    });
  } catch (err) {
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
    if (err instanceof TrajectoryInputError) {
      _setSimulationError(err.message);
    } else {
      console.error(err);
    }
  }
}

// ── Export helpers ────────────────────────────────────────────────────────────
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Trajectory CSV export (UX-2) ─────────────────────────────────────────────
// Columns: Distance (m), Velocity (m/s), Energy (J), Drop (m), Bullet
// Supports compare mode — all selected bullets in one file, distinguished by
// the Bullet column.  Filename includes a millisecond timestamp so each
// download is unique.  Bullet names are RFC 4180-escaped via csvCell().
function exportTrajectoryCSV() {
  if (!lastResults.length) return;
  const rows = ['Distance (m),Velocity (m/s),Energy (J),Drop (m),Bullet'];
  lastResults.forEach(r => {
    r.points.forEach(p => {
      rows.push(`${p.rangeMeters},${p.velocityMps},${p.energyJoules},${p.dropCm / 100},${csvCell(r.bullet.name)}`);
    });
  });
  _downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), `trajectory-${Date.now()}.csv`);
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV() {
  if (!lastResults.length) return;
  const rows = ['Round,Range (m),Drop (cm),Velocity (m/s),Energy (J),Wind Drift (cm),Time (s),MOA,MRAD'];
  lastResults.forEach(r => {
    r.points.forEach(p => {
      const adj = computeAdjustments(p.dropCm, p.rangeMeters);
      rows.push(`${csvCell(r.bullet.name)},${p.rangeMeters},${p.dropCm},${p.velocityMps},${p.energyJoules},${p.windDriftCm},${p.timeOfFlightSec},${adj.moa},${adj.mrad}`);
    });
  });
  _downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), 'trajectory.csv');
}

// ── JSON export ───────────────────────────────────────────────────────────────
function exportJSON() {
  if (!lastResults.length) return;
  _downloadBlob(
    new Blob([JSON.stringify(lastResults, null, 2)], { type: 'application/json' }),
    'trajectory.json'
  );
}

// ── Markdown export ───────────────────────────────────────────────────────────
function exportMarkdown() {
  if (!lastResults.length) return;
  const lines = [];
  lastResults.forEach(r => {
    lines.push(`## ${escapeHtml(r.bullet.name)}\n`);
    lines.push('| Range (m) | Drop (cm) | Velocity (m/s) | Energy (J) | Wind Drift (cm) | MOA | MRAD |');
    lines.push('|----------:|----------:|---------------:|-----------:|----------------:|----:|-----:|');
    r.points.forEach(p => {
      const adj = computeAdjustments(p.dropCm, p.rangeMeters);
      lines.push(`| ${p.rangeMeters} | ${p.dropCm} | ${p.velocityMps} | ${p.energyJoules} | ${p.windDriftCm} | ${adj.moa} | ${adj.mrad} |`);
    });
    lines.push('');
  });
  _downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown' }), 'trajectory.md');
}

// ── PNG export ────────────────────────────────────────────────────────────────
function exportPNG(chartId) {
  const canvas = document.getElementById(chartId);
  if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = chartId + '.png';
  a.click();
}

// ── Custom round ──────────────────────────────────────────────────────────────
function showCustomError(msg) {
  const el = document.getElementById('customError');
  /* istanbul ignore next -- #customError is always present when this function is called */
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function runCustom() {
  const name   = document.getElementById('customName').value.trim() || 'Custom Load';
  const weight = +document.getElementById('customWeight').value;
  const mv     = +document.getElementById('customMV').value;
  const bc     = +document.getElementById('customBC').value;
  const dia    = +document.getElementById('customDia').value;

  const latRawC = document.getElementById('latitudeDeg')?.value;
  const azRawC  = document.getElementById('azimuthDeg')?.value;

  if (!(weight > 0))           return showCustomError('Weight must be greater than 0');
  if (!(mv > 0))               return showCustomError('Muzzle velocity must be greater than 0');
  if (!(bc > 0 && bc <= 1.2))  return showCustomError('BC must be between 0 and 1.2');
  if (!(dia > 0))              return showCustomError('Diameter must be greater than 0');
  if (latRawC && (+latRawC < -90 || +latRawC > 90)) return showCustomError('Latitude must be between −90 and 90');
  if (azRawC  && (+azRawC  < 0  || +azRawC  > 360)) return showCustomError('Azimuth must be between 0 and 360');
  showCustomError('');

  const req = {
    name:                  name,
    bulletWeightGrams:     weight,
    muzzleVelocityMps:     mv,
    ballisticCoefficient:  bc,
    bulletDiameterMm:      dia,
    zeroRangeMeters:       +document.getElementById('zeroRange').value,
    maxRangeMeters:        +document.getElementById('maxRange').value,
    stepMeters:            +document.getElementById('step').value,
    windSpeedKph:          +document.getElementById('windSpeed').value,
    windDirectionDeg:      +document.getElementById('windDir').value,
    altitudeMeters:        +document.getElementById('altitude').value,
    temperatureC:          +document.getElementById('temperature').value,
    sightHeightMm:         +document.getElementById('sightHeight').value,
    shootingAngleDegrees:  +document.getElementById('shootingAngle').value,
    dragModel:             document.getElementById('dragModel').value,
    ...(latRawC ? { latitudeDeg: +latRawC } : {}),
    ...(azRawC  ? { azimuthDeg:  +azRawC  } : {}),
    ...(_customDragTable ? { customDragTable: _customDragTable } : {}),
  };

  const bullet = {
    id: 'custom', name, caliber: 'Custom',
    bulletWeightGrams: weight, muzzleVelocityMps: mv,
    ballisticCoefficient: bc, bulletDiameterMm: dia,
    muzzleEnergyJoules: Math.round(0.5 * (weight / 1000) * mv * mv),
  };
  let result;
  try {
    result = await simulateAsync(bullet, req);
  } catch (err) {
    if (err instanceof TrajectoryInputError) {
      return showCustomError(err.message);
    }
    throw err;
  }
  lastResults = [result];
  renderResults([result], req);
}


function showToast(msg) {
  const el = document.getElementById('toast');
  /* istanbul ignore next -- #toast is always present in the app shell */
  if (!el) return;
  el.textContent = msg;
  el.classList.add('toast-visible');
  el.style.display = 'block';
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, 3000);
}

// ── Crosshair plugin — draws a vertical dashed line at the hovered data index ─
// ── Chart annotation helpers ──────────────────────────────────────────────────

/** Draw a vertical dashed annotation line with a text label. */
function drawVLine(ctx, xScale, chartArea, ann) {
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
function drawHLine(ctx, yScale, chartArea, ann) {
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
 * Build a Chart.js plugin that draws a set of dashed annotation lines after each render.
 *
 * @param {Array<{type:'vertical'|'horizontal', value:number, label:string, color:string}>} annotations
 * @returns {object} Chart.js plugin object
 */
function annotationPlugin(annotations) {
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
    }
  };
}

// ── Mobile sidebar drawer toggle ─────────────────────────────────────────────
function openSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  /* istanbul ignore else -- #sidebar is always present in the app shell */
  if (sidebar)  sidebar.classList.add('open');
  /* istanbul ignore else -- #sidebarBackdrop is always present in the app shell */
  if (backdrop) backdrop.classList.add('open');
}

function closeSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  /* istanbul ignore else -- #sidebar is always present in the app shell */
  if (sidebar)  sidebar.classList.remove('open');
  /* istanbul ignore else -- #sidebarBackdrop is always present in the app shell */
  if (backdrop) backdrop.classList.remove('open');
}

const crosshairPlugin = {
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
  }
};

// ── Range readout — populate the panel below the charts ──────────────────────
function updateReadout(results, dataIndex) {
  const panel = document.getElementById('rangeReadout');
  if (!panel) return;
  const first = results[0];
  if (!first?.points[dataIndex]) return;

  const range = first.points[dataIndex].rangeMeters;
  const rangeEl = document.getElementById('readoutRange');
  /* istanbul ignore else -- #readoutRange is always present in the app shell */
  if (rangeEl) rangeEl.textContent = `${range} m`;

  const tbody = document.getElementById('readoutBody');
  /* istanbul ignore else -- #readoutBody is always present in the app shell */
  if (tbody) {
    const sign = v => v > 0 ? '+' : '';
    tbody.innerHTML = results.map(r => {
      const p = r.points[dataIndex];
      if (!p) return '';
      const color = colorFor(r.bullet);
      return `<tr>
        <td><span class="bullet-dot" style="background:${color}"></span>${escapeHtml(r.bullet.name)}</td>
        <td>${sign(p.dropCm)}${p.dropCm} cm</td>
        <td>${p.velocityMps} m/s</td>
        <td>${p.energyJoules} J</td>
        <td>${sign(p.windDriftCm)}${p.windDriftCm} cm</td>
        ${p.spinDriftCm > 0 ? `<td>Spin Drift: ${p.spinDriftCm.toFixed(1)} cm</td>` : ''}
        ${p.coriolisDeflectionCm != null ? `<td>Coriolis: ${p.coriolisDeflectionCm >= 0 ? '+' : ''}${p.coriolisDeflectionCm.toFixed(1)} cm</td>` : ''}
      </tr>`;
    }).join('');
  }

  panel.style.display = 'block';
}

// ── Reset crosshair to initial (no hover, no pin) ────────────────────────────
function resetCrosshairState() {
  crosshairIndex  = null;
  crosshairPinned = false;
  const pinBtn = document.getElementById('readoutPin');
  /* istanbul ignore else -- #readoutPin is always present in the app shell */
  if (pinBtn) { pinBtn.textContent = 'PIN'; pinBtn.classList.remove('pinned'); }
  const readout = document.getElementById('rangeReadout');
  /* istanbul ignore else -- #rangeReadout is always present in the app shell */
  if (readout) readout.style.display = 'none';
}

// ── Render per-bullet stat cards into container ───────────────────────────────
function renderStatCards(results, container) {
  container.insertAdjacentHTML('beforeend', `
    <div class="stats-grid">
      ${results.map(r => {
        const color = colorFor(r.bullet);
        const daLine = r.densityAltitudeMeters !== undefined
          ? `<br><span style="color:var(--text)">${Number(r.densityAltitudeMeters)}</span> m density alt`
          : '';
        return `
        <div class="stat-card" style="--bullet-color:${color}">
          <div class="stat-label" style="color:${color}">${escapeHtml(r.bullet.name)}</div>
          <div class="stat-value">${Number(r.bullet.muzzleVelocityMps).toLocaleString()}</div>
          <div class="stat-unit">MV m/s &nbsp;·&nbsp; BC ${Number(r.bullet.ballisticCoefficient)} &nbsp;·&nbsp; ${Number(r.bullet.bulletWeightGrams)}g</div>
          <div style="margin-top:8px; font-family:'Share Tech Mono',monospace; font-size:9px; color:var(--text-dim); letter-spacing:1px; line-height:1.8">
            <span style="color:var(--text)">⚡ ${Number(r.bullet.muzzleEnergyJoules).toLocaleString()}</span> J muzzle energy<br>
            <span style="color:var(--text)">${Number(r.supersonicLimitMeters)}</span> m supersonic${daLine}<br>
            <span style="color:var(--text)">${Number(r.maxOrdinateCm)}</span> cm max ordinate @ ${Number(r.maxOrdinateRangeMeters)} m
          </div>
        </div>`;
      }).join('')}
    </div>`);
}

/**
 * Build a Chart.js config for one trajectory chart panel.
 *
 * @param {{ id: string, title: string, subtitle: string, yLabel: string,
 *           key: string, refLine?: { value: number, label: string, color: string } }} def
 *   Chart panel definition (id, axis labels, optional reference line).
 * @param {object[]} datasets  Pre-built Chart.js dataset array.
 * @param {object[]} results   Simulation results used by hover/click callbacks.
 * @returns {object} Chart.js config ready for `new Chart(ctx, config)`.
 */
function buildChartConfig(def, datasets, results) {
  const annotations = {};
  if (def.refLine) {
    annotations.refLine = {
      type: 'line', yMin: def.refLine.value, yMax: def.refLine.value,
      borderColor: def.refLine.color, borderWidth: 1, borderDash: [4, 4],
      label: {
        content: def.refLine.label, enabled: true, position: 'start',
        backgroundColor: 'transparent', color: def.refLine.color,
        font: { family: 'Share Tech Mono', size: 9 }
      }
    };
  }
  return {
    type: 'line',
    data: { datasets },
    plugins: [crosshairPlugin, annotationPlugin(def.annotations ?? [])],
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
          /* istanbul ignore else -- #rangeReadout is always present in the app shell */
          if (panel) panel.style.display = 'none';
        }
        // Sync crosshair across all other charts
        Object.values(charts).forEach(c => {
          if (c !== charts[def.id]) c.update('none');
        });
      },
      onClick: (event, elements) => {
        if (elements.length === 0) return;
        crosshairPinned = !crosshairPinned;
        const btn = document.getElementById('readoutPin');
        /* istanbul ignore else -- #readoutPin is always present in the app shell */
        if (btn) {
          btn.textContent = crosshairPinned ? 'UNPIN' : 'PIN';
          btn.classList.toggle('pinned', crosshairPinned);
        }
        if (crosshairPinned) {
          crosshairIndex = elements[0].index;
          updateReadout(results, crosshairIndex);
        } else {
          crosshairIndex = null;
          const panel = document.getElementById('rangeReadout');
          /* istanbul ignore else -- #rangeReadout is always present in the app shell */
          if (panel) panel.style.display = 'none';
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
        y: {
          title: { display: true, text: def.yLabel, color: '#3a5060',
                   font: { family: 'Share Tech Mono', size: 9 } },
          grid: { color: 'rgba(30,48,64,0.6)' },
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
  };
}

// ── Wind chart subtitle helper ────────────────────────────────────────────────
/** Human-readable wind subtitle showing speed and compass direction. */
function windChartSubtitle(req) {
  if (!req.windSpeedKph) return 'no wind';
  const dir = req.windDirectionDeg ?? 90;
  const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
  const label = dirs[Math.round(dir / 45) % 8];
  return `${req.windSpeedKph} km/h from ${label}`;
}

// ── Results rendering (~30-line orchestrator) ─────────────────────────────────
async function renderResults(rawResults, req) {
  const results = rawResults.filter(r => r?.bullet);
  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';
  const cc = document.getElementById('chartContainer');
  cc.innerHTML = '';
  // Update drag model status pill
  const modelEl = document.getElementById('modelStatus');
  /* istanbul ignore else -- #modelStatus is always present in the app shell */
  if (modelEl) modelEl.textContent = `MODEL: ${req.dragModel ?? 'G1'}`;

  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  resetCrosshairState();
  renderStatCards(results, cc);


  // Build annotation arrays from the first result (annotations are per-simulation)
  const first = results[0];
  const SONIC_COLOR = 'rgba(255,160,0,0.6)';
  const ORD_COLOR   = 'rgba(0,212,255,0.4)';
  const sonicAnn = first
    ? [{ type: 'vertical',   value: first.supersonicLimitMeters,  label: 'SUPERSONIC ←', color: SONIC_COLOR }]
    : [];
  const dropAnns = first
    ? [
        ...sonicAnn,
        { type: 'horizontal', value: first.maxOrdinateCm,           label: 'MAX ORD', color: ORD_COLOR },
        { type: 'vertical',   value: first.maxOrdinateRangeMeters,  label: 'PEAK',    color: ORD_COLOR },
      ]
    : [];

  const chartDefs = [
    { id: 'dropChart',     title: 'BULLET DROP',         subtitle: `zeroed at ${req.zeroRangeMeters} m`, yLabel: 'Drop (cm)',       key: 'dropCm',       annotations: dropAnns },
    { id: 'velocityChart', title: 'VELOCITY RETENTION',  subtitle: 'm/s downrange',                      yLabel: 'Velocity (m/s)', key: 'velocityMps',  annotations: sonicAnn,
      refLine: { value: 343, label: 'Transonic', color: 'rgba(255,100,0,0.4)' } },
    { id: 'energyChart',   title: 'KINETIC ENERGY',      subtitle: 'joules downrange',                   yLabel: 'Energy (J)',      key: 'energyJoules', annotations: sonicAnn },
    { id: 'windChart',     title: 'WIND DRIFT',           subtitle: windChartSubtitle(req), yLabel: 'Drift (cm)',     key: 'windDriftCm',  annotations: sonicAnn }
  ];

  const { Chart } = await _loadChart();

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
      ?.addEventListener('click', () => exportPNG(def.id));

    const datasets = results.map(r => ({
      label:            r.bullet.name,
      data:             r.points.map(p => ({ x: p.rangeMeters, y: p[def.key] })),
      borderColor:      colorFor(r.bullet),
      backgroundColor:  'transparent',
      borderWidth:      2,
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3
    }));

    // SH-1 FE: add spin drift as dashed series on the wind drift chart
    if (def.id === 'windChart') {
      const hasSpinDrift = results.some(r => r.points.some(p => p.spinDriftCm));
      if (hasSpinDrift) {
        results.forEach(r => {
          datasets.push({
            label:            r.bullet.name + ' (spin drift)',
            data:             r.points.map(p => ({ x: p.rangeMeters, y: p.spinDriftCm ?? 0 })),
            borderColor:      colorFor(r.bullet),
            backgroundColor:  'transparent',
            borderWidth:      1.5,
            borderDash:       [5, 5],
            pointRadius:      0,
            pointHoverRadius: 4,
            tension:          0.3,
          });
        });
      }
      // WA-13: add Coriolis drift series when present
      const hasCoriolisDrift = results.some(r => r.points.some(p => p.coriolisDeflectionCm));
      if (hasCoriolisDrift) {
        results.forEach(r => {
          datasets.push({
            label:            r.bullet.name + ' (coriolis)',
            data:             r.points.map(p => ({ x: p.rangeMeters, y: p.coriolisDeflectionCm ?? 0 })),
            borderColor:      colorFor(r.bullet),
            backgroundColor:  'transparent',
            borderWidth:      1.5,
            borderDash:       [2, 4],
            pointRadius:      0,
            pointHoverRadius: 4,
            tension:          0.3,
          });
        });
      }
    }

    const ctx = document.getElementById(def.id).getContext('2d');
    charts[def.id] = new Chart(ctx, buildChartConfig(def, datasets, results));

    // Item 4: forward touchmove as mousemove so the crosshair readout works
    // on both iOS (unreliable synthetic mouse events) and Android Chrome.
    // passive:false lets us call preventDefault() to suppress page scroll
    // while the user is scrubbing the chart.
    const canvas = document.getElementById(def.id);
    /* istanbul ignore else -- canvas is always present after chart creation */
    if (canvas) {
      canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        canvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: t.clientX, clientY: t.clientY,
          bubbles: true, cancelable: true,
        }));
      }, { passive: false });
    }
  });

  // MH-1: Elevation adjustment chart — dual y-axis (MOA left, MRAD right)
  {
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
      ?.addEventListener('click', () => exportPNG('adjustChart'));

    const moaDatasets = results.map(r => ({
      label:            r.bullet.name + ' MOA',
      data:             r.points.map(p => { const a = computeAdjustments(p.dropCm, p.rangeMeters); return { x: p.rangeMeters, y: a.moa }; }),
      borderColor:      colorFor(r.bullet),
      backgroundColor:  'transparent',
      borderWidth:      2,
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3,
      yAxisID:          'yMoa',
    }));
    const mradDatasets = results.map(r => ({
      label:            r.bullet.name + ' MRAD',
      data:             r.points.map(p => { const a = computeAdjustments(p.dropCm, p.rangeMeters); return { x: p.rangeMeters, y: a.mrad }; }),
      borderColor:      colorFor(r.bullet),
      backgroundColor:  'transparent',
      borderWidth:      1.5,
      borderDash:       [4, 4],
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3,
      yAxisID:          'yMrad',
    }));

    const adjCtx = document.getElementById('adjustChart').getContext('2d');
    charts['adjustChart'] = new Chart(adjCtx, {
      type: 'line',
      data: { datasets: [...moaDatasets, ...mradDatasets] },
      plugins: [crosshairPlugin, annotationPlugin(sonicAnn)],
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
            /* istanbul ignore else */
            if (panel) panel.style.display = 'none';
          }
          Object.values(charts).forEach(c => { if (c !== charts['adjustChart']) c.update('none'); });
        },
        onClick: (event, elements) => {
          if (elements.length === 0) return;
          crosshairPinned = !crosshairPinned;
          const btn = document.getElementById('readoutPin');
          /* istanbul ignore else */
          if (btn) { btn.textContent = crosshairPinned ? 'UNPIN' : 'PIN'; btn.classList.toggle('pinned', crosshairPinned); }
          if (crosshairPinned) { crosshairIndex = elements[0].index; updateReadout(results, crosshairIndex); }
          else { crosshairIndex = null; const panel = document.getElementById('rangeReadout'); /* istanbul ignore else */ if (panel) panel.style.display = 'none'; }
          Object.values(charts).forEach(c => c.update('none'));
        },
        scales: {
          x:     { type: 'linear', title: { display: true, text: 'Range (m)', color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { color: 'rgba(30,48,64,0.6)' }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
          yMoa:  { type: 'linear', position: 'left',  title: { display: true, text: 'MOA',  color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { color: 'rgba(30,48,64,0.6)' }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
          yMrad: { type: 'linear', position: 'right', title: { display: true, text: 'MRAD', color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { drawOnChartArea: false }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
        },
        plugins: {
          legend:  { labels: { color: '#c8dde8', font: { family: 'Rajdhani', size: 12, weight: '600' }, usePointStyle: true, pointStyleWidth: 12 } },
          tooltip: { backgroundColor: '#141d26', borderColor: '#1e3040', borderWidth: 1, titleFont: { family: 'Share Tech Mono', size: 10 }, bodyFont: { family: 'Share Tech Mono', size: 10 }, titleColor: '#00d4ff', bodyColor: '#c8dde8', padding: 10, displayColors: true },
        }
      }
    });

    const adjCanvas = document.getElementById('adjustChart');
    /* istanbul ignore else */
    if (adjCanvas) {
      adjCanvas.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        adjCanvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY, bubbles: true, cancelable: true }));
      }, { passive: false });
    }
  }

  sortColumn = null;
  sortDirection = 'asc';
  renderTable(results);
  renderDopeCard(results, req);
}

// ── Data table ────────────────────────────────────────────────────────────────
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

function renderTable(results) {
  tableResults = results;
  const tbody = document.getElementById('tableBody');

  const showCoriolis = results.some(r => r.points.some(p => p.coriolisDeflectionCm !== undefined && p.coriolisDeflectionCm !== 0));
  const coriolisHeader = document.getElementById('coriolisColHeader');
  /* istanbul ignore else -- #coriolisColHeader is always present in the app shell */
  if (coriolisHeader) coriolisHeader.style.display = showCoriolis ? '' : 'none';

  let rows = [];
  results.forEach(r => {
    r.points.forEach(p => {
      const adj = computeAdjustments(p.dropCm, p.rangeMeters);
      rows.push({ r, p, adj });
    });
  });

  if (sortColumn !== null) {
    const getValue = SORTABLE_COLUMNS[sortColumn];
    const dir = sortDirection === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const va = getValue(a.p, a.adj);
      const vb = getValue(b.p, b.adj);
      const aFin = Number.isFinite(va);
      const bFin = Number.isFinite(vb);
      if (!aFin && !bFin) return 0;
      if (!aFin) return 1;
      if (!bFin) return -1;
      return dir * (va - vb);
    });
  }

  const html = rows.map(({ r, p, adj }) => {
    const color = colorFor(r.bullet);
    return `
        <tr>
          <td><span class="bullet-tag" style="background:${color}"></span>${escapeHtml(r.bullet.name)}</td>
          <td>${p.rangeMeters}</td>
          <td>${p.dropCm > 0 ? '+' : ''}${p.dropCm} cm</td>
          <td>${p.velocityMps.toLocaleString()}</td>
          <td>${p.energyJoules.toLocaleString()}</td>
          <td>${p.windDriftCm > 0 ? '+' : ''}${p.windDriftCm} cm</td>
          <td>${p.timeOfFlightSec}s</td>
          <td>${adj.moa > 0 ? '+' : ''}${adj.moa}</td>
          <td>${adj.mrad > 0 ? '+' : ''}${adj.mrad}</td>
          ${showCoriolis ? `<td>${(p.coriolisDeflectionCm ?? 0) >= 0 ? '+' : ''}${(p.coriolisDeflectionCm ?? 0).toFixed(1)} cm</td>` : ''}
        </tr>`;
  });
  tbody.innerHTML = html.join('');
  updateSortIndicators();
}

function onSortHeaderClick(key) {
  if (tableResults === null || !(key in SORTABLE_COLUMNS)) return;
  if (sortColumn === key) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = key;
    sortDirection = 'asc';
  }
  renderTable(tableResults);
}

function updateSortIndicators() {
  document.querySelectorAll('#dataTable thead th[data-sort-key]').forEach(th => {
    const key = th.dataset.sortKey;
    const indicator = th.querySelector('.sort-indicator');
    if (key === sortColumn) {
      th.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending');
      /* istanbul ignore else -- sort-indicator is always present when data-sort-key is set */
      if (indicator) indicator.textContent = sortDirection === 'asc' ? '▲' : '▼';
    } else {
      th.removeAttribute('aria-sort');
      /* istanbul ignore else -- sort-indicator is always present when data-sort-key is set */
      if (indicator) indicator.textContent = '';
    }
  });
}

function _getSortState() {
  return { column: sortColumn, direction: sortDirection };
}

// ── Sweep mode (MH-4) ─────────────────────────────────────────────────────────
function updateSweepButtonVisibility() {
  const sweepControls = document.getElementById('sweepControls');
  if (sweepControls) sweepControls.style.display = selectedIds.size > 0 ? 'block' : 'none';
}

const SWEEP_RANGES = {
  wind:        [0, 10, 20, 30, 40],
  altitude:    [0, 500, 1000, 2000, 3000],
  temperature: [0, 10, 20, 30, 40],
};

function buildSweepRequests(baseReq, sweepParam, bulletId) {
  const values = SWEEP_RANGES[sweepParam] ?? SWEEP_RANGES.wind;
  return values.map(v => {
    const r = { ...baseReq, bulletIds: [bulletId] };
    if (sweepParam === 'wind')        r.windSpeedKph    = v;
    if (sweepParam === 'altitude')    r.altitudeMeters  = v;
    if (sweepParam === 'temperature') r.temperatureC    = v;
    return r;
  });
}

async function runSweep() {
  if (selectedIds.size === 0) return;
  const bulletId   = [...selectedIds][0];
  const sweepParam = document.getElementById('sweepParam')?.value ?? 'wind';
  const btn        = document.getElementById('sweepBtn');
  if (btn) btn.querySelector('span').textContent = '⏳ SWEEPING...';

  const base = lastReq ?? {
    bulletIds:            [bulletId],
    zeroRangeMeters:      +document.getElementById('zeroRange').value,
    maxRangeMeters:       +document.getElementById('maxRange').value,
    stepMeters:           +document.getElementById('step').value,
    windSpeedKph:         +document.getElementById('windSpeed').value,
    windDirectionDeg:     +document.getElementById('windDir').value,
    altitudeMeters:       +document.getElementById('altitude').value,
    temperatureC:         +document.getElementById('temperature').value,
    sightHeightMm:        +document.getElementById('sightHeight').value,
    shootingAngleDegrees: +document.getElementById('shootingAngle').value,
    dragModel:            document.getElementById('dragModel').value,
  };

  const requests = buildSweepRequests(base, sweepParam, bulletId);
  const bullet   = bullets.find(b => b.id === bulletId);

  if (!bullet) { if (btn) btn.querySelector('span').textContent = 'SWEEP'; return; }

  let results;
  try {
    results = await Promise.all(requests.map(r => simulateAsync(bulletForDragModel(bullet, r.dragModel), r)));
  } catch (err) {
    if (btn) btn.querySelector('span').textContent = 'SWEEP';
    /* istanbul ignore else -- simulate only throws TrajectoryInputError */
    if (err instanceof TrajectoryInputError) console.warn('[sweep]', err.message);
    return;
  }

  sweepResults = results;
  sweepMode    = true;
  renderSweepCharts(results, sweepParam);

  if (btn) btn.querySelector('span').textContent = 'SWEEP';
  const clearBtn = document.getElementById('clearSweepBtn');
  if (clearBtn) clearBtn.style.display = 'block';
}

async function clearSweep() {
  sweepMode    = false;
  sweepResults = null;
  const clearBtn = document.getElementById('clearSweepBtn');
  if (clearBtn) clearBtn.style.display = 'none';
  /* istanbul ignore else -- only callable after a simulation has run */
  if (lastResults.length) await renderResults(lastResults, lastReq ?? {});
}

async function renderSweepCharts(sweepResultsList, sweepParam) {
  const values = SWEEP_RANGES[sweepParam] ?? SWEEP_RANGES.wind;
  const labels = { wind: 'km/h', altitude: 'm alt', temperature: '°C' };
  const unit   = labels[sweepParam] ?? '';

  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';
  const cc = document.getElementById('chartContainer');
  cc.innerHTML = '';

  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  const sweepDefs = [
    { id: 'sweepDropChart', title: 'SWEEP — BULLET DROP', yLabel: 'Drop (cm)',      key: 'dropCm'      },
    { id: 'sweepWindChart', title: 'SWEEP — WIND DRIFT',  yLabel: 'Drift (cm)',     key: 'windDriftCm' },
    { id: 'sweepVelChart',  title: 'SWEEP — VELOCITY',    yLabel: 'Velocity (m/s)', key: 'velocityMps' },
  ];

  const { Chart } = await _loadChart();

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
    panel.querySelector('.chart-subtitle').textContent = `${sweepParam} sweep (${values.join(', ')} ${unit})`;
    panel.querySelector('.export-btn')
      ?.addEventListener('click', () => exportPNG(def.id));

    const datasets = sweepResultsList.map((r, i) => ({
      label:            `${values[i]} ${unit}`,
      data:             r.points.map(p => ({ x: p.rangeMeters, y: p[def.key] })),
      borderColor:      SWEEP_COLORS[i % SWEEP_COLORS.length],
      backgroundColor:  'transparent',
      borderWidth:      2,
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3,
    }));

    const ctx = document.getElementById(def.id).getContext('2d');
    charts[def.id] = new Chart(ctx, buildChartConfig(def, datasets, sweepResultsList));
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('chartsPanel').classList.toggle('active', name === 'charts');
  document.getElementById('dataPanel').classList.toggle('active', name === 'data');
  document.getElementById('toolsPanel')?.classList.toggle('active', name === 'tools');
}

// ── URL state sharing ─────────────────────────────────────────────────────────
/** Snapshot of the sidebar: reads the 10 required inputs + optional lat/az, and [...selectedIds]. */
function currentState() {
  const get = id => document.getElementById(id);
  const latVal = get('latitudeDeg')?.value;
  const azVal  = get('azimuthDeg')?.value;
  /* istanbul ignore next -- each element is always present in the app shell */
  return {
    bulletIds:   [...selectedIds],
    zero:        +(get('zeroRange')?.value     ?? PREF_DEFAULTS.zero),
    maxRange:    +(get('maxRange')?.value      ?? PREF_DEFAULTS.maxRange),
    wind:        +(get('windSpeed')?.value     ?? PREF_DEFAULTS.wind),
    windDir:     +(get('windDir')?.value       ?? PREF_DEFAULTS.windDir),
    altitude:    +(get('altitude')?.value      ?? PREF_DEFAULTS.altitude),
    temp:        +(get('temperature')?.value   ?? PREF_DEFAULTS.temp),
    step:        +(get('step')?.value          ?? PREF_DEFAULTS.step),
    sightHeight: +(get('sightHeight')?.value   ?? PREF_DEFAULTS.sightHeight),
    angle:       +(get('shootingAngle')?.value ?? PREF_DEFAULTS.angle),
    dragModel:     get('dragModel')?.value     ?? PREF_DEFAULTS.dragModel,
    ...(latVal !== undefined && latVal !== '' ? { latitudeDeg: +latVal } : {}),
    ...(azVal  !== undefined && azVal  !== '' ? { azimuthDeg:  +azVal  } : {}),
  };
}

/** Update the address bar via replaceState. Never pushState. */
function syncUrl() {
  const qs = mergeIntoSearch(location.search, currentState());
  /* istanbul ignore next -- qs is always non-empty (encodeState always emits 10 keys) */
  const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
  history.replaceState(history.state, '', url);
}

/** Click handler for #copyLinkBtn. Returns the promise for tests. */
async function copyLink() {
  syncUrl();
  const url = location.origin + location.pathname + '?' + mergeIntoSearch(location.search, currentState());
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      showToast('Link copied');
    } else {
      showToast("Couldn't copy. Use the link in the address bar.");
    }
  } catch {
    showToast("Couldn't copy. Use the link in the address bar.");
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
let _initListenerController = null;

function init() {
  if (_initListenerController) _initListenerController.abort();
  _initListenerController = new AbortController();
  const { signal } = _initListenerController;
  // Service Worker registration (requires HTTPS or localhost; see sw.js)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(
      import.meta.env.BASE_URL + 'sw.js',
      { type: 'module', scope: import.meta.env.BASE_URL }
    )
      .catch(err => console.warn('SW registration failed:', err));
  }

  // Load saved preferences and URL params; URL takes per-key precedence over localStorage
  const fromUrl = decodeState(window.location.search);
  const merged  = { ...loadPrefs(), ...fromUrl.params };
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('zeroRange',     merged.zero);
  setVal('maxRange',      merged.maxRange);
  setVal('windSpeed',     merged.wind);
  setVal('windDir',       merged.windDir);
  setVal('altitude',      merged.altitude);
  setVal('temperature',   merged.temp);
  setVal('step',          merged.step);
  setVal('sightHeight',   merged.sightHeight);
  setVal('shootingAngle', merged.angle);
  setVal('dragModel',     merged.dragModel);
  if (fromUrl.params.latitudeDeg != null) setVal('latitudeDeg', fromUrl.params.latitudeDeg);
  if (fromUrl.params.azimuthDeg  != null) setVal('azimuthDeg',  fromUrl.params.azimuthDeg);

  // UX-1: Load and merge custom bullets
  {
    const { records, status } = loadCustomBullets();
    customRecords       = records;
    customStorageStatus = status;
    if (status === 'corrupt') {
      console.warn('Custom bullets: stored data was invalid and has been ignored');
    }
  }
  bullets = mergeCatalog(getMockBullets(), customRecords);
  renderBulletList();

  // Update custom form panel availability
  _syncCustomPanelAvailability();

  // Restore bullet selection: URL params take precedence over saved prefs
  {
    const validIds = new Set(bullets.map(b => b.id));
    let usedUrlBullets = false;
    if (fromUrl.bulletIds !== null) {
      const filtered = fromUrl.bulletIds.filter(id => validIds.has(id));
      if (filtered.length > 0) {
        selectedIds = new Set(filtered);
        usedUrlBullets = true;
      }
    }
    if (!usedUrlBullets) {
      if (merged.selectedIds !== null) {
        selectedIds = new Set(merged.selectedIds.filter(id => validIds.has(id)));
      } else {
        // First visit: select only built-in bullets[0] (not custom)
        const firstBuiltIn = getMockBullets()[0];
        /* istanbul ignore next -- getMockBullets() always returns ≥1 bullet in tests */
        if (firstBuiltIn) selectedIds.add(firstBuiltIn.id);
      }
    }
  }
  updateBulletCards();
  syncRunButton();

  // Persist parameter changes automatically and sync URL
  const paramInputIds = ['zeroRange','maxRange','windSpeed','windDir','altitude','temperature','step','sightHeight','shootingAngle','dragModel'];
  paramInputIds.forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => { savePrefs(); syncUrl(); });
  });

  // Wire up static event listeners (replaces window.* globals and onclick attrs)
  document.getElementById('runBtn')?.addEventListener('click', () => { closeSidebar(); runSimulation(); });

  // UX-3: Select-all / deselect-all checkbox
  document.getElementById('selectAllBullets')?.addEventListener('change', e => {
    if (e.target.checked) {
      bullets.forEach(b => selectedIds.add(b.id));
    } else {
      selectedIds.clear();
    }
    updateBulletCards();
    savePrefs();
    syncUrl();
    updateSweepButtonVisibility();
  });
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportTrajectoryCSV);
  document.querySelector('.export-csv-btn')?.addEventListener('click', exportCSV);
  document.querySelector('.export-json-btn')?.addEventListener('click', exportJSON);
  document.querySelector('.export-md-btn')?.addEventListener('click', exportMarkdown);
  document.querySelector('.export-toggle')?.addEventListener('click', function() {
    this.closest('.export-dropdown')?.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.export-dropdown')) {
      document.querySelectorAll('.export-dropdown.open')
        .forEach(d => d.classList.remove('open'));
    }
  });
  document.getElementById('runCustomBtn')?.addEventListener('click', () => { closeSidebar(); runCustom(); });
  document.getElementById('copyLinkBtn')?.addEventListener('click', copyLink);

  const handlers = {
    onLoad(p) {
      document.getElementById('customName').value   = p.name;
      document.getElementById('customWeight').value = p.weightG;
      document.getElementById('customMV').value     = p.mvMps;
      document.getElementById('customBC').value     = p.bc;
      document.getElementById('customDia').value    = p.diaMm;
      showCustomError('');
    },
    onDelete(id) {
      renderPresetList(deletePreset(id), handlers);
    },
  };
  document.getElementById('savePresetBtn')?.addEventListener('click', () => {
    const name    = document.getElementById('customName').value;
    const weightG = +document.getElementById('customWeight').value;
    const mvMps   = +document.getElementById('customMV').value;
    const bc      = +document.getElementById('customBC').value;
    const diaMm   = +document.getElementById('customDia').value;
    const result  = savePreset({ name, weightG, mvMps, bc, diaMm });
    if (result.ok) {
      showCustomError('');
      renderPresetList(result.presets, handlers);
      showToast(result.replaced ? 'Preset updated' : 'Preset saved');
    } else if (result.error === 'full') {
      showToast('Preset library full (20). Delete one to save another.');
    } else if (result.error === 'invalid') {
      showCustomError(result.message);
    } else {
      showToast("Couldn't save preset: browser storage unavailable");
    }
  });
  renderPresetList(loadPresets(), handlers);

  document.querySelector('#dataTable thead')?.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort-key]');
    if (th) onSortHeaderClick(th.dataset.sortKey);
  });

  // Mobile drawer: FAB opens sidebar; backdrop tap closes it
  document.getElementById('paramsToggle')?.addEventListener('click', openSidebar);
  document.getElementById('sidebarBackdrop')?.addEventListener('click', closeSidebar);
  document.getElementById('tab-charts')?.addEventListener('click', function() { switchTab('charts', this); });
  document.getElementById('tab-data')?.addEventListener('click', function() { switchTab('data', this); });
  document.getElementById('tab-tools')?.addEventListener('click', function() { switchTab('tools', this); });

  // Normalize address bar if URL had recognized params
  if (fromUrl.recognized) syncUrl();

  // MH-4: Sweep controls
  updateSweepButtonVisibility();
  document.getElementById('sweepBtn')?.addEventListener('click', runSweep);
  document.getElementById('clearSweepBtn')?.addEventListener('click', clearSweep);

  // SH-1 FE: twist rate input persists to URL/prefs
  document.getElementById('twistRate')?.addEventListener('input', syncUrl);

  // WA-13: Coriolis inputs persist to URL
  document.getElementById('latitudeDeg')?.addEventListener('input', syncUrl, { signal });
  document.getElementById('azimuthDeg')?.addEventListener('input', syncUrl, { signal });

  // MH-3, SH-2: Tools tab
  initDopeCard(simulateAsync);
  initBcSolver(simulateAsync);

  // WA-12: Load custom drag table from localStorage on startup
  try {
    const stored = localStorage.getItem(CUSTOM_DRAG_TABLE_KEY);
    if (stored) {
      const arr = JSON.parse(stored);
      if (!Array.isArray(arr) || arr.length < 3 || arr.length > 100) throw new Error('invalid');
      for (const p of arr) {
        if (!Number.isFinite(p.mach) || p.mach < 0 || p.mach > 5) throw new Error('invalid');
        if (!Number.isFinite(p.cd)   || p.cd   < 0.001 || p.cd > 2) throw new Error('invalid');
      }
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].mach <= arr[i - 1].mach) throw new Error('invalid');
      }
      if (!arr.some(p => p.mach <= 0.5))  throw new Error('invalid');
      if (!arr.some(p => p.mach >= 2.0))  throw new Error('invalid');
      _customDragTable = arr.map(p => ({ mach: p.mach, cd: p.cd }));
      _updateDragTableStatus();
    }
  } catch (_) {
    _customDragTable = null;
    try { localStorage.removeItem(CUSTOM_DRAG_TABLE_KEY); } catch (_2) {}
  }

  // WA-12: Wire file input for custom drag table
  document.getElementById('dragTableFile')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const helpEl = document.getElementById('dragTableHelp');
    if (file.size > 64 * 1024) {
      /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
      if (helpEl) helpEl.textContent = 'File too large (max 64 KB).';
      return;
    }
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const table = parseDragCsv(evt.target.result);
        _customDragTable = table;
        try { localStorage.setItem(CUSTOM_DRAG_TABLE_KEY, JSON.stringify(table)); } catch (_) {}
        _updateDragTableStatus(file.name, table.length);
        /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
        if (helpEl) helpEl.textContent = 'Loaded — requires server update to apply; results currently use the selected drag model.';
      } catch (err) {
        _customDragTable = null;
        try { localStorage.removeItem(CUSTOM_DRAG_TABLE_KEY); } catch (_) {}
        /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
        if (helpEl) helpEl.textContent = err.message;
      }
    };
    reader.onerror = () => {
      /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
      if (helpEl) helpEl.textContent = 'Error reading file.';
    };
    reader.readAsText(file);
  }, { signal });

  // WA-12: Wire clear button
  document.getElementById('dragTableClearBtn')?.addEventListener('click', _clearCustomDragTable, { signal });

  // UX-1: Wire custom bullet form
  document.getElementById('addCustomBulletBtn')?.addEventListener('click', openCustomBulletAdd, { signal });
  document.getElementById('customBulletCancelBtn')?.addEventListener('click', closeCustomBulletForm, { signal });
  document.getElementById('customBulletForm')?.addEventListener('submit', e => {
    e.preventDefault();
    _handleCustomBulletSubmit();
  }, { signal });

  // Pin button toggles crosshair lock (chart onClick also toggles)
  document.getElementById('readoutPin')?.addEventListener('click', () => {
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
      Object.values(charts).forEach(c => c.update('none'));
    }
  });
}

// ── localStorage preference persistence ──────────────────────────────────────

/** Keys used in localStorage (all prefixed `bv_`). */
const PREF_KEYS = {
  selectedIds: 'bv_selectedIds',
  zero:        'bv_zero',
  maxRange:    'bv_maxRange',
  wind:        'bv_wind',
  windDir:     'bv_windDir',
  altitude:    'bv_altitude',
  temp:        'bv_temp',
  step:        'bv_step',
  sightHeight: 'bv_sightHeight',
  angle:       'bv_angle',
  dragModel:   'bv_dragModel',
};

/** Default values when a key is absent from storage. */
const PREF_DEFAULTS = {
  selectedIds: null,   // null = first visit → select all bullets
  zero:        100,
  maxRange:    1000,
  wind:        16,
  windDir:     90,     // 90° = from East = pure right crosswind (full-value, legacy behaviour)
  altitude:    0,
  temp:        15,
  step:        25,
  sightHeight: 38.1,
  angle:       0,
  dragModel:   'G1',  // G1 = standard flat-base/spitzer; G7 = boat-tail long-range
};

/** Maps PREF_DEFAULTS keys to their DOM input element IDs (selectedIds has no input). */
const DOM_ID_FOR_PREF = {
  zero:        'zeroRange',
  maxRange:    'maxRange',
  wind:        'windSpeed',
  windDir:     'windDir',
  altitude:    'altitude',
  temp:        'temperature',
  step:        'step',
  sightHeight: 'sightHeight',
  angle:       'shootingAngle',
  dragModel:   'dragModel',
};

/**
 * Persist current parameter inputs and selected bullet IDs to localStorage.
 * Wrapped in try/catch: silently degrades in private-browsing or when quota is full.
 */
function savePrefs() {
  try {
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify([...selectedIds]));
    for (const k of Object.keys(PREF_DEFAULTS).filter(k => k !== 'selectedIds')) {
      const domId = DOM_ID_FOR_PREF[k];
      /* istanbul ignore next -- null branch only reached when a pref has no DOM element */
      const value = (domId ? document.getElementById(domId)?.value : null)
                    ?? String(PREF_DEFAULTS[k]);
      localStorage.setItem(PREF_KEYS[k], value);
    }
  } catch (e) {
    console.warn('localStorage unavailable — preferences not saved', e);
  }
}

/**
 * Read persisted preferences from localStorage and return a typed object.
 * Returns defaults for any missing or unparseable entries.
 * Wrapped in try/catch: returns all defaults if storage is unavailable.
 */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEYS.selectedIds);
    let savedIds;
    try {
      savedIds = raw !== null ? JSON.parse(raw) : null;
      if (!Array.isArray(savedIds)) savedIds = null;
    } catch (_) { savedIds = null; }

    const prefs = { selectedIds: savedIds };
    for (const k of Object.keys(PREF_DEFAULTS).filter(k => k !== 'selectedIds')) {
      const stored = localStorage.getItem(PREF_KEYS[k]);
      prefs[k] = typeof PREF_DEFAULTS[k] === 'number'
        ? +(stored ?? PREF_DEFAULTS[k])
        : (stored ?? PREF_DEFAULTS[k]);
    }
    return prefs;
  } catch (e) {
    console.warn('localStorage unavailable — using defaults', e);
    return { ...PREF_DEFAULTS };
  }
}

// ── Custom bullet panel availability sync ─────────────────────────────────────
function _syncCustomPanelAvailability() {
  const addBtn = document.getElementById('addCustomBulletBtn');
  /* istanbul ignore else -- #addCustomBulletBtn is always present in the app shell */
  if (addBtn) addBtn.disabled = customStorageStatus === 'unavailable';
}

// ── Custom bullet form handlers ───────────────────────────────────────────────

/** Open form in add mode. */
export function openCustomBulletAdd() {
  pendingDeleteId = null;
  editingCustomId = null;
  const form = document.getElementById('customBulletForm');
  const title = document.getElementById('customBulletFormTitle');
  /* istanbul ignore else -- #customBulletForm is always present in the app shell */
  if (form) {
    form.removeAttribute('hidden');
    // Reset fields
    ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7',
     'cbBulletDiameterInches','cbMuzzleVelocityFps'].forEach(id => {
      const el = document.getElementById(id);
      /* istanbul ignore else -- field inputs are always present in the app shell */
      if (el) { el.value = ''; el.removeAttribute('aria-invalid'); }
    });
    // Clear errors
    ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7',
     'cbBulletDiameterInches','cbMuzzleVelocityFps'].forEach(id => {
      const errEl = document.getElementById(id + '-error');
      /* istanbul ignore else -- error elements are always present in the app shell */
      if (errEl) errEl.textContent = '';
    });
    const formErr = document.getElementById('customBulletFormError');
    /* istanbul ignore else -- #customBulletFormError is always present in the app shell */
    if (formErr) formErr.textContent = '';
  }
  /* istanbul ignore else -- #customBulletFormTitle is always present in the app shell */
  if (title) title.textContent = 'Add custom bullet';
  const addBtn = document.getElementById('addCustomBulletBtn');
  /* istanbul ignore else -- #addCustomBulletBtn is always present in the app shell */
  if (addBtn) addBtn.setAttribute('aria-expanded', 'true');
  document.getElementById('cbName')?.focus();
}

/** Open form in edit mode, pre-populated from the record. */
export function openCustomBulletEdit(id) {
  const record = customRecords.find(r => r.id === id);
  if (!record) return;
  pendingDeleteId = null;
  editingCustomId = id;
  const form  = document.getElementById('customBulletForm');
  const title = document.getElementById('customBulletFormTitle');
  /* istanbul ignore else -- #customBulletForm is always present in the app shell */
  if (form) {
    form.removeAttribute('hidden');
    const set = (fieldId, val) => {
      const el = document.getElementById(fieldId);
      /* istanbul ignore else -- field inputs are always present in the app shell */
      if (el) { el.value = val; el.removeAttribute('aria-invalid'); }
    };
    set('cbName',                 record.name);
    set('cbShortName',            record.shortName);
    set('cbBulletWeightGrains',   String(record.bulletWeightGrains));
    set('cbBcG1',                 String(record.ballisticCoefficientG1));
    set('cbBcG7',                 record.ballisticCoefficientG7 != null ? String(record.ballisticCoefficientG7) : '');
    set('cbBulletDiameterInches', String(record.bulletDiameterInches));
    set('cbMuzzleVelocityFps',    String(record.muzzleVelocityFps));
    // Clear errors
    ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7',
     'cbBulletDiameterInches','cbMuzzleVelocityFps'].forEach(fid => {
      const errEl = document.getElementById(fid + '-error');
      /* istanbul ignore else -- error elements are always present in the app shell */
      if (errEl) errEl.textContent = '';
    });
    const formErr = document.getElementById('customBulletFormError');
    /* istanbul ignore else -- #customBulletFormError is always present in the app shell */
    if (formErr) formErr.textContent = '';
  }
  /* istanbul ignore else -- #customBulletFormTitle is always present in the app shell */
  if (title) title.textContent = 'Edit custom bullet';
  const addBtn = document.getElementById('addCustomBulletBtn');
  /* istanbul ignore else -- #addCustomBulletBtn is always present in the app shell */
  if (addBtn) addBtn.setAttribute('aria-expanded', 'true');
  document.getElementById('cbName')?.focus();
}

/** Close the custom bullet form and reset state. */
export function closeCustomBulletForm() {
  editingCustomId = null;
  const form   = document.getElementById('customBulletForm');
  const addBtn = document.getElementById('addCustomBulletBtn');
  /* istanbul ignore else -- #customBulletForm is always present in the app shell */
  if (form)   form.setAttribute('hidden', '');
  /* istanbul ignore else -- #addCustomBulletBtn is always present in the app shell */
  if (addBtn) {
    addBtn.setAttribute('aria-expanded', 'false');
    addBtn.focus();
  }
  // Clear fields and errors
  ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7',
   'cbBulletDiameterInches','cbMuzzleVelocityFps'].forEach(id => {
    const el = document.getElementById(id);
    /* istanbul ignore else -- field inputs are always present in the app shell */
    if (el) { el.value = ''; el.removeAttribute('aria-invalid'); }
    const errEl = document.getElementById(id + '-error');
    /* istanbul ignore else -- error elements are always present in the app shell */
    if (errEl) errEl.textContent = '';
  });
  const formErr = document.getElementById('customBulletFormError');
  /* istanbul ignore else -- #customBulletFormError is always present in the app shell */
  if (formErr) formErr.textContent = '';
}

/** Handle delete requests on a custom bullet. */
export function requestCustomBulletDelete(id) {
  if (selectedIds.has(id)) {
    showToast('Deselect this bullet before deleting it.');
    return;
  }

  if (pendingDeleteId !== id) {
    // First click: enter pending-delete state
    pendingDeleteId = id;
    const listEl = document.getElementById('bulletList');
    /* istanbul ignore else -- #bulletList is always present in the app shell */
    if (listEl) {
      const card = document.getElementById('card-' + id);
      /* istanbul ignore else -- card is always present when the custom bullet exists */
      if (card) {
        const delBtn = card.querySelector('.bullet-delete-btn');
        /* istanbul ignore else -- .bullet-delete-btn is always present on custom cards */
        if (delBtn) {
          delBtn.classList.add('confirming');
          delBtn.textContent = 'Confirm';
          /* istanbul ignore next -- .bullet-name absent path is unreachable in app */
          const name = card.querySelector('.bullet-name')?.textContent ?? '';
          delBtn.setAttribute('aria-label', 'Confirm delete ' + name);
        }
      }
    }
    return;
  }

  // Second click on the same id: perform delete
  const next   = removeCustomBullet(customRecords, id);
  const result = saveCustomBullets(next);
  if (!result.ok) {
    showToast("Couldn't delete: browser storage unavailable.");
    return;
  }

  customRecords  = next;
  bullets        = mergeCatalog(getMockBullets(), customRecords);
  pendingDeleteId = null;

  // Close form if editing this bullet
  if (editingCustomId === id) closeCustomBulletForm();

  renderBulletList();
  updateBulletCards();
  showToast('Custom bullet deleted');
}

/** Handle form submit. */
function _handleCustomBulletSubmit() {
  const getVal = id => /* istanbul ignore next */ document.getElementById(id)?.value ?? '';
  const raw = {
    name:                   getVal('cbName'),
    shortName:              getVal('cbShortName'),
    bulletWeightGrains:     getVal('cbBulletWeightGrains'),
    ballisticCoefficientG1: getVal('cbBcG1'),
    ballisticCoefficientG7: getVal('cbBcG7'),
    bulletDiameterInches:   getVal('cbBulletDiameterInches'),
    muzzleVelocityFps:      getVal('cbMuzzleVelocityFps'),
  };

  const result = validateCustomBulletInput(raw, {
    records:      customRecords,
    builtInNames: getMockBullets().map(b => b.name),
    editingId:    editingCustomId,
  });

  // Show field-level errors
  const fieldOrder = ['name','shortName','bulletWeightGrains','ballisticCoefficientG1',
                      'ballisticCoefficientG7','bulletDiameterInches','muzzleVelocityFps'];
  const inputIdMap = {
    name:                   'cbName',
    shortName:              'cbShortName',
    bulletWeightGrains:     'cbBulletWeightGrains',
    ballisticCoefficientG1: 'cbBcG1',
    ballisticCoefficientG7: 'cbBcG7',
    bulletDiameterInches:   'cbBulletDiameterInches',
    muzzleVelocityFps:      'cbMuzzleVelocityFps',
  };

  if (!result.ok) {
    // Clear all field errors first
    Object.values(inputIdMap).forEach(inputId => {
      const el = document.getElementById(inputId);
      /* istanbul ignore else -- field inputs are always present in the app shell */
      if (el) el.removeAttribute('aria-invalid');
      const errEl = document.getElementById(inputId + '-error');
      /* istanbul ignore else -- error elements are always present in the app shell */
      if (errEl) errEl.textContent = '';
    });
    const formErrEl = document.getElementById('customBulletFormError');
    /* istanbul ignore else -- #customBulletFormError is always present in the app shell */
    if (formErrEl) formErrEl.textContent = '';

    let firstFieldId = null;
    result.errors.forEach(({ field, message }) => {
      if (field === 'form') {
        const formErrEl2 = document.getElementById('customBulletFormError');
        /* istanbul ignore else -- #customBulletFormError is always present in the app shell */
        if (formErrEl2) formErrEl2.textContent = message;
        return;
      }
      const inputId = inputIdMap[field];
      /* istanbul ignore else -- field names always map to known input ids */
      if (inputId) {
        const el = document.getElementById(inputId);
        /* istanbul ignore else -- field inputs are always present in the app shell */
        if (el) el.setAttribute('aria-invalid', 'true');
        const errEl = document.getElementById(inputId + '-error');
        /* istanbul ignore else -- error elements are always present in the app shell */
        if (errEl) errEl.textContent = message;
        /* istanbul ignore else -- subsequent errors after firstFieldId is set skip this block */
        if (!firstFieldId) {
          // Find first in field order
          const idx = fieldOrder.indexOf(field);
          /* istanbul ignore else -- field names are always in fieldOrder */
          if (idx !== -1) firstFieldId = { field, idx, inputId };
        }
      }
    });
    // Focus first failing field in order
    if (!firstFieldId) {
      // Find smallest index among error fields
      let minIdx = Infinity;
      result.errors.forEach(({ field }) => {
        const idx = fieldOrder.indexOf(field);
        /* istanbul ignore next -- fallback path reached only when no known-field errors exist */
        if (idx !== -1 && idx < minIdx) { minIdx = idx; firstFieldId = inputIdMap[field]; }
      });
    } else {
      firstFieldId = firstFieldId.inputId;
    }
    if (firstFieldId) document.getElementById(firstFieldId)?.focus();
    return;
  }

  const isEditing    = editingCustomId != null;
  const next         = upsertCustomBullet(customRecords, result.value, editingCustomId);
  const saveResult   = saveCustomBullets(next);
  if (!saveResult.ok) {
    const formErrEl = document.getElementById('customBulletFormError');
    /* istanbul ignore else -- #customBulletFormError is always present in the app shell */
    if (formErrEl) formErrEl.textContent = "Couldn't save: browser storage is full or unavailable.";
    return;
  }

  customRecords  = next;
  bullets        = mergeCatalog(getMockBullets(), customRecords);
  closeCustomBulletForm();
  renderBulletList();
  updateBulletCards();
  showToast(isEditing ? 'Custom bullet updated' : 'Custom bullet added');
}

// ── State helpers (for test access) ──────────────────────────────────────────
function _getState()     {
  return {
    bullets, selectedIds, lastResults, lastReq, charts, crosshairIndex, crosshairPinned,
    customRecords, customStorageStatus, editingCustomId, pendingDeleteId,
  };
}
function _resetState()   {
  bullets = []; selectedIds = new Set(); lastResults = []; charts = {};
  crosshairIndex = null; crosshairPinned = false;
  sortColumn = null; sortDirection = 'asc'; tableResults = null;
  sweepMode = false; sweepResults = null; lastReq = null;
  _customDragTable = null;
  customRecords = []; customStorageStatus = 'ok';
  editingCustomId = null; pendingDeleteId = null;
  _chartModPromise = null;
  if (_initListenerController) { _initListenerController.abort(); _initListenerController = null; }
}
function _setBullets(b)              { bullets = b; }
function _setSelectedIds(s)          { selectedIds = s; }
function _setCharts(c)               { charts = c; }
function _setLastResults(r)          { lastResults = r; }
function _setCustomRecords(r)        { customRecords = r; }
function _setCustomStorageStatus(s)  { customStorageStatus = s; }

// Auto-initialize in browser (modules are deferred, so DOM is ready).
// Guard prevents spurious calls when imported by tests before buildDOM().
if (document.getElementById('bulletList')) {
  init();
}

export {
  getMockBullets, computeClientSide,
  renderBulletList, toggleBullet, updateBulletCards, syncSelectAllCheckbox, syncRunButton, runSimulation,
  resetCrosshairState, renderStatCards, buildChartConfig,
  renderResults, renderTable, updateReadout, switchTab, init,
  onSortHeaderClick, updateSortIndicators, _getSortState, SORTABLE_COLUMNS,
  exportTrajectoryCSV,
  exportCSV, exportJSON, exportMarkdown, exportPNG, runCustom, showToast,
  _downloadBlob,
  BULLET_COLORS, SWEEP_COLORS, escapeHtml, csvCell, computeAdjustments, crosshairPlugin,
  drawVLine, drawHLine, annotationPlugin, windChartSubtitle,
  savePrefs, loadPrefs, PREF_KEYS, PREF_DEFAULTS,
  openSidebar, closeSidebar,
  currentState, syncUrl, copyLink,
  updateSweepButtonVisibility, buildSweepRequests, runSweep, clearSweep, renderSweepCharts,
  SWEEP_RANGES,
  _getState, _resetState, _setBullets, _setSelectedIds, _setCharts, _setLastResults,
  _setSimulationError, _loadChart,
  _updateDragTableStatus, _clearCustomDragTable, CUSTOM_DRAG_TABLE_KEY,
  // UX-1 test helpers (openCustomBulletAdd/Edit/close/requestDelete are exported at declaration)
  _setCustomRecords, _setCustomStorageStatus,
};
