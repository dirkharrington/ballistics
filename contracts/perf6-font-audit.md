# PERF-6: Audit and drop unused font weights

**Version:** 1.0.0
**Status:** Contract written, builder pending
**Date:** 2026-11-16
**Author:** Architect
**ADR:** 010 (`contracts/adr-sprint9-performance.md`, decision D3)
**Depends on:** PERF-5 (preload links). They must still point at faces that exist.

---

## 1  Problem

`app/ballistics.css` declares 9 self-hosted `@font-face` faces (`app/fonts/*.woff2`, 123 KB in total, about 14 KB each).

A browser normally downloads a face only when some element needs it. This app doesn't work that way, because the PERF-2 `serviceWorkerPlugin` (in `vite.config.js`) adds **every** hashed `.woff2` in the bundle to `STATIC_ASSETS_TO_PRECACHE`. Every visitor therefore downloads all 9 faces when the service worker installs, whether any rule uses them or not.

Preliminary audit by the architect (the builder must confirm it):

| Face | File | Used by | Preliminary verdict |
|---|---|---|---|
| Orbitron 400 | `orbitron-400.woff2` | `.readout-range-value` (Orbitron, inherits `font-weight: normal`) | **Keep** |
| Orbitron 700 | `orbitron-700.woff2` | `.run-btn`, `.chart-title`, `.stat-value`, mobile rule at `@media (max-width: 900px)` | **Keep** |
| Orbitron 900 | `orbitron-900.woff2` | `.header-title h1`. Preloaded by PERF-5. | **Keep** |
| Rajdhani 300 | `rajdhani-300.woff2` | No rule found | **Drop** (confirm) |
| Rajdhani 400 | `rajdhani-400.woff2` | `body`. Preloaded by PERF-5. | **Keep** |
| Rajdhani 500 | `rajdhani-500.woff2` | No rule found | **Drop** (confirm) |
| Rajdhani 600 | `rajdhani-600.woff2` | `.bullet-name`. Chart.js legend `font: { family: 'Rajdhani', weight: '600' }` (`ballistics.js` ~613 and ~847). | **Keep** |
| Rajdhani 700 | `rajdhani-700.woff2` | `.bullet-card.active .check::after` asks for weight 700, but its only glyph is `✓` (U+2713). That code point is outside the face's `unicode-range`, so the browser never draws it in Rajdhani. UA-default bold elements may also inherit Rajdhani (see §3.1). | **Drop only if §3.1 finds no other use** |
| Share Tech Mono 400 | `share-tech-mono-400.woff2` | Many rules. Chart.js tick, title and tooltip fonts. Preloaded by PERF-5. | **Keep** |

---

## 2  Interface changes

None. This story changes no JS API, no DOM ids and no CSS class names. Visible text must look the same. The only things that change are the set of `@font-face` blocks and the set of files in `app/fonts/`.

---

## 3  Implementation notes

### 3.1  Audit method (record the matrix in the PR description)

Build a family × weight usage matrix from **all** of these sources. A face counts as "used" if any one source asks for it.

1. **CSS rules** in `app/ballistics.css`: every `font-family`, every `font-weight` (numbers and `bold`, `bolder`, `normal`), and every `font:` shorthand. Resolve inheritance: a rule that sets only `font-weight` takes the family of the nearest ancestor that sets one. The root family is `body { font-family: 'Rajdhani' }`.
2. **UA-default bold.** These elements default to `font-weight: bold` (700) unless a rule overrides it: `h1`–`h6`, `th`, `b`, `strong`, `optgroup`, `legend`. For each one in `app/index.html` **or produced by JS**, find its resolved family. If any resolves to Rajdhani without overriding the weight, Rajdhani 700 is used.
   Known cases: `th` in `table` resolves to Share Tech Mono, which has only a 400 face, so bold is synthesized and no Rajdhani face is involved. `.readout-table th` sets `font-weight: normal`. `h1` is Orbitron 900. `h3.tool-title` is Share Tech Mono.
   Form controls (`button`, `input`, `select`) don't inherit `font-family` unless a rule says so (for example `.sort-btn { font-family: inherit }`). Check each one.
3. **Inline styles** in `app/index.html`: `grep -n "font-" app/index.html`.
4. **JS-generated markup and styles**: `grep -nE "<(b|strong|th|h[1-6]|optgroup|legend)[ >]|font-weight|fontWeight|style\.font" app/*.js app/physics/*.ts`. Include `app/custom-bullets.js` (UX-1) and `app/tools.js`.
5. **Canvas fonts.** Chart.js draws text with `font: { family, weight }` objects. `grep -n "family:" app/ballistics.js`. Canvas text uses the `@font-face` faces too.

### 3.2  Removal

For each face with zero use:
- Delete its `@font-face` block from `app/ballistics.css`.
- Delete its file from `app/fonts/` with `git rm`.
- Update the comment above that family in the CSS. For example, `/* Rajdhani — primary UI body font (wght 300/400/500/600/700) */` becomes the weights that remain.

Also fix the stale file-header comment (lines 2–4). It says files "live in static/fonts/ and are served by Spring Boot at /fonts/*". Replace it with: files live in `app/fonts/`, Vite fingerprints them into `dist/assets/`, and the SW precaches them.

Don't change `unicode-range`, `font-display` or the `src` form of the faces you keep.

### 3.3  Regression guard: `tests/fonts.test.js` (new)

This is a Node-side Jest test. It reads files with `fs` and imports no app modules, so coverage is unaffected. It parses `app/ballistics.css` with `/@font-face\s*\{[^}]*\}/g` and extracts `font-family`, `font-weight` and the `url(...)` basename from each block.

Assertions:
1. Every `src` basename exists in `app/fonts/`.
2. Every `*.woff2` file in `app/fonts/` is referenced by exactly one `@font-face` (no orphan files).
3. No two `@font-face` blocks share the same (family, weight, style).
4. Every `<link rel="preload" as="font">` href in `app/index.html` (from PERF-5) has a matching `@font-face` `src` basename. If a later change deletes a preloaded face, this test fails.

---

## 4  Test requirements

- `tests/fonts.test.js` as specified in §3.3. All four assertions pass after the deletions.
- No existing test should need to change. If one asserts on a font file list, update it and say so in the PR.
- `npm test` passes at 100/100/100/100. App JS doesn't change, so the coverage denominator doesn't change.

---

## 5  Acceptance criteria

1. The PR description contains the usage matrix from §3.1 and a verdict for each of the 9 faces.
2. `app/fonts/` and `dist/assets/` contain only the faces marked used. Expected: 6 or 7 files, down from 9.
3. The `STATIC_ASSETS_TO_PRECACHE` list in the built `dist/sw.js` no longer lists the deleted faces. The PR states the byte reduction: the total size of the deleted files.
4. Visual check on desktop and at ≤500 px width (screenshots in the PR): header, sidebar (bullet cards including the active ✓), run button, every chart title, legend and tooltip, stat cards, data table, range readout, Tools panel. No glyph changes weight or falls back to a system font.
5. DevTools → Network on a cold load followed by a full UI walk-through shows no 404 for any `.woff2`.
6. `npm test` passes at 100/100/100/100, including `tests/fonts.test.js`.

---

## 6  Out of scope

- Switching to variable fonts, or re-subsetting the faces you keep.
- Changing which faces PERF-5 preloads.
- Excluding fonts from the SW precache. PERF-2 offline behaviour depends on them.
