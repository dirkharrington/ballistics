import {
  simulateAsync, solveBCAsync, _resetForTest, _getMaxPoolSize,
  prewarmPhysicsWorker, simulationCacheKey, _clearCacheForTest, MAX_CACHE_ENTRIES,
} from '../../app/physics/engine-async.ts';
import { simulate, TrajectoryInputError } from '../../app/physics/engine.ts';
import { createPhysicsWorker } from '../../app/physics/create-physics-worker.ts';
import { packPoints, unpackPoints } from '../../app/physics/packed-points.ts';
import type { EffectiveDragModel, TrajectoryPoint } from '../../app/physics/types.ts';
import '../../app/physics/engine.worker.ts';

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

const SAMPLE_POINT: TrajectoryPoint = {
  rangeMeters: 0,
  dropCm: 0,
  velocityMps: 807,
  energyJoules: 3546.1,
  windDriftCm: 0,
  timeOfFlightSec: 0,
  spinDriftCm: 0,
};

function makePackedResponse(
  id: number,
  points: TrajectoryPoint[] = [],
  overrides: Partial<{
    maxOrdinateCm: number;
    maxOrdinateRangeMeters: number;
    supersonicLimitMeters: number;
    densityAltitudeMeters: number;
    dragModel: EffectiveDragModel;
  }> = {},
) {
  const { buffer, hasCoriolis } = packPoints(points);
  return {
    id,
    maxOrdinateCm: overrides.maxOrdinateCm ?? 0,
    maxOrdinateRangeMeters: overrides.maxOrdinateRangeMeters ?? 0,
    supersonicLimitMeters: overrides.supersonicLimitMeters ?? 0,
    densityAltitudeMeters: overrides.densityAltitudeMeters ?? 0,
    dragModel: overrides.dragModel ?? ('G1' as const),
    pointsBuffer: buffer,
    hasCoriolis,
  };
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
    const p1 = simulateAsync({ ballisticCoefficient: 0.45 } as any, {} as any);
    const { id } = workerInst.postMessage.mock.calls[0][0] as { id: number };
    workerInst._emit(makePackedResponse(id));
    await p1;

    simulateAsync({ ballisticCoefficient: 0.50 } as any, {} as any);
    expect(workerCtor).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('simulateAsync — pending-map dispatch', () => {
  const bullet = { id: 'x', bulletWeightGrams: 9, muzzleVelocityMps: 850, ballisticCoefficient: 0.45 } as any;
  const params = { zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 50, windSpeedKph: 0, altitudeMeters: 0, temperatureC: 15 } as any;

  test('resolves with reconstructed TrajectoryResult and preserves caller references (toBe)', async () => {
    const promise = simulateAsync(bullet, params);
    const { id } = workerInst.postMessage.mock.calls[0][0] as { id: number };
    workerInst._emit(makePackedResponse(id, [SAMPLE_POINT], {
      maxOrdinateCm: 1.5,
      maxOrdinateRangeMeters: 50,
      supersonicLimitMeters: 500,
      densityAltitudeMeters: 0,
      dragModel: 'G1',
    }));
    const result = await promise;
    expect(result.bullet).toBe(bullet);
    expect(result.request).toBe(params);
    expect(result).toEqual({
      bullet,
      request: params,
      points: [SAMPLE_POINT],
      maxOrdinateCm: 1.5,
      maxOrdinateRangeMeters: 50,
      supersonicLimitMeters: 500,
      densityAltitudeMeters: 0,
      dragModel: 'G1',
    });
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
    workerInst._emit(makePackedResponse(id + 999));
    workerInst._emit(makePackedResponse(id, [SAMPLE_POINT], { maxOrdinateCm: 2.5 }));
    const res = await promise;
    expect(res.bullet).toBe(bullet);
    expect(res.request).toBe(params);
    expect(res.maxOrdinateCm).toBe(2.5);
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
    newWorkerInst._emit(makePackedResponse(id));
    const res2 = await promise2;
    expect(res2.bullet).toBe(bullet);
    expect(res2.request).toBe(params);
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
      const callerBullets = Array.from({ length: 5 }, (_, i) => ({ ...bullet, id: `b${i}` }));
      const promises = callerBullets.map(b => simulateAsync(b, params));
      expect(spawned).toHaveLength(4);
      expect(spawned[0].postMessage).toHaveBeenCalledTimes(1);
      expect(spawned[3].postMessage).toHaveBeenCalledTimes(1);

      // Complete worker 0 → 5th job immediately dispatches onto worker 0
      const id0 = (spawned[0].postMessage.mock.calls[0][0] as { id: number }).id;
      spawned[0]._emit(makePackedResponse(id0, [], { maxOrdinateCm: 0 }));
      expect(spawned[0].postMessage).toHaveBeenCalledTimes(2);

      // Complete remaining 4 jobs
      for (const [wIdx, callIdx, ord] of [[1, 0, 1], [2, 0, 2], [3, 0, 3], [0, 1, 4]] as const) {
        const msgId = (spawned[wIdx].postMessage.mock.calls[callIdx][0] as { id: number }).id;
        spawned[wIdx]._emit(makePackedResponse(msgId, [], { maxOrdinateCm: ord }));
      }
      const results = await Promise.all(promises);
      expect(results.map((r: any) => r.bullet.id)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4']);
      results.forEach((r, i) => {
        expect(r.bullet).toBe(callerBullets[i]);
        expect(r.request).toBe(params);
        expect(r.maxOrdinateCm).toBe(i);
      });
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
      workerInst._emit(makePackedResponse(id1, [], { maxOrdinateCm: 1 }));
      await expect(p1).resolves.toMatchObject({ bullet, request: params, maxOrdinateCm: 1 });
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
    workerInst._emit(makePackedResponse(id1, [], { maxOrdinateCm: 999 }));
    // Next call reuses the freed slot
    const p2 = simulateAsync(bullet, params);
    expect(workerCtor).toHaveBeenCalledTimes(1);
    const id2 = (workerInst.postMessage.mock.calls[1][0] as { id: number }).id;
    workerInst._emit(makePackedResponse(id2, [], { maxOrdinateCm: 42 }));
    await expect(p2).resolves.toMatchObject({ bullet, request: params, maxOrdinateCm: 42 });
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

// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-19: bounded LRU simulation result cache', () => {
  const bullet = {
    id: '308', name: '.308 Win', hexColor: '#00d4ff',
    bulletWeightGrams: 10.89, muzzleVelocityMps: 807, ballisticCoefficient: 0.475, bulletDiameterMm: 7.82,
  } as any;
  const params = {
    zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 50,
    windSpeedKph: 16, altitudeMeters: 0, temperatureC: 15,
  } as any;

  test('cache hit resolves immediately with 0 worker messages and preserves updated display metadata', async () => {
    const p1 = simulateAsync(bullet, params);
    const id1 = (workerInst.postMessage.mock.calls[0][0] as { id: number }).id;
    workerInst._emit(makePackedResponse(id1, [SAMPLE_POINT], { maxOrdinateCm: 2 }));
    const res1 = await p1;
    expect(res1.bullet).toBe(bullet);
    expect(res1.request).toBe(params);
    expect(res1.points).toEqual([SAMPLE_POINT]);

    // Same physics, different display name & hexColor → cache hit with caller's bullet & params refs
    const renamedBullet = { ...bullet, name: 'Renamed .308', hexColor: '#ff0000' };
    const renamedParams = { ...params };
    const p2 = simulateAsync(renamedBullet, renamedParams);
    expect(workerInst.postMessage).toHaveBeenCalledTimes(1);
    const res2 = await p2;
    expect(res2.bullet).toBe(renamedBullet);
    expect(res2.request).toBe(renamedParams);
    expect(res2.points).toEqual([SAMPLE_POINT]);
  });

  test('changing any physics param or customDragTable/twist misses cache', async () => {
    const p1 = simulateAsync(bullet, params);
    const id1 = (workerInst.postMessage.mock.calls[0][0] as { id: number }).id;
    workerInst._emit(makePackedResponse(id1, [{ ...SAMPLE_POINT, rangeMeters: 1 }]));
    await p1;

    const p2 = simulateAsync(bullet, {
      ...params,
      windSpeedKph: 20,
      twistRateInchesPerTurn: 10,
      customDragTable: [{ mach: 0, cd: 0.1 }, { mach: 1, cd: 0.2 }, { mach: 2.5, cd: 0.15 }],
    });
    expect(workerInst.postMessage).toHaveBeenCalledTimes(2);
    const id2 = (workerInst.postMessage.mock.calls[1][0] as { id: number }).id;
    workerInst._emit(makePackedResponse(id2, [{ ...SAMPLE_POINT, rangeMeters: 2 }]));
    await p2;

    // Duplicate concurrent in-flight calls populate same key cleanly (_cacheSet overwrite branch)
    _clearCacheForTest();
    const k1 = simulationCacheKey(bullet, params);
    expect(typeof k1).toBe('string');
    const c1 = simulateAsync(bullet, params);
    const c2 = simulateAsync(bullet, params);
    const msgA = workerInst.postMessage.mock.calls[2][0] as { id: number };
    const msgB = workerInst.postMessage.mock.calls[3][0] as { id: number };
    workerInst._emit(makePackedResponse(msgA.id, [{ ...SAMPLE_POINT, rangeMeters: 3 }]));
    workerInst._emit(makePackedResponse(msgB.id, [{ ...SAMPLE_POINT, rangeMeters: 4 }]));
    await Promise.all([c1, c2]);
  });

  test('LRU evicts oldest entry beyond MAX_CACHE_ENTRIES and never caches rejections', async () => {
    // Rejected call is not cached
    const pErr = simulateAsync(bullet, params);
    const errId = (workerInst.postMessage.mock.calls[0][0] as { id: number }).id;
    workerInst._emit({ id: errId, error: { name: 'TrajectoryInputError', field: 'stepMeters', message: 'bad' } });
    await expect(pErr).rejects.toThrow('bad');

    // Fill MAX_CACHE_ENTRIES + 1 distinct keys sequentially
    let callIdx = 1;
    for (let i = 0; i <= MAX_CACHE_ENTRIES; i++) {
      const p = simulateAsync(bullet, { ...params, windSpeedKph: i });
      const msg = workerInst.postMessage.mock.calls[callIdx++][0] as { id: number };
      workerInst._emit(makePackedResponse(msg.id, [{ ...SAMPLE_POINT, rangeMeters: i }]));
      await p;
    }

    // Entry 0 was evicted → calling with windSpeedKph: 0 dispatches a new worker message
    const pEvicted = simulateAsync(bullet, { ...params, windSpeedKph: 0 });
    expect(workerInst.postMessage).toHaveBeenCalledTimes(callIdx + 1);
    const evMsg = workerInst.postMessage.mock.calls[callIdx][0] as { id: number };
    workerInst._emit(makePackedResponse(evMsg.id, [{ ...SAMPLE_POINT, rangeMeters: 999 }]));
    const evRes = await pEvicted;
    expect(evRes.points[0]!.rangeMeters).toBe(999);
  });

  test('solveBCAsync also honours pre-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      solveBCAsync({ weightG: 10, mvMps: 800, measuredDropCm: -50, rangeM: 500, altM: 0, tempC: 15 }, { signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PERF-29: engine.worker.ts zero-copy Transferable protocol', () => {
  const bullet = {
    id: '308', name: '.308 Win', caliber: '.308',
    bulletWeightGrams: 10.89, muzzleVelocityMps: 807, ballisticCoefficient: 0.475,
    bulletDiameterMm: 7.82, muzzleEnergyJoules: 3552,
  };
  const params = {
    zeroRangeMeters: 100, maxRangeMeters: 500, stepMeters: 100,
    windSpeedKph: 16, altitudeMeters: 0, temperatureC: 15,
  };

  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    postSpy = jest.spyOn(self, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    postSpy.mockRestore();
  });

  test('transfers [buffer.buffer] without echoing bullet/request and round-trips points', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { id: 7, bullet, params },
      origin: '',
    }));

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [msg, transfer] = postSpy.mock.calls[0] as [any, Transferable[]];
    expect(msg.id).toBe(7);
    expect('bullet' in msg).toBe(false);
    expect('request' in msg).toBe(false);
    expect(msg.pointsBuffer).toBeInstanceOf(Float64Array);
    expect(msg.hasCoriolis).toBe(false);
    expect(transfer).toEqual([msg.pointsBuffer.buffer]);
    expect(transfer[0]).toBe(msg.pointsBuffer.buffer);

    const expected = simulate(bullet, params);
    expect(unpackPoints(msg.pointsBuffer, msg.hasCoriolis)).toEqual(expected.points);
    expect(msg.maxOrdinateCm).toBe(expected.maxOrdinateCm);
    expect(msg.maxOrdinateRangeMeters).toBe(expected.maxOrdinateRangeMeters);
    expect(msg.supersonicLimitMeters).toBe(expected.supersonicLimitMeters);
    expect(msg.densityAltitudeMeters).toBe(expected.densityAltitudeMeters);
    expect(msg.dragModel).toBe(expected.dragModel);
  });

  test('transfers Coriolis points with hasCoriolis=true and [buffer.buffer]', () => {
    const corParams = { ...params, latitudeDeg: 45, azimuthDeg: 90 };
    window.dispatchEvent(new MessageEvent('message', {
      data: { id: 8, bullet, params: corParams },
      origin: '',
    }));

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [msg, transfer] = postSpy.mock.calls[0] as [any, Transferable[]];
    expect(msg.hasCoriolis).toBe(true);
    expect(transfer).toEqual([msg.pointsBuffer.buffer]);
    expect(unpackPoints(msg.pointsBuffer, msg.hasCoriolis)).toEqual(simulate(bullet, corParams).points);
  });

  test('handles solveBC and TrajectoryInputError messages cleanly', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'solveBC', id: 9, bcParams: { weightG: 10.89, mvMps: 807, measuredDropCm: -188.6, rangeM: 500, altM: 0, tempC: 15 } },
      origin: '',
    }));
    expect(postSpy).toHaveBeenCalledWith({ id: 9, bc: expect.any(Number) });

    window.dispatchEvent(new MessageEvent('message', {
      data: { id: 10, bullet, params: { ...params, maxRangeMeters: 99999 } },
      origin: '',
    }));
    expect(postSpy).toHaveBeenLastCalledWith({
      id: 10,
      error: {
        name: 'TrajectoryInputError',
        field: 'maxRangeMeters',
        message: 'maxRangeMeters must be a finite number greater than 0 and at most 5000',
      },
    });
  });
});
