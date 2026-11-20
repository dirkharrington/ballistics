const {
  Chart: MockChart,
  _mockDestroy: mockChartDestroy,
  _mockUpdate: mockChartUpdate,
} = require('chart.js');

HTMLCanvasElement.prototype.getContext = jest.fn(() => ({}));

jest.mock('../app/physics/engine-async.ts', () => ({
  simulateAsync: jest.fn(),
  solveBCAsync: jest.fn(),
  prewarmPhysicsWorker: jest.fn(),
}));

const { simulateAsync } = require('../app/physics/engine-async.ts');
const { TrajectoryInputError } = require('../app/physics/errors.ts');
const { _resetChartState } = require('../app/charts.js');
const {
  SWEEP_COLORS, SWEEP_CHART_IDS, SWEEP_RANGES,
  updateSweepButtonVisibility, buildSweepRequests,
  renderSweepCharts, runSweep, clearSweep,
} = require('../app/sweep.js');

function buildSweepDOM() {
  document.body.innerHTML = `
    <input id="zeroRange" value="100" />
    <input id="maxRange" value="500" />
    <input id="windSpeed" value="10" />
    <select id="windDir"><option value="90" selected>E</option></select>
    <input id="altitude" value="0" />
    <input id="temperature" value="15" />
    <input id="step" value="25" />
    <input id="sightHeight" value="38.1" />
    <input id="shootingAngle" value="0" />
    <select id="dragModel"><option value="G1" selected>G1</option></select>
    <div id="sweepControls" style="display:none">
      <select id="sweepParam">
        <option value="wind" selected>Wind</option>
        <option value="altitude">Altitude</option>
        <option value="temperature">Temperature</option>
      </select>
      <button id="sweepBtn"><span>SWEEP</span></button>
      <button id="clearSweepBtn" style="display:none"><span>CLEAR SWEEP</span></button>
    </div>
    <div id="simulationError" hidden></div>
    <div id="emptyState" style="display:block"></div>
    <div id="resultsContainer" style="display:none">
      <div id="chartContainer"></div>
      <div id="rangeReadout" style="display:none">
        <span id="readoutRange"></span>
        <button id="readoutPin">PIN</button>
        <table><tbody id="readoutBody"></tbody></table>
      </div>
    </div>
  `;
}

function makeBullet() {
  return {
    id: '308-win-168gr',
    name: '.308 Win 168gr',
    muzzleVelocityMps: 807,
    muzzleEnergyJoules: 3552,
    ballisticCoefficient: 0.475,
    bulletWeightGrams: 10.89,
  };
}

function makeSweepResultList(pointCount = 2) {
  return [0, 1, 2, 3, 4].map(i => ({
    bullet: makeBullet(),
    request: {},
    points: Array.from({ length: pointCount }, (_, j) => ({
      rangeMeters: j * 100,
      dropCm: -(j * 5 + i),
      velocityMps: 800 - j * 30,
      energyJoules: 3500 - j * 250,
      windDriftCm: i + j,
      timeOfFlightSec: j * 0.13,
    })),
    supersonicLimitMeters: 800,
    maxOrdinateCm: 3,
    maxOrdinateRangeMeters: 50,
  }));
}

beforeEach(() => {
  buildSweepDOM();
  _resetChartState();
  MockChart.mockClear();
  MockChart.register.mockClear();
  mockChartDestroy.mockClear();
  mockChartUpdate.mockClear();
  simulateAsync.mockReset();
  simulateAsync.mockImplementation((bullet, params) => Promise.resolve({
    bullet,
    request: params,
    points: [
      { rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 },
      { rangeMeters: 100, dropCm: -4, velocityMps: 760, energyJoules: 3150, windDriftCm: 2, timeOfFlightSec: 0.13 },
    ],
    supersonicLimitMeters: 800,
    maxOrdinateCm: 3,
    maxOrdinateRangeMeters: 50,
  }));
});

afterEach(() => {
  _resetChartState();
  jest.restoreAllMocks();
});

describe('SWEEP_COLORS, SWEEP_RANGES, updateSweepButtonVisibility, buildSweepRequests', () => {
  test('constants and visibility helper cover Set, number, null, and missing DOM element', () => {
    expect(SWEEP_COLORS).toHaveLength(5);
    expect(SWEEP_CHART_IDS).toEqual(['sweepDropChart', 'sweepWindChart', 'sweepVelChart']);
    expect(SWEEP_RANGES.wind).toHaveLength(5);
    expect(SWEEP_RANGES.altitude).toHaveLength(5);
    expect(SWEEP_RANGES.temperature).toHaveLength(5);

    updateSweepButtonVisibility(new Set(['308-win-168gr']));
    expect(document.getElementById('sweepControls').style.display).toBe('block');
    updateSweepButtonVisibility(0);
    expect(document.getElementById('sweepControls').style.display).toBe('none');
    updateSweepButtonVisibility(null);
    expect(document.getElementById('sweepControls').style.display).toBe('none');

    document.getElementById('sweepControls').remove();
    expect(() => updateSweepButtonVisibility(1)).not.toThrow();
  });

  test('buildSweepRequests creates 5 requests for wind, altitude, temperature, and unknown fallback', () => {
    const base = {
      bulletIds: ['308-win-168gr'], zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 25,
      windSpeedKph: 0, windDirectionDeg: 90, altitudeMeters: 0, temperatureC: 15,
      sightHeightMm: 38.1, shootingAngleDegrees: 0, dragModel: 'G1',
    };
    expect(buildSweepRequests(base, 'wind', 'a').map(r => r.windSpeedKph)).toEqual(SWEEP_RANGES.wind);
    expect(buildSweepRequests(base, 'altitude', 'a').map(r => r.altitudeMeters)).toEqual(SWEEP_RANGES.altitude);
    expect(buildSweepRequests(base, 'temperature', 'a').map(r => r.temperatureC)).toEqual(SWEEP_RANGES.temperature);
    expect(buildSweepRequests(base, 'other', 'a')).toHaveLength(5);
  });
});

describe('renderSweepCharts', () => {
  test('creates 3 charts, supports PNG callbacks, reuses in place, and handles load errors', async () => {
    const onExport = jest.fn();
    await renderSweepCharts(makeSweepResultList(), 'wind', { onExportPNG: onExport });
    expect(MockChart).toHaveBeenCalledTimes(3);
    document.querySelector('.export-btn[data-chart-id="sweepDropChart"]').click();
    expect(onExport).toHaveBeenCalledWith('sweepDropChart');

    // Reuse in place with animation enabled then disabled (>1000 pts)
    MockChart.mockClear();
    mockChartDestroy.mockClear();
    mockChartUpdate.mockClear();
    await renderSweepCharts(makeSweepResultList(2), 'altitude');
    expect(MockChart).not.toHaveBeenCalled();
    expect(mockChartDestroy).not.toHaveBeenCalled();
    expect(mockChartUpdate).toHaveBeenCalledWith(undefined);

    mockChartUpdate.mockClear();
    await renderSweepCharts(makeSweepResultList(250), 'temperature');
    expect(mockChartUpdate).toHaveBeenCalledWith('none');

    // Unknown param + missing onExportPNG callback
    _resetChartState();
    await renderSweepCharts(makeSweepResultList(), 'unknown');
    document.querySelector('.export-btn[data-chart-id="sweepDropChart"]').click();

    // Chart load error
    _resetChartState();
    MockChart.register.mockImplementationOnce(() => { throw new Error('offline'); });
    await renderSweepCharts(makeSweepResultList(), 'wind');
    expect(document.getElementById('simulationError').textContent).toContain("Couldn't load the chart library");
  });
});

describe('runSweep & clearSweep', () => {
  test('runSweep handles empty selection, missing bullet, success, abort, and errors', async () => {
    await runSweep({ selectedIds: new Set(), getBulletById: () => makeBullet() });
    expect(simulateAsync).not.toHaveBeenCalled();

    await runSweep({ selectedIds: null, getBulletById: () => makeBullet() });
    expect(simulateAsync).not.toHaveBeenCalled();

    // Missing bullet with button present and absent
    await runSweep({ selectedIds: new Set(['missing']), getBulletById: () => null });
    expect(document.getElementById('sweepBtn').querySelector('span').textContent).toBe('SWEEP');
    document.getElementById('sweepBtn').remove();
    await runSweep({ selectedIds: new Set(['missing']), getBulletById: () => null });

    // Success without sweepBtn / sweepParam / clearSweepBtn / nextSignal / onSweepStateChange
    document.getElementById('sweepParam').remove();
    document.getElementById('clearSweepBtn').remove();
    await runSweep({
      selectedIds: new Set(['308-win-168gr']),
      getBulletById: () => makeBullet(),
    });
    expect(simulateAsync).toHaveBeenCalledTimes(5);

    // AbortError is silently ignored; aborted signal after Promise.all returns early
    buildSweepDOM();
    const ac = new AbortController();
    simulateAsync.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await runSweep({
      selectedIds: new Set(['308-win-168gr']),
      getBulletById: () => makeBullet(),
      nextSignal: () => ac.signal,
    });
    expect(document.getElementById('sweepBtn').querySelector('span').textContent).toBe('⏳ SWEEPING...');

    ac.abort();
    const stateSpy = jest.fn();
    await runSweep({
      selectedIds: new Set(['308-win-168gr']),
      getBulletById: () => makeBullet(),
      nextSignal: () => ac.signal,
      onSweepStateChange: stateSpy,
    });
    expect(stateSpy).not.toHaveBeenCalled();

    // TrajectoryInputError resets button text and logs warning (with and without #sweepBtn)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too big'));
    await runSweep({
      selectedIds: new Set(['308-win-168gr']),
      getBulletById: () => makeBullet(),
    });
    expect(document.getElementById('sweepBtn').querySelector('span').textContent).toBe('SWEEP');
    expect(warnSpy).toHaveBeenCalled();

    document.getElementById('sweepBtn').remove();
    simulateAsync.mockRejectedValueOnce(new TrajectoryInputError('maxRangeMeters', 'too big'));
    await runSweep({
      selectedIds: new Set(['308-win-168gr']),
      getBulletById: () => makeBullet(),
    });
  });

  test('clearSweep updates state, hides clearSweepBtn, and calls renderResults', async () => {
    await clearSweep();
    const renderResults = jest.fn().mockResolvedValue(undefined);
    const stateSpy = jest.fn();
    document.getElementById('clearSweepBtn').style.display = 'block';

    await clearSweep({
      lastResults: [makeSweepResultList()[0]],
      lastReq: null,
      renderResults,
      onSweepStateChange: stateSpy,
    });
    expect(stateSpy).toHaveBeenCalledWith(false, null);
    expect(document.getElementById('clearSweepBtn').style.display).toBe('none');
    expect(renderResults).toHaveBeenCalledWith([makeSweepResultList()[0]], {});

    document.getElementById('clearSweepBtn').remove();
    await clearSweep({
      lastResults: [makeSweepResultList()[0]],
      lastReq: { zeroRangeMeters: 200 },
      renderResults,
    });
    expect(renderResults).toHaveBeenCalledWith([makeSweepResultList()[0]], { zeroRangeMeters: 200 });
  });
});
