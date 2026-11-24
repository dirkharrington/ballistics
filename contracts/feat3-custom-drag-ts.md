# FEAT-3: Wire the custom drag table (CSV) into the TS physics engine

**Version:** 1.1.0 (2026-11-23: §3.4 superseded by ADR 011, see `adr-engine-drag-calibration.md`)
**Status:** Contract written, builder pending (after FEAT-2). §0 D2 needs user approval.
**Date:** 2026-11-17
**Author:** Architect
**Story:** FEAT-3
**Branch:** `claude/feat3-custom-drag`
**Base branch:** `claude/feat2-coriolis` (stacked). Open the PR against `claude/feat2-coriolis`. Retarget it to `main` once FEAT-2 merges, and rebase if needed.
**Depends on:** `feat1-spin-drift-ts.md` and `feat2-coriolis-ts.md`. FEAT-3 edits the same `validate()`, `simulate()`, test file and golden fixture, so it must land third.
**Supersedes for the TS engine:** `wa12-custom-drag.md` §2–§4 (Rust/Java, on hold). Don't edit that file. Its validation rules (§1.3) and `dragModel` override semantics (§1.2) are kept.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0  Deviations from the story brief

| # | Brief said | Contract says | Why |
|---|---|---|---|
| D1 | "`dragModel` field in `TrajectoryResult` should report `'custom'` (or extend the union type)" | `TrajectoryResult` has no `dragModel` field today. Add a **new** `readonly dragModel: EffectiveDragModel`, where `EffectiveDragModel = DragModel \| 'custom'`. The **input** union `DragModel` is not extended | If `'custom'` were added to the input `DragModel`, callers could pass `dragModel: 'custom'` with no table. The runtime is lenient and would silently run G1. A separate output type keeps the input honest |
| D2 | "No UI changes needed" | No *functional* UI change. **Copy-only** change to 4 strings plus the MODEL status pill (§6) | Today the UI tells users the table "requires server update" and "results currently use the selected drag model". Once FEAT-3 ships, both statements are false. **User decision:** if the user strikes §6 before building, the builder skips it |

---

## 1  Problem

`TrajectoryParams.customDragTable` is reserved and ignored. The UI already does the rest:
- It parses and validates the CSV (`app/drag-csv.js` `parseDragCsv`).
- It persists the table under `localStorage['ballistics.customDragTable']` and re-validates it on load (`ballistics.js` lines 1428–1439).
- It passes the table to the engine on custom-round runs (`runCustom`, line 415).

The engine still uses G1/G7.

### 1.1 Confirmed input format (unchanged by this story)

The CSV rules come from `parseDragCsv` and match WA-12 §1.3:

- A header row is required. It must have `mach` and `cd` columns, case-insensitive, in either order, optionally `"quoted"`. Other columns are ignored.
- Line endings can be CRLF, CR or LF. Blank lines are skipped. Each cell is trimmed. Values are plain decimals or exponent notation.
- 3–100 data rows. `0 <= mach <= 5`, `0.001 <= cd <= 2`, and mach strictly increasing.
- Coverage: at least one row with `mach <= 0.5` and at least one with `mach >= 2.0`.
- Max file size is 64 KB, enforced in the `change` handler.
- The output is `{ mach: number, cd: number }[]`, which is already the `DragPoint` shape in `types.ts`.

### 1.2 Scope of use (unchanged)

Only **custom-round** runs (`runCustom`) send `customDragTable`. Catalog runs (`runSimulation`), sweep, compare, the DOPE card and the BC solver don't send it. That's the WA-12 §6 privacy scoping, and FEAT-3 doesn't widen it.

## 2  Interface changes (`app/physics/types.ts`)

```ts
/** Reference drag model (input). Runtime is lenient: any value other than 'G7' selects G1. */
export type DragModel = 'G1' | 'G7';                       // unchanged

/** Drag model actually used for a result (output). 'custom' = customDragTable was applied. FEAT-3 */
export type EffectiveDragModel = DragModel | 'custom';

/** One point on a user-supplied Mach → Cd curve. Validated by simulate() (FEAT-3 §3.3). */
export interface DragPoint {
  readonly mach: number; // [0, 5], strictly increasing within a table
  readonly cd: number;   // [0.001, 2]
}
```

In `TrajectoryParams`, comment-only:

```ts
readonly customDragTable?: readonly DragPoint[] | null; // 3–100 points; non-empty overrides dragModel (FEAT-3). null/[] = use dragModel
```

In `TrajectoryResult`, add one required field after `supersonicLimitMeters`:

```ts
  readonly dragModel: EffectiveDragModel;   // FEAT-3. 'custom' when customDragTable was applied, else 'G7' if params.dragModel === 'G7', else 'G1'
```

No other type changes. `TrajectoryPoint` is unchanged.

## 3  Engine changes (`app/physics/engine.ts`)

### 3.1 New `@internal` export: table conversion

The engine's tables are `[velocity fps, F]`, interpolated on |v|. A Mach table converts to that shape with the engine's existing `SOUND_FPS = 1125`, the same constant that sets `supersonicLimitMeters`:

```ts
/** Converts a Mach→Cd table to the engine's [velocity fps, value] DragTable shape. @internal */
export function toDragTable(points: readonly DragPoint[]): DragTable {
  return points.map(p => [p.mach * SOUND_FPS, p.cd] as const);
}
```

Import `DragPoint` and `EffectiveDragModel` as types from `./types.ts`.

**`interpolateDragTable`, `findZeroAngleFps`, `integrateTrajectoryFps` and `deriv` don't change.** The custom table goes through the existing `dragTable` parameter. Drag stays `interpolateDragTable(|v|, table) × rho / bc`. Clamping below the first row and above the last row behaves the same as for G1/G7.

### 3.2 `simulate()`

Replace the single `dragTable` line:

```ts
const custom      = params.customDragTable;
const useCustom   = custom != null && custom.length > 0;
const dragModel: EffectiveDragModel =
  useCustom ? 'custom' : ((params.dragModel ?? 'G1') === 'G7' ? 'G7' : 'G1');
const dragTable   = useCustom ? toDragTable(custom) : (dragModel === 'G7' ? G7_TABLE : G1_TABLE);
```

Then add `dragModel,` to the returned object, after `supersonicLimitMeters`. Everything else, including the FEAT-1 and FEAT-2 `extras`, is unchanged. Spin drift and Coriolis apply on top of a custom table.

### 3.3 Validation (`validate()`)

Append these after the FEAT-2 latitude and azimuth checks. When `customDragTable != null`, check rule 1. If the array is then empty, stop: an empty array means "absent", as in WA-12 §1.2. Otherwise check rules 2–7. Every failure throws `TrajectoryInputError('customDragTable', <expected>)`. Check in this order (first failure wins):

| # | Rule | `expected` text |
|---|---|---|
| 1 | `Array.isArray(table)` | `'an array of { mach, cd } points'` |
| 2 | `3 <= length <= 100` | `'between 3 and 100 points'` |
| 3 | Each entry: `isFiniteNumber(p?.mach) && p.mach >= 0 && p.mach <= 5` | `'mach values between 0 and 5'` |
| 4 | Each entry: `isFiniteNumber(p?.cd) && p.cd >= 0.001 && p.cd <= 2` | `'cd values between 0.001 and 2'` |
| 5 | **Strictly increasing after conversion:** `p[i].mach * SOUND_FPS > p[i-1].mach * SOUND_FPS` for all `i >= 1` | `'strictly increasing mach values'` |
| 6 | Some `mach <= 0.5` | `'at least one point with mach <= 0.5'` |
| 7 | Some `mach >= 2.0` | `'at least one point with mach >= 2.0'` |

Rule 5 compares the **converted** fps values, not the raw Mach values. Two Mach values one ULP apart can round to the same fps product, which would make `interpolateDragTable` divide by zero (`t = 0/0`). A strict increase in fps implies a strict increase in Mach, so this one check covers both the PERF-8 precondition and the user rule.

Because rule 1 runs whenever the table is non-null, a non-null non-array (for example from tampered prefs) fails instead of being treated as absent. In §3.2, `useCustom` only ever sees a validated array.

### 3.4 Physics limitation (document it in the JSDoc on `toDragTable`)

> **SUPERSEDED (2026-11-23) by ADR 011 / `engine-drag-calibration.md`.** The engine now uses standard retardation `a = 2.08551e-4 · rho · Cd(M) · v² / BC` with true G1/G5/G7 C_d tables. A custom `cd` is a true reference drag coefficient, still scaled by the bullet's BC. For a bullet-specific Doppler curve, BC = sectional density (lb/in²). The text below is kept for history only.

The engine's G1/G7 columns are scaled form-factor values F(v), about 0.05–0.20. They are not true drag coefficients. The custom `cd` drops into the same slot and is still divided by the bullet's BC, with no Cd→retardation conversion. Results are self-consistent and respond correctly to the shape of the curve. Because the engine's drag is very weak overall (the near-vacuum behaviour noted in WA-13), the absolute effect of a custom curve is small. This contract does not try to calibrate it. See Open questions in the main-session summary.

## 4  Golden fixture update (`tests/fixtures/spa1-golden.json`)

1. **Existing cases (21 original, 3 FEAT-1, 2 FEAT-2): no change.**
2. **The golden loop gains one assertion** (in `tests/physics-engine.test.js`):
   ```js
   expect(result.dragModel).toBe(expected.dragModel ?? (params.dragModel === 'G7' ? 'G7' : 'G1'));
   ```
   Existing cases don't carry `expected.dragModel`. The fallback covers them, including the `condC` cases with no `dragModel` param.
3. **New cases** (append; .308 168 gr `bullet`, `condA` params):
   - `"308-win-168gr condA custom-flat"`: `customDragTable: [{mach:0,cd:0.28},{mach:1,cd:0.28},{mach:3,cd:0.28}]`, `expected.dragModel: "custom"`
   - `"308-win-168gr condA custom-wa12-example"`: the 7-point table from `wa12-custom-drag.md` §1 (`0/0.100, 0.5/0.097, 0.9/0.110, 1.0/0.280, 1.1/0.330, 2.0/0.280, 3.0/0.220`), `params.dragModel: "G7"` (to show the override), `expected.dragModel: "custom"`

   `expected` points: **computed by the engine** at the PR head.
4. Append `"FEAT-3: 2 custom-drag cases appended; dragModel asserted on all cases"` to `amendments`.

## 5  Engine tests (`tests/physics-engine.test.js`)

Coverage must stay at **100/100/100/100**. `npm test` must pass.

| # | Case | Assertion |
|---|---|---|
| 1 | Golden fixture | Passes, including the new `dragModel` assertion |
| 2 | `customDragTable` omitted, `null` and `[]` (.308 condA G1, and again with G7) | Points `toEqual` the no-table run. `dragModel` is `'G1'` / `'G7'` |
| 3 | G1-equivalent table: `G1_TABLE.map(([v,f]) => ({ mach: v / 1125, cd: f }))` | Every point field is within ±0.1 of the plain G1 run. `dragModel === 'custom'` |
| 4 | Override: the same custom table with `dragModel: 'G1'` and with `'G7'` | Points `toEqual`. Both `dragModel === 'custom'` |
| 5 | Heavy flat table (`cd: 2.0` at mach 0/1/3) vs plain G1 | At the last point: `velocityMps` lower, `timeOfFlightSec` higher, `dropCm` more negative |
| 6 | Custom table plus twist 10 plus lat 45 / az 90 | `spinDriftCm` and `coriolisDeflectionCm` are present. Each is `>= 0`, and `> 0` at the last point |
| 7 | `toDragTable` | `[{mach:0,cd:0.1},{mach:2,cd:0.3}]` → `[[0,0.1],[2250,0.3]]`. Output is strictly ascending in column 0 |
| 8 | Validation, one test per rule 1–7 | `customDragTable: 'x'` / `{}` (rule 1). 2 points, 101 points (rule 2). Mach `-0.1`, `5.1`, `NaN`, entry `null` (rule 3). Cd `0`, `2.1`, missing `cd` (rule 4). Equal mach, decreasing mach (rule 5). No point `<= 0.5` (rule 6). No point `>= 2.0` (rule 7). Each throws `TrajectoryInputError` with `field === 'customDragTable'` |
| 9 | Validation boundaries | Exactly 3 and exactly 100 points. Mach `0` and `5`. Cd `0.001` and `2`. Coverage at exactly `0.5` and `2.0`. No throw |
| 10 | `dragModel` on results | No table, `params.dragModel: 'G7'` → `'G7'`. `'G1'`, `null` or absent → `'G1'` |

Note for test 8 (rule 5): equal Mach values cover the rule-5 branch. A test with a real ULP-collapse pair (two distinct Mach values whose `× 1125` products round to the same double) is welcome but optional.

## 6  UI copy (D2: in scope unless the user strikes it)

Strings only. No logic, layout or new elements.

| Location | Current text | New text |
|---|---|---|
| `app/index.html` `#dragTableHelp` (line ~288) | `Mach,CD columns. Stored for future use — drag model override requires server update.` | `Mach,CD columns. Overrides the drag model for custom-round runs.` |
| `app/ballistics.js` `_updateDragTableStatus` (line ~115) | same as above | same new text |
| `app/ballistics.js` `_clearCustomDragTable` (line ~129) | same as above | same new text |
| `app/ballistics.js` CSV `onload` success (line ~1465) | `Loaded — requires server update to apply; results currently use the selected drag model.` | `Loaded — custom-round results use this table instead of G1/G7.` |
| `app/ballistics.js` `renderResults` MODEL pill (line ~756) | `` `MODEL: ${req.dragModel ?? 'G1'}` `` | `` `MODEL: ${req.customDragTable?.length ? 'CUSTOM' : (req.dragModel ?? 'G1')}` `` |

The MODEL pill reads `req`, not `results[0].dragModel`. Existing UI tests mock `simulateAsync` results without the new field, so `req` is the safer source.

UI tests (`tests/ballistics.test.js`): update any assertion on the old help strings. Add one test: `renderResults` with `req.customDragTable` of length 3 shows `MODEL: CUSTOM`. Coverage stays at 100%, including the new `?.length` branch (with and without a table).

## 7  Threat model delta (STRIDE-lite)

Assets: correctness of the firing solution, page availability, and the user's drag table (a potential trade secret). Trust boundaries: CSV file into `parseDragCsv`; `localStorage` into the init re-validation; `req` into `simulate()` in the worker.

| ID | STRIDE | Threat | Mitigation (required) |
|---|---|---|---|
| T1 | Tampering / DoS | Crafted table (duplicate or ULP-adjacent Mach, NaN, huge arrays) breaks interpolation (`0/0`) or stalls the worker | Engine-side validation §3.3, independent of the UI checks. The fps-based strictness check is rule 5. 100-point cap, so interpolation is O(log n). 64 KB file cap in the UI (existing) |
| T2 | Tampering | Edited `localStorage` value | Existing init re-validation (ballistics.js lines 1428–1439), plus §3.3 in the engine (defence in depth) |
| T3 | Info disclosure | Table leaves the device | Not new. The engine is in-browser with no network. The table stays in `localStorage` only and is used only by `runCustom` (§1.2). FEAT-3 adds no telemetry or URL encoding of the table |
| T4 | Injection | Error text with user values reaches the DOM | Engine errors flow to `showCustomError` / `#dragTableHelp` via `textContent` (existing). §3.3 `expected` strings contain no user data |
| T5 | Integrity | Users think custom drag is active when it isn't, or the reverse | `TrajectoryResult.dragModel` and the MODEL pill (§6) |

## 8  Acceptance criteria

1. Types, engine and validation match §2–§3 exactly. `interpolateDragTable` is untouched (`git diff` shows no change to it). `npm test` is green at 100/100/100/100.
2. Existing golden cases are untouched. 2 new cases are present, and every case's `dragModel` is asserted.
3. Manual check (`npm run dev`): load a valid CSV and run a custom round. MODEL shows `CUSTOM`, and results differ from the same round with no table. Clear the table, and MODEL shows the selected G1/G7.
4. `BACKLOG.md` marks FEAT-3 done in the same PR. It also notes that the WA-12 FE work is delivered and the engine work is replaced by FEAT-3.
5. Files changed are limited to: `app/physics/types.ts`, `app/physics/engine.ts`, `tests/physics-engine.test.js`, `tests/fixtures/spa1-golden.json`, `BACKLOG.md`, and, if §6 stands, `app/index.html`, `app/ballistics.js` and `tests/ballistics.test.js`.
