// ── TextEncoder / TextDecoder (not exposed as globals by jsdom) ───────────────
const { TextEncoder, TextDecoder } = require('util');
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

global.console.warn = jest.fn();

// Mock crypto.getRandomValues for deterministic testing
const crypto = require('crypto');
global.crypto = {
  getRandomValues(buf) {
    const bytes = crypto.randomBytes(buf.length);
    buf.set(bytes);
    return buf;
  }
};

const {
  CUSTOM_BULLETS_KEY, CUSTOM_BULLET_ID_RE, MAX_CUSTOM_BULLETS,
  CUSTOM_BULLET_LIMITS, CUSTOM_BULLET_PALETTE, GRAINS_TO_GRAMS, FPS_TO_MPS, INCH_TO_MM,
  newCustomBulletId, isCustomBulletId, customColor,
  validateCustomBulletInput, isValidCustomBulletRecord,
  loadCustomBullets, saveCustomBullets,
  upsertCustomBullet, removeCustomBullet,
  toBullet, mergeCatalog, bulletForDragModel,
  renderCustomBulletGroup, syncCustomDeleteGuards,
} = require('../app/custom-bullets.js');

const BULLET_CATALOG = require('./__mocks__/bullet-catalog.js');
const { decodeState } = require('../app/url-state.js');
const { simulate } = require('../app/physics/engine.ts');

// ── Sample records ─────────────────────────────────────────────────────────────
function makeRecord(overrides = {}) {
  return {
    id:                     'usr-3f2b8c1e9a4d4e6f',
    name:                   '175gr SMK handload',
    shortName:              '308 175',
    bulletWeightGrains:     175,
    ballisticCoefficientG1: 0.505,
    ballisticCoefficientG7: 0.243,
    bulletDiameterInches:   0.308,
    muzzleVelocityFps:      2600,
    ...overrides,
  };
}

function makeRecord2() {
  return {
    id:                     'usr-9c0d1e2f3a4b5c6d',
    name:                   '300 BLK subsonic',
    shortName:              'BLK SUB',
    bulletWeightGrains:     220,
    ballisticCoefficientG1: 0.608,
    ballisticCoefficientG7: null,
    bulletDiameterInches:   0.308,
    muzzleVelocityFps:      1010,
  };
}

// ── A: newCustomBulletId ───────────────────────────────────────────────────────
describe('newCustomBulletId', () => {
  test('returns an id matching CUSTOM_BULLET_ID_RE', () => {
    const id = newCustomBulletId(new Set());
    expect(CUSTOM_BULLET_ID_RE.test(id)).toBe(true);
  });

  test('generated id passes url-state decodeState as a bullet param', () => {
    const id = newCustomBulletId(new Set());
    const result = decodeState(`?b=${id}`);
    expect(result.bulletIds).toContain(id);
  });

  test('regenerates on collision', () => {
    // Control getRandomValues to return a colliding value first, then a unique one
    let callCount = 0;
    const original = global.crypto.getRandomValues;
    global.crypto.getRandomValues = buf => {
      callCount++;
      if (callCount === 1) {
        // Return bytes that produce 'usr-aabbccddaabbccdd'
        const hex = 'aabbccddaabbccdd';
        for (let i = 0; i < 8; i++) {
          buf[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
      } else {
        // Return different bytes
        for (let i = 0; i < 8; i++) buf[i] = i + 1;
      }
      return buf;
    };

    const collidingId = 'usr-aabbccddaabbccdd';
    const existing = new Set([collidingId]);
    const id = newCustomBulletId(existing);
    expect(id).not.toBe(collidingId);
    expect(CUSTOM_BULLET_ID_RE.test(id)).toBe(true);
    expect(callCount).toBe(2);

    global.crypto.getRandomValues = original;
  });
});

// ── B: isCustomBulletId ────────────────────────────────────────────────────────
describe('isCustomBulletId', () => {
  test('true for a valid custom id', () => {
    expect(isCustomBulletId('usr-3f2b8c1e9a4d4e6f')).toBe(true);
  });

  test('false for each BULLET_CATALOG id', () => {
    BULLET_CATALOG.forEach(b => {
      expect(isCustomBulletId(b.id)).toBe(false);
    });
  });

  test('false for special ids: custom, bc-solve', () => {
    expect(isCustomBulletId('custom')).toBe(false);
    expect(isCustomBulletId('bc-solve')).toBe(false);
  });

  test('false for usr- with uppercase hex', () => {
    expect(isCustomBulletId('usr-XYZ1234567890abc')).toBe(false);
  });

  test('false for usr- with only 15 hex digits', () => {
    expect(isCustomBulletId('usr-' + 'a'.repeat(15))).toBe(false);
  });

  test('false for usr- with 17 hex digits', () => {
    expect(isCustomBulletId('usr-' + 'a'.repeat(17))).toBe(false);
  });

  test('false for empty string', () => {
    expect(isCustomBulletId('')).toBe(false);
  });
});

// ── C: Catalog guard ───────────────────────────────────────────────────────────
describe('Catalog guard', () => {
  test('no BULLET_CATALOG id starts with usr-', () => {
    BULLET_CATALOG.forEach(b => {
      expect(b.id.startsWith('usr-')).toBe(false);
    });
  });
});

// ── D: customColor ─────────────────────────────────────────────────────────────
describe('customColor', () => {
  test('deterministic for the same id', () => {
    const id = 'usr-3f2b8c1e9a4d4e6f';
    expect(customColor(id)).toBe(customColor(id));
  });

  test('always a member of CUSTOM_BULLET_PALETTE', () => {
    const ids = [
      'usr-0000000000000000',
      'usr-ffffffffffffffff',
      'usr-3f2b8c1e9a4d4e6f',
      'usr-9c0d1e2f3a4b5c6d',
    ];
    ids.forEach(id => {
      expect(CUSTOM_BULLET_PALETTE).toContain(customColor(id));
    });
  });

  test('CUSTOM_BULLET_PALETTE has no overlap with built-in hexColors', () => {
    const builtInColors = new Set(BULLET_CATALOG.map(b => b.hexColor));
    CUSTOM_BULLET_PALETTE.forEach(color => {
      expect(builtInColors.has(color)).toBe(false);
    });
  });
});

// ── E: validateCustomBulletInput ───────────────────────────────────────────────
describe('validateCustomBulletInput', () => {
  const baseCtx = { records: [], builtInNames: BULLET_CATALOG.map(b => b.name), editingId: null };

  function validRaw(overrides = {}) {
    return {
      name:                   '175gr SMK handload',
      shortName:              '308 175',
      bulletWeightGrains:     '175',
      ballisticCoefficientG1: '0.505',
      ballisticCoefficientG7: '0.243',
      bulletDiameterInches:   '0.308',
      muzzleVelocityFps:      '2600',
      ...overrides,
    };
  }

  test('all valid => ok with trimmed strings and correct values', () => {
    const result = validateCustomBulletInput(validRaw(), baseCtx);
    expect(result.ok).toBe(true);
    expect(result.value.name).toBe('175gr SMK handload');
    expect(result.value.shortName).toBe('308 175');
    expect(result.value.bulletWeightGrains).toBe(175);
    expect(result.value.ballisticCoefficientG7).toBe(0.243);
  });

  test('G7 blank => null', () => {
    const result = validateCustomBulletInput(validRaw({ ballisticCoefficientG7: '' }), baseCtx);
    expect(result.ok).toBe(true);
    expect(result.value.ballisticCoefficientG7).toBeNull();
  });

  // Missing required fields
  const requiredFields = [
    ['name',                   'Name is required'],
    ['shortName',              'Short name is required'],
    ['bulletWeightGrains',     'Mass is required'],
    ['ballisticCoefficientG1', 'BC G1 is required'],
    ['bulletDiameterInches',   'Diameter is required'],
    ['muzzleVelocityFps',      'Muzzle velocity is required'],
  ];
  requiredFields.forEach(([field, msg]) => {
    test(`${field} blank => required error`, () => {
      const result = validateCustomBulletInput(validRaw({ [field]: '' }), baseCtx);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.field === field && e.message === msg)).toBe(true);
    });
  });

  // Not a number
  const numericFields = [
    ['bulletWeightGrains',     'Mass must be a number'],
    ['ballisticCoefficientG1', 'BC G1 must be a number'],
    ['ballisticCoefficientG7', 'BC G7 must be a number'],
    ['bulletDiameterInches',   'Diameter must be a number'],
    ['muzzleVelocityFps',      'Muzzle velocity must be a number'],
  ];
  ['abc', '-5', '1e3', '0x10', 'Infinity'].forEach(badVal => {
    numericFields.forEach(([field, msg]) => {
      test(`${field} = '${badVal}' => not a number`, () => {
        const result = validateCustomBulletInput(validRaw({ [field]: badVal }), baseCtx);
        expect(result.ok).toBe(false);
        const hasErr = result.errors.some(e => e.field === field && e.message.includes('must be a number'));
        expect(hasErr).toBe(true);
      });
    });
  });

  // Out of range
  const rangeTests = [
    ['bulletWeightGrains',     '0.9',   '1001'],
    ['ballisticCoefficientG1', '0.009', '1.201'],
    ['ballisticCoefficientG7', '0.009', '1.001'],
    ['bulletDiameterInches',   '0.09',  '1.001'],
    ['muzzleVelocityFps',      '299',   '5001'],
  ];
  rangeTests.forEach(([field, below, above]) => {
    test(`${field} below min => out-of-range error`, () => {
      const result = validateCustomBulletInput(validRaw({ [field]: below }), baseCtx);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.field === field && e.message.includes('must be between'))).toBe(true);
    });
    test(`${field} above max => out-of-range error`, () => {
      const result = validateCustomBulletInput(validRaw({ [field]: above }), baseCtx);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.field === field && e.message.includes('must be between'))).toBe(true);
    });
  });

  // Exact boundaries accepted
  test('bulletWeightGrains = 1 (min) accepted', () => {
    expect(validateCustomBulletInput(validRaw({ bulletWeightGrains: '1' }), baseCtx).ok).toBe(true);
  });
  test('bulletWeightGrains = 1000 (max) accepted', () => {
    expect(validateCustomBulletInput(validRaw({ bulletWeightGrains: '1000' }), baseCtx).ok).toBe(true);
  });
  test('ballisticCoefficientG1 = 0.01 (min) accepted', () => {
    expect(validateCustomBulletInput(validRaw({ ballisticCoefficientG1: '0.01' }), baseCtx).ok).toBe(true);
  });
  test('ballisticCoefficientG1 = 1.2 (max) accepted', () => {
    expect(validateCustomBulletInput(validRaw({ ballisticCoefficientG1: '1.2' }), baseCtx).ok).toBe(true);
  });
  test('muzzleVelocityFps = 300 (min) accepted', () => {
    expect(validateCustomBulletInput(validRaw({ muzzleVelocityFps: '300' }), baseCtx).ok).toBe(true);
  });
  test('muzzleVelocityFps = 5000 (max) accepted', () => {
    expect(validateCustomBulletInput(validRaw({ muzzleVelocityFps: '5000' }), baseCtx).ok).toBe(true);
  });

  // Name validations
  test('name empty or whitespace => Name is required', () => {
    expect(validateCustomBulletInput(validRaw({ name: '   ' }), baseCtx).ok).toBe(false);
  });

  test('name 65 chars => length error', () => {
    const result = validateCustomBulletInput(validRaw({ name: 'a'.repeat(65) }), baseCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.message.includes('64 characters'))).toBe(true);
  });

  test('name with control char => invalid characters error', () => {
    const result = validateCustomBulletInput(validRaw({ name: 'bad\u0001name' }), baseCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.message.includes('invalid characters'))).toBe(true);
  });

  test('name with bidi override => invalid characters error', () => {
    const result = validateCustomBulletInput(validRaw({ name: 'bad‮name' }), baseCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.message.includes('invalid characters'))).toBe(true);
  });

  test('name matching built-in name case-insensitively => matches built-in error', () => {
    const builtInName = BULLET_CATALOG[0].name;
    const result = validateCustomBulletInput(validRaw({ name: builtInName.toUpperCase() }), baseCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.message.includes('built-in'))).toBe(true);
  });

  test('name duplicating another custom in different case => duplicate error', () => {
    const existingRecord = makeRecord({ name: 'My Custom Load' });
    const ctx = { records: [existingRecord], builtInNames: [], editingId: null };
    const result = validateCustomBulletInput(validRaw({ name: 'MY CUSTOM LOAD' }), ctx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.message.includes('already exists'))).toBe(true);
  });

  test('editing a record does not trigger duplicate error for its own name', () => {
    const existingRecord = makeRecord({ name: 'My Custom Load' });
    const ctx = { records: [existingRecord], builtInNames: [], editingId: existingRecord.id };
    const result = validateCustomBulletInput(validRaw({ name: 'My Custom Load' }), ctx);
    expect(result.ok).toBe(true);
  });

  // shortName validations
  test('shortName empty => Short name is required', () => {
    const result = validateCustomBulletInput(validRaw({ shortName: '' }), baseCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.field === 'shortName' && e.message.includes('required'))).toBe(true);
  });

  test('shortName 17 chars => too long error', () => {
    const result = validateCustomBulletInput(validRaw({ shortName: 'a'.repeat(17) }), baseCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.message.includes('16 characters'))).toBe(true);
  });

  test('shortName with control char => invalid characters error', () => {
    const result = validateCustomBulletInput(validRaw({ shortName: 'bad\u0002name' }), baseCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.field === 'shortName' && e.message.includes('invalid'))).toBe(true);
  });

  // Form-level limit
  test('50 records + add => form limit error', () => {
    const records = Array.from({ length: 50 }, (_, i) => makeRecord({
      id: `usr-${String(i).padStart(16, '0')}`, name: `Bullet ${i}`
    }));
    const ctx = { records, builtInNames: [], editingId: null };
    const result = validateCustomBulletInput(validRaw(), ctx);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.field === 'form' && e.message.includes('50'))).toBe(true);
  });

  test('50 records + edit => no form limit error', () => {
    const records = Array.from({ length: 50 }, (_, i) => makeRecord({
      id: `usr-${String(i).padStart(16, '0')}`, name: `Bullet ${i}`
    }));
    const editId = records[0].id;
    const ctx = { records, builtInNames: [], editingId: editId };
    const result = validateCustomBulletInput(validRaw(), ctx);
    // No form-level error (but validation may succeed or fail on other fields)
    const errors = result.errors || [];
    expect(errors.some(e => e.field === 'form')).toBe(false);
  });

  test('null/undefined fields => treated as blank (required error, not crash)', () => {
    // Covers the `?? ''` nullish-coalescing branches in parseNumericField and string fields
    const result = validateCustomBulletInput(
      { name: null, shortName: undefined, bulletWeightGrains: null,
        ballisticCoefficientG1: undefined, bulletDiameterInches: null, muzzleVelocityFps: null },
      baseCtx
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.field === 'name')).toBe(true);
    expect(result.errors.some(e => e.field === 'shortName')).toBe(true);
    expect(result.errors.some(e => e.field === 'bulletWeightGrains')).toBe(true);
  });

  test('multiple field errors reported together, one per field', () => {
    const result = validateCustomBulletInput(
      validRaw({ name: '', shortName: '', bulletWeightGrains: '' }),
      baseCtx
    );
    expect(result.ok).toBe(false);
    const fields = result.errors.map(e => e.field);
    expect(fields).toContain('name');
    expect(fields).toContain('shortName');
    expect(fields).toContain('bulletWeightGrains');
    // Only one error per field
    expect(fields.filter(f => f === 'name').length).toBe(1);
  });
});

// ── F: isValidCustomBulletRecord ───────────────────────────────────────────────
describe('isValidCustomBulletRecord', () => {
  test('a valid record passes', () => {
    expect(isValidCustomBulletRecord(makeRecord())).toBe(true);
  });

  test('null => false', () => {
    expect(isValidCustomBulletRecord(null)).toBe(false);
  });

  test('array => false', () => {
    expect(isValidCustomBulletRecord([])).toBe(false);
  });

  test('non-object => false', () => {
    expect(isValidCustomBulletRecord('string')).toBe(false);
    expect(isValidCustomBulletRecord(42)).toBe(false);
  });

  test('bad id => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ id: 'bad-id' }))).toBe(false);
  });

  test('array id that stringifies to valid pattern => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ id: ['usr-0123456789abcdef'] }))).toBe(false);
  });

  test('missing required property => false', () => {
    const r = makeRecord();
    delete r.name;
    expect(isValidCustomBulletRecord(r)).toBe(false);
  });

  test('name wrong type => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ name: 123 }))).toBe(false);
  });

  test('untrimmed name => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ name: ' padded ' }))).toBe(false);
  });

  test('empty name => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ name: '' }))).toBe(false);
  });

  test('name > 64 chars => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ name: 'a'.repeat(65) }))).toBe(false);
  });

  test('name with forbidden char => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ name: 'bad\u0001name' }))).toBe(false);
  });

  const numFields = [
    ['bulletWeightGrains',     175],
    ['ballisticCoefficientG1', 0.505],
    ['bulletDiameterInches',   0.308],
    ['muzzleVelocityFps',      2600],
  ];

  numFields.forEach(([field, goodVal]) => {
    test(`${field} wrong type => false`, () => {
      expect(isValidCustomBulletRecord(makeRecord({ [field]: '175' }))).toBe(false);
    });
    test(`${field} NaN => false`, () => {
      expect(isValidCustomBulletRecord(makeRecord({ [field]: NaN }))).toBe(false);
    });
    test(`${field} Infinity => false`, () => {
      expect(isValidCustomBulletRecord(makeRecord({ [field]: Infinity }))).toBe(false);
    });
    test(`${field} out of range => false`, () => {
      const lim = CUSTOM_BULLET_LIMITS[field];
      expect(isValidCustomBulletRecord(makeRecord({ [field]: lim.min - 1 }))).toBe(false);
    });
  });

  test('shortName wrong type => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ shortName: 123 }))).toBe(false);
  });

  test('shortName untrimmed => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ shortName: ' BLK' }))).toBe(false);
  });

  test('shortName empty => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ shortName: '' }))).toBe(false);
  });

  test('shortName > 16 chars => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ shortName: 'a'.repeat(17) }))).toBe(false);
  });

  test('shortName with forbidden char => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ shortName: 'bad\u0003name' }))).toBe(false);
  });

  test('ballisticCoefficientG7 null => passes', () => {
    expect(isValidCustomBulletRecord(makeRecord({ ballisticCoefficientG7: null }))).toBe(true);
  });

  test('ballisticCoefficientG7 undefined => false', () => {
    const r = makeRecord();
    delete r.ballisticCoefficientG7;
    expect(isValidCustomBulletRecord(r)).toBe(false);
  });

  test('ballisticCoefficientG7 out of range => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ ballisticCoefficientG7: 1.1 }))).toBe(false);
  });

  test('ballisticCoefficientG7 as string => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ ballisticCoefficientG7: '0.243' }))).toBe(false);
  });

  test('ballisticCoefficientG7 NaN => false', () => {
    expect(isValidCustomBulletRecord(makeRecord({ ballisticCoefficientG7: NaN }))).toBe(false);
  });
});

// ── G: loadCustomBullets ───────────────────────────────────────────────────────
describe('loadCustomBullets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('absent key => empty status', () => {
    const { records, status } = loadCustomBullets();
    expect(status).toBe('empty');
    expect(records).toHaveLength(0);
  });

  test('invalid JSON => corrupt', () => {
    localStorage.setItem(CUSTOM_BULLETS_KEY, '{not valid json}');
    const { records, status } = loadCustomBullets();
    expect(status).toBe('corrupt');
    expect(records).toHaveLength(0);
  });

  test('JSON object (not array) => corrupt', () => {
    localStorage.setItem(CUSTOM_BULLETS_KEY, '{}');
    const { records, status } = loadCustomBullets();
    expect(status).toBe('corrupt');
  });

  test('getItem throws => unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('x', 'SecurityError');
    });
    const { records, status } = loadCustomBullets();
    expect(status).toBe('unavailable');
    expect(records).toHaveLength(0);
    jest.restoreAllMocks();
  });

  test('localStorage getter throws => unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('blocked', 'SecurityError'); },
      configurable: true,
    });
    const { records, status } = loadCustomBullets();
    expect(status).toBe('unavailable');
    Object.defineProperty(window, 'localStorage', original);
  });

  test('invalid elements are dropped', () => {
    const r = makeRecord();
    const bad = { id: 'bad', name: 'bad' };
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([r, bad]));
    const { records, status } = loadCustomBullets();
    expect(status).toBe('ok');
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(r.id);
  });

  test('duplicate id => first wins', () => {
    const r1 = makeRecord({ name: 'First' });
    const r2 = makeRecord({ name: 'Second' }); // same id
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([r1, r2]));
    const { records } = loadCustomBullets();
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('First');
  });

  test('duplicate name case-insensitively => first wins', () => {
    const r1 = makeRecord({ id: 'usr-0000000000000001', name: 'My Load' });
    const r2 = makeRecord({ id: 'usr-0000000000000002', name: 'MY LOAD' });
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([r1, r2]));
    const { records } = loadCustomBullets();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(r1.id);
  });

  test('60 valid => first 50 kept', () => {
    const recs = Array.from({ length: 60 }, (_, i) => makeRecord({
      id:   `usr-${String(i).padStart(16, '0')}`,
      name: `Bullet ${i}`,
    }));
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify(recs));
    const { records } = loadCustomBullets();
    expect(records).toHaveLength(50);
    expect(records[0].id).toBe(recs[0].id);
  });

  test('extra properties are stripped', () => {
    const r = { ...makeRecord(), extraProp: 'should be stripped' };
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([r]));
    const { records } = loadCustomBullets();
    expect(records[0]).not.toHaveProperty('extraProp');
  });

  test('__proto__ in JSON text does not pollute Object.prototype', () => {
    const payload = '[{"__proto__":{"polluted":"yes"},"id":"usr-3f2b8c1e9a4d4e6f","name":"175gr SMK handload","shortName":"308 175","bulletWeightGrains":175,"ballisticCoefficientG1":0.505,"ballisticCoefficientG7":0.243,"bulletDiameterInches":0.308,"muzzleVelocityFps":2600}]';
    localStorage.setItem(CUSTOM_BULLETS_KEY, payload);
    loadCustomBullets();
    expect(({}).polluted).toBeUndefined();
  });

  test('never calls setItem', () => {
    const r = makeRecord();
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([r]));
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    loadCustomBullets();
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});

// ── H: saveCustomBullets ───────────────────────────────────────────────────────
describe('saveCustomBullets', () => {
  beforeEach(() => { localStorage.clear(); });

  test('writes exactly JSON.stringify(records) under the key', () => {
    const records = [makeRecord()];
    saveCustomBullets(records);
    expect(localStorage.getItem(CUSTOM_BULLETS_KEY)).toBe(JSON.stringify(records));
  });

  test('setItem throws => { ok:false, error:"storage" } and console.warn', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('x', 'QuotaExceededError');
    });
    const result = saveCustomBullets([makeRecord()]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('storage');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('storage write failed'),
      expect.anything()
    );
    jest.restoreAllMocks();
  });

  test('empty list writes "[]"', () => {
    saveCustomBullets([]);
    expect(localStorage.getItem(CUSTOM_BULLETS_KEY)).toBe('[]');
  });

  test('round-trip: save then load yields deep-equal records', () => {
    const records = [makeRecord(), makeRecord2()];
    saveCustomBullets(records);
    const { records: loaded } = loadCustomBullets();
    expect(loaded).toEqual(records);
  });
});

// ── I: upsertCustomBullet / removeCustomBullet ────────────────────────────────
describe('upsertCustomBullet', () => {
  test('add appends with a fresh id', () => {
    const result = upsertCustomBullet([], {
      name: 'x', shortName: 'x', bulletWeightGrains: 100,
      ballisticCoefficientG1: 0.3, ballisticCoefficientG7: null,
      bulletDiameterInches: 0.3, muzzleVelocityFps: 1000,
    }, null);
    expect(result).toHaveLength(1);
    expect(CUSTOM_BULLET_ID_RE.test(result[0].id)).toBe(true);
  });

  test('edit keeps id and index', () => {
    const r = makeRecord();
    const updated = upsertCustomBullet([r], { ...r, name: 'Updated Name' }, r.id);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(r.id);
    expect(updated[0].name).toBe('Updated Name');
  });

  test('unknown editing id => unchanged copy', () => {
    const r = makeRecord();
    const result = upsertCustomBullet([r], { ...r, name: 'New' }, 'usr-nonexistentid00');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe(r.name);
  });

  test('inputs are never mutated', () => {
    const original = [makeRecord()];
    const frozen = Object.freeze([...original]);
    const result = upsertCustomBullet(original, { ...original[0], name: 'New' }, null);
    expect(original).toHaveLength(1);
    expect(result).not.toBe(original);
  });
});

describe('removeCustomBullet', () => {
  test('removes the record with the given id', () => {
    const r = makeRecord();
    const result = removeCustomBullet([r], r.id);
    expect(result).toHaveLength(0);
  });

  test('unknown id => equal copy', () => {
    const r = makeRecord();
    const result = removeCustomBullet([r], 'usr-0000000000000000');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(r.id);
  });

  test('inputs are never mutated', () => {
    const original = [makeRecord()];
    removeCustomBullet(original, original[0].id);
    expect(original).toHaveLength(1);
  });
});

// ── J: toBullet / mergeCatalog ────────────────────────────────────────────────
describe('toBullet', () => {
  test('175gr => ~11.33980925 g (toBeCloseTo 9)', () => {
    const b = toBullet(makeRecord({ bulletWeightGrains: 175 }));
    expect(b.bulletWeightGrams).toBeCloseTo(175 * GRAINS_TO_GRAMS, 9);
  });

  test('2600 fps => ~792.48 m/s (toBeCloseTo 2)', () => {
    const b = toBullet(makeRecord({ muzzleVelocityFps: 2600 }));
    expect(b.muzzleVelocityMps).toBeCloseTo(2600 * FPS_TO_MPS, 2);
  });

  test('0.308 in => ~7.8232 mm (toBeCloseTo 4)', () => {
    const b = toBullet(makeRecord({ bulletDiameterInches: 0.308 }));
    expect(b.bulletDiameterMm).toBeCloseTo(0.308 * INCH_TO_MM, 4);
  });

  test('muzzleEnergyJoules formula matches', () => {
    const r = makeRecord();
    const b = toBullet(r);
    const expectedE = Math.round(0.5 * (b.bulletWeightGrams / 1000) * b.muzzleVelocityMps ** 2);
    expect(b.muzzleEnergyJoules).toBe(expectedE);
  });

  test('caliber === "Custom"', () => {
    expect(toBullet(makeRecord()).caliber).toBe('Custom');
  });

  test('extension fields are present', () => {
    const b = toBullet(makeRecord());
    expect(b.shortName).toBe('308 175');
    expect(b.ballisticCoefficientG7).toBe(0.243);
    expect(b.source).toBe('custom');
  });
});

describe('mergeCatalog', () => {
  test('merge order is built-ins then customs', () => {
    const r = makeRecord();
    const merged = mergeCatalog(BULLET_CATALOG, [r]);
    expect(merged[0].id).toBe(BULLET_CATALOG[0].id);
    expect(merged[merged.length - 1].id).toBe(r.id);
  });

  test('built-in array is not mutated', () => {
    const builtIns = [...BULLET_CATALOG];
    mergeCatalog(builtIns, [makeRecord()]);
    expect(builtIns).toHaveLength(BULLET_CATALOG.length);
  });

  test('a record whose id collides with a built-in is excluded', () => {
    const collidingId = BULLET_CATALOG[0].id;
    const r = makeRecord({ id: collidingId });
    const merged = mergeCatalog(BULLET_CATALOG, [r]);
    expect(merged.filter(b => b.id === collidingId)).toHaveLength(1);
  });
});

// ── K: Simulate compatibility ─────────────────────────────────────────────────
describe('Simulate compatibility (real engine)', () => {
  const baseParams = {
    zeroRangeMeters:      100,
    maxRangeMeters:       1000,
    stepMeters:           25,
    temperatureC:         15,
    altitudeMeters:       0,
    windSpeedKph:         0,
    windDirectionDeg:     90,
    sightHeightMm:        38.1,
    shootingAngleDegrees: 0,
    dragModel:            'G1',
  };

  const cornerCases = [
    { label: 'all-min',           bwg: 1,    bcG1: 0.01, dia: 0.1, mv: 300  },
    { label: 'all-max',           bwg: 1000, bcG1: 1.2,  dia: 1.0, mv: 5000 },
    { label: 'min-mass + max-MV', bwg: 1,    bcG1: 0.5,  dia: 0.3, mv: 5000 },
    { label: 'max-mass + min-MV', bwg: 1000, bcG1: 0.5,  dia: 0.3, mv: 300  },
    { label: 'BC 0.01',           bwg: 100,  bcG1: 0.01, dia: 0.3, mv: 1000 },
    { label: 'BC 1.2',            bwg: 100,  bcG1: 1.2,  dia: 0.3, mv: 1000 },
  ];

  cornerCases.forEach(({ label, bwg, bcG1, dia, mv }) => {
    test(`${label} does not throw and returns finite points`, () => {
      const rec = makeRecord({
        bulletWeightGrains:     bwg,
        ballisticCoefficientG1: bcG1,
        bulletDiameterInches:   dia,
        muzzleVelocityFps:      mv,
        ballisticCoefficientG7: null,
      });
      const bullet = toBullet(rec);
      const result = simulate(bullet, { ...baseParams, bulletWeightGrams: bullet.bulletWeightGrams, muzzleVelocityMps: bullet.muzzleVelocityMps, ballisticCoefficient: bullet.ballisticCoefficient, bulletDiameterMm: bullet.bulletDiameterMm });
      expect(result.points.length).toBeGreaterThan(0);
      result.points.forEach(p => {
        expect(Number.isFinite(p.dropCm)).toBe(true);
        expect(Number.isFinite(p.velocityMps)).toBe(true);
      });
    });

    test(`${label} with G7 via bulletForDragModel does not throw`, () => {
      const rec = makeRecord({
        bulletWeightGrains:     bwg,
        ballisticCoefficientG1: bcG1,
        ballisticCoefficientG7: bcG1 * 0.5,
        bulletDiameterInches:   dia,
        muzzleVelocityFps:      mv,
      });
      const bullet = toBullet(rec);
      const g7Bullet = bulletForDragModel(bullet, 'G7');
      const result = simulate(g7Bullet, { ...baseParams, dragModel: 'G7', bulletWeightGrams: g7Bullet.bulletWeightGrams, muzzleVelocityMps: g7Bullet.muzzleVelocityMps, ballisticCoefficient: g7Bullet.ballisticCoefficient, bulletDiameterMm: g7Bullet.bulletDiameterMm });
      expect(result.points.length).toBeGreaterThan(0);
    });
  });
});

// ── L: bulletForDragModel ──────────────────────────────────────────────────────
describe('bulletForDragModel', () => {
  test('G7 + number G7 BC => new object with G7 BC as ballisticCoefficient', () => {
    const b = { ...toBullet(makeRecord()), ballisticCoefficientG7: 0.243 };
    const result = bulletForDragModel(b, 'G7');
    expect(result).not.toBe(b);
    expect(result.ballisticCoefficient).toBe(0.243);
    expect(result.ballisticCoefficientG1).toBe(b.ballisticCoefficientG1);
  });

  test('G7 + null G7 BC => same reference', () => {
    const b = { ...toBullet(makeRecord({ ballisticCoefficientG7: null })) };
    expect(bulletForDragModel(b, 'G7')).toBe(b);
  });

  test('G1 drag model => same reference', () => {
    const b = toBullet(makeRecord());
    expect(bulletForDragModel(b, 'G1')).toBe(b);
  });

  test('built-in bullet under G7 => same reference', () => {
    const builtIn = BULLET_CATALOG[0];
    expect(bulletForDragModel(builtIn, 'G7')).toBe(builtIn);
  });
});

// ── M: renderCustomBulletGroup ─────────────────────────────────────────────────
describe('renderCustomBulletGroup', () => {
  let listEl;
  const noop = () => {};

  beforeEach(() => {
    listEl = document.createElement('div');
    document.body.appendChild(listEl);
  });

  afterEach(() => {
    document.body.removeChild(listEl);
  });

  function makeCtx(overrides = {}) {
    return {
      selectedIds:   new Set(),
      storageStatus: 'ok',
      onToggle:      noop,
      onEdit:        noop,
      onDelete:      noop,
      ...overrides,
    };
  }

  test('group, heading, and role/aria-labelledby present', () => {
    renderCustomBulletGroup(listEl, [], makeCtx());
    const group = listEl.querySelector('#customBulletGroup');
    expect(group).not.toBeNull();
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-labelledby')).toBe('customBulletsHeading');
    expect(listEl.querySelector('#customBulletsHeading').textContent).toBe('Custom bullets');
  });

  test('0 customs + storage ok => empty-state p', () => {
    renderCustomBulletGroup(listEl, [], makeCtx());
    expect(listEl.querySelector('.bullet-group-empty')).not.toBeNull();
    expect(listEl.querySelector('.bullet-group-notice')).toBeNull();
  });

  test('storageStatus unavailable => notice, no empty-state', () => {
    renderCustomBulletGroup(listEl, [], makeCtx({ storageStatus: 'unavailable' }));
    expect(listEl.querySelector('.bullet-group-notice')).not.toBeNull();
    expect(listEl.querySelector('.bullet-group-empty')).toBeNull();
  });

  test('one card per custom bullet, in order', () => {
    const r1 = makeRecord();
    const r2 = makeRecord2();
    const b1 = toBullet(r1);
    const b2 = toBullet(r2);
    renderCustomBulletGroup(listEl, [b1, b2], makeCtx());
    const cards = listEl.querySelectorAll('.bullet-card--custom');
    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe('card-' + r1.id);
    expect(cards[1].id).toBe('card-' + r2.id);
  });

  test('spec line without G7', () => {
    const b = toBullet(makeRecord2());
    renderCustomBulletGroup(listEl, [b], makeCtx());
    const specs = listEl.querySelector('.bullet-specs').textContent;
    expect(specs).not.toContain('G7');
  });

  test('spec line with G7 when not null', () => {
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx());
    const specs = listEl.querySelector('.bullet-specs').textContent;
    expect(specs).toContain('G7');
  });

  test('--bullet-color equals customColor(id)', () => {
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx());
    const card = listEl.querySelector('.bullet-card--custom');
    expect(card.style.getPropertyValue('--bullet-color')).toBe(customColor(b.id));
  });

  test('selected bullet => active class and Delete disabled with title', () => {
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx({ selectedIds: new Set([b.id]) }));
    const card = listEl.querySelector('.bullet-card--custom');
    expect(card.classList.contains('active')).toBe(true);
    const delBtn = card.querySelector('.bullet-delete-btn');
    expect(delBtn.disabled).toBe(true);
    expect(delBtn.title).toBeTruthy();
  });

  test('card click => onToggle(id)', () => {
    const toggleFn = jest.fn();
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx({ onToggle: toggleFn }));
    const card = listEl.querySelector('.bullet-card--custom');
    card.click();
    expect(toggleFn).toHaveBeenCalledWith(b.id);
  });

  test('Edit click => onEdit and NOT onToggle', () => {
    const toggleFn = jest.fn();
    const editFn   = jest.fn();
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx({ onToggle: toggleFn, onEdit: editFn }));
    const editBtn = listEl.querySelector('.bullet-edit-btn');
    editBtn.click();
    expect(editFn).toHaveBeenCalledWith(b.id);
    expect(toggleFn).not.toHaveBeenCalled();
  });

  test('Delete click => onDelete and NOT onToggle', () => {
    const toggleFn  = jest.fn();
    const deleteFn  = jest.fn();
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx({ onToggle: toggleFn, onDelete: deleteFn }));
    const delBtn = listEl.querySelector('.bullet-delete-btn');
    delBtn.click();
    expect(deleteFn).toHaveBeenCalledWith(b.id);
    expect(toggleFn).not.toHaveBeenCalled();
  });

  test('bullet with bulletWeightGrains set => uses stored value directly', () => {
    // Covers the truthy branch of `b.bulletWeightGrains != null` (line ~392)
    const b = { ...toBullet(makeRecord({ bulletWeightGrains: 175 })), bulletWeightGrains: 175, muzzleVelocityFps: 2600, ballisticCoefficientG1: 0.505 };
    renderCustomBulletGroup(listEl, [b], makeCtx());
    const specs = listEl.querySelector('.bullet-specs').textContent;
    expect(specs).toContain('175');
    expect(specs).toContain('2600');
  });

  test('bullet without bulletWeightGrains => uses calculated gram fallback', () => {
    // Covers the false branch - toBullet() does not set bulletWeightGrains, muzzleVelocityFps, ballisticCoefficientG1
    const b = toBullet(makeRecord({ bulletWeightGrains: 175, muzzleVelocityFps: 2600 }));
    // ensure the extension props are absent (which is the current behaviour)
    delete b.bulletWeightGrains;
    delete b.muzzleVelocityFps;
    delete b.ballisticCoefficientG1;
    renderCustomBulletGroup(listEl, [b], makeCtx());
    const specs = listEl.querySelector('.bullet-specs').textContent;
    // should still display some numeric value
    expect(specs.length).toBeGreaterThan(0);
  });

  test('XSS: name and shortName render as literal text, no img element', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const r = makeRecord({ name: payload, shortName: payload });
    // Need to forge a valid record with trusted shortName for the actual stored version
    // but for rendering we pass a modified toBullet result
    const b = { ...toBullet(r), name: payload, shortName: payload };
    renderCustomBulletGroup(listEl, [b], makeCtx());
    expect(listEl.querySelector('img')).toBeNull();
    const nameEl = listEl.querySelector('.bullet-name');
    expect(nameEl.textContent).toBe(payload);
  });

  test('ACC-1: custom card has tabindex="0" and role="button"', () => {
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx());
    const card = listEl.querySelector('.bullet-card--custom');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.getAttribute('role')).toBe('button');
  });

  test('ACC-1: unselected custom card has aria-pressed="false"', () => {
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx());
    const card = listEl.querySelector('.bullet-card--custom');
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });

  test('ACC-1: selected custom card has aria-pressed="true"', () => {
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx({ selectedIds: new Set([b.id]) }));
    const card = listEl.querySelector('.bullet-card--custom');
    expect(card.getAttribute('aria-pressed')).toBe('true');
  });

  test('ACC-1: Enter key on custom card calls onToggle', () => {
    const toggleFn = jest.fn();
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx({ onToggle: toggleFn }));
    const card = listEl.querySelector('.bullet-card--custom');
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(toggleFn).toHaveBeenCalledWith(b.id);
  });

  test('ACC-1: Space key on custom card calls onToggle', () => {
    const toggleFn = jest.fn();
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx({ onToggle: toggleFn }));
    const card = listEl.querySelector('.bullet-card--custom');
    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(toggleFn).toHaveBeenCalledWith(b.id);
  });

  test('ACC-1: other keys on custom card do not call onToggle', () => {
    const toggleFn = jest.fn();
    const b = toBullet(makeRecord());
    renderCustomBulletGroup(listEl, [b], makeCtx({ onToggle: toggleFn }));
    const card = listEl.querySelector('.bullet-card--custom');
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(toggleFn).not.toHaveBeenCalled();
  });
});

// ── N: syncCustomDeleteGuards ──────────────────────────────────────────────────
describe('syncCustomDeleteGuards', () => {
  let listEl;

  beforeEach(() => {
    listEl = document.createElement('div');
    document.body.appendChild(listEl);
    // Build two custom cards
    const b1 = toBullet(makeRecord());
    const b2 = toBullet(makeRecord2());
    renderCustomBulletGroup(listEl, [b1, b2], {
      selectedIds: new Set(),
      storageStatus: 'ok',
      onToggle: () => {},
      onEdit:   () => {},
      onDelete: () => {},
    });
  });

  afterEach(() => {
    document.body.removeChild(listEl);
  });

  test('selected id => button disabled', () => {
    const r = makeRecord();
    syncCustomDeleteGuards(listEl, new Set([r.id]));
    const btn = listEl.querySelector('#card-' + r.id + ' .bullet-delete-btn');
    expect(btn.disabled).toBe(true);
  });

  test('unselected id => button not disabled', () => {
    const r = makeRecord();
    syncCustomDeleteGuards(listEl, new Set());
    const btn = listEl.querySelector('#card-' + r.id + ' .bullet-delete-btn');
    expect(btn.disabled).toBe(false);
  });

  test('resets .confirming buttons', () => {
    const r = makeRecord();
    const btn = listEl.querySelector('#card-' + r.id + ' .bullet-delete-btn');
    btn.classList.add('confirming');
    btn.textContent = 'Confirm';
    syncCustomDeleteGuards(listEl, new Set());
    expect(btn.classList.contains('confirming')).toBe(false);
    expect(btn.textContent).toBe('Delete');
  });

  test('card without .bullet-delete-btn => no-op for that card', () => {
    // Covers line 467 `if (!delBtn) return;`
    const listEl2 = document.createElement('div');
    document.body.appendChild(listEl2);
    const card = document.createElement('div');
    card.id = 'card-usr-3f2b8c1e9a4d4e6f';
    card.className = 'bullet-card--custom';
    // No delete button added
    listEl2.appendChild(card);
    expect(() => syncCustomDeleteGuards(listEl2, new Set())).not.toThrow();
    document.body.removeChild(listEl2);
  });

  test('.bullet-name absent => aria-label uses empty string', () => {
    // Covers line 472 `?.textContent ?? ''` when .bullet-name is absent
    const listEl3 = document.createElement('div');
    document.body.appendChild(listEl3);
    const card = document.createElement('div');
    card.id = 'card-usr-3f2b8c1e9a4d4e6f';
    card.className = 'bullet-card--custom';
    const btn = document.createElement('button');
    btn.className = 'bullet-delete-btn confirming';
    btn.textContent = 'Confirm';
    card.appendChild(btn);
    // No .bullet-name child
    listEl3.appendChild(card);
    expect(() => syncCustomDeleteGuards(listEl3, new Set())).not.toThrow();
    expect(btn.classList.contains('confirming')).toBe(false);
    document.body.removeChild(listEl3);
  });

  test('missing listEl => no-op', () => {
    expect(() => syncCustomDeleteGuards(null, new Set())).not.toThrow();
    expect(() => syncCustomDeleteGuards(undefined, new Set())).not.toThrow();
  });
});
