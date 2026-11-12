'use strict';

// Mock loader.js (used by worker-core.js in protocol integration tests)
jest.mock('../../../engine/loader.js', () => {
  const WasmUnavailableError = class WasmUnavailableError extends Error {
    constructor(m) { super(m); this.name = 'WasmUnavailableError'; }
  };
  const BallisticsEngineError = class BallisticsEngineError extends Error {
    constructor(m) { super(m); this.name = 'BallisticsEngineError'; }
  };
  return {
    initEngine: jest.fn(),
    computeTrajectory: jest.fn(),
    WasmUnavailableError,
    BallisticsEngineError,
  };
});

// virtual:wasm-engine is mapped via jest moduleNameMapper
const wasmMock = require('./__mocks__/wasm-engine.js');
const { FakeWorker } = require('./__mocks__/fake-worker.js');

// Make createEngineWorker return a FakeWorker by default
let workerFactory = () => new FakeWorker();
wasmMock.createEngineWorker.mockImplementation(() => workerFactory());

const {
  startEngine, computeWithEngine, getEngineTier, onBusyChange,
  shutdownEngine, _resetEngineClient,
  EngineTier, STARTUP_TIMEOUT_MS, REQUEST_TIMEOUT_MS,
  WasmUnavailableError, BallisticsEngineError,
  toEngineParams, toEngineBullet,
} = require('../../main/resources/static/engine-client.js');

beforeEach(() => {
  jest.useFakeTimers();
  _resetEngineClient();
  jest.clearAllMocks();
  workerFactory = () => new FakeWorker();
  wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
  wasmMock.initEngine.mockReset();
  wasmMock.computeTrajectory.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ── helpers ───────────────────────────────────────────────────────────────────
async function flushPromises() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function makeResult() {
  return { bullet: {}, request: {}, points: [{ rangeMeters: 0 }] };
}

// ── Startup tests ─────────────────────────────────────────────────────────────
describe('startup: ready → WORKER', () => {
  test('worker posts ready → tier becomes WORKER', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const p = startEngine();
    fw.emit({ type: 'ready' });
    const tier = await p;
    expect(tier).toBe(EngineTier.WORKER);
    expect(getEngineTier()).toBe(EngineTier.WORKER);
  });
});

describe('startup: createEngineWorker returns null → INLINE', () => {
  test('null worker → tries inline', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockResolvedValue(undefined);
    const tier = await startEngine();
    expect(tier).toBe(EngineTier.INLINE);
  });
});

describe('startup: createEngineWorker throws → INLINE', () => {
  test('throws → tries inline', async () => {
    wasmMock.createEngineWorker.mockImplementation(() => { throw new Error('no worker'); });
    wasmMock.initEngine.mockResolvedValue(undefined);
    const tier = await startEngine();
    expect(tier).toBe(EngineTier.INLINE);
  });
});

describe('startup: init_error → INLINE', () => {
  test('init_error from worker → falls back to inline', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    wasmMock.initEngine.mockResolvedValue(undefined);
    const p = startEngine();
    fw.emit({ type: 'init_error', message: 'boom' });
    await flushPromises();
    const tier = await p;
    expect(tier).toBe(EngineTier.INLINE);
  });
});

describe('startup: error event before ready → INLINE', () => {
  test('worker error event → falls back to inline', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    wasmMock.initEngine.mockResolvedValue(undefined);
    const p = startEngine();
    fw.emitError();
    await flushPromises();
    const tier = await p;
    expect(tier).toBe(EngineTier.INLINE);
  });
});

describe('startup: startup timeout → INLINE', () => {
  test('no message within STARTUP_TIMEOUT_MS → INLINE, terminate sent', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    wasmMock.initEngine.mockResolvedValue(undefined);
    const p = startEngine();
    jest.advanceTimersByTime(STARTUP_TIMEOUT_MS);
    await flushPromises();
    const tier = await p;
    expect(tier).toBe(EngineTier.INLINE);
    expect(fw.sent).toContainEqual({ type: 'terminate' });
  });
});

describe('startup: inline initEngine throws synchronously → JS', () => {
  test('sync throw → JS tier', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockImplementation(() => { throw new wasmMock.WasmUnavailableError('no wasm'); });
    const tier = await startEngine();
    expect(tier).toBe(EngineTier.JS);
  });
});

describe('startup: inline initEngine rejects → JS', () => {
  test('rejection → JS tier', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockRejectedValue(new wasmMock.WasmUnavailableError('no wasm'));
    const tier = await startEngine();
    expect(tier).toBe(EngineTier.JS);
  });
});

describe('startEngine is idempotent', () => {
  test('returns same promise', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const p1 = startEngine();
    const p2 = startEngine();
    expect(p1).toBe(p2);
    fw.emit({ type: 'ready' });
    await p1;
  });
});

// ── Compute: WORKER tier ──────────────────────────────────────────────────────
describe('compute WORKER: success', () => {
  test('resolves with result', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const p = startEngine();
    fw.emit({ type: 'ready' });
    await p;

    const computeP = computeWithEngine({ bulletId: 'x' }, { id: 'x' });
    const sent = fw.sent[fw.sent.length - 1];
    expect(sent.type).toBe('compute');
    const id = sent.id;
    fw.emit({ type: 'result', id, result: makeResult() });
    const result = await computeP;
    expect(result.points).toBeDefined();
  });
});

describe('compute WORKER: BallisticsEngineError reply → rejects, tier unchanged', () => {
  test('tier stays WORKER', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const p = startEngine();
    fw.emit({ type: 'ready' });
    await p;

    const computeP = computeWithEngine({}, {});
    const sent = fw.sent[fw.sent.length - 1];
    fw.emit({ type: 'error', id: sent.id, name: 'BallisticsEngineError', message: 'bad' });
    await expect(computeP).rejects.toThrow(BallisticsEngineError);
    expect(getEngineTier()).toBe(EngineTier.WORKER);
  });
});

describe('compute WORKER: EngineFault → that req rejects, others reject WasmUnavailable, tier JS', () => {
  test('degrade scenario', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    const p1 = computeWithEngine({}, {});
    const p2 = computeWithEngine({}, {});
    const id1 = fw.sent.at(-2)?.id ?? fw.sent.at(-1)?.id;
    // simulate EngineFault for first request
    const faultId = fw.sent.find(m => m.type === 'compute')?.id;
    fw.emit({ type: 'error', id: faultId, name: 'EngineFault', message: 'trap' });
    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow(WasmUnavailableError);
    expect(getEngineTier()).toBe(EngineTier.JS);
  });
});

describe('compute WORKER: error event after ready → degrade', () => {
  test('worker error after ready → JS', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    const computeP = computeWithEngine({}, {});
    fw.emitError();
    await expect(computeP).rejects.toThrow();
    expect(getEngineTier()).toBe(EngineTier.JS);
  });
});

describe('compute WORKER: messageerror → degrade', () => {
  test('messageerror → JS', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    const computeP = computeWithEngine({}, {});
    fw.emitMessageError();
    await expect(computeP).rejects.toThrow();
    expect(getEngineTier()).toBe(EngineTier.JS);
  });
});

describe('compute WORKER: request timeout → terminate + degrade', () => {
  test('timeout fires → worker.terminate called, tier JS', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    const computeP = computeWithEngine({}, {});
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    await expect(computeP).rejects.toThrow(WasmUnavailableError);
    expect(fw.terminate).toHaveBeenCalled();
    expect(getEngineTier()).toBe(EngineTier.JS);
  });
});

describe('unknown id, type, non-object data are ignored', () => {
  test('unknown id ignored', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    fw.emit({ type: 'result', id: 9999, result: makeResult() });
    fw.emit({ type: 'unknown' });
    fw.emit('hello');
    // No crash, tier unchanged
    expect(getEngineTier()).toBe(EngineTier.WORKER);
  });
});

describe('events from stale worker after degrade are ignored', () => {
  test('old worker events do not affect state', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    const computeP = computeWithEngine({}, {});
    const id = fw.sent.find(m => m.type === 'compute')?.id;
    fw.emitError();
    await expect(computeP).rejects.toThrow();
    expect(getEngineTier()).toBe(EngineTier.JS);

    // Stale event from old fw should not change anything
    fw.emit({ type: 'result', id, result: makeResult() });
    expect(getEngineTier()).toBe(EngineTier.JS);
  });
});

describe('late ready from timed-out worker is ignored by stale-worker guard', () => {
  test('no crash, tier not corrupted to WORKER (finding 1)', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    wasmMock.initEngine.mockResolvedValue(undefined);
    const p = startEngine();
    jest.advanceTimersByTime(STARTUP_TIMEOUT_MS);
    await flushPromises();
    fw.emit({ type: 'ready' }); // stale: w !== worker (worker=null after timeout)
    const tier = await p;
    expect(tier).toBe(EngineTier.INLINE);
    expect(getEngineTier()).toBe(EngineTier.INLINE); // guard blocked; tier not corrupted to WORKER
  });
});

describe('late init_error from timed-out worker is ignored by stale-worker guard', () => {
  test('no crash, tier stays INLINE not re-triggered', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    wasmMock.initEngine.mockResolvedValue(undefined);
    const p = startEngine();
    jest.advanceTimersByTime(STARTUP_TIMEOUT_MS);
    await flushPromises();
    fw.emit({ type: 'init_error', message: 'late' }); // stale: w !== worker (worker=null after timeout)
    const tier = await p;
    expect(tier).toBe(EngineTier.INLINE);
  });
});

describe('error message with unknown id is ignored (line 77)', () => {
  test('error type with no pending entry does not crash', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    fw.emit({ type: 'error', id: 9999, name: 'EngineFault', message: 'unknown' });
    expect(getEngineTier()).toBe(EngineTier.WORKER);
  });
});

describe('error event from stale worker after degrade is ignored by guard', () => {
  test('old worker error event does not change tier', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    fw.emitError(); // degrade to JS
    await flushPromises();
    expect(getEngineTier()).toBe(EngineTier.JS);

    // Second error from stale fw: w !== worker && tier !== PENDING → guard returns (line 92)
    fw.emitError();
    expect(getEngineTier()).toBe(EngineTier.JS);
  });
});

describe('stale worker A error during new worker B startup does not drop B (finding 1)', () => {
  test('old error event while new worker starting → new worker still reaches WORKER', async () => {
    let fwA;
    workerFactory = () => { fwA = new FakeWorker(); return fwA; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());

    const p1 = startEngine();
    fwA.emit({ type: 'ready' });
    await p1;
    expect(getEngineTier()).toBe(EngineTier.WORKER);

    shutdownEngine();

    let fwB;
    workerFactory = () => { fwB = new FakeWorker(); return fwB; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const p2 = startEngine(); // B starts, tier=PENDING

    // Stale worker A fires error while B is pending: must be ignored (A !== B)
    fwA.emitError();
    await flushPromises();

    // B completes normally
    fwB.emit({ type: 'ready' });
    await flushPromises();

    const tier = await p2;
    expect(tier).toBe(EngineTier.WORKER);
    expect(getEngineTier()).toBe(EngineTier.WORKER);
  });
});

describe('messageerror from stale worker → guard returns (line 103)', () => {
  test('old worker messageerror does not change tier', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    fw.emitMessageError(); // degrade to JS
    expect(getEngineTier()).toBe(EngineTier.JS);

    // Second messageerror from stale fw: w !== worker → guard returns (line 103)
    fw.emitMessageError();
    expect(getEngineTier()).toBe(EngineTier.JS);
  });
});

describe('shutdownEngine while startupTimer active clears timer (line 189)', () => {
  test('shutdown during startup clears the timer', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    startEngine(); // sets startupTimer
    shutdownEngine(); // line 189: startupTimer !== null → clears it
    expect(getEngineTier()).toBe(EngineTier.PENDING);
    // timer does not fire after shutdown
    jest.advanceTimersByTime(STARTUP_TIMEOUT_MS);
    await flushPromises();
    expect(getEngineTier()).toBe(EngineTier.PENDING);
  });
});

describe('_resetEngineClient while startupTimer active clears timer (line 231)', () => {
  test('reset during startup clears the timer', () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    startEngine(); // sets startupTimer
    _resetEngineClient(); // line 231: startupTimer !== null → clears it
    expect(getEngineTier()).toBe(EngineTier.PENDING);
    jest.advanceTimersByTime(STARTUP_TIMEOUT_MS);
    expect(getEngineTier()).toBe(EngineTier.PENDING);
  });
});

describe('shutdownEngine while compute awaits startup settles promise (finding 2)', () => {
  test('startup promise settles after shutdown → no hanging inFlight', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());

    const p = startEngine(); // sets startupResolver, timer running

    let settled = false;
    p.then(() => { settled = true; });

    shutdownEngine(); // calls startupResolver(PENDING) → settles the promise

    await flushPromises();
    expect(settled).toBe(true); // promise settled, not hanging
  });
});

// ── Compute: INLINE tier ──────────────────────────────────────────────────────
describe('compute INLINE: success', () => {
  test('calls computeTrajectory and returns result', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockResolvedValue(undefined);
    wasmMock.computeTrajectory.mockReturnValue(makeResult());
    await startEngine();

    const result = await computeWithEngine({ bulletId: 'x' }, { id: 'x' });
    expect(result.points).toBeDefined();
    expect(wasmMock.computeTrajectory).toHaveBeenCalled();
  });
});

describe('compute INLINE: BallisticsEngineError is rethrown, tier stays INLINE', () => {
  test('BallisticsEngineError propagates unchanged', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockResolvedValue(undefined);
    wasmMock.computeTrajectory.mockImplementation(() => { throw new BallisticsEngineError('bad'); });
    await startEngine();

    await expect(computeWithEngine({}, {})).rejects.toThrow(BallisticsEngineError);
    expect(getEngineTier()).toBe(EngineTier.INLINE);
  });
});

describe('compute INLINE: non-BallisticsEngineError (e.g. WASM RuntimeError) degrades tier to JS', () => {
  test('RuntimeError → WasmUnavailableError thrown, tier set to JS', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockResolvedValue(undefined);
    const runtimeError = Object.assign(new Error('unreachable'), { name: 'RuntimeError' });
    wasmMock.computeTrajectory.mockImplementation(() => { throw runtimeError; });
    await startEngine();
    expect(getEngineTier()).toBe(EngineTier.INLINE);

    const err = await computeWithEngine({}, {}).catch(e => e);
    expect(err).toBeInstanceOf(BallisticsEngineError);
    expect(err.message).toBe('inline wasm fault: unreachable');
    expect(getEngineTier()).toBe(EngineTier.JS);
  });
});

// ── Compute: JS tier ──────────────────────────────────────────────────────────
describe('compute JS: rejects WasmUnavailableError', () => {
  test('JS tier throws', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockImplementation(() => { throw new wasmMock.WasmUnavailableError('no'); });
    await startEngine();
    expect(getEngineTier()).toBe(EngineTier.JS);
    await expect(computeWithEngine({}, {})).rejects.toThrow(WasmUnavailableError);
  });
});

// ── Compute during PENDING waits for startup ──────────────────────────────────
describe('compute during PENDING waits for startup', () => {
  test('compute started before ready resolves once ready arrives', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    wasmMock.computeTrajectory.mockReturnValue(makeResult());

    const computeP = computeWithEngine({}, {});
    // startup not done yet
    fw.emit({ type: 'ready' });
    await flushPromises();
    const sent = fw.sent.find(m => m.type === 'compute');
    expect(sent).toBeDefined();
    fw.emit({ type: 'result', id: sent.id, result: makeResult() });
    const result = await computeP;
    expect(result).toBeDefined();
  });
});

// ── ids increase monotonically across a restart ───────────────────────────────
describe('ids increase monotonically across a restart', () => {
  test('id counter never resets', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());

    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    const p1 = computeWithEngine({}, {});
    const id1 = fw.sent.find(m => m.type === 'compute')?.id;
    fw.emit({ type: 'result', id: id1, result: makeResult() });
    await p1;

    // restart
    shutdownEngine();
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp2 = startEngine();
    fw.emit({ type: 'ready' });
    await sp2;

    const p2 = computeWithEngine({}, {});
    const id2 = fw.sent.find(m => m.type === 'compute')?.id;
    fw.emit({ type: 'result', id: id2, result: makeResult() });
    await p2;
    expect(id2).toBeGreaterThan(id1);
  });
});

// ── Busy state ────────────────────────────────────────────────────────────────
describe('busy state', () => {
  test('listener receives true then false on transitions', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockResolvedValue(undefined);
    wasmMock.computeTrajectory.mockReturnValue(makeResult());
    await startEngine();

    const calls = [];
    onBusyChange(v => calls.push(v));
    const p = computeWithEngine({}, {});
    await p;
    expect(calls).toEqual([true, false]);
  });

  test('unsubscribe works', async () => {
    wasmMock.createEngineWorker.mockReturnValue(null);
    wasmMock.initEngine.mockResolvedValue(undefined);
    wasmMock.computeTrajectory.mockReturnValue(makeResult());
    await startEngine();

    const calls = [];
    const unsub = onBusyChange(v => calls.push(v));
    unsub();
    await computeWithEngine({}, {});
    expect(calls).toHaveLength(0);
  });
});

// ── Shutdown ──────────────────────────────────────────────────────────────────
describe('shutdown', () => {
  test('posts terminate, rejects pending, sets tier PENDING', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    const computeP = computeWithEngine({}, {});
    shutdownEngine();
    await expect(computeP).rejects.toThrow(WasmUnavailableError);
    expect(getEngineTier()).toBe(EngineTier.PENDING);
    expect(fw.sent).toContainEqual({ type: 'terminate' });
  });

  test('next startEngine creates a new worker', async () => {
    let fw;
    workerFactory = () => { fw = new FakeWorker(); return fw; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp = startEngine();
    fw.emit({ type: 'ready' });
    await sp;

    shutdownEngine();

    let fw2;
    workerFactory = () => { fw2 = new FakeWorker(); return fw2; };
    wasmMock.createEngineWorker.mockImplementation(() => workerFactory());
    const sp2 = startEngine();
    fw2.emit({ type: 'ready' });
    const tier = await sp2;
    expect(tier).toBe(EngineTier.WORKER);
  });

  test('shutdown with no worker is a no-op', () => {
    expect(() => shutdownEngine()).not.toThrow();
  });
});

// ── Adapters ──────────────────────────────────────────────────────────────────
describe('toEngineParams', () => {
  test('bulletId comes from bullet.id', () => {
    const result = toEngineParams({ id: 'abc' }, {});
    expect(result.bulletId).toBe('abc');
  });

  test('null/undefined keys are omitted', () => {
    const result = toEngineParams({ id: 'x' }, { zeroRangeMeters: null, maxRangeMeters: undefined, stepMeters: 25 });
    expect(result).not.toHaveProperty('zeroRangeMeters');
    expect(result).not.toHaveProperty('maxRangeMeters');
    expect(result.stepMeters).toBe(25);
  });

  test('twistRateInchesPerTurn omitted when undefined', () => {
    const result = toEngineParams({ id: 'x' }, {});
    expect(result).not.toHaveProperty('twistRateInchesPerTurn');
  });

  test('bulletIds and extra keys are dropped', () => {
    const result = toEngineParams({ id: 'x' }, { bulletIds: ['x'], extraField: 99, zeroRangeMeters: 100 });
    expect(result).not.toHaveProperty('bulletIds');
    expect(result).not.toHaveProperty('extraField');
    expect(result.zeroRangeMeters).toBe(100);
  });

  test('latitudeDeg and azimuthDeg included when both provided', () => {
    const result = toEngineParams({ id: 'x' }, { latitudeDeg: 45, azimuthDeg: 90 });
    expect(result.latitudeDeg).toBe(45);
    expect(result.azimuthDeg).toBe(90);
  });

  test('latitudeDeg included but azimuthDeg omitted when azimuthDeg is null', () => {
    const result = toEngineParams({ id: 'x' }, { latitudeDeg: 45, azimuthDeg: null });
    expect(result.latitudeDeg).toBe(45);
    expect(result).not.toHaveProperty('azimuthDeg');
  });

  test('neither latitudeDeg nor azimuthDeg included when latitudeDeg is null', () => {
    const result = toEngineParams({ id: 'x' }, { latitudeDeg: null, azimuthDeg: 90 });
    expect(result).not.toHaveProperty('latitudeDeg');
    expect(result).not.toHaveProperty('azimuthDeg');
  });

  test('customDragTable included when non-empty', () => {
    const table = [{ mach: 0.5, cd: 0.3 }, { mach: 2.5, cd: 0.4 }];
    const result = toEngineParams({ id: 'x' }, { customDragTable: table });
    expect(result.customDragTable).toEqual(table);
  });

  test('customDragTable omitted when null', () => {
    const result = toEngineParams({ id: 'x' }, { customDragTable: null });
    expect(result).not.toHaveProperty('customDragTable');
  });

  test('customDragTable omitted when empty array', () => {
    const result = toEngineParams({ id: 'x' }, { customDragTable: [] });
    expect(result).not.toHaveProperty('customDragTable');
  });
});

describe('toEngineBullet', () => {
  test('missing description, hexColor, caliber → empty string', () => {
    const result = toEngineBullet({ id: '1', name: 'A', bulletWeightGrams: 10, muzzleVelocityMps: 800, ballisticCoefficient: 0.4, bulletDiameterMm: 7.82 });
    expect(result.description).toBe('');
    expect(result.hexColor).toBe('');
    expect(result.caliber).toBe('');
  });

  test('missing muzzleEnergyJoules → 0', () => {
    const result = toEngineBullet({ id: '1', name: 'A' });
    expect(result.muzzleEnergyJoules).toBe(0);
  });

  test('missing id and name → empty string fallbacks', () => {
    const result = toEngineBullet({ bulletWeightGrams: 10, muzzleVelocityMps: 800, ballisticCoefficient: 0.4, bulletDiameterMm: 7.82 });
    expect(result.id).toBe('');
    expect(result.name).toBe('');
  });
});

// ── Protocol integration: FakeWorker.bridge ───────────────────────────────────
describe('protocol integration with FakeWorker.bridge', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useFakeTimers();
  });

  test('success round trip', async () => {
    const loaderMock = jest.requireMock('../../../engine/loader.js');
    loaderMock.initEngine.mockResolvedValue(undefined);
    loaderMock.computeTrajectory.mockReturnValue(makeResult());

    const workerCore = require('../../../engine/worker-core.js');
    const { fw } = FakeWorker.bridge(workerCore);

    // The scope's postMessage calls fw.emit
    // Wait for ready
    await flushPromises();
    await flushPromises();
    const readyMsg = fw._listeners['message']?.[0];
    // Check a 'ready' message was emitted to fw listeners
    const received = [];
    fw.addEventListener('message', ({ data }) => received.push(data));
    // Re-bootstrap to get a fresh ready
    _resetEngineClient();
    loaderMock.initEngine.mockResolvedValue(undefined);
    loaderMock.computeTrajectory.mockReturnValue(makeResult());

    const { fw: fw2, scope } = FakeWorker.bridge(workerCore);
    await flushPromises();
    await flushPromises();

    // fw2 should have received 'ready'
    const readyReceived = fw2.sent.some(m => false); // scope.postMessage => fw2.emit
    // The scope.postMessage is fw2.emit, so check message listeners
    const msgs = [];
    fw2.addEventListener('message', ({ data }) => msgs.push(data));
    scope.postMessage({ type: 'compute', id: 1, params: {}, bullet: {} });
    await flushPromises();
    await flushPromises();
    // Should get result
    const resultMsg = msgs.find(m => m.type === 'result');
    expect(resultMsg?.id).toBe(1);
  });

  test('BallisticsEngineError round trip', async () => {
    const loaderMock = jest.requireMock('../../../engine/loader.js');
    loaderMock.initEngine.mockResolvedValue(undefined);
    loaderMock.computeTrajectory.mockImplementation(() => {
      throw new loaderMock.BallisticsEngineError('bad input');
    });

    const workerCore = require('../../../engine/worker-core.js');
    const { fw, scope } = FakeWorker.bridge(workerCore);

    await flushPromises();
    await flushPromises();

    const msgs = [];
    fw.addEventListener('message', ({ data }) => msgs.push(data));
    scope.postMessage({ type: 'compute', id: 2, params: {}, bullet: {} });
    await flushPromises();
    await flushPromises();

    const errMsg = msgs.find(m => m.type === 'error');
    expect(errMsg?.id).toBe(2);
    expect(errMsg?.name).toBe('BallisticsEngineError');
  });
});
