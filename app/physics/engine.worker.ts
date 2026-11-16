/// <reference no-default-lib="true" />
/// <reference lib="webworker" />
import { simulate, TrajectoryInputError } from './engine.ts';
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

self.addEventListener('message', (evt: MessageEvent<WorkerRequest>) => {
  if (typeof evt.data?.id !== 'number') return;
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
