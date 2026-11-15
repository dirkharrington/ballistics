'use strict';

const {
  simulate,
  TrajectoryInputError,
  interpolateDragTable,
  airDensityRatio,
  findZeroAngleFps,
  integrateTrajectoryFps,
} = require('../../main/resources/static/physics/engine.ts');
const { G1_TABLE, G7_TABLE } = require('./../../test/js/__mocks__/physics-tables.js');

const golden = require('./fixtures/spa1-golden.json');

// ─────────────────────────────────────────────────────────────────────────────
// TrajectoryInputError
// ─────────────────────────────────────────────────────────────────────────────
describe('TrajectoryInputError', () => {
  test('is an instance of RangeError', () => {
    const err = new TrajectoryInputError('someField', 'a finite number greater than 0');
    expect(err instanceof RangeError).toBe(true);
    expect(err instanceof TrajectoryInputError).toBe(true);
  });

  test('has name TrajectoryInputError', () => {
    const err = new TrajectoryInputError('someField', 'a finite number greater than 0');
    expect(err.name).toBe('TrajectoryInputError');
  });

  test('has field property', () => {
    const err = new TrajectoryInputError('zeroRangeMeters', 'a finite number greater than 0 and at most 3000');
    expect(err.field).toBe('zeroRangeMeters');
  });

  test('message contains field and constraint', () => {
    const err = new TrajectoryInputError('zeroRangeMeters', 'a finite number greater than 0 and at most 3000');
    expect(err.message).toBe('zeroRangeMeters must be a finite number greater than 0 and at most 3000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// simulate() — validation (12 rules, §4.3)
// ─────────────────────────────────────────────────────────────────────────────
const BASE_BULLET = {
  id: '308-win-168gr', name: '.308 Win', caliber: '.308',
  bulletWeightGrams: 10.89, muzzleVelocityMps: 807, ballisticCoefficient: 0.475,
  bulletDiameterMm: 7.82, muzzleEnergyJoules: 3552,
};
const BASE_PARAMS = {
  zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 100,
  windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
};

function expectValidationError(bullet, params, field, constraint) {
  let caught;
  try { simulate(bullet, params); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(TrajectoryInputError);
  expect(caught).toBeInstanceOf(RangeError);
  expect(caught.name).toBe('TrajectoryInputError');
  expect(caught.field).toBe(field);
  expect(caught.message).toBe(`${field} must be ${constraint}`);
}

describe('simulate() validation — rule 1: bulletWeightGrams > 0', () => {
  const c = 'a finite number greater than 0';
  test('rejects 0',        () => expectValidationError({ ...BASE_BULLET, bulletWeightGrams: 0 },        BASE_PARAMS, 'bullet.bulletWeightGrams', c));
  test('rejects negative', () => expectValidationError({ ...BASE_BULLET, bulletWeightGrams: -1 },       BASE_PARAMS, 'bullet.bulletWeightGrams', c));
  test('rejects Infinity', () => expectValidationError({ ...BASE_BULLET, bulletWeightGrams: Infinity }, BASE_PARAMS, 'bullet.bulletWeightGrams', c));
  test('accepts 0.001',    () => expect(simulate({ ...BASE_BULLET, bulletWeightGrams: 0.001 }, BASE_PARAMS)).toBeDefined());
});

describe('simulate() validation — rule 2: muzzleVelocityMps > 0', () => {
  const c = 'a finite number greater than 0';
  test('rejects 0',        () => expectValidationError({ ...BASE_BULLET, muzzleVelocityMps: 0 },        BASE_PARAMS, 'bullet.muzzleVelocityMps', c));
  test('rejects negative', () => expectValidationError({ ...BASE_BULLET, muzzleVelocityMps: -1 },       BASE_PARAMS, 'bullet.muzzleVelocityMps', c));
  test('rejects Infinity', () => expectValidationError({ ...BASE_BULLET, muzzleVelocityMps: Infinity }, BASE_PARAMS, 'bullet.muzzleVelocityMps', c));
  test('accepts 100',      () => expect(simulate({ ...BASE_BULLET, muzzleVelocityMps: 100 }, BASE_PARAMS)).toBeDefined());
});

describe('simulate() validation — rule 3: ballisticCoefficient > 0', () => {
  const c = 'a finite number greater than 0';
  test('rejects 0',        () => expectValidationError({ ...BASE_BULLET, ballisticCoefficient: 0 },        BASE_PARAMS, 'bullet.ballisticCoefficient', c));
  test('rejects negative', () => expectValidationError({ ...BASE_BULLET, ballisticCoefficient: -1 },       BASE_PARAMS, 'bullet.ballisticCoefficient', c));
  test('rejects Infinity', () => expectValidationError({ ...BASE_BULLET, ballisticCoefficient: Infinity }, BASE_PARAMS, 'bullet.ballisticCoefficient', c));
  test('accepts 0.1',      () => expect(simulate(BASE_BULLET, BASE_PARAMS)).toBeDefined());
});

describe('simulate() validation — rule 4: zeroRangeMeters (0, 3000]', () => {
  const c = 'a finite number greater than 0 and at most 3000';
  test('rejects 0',        () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, zeroRangeMeters: 0 },        'zeroRangeMeters', c));
  test('rejects negative', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, zeroRangeMeters: -1 },       'zeroRangeMeters', c));
  test('rejects 3001',     () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, zeroRangeMeters: 3001 },     'zeroRangeMeters', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, zeroRangeMeters: Infinity }, 'zeroRangeMeters', c));
  test('accepts 100',      () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, zeroRangeMeters: 100 })).toBeDefined());
  test('accepts 3000',     () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, zeroRangeMeters: 3000 })).toBeDefined());
});

describe('simulate() validation — rule 5: maxRangeMeters (0, 5000]', () => {
  const c = 'a finite number greater than 0 and at most 5000';
  test('rejects 0',        () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, maxRangeMeters: 0 },        'maxRangeMeters', c));
  test('rejects negative', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, maxRangeMeters: -1 },       'maxRangeMeters', c));
  test('rejects 5001',     () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, maxRangeMeters: 5001 },     'maxRangeMeters', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, maxRangeMeters: Infinity }, 'maxRangeMeters', c));
  test('accepts 100',      () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, maxRangeMeters: 100 })).toBeDefined());
  test('accepts 5000',     () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, maxRangeMeters: 5000 })).toBeDefined());
});

describe('simulate() validation — rule 6: stepMeters (0, 500]', () => {
  const c = 'a finite number greater than 0 and at most 500';
  test('rejects 0',        () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, stepMeters: 0 },        'stepMeters', c));
  test('rejects negative', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, stepMeters: -1 },       'stepMeters', c));
  test('rejects 501',      () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, stepMeters: 501 },      'stepMeters', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, stepMeters: Infinity }, 'stepMeters', c));
  test('accepts 10',       () => expect(simulate(BASE_BULLET, BASE_PARAMS)).toBeDefined());
  test('accepts 500',      () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, stepMeters: 500 })).toBeDefined());
});

describe('simulate() validation — rule 7: windSpeedKph >= 0', () => {
  const c = 'a finite number of at least 0';
  test('rejects negative', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: -1 },       'windSpeedKph', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: Infinity }, 'windSpeedKph', c));
  test('accepts 0',        () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: 0 })).toBeDefined());
  test('accepts 100',      () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: 100 })).toBeDefined());
});

describe('simulate() validation — rule 8: altitudeMeters >= 0', () => {
  const c = 'a finite number of at least 0';
  test('rejects negative', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: -1 },       'altitudeMeters', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: Infinity }, 'altitudeMeters', c));
  test('accepts 0',        () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: 0 })).toBeDefined());
  test('accepts 1524',     () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: 1524 })).toBeDefined());
});

describe('simulate() validation — rule 9: temperatureC [-50, 60]', () => {
  const c = 'a finite number between -50 and 60';
  test('rejects -51',      () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, temperatureC: -51 },      'temperatureC', c));
  test('rejects 61',       () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, temperatureC: 61 },       'temperatureC', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, temperatureC: Infinity }, 'temperatureC', c));
  test('accepts -50',      () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, temperatureC: -50 })).toBeDefined());
  test('accepts 60',       () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, temperatureC: 60 })).toBeDefined());
});

describe('simulate() validation — rule 10: windDirectionDeg [0, 360] (optional)', () => {
  const c = 'a finite number between 0 and 360';
  test('rejects -1',       () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, windDirectionDeg: -1 },       'windDirectionDeg', c));
  test('rejects 361',      () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, windDirectionDeg: 361 },      'windDirectionDeg', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, windDirectionDeg: Infinity }, 'windDirectionDeg', c));
  test('accepts 0',        () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, windDirectionDeg: 0 })).toBeDefined());
  test('accepts 360',      () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, windDirectionDeg: 360 })).toBeDefined());
  test('accepts absent',   () => expect(simulate(BASE_BULLET, BASE_PARAMS)).toBeDefined());
});

describe('simulate() validation — rule 11: sightHeightMm <= 150 (optional)', () => {
  const c = 'a finite number of at most 150';
  test('rejects 151',      () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, sightHeightMm: 151 },      'sightHeightMm', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, sightHeightMm: Infinity }, 'sightHeightMm', c));
  test('accepts 0',        () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, sightHeightMm: 0 })).toBeDefined());
  test('accepts 150',      () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, sightHeightMm: 150 })).toBeDefined());
  test('accepts absent',   () => expect(simulate(BASE_BULLET, BASE_PARAMS)).toBeDefined());
});

describe('simulate() validation — rule 12: shootingAngleDegrees [-45, 45] (optional)', () => {
  const c = 'a finite number between -45 and 45';
  test('rejects -46',      () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, shootingAngleDegrees: -46 },      'shootingAngleDegrees', c));
  test('rejects 46',       () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, shootingAngleDegrees: 46 },       'shootingAngleDegrees', c));
  test('rejects Infinity', () => expectValidationError(BASE_BULLET, { ...BASE_PARAMS, shootingAngleDegrees: Infinity }, 'shootingAngleDegrees', c));
  test('accepts -45',      () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, shootingAngleDegrees: -45 })).toBeDefined());
  test('accepts 45',       () => expect(simulate(BASE_BULLET, { ...BASE_PARAMS, shootingAngleDegrees: 45 })).toBeDefined());
  test('accepts absent',   () => expect(simulate(BASE_BULLET, BASE_PARAMS)).toBeDefined());
});

// ─────────────────────────────────────────────────────────────────────────────
// simulate() — behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe('simulate()', () => {
  test('returns same bullet and request object references', () => {
    const result = simulate(BASE_BULLET, BASE_PARAMS);
    expect(result.bullet).toBe(BASE_BULLET);
    expect(result.request).toBe(BASE_PARAMS);
  });

  test('returns result object with expected shape', () => {
    const result = simulate(BASE_BULLET, BASE_PARAMS);
    expect(Array.isArray(result.points)).toBe(true);
    expect(result.maxOrdinateCm).toBeGreaterThanOrEqual(0);
    expect(result.supersonicLimitMeters).toBeGreaterThanOrEqual(0);
    expect(typeof result.maxOrdinateRangeMeters).toBe('number');
  });

  test('produces trajectory points with positive velocity', () => {
    const result = simulate(BASE_BULLET, BASE_PARAMS);
    expect(result.points.length).toBeGreaterThan(0);
    result.points.forEach(p => {
      expect(p.velocityMps).toBeGreaterThan(0);
      expect(p.energyJoules).toBeGreaterThan(0);
    });
  });

  test('first point velocity matches muzzle velocity', () => {
    const result = simulate(BASE_BULLET, BASE_PARAMS);
    expect(result.points[0].velocityMps).toBeCloseTo(BASE_BULLET.muzzleVelocityMps, 0);
  });

  test('wind drift is zero when windSpeedKph is 0', () => {
    const result = simulate(BASE_BULLET, BASE_PARAMS);
    result.points.forEach(p => expect(p.windDriftCm).toBe(0));
  });

  test('wind drift is computed when wind is nonzero', () => {
    const result = simulate(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: 16 });
    expect(result.points.length).toBeGreaterThan(0);
  });

  test('90° wind direction produces same drift as no direction specified', () => {
    const r90  = simulate(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: 16, windDirectionDeg: 90 });
    const rDef = simulate(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: 16 });
    const last90  = r90.points[r90.points.length - 1].windDriftCm;
    const lastDef = rDef.points[rDef.points.length - 1].windDriftCm;
    expect(last90).toBeCloseTo(lastDef, 1);
  });

  test('0° (headwind) produces zero crosswind drift', () => {
    const result = simulate(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: 16, windDirectionDeg: 0 });
    result.points.forEach(p => expect(p.windDriftCm).toBeCloseTo(0, 1));
  });

  test('270° and 90° crosswinds produce equal-magnitude opposite-sign drift', () => {
    const leftResult  = simulate(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: 16, windDirectionDeg: 270 });
    const rightResult = simulate(BASE_BULLET, { ...BASE_PARAMS, windSpeedKph: 16, windDirectionDeg: 90  });
    const lastLeft  = leftResult.points[leftResult.points.length - 1].windDriftCm;
    const lastRight = rightResult.points[rightResult.points.length - 1].windDriftCm;
    expect(lastLeft).toBeCloseTo(-lastRight, 0);
  });

  test('supersonic limit equals maxRange when bullet stays supersonic', () => {
    const bullet223 = {
      ...BASE_BULLET,
      id: '223-rem-55gr', ballisticCoefficient: 0.243,
      bulletWeightGrams: 3.56, muzzleVelocityMps: 987,
    };
    const longReq = { ...BASE_PARAMS, maxRangeMeters: 1000, stepMeters: 50 };
    const result = simulate(bullet223, longReq);
    expect(result.supersonicLimitMeters).toBe(longReq.maxRangeMeters);
  });

  test('covers velocity < 100 early-break with very slow bullet', () => {
    const slowBullet = { ...BASE_BULLET, ballisticCoefficient: 0.1, bulletWeightGrams: 3.24, muzzleVelocityMps: 12 };
    const result = simulate(slowBullet, BASE_PARAMS);
    expect(result).toBeDefined();
    expect(result.supersonicLimitMeters).toBe(0);
  });

  test('covers velocity < 50 in zero-finder with very slow bullet', () => {
    const ultraSlow = { ...BASE_BULLET, ballisticCoefficient: 0.05, bulletWeightGrams: 3.24, muzzleVelocityMps: 9 };
    const result = simulate(ultraSlow, BASE_PARAMS);
    expect(result).toBeDefined();
  });

  test('max ordinate is positive for normal bullet', () => {
    const result = simulate(BASE_BULLET, BASE_PARAMS);
    expect(result.maxOrdinateCm).toBeGreaterThan(0);
  });

  test('high altitude simulation produces valid trajectory', () => {
    const seaResult = simulate(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: 0 });
    const altResult = simulate(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: 1524 });
    expect(seaResult.points.length).toBeGreaterThan(0);
    expect(altResult.points.length).toBeGreaterThan(0);
  });

  test('G7 model produces valid trajectory with expected shape', () => {
    const result = simulate(BASE_BULLET, { ...BASE_PARAMS, dragModel: 'G7' });
    expect(result.points.length).toBeGreaterThan(0);
    result.points.forEach(p => {
      expect(p.velocityMps).toBeGreaterThan(0);
      expect(p.energyJoules).toBeGreaterThan(0);
    });
  });

  test('absent dragModel defaults to G1 behaviour', () => {
    const noModel  = simulate(BASE_BULLET, { ...BASE_PARAMS });
    const explicit = simulate(BASE_BULLET, { ...BASE_PARAMS, dragModel: 'G1' });
    const last = noModel.points.length - 1;
    expect(noModel.points[last].dropCm).toBeCloseTo(explicit.points[last].dropCm, 1);
  });

  test('sightHeightMm of 0 is used (not replaced by 38.1 default)', () => {
    const r0   = simulate(BASE_BULLET, { ...BASE_PARAMS, sightHeightMm: 0 });
    const rDef = simulate(BASE_BULLET, BASE_PARAMS); // defaults to 38.1
    // Different sight heights produce different zero angles → different max ordinate
    expect(r0.maxOrdinateCm).not.toEqual(rDef.maxOrdinateCm);
  });

  test('shooting angle of 0 equals default', () => {
    const explicit = simulate(BASE_BULLET, { ...BASE_PARAMS, shootingAngleDegrees: 0 });
    const noAngle  = simulate(BASE_BULLET, BASE_PARAMS);
    expect(explicit.points.length).toBe(noAngle.points.length);
    expect(explicit.points[0].dropCm).toBeCloseTo(noAngle.points[0].dropCm, 1);
  });

  test('reserved fields (latitudeDeg, customDragTable) are accepted without error', () => {
    const result = simulate(BASE_BULLET, { ...BASE_PARAMS, latitudeDeg: 45, azimuthDeg: 0, customDragTable: [] });
    expect(result).toBeDefined();
    expect(result.points.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// interpolateDragTable
// ─────────────────────────────────────────────────────────────────────────────
describe('interpolateDragTable', () => {
  test('returns first table value for velocity at or below minimum', () => {
    const first = G1_TABLE[0];
    expect(interpolateDragTable(first[0], G1_TABLE)).toBeCloseTo(first[1]);
    expect(interpolateDragTable(0, G1_TABLE)).toBeCloseTo(first[1]);
  });

  test('returns last table value for velocity at or above maximum', () => {
    const last = G1_TABLE[G1_TABLE.length - 1];
    expect(interpolateDragTable(last[0], G1_TABLE)).toBeCloseTo(last[1]);
    expect(interpolateDragTable(99999, G1_TABLE)).toBeCloseTo(last[1]);
  });

  test('returns exact table value at known G1 point (700 fps)', () => {
    expect(interpolateDragTable(700, G1_TABLE)).toBeCloseTo(0.1194);
  });

  test('returns exact table value at known G1 point (1400 fps)', () => {
    expect(interpolateDragTable(1400, G1_TABLE)).toBeCloseTo(0.2030);
  });

  test('interpolates between table entries', () => {
    const v = interpolateDragTable(1025, G1_TABLE); // between 1000 (0.1250) and 1050 (0.1315)
    expect(v).toBeGreaterThan(0.1250);
    expect(v).toBeLessThan(0.1315);
  });

  test('handles negative input via Math.abs', () => {
    expect(interpolateDragTable(-700, G1_TABLE)).toBeCloseTo(interpolateDragTable(700, G1_TABLE));
  });

  test('returns NaN for NaN input (fall-through path)', () => {
    expect(interpolateDragTable(NaN, G1_TABLE)).toBe(NaN);
  });

  test('G7 returns first table value for velocity at or below minimum', () => {
    const first = G7_TABLE[0];
    expect(interpolateDragTable(first[0], G7_TABLE)).toBeCloseTo(first[1]);
    expect(interpolateDragTable(0, G7_TABLE)).toBeCloseTo(first[1]);
  });

  test('G7 returns last table value for velocity at or above maximum', () => {
    const last = G7_TABLE[G7_TABLE.length - 1];
    expect(interpolateDragTable(last[0], G7_TABLE)).toBeCloseTo(last[1]);
    expect(interpolateDragTable(99999, G7_TABLE)).toBeCloseTo(last[1]);
  });

  test('G7 values are generally lower than G1 at supersonic speeds', () => {
    const g1At2000 = interpolateDragTable(2000, G1_TABLE);
    const g7At2000 = interpolateDragTable(2000, G7_TABLE);
    expect(g7At2000).toBeLessThan(g1At2000);
    expect(g7At2000 / g1At2000).toBeGreaterThan(0.4);
    expect(g7At2000 / g1At2000).toBeLessThan(0.9);
  });

  test('G7 handles negative input via Math.abs', () => {
    const pos = interpolateDragTable(2000, G7_TABLE);
    const neg = interpolateDragTable(-2000, G7_TABLE);
    expect(pos).toBeCloseTo(neg);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// airDensityRatio
// ─────────────────────────────────────────────────────────────────────────────
describe('airDensityRatio', () => {
  test('is approximately 1.0 at sea level standard temperature', () => {
    const ratio = airDensityRatio(0, 59);
    expect(ratio).toBeCloseTo(1.0, 2);
  });

  test('is less than sea level at high altitude', () => {
    const sealevel = airDensityRatio(0, 59);
    const altitude = airDensityRatio(5000, 59);
    expect(altitude).toBeLessThan(sealevel);
  });

  test('is less dense at higher temperature', () => {
    const cold = airDensityRatio(0, 40);
    const hot  = airDensityRatio(0, 100);
    expect(hot).toBeLessThan(cold);
  });

  test('returns a positive value', () => {
    expect(airDensityRatio(3000, 70)).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findZeroAngleFps
// ─────────────────────────────────────────────────────────────────────────────
describe('findZeroAngleFps', () => {
  const mvFps    = 807 * 3.28084;
  const bc       = 0.475;
  const rho      = 1.0;
  const zeroFt   = 100 * 3.28084;
  const sightHtFt = 38.1 / 25.4 / 12;

  test('returns a small positive angle for a typical rifle load', () => {
    const angle = findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(0.01);
  });

  test('angle increases when zero range increases', () => {
    const angle100 = findZeroAngleFps(mvFps, bc, rho, zeroFt,     sightHtFt);
    const angle200 = findZeroAngleFps(mvFps, bc, rho, zeroFt * 2, sightHtFt);
    expect(angle200).toBeGreaterThan(angle100);
  });

  test('angle increases for slower muzzle velocity', () => {
    const angleFast = findZeroAngleFps(mvFps,       bc, rho, zeroFt, sightHtFt);
    const angleSlow = findZeroAngleFps(mvFps * 0.5, bc, rho, zeroFt, sightHtFt);
    expect(angleSlow).toBeGreaterThan(angleFast);
  });

  test('returns a finite number even for very slow (sub-50 fps) bullet', () => {
    const angle = findZeroAngleFps(15, 0.05, rho, zeroFt, sightHtFt);
    expect(Number.isFinite(angle)).toBe(true);
  });

  test('uses G7 drag table when specified', () => {
    const angleG1 = findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, G1_TABLE);
    const angleG7 = findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, G7_TABLE);
    expect(Number.isFinite(angleG7)).toBe(true);
    expect(angleG7).not.toEqual(angleG1);
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
  const maxRangeYd = 1000 / 0.9144;
  const stepYd     = 25 / 0.9144;
  const angle      = 0.002;

  test('returns the correct number of trajectory points', () => {
    const { points } = integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd);
    expect(points.length).toBeGreaterThanOrEqual(40);
    expect(points.length).toBeLessThanOrEqual(42);
  });

  test('first point has velocity close to muzzle velocity', () => {
    const { points } = integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd);
    const muzzleMps = mvFps / 3.28084;
    expect(points[0].velocityMps).toBeCloseTo(muzzleMps, 0);
  });

  test('wind drift is zero when windMph is 0', () => {
    const { points } = integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, 0, maxRangeYd, stepYd);
    points.forEach(p => expect(p.windDriftCm).toBe(0));
  });

  test('output is consistent with simulate() for equivalent inputs', () => {
    const req = { ...BASE_PARAMS, maxRangeMeters: 500, stepMeters: 25 };
    const full  = simulate(BASE_BULLET, req);
    const angleV = findZeroAngleFps(mvFps, bc, 1.0, 100 * 3.28084, 38.1 / 25.4 / 12);
    const { points } = integrateTrajectoryFps(mvFps, angleV, bc, 1.0, wLbs, 0, 500 / 0.9144, 25 / 0.9144);
    expect(points.length).toBe(full.points.length);
    expect(points[0].velocityMps).toBeCloseTo(full.points[0].velocityMps, 0);
  });

  test('positive windMph produces rightward drift, negative windMph produces leftward drift', () => {
    const { points: rightPts } = integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs,  100, maxRangeYd, stepYd);
    const { points: leftPts  } = integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, -100, maxRangeYd, stepYd);
    const rightDrift = rightPts[rightPts.length - 1].windDriftCm;
    const leftDrift  = leftPts[leftPts.length - 1].windDriftCm;
    expect(rightDrift).toBeGreaterThan(0);
    expect(leftDrift).toBeLessThan(0);
    expect(rightDrift).toBeCloseTo(-leftDrift, 0);
  });

  test('uses G7 drag table when specified', () => {
    const { points: g1Pts } = integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, 0, maxRangeYd, stepYd, 1, G1_TABLE);
    const { points: g7Pts } = integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, 0, maxRangeYd, stepYd, 1, G7_TABLE);
    expect(g1Pts.length).toBeGreaterThan(0);
    expect(g7Pts.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden fixture (§11.3) — bit-identical output lock
// ─────────────────────────────────────────────────────────────────────────────
describe('simulate() — golden fixture', () => {
  for (const { name, bullet, params, expected } of golden.cases) {
    test(name, () => {
      const result = simulate(bullet, params);
      expect(result.points).toEqual(expected.points);
      expect(result.maxOrdinateCm).toEqual(expected.maxOrdinateCm);
      expect(result.maxOrdinateRangeMeters).toEqual(expected.maxOrdinateRangeMeters);
      expect(result.supersonicLimitMeters).toEqual(expected.supersonicLimitMeters);
    });
  }
});
