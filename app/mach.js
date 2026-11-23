// ── Transonic / subsonic helpers (S23-2) ──────────────────────────────────────
import { formatNumber } from './prefs.js';
import { toDisplay, unitLabel } from './units.js';

export const TRANSONIC_MACH = 1.2;
export const SUBSONIC_MACH  = 1.0;
const DEFAULT_TEMP_C = 15;
const FPS_PER_MPS = 3.28084;

/** Speed of sound (m/s) in dry air at `tempCelsius`. */
export function speedOfSound(tempCelsius) {
  return 331.3 * Math.sqrt(1 + tempCelsius / 273.15);
}

/** Speed of sound in fps. */
export function speedOfSoundFps(tempCelsius) {
  return speedOfSound(tempCelsius) * FPS_PER_MPS;
}

/**
 * Interpolated range at which velocity first drops to `machThreshold * sos`.
 * @param {{range:number, velocity:number}[]} rows  consistent units
 * @returns {number|null} null if the threshold is never crossed
 */
export function findMachCrossing(rows, machThreshold, sos) {
  const threshold = machThreshold * sos;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].velocity <= threshold && rows[i - 1].velocity > threshold) {
      const t = (rows[i - 1].velocity - threshold) / (rows[i - 1].velocity - rows[i].velocity);
      return rows[i - 1].range + t * (rows[i].range - rows[i - 1].range);
    }
  }
  return null;
}

/** Speed of sound (m/s) for the ambient temperature a result was computed at. */
export function resultSpeedOfSound(result) {
  const t = result?.request?.temperatureC;
  return speedOfSound(Number.isFinite(t) ? t : DEFAULT_TEMP_C);
}

/** Mach number formatted to 2 decimals. */
export function formatMach(velocityMps, sosMps) {
  return (velocityMps / sosMps).toFixed(2);
}

/**
 * Stat-card text for the range at which a result falls to `mach`.
 * Returns "At muzzle" when already below it at row 0, "Beyond max range" when never reached.
 */
export function machRangeText(result, mach, unitSystem = 'metric') {
  const sos = resultSpeedOfSound(result);
  const pts = result.points;
  if (pts.length > 0 && pts[0].velocityMps <= mach * sos) return 'At muzzle';
  const range = findMachCrossing(
    pts.map(p => ({ range: p.rangeMeters, velocity: p.velocityMps })), mach, sos,
  );
  if (range === null) return 'Beyond max range';
  return `${formatNumber(Math.round(toDisplay('range', range, unitSystem)))} ${unitLabel('range', unitSystem)}`;
}
