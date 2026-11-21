import BULLET_CATALOG from 'virtual:bullet-catalog';
import { decodeState, mergeIntoSearch } from './url-state.js';
import { loadPresets, savePreset, deletePreset, renderPresetList } from './custom-rounds.js';
import { TrajectoryInputError } from './physics/errors.ts';
import { simulateAsync, solveBCAsync, prewarmPhysicsWorker } from './physics/engine-async.ts';
import {
  loadCustomBullets, saveCustomBullets, mergeCatalog, isCustomBulletId,
  renderCustomBulletGroup, syncCustomDeleteGuards, syncCustomRovingTabindex,
  upsertCustomBullet, removeCustomBullet, validateCustomBulletInput,
  bulletForDragModel, CUSTOM_BULLET_PALETTE,
} from './custom-bullets.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SELECTED_BULLETS = 5;
const AUTO_COMPUTE_KEY = 'ballistics_auto_compute';

// Derived from bullets.yaml via virtual:bullet-catalog at build time
const BULLET_COLORS = Object.fromEntries(BULLET_CATALOG.map(b => [b.id, b.hexColor]));

// ── Colour helper ─────────────────────────────────────────────────────────────
/** Regex for a safe CSS hex colour — #rrggbb exactly. */
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Returns the display colour for any bullet (custom or built-in). */
export function colorFor(bullet) {
  const hex = bullet.hexColor;
  const validHex = (typeof hex === 'string' && HEX_COLOR_RE.test(hex)) ? hex : null;
  return validHex || BULLET_COLORS[bullet.id] || '#4ADE80';
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

// ── Cached number formatter (PERF-22) ─────────────────────────────────────────
const _numFmt = new Intl.NumberFormat();

// ── Debounce utility with flush/cancel (PERF-23) ──────────────────────────────
function debounce(fn, delayMs) {
  let timerId = null;
  function debounced() {
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      fn();
    }, delayMs);
  }
  debounced.flush = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
      fn();
    }
  };
  debounced.cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };
  return debounced;
}

// ── Module state ──────────────────────────────────────────────────────────────
const CUSTOM_DRAG_TABLE_KEY = 'ballistics.customDragTable';
let _customDragTable = null;

let bullets = [];
let _bulletById = new Map();
let selectedIds = new Set();

function _syncBulletIndex(list) {
  _bulletById = new Map();
  for (const b of list) _bulletById.set(b.id, b);
}
let lastResults = [];
let charts = {};
let _chartMeta = {};
const TRAJECTORY_CHART_IDS = ['dropChart', 'velocityChart', 'energyChart', 'windChart', 'adjustChart'];
const SWEEP_CHART_IDS      = ['sweepDropChart', 'sweepWindChart', 'sweepVelChart'];

// Memoised chart.js import — resolved once, reused on every renderResults /
// renderSweepCharts call, so Chart.register() fires at most once per page load.
// Evicts the cached promise on rejection so subsequent clicks can retry (PERF-23).
let _chartModPromise = null;
function _loadChart() {
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
function _warmChart() {
  return _loadChart().catch(() => {});
}

const CHART_LOAD_ERROR_MSG = "Couldn't load the chart library. Check your connection and try again.";
const IO_LOAD_ERROR_MSG = "Couldn't load export/import tools. Check your connection and try again.";
const TOOLS_LOAD_ERROR_MSG = "Couldn't load the tools module. Check your connection and try again.";
const DRAG_CSV_LOAD_ERROR_MSG = "Couldn't load CSV parser. Check your connection and try again.";

// Memoised lazy chunk loaders for io.js, tools.js, and drag-csv.js (PERF-28).
// Each evicts its cached promise on rejection so subsequent actions can retry.
const _lazyModPromises = { io: null, tools: null, dragCsv: null };
let _toolsInitialized = false;

function _memoImport(key, loadFn) {
  if (!_lazyModPromises[key]) {
    _lazyModPromises[key] = loadFn().catch(err => {
      _lazyModPromises[key] = null;
      throw err;
    });
  }
  return _lazyModPromises[key];
}

function _loadIo()      { return _memoImport('io',      () => import('./io.js')); }
function _loadTools()   { return _memoImport('tools',   () => import('./tools.js')); }
function _loadDragCsv() { return _memoImport('dragCsv', () => import('./drag-csv.js')); }

async function _withIo(fn) {
  let io;
  try {
    io = await _loadIo();
  } catch (_) {
    _setSimulationError(IO_LOAD_ERROR_MSG);
    return;
  }
  return fn(io);
}

async function _ensureToolsLoaded() {
  const toolsMod = await _loadTools();
  if (!_toolsInitialized) {
    _toolsInitialized = true;
    toolsMod.initTools();
    toolsMod.initDopeCard(simulateAsync);
    toolsMod.initBcSolver(simulateAsync, solveBCAsync);
  }
  return toolsMod;
}

// UX-1: Custom bullet catalog state
let customRecords       = [];    // CustomBulletRecordV1[] — mirror of storage
let customStorageStatus = 'ok';  // 'ok' | 'empty' | 'corrupt' | 'unavailable'
let editingCustomId     = null;  // string | null
let pendingDeleteId     = null;  // string | null
// Crosshair state (task 5 + PERF-20 rAF coalescing + PERF-32 viewport-aware draw)
let crosshairIndex         = null;  // data-point index currently under the cursor
let crosshairPinned        = false; // true after user clicks a range to lock the readout
let _crosshairRafId        = null;
let _pendingCrosshair      = null;
let _chartObserver         = null;
let _visibleChartIds       = new Set();
let _dirtyCrosshairCharts  = new Set();
let _readoutCache          = null;
// Table sort & lazy-render state (FE-3 + PERF-22)
let sortColumn       = null;   // string | null
let sortDirection    = 'asc';  // 'asc' | 'desc'
let tableResults     = null;   // results last passed to renderTable / renderResults
let _tableDirty      = false;
let _dopeDirty       = false;
let _pendingDopeReq  = null;
let _cachedTableRows = null;
let _tableChunkRafId = null;
const TABLE_CHUNK_THRESHOLD = 500;
const TABLE_CHUNK_SIZE      = 250;
// Sweep state (MH-4)
let sweepMode    = false;
let sweepResults = null;
let lastReq      = null;
// Input persistence cache & debouncers (PERF-23 / ENH-6)
let _lastSavedPrefs = new Map();
const _persistInputs = debounce(() => { savePrefs(); syncUrl(); }, 200);
const _scheduleAutoCompute = debounce(() => {
  if (_isAutoComputeEnabled() && selectedIds.size > 0) {
    runSimulation();
  }
}, 250);
let _focusedBulletIdx = 0;
const _limitReachedTimers = new Map();
// Stale-run cancellation controller (PERF-18)
let _simAbortController = null;

function _nextSimSignal() {
  if (_simAbortController) _simAbortController.abort();
  _simAbortController = new AbortController();
  return _simAbortController.signal;
}

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
  if (helpEl && !fileName) helpEl.textContent = 'Mach,CD columns. Overrides the drag model for custom-round runs.';
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
  if (helpEl)     helpEl.textContent = 'Mach,CD columns. Overrides the drag model for custom-round runs.';
}

// ── Mock data (offline fallback) — sourced from bullets.yaml via virtual:bullet-catalog ──
function getMockBullets() {
  return BULLET_CATALOG;
}


// ── Compute trajectories client-side for all selected bullet IDs ──────────────
async function computeClientSide(req, signal) {
  const promises = req.bulletIds.map(id => {
    const bullet = _bulletById.get(id);
    if (!bullet) return null;
    const resolved = bulletForDragModel(bullet, req.dragModel);
    return signal ? simulateAsync(resolved, req, { signal }) : simulateAsync(resolved, req);
  });
  const results = await Promise.all(promises.filter(Boolean));
  return results;
}

// ── Bullet list UI ────────────────────────────────────────────────────────────
let _bulletListDelegatedEl = null;
let _bulletListDelegationController = null;

function _teardownBulletListDelegation() {
  if (_bulletListDelegationController) {
    _bulletListDelegationController.abort();
    _bulletListDelegationController = null;
  }
  _bulletListDelegatedEl = null;
}

function _syncBuiltInRovingTabindex(preferredCard = null) {
  const list = document.getElementById('bulletList');
  /* istanbul ignore next -- callers pass/ensure #bulletList exists */
  if (!list) return;
  const cards = [...list.querySelectorAll('.bullet-card[data-builtin-bullet-id]')];
  if (cards.length === 0) return;
  const visible = cards.filter(c => !c.hidden);
  for (const c of cards) c.setAttribute('tabindex', '-1');
  if (visible.length === 0) {
    _focusedBulletIdx = 0;
    return;
  }
  let idx = preferredCard ? visible.indexOf(preferredCard) : -1;
  if (idx === -1) {
    idx = Math.max(0, Math.min(_focusedBulletIdx, visible.length - 1));
  }
  _focusedBulletIdx = idx;
  visible[idx].setAttribute('tabindex', '0');
}

function _cardSearchText(card) {
  const id = card.dataset.builtinBulletId || card.id.replace(/^card-/, '');
  const b = _bulletById.get(id);
  const name = card.querySelector('.bullet-name')?.textContent ?? '';
  const specs = card.querySelector('.bullet-specs')?.textContent ?? '';
  return [b?.name, b?.caliber, b?.shortName, name, specs].filter(Boolean).join(' ').toLowerCase();
}

function filterBulletList() {
  const input = document.getElementById('bulletSearch');
  const clearBtn = document.getElementById('bulletSearchClear');
  const emptyEl = document.getElementById('bulletSearchEmpty');
  const list = document.getElementById('bulletList');
  const query = (input?.value ?? '').trim().toLowerCase();

  if (clearBtn) clearBtn.hidden = query === '';
  if (!list) return;

  const builtIns = [...list.querySelectorAll('.bullet-card[data-builtin-bullet-id]')];
  const customs = [...list.querySelectorAll('.bullet-card--custom')];
  let visibleCount = 0;

  for (const card of builtIns) {
    const match = query === '' || _cardSearchText(card).includes(query);
    card.hidden = !match;
    if (match) visibleCount++;
  }

  let visibleCustomCount = 0;
  for (const card of customs) {
    const match = query === '' || _cardSearchText(card).includes(query);
    card.hidden = !match;
    if (match) {
      visibleCount++;
      visibleCustomCount++;
    }
  }

  const customGroup = document.getElementById('customBulletGroup');
  if (customGroup) {
    customGroup.hidden = query !== '' && visibleCustomCount === 0;
  }

  if (emptyEl) emptyEl.hidden = query === '' || visibleCount > 0;
  _syncBuiltInRovingTabindex();
  syncCustomRovingTabindex(customGroup || list);
}

function _ensureBulletListDelegation(list) {
  if (_bulletListDelegatedEl === list) return;
  _teardownBulletListDelegation();
  _bulletListDelegatedEl = list;
  _bulletListDelegationController = new AbortController();
  const { signal } = _bulletListDelegationController;
  list.addEventListener('click', e => {
    const card = e.target.closest('.bullet-card[data-builtin-bullet-id]');
    if (card) {
      _syncBuiltInRovingTabindex(card);
      toggleBullet(card.dataset.builtinBulletId);
    }
  }, { signal });
  list.addEventListener('focusin', e => {
    const card = e.target.closest('.bullet-card[data-builtin-bullet-id]');
    if (card && !card.hidden) _syncBuiltInRovingTabindex(card);
  }, { signal });
  list.addEventListener('keydown', e => {
    const card = e.target.closest('.bullet-card[data-builtin-bullet-id]');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleBullet(card.dataset.builtinBulletId);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const visible = [...list.querySelectorAll('.bullet-card[data-builtin-bullet-id]')].filter(c => !c.hidden);
      /* istanbul ignore next -- card receiving keydown is always visible in DOM */
      if (visible.length === 0) return;
      e.preventDefault();
      const currentIdx = visible.indexOf(card);
      /* istanbul ignore next -- currentIdx is >= 0 for a visible card in list */
      const baseIdx = currentIdx === -1 ? 0 : currentIdx;
      let nextIdx = baseIdx;
      if (e.key === 'ArrowDown') nextIdx = Math.min(baseIdx + 1, visible.length - 1);
      else if (e.key === 'ArrowUp') nextIdx = Math.max(baseIdx - 1, 0);
      else if (e.key === 'Home') nextIdx = 0;
      else nextIdx = visible.length - 1;
      _syncBuiltInRovingTabindex(visible[nextIdx]);
      visible[nextIdx].focus();
    }
  }, { signal });
}

function renderBulletList() {
  const list = document.getElementById('bulletList');
  const builtIns = bullets.filter(b => !isCustomBulletId(b.id));
  const customs  = bullets.filter(b =>  isCustomBulletId(b.id));

  list.innerHTML = builtIns.map((b, i) => {
    const isActive = selectedIds.has(b.id);
    return `
    <div class="bullet-card${isActive ? ' active' : ''}" id="card-${escapeHtml(b.id)}"
         data-builtin-bullet-id="${escapeHtml(b.id)}"
         role="button" tabindex="${i === 0 ? '0' : '-1'}"
         aria-pressed="${isActive ? 'true' : 'false'}"
         style="--bullet-color:${colorFor(b)}">
      <div class="bullet-name">${escapeHtml(b.name)}</div>
      <div class="bullet-specs">
        BC: ${escapeHtml(String(b.ballisticCoefficient))} &nbsp;|&nbsp; MV: ${escapeHtml(String(b.muzzleVelocityMps))} m/s
      </div>
      <div class="check" aria-hidden="true"></div>
    </div>
  `;
  }).join('');

  _ensureBulletListDelegation(list);

  // Append custom group (always rendered, even with 0 customs)
  renderCustomBulletGroup(list, customs, {
    selectedIds,
    storageStatus: customStorageStatus,
    onToggle: toggleBullet,
    onEdit:   openCustomBulletEdit,
    onDelete: requestCustomBulletDelete,
  });
  pendingDeleteId = null;

  filterBulletList();
  syncRunButton();
}

function _isAutoComputeEnabled() {
  const el = document.getElementById('autoComputeToggle');
  return Boolean(el && el.checked);
}

function _syncAutoComputeAfterSelectionChange() {
  if (selectedIds.size > 0) {
    if (_isAutoComputeEnabled()) _scheduleAutoCompute();
  } else {
    _scheduleAutoCompute.cancel();
    if (_isAutoComputeEnabled() && lastResults.length > 0) {
      lastResults = [];
      sweepMode = false;
      sweepResults = null;
      const clearBtn = document.getElementById('clearSweepBtn');
      if (clearBtn) clearBtn.style.display = 'none';
      resetCrosshairState();
      const emptyEl = document.getElementById('emptyState');
      if (emptyEl) emptyEl.style.display = '';
      const rc = document.getElementById('resultsContainer');
      if (rc) rc.style.display = 'none';
    }
  }
}

function _syncSingleBulletCard(id) {
  const card = document.getElementById('card-' + id);
  if (card) {
    const isActive = selectedIds.has(id);
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
  syncRunButton();
  // UX-1: sync delete guards and reset any pending delete confirmation
  syncCustomDeleteGuards(document.getElementById('bulletList'), selectedIds);
  pendingDeleteId = null;
}

function toggleBullet(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    if (selectedIds.size >= MAX_SELECTED_BULLETS) {
      const card = document.getElementById('card-' + id);
      if (card) {
        const prevTimer = _limitReachedTimers.get(id);
        if (prevTimer !== undefined) clearTimeout(prevTimer);
        card.classList.add('bullet-card--limit-reached');
        const tid = setTimeout(() => {
          _limitReachedTimers.delete(id);
          card.classList.remove('bullet-card--limit-reached');
        }, 600);
        _limitReachedTimers.set(id, tid);
      }
      const msg = `Maximum ${MAX_SELECTED_BULLETS} rounds can be selected at once`;
      _setSimStatus(msg);
      showToast(msg);
      return;
    }
    selectedIds.add(id);
  }
  _syncSingleBulletCard(id);
  savePrefs();
  syncUrl();
  updateSweepButtonVisibility();
  _syncAutoComputeAfterSelectionChange();
}

function updateBulletCards() {
  bullets.forEach(b => {
    const card = document.getElementById('card-' + b.id);
    if (card) {
      const isActive = selectedIds.has(b.id);
      card.classList.toggle('active', isActive);
      card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  });
  syncRunButton();
  // UX-1: sync delete guards and reset any pending delete confirmation
  syncCustomDeleteGuards(document.getElementById('bulletList'), selectedIds);
  pendingDeleteId = null;
}

function clearSelection() {
  selectedIds.clear();
  updateBulletCards();
  savePrefs();
  syncUrl();
  updateSweepButtonVisibility();
  _syncAutoComputeAfterSelectionChange();
  _setSimStatus('Selection cleared.');
}

function syncRunButton() {
  const btn = document.getElementById('runBtn');
  if (btn) btn.disabled = selectedIds.size === 0;
  const countEl = document.getElementById('selectedCount');
  if (countEl) countEl.textContent = `${selectedIds.size} / ${MAX_SELECTED_BULLETS} selected`;
  const clearBtn = document.getElementById('clearSelectionBtn');
  if (clearBtn) clearBtn.disabled = selectedIds.size === 0;
}

// ── Error handling helpers ────────────────────────────────────────────────────

/** Updates the aria-live status region for screen reader announcements. */
function _setSimStatus(message) {
  const el = document.getElementById('simStatus');
  /* istanbul ignore next -- #simStatus is always present in the app shell */
  if (!el) return;
  el.textContent = String(message);
}

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
  _scheduleAutoCompute.cancel();
  _persistInputs.flush();
  _setSimulationError(null);

  const latRaw = document.getElementById('latitudeDeg')?.value;
  const azRaw  = document.getElementById('azimuthDeg')?.value;
  if (latRaw && (+latRaw < -90 || +latRaw > 90)) { _setSimulationError('Latitude must be between −90 and 90.'); return; }
  if (azRaw  && (+azRaw  < 0  || +azRaw  > 360)) { _setSimulationError('Azimuth must be between 0 and 360.'); return; }

  const btn = document.getElementById('runBtn');
  btn.classList.add('loading');
  _setSimStatus('Computing trajectories…');
  _warmChart();

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

  const signal = _nextSimSignal();
  try {
    const results = await computeClientSide(req, signal);
    if (signal.aborted) return;
    requestAnimationFrame(() => {
      if (signal.aborted) return;
      renderResults(results, req);
      lastResults = results;
      updateSweepButtonVisibility();
      const exportBtn = document.getElementById('exportCsvBtn');
      /* istanbul ignore else -- #exportCsvBtn is always present in the app shell */
      if (exportBtn) exportBtn.style.display = '';
      btn.classList.remove('loading');
      btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
      _setSimStatus(`Trajectories ready. ${results.length} result${results.length === 1 ? '' : 's'} computed.`);
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
    if (err instanceof TrajectoryInputError) {
      _setSimulationError(err.message);
      _setSimStatus(`Simulation failed: ${err.message}`);
    } else {
      console.error(err);
    }
  }
}

// ── Export & import delegation (lazy-loaded via app/io.js, PERF-28) ───────────
function exportTrajectoryCSV() {
  return _withIo(io => io.exportTrajectoryCSV(lastResults));
}

function exportCSV() {
  return _withIo(io => io.exportCSV(lastResults, computeAdjustments));
}

function exportJSON() {
  return _withIo(io => io.exportJSON(lastResults));
}

function importResultsFromFile(file) {
  return _withIo(io => io.importResultsFromFile(file, {
    hexColorRe: HEX_COLOR_RE,
    setError: _setSimulationError,
    onImported: async (sanitized) => {
      lastResults = sanitized;
      try {
        await renderResults(sanitized, {});
      } catch (err) {
        lastResults = [];
        throw err;
      }
      const exportBtn = document.getElementById('exportCsvBtn');
      /* istanbul ignore else -- #exportCsvBtn is always present in the app shell */
      if (exportBtn) exportBtn.style.display = '';
    },
  }));
}

function exportMarkdown() {
  return _withIo(io => io.exportMarkdown(lastResults, { computeAdjustments, escapeHtml }));
}

function exportPNG(chartId) {
  return _withIo(io => io.exportPNG(chartId));
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
  _persistInputs.flush();
  _setSimulationError(null);
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
  _warmChart();

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
  const signal = _nextSimSignal();
  let result;
  try {
    result = await simulateAsync(bullet, req, { signal });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (err instanceof TrajectoryInputError) {
      return showCustomError(err.message);
    }
    throw err;
  }
  if (signal.aborted) return;
  lastResults = [result];
  lastReq = req;
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

// ── Touch forwarder — translates touchmove to mousemove on chart canvases ─────
// touch-action: none in CSS stops the browser from scrolling the page when
// a touch starts on a chart canvas; this listener is therefore { passive: true }
// and does NOT call preventDefault().
export function _attachTouchForwarder(canvas) {
  canvas.addEventListener('touchmove', e => {
    const t = e.touches[0];
    canvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: t.clientX, clientY: t.clientY,
      bubbles: true, cancelable: true,
    }));
  }, { passive: true });
}

// ── Range readout — populate the panel below the charts (cached cells, PERF-32) ─
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
      entry.dropCell.textContent   = `${sign(p.dropCm)}${p.dropCm} cm`;
      entry.velCell.textContent    = `${p.velocityMps} m/s`;
      entry.energyCell.textContent = `${p.energyJoules} J`;
      entry.windCell.textContent   = `${sign(p.windDriftCm)}${p.windDriftCm} cm`;

      if (p.spinDriftCm > 0) {
        entry.spinCell.textContent = `Spin Drift: ${p.spinDriftCm.toFixed(1)} cm`;
        if (entry.spinCell.parentNode !== entry.row) {
          entry.row.insertBefore(entry.spinCell, entry.corCell.parentNode === entry.row ? entry.corCell : null);
        }
      } else if (entry.spinCell.parentNode === entry.row) {
        entry.spinCell.remove();
      }

      if (p.coriolisDeflectionCm != null) {
        entry.corCell.textContent = `Coriolis: ${p.coriolisDeflectionCm >= 0 ? '+' : ''}${p.coriolisDeflectionCm.toFixed(1)} cm`;
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
function _teardownChartObserver() {
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

function _observeChartCanvases(ids) {
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

function scheduleCrosshairSync(nextIndex, sourceChartId, results) {
  if (nextIndex === crosshairIndex) return;
  crosshairIndex = nextIndex;
  _pendingCrosshair = { index: nextIndex, sourceChartId, results };
  if (_crosshairRafId === null) {
    _crosshairRafId = requestAnimationFrame(() => {
      _crosshairRafId = null;
      const { index, sourceChartId: srcId, results: res } = _pendingCrosshair;
      _pendingCrosshair = null;
      if (index !== null) {
        updateReadout(res, index);
      } else {
        const panel = document.getElementById('rangeReadout');
        /* istanbul ignore else -- #rangeReadout is always present in the app shell */
        if (panel) panel.style.display = 'none';
      }
      _redrawSiblingCharts(srcId);
    });
  }
}

function _handleChartClick(elements, results) {
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
    updateReadout(results, crosshairIndex);
  } else {
    crosshairIndex = null;
    const panel = document.getElementById('rangeReadout');
    /* istanbul ignore else -- #rangeReadout is always present in the app shell */
    if (panel) panel.style.display = 'none';
  }
  _redrawSiblingCharts(null);
}

// ── Reset crosshair to initial (no hover, no pin) ────────────────────────────
function resetCrosshairState() {
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

// ── Chart performance helpers (PERF-21) ──────────────────────────────────────
function _prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function _chartAnimation(datasets) {
  if (_prefersReducedMotion()) return false;
  let total = 0;
  for (const ds of datasets) total += ds.data.length;
  return total > 1000 ? false : { duration: 250 };
}

function _lineTension(points) {
  return points.length > 200 ? 0 : 0.3;
}

// ── Render per-bullet stat cards into container ───────────────────────────────
function _statCardsHtml(results) {
  return `
    <div class="stats-grid">
      ${results.map(r => {
        const color = colorFor(r.bullet);
        const daLine = r.densityAltitudeMeters !== undefined
          ? `<br><span style="color:var(--text)">${Number(r.densityAltitudeMeters)}</span> m density alt`
          : '';
        return `
        <div class="stat-card" style="--bullet-color:${color}">
          <div class="stat-label" style="color:${color}">${escapeHtml(r.bullet.name)}</div>
          <div class="stat-value">${_numFmt.format(Number(r.bullet.muzzleVelocityMps))}</div>
          <div class="stat-unit">MV m/s &nbsp;·&nbsp; BC ${Number(r.bullet.ballisticCoefficient)} &nbsp;·&nbsp; ${Number(r.bullet.bulletWeightGrams)}g</div>
          <div style="margin-top:8px; font-family:'Share Tech Mono',monospace; font-size:9px; color:var(--text-dim); letter-spacing:1px; line-height:1.8">
            <span style="color:var(--text)">⚡ ${_numFmt.format(Number(r.bullet.muzzleEnergyJoules))}</span> J muzzle energy<br>
            <span style="color:var(--text)">${Number(r.supersonicLimitMeters)}</span> m supersonic${daLine}<br>
            <span style="color:var(--text)">${Number(r.maxOrdinateCm)}</span> cm max ordinate @ ${Number(r.maxOrdinateRangeMeters)} m
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function renderStatCards(results, container) {
  container.insertAdjacentHTML('beforeend', _statCardsHtml(results));
}

/**
 * Build a Chart.js config for one trajectory chart panel.
 *
 * @param {{ id: string, title: string, subtitle: string, yLabel: string,
 *           key: string, annotations?: Array<object> }} def
 *   Chart panel definition (id, axis labels, optional annotation overlays).
 * @param {object[]} datasets  Pre-built Chart.js dataset array.
 * @param {object[]} results   Simulation results used by hover/click callbacks.
 * @returns {object} Chart.js config ready for `new Chart(ctx, config)`.
 */
function buildChartConfig(def, datasets, results) {
  const getResults = () => _chartMeta[def.id]?.results ?? results;
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
        scheduleCrosshairSync(nextIndex, def.id, getResults());
      },
      onClick: (event, elements) => {
        _handleChartClick(elements, getResults());
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
        decimation: { enabled: true, algorithm: 'lttb', samples: 250, threshold: 250 },
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

/** Build datasets for one standard trajectory chart definition. */
function _buildTrajectoryDatasets(def, results) {
  const datasets = results.map(r => ({
    label:            r.bullet.name,
    data:             r.points.map(p => ({ x: p.rangeMeters, y: p[def.key] })),
    borderColor:      colorFor(r.bullet),
    backgroundColor:  'transparent',
    borderWidth:      2,
    pointRadius:      0,
    pointHoverRadius: 4,
    tension:          _lineTension(r.points)
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
          tension:          _lineTension(r.points),
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
          tension:          _lineTension(r.points),
        });
      });
    }
  }
  return datasets;
}

/** Build MOA + MRAD datasets in a single computeAdjustments pass per point (PERF-21). */
function _buildAdjustmentDatasets(results) {
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
      moaData[i]  = { x: p.rangeMeters, y: a.moa };
      mradData[i] = { x: p.rangeMeters, y: a.mrad };
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

// ── Results rendering ─────────────────────────────────────────────────────────
async function renderResults(rawResults, req) {
  const results = rawResults.filter(r => r?.bullet);
  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';
  const cc = document.getElementById('chartContainer');
  // Update drag model status pill
  const modelEl = document.getElementById('modelStatus');
  /* istanbul ignore else -- #modelStatus is always present in the app shell */
  if (modelEl) modelEl.textContent = `MODEL: ${req.customDragTable?.length ? 'CUSTOM' : (req.dragModel ?? 'G1')}`;

  resetCrosshairState();
  _readoutCache = null;

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
    { id: 'dropChart',     title: 'BULLET DROP',         subtitle: `zeroed at ${req.zeroRangeMeters} m`, yLabel: 'Drop (cm)',       key: 'dropCm',       annotations: [...dropAnns] },
    { id: 'velocityChart', title: 'VELOCITY RETENTION',  subtitle: 'm/s downrange',                      yLabel: 'Velocity (m/s)', key: 'velocityMps',  annotations: [...sonicAnn] },
    { id: 'energyChart',   title: 'KINETIC ENERGY',      subtitle: 'joules downrange',                   yLabel: 'Energy (J)',      key: 'energyJoules', annotations: [...sonicAnn] },
    { id: 'windChart',     title: 'WIND DRIFT',           subtitle: windChartSubtitle(req), yLabel: 'Drift (cm)',     key: 'windDriftCm',  annotations: [...sonicAnn] }
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
      // PERF-21: update stat cards and existing Chart instances in place
      const existingStats = cc.querySelector('.stats-grid');
      /* istanbul ignore else -- .stats-grid is always created on initial renderResults */
      if (existingStats) existingStats.outerHTML = _statCardsHtml(results);

      chartDefs.forEach(def => {
        const subEl = document.getElementById(def.id)?.closest('.chart-panel')?.querySelector('.chart-subtitle');
        /* istanbul ignore else -- .chart-subtitle is always present inside .chart-panel */
        if (subEl) subEl.textContent = def.subtitle;
        const datasets = _buildTrajectoryDatasets(def, results);
        const meta = _chartMeta[def.id];
        meta.results = results;
        meta.annotations.splice(0, meta.annotations.length, ...def.annotations);
        const anim = _chartAnimation(datasets);
        charts[def.id].data.datasets = datasets;
        charts[def.id].options.animation = anim;
        charts[def.id].update(anim ? undefined : 'none');
      });

      const adjDatasets = _buildAdjustmentDatasets(results);
      const adjMeta = _chartMeta.adjustChart;
      adjMeta.results = results;
      adjMeta.annotations.splice(0, adjMeta.annotations.length, ...sonicAnn);
      const adjAnim = _chartAnimation(adjDatasets);
      charts.adjustChart.data.datasets = adjDatasets;
      charts.adjustChart.options.animation = adjAnim;
      charts.adjustChart.update(adjAnim ? undefined : 'none');
    } else {
      cc.innerHTML = '';
      Object.values(charts).forEach(c => c.destroy());
      charts = {};
      _chartMeta = {};
      _teardownChartObserver();
      renderStatCards(results, cc);

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

        const datasets = _buildTrajectoryDatasets(def, results);
        _chartMeta[def.id] = { results, annotations: def.annotations };
        const ctx = document.getElementById(def.id).getContext('2d');
        charts[def.id] = new ChartCtor(ctx, buildChartConfig(def, datasets, results));

        // Item 4: forward touchmove as mousemove so the crosshair readout works
        // on both iOS (unreliable synthetic mouse events) and Android Chrome.
        // Page scroll is suppressed by touch-action: none on the canvas (CSS),
        // so the listener is passive.
        const canvas = document.getElementById(def.id);
        /* istanbul ignore else -- canvas is always present after chart creation */
        if (canvas) {
          _attachTouchForwarder(canvas);
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

        const adjDatasets = _buildAdjustmentDatasets(results);
        const adjAnns = [...sonicAnn];
        _chartMeta.adjustChart = { results, annotations: adjAnns };

        const adjCtx = document.getElementById('adjustChart').getContext('2d');
        charts['adjustChart'] = new ChartCtor(adjCtx, {
          type: 'line',
          data: { datasets: adjDatasets },
          plugins: [crosshairPlugin, annotationPlugin(adjAnns)],
          options: {
            responsive: true, maintainAspectRatio: false,
            parsing: false, normalized: true,
            animation: _chartAnimation(adjDatasets),
            events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
            interaction: { mode: 'nearest', intersect: false },
            onHover: (event, elements) => {
              if (crosshairPinned) return;
              const nextIndex = elements.length > 0 ? elements[0].index : null;
              scheduleCrosshairSync(nextIndex, 'adjustChart', _chartMeta.adjustChart.results);
            },
            onClick: (event, elements) => {
              _handleChartClick(elements, _chartMeta.adjustChart.results);
            },
            scales: {
              x:     { type: 'linear', title: { display: true, text: 'Range (m)', color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { color: 'rgba(30,48,64,0.6)' }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
              yMoa:  { type: 'linear', position: 'left',  title: { display: true, text: 'MOA',  color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { color: 'rgba(30,48,64,0.6)' }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
              yMrad: { type: 'linear', position: 'right', title: { display: true, text: 'MRAD', color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { drawOnChartArea: false }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
            },
            plugins: {
              decimation: { enabled: true, algorithm: 'lttb', samples: 250, threshold: 250 },
              legend:  { labels: { color: '#c8dde8', font: { family: 'Rajdhani', size: 12, weight: '600' }, usePointStyle: true, pointStyleWidth: 12 } },
              tooltip: { backgroundColor: '#141d26', borderColor: '#1e3040', borderWidth: 1, titleFont: { family: 'Share Tech Mono', size: 10 }, bodyFont: { family: 'Share Tech Mono', size: 10 }, titleColor: '#00d4ff', bodyColor: '#c8dde8', padding: 10, displayColors: true },
            }
          }
        });

        const adjCanvas = document.getElementById('adjustChart');
        /* istanbul ignore else */
        if (adjCanvas) {
          _attachTouchForwarder(adjCanvas);
        }
      }
      _observeChartCanvases(TRAJECTORY_CHART_IDS);
    }
  }

  // PERF-22: defer hidden-tab Data Table and DOPE card renders until their tab activates
  sortColumn = null;
  sortDirection = 'asc';
  tableResults = results;
  _cachedTableRows = null;
  _pendingDopeReq = req;
  _tableDirty = true;
  _dopeDirty = true;

  if (document.getElementById('dataPanel')?.classList.contains('active')) {
    _tableDirty = false;
    renderTable(results);
  }
  if (document.getElementById('toolsPanel')?.classList.contains('active')) {
    try {
      const toolsMod = await _ensureToolsLoaded();
      _dopeDirty = false;
      toolsMod.renderDopeCard(results, req);
    } catch (_) {
      _setSimulationError(TOOLS_LOAD_ERROR_MSG);
    }
  }
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

function _cancelTableChunkRaf() {
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
          <td>${_numFmt.format(p.velocityMps)}</td>
          <td>${_numFmt.format(p.energyJoules)}</td>
          <td>${p.windDriftCm > 0 ? '+' : ''}${p.windDriftCm} cm</td>
          <td>${p.timeOfFlightSec}s</td>
          <td>${adj.moa > 0 ? '+' : ''}${adj.moa}</td>
          <td>${adj.mrad > 0 ? '+' : ''}${adj.mrad}</td>
          ${showSpinDrift ? `<td>${(p.spinDriftCm ?? 0).toFixed(1)} cm</td>` : ''}
          ${showCoriolis ? `<td>${(p.coriolisDeflectionCm ?? 0) >= 0 ? '+' : ''}${(p.coriolisDeflectionCm ?? 0).toFixed(1)} cm</td>` : ''}
        </tr>`;
}

function renderTable(results) {
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
  _setSimulationError(null);
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
  const bullet   = _bulletById.get(bulletId);

  if (!bullet) { if (btn) btn.querySelector('span').textContent = 'SWEEP'; return; }

  _warmChart();
  const signal = _nextSimSignal();
  let results;
  try {
    results = await Promise.all(requests.map(r => simulateAsync(bulletForDragModel(bullet, r.dragModel), r, { signal })));
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (btn) btn.querySelector('span').textContent = 'SWEEP';
    /* istanbul ignore else -- simulate only throws TrajectoryInputError */
    if (err instanceof TrajectoryInputError) console.warn('[sweep]', err.message);
    return;
  }
  if (signal.aborted) return;

  sweepResults = results;
  sweepMode    = true;
  await renderSweepCharts(results, sweepParam);

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
  const values   = SWEEP_RANGES[sweepParam] ?? SWEEP_RANGES.wind;
  const labels   = { wind: 'km/h', altitude: 'm alt', temperature: '°C' };
  const unit     = labels[sweepParam] ?? '';
  const subtitle = `${sweepParam} sweep (${values.join(', ')} ${unit})`;

  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';
  const cc = document.getElementById('chartContainer');

  resetCrosshairState();
  _readoutCache = null;

  const sweepDefs = [
    { id: 'sweepDropChart', title: 'SWEEP — BULLET DROP', yLabel: 'Drop (cm)',      key: 'dropCm'      },
    { id: 'sweepWindChart', title: 'SWEEP — WIND DRIFT',  yLabel: 'Drift (cm)',     key: 'windDriftCm' },
    { id: 'sweepVelChart',  title: 'SWEEP — VELOCITY',    yLabel: 'Velocity (m/s)', key: 'velocityMps' },
  ];

  let ChartCtor;
  try {
    ({ Chart: ChartCtor } = await _loadChart());
  } catch (_) {
    _setSimulationError(CHART_LOAD_ERROR_MSG);
    return;
  }

  const buildSweepDatasets = def => sweepResultsList.map((r, i) => ({
    label:            `${values[i]} ${unit}`,
    data:             r.points.map(p => ({ x: p.rangeMeters, y: p[def.key] })),
    borderColor:      SWEEP_COLORS[i % SWEEP_COLORS.length],
    backgroundColor:  'transparent',
    borderWidth:      2,
    pointRadius:      0,
    pointHoverRadius: 4,
    tension:          _lineTension(r.points),
  }));

  const canReuse = SWEEP_CHART_IDS.every(id => charts[id] && _chartMeta[id] && document.getElementById(id));

  if (canReuse) {
    sweepDefs.forEach(def => {
      const subEl = document.getElementById(def.id)?.closest('.chart-panel')?.querySelector('.chart-subtitle');
      /* istanbul ignore else -- .chart-subtitle is always present inside .chart-panel */
      if (subEl) subEl.textContent = subtitle;
      const datasets = buildSweepDatasets(def);
      _chartMeta[def.id].results = sweepResultsList;
      const anim = _chartAnimation(datasets);
      charts[def.id].data.datasets = datasets;
      charts[def.id].options.animation = anim;
      charts[def.id].update(anim ? undefined : 'none');
    });
    return;
  }

  cc.innerHTML = '';
  Object.values(charts).forEach(c => c.destroy());
  charts = {};
  _chartMeta = {};
  _teardownChartObserver();

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
      ?.addEventListener('click', () => exportPNG(def.id));

    const datasets = buildSweepDatasets(def);
    _chartMeta[def.id] = { results: sweepResultsList };
    const canvas = document.getElementById(def.id);
    charts[def.id] = new ChartCtor(canvas.getContext('2d'), buildChartConfig(def, datasets, sweepResultsList));
    _attachTouchForwarder(canvas);
  });

  _observeChartCanvases(SWEEP_CHART_IDS);
}

// ── Tab switching ─────────────────────────────────────────────────────────────
async function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('chartsPanel').classList.toggle('active', name === 'charts');
  document.getElementById('dataPanel').classList.toggle('active', name === 'data');
  document.getElementById('toolsPanel')?.classList.toggle('active', name === 'tools');
  // PERF-22: flush deferred renders when the user activates Data Table or Tools
  if (name === 'data' && _tableDirty && tableResults) {
    _tableDirty = false;
    renderTable(tableResults);
  }
  if (name === 'tools') {
    try {
      const toolsMod = await _ensureToolsLoaded();
      if (_dopeDirty && tableResults) {
        _dopeDirty = false;
        toolsMod.renderDopeCard(tableResults, _pendingDopeReq);
      }
    } catch (_) {
      _setSimulationError(TOOLS_LOAD_ERROR_MSG);
    }
  }
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
  _persistInputs.flush();
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

// ── Theme toggle (UX-9) ───────────────────────────────────────────────────────

/** Update the toggle button label and icon to reflect the current theme. */
function updateToggleLabel(theme) {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  btn.textContent = theme === 'dark' ? '\u{1F319}' : '☀️';
}

/** Update Chart.js tooltip colours to match the active theme. */
function _applyChartTheme(theme) {
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

/** Wire up the theme toggle button and apply the saved/default theme. */
function initThemeToggle() {
  const savedTheme = (() => {
    try { return localStorage.getItem('bv_theme') || 'dark'; } catch (_) { return 'dark'; }
  })();
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateToggleLabel(savedTheme);

  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('bv_theme', next); } catch (_) { /* private browsing */ }
    updateToggleLabel(next);
    _applyChartTheme(next);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
let _initListenerController = null;

function init() {
  if (_initListenerController) _initListenerController.abort();
  _initListenerController = new AbortController();
  const { signal } = _initListenerController;
  signal.addEventListener('abort', _teardownBulletListDelegation, { once: true });
  // Service Worker registration deferred until window 'load' so SW precache
  // never competes with critical-path assets on first visit (PERF-24).
  if ('serviceWorker' in navigator) {
    const registerSw = () => {
      navigator.serviceWorker.register(
        import.meta.env.BASE_URL + 'sw.js',
        { type: 'module', scope: import.meta.env.BASE_URL }
      )
        .catch(err => console.warn('SW registration failed:', err));
    };
    if (document.readyState === 'complete') {
      registerSw();
    } else {
      window.addEventListener('load', registerSw, { once: true, signal });
    }
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
  _syncBulletIndex(bullets);

  // Restore bullet selection: URL params take precedence over saved prefs (capped at MAX_SELECTED_BULLETS)
  // Resolved before renderBulletList() so .active cards render in a single DOM pass (PERF-31).
  {
    let usedUrlBullets = false;
    if (fromUrl.bulletIds !== null) {
      const filtered = [...new Set(fromUrl.bulletIds.filter(id => _bulletById.has(id)))].slice(0, MAX_SELECTED_BULLETS);
      if (filtered.length > 0) {
        selectedIds = new Set(filtered);
        usedUrlBullets = true;
      }
    }
    if (!usedUrlBullets) {
      if (merged.selectedIds !== null) {
        const filtered = [...new Set(merged.selectedIds.filter(id => _bulletById.has(id)))].slice(0, MAX_SELECTED_BULLETS);
        selectedIds = new Set(filtered);
      } else {
        // First visit: select only built-in bullets[0] (not custom)
        selectedIds = new Set();
        const firstBuiltIn = getMockBullets()[0];
        /* istanbul ignore next -- getMockBullets() always returns ≥1 bullet in tests */
        if (firstBuiltIn) selectedIds.add(firstBuiltIn.id);
      }
    }
  }
  renderBulletList();

  // Update custom form panel availability
  _syncCustomPanelAvailability();

  syncRunButton();
  syncCustomDeleteGuards(document.getElementById('bulletList'), selectedIds);

  // Restore auto-compute toggle preference (default true)
  const autoToggle = document.getElementById('autoComputeToggle');
  if (autoToggle) {
    let savedAuto = null;
    try { savedAuto = localStorage.getItem(AUTO_COMPUTE_KEY); } catch (_) {}
    autoToggle.checked = savedAuto !== 'false';
    autoToggle.addEventListener('change', () => {
      try { localStorage.setItem(AUTO_COMPUTE_KEY, String(autoToggle.checked)); } catch (_) {}
      if (!autoToggle.checked) _scheduleAutoCompute.cancel();
    }, { signal });
  }

  // Persist parameter changes automatically, sync URL, and schedule auto-compute
  const autoParamIds = [
    'zeroRange','maxRange','windSpeed','windDir','altitude','temperature',
    'step','sightHeight','shootingAngle','dragModel','twistRate','latitudeDeg','azimuthDeg',
  ];
  autoParamIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const onParamChange = () => {
      _persistInputs();
      if (_isAutoComputeEnabled() && selectedIds.size > 0) _scheduleAutoCompute();
    };
    el.addEventListener('input', onParamChange, { signal });
    el.addEventListener('change', onParamChange, { signal });
  });
  window.addEventListener('pagehide', () => _persistInputs.flush(), { signal });

  // Bullet search filter & clear selection
  const searchInput = document.getElementById('bulletSearch');
  if (searchInput) {
    searchInput.addEventListener('input', filterBulletList, { signal });
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape' && searchInput.value !== '') {
        e.preventDefault();
        searchInput.value = '';
        filterBulletList();
      }
    }, { signal });
  }
  document.getElementById('bulletSearchClear')?.addEventListener('click', () => {
    const input = document.getElementById('bulletSearch');
    /* istanbul ignore else -- #bulletSearch is always present with #bulletSearchClear */
    if (input) {
      input.value = '';
      filterBulletList();
      input.focus();
    }
  }, { signal });
  document.getElementById('clearSelectionBtn')?.addEventListener('click', clearSelection, { signal });

  // Wire up static event listeners (replaces window.* globals and onclick attrs)
  document.getElementById('runBtn')?.addEventListener('click', () => {
    _scheduleAutoCompute.cancel();
    closeSidebar();
    runSimulation();
  }, { signal });
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportTrajectoryCSV);
  document.querySelector('.export-csv-btn')?.addEventListener('click', exportCSV);
  document.querySelector('.export-json-btn')?.addEventListener('click', exportJSON);
  document.querySelector('.export-md-btn')?.addEventListener('click', exportMarkdown);
  document.getElementById('importJsonBtn')?.addEventListener('click', () => {
    document.getElementById('importJsonFile')?.click();
  });
  document.getElementById('importJsonFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    importResultsFromFile(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  });
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

  // WA-12: Wire file input for custom drag table (lazy-loads drag-csv.js, PERF-28)
  document.getElementById('dragTableFile')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const helpEl = document.getElementById('dragTableHelp');
    if (file.size > 64 * 1024) {
      /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
      if (helpEl) helpEl.textContent = 'File too large (max 64 KB).';
      return;
    }
    let parseDragCsv;
    try {
      ({ parseDragCsv } = await _loadDragCsv());
    } catch (_) {
      /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
      if (helpEl) helpEl.textContent = DRAG_CSV_LOAD_ERROR_MSG;
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
        if (helpEl) helpEl.textContent = 'Loaded — custom-round results use this table instead of G1/G7.';
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

  // UX-9: Theme toggle
  initThemeToggle();

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
      _redrawSiblingCharts(null);
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
    const selJson = JSON.stringify([...selectedIds]);
    if (_lastSavedPrefs.get(PREF_KEYS.selectedIds) !== selJson) {
      localStorage.setItem(PREF_KEYS.selectedIds, selJson);
      _lastSavedPrefs.set(PREF_KEYS.selectedIds, selJson);
    }
    for (const k of Object.keys(PREF_DEFAULTS).filter(k => k !== 'selectedIds')) {
      const domId = DOM_ID_FOR_PREF[k];
      /* istanbul ignore next -- null branch only reached when a pref has no DOM element */
      const value = (domId ? document.getElementById(domId)?.value : null)
                    ?? String(PREF_DEFAULTS[k]);
      const storageKey = PREF_KEYS[k];
      if (_lastSavedPrefs.get(storageKey) !== value) {
        localStorage.setItem(storageKey, value);
        _lastSavedPrefs.set(storageKey, value);
      }
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
  _syncBulletIndex(bullets);
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
  _syncBulletIndex(bullets);
  closeCustomBulletForm();
  renderBulletList();
  updateBulletCards();
  showToast(isEditing ? 'Custom bullet updated' : 'Custom bullet added');
}

// ── State helpers (for test access) ──────────────────────────────────────────
function _getState()     {
  return {
    bullets, _bulletById, selectedIds, lastResults, lastReq, charts, crosshairIndex, crosshairPinned,
    _visibleChartIds, _dirtyCrosshairCharts,
    customRecords, customStorageStatus, editingCustomId, pendingDeleteId,
  };
}
function _resetState()   {
  _cancelCrosshairRaf();
  _cancelTableChunkRaf();
  _persistInputs.cancel();
  _scheduleAutoCompute.cancel();
  for (const tid of _limitReachedTimers.values()) clearTimeout(tid);
  _limitReachedTimers.clear();
  _focusedBulletIdx = 0;
  _teardownBulletListDelegation();
  _teardownChartObserver();
  _readoutCache = null;
  bullets = []; _syncBulletIndex(bullets); selectedIds = new Set(); lastResults = []; charts = {}; _chartMeta = {};
  crosshairIndex = null; crosshairPinned = false;
  sortColumn = null; sortDirection = 'asc'; tableResults = null;
  _tableDirty = false; _dopeDirty = false; _pendingDopeReq = null; _cachedTableRows = null;
  sweepMode = false; sweepResults = null; lastReq = null;
  _customDragTable = null;
  customRecords = []; customStorageStatus = 'ok';
  editingCustomId = null; pendingDeleteId = null;
  _chartModPromise = null;
  _lazyModPromises.io = null;
  _lazyModPromises.tools = null;
  _lazyModPromises.dragCsv = null;
  _toolsInitialized = false;
  _lastSavedPrefs = new Map();
  if (_simAbortController) { _simAbortController.abort(); _simAbortController = null; }
  if (_initListenerController) { _initListenerController.abort(); _initListenerController = null; }
}
function _setBullets(b)              { bullets = b; _syncBulletIndex(bullets); }
function _setSelectedIds(s)          { selectedIds = s; }
function _setCharts(c)               { charts = c; }
function _setLastResults(r)          { lastResults = r; }
function _setCustomRecords(r)        { customRecords = r; }
function _setCustomStorageStatus(s)  { customStorageStatus = s; }

// Auto-initialize in browser (modules are deferred, so DOM is ready).
// Guard prevents spurious calls when imported by tests before buildDOM().
if (document.getElementById('bulletList')) {
  init();
  prewarmPhysicsWorker();
}

export {
  getMockBullets, computeClientSide,
  MAX_SELECTED_BULLETS, AUTO_COMPUTE_KEY,
  renderBulletList, toggleBullet, updateBulletCards, clearSelection, filterBulletList, syncRunButton, runSimulation,
  _scheduleAutoCompute,
  resetCrosshairState, renderStatCards, buildChartConfig,
  renderResults, renderTable, updateReadout, switchTab, init,
  onSortHeaderClick, updateSortIndicators, _getSortState, SORTABLE_COLUMNS,
  exportTrajectoryCSV,
  exportCSV, exportJSON, exportMarkdown, exportPNG, importResultsFromFile, runCustom, showToast,
  BULLET_COLORS, SWEEP_COLORS, escapeHtml, computeAdjustments, crosshairPlugin,
  drawVLine, drawHLine, annotationPlugin, windChartSubtitle,
  savePrefs, loadPrefs, PREF_KEYS, PREF_DEFAULTS,
  openSidebar, closeSidebar,
  currentState, syncUrl, copyLink,
  updateSweepButtonVisibility, buildSweepRequests, runSweep, clearSweep, renderSweepCharts,
  SWEEP_RANGES,
  _getState, _resetState, _setBullets, _setSelectedIds, _setCharts, _setLastResults,
  _setSimulationError, _setSimStatus, _loadChart, _warmChart, _loadIo, _loadTools, _loadDragCsv,
  scheduleCrosshairSync, debounce, TABLE_CHUNK_THRESHOLD, TABLE_CHUNK_SIZE,
  _updateDragTableStatus, _clearCustomDragTable, CUSTOM_DRAG_TABLE_KEY,
  // UX-1 test helpers (openCustomBulletAdd/Edit/close/requestDelete are exported at declaration)
  _setCustomRecords, _setCustomStorageStatus,
  // UX-9: theme toggle
  initThemeToggle, updateToggleLabel, _applyChartTheme,
};
