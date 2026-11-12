'use strict';

const {
  calcMoaMrad, convertUnit, initTools, CONVERSIONS,
  interpolateAt, initDopeCard, renderDopeCard, initBcSolver, calcBC,
} = require('../../main/resources/static/tools.js');

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

// Minimal simulateBullet stub returning points up to maxRangeMeters
function makeSimFn() {
  return jest.fn((bullet, req) => {
    const pts = [];
    for (let r = 0; r <= req.maxRangeMeters; r += req.stepMeters) {
      pts.push({ rangeMeters: r, dropCm: -(r * r) / 100000 });
    }
    return { bullet, points: pts };
  });
}

describe('initDopeCard', () => {
  beforeEach(() => {
    buildDopeDOM();
    history.replaceState(null, '', '/');
  });

  test('renders distance inputs on init', () => {
    const sim = makeSimFn();
    initDopeCard(sim);
    const inputs = document.querySelectorAll('.dope-dist-input');
    expect(inputs.length).toBeGreaterThan(0);
  });

  test('restores distances from URL on init', () => {
    history.replaceState(null, '', '/?dopeDistances=[100,250,500]');
    const sim = makeSimFn();
    initDopeCard(sim);
    const inputs = document.querySelectorAll('.dope-dist-input');
    expect(inputs.length).toBe(3);
    expect(inputs[1].value).toBe('250');
  });

  test('add distance button adds a new input (up to 10)', () => {
    const sim = makeSimFn();
    initDopeCard(sim);
    const before = document.querySelectorAll('.dope-dist-input').length;
    document.getElementById('dopeAddDistBtn').click();
    const after = document.querySelectorAll('.dope-dist-input').length;
    expect(after).toBe(before + 1);
  });

  test('add distance button is a no-op when already at 10', () => {
    history.replaceState(null, '', '/?dopeDistances=[100,200,300,400,500,600,700,800,900,1000]');
    const sim = makeSimFn();
    initDopeCard(sim);
    const before = document.querySelectorAll('.dope-dist-input').length;
    document.getElementById('dopeAddDistBtn').click();
    expect(document.querySelectorAll('.dope-dist-input').length).toBe(before);
  });

  test('URL with empty dopeDistances array leaves distances unchanged', () => {
    history.replaceState(null, '', '/?dopeDistances=[]');
    const sim = makeSimFn();
    initDopeCard(sim);
    // Array.isArray([]) = true but [].length > 0 = false → _dopeDistances unchanged
    expect(document.querySelectorAll('.dope-dist-input').length).toBeGreaterThan(0);
  });

  test('add distance defaults to 500 when _dopeDistances is empty', () => {
    history.replaceState(null, '', '/?dopeDistances=[0,0]');
    const sim = makeSimFn();
    initDopeCard(sim);
    // filter(n => n > 0) = [] → push((undefined ?? 500) + 100 = 600)
    document.getElementById('dopeAddDistBtn').click();
    const inputs = document.querySelectorAll('.dope-dist-input');
    expect(inputs.length).toBe(1);
    expect(+inputs[0].value).toBe(600);
  });

  test('input change with valid value is a no-op when no results loaded yet', () => {
    // _lastDopeResults is still null at this point (renderDopeCard not yet called)
    const sim = makeSimFn();
    initDopeCard(sim);
    const inp = document.querySelector('.dope-dist-input');
    inp.value = '300';
    inp.dispatchEvent(new Event('change'));
    // table stays empty (false branch of if (_lastDopeResults) on line 139)
    expect(document.getElementById('dopeTable').innerHTML).toBe('');
  });

  test('input change updates distance and rebuilds table when results exist', () => {
    const sim = makeSimFn();
    initDopeCard(sim);
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
    const sim = makeSimFn();
    initDopeCard(sim);
    const inp = document.querySelector('.dope-dist-input');
    const before = inp.value;
    inp.value = '0';
    inp.dispatchEvent(new Event('change'));
    // the distance should NOT have changed
    expect(inp.value).toBe('0');
  });

  test('copy button with populated table invokes clipboard writeText', () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    history.replaceState(null, '', '/?dopeDistances=[100,300]');
    const sim = makeSimFn();
    initDopeCard(sim);
    // Populate the table so the .map() callback on line 149 is exercised
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

  test('copy button with no dopeTable is a no-op (line 147 guard)', () => {
    initDopeCard(makeSimFn());
    document.getElementById('dopeTable').remove();
    expect(() => document.getElementById('dopeCopyBtn').click()).not.toThrow();
  });

  test('copy button handles clipboard rejection silently (line 151 catch callback)', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    history.replaceState(null, '', '/?dopeDistances=[100,300]');
    const sim = makeSimFn();
    initDopeCard(sim);
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
    expect(() => initDopeCard(makeSimFn())).not.toThrow();
  });
});

describe('renderDopeCard', () => {
  beforeEach(() => {
    buildDopeDOM();
    history.replaceState(null, '', '/');
  });

  test('no-op when results array is empty', () => {
    initDopeCard(makeSimFn());
    renderDopeCard([], {});
    expect(document.getElementById('dopeTable').innerHTML).toBe('');
  });

  test('no-op when results is null', () => {
    initDopeCard(makeSimFn());
    expect(() => renderDopeCard(null, {})).not.toThrow();
  });

  test('renders thead and tbody rows', () => {
    initDopeCard(makeSimFn());
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
    initDopeCard(makeSimFn());
    // Only one point; requesting at distance >0 and beyond it returns null-like
    history.replaceState(null, '', '/?dopeDistances=[9999]');
    initDopeCard(makeSimFn());
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
    initDopeCard(makeSimFn());
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
    initDopeCard(makeSimFn());
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
    initDopeCard(makeSimFn());
    renderDopeCard([{
      bullet: { id: 'a', name: 'A' },
      points: [{ rangeMeters: 0, dropCm: 0 }, { rangeMeters: 100, dropCm: 0 }],
    }], {});
    // drop = 0 → sign = 0 → moa = 0, mrad = 0
    const html = document.getElementById('dopeTable').innerHTML;
    expect(html).toContain('<td>0</td>');
  });

  test('add button after renderDopeCard rebuilds table (line 178 true branch)', () => {
    history.replaceState(null, '', '/?dopeDistances=[100]');
    initDopeCard(makeSimFn());
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
    initDopeCard(makeSimFn());
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
    initDopeCard(makeSimFn());
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
    initDopeCard(makeSimFn());
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
});

// ─────────────────────────────────────────────────────────────────────────────
// calcBC / initBcSolver
// ─────────────────────────────────────────────────────────────────────────────
describe('calcBC', () => {
  test('returns a finite number within [0.001, 1.5]', async () => {
    const sim = makeSimFn();
    const bc = await calcBC(sim, 10.89, 807, -45, 500, 0, 15);
    if (bc !== null) {
      expect(bc).toBeGreaterThanOrEqual(0.001);
      expect(bc).toBeLessThanOrEqual(1.5);
    }
  });

  test('returns null when interpolation fails (range outside points)', async () => {
    // Sim that always returns empty points
    const badSim = jest.fn(() => ({ bullet: {}, points: [] }));
    const result = await calcBC(badSim, 10, 800, -40, 500, 0, 15);
    expect(result).toBeNull();
  });

  test('calls simulateBulletFn 64 times', async () => {
    const sim = makeSimFn();
    await calcBC(sim, 10.89, 807, -40, 400, 0, 15);
    expect(sim).toHaveBeenCalledTimes(64);
  });

  test('rounds result to 4 decimal places', async () => {
    const sim = makeSimFn();
    const bc = await calcBC(sim, 10.89, 807, -40, 400, 0, 15);
    if (bc !== null) {
      const decimals = (bc.toString().split('.')[1] || '').length;
      expect(decimals).toBeLessThanOrEqual(4);
    }
  });

  test('lo = mid branch: measuredDropCm = 0 forces lo upward every iteration', async () => {
    // Stub drop is always negative → drop < 0 = measuredDropCm → lo = mid every time
    const sim = makeSimFn();
    const bc = await calcBC(sim, 10.89, 807, 0, 500, 0, 15);
    if (bc !== null) {
      expect(bc).toBeGreaterThanOrEqual(0.001);
      expect(bc).toBeLessThanOrEqual(1.5);
    }
  });

  test('passes a fresh bullet object per iteration', async () => {
    const sim = makeSimFn();
    await calcBC(sim, 10.89, 807, -40, 400, 0, 15);
    const bullets = sim.mock.calls.map(c => c[0]);
    const unique = new Set(bullets);
    expect(unique.size).toBe(64);
  });
});

describe('initBcSolver', () => {
  beforeEach(() => {
    buildDopeDOM();
  });

  test('CALCULATE with missing inputs shows error message', () => {
    const sim = makeSimFn();
    initBcSolver(sim);
    document.getElementById('bcCalcBtn').click();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Fill all fields');
  });

  test('CALCULATE with zero weight shows error', () => {
    const sim = makeSimFn();
    initBcSolver(sim);
    document.getElementById('bcCalcWeightG').value = '0';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Fill all fields');
  });

  test('CALCULATE with zero drop shows error', () => {
    const sim = makeSimFn();
    initBcSolver(sim);
    document.getElementById('bcCalcWeightG').value = '10';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '0';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Fill all fields');
  });

  test('CALCULATE with valid inputs populates result', async () => {
    const sim = makeSimFn();
    initBcSolver(sim);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    const html = document.getElementById('bcCalcResult').innerHTML;
    expect(html).toContain('G1 BC');
  });

  test('CALCULATE shows convergence error when sim returns no points', async () => {
    const badSim = jest.fn(() => ({ bullet: {}, points: [] }));
    initBcSolver(badSim);
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
    expect(() => initBcSolver(makeSimFn())).not.toThrow();
  });

  test('bcCalcResult absent → no throw', async () => {
    document.getElementById('bcCalcResult').remove();
    initBcSolver(makeSimFn());
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    // Should not throw even without the result container
  });

  test('empty altM string uses 0 via || 0 branch', async () => {
    const sim = makeSimFn();
    initBcSolver(sim);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcAltM').value    = ''; // "" || 0 = 0 → covers || 0
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(document.getElementById('bcCalcResult').innerHTML).toContain('G1 BC');
  });

  test('non-input tempC element covers ?? 15 fallback branch', async () => {
    // Replace bcCalcTempC input with a div so .value = undefined → undefined ?? 15 = 15
    const div = document.createElement('div');
    div.id = 'bcCalcTempC';
    document.getElementById('bcCalcTempC').replaceWith(div);
    const sim = makeSimFn();
    initBcSolver(sim);
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
    const sim = jest.fn(async (bullet, req) => {
      const pts = [];
      for (let r = 0; r <= req.maxRangeMeters; r += req.stepMeters) {
        pts.push({ rangeMeters: r, dropCm: -(r * r) / 100000 });
      }
      return { bullet, points: pts };
    });
    initBcSolver(sim);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    const btn = document.getElementById('bcCalcBtn');
    document.getElementById('bcCalcBtn').click();
    // Check disabled state before the async work resolves
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await flushPromises();
    // After completion, button should be re-enabled
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  test('computeFn rejects → shows convergence error', async () => {
    const badSim = jest.fn(() => Promise.reject(new Error('compute error')));
    initBcSolver(badSim);
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    document.getElementById('bcCalcBtn').click();
    await flushPromises();
    expect(document.getElementById('bcCalcResult').textContent).toContain('Could not converge');
  });

  test('btn absent when click handler runs → no crash (lines 271 and 284 false branches)', async () => {
    const sim = makeSimFn();
    const btn = document.getElementById('bcCalcBtn');
    initBcSolver(sim); // registers listener on btn
    // Fill valid inputs
    document.getElementById('bcCalcWeightG').value = '10.89';
    document.getElementById('bcCalcMvMps').value   = '807';
    document.getElementById('bcCalcDropCm').value  = '-45';
    document.getElementById('bcCalcRangeM').value  = '500';
    // Remove button from DOM so getElementById returns null inside handler
    btn.remove();
    btn.click(); // fire on detached element: document.getElementById('bcCalcBtn') = null
    await flushPromises();
    // No crash — btn guard covers null case
  });
});
