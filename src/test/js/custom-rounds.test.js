const {
  CUSTOM_ROUNDS_KEY, MAX_PRESETS, PRESET_NAME_MAX, DEFAULT_PRESET_NAME,
  isValidPreset, loadPresets, savePreset, deletePreset, renderPresetList, newPresetId,
} = require('../../main/resources/static/custom-rounds.js');

global.console.warn = jest.fn();

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makePreset(overrides = {}) {
  return {
    id:      '3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c',
    name:    'Test Load',
    weightG: 11.34,
    mvMps:   800,
    bc:      0.505,
    diaMm:   7.82,
    savedAt: '2026-11-01T14:03:22.511Z',
    ...overrides,
  };
}

function makePresetDOM() {
  document.body.innerHTML = `
    <div id="customPresetSection" hidden></div>
    <ul id="customPresetList"></ul>
  `;
}

beforeEach(() => {
  localStorage.clear();
  console.warn.mockClear();
  makePresetDOM();
});

// ── Constants ──────────────────────────────────────────────────────────────────
describe('constants', () => {
  test('CUSTOM_ROUNDS_KEY is bv_customRounds', () => expect(CUSTOM_ROUNDS_KEY).toBe('bv_customRounds'));
  test('MAX_PRESETS is 20', () => expect(MAX_PRESETS).toBe(20));
  test('PRESET_NAME_MAX is 64', () => expect(PRESET_NAME_MAX).toBe(64));
  test('DEFAULT_PRESET_NAME is Custom Load', () => expect(DEFAULT_PRESET_NAME).toBe('Custom Load'));
});

// ── isValidPreset ──────────────────────────────────────────────────────────────
describe('isValidPreset', () => {
  test('returns true for a valid preset', () => {
    expect(isValidPreset(makePreset())).toBe(true);
  });

  test('returns false for null', () => expect(isValidPreset(null)).toBe(false));
  test('returns false for a non-object', () => expect(isValidPreset('str')).toBe(false));
  test('returns false for an array', () => expect(isValidPreset([])).toBe(false));

  test('returns false when id is missing', () => {
    const { id: _id, ...p } = makePreset();
    expect(isValidPreset(p)).toBe(false);
  });

  test('returns false when id fails UUID v4 regex', () => {
    expect(isValidPreset(makePreset({ id: 'not-a-uuid' }))).toBe(false);
    expect(isValidPreset(makePreset({ id: '3f2b8c1e-9a4d-5e6f-b1c2-7d8e9f0a1b2c' }))).toBe(false); // version 5
  });

  test('returns false when name is empty string', () => {
    expect(isValidPreset(makePreset({ name: '' }))).toBe(false);
  });

  test('returns false when name exceeds 64 chars', () => {
    expect(isValidPreset(makePreset({ name: 'a'.repeat(65) }))).toBe(false);
  });

  test('returns true for name at max (64 chars)', () => {
    expect(isValidPreset(makePreset({ name: 'a'.repeat(64) }))).toBe(true);
  });

  test('returns false when name is not a string', () => {
    expect(isValidPreset(makePreset({ name: 42 }))).toBe(false);
  });

  test('returns false when weightG is zero', () => {
    expect(isValidPreset(makePreset({ weightG: 0 }))).toBe(false);
  });

  test('returns false when weightG exceeds 30', () => {
    expect(isValidPreset(makePreset({ weightG: 30.01 }))).toBe(false);
  });

  test('returns true for weightG at max (30)', () => {
    expect(isValidPreset(makePreset({ weightG: 30 }))).toBe(true);
  });

  test('returns false when weightG is not finite', () => {
    expect(isValidPreset(makePreset({ weightG: Infinity }))).toBe(false);
    expect(isValidPreset(makePreset({ weightG: NaN }))).toBe(false);
  });

  test('returns false when weightG is not a number', () => {
    expect(isValidPreset(makePreset({ weightG: '11' }))).toBe(false);
  });

  test('returns false when mvMps is zero', () => {
    expect(isValidPreset(makePreset({ mvMps: 0 }))).toBe(false);
  });

  test('returns false when mvMps exceeds 2000', () => {
    expect(isValidPreset(makePreset({ mvMps: 2001 }))).toBe(false);
  });

  test('returns true for mvMps at max (2000)', () => {
    expect(isValidPreset(makePreset({ mvMps: 2000 }))).toBe(true);
  });

  test('returns false when bc is zero', () => {
    expect(isValidPreset(makePreset({ bc: 0 }))).toBe(false);
  });

  test('returns false when bc exceeds 1.2', () => {
    expect(isValidPreset(makePreset({ bc: 1.201 }))).toBe(false);
  });

  test('returns true for bc at max (1.2)', () => {
    expect(isValidPreset(makePreset({ bc: 1.2 }))).toBe(true);
  });

  test('returns false when diaMm is zero', () => {
    expect(isValidPreset(makePreset({ diaMm: 0 }))).toBe(false);
  });

  test('returns false when diaMm exceeds 25', () => {
    expect(isValidPreset(makePreset({ diaMm: 25.01 }))).toBe(false);
  });

  test('returns true for diaMm at max (25)', () => {
    expect(isValidPreset(makePreset({ diaMm: 25 }))).toBe(true);
  });

  test('returns false when savedAt is not a string', () => {
    expect(isValidPreset(makePreset({ savedAt: 123 }))).toBe(false);
  });

  test('returns false when savedAt exceeds 40 chars', () => {
    expect(isValidPreset(makePreset({ savedAt: '2026-11-01T14:03:22.511Z' + 'x'.repeat(17) }))).toBe(false);
  });

  test('returns false when savedAt is not a parseable date', () => {
    expect(isValidPreset(makePreset({ savedAt: 'not-a-date' }))).toBe(false);
  });
});

// ── loadPresets ────────────────────────────────────────────────────────────────
describe('loadPresets', () => {
  test('returns [] when key is absent', () => {
    expect(loadPresets()).toEqual([]);
  });

  test('returns [] on JSON parse failure', () => {
    localStorage.setItem(CUSTOM_ROUNDS_KEY, 'not-json{{{');
    expect(loadPresets()).toEqual([]);
  });

  test('returns [] when stored value is not an array', () => {
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify({ foo: 1 }));
    expect(loadPresets()).toEqual([]);
  });

  test('returns [] when localStorage.getItem throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => { throw new Error('SecurityError'); });
    expect(loadPresets()).toEqual([]);
    spy.mockRestore();
  });

  test('drops invalid elements silently', () => {
    const good = makePreset();
    const bad  = { id: 'bad', name: 'x', weightG: 0, mvMps: 0, bc: 0, diaMm: 0, savedAt: 'bad' };
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify([good, bad]));
    const result = loadPresets();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(good.id);
  });

  test('strips extra properties', () => {
    const withExtra = { ...makePreset(), extra: 'should-be-stripped' };
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify([withExtra]));
    const [p] = loadPresets();
    expect(p.extra).toBeUndefined();
    expect(Object.keys(p)).toEqual(['id', 'name', 'weightG', 'mvMps', 'bc', 'diaMm', 'savedAt']);
  });

  test('caps at 20 elements', () => {
    const presets = Array.from({ length: 25 }, (_, i) =>
      makePreset({ id: `3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b${String(i).padStart(2, '0')}`, name: `Load ${i}` }),
    );
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify(presets));
    expect(loadPresets()).toHaveLength(20);
  });

  test('returns the full 7-field objects in stored order', () => {
    const p = makePreset();
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify([p]));
    const [loaded] = loadPresets();
    expect(loaded.id).toBe(p.id);
    expect(loaded.name).toBe(p.name);
    expect(loaded.weightG).toBe(p.weightG);
    expect(loaded.mvMps).toBe(p.mvMps);
    expect(loaded.bc).toBe(p.bc);
    expect(loaded.diaMm).toBe(p.diaMm);
    expect(loaded.savedAt).toBe(p.savedAt);
  });
});

// ── savePreset ─────────────────────────────────────────────────────────────────
describe('savePreset', () => {
  const VALID_INPUT = { name: 'My Load', weightG: 11.34, mvMps: 800, bc: 0.505, diaMm: 7.82 };

  test('saves a valid preset and returns ok:true', () => {
    const result = savePreset(VALID_INPUT);
    expect(result.ok).toBe(true);
    expect(result.replaced).toBe(false);
    expect(result.preset.name).toBe('My Load');
    expect(result.presets).toHaveLength(1);
    expect(loadPresets()).toHaveLength(1);
  });

  test('uses DEFAULT_PRESET_NAME when name is empty', () => {
    const result = savePreset({ ...VALID_INPUT, name: '' });
    expect(result.ok).toBe(true);
    expect(result.preset.name).toBe(DEFAULT_PRESET_NAME);
  });

  test('uses DEFAULT_PRESET_NAME when name is whitespace-only', () => {
    const result = savePreset({ ...VALID_INPUT, name: '   ' });
    expect(result.ok).toBe(true);
    expect(result.preset.name).toBe(DEFAULT_PRESET_NAME);
  });

  test('uses DEFAULT_PRESET_NAME when name is not a string', () => {
    const result = savePreset({ ...VALID_INPUT, name: null });
    expect(result.ok).toBe(true);
    expect(result.preset.name).toBe(DEFAULT_PRESET_NAME);
  });

  test('truncates name to 64 chars', () => {
    const result = savePreset({ ...VALID_INPUT, name: 'a'.repeat(80) });
    expect(result.ok).toBe(true);
    expect(result.preset.name).toHaveLength(64);
  });

  test('trims name', () => {
    const result = savePreset({ ...VALID_INPUT, name: '  Load  ' });
    expect(result.ok).toBe(true);
    expect(result.preset.name).toBe('Load');
  });

  test('generates a valid UUID v4 for the new preset id', () => {
    const result = savePreset(VALID_INPUT);
    expect(result.preset.id).toMatch(UUID_V4_RE);
  });

  test('sets savedAt as ISO-8601 UTC', () => {
    const before = new Date().toISOString();
    const result = savePreset(VALID_INPUT);
    const after  = new Date().toISOString();
    expect(result.preset.savedAt >= before).toBe(true);
    expect(result.preset.savedAt <= after).toBe(true);
  });

  test('inserts new preset at index 0', () => {
    savePreset(VALID_INPUT);
    const result = savePreset({ ...VALID_INPUT, name: 'Second Load' });
    expect(result.presets[0].name).toBe('Second Load');
    expect(result.presets[1].name).toBe('My Load');
  });

  test('returns error invalid for weightG zero', () => {
    const r = savePreset({ ...VALID_INPUT, weightG: 0 });
    expect(r).toMatchObject({ ok: false, error: 'invalid', message: expect.stringContaining('Weight') });
  });

  test('returns error invalid for weightG above 30', () => {
    const r = savePreset({ ...VALID_INPUT, weightG: 31 });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
  });

  test('returns error invalid for weightG NaN', () => {
    const r = savePreset({ ...VALID_INPUT, weightG: NaN });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
  });

  test('returns error invalid for mvMps zero', () => {
    const r = savePreset({ ...VALID_INPUT, mvMps: 0 });
    expect(r).toMatchObject({ ok: false, error: 'invalid', message: expect.stringContaining('velocity') });
  });

  test('returns error invalid for mvMps above 2000', () => {
    const r = savePreset({ ...VALID_INPUT, mvMps: 2001 });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
  });

  test('returns error invalid for bc zero', () => {
    const r = savePreset({ ...VALID_INPUT, bc: 0 });
    expect(r).toMatchObject({ ok: false, error: 'invalid', message: expect.stringContaining('BC') });
  });

  test('returns error invalid for bc above 1.2', () => {
    const r = savePreset({ ...VALID_INPUT, bc: 1.3 });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
  });

  test('returns error invalid for diaMm zero', () => {
    const r = savePreset({ ...VALID_INPUT, diaMm: 0 });
    expect(r).toMatchObject({ ok: false, error: 'invalid', message: expect.stringContaining('Diameter') });
  });

  test('returns error invalid for diaMm above 25', () => {
    const r = savePreset({ ...VALID_INPUT, diaMm: 26 });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
  });

  test('replaces preset with same name (case-sensitive)', () => {
    const r1 = savePreset(VALID_INPUT);
    const origId = r1.preset.id;
    const r2 = savePreset({ ...VALID_INPUT, weightG: 12 });
    expect(r2.ok).toBe(true);
    expect(r2.replaced).toBe(true);
    expect(r2.preset.id).toBe(origId);
    expect(r2.preset.weightG).toBe(12);
    expect(r2.presets).toHaveLength(1);
  });

  test('replace moves preset to index 0', () => {
    savePreset(VALID_INPUT);
    savePreset({ ...VALID_INPUT, name: 'Second Load' });
    const r = savePreset(VALID_INPUT);
    expect(r.presets[0].name).toBe('My Load');
    expect(r.presets[1].name).toBe('Second Load');
  });

  test('replace updates savedAt', () => {
    const r1 = savePreset(VALID_INPUT);
    const origSavedAt = r1.preset.savedAt;
    const r2 = savePreset(VALID_INPUT);
    expect(r2.preset.savedAt >= origSavedAt).toBe(true);
  });

  test('does not treat differently-cased names as the same', () => {
    savePreset(VALID_INPUT);
    const r2 = savePreset({ ...VALID_INPUT, name: 'my load' });
    expect(r2.ok).toBe(true);
    expect(r2.replaced).toBe(false);
    expect(r2.presets).toHaveLength(2);
  });

  test('returns full when 20 presets exist and name is new', () => {
    for (let i = 0; i < 20; i++) {
      savePreset({ ...VALID_INPUT, name: `Load ${i}` });
    }
    const r = savePreset({ ...VALID_INPUT, name: 'Load 21' });
    expect(r).toMatchObject({ ok: false, error: 'full' });
    expect(loadPresets()).toHaveLength(20);
  });

  test('allows replacement even when 20 presets exist', () => {
    for (let i = 0; i < 20; i++) {
      savePreset({ ...VALID_INPUT, name: `Load ${i}` });
    }
    const r = savePreset({ ...VALID_INPUT, name: 'Load 0', weightG: 15 });
    expect(r.ok).toBe(true);
    expect(r.replaced).toBe(true);
    expect(r.presets).toHaveLength(20);
  });

  test('returns error storage when localStorage.setItem throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    const r = savePreset(VALID_INPUT);
    expect(r).toMatchObject({ ok: false, error: 'storage' });
    spy.mockRestore();
  });
});

// ── deletePreset ───────────────────────────────────────────────────────────────
describe('deletePreset', () => {
  test('removes a preset by id and returns remaining list', () => {
    const p = makePreset();
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify([p]));
    const result = deletePreset(p.id);
    expect(result).toHaveLength(0);
    expect(loadPresets()).toHaveLength(0);
  });

  test('unknown id is a no-op and returns current list', () => {
    const p = makePreset();
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify([p]));
    const result = deletePreset('3f2b8c1e-9a4d-4e6f-0000-000000000000');
    expect(result).toHaveLength(1);
  });

  test('removes the right preset when multiple exist', () => {
    const p1 = makePreset({ id: '3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c', name: 'First' });
    const p2 = makePreset({ id: '4a3c9d2f-0b5e-4f7a-a2d3-8e9f0a1b2c3d', name: 'Second' });
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify([p1, p2]));
    const result = deletePreset(p1.id);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Second');
  });

  test('returns existing list unchanged on storage failure and warns', () => {
    const p = makePreset();
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify([p]));
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    const result = deletePreset(p.id);
    expect(result).toHaveLength(1);
    expect(console.warn).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── renderPresetList ───────────────────────────────────────────────────────────
describe('renderPresetList', () => {
  const handlers = { onLoad: jest.fn(), onDelete: jest.fn() };

  beforeEach(() => {
    handlers.onLoad.mockClear();
    handlers.onDelete.mockClear();
  });

  test('hides #customPresetSection and clears list when presets is empty', () => {
    const section = document.getElementById('customPresetSection');
    section.hidden = false;
    renderPresetList([], handlers);
    expect(section.hidden).toBe(true);
    expect(document.getElementById('customPresetList').children).toHaveLength(0);
  });

  test('shows #customPresetSection when presets is non-empty', () => {
    const section = document.getElementById('customPresetSection');
    section.hidden = true;
    renderPresetList([makePreset()], handlers);
    expect(section.hidden).toBe(false);
  });

  test('renders one li per preset', () => {
    const presets = [makePreset(), makePreset({ id: '4a3c9d2f-0b5e-4f7a-c2d3-8e9f0a1b2c3d', name: 'Another' })];
    renderPresetList(presets, handlers);
    expect(document.querySelectorAll('.preset-row')).toHaveLength(2);
  });

  test('each li has data-preset-id, .preset-name, .preset-load-btn, .preset-delete-btn', () => {
    renderPresetList([makePreset()], handlers);
    const li = document.querySelector('.preset-row');
    expect(li.dataset.presetId).toBe('3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c');
    expect(li.querySelector('.preset-name').textContent).toBe('Test Load');
    expect(li.querySelector('.preset-load-btn')).not.toBeNull();
    expect(li.querySelector('.preset-delete-btn')).not.toBeNull();
  });

  test('preset name is rendered as textContent, not innerHTML (XSS)', () => {
    renderPresetList([makePreset({ name: '<img src=x onerror=alert(1)>' })], handlers);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.preset-name').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('Load button sets aria-label with preset name', () => {
    renderPresetList([makePreset()], handlers);
    const btn = document.querySelector('.preset-load-btn');
    expect(btn.getAttribute('aria-label')).toBe('Load preset Test Load');
  });

  test('Delete button sets aria-label with preset name', () => {
    renderPresetList([makePreset()], handlers);
    const btn = document.querySelector('.preset-delete-btn');
    expect(btn.getAttribute('aria-label')).toBe('Delete preset Test Load');
  });

  test('clicking Load button calls handlers.onLoad with the preset', () => {
    const p = makePreset();
    renderPresetList([p], handlers);
    document.querySelector('.preset-load-btn').click();
    expect(handlers.onLoad).toHaveBeenCalledWith(p);
  });

  test('clicking Delete button calls handlers.onDelete with the preset id', () => {
    const p = makePreset();
    renderPresetList([p], handlers);
    document.querySelector('.preset-delete-btn').click();
    expect(handlers.onDelete).toHaveBeenCalledWith(p.id);
  });

  test('is a no-op when #customPresetSection is missing', () => {
    document.body.innerHTML = '<ul id="customPresetList"></ul>';
    expect(() => renderPresetList([makePreset()], handlers)).not.toThrow();
  });

  test('is a no-op when #customPresetList is missing', () => {
    document.body.innerHTML = '<div id="customPresetSection"></div>';
    expect(() => renderPresetList([makePreset()], handlers)).not.toThrow();
  });

  test('replaces previous render on subsequent call', () => {
    const p1 = makePreset();
    const p2 = makePreset({ id: '4a3c9d2f-0b5e-4f7a-a2d3-8e9f0a1b2c3d', name: 'Second' });
    renderPresetList([p1], handlers);
    renderPresetList([p2], handlers);
    expect(document.querySelectorAll('.preset-row')).toHaveLength(1);
    expect(document.querySelector('.preset-name').textContent).toBe('Second');
  });

  test('name title attribute is set for tooltip', () => {
    renderPresetList([makePreset()], handlers);
    expect(document.querySelector('.preset-name').title).toBe('Test Load');
  });
});

// ── newPresetId ────────────────────────────────────────────────────────────────
describe('newPresetId', () => {
  test('returns unique ids on successive calls', () => {
    const ids = new Set(Array.from({ length: 10 }, newPresetId));
    expect(ids.size).toBe(10);
  });

  test('uses crypto.randomUUID when available', () => {
    const fakeId = '3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c';
    const saved = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: () => fakeId, configurable: true, writable: true });
    try {
      expect(newPresetId()).toBe(fakeId);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: saved, configurable: true, writable: true });
    }
  });

  test('uses getRandomValues fallback when randomUUID is absent', () => {
    const saved = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
    try {
      const id = newPresetId();
      expect(id).toMatch(UUID_V4_RE);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: saved, configurable: true, writable: true });
    }
  });
});
