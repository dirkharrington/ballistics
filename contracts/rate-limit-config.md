# Contract: rate-limit configuration and per-client interceptor

Version: 1.0.0 — 2026-11-01
Design: [`docs/architecture/trajectory-service-refactor.md`](../docs/architecture/trajectory-service-refactor.md) §B+E
Decision: [ADR 002](../docs/adr/002-per-client-rate-limiting.md)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Property keys

Add to `application.properties` with `${ENV:default}` placeholders, the same pattern as `CORS_ALLOWED_ORIGINS`. Spring relaxed binding (`APP_RATELIMIT_SINGLE_CAPACITY`, …) also works without placeholders.

| Key | Env var | Type | Default | Constraint | Meaning |
|---|---|---|---|---|---|
| `app.ratelimit.enabled` | `RATE_LIMIT_ENABLED` | boolean | `true` | — | Master switch. `false` logs one WARN at startup. |
| `app.ratelimit.period` | `RATE_LIMIT_PERIOD` | `Duration` | `1m` | ≥ 1s | Refill period for every bucket (greedy refill of `capacity` tokens per period) |
| `app.ratelimit.single.capacity` | `RATE_LIMIT_SINGLE_CAPACITY` | long | `120` | ≥ 1 | **Per-client** tokens per period, `SINGLE` tier |
| `app.ratelimit.single.global-capacity` | `RATE_LIMIT_SINGLE_GLOBAL_CAPACITY` | long | `1200` | ≥ `single.capacity` | Process-wide ceiling, `SINGLE` tier |
| `app.ratelimit.compare.capacity` | `RATE_LIMIT_COMPARE_CAPACITY` | long | `30` | ≥ 1 | Per-client, `COMPARE` tier |
| `app.ratelimit.compare.global-capacity` | `RATE_LIMIT_COMPARE_GLOBAL_CAPACITY` | long | `300` | ≥ `compare.capacity` | Ceiling, `COMPARE` tier |
| `app.ratelimit.batch.capacity` | `RATE_LIMIT_BATCH_CAPACITY` | long | `10` | ≥ 1 | Per-client, `BATCH` tier |
| `app.ratelimit.batch.global-capacity` | `RATE_LIMIT_BATCH_GLOBAL_CAPACITY` | long | `100` | ≥ `batch.capacity` | Ceiling, `BATCH` tier |
| `app.ratelimit.client-cache.max-size` | `RATE_LIMIT_CLIENT_CACHE_MAX_SIZE` | long | `10000` | 100 – 1 000 000 | Max tracked client keys |
| `app.ratelimit.client-cache.expire-after-access` | `RATE_LIMIT_CLIENT_CACHE_TTL` | `Duration` | `2m` | ≥ `period` | Idle eviction |
| `app.ratelimit.ipv6-prefix-length` | — | int | `64` | 32 – 128 | IPv6 addresses are folded to this prefix |

Proxy handling (Spring Boot / Tomcat). These are required for correct client identity:

```properties
server.forward-headers-strategy=native
server.tomcat.remoteip.remote-ip-header=X-Forwarded-For
# Comma-separated CIDRs of proxies whose X-Forwarded-For is trusted. Default = Spring Boot's built-in list.
server.tomcat.remoteip.internal-proxies=${TRUSTED_PROXIES:10.0.0.0/8,192.168.0.0/16,169.254.0.0/16,100.64.0.0/10,172.16.0.0/12,127.0.0.0/8,fc00::/7,::1/128,fe80::/10}
```

Add a commented `RATE_LIMIT_*` / `TRUSTED_PROXIES` block to `application-prod.properties`, in the same style as the `SSE_TIMEOUT_MS` comment. **Don't** set `app.ratelimit.enabled` there.

## `RateLimitProperties` bean

```java
package com.ballistics.config;

@Validated
@ConfigurationProperties("app.ratelimit")      // picked up by the existing @ConfigurationPropertiesScan
public record RateLimitProperties(
    @DefaultValue("true")  boolean enabled,
    @DefaultValue("1m")    @NotNull Duration period,
    @NotNull               @Valid Tier single,      // values from application.properties: 120 / 1200
    @NotNull               @Valid Tier compare,     // 30 / 300
    @NotNull               @Valid Tier batch,       // 10 / 100
    @DefaultValue          @Valid ClientCache clientCache,
    @DefaultValue("64")    @Min(32) @Max(128) int ipv6PrefixLength
) {
    public record Tier(@Min(1) long capacity, @Min(1) long globalCapacity) {
        // compact ctor: globalCapacity >= capacity, else IllegalArgumentException("...global-capacity must be >= capacity")
    }
    public record ClientCache(@DefaultValue("10000") @Min(100) @Max(1_000_000) long maxSize,
                              @DefaultValue("2m") @NotNull Duration expireAfterAccess) {}
    // compact ctor: period >= 1s; clientCache.expireAfterAccess >= period, else IllegalArgumentException
    public Tier tier(RateLimitTier t);   // SINGLE→single, COMPARE→compare, BATCH→batch
}
```

Tier values have no record-level defaults, because `@DefaultValue` can't hold different defaults per tier. The `${ENV:default}` placeholders in `application.properties` are the only source of defaults. If a tier key is missing, the bind fails at startup (`@NotNull` / `@Min(1)`). It must never quietly bind to `0` or "unlimited".

## Web-layer types (`com.ballistics.ratelimit`)

```java
public enum RateLimitTier { SINGLE, COMPARE, BATCH }

@Target(METHOD) @Retention(RUNTIME)
public @interface RateLimited { RateLimitTier value(); }

public interface ClientKeyResolver { String resolve(HttpServletRequest request); }   // default impl @Component

public final class ClientRateLimiter {                                               // @Component
    public Decision tryConsume(RateLimitTier tier, String clientKey);
    public record Decision(boolean allowed, Scope rejectedBy, long retryAfterSeconds) {}
    public enum Scope { CLIENT, GLOBAL }
}

public class RateLimitInterceptor implements HandlerInterceptor { ... }   // registered in WebConfig for "/api/**"

public class RateLimitExceededException extends RuntimeException {        // mapped to 429 in GlobalExceptionHandler
    RateLimitTier tier(); long retryAfterSeconds();
}
```

### Endpoint → tier

| Endpoint | Tier |
|---|---|
| `POST /api/trajectory` | `SINGLE` |
| `POST /api/trajectories/{bulletId}` | `SINGLE` |
| `POST /api/trajectories/custom` | `SINGLE` (**new**) |
| `POST /api/trajectories/compare` | `COMPARE` |
| `POST /api/trajectories/compare/stream` | `COMPARE` |
| `POST /api/trajectories/batch` | `BATCH` |

Methods without the annotation (`GET /api/bullets`, `GET /api/cache/stats`) and non-`HandlerMethod` handlers (static resources, CORS preflight) are never limited.

## IP extraction

Header priority, highest first:

1. **`X-Forwarded-For`, through Tomcat `RemoteIpValve`**. It is used only when the TCP peer matches `internal-proxies`. The list is walked **right to left**, skipping trusted proxy hops, and the first untrusted address becomes `request.getRemoteAddr()`.
2. **`request.getRemoteAddr()`** (the TCP peer). This is used when XFF is absent or the peer isn't trusted.

Never consulted: `X-Real-IP`, `Forwarded` (RFC 7239), `CF-Connecting-IP`, `True-Client-IP`. The leftmost XFF value is **never** used directly. Adding another header needs a contract change.

`ClientKeyResolver` reads **only** `request.getRemoteAddr()` and normalises it:

```
addr = request.getRemoteAddr()
if addr is null or does not match ^[0-9A-Fa-f:.]{2,45}$  → "unknown"                       // guarantees no DNS lookup
ip = InetAddress.getByName(addr)                                                         // literal-only, no DNS
if ip is Inet4Address                                → "v4:" + ip.getHostAddress()
if ip is an IPv4-mapped Inet6Address (::ffff:a.b.c.d) → "v4:" + embedded IPv4
if ip is Inet6Address                                → "v6:" + hex(first ipv6PrefixLength bits) + "/" + ipv6PrefixLength
on any parse failure                                 → "unknown"
```

"unknown" is a single shared bucket. That fails closed.

## Limiter algorithm

```
tryConsume(tier, key):
  cfg     = props.tier(tier)
  buckets = clientCache.get(key, k -> new ClientBuckets(props))     // 3 buckets: capacity / period, greedy refill
  cp = buckets.of(tier).tryConsumeAndReturnRemaining(1)
  if !cp.isConsumed()  → Decision(false, CLIENT, ceilSeconds(cp.nanosToWaitForRefill))
  gp = global[tier].tryConsumeAndReturnRemaining(1)                 // globalCapacity / period, greedy refill
  if !gp.isConsumed()  → buckets.of(tier).addTokens(1); Decision(false, GLOBAL, ceilSeconds(gp.nanosToWaitForRefill))
  → Decision(true, null, 0)

ceilSeconds(n) = max(1, ceil(n / 1e9))
```

- Buckets come from `Bucket.builder()` (lock-free default). Don't use `SynchronizationStrategy.SYNCHRONIZED`.
- The mapping function only allocates. It does no I/O, logging, or metrics (it runs under a CHM bin lock and pins a virtual-thread carrier).

## Eviction policy for the client-bucket map

```java
Caffeine.newBuilder()
    .maximumSize(props.clientCache().maxSize())                    // hard memory bound, W-TinyLFU admission
    .expireAfterAccess(props.clientCache().expireAfterAccess())     // ≥ period → lossless (bucket already full)
    .build();                                                       // Cache<String, ClientBuckets>
```

- Value: `ClientBuckets` holds 3 `Bucket`s, one per tier, created together.
- No removal listener, no `recordStats()` (not needed). Expose `estimatedSize()` as a gauge.
- Size eviction is lossy (an evicted client restarts with a full bucket). The global ceiling bounds the effect.

## Wire behaviour (HTTP)

On rejection the interceptor throws `RateLimitExceededException`. `GlobalExceptionHandler` returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 1
Content-Type: application/problem+json

{ "type": "about:blank", "title": "Too Many Requests", "status": 429,
  "detail": "Rate limit exceeded. Retry after 1 s.", "instance": "/api/trajectory" }
```

- `Retry-After` is now computed (≥ 1 s). Previously it was always `60`. The `detail` doesn't reveal whether the client or the global bucket rejected.
- This applies to `/compare/stream` too. Status 429 and `Retry-After` must hold whatever the `Accept` header is.
- Tokens are consumed in `preHandle`, before body binding and validation, so invalid requests count.

## Metrics and logging

- `ballistics.ratelimit.rejected` counter, tags `tier` (`single|compare|batch`) and `scope` (`client|global`).
- `ballistics.ratelimit.clients` gauge = `clientCache.estimatedSize()`.
- No client key or IP in tags. Log rejections at DEBUG only.

## Acceptance checklist

- [ ] No `Bucket` fields remain in any controller.
- [ ] Two different `remoteAddr`s each get the full per-client `capacity`.
- [ ] When a client's own bucket is drained, a different client still gets 200.
- [ ] Global ceiling: with `capacity=2, global-capacity=3`, two clients get exactly 3 successes in total. A client rejected by the global bucket keeps its token (refund).
- [ ] 429 carries `Retry-After` ≥ 1 and a problem+json body on all 6 endpoints, including `/compare/stream`.
- [ ] `/api/trajectories/custom` is now limited. `GET /api/bullets` is not.
- [ ] `ClientKeyResolver` unit tests cover IPv4, IPv4-mapped IPv6, two IPv6 addresses in the same /64 (same key), different /64s (different keys), a hostname-like string (`unknown`, no DNS), and null.
- [ ] `RANDOM_PORT` test: a request from loopback with `X-Forwarded-For: 203.0.113.7` is keyed as `v4:203.0.113.7`. With `internal-proxies` set to exclude loopback, the same request is keyed as `v4:127.0.0.1`.
- [ ] Binding fails at startup for `global-capacity < capacity` and `expire-after-access < period`.
- [ ] `app.ratelimit.enabled=false` disables all checks and logs one WARN.
