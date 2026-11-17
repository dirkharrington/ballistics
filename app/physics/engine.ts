import { G1_TABLE, G7_TABLE, ATMOSPHERE } from 'virtual:physics-tables';
import type { Bullet, TrajectoryParams, TrajectoryPoint, TrajectoryResult, DragTable } from './types.ts';
export type * from './types.ts';

import { TrajectoryInputError } from './errors.ts';
export { TrajectoryInputError } from './errors.ts';

// ── Physics constants (imperial unit system used by the RK4 engine) ───────────
const G_FPS2      = 32.174;
const DT_S        = 0.0005;
const SOUND_FPS   = 1125;
const MIN_VEL_FPS = 100;
const MPH_TO_FPS  = 1.46667;
const G_PER_LB    = 453.592;

// ── Conversion constants ──────────────────────────────────────────────────────
const FPS_PER_MPS = 3.28084;
const FT_PER_M    = 3.28084;
const M_PER_YARD  = 0.9144;
const CM_PER_INCH = 2.54;
const J_PER_FTLB  = 1.35582;
const MPH_PER_KPH = 0.621371;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validate(bullet: Bullet, params: TrajectoryParams): void {
  if (!isFiniteNumber(bullet.bulletWeightGrams) || !(bullet.bulletWeightGrams > 0))
    throw new TrajectoryInputError('bullet.bulletWeightGrams', 'a finite number greater than 0');
  if (!isFiniteNumber(bullet.muzzleVelocityMps) || !(bullet.muzzleVelocityMps > 0))
    throw new TrajectoryInputError('bullet.muzzleVelocityMps', 'a finite number greater than 0');
  if (!isFiniteNumber(bullet.ballisticCoefficient) || !(bullet.ballisticCoefficient > 0))
    throw new TrajectoryInputError('bullet.ballisticCoefficient', 'a finite number greater than 0');
  if (!isFiniteNumber(params.zeroRangeMeters) || !(params.zeroRangeMeters > 0) || !(params.zeroRangeMeters <= 3000))
    throw new TrajectoryInputError('zeroRangeMeters', 'a finite number greater than 0 and at most 3000');
  if (!isFiniteNumber(params.maxRangeMeters) || !(params.maxRangeMeters > 0) || !(params.maxRangeMeters <= 5000))
    throw new TrajectoryInputError('maxRangeMeters', 'a finite number greater than 0 and at most 5000');
  if (!isFiniteNumber(params.stepMeters) || !(params.stepMeters > 0) || !(params.stepMeters <= 500))
    throw new TrajectoryInputError('stepMeters', 'a finite number greater than 0 and at most 500');
  if (!isFiniteNumber(params.windSpeedKph) || !(params.windSpeedKph >= 0))
    throw new TrajectoryInputError('windSpeedKph', 'a finite number of at least 0');
  if (!isFiniteNumber(params.altitudeMeters) || !(params.altitudeMeters >= 0))
    throw new TrajectoryInputError('altitudeMeters', 'a finite number of at least 0');
  if (!isFiniteNumber(params.temperatureC) || !(params.temperatureC >= -50) || !(params.temperatureC <= 60))
    throw new TrajectoryInputError('temperatureC', 'a finite number between -50 and 60');
  if (params.windDirectionDeg != null) {
    if (!isFiniteNumber(params.windDirectionDeg) || !(params.windDirectionDeg >= 0) || !(params.windDirectionDeg <= 360))
      throw new TrajectoryInputError('windDirectionDeg', 'a finite number between 0 and 360');
  }
  if (params.sightHeightMm != null) {
    if (!isFiniteNumber(params.sightHeightMm) || !(params.sightHeightMm <= 150))
      throw new TrajectoryInputError('sightHeightMm', 'a finite number of at most 150');
  }
  if (params.shootingAngleDegrees != null) {
    if (!isFiniteNumber(params.shootingAngleDegrees) || !(params.shootingAngleDegrees >= -45) || !(params.shootingAngleDegrees <= 45))
      throw new TrajectoryInputError('shootingAngleDegrees', 'a finite number between -45 and 45');
  }
}

/**
 * Interpolates the drag coefficient for speed |v| from a drag table.
 * Precondition: table v-values (column 0) are strictly ascending.
 * @internal
 */
export function interpolateDragTable(v: number, table: DragTable): number {
  if (Number.isNaN(v)) return Number.NaN;
  v = Math.abs(v);
  if (v <= table[0]![0]) return table[0]![1];
  const last = table.length - 1;
  if (v >= table[last]![0]) return table[last]![1];
  // Lower-bound binary search: find smallest i in [1, n-1] with table[i][0] >= v.
  // Picks the same bracket as the former linear scan.
  let lo = 1, hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid]![0] < v) lo = mid + 1;
    else hi = mid;
  }
  const a = table[lo - 1]!;
  const b = table[lo]!;
  const t = (v - a[0]) / (b[0] - a[0]);
  return a[1] + t * (b[1] - a[1]);
}

/** @internal */
export function airDensityRatio(altFt: number, tempF: number): number {
  const stdTemp    = ATMOSPHERE.stdTempF - ATMOSPHERE.lapseRatePer1000Ft * (altFt / 1000);
  const tempRatio  = (ATMOSPHERE.rankineOffset + stdTemp) / (ATMOSPHERE.rankineOffset + tempF);
  const pressRatio = Math.pow(1 - ATMOSPHERE.pressureCoeff * altFt, ATMOSPHERE.pressureExp);
  return pressRatio * tempRatio;
}

/** @internal */
export function findZeroAngleFps(
  mvFps: number, bc: number, rho: number, zeroFt: number,
  sightHtFt: number, dragTable: DragTable = G1_TABLE
): number {
  const deriv = (vx: number, vy: number, vel: number): [number, number] => {
    const drag = interpolateDragTable(Math.abs(vel), dragTable) * rho / bc;
    return [-(vx / vel) * drag, -(vy / vel) * drag - G_FPS2];
  };
  let lo = -0.05, hi = 0.05;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    let vx = mvFps * Math.cos(mid), vy = mvFps * Math.sin(mid);
    let x = 0, y = 0;
    while (x < zeroFt) {
      const vel = Math.hypot(vx, vy);
      if (vel < 50) break;
      const [ax1, ay1] = deriv(vx, vy, vel);
      const vx2 = vx + 0.5*DT_S*ax1, vy2 = vy + 0.5*DT_S*ay1;
      const [ax2, ay2] = deriv(vx2, vy2, Math.hypot(vx2, vy2));
      const vx3 = vx + 0.5*DT_S*ax2, vy3 = vy + 0.5*DT_S*ay2;
      const [ax3, ay3] = deriv(vx3, vy3, Math.hypot(vx3, vy3));
      const vx4 = vx +    DT_S*ax3, vy4 = vy +    DT_S*ay3;
      const [ax4, ay4] = deriv(vx4, vy4, Math.hypot(vx4, vy4));
      vx += (DT_S/6)*(ax1 + 2*ax2 + 2*ax3 + ax4);
      vy += (DT_S/6)*(ay1 + 2*ay2 + 2*ay3 + ay4);
      x  += vx * DT_S; y += vy * DT_S;
    }
    if (y < sightHtFt) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** @internal */
export function integrateTrajectoryFps(
  mvFps: number, angle: number, bc: number, rho: number,
  wLbs: number, windMph: number, maxRangeYd: number, stepYd: number,
  cosAngle: number = 1, dragTable: DragTable = G1_TABLE
): { points: TrajectoryPoint[]; maxOrdIn: number; maxOrdRangeYd: number; supersonicLimYd: number } {
  const deriv = (vx: number, vy: number, vel: number): [number, number] => {
    const drag = interpolateDragTable(Math.abs(vel), dragTable) * rho / bc;
    return [-(vx / vel) * drag, -(vy / vel) * drag - G_FPS2];
  };
  let vx = mvFps * Math.cos(angle), vy = mvFps * Math.sin(angle);
  let x = 0, y = 0, t = 0;
  const points: TrajectoryPoint[] = [];
  let nextYd = 0;
  let maxOrdIn = 0, maxOrdRangeYd = 0, supersonicLimYd = maxRangeYd;
  let supersonicLogged = false;
  const mvHorizFps = mvFps * Math.cos(angle);
  const windFps    = windMph * MPH_TO_FPS;

  while ((x / 3) <= maxRangeYd + stepYd) {
    const rangeYd = x / 3;
    const vel     = Math.hypot(vx, vy);

    if (rangeYd >= nextYd - 0.01) {
      const dropIn    = (y - x * Math.tan(angle)) * 12 * cosAngle;
      const energy    = 0.5 * (wLbs / G_FPS2) * vel * vel;
      const vacuumTof = x / mvHorizFps;
      const windDrift = windFps * (t - vacuumTof) * 12;
      points.push({
        rangeMeters:     Math.round(rangeYd * M_PER_YARD * 10) / 10,
        dropCm:          Math.round(dropIn * CM_PER_INCH * 10) / 10,
        velocityMps:     Math.round(vel / FPS_PER_MPS * 10) / 10,
        energyJoules:    Math.round(energy * J_PER_FTLB * 10) / 10,
        windDriftCm:     Math.round(windDrift * CM_PER_INCH * 10) / 10 + 0,
        timeOfFlightSec: Math.round(t * 10000) / 10000
      });
      if (y * 12 > maxOrdIn) { maxOrdIn = y * 12; maxOrdRangeYd = rangeYd; }
      nextYd += stepYd;
    }

    if (!supersonicLogged && vel < SOUND_FPS) {
      supersonicLimYd = rangeYd;
      supersonicLogged = true;
    }

    const [ax1, ay1] = deriv(vx, vy, vel);
    const vx2 = vx + 0.5*DT_S*ax1, vy2 = vy + 0.5*DT_S*ay1;
    const [ax2, ay2] = deriv(vx2, vy2, Math.hypot(vx2, vy2));
    const vx3 = vx + 0.5*DT_S*ax2, vy3 = vy + 0.5*DT_S*ay2;
    const [ax3, ay3] = deriv(vx3, vy3, Math.hypot(vx3, vy3));
    const vx4 = vx +    DT_S*ax3, vy4 = vy +    DT_S*ay3;
    const [ax4, ay4] = deriv(vx4, vy4, Math.hypot(vx4, vy4));
    vx += (DT_S/6)*(ax1 + 2*ax2 + 2*ax3 + ax4);
    vy += (DT_S/6)*(ay1 + 2*ay2 + 2*ay3 + ay4);
    x  += vx * DT_S; y += vy * DT_S; t += DT_S;
    if (vel < MIN_VEL_FPS) break;
  }

  return { points, maxOrdIn, maxOrdRangeYd, supersonicLimYd };
}

export function simulate(bullet: Bullet, params: TrajectoryParams): TrajectoryResult {
  validate(bullet, params);

  const bc    = bullet.ballisticCoefficient;
  const mvFps = bullet.muzzleVelocityMps * FPS_PER_MPS;
  const wLbs  = bullet.bulletWeightGrams / G_PER_LB;
  const rho   = airDensityRatio(params.altitudeMeters * FT_PER_M,
                                params.temperatureC * 9 / 5 + 32);

  const dragTable = (params.dragModel ?? 'G1') === 'G7' ? G7_TABLE : G1_TABLE;

  const sightHtFt = (params.sightHeightMm ?? 38.1) / 25.4 / 12;
  const cosAngle  = Math.cos((params.shootingAngleDegrees ?? 0) * Math.PI / 180);
  const zeroFt    = params.zeroRangeMeters * FT_PER_M * cosAngle;
  const angle     = findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, dragTable);

  const totalWindMph  = params.windSpeedKph * MPH_PER_KPH;
  const windDirRad    = ((params.windDirectionDeg ?? 90) * Math.PI) / 180;
  const windMph       = totalWindMph * Math.sin(windDirRad);
  const maxRangeYd = params.maxRangeMeters / M_PER_YARD;
  const stepYd     = params.stepMeters / M_PER_YARD;
  const { points, maxOrdIn, maxOrdRangeYd, supersonicLimYd } =
    integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd, cosAngle, dragTable);

  const isa = 15 - 0.0065 * params.altitudeMeters;   // ISA temperature at altitude (°C/m lapse)
  const densityAltitudeMeters = Math.round(params.altitudeMeters + 36.2 * (params.temperatureC - isa));
  // 36.2 = 118.8 ft/°C × 0.3048 m/ft

  return {
    bullet,
    request:                params,
    points,
    maxOrdinateCm:          Math.round(maxOrdIn * CM_PER_INCH * 10) / 10,
    maxOrdinateRangeMeters: Math.round(maxOrdRangeYd * M_PER_YARD * 10) / 10,
    supersonicLimitMeters:  Math.round(supersonicLimYd * M_PER_YARD * 10) / 10,
    densityAltitudeMeters
  };
}
