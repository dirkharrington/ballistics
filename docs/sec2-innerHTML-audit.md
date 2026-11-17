# SEC-2 innerHTML audit — 2026-11-16

## Scope

All `innerHTML` / `insertAdjacentHTML` / `outerHTML` / `document.write` calls
in `app/` (excluding tests and node_modules).

## Findings

### `app/tools.js`

| Line | Site | Data flowing in | Safe? |
|------|------|-----------------|-------|
| 101 | `thCols` interpolated into `table.innerHTML` | `_esc(r.bullet.name)` + numeric `colSpan` | ✅ |
| 102 | `thSub` interpolated into `table.innerHTML` | Static string literals | ✅ |
| 104–122 | `bodyRows` interpolated into `table.innerHTML` | `Math.round`/`.toFixed` results, numeric `dist` | ✅ |
| 136 | `row.innerHTML` | Numeric `d` (coerced by `+e.target.value`), numeric index `i` | ✅ |

`_esc()` (line 48) encodes all five HTML special characters: `& < > " '`.

### `app/ballistics.js`

| Lines | Site | Data flowing in | Safe? |
|-------|------|-----------------|-------|
| 118–127 | `list.innerHTML` (bullet cards) | `escapeHtml(b.id)`, `escapeHtml(b.name)`, `escapeHtml(String(b.ballisticCoefficient))`, `escapeHtml(String(b.muzzleVelocityMps))` | ✅ |
| 473–479 | `tbody.innerHTML` (results table) | `escapeHtml(r.bullet.name)`, computed numbers | ✅ |
| 506, 686, 771, 1066 | `insertAdjacentHTML` | `escapeHtml(r.bullet.name)`, computed numbers, trusted color hex strings | ✅ |
| 646, 1051 | `innerHTML = ''` | Empty string (clear) | ✅ |
| 930 | `tbody.innerHTML` (sweep table) | `escapeHtml(r.bullet.name)`, computed numbers | ✅ |

`escapeHtml()` (line 18) encodes the same five characters as `_esc()`.

## CodeQL alert #12

Alert pointed to `src/main/resources/static/tools.js` — deleted in SPA-4
(PR #93). Dismissed as **false positive**: the equivalent code in
`app/tools.js` is clean (see above). CodeQL's current analysis of the live
codebase does not raise this alert.

## Conclusion

No XSS vectors found. All user-visible strings entering `innerHTML` or
`insertAdjacentHTML` are sanitised with `escapeHtml()` or `_esc()`. All other
interpolated values are computed numbers or static constants.
