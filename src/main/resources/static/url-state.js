/** URL key for each state field. Order = canonical serialization order. */
export const URL_PARAM_KEYS = Object.freeze([
  'zero', 'maxRange', 'wind', 'windDir', 'altitude', 'temp', 'step', 'sightHeight', 'angle', 'dragModel',
]);
export const URL_BULLET_KEY = 'b';
export const MAX_URL_BULLETS = 20;

const OWNED_KEYS = new Set([URL_BULLET_KEY, ...URL_PARAM_KEYS]);

const NUM_RE = /^-?\d{1,5}(\.\d{1,3})?$/;
const BULLET_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const VALID_WIND_DIRS = new Set([0, 45, 90, 135, 180, 225, 270, 315]);

function parseNum(raw) {
  if (!NUM_RE.test(raw)) return null;
  return Number(raw);
}

const VALIDATORS = {
  zero:        v => v > 0 && v <= 3000,
  maxRange:    v => v > 0 && v <= 5000,
  wind:        v => v >= 0 && v <= 200,
  windDir:     v => VALID_WIND_DIRS.has(v),
  altitude:    v => v >= 0 && v <= 10000,
  temp:        v => v >= -50 && v <= 60,
  step:        v => v > 0 && v <= 500,
  sightHeight: v => v > 0 && v <= 150,
  angle:       v => v >= -45 && v <= 45,
  dragModel:   v => v === 'G1' || v === 'G7',
};

/**
 * Serialize state to a query string WITHOUT the leading '?'.
 * @param {object} state
 * @returns {string}
 */
export function encodeState(state) {
  const params = new URLSearchParams();
  const ids = [...new Set(state.bulletIds)].slice(0, MAX_URL_BULLETS);
  ids.forEach(id => params.append(URL_BULLET_KEY, id));
  for (const key of URL_PARAM_KEYS) {
    const val = state[key];
    if (key === 'dragModel') {
      params.set(key, String(val));
    } else {
      params.set(key, String(Number(val)));
    }
  }
  return params.toString();
}

/**
 * Parse a location.search string ('' or '?…'). Never throws.
 * @param {string} search
 * @returns {{ params: object, bulletIds: string[] | null, recognized: boolean }}
 */
export function decodeState(search) {
  const qs = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(qs);
  const result = { params: {}, bulletIds: null, recognized: false };

  if (params.has(URL_BULLET_KEY)) result.recognized = true;

  const rawBullets = params.getAll(URL_BULLET_KEY);
  if (rawBullets.length > 0) {
    const seen = new Set();
    const valid = [];
    for (const id of rawBullets) {
      if (BULLET_ID_RE.test(id) && !seen.has(id)) {
        seen.add(id);
        valid.push(id);
        if (valid.length >= MAX_URL_BULLETS) break;
      }
    }
    result.bulletIds = valid.length > 0 ? valid : null;
  }

  for (const key of URL_PARAM_KEYS) {
    if (!params.has(key)) continue;
    result.recognized = true;
    const raw = params.get(key);
    if (key === 'dragModel') {
      if (VALIDATORS.dragModel(raw)) result.params[key] = raw;
    } else {
      const num = parseNum(raw);
      if (num !== null && VALIDATORS[key](num)) result.params[key] = num;
    }
  }

  return result;
}

/**
 * Merge an encoded state into an existing search string.
 * @param {string} existingSearch
 * @param {object} state
 * @returns {string}
 */
export function mergeIntoSearch(existingSearch, state) {
  const qs = existingSearch.startsWith('?') ? existingSearch.slice(1) : existingSearch;
  const existing = new URLSearchParams(qs);
  const result = new URLSearchParams();
  for (const [k, v] of existing) {
    if (!OWNED_KEYS.has(k)) result.append(k, v);
  }
  const encoded = new URLSearchParams(encodeState(state));
  for (const [k, v] of encoded) result.append(k, v);
  return result.toString();
}
