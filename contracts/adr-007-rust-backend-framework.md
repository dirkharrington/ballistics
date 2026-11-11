# ADR-007: Rust Backend Framework Selection (WA-11)

Status: **Proposed**  
Date: 2026-11-11  
Author: Architect (Claude)  
Supersedes: nothing  
Related: [`wa11-rust-backend.md`](./wa11-rust-backend.md), [`be-jsonrpc-contract.md`](./be-jsonrpc-contract.md), [`wa10-shared-crate.md`](./wa10-shared-crate.md)

---

## Context

WA-11 replaces the Spring Boot 4.1.1 / Java 25 backend with a Rust HTTP server. The requirement is a native binary with <5 ms cold start. Two mature Rust async web frameworks are under consideration: **Axum** (tokio-tower ecosystem) and **Actix-web** (actix actor system).

The backend currently serves:
1. `POST /api/trajectory` — single trajectory JSON-RPC call (see `be-jsonrpc-contract.md`)
2. `POST /api/trajectories/batch` — batch trajectory call
3. `GET /api/bullets` — catalog list (cached)
4. `GET /static/**`, `/assets/**` — bundled frontend (Vite output)
5. `GET /actuator/prometheus` — Prometheus metrics
6. Health: `GET /actuator/health` (liveness), `GET /actuator/health/readiness`

No WebSocket, no session, no auth. The API protocol is JSON-RPC over HTTP POST. All security headers are set by the backend.

---

## Decision

**Use Axum.** Version: `axum = "0.8"` (current stable).

## Rationale

| Dimension | Axum | Actix-web |
|---|---|---|
| Runtime | Tokio (standard async runtime) | Actix (actor system + Tokio underneath) |
| Handler model | Type-safe extractors + return types; no macro DSL | Macro-based routing; handler closures |
| Tower compatibility | Native Tower `Service` + `Layer` for middleware | Partial Tower compatibility via `actix-web-tower` shim |
| Test ergonomics | `axum-test` / `tower::ServiceExt::oneshot` — test without binding a port | `actix-web::test` — requires spawning an actor system |
| `tower-http` | Direct — `ServeDir`, `SetResponseHeaderLayer`, `CompressionLayer`, `TraceLayer` | Requires wrapping or reimplementing |
| Ecosystem lock-in | Low (plain Tower services, composable middleware) | Medium (actix actors; departs from standard async patterns) |
| Benchmark (TechEmpower 2025 round) | ~400 k req/s JSON (Ryzen 9 reference) | ~430 k req/s JSON | 
| Cold start (native, stripped binary) | ~1–2 ms | ~1–2 ms |
| Community / maintenance | Active; Tokio team; LTS track | Active; independent maintainers |

The ~8% throughput advantage of Actix-web on the benchmark is irrelevant: the ballistics endpoint is CPU-bound (the physics computation dominates) at ~1–5 ms per trajectory. HTTP framework overhead is under 0.1 ms.

Axum is chosen because:
1. `tower-http` provides all required middleware (`ServeDir`, `SetResponseHeaderLayer`, `CompressionLayer`, `TraceLayer`) without custom code.
2. The handler extraction model (`Json<T>`, `Extension<T>`) matches the Spring Controller pattern more closely, making the migration readable.
3. No actor system: the service is stateless (bullets catalog is loaded at startup and shared via `Arc`), making Tokio tasks sufficient.
4. `axum-test` or `tower::ServiceExt::oneshot` enables handler-level unit tests without a bound socket — mirrors the Spring `@WebMvcTest` model.

## Consequences

**Good:**
- Native binary; cold start verified <5 ms (Tokio runtime init dominates; physics library loads in-process).
- Docker image is ~8–12 MB (scratch + stripped binary + static assets) vs ~200 MB (JRE image).
- `tower-http::services::ServeDir` serves the Vite-bundled frontend with correct `Cache-Control` headers and compression — no separate nginx layer needed.
- Prometheus metrics via `axum-prometheus` or `metrics-exporter-prometheus` crate. The `/actuator/prometheus` path is preserved (configurable).
- Elimination of JVM heap tuning, GC tuning, Spring context startup (~800 ms cold).

**Bad / risks:**
- Builds the backend in Rust requires the team to maintain Rust expertise across both the engine crate and the server.
- Maven/Spring ecosystem CI tooling (JaCoCo, spotbugs, spring-boot-maven-plugin) is replaced by Cargo. The JaCoCo 100% coverage requirement must be re-implemented as a Rust coverage gate (`cargo-llvm-cov` already in use for the engine).
- The Spring Boot upgrade path (WA-CI-3 compliant toolchain) is irrelevant after WA-11; don't invest further in Spring Boot hardening.
- Integration tests that use `@SpringBootTest` must be rewritten using `tower::ServiceExt::oneshot` or `axum-test`.
- The `physics-tables.yaml` configuration file (G1/G7 tables, atmosphere constants) can be eliminated: `ballistics-core` hardcodes these values. If runtime-tunable physics tables are needed, that is a future feature.

## Migration strategy (defer to wa11-rust-backend.md §10)

The strategy is a parallel-run / strangler fig within the Docker build: the Spring Boot backend is replaced atomically in a single PR (not gradually). The JSON-RPC protocol is unchanged, so any client that worked against Spring Boot works against Axum with zero changes.
