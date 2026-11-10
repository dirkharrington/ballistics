export { WasmUnavailableError, BallisticsEngineError } from 'virtual:wasm-engine';
import { WasmUnavailableError, BallisticsEngineError, initEngine, computeTrajectory, createEngineWorker } from 'virtual:wasm-engine';

export const EngineTier = Object.freeze({ PENDING: 'pending', WORKER: 'worker', INLINE: 'inline', JS: 'js' });
export const STARTUP_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 15_000;

let tier = EngineTier.PENDING;
let startupPromise = null;
let worker = null;
let counter = 0;
const pending = new Map();
const busyListeners = new Set();
let inFlight = 0;
let startupTimer = null;
let startupResolver = null;

function notifyBusy(val) {
  busyListeners.forEach(fn => fn(val));
}

function incrementInFlight() {
  inFlight++;
  if (inFlight === 1) notifyBusy(true);
}

function decrementInFlight() {
  inFlight--;
  if (inFlight === 0) notifyBusy(false);
}

function degradeToJS(rejectMessage) {
  const prevWorker = worker;
  worker = null;
  tier = EngineTier.JS;
  pending.forEach(({ reject, timer }) => {
    clearTimeout(timer);
    reject(new WasmUnavailableError(rejectMessage ?? /* istanbul ignore next */ 'engine fault'));
  });
  pending.clear();
  /* istanbul ignore else */
  if (prevWorker) {
    try { prevWorker.postMessage({ type: 'terminate' }); } catch (_) {}
  }
}

function bindWorker(w, resolveStartup) {
  w.addEventListener('message', ({ data }) => {
    if (w !== worker) return;
    if (data === null || typeof data !== 'object') return;

    if (data.type === 'ready') {
      /* istanbul ignore else */
      if (startupTimer !== null) { clearTimeout(startupTimer); startupTimer = null; }
      tier = EngineTier.WORKER;
      resolveStartup(EngineTier.WORKER);
      return;
    }

    if (data.type === 'init_error') {
      /* istanbul ignore else */
      if (startupTimer !== null) { clearTimeout(startupTimer); startupTimer = null; }
      try { w.postMessage({ type: 'terminate' }); } catch (_) {}
      worker = null;
      tryInline(resolveStartup);
      return;
    }

    if (data.type === 'result') {
      const entry = pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(data.id);
      entry.resolve(data.result);
      return;
    }

    if (data.type === 'error') {
      const entry = pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(data.id);
      if (data.name === 'BallisticsEngineError') {
        entry.reject(new BallisticsEngineError(data.message));
      } else {
        entry.reject(new BallisticsEngineError(data.message));
        degradeToJS('engine fault');
      }
      return;
    }
  });

  w.addEventListener('error', () => {
    if (w !== worker) return;
    if (startupTimer !== null) { clearTimeout(startupTimer); startupTimer = null; }
    if (tier === EngineTier.PENDING) {
      try { w.postMessage({ type: 'terminate' }); } catch (_) {}
      worker = null;
      tryInline(resolveStartup);
    } else {
      degradeToJS('worker error');
    }
  });

  w.addEventListener('messageerror', () => {
    if (w !== worker) return;
    degradeToJS('worker messageerror');
  });
}

function tryInline(resolveStartup) {
  let result;
  try {
    result = initEngine();
  } catch (_) {
    tier = EngineTier.JS;
    resolveStartup(EngineTier.JS);
    return;
  }
  Promise.resolve(result).then(
    () => { tier = EngineTier.INLINE; resolveStartup(EngineTier.INLINE); },
    () => { tier = EngineTier.JS; resolveStartup(EngineTier.JS); }
  );
}

export function startEngine() {
  if (startupPromise !== null) return startupPromise;

  startupPromise = new Promise((resolve) => {
    startupResolver = resolve;
    let w;
    try { w = createEngineWorker(); } catch (_) { w = null; }

    if (w === null) {
      tryInline(resolve);
      return;
    }

    worker = w;
    bindWorker(w, resolve);

    startupTimer = setTimeout(() => {
      startupTimer = null;
      /* istanbul ignore next */
      if (tier !== EngineTier.PENDING) return;
      try { w.postMessage({ type: 'terminate' }); } catch (_) {}
      worker = null;
      tryInline(resolve);
    }, STARTUP_TIMEOUT_MS);
  });

  return startupPromise;
}

export function getEngineTier() {
  return tier;
}

export async function computeWithEngine(params, bullet) {
  incrementInFlight();
  try {
    if (tier === EngineTier.PENDING) await startEngine();

    if (tier === EngineTier.WORKER) {
      return await new Promise((resolve, reject) => {
        const id = ++counter;
        const timer = setTimeout(() => {
          pending.delete(id);
          worker.terminate();
          degradeToJS('request timeout');
          reject(new WasmUnavailableError('request timeout'));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ type: 'compute', id, params, bullet });
      });
    }

    if (tier === EngineTier.INLINE) {
      try {
        return computeTrajectory(params, bullet);
      } catch (e) {
        if (!(e instanceof BallisticsEngineError)) {
          tier = EngineTier.JS;
          throw new BallisticsEngineError('inline wasm fault: ' + e.message, { cause: e });
        }
        throw e;
      }
    }

    throw new WasmUnavailableError('no WASM tier available');
  } finally {
    decrementInFlight();
  }
}

export function onBusyChange(listener) {
  busyListeners.add(listener);
  return () => { busyListeners.delete(listener); };
}

export function shutdownEngine() {
  if (startupTimer !== null) { clearTimeout(startupTimer); startupTimer = null; }
  if (startupResolver !== null) { startupResolver(EngineTier.PENDING); startupResolver = null; }
  const prevWorker = worker;
  worker = null;
  tier = EngineTier.PENDING;
  startupPromise = null;
  pending.forEach(({ reject, timer }) => {
    clearTimeout(timer);
    reject(new WasmUnavailableError('engine shutdown'));
  });
  pending.clear();
  if (prevWorker) {
    try { prevWorker.postMessage({ type: 'terminate' }); } catch (_) {}
  }
}

export function toEngineParams(bullet, req) {
  const result = { bulletId: String(bullet.id) };
  const keys = ['zeroRangeMeters', 'maxRangeMeters', 'stepMeters', 'windSpeedKph',
                 'altitudeMeters', 'temperatureC', 'sightHeightMm', 'shootingAngleDegrees',
                 'windDirectionDeg', 'dragModel', 'twistRateInchesPerTurn'];
  for (const k of keys) {
    if (req[k] !== null && req[k] !== undefined) result[k] = req[k];
  }
  return result;
}

export function toEngineBullet(bullet) {
  return {
    id:                    String(bullet.id ?? ''),
    name:                  String(bullet.name ?? ''),
    caliber:               String(bullet.caliber ?? ''),
    description:           String(bullet.description ?? ''),
    hexColor:              String(bullet.hexColor ?? ''),
    bulletWeightGrams:     bullet.bulletWeightGrams,
    muzzleVelocityMps:     bullet.muzzleVelocityMps,
    ballisticCoefficient:  bullet.ballisticCoefficient,
    bulletDiameterMm:      bullet.bulletDiameterMm,
    muzzleEnergyJoules:    bullet.muzzleEnergyJoules ?? 0,
  };
}

export function _resetEngineClient() {
  if (startupTimer !== null) { clearTimeout(startupTimer); startupTimer = null; }
  startupResolver = null;
  const prevWorker = worker;
  worker = null;
  tier = EngineTier.PENDING;
  startupPromise = null;
  counter = 0;
  pending.clear();
  busyListeners.clear();
  inFlight = 0;
  if (prevWorker) {
    try { prevWorker.postMessage({ type: 'terminate' }); } catch (_) {}
  }
}
