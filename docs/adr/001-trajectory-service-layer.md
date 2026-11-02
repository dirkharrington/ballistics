# ADR 001 — Introduce a `TrajectoryService` layer; keep the result cache on the engine with a whole-record key

Status: Proposed — 2026-11-01
Design: [`trajectory-service-refactor.md`](../architecture/trajectory-service-refactor.md) §A
Contract: [`contracts/trajectory-service.md`](../../contracts/trajectory-service.md)

## Context

`BallisticsController` (4 methods) and `BatchController` (1 method) each resolve bullets from the catalog, build a `TrajectoryRequest`, and call `BallisticsEngine.compute`. Three of them also repeat `CompletableFuture.supplyAsync(..., compareExecutor)`. Controllers therefore own HTTP, rate limiting, domain lookup, request normalisation, and concurrency.

The duplication has already caused bugs:
- `@Cacheable` keys on `#req.bulletId()`, and every custom load uses `"custom"`. Different custom loads with the same sim params collide: wrong physics, and the other user's load name.
- A null `bulletId` reaches `Map.get(null)` on an immutable map and returns 500. The check exists in some paths but not others.

Constraints: controllers stay the routing and rate-limit layer. The cache key must be correct for custom bullets. Engine output must not change.

## Options considered

**A. Keep controllers; extract a private helper per controller.** Smallest change. Logic is still split across two controllers, the executor is still injected into both, and controller tests still need the engine and catalog. Rejected: it fixes nothing structural.

**B. Service layer, `@Cacheable` on service methods.** The cache policy sits next to the orchestration. But each public method has a different input shape (`String id + request`, `CustomBulletRequest`, `CompareRequest`), so each needs its own key SpEL. Worse, `compare`/`batch` fan-out would call the cached method on `this` and **skip the Spring proxy (self-invocation)**, losing caching on exactly the expensive paths. The workarounds (self-injection, `AopContext`, splitting out a second bean) add indirection. Rejected.

**C. Service layer; `@Cacheable` stays on `BallisticsEngine.compute(Bullet, TrajectoryRequest)` with key `{#bullet, #req}`.** The cache wraps the pure function at its exact input boundary. Record value equality covers every field, now and in future. The service reaches the engine through the proxy from any thread. Chosen.

**D. Service layer; programmatic `Cache.get(key, loader)` in the service.** Explicit, no proxy, and stampede-safe. But it adds a second caching style to a codebase that uses annotations, and holding a Caffeine compute lock for a multi-millisecond integration blocks other keys in the same bin. Rejected for now. It's the path to take if stampede protection becomes a goal.

## Decision

Option C.
- `TrajectoryService` owns bullet resolution, request normalisation (through mapping methods on the model records), fan-out on the renamed `trajectoryExecutor`, deduplication of compare ids, unwrapping of `CompletionException`, and the typed `UnknownBulletException`.
- Controllers keep only the mapping, `@Valid`, `@RateLimited`, and SSE emitter wiring.
- `BallisticsEngine` keeps `@Cacheable`, with key `{ #bullet, #req }`.

## Consequences

- **Positive:**
  - The custom-bullet collision is fixed by construction. New fields on `Bullet` or `TrajectoryRequest` join the key automatically.
  - One place for bullet validation, so null ids return 400 everywhere.
  - Controllers can be tested with a mocked service. The service can be tested with a mocked engine and a same-thread executor.
  - Only the service depends on the executor.
- **Negative:**
  - One more class and one more indirection.
  - The cache policy stays on the engine. Unit tests that do `new BallisticsEngine(...)` don't exercise caching, so cache behaviour must be tested through the Spring context (already true).
- **Neutral:**
  - User-chosen custom values (including `name`) now create distinct cache entries. The pollution risk is bounded by the 500-entry cap, W-TinyLFU admission, rate limiting `/custom`, and the proposed name-length cap (Threat model R3).
- **Follow-ups:** if traffic shows duplicate concurrent misses, revisit option D or `@Cacheable(sync = true)` with an async Caffeine cache.
