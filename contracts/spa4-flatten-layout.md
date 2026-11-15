# Contract: Flatten Source Layout (SPA-4)

Version: 1.0.0 — 2026-11-15
Status: **Proposed** (pending user review)
Owner: frontend builder

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0. Deviations from the brief

| Brief | This contract | Reason |
|---|---|---|
| Tests → `app/tests/` or `tests/` (pick one) | `tests/` at repo root | Test code is not shipped with the app. Placing tests at `tests/` alongside `app/` follows Node.js convention, avoids any Vite dev-server exposure of test files, and mirrors how `jest.e2e.config.cjs` already lives at the repo root |
| `physics-tables.yaml` — brief says "if it exists" | File exists; move it | `vite.config.js` still has a `physicsTablesPlugin` that reads it via `readFileSync`; it was not deleted by SPA-3 |
| (not in brief) `src/main/resources/META-INF/` | Delete | Two leftover Spring Boot / native-image artefacts survive SPA-3: `reflect-config.json` and `org.springframework.boot.diagnostics.FailureAnalyzer`. They reference Java classes that no longer exist. Delete and remove the `src/` tree entirely |
| `outDir: '../../../../target/classes/static'` | `outDir: '../dist'` | Maven `target/` is gone; `dist/` at repo root is the conventional Vite output and aligns with the SPA-5 GitHub Pages deploy |
| `coverageDirectory: "target/js-coverage"` | `"coverage"` | Same rationale; `target/` is gone |

---

## 1. Scope

### 1.1 Goals

1. Move all source files out of the Maven-legacy path `src/main/resources/` and `src/test/js/`.
2. After the move, `src/` must not exist in the repo.
3. Update every config file that embeds the old paths.
4. CI `paths-filter` must continue to trigger exactly the same set of jobs.
5. `npm run build` outputs to `dist/`.
6. `npm test` passes at 100/100/100/100 Istanbul with no test suite changes.

### 1.2 Non-goals

- No source code logic changes.
- No new features.
- No changes to `contracts/` files other than this contract and CHANGELOG.

---

## 2. File moves

All moves are `git mv`; history is preserved. Perform them in one commit.

### 2.1 App sources — `src/main/resources/static/` → `app/`

| From | To |
|---|---|
| `src/main/resources/static/apple-touch-icon.png` | `app/apple-touch-icon.png` |
| `src/main/resources/static/ballistics.css` | `app/ballistics.css` |
| `src/main/resources/static/ballistics.js` | `app/ballistics.js` |
| `src/main/resources/static/custom-rounds.js` | `app/custom-rounds.js` |
| `src/main/resources/static/drag-csv.js` | `app/drag-csv.js` |
| `src/main/resources/static/favicon.svg` | `app/favicon.svg` |
| `src/main/resources/static/fonts/orbitron-400.woff2` | `app/fonts/orbitron-400.woff2` |
| `src/main/resources/static/fonts/orbitron-700.woff2` | `app/fonts/orbitron-700.woff2` |
| `src/main/resources/static/fonts/orbitron-900.woff2` | `app/fonts/orbitron-900.woff2` |
| `src/main/resources/static/fonts/rajdhani-300.woff2` | `app/fonts/rajdhani-300.woff2` |
| `src/main/resources/static/fonts/rajdhani-400.woff2` | `app/fonts/rajdhani-400.woff2` |
| `src/main/resources/static/fonts/rajdhani-500.woff2` | `app/fonts/rajdhani-500.woff2` |
| `src/main/resources/static/fonts/rajdhani-600.woff2` | `app/fonts/rajdhani-600.woff2` |
| `src/main/resources/static/fonts/rajdhani-700.woff2` | `app/fonts/rajdhani-700.woff2` |
| `src/main/resources/static/fonts/share-tech-mono-400.woff2` | `app/fonts/share-tech-mono-400.woff2` |
| `src/main/resources/static/index.html` | `app/index.html` |
| `src/main/resources/static/manifest.json` | `app/manifest.json` |
| `src/main/resources/static/physics/engine.ts` | `app/physics/engine.ts` |
| `src/main/resources/static/physics/types.ts` | `app/physics/types.ts` |
| `src/main/resources/static/physics/virtual-physics-tables.d.ts` | `app/physics/virtual-physics-tables.d.ts` |
| `src/main/resources/static/public/apple-touch-icon.png` | `app/public/apple-touch-icon.png` |
| `src/main/resources/static/public/favicon.svg` | `app/public/favicon.svg` |
| `src/main/resources/static/public/manifest.json` | `app/public/manifest.json` |
| `src/main/resources/static/sw.js` | `app/sw.js` |
| `src/main/resources/static/tools.js` | `app/tools.js` |
| `src/main/resources/static/url-state.js` | `app/url-state.js` |

### 2.2 Data files

| From | To |
|---|---|
| `src/main/resources/bullets.yaml` | `app/data/bullets.yaml` |
| `src/main/resources/physics-tables.yaml` | `app/data/physics-tables.yaml` |

### 2.3 Tests — `src/test/js/` → `tests/`

| From | To |
|---|---|
| `src/test/js/__mocks__/bullet-catalog.js` | `tests/__mocks__/bullet-catalog.js` |
| `src/test/js/__mocks__/chart.js` | `tests/__mocks__/chart.js` |
| `src/test/js/__mocks__/physics-tables.js` | `tests/__mocks__/physics-tables.js` |
| `src/test/js/ballistics.test.js` | `tests/ballistics.test.js` |
| `src/test/js/custom-rounds.test.js` | `tests/custom-rounds.test.js` |
| `src/test/js/drag-csv.test.js` | `tests/drag-csv.test.js` |
| `src/test/js/e2e/app.e2e.test.js` | `tests/e2e/app.e2e.test.js` |
| `src/test/js/fixtures/spa1-golden.json` | `tests/fixtures/spa1-golden.json` |
| `src/test/js/physics-engine.test.js` | `tests/physics-engine.test.js` |
| `src/test/js/sw.test.js` | `tests/sw.test.js` |
| `src/test/js/tools.test.js` | `tests/tools.test.js` |
| `src/test/js/url-state.test.js` | `tests/url-state.test.js` |

### 2.4 Deletions (no move)

Delete these leftover Spring Boot artefacts in the same commit as the moves:

| File | Reason |
|---|---|
| `src/main/resources/META-INF/native-image/com.ballistics/reflect-config.json` | GraalVM native-image config for Java classes deleted in SPA-3 |
| `src/main/resources/META-INF/spring/org.springframework.boot.diagnostics.FailureAnalyzer` | Spring Boot service-loader registration for Java class deleted in SPA-3 |

After all moves and deletions, verify that `src/` is completely empty, then `git rm -r src/`.

---

## 3. Config file changes

### 3.1 `vite.config.js`

Apply these exact substitutions (all on existing lines; no structural changes to the file):

```diff
-        resolve(__dirname, 'src/main/resources/static/sw.js'), 'utf-8');
+        resolve(__dirname, 'app/sw.js'), 'utf-8');
```

```diff
-          resolve(__dirname, 'src/main/resources/bullets.yaml'), 'utf-8')
+          resolve(__dirname, 'app/data/bullets.yaml'), 'utf-8')
```

```diff
-          resolve(__dirname, 'src/main/resources/physics-tables.yaml'), 'utf-8')
+          resolve(__dirname, 'app/data/physics-tables.yaml'), 'utf-8')
```

```diff
-  root: 'src/main/resources/static',
+  root: 'app',
```

```diff
-    outDir: '../../../../target/classes/static',
+    outDir: '../dist',
```

The `resolvedOutDir` logic in `serviceWorkerPlugin` uses `resolve(config.root, config.build.outDir)`. With `root: 'app'` and `outDir: '../dist'`, this resolves to `<repo-root>/dist/`. The `writeFileSync(resolve(resolvedOutDir, 'sw.js'), swOut)` call continues to work correctly.

### 3.2 `package.json` — Jest configuration

```diff
     "roots": [
-      "src/test/js"
+      "tests"
     ],
```

```diff
-    "testPathIgnorePatterns": [
-      "src/test/js/e2e"
-    ],
+    "testPathIgnorePatterns": [
+      "tests/e2e"
+    ],
```

```diff
-    "coverageDirectory": "target/js-coverage",
+    "coverageDirectory": "coverage",
```

```diff
     "collectCoverageFrom": [
-      "src/main/resources/static/sw.js",
-      "src/main/resources/static/drag-csv.js",
-      "src/main/resources/static/ballistics.js",
-      "src/main/resources/static/tools.js",
-      "src/main/resources/static/url-state.js",
-      "src/main/resources/static/custom-rounds.js",
-      "src/main/resources/static/physics/engine.ts"
+      "app/sw.js",
+      "app/drag-csv.js",
+      "app/ballistics.js",
+      "app/tools.js",
+      "app/url-state.js",
+      "app/custom-rounds.js",
+      "app/physics/engine.ts"
     ],
```

```diff
       "^chart\\.js$": "<rootDir>/src/test/js/__mocks__/chart.js",
-      "^virtual:bullet-catalog$": "<rootDir>/src/test/js/__mocks__/bullet-catalog.js",
-      "^virtual:physics-tables$": "<rootDir>/src/test/js/__mocks__/physics-tables.js"
+      "^chart\\.js$": "<rootDir>/tests/__mocks__/chart.js",
+      "^virtual:bullet-catalog$": "<rootDir>/tests/__mocks__/bullet-catalog.js",
+      "^virtual:physics-tables$": "<rootDir>/tests/__mocks__/physics-tables.js"
```

### 3.3 `jest.e2e.config.cjs`

```diff
-  testMatch: ['<rootDir>/src/test/js/e2e/**/*.test.js'],
+  testMatch: ['<rootDir>/tests/e2e/**/*.test.js'],
```

### 3.4 `.github/workflows/ci.yml`

In the `changes` job `paths-filter` block:

```diff
           frontend:
-            - 'src/main/resources/static/**'
-            - 'src/test/js/**'
+            - 'app/**'
+            - 'tests/**'
             - 'package.json'
             - 'package-lock.json'
             - 'babel.config.json'
             - 'tsconfig.json'
             - 'vite.config.js'
             - '.github/workflows/ci.yml'
```

In the `Upload JS coverage` step:

```diff
           path: target/js-coverage/
+          path: coverage/
```

In the `trivy` job `skip-dirs`:

```diff
-          skip-dirs: 'target,node_modules'
+          skip-dirs: 'dist,node_modules'
```

### 3.5 `tsconfig.json`

```diff
-  "include": ["src/main/resources/static/physics/**/*.ts"]
+  "include": ["app/physics/**/*.ts"]
```

### 3.6 `.gitignore`

Replace the entire file with the following content. The old `target/`, Rust/WASM build output entries, and `src/main/resources/static/wasm/` are removed; `dist/` and `coverage/` are added:

```
dist/
node_modules/
coverage/
.claude/
.DS_Store
```

---

## 4. Acceptance criteria

Verified in this order:

1. **No `src/main/` references remain**
   ```
   git grep -r 'src/main/' -- ':!contracts/' ':!BACKLOG.md'
   ```
   Must return no output.

2. **`npm run build` outputs to `dist/`**
   ```
   npm run build
   ls dist/index.html dist/sw.js
   ```
   Both files must exist.

3. **`npm test` passes at 100/100/100/100**
   ```
   npm test -- --ci
   ```
   Istanbul global thresholds: branches 100, functions 100, lines 100, statements 100. No test failures.

4. **`npm run typecheck` passes**
   ```
   npm run typecheck
   ```
   No TypeScript errors.

5. **CI `paths-filter` correctly covers `app/` and `tests/`** — verified by confirming the YAML diffs in §3.4 are applied exactly.

6. **`src/` directory does not exist**
   ```
   test ! -d src
   ```
   Must succeed.

---

## 5. Threat model delta

### 5.1 Web-root path change

The Vite `root` changes from `src/main/resources/static` to `app`. The service worker (`sw.js`) is registered at the same origin-root scope in both before and after. The SW `scope` defaults to the directory the script is served from — which is `/` in both cases (Vite emits `sw.js` at the top of `outDir`). **No scope change.**

### 5.2 `app/data/` served by Vite dev server

`app/data/bullets.yaml` and `app/data/physics-tables.yaml` are inside the Vite root. During `npm run dev`, Vite will serve them at `/data/bullets.yaml` and `/data/physics-tables.yaml`. They contain no credentials; the bullet catalog is already bundled into the JS output at build time. In production (`dist/`), the YAML files are consumed only by build-time plugins via `readFileSync` and are **not emitted** to `dist/` — no production exposure. Dev exposure is acceptable; note it here for awareness.

### 5.3 `dist/` output directory

The build output moves from `target/classes/static` (not committed, not served outside Spring Boot) to `dist/` (also not committed per `.gitignore`). SPA-5 will serve `dist/` via GitHub Pages. The `.gitignore` update in §3.6 ensures `dist/` is excluded from commits.

### 5.4 CSP

No CSP changes from this layout rename. CSP gap from SPA-3 (server-set headers gone) is unchanged — still tracked for SPA-5 per the SPA-3 contract §7.

### 5.5 CodeQL and Trivy paths

CodeQL scans `javascript` language source files; it discovers them by walking the checkout, not from configured paths. Trivy scans `package-lock.json` for supply chain; it is at the repo root throughout. Neither tool is affected by the source tree rename.

### 5.6 NIST SSDF SP 800-218 mapping

| Practice | Relevance |
|---|---|
| PO.3.1 (establish and maintain env) | Build config updated to new paths; `dist/` replaces `target/` |
| PS.1.1 (maintain source integrity) | `git mv` preserves history; dead Spring Boot artefacts deleted |
| PW.4.1 (design secure arch) | No logic changes; layout rename only |

---

## 6. Roll-back

All changes are reversible with `git revert`. No schema migrations, no database changes. The old path `src/main/resources/static/` can be restored by reverting the commit.
