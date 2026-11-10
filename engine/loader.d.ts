export interface TrajectoryParams {
  bulletId: string;
  zeroRangeMeters?: number; maxRangeMeters?: number; stepMeters?: number;
  windSpeedKph?: number; altitudeMeters?: number; temperatureC?: number;
  sightHeightMm?: number; shootingAngleDegrees?: number; windDirectionDeg?: number;
  dragModel?: 'G1' | 'G7'; twistRateInchesPerTurn?: number;
}
export interface Bullet {
  id: string; name: string; caliber: string;
  bulletWeightGrams: number; muzzleVelocityMps: number; ballisticCoefficient: number;
  bulletDiameterMm: number; muzzleEnergyJoules: number; description: string; hexColor: string;
}
export interface TrajectoryPoint {
  rangeMeters: number; dropCm: number; velocityMps: number; energyJoules: number;
  windDriftCm: number; timeOfFlightSec: number; moaAdjustment: number;
  mradAdjustment: number; spinDriftCm: number;
}
export interface TrajectoryResult {
  bullet: Bullet; request: TrajectoryParams; points: TrajectoryPoint[];
  maxOrdinateCm: number; maxOrdinateRangeMeters: number;
  supersonicLimitMeters: number; densityAltitudeMeters: number;
}
/** Throws WasmUnavailableError synchronously when WebAssembly is undefined; otherwise returns a cached Promise. */
export function initEngine(): Promise<void>;
/** initEngine() must have resolved. Throws BallisticsEngineError on an engine error envelope or malformed output. */
export function computeTrajectory(params: TrajectoryParams, bullet: Bullet): TrajectoryResult;
export class WasmUnavailableError extends Error { name: 'WasmUnavailableError'; constructor(message: string); }
export class BallisticsEngineError extends Error { name: 'BallisticsEngineError'; constructor(message: string); }
