# ADR 003 — CI pipeline: split build into parallel `java-build` and `frontend-build` jobs on GitHub Actions

Status: Proposed — 2026-11-01
Contract: [`contracts/ci-pipeline.md`](../../contracts/ci-pipeline.md)

## Context

The repository already has `.github/workflows/ci.yml` with four jobs: `build`, `codeql`, `dependency-check`, and `trivy`. `dependabot.yml` keeps the Actions versions current. The `build` job has three problems:

1. **The JaCoCo 90 % gate isn't enforced in CI.** `build` runs `mvn --batch-mode test`, but the `jacoco:check` execution is bound to the `verify` phase. A coverage regression passes CI today.
2. **One job does everything.** `npm audit`, the Vite build, Jest (through `frontend-maven-plugin`), and the Java tests run serially in one job. A Jest failure looks like a Maven failure, and total wall time is the sum of both stacks.
3. **Caches are coupled.** One cache entry holds `node/` and `node_modules/`, keyed only on `package-lock.json`, even though the Node version comes from `pom.xml`.

The brief also mentioned `./mvnw` and Node 20. **The repo has no Maven wrapper**: every existing job calls the runner's `mvn`. **Node 20 reached end-of-life on 2026-04-30.** The pom pins Node `v22.14.0` for `frontend-maven-plugin`.

Constraint: the Java tests need the Vite output. `maven-resources-plugin` excludes `static/**`, so `/favicon.svg`, `/manifest.json`, and `/apple-touch-icon.png` (checked by `StaticAssetTest`) reach the classpath only through `npm run build`. The Java job can't skip the frontend build entirely.

## Options considered

### CI platform

| Option | Verdict |
|---|---|
| **GitHub Actions** | **Chosen.** Already in use. CodeQL and Trivy upload SARIF to GitHub code scanning, which is Actions-native. Dependabot already bumps action versions. No new vendor or secrets |
| GitLab CI / CircleCI / Jenkins | A second CI system, new credentials, and SARIF integration would need rework. No benefit |

### Job layout

| Option | Verdict |
|---|---|
| Keep one `build` job, change `test` → `verify` | Fixes the coverage gate. Wall time stays serial and failures stay mixed |
| **Two parallel jobs: `java-build` (Maven verify, Jest skipped) and `frontend-build` (npm ci, audit, Vite build, Jest)** | **Chosen.** Each job fails for one stack only. Wall time ≈ max(Java, frontend). The Java job still runs the Vite build (needed for its tests) but skips Jest, so frontend tests run once |
| Two jobs, where `java-build` downloads a `frontend-build` artifact (`needs:`) | Saves one Vite build (~seconds) but serializes the jobs and adds artifact plumbing. Not worth it |
| Matrix job | The two stacks share no steps, so a matrix would hide two different scripts behind conditionals |

### Skipping Jest inside Maven

`frontend-maven-plugin` has no per-execution skip property by default. The existing `-Dskip.npm.test=true` flags in the `codeql` and `trivy` jobs **don't do anything** today. Decision: add `<skip>${skip.npm.test}</skip>` to the `npm-test` execution, with a pom property defaulting to `false`. Local `mvn verify` is unchanged, and the existing flags start working.

### Maven invocation

| Option | Verdict |
|---|---|
| **`mvn --batch-mode` from the runner image** | **Chosen.** Matches the other three jobs and the Dockerfile (`maven:3.9` image) |
| Add a Maven wrapper (`mvnw`) | Pins the Maven version, which helps reproducibility, but it's a separate repo-wide change touching the Dockerfile and docs. Left as a follow-up (open question), not bundled here |

### Cache strategy

- **Maven:** `~/.m2/repository`, key `${{ runner.os }}-m2-${{ hashFiles('**/pom.xml') }}`, restore prefix `${{ runner.os }}-m2-`. This is the existing key, so `java-build` keeps the current warm cache and the other jobs' fallbacks still hit it.
- **npm (`frontend-build`):** `~/.npm` (the download cache, not `node_modules`), key `${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}`. `npm ci` always rebuilds `node_modules` from the lockfile, so a stale tree can't leak in.
- **Node/node_modules for `frontend-maven-plugin` (`java-build`):** `node/` + `node_modules/`, key `${{ runner.os }}-fmp-${{ hashFiles('pom.xml', 'package-lock.json') }}`. Now `pom.xml` is in the key too, so a Node version bump invalidates the cache.
- `PUPPETEER_SKIP_DOWNLOAD=true` in both jobs. The e2e suite (`test:e2e`) isn't run in CI, and skipping the ~170 MB Chromium download is the largest single time saving.

## Decision

Replace the `build` job with `java-build` and `frontend-build` as specified in the contract. `codeql`, `dependency-check`, and `trivy` stay unchanged. Move `npm audit --audit-level=high` into `frontend-build`. Use Node `22.14.0`, matching the pom, in place of Node 20. Use `mvn --batch-mode verify` in place of `./mvnw verify`.

## Consequences

- **Positive:**
  - The JaCoCo ≥ 90 % instruction/branch gate is enforced on every push and PR.
  - Frontend and backend failures show up as separate checks.
  - Wall time drops to roughly the slower of the two jobs.
  - Jest runs once.
  - The existing `-Dskip.npm.test` flags start working.
- **Negative:**
  - Vite runs in both jobs (seconds).
  - Two cache families to reason about.
  - Node version is now set in two places (pom `<nodeVersion>` and the workflow's `node-version`). The contract requires them to match, and reviewers check that.
- **Operational:**
  - **Status check names change** from `build` to `java-build` and `frontend-build`.
  - If branch protection lists `build` as required, update it **when the PR merges**. Otherwise every PR waits forever on a check that never reports.
  - This is a repo-settings change only the user can make.
- **Follow-ups (not in scope):**
  - Maven wrapper.
  - SHA-pinning third-party actions (devsecops call).
  - Running `test:e2e` in CI.
