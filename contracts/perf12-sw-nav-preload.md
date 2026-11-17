# PERF-12: Service Worker Navigation Preload

**Version:** 1.0.0
**Status:** Contract written, builder pending
**Date:** 2026-11-16
**Author:** Architect
**ADR:** 010 (`contracts/adr-sprint9-performance.md`, decision D9)
**Builds on:** PERF-2 (precache manifest), SPA-3 (minimal static-asset SW)

---

## 1  Problem

`app/sw.js` serves navigations network-first:

```js
if (request.mode === 'navigate') {
  event.respondWith(networkFirstCacheFallback(request));
  return;
}
```

Browsers stop idle service workers after about 30 s, and on mobile this happens often. On the next navigation the browser has to boot the SW (parse the module, run its top level, dispatch `fetch`) **before** the `fetch(request)` for `index.html` is even issued. That boot time adds directly to time-to-first-byte on every repeat visit.

Navigation Preload lets the browser send the navigation request **at the same time as** SW boot. The SW then gets the in-flight response through `event.preloadResponse`.

---

## 2  Interface changes (`app/sw.js`)

### 2.1  New export

```js
/**
 * Enable navigation preload when the browser supports it.
 * Never throws; a failure leaves the SW on the plain-fetch path.
 * @param {ServiceWorkerRegistration | undefined} registration
 * @returns {Promise<boolean>} true if preload was enabled
 */
export async function enableNavigationPreload(registration);
```

### 2.2  Changed exports

| Export | Before | After |
|---|---|---|
| `networkFirstCacheFallback(request)` | `fetch(request)` → cache, else fall back | `networkFirstCacheFallback(request, preloadResponse?)`. Takes `(await preloadResponse) ?? fetch(request)` and keeps the existing cache-put and fallback. The new parameter is optional, so existing callers and tests keep working. |
| `handleActivate()` | delete old caches → `clients.claim()` | delete old caches → `await enableNavigationPreload(self.registration)` → `clients.claim()` |
| `handleFetch(event)` | navigate → `networkFirstCacheFallback(request)` | navigate → `networkFirstCacheFallback(request, event.preloadResponse)` |

`cacheFirstNetworkFallback`, `handleInstall`, `registerListeners`, `getCacheName`, `CACHE_PREFIX`, `STATIC_ASSETS_TO_PRECACHE` and the `CACHE_VERSION` replacement placeholder stay as they are. The `vite.config.js` `serviceWorkerPlugin` string replacements (`"let CACHE_VERSION = 'v1';"` and `"'__VITE_PRECACHE_MANIFEST__'"`) must still match byte for byte.

---

## 3  Implementation notes

```js
export async function enableNavigationPreload(registration) {
  if (!registration?.navigationPreload) return false;
  try {
    await registration.navigationPreload.enable();
    return true;
  } catch {
    return false;
  }
}

export async function networkFirstCacheFallback(request, preloadResponse) {
  try {
    const response = (await preloadResponse) ?? await fetch(request);
    if (response.ok) {
      const cache = await caches.open(getCacheName());
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}
```

- **Feature detection:** `registration.navigationPreload` is missing in browsers without support. When preload isn't enabled, `event.preloadResponse` is `undefined` or resolves to `undefined`. The `?? fetch(request)` fallback handles both cases.
- **Offline:** a preload made while offline **rejects**, so it lands in the existing `catch` and falls back to the cache. Don't add a second `fetch` attempt after a rejected preload.
- **Always use the preload for navigations.** Every navigation path must await `event.preloadResponse`, which the navigate branch does, so Chrome doesn't log "preload request was cancelled before 'preloadResponse' settled". Non-navigation requests must **not** touch `preloadResponse`.
- **Header:** preload requests carry `Service-Worker-Navigation-Preload: true`. GitHub Pages ignores it and serves the same `index.html`. Don't call `navigationPreload.setHeaderValue()`.
- **Caching:** the preloaded response goes through the same `response.ok` check and `cache.put(request, response.clone())` as a normal fetch response, so offline behaviour is unchanged.
- **Disabling preload:** if a future version removes this, it must call `registration.navigationPreload.disable()` in `activate`. Otherwise browsers keep sending preloads that nobody consumes. Record this in a code comment above `enableNavigationPreload`.
- **Scope:** no change to `app/ballistics.js` registration (`{ type: 'module', scope: BASE_URL }`), and no change to `vite.config.js`.

---

## 4  Test requirements (`tests/sw.test.js`, Node environment)

**`enableNavigationPreload`**
1. `undefined` registration → `false`.
2. Registration without `navigationPreload` → `false`.
3. `navigationPreload.enable` resolves → `true`, and `enable` is called once.
4. `navigationPreload.enable` rejects → `false`, and nothing throws.

**`handleActivate`**
5. With `self.registration = { navigationPreload: { enable: jest.fn().mockResolvedValue() } }`, `enable` is called once, and **before** `self.clients.claim`. Use `mock.invocationCallOrder`.
6. With `self.registration` undefined, activation still completes and `clients.claim` is called.

**`networkFirstCacheFallback`**
7. `preloadResponse` resolves to an ok `Response`. It is returned, `fetch` is **not** called, and the response is `cache.put`.
8. `preloadResponse` resolves to `undefined`. `fetch` is called and its response is returned.
9. `preloadResponse` resolves to a non-ok response (404). It is returned and not cached.
10. `preloadResponse` rejects and a cached entry exists. The cached entry is returned and `fetch` is not called.
11. `preloadResponse` rejects and there is no cached entry. A 503 "Offline" response is returned.
12. Existing single-argument tests pass unchanged (`preloadResponse` omitted).

**`handleFetch`**
13. A navigate request with `event.preloadResponse = Promise.resolve(resp)` → `respondWith` receives a promise that resolves to `resp`.
14. A non-navigate GET with a `preloadResponse` present → the cache-first path runs and `preloadResponse` is ignored.

Coverage must stay at 100/100/100/100 for `app/sw.js`. Both `try` and `catch` in `enableNavigationPreload` and both sides of `??` must run.

---

## 5  Acceptance criteria

1. In the built `dist/sw.js`, the `CACHE_VERSION` and precache-manifest substitutions still apply, and `enableNavigationPreload` is present.
2. DevTools → Application → Service Workers: after a deploy and reload, the SW is activated. In the console, `(await navigator.serviceWorker.ready).navigationPreload.getState()` reports `{ enabled: true }`.
3. Stop the SW (Application → Service Workers → "Stop"), then reload. DevTools → Network shows the document request with request header `Service-Worker-Navigation-Preload: true`, and its start time is before the SW finishes starting.
4. Offline: DevTools Network "Offline" plus a reload serves the cached `index.html` and the app loads fully (PERF-2 behaviour is unchanged).
5. In a browser without navigation preload, the app loads and navigations work. Check this through the tests in §4 #2 and #8.
6. The console shows no "navigation preload request was cancelled" warning during normal navigation.
7. `npm test` passes at 100/100/100/100.

---

## 6  Threat model delta

No new assets and no new trust boundaries. The preload is a same-origin navigation to the same GitHub Pages URL, with the same credentials mode as a normal navigation. The only new header is the `Service-Worker-Navigation-Preload` request header, whose value is `true`. Cache-poisoning exposure is unchanged: only `response.ok` same-origin navigation responses are cached, exactly as before.
