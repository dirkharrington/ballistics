export { initEngine, computeTrajectory, WasmUnavailableError, BallisticsEngineError } from './loader.js';
export function createEngineWorker() {
  return new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module', name: 'ballistics-engine' });
}
