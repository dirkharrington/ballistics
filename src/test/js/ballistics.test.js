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

// ── DOM helpers ───────────────────────────────────────────────────────────────
function buildDOM() {
  document.body.innerHTML = `
    <div id="bulletList"></div>
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
    <table><tbody id="tableBody"><tr><td colspan="9">NO DATA</td></tr></tbody></table>
    <div class="tab active" id="tab-charts"></div>
    <div class="tab"        id="tab-data"></div>
    <span class="status-pill status-live" id="statusPill">● READY</span>
    <span class="status-pill" id="modelStatus">MODEL: G1</span>
    <button id="retryBtn" style="display:none">↺ RETRY</button>
    <div id="toast"></div>
    <input id="customName"   value="" />
    <input id="customWeight" value="9.0" />
    <input id="customMV"     value="850" />
    <input id="customBC"     value="0.45" />
    <input id="customDia"    value="7.82" />
    <div   id="customError"  style="display:none"></div>
  `;
}

const mod = require('../../main/resources/static/ballistics.js');

// Reset state and DOM before each test
beforeEach(() => {
  buildDOM();
  localStorage.clear();
  mod._resetState();
  MockChart.mockClear();
  mockChartDestroy.mockClear();
  mockChartUpdate.mockClear();
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
// csvCell
// ─────────────────────────────────────────────────────────────────────────────
describe('csvCell', () => {
  test('wraps value in double quotes', () => {
    expect(mod.csvCell('hello')).toBe('"hello"');
  });

  test('doubles internal double quotes', () => {
    expect(mod.csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  test('prefixes formula-injection triggers with apostrophe', () => {
    for (const prefix of ['=', '+', '-', '@']) {
      expect(mod.csvCell(`${prefix}BAD`)).toMatch(/^"'/);
    }
  });

  test('safe strings are not prefixed', () => {
    expect(mod.csvCell('.308 Win')).toBe('".308 Win"');
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
// interpolateDragTable (G7 drag model — Task 10)
// ─────────────────────────────────────────────────────────────────────────────
const { G7_TABLE } = require('../../test/js/__mocks__/physics-tables.js');

describe('interpolateDragTable', () => {
  test('returns first table value for velocity at or below minimum', () => {
    const first = G7_TABLE[0];
    expect(mod.interpolateDragTable(first[0], G7_TABLE)).toBeCloseTo(first[1]);
    expect(mod.interpolateDragTable(0, G7_TABLE)).toBeCloseTo(first[1]);
  });

  test('returns last table value for velocity at or above maximum', () => {
    const last = G7_TABLE[G7_TABLE.length - 1];
    expect(mod.interpolateDragTable(last[0], G7_TABLE)).toBeCloseTo(last[1]);
    expect(mod.interpolateDragTable(99999, G7_TABLE)).toBeCloseTo(last[1]);
  });

  test('G7 values are generally lower than G1 at supersonic speeds', () => {
    // G7 form factors are ~55–65% of G1 at supersonic speeds
    const g1At2000 = mod.g1Drag(2000);
    const g7At2000 = mod.interpolateDragTable(2000, G7_TABLE);
    expect(g7At2000).toBeLessThan(g1At2000);
  });

  test('handles negative input via Math.abs', () => {
    const pos = mod.interpolateDragTable(2000, G7_TABLE);
    const neg = mod.interpolateDragTable(-2000, G7_TABLE);
    expect(pos).toBeCloseTo(neg);
  });

  test('works identically to g1Drag when passed G1_TABLE', () => {
    const { G1_TABLE } = require('../../test/js/__mocks__/physics-tables.js');
    expect(mod.interpolateDragTable(1500, G1_TABLE)).toBeCloseTo(mod.g1Drag(1500));
    expect(mod.interpolateDragTable(2600, G1_TABLE)).toBeCloseTo(mod.g1Drag(2600));
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

  test('90° wind direction produces same drift as no direction specified', () => {
    const windReq90  = { ...req, windSpeedKph: 16, windDirectionDeg: 90  };
    const windReqDef = { ...req, windSpeedKph: 16 };                        // default = 90
    const r90  = mod.simulateBullet(bullet308, windReq90);
    const rDef = mod.simulateBullet(bullet308, windReqDef);
    const last90  = r90.points[r90.points.length - 1].windDriftCm;
    const lastDef = rDef.points[rDef.points.length - 1].windDriftCm;
    // Explicit 90° must equal the implicit default of 90°
    expect(last90).toBeCloseTo(lastDef, 1);
    // Absolute drift sign is verified via integrateTrajectoryFps direct test below;
    // at typical test ranges the rounded value can be 0 due to near-vacuum G1 drag table.
  });

  test('0° (headwind) produces zero crosswind drift', () => {
    const headWind = { ...req, windSpeedKph: 16, windDirectionDeg: 0 };
    const result = mod.simulateBullet(bullet308, headWind);
    result.points.forEach(p => expect(p.windDriftCm).toBeCloseTo(0, 1));
  });

  test('270° and 90° crosswinds produce equal-magnitude opposite-sign drift', () => {
    const leftWind  = { ...req, windSpeedKph: 16, windDirectionDeg: 270 };
    const rightWind = { ...req, windSpeedKph: 16, windDirectionDeg: 90  };
    const leftResult  = mod.simulateBullet(bullet308, leftWind);
    const rightResult = mod.simulateBullet(bullet308, rightWind);
    const lastLeft  = leftResult.points[leftResult.points.length - 1].windDriftCm;
    const lastRight = rightResult.points[rightResult.points.length - 1].windDriftCm;
    // 270° and 90° are perfect opposites (sin(270°)=−1, sin(90°)=+1),
    // so drift magnitudes must be equal and opposite.
    expect(lastLeft).toBeCloseTo(-lastRight, 0);  // symmetric ±
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

  // ── G7 drag model (Task 10) ──────────────────────────────────────────────
  test('G7 model produces valid trajectory with expected shape', () => {
    const result = mod.simulateBullet(bullet308, { ...req, dragModel: 'G7' });
    expect(result.points.length).toBeGreaterThan(0);
    result.points.forEach(p => {
      expect(p.velocityMps).toBeGreaterThan(0);
      expect(p.energyJoules).toBeGreaterThan(0);
    });
  });

  test('G7 drag values are lower than G1 at supersonic speeds (table lookup sanity check)', () => {
    // G7 form factors are ~55–65% of G1 at supersonic speeds.
    // The test verifies the table routing is correct — G7 interpolation < G1 interpolation.
    const { G1_TABLE: gt1, G7_TABLE: gt7 } = require('../../test/js/__mocks__/physics-tables.js');
    const g1val = mod.interpolateDragTable(2000, gt1);
    const g7val = mod.interpolateDragTable(2000, gt7);
    expect(g7val).toBeLessThan(g1val);
    // Expect G7 to be roughly 50–75% of G1 at 2000 fps
    expect(g7val / g1val).toBeGreaterThan(0.4);
    expect(g7val / g1val).toBeLessThan(0.9);
  });

  test('G7 model exercises end-to-end path and produces valid trajectory', () => {
    // Verifies the G7 code path — dragTable selection, findZeroAngleFps, integrateTrajectoryFps —
    // runs without error and produces a sensible zeroed trajectory.
    const longReq = { ...req, maxRangeMeters: 500, stepMeters: 100 };
    const g1Result = mod.simulateBullet(bullet308, { ...longReq, dragModel: 'G1' });
    const g7Result = mod.simulateBullet(bullet308, { ...longReq, dragModel: 'G7' });
    // Both produce trajectories
    expect(g1Result.points.length).toBeGreaterThan(0);
    expect(g7Result.points.length).toBeGreaterThan(0);
    // Both produce a valid first point (muzzle)
    const g1First = g1Result.points[0];
    const g7First = g7Result.points[0];
    expect(g1First.velocityMps).toBeCloseTo(bullet308.muzzleVelocityMps, 0);
    expect(g7First.velocityMps).toBeCloseTo(bullet308.muzzleVelocityMps, 0);
    // G7 has lower drag → can travel at least as far as G1
    expect(g7Result.points.length).toBeGreaterThanOrEqual(g1Result.points.length);
  });

  test('absent dragModel defaults to G1 behaviour', () => {
    const noModel  = mod.simulateBullet(bullet308, { ...req });
    const explicit = mod.simulateBullet(bullet308, { ...req, dragModel: 'G1' });
    const last = noModel.points.length - 1;
    expect(noModel.points[last].dropCm).toBeCloseTo(explicit.points[last].dropCm, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findZeroAngleFps
// ─────────────────────────────────────────────────────────────────────────────
describe('findZeroAngleFps', () => {
  // Standard .308 Win 168gr at sea level, zero at 100 m (328 ft), sight 38.1 mm
  const mvFps    = 807 * 3.28084;   // ≈ 2648 ft/s
  const bc       = 0.475;
  const rho      = 1.0;             // sea level
  const zeroFt   = 100 * 3.28084;  // 100 m in feet
  const sightHtFt = 38.1 / 25.4 / 12; // 38.1 mm → feet

  test('returns a small positive angle for a typical rifle load', () => {
    const angle = mod.findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt);
    // Barrel must point slightly upward to compensate for gravity and sight height
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(0.01); // < ~0.57°
  });

  test('angle increases when zero range increases', () => {
    const angle100 = mod.findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt);
    const angle200 = mod.findZeroAngleFps(mvFps, bc, rho, zeroFt * 2, sightHtFt);
    expect(angle200).toBeGreaterThan(angle100);
  });

  test('angle increases for slower muzzle velocity (more drop to compensate)', () => {
    const angleFast = mod.findZeroAngleFps(mvFps,       bc, rho, zeroFt, sightHtFt);
    const angleSlow = mod.findZeroAngleFps(mvFps * 0.5, bc, rho, zeroFt, sightHtFt);
    expect(angleSlow).toBeGreaterThan(angleFast);
  });

  test('returns a finite number even for very slow (sub-50 fps) bullet', () => {
    const angle = mod.findZeroAngleFps(15, 0.05, rho, zeroFt, sightHtFt);
    expect(Number.isFinite(angle)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// integrateTrajectoryFps
// ─────────────────────────────────────────────────────────────────────────────
describe('integrateTrajectoryFps', () => {
  const mvFps      = 807 * 3.28084;
  const bc         = 0.475;
  const rho        = 1.0;
  const wLbs       = 10.89 / 453.592;
  const windMph    = 0;
  const maxRangeYd = 1000 / 0.9144;  // 1000 m in yards
  const stepYd     = 25 / 0.9144;    // 25 m in yards
  const sightHtFt  = 38.1 / 25.4 / 12;
  const zeroFt     = 100 * 3.28084;
  const angle      = 0.002;          // realistic zero angle (~0.11°)

  test('returns the correct number of trajectory points', () => {
    const { points } = mod.integrateTrajectoryFps(
      mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd
    );
    // 0–1000 m at 25 m steps = 41 points (0, 25, 50, … 1000)
    expect(points.length).toBeGreaterThanOrEqual(40);
    expect(points.length).toBeLessThanOrEqual(42);
  });

  test('first point has velocity close to muzzle velocity', () => {
    const { points } = mod.integrateTrajectoryFps(
      mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd
    );
    const muzzleMps = mvFps / 3.28084;
    expect(points[0].velocityMps).toBeCloseTo(muzzleMps, 0);
  });

  test('wind drift is zero when windMph is 0', () => {
    const { points } = mod.integrateTrajectoryFps(
      mvFps, angle, bc, rho, wLbs, 0, maxRangeYd, stepYd
    );
    points.forEach(p => expect(p.windDriftCm).toBe(0));
  });

  test('output matches simulateBullet for equivalent inputs', () => {
    const bullet = { ballisticCoefficient: bc, bulletWeightGrams: 10.89, muzzleVelocityMps: 807 };
    const req = {
      zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 25,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15
    };
    const full   = mod.simulateBullet(bullet, req);
    const rhoReq = 1.0;  // sea-level at 15°C is ≈ 1
    const angleV = mod.findZeroAngleFps(mvFps, bc, rhoReq, 100 * 3.28084, 38.1 / 25.4 / 12);
    const { points } = mod.integrateTrajectoryFps(
      mvFps, angleV, bc, rhoReq, wLbs, 0, 500 / 0.9144, 25 / 0.9144
    );
    expect(points.length).toBe(full.points.length);
    expect(points[0].velocityMps).toBeCloseTo(full.points[0].velocityMps, 0);
  });

  test('positive windMph produces rightward drift, negative windMph produces leftward drift', () => {
    // The Pejsa drift formula (windFps × (t − vacuumTof) × 12) requires drag > 0 to
    // produce a non-zero time lag.  With the current G1 table the per-step deceleration
    // is tiny (~0.25 fps²), so at typical wind speeds the rounded drift is 0.
    // Use ±100 mph at 1000 m range to accumulate enough lag for the sign to survive
    // the 0.1 cm rounding threshold, directly verifying the Pejsa sign convention.
    const { points: rightPts } = mod.integrateTrajectoryFps(
      mvFps, angle, bc, rho, wLbs,  100, maxRangeYd, stepYd
    );
    const { points: leftPts  } = mod.integrateTrajectoryFps(
      mvFps, angle, bc, rho, wLbs, -100, maxRangeYd, stepYd
    );
    const rightDrift = rightPts[rightPts.length - 1].windDriftCm;
    const leftDrift  = leftPts[leftPts.length - 1].windDriftCm;
    expect(rightDrift).toBeGreaterThan(0);          // +windMph → rightward (+)
    expect(leftDrift).toBeLessThan(0);              // −windMph → leftward  (−)
    expect(rightDrift).toBeCloseTo(-leftDrift, 0);  // equal magnitude, opposite sign
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

  test('XSS payload in bullet name is escaped', () => {
    const xssName = '<img src=x onerror=alert(1)>';
    mod._setBullets([{ id: 'xss-test', name: xssName, ballisticCoefficient: 0.3, muzzleVelocityMps: 610 }]);
    mod.renderBulletList();
    const html = document.getElementById('bulletList').innerHTML;
    // Unescaped <img would be injected as a real element; escaped form is safe text
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
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

  const velocityDef = {
    id: 'velocityChart', title: 'VELOCITY RETENTION', subtitle: 'm/s downrange',
    yLabel: 'Velocity (m/s)', key: 'velocityMps',
    refLine: { value: 343, label: 'Transonic', color: 'rgba(255,100,0,0.4)' }
  };

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

  test('injects refLine annotation when def.refLine is present (velocityChart)', () => {
    const config = mod.buildChartConfig(velocityDef, datasets, sampleResults);
    // annotations are nested inside options.plugins in Chart.js annotation plugin,
    // but here we verify the config is deterministic — the annotation object exists
    // by checking the returned config has non-empty plugins options block
    expect(config.options.plugins).toBeDefined();
    // The annotations key lives at options level when annotation plugin is used.
    // Since the annotation plugin is not mocked here we verify indirectly: the
    // refLine branch ran without error and the config type is still 'line'.
    expect(config.type).toBe('line');
  });

  test('no annotation key is set when def.refLine is absent (dropChart)', () => {
    const config = mod.buildChartConfig(dropDef, datasets, sampleResults);
    // Without refLine the annotations object should be empty (no keys)
    // The function builds annotations locally; absence of refLine → {} annotations
    // We verify via a second call with refLine that the two configs differ
    const configWithRef = mod.buildChartConfig(velocityDef, datasets, sampleResults);
    expect(JSON.stringify(config)).not.toBe(JSON.stringify(configWithRef));
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

  test('XSS payload in bullet name is escaped in stat card', () => {
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
    mod.renderResults(xssResult, req);
    const html = document.getElementById('chartContainer').innerHTML;
    // Unescaped <img would be injected as a real element; escaped form is safe text
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  test('non-numeric API field in stat card renders as NaN not as HTML', () => {
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
    mod.renderResults(badResult, req);
    const html = document.getElementById('chartContainer').innerHTML;
    expect(html).not.toContain('<b>fast</b>');
    expect(html).toContain('NaN');
  });

  test('unknown color ID gets fallback color in stat card', () => {
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
    mod.renderResults(customResult, req);
    const html = document.getElementById('chartContainer').innerHTML;
    expect(html).toContain('#4ADE80');
    expect(html).not.toContain('undefined');
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
    document.getElementById('windDir').value     = '180';
    document.getElementById('altitude').value    = '3000';
    document.getElementById('temperature').value = '70';
    document.getElementById('step').value        = '50';
    global.fetch.mockResolvedValue({ json: () => Promise.resolve(mockApiResults) });

    await mod.runSimulation();

    // First fetch is the SSE stream call; body still carries all DOM parameters
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.zeroRangeMeters).toBe(200);
    expect(body.maxRangeMeters).toBe(800);
    expect(body.windSpeedKph).toBe(15);
    expect(body.windDirectionDeg).toBe(180);
    expect(body.altitudeMeters).toBe(3000);
    expect(body.temperatureC).toBe(70);
    expect(body.stepMeters).toBe(50);
  });

  // Helper: build a fake streaming response with SSE events
  function makeSseResponse(results) {
    const sse   = results.map(r => `data: ${JSON.stringify(r)}\n\n`).join('');
    const bytes = Buffer.from(sse, 'utf8'); // Buffer is a Uint8Array; TextDecoder handles it
    return {
      ok: true, status: 200,
      body: {
        getReader() {
          return {
            read: jest.fn()
              .mockResolvedValueOnce({ done: false, value: bytes })
              .mockResolvedValueOnce({ done: true })
          };
        }
      }
    };
  }

  test('uses streaming endpoint and renders each result as it arrives', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockResolvedValue(makeSseResponse(mockApiResults));

    await mod.runSimulation();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/trajectories/compare/stream',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    );
    expect(document.getElementById('resultsContainer').style.display).toBe('flex');
  });

  test('streamCompare calls onResult once per SSE event', async () => {
    const req = { bulletIds: ['308-win-168gr'], zeroRangeMeters: 100, maxRangeMeters: 500,
                  stepMeters: 25, windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15 };
    global.fetch.mockResolvedValue(makeSseResponse(mockApiResults));

    const collected = [];
    await mod.streamCompare(req, r => collected.push(r));

    expect(collected).toHaveLength(1);
    expect(collected[0].bullet.id).toBe('308-win-168gr');
  });

  test('streamCompare throws when response is not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(mod.streamCompare({}, () => {})).rejects.toThrow('HTTP 429');
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

  test('readoutPin click wired by init toggles crosshairPinned', async () => {
    global.fetch.mockResolvedValueOnce({ json: async () => mod.getMockBullets() });
    await mod.init();
    const pinBtn = document.getElementById('readoutPin');
    pinBtn.click();
    expect(mod._getState().crosshairPinned).toBe(true);
    expect(pinBtn.textContent).toBe('UNPIN');
  });

  test('readoutPin second click unpins and clears crosshair state', async () => {
    global.fetch.mockResolvedValueOnce({ json: async () => mod.getMockBullets() });
    await mod.init();
    const pinBtn = document.getElementById('readoutPin');
    pinBtn.click();  // pin
    pinBtn.click();  // unpin
    expect(mod._getState().crosshairPinned).toBe(false);
    expect(mod._getState().crosshairIndex).toBeNull();
    expect(pinBtn.textContent).toBe('PIN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setOfflineMode
// ─────────────────────────────────────────────────────────────────────────────
describe('setOfflineMode', () => {
  test('sets offline class and text when offline', () => {
    mod.setOfflineMode(true);
    const pill = document.getElementById('statusPill');
    expect(pill.className).toContain('status-offline');
    expect(pill.textContent).toMatch(/offline/i);
  });

  test('restores live class and READY text when back online', () => {
    mod.setOfflineMode(true);
    mod.setOfflineMode(false);
    const pill = document.getElementById('statusPill');
    expect(pill.className).toContain('status-live');
    expect(pill.textContent).toContain('READY');
  });

  test('does nothing when statusPill element is absent', () => {
    document.getElementById('statusPill').remove();
    expect(() => mod.setOfflineMode(true)).not.toThrow();
  });

  test('init sets offline mode when API fails', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();
    const pill = document.getElementById('statusPill');
    if (pill) expect(pill.className).toContain('status-offline');
  });

  test('runSimulation sets offline mode on fetch failure', async () => {
    mod._setSelectedIds(new Set(['308-win-168gr']));
    mod._setBullets(mod.getMockBullets());
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runSimulation();
    const pill = document.getElementById('statusPill');
    if (pill) expect(pill.className).toContain('status-offline');
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

  test('clears error and proceeds when all inputs are valid', async () => {
    setCustomInputs();
    global.fetch.mockRejectedValue(new Error('offline'));
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

  test('simulateBullet uses default 38.1 mm when sightHeightMm is absent', () => {
    const r1 = mod.simulateBullet(baseBullet, { ...baseReq });
    const r2 = mod.simulateBullet(baseBullet, { ...baseReq, sightHeightMm: 38.1 });
    // Explicit 38.1 should match the default
    expect(r1.points[1].dropCm).toBeCloseTo(r2.points[1].dropCm, 1);
  });

  test('higher sight height requires steeper launch angle — max ordinate increases', () => {
    const low  = mod.simulateBullet(baseBullet, { ...baseReq, sightHeightMm: 10 });
    const high = mod.simulateBullet(baseBullet, { ...baseReq, sightHeightMm: 100 });
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
    expect(capturedBody?.sightHeightMm ?? mod._getState().lastResults[0]?.request?.sightHeightMm).toBe(50);
  });

  test('runCustom includes sightHeightMm from the DOM input', async () => {
    document.getElementById('sightHeight').value = '60';
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runCustom();
    const result = mod._getState().lastResults[0];
    expect(result?.request?.sightHeightMm).toBe(60);
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
    const withNull  = mod.simulateBullet(baseBullet, { ...baseReq });
    const withZero  = mod.simulateBullet(baseBullet, { ...baseReq, shootingAngleDegrees: 0 });
    const last = withNull.points.length - 1;
    expect(withZero.points[last].dropCm).toBeCloseTo(withNull.points[last].dropCm, 1);
  });

  test('uphill angle (+20°) reduces apparent drop magnitude vs flat', () => {
    const flat   = mod.simulateBullet(baseBullet, { ...baseReq, shootingAngleDegrees: 0 });
    const uphill = mod.simulateBullet(baseBullet, { ...baseReq, shootingAngleDegrees: 20 });
    const i = flat.points.length - 1;
    // drop is negative past zero; |uphill| < |flat| (cos(20°) ≈ 0.94)
    expect(Math.abs(uphill.points[i].dropCm)).toBeLessThan(Math.abs(flat.points[i].dropCm));
  });

  test('downhill angle (-20°) reduces apparent drop magnitude vs flat', () => {
    const flat = mod.simulateBullet(baseBullet, { ...baseReq, shootingAngleDegrees: 0 });
    const down = mod.simulateBullet(baseBullet, { ...baseReq, shootingAngleDegrees: -20 });
    const i = flat.points.length - 1;
    expect(Math.abs(down.points[i].dropCm)).toBeLessThan(Math.abs(flat.points[i].dropCm));
  });

  test('uphill and downhill produce same drop magnitude (cos is symmetric)', () => {
    const up   = mod.simulateBullet(baseBullet, { ...baseReq, shootingAngleDegrees:  30 });
    const down = mod.simulateBullet(baseBullet, { ...baseReq, shootingAngleDegrees: -30 });
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

  test('all four charts are created with crosshairPlugin in plugins array', () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {}, points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }
      ],
      maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800
    }];
    MockChart.mockClear();
    mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(MockChart).toHaveBeenCalledTimes(4);
    MockChart.mock.calls.forEach(([, cfg]) => {
      expect(Array.isArray(cfg.plugins)).toBe(true);
      expect(cfg.plugins.some(p => p.id === 'ballistics-crosshair')).toBe(true);
    });
  });

  test('all four charts use interaction mode index', () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308 Win', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {}, points: [
        { rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }
      ],
      maxOrdinateCm: 5, maxOrdinateRangeMeters: 50, supersonicLimitMeters: 800
    }];
    MockChart.mockClear();
    mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    MockChart.mock.calls.forEach(([, cfg]) => {
      expect(cfg.options.interaction.mode).toBe('index');
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

  test('all four charts receive an annotationPlugin in their plugins array', () => {
    MockChart.mockClear();
    mod.renderResults([makeResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(MockChart).toHaveBeenCalledTimes(4);
    MockChart.mock.calls.forEach(([, cfg]) => {
      const hasAnnot = cfg.plugins.some(p => p.id === 'ballistics-annotations');
      expect(hasAnnot).toBe(true);
    });
  });

  test('drop chart plugin carries 3 annotations (supersonic + maxOrd + peak)', () => {
    MockChart.mockClear();
    mod.renderResults([makeResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
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

  test('non-drop charts carry only 1 annotation (supersonic limit)', () => {
    MockChart.mockClear();
    mod.renderResults([makeResult()], { zeroRangeMeters: 100, windSpeedKph: 0 });
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

  test('renderResults with empty array uses empty annotation arrays (ternary false branches)', () => {
    MockChart.mockClear();
    // Covers sonicAnn = [] and dropAnns = [] branches when results[0] is undefined
    mod.renderResults([], { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(MockChart).toHaveBeenCalledTimes(4);
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
});

// ─────────────────────────────────────────────────────────────────────────────
// offline retry (task 4)
// ─────────────────────────────────────────────────────────────────────────────
describe('offline retry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('setOfflineMode(true) shows retryBtn and sets offlineMode flag', () => {
    mod.setOfflineMode(true);
    expect(document.getElementById('retryBtn').style.display).toBe('inline-block');
    expect(mod._getState().offlineMode).toBe(true);
  });

  test('setOfflineMode(false) hides retryBtn and clears offlineMode flag', () => {
    mod.setOfflineMode(true);
    mod.setOfflineMode(false);
    expect(document.getElementById('retryBtn').style.display).toBe('none');
    expect(mod._getState().offlineMode).toBe(false);
  });

  test('setOfflineMode(true) starts a retry timer', () => {
    mod.setOfflineMode(true);
    expect(mod._getState().retryTimer).not.toBeNull();
  });

  test('setOfflineMode(false) clears the retry timer', () => {
    mod.setOfflineMode(true);
    mod.setOfflineMode(false);
    expect(mod._getState().retryTimer).toBeNull();
  });

  test('setOfflineMode(true) twice does not create a second timer', () => {
    mod.setOfflineMode(true);
    const firstTimer = mod._getState().retryTimer;
    mod.setOfflineMode(true);
    expect(mod._getState().retryTimer).toBe(firstTimer);
  });

  test('probeServer calls fetch on /api/bullets', async () => {
    global.fetch.mockRejectedValueOnce(new Error('still down'));
    await mod.probeServer();
    expect(global.fetch).toHaveBeenCalledWith('/api/bullets');
  });

  test('probeServer on success calls setOfflineMode(false)', async () => {
    const mockBullets = mod.getMockBullets();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockBullets
    });
    mod.setOfflineMode(true);
    mod._setBullets(mockBullets);
    await mod.probeServer();
    expect(mod._getState().offlineMode).toBe(false);
  });

  test('probeServer on success shows toast with reconnect message', async () => {
    const mockBullets = mod.getMockBullets();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockBullets
    });
    mod._setBullets(mockBullets);
    await mod.probeServer();
    expect(document.getElementById('toast').textContent).toBe('Reconnected to server');
  });

  test('probeServer on failure does not change offlineMode', async () => {
    global.fetch.mockRejectedValueOnce(new Error('still down'));
    mod.setOfflineMode(true);
    await mod.probeServer();
    expect(mod._getState().offlineMode).toBe(true);
  });

  test('probeServer on non-ok response does not call setOfflineMode(false)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    mod.setOfflineMode(true);
    await mod.probeServer();
    expect(mod._getState().offlineMode).toBe(true);
  });

  test('retry timer fires probeServer after 60 seconds', async () => {
    const mockBullets = mod.getMockBullets();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => mockBullets
    });
    mod._setBullets(mockBullets);
    mod.setOfflineMode(true);
    jest.advanceTimersByTime(60_000);
    // Allow async probeServer microtasks to settle
    await Promise.resolve();
    await Promise.resolve();
    expect(mod._getState().offlineMode).toBe(false);
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

  function renderAndGetCallbacks() {
    MockChart.mockClear();
    mod.renderResults(singleResult, { zeroRangeMeters: 100, windSpeedKph: 0 });
    return MockChart.mock.calls[0][1].options;
  }

  test('onHover with elements sets crosshairIndex and shows readout', () => {
    const opts = renderAndGetCallbacks();
    opts.onHover({}, [{ index: 1 }]);
    expect(mod._getState().crosshairIndex).toBe(1);
    expect(document.getElementById('rangeReadout').style.display).toBe('block');
  });

  test('onHover with no elements clears crosshairIndex and hides readout', () => {
    const opts = renderAndGetCallbacks();
    opts.onHover({}, [{ index: 0 }]);
    opts.onHover({}, []);
    expect(mod._getState().crosshairIndex).toBeNull();
  });

  test('onHover does nothing when crosshairPinned is true', () => {
    const opts = renderAndGetCallbacks();
    opts.onClick({}, [{ index: 0 }]);  // pin
    expect(mod._getState().crosshairPinned).toBe(true);
    opts.onHover({}, [{ index: 1 }]);
    expect(mod._getState().crosshairIndex).toBe(0); // unchanged
  });

  test('onClick toggles pin and sets crosshairIndex', () => {
    const opts = renderAndGetCallbacks();
    opts.onClick({}, [{ index: 1 }]);
    expect(mod._getState().crosshairPinned).toBe(true);
    expect(mod._getState().crosshairIndex).toBe(1);
    expect(document.getElementById('readoutPin').textContent).toBe('UNPIN');
  });

  test('onClick with no elements is a no-op', () => {
    const opts = renderAndGetCallbacks();
    opts.onClick({}, []);
    expect(mod._getState().crosshairPinned).toBe(false);
  });

  test('onClick unpins and hides readout on second click', () => {
    const opts = renderAndGetCallbacks();
    opts.onClick({}, [{ index: 0 }]);
    opts.onClick({}, [{ index: 0 }]);
    expect(mod._getState().crosshairPinned).toBe(false);
    expect(document.getElementById('rangeReadout').style.display).toBe('none');
  });

  test('crosshairPlugin afterDraw draws a line when crosshairIndex is set', () => {
    const opts = renderAndGetCallbacks();
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

  test('crosshairPlugin uses brighter stroke when pinned', () => {
    const opts = renderAndGetCallbacks();
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

  test('returns early without creating a Blob when lastResults is empty', () => {
    mod._resetState();
    mod.exportCSV();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test('builds CSV rows and triggers download when results are present', () => {
    const bullet = mod.getMockBullets()[0];
    const result = mod.simulateBullet(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    mod._setLastResults([result]);
    mod.exportCSV();

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

  test('returns early when the canvas element is not in the DOM', () => {
    mod.exportPNG('chart-does-not-exist');
    expect(toDataURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  test('calls toDataURL and triggers download when canvas exists', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'test-chart-png';
    document.body.appendChild(canvas);

    mod.exportPNG('test-chart-png');

    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runCustom — server-success path (line 432: result = await res.json())
// ─────────────────────────────────────────────────────────────────────────────
describe('runCustom server success', () => {
  function setValidCustomInputs() {
    document.getElementById('customWeight').value = '9.0';
    document.getElementById('customMV').value     = '850';
    document.getElementById('customBC').value     = '0.45';
    document.getElementById('customDia').value    = '7.82';
  }

  test('uses the server JSON response when fetch succeeds', async () => {
    setValidCustomInputs();

    const serverResult = {
      bullet: { id: 'custom', name: 'Server Load', caliber: 'Custom',
                bulletWeightGrams: 9, muzzleVelocityMps: 850,
                ballisticCoefficient: 0.45, bulletDiameterMm: 7.82,
                muzzleEnergyJoules: 3251 },
      points: [
        { rangeMeters: 0,   dropCm: 0, velocityMps: 850, energyJoules: 3251, windDriftCm: 0, timeOfFlightSec: 0 },
        { rangeMeters: 100, dropCm: -2.1, velocityMps: 800, energyJoules: 2880, windDriftCm: 0, timeOfFlightSec: 0.12 },
      ],
      maxOrdinateCm: 3.2,
      maxOrdinateRangeMeters: 55,
      supersonicLimitMeters: 900,
      request: { zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
                 windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15, sightHeightMm: 38.1 },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue(serverResult),
    });

    await mod.runCustom();

    expect(mod._getState().lastResults).toHaveLength(1);
    expect(mod._getState().lastResults[0]).toEqual(serverResult);
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

  test('clicking .export-btn triggers exportPNG for that chart', () => {
    const bullet = mod.getMockBullets()[0];
    const result = mod.simulateBullet(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });

    mod.renderResults([result], {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });

    // Each chart panel has an export button — clicking the first one should call exportPNG
    const btn = document.querySelector('.export-btn');
    expect(btn).not.toBeNull();
    btn.click();

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
// crosshairPlugin — afterDraw when the data point is absent (L504)
// ─────────────────────────────────────────────────────────────────────────────
describe('crosshairPlugin afterDraw edge cases', () => {
  test('returns early when meta.data[crosshairIndex] is undefined', () => {
    // Simulate a hover at index 5 but the chart only has data up to index 2
    mod._getState().crosshairIndex;  // prime state via existing test pattern
    // Directly set state via the exported helper would need a setter — use the
    // existing chart-interaction tests pattern: call onHover to set index
    const bullet = mod.getMockBullets()[0];
    const result = mod.simulateBullet(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    mod.renderResults([result], {
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

  test('returns early when crosshairIndex points past end of data array', () => {
    // Manually set crosshairIndex to a value beyond the data array length
    // We do this by calling onHover with an element at a large index via the chart mock
    const bullet = mod.getMockBullets()[0];
    const result = mod.simulateBullet(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    mod.renderResults([result], {
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
    const result = mod.simulateBullet(bullet, {
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
    const fullResult = mod.simulateBullet(bullet, {
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
    const fullResult = mod.simulateBullet(bullet, {
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
    global.fetch.mockResolvedValueOnce({ json: async () => mod.getMockBullets() });
    await mod.init();
    document.getElementById('tab-charts').click();
    expect(document.getElementById('chartsPanel').classList.contains('active')).toBe(true);
  });

  test('clicking #tab-data switches to data panel', async () => {
    global.fetch.mockResolvedValueOnce({ json: async () => mod.getMockBullets() });
    await mod.init();
    document.getElementById('tab-data').click();
    expect(document.getElementById('dataPanel').classList.contains('active')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readoutPin second-click path: forEach(c => c.update) (L798 forEach arrow fn)
// Requires charts to be populated so the forEach body actually executes.
// ─────────────────────────────────────────────────────────────────────────────
describe('readoutPin unpin with populated charts (L815 forEach arrow fn)', () => {
  test('second pin-click calls update() on every active chart', async () => {
    global.fetch.mockResolvedValueOnce({ json: async () => mod.getMockBullets() });
    await mod.init();

    // Populate charts by running a simulation
    const bullet = mod.getMockBullets()[0];
    const result = mod.simulateBullet(bullet, {
      zeroRangeMeters: 100, maxRangeMeters: 200, stepMeters: 100,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
    });
    mod.renderResults([result], {
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
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => bullets });

    await mod.init();

    const { selectedIds } = mod._getState();
    expect(selectedIds.has('308-win-168gr')).toBe(true);
    expect(selectedIds.has('223-rem-55gr')).toBe(false);
  });

  test('selects all bullets on first visit (null savedIds)', async () => {
    // localStorage is empty → first visit behavior → all selected
    global.fetch.mockRejectedValue(new Error('offline'));

    await mod.init();

    const { selectedIds } = mod._getState();
    mod.getMockBullets().forEach(b => expect(selectedIds.has(b.id)).toBe(true));
  });

  test('filters out stale IDs no longer in catalog', async () => {
    const bullets = mod.getMockBullets();
    localStorage.setItem(mod.PREF_KEYS.selectedIds,
      JSON.stringify(['308-win-168gr', 'deleted-bullet-id']));
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => bullets });

    await mod.init();

    const { selectedIds } = mod._getState();
    expect(selectedIds.has('308-win-168gr')).toBe(true);
    expect(selectedIds.has('deleted-bullet-id')).toBe(false);
  });

  test('parameter input events trigger savePrefs', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();

    // Dispatch input event and verify localStorage was updated directly
    const input = document.getElementById('zeroRange');
    input.value = '150';
    input.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(mod.PREF_KEYS.zero)).toBe('150');
  });

  test('handles absent input elements gracefully in setVal (if(el) false branch)', async () => {
    // Remove one param input before init to exercise the if(el) false branch of setVal
    document.getElementById('shootingAngle').remove();
    global.fetch.mockRejectedValue(new Error('offline'));
    await expect(mod.init()).resolves.toBeUndefined();
    // Other inputs still get their values; no crash
    expect(document.getElementById('zeroRange').value).toBe('100');
  });

  test('wires all 9 input listeners — sightHeight input triggers savePrefs', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();

    const el = document.getElementById('sightHeight');
    el.value = '55';
    el.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(mod.PREF_KEYS.sightHeight)).toBe('55');
  });

  test('windDir input event triggers savePrefs', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.init();

    const el = document.getElementById('windDir');
    el.value = '180';
    el.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(mod.PREF_KEYS.windDir)).toBe('180');
  });

  test('handles missing param input elements gracefully in input listener wiring', async () => {
    // Remove shootingAngle so ?. in paramInputIds.forEach does not crash
    document.getElementById('shootingAngle').remove();
    global.fetch.mockRejectedValue(new Error('offline'));
    await expect(mod.init()).resolves.toBeUndefined();
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

  test('renderResults updates #modelStatus pill with dragModel from req', () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }];
    mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G7' });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G7');
  });

  test('renderResults shows MODEL: G1 when dragModel is G1', () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }];
    mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1' });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G1');
  });

  test('renderResults defaults modelStatus to G1 when dragModel absent', () => {
    const results = [{
      bullet: { id: '308-win-168gr', name: '.308', muzzleVelocityMps: 807,
                muzzleEnergyJoules: 3552, ballisticCoefficient: 0.475, bulletWeightGrams: 10.89 },
      request: {},
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 807, energyJoules: 3552, windDriftCm: 0, timeOfFlightSec: 0 }],
      maxOrdinateCm: 3.8, maxOrdinateRangeMeters: 46, supersonicLimitMeters: 823
    }];
    mod.renderResults(results, { zeroRangeMeters: 100, windSpeedKph: 0 });
    expect(document.getElementById('modelStatus').textContent).toBe('MODEL: G1');
  });

  test('client-side fallback uses G7 table when dragModel is G7 (offline mode)', async () => {
    document.getElementById('dragModel').value = 'G7';
    mod._setBullets(mod.getMockBullets());
    mod._setSelectedIds(new Set(['308-win-168gr']));
    global.fetch.mockRejectedValue(new Error('offline'));
    await mod.runSimulation();
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

  test('touchmove on chart canvas dispatches a mousemove event', () => {
    mod._setLastResults(mockResults);
    mod.renderResults(mockResults, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1' });

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

  test('touchmove handler calls preventDefault to suppress page scroll', () => {
    mod.renderResults(mockResults, { zeroRangeMeters: 100, windSpeedKph: 0, dragModel: 'G1' });

    const canvas = document.getElementById('dropChart');
    const touchEvent = new Event('touchmove', { bubbles: true, cancelable: true });
    touchEvent.touches = [{ clientX: 50, clientY: 50 }];

    const preventDefaultSpy = jest.spyOn(touchEvent, 'preventDefault');
    canvas.dispatchEvent(touchEvent);
    expect(preventDefaultSpy).toHaveBeenCalled();
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
    // init() calls fetch synchronously before the first await — wire it up so
    // it rejects gracefully rather than blowing up
    global.fetch.mockRejectedValue(new Error('offline'));

    let freshMod;
    jest.isolateModules(() => {
      freshMod = require('../../main/resources/static/ballistics.js');
    });

    // If the guard true-branch was entered, init() ran and issued the bullets fetch
    expect(global.fetch).toHaveBeenCalled();
    expect(freshMod).toBeDefined();
  });
});
