# Design: JSON-RPC 2.0 Transport Layer

Version: 1.0.0 — 2026-11-02  
Status: PROPOSED  
Authors: architect session  
Implements: JSON-RPC 2.0 (https://www.jsonrpc.org/specification)

Builders implement the companion contract [`be-jsonrpc-contract.md`](./be-jsonrpc-contract.md).  
To change this design, propose the change to the architect. Don't edit either file unilaterally.

---

## 1. Goal

Add a JSON-RPC 2.0 transport to the ballistics API so that every existing REST
endpoint (except the SSE stream) is reachable at a single URL.  
All existing REST endpoints **remain fully functional** — this is additive only.

---

## 2. Single endpoint

```
POST /api/rpc
Content-Type: application/json
```

Accepts a single JSON-RPC 2.0 request object **or** a JSON array of request objects
(batch). Returns the corresponding response object or array.

The endpoint is registered in Spring MVC as a `@RestController` at the path `/api/rpc`.

---

## 3. Method catalogue

| RPC method | REST equivalent | Rate-limit tier |
|---|---|---|
| `bullets.list` | `GET /api/bullets` | none |
| `trajectory.compute` | `POST /api/trajectories/{bulletId}` | SINGLE |
| `trajectory.compare` | `POST /api/trajectories/compare` | COMPARE |
| `trajectory.computeCustom` | `POST /api/trajectories/custom` | SINGLE |
| `trajectory.batch` | `POST /api/trajectories/batch` | BATCH |
| `cache.stats` | `GET /api/cache/stats` | none |

**Excluded**: `POST /api/trajectories/compare/stream` (SSE streaming is fundamentally
incompatible with JSON-RPC request/response semantics and is not mapped).

**Deprecated REST alias**: `POST /api/trajectory` (deprecated in the REST layer) has no
RPC equivalent; use `trajectory.compute` instead.

---

## 4. Request / response envelope

Follows the JSON-RPC 2.0 specification exactly.

### 4.1 Single request

```json
{
  "jsonrpc": "2.0",
  "method": "<method-name>",
  "params": { … },
  "id": "optional-string-or-number-or-null"
}
```

- `jsonrpc` must be exactly `"2.0"`.
- `params` is a **named-parameter object only** (positional arrays are rejected with
  `-32600` Invalid Request).
- `id` may be a string, number, or `null`. Omitting `id` makes the call a
  **notification** — the server processes it but returns no response.

### 4.2 Single response

Success:
```json
{ "jsonrpc": "2.0", "result": <value>, "id": <same-as-request> }
```

Error:
```json
{
  "jsonrpc": "2.0",
  "error": { "code": -32601, "message": "Method not found", "data": "…optional…" },
  "id": <same-as-request-or-null>
}
```

### 4.3 Batch request

```json
[ <request-object>, <request-object>, … ]
```

- Maximum 20 items. Exceeding this returns a single error response (not an array).
- An empty array (`[]`) returns a single `-32600` error response.
- The response array omits entries for notifications.
- Response array items are **not** guaranteed to be in the same order as the request
  (parallel execution). Clients must match by `id`.

---

## 5. Error codes

### Standard codes (JSON-RPC 2.0 specification)

| Code | Message | When |
|---|---|---|
| `-32700` | Parse error | Body is not valid JSON |
| `-32600` | Invalid request | Envelope missing `jsonrpc`/`method`, positional params array, or empty batch |
| `-32601` | Method not found | `method` value not in the catalogue |
| `-32602` | Invalid params | Bean validation failure (missing required field, constraint violation) |
| `-32603` | Internal error | Unexpected server-side exception |

### Custom domain codes

Custom codes occupy the reserved server-error range `-32000` to `-32099`.

| Code | Message | Meaning | `data` field |
|---|---|---|---|
| `-32001` | Unknown bullet | `bulletId` not in catalog | `{ "bulletId": "…" }` |
| `-32002` | Rate limit exceeded | Client or global bucket exhausted | `{ "retryAfterSeconds": <n> }` |
| `-32003` | Payload too large | Request body exceeds the configured `MAX_BODY_BYTES` | none |

`data` is always omitted when there is nothing useful to add.  
The `-32600` through `-32603` messages are fixed strings matching the spec; custom
`-320xx` messages are also fixed strings.

---

## 6. Rate limiting

### 6.1 Design intent

JSON-RPC shares **the same `ClientRateLimiter` and `DefaultClientKeyResolver`** used by
the REST layer. The client key (per-IP bucket) is derived identically: IPv4 keyed as
`v4:<addr>`, IPv6 keyed by first `/64` prefix, unknown address as `"unknown"`.

### 6.2 Tier assignment

Because the `RateLimitInterceptor` fires on Spring MVC handler method annotations and
`/api/rpc` has a single Java handler, the interceptor annotation cannot be used. Instead
the `JsonRpcDispatcher` (the internal dispatch component) calls
`clientRateLimiter.tryConsume(tier, clientKey)` programmatically for each invocation.

| RPC method | Tier |
|---|---|
| `bullets.list` | not limited |
| `trajectory.compute` | `SINGLE` |
| `trajectory.compare` | `COMPARE` |
| `trajectory.computeCustom` | `SINGLE` |
| `trajectory.batch` | `BATCH` |
| `cache.stats` | not limited |

Tokens are consumed **before** the business logic executes (fail-closed, matching
the existing REST interceptor behaviour).

### 6.3 Rate-limit errors in batch

When one item in a batch triggers a rate-limit rejection, **only that item** receives an
error response (`-32002`). Other items in the same batch continue executing.

### 6.4 HTTP status

The HTTP status for `/api/rpc` is always `200 OK` even when every item in the response
is an error (per JSON-RPC convention). The only exceptions:

| Condition | HTTP status |
|---|---|
| Body is not parseable JSON | `400 Bad Request` (before JSON-RPC errors are possible) |
| Body exceeds `MAX_BODY_BYTES` | `413 Payload Too Large` |

These two cases return a `Content-Type: application/json` body with a single JSON-RPC
error object (id: null) because there is no request `id` to echo.

---

## 7. Batch semantics

- Maximum 20 items per batch.
- Items are dispatched **in parallel** using a virtual-thread executor (same pattern as
  `trajectoryService.compareAsync`).
- Results are collected and returned as a JSON array. Order is not guaranteed; clients
  must correlate by `id`.
- A notification item (no `id`) is executed but produces no array entry.
- Partial failure is the default: one rejected item does not stop others.
- The `trajectory.batch` method is itself callable within a JSON-RPC batch (an item of
  type `trajectory.batch`), but the contained `requests` array still counts toward its
  own `BATCH` tier limit, not the outer batch's item count.

---

## 8. Integration with OpenAPI / springdoc

The single `/api/rpc` endpoint will appear in the existing Swagger UI as one POST
operation. Its documented request schema is the JSON-RPC envelope union type:

```yaml
requestBody:
  content:
    application/json:
      schema:
        oneOf:
          - $ref: '#/components/schemas/JsonRpcRequest'
          - type: array
            items:
              $ref: '#/components/schemas/JsonRpcRequest'
            maxItems: 20
```

Per-method schemas (the `params` shapes) are **not** auto-generated in Swagger UI
because the dispatcher decodes them at runtime. The method catalogue and schemas live
in this document and in `be-jsonrpc-contract.md`.

Optionally, a read-only `GET /api/rpc/schema` endpoint may be added in a follow-up
to expose a machine-readable JSON Schema for each method — not part of this contract.

---

## 9. Threat model

### 9.1 Replay attacks

JSON-RPC has no built-in replay protection. Mitigations in scope:

- Rate limiting (per-IP, same buckets as REST) bounds the request rate.
- No state-mutating methods exist (the API is read/compute-only). Replayed compute
  requests are idempotent by nature.
- The existing `Cache-Control: no-store` and `Pragma: no-cache` response headers
  (set by the security filter chain) prevent caching of results at intermediaries.

No nonce or timestamp verification is required given the stateless, idempotent nature
of the current API.

### 9.2 Oversized batches

- Enforced server-side: batch arrays > 20 items are rejected with `-32600`.
- The body-size filter (`MAX_BODY_BYTES`, already in place) is the outer guard; it fires
  before JSON parsing, returning HTTP 413.
- Operators should tune `MAX_BODY_BYTES` to be consistent with 20 maximally-sized batch
  items (each `TrajectoryRequest` is small; a safe ceiling is 64 KB).

### 9.3 Injection via method name

- The `method` field is matched against a fixed allowlist (the method catalogue).
  Any non-matching value returns `-32601`.
- The value is never logged verbatim at WARN or above; only its length and first 64
  characters are logged at DEBUG. This prevents log injection from overlong or
  control-character-containing method names.
- Method names are parsed as plain strings (no dynamic class loading, no reflection on
  arbitrary names).

### 9.4 Params injection

- `params` is deserialized into typed Java records using Jackson.
- All fields are validated with `jakarta.validation` (same as REST).
- No raw SQL, shell commands, or file paths are derived from `params` values.

### 9.5 Amplification

- `trajectory.batch` within a JSON-RPC batch item is allowed, but it consumes a `BATCH`
  token before executing, limiting how much work can be triggered per request.
- The global token buckets cap aggregate server load regardless of client diversity.

---

## 10. Spring Boot implementation notes

These are guidance for the backend engineer, not hard requirements of the wire contract.

- The `JsonRpcController` is a `@RestController` at `/api/rpc` consuming and producing
  `application/json`.
- Body is read as `JsonNode` first (raw deserialization), then dispatched by method name
  to typed handlers that re-bind `params` into the appropriate request record.
- Validation is done with the same `jakarta.validation.Validator` used by REST
  (`@Valid` on method parameters, or programmatic invocation).
- Each method handler is a package-private class or a lambda; the dispatcher is the only
  public surface.
- The existing `GlobalExceptionHandler` does **not** catch exceptions from
  `JsonRpcController` in the JSON-RPC error path — the controller handles its own
  exceptions and writes well-formed JSON-RPC error responses. Only unhandled exceptions
  (e.g. `OutOfMemoryError`) bubble to `GlobalExceptionHandler` as HTTP 500.
- 100% JaCoCo branch/instruction coverage must be maintained. Every error branch
  (parse error, invalid request, method not found, invalid params, rate limit, domain
  error, internal error) must be covered by tests.
