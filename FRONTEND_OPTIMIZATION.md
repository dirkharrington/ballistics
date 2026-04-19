# Frontend Optimization Plan

## Current Baseline

| Asset | Raw size | Notes |
|---|---|---|
| `ballistics.js` | 23 KB | Unminified, no tree-shaking |
| `index.html` | 20 KB | ~15 KB is inline CSS |
| Chart.js (CDN) | ~200 KB | Full bundle, no tree-shaking |
| Google Fonts | 3 families | 3 round-trips, no subsetting |

---

## Priority 1 — Build Tooling (Vite)

Introduce **Vite** as the build tool. Gives minification, bundling, content-hash filenames, and tree-shaking in one step with near-zero config. Maven invokes `npm run build` via `frontend-maven-plugin`, writing output to `target/classes/static/`.

**Changes:**
- `package.json` — add `vite` dev dependency, `"build": "vite build"` script
- `vite.config.js` — entry point `src/main/resources/static/index.html`, output to `target/classes/static/`
- `pom.xml` — wire `frontend-maven-plugin` into `generate-resources` phase: `npm install` then `npm run build`
- `.gitignore` — add `target/` (already present), `node_modules/`

Source files stay in `src/main/resources/static/`; Vite outputs hashed bundles to `target/`.

**Expected gain:** JS 23 KB → ~9 KB minified, ~4 KB gzip.

---

## Priority 2 — Extract Inline CSS

Move the `<style>` block (~15 KB) from `index.html` into `ballistics.css`. Allows the browser to cache styles independently of markup and enables Vite to minify and content-hash the file.

**Changes:**
- New `src/main/resources/static/ballistics.css` — extracted styles
- `index.html` — replace `<style>` block with `<link rel="stylesheet" href="./ballistics.css">`

**Expected gain:** CSS 15 KB inline → ~5 KB cached, zero re-download on revisit.

---

## Priority 3 — Tree-Shake Chart.js

Replace the CDN `<script>` tag with a direct ESM import of only the Chart.js components the app uses:

```js
import {
  Chart, LineController, LineElement, PointElement,
  LinearScale, CategoryScale, Tooltip, Legend
} from 'chart.js';
Chart.register(LineController, LineElement, PointElement,
               LinearScale, CategoryScale, Tooltip, Legend);
```

Eliminates the CDN dependency and its DNS lookup. Vite tree-shakes the unused components.

**Changes:**
- `ballistics.js` — replace `Chart` global references with ESM import
- `index.html` — remove CDN `<script src="chart.umd.min.js">` tag
- `package.json` — add `chart.js` as a dependency

**Expected gain:** Chart.js ~200 KB CDN → ~80 KB self-hosted minified, ~28 KB gzip.

---

## Priority 4 — Font Optimization

Google Fonts adds 2–3 serial round-trips and can block render. Improvements:

```html
<!-- Replace the existing preconnect with both origins -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

Append `&display=swap&subset=latin` to the Google Fonts URL to limit the download to Latin characters only.

Long-term: self-host the three `woff2` files (Share Tech Mono, Rajdhani, Orbitron) via `@font-face` in `ballistics.css`, served by Spring Boot with aggressive cache headers, eliminating the third-party dependency entirely.

**Changes:**
- `index.html` — add `fonts.gstatic.com` preconnect, add `subset=latin` to font URL

---

## Priority 5 — Spring Boot Compression & Cache Headers

Configure Spring Boot to gzip responses and set long-lived cache headers on hashed static assets.

**Changes to `application.properties`:**
```properties
server.compression.enabled=true
server.compression.mime-types=text/html,text/css,application/javascript,application/json
server.compression.min-response-size=1024

spring.web.resources.cache.cachecontrol.max-age=365d
spring.web.resources.cache.cachecontrol.cache-public=true
```

Content-hash filenames from Vite (e.g. `ballistics.a3f9b2.js`) make the 1-year TTL safe — the hash changes on every build, busting the cache automatically.

---

## Priority 6 — Resource Hints

Add preload hints so the browser fetches CSS and JS before the parser reaches them.

**Changes to `index.html` `<head>`:**
```html
<link rel="preload" href="./ballistics.css" as="style">
<link rel="modulepreload" href="./ballistics.js">
```

---

## Expected Outcome

| Asset | Before | After (gzip) |
|---|---|---|
| `ballistics.js` | 23 KB raw | ~4 KB |
| CSS | 15 KB inline, uncached | ~2 KB, 1-year cache |
| Chart.js | 200 KB CDN | ~28 KB self-hosted |
| Fonts | 3 CDN trips blocking render | 1 preconnect + swap |
| Cache TTL | none | 1 year (content-hashed) |

**Total page-weight reduction: ~240 KB → ~34 KB for application assets (~86% reduction).**
Chart.js tree-shaking is the largest single win.

---

## Implementation Order

1. Priority 1 (Vite) — unlocks minification for all other assets
2. Priority 2 (CSS extraction) — prerequisite for per-file caching
3. Priority 3 (Chart.js tree-shaking) — biggest byte savings
4. Priority 5 (compression + cache headers) — server-side, no frontend changes
5. Priority 4 (font optimization) — low risk, incremental
6. Priority 6 (resource hints) — final polish
