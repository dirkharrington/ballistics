'use strict';

const {
  simulate,
  TrajectoryInputError,
  interpolateDragTable,
  airDensityRatio,
  findZeroAngleFps,
  integrateTrajectoryFps,
} = require('../app/physics/engine.ts');
const { G1_TABLE, G7_TABLE } = require('./__mocks__/physics-tables.js');

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
// interpolateDragTable — equivalence against verbatim linear scan (PERF-8)
// ─────────────────────────────────────────────────────────────────────────────
describe('interpolateDragTable equivalence (binary search vs linear scan)', () => {
  // Verbatim copy of the pre-PERF-8 linear scan; must NOT be modified.
  function linearScan(v, table) {
    v = Math.abs(v);
    if (v <= table[0][0]) return table[0][1];
    if (v >= table[table.length - 1][0]) return table[table.length - 1][1];
    for (let i = 1; i < table.length; i++) {
      if (v <= table[i][0]) {
        const t = (v - table[i - 1][0]) / (table[i][0] - table[i - 1][0]);
        return table[i - 1][1] + t * (table[i][1] - table[i - 1][1]);
      }
    }
    return Number.NaN;
  }

  // Mulberry32 seeded PRNG — deterministic, good distribution.
  function makePrng(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function agree(v, table) {
    const bs = interpolateDragTable(v, table);
    const ls = linearScan(v, table);
    if (!Object.is(bs, ls)) {
      throw new Error(
        `v=${v}: binarySearch=${bs} !== linearScan=${ls}`
      );
    }
  }

  test('G1_TABLE is strictly ascending', () => {
    for (let i = 1; i < G1_TABLE.length; i++) {
      expect(G1_TABLE[i][0]).toBeGreaterThan(G1_TABLE[i - 1][0]);
    }
  });

  test('G7_TABLE is strictly ascending', () => {
    for (let i = 1; i < G7_TABLE.length; i++) {
      expect(G7_TABLE[i][0]).toBeGreaterThan(G7_TABLE[i - 1][0]);
    }
  });

  test('agrees on breakpoints, ±ε, midpoints for G1_TABLE', () => {
    const eps = Number.EPSILON;
    for (const table of [G1_TABLE, G7_TABLE]) {
      for (let i = 0; i < table.length; i++) {
        const v = table[i][0];
        agree(v, table);
        agree(v + eps * v, table);
        agree(v - eps * v, table);
        if (i + 1 < table.length) {
          agree((v + table[i + 1][0]) / 2, table);
        }
      }
    }
  });

  test('agrees on signed zeros, ±Infinity, NaN', () => {
    for (const table of [G1_TABLE, G7_TABLE]) {
      agree(0, table);
      agree(-0, table);
      agree(Infinity, table);
      agree(-Infinity, table);
      agree(NaN, table);
    }
  });

  test('agrees on 10 000 seeded-PRNG samples across G1 and G7 velocity ranges', () => {
    const rng = makePrng(0xdeadbeef);
    const minV = G1_TABLE[0][0];
    const maxV = G1_TABLE[G1_TABLE.length - 1][0];
    for (let i = 0; i < 10000; i++) {
      // Sample broadly: include sub-min and super-max values via range * 1.1 offset
      const v = (rng() * (maxV - minV) * 1.1 + minV * 0.95) * (rng() < 0.5 ? 1 : -1);
      agree(v, G1_TABLE);
      agree(v, G7_TABLE);
    }
  });

  test('agrees on 2-row edge table', () => {
    const tiny = [[100, 0.1], [200, 0.2]];
    agree(50, tiny);
    agree(100, tiny);
    agree(150, tiny);
    agree(200, tiny);
    agree(300, tiny);
    agree(NaN, tiny);
  });

  test('agrees on 3-row edge table', () => {
    const tri = [[100, 0.1], [200, 0.3], [300, 0.2]];
    agree(50, tri);
    agree(100, tri);
    agree(150, tri);
    agree(200, tri);
    agree(250, tri);
    agree(300, tri);
    agree(400, tri);
    agree(NaN, tri);
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

  test('.308 at ~500m: spinDriftCm = 3.8 ± 0.1 (SG=1.7125)', () => {
    const result = simulate(B308, params308);
    const p500 = result.points.find(p => p.rangeMeters >= 490 && p.rangeMeters <= 510);
    expect(p500).toBeDefined();
    expect(p500.spinDriftCm).toBeGreaterThanOrEqual(3.7);
    expect(p500.spinDriftCm).toBeLessThanOrEqual(3.9);
  });

  test('.308 at ~1000m: spinDriftCm = 13.7 ± 0.1 (SG=1.7125)', () => {
    const result = simulate(B308, params308);
    const p1000 = result.points.find(p => p.rangeMeters >= 990 && p.rangeMeters <= 1010);
    expect(p1000).toBeDefined();
    expect(p1000.spinDriftCm).toBeGreaterThanOrEqual(13.6);
    expect(p1000.spinDriftCm).toBeLessThanOrEqual(13.8);
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
