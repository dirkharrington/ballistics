# Contract: URL state sharing (FE-1)

Version: 1.0.0 — 2026-11-01
Scope: frontend only. No backend or wire-API change.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Goal and non-goals

Goal: a link that reproduces the sidebar setup (10 parameter inputs + selected catalog rounds) when opened.

Non-goals: custom-round form values, simulation results, active tab, crosshair/pin state, and chart zoom are **not** encoded. Opening a link does **not** auto-compute.

## Files

| File | Change |
|---|---|
| `src/main/resources/static/url-state.js` | **New** ES module. Pure functions only: no DOM, no `localStorage`, no `history` |
| `src/main/resources/static/ballistics.js` | `init()` change, `toggleBullet()` change, new `currentState()`, `syncUrl()`, `copyLink()` |
| `src/main/resources/static/index.html` | New `#copyLinkBtn` |
| `src/main/resources/static/ballistics.css` | Style `.copy-link-btn` to match `.export-toggle` |
| `package.json` | Add `src/main/resources/static/url-state.js` to `jest.collectCoverageFrom`. The 100 % threshold applies to it |
| `src/test/js/url-state.test.js` | **New** unit tests |

## Query-string parameters

`b` holds the bullet IDs. The other 10 keys are the `PREF_KEYS` names without the `bv_` prefix.

| URL key | `PREF_KEYS` entry | Input element | Accepted values (else the param is **ignored**) |
|---|---|---|---|
| `b` (repeated) | `bv_selectedIds` | `selectedIds` Set | Each value matches `^[a-z0-9][a-z0-9-]{0,31}$`. Duplicates are dropped (first occurrence kept). At most **20** values are read; extras are ignored |
| `zero` | `bv_zero` | `#zeroRange` | number, `0 < v ≤ 3000` |
| `maxRange` | `bv_maxRange` | `#maxRange` | number, `0 < v ≤ 5000` |
| `wind` | `bv_wind` | `#windSpeed` | number, `0 ≤ v ≤ 200` |
| `windDir` | `bv_windDir` | `#windDir` | one of `0 45 90 135 180 225 270 315` (the `<select>` option values) |
| `altitude` | `bv_altitude` | `#altitude` | number, `0 ≤ v ≤ 10000` |
| `temp` | `bv_temp` | `#temperature` | number, `−50 ≤ v ≤ 60` |
| `step` | `bv_step` | `#step` | number, `0 < v ≤ 500` |
| `sightHeight` | `bv_sightHeight` | `#sightHeight` | number, `0 < v ≤ 150` |
| `angle` | `bv_angle` | `#shootingAngle` | number, `−45 ≤ v ≤ 45` |
| `dragModel` | `bv_dragModel` | `#dragModel` | `G1` or `G7` (case-sensitive) |

Number parsing rules:
- The raw value must match `^-?\d{1,5}(\.\d{1,3})?$` **before** conversion with `Number()`. This rejects `""` (which `Number()` would turn into `0`), `1e3`, `0x10`, `Infinity`, `NaN`, and whitespace.
- The bounds follow the server-side validation in `TrajectoryRequest` (not the narrower HTML `min`/`max`, which the browser doesn't enforce on typed input). Any setup the API accepts therefore round-trips. `wind` and `altitude` have no server maximum, so the caps here only stop absurd input.
- Unknown query keys (for example `utm_source`) are ignored on decode and **preserved** on `syncUrl()`.

Example (actual catalog IDs):

```
/?b=308-win-168gr&b=65-creedmoor-140gr&zero=100&maxRange=1000&wind=16&windDir=90&altitude=0&temp=15&step=25&sightHeight=38.1&angle=0&dragModel=G1
```

Length budget: 20 IDs × (3 + 32) + 10 params × ~16 ≈ 860 chars plus origin, well under 2000. Real catalog IDs are ≤ 19 chars (≈ 600 chars total).

## Precedence rules

Precedence is resolved **per key**, not all-or-nothing:

1. A **valid** URL param.
2. Otherwise the `localStorage` value (`loadPrefs()`).
3. Otherwise `PREF_DEFAULTS`.

Bullet selection:
- If the URL has ≥ 1 valid `b` value, it is filtered against the loaded catalog (`bullets`). If anything survives, that set becomes `selectedIds`.
- If the URL has no `b`, or nothing survives the catalog filter, use the existing behaviour (saved `bv_selectedIds` filtered to the catalog; `null` → select all).

Persistence:
- Opening a link does **not** write `localStorage`. The recipient's saved prefs stay untouched until they edit something.
- On the first user edit, the existing `savePrefs()` runs and persists the **whole** current setup, including the URL-loaded values. This is intended: the recipient has adopted the setup.

## `url-state.js` API

```js
/** URL key for each state field. Order = canonical serialization order. */
export const URL_PARAM_KEYS = Object.freeze([
  'zero', 'maxRange', 'wind', 'windDir', 'altitude', 'temp', 'step', 'sightHeight', 'angle', 'dragModel',
]);
export const URL_BULLET_KEY = 'b';
export const MAX_URL_BULLETS = 20;

/**
 * @typedef {Object} UrlState
 * @property {string[]} bulletIds       // selected catalog IDs, in selection order
 * @property {number}   zero
 * @property {number}   maxRange
 * @property {number}   wind
 * @property {number}   windDir
 * @property {number}   altitude
 * @property {number}   temp
 * @property {number}   step
 * @property {number}   sightHeight
 * @property {number}   angle
 * @property {'G1'|'G7'} dragModel
 */

/**
 * Serialize state to a query string WITHOUT the leading '?'.
 * - Emits `b` once per bullet ID (in the given order, deduplicated, max 20), then all 10 keys
 *   in URL_PARAM_KEYS order. Values are formatted with String(Number(v)), except dragModel.
 * - ALWAYS emits all 10 keys, even when equal to PREF_DEFAULTS. If a key were omitted, the
 *   recipient's own localStorage would fill the gap and the setup would not reproduce exactly.
 * - Emits no `b` when bulletIds is empty.
 * - Uses URLSearchParams for encoding.
 * @param {UrlState} state
 * @returns {string}
 */
export function encodeState(state);

/**
 * Parse a location.search string ('' or '?…'). Never throws. Applies every rule in the
 * parameter table and silently drops invalid values.
 * @param {string} search
 * @returns {{ params: Partial<Omit<UrlState,'bulletIds'>>,   // only keys that were present AND valid
 *             bulletIds: string[] | null,                    // null when no valid `b` was present
 *             recognized: boolean }}                         // true if ANY owned key (b or the 10) appeared, valid or not
 */
export function decodeState(search);

/**
 * Merge an encoded state into an existing search string. Owned keys are removed and
 * re-appended, and unknown keys are kept in their original order.
 * @param {string} existingSearch   e.g. location.search
 * @param {UrlState} state
 * @returns {string}                query string without '?', may be ''
 */
export function mergeIntoSearch(existingSearch, state);
```

## `ballistics.js` changes

```js
import { decodeState, mergeIntoSearch } from './url-state.js';

/** Snapshot of the sidebar: reads the 10 inputs (as numbers, dragModel as string) and [...selectedIds]. */
function currentState();          // → UrlState

/** history.replaceState(history.state, '', pathname + ('?' + qs | '') + hash) using mergeIntoSearch(location.search, currentState()). Never pushState. */
function syncUrl();

/** Click handler for #copyLinkBtn. See "Copy link behaviour". Returns the promise for tests. */
async function copyLink();
```

All three are added to the module's `export { … }` list. `_resetState()` needs no change (no new module state).

### `init()` change

1. Before applying prefs: `const fromUrl = decodeState(window.location.search);`.
2. Apply `{ ...loadPrefs(), ...fromUrl.params }` to the 10 inputs (replacing the current `prefs` usage in the `setVal` calls).
3. After the catalog loads and `renderBulletList()` runs: if `fromUrl.bulletIds` is non-null, filter it to catalog IDs. If the result is non-empty, use it as `selectedIds`. Otherwise run the existing prefs/select-all branch unchanged.
4. If `fromUrl.recognized` is true, call `syncUrl()` once at the end of init. This normalizes the address bar (drops invalid values, fills missing keys).
5. Wire listeners. Each param input's existing `input` listener also calls `syncUrl()` (after `savePrefs()`). Add `#copyLinkBtn` click → `copyLink()`.

### `toggleBullet()` change

After the existing `savePrefs()`, call `syncUrl()`.

Rule: `syncUrl()` runs wherever `savePrefs()` runs, and nowhere else. Plain page loads with no owned query keys leave the address bar alone.

## Copy link behaviour

- Placement: `button#copyLinkBtn.copy-link-btn` (`type="button"`) in the sidebar, the **next sibling after `.export-dropdown`** and before `<details class="custom-section">`. Visible label `COPY LINK` (a leading glyph matching `⬇ EXPORT` is fine). `aria-label="Copy a link to this setup"`.
- Clicking it:
  1. Call `syncUrl()` so the address bar matches.
  2. `url = location.origin + location.pathname + '?' + mergeIntoSearch(location.search, currentState())`.
  3. If `navigator.clipboard?.writeText` exists, await it, then `showToast('Link copied')`.
  4. If the clipboard API is missing (non-secure context, older browser), or `writeText` rejects (permission denied): `showToast("Couldn't copy. Use the link in the address bar.")`. This is the fallback: step 1 already put the full link in the address bar.
- It does not close the mobile sidebar.
- Nothing needs to change in `Permissions-Policy` or CSP. The current policy doesn't restrict `clipboard-write`, and `writeText` on a user gesture is allowed on the same origin.

## Threat model (STRIDE-lite)

| Threat | Mitigation required by this contract |
|---|---|
| **Tampering / injection.** A crafted link carries hostile values (`?b=<img onerror=…>`, `?zero=1e308`) | Strict regex and bounds per key. Bullet IDs are filtered against the catalog. Values only go into `input.value` and the `Set`, never `innerHTML` |
| **DoS** via a huge `b` list | At most 20 values read. Regex-bounded length |
| **Information disclosure** via `Referer` | Links hold only simulation params (no PII). The existing `Referrer-Policy: strict-origin-when-cross-origin` strips the query cross-origin |
| **Overwriting saved prefs** | Opening a link never writes `localStorage` (see Precedence) |

## Acceptance checklist

- [ ] `encodeState` → `decodeState` round-trips every field for a state with 0, 1, and 20 bullets.
- [ ] `encodeState` always emits all 10 keys in `URL_PARAM_KEYS` order and one `b` per bullet.
- [ ] `decodeState` ignores each of these for every numeric key: `""`, `"abc"`, `"1e3"`, `"0x10"`, `"Infinity"`, below-min, above-max. Each still counts toward `recognized`.
- [ ] `decodeState` keeps at most 20 `b` values, deduplicates, and drops IDs that fail the regex. With no valid `b` it returns `bulletIds: null`.
- [ ] `windDir=30` and `dragModel=g7` are ignored.
- [ ] Opening `/?zero=200&b=308-win-168gr` with different saved prefs: zero = 200, only that round selected, all other inputs from localStorage. `localStorage` is unchanged until the first edit.
- [ ] Opening `/?b=not-a-real-id` falls back to the saved/default selection.
- [ ] Editing any param or toggling a round updates `location.search` through `replaceState`. `history.length` does not grow.
- [ ] `?utm_source=x` survives `syncUrl()`.
- [ ] A plain load with no query string leaves the address bar unchanged.
- [ ] Copy link: success → `writeText` called with the full URL and toast "Link copied". Missing API or rejected promise → fallback toast. No unhandled rejection.
- [ ] `#copyLinkBtn` is keyboard-reachable and has an accessible name.
- [ ] Jest coverage stays at 100 % (`url-state.js` added to `collectCoverageFrom`). The `buildDOM()` test fixture includes `#copyLinkBtn`.
