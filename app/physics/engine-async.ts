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

export interface SimulateAsyncOptions {
  readonly signal?: AbortSignal;
}

interface WorkerSlot {
  readonly worker: Worker;
  busy: boolean;
}

interface QueuedTask {
  readonly id: number;
  readonly payload: WorkerRequest | WorkerSolveBCRequest;
  readonly resolve: (value: any) => void;
  readonly reject: (err: unknown) => void;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
}

const MAX_POOL_CAP = 4;

let _pool: WorkerSlot[] = [];
let _queue: QueuedTask[] = [];
let _nextId = 1;
const _pending = new Map<number, QueuedTask>();

export function _getMaxPoolSize(): number {
  const hc = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(hc, MAX_POOL_CAP));
}

function _cleanupAbort(task: QueuedTask): void {
  if (task.signal && task.onAbort) {
    task.signal.removeEventListener('abort', task.onAbort);
    task.onAbort = undefined;
  }
}

function _spawnWorker(): WorkerSlot {
  const worker = createPhysicsWorker();
  const slot: WorkerSlot = { worker, busy: false };
  worker.addEventListener('message', (evt: MessageEvent<WorkerResponse>) => {
    const { id } = evt.data;
    const task = _pending.get(id);
    slot.busy = false;
    if (task) {
      _pending.delete(id);
      _cleanupAbort(task);
      if ('error' in evt.data) {
        const e = new TrajectoryInputError(evt.data.error.field, '');
        Object.defineProperty(e, 'message', { value: evt.data.error.message });
        task.reject(e);
      } else if ('bc' in evt.data) {
        task.resolve(evt.data.bc);
      } else {
        task.resolve(evt.data.result);
      }
    }
    _drainQueue();
  });
  _pool.push(slot);
  return slot;
}

function _acquireSlot(): WorkerSlot | null {
  for (const slot of _pool) {
    if (!slot.busy) return slot;
  }
  if (_pool.length < _getMaxPoolSize()) {
    return _spawnWorker();
  }
  return null;
}

function _drainQueue(): void {
  while (_queue.length > 0) {
    const slot = _acquireSlot();
    if (!slot) break;
    const task = _queue.shift()!;
    slot.busy = true;
    _pending.set(task.id, task);
    slot.worker.postMessage(task.payload);
  }
}

function _enqueue<T>(
  buildPayload: (id: number) => WorkerRequest | WorkerSolveBCRequest,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Simulation aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const id = _nextId++;
    const task: QueuedTask = {
      id,
      payload: buildPayload(id),
      resolve,
      reject,
      signal,
    };
    if (signal) {
      task.onAbort = () => {
        const qIdx = _queue.indexOf(task);
        if (qIdx !== -1) {
          _queue.splice(qIdx, 1);
        } else {
          _pending.delete(id);
        }
        _cleanupAbort(task);
        reject(new DOMException('Simulation aborted', 'AbortError'));
      };
      signal.addEventListener('abort', task.onAbort, { once: true });
    }
    _queue.push(task);
    _drainQueue();
  });
}

export function _resetForTest(): void {
  for (const slot of _pool) slot.worker.terminate();
  for (const task of _queue) _cleanupAbort(task);
  for (const task of _pending.values()) _cleanupAbort(task);
  _pool = [];
  _queue = [];
  _pending.clear();
  _nextId = 1;
}

export function simulateAsync(
  bullet: Bullet,
  params: TrajectoryParams,
  options?: SimulateAsyncOptions,
): Promise<TrajectoryResult> {
  return _enqueue<TrajectoryResult>(id => ({ id, bullet, params }), options?.signal);
}

/**
 * Run the G1 BC back-calculator inside the physics worker in a single round-trip (PERF-17).
 */
export function solveBCAsync(
  bcParams: SolveBCParams,
  options?: SimulateAsyncOptions,
): Promise<number | null> {
  return _enqueue<number | null>(id => ({ type: 'solveBC', id, bcParams }), options?.signal);
}

/**
 * Pre-warm a single physics worker so the first user-triggered compute avoids
 * worker startup + script-parse latency. Additional pool workers are spawned
 * lazily only when concurrent jobs exceed idle workers (PERF-18).
 */
export function prewarmPhysicsWorker(): void {
  const warm = () => {
    if (_pool.length === 0) _spawnWorker();
  };
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(warm, { timeout: 2000 });
  } else {
    setTimeout(warm, 2000);
  }
}

window.addEventListener('pagehide', () => {
  for (const slot of _pool) slot.worker.terminate();
  _pool = [];
  const abortErr = new DOMException('Worker terminated on pagehide', 'AbortError');
  const waiting = [..._queue, ..._pending.values()];
  _queue = [];
  _pending.clear();
  for (const task of waiting) {
    _cleanupAbort(task);
    task.reject(abortErr);
  }
});
