# FE-ESM: Frontend ES Module Cleanup

**Status**: The frontend is **already on ES modules**. All four JS source files use
`import`/`export` syntax. `index.html` loads scripts with `<script type="module">`.
Vite's native ESM pipeline is in full use.

This contract covers the one remaining non-idiomatic pattern and documents the
test-infrastructure baseline so builders do not make incorrect assumptions.

---

## Current state

| File | Module format | Notes |
|---|---|---|
| `src/main/resources/static/ballistics.js` | ES module | `import` at top, bulk `export {}` at bottom |
| `src/main/resources/static/tools.js` | ES module | **`'use strict'` at line 1 (redundant)**, bulk `export {}` at bottom |
| `src/main/resources/static/url-state.js` | ES module | inline `export` on every declaration |
| `src/main/resources/static/custom-rounds.js` | ES module | inline `export` on every declaration |
| `src/main/resources/static/index.html` | — | `<script type="module" src="./ballistics.js">` + inline module script |

**Vite config** (`vite.config.js`):
- Root `src/main/resources/static`; output `target/classes/static`
- Two virtual-module plugins expose YAML data as ES modules:
  - `virtual:bullet-catalog` → default export from `bullets.yaml`
  - `virtual:physics-tables` → named exports `G1_TABLE`, `G7_TABLE`, `ATMOSPHERE`

**Test infrastructure**:
- Jest (`babel-jest`) transpiles ESM → CommonJS for test execution via `babel.config.json`
- Mocks in `src/test/js/__mocks__/` use `module.exports` (CommonJS)
- 100% branch/line/function/statement coverage is enforced via `coverageThreshold` in `package.json`

---

## Work item

### FE-ESM-1 — Remove redundant `'use strict'` from `tools.js`

**File**: `src/main/resources/static/tools.js`  
**Line**: 1  
**Change**: Delete `'use strict';` (and the following blank line if one exists).

In an ES module, strict mode is on by default and cannot be opted out of.
The `'use strict'` directive has no effect and is misleading.

**Acceptance checklist**:
- [ ] Line 1 of `tools.js` is no longer `'use strict';`
- [ ] `npm test -- --ci` passes at 100% coverage (no test changes required)
- [ ] `npm run build` succeeds (Vite build unaffected)
- [ ] No other source file changes

---

## Out of scope

- **Bulk-export style in `ballistics.js`/`tools.js`**: Converting the batch `export { … }` at
  the bottom to per-declaration `export function`/`export const` is a style preference.
  The current pattern is valid ES module syntax; changing it is cosmetic churn with zero
  functional benefit and carries risk of mis-exporting or test breakage in a 1400-line file.
  Do not change.

- **Jest / Babel test infrastructure**: The `babel-jest` + CommonJS mock setup is a correct
  and idiomatic Jest approach for ESM source files. Migrating to Jest's experimental
  `--experimental-vm-modules` native ESM mode would remove Babel but add instability.
  No change recommended.
