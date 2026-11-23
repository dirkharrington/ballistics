import {
  effectiveMV, validateMvSens, applyMvSensitivity, showMvSensError,
  MV_REF_TEMP_C, MV_SENS_LIMITS,
} from '../app/mv-sens.js';
import { toDisplay, fromDisplay, unitLabel } from '../app/units.js';
import { PREF_KEYS, PREF_DEFAULTS, DOM_ID_FOR_PREF, savePrefs, loadPrefs } from '../app/prefs.js';
import { saveProfile, loadProfiles, isValidProfile } from '../app/profiles.js';
import { encodeState, decodeState } from '../app/url-state.js';

describe('effectiveMV', () => {
  test('positive sensitivity: hotter than reference raises MV', () => {
    expect(effectiveMV(800, 1, 25)).toBe(810);
  });
  test('positive sensitivity: colder lowers MV', () => {
    expect(effectiveMV(800, 1, -5)).toBe(780);
  });
  test('negative sensitivity inverts the effect', () => {
    expect(effectiveMV(800, -0.5, 35)).toBe(790);
  });
  test('zero sensitivity returns nominal at any temperature', () => {
    expect(effectiveMV(800, 0, -40)).toBe(800);
    expect(effectiveMV(800, 0, 60)).toBe(800);
  });
  test('at the reference temperature MV is unchanged', () => {
    expect(effectiveMV(800, 2.5, MV_REF_TEMP_C)).toBe(800);
  });
  test('custom reference temperature', () => {
    expect(effectiveMV(800, 1, 20, 20)).toBe(800);
    expect(effectiveMV(800, 1, 30, 20)).toBe(810);
  });
  test('boundary temperatures', () => {
    expect(effectiveMV(800, 1, -50)).toBe(735);
    expect(effectiveMV(800, 1, 60)).toBe(845);
  });
});

describe('validateMvSens', () => {
  test('empty / null / whitespace means zero', () => {
    expect(validateMvSens('')).toEqual({ ok: true, value: 0 });
    expect(validateMvSens(null)).toEqual({ ok: true, value: 0 });
    expect(validateMvSens(undefined, 'imperial')).toEqual({ ok: true, value: 0 });
    expect(validateMvSens('   ')).toEqual({ ok: true, value: 0 });
  });
  test('accepts values inside and on the metric limit', () => {
    expect(validateMvSens('0.5', 'metric')).toEqual({ ok: true, value: 0.5 });
    expect(validateMvSens('5.5', 'metric').ok).toBe(true);
    expect(validateMvSens('-5.5', 'metric').ok).toBe(true);
  });
  test('rejects values beyond the metric limit', () => {
    const r = validateMvSens('5.51', 'metric');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/m\/s\/°C/);
    expect(validateMvSens('-5.51').ok).toBe(false);
  });
  test('imperial limit is ±10.025 fps/°F', () => {
    expect(validateMvSens('10', 'imperial').ok).toBe(true);
    expect(validateMvSens('-10', 'imperial').ok).toBe(true);
    const r = validateMvSens('10.1', 'imperial');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/fps\/°F/);
    expect(MV_SENS_LIMITS).toEqual({ metric: 5.5, imperial: 10.025 });
  });
  test('rejects non-numeric and non-finite input', () => {
    expect(validateMvSens('abc').ok).toBe(false);
    expect(validateMvSens('Infinity').ok).toBe(false);
    expect(validateMvSens('NaN').ok).toBe(false);
  });
  test('unknown unit system falls back to metric', () => {
    expect(validateMvSens('5.6', 'bogus').ok).toBe(false);
  });
});

describe('applyMvSensitivity', () => {
  const bullet = { id: 'x', muzzleVelocityMps: 800 };
  test('returns the same object when sensitivity is zero or absent', () => {
    expect(applyMvSensitivity(bullet, 0, 30)).toBe(bullet);
    expect(applyMvSensitivity(bullet, undefined, 30)).toBe(bullet);
  });
  test('returns a copy with effective and nominal MV; original untouched', () => {
    const out = applyMvSensitivity(bullet, 1, 25);
    expect(out).not.toBe(bullet);
    expect(out.muzzleVelocityMps).toBe(810);
    expect(out.nominalMuzzleVelocityMps).toBe(800);
    expect(bullet.muzzleVelocityMps).toBe(800);
  });
});

describe('showMvSensError', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="mvSens"><small id="mvSens-error"></small>';
  });
  test('sets message and aria-invalid, then clears', () => {
    expect(showMvSensError('bad')).toBe(true);
    expect(document.getElementById('mvSens-error').textContent).toBe('bad');
    expect(document.getElementById('mvSens').getAttribute('aria-invalid')).toBe('true');
    expect(showMvSensError('')).toBe(false);
    expect(document.getElementById('mvSens-error').textContent).toBe('');
    expect(document.getElementById('mvSens').hasAttribute('aria-invalid')).toBe(false);
  });
  test('tolerates missing elements', () => {
    document.body.innerHTML = '';
    expect(showMvSensError('x')).toBe(true);
    expect(showMvSensError(undefined)).toBe(false);
  });
});

describe('unit conversion', () => {
  test('labels', () => {
    expect(unitLabel('mvSens', 'metric')).toBe('m/s/°C');
    expect(unitLabel('mvSens', 'imperial')).toBe('fps/°F');
  });
  test('1 fps/°F ≈ 0.5486 m/s/°C and round-trips', () => {
    expect(fromDisplay('mvSens', 1, 'imperial')).toBeCloseTo(0.5486, 4);
    expect(toDisplay('mvSens', 0.5486, 'imperial')).toBe(1);
    expect(toDisplay('mvSens', fromDisplay('mvSens', 2.5, 'imperial'), 'imperial')).toBe(2.5);
  });
  test('metric is passthrough', () => {
    expect(toDisplay('mvSens', 0.7, 'metric')).toBe(0.7);
  });
});

describe('preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<input id="mvSens" value="0">';
  });
  test('key, default and DOM id', () => {
    expect(PREF_KEYS.mvSens).toBe('bv_mvSens');
    expect(PREF_DEFAULTS.mvSens).toBe(0);
    expect(DOM_ID_FOR_PREF.mvSens).toBe('mvSens');
  });
  test('loadPrefs returns numeric default when absent', () => {
    expect(loadPrefs().mvSens).toBe(0);
  });
  test('metric round-trip', () => {
    document.getElementById('mvSens').value = '1.25';
    savePrefs(new Set(), null, 'metric');
    expect(localStorage.getItem('bv_mvSens')).toBe('1.25');
    expect(loadPrefs().mvSens).toBe(1.25);
  });
  test('imperial entry is stored as canonical metric', () => {
    document.getElementById('mvSens').value = '2';
    savePrefs(new Set(), null, 'imperial');
    expect(Number(localStorage.getItem('bv_mvSens'))).toBeCloseTo(1.0973, 4);
  });
});

describe('profile round-trip', () => {
  const base = {
    bulletIds: ['a'], dragModel: 'G1', zero: 100, maxRange: 1000, wind: 0, windDir: 90,
    altitude: 0, temp: 15, step: 25, sightHeight: 38.1, angle: 0,
  };
  beforeEach(() => localStorage.clear());
  test('mvSens is saved and reloaded', () => {
    expect(saveProfile('hot', { ...base, mvSens: 0.75 }).ok).toBe(true);
    expect(loadProfiles()[0].params.mvSens).toBe(0.75);
  });
  test('absent mvSens remains absent (old profiles still valid)', () => {
    expect(saveProfile('old', base).ok).toBe(true);
    expect(loadProfiles()[0].params.mvSens).toBeUndefined();
  });
  test('out-of-range mvSens is rejected', () => {
    expect(saveProfile('bad', { ...base, mvSens: 7 }).ok).toBe(false);
    expect(isValidProfile({ name: 'x', params: { ...base, mvSens: 'a' } })).toBe(false);
  });
});

describe('share URL param', () => {
  const state = {
    bulletIds: ['a'], zero: 100, maxRange: 1000, wind: 0, windDir: 90, altitude: 0,
    temp: 15, step: 25, sightHeight: 38.1, angle: 0, dragModel: 'G1',
  };
  test('encoded when present, omitted when absent', () => {
    expect(new URLSearchParams(encodeState({ ...state, mvSens: 0.549 })).get('mvSens')).toBe('0.549');
    expect(new URLSearchParams(encodeState(state)).has('mvSens')).toBe(false);
  });
  test('decode round-trip incl. negative', () => {
    expect(decodeState('?mvSens=-1.5').params.mvSens).toBe(-1.5);
    expect(decodeState('?mvSens=0.549').params.mvSens).toBe(0.549);
  });
  test('out-of-range or malformed values are dropped', () => {
    expect(decodeState('?mvSens=99').params.mvSens).toBeUndefined();
    expect(decodeState('?mvSens=abc').params.mvSens).toBeUndefined();
  });
});
