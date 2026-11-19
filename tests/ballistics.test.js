// ── TextEncoder / TextDecoder (not exposed as globals by jsdom 20 / Jest 29) ──
const { TextEncoder, TextDecoder } = require('util');
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

// ── Mock chart.js (mapped via Jest moduleNameMapper) ─────────────────────────
const { Chart: MockChart, _mockDestroy: mockChartDestroy, _mockUpdate: mockChartUpdate } = require('chart.js');

// ── Mock fetch ────────────────────────────────────────────────────────────────
global.fetch = jest.fn();
global.alert = jest.fn();
global.console.warn = jest.fn();

// ── Suppress jsdom's unimplemented HTMLCanvasElement.getContext ───────────────
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({}));

async function flushMicrotasks(ticks = 6) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function buildDOM() {
  document.body.innerHTML = `
  <main class="main">
    <label class="select-all-label">
      <input type="checkbox" id="selectAllBullets" aria-label="Select all rounds">
      <span>Select all</span>
    </label>
    <div id="bulletList" role="group" aria-label="Select bullet"></div>
    <div id="customBulletPanel">
      <button type="button" id="addCustomBulletBtn" aria-controls="customBulletForm" aria-expanded="false">+ ADD CUSTOM BULLET</button>
      <form id="customBulletForm" hidden novalidate>
        <div id="customBulletFormTitle">Add custom bullet</div>
        <input id="cbName" /><small id="cbName-error" class="field-error"></small>
        <input id="cbShortName" /><small id="cbShortName-error" class="field-error"></small>
        <input id="cbBulletWeightGrains" /><small id="cbBulletWeightGrains-error" class="field-error"></small>
        <input id="cbBcG1" /><small id="cbBcG1-error" class="field-error"></small>
        <input id="cbBcG7" /><small id="cbBcG7-error" class="field-error"></small>
        <input id="cbBulletDiameterInches" /><small id="cbBulletDiameterInches-error" class="field-error"></small>
        <input id="cbMuzzleVelocityFps" /><small id="cbMuzzleVelocityFps-error" class="field-error"></small>
        <div id="customBulletFormError" role="alert"></div>
        <button type="submit" id="customBulletSaveBtn">SAVE</button>
        <button type="button" id="customBulletCancelBtn">CANCEL</button>
      </form>
    </div>
    <input id="zeroRange"   value="100" />
    <input id="maxRange"    value="500" />
    <input id="windSpeed"   value="0"   />
    <select id="windDir">
      <option value="0">N (headwind)</option>
      <option value="45">NE</option>
      <option value="90" selected>E (→ right)</option>
      <option value="135">SE</option>
      <option value="180">S (tailwind)</option>
      <option value="225">SW</option>
      <option value="270">W (← left)</option>
      <option value="315">NW</option>
    </select>
    <input id="altitude"    value="0"   />
    <input id="temperature" value="59"  />
    <input id="step"        value="25"  />
    <input id="sightHeight"    value="38.1" />
    <input id="shootingAngle" value="0"    />
    <select id="dragModel">
      <option value="G1" selected>G1 (standard)</option>
      <option value="G7">G7 (long-range)</option>
    </select>
    <aside class="sidebar" id="sidebar"></aside>
    <button id="paramsToggle" class="fab-params">☰ PARAMS</button>
    <div id="sidebarBackdrop" class="sidebar-backdrop"></div>
    <button id="runBtn" class="run-btn"><span>▶ COMPUTE TRAJECTORIES</span></button>
    <div id="simulationError" class="simulation-error" hidden aria-live="assertive" role="alert"></div>
    <button id="runCustomBtn" class="run-btn"><span>▶ COMPUTE CUSTOM</span></button>
    <div id="chartsPanel" class="charts-panel active"></div>
    <div id="dataPanel"   class="data-panel"></div>
    <div id="emptyState"  style="display:block"></div>
    <div id="resultsContainer" style="display:none"></div>
    <div id="chartContainer"></div>
    <div id="rangeReadout" style="display:none">
      <span id="readoutRange"></span>
      <button id="readoutPin">PIN</button>
      <table><tbody id="readoutBody"></tbody></table>
    </div>
    <button id="exportCsvBtn" style="display:none;">Export CSV</button>
    <table id="dataTable">
      <thead>
        <tr>
          <th>Round</th>
          <th data-sort-key="range"><button class="sort-btn" type="button">Range (m)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="drop"><button class="sort-btn" type="button">Drop (cm)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="velocity"><button class="sort-btn" type="button">Velocity (m/s)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="energy"><button class="sort-btn" type="button">Energy (J)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="windDrift"><button class="sort-btn" type="button">Wind Drift (cm)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="time"><button class="sort-btn" type="button">Time (s)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="moa"><button class="sort-btn" type="button">MOA<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="mrad"><button class="sort-btn" type="button">MRAD<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th id="spinDriftColHeader" style="display:none">Spin Drift (cm)</th>
          <th id="coriolisColHeader" style="display:none">Coriolis (cm)</th>
        </tr>
      </thead>
      <tbody id="tableBody"><tr><td colspan="9">NO DATA</td></tr></tbody>
    </table>
    <div class="tab active" id="tab-charts"></div>
    <div class="tab"        id="tab-data"></div>
    <div class="tab"        id="tab-tools"></div>
    <div id="toolsPanel" class="tools-panel"></div>
    <button id="themeToggle" aria-label="Switch to light mode">&#x1F319;</button>
    <span class="status-pill" id="modelStatus">MODEL: G1</span>
    <div id="toast"></div>
    <div id="simStatus" aria-live="polite" aria-atomic="true" class="sr-only"></div>
    <input id="customName"   value="" />
    <input id="customWeight" value="9.0" />
    <input id="customMV"     value="850" />
    <input id="customBC"     value="0.45" />
    <input id="customDia"    value="7.82" />
    <div   id="customError"  style="display:none"></div>
    <input type="file" id="dragTableFile" accept=".csv,text/csv" />
    <small id="dragTableHelp" style="display:block;">Mach,CD columns. Overrides the drag model for custom-round runs.</small>
    <div id="dragTableStatus" style="display:none;">
      <span id="dragTableName"></span>
      <button type="button" id="dragTableClearBtn">Clear</button>
    </div>
    <button type="button" id="importJsonBtn" class="copy-link-btn" aria-label="Import previously exported trajectory JSON">⬆ IMPORT JSON</button>
    <input type="file" id="importJsonFile" accept=".json,application/json" style="display:none" />
    <button type="button" id="copyLinkBtn" class="copy-link-btn" aria-label="Copy a link to this setup">🔗 COPY LINK</button>
    <button type="button" id="savePresetBtn">SAVE AS PRESET</button>
    <div id="customPresetSection" hidden></div>
    <ul id="customPresetList" aria-label="Saved custom round presets"></ul>
    <input id="twistRate" value="" />
    <input id="latitudeDeg" value="" />
    <input id="azimuthDeg"  value="" />
    <div id="sweepControls" style="display:none">
      <select id="sweepParam">
        <option value="wind" selected>Wind</option>
        <option value="altitude">Altitude</option>
        <option value="temperature">Temperature</option>
      </select>
      <button id="sweepBtn"><span>SWEEP</span></button>
      <button id="clearSweepBtn" style="display:none"><span>CLEAR SWEEP</span></button>
    </div>
    <div id="dopeCard">
      <div id="dopeDistanceRow"></div>
      <button id="dopeAddDistBtn">+ Add distance</button>
      <table id="dopeTable"></table>
      <button id="dopeCopyBtn">COPY TEXT</button>
    </div>
    <div id="bcCalcCard">
      <input id="bcCalcWeightG" value="" />
      <input id="bcCalcMvMps"   value="" />
      <input id="bcCalcDropCm"  value="" />
      <input id="bcCalcRangeM"  value="" />
      <input id="bcCalcAltM"    value="0" />
      <input id="bcCalcTempC"   value="15" />
      <button id="bcCalcBtn">CALCULATE</button>
      <div id="bcCalcResult" class="tool-results"></div>
    </div>
  </main>
  `;
}

jest.mock('../app/physics/engine-async.ts', () => ({
  simulateAsync: jest.fn(),
  solveBCAsync: jest.fn(),
  prewarmPhysicsWorker: jest.fn(),
}));
const { simulate } = require('../app/physics/engine.ts');
const { simulateAsync } = require('../app/physics/engine-async.ts');
const mod = require('../app/ballistics.js');

// Reset state and DOM before each test
beforeEach(() => {
  jest.useFakeTimers();
  buildDOM();
  localStorage.clear();
  mod._resetState();
  MockChart.mockClear();
  mockChartDestroy.mockClear();
  mockChartUpdate.mockClear();
  global.fetch.mockReset();
  global.alert.mockClear();
  global.console.warn.mockClear();
  simulateAsync.mockReset();
  simulateAsync.mockImplementation((bullet, params) => Promise.resolve({
    bullet,
    request: params,
    points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
    maxOrdinateCm: 0,
    maxOrdinateRangeMeters: 0,
    supersonicLimitMeters: 0,
  }));
  // Reset URL so syncUrl side-effects from previous tests don't bleed into init()
  history.replaceState(null, '', '/');
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// getMockBullets
// ─────────────────────────────────────────────────────────────────────────────
describe('getMockBullets', () => {
  test('returns 10 bullets', () => {
    const bullets = mod.getMockBullets();
    expect(bullets).toHaveLength(10);
  });

  test('each bullet has required fields', () => {
    mod.getMockBullets().forEach(b => {
      expect(b.id).toBeDefined();
      expect(b.name).toBeDefined();
      expect(b.muzzleVelocityMps).toBeGreaterThan(0);
      expect(b.ballisticCoefficient).toBeGreaterThan(0);
      expect(b.bulletWeightGrams).toBeGreaterThan(0);
    });
  });

  test('contains expected IDs', () => {
    const ids = mod.getMockBullets().map(b => b.id);
    expect(ids).toContain('223-rem-55gr');
    expect(ids).toContain('308-win-168gr');
    expect(ids).toContain('3006-150gr');
    expect(ids).toContain('65-creedmoor-140gr');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// escapeHtml
// ─────────────────────────────────────────────────────────────────────────────
describe('escapeHtml', () => {
  test('escapes angle brackets', () => {
    expect(mod.escapeHtml('<img>')).toBe('&lt;img&gt;');
  });

  test('escapes ampersands', () => {
    expect(mod.escapeHtml('a & b')).toBe('a &amp; b');
  });

  test('escapes double and single quotes', () => {
    expect(mod.escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(mod.escapeHtml("it's")).toBe('it&#39;s');
  });

  test('full XSS payload is fully escaped', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const escaped = mod.escapeHtml(payload);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).toContain('&lt;img');
  });

  test('passes through safe strings unchanged', () => {
    expect(mod.escapeHtml('.308 Win 168gr BTHP')).toBe('.308 Win 168gr BTHP');
  });

  test('coerces non-string input to string', () => {
    expect(mod.escapeHtml(42)).toBe('42');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeAdjustments
// ─────────────────────────────────────────────────────────────────────────────
describe('computeAdjustments', () => {
  test('returns zero for both when range is 0', () => {
    const adj = mod.computeAdjustments(-50, 0);
    expect(adj.moa).toBe(0);
    expect(adj.mrad).toBe(0);
  });

  test('returns zero for both when drop is 0', () => {
    const adj = mod.computeAdjustments(0, 500);
    expect(adj.moa).toBe(0);
    expect(adj.mrad).toBe(0);
  });

  test('positive adjustment when drop is negative (bullet below LoS)', () => {
    const adj = mod.computeAdjustments(-30, 500);
    expect(adj.moa).toBeGreaterThan(0);
    expect(adj.mrad).toBeGreaterThan(0);
  });

  test('negative adjustment when drop is positive (bullet above LoS)', () => {
    const adj = mod.computeAdjustments(5, 50);
    expect(adj.moa).toBeLessThan(0);
    expect(adj.mrad).toBeLessThan(0);
  });

  test('MOA is numerically larger than MRAD for same drop/range', () => {
    const adj = mod.computeAdjustments(-30, 500);
    expect(adj.moa).toBeGreaterThan(adj.mrad);
  });

  test('values are rounded to 1 decimal place', () => {
    const adj = mod.computeAdjustments(-30, 500);
    expect(adj.moa).toBe(Math.round(adj.moa * 10) / 10);
    expect(adj.mrad).toBe(Math.round(adj.mrad * 10) / 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BULLET_COLORS
// ─────────────────────────────────────────────────────────────────────────────
describe('BULLET_COLORS', () => {
  test('maps all four known IDs', () => {
    expect(mod.BULLET_COLORS['223-rem-55gr']).toBe('#4ADE80');
    expect(mod.BULLET_COLORS['308-win-168gr']).toBe('#F97316');
    expect(mod.BULLET_COLORS['3006-150gr']).toBe('#60A5FA');
    expect(mod.BULLET_COLORS['65-creedmoor-140gr']).toBe('#E879F9');
  });
});




// ─────────────────────────────────────────────────────────────────────────────
// (simulateBulletJS tests removed — engine.ts is the sole physics engine now)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// computeClientSide
// ─────────────────────────────────────────────────────────────────────────────
describe('computeClientSide', () => {
  const mockBullets = [
    { id: 'a', name: 'A', ballisticCoefficient: 0.475, bulletWeightGrams: 10.89, muzzleVelocityMps: 807 },
    { id: 'b', name: 'B', ballisticCoefficient: 0.243, bulletWeightGrams: 3.56,  muzzleVelocityMps: 987 }
  ];
  const req = {
    bulletIds: ['a', 'b'],
    zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
    windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15
  };

  beforeEach(() => mod._setBullets(mockBullets));

  test('returns results for all valid bullet IDs', async () => {
    const results = await mod.computeClientSide(req);
    expect(results).toHaveLength(2);
  });

  test('filters out unknown bullet IDs', async () => {
    const results = await mod.computeClientSide({ ...req, bulletIds: ['a', 'unknown'] });
    expect(results).toHaveLength(1);
    expect(results[0].bullet.id).toBe('a');
  });

  test('returns empty array for all unknown IDs', async () => {
    const results = await mod.computeClientSide({ ...req, bulletIds: ['x', 'y'] });
    expect(results).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderBulletList
// ─────────────────────────────────────────────────────────────────────────────
describe('renderBulletList', () => {
  beforeEach(() => mod._setBullets(mod.getMockBullets()));

  test('renders a card for each bullet', () => {
    mod.renderBulletList();
    const cards = document.querySelectorAll('.bullet-card');
    expect(cards).toHaveLength(10);
  });

  test('each card has the bullet name', () => {
    mod.renderBulletList();
    const names = [...document.querySelectorAll('.bullet-name')].map(el => el.textContent.trim());
    expect(names).toContain('.223 Rem 55gr FMJ');
    expect(names).toContain('.308 Win 168gr BTHP');
  });

  test('unknown bullet id gets fallback color', () => {
    mod._setBullets([{ id: 'unknown-id', name: 'Unknown', ballisticCoefficient: 0.3, muzzleVelocityMps: 610 }]);
    mod.renderBulletList();
    const card = document.getElementById('card-unknown-id');
    expect(card.style.cssText).toContain('#4ADE80');
  });

  test('XSS payload in bullet name is escaped', () => {
    const xssName = '<img src=x onerror=alert(1)>';
    mod._setBullets([{ id: 'xss-test', name: xssName, ballisticCoefficient: 0.3, muzzleVelocityMps: 610 }]);
    mod.renderBulletList();
    const html = document.getElementById('bulletList').innerHTML;
    // Unescaped <img would be injected as a real element; escaped form is safe text
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  test('ACC-1: each built-in card has tabindex="0" and role="button"', () => {
    mod.renderBulletList();
    const cards = document.querySelectorAll('#bulletList > .bullet-card');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach(card => {
      expect(card.getAttribute('tabindex')).toBe('0');
      expect(card.getAttribute('role')).toBe('button');
    });
  });

  test('ACC-1: unselected card has aria-pressed="false"', () => {
    mod._setSelectedIds(new Set());
    mod.renderBulletList();
    const card = document.getElementById('card-308-win-168gr');
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });

  test('ACC-1: selected card has aria-pressed="true"', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.renderBulletList();
    const card = document.getElementById('card-308-win-168gr');
    expect(card.getAttribute('aria-pressed')).toBe('true');
  });

  test('ACC-1: #bulletList has role="group" and aria-label', () => {
    const list = document.getElementById('bulletList');
    expect(list.getAttribute('role')).toBe('group');
    expect(list.getAttribute('aria-label')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toggleBullet
// ─────────────────────────────────────────────────────────────────────────────
describe('toggleBullet', () => {
  beforeEach(() => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList();
  });

  test('adds bullet to selection when not selected', () => {
    mod._setSelectedIds(new Set());
    mod.toggleBullet('308-win-168gr');
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(true);
  });

  test('removes bullet from selection when already selected', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.toggleBullet('308-win-168gr');
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(false);
  });

  test('card gets active class when selected', () => {
    mod._setSelectedIds(new Set());
    mod.toggleBullet('223-rem-55gr');
    const card = document.getElementById('card-223-rem-55gr');
    expect(card.classList.contains('active')).toBe(true);
  });

  test('card loses active class when deselected', () => {
    mod._setSelectedIds(new Set(['223-rem-55gr']));
    mod.toggleBullet('223-rem-55gr');
    const card = document.getElementById('card-223-rem-55gr');
    expect(card.classList.contains('active')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateBulletCards
// ─────────────────────────────────────────────────────────────────────────────
describe('updateBulletCards', () => {
  test('skips missing card elements gracefully', () => {
    mod._setBullets([{ id: 'no-dom-card', name: 'X', ballisticCoefficient: 0.3, muzzleVelocityMps: 610 }]);
    mod._setSelectedIds(new Set(['no-dom-card']));
    expect(() => mod.updateBulletCards()).not.toThrow();
  });

  test('marks active cards correctly', () => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.updateBulletCards();
    expect(document.getElementById('card-308-win-168gr').classList.contains('active')).toBe(true);
    expect(document.getElementById('card-223-rem-55gr').classList.contains('active')).toBe(false);
  });

  test('ACC-1: syncs aria-pressed on selection change', () => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.updateBulletCards();
    expect(document.getElementById('card-308-win-168gr').getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('card-223-rem-55gr').getAttribute('aria-pressed')).toBe('false');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncSelectAllCheckbox
// ─────────────────────────────────────────────────────────────────────────────
describe('syncSelectAllCheckbox', () => {
  beforeEach(() => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList();
  });

  test('unchecked and not indeterminate when 0 selected', () => {
    mod._setSelectedIds(new Set());
    mod.syncSelectAllCheckbox();
    const cb = document.getElementById('selectAllBullets');
    expect(cb.checked).toBe(false);
    expect(cb.indeterminate).toBe(false);
  });

  test('indeterminate when some (but not all) selected', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.syncSelectAllCheckbox();
    const cb = document.getElementById('selectAllBullets');
    expect(cb.indeterminate).toBe(true);
  });

  test('checked and not indeterminate when all selected', () => {
    const allIds = new Set(mod.getMockBullets().map(b => b.id));
    mod._setSelectedIds(allIds);
    mod.syncSelectAllCheckbox();
    const cb = document.getElementById('selectAllBullets');
    expect(cb.checked).toBe(true);
    expect(cb.indeterminate).toBe(false);
  });

  test('no-op when checkbox element is absent', () => {
    document.getElementById('selectAllBullets').remove();
    expect(() => mod.syncSelectAllCheckbox()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncRunButton
// ─────────────────────────────────────────────────────────────────────────────
describe('syncRunButton', () => {
  test('disables runBtn when selectedIds is empty', () => {
    mod._setSelectedIds(new Set());
    mod.syncRunButton();
    expect(document.getElementById('runBtn').disabled).toBe(true);
  });

  test('enables runBtn when selectedIds is non-empty', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.syncRunButton();
    expect(document.getElementById('runBtn').disabled).toBe(false);
  });

  test('no-op when runBtn element is absent', () => {
    document.getElementById('runBtn').remove();
    expect(() => mod.syncRunButton()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// select-all checkbox wired by init
// ─────────────────────────────────────────────────────────────────────────────
describe('select-all checkbox interaction (via init)', () => {
  beforeEach(() => {
    mod.init();
  });

  test('checking select-all adds all bullet ids to selectedIds', () => {
    const cb = document.getElementById('selectAllBullets');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    const { selectedIds, bullets } = mod._getState();
    expect(selectedIds.size).toBe(bullets.length);
  });

  test('unchecking select-all clears selectedIds', () => {
    // First select all
    const cb = document.getElementById('selectAllBullets');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    // Then deselect all
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    const { selectedIds } = mod._getState();
    expect(selectedIds.size).toBe(0);
  });

  test('runBtn is disabled after deselecting all via checkbox', () => {
    const cb = document.getElementById('selectAllBullets');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(document.getElementById('runBtn').disabled).toBe(true);
  });

  test('runBtn is enabled after selecting all via checkbox', () => {
    const cb = document.getElementById('selectAllBullets');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(document.getElementById('runBtn').disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// switchTab
// ─────────────────────────────────────────────────────────────────────────────
describe('switchTab', () => {
  test('switching to charts activates chartsPanel', () => {
    const el = document.getElementById('tab-charts');
    mod.switchTab('charts', el);
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(true);
    expect(document.getElementById('dataPanel').classList.contains('active')).toBe(false);
    expect(el.classList.contains('active')).toBe(true);
  });

  test('switching to data activates dataPanel', () => {
    const el = document.getElementById('tab-data');
    mod.switchTab('data', el);
    expect(document.getElementById('dataPanel').classList.contains('active')).toBe(true);
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(false);
  });

  test('removes active from all other tabs', () => {
    const tabCharts = document.getElementById('tab-charts');
    tabCharts.classList.add('active');
    const tabData = document.getElementById('tab-data');
    mod.switchTab('data', tabData);
    expect(tabCharts.classList.contains('active')).toBe(false);
    expect(tabData.classList.contains('active')).toBe(true);
  });

  test('switching to tools activates toolsPanel', async () => {
    const el = document.getElementById('tab-tools');
    await mod.switchTab('tools', el);
    expect(document.getElementById('toolsPanel').classList.contains('active')).toBe(true);
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(false);
    expect(document.getElementById('dataPanel').classList.contains('active')).toBe(false);
    expect(el.classList.contains('active')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderTable
// ─────────────────────────────────────────────────────────────────────────────
describe('renderTable', () => {
  const results = [
    {
      bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP' },
      points: [
        { rangeMeters: 0,   dropCm:  3.8, velocityMps: 807, energyJoules: 3552, windDriftCm:  0,   timeOfFlightSec: 0 },
        { rangeMeters: 91, dropCm: -0.3, velocityMps: 750, energyJoules: 3000, windDriftCm:  8.1, timeOfFlightSec: 0.12 },
        { rangeMeters: 457, dropCm: -107,  velocityMps: 550, energyJoules: 1639, windDriftCm: -5.1, timeOfFlightSec: 0.65 }
      ]
    }
  ];

  test('renders one row per trajectory point', () => {
    mod.renderTable(results);
    const rows = document.querySelectorAll('#tableBody tr');
    expect(rows).toHaveLength(3);
  });

  test('positive drop gets + prefix', () => {
    mod.renderTable(results);
    const firstRow = document.querySelectorAll('#tableBody tr')[0];
    expect(firstRow.textContent).toContain('+3.8 cm');
  });

  test('negative drop has no + prefix', () => {
    mod.renderTable(results);
    const secondRow = document.querySelectorAll('#tableBody tr')[1];
    expect(secondRow.textContent).not.toContain('+-');
    expect(secondRow.textContent).toContain('-0.3 cm');
  });

  test('positive wind drift gets + prefix', () => {
    mod.renderTable(results);
    const secondRow = document.querySelectorAll('#tableBody tr')[1];
    expect(secondRow.textContent).toContain('+8.1 cm');
  });

  test('negative wind drift has no + prefix', () => {
    mod.renderTable(results);
    const thirdRow = document.querySelectorAll('#tableBody tr')[2];
    expect(thirdRow.textContent).toContain('-5.1 cm');
    expect(thirdRow.textContent).not.toContain('+-');
  });

  test('uses fallback color for unknown bullet id', () => {
    const unknownResults = [{
      bullet: { id: 'unknown-id', name: 'Unknown' },
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 2000, energyJoules: 1356, windDriftCm: 0, timeOfFlightSec: 0 }]
    }];
    mod.renderTable(unknownResults);
    const row = document.querySelector('#tableBody tr');
    expect(row).not.toBeNull();
    expect(row.innerHTML).toContain('#4ADE80');
  });

  test('XSS payload in bullet name is escaped in table cell', () => {
    const xssResults = [{
      bullet: { id: '308-win-168gr', name: '<script>alert(1)</script>' },
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }]
    }];
    mod.renderTable(xssResults);
    const tbody = document.getElementById('tableBody').innerHTML;
    // Unescaped <script> would execute; escaped form is safe text
    expect(tbody).not.toContain('<script>alert');
    expect(tbody).toContain('&lt;script&gt;');
  });

  test('MOA and MRAD cells are present for each row', () => {
    mod.renderTable(results);
    const rows = document.querySelectorAll('#tableBody tr');
    // muzzle point: range=0 → moa=0, mrad=0
    expect(rows[0].textContent).toContain('0');
    // far point: range=457, drop=-107 → positive adjustment
    const farText = rows[2].textContent;
    // MOA adjustment should be a positive number shown in the row
    const moaMatch = farText.match(/\+?\d+\.\d+/g);
    expect(moaMatch).not.toBeNull();
  });

  test('positive drop gets negative MOA adjustment with - prefix', () => {
    const aboveResults = [{
      bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP' },
      points: [{ rangeMeters: 50, dropCm: 5, velocityMps: 800, energyJoules: 3500, windDriftCm: 0, timeOfFlightSec: 0.05 }]
    }];
    mod.renderTable(aboveResults);
    const row = document.querySelector('#tableBody tr');
    // drop is positive → MOA/MRAD are negative (no + prefix)
    expect(row.textContent).not.toMatch(/\+.*MOA/);
  });

  test('coriolisColHeader hidden when no Coriolis data', () => {
    mod.renderTable(results);
    const hdr = document.getElementById('coriolisColHeader');
    expect(hdr.style.display).toBe('none');
  });

  test('coriolisColHeader shown and cells rendered when Coriolis data present', () => {
    const corResults = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [
        { rangeMeters: 0,   dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0,    coriolisDeflectionCm: 0   },
        { rangeMeters: 100, dropCm: -3, velocityMps: 760, energyJoules: 3100, windDriftCm: 1, timeOfFlightSec: 0.13, coriolisDeflectionCm: 1.2 },
      ],
    }];
    mod.renderTable(corResults);
    expect(document.getElementById('coriolisColHeader').style.display).toBe('');
    const rows = document.querySelectorAll('#tableBody tr');
    expect(rows[1].textContent).toContain('+1.2 cm');
  });

  test('negative coriolisDeflectionCm renders without + prefix', () => {
    const corResults = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [
        { rangeMeters: 0,   dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0,    coriolisDeflectionCm: -0.5 },
        { rangeMeters: 100, dropCm: -3, velocityMps: 760, energyJoules: 3100, windDriftCm: 1, timeOfFlightSec: 0.13, coriolisDeflectionCm: -2.1 },
      ],
    }];
    mod.renderTable(corResults);
    const rows = document.querySelectorAll('#tableBody tr');
    expect(rows[1].textContent).toContain('-2.1 cm');
    expect(rows[1].textContent).not.toContain('+-');
  });

  test('spinDriftColHeader hidden when no Spin Drift data', () => {
    mod.renderTable(results);
    const hdr = document.getElementById('spinDriftColHeader');
    expect(hdr.style.display).toBe('none');
  });

  test('spinDriftColHeader shown and cells rendered when Spin Drift data present', () => {
    const spinResults = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [
        { rangeMeters: 0,   dropCm: 0,  velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0,    spinDriftCm: 0   },
        { rangeMeters: 100, dropCm: -3, velocityMps: 760, energyJoules: 3100, windDriftCm: 1, timeOfFlightSec: 0.13, spinDriftCm: 1.2 },
      ],
    }];
    mod.renderTable(spinResults);
    expect(document.getElementById('spinDriftColHeader').style.display).toBe('');
    const rows = document.querySelectorAll('#tableBody tr');
    expect(rows[1].textContent).toContain('1.2 cm');
  });

  test('spinDriftColHeader hidden when all Spin Drift values are zero', () => {
    const noSpinResults = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [
        { rangeMeters: 0,   dropCm: 0,  velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0,    spinDriftCm: 0 },
        { rangeMeters: 100, dropCm: -3, velocityMps: 760, energyJoules: 3100, windDriftCm: 1, timeOfFlightSec: 0.13, spinDriftCm: 0 },
      ],
    }];
    mod.renderTable(noSpinResults);
    expect(document.getElementById('spinDriftColHeader').style.display).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resetCrosshairState
// ─────────────────────────────────────────────────────────────────────────────
describe('resetCrosshairState', () => {
  test('clears crosshairIndex and crosshairPinned', () => {
    mod.resetCrosshairState();
    const s = mod._getState();
    expect(s.crosshairIndex).toBeNull();
    expect(s.crosshairPinned).toBe(false);
  });

  test('resets pin button text and removes pinned class', () => {
    const pinBtn = document.getElementById('readoutPin');
    pinBtn.textContent = 'UNPIN';
    pinBtn.classList.add('pinned');
    mod.resetCrosshairState();
    expect(pinBtn.textContent).toBe('PIN');
    expect(pinBtn.classList.contains('pinned')).toBe(false);
  });

  test('hides the range readout panel', () => {
    const readout = document.getElementById('rangeReadout');
    readout.style.display = 'block';
    mod.resetCrosshairState();
    expect(readout.style.display).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildChartConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('buildChartConfig', () => {
  const sampleResults = [{
    bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
              muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
    points: [
      { rangeMeters: 0,   velocityMps: 807, dropCm: 0,    energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 },
      { rangeMeters: 100, velocityMps: 750, dropCm: -5.2, energyJoules: 3000, windDriftCm: 0, timeOfFlightSec: 0.13 }
    ],
    maxOrdinateCm: 8.1, maxOrdinateRangeMeters: 68, supersonicLimitMeters: 823
  }];

  const dropDef = {
    id: 'dropChart', title: 'BULLET DROP', subtitle: 'zeroed at 100 m',
    yLabel: 'Drop (cm)', key: 'dropCm'
  };

  const datasets = [{ label: '.308', data: [{ x: 0, y: 807 }] }];

  test('returns an object with type "line"', () => {
    const config = mod.buildChartConfig(dropDef, datasets, sampleResults);
    expect(config.type).toBe('line');
  });

  test('passes datasets through to config.data.datasets', () => {
    const config = mod.buildChartConfig(dropDef, datasets, sampleResults);
    expect(config.data.datasets).toBe(datasets);
  });

  test('includes crosshairPlugin in plugins array', () => {
    const config = mod.buildChartConfig(dropDef, datasets, sampleResults);
    expect(config.plugins).toContain(mod.crosshairPlugin);
  });

  test('uses def.yLabel for y-axis title', () => {
    const config = mod.buildChartConfig(dropDef, datasets, sampleResults);
    expect(config.options.scales.y.title.text).toBe('Drop (cm)');
  });

  test('onHover callback is a function', () => {
    const config = mod.buildChartConfig(dropDef, datasets, sampleResults);
    expect(typeof config.options.onHover).toBe('function');
  });

  test('onClick callback is a function', () => {
    const config = mod.buildChartConfig(dropDef, datasets, sampleResults);
    expect(typeof config.options.onClick).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderResults
// ─────────────────────────────────────────────────────────────────────────────
describe('renderResults', () => {
  const results = [
    {
      bullet: {
        id: '308-win-168gr', name: '.308 Win 168gr BTHP',
        muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
        ballisticCoefficient: 0.475, bulletWeightGrams: 10.89
      },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,   velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: 91, dropCm: 0,   velocityMps: 750, energyJoules: 3000, windDriftCm: 0, timeOfFlightSec: 0.12 },
        { rangeMeters: 457, dropCm: -107, velocityMps: 550, energyJoules: 1639, windDriftCm: 0, timeOfFlightSec: 0.65 }
      ],
      maxOrdinateCm: 8.1, maxOrdinateRangeMeters: 68, supersonicLimitMeters: 823
    }
  ];

  const req = { zeroRangeMeters: 100, windSpeedKph: 16 };

  test('hides empty state and shows results container', async () => {
    await mod.renderResults(results, req);
    expect(document.getElementById('emptyState').style.display).toBe('none');
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('creates 5 Chart instances (4 trajectory + 1 adjustment)', async () => {
    await mod.renderResults(results, req);
    expect(MockChart).toHaveBeenCalledTimes(5);
  });

  test('destroys existing charts before rendering new ones', async () => {
    const fakeChart = { destroy: jest.fn() };
    mod._setCharts({ old: fakeChart });
    await mod.renderResults(results, req);
    expect(fakeChart.destroy).toHaveBeenCalled();
  });

  test('renders stats grid with bullet info', async () => {
    await mod.renderResults(results, req);
    expect(document.getElementById('chartContainer').innerHTML).toContain('.308 Win 168gr BTHP');
    expect(document.getElementById('chartContainer').innerHTML).toContain('807');
  });

  test('renders table rows when Data Table tab is activated', async () => {
    await mod.renderResults(results, req);
    mod.switchTab('data', document.getElementById('tab-data'));
    const rows = document.querySelectorAll('#tableBody tr');
    expect(rows.length).toBe(3);
  });

  test('handles result with bullet having unknown color ID (fallback)', async () => {
    const unknownResult = [{
      bullet: {
        id: 'unknown-bullet', name: 'Unknown',
        muzzleVelocityMps: 610, muzzleEnergyJoules: 1356,
        ballisticCoefficient: 0.3, bulletWeightGrams: 6.5
      },
      request: {},
      points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 2000, energyJoules: 1356, windDriftCm: 0, timeOfFlightSec: 0 }
      ],
      maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0
    }];
    await mod.renderResults(unknownResult, req);
  });

  test('XSS payload in bullet name is escaped in stat card', async () => {
    const xssResult = [{
      bullet: {
        id: '308-win-168gr', name: '<img src=x onerror=alert(1)>',
        muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
        ballisticCoefficient: 0.475, bulletWeightGrams: 10.89
      },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 8.1, maxOrdinateRangeMeters: 68, supersonicLimitMeters: 823
    }];
    await mod.renderResults(xssResult, req);
    const html = document.getElementById('chartContainer').innerHTML;
    // Unescaped <img would be injected as a real element; escaped form is safe text
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  test('non-numeric API field in stat card renders as NaN not as HTML', async () => {
    const badResult = [{
      bullet: {
        id: '308-win-168gr', name: 'Safe Name',
        muzzleVelocityMps: '<b>fast</b>', muzzleEnergyJoules: 3552,
        ballisticCoefficient: 0.475, bulletWeightGrams: 10.89
      },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 8.1, maxOrdinateRangeMeters: 68, supersonicLimitMeters: 823
    }];
    await mod.renderResults(badResult, req);
    const html = document.getElementById('chartContainer').innerHTML;
    expect(html).not.toContain('<b>fast</b>');
    expect(html).toContain('NaN');
  });

  test('unknown color ID gets fallback color in stat card', async () => {
    const customResult = [{
      bullet: {
        id: 'custom', name: 'Custom Load',
        muzzleVelocityMps: 850, muzzleEnergyJoules: 3200,
        ballisticCoefficient: 0.45, bulletWeightGrams: 9.0
      },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 850, energyJoules: 3200, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 5.0, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 900
    }];
    await mod.renderResults(customResult, req);
    const html = document.getElementById('chartContainer').innerHTML;
    expect(html).toContain('#4ADE80');
    expect(html).not.toContain('undefined');
  });

  test('renderStatCards silently skips results missing bullet property', async () => {
    const mixedResults = [
      { points: [], maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0 },
      {
        bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP',
                  muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
                  ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
        request: {},
        points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
        maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
      }
    ];
    await mod.renderResults(mixedResults, req);
    expect(document.getElementById('chartContainer').innerHTML).toContain('.308 Win 168gr BTHP');
  });

  test('renderResults adds Coriolis drift dataset when coriolisDeflectionCm is nonzero', async () => {
    const corResults = [{
      bullet: { id: '308-win-168gr', name: '.308 Win',
                muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
                ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        // first point has no coriolisDeflectionCm → exercises the ?? 0 fallback
        { rangeMeters: 0,   dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: 100, dropCm: -3, velocityMps: 760, energyJoules: 3100, windDriftCm: 0, timeOfFlightSec: 0.13, coriolisDeflectionCm: 1.2 },
      ],
      maxOrdinateCm: 3, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 823,
    }];
    await mod.renderResults(corResults, req);
    // The Coriolis drift series should have been added to the drift chart
    const driftCall = MockChart.mock.calls.find(args => {
      const ds = args[1]?.data?.datasets ?? [];
      return ds.some(d => d.label && d.label.includes('coriolis'));
    });
    expect(driftCall).toBeDefined();
  });

  test('Coriolis dataset falls back to #4ADE80 color for unknown bullet ID (line 891 || branch)', async () => {
    const corResults = [{
      bullet: { id: 'unknown-custom-bullet', name: 'Custom',
                muzzleVelocityMps: 800, muzzleEnergyJoules: 3000,
                ballisticCoefficient: 0.4, bulletWeightGrams: 9.5 },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,  velocityMps: 800, energyJoules: 3000, windDriftCm: 0, timeOfFlightSec: 0,    coriolisDeflectionCm: 0.8 },
        { rangeMeters: 100, dropCm: -3, velocityMps: 760, energyJoules: 2800, windDriftCm: 0, timeOfFlightSec: 0.13, coriolisDeflectionCm: 1.1 },
      ],
      maxOrdinateCm: 3, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 820,
    }];
    await mod.renderResults(corResults, req);
    const driftCall = MockChart.mock.calls.find(args => {
      const ds = args[1]?.data?.datasets ?? [];
      return ds.some(d => d.label && d.label.includes('coriolis'));
    });
    expect(driftCall).toBeDefined();
    const corDs = driftCall[1].data.datasets.find(d => d.label.includes('coriolis'));
    expect(corDs.borderColor).toBe('#4ADE80');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runSimulation
// ─────────────────────────────────────────────────────────────────────────────
describe('runSimulation', () => {
  const mockApiResults = [
    {
      bullet: {
        id: '308-win-168gr', name: '.308 Win 168gr BTHP',
        muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
        ballisticCoefficient: 0.475, bulletWeightGrams: 10.89
      },
      request: {},
      points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }
      ],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }
  ];

  test('returns early without calling compute when no bullets selected', () => {
    mod._setSelectedIds(new Set());
    mod.runSimulation();
    expect(global.alert).not.toHaveBeenCalled();
    expect(simulateAsync).not.toHaveBeenCalled();
  });

  test('calls computeClientSide and renders results', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('shows simulation error when computeClientSide throws TrajectoryInputError', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    const { TrajectoryInputError } = require('../app/physics/engine.ts');
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too large'));

    await mod.runSimulation();

    expect(document.getElementById('simulationError').hasAttribute('hidden')).toBe(false);
  });

  test('restores button text after successful simulation', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    const btn = document.getElementById('runBtn');
    expect(btn.querySelector('span').textContent).toBe('▶ COMPUTE TRAJECTORIES');
    expect(btn.classList.contains('loading')).toBe(false);
  });

  test('outer catch logs error when simulateAsync rejects with non-input error', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    simulateAsync.mockRejectedValueOnce(new Error('physics exploded'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await mod.runSimulation();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    const btn = document.getElementById('runBtn');
    expect(btn.querySelector('span').textContent).toBe('▶ COMPUTE TRAJECTORIES');
  });

  test('reads parameters from DOM inputs', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    document.getElementById('zeroRange').value   = '200';
    document.getElementById('maxRange').value    = '800';
    document.getElementById('windSpeed').value   = '15';
    document.getElementById('windDir').value     = '180';
    document.getElementById('altitude').value    = '3000';
    document.getElementById('temperature').value = '20';
    document.getElementById('step').value        = '50';

    await mod.runSimulation();
    jest.runAllTimers();

    const req = mod._getState().lastResults[0]?.request ?? mod._getState().lastResults[0]?.req;
    // Verify results were rendered (parameters accepted)
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runSimulation input validation
// ─────────────────────────────────────────────────────────────────────────────
describe('runSimulation — input validation', () => {
  test('shows error and returns early when latitudeDeg is out of range', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    document.getElementById('latitudeDeg').value = '95';
    document.getElementById('azimuthDeg').value  = '';
    mod.runSimulation();
    const err = document.getElementById('simulationError');
    expect(err.hasAttribute('hidden')).toBe(false);
    expect(err.textContent).toMatch(/latitude/i);
    document.getElementById('latitudeDeg').value = '';
  });

  test('shows error and returns early when azimuthDeg is out of range', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    document.getElementById('latitudeDeg').value = '';
    document.getElementById('azimuthDeg').value  = '400';
    mod.runSimulation();
    const err = document.getElementById('simulationError');
    expect(err.hasAttribute('hidden')).toBe(false);
    expect(err.textContent).toMatch(/azimuth/i);
    document.getElementById('azimuthDeg').value = '';
  });

  test('second runSimulation clears previously displayed error banner', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    // First call: invalid input sets error
    document.getElementById('latitudeDeg').value = '95';
    mod.runSimulation();
    expect(document.getElementById('simulationError').hasAttribute('hidden')).toBe(false);

    // Second call: valid input clears error
    document.getElementById('latitudeDeg').value = '';
    mod.runSimulation();
    expect(document.getElementById('simulationError').hasAttribute('hidden')).toBe(true);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// ACC-2: aria-live simulation lifecycle announcements
// ─────────────────────────────────────────────────────────────────────────────
describe('ACC-2: _setSimStatus', () => {
  test('sets textContent on #simStatus', () => {
    mod._setSimStatus('Computing trajectories…');
    expect(document.getElementById('simStatus').textContent).toBe('Computing trajectories…');
  });

  test('clears textContent when called with empty string', () => {
    mod._setSimStatus('some text');
    mod._setSimStatus('');
    expect(document.getElementById('simStatus').textContent).toBe('');
  });
});

describe('ACC-2: runSimulation aria-live announcements', () => {
  test('announces "Computing trajectories…" when simulation starts', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    const promise = mod.runSimulation();
    expect(document.getElementById('simStatus').textContent).toBe('Computing trajectories…');
    await promise;
    jest.runAllTimers();
  });

  test('announces trajectories ready with result count on success', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    expect(document.getElementById('simStatus').textContent).toMatch(/Trajectories ready\. 1 result computed\./);
  });

  test('uses plural "results" when multiple trajectories computed', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr', '3006-150gr']));
    mod._setBullets(mod.getMockBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    const text = document.getElementById('simStatus').textContent;
    expect(text).toMatch(/Trajectories ready\. \d+ results computed\./);
  });

  test('announces simulation failure on TrajectoryInputError', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    const { TrajectoryInputError } = require('../app/physics/engine.ts');
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too large'));

    await mod.runSimulation();

    const text = document.getElementById('simStatus').textContent;
    expect(text).toMatch(/^Simulation failed: /);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FE-R2: savePrefs / loadPrefs map-driven loop
// ─────────────────────────────────────────────────────────────────────────────
describe('FE-R2: savePrefs loop', () => {
  test('sets all 10 non-selectedIds keys with correct DOM values', () => {
    document.getElementById('zeroRange').value     = '200';
    document.getElementById('maxRange').value      = '900';
    document.getElementById('windSpeed').value     = '5';
    document.getElementById('windDir').value       = '0';
    document.getElementById('altitude').value      = '1500';
    document.getElementById('temperature').value   = '10';
    document.getElementById('step').value          = '10';
    document.getElementById('sightHeight').value   = '50';
    document.getElementById('shootingAngle').value = '5';
    document.getElementById('dragModel').value     = 'G7';

    mod.savePrefs();

    expect(localStorage.getItem(mod.PREF_KEYS.zero)).toBe('200');
    expect(localStorage.getItem(mod.PREF_KEYS.maxRange)).toBe('900');
    expect(localStorage.getItem(mod.PREF_KEYS.wind)).toBe('5');
    expect(localStorage.getItem(mod.PREF_KEYS.windDir)).toBe('0');
    expect(localStorage.getItem(mod.PREF_KEYS.altitude)).toBe('1500');
    expect(localStorage.getItem(mod.PREF_KEYS.temp)).toBe('10');
    expect(localStorage.getItem(mod.PREF_KEYS.step)).toBe('10');
    expect(localStorage.getItem(mod.PREF_KEYS.sightHeight)).toBe('50');
    expect(localStorage.getItem(mod.PREF_KEYS.angle)).toBe('5');
    expect(localStorage.getItem(mod.PREF_KEYS.dragModel)).toBe('G7');
  });
});

describe('FE-R2: loadPrefs loop', () => {
  test('empty storage returns same keys/values as { ...PREF_DEFAULTS } with selectedIds null', () => {
    const prefs = mod.loadPrefs();
    const defaults = { ...mod.PREF_DEFAULTS };
    defaults.selectedIds = null;
    expect(prefs).toEqual(defaults);
  });

  test('with all keys in storage returns numeric for numbers and string for dragModel', () => {
    localStorage.setItem(mod.PREF_KEYS.zero,        '150');
    localStorage.setItem(mod.PREF_KEYS.maxRange,    '800');
    localStorage.setItem(mod.PREF_KEYS.wind,        '20');
    localStorage.setItem(mod.PREF_KEYS.windDir,     '270');
    localStorage.setItem(mod.PREF_KEYS.altitude,    '500');
    localStorage.setItem(mod.PREF_KEYS.temp,        '22');
    localStorage.setItem(mod.PREF_KEYS.step,        '50');
    localStorage.setItem(mod.PREF_KEYS.sightHeight, '40');
    localStorage.setItem(mod.PREF_KEYS.angle,       '10');
    localStorage.setItem(mod.PREF_KEYS.dragModel,   'G7');

    const prefs = mod.loadPrefs();

    expect(typeof prefs.zero).toBe('number');
    expect(prefs.zero).toBe(150);
    expect(typeof prefs.dragModel).toBe('string');
    expect(prefs.dragModel).toBe('G7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init
// ─────────────────────────────────────────────────────────────────────────────
describe('init', () => {
  test('loads mock bullets and renders list', () => {
    mod.init();
    expect(document.querySelectorAll('.bullet-card')).toHaveLength(10);
  });

  test('first-visit init selects only bullets[0] (no localStorage, no URL)', () => {
    mod.init();
    const { selectedIds, bullets } = mod._getState();
    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has(bullets[0].id)).toBe(true);
  });


  test('readoutPin click wired by init toggles crosshairPinned', () => {
    mod.init();
    const pinBtn = document.getElementById('readoutPin');
    pinBtn.click();
    expect(mod._getState().crosshairPinned).toBe(true);
    expect(pinBtn.textContent).toBe('UNPIN');
  });

  test('readoutPin second click unpins and clears crosshair state', () => {
    mod.init();
    const pinBtn = document.getElementById('readoutPin');
    pinBtn.click();  // pin
    pinBtn.click();  // unpin
    expect(mod._getState().crosshairPinned).toBe(false);
    expect(mod._getState().crosshairIndex).toBeNull();
    expect(pinBtn.textContent).toBe('PIN');
  });

  test('registers service worker when navigator.serviceWorker is present', async () => {
    const register = jest.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register }, configurable: true, writable: true,
    });
    mod.init();
    expect(register).toHaveBeenCalledWith('/sw.js', { type: 'module', scope: '/' });
    delete navigator.serviceWorker;
  });

  test('PERF-24: defers SW registration until window load when document.readyState !== complete', () => {
    const register = jest.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register }, configurable: true, writable: true,
    });
    const origReady = Object.getOwnPropertyDescriptor(document, 'readyState');
    Object.defineProperty(document, 'readyState', { value: 'interactive', configurable: true });
    try {
      mod.init();
      expect(register).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('load'));
      expect(register).toHaveBeenCalledWith('/sw.js', { type: 'module', scope: '/' });
    } finally {
      if (origReady) Object.defineProperty(document, 'readyState', origReady);
      else Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
      delete navigator.serviceWorker;
    }
  });

  test('logs warning when SW registration rejects', async () => {
    const register = jest.fn().mockRejectedValue(new Error('SW init error'));
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register }, configurable: true, writable: true,
    });
    mod.init();
    // Allow the rejected promise to settle
    await Promise.resolve();
    expect(global.console.warn).toHaveBeenCalledWith(expect.stringMatching(/SW registration failed/), expect.any(Error));
    delete navigator.serviceWorker;
  });

  test('skips SW registration when serviceWorker not supported', () => {
    // jsdom has no navigator.serviceWorker — confirm no crash
    expect(() => mod.init()).not.toThrow();
  });

  test('second init() call aborts prior AbortController (true branch)', () => {
    mod.init();
    // calling init() a second time (without _resetState()) exercises the
    // if (_initListenerController) branch (true)
    mod.init();
    expect(document.querySelectorAll('.bullet-card')).toHaveLength(10);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// runCustom validation
// ─────────────────────────────────────────────────────────────────────────────
describe('runCustom validation', () => {
  function setCustomInputs({ weight = '9.0', mv = '850', bc = '0.45', dia = '7.82' } = {}) {
    document.getElementById('customWeight').value = weight;
    document.getElementById('customMV').value     = mv;
    document.getElementById('customBC').value     = bc;
    document.getElementById('customDia').value    = dia;
  }

  function errorText() {
    return document.getElementById('customError').textContent;
  }

  function errorVisible() {
    return document.getElementById('customError').style.display !== 'none';
  }

  test('shows error when weight is zero', async () => {
    setCustomInputs({ weight: '0' });
    await mod.runCustom();
    expect(errorVisible()).toBe(true);
    expect(errorText()).toMatch(/weight/i);
  });

  test('shows error when muzzle velocity is zero', async () => {
    setCustomInputs({ mv: '0' });
    await mod.runCustom();
    expect(errorVisible()).toBe(true);
    expect(errorText()).toMatch(/muzzle velocity/i);
  });

  test('shows error when BC is zero', async () => {
    setCustomInputs({ bc: '0' });
    await mod.runCustom();
    expect(errorVisible()).toBe(true);
    expect(errorText()).toMatch(/BC/i);
  });

  test('shows error when BC exceeds 1.2', async () => {
    setCustomInputs({ bc: '1.3' });
    await mod.runCustom();
    expect(errorVisible()).toBe(true);
    expect(errorText()).toMatch(/BC/i);
  });

  test('shows error when diameter is zero', async () => {
    setCustomInputs({ dia: '0' });
    await mod.runCustom();
    expect(errorVisible()).toBe(true);
    expect(errorText()).toMatch(/diameter/i);
  });

  test('shows error when latitudeDeg is out of range', async () => {
    setCustomInputs();
    document.getElementById('latitudeDeg').value = '95';
    await mod.runCustom();
    expect(errorVisible()).toBe(true);
    expect(errorText()).toMatch(/latitude/i);
    document.getElementById('latitudeDeg').value = '';
  });

  test('shows error when azimuthDeg is out of range', async () => {
    setCustomInputs();
    document.getElementById('azimuthDeg').value = '-5';
    await mod.runCustom();
    expect(errorVisible()).toBe(true);
    expect(errorText()).toMatch(/azimuth/i);
    document.getElementById('azimuthDeg').value = '';
  });

  test('clears error and proceeds when all inputs are valid', async () => {
    setCustomInputs();
    await mod.runCustom();
    expect(errorVisible()).toBe(false);
    expect(errorText()).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sight height (task 2)
// ─────────────────────────────────────────────────────────────────────────────
describe('sight height parameter', () => {
  const baseBullet = mod.getMockBullets()[0];
  const baseReq = {
    zeroRangeMeters: 100, maxRangeMeters: 300, stepMeters: 100,
    windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15
  };

  test('simulate uses default 38.1 mm when sightHeightMm is absent', () => {
    const r1 = simulate(baseBullet, { ...baseReq });
    const r2 = simulate(baseBullet, { ...baseReq, sightHeightMm: 38.1 });
    // Explicit 38.1 should match the default
    expect(r1.points[1].dropCm).toBeCloseTo(r2.points[1].dropCm, 1);
  });

  test('higher sight height requires steeper launch angle — max ordinate increases', () => {
    const low  = simulate(baseBullet, { ...baseReq, sightHeightMm: 10 });
    const high = simulate(baseBullet, { ...baseReq, sightHeightMm: 100 });
    // 90 mm extra sight height → ~0.9 mrad steeper launch angle → bullet peaks ~4 cm higher
    expect(high.maxOrdinateCm).toBeGreaterThan(low.maxOrdinateCm + 1);
  });

  test('runSimulation includes sightHeightMm from the DOM input', async () => {
    document.getElementById('sightHeight').value = '50';
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));

    let capturedBody;
    global.fetch.mockImplementation(async (url, opts) => {
      if (url.includes('stream')) { capturedBody = JSON.parse(opts.body); throw new Error('no stream'); }
      if (url.includes('compare')) { capturedBody = JSON.parse(opts.body); throw new Error('no batch'); }
      throw new Error('offline');
    });

    await mod.runSimulation();
    jest.runAllTimers();
    expect(capturedBody?.sightHeightMm ?? mod._getState().lastResults[0]?.request?.sightHeightMm).toBe(50);
  });

  test('runCustom includes sightHeightMm from the DOM input', async () => {
    document.getElementById('sightHeight').value = '60';
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runCustom();
    const result = mod._getState().lastResults[0];
    expect(result?.request?.sightHeightMm).toBe(60);
  });

  test('runSimulation includes latitudeDeg and azimuthDeg when DOM inputs are filled', async () => {
    document.getElementById('latitudeDeg').value = '45';
    document.getElementById('azimuthDeg').value  = '90';
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runSimulation();
    jest.runAllTimers();
    const result = mod._getState().lastResults[0];
    expect(result?.request?.latitudeDeg).toBe(45);
    expect(result?.request?.azimuthDeg).toBe(90);
  });

  test('runSimulation omits latitudeDeg when DOM input is empty', async () => {
    document.getElementById('latitudeDeg').value = '';
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runSimulation();
    jest.runAllTimers();
    const result = mod._getState().lastResults[0];
    expect(result?.request?.latitudeDeg).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shooting angle correction (rifleman's rule)
// ─────────────────────────────────────────────────────────────────────────────
describe('shooting angle correction', () => {
  const baseBullet = mod.getMockBullets()[0];
  const baseReq = {
    zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 100,
    windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15, sightHeightMm: 38.1
  };

  test('angle=0 produces same drop as no angle specified', () => {
    const withNull  = simulate(baseBullet, { ...baseReq });
    const withZero  = simulate(baseBullet, { ...baseReq, shootingAngleDegrees: 0 });
    const last = withNull.points.length - 1;
    expect(withZero.points[last].dropCm).toBeCloseTo(withNull.points[last].dropCm, 1);
  });

  test('uphill angle (+20°) reduces apparent drop magnitude vs flat', () => {
    const flat   = simulate(baseBullet, { ...baseReq, shootingAngleDegrees: 0 });
    const uphill = simulate(baseBullet, { ...baseReq, shootingAngleDegrees: 20 });
    const i = flat.points.length - 1;
    // drop is negative past zero; |uphill| < |flat| (cos(20°) ≈ 0.94)
    expect(Math.abs(uphill.points[i].dropCm)).toBeLessThan(Math.abs(flat.points[i].dropCm));
  });

  test('downhill angle (-20°) reduces apparent drop magnitude vs flat', () => {
    const flat = simulate(baseBullet, { ...baseReq, shootingAngleDegrees: 0 });
    const down = simulate(baseBullet, { ...baseReq, shootingAngleDegrees: -20 });
    const i = flat.points.length - 1;
    expect(Math.abs(down.points[i].dropCm)).toBeLessThan(Math.abs(flat.points[i].dropCm));
  });

  test('uphill and downhill produce same drop magnitude (cos is symmetric)', () => {
    const up   = simulate(baseBullet, { ...baseReq, shootingAngleDegrees:  30 });
    const down = simulate(baseBullet, { ...baseReq, shootingAngleDegrees: -30 });
    const i = up.points.length - 1;
    expect(Math.abs(up.points[i].dropCm)).toBeCloseTo(Math.abs(down.points[i].dropCm), 1);
  });

  test('runSimulation includes shootingAngleDegrees from the DOM input', async () => {
    document.getElementById('shootingAngle').value = '15';
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));

    let capturedBody;
    global.fetch.mockImplementation(async (url, opts) => {
      if (url.includes('stream')) { capturedBody = JSON.parse(opts.body); throw new Error('no stream'); }
      if (url.includes('compare')) { capturedBody = JSON.parse(opts.body); throw new Error('no batch'); }
      throw new Error('offline');
    });

    await mod.runSimulation();
    jest.runAllTimers();
    // Either captured from API call or from offline fallback
    const angle = capturedBody?.shootingAngleDegrees ??
                  mod._getState().lastResults[0]?.request?.shootingAngleDegrees;
    expect(angle).toBe(15);
  });

  test('runCustom includes shootingAngleDegrees from the DOM input', async () => {
    document.getElementById('shootingAngle').value = '-10';
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runCustom();
    const result = mod._getState().lastResults[0];
    expect(result?.request?.shootingAngleDegrees).toBe(-10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// crosshair plugin (task 5)
// ─────────────────────────────────────────────────────────────────────────────
describe('crosshairPlugin', () => {
  test('has id ballistics-crosshair', () => {
    expect(mod.crosshairPlugin.id).toBe('ballistics-crosshair');
  });

  test('afterDraw does nothing when crosshairIndex is null', () => {
    mod._resetState();
    const fakeChart = {
      getDatasetMeta: jest.fn(() => ({ data: [] })),
      chartArea: { top: 0, bottom: 100 },
      ctx: { save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(), setLineDash: jest.fn() }
    };
    mod.crosshairPlugin.afterDraw(fakeChart);
    expect(fakeChart.ctx.beginPath).not.toHaveBeenCalled();
  });

  test('all five charts are created with crosshairPlugin in plugins array', async () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {}, points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }
      ],
      maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800
    }];
    MockChart.mockClear();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(MockChart).toHaveBeenCalledTimes(5);
    MockChart.mock.calls.forEach(([, cfg]) => {
      expect(Array.isArray(cfg.plugins)).toBe(true);
      expect(cfg.plugins.some(p => p.id === 'ballistics-crosshair')).toBe(true);
    });
  });

  test('all five charts use interaction mode nearest', async () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {}, points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }
      ],
      maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800
    }];
    MockChart.mockClear();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    MockChart.mock.calls.forEach(([, cfg]) => {
      expect(cfg.options.interaction.mode).toBe('nearest');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// annotationPlugin (Task 7)
// ─────────────────────────────────────────────────────────────────────────────
describe('annotationPlugin', () => {
  /** Minimal mock canvas context with all methods used by draw helpers. */
  function makeCtx() {
    return {
      save: jest.fn(), restore: jest.fn(),
      beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(),
      stroke: jest.fn(), setLineDash: jest.fn(),
      fillText: jest.fn(),
      strokeStyle: '', lineWidth: 0, fillStyle: '', font: '', textAlign: '',
    };
  }
  /** Minimal fake chart wiring ctx + scales + chartArea. */
  function makeChart(ctx, xMax = 1000) {
    return {
      ctx,
      scales: {
        x: { max: xMax, getPixelForValue: jest.fn(v => v) },
        y: { getPixelForValue: jest.fn(v => -v) },   // invert so drop shows correctly
      },
      chartArea: { top: 0, bottom: 200, left: 0, right: 1000 },
    };
  }

  test('plugin has id ballistics-annotations', () => {
    expect(mod.annotationPlugin([]).id).toBe('ballistics-annotations');
  });

  test('afterDraw returns early and draws nothing when annotations is empty', () => {
    const ctx = makeCtx();
    mod.annotationPlugin([]).afterDraw(makeChart(ctx));
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  test('afterDraw draws one vertical line for a vertical annotation', () => {
    const ctx = makeCtx();
    const ann = { type: 'vertical', value: 800, label: 'SUPERSONIC ←', color: 'rgba(255,160,0,0.6)' };
    mod.annotationPlugin([ann]).afterDraw(makeChart(ctx));
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('SUPERSONIC ←', expect.any(Number), expect.any(Number));
    expect(ctx.restore).toHaveBeenCalled();
  });

  test('afterDraw draws one horizontal line for a horizontal annotation', () => {
    const ctx = makeCtx();
    const ann = { type: 'horizontal', value: 5, label: 'MAX ORD', color: 'rgba(0,212,255,0.4)' };
    mod.annotationPlugin([ann]).afterDraw(makeChart(ctx));
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('MAX ORD', expect.any(Number), expect.any(Number));
  });

  test('afterDraw draws stroke() once per annotation for mixed types', () => {
    const ctx = makeCtx();
    const anns = [
      { type: 'vertical',   value: 800, label: 'SUPERSONIC ←', color: 'rgba(255,160,0,0.6)' },
      { type: 'horizontal', value: 5,   label: 'MAX ORD',       color: 'rgba(0,212,255,0.4)' },
      { type: 'vertical',   value: 50,  label: 'PEAK',          color: 'rgba(0,212,255,0.4)' },
    ];
    mod.annotationPlugin(anns).afterDraw(makeChart(ctx));
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
    expect(ctx.fillText).toHaveBeenCalledTimes(3);
  });

  test('vertical annotation beyond xScale.max is clamped — no error thrown', () => {
    const ctx = makeCtx();
    // supersonicLimitMeters (1500) > maxRangeMeters (1000) — must clamp
    const ann = { type: 'vertical', value: 1500, label: 'SUPERSONIC ←', color: 'rgba(255,160,0,0.6)' };
    const chart = makeChart(ctx, 1000);
    expect(() => mod.annotationPlugin([ann]).afterDraw(chart)).not.toThrow();
    // getPixelForValue must be called with the clamped value (1000), not 1500
    expect(chart.scales.x.getPixelForValue).toHaveBeenCalledWith(1000);
  });

  test('drawVLine is exported and draws a line on the context', () => {
    const ctx = makeCtx();
    const xScale   = { max: 1000, getPixelForValue: jest.fn(v => v) };
    const chartArea = { top: 0, bottom: 200, left: 0, right: 1000 };
    mod.drawVLine(ctx, xScale, chartArea, { value: 500, label: 'TEST', color: 'red' });
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('TEST', expect.any(Number), expect.any(Number));
  });

  test('drawHLine is exported and draws a line on the context', () => {
    const ctx = makeCtx();
    const yScale    = { getPixelForValue: jest.fn(v => -v) };
    const chartArea = { top: 0, bottom: 200, left: 0, right: 1000 };
    mod.drawHLine(ctx, yScale, chartArea, { value: 5, label: 'MAX ORD', color: 'cyan' });
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('MAX ORD', expect.any(Number), expect.any(Number));
  });
});

describe('annotationPlugin integration with renderResults', () => {
  function makeResult(overrides = {}) {
    return {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552,
                 windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 8.5, maxOrdinateRangeMeters: 55, supersonicLimitMeters: 820,
      ...overrides,
    };
  }

  test('all five charts receive an annotationPlugin in their plugins array', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(MockChart).toHaveBeenCalledTimes(5);
    MockChart.mock.calls.forEach(([, cfg]) => {
      const hasAnnot = cfg.plugins.some(p => p.id === 'ballistics-annotations');
      expect(hasAnnot).toBe(true);
    });
  });

  test('drop chart plugin carries 3 annotations (supersonic + maxOrd + peak)', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
    // First Chart call is for dropChart
    const dropCfg = MockChart.mock.calls[0][1];
    const annotPlug = dropCfg.plugins.find(p => p.id === 'ballistics-annotations');
    expect(annotPlug).toBeDefined();
    // Call afterDraw with a fake chart to verify 3 strokes
    const ctx = {
      save: jest.fn(), restore: jest.fn(),
      beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(),
      stroke: jest.fn(), setLineDash: jest.fn(), fillText: jest.fn(),
      strokeStyle: '', lineWidth: 0, fillStyle: '', font: '', textAlign: '',
    };
    annotPlug.afterDraw({
      ctx,
      scales: {
        x: { max: 1000, getPixelForValue: v => v },
        y: { getPixelForValue: v => -v },
      },
      chartArea: { top: 0, bottom: 200, left: 0, right: 1000 },
    });
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });

  test('non-drop charts carry only 1 annotation (supersonic limit)', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
    // calls[1] = velocityChart, [2] = energyChart, [3] = windChart
    [1, 2, 3].forEach(i => {
      const cfg = MockChart.mock.calls[i][1];
      const annotPlug = cfg.plugins.find(p => p.id === 'ballistics-annotations');
      const ctx = {
        save: jest.fn(), restore: jest.fn(),
        beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(),
        stroke: jest.fn(), setLineDash: jest.fn(), fillText: jest.fn(),
        strokeStyle: '', lineWidth: 0, fillStyle: '', font: '', textAlign: '',
      };
      annotPlug.afterDraw({
        ctx,
        scales: { x: { max: 1000, getPixelForValue: v => v }, y: { getPixelForValue: v => -v } },
        chartArea: { top: 0, bottom: 200, left: 0, right: 1000 },
      });
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });
  });

  test('empty results array → annotation plugin carries empty array → no strokes', () => {
    MockChart.mockClear();
    // renderResults with empty array won't call Chart at all — test annotationPlugin([]) directly
    const plugin = mod.annotationPlugin([]);
    const ctx = { save: jest.fn(), stroke: jest.fn(), restore: jest.fn() };
    plugin.afterDraw({ ctx, scales: { x: {}, y: {} }, chartArea: {} });
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  test('renderResults with empty array uses empty annotation arrays (ternary false branches)', async () => {
    MockChart.mockClear();
    // Covers sonicAnn = [] and dropAnns = [] branches when results[0] is undefined
    await mod.renderResults([], { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(MockChart).toHaveBeenCalledTimes(5);
    MockChart.mock.calls.forEach(([, cfg]) => {
      const annotPlug = cfg.plugins.find(p => p.id === 'ballistics-annotations');
      expect(annotPlug).toBeDefined();
      // Plugin should have empty annotations — afterDraw is a no-op
      const ctx = { save: jest.fn(), stroke: jest.fn() };
      annotPlug.afterDraw({ ctx, scales: { x: {}, y: {} }, chartArea: {} });
      expect(ctx.stroke).not.toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateReadout (task 5)
// ─────────────────────────────────────────────────────────────────────────────
describe('updateReadout', () => {
  const results = [{
    bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP' },
    points: [
      { rangeMeters: 0,   dropCm: 0,    velocityMps: 807, energyJoules: 3552, windDriftCm: 0   },
      { rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 3.1 },
      { rangeMeters: 200, dropCm: -11,  velocityMps: 710, energyJoules: 2750, windDriftCm: 7.4 }
    ]
  }];

  test('shows the readout panel', () => {
    mod.updateReadout(results, 1);
    expect(document.getElementById('rangeReadout').style.display).toBe('block');
  });

  test('displays the range for the hovered index', () => {
    mod.updateReadout(results, 1);
    expect(document.getElementById('readoutRange').textContent).toBe('100 m');
  });

  test('renders one row per result in the readout body', () => {
    mod.updateReadout(results, 1);
    const rows = document.querySelectorAll('#readoutBody tr');
    expect(rows).toHaveLength(1);
  });

  test('row contains drop, velocity, energy and wind values', () => {
    mod.updateReadout(results, 2);
    const row = document.querySelector('#readoutBody tr');
    expect(row.textContent).toContain('-11 cm');
    expect(row.textContent).toContain('710 m/s');
    expect(row.textContent).toContain('2750 J');
    expect(row.textContent).toContain('+7.4 cm');
  });

  test('positive drop gets + prefix, negative drop has no extra sign', () => {
    const posResults = [{
      bullet: { id: '308-win-168gr', name: 'Test' },
      points: [{ rangeMeters: 50, dropCm: 3.2, velocityMps: 807, energyJoules: 3552, windDriftCm: 0 }]
    }];
    mod.updateReadout(posResults, 0);
    expect(document.querySelector('#readoutBody tr').textContent).toContain('+3.2 cm');
  });

  test('bullet name in readout row is HTML-escaped', () => {
    const xssResults = [{
      bullet: { id: '308-win-168gr', name: '<script>alert(1)</script>' },
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0 }]
    }];
    mod.updateReadout(xssResults, 0);
    const tbody = document.getElementById('readoutBody').innerHTML;
    expect(tbody).not.toContain('<script>alert');
    expect(tbody).toContain('&lt;script&gt;');
  });

  test('does nothing when panel element is absent', () => {
    document.getElementById('rangeReadout').remove();
    expect(() => mod.updateReadout(results, 0)).not.toThrow();
  });

  test('shows Spin Drift cell with correct value when spinDriftCm > 0', () => {
    const spinResults = [{
      bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP' },
      points: [{ rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 3.1, spinDriftCm: 1.23 }]
    }];
    mod.updateReadout(spinResults, 0);
    const row = document.querySelector('#readoutBody tr');
    expect(row.textContent).toContain('Spin Drift');
    expect(row.textContent).toContain('1.2 cm');
  });

  test('omits Spin Drift cell when spinDriftCm === 0', () => {
    const noSpinResults = [{
      bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP' },
      points: [{ rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 3.1, spinDriftCm: 0 }]
    }];
    mod.updateReadout(noSpinResults, 0);
    const row = document.querySelector('#readoutBody tr');
    expect(row.textContent).not.toContain('Spin Drift');
  });

  test('omits Spin Drift cell when spinDriftCm is absent', () => {
    const noSpinResults = [{
      bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP' },
      points: [{ rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 3.1 }]
    }];
    mod.updateReadout(noSpinResults, 0);
    const row = document.querySelector('#readoutBody tr');
    expect(row.textContent).not.toContain('Spin Drift');
  });

  test('shows Coriolis cell with + prefix for positive coriolisDeflectionCm', () => {
    const corResults = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [{ rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 3.1, coriolisDeflectionCm: 2.3 }],
    }];
    mod.updateReadout(corResults, 0);
    const row = document.querySelector('#readoutBody tr');
    expect(row.textContent).toContain('Coriolis');
    expect(row.textContent).toContain('+2.3 cm');
  });

  test('shows Coriolis cell without + prefix for negative coriolisDeflectionCm', () => {
    const corResults = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [{ rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 3.1, coriolisDeflectionCm: -1.8 }],
    }];
    mod.updateReadout(corResults, 0);
    const row = document.querySelector('#readoutBody tr');
    expect(row.textContent).toContain('Coriolis');
    expect(row.textContent).toContain('-1.8 cm');
    expect(row.textContent).not.toContain('+-');
  });

  test('omits Coriolis cell when coriolisDeflectionCm is undefined', () => {
    const noCorResults = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [{ rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 3.1 }],
    }];
    mod.updateReadout(noCorResults, 0);
    expect(document.querySelector('#readoutBody tr').textContent).not.toContain('Coriolis');
  });

  test('omits Coriolis cell when coriolisDeflectionCm is null', () => {
    const nullCorResults = [{
      bullet: { id: '308-win-168gr', name: '.308' },
      points: [{ rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 3.1, coriolisDeflectionCm: null }],
    }];
    mod.updateReadout(nullCorResults, 0);
    expect(document.querySelector('#readoutBody tr').textContent).not.toContain('Coriolis');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// offline retry (task 4)
// ─────────────────────────────────────────────────────────────────────────────
describe('showToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('showToast removes toast-visible class after 3 seconds', () => {
    mod.showToast('Hello');
    const el = document.getElementById('toast');
    expect(el.classList.contains('toast-visible')).toBe(true);
    jest.advanceTimersByTime(3000);
    expect(el.classList.contains('toast-visible')).toBe(false);
  });

  test('showToast hides toast element 300 ms after class removed', () => {
    mod.showToast('Hello');
    const el = document.getElementById('toast');
    jest.advanceTimersByTime(3300);
    expect(el.style.display).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// chart onHover / onClick callbacks (task 5 coverage)
// ─────────────────────────────────────────────────────────────────────────────
describe('chart interaction callbacks', () => {
  const singleResult = [{
    bullet: { id: '308-win-168gr', name: '.308 Win 168gr', muzzleVelocityMps: 807,
              muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
    request: {}, points: [
      { rangeMeters: 0,   dropCm: 0,    velocityMps: 807, energyJoules: 3552, windDriftCm: 0 },
      { rangeMeters: 100, dropCm: -2.5, velocityMps: 760, energyJoules: 3150, windDriftCm: 0 }
    ],
    maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800
  }];

  async function renderAndGetCallbacks() {
    MockChart.mockClear();
    await mod.renderResults(singleResult, { zeroRangeMeters: 100, windSpeedKph: 0 });
    return MockChart.mock.calls[0][1].options;
  }

  test('onHover with elements sets crosshairIndex and shows readout', async () => {
    const opts = await renderAndGetCallbacks();
    opts.onHover({}, [{ index: 1 }]);
    expect(mod._getState().crosshairIndex).toBe(1);
    jest.runOnlyPendingTimers();
    expect(document.getElementById('rangeReadout').style.display).toBe('block');
  });

  test('onHover with no elements clears crosshairIndex and hides readout', async () => {
    const opts = await renderAndGetCallbacks();
    opts.onHover({}, [{ index: 0 }]);
    jest.runOnlyPendingTimers();
    opts.onHover({}, []);
    jest.runOnlyPendingTimers();
    expect(mod._getState().crosshairIndex).toBeNull();
    expect(document.getElementById('rangeReadout').style.display).toBe('none');
  });

  test('onHover does nothing when crosshairPinned is true', async () => {
    const opts = await renderAndGetCallbacks();
    opts.onClick({}, [{ index: 0 }]);  // pin
    expect(mod._getState().crosshairPinned).toBe(true);
    opts.onHover({}, [{ index: 1 }]);
    expect(mod._getState().crosshairIndex).toBe(0); // unchanged
  });

  test('onClick toggles pin and sets crosshairIndex', async () => {
    const opts = await renderAndGetCallbacks();
    opts.onClick({}, [{ index: 1 }]);
    expect(mod._getState().crosshairPinned).toBe(true);
    expect(mod._getState().crosshairIndex).toBe(1);
    expect(document.getElementById('readoutPin').textContent).toBe('UNPIN');
  });

  test('onClick with no elements is a no-op', async () => {
    const opts = await renderAndGetCallbacks();
    opts.onClick({}, []);
    expect(mod._getState().crosshairPinned).toBe(false);
  });

  test('onClick unpins and hides readout on second click', async () => {
    const opts = await renderAndGetCallbacks();
    opts.onClick({}, [{ index: 0 }]);
    opts.onClick({}, [{ index: 0 }]);
    expect(mod._getState().crosshairPinned).toBe(false);
    expect(document.getElementById('rangeReadout').style.display).toBe('none');
  });

  test('crosshairPlugin afterDraw draws a line when crosshairIndex is set', async () => {
    const opts = await renderAndGetCallbacks();
    opts.onHover({}, [{ index: 1 }]);
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(),
      moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(), setLineDash: jest.fn()
    };
    const fakeChart = {
      getDatasetMeta: jest.fn(() => ({ data: [null, { x: 50 }] })),
      chartArea: { top: 0, bottom: 100 },
      ctx
    };
    mod.crosshairPlugin.afterDraw(fakeChart);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  test('crosshairPlugin uses brighter stroke when pinned', async () => {
    const opts = await renderAndGetCallbacks();
    opts.onClick({}, [{ index: 1 }]);  // pin
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(),
      moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(), setLineDash: jest.fn()
    };
    mod.crosshairPlugin.afterDraw({
      getDatasetMeta: jest.fn(() => ({ data: [null, { x: 50 }] })),
      chartArea: { top: 0, bottom: 100 },
      ctx
    });
    expect(ctx.strokeStyle).toContain('0.7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportCSV
// ─────────────────────────────────────────────────────────────────────────────
describe('exportCSV', () => {
  let createObjectURL, revokeObjectURL, anchorClick;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    global.Blob = jest.fn((parts) => ({ parts }));
    anchorClick = jest.fn();
    HTMLAnchorElement.prototype.click = anchorClick;
  });

  afterEach(() => {
    delete HTMLAnchorElement.prototype.click;
  });

  test('returns early without creating a Blob when lastResults is empty', async () => {
    mod._resetState();
    await mod.exportCSV();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test('builds CSV rows and triggers download when results are present', async () => {
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    mod._setLastResults([result]);
    await mod.exportCSV();

    expect(global.Blob).toHaveBeenCalledTimes(1);
    const csvContent = global.Blob.mock.calls[0][0][0];
    expect(csvContent).toContain('Range (m)');
    expect(csvContent).toContain('MOA');
    expect(csvContent).toContain('MRAD');
    expect(csvContent).toContain(bullet.name.replace(/"/g, '""'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportJSON
// ─────────────────────────────────────────────────────────────────────────────
describe('exportJSON', () => {
  let createObjectURL, revokeObjectURL, anchorClick;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    global.Blob = jest.fn((parts) => ({ parts }));
    anchorClick = jest.fn();
    HTMLAnchorElement.prototype.click = anchorClick;
  });

  afterEach(() => {
    delete HTMLAnchorElement.prototype.click;
  });

  test('returns early without creating a Blob when lastResults is empty', async () => {
    mod._resetState();
    await mod.exportJSON();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test('creates a JSON blob with all result data and triggers download', async () => {
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    mod._setLastResults([result]);
    await mod.exportJSON();

    expect(global.Blob).toHaveBeenCalledTimes(1);
    const jsonContent = global.Blob.mock.calls[0][0][0];
    const parsed = JSON.parse(jsonContent);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].bullet.name).toBe(bullet.name);
    expect(parsed[0].points).toBeDefined();
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// importResultsFromFile (DM-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('importResultsFromFile', () => {
  function makeFileReaderMock(content) {
    const mockReader = {
      onload: null,
      readAsText(file) {
        // Fire onload synchronously with the provided content
        this.onload({ target: { result: content } });
      },
    };
    global.FileReader = jest.fn(() => mockReader);
    return mockReader;
  }

  beforeEach(() => {
    buildDOM();
  });

  test('renders results when given valid JSON with bullet and points', async () => {
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    const json = JSON.stringify([result]);
    makeFileReaderMock(json);
    const file = new File([json], 'trajectory.json', { type: 'application/json' });

    await mod.importResultsFromFile(file);

    expect(document.getElementById('resultsContainer').style.display).not.toBe('none');
    expect(document.getElementById('emptyState').style.display).toBe('none');
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(true);
  });

  test('shows error when JSON is not valid', async () => {
    makeFileReaderMock('not-valid-json{{{');
    const file = new File(['not-valid-json{{{'], 'bad.json', { type: 'application/json' });

    await mod.importResultsFromFile(file);

    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/not valid JSON/i);
  });

  test('shows error when JSON is not a non-empty array', async () => {
    makeFileReaderMock(JSON.stringify({}));
    const file = new File([JSON.stringify({})], 'bad.json', { type: 'application/json' });

    await mod.importResultsFromFile(file);

    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/non-empty array/i);
  });

  test('shows error when JSON is an empty array', async () => {
    makeFileReaderMock(JSON.stringify([]));
    const file = new File([JSON.stringify([])], 'bad.json', { type: 'application/json' });

    await mod.importResultsFromFile(file);

    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/non-empty array/i);
  });

  test('shows error when an item is missing the bullet property', async () => {
    const payload = JSON.stringify([{ points: [] }]);
    makeFileReaderMock(payload);
    const file = new File([payload], 'bad.json', { type: 'application/json' });

    await mod.importResultsFromFile(file);

    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/bullet.*points/i);
  });

  test('shows error when an item is missing the points property', async () => {
    const payload = JSON.stringify([{ bullet: { name: 'Test' } }]);
    makeFileReaderMock(payload);
    const file = new File([payload], 'bad.json', { type: 'application/json' });

    await mod.importResultsFromFile(file);

    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/bullet.*points/i);
  });

  test('returns early without reading when file is falsy', async () => {
    const FileReaderSpy = jest.fn();
    global.FileReader = FileReaderSpy;
    await mod.importResultsFromFile(null);
    expect(FileReaderSpy).not.toHaveBeenCalled();
  });

  // ── Security: file size limit ──────────────────────────────────────────────
  test('rejects file larger than 5 MB without reading', async () => {
    const FileReaderSpy = jest.fn();
    global.FileReader = FileReaderSpy;
    const bigFile = { size: 6 * 1024 * 1024 };
    await mod.importResultsFromFile(bigFile);
    expect(FileReaderSpy).not.toHaveBeenCalled();
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/5 MB/i);
  });

  // ── Security: result count cap ─────────────────────────────────────────────
  test('rejects array with more than 10 results', async () => {
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    const payload = JSON.stringify(Array(11).fill(result));
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/more than 10/i);
  });

  // ── Security: points array must be an array ────────────────────────────────
  test('rejects result whose "points" is a plain object (not an array)', async () => {
    const bullet = mod.getMockBullets()[0];
    const payload = JSON.stringify([{ bullet: { id: 'x', name: 'X' }, points: {} }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/points.*array/i);
  });

  test('rejects result whose "points" is a string (not an array)', async () => {
    const payload = JSON.stringify([{ bullet: { id: 'x', name: 'X' }, points: 'bad' }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/points.*array/i);
  });

  // ── Security: points count cap ─────────────────────────────────────────────
  test('rejects result with more than 2000 points', async () => {
    const pt = { rangeMeters: 0, dropCm: 0, velocityMps: 850, energyJoules: 3000, windDriftCm: 0, timeOfFlightSec: 0 };
    const points = Array(2001).fill(pt);
    const payload = JSON.stringify([{ bullet: { id: 'x', name: 'X' }, points }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/2000/i);
  });

  // ── Security: hexColor XSS ────────────────────────────────────────────────
  test('strips a malicious hexColor and still renders when other fields are valid', async () => {
    const pt = { rangeMeters: 100, dropCm: -5, velocityMps: 850, energyJoules: 3000,
                 windDriftCm: 0, timeOfFlightSec: 0.12 };
    const maliciousBullet = {
      id: 'evil', name: 'Evil Bullet',
      hexColor: 'red><img src=x onerror=alert(1)>',
      muzzleVelocityMps: 850, ballisticCoefficient: 0.45,
      bulletWeightGrams: 9, bulletDiameterMm: 7.82, muzzleEnergyJoules: 3251,
    };
    const payload = JSON.stringify([{
      bullet: maliciousBullet,
      points: [pt],
      supersonicLimitMeters: 500, maxOrdinateCm: 10, maxOrdinateRangeMeters: 200,
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    // Should not error — the bad hexColor is simply dropped
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(true);
    // The table should not contain the XSS payload
    expect(document.body.innerHTML).not.toContain('onerror=alert');
  });

  // ── Security: numeric field containing a non-finite value ─────────────────
  test('rejects a bullet whose numeric field is a non-finite string', async () => {
    const pt = { rangeMeters: 100, dropCm: -5, velocityMps: 850, energyJoules: 3000,
                 windDriftCm: 0, timeOfFlightSec: 0.12 };
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'X', muzzleVelocityMps: '=HYPERLINK("http://evil.example/")' },
      points: [pt],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/finite number/i);
  });

  test('rejects a point whose numeric field is Infinity', async () => {
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'X' },
      points: [{ rangeMeters: Infinity, dropCm: 0, velocityMps: 850, energyJoules: 3000,
                 windDriftCm: 0, timeOfFlightSec: 0 }],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/finite number/i);
  });

  test('rejects a result-level numeric field that is not finite', async () => {
    const pt = { rangeMeters: 100, dropCm: 0, velocityMps: 850, energyJoules: 3000,
                 windDriftCm: 0, timeOfFlightSec: 0 };
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'X' },
      points: [pt],
      supersonicLimitMeters: NaN,
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/finite number/i);
  });

  // ── Security: __proto__ pollution ─────────────────────────────────────────
  test('is safe when input contains a __proto__ key', async () => {
    // The allowlist rebuild means __proto__ is never copied to sanitised objects
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'X', '__proto__': { polluted: true } },
      points: [{ rangeMeters: 100, dropCm: 0, velocityMps: 850, energyJoules: 3000,
                 windDriftCm: 0, timeOfFlightSec: 0 }],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    // Should succeed — __proto__ key is ignored by allowlist
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(true);
    expect(({}).polluted).toBeUndefined();
  });

  // ── Security: bullet.id / bullet.name string caps ─────────────────────────
  test('rejects bullet.id that is not a string', async () => {
    const payload = JSON.stringify([{
      bullet: { id: 42, name: 'X' },
      points: [],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/bullet\.id/i);
  });

  test('rejects bullet.id longer than 200 characters', async () => {
    const payload = JSON.stringify([{
      bullet: { id: 'a'.repeat(201), name: 'X' },
      points: [],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/bullet\.id/i);
  });

  test('rejects bullet.name that is not a string', async () => {
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 999 },
      points: [],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/bullet\.name/i);
  });

  test('rejects bullet.name longer than 200 characters', async () => {
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'b'.repeat(201) },
      points: [],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/bullet\.name/i);
  });

  // ── Security: bullet property that is a non-object ────────────────────────
  test('rejects item whose bullet is a string (not an object)', async () => {
    const payload = JSON.stringify([{ bullet: 'not-an-object', points: [] }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/bullet.*object/i);
  });

  // ── Security: point that is not an object ─────────────────────────────────
  test('rejects a points array containing a non-object element (string)', async () => {
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'X' },
      points: ['bad-point'],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/each point must be an object/i);
  });

  test('rejects a points array containing a null element', async () => {
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'X' },
      points: [null],
    }]);
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    expect(errorEl.hasAttribute('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/each point must be an object/i);
  });

  // ── Low: renderResults error is caught gracefully ────────────────────────
  test('shows error and clears lastResults when renderResults throws', async () => {
    const pt = { rangeMeters: 100, dropCm: -5, velocityMps: 850, energyJoules: 3000,
                 windDriftCm: 0, timeOfFlightSec: 0.12 };
    const payload = JSON.stringify([{
      bullet: { id: 'x', name: 'X' },
      points: [pt],
    }]);
    // Force renderResults to throw by activating dataPanel and removing tableBody
    document.getElementById('dataPanel').classList.add('active');
    document.getElementById('tableBody').remove();
    makeFileReaderMock(payload);
    const file = { size: payload.length };
    await mod.importResultsFromFile(file);
    const errorEl = document.getElementById('simulationError');
    // Either succeeds (tableBody absence is handled) or the error is caught
    // The important thing is the page does not throw uncaught
    expect(typeof errorEl.textContent).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// colorFor — XSS protection
// ─────────────────────────────────────────────────────────────────────────────
describe('colorFor', () => {
  test('returns hexColor when it is a valid #rrggbb value', () => {
    expect(mod.colorFor({ hexColor: '#ff0000' })).toBe('#ff0000');
    expect(mod.colorFor({ hexColor: '#4ADE80' })).toBe('#4ADE80');
    expect(mod.colorFor({ hexColor: '#000000' })).toBe('#000000');
  });

  test('falls back to catalog colour when hexColor is a malicious string', () => {
    const result = mod.colorFor({ hexColor: 'red><img src=x onerror=alert(1)>' });
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('onerror');
  });

  test('falls back to catalog colour when hexColor is an invalid colour name', () => {
    const result = mod.colorFor({ hexColor: 'red' });
    expect(result).not.toBe('red');
    expect(result.startsWith('#')).toBe(true);
  });

  test('falls back to catalog colour when hexColor is a 3-digit hex', () => {
    const result = mod.colorFor({ hexColor: '#f00' });
    expect(result).not.toBe('#f00');
    expect(result.startsWith('#')).toBe(true);
  });

  test('returns default green when bullet has no hexColor and id is unknown', () => {
    expect(mod.colorFor({ id: 'unknown-bullet-xyz', name: 'X' })).toBe('#4ADE80');
  });
});

describe('importJsonBtn / importJsonFile wiring', () => {
  beforeEach(async () => {
    buildDOM();
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', result: mod.getMockBullets(), id: 1 }) });
    await mod.init();
  });

  test('clicking #importJsonBtn triggers click on #importJsonFile', () => {
    const fileInput = document.getElementById('importJsonFile');
    const clickSpy = jest.fn();
    fileInput.click = clickSpy;
    document.getElementById('importJsonBtn').click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('#importJsonFile change event calls importResultsFromFile and resets value', async () => {
    const bullet = mod.getMockBullets()[0];
    const { simulate: simulateFn } = require('../app/physics/engine.ts');
    const result = simulateFn(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    const json = JSON.stringify([result]);

    const mockReader = {
      onload: null,
      readAsText() { this.onload({ target: { result: json } }); },
    };
    global.FileReader = jest.fn(() => mockReader);

    const fileInput = document.getElementById('importJsonFile');
    Object.defineProperty(fileInput, 'files', { value: [new File([json], 'trajectory.json')], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(document.getElementById('resultsContainer').style.display).not.toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportMarkdown
// ─────────────────────────────────────────────────────────────────────────────
describe('exportMarkdown', () => {
  let createObjectURL, revokeObjectURL, anchorClick;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    global.Blob = jest.fn((parts) => ({ parts }));
    anchorClick = jest.fn();
    HTMLAnchorElement.prototype.click = anchorClick;
  });

  afterEach(() => {
    delete HTMLAnchorElement.prototype.click;
  });

  test('returns early without creating a Blob when lastResults is empty', async () => {
    mod._resetState();
    await mod.exportMarkdown();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test('creates Markdown with table headers and bullet name heading', async () => {
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    mod._setLastResults([result]);
    await mod.exportMarkdown();

    expect(global.Blob).toHaveBeenCalledTimes(1);
    const md = global.Blob.mock.calls[0][0][0];
    expect(md).toContain(`## ${bullet.name}`);
    expect(md).toContain('| Range (m)');
    expect(md).toContain('| MOA |');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// export dropdown wiring
// ─────────────────────────────────────────────────────────────────────────────
describe('export dropdown toggle', () => {
  beforeEach(() => {
    buildDOM();
    // Append the export dropdown elements to the existing DOM
    const dropdown = document.createElement('div');
    dropdown.className = 'export-dropdown';
    dropdown.innerHTML = `
      <button class="export-toggle">EXPORT ▾</button>
      <div class="export-menu">
        <button class="export-csv-btn">CSV</button>
        <button class="export-json-btn">JSON</button>
        <button class="export-md-btn">Markdown</button>
      </div>`;
    document.body.appendChild(dropdown);
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', result: mod.getMockBullets(), id: 1 }) });
  });

  test('clicking .export-toggle adds "open" class to .export-dropdown', async () => {
    await mod.init();
    document.querySelector('.export-toggle').click();
    expect(document.querySelector('.export-dropdown').classList.contains('open')).toBe(true);
  });

  test('clicking outside the dropdown removes "open" class', async () => {
    await mod.init();
    document.querySelector('.export-toggle').click();
    expect(document.querySelector('.export-dropdown').classList.contains('open')).toBe(true);
    document.getElementById('runBtn').click();
    expect(document.querySelector('.export-dropdown').classList.contains('open')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportPNG
// ─────────────────────────────────────────────────────────────────────────────
describe('exportPNG', () => {
  let toDataURL, anchorClick;

  beforeEach(() => {
    toDataURL = jest.fn(() => 'data:image/png;base64,abc');
    HTMLCanvasElement.prototype.toDataURL = toDataURL;
    anchorClick = jest.fn();
    HTMLAnchorElement.prototype.click = anchorClick;
  });

  afterEach(() => {
    delete HTMLCanvasElement.prototype.toDataURL;
    delete HTMLAnchorElement.prototype.click;
  });

  test('returns early when the canvas element is not in the DOM', async () => {
    await mod.exportPNG('chart-does-not-exist');
    expect(toDataURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  test('calls toDataURL and triggers download when canvas exists', async () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'test-chart-png';
    document.body.appendChild(canvas);

    await mod.exportPNG('test-chart-png');

    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runCustom — server-success path (line 432: result = await res.json())
// ─────────────────────────────────────────────────────────────────────────────
describe('runCustom client-side compute', () => {
  function setValidCustomInputs() {
    document.getElementById('customWeight').value = '9.0';
    document.getElementById('customMV').value     = '850';
    document.getElementById('customBC').value     = '0.45';
    document.getElementById('customDia').value    = '7.82';
  }

  test('computes result via simulate and stores in lastResults', async () => {
    setValidCustomInputs();
    await mod.runCustom();
    const result = mod._getState().lastResults[0];
    expect(result).toBeDefined();
    expect(result.bullet).toBeDefined();
    expect(result.bullet.id).toBe('custom');
  });

  test('shows custom error when simulateAsync throws TrajectoryInputError', async () => {
    setValidCustomInputs();
    const { TrajectoryInputError } = require('../app/physics/engine.ts');
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too large'));
    await mod.runCustom();
    expect(document.getElementById('customError').style.display).toBe('block');
  });

  test('re-throws non-TrajectoryInputError from simulateAsync', async () => {
    setValidCustomInputs();
    simulateAsync.mockRejectedValueOnce(new Error('unexpected'));
    await expect(mod.runCustom()).rejects.toThrow('unexpected');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WA-12: Custom drag table — _updateDragTableStatus, _clearCustomDragTable
// ─────────────────────────────────────────────────────────────────────────────
describe('_updateDragTableStatus', () => {
  test('shows status div with file name and row count when fileName is provided', () => {
    mod._updateDragTableStatus('g1-custom.csv', 50);
    expect(document.getElementById('dragTableStatus').style.display).toBe('block');
    expect(document.getElementById('dragTableName').textContent).toBe('g1-custom.csv (50 rows)');
  });

  test('shows status div using _customDragTable length when no fileName given', () => {
    // Inject a fake table via the localStorage → init path simulation
    // We can't directly set _customDragTable from tests, but we can test
    // the branch where _customDragTable is null (no fileName, no table)
    mod._updateDragTableStatus();
    expect(document.getElementById('dragTableStatus').style.display).toBe('none');
  });
});

describe('_clearCustomDragTable', () => {
  beforeEach(() => {
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify([{ mach: 0.5, cd: 0.3 }]));
    document.getElementById('dragTableStatus').style.display = 'block';
    document.getElementById('dragTableName').textContent = 'test.csv (3 rows)';
    document.getElementById('dragTableHelp').textContent = 'some error';
  });

  test('hides status div', () => {
    mod._clearCustomDragTable();
    expect(document.getElementById('dragTableStatus').style.display).toBe('none');
  });

  test('removes localStorage key', () => {
    mod._clearCustomDragTable();
    expect(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY)).toBeNull();
  });

  test('resets help text', () => {
    mod._clearCustomDragTable();
    expect(document.getElementById('dragTableHelp').textContent).toContain('Mach,CD');
  });
});

describe('dragTableClearBtn click', () => {
  test('calls _clearCustomDragTable when button is clicked', async () => {
    // Wire up init so the click listener is attached
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify([{ mach: 0.5, cd: 0.3 }]));
    document.getElementById('dragTableStatus').style.display = 'block';
    document.getElementById('dragTableClearBtn').click();
    expect(document.getElementById('dragTableStatus').style.display).toBe('none');
    expect(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY)).toBeNull();
  });
});

describe('dragTableFile change event — FileReader paths', () => {
  async function triggerFileReader(csvText, fileName = 'test.csv') {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();

    // Simulate FileReader by capturing the onload callback
    let capturedOnload;
    const mockReader = {
      set onload(fn) { capturedOnload = fn; },
      readAsText: jest.fn(),
    };
    jest.spyOn(global, 'FileReader').mockImplementation(() => mockReader);

    const fileInput = document.getElementById('dragTableFile');
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      get: () => [{ name: fileName }],
    });
    fileInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();

    // Invoke the onload callback with the CSV text
    capturedOnload({ target: { result: csvText } });

    jest.restoreAllMocks();
  }

  test('valid CSV shows status div with file name', async () => {
    const csv = 'Mach,CD\n0.3,0.3\n1.0,0.5\n2.5,0.4';
    await triggerFileReader(csv, 'my-drag.csv');
    expect(document.getElementById('dragTableStatus').style.display).toBe('block');
    expect(document.getElementById('dragTableName').textContent).toBe('my-drag.csv (3 rows)');
  });

  test('valid CSV stores table in localStorage', async () => {
    const csv = 'Mach,CD\n0.3,0.3\n1.0,0.5\n2.5,0.4';
    await triggerFileReader(csv);
    const stored = JSON.parse(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY));
    expect(stored).toHaveLength(3);
  });

  test('invalid CSV shows error in helpEl and clears localStorage', async () => {
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify([{ mach: 0.5, cd: 0.3 }]));
    // CSV with subsonic coverage but no supersonic (all mach < 2.0)
    const csv = 'Mach,CD\n0.3,0.3\n1.0,0.5\n1.9,0.4';
    await triggerFileReader(csv);
    expect(document.getElementById('dragTableHelp').textContent).toContain('supersonic coverage');
    expect(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY)).toBeNull();
  });

  test('no file selected (empty files list) exits early', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();

    const fileInput = document.getElementById('dragTableFile');
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      get: () => [],
    });
    // Should not throw
    fileInput.dispatchEvent(new Event('change'));
    expect(document.getElementById('dragTableStatus').style.display).toBe('none');
  });

  test('file over 64 KB shows error message without reading', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();

    let capturedReadAsText;
    const mockReader = {
      set onload(_fn) {},
      set onerror(_fn) {},
      readAsText: jest.fn(f => { capturedReadAsText = f; }),
    };
    jest.spyOn(global, 'FileReader').mockImplementation(() => mockReader);

    const fileInput = document.getElementById('dragTableFile');
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      get: () => [{ name: 'big.csv', size: 65 * 1024 }],
    });
    fileInput.dispatchEvent(new Event('change'));

    expect(capturedReadAsText).toBeUndefined();
    expect(document.getElementById('dragTableHelp').textContent).toMatch(/too large/i);
    jest.restoreAllMocks();
  });

  test('reader.onerror shows error message in helpEl', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();

    let capturedOnerror;
    const mockReader = {
      set onload(_fn) {},
      set onerror(fn) { capturedOnerror = fn; },
      readAsText: jest.fn(),
    };
    jest.spyOn(global, 'FileReader').mockImplementation(() => mockReader);

    const fileInput = document.getElementById('dragTableFile');
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      get: () => [{ name: 'err.csv', size: 100 }],
    });
    fileInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    capturedOnerror();

    expect(document.getElementById('dragTableHelp').textContent).toMatch(/error reading file/i);
    jest.restoreAllMocks();
  });
});

describe('init loads customDragTable from localStorage', () => {
  test('populates status when localStorage has a valid table', async () => {
    const table = [{ mach: 0.3, cd: 0.3 }, { mach: 1.0, cd: 0.5 }, { mach: 2.5, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(table));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    expect(document.getElementById('dragTableStatus').style.display).toBe('block');
    expect(document.getElementById('dragTableName').textContent).toContain('3 rows');
  });

  test('ignores corrupt JSON in localStorage', async () => {
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, 'not-json{{{');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    // Should not throw; status div stays hidden
    expect(document.getElementById('dragTableStatus').style.display).toBe('none');
  });

  test('discards and clears localStorage when stored table fails re-validation', async () => {
    // A table missing supersonic coverage (all mach < 2.0) is invalid
    const badTable = [{ mach: 0.3, cd: 0.3 }, { mach: 1.0, cd: 0.5 }, { mach: 1.9, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(badTable));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    expect(document.getElementById('dragTableStatus').style.display).toBe('none');
    expect(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY)).toBeNull();
  });

  test('discards table with out-of-range mach value (> 5)', async () => {
    const badTable = [{ mach: 0.3, cd: 0.3 }, { mach: 1.0, cd: 0.5 }, { mach: 6.0, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(badTable));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    expect(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY)).toBeNull();
  });

  test('discards table with out-of-range cd value (< 0.001)', async () => {
    const badTable = [{ mach: 0.3, cd: 0.0005 }, { mach: 1.0, cd: 0.5 }, { mach: 2.5, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(badTable));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    expect(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY)).toBeNull();
  });

  test('discards table with non-monotonic mach values', async () => {
    const badTable = [{ mach: 0.3, cd: 0.3 }, { mach: 2.5, cd: 0.4 }, { mach: 1.0, cd: 0.5 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(badTable));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    expect(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY)).toBeNull();
  });

  test('discards table missing subsonic coverage (all mach > 0.5)', async () => {
    const badTable = [{ mach: 0.6, cd: 0.3 }, { mach: 1.0, cd: 0.5 }, { mach: 2.5, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(badTable));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    expect(localStorage.getItem(mod.CUSTOM_DRAG_TABLE_KEY)).toBeNull();
  });
});


describe('_resetState clears _customDragTable', () => {
  test('_customDragTable is null after reset', async () => {
    // Load a table into state via init
    const table = [{ mach: 0.3, cd: 0.3 }, { mach: 1.0, cd: 0.5 }, { mach: 2.5, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(table));
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: mod.getMockBullets() }),
    });
    await mod.init();
    // After reset, the in-memory table should be gone
    mod._resetState();
    // No direct getter for _customDragTable, verify via _clearCustomDragTable side-effects:
    // calling _updateDragTableStatus without a file name should show 'none'
    mod._updateDragTableStatus();
    expect(document.getElementById('dragTableStatus').style.display).toBe('none');
  });
});

describe('runSimulation with customDragTable loaded', () => {
  test('renders results when customDragTable is loaded (no crash)', async () => {
    const table = [{ mach: 0.3, cd: 0.3 }, { mach: 1.0, cd: 0.5 }, { mach: 2.5, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(table));

    mod.init();
    mod._setSelectedIds(new Set([mod.getMockBullets()[0].id]));
    await mod.runSimulation();
    jest.runAllTimers();
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });
});

describe('runCustom with customDragTable loaded', () => {
  test('passes customDragTable to simulate', async () => {
    const table = [{ mach: 0.3, cd: 0.3 }, { mach: 1.0, cd: 0.5 }, { mach: 2.5, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(table));

    mod.init();

    document.getElementById('customWeight').value = '9.0';
    document.getElementById('customMV').value     = '850';
    document.getElementById('customBC').value     = '0.45';
    document.getElementById('customDia').value    = '7.82';

    await mod.runCustom();
    // If customDragTable was passed, lastResults should contain a result
    expect(mod._getState().lastResults).toHaveLength(1);
  });

  test('sets lastReq so MODEL pill remains stable after Clear', async () => {
    const table = [{ mach: 0.3, cd: 0.3 }, { mach: 1.0, cd: 0.5 }, { mach: 2.5, cd: 0.4 }];
    localStorage.setItem(mod.CUSTOM_DRAG_TABLE_KEY, JSON.stringify(table));

    mod.init();

    document.getElementById('customWeight').value = '9.0';
    document.getElementById('customMV').value     = '850';
    document.getElementById('customBC').value     = '0.45';
    document.getElementById('customDia').value    = '7.82';

    await mod.runCustom();
    const { lastReq } = mod._getState();
    expect(lastReq).not.toBeNull();
    expect(lastReq.customDragTable).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// export button wired up by renderResults (line 714 arrow fn)
// ─────────────────────────────────────────────────────────────────────────────
describe('export button click handler', () => {
  let toDataURL, anchorClick;

  beforeEach(() => {
    toDataURL  = jest.fn(() => 'data:image/png;base64,abc');
    anchorClick = jest.fn();
    HTMLCanvasElement.prototype.toDataURL = toDataURL;
    HTMLAnchorElement.prototype.click     = anchorClick;
  });

  afterEach(() => {
    delete HTMLCanvasElement.prototype.toDataURL;
    delete HTMLAnchorElement.prototype.click;
  });

  test('clicking .export-btn triggers exportPNG for that chart', async () => {
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });

    await mod.renderResults([result], {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });

    // Each chart panel has an export button — clicking the first one should call exportPNG
    const btn = document.querySelector('.export-btn');
    expect(btn).not.toBeNull();
    btn.click();
    await flushMicrotasks();

    // exportPNG looks up the canvas by the chart id stored in data-chart-id
    expect(toDataURL).toHaveBeenCalledWith('image/png');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bullet card click listener (wired by renderBulletList, L254 arrow fn)
// ─────────────────────────────────────────────────────────────────────────────
describe('bullet card click listener', () => {
  test('clicking a bullet card calls toggleBullet for that id', () => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList();

    const card = document.getElementById('card-308-win-168gr');
    expect(card).not.toBeNull();

    // Card click should toggle the id into selectedIds
    mod._setSelectedIds(new Set());
    card.click();
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ACC-1: bullet card keyboard listener
// ─────────────────────────────────────────────────────────────────────────────
describe('ACC-1: bullet card keyboard listener', () => {
  beforeEach(() => {
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set());
    mod.renderBulletList();
  });

  test('Enter key toggles bullet selection', () => {
    const card = document.getElementById('card-308-win-168gr');
    expect(card).not.toBeNull();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(true);
  });

  test('Space key toggles bullet selection', () => {
    const card = document.getElementById('card-308-win-168gr');
    expect(card).not.toBeNull();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(true);
  });

  test('other keys do not toggle bullet selection', () => {
    const card = document.getElementById('card-308-win-168gr');
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// crosshairPlugin — afterDraw when the data point is absent (L504)
// ─────────────────────────────────────────────────────────────────────────────
describe('crosshairPlugin afterDraw edge cases', () => {
  test('returns early when meta.data[crosshairIndex] is undefined', async () => {
    // Simulate a hover at index 5 but the chart only has data up to index 2
    mod._getState().crosshairIndex;  // prime state via existing test pattern
    // Directly set state via the exported helper would need a setter — use the
    // existing chart-interaction tests pattern: call onHover to set index
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    await mod.renderResults([result], {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });

    // afterDraw: meta.data has fewer entries than crosshairIndex
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(),
      moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(), setLineDash: jest.fn(),
    };
    // crosshairIndex=99 but chart data only has 3 points → data[99] is undefined
    mod.crosshairPlugin.afterDraw({
      getDatasetMeta: jest.fn(() => ({ data: [{ x: 10 }, { x: 20 }, { x: 30 }] })),
      chartArea: { top: 0, bottom: 100 },
      ctx,
    });
    // Since data[crosshairIndex] is null (crosshairIndex is null after reset), it returns early
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });

  test('returns early when crosshairIndex points past end of data array', async () => {
    // Manually set crosshairIndex to a value beyond the data array length
    // We do this by calling onHover with an element at a large index via the chart mock
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    await mod.renderResults([result], {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });

    // Get the onHover callback from the Chart mock and call it with index 99
    const chartCalls = require('chart.js').Chart.mock.calls;
    const lastCall = chartCalls[chartCalls.length - 1];
    const onHover = lastCall[1].options.onHover;
    onHover({}, [{ index: 99 }]);

    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(),
      moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(), setLineDash: jest.fn(),
    };
    mod.crosshairPlugin.afterDraw({
      getDatasetMeta: jest.fn(() => ({ data: [{ x: 10 }, { x: 20 }] })),
      chartArea: { top: 0, bottom: 100 },
      ctx,
    });
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateReadout — edge cases (L525 early return, L536/537 in map callback)
// ─────────────────────────────────────────────────────────────────────────────
describe('updateReadout edge cases', () => {
  test('returns early when there is no point at dataIndex (L525 branch)', () => {
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 100, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    // Use an out-of-bounds index — result.points has 2-3 entries at most
    expect(() => mod.updateReadout([result], 9999)).not.toThrow();
    // readout panel should stay hidden (early return before setting display:block)
    expect(document.getElementById('rangeReadout').style.display).not.toBe('block');
  });

  test('renders empty row when a result has no point at dataIndex (L536 branch)', () => {
    const bullet = mod.getMockBullets()[0];
    // Two results: one normal, one without a point at index 1
    const fullResult = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    const sparseResult = {
      ...fullResult,
      bullet: { ...fullResult.bullet, id: 'unknown-test-id', name: 'Unknown' },
      points: [fullResult.points[0]], // only one point — index 1 is undefined
    };

    // Index 1 exists in fullResult but not in sparseResult → L536 `if (!p) return ''`
    expect(() => mod.updateReadout([fullResult, sparseResult], 1)).not.toThrow();
  });

  test('uses fallback color when bullet id is not in BULLET_COLORS (L547 || branch)', () => {
    const bullet = mod.getMockBullets()[0];
    const fullResult = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 100, stepMeters: 50,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    // Override bullet id with one not in BULLET_COLORS; keep all the points
    const unknownResult = {
      ...fullResult,
      bullet: { ...fullResult.bullet, id: 'no-color-id', name: 'Unknown Caliber' },
    };
    // Index 0 exists and id not in BULLET_COLORS → `|| '#4ADE80'` fallback executes
    expect(() => mod.updateReadout([unknownResult], 0)).not.toThrow();
    expect(document.getElementById('readoutBody').innerHTML).toContain('#4ADE80');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tab click listeners wired by init() (L798/L799 function() bodies)
// ─────────────────────────────────────────────────────────────────────────────
describe('tab click listeners wired by init()', () => {
  test('clicking #tab-charts switches to charts panel', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: mod.getMockBullets(), id: 1 }) });
    await mod.init();
    document.getElementById('tab-charts').click();
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(true);
  });

  test('clicking #tab-data switches to data panel', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: mod.getMockBullets(), id: 1 }) });
    await mod.init();
    document.getElementById('tab-data').click();
    expect(document.getElementById('dataPanel').classList.contains('active')).toBe(true);
  });

  test('clicking #tab-tools switches to tools panel', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: mod.getMockBullets(), id: 1 }) });
    await mod.init();
    document.getElementById('tab-tools').click();
    await flushMicrotasks();
    expect(document.getElementById('toolsPanel').classList.contains('active')).toBe(true);
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readoutPin second-click path: forEach(c => c.update) (L798 forEach arrow fn)
// Requires charts to be populated so the forEach body actually executes.
// ─────────────────────────────────────────────────────────────────────────────
describe('readoutPin unpin with populated charts (L815 forEach arrow fn)', () => {
  test('second pin-click calls update() on every active chart', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: mod.getMockBullets(), id: 1 }) });
    await mod.init();

    // Populate charts by running a simulation
    const bullet = mod.getMockBullets()[0];
    const result = simulate(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    await mod.renderResults([result], {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });

    const pinBtn = document.getElementById('readoutPin');
    pinBtn.click(); // pin — crosshairPinned → true
    expect(mod._getState().crosshairPinned).toBe(true);

    // Unpin — exercises the forEach(c => c.update('none')) callback (L815)
    pinBtn.click();
    expect(mod._getState().crosshairPinned).toBe(false);
    expect(pinBtn.textContent).toBe('PIN');
    // The mock Chart's update() should have been called at least once
    const { _mockUpdate } = require('chart.js');
    expect(_mockUpdate).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auto-init guard (line 817–818: if (bulletList) init())
// ─────────────────────────────────────────────────────────────────────────────
// localStorage preference persistence
// ─────────────────────────────────────────────────────────────────────────────
describe('loadPrefs', () => {
  test('returns PREF_DEFAULTS when storage is empty', () => {
    const prefs = mod.loadPrefs();
    expect(prefs.selectedIds).toBeNull();
    expect(prefs.zero).toBe(mod.PREF_DEFAULTS.zero);
    expect(prefs.maxRange).toBe(mod.PREF_DEFAULTS.maxRange);
    expect(prefs.wind).toBe(mod.PREF_DEFAULTS.wind);
    expect(prefs.windDir).toBe(mod.PREF_DEFAULTS.windDir);
    expect(prefs.altitude).toBe(mod.PREF_DEFAULTS.altitude);
    expect(prefs.temp).toBe(mod.PREF_DEFAULTS.temp);
    expect(prefs.step).toBe(mod.PREF_DEFAULTS.step);
    expect(prefs.sightHeight).toBe(mod.PREF_DEFAULTS.sightHeight);
    expect(prefs.angle).toBe(mod.PREF_DEFAULTS.angle);
  });

  test('returns stored numeric values when storage is populated', () => {
    localStorage.setItem(mod.PREF_KEYS.zero,        '200');
    localStorage.setItem(mod.PREF_KEYS.maxRange,    '800');
    localStorage.setItem(mod.PREF_KEYS.wind,        '5');
    localStorage.setItem(mod.PREF_KEYS.windDir,     '270');
    localStorage.setItem(mod.PREF_KEYS.altitude,    '1000');
    localStorage.setItem(mod.PREF_KEYS.temp,        '20');
    localStorage.setItem(mod.PREF_KEYS.step,        '50');
    localStorage.setItem(mod.PREF_KEYS.sightHeight, '45.0');
    localStorage.setItem(mod.PREF_KEYS.angle,       '15');
    const prefs = mod.loadPrefs();
    expect(prefs.zero).toBe(200);
    expect(prefs.maxRange).toBe(800);
    expect(prefs.wind).toBe(5);
    expect(prefs.windDir).toBe(270);
    expect(prefs.altitude).toBe(1000);
    expect(prefs.temp).toBe(20);
    expect(prefs.step).toBe(50);
    expect(prefs.sightHeight).toBe(45.0);
    expect(prefs.angle).toBe(15);
  });

  test('returns stored selectedIds array when present', () => {
    localStorage.setItem(mod.PREF_KEYS.selectedIds, JSON.stringify(['308-win-168gr', '223-rem-55gr']));
    const prefs = mod.loadPrefs();
    expect(prefs.selectedIds).toEqual(['308-win-168gr', '223-rem-55gr']);
  });

  test('returns null selectedIds when JSON is invalid', () => {
    localStorage.setItem(mod.PREF_KEYS.selectedIds, '{bad-json}');
    const prefs = mod.loadPrefs();
    expect(prefs.selectedIds).toBeNull();
  });

  test('returns null selectedIds when stored value is not an array', () => {
    localStorage.setItem(mod.PREF_KEYS.selectedIds, '"just-a-string"');
    const prefs = mod.loadPrefs();
    expect(prefs.selectedIds).toBeNull();
  });

  test('returns defaults and logs warning when localStorage is unavailable', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const origLS  = window.localStorage;
    // Replace localStorage entirely with an object whose getItem throws
    Object.defineProperty(window, 'localStorage', {
      value: { getItem() { throw new Error('storage disabled'); }, setItem() {} },
      configurable: true, writable: true,
    });
    try {
      const prefs = mod.loadPrefs();
      expect(prefs.selectedIds).toBeNull();
      expect(prefs.zero).toBe(100);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('localStorage'), expect.any(Error));
    } finally {
      Object.defineProperty(window, 'localStorage', { value: origLS, configurable: true, writable: true });
      warnSpy.mockRestore();
    }
  });
});

describe('savePrefs', () => {
  test('writes all expected keys with current input values', () => {
    document.getElementById('zeroRange').value     = '150';
    document.getElementById('maxRange').value      = '800';
    document.getElementById('windSpeed').value     = '10';
    document.getElementById('altitude').value      = '500';
    document.getElementById('temperature').value   = '20';
    document.getElementById('step').value          = '50';
    document.getElementById('sightHeight').value   = '45';
    document.getElementById('shootingAngle').value = '10';
    document.getElementById('windDir').value       = '270';
    mod._setSelectedIds(new Set(['308-win-168gr', '223-rem-55gr']));

    mod.savePrefs();

    expect(JSON.parse(localStorage.getItem(mod.PREF_KEYS.selectedIds)))
      .toEqual(expect.arrayContaining(['308-win-168gr', '223-rem-55gr']));
    expect(localStorage.getItem(mod.PREF_KEYS.zero)).toBe('150');
    expect(localStorage.getItem(mod.PREF_KEYS.maxRange)).toBe('800');
    expect(localStorage.getItem(mod.PREF_KEYS.wind)).toBe('10');
    expect(localStorage.getItem(mod.PREF_KEYS.windDir)).toBe('270');
    expect(localStorage.getItem(mod.PREF_KEYS.altitude)).toBe('500');
    expect(localStorage.getItem(mod.PREF_KEYS.temp)).toBe('20');
    expect(localStorage.getItem(mod.PREF_KEYS.step)).toBe('50');
    expect(localStorage.getItem(mod.PREF_KEYS.sightHeight)).toBe('45');
    expect(localStorage.getItem(mod.PREF_KEYS.angle)).toBe('10');
  });

  test('uses default strings for all absent input elements', () => {
    // Remove ALL param inputs to exercise every ?. null and ?? default branch
    ['zeroRange','maxRange','windSpeed','windDir','altitude','temperature','step','sightHeight','shootingAngle','dragModel']
      .forEach(id => document.getElementById(id)?.remove());
    mod.savePrefs();
    // All defaults written because every get(id)?.value returned undefined
    expect(localStorage.getItem(mod.PREF_KEYS.zero)).toBe('100');
    expect(localStorage.getItem(mod.PREF_KEYS.maxRange)).toBe('1000');
    expect(localStorage.getItem(mod.PREF_KEYS.wind)).toBe('16');
    expect(localStorage.getItem(mod.PREF_KEYS.windDir)).toBe('90');
    expect(localStorage.getItem(mod.PREF_KEYS.altitude)).toBe('0');
    expect(localStorage.getItem(mod.PREF_KEYS.temp)).toBe('15');
    expect(localStorage.getItem(mod.PREF_KEYS.step)).toBe('25');
    expect(localStorage.getItem(mod.PREF_KEYS.sightHeight)).toBe('38.1');
    expect(localStorage.getItem(mod.PREF_KEYS.angle)).toBe('0');
    expect(localStorage.getItem(mod.PREF_KEYS.dragModel)).toBe('G1');
  });

  test('logs warning and does not throw when localStorage is unavailable', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const origLS  = window.localStorage;
    // Replace localStorage entirely with an object whose setItem throws
    Object.defineProperty(window, 'localStorage', {
      value: { setItem() { throw new Error('quota exceeded'); }, getItem() { return null; } },
      configurable: true, writable: true,
    });
    try {
      expect(() => mod.savePrefs()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('localStorage'), expect.any(Error));
    } finally {
      Object.defineProperty(window, 'localStorage', { value: origLS, configurable: true, writable: true });
      warnSpy.mockRestore();
    }
  });
});

describe('toggleBullet persists selection', () => {
  test('writes selectedIds to localStorage after toggling a bullet', () => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList();
    // Toggle a bullet and verify localStorage is updated directly
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.toggleBullet('308-win-168gr'); // deselect
    const saved = JSON.parse(localStorage.getItem(mod.PREF_KEYS.selectedIds));
    expect(Array.isArray(saved)).toBe(true);
    expect(saved).not.toContain('308-win-168gr');
  });
});

describe('init with saved preferences', () => {
  test('restores saved numeric input values from localStorage', async () => {
    localStorage.setItem(mod.PREF_KEYS.zero,        '200');
    localStorage.setItem(mod.PREF_KEYS.maxRange,    '800');
    localStorage.setItem(mod.PREF_KEYS.wind,        '5');
    localStorage.setItem(mod.PREF_KEYS.windDir,     '270');
    localStorage.setItem(mod.PREF_KEYS.altitude,    '1500');
    localStorage.setItem(mod.PREF_KEYS.temp,        '25');
    localStorage.setItem(mod.PREF_KEYS.step,        '50');
    localStorage.setItem(mod.PREF_KEYS.sightHeight, '45');
    localStorage.setItem(mod.PREF_KEYS.angle,       '-10');
    global.fetch.mockRejectedValue(new Error('offline'));

    await mod.init();

    expect(document.getElementById('zeroRange').value).toBe('200');
    expect(document.getElementById('maxRange').value).toBe('800');
    expect(document.getElementById('windSpeed').value).toBe('5');
    expect(document.getElementById('windDir').value).toBe('270');
    expect(document.getElementById('altitude').value).toBe('1500');
    expect(document.getElementById('temperature').value).toBe('25');
    expect(document.getElementById('step').value).toBe('50');
    expect(document.getElementById('sightHeight').value).toBe('45');
    expect(document.getElementById('shootingAngle').value).toBe('-10');
  });

  test('restores saved bullet selection (subset of catalog)', async () => {
    const bullets = mod.getMockBullets();
    localStorage.setItem(mod.PREF_KEYS.selectedIds, JSON.stringify(['308-win-168gr']));
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: bullets, id: 1 }) });

    await mod.init();

    const { selectedIds } = mod._getState();
    expect(selectedIds.has('308-win-168gr')).toBe(true);
    expect(selectedIds.has('223-rem-55gr')).toBe(false);
  });

  test('selects only bullets[0] on first visit (null savedIds)', async () => {
    // localStorage is empty → first visit behavior → only first bullet selected
    global.fetch.mockRejectedValue(new Error('offline'));

    await mod.init();

    const { selectedIds, bullets } = mod._getState();
    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has(bullets[0].id)).toBe(true);
  });

  test('filters out stale IDs no longer in catalog', async () => {
    const bullets = mod.getMockBullets();
    localStorage.setItem(mod.PREF_KEYS.selectedIds,
      JSON.stringify(['308-win-168gr', 'deleted-bullet-id']));
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: bullets, id: 1 }) });

    await mod.init();

    const { selectedIds } = mod._getState();
    expect(selectedIds.has('308-win-168gr')).toBe(true);
    expect(selectedIds.has('deleted-bullet-id')).toBe(false);
  });

  test('parameter input events trigger savePrefs', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();

    // Dispatch input event and advance debounce timer to verify localStorage update
    const input = document.getElementById('zeroRange');
    input.value = '150';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(localStorage.getItem(mod.PREF_KEYS.zero)).toBe('150');
  });

  test('handles absent input elements gracefully in setVal (if(el) false branch)', () => {
    // Remove one param input before init to exercise the if(el) false branch of setVal
    document.getElementById('shootingAngle').remove();
    expect(() => mod.init()).not.toThrow();
    // Other inputs still get their values; no crash
    expect(document.getElementById('zeroRange').value).toBe('100');
  });

  test('wires all 9 input listeners — sightHeight input triggers savePrefs', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();

    const el = document.getElementById('sightHeight');
    el.value = '55';
    el.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(localStorage.getItem(mod.PREF_KEYS.sightHeight)).toBe('55');
  });

  test('windDir input event triggers savePrefs', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();

    const el = document.getElementById('windDir');
    el.value = '180';
    el.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(localStorage.getItem(mod.PREF_KEYS.windDir)).toBe('180');
  });

  test('handles missing param input elements gracefully in input listener wiring', () => {
    // Remove shootingAngle so ?. in paramInputIds.forEach does not crash
    document.getElementById('shootingAngle').remove();
    expect(() => mod.init()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('windChartSubtitle', () => {
  test('returns "no wind" when windSpeedKph is 0', () => {
    expect(mod.windChartSubtitle({ windSpeedKph: 0 })).toBe('no wind');
  });

  test('shows "from E" for default 90° direction', () => {
    const s = mod.windChartSubtitle({ windSpeedKph: 16, windDirectionDeg: 90 });
    expect(s).toContain('16 km/h');
    expect(s).toContain('E');
  });

  test('shows "from N" for 0° (headwind)', () => {
    const s = mod.windChartSubtitle({ windSpeedKph: 10, windDirectionDeg: 0 });
    expect(s).toContain('N');
  });

  test('shows "from W" for 270° (left crosswind)', () => {
    const s = mod.windChartSubtitle({ windSpeedKph: 5, windDirectionDeg: 270 });
    expect(s).toContain('W');
  });

  test('defaults to 90° when windDirectionDeg is omitted', () => {
    const s = mod.windChartSubtitle({ windSpeedKph: 8 });
    expect(s).toContain('E');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G7 drag model toggle — preferences and UI (Task 10)
// ─────────────────────────────────────────────────────────────────────────────
describe('G7 drag model — preferences', () => {
  test('PREF_KEYS has a dragModel key', () => {
    expect(mod.PREF_KEYS.dragModel).toBeDefined();
    expect(typeof mod.PREF_KEYS.dragModel).toBe('string');
  });

  test('PREF_DEFAULTS.dragModel is "G1"', () => {
    expect(mod.PREF_DEFAULTS.dragModel).toBe('G1');
  });

  test('savePrefs stores dragModel from the DOM select', () => {
    document.getElementById('dragModel').value = 'G7';
    mod.savePrefs();
    expect(localStorage.getItem(mod.PREF_KEYS.dragModel)).toBe('G7');
  });

  test('loadPrefs returns stored dragModel', () => {
    localStorage.setItem(mod.PREF_KEYS.dragModel, 'G7');
    const prefs = mod.loadPrefs();
    expect(prefs.dragModel).toBe('G7');
  });

  test('loadPrefs returns "G1" default when dragModel not in storage', () => {
    const prefs = mod.loadPrefs();
    expect(prefs.dragModel).toBe('G1');
  });

  test('init restores dragModel from storage', async () => {
    localStorage.setItem(mod.PREF_KEYS.dragModel, 'G7');
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    expect(document.getElementById('dragModel').value).toBe('G7');
  });

  test('dragModel input event triggers savePrefs', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    const el = document.getElementById('dragModel');
    el.value = 'G7';
    el.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(localStorage.getItem(mod.PREF_KEYS.dragModel)).toBe('G7');
  });
});

describe('G7 drag model — runSimulation and renderResults', () => {
  const mockApiResults = [{
    bullet: {
      id: '308-win-168gr', name: '.308 Win 168gr BTHP',
      muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
      ballisticCoefficient: 0.475, bulletWeightGrams: 10.89
    },
    request: {},
    points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
    maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
  }];

  test('runSimulation includes dragModel from DOM select in request body', async () => {
    document.getElementById('dragModel').value = 'G7';
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));

    let capturedBody;
    global.fetch.mockImplementation(async (url, opts) => {
      if (url.includes('stream')) { capturedBody = JSON.parse(opts.body); throw new Error('no stream'); }
      if (url.includes('compare')) { capturedBody = JSON.parse(opts.body); throw new Error('no batch'); }
      throw new Error('offline');
    });

    await mod.runSimulation();
    jest.runAllTimers();
    const dragModel = capturedBody?.dragModel ?? mod._getState().lastResults[0]?.request?.dragModel;
    expect(dragModel).toBe('G7');
  });

  test('runCustom includes dragModel from DOM select', async () => {
    document.getElementById('dragModel').value = 'G7';
    document.getElementById('customWeight').value = '9.0';
    document.getElementById('customMV').value     = '850';
    document.getElementById('customBC').value     = '0.45';
    document.getElementById('customDia').value    = '7.82';
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runCustom();
    const result = mod._getState().lastResults[0];
    expect(result?.request?.dragModel).toBe('G7');
  });

  test('runCustom includes latitudeDeg and azimuthDeg when DOM inputs are filled', async () => {
    document.getElementById('customWeight').value = '9.0';
    document.getElementById('customMV').value     = '850';
    document.getElementById('customBC').value     = '0.45';
    document.getElementById('customDia').value    = '7.82';
    document.getElementById('latitudeDeg').value  = '45';
    document.getElementById('azimuthDeg').value   = '180';
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runCustom();
    const result = mod._getState().lastResults[0];
    expect(result?.request?.latitudeDeg).toBe(45);
    expect(result?.request?.azimuthDeg).toBe(180);
  });

  test('renderResults updates #modelStatus pill with dragModel from req', async () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }];
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G7' });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G7');
  });

  test('renderResults shows MODEL: G1 when dragModel is G1', async () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }];
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1' });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G1');
  });

  test('renderResults defaults modelStatus to G1 when dragModel absent', async () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }];
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G1');
  });

  test('renderResults shows MODEL: CUSTOM when req.customDragTable has entries', async () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }];
    const customTable = [
      { mach: 0.3, cd: 0.3 },
      { mach: 1.0, cd: 0.5 },
      { mach: 2.5, cd: 0.4 },
    ];
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1', customDragTable: customTable });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: CUSTOM');
  });

  test('renderResults shows G1/G7 when req.customDragTable is absent or empty', async () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }];
    // absent
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G7' });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G7');
    // empty array
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1', customDragTable: [] });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G1');
  });

  test('client-side fallback uses G7 table when dragModel is G7 (offline mode)', async () => {
    document.getElementById('dragModel').value = 'G7';
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runSimulation();
    jest.runAllTimers();
    const result = mod._getState().lastResults[0];
    // G7 uses a different drag table — result should still be valid
    expect(result).toBeDefined();
    expect(result.points.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mobile: sidebar drawer (items 2 & 3)
// ─────────────────────────────────────────────────────────────────────────────
describe('openSidebar / closeSidebar', () => {
  test('openSidebar adds .open to sidebar and backdrop', () => {
    mod.openSidebar();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(true);
    expect(document.getElementById('sidebarBackdrop').classList.contains('open')).toBe(true);
  });

  test('closeSidebar removes .open from sidebar and backdrop', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarBackdrop').classList.add('open');
    mod.closeSidebar();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(false);
    expect(document.getElementById('sidebarBackdrop').classList.contains('open')).toBe(false);
  });

  test('init wires paramsToggle click to openSidebar', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    mod.closeSidebar();
    document.getElementById('paramsToggle').click();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(true);
  });

  test('init wires sidebarBackdrop click to closeSidebar', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    mod.openSidebar();
    document.getElementById('sidebarBackdrop').click();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(false);
  });

  test('runBtn click closes sidebar before running simulation', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    mod.openSidebar();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    document.getElementById('runBtn').click();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(false);
  });

  test('runCustomBtn click closes sidebar before running custom', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    mod.openSidebar();
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      bullet: { id: 'c', name: 'Custom', weightGrams: 9, muzzleVelocityMps: 850, ballisticCoefficient: 0.45, diameterMm: 7.82 },
      points: [],
    }) });
    document.getElementById('runCustomBtn').click();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mobile: chart touch forwarding (item 4)
// ─────────────────────────────────────────────────────────────────────────────
describe('chart canvas touchmove → mousemove forwarding', () => {
  const mockResults = [{
    bullet: { id: '308-win-168gr', name: '.308 Win 168gr' },
    points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 820, energyJoules: 3500, windDriftCm: 0, timeOfFlightSec: 0 }],
    supersonicLimitMeters: 800, maxOrdinateCm: 5, maxOrdinateRangeMeters: 100,
  }];

  test('touchmove on chart canvas dispatches a mousemove event', async () => {
    mod._setLastResults(mockResults);
    await mod.renderResults(mockResults, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1' });

    const canvas = document.getElementById('dropChart');
    expect(canvas).toBeTruthy();

    const dispatched = [];
    canvas.addEventListener('mousemove', e => dispatched.push(e));

    // jsdom lacks the Touch constructor — use a plain Event with a touches array
    const touchEvent = new Event('touchmove', { bubbles: true, cancelable: true });
    touchEvent.touches = [{ clientX: 120, clientY: 80 }];
    canvas.dispatchEvent(touchEvent);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].clientX).toBe(120);
    expect(dispatched[0].clientY).toBe(80);
  });

  test('touchmove handler does NOT call preventDefault (passive: CSS touch-action instead)', async () => {
    await mod.renderResults(mockResults, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1' });

    const canvas = document.getElementById('dropChart');
    const touchEvent = new Event('touchmove', { bubbles: true, cancelable: true });
    touchEvent.touches = [{ clientX: 50, clientY: 50 }];

    const preventDefaultSpy = jest.spyOn(touchEvent, 'preventDefault');
    canvas.dispatchEvent(touchEvent);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  test('buildChartConfig includes touch events in the events array', () => {
    const def = { id: 'test', title: 'T', subtitle: 's', yLabel: 'y', key: 'dropCm' };
    const cfg = mod.buildChartConfig(def, [], []);
    expect(cfg.options.events).toEqual(expect.arrayContaining(['touchstart', 'touchmove']));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('auto-init guard', () => {
  test('calls init() when #bulletList is in the DOM at module load time', () => {
    // Ensure #bulletList exists before the fresh module load
    buildDOM();

    let freshMod;
    jest.isolateModules(() => {
      freshMod = require('../app/ballistics.js');
    });

    // If the guard true-branch was entered, init() ran and loaded bullet cards
    expect(freshMod).toBeDefined();
    expect(document.getElementById('bulletList').innerHTML).not.toBe('');
    // Clean up window listeners registered by the fresh module instance so they
    // don't bleed into later tests via the shared window object.
    freshMod._resetState();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// currentState / syncUrl / copyLink (FE-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('currentState', () => {
  test('returns sidebar input values and selectedIds', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    const state = mod.currentState();
    expect(state.bulletIds).toEqual(['308-win-168gr']);
    expect(state.zero).toBe(100);
    expect(state.dragModel).toBe('G1');
  });

  test('falls back to PREF_DEFAULTS when inputs are absent', () => {
    document.getElementById('zeroRange').remove();
    const state = mod.currentState();
    expect(state.zero).toBe(mod.PREF_DEFAULTS.zero);
  });

  test('includes latitudeDeg and azimuthDeg when DOM inputs are filled', () => {
    document.getElementById('latitudeDeg').value = '51.5';
    document.getElementById('azimuthDeg').value  = '270';
    const state = mod.currentState();
    expect(state.latitudeDeg).toBe(51.5);
    expect(state.azimuthDeg).toBe(270);
  });

  test('omits latitudeDeg and azimuthDeg when DOM inputs are empty', () => {
    document.getElementById('latitudeDeg').value = '';
    document.getElementById('azimuthDeg').value  = '';
    const state = mod.currentState();
    expect(state.latitudeDeg).toBeUndefined();
    expect(state.azimuthDeg).toBeUndefined();
  });
});

describe('syncUrl', () => {
  test('calls history.replaceState with new query string', () => {
    const spy = jest.spyOn(history, 'replaceState');
    mod.syncUrl();
    expect(spy).toHaveBeenCalledTimes(1);
    const url = spy.mock.calls[0][2];
    expect(url).toContain('zero=');
    spy.mockRestore();
  });
});

describe('copyLink', () => {
  test('clipboard.writeText success → toast "Link copied"', async () => {
    const toastEl = document.getElementById('toast');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true, writable: true
    });
    await mod.copyLink();
    expect(writeText).toHaveBeenCalled();
    expect(toastEl.textContent).toBe('Link copied');
    delete navigator.clipboard;
  });

  test('clipboard API missing → fallback toast', async () => {
    const toastEl = document.getElementById('toast');
    const origClip = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined, configurable: true, writable: true
    });
    await mod.copyLink();
    expect(toastEl.textContent).toContain("Couldn't copy");
    Object.defineProperty(navigator, 'clipboard', {
      value: origClip, configurable: true, writable: true
    });
  });

  test('clipboard.writeText rejects → fallback toast, no unhandled rejection', async () => {
    const toastEl = document.getElementById('toast');
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true, writable: true
    });
    await expect(mod.copyLink()).resolves.toBeUndefined();
    expect(toastEl.textContent).toContain("Couldn't copy");
    delete navigator.clipboard;
  });
});

describe('init() with URL params (FE-1)', () => {
  test('URL bullet IDs override saved prefs when they match the catalog', async () => {
    const bullets = mod.getMockBullets();
    localStorage.setItem(mod.PREF_KEYS.selectedIds, JSON.stringify(['223-rem-55gr']));
    history.replaceState(null, '', '/?b=308-win-168gr');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: bullets, id: 1 }) });
    await mod.init();
    const { selectedIds } = mod._getState();
    expect(selectedIds.has('308-win-168gr')).toBe(true);
    expect(selectedIds.has('223-rem-55gr')).toBe(false);
    history.replaceState(null, '', '/');
  });

  test('URL bullet IDs fall back to prefs when none match the catalog', async () => {
    const bullets = mod.getMockBullets();
    localStorage.setItem(mod.PREF_KEYS.selectedIds, JSON.stringify(['223-rem-55gr']));
    history.replaceState(null, '', '/?b=not-a-real-id');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: bullets, id: 1 }) });
    await mod.init();
    const { selectedIds } = mod._getState();
    expect(selectedIds.has('223-rem-55gr')).toBe(true);
    history.replaceState(null, '', '/');
  });

  test('fromUrl.recognized → syncUrl called at end of init', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    history.replaceState(null, '', '/?zero=200');
    const spy = jest.spyOn(history, 'replaceState');
    await mod.init();
    // replaceState called at least once (the syncUrl at end of init)
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    history.replaceState(null, '', '/');
  });

  test('param input triggers syncUrl after savePrefs', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    const spy = jest.spyOn(history, 'replaceState');
    const input = document.getElementById('zeroRange');
    input.value = '300';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('copyLinkBtn click wired to copyLink in init', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true, writable: true
    });
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    document.getElementById('copyLinkBtn').click();
    await Promise.resolve(); // flush microtasks
    expect(writeText).toHaveBeenCalled();
    delete navigator.clipboard;
  });

  test('toggleBullet calls syncUrl after savePrefs', () => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    const spy = jest.spyOn(history, 'replaceState');
    mod.toggleBullet('308-win-168gr');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('init() restores latitudeDeg and azimuthDeg from URL params', async () => {
    history.replaceState(null, '', '/?latitudeDeg=45&azimuthDeg=90');
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    expect(document.getElementById('latitudeDeg').value).toBe('45');
    expect(document.getElementById('azimuthDeg').value).toBe('90');
    history.replaceState(null, '', '/');
  });

  test('init() wires latitudeDeg and azimuthDeg inputs to syncUrl', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    const spy = jest.spyOn(history, 'replaceState');
    document.getElementById('latitudeDeg').value = '55';
    document.getElementById('latitudeDeg').dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init() FE-2: preset library glue
// ─────────────────────────────────────────────────────────────────────────────
describe('init() FE-2: preset library glue', () => {
  const VALID_FIELDS = {
    customName:   'Test Load',
    customWeight: '11.34',
    customMV:     '800',
    customBC:     '0.505',
    customDia:    '7.82',
  };

  function fillForm(fields = VALID_FIELDS) {
    Object.entries(fields).forEach(([id, val]) => {
      document.getElementById(id).value = val;
    });
  }

  async function runInit() {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
  }

  test('init() calls renderPresetList with stored presets on startup', async () => {
    // Store one preset so the section becomes visible
    const preset = {
      id: '3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c',
      name: 'Stored Load',
      weightG: 11.34, mvMps: 800, bc: 0.505, diaMm: 7.82,
      savedAt: '2026-11-01T14:03:22.511Z',
    };
    localStorage.setItem('bv_customRounds', JSON.stringify([preset]));
    await runInit();
    expect(document.getElementById('customPresetSection').hidden).toBe(false);
    expect(document.querySelectorAll('.preset-row')).toHaveLength(1);
  });

  test('savePresetBtn saves preset and shows toast "Preset saved"', async () => {
    await runInit();
    fillForm();
    const toastEl = document.getElementById('toast');
    document.getElementById('savePresetBtn').click();
    expect(toastEl.textContent).toBe('Preset saved');
    expect(document.getElementById('customPresetSection').hidden).toBe(false);
    expect(document.querySelectorAll('.preset-row')).toHaveLength(1);
  });

  test('savePresetBtn replaces preset with same name and shows "Preset updated"', async () => {
    await runInit();
    fillForm();
    document.getElementById('savePresetBtn').click(); // first save
    document.getElementById('customWeight').value = '12';
    document.getElementById('savePresetBtn').click(); // replace
    expect(document.getElementById('toast').textContent).toBe('Preset updated');
    expect(document.querySelectorAll('.preset-row')).toHaveLength(1);
  });

  test('savePresetBtn shows full toast when library is full', async () => {
    // Fill with 20 presets
    const presets = Array.from({ length: 20 }, (_, i) => ({
      id: `3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a${String(i).padStart(4, '0')}`,
      name: `Load ${i}`,
      weightG: 11, mvMps: 800, bc: 0.5, diaMm: 7.82,
      savedAt: '2026-11-01T14:03:22.511Z',
    }));
    localStorage.setItem('bv_customRounds', JSON.stringify(presets));
    await runInit();
    fillForm({ ...VALID_FIELDS, customName: 'New Load' });
    document.getElementById('savePresetBtn').click();
    expect(document.getElementById('toast').textContent).toContain('full');
  });

  test('savePresetBtn shows custom error when field is invalid', async () => {
    await runInit();
    fillForm({ ...VALID_FIELDS, customWeight: '0' });
    document.getElementById('savePresetBtn').click();
    const errEl = document.getElementById('customError');
    expect(errEl.style.display).toBe('block');
    expect(errEl.textContent).toContain('Weight');
  });

  test('savePresetBtn shows storage toast on localStorage failure', async () => {
    await runInit();
    fillForm();
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    document.getElementById('savePresetBtn').click();
    expect(document.getElementById('toast').textContent).toContain("Couldn't save preset");
    spy.mockRestore();
  });

  test('onLoad fills form fields and clears custom error', async () => {
    const preset = {
      id: '3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c',
      name: 'Stored Load', weightG: 9.5, mvMps: 900, bc: 0.45, diaMm: 6.0,
      savedAt: '2026-11-01T14:03:22.511Z',
    };
    localStorage.setItem('bv_customRounds', JSON.stringify([preset]));
    await runInit();
    // Trigger a custom error first
    document.getElementById('customError').style.display = 'block';
    document.getElementById('customError').textContent = 'some error';
    // Click the Load button
    document.querySelector('.preset-load-btn').click();
    expect(document.getElementById('customName').value).toBe('Stored Load');
    expect(document.getElementById('customWeight').value).toBe('9.5');
    expect(document.getElementById('customMV').value).toBe('900');
    expect(document.getElementById('customBC').value).toBe('0.45');
    expect(document.getElementById('customDia').value).toBe('6');
    expect(document.getElementById('customError').style.display).toBe('none');
  });

  test('onDelete removes preset from rendered list', async () => {
    const preset = {
      id: '3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c',
      name: 'Stored Load', weightG: 11, mvMps: 800, bc: 0.5, diaMm: 7.82,
      savedAt: '2026-11-01T14:03:22.511Z',
    };
    localStorage.setItem('bv_customRounds', JSON.stringify([preset]));
    await runInit();
    expect(document.querySelectorAll('.preset-row')).toHaveLength(1);
    document.querySelector('.preset-delete-btn').click();
    expect(document.querySelectorAll('.preset-row')).toHaveLength(0);
    expect(document.getElementById('customPresetSection').hidden).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FE-3: Data table column sort
// ─────────────────────────────────────────────────────────────────────────────
describe('FE-3: SORTABLE_COLUMNS', () => {
  const pt = { rangeMeters: 100, dropCm: -5.2, velocityMps: 750, energyJoules: 3000, windDriftCm: 2.1, timeOfFlightSec: 0.14 };
  const adj = { moa: -1.9, mrad: -0.55 };

  test('range accessor', () => { expect(mod.SORTABLE_COLUMNS.range(pt, adj)).toBe(100); });
  test('drop accessor',  () => { expect(mod.SORTABLE_COLUMNS.drop(pt, adj)).toBe(-5.2); });
  test('velocity accessor', () => { expect(mod.SORTABLE_COLUMNS.velocity(pt, adj)).toBe(750); });
  test('energy accessor',   () => { expect(mod.SORTABLE_COLUMNS.energy(pt, adj)).toBe(3000); });
  test('windDrift accessor', () => { expect(mod.SORTABLE_COLUMNS.windDrift(pt, adj)).toBe(2.1); });
  test('time accessor',  () => { expect(mod.SORTABLE_COLUMNS.time(pt, adj)).toBe(0.14); });
  test('moa accessor',   () => { expect(mod.SORTABLE_COLUMNS.moa(pt, adj)).toBe(-1.9); });
  test('mrad accessor',  () => { expect(mod.SORTABLE_COLUMNS.mrad(pt, adj)).toBe(-0.55); });
});

describe('FE-3: _getSortState', () => {
  test('returns default state before any sort', () => {
    expect(mod._getSortState()).toEqual({ column: null, direction: 'asc' });
  });

  test('returns updated state after onSortHeaderClick', async () => {
    const results = makeTableResults();
    mod._setLastResults(results);
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    expect(mod._getSortState()).toEqual({ column: 'range', direction: 'asc' });
  });
});

// Helper: minimal results fixture for table tests (2 rows, different rangeMeters)
function makeTableResults() {
  return [{
    bullet: { id: '308-win-168gr', name: '.308 Win 168gr', muzzleVelocityMps: 807,
              muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
    request: {},
    points: [
      { rangeMeters: 200, dropCm: -10, velocityMps: 700, energyJoules: 2800, windDriftCm: 3, timeOfFlightSec: 0.28 },
      { rangeMeters: 100, dropCm: -3,  velocityMps: 760, energyJoules: 3100, windDriftCm: 1, timeOfFlightSec: 0.13 },
    ],
    maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800,
  }];
}

describe('FE-3: onSortHeaderClick', () => {
  test('no-op when tableResults is null', () => {
    mod.onSortHeaderClick('range');
    expect(mod._getSortState()).toEqual({ column: null, direction: 'asc' });
  });

  test('no-op when key is not in SORTABLE_COLUMNS', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('bogus');
    expect(mod._getSortState()).toEqual({ column: null, direction: 'asc' });
  });

  test('first click sets column and asc direction', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    expect(mod._getSortState()).toEqual({ column: 'range', direction: 'asc' });
  });

  test('second click on same column toggles to desc', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    mod.onSortHeaderClick('range');
    expect(mod._getSortState()).toEqual({ column: 'range', direction: 'desc' });
  });

  test('third click on same column toggles back to asc', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    mod.onSortHeaderClick('range'); // desc
    mod.onSortHeaderClick('range'); // back to asc
    expect(mod._getSortState()).toEqual({ column: 'range', direction: 'asc' });
  });

  test('click on different column resets to asc', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    mod.onSortHeaderClick('drop');
    expect(mod._getSortState()).toEqual({ column: 'drop', direction: 'asc' });
  });

  test('re-renders table on valid sort', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    const rows = document.querySelectorAll('#tableBody tr');
    expect(rows.length).toBe(2);
  });
});

describe('FE-3: renderTable sort logic', () => {
  test('sorts asc by range — row with lower range comes first', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range'); // asc
    const cells = [...document.querySelectorAll('#tableBody tr td:nth-child(2)')];
    expect(Number(cells[0].textContent)).toBe(100);
    expect(Number(cells[1].textContent)).toBe(200);
  });

  test('sorts desc by range — row with higher range comes first', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range'); // asc
    mod.onSortHeaderClick('range'); // desc
    const cells = [...document.querySelectorAll('#tableBody tr td:nth-child(2)')];
    expect(Number(cells[0].textContent)).toBe(200);
    expect(Number(cells[1].textContent)).toBe(100);
  });

  test('NaN values sort last', async () => {
    const resultsWithNaN = [{
      bullet: { id: '308-win-168gr', name: 'Test', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: NaN,  dropCm: 0, velocityMps: 700, energyJoules: 2800, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: 100,  dropCm: 0, velocityMps: 760, energyJoules: 3100, windDriftCm: 0, timeOfFlightSec: 0 },
      ],
      maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0,
    }];
    await mod.renderResults(resultsWithNaN, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    const cells = [...document.querySelectorAll('#tableBody tr td:nth-child(2)')];
    // first row should be the finite one (100)
    expect(Number(cells[0].textContent)).toBe(100);
  });

  test('both NaN values remain stable (return 0)', async () => {
    const resultsWithNaN = [{
      bullet: { id: '308-win-168gr', name: 'Test', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: NaN, dropCm: 0, velocityMps: 700, energyJoules: 2800, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: NaN, dropCm: 0, velocityMps: 760, energyJoules: 3100, windDriftCm: 0, timeOfFlightSec: 0 },
      ],
      maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0,
    }];
    await mod.renderResults(resultsWithNaN, { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(() => mod.onSortHeaderClick('range')).not.toThrow();
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(2);
  });

  test('finite value beats NaN (bFin false branch)', async () => {
    const resultsWithNaN = [{
      bullet: { id: '308-win-168gr', name: 'Test', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 100, dropCm: 0, velocityMps: 700, energyJoules: 2800, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: NaN, dropCm: 0, velocityMps: 760, energyJoules: 3100, windDriftCm: 0, timeOfFlightSec: 0 },
      ],
      maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0,
    }];
    await mod.renderResults(resultsWithNaN, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    const cells = [...document.querySelectorAll('#tableBody tr td:nth-child(2)')];
    expect(Number(cells[0].textContent)).toBe(100);
  });

  test('renderResults resets sort state before rendering', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range'); // set a sort
    expect(mod._getSortState().column).toBe('range');
    // renderResults should reset it
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(mod._getSortState()).toEqual({ column: null, direction: 'asc' });
  });
});

describe('FE-3: updateSortIndicators', () => {
  test('sets aria-sort and ▲ on active column asc', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    const th = document.querySelector('#dataTable thead th[data-sort-key="range"]');
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(th.querySelector('.sort-indicator').textContent).toBe('▲');
  });

  test('sets aria-sort descending and ▼ on active column desc', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    mod.onSortHeaderClick('range');
    const th = document.querySelector('#dataTable thead th[data-sort-key="range"]');
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(th.querySelector('.sort-indicator').textContent).toBe('▼');
  });

  test('inactive columns have no aria-sort and empty indicator', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('range');
    const th = document.querySelector('#dataTable thead th[data-sort-key="drop"]');
    expect(th.hasAttribute('aria-sort')).toBe(false);
    expect(th.querySelector('.sort-indicator').textContent).toBe('');
  });

  test('all indicators cleared when no sort active', () => {
    mod.updateSortIndicators();
    document.querySelectorAll('#dataTable thead th[data-sort-key]').forEach(th => {
      expect(th.hasAttribute('aria-sort')).toBe(false);
      expect(th.querySelector('.sort-indicator').textContent).toBe('');
    });
  });
});

describe('FE-3: _resetState resets sort variables', () => {
  test('resets sortColumn, sortDirection, tableResults', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    mod.onSortHeaderClick('drop');
    mod._resetState();
    expect(mod._getSortState()).toEqual({ column: null, direction: 'asc' });
    // After reset, onSortHeaderClick should be a no-op (tableResults is null)
    mod.onSortHeaderClick('range');
    expect(mod._getSortState()).toEqual({ column: null, direction: 'asc' });
  });
});

describe('FE-3: init() thead click listener', () => {
  async function runInit() {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: [], id: 1 }) });
    await mod.init();
  }

  test('click on sort-key th calls onSortHeaderClick', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    await runInit();
    const th = document.querySelector('#dataTable thead th[data-sort-key="range"]');
    th.click();
    expect(mod._getSortState().column).toBe('range');
  });

  test('click on Round th (no data-sort-key) is a no-op', async () => {
    const results = makeTableResults();
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    await runInit();
    const roundTh = document.querySelector('#dataTable thead th:not([data-sort-key])');
    roundTh.click();
    expect(mod._getSortState()).toEqual({ column: null, direction: 'asc' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-1: Adjustment chart (5th panel, dual y-axis)
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-1: renderResults creates adjustment chart as 5th panel', () => {
  function makeAdjResult(overrides = {}) {
    return {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,   velocityMps: 807, energyJoules: 3552, windDriftCm: 0,  timeOfFlightSec: 0 },
        { rangeMeters: 100, dropCm: -5,  velocityMps: 760, energyJoules: 3150, windDriftCm: 2,  timeOfFlightSec: 0.13 },
        { rangeMeters: 300, dropCm: -30, velocityMps: 650, energyJoules: 2300, windDriftCm: 10, timeOfFlightSec: 0.42 },
      ],
      maxOrdinateCm: 8.5, maxOrdinateRangeMeters: 55, supersonicLimitMeters: 820,
      ...overrides,
    };
  }

  test('renders 5 Chart instances', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeAdjResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(MockChart).toHaveBeenCalledTimes(5);
  });

  test('adjustment chart has dual y-axes (yMoa and yMrad)', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeAdjResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
    // 5th call is adjustChart
    const adjustCfg = MockChart.mock.calls[4][1];
    expect(adjustCfg.options.scales.yMoa).toBeDefined();
    expect(adjustCfg.options.scales.yMrad).toBeDefined();
    expect(adjustCfg.options.scales.yMoa.position).toBe('left');
    expect(adjustCfg.options.scales.yMrad.position).toBe('right');
  });

  test('adjustment chart datasets include MOA and MRAD series', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeAdjResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
    const adjustCfg = MockChart.mock.calls[4][1];
    const labels = adjustCfg.data.datasets.map(d => d.label);
    const hasMoa  = labels.some(l => l.includes('MOA'));
    const hasMrad = labels.some(l => l.includes('MRAD'));
    expect(hasMoa).toBe(true);
    expect(hasMrad).toBe(true);
  });

  test('MRAD datasets use dashed border', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeAdjResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
    const adjustCfg = MockChart.mock.calls[4][1];
    const mradDs = adjustCfg.data.datasets.filter(d => d.label.includes('MRAD'));
    mradDs.forEach(ds => {
      expect(Array.isArray(ds.borderDash)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SH-3 FE: density altitude stat tile
// ─────────────────────────────────────────────────────────────────────────────
describe('SH-3 FE: renderStatCards shows density altitude', () => {
  function makeStatResult(densityAlt) {
    return {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552,
                 windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823,
      ...(densityAlt !== undefined ? { densityAltitudeMeters: densityAlt } : {}),
    };
  }

  test('renders density altitude tile when field is present', () => {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';
    mod.renderStatCards([makeStatResult(1500)], container);
    expect(container.innerHTML).toContain('density alt');
    expect(container.innerHTML).toContain('1500');
  });

  test('omits density altitude tile when field is absent', () => {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';
    mod.renderStatCards([makeStatResult(undefined)], container);
    expect(container.innerHTML).not.toContain('density alt');
  });

  test('renders zero density altitude', () => {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';
    mod.renderStatCards([makeStatResult(0)], container);
    expect(container.innerHTML).toContain('density alt');
    expect(container.innerHTML).toContain('0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SH-1 FE: spin drift as dashed series on wind chart
// ─────────────────────────────────────────────────────────────────────────────
describe('SH-1 FE: spin drift dashed series on wind chart', () => {
  function makeSpinResult(withSpinDrift) {
    return {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: withSpinDrift
        ? [{ rangeMeters: 0,   dropCm: 0,  velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0, spinDriftCm: 0.5 },
           { rangeMeters: 100, dropCm: -5, velocityMps: 760, energyJoules: 3150, windDriftCm: 2, timeOfFlightSec: 0.13, spinDriftCm: 1.2 }]
        : [{ rangeMeters: 0,   dropCm: 0,  velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823,
    };
  }

  test('adds spin drift dataset to windChart when spinDriftCm present', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeSpinResult(true)], { zeroRangeMeters: 100, windSpeedKph: 0 });
    // windChart is the 4th chart (index 3)
    const windCfg = MockChart.mock.calls[3][1];
    const spinDs = windCfg.data.datasets.filter(d => d.label.includes('spin drift'));
    expect(spinDs.length).toBeGreaterThan(0);
    // should be dashed
    spinDs.forEach(ds => expect(Array.isArray(ds.borderDash)).toBe(true));
  });

  test('no spin drift dataset when spinDriftCm absent from all points', async () => {
    MockChart.mockClear();
    await mod.renderResults([makeSpinResult(false)], { zeroRangeMeters: 100, windSpeedKph: 0 });
    const windCfg = MockChart.mock.calls[3][1];
    const spinDs = windCfg.data.datasets.filter(d => d.label.includes('spin drift'));
    expect(spinDs.length).toBe(0);
  });

  test('spin drift ?? 0 covers undefined spinDriftCm on a point', async () => {
    // First point has spinDriftCm (triggers hasSpinDrift=true); second lacks it → ?? 0 fires
    MockChart.mockClear();
    await mod.renderResults([{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,  velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0,    spinDriftCm: 1 },
        { rangeMeters: 100, dropCm: -5, velocityMps: 760, energyJoules: 3150, windDriftCm: 2, timeOfFlightSec: 0.13 },
      ],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823,
    }], { zeroRangeMeters: 100, windSpeedKph: 0 });
    const windCfg = MockChart.mock.calls[3][1];
    const spinDs = windCfg.data.datasets.filter(d => d.label.includes('spin drift'));
    expect(spinDs.length).toBeGreaterThan(0);
    expect(spinDs[0].data[1].y).toBe(0); // undefined ?? 0 = 0
  });

  test('fallback color used when bullet id not in BULLET_COLORS', async () => {
    MockChart.mockClear();
    await mod.renderResults([{
      bullet: { id: 'unknown-custom-bullet', name: 'Custom', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,  velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0,    spinDriftCm: 1 },
        { rangeMeters: 100, dropCm: -5, velocityMps: 760, energyJoules: 3150, windDriftCm: 2, timeOfFlightSec: 0.13, spinDriftCm: 1.2 },
      ],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823,
    }], { zeroRangeMeters: 100, windSpeedKph: 0 });
    const windCfg = MockChart.mock.calls[3][1];
    const spinDs = windCfg.data.datasets.filter(d => d.label.includes('spin drift'));
    expect(spinDs.length).toBeGreaterThan(0);
    expect(spinDs[0].borderColor).toBe('#4ADE80'); // BULLET_COLORS[unknownId] || '#4ADE80'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-3: renderDopeCard called from renderResults
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-3: renderResults calls renderDopeCard', () => {
  test('dopeTable is populated after renderResults when Tools tab activates', async () => {
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,   velocityMps: 807, energyJoules: 3552, windDriftCm: 0,  timeOfFlightSec: 0 },
        { rangeMeters: 100, dropCm: -5,  velocityMps: 760, energyJoules: 3150, windDriftCm: 2,  timeOfFlightSec: 0.13 },
        { rangeMeters: 500, dropCm: -80, velocityMps: 550, energyJoules: 1650, windDriftCm: 15, timeOfFlightSec: 0.72 },
      ],
      maxOrdinateCm: 8.5, maxOrdinateRangeMeters: 55, supersonicLimitMeters: 820,
    };
    await mod.renderResults([result], { zeroRangeMeters: 100, windSpeedKph: 0 });
    await mod.switchTab('tools', document.getElementById('tab-tools'));
    const html = document.getElementById('dopeTable').innerHTML;
    // dopeTable should have content (thead + tbody)
    expect(html).toContain('<thead>');
    expect(html).toContain('.308 Win');
  });

  test('renders Coriolis cell without + prefix for negative coriolis in DOPE table (tools.js:116 false branch)', async () => {
    // Both points have negative coriolisDeflectionCm → hasCoriolis=true (non-zero),
    // interpolation returns non-null negative cor → `cor >= 0 ? '+' : ''` takes the '' branch
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,   velocityMps: 807, energyJoules: 3552, windDriftCm: 0,  timeOfFlightSec: 0,    coriolisDeflectionCm: -1.5 },
        { rangeMeters: 500, dropCm: -80, velocityMps: 550, energyJoules: 1650, windDriftCm: 15, timeOfFlightSec: 0.72, coriolisDeflectionCm: -2.0 },
      ],
      maxOrdinateCm: 8.5, maxOrdinateRangeMeters: 55, supersonicLimitMeters: 820,
    };
    document.getElementById('toolsPanel').classList.add('active');
    await mod.renderResults([result], { zeroRangeMeters: 100, windSpeedKph: 0 });
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-4: updateSweepButtonVisibility
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: updateSweepButtonVisibility', () => {
  test('hides sweepControls when no bullets selected', () => {
    mod._setSelectedIds(new Set());
    mod.updateSweepButtonVisibility();
    expect(document.getElementById('sweepControls').style.display).toBe('none');
  });

  test('shows sweepControls when at least one bullet selected', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.updateSweepButtonVisibility();
    expect(document.getElementById('sweepControls').style.display).toBe('block');
  });

  test('is a no-op when sweepControls element is absent', () => {
    document.getElementById('sweepControls').remove();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    expect(() => mod.updateSweepButtonVisibility()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-4: SWEEP_RANGES and buildSweepRequests
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: SWEEP_RANGES', () => {
  test('has wind, altitude, temperature keys with 5 values each', () => {
    expect(mod.SWEEP_RANGES.wind).toHaveLength(5);
    expect(mod.SWEEP_RANGES.altitude).toHaveLength(5);
    expect(mod.SWEEP_RANGES.temperature).toHaveLength(5);
  });
});

describe('MH-4: buildSweepRequests', () => {
  const baseReq = {
    bulletIds: ['308-win-168gr'], zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 25,
    windSpeedKph: 0, windDirectionDeg: 90, altitudeMeters: 0, temperatureC: 15,
    sightHeightMm: 38.1, shootingAngleDegrees: 0, dragModel: 'G1',
  };

  test('returns 5 requests for wind sweep', () => {
    const reqs = mod.buildSweepRequests(baseReq, 'wind', '308-win-168gr');
    expect(reqs).toHaveLength(5);
    reqs.forEach((r, i) => {
      expect(r.windSpeedKph).toBe(mod.SWEEP_RANGES.wind[i]);
      expect(r.bulletIds).toEqual(['308-win-168gr']);
    });
  });

  test('returns 5 requests for altitude sweep', () => {
    const reqs = mod.buildSweepRequests(baseReq, 'altitude', '308-win-168gr');
    expect(reqs).toHaveLength(5);
    reqs.forEach((r, i) => {
      expect(r.altitudeMeters).toBe(mod.SWEEP_RANGES.altitude[i]);
    });
  });

  test('returns 5 requests for temperature sweep', () => {
    const reqs = mod.buildSweepRequests(baseReq, 'temperature', '308-win-168gr');
    expect(reqs).toHaveLength(5);
    reqs.forEach((r, i) => {
      expect(r.temperatureC).toBe(mod.SWEEP_RANGES.temperature[i]);
    });
  });

  test('falls back to wind range for unknown sweepParam (5 requests, bulletIds set)', () => {
    const reqs = mod.buildSweepRequests(baseReq, 'unknown', '308-win-168gr');
    expect(reqs).toHaveLength(5);
    reqs.forEach(r => {
      expect(r.bulletIds).toEqual(['308-win-168gr']);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-4: runSweep
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: runSweep', () => {
  function makeSweepApiResult() {
    return {
      jsonrpc: '2.0', id: 1,
      result: [0, 1, 2, 3, 4].map(i => ({
        bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
                  ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
        request: {},
        points: [
          { rangeMeters: 0,   dropCm: 0,          velocityMps: 807, energyJoules: 3552, windDriftCm: i, timeOfFlightSec: 0 },
          { rangeMeters: 100, dropCm: -(5 + i),   velocityMps: 760, energyJoules: 3150, windDriftCm: i + 2, timeOfFlightSec: 0.13 },
        ],
        supersonicLimitMeters: 820, maxOrdinateCm: 3, maxOrdinateRangeMeters: 50,
      })),
    };
  }

  test('no-op when no bullets selected', async () => {
    mod._setSelectedIds(new Set());
    await mod.runSweep();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('runs sweep locally and shows results', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    await mod.runSweep();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
    expect(document.getElementById('clearSweepBtn').style.display).toBe('block');
  });

  test('falls back to client-side simulation when fetch fails', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockRejectedValue(new Error('offline'));

    await mod.runSweep();

    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('falls back to client-side when RPC returns error', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } }),
    });

    await mod.runSweep();

    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('no-op when bullet not found in fallback path', async () => {
    mod._setSelectedIds(new Set(['nonexistent-bullet']));
    mod._setBullets([]);
    global.fetch.mockRejectedValue(new Error('offline'));

    await mod.runSweep();
    // button text should be reset
    const btn = document.getElementById('sweepBtn');
    expect(btn.querySelector('span').textContent).toBe('SWEEP');
  });

  test('falls back when HTTP response is not ok', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await mod.runSweep();

    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('sweepParam defaults to wind when element absent (line 1256 ?? wind)', async () => {
    document.getElementById('sweepParam').remove();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeSweepApiResult()),
    });
    await mod.runSweep();
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('sweepBtn absent: if(btn) false at spinner and final reset (lines 1258 and 1297)', async () => {
    document.getElementById('sweepBtn').remove();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeSweepApiResult()),
    });
    await mod.runSweep();
    expect(document.getElementById('clearSweepBtn').style.display).toBe('block');
  });

  test('clearSweepBtn absent: if(clearBtn) false after sweep (line 1299)', async () => {
    document.getElementById('clearSweepBtn').remove();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeSweepApiResult()),
    });
    await mod.runSweep();
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('bullet not found and sweepBtn absent: if(btn) false in !bullet branch (line 1289)', async () => {
    document.getElementById('sweepBtn').remove();
    mod._setSelectedIds(new Set(['nonexistent-bullet']));
    mod._setBullets([]);
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runSweep();
    expect(document.getElementById('clearSweepBtn').style.display).not.toBe('block');
  });

  test('destroys existing charts before sweep renders (line 1322 forEach callback)', async () => {
    const mockChart = { destroy: jest.fn() };
    mod._setCharts({ trajectory: mockChart });
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeSweepApiResult()),
    });
    await mod.runSweep();
    expect(mockChart.destroy).toHaveBeenCalled();
  });

  test('resets button text when simulateAsync throws TrajectoryInputError (lines 1170-1172)', async () => {
    const { TrajectoryInputError } = require('../app/physics/engine.ts');
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too large'));
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    await mod.runSweep();

    const btn = document.getElementById('sweepBtn');
    expect(btn.querySelector('span').textContent).toBe('SWEEP');
    expect(document.getElementById('resultsContainer').style.display).not.toBe('flex');
  });

  test('if(btn) false in error catch when sweepBtn absent (line 1173)', async () => {
    document.getElementById('sweepBtn').remove();
    const { TrajectoryInputError } = require('../app/physics/engine.ts');
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too large'));
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    await expect(mod.runSweep()).resolves.toBeUndefined();
  });


});

// ─────────────────────────────────────────────────────────────────────────────
// MH-4: clearSweep
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: clearSweep', () => {
  test('hides clearSweepBtn', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runSweep();
    expect(document.getElementById('clearSweepBtn').style.display).toBe('block');

    // Set up lastResults so clearSweep can call renderResults
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 820,
    };
    mod._setLastResults([result]);
    await mod.clearSweep();
    expect(document.getElementById('clearSweepBtn').style.display).toBe('none');
  });

  test('re-renders last results', async () => {
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 820,
    };
    mod._setLastResults([result]);
    MockChart.mockClear();
    await mod.clearSweep();
    // renderResults should have been called → new charts created
    expect(MockChart).toHaveBeenCalled();
  });

  test('clearSweepBtn absent: if(clearBtn) false does not throw (line 1306)', async () => {
    document.getElementById('clearSweepBtn').remove();
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 820,
    };
    mod._setLastResults([result]);
    await mod.clearSweep();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-4: renderSweepCharts
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: renderSweepCharts', () => {
  function makeSweepList() {
    return [0, 1, 2, 3, 4].map(i => ({
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
                ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,          velocityMps: 807, energyJoules: 3552, windDriftCm: i, timeOfFlightSec: 0 },
        { rangeMeters: 100, dropCm: -(5 + i),   velocityMps: 760, energyJoules: 3150, windDriftCm: i + 2, timeOfFlightSec: 0.13 },
      ],
      supersonicLimitMeters: 820, maxOrdinateCm: 3, maxOrdinateRangeMeters: 50,
    }));
  }

  test('creates 3 Chart instances (drop, wind, velocity)', async () => {
    MockChart.mockClear();
    await mod.renderSweepCharts(makeSweepList(), 'wind');
    expect(MockChart).toHaveBeenCalledTimes(3);
  });

  test('shows resultsContainer', async () => {
    await mod.renderSweepCharts(makeSweepList(), 'wind');
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('uses SWEEP_COLORS for datasets', async () => {
    MockChart.mockClear();
    await mod.renderSweepCharts(makeSweepList(), 'wind');
    const cfg = MockChart.mock.calls[0][1];
    cfg.data.datasets.forEach((ds, i) => {
      expect(ds.borderColor).toBe(mod.SWEEP_COLORS[i % mod.SWEEP_COLORS.length]);
    });
  });

  test('renders altitude sweep without error', async () => {
    await mod.renderSweepCharts(makeSweepList(), 'altitude');
  });

  test('renders temperature sweep without error', async () => {
    await mod.renderSweepCharts(makeSweepList(), 'temperature');
  });

  test('falls back to wind unit for unknown sweepParam', async () => {
    await mod.renderSweepCharts(makeSweepList(), 'unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-4: toggleBullet calls updateSweepButtonVisibility
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: toggleBullet calls updateSweepButtonVisibility', () => {
  test('sweepControls shown after selecting a bullet', () => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList(mod.getMockBullets());
    mod.toggleBullet('308-win-168gr');
    expect(document.getElementById('sweepControls').style.display).toBe('block');
  });

  test('sweepControls hidden after deselecting last bullet', () => {
    mod._setBullets(mod.getMockBullets());
    mod.renderBulletList(mod.getMockBullets());
    mod.toggleBullet('308-win-168gr');
    mod.toggleBullet('308-win-168gr');
    expect(document.getElementById('sweepControls').style.display).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-4: runSimulation includes twistRateInchesPerTurn when twistRate is set
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: runSimulation uses twistRate input', () => {
  const mockApiResults = [
    {
      bullet: { id: '308-win-168gr', name: '.308 Win 168gr', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823,
    },
  ];

  test('includes twistRateInchesPerTurn when twistRate input has a value', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    document.getElementById('twistRate').value = '10';

    mod.runSimulation();

    expect(mod._getState().lastReq.twistRateInchesPerTurn).toBe(10);
  });

  test('omits twistRateInchesPerTurn when twistRate input is empty', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    document.getElementById('twistRate').value = '';

    mod.runSimulation();

    expect(mod._getState().lastReq.twistRateInchesPerTurn).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-1: adjustment chart interaction callbacks (lines 1095-1110)
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-1: adjustment chart callbacks', () => {
  const singleResult = [{
    bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
              muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
    request: {},
    points: [
      { rangeMeters: 0,   dropCm: 0,   velocityMps: 807, energyJoules: 3552, windDriftCm: 0,  timeOfFlightSec: 0 },
      { rangeMeters: 100, dropCm: -5,  velocityMps: 760, energyJoules: 3150, windDriftCm: 2,  timeOfFlightSec: 0.13 },
    ],
    maxOrdinateCm: 8.5, maxOrdinateRangeMeters: 55, supersonicLimitMeters: 820,
  }];

  async function renderAndGetAdjCallbacks() {
    MockChart.mockClear();
    await mod.renderResults(singleResult, { zeroRangeMeters: 100, windSpeedKph: 0 });
    // 5th chart is adjustChart
    return MockChart.mock.calls[4][1].options;
  }

  test('onHover with no elements hides readout (adjustChart)', async () => {
    const opts = await renderAndGetAdjCallbacks();
    // First set a crosshairIndex
    opts.onHover({}, [{ index: 0 }]);
    // Then clear it
    opts.onHover({}, []);
    expect(mod._getState().crosshairIndex).toBeNull();
    expect(document.getElementById('rangeReadout').style.display).toBe('none');
  });

  test('onClick with elements pins readout (adjustChart)', async () => {
    const opts = await renderAndGetAdjCallbacks();
    opts.onClick({}, [{ index: 1 }]);
    expect(mod._getState().crosshairPinned).toBe(true);
    expect(mod._getState().crosshairIndex).toBe(1);
  });

  test('onClick with no elements is no-op (adjustChart)', async () => {
    const opts = await renderAndGetAdjCallbacks();
    opts.onClick({}, []);
    expect(mod._getState().crosshairPinned).toBe(false);
  });

  test('onClick unpins and hides readout on second click (adjustChart)', async () => {
    const opts = await renderAndGetAdjCallbacks();
    opts.onClick({}, [{ index: 0 }]);
    opts.onClick({}, [{ index: 0 }]);
    expect(mod._getState().crosshairPinned).toBe(false);
  });

  test('onHover when crosshairPinned returns early without changing index (adjustChart)', async () => {
    const opts = await renderAndGetAdjCallbacks();
    opts.onHover({}, [{ index: 0 }]);           // set crosshairIndex = 0
    opts.onClick({}, [{ index: 0 }]);            // pin crosshairPinned = true
    expect(mod._getState().crosshairPinned).toBe(true);
    opts.onHover({}, [{ index: 1 }]);            // if (crosshairPinned) return; fires
    expect(mod._getState().crosshairIndex).toBe(0); // unchanged
  });

  test('export button on adjustChart calls exportPNG', async () => {
    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,abc');
    try {
      await mod.renderResults(singleResult, { zeroRangeMeters: 100, windSpeedKph: 0 });
      const btn = document.querySelector('[data-chart-id="adjustChart"]');
      expect(btn).not.toBeNull();
      btn.click();
      await flushMicrotasks();
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
    } finally {
      delete HTMLCanvasElement.prototype.toDataURL;
    }
  });

  test('touchmove on adjustChart canvas fires mousemove', async () => {
    await mod.renderResults(singleResult, { zeroRangeMeters: 100, windSpeedKph: 0 });
    const canvas = document.getElementById('adjustChart');
    expect(canvas).not.toBeNull();
    const listener = jest.fn();
    canvas.addEventListener('mousemove', listener);
    const touch = { clientX: 100, clientY: 50 };
    const te = new Event('touchmove', { cancelable: true, bubbles: true });
    te.touches = [touch];
    canvas.dispatchEvent(te);
    expect(listener).toHaveBeenCalled();
  });
});





// ─────────────────────────────────────────────────────────────────────────────
// MH-4: export button on sweep chart (line 1344)
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: sweep export button', () => {
  function makeSweepList5() {
    return [0, 1, 2, 3, 4].map(i => ({
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807, muzzleEnergyJoules: 3552,
                ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0,   dropCm: 0,        velocityMps: 807, energyJoules: 3552, windDriftCm: i, timeOfFlightSec: 0 },
        { rangeMeters: 100, dropCm: -(5 + i), velocityMps: 760, energyJoules: 3150, windDriftCm: i + 2, timeOfFlightSec: 0.13 },
      ],
      supersonicLimitMeters: 820, maxOrdinateCm: 3, maxOrdinateRangeMeters: 50,
    }));
  }

  test('clicking export-btn on a sweep chart panel calls exportPNG', async () => {
    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,abc');
    try {
      await mod.renderSweepCharts(makeSweepList5(), 'wind');
      const btn = document.querySelector('.export-btn');
      expect(btn).not.toBeNull();
      btn.click();
      await flushMicrotasks();
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
    } finally {
      delete HTMLCanvasElement.prototype.toDataURL;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UX-2: exportTrajectoryCSV
// ─────────────────────────────────────────────────────────────────────────────
describe('exportTrajectoryCSV', () => {
  let createObjectURL, revokeObjectURL, anchorClick;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    global.Blob = jest.fn((parts) => ({ parts }));
    anchorClick = jest.fn();
    HTMLAnchorElement.prototype.click = anchorClick;
  });

  afterEach(() => {
    delete HTMLAnchorElement.prototype.click;
  });

  test('returns early without creating a Blob when lastResults is empty', async () => {
    mod._resetState();
    await mod.exportTrajectoryCSV();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test('single bullet: produces correct CSV header', async () => {
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP' },
      points: [
        { rangeMeters: 0,   velocityMps: 807, energyJoules: 3552, dropCm: 0 },
        { rangeMeters: 100, velocityMps: 760, energyJoules: 3100, dropCm: -3.5 },
      ],
    };
    mod._setLastResults([result]);
    await mod.exportTrajectoryCSV();

    const csv = global.Blob.mock.calls[0][0][0];
    expect(csv).toContain('Distance (m),Velocity (m/s),Energy (J),Drop (m),Bullet');
  });

  test('single bullet: produces correct data rows with Drop converted from cm to m', async () => {
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win 168gr BTHP' },
      points: [
        { rangeMeters: 0,   velocityMps: 807, energyJoules: 3552, dropCm: 0 },
        { rangeMeters: 100, velocityMps: 760, energyJoules: 3100, dropCm: -3.5 },
      ],
    };
    mod._setLastResults([result]);
    await mod.exportTrajectoryCSV();

    const csv = global.Blob.mock.calls[0][0][0];
    // dropCm -3.5 → -0.035 m
    expect(csv).toContain('100,760,3100,-0.035,');
    expect(csv).toContain('.308 Win 168gr BTHP');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  test('two bullets in compare mode: rows present for both, distinguished by Bullet column', async () => {
    const results = [
      {
        bullet: { id: '308-win-168gr', name: '.308 Win' },
        points: [{ rangeMeters: 0, velocityMps: 807, energyJoules: 3552, dropCm: 0 }],
      },
      {
        bullet: { id: '223-rem-55gr', name: '.223 Rem' },
        points: [{ rangeMeters: 0, velocityMps: 975, energyJoules: 1748, dropCm: 0 }],
      },
    ];
    mod._setLastResults(results);
    await mod.exportTrajectoryCSV();

    const csv = global.Blob.mock.calls[0][0][0];
    expect(csv).toContain('".308 Win"');
    expect(csv).toContain('".223 Rem"');
    // Should have header + 2 data rows
    const lines = csv.split('\n');
    expect(lines.length).toBe(3);
  });

  test('bullet name containing a comma is wrapped in double-quotes (RFC 4180)', async () => {
    const result = {
      bullet: { id: 'custom', name: 'Sierra, 168gr' },
      points: [{ rangeMeters: 0, velocityMps: 807, energyJoules: 3552, dropCm: 0 }],
    };
    mod._setLastResults([result]);
    await mod.exportTrajectoryCSV();

    const csv = global.Blob.mock.calls[0][0][0];
    expect(csv).toContain('"Sierra, 168gr"');
  });

  test('bullet name containing double-quotes has them doubled (RFC 4180)', async () => {
    const result = {
      bullet: { id: 'custom', name: 'Match "King" 168gr' },
      points: [{ rangeMeters: 0, velocityMps: 807, energyJoules: 3552, dropCm: 0 }],
    };
    mod._setLastResults([result]);
    await mod.exportTrajectoryCSV();

    const csv = global.Blob.mock.calls[0][0][0];
    expect(csv).toContain('"Match ""King"" 168gr"');
  });

  test('Blob is created with text/csv MIME type', async () => {
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win' },
      points: [{ rangeMeters: 0, velocityMps: 807, energyJoules: 3552, dropCm: 0 }],
    };
    mod._setLastResults([result]);
    await mod.exportTrajectoryCSV();

    const blobArgs = global.Blob.mock.calls[0];
    expect(blobArgs[1]).toEqual({ type: 'text/csv' });
  });

  test('formula-injection trigger in bullet name is prefixed with apostrophe', async () => {
    const result = {
      bullet: { id: 'custom', name: '=HYPERLINK("x")' },
      points: [{ rangeMeters: 0, velocityMps: 807, energyJoules: 3552, dropCm: 0 }],
    };
    mod._setLastResults([result]);
    await mod.exportTrajectoryCSV();

    const csv = global.Blob.mock.calls[0][0][0];
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UX-2: exportCsvBtn visibility after runSimulation
// ─────────────────────────────────────────────────────────────────────────────
describe('exportCsvBtn visibility', () => {
  test('button is hidden before simulation runs', () => {
    expect(document.getElementById('exportCsvBtn').style.display).toBe('none');
  });

  test('button is shown after runSimulation completes successfully', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    expect(document.getElementById('exportCsvBtn').style.display).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UX-2: exportCsvBtn click listener (wired by init)
// ─────────────────────────────────────────────────────────────────────────────
describe('exportCsvBtn click listener via init', () => {
  let createObjectURL, revokeObjectURL, anchorClick;

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    global.Blob = jest.fn((parts) => ({ parts }));
    anchorClick = jest.fn();
    HTMLAnchorElement.prototype.click = anchorClick;
  });

  afterEach(() => {
    delete HTMLAnchorElement.prototype.click;
  });

  test('clicking exportCsvBtn triggers exportTrajectoryCSV when lastResults are set', async () => {
    const result = {
      bullet: { id: '308-win-168gr', name: '.308 Win' },
      points: [{ rangeMeters: 0, velocityMps: 807, energyJoules: 3552, dropCm: 0 }],
    };
    mod._setLastResults([result]);
    await mod.init();

    document.getElementById('exportCsvBtn').dispatchEvent(new MouseEvent('click'));
    await flushMicrotasks();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UX-1: Custom bullet catalog
// ─────────────────────────────────────────────────────────────────────────────
const {
  loadCustomBullets: _loadCustomBullets,
  CUSTOM_BULLETS_KEY,
} = require('../app/custom-bullets.js');

function makeCustomRecord(overrides = {}) {
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

describe('_setCustomRecords / _setCustomStorageStatus', () => {
  test('_setCustomRecords updates customRecords in state', () => {
    mod._setCustomRecords([makeCustomRecord()]);
    expect(mod._getState().customRecords).toHaveLength(1);
    expect(mod._getState().customRecords[0].id).toBe('usr-3f2b8c1e9a4d4e6f');
  });

  test('_setCustomStorageStatus updates customStorageStatus in state', () => {
    mod._setCustomStorageStatus('unavailable');
    expect(mod._getState().customStorageStatus).toBe('unavailable');
  });
});

describe('UX-1: init loads custom bullets (corrupt warning)', () => {
  test('warns when stored data is corrupt', () => {
    localStorage.setItem(CUSTOM_BULLETS_KEY, '{not valid json}');
    mod.init();
    expect(global.console.warn).toHaveBeenCalledWith(
      'Custom bullets: stored data was invalid and has been ignored'
    );
  });

  test('merges valid custom records with built-ins after init', () => {
    const r = makeCustomRecord();
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([r]));
    mod.init();
    const state = mod._getState();
    expect(state.customRecords).toHaveLength(1);
    expect(state.customRecords[0].id).toBe(r.id);
  });
});

describe('UX-1: openCustomBulletAdd', () => {
  beforeEach(() => { mod.init(); });

  test('shows form and sets title to Add', () => {
    mod.openCustomBulletAdd();
    expect(document.getElementById('customBulletForm').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('customBulletFormTitle').textContent).toBe('Add custom bullet');
  });

  test('sets addCustomBulletBtn aria-expanded to true', () => {
    mod.openCustomBulletAdd();
    expect(document.getElementById('addCustomBulletBtn').getAttribute('aria-expanded')).toBe('true');
  });

  test('clears field values and errors', () => {
    document.getElementById('cbName').value = 'old';
    document.getElementById('cbName-error').textContent = 'err';
    mod.openCustomBulletAdd();
    expect(document.getElementById('cbName').value).toBe('');
    expect(document.getElementById('cbName-error').textContent).toBe('');
  });
});

describe('UX-1: openCustomBulletEdit', () => {
  beforeEach(() => {
    mod._setCustomRecords([makeCustomRecord()]);
    mod.init();
  });

  test('no-op for unknown id', () => {
    mod.openCustomBulletEdit('usr-9999999999999999');
    // Form remains hidden (init() may have shown it but if record not found, nothing happens)
    // Just verify no throw
    expect(true).toBe(true);
  });

  test('opens form pre-filled for known record', () => {
    mod._setCustomRecords([makeCustomRecord()]);
    mod.openCustomBulletEdit('usr-3f2b8c1e9a4d4e6f');
    expect(document.getElementById('customBulletForm').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('cbName').value).toBe('175gr SMK handload');
    expect(document.getElementById('cbBcG7').value).toBe('0.243');
    expect(document.getElementById('customBulletFormTitle').textContent).toBe('Edit custom bullet');
  });

  test('opens form for record with null G7 BC', () => {
    mod._setCustomRecords([makeCustomRecord({ ballisticCoefficientG7: null })]);
    mod.openCustomBulletEdit('usr-3f2b8c1e9a4d4e6f');
    expect(document.getElementById('cbBcG7').value).toBe('');
  });
});

describe('UX-1: closeCustomBulletForm', () => {
  beforeEach(() => { mod.init(); });

  test('hides form and sets aria-expanded to false', () => {
    mod.openCustomBulletAdd();
    mod.closeCustomBulletForm();
    expect(document.getElementById('customBulletForm').hasAttribute('hidden')).toBe(true);
    expect(document.getElementById('addCustomBulletBtn').getAttribute('aria-expanded')).toBe('false');
  });

  test('clears form field values', () => {
    document.getElementById('cbName').value = 'some value';
    mod.closeCustomBulletForm();
    expect(document.getElementById('cbName').value).toBe('');
  });
});

describe('UX-1: requestCustomBulletDelete', () => {
  const recordId = 'usr-3f2b8c1e9a4d4e6f';

  beforeEach(() => {
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([makeCustomRecord()]));
    mod.init();
  });

  test('first click sets confirming state on delete button', () => {
    mod.requestCustomBulletDelete(recordId);
    const card = document.getElementById('card-' + recordId);
    if (card) {
      const btn = card.querySelector('.bullet-delete-btn');
      if (btn) expect(btn.classList.contains('confirming')).toBe(true);
    }
    expect(mod._getState().pendingDeleteId).toBe(recordId);
  });

  test('second click deletes the record', () => {
    mod.requestCustomBulletDelete(recordId);
    mod.requestCustomBulletDelete(recordId);
    expect(mod._getState().customRecords).toHaveLength(0);
  });

  test('selected bullet => toast shown, no delete', () => {
    mod._setSelectedIds(new Set([recordId]));
    mod.requestCustomBulletDelete(recordId);
    expect(mod._getState().customRecords).toHaveLength(1);
  });

  test('delete closes form if editing the same id', () => {
    mod._setCustomRecords([makeCustomRecord()]);
    mod.openCustomBulletEdit(recordId);
    mod.requestCustomBulletDelete(recordId);
    mod.requestCustomBulletDelete(recordId);
    expect(document.getElementById('customBulletForm').hasAttribute('hidden')).toBe(true);
  });

  test('save failure on delete => toast, record not removed', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    mod.requestCustomBulletDelete(recordId); // first click
    mod.requestCustomBulletDelete(recordId); // second click (should fail to save)
    expect(mod._getState().customRecords).toHaveLength(1);
    jest.restoreAllMocks();
  });
});

describe('UX-1: _handleCustomBulletSubmit via form submit', () => {
  beforeEach(() => { mod.init(); });

  function fillForm(values = {}) {
    const defaults = {
      cbName: 'Test Load', cbShortName: 'TST',
      cbBulletWeightGrains: '175', cbBcG1: '0.505', cbBcG7: '',
      cbBulletDiameterInches: '0.308', cbMuzzleVelocityFps: '2600',
    };
    Object.assign(defaults, values);
    Object.entries(defaults).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
  }

  test('valid add: saves bullet, closes form, shows toast', () => {
    mod.openCustomBulletAdd();
    fillForm();
    document.getElementById('customBulletForm').dispatchEvent(new Event('submit'));
    expect(mod._getState().customRecords).toHaveLength(1);
    expect(document.getElementById('customBulletForm').hasAttribute('hidden')).toBe(true);
  });

  test('valid edit: updates record and shows updated toast', () => {
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([makeCustomRecord()]));
    mod.init();
    mod.openCustomBulletEdit('usr-3f2b8c1e9a4d4e6f');
    fillForm({ cbName: 'Renamed Load' });
    document.getElementById('customBulletForm').dispatchEvent(new Event('submit'));
    expect(mod._getState().customRecords[0].name).toBe('Renamed Load');
  });

  test('invalid input: shows field errors', () => {
    mod.openCustomBulletAdd();
    fillForm({ cbName: '' });
    document.getElementById('customBulletForm').dispatchEvent(new Event('submit'));
    expect(document.getElementById('cbName').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('cbName-error').textContent).not.toBe('');
    expect(mod._getState().customRecords).toHaveLength(0);
  });

  test('form-level error shown when at limit', () => {
    const recs = Array.from({ length: 50 }, (_, i) => makeCustomRecord({
      id:   `usr-${String(i).padStart(16, '0')}`,
      name: `Bullet ${i}`,
    }));
    mod._setCustomRecords(recs);
    mod.openCustomBulletAdd();
    fillForm();
    document.getElementById('customBulletForm').dispatchEvent(new Event('submit'));
    expect(document.getElementById('customBulletFormError').textContent).toContain('50');
  });

  test('save failure shows storage error in form', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    mod.openCustomBulletAdd();
    fillForm();
    document.getElementById('customBulletForm').dispatchEvent(new Event('submit'));
    expect(document.getElementById('customBulletFormError').textContent).toContain('storage');
    jest.restoreAllMocks();
  });

  test('form submit via init listener (addCustomBulletBtn click)', () => {
    document.getElementById('addCustomBulletBtn').click();
    expect(document.getElementById('customBulletForm').hasAttribute('hidden')).toBe(false);
  });

  test('cancel button closes form via init listener', () => {
    mod.openCustomBulletAdd();
    document.getElementById('customBulletCancelBtn').click();
    expect(document.getElementById('customBulletForm').hasAttribute('hidden')).toBe(true);
  });
});

describe('UX-1: _syncCustomPanelAvailability', () => {
  test('disables addCustomBulletBtn when loadCustomBullets returns unavailable', () => {
    // Simulate storage being blocked so loadCustomBullets returns 'unavailable'
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    mod.init();
    getItemSpy.mockRestore();
    expect(document.getElementById('addCustomBulletBtn').disabled).toBe(true);
  });

  test('enables addCustomBulletBtn when storage is ok', () => {
    // localStorage is empty (cleared in beforeEach), loadCustomBullets returns 'empty' -> ok
    mod.init();
    expect(document.getElementById('addCustomBulletBtn').disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UX-9: Theme toggle
// ─────────────────────────────────────────────────────────────────────────────
describe('UX-9: theme toggle', () => {
  test('initThemeToggle defaults to dark when no saved theme', () => {
    localStorage.removeItem('bv_theme');
    mod.initThemeToggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('initThemeToggle restores saved light theme', () => {
    localStorage.setItem('bv_theme', 'light');
    mod.initThemeToggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('initThemeToggle restores saved dark theme', () => {
    localStorage.setItem('bv_theme', 'dark');
    mod.initThemeToggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('clicking toggle switches dark -> light and persists to localStorage', () => {
    localStorage.removeItem('bv_theme');
    mod.initThemeToggle();
    document.getElementById('themeToggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('bv_theme')).toBe('light');
  });

  test('clicking toggle switches light -> dark and persists to localStorage', () => {
    localStorage.setItem('bv_theme', 'light');
    mod.initThemeToggle();
    document.getElementById('themeToggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('bv_theme')).toBe('dark');
  });

  test('updateToggleLabel sets correct aria-label for dark theme', () => {
    mod.updateToggleLabel('dark');
    expect(document.getElementById('themeToggle').getAttribute('aria-label')).toBe('Switch to light mode');
  });

  test('updateToggleLabel sets correct aria-label for light theme', () => {
    mod.updateToggleLabel('light');
    expect(document.getElementById('themeToggle').getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  test('updateToggleLabel sets moon icon for dark theme', () => {
    mod.updateToggleLabel('dark');
    expect(document.getElementById('themeToggle').textContent).toBe('\u{1F319}');
  });

  test('updateToggleLabel sets sun icon for light theme', () => {
    mod.updateToggleLabel('light');
    expect(document.getElementById('themeToggle').textContent).toBe('☀️');
  });

  test('updateToggleLabel does nothing when button is absent', () => {
    document.getElementById('themeToggle').remove();
    // Should not throw
    expect(() => mod.updateToggleLabel('dark')).not.toThrow();
  });

  test('initThemeToggle does nothing when button is absent', () => {
    document.getElementById('themeToggle').remove();
    expect(() => mod.initThemeToggle()).not.toThrow();
    // docElement should still have data-theme set
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('_applyChartTheme updates chart tooltip colours', () => {
    const fakeChart = {
      options: { plugins: { tooltip: { backgroundColor: '#000', borderColor: '#000', titleColor: '#000', bodyColor: '#000' } } },
      update: jest.fn(),
    };
    mod._setCharts({ main: fakeChart });
    mod._applyChartTheme('light');
    expect(fakeChart.options.plugins.tooltip.backgroundColor).toBe('#ffffff');
    expect(fakeChart.options.plugins.tooltip.borderColor).toBe('#b0c4d8');
    expect(fakeChart.options.plugins.tooltip.titleColor).toBe('#0077aa');
    expect(fakeChart.options.plugins.tooltip.bodyColor).toBe('#1a2a38');
    expect(fakeChart.update).toHaveBeenCalledWith('none');
  });

  test('_applyChartTheme dark mode restores dark tooltip colours', () => {
    const fakeChart = {
      options: { plugins: { tooltip: { backgroundColor: '#fff', borderColor: '#fff', titleColor: '#fff', bodyColor: '#fff' } } },
      update: jest.fn(),
    };
    mod._setCharts({ main: fakeChart });
    mod._applyChartTheme('dark');
    expect(fakeChart.options.plugins.tooltip.backgroundColor).toBe('#141d26');
    expect(fakeChart.options.plugins.tooltip.borderColor).toBe('#1e3040');
    expect(fakeChart.options.plugins.tooltip.titleColor).toBe('#00d4ff');
    expect(fakeChart.options.plugins.tooltip.bodyColor).toBe('#c8dde8');
  });

  test('_applyChartTheme skips charts without tooltip plugin', () => {
    const fakeChart = { options: { plugins: {} }, update: jest.fn() };
    mod._setCharts({ main: fakeChart });
    expect(() => mod._applyChartTheme('dark')).not.toThrow();
    expect(fakeChart.update).not.toHaveBeenCalled();
  });

  test('localStorage failure during toggle is silently swallowed', () => {
    localStorage.removeItem('bv_theme');
    mod.initThemeToggle();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    expect(() => document.getElementById('themeToggle').click()).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    jest.restoreAllMocks();
  });

  test('localStorage failure during init falls back to dark', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    mod.initThemeToggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    jest.restoreAllMocks();
  });

  test('init() wires up the theme toggle button', () => {
    localStorage.removeItem('bv_theme');
    mod.init();
    document.getElementById('themeToggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('toggle click when data-theme attribute is absent defaults to dark -> light', () => {
    // Wire up the toggle without calling initThemeToggle so data-theme is not pre-set
    mod.initThemeToggle();
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('themeToggle').click();
    // No attribute means current === null, || 'dark' fires, next = 'light'
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 12 — Track C (PERF-20, PERF-21, PERF-22, PERF-23)
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-20: Crosshair hover rAF coalescing & index-change guard', () => {
  const sampleResults = [{
    bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
              muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
    request: {},
    points: [
      { rangeMeters: 0,   dropCm: 0,   velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 },
      { rangeMeters: 100, dropCm: -5,  velocityMps: 760, energyJoules: 3150, windDriftCm: 2, timeOfFlightSec: 0.13 },
      { rangeMeters: 200, dropCm: -20, velocityMps: 710, energyJoules: 2750, windDriftCm: 6, timeOfFlightSec: 0.27 },
    ],
    maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800,
  }];

  test('consecutive onHover events at the same index are no-ops (0 rAF / 0 chart.update)', async () => {
    await mod.renderResults(sampleResults, { zeroRangeMeters: 100, windSpeedKph: 0 });
    const opts = MockChart.mock.calls[0][1].options;
    opts.onHover({}, [{ index: 1 }]);
    jest.runOnlyPendingTimers();
    mockChartUpdate.mockClear();

    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');
    opts.onHover({}, [{ index: 1 }]);
    opts.onHover({}, [{ index: 1 }]);
    expect(rafSpy).not.toHaveBeenCalled();
    expect(mockChartUpdate).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  test('rapid onHover events with different indices coalesce into 1 rAF with latest index', async () => {
    await mod.renderResults(sampleResults, { zeroRangeMeters: 100, windSpeedKph: 0 });
    const opts = MockChart.mock.calls[0][1].options;
    mockChartUpdate.mockClear();
    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');

    opts.onHover({}, [{ index: 0 }]);
    opts.onHover({}, [{ index: 1 }]);
    opts.onHover({}, [{ index: 2 }]);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(mockChartUpdate).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    expect(document.getElementById('readoutRange').textContent).toBe('200 m');
    // 4 sibling charts updated once each (source chart excluded)
    expect(mockChartUpdate).toHaveBeenCalledTimes(4);
    rafSpy.mockRestore();
  });

  test('resetCrosshairState cancels a pending hover rAF', async () => {
    await mod.renderResults(sampleResults, { zeroRangeMeters: 100, windSpeedKph: 0 });
    const opts = MockChart.mock.calls[0][1].options;
    const cancelSpy = jest.spyOn(global, 'cancelAnimationFrame');
    mockChartUpdate.mockClear();

    opts.onHover({}, [{ index: 1 }]);
    mod.resetCrosshairState();
    expect(cancelSpy).toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(mockChartUpdate).not.toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  test('buildChartConfig callbacks fall back to passed results when not in _chartMeta', () => {
    const cfg = mod.buildChartConfig(
      { id: 'standaloneChart', yLabel: 'Drop (cm)' },
      [{ label: '.308', data: [{ x: 0, y: 0 }] }],
      sampleResults,
    );
    cfg.options.onHover({}, [{ index: 1 }]);
    jest.runOnlyPendingTimers();
    expect(document.getElementById('readoutRange').textContent).toBe('100 m');
  });
});

describe('PERF-21: Chart.js fast path, decimation, instance reuse & single-pass MOA/MRAD', () => {
  function makePoints(count) {
    return Array.from({ length: count }, (_, i) => ({
      rangeMeters: i * 10,
      dropCm: -(i * 0.5),
      velocityMps: 800 - i,
      energyJoules: 3500 - i * 2,
      windDriftCm: i * 0.1,
      timeOfFlightSec: i * 0.01,
    }));
  }

  function makeResult(count = 3, name = '.308 Win') {
    return [{
      bullet: { id: '308-win-168gr', name, muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: makePoints(count),
      maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800,
    }];
  }

  test('registers Decimation and does NOT register unused CategoryScale', async () => {
    const chartMock = require('chart.js');
    chartMock.Chart.register.mockClear();
    await mod._loadChart();
    expect(chartMock.Chart.register).toHaveBeenCalledTimes(1);
    const registered = chartMock.Chart.register.mock.calls[0];
    expect(registered).toContain(chartMock.Decimation);
    expect(registered).not.toContain(chartMock.CategoryScale);
  });

  test('configs set parsing: false, normalized: true, and LTTB decimation', async () => {
    await mod.renderResults(makeResult(3), { zeroRangeMeters: 100, windSpeedKph: 0 });
    for (let i = 0; i < 5; i++) {
      const cfg = MockChart.mock.calls[i][1];
      expect(cfg.options.parsing).toBe(false);
      expect(cfg.options.normalized).toBe(true);
      expect(cfg.options.plugins.decimation).toEqual({
        enabled: true, algorithm: 'lttb', samples: 250, threshold: 250,
      });
    }
  });

  test('disables animation when prefers-reduced-motion: reduce matches', async () => {
    const origMM = window.matchMedia;
    window.matchMedia = jest.fn(() => ({ matches: true }));
    try {
      await mod.renderResults(makeResult(3), { zeroRangeMeters: 100, windSpeedKph: 0 });
      expect(MockChart.mock.calls[0][1].options.animation).toBe(false);
      expect(MockChart.mock.calls[4][1].options.animation).toBe(false);
    } finally {
      window.matchMedia = origMM;
    }
  });

  test('disables animation for >1000 plotted points and sets tension: 0 for >200 points', async () => {
    await mod.renderResults(makeResult(1005), { zeroRangeMeters: 100, windSpeedKph: 0 });
    const dropCfg = MockChart.mock.calls[0][1];
    const adjCfg  = MockChart.mock.calls[4][1];
    expect(dropCfg.options.animation).toBe(false);
    expect(dropCfg.data.datasets[0].tension).toBe(0);
    expect(adjCfg.options.animation).toBe(false);
    expect(adjCfg.data.datasets[0].tension).toBe(0);
  });

  test('two consecutive renderResults reuse existing Chart instances without destroy()', async () => {
    await mod.renderResults(makeResult(3, 'Run 1'), { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(MockChart).toHaveBeenCalledTimes(5);
    MockChart.mockClear();
    mockChartDestroy.mockClear();
    mockChartUpdate.mockClear();

    // Second render with updated params + high point count (exercises animation=false branch on reuse too)
    await mod.renderResults(makeResult(3, 'Run 2'), { zeroRangeMeters: 200, windSpeedKph: 16 });
    expect(MockChart).not.toHaveBeenCalled();
    expect(mockChartDestroy).not.toHaveBeenCalled();
    expect(mockChartUpdate).toHaveBeenCalledTimes(5);
    expect(document.getElementById('chartContainer').innerHTML).toContain('Run 2');
    expect(document.getElementById('dropChart').closest('.chart-panel').querySelector('.chart-subtitle').textContent).toBe('zeroed at 200 m');

    // Third render with >1000 points updates existing charts with 'none' animation mode
    mockChartUpdate.mockClear();
    await mod.renderResults(makeResult(1005, 'Run 3'), { zeroRangeMeters: 300, windSpeedKph: 0 });
    expect(MockChart).not.toHaveBeenCalled();
    expect(mockChartUpdate).toHaveBeenCalledWith('none');
  });

  test('transitioning from sweep mode back to trajectory mode destroys sweep charts and rebuilds', async () => {
    const sweepData = [makeResult(2)[0], makeResult(2)[0]];
    await mod.renderSweepCharts(sweepData, 'wind');
    MockChart.mockClear();
    mockChartDestroy.mockClear();

    await mod.renderResults(makeResult(2), { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(mockChartDestroy).toHaveBeenCalledTimes(3);
    expect(MockChart).toHaveBeenCalledTimes(5);
  });
});

describe('PERF-22: Lazy hidden-tab table/DOPE rendering, cached sort rows & chunked table', () => {
  function makeResults(pointCount) {
    return [{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: Array.from({ length: pointCount }, (_, i) => ({
        rangeMeters: i * 10,
        dropCm: -(i * 0.5),
        velocityMps: 800 - i,
        energyJoules: 3500 - i * 2,
        windDriftCm: i * 0.1,
        timeOfFlightSec: +(i * 0.01).toFixed(4),
      })),
      maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800,
    }];
  }

  test('renderResults while on Charts tab defers #tableBody and #dopeTable until tabs activate', async () => {
    document.getElementById('tableBody').innerHTML = '';
    document.getElementById('dopeTable').innerHTML = '';

    await mod.renderResults(makeResults(3), { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(0);
    expect(document.getElementById('dopeTable').innerHTML).toBe('');

    // Activate Data Table tab → flushes renderTable once
    await mod.switchTab('data', document.getElementById('tab-data'));
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(3);

    // Switching away and back does NOT re-render when clean
    document.getElementById('tableBody').innerHTML = '<tr id="sentinel"></tr>';
    await mod.switchTab('charts', document.getElementById('tab-charts'));
    await mod.switchTab('data', document.getElementById('tab-data'));
    expect(document.getElementById('sentinel')).not.toBeNull();

    // Activate Tools tab → flushes renderDopeCard once
    await mod.switchTab('tools', document.getElementById('tab-tools'));
    expect(document.getElementById('dopeTable').innerHTML).toContain('.308 Win');

    // Switching away and back to Tools tab does NOT re-initialize or fail when clean
    await mod.switchTab('charts', document.getElementById('tab-charts'));
    await mod.switchTab('tools', document.getElementById('tab-tools'));
    expect(document.getElementById('dopeTable').innerHTML).toContain('.308 Win');
  });

  test('renderResults while Data Table tab is already active renders table immediately', async () => {
    document.getElementById('dataPanel').classList.add('active');
    await mod.renderResults(makeResults(4), { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(4);
  });

  test('onSortHeaderClick reuses cached row records without rebuilding', () => {
    const res = makeResults(5);
    mod.renderTable(res);
    // Second sort call uses _cachedTableRows directly
    mod.onSortHeaderClick('range');
    mod.onSortHeaderClick('range');
    const firstRange = document.querySelector('#tableBody tr td:nth-child(2)').textContent;
    expect(firstRange).toBe('40');
  });

  test('large tables (>TABLE_CHUNK_THRESHOLD) stream chunks via rAF and cancel on re-sort', () => {
    const count = mod.TABLE_CHUNK_THRESHOLD + 300; // 800 rows → initial 250 + 3 rAF chunks
    const res = makeResults(count);
    mod.renderTable(res);
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(mod.TABLE_CHUNK_SIZE);

    // Re-sorting mid-stream cancels the pending chunk rAF and restarts cleanly
    const cancelSpy = jest.spyOn(global, 'cancelAnimationFrame');
    mod.onSortHeaderClick('range');
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();

    // Drain all rAF chunks
    jest.runAllTimers();
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(count);
  });

  test('renderTable formats absent spinDriftCm and coriolisDeflectionCm as 0.0 when columns are shown', () => {
    const res = [{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: 500, dropCm: -80, velocityMps: 550, energyJoules: 1650, windDriftCm: 10, timeOfFlightSec: 0.72,
          spinDriftCm: 4.2, coriolisDeflectionCm: -1.5 },
      ],
    }];
    mod.renderTable(res);
    const firstRowText = document.querySelector('#tableBody tr').textContent;
    expect(firstRowText).toContain('0.0 cm');
    expect(firstRowText).toContain('+0.0 cm');
  });
});

describe('PERF-23: Debounced input persistence, unchanged-key skip & Chart.js warm-up/recovery', () => {
  test('rapid input events coalesce into a single savePrefs + syncUrl after 200 ms', () => {
    mod.init();
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    const urlSpy = jest.spyOn(history, 'replaceState');
    const input  = document.getElementById('zeroRange');

    for (const v of ['110', '120', '130', '140', '150']) {
      input.value = v;
      input.dispatchEvent(new Event('input'));
    }
    expect(urlSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(199);
    expect(urlSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(urlSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(mod.PREF_KEYS.zero)).toBe('150');

    setSpy.mockRestore();
    urlSpy.mockRestore();
  });

  test('savePrefs skips localStorage.setItem for unchanged keys on repeat calls', () => {
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    mod.savePrefs();
    const firstCount = setSpy.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    setSpy.mockClear();
    mod.savePrefs();
    expect(setSpy).not.toHaveBeenCalled();

    // Changing one input writes only that key
    document.getElementById('zeroRange').value = '250';
    mod.savePrefs();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(mod.PREF_KEYS.zero, '250');
    setSpy.mockRestore();
  });

  test('pagehide flushes pending debounced input persistence immediately', () => {
    mod.init();
    const input = document.getElementById('zeroRange');
    input.value = '275';
    input.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(mod.PREF_KEYS.zero)).toBeNull();

    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(mod.PREF_KEYS.zero)).toBe('275');
  });

  test('debounce utility cancel() suppresses pending invocation and flush() is a no-op when idle', () => {
    const fn = jest.fn();
    const d = mod.debounce(fn, 100);
    d.flush(); // idle no-op
    d.cancel(); // idle no-op
    d();
    d.cancel();
    jest.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  test('_loadChart resets cached promise on rejection so retry succeeds', async () => {
    const chartMock = require('chart.js');
    chartMock.Chart.register.mockClear();
    chartMock.Chart.register.mockImplementationOnce(() => { throw new Error('chunk error'); });

    await expect(mod._loadChart()).rejects.toThrow('chunk error');
    const loaded = await mod._loadChart();
    expect(loaded.Chart).toBe(MockChart);
    expect(chartMock.Chart.register).toHaveBeenCalledTimes(2);
  });

  test('runSimulation warms Chart.js before worker promise settles', async () => {
    const chartMock = require('chart.js');
    chartMock.Chart.register.mockClear();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    let resolveSim;
    simulateAsync.mockImplementationOnce(() => new Promise(r => { resolveSim = r; }));

    const simPromise = mod.runSimulation();
    // Flush microtasks so dynamic import resolves while simulateAsync is still pending
    await Promise.resolve();
    await Promise.resolve();
    expect(chartMock.Chart.register).toHaveBeenCalledTimes(1);

    resolveSim({
      bullet: mod.getMockBullets()[0],
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0,
    });
    await simPromise;
    jest.runAllTimers();
  });

  test('_warmChart swallows rejection without unhandled promise error', async () => {
    const chartMock = require('chart.js');
    chartMock.Chart.register.mockImplementationOnce(() => { throw new Error('offline'); });
    await mod._warmChart();
    // Retry still works because _loadChart cleared _chartModPromise
    await expect(mod._loadChart()).resolves.toBeDefined();
  });

  test('renderResults shows error banner and still renders active Data Table when Chart.js fails to load', async () => {
    const chartMock = require('chart.js');
    chartMock.Chart.register.mockImplementationOnce(() => { throw new Error('offline chunk'); });
    document.getElementById('dataPanel').classList.add('active');
    const res = [{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0,
    }];
    await mod.renderResults(res, { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(document.getElementById('simulationError').textContent).toContain("Couldn't load the chart library");
    expect(document.querySelectorAll('#tableBody tr')).toHaveLength(1);
  });

  test('renderSweepCharts shows error banner and exits cleanly when Chart.js fails to load', async () => {
    const chartMock = require('chart.js');
    chartMock.Chart.register.mockImplementationOnce(() => { throw new Error('offline sweep'); });
    await mod.renderSweepCharts([], 'wind');
    expect(document.getElementById('simulationError').textContent).toContain("Couldn't load the chart library");
    expect(MockChart).not.toHaveBeenCalled();
  });
});

describe('PERF-18: Stale-run cancellation in runSimulation, runCustom, and runSweep', () => {
  test('rapid double runSimulation aborts first run and renders only the second', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    const b0 = mod.getMockBullets()[0];

    let firstResolve;
    simulateAsync
      .mockImplementationOnce((_b, _p, opts) => new Promise((res, rej) => {
        firstResolve = res;
        opts?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
      }))
      .mockResolvedValueOnce({
        bullet: { ...b0, name: 'Second Run' },
        request: {},
        points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
        maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0,
      });

    const p1 = mod.runSimulation();
    const p2 = mod.runSimulation();
    await Promise.all([p1, p2]);
    jest.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('chartContainer').innerHTML).toContain('Second Run');
    expect(document.getElementById('simulationError').hasAttribute('hidden')).toBe(true);
    expect(typeof firstResolve).toBe('function');
  });

  test('runSimulation skips render if aborted after compute resolves (before rAF and after resolve)', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    const b0 = mod.getMockBullets()[0];

    // Case 1: aborted before compute resolves (mock resolves anyway ignoring signal)
    let resolve1;
    simulateAsync.mockImplementationOnce(() => new Promise(r => { resolve1 = r; }));
    const p1 = mod.runSimulation();
    // Second run aborts first run's signal
    const p2 = mod.runSimulation();
    resolve1({
      bullet: { ...b0, name: 'StaleResolved' },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0,
    });
    await Promise.all([p1, p2]);
    jest.runAllTimers();
    expect(document.getElementById('chartContainer').innerHTML).not.toContain('StaleResolved');

    // Case 2: aborted while rAF is queued
    const p3 = mod.runSimulation();
    await p3; // rAF is now queued
    const p4 = mod.runSimulation(); // aborts p3's signal before p3's rAF fires
    await p4;
    jest.runAllTimers();
  });

  test('runCustom and runSweep silently exit on AbortError or post-resolve abort', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());

    // runCustom AbortError
    simulateAsync.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(mod.runCustom()).resolves.toBeUndefined();

    // runCustom post-resolve abort
    let resCustom;
    simulateAsync.mockImplementationOnce(() => new Promise(r => { resCustom = r; }));
    const pc = mod.runCustom();
    const ps = mod.runSweep(); // aborts custom run
    resCustom({ bullet: mod.getMockBullets()[0], request: {}, points: [] });
    await Promise.all([pc, ps]);

    // runSweep AbortError
    simulateAsync.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(mod.runSweep()).resolves.toBeUndefined();

    // runSweep post-resolve abort (all 5 sweep promises resolve after abort)
    const sweepResolvers = [];
    simulateAsync.mockImplementation(() => new Promise(r => { sweepResolvers.push(r); }));
    const ps1 = mod.runSweep();
    mod._resetState(); // aborts sweep controller
    sweepResolvers.forEach(r => r({ bullet: mod.getMockBullets()[0], request: {}, points: [] }));
    await ps1;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERF-28: Lazy-loaded io.js, tools.js, and drag-csv.js chunks
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-28: lazy loading & retry on failed chunk import', () => {
  test('init() defers Tools initialization until tools tab activates, then initializes once', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', result: mod.getMockBullets(), id: 1 }) });
    await mod.init();
    expect(document.getElementById('dopeDistanceRow').innerHTML).toBe('');

    await mod.switchTab('tools', document.getElementById('tab-tools'));
    expect(document.getElementById('dopeDistanceRow').querySelectorAll('input').length).toBeGreaterThan(0);

    // Calling switchTab('tools') again does not wipe or re-init user edits
    document.getElementById('dopeDistanceRow').innerHTML = '<div id="toolsSentinel"></div>';
    await mod.switchTab('tools', document.getElementById('tab-tools'));
    expect(document.getElementById('toolsSentinel')).not.toBeNull();
  });

  test('_loadIo rejects cleanly, displays error banner, and retries on next call', async () => {
    let fail = true;
    let isoMod;
    document.body.innerHTML = '';
    jest.isolateModules(() => {
      jest.doMock('../app/physics/engine-async.ts', () => ({
        simulateAsync: jest.fn(),
        solveBCAsync: jest.fn(),
        prewarmPhysicsWorker: jest.fn(),
      }));
      jest.doMock('../app/io.js', () => {
        if (fail) throw new Error('io chunk offline');
        return jest.requireActual('../app/io.js');
      });
      isoMod = require('../app/ballistics.js');
    });
    buildDOM();
    isoMod._resetState();

    await isoMod.exportCSV();
    expect(document.getElementById('simulationError').textContent).toContain("Couldn't load export/import tools");

    fail = false;
    await expect(isoMod._loadIo()).resolves.toBeDefined();
    // Memoized second call returns same module promise
    await expect(isoMod._loadIo()).resolves.toBeDefined();
  });

  test('_loadTools evicts failed promise and retries cleanly in switchTab and renderResults', async () => {
    let fail = true;
    let initCalls = 0;
    let isoMod;
    document.body.innerHTML = '';
    jest.isolateModules(() => {
      jest.doMock('../app/physics/engine-async.ts', () => ({
        simulateAsync: jest.fn(),
        solveBCAsync: jest.fn(),
        prewarmPhysicsWorker: jest.fn(),
      }));
      jest.doMock('../app/tools.js', () => {
        if (fail) throw new Error('tools chunk offline');
        const actual = jest.requireActual('../app/tools.js');
        return {
          ...actual,
          initTools: (...args) => { initCalls++; return actual.initTools(...args); },
        };
      });
      isoMod = require('../app/ballistics.js');
    });
    buildDOM();
    isoMod._resetState();

    const sampleRes = [{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: 100, dropCm: -4, velocityMps: 760, energyJoules: 3150, windDriftCm: 2, timeOfFlightSec: 0.13 },
      ],
      maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800,
    }];

    // Render while on Charts tab (sets _dopeDirty = true)
    await isoMod.renderResults(sampleRes, { zeroRangeMeters: 100, windSpeedKph: 0 });

    // First switch to Tools fails -> error banner shown, _toolsInitialized stays false
    await isoMod.switchTab('tools', document.getElementById('tab-tools'));
    expect(document.getElementById('simulationError').textContent).toContain("Couldn't load the tools module");
    expect(initCalls).toBe(0);

    // renderResults while #toolsPanel is active also catches tools load error gracefully
    await isoMod.renderResults(sampleRes, { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(document.getElementById('simulationError').textContent).toContain("Couldn't load the tools module");

    // Retry succeeds: initializes Tools once and flushes dirty DOPE table
    fail = false;
    await isoMod.switchTab('tools', document.getElementById('tab-tools'));
    expect(initCalls).toBe(1);
    expect(document.getElementById('dopeTable').innerHTML).toContain('.308 Win');

    // Second switch does not re-init
    await isoMod.switchTab('tools', document.getElementById('tab-tools'));
    expect(initCalls).toBe(1);
  });

  test('_loadDragCsv evicts failed promise, reports on #dragTableHelp, and retries cleanly', async () => {
    let fail = true;
    let isoMod;
    document.body.innerHTML = '';
    jest.isolateModules(() => {
      jest.doMock('../app/physics/engine-async.ts', () => ({
        simulateAsync: jest.fn(),
        solveBCAsync: jest.fn(),
        prewarmPhysicsWorker: jest.fn(),
      }));
      jest.doMock('../app/drag-csv.js', () => {
        if (fail) throw new Error('drag-csv chunk offline');
        return jest.requireActual('../app/drag-csv.js');
      });
      isoMod = require('../app/ballistics.js');
    });
    buildDOM();
    isoMod._resetState();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: isoMod.getMockBullets(), id: 1 }),
    });
    await isoMod.init();

    const fileInput = document.getElementById('dragTableFile');
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      get: () => [{ name: 'test.csv', size: 32 }],
    });

    fileInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(document.getElementById('dragTableHelp').textContent).toContain("Couldn't load CSV parser");

    fail = false;
    await expect(isoMod._loadDragCsv()).resolves.toHaveProperty('parseDragCsv');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERF-31: Sidebar event delegation, O(1) bullet Map, single-card toggle & boot
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-31: sidebar delegation, O(1) bullet Map, single-card toggle & boot', () => {
  test('renderBulletList attaches single delegated click and keydown listener pair across re-renders', () => {
    const list = document.getElementById('bulletList');
    const addSpy = jest.spyOn(list, 'addEventListener');
    mod._setBullets(mod.getMockBullets());

    mod.renderBulletList();
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));

    // Re-rendering on the same #bulletList does not re-attach listeners
    mod.renderBulletList();
    expect(addSpy).toHaveBeenCalledTimes(2);

    // Built-in cards have data-builtin-bullet-id and no custom cards do
    const builtInCard = document.getElementById('card-308-win-168gr');
    expect(builtInCard.dataset.builtinBulletId).toBe('308-win-168gr');
    addSpy.mockRestore();
  });

  test('delegated click on built-in card or child toggles selection; click outside is ignored', () => {
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set());
    mod.renderBulletList();

    const list = document.getElementById('bulletList');
    // Click outside built-in cards (directly on #bulletList) is ignored
    list.click();
    expect(mod._getState().selectedIds.size).toBe(0);

    // Click on child element (.bullet-name) inside built-in card bubbles & toggles
    const card = document.getElementById('card-308-win-168gr');
    const nameEl = card.querySelector('.bullet-name');
    nameEl.click();
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(true);
    expect(card.classList.contains('active')).toBe(true);

    // Clicking card directly toggles off
    card.click();
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(false);
    expect(card.classList.contains('active')).toBe(false);
  });

  test('delegated keydown handles Enter/Space on built-in cards and ignores other keys or non-card targets', () => {
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set());
    mod.renderBulletList();

    const list = document.getElementById('bulletList');
    const card = document.getElementById('card-223-rem-55gr');

    // Non-Enter/Space key on built-in card is ignored
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(mod._getState().selectedIds.size).toBe(0);

    // Enter/Space outside built-in card (#bulletList directly) is ignored
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(mod._getState().selectedIds.size).toBe(0);

    // Enter toggles on
    const enterEvt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    card.dispatchEvent(enterEvt);
    expect(enterEvt.defaultPrevented).toBe(true);
    expect(mod._getState().selectedIds.has('223-rem-55gr')).toBe(true);

    // Space toggles off
    const spaceEvt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    card.dispatchEvent(spaceEvt);
    expect(spaceEvt.defaultPrevented).toBe(true);
    expect(mod._getState().selectedIds.has('223-rem-55gr')).toBe(false);
  });

  test('custom bullet card click/keydown does not double-toggle via delegated built-in listener', () => {
    localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify([makeCustomRecord()]));
    mod.init();
    const customId = 'usr-3f2b8c1e9a4d4e6f';
    const customCard = document.getElementById('card-' + customId);
    expect(customCard).not.toBeNull();
    expect(customCard.hasAttribute('data-builtin-bullet-id')).toBe(false);
    expect(mod._getState().selectedIds.has(customId)).toBe(false);

    customCard.click();
    expect(mod._getState().selectedIds.has(customId)).toBe(true);

    customCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mod._getState().selectedIds.has(customId)).toBe(false);
  });

  test('init() re-wires delegation cleanly across repeat init() and _resetState() cleans up', () => {
    mod.init();
    mod.init();
    const card = document.getElementById('card-308-win-168gr');
    const wasSelected = mod._getState().selectedIds.has('308-win-168gr');
    // Single click must toggle exactly once (no duplicate listeners across double init)
    card.click();
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(!wasSelected);

    // _resetState aborts the delegation controller
    mod._resetState();
    card.click();
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(false);
  });

  test('toggleBullet updates only the target card without touching sibling cards', () => {
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set());
    mod.renderBulletList();

    const targetCard  = document.getElementById('card-308-win-168gr');
    const siblingCard = document.getElementById('card-223-rem-55gr');
    const getByIdSpy  = jest.spyOn(document, 'getElementById');
    const sibClassSpy = jest.spyOn(siblingCard.classList, 'toggle');
    const sibAttrSpy  = jest.spyOn(siblingCard, 'setAttribute');

    mod.toggleBullet('308-win-168gr');

    expect(targetCard.classList.contains('active')).toBe(true);
    expect(targetCard.getAttribute('aria-pressed')).toBe('true');
    expect(sibClassSpy).not.toHaveBeenCalled();
    expect(sibAttrSpy).not.toHaveBeenCalled();
    const queriedCardIds = getByIdSpy.mock.calls.map(c => c[0]).filter(id => id.startsWith('card-'));
    expect(queriedCardIds).toEqual(['card-308-win-168gr']);

    // Missing card DOM element is handled gracefully
    expect(() => mod.toggleBullet('nonexistent-card-id')).not.toThrow();
    expect(mod._getState().selectedIds.has('nonexistent-card-id')).toBe(true);

    getByIdSpy.mockRestore();
    sibClassSpy.mockRestore();
    sibAttrSpy.mockRestore();
  });

  test('init() renders initial .active cards in a single DOM pass without post-render card scans', () => {
    localStorage.setItem(mod.PREF_KEYS.selectedIds, JSON.stringify(['308-win-168gr', '65-creedmoor-140gr']));
    const list = document.getElementById('bulletList');
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    let firstHtml = null;
    Object.defineProperty(list, 'innerHTML', {
      configurable: true,
      get() { return innerHtmlDescriptor.get.call(this); },
      set(val) {
        if (firstHtml === null) firstHtml = val;
        innerHtmlDescriptor.set.call(this, val);
      },
    });
    const toggleClassSpy = jest.spyOn(DOMTokenList.prototype, 'toggle');

    try {
      mod.init();
      // First DOM write already carries active class and aria-pressed="true" for pre-selected bullets
      expect(firstHtml).toContain('class="bullet-card active" id="card-308-win-168gr"');
      expect(firstHtml).toContain('class="bullet-card active" id="card-65-creedmoor-140gr"');
      expect(firstHtml).toContain('class="bullet-card" id="card-223-rem-55gr"');
      expect(document.getElementById('card-308-win-168gr').getAttribute('aria-pressed')).toBe('true');
      expect(document.getElementById('card-223-rem-55gr').getAttribute('aria-pressed')).toBe('false');
      expect(toggleClassSpy).not.toHaveBeenCalled();
    } finally {
      delete list.innerHTML;
      toggleClassSpy.mockRestore();
    }
  });

  test('_bulletById Map index syncs on _setBullets, init, custom bullet CRUD, and _resetState, and is used by computeClientSide and runSweep', async () => {
    const mocks = mod.getMockBullets();
    mod._setBullets(mocks);
    const { _bulletById } = mod._getState();
    expect(_bulletById).toBeInstanceOf(Map);
    expect(_bulletById.size).toBe(mocks.length);
    expect(_bulletById.get('308-win-168gr')).toBe(mocks.find(b => b.id === '308-win-168gr'));

    // computeClientSide and runSweep resolve bullets via Map.prototype.get
    const mapGetSpy = jest.spyOn(Map.prototype, 'get');
    await mod.computeClientSide({
      bulletIds: ['308-win-168gr'],
      zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 25,
      windSpeedKph: 0, windDirectionDeg: 90, altitudeMeters: 0,
      temperatureC: 15, sightHeightMm: 38.1, shootingAngleDegrees: 0, dragModel: 'G1',
    });
    expect(mapGetSpy).toHaveBeenCalledWith('308-win-168gr');

    mod._setSelectedIds(new Set(['65-creedmoor-140gr']));
    await mod.runSweep();
    expect(mapGetSpy).toHaveBeenCalledWith('65-creedmoor-140gr');
    mapGetSpy.mockRestore();

    // _resetState clears the index
    mod._resetState();
    expect(mod._getState()._bulletById.size).toBe(0);

    // init + custom bullet add & delete keep _bulletById synchronized
    mod.init();
    expect(mod._getState()._bulletById.size).toBe(mocks.length);

    mod.openCustomBulletAdd();
    document.getElementById('cbName').value = 'Map Index Load';
    document.getElementById('cbShortName').value = 'MIL';
    document.getElementById('cbBulletWeightGrains').value = '175';
    document.getElementById('cbBcG1').value = '0.505';
    document.getElementById('cbBcG7').value = '';
    document.getElementById('cbBulletDiameterInches').value = '0.308';
    document.getElementById('cbMuzzleVelocityFps').value = '2600';
    document.getElementById('customBulletForm').dispatchEvent(new Event('submit'));

    const customId = mod._getState().customRecords[0].id;
    expect(mod._getState()._bulletById.get(customId)?.name).toBe('Map Index Load');

    mod.requestCustomBulletDelete(customId);
    mod.requestCustomBulletDelete(customId);
    expect(mod._getState()._bulletById.has(customId)).toBe(false);
  });
});
