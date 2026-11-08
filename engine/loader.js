import init, { compute_trajectory } from './ballistics_engine.js';

export class WasmUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WasmUnavailableError';
  }
}

export class BallisticsEngineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BallisticsEngineError';
  }
}

let _initPromise = null;

export function initEngine() {
  if (typeof WebAssembly === 'undefined') {
    throw new WasmUnavailableError('WebAssembly is not available in this runtime');
  }
  if (_initPromise !== null) {
    return _initPromise;
  }
  _initPromise = init();
  return _initPromise;
}

export function computeTrajectory(params, bullet) {
  const result = JSON.parse(
    compute_trajectory(JSON.stringify(params), JSON.stringify(bullet))
  );
  if (result.error !== undefined) {
    throw new BallisticsEngineError(result.error);
  }
  return result;
}
