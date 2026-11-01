# Contract: `runSimulation()` error-handling refactor (FE-R1)

Version: 1.0.0 — 2026-11-01
Owner of the implementation: frontend builder. devsecops reviews it.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Deviations from the original brief

| Brief | Contract | Reason |
|---|---|---|
| "Existing `showToast` or a new inline error — your call" | Inline error banner below the Compute button (see §UI) | `showToast` auto-dismisses; a rejected request with a visible `detail` message needs to stay visible until the user changes inputs or retries. A dismissable banner is a better fit |

## Problem

`runSimulation()` (lines 367–394 in `ballistics.js`) nests three try/catch blocks.  
Every failure — including a server-returned 400 or 429 — falls into `computeClientSide()` and sets OFFLINE mode.  
Users silently receive client-side results when the server rejects a well-formed request.

## Error classification

```
throw TypeError: Failed to fetch    ┐
network error / CORS error           ├── "unreachable"  → OFFLINE fallback (unchanged)
res.ok false                         │
  └─ Content-Type: application/problem+json ─┐
       status 400                             ├── "rejected"   → inline error, no OFFLINE
       status 413                             │
       status 429                             ┘
  └─ Content-Type: other  ─────────────────────── "server error" → OFFLINE fallback

5xx with any body                   ── "server error"  → OFFLINE fallback
```

| Condition | Test | Action |
|---|---|---|
| `TypeError` (network, DNS, CORS) | `err instanceof TypeError` | OFFLINE fallback unchanged |
| HTTP 4xx with `application/problem+json` body | `!res.ok && status < 500 && contentType.includes('problem+json')` | Show inline error; **no** OFFLINE |
| HTTP 4xx with non-JSON body | `!res.ok && status < 500` | OFFLINE fallback unchanged |
| HTTP 5xx (any body) | `!res.ok && status >= 500` | OFFLINE fallback unchanged |

## Refactored structure

`runSimulation()` remains **one exported function**. Add two private helpers:

```js
/** Returns {ok, detail, retryAfterSeconds} from a fetch Response. */
async function _parseRejection(res) { … }

/** Shows or hides the inline error banner. */
function _setSimulationError(message) { … }
```

Exported surface unchanged: `runSimulation` is the only new export required by callers.  
Any existing exports from the module that reference `runSimulation` are unchanged.

### `_parseRejection(res)`

- Reads the response body as JSON (catch parse failures → `null`).
- Returns `{ status, detail, retryAfterSeconds }` where:
  - `detail` = `body.detail ?? 'Server rejected the request.'`
  - `retryAfterSeconds` = `parseInt(res.headers.get('Retry-After') ?? '0', 10)` — `0` if absent or non-numeric
- Never throws: wrap the body read in try/catch.

### `_setSimulationError(message)`

- `message` truthy → populate the error banner and make it visible (see §UI).
- `message` falsy → hide the banner.
- Call `_setSimulationError(null)` at the start of every `runSimulation()` invocation to clear a previous error.

### Control flow inside `runSimulation()`

```
_setSimulationError(null)

try {
  await streamCompare(…)                  // unchanged
  setOfflineMode(false)
} catch (_streamErr) {
  if (results.length === 0) {
    let res
    try { res = await fetch(…) }
    catch (networkErr) {
      if (networkErr instanceof TypeError) { computeClientSide; setOfflineMode(true); return }
      throw networkErr                    // unexpected, re-throw to outer catch
    }

    if (!res.ok) {
      const ct = res.headers.get('Content-Type') ?? ''
      if (res.status < 500 && ct.includes('problem+json')) {
        const { detail, retryAfterSeconds } = await _parseRejection(res)
        const msg = retryAfterSeconds > 0
          ? `${detail} Retry after ${retryAfterSeconds} s.`
          : detail
        _setSimulationError(msg)
        return                            // no OFFLINE, no computeClientSide
      }
      // 4xx non-JSON or 5xx → existing OFFLINE fallback
      computeClientSide(…); setOfflineMode(true)
    } else {
      (await res.json()).forEach(r => results.push(r))
      setOfflineMode(false)
    }
    renderResults(results, req)
  }
}
```

### 429-specific rule

When `res.status === 429`:
- `Retry-After` header (integer seconds) is read by `_parseRejection`.
- The displayed message is: `"<detail> Retry after <N> s."` (example: `"Rate limit exceeded. Retry after 12 s."`).
- Do **not** set OFFLINE mode. Do **not** call `computeClientSide()`.

## UI: inline error banner

Insert the error banner element in the HTML immediately after the Compute button (`<button id="computeBtn">`):

```html
<div id="simulationError" class="simulation-error" hidden aria-live="assertive" role="alert"></div>
```

CSS (add to the stylesheet or `<style>` block):

```css
.simulation-error {
  color: var(--color-error, #e53e3e);
  background: var(--color-error-bg, #fff5f5);
  border: 1px solid var(--color-error-border, #fc8181);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  margin-top: 0.5rem;
  font-size: 0.875rem;
}
```

`_setSimulationError(message)` implementation:

```js
function _setSimulationError(message) {
  const el = document.getElementById('simulationError')
  if (!el) return
  if (message) {
    el.textContent = message
    el.removeAttribute('hidden')
  } else {
    el.setAttribute('hidden', '')
    el.textContent = ''
  }
}
```

- `aria-live="assertive"` ensures screen readers announce the error immediately.
- The banner is hidden by default (`hidden` attribute) and shown only when `_setSimulationError` is called with a non-empty string.
- The banner is cleared on each new `runSimulation()` invocation before any async work begins.

## Prerequisite for FE-R3

FE-R3 (RK4 client-side dedup) touches `computeClientSide()`, which this contract calls on the OFFLINE path.  
The control-flow split introduced here — `return` on rejected, fallback on unreachable — is the structural prerequisite:  
FE-R3 only needs to touch the fallback branch, not the error-handling path.  
**Do not merge FE-R3 until FE-R1 is merged.**

## Acceptance checklist

Existing tests
- [ ] All existing Jest tests pass without modification.

New tests (add to the existing test file for `runSimulation`)
- [ ] Mock `fetch` returning `{ status: 400, ok: false, Content-Type: application/problem+json, body: { detail: 'Wind speed too high.' } }` → `#simulationError` is visible, `textContent` contains `'Wind speed too high.'`, `setOfflineMode` not called with `true`, `computeClientSide` not called.
- [ ] Mock `fetch` returning `{ status: 429, ok: false, Content-Type: application/problem+json, body: { detail: 'Rate limit exceeded.' }, Retry-After: '15' }` → error message contains `'Retry after 15 s.'`, OFFLINE not set.
- [ ] Mock `fetch` returning `{ status: 429, ok: false, Content-Type: application/problem+json, body: { detail: 'Rate limit exceeded.' } }` (no `Retry-After`) → message does **not** contain `'Retry after'`.
- [ ] Mock `fetch` throwing `TypeError: Failed to fetch` → `computeClientSide` is called, OFFLINE set to `true`, error banner **not** shown.
- [ ] Mock `fetch` returning `{ status: 500, ok: false }` → OFFLINE fallback, error banner **not** shown.
- [ ] Mock `fetch` returning `{ status: 413, ok: false, Content-Type: application/problem+json, body: { detail: 'Request too large.' } }` → error banner shown with `'Request too large.'`, OFFLINE not set.
- [ ] Calling `runSimulation()` a second time clears any previously displayed error banner before the new request starts.
- [ ] `_parseRejection` unit test: malformed JSON body → `detail` is the fallback string, no exception thrown.
