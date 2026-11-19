// Service Workers require HTTPS or localhost.
// See: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers

export const CACHE_PREFIX = 'ballistics-sw';
export const STATIC_ASSETS_TO_PRECACHE = ['__VITE_PRECACHE_MANIFEST__'];

// ── Cache versioning ──────────────────────────────────────────────────────────
// Vite injects a build timestamp here at bundle time.
let CACHE_VERSION = 'v1';
export function getCacheName() { return `${CACHE_PREFIX}-${CACHE_VERSION}`; }

// ── Fetch strategy helpers ────────────────────────────────────────────────────

export async function cacheFirstNetworkFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(getCacheName());
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

export async function networkFirstCacheFallback(request, preloadResponsePromise) {
  try {
    // Use the preloaded response when NavigationPreload is active; it started
    // in parallel with SW boot so it may already be ready. Fall back to fetch.
    const response = preloadResponsePromise
      ? ((await preloadResponsePromise) ?? await fetch(request))
      : await fetch(request);
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

// ── NavigationPreload ─────────────────────────────────────────────────────────
// If this is ever removed, call registration.navigationPreload.disable() in
// handleActivate. Browsers keep sending preload requests that nobody consumes.

export async function enableNavigationPreload(registration) {
  if (!registration?.navigationPreload) return false;
  try {
    await registration.navigationPreload.enable();
    return true;
  } catch {
    return false;
  }
}

// ── Lifecycle handlers ────────────────────────────────────────────────────────

/** Matches Vite content-hashed immutable assets under /assets/ (PERF-24). */
export const IMMUTABLE_ASSET_RE = /\/assets\/.+-[A-Za-z0-9_-]{8}\./;

/**
 * Precache one URL into `cache`. For immutable Vite-hashed assets, reuse any
 * matching response already stored in a prior cache to avoid re-downloading
 * unchanged fonts/chunks across deploys (PERF-24).
 */
export async function precacheAsset(cache, url) {
  if (IMMUTABLE_ASSET_RE.test(url)) {
    const existing = await caches.match(url);
    if (existing) {
      await cache.put(url, existing);
      return;
    }
  }
  await cache.add(url);
}

export async function handleInstall() {
  const cache = await caches.open(getCacheName());
  await Promise.allSettled(
    STATIC_ASSETS_TO_PRECACHE.map(url => precacheAsset(cache, url).catch(() => null)),
  );
  await self.skipWaiting();
}

export async function handleActivate() {
  const current = getCacheName();
  const keys    = await caches.keys();
  await Promise.all(
    keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== current)
        .map(k => caches.delete(k)),
  );
  await enableNavigationPreload(self.registration);
  await self.clients.claim();
}

export function handleFetch(event) {
  const { request } = event;

  if (request.method !== 'GET') return;

  // Navigation requests (HTML pages) go network-first to avoid stale deploys.
  // Pass event.preloadResponse so the fetch that started during SW boot is used
  // when NavigationPreload is active.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstCacheFallback(request, event.preloadResponse));
    return;
  }

  event.respondWith(cacheFirstNetworkFallback(request));
}

// ── Register lifecycle listeners ──────────────────────────────────────────────

export function registerListeners(scope) {
  scope.addEventListener('install',  event => { event.waitUntil(handleInstall()); });
  scope.addEventListener('activate', event => { event.waitUntil(handleActivate()); });
  scope.addEventListener('fetch',    handleFetch);
}

/* istanbul ignore next -- guards against running in non-SW environments (tests, Node.js) */
if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  registerListeners(self);
}
