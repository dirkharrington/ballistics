/// <reference no-default-lib="true" />
/// <reference lib="webworker" />
import { simulate, solveBC, TrajectoryInputError } from './engine.ts';
import { packPoints } from './packed-points.ts';
import type { Bullet, EffectiveDragModel, TrajectoryParams, SolveBCParams } from './types.ts';

interface SimulateRequest {
  type?: 'simulate';
  id: number;
  bullet: Bullet;
  params: TrajectoryParams;
}

interface SolveBCRequest {
  type: 'solveBC';
  id: number;
  bcParams: SolveBCParams;
}

type WorkerRequest = SimulateRequest | SolveBCRequest;

interface WorkerSuccessResponse {
  id: number;
  maxOrdinateCm: number;
  maxOrdinateRangeMeters: number;
  supersonicLimitMeters: number;
  densityAltitudeMeters: number;
  dragModel: EffectiveDragModel;
  pointsBuffer: Float64Array;
  hasCoriolis: boolean;
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

self.addEventListener('message', (evt: MessageEvent<WorkerRequest>) => {
  // Module workers receive messages only from their owning page; origin is '' for Worker.postMessage()
  if (evt.origin !== '') return;
  if (typeof evt.data?.id !== 'number') return;
  if (evt.data.type === 'solveBC') {
    const { id, bcParams } = evt.data;
    const bc = solveBC(bcParams);
    self.postMessage({ id, bc } satisfies WorkerSolveBCResponse);
    return;
  }
  const { id, bullet, params } = evt.data;
  try {
    const result = simulate(bullet, params);
    const { buffer, hasCoriolis } = packPoints(result.points);
    const response: WorkerSuccessResponse = {
      id,
      maxOrdinateCm: result.maxOrdinateCm,
      maxOrdinateRangeMeters: result.maxOrdinateRangeMeters,
      supersonicLimitMeters: result.supersonicLimitMeters,
      densityAltitudeMeters: result.densityAltitudeMeters,
      dragModel: result.dragModel,
      pointsBuffer: buffer,
      hasCoriolis,
    };
    self.postMessage(response, [buffer.buffer]);
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
