const {
  Chart: MockChart,
  _mockDestroy: mockChartDestroy,
  _mockUpdate: mockChartUpdate,
  _mockDraw: mockChartDraw,
} = require('chart.js');

HTMLCanvasElement.prototype.getContext = jest.fn(() => ({}));

const {
  BULLET_COLORS, HEX_COLOR_RE, colorFor,
  TRAJECTORY_CHART_IDS, CHART_LOAD_ERROR_MSG,
  _loadChart, _warmChart,
  drawVLine, drawHLine, annotationPlugin, crosshairPlugin,
  _attachTouchForwarder, updateReadout, scheduleCrosshairSync,
  resetCrosshairState, toggleReadoutPin,
  _chartAnimation, _lineTension, renderStatCards,
  windChartSubtitle, buildChartConfig, renderCharts, destroyCharts,
  _applyChartTheme, _observeChartCanvases, _teardownChartObserver,
  _getChartState, _resetChartState, _setCharts, _setChartEntry, _getChartMeta,
  _resetReadoutCache, syncModelPill,
} = require('../app/charts.js');

function buildChartsDOM() {
  document.body.innerHTML = `
    <span id="modelStatus">MODEL: G1</span>
    <div id="simulationError" hidden></div>
    <div id="emptyState" style="display:block"></div>
    <div id="resultsContainer" style="display:none">
      <div id="chartContainer"></div>
      <div id="rangeReadout" style="display:none">
        <span id="readoutRange">— m</span>
        <button id="readoutPin">PIN</button>
        <table><tbody id="readoutBody"></tbody></table>
      </div>
    </div>
  `;
}

function makeResult(count = 3, overrides = {}) {
  const points = Array.from({ length: count }, (_, i) => ({
    rangeMeters: i * 100,
    dropCm: i === 0 ? 0 : -(i * 5),
    velocityMps: 800 - i * 30,
    energyJoules: 3500 - i * 300,
    windDriftCm: i * 2,
    timeOfFlightSec: i * 0.13,
  }));
  return {
    bullet: {
      id: '308-win-168gr',
      name: '.308 Win 168gr',
      muzzleVelocityMps: 807,
      muzzleEnergyJoules: 3552,
      ballisticCoefficient: 0.475,
      bulletWeightGrams: 10.89,
    },
    points,
    supersonicLimitMeters: 800,
    maxOrdinateCm: 4,
    maxOrdinateRangeMeters: 50,
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  buildChartsDOM();
  _resetChartState();
  MockChart.mockClear();
  MockChart.register.mockClear();
  mockChartDestroy.mockClear();
  mockChartUpdate.mockClear();
  mockChartDraw.mockClear();
  delete window.matchMedia;
  delete global.IntersectionObserver;
});

afterEach(() => {
  _resetChartState();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('color helpers & constants', () => {
  test('BULLET_COLORS and colorFor resolve valid hex, built-in id, and fallback', () => {
    expect(BULLET_COLORS['308-win-168gr']).toBe('#F97316');
    expect(HEX_COLOR_RE.test('#abcdef')).toBe(true);
    expect(colorFor({ id: 'custom', hexColor: '#123456' })).toBe('#123456');
    expect(colorFor({ id: '308-win-168gr', hexColor: 'not-hex' })).toBe('#F97316');
    expect(colorFor({ id: 'unknown-round' })).toBe('#4ADE80');
    expect(TRAJECTORY_CHART_IDS).toHaveLength(5);
  });
});

describe('lazy chart loader', () => {
  test('_loadChart memoizes, resets on failure, and _warmChart swallows rejection', async () => {
    MockChart.register.mockImplementationOnce(() => { throw new Error('offline'); });
    await _warmChart();
    await expect(_loadChart()).resolves.toHaveProperty('Chart', MockChart);
    await expect(_loadChart()).resolves.toHaveProperty('Chart', MockChart);
    expect(MockChart.register).toHaveBeenCalledTimes(2);
  });
});

describe('plugins (annotationPlugin, crosshairPlugin) & touch forwarder', () => {
  function makeCtx() {
    return {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(),
      moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(),
      setLineDash: jest.fn(), fillText: jest.fn(),
    };
  }

  test('drawVLine, drawHLine, and annotationPlugin draw dashed annotations and clamp xScale.max', () => {
    const ctx = makeCtx();
    const chart = {
      ctx,
      scales: {
        x: { max: 500, getPixelForValue: jest.fn(v => v) },
        y: { getPixelForValue: jest.fn(v => v) },
      },
      chartArea: { top: 0, bottom: 100, left: 0, right: 500 },
    };
    annotationPlugin([]).afterDraw(chart);
    expect(ctx.stroke).not.toHaveBeenCalled();

    drawVLine(ctx, chart.scales.x, chart.chartArea, { value: 900, label: 'S', color: '#f00' });
    expect(chart.scales.x.getPixelForValue).toHaveBeenCalledWith(500);
    drawHLine(ctx, chart.scales.y, chart.chartArea, { value: 10, label: 'H', color: '#0f0' });

    annotationPlugin([
      { type: 'vertical', value: 100, label: 'V', color: '#fff' },
      { type: 'horizontal', value: 20, label: 'H', color: '#fff' },
    ]).afterDraw(chart);
    expect(ctx.fillText).toHaveBeenCalledTimes(4);
  });

  test('crosshairPlugin draws only when crosshairIndex and meta data point exist', () => {
    const ctx = makeCtx();
    const chart = {
      ctx,
      chartArea: { top: 0, bottom: 100 },
      getDatasetMeta: jest.fn(() => ({ data: [{ x: 10 }, { x: 40 }] })),
    };
    crosshairPlugin.afterDraw(chart);
    expect(ctx.stroke).not.toHaveBeenCalled();

    scheduleCrosshairSync(5, 'c1', [makeResult()]);
    crosshairPlugin.afterDraw(chart);
    expect(ctx.stroke).not.toHaveBeenCalled();

    scheduleCrosshairSync(1, 'c1', [makeResult()]);
    crosshairPlugin.afterDraw(chart);
    expect(ctx.strokeStyle).toContain('0.35');

    // Pin via buildChartConfig onClick
    const cfg = buildChartConfig({ id: 'c1', yLabel: 'Drop' }, [{ data: [] }], [makeResult()]);
    cfg.options.onClick({}, [{ index: 1 }]);
    crosshairPlugin.afterDraw(chart);
    expect(ctx.strokeStyle).toContain('0.7');
  });

  test('_attachTouchForwarder forwards touchmove as mousemove', () => {
    const canvas = document.createElement('canvas');
    const spy = jest.fn();
    canvas.addEventListener('mousemove', spy);
    _attachTouchForwarder(canvas);
    const ev = new Event('touchmove');
    ev.touches = [{ clientX: 12, clientY: 34 }];
    canvas.dispatchEvent(ev);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ clientX: 12, clientY: 34 }));
  });
});

describe('updateReadout, crosshair sync, IntersectionObserver, and toggleReadoutPin', () => {
  test('updateReadout handles missing panel, invalid index, sparse points, spin drift, coriolis, and cache rebuild', () => {
    const res = makeResult(3);
    res.points[0].coriolisDeflectionCm = 0.5;
    res.points[1].spinDriftCm = 1.5;
    res.points[1].coriolisDeflectionCm = -0.8;
    res.points[2].coriolisDeflectionCm = 1.2;
    const sparse = makeResult(1, { bullet: { id: '223-rem-55gr', name: '.223' } });
    const pair = [res, sparse];

    updateReadout(pair, 99);
    expect(document.getElementById('rangeReadout').style.display).toBe('none');

    // Repeated hovers with identical array reference exercise _readoutCache reuse and cell attach/detach
    updateReadout(pair, 0);
    expect(document.getElementById('readoutBody').textContent).toContain('Coriolis: +0.5 cm');
    expect(document.getElementById('readoutBody').textContent).not.toContain('Spin Drift');

    // Index 1: spinCell inserts before attached corCell; sparse row hidden
    updateReadout(pair, 1);
    expect(document.getElementById('rangeReadout').style.display).toBe('block');
    expect(document.getElementById('readoutBody').textContent).toContain('Spin Drift: 1.5 cm');
    expect(document.getElementById('readoutBody').textContent).toContain('Coriolis: -0.8 cm');
    expect(document.querySelectorAll('#readoutBody tr')[1].style.display).toBe('none');

    // Index 2: spinCell removed (absent on point 2), corCell stays attached
    updateReadout(pair, 2);
    expect(document.getElementById('readoutBody').textContent).not.toContain('Spin Drift');
    expect(document.getElementById('readoutBody').textContent).toContain('Coriolis: +1.2 cm');

    // Also test spinDrift insertion when corCell is absent & corCell removal when coriolis becomes null
    res.points[2].spinDriftCm = 2.0;
    res.points[2].coriolisDeflectionCm = null;
    updateReadout(pair, 2);
    expect(document.getElementById('readoutBody').textContent).toContain('Spin Drift: 2.0 cm');
    expect(document.getElementById('readoutBody').textContent).not.toContain('Coriolis');

    // Re-entering index 2 when spinCell is already attached covers parentNode === row true branch
    res.points[2].spinDriftCm = 2.5;
    updateReadout(pair, 2);
    expect(document.getElementById('readoutBody').textContent).toContain('Spin Drift: 2.5 cm');

    // Cache invalidation when tbody changes
    const freshTbody = document.createElement('tbody');
    freshTbody.id = 'readoutBody';
    document.getElementById('readoutBody').replaceWith(freshTbody);
    updateReadout([res], 0);
    expect(freshTbody.querySelectorAll('tr')).toHaveLength(1);

    document.getElementById('rangeReadout').remove();
    expect(() => updateReadout([res], 0)).not.toThrow();
  });

  test('scheduleCrosshairSync coalesces rAF, handles null index, and IntersectionObserver defers hidden redraws', () => {
    const callbacks = [];
    global.IntersectionObserver = jest.fn(cb => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
      trigger: entries => cb(entries),
    }));
    const c1 = document.createElement('canvas'); c1.id = 'dropChart';
    const c2 = document.createElement('canvas'); c2.id = 'velocityChart';
    const c3 = document.createElement('canvas'); c3.id = 'energyChart';
    document.body.append(c1, c2, c3);

    const drawFn = jest.fn();
    const updateOnlyChart = { update: jest.fn() };
    _setCharts({
      dropChart: { draw: jest.fn() },
      velocityChart: { draw: drawFn },
      energyChart: updateOnlyChart,
    });
    _observeChartCanvases(['dropChart', 'velocityChart', 'energyChart']);
    const ioInstance = global.IntersectionObserver.mock.results[0].value;
    // Mark velocityChart offscreen (energyChart stays visible and uses update('none'))
    ioInstance.trigger([{ target: c2, isIntersecting: false }]);

    const res = [makeResult(3)];
    scheduleCrosshairSync(1, 'dropChart', res);
    scheduleCrosshairSync(1, 'dropChart', res); // duplicate guard
    scheduleCrosshairSync(2, 'dropChart', res); // coalesce
    jest.runOnlyPendingTimers();

    expect(document.getElementById('readoutRange').textContent).toBe('200 m');
    expect(drawFn).not.toHaveBeenCalled();
    expect(updateOnlyChart.update).toHaveBeenCalledWith('none');
    expect(_getChartState()._dirtyCrosshairCharts.has('velocityChart')).toBe(true);

    // Scrolling velocityChart back into view flushes deferred draw
    ioInstance.trigger([{ target: c2, isIntersecting: true }]);
    expect(drawFn).toHaveBeenCalledTimes(1);
    expect(_getChartState()._dirtyCrosshairCharts.has('velocityChart')).toBe(false);

    // Dirty chart cleared before scrolling into view skips safely
    ioInstance.trigger([{ target: c3, isIntersecting: false }]);
    scheduleCrosshairSync(1, 'dropChart', res);
    jest.runOnlyPendingTimers();
    _setCharts({});
    ioInstance.trigger([{ target: c3, isIntersecting: true }]);
    expect(updateOnlyChart.update).toHaveBeenCalledTimes(1);

    // Null index hides panel
    scheduleCrosshairSync(null, 'dropChart', res);
    jest.runOnlyPendingTimers();
    expect(document.getElementById('rangeReadout').style.display).toBe('none');

    // toggleReadoutPin pins then unpins
    toggleReadoutPin();
    expect(_getChartState().crosshairPinned).toBe(true);
    expect(document.getElementById('readoutPin').textContent).toBe('UNPIN');
    toggleReadoutPin();
    expect(_getChartState().crosshairPinned).toBe(false);
    expect(document.getElementById('readoutPin').textContent).toBe('PIN');

    _teardownChartObserver();
  });
});

describe('chart performance helpers, stat cards, subtitle, buildChartConfig, and renderCharts', () => {
  test('_chartAnimation and _lineTension cover reduced motion and point thresholds', () => {
    expect(_lineTension(new Array(200))).toBe(0.3);
    expect(_lineTension(new Array(201))).toBe(0);
    expect(_chartAnimation([{ data: new Array(10) }])).toEqual({ duration: 250 });
    expect(_chartAnimation([{ data: new Array(1001) }])).toBe(false);

    window.matchMedia = jest.fn(() => ({ matches: true }));
    expect(_chartAnimation([{ data: new Array(5) }])).toBe(false);
  });

  test('renderStatCards and windChartSubtitle format data cleanly', () => {
    const wrap = document.createElement('div');
    renderStatCards([makeResult(2, { densityAltitudeMeters: 1200 }), makeResult(2)], wrap);
    expect(wrap.textContent).toContain('1200 m density alt');
    expect(windChartSubtitle({ windSpeedKph: 0 })).toBe('no wind');
    expect(windChartSubtitle({ windSpeedKph: 20 })).toBe('20 km/h from E');
    expect(windChartSubtitle({ windSpeedKph: 20, windDirectionDeg: 270 })).toBe('20 km/h from W');
  });

  test('buildChartConfig callbacks read _chartMeta or fallback results and handle empty click', () => {
    const res = [makeResult(3)];
    const cfg = buildChartConfig({ id: 'dropChart', yLabel: 'Drop' }, [{ data: [] }], res);
    cfg.options.onClick({}, []);
    expect(_getChartState().crosshairPinned).toBe(false);

    cfg.options.onHover({}, [{ index: 1 }]);
    cfg.options.onHover({}, []);
    cfg.options.onClick({}, [{ index: 1 }]);
    expect(_getChartState().crosshairPinned).toBe(true);
    cfg.options.onHover({}, [{ index: 2 }]); // ignored while pinned
    expect(_getChartState().crosshairIndex).toBe(1);
    cfg.options.onClick({}, [{ index: 1 }]); // unpin
    expect(_getChartState().crosshairPinned).toBe(false);
  });

  test('renderCharts creates 5 charts (with spin/coriolis), reuses in place, handles PNG click & Chart load failure', async () => {
    const res = makeResult(3);
    res.points[1].spinDriftCm = 1.1;
    res.points[1].coriolisDeflectionCm = 0.5;
    // Also test nullish fallback on spin/coriolis points
    const res2 = makeResult(3, { bullet: { id: '223-rem-55gr', name: '.223' } });

    const onExport = jest.fn();
    const out = await renderCharts([res, null, res2], { zeroRangeMeters: 100, windSpeedKph: 10, dragModel: 'G7' }, { onExportPNG: onExport });
    expect(out).toHaveLength(2);
    expect(MockChart).toHaveBeenCalledTimes(5);
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G7');

    // PNG buttons invoke callback
    document.querySelector('.export-btn[data-chart-id="dropChart"]').click();
    document.querySelector('.export-btn[data-chart-id="adjustChart"]').click();
    expect(onExport).toHaveBeenCalledWith('dropChart');
    expect(onExport).toHaveBeenCalledWith('adjustChart');

    // Reuse in place with default req & >1000 points
    MockChart.mockClear();
    mockChartDestroy.mockClear();
    mockChartUpdate.mockClear();
    const largeRes = makeResult(1005);
    await renderCharts([largeRes]);
    expect(MockChart).not.toHaveBeenCalled();
    expect(mockChartDestroy).not.toHaveBeenCalled();
    expect(mockChartUpdate).toHaveBeenCalledWith('none');

    // Reusing when animation is active
    mockChartUpdate.mockClear();
    await renderCharts([makeResult(3)], { zeroRangeMeters: 100, customDragTable: [{ mach: 0.5, cd: 0.2 }] });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: CUSTOM');
    expect(mockChartUpdate).toHaveBeenCalledWith(undefined);

    // Omitting onExportPNG still works cleanly on PNG click
    destroyCharts();
    await renderCharts([]);
    document.querySelector('.export-btn[data-chart-id="dropChart"]').click();

    // _applyChartTheme updates tooltips & skips charts without tooltip options
    _setChartEntry('extra', { options: { plugins: {} }, update: jest.fn() }, {});
    _applyChartTheme('light');
    _applyChartTheme('dark');
    expect(_getChartMeta('extra')).toEqual({});

    // Chart.js import failure sets simulation error
    _resetChartState();
    MockChart.register.mockImplementationOnce(() => { throw new Error('fail'); });
    await renderCharts([makeResult(2)], { zeroRangeMeters: 100 });
    expect(document.getElementById('simulationError').textContent).toBe(CHART_LOAD_ERROR_MSG);
  });

  test('ENH-3: renderCharts, renderStatCards, windChartSubtitle, and updateReadout format Imperial units', async () => {
    const res = makeResult(3, { densityAltitudeMeters: 1000 });
    res.points[1].spinDriftCm = 2.54;
    res.points[1].coriolisDeflectionCm = 5.08;
    const req = { zeroRangeMeters: 100, windSpeedKph: 16, windDirectionDeg: 90, dragModel: 'G1' };

    await renderCharts([res], req, { unitSystem: 'imperial' });

    expect(document.querySelector('.stats-grid').textContent).toContain('MV fps');
    expect(document.querySelector('.stats-grid').textContent).toContain('ft·lb muzzle energy');
    expect(document.querySelector('.stats-grid').textContent).toContain('yd supersonic');
    expect(document.querySelector('.stats-grid').textContent).toContain('ft density alt');
    expect(document.body.innerHTML).toContain('zeroed at 109 yd');
    expect(document.body.innerHTML).toContain('ft·lb downrange');
    expect(windChartSubtitle(req, 'imperial')).toBe('10 mph from E');

    updateReadout([res], 1, 'imperial');
    expect(document.getElementById('readoutRange').textContent).toBe('109 yd');
    expect(document.getElementById('readoutBody').textContent).toContain('ft·lb');

    // ENH-5: per-bullet custom dragModel sets MODEL: CUSTOM pill
    await renderCharts([makeResult(2, { dragModel: 'custom' })], { zeroRangeMeters: 100 });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: CUSTOM');
  });

  test('FEAT-5: syncModelPill updates #modelStatus immediately for G5 and custom', () => {
    syncModelPill('G5');
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G5');
    syncModelPill('G1', true);
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: CUSTOM');
    syncModelPill();
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G1');
  });
});
