import { createPhysicsWorker } from './create-physics-worker.ts';
import { TrajectoryInputError } from './engine.ts';
import type { Bullet, TrajectoryParams, TrajectoryResult } from './types.ts';

interface WorkerRequest {
  id: number;
  bullet: Bullet;
  params: TrajectoryParams;
}

interface WorkerSuccessResponse {
  id: number;
  result: TrajectoryResult;
}

interface WorkerErrorResponse {
  id: number;
  error: {
    name: 'TrajectoryInputError';
    field: string;
    message: string;
  };
}

let _worker: Worker | null = null;
let _nextId = 1;
const _pending = new Map<number, { resolve: (r: TrajectoryResult) => void; reject: (e: unknown) => void }>();

function _getWorker(): Worker {
  if (!_worker) {
    _worker = createPhysicsWorker();
    _worker.addEventListener('message', (evt: MessageEvent<WorkerSuccessResponse | WorkerErrorResponse>) => {
      const { id } = evt.data;
      const pending = _pending.get(id);
      if (!pending) return;
      _pending.delete(id);
      if ('error' in evt.data) {
        const e = new TrajectoryInputError(evt.data.error.field, '');
        Object.defineProperty(e, 'message', { value: evt.data.error.message });
        pending.reject(e);
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

window.addEventListener('pagehide', () => {
  _worker?.terminate();
  _worker = null;
  for (const { reject } of _pending.values())
    reject(new DOMException('Worker terminated on pagehide', 'AbortError'));
  _pending.clear();
});
