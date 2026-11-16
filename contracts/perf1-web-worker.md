# PERF-1: Move `simulate()` to a Web Worker

**Version:** 1.0.0  
**Status:** Contract written, builder pending  
**Date:** 2026-11-15  
**Author:** Architect session (eager-leakey-aa5a9b)

---

## 1  Purpose

`simulate()` in `app/physics/engine.ts` is synchronous and executes on the main thread. Worst-case input (10 bullets × ~2 000 steps, 1 m step) blocks input and frame rendering for a visible stutter. PERF-1 moves the physics call off the main thread via a **module Worker**.

---

## 2  Scope

| In scope | Out of scope |
|---|---|
| `app/physics/engine.worker.ts` (new) | `app/physics/engine.ts` (no changes) |
| `app/physics/engine-async.ts` (new) | `app/tools.js` logic (no changes) |
| `app/ballistics.js` call-site changes | PERF-2, PERF-3 |
| ADR 009 | CSS / HTML / `index.html` |

---

## 3  New module: `app/physics/engine.worker.ts`

### 3.1  Worker message protocol

The worker is a **module worker** (`{ type: 'module' }`).

#### Inbound (main → worker)

```ts
interface WorkerRequest {
  id: number;          // monotonically increasing integer, starts at 1
  bullet: Bullet;
  params: TrajectoryParams;
}
```

#### Outbound (worker → main) — success

```ts
interface WorkerSuccessResponse {
  id: number;
  result: TrajectoryResult;
}
```

#### Outbound (worker → main) — error

Sent only when `simulate()` throws `TrajectoryInputError`. All other errors are re-thrown (uncaught error propagates to `onerror`).

```ts
interface WorkerErrorResponse {
  id: number;
  error: {
    name: 'TrajectoryInputError';
    field: string;    // TrajectoryInputError.field
    message: string;  // TrajectoryInputError.message
  };
}
```

### 3.2  Worker implementation

```ts
import { simulate, TrajectoryInputError } from './engine.ts';

self.addEventListener('message', (evt: MessageEvent<WorkerRequest>) => {
  const { id, bullet, params } = evt.data;
  try {
    const result = simulate(bullet, params);
    self.postMessage({ id, result } satisfies WorkerSuccessResponse);
  } catch (err) {
    if (err instanceof TrajectoryInputError) {
      self.postMessage({
        id,
        error: { name: 'TrajectoryInputError', field: err.field, message: err.message },
      } satisfies WorkerErrorResponse);
    } else {
      throw err;
    }
  }
});
```

**Invariants:**
- The worker imports `simulate` from `./engine.ts` directly — no logic duplication.
- The worker never imports from `app/ballistics.js` or `app/tools.js`.
- No `eval`, `Function()`, or `importScripts()`.
- The worker origin is the same as the page origin (same-origin module worker loaded by Vite). No `crossOriginIsolated` requirement.

---

## 4  New wrapper: `app/physics/engine-async.ts`

### 4.1  API

```ts
export function simulateAsync(
  bullet: Bullet,
  params: TrajectoryParams,
): Promise<TrajectoryResult>;
```

### 4.2  Worker lifecycle

| Event | Action |
|---|---|
| First call to `simulateAsync()` | Create `new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })` |
| Subsequent calls | Reuse the same Worker instance |
| `pagehide` | `worker.terminate()`, set instance to `null` |
| `pageshow` (after BFC restore, `persisted === true`) | Lazily re-created on the next `simulateAsync()` call |

### 4.3  Pending-map dispatch

```ts
let _worker: Worker | null = null;
let _nextId = 1;
const _pending = new Map<number, { resolve: (r: TrajectoryResult) => void; reject: (e: unknown) => void }>();

function _getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    _worker.addEventListener('message', (evt: MessageEvent<WorkerSuccessResponse | WorkerErrorResponse>) => {
      const { id } = evt.data;
      const pending = _pending.get(id);
      if (!pending) return;
      _pending.delete(id);
      if ('error' in evt.data) {
        const e = new TrajectoryInputError(evt.data.error.field, '');
        // override message to match the original
        Object.defineProperty(e, 'message', { value: evt.data.error.message });
        pending.reject(e);
      } else {
        pending.resolve(evt.data.result);
      }
    });
  }
  return _worker;
}

export function simulateAsync(bullet: Bullet, params: TrajectoryParams): Promise<TrajectoryResult> {
  return new Promise((resolve, reject) => {
    const id = _nextId++;
    _pending.set(id, { resolve, reject });
    _getWorker().postMessage({ id, bullet, params } satisfies WorkerRequest);
  });
}
```

**Error reconstruction:** When the worker replies with `{ id, error }`, `engine-async.ts` constructs a `TrajectoryInputError` instance so callers can continue using `instanceof TrajectoryInputError` checks unchanged.  
Import `TrajectoryInputError` from `./engine.ts`.

**`pagehide` teardown** (registered once at module load):

```ts
window.addEventListener('pagehide', () => {
  _worker?.terminate();
  _worker = null;
  for (const { reject } of _pending.values())
    reject(new DOMException('Worker terminated on pagehide', 'AbortError'));
  _pending.clear();
});
```

### 4.4  Vite bundling

Vite treats `new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })` as a code-split entry point and emits a hashed worker chunk automatically. No `vite.config.js` change is needed.

---

## 5  Call-site changes in `app/ballistics.js`

Replace the import:

```js
// before
import { simulate, TrajectoryInputError } from './physics/engine.ts';

// after
import { TrajectoryInputError } from './physics/engine.ts';
import { simulateAsync } from './physics/engine-async.ts';
```

### 5.1  `computeClientSide(req)` → async

**Before (line ~106):**
```js
function computeClientSide(req) {
  return req.bulletIds.map(id => {
    const bullet = bullets.find(b => b.id === id);
    if (!bullet) return null;
    return simulate(bullet, req);
  }).filter(Boolean);
}
```

**After:**
```js
async function computeClientSide(req) {
  const promises = req.bulletIds.map(id => {
    const bullet = bullets.find(b => b.id === id);
    if (!bullet) return null;
    return simulateAsync(bullet, req);
  });
  const results = await Promise.all(promises.filter(Boolean));
  return results;
}
```

All bullets run in parallel via `Promise.all`. The worker serialises them internally (single worker, one message per bullet, all in-flight at once). The order of results matches the order of `bulletIds`.

### 5.2  `runSimulation()` → async

**Before (line ~167):**
```js
function runSimulation() {
  ...
  try {
    const results = computeClientSide(req);
    renderResults(results, req);
    ...
  } catch (err) { ... }
  finally {
    btn.classList.remove('loading');
    ...
  }
}
```

**After:**
```js
async function runSimulation() {
  ...
  try {
    const results = await computeClientSide(req);
    requestAnimationFrame(() => {
      renderResults(results, req);
      lastResults = results;
      updateSweepButtonVisibility();
      btn.classList.remove('loading');
      btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
    });
  } catch (err) {
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
    if (err instanceof TrajectoryInputError) {
      _setSimulationError(err.message);
    } else {
      console.error(err);
    }
  }
}
```

**Note:** The `finally` block is removed. `btn.classList.remove('loading')` now lives in both the `requestAnimationFrame` callback (success) and the `catch` block (error). This ensures the loading state is cleared only after the chart is painted (success) or after the error is known (failure).

### 5.3  `runCustom()` → update await

**Before (line ~330):**
```js
  try {
    result = simulate(bullet, req);
  } catch (err) { ... }
```

**After:**
```js
  try {
    result = await simulateAsync(bullet, req);
  } catch (err) { ... }
```

`runCustom()` is already `async`; no signature change needed.

### 5.4  `runSweep()` → async, `Promise.all`

**Before (line ~1009):**
```js
  try {
    results = requests.map(r => simulate(bullet, r));
  } catch (err) { ... }
```

**After:**
```js
  try {
    results = await Promise.all(requests.map(r => simulateAsync(bullet, r)));
  } catch (err) { ... }
```

`runSweep()` is already `async`; no signature change needed.

The chart render that follows (`renderSweepCharts(results, sweepParam)`) does not require `requestAnimationFrame` wrapping — sweep results are appended after `await`, which already yields to the browser.

### 5.5  `initDopeCard` and `initBcSolver` call sites (line ~1285)

```js
// before
initDopeCard(simulate);
initBcSolver(simulate);

// after
initDopeCard(simulateAsync);
initBcSolver(simulateAsync);
```

**Rationale:** `tools.js` already `await`s the callback (see `calcBC` at line 247: `const result = await simulateBulletFn(bullet, req)`), so the DOPE card and BC solver accept either a sync or async function. Passing `simulateAsync` requires no changes to `tools.js`. The `initDopeCard` path stores the callback in `_simulateBulletFn`; callers within `tools.js` that call `_simulateBulletFn(...)` must also `await` the result. Because `calcBC` already does this, no logic change to `tools.js` is required.

---

## 6  Exports

The existing `export { ... }` block in `ballistics.js` exports `computeClientSide`. Its type changes from `(req) => TrajectoryResult[]` to `(req) => Promise<TrajectoryResult[]>`. Tests that call it must `await` the result.

---

## 7  Threat model delta

| Concern | Assessment |
|---|---|
| **Worker origin** | Same-origin module worker loaded by Vite hashed URL. No cross-origin messaging. CSP `worker-src 'self'` is already implied by default-src or script-src; no CSP change required. |
| **`postMessage` input validation** | The worker receives `{ id, bullet, params }` from the main thread only. The worker does not expose a `MessagePort` to any third party. `bullet` and `params` are plain objects whose fields are validated by `simulate()` → `validate()` before any computation. No additional sanitisation required at the message boundary. |
| **No `eval` or dynamic code** | The worker imports `simulate` as a static module. No `importScripts`, `eval`, or `Function()` constructor. Vite tree-shakes the bundle at build time. |
| **Structured-clone limit** | Objects posted to/from the worker are cloned via the structured-clone algorithm. `Bullet` and `TrajectoryParams` contain only plain primitives and arrays — no DOM nodes, no `ArrayBuffer` transfer. `TrajectoryResult` is similarly plain. No transfer list needed. |
| **Termination on `pagehide`** | Prevents the worker from holding a thread open after the page enters the BFC or is unloaded. Pending promises are rejected with `DOMException('AbortError')` to avoid memory leaks. |
| **Worker re-creation after BFC** | `pageshow` with `persisted === true` does not create a worker preemptively; the worker is created lazily. This prevents spurious worker creation on pages that do not call `simulateAsync`. |

NIST SSDF SP 800-218 mapping:
- **PW.5** (Use vetted mechanisms): synchronous `simulate()` from the vetted TS engine is re-used unchanged inside the worker; no new physics logic.
- **PO.3.2** (Verify third-party components): no new npm dependencies.
- **PS.1** (Design software to meet security requirements): same-origin worker, no eval, structured-clone only.

---

## 8  Test strategy

### 8.1  Boundary: physics tests vs. worker tests

| Layer | What to test | How |
|---|---|---|
| `tests/physics/engine.test.ts` | `simulate()` directly | No change — imports `simulate` from `app/physics/engine.ts` |
| `tests/physics/engine-async.test.ts` | `simulateAsync()` pending-map, error reconstruction, `pagehide` teardown | Mock `Worker` class in jsdom (see §8.2) |
| `tests/ballistics.test.js` | `computeClientSide`, `runSimulation`, `runCustom`, `runSweep` | Mock `simulateAsync` from `./physics/engine-async.ts` (see §8.3) |
| `tests/tools.test.js` | `calcBC`, `initDopeCard`, `initBcSolver` | Mock `simulateAsync` passed as callback |

### 8.2  Worker mock in jsdom (`engine-async.test.ts`)

jsdom does not implement `Worker`. Add a jest manual mock at `tests/__mocks__/worker.ts` (or use `jest.fn()` inline):

```ts
// In the test file or a jest setup file:
class MockWorker extends EventTarget {
  postMessage = jest.fn();
  terminate = jest.fn();
}
global.Worker = MockWorker as unknown as typeof Worker;
```

The test drives the mock worker's `onmessage` handler directly to simulate success and error responses.

**Do NOT add a jest auto-mock or `__mocks__/engine.worker.ts`** — the worker source is a separate Vite entry; it is never imported by the test runner.

### 8.3  `simulateAsync` mock in `ballistics.test.js`

```js
jest.mock('./physics/engine-async.ts', () => ({
  simulateAsync: jest.fn(),
}));
```

Existing tests that call `computeClientSide` or `runSimulation` must `await` the result and configure `simulateAsync` to resolve with a fixture.

### 8.4  Coverage expectations

- `app/physics/engine.worker.ts` — 100 % line/branch/statement/function. Covered by `engine-async.test.ts` via the pending-map integration path.
- `app/physics/engine-async.ts` — 100 % line/branch/statement/function.
- `app/ballistics.js` — remains 100 %; async branches (rejection path, `requestAnimationFrame` callback) must be exercised in tests.
- `app/tools.js` — no coverage change required.

---

## 9  ADR 009 — Web Worker for physics simulation

**Status:** Accepted (pending implementation)

**Context:** `simulate()` blocks the main thread for up to ~40 ms on 10 bullets at 1 m step and 2 000 m range. The browser skips frames during this window, violating the 16 ms frame budget.

**Decision:** Move `simulate()` calls off the main thread via a module Worker. The worker re-uses the existing `simulate` import from `engine.ts`; no logic is duplicated. The main thread communicates via a pending-map keyed by an integer correlation id.

**Consequences:**
- `runSimulation`, `computeClientSide`, and `runCustom` become `async`. Callers that test them must `await` and mock `simulateAsync`.
- Worker dispatch logic is not testable in jsdom; it is covered by a `MockWorker` class in unit tests.
- PERF-3 (lazy Chart.js) may land in any order relative to PERF-1; the two changes touch `ballistics.js` in different locations. The contract for PERF-3 must resolve the merge order.

**Alternatives considered:**
- **SharedArrayBuffer + Atomics** — requires `crossOriginIsolated` (COOP/COEP headers), which the current static hosting does not provide. Rejected.
- **Worker pool (N > 1)** — adds complexity without measurable benefit for ≤ 10 bullets. Single worker, all bullets in-flight concurrently via pending-map. Revisit if bullet catalog grows beyond 20.
- **Inline physics in SW** — service worker has a different lifecycle and is not appropriate for user-initiated computation.

---

## 10  File checklist

| File | Action |
|---|---|
| `app/physics/engine.worker.ts` | **Create** |
| `app/physics/engine-async.ts` | **Create** |
| `app/ballistics.js` | **Modify** (5 locations) |
| `tests/physics/engine-async.test.ts` | **Create** |
| `tests/__mocks__/worker.ts` | **Create** (or inline mock) |
| `tests/ballistics.test.js` | **Modify** (mock, await) |
| `app/physics/engine.ts` | **No change** |
| `app/tools.js` | **No change** |
| `vite.config.js` | **No change** |
| `contracts/CHANGELOG.md` | **Modify** |
| `BACKLOG.md` | **Modify** |
