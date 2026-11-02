# Contract: `CompareRequest` missing fields (BE-3)

Version: 1.0.0 — 2026-11-01
Related: [`trajectory-service.md`](trajectory-service.md) (its `CompareRequest.toTrajectoryRequest` comment is superseded by this contract; see "Docs follow-up")

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Bug

`CompareRequest` lacks `sightHeightMm`, `shootingAngleDegrees`, `windDirectionDeg`, and `dragModel`. Jackson ignores unknown JSON properties (Boot default), so `POST /api/trajectories/compare` and `POST /api/trajectories/compare/stream` quietly drop those four values. They always compute with the `TrajectoryRequest` defaults (38.1 mm, 0°, 90°, G1). The frontend already sends all four in `runSimulation()` / `streamCompare()`, so the main UI flow shows wrong results whenever a user changes Sight Height, Angle, Wind Dir, or Drag Model. Only the offline client-side fallback honours them.

**No frontend change is needed.**

## Deviations from the coordinator brief (need user approval)

| Brief | Contract | Reason |
|---|---|---|
| `sightHeightMm`: no constraint | `@Max(150)` | That's what `TrajectoryRequest.sightHeightMm` actually carries. The brief's own rule is "same validation as `TrajectoryRequest`". Values ≤ 0 are not rejected: `TrajectoryRequest`'s compact constructor maps them to 38.1 |
| `windDirectionDeg`: one of {0, 45, …, 315} | `@Min(0) @Max(360)` | Same validation as `TrajectoryRequest`. An enum would make `/compare` stricter than `/trajectories/{bulletId}` and break the parity acceptance test for values like 30°. The 8-value restriction is a UI concern: the `<select>` already enforces it, and FE-1 enforces it for URL params |
| `CompareRequest` compact constructor applies defaults (38.1 / 0.0 / 90.0 / "G1") | **No** defaulting in `CompareRequest`. Raw values (possibly `null`) pass through | `TrajectoryRequest`'s compact constructor stays the **single source** of defaults. Duplicating them would let the two drift. Results and cache keys are identical either way (see "Cache key") |

## Updated record shape (all 11 components, in this order)

```java
package com.ballistics.model;

public record CompareRequest(
    @Schema(description = "List of catalog bullet IDs to compare. Unknown IDs are silently filtered out.")
    @NotEmpty @Size(max = 20) List<String> bulletIds,

    @Positive @Max(3000) double zeroRangeMeters,          // unchanged
    @Positive @Max(5000) double maxRangeMeters,           // unchanged
    @Positive @Max(500)  double stepMeters,               // unchanged
    @PositiveOrZero      double windSpeedKph,             // unchanged
    @PositiveOrZero      double altitudeMeters,           // unchanged
    @Min(-50) @Max(60)   double temperatureC,             // unchanged

    // ── new: same annotations and @Schema text as TrajectoryRequest ──
    @Schema(description = "Height of the sight/scope centreline above bore centreline in mm. Default 38.1 mm (1.5 in).", example = "38.1")
    @Max(150) Double sightHeightMm,

    @Schema(description = "Shooting angle from horizontal in degrees. Positive = uphill, negative = downhill. Range ±45°. Default 0.", example = "0")
    @Min(-45) @Max(45) Double shootingAngleDegrees,

    @Schema(description = "Wind direction in meteorological degrees (direction the wind is coming FROM). 90 = from East (right crosswind). Default 90.", example = "90")
    @Min(0) @Max(360) Double windDirectionDeg,

    @Schema(description = "Drag model: \"G1\" (default) or \"G7\" (boat-tail long-range).", example = "G1", allowableValues = {"G1", "G7"})
    @Pattern(regexp = "G[17]") String dragModel
) {
    // No compact constructor. Defaults are applied by TrajectoryRequest.

    public TrajectoryRequest toTrajectoryRequest(String bulletId) {
        return new TrajectoryRequest(
            bulletId,
            zeroRangeMeters,
            maxRangeMeters,
            stepMeters,
            windSpeedKph,
            altitudeMeters,
            temperatureC,
            sightHeightMm,          // null or ≤ 0 → 38.1  (TrajectoryRequest compact ctor)
            shootingAngleDegrees,   // null → 0.0
            windDirectionDeg,       // null → 90.0
            dragModel               // null → "G1"
        );
    }
}
```

- Use boxed `Double`/`String` with **no** `@NotNull`, exactly like `TrajectoryRequest`. If you add a nullability annotation, use JSpecify `org.jspecify.annotations.Nullable` (Spring 7's choice), not the deprecated `org.springframework.lang.Nullable`. It's optional.
- **Don't add a 7-argument convenience constructor.** A second constructor on a record can confuse Jackson's creator detection. Update the existing test call sites instead (`TrajectoryServiceUnitTest` lines ~80 and ~91: `new CompareRequest(ids, 100, 200, 100, 0, 0, 15)` → append `, null, null, null, null`).

## Validation table

| Component | Java type | Constraint | Absent / `null` | Invalid → |
|---|---|---|---|---|
| `bulletIds` | `List<String>` | `@NotEmpty @Size(max = 20)` | 400 | 400 (unchanged) |
| `zeroRangeMeters` … `temperatureC` | `double` | unchanged | unchanged | unchanged |
| `sightHeightMm` | `Double` | `@Max(150)` | 38.1 (via `TrajectoryRequest`) | > 150 → 400. ≤ 0 → 38.1 (not an error, same as `TrajectoryRequest`) |
| `shootingAngleDegrees` | `Double` | `@Min(-45) @Max(45)` | 0.0 | outside ±45 → 400 |
| `windDirectionDeg` | `Double` | `@Min(0) @Max(360)` | 90.0 | < 0 or > 360 → 400 |
| `dragModel` | `String` | `@Pattern(regexp = "G[17]")` | `"G1"` | anything else (including `"g7"`, `""`) → 400 |

400s come from the existing `handleMethodArgumentNotValid`. Body: problem+json, `detail` = sorted `field: message` pairs.

## Wire-format change

- **Request** (`/compare` and `/compare/stream`): four new **optional** JSON properties, `sightHeightMm`, `shootingAngleDegrees`, `windDirectionDeg`, `dragModel`. **Response:** unchanged schema.
- **Backwards compatible.** Clients that omit the four fields get exactly today's results (38.1 mm, 0°, 90°, G1).
- **Behaviour change** (non-breaking schema, but visible):
  - Clients that already *sent* these fields, the bundled frontend included, now get results that honour them.
  - Clients that sent **out-of-range** values used to get 200 (values ignored) and now get **400**.
  - Strictly, that is tightened validation. It's accepted as part of the bug fix: those requests were computing something other than what they asked for. Record it in `contracts/CHANGELOG.md` as "Wire: behaviour fix; out-of-range values for the 4 fields now 400".
- Rate-limit tier (`COMPARE`) and SSE event format are unchanged.

## Cache key

No change to the key definition (`{#bullet, #req}`, whole records). Because `TrajectoryRequest` normalizes `null` to the defaults, these three produce **equal** `TrajectoryRequest` records and share one cache entry:
1. A compare request that omits the four fields.
2. A compare request that sends them explicitly at their default values.
3. A direct `POST /api/trajectories/{id}` with the same values.

## Known UX side effect (not fixed here)

When `/compare/stream` and `/compare` both return 400, `runSimulation()` treats it as a network failure and drops into client-side compute with the **OFFLINE** pill. This failure mode already exists for `temperatureC` outside −50…60. This fix extends it to angle > 45 or sight height > 150 typed into the sidebar (HTML `min`/`max` isn't enforced on typed input). Suggested follow-up FE task: on a 4xx from the server, show the problem `detail` instead of going offline. Not required for BE-3.

## Docs follow-up (builder)

- Update the `CompareRequest` record Javadoc.
- The comment in `trajectory-service.md` §"Model mapping methods" (`(…, null, null, null, null)`) is now out of date. The architect will update it in a follow-up contract change, since builders don't edit `contracts/`.

## Acceptance checklist

- [ ] **Parity:** for a catalog id `X`, `POST /api/trajectories/compare` with `bulletIds:[X]`, `dragModel:"G7"`, `shootingAngleDegrees:10` (other fields equal) returns a `points` array **equal** to `POST /api/trajectories/X` with the same values. Assert on the full point list, not one value.
- [ ] Same parity for `/compare/stream`: the single SSE event equals the direct-endpoint result.
- [ ] Parity also holds for `sightHeightMm:50` and `windDirectionDeg:270` (each one alone).
- [ ] **No regression:** a compare request that omits all four fields returns results identical to the pre-change response for the same input (capture a golden response before the change, or compare against explicit `38.1 / 0 / 90 / "G1"`).
- [ ] Explicit defaults (`38.1, 0, 90, "G1"`) and omitted fields hit the **same cache entry** (`GET /api/cache/stats` hit count rises; engine invoked once).
- [ ] `G7` vs `G1` with everything else equal gives different `dropCm` at max range. This proves the field is honoured, not just accepted.
- [ ] 400 for `shootingAngleDegrees: 46`, `windDirectionDeg: 361`, `windDirectionDeg: -1`, `sightHeightMm: 151`, `dragModel: "G8"`, `dragModel: "g7"`, on both `/compare` and `/compare/stream`.
- [ ] `sightHeightMm: 0` → 200, computed with 38.1 (same as the direct endpoint).
- [ ] `ValidationTest` has cases for each new constraint. `TrajectoryServiceUnitTest` call sites are updated to 11 arguments. No 7-argument constructor exists.
- [ ] Unit test: `toTrajectoryRequest("x")` with all four `null` equals `new TrajectoryRequest("x", …, null, null, null, null)`. With values set, each value reaches the matching `TrajectoryRequest` component.
- [ ] Existing `BallisticsControllerTest`, `ContractTest`, and the frontend Jest suite pass unchanged. JaCoCo stays ≥ 90 %.
