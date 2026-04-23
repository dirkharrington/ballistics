# Ballistics visualizer — improvement plan

## Phase 1 · Critical safety & correctness

| # | Task | Tag |
|---|------|-----|
| 1 | **Sanitize innerHTML injection points** — Replace innerHTML with textContent for all user-supplied values in `renderResults`, `renderTable`, `renderBulletList`. Prevents XSS via custom round names. | frontend |
| 2 | **Fix physics inconsistency: Euler vs RK4** — Replace `findZeroAngle`'s simple Euler integrator (dt=0.001) with RK4 to match the main trajectory solver. Current mismatch causes systematic zero-angle error at long range. | backend |
| 3 | **Fix wind drift formula** — Replace `x/mvFps` with actual simulated TOF at zero wind. Current Pejsa shortcut underestimates drift because it assumes constant velocity downrange. | frontend |
| 4 | **Remove wildcard CORS** — Replace `@CrossOrigin(origins="*")` with a `@ConfigurationProperties`-bound list so allowed origins are set per environment in `application.properties`. | backend |
| 5 | **Revoke object URLs after export** — Call `URL.revokeObjectURL()` immediately after `a.click()` in both `exportCSV` and `exportPNG` to prevent memory leaks. | frontend |

---

## Phase 2 · Backend reliability & performance

| # | Task | Tag |
|---|------|-----|
| 6 | **Deduplicate TrajectoryRequest before caching** — Normalize requests in a compact constructor before they reach `@Cacheable` — requests with `step=0` and `step=25` should hit the same cache key. Currently they are stored separately but return identical results. | backend |
| 7 | **Replace ForkJoinPool with bounded executor** — Inject a named `ThreadPoolExecutor` into `compareTrajectories` to prevent unbounded parallelism under load competing with other JVM work. | backend |
| 8 | **Move bullet catalog to a singleton bean** — Extract `knownRifleBullets()` result into a `@Bean("bulletCatalog")` `List<Bullet>`. Eliminates repeated list allocation on every controller request and hot spot in benchmarks. | backend |
| 9 | **Add rate limiting to compare endpoint** — Apply Bucket4j or Spring's `@RateLimiter` to `/api/trajectories/compare` — 10 parallel bullets per request without limits means a single client can saturate the thread pool. | backend |
| 10 | **Promote CompareRequest to top-level class** — Move the inner record out of `BallisticsController` so OpenAPI discovers it without reflection tricks and it is independently testable. | backend |
| 11 | **Expose sight height as a request parameter** — Replace the hardcoded 1.5 inch constant in `findZeroAngle` with an optional `sightHeightMm` field on `TrajectoryRequest` (defaulting to 38.1 mm). Affects all mid-range predictions. | backend |

---

## Phase 3 · Testing & build quality

| # | Task | Tag |
|---|------|-----|
| 12 | **Strip @SpringBootTest from pure unit tests** — `BulletTest`, `TrajectoryPointTest`, `TrajectoryRequestTest`, `TrajectoryResultTest` need no Spring context. Switch to plain JUnit + `@ExtendWith(MockitoExtension.class)` — reduces test suite time by ~10×. | testing |
| 13 | **Rewrite TrajectoryCacheTest without isSameAs** — Spy on `BallisticsEngine` and assert the computation method is called exactly once for two identical requests. Current `isSameAs` is coupled to Caffeine's identity semantics. | testing |
| 14 | **Add contract test: compare vs single trajectory** — Assert that `/api/trajectories/compare` results for each bullet match individual `/api/trajectory` calls. Catches any threading or request-merge bugs. | testing |
| 15 | **Enable JS coverage threshold in Maven build** — Remove `--no-coverage` from the npm test invocation in `pom.xml` and add a Jest `coverageThreshold` (e.g. 80% branches) so regressions fail the build. | build |
| 16 | **Add client-side validation to runCustom** — Validate weight > 0, BC in (0, 1.2], MV > 0, diameter > 0 before fetch. Show an inline error message rather than letting the server return a 400 with no visible feedback. | frontend |

---

## Phase 4 · Architecture & DX improvements

| # | Task | Tag |
|---|------|-----|
| 17 | **Move bullet catalog to YAML/JSON resource** — Load `src/main/resources/bullets.yaml` at startup via `@ConfigurationProperties` or a simple `@Bean` Jackson parse. Lets non-developers add rounds without touching Java. Becomes the canonical source for the JS mock data too. | arch |
| 18 | **Eliminate duplicated physics between Java and JS** — The G1 table, atmosphere model, and RK4 integrator exist in both `BallisticsEngine.java` and `ballistics.js`. Either call `/api/simulate-single` for the offline fallback, or generate the JS constants from the Java source via a build step. | arch |
| 19 | **Remove window.* global function pollution** — Replace all `onclick="fn()"` inline handlers with `addEventListener` calls in `init()`. Removes 6 globals from `window` and makes the module testable in isolation. | frontend |
| 20 | **Show offline indicator when API fallback activates** — Change the READY status pill to OFFLINE — LOCAL COMPUTE when fetch throws. Users currently have no indication they are seeing less accurate client-side results. | frontend |
| 21 | **Match JS integrator to Java RK4** — Replace the Euler loop in `simulateBullet` with the same 4th-order RK4 used in `BallisticsEngine.java`. Current divergence is several cm at 600 m+ range. | frontend |

---

## Implementation notes

**Sequencing within phases**

- Complete t2 (RK4 zero-finder) before t21 (match JS to Java) — get the authoritative implementation right first, then mirror it.
- Complete t17 (YAML catalog) before t18 (eliminate physics duplication) — the catalog refactor defines what "canonical source" means for the deduplication work.
- All other tasks within a phase are independent of each other.

**Phase 1 status: complete**
Tasks 1–5 were implemented in the first pass. Files changed: `ballistics.js`, `BallisticsEngine.java`, `BallisticsController.java`, `CorsConfig.java` (new), `application.properties`.
