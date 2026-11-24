import BULLET_CATALOG from 'virtual:bullet-catalog';
import { decodeState, mergeIntoSearch } from './url-state.js';
import { TrajectoryInputError } from './physics/errors.ts';
import { simulateAsync, solveBCAsync, prewarmPhysicsWorker } from './physics/engine-async.ts';
import {
  loadCustomBullets, saveCustomBullets, migrateLegacyCustomRounds,
  mergeCatalog, isCustomBulletId,
  renderCustomBulletGroup, syncCustomDeleteGuards, syncCustomRovingTabindex,
  upsertCustomBullet, removeCustomBullet, validateCustomBulletInput,
} from './custom-bullets.js';
import {
  PREF_DEFAULTS,
  loadAutoComputePref, saveAutoComputePref,
  savePrefs as _savePrefs, loadPrefs, initThemeToggle as _initThemeToggle,
  escapeHtml, computeAdjustments, showToast, _setSimStatus, _setSimulationError,
  pushRecentCombo, loadRecentCombos,
} from './prefs.js';
import {
  HEX_COLOR_RE, colorFor, _warmChart,
  resetCrosshairState, toggleReadoutPin,
  renderCharts, syncModelPill, _applyChartTheme, _getChartState, _resetChartState,
} from './charts.js';
import {
  renderTable, onSortHeaderClick,
  _cancelTableChunkRaf, setTablePendingResults,
  flushTableIfDirty, clearTableDirty, getTableResults, _resetTableState,
} from './table.js';
import {
  UNIT_SYSTEMS, normalizeUnitSystem, setUnitSystemState,
  unitLabel, toDisplay, loadUnitSystem, saveUnitSystem,
  writeMetricInputValue, readMetricInputValue,
} from './units.js';
import { loadProfiles, saveProfile, deleteProfile } from './profiles.js';
import { syncClickCustomVisibility } from './clicks.js';
import { validateMvSens, applyMvSensitivity, showMvSensError } from './mv-sens.js';

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
let _cbPendingDragTable = null;
let _cbPendingDragName  = '';

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

// Global unit system (ENH-3)
let unitSystem   = UNIT_SYSTEMS.METRIC;

const UNIT_INPUT_CONFIG = Object.freeze({
  zeroRange:    { kind: 'range',       metric: { min: '25',  max: '500',  step: '25'   }, imperial: { min: '25',    max: '550',   step: '1'     } },
  maxRange:     { kind: 'range',       metric: { min: '100', max: '2000', step: '100'  }, imperial: { min: '100',   max: '2200',  step: '1'     } },
  windSpeed:    { kind: 'windSpeed',   metric: { min: '0',   max: '80',   step: '1'    }, imperial: { min: '0',     max: '50',    step: '1'     } },
  altitude:     { kind: 'altitude',    metric: { min: '0',   max: '3000', step: '100'  }, imperial: { min: '0',     max: '10000', step: '1'     } },
  pressureHpa:  { kind: 'pressure',    metric: { min: '500', max: '1100', step: '0.1'  }, imperial: { min: '14.77', max: '32.48', step: '0.01'  } },
  temperature:  { kind: 'temp',        metric: { min: '-30', max: '50',   step: '1'    }, imperial: { min: '-22',   max: '122',   step: '0.1'   } },
  step:         { kind: 'step',        metric: { min: '10',  max: '100',  step: '10'   }, imperial: { min: '10',    max: '110',   step: '1'     } },
  sightHeight:  { kind: 'sightHeight', metric: { min: '10',  max: '100',  step: '0.1'  }, imperial: { min: '0.4',   max: '4',     step: '0.01'  } },
  mvSens:       { kind: 'mvSens',      metric: { min: '-5.5', max: '5.5',  step: '0.05' }, imperial: { min: '-10.025', max: '10.025', step: '0.1'   } },
  mpbrVitalCm:  { kind: 'vitalZone',   metric: { min: '2',   max: '100',  step: '1'    }, imperial: { min: '0.8',   max: '40',    step: '0.1'   } },
});

const ALL_UNIT_INPUTS = Object.freeze({
  zeroRange:     'range',
  maxRange:      'range',
  windSpeed:     'windSpeed',
  altitude:      'altitude',
  pressureHpa:   'pressure',
  temperature:   'temp',
  step:          'step',
  sightHeight:   'sightHeight',
  mvSens:        'mvSens',
  mpbrVitalCm:   'vitalZone',
  bcCalcWeightG: 'weight',
  bcCalcMvMps:   'velocity',
  bcCalcDropCm:  'drop',
  bcCalcRangeM:  'range',
  bcCalcAltM:    'altitude',
  bcCalcTempC:   'temp',
  toolDrop:      'drop',
  toolRange:     'range',
});

const PREF_UNIT_INPUT_IDS = new Set([
  'zeroRange', 'maxRange', 'windSpeed', 'altitude', 'temperature', 'step', 'sightHeight', 'mvSens',
]);

function _syncUnitToggleUI(sys) {
  const btn = document.getElementById('unitToggle');
  if (btn) {
    btn.textContent = sys === UNIT_SYSTEMS.IMPERIAL ? 'IMPERIAL' : 'METRIC';
    btn.setAttribute('aria-pressed', sys === UNIT_SYSTEMS.IMPERIAL ? 'true' : 'false');
  }
  document.querySelectorAll('[data-unit-kind]').forEach(el => {
    el.textContent = unitLabel(el.dataset.unitKind, sys);
  });
  document.querySelectorAll('#sweepParam option[data-unit-label]').forEach(opt => {
    opt.textContent = `${opt.dataset.labelPrefix} (${unitLabel(opt.dataset.unitLabel, sys)})`;
  });
  const readoutRangeEl = document.getElementById('readoutRange');
  if (readoutRangeEl && readoutRangeEl.textContent.startsWith('—')) {
    readoutRangeEl.textContent = `— ${unitLabel('range', sys)}`;
  }
  for (const [id, cfg] of Object.entries(UNIT_INPUT_CONFIG)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const bounds = cfg[sys];
    el.setAttribute('min', bounds.min);
    el.setAttribute('max', bounds.max);
    el.setAttribute('step', bounds.step);
  }
}

async function setUnitSystem(nextSys, { persist = true } = {}) {
  const target = normalizeUnitSystem(nextSys);
  const prev   = unitSystem;
  if (target === prev) return target;

  // Capture canonical metric values before switching unitSystem
  const captured = {};
  for (const [id, kind] of Object.entries(ALL_UNIT_INPUTS)) {
    const el = document.getElementById(id);
    if (el && el.value !== '') {
      captured[id] = { kind, val: readMetricInputValue(el, kind, prev) };
    }
  }

  unitSystem = target;
  if (persist) {
    saveUnitSystem(unitSystem);
  } else {
    setUnitSystemState(unitSystem);
  }
  _syncUnitToggleUI(unitSystem);

  for (const [id, entry] of Object.entries(captured)) {
    const el = document.getElementById(id);
    writeMetricInputValue(el, entry.kind, entry.val, unitSystem);
    el.dataset.unitApplied = unitSystem;
  }

  if (bullets.length > 0 && document.getElementById('bulletList')) {
    renderBulletList();
  }
  if (_toolsInitialized) {
    const toolsMod = await _loadTools();
    toolsMod.setToolsUnitSystem(unitSystem);
  }
  if (sweepMode && sweepResults) {
    const sweepParam = document.getElementById('sweepParam')?.value ?? 'wind';
    await renderSweepCharts(sweepResults, sweepParam);
  } else if (lastResults.length > 0) {
    await renderResults(lastResults, lastReq ?? {}, unitSystem);
  }
  syncUrl();
  return unitSystem;
}

function toggleUnitSystem() {
  const next = unitSystem === UNIT_SYSTEMS.IMPERIAL ? UNIT_SYSTEMS.METRIC : UNIT_SYSTEMS.IMPERIAL;
  return setUnitSystem(next, { persist: true });
}

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

/** First selected bullet + the last simulation request, for MV truing (S23-4). */
function _getTruingContext() {
  const id = [...selectedIds][0];
  const baseBullet = id ? _bulletById.get(id) : null;
  if (!baseBullet || !lastReq) return null;
  const req = baseBullet.customDragTable?.length
    ? { ...lastReq, customDragTable: baseBullet.customDragTable }
    : lastReq;
  return { baseBullet, bullet: baseBullet, req };
}

/** Save (or refresh) the "<name> (trued)" custom bullet; never touches catalog bullets. */
function _saveTruedBullet(fields, baseBullet) {
  const existing = customRecords.find(r => r.name.toLowerCase() === fields.name.toLowerCase());
  const result = validateCustomBulletInput(fields, {
    records:      customRecords,
    builtInNames: getBuiltInBullets().map(b => b.name),
    editingId:    existing ? existing.id : null,
  });
  if (!result.ok) return { ok: false, message: result.errors[0].message };
  const payload = { ...result.value, customDragTable: baseBullet.customDragTable ?? null };
  const next = upsertCustomBullet(customRecords, payload, existing ? existing.id : null);
  if (!saveCustomBullets(next).ok) return { ok: false, message: "Couldn't save: browser storage is full or unavailable." };
  customRecords = next;
  bullets       = mergeCatalog(getBuiltInBullets(), customRecords);
  _syncBulletIndex(bullets);
  renderBulletList();
  showToast(existing ? 'Trued bullet updated' : 'Trued bullet added');
  return { ok: true, name: result.value.name };
}

async function _ensureToolsLoaded() {
  const toolsMod = await _loadTools();
  if (!_toolsInitialized) {
    _toolsInitialized = true;
    toolsMod.initTools();
    toolsMod.initDopeCard();
    toolsMod.initBcSolver(solveBCAsync);
    toolsMod.initMpbrTool();
    toolsMod.initMvTruing({
      getContext: _getTruingContext,
      loadSimulate: () => import('./physics/engine.ts').then(m => m.simulate),
      saveTrued: (baseBullet, mvMps) => _saveTruedBullet(toolsMod.truedBulletFields(baseBullet, mvMps), baseBullet),
    });
  }
  toolsMod.setToolsUnitSystem(unitSystem);
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
  return _savePrefs(selectedIds, _lastSavedPrefs, unitSystem);
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

// ── Custom drag table CSV reader ──────────────────────────────────────────────
async function _readDragCsvFile(file, { onSuccess, onError }) {
  if (!file) return;
  if (file.size > 64 * 1024) {
    onError('File too large (max 64 KB).');
    return;
  }
  let parseDragCsv;
  try {
    ({ parseDragCsv } = await _loadDragCsv());
  } catch (_) {
    onError(DRAG_CSV_LOAD_ERROR_MSG);
    return;
  }
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const table = parseDragCsv(evt.target.result);
      onSuccess(table);
    } catch (err) {
      onError(err.message);
    }
  };
  reader.onerror = () => {
    onError('Error reading file.');
  };
  reader.readAsText(file);
}

// ── Built-in bullet catalog — sourced from bullets.yaml via virtual:bullet-catalog ──
function getBuiltInBullets() {
  return BULLET_CATALOG;
}

// ── Compute trajectories client-side for all selected bullet IDs ──────────────
async function computeClientSide(req, signal) {
  const promises = req.bulletIds.map(id => {
    const bullet = _bulletById.get(id);
    if (!bullet) return null;
    const resolved = applyMvSensitivity(
      bullet, req.mvSensMps, req.temperatureC,
    );
    const bulletReq = bullet.customDragTable?.length
      ? { ...req, customDragTable: bullet.customDragTable }
      : req;
    return signal ? simulateAsync(resolved, bulletReq, { signal }) : simulateAsync(resolved, bulletReq);
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
  return [b?.name, b?.shortName, name, specs].filter(Boolean).join(' ').toLowerCase();
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
    const mvDisp = toDisplay('velocity', b.muzzleVelocityMps, unitSystem);
    const mvUnit = unitLabel('velocity', unitSystem);
    return `
    <div class="bullet-card${isActive ? ' active' : ''}" id="card-${escapeHtml(b.id)}"
         data-builtin-bullet-id="${escapeHtml(b.id)}"
         role="button" tabindex="${i === 0 ? '0' : '-1'}"
         aria-pressed="${isActive ? 'true' : 'false'}"
         style="--bullet-color:${colorFor(b)}">
      <div class="bullet-name">${escapeHtml(b.name)}</div>
      <div class="bullet-specs">
        BC: ${escapeHtml(String(b.ballisticCoefficient))} &nbsp;|&nbsp; MV: ${escapeHtml(String(mvDisp))} ${escapeHtml(mvUnit)}
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
  syncSelectionMeta();
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
  syncSelectionMeta();
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
  syncSelectionMeta();
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

function syncSelectionMeta() {
  const countEl = document.getElementById('selectedCount');
  if (countEl) countEl.textContent = `${selectedIds.size} / ${MAX_SELECTED_BULLETS} selected`;
  const clearBtn = document.getElementById('clearSelectionBtn');
  if (clearBtn) clearBtn.disabled = selectedIds.size === 0;
}

// ── Simulation ────────────────────────────────────────────────────────────────
function _readEnvExtras() {
  const get = id => document.getElementById(id);
  const latRaw   = get('latitudeDeg')?.value;
  const azRaw    = get('azimuthDeg')?.value;
  const pressEl  = get('pressureHpa');
  const pressureHpa = pressEl && pressEl.value !== ''
    ? readMetricInputValue(pressEl, 'pressure', unitSystem)
    : null;
  const humRaw   = get('humidityPercent')?.value;
  const humidityPercent = humRaw != null && humRaw !== '' ? +humRaw : null;
  const includeEotvos = Boolean(get('includeEotvos')?.checked);
  const twistRaw = get('twistRate')?.value;

  let error = null;
  if (latRaw && (+latRaw < -90 || +latRaw > 90)) error = 'Latitude must be between −90 and 90.';
  else if (azRaw && (+azRaw < 0 || +azRaw > 360)) error = 'Azimuth must be between 0 and 360.';
  else if (pressureHpa !== null && (!Number.isFinite(pressureHpa) || pressureHpa < 500 || pressureHpa > 1100)) {
    error = 'Pressure must be between 500 and 1100 hPa.';
  } else if (humidityPercent !== null && (!Number.isFinite(humidityPercent) || humidityPercent < 0 || humidityPercent > 100)) {
    error = 'Humidity must be between 0 and 100%.';
  }

  return {
    error,
    fields: {
      ...(twistRaw ? { twistRateInchesPerTurn: +twistRaw } : {}),
      ...(latRaw ? { latitudeDeg: +latRaw } : {}),
      ...(azRaw ? { azimuthDeg: +azRaw } : {}),
      ...(pressureHpa !== null ? { pressureHpa } : {}),
      ...(humidityPercent !== null ? { humidityPercent } : {}),
      ...(includeEotvos ? { includeEotvos: true } : {}),
    },
  };
}

async function runSimulation() {
  if (selectedIds.size === 0) { return; }
  _scheduleAutoCompute.cancel();
  _persistInputs.flush();
  _setSimulationError(null);

  const extras = _readEnvExtras();
  if (extras.error) { _setSimulationError(extras.error); return; }

  const mvSensCheck = validateMvSens(document.getElementById('mvSens')?.value, unitSystem);
  if (showMvSensError(mvSensCheck.ok ? '' : mvSensCheck.error)) return;
  const mvSensMps = mvSensCheck.value
    ? readMetricInputValue(document.getElementById('mvSens'), 'mvSens', unitSystem, 0)
    : 0;

  _setSimStatus('Computing trajectories…');
  _warmChart();

  const get = id => document.getElementById(id);
  const req = {
    bulletIds:                [...selectedIds],
    zeroRangeMeters:          readMetricInputValue(get('zeroRange'),   'range',       unitSystem, 0),
    maxRangeMeters:           readMetricInputValue(get('maxRange'),    'range',       unitSystem, 0),
    stepMeters:               readMetricInputValue(get('step'),        'step',        unitSystem, 0),
    windSpeedKph:             readMetricInputValue(get('windSpeed'),   'windSpeed',   unitSystem, 0),
    windDirectionDeg:         +get('windDir').value,
    altitudeMeters:           readMetricInputValue(get('altitude'),    'altitude',    unitSystem, 0),
    temperatureC:             readMetricInputValue(get('temperature'), 'temp',        unitSystem, 0),
    sightHeightMm:            readMetricInputValue(get('sightHeight'), 'sightHeight', unitSystem, 0),
    shootingAngleDegrees:     +get('shootingAngle').value,
    dragModel:                get('dragModel').value,
    mvSensMps,
    ...extras.fields,
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
      pushRecentCombo([...selectedIds], _bulletById);
      _renderRecentPanel();
      updateSweepButtonVisibility();
      const exportBtn = document.getElementById('exportCsvBtn');
      /* istanbul ignore else -- #exportCsvBtn is always present in the app shell */
      if (exportBtn) exportBtn.style.display = '';
      _setSimStatus(`Trajectories ready. ${results.length} result${results.length === 1 ? '' : 's'} computed.`);
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
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
  return _withIo(io => io.exportTrajectoryCSV(lastResults, unitSystem));
}

function exportCSV() {
  return _withIo(io => io.exportCSV(lastResults, computeAdjustments, unitSystem));
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
  return _withIo(io => io.exportMarkdown(lastResults, { computeAdjustments, escapeHtml, unitSystem }));
}

function exportPNG(chartId) {
  return _withIo(io => io.exportPNG(chartId));
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
async function renderResults(rawResults, req, activeUnits = unitSystem) {
  const sys     = normalizeUnitSystem(activeUnits);
  const results = await renderCharts(rawResults, req, { onExportPNG: exportPNG, unitSystem: sys });

  // PERF-22: defer hidden-tab Data Table and DOPE card renders until their tab activates
  setTablePendingResults(results, sys);
  _pendingDopeReq = req;
  _dopeDirty = true;

  if (document.getElementById('dataPanel')?.classList.contains('active')) {
    clearTableDirty();
    renderTable(results, sys);
  }
  if (document.getElementById('toolsPanel')?.classList.contains('active')) {
    try {
      const toolsMod = await _ensureToolsLoaded();
      _dopeDirty = false;
      toolsMod.renderDopeCard(results, req, sys);
      toolsMod.renderMpbrTool(results, sys);
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
        toolsMod.renderDopeCard(pendingResults, _pendingDopeReq, unitSystem);
        toolsMod.renderMpbrTool(pendingResults, unitSystem);
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
    unitSystem,
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
    unitSystem,
  }));
}

// ── URL state sharing ─────────────────────────────────────────────────────────
function currentState() {
  const get = id => document.getElementById(id);
  const latVal   = get('latitudeDeg')?.value;
  const azVal    = get('azimuthDeg')?.value;
  const pressEl  = get('pressureHpa');
  const pressVal = pressEl && pressEl.value !== ''
    ? readMetricInputValue(pressEl, 'pressure', unitSystem)
    : undefined;
  const humVal   = get('humidityPercent')?.value;
  const eotvosOn = Boolean(get('includeEotvos')?.checked);
  const clickVal = get('clickValue')?.value;
  const clickCustomVal = Number(get('clickValueCustom')?.value);
  const mvSensRaw = readMetricInputValue(get('mvSens'), 'mvSens', unitSystem, 0);
  const mvSensVal = Math.round(mvSensRaw * 1000) / 1000;
  /* istanbul ignore next -- each element is always present in the app shell */
  return {
    bulletIds:   [...selectedIds],
    zero:        readMetricInputValue(get('zeroRange'),   'range',       unitSystem, PREF_DEFAULTS.zero),
    maxRange:    readMetricInputValue(get('maxRange'),    'range',       unitSystem, PREF_DEFAULTS.maxRange),
    wind:        readMetricInputValue(get('windSpeed'),   'windSpeed',   unitSystem, PREF_DEFAULTS.wind),
    windDir:     +(get('windDir')?.value       ?? PREF_DEFAULTS.windDir),
    altitude:    readMetricInputValue(get('altitude'),    'altitude',    unitSystem, PREF_DEFAULTS.altitude),
    temp:        readMetricInputValue(get('temperature'), 'temp',        unitSystem, PREF_DEFAULTS.temp),
    step:        readMetricInputValue(get('step'),        'step',        unitSystem, PREF_DEFAULTS.step),
    sightHeight: readMetricInputValue(get('sightHeight'), 'sightHeight', unitSystem, PREF_DEFAULTS.sightHeight),
    angle:       +(get('shootingAngle')?.value ?? PREF_DEFAULTS.angle),
    dragModel:     get('dragModel')?.value     ?? PREF_DEFAULTS.dragModel,
    units:       unitSystem,
    ...(latVal !== undefined && latVal !== '' ? { latitudeDeg: +latVal } : {}),
    ...(azVal  !== undefined && azVal  !== '' ? { azimuthDeg:  +azVal  } : {}),
    ...(pressVal !== undefined ? { pressureHpa: pressVal } : {}),
    ...(humVal !== undefined && humVal !== '' ? { humidityPercent: +humVal } : {}),
    ...(mvSensVal ? { mvSens: mvSensVal } : {}),
    ...(eotvosOn ? { includeEotvos: true } : {}),
    ...(clickVal ? { clickValue: clickVal } : {}),
    ...(clickVal === 'custom' && clickCustomVal > 0 && clickCustomVal <= 100 ? { clickValueCustom: clickCustomVal } : {}),
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

// ── Rifle profiles & input helpers (ENH-5) ────────────────────────────────────
function _setInputVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function _setMetricInputVal(id, kind, val) {
  const el = document.getElementById(id);
  if (el) {
    writeMetricInputValue(el, kind, val, unitSystem);
    el.dataset.unitApplied = unitSystem;
  }
}

function _renderProfileSelect(selectedName = '') {
  const select = document.getElementById('profileSelect');
  const delBtn = document.getElementById('deleteProfileBtn');
  if (!select) return;
  const profiles = loadProfiles();
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Saved profiles —';
  select.appendChild(placeholder);
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  }
  select.value = profiles.some(p => p.name === selectedName) ? selectedName : '';
  /* istanbul ignore else -- #deleteProfileBtn is always present with #profileSelect */
  if (delBtn) delBtn.disabled = !select.value;
}

async function _applyProfile(profile) {
  const p = profile.params;
  if (p.units && p.units !== unitSystem) {
    await setUnitSystem(p.units, { persist: true });
  }
  _setMetricInputVal('zeroRange',   'range',       p.zero);
  _setMetricInputVal('maxRange',    'range',       p.maxRange);
  _setMetricInputVal('windSpeed',   'windSpeed',   p.wind);
  _setInputVal('windDir',           String(p.windDir));
  _setMetricInputVal('altitude',    'altitude',    p.altitude);
  _setMetricInputVal('temperature', 'temp',        p.temp);
  _setMetricInputVal('step',        'step',        p.step);
  _setMetricInputVal('sightHeight', 'sightHeight', p.sightHeight);
  _setInputVal('shootingAngle',     String(p.angle));
  _setInputVal('dragModel',         p.dragModel);
  if (p.clickValue != null) {
    _setInputVal('clickValue',       p.clickValue);
    _setInputVal('clickValueCustom', String(p.clickValueCustom ?? 0.25));
    syncClickCustomVisibility();
    document.getElementById('clickValue')?.dispatchEvent(new Event('change'));
  }
  _setInputVal('twistRate',         p.twistRate != null ? String(p.twistRate) : '');
  _setInputVal('latitudeDeg',       p.latitudeDeg != null ? String(p.latitudeDeg) : '');
  _setInputVal('azimuthDeg',        p.azimuthDeg != null ? String(p.azimuthDeg) : '');
  _setMetricInputVal('pressureHpa', 'pressure',    p.pressureHpa ?? null);
  _setMetricInputVal('mvSens',      'mvSens',      p.mvSens ?? 0);
  _setInputVal('humidityPercent',   p.humidityPercent != null ? String(p.humidityPercent) : '');
  const eotvosEl = document.getElementById('includeEotvos');
  /* istanbul ignore else -- #includeEotvos is always present in the app shell */
  if (eotvosEl) eotvosEl.checked = Boolean(p.includeEotvos);

  const validIds = p.bulletIds.filter(id => _bulletById.has(id)).slice(0, MAX_SELECTED_BULLETS);
  selectedIds = new Set(validIds);
  updateBulletCards();
  updateSweepButtonVisibility();

  const nameInput = document.getElementById('profileNameInput');
  /* istanbul ignore else -- #profileNameInput is always present in the app shell */
  if (nameInput) nameInput.value = profile.name;
  const delBtn = document.getElementById('deleteProfileBtn');
  /* istanbul ignore else -- #deleteProfileBtn is always present in the app shell */
  if (delBtn) delBtn.disabled = false;

  savePrefs();
  syncUrl();
  if (_isAutoComputeEnabled() && selectedIds.size > 0) _scheduleAutoCompute();
  showToast('Profile loaded');
}

// ── Init ──────────────────────────────────────────────────────────────────────
let _initListenerController = null;

function _renderRecentPanel() {
  const details = document.getElementById('recentCombos');
  /* istanbul ignore next -- #recentCombos is always present in the app shell */
  if (!details) return;
  const combos = loadRecentCombos();
  if (combos.length === 0) {
    details.setAttribute('hidden', '');
    return;
  }
  details.removeAttribute('hidden');
  const summary = details.querySelector('summary');
  /* istanbul ignore else -- summary is always present inside #recentCombos */
  if (summary) summary.textContent = `Recent (${combos.length})`;
  const list = details.querySelector('.recent-combo-list');
  /* istanbul ignore next -- .recent-combo-list is always present inside #recentCombos */
  if (!list) return;
  list.innerHTML = '';
  for (const c of combos) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'recent-combo-btn';
    btn.type = 'button';
    btn.textContent = c.names.join(' · ');
    btn.dataset.ids = JSON.stringify(c.ids);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

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
  unitSystem = normalizeUnitSystem(fromUrl.params.units ?? loadUnitSystem());
  setUnitSystemState(unitSystem);
  _syncUnitToggleUI(unitSystem);
  const merged  = { ...loadPrefs(), ...fromUrl.params };
  _setMetricInputVal('zeroRange',   'range',       merged.zero);
  _setMetricInputVal('maxRange',    'range',       merged.maxRange);
  _setMetricInputVal('windSpeed',   'windSpeed',   merged.wind);
  _setInputVal('windDir',           merged.windDir);
  _setMetricInputVal('altitude',    'altitude',    merged.altitude);
  _setMetricInputVal('temperature', 'temp',        merged.temp);
  _setMetricInputVal('step',        'step',        merged.step);
  _setMetricInputVal('sightHeight', 'sightHeight', merged.sightHeight);
  _setInputVal('shootingAngle',     merged.angle);
  _setInputVal('dragModel',         merged.dragModel);
  _setInputVal('clickValue',        merged.clickValue);
  _setInputVal('clickValueCustom',  merged.clickValueCustom);
  syncClickCustomVisibility();
  _setMetricInputVal('mvSens',      'mvSens',      merged.mvSens);
  if (fromUrl.params.pressureHpa     != null) _setMetricInputVal('pressureHpa', 'pressure', fromUrl.params.pressureHpa);
  if (fromUrl.params.humidityPercent != null) _setInputVal('humidityPercent', fromUrl.params.humidityPercent);
  const eotvosEl = document.getElementById('includeEotvos');
  if (eotvosEl && fromUrl.params.includeEotvos != null) eotvosEl.checked = Boolean(fromUrl.params.includeEotvos);

  for (const [id, kind] of Object.entries(ALL_UNIT_INPUTS)) {
    if (PREF_UNIT_INPUT_IDS.has(id)) continue;
    const el = document.getElementById(id);
    if (!el || el.value === '') continue;
    const prevSys = el.dataset.unitApplied || UNIT_SYSTEMS.METRIC;
    if (prevSys !== unitSystem) {
      const m = readMetricInputValue(el, kind, prevSys);
      writeMetricInputValue(el, kind, m, unitSystem);
      el.dataset.unitApplied = unitSystem;
    }
  }

  // UX-1: Migrate legacy custom-round presets once, then load and merge custom bullets
  {
    const builtIn = getBuiltInBullets();
    migrateLegacyCustomRounds(builtIn.map(b => b.name));
    const { records, status } = loadCustomBullets();
    customRecords       = records;
    customStorageStatus = status;
    if (status === 'corrupt') {
      console.warn('Custom bullets: stored data was invalid and has been ignored');
    }
    bullets = mergeCatalog(builtIn, customRecords);
  }
  _syncBulletIndex(bullets);

  // F5: one-time re-truing notice for (trued) and (trued-BC) bullets
  {
    let noticeKey;
    try { noticeKey = localStorage.getItem('bv_physicsNotice'); } catch (_) { noticeKey = 'adr011'; }
    if (noticeKey !== 'adr011') {
      const truedRecords = customRecords.filter(r => /\(trued(?:-BC)?\)/i.test(r.name));
      if (truedRecords.length === 0) {
        try { localStorage.setItem('bv_physicsNotice', 'adr011'); } catch (_) { /* ignore */ }
      } else {
        const noticeEl = document.getElementById('physicsNotice');
        /* istanbul ignore else -- #physicsNotice is always present in the app shell */
        if (noticeEl) {
          const shown = truedRecords.slice(0, 10);
          const overflow = truedRecords.length - shown.length;
          const msgEl = document.createElement('span');
          msgEl.textContent = 'Drag physics were corrected in this version. These trued bullets were calculated with the old model — re-run MV/BC truing to update them:';
          const listEl = document.createElement('ul');
          shown.forEach(r => {
            const li = document.createElement('li');
            li.textContent = r.name;
            listEl.appendChild(li);
          });
          if (overflow > 0) {
            const li = document.createElement('li');
            li.textContent = `…and ${overflow} more`;
            listEl.appendChild(li);
          }
          const dismissBtn = document.createElement('button');
          dismissBtn.type = 'button';
          dismissBtn.id = 'physicsNoticeDismiss';
          dismissBtn.textContent = 'Got it';
          dismissBtn.addEventListener('click', () => {
            try { localStorage.setItem('bv_physicsNotice', 'adr011'); } catch (_) { /* ignore */ }
            noticeEl.hidden = true;
            const focusTarget = document.getElementById('addCustomBulletBtn') ?? document.body;
            focusTarget.focus();
          }, { signal });
          noticeEl.textContent = '';
          noticeEl.appendChild(msgEl);
          noticeEl.appendChild(listEl);
          noticeEl.appendChild(dismissBtn);
          noticeEl.hidden = false;
        }
      }
    }
  }

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
        const firstBuiltIn = getBuiltInBullets()[0];
        /* istanbul ignore next -- getBuiltInBullets() always returns ≥1 bullet in tests */
        if (firstBuiltIn) selectedIds.add(firstBuiltIn.id);
      }
    }
  }
  renderBulletList();
  _syncCustomPanelAvailability();
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
    'zeroRange','maxRange','windSpeed','windDir','altitude','pressureHpa','temperature','humidityPercent',
    'step','sightHeight','mvSens','shootingAngle','dragModel','twistRate','latitudeDeg','azimuthDeg','includeEotvos',
  ];
  // Click-size changes persist but never trigger a recompute (DOPE re-renders itself)
  ['clickValue', 'clickValueCustom'].forEach(id => {
    const el = document.getElementById(id);
    /* istanbul ignore next -- both click inputs are always present in the app shell */
    if (!el) return;
    el.addEventListener('input', _persistInputs, { signal });
    el.addEventListener('change', _persistInputs, { signal });
  });
  autoParamIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const onParamChange = () => {
      delete el.dataset.canonicalMetric;
      delete el.dataset.renderedDisplay;
      _persistInputs();
      if (_isAutoComputeEnabled() && selectedIds.size > 0) _scheduleAutoCompute();
    };
    el.addEventListener('input', onParamChange, { signal });
    el.addEventListener('change', onParamChange, { signal });
  });
  document.getElementById('dragModel')?.addEventListener('change', () => {
    syncModelPill(document.getElementById('dragModel').value);
  }, { signal });
  window.addEventListener('pagehide', () => _persistInputs.flush(), { signal });
  document.getElementById('unitToggle')?.addEventListener('click', () => {
    toggleUnitSystem();
  }, { signal });

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
  document.getElementById('recentCombos')?.addEventListener('click', e => {
    const btn = e.target.closest('.recent-combo-btn');
    if (!btn) return;
    let ids;
    try { ids = JSON.parse(btn.dataset.ids ?? '[]'); } catch (_) { return; }
    if (!Array.isArray(ids)) return;
    clearSelection();
    for (const id of ids) {
      if (_bulletById.has(id)) toggleBullet(id);
    }
  }, { signal });

  // Static event listeners
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportTrajectoryCSV, { signal });
  document.querySelector('.export-csv-btn')?.addEventListener('click', exportCSV, { signal });
  document.querySelector('.export-json-btn')?.addEventListener('click', exportJSON, { signal });
  document.querySelector('.export-md-btn')?.addEventListener('click', exportMarkdown, { signal });
  document.getElementById('importJsonBtn')?.addEventListener('click', () => {
    document.getElementById('importJsonFile')?.click();
  }, { signal });
  document.getElementById('importJsonFile')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    importResultsFromFile(file);
    e.target.value = '';
  }, { signal });
  document.querySelector('.export-toggle')?.addEventListener('click', function() {
    this.closest('.export-dropdown')?.classList.toggle('open');
  }, { signal });
  document.addEventListener('click', e => {
    if (!e.target.closest('.export-dropdown')) {
      document.querySelectorAll('.export-dropdown.open')
        .forEach(d => d.classList.remove('open'));
    }
  }, { signal });
  document.getElementById('copyLinkBtn')?.addEventListener('click', copyLink, { signal });

  document.querySelector('#dataTable thead')?.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort-key]');
    if (th) onSortHeaderClick(th.dataset.sortKey);
  }, { signal });

  // Mobile drawer & tabs
  document.getElementById('paramsToggle')?.addEventListener('click', openSidebar, { signal });
  document.getElementById('sidebarBackdrop')?.addEventListener('click', closeSidebar, { signal });
  document.getElementById('tab-charts')?.addEventListener('click', function() { switchTab('charts', this); }, { signal });
  document.getElementById('tab-data')?.addEventListener('click', function() { switchTab('data', this); }, { signal });
  document.getElementById('tab-tools')?.addEventListener('click', function() { switchTab('tools', this); }, { signal });

  if (fromUrl.recognized) syncUrl();

  // MH-4: Sweep controls (lazy-loads app/sweep.js on interaction)
  updateSweepButtonVisibility();
  document.getElementById('sweepParam')?.addEventListener('change', () => { _loadSweep().catch(() => {}); }, { signal });
  document.getElementById('sweepBtn')?.addEventListener('click', runSweep, { signal });
  document.getElementById('clearSweepBtn')?.addEventListener('click', clearSweep, { signal });

  // ENH-5: Wire rifle profiles bar
  _renderProfileSelect();
  document.getElementById('profileSelect')?.addEventListener('change', async e => {
    const name = e.target.value;
    const delBtn = document.getElementById('deleteProfileBtn');
    /* istanbul ignore else -- #deleteProfileBtn is always present in the app shell */
    if (delBtn) delBtn.disabled = !name;
    if (!name) return;
    const match = loadProfiles().find(p => p.name === name);
    /* istanbul ignore else -- selected option always corresponds to a saved profile */
    if (match) await _applyProfile(match);
  }, { signal });
  document.getElementById('saveProfileBtn')?.addEventListener('click', () => {
    const nameInput = document.getElementById('profileNameInput');
    const select    = document.getElementById('profileSelect');
    const name      = (nameInput?.value ?? '').trim() || select?.value || '';
    const twistRaw  = document.getElementById('twistRate')?.value;
    const clickValue = document.getElementById('clickValue')?.value;
    const clickCustom = Number(document.getElementById('clickValueCustom')?.value);
    const params    = {
      ...currentState(),
      ...(clickValue ? { clickValue, clickValueCustom: clickCustom > 0 ? clickCustom : 0.25 } : {}),
      ...(twistRaw ? { twistRate: +twistRaw } : {}),
    };
    const res = saveProfile(name, params);
    if (!res.ok) {
      showToast(res.message);
      return;
    }
    /* istanbul ignore else -- #profileNameInput is always present in the app shell */
    if (nameInput) nameInput.value = res.profile.name;
    _renderProfileSelect(res.profile.name);
    showToast(res.replaced ? 'Profile updated' : 'Profile saved');
  }, { signal });
  document.getElementById('deleteProfileBtn')?.addEventListener('click', () => {
    const select = document.getElementById('profileSelect');
    const name   = select?.value;
    if (!name) return;
    const res = deleteProfile(name);
    if (!res.ok) {
      showToast("Couldn't delete profile: browser storage unavailable.");
      return;
    }
    _renderProfileSelect('');
    const nameInput = document.getElementById('profileNameInput');
    /* istanbul ignore else -- #profileNameInput is always present in the app shell */
    if (nameInput) nameInput.value = '';
    showToast('Profile deleted');
  }, { signal });

  // UX-1 + ENH-5: Wire custom bullet form and unified drag CSV input
  document.getElementById('addCustomBulletBtn')?.addEventListener('click', openCustomBulletAdd, { signal });
  document.getElementById('customBulletCancelBtn')?.addEventListener('click', closeCustomBulletForm, { signal });
  document.getElementById('cbDragCsv')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    await _readDragCsvFile(file, {
      onSuccess(table) {
        _cbPendingDragTable = table;
        _cbPendingDragName  = file.name;
        _syncCbDragCsvUI('');
      },
      onError(msg) {
        _cbPendingDragTable = null;
        _cbPendingDragName  = '';
        _syncCbDragCsvUI(msg);
      },
    });
  }, { signal });
  document.getElementById('cbDragCsvClearBtn')?.addEventListener('click', () => {
    _cbPendingDragTable = null;
    _cbPendingDragName  = '';
    _syncCbDragCsvUI('');
  }, { signal });
  document.getElementById('customBulletForm')?.addEventListener('submit', e => {
    e.preventDefault();
    _handleCustomBulletSubmit();
  }, { signal });

  // UX-9: Theme toggle
  initThemeToggle();

  // Pin button toggles crosshair lock
  document.getElementById('readoutPin')?.addEventListener('click', toggleReadoutPin, { signal });

  if (_isAutoComputeEnabled() && selectedIds.size > 0) _scheduleAutoCompute();
}

// ── Custom bullet panel availability sync ─────────────────────────────────────
function _syncCustomPanelAvailability() {
  const addBtn = document.getElementById('addCustomBulletBtn');
  /* istanbul ignore else -- #addCustomBulletBtn is always present in the app shell */
  if (addBtn) addBtn.disabled = customStorageStatus === 'unavailable';
}

// ── Custom bullet form handlers ───────────────────────────────────────────────

function _syncCbDragCsvUI(errMsg) {
  const statusEl = document.getElementById('cbDragCsvStatus');
  const nameEl   = document.getElementById('cbDragCsvName');
  const errEl    = document.getElementById('cbDragCsv-error');
  const fileEl   = document.getElementById('cbDragCsv');
  /* istanbul ignore else -- #cbDragCsv-error is always present in the app shell */
  if (errEl) errEl.textContent = errMsg;
  /* istanbul ignore else -- #cbDragCsvStatus is always present in the app shell */
  if (statusEl) {
    if (_cbPendingDragTable) statusEl.removeAttribute('hidden');
    else statusEl.setAttribute('hidden', '');
  }
  /* istanbul ignore else -- #cbDragCsvName is always present in the app shell */
  if (nameEl) {
    nameEl.textContent = _cbPendingDragTable
      ? (_cbPendingDragName
        ? `${_cbPendingDragName} (${_cbPendingDragTable.length} rows) — uses sectional density, not BC.`
        : `Custom curve (${_cbPendingDragTable.length} rows) — uses sectional density, not BC.`)
      : '';
  }
  /* istanbul ignore else -- #cbDragCsv is always present in the app shell */
  if (!_cbPendingDragTable && fileEl) fileEl.value = '';
}

/** Open form in add mode. */
export function openCustomBulletAdd() {
  pendingDeleteId = null;
  editingCustomId = null;
  _cbPendingDragTable = null;
  _cbPendingDragName  = '';
  _syncCbDragCsvUI('');
  const form = document.getElementById('customBulletForm');
  const title = document.getElementById('customBulletFormTitle');
  /* istanbul ignore else -- #customBulletForm is always present in the app shell */
  if (form) {
    form.removeAttribute('hidden');
    ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7','cbBcG5',
     'cbBulletDiameterInches','cbMuzzleVelocityFps'].forEach(id => {
      const el = document.getElementById(id);
      /* istanbul ignore else -- field inputs are always present in the app shell */
      if (el) { el.value = ''; el.removeAttribute('aria-invalid'); }
    });
    ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7','cbBcG5',
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
  _cbPendingDragTable = record.customDragTable
    ? record.customDragTable.map(p => ({ mach: p.mach, cd: p.cd }))
    : null;
  _cbPendingDragName = '';
  _syncCbDragCsvUI('');
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
    set('cbBcG5',                 record.ballisticCoefficientG5 != null ? String(record.ballisticCoefficientG5) : '');
    set('cbBulletDiameterInches', String(record.bulletDiameterInches));
    set('cbMuzzleVelocityFps',    String(record.muzzleVelocityFps));
    ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7','cbBcG5',
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
  _cbPendingDragTable = null;
  _cbPendingDragName  = '';
  _syncCbDragCsvUI('');
  const form   = document.getElementById('customBulletForm');
  const addBtn = document.getElementById('addCustomBulletBtn');
  /* istanbul ignore else -- #customBulletForm is always present in the app shell */
  if (form)   form.setAttribute('hidden', '');
  /* istanbul ignore else -- #addCustomBulletBtn is always present in the app shell */
  if (addBtn) {
    addBtn.setAttribute('aria-expanded', 'false');
    addBtn.focus();
  }
  ['cbName','cbShortName','cbBulletWeightGrains','cbBcG1','cbBcG7','cbBcG5',
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
  bullets        = mergeCatalog(getBuiltInBullets(), customRecords);
  _syncBulletIndex(bullets);
  pendingDeleteId = null;

  if (editingCustomId === id) closeCustomBulletForm();

  renderBulletList();
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
    ballisticCoefficientG5: getVal('cbBcG5'),
    bulletDiameterInches:   getVal('cbBulletDiameterInches'),
    muzzleVelocityFps:      getVal('cbMuzzleVelocityFps'),
  };

  const result = validateCustomBulletInput(raw, {
    records:      customRecords,
    builtInNames: getBuiltInBullets().map(b => b.name),
    editingId:    editingCustomId,
  });

  const fieldOrder = ['name','shortName','bulletWeightGrains','ballisticCoefficientG1',
                      'ballisticCoefficientG7','ballisticCoefficientG5','bulletDiameterInches','muzzleVelocityFps'];
  const inputIdMap = {
    name:                   'cbName',
    shortName:              'cbShortName',
    bulletWeightGrains:     'cbBulletWeightGrains',
    ballisticCoefficientG1: 'cbBcG1',
    ballisticCoefficientG7: 'cbBcG7',
    ballisticCoefficientG5: 'cbBcG5',
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

    const errorFields = new Set();
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
        errorFields.add(field);
      }
    });
    const firstField = fieldOrder.find(f => errorFields.has(f));
    if (firstField) document.getElementById(inputIdMap[firstField])?.focus();
    return;
  }

  const isEditing  = editingCustomId != null;
  const payload    = { ...result.value, customDragTable: _cbPendingDragTable };
  const next       = upsertCustomBullet(customRecords, payload, editingCustomId);
  const saveResult = saveCustomBullets(next);
  if (!saveResult.ok) {
    const formErrEl = document.getElementById('customBulletFormError');
    /* istanbul ignore else -- #customBulletFormError is always present in the app shell */
    if (formErrEl) formErrEl.textContent = "Couldn't save: browser storage is full or unavailable.";
    return;
  }

  customRecords = next;
  bullets       = mergeCatalog(getBuiltInBullets(), customRecords);
  _syncBulletIndex(bullets);
  closeCustomBulletForm();
  renderBulletList();
  showToast(isEditing ? 'Custom bullet updated' : 'Custom bullet added');
}

// ── State helpers (for test access) ──────────────────────────────────────────
function _getState() {
  return {
    bullets, _bulletById, selectedIds, lastResults, lastReq, unitSystem,
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
  unitSystem = UNIT_SYSTEMS.METRIC;
  setUnitSystemState(UNIT_SYSTEMS.METRIC);
  _cbPendingDragTable = null;
  _cbPendingDragName  = '';
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
  getBuiltInBullets, computeClientSide,
  MAX_SELECTED_BULLETS,
  renderBulletList, toggleBullet, updateBulletCards, clearSelection, filterBulletList, syncSelectionMeta, runSimulation,
  _scheduleAutoCompute,
  renderResults, switchTab, init,
  exportTrajectoryCSV,
  exportCSV, exportJSON, exportMarkdown, exportPNG, importResultsFromFile,
  openSidebar, closeSidebar,
  currentState, syncUrl, copyLink,
  updateSweepButtonVisibility, runSweep, clearSweep, renderSweepCharts, _loadSweep,
  _getState, _resetState, _setBullets, _setSelectedIds, _setLastResults,
  _loadIo, _loadTools, _loadDragCsv,
  debounce,
  _setCustomRecords, _setCustomStorageStatus,
  _renderRecentPanel,
  initThemeToggle,
  setUnitSystem, toggleUnitSystem,
};
