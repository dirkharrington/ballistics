import { G1_TABLE, G7_TABLE, ATMOSPHERE } from 'virtual:physics-tables';
import type { Bullet, TrajectoryParams, TrajectoryPoint, TrajectoryResult, DragTable, DragPoint, EffectiveDragModel } from './types.ts';
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

// ── Coriolis deflection ───────────────────────────────────────────────────────
const EARTH_OMEGA_RADS = 7.2921e-5;

// ── Spin drift (Miller stability + Litz drift) ────────────────────────────────
const MM_PER_INCH  = 25.4;
const G_PER_GRAIN  = 0.0648;
const MILLER_K     = 30;
const LENGTH_CAL   = 4.5;   // fixed bullet length in calibers (SH-1 judgement call; modern match bullets are 4.0–5.0)

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
  if (params.twistRateInchesPerTurn != null) {
    if (!isFiniteNumber(params.twistRateInchesPerTurn) || !(params.twistRateInchesPerTurn >= 1) || !(params.twistRateInchesPerTurn <= 100))
      throw new TrajectoryInputError('twistRateInchesPerTurn', 'a finite number between 1 and 100');
    if (!isFiniteNumber(bullet.bulletDiameterMm) || !(bullet.bulletDiameterMm >= 1) || !(bullet.bulletDiameterMm <= 30))
      throw new TrajectoryInputError('bullet.bulletDiameterMm', 'a finite number between 1 and 30');
  }
  if (params.latitudeDeg != null) {
    if (!isFiniteNumber(params.latitudeDeg) || !(params.latitudeDeg >= -90) || !(params.latitudeDeg <= 90))
      throw new TrajectoryInputError('latitudeDeg', 'a finite number between -90 and 90');
  }
  if (params.azimuthDeg != null) {
    if (!isFiniteNumber(params.azimuthDeg) || !(params.azimuthDeg >= 0) || !(params.azimuthDeg <= 360))
      throw new TrajectoryInputError('azimuthDeg', 'a finite number between 0 and 360');
  }
  const table = params.customDragTable;
  if (table != null) {
    // Rule 1: must be an array
    if (!Array.isArray(table))
      throw new TrajectoryInputError('customDragTable', 'an array of { mach, cd } points');
    // Empty array means "absent" — no further validation needed
    if (table.length === 0) return;
    // Rule 2: length 3–100
    if (!(table.length >= 3) || !(table.length <= 100))
      throw new TrajectoryInputError('customDragTable', 'between 3 and 100 points');
    // Rule 3: mach values [0, 5]
    for (const p of table) {
      if (!(isFiniteNumber(p?.mach) && p.mach >= 0 && p.mach <= 5))
        throw new TrajectoryInputError('customDragTable', 'mach values between 0 and 5');
    }
    // Rule 4: cd values [0.001, 2]
    for (const p of table) {
      if (!(isFiniteNumber(p?.cd) && p.cd >= 0.001 && p.cd <= 2))
        throw new TrajectoryInputError('customDragTable', 'cd values between 0.001 and 2');
    }
    // Rule 5: strictly increasing fps values (guards against ULP-collapse divide-by-zero)
    for (let i = 1; i < table.length; i++) {
      if (!(table[i]!.mach * SOUND_FPS > table[i - 1]!.mach * SOUND_FPS))
        throw new TrajectoryInputError('customDragTable', 'strictly increasing mach values');
    }
    // Rule 6: at least one mach <= 0.5
    if (!table.some(p => p.mach <= 0.5))
      throw new TrajectoryInputError('customDragTable', 'at least one point with mach <= 0.5');
    // Rule 7: at least one mach >= 2.0
    if (!table.some(p => p.mach >= 2.0))
      throw new TrajectoryInputError('customDragTable', 'at least one point with mach >= 2.0');
  }
}

/**
 * Converts a Mach→Cd table to the engine's [velocity fps, value] DragTable shape.
 *
 * Physics note: The engine's G1/G7 columns are scaled form-factor values F(v), not true
 * drag coefficients. The custom `cd` drops into the same slot and is still divided by the
 * bullet's BC, with no Cd→retardation conversion. Results are self-consistent and respond
 * correctly to the shape of the curve, but the absolute effect of a custom curve is small
 * due to the engine's near-vacuum drag behaviour. See WA-13 for details.
 * @internal
 */
export function toDragTable(points: readonly DragPoint[]): DragTable {
  return points.map(p => [p.mach * SOUND_FPS, p.cd] as const);
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

/** Miller twist-rule gyroscopic stability factor with a fixed length of LENGTH_CAL calibers. @internal */
export function stabilityFactor(diameterMm: number, weightGrams: number, twistIn: number): number {
  const dIn      = diameterMm / MM_PER_INCH;
  const massGr   = weightGrams / G_PER_GRAIN;
  const twistCal = twistIn / dIn;
  return (MILLER_K * massGr) /
         (twistCal * twistCal * dIn * dIn * dIn * LENGTH_CAL * (1 + LENGTH_CAL * LENGTH_CAL));
}

/** Litz empirical spin drift, in INCHES, at time of flight tofSec. @internal */
export function spinDriftInches(sg: number, tofSec: number): number {
  return 1.25 * (sg + 1.2) * Math.pow(tofSec, 1.83);
}

/** Per-point add-ons computed alongside the RK4 samples. @internal */
export interface PointExtras {
  /** Gyroscopic stability factor. null/undefined = spin drift disabled (spinDriftCm = 0). */
  readonly stabilityFactor?: number | null;
  /** OMEGA × sin(lat) × muzzleVelocityMps (m/s²). null/undefined = Coriolis disabled (key omitted). */
  readonly coriolisK?: number | null;
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
  cosAngle: number = 1, dragTable: DragTable = G1_TABLE,
  extras: PointExtras = {}
): { points: TrajectoryPoint[]; maxOrdIn: number; maxOrdRangeYd: number; supersonicLimYd: number } {
  const deriv = (vx: number, vy: number, vel: number): [number, number] => {
    const drag = interpolateDragTable(Math.abs(vel), dragTable) * rho / bc;
    return [-(vx / vel) * drag, -(vy / vel) * drag - G_FPS2];
  };
  const sg = extras.stabilityFactor ?? null;
  const ck = extras.coriolisK ?? null;
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
      const point: TrajectoryPoint = {
        rangeMeters:     Math.round(rangeYd * M_PER_YARD * 10) / 10,
        dropCm:          Math.round(dropIn * CM_PER_INCH * 10) / 10,
        velocityMps:     Math.round(vel / FPS_PER_MPS * 10) / 10,
        energyJoules:    Math.round(energy * J_PER_FTLB * 10) / 10,
        windDriftCm:     Math.round(windDrift * CM_PER_INCH * 10) / 10 + 0,
        timeOfFlightSec: Math.round(t * 10000) / 10000,
        spinDriftCm:     sg == null ? 0 : Math.round(spinDriftInches(sg, t) * CM_PER_INCH * 10) / 10
      };
      if (ck != null) {
        const deflM = ck * t * t;
        point.coriolisDeflectionCm = Math.round(deflM * 100 * 10) / 10 + 0;   // + 0 normalises -0
      }
      points.push(point);
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

  const custom      = params.customDragTable;
  const useCustom   = custom != null && custom.length > 0;
  const dragModel: EffectiveDragModel =
    useCustom ? 'custom' : ((params.dragModel ?? 'G1') === 'G7' ? 'G7' : 'G1');
  const dragTable   = useCustom ? toDragTable(custom) : (dragModel === 'G7' ? G7_TABLE : G1_TABLE);

  const twist  = params.twistRateInchesPerTurn;
  const lat = params.latitudeDeg;
  const az  = params.azimuthDeg;
  const extras: PointExtras = {
    stabilityFactor: twist == null
      ? null
      : stabilityFactor(bullet.bulletDiameterMm, bullet.bulletWeightGrams, twist),
    coriolisK: lat == null || az == null
      ? null
      : EARTH_OMEGA_RADS * Math.sin(lat * Math.PI / 180) * bullet.muzzleVelocityMps,
  };

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
    integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd, cosAngle, dragTable, extras);

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
    densityAltitudeMeters,
    dragModel
  };
}
