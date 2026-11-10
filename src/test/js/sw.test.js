/**
 * @jest-environment node
 */
// Tests for src/main/resources/static/sw.js
// Use Node environment: Node 18+ has built-in Response/fetch; sw.js doesn't need DOM.
// self.skipWaiting and self.clients.claim are set on global (global === self in Node).
// caches is mocked globally since it's a SW-only API.

const sw = require('../../main/resources/static/sw.js');

// ── Global mock helpers ───────────────────────────────────────────────────────

function makeCache() {
  const store = new Map();
  return {
    _store: store,
    put:   jest.fn().mockImplementation(async (key, val) => { store.set(typeof key === 'string' ? key : key.url, val); }),
    add:   jest.fn().mockResolvedValue(undefined),
    match: jest.fn().mockImplementation(async key => store.get(typeof key === 'string' ? key : key.url)),
  };
}

function setupCachesMock() {
  const cacheStore = new Map();
  global.caches = {
    _store: cacheStore,
    open:   jest.fn().mockImplementation(async name => {
      if (!cacheStore.has(name)) cacheStore.set(name, makeCache());
      return cacheStore.get(name);
    }),
    match:  jest.fn().mockImplementation(async key => {
      for (const c of cacheStore.values()) {
        const v = c._store.get(typeof key === 'string' ? key : key.url);
        if (v !== undefined) return v;
      }
      return undefined;
    }),
    keys:   jest.fn().mockResolvedValue([...cacheStore.keys()]),
    delete: jest.fn().mockImplementation(async name => { cacheStore.delete(name); return true; }),
  };
}

function makeRequest(method, url, body) {
  return {
    method,
    url,
    clone: jest.fn().mockReturnThis(),
    json:  jest.fn().mockResolvedValue(body ?? {}),
  };
}

function makeEvent(request) {
  return {
    request,
    respondWith: jest.fn(),
    waitUntil:   jest.fn(),
  };
}

function makeSelfMock() {
  const handlers = {};
  return {
    addEventListener: jest.fn((type, fn) => { handlers[type] = fn; }),
    skipWaiting:  jest.fn().mockResolvedValue(undefined),
    clients: { claim: jest.fn().mockResolvedValue(undefined) },
    _handlers: handlers,
  };
}

beforeEach(() => {
  setupCachesMock();
  global.fetch = jest.fn();
  // In Node environment, 'self' is not defined. Set self = global so sw.js's
  // self.skipWaiting() and self.clients.claim() resolve to global properties.
  global.self = global;
  global.skipWaiting = jest.fn().mockResolvedValue(undefined);
  global.clients = { claim: jest.fn().mockResolvedValue(undefined) };
  sw._setWasmHash('v1');
});

// ── extractWasmHash ───────────────────────────────────────────────────────────
describe('extractWasmHash', () => {
  test('extracts hash from Vite-hashed WASM path', () => {
    expect(sw.extractWasmHash('/assets/engine.a1b2c3d4.wasm')).toBe('a1b2c3d4');
  });

  test('extracts longer hash', () => {
    expect(sw.extractWasmHash('/engine.deadbeef1234567890.wasm')).toBe('deadbeef1234567890');
  });

  test('returns null when no hash pattern', () => {
    expect(sw.extractWasmHash('/engine.wasm')).toBeNull();
  });

  test('returns null for non-wasm url', () => {
    expect(sw.extractWasmHash('/ballistics.js')).toBeNull();
  });
});

// ── getCacheName ──────────────────────────────────────────────────────────────
describe('getCacheName', () => {
  test('includes prefix and hash', () => {
    sw._setWasmHash('abc123');
    expect(sw.getCacheName()).toBe('ballistics-sw-abc123');
  });
});

// ── interpolateDragTable ──────────────────────────────────────────────────────
describe('interpolateDragTable', () => {
  const TABLE = [[0, 1.0], [100, 2.0], [200, 3.0]];

  test('below table minimum returns first entry', () => {
    expect(sw.interpolateDragTable(0, TABLE)).toBe(1.0);
  });

  test('above table maximum returns last entry', () => {
    expect(sw.interpolateDragTable(300, TABLE)).toBe(3.0);
  });

  test('interpolates between entries', () => {
    expect(sw.interpolateDragTable(50, TABLE)).toBeCloseTo(1.5, 5);
  });

  test('exact table entry returns that value', () => {
    expect(sw.interpolateDragTable(100, TABLE)).toBe(2.0);
  });

  test('uses abs value for negative velocity', () => {
    expect(sw.interpolateDragTable(-50, TABLE)).toBeCloseTo(1.5, 5);
  });
});

// ── airDensityRatio ───────────────────────────────────────────────────────────
describe('airDensityRatio', () => {
  test('sea level standard atmosphere returns ~1.0', () => {
    expect(sw.airDensityRatio(0, 59)).toBeCloseTo(1.0, 2);
  });

  test('high altitude returns lower density', () => {
    expect(sw.airDensityRatio(10000, 59)).toBeLessThan(1.0);
  });
});

// ── findZeroAngleFps ──────────────────────────────────────────────────────────
describe('findZeroAngleFps', () => {
  test('uses G1 table by default (no dragTable arg)', () => {
    // Call with 5 args to exercise the dragTable = G1_TABLE default parameter branch
    const angle = sw.findZeroAngleFps(2690, 0.475, 1, 300, 0.1);
    expect(typeof angle).toBe('number');
    expect(angle).toBeGreaterThan(-0.05);
    expect(angle).toBeLessThan(0.05);
  });
});

// ── integrateTrajectoryFps ────────────────────────────────────────────────────
describe('integrateTrajectoryFps', () => {
  test('uses cosAngle=1 and G1 table by default (no cosAngle/dragTable args)', () => {
    // Call with 8 args to exercise the cosAngle = 1 and dragTable = G1_TABLE default parameter branches
    const result = sw.integrateTrajectoryFps(2690, 0, 0.475, 1, 0.024, 0, 328, 109);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.supersonicLimYd).toBeGreaterThan(0);
  });
});

// ── simulateBulletSW ──────────────────────────────────────────────────────────
describe('simulateBulletSW', () => {
  const bullet = {
    id: 'test', name: 'Test', caliber: 'Test',
    bulletWeightGrams: 11.66, muzzleVelocityMps: 820,
    ballisticCoefficient: 0.47, bulletDiameterMm: 7.82,
    muzzleEnergyJoules: 3922,
  };
  const req = {
    zeroRangeMeters: 100, maxRangeMeters: 300, stepMeters: 100,
    windSpeedKph: 0, windDirectionDeg: 90,
    altitudeMeters: 0, temperatureC: 15,
    sightHeightMm: 38.1, shootingAngleDegrees: 0, dragModel: 'G1',
  };

  test('returns result with correct shape', () => {
    const result = sw.simulateBulletSW(bullet, req);
    expect(result.bullet).toBe(bullet);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.supersonicLimitMeters).toBeGreaterThan(0);
    expect(typeof result.maxOrdinateCm).toBe('number');
  });

  test('uses G7 drag table when dragModel is G7', () => {
    const result = sw.simulateBulletSW(bullet, { ...req, dragModel: 'G7' });
    expect(result.points.length).toBeGreaterThan(0);
  });

  test('applies defaults when req fields absent', () => {
    const result = sw.simulateBulletSW(bullet, {});
    expect(result.points.length).toBeGreaterThan(0);
  });

  test('records supersonic limit when bullet goes subsonic within range', () => {
    // Extremely low BC (0.01) causes rapid deceleration; MV barely supersonic (344 m/s = 1 m/s above 343 m/s sound speed)
    const slowBullet = {
      id: 'slow', name: 'Slow', caliber: 'Test',
      bulletWeightGrams: 4, muzzleVelocityMps: 344,
      ballisticCoefficient: 0.01, bulletDiameterMm: 5.56,
      muzzleEnergyJoules: 100,
    };
    const result = sw.simulateBulletSW(slowBullet, {
      zeroRangeMeters: 50, maxRangeMeters: 150, stepMeters: 10,
    });
    expect(result.supersonicLimitMeters).toBeGreaterThan(0);
    expect(result.supersonicLimitMeters).toBeLessThan(150);
  });
});

// ── computeOfflineTrajectories ────────────────────────────────────────────────
describe('computeOfflineTrajectories', () => {
  const bullets = [
    { id: 'b1', name: 'B1', bulletWeightGrams: 10, muzzleVelocityMps: 800, ballisticCoefficient: 0.4, bulletDiameterMm: 7, muzzleEnergyJoules: 3200, caliber: 'Test' },
    { id: 'b2', name: 'B2', bulletWeightGrams: 11, muzzleVelocityMps: 850, ballisticCoefficient: 0.45, bulletDiameterMm: 7, muzzleEnergyJoules: 3972, caliber: 'Test' },
  ];

  test('returns a result per found bullet', () => {
    const req = { bulletIds: ['b1', 'b2'], zeroRangeMeters: 100, maxRangeMeters: 100, stepMeters: 100 };
    const results = sw.computeOfflineTrajectories(req, bullets);
    expect(results.length).toBe(2);
    expect(results[0].bullet.id).toBe('b1');
    expect(results[1].bullet.id).toBe('b2');
  });

  test('skips missing bullet IDs', () => {
    const results = sw.computeOfflineTrajectories({ bulletIds: ['b1', 'missing'] }, bullets);
    expect(results.length).toBe(1);
    expect(results[0].bullet.id).toBe('b1');
  });

  test('returns empty array when bulletIds absent', () => {
    const results = sw.computeOfflineTrajectories({}, bullets);
    expect(results).toEqual([]);
  });
});

// ── computeOfflineCustom ──────────────────────────────────────────────────────
describe('computeOfflineCustom', () => {
  test('computes a result for custom round params', () => {
    const req = {
      name: 'My Load',
      bulletWeightGrams: 9, muzzleVelocityMps: 850, ballisticCoefficient: 0.45, bulletDiameterMm: 7.82,
      zeroRangeMeters: 100, maxRangeMeters: 100, stepMeters: 100,
    };
    const result = sw.computeOfflineCustom(req);
    expect(result.bullet.id).toBe('custom');
    expect(result.bullet.name).toBe('My Load');
    expect(result.points.length).toBeGreaterThan(0);
  });

  test('uses default name when name absent', () => {
    const req = { bulletWeightGrams: 9, muzzleVelocityMps: 850, ballisticCoefficient: 0.45, bulletDiameterMm: 7.82 };
    const result = sw.computeOfflineCustom(req);
    expect(result.bullet.name).toBe('Custom Load');
  });
});

// ── cacheFirstNetworkFallback ─────────────────────────────────────────────────
describe('cacheFirstNetworkFallback', () => {
  test('returns cached response when available', async () => {
    const cachedResp = new Response('cached', { status: 200 });
    global.caches.match.mockResolvedValueOnce(cachedResp);
    const req = makeRequest('GET', 'http://localhost/index.html');
    const result = await sw.cacheFirstNetworkFallback(req);
    expect(result).toBe(cachedResp);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('fetches from network and caches when cache miss', async () => {
    global.caches.match.mockResolvedValueOnce(undefined);
    const clonedResp = new Response('live', { status: 200 });
    const networkResp = new Response('live', { status: 200 });
    networkResp.clone = jest.fn().mockReturnValue(clonedResp);
    global.fetch.mockResolvedValueOnce(networkResp);
    const mockCache = { put: jest.fn() };
    global.caches.open.mockResolvedValueOnce(mockCache);

    const req = makeRequest('GET', 'http://localhost/index.html');
    const result = await sw.cacheFirstNetworkFallback(req);
    expect(result).toBe(networkResp);
    expect(mockCache.put).toHaveBeenCalledWith(req, clonedResp);
  });

  test('does not cache non-ok responses', async () => {
    global.caches.match.mockResolvedValueOnce(undefined);
    const errorResp = new Response('Not Found', { status: 404 });
    errorResp.clone = jest.fn().mockReturnValue(new Response('Not Found', { status: 404 }));
    global.fetch.mockResolvedValueOnce(errorResp);
    const mockCache = { put: jest.fn() };
    global.caches.open.mockResolvedValueOnce(mockCache);

    const req = makeRequest('GET', 'http://localhost/missing');
    const result = await sw.cacheFirstNetworkFallback(req);
    expect(result).toBe(errorResp);
    expect(mockCache.put).not.toHaveBeenCalled();
  });

  test('returns 503 when both cache and network fail', async () => {
    global.caches.match.mockResolvedValueOnce(undefined);
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const req = makeRequest('GET', 'http://localhost/index.html');
    const result = await sw.cacheFirstNetworkFallback(req);
    expect(result.status).toBe(503);
  });
});

// ── handleTrajectoriesCompareOffline ─────────────────────────────────────────
describe('handleTrajectoriesCompareOffline', () => {
  const bullets = [
    { id: 'b1', name: 'B1', bulletWeightGrams: 10, muzzleVelocityMps: 800, ballisticCoefficient: 0.4, bulletDiameterMm: 7, muzzleEnergyJoules: 3200, caliber: 'Test' },
  ];
  const reqBody = { bulletIds: ['b1'], zeroRangeMeters: 100, maxRangeMeters: 100, stepMeters: 100 };

  test('returns server response when network succeeds', async () => {
    const serverResp = new Response('[{"ok":true}]', { status: 200 });
    global.fetch.mockResolvedValueOnce(serverResp);
    const req = makeRequest('POST', 'http://localhost/api/trajectories/compare', reqBody);
    const result = await sw.handleTrajectoriesCompareOffline(req);
    expect(result).toBe(serverResp);
  });

  test('returns offline computation when network fails and bullets cached', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const bulletsJson = JSON.stringify(bullets);
    const bulletsResp = new Response(bulletsJson, { status: 200 });
    bulletsResp.clone = jest.fn().mockReturnValue(new Response(bulletsJson, { status: 200 }));
    global.caches.match.mockResolvedValueOnce(bulletsResp);
    const req = makeRequest('POST', 'http://localhost/api/trajectories/compare', reqBody);
    req.json.mockResolvedValue(reqBody);
    const result = await sw.handleTrajectoriesCompareOffline(req);
    expect(result.status).toBe(200);
    expect(result.headers.get('X-Served-By')).toBe('sw-offline');
    const json = await result.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json[0].bullet.id).toBe('b1');
  });

  test('returns 503 when offline and no cached bullets', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    global.caches.match.mockResolvedValueOnce(undefined);
    const req = makeRequest('POST', 'http://localhost/api/trajectories/compare', reqBody);
    const result = await sw.handleTrajectoriesCompareOffline(req);
    expect(result.status).toBe(503);
    const json = await result.json();
    expect(json.error).toMatch(/no cached bullets/);
  });

  test('returns 503 when offline computation throws', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const bulletsResp = {
      clone: jest.fn().mockReturnValue({ json: jest.fn().mockRejectedValue(new Error('bad json')) }),
    };
    global.caches.match.mockResolvedValueOnce(bulletsResp);
    const req = makeRequest('POST', 'http://localhost/api/trajectories/compare', reqBody);
    const result = await sw.handleTrajectoriesCompareOffline(req);
    expect(result.status).toBe(503);
    const json = await result.json();
    expect(json.error).toMatch(/computation failed/);
  });
});

// ── handleTrajectoriesCustomOffline ──────────────────────────────────────────
describe('handleTrajectoriesCustomOffline', () => {
  const customBody = {
    name: 'My Load', bulletWeightGrams: 9, muzzleVelocityMps: 850,
    ballisticCoefficient: 0.45, bulletDiameterMm: 7.82,
    zeroRangeMeters: 100, maxRangeMeters: 100, stepMeters: 100,
  };

  test('returns server response when network succeeds', async () => {
    const serverResp = new Response('{"ok":true}', { status: 200 });
    global.fetch.mockResolvedValueOnce(serverResp);
    const req = makeRequest('POST', 'http://localhost/api/trajectories/custom', customBody);
    const result = await sw.handleTrajectoriesCustomOffline(req);
    expect(result).toBe(serverResp);
  });

  test('returns offline computation when network fails', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const req = makeRequest('POST', 'http://localhost/api/trajectories/custom', customBody);
    req.json.mockResolvedValue(customBody);
    const result = await sw.handleTrajectoriesCustomOffline(req);
    expect(result.status).toBe(200);
    expect(result.headers.get('X-Served-By')).toBe('sw-offline');
    const json = await result.json();
    expect(json.bullet.id).toBe('custom');
  });

  test('returns 503 when offline computation throws', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const req = makeRequest('POST', 'http://localhost/api/trajectories/custom', customBody);
    req.json.mockRejectedValue(new Error('bad json'));
    const result = await sw.handleTrajectoriesCustomOffline(req);
    expect(result.status).toBe(503);
    const json = await result.json();
    expect(json.error).toMatch(/computation failed/);
  });
});

// ── handleInstall ─────────────────────────────────────────────────────────────
describe('handleInstall', () => {
  test('opens cache, precaches static assets, and caches bullets when ok', async () => {
    const mockCache = { add: jest.fn().mockResolvedValue(undefined), put: jest.fn() };
    global.caches.open.mockResolvedValueOnce(mockCache);
    const bulletsResp = new Response('[]', { status: 200 });
    global.fetch.mockResolvedValueOnce(bulletsResp);

    await sw.handleInstall();

    expect(global.caches.open).toHaveBeenCalledWith(sw.getCacheName());
    expect(mockCache.add).toHaveBeenCalledTimes(sw.STATIC_ASSETS_TO_PRECACHE.length);
    expect(mockCache.put).toHaveBeenCalledWith(sw.BULLETS_API_URL, bulletsResp);
    expect(global.skipWaiting).toHaveBeenCalled();
  });

  test('continues even when precache requests fail', async () => {
    const mockCache = { add: jest.fn().mockRejectedValue(new Error('cache add failed')), put: jest.fn() };
    global.caches.open.mockResolvedValueOnce(mockCache);
    global.fetch.mockRejectedValueOnce(new TypeError('network'));

    await expect(sw.handleInstall()).resolves.toBeUndefined();
    expect(global.skipWaiting).toHaveBeenCalled();
  });

  test('skips bullets cache.put when bullets fetch is not ok', async () => {
    const mockCache = { add: jest.fn().mockResolvedValue(undefined), put: jest.fn() };
    global.caches.open.mockResolvedValueOnce(mockCache);
    const notOkResp = new Response('error', { status: 500 });
    global.fetch.mockResolvedValueOnce(notOkResp);

    await sw.handleInstall();
    expect(mockCache.put).not.toHaveBeenCalled();
  });
});

// ── handleActivate ────────────────────────────────────────────────────────────
describe('handleActivate', () => {
  test('deletes stale caches matching the prefix', async () => {
    sw._setWasmHash('newHash');
    const prefix = sw.CACHE_PREFIX;
    global.caches.keys.mockResolvedValueOnce([
      `${prefix}-oldHash`, `${prefix}-newHash`, 'other-cache',
    ]);
    global.caches.delete.mockResolvedValue(true);

    await sw.handleActivate();

    expect(global.caches.delete).toHaveBeenCalledWith(`${prefix}-oldHash`);
    expect(global.caches.delete).not.toHaveBeenCalledWith(`${prefix}-newHash`);
    expect(global.caches.delete).not.toHaveBeenCalledWith('other-cache');
    expect(global.clients.claim).toHaveBeenCalled();
  });

  test('no-op when no stale caches', async () => {
    sw._setWasmHash('v1');
    global.caches.keys.mockResolvedValueOnce([`${sw.CACHE_PREFIX}-v1`]);

    await sw.handleActivate();

    expect(global.caches.delete).not.toHaveBeenCalled();
    expect(global.clients.claim).toHaveBeenCalled();
  });
});

// ── handleFetch ───────────────────────────────────────────────────────────────
describe('handleFetch', () => {
  test('intercepts POST /api/trajectories/compare', () => {
    const req = makeRequest('POST', 'http://localhost/api/trajectories/compare');
    const event = makeEvent(req);
    global.fetch.mockResolvedValue(new Response('[]', { status: 200 }));
    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  test('intercepts POST /api/trajectories/custom', () => {
    const req = makeRequest('POST', 'http://localhost/api/trajectories/custom');
    req.json.mockResolvedValue({});
    const event = makeEvent(req);
    global.fetch.mockResolvedValue(new Response('{}', { status: 200 }));
    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  test('ignores non-GET non-trajectories POSTs (e.g. /api/rpc)', () => {
    const req = makeRequest('POST', 'http://localhost/api/rpc');
    const event = makeEvent(req);
    sw.handleFetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  test('intercepts GET /*.wasm and updates wasmHash when hash present', () => {
    sw._setWasmHash('v1');
    const req = makeRequest('GET', 'http://localhost/assets/engine.a1b2c3d4.wasm');
    const event = makeEvent(req);
    global.caches.match.mockResolvedValueOnce(undefined);
    global.fetch.mockResolvedValueOnce(new Response('', { status: 200 }));
    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
    expect(sw._getWasmHash()).toBe('a1b2c3d4');
  });

  test('intercepts GET /*.wasm but leaves wasmHash unchanged when no hash in filename', () => {
    sw._setWasmHash('v1');
    const req = makeRequest('GET', 'http://localhost/engine.wasm');
    const event = makeEvent(req);
    global.caches.match.mockResolvedValueOnce(undefined);
    global.fetch.mockResolvedValueOnce(new Response('', { status: 200 }));
    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
    expect(sw._getWasmHash()).toBe('v1');
  });

  test('intercepts all other GET requests with cache-first', () => {
    const req = makeRequest('GET', 'http://localhost/index.html');
    const event = makeEvent(req);
    global.caches.match.mockResolvedValueOnce(new Response('', { status: 200 }));
    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
  });
});

// ── registerListeners ─────────────────────────────────────────────────────────
describe('registerListeners', () => {
  test('registers install, activate, and fetch handlers', () => {
    const scope = makeSelfMock();
    sw.registerListeners(scope);
    expect(scope.addEventListener).toHaveBeenCalledWith('install',  expect.any(Function));
    expect(scope.addEventListener).toHaveBeenCalledWith('activate', expect.any(Function));
    expect(scope.addEventListener).toHaveBeenCalledWith('fetch',    sw.handleFetch);
  });

  test('install handler calls event.waitUntil with a Promise', () => {
    const scope = makeSelfMock();
    sw.registerListeners(scope);
    const mockCache = { add: jest.fn().mockResolvedValue(undefined), put: jest.fn() };
    global.caches.open.mockResolvedValueOnce(mockCache);
    global.fetch.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const event = makeEvent(null);
    scope._handlers['install'](event);
    expect(event.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  test('activate handler calls event.waitUntil with a Promise', () => {
    const scope = makeSelfMock();
    sw.registerListeners(scope);
    global.caches.keys.mockResolvedValueOnce([]);
    const event = makeEvent(null);
    scope._handlers['activate'](event);
    expect(event.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });
});
