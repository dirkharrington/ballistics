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
  _initPromise = init().catch(e => {
    _initPromise = null;
    throw new WasmUnavailableError(e.message);
  });
  return _initPromise;
}

export function computeTrajectory(params, bullet) {
  const raw = compute_trajectory(JSON.stringify(params), JSON.stringify(bullet));
  let result;
  try {
    result = JSON.parse(raw);
  } catch (e) {
    throw new BallisticsEngineError('malformed engine response: ' + e.message);
  }
  if (result.error !== undefined) {
    throw new BallisticsEngineError(result.error);
  }
  return result;
}
