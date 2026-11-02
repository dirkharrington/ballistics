# Contract: `simulateY()` RK4 stepper dedup (BE-R2)

Version: 1.0.0 — 2026-11-01
Owner of the implementation: backend builder. devsecops reviews it.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Deviations from the original brief

None.

## Problem

`simulateY()` (lines 251–275) and `compute()` (lines 117–187) both contain independent copies of the same RK4 loop body.  
If `DT_SECONDS`, `MIN_VELOCITY_FPS`, or the RK4 coefficients change, both copies must be updated.

## Coordination with BE-R1

BE-R1 extracts `integrateTrajectory()` from `compute()`.  
`integrateToX` (defined here) is the **shared primitive** that:
- `integrateTrajectory()` calls to advance the state by one `DT_SECONDS` step across the full trajectory.
- `simulateY()` calls to advance the state until `x >= targetX`, returning the final `y`.

**Implementation order:** BE-R2 must be implemented before or alongside BE-R1.  
`integrateToX` is the leaf; `integrateTrajectory` and the zero-angle bisection are callers.

## `integrateToX` — the shared RK4 primitive

### Signature

```java
/**
 * Advances a ballistic state vector by one DT_SECONDS RK4 step.
 *
 * @param state  mutable double[4] = { vx, vy, x, y }; updated in place
 * @param bc     ballistic coefficient
 * @param airDensityRatio  pre-computed air density ratio for this trajectory
 * @param dragVelocities   drag-table velocity breakpoints (imperial fps)
 * @param dragCoeffs       drag-table coefficients
 */
private void integrateToX(double[] state, double bc, double airDensityRatio,
                           double[] dragVelocities, double[] dragCoeffs)
```

`state` layout: `state[0] = vx`, `state[1] = vy`, `state[2] = x`, `state[3] = y`.

After the call:
- `state[0]` += RK4-weighted Δvx
- `state[1]` += RK4-weighted Δvy
- `state[2]` += `vx_new * DT_SECONDS`
- `state[3]` += `vy_new * DT_SECONDS`

where `vx_new` and `vy_new` are the post-update velocity components (i.e. `state[0]` and `state[1]` after the RK4 update — same as the current loop body).

### RK4 step (verbatim from current `compute()` loop, lines 172–184)

```java
double vx = state[0], vy = state[1];
double velocity = Math.hypot(vx, vy);
derivatives(vx, vy, velocity, bc, airDensityRatio, dragVelocities, dragCoeffs, k1);
double vx2 = vx + 0.5*dt*k1[0], vy2 = vy + 0.5*dt*k1[1];
derivatives(vx2, vy2, Math.hypot(vx2, vy2), bc, airDensityRatio, dragVelocities, dragCoeffs, k2);
double vx3 = vx + 0.5*dt*k2[0], vy3 = vy + 0.5*dt*k2[1];
derivatives(vx3, vy3, Math.hypot(vx3, vy3), bc, airDensityRatio, dragVelocities, dragCoeffs, k3);
double vx4 = vx + dt*k3[0],     vy4 = vy + dt*k3[1];
derivatives(vx4, vy4, Math.hypot(vx4, vy4), bc, airDensityRatio, dragVelocities, dragCoeffs, k4);
state[0] += (dt / 6.0) * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0]);
state[1] += (dt / 6.0) * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]);
state[2] += state[0] * dt;
state[3] += state[1] * dt;
```

`dt = DT_SECONDS` (the class constant). `k1`–`k4` are method-local `double[2]` scratch arrays, allocated once per `integrateToX` call (not per loop iteration in the callers).

### Allocation

`k1`–`k4` are allocated inside `integrateToX`, not passed in. This keeps the signature clean.  
The allocation is one call per RK4 step (4 × `new double[2]`); the hot path is identical in practice  
because the current code allocates them per loop iteration in `simulateY()`.

## Refactored callers

### `simulateY()` after refactor

```java
private double simulateY(double mvFps, double bc, double anglRad,
                          double targetX, double airDensityRatio,
                          double[] dragVelocities, double[] dragCoeffs) {
    double[] state = {
        mvFps * Math.cos(anglRad),   // vx
        mvFps * Math.sin(anglRad),   // vy
        0.0,                         // x
        0.0                          // y
    };
    while (state[2] < targetX) {
        if (Math.hypot(state[0], state[1]) < 50) break;
        integrateToX(state, bc, airDensityRatio, dragVelocities, dragCoeffs);
    }
    return state[3];
}
```

The `MIN_VELOCITY_FPS` sentinel in the full loop is 100 fps; `simulateY` used 50 fps.  
**Keep 50 fps** in the `simulateY` caller to preserve current behaviour.  
`integrateToX` does not enforce a minimum — the caller checks before each call.

### `integrateTrajectory()` (BE-R1) after refactor

The full trajectory loop replaces its inline RK4 body with a call to `integrateToX(state, …)`, checking  
`Math.hypot(state[0], state[1]) < MIN_VELOCITY_FPS` as the exit condition.  
The `x`, `y`, `t` variables move into the `state` array (`t` stays local — it is not part of the state vector  
but advances by `DT_SECONDS` each step).

## Acceptance checklist

- [ ] `integrateToX` is a private method; it does not appear in the public API.
- [ ] `simulateY` body is ≤ 8 lines (loop + velocity check + one `integrateToX` call).
- [ ] `DT_SECONDS` appears exactly **once** in `BallisticsEngine` (in `integrateToX`); no other method uses the constant directly.
- [ ] All existing `BallisticsControllerTest`, `BatchControllerTest`, `ContractTest`, and `ValidationTest` pass without modification.
- [ ] No behaviour change: for every tested bullet/request pair, trajectory output is bit-identical before and after the refactor.
- [ ] JaCoCo coverage stays ≥ 90 % instruction and branch.
