/** Reference drag model (input). Runtime is lenient: any value other than 'G7' selects G1. */
export type DragModel = 'G1' | 'G7';

/** Drag model actually used for a result (output). 'custom' = customDragTable was applied. FEAT-3 */
export type EffectiveDragModel = DragModel | 'custom';

/** One row of a reference drag table from physics-tables.yaml: [velocity ft/s, drag-function value]. */
export type DragTableRow = readonly [velocityFps: number, dragFunction: number];
export type DragTable = readonly DragTableRow[];

/** One point on a user-supplied Mach → Cd curve. Validated by simulate() (FEAT-3 §3.3). */
export interface DragPoint {
  readonly mach: number; // [0, 5], strictly increasing within a table
  readonly cd: number;   // [0.001, 2]
}

/** A projectile. Catalog entries (bullets.yaml → virtual:bullet-catalog) omit prose fields (caliber, description). */
export interface Bullet {
  readonly id: string;                   // kebab-case catalog id, or 'custom' / 'bc-solve'
  readonly name: string;
  readonly caliber?: string;             // optional; set to 'Custom' on custom / bc-solve bullets, omitted from catalog
  readonly bulletWeightGrams: number;    // engine input; > 0
  readonly muzzleVelocityMps: number;    // engine input; > 0
  readonly ballisticCoefficient: number; // engine input; > 0 (G1- or G7-referenced, matching dragModel)
  readonly ballisticCoefficientG7?: number | null; // optional G7 BC for catalog / custom bullets
  readonly bulletDiameterMm: number;     // engine input when twistRateInchesPerTurn is set; [1, 30]
  readonly muzzleEnergyJoules: number;   // not read by the engine
  readonly description?: string;         // optional; omitted from virtual:bullet-catalog and custom bullets
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
  readonly latitudeDeg?: number | null;  // [-90, 90], north positive. Coriolis needs BOTH latitudeDeg and azimuthDeg (FEAT-2)
  readonly azimuthDeg?: number | null;   // [0, 360], clockwise from north. Enable flag only; not in the formula (FEAT-2)
  readonly customDragTable?: readonly DragPoint[] | null; // 3–100 points; non-empty overrides dragModel (FEAT-3). null/[] = use dragModel
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
  coriolisDeflectionCm?: number; // FEAT-2. cm, positive = right. Key is ABSENT unless both latitudeDeg and azimuthDeg are set.
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
  readonly dragModel: EffectiveDragModel;   // FEAT-3. 'custom' when customDragTable was applied, else 'G7' if params.dragModel === 'G7', else 'G1'
}

/** Inputs for worker-side G1 BC back-calculation (PERF-17). */
export interface SolveBCParams {
  readonly weightG: number;
  readonly mvMps: number;
  readonly measuredDropCm: number;
  readonly rangeM: number;
  readonly altM: number;
  readonly tempC: number;
}
