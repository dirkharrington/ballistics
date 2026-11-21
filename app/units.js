// ── Global Metric / Imperial Unit System (ENH-3) ──────────────────────────────

export const UNIT_SYSTEMS = Object.freeze({
  METRIC:   'metric',
  IMPERIAL: 'imperial',
});

export const UNITS_STORAGE_KEY = 'ballistics_units';

export const UNIT_LABELS = Object.freeze({
  range:       Object.freeze({ metric: 'm',    imperial: 'yd'    }),
  drop:        Object.freeze({ metric: 'cm',   imperial: 'in'    }),
  drift:       Object.freeze({ metric: 'cm',   imperial: 'in'    }),
  velocity:    Object.freeze({ metric: 'm/s',  imperial: 'fps'   }),
  windSpeed:   Object.freeze({ metric: 'km/h', imperial: 'mph'   }),
  energy:      Object.freeze({ metric: 'J',    imperial: 'ft·lb' }),
  weight:      Object.freeze({ metric: 'g',    imperial: 'gr'    }),
  altitude:    Object.freeze({ metric: 'm',    imperial: 'ft'    }),
  temp:        Object.freeze({ metric: '°C',   imperial: '°F'    }),
  step:        Object.freeze({ metric: 'm',    imperial: 'yd'    }),
  sightHeight: Object.freeze({ metric: 'mm',   imperial: 'in'    }),
  diameter:    Object.freeze({ metric: 'mm',   imperial: 'in'    }),
  pressure:    Object.freeze({ metric: 'hPa',  imperial: 'inHg'  }),
  vitalZone:   Object.freeze({ metric: 'cm',   imperial: 'in'    }),
});

const M_PER_YARD   = 0.9144;
const CM_PER_INCH  = 2.54;
const M_PER_FOOT   = 0.3048;
const KPH_PER_MPH  = 1.609344;
const J_PER_FTLB   = 1.35582;
const G_PER_GRAIN  = 0.06479891;
const MM_PER_INCH  = 25.4;
const HPA_PER_INHG = 33.8638866667;

function roundN(val, dp) {
  const factor = 10 ** dp;
  return Math.round(val * factor) / factor + 0;
}

const CONVERTERS = {
  range: {
    toImperial: v => roundN(v / M_PER_YARD, 0),
    toMetric:   v => roundN(v * M_PER_YARD, 2),
  },
  step: {
    toImperial: v => roundN(v / M_PER_YARD, 0),
    toMetric:   v => roundN(v * M_PER_YARD, 2),
  },
  drop: {
    toImperial: v => roundN(v / CM_PER_INCH, 1),
    toMetric:   v => roundN(v * CM_PER_INCH, 2),
  },
  drift: {
    toImperial: v => roundN(v / CM_PER_INCH, 1),
    toMetric:   v => roundN(v * CM_PER_INCH, 2),
  },
  vitalZone: {
    toImperial: v => roundN(v / CM_PER_INCH, 1),
    toMetric:   v => roundN(v * CM_PER_INCH, 2),
  },
  velocity: {
    toImperial: v => roundN(v / M_PER_FOOT, 0),
    toMetric:   v => roundN(v * M_PER_FOOT, 2),
  },
  windSpeed: {
    toImperial: v => roundN(v / KPH_PER_MPH, 0),
    toMetric:   v => roundN(v * KPH_PER_MPH, 2),
  },
  energy: {
    toImperial: v => roundN(v / J_PER_FTLB, 0),
    toMetric:   v => roundN(v * J_PER_FTLB, 0),
  },
  weight: {
    toImperial: v => roundN(v / G_PER_GRAIN, 1),
    toMetric:   v => roundN(v * G_PER_GRAIN, 2),
  },
  altitude: {
    toImperial: v => roundN(v / M_PER_FOOT, 0),
    toMetric:   v => roundN(v * M_PER_FOOT, 1),
  },
  temp: {
    toImperial: v => roundN(v * 9 / 5 + 32, 1),
    toMetric:   v => roundN((v - 32) * 5 / 9, 2),
  },
  sightHeight: {
    toImperial: v => roundN(v / MM_PER_INCH, 2),
    toMetric:   v => roundN(v * MM_PER_INCH, 1),
  },
  diameter: {
    toImperial: v => roundN(v / MM_PER_INCH, 3),
    toMetric:   v => roundN(v * MM_PER_INCH, 2),
  },
  pressure: {
    toImperial: v => roundN(v / HPA_PER_INHG, 2),
    toMetric:   v => roundN(v * HPA_PER_INHG, 2),
  },
};

let _activeUnitSystem = UNIT_SYSTEMS.METRIC;

/** Normalize any unit system input to `'metric'` or `'imperial'`. */
export function normalizeUnitSystem(v) {
  return v === UNIT_SYSTEMS.IMPERIAL ? UNIT_SYSTEMS.IMPERIAL : UNIT_SYSTEMS.METRIC;
}

/** Return the active module-level unit system (`'metric'` | `'imperial'`). */
export function getUnitSystem() {
  return _activeUnitSystem;
}

/** Update the active module-level unit system without touching localStorage. */
export function setUnitSystemState(unitSystem) {
  _activeUnitSystem = normalizeUnitSystem(unitSystem);
  return _activeUnitSystem;
}

/** Look up the display unit label for `kind` in `unitSystem`. */
export function unitLabel(kind, unitSystem = UNIT_SYSTEMS.METRIC) {
  const sys = normalizeUnitSystem(unitSystem);
  return UNIT_LABELS[kind]?.[sys] ?? '';
}

/** Convert a canonical metric numeric value to display units with sensible rounding. */
export function toDisplay(kind, metricVal, unitSystem = UNIT_SYSTEMS.METRIC) {
  if (typeof metricVal !== 'number' || !Number.isFinite(metricVal)) return metricVal;
  if (normalizeUnitSystem(unitSystem) === UNIT_SYSTEMS.METRIC) return metricVal;
  const conv = CONVERTERS[kind];
  return conv ? conv.toImperial(metricVal) : metricVal;
}

/** Convert a display numeric value back to canonical metric units. */
export function fromDisplay(kind, displayVal, unitSystem = UNIT_SYSTEMS.METRIC) {
  if (typeof displayVal !== 'number' || !Number.isFinite(displayVal)) return displayVal;
  if (normalizeUnitSystem(unitSystem) === UNIT_SYSTEMS.METRIC) return displayVal;
  const conv = CONVERTERS[kind];
  return conv ? conv.toMetric(displayVal) : displayVal;
}

/** Load the persisted unit system from localStorage (defaults to `'metric'`). */
export function loadUnitSystem() {
  try {
    return normalizeUnitSystem(localStorage.getItem(UNITS_STORAGE_KEY));
  } catch (_) {
    return UNIT_SYSTEMS.METRIC;
  }
}

/** Persist unit system to localStorage and update active state. */
export function saveUnitSystem(unitSystem) {
  const normalized = normalizeUnitSystem(unitSystem);
  _activeUnitSystem = normalized;
  try {
    localStorage.setItem(UNITS_STORAGE_KEY, normalized);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Write a canonical metric value into an `<input>` for `unitSystem`,
 * remembering exact metric source while untouched to prevent toggle drift.
 */
export function writeMetricInputValue(el, kind, metricVal, unitSystem = UNIT_SYSTEMS.METRIC) {
  if (!el) return;
  const sys = normalizeUnitSystem(unitSystem);
  if (metricVal == null || metricVal === '' || !Number.isFinite(Number(metricVal))) {
    el.value = '';
    delete el.dataset.canonicalMetric;
    delete el.dataset.renderedDisplay;
    return;
  }
  const num = Number(metricVal);
  const disp = toDisplay(kind, num, sys);
  el.value = String(disp);
  if (sys === UNIT_SYSTEMS.IMPERIAL) {
    el.dataset.canonicalMetric = String(num);
    el.dataset.renderedDisplay = String(disp);
  } else {
    delete el.dataset.canonicalMetric;
    delete el.dataset.renderedDisplay;
  }
}

/**
 * Read a canonical metric numeric value from an `<input>` whose UI is in `unitSystem`.
 * Returns `fallback` when the element is missing or empty.
 */
export function readMetricInputValue(el, kind, unitSystem = UNIT_SYSTEMS.METRIC, fallback = undefined) {
  if (!el || el.value === '') return fallback;
  const sys = normalizeUnitSystem(unitSystem);
  if (sys === UNIT_SYSTEMS.METRIC) return +el.value;
  if (
    el.dataset.renderedDisplay !== undefined &&
    el.value === el.dataset.renderedDisplay &&
    el.dataset.canonicalMetric !== undefined
  ) {
    return +el.dataset.canonicalMetric;
  }
  return fromDisplay(kind, +el.value, sys);
}
