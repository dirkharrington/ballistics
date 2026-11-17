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

// ── enableNavigationPreload ───────────────────────────────────────────────────
describe('enableNavigationPreload', () => {
  test('returns false when registration is undefined', async () => {
    const result = await sw.enableNavigationPreload(undefined);
    expect(result).toBe(false);
  });

  test('returns false when registration has no navigationPreload', async () => {
    const result = await sw.enableNavigationPreload({});
    expect(result).toBe(false);
  });

  test('calls enable and returns true when navigationPreload is available', async () => {
    const enableMock = jest.fn().mockResolvedValue(undefined);
    const result = await sw.enableNavigationPreload({ navigationPreload: { enable: enableMock } });
    expect(result).toBe(true);
    expect(enableMock).toHaveBeenCalledTimes(1);
  });

  test('returns false and does not throw when enable rejects', async () => {
    const enableMock = jest.fn().mockRejectedValue(new DOMException('Not supported'));
    await expect(sw.enableNavigationPreload({ navigationPreload: { enable: enableMock } })).resolves.toBe(false);
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

  test('enables NavigationPreload when registration.navigationPreload is available', async () => {
    global.caches.keys.mockResolvedValueOnce([]);
    const enableMock = jest.fn().mockResolvedValue(undefined);
    global.registration = { navigationPreload: { enable: enableMock } };

    await sw.handleActivate();

    expect(enableMock).toHaveBeenCalled();
    delete global.registration;
  });

  test('enables NavigationPreload before clients.claim', async () => {
    global.caches.keys.mockResolvedValueOnce([]);
    const enableMock = jest.fn().mockResolvedValue(undefined);
    global.registration = { navigationPreload: { enable: enableMock } };

    await sw.handleActivate();

    expect(enableMock.mock.invocationCallOrder[0])
      .toBeLessThan(global.clients.claim.mock.invocationCallOrder[0]);
    delete global.registration;
  });

  test('skips NavigationPreload enable when registration.navigationPreload is absent', async () => {
    global.caches.keys.mockResolvedValueOnce([]);
    global.registration = {};

    await sw.handleActivate();

    expect(global.clients.claim).toHaveBeenCalled();
    delete global.registration;
  });

  test('skips when registration is undefined', async () => {
    global.caches.keys.mockResolvedValueOnce([]);
    // global.registration is not set — self.registration is undefined
    await sw.handleActivate();
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

  test('navigate mode passes event.preloadResponse to networkFirstCacheFallback', async () => {
    const preloadBody = 'preloaded html';
    const preloadResp = new Response(preloadBody, { status: 200 });
    preloadResp.clone = jest.fn().mockReturnThis();
    const preloadPromise = Promise.resolve(preloadResp);

    const req = { ...makeRequest('GET', 'http://localhost/index.html'), mode: 'navigate' };
    const event = { ...makeEvent(req), preloadResponse: preloadPromise };
    const mockCache = makeCache();
    global.caches.open.mockResolvedValue(mockCache);

    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
    // Resolve the promise passed to respondWith and verify the preloaded response was used
    const result = await event.respondWith.mock.calls[0][0];
    expect(result).toBe(preloadResp);
  });

  test('intercepts all other GET requests with cache-first', () => {
    const req = makeRequest('GET', 'http://localhost/index.html');
    const event = makeEvent(req);
    global.caches.match.mockResolvedValueOnce(new Response('', { status: 200 }));
    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
  });

  test('non-navigate GET with preloadResponse ignores it and uses cache-first', async () => {
    // preloadResponse must not be consumed for non-navigate requests
    const preloadResp = new Response('should-not-be-used', { status: 200 });
    const req = makeRequest('GET', 'http://localhost/app.js');
    const event = { ...makeEvent(req), preloadResponse: Promise.resolve(preloadResp) };
    const cachedResp = new Response('cached', { status: 200 });
    global.caches.match.mockResolvedValueOnce(cachedResp);

    sw.handleFetch(event);
    expect(event.respondWith).toHaveBeenCalled();
    const result = await event.respondWith.mock.calls[0][0];
    expect(result).toBe(cachedResp);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── networkFirstCacheFallback with preloadResponsePromise (PERF-12) ───────────
describe('networkFirstCacheFallback with NavigationPreload', () => {
  test('uses preloaded response when promise resolves to a Response', async () => {
    const preloadResp = new Response('preload', { status: 200 });
    preloadResp.clone = jest.fn().mockReturnThis();
    const mockCache = makeCache();
    global.caches.open.mockResolvedValue(mockCache);

    const req = makeRequest('GET', 'http://localhost/');
    const result = await sw.networkFirstCacheFallback(req, Promise.resolve(preloadResp));

    expect(result).toBe(preloadResp);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('falls back to fetch when preload promise resolves to null', async () => {
    const fetchResp = new Response('fetched', { status: 200 });
    fetchResp.clone = jest.fn().mockReturnThis();
    global.fetch.mockResolvedValueOnce(fetchResp);
    const mockCache = makeCache();
    global.caches.open.mockResolvedValue(mockCache);

    const req = makeRequest('GET', 'http://localhost/');
    const result = await sw.networkFirstCacheFallback(req, Promise.resolve(null));

    expect(result).toBe(fetchResp);
    expect(global.fetch).toHaveBeenCalledWith(req);
  });

  test('falls back to fetch when preload promise resolves to undefined', async () => {
    const fetchResp = new Response('fetched', { status: 200 });
    fetchResp.clone = jest.fn().mockReturnThis();
    global.fetch.mockResolvedValueOnce(fetchResp);
    const mockCache = makeCache();
    global.caches.open.mockResolvedValue(mockCache);

    const req = makeRequest('GET', 'http://localhost/');
    const result = await sw.networkFirstCacheFallback(req, Promise.resolve(undefined));

    expect(result).toBe(fetchResp);
  });

  test('does not cache a non-ok preload response', async () => {
    const preloadResp = new Response('Not Found', { status: 404 });
    preloadResp.clone = jest.fn().mockReturnThis();
    const mockCache = makeCache();
    global.caches.open.mockResolvedValue(mockCache);

    const req = makeRequest('GET', 'http://localhost/');
    const result = await sw.networkFirstCacheFallback(req, Promise.resolve(preloadResp));

    expect(result).toBe(preloadResp);
    expect(mockCache.put).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns cached entry when preload promise rejects and cache exists', async () => {
    const cachedResp = new Response('cached', { status: 200 });
    global.caches.match.mockResolvedValueOnce(cachedResp);

    const req = makeRequest('GET', 'http://localhost/');
    const result = await sw.networkFirstCacheFallback(req, Promise.reject(new TypeError('offline')));

    expect(result).toBe(cachedResp);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 503 when preload promise rejects and no cache entry exists', async () => {
    global.caches.match.mockResolvedValueOnce(undefined);

    const req = makeRequest('GET', 'http://localhost/');
    const result = await sw.networkFirstCacheFallback(req, Promise.reject(new TypeError('offline')));

    expect(result.status).toBe(503);
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
