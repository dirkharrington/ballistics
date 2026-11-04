# Interface Contract: JSON-RPC 2.0

Version: 1.1.0 — 2026-11-03  
Design: [`be-jsonrpc.md`](./be-jsonrpc.md)

Builders implement this contract exactly. To change it, propose the change to the
architect. Don't edit this file.

---

## Shared types

These JSON Schema fragments are reused throughout the method definitions.

### TrajectoryParams

Fields mirror `TrajectoryRequest.java`. All numeric defaults match the compact-constructor
defaults in the Java record.

```json
{
  "type": "object",
  "required": ["bulletId"],
  "properties": {
    "bulletId":             { "type": "string", "description": "Catalog bullet ID, e.g. \"308-win-168gr\"" },
    "zeroRangeMeters":      { "type": "number", "exclusiveMinimum": 0, "maximum": 3000, "default": 100 },
    "maxRangeMeters":       { "type": "number", "exclusiveMinimum": 0, "maximum": 5000, "default": 1000 },
    "stepMeters":           { "type": "number", "exclusiveMinimum": 0, "maximum": 500,  "default": 25 },
    "windSpeedKph":         { "type": "number", "minimum": 0 },
    "altitudeMeters":       { "type": "number", "minimum": 0 },
    "temperatureC":         { "type": "number", "minimum": -50, "maximum": 60 },
    "sightHeightMm":        { "type": "number", "maximum": 150, "default": 38.1, "description": "Scope/sight height above bore in mm" },
    "shootingAngleDegrees": { "type": "number", "minimum": -45, "maximum": 45, "default": 0 },
    "windDirectionDeg":     { "type": "number", "minimum": 0, "maximum": 360, "default": 90 },
    "dragModel":            { "type": "string", "enum": ["G1", "G7"], "default": "G1" },
    "twistRateInchesPerTurn": {
      "type": "number",
      "exclusiveMinimum": 0,
      "maximum": 100,
      "description": "Barrel twist rate in inches per turn. When provided, gyroscopic spin drift is computed and returned as spinDriftCm on each TrajectoryPoint. Omit to disable."
    }
  },
  "additionalProperties": false
}
```

### TrajectoryResult

```json
{
  "type": "object",
  "required": ["bullet", "request", "points", "maxOrdinateCm", "maxOrdinateRangeMeters", "supersonicLimitMeters", "densityAltitudeMeters"],
  "properties": {
    "bullet":                  { "$ref": "#/Bullet" },
    "request":                 { "$ref": "#/TrajectoryParams" },
    "points":                  { "type": "array", "items": { "$ref": "#/TrajectoryPoint" } },
    "maxOrdinateCm":           { "type": "number", "description": "Peak height above line of sight in cm" },
    "maxOrdinateRangeMeters":  { "type": "number", "description": "Range at which peak occurs in m" },
    "supersonicLimitMeters":   { "type": "number", "description": "Range where velocity drops below ~343 m/s" },
    "densityAltitudeMeters":   { "type": "number", "description": "Density altitude in metres derived from altitudeMeters and temperatureC. Negative = denser than standard air." }
  }
}
```

### Bullet

```json
{
  "type": "object",
  "required": ["id","name","caliber","bulletWeightGrams","muzzleVelocityMps",
               "ballisticCoefficient","bulletDiameterMm","muzzleEnergyJoules","description","hexColor"],
  "properties": {
    "id":                   { "type": "string" },
    "name":                 { "type": "string" },
    "caliber":              { "type": "string" },
    "bulletWeightGrams":    { "type": "number" },
    "muzzleVelocityMps":    { "type": "number" },
    "ballisticCoefficient": { "type": "number" },
    "bulletDiameterMm":     { "type": "number" },
    "muzzleEnergyJoules":   { "type": "number" },
    "description":          { "type": "string" },
    "hexColor":             { "type": "string" }
  }
}
```

### TrajectoryPoint

```json
{
  "type": "object",
  "required": ["rangeMeters","dropCm","velocityMps","energyJoules",
               "windDriftCm","timeOfFlightSec","moaAdjustment","mradAdjustment","spinDriftCm"],
  "properties": {
    "rangeMeters":      { "type": "number", "description": "Horizontal distance downrange in m" },
    "dropCm":           { "type": "number", "description": "Drop below line of sight in cm (negative = below LoS)" },
    "velocityMps":      { "type": "number", "description": "Remaining velocity in m/s" },
    "energyJoules":     { "type": "number", "description": "Remaining kinetic energy in J" },
    "windDriftCm":      { "type": "number", "description": "Lateral wind drift in cm" },
    "timeOfFlightSec":  { "type": "number", "description": "Time of flight from muzzle in s" },
    "moaAdjustment":    { "type": "number", "description": "Scope elevation adjustment in MOA" },
    "mradAdjustment":   { "type": "number", "description": "Scope elevation adjustment in MRAD" },
    "spinDriftCm":      { "type": "number", "description": "Gyroscopic spin drift in cm. Positive = rightward (right-hand twist). 0.0 when twistRateInchesPerTurn not provided." }
  }
}
```

---

## Method: `bullets.list`

Returns the full bullet catalog.

**Rate limit**: none

### Request

```json
{
  "jsonrpc": "2.0",
  "method": "bullets.list",
  "id": "1"
}
```

`params` may be omitted or an empty object `{}`.

### Response (success)

```json
{
  "jsonrpc": "2.0",
  "result": [
    {
      "id": "308-win-168gr",
      "name": ".308 Winchester 168gr Sierra MatchKing",
      "caliber": ".308 Win",
      "bulletWeightGrams": 10.89,
      "muzzleVelocityMps": 792,
      "ballisticCoefficient": 0.505,
      "bulletDiameterMm": 7.82,
      "muzzleEnergyJoules": 3420.0,
      "description": "Standard .308 Win long-range target load",
      "hexColor": "#4a90d9"
    }
  ],
  "id": "1"
}
```

Result is `Bullet[]`. Empty array when catalog is empty.

---

## Method: `trajectory.compute`

Computes a trajectory for a catalog bullet.

**Rate limit**: `SINGLE` (120 req/min per IP, 1200 global; defaults)

### Request

```json
{
  "jsonrpc": "2.0",
  "method": "trajectory.compute",
  "params": {
    "bulletId": "308-win-168gr",
    "zeroRangeMeters": 100,
    "maxRangeMeters": 1000,
    "stepMeters": 25,
    "windSpeedKph": 16,
    "altitudeMeters": 0,
    "temperatureC": 15,
    "sightHeightMm": 38.1,
    "shootingAngleDegrees": 0,
    "windDirectionDeg": 90,
    "dragModel": "G1"
  },
  "id": "2"
}
```

`params` schema: `TrajectoryParams` (see Shared types). All fields except `bulletId`
are optional; omitted or zero-valued fields use the defaults in the compact constructor.

### Response (success)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "bullet": { "id": "308-win-168gr", "…": "…" },
    "request": { "bulletId": "308-win-168gr", "zeroRangeMeters": 100, "…": "…" },
    "points": [
      {
        "rangeMeters": 0,
        "dropCm": 0.0,
        "velocityMps": 792.0,
        "energyJoules": 3420.0,
        "windDriftCm": 0.0,
        "timeOfFlightSec": 0.0,
        "moaAdjustment": 0.0,
        "mradAdjustment": 0.0
      }
    ],
    "maxOrdinateCm": 4.2,
    "maxOrdinateRangeMeters": 175.0,
    "supersonicLimitMeters": 1350.0
  },
  "id": "2"
}
```

Result schema: `TrajectoryResult`.

### Error: unknown bullet

```json
{
  "jsonrpc": "2.0",
  "error": { "code": -32001, "message": "Unknown bullet", "data": { "bulletId": "bad-id" } },
  "id": "2"
}
```

### Error: validation failure

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": "maxRangeMeters: must be less than or equal to 5000; stepMeters: must be greater than 0"
  },
  "id": "2"
}
```

`data` is a semicolon-separated string of `field: message` pairs, sorted alphabetically
(mirrors `GlobalExceptionHandler.handleMethodArgumentNotValid`).

---

## Method: `trajectory.compare`

Computes trajectories for multiple catalog bullets under identical conditions.

**Rate limit**: `COMPARE` (30 req/min per IP, 300 global; defaults)

### Request

```json
{
  "jsonrpc": "2.0",
  "method": "trajectory.compare",
  "params": {
    "bulletIds": ["308-win-168gr", "6.5-creedmoor-140gr"],
    "zeroRangeMeters": 100,
    "maxRangeMeters": 1000,
    "stepMeters": 25,
    "windSpeedKph": 0,
    "altitudeMeters": 0,
    "temperatureC": 15,
    "sightHeightMm": 38.1,
    "shootingAngleDegrees": 0,
    "windDirectionDeg": 90,
    "dragModel": "G1"
  },
  "id": "3"
}
```

`params` schema:

```json
{
  "type": "object",
  "required": ["bulletIds"],
  "properties": {
    "bulletIds": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "maxItems": 20
    },
    "zeroRangeMeters":      { "type": "number", "exclusiveMinimum": 0, "maximum": 3000, "default": 100 },
    "maxRangeMeters":       { "type": "number", "exclusiveMinimum": 0, "maximum": 5000, "default": 1000 },
    "stepMeters":           { "type": "number", "exclusiveMinimum": 0, "maximum": 500,  "default": 25 },
    "windSpeedKph":         { "type": "number", "minimum": 0 },
    "altitudeMeters":       { "type": "number", "minimum": 0 },
    "temperatureC":         { "type": "number", "minimum": -50, "maximum": 60 },
    "sightHeightMm":        { "type": "number", "maximum": 150, "default": 38.1 },
    "shootingAngleDegrees": { "type": "number", "minimum": -45, "maximum": 45, "default": 0 },
    "windDirectionDeg":     { "type": "number", "minimum": 0, "maximum": 360, "default": 90 },
    "dragModel":            { "type": "string", "enum": ["G1", "G7"], "default": "G1" }
  },
  "additionalProperties": false
}
```

Unknown bullet IDs in `bulletIds` are **silently filtered** (matching REST behaviour).

### Response (success)

```json
{
  "jsonrpc": "2.0",
  "result": [
    { "bullet": { "id": "308-win-168gr", "…": "…" }, "points": [ "…" ], "…": "…" },
    { "bullet": { "id": "6.5-creedmoor-140gr", "…": "…" }, "points": [ "…" ], "…": "…" }
  ],
  "id": "3"
}
```

Result is `TrajectoryResult[]`, in any order (results arrive as each future completes).

---

## Method: `trajectory.computeCustom`

Computes a trajectory for a user-defined bullet not in the catalog.

**Rate limit**: `SINGLE`

### Request

```json
{
  "jsonrpc": "2.0",
  "method": "trajectory.computeCustom",
  "params": {
    "name": "175gr SMK handload",
    "bulletWeightGrams": 11.34,
    "muzzleVelocityMps": 853,
    "ballisticCoefficient": 0.505,
    "bulletDiameterMm": 7.82,
    "zeroRangeMeters": 100,
    "maxRangeMeters": 1000,
    "stepMeters": 25,
    "windSpeedKph": 0,
    "altitudeMeters": 0,
    "temperatureC": 15,
    "shootingAngleDegrees": 0,
    "windDirectionDeg": 90,
    "dragModel": "G1"
  },
  "id": "4"
}
```

`params` schema (mirrors `CustomBulletRequest.java`):

```json
{
  "type": "object",
  "required": ["name", "bulletWeightGrams", "muzzleVelocityMps", "ballisticCoefficient", "bulletDiameterMm"],
  "properties": {
    "name":                 { "type": "string", "minLength": 1, "maxLength": 64 },
    "bulletWeightGrams":    { "type": "number", "exclusiveMinimum": 0, "maximum": 30 },
    "muzzleVelocityMps":    { "type": "number", "exclusiveMinimum": 0, "maximum": 2000 },
    "ballisticCoefficient": { "type": "number", "exclusiveMinimum": 0, "maximum": 1.2 },
    "bulletDiameterMm":     { "type": "number", "exclusiveMinimum": 0, "maximum": 25 },
    "zeroRangeMeters":      { "type": "number", "exclusiveMinimum": 0, "default": 100 },
    "maxRangeMeters":       { "type": "number", "exclusiveMinimum": 0, "default": 1000 },
    "stepMeters":           { "type": "number", "exclusiveMinimum": 0, "default": 25 },
    "windSpeedKph":         { "type": "number", "minimum": 0 },
    "altitudeMeters":       { "type": "number", "minimum": 0 },
    "temperatureC":         { "type": "number", "minimum": -50, "maximum": 60 },
    "shootingAngleDegrees": { "type": "number", "minimum": -45, "maximum": 45, "default": 0 },
    "windDirectionDeg":     { "type": "number", "minimum": 0, "maximum": 360, "default": 90 },
    "dragModel":            { "type": "string", "enum": ["G1", "G7"], "default": "G1" }
  },
  "additionalProperties": false
}
```

### Response (success)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "bullet": {
      "id": "custom",
      "name": "175gr SMK handload",
      "caliber": "Custom",
      "bulletWeightGrams": 11.34,
      "muzzleVelocityMps": 853,
      "ballisticCoefficient": 0.505,
      "bulletDiameterMm": 7.82,
      "muzzleEnergyJoules": 4122.1,
      "description": "User-defined custom load",
      "hexColor": "#00d4ff"
    },
    "request": { "bulletId": "custom", "zeroRangeMeters": 100, "…": "…" },
    "points": [ "…" ],
    "maxOrdinateCm": 4.5,
    "maxOrdinateRangeMeters": 180.0,
    "supersonicLimitMeters": 1280.0
  },
  "id": "4"
}
```

Result schema: `TrajectoryResult`.

---

## Method: `trajectory.batch`

Computes up to 20 independent trajectories for catalog bullets in parallel.

**Rate limit**: `BATCH` (10 req/min per IP, 100 global; defaults)

### Request

```json
{
  "jsonrpc": "2.0",
  "method": "trajectory.batch",
  "params": {
    "requests": [
      {
        "bulletId": "308-win-168gr",
        "zeroRangeMeters": 100,
        "maxRangeMeters": 1000,
        "stepMeters": 25,
        "windSpeedKph": 0,
        "altitudeMeters": 0,
        "temperatureC": 15
      },
      {
        "bulletId": "6.5-creedmoor-140gr",
        "zeroRangeMeters": 100,
        "maxRangeMeters": 800,
        "stepMeters": 50,
        "windSpeedKph": 8,
        "altitudeMeters": 500,
        "temperatureC": 10
      }
    ]
  },
  "id": "5"
}
```

`params` schema:

```json
{
  "type": "object",
  "required": ["requests"],
  "properties": {
    "requests": {
      "type": "array",
      "items": { "$ref": "#/TrajectoryParams" },
      "minItems": 1,
      "maxItems": 20
    }
  },
  "additionalProperties": false
}
```

Each element of `requests` is a `TrajectoryParams` object (see Shared types).
`bulletId` is required in each element.

### Response (success)

```json
{
  "jsonrpc": "2.0",
  "result": [
    { "bullet": { "id": "308-win-168gr", "…": "…" }, "points": [ "…" ], "…": "…" },
    { "bullet": { "id": "6.5-creedmoor-140gr", "…": "…" }, "points": [ "…" ], "…": "…" }
  ],
  "id": "5"
}
```

Result is `TrajectoryResult[]`, one entry per input request, **in input order**.

---

## Method: `cache.stats`

Returns trajectory cache hit/miss statistics.

**Rate limit**: none

### Request

```json
{
  "jsonrpc": "2.0",
  "method": "cache.stats",
  "id": "6"
}
```

`params` may be omitted or an empty object `{}`.

### Response (success)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "estimatedSize": 142,
    "hitCount": 8730,
    "missCount": 142,
    "hitRate": 0.9840,
    "loadCount": 142
  },
  "id": "6"
}
```

Result schema:

```json
{
  "type": "object",
  "required": ["estimatedSize", "hitCount", "missCount", "hitRate", "loadCount"],
  "properties": {
    "estimatedSize": { "type": "integer", "minimum": 0 },
    "hitCount":      { "type": "integer", "minimum": 0 },
    "missCount":     { "type": "integer", "minimum": 0 },
    "hitRate":       { "type": "number",  "minimum": 0, "maximum": 1 },
    "loadCount":     { "type": "integer", "minimum": 0 }
  }
}
```

---

## Batch request example

```json
[
  { "jsonrpc": "2.0", "method": "bullets.list", "id": "a" },
  { "jsonrpc": "2.0", "method": "trajectory.compute",
    "params": { "bulletId": "308-win-168gr", "zeroRangeMeters": 100,
                "maxRangeMeters": 500, "stepMeters": 25,
                "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15 },
    "id": "b" },
  { "jsonrpc": "2.0", "method": "cache.stats", "id": "c" }
]
```

Corresponding response (order not guaranteed):

```json
[
  { "jsonrpc": "2.0", "result": [ { "id": "308-win-168gr", "…": "…" } ], "id": "a" },
  { "jsonrpc": "2.0", "result": { "bullet": { "…": "…" }, "points": [ "…" ], "…": "…" }, "id": "b" },
  { "jsonrpc": "2.0", "result": { "estimatedSize": 1, "hitCount": 0, "missCount": 1, "hitRate": 0.0, "loadCount": 1 }, "id": "c" }
]
```

---

## Error response examples

### Parse error (HTTP 400)

Sent when the body is not valid JSON. HTTP status is 400 (not 200).

```json
{ "jsonrpc": "2.0", "error": { "code": -32700, "message": "Parse error" }, "id": null }
```

### Invalid request

```json
{ "jsonrpc": "2.0", "error": { "code": -32600, "message": "Invalid request" }, "id": null }
```

Returned when: `jsonrpc` is not `"2.0"`, `method` is absent, `params` is a JSON array,
or the batch array is empty or has more than 20 items.

### Method not found

```json
{ "jsonrpc": "2.0", "error": { "code": -32601, "message": "Method not found" }, "id": "x" }
```

### Rate limit exceeded

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32002,
    "message": "Rate limit exceeded",
    "data": { "retryAfterSeconds": 3 }
  },
  "id": "x"
}
```

`retryAfterSeconds` is ≥ 1. Unlike REST, no `Retry-After` HTTP header is set (HTTP
status remains 200 for JSON-RPC responses).

---

## Spring Boot implementation checklist

- [ ] `JsonRpcController` mapped to `POST /api/rpc`, consumes/produces `application/json`.
- [ ] Single request and batch array both handled.
- [ ] Notifications (no `id`) are executed, produce no response entry.
- [ ] `params` deserialized from `JsonNode.get("params")` into the appropriate typed record using `ObjectMapper.treeToValue()`.
- [ ] Bean validation applied to each deserialized params object; violations return `-32602`.
- [ ] `ClientRateLimiter.tryConsume()` called before business logic for rate-limited methods.
- [ ] `RateLimitExceededException` mapped to `-32002` with `retryAfterSeconds` in `data`.
- [ ] `UnknownBulletException` mapped to `-32001` with `bulletId` in `data`.
- [ ] Batch: parallel execution via virtual-thread executor; `id: null` for notifications; partial failures allowed.
- [ ] Batch > 20 items: single `-32600` response (not an array).
- [ ] Empty batch array: single `-32600` response.
- [ ] Non-parseable body: HTTP 400 + `-32700` (no `GlobalExceptionHandler` involvement).
- [ ] Body too large: HTTP 413 + `-32003` (handled by existing body-size filter or a new `HandlerInterceptor`).
- [ ] 100% JaCoCo branch/instruction coverage on all new classes.
- [ ] No new endpoints break existing REST endpoints.
- [ ] `GET /api/rpc` returns HTTP 405 Method Not Allowed.
