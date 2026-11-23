// ── Preferences, theme, storage, and DOM feedback helpers ─────────────────────
import { normalizeUnitSystem, readMetricInputValue } from './units.js';

/** Keys used in localStorage (all prefixed `bv_`). */
export const PREF_KEYS = {
  selectedIds:   'bv_selectedIds',
  zero:          'bv_zero',
  maxRange:      'bv_maxRange',
  wind:          'bv_wind',
  windDir:       'bv_windDir',
  altitude:      'bv_altitude',
  temp:          'bv_temp',
  step:          'bv_step',
  sightHeight:   'bv_sightHeight',
  angle:         'bv_angle',
  dragModel:     'bv_dragModel',
  clickValue:    'bv_clickValue',
  clickValueCustom: 'bv_clickValueCustom',
  mvSens:        'bv_mvSens',
  recentCombos:  'bv_recentCombos',
};

/** Default values when a key is absent from storage. */
export const PREF_DEFAULTS = {
  selectedIds: null,   // null = first visit → select built-in bullets[0]
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
  clickValue:  '0.25moa', // scope click size preset (DOPE card)
  clickValueCustom: 0.25, // custom click size in MOA
  mvSens:      0,     // MV temperature sensitivity, m/s per °C (canonical metric)
};

/** Maps PREF_DEFAULTS keys to their DOM input element IDs (selectedIds has no input). */
export const DOM_ID_FOR_PREF = {
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
  clickValue:  'clickValue',
  clickValueCustom: 'clickValueCustom',
  mvSens:      'mvSens',
};

/** Maps unit-dependent preference keys to their unit kinds in app/units.js. */
const UNIT_KIND_FOR_PREF = Object.freeze({
  zero:        'range',
  maxRange:    'range',
  wind:        'windSpeed',
  altitude:    'altitude',
  temp:        'temp',
  step:        'step',
  sightHeight: 'sightHeight',
  mvSens:      'mvSens',
});

export const AUTO_COMPUTE_KEY = 'ballistics_auto_compute';
export const THEME_KEY = 'bv_theme';

// ── Cached number formatter (PERF-22) ─────────────────────────────────────────
const _numFmt = new Intl.NumberFormat();

/** Format a number using the cached locale formatter. */
export function formatNumber(value) {
  return _numFmt.format(value);
}

// ── Safe localStorage wrappers ────────────────────────────────────────────────

/** Safely read a string from localStorage, returning fallback on error. */
export function safeGetItem(key, fallback = null) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return fallback;
  }
}

/** Safely write a string to localStorage, returning true on success. */
export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

/** Safely remove a key from localStorage, returning true on success. */
export function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

/** Read auto-compute preference (defaults to true unless explicitly `'false'`). */
export function loadAutoComputePref() {
  return safeGetItem(AUTO_COMPUTE_KEY) !== 'false';
}

/** Persist auto-compute preference. */
export function saveAutoComputePref(enabled) {
  return safeSetItem(AUTO_COMPUTE_KEY, String(Boolean(enabled)));
}

// ── HTML escaping & scope adjustments ─────────────────────────────────────────

/** Escape HTML special characters for safe innerHTML interpolation. */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Compute elevation scope adjustment (MOA and MRAD) to bring impact to LoS.
 *   positive = click up  (bullet below LoS, drop < 0)
 *   negative = click down (bullet above LoS, drop > 0)
 */
export function computeAdjustments(dropCm, rangeMeters) {
  if (rangeMeters === 0) return { moa: 0, mrad: 0 };
  const angleRad = Math.atan2(Math.abs(dropCm) / 100, rangeMeters);
  const sign = dropCm < 0 ? 1 : (dropCm > 0 ? -1 : 0);
  return {
    moa:  Math.round(sign * angleRad * (180 / Math.PI) * 60 * 10) / 10,
    mrad: Math.round(sign * angleRad * 1000 * 10) / 10,
  };
}

// ── DOM status & toast notifications ──────────────────────────────────────────

/** Show a transient toast banner at the bottom of the viewport. */
export function showToast(msg) {
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

/** Updates the aria-live status region for screen reader announcements. */
export function _setSimStatus(message) {
  const el = document.getElementById('simStatus');
  /* istanbul ignore next -- #simStatus is always present in the app shell */
  if (!el) return;
  el.textContent = String(message);
}

/** Shows or hides the inline simulation error banner. */
export function _setSimulationError(message) {
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

// ── Preference persistence ────────────────────────────────────────────────────

/**
 * Persist current parameter inputs and selected bullet IDs to localStorage.
 * Wrapped in try/catch: silently degrades in private-browsing or when quota is full.
 */
export function savePrefs(selectedIds = new Set(), cache = null, unitSystem = 'metric') {
  try {
    const sys = normalizeUnitSystem(unitSystem);
    const selJson = JSON.stringify([...selectedIds]);
    if (!cache || cache.get(PREF_KEYS.selectedIds) !== selJson) {
      localStorage.setItem(PREF_KEYS.selectedIds, selJson);
      if (cache) cache.set(PREF_KEYS.selectedIds, selJson);
    }
    for (const k of Object.keys(PREF_DEFAULTS).filter(k => k !== 'selectedIds')) {
      const domId = DOM_ID_FOR_PREF[k];
      /* istanbul ignore next -- null branch only reached when a pref has no DOM element */
      const el = domId ? document.getElementById(domId) : null;
      const kind = UNIT_KIND_FOR_PREF[k];
      const value = (el && kind && sys === 'imperial')
        ? String(readMetricInputValue(el, kind, sys, PREF_DEFAULTS[k]))
        : (el?.value ?? String(PREF_DEFAULTS[k]));
      const storageKey = PREF_KEYS[k];
      if (!cache || cache.get(storageKey) !== value) {
        localStorage.setItem(storageKey, value);
        if (cache) cache.set(storageKey, value);
      }
    }
  } catch (e) {
    console.warn('localStorage unavailable — preferences not saved', e);
  }
}

/**
 * Read persisted preferences from localStorage and return a typed object.
 * Returns defaults for any missing or unparseable entries.
 */
export function loadPrefs() {
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

// ── Theme toggle (UX-9) ───────────────────────────────────────────────────────

/** Update the toggle button label and icon to reflect the current theme. */
export function updateToggleLabel(theme) {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  btn.textContent = theme === 'dark' ? '\u{1F319}' : '☀️';
}

/** Apply a theme ('dark' | 'light') to the document and update toggle/callback. */
export function applyTheme(theme, onThemeApplied = null) {
  document.documentElement.setAttribute('data-theme', theme);
  updateToggleLabel(theme);
  if (typeof onThemeApplied === 'function') onThemeApplied(theme);
}

// ── Recent bullet combinations ─────────────────────────────────────────────────

const MAX_RECENT_COMBOS = 10;

/**
 * Record the current bullet selection as the most-recent combo.
 * bulletMap is Map<id, Bullet> (i.e. _bulletById); names are extracted via .name.
 * Deduplicates by sorted IDs; caps history at MAX_RECENT_COMBOS entries.
 */
export function pushRecentCombo(ids, bulletMap) {
  const names = ids.map(id => bulletMap.get(id)?.name ?? id);
  const sortedKey = [...ids].sort().join('\x00');
  const existing = loadRecentCombos();
  const filtered = existing.filter(e => [...e.ids].sort().join('\x00') !== sortedKey);
  const updated = [{ ids: [...ids], names }, ...filtered].slice(0, MAX_RECENT_COMBOS);
  safeSetItem(PREF_KEYS.recentCombos, JSON.stringify(updated));
}

/**
 * Load and validate the stored recent-combos array.
 * Returns [] on absent key, invalid JSON, non-array, or when every entry is malformed.
 * Silently drops entries that fail validation (wrong types, length mismatch, >5 IDs).
 */
export function loadRecentCombos() {
  const raw = safeGetItem(PREF_KEYS.recentCombos);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(e =>
      e !== null && typeof e === 'object' &&
      Array.isArray(e.ids) && e.ids.length > 0 && e.ids.length <= 5 &&
      e.ids.every(id => typeof id === 'string') &&
      Array.isArray(e.names) && e.names.length === e.ids.length &&
      e.names.every(n => typeof n === 'string')
    );
  } catch (_) {
    return [];
  }
}

/** Wire up the theme toggle button and apply the saved/default theme. */
export function initThemeToggle(onThemeChange = null, { signal } = {}) {
  const savedTheme = safeGetItem(THEME_KEY) || 'dark';
  applyTheme(savedTheme);

  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const opts = signal ? { signal } : undefined;
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    safeSetItem(THEME_KEY, next);
    applyTheme(next, onThemeChange);
  }, opts);
}
