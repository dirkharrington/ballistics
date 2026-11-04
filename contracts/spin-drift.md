# Contract: Spin Drift (Gyroscopic) — SH-1

Version: 1.0.0 — 2026-11-03  
Related: [`be-jsonrpc-contract.md`](./be-jsonrpc-contract.md)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## Summary

Add optional `twistRateInchesPerTurn` to `TrajectoryRequest`. When non-null, compute gyroscopic spin drift at every trajectory point using the Litz simplified formula and return `spinDriftCm` on `TrajectoryPoint`. The field is **always present** on the wire — `0.0` when twist rate is disabled — so existing consumers are unaffected.

---

## Model changes

### `TrajectoryRequest` — new component

```java
@Schema(description = "Barrel twist rate in inches per turn. When provided, gyroscopic spin drift " +
        "is computed and returned as spinDriftCm on each TrajectoryPoint. " +
        "Null or absent = spin drift disabled (spinDriftCm = 0.0). " +
        "Example: 10 = 1-in-10\" twist.", example = "10")
@DecimalMin(value = "0", inclusive = false)   // exclusiveMinimum 0
@DecimalMax("100")
Double twistRateInchesPerTurn
```

Add this as the **last** component of the `TrajectoryRequest` record (after `dragModel`), so the compact constructor's existing parameter order is unchanged for all callers that use positional construction.

**Compact constructor addition:**

```java
// existing defaults first, then:
// twistRateInchesPerTurn: null means absent; no default applied — null = disabled
```

No default is applied. `null` means "disabled"; callers that don't send the field get `spinDriftCm = 0.0` on every point.

**`withBulletId` method** — add `twistRateInchesPerTurn` to the copy:

```java
public TrajectoryRequest withBulletId(String newBulletId) {
    return new TrajectoryRequest(newBulletId, zeroRangeMeters, maxRangeMeters, stepMeters,
        windSpeedKph, altitudeMeters, temperatureC, sightHeightMm,
        shootingAngleDegrees, windDirectionDeg, dragModel, twistRateInchesPerTurn);
}
```

### `TrajectoryPoint` — new component

```java
double spinDriftCm   // lateral spin drift in cm; 0.0 when twist rate disabled
```

Add as the **last** component of `TrajectoryPoint`. **Primitive `double`**, not boxed, so the wire always carries a number. Existing consumers that read only the previous eight fields are unaffected.

Add Javadoc:

```java
/**
 * @param spinDriftCm  Gyroscopic spin drift in cm at this range. Positive = rightward (right-hand twist).
 *                     Zero when twistRateInchesPerTurn is null/absent on the request.
 */
```

---

## Physics: Litz simplified spin drift formula

### Step 1 — Greenhill gyroscopic stability factor (Sg)

```
Sg = (150 × d³) / (twist² × mass_gr × (1 + (L/d)²))
```

where:
- `d` = bullet diameter in **inches** (`bulletDiameterMm / 25.4`)
- `twist` = `twistRateInchesPerTurn` (already in inches)
- `mass_gr` = bullet weight in **grains** (`bulletWeightGrams × 15.4324`)
- `L/d` = **4.5** (fixed approximation for modern match/spitzer bullets)

**Judgement call:** Use the fixed L/d = 4.5 approximation rather than computing length from diameter and weight. Modern match bullets (ELD-M, SMK, Berger Hybrid) have L/d ratios of 4.0–5.0. 4.5 is the midpoint and matches the Litz published examples. A future contract change could add `bulletLengthMm` to `Bullet` if users need exact computation.

Resulting `1 + (L/d)²` = `1 + 4.5² = 21.25` (constant — compute once per trajectory, not per point).

### Step 2 — Litz spin drift formula

```
spin_drift_moa = 1.25 × (Sg + 1.2) × tof^1.83
```

where:
- `Sg` = stability factor from Step 1
- `tof` = `timeOfFlightSec` at this trajectory point

### Step 3 — Convert MOA to centimetres

```
spin_drift_cm = spin_drift_moa × rangeMeters × (Math.PI / 10800) × 100
```

Derivation: 1 MOA = π/10800 radians. At range R metres, 1 MOA = R × π/10800 m = R × π/10800 × 100 cm.

### Step 4 — Sign convention

**Positive = rightward** (same direction as `windDriftCm` for a standard right crosswind, which the existing code already treats as positive).

Right-hand twist produces rightward spin drift in the northern hemisphere. This is the physically correct and most common case. If a left-hand twist barrel is later supported (e.g. via a negative twist rate), `spinDriftCm` would be negative. For this sprint `twistRateInchesPerTurn` is validated `> 0`, so drift is always ≥ 0.

### Implementation location

Compute `spinDriftCm` **inside `integrateTrajectory`**, in the same block that constructs each `TrajectoryPoint`:

```java
// Before the TrajectoryPoint constructor call, add:
double spinDriftCmSI = 0.0;
if (ci.twistRateInchesPerTurn() != null) {
    spinDriftCmSI = computeSpinDrift(ci, tof, rangeSI);
}

// Update TrajectoryPoint constructor to pass spinDriftCmSI as the last argument.
```

Add `twistRateInchesPerTurn` and the precomputed Sg to `ConvertedInputs`, or compute Sg once before the loop in `integrateTrajectory` and close over it via a local variable.

**Recommended pattern** — add to `ConvertedInputs`:

```java
private record ConvertedInputs(
    // ... existing fields ...
    Double twistRateInchesPerTurn,  // null = spin drift disabled
    double stabilityFactor          // Greenhill Sg; 0.0 when twist rate null
) {}
```

Compute Sg in `convertInputs()`:

```java
double sg = 0.0;
if (req.twistRateInchesPerTurn() != null) {
    double dIn      = bullet.bulletDiameterMm() / 25.4;
    double massGr   = bullet.bulletWeightGrams() * GRAINS_PER_GRAM;
    double twist    = req.twistRateInchesPerTurn();
    double ldRatio  = 4.5;
    sg = (150.0 * Math.pow(dIn, 3)) / (twist * twist * massGr * (1.0 + ldRatio * ldRatio));
}
```

Then in `integrateTrajectory`:

```java
double spinDriftCmSI = 0.0;
if (ci.twistRateInchesPerTurn() != null) {
    double driftMoa = 1.25 * (ci.stabilityFactor() + 1.2) * Math.pow(tof, 1.83);
    spinDriftCmSI   = r1(driftMoa * rangeSI * Math.PI / 10800.0 * 100.0);
}
```

Round with `r1()` for consistency with other `TrajectoryPoint` fields.

---

## Cache key impact

`TrajectoryRequest` is a Java record. Records generate `equals()` and `hashCode()` from all components. Adding `twistRateInchesPerTurn` as a new component means it is **automatically included** in the existing `@Cacheable` key `#req`.

No change to the `@Cacheable` annotation itself is required.

Two calls that differ only in `twistRateInchesPerTurn` produce separate cache entries. A call with `null` and a call with `0` are **different** (`null ≠ 0.0` for boxed Double equality), but both produce `spinDriftCm = 0.0` — this is acceptable (the `null` case short-circuits the computation).

---

## Wire format changes

### `TrajectoryParams` schema addition

```json
"twistRateInchesPerTurn": {
  "type": "number",
  "exclusiveMinimum": 0,
  "maximum": 100,
  "description": "Barrel twist rate in inches per turn. When provided, spin drift is computed. Omit to disable."
}
```

Add to the `properties` map of `TrajectoryParams` in `be-jsonrpc-contract.md`. It is **not** added to `required`.

Applies to: `trajectory.compute`, `trajectory.compare`, `trajectory.computeCustom`, and `trajectory.batch` (each uses `TrajectoryParams`).

### `TrajectoryPoint` schema addition

```json
"spinDriftCm": {
  "type": "number",
  "description": "Gyroscopic spin drift in cm. Positive = rightward (right-hand twist). 0.0 when twist rate not provided."
}
```

Add to both `required` and `properties` of `TrajectoryPoint` in `be-jsonrpc-contract.md`.

---

## Validation table

| Field | Java type | Constraint | Absent/null | Invalid → |
|---|---|---|---|---|
| `twistRateInchesPerTurn` | `Double` | `@DecimalMin("0", inclusive=false) @DecimalMax("100")` | null — spin drift disabled | ≤ 0 or > 100 → 400 |

---

## Acceptance checklist (BE builder)

- [ ] `twistRateInchesPerTurn` absent → all `spinDriftCm = 0.0` on every point.
- [ ] `twistRateInchesPerTurn: 10` (1-in-10" twist), `.308 Win 168gr`, standard conditions: `spinDriftCm` at 0 m = 0.0, > 0 at 500 m (expect ~3–5 cm), substantially larger at 1000 m (expect ~15–25 cm). Assert both sign and magnitude vs. hand-computed Litz formula.
- [ ] `twistRateInchesPerTurn: 0` → 400 validation error.
- [ ] `twistRateInchesPerTurn: 101` → 400 validation error.
- [ ] `twistRateInchesPerTurn: 100` → 200 (boundary is inclusive at 100).
- [ ] Two otherwise-identical requests with and without `twistRateInchesPerTurn` produce separate cache entries (miss count rises by 1 on the second call; first call is a miss, second call with same twist is a hit).
- [ ] `spinDriftCm` is present and 0.0 in all existing test golden files (no existing tests break).
- [ ] `withBulletId()` preserves `twistRateInchesPerTurn` on the returned copy.
- [ ] 100% JaCoCo instruction and branch coverage on all changed/new code paths.

---

## Notes for the FE builder (coordinate with `fe-sprint-notes.md`)

`spinDriftCm` is now on every `TrajectoryPoint`. The FE can display it analogously to `windDriftCm` — either as an additional series on the WIND DRIFT chart (second y-axis or same y-axis) or as a column in the DOPE card (MH-3). No separate chart panel is specified in this sprint; the FE builder may add `spinDriftCm` to the range readout table row for display-only.
