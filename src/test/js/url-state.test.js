const {
  URL_PARAM_KEYS, URL_BULLET_KEY, MAX_URL_BULLETS,
  encodeState, decodeState, mergeIntoSearch,
} = require('../../main/resources/static/url-state.js');

// ── Sample states ──────────────────────────────────────────────────────────────
const BASE_STATE = {
  bulletIds:   [],
  zero:        100,
  maxRange:    1000,
  wind:        16,
  windDir:     90,
  altitude:    0,
  temp:        15,
  step:        25,
  sightHeight: 38.1,
  angle:       0,
  dragModel:   'G1',
};

const STATE_ONE = { ...BASE_STATE, bulletIds: ['308-win-168gr'] };
const STATE_TWO = { ...BASE_STATE, bulletIds: ['308-win-168gr', '65-creedmoor-140gr'] };
function make20Bullets() {
  return Array.from({ length: 20 }, (_, i) => `bullet-id-${i}`);
}
const STATE_20 = { ...BASE_STATE, bulletIds: make20Bullets() };

// ── URL_PARAM_KEYS ─────────────────────────────────────────────────────────────
describe('URL_PARAM_KEYS', () => {
  test('contains exactly 12 keys', () => {
    expect(URL_PARAM_KEYS).toHaveLength(12);
  });
  test('is frozen', () => {
    expect(Object.isFrozen(URL_PARAM_KEYS)).toBe(true);
  });
  test('contains all expected keys including WA-13 optional keys', () => {
    expect(URL_PARAM_KEYS).toContain('zero');
    expect(URL_PARAM_KEYS).toContain('dragModel');
    expect(URL_PARAM_KEYS).toContain('latitudeDeg');
    expect(URL_PARAM_KEYS).toContain('azimuthDeg');
  });
});

// ── URL_BULLET_KEY ─────────────────────────────────────────────────────────────
describe('URL_BULLET_KEY', () => {
  test('is "b"', () => {
    expect(URL_BULLET_KEY).toBe('b');
  });
});

// ── MAX_URL_BULLETS ────────────────────────────────────────────────────────────
describe('MAX_URL_BULLETS', () => {
  test('is 20', () => {
    expect(MAX_URL_BULLETS).toBe(20);
  });
});

// ── encodeState ────────────────────────────────────────────────────────────────
describe('encodeState', () => {
  test('always emits all required keys; optional keys absent when null', () => {
    const qs = encodeState(BASE_STATE);
    const params = new URLSearchParams(qs);
    const OPTIONAL = new Set(['latitudeDeg', 'azimuthDeg']);
    URL_PARAM_KEYS.filter(k => !OPTIONAL.has(k)).forEach(k => expect(params.has(k)).toBe(true));
    expect(params.has('latitudeDeg')).toBe(false);
    expect(params.has('azimuthDeg')).toBe(false);
  });

  test('emits no b when bulletIds is empty', () => {
    const qs = encodeState(BASE_STATE);
    const params = new URLSearchParams(qs);
    expect(params.getAll('b')).toHaveLength(0);
  });

  test('emits one b per bullet ID in order', () => {
    const qs = encodeState(STATE_TWO);
    const params = new URLSearchParams(qs);
    expect(params.getAll('b')).toEqual(['308-win-168gr', '65-creedmoor-140gr']);
  });

  test('deduplicates bulletIds', () => {
    const state = { ...BASE_STATE, bulletIds: ['a-1', 'a-1', 'b-2'] };
    const qs = encodeState(state);
    const params = new URLSearchParams(qs);
    expect(params.getAll('b')).toEqual(['a-1', 'b-2']);
  });

  test('caps at 20 bullets', () => {
    const state = { ...BASE_STATE, bulletIds: Array.from({ length: 25 }, (_, i) => `id-${i}`) };
    const qs = encodeState(state);
    const params = new URLSearchParams(qs);
    expect(params.getAll('b')).toHaveLength(20);
  });

  test('uses String(Number(v)) for numeric keys', () => {
    const state = { ...BASE_STATE, zero: 100.0 };
    const qs = encodeState(state);
    const params = new URLSearchParams(qs);
    expect(params.get('zero')).toBe('100');
  });

  test('preserves dragModel as string', () => {
    const qs = encodeState({ ...BASE_STATE, dragModel: 'G7' });
    expect(new URLSearchParams(qs).get('dragModel')).toBe('G7');
  });

  test('emits latitudeDeg and azimuthDeg when provided', () => {
    const qs = encodeState({ ...BASE_STATE, latitudeDeg: 45, azimuthDeg: 180 });
    const params = new URLSearchParams(qs);
    expect(params.get('latitudeDeg')).toBe('45');
    expect(params.get('azimuthDeg')).toBe('180');
  });

  test('omits latitudeDeg when null', () => {
    const qs = encodeState({ ...BASE_STATE, latitudeDeg: null });
    const params = new URLSearchParams(qs);
    expect(params.has('latitudeDeg')).toBe(false);
  });

  test('b keys come before 12 param keys in output order', () => {
    const qs = encodeState(STATE_ONE);
    const keys = [...new URLSearchParams(qs).keys()];
    const bIndex    = keys.indexOf('b');
    const zeroIndex = keys.indexOf('zero');
    expect(bIndex).toBeLessThan(zeroIndex);
  });
});

// ── decodeState ────────────────────────────────────────────────────────────────
describe('decodeState – round-trip', () => {
  test('round-trips state with 0 bullets', () => {
    const { params, bulletIds } = decodeState('?' + encodeState(BASE_STATE));
    expect(bulletIds).toBeNull();
    expect(params.zero).toBe(100);
    expect(params.dragModel).toBe('G1');
  });

  test('round-trips state with 1 bullet', () => {
    const { params, bulletIds } = decodeState('?' + encodeState(STATE_ONE));
    expect(bulletIds).toEqual(['308-win-168gr']);
    expect(params.zero).toBe(100);
  });

  test('round-trips state with 20 bullets', () => {
    const { bulletIds } = decodeState('?' + encodeState(STATE_20));
    expect(bulletIds).toHaveLength(20);
    expect(bulletIds[0]).toBe('bullet-id-0');
  });

  test('handles empty search string', () => {
    const { params, bulletIds, recognized } = decodeState('');
    expect(recognized).toBe(false);
    expect(bulletIds).toBeNull();
    expect(Object.keys(params)).toHaveLength(0);
  });

  test('handles search without leading ?', () => {
    const qs = encodeState(STATE_ONE);
    const { bulletIds } = decodeState(qs);
    expect(bulletIds).toEqual(['308-win-168gr']);
  });
});

describe('decodeState – recognized flag', () => {
  test('recognized is false with no owned keys', () => {
    const { recognized } = decodeState('?utm_source=x');
    expect(recognized).toBe(false);
  });

  test('recognized is true when b is present (even invalid)', () => {
    const { recognized } = decodeState('?b=BAD_ID');
    expect(recognized).toBe(true);
  });

  test('recognized is true when a param key is present (even invalid)', () => {
    const { recognized } = decodeState('?zero=abc');
    expect(recognized).toBe(true);
  });
});

describe('decodeState – numeric key validation', () => {
  const INVALID_RAWS = ['', 'abc', '1e3', '0x10', 'Infinity', 'NaN', '-', '1.2.3'];

  INVALID_RAWS.forEach(raw => {
    test(`ignores "${raw}" for zero`, () => {
      const encoded = `?zero=${encodeURIComponent(raw)}`;
      const { params, recognized } = decodeState(encoded);
      expect(params.zero).toBeUndefined();
      expect(recognized).toBe(true);
    });
  });

  test('ignores zero below min (≤0)', () => {
    expect(decodeState('?zero=0').params.zero).toBeUndefined();
    expect(decodeState('?zero=-1').params.zero).toBeUndefined();
  });

  test('ignores zero above max (>3000)', () => {
    expect(decodeState('?zero=3001').params.zero).toBeUndefined();
  });

  test('accepts zero at boundary (3000)', () => {
    expect(decodeState('?zero=3000').params.zero).toBe(3000);
  });

  test('ignores maxRange above max (>5000)', () => {
    expect(decodeState('?maxRange=5001').params.maxRange).toBeUndefined();
  });

  test('accepts maxRange at boundary (5000)', () => {
    expect(decodeState('?maxRange=5000').params.maxRange).toBe(5000);
  });

  test('ignores wind above max (>200)', () => {
    expect(decodeState('?wind=201').params.wind).toBeUndefined();
  });

  test('accepts wind=0', () => {
    expect(decodeState('?wind=0').params.wind).toBe(0);
  });

  test('ignores altitude above max (>10000)', () => {
    expect(decodeState('?altitude=10001').params.altitude).toBeUndefined();
  });

  test('accepts altitude=0', () => {
    expect(decodeState('?altitude=0').params.altitude).toBe(0);
  });

  test('ignores temp below min (<-50)', () => {
    expect(decodeState('?temp=-51').params.temp).toBeUndefined();
  });

  test('ignores temp above max (>60)', () => {
    expect(decodeState('?temp=61').params.temp).toBeUndefined();
  });

  test('accepts temp=-50 and temp=60', () => {
    expect(decodeState('?temp=-50').params.temp).toBe(-50);
    expect(decodeState('?temp=60').params.temp).toBe(60);
  });

  test('ignores step above max (>500)', () => {
    expect(decodeState('?step=501').params.step).toBeUndefined();
  });

  test('ignores step=0', () => {
    expect(decodeState('?step=0').params.step).toBeUndefined();
  });

  test('ignores sightHeight=0', () => {
    expect(decodeState('?sightHeight=0').params.sightHeight).toBeUndefined();
  });

  test('accepts sightHeight at max (150)', () => {
    expect(decodeState('?sightHeight=150').params.sightHeight).toBe(150);
  });

  test('accepts angle at boundaries (-45 and 45)', () => {
    expect(decodeState('?angle=-45').params.angle).toBe(-45);
    expect(decodeState('?angle=45').params.angle).toBe(45);
  });

  test('ignores angle outside bounds', () => {
    expect(decodeState('?angle=-46').params.angle).toBeUndefined();
    expect(decodeState('?angle=46').params.angle).toBeUndefined();
  });
});

describe('decodeState – windDir validation', () => {
  test('ignores windDir=30 (not in allowed set)', () => {
    expect(decodeState('?windDir=30').params.windDir).toBeUndefined();
  });

  test('accepts all 8 valid wind directions', () => {
    [0, 45, 90, 135, 180, 225, 270, 315].forEach(dir => {
      expect(decodeState(`?windDir=${dir}`).params.windDir).toBe(dir);
    });
  });
});

describe('decodeState – dragModel validation', () => {
  test('ignores dragModel=g7 (case-sensitive)', () => {
    expect(decodeState('?dragModel=g7').params.dragModel).toBeUndefined();
  });

  test('ignores dragModel=G1G7', () => {
    expect(decodeState('?dragModel=G1G7').params.dragModel).toBeUndefined();
  });

  test('accepts G1 and G7', () => {
    expect(decodeState('?dragModel=G1').params.dragModel).toBe('G1');
    expect(decodeState('?dragModel=G7').params.dragModel).toBe('G7');
  });
});

describe('decodeState – bullet ID validation', () => {
  test('drops IDs that fail the regex', () => {
    const { bulletIds } = decodeState('?b=UPPER&b=valid-id-1');
    expect(bulletIds).toEqual(['valid-id-1']);
  });

  test('deduplicates bullet IDs (first occurrence kept)', () => {
    const { bulletIds } = decodeState('?b=id-1&b=id-2&b=id-1');
    expect(bulletIds).toEqual(['id-1', 'id-2']);
  });

  test('keeps at most 20 valid bullet IDs', () => {
    const qs = Array.from({ length: 25 }, (_, i) => `b=bullet-${i}`).join('&');
    const { bulletIds } = decodeState('?' + qs);
    expect(bulletIds).toHaveLength(20);
  });

  test('returns null bulletIds when no valid b is present', () => {
    expect(decodeState('?b=INVALID').bulletIds).toBeNull();
    expect(decodeState('?zero=100').bulletIds).toBeNull();
  });

  test('accepts IDs that are exactly 32 chars (1 + 31)', () => {
    const id = 'a' + 'b'.repeat(31);
    expect(decodeState(`?b=${id}`).bulletIds).toEqual([id]);
  });

  test('rejects IDs longer than 32 chars', () => {
    const id = 'a' + 'b'.repeat(32);
    expect(decodeState(`?b=${id}`).bulletIds).toBeNull();
  });

  test('rejects IDs starting with hyphen', () => {
    expect(decodeState('?b=-bad-id').bulletIds).toBeNull();
  });
});

// ── mergeIntoSearch ────────────────────────────────────────────────────────────
describe('mergeIntoSearch', () => {
  test('preserves unknown keys in original order', () => {
    const result = mergeIntoSearch('?utm_source=x&foo=bar', BASE_STATE);
    const params = new URLSearchParams(result);
    expect(params.get('utm_source')).toBe('x');
    expect(params.get('foo')).toBe('bar');
  });

  test('utm_source appears before owned keys', () => {
    const result = mergeIntoSearch('?utm_source=x', BASE_STATE);
    const keys = [...new URLSearchParams(result).keys()];
    expect(keys.indexOf('utm_source')).toBeLessThan(keys.indexOf('zero'));
  });

  test('replaces existing owned keys with new values', () => {
    const existing = '?zero=500&maxRange=2000';
    const result = mergeIntoSearch(existing, { ...BASE_STATE, zero: 200 });
    const params = new URLSearchParams(result);
    expect(params.get('zero')).toBe('200');
    expect(params.get('maxRange')).toBe('1000');
  });

  test('handles empty existingSearch', () => {
    const result = mergeIntoSearch('', BASE_STATE);
    expect(new URLSearchParams(result).get('zero')).toBe('100');
  });

  test('handles existingSearch with leading ?', () => {
    const result = mergeIntoSearch('?zero=999', BASE_STATE);
    expect(new URLSearchParams(result).get('zero')).toBe('100');
  });

  test('includes bullet IDs from state', () => {
    const result = mergeIntoSearch('', STATE_ONE);
    expect(new URLSearchParams(result).getAll('b')).toEqual(['308-win-168gr']);
  });

  test('removes old b params from existingSearch', () => {
    const result = mergeIntoSearch('?b=old-id', STATE_ONE);
    expect(new URLSearchParams(result).getAll('b')).toEqual(['308-win-168gr']);
  });

  test('unknown key before ? in existing is preserved', () => {
    const result = mergeIntoSearch('utm_source=email', BASE_STATE);
    expect(new URLSearchParams(result).get('utm_source')).toBe('email');
  });

  test('all required owned keys are always emitted; optional keys absent when null', () => {
    const result = mergeIntoSearch('', BASE_STATE);
    const params = new URLSearchParams(result);
    const OPTIONAL = new Set(['latitudeDeg', 'azimuthDeg']);
    URL_PARAM_KEYS.filter(k => !OPTIONAL.has(k)).forEach(k => expect(params.has(k)).toBe(true));
    expect(params.has('latitudeDeg')).toBe(false);
    expect(params.has('azimuthDeg')).toBe(false);
  });

  test('mergeIntoSearch emits latitudeDeg and azimuthDeg when provided', () => {
    const result = mergeIntoSearch('', { ...BASE_STATE, latitudeDeg: -33.9, azimuthDeg: 270 });
    const params = new URLSearchParams(result);
    expect(params.has('latitudeDeg')).toBe(true);
    expect(params.has('azimuthDeg')).toBe(true);
  });
});

// ── decodeState – WA-13 optional keys ─────────────────────────────────────────
describe('decodeState – latitudeDeg and azimuthDeg', () => {
  test('accepts latitudeDeg within [-90, 90]', () => {
    expect(decodeState('?latitudeDeg=45').params.latitudeDeg).toBe(45);
    expect(decodeState('?latitudeDeg=-90').params.latitudeDeg).toBe(-90);
    expect(decodeState('?latitudeDeg=90').params.latitudeDeg).toBe(90);
  });

  test('rejects latitudeDeg outside range', () => {
    expect(decodeState('?latitudeDeg=91').params.latitudeDeg).toBeUndefined();
    expect(decodeState('?latitudeDeg=-91').params.latitudeDeg).toBeUndefined();
  });

  test('accepts azimuthDeg within [0, 360]', () => {
    expect(decodeState('?azimuthDeg=0').params.azimuthDeg).toBe(0);
    expect(decodeState('?azimuthDeg=180').params.azimuthDeg).toBe(180);
    expect(decodeState('?azimuthDeg=360').params.azimuthDeg).toBe(360);
  });

  test('rejects azimuthDeg outside range', () => {
    expect(decodeState('?azimuthDeg=361').params.azimuthDeg).toBeUndefined();
    expect(decodeState('?azimuthDeg=-1').params.azimuthDeg).toBeUndefined();
  });

  test('round-trips latitudeDeg and azimuthDeg', () => {
    const qs = encodeState({ ...BASE_STATE, latitudeDeg: 51.5, azimuthDeg: 90 });
    const { params } = decodeState('?' + qs);
    expect(params.latitudeDeg).toBe(51.5);
    expect(params.azimuthDeg).toBe(90);
  });
});
