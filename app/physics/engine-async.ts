import { createPhysicsWorker } from './create-physics-worker.ts';
import { TrajectoryInputError } from './errors.ts';
import type { Bullet, TrajectoryParams, TrajectoryResult, SolveBCParams } from './types.ts';

interface WorkerRequest {
  id: number;
  bullet: Bullet;
  params: TrajectoryParams;
}

interface WorkerSolveBCRequest {
  type: 'solveBC';
  id: number;
  bcParams: SolveBCParams;
}

interface WorkerSuccessResponse {
  id: number;
  result: TrajectoryResult;
}

interface WorkerSolveBCResponse {
  id: number;
  bc: number | null;
}

interface WorkerErrorResponse {
  id: number;
  error: {
    name: 'TrajectoryInputError';
    field: string;
    message: string;
  };
}

type WorkerResponse = WorkerSuccessResponse | WorkerSolveBCResponse | WorkerErrorResponse;

let _worker: Worker | null = null;
let _nextId = 1;
const _pending = new Map<number, { resolve: (r: any) => void; reject: (e: unknown) => void }>();

function _getWorker(): Worker {
  if (!_worker) {
    _worker = createPhysicsWorker();
    _worker.addEventListener('message', (evt: MessageEvent<WorkerResponse>) => {
      const { id } = evt.data;
      const pending = _pending.get(id);
      if (!pending) return;
      _pending.delete(id);
      if ('error' in evt.data) {
        const e = new TrajectoryInputError(evt.data.error.field, '');
        Object.defineProperty(e, 'message', { value: evt.data.error.message });
        pending.reject(e);
      } else if ('bc' in evt.data) {
        pending.resolve(evt.data.bc);
      } else {
        pending.resolve(evt.data.result);
      }
    });
  }
  return _worker;
}

export function _resetForTest(): void {
  _worker?.terminate();
  _worker = null;
  _nextId = 1;
  _pending.clear();
}

export function simulateAsync(bullet: Bullet, params: TrajectoryParams): Promise<TrajectoryResult> {
  return new Promise((resolve, reject) => {
    const id = _nextId++;
    _pending.set(id, { resolve, reject });
    _getWorker().postMessage({ id, bullet, params } satisfies WorkerRequest);
  });
}

/**
 * Run the G1 BC back-calculator inside the physics worker in a single round-trip (PERF-17).
 */
export function solveBCAsync(bcParams: SolveBCParams): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const id = _nextId++;
    _pending.set(id, { resolve, reject });
    _getWorker().postMessage({ type: 'solveBC', id, bcParams } satisfies WorkerSolveBCRequest);
  });
}

/**
 * Pre-warm the physics worker so the first user-triggered compute avoids
 * worker startup + script-parse latency. Call this once after the page is
 * interactive. Uses requestIdleCallback (with a 2 s timeout) so it never
 * blocks the main thread; falls back to setTimeout on browsers that lack
 * requestIdleCallback. Safe to call multiple times — no-op if the worker
 * is already running.
 */
export function prewarmPhysicsWorker(): void {
  const warm = () => { _getWorker(); };
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(warm, { timeout: 2000 });
  } else {
    setTimeout(warm, 2000);
  }
}

window.addEventListener('pagehide', () => {
  _worker?.terminate();
  _worker = null;
  for (const { reject } of _pending.values())
    reject(new DOMException('Worker terminated on pagehide', 'AbortError'));
  _pending.clear();
});
