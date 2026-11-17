# FEAT-1: Gyroscopic spin drift in the TS physics engine

**Version:** 1.0.0
**Status:** Contract written, waiting on user approval of §0 (formula correction). Builder pending.
**Date:** 2026-11-17
**Author:** Architect
**Story:** FEAT-1
**Branch:** `claude/feat1-spin-drift`
**Base branch:** `main`
**Stacks under:** FEAT-2 (`claude/feat2-coriolis`, see `feat2-coriolis-ts.md`), then FEAT-3 (`claude/feat3-custom-drag`, see `feat3-custom-drag-ts.md`)
**Supersedes for the TS engine:** `spin-drift.md` (SH-1, Java/Rust, retired). Don't edit that file.
**Related:** `spa1-ts-engine.md` §4.5 (output rounding), Q1. Golden fixture `tests/fixtures/spa1-golden.json`.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0  Deviations from the story brief (user must approve before building)

| # | Brief said | Contract says | Why |
|---|---|---|---|
| D1 | `SG = (150 × d³) / (twist² × massGr × 21.25)` | Miller twist rule with a fixed length of 4.5 calibers: `SG = 30 × massGr / (twistCal² × d³ × 4.5 × (1 + 4.5²))`, where `twistCal = twist / d` | The brief's formula gives SG ≈ 1.2 × 10⁻⁵ for a .308 168 gr bullet with a 1:10 twist. The real value is about 1.7. In effect it sets SG to 0. |
| D2 | `spinDriftCm = round1(1.25 × (SG + 1.2) × tof^1.83 × rangeMeters × π / 10800 × 100)` (Litz output treated as MOA) | `spinDriftCm = round1(1.25 × (SG + 1.2) × tof^1.83 × 2.54)` (Litz output is **inches**) | Litz's empirical formula returns inches, not MOA. With the brief's formula, the .308 at 1 000 m in this engine gives about 64.6 cm. The corrected formula gives 13.7 cm, which is in line with published values (about 15–25 cm at real-world flight times). The ranges in SH-1's own acceptance list (3–5 cm at 500 m, 15–25 cm at 1 000 m) also only match the corrected formula. |
| D3 | Add `diameterMm: number` to `Bullet`, mapped from YAML `diameter_mm` | Reuse the **existing** `Bullet.bulletDiameterMm` | `bullets.yaml` already uses camelCase `bulletDiameterMm` on all 37 entries. The `virtual:bullet-catalog` plugin loads it with no mapping layer, and the `Bullet` interface already declares it. A second diameter field would duplicate it. |

If the user rejects D1 and D2, the architect revises §3.2 before any code is written. Builders don't choose between formulas.

---

## 1  Problem

`TrajectoryParams.twistRateInchesPerTurn` is accepted and ignored. SPA-1 Q1 recorded this as a known regression. The UI already sends it (`runSimulation`, `app/ballistics.js` line 266) and already renders `spinDriftCm` when it's present (table cell, chart series, DOPE readout). The engine just doesn't compute it.

## 2  Interface changes (`app/physics/types.ts`)

### 2.1 `TrajectoryPoint`: add one required field (after `timeOfFlightSec`)

```ts
export interface TrajectoryPoint {
  rangeMeters: number;
  dropCm: number;
  velocityMps: number;
  energyJoules: number;
  windDriftCm: number;
  timeOfFlightSec: number;
  spinDriftCm: number;          // FEAT-1. Gyroscopic spin drift, cm, >= 0, positive = right (right-hand twist). 0 when twist rate is absent.
}
```

It's always present. When the twist rate is absent it is `0`, and never `-0`.

### 2.2 `TrajectoryParams`: comment-only change

```ts
readonly twistRateInchesPerTurn?: number | null; // [1, 100]; absent = spin drift disabled (FEAT-1)
```

### 2.3 `Bullet`: comment-only change (no new field, see D3)

```ts
readonly bulletDiameterMm: number;     // engine input when twistRateInchesPerTurn is set; [1, 30]
```

No other type changes. `TrajectoryResult` is unchanged in FEAT-1.

## 3  Engine changes (`app/physics/engine.ts`)

### 3.1 New constants (in the existing constant blocks)

```ts
// ── Spin drift (Miller stability + Litz drift) ──
const MM_PER_INCH  = 25.4;
const G_PER_GRAIN  = 0.0648;
const MILLER_K     = 30;
const LENGTH_CAL   = 4.5;   // fixed bullet length in calibers (SH-1 judgement call; modern match bullets are 4.0–5.0)
```

### 3.2 New `@internal` exports (pure functions; place them after `airDensityRatio`)

```ts
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
```

Keep the arithmetic in the order shown. The golden values in §4 are generated from this exact order.

### 3.3 `PointExtras` and the `integrateTrajectoryFps` signature

Add an `@internal` options type in `engine.ts`, not `types.ts`. It's engine-private and FEAT-2 extends it.

```ts
/** Per-point add-ons computed alongside the RK4 samples. @internal */
export interface PointExtras {
  /** Gyroscopic stability factor. null/undefined = spin drift disabled (spinDriftCm = 0). */
  readonly stabilityFactor?: number | null;
}
```

Add one trailing optional parameter to `integrateTrajectoryFps`. Existing positional callers and tests keep working.

```ts
export function integrateTrajectoryFps(
  mvFps: number, angle: number, bc: number, rho: number,
  wLbs: number, windMph: number, maxRangeYd: number, stepYd: number,
  cosAngle: number = 1, dragTable: DragTable = G1_TABLE,
  extras: PointExtras = {}
): { ... unchanged ... }
```

### 3.4 Where the computation goes

It goes inside the `if (rangeYd >= nextYd - 0.01) { ... }` sample block, in the `points.push({...})` literal. Add the new property after `timeOfFlightSec`:

```ts
const sg = extras.stabilityFactor;   // read once, before the while loop
...
        timeOfFlightSec: Math.round(t * 10000) / 10000,
        spinDriftCm:     sg == null ? 0 : Math.round(spinDriftInches(sg, t) * CM_PER_INCH * 10) / 10
```

- Use the **raw** integrator time `t`, not the rounded `timeOfFlightSec`.
- Rounding is `Math.round(v*10)/10` (half toward +∞), the same as every other point field (`spa1-ts-engine.md` §4.5).
- At `t = 0`, `Math.pow(0, 1.83) = 0`, so the muzzle point is `0`.
- Don't change the RK4 state, the drop, wind, or energy maths, or the step loop. Spin drift is a post-hoc lateral term, the same as `windDriftCm`.

### 3.5 `simulate()`

After `dragTable` is chosen and before `integrateTrajectoryFps` is called:

```ts
const twist  = params.twistRateInchesPerTurn;
const extras: PointExtras = {
  stabilityFactor: twist == null
    ? null
    : stabilityFactor(bullet.bulletDiameterMm, bullet.bulletWeightGrams, twist),
};
```

Pass `extras` as the new last argument. The zero-angle solve (`findZeroAngleFps`) does not change.

### 3.6 Validation (`validate()`)

Append these after the existing `shootingAngleDegrees` check, in this order:

```ts
if (params.twistRateInchesPerTurn != null) {
  if (!isFiniteNumber(params.twistRateInchesPerTurn) || !(params.twistRateInchesPerTurn >= 1) || !(params.twistRateInchesPerTurn <= 100))
    throw new TrajectoryInputError('twistRateInchesPerTurn', 'a finite number between 1 and 100');
  if (!isFiniteNumber(bullet.bulletDiameterMm) || !(bullet.bulletDiameterMm >= 1) || !(bullet.bulletDiameterMm <= 30))
    throw new TrajectoryInputError('bullet.bulletDiameterMm', 'a finite number between 1 and 30');
}
```

- Twist lower bound is 1, not SH-1's `> 0`. It matches the UI input's `min="1"` and stops a near-zero twist from overflowing SG to `Infinity` (threat T1).
- Diameter is only validated when twist is set, because the engine reads it nowhere else. Catalog diameters run from 4.37 mm to 12.95 mm.
- The UI does no client-side twist check. An out-of-range value reaches the user through the existing `TrajectoryInputError` path (worker error, then `_setSimulationError`). No UI change.

## 4  Golden fixture update (`tests/fixtures/spa1-golden.json`)

`simulate() — golden fixture` uses `toEqual(expected.points)`. A new always-present field therefore needs the fixture updated.

1. **Existing 21 cases:** insert `"spinDriftCm": 0` after `"timeOfFlightSec"` in every point. **No other byte changes.** The fixture diff must be insertions only. Reviewers check `git diff --numstat`, where deletions on this file must be 0. If any other value changes, the implementation is wrong.
2. **New cases** (append to `cases`, using the `bullet` object from the matching existing case and its `condA` params plus the twist):
   - `"308-win-168gr condA G1 twist10"`: `twistRateInchesPerTurn: 10`
   - `"65-creedmoor-140gr condA G7 twist8"`: `twistRateInchesPerTurn: 8`
   - `"223-rem-55gr condA G1 twist7"`: `twistRateInchesPerTurn: 7`

   `expected` values: **computed by the engine** at the PR head, using a throwaway script that is not committed. Every `spinDriftCm` is a number `>= 0`, and the 308 case must match §5 test 4.
3. Add a top-level `"amendments": ["FEAT-1: spinDriftCm added to all points; 3 twist cases appended"]`. The test ignores it. It records why the fixture no longer matches `generatedFrom`.
4. The golden loop in `tests/physics-engine.test.js` is unchanged.

## 5  Tests (`tests/physics-engine.test.js`)

Coverage must stay at **100/100/100/100** (Jest). `npm test` (typecheck plus Jest) must pass.

| # | Case | Assertion |
|---|---|---|
| 1 | Golden fixture | Passes with the §4 updates |
| 2 | `twistRateInchesPerTurn` omitted, `null`, and `undefined` (3 runs, .308 condA) | Every point has `Object.is(p.spinDriftCm, 0)` |
| 3 | Twist 10, .308 168 gr catalog bullet, condA G1 | `points[0].spinDriftCm === 0`. Every value `>= 0`. Non-decreasing with range. `> 0` at every point with `rangeMeters >= 100` |
| 4 | Same as 3, hand-checked | Point at 500.4 m: `3.8 ± 0.1`. Point at 1000.3 m: `13.7 ± 0.1` (SG = 1.7125) |
| 5 | Same as 3, reference recomputation | For every point, `\|p.spinDriftCm − round1(1.25·(SG+1.2)·p.timeOfFlightSec^1.83·2.54)\| <= 0.1`, with SG worked out independently in the test |
| 6 | `stabilityFactor(7.82, 10.89, 10)` | `toBeCloseTo(1.7125, 3)` |
| 7 | `stabilityFactor` monotonicity | Twist 8 > twist 10 > twist 12 (faster twist gives higher SG). Heavier bullet at the same d and twist gives higher SG |
| 8 | `spinDriftInches(sg, 0)` | `0` |
| 9 | Twist 8 vs twist 12, same bullet and params | Twist 8 gives larger `spinDriftCm` at the last point |
| 10 | Twist does not affect other fields | With twist 10 and without: after removing `spinDriftCm`, the points are `toEqual`. `maxOrdinateCm`, `maxOrdinateRangeMeters` and `supersonicLimitMeters` are equal |
| 11 | Validation: twist `0`, `0.99`, `100.01`, `-5`, `NaN`, `Infinity` | Throws `TrajectoryInputError` with `field === 'twistRateInchesPerTurn'` |
| 12 | Validation boundaries: twist `1` and `100` | No throw |
| 13 | Validation: twist 10 with `bulletDiameterMm` set to `0`, `0.5`, `31`, `NaN` | Throws with `field === 'bullet.bulletDiameterMm'` |
| 14 | Twist absent with `bulletDiameterMm: NaN` | No throw (diameter not read) |
| 15 | `integrateTrajectoryFps` called without `extras` (existing positional tests) | Points carry `spinDriftCm: 0`. Update any existing `toEqual` literals in this file to include it |

No changes to `tests/ballistics.test.js` or the UI tests are required. The `spinDriftCm > 0` render branches are already covered.

## 6  Threat model delta (STRIDE-lite)

Assets: the correctness of the displayed firing solution, and page availability. The trust boundary is user input (form fields, URL state, prefs) passing into the worker's `simulate()`.

| ID | STRIDE | Threat | Mitigation (required) |
|---|---|---|---|
| T1 | DoS / Tampering | A near-zero twist or diameter makes SG `Infinity`, so the UI shows `Infinity`/`NaN` cm | §3.6 bounds: twist [1, 100], diameter [1, 30] mm. The SG denominator is then at least 3.7 |
| T2 | Integrity | A wrong formula gives silently wrong holds (see D1 and D2) | §5 tests 4–6 pin hand-computed values. The golden fixture locks them |
| T3 | Info disclosure | None new. Twist rate is already in URL and prefs state. The engine runs in-browser and sends nothing over the network | n/a |

## 7  Acceptance criteria

1. Types, engine and validation match §2–§3 exactly. `npm test` is green at 100/100/100/100.
2. The golden fixture diff for existing cases is insertions only (`"spinDriftCm": 0`). The 3 new cases are present.
3. Manual check (`npm run dev`): .308 168 gr, twist 10, max range 1000 m. The table shows a spin drift column and the 1000 m row reads about 13.7 cm. With twist blank, there's no spin drift display.
4. `BACKLOG.md` marks FEAT-1 done in the same PR.
5. No files changed outside `app/physics/types.ts`, `app/physics/engine.ts`, `tests/physics-engine.test.js`, `tests/fixtures/spa1-golden.json` and `BACKLOG.md`.
