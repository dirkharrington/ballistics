import { simulateAsync, solveBCAsync, _resetForTest, prewarmPhysicsWorker } from '../../app/physics/engine-async.ts';
import { TrajectoryInputError } from '../../app/physics/engine.ts';
import { createPhysicsWorker } from '../../app/physics/create-physics-worker.ts';

jest.mock('../../app/physics/create-physics-worker.ts', () => ({
  createPhysicsWorker: jest.fn(),
}));

// ── MockWorker ────────────────────────────────────────────────────────────────
class MockWorker extends EventTarget {
  postMessage = jest.fn();
  terminate   = jest.fn();
  _emit(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

let workerCtor: jest.Mock;
let workerInst: MockWorker;

beforeEach(() => {
  workerInst = new MockWorker();
  workerCtor = createPhysicsWorker as jest.Mock;
  workerCtor.mockReset();
  workerCtor.mockReturnValue(workerInst);
  _resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('_getWorker — lazy creation', () => {
  test('creates Worker on first simulateAsync call', () => {
    simulateAsync({} as any, {} as any);
    expect(workerCtor).toHaveBeenCalledTimes(1);
  });

  test('reuses existing Worker on subsequent calls', () => {
    simulateAsync({} as any, {} as any);
    simulateAsync({} as any, {} as any);
    expect(workerCtor).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('simulateAsync — pending-map dispatch', () => {
  const bullet = { id: 'x', bulletWeightGrams: 9, muzzleVelocityMps: 850, ballisticCoefficient: 0.45 } as any;
  const params = { zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 50, windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15 } as any;

  test('resolves with result on WorkerSuccessResponse', async () => {
    const promise = simulateAsync(bullet, params);
    const fakeResult = { bullet, request: params, points: [], maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0 };
    const { id } = workerInst.postMessage.mock.calls[0][0] as { id: number };
    workerInst._emit({ id, result: fakeResult });
    await expect(promise).resolves.toEqual(fakeResult);
  });

  test('rejects with reconstructed TrajectoryInputError on WorkerErrorResponse', async () => {
    const promise = simulateAsync(bullet, params);
    const { id } = workerInst.postMessage.mock.calls[0][0] as { id: number };
    workerInst._emit({ id, error: { name: 'TrajectoryInputError', field: 'maxRangeMeters', message: 'maxRangeMeters must be a finite number greater than 0 and at most 5000' } });
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrajectoryInputError);
    expect((err as TrajectoryInputError).field).toBe('maxRangeMeters');
    expect((err as TrajectoryInputError).message).toContain('at most 5000');
  });

  test('ignores message with unknown id (pending entry absent)', async () => {
    const promise = simulateAsync(bullet, params);
    const { id } = workerInst.postMessage.mock.calls[0][0] as { id: number };
    workerInst._emit({ id: id + 999, result: {} });
    const fakeResult = { bullet, request: params, points: [], maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0 };
    workerInst._emit({ id, result: fakeResult });
    await expect(promise).resolves.toEqual(fakeResult);
  });

  test('postMessage carries correct id, bullet, and params', () => {
    simulateAsync(bullet, params);
    const msg = workerInst.postMessage.mock.calls[0][0] as { id: number; bullet: unknown; params: unknown };
    expect(msg.id).toBeGreaterThan(0);
    expect(msg.bullet).toBe(bullet);
    expect(msg.params).toBe(params);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('prewarmPhysicsWorker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as any).requestIdleCallback;
  });

  test('uses requestIdleCallback when available, fires callback which creates worker', () => {
    const ric = jest.fn((cb: IdleRequestCallback) => { cb({ didTimeout: false, timeRemaining: () => 50 }); return 0; });
    (globalThis as any).requestIdleCallback = ric;

    prewarmPhysicsWorker();

    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    expect(workerCtor).toHaveBeenCalledTimes(1);
  });

  test('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    delete (globalThis as any).requestIdleCallback;

    prewarmPhysicsWorker();

    expect(workerCtor).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);

    expect(workerCtor).toHaveBeenCalledTimes(1);
  });

  test('is a no-op if worker already exists (does not create a second worker)', () => {
    simulateAsync({} as any, {} as any);
    expect(workerCtor).toHaveBeenCalledTimes(1);

    const ric = jest.fn((cb: IdleRequestCallback) => { cb({ didTimeout: false, timeRemaining: () => 50 }); return 0; });
    (globalThis as any).requestIdleCallback = ric;

    prewarmPhysicsWorker();

    expect(workerCtor).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('pagehide teardown', () => {
  const bullet = { id: 'x', bulletWeightGrams: 9, muzzleVelocityMps: 850, ballisticCoefficient: 0.45 } as any;
  const params = { zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 50, windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15 } as any;

  test('terminates the worker and rejects pending promises', async () => {
    const promise = simulateAsync(bullet, params);
    window.dispatchEvent(new Event('pagehide'));
    expect(workerInst.terminate).toHaveBeenCalledTimes(1);
    await expect(promise).rejects.toThrow('Worker terminated on pagehide');
  });

  test('does nothing when worker has not been created (worker null)', () => {
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    expect(workerCtor).not.toHaveBeenCalled();
  });

  test('after pagehide, next simulateAsync call lazily creates a new worker', async () => {
    void simulateAsync(bullet, params).catch(() => {});
    expect(workerCtor).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));

    const newWorkerInst = new MockWorker();
    workerCtor.mockReturnValue(newWorkerInst);

    _resetForTest();

    const promise2 = simulateAsync(bullet, params);
    expect(workerCtor).toHaveBeenCalledTimes(2);

    const { id } = newWorkerInst.postMessage.mock.calls[0][0] as { id: number };
    const fakeResult = { bullet, request: params, points: [], maxOrdinateCm: 0, maxOrdinateRangeMeters: 0, supersonicLimitMeters: 0 };
    newWorkerInst._emit({ id, result: fakeResult });
    await expect(promise2).resolves.toEqual(fakeResult);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-17: solveBCAsync', () => {
  test('sends a single solveBC worker message and resolves with numeric BC or null', async () => {
    const bcParams = { weightG: 10.89, mvMps: 807, measuredDropCm: -150, rangeM: 500, altM: 0, tempC: 15 };
    const promise = solveBCAsync(bcParams);
    expect(workerInst.postMessage).toHaveBeenCalledTimes(1);
    const msg = workerInst.postMessage.mock.calls[0][0] as { type: string; id: number; bcParams: unknown };
    expect(msg.type).toBe('solveBC');
    expect(msg.bcParams).toBe(bcParams);
    workerInst._emit({ id: msg.id, bc: 0.4752 });
    await expect(promise).resolves.toBe(0.4752);

    const promiseNull = solveBCAsync(bcParams);
    const msg2 = workerInst.postMessage.mock.calls[1][0] as { id: number };
    workerInst._emit({ id: msg2.id, bc: null });
    await expect(promiseNull).resolves.toBeNull();
  });
});
