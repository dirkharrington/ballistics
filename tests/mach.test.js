import {
  speedOfSound, findMachCrossing, resultSpeedOfSound,
  formatMach, machRangeText, TRANSONIC_MACH, SUBSONIC_MACH,
} from '../app/mach.js';
import { renderStatCards } from '../app/charts.js';
import { exportCSV, exportJSON, exportMarkdown } from '../app/io.js';
import { renderTable } from '../app/table.js';
import { computeAdjustments, escapeHtml } from '../app/prefs.js';

const mkResult = (velocities, temp = 15, step = 100) => ({
  bullet: { id: 'b', name: 'B', muzzleVelocityMps: velocities[0], muzzleEnergyJoules: 1, bulletWeightGrams: 10, ballisticCoefficient: 0.4 },
  request: temp === undefined ? undefined : { temperatureC: temp },
  supersonicLimitMeters: 0, maxOrdinateCm: 0, maxOrdinateRangeMeters: 0,
  points: velocities.map((v, i) => ({
    rangeMeters: i * step, dropCm: -i, velocityMps: v, energyJoules: 100, windDriftCm: 0, timeOfFlightSec: i * 0.1,
  })),
});

describe('speedOfSound', () => {
  test('0 °C', () => expect(speedOfSound(0)).toBeCloseTo(331.3, 5));
  test('15 °C', () => expect(speedOfSound(15)).toBeCloseTo(340.3, 0));
  test('20 °C', () => expect(speedOfSound(20)).toBeCloseTo(343.2, 0));
});

describe('findMachCrossing', () => {
  const sos = 340;
  test('interpolates a normal crossing', () => {
    // Mach 1.0 -> 340. 440 @ 0, 240 @ 100 => crossing at 50 m
    expect(findMachCrossing([{ range: 0, velocity: 440 }, { range: 100, velocity: 240 }], 1, sos)).toBeCloseTo(50, 6);
  });
  test('already subsonic at row 0 returns null', () => {
    expect(findMachCrossing([{ range: 0, velocity: 300 }, { range: 100, velocity: 250 }], 1, sos)).toBeNull();
  });
  test('never subsonic returns null', () => {
    expect(findMachCrossing([{ range: 0, velocity: 900 }, { range: 100, velocity: 800 }], 1, sos)).toBeNull();
  });
  test('exact step boundary returns that row range', () => {
    expect(findMachCrossing([{ range: 0, velocity: 500 }, { range: 100, velocity: 340 }, { range: 200, velocity: 300 }], 1, sos)).toBe(100);
  });
  test('single row returns null', () => {
    expect(findMachCrossing([{ range: 0, velocity: 900 }], 1, sos)).toBeNull();
    expect(findMachCrossing([], 1, sos)).toBeNull();
  });
  test('Mach 1.2 threshold', () => {
    expect(findMachCrossing([{ range: 0, velocity: 508 }, { range: 100, velocity: 308 }], 1.2, sos)).toBeCloseTo(50, 6);
  });
});

describe('resultSpeedOfSound / formatMach', () => {
  test('uses request temperature, defaults to 15 °C', () => {
    expect(resultSpeedOfSound(mkResult([800], 0))).toBeCloseTo(331.3, 5);
    expect(resultSpeedOfSound(mkResult([800], undefined))).toBeCloseTo(speedOfSound(15), 6);
    expect(resultSpeedOfSound({ request: {} })).toBeCloseTo(speedOfSound(15), 6);
    expect(resultSpeedOfSound(undefined)).toBeCloseTo(speedOfSound(15), 6);
  });
  test('formatMach gives two decimals', () => {
    expect(formatMach(340, 340)).toBe('1.00');
    expect(formatMach(510, 340)).toBe('1.50');
  });
});

describe('machRangeText', () => {
  test('crossing in metric and imperial', () => {
    const r = mkResult([600, 500, 400, 300, 200]); // sos ≈ 340.3
    // sos ≈ 340.3: 400 -> 300 between 200 m and 300 m, crossing ≈ 260 m
    expect(machRangeText(r, SUBSONIC_MACH, 'metric')).toBe('260 m');
    expect(machRangeText(r, TRANSONIC_MACH, 'imperial')).toMatch(/yd$/);
  });
  test('beyond max range', () => {
    expect(machRangeText(mkResult([900, 800]), 1)).toBe('Beyond max range');
  });
  test('already below at muzzle', () => {
    expect(machRangeText(mkResult([300, 250]), 1)).toBe('At muzzle');
  });
  test('empty points are beyond range', () => {
    expect(machRangeText({ request: {}, points: [] }, 1)).toBe('Beyond max range');
  });
});

describe('stat cards, table, exports include Mach', () => {
  const results = [mkResult([600, 500, 400, 300])];
  test('stat card shows transonic and subsonic', () => {
    const wrap = document.createElement('div');
    renderStatCards(results, wrap);
    expect(wrap.textContent).toMatch(/transonic \(Mach 1\.2, ambient\)/);
    expect(wrap.textContent).toMatch(/subsonic \(Mach 1\.0, ambient\)/);
    expect(wrap.textContent).toMatch(/\d+ m\s+subsonic/);
  });
  test('table row has Mach cell', () => {
    document.body.innerHTML = '<table id="dataTable"><thead><tr></tr></thead><tbody id="tableBody"></tbody></table>';
    renderTable(results, 'metric');
    expect(document.getElementById('tableBody').textContent).toContain('1.76'); // 600/340.3
  });
  describe('exports', () => {
    let blobs;
    beforeEach(() => {
      blobs = [];
      global.URL.createObjectURL = jest.fn(b => { blobs.push(b); return 'blob:x'; });
      global.URL.revokeObjectURL = jest.fn();
      HTMLAnchorElement.prototype.click = jest.fn();
    });
    const text = b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsText(b); });
    test('CSV', async () => {
      exportCSV(results, computeAdjustments, 'metric');
      const t = await text(blobs[0]);
      expect(t.split('\n')[0]).toMatch(/,Mach$/);
      expect(t.split('\n')[1]).toMatch(/,1\.76$/);
    });
    test('Markdown', async () => {
      exportMarkdown(results, { computeAdjustments, escapeHtml });
      const t = await text(blobs[0]);
      expect(t).toContain('| Mach |');
      expect(t).toMatch(/\| 1\.76 \|/);
    });
    test('JSON', async () => {
      exportJSON(results);
      const parsed = JSON.parse(await text(blobs[0]));
      expect(parsed[0].points[0].mach).toBe(1.76);
      expect(results[0].points[0].mach).toBeUndefined();
    });
  });
});
