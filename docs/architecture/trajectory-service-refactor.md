# Trajectory service refactor

Status: Proposed — 2026-11-01
Related: [ADR 001](../adr/001-trajectory-service-layer.md), [ADR 002](../adr/002-per-client-rate-limiting.md)
Contracts: [`trajectory-service.md`](../../contracts/trajectory-service.md), [`rate-limit-config.md`](../../contracts/rate-limit-config.md), [`physics-tables-bean.md`](../../contracts/physics-tables-bean.md)

## Problem

1. **Duplicated orchestration.** Four controller methods repeat "look up bullet, build request, call `engine.compute`". Three of them also repeat the executor fan-out.
2. **Cache collision bug.** `BallisticsEngine.compute` is `@Cacheable` and its key starts with `#req.bulletId()`. Every custom load has the id `"custom"`, so two custom loads with different BC, weight, or velocity but the same sim params get the **same cache entry**. User B gets user A's physics and user A's load name.
3. **Shared rate limits.** The Bucket4j buckets are fields on singleton controllers, so they are shared by the whole process. One client can use up 120/30/10 req/min for everyone. `/api/trajectories/custom` has no rate limit at all.
4. **Hard-coded limits.** The capacities are literals in the code.
5. **Fragile physics bootstrap.** The drag tables load in a `static {}` block. A missing or malformed YAML file throws `ExceptionInInitializerError` and later `NoClassDefFoundError`. Tests can't inject other tables.
6. **Misleading name.** The `compareExecutor` bean also serves batch.

## Goals

- One `TrajectoryService` owns bullet resolution, request normalisation, fan-out, and error typing. Controllers only route.
- The cache key covers every input to the computation, so custom loads can't collide.
- Rate limits apply per client, with a global ceiling that protects the CPU and the executor. Every limit is set from properties.
- `PhysicsTables` is an immutable Spring bean. A bad YAML file stops startup with a readable Spring Boot failure report.
- Engine results stay bit-identical. `CrossValidationTest` and `BallisticsEngineTest` keep their expected values.

## Non-goals

- Distributed or multi-instance rate limiting (see ADR 002, "Consequences").
- Cache stampede protection (`sync = true` or an async cache). Identical requests that miss the cache at the same moment still each compute, as they do today.
- Changing the physics, the drag tables, or the YAML schema. The JS client reads `physics-tables.yaml` through `virtual:physics-tables`, so the schema is frozen.
- Global request-body size limits (flagged for devsecops, see Threat model R9).

## Current state

```
HTTP ─▶ BallisticsController ──(global Bucket single/compare)──▶ bulletCatalog.get ─▶ BallisticsEngine.compute (@Cacheable key=bulletId+params)
     ─▶ BatchController       ──(global Bucket batch)──────────▶ bulletCatalog.get ─▶ BallisticsEngine.compute
                                  └─ CompletableFuture.supplyAsync(..., compareExecutor)
BallisticsEngine: static { new Yaml().load("/physics-tables.yaml") } → static final double[] G1_*, G7_*, ATM_*
```

## Proposed state

```mermaid
flowchart LR
    Client -->|HTTPS| Proxy[Reverse proxy<br/>appends X-Forwarded-For]
    Proxy -->|HTTP| Valve[Tomcat RemoteIpValve<br/>server.forward-headers-strategy=native]
    Valve --> RLI[RateLimitInterceptor<br/>reads @RateLimited tier]
    RLI --> CKR[ClientKeyResolver<br/>remoteAddr → v4 or v6/64 key]
    RLI --> CRL[ClientRateLimiter<br/>Caffeine&lt;key, ClientBuckets&gt; + 3 global Buckets]
    CRL -.reads.-> RLP[(RateLimitProperties<br/>app.ratelimit.*)]
    RLI -->|allowed| BC[BallisticsController / BatchController<br/>routing only]
    RLI -->|rejected: RateLimitExceededException| GEH[GlobalExceptionHandler<br/>429 problem+json + Retry-After]
    BC --> TS[TrajectoryService]
    TS -->|UnknownBulletException| GEH
    TS --> CAT[(Map&lt;String,Bullet&gt; catalog)]
    TS --> EX[trajectoryExecutor]
    TS --> ENG[BallisticsEngine<br/>@Cacheable key = bullet, req]
    ENG --> CACHE[(Caffeine 'trajectories')]
    ENG --> PT[PhysicsTables bean]
    PTC[PhysicsTablesConfig @Bean] --> PT
    PTC -.parses.-> YAML[(physics-tables.yaml)]
    PTC -->|PhysicsTablesLoadException| FA[PhysicsTablesFailureAnalyzer]
```

| Layer | Owns | Must not |
|---|---|---|
| `RateLimitInterceptor` + `ClientRateLimiter` | Client identity, token buckets, 429 decision | Know about bullets or the engine |
| Controllers | HTTP mapping, `@Valid`, `@RateLimited` tier tag, SSE emitter wiring | Look up bullets, build `TrajectoryRequest`s, touch the executor, hold buckets |
| `TrajectoryService` | Bullet lookup, request normalisation, fan-out on `trajectoryExecutor`, typed exceptions | Touch the servlet API, rate-limit, or build `ResponseEntity`/`ProblemDetail` |
| `BallisticsEngine` | Physics and the result cache boundary | Load files or know about catalogs |
| `PhysicsTables` | Immutable drag tables and atmosphere constants | Hold mutable state |

---

## A. `TrajectoryService`

Contract: [`contracts/trajectory-service.md`](../../contracts/trajectory-service.md).

The service exposes one method per use case (`compute`, `computeCustom`, `compare`, `compareAsync`, `batch`, `listBullets`). Mapping from DTOs to `TrajectoryRequest`/`Bullet` moves onto small methods on the model records (`withBulletId`, `toTrajectoryRequest`, `toBullet`), so the service and the tests share one normalisation path.

### Cache placement and key fix

**Decision:** `@Cacheable` stays on `BallisticsEngine.compute(Bullet, TrajectoryRequest)`. The key becomes the two whole records:

```java
@Cacheable(value = "trajectories", key = "{ #bullet, #req }")
```

Why this works:

- **Right boundary.** `(Bullet, TrajectoryRequest)` is exactly the set of inputs to the pure function, and `TrajectoryResult` embeds both. Keying on both records means the cached value can't contain data the caller didn't send.
- **Value equality for free.** Both are Java records, so `equals`/`hashCode` cover every component. A field added to either record joins the key automatically. Today's hand-listed key would silently go stale.
- **Fixes the bug.** Custom loads now differ in the key by weight, velocity, BC, diameter, energy, and name. The name matters because it is echoed in the result. Without it, user B would see user A's label.
- **Catalog parity.** Catalog `Bullet` instances are shared singletons from `bulletCatalogMap`, so equality is an identity hit, and hit rates for catalog loads don't change.
- **No self-invocation trap.** The service calls the engine through the Spring proxy, including from executor threads, so fan-out paths stay cached. A `@Cacheable` on a service method would be skipped whenever the service calls its own method inside `compare`/`batch` (ADR 001, option B).
- **No extra memory.** The key references objects the cached `TrajectoryResult` already holds.

Requests must be **normalised before** they reach the engine (path id merged, compact-constructor defaults applied). Otherwise logically equal requests get different keys. The service guarantees this.

Cache-pollution risk from user-chosen custom values is covered in the Threat model (R3).

### Behaviour changes (wire-visible)

| Change | Before | After | Breaking? |
|---|---|---|---|
| `bulletId` null/absent on `/api/trajectory` or a batch item | 500 (NPE from `Map.get(null)` on an immutable map) | 400 `Unknown bullet ID: null` | No (bug fix) |
| Echoed bullet id in a 400 `detail` | Full value | Cut to 64 chars | No |
| `/compare` with duplicate ids | N computations | One computation per distinct id. The response still repeats results in input order | No (identical response) |
| `CustomBulletRequest.name` | Unbounded | `@Size(max = 64)` | Technically yes (tighter validation) |
| `CompareRequest.bulletIds` | Unbounded | `@NotEmpty @Size(max = 20)` (same as batch) | Technically yes (tighter validation) |

## B + E. Per-client rate limiting and externalised limits

Contract: [`contracts/rate-limit-config.md`](../../contracts/rate-limit-config.md). Decision record: ADR 002.

### Tiers

| Tier | Endpoints | Per-client (`capacity`) | Global ceiling (`global-capacity`) |
|---|---|---|---|
| `SINGLE` | `POST /api/trajectory`, `POST /api/trajectories/{bulletId}`, `POST /api/trajectories/custom` (**new — was unlimited**) | 120 / min | 1200 / min |
| `COMPARE` | `POST /api/trajectories/compare`, `POST /api/trajectories/compare/stream` | 30 / min | 300 / min |
| `BATCH` | `POST /api/trajectories/batch` | 10 / min | 100 / min |

`GET /api/bullets` and `GET /api/cache/stats` are cheap and stay unlimited. CORS preflights never reach a `HandlerMethod`, so they are never counted.

### Per-client vs global: the tradeoff

| Option | Fairness | Protects CPU/executor | Notes |
|---|---|---|---|
| Global only (today) | None — one client starves everyone | Yes | The bug being fixed |
| Per-client only | Yes | **No.** N clients get N × capacity. IPv6 rotation or a misconfigured proxy trust makes N unbounded | Fails open under distributed load |
| **Per-client + global ceiling** (chosen) | Yes | Yes | Two bucket checks per request (~100 ns) |

**Which number is which.** The existing 120/30/10 values move to `app.ratelimit.<tier>.capacity` (the keys item E names) and mean **per client**. The original code comment says 120 "caps a runaway client at 2 req/s while staying invisible to normal interactive use". The numbers were always sized for one user. The global implementation was the defect. Keeping them per client means no single user sees a stricter limit than today.

The new `global-capacity` keys default to **10× per-client**. That is a placeholder until a load test confirms it (OQ-1). One trajectory takes about a millisecond (see `BallisticsEngineBenchmark`), so 20 single req/s globally is conservative.

**Check order.** The per-client bucket is checked first, then the global one. If the global check rejects, the per-client token is refunded (`addTokens(1)`, capped at capacity). An abusive client is rejected by its own bucket and never takes global tokens beyond its allowance. A well-behaved client isn't charged for a global rejection.

**Invalid requests now count.** The check runs in `HandlerInterceptor.preHandle`, which is before `@RequestBody` binding and `@Valid`. Today a request that fails validation never consumed a token. Afterwards it does. That is intended: it limits floods of malformed requests.

### Client identity behind a reverse proxy

The interceptor does **not** parse `X-Forwarded-For` itself. `server.forward-headers-strategy=native` turns on Tomcat's `RemoteIpValve`, and the valve:

1. Trusts XFF **only if** the TCP peer (`remoteAddr`) matches `server.tomcat.remoteip.internal-proxies`.
2. Walks XFF **right to left** and skips trusted proxy hops. The first untrusted address becomes `request.getRemoteAddr()`.
3. Leaves `remoteAddr` unchanged if XFF is missing or the peer isn't trusted. That is the "fall back to RemoteAddr" behaviour.

Reading the **leftmost** XFF value, as naive parsers and Spring's `ForwardedHeaderFilter` do, lets any client pick its own identity and dodge per-client limits. The right-to-left walk with trusted peers is the standard defence.

`ClientKeyResolver` then normalises `remoteAddr`:
- IPv4, and IPv4-mapped IPv6 (`::ffff:a.b.c.d`), becomes `v4:a.b.c.d`.
- IPv6 becomes `v6:<first 64 bits>`. A single subscriber usually holds a whole /64 and could otherwise rotate through 2^64 keys.
- Anything unparseable becomes `unknown`. All such requests share one bucket, which fails closed.

**Deployment fit.** `docker-compose.yml` publishes the app on `127.0.0.1:8080` behind a host proxy. The container sees the Docker bridge gateway (in `172.16.0.0/12`) as its peer, and Boot's default `internal-proxies` already covers that. If the proxy is a CDN or a load balancer with public egress IPs, the operator must set `TRUSTED_PROXIES` (OQ-4). If that's missed, every client shares the proxy's key: rate limiting falls back to today's global behaviour (fail closed), not to unlimited.

### Key-space bounding

`ClientRateLimiter` holds `Cache<String, ClientBuckets>` (Caffeine). `ClientBuckets` holds one Bucket4j bucket per tier, created together and lazily on a client's first request.

| Control | Default | Rationale |
|---|---|---|
| `maximumSize` | 10 000 | Hard memory cap. About 1 KB per entry (key string, Caffeine node, 3 lock-free buckets) means ≤ ~10 MB worst case |
| `expireAfterAccess` | 2 m (must be ≥ `period`; checked at bind time) | **Lossless expiry.** Greedy refill restores a full bucket within one `period` of idle time, so dropping an entry idle for ≥ `period` throws away no state |
| IPv6 /64 folding | prefix 64 | Collapses the cheapest key-rotation vector |
| Admission | Caffeine W-TinyLFU (built in) | Under a flood of one-off keys, frequently seen clients (including active abusers) tend to keep their entries instead of being reset by eviction |

Size-based eviction **is lossy**: an evicted client comes back with a full bucket. That only happens under key floods (more than 10 000 active keys within 2 minutes), and the global ceiling backstops it. That is the main reason the global buckets stay.

### Thread-safety analysis

| Shared state | Mechanism | Analysis |
|---|---|---|
| `Cache<String, ClientBuckets>` | Caffeine (ConcurrentHashMap based) | `cache.get(key, k -> new ClientBuckets(...))` is atomic per key, and the mapping function runs at most once per absent key. Concurrent first requests from one client get the **same** instance. Other keys aren't blocked. |
| Mapping function | Runs inside the CHM bin lock (`synchronized`) | On JDK 21 this pins a virtual-thread carrier for the length of the function. Rule: the function only allocates 3 buckets (microseconds), with **no I/O, logging, or metrics** inside it. |
| Per-client and global `Bucket` | Bucket4j `LockFreeBucket` (the default from `Bucket.builder()`, CAS on an `AtomicReference`) | `tryConsumeAndReturnRemaining` and `addTokens` are atomic and need no outside lock. Don't choose `SynchronizationStrategy.SYNCHRONIZED`; it would pin virtual threads. |
| Two-bucket consume | Not atomic across buckets | Invariant 1: global admits ≤ global tokens, because each admit is one atomic global consume, so the ceiling is never exceeded. Invariant 2: a client's net consumption ≤ client tokens, because a refund only restores a token that was taken. The race (a client token taken, then global rejects, then refunded) can make another request from that client see one token fewer for a few nanoseconds. That is harmless. |
| Eviction during use | Caffeine may evict entry X while thread A holds X | A consumes from the orphaned X and the next request creates Y. With access expiry ≥ `period`, X was already full, so nothing is lost. With size eviction, at most one extra bucket's worth per eviction, bounded by the global ceiling. |
| Global buckets, `RateLimitProperties` | `final` fields on a singleton; the properties record is immutable | Safely published by the Spring context refresh. |
| Gauge `cache.estimatedSize()` | Caffeine | Thread-safe and approximate by design. |
| Caffeine maintenance | Amortised on caller threads or `ForkJoinPool.commonPool()` | Acceptable. No removal listener is registered. |

### Observability

- Counter `ballistics.ratelimit.rejected{tier, scope=client|global}`.
- Gauge `ballistics.ratelimit.clients` (estimated map size).
- **No client IP in metric tags** (cardinality, PII). Rejection logs go at DEBUG with the client key. Nothing goes out per request at INFO/WARN, to avoid log flooding.
- WARN once at startup if `app.ratelimit.enabled=false`.

## C. Physics tables as a Spring bean

Contract: [`contracts/physics-tables-bean.md`](../../contracts/physics-tables-bean.md).

- `PhysicsTables(DragTable g1, DragTable g7, Atmosphere atmosphere)` are immutable records. `DragTable` makes defensive copies of its `double[]` on the way in and out.
- `PhysicsTablesConfig` has a `@Bean` method that parses `app.physics.tables-location` (default `classpath:physics-tables.yaml`) with `PhysicsTablesLoader`. The loader uses SnakeYAML `SafeConstructor` and validates every row.
- `@ConfigurationProperties` was **rejected**. The file is shared with the JS client and has a root-level schema (`g1Table`, `g7Table`, `atmosphere`) that can't take an `app.` prefix without breaking `virtual:physics-tables`. Importing it into the `Environment` would also leak those keys into every property source, and the monotonic-velocity check needs custom code anyway.
- Failures throw `PhysicsTablesLoadException` with a precise message (`g7Table[12].v must be > g7Table[11].v`). `PhysicsTablesFailureAnalyzer` turns it into a standard **APPLICATION FAILED TO START** block with Description and Action.
- `BallisticsEngine(PhysicsTables, MeterRegistry)` reads the arrays **once** in its constructor into `private final` fields. The hot path doesn't change. Moving from `static final` to instance `final` may cost a little JIT constant folding, and the JMH benchmark gates that (BE-1).
- GraalVM `native` profile: register `physics-tables.yaml` as a resource through `RuntimeHintsRegistrar`, because the file is now loaded through a Spring `Resource`.

## D. Executor rename

`compareExecutor` becomes `trajectoryExecutor` (bean name and `@Bean` method name). After A, **only `TrajectoryService` injects it**, and both controllers drop their executor dependency. The pool settings don't change.

## Data model and configuration changes

- No database. No persisted data.
- **Model records (additive):** `TrajectoryRequest.withBulletId(String)`, `CompareRequest.toTrajectoryRequest(String)`, `CustomBulletRequest.toBullet()` and `toTrajectoryRequest()`. `CustomBulletRequest.name` gets `@Size(max = 64)` once OQ-2 is approved.
- **New properties:** `app.ratelimit.*`, `app.physics.tables-location`, `server.forward-headers-strategy`, `server.tomcat.remoteip.*`. The defaults keep current per-user behaviour, so no deploy-time config is needed.
- **Migration and rollback:** one deploy. Rolling back means reverting the release. There's no state to migrate, and rate-limit and cache state are in memory and rebuilt on startup.

## Threat model (STRIDE-lite)

**Assets:** CPU/executor availability, heap (trajectory cache, client-bucket map), correctness and isolation of cached results, client IP addresses (PII, held in memory only).

**Trust boundaries:** (1) Internet → reverse proxy → app (`X-Forwarded-For`). (2) Request body → service/cache (user-chosen custom load values). (3) Classpath or operator-supplied YAML → engine. (4) Env vars/properties → limiter.

| # | Threat (STRIDE) | Risk | Required mitigation |
|---|---|---|---|
| R1 | **S**poofed XFF to dodge per-client limits or frame another IP | High | `RemoteIpValve` right-to-left walk with `internal-proxies`. The interceptor never reads XFF directly. Global ceiling. |
| R2 | **D**oS through key-space flood (IPv6 rotation, many IPs) causing heap growth or bucket resets | High | Caffeine `maximumSize` + `expireAfterAccess`, IPv6 /64 folding, global ceiling. |
| R3 | **D**oS through cache pollution with distinct custom loads | Medium | W-TinyLFU admission (scan-resistant), `/custom` moved into the `SINGLE` tier, `name` capped at 64 (OQ-2). The cache stays bounded at 500. |
| R4 | **I**nformation disclosure / **T**ampering through a cache-key collision (user B gets user A's custom result and name) | High (existing bug) | Whole-record key `{#bullet, #req}`, plus a regression test with two custom loads that differ only in BC, and two that differ only in name. |
| R5 | **D**oS through `/compare` duplicate-id amplification (unbounded `bulletIds`) | Medium | Service computes distinct ids only, so work ≤ catalog size. Capping the list size is OQ-3 (breaking). |
| R6 | **D**oS through misconfiguration (`app.ratelimit.enabled=false` in prod, `global-capacity < capacity`) | Low | WARN at startup when disabled. Cross-field checks fail the bind. `application-prod.properties` doesn't override `enabled`. |
| R7 | **D**oS / opaque failure from malformed or missing YAML | Low | Fail fast at context start, `FailureAnalyzer`, SnakeYAML `SafeConstructor`. |
| R8 | **I**nformation disclosure of client IPs through logs or metrics | Low | No IP tags. Client key logged at DEBUG only. Keys are dropped from memory by eviction. |
| R9 | **D**oS through very large JSON bodies (no request size limit) | Medium (pre-existing) | Out of scope. **Flag for devsecops**: set a body size limit at the proxy and/or the servlet. |
| R10 | Reflected input in a 400 `detail` | Low | Echoed `bulletId` cut to 64 chars. Response is `application/problem+json` with `nosniff`. |

Compliance baseline: none is named in the project CLAUDE.md, so devsecops should use its default.

## Task split

### Backend tasks

Order: BE-1 → BE-2 → BE-3 → BE-4. BE-5 → BE-6 can run in parallel with BE-2 to BE-4. BE-7 comes last.

**BE-1 — PhysicsTables bean (item C)**
- Add `PhysicsTables`, `DragTable`, `Atmosphere`, `PhysicsTablesLoader`, `PhysicsTablesLoadException`, `PhysicsTablesConfig`, `PhysicsTablesFailureAnalyzer`, and the runtime-hints registrar, as described in the contract.
- Delete the `static {}` block and the `static final` table/atmosphere fields from `BallisticsEngine`. Change the constructor to `(PhysicsTables, MeterRegistry)`.
- Update `BallisticsEngineTest` (replace reflection on `G1_VELOCITIES`) and `BallisticsEngineBenchmark` to build the engine from `PhysicsTablesLoader`.
- AC: `CrossValidationTest` and `BallisticsEngineTest` pass with unchanged expected values. A context test with `app.physics.tables-location=classpath:missing.yaml` fails with a `PhysicsTablesLoadException` cause and the analyzer's Description and Action. Loader unit tests cover a missing key, non-monotonic `v`, a non-finite `f`, a row count < 2, and mismatched lengths. A JMH `-Pbenchmark` run is within 5 % of the pre-change baseline, with numbers recorded in the PR.

**BE-2 — Cache-key fix (item A bug)**
- Change the key on `BallisticsEngine.compute` to `{ #bullet, #req }`.
- AC: new tests through the Spring proxy show that (a) two custom bullets that differ only in BC compute twice and return different results, (b) two that differ only in `name` return their own name, and (c) the same catalog request twice computes once (the existing `TrajectoryCacheTest` still passes).

**BE-3 — TrajectoryService (item A)**
- Implement the service as specified in the contract. Add the model mapping methods, `UnknownBulletException`, and its `GlobalExceptionHandler` mapping (400 ProblemDetail, message unchanged apart from the 64-char cut).
- Slim the controllers to routing: no `bulletCatalog`, no executor, no `TrajectoryRequest` construction.
- `/compare` computes distinct ids once and keeps input order and duplicates in the response.
- `CustomBulletRequest.name` gets `@Size(max = 64)`.
- `CompareRequest.bulletIds` gets `@NotEmpty @Size(max = 20)` (same cap as batch).
- AC: all existing controller and contract tests pass unchanged. Null `bulletId` on `/api/trajectory` and batch returns 400, not 500. Service unit tests use a mocked engine and a direct executor. `/compare` with `["a","a","a"]` calls the engine once and returns 3 results.

**BE-4 — Rename the executor (item D)**
- Rename the bean and method to `trajectoryExecutor`. Inject it with `@Qualifier("trajectoryExecutor")` into `TrajectoryService` only.
- AC: `grep -r compareExecutor src/` returns nothing. The context starts.

**BE-5 — RateLimitProperties (item E)**
- Add a `@ConfigurationProperties("app.ratelimit") @Validated` record as specified in the contract. Add the keys with `${ENV:default}` placeholders to `application.properties`. Add a commented block to `application-prod.properties`.
- AC: a binding test shows the defaults, env overrides, and failed binds for `capacity < 1`, `global-capacity < capacity`, and `expire-after-access < period`.

**BE-6 — Per-client limiter (item B)**
- Add `@RateLimited`, `RateLimitTier`, `ClientKeyResolver`, `ClientRateLimiter`, `RateLimitInterceptor`, and `RateLimitExceededException`, plus its 429 mapping in `GlobalExceptionHandler`. Register the interceptor in `WebConfig.addInterceptors` for `/api/**`.
- Annotate the 6 endpoints from the tier table. Remove every `Bucket` field from the controllers.
- Set `server.forward-headers-strategy=native` and the `server.tomcat.remoteip.*` keys.
- Add the metrics from Observability.
- AC: see the acceptance checklist in the contract.

**BE-7 — Tests and docs**
- Rewrite `RateLimitTest`. Drop the reflection on bucket fields. Use `@TestPropertySource` with small capacities and a unique `remoteAddr` per test (MockMvc `with(r -> { r.setRemoteAddr(..); return r; })`).
- Add a `RANDOM_PORT` test with a real HTTP client that sends `X-Forwarded-For` from loopback, to prove the valve wiring.
- Update `BatchControllerTest` if needed.
- Update the README architecture section (the Bucket4j description).
- AC: `mvn verify` is green, including the JaCoCo 90 % instruction and branch gates.

### Frontend tasks

**FE-1 — Match the custom-name length cap** (blocked on OQ-2)
- Add `maxlength="64"` to `#customName` in `index.html`.
- AC: the input won't take more than 64 characters. The existing JS tests pass.

(Optional, not required: show a friendly "too many requests, retry in N s" message on 429. The SPA treats 429 as a generic HTTP error today, and `/custom` can now return 429.)

## Open questions

- **OQ-1:** Confirm the global-ceiling defaults (10× per-client: 1200/300/100 per minute), or schedule a load test to set them.
- **OQ-2:** Approve `@Size(max = 64)` on `CustomBulletRequest.name`. It tightens validation, which is technically breaking, but it is the main mitigation for R3.
- **OQ-3:** Approve capping `CompareRequest.bulletIds` (for example `@NotEmpty @Size(max = 20)`, the same as batch). It is breaking, so it's out of scope unless approved.
- **OQ-4:** Production proxy topology. Is it a same-host proxy (defaults work) or a CDN/LB with public IPs (set `TRUSTED_PROXIES`)?
- **OQ-5:** Confirm `/api/trajectories/custom` belongs in the `SINGLE` tier rather than its own tier.
