import {
  toClicks, clickValueToMoa, clickLabel, formatElevClicks, formatWindClicks,
  syncClickCustomVisibility, readClickValue, MOA_PER_MRAD, CLICK_PRESETS, CLICK_VALUE_IDS,
} from '../app/clicks.js';
import { PREF_KEYS, PREF_DEFAULTS, DOM_ID_FOR_PREF, savePrefs, loadPrefs } from '../app/prefs.js';
import { saveProfile, loadProfiles } from '../app/profiles.js';

describe('toClicks', () => {
  test('positive input rounds to nearest click', () => {
    expect(toClicks(3.4, 0.25)).toBe(14);
    expect(toClicks(10, 1)).toBe(10);
  });
  test('negative input', () => {
    expect(toClicks(-3.4, 0.25)).toBe(-14);
  });
  test('zero result is +0, not -0', () => {
    expect(Object.is(toClicks(-0.05, 0.25), 0)).toBe(true);
    expect(toClicks(0, 0.25)).toBe(0);
  });
  test('non-positive or missing clickMOA throws', () => {
    expect(() => toClicks(1, 0)).toThrow('clickMOA must be positive');
    expect(() => toClicks(1, -0.25)).toThrow();
    expect(() => toClicks(1)).toThrow();
    expect(() => toClicks(1, NaN)).toThrow();
  });
});

describe('MRAD → MOA conversion', () => {
  test('constant and presets', () => {
    expect(MOA_PER_MRAD).toBe(3.43775);
    expect(CLICK_PRESETS['0.1mrad'].moa).toBeCloseTo(0.343775, 6);
    expect(clickValueToMoa('0.05mrad')).toBeCloseTo(0.1718875, 7);
    expect(clickValueToMoa('0.5moa')).toBe(0.5);
  });
  test('custom, invalid custom and unknown ids fall back sensibly', () => {
    expect(clickValueToMoa('custom', 0.3)).toBe(0.3);
    expect(clickValueToMoa('custom', 0)).toBe(0.25);
    expect(clickValueToMoa('custom', NaN)).toBe(0.25);
    expect(clickValueToMoa('bogus')).toBe(0.25);
    expect(CLICK_VALUE_IDS).toContain('custom');
  });
  test('labels', () => {
    expect(clickLabel('0.25moa')).toBe('¼ MOA');
    expect(clickLabel('custom', 0.3)).toBe('0.3 MOA (custom)');
    expect(clickLabel('bogus')).toBe('¼ MOA');
  });
});

describe('formatted click strings', () => {
  test('elevation', () => {
    expect(formatElevClicks(12)).toBe('+12 U');
    expect(formatElevClicks(-3)).toBe('3 D');
    expect(formatElevClicks(0)).toBe('0');
  });
  test('windage', () => {
    expect(formatWindClicks(4)).toBe('4 R');
    expect(formatWindClicks(-2)).toBe('2 L');
    expect(formatWindClicks(0)).toBe('0');
  });
});

describe('DOM helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '<select id="clickValue"><option value="0.25moa">a</option><option value="custom">c</option></select><input id="clickValueCustom" value="0.4">';
  });
  test('custom input visibility follows selection', () => {
    const sel = document.getElementById('clickValue');
    const custom = document.getElementById('clickValueCustom');
    sel.value = 'custom';
    syncClickCustomVisibility();
    expect(custom.style.display).toBe('');
    sel.value = '0.25moa';
    syncClickCustomVisibility();
    expect(custom.style.display).toBe('none');
  });
  test('syncClickCustomVisibility tolerates missing elements', () => {
    document.body.innerHTML = '';
    expect(() => syncClickCustomVisibility()).not.toThrow();
  });
  test('readClickValue', () => {
    expect(readClickValue()).toEqual({ id: '0.25moa', moa: 0.25, label: '¼ MOA' });
    document.getElementById('clickValue').value = 'custom';
    expect(readClickValue()).toEqual({ id: 'custom', moa: 0.4, label: '0.4 MOA (custom)' });
    document.getElementById('clickValueCustom').value = '';
    expect(readClickValue().moa).toBe(0.25);
  });
  test('readClickValue falls back to defaults with no DOM', () => {
    document.body.innerHTML = '';
    expect(readClickValue()).toEqual({ id: '0.25moa', moa: 0.25, label: '¼ MOA' });
  });
});

describe('pref round-trip', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<select id="clickValue"><option value="0.25moa">a</option><option value="0.5moa">b</option></select><input id="clickValueCustom" value="0.25">';
  });
  test('keys and defaults', () => {
    expect(PREF_KEYS.clickValue).toBe('bv_clickValue');
    expect(PREF_KEYS.clickValueCustom).toBe('bv_clickValueCustom');
    expect(PREF_DEFAULTS.clickValue).toBe('0.25moa');
    expect(PREF_DEFAULTS.clickValueCustom).toBe(0.25);
    expect(DOM_ID_FOR_PREF.clickValue).toBe('clickValue');
  });
  test('save then load', () => {
    expect(loadPrefs().clickValue).toBe('0.25moa');
    document.getElementById('clickValue').value = '0.5moa';
    document.getElementById('clickValueCustom').value = '0.3';
    savePrefs();
    const p = loadPrefs();
    expect(p.clickValue).toBe('0.5moa');
    expect(p.clickValueCustom).toBe(0.3);
  });
});

describe('profile validation', () => {
  const base = {
    bulletIds: ['a'], dragModel: 'G1', zero: 100, maxRange: 1000, wind: 0, windDir: 90,
    altitude: 0, temp: 15, step: 25, sightHeight: 38.1, angle: 0,
  };
  beforeEach(() => localStorage.clear());
  test('click fields saved and reloaded', () => {
    expect(saveProfile('p', { ...base, clickValue: 'custom', clickValueCustom: 0.3 }).ok).toBe(true);
    const params = loadProfiles()[0].params;
    expect(params.clickValue).toBe('custom');
    expect(params.clickValueCustom).toBe(0.3);
  });
  test('unknown click value or out-of-range custom is rejected', () => {
    expect(saveProfile('p', { ...base, clickValue: '2moa' }).ok).toBe(false);
    expect(saveProfile('p', { ...base, clickValue: 'custom', clickValueCustom: 0 }).ok).toBe(false);
  });
});
