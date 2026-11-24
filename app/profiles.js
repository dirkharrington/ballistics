// ── Named Rifle / Load Profiles (ENH-5 / DX-2) ────────────────────────────────

import { CLICK_VALUE_IDS } from './clicks.js';

export const PROFILES_STORAGE_KEY = 'ballistics_profiles';
export const MAX_PROFILES         = 20;
export const PROFILE_NAME_MAX     = 64;
const MAX_PROFILE_BULLETS         = 5;

// Forbidden chars: C0/C1 controls and bidi overrides
const FORBIDDEN_CHARS_RE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

const REQUIRED_NUMERIC_RULES = Object.freeze([
  ['zero',        0,    3000,  true ],
  ['maxRange',    0,    5000,  true ],
  ['wind',        0,    200,   false],
  ['windDir',     0,    360,   false],
  ['altitude',    0,    10000, false],
  ['temp',        -50,  60,    false],
  ['step',        0,    500,   true ],
  ['sightHeight', 0,    150,   true ],
  ['angle',       -45,  45,    false],
]);

const OPTIONAL_NUMERIC_RULES = Object.freeze([
  ['twistRate',       1,   100 ],
  ['latitudeDeg',     -90, 90  ],
  ['azimuthDeg',      0,   360 ],
  ['pressureHpa',     500, 1100],
  ['humidityPercent', 0,   100 ],
  ['clickValueCustom', 0.001, 100],
  ['mvSens',          -5.5, 5.5 ],
]);

function _isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function _isFiniteInRange(v, min, max, strictMin) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (strictMin ? !(v > min) : !(v >= min)) return false;
  return v <= max;
}

function _sanitizeParams(raw) {
  if (!_isPlainObject(raw)) return null;
  if (!Array.isArray(raw.bulletIds)) return null;

  const cleanIds = [];
  const seenIds = new Set();
  for (const id of raw.bulletIds) {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 64) return null;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      cleanIds.push(id);
      if (cleanIds.length >= MAX_PROFILE_BULLETS) break;
    }
  }

  if (raw.dragModel !== 'G1' && raw.dragModel !== 'G7' && raw.dragModel !== 'G5') return null;

  const clean = { bulletIds: cleanIds, dragModel: raw.dragModel };

  for (const [key, min, max, strictMin] of REQUIRED_NUMERIC_RULES) {
    const val = raw[key];
    if (!_isFiniteInRange(val, min, max, strictMin)) return null;
    clean[key] = val;
  }

  for (const [key, min, max] of OPTIONAL_NUMERIC_RULES) {
    const val = raw[key];
    if (val != null) {
      if (!_isFiniteInRange(val, min, max, false)) return null;
      clean[key] = val;
    }
  }

  if (raw.includeEotvos != null) {
    if (typeof raw.includeEotvos !== 'boolean') return null;
    clean.includeEotvos = raw.includeEotvos;
  }

  if (raw.clickValue != null) {
    if (!CLICK_VALUE_IDS.includes(raw.clickValue)) return null;
    clean.clickValue = raw.clickValue;
  }

  if (raw.units != null) {
    if (raw.units !== 'metric' && raw.units !== 'imperial') return null;
    clean.units = raw.units;
  }

  return clean;
}

/**
 * Validate a stored profile object against the profile schema.
 * @param {unknown} obj
 * @returns {boolean}
 */
export function isValidProfile(obj) {
  if (!_isPlainObject(obj)) return false;
  if (typeof obj.name !== 'string') return false;
  if (obj.name.trim() !== obj.name) return false;
  if (obj.name.length < 1 || obj.name.length > PROFILE_NAME_MAX) return false;
  if (FORBIDDEN_CHARS_RE.test(obj.name)) return false;
  if (obj.savedAt !== undefined) {
    if (typeof obj.savedAt !== 'string' || obj.savedAt.length > 40 || Number.isNaN(Date.parse(obj.savedAt))) {
      return false;
    }
  }
  return _sanitizeParams(obj.params) !== null;
}

/**
 * Load all valid saved profiles from localStorage.
 * Never throws; returns [] on missing, corrupt, or unavailable storage.
 */
export function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seenNames = new Set();
    const out = [];
    for (const item of parsed) {
      if (!isValidProfile(item)) continue;
      const nameLc = item.name.toLowerCase();
      if (seenNames.has(nameLc)) continue;
      seenNames.add(nameLc);
      const cleanParams = _sanitizeParams(item.params);
      out.push({
        name:   item.name,
        params: cleanParams,
        ...(item.savedAt !== undefined ? { savedAt: item.savedAt } : {}),
      });
      if (out.length >= MAX_PROFILES) break;
    }
    return out;
  } catch (_) {
    return [];
  }
}

/**
 * Save or overwrite (case-insensitive by name) a named rifle profile.
 * @param {string} name
 * @param {object} params
 * @returns {{ ok: boolean, error?: string, message?: string, profile?: object, replaced?: boolean, profiles?: object[] }}
 */
export function saveProfile(name, params) {
  if (typeof name !== 'string') {
    return { ok: false, error: 'invalid', message: 'Profile name is required.' };
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: 'invalid', message: 'Profile name is required.' };
  }
  if (trimmed.length > PROFILE_NAME_MAX) {
    return { ok: false, error: 'invalid', message: `Profile name must be ${PROFILE_NAME_MAX} characters or fewer.` };
  }
  if (FORBIDDEN_CHARS_RE.test(trimmed)) {
    return { ok: false, error: 'invalid', message: 'Profile name contains invalid characters.' };
  }

  const cleanParams = _sanitizeParams(params);
  if (!cleanParams) {
    return { ok: false, error: 'invalid', message: 'Profile parameters are invalid.' };
  }

  const existing = loadProfiles();
  const nameLc = trimmed.toLowerCase();
  const replaceIdx = existing.findIndex(p => p.name.toLowerCase() === nameLc);

  let profiles;
  let replaced = false;
  const profile = {
    name:    trimmed,
    params:  cleanParams,
    savedAt: new Date().toISOString(),
  };

  if (replaceIdx !== -1) {
    profiles = [profile, ...existing.filter((_, i) => i !== replaceIdx)];
    replaced = true;
  } else {
    if (existing.length >= MAX_PROFILES) {
      return { ok: false, error: 'full', message: `Profile limit reached (${MAX_PROFILES}). Delete one to save another.` };
    }
    profiles = [profile, ...existing];
  }

  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch (_) {
    return { ok: false, error: 'storage', message: 'Browser storage unavailable.' };
  }

  return { ok: true, profile, replaced, profiles };
}

/**
 * Delete a named profile (case-insensitive match).
 * @param {string} name
 * @returns {{ ok: boolean, deleted?: boolean, error?: string, profiles: object[] }}
 */
export function deleteProfile(name) {
  const existing = loadProfiles();
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: true, deleted: false, profiles: existing };
  }
  const nameLc = name.trim().toLowerCase();
  const filtered = existing.filter(p => p.name.toLowerCase() !== nameLc);
  if (filtered.length === existing.length) {
    return { ok: true, deleted: false, profiles: existing };
  }
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(filtered));
  } catch (_) {
    return { ok: false, error: 'storage', profiles: existing };
  }
  return { ok: true, deleted: true, profiles: filtered };
}
