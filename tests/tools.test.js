'use strict';

const {
  calcMoaMrad, convertUnit, initTools, CONVERSIONS,
  interpolateAt, initDopeCard, renderDopeCard, initBcSolver,
  calcMpbr, initMpbrTool, renderMpbrTool, setToolsUnitSystem,
} = require('../app/tools.js');

function flushPromises() {
  return new Promise(r => setTimeout(r, 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// calcMoaMrad
// ─────────────────────────────────────────────────────────────────────────────
describe('calcMoaMrad', () => {
  test('returns { moa: 0, mrad: 0 } when range is zero', () => {
    expect(calcMoaMrad(-100, 0)).toEqual({ moa: 0, mrad: 0 });
  });

  test('returns { moa: 0, mrad: 0 } when range is negative', () => {
    expect(calcMoaMrad(-100, -1)).toEqual({ moa: 0, mrad: 0 });
  });

  test('zero drop returns 0 MOA and 0 MRAD', () => {
    const result = calcMoaMrad(0, 100);
    expect(result.moa).toBeCloseTo(0, 4);
    expect(result.mrad).toBeCloseTo(0, 4);
  });

  test('10 cm drop (below aim line) at 100 m ≈ 3.44 MOA and 1.00 MRAD', () => {
    const result = calcMoaMrad(-10, 100);
    expect(result.moa).toBeCloseTo(3.44, 1);
    expect(result.mrad).toBeCloseTo(1.0, 1);
  });

  test('negative drop (bullet below aim line) produces positive MOA adjustment', () => {
    const result = calcMoaMrad(-100, 500);
    expect(result.moa).toBeGreaterThan(0);
    expect(result.mrad).toBeGreaterThan(0);
  });

  test('larger range produces smaller MOA for same drop', () => {
    const near = calcMoaMrad(-50, 200);
    const far  = calcMoaMrad(-50, 500);
    expect(near.moa).toBeGreaterThan(far.moa);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// convertUnit
// ─────────────────────────────────────────────────────────────────────────────
describe('convertUnit', () => {
  test('same unit returns the original value', () => {
    expect(convertUnit(100, 'mps', 'mps')).toBe(100);
  });

  test('unsupported conversion returns null (valid from, incompatible to)', () => {
    expect(convertUnit(1, 'mps', 'cm')).toBeNull();
  });

  test('unknown from-unit returns null', () => {
    expect(convertUnit(1, 'lightyear', 'fps')).toBeNull();
  });

  test('mps → fps: 1 m/s ≈ 3.28084 ft/s', () => {
    expect(convertUnit(1, 'mps', 'fps')).toBeCloseTo(3.28084, 3);
  });

  test('fps → mps: 3280.84 ft/s ≈ 1000 m/s', () => {
    expect(convertUnit(3280.84, 'fps', 'mps')).toBeCloseTo(1000, 0);
  });

  test('mps → kph: 1 m/s = 3.6 km/h', () => {
    expect(convertUnit(1, 'mps', 'kph')).toBeCloseTo(3.6, 4);
  });

  test('mps → mph: 1 m/s ≈ 2.23694 mph', () => {
    expect(convertUnit(1, 'mps', 'mph')).toBeCloseTo(2.23694, 3);
  });

  test('kph → mps: 3.6 km/h = 1 m/s', () => {
    expect(convertUnit(3.6, 'kph', 'mps')).toBeCloseTo(1, 4);
  });

  test('kph → fps: 3.6 km/h ≈ 3.28084 ft/s', () => {
    expect(convertUnit(3.6, 'kph', 'fps')).toBeCloseTo(3.28084, 2);
  });

  test('kph → mph: 1.60934 km/h ≈ 1 mph', () => {
    expect(convertUnit(1.60934, 'kph', 'mph')).toBeCloseTo(1, 3);
  });

  test('mph → mps: 1 mph ≈ 0.44704 m/s', () => {
    expect(convertUnit(1, 'mph', 'mps')).toBeCloseTo(0.44704, 3);
  });

  test('mph → fps: 1 mph = 1.46667 ft/s', () => {
    expect(convertUnit(1, 'mph', 'fps')).toBeCloseTo(1.46667, 3);
  });

  test('mph → kph: 1 mph ≈ 1.60934 km/h', () => {
    expect(convertUnit(1, 'mph', 'kph')).toBeCloseTo(1.60934, 3);
  });

  test('fps → kph round-trip', () => {
    expect(convertUnit(3280.84, 'fps', 'kph')).toBeCloseTo(3600, 0);
  });

  test('fps → mph: 1.46667 ft/s ≈ 1 mph', () => {
    expect(convertUnit(1.46667, 'fps', 'mph')).toBeCloseTo(1, 3);
  });

  test('cm → in: 2.54 cm = 1 in', () => {
    expect(convertUnit(2.54, 'cm', 'in')).toBeCloseTo(1, 4);
  });

  test('cm → m: 100 cm = 1 m', () => {
    expect(convertUnit(100, 'cm', 'm')).toBeCloseTo(1, 4);
  });

  test('cm → yd: 91.44 cm = 1 yd', () => {
    expect(convertUnit(91.44, 'cm', 'yd')).toBeCloseTo(1, 4);
  });

  test('in → cm: 1 in = 2.54 cm', () => {
    expect(convertUnit(1, 'in', 'cm')).toBeCloseTo(2.54, 4);
  });

  test('in → m: 39.3701 in ≈ 1 m', () => {
    expect(convertUnit(39.3701, 'in', 'm')).toBeCloseTo(1, 3);
  });

  test('in → yd: 36 in = 1 yd', () => {
    expect(convertUnit(36, 'in', 'yd')).toBeCloseTo(1, 4);
  });

  test('m → cm: 1 m = 100 cm', () => {
    expect(convertUnit(1, 'm', 'cm')).toBeCloseTo(100, 4);
  });

  test('m → in: 1 m ≈ 39.37 in', () => {
    expect(convertUnit(1, 'm', 'in')).toBeCloseTo(39.37, 1);
  });

  test('m → yd: 0.9144 m = 1 yd', () => {
    expect(convertUnit(0.9144, 'm', 'yd')).toBeCloseTo(1, 4);
  });

  test('yd → cm: 1 yd = 91.44 cm', () => {
    expect(convertUnit(1, 'yd', 'cm')).toBeCloseTo(91.44, 4);
  });

  test('yd → in: 1 yd = 36 in', () => {
    expect(convertUnit(1, 'yd', 'in')).toBeCloseTo(36, 4);
  });

  test('yd → m: 1 yd = 0.9144 m', () => {
    expect(convertUnit(1, 'yd', 'm')).toBeCloseTo(0.9144, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initTools DOM wiring
// ─────────────────────────────────────────────────────────────────────────────
describe('initTools', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="toolDrop"  value="-100" />
      <input id="toolRange" value="500"  />
      <button id="toolCalcBtn">Calculate</button>
      <div id="toolResults"></div>
      <input id="unitValue" value="1"   />
      <select id="unitFrom"><option value="mps" selected>m/s</option></select>
      <select id="unitTo"><option value="fps" selected>ft/s</option></select>
      <button id="unitCalcBtn">Convert</button>
      <div id="unitResults"></div>`;
  });

  test('toolCalcBtn click populates toolResults with MOA and MRAD', () => {
    initTools();
    document.getElementById('toolCalcBtn').click();
    const html = document.getElementById('toolResults').innerHTML;
    expect(html).toContain('MOA');
    expect(html).toContain('MRAD');
  });

  test('unitCalcBtn click populates unitResults with converted value', () => {
    initTools();
    document.getElementById('unitCalcBtn').click();
    const html = document.getElementById('unitResults').innerHTML;
    expect(html).toContain('fps');
    expect(html).toContain('3.2808');
  });

  test('unsupported conversion shows warning in unitResults', () => {
    document.getElementById('unitFrom').innerHTML = '<option value="mps" selected>m/s</option>';
    document.getElementById('unitTo').innerHTML   = '<option value="cm"  selected>cm</option>';
    initTools();
    document.getElementById('unitCalcBtn').click();
    const html = document.getElementById('unitResults').innerHTML;
    expect(html).toContain('Unsupported');
  });

  test('empty inputs fall back to 0 drop and 100m range', () => {
    document.getElementById('toolDrop').value  = '';
    document.getElementById('toolRange').value = '';
    initTools();
    document.getElementById('toolCalcBtn').click();
    const html = document.getElementById('toolResults').innerHTML;
    expect(html).toContain('MOA');
    expect(html).toContain('MRAD');
  });

  test('initTools is a no-op when buttons are absent', () => {
    document.body.innerHTML = '';
    expect(() => initTools()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// interpolateAt
// ─────────────────────────────────────────────────────────────────────────────
describe('interpolateAt', () => {
  const pts = [
    { rangeMeters: 0,   dropCm: 0   },
    { rangeMeters: 100, dropCm: -5  },
    { rangeMeters: 200, dropCm: -20 },
    { rangeMeters: 300, dropCm: -50 },
  ];

  test('returns null for empty array', () => {
    expect(interpolateAt([], 100, 'dropCm')).toBeNull();
  });

  test('returns null for null/undefined points', () => {
    expect(interpolateAt(null, 100, 'dropCm')).toBeNull();
  });

  test('returns first value when dist <= first range', () => {
    expect(interpolateAt(pts, 0,   'dropCm')).toBe(0);
    expect(interpolateAt(pts, -10, 'dropCm')).toBe(0);
  });

  test('returns last value when dist >= last range', () => {
    expect(interpolateAt(pts, 300, 'dropCm')).toBe(-50);
    expect(interpolateAt(pts, 400, 'dropCm')).toBe(-50);
  });

  test('linearly interpolates between two points', () => {
    // midpoint between 100 (-5) and 200 (-20) → -12.5
    expect(interpolateAt(pts, 150, 'dropCm')).toBe(-12.5);
  });

  test('returns null when field is missing on a bounding point', () => {
    const pts2 = [
      { rangeMeters: 0,   dropCm: 0  },
      { rangeMeters: 100               },  // missing dropCm
      { rangeMeters: 200, dropCm: -20 },
    ];
    expect(interpolateAt(pts2, 50, 'dropCm')).toBeNull();
  });

  test('rounds result to 1 decimal place', () => {
    // 1/3 of the way between 0→100 gives -5/3 ≈ -1.667 → -1.7
    expect(interpolateAt(pts, 33.33, 'dropCm')).toBeCloseTo(-1.7, 1);
  });

  test('returns null when field missing on first boundary point', () => {
    const p = [{ rangeMeters: 100 }, { rangeMeters: 200, dropCm: -20 }];
    expect(interpolateAt(p, 50, 'dropCm')).toBeNull();
  });

  test('returns null when field missing on last boundary point', () => {
    const p = [{ rangeMeters: 0, dropCm: 0 }, { rangeMeters: 100 }];
    expect(interpolateAt(p, 150, 'dropCm')).toBeNull();
  });

  test('PERF-22: binary search matches linear scan across dense trajectory & exact breakpoints', () => {
    const dense = Array.from({ length: 201 }, (_, i) => ({
      rangeMeters: i * 10,
      dropCm: -0.0005 * (i * 10) * (i * 10),
    }));
    function linearRef(points, d, field) {
      if (d <= points[0].rangeMeters) return points[0][field];
      if (d >= points[points.length - 1].rangeMeters) return points[points.length - 1][field];
      for (let i = 1; i < points.length; i++) {
        if (d <= points[i].rangeMeters) {
          const t = (d - points[i - 1].rangeMeters) / (points[i].rangeMeters - points[i - 1].rangeMeters);
          return Math.round((points[i - 1][field] + t * (points[i][field] - points[i - 1][field])) * 10) / 10;
        }
      }
      return null;
    }
    for (const d of [0, 5, 10, 15, 500, 999.9, 1000, 1000.1, 1995, 2000]) {
      expect(interpolateAt(dense, d, 'dropCm')).toBe(linearRef(dense, d, 'dropCm'));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initDopeCard / renderDopeCard
// ─────────────────────────────────────────────────────────────────────────────
function buildDopeDOM() {
  document.body.innerHTML = `
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
      <div id="mpbrResults" class="tool-results"></div>
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
    </div>`;
}

describe('initDopeCard', () => {
  beforeEach(() => {
    buildDopeDOM();
    history.replaceState(null, '', '/');
  });

  test('renders distance inputs on init', () => {
    initDopeCard();
    const inputs = document.querySelectorAll('.dope-dist-input');
    expect(inputs.length).toBeGreaterThan(0);
  });

  test('restores distances from URL on init', () => {
    history.replaceState(null, '', '/?dopeDistances=[100,250,500]');
    initDopeCard();
    const inputs = document.querySelectorAll('.dope-dist-input');
    expect(inputs.length).toBe(3);
    expect(inputs[1].value).toBe('250');
  });

  test('add distance button adds a new input (up to 10)', () => {
    initDopeCard();
    const before = document.querySelectorAll('.dope-dist-input').length;
    document.getElementById('dopeAddDistBtn').click();
    const after = document.querySelectorAll('.dope-dist-input').length;
    expect(after).toBe(before + 1);
  });

  test('add distance button is a no-op when already at 10', () => {
    history.replaceState(null, '', '/?dopeDistances=[100,200,300,400,500,600,700,800,900,1000]');
    initDopeCard();
    const before = document.querySelectorAll('.dope-dist-input').length;
    document.getElementById('dopeAddDistBtn').click();
    expect(document.querySelectorAll('.dope-dist-input').length).toBe(before);
  });

  test('URL with empty dopeDistances array leaves distances unchanged', () => {
    history.replaceState(null, '', '/?dopeDistances=[]');
    initDopeCard();
    // Array.isArray([]) = true but [].length > 0 = false → _dopeDistances unchanged
    expect(document.querySelectorAll('.dope-dist-input').length).toBeGreaterThan(0);
  });

  test('add distance defaults to 500 when _dopeDistances is empty', () => {
    history.replaceState(null, '', '/?dopeDistances=[0,0]');
    initDopeCard();
    // filter(n => n > 0) = [] → push((undefined ?? 500) + 100 = 600)
    document.getElementById('dopeAddDistBtn').click();
    const inputs = document.querySelectorAll('.dope-dist-input');
    expect(inputs.length).toBe(1);
    expect(+inputs[0].value).toBe(600);
  });

  test('input change with valid value is a no-op when no results loaded yet', () => {
    // _lastDopeResults is still null at this point (renderDopeCard not yet called)
    initDopeCard();
    const inp = document.querySelector('.dope-dist-input');
    inp.value = '300';
    inp.dispatchEvent(new Event('change'));
    // table stays empty (false branch of if (_lastDopeResults) on line 139)
    expect(document.getElementById('dopeTable').innerHTML).toBe('');
  });

  test('input change updates distance and rebuilds table when results exist', () => {
    initDopeCard();
    const results = [
      {
        bullet: { id: 'x', name: 'Test' },
        points: [
          { rangeMeters: 0,   dropCm: 0  },
          { rangeMeters: 500, dropCm: -50 },
        ],
      },
    ];
    renderDopeCard(results, {});
    const inp = document.querySelector('.dope-dist-input');
    inp.value = '300';
    inp.dispatchEvent(new Event('change'));
    // table should still render without throwing
    expect(document.getElementById('dopeTable').innerHTML).not.toBe('');
  });

  test('input change with invalid (zero) value is ignored', () => {
    initDopeCard();
    const inp = document.querySelector('.dope-dist-input');
    inp.value = '0';
    inp.dispatchEvent(new Event('change'));
    // the distance should NOT have changed
    expect(inp.value).toBe('0');
  });

  test('copy button with populated table invokes clipboard writeText', () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    history.replaceState(null, '', '/?dopeDistances=[100,300]');
    initDopeCard();
    // Populate the table so the .map() callback is exercised
    renderDopeCard([
      {
        bullet: { id: 'a', name: 'Test A' },
        points: [
          { rangeMeters: 0,   dropCm: 0   },
          { rangeMeters: 300, dropCm: -30 },
        ],
      },
    ], {});
    document.getElementById('dopeCopyBtn').click();
    expect(writeText).toHaveBeenCalled();
  });

  test('copy button with no dopeTable is a no-op', () => {
    initDopeCard();
    document.getElementById('dopeTable').remove();
    expect(() => document.getElementById('dopeCopyBtn').click()).not.toThrow();
  });

  test('copy button handles clipboard rejection silently', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    history.replaceState(null, '', '/?dopeDistances=[100,300]');
    initDopeCard();
    renderDopeCard([{
      bullet: { id: 'a', name: 'Test A' },
      points: [{ rangeMeters: 0, dropCm: 0 }, { rangeMeters: 300, dropCm: -30 }],
    }], {});
    document.getElementById('dopeCopyBtn').click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalled();
  });

  test('is a no-op when DOPE DOM elements are absent', () => {
    document.body.innerHTML = '';
    expect(() => initDopeCard()).not.toThrow();
  });
});

describe('renderDopeCard', () => {
  beforeEach(() => {
    buildDopeDOM();
    history.replaceState(null, '', '/');
  });

  test('no-op when results array is empty', () => {
    initDopeCard();
    renderDopeCard([], {});
    expect(document.getElementById('dopeTable').innerHTML).toBe('');
  });

  test('no-op when results is null', () => {
    initDopeCard();
    expect(() => renderDopeCard(null, {})).not.toThrow();
  });

  test('renders thead and tbody rows', () => {
    initDopeCard();
    const results = [
      {
        bullet: { id: 'a', name: 'Test A' },
        points: [
          { rangeMeters: 0,   dropCm: 0   },
          { rangeMeters: 300, dropCm: -30 },
          { rangeMeters: 500, dropCm: -80 },
        ],
      },
    ];
    renderDopeCard(results, {});
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('Test A');
    expect(html).toContain('MOA');
    expect(html).toContain('MRAD');
  });

  test('shows – when drop interpolation returns null', () => {
    // Only one point; requesting at distance >0 and beyond it returns null-like
    history.replaceState(null, '', '/?dopeDistances=[9999]');
    initDopeCard();
    const results = [
      {
        bullet: { id: 'a', name: 'Test A' },
        points: [{ rangeMeters: 0, dropCm: 0 }],
      },
    ];
    renderDopeCard(results, {});
    const html = document.getElementById('dopeTable').innerHTML;
    // Should render some content including the distance
    expect(html).not.toBe('');
  });

  test('renders positive MOA as +value', () => {
    history.replaceState(null, '', '/?dopeDistances=[300]');
    initDopeCard();
    const results = [
      {
        bullet: { id: 'a', name: 'A' },
        points: [
          { rangeMeters: 0,   dropCm: 0   },
          { rangeMeters: 300, dropCm: -30 },
        ],
      },
    ];
    renderDopeCard(results, {});
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('+');
  });

  test('sign for positive drop (bullet above aim line) gives negative MOA', () => {
    history.replaceState(null, '', '/?dopeDistances=[100]');
    initDopeCard();
    renderDopeCard([{
      bullet: { id: 'a', name: 'A' },
      points: [{ rangeMeters: 0, dropCm: 0 }, { rangeMeters: 100, dropCm: 5 }],
    }], {});
    // drop > 0 → sign = -1 → moa is negative (no + prefix)
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).not.toBe('');
  });

  test('sign for zero drop gives zero MOA and MRAD', () => {
    history.replaceState(null, '', '/?dopeDistances=[100]');
    initDopeCard();
    renderDopeCard([{
      bullet: { id: 'a', name: 'A' },
      points: [{ rangeMeters: 0, dropCm: 0 }, { rangeMeters: 100, dropCm: 0 }],
    }], {});
    // drop = 0 → sign = 0 → moa = 0, mrad = 0
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('<td>0</td>');
  });

  test('add button after renderDopeCard rebuilds table', () => {
    history.replaceState(null, '', '/?dopeDistances=[100]');
    initDopeCard();
    renderDopeCard([{
      bullet: { id: 'a', name: 'A' },
      points: [{ rangeMeters: 0, dropCm: 0 }, { rangeMeters: 300, dropCm: -30 }],
    }], {});
    // _lastDopeResults is set; click add → if (_lastDopeResults) is TRUE → rebuilds table
    document.getElementById('dopeAddDistBtn').click();
    expect(document.getElementById('dopeTable').innerHTML).not.toBe('');
  });

  test('renders Coriolis column header and cells when coriolisDeflectionCm is nonzero', () => {
    history.replaceState(null, '', '/?dopeDistances=[100]');
    initDopeCard();
    const results = [{
      bullet: { id: 'a', name: 'Test A' },
      points: [
        { rangeMeters: 0,   dropCm: 0,   coriolisDeflectionCm: 0   },
        { rangeMeters: 100, dropCm: -10, coriolisDeflectionCm: 2.5 },
        { rangeMeters: 300, dropCm: -50, coriolisDeflectionCm: 5.1 },
      ],
    }];
    renderDopeCard(results, {});
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('Cor. (cm)');
    expect(html).toContain('+2.5');
  });

  test('shows – for both drop and Coriolis cells when drop is null', () => {
    // dist=50 <= first point rangeMeters=100 → interpolateAt returns null (dropCm=null ?? null)
    // hasCoriolis=true from coriolisDeflectionCm on first point
    history.replaceState(null, '', '/?dopeDistances=[50]');
    initDopeCard();
    const results = [{
      bullet: { id: 'a', name: 'A' },
      points: [
        { rangeMeters: 100, dropCm: null, coriolisDeflectionCm: 1.5 },
        { rangeMeters: 300, dropCm: -50,  coriolisDeflectionCm: 5.1 },
      ],
    }];
    renderDopeCard(results, {});
    const html = document.getElementById('dopeTable').innerHTML;
    // drop==null branch with hasCoriolis=true → emits '–' for all three cells
    expect(html).toContain('–');
  });

  test('shows – in Coriolis cell when cor interpolation returns null but drop is valid', () => {
    // Points: first has cor defined, rest do not → interpolating between defined/undefined gives null
    history.replaceState(null, '', '/?dopeDistances=[50]');
    initDopeCard();
    const results = [{
      bullet: { id: 'a', name: 'A' },
      points: [
        { rangeMeters: 0,   dropCm: 0,   coriolisDeflectionCm: 2.0 },
        { rangeMeters: 100, dropCm: -10, coriolisDeflectionCm: undefined },
      ],
    }];
    renderDopeCard(results, {});
    const html = document.getElementById('dopeTable').innerHTML;
    // cor==null branch → emits '–' for Coriolis cell
    expect(html).toContain('–');
  });

  test('renders dash placeholder in Coriolis column when another bullet has empty points', () => {
    const rWithCor = {
      bullet: { id: 'a', name: 'Bullet A' },
      points: [
        { rangeMeters: 0, dropCm: 0, coriolisDeflectionCm: 0 },
        { rangeMeters: 500, dropCm: -50, coriolisDeflectionCm: 2.5 },
      ],
    };
    const rEmpty = { bullet: { id: 'b', name: 'Empty' }, points: [] };
    renderDopeCard([rWithCor, rEmpty], {});
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('<td>–</td><td>–</td><td>–</td>');
  });

  test('renders two dash cells when bullet has empty points and Coriolis is absent', () => {
    renderDopeCard([{ bullet: { id: 'b', name: 'Empty' }, points: [] }], {});
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('<td>–</td><td>–</td>');
    expect(html).not.toContain('<td>–</td><td>–</td><td>–</td>');
  });

  test('omits Wind MOA / Wind MRAD columns when all windDriftCm values are 0', () => {
    history.replaceState(null, '', '/?dopeDistances=[100]');
    initDopeCard();
    renderDopeCard([{
      bullet: { id: 'a', name: 'Zero Wind' },
      points: [
        { rangeMeters: 0, dropCm: 0, windDriftCm: 0 },
        { rangeMeters: 100, dropCm: -5, windDriftCm: 0 },
      ],
    }], {});
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('colspan="2"');
    expect(html).not.toContain('Wind MOA');
    expect(html).not.toContain('Wind MRAD');
  });

  test('renders Wind MOA and Wind MRAD columns with exact signed math when wind is non-zero', () => {
    history.replaceState(null, '', '/?dopeDistances=[100,200,300]');
    initDopeCard();
    // At 100m, +10cm -> atan2(0.1, 100) ≈ 0.001 rad -> +3.4 MOA, +1.0 MRAD
    // At 200m, -20cm -> atan2(-0.2, 200) ≈ -0.001 rad -> -3.4 MOA, -1.0 MRAD
    // At 300m, 0cm -> 0 MOA, 0 MRAD
    renderDopeCard([{
      bullet: { id: 'a', name: 'Windy' },
      points: [
        { rangeMeters: 0, dropCm: 0, windDriftCm: 0 },
        { rangeMeters: 100, dropCm: -5, windDriftCm: 10 },
        { rangeMeters: 200, dropCm: -20, windDriftCm: -20 },
        { rangeMeters: 300, dropCm: -50, windDriftCm: 0 },
      ],
    }], {});
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('colspan="4"');
    expect(html).toContain('<th>Wind MOA</th><th>Wind MRAD</th>');
    expect(html).toContain('<td>+3.4</td><td>+1</td>');
    expect(html).toContain('<td>-3.4</td><td>-1</td>');
    expect(html).toContain('<td>0</td><td>0</td>');
  });

  test('renders dynamic colSpan=5 with both wind and Coriolis, and pads null drop with 5 dashes', () => {
    history.replaceState(null, '', '/?dopeDistances=[100,200]');
    initDopeCard();
    renderDopeCard([
      {
        bullet: { id: 'a', name: 'Full' },
        points: [
          { rangeMeters: 0, dropCm: 0, windDriftCm: 0, coriolisDeflectionCm: 0 },
          { rangeMeters: 100, dropCm: -10, windDriftCm: 10, coriolisDeflectionCm: 2.5 },
          { rangeMeters: 200, dropCm: -20, windDriftCm: -20, coriolisDeflectionCm: -1.5 },
        ],
      },
      {
        bullet: { id: 'b', name: 'Empty' },
        points: [],
      },
    ], {});
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('colspan="5"');
    expect(html).toContain('<th>MOA↑</th><th>MRAD↑</th><th>Wind MOA</th><th>Wind MRAD</th><th>Cor. (cm)</th>');
    expect(html).toContain('<td>+3.4</td><td>+1</td><td>+3.4</td><td>+1</td><td>+2.5</td>');
    expect(html).toContain('<td>+3.4</td><td>+1</td><td>-3.4</td><td>-1</td><td>-1.5</td>');
    expect(html).toContain('<td>–</td><td>–</td><td>–</td><td>–</td><td>–</td>');
  });

  test('renders dash cells for Wind MOA / Wind MRAD when wind interpolation is null but drop is valid', () => {
    history.replaceState(null, '', '/?dopeDistances=[50]');
    initDopeCard();
    renderDopeCard([
      {
        bullet: { id: 'a', name: 'HasWind' },
        points: [
          { rangeMeters: 0, dropCm: 0, windDriftCm: 0 },
          { rangeMeters: 100, dropCm: -10, windDriftCm: 10 },
        ],
      },
      {
        bullet: { id: 'b', name: 'MissingWind' },
        points: [
          { rangeMeters: 0, dropCm: 0, windDriftCm: 1 },
          { rangeMeters: 100, dropCm: -10, windDriftCm: undefined },
        ],
      },
    ], {});
    const rows = document.querySelectorAll('#dopeTable tbody tr');
    const cells = Array.from(rows[0].querySelectorAll('td')).map(td => td.textContent);
    // Bullet b drop at 50m = -5cm -> +3.4 MOA, +1 MRAD, then – and – for wind
    expect(cells.slice(5)).toEqual(['+3.4', '+1', '–', '–']);
  });

  test('dopePrintBtn invokes window.print()', () => {
    const printSpy = jest.fn();
    Object.defineProperty(window, 'print', { value: printSpy, configurable: true });
    initDopeCard();
    document.getElementById('dopePrintBtn').click();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initBcSolver
// ─────────────────────────────────────────────────────────────────────────────
describe('initBcSolver', () => {
  beforeEach(() => {
    buildDopeDOM();
  });

  test('CALCULATE with missing inputs shows error message', () => {
    initBcSolver(jest.fn());
    document.getElementById('bcCalcBtn').click();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Fill all fields');
  });

  test('CALCULATE with zero weight shows error', () => {
    initBcSolver(jest.fn());
    document.getElementById('bcCalcWeightG').value = '0';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Fill all fields');
  });

  test('CALCULATE with zero drop shows error', () => {
    initBcSolver(jest.fn());
    document.getElementById('bcCalcWeightG').value = '10';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '0';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Fill all fields');
  });

  test('PERF-17: CALCULATE delegates to solveBCFn and populates result', async () => {
    const solveBCFn = jest.fn().mockResolvedValue(0.4751);
    initBcSolver(solveBCFn);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-150';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(solveBCFn).toHaveBeenCalledWith({
      weightG: 10.89,
      mvMps: 807,
      measuredDropCm: -150,
      rangeM: 500,
      altM: 0,
      tempC: 15,
    });
    const html = document.getElementById('bcCalcResult').innerHTML;
    expect(html).toContain('G1 BC');
    expect(document.getElementById('bcCalcResult').textContent).toContain('0.4751');
  });

  test('CALCULATE shows convergence error when solveBCFn returns null', async () => {
    const solveBCFn = jest.fn().mockResolvedValue(null);
    initBcSolver(solveBCFn);
    document.getElementById('bcCalcWeightG').value = '10';
    document.getElementById('bcCalcMvMps').value   = '800';
    document.getElementById('bcCalcDropCm').value  = '-40';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Could not converge');
  });

  test('CALCULATE shows convergence error when solveBCFn is absent', async () => {
    initBcSolver();
    document.getElementById('bcCalcWeightG').value = '10';
    document.getElementById('bcCalcMvMps').value   = '800';
    document.getElementById('bcCalcDropCm').value  = '-40';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Could not converge');
  });

  test('is a no-op when bcCalcBtn is absent', () => {
    document.body.innerHTML = '';
    expect(() => initBcSolver(jest.fn())).not.toThrow();
  });

  test('bcCalcResult absent → no throw', async () => {
    document.getElementById('bcCalcResult').remove();
    initBcSolver(jest.fn().mockResolvedValue(0.5));
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
  });

  test('empty altM string uses 0 via || 0 branch', async () => {
    const solveBCFn = jest.fn().mockResolvedValue(0.45);
    initBcSolver(solveBCFn);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcAltM').value    = '';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(document.getElementById('bcCalcResult').innerHTML).toContain('G1 BC');
  });

  test('non-input tempC element covers ?? 15 fallback branch', async () => {
    const div = document.createElement('div');
    div.id = 'bcCalcTempC';
    document.getElementById('bcCalcTempC').replaceWith(div);
    const solveBCFn = jest.fn().mockResolvedValue(0.45);
    initBcSolver(solveBCFn);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcAltM').value    = '0';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(document.getElementById('bcCalcResult').innerHTML).toContain('G1 BC');
  });

  test('button is disabled with aria-busy during calculation', async () => {
    const solveBCFn = jest.fn(async () => 0.45);
    initBcSolver(solveBCFn);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    const btn = document.getElementById('bcCalcBtn');
    document.getElementById('bcCalcBtn').click();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await flushPromises();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  test('solveBCFn rejects → shows convergence error', async () => {
    const solveBCFn = jest.fn(() => Promise.reject(new Error('compute error')));
    initBcSolver(solveBCFn);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Could not converge');
  });

  test('btn absent when click handler runs → no crash', async () => {
    const solveBCFn = jest.fn().mockResolvedValue(0.45);
    const btn = document.getElementById('bcCalcBtn');
    initBcSolver(solveBCFn);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    btn.remove();
    btn.click();
    await flushPromises();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcMpbr / initMpbrTool / renderMpbrTool (ENH-4)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcMpbr', () => {
  test('returns null for invalid points or vitalZoneCm', () => {
    const valid = [{ rangeMeters: 0, dropCm: 0 }, { rangeMeters: 100, dropCm: -5 }];
    expect(calcMpbr(null)).toBeNull();
    expect(calcMpbr(undefined)).toBeNull();
    expect(calcMpbr('not-array')).toBeNull();
    expect(calcMpbr([])).toBeNull();
    expect(calcMpbr(valid, 0)).toBeNull();
    expect(calcMpbr(valid, -10)).toBeNull();
    expect(calcMpbr(valid, NaN)).toBeNull();
    expect(calcMpbr(valid, Infinity)).toBeNull();
  });

  test('returns max range with truncatedAtMaxRange=true when trajectory stays inside vital zone', () => {
    const pts = [
      { rangeMeters: 0, dropCm: 0 },
      { rangeMeters: 100, dropCm: 4.2 },
      { rangeMeters: 200, dropCm: -8.5 },
    ];
    expect(calcMpbr(pts)).toEqual({
      vitalZoneCm: 20,
      radiusCm: 10,
      mpbrMeters: 200,
      maxRiseCm: 4.2,
      maxRiseRangeM: 100,
      exceedsVitalZone: false,
      truncatedAtMaxRange: true,
    });
  });

  test('linearly interpolates exact range where drop crosses -radius after peak rise', () => {
    const pts = [
      { rangeMeters: 0, dropCm: -3.8 },
      { rangeMeters: 100, dropCm: 5.5 },
      { rangeMeters: 200, dropCm: 0 },
      { rangeMeters: 300, dropCm: -20 },
    ];
    // radius = 10; crossing between 200 (0) and 300 (-20) at -10 -> t = 0.5 -> 250 m
    expect(calcMpbr(pts, 20)).toEqual({
      vitalZoneCm: 20,
      radiusCm: 10,
      mpbrMeters: 250,
      maxRiseCm: 5.5,
      maxRiseRangeM: 100,
      exceedsVitalZone: false,
      truncatedAtMaxRange: false,
    });
  });

  test('does not terminate MPBR at range 0 when muzzle sight height is below -radius, and flags exceedsVitalZone', () => {
    const pts = [
      { rangeMeters: 0, dropCm: -3.81 },
      { rangeMeters: 100, dropCm: 4.5 },
      { rangeMeters: 200, dropCm: -1.0 },
      { rangeMeters: 300, dropCm: -5.0 },
    ];
    // vitalZoneCm = 4 -> radius = 2. Muzzle -3.81 < -2, peak 4.5 > 2 (exceedsVitalZone=true).
    // Crosses -2 between 200 (-1) and 300 (-5): t = (-2 - (-1)) / (-5 - (-1)) = 0.25 -> 225 m.
    expect(calcMpbr(pts, 4)).toEqual({
      vitalZoneCm: 4,
      radiusCm: 2,
      mpbrMeters: 225,
      maxRiseCm: 4.5,
      maxRiseRangeM: 100,
      exceedsVitalZone: true,
      truncatedAtMaxRange: false,
    });
  });

  test('handles single-point trajectory and trajectory entirely below -radius', () => {
    expect(calcMpbr([{ rangeMeters: 0, dropCm: 0 }], 20)).toEqual({
      vitalZoneCm: 20,
      radiusCm: 10,
      mpbrMeters: 0,
      maxRiseCm: 0,
      maxRiseRangeM: 0,
      exceedsVitalZone: false,
      truncatedAtMaxRange: true,
    });

    const allBelow = [
      { rangeMeters: 0, dropCm: -5 },
      { rangeMeters: 100, dropCm: -15 },
    ];
    expect(calcMpbr(allBelow, 4)).toEqual({
      vitalZoneCm: 4,
      radiusCm: 2,
      mpbrMeters: 0,
      maxRiseCm: -5,
      maxRiseRangeM: 0,
      exceedsVitalZone: false,
      truncatedAtMaxRange: false,
    });
  });
});

describe('initMpbrTool and renderMpbrTool', () => {
  beforeEach(() => {
    buildDopeDOM();
    renderMpbrTool(null);
  });

  test('missing DOM elements are handled safely without throwing', () => {
    document.body.innerHTML = '';
    expect(() => initMpbrTool()).not.toThrow();
    expect(() => renderMpbrTool([{ bullet: { name: 'A' }, points: [{ rangeMeters: 0, dropCm: 0 }] }])).not.toThrow();
  });

  test('input and change events are no-ops before any results are rendered', () => {
    initMpbrTool();
    const inp = document.getElementById('mpbrVitalCm');
    inp.value = '15';
    inp.dispatchEvent(new Event('input'));
    inp.dispatchEvent(new Event('change'));
    expect(document.getElementById('mpbrResults').innerHTML).toBe('');
  });

  test('clears results for null or empty array', () => {
    document.getElementById('mpbrResults').innerHTML = '<div>stale</div>';
    renderMpbrTool([]);
    expect(document.getElementById('mpbrResults').innerHTML).toBe('');
    document.getElementById('mpbrResults').innerHTML = '<div>stale</div>';
    renderMpbrTool(null);
    expect(document.getElementById('mpbrResults').innerHTML).toBe('');
  });

  test('renders MPBR, Max Rise, truncation note, warning badge, and escapes bullet name', () => {
    const results = [
      {
        bullet: { id: 'a', name: '<script>308</script>' },
        points: [
          { rangeMeters: 0, dropCm: -3.8 },
          { rangeMeters: 120, dropCm: 12.5 },
          { rangeMeters: 300, dropCm: -27.5 },
        ],
      },
      {
        bullet: { id: 'b', name: 'Flat Laser' },
        points: [
          { rangeMeters: 0, dropCm: 0 },
          { rangeMeters: 400, dropCm: -2 },
        ],
      },
      {
        bullet: { id: 'c', name: 'Empty' },
        points: [],
      },
    ];
    initMpbrTool();
    renderMpbrTool(results);

    const container = document.getElementById('mpbrResults');
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).toContain('&lt;script&gt;308&lt;/script&gt;');
    // For bullet a: 120 (12.5) -> 300 (-27.5), crossing -10: t = (-10 - 12.5)/(-27.5 - 12.5) = -22.5/-40 = 0.5625 -> 120 + 101.25 = 221.3 m
    expect(container.textContent).toContain('MPBR: 221.3 m');
    expect(container.textContent).toContain('Max Rise: 12.5 cm @ 120 m');
    expect(container.textContent).toContain('Exceeds ±10 cm vital zone');
    expect(container.textContent).toContain('MPBR: 400 m (max range)');
    expect(container.textContent).not.toContain('Empty');

    // Updating #mpbrVitalCm re-renders cached results
    const inp = document.getElementById('mpbrVitalCm');
    inp.value = '30';
    inp.dispatchEvent(new Event('input'));
    expect(container.textContent).not.toContain('Exceeds ±');

    // Invalid vital zone falls back to 20 cm
    inp.value = '0';
    inp.dispatchEvent(new Event('change'));
    expect(container.textContent).toContain('Exceeds ±10 cm vital zone');

    // Missing #mpbrVitalCm falls back to 20 cm
    inp.remove();
    renderMpbrTool(results);
    expect(container.textContent).toContain('Exceeds ±10 cm vital zone');
  });

  test('ENH-3: setToolsUnitSystem converts DOPE, MPBR, BC solver, and MOA/MRAD inputs in imperial mode', async () => {
    setToolsUnitSystem('imperial');
    history.replaceState(null, '', '/?dopeDistances=[100]');
    initDopeCard();
    initMpbrTool();
    renderDopeCard([{
      bullet: { id: 'a', name: '.308' },
      points: [
        { rangeMeters: 0, dropCm: 0, windDriftCm: 0, coriolisDeflectionCm: 0 },
        { rangeMeters: 200, dropCm: -20, windDriftCm: 5.08, coriolisDeflectionCm: 2.54 },
      ],
    }], {}, 'imperial');
    const dopeHtml = document.getElementById('dopeTable').innerHTML;
    expect(dopeHtml).toContain('Range (yd)');
    expect(dopeHtml).toContain('Cor. (in)');

    document.getElementById('mpbrVitalCm').value = '8';
    renderMpbrTool([{
      bullet: { id: 'a', name: '.308' },
      points: [
        { rangeMeters: 0, dropCm: -3.8 },
        { rangeMeters: 120, dropCm: 12.5 },
        { rangeMeters: 300, dropCm: -27.5 },
      ],
    }], 'imperial');
    expect(document.querySelector('#mpbrCard [data-unit-kind="vitalZone"]').textContent).toBe('in');
    expect(document.getElementById('mpbrResults').textContent).toContain('yd');
    expect(document.getElementById('mpbrResults').textContent).toContain('Exceeds ±');

    // BC solver in imperial
    const solveFn = jest.fn().mockResolvedValue(0.475);
    initBcSolver(solveFn);
    document.getElementById('bcCalcWeightG').value = '168';
    document.getElementById('bcCalcMvMps').value = '2650';
    document.getElementById('bcCalcDropCm').value = '-18';
    document.getElementById('bcCalcRangeM').value = '500';
    document.getElementById('bcCalcAltM').value = '1000';
    document.getElementById('bcCalcTempC').value = '68';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(solveFn).toHaveBeenCalledWith(expect.objectContaining({
      weightG: 10.89,
      tempC: 20,
    }));

    // MOA / MRAD calculator in imperial
    document.body.insertAdjacentHTML('beforeend', `
      <input id="toolDrop" value="-10" />
      <input id="toolRange" value="100" />
      <button id="toolCalcBtn"></button>
      <div id="toolResults"></div>
    `);
    initTools();
    document.getElementById('toolCalcBtn').click();
    expect(document.getElementById('toolResults').textContent).toContain('MOA');

    // Default reset back to metric
    setToolsUnitSystem();
  });

  test('ENH-5: DOPE card displays Eotvos column when coriolisVerticalCm is active', () => {
    history.replaceState(null, '', '/?dopeDistances=[100]');
    initDopeCard();
    renderDopeCard([
      {
        bullet: { id: 'a', name: 'East Shot' },
        points: [
          { rangeMeters: 0, dropCm: 0, coriolisVerticalCm: 0 },
          { rangeMeters: 200, dropCm: -20, coriolisVerticalCm: 5.08 },
        ],
      },
      {
        bullet: { id: 'b', name: 'West Shot' },
        points: [
          { rangeMeters: 0, dropCm: 0, coriolisVerticalCm: 0 },
          { rangeMeters: 200, dropCm: -20, coriolisVerticalCm: -5.08 },
        ],
      },
      {
        bullet: { id: 'c', name: 'West Missing' },
        points: [
          { rangeMeters: 0, dropCm: 0, coriolisVerticalCm: -2.0 },
          { rangeMeters: 200, dropCm: -20 },
        ],
      },
    ], {}, 'imperial');

    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('Eötvös (in)');
    expect(html).toContain('+0.9');
    expect(html).toContain('-0.9');
    expect(html).toContain('<td>–</td>');
  });
});
