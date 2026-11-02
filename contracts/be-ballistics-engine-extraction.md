# Contract: `BallisticsEngine.compute()` extraction (BE-R1)

Version: 1.0.0 — 2026-11-01
Owner of the implementation: backend builder. devsecops reviews it.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Deviations from the original brief

None.

## Problem

`BallisticsEngine.compute()` (lines 86–205) is a 120-line monolith.  
It mixes unit conversion, zero-angle bisection setup, 56-line RK4 inner loop, output-point collection,  
MOA/MRAD calculation, metrics recording, and logging — all in one method.  
Physics is not testable in isolation without invoking the full `compute()` path.

## Package

All changes stay in `com.ballistics.service.BallisticsEngine`.  
No new classes or files are introduced by this contract.

## Three extracted private methods

### 1. `convertInputs`

```java
/**
 * Converts SI inputs to the internal imperial representation used by the integrator.
 * Pure function; no side effects.
 */
private ConvertedInputs convertInputs(Bullet bullet, TrajectoryRequest req)
```

Return type — a private inner record or static final inner class (immutable):

```java
private record ConvertedInputs(
    double mvFps,
    double weightLbs,
    double bc,
    double crosswindMph,
    double airDensityRatio,
    double zeroFt,
    double maxRangeYd,
    double stepYd,
    double sightHeightFt,
    double cosAngle,
    double launchAngleRad,
    double tanLaunchAngle,
    double[] dragVelocities,   // alias to instance array — not copied
    double[] dragCoeffs        // alias to instance array — not copied
) {}
```

- `airDensityRatio` is computed inside `convertInputs` via the existing `airDensityRatio(altFt, tempF)` helper.
- `launchAngleRad` is computed inside `convertInputs` via the existing `findZeroAngle(...)` helper.
- `tanLaunchAngle` is derived from `launchAngleRad`.
- `dragVelocities` / `dragCoeffs` are set from the instance fields (`g1Velocities` / `g7Velocities`, etc.) based on `req.dragModel()`.

### 2. `integrateTrajectory`

```java
/**
 * Runs the RK4 integrator from x=0 to maxRangeYd and returns the sampled trajectory points
 * plus summary statistics. No unit conversion: all inputs and outputs are imperial.
 *
 * Calls integrateToX (see BE-R2) for each RK4 step — integrateToX is the shared primitive.
 */
private IntegrationResult integrateTrajectory(ConvertedInputs ci)
```

Return type:

```java
private record IntegrationResult(
    List<TrajectoryPoint> points,
    double maxOrdinateIn,
    double maxOrdinateRangeYd,
    double supersonicLimitYd
) {}
```

- The full RK4 loop currently in `compute()` (lines 117–187) moves into this method.
- `integrateTrajectory` calls `integrateToX` (defined by BE-R2) for the per-step advance.  
  See BE-R2 contract for the exact signature. Both contracts must be implemented together or in order BE-R2 → BE-R1.
- Output-point construction (including `windDriftIn`, MOA/MRAD calculation, and `r1(...)` rounding) stays inside this method.

### 3. `buildOutputPoints`

**Note:** After reading the source, the output-point construction is interleaved with the integration loop (each point is built at the sample moment, not post-hoc). Extracting it as a separate method would require collecting raw state vectors mid-loop and re-processing them — this would change the data flow without improving testability and would risk floating-point divergence.

**Deviation from brief:** `buildOutputPoints` is **not** extracted as a separate method. Its logic remains inside `integrateTrajectory` where it can access loop-local state without overhead or behaviour change. The brief named it as a candidate; this contract overrides that with the safer approach. Flag for user approval.

| Brief | Contract | Reason |
|---|---|---|
| Extract `buildOutputPoints(...)` as a third private method | Not extracted; point construction stays inside `integrateTrajectory` | Point construction reads `vx`, `vy`, `x`, `y`, `t`, `velocity` as loop-local variables. Extracting it would require either passing all six as parameters on every sample, or collecting a parallel list of state vectors — both approaches add overhead and introduce divergence risk with no testability gain. The two genuinely independent phases are `convertInputs` and `integrateTrajectory` |

## Refactored `compute()`

After extraction, `compute()` becomes an orchestrator:

```java
@Cacheable(value = "trajectories", key = "{ #bullet, #req }")
public TrajectoryResult compute(Bullet bullet, TrajectoryRequest req) {
    long start = System.nanoTime();

    ConvertedInputs  ci     = convertInputs(bullet, req);
    IntegrationResult result = integrateTrajectory(ci);

    TrajectoryResult output = new TrajectoryResult(
        bullet, req, result.points(),
        r1(result.maxOrdinateIn()      * CM_PER_INCH),
        r1(result.maxOrdinateRangeYd() * M_PER_YARD),
        r1(result.supersonicLimitYd()  * M_PER_YARD)
    );

    meterRegistry.timer("ballistics.compute", "bullet", bullet.id())
        .record(System.nanoTime() - start, java.util.concurrent.TimeUnit.NANOSECONDS);

    log.info("trajectory computed bullet={} rangeM={} durationMs={}",
        bullet.id(), req.maxRangeMeters(),
        (System.nanoTime() - start) / 1_000_000);

    return output;
}
```

Public signature and `@Cacheable` annotation are **unchanged**.

## Unit tests

New tests may use `new BallisticsEngine(tables, meterRegistry)` — no Spring context needed.  
`PhysicsTables` and `MeterRegistry` are injected; use a real `PhysicsTables` bean (loaded from `bullets.yaml`)  
and `SimpleMeterRegistry` for tests.

| Method | Test scenario |
|---|---|
| `convertInputs` | Known bullet + request → assert `mvFps`, `launchAngleRad`, `airDensityRatio` within 0.01% of hand-calculated values |
| `convertInputs` | G7 drag model → `dragVelocities` alias points to `g7Velocities` instance field |
| `integrateTrajectory` | Known pre-converted inputs → assert first and last `TrajectoryPoint` values match `compute()` output for the same bullet/request |
| `integrateTrajectory` | `supersonicLimitYd` is ≤ `maxRangeYd` and > 0 for a supersonic load |

## JaCoCo

JaCoCo instruction and branch coverage stays ≥ 90 % after the refactor.  
The new tests for `convertInputs` and `integrateTrajectory` are expected to cover branches  
(G1/G7 selection, supersonic-logged flag) that were previously reached only via integration tests.

## Acceptance checklist

- [ ] `compute()` public signature and `@Cacheable` annotation are unchanged.
- [ ] `convertInputs(Bullet, TrajectoryRequest)` is a private method; calling it with the same inputs twice returns equal `ConvertedInputs` values.
- [ ] `integrateTrajectory(ConvertedInputs)` is a private method; it calls `integrateToX` for each RK4 step.
- [ ] `compute()` body is ≤ 15 lines (orchestrator only).
- [ ] All existing `BallisticsControllerTest`, `BatchControllerTest`, `ContractTest`, and `ValidationTest` pass without modification.
- [ ] New unit tests for `convertInputs` and `integrateTrajectory` pass without a Spring context.
- [ ] JaCoCo coverage stays ≥ 90 % instruction and branch.
- [ ] No behaviour change: for every tested bullet/request pair, `compute()` output is bit-identical before and after the refactor.
