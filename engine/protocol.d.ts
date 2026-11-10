import type { TrajectoryParams, Bullet, TrajectoryResult } from './loader';

// main → worker
export type ComputeRequest   = { type: 'compute'; id: number; params: TrajectoryParams; bullet: Bullet };
export type TerminateRequest = { type: 'terminate' };
export type ToWorker = ComputeRequest | TerminateRequest;

// worker → main
export type ReadyMessage     = { type: 'ready' };
export type InitErrorMessage = { type: 'init_error'; message: string };
export type ResultMessage    = { type: 'result'; id: number; result: TrajectoryResult };
export type ErrorMessage     = { type: 'error'; id: number; name: 'BallisticsEngineError' | 'EngineFault'; message: string };
export type FromWorker = ReadyMessage | InitErrorMessage | ResultMessage | ErrorMessage;
