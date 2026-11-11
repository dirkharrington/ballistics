# Contract: Custom Drag Function (WA-12)

Version: 0.1.0 — 2026-11-11  
ADR: none  
Depends on: [`wasm-engine.md`](./wasm-engine.md) §3 (TrajectoryParams schema), [`engine-parity.md`](./engine-parity.md) §6 (drag table structure)  
Owners: backend/Rust (§2–§4), backend/Java (§5), frontend (§6), devsecops (§7)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0. Motivation

The G1 and G7 drag models are form-factor approximations. High-BC modern bullets (Berger Hybrid, Hornady ELD-X, Sierra MatchKing above Mach 2.0) deviate from G1 at transonic and from G7 at supersonic by up to 15%. Users who have empirically measured their bullet's drag curve (or who use manufacturer-supplied Mach-indexed CD tables) need to provide that data.

WA-12 adds an optional `customDragTable` field to `TrajectoryParams`. When present, it replaces the G1/G7 form factor lookup. The same table is accepted by both the WASM engine and the Java REST API.

---

## 1. JSON schema change — `TrajectoryParams`

Add one optional field to the existing `TrajectoryParams` object (defined in `wasm-engine.md` §3.1 and `be-jsonrpc-contract.md`):

```json
{
  "customDragTable": [
    { "mach": 0.0,  "cd": 0.100 },
    { "mach": 0.5,  "cd": 0.097 },
    { "mach": 0.9,  "cd": 0.110 },
    { "mach": 1.0,  "cd": 0.280 },
    { "mach": 1.1,  "cd": 0.330 },
    { "mach": 2.0,  "cd": 0.280 },
    { "mach": 3.0,  "cd": 0.220 }
  ]
}
```

### 1.1 Field definition

| Field | Type | Required | Description |
|---|---|---|---|
| `customDragTable` | `DragPoint[]` | optional | Per-Mach drag coefficient table. If present and non-empty, overrides `dragModel`. |
| `DragPoint.mach` | `number` | required | Mach number at which `cd` applies. |
| `DragPoint.cd` | `number` | required | Drag coefficient (dimensionless, `C_D` in the ballistic drag equation). |

### 1.2 Interaction with `dragModel`

If `customDragTable` is present and non-empty, `dragModel` is ignored. This allows clients to send both fields (e.g. `dragModel: "G7"` for display purposes) without breaking the custom path.

If `customDragTable` is absent or is an empty array `[]`, the behaviour is unchanged: `dragModel` selects G1 or G7, defaulting to G1 if absent.

### 1.3 Validation rules (enforced by both engines)

| Rule | Constraint |
|---|---|
| Minimum points | `customDragTable.length >= 3` |
| Maximum points | `customDragTable.length <= 100` |
| Mach range per point | `0.0 <= mach <= 5.0` |
| CD range per point | `0.001 <= cd <= 2.0` |
| Strictly increasing mach | `mach[i] < mach[i+1]` for all consecutive pairs |
| No NaN or Infinity | All values must be finite |
| Mach coverage | The table must include at least one point with `mach <= 0.5` and at least one point with `mach >= 2.0`. This ensures coverage of the supersonic and high-subsonic regime. |

A validation failure returns `400` (REST) or error envelope (WASM) with `code: -32602` and a message identifying which rule was violated, e.g.:
`"customDragTable validation error: mach values must be strictly increasing, got 1.0 at index 3 followed by 0.9 at index 4"`.

---

## 2. Rust implementation (`ballistics-core/src/drag.rs`)

### 2.1 `DragPoint` struct

Add to `drag.rs` (and to `types.rs` for JSON deserialization):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DragPoint {
    pub mach: f64,
    pub cd: f64,
}
```

### 2.2 `DragTable` enum

Replace the current `DragModel` enum approach with a `DragTable` enum:

```rust
pub enum DragTable<'a> {
    G1,
    G7,
    Custom(&'a [DragPoint]),
}
```

The existing `drag_coefficient(velocity_fps: f64, model: &DragModel, speed_of_sound: f64)` function is replaced by:

```rust
pub fn drag_coefficient(mach: f64, table: DragTable) -> f64
```

This function uses the existing binary-search + linear interpolation algorithm for all three variants. For `G1` and `G7`, the existing hardcoded tables are used. For `Custom`, the user-supplied slice is searched.

The calling site in `ballistics.rs` computes `mach = velocity_fps / SPEED_OF_SOUND_FPS` before calling `drag_coefficient`.

### 2.3 Validation

Validation is called in `types.rs` `TrajectoryParams::validate()` after the existing field validation. When `custom_drag_table` is `Some(table)`, apply each rule from §1.3. Return `Err(String)` with the specific message on failure.

### 2.4 `TrajectoryParams` struct addition

```rust
#[serde(skip_serializing_if = "Option::is_none")]
pub custom_drag_table: Option<Vec<DragPoint>>,
```

---

## 3. Java implementation (`BallisticsEngine.java`)

The Java engine must implement the same `customDragTable` logic to maintain parity. See `engine-parity.md` §10 (source of truth declarations).

### 3.1 `DragPoint` record

```java
public record DragPoint(double mach, double cd) {}
```

### 3.2 `TrajectoryRequest` field

```java
@Valid
@Size(min = 3, max = 100, message = "customDragTable must have 3–100 points")
private List<DragPoint> customDragTable;
```

Add a `@AssertTrue` custom validator (or `@ValidCustomDragTable` annotation) that checks mach ordering, ranges, NaN, and coverage.

### 3.3 `BallisticsEngine.java` drag lookup change

Extract the existing drag-table lookup into a private method `dragCoefficient(double mach, List<double[]> table)` that accepts an arbitrary sorted table. The G1/G7 tables from `PhysicsTables` are passed as before; when `customDragTable` is present, it is converted to `List<double[]>` pairs and passed instead.

---

## 4. Parity (`engine-parity.md` update)

Add a new section to `engine-parity.md` covering `customDragTable` parity:

| Aspect | Verdict |
|---|---|
| Interpolation algorithm | Same binary-search + linear interpolation as G1/G7 |
| Boundary clamping | Clamp at first/last point (same as G1/G7) |
| Mach conversion | `mach = velocity_fps / SPEED_OF_SOUND_FPS` — same constant in both engines |
| Epsilon | ε = 0.01 applies (same threshold) |

Add at least 2 parity test cases to `parity_tests.rs` using a minimal synthetic drag table (e.g. a flat CD = 0.280 table from Mach 0 to 3, which produces results close to G1 for typical velocities).

---

## 5. UI: CSV ingestion (`ballistics.js`, `tools.js`)

### 5.1 CSV format

The CSV import feature accepts files with two columns: `mach` (or `Mach`) and `cd` (or `CD`). Header row required. Example:

```csv
Mach,CD
0.0,0.100
0.5,0.097
...
```

### 5.2 Input element

Add a file input to the custom-round panel (adjacent to the BC solver):

```html
<label for="dragTableFile" class="form-label">Custom drag table (CSV, optional)</label>
<input type="file" id="dragTableFile" accept=".csv,text/csv" class="form-control">
<small id="dragTableHelp" class="form-text">Mach,CD columns. Overrides drag model when loaded.</small>
```

### 5.3 Parsing and validation

A new module `src/main/resources/static/drag-csv.js` (ES module, 100% Jest coverage):

```js
// Exports:
export function parseDragCsv(text: string): DragPoint[]
// Throws Error with a descriptive message if the CSV is malformed or fails validation.
// Returned array satisfies the §1.3 validation rules (pre-validated before sending to the engine).
```

Client-side validation matches §1.3 exactly. If the file fails validation, display an error message in `#dragTableHelp` and do not submit.

### 5.4 Integration with `simulateBullet`

When a valid drag table is loaded, `toEngineParams(bullet, req)` (in `engine-client.js`) must include `customDragTable` in the returned `TrajectoryParams` object. The table is stored in module-level state in `tools.js` and cleared on "Reset" / "New custom round".

The JS fallback (`simulateBulletJS`) does **not** support `customDragTable` — it uses only G1/G7. If a custom drag table is present and the engine falls back to JS, `console.warn` and the result is computed with `dragModel` (G1 by default). This is acceptable because the JS tier is a last-resort fallback.

---

## 6. Threat model delta

| STRIDE | Threat | Mitigation |
|---|---|---|
| Availability (DoS) | Attacker sends a 100-point drag table on every request, maximising validation cost. | The validation is O(n) on a max-100-point array; it completes in microseconds. The existing body-size cap (`max_body_bytes = 65536`) limits the table to well under 100 points even with large floating-point strings. |
| Tampering | A crafted drag table with a Mach 0–0 step could cause a divide-by-zero in linear interpolation. | The strictly-increasing Mach validation rule (§1.3) prevents duplicate or non-increasing values. The interpolation code asserts `denom > 0` before dividing and falls back to the nearest value. |
| Injection | CSV parsed in the browser; malformed CSV could contain unexpected values. | The CSV parser runs in the browser's JS engine with no DOM interaction. The parsed `DragPoint[]` values are plain numbers; they are validated before being sent to the engine. The engine applies its own validation independently on receipt. |
| Information disclosure | Validation error messages include user-supplied mach/CD values. | Error messages include the index and value only (not the full table). The messages go to the error display element, not to `innerHTML` (use `textContent`). |
| Privacy | The user's custom drag table is a potential trade secret. | It is never sent to any server; it is only used in the WASM engine (client-side) or in the custom-round REST endpoint. For the REST path, the data is included in the POST body in transit (use HTTPS). No persistent storage. |

---

## 7. Acceptance checklist

- [ ] `customDragTable` absent or `[]`: existing G1/G7 behaviour is unchanged.
- [ ] `customDragTable` with 3–100 valid points: results use the custom table in both WASM and Java engines.
- [ ] All §1.3 validation rules enforced by both engines; error messages are specific.
- [ ] `parseDragCsv` correctly handles: Windows line endings, quoted fields, whitespace around values, missing header, too few points, out-of-range values.
- [ ] Parity tests pass for 2+ custom-table scenarios (ε ≤ 0.01 between Rust and Java).
- [ ] The file input clears and shows an error on invalid CSV; it does not submit.
- [ ] `simulateBulletJS` fallback with custom table: `console.warn` once, computes with G1.
- [ ] `drag-csv.js` has 100% Jest coverage.
- [ ] All prior Jest coverage thresholds maintained (100/100/100/100).
- [ ] JaCoCo stays at 100%.
- [ ] `BACKLOG.md` marks WA-12 done in the same PR.

---

## 8. Task split

| ID | Owner | Task |
|---|---|---|
| WA12-BE-1 | Rust | Add `DragPoint`, extend `DragTable` enum, refactor `drag_coefficient` to accept `DragTable`. Add validation to `TrajectoryParams::validate()`. |
| WA12-BE-2 | Rust | Add parity test cases. Update `engine-parity.md` with custom-drag section. |
| WA12-BE-3 | Java/BE | Add `DragPoint` record, `customDragTable` field to `TrajectoryRequest`, `@ValidCustomDragTable` validator, drag-lookup refactor. |
| WA12-FE-1 | Frontend | Write `drag-csv.js` with `parseDragCsv`. Add file input to custom-round panel. Wire custom table into `toEngineParams`. Handle JS fallback warning. |
| WA12-FE-2 | Frontend | Jest tests for `drag-csv.js` (100% coverage). Update `tools.test.js` for custom-drag state. |
