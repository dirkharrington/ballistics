# SPA-5 — Static Hosting / GitHub Pages Deploy

**Version:** 1.0.0  
**Date:** 2026-11-16  
**Status:** Proposed  
**Author:** Architect session (Claude Sonnet 4.6)

---

## 1. Goal

Publish the Vite build output (`dist/`) to GitHub Pages on every push to `main`, making the app live at `https://dirkharrington.github.io/ballistics/`.

---

## 2. Scope

This contract covers:

- Vite `base` config change.
- Service Worker registration path and precache URL prefix update.
- Web App Manifest `start_url` and icon path updates.
- CI `deploy` job specification.
- Required GitHub repository setting (one-time manual step).
- Permissions and threat model.

---

## 3. Vite `base` Config Change

**File:** `vite.config.js`

Add `base: '/ballistics/'` to the `defineConfig` call:

```js
export default defineConfig({
  base: '/ballistics/',
  root: 'app',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  // …
})
```

Vite rewrites all asset `src`/`href` references and injects `import.meta.env.BASE_URL = '/ballistics/'` into the bundle.  The `dist/` directory structure is unchanged — only the public URLs of the emitted assets change.

**Why this matters:** GitHub Pages for a project site (`github.com/owner/repo`) serves content under `/ballistics/`, not `/`.  Without this change, all asset URLs in `index.html` point to the wrong origin-relative paths and the app 404s.

---

## 4. Service Worker Changes

### 4.1 `serviceWorkerPlugin` in `vite.config.js`

The plugin currently prefixes assets with `/${key}` (e.g. `/assets/main-abc123.js`).  After adding `base: '/ballistics/'`, the public URL of every hashed asset is `/ballistics/assets/main-abc123.js`.

**Change:** Prefix each hashed asset with `/ballistics/` and update the un-hashed root URLs to match:

```js
const hashedAssets = Object.keys(bundle)
  .filter(key => /\.(js|css|woff2?|ttf|eot|png|jpe?g|gif|svg|ico|webp)$/.test(key))
  .map(key => `/ballistics/${key}`);                       // ← was `/${key}`

const allAssets = [
  '/ballistics/',                                          // ← was '/'
  '/ballistics/index.html',                               // ← was '/index.html'
  '/ballistics/manifest.json',                            // ← was '/manifest.json'
  ...hashedAssets,
];
```

### 4.2 SW registration call in `app/ballistics.js`

The current registration path is the hard-coded string `'/sw.js'`.  Under the `/ballistics/` base, the SW lives at `/ballistics/sw.js`.  Prefer `import.meta.env.BASE_URL` over a second hard-coded constant so the path derives from the single `base` source of truth:

```js
navigator.serviceWorker.register(
  import.meta.env.BASE_URL + 'sw.js',
  { type: 'module' }
)
```

The default scope for a SW registered at `/ballistics/sw.js` is `/ballistics/`, which is correct — the SW controls all pages under the base path.

### 4.3 Explicit scope (optional but recommended)

If you prefer to make the scope explicit rather than relying on the default, add a `scope` option:

```js
navigator.serviceWorker.register(
  import.meta.env.BASE_URL + 'sw.js',
  { type: 'module', scope: import.meta.env.BASE_URL }
)
```

This is equivalent to the default but documents intent.

---

## 5. Web App Manifest Changes

**File:** `app/manifest.json`

Update `start_url` and all absolute icon paths to include the base:

```json
{
  "name": "Ballistics Visualizer",
  "short_name": "Ballistics",
  "description": "Physics-accurate external ballistics calculator and trajectory visualizer.",
  "start_url": "/ballistics/",
  "scope": "/ballistics/",
  "display": "standalone",
  "background_color": "#0a0e14",
  "theme_color": "#00d4ff",
  "orientation": "any",
  "icons": [
    {
      "src": "/ballistics/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/ballistics/favicon.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ]
}
```

`scope` is added explicitly (it was previously omitted, defaulting to `/`).  With `scope: "/ballistics/"`, the browser treats navigation outside that path as leaving the installed PWA.

---

## 6. CI `deploy` Job

### 6.1 Trigger

The `deploy` job runs only on `push` to `main`:

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

It never runs on pull requests — a PR build can verify the build succeeds, but only a merged push creates a deployment.

### 6.2 `needs`

```yaml
needs: [frontend-build]
```

Deploy waits for `frontend-build` to succeed.  If the build or tests fail, no deployment happens.

### 6.3 Permissions

Scoped to the `deploy` job only (least privilege):

```yaml
permissions:
  pages: write      # required by actions/deploy-pages
  id-token: write   # required for OIDC authentication with the Pages deployment endpoint
```

The top-level `permissions: contents: read` block in `ci.yml` still applies to all other jobs.

### 6.4 Environment

```yaml
environment:
  name: github-pages
  url: ${{ steps.deployment.outputs.page_url }}
```

Using the `github-pages` environment name unlocks the Pages deployment protection rules (if any are set) and surfaces the live URL in the GitHub Actions UI.

### 6.5 Full job YAML

```yaml
deploy:
  name: Deploy to GitHub Pages
  needs: [frontend-build]
  runs-on: ubuntu-24.04
  timeout-minutes: 10
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'

  permissions:
    pages: write
    id-token: write

  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}

  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

    - name: Set up Node
      uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
      with:
        node-version: '22.23.4'

    - name: Cache npm download cache
      uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25 # v5
      with:
        path: ~/.npm
        key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
        restore-keys: ${{ runner.os }}-npm-

    - name: Install
      run: npm ci

    - name: Build
      run: npm run build
      env:
        PUPPETEER_SKIP_DOWNLOAD: 'true'

    - name: Configure Pages
      uses: actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b # v5

    - name: Upload Pages artifact
      uses: actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa # v3
      with:
        path: dist

    - name: Deploy to GitHub Pages
      id: deployment
      uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4
```

**Rationale for a fresh build in the deploy job:** `frontend-build` runs conditionally on the `paths-filter` output — if no frontend files changed (e.g., a docs-only push to main), `frontend-build` skips its steps and produces no artifact to download.  A fresh build in `deploy` is simpler and avoids a conditional artifact download.  The build adds ~30 s to the deploy path, which is acceptable for a Size S story.

### 6.6 Action SHA pins

Action SHAs above match the versions already used in `ci.yml` for `actions/checkout`, `actions/setup-node`, and `actions/cache`.  The three new actions (`configure-pages`, `upload-pages-artifact`, `deploy-pages`) are pinned to their latest stable release SHAs at the time of writing (2026-11-16) — verify before merging:

| Action | Version | SHA |
|---|---|---|
| `actions/configure-pages` | v5 | `983d7736d9b0ae728b81ab479565c72886d7745b` |
| `actions/upload-pages-artifact` | v3 | `56afc609e74202658d3ffba0e8f6dda462b719fa` |
| `actions/deploy-pages` | v4 | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` |

> **Important:** Confirm current stable SHAs from `https://github.com/actions/<name>/releases` before implementing.  The SHAs above are for contract review; the implementer must verify them at build time.

---

## 7. Required Manual Step (One-Time)

**GitHub Pages source must be set to "GitHub Actions"** before the first deploy.

1. Go to `https://github.com/dirkharrington/ballistics/settings/pages`.
2. Under **Source**, select **GitHub Actions** (not "Deploy from a branch").
3. Save.

This setting cannot be automated via the CI workflow itself.  If this step is skipped, `actions/deploy-pages` will fail with a "Pages not enabled" or "Pages source is not set to GitHub Actions" error.

---

## 8. Deployment URL

After a successful deploy, the app is live at:

```
https://dirkharrington.github.io/ballistics/
```

The Pages URL is also surfaced in:
- The GitHub Actions run summary (via the `environment.url` output).
- The repo's **Deployments** panel on the right side of the main page.

---

## 9. Threat Model

### 9.1 What the deploy job can access

| Capability | Source | Risk |
|---|---|---|
| `GITHUB_TOKEN` with `pages: write` | GitHub Actions | Can create/overwrite a GitHub Pages deployment for this repo only. No other repo. |
| `GITHUB_TOKEN` with `id-token: write` | GitHub Actions | Can request a short-lived OIDC JWT from GitHub's token endpoint, scoped to this repo and job. Used by `actions/deploy-pages` to authenticate the upload; the token is never exposed in logs. |
| `contents: read` (top-level) | Inherited | Can read repo contents (checkout). Cannot push commits or open PRs. |
| `npm ci` dependencies | package-lock.json | Supply chain risk — same as the existing `frontend-build` job. Trivy and npm audit already run on this input. |

### 9.2 Why it's safe

- **No production secrets in the deploy path.** The app is fully static; the build reads only source files and `package-lock.json`.  No API keys, tokens, or credentials are injected at build time.
- **Deploy-only on `push` to `main`**, never on PR builds.  An attacker submitting a malicious PR cannot trigger a deployment.
- **OIDC, not a long-lived PAT.**  `id-token: write` issues a short-lived JWT valid only for the Pages upload endpoint and only for the duration of the job.  There is no stored secret to rotate or leak.
- **Action SHA pinning.**  All actions are pinned to commit SHAs, so a compromised tag cannot silently introduce malicious code.
- **Deployed content is audited by CI.** The same `frontend-build` job (Jest 100% coverage, CodeQL SAST, Trivy FS scan) must pass before `deploy` runs.

### 9.3 Residual risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Compromised npm dependency in deployed bundle | Low | Trivy + npm audit in `frontend-build`; `deploy` does not add new dependencies. |
| Malicious action update if SHA drifts | Low | Actions are SHA-pinned; Dependabot will surface updates as PRs. |
| Pages serving stale content after a revert | Low | Re-push to main (or an empty commit) triggers a new deploy. |

---

## 10. Acceptance Criteria

| # | Criterion |
|---|---|
| A1 | Push to `main` → deploy job runs → app is live at `https://dirkharrington.github.io/ballistics/` within 2 minutes. |
| A2 | The initial bundle does not contain any absolute path starting with `/assets/` (all paths start with `/ballistics/assets/`). |
| A3 | Service Worker registers at `/ballistics/sw.js` and its scope is `/ballistics/`. |
| A4 | `manifest.json` `start_url` is `/ballistics/` and `scope` is `/ballistics/`. |
| A5 | Hard refresh at `https://dirkharrington.github.io/ballistics/` loads the app (no 404 on assets). |
| A6 | Service Worker caches all assets on first load; second load with network "Offline" shows the app. |
| A7 | `npm test` passes at 100/100/100/100 after the base-URL changes. |
| A8 | Pull requests do not trigger a deploy job. |

---

## 11. Files Changed by Implementer

| File | Change |
|---|---|
| `vite.config.js` | Add `base: '/ballistics/'`; update `serviceWorkerPlugin` asset prefix. |
| `app/ballistics.js` | Update SW registration path to `import.meta.env.BASE_URL + 'sw.js'`. |
| `app/manifest.json` | Update `start_url`, add `scope`, update icon paths. |
| `.github/workflows/ci.yml` | Add `deploy` job with the YAML in §6.5. |
| `BACKLOG.md` | Mark SPA-5 done in the same PR. |

---

## 12. Out of Scope

- Custom domain / `CNAME` file — deferred until a domain is chosen (see BACKLOG open question #1).
- Branch protection rules or Pages deployment protection — left to repo settings.
- Cache-busting strategy beyond Vite's default content-hash filenames — already handled by PERF-2.
