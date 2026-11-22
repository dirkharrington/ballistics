import { G1_TABLE, G5_TABLE, G7_TABLE, ATMOSPHERE } from 'virtual:physics-tables';
import type { Bullet, TrajectoryParams, TrajectoryPoint, TrajectoryResult, DragTable, DragPoint, EffectiveDragModel, SolveBCParams } from './types.ts';
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
  if (params.pressureHpa != null) {
    if (!isFiniteNumber(params.pressureHpa) || !(params.pressureHpa >= 500) || !(params.pressureHpa <= 1100))
      throw new TrajectoryInputError('pressureHpa', 'a finite number between 500 and 1100');
  }
  if (params.humidityPercent != null) {
    if (!isFiniteNumber(params.humidityPercent) || !(params.humidityPercent >= 0) || !(params.humidityPercent <= 100))
      throw new TrajectoryInputError('humidityPercent', 'a finite number between 0 and 100');
  }
  if (params.includeEotvos != null) {
    if (typeof params.includeEotvos !== 'boolean')
      throw new TrajectoryInputError('includeEotvos', 'a boolean');
  }
  const table = params.customDragTable;
  if (table != null) {
    // Rule 1: must be an array
    if (!Array.isArray(table))
      throw new TrajectoryInputError('customDragTable', 'an array of { mach, cd } points');
    // Empty array means "absent" — no further validation needed
    if (table.length > 0) {
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
}

/**
 * Converts a Mach→Cd table to the engine's [velocity fps, value] DragTable shape.
 *
 * Physics note: The engine's G1/G7 columns are scaled form-factor values F(v), not true
 * drag coefficients. The custom `cd` drops into the same slot and is still divided by the
 * bullet's BC, with no Cd→retardation conversion. Results are self-consistent and respond
 * correctly to the shape of the curve, but the absolute effect of a custom curve is small
 * due to the engine's near-vacuum drag behaviour. See contracts/feat3-custom-drag-ts.md for details.
 * @internal
 */
export function toDragTable(points: readonly DragPoint[]): DragTable {
  return points.map(p => [p.mach * SOUND_FPS, p.cd] as const);
}

/**
 * Flat typed-array drag table for zero-allocation O(1)-amortized RK4 lookups (PERF-15).
 * @internal
 */
interface CompiledDragTable {
  readonly v: Float64Array;
  readonly f: Float64Array;
  readonly dv: Float64Array;
  readonly df: Float64Array;
  readonly last: number;
}

/** @internal */
export function compileDragTable(table: DragTable): CompiledDragTable {
  const n = table.length;
  const v  = new Float64Array(n);
  const f  = new Float64Array(n);
  const dv = new Float64Array(n);
  const df = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    v[i] = table[i]![0];
    f[i] = table[i]![1];
    if (i > 0) {
      dv[i] = v[i]! - v[i - 1]!;
      df[i] = f[i]! - f[i - 1]!;
    }
  }
  return { v, f, dv, df, last: n - 1 };
}

const G1_COMPILED = compileDragTable(G1_TABLE);
const G5_COMPILED = compileDragTable(G5_TABLE);
const G7_COMPILED = compileDragTable(G7_TABLE);
const _compiledCache = new WeakMap<DragTable, CompiledDragTable>([
  [G1_TABLE, G1_COMPILED],
  [G5_TABLE, G5_COMPILED],
  [G7_TABLE, G7_COMPILED],
]);

function getCompiledDragTable(table: DragTable): CompiledDragTable {
  let compiled = _compiledCache.get(table);
  if (!compiled) {
    compiled = compileDragTable(table);
    _compiledCache.set(table, compiled);
  }
  return compiled;
}

/**
 * Updates a local bracket index in O(1) amortized time for monotonic speed trajectories.
 * Returns smallest i in [1, ct.last] with ct.v[i] >= v (clamped to [1, ct.last]).
 * @internal
 */
export function findBracket(v: number, ct: CompiledDragTable, idx: number): number {
  const vArr = ct.v;
  if (v <= vArr[0]!) return 1;
  if (v >= vArr[ct.last]!) return ct.last;
  while (idx > 1 && v <= vArr[idx - 1]!) idx--;
  while (idx < ct.last && v > vArr[idx]!) idx++;
  return idx;
}

/** @internal */
export function airDensityRatio(altFt: number, tempF: number): number {
  const stdTemp    = ATMOSPHERE.stdTempF - ATMOSPHERE.lapseRatePer1000Ft * (altFt / 1000);
  const tempRatio  = (ATMOSPHERE.rankineOffset + stdTemp) / (ATMOSPHERE.rankineOffset + tempF);
  const pressRatio = Math.pow(1 - ATMOSPHERE.pressureCoeff * altFt, ATMOSPHERE.pressureExp);
  return pressRatio * tempRatio;
}

/**
 * Station air density ratio relative to ICAO sea-level standard dry air (ENH-2).
 * Falls back verbatim to `airDensityRatio` when both pressureHpa and humidityPercent are null/undefined.
 * @internal
 */
export function stationAirDensityRatio(
  altFt: number,
  tempF: number,
  pressureHpa?: number | null,
  humidityPercent?: number | null
): number {
  if (pressureHpa == null && humidityPercent == null) {
    return airDensityRatio(altFt, tempF);
  }
  const tempC = (tempF - 32) * 5 / 9;
  const tempK = tempC + 273.15;
  const pPa = pressureHpa != null
    ? pressureHpa * 100
    : 101325 * Math.pow(1 - ATMOSPHERE.pressureCoeff * altFt, ATMOSPHERE.pressureExp);
  const rh = (humidityPercent ?? 0) / 100;
  const esPa = 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const pv = Math.min(rh * esPa, pPa * 0.99);
  const pd = pPa - pv;
  const rhoActual = pd / (287.058 * tempK) + pv / (461.495 * tempK);
  const rhoSeaLevel = 101325 / (287.058 * 288.15);
  return rhoActual / rhoSeaLevel;
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
interface PointExtras {
  /** Gyroscopic stability factor. null/undefined = spin drift disabled (spinDriftCm = 0). */
  readonly stabilityFactor?: number | null;
  /** OMEGA × sin(lat) × muzzleVelocityMps (m/s²). null/undefined = Coriolis disabled (key omitted). */
  readonly coriolisK?: number | null;
  /** OMEGA × cos(lat) × sin(az) × muzzleVelocityMps (m/s²). null/undefined = Eötvös disabled (key omitted). */
  readonly eotvosK?: number | null;
}

function evalHeightAtZero(
  angle: number, mvFps: number, rhoOverBc: number, zeroFt: number,
  ct: CompiledDragTable, startIdx: number
): number {
  const vArr  = ct.v;
  const fArr  = ct.f;
  const dvArr = ct.dv;
  const dfArr = ct.df;
  const last  = ct.last;
  const vMin  = vArr[0]!;
  const vMax  = vArr[last]!;
  const fMin  = fArr[0]!;
  const fMax  = fArr[last]!;

  const halfDt  = 0.5 * DT_S;
  const sixthDt = DT_S / 6;
  let vx = mvFps * Math.cos(angle), vy = mvFps * Math.sin(angle);
  let x = 0, y = 0;
  let idx = startIdx;

  while (x < zeroFt) {
    const v1 = Math.sqrt(vx * vx + vy * vy);
    if (v1 < 50) break;
    let drag1: number;
    if (v1 <= vMin) { idx = 1; drag1 = fMin; }
    else if (v1 >= vMax) { idx = last; drag1 = fMax; }
    else {
      while (idx > 1 && v1 <= vArr[idx - 1]!) idx--;
      while (idx < last && v1 > vArr[idx]!) idx++;
      drag1 = fArr[idx - 1]! + ((v1 - vArr[idx - 1]!) / dvArr[idx]!) * dfArr[idx]!;
    }
    const d1  = drag1 * rhoOverBc;
    const ax1 = -(vx / v1) * d1;
    const ay1 = -(vy / v1) * d1 - G_FPS2;

    const vx2 = vx + halfDt * ax1, vy2 = vy + halfDt * ay1;
    const v2  = Math.sqrt(vx2 * vx2 + vy2 * vy2);
    let i2 = idx, drag2: number;
    if (v2 <= vMin) { i2 = 1; drag2 = fMin; }
    else if (v2 >= vMax) { i2 = last; drag2 = fMax; }
    else {
      while (i2 > 1 && v2 <= vArr[i2 - 1]!) i2--;
      while (i2 < last && v2 > vArr[i2]!) i2++;
      drag2 = fArr[i2 - 1]! + ((v2 - vArr[i2 - 1]!) / dvArr[i2]!) * dfArr[i2]!;
    }
    const d2  = drag2 * rhoOverBc;
    const ax2 = -(vx2 / v2) * d2;
    const ay2 = -(vy2 / v2) * d2 - G_FPS2;

    const vx3 = vx + halfDt * ax2, vy3 = vy + halfDt * ay2;
    const v3  = Math.sqrt(vx3 * vx3 + vy3 * vy3);
    let i3 = idx, drag3: number;
    if (v3 <= vMin) { i3 = 1; drag3 = fMin; }
    else if (v3 >= vMax) { i3 = last; drag3 = fMax; }
    else {
      while (i3 > 1 && v3 <= vArr[i3 - 1]!) i3--;
      while (i3 < last && v3 > vArr[i3]!) i3++;
      drag3 = fArr[i3 - 1]! + ((v3 - vArr[i3 - 1]!) / dvArr[i3]!) * dfArr[i3]!;
    }
    const d3  = drag3 * rhoOverBc;
    const ax3 = -(vx3 / v3) * d3;
    const ay3 = -(vy3 / v3) * d3 - G_FPS2;

    const vx4 = vx + DT_S * ax3, vy4 = vy + DT_S * ay3;
    const v4  = Math.sqrt(vx4 * vx4 + vy4 * vy4);
    let i4 = idx, drag4: number;
    if (v4 <= vMin) { i4 = 1; drag4 = fMin; }
    else if (v4 >= vMax) { i4 = last; drag4 = fMax; }
    else {
      while (i4 > 1 && v4 <= vArr[i4 - 1]!) i4--;
      while (i4 < last && v4 > vArr[i4]!) i4++;
      drag4 = fArr[i4 - 1]! + ((v4 - vArr[i4 - 1]!) / dvArr[i4]!) * dfArr[i4]!;
    }
    const d4  = drag4 * rhoOverBc;
    const ax4 = -(vx4 / v4) * d4;
    const ay4 = -(vy4 / v4) * d4 - G_FPS2;

    vx += sixthDt * (ax1 + 2 * ax2 + 2 * ax3 + ax4);
    vy += sixthDt * (ay1 + 2 * ay2 + 2 * ay3 + ay4);
    x  += vx * DT_S;
    y  += vy * DT_S;
  }
  return y;
}

/** @internal */
export function findZeroAngleFps(
  mvFps: number, bc: number, rho: number, zeroFt: number,
  sightHtFt: number, dragTable: DragTable = G1_TABLE,
  hintAngle?: number
): number {
  const ct        = getCompiledDragTable(dragTable);
  const rhoOverBc = rho / bc;
  const startIdx  = findBracket(mvFps, ct, ct.last);

  let lo = -0.05, hi = 0.05;
  let fLo = 0, fHi = 0;
  let hit = false;

  if (hintAngle !== undefined) {
    const hLo = Math.max(-0.05, hintAngle - 0.002);
    const hHi = Math.min(0.05, hintAngle + 0.002);
    fLo = evalHeightAtZero(hLo, mvFps, rhoOverBc, zeroFt, ct, startIdx) - sightHtFt;
    if (fLo < 0) {
      fHi = evalHeightAtZero(hHi, mvFps, rhoOverBc, zeroFt, ct, startIdx) - sightHtFt;
      if (fHi >= 0) {
        lo = hLo;
        hi = hHi;
        hit = true;
      }
    }
  }

  if (!hit) {
    fLo = evalHeightAtZero(lo, mvFps, rhoOverBc, zeroFt, ct, startIdx) - sightHtFt;
    if (fLo >= 0) return lo;
    fHi = evalHeightAtZero(hi, mvFps, rhoOverBc, zeroFt, ct, startIdx) - sightHtFt;
    if (fHi < 0) return hi;
  }

  // Safeguarded secant with bisection fallback (PERF-16): converges in ~5–9 passes
  // instead of 64 fixed bisection passes while matching to <1e-12 rad.
  for (let i = 0; i < 64 && hi - lo > 1e-13; i++) {
    const span = hi - lo;
    const secant = hi - fHi * (span / (fHi - fLo));
    const margin = 0.05 * span;
    const mid = (secant > lo + margin && secant < hi - margin)
      ? secant
      : (lo + hi) / 2;
    const fMid = evalHeightAtZero(mid, mvFps, rhoOverBc, zeroFt, ct, startIdx) - sightHtFt;
    if (Math.abs(fMid) <= 1e-9) { lo = hi = mid; break; }
    if (fMid < 0) { lo = mid; fLo = fMid; } else { hi = mid; fHi = fMid; }
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
  const ct    = getCompiledDragTable(dragTable);
  const vArr  = ct.v;
  const fArr  = ct.f;
  const dvArr = ct.dv;
  const dfArr = ct.df;
  const last  = ct.last;
  const vMin  = vArr[0]!;
  const vMax  = vArr[last]!;
  const fMin  = fArr[0]!;
  const fMax  = fArr[last]!;

  const rhoOverBc     = rho / bc;
  const halfDt        = 0.5 * DT_S;
  const sixthDt       = DT_S / 6;
  const tanAngle      = Math.tan(angle);
  const halfMassOverG = 0.5 * (wLbs / G_FPS2);
  const sg = extras.stabilityFactor ?? null;
  const ck = extras.coriolisK ?? null;
  const ek = extras.eotvosK ?? null;
  let vx = mvFps * Math.cos(angle), vy = mvFps * Math.sin(angle);
  let x = 0, y = 0, t = 0;
  const points: TrajectoryPoint[] = [];
  let nextYd = 0;
  let maxOrdIn = 0, maxOrdRangeYd = 0, supersonicLimYd = maxRangeYd;
  let supersonicLogged = false;
  const mvHorizFps = vx;
  const windFps    = windMph * MPH_TO_FPS;
  let idx = findBracket(mvFps, ct, last);

  while ((x / 3) <= maxRangeYd + stepYd) {
    const rangeYd = x / 3;
    const vel     = Math.sqrt(vx * vx + vy * vy);

    if (rangeYd >= nextYd - 0.01) {
      const dropIn    = (y - x * tanAngle) * 12 * cosAngle;
      const energy    = halfMassOverG * vel * vel;
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
      if (ek != null) {
        point.coriolisVerticalCm = Math.round(ek * t * t * 100 * 10) / 10 + 0;
      }
      points.push(point);
      if (y * 12 > maxOrdIn) { maxOrdIn = y * 12; maxOrdRangeYd = rangeYd; }
      nextYd += stepYd;
    }

    if (!supersonicLogged && vel < SOUND_FPS) {
      supersonicLimYd = rangeYd;
      supersonicLogged = true;
    }

    let drag1: number;
    if (vel <= vMin) { idx = 1; drag1 = fMin; }
    else if (vel >= vMax) { idx = last; drag1 = fMax; }
    else {
      while (idx > 1 && vel <= vArr[idx - 1]!) idx--;
      while (idx < last && vel > vArr[idx]!) idx++;
      drag1 = fArr[idx - 1]! + ((vel - vArr[idx - 1]!) / dvArr[idx]!) * dfArr[idx]!;
    }
    const d1  = drag1 * rhoOverBc;
    const ax1 = -(vx / vel) * d1;
    const ay1 = -(vy / vel) * d1 - G_FPS2;

    const vx2 = vx + halfDt * ax1, vy2 = vy + halfDt * ay1;
    const v2  = Math.sqrt(vx2 * vx2 + vy2 * vy2);
    let i2 = idx, drag2: number;
    if (v2 <= vMin) { i2 = 1; drag2 = fMin; }
    else if (v2 >= vMax) { i2 = last; drag2 = fMax; }
    else {
      while (i2 > 1 && v2 <= vArr[i2 - 1]!) i2--;
      while (i2 < last && v2 > vArr[i2]!) i2++;
      drag2 = fArr[i2 - 1]! + ((v2 - vArr[i2 - 1]!) / dvArr[i2]!) * dfArr[i2]!;
    }
    const d2  = drag2 * rhoOverBc;
    const ax2 = -(vx2 / v2) * d2;
    const ay2 = -(vy2 / v2) * d2 - G_FPS2;

    const vx3 = vx + halfDt * ax2, vy3 = vy + halfDt * ay2;
    const v3  = Math.sqrt(vx3 * vx3 + vy3 * vy3);
    let i3 = idx, drag3: number;
    if (v3 <= vMin) { i3 = 1; drag3 = fMin; }
    else if (v3 >= vMax) { i3 = last; drag3 = fMax; }
    else {
      while (i3 > 1 && v3 <= vArr[i3 - 1]!) i3--;
      while (i3 < last && v3 > vArr[i3]!) i3++;
      drag3 = fArr[i3 - 1]! + ((v3 - vArr[i3 - 1]!) / dvArr[i3]!) * dfArr[i3]!;
    }
    const d3  = drag3 * rhoOverBc;
    const ax3 = -(vx3 / v3) * d3;
    const ay3 = -(vy3 / v3) * d3 - G_FPS2;

    const vx4 = vx + DT_S * ax3, vy4 = vy + DT_S * ay3;
    const v4  = Math.sqrt(vx4 * vx4 + vy4 * vy4);
    let i4 = idx, drag4: number;
    if (v4 <= vMin) { i4 = 1; drag4 = fMin; }
    else if (v4 >= vMax) { i4 = last; drag4 = fMax; }
    else {
      while (i4 > 1 && v4 <= vArr[i4 - 1]!) i4--;
      while (i4 < last && v4 > vArr[i4]!) i4++;
      drag4 = fArr[i4 - 1]! + ((v4 - vArr[i4 - 1]!) / dvArr[i4]!) * dfArr[i4]!;
    }
    const d4  = drag4 * rhoOverBc;
    const ax4 = -(vx4 / v4) * d4;
    const ay4 = -(vy4 / v4) * d4 - G_FPS2;

    vx += sixthDt * (ax1 + 2 * ax2 + 2 * ax3 + ax4);
    vy += sixthDt * (ay1 + 2 * ay2 + 2 * ay3 + ay4);
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
  const rho   = stationAirDensityRatio(
    params.altitudeMeters * FT_PER_M,
    params.temperatureC * 9 / 5 + 32,
    params.pressureHpa,
    params.humidityPercent,
  );

  const custom      = params.customDragTable;
  const useCustom   = custom != null && custom.length > 0;
  const dragModel: EffectiveDragModel =
    useCustom ? 'custom'
    : params.dragModel === 'G7' ? 'G7'
    : params.dragModel === 'G5' ? 'G5'
    : 'G1';
  const dragTable   = useCustom ? toDragTable(custom)
    : dragModel === 'G7' ? G7_TABLE
    : dragModel === 'G5' ? G5_TABLE
    : G1_TABLE;

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
    eotvosK: params.includeEotvos === true && lat != null && az != null
      ? EARTH_OMEGA_RADS * Math.cos(lat * Math.PI / 180) * Math.sin(az * Math.PI / 180) * bullet.muzzleVelocityMps
      : null,
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

  let densityAltitudeMeters: number;
  if (params.pressureHpa == null && params.humidityPercent == null) {
    const isa = 15 - 0.0065 * params.altitudeMeters;   // ISA temperature at altitude (°C/m lapse)
    densityAltitudeMeters = Math.round(params.altitudeMeters + 36.2 * (params.temperatureC - isa));
    // 36.2 = 118.8 ft/°C × 0.3048 m/ft
  } else {
    densityAltitudeMeters = Math.round((1 - Math.pow(rho, 1 / 4.255876)) / 2.25577e-5) + 0;
  }

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

/**
 * Lightweight single-scalar drop evaluation at targetFt for BC back-calculation (PERF-17).
 * Avoids allocating TrajectoryPoint objects or computing unused spin/Coriolis/energy fields.
 */
function evalDropCmAtRange(
  mvFps: number, bc: number, rho: number, zeroFt: number,
  sightHtFt: number, targetFt: number, ct: CompiledDragTable, startIdx: number,
  hintAngle?: number
): { dropCm: number; angle: number } | null {
  const angle     = findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, G1_TABLE, hintAngle);
  const vArr      = ct.v;
  const fArr      = ct.f;
  const dvArr     = ct.dv;
  const dfArr     = ct.df;
  const last      = ct.last;
  const vMax      = vArr[last]!;
  const fMax      = fArr[last]!;

  const rhoOverBc = rho / bc;
  const halfDt    = 0.5 * DT_S;
  const sixthDt   = DT_S / 6;
  const tanAngle  = Math.tan(angle);
  let vx = mvFps * Math.cos(angle), vy = mvFps * Math.sin(angle);
  let x = 0, y = 0;
  let prevX = 0, prevY = 0;
  let idx = startIdx;

  while (x < targetFt) {
    const vel = Math.sqrt(vx * vx + vy * vy);
    if (vel < MIN_VEL_FPS) return null;
    prevX = x;
    prevY = y;

    let drag1: number;
    if (vel >= vMax) { idx = last; drag1 = fMax; }
    else {
      while (idx > 1 && vel <= vArr[idx - 1]!) idx--;
      while (idx < last && vel > vArr[idx]!) idx++;
      drag1 = fArr[idx - 1]! + ((vel - vArr[idx - 1]!) / dvArr[idx]!) * dfArr[idx]!;
    }
    const d1  = drag1 * rhoOverBc;
    const ax1 = -(vx / vel) * d1;
    const ay1 = -(vy / vel) * d1 - G_FPS2;

    const vx2 = vx + halfDt * ax1, vy2 = vy + halfDt * ay1;
    const v2  = Math.sqrt(vx2 * vx2 + vy2 * vy2);
    let i2 = idx, drag2: number;
    if (v2 >= vMax) { i2 = last; drag2 = fMax; }
    else {
      while (i2 > 1 && v2 <= vArr[i2 - 1]!) i2--;
      while (i2 < last && v2 > vArr[i2]!) i2++;
      drag2 = fArr[i2 - 1]! + ((v2 - vArr[i2 - 1]!) / dvArr[i2]!) * dfArr[i2]!;
    }
    const d2  = drag2 * rhoOverBc;
    const ax2 = -(vx2 / v2) * d2;
    const ay2 = -(vy2 / v2) * d2 - G_FPS2;

    const vx3 = vx + halfDt * ax2, vy3 = vy + halfDt * ay2;
    const v3  = Math.sqrt(vx3 * vx3 + vy3 * vy3);
    let i3 = idx, drag3: number;
    if (v3 >= vMax) { i3 = last; drag3 = fMax; }
    else {
      while (i3 > 1 && v3 <= vArr[i3 - 1]!) i3--;
      while (i3 < last && v3 > vArr[i3]!) i3++;
      drag3 = fArr[i3 - 1]! + ((v3 - vArr[i3 - 1]!) / dvArr[i3]!) * dfArr[i3]!;
    }
    const d3  = drag3 * rhoOverBc;
    const ax3 = -(vx3 / v3) * d3;
    const ay3 = -(vy3 / v3) * d3 - G_FPS2;

    const vx4 = vx + DT_S * ax3, vy4 = vy + DT_S * ay3;
    const v4  = Math.sqrt(vx4 * vx4 + vy4 * vy4);
    let i4 = idx, drag4: number;
    if (v4 >= vMax) { i4 = last; drag4 = fMax; }
    else {
      while (i4 > 1 && v4 <= vArr[i4 - 1]!) i4--;
      while (i4 < last && v4 > vArr[i4]!) i4++;
      drag4 = fArr[i4 - 1]! + ((v4 - vArr[i4 - 1]!) / dvArr[i4]!) * dfArr[i4]!;
    }
    const d4  = drag4 * rhoOverBc;
    const ax4 = -(vx4 / v4) * d4;
    const ay4 = -(vy4 / v4) * d4 - G_FPS2;

    vx += sixthDt * (ax1 + 2 * ax2 + 2 * ax3 + ax4);
    vy += sixthDt * (ay1 + 2 * ay2 + 2 * ay3 + ay4);
    x  += vx * DT_S;
    y  += vy * DT_S;
  }

  const frac = (targetFt - prevX) / (x - prevX);
  const yAtTarget = prevY + frac * (y - prevY);
  return {
    dropCm: (yAtTarget - targetFt * tanAngle) * 12 * CM_PER_INCH,
    angle,
  };
}

/**
 * Worker-side G1 BC back-calculator (PERF-17, PERF-30).
 * Finds the G1 BC in [0.001, 1.5] matching `measuredDropCm` at `rangeM` to 4 decimal places
 * via Illinois-damped safeguarded secant with warm-bracket zero-angle reuse.
 */
export function solveBC(params: SolveBCParams): number | null {
  const { weightG, mvMps, measuredDropCm, rangeM, altM, tempC } = params;
  if (
    !isFiniteNumber(weightG) || !(weightG > 0) ||
    !isFiniteNumber(mvMps) || !(mvMps > 0) ||
    !isFiniteNumber(measuredDropCm) ||
    !isFiniteNumber(rangeM) || !(rangeM > 0) ||
    !isFiniteNumber(altM) || !(altM >= 0) ||
    !isFiniteNumber(tempC) || tempC < -50 || tempC > 60
  ) {
    return null;
  }

  const mvFps     = mvMps * FPS_PER_MPS;
  const rho       = airDensityRatio(altM * FT_PER_M, tempC * 9 / 5 + 32);
  const sightHtFt = 38.1 / 25.4 / 12;
  const zeroFt    = 100 * FT_PER_M;
  const targetFt  = rangeM * FT_PER_M;
  const startIdx  = findBracket(mvFps, G1_COMPILED, G1_COMPILED.last);

  let lo = 0.001, hi = 1.5;
  const resLo = evalDropCmAtRange(mvFps, lo, rho, zeroFt, sightHtFt, targetFt, G1_COMPILED, startIdx);
  if (resLo === null) return null;
  let fLo = resLo.dropCm - measuredDropCm;
  let hintAngle = resLo.angle;
  if (fLo >= 0) return lo;

  const resHi = evalDropCmAtRange(mvFps, hi, rho, zeroFt, sightHtFt, targetFt, G1_COMPILED, startIdx, hintAngle)!;
  let fHi = resHi.dropCm - measuredDropCm;
  hintAngle = resHi.angle;
  if (fHi <= 0) return hi;

  let mid = (lo + hi) / 2;
  let prevSide = 0;
  for (let i = 0; i < 40 && hi - lo > 1e-5; i++) {
    const span = hi - lo;
    const margin = 0.05 * span;
    const secant = hi - fHi * (span / (fHi - fLo));
    mid = (secant > lo + margin && secant < hi - margin)
      ? secant
      : (lo + hi) / 2;
    const resMid = evalDropCmAtRange(mvFps, mid, rho, zeroFt, sightHtFt, targetFt, G1_COMPILED, startIdx, hintAngle)!;
    hintAngle = resMid.angle;
    const fMid = resMid.dropCm - measuredDropCm;
    if (Math.abs(fMid) <= 1e-7) break;
    if (fMid < 0) {
      lo = mid;
      fLo = fMid;
      if (prevSide === -1) fHi *= 0.5;
      prevSide = -1;
    } else {
      hi = mid;
      fHi = fMid;
      if (prevSide === 1) fLo *= 0.5;
      prevSide = 1;
    }
  }
  return Math.round(mid * 10000) / 10000;
}
