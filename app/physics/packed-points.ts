import type { TrajectoryPoint } from './types.ts';

/** Number of Float64 elements per packed TrajectoryPoint. */
export const POINT_STRIDE = 9;

/**
 * Packs TrajectoryPoint objects into a flat Float64Array for zero-copy
 * Transferable postMessage between physics worker and main thread (PERF-29).
 *
 * Layout per point (stride = 9):
 *   [rangeMeters, dropCm, velocityMps, energyJoules,
 *    windDriftCm, timeOfFlightSec, spinDriftCm, coriolisDeflectionCm,
 *    coriolisVerticalCm]
 * Slot 7 is NaN when `coriolisDeflectionCm` is absent on that point.
 * Slot 8 is NaN when `coriolisVerticalCm` is absent on that point.
 */
export function packPoints(points: readonly TrajectoryPoint[]): {
  buffer: Float64Array<ArrayBuffer>;
  hasCoriolis: boolean;
  hasEotvos: boolean;
} {
  const n = points.length;
  const buffer = new Float64Array(n * POINT_STRIDE);
  let hasCoriolis = false;
  let hasEotvos = false;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const off = i * POINT_STRIDE;
    buffer[off]     = p.rangeMeters;
    buffer[off + 1] = p.dropCm;
    buffer[off + 2] = p.velocityMps;
    buffer[off + 3] = p.energyJoules;
    buffer[off + 4] = p.windDriftCm;
    buffer[off + 5] = p.timeOfFlightSec;
    buffer[off + 6] = p.spinDriftCm;
    const cor = p.coriolisDeflectionCm;
    if (cor != null && !Number.isNaN(cor)) {
      buffer[off + 7] = cor;
      hasCoriolis = true;
    } else {
      buffer[off + 7] = Number.NaN;
    }
    const eot = p.coriolisVerticalCm;
    if (eot != null && Number.isFinite(eot)) {
      buffer[off + 8] = eot;
      hasEotvos = true;
    } else {
      buffer[off + 8] = Number.NaN;
    }
  }
  return { buffer, hasCoriolis, hasEotvos };
}

/**
 * Unpacks a flat Float64Array produced by packPoints() back into TrajectoryPoint objects.
 * Omits the `coriolisDeflectionCm` key entirely when `!hasCoriolis` or `Number.isNaN(cor)`.
 * Omits the `coriolisVerticalCm` key entirely when `!hasEotvos` or `Number.isNaN(eot)`.
 */
export function unpackPoints(
  buffer: Float64Array,
  hasCoriolis: boolean,
  hasEotvos: boolean = false,
): TrajectoryPoint[] {
  const n = Math.floor(buffer.length / POINT_STRIDE);
  const points: TrajectoryPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * POINT_STRIDE;
    const pt: TrajectoryPoint = {
      rangeMeters:     buffer[off]!,
      dropCm:          buffer[off + 1]!,
      velocityMps:     buffer[off + 2]!,
      energyJoules:    buffer[off + 3]!,
      windDriftCm:     buffer[off + 4]!,
      timeOfFlightSec: buffer[off + 5]!,
      spinDriftCm:     buffer[off + 6]!,
    };
    if (hasCoriolis) {
      const cor = buffer[off + 7]!;
      if (!Number.isNaN(cor)) {
        pt.coriolisDeflectionCm = cor;
      }
    }
    if (hasEotvos) {
      const eot = buffer[off + 8]!;
      if (!Number.isNaN(eot)) {
        pt.coriolisVerticalCm = eot;
      }
    }
    points[i] = pt;
  }
  return points;
}
