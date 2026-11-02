# Contract: `@Cacheable` key fix (BE-R3)

Version: 1.0.0 — 2026-11-01
Owner of the implementation: backend builder. devsecops reviews it.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Deviations from the original brief

| Brief | Contract | Reason |
|---|---|---|
| `key = "#bullet.id()"` — key on the `id()` accessor alone | Key on all physics-relevant fields: `{ #bullet.id(), #bullet.bulletWeightGrams(), #bullet.muzzleVelocityMps(), #bullet.ballisticCoefficient(), #bullet.bulletDiameterMm(), #req }` | `Bullet.id()` is the catalog key; it is stable for catalog bullets. But `computeCustom` routes through the same engine with `id = "custom"` for every distinct custom load. Keying on `id()` alone would collapse all custom loads onto a single cache entry. Including the four physics fields preserves correct cache behaviour for custom loads and is unchanged for catalog loads (where id is already unique) |

## Bullet record fields

From `com.ballistics.model.Bullet`:

```java
public record Bullet(
    String id,
    String name,           // ← display-only; bust excluded
    String caliber,        // ← display-only; bust excluded
    double bulletWeightGrams,
    double muzzleVelocityMps,
    double ballisticCoefficient,
    double bulletDiameterMm,
    double muzzleEnergyJoules, // ← derived; excluded (it's 0.5*m*v² — redundant with weightGrams + muzzleVelocityMps)
    String description,    // ← display-only; bust excluded
    String hexColor        // ← display-only; bust excluded
)
```

Physics-relevant fields (determine trajectory outcome):
- `id` — stable catalog key; identifies the physics configuration for catalog bullets
- `bulletWeightGrams` — affects sectional density and energy
- `muzzleVelocityMps` — initial condition for the integrator
- `ballisticCoefficient` — drag scaling factor
- `bulletDiameterMm` — affects sectional density calculation

Excluded from the key:
- `name`, `caliber`, `description`, `hexColor` — display-only; renaming these must not bust the cache
- `muzzleEnergyJoules` — derived field (`0.5 * (weightG / 1000) * mv²`); including it would be redundant

## One-line change

In `BallisticsEngine.compute()` line 85, replace:

```java
@Cacheable(value = "trajectories", key = "{ #bullet, #req }")
```

with:

```java
@Cacheable(value = "trajectories",
           key = "{ #bullet.id(), #bullet.bulletWeightGrams(), #bullet.muzzleVelocityMps(), #bullet.ballisticCoefficient(), #bullet.bulletDiameterMm(), #req }")
```

No other changes to `BallisticsEngine` or any other file.

## Impact on `TrajectoryService` contract

The `trajectory-service.md` contract (§Cache key) documents the key as `"{ #bullet, #req }"` and notes  
that equality is record value equality over **all** components. This contract supersedes that note.  
The `trajectory-service.md` should be updated in a follow-up to reflect the narrower key, but the  
behaviour contract (cache hit for identical physics, cache miss when physics differ) is unchanged.

## Acceptance checklist

- [ ] One-line change only: the `@Cacheable` annotation on `compute()`; no other file changes.
- [ ] Cache hit test: create two `Bullet` instances with the same `id`, `bulletWeightGrams`, `muzzleVelocityMps`, `ballisticCoefficient`, `bulletDiameterMm` but **different** `name` and `hexColor`; call `compute()` twice with the same `TrajectoryRequest`; assert the engine runs exactly once (verify via `MeterRegistry` timer count or a Mockito spy on the engine).
- [ ] Cache miss test: same `id` and display fields, different `bulletWeightGrams`; assert the engine runs twice.
- [ ] Cache miss test for custom loads: two calls with `id = "custom"` but different `muzzleVelocityMps`; assert the engine runs twice.
- [ ] All existing `BallisticsControllerTest`, `BatchControllerTest`, `ContractTest`, and `ValidationTest` pass without modification.
- [ ] JaCoCo coverage stays ≥ 90 % instruction and branch.
