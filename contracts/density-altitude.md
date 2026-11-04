# Contract: Density Altitude Output — SH-3

Version: 1.0.0 — 2026-11-03  
Related: [`be-jsonrpc-contract.md`](./be-jsonrpc-contract.md)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## Summary

Compute density altitude (metres) from the request's `altitudeMeters` and `temperatureC`, and return it as `densityAltitudeMeters` on `TrajectoryResult`. No new request fields. No physics change — density altitude is a **derived output** only.

---

## Model changes

### `TrajectoryResult` — new component

```java
/**
 * @param densityAltitudeMeters  Density altitude in metres derived from altitudeMeters and temperatureC.
 *                               Negative when the air is denser than standard sea-level (cold high altitude).
 *                               Purely informational; does not affect trajectory computation.
 */
```

Add `double densityAltitudeMeters` as the **last** component of `TrajectoryResult` (after `supersonicLimitMeters`).

Updated record:

```java
public record TrajectoryResult(
    Bullet bullet,
    TrajectoryRequest request,
    List<TrajectoryPoint> points,
    double maxOrdinateCm,
    double maxOrdinateRangeMeters,
    double supersonicLimitMeters,
    double densityAltitudeMeters    // new — always present
) {}
```

---

## Physics: density altitude formula

Use the **ISA temperature-deviation form**:

```
ISA_temp_C = 15.0 − 1.98 × (altitudeMeters / 304.8)
densityAltitudeMeters = altitudeMeters + 118.8 × (temperatureC − ISA_temp_C)
```

Constants:
- `15.0` °C — ISA sea-level temperature
- `1.98` °C per 1000 ft — standard ISA lapse rate (equivalent to the standard 6.5°C/km but calibrated to feet, matching the engine's internal atmosphere model)
- `304.8` m per 1000 ft conversion (i.e., `altitudeMeters / 304.8` = altitude in thousands of feet)
- `118.8` m per °C temperature deviation from ISA (empirical constant from aviation standards)

**Judgement call:** Use the temperature-deviation form rather than the pressure-based equivalent. It is simpler to implement, requires only the two already-present request fields, and produces values consistent with the atmosphere model already used in `BallisticsEngine.airDensityRatio()` (same ISA lapse rate constants).

### Verification examples

| Altitude (m) | Temp (°C) | ISA_temp_C | DA (m) | Notes |
|---|---|---|---|---|
| 0 | 15 | 15.0 | 0 | Standard sea level |
| 0 | 30 | 15.0 | +1782 | Hot sea-level day |
| 1000 | 15 | 8.5 | 1000 | ISA at altitude |
| 1000 | 30 | 8.5 | +2554 | Hot at altitude |
| 1000 | -10 | 8.5 | -1200 | Cold at altitude — negative DA |
| 2000 | -20 | 2.0 | -604 | Cold high altitude |

Negative DA means air is denser than standard: bullet experiences more drag than at a standard atmosphere at that geometric altitude.

### Implementation location

Compute in `BallisticsEngine.compute()` before constructing `TrajectoryResult`:

```java
double isaTemp = 15.0 - 1.98 * (req.altitudeMeters() / 304.8);
double densityAltM = r1(req.altitudeMeters() + 118.8 * (req.temperatureC() - isaTemp));

TrajectoryResult output = new TrajectoryResult(
    bullet, req, result.points(),
    r1(result.maxOrdinateIn()      * CM_PER_INCH),
    r1(result.maxOrdinateRangeYd() * M_PER_YARD),
    r1(result.supersonicLimitYd()  * M_PER_YARD),
    densityAltM
);
```

Round with `r1()` for consistency with the other summary fields.

---

## Wire format changes

### `TrajectoryResult` schema addition

```json
"densityAltitudeMeters": {
  "type": "number",
  "description": "Density altitude in metres. Negative values indicate denser-than-standard air."
}
```

Add to both `required` and `properties` of `TrajectoryResult` in `be-jsonrpc-contract.md`.

---

## Acceptance checklist (BE builder)

- [ ] Sea level (0 m), 15°C → `densityAltitudeMeters ≈ 0.0` (within ±1 due to rounding).
- [ ] Sea level (0 m), 30°C → `densityAltitudeMeters ≈ 1782` (±5 m).
- [ ] 1000 m, 30°C → `densityAltitudeMeters ≈ 2554` (±5 m).
- [ ] 1000 m, −10°C → `densityAltitudeMeters < 0` (negative DA possible; assert < -1000).
- [ ] `densityAltitudeMeters` appears in `TrajectoryResult` for all four endpoints: `trajectory.compute`, `trajectory.compare`, `trajectory.computeCustom`, `trajectory.batch`.
- [ ] Existing tests: update all `new TrajectoryResult(…)` constructor calls to add the new `densityAltitudeMeters` argument. Existing golden-response assertions must also include the field.
- [ ] `densityAltitudeMeters` is a pure function of `altitudeMeters` and `temperatureC`; it does not affect the trajectory `points` array.
- [ ] 100% JaCoCo instruction and branch coverage.
