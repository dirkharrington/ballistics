import { POINT_STRIDE, packPoints, unpackPoints } from '../../app/physics/packed-points.ts';
import { simulate } from '../../app/physics/engine.ts';
import type { TrajectoryPoint } from '../../app/physics/types.ts';
import golden from '../fixtures/spa1-golden.json';

describe('PERF-29: packed-points (Float64Array Transferable packing)', () => {
  test('POINT_STRIDE equals 9', () => {
    expect(POINT_STRIDE).toBe(9);
  });

  test('round-trips empty points array cleanly', () => {
    const { buffer, hasCoriolis, hasEotvos } = packPoints([]);
    expect(buffer).toBeInstanceOf(Float64Array);
    expect(buffer.length).toBe(0);
    expect(hasCoriolis).toBe(false);
    expect(hasEotvos).toBe(false);
    expect(unpackPoints(buffer, hasCoriolis, hasEotvos)).toEqual([]);
  });

  test('packs and unpacks standard points without coriolisDeflectionCm or coriolisVerticalCm keys', () => {
    const points: TrajectoryPoint[] = [
      {
        rangeMeters: 0,
        dropCm: 0,
        velocityMps: 807,
        energyJoules: 3546.1,
        windDriftCm: 0,
        timeOfFlightSec: 0,
        spinDriftCm: 0,
      },
      {
        rangeMeters: 500.3,
        dropCm: -188.6,
        velocityMps: 520.4,
        energyJoules: 1474.8,
        windDriftCm: 21.4,
        timeOfFlightSec: 0.62,
        spinDriftCm: 3.9,
      },
    ];

    const { buffer, hasCoriolis, hasEotvos } = packPoints(points);
    expect(hasCoriolis).toBe(false);
    expect(hasEotvos).toBe(false);
    expect(buffer.length).toBe(points.length * POINT_STRIDE);

    // Verify exact slot layout for point 1
    expect(buffer[POINT_STRIDE + 0]).toBe(500.3);
    expect(buffer[POINT_STRIDE + 1]).toBe(-188.6);
    expect(buffer[POINT_STRIDE + 2]).toBe(520.4);
    expect(buffer[POINT_STRIDE + 3]).toBe(1474.8);
    expect(buffer[POINT_STRIDE + 4]).toBe(21.4);
    expect(buffer[POINT_STRIDE + 5]).toBe(0.62);
    expect(buffer[POINT_STRIDE + 6]).toBe(3.9);
    expect(Number.isNaN(buffer[7])).toBe(true);
    expect(Number.isNaN(buffer[8])).toBe(true);
    expect(Number.isNaN(buffer[POINT_STRIDE + 7])).toBe(true);
    expect(Number.isNaN(buffer[POINT_STRIDE + 8])).toBe(true);

    const unpacked = unpackPoints(buffer, hasCoriolis);
    expect(unpacked).toEqual(points);
    for (const pt of unpacked) {
      expect('coriolisDeflectionCm' in pt).toBe(false);
      expect('coriolisVerticalCm' in pt).toBe(false);
    }
  });

  test('packs and unpacks Coriolis points including zero and negative deflections', () => {
    const points: TrajectoryPoint[] = [
      {
        rangeMeters: 0,
        dropCm: 0,
        velocityMps: 807,
        energyJoules: 3546.1,
        windDriftCm: 0,
        timeOfFlightSec: 0,
        spinDriftCm: 0,
        coriolisDeflectionCm: 0,
      },
      {
        rangeMeters: 1000.2,
        dropCm: -753.6,
        velocityMps: 380.2,
        energyJoules: 787.1,
        windDriftCm: 95.3,
        timeOfFlightSec: 1.2395,
        spinDriftCm: 13.7,
        coriolisDeflectionCm: -4.9,
      },
    ];

    const { buffer, hasCoriolis } = packPoints(points);
    expect(hasCoriolis).toBe(true);
    expect(buffer[7]).toBe(0);
    expect(buffer[POINT_STRIDE + 7]).toBe(-4.9);

    const unpacked = unpackPoints(buffer, hasCoriolis);
    expect(unpacked).toEqual(points);
    expect(Object.is(unpacked[0]!.coriolisDeflectionCm, 0)).toBe(true);
    expect(unpacked[1]!.coriolisDeflectionCm).toBe(-4.9);
  });

  test('handles mixed points, NaN Coriolis slots, undefined Coriolis, and !hasCoriolis override', () => {
    const mixed: TrajectoryPoint[] = [
      {
        rangeMeters: 0,
        dropCm: 0,
        velocityMps: 800,
        energyJoules: 3000,
        windDriftCm: 0,
        timeOfFlightSec: 0,
        spinDriftCm: 0,
      },
      {
        rangeMeters: 100,
        dropCm: -5,
        velocityMps: 750,
        energyJoules: 2600,
        windDriftCm: 1.2,
        timeOfFlightSec: 0.13,
        spinDriftCm: 0.2,
        coriolisDeflectionCm: 0.4,
      },
      {
        rangeMeters: 200,
        dropCm: -20,
        velocityMps: 700,
        energyJoules: 2300,
        windDriftCm: 4.5,
        timeOfFlightSec: 0.27,
        spinDriftCm: 0.7,
        coriolisDeflectionCm: Number.NaN,
      },
    ];

    const { buffer, hasCoriolis } = packPoints(mixed);
    expect(hasCoriolis).toBe(true);
    expect(Number.isNaN(buffer[7])).toBe(true);
    expect(buffer[POINT_STRIDE + 7]).toBe(0.4);
    expect(Number.isNaN(buffer[2 * POINT_STRIDE + 7])).toBe(true);

    const unpacked = unpackPoints(buffer, hasCoriolis);
    expect('coriolisDeflectionCm' in unpacked[0]!).toBe(false);
    expect(unpacked[1]!.coriolisDeflectionCm).toBe(0.4);
    expect('coriolisDeflectionCm' in unpacked[2]!).toBe(false);

    // If all points have NaN coriolisDeflectionCm, hasCoriolis stays false
    const allNaN = packPoints([{ ...mixed[2]! }]);
    expect(allNaN.hasCoriolis).toBe(false);
    const unpackedAllNaN = unpackPoints(allNaN.buffer, allNaN.hasCoriolis);
    expect('coriolisDeflectionCm' in unpackedAllNaN[0]!).toBe(false);

    // If hasCoriolis is false even when slot 7 has a finite value, key is omitted
    const unpackedForcedNoCor = unpackPoints(buffer, false);
    expect('coriolisDeflectionCm' in unpackedForcedNoCor[1]!).toBe(false);
  });

  test('preserves +0 and -0 IEEE-754 bits identically', () => {
    const pts: TrajectoryPoint[] = [
      {
        rangeMeters: 0,
        dropCm: -0,
        velocityMps: 800,
        energyJoules: 3000,
        windDriftCm: 0,
        timeOfFlightSec: 0,
        spinDriftCm: 0,
      },
    ];
    const { buffer, hasCoriolis } = packPoints(pts);
    const unpacked = unpackPoints(buffer, hasCoriolis);
    expect(Object.is(unpacked[0]!.dropCm, -0)).toBe(true);
    expect(Object.is(unpacked[0]!.windDriftCm, 0)).toBe(true);
  });

  test('round-trips every case in tests/fixtures/spa1-golden.json bit- and key-identically', () => {
    for (const { bullet, params, expected } of golden.cases as any[]) {
      const result = simulate(bullet, params);
      const { buffer, hasCoriolis, hasEotvos } = packPoints(result.points);
      expect(hasEotvos).toBe(false);
      const unpacked = unpackPoints(buffer, hasCoriolis, hasEotvos);

      expect(unpacked).toEqual(result.points);
      expect(unpacked).toEqual(expected.points);
      for (let i = 0; i < unpacked.length; i++) {
        expect(Object.keys(unpacked[i]!)).toEqual(Object.keys(result.points[i]!));
      }
    }
  });

  test('ENH-2: packs and unpacks coriolisVerticalCm (slot 8) including mixed, non-finite, and !hasEotvos override', () => {
    const pts: TrajectoryPoint[] = [
      {
        rangeMeters: 0,
        dropCm: 0,
        velocityMps: 807,
        energyJoules: 3546.1,
        windDriftCm: 0,
        timeOfFlightSec: 0,
        spinDriftCm: 0,
        coriolisDeflectionCm: 0,
        coriolisVerticalCm: 0,
      },
      {
        rangeMeters: 500,
        dropCm: -188.6,
        velocityMps: 520.4,
        energyJoules: 1474.8,
        windDriftCm: 21.4,
        timeOfFlightSec: 0.62,
        spinDriftCm: 3.9,
        coriolisDeflectionCm: 1.6,
        coriolisVerticalCm: -2.3,
      },
      {
        rangeMeters: 600,
        dropCm: -260,
        velocityMps: 490,
        energyJoules: 1300,
        windDriftCm: 30,
        timeOfFlightSec: 0.78,
        spinDriftCm: 5.0,
        coriolisVerticalCm: Number.NaN,
      },
      {
        rangeMeters: 700,
        dropCm: -350,
        velocityMps: 460,
        energyJoules: 1150,
        windDriftCm: 40,
        timeOfFlightSec: 0.95,
        spinDriftCm: 6.2,
      },
    ];

    const { buffer, hasCoriolis, hasEotvos } = packPoints(pts);
    expect(hasCoriolis).toBe(true);
    expect(hasEotvos).toBe(true);
    expect(buffer[8]).toBe(0);
    expect(buffer[POINT_STRIDE + 8]).toBe(-2.3);
    expect(Number.isNaN(buffer[2 * POINT_STRIDE + 8])).toBe(true);
    expect(Number.isNaN(buffer[3 * POINT_STRIDE + 8])).toBe(true);

    const unpacked = unpackPoints(buffer, hasCoriolis, hasEotvos);
    expect(Object.is(unpacked[0]!.coriolisVerticalCm, 0)).toBe(true);
    expect(unpacked[1]!.coriolisVerticalCm).toBe(-2.3);
    expect('coriolisVerticalCm' in unpacked[2]!).toBe(false);
    expect('coriolisVerticalCm' in unpacked[3]!).toBe(false);

    // Non-finite values (NaN, Infinity) do not set hasEotvos
    const onlyInf = packPoints([{ ...pts[1]!, coriolisVerticalCm: Number.POSITIVE_INFINITY }]);
    expect(onlyInf.hasEotvos).toBe(false);
    expect('coriolisVerticalCm' in unpackPoints(onlyInf.buffer, onlyInf.hasCoriolis, onlyInf.hasEotvos)[0]!).toBe(false);

    // !hasEotvos suppresses key even when slot 8 is finite
    const forcedOff = unpackPoints(buffer, hasCoriolis, false);
    expect('coriolisVerticalCm' in forcedOff[1]!).toBe(false);
  });
});
