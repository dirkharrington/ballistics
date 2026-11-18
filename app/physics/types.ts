/** Reference drag model. Runtime is lenient: any value other than 'G7' selects G1 (§4.2). */
export type DragModel = 'G1' | 'G7';

/** One row of a reference drag table from physics-tables.yaml: [velocity ft/s, drag-function value]. */
export type DragTableRow = readonly [velocityFps: number, dragFunction: number];
export type DragTable = readonly DragTableRow[];

/**
 * One point on a user-supplied Mach → Cd curve (shape fixed by wa12-custom-drag.md §1.1).
 * RESERVED in SPA-1: accepted on TrajectoryParams.customDragTable, never read.
 */
export interface DragPoint {
  readonly mach: number; // 0.0–5.0 once WA-12 lands
  readonly cd: number;   // 0.001–2.0 once WA-12 lands
}

/** A projectile. Catalog entries (bullets.yaml → virtual:bullet-catalog) always include every field. */
export interface Bullet {
  readonly id: string;                   // kebab-case catalog id, or 'custom' / 'bc-solve'
  readonly name: string;
  readonly caliber: string;
  readonly bulletWeightGrams: number;    // engine input; > 0
  readonly muzzleVelocityMps: number;    // engine input; > 0
  readonly ballisticCoefficient: number; // engine input; > 0 (G1- or G7-referenced, matching dragModel)
  readonly bulletDiameterMm: number;     // engine input when twistRateInchesPerTurn is set; [1, 30]
  readonly muzzleEnergyJoules: number;   // not read by the engine
  readonly description?: string;         // catalog only; absent on custom / bc-solve bullets
  readonly hexColor?: string;            // catalog only; '#RRGGBB'
}

/** Inputs for one trajectory. `null` and `undefined` both mean "absent" for optional fields (?? semantics). */
export interface TrajectoryParams {
  readonly zeroRangeMeters: number;      // (0, 3000]
  readonly maxRangeMeters: number;       // (0, 5000]
  readonly stepMeters: number;           // (0, 500]
  readonly windSpeedKph: number;         // >= 0, total wind speed
  readonly altitudeMeters: number;       // >= 0
  readonly temperatureC: number;         // [-50, 60]
  readonly windDirectionDeg?: number | null;       // [0, 360], meteorological "from"; default 90
  readonly sightHeightMm?: number | null;          // <= 150; default 38.1
  readonly shootingAngleDegrees?: number | null;   // [-45, 45]; default 0
  readonly dragModel?: DragModel | null;           // default 'G1'
  readonly twistRateInchesPerTurn?: number | null; // [1, 100]; absent = spin drift disabled (FEAT-1)
  readonly latitudeDeg?: number | null;            // RESERVED, IGNORED (WA-13; Q2)
  readonly azimuthDeg?: number | null;             // RESERVED, IGNORED (WA-13; Q2)
  readonly customDragTable?: readonly DragPoint[] | null; // RESERVED, IGNORED (WA-12; Q2)
  readonly bulletIds?: readonly string[];          // passthrough from UI request objects; IGNORED
}

/** One output sample. Every value is rounded as specified in §4.5. */
export interface TrajectoryPoint {
  rangeMeters: number;
  dropCm: number;
  velocityMps: number;
  energyJoules: number;
  windDriftCm: number;
  timeOfFlightSec: number;
  spinDriftCm: number;          // FEAT-1. Gyroscopic spin drift, cm, >= 0, positive = right (right-hand twist). 0 when twist rate is absent.
}

/** Return value of simulate(). */
export interface TrajectoryResult {
  readonly bullet: Bullet;            // the SAME object reference passed in
  readonly request: TrajectoryParams; // the SAME object reference passed in
  readonly points: TrajectoryPoint[];
  readonly maxOrdinateCm: number;
  readonly maxOrdinateRangeMeters: number;
  readonly supersonicLimitMeters: number;
  readonly densityAltitudeMeters: number;
}
