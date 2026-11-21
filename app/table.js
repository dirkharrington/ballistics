import { escapeHtml, formatNumber, computeAdjustments } from './prefs.js';
import { colorFor } from './charts.js';

export { computeAdjustments };

export const TABLE_CHUNK_THRESHOLD = 500;
export const TABLE_CHUNK_SIZE      = 250;

export const SORTABLE_COLUMNS = Object.freeze({
  range:     (p, _adj) => p.rangeMeters,
  drop:      (p, _adj) => p.dropCm,
  velocity:  (p, _adj) => p.velocityMps,
  energy:    (p, _adj) => p.energyJoules,
  windDrift: (p, _adj) => p.windDriftCm,
  time:      (p, _adj) => p.timeOfFlightSec,
  moa:       (_p, adj) => adj.moa,
  mrad:      (_p, adj) => adj.mrad,
});

// ── Module state ──────────────────────────────────────────────────────────────

let sortColumn       = null;
let sortDirection    = 'asc';
let tableResults     = null;
let _tableDirty      = false;
let _cachedTableRows = null;
let _tableChunkRafId = null;

/** Cancel any pending chunked table append animation frame. */
export function _cancelTableChunkRaf() {
  if (_tableChunkRafId !== null) {
    cancelAnimationFrame(_tableChunkRafId);
    _tableChunkRafId = null;
  }
}

function _formatTableRow({ p, adj, color, escapedName }, showSpinDrift, showCoriolis) {
  return `
        <tr>
          <td><span class="bullet-tag" style="background:${color}"></span>${escapedName}</td>
          <td>${p.rangeMeters}</td>
          <td>${p.dropCm > 0 ? '+' : ''}${p.dropCm} cm</td>
          <td>${formatNumber(p.velocityMps)}</td>
          <td>${formatNumber(p.energyJoules)}</td>
          <td>${p.windDriftCm > 0 ? '+' : ''}${p.windDriftCm} cm</td>
          <td>${p.timeOfFlightSec}s</td>
          <td>${adj.moa > 0 ? '+' : ''}${adj.moa}</td>
          <td>${adj.mrad > 0 ? '+' : ''}${adj.mrad}</td>
          ${showSpinDrift ? `<td>${(p.spinDriftCm ?? 0).toFixed(1)} cm</td>` : ''}
          ${showCoriolis ? `<td>${(p.coriolisDeflectionCm ?? 0) >= 0 ? '+' : ''}${(p.coriolisDeflectionCm ?? 0).toFixed(1)} cm</td>` : ''}
        </tr>`;
}

/** Render the trajectory data table (chunked via rAF when rows exceed TABLE_CHUNK_THRESHOLD). */
export function renderTable(results) {
  _cancelTableChunkRaf();
  const tbody = document.getElementById('tableBody');

  const showSpinDrift = results.some(r => r.points.some(p => p.spinDriftCm > 0));
  const spinDriftHeader = document.getElementById('spinDriftColHeader');
  /* istanbul ignore else -- #spinDriftColHeader is always present in the app shell */
  if (spinDriftHeader) spinDriftHeader.style.display = showSpinDrift ? '' : 'none';

  const showCoriolis = results.some(r => r.points.some(p => p.coriolisDeflectionCm !== undefined && p.coriolisDeflectionCm !== 0));
  const coriolisHeader = document.getElementById('coriolisColHeader');
  /* istanbul ignore else -- #coriolisColHeader is always present in the app shell */
  if (coriolisHeader) coriolisHeader.style.display = showCoriolis ? '' : 'none';

  // PERF-22: cache precomputed row objects across sort clicks for the same results
  if (results !== tableResults || _cachedTableRows === null) {
    tableResults = results;
    _cachedTableRows = [];
    results.forEach(r => {
      const color       = colorFor(r.bullet);
      const escapedName = escapeHtml(r.bullet.name);
      r.points.forEach(p => {
        const adj = computeAdjustments(p.dropCm, p.rangeMeters);
        _cachedTableRows.push({ r, p, adj, color, escapedName });
      });
    });
  }

  const rows = sortColumn !== null ? [..._cachedTableRows] : _cachedTableRows;

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

  if (rows.length <= TABLE_CHUNK_THRESHOLD) {
    tbody.innerHTML = rows.map(row => _formatTableRow(row, showSpinDrift, showCoriolis)).join('');
  } else {
    // PERF-22: render first chunk synchronously and stream remaining rows via rAF
    let offset = TABLE_CHUNK_SIZE;
    tbody.innerHTML = rows.slice(0, offset).map(row => _formatTableRow(row, showSpinDrift, showCoriolis)).join('');
    const appendChunk = () => {
      _tableChunkRafId = null;
      const end = Math.min(offset + TABLE_CHUNK_SIZE, rows.length);
      let chunk = '';
      for (let i = offset; i < end; i++) {
        chunk += _formatTableRow(rows[i], showSpinDrift, showCoriolis);
      }
      tbody.insertAdjacentHTML('beforeend', chunk);
      offset = end;
      if (offset < rows.length) {
        _tableChunkRafId = requestAnimationFrame(appendChunk);
      }
    };
    _tableChunkRafId = requestAnimationFrame(appendChunk);
  }
  updateSortIndicators();
}

/** Toggle or select a sort column and re-render the table. */
export function onSortHeaderClick(key) {
  if (tableResults === null || !(key in SORTABLE_COLUMNS)) return;
  if (sortColumn === key) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = key;
    sortDirection = 'asc';
  }
  renderTable(tableResults);
}

/** Sync aria-sort attributes and ▲/▼ sort indicators across table header cells. */
export function updateSortIndicators() {
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

/** Return the active sort column and direction. */
export function _getSortState() {
  return { column: sortColumn, direction: sortDirection };
}

/** Record new pending results after renderCharts and mark table dirty until Data tab activates. */
export function setTablePendingResults(results) {
  sortColumn = null;
  sortDirection = 'asc';
  tableResults = results;
  _cachedTableRows = null;
  _tableDirty = true;
}

/** Render the table if dirty and results are available; returns true if rendered. */
export function flushTableIfDirty() {
  if (_tableDirty && tableResults) {
    _tableDirty = false;
    renderTable(tableResults);
    return true;
  }
  return false;
}

/** Clear dirty flag (e.g. when #dataPanel is already active). */
export function clearTableDirty() {
  _tableDirty = false;
}

/** Return the latest results stored for the table / DOPE deferral. */
export function getTableResults() {
  return tableResults;
}

/** Reset table sort, cached rows, dirty flag, and any pending chunk rAF. */
export function _resetTableState() {
  _cancelTableChunkRaf();
  sortColumn = null;
  sortDirection = 'asc';
  tableResults = null;
  _tableDirty = false;
  _cachedTableRows = null;
}
