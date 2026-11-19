import { simulateAsync, solveBCAsync, _resetForTest, _getMaxPoolSize, prewarmPhysicsWorker } from '../../app/physics/engine-async.ts';
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

  test('reuses existing idle Worker on sequential calls', async () => {
    const p1 = simulateAsync({} as any, {} as any);
    const { id } = workerInst.postMessage.mock.calls[0][0] as { id: number };
    workerInst._emit({ id, result: {} });
    await p1;

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

// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-18: bounded worker pool & AbortSignal cancellation', () => {
  const bullet = { id: 'x', bulletWeightGrams: 9, muzzleVelocityMps: 850, ballisticCoefficient: 0.45 } as any;
  const params = { zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 50, windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15 } as any;

  test('fans out concurrent jobs across up to POOL_SIZE workers and drains FIFO queue', async () => {
    const origHc = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true });
    const spawned: MockWorker[] = [];
    workerCtor.mockImplementation(() => {
      const w = new MockWorker();
      spawned.push(w);
      return w;
    });

    try {
      expect(_getMaxPoolSize()).toBe(4);
      // Launch 5 concurrent jobs — pool caps at 4 workers, 5th queues until one finishes
      const promises = Array.from({ length: 5 }, (_, i) =>
        simulateAsync({ ...bullet, id: `b${i}` }, params),
      );
      expect(spawned).toHaveLength(4);
      expect(spawned[0].postMessage).toHaveBeenCalledTimes(1);
      expect(spawned[3].postMessage).toHaveBeenCalledTimes(1);

      // Complete worker 0 → 5th job immediately dispatches onto worker 0
      const id0 = (spawned[0].postMessage.mock.calls[0][0] as { id: number }).id;
      spawned[0]._emit({ id: id0, result: { bullet: { id: 'b0' } } });
      expect(spawned[0].postMessage).toHaveBeenCalledTimes(2);

      // Complete remaining 4 jobs
      for (const [wIdx, callIdx, bId] of [[1, 0, 'b1'], [2, 0, 'b2'], [3, 0, 'b3'], [0, 1, 'b4']] as const) {
        const msgId = (spawned[wIdx].postMessage.mock.calls[callIdx][0] as { id: number }).id;
        spawned[wIdx]._emit({ id: msgId, result: { bullet: { id: bId } } });
      }
      const results = await Promise.all(promises);
      expect(results.map((r: any) => r.bullet.id)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4']);
    } finally {
      if (origHc) Object.defineProperty(navigator, 'hardwareConcurrency', origHc);
    }
  });

  test('_getMaxPoolSize falls back cleanly when hardwareConcurrency is 0/undefined', () => {
    const origHc = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 0, configurable: true });
    try {
      expect(_getMaxPoolSize()).toBe(2);
    } finally {
      if (origHc) Object.defineProperty(navigator, 'hardwareConcurrency', origHc);
    }
  });

  test('pre-aborted signal rejects immediately without spawning a worker', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(simulateAsync(bullet, params, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(workerCtor).not.toHaveBeenCalled();
  });

  test('aborting a queued task prevents postMessage from ever firing for it', async () => {
    const origHc = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 1, configurable: true });
    try {
      const p1 = simulateAsync(bullet, params);
      const ac = new AbortController();
      const p2 = simulateAsync(bullet, params, { signal: ac.signal });
      expect(workerInst.postMessage).toHaveBeenCalledTimes(1);

      ac.abort();
      await expect(p2).rejects.toMatchObject({ name: 'AbortError' });

      // Finish p1 — p2 must NOT be dispatched
      const id1 = (workerInst.postMessage.mock.calls[0][0] as { id: number }).id;
      workerInst._emit({ id: id1, result: { ok: 1 } });
      await expect(p1).resolves.toEqual({ ok: 1 });
      expect(workerInst.postMessage).toHaveBeenCalledTimes(1);
    } finally {
      if (origHc) Object.defineProperty(navigator, 'hardwareConcurrency', origHc);
    }
  });

  test('aborting an in-flight task rejects with AbortError and discards late worker reply', async () => {
    const ac = new AbortController();
    const p1 = simulateAsync(bullet, params, { signal: ac.signal });
    const id1 = (workerInst.postMessage.mock.calls[0][0] as { id: number }).id;
    ac.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });

    // Late reply arrives — slot frees up and no crash occurs
    workerInst._emit({ id: id1, result: { stale: true } });
    // Next call reuses the freed slot
    const p2 = simulateAsync(bullet, params);
    expect(workerCtor).toHaveBeenCalledTimes(1);
    const id2 = (workerInst.postMessage.mock.calls[1][0] as { id: number }).id;
    workerInst._emit({ id: id2, result: { fresh: true } });
    await expect(p2).resolves.toEqual({ fresh: true });
  });

  test('_resetForTest cleans up abort listeners on both queued and in-flight tasks', () => {
    const origHc = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 1, configurable: true });
    try {
      const ac1 = new AbortController();
      const ac2 = new AbortController();
      void simulateAsync(bullet, params, { signal: ac1.signal });
      void simulateAsync(bullet, params, { signal: ac2.signal });
      _resetForTest();
      expect(() => { ac1.abort(); ac2.abort(); }).not.toThrow();
    } finally {
      if (origHc) Object.defineProperty(navigator, 'hardwareConcurrency', origHc);
    }
  });
});
