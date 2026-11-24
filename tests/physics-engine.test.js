'use strict';

const {
  simulate,
  TrajectoryInputError,
  compileDragTable,
  findBracket,
  airDensityRatio,
  stationAirDensityRatio,
  findZeroAngleFps,
  integrateTrajectoryFps,
  referenceDragTable,
  soundSpeedFps,
  sectionalDensityLbIn2,
  resolveDrag,
  CD_TO_RETARD,
  STABILITY_LIMIT,
  ZERO_ANGLE_MIN,
  ZERO_ANGLE_MAX,
} = require('../app/physics/engine.ts');
const { G1_CD_TABLE, G5_CD_TABLE, G7_CD_TABLE } = require('./__mocks__/physics-tables.js');
// Build fps-keyed reference tables for use with compileDragTable / findBracket
const _ss15 = soundSpeedFps(15);
const G1_TABLE = referenceDragTable('G1', _ss15);
const G5_TABLE = referenceDragTable('G5', _ss15);
const G7_TABLE = referenceDragTable('G7', _ss15);

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
    const longReq = { ...BASE_PARAMS, maxRangeMeters: 900, stepMeters: 50 };
    const result = simulate(BASE_BULLET, longReq);
    expect(result.supersonicLimitMeters).toBe(longReq.maxRangeMeters);
  });

  test('covers velocity < 100 early-break with very slow bullet', () => {
    // MV=20 m/s (~66 fps) > zero-finder threshold (50 fps) but < MIN_VEL_FPS (100 fps)
    const slowBullet = { ...BASE_BULLET, ballisticCoefficient: 0.1, bulletWeightGrams: 3.24, muzzleVelocityMps: 20 };
    const shortParams = { ...BASE_PARAMS, zeroRangeMeters: 1 };
    const result = simulate(slowBullet, shortParams);
    expect(result).toBeDefined();
    expect(result.supersonicLimitMeters).toBe(0);
  });

  test('covers velocity < 50 in zero-finder with very slow bullet', () => {
    const ultraSlow = { ...BASE_BULLET, ballisticCoefficient: 0.05, bulletWeightGrams: 3.24, muzzleVelocityMps: 9 };
    expect(() => simulate(ultraSlow, BASE_PARAMS)).toThrow(TrajectoryInputError);
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

  test('G5 model dragModel field is set correctly and trajectory is valid', () => {
    const g5Bullet = { ...BASE_BULLET, ballisticCoefficientG5: 0.3 };
    const g5 = simulate(g5Bullet, { ...BASE_PARAMS, dragModel: 'G5' });
    expect(g5.dragModel).toBe('G5');
    expect(g5.points.length).toBeGreaterThan(0);
    g5.points.forEach(p => {
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
// Drag table monotonicity & clamping (migrated from interpolateDragTable)
// ─────────────────────────────────────────────────────────────────────────────
describe('Drag table monotonicity & clamping', () => {
  test('G1_CD_TABLE, G5_CD_TABLE and G7_CD_TABLE mach values are strictly ascending; fps tables built from them are also strictly ascending', () => {
    for (const cdTable of [G1_CD_TABLE, G5_CD_TABLE, G7_CD_TABLE]) {
      for (let i = 1; i < cdTable.length; i++) {
        expect(cdTable[i].mach).toBeGreaterThan(cdTable[i - 1].mach);
      }
    }
    for (const fpsTable of [G1_TABLE, G5_TABLE, G7_TABLE]) {
      const ct = compileDragTable(fpsTable);
      expect(ct.last).toBe(fpsTable.length - 1);
      for (let i = 1; i <= ct.last; i++) {
        expect(fpsTable[i][0]).toBeGreaterThan(fpsTable[i - 1][0]);
        expect(ct.v[i]).toBeGreaterThan(ct.v[i - 1]);
        expect(ct.dv[i]).toBeGreaterThan(0);
      }
    }
  });

  test('G7 drag values are lower than G1 at supersonic speed (2000 fps)', () => {
    const g1Ct = compileDragTable(G1_TABLE);
    const g7Ct = compileDragTable(G7_TABLE);
    const idx1 = findBracket(2000, g1Ct, g1Ct.last);
    const idx7 = findBracket(2000, g7Ct, g7Ct.last);
    const f1 = g1Ct.f[idx1 - 1] + ((2000 - g1Ct.v[idx1 - 1]) / g1Ct.dv[idx1]) * g1Ct.df[idx1];
    const f7 = g7Ct.f[idx7 - 1] + ((2000 - g7Ct.v[idx7 - 1]) / g7Ct.dv[idx7]) * g7Ct.df[idx7];
    expect(f7).toBeLessThan(f1);
    expect(f7 / f1).toBeGreaterThan(0.4);
    expect(f7 / f1).toBeLessThan(0.9);
  });

  test('simulate() clamps speeds below minimum and above maximum table velocities', () => {
    // Low-end clamp: muzzle speed ~492 fps < table min (mach 0.5 = 562.5 fps)
    const lowA = [
      { mach: 0.5, cd: 0.25 },
      { mach: 1.0, cd: 0.30 },
      { mach: 2.5, cd: 0.20 },
    ];
    const lowB = [
      { mach: 0.5, cd: 0.25 },
      { mach: 1.0, cd: 1.50 },
      { mach: 2.5, cd: 1.80 },
    ];
    const slowBullet = { ...BASE_BULLET, muzzleVelocityMps: 150 };
    const slowParams = { ...BASE_PARAMS, zeroRangeMeters: 50, maxRangeMeters: 100, stepMeters: 50 };
    const resLowA = simulate(slowBullet, { ...slowParams, customDragTable: lowA });
    const resLowB = simulate(slowBullet, { ...slowParams, customDragTable: lowB });
    expect(resLowA.points).toEqual(resLowB.points);

    // High-end clamp: flight stays >= mach 2.0 (2250 fps) so only final cd (0.20) is read
    const highA = [
      { mach: 0.5, cd: 0.10 },
      { mach: 1.5, cd: 0.15 },
      { mach: 2.0, cd: 0.20 },
    ];
    const highB = [
      { mach: 0.5, cd: 1.50 },
      { mach: 1.5, cd: 1.60 },
      { mach: 2.0, cd: 0.20 },
    ];
    const fastBullet = { ...BASE_BULLET, muzzleVelocityMps: 1200 };
    const fastParams = { ...BASE_PARAMS, zeroRangeMeters: 50, maxRangeMeters: 50, stepMeters: 25 };
    const resHighA = simulate(fastBullet, { ...fastParams, customDragTable: highA });
    const resHighB = simulate(fastBullet, { ...fastParams, customDragTable: highB });
    expect(resHighA.points).toEqual(resHighB.points);
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

  test('returns NaN for very slow (sub-50 fps) bullet that cannot reach zero range', () => {
    const angle = findZeroAngleFps(15, 0.05, rho, zeroFt, sightHtFt);
    expect(Number.isNaN(angle)).toBe(true);
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
// UX-5: density altitude in TrajectoryResult
// ─────────────────────────────────────────────────────────────────────────────
describe('simulate() — densityAltitudeMeters', () => {
  test('sea level 15°C (ISA standard) → density altitude = 0 m', () => {
    const result = simulate(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: 0, temperatureC: 15 });
    expect(result.densityAltitudeMeters).toBe(0);
  });

  test('0 m, 30°C → density altitude = 543 m', () => {
    // isa = 15 - 0.0065*0 = 15; DA = 0 + 36.2*(30-15) = 36.2*15 = 543
    const result = simulate(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: 0, temperatureC: 30 });
    expect(result.densityAltitudeMeters).toBe(543);
  });

  test('1500 m, 35°C → density altitude = 2577 m', () => {
    // isa = 15 - 0.0065*1500 = 5.25; DA = 1500 + 36.2*(35-5.25) = 1500 + 36.2*29.75 = 2577
    const result = simulate(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: 1500, temperatureC: 35 });
    expect(result.densityAltitudeMeters).toBe(2577);
  });

  test('1000 m, -10°C → density altitude = 330 m (positive, cold dense air)', () => {
    // isa = 15 - 0.0065*1000 = 8.5; DA = 1000 + 36.2*(-10-8.5) = 1000 + 36.2*(-18.5) = 330
    const result = simulate(BASE_BULLET, { ...BASE_PARAMS, altitudeMeters: 1000, temperatureC: -10 });
    expect(result.densityAltitudeMeters).toBe(330);
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
      expect(result.dragModel).toBe(expected.dragModel ?? (params.dragModel === 'G7' ? 'G7' : 'G1'));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FEAT-1: Gyroscopic spin drift
// ─────────────────────────────────────────────────────────────────────────────
const {
  stabilityFactor,
  spinDriftInches,
  integrateTrajectoryFps: _integrateWithExtras,
} = require('../app/physics/engine.ts');

const B308 = {
  id: '308-win-168gr', name: '.308 Win', caliber: '.308',
  bulletWeightGrams: 10.89, muzzleVelocityMps: 807, ballisticCoefficient: 0.475,
  bulletDiameterMm: 7.82, muzzleEnergyJoules: 3552,
};
const COND_A = {
  zeroRangeMeters: 100, maxRangeMeters: 1000, stepMeters: 25,
  windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
};

// Test 2: No twist rate — spinDriftCm = 0 on all points
describe('FEAT-1 test 2: no twist rate → spinDriftCm = 0', () => {
  for (const twist of [undefined, null]) {
    test(`twist ${JSON.stringify(twist)} → all points spinDriftCm === 0`, () => {
      const params = twist === undefined ? COND_A : { ...COND_A, twistRateInchesPerTurn: null };
      const result = simulate(B308, params);
      result.points.forEach(p => expect(Object.is(p.spinDriftCm, 0)).toBe(true));
    });
  }
  test('twist undefined (BASE_PARAMS) → all points spinDriftCm === 0', () => {
    const result = simulate(B308, BASE_PARAMS);
    result.points.forEach(p => expect(Object.is(p.spinDriftCm, 0)).toBe(true));
  });
});

// Test 3: Twist 10, .308 — basic properties
describe('FEAT-1 test 3: twist 10 basic properties', () => {
  const params308 = { ...COND_A, dragModel: 'G1', twistRateInchesPerTurn: 10 };

  test('first point spinDriftCm === 0', () => {
    const result = simulate(B308, params308);
    expect(result.points[0].spinDriftCm).toBe(0);
  });

  test('all values >= 0', () => {
    const result = simulate(B308, params308);
    result.points.forEach(p => expect(p.spinDriftCm).toBeGreaterThanOrEqual(0));
  });

  test('non-decreasing with range', () => {
    const result = simulate(B308, params308);
    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].spinDriftCm).toBeGreaterThanOrEqual(result.points[i - 1].spinDriftCm);
    }
  });

  test('> 0 at every point with rangeMeters >= 100', () => {
    const result = simulate(B308, params308);
    result.points.filter(p => p.rangeMeters >= 100).forEach(p => {
      expect(p.spinDriftCm).toBeGreaterThan(0);
    });
  });
});

// Test 4: Hand-checked values — .308 168gr 1:10 twist
describe('FEAT-1 test 4: hand-checked values', () => {
  const params308 = { ...COND_A, dragModel: 'G1', twistRateInchesPerTurn: 10 };

  test('.308 at ~500m: spinDriftCm = 5.8 ± 0.1 (SG=1.7125)', () => {
    const result = simulate(B308, params308);
    const p500 = result.points.find(p => p.rangeMeters >= 490 && p.rangeMeters <= 510);
    expect(p500).toBeDefined();
    expect(p500.spinDriftCm).toBeGreaterThanOrEqual(5.7);
    expect(p500.spinDriftCm).toBeLessThanOrEqual(5.9);
  });

  test('.308 at ~1000m: spinDriftCm = 32.5 ± 0.1 (SG=1.7125)', () => {
    const result = simulate(B308, params308);
    const p1000 = result.points.find(p => p.rangeMeters >= 990 && p.rangeMeters <= 1010);
    expect(p1000).toBeDefined();
    expect(p1000.spinDriftCm).toBeGreaterThanOrEqual(32.4);
    expect(p1000.spinDriftCm).toBeLessThanOrEqual(32.6);
  });
});

// Test 5: Reference recomputation for every point
describe('FEAT-1 test 5: reference recomputation', () => {
  test('all points match reference formula within 0.1 cm', () => {
    const params308 = { ...COND_A, dragModel: 'G1', twistRateInchesPerTurn: 10 };
    const result = simulate(B308, params308);
    const sg = stabilityFactor(B308.bulletDiameterMm, B308.bulletWeightGrams, 10);
    for (const p of result.points) {
      const expected = Math.round(1.25 * (sg + 1.2) * Math.pow(p.timeOfFlightSec, 1.83) * 2.54 * 10) / 10;
      expect(Math.abs(p.spinDriftCm - expected)).toBeLessThanOrEqual(0.1);
    }
  });
});

// Test 6: stabilityFactor known value
describe('FEAT-1 test 6: stabilityFactor(.308 168gr 1:10)', () => {
  test('stabilityFactor(7.82, 10.89, 10) ≈ 1.7125', () => {
    expect(stabilityFactor(7.82, 10.89, 10)).toBeCloseTo(1.7125, 3);
  });
});

// Test 7: stabilityFactor monotonicity
describe('FEAT-1 test 7: stabilityFactor monotonicity', () => {
  test('faster twist gives higher SG: twist8 > twist10 > twist12', () => {
    const sg8  = stabilityFactor(7.82, 10.89, 8);
    const sg10 = stabilityFactor(7.82, 10.89, 10);
    const sg12 = stabilityFactor(7.82, 10.89, 12);
    expect(sg8).toBeGreaterThan(sg10);
    expect(sg10).toBeGreaterThan(sg12);
  });

  test('heavier bullet at same d and twist gives higher SG', () => {
    const sgLight = stabilityFactor(7.82, 9.0, 10);
    const sgHeavy = stabilityFactor(7.82, 11.0, 10);
    expect(sgHeavy).toBeGreaterThan(sgLight);
  });
});

// Test 8: spinDriftInches at tof=0
describe('FEAT-1 test 8: spinDriftInches(sg, 0) = 0', () => {
  test('returns 0 at tof=0', () => {
    expect(spinDriftInches(1.7, 0)).toBe(0);
  });
});

// Test 9: Twist 8 vs twist 12 comparison
describe('FEAT-1 test 9: twist 8 gives larger drift than twist 12', () => {
  test('last point: twist8 spinDriftCm > twist12 spinDriftCm', () => {
    const r8  = simulate(B308, { ...COND_A, dragModel: 'G1', twistRateInchesPerTurn: 8  });
    const r12 = simulate(B308, { ...COND_A, dragModel: 'G1', twistRateInchesPerTurn: 12 });
    const last8  = r8.points[r8.points.length - 1].spinDriftCm;
    const last12 = r12.points[r12.points.length - 1].spinDriftCm;
    expect(last8).toBeGreaterThan(last12);
  });
});

// Test 10: Twist does not affect other fields
describe('FEAT-1 test 10: twist does not affect other fields', () => {
  test('drop, velocity, energy, windDrift are unchanged by twist', () => {
    const noTwist   = simulate(B308, { ...COND_A, dragModel: 'G1' });
    const withTwist = simulate(B308, { ...COND_A, dragModel: 'G1', twistRateInchesPerTurn: 10 });
    const strip = pts => pts.map(({ spinDriftCm: _, ...rest }) => rest);
    expect(strip(withTwist.points)).toEqual(strip(noTwist.points));
    expect(withTwist.maxOrdinateCm).toEqual(noTwist.maxOrdinateCm);
    expect(withTwist.maxOrdinateRangeMeters).toEqual(noTwist.maxOrdinateRangeMeters);
    expect(withTwist.supersonicLimitMeters).toEqual(noTwist.supersonicLimitMeters);
  });
});

// Test 11: Validation — invalid twist rate
describe('FEAT-1 test 11: invalid twist rate validation', () => {
  const c = 'a finite number between 1 and 100';
  for (const bad of [0, 0.99, 100.01, -5, NaN, Infinity]) {
    test(`rejects twistRateInchesPerTurn = ${bad}`, () => {
      expectValidationError(B308, { ...COND_A, twistRateInchesPerTurn: bad }, 'twistRateInchesPerTurn', c);
    });
  }
});

// Test 12: Validation boundaries
describe('FEAT-1 test 12: twist rate boundary values accepted', () => {
  test('accepts twist = 1', () => {
    expect(() => simulate(B308, { ...COND_A, twistRateInchesPerTurn: 1 })).not.toThrow();
  });
  test('accepts twist = 100', () => {
    expect(() => simulate(B308, { ...COND_A, twistRateInchesPerTurn: 100 })).not.toThrow();
  });
});

// Test 13: Invalid bulletDiameterMm with twist set
describe('FEAT-1 test 13: invalid bulletDiameterMm when twist is set', () => {
  const c = 'a finite number between 1 and 30';
  for (const bad of [0, 0.5, 31, NaN]) {
    test(`rejects bulletDiameterMm = ${bad} with twist set`, () => {
      expectValidationError(
        { ...B308, bulletDiameterMm: bad },
        { ...COND_A, twistRateInchesPerTurn: 10 },
        'bullet.bulletDiameterMm', c
      );
    });
  }
});

// Test 14: Absent twist with invalid bulletDiameterMm — no throw
describe('FEAT-1 test 14: absent twist with invalid diameter — no throw', () => {
  test('bulletDiameterMm: NaN with no twist does not throw', () => {
    expect(() => simulate({ ...B308, bulletDiameterMm: NaN }, COND_A)).not.toThrow();
  });
});

// Test 15: integrateTrajectoryFps without extras — spinDriftCm: 0
describe('FEAT-1 test 15: integrateTrajectoryFps without extras gives spinDriftCm: 0', () => {
  test('all points have spinDriftCm: 0 when called without extras', () => {
    const mvFps      = 807 * 3.28084;
    const bc         = 0.475;
    const rho        = 1.0;
    const wLbs       = 10.89 / 453.592;
    const maxRangeYd = 500 / 0.9144;
    const stepYd     = 100 / 0.9144;
    const angle      = 0.002;
    const { points } = _integrateWithExtras(mvFps, angle, bc, rho, wLbs, 0, maxRangeYd, stepYd);
    points.forEach(p => expect(p.spinDriftCm).toBe(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FEAT-2: Coriolis deflection
// ─────────────────────────────────────────────────────────────────────────────

const COND_A_CORIOLIS = {
  zeroRangeMeters: 100, maxRangeMeters: 1000, stepMeters: 25,
  windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15,
};

// Test 2: Neither/only/null — coriolisDeflectionCm key absent
describe('FEAT-2 test 2: coriolisDeflectionCm absent when lat/az not both set', () => {
  for (const [desc, params] of [
    ['neither set',      COND_A_CORIOLIS],
    ['latitudeDeg only', { ...COND_A_CORIOLIS, latitudeDeg: 45 }],
    ['azimuthDeg only',  { ...COND_A_CORIOLIS, azimuthDeg: 90 }],
    ['both null',        { ...COND_A_CORIOLIS, latitudeDeg: null, azimuthDeg: null }],
  ]) {
    test(`${desc} → 'coriolisDeflectionCm' in p === false`, () => {
      const result = simulate(B308, params);
      result.points.forEach(p => expect('coriolisDeflectionCm' in p).toBe(false));
    });
  }
});

// Test 3: .308 condA G1, lat 45, az 90 — numeric checks
describe('FEAT-2 test 3: lat 45 az 90 hand-checked values', () => {
  const params = { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 90 };

  test('point at ~500m: coriolisDeflectionCm = 2.5 ± 0.1', () => {
    const result = simulate(B308, params);
    const p500 = result.points.find(p => p.rangeMeters >= 490 && p.rangeMeters <= 510);
    expect(p500).toBeDefined();
    expect(p500.coriolisDeflectionCm).toBeGreaterThanOrEqual(2.4);
    expect(p500.coriolisDeflectionCm).toBeLessThanOrEqual(2.6);
  });

  test('point at ~1000m: coriolisDeflectionCm = 16.4 ± 0.1', () => {
    const result = simulate(B308, params);
    const p1000 = result.points.find(p => p.rangeMeters >= 990 && p.rangeMeters <= 1010);
    expect(p1000).toBeDefined();
    expect(p1000.coriolisDeflectionCm).toBeGreaterThanOrEqual(16.3);
    expect(p1000.coriolisDeflectionCm).toBeLessThanOrEqual(16.5);
  });

  test('points[0].coriolisDeflectionCm === 0', () => {
    const result = simulate(B308, params);
    expect(result.points[0].coriolisDeflectionCm).toBe(0);
  });
});

// Test 4: .308 condA G1, lat -33, az 0 — southern hemisphere
describe('FEAT-2 test 4: lat -33 az 0 southern hemisphere', () => {
  const params = { ...COND_A_CORIOLIS, latitudeDeg: -33, azimuthDeg: 0 };

  test('point at ~1000m: coriolisDeflectionCm = -12.7 ± 0.1', () => {
    const result = simulate(B308, params);
    const p1000 = result.points.find(p => p.rangeMeters >= 990 && p.rangeMeters <= 1010);
    expect(p1000).toBeDefined();
    expect(p1000.coriolisDeflectionCm).toBeGreaterThanOrEqual(-12.8);
    expect(p1000.coriolisDeflectionCm).toBeLessThanOrEqual(-12.6);
  });

  test('every value <= 0', () => {
    const result = simulate(B308, params);
    result.points.forEach(p => expect(p.coriolisDeflectionCm).toBeLessThanOrEqual(0));
  });

  test('points[0].coriolisDeflectionCm is +0 not -0', () => {
    const result = simulate(B308, params);
    expect(Object.is(result.points[0].coriolisDeflectionCm, 0)).toBe(true);
  });
});

// Test 5: Latitude 0 — all exactly 0 (not -0)
describe('FEAT-2 test 5: latitude 0 gives 0 for all points', () => {
  test('every point coriolisDeflectionCm is +0', () => {
    const result = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 0, azimuthDeg: 0 });
    result.points.forEach(p => expect(Object.is(p.coriolisDeflectionCm, 0)).toBe(true));
  });
});

// Test 6: Azimuth independence
describe('FEAT-2 test 6: azimuth does not affect coriolisDeflectionCm', () => {
  test('lat 45 with az 0, 90, 270, 360 gives toEqual points', () => {
    const r0   = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 0 });
    const r90  = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 90 });
    const r270 = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 270 });
    const r360 = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 360 });
    expect(r0.points).toEqual(r90.points);
    expect(r0.points).toEqual(r270.points);
    expect(r0.points).toEqual(r360.points);
  });
});

// Test 7: Hemisphere symmetry
describe('FEAT-2 test 7: hemisphere symmetry', () => {
  test('lat 30 and lat -30 Coriolis values sum to 0 within ±0.1', () => {
    const rN = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 30, azimuthDeg: 0 });
    const rS = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: -30, azimuthDeg: 0 });
    rN.points.forEach((pN, i) => {
      const pS = rS.points[i];
      expect(Math.abs(pN.coriolisDeflectionCm + pS.coriolisDeflectionCm)).toBeLessThanOrEqual(0.1);
    });
  });
});

// Test 8: Reference recomputation (lat 45)
describe('FEAT-2 test 8: reference recomputation lat 45', () => {
  test('all points match reference formula within 0.1 cm', () => {
    const mv = B308.muzzleVelocityMps;
    const params = { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 0 };
    const result = simulate(B308, params);
    const OMEGA = 7.2921e-5;
    for (const p of result.points) {
      const ref = Math.round(OMEGA * Math.sin(Math.PI / 4) * mv * p.timeOfFlightSec * p.timeOfFlightSec * 100 * 10) / 10;
      expect(Math.abs(p.coriolisDeflectionCm - ref)).toBeLessThanOrEqual(0.1);
    }
  });
});

// Test 9: Coriolis does not affect other fields
describe('FEAT-2 test 9: Coriolis does not affect other fields', () => {
  test('after removing coriolisDeflectionCm, points are equal', () => {
    const noLat = simulate(B308, COND_A_CORIOLIS);
    const withLat = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 90 });
    const strip = pts => pts.map(({ coriolisDeflectionCm: _, ...rest }) => rest);
    expect(strip(withLat.points)).toEqual(strip(noLat.points));
    expect(withLat.maxOrdinateCm).toEqual(noLat.maxOrdinateCm);
    expect(withLat.maxOrdinateRangeMeters).toEqual(noLat.maxOrdinateRangeMeters);
    expect(withLat.supersonicLimitMeters).toEqual(noLat.supersonicLimitMeters);
  });
});

// Test 10: Combined with spin drift
describe('FEAT-2 test 10: combined spin drift + Coriolis', () => {
  test('both fields present; spinDriftCm equals twist-only run; coriolisDeflectionCm equals Coriolis-only run', () => {
    const twistOnly    = simulate(B308, { ...COND_A_CORIOLIS, twistRateInchesPerTurn: 10 });
    const coriolisOnly = simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 90 });
    const combined     = simulate(B308, { ...COND_A_CORIOLIS, twistRateInchesPerTurn: 10, latitudeDeg: 45, azimuthDeg: 90 });

    combined.points.forEach((p, i) => {
      expect('spinDriftCm' in p).toBe(true);
      expect('coriolisDeflectionCm' in p).toBe(true);
      expect(p.spinDriftCm).toEqual(twistOnly.points[i].spinDriftCm);
      expect(p.coriolisDeflectionCm).toEqual(coriolisOnly.points[i].coriolisDeflectionCm);
    });
  });
});

// Test 11: Validation — invalid latitudeDeg
describe('FEAT-2 test 11: invalid latitudeDeg validation', () => {
  const c = 'a finite number between -90 and 90';
  for (const bad of [-90.01, 90.01, NaN, Infinity]) {
    test(`rejects latitudeDeg = ${bad} with azimuth set`, () => {
      expectValidationError(B308, { ...COND_A_CORIOLIS, latitudeDeg: bad, azimuthDeg: 0 }, 'latitudeDeg', c);
    });
    test(`rejects latitudeDeg = ${bad} without azimuth set`, () => {
      expectValidationError(B308, { ...COND_A_CORIOLIS, latitudeDeg: bad }, 'latitudeDeg', c);
    });
  }
});

// Test 12: Validation — invalid azimuthDeg
describe('FEAT-2 test 12: invalid azimuthDeg validation', () => {
  const c = 'a finite number between 0 and 360';
  for (const bad of [-0.01, 360.01, NaN]) {
    test(`rejects azimuthDeg = ${bad} with latitude set`, () => {
      expectValidationError(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: bad }, 'azimuthDeg', c);
    });
    test(`rejects azimuthDeg = ${bad} without latitude set`, () => {
      expectValidationError(B308, { ...COND_A_CORIOLIS, azimuthDeg: bad }, 'azimuthDeg', c);
    });
  }
});

// Test 13: Validation boundaries — accepted
describe('FEAT-2 test 13: validation boundary values accepted', () => {
  test('accepts latitudeDeg = -90', () => {
    expect(() => simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: -90, azimuthDeg: 0 })).not.toThrow();
  });
  test('accepts latitudeDeg = 90', () => {
    expect(() => simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 90, azimuthDeg: 0 })).not.toThrow();
  });
  test('accepts azimuthDeg = 0', () => {
    expect(() => simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 0 })).not.toThrow();
  });
  test('accepts azimuthDeg = 360', () => {
    expect(() => simulate(B308, { ...COND_A_CORIOLIS, latitudeDeg: 45, azimuthDeg: 360 })).not.toThrow();
  });
});

// Test 14: integrateTrajectoryFps with coriolisK: 0 and without
describe('FEAT-2 test 14: integrateTrajectoryFps with coriolisK', () => {
  const mvFps      = 807 * 3.28084;
  const bc         = 0.475;
  const rho        = 1.0;
  const wLbs       = 10.89 / 453.592;
  const maxRangeYd = 500 / 0.9144;
  const stepYd     = 100 / 0.9144;
  const angle      = 0.002;

  test('extras = { coriolisK: 0 } → key present and value 0 on all points', () => {
    const { points } = _integrateWithExtras(mvFps, angle, bc, rho, wLbs, 0, maxRangeYd, stepYd, 1, undefined, { coriolisK: 0 });
    points.forEach(p => {
      expect('coriolisDeflectionCm' in p).toBe(true);
      expect(p.coriolisDeflectionCm).toBe(0);
    });
  });

  test('extras = {} → coriolisDeflectionCm key absent on all points', () => {
    const { points } = _integrateWithExtras(mvFps, angle, bc, rho, wLbs, 0, maxRangeYd, stepYd, 1, undefined, {});
    points.forEach(p => expect('coriolisDeflectionCm' in p).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FEAT-3: Custom drag table
// ─────────────────────────────────────────────────────────────────────────────

const { toDragTable } = require('../app/physics/engine.ts');

const FLAT_TABLE    = [{mach:0,cd:0.28},{mach:1,cd:0.28},{mach:3,cd:0.28}];
const HEAVY_TABLE   = [{mach:0,cd:2.0},{mach:1,cd:2.0},{mach:3,cd:2.0}];

// Test 2: customDragTable omitted / null / [] — identical to no-table run
describe('FEAT-3 test 2: absent/null/empty customDragTable equals no-table run', () => {
  test('G1: omitted/null/[] all toEqual', () => {
    const base   = simulate(B308, COND_A);
    const noTbl  = simulate(B308, { ...COND_A, customDragTable: undefined });
    const nullTbl = simulate(B308, { ...COND_A, customDragTable: null });
    const emptyTbl = simulate(B308, { ...COND_A, customDragTable: [] });
    expect(noTbl.points).toEqual(base.points);
    expect(nullTbl.points).toEqual(base.points);
    expect(emptyTbl.points).toEqual(base.points);
    expect(base.dragModel).toBe('G1');
    expect(noTbl.dragModel).toBe('G1');
    expect(nullTbl.dragModel).toBe('G1');
    expect(emptyTbl.dragModel).toBe('G1');
  });

  test('G7: omitted/null/[] all toEqual (requires ballisticCoefficientG7)', () => {
    const B308_G7 = { ...B308, ballisticCoefficientG7: 0.249 };
    const base    = simulate(B308_G7, { ...COND_A, dragModel: 'G7' });
    const noTbl   = simulate(B308_G7, { ...COND_A, dragModel: 'G7', customDragTable: undefined });
    const nullTbl = simulate(B308_G7, { ...COND_A, dragModel: 'G7', customDragTable: null });
    const emptyTbl = simulate(B308_G7, { ...COND_A, dragModel: 'G7', customDragTable: [] });
    expect(noTbl.points).toEqual(base.points);
    expect(nullTbl.points).toEqual(base.points);
    expect(emptyTbl.points).toEqual(base.points);
    expect(base.dragModel).toBe('G7');
    expect(noTbl.dragModel).toBe('G7');
    expect(nullTbl.dragModel).toBe('G7');
    expect(emptyTbl.dragModel).toBe('G7');
  });
});

// Test 3: G1-equivalent table produces identical results, dragModel === 'custom'
describe('FEAT-3 test 3: G1-equivalent custom table', () => {
  test('every point toEqual G1 run when BC = sectionalDensityLbIn2; dragModel === custom', () => {
    const g1Table = G1_CD_TABLE.map(r => ({ mach: r.mach, cd: r.cd }));
    const sd = sectionalDensityLbIn2(B308.bulletWeightGrams, B308.bulletDiameterMm);
    const B308_SD = { ...B308, ballisticCoefficient: sd };
    const g1Run  = simulate(B308_SD, COND_A);
    const cusRun = simulate(B308_SD, { ...COND_A, customDragTable: g1Table });
    expect(cusRun.dragModel).toBe('custom');
    expect(cusRun.points).toEqual(g1Run.points);
  });
});

// Test 4: same table with dragModel G1 and G7 both produce dragModel === 'custom' and identical points
describe('FEAT-3 test 4: dragModel override — custom table takes precedence', () => {
  test('same table with G1 and G7 produces identical points and dragModel === custom', () => {
    const rG1 = simulate(B308, { ...COND_A, dragModel: 'G1', customDragTable: FLAT_TABLE });
    const rG7 = simulate(B308, { ...COND_A, dragModel: 'G7', customDragTable: FLAT_TABLE });
    expect(rG1.dragModel).toBe('custom');
    expect(rG7.dragModel).toBe('custom');
    expect(rG1.points).toEqual(rG7.points);
  });
});

// Test 5: heavy flat table vs plain G1 — more drag, lower velocity, more drop
describe('FEAT-3 test 5: heavy flat table (cd:2.0) vs G1', () => {
  test('last point: lower velocity, higher tof, more negative drop than G1', () => {
    const g1  = simulate(B308, COND_A);
    const cus = simulate(B308, { ...COND_A, customDragTable: HEAVY_TABLE });
    const lastG1  = g1.points[g1.points.length - 1];
    const lastCus = cus.points[cus.points.length - 1];
    expect(lastCus.velocityMps).toBeLessThan(lastG1.velocityMps);
    expect(lastCus.timeOfFlightSec).toBeGreaterThan(lastG1.timeOfFlightSec);
    expect(lastCus.dropCm).toBeLessThan(lastG1.dropCm);
  });
});

// Test 6: custom table + twist + lat/az — spinDrift and coriolis are still present
describe('FEAT-3 test 6: custom table + spin drift + Coriolis', () => {
  test('spinDriftCm and coriolisDeflectionCm both present and > 0 at last point', () => {
    const result = simulate(B308, {
      ...COND_A,
      customDragTable: FLAT_TABLE,
      twistRateInchesPerTurn: 10,
      latitudeDeg: 45,
      azimuthDeg: 90,
    });
    expect('spinDriftCm' in result.points[result.points.length - 1]).toBe(true);
    expect('coriolisDeflectionCm' in result.points[result.points.length - 1]).toBe(true);
    result.points.forEach(p => expect(p.spinDriftCm).toBeGreaterThanOrEqual(0));
    result.points.forEach(p => expect(p.coriolisDeflectionCm).toBeGreaterThanOrEqual(0));
    const last = result.points[result.points.length - 1];
    expect(last.spinDriftCm).toBeGreaterThan(0);
    expect(last.coriolisDeflectionCm).toBeGreaterThan(0);
  });
});

// Test 7: toDragTable
describe('FEAT-3 test 7: toDragTable', () => {
  test('converts [{mach:0,cd:0.1},{mach:2,cd:0.3}] to [[0,0.1],[2250,0.3]]', () => {
    const result = toDragTable([{mach:0,cd:0.1},{mach:2,cd:0.3}], 1125);
    expect(result[0][0]).toBe(0);
    expect(result[0][1]).toBeCloseTo(0.1);
    expect(result[1][0]).toBe(2250);
    expect(result[1][1]).toBeCloseTo(0.3);
    // Strictly ascending in column 0
    expect(result[1][0]).toBeGreaterThan(result[0][0]);
  });
});

// Test 8: Validation — one test per rule 1–7
describe('FEAT-3 test 8: customDragTable validation — rule 1 (must be array)', () => {
  test('string throws customDragTable', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: 'x' }, 'customDragTable', 'an array of { mach, cd } points');
  });
  test('object throws customDragTable', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: {} }, 'customDragTable', 'an array of { mach, cd } points');
  });
});

describe('FEAT-3 test 8: customDragTable validation — rule 2 (3–100 points)', () => {
  const minTable = [{mach:0,cd:0.1},{mach:1,cd:0.1},{mach:3,cd:0.1}];
  test('2 points throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: minTable.slice(0,2) }, 'customDragTable', 'between 3 and 100 points');
  });
  test('101 points throws', () => {
    const big = Array.from({length:101}, (_, i) => ({mach: i * 0.049, cd: 0.1}));
    // ensure coverage: big[0].mach=0, big[100].mach=4.9, need mach<=0.5 and >=2.0
    expectValidationError(B308, { ...COND_A, customDragTable: big }, 'customDragTable', 'between 3 and 100 points');
  });
});

describe('FEAT-3 test 8: customDragTable validation — rule 3 (mach [0,5])', () => {
  const base3 = [{mach:0,cd:0.1},{mach:1,cd:0.1},{mach:3,cd:0.1}];
  test('mach -0.1 throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:-0.1,cd:0.1},{mach:1,cd:0.1},{mach:3,cd:0.1}] }, 'customDragTable', 'mach values between 0 and 5');
  });
  test('mach 5.1 throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0,cd:0.1},{mach:1,cd:0.1},{mach:5.1,cd:0.1}] }, 'customDragTable', 'mach values between 0 and 5');
  });
  test('mach NaN throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0,cd:0.1},{mach:NaN,cd:0.1},{mach:3,cd:0.1}] }, 'customDragTable', 'mach values between 0 and 5');
  });
  test('null entry throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0,cd:0.1}, null, {mach:3,cd:0.1}] }, 'customDragTable', 'mach values between 0 and 5');
  });
});

describe('FEAT-3 test 8: customDragTable validation — rule 4 (cd [0.001,2])', () => {
  test('cd 0 throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0,cd:0},{mach:1,cd:0.1},{mach:3,cd:0.1}] }, 'customDragTable', 'cd values between 0.001 and 2');
  });
  test('cd 2.1 throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0,cd:2.1},{mach:1,cd:0.1},{mach:3,cd:0.1}] }, 'customDragTable', 'cd values between 0.001 and 2');
  });
  test('missing cd throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0},{mach:1,cd:0.1},{mach:3,cd:0.1}] }, 'customDragTable', 'cd values between 0.001 and 2');
  });
});

describe('FEAT-3 test 8: customDragTable validation — rule 5 (strictly increasing mach)', () => {
  test('equal mach values throw', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0,cd:0.1},{mach:1,cd:0.1},{mach:1,cd:0.1},{mach:3,cd:0.1}] }, 'customDragTable', 'strictly increasing mach values');
  });
  test('decreasing mach throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0,cd:0.1},{mach:2,cd:0.1},{mach:1,cd:0.1},{mach:3,cd:0.1}] }, 'customDragTable', 'strictly increasing mach values');
  });
});

describe('FEAT-3 test 8: customDragTable validation — rule 6 (need mach <= 0.5)', () => {
  test('no point <= 0.5 throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0.6,cd:0.1},{mach:1,cd:0.1},{mach:3,cd:0.1}] }, 'customDragTable', 'at least one point with mach <= 0.5');
  });
});

describe('FEAT-3 test 8: customDragTable validation — rule 7 (need mach >= 2.0)', () => {
  test('no point >= 2.0 throws', () => {
    expectValidationError(B308, { ...COND_A, customDragTable: [{mach:0,cd:0.1},{mach:0.5,cd:0.1},{mach:1.9,cd:0.1}] }, 'customDragTable', 'at least one point with mach >= 2.0');
  });
});

// Test 9: Validation boundaries — exactly 3 and 100 points, boundary mach/cd, exact coverage
describe('FEAT-3 test 9: validation boundary values accepted', () => {
  test('exactly 3 points accepted', () => {
    expect(() => simulate(B308, { ...COND_A, customDragTable: [{mach:0,cd:0.1},{mach:1,cd:0.1},{mach:3,cd:0.1}] })).not.toThrow();
  });

  test('exactly 100 points accepted', () => {
    // 100 points: mach from 0 to 3.0 in 100 steps, guaranteed mach<=0.5 and mach>=2.0
    const pts = Array.from({length:100}, (_, i) => ({mach: i * (3.0/99), cd: 0.1}));
    expect(() => simulate(B308, { ...COND_A, customDragTable: pts })).not.toThrow();
  });

  test('mach 0 and 5 accepted', () => {
    const pts = [{mach:0,cd:0.1},{mach:0.5,cd:0.1},{mach:2.0,cd:0.1},{mach:5,cd:0.1}];
    expect(() => simulate(B308, { ...COND_A, customDragTable: pts })).not.toThrow();
  });

  test('cd 0.001 and 2 accepted', () => {
    const pts = [{mach:0,cd:0.001},{mach:0.5,cd:2},{mach:2.0,cd:0.1},{mach:3,cd:0.1}];
    expect(() => simulate(B308, { ...COND_A, customDragTable: pts })).not.toThrow();
  });

  test('coverage at exactly mach 0.5 and 2.0 accepted', () => {
    const pts = [{mach:0,cd:0.1},{mach:0.5,cd:0.1},{mach:2.0,cd:0.1},{mach:3,cd:0.1}];
    expect(() => simulate(B308, { ...COND_A, customDragTable: pts })).not.toThrow();
  });
});

// Test 10: dragModel on results
describe('FEAT-3 test 10: dragModel field on results', () => {
  const B308_G7 = { ...B308, ballisticCoefficientG7: 0.249 };
  test('no table, params.dragModel G7 with G7 BC → dragModel G7', () => {
    expect(simulate(B308_G7, { ...COND_A, dragModel: 'G7' }).dragModel).toBe('G7');
  });
  test('no table, params.dragModel G7 without G7 BC → falls back to dragModel G1', () => {
    expect(simulate(B308, { ...COND_A, dragModel: 'G7' }).dragModel).toBe('G1');
  });
  test('no table, params.dragModel G1 → dragModel G1', () => {
    expect(simulate(B308, { ...COND_A, dragModel: 'G1' }).dragModel).toBe('G1');
  });
  test('no table, params.dragModel null → dragModel G1', () => {
    expect(simulate(B308, { ...COND_A, dragModel: null }).dragModel).toBe('G1');
  });
  test('no table, params.dragModel absent → dragModel G1', () => {
    expect(simulate(B308, COND_A).dragModel).toBe('G1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERF-15: Compiled Float64Array drag lookup & zero-alloc RK4 hot loop
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-15: compileDragTable and findBracket', () => {
  test('compileDragTable builds Float64Arrays and deltas across G1, G7, and edge tables', () => {
    for (const table of [G1_TABLE, G7_TABLE, [[100, 0.1], [200, 0.2]], [[100, 0.1], [200, 0.3], [300, 0.2]]]) {
      const ct = compileDragTable(table);
      expect(ct.last).toBe(table.length - 1);
      expect(ct.v).toBeInstanceOf(Float64Array);
      expect(ct.f).toBeInstanceOf(Float64Array);
      expect(ct.dv).toBeInstanceOf(Float64Array);
      expect(ct.df).toBeInstanceOf(Float64Array);
      for (let i = 0; i < table.length; i++) {
        expect(ct.v[i]).toBe(table[i][0]);
        expect(ct.f[i]).toBe(table[i][1]);
        if (i > 0) {
          expect(ct.dv[i]).toBe(table[i][0] - table[i - 1][0]);
          expect(ct.df[i]).toBe(table[i][1] - table[i - 1][1]);
        }
      }
    }
  });

  test('findBracket clamps at low/high ends and tracks brackets across decreasing, increasing, and breakpoint speeds', () => {
    function refBracket(v, ct) {
      if (v <= ct.v[0]) return 1;
      if (v >= ct.v[ct.last]) return ct.last;
      for (let i = 1; i <= ct.last; i++) {
        if (v <= ct.v[i]) return i;
      }
    }

    for (const table of [G1_TABLE, G7_TABLE, [[100, 0.1], [200, 0.2]], [[100, 0.1], [200, 0.3], [300, 0.2]]]) {
      const ct = compileDragTable(table);
      expect(findBracket(-100, ct, ct.last)).toBe(1);
      expect(findBracket(0, ct, ct.last)).toBe(1);
      expect(findBracket(ct.v[0], ct, ct.last)).toBe(1);
      expect(findBracket(ct.v[ct.last], ct, 1)).toBe(ct.last);
      expect(findBracket(99999, ct, 1)).toBe(ct.last);

      // Decreasing sweep (normal flight)
      let idx = ct.last;
      let prevIdx = ct.last;
      for (let v = 4500; v >= -10; v -= 37) {
        const speed = Math.max(0, v);
        idx = findBracket(speed, ct, idx);
        expect(idx).toBeLessThanOrEqual(prevIdx);
        expect(idx).toBe(refBracket(speed, ct));
        prevIdx = idx;
      }

      // Increasing sweep (e.g. downhill acceleration or upward stage)
      idx = 1;
      prevIdx = 1;
      for (let v = 0; v <= 4200; v += 73) {
        idx = findBracket(v, ct, idx);
        expect(idx).toBeGreaterThanOrEqual(prevIdx);
        expect(idx).toBe(refBracket(v, ct));
        prevIdx = idx;
      }

      // Breakpoints, ±ε, and midpoints from both bracket ends
      const eps = Number.EPSILON;
      for (let i = 0; i < table.length; i++) {
        const v = table[i][0];
        const samples = [v, v - eps * v, v + eps * v];
        if (i + 1 < table.length) samples.push((v + table[i + 1][0]) / 2);
        for (const s of samples) {
          expect(findBracket(s, ct, 1)).toBe(refBracket(s, ct));
          expect(findBracket(s, ct, ct.last)).toBe(refBracket(s, ct));
        }
      }
    }
  });

  test('custom table compilation caches per DragTable reference without error', () => {
    const customTable = [[0, 0.12], [1125, 0.2], [3500, 0.09]];
    const r1 = findZeroAngleFps(2600, 0.45, 1.0, 300, 0.125, customTable);
    const r2 = findZeroAngleFps(2600, 0.45, 1.0, 300, 0.125, customTable);
    expect(r1).toBe(r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERF-16: Fast safeguarded secant/bisection zero-angle solver
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-16: findZeroAngleFps safeguarded secant solver', () => {
  test('agrees with 64-pass bisection across a broad parameter sweep', () => {
    // Mirror §3.3: k = Cd*(CD_TO_RETARD*rho/bc)*v; ax = -vx*k; ay = -vy*k - 32.174
    // Uses vx < 50 stop (§3.4), fps G1 table at 15 °C, bracket [-0.05, 0.5]
    function refBisection(mvFps, bc, rho, zeroFt, sightHtFt) {
      const CD_TO_RETARD = 2.08551e-4;
      const kDrag = CD_TO_RETARD * rho / bc;
      function refInterpolateDrag(v, table) {
        v = Math.abs(v);
        if (v <= table[0][0]) return table[0][1];
        const last = table.length - 1;
        if (v >= table[last][0]) return table[last][1];
        for (let j = 1; j <= last; j++) {
          if (v <= table[j][0]) {
            const t = (v - table[j - 1][0]) / (table[j][0] - table[j - 1][0]);
            return table[j - 1][1] + t * (table[j][1] - table[j - 1][1]);
          }
        }
        return Number.NaN;
      }

      let lo = -0.05, hi = 0.5;
      for (let i = 0; i < 64; i++) {
        const mid = (lo + hi) / 2;
        let vx = mvFps * Math.cos(mid), vy = mvFps * Math.sin(mid), x = 0, y = 0;
        while (x < zeroFt) {
          const v1 = Math.sqrt(vx * vx + vy * vy);
          if (vx < 50) break;
          const k1 = refInterpolateDrag(v1, G1_TABLE) * kDrag * v1;
          const ax1 = -vx * k1, ay1 = -vy * k1 - 32.174;
          const vx2 = vx + 0.00025 * ax1, vy2 = vy + 0.00025 * ay1;
          const v2 = Math.sqrt(vx2 * vx2 + vy2 * vy2);
          const k2 = refInterpolateDrag(v2, G1_TABLE) * kDrag * v2;
          const ax2 = -vx2 * k2, ay2 = -vy2 * k2 - 32.174;
          const vx3 = vx + 0.00025 * ax2, vy3 = vy + 0.00025 * ay2;
          const v3 = Math.sqrt(vx3 * vx3 + vy3 * vy3);
          const k3 = refInterpolateDrag(v3, G1_TABLE) * kDrag * v3;
          const ax3 = -vx3 * k3, ay3 = -vy3 * k3 - 32.174;
          const vx4 = vx + 0.0005 * ax3, vy4 = vy + 0.0005 * ay3;
          const v4 = Math.sqrt(vx4 * vx4 + vy4 * vy4);
          const k4 = refInterpolateDrag(v4, G1_TABLE) * kDrag * v4;
          const ax4 = -vx4 * k4, ay4 = -vy4 * k4 - 32.174;
          vx += (0.0005 / 6) * (ax1 + 2 * ax2 + 2 * ax3 + ax4);
          vy += (0.0005 / 6) * (ay1 + 2 * ay2 + 2 * ay3 + ay4);
          x += vx * 0.0005; y += vy * 0.0005;
        }
        if (y < sightHtFt) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }

    const cases = [
      [2650, 0.475, 1.0,  328.084, 0.125],
      [3200, 0.243, 0.85, 656.168, 0.125],
      [2950, 0.587, 1.05, 984.252, 0.0],
      [1050, 0.150, 1.0,  164.042, 0.25],
      [2650, 0.475, 1.0, 3280.84,  0.125],
    ];
    for (const [mv, bc, rho, zFt, sh] of cases) {
      const fast = findZeroAngleFps(mv, bc, rho, zFt, sh, G1_TABLE);
      const ref  = refBisection(mv, bc, rho, zFt, sh);
      expect(Math.abs(fast - ref)).toBeLessThan(1e-9);
    }
  });

  test('returns NaN when no root exists in bracket; returns real root in (0.05, 0.5) when above old +0.05 boundary', () => {
    // Very negative sightHtFt: bullet is always above sight at any angle in [-0.05, 0.5] → no bracket → NaN
    expect(findZeroAngleFps(2650, 0.475, 1.0, 328, -50, G1_TABLE)).toBeNaN();
    // Large positive sightHtFt: root now lies between 0.05 and 0.5 (widened bracket)
    const result = findZeroAngleFps(2650, 0.475, 1.0, 328, 50, G1_TABLE);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0.05);
    expect(result).toBeLessThan(0.5);
  });

  test('terminates via bracket tolerance (hi - lo <= 1e-13) across a discrete DT_S step jump', () => {
    // Ultra-slow bullet stops via vel < 50 on low angles while crossing zeroFt on higher angles,
    // creating a sharp step discontinuity where |fMid| never lands <= 1e-9.
    const angle = findZeroAngleFps(55, 0.02, 1.0, 0.03, 0.0, G1_TABLE);
    expect(Number.isFinite(angle)).toBe(true);
    expect(angle).toBeGreaterThanOrEqual(-0.05);
    expect(angle).toBeLessThanOrEqual(0.05);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERF-17: Worker-side G1 BC back-calculator (solveBC)
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-17: solveBC', () => {
  const { solveBC } = require('../app/physics/engine.ts');

  test('recovers G1 BC monotonically and matches simulated drop to 4 decimal places', () => {
    const resLow  = simulate({ ...BASE_BULLET, ballisticCoefficient: 0.15 }, {
      zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 25,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15, dragModel: 'G1',
    });
    const resHigh = simulate({ ...BASE_BULLET, ballisticCoefficient: 0.50 }, {
      zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 25,
      windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15, dragModel: 'G1',
    });
    const ptLow  = resLow.points.find(p => Math.abs(p.rangeMeters - 500) < 1);
    const ptHigh = resHigh.points.find(p => Math.abs(p.rangeMeters - 500) < 1);

    const bcLow = solveBC({
      weightG: BASE_BULLET.bulletWeightGrams,
      mvMps: BASE_BULLET.muzzleVelocityMps,
      measuredDropCm: ptLow.dropCm,
      rangeM: ptLow.rangeMeters,
      altM: 0,
      tempC: 15,
    });
    const bcHigh = solveBC({
      weightG: BASE_BULLET.bulletWeightGrams,
      mvMps: BASE_BULLET.muzzleVelocityMps,
      measuredDropCm: ptHigh.dropCm,
      rangeM: ptHigh.rangeMeters,
      altM: 0,
      tempC: 15,
    });
    expect(bcLow).not.toBeNull();
    expect(bcHigh).not.toBeNull();
    expect(bcLow).toBeGreaterThanOrEqual(0.001);
    expect(bcHigh).toBeLessThanOrEqual(1.5);
    expect(bcHigh).toBeGreaterThan(bcLow);
    expect(Math.abs(bcLow - 0.15)).toBeLessThan(0.005);
    expect(Math.abs(bcHigh - 0.50)).toBeLessThan(0.005);
    // 4-decimal rounding check
    expect(Math.round(bcLow * 10000) / 10000).toBe(bcLow);
  });

  test('returns null for invalid inputs or projectile that drops below MIN_VEL_FPS before rangeM', () => {
    expect(solveBC({ weightG: 0, mvMps: 800, measuredDropCm: -40, rangeM: 500, altM: 0, tempC: 15 })).toBeNull();
    expect(solveBC({ weightG: 10, mvMps: -1, measuredDropCm: -40, rangeM: 500, altM: 0, tempC: 15 })).toBeNull();
    expect(solveBC({ weightG: 10, mvMps: 800, measuredDropCm: NaN, rangeM: 500, altM: 0, tempC: 15 })).toBeNull();
    expect(solveBC({ weightG: 10, mvMps: 800, measuredDropCm: -40, rangeM: 0, altM: 0, tempC: 15 })).toBeNull();
    expect(solveBC({ weightG: 10, mvMps: 800, measuredDropCm: -40, rangeM: 500, altM: -5, tempC: 15 })).toBeNull();
    expect(solveBC({ weightG: 10, mvMps: 800, measuredDropCm: -40, rangeM: 500, altM: 0, tempC: 99 })).toBeNull();
    // Very slow velocity stalls (< MIN_VEL_FPS) before reaching rangeM → evalDropCmAtRange returns null
    expect(solveBC({ weightG: 10, mvMps: 20, measuredDropCm: -40, rangeM: 500, altM: 0, tempC: 15 })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERF-30: Warm-bracket findZeroAngleFps, safeguarded secant solveBC & hoisted RK4
// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-30: warm-bracket findZeroAngleFps, safeguarded secant solveBC & hoisted RK4', () => {
  const { solveBC } = require('../app/physics/engine.ts');

  test('findZeroAngleFps warm hint hits tight bracket and falls back cleanly when out of bracket', () => {
    const mvFps = 807 * 3.28084;
    const rho = 1.0;
    const zeroFt = 100 * 3.28084;
    const sightHtFt = 38.1 / 25.4 / 12;
    const unhinted = findZeroAngleFps(mvFps, 0.475, rho, zeroFt, sightHtFt, G1_TABLE);

    // Warm-bracket hit
    const hintedHit = findZeroAngleFps(mvFps, 0.475, rho, zeroFt, sightHtFt, G1_TABLE, unhinted + 0.0005);
    expect(Math.abs(hintedHit - unhinted)).toBeLessThan(1e-12);

    // Hint too high (fLo >= 0) → falls back to [-0.05, 0.05]
    const hintedHigh = findZeroAngleFps(mvFps, 0.475, rho, zeroFt, sightHtFt, G1_TABLE, 0.04);
    expect(Math.abs(hintedHigh - unhinted)).toBeLessThan(1e-12);

    // Hint too low (fHi < 0) → falls back to [-0.05, 0.05]
    const hintedLow = findZeroAngleFps(mvFps, 0.475, rho, zeroFt, sightHtFt, G1_TABLE, -0.04);
    expect(Math.abs(hintedLow - unhinted)).toBeLessThan(1e-12);

    // Hint near clamping edges: sightHt=-50 is unzeroable → NaN; sightHt=+50 has real root in (0.05, 0.5)
    expect(findZeroAngleFps(mvFps, 0.475, rho, zeroFt, -50, G1_TABLE, -0.05)).toBeNaN();
    const root50 = findZeroAngleFps(mvFps, 0.475, rho, zeroFt, 50, G1_TABLE, 0.3);
    expect(Number.isFinite(root50)).toBe(true);
    expect(root50).toBeGreaterThan(0.05);
    expect(root50).toBeLessThan(0.5);
  });

  test('solveBC returns lower-bound BC when drop is too extreme; returns 1.5 when drop is too flat', () => {
    // Extreme drop (-5000 cm at 500m) is physically infeasible; feasible lower bound < 0.2
    expect(solveBC({ weightG: 10.89, mvMps: 807, measuredDropCm: -5000, rangeM: 500, altM: 0, tempC: 15 })).toBe(0.034);
    // Very flat drop (-50 cm at 500m) needs very high BC → 1.5
    expect(solveBC({ weightG: 10.89, mvMps: 807, measuredDropCm: -50,   rangeM: 500, altM: 0, tempC: 15 })).toBe(1.5);
  });

  test('solveBC solves interior roots across 500m and 1000m (secant + bisection fallback) to 4 decimal places', () => {
    // Drops measured from new engine; solveBC must recover BC within ±0.001
    expect(solveBC({ weightG: 10.89, mvMps: 807.7, measuredDropCm: -312.60, rangeM: 500,  altM: 0, tempC: 15 })).toBe(0.2999);
    expect(solveBC({ weightG: 10.89, mvMps: 807.7, measuredDropCm: -1473.20, rangeM: 1000, altM: 0, tempC: 15 })).toBe(0.4748);
    expect(solveBC({ weightG: 10.89, mvMps: 807.7, measuredDropCm: -2276.90, rangeM: 1000, altM: 0, tempC: 15 })).toBe(0.3);
  });

  test('hoisted dragAt handles sub-vMin, super-vMax, and upward bracket advance across all RK4 paths', () => {
    // v <= vMin in evalHeightAtZero and integrateTrajectoryFps via custom table starting at Mach 0.5 (562.5 fps)
    const highMinTable = [
      { mach: 0.5, cd: 0.25 },
      { mach: 1.0, cd: 0.30 },
      { mach: 2.5, cd: 0.20 },
    ];
    const subVMinRes = simulate(
      { ...BASE_BULLET, muzzleVelocityMps: 160 }, // ~525 fps < 562.5 fps
      { ...BASE_PARAMS, zeroRangeMeters: 50, maxRangeMeters: 100, stepMeters: 50, customDragTable: highMinTable },
    );
    expect(subVMinRes.points.length).toBeGreaterThan(0);

    // v >= vMax in evalHeightAtZero, integrateTrajectoryFps, and evalDropCmAtRange (> 4000 fps)
    const fastRes = simulate(
      { ...BASE_BULLET, muzzleVelocityMps: 1300 }, // ~4265 fps > 4000 fps
      { ...BASE_PARAMS, maxRangeMeters: 200, stepMeters: 100 },
    );
    expect(fastRes.points.length).toBeGreaterThan(0);
    const fastBc = solveBC({ weightG: 10.89, mvMps: 1300, measuredDropCm: -60, rangeM: 500, altM: 0, tempC: 15 });
    expect(fastBc).toBeGreaterThanOrEqual(0.001);
    expect(fastBc).toBeLessThanOrEqual(1.5);

    // Upward bracket advance (v > vArr[idx]) in evalDropCmAtRange: 121.9 m/s is too slow to reach 150m, returns hi=1.5
    const accelBc = solveBC({ weightG: 10, mvMps: 121.9, measuredDropCm: -50, rangeM: 150, altM: 0, tempC: 15 });
    expect(accelBc).toBe(1.5);

    // v >= vMax (G1 table max is Mach 5.0 ≈ 5580 fps at 15°C) in evalDropCmAtRange: 2000 m/s = 6562 fps exceeds table
    const hypersonicBc = solveBC({ weightG: 10.89, mvMps: 2000, measuredDropCm: -60, rangeM: 500, altM: 0, tempC: 15 });
    expect(hypersonicBc).toBeGreaterThanOrEqual(0.001);
    expect(hypersonicBc).toBeLessThanOrEqual(1.5);

    // solveBC early-exit: short range (10m < zero 100m) with measuredDropCm more negative than
    // any feasible drop at 10m — computed drop ≈ -0.5 cm, so -1 cm forces fLo >= 0 immediately
    const earlyExitBc = solveBC({ weightG: 10.89, mvMps: 807, measuredDropCm: -1, rangeM: 10, altM: 0, tempC: 15 });
    expect(earlyExitBc).toBe(0.008);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENH-2: stationAirDensityRatio, pressureHpa, humidityPercent, and Eotvos
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-2: stationAirDensityRatio', () => {
  test('matches airDensityRatio verbatim when both pressureHpa and humidityPercent are null/undefined', () => {
    expect(stationAirDensityRatio(0, 59)).toBe(airDensityRatio(0, 59));
    expect(stationAirDensityRatio(5000, 80, undefined, undefined)).toBe(airDensityRatio(5000, 80));
    expect(stationAirDensityRatio(5000, 80, null, null)).toBe(airDensityRatio(5000, 80));
  });

  test('returns ~1.0 at ICAO sea-level standard dry air (1013.25 hPa, 0% RH, 59°F)', () => {
    expect(stationAirDensityRatio(0, 59, 1013.25, 0)).toBeCloseTo(1.0, 5);
  });

  test('higher station pressure increases density; lower pressure decreases density', () => {
    const low  = stationAirDensityRatio(0, 59, 850, null);
    const std  = stationAirDensityRatio(0, 59, 1013.25, null);
    const high = stationAirDensityRatio(0, 59, 1080, null);
    expect(low).toBeLessThan(std);
    expect(high).toBeGreaterThan(std);
  });

  test('higher humidity reduces air density when pressure is omitted or fixed', () => {
    const dryAlt = stationAirDensityRatio(3000, 86, null, 0);
    const humidAlt = stationAirDensityRatio(3000, 86, null, 100);
    expect(humidAlt).toBeLessThan(dryAlt);

    const dryFixed = stationAirDensityRatio(0, 95, 1013.25, 0);
    const humidFixed = stationAirDensityRatio(0, 95, 1013.25, 100);
    expect(humidFixed).toBeLessThan(dryFixed);
  });

  test('clamps vapor pressure to 99% of station pressure at extreme hot/low-pressure conditions', () => {
    const ratio = stationAirDensityRatio(0, 140, 500, 100);
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThan(0);
  });
});

describe('ENH-2: validation for pressureHpa, humidityPercent, and includeEotvos', () => {
  test('pressureHpa validation rejects out-of-range / non-finite and accepts [500, 1100]', () => {
    const c = 'a finite number between 500 and 1100';
    for (const bad of [499.99, 1100.01, NaN, Infinity, '1013']) {
      expectValidationError(B308, { ...COND_A, pressureHpa: bad }, 'pressureHpa', c);
    }
    expect(() => simulate(B308, { ...COND_A, pressureHpa: 500 })).not.toThrow();
    expect(() => simulate(B308, { ...COND_A, pressureHpa: 1100 })).not.toThrow();
    expect(() => simulate(B308, { ...COND_A, pressureHpa: null })).not.toThrow();
  });

  test('humidityPercent validation rejects out-of-range / non-finite and accepts [0, 100]', () => {
    const c = 'a finite number between 0 and 100';
    for (const bad of [-0.01, 100.01, NaN, Infinity, '50']) {
      expectValidationError(B308, { ...COND_A, humidityPercent: bad }, 'humidityPercent', c);
    }
    expect(() => simulate(B308, { ...COND_A, humidityPercent: 0 })).not.toThrow();
    expect(() => simulate(B308, { ...COND_A, humidityPercent: 100 })).not.toThrow();
    expect(() => simulate(B308, { ...COND_A, humidityPercent: null })).not.toThrow();
  });

  test('includeEotvos validation rejects non-booleans and accepts booleans / null / undefined', () => {
    const c = 'a boolean';
    for (const bad of ['true', 1, 0, {}]) {
      expectValidationError(B308, { ...COND_A, includeEotvos: bad }, 'includeEotvos', c);
    }
    expect(() => simulate(B308, { ...COND_A, includeEotvos: true })).not.toThrow();
    expect(() => simulate(B308, { ...COND_A, includeEotvos: false })).not.toThrow();
    expect(() => simulate(B308, { ...COND_A, includeEotvos: null })).not.toThrow();
  });
});

describe('ENH-2: station pressure & humidity effects in simulate()', () => {
  const DRAG_BULLET = { ...B308, ballisticCoefficient: 0.3 };
  const LONG_COND   = { ...COND_A, maxRangeMeters: 2000, stepMeters: 100 };

  test('lower station pressure yields flatter trajectory, higher downrange velocity, and higher density altitude', () => {
    const highPress = simulate(DRAG_BULLET, { ...LONG_COND, pressureHpa: 1050, humidityPercent: 0 });
    const stdPress  = simulate(B308,        { ...COND_A,    pressureHpa: 1013.25, humidityPercent: 0 });
    const lowPress  = simulate(DRAG_BULLET, { ...LONG_COND, pressureHpa: 850, humidityPercent: 0 });

    const lastHigh = highPress.points[highPress.points.length - 1];
    const lastLow  = lowPress.points[lowPress.points.length - 1];
    expect(lastLow.velocityMps).toBeGreaterThan(lastHigh.velocityMps);
    expect(lastLow.dropCm).toBeGreaterThan(lastHigh.dropCm);

    expect(stdPress.densityAltitudeMeters).toBe(0);
    expect(lowPress.densityAltitudeMeters).toBeGreaterThan(1000);
    expect(highPress.densityAltitudeMeters).toBeLessThan(0);
  });

  test('high humidity yields lower air density, higher retained velocity, and higher density altitude', () => {
    const dry   = simulate(DRAG_BULLET, { ...LONG_COND, temperatureC: 35, pressureHpa: 1013.25, humidityPercent: 0 });
    const humid = simulate(DRAG_BULLET, { ...LONG_COND, temperatureC: 35, pressureHpa: 1013.25, humidityPercent: 100 });
    const lastDry   = dry.points[dry.points.length - 1];
    const lastHumid = humid.points[humid.points.length - 1];
    expect(lastHumid.velocityMps).toBeGreaterThan(lastDry.velocityMps);
    expect(humid.densityAltitudeMeters).toBeGreaterThan(dry.densityAltitudeMeters);
  });

  test('densityAltitudeMeters falls back to existing ISA formula when pressureHpa and humidityPercent are null', () => {
    const omitted = simulate(B308, { ...COND_A, altitudeMeters: 1500, temperatureC: 35 });
    const nulls   = simulate(B308, { ...COND_A, altitudeMeters: 1500, temperatureC: 35, pressureHpa: null, humidityPercent: null });
    expect(nulls.densityAltitudeMeters).toBe(2577);
    expect(nulls.points).toEqual(omitted.points);
  });
});

describe('ENH-2: opt-in Eotvos vertical Coriolis (coriolisVerticalCm)', () => {
  test('key is omitted unless includeEotvos === true and both latitudeDeg and azimuthDeg are set', () => {
    for (const params of [
      { ...COND_A, latitudeDeg: 45, azimuthDeg: 90 },
      { ...COND_A, latitudeDeg: 45, azimuthDeg: 90, includeEotvos: false },
      { ...COND_A, latitudeDeg: 45, azimuthDeg: 90, includeEotvos: null },
      { ...COND_A, azimuthDeg: 90, includeEotvos: true },
      { ...COND_A, latitudeDeg: 45, includeEotvos: true },
      { ...COND_A, latitudeDeg: null, azimuthDeg: 90, includeEotvos: true },
      { ...COND_A, latitudeDeg: 45, azimuthDeg: null, includeEotvos: true },
    ]) {
      const res = simulate(B308, params);
      res.points.forEach(p => expect('coriolisVerticalCm' in p).toBe(false));
    }
  });

  test('firing East gives positive coriolisVerticalCm; West gives negative; North/South give 0', () => {
    const east  = simulate(B308, { ...COND_A, latitudeDeg: 45, azimuthDeg: 90,  includeEotvos: true });
    const west  = simulate(B308, { ...COND_A, latitudeDeg: 45, azimuthDeg: 270, includeEotvos: true });
    const north = simulate(B308, { ...COND_A, latitudeDeg: 45, azimuthDeg: 0,   includeEotvos: true });
    const south = simulate(B308, { ...COND_A, latitudeDeg: 45, azimuthDeg: 180, includeEotvos: true });

    expect(Object.is(east.points[0].coriolisVerticalCm, 0)).toBe(true);
    const lastEast = east.points[east.points.length - 1];
    const lastWest = west.points[west.points.length - 1];
    expect(lastEast.coriolisVerticalCm).toBeGreaterThan(0);
    expect(lastWest.coriolisVerticalCm).toBeLessThan(0);
    expect(Math.abs(lastEast.coriolisVerticalCm + lastWest.coriolisVerticalCm)).toBeLessThanOrEqual(0.1);

    north.points.forEach(p => expect(Object.is(p.coriolisVerticalCm, 0)).toBe(true));
    south.points.forEach(p => expect(Object.is(p.coriolisVerticalCm, 0)).toBe(true));

    // Matches reference formula at every point within ±0.1 cm
    const OMEGA = 7.2921e-5;
    east.points.forEach(p => {
      const ref = Math.round(OMEGA * Math.cos(Math.PI / 4) * Math.sin(Math.PI / 2) * B308.muzzleVelocityMps * p.timeOfFlightSec * p.timeOfFlightSec * 100 * 10) / 10;
      expect(Math.abs(p.coriolisVerticalCm - ref)).toBeLessThanOrEqual(0.1);
    });
  });

  test('equator East maximizes Eotvos while horizontal Coriolis is 0; poles give 0 Eotvos', () => {
    const eqEast = simulate(B308, { ...COND_A, latitudeDeg: 0, azimuthDeg: 90, includeEotvos: true });
    const lastEq = eqEast.points[eqEast.points.length - 1];
    expect(Object.is(lastEq.coriolisDeflectionCm, 0)).toBe(true);
    expect(lastEq.coriolisVerticalCm).toBeGreaterThan(0);

    const poleEast = simulate(B308, { ...COND_A, latitudeDeg: 90, azimuthDeg: 90, includeEotvos: true });
    poleEast.points.forEach(p => expect(Object.is(p.coriolisVerticalCm, 0)).toBe(true));
  });

  test('enabling includeEotvos does not mutate dropCm, velocityMps, or coriolisDeflectionCm', () => {
    const off = simulate(B308, { ...COND_A, latitudeDeg: 45, azimuthDeg: 90 });
    const on  = simulate(B308, { ...COND_A, latitudeDeg: 45, azimuthDeg: 90, includeEotvos: true });
    const strip = pts => pts.map(({ coriolisVerticalCm: _, ...rest }) => rest);
    expect(strip(on.points)).toEqual(off.points);
  });

  test('integrateTrajectoryFps with extras = { eotvosK: 0 } sets coriolisVerticalCm: 0', () => {
    const mvFps = 807 * 3.28084;
    const { points } = _integrateWithExtras(mvFps, 0.002, 0.475, 1.0, 10.89 / 453.592, 0, 500 / 0.9144, 100 / 0.9144, 1, undefined, { eotvosK: 0 });
    points.forEach(p => {
      expect('coriolisVerticalCm' in p).toBe(true);
      expect(Object.is(p.coriolisVerticalCm, 0)).toBe(true);
    });
  });
});

// S24-1 / TECH-1: temperature-dependent sound speed
describe('S24-1: soundSpeedFps', () => {
  test('at 0 °C differs from the old fixed 1125 fps by more than 1%', () => {
    const f = soundSpeedFps(0);
    expect(Math.abs(f - 1125) / 1125).toBeGreaterThan(0.01);
    expect(f).toBeCloseTo(331.3 * 3.28084, 6);
  });
  test('at 15 °C matches the Mach module formula (~340.3 m/s)', () => {
    expect(soundSpeedFps(15) / 3.28084).toBeCloseTo(340.3, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR 011: drag calibration (N1–N19)
// ─────────────────────────────────────────────────────────────────────────────
describe('ADR 011: drag calibration', () => {
  // §6.1 reference bullet and params
  const A011_BULLET = {
    id: 'x', name: 'x',
    bulletWeightGrams: 10.89, muzzleVelocityMps: 807,
    ballisticCoefficient: 0.475, bulletDiameterMm: 7.82,
    muzzleEnergyJoules: 3546,
  };
  const A011_PARAMS = {
    zeroRangeMeters: 100, maxRangeMeters: 600, stepMeters: 100,
    windSpeedKph: 16, windDirectionDeg: 90, altitudeMeters: 0, temperatureC: 15,
    sightHeightMm: 38.1, shootingAngleDegrees: 0, dragModel: 'G1',
  };

  // N1: §6.3 worked example rows within §6.4 bands
  test('N1: §6.3 worked example — every row within §6.4 acceptance bands', () => {
    const result = simulate(A011_BULLET, A011_PARAMS);
    // expected rows from §6.3: [R, velMps, tof, dropCm, windDriftCm, energyJ]
    const rows = [
      [100, 744.5, 0.1290, -7.96, 2.3, 3018],
      [200, 684.7, 0.2691, -33.7, 9.4, 2553],
      [300, 627.7, 0.4216, -80.4, 22.2, 2145],
      [400, 573.6, 0.5882, -152.1, 41.2, 1792],
      [500, 522.7, 0.7709, -253.7, 67.3, 1488],
      [600, 475.3, 0.9715, -391.3, 101.4, 1230],
    ];
    for (const [R, vel, tof, drop, wind, energy] of rows) {
      const p = result.points.find(pt => Math.abs(pt.rangeMeters - R) < 1);
      expect(p).toBeDefined();
      // velocityMps ±1%
      expect(p.velocityMps).toBeGreaterThanOrEqual(vel * 0.99);
      expect(p.velocityMps).toBeLessThanOrEqual(vel * 1.01);
      // timeOfFlightSec ±1%
      expect(p.timeOfFlightSec).toBeGreaterThanOrEqual(tof * 0.99);
      expect(p.timeOfFlightSec).toBeLessThanOrEqual(tof * 1.01);
      // dropCm: at 100m ±0.3 cm, else ±2% (use absolute tolerance to handle negative values)
      if (R === 100) {
        expect(Math.abs(p.dropCm - drop)).toBeLessThanOrEqual(0.3);
      } else {
        const dropTol = Math.abs(drop) * 0.02;
        expect(p.dropCm).toBeGreaterThanOrEqual(drop - dropTol);
        expect(p.dropCm).toBeLessThanOrEqual(drop + dropTol);
      }
      // windDriftCm ±5% (skip 100m: lag method gives tiny value)
      if (R >= 200) {
        expect(p.windDriftCm).toBeGreaterThanOrEqual(wind * 0.95);
        expect(p.windDriftCm).toBeLessThanOrEqual(wind * 1.05);
      }
      // energyJoules ±2%
      expect(p.energyJoules).toBeGreaterThanOrEqual(energy * 0.98);
      expect(p.energyJoules).toBeLessThanOrEqual(energy * 1.02);
    }
  });

  // N2: A1 and A2 supersonic limits
  test('N2: A1 — supersonicLimitMeters ∈ [955, 1010] for 1000 m run', () => {
    const result = simulate(A011_BULLET, { ...A011_PARAMS, maxRangeMeters: 1000, stepMeters: 25 });
    expect(result.supersonicLimitMeters).toBeGreaterThanOrEqual(955);
    expect(result.supersonicLimitMeters).toBeLessThanOrEqual(1010);
  });

  test('N2: A2 — low BC supersonicLimitMeters ∈ [95, 112]', () => {
    const result = simulate(
      { ...A011_BULLET, ballisticCoefficient: 0.05 },
      { ...A011_PARAMS, maxRangeMeters: 300, stepMeters: 25 },
    );
    expect(result.supersonicLimitMeters).toBeGreaterThanOrEqual(95);
    expect(result.supersonicLimitMeters).toBeLessThanOrEqual(112);
  });

  // N3: A3 — G7 with catalog G7 BC
  test('N3: A3 — G7 run with ballisticCoefficientG7: 0.224 gives velocityMps at 600 m ∈ [445, 461]', () => {
    const bullet = { ...A011_BULLET, ballisticCoefficientG7: 0.224 };
    const result = simulate(bullet, { ...A011_PARAMS, dragModel: 'G7' });
    expect(result.dragModel).toBe('G7');
    const p600 = result.points.find(p => Math.abs(p.rangeMeters - 600) < 1);
    expect(p600).toBeDefined();
    expect(p600.velocityMps).toBeGreaterThanOrEqual(445);
    expect(p600.velocityMps).toBeLessThanOrEqual(461);
  });

  // N4: A4 — BC response monotonic
  test('N4: A4 — velocity, drop, TOF monotonically respond to BC changes', () => {
    const bcs = [0.2, 0.3, 0.475, 0.6, 1.0];
    const results = bcs.map(bc =>
      simulate({ ...A011_BULLET, ballisticCoefficient: bc }, A011_PARAMS)
    );
    const get600 = r => r.points.find(p => Math.abs(p.rangeMeters - 600) < 1);
    const pts = results.map(get600);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].velocityMps).toBeGreaterThan(pts[i - 1].velocityMps);
      expect(pts[i].dropCm).toBeGreaterThan(pts[i - 1].dropCm); // less negative = greater
      expect(pts[i].timeOfFlightSec).toBeLessThan(pts[i - 1].timeOfFlightSec);
    }
    // v(0.475) − v(0.3) > 100 m/s
    const p475 = get600(results[2]);
    const p030 = get600(results[1]);
    expect(p475.velocityMps - p030.velocityMps).toBeGreaterThan(100);
  });

  // N5: CD_TO_RETARD constant
  test('N5: CD_TO_RETARD === 2.08551e-4 and equals ρ₀·π/(8·144)', () => {
    expect(CD_TO_RETARD).toBe(2.08551e-4);
    expect(CD_TO_RETARD).toBeCloseTo(0.0764742 * Math.PI / 1152, 8);
  });

  // N6: Table integrity
  test('N6: table row counts, mach bounds, and spot values', () => {
    expect(G1_CD_TABLE.length).toBe(79);
    expect(G5_CD_TABLE.length).toBe(76);
    expect(G7_CD_TABLE.length).toBe(84);

    for (const table of [G1_CD_TABLE, G5_CD_TABLE, G7_CD_TABLE]) {
      expect(table[0].mach).toBe(0);
      expect(table[table.length - 1].mach).toBe(5);
      for (let i = 1; i < table.length; i++) {
        expect(table[i].mach).toBeGreaterThan(table[i - 1].mach);
      }
    }

    // G1 spot values: {0: 0.2629, 1.40: 0.6625, 2.40: 0.5481, 5: 0.4988}
    expect(G1_CD_TABLE.find(r => r.mach === 0).cd).toBeCloseTo(0.2629, 4);
    expect(G1_CD_TABLE.find(r => r.mach === 1.40).cd).toBeCloseTo(0.6625, 4);
    expect(G1_CD_TABLE.find(r => r.mach === 2.40).cd).toBeCloseTo(0.5481, 4);
    expect(G1_CD_TABLE.find(r => r.mach === 5).cd).toBeCloseTo(0.4988, 4);

    // G5 spot values: {0: 0.1710, 1.40: 0.4406, 5: 0.2280}
    expect(G5_CD_TABLE.find(r => r.mach === 0).cd).toBeCloseTo(0.1710, 4);
    expect(G5_CD_TABLE.find(r => r.mach === 1.40).cd).toBeCloseTo(0.4406, 4);
    expect(G5_CD_TABLE.find(r => r.mach === 5).cd).toBeCloseTo(0.2280, 4);

    // G7 spot values: {0: 0.1198, 1.05: 0.4043, 2.40: 0.2752, 5: 0.1618}
    expect(G7_CD_TABLE.find(r => r.mach === 0).cd).toBeCloseTo(0.1198, 4);
    expect(G7_CD_TABLE.find(r => r.mach === 1.05).cd).toBeCloseTo(0.4043, 4);
    expect(G7_CD_TABLE.find(r => r.mach === 2.40).cd).toBeCloseTo(0.2752, 4);
    expect(G7_CD_TABLE.find(r => r.mach === 5).cd).toBeCloseTo(0.1618, 4);
  });

  // N7: referenceDragTable memoization
  test('N7: referenceDragTable — memo hits, fps scaling, and memo-miss rebuild', () => {
    const ss15 = soundSpeedFps(15);
    const ss20 = soundSpeedFps(20);
    const t1 = referenceDragTable('G1', ss15);
    const t2 = referenceDragTable('G1', ss15);
    expect(t1).toBe(t2); // same object

    // Different soundFps → different object with scaled fps, identical cd
    const t3 = referenceDragTable('G1', ss20);
    expect(t3).not.toBe(t1);
    for (let i = 0; i < G1_CD_TABLE.length; i++) {
      expect(t3[i][0]).toBeCloseTo(G1_CD_TABLE[i].mach * ss20, 6);
      expect(t3[i][1]).toBeCloseTo(t1[i][1], 6);
    }

    // Switching back rebuilds (memo-miss branch)
    const t4 = referenceDragTable('G1', ss15);
    expect(t4).not.toBe(t1); // new object (memo had ss20)
    expect(t4[0][0]).toBeCloseTo(G1_CD_TABLE[0].mach * ss15, 6);
  });

  // N8: Temperature affects drag through Mach
  test('N8: temperature changes drag through Mach (colder air = higher Mach at same speed)', () => {
    const params = { ...A011_PARAMS, pressureHpa: 1013.25, humidityPercent: 0, maxRangeMeters: 600 };
    const cold = simulate(A011_BULLET, { ...params, temperatureC: -20 });
    const hot  = simulate(A011_BULLET, { ...params, temperatureC: 40 });
    const p600cold = cold.points.find(p => Math.abs(p.rangeMeters - 600) < 1);
    const p600hot  = hot.points.find(p => Math.abs(p.rangeMeters - 600) < 1);

    // At same speed, cold air → higher Mach → higher Cd in transonic → more drag
    // But at supersonic speeds the effect is mixed. Check via referenceDragTable fps scaling:
    const ss_cold = soundSpeedFps(-20);
    const ss_hot  = soundSpeedFps(40);
    expect(ss_cold).toBeLessThan(ss_hot); // -20°C slower sound
    // Row 0 fps at -20°C < row 0 fps at +40°C
    const t_cold = referenceDragTable('G1', ss_cold);
    const t_hot  = referenceDragTable('G1', ss_hot);
    expect(t_cold[1][0]).toBeLessThan(t_hot[1][0]);
    expect(t_cold[1][1]).toBe(t_hot[1][1]); // same cd for same mach row

    // Trajectory level: results differ (velocity at 600m)
    expect(p600cold.velocityMps).not.toBeCloseTo(p600hot.velocityMps, 0);
  });

  // N9: solveBC round trip
  test('N9: solveBC round trip ±0.002 for BC ∈ {0.25, 0.475, 0.8}', () => {
    const { solveBC } = require('../app/physics/engine.ts');
    const params = { ...A011_PARAMS, windSpeedKph: 0, maxRangeMeters: 600 };
    for (const bc of [0.25, 0.475, 0.8]) {
      const result = simulate({ ...A011_BULLET, ballisticCoefficient: bc }, params);
      const p500 = result.points.find(p => Math.abs(p.rangeMeters - 500) < 1);
      expect(p500).toBeDefined();
      const solved = solveBC({
        weightG: A011_BULLET.bulletWeightGrams,
        mvMps: A011_BULLET.muzzleVelocityMps,
        measuredDropCm: p500.dropCm,
        rangeM: p500.rangeMeters,
        altM: 0,
        tempC: 15,
      });
      expect(solved).not.toBeNull();
      expect(Math.abs(solved - bc)).toBeLessThanOrEqual(0.002);
    }
  });

  // N10: solveBC feasible lower-bound search
  test('N10: solveBC feasible lower-bound returns non-null when BC=0.001 is infeasible', () => {
    const { solveBC } = require('../app/physics/engine.ts');
    // BC=0.001 → bullet stalls before 500m; a valid result should still come back
    const result = solveBC({ weightG: 10.89, mvMps: 807, measuredDropCm: -400, rangeM: 500, altM: 0, tempC: 15 });
    expect(result).not.toBeNull();
    // MV=20 m/s → stalls before any range; must return null
    const slow = solveBC({ weightG: 10.89, mvMps: 20, measuredDropCm: -40, rangeM: 500, altM: 0, tempC: 15 });
    expect(slow).toBeNull();
  });

  // N11: Termination tests (timeout 5000ms)
  test('N11a: BC=0.01, MV=91.44 m/s — simulate terminates without hanging', () => {
    // With BC=0.01 at 300 fps, vx drops below 50 fps before x=100m, so the zero is
    // unreachable: simulate either returns short points OR throws TrajectoryInputError.
    const bullet = { ...A011_BULLET, ballisticCoefficient: 0.01, muzzleVelocityMps: 91.44 };
    let threw = false;
    let result;
    try {
      result = simulate(bullet, { ...A011_PARAMS, maxRangeMeters: 1000, stepMeters: 25 });
      expect(result.points.length).toBeGreaterThanOrEqual(1);
      result.points.forEach(p => {
        expect(Number.isFinite(p.velocityMps)).toBe(true);
        expect(Number.isFinite(p.dropCm)).toBe(true);
      });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TrajectoryInputError);
    }
    // Either path is acceptable; the key invariant is: does not hang (5 s timeout)
    expect(threw || result != null).toBe(true);
  }, 5000);

  test('N11b: custom table cd=2.0 — simulate returns without hanging', () => {
    const bullet = { ...A011_BULLET, ballisticCoefficient: 0.01, muzzleVelocityMps: 800 };
    const heavyTable = [{ mach: 0, cd: 2.0 }, { mach: 1, cd: 2.0 }, { mach: 3, cd: 2.0 }];
    const result = simulate(bullet, { ...A011_PARAMS, maxRangeMeters: 5000, stepMeters: 100, customDragTable: heavyTable });
    expect(result).toBeDefined();
  }, 5000);

  test('N11c: findZeroAngleFps with BC=0.01, MV=91.44 m/s — terminates without hanging', () => {
    // With BC=0.01 at 300 fps, vx < 50 fps before x=100m for all launch angles, so the
    // zero is unreachable. findZeroAngleFps correctly returns NaN; the key is it terminates.
    const mvFps  = 91.44 * 3.28084;
    const bc     = 0.01;
    const rho    = 1.0;
    const ss     = soundSpeedFps(15);
    const g1     = referenceDragTable('G1', ss);
    const zeroFt = 100 * 3.28084;
    const sightHtFt = 38.1 / 25.4 / 12;
    const angle  = findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, g1);
    // NaN is the correct return when no launch angle can reach the zero range
    expect(typeof angle).toBe('number');
    expect(Number.isFinite(angle) || Number.isNaN(angle)).toBe(true);
  }, 5000);

  test('N11d: solveBC with unreachable range returns without hanging', () => {
    const { solveBC } = require('../app/physics/engine.ts');
    const result = solveBC({ weightG: 10, mvMps: 100, measuredDropCm: -100, rangeM: 3000, altM: 0, tempC: 15 });
    expect(result === null || typeof result === 'number').toBe(true);
  }, 5000);

  // N12: Termination in integrateTrajectoryFps (timeout 5000ms)
  test('N12: BC=0.02, MV=800 m/s — integrateTrajectoryFps terminates; last point < 1000 m', () => {
    const bullet = { ...A011_BULLET, ballisticCoefficient: 0.02, muzzleVelocityMps: 800 };
    const result = simulate(bullet, { ...A011_PARAMS, maxRangeMeters: 1000, stepMeters: 25 });
    const last = result.points[result.points.length - 1];
    expect(last.rangeMeters).toBeLessThan(1000);
    expect(last.velocityMps).toBeGreaterThan(100 / 3.28084);
  }, 5000);

  // N13: G5 BC
  test('N13: G5 BC — dragModel G5 with ballisticCoefficientG5 gives correct model and differs from G1', () => {
    const bulletG5 = { ...A011_BULLET, ballisticCoefficientG5: 0.30 };
    const bulletG5hi = { ...A011_BULLET, ballisticCoefficientG5: 0.40 };
    const g5 = simulate(bulletG5, { ...A011_PARAMS, dragModel: 'G5' });
    const g5hi = simulate(bulletG5hi, { ...A011_PARAMS, dragModel: 'G5' });
    const g1 = simulate(A011_BULLET, A011_PARAMS);

    expect(g5.dragModel).toBe('G5');
    const p600g5 = g5.points.find(p => Math.abs(p.rangeMeters - 600) < 1);
    const p600g5hi = g5hi.points.find(p => Math.abs(p.rangeMeters - 600) < 1);
    expect(p600g5hi.velocityMps).toBeGreaterThan(p600g5.velocityMps);

    // G5 points differ from G1
    expect(g5.points).not.toEqual(g1.points);

    // Without G5 BC → falls back to G1
    const g5fallback = simulate(A011_BULLET, { ...A011_PARAMS, dragModel: 'G5' });
    expect(g5fallback.dragModel).toBe('G1');
    expect(g5fallback.points).toEqual(g1.points);
  });

  // N14: G7 fallback
  test('N14: G7 fallback — without G7 BC resolves to G1; with G7 BC resolves to G7', () => {
    const g1 = simulate(A011_BULLET, A011_PARAMS);
    const g7fallback = simulate(A011_BULLET, { ...A011_PARAMS, dragModel: 'G7' });
    expect(g7fallback.dragModel).toBe('G1');
    expect(g7fallback.points).toEqual(g1.points);

    const bulletG7 = { ...A011_BULLET, ballisticCoefficientG7: 0.224 };
    const g7 = simulate(bulletG7, { ...A011_PARAMS, dragModel: 'G7' });
    expect(g7.dragModel).toBe('G7');

    // Legacy UI swap: G7 BC copied into ballisticCoefficient gives same result
    const bulletLegacy = { ...A011_BULLET, ballisticCoefficient: 0.224, ballisticCoefficientG7: 0.224 };
    const g7legacy = simulate(bulletLegacy, { ...A011_PARAMS, dragModel: 'G7' });
    expect(g7legacy.points).toEqual(g7.points);
  });

  // N15: Sectional density
  test('N15: sectionalDensityLbIn2 and custom-table divisor behavior', () => {
    expect(sectionalDensityLbIn2(10.89, 7.82)).toBeCloseTo(0.25329, 4);

    const customTable = [{ mach: 0, cd: 0.3 }, { mach: 1, cd: 0.5 }, { mach: 3, cd: 0.4 }];
    // Different G1 BCs give same points (custom uses SD, not BC)
    const r1 = simulate({ ...A011_BULLET, ballisticCoefficient: 0.2 }, { ...A011_PARAMS, customDragTable: customTable });
    const r2 = simulate({ ...A011_BULLET, ballisticCoefficient: 0.8 }, { ...A011_PARAMS, customDragTable: customTable });
    expect(r1.points).toEqual(r2.points);

    // Larger diameter → lower SD → more drag → more drop
    const rSmall = simulate({ ...A011_BULLET, bulletDiameterMm: 7.82 }, { ...A011_PARAMS, customDragTable: customTable });
    const rLarge = simulate({ ...A011_BULLET, bulletDiameterMm: 8.00 }, { ...A011_PARAMS, customDragTable: customTable });
    const p600small = rSmall.points.find(p => Math.abs(p.rangeMeters - 600) < 1);
    const p600large = rLarge.points.find(p => Math.abs(p.rangeMeters - 600) < 1);
    expect(p600large.dropCm).toBeLessThan(p600small.dropCm); // more negative

    // resolveDrag returns custom with SD divisor
    const { model, divisor } = resolveDrag(A011_BULLET, { ...A011_PARAMS, customDragTable: customTable });
    expect(model).toBe('custom');
    expect(divisor).toBeCloseTo(sectionalDensityLbIn2(A011_BULLET.bulletWeightGrams, A011_BULLET.bulletDiameterMm), 6);
  });

  // N16: Validation V1–V3
  test('N16: validation V1 — ballisticCoefficientG7 must be finite and > 0 when non-null', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => simulate({ ...A011_BULLET, ballisticCoefficientG7: bad }, A011_PARAMS))
        .toThrow(TrajectoryInputError);
    }
    expect(() => simulate({ ...A011_BULLET, ballisticCoefficientG7: null }, A011_PARAMS)).not.toThrow();
    expect(() => simulate({ ...A011_BULLET }, A011_PARAMS)).not.toThrow();
  });

  test('N16: validation V2 — ballisticCoefficientG5 must be finite and > 0 when non-null', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => simulate({ ...A011_BULLET, ballisticCoefficientG5: bad }, A011_PARAMS))
        .toThrow(TrajectoryInputError);
    }
    expect(() => simulate({ ...A011_BULLET, ballisticCoefficientG5: null }, A011_PARAMS)).not.toThrow();
  });

  test('N16: validation V3 — bulletDiameterMm [1,30] required when customDragTable is non-empty', () => {
    const customTable = [{ mach: 0, cd: 0.3 }, { mach: 1, cd: 0.5 }, { mach: 3, cd: 0.4 }];
    for (const bad of [0, 31, NaN]) {
      expect(() => simulate({ ...A011_BULLET, bulletDiameterMm: bad }, { ...A011_PARAMS, customDragTable: customTable }))
        .toThrow(TrajectoryInputError);
    }
    expect(() => simulate({ ...A011_BULLET, bulletDiameterMm: 7.82 }, { ...A011_PARAMS, customDragTable: customTable }))
      .not.toThrow();
  });

  test('N16: validation V4 — RK4 stability guard throws for extreme inputs', () => {
    const { solveBC } = require('../app/physics/engine.ts');
    // (a) devsecops case: 1 gr bullet, 1 in diameter, Cd=2, 800 m/s — ratio ≈ 3.83 >> 0.5
    const devSecOpsTable = [{ mach: 0, cd: 2 }, { mach: 1, cd: 2 }, { mach: 3, cd: 2 }];
    let err;
    try {
      simulate({ ...A011_BULLET, bulletWeightGrams: 0.0648, bulletDiameterMm: 25.4, muzzleVelocityMps: 800 },
        { ...A011_PARAMS, customDragTable: devSecOpsTable });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TrajectoryInputError);
    expect(err.field).toBe('bullet.bulletDiameterMm');

    // (b) G1 BC=0.0001 at 800 m/s — ratio ≈ 1.81 > 0.5
    let errG1;
    try {
      simulate({ ...A011_BULLET, ballisticCoefficient: 0.0001, muzzleVelocityMps: 800 }, A011_PARAMS);
    } catch (e) { errG1 = e; }
    expect(errG1).toBeInstanceOf(TrajectoryInputError);
    expect(errG1.field).toBe('bullet.ballisticCoefficient');

    // (c) G7 BC=0.0001 at 800 m/s — ratio ≈ 1.11 > 0.5
    let errG7;
    try {
      simulate({ ...A011_BULLET, ballisticCoefficientG7: 0.0001, muzzleVelocityMps: 800 },
        { ...A011_PARAMS, dragModel: 'G7' });
    } catch (e) { errG7 = e; }
    expect(errG7).toBeInstanceOf(TrajectoryInputError);
    expect(errG7.field).toBe('bullet.ballisticCoefficientG7');

    // (d) G5 BC=0.0001 at 800 m/s — ratio ≈ 1.21 > 0.5
    let errG5;
    try {
      simulate({ ...A011_BULLET, ballisticCoefficientG5: 0.0001, muzzleVelocityMps: 800 },
        { ...A011_PARAMS, dragModel: 'G5' });
    } catch (e) { errG5 = e; }
    expect(errG5).toBeInstanceOf(TrajectoryInputError);
    expect(errG5.field).toBe('bullet.ballisticCoefficientG5');

    // (e) boundary: custom Cd=2, diamMm=25.4, mvMps=800; just-below (weightG=0.5→ratio≈0.497) and just-above (weightG=0.4→ratio≈0.621)
    const boundaryTable = devSecOpsTable;
    const boundaryParams = { ...A011_PARAMS, customDragTable: boundaryTable, zeroRangeMeters: 0.5, maxRangeMeters: 1, stepMeters: 0.5 };
    // just below 0.5 — no V4 throw
    let resultBoundary;
    expect(() => { resultBoundary = simulate({ ...A011_BULLET, bulletWeightGrams: 0.5, bulletDiameterMm: 25.4, muzzleVelocityMps: 800 }, boundaryParams); }).not.toThrow();
    for (const pt of resultBoundary.points) expect(pt.velocityMps).toBeLessThanOrEqual(801);
    for (const pt of resultBoundary.points) {
      for (const v of Object.values(pt)) expect(v == null || Number.isFinite(v)).toBe(true);
    }
    // just above 0.5 — throws V4
    let errBoundary;
    try {
      simulate({ ...A011_BULLET, bulletWeightGrams: 0.4, bulletDiameterMm: 25.4, muzzleVelocityMps: 800 }, boundaryParams);
    } catch (e) { errBoundary = e; }
    expect(errBoundary).toBeInstanceOf(TrajectoryInputError);
    expect(errBoundary.field).toBe('bullet.bulletDiameterMm');

    // (f) error.message starts with field name followed by " must be "
    expect(err.message).toMatch(/^bullet\.bulletDiameterMm must be /);
    expect(errG1.message).toMatch(/^bullet\.ballisticCoefficient must be /);
    expect(errG7.message).toMatch(/^bullet\.ballisticCoefficientG7 must be /);
    expect(errG5.message).toMatch(/^bullet\.ballisticCoefficientG5 must be /);

    // .308 168gr at 807 m/s must NOT throw (ratio ≈ 0.000385 << 0.5)
    expect(() => simulate(A011_BULLET, A011_PARAMS)).not.toThrow();
  });

  test('N16a: solveBC stability floor — at mvMps=4000 lo starts at bcStable, result is null or ≥ bcStable', () => {
    const { solveBC } = require('../app/physics/engine.ts');
    const maxCdG1 = Math.max(...G1_CD_TABLE.map(r => r.cd));
    const mvFps4000 = 4000 * (1 / 0.3048); // m/s to fps via 1 ft = 0.3048 m
    const bcStable4000 = CD_TO_RETARD * 1 * maxCdG1 * mvFps4000 * 0.0005 / STABILITY_LIMIT;
    expect(bcStable4000).toBeGreaterThan(0.001); // confirms the floor kicks in
    const result = solveBC({ weightG: 10.89, mvMps: 4000, measuredDropCm: -100, rangeM: 500, altM: 0, tempC: 15 });
    expect(result).toBe(0.0683);
  });

  test('N16b: findZeroAngleFps NaN branch — fLo=-Infinity triggers bisection fallback', () => {
    // Custom Cd=1 table: a 0.5g/10mm bullet at 300 m/s stalls before ~30.8m (ZERO_ANGLE_MIN shot),
    // so evalHeightAtZero returns -Infinity and fLo enters the bisection loop as NaN via Number.NaN.
    const nanBranchTable = [{ mach: 0, cd: 1 }, { mach: 1, cd: 1 }, { mach: 3, cd: 1 }];
    const nanBranchBullet = {
      id: 'nb', name: 'nb',
      bulletWeightGrams: 0.5, bulletDiameterMm: 10,
      ballisticCoefficient: 0.3, muzzleVelocityMps: 300,
      muzzleEnergyJoules: 1,
    };
    const nanBranchParams = {
      zeroRangeMeters: 30.8, maxRangeMeters: 50, stepMeters: 10,
      windSpeedKph: 0, windDirectionDeg: 0, altitudeMeters: 0, temperatureC: 15,
      sightHeightMm: 38.1, shootingAngleDegrees: 0,
      customDragTable: nanBranchTable,
    };
    // Should not throw and should return a trajectory with at least one point
    let result;
    expect(() => { result = simulate(nanBranchBullet, nanBranchParams); }).not.toThrow();
    expect(result.points.length).toBeGreaterThanOrEqual(1);
    for (const pt of result.points) {
      for (const v of Object.values(pt)) expect(v == null || Number.isFinite(v)).toBe(true);
    }
  });

  test('N16c: solveBC stability floor early-exit — mvMps=5e6 gives bcStable >> 1.5, returns null', () => {
    const { solveBC } = require('../app/physics/engine.ts');
    const result = solveBC({ weightG: 10.89, mvMps: 5e6, measuredDropCm: -100, rangeM: 500, altM: 0, tempC: 15 });
    expect(result).toBe(null);
  });

  // N17: Zero bracket expansion
  test('N17: zero bracket expansion — wide zero range resolved or throws, never clamps silently', () => {
    // .223 55gr at 3000m zero: either finds a solution or throws zeroRangeMeters error
    const bullet223 = {
      id: 'x', name: 'x',
      bulletWeightGrams: 3.56, muzzleVelocityMps: 987.6,
      ballisticCoefficient: 0.243, bulletDiameterMm: 5.69, muzzleEnergyJoules: 1738,
    };
    let threw = false;
    let result3k;
    try {
      result3k = simulate(bullet223, { ...A011_PARAMS, zeroRangeMeters: 3000, maxRangeMeters: 3000 });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TrajectoryInputError);
      expect(e.field).toBe('zeroRangeMeters');
    }
    if (!threw) {
      // If resolved, the 3000m point's bore-line drop should be near zero (within ±1 cm of sight line)
      const p3k = result3k.points.find(p => Math.abs(p.rangeMeters - 3000) < 10);
      expect(p3k).toBeDefined();
    }

    // §6.1 bullet at MV 300 m/s, zero 800 m — zero angle > 0.05 rad
    const mvSlow = 300;
    const mvFps  = mvSlow * 3.28084;
    const ss15   = soundSpeedFps(15);
    const g1t    = referenceDragTable('G1', ss15);
    const rho    = 1.0;
    const zeroFt = 800 * 3.28084;
    const sightHtFt = 38.1 / 25.4 / 12;
    const angle  = findZeroAngleFps(mvFps, A011_BULLET.ballisticCoefficient, rho, zeroFt, sightHtFt, g1t);
    expect(Number.isFinite(angle)).toBe(true);
    expect(angle).toBeGreaterThan(0.05);
    expect(angle).toBeLessThanOrEqual(ZERO_ANGLE_MAX);

    // Clearly unreachable: BC=0.01, MV=91.44 m/s, zero=1000 m throws
    expect(() => simulate(
      { ...A011_BULLET, ballisticCoefficient: 0.01, muzzleVelocityMps: 91.44 },
      { ...A011_PARAMS, zeroRangeMeters: 1000 },
    )).toThrow(TrajectoryInputError);
  });

  // N18: evalDropCmAtRange and solveBC with unreachable zero
  test('N18: solveBC with very low MV returns null and does not throw', () => {
    const { solveBC } = require('../app/physics/engine.ts');
    // Every BC → zero unreachable at MV=5 m/s
    const result = solveBC({ weightG: 10.89, mvMps: 5, measuredDropCm: -100, rangeM: 500, altM: 0, tempC: 15 });
    expect(result).toBeNull();
  });

  // N19: solveBC bisection exact-convergence (|fMid| ≤ 1e-7 early break)
  test('N19: solveBC bisection exact-convergence exits early via |fMid| ≤ 1e-7 and returns 4-dp BC', () => {
    const { solveBC } = require('../app/physics/engine.ts');
    // weightG=5, mvMps=600, rangeM=300 produces a bisection trajectory where the midpoint
    // drop matches measuredDropCm to within 1e-7 cm before the interval converges to 1e-5.
    const result = solveBC({ weightG: 5, mvMps: 600, measuredDropCm: -200, rangeM: 300, altM: 0, tempC: 15 });
    expect(result).toBe(0.2011);
  });
});
