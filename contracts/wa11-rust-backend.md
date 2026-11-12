# Contract: Rust Backend (WA-11)

Version: 0.1.0 — 2026-11-11  
ADR: [`adr-007-rust-backend-framework.md`](./adr-007-rust-backend-framework.md) (framework choice), [`adr-006-ballistics-engine-crate.md`](./adr-006-ballistics-engine-crate.md) (crate structure)  
Depends on: [`wa10-shared-crate.md`](./wa10-shared-crate.md) (required), [`be-jsonrpc-contract.md`](./be-jsonrpc-contract.md) (JSON-RPC protocol preserved exactly)  
Owners: backend/Rust (§2–§9), devsecops (§10–§11)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0. What changes and what does not

| Changes | Does NOT change |
|---|---|
| Backend runtime: Rust (Axum) replaces Spring Boot 4.1.1 / Java 25 | JSON-RPC protocol (`be-jsonrpc-contract.md`) |
| Build system: Cargo replaces Maven for the server binary | API paths: `/api/trajectory`, `/api/trajectories/batch`, `/api/bullets` |
| Docker image: multi-stage Rust build replaces maven build stage | Frontend assets: same Vite output, served from same `/assets/` path |
| Coverage gate: `cargo-llvm-cov` replaces JaCoCo | Physics computation: `ballistics-core` is the engine; physics results are identical |
| CI: `java-build` renamed/replaced; `rust-build` gains server build | Security headers: same headers, same values (implemented via `tower-http`) |
| Configuration: TOML replaces `application.properties`/`application.yml` | Prometheus metric path: `/actuator/prometheus` (preserved for compatibility) |
| `physics-tables.yaml` is eliminated (constants are in `ballistics-core`) | Frontend PWA/Service Worker behavior |

The Spring Boot backend removal is **atomic** — the entire `src/main/java/` tree and `pom.xml` are removed in the WA-11 PR.

---

## 1. Project layout after WA-11

```
server/                         # new Rust HTTP server crate (not in engine/ workspace)
├── Cargo.toml                  # name = "ballistics-server"; see §2
├── src/
│   ├── main.rs                 # tokio::main entry; config loading; router assembly
│   ├── config.rs               # Config struct (TOML + env override)
│   ├── routes/
│   │   ├── mod.rs
│   │   ├── trajectory.rs       # POST /api/trajectory handler
│   │   ├── batch.rs            # POST /api/trajectories/batch handler
│   │   └── bullets.rs          # GET /api/bullets handler
│   ├── middleware/
│   │   ├── security_headers.rs # tower Layer: adds CSP, HSTS, etc.
│   │   └── rate_limit.rs       # tower Layer: per-IP rate limiting
│   └── metrics.rs              # /actuator/prometheus + /actuator/health
├── config/
│   └── default.toml            # default config (port, rate limits, bullets path)
├── tests/
│   ├── trajectory_test.rs      # handler-level integration tests
│   ├── batch_test.rs
│   └── bullets_test.rs
Cargo.toml                      # workspace root (new, covers engine/ + server/)
```

The `engine/` workspace and `server/` are co-members of a new top-level Cargo workspace:

```toml
# /Cargo.toml (new, at repository root)
[workspace]
members = ["engine/ballistics-core", "engine/ballistics-wasm", "server"]
resolver = "2"
```

The existing `engine/Cargo.toml` workspace root (from WA-10) is dissolved; its members are promoted to the top-level workspace.

---

## 2. `server/Cargo.toml`

```toml
[package]
name    = "ballistics-server"
version = "0.1.0"
edition = "2021"
publish = false

[[bin]]
name = "ballistics-server"
path = "src/main.rs"

[dependencies]
ballistics-engine = { path = "../engine/ballistics-core" }
axum              = { version = "0.8", features = ["macros"] }
tokio             = { version = "1", features = ["full"] }
tower             = "0.5"
tower-http        = { version = "0.6", features = ["fs", "compression-gzip", "set-headers", "trace"] }
serde             = { version = "1", features = ["derive"] }
serde_json        = "1"
toml              = "0.8"
tracing           = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
metrics           = "0.24"
metrics-exporter-prometheus = { version = "0.16", features = ["http-listener"] }
governor          = "0.8"       # rate limiting (token bucket)

[dev-dependencies]
axum-test         = "0.5"
tokio-test        = "0.4"
```

---

## 3. Configuration (`server/config/default.toml`)

```toml
[server]
host = "0.0.0.0"
port = 8080

[api]
# Rate limiting: requests per second per IP, sustained bucket
rate_limit_rps    = 60
rate_limit_burst  = 20
# Maximum request body size (bytes)
max_body_bytes    = 65536

[physics]
# bullets.yaml path; relative to the working directory.
bullets_path = "src/main/resources/bullets.yaml"

[tls]
# Empty = plain HTTP. Set cert_path + key_path for TLS.
cert_path = ""
key_path  = ""
```

Environment variables override any TOML key using the prefix `BALLISTICS__` with `__` as separator (e.g. `BALLISTICS__SERVER__PORT=9090`). The `config` crate (`config = "0.14"`) handles layered configuration (TOML defaults → env override).

**`physics-tables.yaml` elimination:** The G1/G7 drag tables and atmosphere constants that were previously in `physics-tables.yaml` and loaded at runtime by the Spring `PhysicsTables` bean are now compiled into `ballistics-core`. The YAML file is deleted. If runtime-configurable physics tables become a future requirement, they are a new story.

---

## 4. API route mapping

All routes from the Spring Boot implementation are preserved at the same paths. The `be-jsonrpc-contract.md` protocol is authoritative; this contract only records the route registration.

| Spring Controller | Axum handler | Path |
|---|---|---|
| `TrajectoryController.compute` | `trajectory::handle` | `POST /api/trajectory` |
| `TrajectoryController.batch` | `batch::handle` | `POST /api/trajectories/batch` |
| `BulletsController.list` | `bullets::handle` | `GET /api/bullets` |
| `ServeStaticFile` (WebMvcConfigurer) | `tower_http::ServeDir` | `GET /assets/**`, `GET /**` (SPA fallback) |
| `ActuatorController` (Prometheus) | `metrics::prometheus_handler` | `GET /actuator/prometheus` |
| Health liveness | `metrics::health_live` | `GET /actuator/health` |
| Health readiness | `metrics::health_ready` | `GET /actuator/health/readiness` |

The SPA fallback (`GET /**` → `index.html`) must be handled after the static assets. If a path exists under `/assets/`, serve the file; otherwise return `index.html` with status `200`.

---

## 5. Request/response bodies

The request and response JSON is **identical** to the Spring Boot implementation. See `be-jsonrpc-contract.md` for field names, types, error envelopes, and validation rules.

The Axum handlers use `axum::extract::Json<T>` for parsing. The `TrajectoryRequest` and `Bullet` structs are imported from `ballistics_engine::types`. Deserialization errors (malformed JSON, type mismatches) return `400 Bad Request` with the standard error envelope.

**Input validation:** the Rust `types::TrajectoryParams::validate()` method (already in `ballistics-core`, matching the Java Bean Validation annotations) is called on every request. A validation failure returns a `400` error envelope with `code: -32602` and a descriptive message, matching the Spring behaviour.

---

## 6. Security headers

The Spring `SecurityHeadersFilter` is replaced by a `tower-http::SetResponseHeaderLayer` applied globally. The exact header values must match the existing production headers byte-for-byte (verified by the `security-headers.test.ts` integration test, which runs against the backend regardless of implementation language).

Required headers and values (see `api-hardening.md` for the authoritative list):

| Header | Value |
|---|---|
| `Content-Security-Policy` | (preserve current value from `api-hardening.md`) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (production only; skip in dev) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | (preserve current value) |

The middleware order: rate limit → security headers → compression → router. `CompressionLayer` is applied only to API responses and to static assets served with `Content-Type: application/json` or `text/javascript`. WASM files must **not** be gzip-compressed at the HTTP layer (browsers decompress them separately; double compression corrupts the streaming compile).

---

## 7. Rate limiting

Replace Spring `RateLimitFilter` with the `governor` crate (token bucket, per-IP). Configuration from `default.toml §3`.

Behavior on rate-limit breach: `429 Too Many Requests` with `Retry-After: 1`. This matches the Spring behaviour documented in `api-hardening.md`.

---

## 8. Bullets catalog

The `bullets.yaml` file is loaded at startup, validated, and stored in `Arc<Vec<Bullet>>` shared across all request handlers. The loading path comes from `config.physics.bullets_path`. The catalog is never refreshed at runtime.

If `bullets.yaml` cannot be found or is malformed at startup, the server exits with a non-zero code and a clear error message. It does not start in a degraded state.

---

## 9. Coverage gate

JaCoCo is eliminated with the Spring Boot backend. Rust coverage replaces it.

Coverage tool: `cargo-llvm-cov` (already in CI for `engine/`). Minimum line coverage: **100%** for `server/src/`, consistent with the project-wide 100% requirement for all layers.

Coverage is measured per `cargo llvm-cov --workspace --lcov --output-path target/lcov.info`. The CI gate fails on coverage < 100% for the `ballistics-server` crate. All error branches (startup failures, bad config) must be exercised by tests — use `mockall` or test-only feature flags where real runtime panics are impractical.

The 100% Jest coverage requirement for the frontend is unaffected.

---

## 10. Docker image

### 10.1 Multi-stage Dockerfile (replacement)

```dockerfile
# Stage 1: build WASM (unchanged from current Dockerfile)
FROM rust:1.100@sha256:e19840879045c951c905d0eaa9887f3439c62000e429963371b376bac8d38c31 AS wasm-builder
WORKDIR /build
COPY engine/ engine/
COPY Cargo.toml Cargo.lock ./
RUN cargo build -p ballistics-wasm --release

# Stage 2: build frontend (Node; unchanged from current Dockerfile)
FROM node:22.23.4-alpine AS frontend-builder
WORKDIR /build
COPY package*.json vite.config.js ./
COPY src/main/resources/static/ src/main/resources/static/
COPY --from=wasm-builder /build/engine/pkg/ engine/pkg/
RUN npm ci && npm run build

# Stage 3: build Rust server
FROM rust:1.100@sha256:e19840879045c951c905d0eaa9887f3439c62000e429963371b376bac8d38c31 AS server-builder
WORKDIR /build
COPY server/ server/
COPY engine/ballistics-core/ engine/ballistics-core/
COPY Cargo.toml Cargo.lock ./
RUN cargo build -p ballistics-server --release && \
    strip target/release/ballistics-server

# Stage 4: final image
FROM alpine:3.23@sha256:...
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=server-builder /build/target/release/ballistics-server .
COPY --from=frontend-builder /build/target/classes/static/ static/
COPY server/config/default.toml config/default.toml
COPY src/main/resources/bullets.yaml config/bullets.yaml
ENV BALLISTICS__PHYSICS__BULLETS_PATH=/app/config/bullets.yaml
EXPOSE 8080
ENTRYPOINT ["/app/ballistics-server"]
```

**Image size target:** ≤ 25 MB compressed (vs ~200 MB for the JRE image). The stripped `ballistics-server` binary is ~12–18 MB; `alpine` base + CA certs adds ~6 MB; static assets add ~2–4 MB.

**Cold start target:** ≤ 5 ms from process start to first request accepted (Tokio worker pool init + bullets YAML parse; no JVM warmup, no Spring context).

### 10.2 Removed build stage

The `maven:3-eclipse-temurin-25-alpine` build stage and the `eclipse-temurin:25-jre-alpine` runtime stage are removed. Any Dockerfile digest pins for those images are removed from `ci.yml` and from the `ci-3-toolchain-alignment` notes.

---

## 11. CI changes

| Job | Before WA-11 | After WA-11 |
|---|---|---|
| `java-build` | Runs `mvn verify`, produces JAR | **Renamed to `server-build`**: runs `cargo test -p ballistics-server`, `cargo llvm-cov`, Docker build |
| `rust-build` | Builds engine WASM only | Also builds `ballistics-server` as a dry-run (`cargo build -p ballistics-server`) |
| `frontend-build` | Runs `npm test`, `npm run build` | Unchanged |
| `devsecops` | Trivy scans JAR image | Scans new Alpine + Rust binary image |

The `java-build` job name and all `needs: [java-build]` references in CI are updated to `server-build`. The JaCoCo coverage step is removed; `cargo llvm-cov` replaces it.

---

## 12. Threat model delta

| STRIDE | Threat | Mitigation |
|---|---|---|
| Spoofing | Rust panics in a handler crash the entire process (no JVM catch-all). | `axum`'s catch-unwind middleware (`axum::middleware::from_fn` wrapping `std::panic::catch_unwind`) converts handler panics to `500` responses. All handler code uses `Result` returns; panics are reserved for startup failures. |
| Tampering | `physics-tables.yaml` removed — no runtime physics-table injection path. | Positive: eliminates a configuration-injection surface. |
| Information disclosure | Rust `panic!` messages may contain internal paths or stack frames. | `tower_http::TraceLayer` logs panics internally. The `500` response body contains only the standard error envelope. |
| Availability | No JVM GC pauses. Memory is bounded by Rust allocator + request body cap. | `max_body_bytes` enforced by `axum::extract::DefaultBodyLimit::max(config.api.max_body_bytes)`. |
| Availability | Bullets YAML loaded once at startup; a corrupt YAML crashes startup. | Startup validation exits non-zero with a clear message; orchestrator restarts. No runtime reload surface. |
| Elevation | Native binary runs as root in the container. | Dockerfile adds `USER nobody` before `ENTRYPOINT`. Port 8080 is non-privileged on Linux. |

NIST SSDF SP 800-218 mapping:
- **PW.4.1** (use vetted software): `axum 0.8`, `tokio 1`, `tower-http 0.6` are audited crates with active security advisories tracked via `cargo audit` in CI.
- **PW.6.1** (harden the executable environment): stripped binary, non-root user, Alpine minimal base, no shell in final image.

---

## 13. Acceptance checklist

- [ ] `cargo build -p ballistics-server` succeeds with no warnings (`-D warnings`).
- [ ] `cargo test -p ballistics-server` passes all integration tests.
- [ ] `cargo llvm-cov -p ballistics-server` reports 100% line coverage.
- [ ] `POST /api/trajectory` returns the same JSON as the Spring Boot endpoint for all 10 parity-tested bullets (verified by a cross-implementation test script in `server/tests/`).
- [ ] `POST /api/trajectories/batch` returns results in request order.
- [ ] `GET /api/bullets` returns the catalog; `Cache-Control: max-age=3600` is present.
- [ ] `GET /assets/index-[hash].js` returns `200` with `Cache-Control: public, max-age=31536000, immutable`.
- [ ] `GET /assets/[hash].wasm` returns `Content-Type: application/wasm`.
- [ ] `GET /nonexistent-path` returns `index.html` with status `200` (SPA fallback).
- [ ] All security headers from §6 are present on every `/api/*` response.
- [ ] Rate limit returns `429` after burst is exceeded; `Retry-After: 1` header present.
- [ ] `GET /actuator/health` returns `{"status":"UP"}` with `200`.
- [ ] `GET /actuator/prometheus` returns Prometheus text format with at least one metric.
- [ ] Docker image builds and starts; `curl http://localhost:8080/actuator/health` returns `200` within 5 ms of container start accepting connections.
- [ ] Docker image size ≤ 25 MB compressed.
- [ ] Container runs as non-root user (`nobody`).
- [ ] `src/main/java/` and `pom.xml` are removed.
- [ ] `physics-tables.yaml` is removed (constants are in `ballistics-core`).
- [ ] `BACKLOG.md` marks WA-11 done in the same PR.

---

## 14. Task split

| ID | Owner | Task |
|---|---|---|
| WA11-BE-1 | Rust/BE | Scaffold `server/` crate: `Cargo.toml`, `main.rs`, `config.rs`, `default.toml`. Connect top-level workspace `Cargo.toml`. |
| WA11-BE-2 | Rust/BE | Implement `routes/trajectory.rs` and `routes/batch.rs`: parse `TrajectoryRequest`, call `ballistics_engine::compute_trajectory_internal`, return `TrajectoryResponse` or error envelope. |
| WA11-BE-3 | Rust/BE | Implement `routes/bullets.rs` (catalog load, `Arc` sharing, `Cache-Control` header). |
| WA11-BE-4 | Rust/BE | Implement `middleware/security_headers.rs` and `middleware/rate_limit.rs`. Wire `ServeDir` for static assets. SPA fallback. |
| WA11-BE-5 | Rust/BE | Implement `metrics.rs`: health endpoints, Prometheus metrics. |
| WA11-BE-6 | Rust/BE | Write `server/tests/` integration tests covering all acceptance criteria. Verify `cargo llvm-cov` = 100%. |
| WA11-DS-1 | DevSecOps | Update Dockerfile (§10.1). Remove Maven/JRE stages. Rename `java-build` → `server-build` in CI. Add `cargo audit` and Trivy scan of new image. Remove Spring Boot dependencies from `dependabot.yml`. |
| WA11-DS-2 | DevSecOps | Delete `src/main/java/`, `pom.xml`, `physics-tables.yaml`, Spring-related config files. Confirm no dead references remain. |
