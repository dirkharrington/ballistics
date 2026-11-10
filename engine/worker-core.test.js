'use strict';

jest.mock('./loader.js', () => ({
  initEngine: jest.fn(),
  computeTrajectory: jest.fn(),
  WasmUnavailableError: class WasmUnavailableError extends Error {
    constructor(m) { super(m); this.name = 'WasmUnavailableError'; }
  },
  BallisticsEngineError: class BallisticsEngineError extends Error {
    constructor(m) { super(m); this.name = 'BallisticsEngineError'; }
  },
}));

const loader = require('./loader.js');
const { bootstrap } = require('./worker-core.js');

function makeScope() {
  const handlers = {};
  return {
    postMessage: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn((type, handler) => {
      handlers[type] = handler;
    }),
    _dispatch(type, data) {
      if (handlers[type]) handlers[type]({ data });
    },
    _handlers: handlers,
  };
}

function makeCompute(id = 1, params = { foo: 1 }, bullet = { bar: 2 }) {
  return { type: 'compute', id, params, bullet };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('worker-core bootstrap', () => {
  test('init resolves → posts ready', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'ready' });
    expect(scope.close).not.toHaveBeenCalled();
  });

  test('init throws synchronously → init_error + close', async () => {
    loader.initEngine.mockImplementation(() => { throw new Error('sync fail'); });
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'init_error', message: 'sync fail' });
    expect(scope.close).toHaveBeenCalled();
  });

  test('init rejects → init_error + close', async () => {
    loader.initEngine.mockRejectedValue(new Error('async fail'));
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'init_error', message: 'async fail' });
    expect(scope.close).toHaveBeenCalled();
  });

  test('terminate → close', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    const scope = makeScope();
    bootstrap(scope);
    scope._dispatch('message', { type: 'terminate' });
    expect(scope.close).toHaveBeenCalled();
  });

  test('compute success → result with same id', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    loader.computeTrajectory.mockReturnValue({ points: [] });
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope._dispatch('message', makeCompute(7));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const calls = scope.postMessage.mock.calls;
    const result = calls.find(c => c[0].type === 'result');
    expect(result).toBeTruthy();
    expect(result[0].id).toBe(7);
    expect(result[0].result).toEqual({ points: [] });
  });

  test('compute → BallisticsEngineError → error with name BallisticsEngineError', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    loader.computeTrajectory.mockImplementation(() => {
      throw new loader.BallisticsEngineError('bad input');
    });
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope._dispatch('message', makeCompute(3));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const calls = scope.postMessage.mock.calls;
    const err = calls.find(c => c[0].type === 'error');
    expect(err).toBeTruthy();
    expect(err[0].id).toBe(3);
    expect(err[0].name).toBe('BallisticsEngineError');
    expect(scope.close).not.toHaveBeenCalled();
  });

  test('compute → generic Error → EngineFault + close', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    loader.computeTrajectory.mockImplementation(() => { throw new Error('trap'); });
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope._dispatch('message', makeCompute(5));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const calls = scope.postMessage.mock.calls;
    const err = calls.find(c => c[0].type === 'error');
    expect(err).toBeTruthy();
    expect(err[0].name).toBe('EngineFault');
    expect(scope.close).toHaveBeenCalled();
  });

  test('compute posted before init resolves → answered after ready', async () => {
    let resolveInit;
    loader.initEngine.mockReturnValue(new Promise(r => { resolveInit = r; }));
    loader.computeTrajectory.mockReturnValue({ points: [1] });
    const scope = makeScope();
    bootstrap(scope);
    scope._dispatch('message', makeCompute(2));
    await Promise.resolve();
    // init not done yet, no result yet
    expect(scope.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'result' }));
    resolveInit();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const calls = scope.postMessage.mock.calls;
    const result = calls.find(c => c[0].type === 'result');
    expect(result).toBeTruthy();
    expect(result[0].id).toBe(2);
  });

  test('compute after init failure → nothing posted, no unhandled rejection', async () => {
    loader.initEngine.mockRejectedValue(new Error('fail'));
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    scope.postMessage.mockClear();
    scope._dispatch('message', makeCompute(99));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Should not have posted result or error (init_error was already sent)
    expect(scope.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'result' }));
    expect(scope.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test.each([
    [{ type: 'compute', id: 0, params: {}, bullet: {} }],
    [{ type: 'compute', id: -1, params: {}, bullet: {} }],
    [{ type: 'compute', id: 1.5, params: {}, bullet: {} }],
    [{ type: 'compute', id: '7', params: {}, bullet: {} }],
    [{ type: 'compute', params: {}, bullet: {} }],
  ])('invalid id %p → ignored', async (msg) => {
    loader.initEngine.mockResolvedValue(undefined);
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope.postMessage.mockClear();
    scope._dispatch('message', msg);
    await Promise.resolve();
    await Promise.resolve();
    expect(scope.postMessage).not.toHaveBeenCalled();
  });

  test.each([
    [{ type: 'compute', id: 1, params: null, bullet: {} }],
    [{ type: 'compute', id: 1, params: [1, 2], bullet: {} }],
    [{ type: 'compute', id: 1, params: {}, bullet: null }],
    [{ type: 'compute', id: 1, params: {}, bullet: [1] }],
  ])('params/bullet null or array → error with invalid compute message', async (msg) => {
    loader.initEngine.mockResolvedValue(undefined);
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope.postMessage.mockClear();
    scope._dispatch('message', msg);
    await Promise.resolve();
    await Promise.resolve();
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error', name: 'BallisticsEngineError', message: 'invalid compute message'
    }));
  });

  test('non-object data → ignored', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope.postMessage.mockClear();
    scope._dispatch('message', 'hello');
    scope._dispatch('message', 42);
    scope._dispatch('message', null);
    await Promise.resolve();
    expect(scope.postMessage).not.toHaveBeenCalled();
  });

  test('unknown type → ignored', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope.postMessage.mockClear();
    scope._dispatch('message', { type: 'foobar' });
    await Promise.resolve();
    expect(scope.postMessage).not.toHaveBeenCalled();
  });

  test('error message longer than 500 characters → truncated', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    loader.computeTrajectory.mockImplementation(() => {
      throw new Error('x'.repeat(600));
    });
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope._dispatch('message', makeCompute(1));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const calls = scope.postMessage.mock.calls;
    const err = calls.find(c => c[0].type === 'error');
    expect(err[0].message.length).toBe(500);
  });

  test('init rejects with non-Error value → init_error uses ?? err fallback (line 16)', async () => {
    loader.initEngine.mockRejectedValue('plain string error');
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'init_error', message: 'plain string error' })
    );
    expect(scope.close).toHaveBeenCalled();
  });

  test('compute BallisticsEngineError with undefined message → ?? err fallback (line 48)', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    loader.computeTrajectory.mockImplementation(() => {
      const e = new loader.BallisticsEngineError('original');
      e.message = undefined; // force ?? err branch: e?.message is undefined
      throw e;
    });
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope._dispatch('message', makeCompute(1));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const errMsg = scope.postMessage.mock.calls.find(c => c[0].type === 'error');
    expect(errMsg[0].name).toBe('BallisticsEngineError');
    expect(typeof errMsg[0].message).toBe('string');
  });

  test('compute throws non-Error string → EngineFault, ?? err fallback (line 51)', async () => {
    loader.initEngine.mockResolvedValue(undefined);
    loader.computeTrajectory.mockImplementation(() => { throw 'string fault'; });
    const scope = makeScope();
    bootstrap(scope);
    await Promise.resolve();
    await Promise.resolve();
    scope._dispatch('message', makeCompute(1));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const errMsg = scope.postMessage.mock.calls.find(c => c[0].type === 'error');
    expect(errMsg[0].name).toBe('EngineFault');
    expect(errMsg[0].message).toBe('string fault');
    expect(scope.close).toHaveBeenCalled();
  });
});
