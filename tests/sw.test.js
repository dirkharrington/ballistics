/**
 * @jest-environment node
 */
// Tests for app/sw.js
// Use Node environment: Node 18+ has built-in Response/fetch; sw.js doesn't need DOM.
// self.skipWaiting and self.clients.claim are set on global (global === self in Node).
// caches is mocked globally since it's a SW-only API.

const sw = require('../app/sw.js');

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

function makeRequest(method, url) {
  return {
    method,
    url,
    clone: jest.fn().mockReturnThis(),
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
});

// ── getCacheName ──────────────────────────────────────────────────────────────
describe('getCacheName', () => {
  test('includes CACHE_PREFIX and CACHE_VERSION', () => {
    expect(sw.getCacheName()).toBe(`${sw.CACHE_PREFIX}-v1`);
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

// ── networkFirstCacheFallback ─────────────────────────────────────────────────
describe('networkFirstCacheFallback', () => {
  test('returns network response and caches it when network succeeds', async () => {
    const clonedResp = new Response('live', { status: 200 });
    const networkResp = new Response('live', { status: 200 });
    networkResp.clone = jest.fn().mockReturnValue(clonedResp);
    global.fetch.mockResolvedValueOnce(networkResp);
    const mockCache = { put: jest.fn() };
    global.caches.open.mockResolvedValueOnce(mockCache);

    const req = makeRequest('GET', 'http://localhost/index.html');
    const result = await sw.networkFirstCacheFallback(req);
    expect(result).toBe(networkResp);
    expect(mockCache.put).toHaveBeenCalledWith(req, clonedResp);
  });

  test('does not cache non-ok network responses', async () => {
    const errorResp = new Response('error', { status: 500 });
    errorResp.clone = jest.fn().mockReturnValue(new Response('error', { status: 500 }));
    global.fetch.mockResolvedValueOnce(errorResp);
    const mockCache = { put: jest.fn() };
    global.caches.open.mockResolvedValueOnce(mockCache);

    const req = makeRequest('GET', 'http://localhost/index.html');
    const result = await sw.networkFirstCacheFallback(req);
    expect(result).toBe(errorResp);
    expect(mockCache.put).not.toHaveBeenCalled();
  });

  test('falls back to cache when network fails', async () => {
    const cachedResp = new Response('cached', { status: 200 });
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    global.caches.match.mockResolvedValueOnce(cachedResp);

    const req = makeRequest('GET', 'http://localhost/index.html');
    const result = await sw.networkFirstCacheFallback(req);
    expect(result).toBe(cachedResp);
  });

  test('returns 503 when both network and cache fail', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    global.caches.match.mockResolvedValueOnce(undefined);

    const req = makeRequest('GET', 'http://localhost/index.html');
    const result = await sw.networkFirstCacheFallback(req);
    expect(result.status).toBe(503);
  });
});

// ── handleInstall ─────────────────────────────────────────────────────────────
describe('handleInstall', () => {
  test('opens cache and precaches static assets', async () => {
    const mockCache = { add: jest.fn().mockResolvedValue(undefined) };
    global.caches.open.mockResolvedValueOnce(mockCache);

    await sw.handleInstall();

    expect(global.caches.open).toHaveBeenCalledWith(sw.getCacheName());
    expect(mockCache.add).toHaveBeenCalledTimes(sw.STATIC_ASSETS_TO_PRECACHE.length);
    expect(global.skipWaiting).toHaveBeenCalled();
  });

  test('continues even when precache requests fail', async () => {
    const mockCache = { add: jest.fn().mockRejectedValue(new Error('cache add failed')) };
    global.caches.open.mockResolvedValueOnce(mockCache);

    await expect(sw.handleInstall()).resolves.toBeUndefined();
    expect(global.skipWaiting).toHaveBeenCalled();
  });
});

// ── handleActivate ────────────────────────────────────────────────────────────
describe('handleActivate', () => {
  test('deletes stale caches matching the prefix', async () => {
    const prefix = sw.CACHE_PREFIX;
    global.caches.keys.mockResolvedValueOnce([
      `${prefix}-oldHash`, `${prefix}-v1`, 'other-cache',
    ]);
    global.caches.delete.mockResolvedValue(true);

    await sw.handleActivate();

    expect(global.caches.delete).toHaveBeenCalledWith(`${prefix}-oldHash`);
    expect(global.caches.delete).not.toHaveBeenCalledWith(`${prefix}-v1`);
    expect(global.caches.delete).not.toHaveBeenCalledWith('other-cache');
    expect(global.clients.claim).toHaveBeenCalled();
  });

  test('no-op when no stale caches', async () => {
    global.caches.keys.mockResolvedValueOnce([`${sw.CACHE_PREFIX}-v1`]);

    await sw.handleActivate();

    expect(global.caches.delete).not.toHaveBeenCalled();
    expect(global.clients.claim).toHaveBeenCalled();
  });
});

// ── handleFetch ───────────────────────────────────────────────────────────────
describe('handleFetch', () => {
  test('ignores non-GET requests', () => {
    const req = makeRequest('POST', 'http://localhost/api/rpc');
    const event = makeEvent(req);
    sw.handleFetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  test('navigate mode uses network-first (not cache-first)', () => {
    const req = { ...makeRequest('GET', 'http://localhost/index.html'), mode: 'navigate' };
    const event = makeEvent(req);
    global.fetch.mockResolvedValueOnce(new Response('', { status: 200 }));
    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
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
    const mockCache = { add: jest.fn().mockResolvedValue(undefined) };
    global.caches.open.mockResolvedValueOnce(mockCache);
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
