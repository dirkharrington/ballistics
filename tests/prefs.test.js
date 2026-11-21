const {
  PREF_KEYS, PREF_DEFAULTS, DOM_ID_FOR_PREF,
  AUTO_COMPUTE_KEY, THEME_KEY, CUSTOM_DRAG_TABLE_KEY,
  formatNumber, safeGetItem, safeSetItem, safeRemoveItem,
  loadAutoComputePref, saveAutoComputePref,
  escapeHtml, computeAdjustments, showToast, _setSimStatus, _setSimulationError,
  savePrefs, loadPrefs, updateToggleLabel, applyTheme, initThemeToggle,
} = require('../app/prefs.js');

function buildPrefsDOM() {
  document.body.innerHTML = `
    <input id="zeroRange"     value="100" />
    <input id="maxRange"      value="1000" />
    <input id="windSpeed"     value="16" />
    <select id="windDir"><option value="90" selected>E</option><option value="180">S</option></select>
    <input id="altitude"      value="0" />
    <input id="temperature"   value="15" />
    <input id="step"          value="25" />
    <input id="sightHeight"   value="38.1" />
    <input id="shootingAngle" value="0" />
    <select id="dragModel"><option value="G1" selected>G1</option><option value="G7">G7</option></select>
    <button id="themeToggle" aria-label="Switch to light mode">&#x1F319;</button>
    <div id="toast"></div>
    <div id="simStatus" aria-live="polite" aria-atomic="true" class="sr-only"></div>
    <div id="simulationError" hidden></div>
  `;
}

beforeEach(() => {
  jest.useFakeTimers();
  buildPrefsDOM();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('prefs constants and formatting', () => {
  test('exports expected preference keys and defaults', () => {
    expect(PREF_KEYS.zero).toBe('bv_zero');
    expect(PREF_DEFAULTS.zero).toBe(100);
    expect(DOM_ID_FOR_PREF.zero).toBe('zeroRange');
    expect(AUTO_COMPUTE_KEY).toBe('ballistics_auto_compute');
    expect(THEME_KEY).toBe('bv_theme');
    expect(CUSTOM_DRAG_TABLE_KEY).toBe('ballistics.customDragTable');
  });

  test('formatNumber formats integers with locale grouping', () => {
    expect(formatNumber(1000)).toBe(new Intl.NumberFormat().format(1000));
  });
});

describe('safe localStorage helpers & auto-compute preference', () => {
  test('safeGetItem / safeSetItem / safeRemoveItem succeed normally', () => {
    expect(safeSetItem('k', 'v')).toBe(true);
    expect(safeGetItem('k')).toBe('v');
    expect(safeRemoveItem('k')).toBe(true);
    expect(safeGetItem('k', 'fallback')).toBeNull();
  });

  test('safe helpers swallow storage errors and return safe fallbacks', () => {
    const origLS = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('blocked', 'SecurityError'); },
    });
    try {
      expect(safeGetItem('k', 'def')).toBe('def');
      expect(safeGetItem('k')).toBeNull();
      expect(safeSetItem('k', 'v')).toBe(false);
      expect(safeRemoveItem('k')).toBe(false);
      expect(loadAutoComputePref()).toBe(true);
      expect(saveAutoComputePref(false)).toBe(false);
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: origLS });
    }
  });

  test('loadAutoComputePref and saveAutoComputePref persist boolean flag', () => {
    expect(loadAutoComputePref()).toBe(true);
    expect(saveAutoComputePref(false)).toBe(true);
    expect(localStorage.getItem(AUTO_COMPUTE_KEY)).toBe('false');
    expect(loadAutoComputePref()).toBe(false);
    expect(saveAutoComputePref(true)).toBe(true);
    expect(loadAutoComputePref()).toBe(true);
  });
});

describe('escapeHtml and computeAdjustments', () => {
  test('escapeHtml escapes HTML meta-characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  test('computeAdjustments covers zero range, zero drop, negative drop, positive drop', () => {
    expect(computeAdjustments(-50, 0)).toEqual({ moa: 0, mrad: 0 });
    expect(computeAdjustments(0, 500)).toEqual({ moa: 0, mrad: 0 });
    const pos = computeAdjustments(-30, 500);
    expect(pos.moa).toBeGreaterThan(0);
    expect(pos.mrad).toBeGreaterThan(0);
    const neg = computeAdjustments(5, 50);
    expect(neg.moa).toBeLessThan(0);
    expect(neg.mrad).toBeLessThan(0);
  });
});

describe('DOM feedback helpers (showToast, _setSimStatus, _setSimulationError)', () => {
  test('showToast displays and hides toast message after timers', () => {
    showToast('Saved');
    const el = document.getElementById('toast');
    expect(el.textContent).toBe('Saved');
    expect(el.classList.contains('toast-visible')).toBe(true);
    expect(el.style.display).toBe('block');

    jest.advanceTimersByTime(3000);
    expect(el.classList.contains('toast-visible')).toBe(false);
    jest.advanceTimersByTime(300);
    expect(el.style.display).toBe('none');
  });

  test('_setSimStatus sets status text and _setSimulationError toggles banner', () => {
    _setSimStatus('Computing…');
    expect(document.getElementById('simStatus').textContent).toBe('Computing…');

    _setSimulationError('Bad input');
    const errEl = document.getElementById('simulationError');
    expect(errEl.textContent).toBe('Bad input');
    expect(errEl.hasAttribute('hidden')).toBe(false);

    _setSimulationError(null);
    expect(errEl.hasAttribute('hidden')).toBe(true);
    expect(errEl.textContent).toBe('');
  });
});

describe('savePrefs & loadPrefs', () => {
  test('savePrefs writes defaults with no arguments and caches unchanged keys when Map provided', () => {
    savePrefs();
    expect(JSON.parse(localStorage.getItem(PREF_KEYS.selectedIds))).toEqual([]);
    expect(localStorage.getItem(PREF_KEYS.zero)).toBe('100');

    const cache = new Map();
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    savePrefs(new Set(['308-win-168gr']), cache);
    const firstWrites = setSpy.mock.calls.length;
    expect(firstWrites).toBeGreaterThan(0);

    setSpy.mockClear();
    savePrefs(new Set(['308-win-168gr']), cache);
    expect(setSpy).not.toHaveBeenCalled();

    document.getElementById('zeroRange').value = '250';
    savePrefs(new Set(['308-win-168gr']), cache);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(PREF_KEYS.zero, '250');

    // Absent DOM inputs fall back to PREF_DEFAULTS strings
    ['zeroRange','maxRange','windSpeed','windDir','altitude','temperature','step','sightHeight','shootingAngle','dragModel']
      .forEach(id => document.getElementById(id)?.remove());
    savePrefs(new Set());
    expect(localStorage.getItem(PREF_KEYS.zero)).toBe('100');
    expect(localStorage.getItem(PREF_KEYS.dragModel)).toBe('G1');
  });

  test('savePrefs converts Imperial display inputs back to canonical Metric', () => {
    document.getElementById('zeroRange').value = '100';
    document.getElementById('temperature').value = '68';
    savePrefs(new Set(['308-win-168gr']), null, 'imperial');
    expect(localStorage.getItem(PREF_KEYS.zero)).toBe('91.44');
    expect(localStorage.getItem(PREF_KEYS.temp)).toBe('20');
  });

  test('savePrefs logs warning when localStorage throws', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => savePrefs(new Set(['a']))).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('localStorage'), expect.any(Error));
  });

  test('loadPrefs parses stored prefs, ignores corrupt JSON/non-array, and handles storage error', () => {
    expect(loadPrefs()).toEqual(PREF_DEFAULTS);

    localStorage.setItem(PREF_KEYS.selectedIds, '{bad');
    expect(loadPrefs().selectedIds).toBeNull();

    localStorage.setItem(PREF_KEYS.selectedIds, '"str"');
    expect(loadPrefs().selectedIds).toBeNull();

    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify(['223-rem-55gr']));
    localStorage.setItem(PREF_KEYS.zero, '300');
    localStorage.setItem(PREF_KEYS.dragModel, 'G7');
    const loaded = loadPrefs();
    expect(loaded.selectedIds).toEqual(['223-rem-55gr']);
    expect(loaded.zero).toBe(300);
    expect(loaded.dragModel).toBe('G7');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    expect(loadPrefs()).toEqual(PREF_DEFAULTS);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('theme helpers (updateToggleLabel, applyTheme, initThemeToggle)', () => {
  test('updateToggleLabel handles missing button and dark/light modes', () => {
    updateToggleLabel('light');
    const btn = document.getElementById('themeToggle');
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(btn.textContent).toBe('☀️');

    updateToggleLabel('dark');
    expect(btn.getAttribute('aria-label')).toBe('Switch to light mode');

    btn.remove();
    expect(() => updateToggleLabel('dark')).not.toThrow();
  });

  test('applyTheme sets data-theme and invokes optional callback', () => {
    const cb = jest.fn();
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    applyTheme('dark', cb);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(cb).toHaveBeenCalledWith('dark');
  });

  test('initThemeToggle restores saved theme, handles click with AbortSignal, and handles absent button', () => {
    localStorage.setItem(THEME_KEY, 'light');
    const onTheme = jest.fn();
    const ac = new AbortController();
    initThemeToggle(onTheme, { signal: ac.signal });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    document.getElementById('themeToggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(onTheme).toHaveBeenCalledWith('dark');

    // Aborted controller removes listener
    ac.abort();
    document.getElementById('themeToggle').click();
    expect(onTheme).toHaveBeenCalledTimes(1);

    // Default arguments, absent THEME_KEY fallback to 'dark', & absent data-theme attribute fallback
    localStorage.removeItem(THEME_KEY);
    initThemeToggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('themeToggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    // Missing #themeToggle does not throw
    document.getElementById('themeToggle').remove();
    expect(() => initThemeToggle()).not.toThrow();
  });
});
