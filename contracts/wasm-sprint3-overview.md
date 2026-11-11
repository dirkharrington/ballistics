# WASM Sprint 3+ Overview

Version: 0.1.0 — 2026-11-11  
Author: Architect  
Stories: WA-9, WA-10, WA-11, WA-12, WA-13  
Contracts:
- [`wa9-simd.md`](./wa9-simd.md)
- [`wa10-shared-crate.md`](./wa10-shared-crate.md) · ADR: [`adr-006-ballistics-engine-crate.md`](./adr-006-ballistics-engine-crate.md)
- [`wa11-rust-backend.md`](./wa11-rust-backend.md) · ADR: [`adr-007-rust-backend-framework.md`](./adr-007-rust-backend-framework.md)
- [`wa12-custom-drag.md`](./wa12-custom-drag.md)
- [`wa13-coriolis.md`](./wa13-coriolis.md)

---

## 1. Stories at a glance

| Story | Title | Size | Depends on | Owner |
|---|---|---|---|---|
| WA-9 | SIMD Acceleration | M | none | Rust/BE + FE |
| WA-10 | Shared Engine Crate | M | none | Rust/BE |
| WA-11 | Rust Backend | XL | **WA-10 required** | Rust/BE + DevSecOps |
| WA-12 | Custom Drag Function | L | none | All |
| WA-13 | Coriolis Effect | M | none | All |

---

## 2. Dependency graph

```
WA-9 ─────────────────────────────────────────────────► merge
WA-10 ────────────────────────────────────────────────►─┐
                                                          └─► WA-11 ──► merge
WA-12 ────────────────────────────────────────────────► merge
WA-13 ────────────────────────────────────────────────► merge
```

**Hard dependency:** WA-11 requires WA-10 to be **merged to main** before work starts. WA-10 restructures the Cargo workspace and renames internal crate paths; WA-11 depends on `ballistics-core` by path. Building WA-11 on a branch before WA-10 is merged causes merge-conflict churn in `Cargo.toml`, `Cargo.lock`, and `pom.xml` removal.

**Soft coupling (not a dependency, but coordinate):**
- WA-9 adds a `simd` Cargo feature to `ballistics-core` (after WA-10 renames the crate). The WA-9 implementer must rebase onto the WA-10 branch or merge after WA-10.
- WA-12 and WA-13 both touch `TrajectoryParams` and `TrajectoryPoint`. If both are worked concurrently, their PRs must be rebased carefully. See §3 for the sequencing recommendation.

---

## 3. Build order and parallelism

### Recommended sequence

```
Sprint 3A (all parallel after WA-10 is designed):
  ├── WA-10 (Rust/BE only; merge to main first)
  ├── WA-12 (can start immediately, no Rust workspace changes)
  └── WA-13 (can start immediately)

Sprint 3B (after WA-10 is merged):
  ├── WA-9  (rebase onto post-WA-10 main)
  └── WA-11 (starts only after WA-10 merges)

Sprint 3C:
  └── WA-11 continues (longest story)
```

| Parallelism opportunity | Notes |
|---|---|
| WA-12 ∥ WA-13 | Both touch `TrajectoryParams` (Rust + Java) and the UI. Assign to separate engineers; merge in either order. Second PR will have a minor rebase on `types.rs`. |
| WA-9 ∥ WA-11 (after WA-10 merged) | WA-9 is Rust-only (no Java/JS interaction). WA-11 is a large story but its backend Rust work is independent. |
| WA-12 ∥ WA-13 ∥ WA-9 | All three can be in-flight simultaneously once WA-10 is merged. |

### Strictly sequential

| Order | Reason |
|---|---|
| WA-10 before WA-11 | WA-11 depends on `ballistics-core` path (see §2). |
| WA-10 before WA-9 rebases | WA-9 adds a feature to `ballistics-core/Cargo.toml`, which doesn't exist until WA-10 merges. WA-9 can be developed in parallel but must rebase/merge after WA-10. |

---

## 4. Impact matrix

| Layer | WA-9 | WA-10 | WA-11 | WA-12 | WA-13 |
|---|---|---|---|---|---|
| `engine/ballistics-core/` (Rust physics) | SIMD inner loop | Crate extraction | — | Custom drag table | Coriolis computation |
| `engine/ballistics-wasm/` (WASM boundary) | Build feature flag | Move `lib.rs` | — | — | — |
| `server/` (new Rust backend) | — | — | Full new crate | Routes updated | Routes updated |
| `src/main/java/` (Spring Boot) | — | — | **Deleted** | Add field + logic | Add field + logic |
| `src/main/resources/static/` (frontend) | Loader update | — | — | CSV parser, file input | UI fields, table col |
| `contracts/` | This doc | ADR-006, wa10 | ADR-007, wa11 | wa12 | wa13 |
| `pom.xml` | SIMD wasm-pack exec | Path update | **Deleted** | — | — |
| `Dockerfile` | — | Stage path update | Full rewrite | — | — |
| `.github/workflows/ci.yml` | SIMD artifact | wasm-pack path | Rename java→server | — | — |
| `BACKLOG.md` | Mark done | Mark done | Mark done | Mark done | Mark done |
| `engine-parity.md` | — | — | — | Custom drag section | Coriolis section |

---

## 5. Open questions (require user decision before implementation)

| # | Story | Question | Recommendation |
|---|---|---|---|
| OQ-1 | WA-10 | Java engine deprecation plan. After WA-11 replaces Spring Boot, the Java engine (`BallisticsEngine.java`) is still the parity reference for WASM output. When and how is it retired? WA-12 and WA-13 require updates to the Java engine if it remains active. | Keep the Java engine active until WA-11 is merged and the Rust engine is the server. Post-WA-11, the Rust engine (`ballistics-core`) becomes the server-side authority. Java can be archived. The parity test suite migrates from Java-generated golden files to Rust-generated ones. |
| OQ-2 | WA-11 | Does the Prometheus scrape path stay at `/actuator/prometheus` or move to `/metrics`? The Grafana/Prometheus config currently points to the Spring Boot path. | Preserve `/actuator/prometheus` as a path alias to avoid config changes in the monitoring stack. Add `/metrics` as a second alias. |
| OQ-3 | WA-11 | `physics-tables.yaml` elimination: are runtime-tunable G1/G7 tables ever needed? | No current use case. Eliminate. Document in WA-11 release notes that physics constants are now compiled in. |
| OQ-4 | WA-12 | Should the custom drag table be persisted in browser `localStorage` for reuse across sessions? | Yes, as a convenience (not a security concern — it's the user's own data). Store under a `ballistics.customDragTable` key. Load on page init; clear on "Reset". |
| OQ-5 | WA-13 | Should `azimuthDeg` be a compass-rose picker (UI) or a plain number input? | Plain number for the first implementation; a compass rose can be a UI refinement. |
| OQ-6 | WA-9 | SIMD binary size budget: the contract allows 170 KB gzip. If the SIMD binary exceeds this (due to SIMD intrinsic expansion), is that acceptable? | Increase the budget to 200 KB gzip if needed; the extra 50 KB is a worthwhile tradeoff for 2× perf on ELR trajectories. |

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **WA-11 scope creep:** replacing Spring Boot surfaces hidden Spring-isms (security config, error handling edge cases) that weren't in contracts | Medium | High (delay) | The devsecops review gate (security-headers.test.ts, rate-limit tests) catches deviations before merge. The JSON-RPC contract (`be-jsonrpc-contract.md`) is the acceptance test surface. |
| **WA-9 parity failure:** SIMD inner loop produces different rounding than scalar due to SIMD FMA contraction | Medium | Medium (must fix before merge) | The parity test suite (ε = 0.01) catches this. If SIMD FMA produces results outside ε, disable FMA for the SIMD build with `-C target-feature=+simd128,-fma`. |
| **WA-10 wasm-pack path change:** build breaks in a subtle way (wrong `--out-dir`) | Low | Low | Covered by the CI JAR-content check (§2.4 of `wasm-integration.md`). |
| **WA-12 drag table DoS:** an attacker submits a table with 100 points on every request, combined with a 3000 m trajectory, increasing compute time | Low | Low | Validation is O(100). The rate limit (60 rps per IP) bounds the total compute load. The body-size cap limits table payload. |
| **WA-13 approximation error:** `v_muzzle × t²` formula overstates Coriolis by 15–20% at 2000 m | Certain | Low | Acceptable for the first implementation (err conservative). Documented in `wa13-coriolis.md` §1.3. The parity threshold (ε = 0.01) only checks Rust vs Java agreement, not formula accuracy. |
| **WA-11 coverage gap:** Axum handler error branches (body size exceeded, TLS init) can't be hit in unit tests | Medium | Low | Coverage threshold is 90% (not 100%) for `ballistics-server`. The devsecops review assesses whether uncovered lines are genuinely unreachable. |
| **WA-10/WA-11 concurrency conflict:** both stories touch `Cargo.lock` | Low | Low | WA-10 merges first (§3); WA-11 starts after. No concurrent `Cargo.lock` edits. |

---

## 7. Sprint definition of done

All five stories merged to `main` with:

- [ ] All acceptance checklists in the respective contracts fully checked.
- [ ] `engine-parity.md` updated with WA-12 (custom drag) and WA-13 (Coriolis) sections.
- [ ] `BACKLOG.md` marks all five stories done.
- [ ] Jest coverage: 100/100/100/100 maintained throughout.
- [ ] JaCoCo: 100% maintained (until WA-11 merges, at which point JaCoCo is eliminated and replaced by `cargo-llvm-cov` ≥ 90%).
- [ ] DevSecOps PASS or PASS WITH NOTES (no BLOCKs) on each PR.
- [ ] The production Docker image reflects the new Rust backend (post WA-11).

---

## 8. Recommended ADR review

Before delegating WA-10 and WA-11 to builders, the user should review and approve:

1. **ADR-006** (`adr-006-ballistics-engine-crate.md`) — workspace restructure decision. The main tradeoff is build complexity (two crates) vs clean separation. Approve or redirect before WA-10 implementation begins.
2. **ADR-007** (`adr-007-rust-backend-framework.md`) — Axum vs Actix-web. The main tradeoff is Tower ecosystem alignment vs marginal throughput. Approve or redirect before WA-11 implementation begins.

ADRs for WA-9, WA-12, and WA-13 are not required (no major architecture decisions; tactical implementation choices).
