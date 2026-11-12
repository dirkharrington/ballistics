import { parseDragCsv } from './drag-csv.js';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend } from 'chart.js';
import BULLET_CATALOG from 'virtual:bullet-catalog';
import { G1_TABLE, G7_TABLE, ATMOSPHERE } from 'virtual:physics-tables';
import { decodeState, mergeIntoSearch } from './url-state.js';
import { loadPresets, savePreset, deletePreset, renderPresetList } from './custom-rounds.js';
import { initDopeCard, renderDopeCard, initBcSolver } from './tools.js';
import { computeWithEngine, startEngine, onBusyChange, shutdownEngine, toEngineParams, toEngineBullet, WasmUnavailableError } from './engine-client.js';
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = '/api';

// Derived from bullets.yaml via virtual:bullet-catalog at build time
const BULLET_COLORS = Object.fromEntries(BULLET_CATALOG.map(b => [b.id, b.hexColor]));

// Five-step sweep color ramp (independent of bullet catalog colors)
const SWEEP_COLORS = ['#00d4ff', '#4ADE80', '#f59e0b', '#f472b6', '#a78bfa'];

// ── HTML escaping – used wherever user-supplied strings enter innerHTML ────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Scope-adjustment angles ───────────────────────────────────────────────────
// Computes the elevation correction a shooter must dial to bring the bullet back
// to the line of sight at the given range.
//   positive = click up  (bullet below LoS, drop < 0)
//   negative = click down (bullet above LoS, drop > 0)
//   zero     = at muzzle (range = 0) or when drop is exactly 0
function computeAdjustments(dropCm, rangeMeters) {
  if (rangeMeters === 0) return { moa: 0, mrad: 0 };
  const angleRad = Math.atan2(Math.abs(dropCm) / 100, rangeMeters);
  const sign = dropCm < 0 ? 1 : (dropCm > 0 ? -1 : 0);
  return {
    moa:  Math.round(sign * angleRad * (180 / Math.PI) * 60 * 10) / 10,
    mrad: Math.round(sign * angleRad * 1000 * 10) / 10,
  };
}

// ── CSV cell escaping – doubles internal quotes, prefixes formula triggers ─────
function csvCell(str) {
  const s = String(str).replace(/"/g, '""');
  // Prevent formula injection in spreadsheet apps (Excel, Google Sheets)
  return /^[=+\-@\t\r]/.test(s) ? `"'${s}"` : `"${s}"`;
}

// G1 drag table & atmosphere constants come from virtual:physics-tables,
// generated at build time from src/main/resources/physics-tables.yaml so the
// Java engine and JS client share a single source of truth.

// ── Physics constants (imperial unit system used by the RK4 engine) ───────────
const EARTH_ROTATION_RADS = 7.2921e-5; // Earth's angular velocity in rad/s (WA-13 Coriolis)
const G_FPS2        = 32.174;   // gravitational acceleration ft/s²  (≈ 9.807 m/s²)
const DT_S          = 0.0005;   // RK4 time step 0.5 ms — chosen so energy error
                                 // stays below 0.01% up to 2000 m; halving adds
                                 // 4× cost with negligible accuracy gain
const SOUND_FPS     = 1125;     // speed of sound ft/s at ISA sea level (≈ 343 m/s)
const MIN_VEL_FPS   = 100;      // below this the G1 model diverges; break early
const MPH_TO_FPS    = 1.46667;  // 1 mph = 1.46667 ft/s  (= 5280/3600)
const G_PER_LB      = 453.592;  // grams per avoirdupois pound

// ── Conversion constants ──────────────────────────────────────────────────────
const FPS_PER_MPS   = 3.28084;
const FT_PER_M      = 3.28084;
const M_PER_YARD    = 0.9144;
const CM_PER_INCH   = 2.54;
const J_PER_FTLB    = 1.35582;
const MPH_PER_KPH   = 0.621371;

// ── Overlay state ─────────────────────────────────────────────────────────────
export const COMPUTING_OVERLAY_DELAY_MS = 150;
let _computingTimer = null;

export function _setComputing(busy) {
  const overlay = document.getElementById('computingOverlay');
  const main    = document.querySelector('main.main');
  if (busy) {
    if (_computingTimer === null && (!overlay || overlay.hasAttribute('hidden'))) {
      _computingTimer = setTimeout(() => {
        _computingTimer = null;
        const ov = document.getElementById('computingOverlay');
        const mn = document.querySelector('main.main');
        if (ov) ov.removeAttribute('hidden');
        if (mn) mn.setAttribute('aria-busy', 'true');
      }, COMPUTING_OVERLAY_DELAY_MS);
    }
  } else {
    if (_computingTimer !== null) { clearTimeout(_computingTimer); _computingTimer = null; }
    if (overlay) overlay.setAttribute('hidden', '');
    if (main) main.removeAttribute('aria-busy');
  }
}

// ── Module state ──────────────────────────────────────────────────────────────
const CUSTOM_DRAG_TABLE_KEY = 'ballistics.customDragTable';
let _customDragTable = null;
let _customDragWarnFired = false;

let bullets = [];
let selectedIds = new Set();
let lastResults = [];
let charts = {};
let offlineMode = false;
let retryTimer  = null;
// Crosshair state (task 5)
let crosshairIndex  = null;  // data-point index currently under the cursor
let crosshairPinned = false; // true after user clicks a range to lock the readout
// Table sort state (FE-3)
let sortColumn    = null;   // string | null
let sortDirection = 'asc';  // 'asc' | 'desc'
let tableResults  = null;   // results last passed to renderTable
// Sweep state (MH-4)
let sweepMode    = false;
let sweepResults = null;
let lastReq      = null;

// ── Custom drag table helpers ─────────────────────────────────────────────────
function _updateDragTableStatus(fileName, rowCount) {
  const statusDiv = document.getElementById('dragTableStatus');
  const nameEl    = document.getElementById('dragTableName');
  const helpEl    = document.getElementById('dragTableHelp');
  /* istanbul ignore else -- #dragTableStatus is always present in the app shell */
  if (statusDiv) statusDiv.style.display = (fileName || _customDragTable) ? 'block' : 'none';
  /* istanbul ignore else -- #dragTableName is always present in the app shell */
  if (nameEl)    nameEl.textContent = fileName
    ? `${fileName} (${rowCount} rows)`
    : (_customDragTable ? `Loaded (${_customDragTable.length} rows)` : '');
  if (helpEl && !fileName) helpEl.textContent = 'Mach,CD columns. Stored for future use — drag model override requires server update.';
}

function _clearCustomDragTable() {
  _customDragTable = null;
  try { localStorage.removeItem(CUSTOM_DRAG_TABLE_KEY); } catch (_) {}
  const statusDiv  = document.getElementById('dragTableStatus');
  const fileInput  = document.getElementById('dragTableFile');
  const helpEl     = document.getElementById('dragTableHelp');
  /* istanbul ignore else -- #dragTableStatus is always present in the app shell */
  if (statusDiv)  statusDiv.style.display = 'none';
  /* istanbul ignore else -- #dragTableFile is always present in the app shell */
  if (fileInput)  fileInput.value = '';
  /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
  if (helpEl)     helpEl.textContent = 'Mach,CD columns. Stored for future use — drag model override requires server update.';
}

// ── Mock data (offline fallback) — sourced from bullets.yaml via virtual:bullet-catalog ──
function getMockBullets() {
  return BULLET_CATALOG;
}

// ── Drag table interpolation (generic — works for G1 or G7 table) ─────────────
function interpolateDragTable(v, table) {
  v = Math.abs(v);
  if (v <= table[0][0]) return table[0][1];
  if (v >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    if (v <= table[i][0]) {
      const t = (v - table[i - 1][0]) / (table[i][0] - table[i - 1][0]);
      return table[i - 1][1] + t * (table[i][1] - table[i - 1][1]);
    }
  }
}

// ── G1 drag convenience wrapper (used by tests and legacy call-sites) ──────────
function g1Drag(v) {
  return interpolateDragTable(v, G1_TABLE);
}

// ── Atmosphere model ──────────────────────────────────────────────────────────
function airDensityRatio(altFt, tempF) {
  const stdTemp    = ATMOSPHERE.stdTempF - ATMOSPHERE.lapseRatePer1000Ft * (altFt / 1000);
  const tempRatio  = (ATMOSPHERE.rankineOffset + stdTemp) / (ATMOSPHERE.rankineOffset + tempF);
  const pressRatio = Math.pow(1 - ATMOSPHERE.pressureCoeff * altFt, ATMOSPHERE.pressureExp);
  return pressRatio * tempRatio;
}

// ── Client-side ballistics engine (mirrors Java BallisticsEngine) ─────────────
/**
 * Solve for the launch angle (radians) that makes the bullet pass through the
 * sight height at the given zero range.  Uses 64-step bisection; error < 1e-19 rad.
 *
 * @param {number} mvFps     muzzle velocity in ft/s
 * @param {number} bc        G1 ballistic coefficient (dimensionless)
 * @param {number} rho       air-density ratio (sea-level = 1.0)
 * @param {number} zeroFt    zero range in feet
 * @param {number} sightHtFt sight height above bore in feet
 * @returns {number} launch angle in radians
 */
function findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, dragTable = G1_TABLE) {
  const deriv = (vx, vy, vel) => {
    const drag = interpolateDragTable(Math.abs(vel), dragTable) * rho / bc;
    return [-(vx / vel) * drag, -(vy / vel) * drag - G_FPS2];
  };
  let lo = -0.05, hi = 0.05;
  // 64 iterations → error < 1e-19 rad; matches Java BallisticsEngine.findZeroAngle()
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    let vx = mvFps * Math.cos(mid), vy = mvFps * Math.sin(mid);
    let x = 0, y = 0;
    while (x < zeroFt) {
      const vel = Math.hypot(vx, vy);
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

/**
 * Integrate the full RK4 trajectory and collect output points.
 *
 * @param {number} mvFps      muzzle velocity in ft/s
 * @param {number} angle      launch angle in radians (from findZeroAngleFps)
 * @param {number} bc         G1 ballistic coefficient (dimensionless)
 * @param {number} rho        air-density ratio (sea-level = 1.0)
 * @param {number} wLbs       bullet weight in pounds
 * @param {number} windMph    full-value crosswind speed in mph (90° to bore)
 * @param {number} maxRangeYd maximum range to compute in yards
 * @param {number} stepYd     output-point interval in yards
 * @param {number} [cosAngle=1] cosine of shooting angle for rifleman's rule drop correction
 * @returns {{ points: object[], maxOrdIn: number, maxOrdRangeYd: number, supersonicLimYd: number }}
 */
function integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd, cosAngle = 1, dragTable = G1_TABLE) {
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
  // Precompute horizontal muzzle velocity for the Pejsa vacuum-TOF wind drift term.
  // Using mvFps*cos(angle) rather than mvFps alone removes a systematic under-estimate
  // that grows with range.
  const mvHorizFps = mvFps * Math.cos(angle);
  const windFps    = windMph * MPH_TO_FPS;

  while ((x / 3) <= maxRangeYd + stepYd) {
    const rangeYd = x / 3;
    const vel     = Math.hypot(vx, vy);

    if (rangeYd >= nextYd - 0.01) {
      // Rifleman's rule: apparent drop on inclined shot = flat drop × cos(θ)
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
        timeOfFlightSec: Math.round(t * 10000) / 10000
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
    if (vel < MIN_VEL_FPS) break;
  }

  return { points, maxOrdIn, maxOrdRangeYd, supersonicLimYd };
}

export function simulateBulletJS(bullet, req) {
  if (req.customDragTable && req.customDragTable.length > 0 && !_customDragWarnFired) {
    console.warn('[engine] JS fallback does not support customDragTable; using dragModel instead.');
    _customDragWarnFired = true;
  }
  const bc    = bullet.ballisticCoefficient;
  const mvFps = bullet.muzzleVelocityMps * FPS_PER_MPS;
  const wLbs  = bullet.bulletWeightGrams / G_PER_LB;
  const rho   = airDensityRatio(req.altitudeMeters * FT_PER_M,
                                req.temperatureC * 9 / 5 + 32);

  // Select drag table based on drag model (defaults to G1)
  const dragTable = (req.dragModel ?? 'G1') === 'G7' ? G7_TABLE : G1_TABLE;

  // sightHeightMm defaults to 38.1 mm (1.5 in) when absent or ≤ 0
  const sightHtFt = (req.sightHeightMm ?? 38.1) / 25.4 / 12;  // mm → inches → feet
  // Rifleman's rule: for inclined fire, effective horizontal zero = slant zero × cos(θ)
  const cosAngle  = Math.cos((req.shootingAngleDegrees ?? 0) * Math.PI / 180);
  const zeroFt    = req.zeroRangeMeters * FT_PER_M * cosAngle;
  const angle     = findZeroAngleFps(mvFps, bc, rho, zeroFt, sightHtFt, dragTable);

  // Decompose total wind speed into crosswind component (perpendicular to bore).
  // Meteorological convention: windDirectionDeg is where wind comes FROM.
  // sin(90°)=1 → full right crosswind (default); sin(270°)=-1 → full left crosswind.
  const totalWindMph  = req.windSpeedKph * MPH_PER_KPH;
  const windDirRad    = ((req.windDirectionDeg ?? 90) * Math.PI) / 180;
  const windMph       = totalWindMph * Math.sin(windDirRad);  // signed: +right, −left
  const maxRangeYd = req.maxRangeMeters / M_PER_YARD;
  const stepYd     = req.stepMeters / M_PER_YARD;
  const { points, maxOrdIn, maxOrdRangeYd, supersonicLimYd } =
    integrateTrajectoryFps(mvFps, angle, bc, rho, wLbs, windMph, maxRangeYd, stepYd, cosAngle, dragTable);

  if (req.latitudeDeg != null) {
    const latRad = req.latitudeDeg * Math.PI / 180;
    const azRad  = (req.azimuthDeg ?? 0) * Math.PI / 180;
    const factor = EARTH_ROTATION_RADS * Math.sin(latRad) * Math.cos(azRad) * bullet.muzzleVelocityMps;
    points.forEach(p => {
      const t = p.timeOfFlightSec;
      p.coriolisDeflectionCm = Math.round(factor * t * t * 100 * 10) / 10;
    });
  }

  return {
    bullet,
    request:               req,
    points,
    maxOrdinateCm:          Math.round(maxOrdIn * CM_PER_INCH * 10) / 10,
    maxOrdinateRangeMeters: Math.round(maxOrdRangeYd * M_PER_YARD * 10) / 10,
    supersonicLimitMeters:  Math.round(supersonicLimYd * M_PER_YARD * 10) / 10
  };
}

export async function simulateBullet(bullet, req) {
  try {
    const result = await computeWithEngine(toEngineParams(bullet, req), toEngineBullet(bullet));
    return { ...result, bullet, request: req };
  } catch (err) {
    if (!(err instanceof WasmUnavailableError)) {
      console.warn('[engine] WASM compute failed; using JS fallback:', err?.message);
    }
    return simulateBulletJS(bullet, req);
  }
}

// ── Compute trajectories client-side for all selected bullet IDs ──────────────
async function computeClientSide(req) {
  const results = await Promise.all(req.bulletIds.map(id => {
    const bullet = bullets.find(b => b.id === id);
    if (!bullet) return null;
    return simulateBullet(bullet, req);
  }));
  return results.filter(Boolean);
}

// ── Bullet list UI ────────────────────────────────────────────────────────────
function renderBulletList() {
  const list = document.getElementById('bulletList');
  list.innerHTML = bullets.map(b => `
    <div class="bullet-card" id="card-${escapeHtml(b.id)}"
         style="--bullet-color:${BULLET_COLORS[b.id] || '#4ADE80'}">
      <div class="bullet-name">${escapeHtml(b.name)}</div>
      <div class="bullet-specs">
        BC: ${escapeHtml(String(b.ballisticCoefficient))} &nbsp;|&nbsp; MV: ${escapeHtml(String(b.muzzleVelocityMps))} m/s
      </div>
      <div class="check"></div>
    </div>
  `).join('');
  bullets.forEach(b => {
    const card = document.getElementById('card-' + b.id);
    /* istanbul ignore else -- card is always present after innerHTML is set */
    if (card) card.addEventListener('click', () => toggleBullet(b.id));
  });
}

function toggleBullet(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateBulletCards();
  savePrefs();
  syncUrl();
  updateSweepButtonVisibility();
}

function updateBulletCards() {
  bullets.forEach(b => {
    const card = document.getElementById('card-' + b.id);
    if (card) card.classList.toggle('active', selectedIds.has(b.id));
  });
}

// ── SSE streaming helper ──────────────────────────────────────────────────────
async function streamCompare(req, onResult) {
  const response = await fetch(`${API_BASE}/trajectories/compare/stream`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(req)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  /* istanbul ignore next -- ReadableStream guard; always supported in modern browsers */
  if (!response.body) throw new Error('ReadableStream not supported');

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop();
    for (const event of events) {
      const line = event.split('\n').find(l => l.startsWith('data:'));
      /* istanbul ignore else -- SSE events without a data: line are heartbeats; rare in tests */
      if (line) {
        const json = line.slice(5).trim();
        /* istanbul ignore else -- empty data: payload is a server-side edge case */
        if (json) onResult(JSON.parse(json));
      }
    }
  }
}

// ── Error handling helpers ────────────────────────────────────────────────────

/** Returns {status, detail, retryAfterSeconds} from a fetch Response. Never throws. */
async function _parseRejection(res) {
  let body = null;
  try { body = await res.json(); } catch (_) {}
  const detail = body?.detail ?? 'Server rejected the request.';
  const retryAfterParsed = parseInt(res.headers.get('Retry-After') ?? '0', 10);
  const retryAfterSeconds = Number.isFinite(retryAfterParsed) ? retryAfterParsed : 0;
  return { status: res.status, detail, retryAfterSeconds };
}

/** Shows or hides the inline simulation error banner. */
function _setSimulationError(message) {
  const el = document.getElementById('simulationError');
  /* istanbul ignore next -- #simulationError is always present in the app shell */
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.removeAttribute('hidden');
  } else {
    el.setAttribute('hidden', '');
    el.textContent = '';
  }
}

// ── Simulation ────────────────────────────────────────────────────────────────
async function runSimulation() {
  if (selectedIds.size === 0) { alert('Select at least one round.'); return; }
  _setSimulationError(null);

  const latRaw = document.getElementById('latitudeDeg')?.value;
  const azRaw  = document.getElementById('azimuthDeg')?.value;
  if (latRaw && (+latRaw < -90 || +latRaw > 90)) { _setSimulationError('Latitude must be between −90 and 90.'); return; }
  if (azRaw  && (+azRaw  < 0  || +azRaw  > 360)) { _setSimulationError('Azimuth must be between 0 and 360.'); return; }

  const btn   = document.getElementById('runBtn');
  btn.classList.add('loading');

  const twistRaw = document.getElementById('twistRate')?.value;
  const req = {
    bulletIds:                [...selectedIds],
    zeroRangeMeters:          +document.getElementById('zeroRange').value,
    maxRangeMeters:           +document.getElementById('maxRange').value,
    stepMeters:               +document.getElementById('step').value,
    windSpeedKph:             +document.getElementById('windSpeed').value,
    windDirectionDeg:         +document.getElementById('windDir').value,
    altitudeMeters:           +document.getElementById('altitude').value,
    temperatureC:             +document.getElementById('temperature').value,
    sightHeightMm:            +document.getElementById('sightHeight').value,
    shootingAngleDegrees:     +document.getElementById('shootingAngle').value,
    dragModel:                document.getElementById('dragModel').value,
    ...(twistRaw ? { twistRateInchesPerTurn: +twistRaw } : {}),
    ...(latRaw   ? { latitudeDeg: +latRaw } : {}),
    ...(azRaw    ? { azimuthDeg:  +azRaw  } : {}),
  };
  lastReq = req;
  const total   = req.bulletIds.length;
  const results = [];
  let   done    = 0;

  const setProgress = () => {
    btn.querySelector('span').textContent = `⏳ ${done}/${total} COMPUTED...`;
  };
  setProgress();

  try {
    try {
      await streamCompare(req, result => {
        results.push(result);
        done++;
        setProgress();
        renderResults(results, req);
      });
      setOfflineMode(false);
    } catch (_streamErr) {
      /* istanbul ignore else -- partial-results path requires a stream that delivers some events then fails; not exercised in unit tests */
      if (results.length === 0) {
        let res;
        try {
          res = await fetch(`${API_BASE}/trajectories/compare`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(req)
          });
        } catch (networkErr) {
          // Network/DNS/CORS errors → OFFLINE fallback
          (await computeClientSide(req)).forEach(r => results.push(r));
          setOfflineMode(true);
          renderResults(results, req);
          lastResults = results;
          return;
        }

        if (!res.ok) {
          const ct = res.headers?.get('Content-Type') ?? '';
          if (res.status < 500 && ct.includes('problem+json')) {
            const { detail, retryAfterSeconds } = await _parseRejection(res);
            const msg = retryAfterSeconds > 0
              ? `${detail} Retry after ${retryAfterSeconds} s.`
              : detail;
            _setSimulationError(msg);
            return;
          }
          // 4xx non-JSON or 5xx → existing OFFLINE fallback
          (await computeClientSide(req)).forEach(r => results.push(r));
          setOfflineMode(true);
        } else {
          (await res.json()).forEach(r => results.push(r));
          if (res.headers?.get('X-Served-By') !== 'sw-offline') setOfflineMode(false);
        }
        renderResults(results, req);
      }
    }
    lastResults = results;
    updateSweepButtonVisibility();
  } catch (err) {
    console.error(err);
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
  }
}

// ── Export helpers ────────────────────────────────────────────────────────────
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV() {
  if (!lastResults.length) return;
  const rows = ['Round,Range (m),Drop (cm),Velocity (m/s),Energy (J),Wind Drift (cm),Time (s),MOA,MRAD'];
  lastResults.forEach(r => {
    r.points.forEach(p => {
      const adj = computeAdjustments(p.dropCm, p.rangeMeters);
      rows.push(`${csvCell(r.bullet.name)},${p.rangeMeters},${p.dropCm},${p.velocityMps},${p.energyJoules},${p.windDriftCm},${p.timeOfFlightSec},${adj.moa},${adj.mrad}`);
    });
  });
  _downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), 'trajectory.csv');
}

// ── JSON export ───────────────────────────────────────────────────────────────
function exportJSON() {
  if (!lastResults.length) return;
  _downloadBlob(
    new Blob([JSON.stringify(lastResults, null, 2)], { type: 'application/json' }),
    'trajectory.json'
  );
}

// ── Markdown export ───────────────────────────────────────────────────────────
function exportMarkdown() {
  if (!lastResults.length) return;
  const lines = [];
  lastResults.forEach(r => {
    lines.push(`## ${r.bullet.name}\n`);
    lines.push('| Range (m) | Drop (cm) | Velocity (m/s) | Energy (J) | Wind Drift (cm) | MOA | MRAD |');
    lines.push('|----------:|----------:|---------------:|-----------:|----------------:|----:|-----:|');
    r.points.forEach(p => {
      const adj = computeAdjustments(p.dropCm, p.rangeMeters);
      lines.push(`| ${p.rangeMeters} | ${p.dropCm} | ${p.velocityMps} | ${p.energyJoules} | ${p.windDriftCm} | ${adj.moa} | ${adj.mrad} |`);
    });
    lines.push('');
  });
  _downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown' }), 'trajectory.md');
}

// ── PNG export ────────────────────────────────────────────────────────────────
function exportPNG(chartId) {
  const canvas = document.getElementById(chartId);
  if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = chartId + '.png';
  a.click();
}

// ── Custom round ──────────────────────────────────────────────────────────────
function showCustomError(msg) {
  const el = document.getElementById('customError');
  /* istanbul ignore next -- #customError is always present when this function is called */
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function runCustom() {
  const name   = document.getElementById('customName').value.trim() || 'Custom Load';
  const weight = +document.getElementById('customWeight').value;
  const mv     = +document.getElementById('customMV').value;
  const bc     = +document.getElementById('customBC').value;
  const dia    = +document.getElementById('customDia').value;

  const latRawC = document.getElementById('latitudeDeg')?.value;
  const azRawC  = document.getElementById('azimuthDeg')?.value;

  if (!(weight > 0))           return showCustomError('Weight must be greater than 0');
  if (!(mv > 0))               return showCustomError('Muzzle velocity must be greater than 0');
  if (!(bc > 0 && bc <= 1.2))  return showCustomError('BC must be between 0 and 1.2');
  if (!(dia > 0))              return showCustomError('Diameter must be greater than 0');
  if (latRawC && (+latRawC < -90 || +latRawC > 90)) return showCustomError('Latitude must be between −90 and 90');
  if (azRawC  && (+azRawC  < 0  || +azRawC  > 360)) return showCustomError('Azimuth must be between 0 and 360');
  showCustomError('');

  const req = {
    name:                  name,
    bulletWeightGrams:     weight,
    muzzleVelocityMps:     mv,
    ballisticCoefficient:  bc,
    bulletDiameterMm:      dia,
    zeroRangeMeters:       +document.getElementById('zeroRange').value,
    maxRangeMeters:        +document.getElementById('maxRange').value,
    stepMeters:            +document.getElementById('step').value,
    windSpeedKph:          +document.getElementById('windSpeed').value,
    windDirectionDeg:      +document.getElementById('windDir').value,
    altitudeMeters:        +document.getElementById('altitude').value,
    temperatureC:          +document.getElementById('temperature').value,
    sightHeightMm:         +document.getElementById('sightHeight').value,
    shootingAngleDegrees:  +document.getElementById('shootingAngle').value,
    dragModel:             document.getElementById('dragModel').value,
    ...(latRawC ? { latitudeDeg: +latRawC } : {}),
    ...(azRawC  ? { azimuthDeg:  +azRawC  } : {}),
    ...(_customDragTable ? { customDragTable: _customDragTable } : {}),
  };

  let result;
  try {
    const res = await fetch(`${API_BASE}/trajectories/custom`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    result = await res.json();
  } catch (e) {
    // offline fallback
    const bullet = {
      id: 'custom', name, caliber: 'Custom',
      bulletWeightGrams: weight, muzzleVelocityMps: mv,
      ballisticCoefficient: bc, bulletDiameterMm: dia,
      muzzleEnergyJoules: Math.round(0.5 * (weight / 1000) * mv * mv)
    };
    result = await simulateBullet(bullet, { ...req, bulletIds: ['custom'] });
  }
  lastResults = [result];
  renderResults([result], req);
}

// ── Offline indicator + auto-retry ───────────────────────────────────────────
function setOfflineMode(isOffline) {
  offlineMode = isOffline;
  const pill  = document.getElementById('statusPill');
  const btn   = document.getElementById('retryBtn');
  if (pill) {
    if (isOffline) {
      pill.className   = 'status-pill status-offline';
      pill.textContent = '⚠ OFFLINE — LOCAL COMPUTE';
    } else {
      pill.className   = 'status-pill status-live';
      pill.textContent = '● READY';
    }
  }
  /* istanbul ignore else -- #retryBtn is always present in the app shell */
  if (btn) btn.style.display = isOffline ? 'inline-block' : 'none';

  if (isOffline && retryTimer === null) {
    retryTimer = setInterval(probeServer, 60_000);
  } else if (!isOffline && retryTimer !== null) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

// Probe the server; on success reload bullets, clear offline mode, show toast.
async function probeServer() {
  try {
    const res = await fetch(`${API_BASE}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'bullets.list', id: 1 }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error('RPC error');
    bullets = data.result;
    setOfflineMode(false);
    renderBulletList();
    updateBulletCards();
    showToast('Reconnected to server');
  } catch {
    // stay offline; timer will retry
  }
}

function showToast(msg) {
  const el = document.getElementById('toast');
  /* istanbul ignore next -- #toast is always present in the app shell */
  if (!el) return;
  el.textContent = msg;
  el.classList.add('toast-visible');
  el.style.display = 'block';
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, 3000);
}

// ── Crosshair plugin — draws a vertical dashed line at the hovered data index ─
// ── Chart annotation helpers ──────────────────────────────────────────────────

/** Draw a vertical dashed annotation line with a text label. */
function drawVLine(ctx, xScale, chartArea, ann) {
  // Clamp to scale.max so a value beyond the range doesn't escape the chart area
  const xPx = xScale.getPixelForValue(Math.min(ann.value, xScale.max));
  ctx.beginPath();
  ctx.moveTo(xPx, chartArea.top);
  ctx.lineTo(xPx, chartArea.bottom);
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.fillStyle = ann.color;
  ctx.font = '9px "Share Tech Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(ann.label, xPx + 3, chartArea.top + 10);
}

/** Draw a horizontal dashed annotation line with a text label. */
function drawHLine(ctx, yScale, chartArea, ann) {
  const yPx = yScale.getPixelForValue(ann.value);
  ctx.beginPath();
  ctx.moveTo(chartArea.left, yPx);
  ctx.lineTo(chartArea.right, yPx);
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.fillStyle = ann.color;
  ctx.font = '9px "Share Tech Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(ann.label, chartArea.left + 3, yPx - 4);
}

/**
 * Build a Chart.js plugin that draws a set of dashed annotation lines after each render.
 *
 * @param {Array<{type:'vertical'|'horizontal', value:number, label:string, color:string}>} annotations
 * @returns {object} Chart.js plugin object
 */
function annotationPlugin(annotations) {
  return {
    id: 'ballistics-annotations',
    afterDraw(chart) {
      if (!annotations.length) return;
      const { ctx, scales: { x, y }, chartArea } = chart;
      ctx.save();
      for (const ann of annotations) {
        if (ann.type === 'vertical') drawVLine(ctx, x, chartArea, ann);
        else                         drawHLine(ctx, y, chartArea, ann);
      }
      ctx.restore();
    }
  };
}

// ── Mobile sidebar drawer toggle ─────────────────────────────────────────────
function openSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  /* istanbul ignore else -- #sidebar is always present in the app shell */
  if (sidebar)  sidebar.classList.add('open');
  /* istanbul ignore else -- #sidebarBackdrop is always present in the app shell */
  if (backdrop) backdrop.classList.add('open');
}

function closeSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  /* istanbul ignore else -- #sidebar is always present in the app shell */
  if (sidebar)  sidebar.classList.remove('open');
  /* istanbul ignore else -- #sidebarBackdrop is always present in the app shell */
  if (backdrop) backdrop.classList.remove('open');
}

const crosshairPlugin = {
  id: 'ballistics-crosshair',
  afterDraw(chart) {
    if (crosshairIndex === null) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data[crosshairIndex]) return;
    const x = meta.data[crosshairIndex].x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.strokeStyle = crosshairPinned ? 'rgba(0,212,255,0.7)' : 'rgba(0,212,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }
};

// ── Range readout — populate the panel below the charts ──────────────────────
function updateReadout(results, dataIndex) {
  const panel = document.getElementById('rangeReadout');
  if (!panel) return;
  const first = results[0];
  if (!first?.points[dataIndex]) return;

  const range = first.points[dataIndex].rangeMeters;
  const rangeEl = document.getElementById('readoutRange');
  /* istanbul ignore else -- #readoutRange is always present in the app shell */
  if (rangeEl) rangeEl.textContent = `${range} m`;

  const tbody = document.getElementById('readoutBody');
  /* istanbul ignore else -- #readoutBody is always present in the app shell */
  if (tbody) {
    const sign = v => v > 0 ? '+' : '';
    tbody.innerHTML = results.map(r => {
      const p = r.points[dataIndex];
      if (!p) return '';
      const color = BULLET_COLORS[r.bullet.id] || '#4ADE80';
      return `<tr>
        <td><span class="bullet-dot" style="background:${color}"></span>${escapeHtml(r.bullet.name)}</td>
        <td>${sign(p.dropCm)}${p.dropCm} cm</td>
        <td>${p.velocityMps} m/s</td>
        <td>${p.energyJoules} J</td>
        <td>${sign(p.windDriftCm)}${p.windDriftCm} cm</td>
        ${p.spinDriftCm > 0 ? `<td>Spin Drift: ${p.spinDriftCm.toFixed(1)} cm</td>` : ''}
        ${p.coriolisDeflectionCm != null ? `<td>Coriolis: ${p.coriolisDeflectionCm >= 0 ? '+' : ''}${p.coriolisDeflectionCm.toFixed(1)} cm</td>` : ''}
      </tr>`;
    }).join('');
  }

  panel.style.display = 'block';
}

// ── Reset crosshair to initial (no hover, no pin) ────────────────────────────
function resetCrosshairState() {
  crosshairIndex  = null;
  crosshairPinned = false;
  const pinBtn = document.getElementById('readoutPin');
  /* istanbul ignore else -- #readoutPin is always present in the app shell */
  if (pinBtn) { pinBtn.textContent = 'PIN'; pinBtn.classList.remove('pinned'); }
  const readout = document.getElementById('rangeReadout');
  /* istanbul ignore else -- #rangeReadout is always present in the app shell */
  if (readout) readout.style.display = 'none';
}

// ── Render per-bullet stat cards into container ───────────────────────────────
function renderStatCards(results, container) {
  container.insertAdjacentHTML('beforeend', `
    <div class="stats-grid">
      ${results.map(r => {
        const color = BULLET_COLORS[r.bullet.id] || '#4ADE80';
        const daLine = r.densityAltitudeMeters !== undefined
          ? `<br><span style="color:var(--text)">${Number(r.densityAltitudeMeters)}</span> m density alt`
          : '';
        return `
        <div class="stat-card" style="--bullet-color:${color}">
          <div class="stat-label" style="color:${color}">${escapeHtml(r.bullet.name)}</div>
          <div class="stat-value">${Number(r.bullet.muzzleVelocityMps).toLocaleString()}</div>
          <div class="stat-unit">MV m/s &nbsp;·&nbsp; BC ${Number(r.bullet.ballisticCoefficient)} &nbsp;·&nbsp; ${Number(r.bullet.bulletWeightGrams)}g</div>
          <div style="margin-top:8px; font-family:'Share Tech Mono',monospace; font-size:9px; color:var(--text-dim); letter-spacing:1px; line-height:1.8">
            <span style="color:var(--text)">⚡ ${Number(r.bullet.muzzleEnergyJoules).toLocaleString()}</span> J muzzle energy<br>
            <span style="color:var(--text)">${Number(r.supersonicLimitMeters)}</span> m supersonic${daLine}<br>
            <span style="color:var(--text)">${Number(r.maxOrdinateCm)}</span> cm max ordinate @ ${Number(r.maxOrdinateRangeMeters)} m
          </div>
        </div>`;
      }).join('')}
    </div>`);
}

/**
 * Build a Chart.js config for one trajectory chart panel.
 *
 * @param {{ id: string, title: string, subtitle: string, yLabel: string,
 *           key: string, refLine?: { value: number, label: string, color: string } }} def
 *   Chart panel definition (id, axis labels, optional reference line).
 * @param {object[]} datasets  Pre-built Chart.js dataset array.
 * @param {object[]} results   Simulation results used by hover/click callbacks.
 * @returns {object} Chart.js config ready for `new Chart(ctx, config)`.
 */
function buildChartConfig(def, datasets, results) {
  const annotations = {};
  if (def.refLine) {
    annotations.refLine = {
      type: 'line', yMin: def.refLine.value, yMax: def.refLine.value,
      borderColor: def.refLine.color, borderWidth: 1, borderDash: [4, 4],
      label: {
        content: def.refLine.label, enabled: true, position: 'start',
        backgroundColor: 'transparent', color: def.refLine.color,
        font: { family: 'Share Tech Mono', size: 9 }
      }
    };
  }
  return {
    type: 'line',
    data: { datasets },
    plugins: [crosshairPlugin, annotationPlugin(def.annotations ?? [])],
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
      events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
      interaction: { mode: 'index', intersect: false },
      onHover: (event, elements) => {
        if (crosshairPinned) return;
        if (elements.length > 0) {
          crosshairIndex = elements[0].index;
          updateReadout(results, crosshairIndex);
        } else {
          crosshairIndex = null;
          const panel = document.getElementById('rangeReadout');
          /* istanbul ignore else -- #rangeReadout is always present in the app shell */
          if (panel) panel.style.display = 'none';
        }
        // Sync crosshair across all other charts
        Object.values(charts).forEach(c => {
          if (c !== charts[def.id]) c.update('none');
        });
      },
      onClick: (event, elements) => {
        if (elements.length === 0) return;
        crosshairPinned = !crosshairPinned;
        const btn = document.getElementById('readoutPin');
        /* istanbul ignore else -- #readoutPin is always present in the app shell */
        if (btn) {
          btn.textContent = crosshairPinned ? 'UNPIN' : 'PIN';
          btn.classList.toggle('pinned', crosshairPinned);
        }
        if (crosshairPinned) {
          crosshairIndex = elements[0].index;
          updateReadout(results, crosshairIndex);
        } else {
          crosshairIndex = null;
          const panel = document.getElementById('rangeReadout');
          /* istanbul ignore else -- #rangeReadout is always present in the app shell */
          if (panel) panel.style.display = 'none';
        }
        Object.values(charts).forEach(c => c.update('none'));
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Range (m)', color: '#3a5060',
                   font: { family: 'Share Tech Mono', size: 9 } },
          grid: { color: 'rgba(30,48,64,0.6)' },
          ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }
        },
        y: {
          title: { display: true, text: def.yLabel, color: '#3a5060',
                   font: { family: 'Share Tech Mono', size: 9 } },
          grid: { color: 'rgba(30,48,64,0.6)' },
          ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#c8dde8', font: { family: 'Rajdhani', size: 12, weight: '600' },
            usePointStyle: true, pointStyleWidth: 12
          }
        },
        tooltip: {
          backgroundColor: '#141d26', borderColor: '#1e3040', borderWidth: 1,
          titleFont: { family: 'Share Tech Mono', size: 10 },
          bodyFont:  { family: 'Share Tech Mono', size: 10 },
          titleColor: '#00d4ff', bodyColor: '#c8dde8',
          padding: 10, displayColors: true
        }
      }
    }
  };
}

// ── Wind chart subtitle helper ────────────────────────────────────────────────
/** Human-readable wind subtitle showing speed and compass direction. */
function windChartSubtitle(req) {
  if (!req.windSpeedKph) return 'no wind';
  const dir = req.windDirectionDeg ?? 90;
  const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
  const label = dirs[Math.round(dir / 45) % 8];
  return `${req.windSpeedKph} km/h from ${label}`;
}

// ── Results rendering (~30-line orchestrator) ─────────────────────────────────
function renderResults(rawResults, req) {
  const results = rawResults.filter(r => r?.bullet);
  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';
  const cc = document.getElementById('chartContainer');
  cc.innerHTML = '';
  // Update drag model status pill
  const modelEl = document.getElementById('modelStatus');
  /* istanbul ignore else -- #modelStatus is always present in the app shell */
  if (modelEl) modelEl.textContent = `MODEL: ${req.dragModel ?? 'G1'}`;

  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  resetCrosshairState();
  renderStatCards(results, cc);


  // Build annotation arrays from the first result (annotations are per-simulation)
  const first = results[0];
  const SONIC_COLOR = 'rgba(255,160,0,0.6)';
  const ORD_COLOR   = 'rgba(0,212,255,0.4)';
  const sonicAnn = first
    ? [{ type: 'vertical',   value: first.supersonicLimitMeters,  label: 'SUPERSONIC ←', color: SONIC_COLOR }]
    : [];
  const dropAnns = first
    ? [
        ...sonicAnn,
        { type: 'horizontal', value: first.maxOrdinateCm,           label: 'MAX ORD', color: ORD_COLOR },
        { type: 'vertical',   value: first.maxOrdinateRangeMeters,  label: 'PEAK',    color: ORD_COLOR },
      ]
    : [];

  const chartDefs = [
    { id: 'dropChart',     title: 'BULLET DROP',         subtitle: `zeroed at ${req.zeroRangeMeters} m`, yLabel: 'Drop (cm)',       key: 'dropCm',       annotations: dropAnns },
    { id: 'velocityChart', title: 'VELOCITY RETENTION',  subtitle: 'm/s downrange',                      yLabel: 'Velocity (m/s)', key: 'velocityMps',  annotations: sonicAnn,
      refLine: { value: 343, label: 'Transonic', color: 'rgba(255,100,0,0.4)' } },
    { id: 'energyChart',   title: 'KINETIC ENERGY',      subtitle: 'joules downrange',                   yLabel: 'Energy (J)',      key: 'energyJoules', annotations: sonicAnn },
    { id: 'windChart',     title: 'WIND DRIFT',           subtitle: windChartSubtitle(req), yLabel: 'Drift (cm)',     key: 'windDriftCm',  annotations: sonicAnn }
  ];

  chartDefs.forEach(def => {
    cc.insertAdjacentHTML('beforeend', `
      <div class="chart-panel">
        <div class="chart-header">
          <div>
            <div class="chart-title">${def.title}</div>
            <div class="chart-subtitle">${def.subtitle}</div>
          </div>
          <button class="export-btn" data-chart-id="${def.id}">PNG</button>
        </div>
        <div class="chart-wrap"><canvas id="${def.id}"></canvas></div>
      </div>`);
    cc.querySelector('.chart-panel:last-child .export-btn')
      ?.addEventListener('click', () => exportPNG(def.id));

    const datasets = results.map(r => ({
      label:            r.bullet.name,
      data:             r.points.map(p => ({ x: p.rangeMeters, y: p[def.key] })),
      borderColor:      BULLET_COLORS[r.bullet.id] || '#4ADE80',
      backgroundColor:  'transparent',
      borderWidth:      2,
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3
    }));

    // SH-1 FE: add spin drift as dashed series on the wind drift chart
    if (def.id === 'windChart') {
      const hasSpinDrift = results.some(r => r.points.some(p => p.spinDriftCm));
      if (hasSpinDrift) {
        results.forEach(r => {
          datasets.push({
            label:            r.bullet.name + ' (spin drift)',
            data:             r.points.map(p => ({ x: p.rangeMeters, y: p.spinDriftCm ?? 0 })),
            borderColor:      BULLET_COLORS[r.bullet.id] || '#4ADE80',
            backgroundColor:  'transparent',
            borderWidth:      1.5,
            borderDash:       [5, 5],
            pointRadius:      0,
            pointHoverRadius: 4,
            tension:          0.3,
          });
        });
      }
      // WA-13: add Coriolis drift series when present
      const hasCoriolisDrift = results.some(r => r.points.some(p => p.coriolisDeflectionCm));
      if (hasCoriolisDrift) {
        results.forEach(r => {
          datasets.push({
            label:            r.bullet.name + ' (coriolis)',
            data:             r.points.map(p => ({ x: p.rangeMeters, y: p.coriolisDeflectionCm ?? 0 })),
            borderColor:      BULLET_COLORS[r.bullet.id] || '#4ADE80',
            backgroundColor:  'transparent',
            borderWidth:      1.5,
            borderDash:       [2, 4],
            pointRadius:      0,
            pointHoverRadius: 4,
            tension:          0.3,
          });
        });
      }
    }

    const ctx = document.getElementById(def.id).getContext('2d');
    charts[def.id] = new Chart(ctx, buildChartConfig(def, datasets, results));

    // Item 4: forward touchmove as mousemove so the crosshair readout works
    // on both iOS (unreliable synthetic mouse events) and Android Chrome.
    // passive:false lets us call preventDefault() to suppress page scroll
    // while the user is scrubbing the chart.
    const canvas = document.getElementById(def.id);
    /* istanbul ignore else -- canvas is always present after chart creation */
    if (canvas) {
      canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        canvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: t.clientX, clientY: t.clientY,
          bubbles: true, cancelable: true,
        }));
      }, { passive: false });
    }
  });

  // MH-1: Elevation adjustment chart — dual y-axis (MOA left, MRAD right)
  {
    cc.insertAdjacentHTML('beforeend', `
      <div class="chart-panel">
        <div class="chart-header">
          <div>
            <div class="chart-title">ELEVATION ADJUSTMENT</div>
            <div class="chart-subtitle">click-up (MOA / MRAD) vs range</div>
          </div>
          <button class="export-btn" data-chart-id="adjustChart">PNG</button>
        </div>
        <div class="chart-wrap"><canvas id="adjustChart"></canvas></div>
      </div>`);
    cc.querySelector('.chart-panel:last-child .export-btn')
      ?.addEventListener('click', () => exportPNG('adjustChart'));

    const moaDatasets = results.map(r => ({
      label:            r.bullet.name + ' MOA',
      data:             r.points.map(p => { const a = computeAdjustments(p.dropCm, p.rangeMeters); return { x: p.rangeMeters, y: a.moa }; }),
      borderColor:      BULLET_COLORS[r.bullet.id] || '#4ADE80',
      backgroundColor:  'transparent',
      borderWidth:      2,
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3,
      yAxisID:          'yMoa',
    }));
    const mradDatasets = results.map(r => ({
      label:            r.bullet.name + ' MRAD',
      data:             r.points.map(p => { const a = computeAdjustments(p.dropCm, p.rangeMeters); return { x: p.rangeMeters, y: a.mrad }; }),
      borderColor:      BULLET_COLORS[r.bullet.id] || '#4ADE80',
      backgroundColor:  'transparent',
      borderWidth:      1.5,
      borderDash:       [4, 4],
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3,
      yAxisID:          'yMrad',
    }));

    const adjCtx = document.getElementById('adjustChart').getContext('2d');
    charts['adjustChart'] = new Chart(adjCtx, {
      type: 'line',
      data: { datasets: [...moaDatasets, ...mradDatasets] },
      plugins: [crosshairPlugin, annotationPlugin(sonicAnn)],
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
        events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
        interaction: { mode: 'index', intersect: false },
        onHover: (event, elements) => {
          if (crosshairPinned) return;
          if (elements.length > 0) {
            crosshairIndex = elements[0].index;
            updateReadout(results, crosshairIndex);
          } else {
            crosshairIndex = null;
            const panel = document.getElementById('rangeReadout');
            /* istanbul ignore else */
            if (panel) panel.style.display = 'none';
          }
          Object.values(charts).forEach(c => { if (c !== charts['adjustChart']) c.update('none'); });
        },
        onClick: (event, elements) => {
          if (elements.length === 0) return;
          crosshairPinned = !crosshairPinned;
          const btn = document.getElementById('readoutPin');
          /* istanbul ignore else */
          if (btn) { btn.textContent = crosshairPinned ? 'UNPIN' : 'PIN'; btn.classList.toggle('pinned', crosshairPinned); }
          if (crosshairPinned) { crosshairIndex = elements[0].index; updateReadout(results, crosshairIndex); }
          else { crosshairIndex = null; const panel = document.getElementById('rangeReadout'); /* istanbul ignore else */ if (panel) panel.style.display = 'none'; }
          Object.values(charts).forEach(c => c.update('none'));
        },
        scales: {
          x:     { type: 'linear', title: { display: true, text: 'Range (m)', color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { color: 'rgba(30,48,64,0.6)' }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
          yMoa:  { type: 'linear', position: 'left',  title: { display: true, text: 'MOA',  color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { color: 'rgba(30,48,64,0.6)' }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
          yMrad: { type: 'linear', position: 'right', title: { display: true, text: 'MRAD', color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } }, grid: { drawOnChartArea: false }, ticks: { color: '#3a5060', font: { family: 'Share Tech Mono', size: 9 } } },
        },
        plugins: {
          legend:  { labels: { color: '#c8dde8', font: { family: 'Rajdhani', size: 12, weight: '600' }, usePointStyle: true, pointStyleWidth: 12 } },
          tooltip: { backgroundColor: '#141d26', borderColor: '#1e3040', borderWidth: 1, titleFont: { family: 'Share Tech Mono', size: 10 }, bodyFont: { family: 'Share Tech Mono', size: 10 }, titleColor: '#00d4ff', bodyColor: '#c8dde8', padding: 10, displayColors: true },
        }
      }
    });

    const adjCanvas = document.getElementById('adjustChart');
    /* istanbul ignore else */
    if (adjCanvas) {
      adjCanvas.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        adjCanvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY, bubbles: true, cancelable: true }));
      }, { passive: false });
    }
  }

  sortColumn = null;
  sortDirection = 'asc';
  renderTable(results);
  renderDopeCard(results, req);
}

// ── Data table ────────────────────────────────────────────────────────────────
const SORTABLE_COLUMNS = Object.freeze({
  range:     (p, adj) => p.rangeMeters,
  drop:      (p, adj) => p.dropCm,
  velocity:  (p, adj) => p.velocityMps,
  energy:    (p, adj) => p.energyJoules,
  windDrift: (p, adj) => p.windDriftCm,
  time:      (p, adj) => p.timeOfFlightSec,
  moa:       (p, adj) => adj.moa,
  mrad:      (p, adj) => adj.mrad,
});

function renderTable(results) {
  tableResults = results;
  const tbody = document.getElementById('tableBody');

  const showCoriolis = results.some(r => r.points.some(p => p.coriolisDeflectionCm !== undefined && p.coriolisDeflectionCm !== 0));
  const coriolisHeader = document.getElementById('coriolisColHeader');
  /* istanbul ignore else -- #coriolisColHeader is always present in the app shell */
  if (coriolisHeader) coriolisHeader.style.display = showCoriolis ? '' : 'none';

  let rows = [];
  results.forEach(r => {
    r.points.forEach(p => {
      const adj = computeAdjustments(p.dropCm, p.rangeMeters);
      rows.push({ r, p, adj });
    });
  });

  if (sortColumn !== null) {
    const getValue = SORTABLE_COLUMNS[sortColumn];
    const dir = sortDirection === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const va = getValue(a.p, a.adj);
      const vb = getValue(b.p, b.adj);
      const aFin = Number.isFinite(va);
      const bFin = Number.isFinite(vb);
      if (!aFin && !bFin) return 0;
      if (!aFin) return 1;
      if (!bFin) return -1;
      return dir * (va - vb);
    });
  }

  const html = rows.map(({ r, p, adj }) => {
    const color = BULLET_COLORS[r.bullet.id] || '#4ADE80';
    return `
        <tr>
          <td><span class="bullet-tag" style="background:${color}"></span>${escapeHtml(r.bullet.name)}</td>
          <td>${p.rangeMeters}</td>
          <td>${p.dropCm > 0 ? '+' : ''}${p.dropCm} cm</td>
          <td>${p.velocityMps.toLocaleString()}</td>
          <td>${p.energyJoules.toLocaleString()}</td>
          <td>${p.windDriftCm > 0 ? '+' : ''}${p.windDriftCm} cm</td>
          <td>${p.timeOfFlightSec}s</td>
          <td>${adj.moa > 0 ? '+' : ''}${adj.moa}</td>
          <td>${adj.mrad > 0 ? '+' : ''}${adj.mrad}</td>
          ${showCoriolis ? `<td>${(p.coriolisDeflectionCm ?? 0) >= 0 ? '+' : ''}${(p.coriolisDeflectionCm ?? 0).toFixed(1)} cm</td>` : ''}
        </tr>`;
  });
  tbody.innerHTML = html.join('');
  updateSortIndicators();
}

function onSortHeaderClick(key) {
  if (tableResults === null || !(key in SORTABLE_COLUMNS)) return;
  if (sortColumn === key) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = key;
    sortDirection = 'asc';
  }
  renderTable(tableResults);
}

function updateSortIndicators() {
  document.querySelectorAll('#dataTable thead th[data-sort-key]').forEach(th => {
    const key = th.dataset.sortKey;
    const indicator = th.querySelector('.sort-indicator');
    if (key === sortColumn) {
      th.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending');
      /* istanbul ignore else -- sort-indicator is always present when data-sort-key is set */
      if (indicator) indicator.textContent = sortDirection === 'asc' ? '▲' : '▼';
    } else {
      th.removeAttribute('aria-sort');
      /* istanbul ignore else -- sort-indicator is always present when data-sort-key is set */
      if (indicator) indicator.textContent = '';
    }
  });
}

function _getSortState() {
  return { column: sortColumn, direction: sortDirection };
}

// ── Sweep mode (MH-4) ─────────────────────────────────────────────────────────
function updateSweepButtonVisibility() {
  const sweepControls = document.getElementById('sweepControls');
  if (sweepControls) sweepControls.style.display = selectedIds.size > 0 ? 'block' : 'none';
}

const SWEEP_RANGES = {
  wind:        [0, 10, 20, 30, 40],
  altitude:    [0, 500, 1000, 2000, 3000],
  temperature: [0, 10, 20, 30, 40],
};

function buildSweepRequests(baseReq, sweepParam, bulletId) {
  const values = SWEEP_RANGES[sweepParam] ?? SWEEP_RANGES.wind;
  return values.map(v => {
    const r = { ...baseReq, bulletIds: [bulletId] };
    if (sweepParam === 'wind')        r.windSpeedKph    = v;
    if (sweepParam === 'altitude')    r.altitudeMeters  = v;
    if (sweepParam === 'temperature') r.temperatureC    = v;
    return r;
  });
}

async function runSweep() {
  if (selectedIds.size === 0) return;
  const bulletId   = [...selectedIds][0];
  const sweepParam = document.getElementById('sweepParam')?.value ?? 'wind';
  const btn        = document.getElementById('sweepBtn');
  if (btn) btn.querySelector('span').textContent = '⏳ SWEEPING...';

  const base = lastReq ?? {
    bulletIds:            [bulletId],
    zeroRangeMeters:      +document.getElementById('zeroRange').value,
    maxRangeMeters:       +document.getElementById('maxRange').value,
    stepMeters:           +document.getElementById('step').value,
    windSpeedKph:         +document.getElementById('windSpeed').value,
    windDirectionDeg:     +document.getElementById('windDir').value,
    altitudeMeters:       +document.getElementById('altitude').value,
    temperatureC:         +document.getElementById('temperature').value,
    sightHeightMm:        +document.getElementById('sightHeight').value,
    shootingAngleDegrees: +document.getElementById('shootingAngle').value,
    dragModel:            document.getElementById('dragModel').value,
  };

  const requests = buildSweepRequests(base, sweepParam, bulletId);
  const bullet   = bullets.find(b => b.id === bulletId);

  let results;

  // 1. Try WASM batch first — all sweep variants computed in the worker
  if (bullet) {
    try {
      results = await Promise.all(
        requests.map(async r => {
          const res = await computeWithEngine(toEngineParams(bullet, r), toEngineBullet(bullet));
          return { ...res, bullet, request: r };
        })
      );
    } catch (err) {
      if (!(err instanceof WasmUnavailableError)) {
        console.warn('[engine] WASM sweep batch failed:', err?.message);
      }
      results = null; // fall through to API
    }
  }

  // 2. Fall back to API when WASM is unavailable
  if (!results) {
    try {
      const res = await fetch(`${API_BASE}/rpc`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jsonrpc: '2.0', method: 'trajectory.batch', id: 1, params: { requests } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error('RPC error');
      results = data.result;
    } catch {
      if (!bullet) { if (btn) btn.querySelector('span').textContent = 'SWEEP'; return; }
      results = await Promise.all(requests.map(r => simulateBulletJS(bullet, r)));
    }
  }

  sweepResults = results;
  sweepMode    = true;
  renderSweepCharts(results, sweepParam);

  if (btn) btn.querySelector('span').textContent = 'SWEEP';
  const clearBtn = document.getElementById('clearSweepBtn');
  if (clearBtn) clearBtn.style.display = 'block';
}

function clearSweep() {
  sweepMode    = false;
  sweepResults = null;
  const clearBtn = document.getElementById('clearSweepBtn');
  if (clearBtn) clearBtn.style.display = 'none';
  /* istanbul ignore else -- only callable after a simulation has run */
  if (lastResults.length) renderResults(lastResults, lastReq ?? {});
}

function renderSweepCharts(sweepResultsList, sweepParam) {
  const values = SWEEP_RANGES[sweepParam] ?? SWEEP_RANGES.wind;
  const labels = { wind: 'km/h', altitude: 'm alt', temperature: '°C' };
  const unit   = labels[sweepParam] ?? '';

  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';
  const cc = document.getElementById('chartContainer');
  cc.innerHTML = '';

  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  const sweepDefs = [
    { id: 'sweepDropChart', title: 'SWEEP — BULLET DROP', yLabel: 'Drop (cm)',      key: 'dropCm'      },
    { id: 'sweepWindChart', title: 'SWEEP — WIND DRIFT',  yLabel: 'Drift (cm)',     key: 'windDriftCm' },
    { id: 'sweepVelChart',  title: 'SWEEP — VELOCITY',    yLabel: 'Velocity (m/s)', key: 'velocityMps' },
  ];

  sweepDefs.forEach(def => {
    cc.insertAdjacentHTML('beforeend', `
      <div class="chart-panel">
        <div class="chart-header">
          <div>
            <div class="chart-title"></div>
            <div class="chart-subtitle"></div>
          </div>
          <button class="export-btn" data-chart-id="${def.id}">PNG</button>
        </div>
        <div class="chart-wrap"><canvas id="${def.id}"></canvas></div>
      </div>`);
    const panel = cc.querySelector('.chart-panel:last-child');
    panel.querySelector('.chart-title').textContent = def.title;
    panel.querySelector('.chart-subtitle').textContent = `${sweepParam} sweep (${values.join(', ')} ${unit})`;
    panel.querySelector('.export-btn')
      ?.addEventListener('click', () => exportPNG(def.id));

    const datasets = sweepResultsList.map((r, i) => ({
      label:            `${values[i]} ${unit}`,
      data:             r.points.map(p => ({ x: p.rangeMeters, y: p[def.key] })),
      borderColor:      SWEEP_COLORS[i % SWEEP_COLORS.length],
      backgroundColor:  'transparent',
      borderWidth:      2,
      pointRadius:      0,
      pointHoverRadius: 4,
      tension:          0.3,
    }));

    const ctx = document.getElementById(def.id).getContext('2d');
    charts[def.id] = new Chart(ctx, buildChartConfig(def, datasets, sweepResultsList));
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('chartsPanel').classList.toggle('active', name === 'charts');
  document.getElementById('dataPanel').classList.toggle('active', name === 'data');
  document.getElementById('toolsPanel')?.classList.toggle('active', name === 'tools');
}

// ── URL state sharing ─────────────────────────────────────────────────────────
/** Snapshot of the sidebar: reads the 10 required inputs + optional lat/az, and [...selectedIds]. */
function currentState() {
  const get = id => document.getElementById(id);
  const latVal = get('latitudeDeg')?.value;
  const azVal  = get('azimuthDeg')?.value;
  /* istanbul ignore next -- each element is always present in the app shell */
  return {
    bulletIds:   [...selectedIds],
    zero:        +(get('zeroRange')?.value     ?? PREF_DEFAULTS.zero),
    maxRange:    +(get('maxRange')?.value      ?? PREF_DEFAULTS.maxRange),
    wind:        +(get('windSpeed')?.value     ?? PREF_DEFAULTS.wind),
    windDir:     +(get('windDir')?.value       ?? PREF_DEFAULTS.windDir),
    altitude:    +(get('altitude')?.value      ?? PREF_DEFAULTS.altitude),
    temp:        +(get('temperature')?.value   ?? PREF_DEFAULTS.temp),
    step:        +(get('step')?.value          ?? PREF_DEFAULTS.step),
    sightHeight: +(get('sightHeight')?.value   ?? PREF_DEFAULTS.sightHeight),
    angle:       +(get('shootingAngle')?.value ?? PREF_DEFAULTS.angle),
    dragModel:     get('dragModel')?.value     ?? PREF_DEFAULTS.dragModel,
    ...(latVal !== undefined && latVal !== '' ? { latitudeDeg: +latVal } : {}),
    ...(azVal  !== undefined && azVal  !== '' ? { azimuthDeg:  +azVal  } : {}),
  };
}

/** Update the address bar via replaceState. Never pushState. */
function syncUrl() {
  const qs = mergeIntoSearch(location.search, currentState());
  /* istanbul ignore next -- qs is always non-empty (encodeState always emits 10 keys) */
  const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
  history.replaceState(history.state, '', url);
}

/** Click handler for #copyLinkBtn. Returns the promise for tests. */
async function copyLink() {
  syncUrl();
  const url = location.origin + location.pathname + '?' + mergeIntoSearch(location.search, currentState());
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      showToast('Link copied');
    } else {
      showToast("Couldn't copy. Use the link in the address bar.");
    }
  } catch {
    showToast("Couldn't copy. Use the link in the address bar.");
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
let _initListenerController = null;

async function init() {
  if (_initListenerController) _initListenerController.abort();
  _initListenerController = new AbortController();
  const { signal } = _initListenerController;
  // Service Worker registration (requires HTTPS or localhost; see sw.js)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { type: 'module' })
      .catch(err => console.warn('SW registration failed:', err));
  }

  // Online/offline indicator
  window.addEventListener('offline', () => setOfflineMode(true), { signal });
  window.addEventListener('online', probeServer, { signal });
  if (!navigator.onLine) setOfflineMode(true);

  onBusyChange(_setComputing);
  startEngine().then(tier => { document.documentElement.dataset.engineTier = tier; });
  window.addEventListener('pagehide', shutdownEngine, { signal });
  window.addEventListener('pageshow', e => {
    if (e.persisted) startEngine().then(tier => { document.documentElement.dataset.engineTier = tier; });
  }, { signal });

  // Load saved preferences and URL params; URL takes per-key precedence over localStorage
  const fromUrl = decodeState(window.location.search);
  const merged  = { ...loadPrefs(), ...fromUrl.params };
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('zeroRange',     merged.zero);
  setVal('maxRange',      merged.maxRange);
  setVal('windSpeed',     merged.wind);
  setVal('windDir',       merged.windDir);
  setVal('altitude',      merged.altitude);
  setVal('temperature',   merged.temp);
  setVal('step',          merged.step);
  setVal('sightHeight',   merged.sightHeight);
  setVal('shootingAngle', merged.angle);
  setVal('dragModel',     merged.dragModel);
  if (fromUrl.params.latitudeDeg != null) setVal('latitudeDeg', fromUrl.params.latitudeDeg);
  if (fromUrl.params.azimuthDeg  != null) setVal('azimuthDeg',  fromUrl.params.azimuthDeg);

  try {
    const res = await fetch(`${API_BASE}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'bullets.list', id: 1 }),
    });
    const data = await res.json();
    if (data.error) throw new Error('RPC error');
    bullets = data.result;
  } catch (e) {
    console.warn('API offline — using mock data for preview');
    bullets = getMockBullets();
    setOfflineMode(true);
  }
  renderBulletList();

  // Restore bullet selection: URL params take precedence over saved prefs
  {
    const validIds = new Set(bullets.map(b => b.id));
    let usedUrlBullets = false;
    if (fromUrl.bulletIds !== null) {
      const filtered = fromUrl.bulletIds.filter(id => validIds.has(id));
      if (filtered.length > 0) {
        selectedIds = new Set(filtered);
        usedUrlBullets = true;
      }
    }
    if (!usedUrlBullets) {
      if (merged.selectedIds !== null) {
        selectedIds = new Set(merged.selectedIds.filter(id => validIds.has(id)));
      } else {
        bullets.forEach(b => selectedIds.add(b.id));
      }
    }
  }
  updateBulletCards();

  // Persist parameter changes automatically and sync URL
  const paramInputIds = ['zeroRange','maxRange','windSpeed','windDir','altitude','temperature','step','sightHeight','shootingAngle','dragModel'];
  paramInputIds.forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => { savePrefs(); syncUrl(); });
  });

  // Wire up static event listeners (replaces window.* globals and onclick attrs)
  document.getElementById('retryBtn')?.addEventListener('click', probeServer);
  document.getElementById('runBtn')?.addEventListener('click', () => { closeSidebar(); runSimulation(); });
  document.querySelector('.export-csv-btn')?.addEventListener('click', exportCSV);
  document.querySelector('.export-json-btn')?.addEventListener('click', exportJSON);
  document.querySelector('.export-md-btn')?.addEventListener('click', exportMarkdown);
  document.querySelector('.export-toggle')?.addEventListener('click', function() {
    this.closest('.export-dropdown')?.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.export-dropdown')) {
      document.querySelectorAll('.export-dropdown.open')
        .forEach(d => d.classList.remove('open'));
    }
  });
  document.getElementById('runCustomBtn')?.addEventListener('click', () => { closeSidebar(); runCustom(); });
  document.getElementById('copyLinkBtn')?.addEventListener('click', copyLink);

  const handlers = {
    onLoad(p) {
      document.getElementById('customName').value   = p.name;
      document.getElementById('customWeight').value = p.weightG;
      document.getElementById('customMV').value     = p.mvMps;
      document.getElementById('customBC').value     = p.bc;
      document.getElementById('customDia').value    = p.diaMm;
      showCustomError('');
    },
    onDelete(id) {
      renderPresetList(deletePreset(id), handlers);
    },
  };
  document.getElementById('savePresetBtn')?.addEventListener('click', () => {
    const name    = document.getElementById('customName').value;
    const weightG = +document.getElementById('customWeight').value;
    const mvMps   = +document.getElementById('customMV').value;
    const bc      = +document.getElementById('customBC').value;
    const diaMm   = +document.getElementById('customDia').value;
    const result  = savePreset({ name, weightG, mvMps, bc, diaMm });
    if (result.ok) {
      showCustomError('');
      renderPresetList(result.presets, handlers);
      showToast(result.replaced ? 'Preset updated' : 'Preset saved');
    } else if (result.error === 'full') {
      showToast('Preset library full (20). Delete one to save another.');
    } else if (result.error === 'invalid') {
      showCustomError(result.message);
    } else {
      showToast("Couldn't save preset: browser storage unavailable");
    }
  });
  renderPresetList(loadPresets(), handlers);

  document.querySelector('#dataTable thead')?.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort-key]');
    if (th) onSortHeaderClick(th.dataset.sortKey);
  });

  // Mobile drawer: FAB opens sidebar; backdrop tap closes it
  document.getElementById('paramsToggle')?.addEventListener('click', openSidebar);
  document.getElementById('sidebarBackdrop')?.addEventListener('click', closeSidebar);
  document.getElementById('tab-charts')?.addEventListener('click', function() { switchTab('charts', this); });
  document.getElementById('tab-data')?.addEventListener('click', function() { switchTab('data', this); });
  document.getElementById('tab-tools')?.addEventListener('click', function() { switchTab('tools', this); });

  // Normalize address bar if URL had recognized params
  if (fromUrl.recognized) syncUrl();

  // MH-4: Sweep controls
  updateSweepButtonVisibility();
  document.getElementById('sweepBtn')?.addEventListener('click', runSweep);
  document.getElementById('clearSweepBtn')?.addEventListener('click', clearSweep);

  // SH-1 FE: twist rate input persists to URL/prefs
  document.getElementById('twistRate')?.addEventListener('input', syncUrl);

  // WA-13: Coriolis inputs persist to URL
  document.getElementById('latitudeDeg')?.addEventListener('input', syncUrl, { signal });
  document.getElementById('azimuthDeg')?.addEventListener('input', syncUrl, { signal });

  // MH-3, SH-2: Tools tab
  initDopeCard(simulateBullet);
  initBcSolver(simulateBullet);

  // WA-12: Load custom drag table from localStorage on startup
  try {
    const stored = localStorage.getItem(CUSTOM_DRAG_TABLE_KEY);
    if (stored) {
      const arr = JSON.parse(stored);
      if (!Array.isArray(arr) || arr.length < 3 || arr.length > 100) throw new Error('invalid');
      for (const p of arr) {
        if (!Number.isFinite(p.mach) || p.mach < 0 || p.mach > 5) throw new Error('invalid');
        if (!Number.isFinite(p.cd)   || p.cd   < 0.001 || p.cd > 2) throw new Error('invalid');
      }
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].mach <= arr[i - 1].mach) throw new Error('invalid');
      }
      if (!arr.some(p => p.mach <= 0.5))  throw new Error('invalid');
      if (!arr.some(p => p.mach >= 2.0))  throw new Error('invalid');
      _customDragTable = arr.map(p => ({ mach: p.mach, cd: p.cd }));
      _updateDragTableStatus();
    }
  } catch (_) {
    _customDragTable = null;
    try { localStorage.removeItem(CUSTOM_DRAG_TABLE_KEY); } catch (_2) {}
  }

  // WA-12: Wire file input for custom drag table
  document.getElementById('dragTableFile')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const helpEl = document.getElementById('dragTableHelp');
    if (file.size > 64 * 1024) {
      /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
      if (helpEl) helpEl.textContent = 'File too large (max 64 KB).';
      return;
    }
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const table = parseDragCsv(evt.target.result);
        _customDragTable = table;
        try { localStorage.setItem(CUSTOM_DRAG_TABLE_KEY, JSON.stringify(table)); } catch (_) {}
        _updateDragTableStatus(file.name, table.length);
        /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
        if (helpEl) helpEl.textContent = 'Loaded — requires server update to apply; results currently use the selected drag model.';
      } catch (err) {
        _customDragTable = null;
        try { localStorage.removeItem(CUSTOM_DRAG_TABLE_KEY); } catch (_) {}
        /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
        if (helpEl) helpEl.textContent = err.message;
      }
    };
    reader.onerror = () => {
      /* istanbul ignore else -- #dragTableHelp is always present in the app shell */
      if (helpEl) helpEl.textContent = 'Error reading file.';
    };
    reader.readAsText(file);
  }, { signal });

  // WA-12: Wire clear button
  document.getElementById('dragTableClearBtn')?.addEventListener('click', _clearCustomDragTable, { signal });

  // Pin button toggles crosshair lock (chart onClick also toggles)
  document.getElementById('readoutPin')?.addEventListener('click', () => {
    crosshairPinned = !crosshairPinned;
    const btn = document.getElementById('readoutPin');
    /* istanbul ignore else -- #readoutPin is always present in the app shell */
    if (btn) {
      btn.textContent = crosshairPinned ? 'UNPIN' : 'PIN';
      btn.classList.toggle('pinned', crosshairPinned);
    }
    if (!crosshairPinned) {
      crosshairIndex = null;
      const panel = document.getElementById('rangeReadout');
      /* istanbul ignore else -- #rangeReadout is always present in the app shell */
      if (panel) panel.style.display = 'none';
      Object.values(charts).forEach(c => c.update('none'));
    }
  });
}

// ── localStorage preference persistence ──────────────────────────────────────

/** Keys used in localStorage (all prefixed `bv_`). */
const PREF_KEYS = {
  selectedIds: 'bv_selectedIds',
  zero:        'bv_zero',
  maxRange:    'bv_maxRange',
  wind:        'bv_wind',
  windDir:     'bv_windDir',
  altitude:    'bv_altitude',
  temp:        'bv_temp',
  step:        'bv_step',
  sightHeight: 'bv_sightHeight',
  angle:       'bv_angle',
  dragModel:   'bv_dragModel',
};

/** Default values when a key is absent from storage. */
const PREF_DEFAULTS = {
  selectedIds: null,   // null = first visit → select all bullets
  zero:        100,
  maxRange:    1000,
  wind:        16,
  windDir:     90,     // 90° = from East = pure right crosswind (full-value, legacy behaviour)
  altitude:    0,
  temp:        15,
  step:        25,
  sightHeight: 38.1,
  angle:       0,
  dragModel:   'G1',  // G1 = standard flat-base/spitzer; G7 = boat-tail long-range
};

/** Maps PREF_DEFAULTS keys to their DOM input element IDs (selectedIds has no input). */
const DOM_ID_FOR_PREF = {
  zero:        'zeroRange',
  maxRange:    'maxRange',
  wind:        'windSpeed',
  windDir:     'windDir',
  altitude:    'altitude',
  temp:        'temperature',
  step:        'step',
  sightHeight: 'sightHeight',
  angle:       'shootingAngle',
  dragModel:   'dragModel',
};

/**
 * Persist current parameter inputs and selected bullet IDs to localStorage.
 * Wrapped in try/catch: silently degrades in private-browsing or when quota is full.
 */
function savePrefs() {
  try {
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify([...selectedIds]));
    for (const k of Object.keys(PREF_DEFAULTS).filter(k => k !== 'selectedIds')) {
      const domId = DOM_ID_FOR_PREF[k];
      /* istanbul ignore next -- null branch only reached when a pref has no DOM element */
      const value = (domId ? document.getElementById(domId)?.value : null)
                    ?? String(PREF_DEFAULTS[k]);
      localStorage.setItem(PREF_KEYS[k], value);
    }
  } catch (e) {
    console.warn('localStorage unavailable — preferences not saved', e);
  }
}

/**
 * Read persisted preferences from localStorage and return a typed object.
 * Returns defaults for any missing or unparseable entries.
 * Wrapped in try/catch: returns all defaults if storage is unavailable.
 */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEYS.selectedIds);
    let savedIds;
    try {
      savedIds = raw !== null ? JSON.parse(raw) : null;
      if (!Array.isArray(savedIds)) savedIds = null;
    } catch (_) { savedIds = null; }

    const prefs = { selectedIds: savedIds };
    for (const k of Object.keys(PREF_DEFAULTS).filter(k => k !== 'selectedIds')) {
      const stored = localStorage.getItem(PREF_KEYS[k]);
      prefs[k] = typeof PREF_DEFAULTS[k] === 'number'
        ? +(stored ?? PREF_DEFAULTS[k])
        : (stored ?? PREF_DEFAULTS[k]);
    }
    return prefs;
  } catch (e) {
    console.warn('localStorage unavailable — using defaults', e);
    return { ...PREF_DEFAULTS };
  }
}

// ── State helpers (for test access) ──────────────────────────────────────────
function _getState()     { return { bullets, selectedIds, lastResults, charts, crosshairIndex, crosshairPinned, offlineMode, retryTimer }; }
function _resetState()   {
  bullets = []; selectedIds = new Set(); lastResults = []; charts = {};
  crosshairIndex = null; crosshairPinned = false;
  offlineMode = false;
  sortColumn = null; sortDirection = 'asc'; tableResults = null;
  sweepMode = false; sweepResults = null; lastReq = null;
  _customDragTable = null;
  _customDragWarnFired = false;
  if (retryTimer !== null) { clearInterval(retryTimer); retryTimer = null; }
  if (_computingTimer !== null) { clearTimeout(_computingTimer); _computingTimer = null; }
  if (_initListenerController) { _initListenerController.abort(); _initListenerController = null; }
  const overlay = document.getElementById('computingOverlay');
  const main = document.querySelector('main.main');
  if (overlay) overlay.setAttribute('hidden', '');
  if (main) main.removeAttribute('aria-busy');
}
function _setBullets(b)      { bullets = b; }
function _setSelectedIds(s)  { selectedIds = s; }
function _setCharts(c)       { charts = c; }
function _setLastResults(r)  { lastResults = r; }

// Auto-initialize in browser (modules are deferred, so DOM is ready).
// Guard prevents spurious calls when imported by tests before buildDOM().
if (document.getElementById('bulletList')) {
  init();
}

export {
  EARTH_ROTATION_RADS,
  getMockBullets, interpolateDragTable, g1Drag, airDensityRatio,
  findZeroAngleFps, integrateTrajectoryFps, computeClientSide,
  renderBulletList, toggleBullet, updateBulletCards, runSimulation, streamCompare,
  resetCrosshairState, renderStatCards, buildChartConfig,
  renderResults, renderTable, updateReadout, switchTab, init,
  onSortHeaderClick, updateSortIndicators, _getSortState, SORTABLE_COLUMNS,
  exportCSV, exportJSON, exportMarkdown, exportPNG, runCustom, setOfflineMode, probeServer, showToast,
  _downloadBlob,
  BULLET_COLORS, SWEEP_COLORS, escapeHtml, csvCell, computeAdjustments, crosshairPlugin,
  drawVLine, drawHLine, annotationPlugin, windChartSubtitle,
  savePrefs, loadPrefs, PREF_KEYS, PREF_DEFAULTS,
  openSidebar, closeSidebar,
  currentState, syncUrl, copyLink,
  updateSweepButtonVisibility, buildSweepRequests, runSweep, clearSweep, renderSweepCharts,
  SWEEP_RANGES,
  _getState, _resetState, _setBullets, _setSelectedIds, _setCharts, _setLastResults,
  _parseRejection, _setSimulationError,
  _updateDragTableStatus, _clearCustomDragTable, CUSTOM_DRAG_TABLE_KEY,
};
