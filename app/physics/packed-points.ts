import type { TrajectoryPoint } from './types.ts';

/** Number of Float64 elements per packed TrajectoryPoint. */
export const POINT_STRIDE = 8;

/**
 * Packs TrajectoryPoint objects into a flat Float64Array for zero-copy
 * Transferable postMessage between physics worker and main thread (PERF-29).
 *
 * Layout per point (stride = 8):
 *   [rangeMeters, dropCm, velocityMps, energyJoules,
 *    windDriftCm, timeOfFlightSec, spinDriftCm, coriolisDeflectionCm]
 * Slot 7 is NaN when `coriolisDeflectionCm` is absent on that point.
 */
export function packPoints(points: readonly TrajectoryPoint[]): {
  buffer: Float64Array<ArrayBuffer>;
  hasCoriolis: boolean;
} {
  const n = points.length;
  const buffer = new Float64Array(n * POINT_STRIDE);
  let hasCoriolis = false;
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
  }
  return { buffer, hasCoriolis };
}

/**
 * Unpacks a flat Float64Array produced by packPoints() back into TrajectoryPoint objects.
 * Omits the `coriolisDeflectionCm` key entirely when `!hasCoriolis` or `Number.isNaN(cor)`.
 */
export function unpackPoints(buffer: Float64Array, hasCoriolis: boolean): TrajectoryPoint[] {
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
    points[i] = pt;
  }
  return points;
}
