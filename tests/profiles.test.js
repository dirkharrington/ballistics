'use strict';

const {
  PROFILES_STORAGE_KEY,
  MAX_PROFILES,
  PROFILE_NAME_MAX,
  isValidProfile,
  loadProfiles,
  saveProfile,
  deleteProfile,
} = require('../app/profiles.js');

function validParams(overrides = {}) {
  return {
    bulletIds: ['308-win-168gr'],
    zero: 100,
    maxRange: 1000,
    wind: 16,
    windDir: 90,
    altitude: 0,
    temp: 15,
    step: 25,
    sightHeight: 38.1,
    angle: 0,
    dragModel: 'G1',
    ...overrides,
  };
}

function validProfile(overrides = {}) {
  return {
    name: 'PRS Match .308',
    params: validParams(),
    savedAt: '2026-11-20T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('constants', () => {
  test('exports expected storage key and limits', () => {
    expect(PROFILES_STORAGE_KEY).toBe('ballistics_profiles');
    expect(MAX_PROFILES).toBe(20);
    expect(PROFILE_NAME_MAX).toBe(64);
  });
});

describe('isValidProfile', () => {
  test('accepts minimal and full valid profiles (with optional fields)', () => {
    expect(isValidProfile({ name: 'Basic', params: validParams() })).toBe(true);
    expect(isValidProfile(validProfile({
      params: validParams({
        twistRate: 10,
        latitudeDeg: 45,
        azimuthDeg: 90,
        pressureHpa: 1013.25,
        humidityPercent: 50,
        includeEotvos: true,
        units: 'imperial',
      }),
    }))).toBe(true);
    expect(isValidProfile(validProfile({
      params: validParams({
        twistRate: null,
        latitudeDeg: null,
        azimuthDeg: null,
        pressureHpa: null,
        humidityPercent: null,
        includeEotvos: null,
        units: null,
      }),
    }))).toBe(true);
  });

  test('rejects invalid top-level shapes, names, and savedAt', () => {
    expect(isValidProfile(null)).toBe(false);
    expect(isValidProfile([])).toBe(false);
    expect(isValidProfile('str')).toBe(false);
    expect(isValidProfile(validProfile({ name: 123 }))).toBe(false);
    expect(isValidProfile(validProfile({ name: ' padded ' }))).toBe(false);
    expect(isValidProfile(validProfile({ name: '' }))).toBe(false);
    expect(isValidProfile(validProfile({ name: 'a'.repeat(65) }))).toBe(false);
    expect(isValidProfile(validProfile({ name: 'bad\u0007name' }))).toBe(false);
    expect(isValidProfile(validProfile({ name: 'bidi\u202Ename' }))).toBe(false);
    expect(isValidProfile(validProfile({ savedAt: 123 }))).toBe(false);
    expect(isValidProfile(validProfile({ savedAt: 'not-a-date' }))).toBe(false);
    expect(isValidProfile(validProfile({ savedAt: '2026-01-01T00:00:00.000Z'.padEnd(41, '0') }))).toBe(false);
  });

  test('rejects invalid params shapes, bulletIds, dragModel, and numeric ranges', () => {
    expect(isValidProfile(validProfile({ params: null }))).toBe(false);
    expect(isValidProfile(validProfile({ params: [] }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ bulletIds: '308' }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ bulletIds: [123] }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ bulletIds: [''] }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ bulletIds: ['x'.repeat(65)] }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ dragModel: 'G2' }) }))).toBe(false);

    // Required numeric bounds (strict min, inclusive min, inclusive max, non-number)
    expect(isValidProfile(validProfile({ params: validParams({ zero: 0 }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ zero: 3001 }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ zero: '100' }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ zero: NaN }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ wind: -1 }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ wind: 201 }) }))).toBe(false);

    // Optional fields invalid
    expect(isValidProfile(validProfile({ params: validParams({ pressureHpa: 499 }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ pressureHpa: 1101 }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ humidityPercent: -1 }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ humidityPercent: 101 }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ includeEotvos: 'yes' }) }))).toBe(false);
    expect(isValidProfile(validProfile({ params: validParams({ units: 'kelvin' }) }))).toBe(false);
  });
});

describe('loadProfiles', () => {
  test('returns [] on empty, invalid JSON, non-array, or storage errors', () => {
    expect(loadProfiles()).toEqual([]);

    localStorage.setItem(PROFILES_STORAGE_KEY, '{bad');
    expect(loadProfiles()).toEqual([]);

    localStorage.setItem(PROFILES_STORAGE_KEY, '{}');
    expect(loadProfiles()).toEqual([]);

    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadProfiles()).toEqual([]);
  });

  test('filters invalid entries, deduplicates case-insensitively, caps at 20, and strips extra keys', () => {
    const items = [
      { name: 'Invalid', params: null },
      { name: 'Alpha', params: validParams({ bulletIds: ['a', 'a', 'b', 'c', 'd', 'e', 'f'], extraKey: 'strip' }), extraTop: 'strip' },
      { name: 'alpha', params: validParams() }, // duplicate case-insensitive
    ];
    for (let i = 1; i <= 25; i++) {
      items.push(validProfile({ name: `Load ${i}` }));
    }
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(items));

    const loaded = loadProfiles();
    expect(loaded).toHaveLength(MAX_PROFILES);
    expect(loaded[0].name).toBe('Alpha');
    expect(loaded[0].savedAt).toBeUndefined();
    expect(loaded[0].extraTop).toBeUndefined();
    expect(loaded[0].params.extraKey).toBeUndefined();
    expect(loaded[0].params.bulletIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('saveProfile and deleteProfile', () => {
  test('validates name and params before persisting', () => {
    expect(saveProfile(123, validParams())).toMatchObject({ ok: false, error: 'invalid' });
    expect(saveProfile('   ', validParams())).toMatchObject({ ok: false, error: 'invalid' });
    expect(saveProfile('a'.repeat(65), validParams())).toMatchObject({ ok: false, error: 'invalid' });
    expect(saveProfile('bad\u0001name', validParams())).toMatchObject({ ok: false, error: 'invalid' });
    expect(saveProfile('Valid Name', { bad: true })).toMatchObject({ ok: false, error: 'invalid' });
  });

  test('saves new profile, overwrites case-insensitively, enforces cap of 20, and deletes cleanly', () => {
    const first = saveProfile('  Range Day  ', validParams({ pressureHpa: 1010, includeEotvos: true }));
    expect(first.ok).toBe(true);
    expect(first.replaced).toBe(false);
    expect(first.profile.name).toBe('Range Day');

    const updated = saveProfile('range day', validParams({ zero: 200 }));
    expect(updated.ok).toBe(true);
    expect(updated.replaced).toBe(true);
    expect(updated.profiles).toHaveLength(1);
    expect(updated.profiles[0].params.zero).toBe(200);

    for (let i = 2; i <= MAX_PROFILES; i++) {
      expect(saveProfile(`Profile ${i}`, validParams()).ok).toBe(true);
    }
    expect(saveProfile('Profile 21', validParams())).toMatchObject({ ok: false, error: 'full' });

    // Deleting missing or blank returns deleted: false
    expect(deleteProfile('')).toMatchObject({ ok: true, deleted: false });
    expect(deleteProfile(null)).toMatchObject({ ok: true, deleted: false });
    expect(deleteProfile('No Such Profile')).toMatchObject({ ok: true, deleted: false });

    // Case-insensitive delete succeeds
    const del = deleteProfile('RANGE DAY');
    expect(del).toMatchObject({ ok: true, deleted: true });
    expect(del.profiles).toHaveLength(MAX_PROFILES - 1);
  });

  test('handles localStorage setItem errors gracefully on save and delete', () => {
    saveProfile('Keep', validParams());
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(saveProfile('Another', validParams())).toMatchObject({ ok: false, error: 'storage' });
    expect(deleteProfile('Keep')).toMatchObject({ ok: false, error: 'storage' });
  });
});
