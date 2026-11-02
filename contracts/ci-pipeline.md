# Contract: CI pipeline (BE-1)

Version: 1.0.0 — 2026-11-01
Decision: [ADR 003](../docs/adr/003-ci-pipeline.md)
Owner of the implementation: backend builder (`.github/workflows/ci.yml`, `pom.xml`). devsecops reviews it.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Summary of changes

1. In `.github/workflows/ci.yml`, **replace** the `build` job with two jobs, `java-build` and `frontend-build`, that have no `needs:` between them (they run in parallel).
2. **Leave `codeql`, `dependency-check`, and `trivy` unchanged.** Same steps, same cache keys, same flags.
3. In `pom.xml`, make the Jest execution skippable (see "pom.xml change").

## Deviations from the original brief

| Brief | Contract | Reason |
|---|---|---|
| `./mvnw verify` | `mvn --batch-mode verify` | There's no Maven wrapper in the repo. Every existing job and the Dockerfile use `mvn` |
| Node 20 | Node `22.14.0` | Node 20 went EOL on 2026-04-30. The pom's `frontend-maven-plugin` already pins `v22.14.0`, and CI must match it |
| `npm test -- --coverage` | `npm test -- --ci` | `npm test` is already `jest --coverage`, and the 100 % threshold lives in `package.json`. `--ci` stops snapshot writes in CI |
| New workflow file | Edit the existing `ci.yml` | It already exists with three security jobs that must stay |
| "push and PR to main" | Keep the existing triggers (`push: [main]`, `pull_request:` on all branches) | Don't narrow where the security scans run |

## Workflow-level settings

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}   # cancel superseded PR runs only; never cancel main
```

## Job: `java-build`

| Property | Value |
|---|---|
| Job id / name | `java-build` / `java-build` |
| `runs-on` | `ubuntu-latest` |
| `timeout-minutes` | `20` |
| `needs` | none |
| Job `env` | `PUPPETEER_SKIP_DOWNLOAD: 'true'` |

Steps, in order:

| # | Step | Exact config |
|---|---|---|
| 1 | Checkout | `actions/checkout@v4` |
| 2 | Set up JDK 21 | `actions/setup-java@v4` with `java-version: '21'`, `distribution: 'temurin'` |
| 3 | Cache Maven repository | `actions/cache@v4`, `path: ~/.m2/repository`, `key: ${{ runner.os }}-m2-${{ hashFiles('**/pom.xml') }}`, `restore-keys: ${{ runner.os }}-m2-` |
| 4 | Cache frontend-maven-plugin Node + modules | `actions/cache@v4`, `path: \| node \n node_modules`, `key: ${{ runner.os }}-fmp-${{ hashFiles('pom.xml', 'package-lock.json') }}`, `restore-keys: ${{ runner.os }}-fmp-` |
| 5 | Build and verify | `run: mvn --batch-mode verify -Dskip.npm.test=true` |
| 6 | Upload JaCoCo report | `if: always()`, `actions/upload-artifact@v4`, `name: jacoco-report`, `path: target/site/jacoco/` |

What step 5 does: it runs `frontend-maven-plugin` install-node, `npm install`, and `npm run build` (the Java tests need `target/classes/static`), **skips Jest**, then compiles, runs the JUnit tests, packages, and runs `jacoco:report` + `jacoco:check` (≥ 0.90 instruction and branch). Any non-zero exit fails the job.

## Job: `frontend-build`

| Property | Value |
|---|---|
| Job id / name | `frontend-build` / `frontend-build` |
| `runs-on` | `ubuntu-latest` |
| `timeout-minutes` | `15` |
| `needs` | none |
| Job `env` | `PUPPETEER_SKIP_DOWNLOAD: 'true'` |

Steps, in order:

| # | Step | Exact config |
|---|---|---|
| 1 | Checkout | `actions/checkout@v4` |
| 2 | Set up Node | `actions/setup-node@v4` with `node-version: '22.14.0'` (**must equal** the pom's `<nodeVersion>` minus the `v`). No `cache:` input, because step 3 handles caching |
| 3 | Cache npm download cache | `actions/cache@v4`, `path: ~/.npm`, `key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}`, `restore-keys: ${{ runner.os }}-npm-` |
| 4 | Install | `run: npm ci` |
| 5 | npm audit | `run: npm audit --audit-level=high` (moved unchanged from the old `build` job) |
| 6 | Build | `run: npm run build` |
| 7 | Test | `run: npm test -- --ci` (runs `jest --coverage --ci` and enforces the 100 % thresholds in `package.json`) |
| 8 | Upload JS coverage | `if: always()`, `actions/upload-artifact@v4`, `name: js-coverage`, `path: target/js-coverage/` |

## `pom.xml` change

```xml
<properties>
    ...
    <skip.npm.test>false</skip.npm.test>
</properties>
...
<execution>
    <id>npm-test</id>
    <goals><goal>npm</goal></goals>
    <phase>test</phase>
    <configuration>
        <skip>${skip.npm.test}</skip>
        <arguments>test -- --watchAll=false</arguments>
    </configuration>
</execution>
```

With no flag, local `mvn verify` behaves exactly as before. The existing `-Dskip.npm.test=true` flags in the `codeql` and `trivy` jobs, which don't work today, start working as a side effect.

## Tool versions

| Tool | Version | Source of truth |
|---|---|---|
| JDK | Temurin 21 | `pom.xml` `<java.version>`, workflow |
| Maven | runner-provided 3.9.x | `ubuntu-latest` image |
| Node (frontend-build) | 22.14.0 | workflow, **kept equal to** pom `<nodeVersion>` |
| Node (java-build) | v22.14.0 | pom `<nodeVersion>` (downloaded by frontend-maven-plugin) |
| npm | bundled with Node 22.14.0 (frontend-build) / 10.9.2 (pom) | — |
| Actions | `checkout@v4`, `setup-java@v4`, `setup-node@v4`, `cache@v4`, `upload-artifact@v4` | Dependabot `github-actions` ecosystem bumps these |

## Security requirements

- `permissions: contents: read` at workflow level. Neither new job adds permissions.
- No secrets are referenced by `java-build` or `frontend-build`. No `pull_request_target`.
- `npm ci` (lockfile-exact) in `frontend-build`. Never `npm install` in that job.
- Artifacts contain coverage reports only, no build outputs or credentials.

## Acceptance checklist

- [ ] `ci.yml` has jobs `java-build`, `frontend-build`, `codeql`, `dependency-check`, and `trivy`. No job is named `build`.
- [ ] Neither `java-build` nor `frontend-build` declares `needs:`. Both start at the same time in the Actions UI.
- [ ] A PR that drops Java coverage below 90 % fails `java-build` at `jacoco:check`. Verify once with a throwaway branch, then delete it.
- [ ] A PR with a failing Jest test fails `frontend-build` only. `java-build` stays green because Jest is skipped there.
- [ ] A PR that breaks `vite build` fails both jobs (expected, since `java-build` needs the output).
- [ ] The `java-build` log shows the Vite build running and the `npm-test` execution reported as skipped.
- [ ] Local `mvn verify` with no flags still runs Jest.
- [ ] Second run on an unchanged lockfile/pom: both cache steps report a hit.
- [ ] `npm audit --audit-level=high` runs in `frontend-build`.
- [ ] `node-version` in the workflow equals the pom's `<nodeVersion>`.
- [ ] `codeql`, `dependency-check`, and `trivy` are byte-for-byte unchanged.
- [ ] **User action:** the branch-protection required checks are updated from `build` to `java-build` + `frontend-build` when this merges.
