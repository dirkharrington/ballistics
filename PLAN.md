# Ballistics Visualizer — Upgrade Plan

## Status

| Priority | Feature | Status |
|----------|---------|--------|
| 1 | Input validation + ProblemDetail errors | ✅ Done (branch: feature/validation-openapi-caching) |
| 2 | OpenAPI / Swagger docs | ✅ Done |
| 3 | Trajectory caching (Caffeine) | ✅ Done |
| 4 | Bullet library expansion | ⬜ Pending |
| 5 | Chart improvements | ⬜ Pending |
| 6 | Actuator metrics (Micrometer) | ⬜ Pending |
| 7 | Structured JSON logging | ⬜ Pending |
| 8 | Async compare endpoint | ⬜ Pending |
| 9 | Custom bullet input form | ⬜ Pending |
| 10 | GraalVM native image | ⬜ Pending |

---

## User-Facing

### 4. Bullet Library Expansion
Add more cartridges to `Bullet.knownRifleBullets()`:
- .243 Win 95gr
- .270 Win 130gr
- 7mm Rem Mag 160gr
- .338 Lapua 250gr
- 6mm Creedmoor 108gr
- .300 Win Mag 190gr

### 5. Chart Improvements
- Export trajectory data to CSV/PNG
- Range finder crosshairs (click to annotate a range)
- Mobile responsive layout (charts stack vertically on narrow viewports)

### 9. Custom Bullet Input Form
UI form to enter: name, weight (g), muzzle velocity (m/s), BC, diameter (mm).
Submits to a new `POST /api/trajectories/custom` endpoint.

---

## Stability / Maintenance

### 6. Actuator Metrics (Micrometer)
- Add `management.metrics.enable.*` config
- Instrument `BallisticsEngine.compute()` with a `Timer` counter
- Expose via `/actuator/metrics`

### 7. Structured JSON Logging
- Add `logback-spring.xml` with JSON encoder (e.g. `logstash-logback-encoder`)
- Log compute duration and bullet ID per request

---

## Performance

### 8. Async Compare Endpoint
Replace `.parallel()` stream in `compareTrajectories` with `CompletableFuture.supplyAsync()` calls joined on a dedicated executor, giving better backpressure control.

### 10. GraalVM Native Image
- Add `spring-boot-starter-aot` / native build plugin
- Validate reflection hints for `BallisticsEngine` private method access in tests
- Target: `mvn -Pnative native:compile`
