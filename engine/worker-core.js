import { initEngine, computeTrajectory, BallisticsEngineError } from './loader.js';

export function bootstrap(scope) {
  scope.addEventListener('message', onMessage);

  let initResult;
  try {
    initResult = Promise.resolve(initEngine());
  } catch (err) {
    initResult = Promise.reject(err);
  }

  const ready = initResult.then(
    () => { scope.postMessage({ type: 'ready' }); },
    (err) => {
      const message = String(err?.message ?? err).slice(0, 500);
      scope.postMessage({ type: 'init_error', message });
      scope.close();
      return Promise.reject(err);
    }
  );
  ready.catch(() => {});

  function onMessage({ data }) {
    if (data === null || typeof data !== 'object') return;

    if (data.type === 'terminate') {
      scope.close();
      return;
    }

    if (data.type === 'compute') {
      const { id, params, bullet } = data;
      if (!Number.isSafeInteger(id) || id < 1) return;

      if (params === null || typeof params !== 'object' || Array.isArray(params) ||
          bullet === null || typeof bullet !== 'object' || Array.isArray(bullet)) {
        scope.postMessage({ type: 'error', id, name: 'BallisticsEngineError', message: 'invalid compute message' });
        return;
      }

      ready.then(() => {
        try {
          const result = computeTrajectory(params, bullet);
          scope.postMessage({ type: 'result', id, result });
        } catch (err) {
          if (err instanceof BallisticsEngineError) {
            const message = String(err?.message ?? err).slice(0, 500);
            scope.postMessage({ type: 'error', id, name: 'BallisticsEngineError', message });
          } else {
            const message = String(err?.message ?? err).slice(0, 500);
            scope.postMessage({ type: 'error', id, name: 'EngineFault', message });
            scope.close();
          }
        }
      }).catch(() => {});
    }
  }
}
