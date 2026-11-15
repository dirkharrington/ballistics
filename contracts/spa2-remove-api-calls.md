# Contract: Remove API Fetch Calls (SPA-2)

Version: 1.0.0 — 2026-11-15
Status: **Proposed** (pending user review)
Owners: frontend builder (§2–§7, §9, §11), devsecops (§8, §10 review, §12)
Prerequisite: `spa1-ts-engine.md` merged. All sections describe post-SPA-1 state.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0. Deviations from the brief

| Brief | This contract | Reason |
|---|---|---|
| "`GET /api/trajectories/compare/stream` (SSE)" | Endpoint uses `method: 'POST'` in `streamCompare()` | The brief mislabels the method; the code at line 411 issues a POST. Replacement is the same. |
| "2 sites for `POST /api/rpc` trajectory" | The 2 sites are `streamCompare` (line 411) and the non-streaming fallback `fetch('/api/trajectories/compare')` (line 522) | Both compute trajectories; `POST /api/rpc` is the bullets-list probe in `init` and `probeServer`, not trajectory. |
| "Replace compare with `Promise.all([simulate(b1, req), simulate(b2, req)])`" | Replaced with `computeClientSide(req)` which maps over all selected bullet IDs | `computeClientSide` is already the abstraction; duplicating `Promise.all` inline would contradict SPA-1's sync refactor of that function. |
| "`runSimulation` becomes async with `Promise.all`" | `runSimulation` becomes a plain synchronous `function` | After SPA-1, `computeClientSide` is synchronous. No `await` point remains in `runSimulation` after removing the fetch calls. |

---

## 1. Scope

### 1.1 Goals
1. Remove every `fetch('/api/...')` call from `ballistics.js`: 5 call sites.
2. Load the bullet catalog from `getMockBullets()` (the `virtual:bullet-catalog` data already in the bundle) instead of from `POST /api/rpc` `bullets.list`.
3. Delete all online/offline toggle logic: `offlineMode`, `retryTimer`, `setOfflineMode()`, `probeServer()`, the `#statusPill` DOM element, the `#retryBtn` DOM element, the `window.offline`/`window.online` listeners, and the auto-retry interval.
4. The app is always "ready". No network state concept survives.
5. Preserve 100/100/100/100 Istanbul coverage.

### 1.2 Non-goals
- No changes to `physics/engine.ts` or `physics/types.ts`.
- No changes to `sw.js` (§7).
- No changes to `SecurityHeadersFilter.java` CSP (`connect-src`) in SPA-2 (§8).
- No changes to `tools.js`, `url-state.js`, `custom-rounds.js`.
- No changes to Latitude/Azimuth inputs — they remain in the UI and URL state; the engine already accepts and ignores them (SPA-1 §4.4).
- No deletion of `streamCompare()` body elements in `index.html` other than `#statusPill` and `#retryBtn`.
- No deletion of the Java/Spring Boot backend or Rust crate (SPA-3).

### 1.3 Accepted regressions
1. `spinDriftCm` and `densityAltitudeMeters` are absent from **all** results, not just offline results. The UI already tolerates their absence (SPA-1 §1.3). The readout, stat cards, table, and spin-drift chart series silently render nothing.
2. `coriolisDeflectionCm` is absent. `simulateBulletJS` computed it from `latitudeDeg` (lines 330–338); the TS engine ignores `latitudeDeg`. The Coriolis column (`#coriolisColHeader`) and Coriolis chart series are silently empty. The `latitudeDeg`/`azimuthDeg` inputs remain in the UI for future use (WA-13).

---

## 2. The five call sites (post-SPA-1 state)

After SPA-1 merges, these are the five remaining `fetch()` calls in `ballistics.js`:

| # | Site | Location (pre-SPA-1 line) | Action in SPA-2 |
|---|---|---|---|
| 1 | `init()` → `fetch('/api/rpc', bullets.list)` | line 1613 | Replace with `getMockBullets()` (§3.1) |
| 2 | `streamCompare()` → `fetch('/api/trajectories/compare/stream')` | line 411 | Delete `streamCompare` function; replace `runSimulation` server path with engine call (§3.2) |
| 3 | `runSimulation()` → `fetch('/api/trajectories/compare')` fallback | line 522 | Deleted as part of §3.2 |
| 4 | `runCustom()` → `fetch('/api/trajectories/custom')` | line 674 | Replace with direct `simulate()` call (§3.3) |
| 5 | `probeServer()` → `fetch('/api/rpc', bullets.list)` | line 723 | Delete `probeServer` function (§3.5) |

---

## 3. Exact changes to `ballistics.js`

### 3.1 `init()` — bullet load

**Delete** (lines 1612–1625 in pre-SPA-1 source):
```js
try {
  const res = await fetch(`${API_BASE}/rpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'bullets.list', id: 1 }),
  });
  const data = await res.json();
  if (data.error) throw new Error('RPC error');
  bullets = data.result;
} catch (e) {
  console.warn('API offline — using mock data for preview');
  bullets = getMockBullets();
  setOfflineMode(true);
}
```

**Replace with** (one line):
```js
bullets = getMockBullets();
```

`init()` can be made a plain `function` (drop `async`) since bullet load and all other awaited work (engine start) are removed here and in §3.4.

**Also delete from `init()`:**
```js
window.addEventListener('offline', () => setOfflineMode(true), { signal });
window.addEventListener('online', probeServer, { signal });
if (!navigator.onLine) setOfflineMode(true);
```
and:
```js
document.getElementById('retryBtn')?.addEventListener('click', probeServer);
```

### 3.2 `runSimulation()` — server-first trajectory path

**Post-SPA-1 `runSimulation` body** (sketch):
```js
async function runSimulation() {
  ...
  try {
    try {
      await streamCompare(req, result => { results.push(result); done++; setProgress(); renderResults(results, req); });
      setOfflineMode(false);
    } catch (_streamErr) {
      if (results.length === 0) {
        let res;
        try { res = await fetch(`${API_BASE}/trajectories/compare`, { ... }); }
        catch (networkErr) {
          (await computeClientSide(req)).forEach(r => results.push(r));
          setOfflineMode(true); renderResults(results, req); lastResults = results; return;
        }
        if (!res.ok) { /* problem+json or offline fallback */ }
        else { (await res.json()).forEach(r => results.push(r)); setOfflineMode(false); }
        renderResults(results, req);
      }
    }
    lastResults = results; updateSweepButtonVisibility();
  } catch (err) { console.error(err); }
  finally { ... button reset ... }
}
```

**Replace with** (the entire try block):
```js
function runSimulation() {
  if (selectedIds.size === 0) { alert('Select at least one round.'); return; }
  _setSimulationError(null);

  const latRaw = document.getElementById('latitudeDeg')?.value;
  const azRaw  = document.getElementById('azimuthDeg')?.value;
  if (latRaw && (+latRaw < -90 || +latRaw > 90)) { _setSimulationError('Latitude must be between −90 and 90.'); return; }
  if (azRaw  && (+azRaw  < 0  || +azRaw  > 360)) { _setSimulationError('Azimuth must be between 0 and 360.'); return; }

  const btn = document.getElementById('runBtn');
  btn.classList.add('loading');

  const twistRaw = document.getElementById('twistRate')?.value;
  const req = { /* identical to today's req object construction */ };
  lastReq = req;

  try {
    const results = computeClientSide(req);
    renderResults(results, req);
    lastResults = results;
    updateSweepButtonVisibility();
  } catch (err) {
    if (err instanceof TrajectoryInputError) {
      _setSimulationError(err.message);
    } else {
      console.error(err);
    }
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
  }
}
```

Changes:
- Drop `async` / `await` — no I/O remains.
- Remove `done`, `total`, `setProgress`, and the `⏳ N/M COMPUTED...` button text update.
- Remove `setOfflineMode(false)` / `setOfflineMode(true)` calls.
- Remove the `streamCompare` call.
- Remove the `fetch('/api/trajectories/compare')` fallback.
- Catch `TrajectoryInputError` and show it via `_setSimulationError`; rethrow anything else via `console.error`.

**Delete** the `streamCompare()` function (lines 409–439) in its entirety.

**Delete** `_parseRejection()` function — its only caller was the `problem+json` branch of `runSimulation()`. Confirm no other caller exists before deleting.

### 3.3 `runCustom()` — custom round

**Delete** (lines 673–690 in pre-SPA-1 source):
```js
let result;
try {
  const res = await fetch(`${API_BASE}/trajectories/custom`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  result = await res.json();
} catch (e) {
  // offline fallback
  const bullet = { id: 'custom', name, caliber: 'Custom',
    bulletWeightGrams: weight, muzzleVelocityMps: mv,
    ballisticCoefficient: bc, bulletDiameterMm: dia,
    muzzleEnergyJoules: Math.round(0.5 * (weight / 1000) * mv * mv) };
  result = await simulateBullet(bullet, { ...req, bulletIds: ['custom'] });
}
lastResults = [result];
renderResults([result], req);
```

**Replace with**:
```js
const bullet = {
  id: 'custom', name, caliber: 'Custom',
  bulletWeightGrams: weight, muzzleVelocityMps: mv,
  ballisticCoefficient: bc, bulletDiameterMm: dia,
  muzzleEnergyJoules: Math.round(0.5 * (weight / 1000) * mv * mv),
};
let result;
try {
  result = simulate(bullet, { ...req, bulletIds: ['custom'] });
} catch (err) {
  if (err instanceof TrajectoryInputError) {
    return showCustomError(err.message);
  }
  throw err;
}
lastResults = [result];
renderResults([result], req);
```

Changes:
- Remove the fetch call and its try/catch.
- Construct the bullet object unconditionally (it was already in the catch branch).
- Call `simulate()` synchronously; propagate `TrajectoryInputError` to `showCustomError`.
- `runCustom` can remain `async` or be made synchronous — no `await` remains.

### 3.4 `init()` — engine start and page lifecycle

**Delete from `init()`:**
```js
onBusyChange(_setComputing);
startEngine().then(tier => { document.documentElement.dataset.engineTier = tier; });
window.addEventListener('pagehide', shutdownEngine, { signal });
window.addEventListener('pageshow', e => {
  if (e.persisted) startEngine().then(tier => { document.documentElement.dataset.engineTier = tier; });
}, { signal });
```

These imports from `engine-client.js` are already removed by SPA-1 (§7.1).

**Update:**
```js
initDopeCard(simulateBullet);  // SPA-1 already changes to simulate
initBcSolver(simulateBullet);  // same
```
These are already `simulate` after SPA-1 (§7.1). No further change.

### 3.5 `probeServer()` and `setOfflineMode()`

**Delete** `probeServer()` function (lines 721–739) in its entirety.

**Delete** `setOfflineMode(isOffline)` function (lines 696–718) in its entirety.

### 3.6 Module-level state

**Delete** these two module-level variable declarations:
```js
let offlineMode = false;
let retryTimer  = null;
```

**Delete** `API_BASE` constant:
```js
const API_BASE = '/api';
```
No remaining references after the five fetch call sites are removed.

### 3.7 `_getState()` and `_resetState()`

**`_getState()`**: Remove `offlineMode` and `retryTimer` from the returned object literal.

**`_resetState()`**: Remove:
```js
offlineMode = false;
```
and:
```js
if (retryTimer !== null) { clearInterval(retryTimer); retryTimer = null; }
```
(The `_computingTimer` lines are already removed by SPA-1 §7.1.)

### 3.8 Export list

Remove from the `export { ... }` block at the bottom:
- `streamCompare`
- `setOfflineMode`
- `probeServer`
- `_parseRejection`
- `EARTH_ROTATION_RADS` (no reference in `ballistics.js` after removing the Coriolis block; the constant itself was in `simulateBulletJS` which SPA-1 deleted. Confirm no remaining reference before deleting.)

Keep `computeClientSide` in exports (tests import it).

---

## 4. Response shape mapping (REST → `TrajectoryResult`)

The REST endpoints returned richer objects than the TS engine produces. This table documents what is dropped. The UI already handles all absent fields gracefully (§4.3).

### 4.1 `POST /api/trajectories/compare/stream` and `POST /api/trajectories/compare`

Each streamed or batched result has:

| REST field | Location | `TrajectoryResult` equivalent | Disposition in SPA-2 |
|---|---|---|---|
| `bullet` | top-level | `result.bullet` | Same object reference from catalog |
| `request` | top-level | `result.request` | Same object reference passed in |
| `points[].rangeMeters` | point | `TrajectoryPoint.rangeMeters` | Identical |
| `points[].dropCm` | point | `TrajectoryPoint.dropCm` | Identical |
| `points[].velocityMps` | point | `TrajectoryPoint.velocityMps` | Identical |
| `points[].energyJoules` | point | `TrajectoryPoint.energyJoules` | Identical |
| `points[].windDriftCm` | point | `TrajectoryPoint.windDriftCm` | Identical |
| `points[].timeOfFlightSec` | point | `TrajectoryPoint.timeOfFlightSec` | Identical |
| `points[].spinDriftCm` | point | — not in `TrajectoryPoint` | **Dropped.** Absent from engine output. UI checks `p.spinDriftCm > 0` (safe). |
| `points[].coriolisDeflectionCm` | point | — not in `TrajectoryPoint` | **Dropped.** Engine ignores `latitudeDeg`. UI checks `p.coriolisDeflectionCm != null` (safe). |
| `maxOrdinateCm` | top-level | `result.maxOrdinateCm` | Identical |
| `maxOrdinateRangeMeters` | top-level | `result.maxOrdinateRangeMeters` | Identical |
| `supersonicLimitMeters` | top-level | `result.supersonicLimitMeters` | Identical |
| `densityAltitudeMeters` | top-level | — not in `TrajectoryResult` | **Dropped.** UI checks `r.densityAltitudeMeters !== undefined` (safe). |

### 4.2 `POST /api/trajectories/custom`

Returns a single result object with the same shape as §4.1 plus the custom bullet fields in `result.bullet`. The mapping is identical.

### 4.3 UI field-absence audit

Confirm that every consumer of the dropped fields uses a guard that tolerates `undefined`:

| Consumer | Guard | Safe? |
|---|---|---|
| `updateReadout`: spin drift cell | `p.spinDriftCm > 0` | Yes — `undefined > 0` is false |
| `renderStatCards`: density altitude line | `r.densityAltitudeMeters !== undefined` | Yes |
| `renderTable`: Coriolis column | `p.coriolisDeflectionCm !== undefined && p.coriolisDeflectionCm !== 0` via `showCoriolis` | Yes |
| Spin drift dataset creation | `results.some(r => r.points.some(p => p.spinDriftCm))` | Yes — `undefined` is falsy |
| Coriolis dataset creation | `results.some(r => r.points.some(p => p.coriolisDeflectionCm))` | Yes — same |

No new `/* istanbul ignore */` guards are added.

---

## 5. Online/offline toggle — complete deletion list

### 5.1 Module state (delete)
| Symbol | Type | Reason |
|---|---|---|
| `offlineMode` | `let` variable | No server means no concept of offline |
| `retryTimer` | `let` variable | Same |

### 5.2 Functions (delete)
| Function | Lines (pre-SPA-1) | Reason |
|---|---|---|
| `setOfflineMode(isOffline)` | 696–718 | No server state to track |
| `probeServer()` | 721–739 | No server to probe |
| `streamCompare(req, onResult)` | 409–439 | Server-first SSE path removed |
| `_parseRejection(res)` | 444–451 | Only called from deleted `runSimulation` server branch |

### 5.3 DOM elements (delete from `index.html`)
| Element | Selector | Used by |
|---|---|---|
| Status pill | `#statusPill` | `setOfflineMode` only |
| Retry button | `#retryBtn` | `setOfflineMode` + `probeServer` only |

CSS rules for `.status-pill`, `.status-offline`, `.status-live` are co-located with these elements; delete them from `ballistics.css` (or whichever stylesheet contains them).

### 5.4 Event handlers (delete from `init()`)
| Handler | Signal |
|---|---|
| `window.addEventListener('offline', () => setOfflineMode(true), { signal })` | `signal` |
| `window.addEventListener('online', probeServer, { signal })` | `signal` |
| `document.getElementById('retryBtn')?.addEventListener('click', probeServer)` | none |
| `if (!navigator.onLine) setOfflineMode(true)` | — |

### 5.5 Retained: `showToast()`
`showToast` is kept — still used by preset save/load handlers. Only the "Reconnected to server" call site (inside `probeServer`) is deleted.

---

## 6. CSP cleanup — deferred to SPA-3

`SecurityHeadersFilter.java` currently sets:
```
connect-src 'self' /api/
```

After SPA-2, `ballistics.js` makes no `/api/` fetch calls, so `connect-src` could be tightened to `'self'` or omitted entirely. **This change is deferred to SPA-3**, which removes the whole Java layer. Changing the CSP while the Java server still exists provides no security benefit and risks breaking any in-flight feature work that still fetches from the API.

The devsecops reviewer should note this in SPA-2 review as PASS WITH NOTES rather than a BLOCK.

---

## 7. Service worker (`sw.js`)

**Decision: no changes in SPA-2. All SW cleanup deferred to SPA-3 or SPA-4.**

Rationale:

| Item | Current behaviour | Impact after SPA-2 | Action |
|---|---|---|---|
| `handleFetch` intercepts `POST /api/trajectories/compare` | Computes offline via `simulateBulletSW` | **Dead code** — `ballistics.js` never fetches this path after SPA-2 | Defer to SPA-3 |
| `handleFetch` intercepts `POST /api/trajectories/custom` | Computes offline via `simulateBulletSW` | **Dead code** — same reason | Defer to SPA-3 |
| `handleInstall` pre-caches `GET /api/bullets` | Fetches catalog from server | Pre-cache call fails silently (via `Promise.allSettled`) when served from `file://` or when server is absent; never read back after SPA-2 | Defer to SPA-3 |
| `simulateBulletSW` inline physics engine | Duplicates the TS engine | Harmless — only called by dead SW intercepts | Defer to SPA-3 |
| `.wasm` cache-first handler | Caches WASM assets | WASM assets no longer in bundle after SPA-1 | Deferred to SPA-3 (clean up with the whole SW) |
| `_wasmHash` / `extractWasmHash` | Cache versioning | Benign stale code | Defer to SPA-3 |

The SW cannot be registered from a `file://` URL context (requires HTTPS or localhost), so the acceptance criterion "loading from `file://` works end-to-end" (§11) is unaffected.

---

## 8. CSP and backend — not in SPA-2 scope

No changes to Java code in this PR. Specifically:
- `SecurityHeadersFilter.java` unchanged (§6).
- `pom.xml`, `Dockerfile`, `ci.yml` unchanged (SPA-3 scope).
- `cross-validate-runner.cjs` unchanged (Java `CrossValidationTest` subprocess).

---

## 9. Task split

| ID | Task | Acceptance |
|---|---|---|
| **SPA2-FE-1** | Delete the 5 fetch call sites and their surrounding try/catch/offline-fallback blocks, per §3.1–§3.5. | No `fetch(` call remains in `ballistics.js` (confirmed by `grep -n 'fetch(' src/main/resources/static/ballistics.js`). |
| **SPA2-FE-2** | Delete online/offline toggle: module vars, functions, DOM elements, CSS, event handlers, per §5. | No `offlineMode`, `retryTimer`, `setOfflineMode`, `probeServer`, `streamCompare`, `_parseRejection`, `#statusPill`, `#retryBtn`, or `.status-pill` references remain in the frontend source tree. |
| **SPA2-FE-3** | Update `ballistics.test.js` per §10. | Coverage is 100/100/100/100. No skipped or ignored lines added. |
| **SPA2-FE-4** | Docs and backlog: add SPA-2 to `BACKLOG.md` and mark it done in the same PR. | `BACKLOG.md` updated in the PR. |

---

## 10. Tests and coverage

The requirement is 100/100/100/100 (statements/branches/functions/lines) global in Jest.

### 10.1 Tests to delete
| Test / block | Reason |
|---|---|
| `streamCompare` unit tests (SSE chunking, heartbeats, error propagation) | Function deleted |
| `runSimulation` server path tests (stream success, compare fallback, 4xx problem+json, rate limit) | Server path deleted |
| `setOfflineMode` tests (pill text, retryBtn visibility, interval management) | Function deleted |
| `probeServer` tests (success reloads bullets, failure stays offline) | Function deleted |
| `_parseRejection` tests | Function deleted |
| `init()` bullets.list fetch mock and try/catch tests | Replaced by synchronous catalog load |
| `init()` online/offline listener setup tests | Listeners deleted |
| Any `buildDOM()` fixture that includes `#statusPill` or `#retryBtn` | Elements deleted |

### 10.2 Tests to update
| Test / block | Update |
|---|---|
| `runSimulation()` offline fallback | Becomes the only path. Remove all fetch mocks. Test that `computeClientSide` results render. |
| `runSimulation()` invalid input | Test that `TrajectoryInputError` from `simulate()` shows `#simulationError` with the engine message and renders nothing. |
| `computeClientSide()` | Synchronous (no `await`). Update all call sites from `await computeClientSide(req)` to `computeClientSide(req)`. |
| `runCustom()` | Remove fetch mock. Test that `simulate()` is called directly. Test that `TrajectoryInputError` shows `#customError`. |
| `init()` bullets load | No fetch mock needed. Assert `bullets` equals `getMockBullets()` after `init()`. Assert no `fetch` is called during `init()`. |
| `_getState()` | Assert returned object has no `offlineMode` or `retryTimer` keys. |
| `_resetState()` | Assert it no longer touches `offlineMode` or `retryTimer`. |
| `runSimulation` button progress text | Remove `⏳ N/M COMPUTED...` assertions; the button now stays in `loading` state until the synchronous call returns. |

### 10.3 New tests (minimum)
| Test | Assertion |
|---|---|
| `runSimulation` with bullet that throws `TrajectoryInputError` | `#simulationError` shows engine message; `renderResults` not called; button returns to `▶ COMPUTE TRAJECTORIES`. |
| `runCustom` with invalid weight (0) | Pre-validation catches before engine; `showCustomError` called; no `simulate()` call. |
| `runCustom` with valid custom fields but `maxRange` out of engine bounds | `TrajectoryInputError` caught; `showCustomError` called with engine message. |
| `init()` does not call `fetch` | Spy on `window.fetch`; call `init()` via `buildDOM()`; assert `fetch` never called. |
| No `window.offline` or `window.online` listener after `init()` | Assert `window.addEventListener` was not called with `'offline'` or `'online'`. |
| `runSimulation` with no selected bullets | `alert('Select at least one round.')` triggered; no engine call. |

---

## 11. Acceptance criteria

- [ ] `grep -rn 'fetch(' src/main/resources/static/ballistics.js` returns zero matches.
- [ ] `grep -rn 'API_BASE\|offlineMode\|retryTimer\|setOfflineMode\|probeServer\|streamCompare\|_parseRejection' src/main/resources/static/ballistics.js` returns zero matches.
- [ ] `grep -rn 'statusPill\|retryBtn\|status-pill\|status-offline\|status-live' src/main/` returns zero matches.
- [ ] Loading `index.html` via `file://` renders the bullet list (from `getMockBullets()`), allows bullet selection, and produces trajectories via `simulate()` without any network request.
- [ ] No `/api/` requests appear in the browser's Network tab under any user interaction (run, custom, sweep, DOPE card, BC solver, copy link, export).
- [ ] Compare tab (two bullets selected, Run) returns both results.
- [ ] Sweep mode runs all 5 variants locally.
- [ ] `npm test` passes. Jest is at 100/100/100/100. No new `istanbul ignore` comments.
- [ ] `npm run build` succeeds.
- [ ] `BACKLOG.md` updated in the PR.

---

## 12. Threat model delta (STRIDE-lite)

| # | STRIDE | Threat | Mitigation |
|---|---|---|---|
| T1 | Tampering | Server-side cross-validation is gone. The TS engine is the only compute path; a tampered JS bundle or malicious browser extension could override `simulate()` to return garbage trajectories. | **M-1** (from SPA-1): input validation before integration. **M-2** (from SPA-1): golden fixture locks numeric output in CI. No new mitigation; the threat existed in the offline path before. |
| T2 | DoS | No server-side rate limiting applies after SPA-2. Any script can call `simulate()` millions of times. | **M-1**: each call validates and returns quickly (< 50 ms for typical inputs). The main thread blocks, but the browser's hang-detection will kill a runaway tab. No new mitigation needed: the same risk existed in `runSweep`'s local path since SPA-1. |
| T3 | Info disclosure | The `/api/bullets` RPC call in `init()` sent the user's User-Agent, cookies, and origin headers to the server. After SPA-2, bullets are loaded from the bundle with no network call. | **Improvement**: no outbound request on page load. No mitigation needed. |
| T4 | Info disclosure | `retryTimer` polled the server every 60 s, leaking that the tab was still open. | **Improvement**: polling removed. |
| T5 | Availability | The online/offline probe hid errors behind silent retries. Validation errors from the engine are now surfaced directly to the user. | **M-3** (from SPA-1): messages are fixed templates without input interpolation, rendered via `textContent`. |
| T6 | Elevation of privilege | `connect-src` still allows `/api/` origins after SPA-2 (§6). An XSS in a future feature could exfiltrate to that origin. | Deferred. Noted for SPA-3 (§6). Devsecops: PASS WITH NOTES on SPA-2. |

**Retired attack surface**: the HTTP client path for trajectories and bullet loading. Payload flooding, server-side input validation bypass, and `Retry-After` header manipulation are no longer relevant.

**Retained surface**: the TS engine on the main thread; URL state; `localStorage`.

---

## 13. Open questions (need the user)

- **Q1:** `showToast("Reconnected to server")` is deleted with `probeServer`. Should the toast mechanism itself be kept for future use (preset save already uses it), or should the DOM element `#toast` also be deleted? This contract leaves `#toast` and `showToast()` in place.
- **Q2:** The `latitudeDeg`/`azimuthDeg` inputs remain in the sidebar. Should their UI labels include a "(no effect yet)" note? If so, that is a UI-only change and can land in SPA-2 as an optional SPA2-FE task.
- **Q3:** When does `sw.js` get deleted? SPA-3 removes the Java backend. SPA-4 (if any) might add a pure-static host. The SW cleanup should land in whichever story removes the last use of `BULLETS_API_URL`.
