# Contract: named custom round library (FE-2)

Version: 1.0.0 — 2026-11-01
Scope: frontend only. No backend or wire-API change.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Goal and non-goals

Goal: save the custom-round form as a named preset in `localStorage`, list presets, load one back into the form, and delete one.

Non-goals: sync across devices, import/export of presets, editing a preset in place (re-saving under the same name replaces it), and putting presets in the share URL (FE-1).

## Files

| File | Change |
|---|---|
| `src/main/resources/static/custom-rounds.js` | **New** ES module: storage, validation, list rendering. It imports nothing from `ballistics.js` (no cycle). Callbacks are injected |
| `src/main/resources/static/ballistics.js` | Glue: save-button handler, load/delete handlers, initial render in `init()` |
| `src/main/resources/static/index.html` | New elements inside `#customForm` (see HTML structure). Add `maxlength="64"` to `#customName` |
| `src/main/resources/static/ballistics.css` | Styles for the preset section and rows |
| `package.json` | Add `src/main/resources/static/custom-rounds.js` to `jest.collectCoverageFrom` (100 % threshold applies) |
| `src/test/js/custom-rounds.test.js` | **New** unit tests |

`bv_customRounds` must **not** be added to `PREF_KEYS`. `PREF_KEYS` defines the FE-1 URL mapping and the `savePrefs`/`loadPrefs` set.

## Storage schema

- Key: `bv_customRounds`
- Value: JSON array, at most **20** elements. Array order is display order, newest first.

```ts
interface CustomRoundPreset {
  id:      string;  // UUID v4, lowercase, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  name:    string;  // trimmed, 1–64 chars
  weightG: number;  // finite, 0 < v ≤ 30      (CustomBulletRequest.bulletWeightGrams)
  mvMps:   number;  // finite, 0 < v ≤ 2000    (CustomBulletRequest.muzzleVelocityMps)
  bc:      number;  // finite, 0 < v ≤ 1.2     (CustomBulletRequest.ballisticCoefficient)
  diaMm:   number;  // finite, 0 < v ≤ 25      (CustomBulletRequest.bulletDiameterMm)
  savedAt: string;  // ISO-8601 UTC from new Date().toISOString(), ≤ 40 chars, Date.parse() not NaN
}
```

Example:

```json
[{"id":"3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c","name":"175gr SMK handload","weightG":11.34,"mvMps":800,"bc":0.505,"diaMm":7.82,"savedAt":"2026-11-01T14:03:22.511Z"}]
```

The bounds match the server's `CustomBulletRequest` validation, so a loaded preset is always a valid `/api/trajectories/custom` input. Read validation and save validation use the **same** predicate (`isValidPreset`).

Reading is defensive. `localStorage` is user-editable and may hold old or corrupt data:
- Missing key, `JSON.parse` failure, or a non-array value → `[]`.
- Elements that fail `isValidPreset` are dropped silently. Extra properties are stripped (only the 7 schema fields are returned).
- After filtering, keep only the first 20.
- Reading never writes back. Corrupt entries are only removed from storage the next time the list is saved.

## `custom-rounds.js` API

```js
export const CUSTOM_ROUNDS_KEY = 'bv_customRounds';
export const MAX_PRESETS       = 20;
export const PRESET_NAME_MAX   = 64;
export const DEFAULT_PRESET_NAME = 'Custom Load';

/** Validation shared by load and save. */
export function isValidPreset(obj);                          // → boolean

/** Read and validate presets (rules above). Never throws; returns [] if storage is unavailable. */
export function loadPresets();                               // → CustomRoundPreset[]

/**
 * Save the current form values as a preset.
 * - name: trimmed. If empty, DEFAULT_PRESET_NAME. If longer than 64, truncated to 64.
 * - If a preset with the same name exists (exact, case-sensitive, after trimming), REPLACE it.
 *   Keep its id, set a new savedAt, and move it to index 0. A replacement never counts
 *   against the limit.
 * - Otherwise, if 20 presets already exist → { ok:false, error:'full' }. Storage is not touched.
 * - Otherwise insert at index 0 with a new id (newPresetId()).
 * - Numeric fields that fail the schema bounds → { ok:false, error:'invalid', message }.
 *   The message uses the same wording as runCustom's showCustomError, extended with the
 *   upper bound, e.g. 'Weight must be greater than 0 and at most 30 g'.
 * - A localStorage.setItem exception (quota, private mode) → { ok:false, error:'storage' }.
 * @param {{ name: string, weightG: number, mvMps: number, bc: number, diaMm: number }} input
 * @returns {{ ok: true,  preset: CustomRoundPreset, replaced: boolean, presets: CustomRoundPreset[] }
 *         | { ok: false, error: 'full' | 'invalid' | 'storage', message: string }}
 */
export function savePreset(input);

/** Remove the preset with this id, persist, and return the remaining list. An unknown id is a no-op (returns the current list). Storage failure → returns the list unchanged and logs console.warn. */
export function deletePreset(id);                            // → CustomRoundPreset[]

/**
 * Render the list into #customPresetList and set the `hidden` attribute on
 * #customPresetSection when presets is empty.
 * MUST build rows with document.createElement plus textContent / dataset. Never use
 * innerHTML or insertAdjacentHTML with preset data.
 * Wires each row's buttons to handlers.onLoad(preset) / handlers.onDelete(preset.id).
 * Missing container elements → no-op.
 * @param {CustomRoundPreset[]} presets
 * @param {{ onLoad: (p: CustomRoundPreset) => void, onDelete: (id: string) => void }} handlers
 */
export function renderPresetList(presets, handlers);

/** crypto.randomUUID() when available. Otherwise build a v4 UUID from crypto.getRandomValues (randomUUID exists only in secure contexts; the app may be served over plain http on a LAN). */
export function newPresetId();                               // → string
```

## `ballistics.js` glue

- **`#savePresetBtn` click:**
  1. Read `#customName`, `#customWeight`, `#customMV`, `#customBC`, `#customDia` (numbers via `+value`), then call `savePreset`.
  2. `ok` → `showCustomError('')`, `renderPresetList(result.presets, handlers)`, and `showToast(result.replaced ? 'Preset updated' : 'Preset saved')`.
  3. `'full'` → `showToast('Preset library full (20). Delete one to save another.')`. Nothing is saved.
  4. `'invalid'` → `showCustomError(result.message)`.
  5. `'storage'` → `showToast("Couldn't save preset: browser storage unavailable")`.
- **onLoad(p):**
  1. Set `#customName` = `p.name`, `#customWeight` = `p.weightG`, `#customMV` = `p.mvMps`, `#customBC` = `p.bc`, `#customDia` = `p.diaMm`.
  2. Call `showCustomError('')`.
  3. Do **not** call `runCustom()` and do **not** close the sidebar.
- **onDelete(id):** `renderPresetList(deletePreset(id), handlers)`. No confirmation dialog.
- **`init()`:** add a `#savePresetBtn` click listener, then call `renderPresetList(loadPresets(), handlers)`.

## HTML structure

Element roles and IDs only. Everything sits inside `#customForm`, **after** `#runCustomBtn`.

| Element | ID / class | Role |
|---|---|---|
| `button` `type="button"` | `#savePresetBtn` | Secondary-style button, label `SAVE AS PRESET`. Doesn't close the sidebar |
| `div` (has `hidden` when the list is empty) | `#customPresetSection` | Wrapper for the list |
| ↳ heading (`div.section-label`, the existing style) | — | Text `Saved presets` |
| ↳ `ul` | `#customPresetList` | `aria-label="Saved custom round presets"` |
| ↳↳ `li` per preset | `.preset-row`, `data-preset-id` | One row |
| ↳↳↳ `span` | `.preset-name` | Preset name via `textContent`. `title` = full name, so ellipsis truncation stays readable |
| ↳↳↳ `button` `type="button"` | `.preset-load-btn` | Label `Load`, `aria-label="Load preset <name>"` |
| ↳↳↳ `button` `type="button"` | `.preset-delete-btn` | Label `Delete`, `aria-label="Delete preset <name>"` |

`#customName` gains `maxlength="64"`. This matches `CustomBulletRequest.name` `@Size(max = 64)`, so it also helps `runCustom`.

## Threat model (STRIDE-lite)

| Threat | Mitigation required by this contract |
|---|---|
| **Stored XSS.** A preset name like `<img src=x onerror=…>` (typed, or planted in `localStorage`) | Rows are rendered with `textContent`/`dataset` only. `aria-label` and `title` are set with `setAttribute`. No HTML string building. CSP `script-src 'self'` is the backstop |
| **Tampering.** Corrupt or hostile `bv_customRounds` JSON | `isValidPreset` on every read. Unknown properties stripped. At most 20 entries. Never throws |
| **DoS.** A huge stored value | Only 20 entries are retained after parsing. The browser's 5 MB per-origin quota bounds the raw size |
| **Information disclosure** | Presets stay in the user's own browser and are never sent to the server until the user computes |

## Acceptance checklist

- [ ] Save with an empty name stores `"Custom Load"`. A name over 64 chars is truncated to 64.
- [ ] Save with an existing name replaces that preset (same `id`, new `savedAt`, moved to the top). The count is unchanged, and it works even when the list holds 20.
- [ ] A 21st distinct name → error toast. `localStorage` is byte-for-byte unchanged.
- [ ] Each out-of-range numeric field (≤ 0, above the upper bound, `NaN`) → `showCustomError` message. Nothing saved.
- [ ] Load fills all 5 form fields and does **not** trigger a fetch or compute.
- [ ] Delete removes the row. Deleting the last preset sets `hidden` on `#customPresetSection`. An unknown id is a no-op.
- [ ] `loadPresets` returns `[]` for a missing key, invalid JSON, a non-array value, and a throwing `localStorage`. Invalid elements are dropped. More than 20 valid elements → first 20.
- [ ] A preset named `<img src=x onerror=alert(1)>` renders as literal text (the test asserts no `img` element is created).
- [ ] `newPresetId` covers both branches (`randomUUID` present / absent) and always matches the v4 regex.
- [ ] A `localStorage.setItem` throw in `savePreset` → `{ ok:false, error:'storage' }` and a toast.
- [ ] Presets survive a page reload. `bv_customRounds` is not in `PREF_KEYS`.
- [ ] Jest coverage stays at 100 % (`custom-rounds.js` added to `collectCoverageFrom`). The `buildDOM()` fixture includes the new elements.
