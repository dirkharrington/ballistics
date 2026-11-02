# Contract: API hardening: legacy endpoint deprecation and request body size cap (BE-2)

Version: 1.0.0 — 2026-11-01
Owner of the implementation: backend builder. devsecops reviews it.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Deviations from the original brief (need user approval)

| Brief | Contract | Reason |
|---|---|---|
| `server.tomcat.max-http-request-body-size=65536` | New app property `app.http.max-request-body-bytes` enforced by a servlet filter | **That Spring Boot property doesn't exist** (checked against the Boot 4.1 property reference; the project is on 4.0.6). Boot ignores unknown keys, so the cap would have quietly done nothing. The Tomcat properties that do exist don't cover JSON bodies: `max-http-form-post-size` only covers `application/x-www-form-urlencoded`, and `max-swallow-size` only covers discarded bytes |
| Oversized body → **400** | Oversized body → **413 Content Too Large** with problem+json | RFC 9110 §15.5.14 status for this case. Clients and proxies understand it and don't retry it as a validation error |
| `Deprecation: true` | `Deprecation: @1793491200` (2026-11-01T00:00:00Z) | RFC 9745 (Standards Track, March 2025) defines the value as a Structured Field **Date** (`@<unix-seconds>`). `true` comes from pre-RFC drafts. If the user prefers `true` for a particular consumer, it's a one-constant change. See Open questions |

## Part A: deprecate `POST /api/trajectory`

Behaviour, request schema, response body, status codes, and rate-limit tier (`SINGLE`) are all **unchanged**. Only response headers are added.

### Response headers

These go on **every** response to `POST /api/trajectory`: 200, 400 (validation / unknown bullet), 413, 429, and 5xx.

| Header | Exact value |
|---|---|
| `Deprecation` | `@1793491200` |
| `Sunset` | `Sat, 01 May 2027 00:00:00 GMT` |
| `Link` | `</api/trajectories/{bulletId}>; rel="successor-version"` |

Notes for implementers:
- Store all three values as **string literals** in one constants holder, and unit-test the exact strings.
  - Don't format `Sunset` with `DateTimeFormatter.RFC_1123_DATE_TIME`: it emits `Sat, 1 May 2027` (no leading zero), which isn't an IMF-fixdate.
  - Don't build `Link` with `java.net.URI`: `{` and `}` are illegal URI characters, so `URI.create` throws.
- Timeline: `Deprecation` 2026-11-01 ≤ `Sunset` 2027-05-01, as RFC 9745 §3 requires.
- `Link` is a static hint for humans. The `{bulletId}` template is copied from the brief (see Open questions). `successor-version` is the RFC 5829 link relation. `Sunset` is RFC 8594.

### Where the headers are added

`com.ballistics.config.DeprecationHeadersFilter extends OncePerRequestFilter`, `@Component`, `@Order(Ordered.HIGHEST_PRECEDENCE + 10)`:
- `shouldNotFilter` returns true **unless** `"POST".equals(method) && "/api/trajectory".equals(request.getRequestURI())`.
- It sets the three headers with `response.setHeader(...)` **before** `chain.doFilter(...)`. A filter is used, not the controller or an interceptor, so the headers also appear on responses produced before or outside the handler: 413 from Part B, 429 from the rate-limit interceptor, and validation 400s.
- It increments the Micrometer counter `ballistics.api.deprecated.requests` with tag `endpoint=/api/trajectory`. One fixed tag value, no client data. This tells you when traffic has reached zero and the endpoint can be removed.
- Nothing downstream may call `response.reset()` or `resetBuffer()` on these requests (that would strip the headers).

### CORS

In `WebConfig.addCorsMappings` on `/api/**`, add `.exposedHeaders("Deprecation", "Sunset", "Link", "Retry-After")`. Browser clients on another allowed origin can't read these headers otherwise, because none of them is CORS-safelisted. `Retry-After` appears on every 429 response (rate limit) and is added here so cross-origin callers can honour the back-off without resorting to a fixed delay.

### OpenAPI (springdoc)

Change the existing annotation on `computeTrajectory` to `@Operation(summary = "Compute trajectory for a single bullet", deprecated = true)`. The spec at `/v3/api-docs` (non-prod) then shows the operation as deprecated.

### Startup log

Emit exactly once per application start, at level **WARN**, from a listener on `ApplicationReadyEvent` (for example a method on `DeprecationHeadersFilter` annotated `@EventListener(ApplicationReadyEvent.class)`):

```
POST /api/trajectory is deprecated and will be removed on 2027-05-01. Use POST /api/trajectories/{bulletId} instead.
```

- Pass the text as a single constant with **no arguments** (`log.warn(LEGACY_TRAJECTORY_DEPRECATION_MESSAGE)`).
- Don't log anything per request: that would let callers flood the logs. The counter above covers per-request visibility.

### Removal (not part of this change)

On or after 2027-05-01, a separate change removes the endpoint (`410 Gone` or `404`), the filter, and the counter. Track it as a follow-up.

## Part B: request body size cap

### Property

`application.properties` (same `${ENV:default}` pattern as `CORS_ALLOWED_ORIGINS`):

```properties
# Maximum request body size in bytes for /api/** requests. Larger bodies → 413.
# A 20-item BatchRequest is < 4 KiB; 64 KiB leaves ~16x headroom.
app.http.max-request-body-bytes=${MAX_REQUEST_BODY_BYTES:65536}
```

`application-prod.properties`: add a commented line in the same style as the `SSE_TIMEOUT_MS` block:

```properties
# OPTIONAL: request body cap in bytes (default 65536).
# app.http.max-request-body-bytes=${MAX_REQUEST_BODY_BYTES:65536}
```

| Key | Env var | Type | Default | Constraint |
|---|---|---|---|---|
| `app.http.max-request-body-bytes` | `MAX_REQUEST_BODY_BYTES` | long | `65536` | 1024 – 10 485 760 (bind fails at startup outside this range) |

Bean (picked up by the existing `@ConfigurationPropertiesScan`):

```java
package com.ballistics.config;

@Validated
@ConfigurationProperties("app.http")
public record HttpLimitsProperties(
    @DefaultValue("65536") @Min(1024) @Max(10_485_760) long maxRequestBodyBytes
) {}
```

### Filter

`com.ballistics.config.RequestBodySizeLimitFilter extends OncePerRequestFilter`, `@Component`, `@Order(Ordered.HIGHEST_PRECEDENCE + 20)`. It runs after `SecurityHeadersFilter` and `DeprecationHeadersFilter`, so 413 responses carry those headers too.

```
shouldNotFilter: path does not start with "/api/"  OR  method ∈ {GET, HEAD, OPTIONS, TRACE}
(async dispatches are skipped by OncePerRequestFilter's default)

doFilterInternal(req, resp, chain):
  max = props.maxRequestBodyBytes()
  if req.getContentLengthLong() > max            → reject413(req, resp)   // fast path: body not read
  body = req.getInputStream().readNBytes(max + 1) // bounded read; also covers chunked (Content-Length = -1)
  if body.length > max                           → reject413(req, resp)
  chain.doFilter(new CachedBodyRequest(req, body), resp)

CachedBodyRequest extends HttpServletRequestWrapper:
  getInputStream()        → ServletInputStream over a ByteArrayInputStream(body)
  getReader()             → BufferedReader over that stream, charset = req.getCharacterEncoding() or UTF-8
  getContentLength[Long]  → body.length
```

`reject413` writes a `ProblemDetail` serialized with the application's auto-configured JSON mapper bean. No hand-built JSON strings.

```
HTTP/1.1 413 Content Too Large
Content-Type: application/problem+json

{ "type": "about:blank", "title": "Content Too Large", "status": 413,
  "detail": "Request body exceeds the 65536-byte limit.", "instance": "/api/trajectories/batch" }
```

- `instance` = `request.getRequestURI()`. `detail` uses the configured limit.
- Don't call `response.reset()` (it would drop the security and deprecation headers).
- Log at DEBUG only.
- When the fast path rejects without reading the body, Tomcat discards the unread remainder up to `server.tomcat.max-swallow-size` (default 2 MB), then closes the connection. Leave that default.

### Interaction with rate limiting

The filter runs before the `DispatcherServlet`, so **an oversized request is rejected before `RateLimitInterceptor` and doesn't consume a token**. The cost of a rejected request is bounded: no read at all on the fast path, at most `max + 1` bytes on the chunked path. In-limit requests are now buffered (≤ 64 KiB) before the rate-limit check. Both are acceptable. A proxy-level cap (`client_max_body_size 64k` in nginx) is recommended as defence in depth, but it's outside this repo.

## Threat model (STRIDE-lite)

| Threat | Mitigation |
|---|---|
| **DoS** through unbounded JSON deserialization (the threat-model item that prompted this) | 64 KiB cap on every `/api/**` body, enforced before Jackson sees a byte. Chunked bodies are covered by the bounded read. Misconfigured limits fail at startup |
| **DoS** through log flooding from deprecated-endpoint traffic | WARN once at startup. A metric per request, not a log line |
| **Information disclosure** | The 413 `detail` reveals only the configured limit, which isn't sensitive. The counter carries no client identifiers |
| **Repudiation / migration risk** for API consumers | Machine-readable `Deprecation`, `Sunset`, and `Link` headers, exposed through CORS, plus `deprecated: true` in OpenAPI |

## Acceptance checklist

Part A
- [ ] `POST /api/trajectory` with a valid body → 200, the **same body as before**, and all three headers with the exact values above.
- [ ] Same three headers on a 400 (missing `bulletId`), a 400 (unknown bullet), a 429 (bucket drained), and a 413 (oversized body).
- [ ] `POST /api/trajectories/{bulletId}`, `/compare`, `/batch`, and `GET /api/bullets` responses do **not** carry the three headers.
- [ ] Unit test asserts the exact `Sunset` string `Sat, 01 May 2027 00:00:00 GMT` (leading zero) and the exact `Link` string.
- [ ] The startup WARN appears exactly once with the exact text (use `OutputCaptureExtension`). No per-request log line.
- [ ] `ballistics.api.deprecated.requests{endpoint="/api/trajectory"}` increments once per request, including error responses.
- [ ] A CORS request from an allowed origin gets `Access-Control-Expose-Headers` listing `Deprecation, Sunset, Link, Retry-After`.
- [ ] `/v3/api-docs` marks `POST /api/trajectory` as `deprecated: true` (non-prod profile).

Part B
- [ ] Body of exactly 65 536 bytes → reaches the controller (normal 200/400). 65 537 bytes → 413 problem+json, and the controller is not invoked.
- [ ] Same for a chunked request with no `Content-Length`.
- [ ] `Content-Length: 1000000` → 413 without reading the body (the test asserts the input stream wasn't consumed past 0 bytes, e.g. with a mock request).
- [ ] A 20-item `BatchRequest` still succeeds.
- [ ] `MAX_REQUEST_BODY_BYTES=2048` lowers the cap. `MAX_REQUEST_BODY_BYTES=100` fails startup binding.
- [ ] A 413 doesn't consume a rate-limit token, and it still carries the `SecurityHeadersFilter` headers.
- [ ] GET requests and non-`/api/` paths pass through untouched (static assets still served with their cache headers).
- [ ] The SSE endpoint `/api/trajectories/compare/stream` still streams with a buffered request body.
- [ ] JaCoCo stays ≥ 90 % instruction and branch.

## Resolved decisions

| Decision | Resolution |
|---|---|
| `Deprecation` value | **RFC 9745 date** `@1793491200`. The `true` draft value is not used |
| `Link` target `{}` | **Keep as-is** (option a). Readable and accepted by all common parsers |
| `Retry-After` in CORS | **Added** to `exposedHeaders` (see CORS section above) |
