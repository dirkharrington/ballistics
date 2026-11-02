'use strict';

const { calcMoaMrad, convertUnit, initTools, CONVERSIONS } = require('../../main/resources/static/tools.js');

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
