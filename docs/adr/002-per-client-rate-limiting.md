# ADR 002 — Per-client in-process rate limiting with a global ceiling

Status: Proposed — 2026-11-01
Design: [`trajectory-service-refactor.md`](../architecture/trajectory-service-refactor.md) §B+E
Contract: [`contracts/rate-limit-config.md`](../../contracts/rate-limit-config.md)

## Context

The Bucket4j buckets (120/30/10 per minute) are fields on singleton controllers, so they are shared by the whole process. One client can use up the budget for every user. `/api/trajectories/custom` has no limit at all. The numbers are hard-coded.

The app is deployed as **one instance** behind a reverse proxy (`docker-compose.yml` publishes `127.0.0.1:8080`). No Redis or external store is allowed. `bucket4j-core` and Caffeine are already dependencies.

## Options considered

### Where bucket state lives

| Option | Verdict |
|---|---|
| **Caffeine `Cache<clientKey, ClientBuckets>` + Bucket4j `LockFreeBucket`** | **Chosen.** Both libraries are already in the build. Bounded by size and idle expiry. Lock-free consume. |
| `ConcurrentHashMap` + scheduled sweeper | Unbounded between sweeps. A hand-written eviction policy is more code to get wrong. |
| Redis / `bucket4j-redis` | Needed only for multiple instances. Adds infrastructure, a network hop on every request, and a new failure mode. Ruled out by the constraints. |
| Proxy-level only (nginx `limit_req`) | Good defence in depth, but the proxy config isn't in this repo and the app must protect itself if the proxy is misconfigured or bypassed. Recommended **in addition**, not instead. |
| `bucket4j-spring-boot-starter` | A third-party starter with SpEL/YAML-driven filters. A new dependency and more config surface than 3 tiers need. |

### Per-client vs global

| Option | Verdict |
|---|---|
| Global only (status quo) | Unfair. This is the defect. |
| Per-client only | Fails open under distributed load. N clients get N × capacity, and IPv6 rotation or wrong proxy trust makes N effectively unbounded. The executor and CPU are unprotected. |
| **Per-client + global ceiling** | **Chosen.** Per-client gives fairness. The global ceiling caps total work and backstops lossy map eviction. |

### Client identity

| Option | Verdict |
|---|---|
| **Tomcat `RemoteIpValve` (`server.forward-headers-strategy=native`) + `internal-proxies` CIDRs; resolver reads `getRemoteAddr()`** | **Chosen.** Trusts `X-Forwarded-For` only from known proxy peers and walks it right to left. Well-tested container code. Configured by properties. |
| Hand-parse the leftmost `X-Forwarded-For` | Client-controlled, so trivially spoofed to dodge limits. |
| Spring `ForwardedHeaderFilter` (`framework` strategy) | Uses the leftmost value and doesn't check the peer. Safe only if the proxy always overwrites the header. |

## Decision

- Per-client buckets in a Caffeine map: `maximumSize` 10 000, `expireAfterAccess` 2 m (≥ the refill period, so expiry is lossless). Keys are IPv4 or IPv6 /64 prefixes resolved from `RemoteIpValve`'s `remoteAddr`.
- A process-wide bucket per tier acts as the ceiling. Order: per-client first, then global. On a global rejection, the per-client token is refunded.
- Limits are declared with `@RateLimited(tier)` on controller methods and enforced by a `HandlerInterceptor`. Rejections become a 429 ProblemDetail with a computed `Retry-After`.
- **The existing 120/30/10 become the per-client `capacity`** (`app.ratelimit.<tier>.capacity`). They were always sized for one interactive user. `global-capacity` defaults to 10× per-client until a load test sets it.
- Everything is set through `app.ratelimit.*`, with `${ENV:default}` placeholders.

## Consequences

- **Positive:**
  - One client can no longer starve others.
  - Memory is bounded (about 10 MB worst case).
  - XFF spoofing can't create new identities unless the attacker controls a trusted proxy.
  - Limits can be tuned without a rebuild.
  - `/custom` is now covered.
- **Negative:**
  - Size eviction under a key flood resets evicted clients. The global ceiling bounds the effect.
  - Clients behind one NAT or CGNAT share a bucket.
  - Invalid requests now consume tokens (intended).
  - `Retry-After` is no longer always `60`.
- **Operational:**
  - If the production proxy egresses from public IPs (CDN/LB), `TRUSTED_PROXIES` **must** be set. Otherwise all clients share one key, which degrades to global-only behaviour (fails closed, not open).
- **Scaling:** limits are **per instance**. Running N instances multiplies the effective limits by N. Moving to more than one instance requires revisiting this ADR: either a shared store (Redis) or limits enforced at the proxy or load balancer.
