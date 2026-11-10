// Service Workers require HTTPS or localhost.
// See: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers

export const CACHE_PREFIX = 'ballistics-sw';
export const STATIC_ASSETS_TO_PRECACHE = [
  '/', '/index.html', '/ballistics.css', '/manifest.json',
];
export const BULLETS_API_URL = '/api/bullets';

// ── Cache versioning ──────────────────────────────────────────────────────────
// The WASM binary filename is content-hashed by Vite (e.g., engine.a1b2c3d4.wasm).
// When the first .wasm URL is intercepted, its hash is extracted and used as the
// cache version.  A new engine release produces a new hash, which busts the old
// cache on the next activate event.
let _wasmHash = 'v1';
export function _getWasmHash() { return _wasmHash; }
export function _setWasmHash(h) { _wasmHash = h; }
export function getCacheName() { return `${CACHE_PREFIX}-${_wasmHash}`; }

/** Extract the content hash from a Vite-hashed WASM filename like `engine.a1b2c3d4.wasm`. */
export function extractWasmHash(pathname) {
  const m = pathname.match(/\.([0-9a-f]{8,})\.wasm$/i);
  return m ? m[1] : null;
}

// ── G1 drag table (Ingalls) ───────────────────────────────────────────────────
// Mirrored from src/main/resources/physics-tables.yaml.
/* istanbul ignore next -- this is data, not branching logic */
const G1_TABLE = [
  [0,0.1198],[400,0.1198],[500,0.1197],[600,0.1196],[700,0.1194],
  [800,0.1193],[900,0.1194],[950,0.1202],[1000,0.1250],[1050,0.1315],
  [1100,0.1420],[1150,0.1550],[1200,0.1700],[1250,0.1820],[1300,0.1920],
  [1350,0.1990],[1400,0.2030],[1450,0.2020],[1500,0.1990],[1600,0.1920],
  [1700,0.1840],[1800,0.1750],[1900,0.1660],[2000,0.1580],[2100,0.1500],
  [2200,0.1425],[2300,0.1355],[2400,0.1295],[2500,0.1240],[2600,0.1188],
  [2700,0.1140],[2800,0.1096],[2900,0.1056],[3000,0.1020],[3100,0.0986],
  [3200,0.0955],[3300,0.0926],[3400,0.0900],[3500,0.0878],[3600,0.0858],
  [4000,0.0800],
];

// ── G7 drag table (Mayewski) ──────────────────────────────────────────────────
/* istanbul ignore next -- this is data, not branching logic */
const G7_TABLE = [
  [0,0.1198],[400,0.1198],[500,0.1197],[600,0.1194],[700,0.1189],
  [800,0.1185],[900,0.1183],[950,0.1183],[1000,0.1185],[1050,0.1200],
  [1100,0.1230],[1150,0.1270],[1200,0.1318],[1250,0.1357],[1300,0.1386],
  [1350,0.1395],[1400,0.1378],[1450,0.1335],[1500,0.1278],[1600,0.1163],
  [1700,0.1066],[1800,0.0985],[1900,0.0920],[2000,0.0868],[2100,0.0826],
  [2200,0.0790],[2300,0.0757],[2400,0.0728],[2500,0.0702],[2600,0.0680],
  [2700,0.0661],[2800,0.0644],[2900,0.0630],[3000,0.0617],[3100,0.0604],
  [3200,0.0593],[3300,0.0583],[3400,0.0573],[3500,0.0564],[3600,0.0555],
  [4000,0.0520],
];

// ── Atmosphere constants (from physics-tables.yaml) ───────────────────────────
const ATM = {
  stdTempF: 59.0, lapseRatePer1000Ft: 3.5, rankineOffset: 459.67,
  pressureCoeff: 6.87559e-6, pressureExp: 5.256,
};

// ── Physics constants (imperial) ──────────────────────────────────────────────
const G_FPS2      = 32.174;
const DT_S        = 0.0005;
const SOUND_FPS   = 1125;
const MIN_VEL_FPS = 100;
const MPH_TO_FPS  = 1.46667;
const G_PER_LB    = 453.592;
const FPS_PER_MPS = 3.28084;
const FT_PER_M    = 3.28084;
const M_PER_YARD  = 0.9144;
const CM_PER_INCH = 2.54;
const J_PER_FTLB  = 1.35582;
const MPH_PER_KPH = 0.621371;

// ── Inline physics engine (mirrors ballistics.js) ─────────────────────────────

export function interpolateDragTable(v, table) {
  v = Math.abs(v);
  if (v <= table[0][0]) return table[0][1];
  if (v >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    if (v <= table[i][0]) {
      const t = (v - table[i-1][0]) / (table[i][0] - table[i-1][0]);
      return table[i-1][1] + t * (table[i][1] - table[i-1][1]);
    }
  }
}

export function airDensityRatio(altFt, tempF) {
  const stdTemp   = ATM.stdTempF - ATM.lapseRatePer1000Ft * (altFt / 1000);
  const tempRatio = (ATM.rankineOffset + stdTemp) / (ATM.rankineOffset + tempF);
  const pressRatio = Math.pow(1 - ATM.pressureCoeff * altFt, ATM.pressureExp);
  return pressRatio * tempRatio;
}

export function findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, dragTable = G1_TABLE) {
  const deriv = (vx, vy, vel) => {
    const drag = interpolateDragTable(Math.abs(vel), dragTable) * rho / bc;
    return [-(vx / vel) * drag, -(vy / vel) * drag - G_FPS2];
  };
  let lo = -0.05, hi = 0.05;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    let vx = mvFps * Math.cos(mid), vy = mvFps * Math.sin(mid);
    let x = 0, y = 0;
    while (x < zeroFt) {
      const vel = Math.hypot(vx, vy);
      /* istanbul ignore next -- gravity prevents total velocity from dropping below 50 fps */
      if (vel < 50) break;
      const [ax1, ay1] = deriv(vx, vy, vel);
      const vx2 = vx + 0.5*DT_S*ax1, vy2 = vy + 0.5*DT_S*ay1;
      const [ax2, ay2] = deriv(vx2, vy2, Math.hypot(vx2, vy2));
      const vx3 = vx + 0.5*DT_S*ax2, vy3 = vy + 0.5*DT_S*ay2;
      const [ax3, ay3] = deriv(vx3, vy3, Math.hypot(vx3, vy3));
      const vx4 = vx +    DT_S*ax3, vy4 = vy +    DT_S*ay3;
      const [ax4, ay4] = deriv(vx4, vy4, Math.hypot(vx4, vy4));
      vx += (DT_S/6)*(ax1 + 2*ax2 + 2*ax3 + ax4);
      vy += (DT_S/6)*(ay1 + 2*ay2 + 2*ay3 + ay4);
      x  += vx * DT_S; y += vy * DT_S;
    }
    if (y < sightHtFt) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd, cosAngle = 1, dragTable = G1_TABLE) {
  const deriv = (vx, vy, vel) => {
    const drag = interpolateDragTable(Math.abs(vel), dragTable) * rho / bc;
    return [-(vx / vel) * drag, -(vy / vel) * drag - G_FPS2];
  };
  let vx = mvFps * Math.cos(angle), vy = mvFps * Math.sin(angle);
  let x = 0, y = 0, t = 0;
  const points = [];
  let nextYd = 0;
  let maxOrdIn = 0, maxOrdRangeYd = 0, supersonicLimYd = maxRangeYd;
  let supersonicLogged = false;
  const mvHorizFps = mvFps * Math.cos(angle);
  const windFps    = windMph * MPH_TO_FPS;

  while ((x / 3) <= maxRangeYd + stepYd) {
    const rangeYd = x / 3;
    const vel     = Math.hypot(vx, vy);

    if (rangeYd >= nextYd - 0.01) {
      const dropIn    = (y - x * Math.tan(angle)) * 12 * cosAngle;
      const energy    = 0.5 * (wLbs / G_FPS2) * vel * vel;
      const vacuumTof = x / mvHorizFps;
      const windDrift = windFps * (t - vacuumTof) * 12;
      points.push({
        rangeMeters:     Math.round(rangeYd * M_PER_YARD * 10) / 10,
        dropCm:          Math.round(dropIn * CM_PER_INCH * 10) / 10,
        velocityMps:     Math.round(vel / FPS_PER_MPS * 10) / 10,
        energyJoules:    Math.round(energy * J_PER_FTLB * 10) / 10,
        windDriftCm:     Math.round(windDrift * CM_PER_INCH * 10) / 10,
        timeOfFlightSec: Math.round(t * 10000) / 10000,
      });
      if (y * 12 > maxOrdIn) { maxOrdIn = y * 12; maxOrdRangeYd = rangeYd; }
      nextYd += stepYd;
    }

    if (!supersonicLogged && vel < SOUND_FPS) {
      supersonicLimYd = rangeYd;
      supersonicLogged = true;
    }

    const [ax1, ay1] = deriv(vx, vy, vel);
    const vx2 = vx + 0.5*DT_S*ax1, vy2 = vy + 0.5*DT_S*ay1;
    const [ax2, ay2] = deriv(vx2, vy2, Math.hypot(vx2, vy2));
    const vx3 = vx + 0.5*DT_S*ax2, vy3 = vy + 0.5*DT_S*ay2;
    const [ax3, ay3] = deriv(vx3, vy3, Math.hypot(vx3, vy3));
    const vx4 = vx +    DT_S*ax3, vy4 = vy +    DT_S*ay3;
    const [ax4, ay4] = deriv(vx4, vy4, Math.hypot(vx4, vy4));
    vx += (DT_S/6)*(ax1 + 2*ax2 + 2*ax3 + ax4);
    vy += (DT_S/6)*(ay1 + 2*ay2 + 2*ay3 + ay4);
    x  += vx * DT_S; y += vy * DT_S; t += DT_S;
    /* istanbul ignore next -- gravity prevents total velocity from dropping below MIN_VEL_FPS */
    if (vel < MIN_VEL_FPS) break;
  }
  return { points, maxOrdIn, maxOrdRangeYd, supersonicLimYd };
}

export function simulateBulletSW(bullet, req) {
  const bc    = bullet.ballisticCoefficient;
  const mvFps = bullet.muzzleVelocityMps * FPS_PER_MPS;
  const wLbs  = bullet.bulletWeightGrams / G_PER_LB;
  const rho   = airDensityRatio(
    (req.altitudeMeters ?? 0) * FT_PER_M,
    (req.temperatureC ?? 15) * 9 / 5 + 32,
  );
  const dragTable = (req.dragModel ?? 'G1') === 'G7' ? G7_TABLE : G1_TABLE;
  const sightHtFt = (req.sightHeightMm ?? 38.1) / 25.4 / 12;
  const cosAngle  = Math.cos((req.shootingAngleDegrees ?? 0) * Math.PI / 180);
  const zeroFt    = (req.zeroRangeMeters ?? 100) * FT_PER_M * cosAngle;
  const angle     = findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, dragTable);
  const totalWindMph  = (req.windSpeedKph ?? 0) * MPH_PER_KPH;
  const windDirRad    = ((req.windDirectionDeg ?? 90) * Math.PI) / 180;
  const windMph       = totalWindMph * Math.sin(windDirRad);
  const maxRangeYd    = (req.maxRangeMeters ?? 1000) / M_PER_YARD;
  const stepYd        = (req.stepMeters ?? 25) / M_PER_YARD;
  const { points, maxOrdIn, maxOrdRangeYd, supersonicLimYd } =
    integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd, cosAngle, dragTable);
  return {
    bullet,
    request:               req,
    points,
    maxOrdinateCm:          Math.round(maxOrdIn * CM_PER_INCH * 10) / 10,
    maxOrdinateRangeMeters: Math.round(maxOrdRangeYd * M_PER_YARD * 10) / 10,
    supersonicLimitMeters:  Math.round(supersonicLimYd * M_PER_YARD * 10) / 10,
  };
}

// ── Offline computation helpers ───────────────────────────────────────────────

export function computeOfflineTrajectories(reqBody, bulletsList) {
  const { bulletIds } = reqBody;
  return (bulletIds ?? [])
    .map(id => bulletsList.find(b => b.id === id))
    .filter(Boolean)
    .map(bullet => simulateBulletSW(bullet, reqBody));
}

export function computeOfflineCustom(reqBody) {
  const bullet = {
    id: 'custom',
    name:                 reqBody.name ?? 'Custom Load',
    caliber:              'Custom',
    bulletWeightGrams:    reqBody.bulletWeightGrams,
    muzzleVelocityMps:    reqBody.muzzleVelocityMps,
    ballisticCoefficient: reqBody.ballisticCoefficient,
    bulletDiameterMm:     reqBody.bulletDiameterMm,
    muzzleEnergyJoules:   Math.round(0.5 * (reqBody.bulletWeightGrams / 1000) * reqBody.muzzleVelocityMps ** 2),
  };
  return simulateBulletSW(bullet, reqBody);
}

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

export async function handleTrajectoriesCompareOffline(request) {
  try {
    return await fetch(request.clone());
  } catch { /* offline → fall through */ }
  try {
    const bulletsResp = await caches.match(BULLETS_API_URL);
    if (!bulletsResp) {
      return new Response(JSON.stringify({ error: 'Offline: no cached bullets' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }
    const bulletsList = await bulletsResp.clone().json();
    const reqBody     = await request.json();
    const results     = computeOfflineTrajectories(reqBody, bulletsList);
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Served-By': 'sw-offline' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Offline computation failed' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function handleTrajectoriesCustomOffline(request) {
  try {
    return await fetch(request.clone());
  } catch { /* offline → fall through */ }
  try {
    const reqBody = await request.json();
    const result  = computeOfflineCustom(reqBody);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Served-By': 'sw-offline' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Offline computation failed' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Lifecycle handlers ────────────────────────────────────────────────────────

export async function handleInstall() {
  const cache = await caches.open(getCacheName());
  await Promise.allSettled([
    ...STATIC_ASSETS_TO_PRECACHE.map(url => cache.add(url).catch(() => null)),
    fetch(BULLETS_API_URL)
      .then(r => { if (r.ok) cache.put(BULLETS_API_URL, r); })
      .catch(() => null),
  ]);
  await self.skipWaiting();
}

export async function handleActivate() {
  const current = getCacheName();
  const keys    = await caches.keys();
  await Promise.all(
    keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== current)
        .map(k => caches.delete(k)),
  );
  await self.clients.claim();
}

export function handleFetch(event) {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/api/trajectories/compare') {
    event.respondWith(handleTrajectoriesCompareOffline(request));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/trajectories/custom') {
    event.respondWith(handleTrajectoriesCustomOffline(request));
    return;
  }

  if (request.method !== 'GET') return;

  if (url.pathname.endsWith('.wasm')) {
    const hash = extractWasmHash(url.pathname);
    if (hash) _wasmHash = hash;
    event.respondWith(cacheFirstNetworkFallback(request));
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
