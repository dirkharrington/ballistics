import BULLET_CATALOG from 'virtual:bullet-catalog';
import { decodeState, mergeIntoSearch } from './url-state.js';
import { loadPresets, savePreset, deletePreset, renderPresetList } from './custom-rounds.js';
import { TrajectoryInputError } from './physics/errors.ts';
import { simulateAsync, solveBCAsync, prewarmPhysicsWorker } from './physics/engine-async.ts';
import {
  loadCustomBullets, saveCustomBullets, mergeCatalog, isCustomBulletId,
  renderCustomBulletGroup, syncCustomDeleteGuards, syncCustomRovingTabindex,
  upsertCustomBullet, removeCustomBullet, validateCustomBulletInput,
  bulletForDragModel,
} from './custom-bullets.js';
import {
  PREF_KEYS, PREF_DEFAULTS, AUTO_COMPUTE_KEY, CUSTOM_DRAG_TABLE_KEY,
  safeSetItem, safeRemoveItem, loadAutoComputePref, saveAutoComputePref,
  savePrefs as _savePrefs, loadPrefs, applyTheme, initThemeToggle as _initThemeToggle,
  updateToggleLabel, escapeHtml, showToast, _setSimStatus, _setSimulationError,
} from './prefs.js';
import {
  BULLET_COLORS, HEX_COLOR_RE, colorFor,
  _loadChart, _warmChart,
  drawVLine, drawHLine, annotationPlugin, crosshairPlugin,
  _attachTouchForwarder, updateReadout, scheduleCrosshairSync,
  resetCrosshairState, toggleReadoutPin, renderStatCards,
  windChartSubtitle, buildChartConfig, renderCharts, destroyCharts,
  _applyChartTheme, _getChartState, _resetChartState, _setCharts,
} from './charts.js';
import {
  SORTABLE_COLUMNS, TABLE_CHUNK_THRESHOLD, TABLE_CHUNK_SIZE,
  computeAdjustments, renderTable, onSortHeaderClick, updateSortIndicators,
  _getSortState, _cancelTableChunkRaf, setTablePendingResults,
  flushTableIfDirty, clearTableDirty, getTableResults, _resetTableState,
} from './table.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SELECTED_BULLETS = 5;

const IO_LOAD_ERROR_MSG       = "Couldn't load export/import tools. Check your connection and try again.";
const TOOLS_LOAD_ERROR_MSG    = "Couldn't load the tools module. Check your connection and try again.";
const DRAG_CSV_LOAD_ERROR_MSG = "Couldn't load CSV parser. Check your connection and try again.";
const SWEEP_LOAD_ERROR_MSG    = "Couldn't load parameter sweep tools. Check your connection and try again.";

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
let _customDragTable = null;

let bullets = [];
let _bulletById = new Map();
let selectedIds = new Set();

function _syncBulletIndex(list) {
  _bulletById = new Map();
  for (const b of list) _bulletById.set(b.id, b);
}

let lastResults = [];
let _dopeDirty = false;
let _pendingDopeReq = null;

// Sweep state (MH-4 — implementation lazy-loaded via app/sweep.js)
let sweepMode    = false;
let sweepResults = null;
let lastReq      = null;

// Memoised lazy chunk loaders (PERF-28 + ENH-7).
// Each evicts its cached promise on rejection so subsequent actions can retry.
const _lazyModPromises = { io: null, tools: null, dragCsv: null, sweep: null };
let _toolsInitialized = false;

function _lazyLoad(key, loadFn) {
  if (!_lazyModPromises[key]) {
    _lazyModPromises[key] = loadFn().catch(err => {
      _lazyModPromises[key] = null;
      throw err;
    });
  }
  return _lazyModPromises[key];
}

function _loadIo()      { return _lazyLoad('io',      () => import('./io.js')); }
function _loadTools()   { return _lazyLoad('tools',   () => import('./tools.js')); }
function _loadDragCsv() { return _lazyLoad('dragCsv', () => import('./drag-csv.js')); }
function _loadSweep()   { return _lazyLoad('sweep',   () => import('./sweep.js')); }

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

async function _withSweep(fn) {
  let sweepMod;
  try {
    sweepMod = await _loadSweep();
  } catch (_) {
    _setSimulationError(SWEEP_LOAD_ERROR_MSG);
    return;
  }
  return fn(sweepMod);
}

async function _ensureToolsLoaded() {
  const toolsMod = await _loadTools();
  if (!_toolsInitialized) {
    _toolsInitialized = true;
    toolsMod.initTools();
    toolsMod.initDopeCard(simulateAsync);
    toolsMod.initBcSolver(simulateAsync, solveBCAsync);
    toolsMod.initMpbrTool();
  }
  return toolsMod;
}

// UX-1: Custom bullet catalog state
let customRecords       = [];    // CustomBulletRecordV1[] — mirror of storage
let customStorageStatus = 'ok';  // 'ok' | 'empty' | 'corrupt' | 'unavailable'
let editingCustomId     = null;  // string | null
let pendingDeleteId     = null;  // string | null

// Input persistence cache & debouncers (PERF-23 / ENH-6)
let _lastSavedPrefs = new Map();
function savePrefs() {
  return _savePrefs(selectedIds, _lastSavedPrefs);
}

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
  safeRemoveItem(CUSTOM_DRAG_TABLE_KEY);
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
    name,
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

// ── Mobile sidebar drawer toggle ──────────────────────────────────────────────
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

// ── Results & tab switching ───────────────────────────────────────────────────
async function renderResults(rawResults, req) {
  const results = await renderCharts(rawResults, req, { onExportPNG: exportPNG });

  // PERF-22: defer hidden-tab Data Table and DOPE card renders until their tab activates
  setTablePendingResults(results);
  _pendingDopeReq = req;
  _dopeDirty = true;

  if (document.getElementById('dataPanel')?.classList.contains('active')) {
    clearTableDirty();
    renderTable(results);
  }
  if (document.getElementById('toolsPanel')?.classList.contains('active')) {
    try {
      const toolsMod = await _ensureToolsLoaded();
      _dopeDirty = false;
      toolsMod.renderDopeCard(results, req);
      toolsMod.renderMpbrTool(results);
    } catch (_) {
      _setSimulationError(TOOLS_LOAD_ERROR_MSG);
    }
  }
}

async function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('chartsPanel').classList.toggle('active', name === 'charts');
  document.getElementById('dataPanel').classList.toggle('active', name === 'data');
  document.getElementById('toolsPanel')?.classList.toggle('active', name === 'tools');
  // PERF-22: flush deferred renders when the user activates Data Table or Tools
  if (name === 'data') flushTableIfDirty();
  if (name === 'tools') {
    try {
      const toolsMod = await _ensureToolsLoaded();
      const pendingResults = getTableResults();
      if (_dopeDirty && pendingResults) {
        _dopeDirty = false;
        toolsMod.renderDopeCard(pendingResults, _pendingDopeReq);
        toolsMod.renderMpbrTool(pendingResults);
      }
    } catch (_) {
      _setSimulationError(TOOLS_LOAD_ERROR_MSG);
    }
  }
}

// ── Sweep delegation (lazy-loads app/sweep.js on demand, ENH-7) ───────────────
function updateSweepButtonVisibility() {
  const sweepControls = document.getElementById('sweepControls');
  if (sweepControls) sweepControls.style.display = selectedIds.size > 0 ? 'block' : 'none';
}

function runSweep() {
  return _withSweep(sweepMod => sweepMod.runSweep({
    selectedIds,
    lastReq,
    getBulletById: id => _bulletById.get(id),
    nextSignal: _nextSimSignal,
    onExportPNG: exportPNG,
    onSweepStateChange: (mode, results) => {
      sweepMode = mode;
      sweepResults = results;
    },
  }));
}

function clearSweep() {
  return _withSweep(sweepMod => sweepMod.clearSweep({
    lastResults,
    lastReq,
    renderResults,
    onSweepStateChange: (mode, results) => {
      sweepMode = mode;
      sweepResults = results;
    },
  }));
}

function renderSweepCharts(sweepResultsList, sweepParam) {
  return _withSweep(sweepMod => sweepMod.renderSweepCharts(sweepResultsList, sweepParam, {
    onExportPNG: exportPNG,
  }));
}

// ── URL state sharing ─────────────────────────────────────────────────────────
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

function syncUrl() {
  const qs = mergeIntoSearch(location.search, currentState());
  /* istanbul ignore next -- qs is always non-empty (encodeState always emits 10 keys) */
  const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
  history.replaceState(history.state, '', url);
}

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

function initThemeToggle() {
  return _initThemeToggle(
    _applyChartTheme,
    _initListenerController ? { signal: _initListenerController.signal } : {},
  );
}

// ── Init ──────────────────────────────────────────────────────────────────────
let _initListenerController = null;

function init() {
  if (_initListenerController) _initListenerController.abort();
  _initListenerController = new AbortController();
  const { signal } = _initListenerController;
  signal.addEventListener('abort', _teardownBulletListDelegation, { once: true });

  // Service Worker registration deferred until window 'load' (PERF-24)
  if ('serviceWorker' in navigator) {
    const registerSw = () => {
      navigator.serviceWorker.register(
        import.meta.env.BASE_URL + 'sw.js',
        { type: 'module', scope: import.meta.env.BASE_URL },
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
        selectedIds = new Set();
        const firstBuiltIn = getMockBullets()[0];
        /* istanbul ignore next -- getMockBullets() always returns ≥1 bullet in tests */
        if (firstBuiltIn) selectedIds.add(firstBuiltIn.id);
      }
    }
  }
  renderBulletList();
  _syncCustomPanelAvailability();
  syncRunButton();
  syncCustomDeleteGuards(document.getElementById('bulletList'), selectedIds);

  // Restore auto-compute toggle preference (default true)
  const autoToggle = document.getElementById('autoComputeToggle');
  if (autoToggle) {
    autoToggle.checked = loadAutoComputePref();
    autoToggle.addEventListener('change', () => {
      saveAutoComputePref(autoToggle.checked);
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

  // Static event listeners
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
  document.getElementById('importJsonFile')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    importResultsFromFile(file);
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

  // Mobile drawer & tabs
  document.getElementById('paramsToggle')?.addEventListener('click', openSidebar);
  document.getElementById('sidebarBackdrop')?.addEventListener('click', closeSidebar);
  document.getElementById('tab-charts')?.addEventListener('click', function() { switchTab('charts', this); });
  document.getElementById('tab-data')?.addEventListener('click', function() { switchTab('data', this); });
  document.getElementById('tab-tools')?.addEventListener('click', function() { switchTab('tools', this); });

  if (fromUrl.recognized) syncUrl();

  // MH-4: Sweep controls (lazy-loads app/sweep.js on interaction)
  updateSweepButtonVisibility();
  document.getElementById('sweepParam')?.addEventListener('change', () => { _loadSweep().catch(() => {}); }, { signal });
  document.getElementById('sweepBtn')?.addEventListener('click', runSweep, { signal });
  document.getElementById('clearSweepBtn')?.addEventListener('click', clearSweep, { signal });

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
      if (!arr.some(p => p.mach <= 0.5)) throw new Error('invalid');
      if (!arr.some(p => p.mach >= 2.0)) throw new Error('invalid');
      _customDragTable = arr.map(p => ({ mach: p.mach, cd: p.cd }));
      _updateDragTableStatus();
    }
  } catch (_) {
    _customDragTable = null;
    safeRemoveItem(CUSTOM_DRAG_TABLE_KEY);
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
        safeSetItem(CUSTOM_DRAG_TABLE_KEY, JSON.stringify(table));
        _updateDragTableStatus(file.name, table.length);
        /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
        if (helpEl) helpEl.textContent = 'Loaded — custom-round results use this table instead of G1/G7.';
      } catch (err) {
        _customDragTable = null;
        safeRemoveItem(CUSTOM_DRAG_TABLE_KEY);
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

  // Pin button toggles crosshair lock
  document.getElementById('readoutPin')?.addEventListener('click', toggleReadoutPin, { signal });
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
    ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7',
     'cbBulletDiameterInches','cbMuzzleVelocityFps'].forEach(id => {
      const el = document.getElementById(id);
      /* istanbul ignore else -- field inputs are always present in the app shell */
      if (el) { el.value = ''; el.removeAttribute('aria-invalid'); }
    });
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

  if (editingCustomId === id) closeCustomBulletForm();

  renderBulletList();
  updateBulletCards();
  showToast('Custom bullet deleted');
}

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
          const idx = fieldOrder.indexOf(field);
          /* istanbul ignore else -- field names are always in fieldOrder */
          if (idx !== -1) firstFieldId = { field, idx, inputId };
        }
      }
    });
    if (!firstFieldId) {
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

  const isEditing  = editingCustomId != null;
  const next       = upsertCustomBullet(customRecords, result.value, editingCustomId);
  const saveResult = saveCustomBullets(next);
  if (!saveResult.ok) {
    const formErrEl = document.getElementById('customBulletFormError');
    /* istanbul ignore else -- #customBulletFormError is always present in the app shell */
    if (formErrEl) formErrEl.textContent = "Couldn't save: browser storage is full or unavailable.";
    return;
  }

  customRecords = next;
  bullets       = mergeCatalog(getMockBullets(), customRecords);
  _syncBulletIndex(bullets);
  closeCustomBulletForm();
  renderBulletList();
  updateBulletCards();
  showToast(isEditing ? 'Custom bullet updated' : 'Custom bullet added');
}

// ── State helpers (for test access) ──────────────────────────────────────────
function _getState() {
  return {
    bullets, _bulletById, selectedIds, lastResults, lastReq,
    ..._getChartState(),
    customRecords, customStorageStatus, editingCustomId, pendingDeleteId,
  };
}
function _resetState() {
  _cancelTableChunkRaf();
  _resetTableState();
  _resetChartState();
  _persistInputs.cancel();
  _scheduleAutoCompute.cancel();
  for (const tid of _limitReachedTimers.values()) clearTimeout(tid);
  _limitReachedTimers.clear();
  _focusedBulletIdx = 0;
  _teardownBulletListDelegation();
  bullets = []; _syncBulletIndex(bullets); selectedIds = new Set(); lastResults = [];
  _dopeDirty = false; _pendingDopeReq = null;
  sweepMode = false; sweepResults = null; lastReq = null;
  _customDragTable = null;
  customRecords = []; customStorageStatus = 'ok';
  editingCustomId = null; pendingDeleteId = null;
  _lazyModPromises.io = null;
  _lazyModPromises.tools = null;
  _lazyModPromises.dragCsv = null;
  _lazyModPromises.sweep = null;
  _toolsInitialized = false;
  _lastSavedPrefs = new Map();
  if (_simAbortController) { _simAbortController.abort(); _simAbortController = null; }
  if (_initListenerController) { _initListenerController.abort(); _initListenerController = null; }
}
function _setBullets(b)             { bullets = b; _syncBulletIndex(bullets); }
function _setSelectedIds(s)         { selectedIds = s; }
function _setLastResults(r)         { lastResults = r; }
function _setCustomRecords(r)       { customRecords = r; }
function _setCustomStorageStatus(s) { customStorageStatus = s; }

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
  renderResults, renderCharts, destroyCharts, renderTable, updateReadout, switchTab, init,
  onSortHeaderClick, updateSortIndicators, _getSortState, SORTABLE_COLUMNS,
  exportTrajectoryCSV,
  exportCSV, exportJSON, exportMarkdown, exportPNG, importResultsFromFile, runCustom, showToast,
  BULLET_COLORS, HEX_COLOR_RE, colorFor, escapeHtml, computeAdjustments, crosshairPlugin,
  drawVLine, drawHLine, annotationPlugin, windChartSubtitle, _attachTouchForwarder,
  savePrefs, loadPrefs, PREF_KEYS, PREF_DEFAULTS,
  openSidebar, closeSidebar,
  currentState, syncUrl, copyLink,
  updateSweepButtonVisibility, runSweep, clearSweep, renderSweepCharts, _loadSweep,
  _getState, _resetState, _setBullets, _setSelectedIds, _setCharts, _setLastResults,
  _setSimulationError, _setSimStatus, _loadChart, _warmChart, _loadIo, _loadTools, _loadDragCsv,
  scheduleCrosshairSync, debounce, TABLE_CHUNK_THRESHOLD, TABLE_CHUNK_SIZE,
  _updateDragTableStatus, _clearCustomDragTable, CUSTOM_DRAG_TABLE_KEY,
  _setCustomRecords, _setCustomStorageStatus,
  initThemeToggle, updateToggleLabel, applyTheme, _applyChartTheme,
};
