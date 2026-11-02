# BE-IDIOMS: Java 21 / Spring Boot 4 Modernization

Three targeted improvements. Each is independent and affects a single class.
All have real behavioral or testability impact; no cosmetic-only changes.

---

## BE-IDIOMS-1 — Constructor injection in `WebConfig`

**File**: `src/main/java/com/ballistics/config/WebConfig.java`

### Current (field injection)
```java
@Value("${app.cors.allowed-origins}")
private String[] allowedOrigins;

@Autowired
private RateLimitInterceptor rateLimitInterceptor;
```

### Target (constructor injection)
```java
private final String[] allowedOrigins;
private final RateLimitInterceptor rateLimitInterceptor;

public WebConfig(
        @Value("${app.cors.allowed-origins}") String[] allowedOrigins,
        RateLimitInterceptor rateLimitInterceptor) {
    this.allowedOrigins = allowedOrigins;
    this.rateLimitInterceptor = rateLimitInterceptor;
}
```

Remove the `@Autowired` import. Remove the `@Value` import only if it is unused
after the change (it is still used in the constructor `@Value`).

**Why**: Field injection bypasses the compiler's nullability guarantees and makes
`WebConfig` impossible to instantiate in unit tests without a Spring context.
Constructor injection makes both dependencies explicit and `final`.

**Test impact**: Existing tests that use `@SpringBootTest` continue to work.
If `WebConfig` has no dedicated unit test, none is needed (Spring wires it).
JaCoCo excludes nothing here; the constructor must be exercised by an
`@SpringBootTest`-level test that already exists.

---

## BE-IDIOMS-2 — Constructor injection in `BallisticsController`

**File**: `src/main/java/com/ballistics/controller/BallisticsController.java`

### Current
```java
@Value("${app.sse.timeout-ms:30000}")
private long sseTimeoutMs;

public BallisticsController(TrajectoryService trajectoryService) {
    this.trajectoryService = trajectoryService;
}
```

### Target
```java
private final long sseTimeoutMs;

public BallisticsController(
        TrajectoryService trajectoryService,
        @Value("${app.sse.timeout-ms:30000}") long sseTimeoutMs) {
    this.trajectoryService = trajectoryService;
    this.sseTimeoutMs = sseTimeoutMs;
}
```

Make `sseTimeoutMs` `final`. Remove the `@Value` field annotation.

**Why**: Same reasoning as BE-IDIOMS-1. The field was the only mutable state in an
otherwise constructor-injected bean. Making it `final` is safer under virtual threads.

**Test impact**: `BallisticsController` is excluded from JaCoCo coverage
(`BallisticsController.class` in the `<excludes>` block) because its SSE lambda
branches require a live client disconnect. No new tests are required.
Existing `@SpringBootTest` tests wire the controller normally.

---

## BE-IDIOMS-3 — `Duration`-based Caffeine configuration in `CacheConfig`

**File**: `src/main/java/com/ballistics/config/CacheConfig.java`

### Current
```java
Caffeine.newBuilder()
    .maximumSize(500)
    .expireAfterWrite(5, TimeUnit.MINUTES)
    .recordStats()
```

### Target
```java
import java.time.Duration;

Caffeine.newBuilder()
    .maximumSize(500)
    .expireAfterWrite(Duration.ofMinutes(5))
    .recordStats()
```

Remove the `java.util.concurrent.TimeUnit` import if it becomes unused after
the change.

**Why**: `Duration`-based Caffeine API (`expireAfterWrite(Duration)`) was added in
Caffeine 3.x and is consistent with how every other timeout in this codebase is
expressed (see `RateLimitProperties`, `HttpLimitsProperties`, `WebConfig`). The
`(long, TimeUnit)` overload is kept for backwards compatibility but is less readable.

**Behavioral change**: None. `Duration.ofMinutes(5)` is identical to
`TimeUnit.MINUTES, 5` at runtime.

**Test impact**: `CacheConfig` is not independently tested; it is covered via
`TrajectoryCacheTest` through `@SpringBootTest`. No test changes needed.

---

## BE-IDIOMS-4 — CPU-aware executor pool sizing in `ExecutorConfig`

**File**: `src/main/java/com/ballistics/config/ExecutorConfig.java`

### Current
```java
return new ThreadPoolExecutor(
    4, 8,
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(100),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

### Target
```java
int cpus = Runtime.getRuntime().availableProcessors();
return new ThreadPoolExecutor(
    cpus, cpus * 2,
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(100),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

**Why**: Trajectory computation is CPU-bound (RK4 integration — no IO, no
blocking). The optimal core pool size is the number of available processors, not
a hardcoded 4. On a 2-CPU CI runner the pool is oversized; on a 16-CPU prod
instance it is severely undersized (8 max threads vs 16 CPUs). Tying to
`availableProcessors()` makes the executor self-calibrate.

**Why NOT virtual threads**: `spring.threads.virtual.enabled=true` already puts
Tomcat on virtual threads. The `trajectoryExecutor` must remain a bounded
`ThreadPoolExecutor` for CPU-bound work: virtual threads share carrier threads
and do not add parallelism beyond CPU count; an unbounded virtual-thread executor
for CPU-bound tasks would create unnecessary contention and scheduler overhead.

**Behavioral change**: On the development machine and CI runner, pool sizes change.
The `CallerRunsPolicy` backpressure is unaffected (queue is still 100-deep).

**`destroyMethod`**: Keep `"shutdown"` (graceful drain). Do not change to
`"shutdownNow"` — in-flight trajectory computations should complete.

**Test impact**: No existing test asserts the pool size. No new test is needed
(the executor behavior is covered transitively by `TrajectoryServiceUnitTest` and
the compare/batch integration tests).

---

## Constraints

- 100% JaCoCo branch/instruction coverage on all non-excluded classes must be
  maintained after each change. Run `mvn verify -Dskip.npm.test=true` to confirm.
- No new Spring Boot or Caffeine API is introduced; these are all within the
  existing dependency set.
- All four changes are independent and can be applied in any order or by different
  builders if desired.

## Acceptance checklist

- [ ] `WebConfig`: no `@Autowired` field, no `@Value` field; constructor accepts both parameters; fields are `final`
- [ ] `BallisticsController`: no `@Value` field; `sseTimeoutMs` is `final`; constructor accepts `@Value` parameter
- [ ] `CacheConfig`: `expireAfterWrite(Duration.ofMinutes(5))` instead of `(5, TimeUnit.MINUTES)`; `TimeUnit` import removed if unused
- [ ] `ExecutorConfig`: core = `availableProcessors()`, max = `availableProcessors() * 2`
- [ ] `mvn verify -Dskip.npm.test=true` → BUILD SUCCESS, JaCoCo check passes
- [ ] `mvn verify` → full test suite passes including `npm test`
