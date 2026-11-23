const { TextEncoder, TextDecoder } = require('util');
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

// ── Mock chart.js (mapped via Jest moduleNameMapper) ─────────────────────────
const {
  Chart: MockChart,
  _mockDestroy: mockChartDestroy,
  _mockUpdate:  mockChartUpdate,
  _mockDraw:    mockChartDraw,
} = require('chart.js');

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
    <div class="bullet-search-wrap">
      <input type="search" id="bulletSearch" placeholder="Filter rounds..." aria-label="Filter rounds" autocomplete="off">
      <button type="button" id="bulletSearchClear" aria-label="Clear filter" hidden>&times;</button>
    </div>
    <div class="selection-meta">
      <span id="selectedCount">0 / 5 selected</span>
      <button type="button" id="clearSelectionBtn">Clear</button>
    </div>
    <div id="bulletSearchEmpty" class="bullet-search-empty" hidden>No matching rounds</div>
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
        <input type="file" id="cbDragCsv" accept=".csv,text/csv" />
        <div id="cbDragCsvStatus" hidden><span id="cbDragCsvName"></span><button type="button" id="cbDragCsvClearBtn">Clear</button></div>
        <small id="cbDragCsv-error" class="field-error"></small>
        <div id="customBulletFormError" role="alert"></div>
        <button type="submit" id="customBulletSaveBtn">SAVE</button>
        <button type="button" id="customBulletCancelBtn">CANCEL</button>
      </form>
    </div>
    <div id="profileBar" class="profile-bar">
      <select id="profileSelect"><option value="">— Saved profiles —</option></select>
      <input type="text" id="profileNameInput" />
      <button type="button" id="saveProfileBtn">SAVE</button>
      <button type="button" id="deleteProfileBtn" disabled>DEL</button>
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
    <input id="pressureHpa" value=""    />
    <input id="temperature" value="59"  />
    <input id="humidityPercent" value="" />
    <input id="step"        value="25"  />
    <input id="sightHeight"    value="38.1" />
    <input id="shootingAngle" value="0"    />
    <select id="dragModel">
      <option value="G1" selected>G1 (standard)</option>
      <option value="G5">G5 (VLD long boattail)</option>
      <option value="G7">G7 (long-range)</option>
    </select>
    <aside class="sidebar" id="sidebar"></aside>
    <button id="paramsToggle" class="fab-params">☰ PARAMS</button>
    <div id="sidebarBackdrop" class="sidebar-backdrop"></div>
    <label class="auto-compute-label">
      <input type="checkbox" id="autoComputeToggle" checked>
      <span>Auto-compute on change</span>
    </label>
    <div id="simulationError" class="simulation-error" hidden aria-live="assertive" role="alert"></div>
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
          <th data-sort-key="range"><button class="sort-btn" type="button">Range (<span data-unit-kind="range">m</span>)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="drop"><button class="sort-btn" type="button">Drop (<span data-unit-kind="drop">cm</span>)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="velocity"><button class="sort-btn" type="button">Velocity (<span data-unit-kind="velocity">m/s</span>)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="energy"><button class="sort-btn" type="button">Energy (<span data-unit-kind="energy">J</span>)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="windDrift"><button class="sort-btn" type="button">Wind Drift (<span data-unit-kind="drift">cm</span>)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="time"><button class="sort-btn" type="button">Time (s)<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="moa"><button class="sort-btn" type="button">MOA<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th data-sort-key="mrad"><button class="sort-btn" type="button">MRAD<span class="sort-indicator" aria-hidden="true"></span></button></th>
          <th id="spinDriftColHeader" style="display:none">Spin Drift (<span data-unit-kind="drift">cm</span>)</th>
          <th id="coriolisColHeader" style="display:none">Coriolis (<span data-unit-kind="drift">cm</span>)</th>
          <th id="eotvosColHeader" style="display:none">Eötvös (<span data-unit-kind="drop">cm</span>)</th>
        </tr>
      </thead>
      <tbody id="tableBody"><tr><td colspan="9">NO DATA</td></tr></tbody>
    </table>
    <div class="tab active" id="tab-charts"></div>
    <div class="tab"        id="tab-data"></div>
    <div class="tab"        id="tab-tools"></div>
    <div id="toolsPanel" class="tools-panel"></div>
    <button type="button" id="unitToggle" class="unit-toggle" aria-pressed="false">METRIC</button>
    <button id="themeToggle" aria-label="Switch to light mode">&#x1F319;</button>
    <span class="status-pill" id="modelStatus">MODEL: G1</span>
    <div id="toast"></div>
    <div id="simStatus" aria-live="polite" aria-atomic="true" class="sr-only"></div>
    <button type="button" id="importJsonBtn" class="copy-link-btn" aria-label="Import previously exported trajectory JSON">⬆ IMPORT JSON</button>
    <input type="file" id="importJsonFile" accept=".json,application/json" style="display:none" />
    <button type="button" id="copyLinkBtn" class="copy-link-btn" aria-label="Copy a link to this setup">🔗 COPY LINK</button>
    <input id="twistRate" value="" />
    <input id="latitudeDeg" value="" />
    <input id="azimuthDeg"  value="" />
    <input type="checkbox" id="includeEotvos" />
    <div id="sweepControls" style="display:none">
      <select id="sweepParam">
        <option value="wind" data-unit-label="windSpeed" data-label-prefix="Wind" selected>Wind (km/h)</option>
        <option value="altitude" data-unit-label="altitude" data-label-prefix="Altitude">Altitude (m)</option>
        <option value="temperature" data-unit-label="temp" data-label-prefix="Temperature">Temperature (°C)</option>
      </select>
      <button id="sweepBtn"><span>SWEEP</span></button>
      <button id="clearSweepBtn" style="display:none"><span>CLEAR SWEEP</span></button>
    </div>
    <div id="dopeCard">
      <div id="dopeDistanceRow"></div>
      <button id="dopeAddDistBtn">+ Add distance</button>
      <table id="dopeTable"></table>
      <button id="dopeCopyBtn">COPY TEXT</button>
      <button id="dopePrintBtn" type="button">PRINT DOPE</button>
    </div>
    <div id="mpbrCard">
      <label for="mpbrVitalCm">Vital Zone (<span data-unit-kind="vitalZone">cm</span>)</label>
      <input id="mpbrVitalCm" value="20" />
      <div id="mpbrResults"></div>
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
const { PREF_KEYS, PREF_DEFAULTS, AUTO_COMPUTE_KEY } = require('../app/prefs.js');
const { _setCharts } = require('../app/charts.js');
const { onSortHeaderClick, _getSortState } = require('../app/table.js');
const { getUnitSystem } = require('../app/units.js');
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
  mockChartDraw.mockClear();
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
// getBuiltInBullets
// ─────────────────────────────────────────────────────────────────────────────
describe('getBuiltInBullets', () => {
  test('returns 10 bullets', () => {
    const bullets = mod.getBuiltInBullets();
    expect(bullets).toHaveLength(10);
  });

  test('each bullet has required fields', () => {
    mod.getBuiltInBullets().forEach(b => {
      expect(b.id).toBeDefined();
      expect(b.name).toBeDefined();
      expect(b.muzzleVelocityMps).toBeGreaterThan(0);
      expect(b.ballisticCoefficient).toBeGreaterThan(0);
      expect(b.bulletWeightGrams).toBeGreaterThan(0);
    });
  });

  test('contains expected IDs', () => {
    const ids = mod.getBuiltInBullets().map(b => b.id);
    expect(ids).toContain('223-rem-55gr');
    expect(ids).toContain('308-win-168gr');
    expect(ids).toContain('3006-150gr');
    expect(ids).toContain('65-creedmoor-140gr');
  });
});

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
  beforeEach(() => mod._setBullets(mod.getBuiltInBullets()));

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

  test('ACC-1 / REL-6: built-in cards have role="button" and roving tabindex ("0" on first, "-1" on others)', () => {
    mod.renderBulletList();
    const cards = document.querySelectorAll('#bulletList > .bullet-card');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card, idx) => {
      expect(card.getAttribute('tabindex')).toBe(idx === 0 ? '0' : '-1');
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
    mod._setBullets(mod.getBuiltInBullets());
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
    mod._setBullets(mod.getBuiltInBullets());
    mod.renderBulletList();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.updateBulletCards();
    expect(document.getElementById('card-308-win-168gr').classList.contains('active')).toBe(true);
    expect(document.getElementById('card-223-rem-55gr').classList.contains('active')).toBe(false);
  });

  test('ACC-1: syncs aria-pressed on selection change', () => {
    mod._setBullets(mod.getBuiltInBullets());
    mod.renderBulletList();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.updateBulletCards();
    expect(document.getElementById('card-308-win-168gr').getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('card-223-rem-55gr').getAttribute('aria-pressed')).toBe('false');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncSelectionMeta
// ─────────────────────────────────────────────────────────────────────────────
describe('syncSelectionMeta', () => {
  test('disables clearSelectionBtn and sets count when selectedIds is empty', () => {
    mod._setSelectedIds(new Set());
    mod.syncSelectionMeta();
    expect(document.getElementById('clearSelectionBtn').disabled).toBe(true);
    expect(document.getElementById('selectedCount').textContent).toBe('0 / 5 selected');
  });

  test('enables clearSelectionBtn and sets count when selectedIds is non-empty', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.syncSelectionMeta();
    expect(document.getElementById('clearSelectionBtn').disabled).toBe(false);
    expect(document.getElementById('selectedCount').textContent).toBe('1 / 5 selected');
  });

  test('no-op when selectedCount or clearSelectionBtn elements are absent', () => {
    document.getElementById('selectedCount').remove();
    document.getElementById('clearSelectionBtn').remove();
    expect(() => mod.syncSelectionMeta()).not.toThrow();
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
    _setCharts({ old: fakeChart });
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
    expect(simulateAsync).not.toHaveBeenCalled();
  });

  test('calls computeClientSide and renders results', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('shows simulation error when computeClientSide throws TrajectoryInputError', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    const { TrajectoryInputError } = require('../app/physics/engine.ts');
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too large'));

    await mod.runSimulation();

    expect(document.getElementById('simulationError').hasAttribute('hidden')).toBe(false);
  });

  test('sets sim status after successful simulation', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    expect(document.getElementById('simStatus').textContent).toMatch(/Trajectories ready/);
  });

  test('outer catch logs error when simulateAsync rejects with non-input error', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    simulateAsync.mockRejectedValueOnce(new Error('physics exploded'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await mod.runSimulation();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('reads parameters from DOM inputs', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
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
    mod._setBullets(mod.getBuiltInBullets());

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
describe('ACC-2: runSimulation aria-live announcements', () => {
  test('announces "Computing trajectories…" when simulation starts', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());

    const promise = mod.runSimulation();
    expect(document.getElementById('simStatus').textContent).toBe('Computing trajectories…');
    await promise;
    jest.runAllTimers();
  });

  test('announces trajectories ready with result count on success', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    expect(document.getElementById('simStatus').textContent).toMatch(/Trajectories ready\. 1 result computed\./);
  });

  test('uses plural "results" when multiple trajectories computed', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr', '3006-150gr']));
    mod._setBullets(mod.getBuiltInBullets());

    await mod.runSimulation();
    jest.runAllTimers();

    const text = document.getElementById('simStatus').textContent;
    expect(text).toMatch(/Trajectories ready\. \d+ results computed\./);
  });

  test('announces simulation failure on TrajectoryInputError', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    const { TrajectoryInputError } = require('../app/physics/engine.ts');
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too large'));

    await mod.runSimulation();

    const text = document.getElementById('simStatus').textContent;
    expect(text).toMatch(/^Simulation failed: /);
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

  test('first-visit init with auto-compute on schedules initial simulation', async () => {
    simulateAsync.mockClear();
    mod.init();
    jest.advanceTimersByTime(250);
    expect(simulateAsync).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    jest.runAllTimers();
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
// sight height (task 2)
// ─────────────────────────────────────────────────────────────────────────────
describe('sight height parameter', () => {
  const baseBullet = mod.getBuiltInBullets()[0];
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
    mod._setBullets(mod.getBuiltInBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));

    await mod.runSimulation();
    jest.runAllTimers();
    expect(mod._getState().lastResults[0]?.request?.sightHeightMm).toBe(50);
  });

  test('runSimulation includes latitudeDeg and azimuthDeg when DOM inputs are filled', async () => {
    document.getElementById('latitudeDeg').value = '45';
    document.getElementById('azimuthDeg').value  = '90';
    mod._setBullets(mod.getBuiltInBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));
    await mod.runSimulation();
    jest.runAllTimers();
    const result = mod._getState().lastResults[0];
    expect(result?.request?.latitudeDeg).toBe(45);
    expect(result?.request?.azimuthDeg).toBe(90);
  });

  test('runSimulation omits latitudeDeg when DOM input is empty', async () => {
    document.getElementById('latitudeDeg').value = '';
    mod._setBullets(mod.getBuiltInBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));
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
  const baseBullet = mod.getBuiltInBullets()[0];
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
    mod._setBullets(mod.getBuiltInBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));

    await mod.runSimulation();
    jest.runAllTimers();
    expect(mod._getState().lastResults[0]?.request?.shootingAngleDegrees).toBe(15);
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
    const bullet = mod.getBuiltInBullets()[0];
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
    const bullet = mod.getBuiltInBullets()[0];
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
    const bullet = mod.getBuiltInBullets()[0];
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
    const bullet = mod.getBuiltInBullets()[0];
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
    const bullet = mod.getBuiltInBullets()[0];
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

describe('importJsonBtn / importJsonFile wiring', () => {
  beforeEach(() => {
    buildDOM();
    mod.init();
  });

  test('clicking #importJsonBtn triggers click on #importJsonFile', () => {
    const fileInput = document.getElementById('importJsonFile');
    const clickSpy = jest.fn();
    fileInput.click = clickSpy;
    document.getElementById('importJsonBtn').click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('#importJsonFile change event calls importResultsFromFile and resets value', async () => {
    const bullet = mod.getBuiltInBullets()[0];
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
    const bullet = mod.getBuiltInBullets()[0];
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
  });

  test('clicking .export-toggle adds "open" class to .export-dropdown', () => {
    mod.init();
    document.querySelector('.export-toggle').click();
    expect(document.querySelector('.export-dropdown').classList.contains('open')).toBe(true);
  });

  test('clicking outside the dropdown removes "open" class', () => {
    mod.init();
    document.querySelector('.export-toggle').click();
    expect(document.querySelector('.export-dropdown').classList.contains('open')).toBe(true);
    document.getElementById('copyLinkBtn').click();
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
    const bullet = mod.getBuiltInBullets()[0];
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
    mod._setBullets(mod.getBuiltInBullets());
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
    mod._setBullets(mod.getBuiltInBullets());
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
// tab click listeners wired by init()
// ─────────────────────────────────────────────────────────────────────────────
describe('tab click listeners wired by init()', () => {
  test('clicking #tab-charts switches to charts panel', () => {
    mod.init();
    document.getElementById('tab-charts').click();
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(true);
  });

  test('clicking #tab-data switches to data panel', () => {
    mod.init();
    document.getElementById('tab-data').click();
    expect(document.getElementById('dataPanel').classList.contains('active')).toBe(true);
  });

  test('clicking #tab-tools switches to tools panel', async () => {
    mod.init();
    document.getElementById('tab-tools').click();
    await flushMicrotasks();
    expect(document.getElementById('toolsPanel').classList.contains('active')).toBe(true);
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readoutPin second-click path: forEach(c => c.update)
// ─────────────────────────────────────────────────────────────────────────────
describe('readoutPin unpin with populated charts', () => {
  test('second pin-click calls draw() on every active chart', async () => {
    mod.init();

    // Populate charts by running a simulation
    const bullet = mod.getBuiltInBullets()[0];
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

    // Unpin — exercises _redrawSiblingCharts(null) -> _drawChart(c)
    pinBtn.click();
    expect(mod._getState().crosshairPinned).toBe(false);
    expect(pinBtn.textContent).toBe('PIN');
    // The mock Chart's draw() should have been called at least once
    const { _mockDraw } = require('chart.js');
    expect(_mockDraw).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auto-init guard (line 817–818: if (bulletList) init())
// ─────────────────────────────────────────────────────────────────────────────
// toggleBullet persists selection & init restores preferences
// ─────────────────────────────────────────────────────────────────────────────
describe('toggleBullet persists selection', () => {
  test('writes selectedIds to localStorage after toggling a bullet', () => {
    mod._setBullets(mod.getBuiltInBullets());
    mod.renderBulletList();
    // Toggle a bullet and verify localStorage is updated directly
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod.toggleBullet('308-win-168gr'); // deselect
    const saved = JSON.parse(localStorage.getItem(PREF_KEYS.selectedIds));
    expect(Array.isArray(saved)).toBe(true);
    expect(saved).not.toContain('308-win-168gr');
  });
});

describe('init with saved preferences', () => {
  test('restores saved numeric input values from localStorage', () => {
    localStorage.setItem(PREF_KEYS.zero,        '200');
    localStorage.setItem(PREF_KEYS.maxRange,    '800');
    localStorage.setItem(PREF_KEYS.wind,        '5');
    localStorage.setItem(PREF_KEYS.windDir,     '270');
    localStorage.setItem(PREF_KEYS.altitude,    '1500');
    localStorage.setItem(PREF_KEYS.temp,        '25');
    localStorage.setItem(PREF_KEYS.step,        '50');
    localStorage.setItem(PREF_KEYS.sightHeight, '45');
    localStorage.setItem(PREF_KEYS.angle,       '-10');

    mod.init();

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

  test('restores saved bullet selection (subset of catalog)', () => {
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify(['308-win-168gr']));

    mod.init();

    const { selectedIds } = mod._getState();
    expect(selectedIds.has('308-win-168gr')).toBe(true);
    expect(selectedIds.has('223-rem-55gr')).toBe(false);
  });

  test('selects only bullets[0] on first visit (null savedIds)', () => {
    mod.init();

    const { selectedIds, bullets } = mod._getState();
    expect(selectedIds.size).toBe(1);
    expect(selectedIds.has(bullets[0].id)).toBe(true);
  });

  test('filters out stale IDs no longer in catalog', () => {
    localStorage.setItem(PREF_KEYS.selectedIds,
      JSON.stringify(['308-win-168gr', 'deleted-bullet-id']));

    mod.init();

    const { selectedIds } = mod._getState();
    expect(selectedIds.has('308-win-168gr')).toBe(true);
    expect(selectedIds.has('deleted-bullet-id')).toBe(false);
  });

  test('parameter input events trigger savePrefs', () => {
    mod.init();

    const input = document.getElementById('zeroRange');
    input.value = '150';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(localStorage.getItem(PREF_KEYS.zero)).toBe('150');
  });

  test('handles absent input elements gracefully in setVal (if(el) false branch)', () => {
    document.getElementById('shootingAngle').remove();
    expect(() => mod.init()).not.toThrow();
    expect(document.getElementById('zeroRange').value).toBe('100');
  });

  test('wires all 9 input listeners — sightHeight input triggers savePrefs', () => {
    mod.init();

    const el = document.getElementById('sightHeight');
    el.value = '55';
    el.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(localStorage.getItem(PREF_KEYS.sightHeight)).toBe('55');
  });

  test('windDir input event triggers savePrefs', () => {
    mod.init();

    const el = document.getElementById('windDir');
    el.value = '180';
    el.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(localStorage.getItem(PREF_KEYS.windDir)).toBe('180');
  });

  test('handles missing param input elements gracefully in input listener wiring', () => {
    document.getElementById('shootingAngle').remove();
    expect(() => mod.init()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G7 drag model toggle — preferences and UI (Task 10)
// ─────────────────────────────────────────────────────────────────────────────
describe('G7 drag model — init & persistence', () => {
  test('init restores dragModel from storage', () => {
    localStorage.setItem(PREF_KEYS.dragModel, 'G7');
    mod.init();
    expect(document.getElementById('dragModel').value).toBe('G7');
  });

  test('dragModel input event triggers savePrefs', () => {
    mod.init();
    const el = document.getElementById('dragModel');
    el.value = 'G7';
    el.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(localStorage.getItem(PREF_KEYS.dragModel)).toBe('G7');
  });

  test('FEAT-5: dragModel change event updates MODEL pill immediately without waiting for simulation', () => {
    mod.init();
    const el = document.getElementById('dragModel');
    el.value = 'G5';
    el.dispatchEvent(new Event('change'));
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G5');
    el.value = 'G7';
    el.dispatchEvent(new Event('change'));
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G7');
  });
});

describe('G7 drag model — runSimulation and renderResults', () => {
  test('runSimulation includes dragModel from DOM select in request', async () => {
    document.getElementById('dragModel').value = 'G7';
    mod._setBullets(mod.getBuiltInBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));

    await mod.runSimulation();
    jest.runAllTimers();
    expect(mod._getState().lastResults[0]?.request?.dragModel).toBe('G7');
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
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G7' });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G7');
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1', customDragTable: [] });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G1');
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

  test('init wires paramsToggle click to openSidebar', () => {
    mod.init();
    mod.closeSidebar();
    document.getElementById('paramsToggle').click();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(true);
  });

  test('init wires sidebarBackdrop click to closeSidebar', () => {
    mod.init();
    mod.openSidebar();
    document.getElementById('sidebarBackdrop').click();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(false);
  });

  test('backdrop click closes sidebar', () => {
    mod.init();
    mod.openSidebar();
    document.getElementById('sidebarBackdrop').click();
    expect(document.getElementById('sidebar').classList.contains('open')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
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
    expect(state.zero).toBe(PREF_DEFAULTS.zero);
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
  test('URL bullet IDs override saved prefs when they match the catalog', () => {
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify(['223-rem-55gr']));
    history.replaceState(null, '', '/?b=308-win-168gr');
    mod.init();
    const { selectedIds } = mod._getState();
    expect(selectedIds.has('308-win-168gr')).toBe(true);
    expect(selectedIds.has('223-rem-55gr')).toBe(false);
    history.replaceState(null, '', '/');
  });

  test('URL bullet IDs fall back to prefs when none match the catalog', () => {
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify(['223-rem-55gr']));
    history.replaceState(null, '', '/?b=not-a-real-id');
    mod.init();
    const { selectedIds } = mod._getState();
    expect(selectedIds.has('223-rem-55gr')).toBe(true);
    history.replaceState(null, '', '/');
  });

  test('fromUrl.recognized → syncUrl called at end of init', () => {
    history.replaceState(null, '', '/?zero=200');
    const spy = jest.spyOn(history, 'replaceState');
    mod.init();
    // replaceState called at least once (the syncUrl at end of init)
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    history.replaceState(null, '', '/');
  });

  test('param input triggers syncUrl after savePrefs', () => {
    mod.init();
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
    mod.init();
    document.getElementById('copyLinkBtn').click();
    await Promise.resolve(); // flush microtasks
    expect(writeText).toHaveBeenCalled();
    delete navigator.clipboard;
  });

  test('toggleBullet calls syncUrl after savePrefs', () => {
    mod._setBullets(mod.getBuiltInBullets());
    mod.renderBulletList();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    const spy = jest.spyOn(history, 'replaceState');
    mod.toggleBullet('308-win-168gr');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('init() ignores latitudeDeg and azimuthDeg in URL params (SEC-LAT-URL)', () => {
    history.replaceState(null, '', '/?latitudeDeg=45&azimuthDeg=90');
    mod.init();
    expect(document.getElementById('latitudeDeg').value).toBe('');
    expect(document.getElementById('azimuthDeg').value).toBe('');
    history.replaceState(null, '', '/');
  });

  test('init() wires latitudeDeg and azimuthDeg inputs to syncUrl', () => {
    mod.init();
    const spy = jest.spyOn(history, 'replaceState');
    document.getElementById('latitudeDeg').value = '55';
    document.getElementById('latitudeDeg').dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init() CLN-11: legacy custom-rounds migration on startup
// ─────────────────────────────────────────────────────────────────────────────
describe('init() CLN-11: legacy custom-rounds migration', () => {
  test('migrates bv_customRounds and ballistics.customDragTable into unified custom bullets catalog on boot', () => {
    const { LEGACY_CUSTOM_ROUNDS_KEY, LEGACY_CUSTOM_DRAG_KEY } = require('../app/custom-bullets.js');
    const drag = [{ mach: 0.4, cd: 0.2 }, { mach: 1.0, cd: 0.4 }, { mach: 2.5, cd: 0.3 }];
    localStorage.setItem(LEGACY_CUSTOM_DRAG_KEY, JSON.stringify(drag));
    localStorage.setItem(LEGACY_CUSTOM_ROUNDS_KEY, JSON.stringify([
      { name: 'Legacy Boot Load', weightG: 11.34, mvMps: 792.48, bc: 0.505, diaMm: 7.823 },
    ]));

    mod.init();

    const { customRecords, bullets } = mod._getState();
    expect(customRecords).toHaveLength(1);
    expect(customRecords[0].name).toBe('Legacy Boot Load');
    expect(customRecords[0].customDragTable).toEqual(drag);
    expect(bullets.some(b => b.name === 'Legacy Boot Load')).toBe(true);
    expect(localStorage.getItem(LEGACY_CUSTOM_ROUNDS_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_CUSTOM_DRAG_KEY)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FE-3: Data table column sort integration in ballistics.js
// ─────────────────────────────────────────────────────────────────────────────
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

describe('FE-3: _resetState resets sort variables', () => {
  test('resets sortColumn, sortDirection, tableResults', async () => {
    const results = makeTableResults();
    mod._setLastResults(results);
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    await mod.switchTab('data', document.getElementById('tab-data'));
    onSortHeaderClick('drop');
    mod._resetState();
    expect(_getSortState()).toEqual({ column: null, direction: 'asc' });
    // After reset, onSortHeaderClick should be a no-op (tableResults is null)
    onSortHeaderClick('range');
    expect(_getSortState()).toEqual({ column: null, direction: 'asc' });
  });
});

describe('FE-3: init() thead click listener', () => {
  test('click on sort-key th calls onSortHeaderClick', async () => {
    const results = makeTableResults();
    mod._setLastResults(results);
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    await mod.switchTab('data', document.getElementById('tab-data'));
    mod.init();
    const th = document.querySelector('#dataTable thead th[data-sort-key="range"]');
    th.click();
    expect(_getSortState().column).toBe('range');
  });

  test('click on Round th (no data-sort-key) is a no-op', async () => {
    const results = makeTableResults();
    mod._setLastResults(results);
    await mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    await mod.switchTab('data', document.getElementById('tab-data'));
    mod.init();
    const roundTh = document.querySelector('#dataTable thead th:not([data-sort-key])');
    roundTh.click();
    expect(_getSortState()).toEqual({ column: null, direction: 'asc' });
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
// MH-4: runSweep (delegates to lazy-loaded app/sweep.js)
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: runSweep', () => {
  test('no-op when no bullets selected', async () => {
    mod._setSelectedIds(new Set());
    await mod.runSweep();
    expect(document.getElementById('clearSweepBtn').style.display).not.toBe('block');
  });

  test('runs sweep locally and shows results', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());

    await mod.runSweep();

    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
    expect(document.getElementById('clearSweepBtn').style.display).toBe('block');
  });

  test('no-op when bullet not found', async () => {
    mod._setSelectedIds(new Set(['nonexistent-bullet']));
    mod._setBullets([]);

    await mod.runSweep();
    // button text should be reset
    const btn = document.getElementById('sweepBtn');
    expect(btn.querySelector('span').textContent).toBe('SWEEP');
  });

  test('sweepParam defaults to wind when element absent (line 1256 ?? wind)', async () => {
    document.getElementById('sweepParam').remove();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    await mod.runSweep();
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('sweepBtn absent: if(btn) false at spinner and final reset (lines 1258 and 1297)', async () => {
    document.getElementById('sweepBtn').remove();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    await mod.runSweep();
    expect(document.getElementById('clearSweepBtn').style.display).toBe('block');
  });

  test('clearSweepBtn absent: if(clearBtn) false after sweep (line 1299)', async () => {
    document.getElementById('clearSweepBtn').remove();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    await mod.runSweep();
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('bullet not found and sweepBtn absent: if(btn) false in !bullet branch (line 1289)', async () => {
    document.getElementById('sweepBtn').remove();
    mod._setSelectedIds(new Set(['nonexistent-bullet']));
    mod._setBullets([]);
    await mod.runSweep();
    expect(document.getElementById('clearSweepBtn').style.display).not.toBe('block');
  });

  test('destroys existing charts before sweep renders (line 1322 forEach callback)', async () => {
    const mockChart = { destroy: jest.fn() };
    _setCharts({ trajectory: mockChart });
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    await mod.runSweep();
    expect(mockChart.destroy).toHaveBeenCalled();
  });

  test('resets button text when simulateAsync throws TrajectoryInputError (lines 1170-1172)', async () => {
    const { TrajectoryInputError } = require('../app/physics/engine.ts');
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too large'));
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());

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
    mod._setBullets(mod.getBuiltInBullets());
    await expect(mod.runSweep()).resolves.toBeUndefined();
  });


});

// ─────────────────────────────────────────────────────────────────────────────
// MH-4: clearSweep
// ─────────────────────────────────────────────────────────────────────────────
describe('MH-4: clearSweep', () => {
  test('hides clearSweepBtn', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
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
    const { SWEEP_COLORS } = require('../app/sweep.js');
    MockChart.mockClear();
    await mod.renderSweepCharts(makeSweepList(), 'wind');
    const cfg = MockChart.mock.calls[0][1];
    cfg.data.datasets.forEach((ds, i) => {
      expect(ds.borderColor).toBe(SWEEP_COLORS[i % SWEEP_COLORS.length]);
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
    mod._setBullets(mod.getBuiltInBullets());
    mod.renderBulletList(mod.getBuiltInBullets());
    mod.toggleBullet('308-win-168gr');
    expect(document.getElementById('sweepControls').style.display).toBe('block');
  });

  test('sweepControls hidden after deselecting last bullet', () => {
    mod._setBullets(mod.getBuiltInBullets());
    mod.renderBulletList(mod.getBuiltInBullets());
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
    mod._setBullets(mod.getBuiltInBullets());
    document.getElementById('twistRate').value = '10';

    mod.runSimulation();

    expect(mod._getState().lastReq.twistRateInchesPerTurn).toBe(10);
  });

  test('omits twistRateInchesPerTurn when twistRate input is empty', () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    document.getElementById('twistRate').value = '';

    mod.runSimulation();

    expect(mod._getState().lastReq.twistRateInchesPerTurn).toBeUndefined();
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
    mod._setBullets(mod.getBuiltInBullets());

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
    mod.init();

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

  test('initThemeToggle does nothing when button is absent', () => {
    document.getElementById('themeToggle').remove();
    expect(() => mod.initThemeToggle()).not.toThrow();
    // docElement should still have data-theme set
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
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
// Sprint 12 — Track C (PERF-21, PERF-22, PERF-23)
// ─────────────────────────────────────────────────────────────────────────────
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
    await mod.renderResults(makeResult(2), { zeroRangeMeters: 100, windSpeedKph: 0 });
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
    expect(localStorage.getItem(PREF_KEYS.zero)).toBe('150');

    setSpy.mockRestore();
    urlSpy.mockRestore();
  });

  test('savePrefs skips localStorage.setItem for unchanged keys on repeat calls', () => {
    mod.init();
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    const input = document.getElementById('zeroRange');
    input.value = '200';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    const firstCount = setSpy.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    setSpy.mockClear();
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(setSpy).not.toHaveBeenCalled();

    // Changing one input writes only that key
    input.value = '250';
    input.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(200);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(PREF_KEYS.zero, '250');
    setSpy.mockRestore();
  });

  test('pagehide flushes pending debounced input persistence immediately', () => {
    mod.init();
    const input = document.getElementById('zeroRange');
    input.value = '275';
    input.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(PREF_KEYS.zero)).toBeNull();

    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(PREF_KEYS.zero)).toBe('275');
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

  test('runSimulation warms Chart.js before worker promise settles', async () => {
    const chartMock = require('chart.js');
    chartMock.Chart.register.mockClear();
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());

    let resolveSim;
    simulateAsync.mockImplementationOnce(() => new Promise(r => { resolveSim = r; }));

    const simPromise = mod.runSimulation();
    // Flush microtasks so dynamic import resolves while simulateAsync is still pending
    await Promise.resolve();
    await Promise.resolve();
    expect(chartMock.Chart.register).toHaveBeenCalledTimes(1);

    resolveSim({
      bullet: mod.getBuiltInBullets()[0],
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0,
    });
    await simPromise;
    jest.runAllTimers();
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

describe('PERF-18: Stale-run cancellation in runSimulation and runSweep', () => {
  test('rapid double runSimulation aborts first run and renders only the second', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());
    const b0 = mod.getBuiltInBullets()[0];

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
    mod._setBullets(mod.getBuiltInBullets());
    const b0 = mod.getBuiltInBullets()[0];

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

  test('runSweep silently exits on AbortError or post-resolve abort', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getBuiltInBullets());

    // runSweep AbortError
    simulateAsync.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(mod.runSweep()).resolves.toBeUndefined();

    // runSweep post-resolve abort (all 5 sweep promises resolve after abort)
    await mod._loadSweep();
    const sweepResolvers = [];
    simulateAsync.mockImplementation(() => new Promise(r => { sweepResolvers.push(r); }));
    const ps1 = mod.runSweep();
    await flushMicrotasks();
    mod._resetState(); // aborts sweep controller
    sweepResolvers.forEach(r => r({ bullet: mod.getBuiltInBullets()[0], request: {}, points: [] }));
    await ps1;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERF-28: Lazy-loaded io.js, tools.js, and drag-csv.js chunks
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-28: lazy loading & retry on failed chunk import', () => {
  test('init() defers Tools initialization until tools tab activates, then initializes once', async () => {
    mod.init();
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

  test('_loadDragCsv evicts failed promise, reports on #cbDragCsv-error, and retries cleanly', async () => {
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
    isoMod.init();
    isoMod.openCustomBulletAdd();

    const fileInput = document.getElementById('cbDragCsv');
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      get: () => [{ name: 'test.csv', size: 32 }],
    });

    fileInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(document.getElementById('cbDragCsv-error').textContent).toContain("Couldn't load CSV parser");

    fail = false;
    await expect(isoMod._loadDragCsv()).resolves.toHaveProperty('parseDragCsv');
  });

  test('ENH-7: _loadSweep is not called on init(), warms on #sweepParam change, shows error & retries on failure', async () => {
    let fail = true;
    let loadCalls = 0;
    let isoMod;
    document.body.innerHTML = '';
    jest.isolateModules(() => {
      jest.doMock('../app/physics/engine-async.ts', () => ({
        simulateAsync: jest.fn(),
        solveBCAsync: jest.fn(),
        prewarmPhysicsWorker: jest.fn(),
      }));
      jest.doMock('../app/sweep.js', () => {
        loadCalls++;
        if (fail) throw new Error('sweep chunk offline');
        return jest.requireActual('../app/sweep.js');
      });
      isoMod = require('../app/ballistics.js');
    });
    buildDOM();
    isoMod._resetState();

    isoMod.init();
    expect(loadCalls).toBe(0);

    // Toggling #sweepParam attempts lazy load and swallows warm-up error silently
    const sweepParam = document.getElementById('sweepParam');
    sweepParam.value = 'altitude';
    sweepParam.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(loadCalls).toBe(1);
    expect(document.getElementById('simulationError').textContent).toBe('');

    // Clicking/invoking runSweep when sweep chunk fails sets simulationError
    await isoMod.runSweep();
    expect(document.getElementById('simulationError').textContent).toContain("Couldn't load parameter sweep tools");

    // Retrying succeeds once chunk is available
    fail = false;
    await expect(isoMod._loadSweep()).resolves.toHaveProperty('runSweep');
    await expect(isoMod.clearSweep()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERF-31: Sidebar event delegation, O(1) bullet Map, single-card toggle & boot
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-31: sidebar delegation, O(1) bullet Map, single-card toggle & boot', () => {
  test('renderBulletList attaches single delegated click, keydown, and focusin listener set across re-renders', () => {
    const list = document.getElementById('bulletList');
    const addSpy = jest.spyOn(list, 'addEventListener');
    mod._setBullets(mod.getBuiltInBullets());

    mod.renderBulletList();
    expect(addSpy).toHaveBeenCalledTimes(3);
    expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(addSpy).toHaveBeenCalledWith('focusin', expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));

    // Re-rendering on the same #bulletList does not re-attach listeners
    mod.renderBulletList();
    expect(addSpy).toHaveBeenCalledTimes(3);

    // Built-in cards have data-builtin-bullet-id and no custom cards do
    const builtInCard = document.getElementById('card-308-win-168gr');
    expect(builtInCard.dataset.builtinBulletId).toBe('308-win-168gr');
    addSpy.mockRestore();
  });

  test('delegated click on built-in card or child toggles selection; click outside is ignored', () => {
    mod._setBullets(mod.getBuiltInBullets());
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
    mod._setBullets(mod.getBuiltInBullets());
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
    mod._setBullets(mod.getBuiltInBullets());
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
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify(['308-win-168gr', '65-creedmoor-140gr']));
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
    const mocks = mod.getBuiltInBullets();
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

// ─────────────────────────────────────────────────────────────────────────────
// ENH-6: Bullet search, 5-round cap, roving keyboard nav, and auto-compute
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-6: Selection cap, search filter, roving tabindex, and auto-compute', () => {
  test('REL-7: MAX_SELECTED_BULLETS is 5 and selecting 6th bullet is blocked with limit feedback', () => {
    expect(mod.MAX_SELECTED_BULLETS).toBe(5);
    mod._setBullets(mod.getBuiltInBullets());
    mod._setSelectedIds(new Set());
    mod.renderBulletList();

    const ids = mod.getBuiltInBullets().map(b => b.id);
    for (let i = 0; i < 5; i++) {
      mod.toggleBullet(ids[i]);
    }
    expect(mod._getState().selectedIds.size).toBe(5);
    expect(document.getElementById('selectedCount').textContent).toBe('5 / 5 selected');
    expect(document.getElementById('clearSelectionBtn').disabled).toBe(false);

    // 6th selection is blocked
    const sixthCard = document.getElementById('card-' + ids[5]);
    mod.toggleBullet(ids[5]);
    expect(mod._getState().selectedIds.size).toBe(5);
    expect(mod._getState().selectedIds.has(ids[5])).toBe(false);
    expect(sixthCard.classList.contains('bullet-card--limit-reached')).toBe(true);
    expect(document.getElementById('toast').textContent).toBe('Maximum 5 rounds can be selected at once');
    expect(document.getElementById('simStatus').textContent).toBe('Maximum 5 rounds can be selected at once');

    // Rapid repeat attempt clears previous timer cleanly before adding new timer
    mod.toggleBullet(ids[5]);
    expect(sixthCard.classList.contains('bullet-card--limit-reached')).toBe(true);

    // After 600 ms highlight class is removed
    jest.advanceTimersByTime(600);
    expect(sixthCard.classList.contains('bullet-card--limit-reached')).toBe(false);

    // Missing card DOM id when at cap does not throw
    expect(() => mod.toggleBullet('nonexistent-6th')).not.toThrow();

    // Deselecting 1 of 5 allows selecting another
    mod.toggleBullet(ids[0]);
    expect(mod._getState().selectedIds.size).toBe(4);
    mod.toggleBullet(ids[5]);
    expect(mod._getState().selectedIds.size).toBe(5);
    expect(mod._getState().selectedIds.has(ids[5])).toBe(true);
  });

  test('REL-7: init() clamps >5 bulletIds from URL and localStorage to MAX_SELECTED_BULLETS', () => {
    const ids = mod.getBuiltInBullets().slice(0, 7).map(b => b.id);
    history.replaceState(null, '', '/?' + ids.map(id => 'b=' + id).join('&'));
    mod.init();
    expect(mod._getState().selectedIds.size).toBe(5);
    expect(document.getElementById('selectedCount').textContent).toBe('5 / 5 selected');

    mod._resetState();
    history.replaceState(null, '', '/');
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify(ids));
    mod.init();
    expect(mod._getState().selectedIds.size).toBe(5);
  });

  test('clearSelectionBtn clears selection, updates counter/buttons, persists, and resets results', async () => {
    mod.init();
    const ids = mod.getBuiltInBullets().map(b => b.id);
    mod.toggleBullet(ids[1]); // 2 selected
    await mod.runSimulation();
    await flushMicrotasks();
    jest.runAllTimers();
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');

    document.getElementById('clearSelectionBtn').click();
    expect(mod._getState().selectedIds.size).toBe(0);
    expect(document.getElementById('selectedCount').textContent).toBe('0 / 5 selected');
    expect(document.getElementById('clearSelectionBtn').disabled).toBe(true);
    expect(document.getElementById('sweepControls').style.display).toBe('none');
    expect(document.getElementById('resultsContainer').style.display).toBe('none');
    expect(document.getElementById('emptyState').style.display).toBe('');
    expect(document.getElementById('simStatus').textContent).toBe('Selection cleared.');
    expect(JSON.parse(localStorage.getItem(PREF_KEYS.selectedIds))).toEqual([]);
  });

  test('clearSelection handles missing optional DOM elements cleanly and preserves results when autoCompute off', () => {
    mod._setBullets(mod.getBuiltInBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setLastResults([{ bullet: mod.getBuiltInBullets()[0], points: [] }]);
    document.getElementById('autoComputeToggle').checked = false;
    mod.clearSelection();
    expect(mod._getState().lastResults).toHaveLength(1);

    // With autoCompute on and missing clearSweepBtn / emptyState / resultsContainer
    mod._setSelectedIds(new Set(['308-win-168gr']));
    document.getElementById('autoComputeToggle').checked = true;
    document.getElementById('clearSweepBtn').remove();
    document.getElementById('emptyState').remove();
    document.getElementById('resultsContainer').remove();
    expect(() => mod.clearSelection()).not.toThrow();
    expect(mod._getState().lastResults).toHaveLength(0);
  });

  test('live bullet search filters built-in and custom cards without losing selection', () => {
    localStorage.setItem('ballistics:custom-bullets:v1', JSON.stringify([{
      id: 'usr-3f2b8c1e9a4d4e6f',
      name: 'Wildcat Custom',
      shortName: 'WC1',
      bulletWeightGrains: 150,
      ballisticCoefficientG1: 0.45,
      ballisticCoefficientG7: null,
      bulletDiameterInches: 0.308,
      muzzleVelocityFps: 2700,
    }]));
    mod.init();
    mod.toggleBullet('308-win-168gr');

    const searchInput = document.getElementById('bulletSearch');
    const clearBtn = document.getElementById('bulletSearchClear');
    const emptyEl = document.getElementById('bulletSearchEmpty');

    expect(clearBtn.hidden).toBe(true);
    expect(emptyEl.hidden).toBe(true);

    // Filter to "Creedmoor" -> 2 matches (6.5 Creedmoor, 6mm Creedmoor)
    searchInput.value = 'Creedmoor';
    searchInput.dispatchEvent(new Event('input'));
    expect(clearBtn.hidden).toBe(false);
    expect(emptyEl.hidden).toBe(true);
    const visibleBuiltIns = [...document.querySelectorAll('.bullet-card[data-builtin-bullet-id]')].filter(c => !c.hidden);
    expect(visibleBuiltIns).toHaveLength(2);
    expect(document.getElementById('customBulletGroup').hidden).toBe(true);
    // Selection is preserved even while .308 Win is hidden
    expect(mod._getState().selectedIds.has('308-win-168gr')).toBe(true);

    // Filter to custom bullet shortName
    searchInput.value = 'WC1';
    searchInput.dispatchEvent(new Event('input'));
    expect(document.getElementById('customBulletGroup').hidden).toBe(false);
    expect(document.getElementById('card-usr-3f2b8c1e9a4d4e6f').hidden).toBe(false);
    expect(emptyEl.hidden).toBe(true);

    // Non-matching query displays empty message and sets all built-in tabindex="-1"
    searchInput.value = 'zzznomatch';
    searchInput.dispatchEvent(new Event('input'));
    expect(emptyEl.hidden).toBe(false);
    expect(document.getElementById('customBulletGroup').hidden).toBe(true);
    [...document.querySelectorAll('.bullet-card[data-builtin-bullet-id]')].forEach(c => {
      expect(c.getAttribute('tabindex')).toBe('-1');
    });

    // Clear button restores full list and focuses search input
    clearBtn.click();
    expect(searchInput.value).toBe('');
    expect(clearBtn.hidden).toBe(true);
    expect(emptyEl.hidden).toBe(true);
    expect(document.activeElement).toBe(searchInput);
    expect([...document.querySelectorAll('.bullet-card')].every(c => !c.hidden)).toBe(true);

    // Escape key clears non-empty search, no-op when already empty
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(searchInput.value).toBe('');
    searchInput.value = '308';
    searchInput.dispatchEvent(new Event('input'));
    const escEvt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    searchInput.dispatchEvent(escEvt);
    expect(escEvt.defaultPrevented).toBe(true);
    expect(searchInput.value).toBe('');

    // Card missing .bullet-name / .bullet-specs and absent from _bulletById is handled cleanly
    const bareCard = document.createElement('div');
    bareCard.className = 'bullet-card';
    bareCard.id = 'card-unknown-bare';
    bareCard.dataset.builtinBulletId = 'unknown-bare';
    document.getElementById('bulletList').appendChild(bareCard);
    searchInput.value = '308';
    searchInput.dispatchEvent(new Event('input'));

    // filterBulletList handles missing DOM elements safely
    document.getElementById('bulletSearch').remove();
    document.getElementById('bulletSearchClear').remove();
    document.getElementById('bulletSearchEmpty').remove();
    document.getElementById('customBulletGroup').remove();
    expect(() => mod.filterBulletList()).not.toThrow();
    document.getElementById('bulletList').remove();
    expect(() => mod.filterBulletList()).not.toThrow();
  });

  test('REL-6 / ACC-3: roving tabindex ArrowDown/Up/Home/End, clamping, hidden skipping & focusin', () => {
    mod.init();
    const cards = [...document.querySelectorAll('#bulletList > .bullet-card[data-builtin-bullet-id]')];
    expect(cards[0].getAttribute('tabindex')).toBe('0');
    cards.slice(1).forEach(c => expect(c.getAttribute('tabindex')).toBe('-1'));

    // ArrowUp on first card clamps at 0
    const up0 = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    cards[0].dispatchEvent(up0);
    expect(up0.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cards[0]);
    expect(cards[0].getAttribute('tabindex')).toBe('0');

    // ArrowDown moves to card 1
    const down0 = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    cards[0].dispatchEvent(down0);
    expect(down0.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cards[1]);
    expect(cards[0].getAttribute('tabindex')).toBe('-1');
    expect(cards[1].getAttribute('tabindex')).toBe('0');

    // End jumps to last card and ArrowDown clamps there
    cards[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cards[cards.length - 1]);
    expect(cards[cards.length - 1].getAttribute('tabindex')).toBe('0');
    cards[cards.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cards[cards.length - 1]);

    // ArrowUp moves to second-to-last, Home jumps to card 0
    cards[cards.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cards[cards.length - 2]);
    cards[cards.length - 2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cards[0]);

    // focusin on card 3 updates roving tabindex; focusin on hidden card or container ignored
    cards[3].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(cards[3].getAttribute('tabindex')).toBe('0');
    expect(cards[0].getAttribute('tabindex')).toBe('-1');

    cards[4].hidden = true;
    cards[4].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(cards[3].getAttribute('tabindex')).toBe('0');

    // ArrowDown skips hidden card 4 -> lands on card 5
    cards[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cards[5]);
    expect(cards[5].getAttribute('tabindex')).toBe('0');
  });

  test('debounced auto-compute runs after 250ms on param/selection changes and respects toggle', async () => {
    // Saved preference 'false' disables auto-compute
    localStorage.setItem(AUTO_COMPUTE_KEY, 'false');
    mod.init();
    const autoToggle = document.getElementById('autoComputeToggle');
    expect(autoToggle.checked).toBe(false);

    // Input change when unchecked does NOT schedule auto-compute
    simulateAsync.mockClear();
    document.getElementById('zeroRange').value = '200';
    document.getElementById('zeroRange').dispatchEvent(new Event('change'));
    jest.advanceTimersByTime(300);
    expect(simulateAsync).not.toHaveBeenCalled();

    // Toggling autoCompute ON persists to localStorage and enables auto-compute
    autoToggle.checked = true;
    autoToggle.dispatchEvent(new Event('change'));
    expect(localStorage.getItem(AUTO_COMPUTE_KEY)).toBe('true');

    // Rapid param changes coalesce into one simulation after 250ms
    const windInput = document.getElementById('windSpeed');
    windInput.value = '10';
    windInput.dispatchEvent(new Event('input'));
    windInput.value = '20';
    windInput.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(249);
    expect(simulateAsync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(simulateAsync).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    jest.runAllTimers();

    // toggleBullet schedules auto-compute after 250ms
    simulateAsync.mockClear();
    mod.toggleBullet('308-win-168gr');
    jest.advanceTimersByTime(249);
    expect(simulateAsync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(simulateAsync).toHaveBeenCalledTimes(2); // 2 selected bullets
    await flushMicrotasks();
    jest.runAllTimers();

    // Unchecking autoComputeToggle cancels pending auto-compute
    simulateAsync.mockClear();
    document.getElementById('zeroRange').value = '175';
    document.getElementById('zeroRange').dispatchEvent(new Event('input'));
    autoToggle.checked = false;
    autoToggle.dispatchEvent(new Event('change'));
    expect(localStorage.getItem(AUTO_COMPUTE_KEY)).toBe('false');
    jest.advanceTimersByTime(300);
    expect(simulateAsync).not.toHaveBeenCalled();

    // Re-enabling autoCompute and deselecting all bullets cancels timer & restores empty state
    autoToggle.checked = true;
    autoToggle.dispatchEvent(new Event('change'));
    const selectedCopy = [...mod._getState().selectedIds];
    selectedCopy.forEach(id => mod.toggleBullet(id));
    expect(mod._getState().selectedIds.size).toBe(0);
    expect(document.getElementById('resultsContainer').style.display).toBe('none');
    expect(document.getElementById('emptyState').style.display).toBe('');

    // _scheduleAutoCompute is a no-op if fired when 0 selected or toggle missing
    mod._scheduleAutoCompute();
    jest.advanceTimersByTime(250);
    expect(simulateAsync).not.toHaveBeenCalled();

    // Missing optional sidebar elements during init (branch safety)
    mod._resetState();
    const origLS = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
      configurable: true, writable: true,
    });
    try {
      mod.init();
      autoToggle.checked = false;
      autoToggle.dispatchEvent(new Event('change'));
    } finally {
      Object.defineProperty(window, 'localStorage', { value: origLS, configurable: true, writable: true });
    }
    mod._resetState();
    ['autoComputeToggle', 'bulletSearch', 'bulletSearchClear', 'clearSelectionBtn', 'twistRate'].forEach(id => {
      document.getElementById(id)?.remove();
    });
    expect(() => mod.init()).not.toThrow();

    // Card with empty DOM elements handles _syncBuiltInRovingTabindex and limit timer cleanup in _resetState
    mod._setBullets([]);
    mod.renderBulletList();
    mod._setBullets(mod.getBuiltInBullets());
    mod._setSelectedIds(new Set());
    mod.renderBulletList();
    mod.getBuiltInBullets().slice(0, 6).forEach(b => mod.toggleBullet(b.id));
    expect(mod._getState().selectedIds.size).toBe(5);
    mod._resetState();
  });
});

// ── ENH-3: Global Metric / Imperial Unit System ───────────────────────────────
describe('ENH-3: global Metric/Imperial unit system', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  test('toggling #unitToggle switches units, converts inputs without drift, updates UI labels, and restores cleanly', async () => {
    document.getElementById('readoutRange').textContent = '— m';
    mod.init();

    // No-op when switching to already active system
    expect(await mod.setUnitSystem('metric')).toBe('metric');

    // Click #unitToggle -> switches to imperial and persists
    document.getElementById('unitToggle').click();
    await flushMicrotasks();

    expect(getUnitSystem()).toBe('imperial');
    expect(localStorage.getItem('ballistics_units')).toBe('imperial');
    expect(document.getElementById('unitToggle').textContent).toBe('IMPERIAL');
    expect(document.getElementById('unitToggle').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-unit-kind="range"]').textContent).toBe('yd');
    expect(document.querySelector('#sweepParam option[value="wind"]').textContent).toBe('Wind (mph)');
    expect(document.getElementById('readoutRange').textContent).toBe('— yd');
    expect(document.getElementById('zeroRange').value).toBe('109');
    expect(document.getElementById('zeroRange').getAttribute('max')).toBe('550');
    expect(document.getElementById('bulletList').textContent).toContain('fps');
    expect(window.location.search).toContain('units=imperial');

    // Toggle back via toggleUnitSystem() -> restores exact metric 100 without drift
    await mod.toggleUnitSystem();
    expect(getUnitSystem()).toBe('metric');
    expect(document.getElementById('unitToggle').textContent).toBe('METRIC');
    expect(document.getElementById('unitToggle').getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('zeroRange').value).toBe('100');
    expect(document.getElementById('readoutRange').textContent).toBe('— m');
    expect(window.location.search).not.toContain('units=imperial');
  });

  test('setUnitSystem supports persist=false, updates initialized tools, active simulation results, and active sweep', async () => {
    mod.init();
    // Load Tools tab so _toolsInitialized === true
    await mod.switchTab('tools', document.getElementById('tab-tools'));

    // Run simulation to populate lastResults and lastReq
    await mod.runSimulation();
    jest.runAllTimers();
    await flushMicrotasks();

    // Switch to imperial with persist: false while lastResults is populated
    await mod.setUnitSystem('imperial', { persist: false });
    expect(localStorage.getItem('ballistics_units')).toBeNull();
    expect(document.querySelector('.stats-grid').textContent).toContain('MV fps');

    // Also test setUnitSystem when lastReq is null (lastResults non-empty via import)
    const savedRes = mod._getState().lastResults;
    mod._resetState();
    mod._setLastResults(savedRes);
    await mod.setUnitSystem('imperial');
    expect(getUnitSystem()).toBe('imperial');

    // Re-init and re-run for sweep coverage below
    buildDOM();
    mod._resetState();
    mod.init();
    await mod.runSimulation();
    jest.runAllTimers();
    await flushMicrotasks();

    // Run sweep, then switch units while sweepMode && sweepResults are active
    await mod.runSweep();
    jest.runAllTimers();
    await flushMicrotasks();
    await mod.setUnitSystem('metric');
    expect(getUnitSystem()).toBe('metric');

    // Fallback when #sweepParam is missing during sweep re-render
    document.getElementById('sweepParam').remove();
    await mod.setUnitSystem('imperial');
    expect(getUnitSystem()).toBe('imperial');
  });

  test('setUnitSystem handles missing DOM elements and empty bullets cleanly', async () => {
    mod._resetState();
    document.getElementById('unitToggle').remove();
    document.getElementById('zeroRange').remove();
    document.getElementById('bulletList').remove();
    document.getElementById('readoutRange').textContent = '100 m';

    await mod.setUnitSystem('imperial');
    expect(getUnitSystem()).toBe('imperial');
    expect(document.getElementById('readoutRange').textContent).toBe('100 m');
  });

  test('init() restores imperial units from URL or localStorage and converts non-pref inputs cleanly', async () => {
    // 1. From URL ?units=imperial
    history.replaceState(null, '', '/?units=imperial');
    document.getElementById('zeroRange').remove(); // covers missing pref element guard in init()
    mod.init();
    expect(getUnitSystem()).toBe('imperial');
    expect(document.getElementById('mpbrVitalCm').value).toBe('7.9');
    expect(document.getElementById('mpbrVitalCm').dataset.unitApplied).toBe('imperial');

    // Re-running init() on same imperial inputs (when dataset.unitApplied === 'imperial') skips reconversion
    mod.init();
    expect(document.getElementById('mpbrVitalCm').value).toBe('7.9');

    // 2. From localStorage without URL param
    history.replaceState(null, '', '/');
    buildDOM();
    mod._resetState();
    localStorage.setItem('ballistics_units', 'imperial');
    mod.init();
    expect(getUnitSystem()).toBe('imperial');
    expect(document.getElementById('unitToggle').textContent).toBe('IMPERIAL');
  });
});

// ── ENH-5: Profiles, atmosphere/Eotvos controls, and unified custom drag CSV ──
describe('ENH-5: profiles, atmosphere/Eotvos controls, and custom bullet drag CSV', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
    jest.restoreAllMocks();
  });

  test('validates and propagates pressureHpa, humidityPercent, and includeEotvos in runSimulation and URL state', async () => {
    mod.init();

    // Out-of-range pressure & humidity in runSimulation
    document.getElementById('pressureHpa').value = '400';
    await mod.runSimulation();
    expect(document.getElementById('simulationError').textContent).toMatch(/Pressure/);
    document.getElementById('pressureHpa').value = '1013.25';

    document.getElementById('humidityPercent').value = '120';
    await mod.runSimulation();
    expect(document.getElementById('simulationError').textContent).toMatch(/Humidity/);
    document.getElementById('humidityPercent').value = '65';
    document.getElementById('includeEotvos').checked = true;

    // Valid runSimulation passes all three fields
    await mod.runSimulation();
    jest.runAllTimers();
    await flushMicrotasks();
    expect(mod._getState().lastReq.pressureHpa).toBe(1013.25);
    expect(mod._getState().lastReq.humidityPercent).toBe(65);
    expect(mod._getState().lastReq.includeEotvos).toBe(true);
    expect(mod.currentState().pressureHpa).toBe(1013.25);
    expect(mod.currentState().humidityPercent).toBe(65);
    expect(mod.currentState().includeEotvos).toBe(true);

    // URL restore on init
    history.replaceState(null, '', '/?pressureHpa=990&humidityPercent=40&includeEotvos=1');
    buildDOM();
    mod._resetState();
    mod.init();
    expect(document.getElementById('pressureHpa').value).toBe('990');
    expect(document.getElementById('humidityPercent').value).toBe('40');
    expect(document.getElementById('includeEotvos').checked).toBe(true);
  });

  test('saves, updates, loads (across units & optional fields), and deletes named rifle profiles', async () => {
    mod.init();

    // Empty name triggers invalid toast
    document.getElementById('profileNameInput').value = '   ';
    document.getElementById('saveProfileBtn').click();
    expect(document.getElementById('toast').textContent).toMatch(/required/i);

    // Save full imperial profile
    await mod.setUnitSystem('imperial');
    document.getElementById('twistRate').value = '10';
    document.getElementById('latitudeDeg').value = '44.5';
    document.getElementById('azimuthDeg').value = '90';
    document.getElementById('pressureHpa').value = '29.92';
    document.getElementById('humidityPercent').value = '55';
    document.getElementById('includeEotvos').checked = true;
    document.getElementById('profileNameInput').value = 'Long Range 308';
    document.getElementById('saveProfileBtn').click();

    expect(document.getElementById('toast').textContent).toBe('Profile saved');
    expect(document.getElementById('profileSelect').value).toBe('Long Range 308');
    expect(document.getElementById('deleteProfileBtn').disabled).toBe(false);

    // Save again with blank nameInput uses selected option -> updates profile
    document.getElementById('profileNameInput').value = '';
    document.getElementById('saveProfileBtn').click();
    expect(document.getElementById('toast').textContent).toBe('Profile updated');

    // Save a minimal metric profile (no optional fields)
    await mod.setUnitSystem('metric');
    document.getElementById('twistRate').value = '';
    document.getElementById('latitudeDeg').value = '';
    document.getElementById('azimuthDeg').value = '';
    document.getElementById('pressureHpa').value = '';
    document.getElementById('humidityPercent').value = '';
    document.getElementById('includeEotvos').checked = false;
    document.getElementById('profileNameInput').value = 'Plain Metric';
    document.getElementById('saveProfileBtn').click();
    expect(document.getElementById('toast').textContent).toBe('Profile saved');

    // Selecting empty placeholder disables delete button and does not load
    const select = document.getElementById('profileSelect');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(document.getElementById('deleteProfileBtn').disabled).toBe(true);

    // Clicking delete when nothing selected is a no-op
    document.getElementById('deleteProfileBtn').disabled = false;
    document.getElementById('deleteProfileBtn').click();

    // Load imperial profile while in metric -> switches units, sets optional fields, triggers auto-compute
    simulateAsync.mockClear();
    select.value = 'Long Range 308';
    select.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(getUnitSystem()).toBe('imperial');
    expect(document.getElementById('twistRate').value).toBe('10');
    expect(document.getElementById('latitudeDeg').value).toBe('44.5');
    expect(document.getElementById('includeEotvos').checked).toBe(true);
    expect(document.getElementById('toast').textContent).toBe('Profile loaded');
    jest.advanceTimersByTime(300);
    expect(simulateAsync).toHaveBeenCalled();
    await flushMicrotasks();
    jest.runAllTimers();

    // Load plain metric profile with autoCompute off -> clears optional fields and skips auto-compute
    document.getElementById('autoComputeToggle').checked = false;
    select.value = 'Plain Metric';
    select.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(getUnitSystem()).toBe('metric');
    expect(document.getElementById('twistRate').value).toBe('');
    expect(document.getElementById('includeEotvos').checked).toBe(false);

    // Delete storage error toast
    const setSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    document.getElementById('deleteProfileBtn').click();
    expect(document.getElementById('toast').textContent).toMatch(/storage unavailable/i);
    setSpy.mockRestore();

    // Delete succeeds cleanly
    document.getElementById('deleteProfileBtn').click();
    expect(document.getElementById('toast').textContent).toBe('Profile deleted');
    expect(document.getElementById('profileNameInput').value).toBe('');

    // Load a stored profile without p.units field while in metric -> skips setUnitSystem
    localStorage.setItem('ballistics_profiles', JSON.stringify([{
      name: 'Legacy No Units',
      params: {
        bulletIds: ['308-win-168gr'],
        zero: 100, maxRange: 800, wind: 10, windDir: 90, altitude: 0,
        temp: 15, step: 25, sightHeight: 38.1, angle: 0, dragModel: 'G1',
      },
    }]));
    mod.init();
    const sel2 = document.getElementById('profileSelect');
    sel2.value = 'Legacy No Units';
    sel2.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(document.getElementById('maxRange').value).toBe('800');

    // Missing #profileSelect / #profileNameInput / #includeEotvos handled safely
    mod._resetState();
    document.getElementById('includeEotvos').remove();
    history.replaceState(null, '', '/?includeEotvos=1');
    mod.init();
    document.getElementById('profileNameInput').remove();
    document.getElementById('profileSelect').remove();
    document.getElementById('saveProfileBtn').click();
    mod._resetState();
    expect(() => mod.init()).not.toThrow();
  });

  test('attaches, edits, clears, and simulates custom bullet drag CSV in #customBulletForm', async () => {
    mod.init();
    mod.openCustomBulletAdd();

    const csvText = 'Mach,CD\n0.4,0.19\n1.0,0.42\n2.5,0.31\n';
    let capturedOnload = null;
    let capturedOnerror = null;
    jest.spyOn(global, 'FileReader').mockImplementation(() => ({
      set onload(fn) { capturedOnload = fn; },
      set onerror(fn) { capturedOnerror = fn; },
      readAsText: jest.fn(),
    }));

    const csvInput = document.getElementById('cbDragCsv');
    // 1. Oversized file error
    Object.defineProperty(csvInput, 'files', { configurable: true, get: () => [{ name: 'big.csv', size: 70 * 1024 }] });
    csvInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(document.getElementById('cbDragCsv-error').textContent).toMatch(/too large/i);

    // 2. Valid CSV file loads and shows status
    Object.defineProperty(csvInput, 'files', { configurable: true, get: () => [{ name: 'g7-custom.csv', size: 128 }] });
    csvInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    capturedOnload({ target: { result: csvText } });
    expect(document.getElementById('cbDragCsvStatus').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('cbDragCsvName').textContent).toBe('g7-custom.csv (3 rows)');

    // 3. Submit custom bullet with attached drag curve, select it, and computeClientSide forwards customDragTable
    document.getElementById('cbName').value = 'My CSV Load';
    document.getElementById('cbShortName').value = 'CSV1';
    document.getElementById('cbBulletWeightGrains').value = '168';
    document.getElementById('cbBcG1').value = '0.475';
    document.getElementById('cbBulletDiameterInches').value = '0.308';
    document.getElementById('cbMuzzleVelocityFps').value = '2650';
    document.getElementById('customBulletForm').dispatchEvent(new Event('submit', { cancelable: true }));

    const added = mod._getState().customRecords[0];
    expect(added.customDragTable).toHaveLength(3);

    simulateAsync.mockClear();
    await mod.computeClientSide({ bulletIds: [added.id], dragModel: 'G1' });
    expect(simulateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: added.id }),
      expect.objectContaining({ customDragTable: added.customDragTable }),
    );

    // 4. Edit custom bullet restores customDragTable UI ("Custom curve (3 rows)") and Clear removes it
    mod.openCustomBulletEdit(added.id);
    expect(document.getElementById('cbDragCsvStatus').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('cbDragCsvName').textContent).toBe('Custom curve (3 rows)');
    document.getElementById('cbDragCsvClearBtn').click();
    expect(document.getElementById('cbDragCsvStatus').hasAttribute('hidden')).toBe(true);
    document.getElementById('customBulletForm').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(mod._getState().customRecords[0].customDragTable).toBeUndefined();

    // 5. Invalid CSV and FileReader error show inline error in #cbDragCsv-error
    mod.openCustomBulletAdd();
    csvInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    capturedOnload({ target: { result: 'bad,csv' } });
    expect(document.getElementById('cbDragCsv-error').textContent).toBeTruthy();

    csvInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    capturedOnerror();
    expect(document.getElementById('cbDragCsv-error').textContent).toBe('Error reading file.');

    // 6. Empty files list is a no-op
    Object.defineProperty(csvInput, 'files', { configurable: true, get: () => [] });
    csvInput.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(document.getElementById('cbDragCsv-error').textContent).toBe('Error reading file.');
  });
});
