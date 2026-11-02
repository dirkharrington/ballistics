# Contract: `TrajectoryService`

Version: 1.0.0 — 2026-11-01
Design: [`docs/architecture/trajectory-service-refactor.md`](../docs/architecture/trajectory-service-refactor.md) §A, §D
Decision: [ADR 001](../docs/adr/001-trajectory-service-layer.md)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Package and wiring

```java
package com.ballistics.service;

@Service
public class TrajectoryService {
    public TrajectoryService(BallisticsEngine engine,
                             Map<String, Bullet> bulletCatalog,                          // bean "bulletCatalogMap"
                             @Qualifier("trajectoryExecutor") ExecutorService executor);  // renamed from compareExecutor
}
```

- The service is stateless and thread-safe. All fields are `final`.
- No `jakarta.servlet.*`, `ResponseEntity`, `ProblemDetail`, `SseEmitter`, or Bucket4j types appear in the service.
- It always calls `engine.compute(...)` through the injected proxy, so caching applies on every path, including executor threads.

## Method signatures

```java
/** Catalog bullets in catalog order. Unmodifiable. */
List<Bullet> listBullets();

/**
 * Single catalog trajectory.
 * bulletId overrides request.bulletId(): request is normalised with request.withBulletId(bulletId).
 * Legacy POST /api/trajectory passes request.bulletId(). POST /api/trajectories/{id} passes the path variable.
 * @throws UnknownBulletException if bulletId is null, blank, or not in the catalog
 */
TrajectoryResult compute(String bulletId, TrajectoryRequest request);

/**
 * Custom (user-defined) load. Runs on the caller thread.
 * Bullet: request.toBullet(). Request: request.toTrajectoryRequest().
 * Never throws UnknownBulletException.
 */
TrajectoryResult computeCustom(CustomBulletRequest request);

/**
 * Fan-out compare, blocking. Equivalent to joining every future from compareAsync(request) in order.
 * Unknown ids are silently dropped (current documented behaviour).
 * Each distinct id is computed once. Duplicate input ids reuse that result, so the response
 * keeps input order and duplicates exactly as today.
 * @return empty list if no id is known
 */
List<TrajectoryResult> compare(CompareRequest request);

/**
 * Fan-out compare, non-blocking. For the SSE endpoint.
 * One future per known input id, in input order. Duplicate ids share the same future instance.
 * Futures run on trajectoryExecutor.
 * @return empty list if no id is known (the controller then completes the emitter immediately)
 */
List<CompletableFuture<TrajectoryResult>> compareAsync(CompareRequest request);

/**
 * Batch, blocking. Validates every item's bulletId BEFORE scheduling any work.
 * Results come back in input order.
 * @throws UnknownBulletException for the first unknown, null, or blank bulletId in input order
 */
List<TrajectoryResult> batch(BatchRequest request);
```

### Model mapping methods (on the records, `com.ballistics.model`)

```java
// TrajectoryRequest
TrajectoryRequest withBulletId(String bulletId);    // copy with bulletId replaced; all other components unchanged

// CompareRequest
TrajectoryRequest toTrajectoryRequest(String bulletId);
    // (bulletId, zero, max, step, wind, alt, temp, null, null, null, null). Compact-constructor defaults apply.

// CustomBulletRequest
Bullet toBullet();
    // ("custom", name, "Custom", weightG, mvMps, bc, diameterMm,
    //  0.5 * (weightG / 1000.0) * mvMps * mvMps, "User-defined custom load", "#00d4ff")
TrajectoryRequest toTrajectoryRequest();
    // ("custom", zero, max, step, wind, alt, temp, null /*sight→38.1*/, angle, windDir, dragModel)
```

These must produce values **bit-identical** to the inline construction in today's controllers. Cache-key stability depends on it.

## Cache key

`@Cacheable` stays on `BallisticsEngine.compute(Bullet bullet, TrajectoryRequest req)`:

```java
@Cacheable(value = "trajectories", key = "{ #bullet, #req }")
```

| Caller | `#bullet` | `#req` | Distinct entries differ by |
|---|---|---|---|
| Catalog (`compute`, `compare*`, `batch`) | Shared catalog singleton for the id | Normalised request, `bulletId` = catalog id | Catalog id plus any of the 11 request components |
| Custom (`computeCustom`) | New `Bullet` record, `id = "custom"` | Normalised request, `bulletId = "custom"` | Any of weight, MV, BC, diameter, derived energy, **name**, plus any of the 11 request components |

- Equality is record value equality over **all** components of both records. Never list fields by hand in the key.
- The key holds no extra memory: the cached `TrajectoryResult` already references both records.
- Cache name, size (500), TTL (5 min), and `recordStats()` don't change. `GET /api/cache/stats` doesn't change.

## Exceptions

| Thrown by the service | When | Handled by | HTTP result |
|---|---|---|---|
| `UnknownBulletException extends RuntimeException` (field `String bulletId`) | `compute`/`batch`: bulletId null, blank, or not in the catalog | `GlobalExceptionHandler` `@ExceptionHandler` | 400 `application/problem+json`, `detail = "Unknown bullet ID: " + truncate(bulletId, 64)` (`null` shown as `null`) |
| Engine `RuntimeException` (unexpected) | Any | Propagates unchanged. The service unwraps `CompletionException`/`ExecutionException` and rethrows the cause, so callers never see the wrapper | 500 (Spring default ProblemDetail) |

Not thrown by the service, and handled in the web layer:

| Concern | Owner |
|---|---|
| Bean Validation (`@Valid`) failures | Spring MVC, then the existing `handleMethodArgumentNotValid` (400) |
| Rate limiting (429) | `RateLimitInterceptor`. See [`rate-limit-config.md`](rate-limit-config.md) |
| SSE emitter lifecycle, `IOException` on send | `BallisticsController.compareStream` (logic unchanged; only the futures source changes) |

## Controller shape after refactor (pseudocode)

```java
@RateLimited(RateLimitTier.SINGLE)
@PostMapping("/trajectories/{bulletId}")
TrajectoryResult byId(@PathVariable String bulletId, @Valid @RequestBody TrajectoryRequest r) {
    return trajectoryService.compute(bulletId, r);
}
```

Controllers depend only on `TrajectoryService` (and on `@Value app.sse.timeout-ms` for the SSE controller).

## Acceptance checklist

- [ ] No controller references `BallisticsEngine`, `Map<String, Bullet>`, `ExecutorService`, or `Bucket`.
- [ ] Null `bulletId` on `/api/trajectory` and on a batch item returns 400 (was 500).
- [ ] `compare` with `["a","a","b"]` calls the engine exactly twice and returns 3 results in input order.
- [ ] `compare` with more than 20 ids returns 400.
- [ ] `CustomBulletRequest.name` longer than 64 characters returns 400.
- [ ] The custom-collision regression tests (BE-2) pass through the Spring proxy.
- [ ] Existing `BallisticsControllerTest`, `BatchControllerTest`, `ContractTest`, and `ValidationTest` pass without changes to expected bodies.
