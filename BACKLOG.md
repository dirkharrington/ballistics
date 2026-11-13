# Backlog

_Baseline: 2026-11-13 · Reset for pure-browser SPA. All physics run in WASM in the browser._
_Sprint history archived in git (through PR #82)._

---

## Milestone 1 — Drop the server

### SPA-1 · Remove server API calls · FE · Size M

Replace every `fetch('/api/...')` call in `ballistics.js` with WASM engine calls or pure JS. No server should be reachable or required at runtime.

**Call sites to replace:**

| Call | Replacement |
|---|---|
| `POST /api/rpc` (trajectory, 2 sites) | `computeTrajectory()` via WASM worker (already the primary path in `runSimulation`; remove the REST fallback) |
| `POST /api/trajectories/custom` | Same WASM worker call — custom single-round is identical to the standard path with extra fields |
| `GET /api/trajectories/compare/stream` (SSE) | Compute both trajectories in parallel WASM worker calls; replace progressive SSE rendering with progressive rendering driven by `Promise.all` + `requestAnimationFrame` |
| `POST /api/trajectories/compare` (non-streaming fallback) | Same parallel WASM worker calls |
| `POST /api/rpc` (`bullets.list` online probe) | Delete — no server means no probe; remove all online/offline toggle logic |

**What stays:**
- `simulateBulletJS()` JS fallback for no-WASM browsers (keep as-is)
- `virtual:bullet-catalog` plugin (bullets already bundled at build time — no change needed)
- Service Worker caching (still useful for repeat visits and true offline)

**Coverage:** 100% Jest. All replaced paths need new or updated tests covering WASM-success and JS-fallback branches for every code path the removed fetch calls served.

**Acceptance:**
- Opening `index.html` from `file://` (no server at all) loads the app, populates the bullet list, and computes trajectories.
- No network requests to `/api/` are issued under any interaction.
- Compare tab returns results for both rounds.
- Jest passes at 100/100/100/100.

---

### SPA-2 · Remove Java/Spring Boot backend · BE / DevSecOps · Size S

Delete the server-side Java code and its build tooling. No Java should remain.

**Delete:**
- `src/main/java/` — all Spring Boot application code
- `src/test/java/` — all JUnit / JaCoCo tests
- `pom.xml`, `mvnw`, `mvnw.cmd`, `.mvn/`
- `Dockerfile` (server stages; WASM build moves to CI scripts or a Rust-only Dockerfile)
- `docker-compose.yml`, `docker-compose.monitoring.yml`
- `src/main/resources/physics-tables.yaml` — only consumed by the Java engine; WASM has its own constants
- `src/main/resources/application*.yml` — Spring config

**Keep:**
- `src/main/resources/static/` — the entire frontend
- `src/main/resources/bullets.yaml` — bullet catalog source of truth (consumed by `vite.config.js` via `virtual:bullet-catalog`)
- `engine/` — Rust WASM workspace

**CI:** Remove the `java-build` job and all `needs: [java-build]` references. Remove JaCoCo coverage step. Remove OWASP dependency check (Java-only; Trivy covers npm). Keep `rust-build` (WASM) and `frontend-build` (Jest + Vite).

**Acceptance:**
- `npm run build` produces a working `dist/` with no Java toolchain present.
- CI passes with only `rust-build` and `frontend-build` jobs.
- No `.java` files remain in the repo.

---

## Milestone 2 — Clean project structure

### SPA-3 · Flatten source layout · FE / DevSecOps · Size S

The Maven directory convention (`src/main/resources/static/`) is a Java artifact. With Spring Boot gone, rename it to something idiomatic for a frontend project.

**Move:**
- `src/main/resources/static/` → `app/`
- `src/main/resources/bullets.yaml` → `app/data/bullets.yaml`

**Update:**
- `vite.config.js`: set `root: 'app'`, `outDir: '../dist'`, update all `resolve(__dirname, 'src/main/resources/...')` paths
- `package.json` test paths (`src/test/js/` stays or moves to `app/tests/` — pick one and update Jest config)
- CI `paths-filter` entries
- Service Worker asset paths (auto-handled by Vite hash injection)

**Acceptance:**
- `npm run build` outputs to `dist/`
- `npm test` finds and runs all Jest suites
- No path in the repo references `src/main/resources`

---

## Milestone 3 — Static hosting

### SPA-4 · Deploy to static host · DevSecOps · Size S

Add a CI deploy job that publishes the Vite build output to a static host on every push to `main`.

**Recommended host:** GitHub Pages (zero infra cost, same repo).

**Work items:**
1. Add `deploy` job in `ci.yml` that runs after `frontend-build` and `rust-build`, conditioned on `github.ref == 'refs/heads/main'` and `github.event_name == 'push'`
2. Use `actions/deploy-pages` (or equivalent) to publish `dist/`
3. Set Vite `base` URL to match the deployed path (e.g. `/ballistics/` for GitHub Pages project site, or `/` for a custom domain)
4. Update Service Worker scope to match
5. Add `CNAME` file if using a custom domain

**Acceptance:**
- Push to `main` → site live at the configured URL within 2 minutes
- Service Worker registers and caches assets on first load
- Hard refresh on the deployed URL loads the app without 404

---

## Milestone 4 — Optimisation

### SPA-5 · SIMD acceleration · Rust · Size M

Enable WebAssembly SIMD in `ballistics-core` for 2–4× speedup on Chrome/Firefox. Most impactful on ELR trajectories (3000+ m).

**Work items:**
1. Add `#[cfg(target_feature = "simd128")]` opt-in path in the trajectory integrator hot loop (`ballistics.rs`). Gate with a Rust `simd` feature flag.
2. Keep the scalar path as the default; SIMD activates when the browser supports it (wasm-pack emits a feature-detect shim, or use `wasmFeatureDetect` from the loader).
3. Add a `simd` build in `ci.yml` that runs `wasm-pack build --features simd` and validates the output.
4. Benchmark at 1000 m, 2000 m, 3000 m before and after; record in a commit comment.
5. 100% `cargo-llvm-cov` coverage maintained for both paths.

**Acceptance:**
- Chrome 91+ and Firefox 89+ receive the SIMD binary and compute faster
- Browsers without SIMD receive the scalar binary and compute correctly
- All Rust tests pass with and without the `simd` feature flag
- No regression in trajectory output values

---

## Open questions

1. **Custom domain?** GitHub Pages works under `username.github.io/ballistics`; a custom domain needs a `CNAME` and DNS record.
2. **Bullet catalog editing?** Currently read-only (bundled at build time). Should users be able to add/edit bullets locally (e.g. saved to `localStorage`)? Raise as a new story if yes.
3. **Trajectory export?** CSV / PDF download is pure-client and straightforward — raise as a new story if wanted.
