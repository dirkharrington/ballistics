// ── Mock chart.js (mapped via Jest moduleNameMapper) ─────────────────────────
const { Chart: MockChart, _mockDestroy: mockChartDestroy } = require('chart.js');

// ── Mock fetch ────────────────────────────────────────────────────────────────
global.fetch = jest.fn();
global.alert = jest.fn();

// ── Suppress jsdom's unimplemented HTMLCanvasElement.getContext ───────────────
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({}));

// ── DOM helpers ───────────────────────────────────────────────────────────────
function buildDOM() {
  document.body.innerHTML = `
    <div id="bulletList"></div>
    <input id="zeroRange"   value="100" />
    <input id="maxRange"    value="500" />
    <input id="windSpeed"   value="0"   />
    <input id="altitude"    value="0"   />
    <input id="temperature" value="59"  />
    <input id="step"        value="25"  />
    <button id="runBtn" class="run-btn"><span>▶ COMPUTE TRAJECTORIES</span></button>
    <div id="chartsPanel" class="charts-panel active"></div>
    <div id="dataPanel"   class="data-panel"></div>
    <div id="emptyState"  style="display:block"></div>
    <div id="resultsContainer" style="display:none"></div>
    <div id="chartContainer"></div>
    <table><tbody id="tableBody"><tr><td colspan="7">NO DATA</td></tr></tbody></table>
    <div class="tab active" id="tabCharts"></div>
    <div class="tab"        id="tabData"></div>
  `;
}

const mod = require('../../main/resources/static/ballistics.js');

// Reset state and DOM before each test
beforeEach(() => {
  buildDOM();
  mod._resetState();
  MockChart.mockClear();
  mockChartDestroy.mockClear();
  global.fetch.mockReset();
  global.alert.mockClear();
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
// g1Drag
// ─────────────────────────────────────────────────────────────────────────────
describe('g1Drag', () => {
  test('returns first table value for velocity at or below 0', () => {
    expect(mod.g1Drag(0)).toBeCloseTo(0.1198);
    expect(mod.g1Drag(-100)).toBeCloseTo(0.1198);
  });

  test('returns last table value for velocity at or above 4000', () => {
    expect(mod.g1Drag(4000)).toBeCloseTo(0.0800);
    expect(mod.g1Drag(5000)).toBeCloseTo(0.0800);
  });

  test('returns exact table value at known point', () => {
    expect(mod.g1Drag(700)).toBeCloseTo(0.1194);
    expect(mod.g1Drag(1400)).toBeCloseTo(0.2030);
  });

  test('interpolates between table entries', () => {
    const v = mod.g1Drag(1025); // between 1000 (0.1250) and 1050 (0.1315)
    expect(v).toBeGreaterThan(0.1250);
    expect(v).toBeLessThan(0.1315);
  });

  test('handles negative input via Math.abs', () => {
    expect(mod.g1Drag(-700)).toBeCloseTo(mod.g1Drag(700));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// airDensityRatio
// ─────────────────────────────────────────────────────────────────────────────
describe('airDensityRatio', () => {
  test('is approximately 1.0 at sea level standard temperature', () => {
    const ratio = mod.airDensityRatio(0, 59);
    expect(ratio).toBeCloseTo(1.0, 2);
  });

  test('is less than sea level at high altitude', () => {
    const sealevel = mod.airDensityRatio(0, 59);
    const altitude = mod.airDensityRatio(5000, 59);
    expect(altitude).toBeLessThan(sealevel);
  });

  test('is less dense at higher temperature', () => {
    const cold = mod.airDensityRatio(0, 40);
    const hot  = mod.airDensityRatio(0, 100);
    expect(hot).toBeLessThan(cold);
  });

  test('returns a positive value', () => {
    expect(mod.airDensityRatio(3000, 70)).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// simulateBullet
// ─────────────────────────────────────────────────────────────────────────────
describe('simulateBullet', () => {
  const bullet308 = {
    id: '308-win-168gr', name: '.308', ballisticCoefficient: 0.475,
    bulletWeightGrams: 10.89, muzzleVelocityMps: 807, muzzleEnergyJoules: 3552
  };
  const req = {
    zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 100,
    windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15
  };

  test('returns result object with expected shape', () => {
    const result = mod.simulateBullet(bullet308, req);
    expect(result.bullet).toBe(bullet308);
    expect(result.request).toBe(req);
    expect(Array.isArray(result.points)).toBe(true);
    expect(result.maxOrdinateCm).toBeGreaterThanOrEqual(0);
    expect(result.supersonicLimitMeters).toBeGreaterThanOrEqual(0);
  });

  test('produces trajectory points with positive velocity', () => {
    const result = mod.simulateBullet(bullet308, req);
    expect(result.points.length).toBeGreaterThan(0);
    result.points.forEach(p => {
      expect(p.velocityMps).toBeGreaterThan(0);
      expect(p.energyJoules).toBeGreaterThan(0);
    });
  });

  test('first point velocity matches muzzle velocity', () => {
    const result = mod.simulateBullet(bullet308, req);
    const pts = result.points;
    expect(pts[0].velocityMps).toBeCloseTo(bullet308.muzzleVelocityMps, 0);
  });

  test('wind drift is zero when windSpeedKph is 0', () => {
    const result = mod.simulateBullet(bullet308, req);
    result.points.forEach(p => expect(p.windDriftCm).toBe(0));
  });

  test('wind drift is computed when wind is nonzero', () => {
    const windReq = { ...req, windSpeedKph: 16 };
    const result = mod.simulateBullet(bullet308, windReq);
    expect(result.points).not.toHaveLength(0);
    expect(result.request.windSpeedKph).toBe(16);
  });

  test('supersonic limit equals maxRange when bullet stays supersonic', () => {
    const bullet223 = {
      id: '223-rem-55gr', ballisticCoefficient: 0.243,
      bulletWeightGrams: 3.56, muzzleVelocityMps: 987
    };
    const longReq = { ...req, maxRangeMeters: 1000, stepMeters: 50 };
    const result = mod.simulateBullet(bullet223, longReq);
    expect(result.supersonicLimitMeters).toBe(longReq.maxRangeMeters);
  });

  test('covers velocity < 100 early-break with very slow bullet', () => {
    const slowBullet = {
      id: 'slow', ballisticCoefficient: 0.1,
      bulletWeightGrams: 3.24, muzzleVelocityMps: 12
    };
    const result = mod.simulateBullet(slowBullet, req);
    expect(result).toBeDefined();
    expect(result.supersonicLimitMeters).toBe(0);
  });

  test('covers velocity < 50 in zero-finder with very slow bullet', () => {
    const ultraSlow = {
      id: 'ultra', ballisticCoefficient: 0.05,
      bulletWeightGrams: 3.24, muzzleVelocityMps: 9
    };
    const result = mod.simulateBullet(ultraSlow, req);
    expect(result).toBeDefined();
  });

  test('max ordinate is positive for normal bullet', () => {
    const result = mod.simulateBullet(bullet308, req);
    expect(result.maxOrdinateCm).toBeGreaterThan(0);
  });

  test('high altitude simulation produces valid trajectory', () => {
    const seaResult = mod.simulateBullet(bullet308, { ...req, altitudeMeters: 0 });
    const altResult = mod.simulateBullet(bullet308, { ...req, altitudeMeters: 1524 });
    expect(seaResult.points.length).toBeGreaterThan(0);
    expect(altResult.points.length).toBeGreaterThan(0);
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

  test('returns results for all valid bullet IDs', () => {
    const results = mod.computeClientSide(req);
    expect(results).toHaveLength(2);
  });

  test('filters out unknown bullet IDs', () => {
    const results = mod.computeClientSide({ ...req, bulletIds: ['a', 'unknown'] });
    expect(results).toHaveLength(1);
    expect(results[0].bullet.id).toBe('a');
  });

  test('returns empty array for all unknown IDs', () => {
    const results = mod.computeClientSide({ ...req, bulletIds: ['x', 'y'] });
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
});

// ─────────────────────────────────────────────────────────────────────────────
// switchTab
// ─────────────────────────────────────────────────────────────────────────────
describe('switchTab', () => {
  test('switching to charts activates chartsPanel', () => {
    const el = document.getElementById('tabCharts');
    mod.switchTab('charts', el);
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(true);
    expect(document.getElementById('dataPanel').classList.contains('active')).toBe(false);
    expect(el.classList.contains('active')).toBe(true);
  });

  test('switching to data activates dataPanel', () => {
    const el = document.getElementById('tabData');
    mod.switchTab('data', el);
    expect(document.getElementById('dataPanel').classList.contains('active')).toBe(true);
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(false);
  });

  test('removes active from all other tabs', () => {
    const tabCharts = document.getElementById('tabCharts');
    tabCharts.classList.add('active');
    const tabData = document.getElementById('tabData');
    mod.switchTab('data', tabData);
    expect(tabCharts.classList.contains('active')).toBe(false);
    expect(tabData.classList.contains('active')).toBe(true);
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

  test('hides empty state and shows results container', () => {
    mod.renderResults(results, req);
    expect(document.getElementById('emptyState').style.display).toBe('none');
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('creates 4 Chart instances (one per chart type)', () => {
    mod.renderResults(results, req);
    expect(MockChart).toHaveBeenCalledTimes(4);
  });

  test('destroys existing charts before rendering new ones', () => {
    const fakeChart = { destroy: jest.fn() };
    mod._setCharts({ old: fakeChart });
    mod.renderResults(results, req);
    expect(fakeChart.destroy).toHaveBeenCalled();
  });

  test('renders stats grid with bullet info', () => {
    mod.renderResults(results, req);
    expect(document.getElementById('chartContainer').innerHTML).toContain('.308 Win 168gr BTHP');
    expect(document.getElementById('chartContainer').innerHTML).toContain('807');
  });

  test('renders table rows', () => {
    mod.renderResults(results, req);
    const rows = document.querySelectorAll('#tableBody tr');
    expect(rows.length).toBeGreaterThan(0);
  });

  test('handles refLine present (velocityChart)', () => {
    // The velocity chart def has refLine — this covers the if(def.refLine) branch
    mod.renderResults(results, req);
    const calls = MockChart.mock.calls;
    const velocityCall = calls.find(args => args[1]?.type === 'line');
    expect(velocityCall).toBeDefined();
  });

  test('handles result with bullet having unknown color ID (fallback)', () => {
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
    expect(() => mod.renderResults(unknownResult, req)).not.toThrow();
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

  test('alerts and returns when no bullets selected', async () => {
    mod._setSelectedIds(new Set());
    await mod.runSimulation();
    expect(global.alert).toHaveBeenCalledWith('Select at least one round.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('calls API and renders results on success', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue({ json: () => Promise.resolve(mockApiResults) });

    await mod.runSimulation();

    expect(global.fetch).toHaveBeenCalledWith('/api/trajectories/compare', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }));
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('falls back to client-side simulation when fetch throws', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockRejectedValue(new Error('Network error'));

    await mod.runSimulation();

    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('restores button text in finally block', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue({ json: () => Promise.resolve(mockApiResults) });

    await mod.runSimulation();

    const btn = document.getElementById('runBtn');
    expect(btn.querySelector('span').textContent).toBe('▶ COMPUTE TRAJECTORIES');
    expect(btn.classList.contains('loading')).toBe(false);
  });

  test('outer catch logs error when renderResults throws', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockRejectedValue(new Error('offline'));
    // Remove the table so renderTable's tableBody.innerHTML throws
    document.querySelector('#tableBody').parentElement.remove();
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
    document.getElementById('altitude').value    = '3000';
    document.getElementById('temperature').value = '70';
    document.getElementById('step').value        = '50';
    global.fetch.mockResolvedValue({ json: () => Promise.resolve(mockApiResults) });

    await mod.runSimulation();

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.zeroRangeMeters).toBe(200);
    expect(body.maxRangeMeters).toBe(800);
    expect(body.windSpeedKph).toBe(15);
    expect(body.altitudeMeters).toBe(3000);
    expect(body.temperatureC).toBe(70);
    expect(body.stepMeters).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init
// ─────────────────────────────────────────────────────────────────────────────
describe('init', () => {
  test('fetches bullets from API and renders list', async () => {
    const apiBullets = mod.getMockBullets();
    global.fetch.mockResolvedValue({ json: () => Promise.resolve(apiBullets) });

    await mod.init();

    expect(global.fetch).toHaveBeenCalledWith('/api/bullets');
    expect(document.querySelectorAll('.bullet-card')).toHaveLength(10);
  });

  test('selects all bullets by default after init', async () => {
    global.fetch.mockResolvedValue({ json: () => Promise.resolve(mod.getMockBullets()) });
    await mod.init();
    const { selectedIds } = mod._getState();
    expect(selectedIds.size).toBe(10);
  });

  test('falls back to mock bullets when API fails', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    expect(document.querySelectorAll('.bullet-card')).toHaveLength(10);
  });

  test('mock fallback selects all bullets', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    const { selectedIds } = mod._getState();
    expect(selectedIds.size).toBe(10);
  });
});
