'use strict';

const {
  UNIT_SYSTEMS,
  UNITS_STORAGE_KEY,
  UNIT_LABELS,
  normalizeUnitSystem,
  getUnitSystem,
  setUnitSystemState,
  unitLabel,
  toDisplay,
  fromDisplay,
  loadUnitSystem,
  saveUnitSystem,
  writeMetricInputValue,
  readMetricInputValue,
} = require('../app/units.js');

beforeEach(() => {
  localStorage.clear();
  setUnitSystemState('metric');
  jest.restoreAllMocks();
});

describe('constants & unit labels', () => {
  test('exports expected UNIT_SYSTEMS, storage key, and all 14 UNIT_LABELS kinds', () => {
    expect(UNIT_SYSTEMS).toEqual({ METRIC: 'metric', IMPERIAL: 'imperial' });
    expect(UNITS_STORAGE_KEY).toBe('ballistics_units');
    expect(Object.keys(UNIT_LABELS)).toEqual([
      'range', 'drop', 'drift', 'velocity', 'windSpeed', 'energy', 'weight',
      'altitude', 'temp', 'step', 'sightHeight', 'diameter', 'pressure', 'vitalZone',
    ]);
    expect(unitLabel('range')).toBe('m');
    expect(unitLabel('range', 'imperial')).toBe('yd');
    expect(unitLabel('energy', 'imperial')).toBe('ft·lb');
    expect(unitLabel('pressure', 'imperial')).toBe('inHg');
    expect(unitLabel('unknown', 'metric')).toBe('');
  });
});

describe('normalizeUnitSystem & module state helpers', () => {
  test('normalizes valid and invalid inputs', () => {
    expect(normalizeUnitSystem('imperial')).toBe('imperial');
    expect(normalizeUnitSystem('metric')).toBe('metric');
    expect(normalizeUnitSystem('IMPERIAL')).toBe('metric');
    expect(normalizeUnitSystem(null)).toBe('metric');
    expect(normalizeUnitSystem(undefined)).toBe('metric');
  });

  test('getUnitSystem and setUnitSystemState manage active state', () => {
    expect(getUnitSystem()).toBe('metric');
    expect(setUnitSystemState('imperial')).toBe('imperial');
    expect(getUnitSystem()).toBe('imperial');
    expect(setUnitSystemState('other')).toBe('metric');
    expect(getUnitSystem()).toBe('metric');
  });
});

describe('toDisplay and fromDisplay conversions', () => {
  test('returns input verbatim in metric mode or for non-finite / non-numeric / unknown kind', () => {
    expect(toDisplay('range', 100)).toBe(100);
    expect(toDisplay('range', 100, 'metric')).toBe(100);
    expect(fromDisplay('range', 100)).toBe(100);
    expect(fromDisplay('range', 100, 'metric')).toBe(100);

    expect(toDisplay('range', NaN, 'imperial')).toBeNaN();
    expect(toDisplay('range', null, 'imperial')).toBeNull();
    expect(toDisplay('range', undefined, 'imperial')).toBeUndefined();
    expect(fromDisplay('range', NaN, 'imperial')).toBeNaN();
    expect(fromDisplay('range', null, 'imperial')).toBeNull();

    expect(toDisplay('unknown', 42, 'imperial')).toBe(42);
    expect(fromDisplay('unknown', 42, 'imperial')).toBe(42);
  });

  test.each([
    ['range',       1000,    1094,   100,   91.44],
    ['step',        25,      27,     25,    22.86],
    ['drop',        -10,     -3.9,   -10,   -25.4],
    ['drift',       2.54,    1,      2,     5.08],
    ['vitalZone',   20,      7.9,    8,     20.32],
    ['velocity',    807,     2648,   2600,  792.48],
    ['windSpeed',   16,      10,     10,    16.09],
    ['energy',      3552,    2620,   2620,  3552],
    ['weight',      10.89,   168.1,  168,   10.89],
    ['altitude',    1000,    3281,   3281,  1000],
    ['temp',        20,      68,     68,    20],
    ['sightHeight', 38.1,    1.5,    1.5,   38.1],
    ['diameter',    7.82,    0.308,  0.308, 7.82],
    ['pressure',    1013.25, 29.92,  29.92, 1013.21],
  ])('%s converts metric->imperial and imperial->metric cleanly', (kind, metricIn, impOut, impIn, metricOut) => {
    expect(toDisplay(kind, metricIn, 'imperial')).toBe(impOut);
    expect(fromDisplay(kind, impIn, 'imperial')).toBe(metricOut);
  });

  test('never produces -0 on near-zero negative values', () => {
    expect(Object.is(toDisplay('drop', -0.001, 'imperial'), -0)).toBe(false);
    expect(toDisplay('drop', -0.001, 'imperial')).toBe(0);
  });
});

describe('loadUnitSystem and saveUnitSystem', () => {
  test('reads and persists unit system safely', () => {
    expect(loadUnitSystem()).toBe('metric');
    expect(saveUnitSystem('imperial')).toBe(true);
    expect(localStorage.getItem(UNITS_STORAGE_KEY)).toBe('imperial');
    expect(loadUnitSystem()).toBe('imperial');
    expect(getUnitSystem()).toBe('imperial');

    expect(saveUnitSystem('invalid')).toBe(true);
    expect(localStorage.getItem(UNITS_STORAGE_KEY)).toBe('metric');
  });

  test('handles localStorage errors gracefully', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(loadUnitSystem()).toBe('metric');
    expect(saveUnitSystem('imperial')).toBe(false);
  });
});

describe('writeMetricInputValue and readMetricInputValue', () => {
  test('round-trips without drift when untouched in imperial and honors direct value edits', () => {
    const input = document.createElement('input');
    writeMetricInputValue(null, 'range', 100);

    writeMetricInputValue(input, 'range', 100, 'imperial');
    expect(input.value).toBe('109');
    expect(input.dataset.canonicalMetric).toBe('100');
    expect(input.dataset.renderedDisplay).toBe('109');
    expect(readMetricInputValue(input, 'range', 'imperial')).toBe(100);

    // Direct edit in imperial triggers fromDisplay instead of stale canonicalMetric
    input.value = '100';
    expect(readMetricInputValue(input, 'range', 'imperial')).toBe(91.44);

    // Switching back to metric clears tracking dataset attributes
    writeMetricInputValue(input, 'range', 100, 'metric');
    expect(input.value).toBe('100');
    expect(input.dataset.canonicalMetric).toBeUndefined();
    expect(readMetricInputValue(input, 'range', 'metric')).toBe(100);
    expect(readMetricInputValue(input, 'range')).toBe(100);

    // Empty / null / non-finite handling
    writeMetricInputValue(input, 'range', null, 'imperial');
    expect(input.value).toBe('');
    expect(readMetricInputValue(input, 'range', 'imperial', 55)).toBe(55);
    expect(readMetricInputValue(null, 'range', 'imperial', 77)).toBe(77);
  });
});
