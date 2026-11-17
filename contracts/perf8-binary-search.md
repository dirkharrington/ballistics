# PERF-8: Binary search in `interpolateDragTable`

**Version:** 1.0.0
**Status:** Contract written, builder pending
**Date:** 2026-11-16
**Author:** Architect
**ADR:** 010 (`contracts/adr-sprint9-performance.md`, decision D5)
**Related:** SPA-1 golden fixture (`tests/fixtures/spa1-golden.json`). It locks output to be bit-identical.

---

## 1  Problem

`interpolateDragTable(v, table)` in `app/physics/engine.ts` (line 68) scans the drag table linearly. Each table has about 40–45 rows.

It is the innermost call of the physics engine. `deriv()` calls it 4 times per RK4 step, and RK4 runs in two places:
- `findZeroAngleFps`: 64 bisection passes, each integrating out to the zero range.
- `integrateTrajectoryFps`: integrates to the maximum range at `DT_S = 0.0005 s`.

For one bullet with a 100 m zero and a 1 000 m maximum range, that adds up to tens of thousands of calls, most of them in the zero-angle bisection. Rifle velocities sit in the upper part of the table, so the linear scan walks most rows before it finds the bracket.

---

## 2  Interface changes

**None.** The signature, the `@internal` export and the semantics stay exactly the same:

```ts
/** Linear interpolation on |v|, clamped to the first and last rows. @internal */
export function interpolateDragTable(v: number, table: DragTable): number;
```

**Behaviour to keep (normative):**

| Input | Result |
|---|---|
| `v` is `NaN` | `NaN` |
| `\|v\| <= table[0][0]` (includes `0`) | `table[0][1]` |
| `\|v\| >= table[n-1][0]` (includes `±Infinity`) | `table[n-1][1]` |
| otherwise | Let `i` be the **smallest** index with `\|v\| <= table[i][0]`. Then `t = (\|v\| - table[i-1][0]) / (table[i][0] - table[i-1][0])` and the result is `table[i-1][1] + t * (table[i][1] - table[i-1][1])`. |

Bracket choice matters when `|v|` equals an interior breakpoint exactly. The current code picks bracket `[i-1, i]` with `t = 1`, and the result can differ from `table[i][1]` in the last ULP. A lower-bound search picks the same `i`, so the output stays bit-identical.

**Precondition (already true, now written down):** `table[*][0]` is strictly ascending. Both shipped tables meet it (the §4 test enforces this). User CSV tables from `parseDragCsv` reject anything that isn't strictly increasing Mach (`app/drag-csv.js` lines 62–69). Any future caller that passes a table must guarantee the same.

---

## 3  Implementation

```ts
export function interpolateDragTable(v: number, table: DragTable): number {
  v = Math.abs(v);
  if (Number.isNaN(v)) return Number.NaN;
  const n = table.length;
  if (v <= table[0]![0]) return table[0]![1];
  if (v >= table[n - 1]![0]) return table[n - 1]![1];
  // Lower bound over [1, n-1]: smallest i with v <= table[i][0].
  // Invariant: table[0][0] < v < table[n-1][0], so i exists and 1 <= i <= n-1.
  let lo = 1, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (table[mid]![0] < v) lo = mid + 1; else hi = mid;
  }
  const a = table[lo - 1]!, b = table[lo]!;
  const t = (v - a[0]) / (b[0] - a[0]);
  return a[1] + t * (b[1] - a[1]);
}
```

Notes:
- Keep the arithmetic in exactly this order: `a[1] + t * (b[1] - a[1])`, with `t` computed as shown. Don't factor or fuse the operations. Reordering floating-point operations breaks bit-identity.
- Use indexed access (`a[0]`, `b[1]`), not tuple destructuring, in this hot path.
- The final `return Number.NaN` of the old loop becomes unreachable, so remove it. The explicit `Number.isNaN` guard takes its place, and the existing `NaN` test covers it.
- Don't change `deriv`, `findZeroAngleFps`, `integrateTrajectoryFps` or the `DragTable` type. Caching the last bracket and typed-array tables are out of scope (ADR 010, D5).
- `engine.ts` is bundled into both the worker and Jest, so no other file changes.

---

## 4  Test requirements (`tests/physics-engine.test.js`)

1. **The existing `interpolateDragTable` tests pass unchanged.** They cover the clamps, the interior values, negative `v`, `NaN` and G7.
2. **Equivalence property test (new).** Put a copy of the old linear-scan function, verbatim, inside the test file as `referenceLinear`. For both `G1_TABLE` and `G7_TABLE`, assert `Object.is(interpolateDragTable(v, T), referenceLinear(v, T))` for:
   - every breakpoint `T[i][0]`, plus `T[i][0] ± Number.EPSILON * T[i][0]`
   - every midpoint `(T[i][0] + T[i+1][0]) / 2`
   - `0`, `-0`, the negations of all the above, `Infinity`, `-Infinity`, `NaN`
   - 10 000 values from a seeded PRNG (for example mulberry32 with a fixed seed) uniform over `[0, 1.1 × T[n-1][0]]`. No `Math.random`, so failures can be reproduced.
3. **Small-table edge cases (new).** For 2-row and 3-row hand-written tables, check the clamps and one interior value, so `lo`/`hi` initialisation is exercised at the minimum size.
4. **Table precondition (new).** `G1_TABLE` and `G7_TABLE` have strictly ascending `v`.
5. **Golden fixture.** `simulate() — golden fixture` passes unchanged. Don't regenerate `spa1-golden.json`. If it fails, the implementation is wrong.
6. Don't put timing assertions in Jest.

Coverage: 100/100/100/100. The `while` loop's two branches (`lo = mid + 1` and `hi = mid`) are covered by the interior tests.

---

## 5  Acceptance criteria

1. `interpolateDragTable` uses the lower-bound binary search in §3. No linear loop remains.
2. The golden fixture test and the new equivalence property test pass. Output is bit-identical (`Object.is`) to the old implementation.
3. The PR description gives before and after timings: median of 5 runs of `simulate()` for a 10-bullet, 2 000 m, 1 m-step request. Measure in Node or the browser with a throwaway script, not in CI. The "after" median must not be slower than "before".
4. `npm test` passes at 100/100/100/100.
