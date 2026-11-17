# FEAT-2: Coriolis deflection in the TS physics engine

**Version:** 1.0.0
**Status:** Contract written, builder pending (after FEAT-1)
**Date:** 2026-11-17
**Author:** Architect
**Story:** FEAT-2
**Branch:** `claude/feat2-coriolis`
**Base branch:** `claude/feat1-spin-drift` (stacked). Open the PR against `claude/feat1-spin-drift`. Retarget it to `main` once FEAT-1 merges, and rebase if needed.
**Depends on:** `feat1-spin-drift-ts.md` (`PointExtras`, `spinDriftCm`, and the golden fixture as amended by FEAT-1). All three stories touch `types.ts`, `engine.ts`, `tests/physics-engine.test.js` and `spa1-golden.json`, so they must land in order FEAT-1 → FEAT-2 → FEAT-3.
**Stacks under:** FEAT-3 (`claude/feat3-custom-drag`)
**Supersedes for the TS engine:** `wa13-coriolis.md` §1–§3 (Rust/Java, on hold). Don't edit that file. The physics model (§1.2 there) is kept.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 1  Problem

`TrajectoryParams.latitudeDeg` and `azimuthDeg` are reserved and ignored. The UI already sends both (`runSimulation` lines 267–268, `runCustom` lines 413–414). It validates their ranges, keeps them in URL state, and renders `coriolisDeflectionCm` when present: the table column `#coriolisColHeader`, the chart series, the DOPE readout and `tools.js` interpolation. The engine never sets the field.

## 2  Physics model (same as WA-13 §1.2, kept on purpose)

```
OMEGA  = 7.2921e-5                       // Earth rotation, rad/s
latRad = latitudeDeg × π / 180
deflM  = OMEGA × sin(latRad) × muzzleVelocityMps × tof²
coriolisDeflectionCm = round1(deflM × 100)
```

- This is the first-order horizontal (cross-track) term. **Azimuth does not appear in it.** Azimuth is required as an enable flag and kept for a future vertical (Eötvös) term.
- Sign: positive = right of bore. Northern latitudes are positive and southern latitudes negative. The equator gives `0`.
- Using muzzle velocity overstates deflection at long range. WA-13 §1.3 accepted this as conservative, so it isn't changed here.
- `tof` is the **raw** integrator time `t`. `muzzleVelocityMps` is `bullet.muzzleVelocityMps` as given, not round-tripped through fps.

## 3  Interface changes (`app/physics/types.ts`)

### 3.1 `TrajectoryPoint`: add one optional field (after `spinDriftCm`)

```ts
  spinDriftCm: number;                 // FEAT-1
  coriolisDeflectionCm?: number;       // FEAT-2. cm, positive = right. Key is ABSENT unless both latitudeDeg and azimuthDeg are set.
```

"Absent" means the property is not on the object at all: `'coriolisDeflectionCm' in p === false`. It is never present with the value `undefined`.

### 3.2 `TrajectoryParams`: comment-only changes

```ts
readonly latitudeDeg?: number | null;  // [-90, 90], north positive. Coriolis needs BOTH latitudeDeg and azimuthDeg (FEAT-2)
readonly azimuthDeg?: number | null;   // [0, 360], clockwise from north. Enable flag only; not in the formula (FEAT-2)
```

This is a deliberate difference from WA-13 §1.5, where latitude alone was enough. The FEAT-2 brief needs both. In practice nothing changes for users, because `#azimuthDeg` defaults to `value="0"` and every UI call site sends it.

## 4  Engine changes (`app/physics/engine.ts`)

### 4.1 Constant

```ts
const EARTH_OMEGA_RADS = 7.2921e-5;
```

### 4.2 Extend `PointExtras` (defined by FEAT-1)

```ts
export interface PointExtras {
  readonly stabilityFactor?: number | null;
  /** OMEGA × sin(lat) × muzzleVelocityMps (m/s²). null/undefined = Coriolis disabled (key omitted). */
  readonly coriolisK?: number | null;
}
```

### 4.3 Per-point computation (`integrateTrajectoryFps` sample block)

Read `const ck = extras.coriolisK;` once, before the `while` loop. Build the point into a local before pushing it, so the key can be omitted:

```ts
      const point: TrajectoryPoint = {
        rangeMeters: ..., dropCm: ..., velocityMps: ..., energyJoules: ...,
        windDriftCm: ..., timeOfFlightSec: ..., spinDriftCm: ...     // all unchanged from FEAT-1
      };
      if (ck != null) {
        const deflM = ck * t * t;
        point.coriolisDeflectionCm = Math.round(deflM * 100 * 10) / 10 + 0;   // + 0 normalises -0
      }
      points.push(point);
```

- `+ 0` is needed. In the southern hemisphere small negative values round to `-0`, and `toEqual` and the `>= 0 ? '+' : ''` display prefix both treat `-0` differently. `windDriftCm` already uses the same idiom.
- Property order stays the same: the FEAT-1 fields first, then `coriolisDeflectionCm`.

### 4.4 `simulate()`

Extend the FEAT-1 `extras` literal:

```ts
const lat = params.latitudeDeg;
const az  = params.azimuthDeg;
const extras: PointExtras = {
  stabilityFactor: /* unchanged from FEAT-1 */,
  coriolisK: lat == null || az == null
    ? null
    : EARTH_OMEGA_RADS * Math.sin(lat * Math.PI / 180) * bullet.muzzleVelocityMps,
};
```

### 4.5 Validation (`validate()`)

Append these after the FEAT-1 twist and diameter block. Each field is validated on its own whenever it is non-null, even if the other one is absent:

```ts
if (params.latitudeDeg != null) {
  if (!isFiniteNumber(params.latitudeDeg) || !(params.latitudeDeg >= -90) || !(params.latitudeDeg <= 90))
    throw new TrajectoryInputError('latitudeDeg', 'a finite number between -90 and 90');
}
if (params.azimuthDeg != null) {
  if (!isFiniteNumber(params.azimuthDeg) || !(params.azimuthDeg >= 0) || !(params.azimuthDeg <= 360))
    throw new TrajectoryInputError('azimuthDeg', 'a finite number between 0 and 360');
}
```

The UI already blocks the same ranges before calling the engine, so users see no change. This check is defence in depth for URL and prefs state.

## 5  Golden fixture update (`tests/fixtures/spa1-golden.json`)

1. **Existing cases (21 original plus 3 FEAT-1 twist cases): no change.** None sets latitude or azimuth, so the key is absent and `toEqual` still passes. If any existing expected point changes, the implementation is wrong.
2. **New cases** (append; use the `.308 168 gr` `bullet` and `condA` params from the existing case):
   - `"308-win-168gr condA G1 lat45 az90"`: `latitudeDeg: 45, azimuthDeg: 90`
   - `"308-win-168gr condA G1 lat-33 az0 twist10"`: `latitudeDeg: -33, azimuthDeg: 0, twistRateInchesPerTurn: 10` (southern hemisphere, combined with spin drift)

   `expected` values: **computed by the engine** at the PR head. In the first case every point has `coriolisDeflectionCm >= 0`. In the second every point has `coriolisDeflectionCm <= 0`, and the value is never `-0`.
3. Append `"FEAT-2: 2 Coriolis cases appended"` to the top-level `amendments` array.
4. The golden loop is unchanged.

## 6  Tests (`tests/physics-engine.test.js`)

Coverage must stay at **100/100/100/100**. `npm test` must pass.

| # | Case | Assertion |
|---|---|---|
| 1 | Golden fixture | Passes |
| 2 | Neither field set; `latitudeDeg` only; `azimuthDeg` only; both `null` | Every point has `'coriolisDeflectionCm' in p === false` |
| 3 | .308 condA G1, lat 45, az 90 | Point at 500.4 m: `1.6 ± 0.1`. Point at 1000.3 m: `6.4 ± 0.1`. `points[0]` is `0` |
| 4 | .308 condA G1, lat −33, az 0 | Point at 1000.3 m: `-4.9 ± 0.1`. Every value `<= 0`. `Object.is(points[0].coriolisDeflectionCm, 0)` (not `-0`) |
| 5 | Latitude 0, az 0 | Every point has `Object.is(p.coriolisDeflectionCm, 0)` |
| 6 | Azimuth independence | Lat 45 with az 0, 90, 270 and 360 gives `toEqual` points |
| 7 | Hemisphere symmetry | For every point, lat 30 and lat −30 values sum to `0` within ±0.1 |
| 8 | Reference recomputation (lat 45) | For every point, `\|p.coriolisDeflectionCm − round1(7.2921e-5·sin(π/4)·mv·p.timeOfFlightSec²·100)\| <= 0.1` |
| 9 | Coriolis does not affect other fields | Lat 45 / az 90 vs none: after removing `coriolisDeflectionCm`, the points are `toEqual`. Summary fields are equal |
| 10 | Combined with spin drift (twist 10, lat 45, az 90) | Both fields present. `spinDriftCm` equals the twist-only run, and `coriolisDeflectionCm` equals the Coriolis-only run |
| 11 | Validation: lat `-90.01`, `90.01`, `NaN`, `Infinity` | Throws with `field === 'latitudeDeg'`. Test once with azimuth set and once without |
| 12 | Validation: az `-0.01`, `360.01`, `NaN` | Throws with `field === 'azimuthDeg'`. Test once with latitude set and once without |
| 13 | Validation boundaries: lat `-90`, `90`; az `0`, `360` | No throw |
| 14 | `integrateTrajectoryFps` with `extras = { coriolisK: 0 }` and `extras = {}` | Key present and `0` in the first; absent in the second |

No UI test changes are required. The `coriolisDeflectionCm` render branches in `ballistics.js` and `tools.js` are already covered.

## 7  Threat model delta (STRIDE-lite)

| ID | STRIDE | Threat | Mitigation (required) |
|---|---|---|---|
| T1 | Info disclosure | Latitude is the user's location | The engine runs in a same-origin Web Worker and makes no network calls. FEAT-2 adds no new persistence. Latitude was already in URL and prefs state (accepted in WA-13 §7). The `#latitudeDeg` tooltip says the value "is sent with computation requests over HTTPS". That has been stale since SPA-2. Fixing it is out of scope (see Open questions in the main-session summary) |
| T2 | Tampering / DoS | Out-of-range or non-finite lat/az from edited URL state | §4.5 validation. `sin` of a bounded angle is in [−1, 1], and `t` is bounded by the loop's `MIN_VEL_FPS` break, so the output is finite |
| T3 | Integrity | `-0` shown as "+-0.0" or `toEqual` mismatches | The `+ 0` normalisation in §4.3. Tests 4 and 5 |

## 8  Acceptance criteria

1. Types, engine and validation match §3–§4 exactly. `npm test` is green at 100/100/100/100.
2. Existing golden cases are untouched. The 2 new cases are present.
3. Manual check (`npm run dev`): .308 168 gr, latitude 45, azimuth 90, 1000 m. The Coriolis column appears and reads about +6.4 cm at 1000 m. With latitude blank, the column stays hidden.
4. `BACKLOG.md` marks FEAT-2 done in the same PR.
5. No files changed outside `app/physics/types.ts`, `app/physics/engine.ts`, `tests/physics-engine.test.js`, `tests/fixtures/spa1-golden.json` and `BACKLOG.md`.
