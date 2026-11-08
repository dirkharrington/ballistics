jest.mock('./ballistics_engine.js', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
  compute_trajectory: jest.fn(),
}), { virtual: true });

let loader;
let mockInit;
let mockComputeTrajectory;

beforeEach(() => {
  jest.resetModules();
  loader = require('./loader');
  const eng = require('./ballistics_engine.js');
  mockInit = eng.default;
  mockComputeTrajectory = eng.compute_trajectory;
});

describe('WasmUnavailableError', () => {
  it('is an instance of Error', () => {
    const err = new loader.WasmUnavailableError('wasm not available');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(loader.WasmUnavailableError);
    expect(err.message).toBe('wasm not available');
    expect(err.name).toBe('WasmUnavailableError');
  });
});

describe('BallisticsEngineError', () => {
  it('is an instance of Error', () => {
    const err = new loader.BallisticsEngineError('engine error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(loader.BallisticsEngineError);
    expect(err.message).toBe('engine error');
    expect(err.name).toBe('BallisticsEngineError');
  });
});

describe('initEngine()', () => {
  it('resolves and caches the Promise (calling twice returns the same Promise)', async () => {
    const p1 = loader.initEngine();
    const p2 = loader.initEngine();
    expect(p1).toBe(p2);
    await p1;
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('throws WasmUnavailableError when WebAssembly is not defined', () => {
    const saved = global.WebAssembly;
    delete global.WebAssembly;
    try {
      expect(() => loader.initEngine()).toThrow(loader.WasmUnavailableError);
      expect(() => loader.initEngine()).toThrow('WebAssembly is not available in this runtime');
    } finally {
      global.WebAssembly = saved;
    }
  });
});

describe('computeTrajectory()', () => {
  const params = { bulletId: 'test-bullet', zeroRangeMeters: 100, maxRangeMeters: 1000 };
  const bullet = { id: 'test-bullet', name: 'Test', bulletWeightGrams: 11.3, muzzleVelocityMps: 900 };

  it('serialises params+bullet, calls WASM, returns parsed result object', () => {
    const mockResult = {
      points: [{ rangeMeters: 0, dropCm: 0, velocityMps: 900 }],
      maxOrdinateCm: 5.2,
      maxOrdinateRangeMeters: 150,
      supersonicLimitMeters: 900,
      densityAltitudeMeters: 0,
    };
    mockComputeTrajectory.mockReturnValue(JSON.stringify(mockResult));

    const result = loader.computeTrajectory(params, bullet);

    expect(mockComputeTrajectory).toHaveBeenCalledWith(
      JSON.stringify(params),
      JSON.stringify(bullet)
    );
    expect(result).toEqual(mockResult);
  });

  it('throws BallisticsEngineError when WASM returns error envelope', () => {
    mockComputeTrajectory.mockReturnValue(JSON.stringify({ error: 'invalid bullet data' }));

    expect(() => loader.computeTrajectory(params, bullet)).toThrow(loader.BallisticsEngineError);
    expect(() => loader.computeTrajectory(params, bullet)).toThrow('invalid bullet data');
  });
});
