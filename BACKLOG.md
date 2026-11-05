# Sprint Backlog

_Baseline: 2026-11-03 · Spring Boot 4.1.1 / Java 21 · 354 tests · 100% coverage_

---

## P1 — Must Have

~~### MH-1 · MOA / MRAD Adjustment Chart · FE · Size S~~ ✅ Done — PR #34

Add a 5th Chart.js panel to the Trajectory Charts tab showing scope elevation
adjustment (MOA primary axis, MRAD secondary) vs. range. Zero crossing,
supersonic limit, and max-ordinate annotations mirror the existing panels;
crosshair syncs with all existing charts.

`moaAdjustment` and `mradAdjustment` are already present on every `TrajectoryPoint`
— this is a pure frontend change with no backend or contract work.

**Value:** Scope click data vs. range is the primary daily-use output for
competitive shooters. The data is computed on every request; only the
visualization is missing.

---

~~### MH-2 · Catalog Expansion — 50+ Rounds · BE · Size M~~ ✅ Done — PR #32

~~### MH-3 · Come-Ups / DOPE Card · FE · Size M~~ ✅ Done — PR #34

Add a "DOPE Card" panel to the Tools tab. The user enters 4–8 target distances;
the tool generates a come-ups table (distance → MOA up → MRAD up → windage at
10 km/h) for each selected round. One-click copy as plain text; distances encoded
in the URL state for sharing.

No new backend endpoint required — all data is present in the computed trajectory
points.

**Value:** A come-ups table is the standard deliverable a shooter takes to the
range. Completes the "compute → verify → shoot" workflow that defines the tool's
core use case.

---

~~### MH-4 · Sensitivity Analysis — Condition Sweep · FE · Size S~~ ✅ Done — PR #34

Add a "Sweep" mode to the sidebar. The user locks one bullet and sweeps a single
parameter (wind speed, altitude, or temperature) across 3–5 values. The tool
calls `POST /api/trajectories/batch` with the generated requests and renders a
family of curves on the drop or drift chart, one curve per condition value.

The batch endpoint already supports this; the UI surface is entirely absent.

**Value:** Primary research workflow for engineers and ammunition developers.
Turns the backend's parallel execution capability into a visible user feature.

---

## P2 — Should Have

~~### SH-1 · Spin Drift (Gyroscopic) · BE + FE · Size M~~ ✅ Done — PR #32 (BE), PR #34 (FE)

~~### SH-2 · BC Back-Calculator · FE · Size S~~ ✅ Done — PR #34

Add a "Solve BC" card to the Tools tab. Inputs: bullet weight (g), muzzle
velocity (m/s), measured drop (cm), measured range (m), same environmental
parameters as the main form. Solver iterates the client-side physics (bisection
on BC) to find the G1 effective BC that reproduces the observed drop within 0.5
cm. Outputs the solved BC and implied G7 BC (÷ 0.505).

Pure client-side calculation using the existing ballistics engine already imported
into `ballistics.js`. No backend work required.

**Value:** Handloaders routinely measure actual drop and back-calculate effective
BC to compare against published values. Common load-development task.

---

~~### SH-3 · Density Altitude Output · BE + FE · Size S~~ ✅ Done — PR #32 (BE), PR #34 (FE)

## P3 — Cleanup / Security

### MH-5 · Rotate NVD API Key · DevSecOps · Size 1

The `NVD_API_KEY` GitHub Actions secret is expired. The OWASP Dependency-Check
job runs but exits 0 with no report (`failOnError=false` masks the failure).
Trivy is the compensating control in the interim.

**Steps:** Rotate key at nvd.nist.gov/developers/request-an-api-key, update
`secrets.NVD_API_KEY` in repo Settings → Secrets, then flip `failOnError=false`
→ `true` so future expiry fails loudly.

**Value:** Restores full dependency-CVE coverage. OWASP catches Java library
CVEs that Trivy (filesystem scan) can miss.

---

### SH-4 · JSON-RPC Error Data Sanitisation · BE · Size 1

`JsonRpcController:238` returns `e.getMessage()` from a `JacksonException` in
the `-32602` error `data` field. This leaks internal class names and schema
details to callers.

Replace with a fixed string `"Deserialization error"` and add a test asserting
the data field never contains a class name.

Source: PR #29 NOTE 1

---

### SH-5 · Align Contract §6.4 — 413 Response Format · BE · Size 1

When a request body exceeds the size limit, `RequestBodySizeLimitFilter` returns
RFC 9457 `ProblemDetail`. Contract §6.4 specifies a JSON-RPC `-32003` error
envelope instead.

Either update the filter to return a JSON-RPC envelope, or update §6.4 to
document the ProblemDetail behaviour as intentional.

Source: PR #29 NOTE 2

---

### SH-6 · Add DEBUG Logging for JSON-RPC Method Names · BE · Size 1

Contract §9.3 states method names are logged at DEBUG on each invocation.
No such logging exists in `JsonRpcController`. Either add
`log.debug("rpc method={}", method)` before dispatch, or remove the §9.3 claim.

Source: PR #29 NOTE 3

---

### SH-7 · Boundary Tests for twistRateInchesPerTurn Validation · BE · Size 1

`BallisticsControllerTest` is missing explicit boundary tests for the
`twistRateInchesPerTurn` field:

- `0` → expect 400
- `101` → expect 400
- `100` → expect 200 (upper boundary passes)

JaCoCo at 100% doesn't catch missing validation-annotation coverage since
validation is framework-side.

Source: Sprint 1 devsecops review

---

### SH-8 · Document sg Clamping in contracts/spin-drift.md · Docs · Size 1

`BallisticsEngine.convertInputs` clamps `dIn`, `massGr`, and `twist` via
`Math.max`/`Math.min` as a CodeQL taint-analysis guard. This is not documented
in `contracts/spin-drift.md`. Add a note explaining the clamping bounds and
the reason (CodeQL §CWE-190 guard, not a physics constraint).

Source: Sprint 1 devsecops review

