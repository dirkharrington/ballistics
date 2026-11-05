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

### CI-1 · Skip full CI on markdown-only PRs · DevSecOps · Size 1 ⬅ highest priority

The `pull_request` trigger in `.github/workflows/ci.yml` has no path filters.
Every PR that touches only `.md` files (backlog updates, contract docs, ADRs)
runs the full Maven build + JaCoCo + Jest + Trivy + OWASP stack — roughly 5–8
minutes of CI for a documentation change.

Add `paths-ignore` filters to both the `push` and `pull_request` triggers so
that commits where every changed file matches `**/*.md` skip the workflow
entirely. The push trigger on `main` should also exclude `*.md`-only merges.

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ['**/*.md']
  pull_request:
    paths-ignore: ['**/*.md']
```

**Acceptance:** A PR that changes only `BACKLOG.md` shows a green "skipped" CI
status rather than a full run. A PR that changes any `.java` or `.js` file still
triggers the full suite.

**Note:** Any PR that touches both code and `.md` files still runs CI — the
filter only fires when every changed path is ignored.

Source: recurring cost of backlog/contract doc PRs triggering full builds

---

### ⚠️ MH-5 · Rotate NVD API Key · DevSecOps · Size 1 — CI change ready, awaiting key rotation

The `NVD_API_KEY` GitHub Actions secret is expired. The OWASP Dependency-Check
job has `-DfailOnError=true` already set in `ci.yml`; the remaining step is
to rotate the key at nvd.nist.gov/developers/request-an-api-key and update
`secrets.NVD_API_KEY` in repo Settings → Secrets.

**Value:** Restores full dependency-CVE coverage. OWASP catches Java library
CVEs that Trivy (filesystem scan) can miss.

---

### SH-9 · Spin Drift Value in Crosshair Readout · FE · Size 1

The wind drift chart shows `spinDriftCm` as a dashed overlay (satisfies the
contract), but hovering the crosshair does not show a numeric value in the
floating readout table.

Add a `spinDriftCm` row to `updateReadout()` in `ballistics.js`, conditioned on
`p.spinDriftCm > 0` so it only appears when spin drift data is present.

Source: Sprint 1 devsecops review
