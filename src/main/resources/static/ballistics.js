import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend } from 'chart.js';
import BULLET_CATALOG from 'virtual:bullet-catalog';
import { G1_TABLE, G7_TABLE, ATMOSPHERE } from 'virtual:physics-tables';
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = '/api';

// Derived from bullets.yaml via virtual:bullet-catalog at build time
const BULLET_COLORS = Object.fromEntries(BULLET_CATALOG.map(b => [b.id, b.hexColor]));

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

// ── Module state ──────────────────────────────────────────────────────────────
let bullets = [];
let selectedIds = new Set();
let lastResults = [];
let charts = {};
let offlineMode = false;
let retryTimer  = null;
// Crosshair state (task 5)
let crosshairIndex  = null;  // data-point index currently under the cursor
let crosshairPinned = false; // true after user clicks a range to lock the readout

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

function simulateBullet(bullet, req) {
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

  return {
    bullet,
    request:               req,
    points,
    maxOrdinateCm:          Math.round(maxOrdIn * CM_PER_INCH * 10) / 10,
    maxOrdinateRangeMeters: Math.round(maxOrdRangeYd * M_PER_YARD * 10) / 10,
    supersonicLimitMeters:  Math.round(supersonicLimYd * M_PER_YARD * 10) / 10
  };
}

// ── Compute trajectories client-side for all selected bullet IDs ──────────────
function computeClientSide(req) {
  return req.bulletIds.map(id => {
    const bullet = bullets.find(b => b.id === id);
    if (!bullet) return null;
    return simulateBullet(bullet, req);
  }).filter(Boolean);
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

// ── Simulation ────────────────────────────────────────────────────────────────
async function runSimulation() {
  if (selectedIds.size === 0) { alert('Select at least one round.'); return; }
  const btn   = document.getElementById('runBtn');
  btn.classList.add('loading');

  const req = {
    bulletIds:              [...selectedIds],
    zeroRangeMeters:        +document.getElementById('zeroRange').value,
    maxRangeMeters:         +document.getElementById('maxRange').value,
    stepMeters:             +document.getElementById('step').value,
    windSpeedKph:           +document.getElementById('windSpeed').value,
    windDirectionDeg:       +document.getElementById('windDir').value,
    altitudeMeters:         +document.getElementById('altitude').value,
    temperatureC:           +document.getElementById('temperature').value,
    sightHeightMm:          +document.getElementById('sightHeight').value,
    shootingAngleDegrees:   +document.getElementById('shootingAngle').value,
    dragModel:              document.getElementById('dragModel').value
  };
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
        try {
          const res = await fetch(`${API_BASE}/trajectories/compare`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(req)
          });
          (await res.json()).forEach(r => results.push(r));
          setOfflineMode(false);
        } catch (_batchErr) {
          computeClientSide(req).forEach(r => results.push(r));
          setOfflineMode(true);
        }
        renderResults(results, req);
      }
    }
    lastResults = results;
  } catch (err) {
    console.error(err);
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = '▶ COMPUTE TRAJECTORIES';
  }
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
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'trajectory.csv';
  a.click();
  URL.revokeObjectURL(url);
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

  if (!(weight > 0))           return showCustomError('Weight must be greater than 0');
  if (!(mv > 0))               return showCustomError('Muzzle velocity must be greater than 0');
  if (!(bc > 0 && bc <= 1.2))  return showCustomError('BC must be between 0 and 1.2');
  if (!(dia > 0))              return showCustomError('Diameter must be greater than 0');
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
    dragModel:             document.getElementById('dragModel').value
  };

  let result;
  try {
    const res = await fetch(`${API_BASE}/trajectories/custom`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req)
    });
    result = await res.json();
  } catch (e) {
    // offline fallback
    const bullet = {
      id: 'custom', name, caliber: 'Custom',
      bulletWeightGrams: weight, muzzleVelocityMps: mv,
      ballisticCoefficient: bc, bulletDiameterMm: dia,
      muzzleEnergyJoules: Math.round(0.5 * (weight / 1000) * mv * mv)
    };
    result = simulateBullet(bullet, { ...req, bulletIds: ['custom'] });
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
    const res = await fetch(`${API_BASE}/bullets`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    bullets = await res.json();
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
        return `
        <div class="stat-card" style="--bullet-color:${color}">
          <div class="stat-label" style="color:${color}">${escapeHtml(r.bullet.name)}</div>
          <div class="stat-value">${Number(r.bullet.muzzleVelocityMps).toLocaleString()}</div>
          <div class="stat-unit">MV m/s &nbsp;·&nbsp; BC ${Number(r.bullet.ballisticCoefficient)} &nbsp;·&nbsp; ${Number(r.bullet.bulletWeightGrams)}g</div>
          <div style="margin-top:8px; font-family:'Share Tech Mono',monospace; font-size:9px; color:var(--text-dim); letter-spacing:1px; line-height:1.8">
            <span style="color:var(--text)">⚡ ${Number(r.bullet.muzzleEnergyJoules).toLocaleString()}</span> J muzzle energy<br>
            <span style="color:var(--text)">${Number(r.supersonicLimitMeters)}</span> m supersonic<br>
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
function renderResults(results, req) {
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

    const ctx = document.getElementById(def.id).getContext('2d');
    charts[def.id] = new Chart(ctx, buildChartConfig(def, datasets, results));
  });

  renderTable(results);
}

// ── Data table ────────────────────────────────────────────────────────────────
function renderTable(results) {
  const tbody = document.getElementById('tableBody');
  const rows = [];
  results.forEach(r => {
    r.points.forEach(p => {
      const color = BULLET_COLORS[r.bullet.id] || '#4ADE80';
      const adj = computeAdjustments(p.dropCm, p.rangeMeters);
      rows.push(`
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
        </tr>`);
    });
  });
  tbody.innerHTML = rows.join('');
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('chartsPanel').classList.toggle('active', name === 'charts');
  document.getElementById('dataPanel').classList.toggle('active', name === 'data');
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Load saved preferences and apply to inputs before fetching bullets
  const prefs = loadPrefs();
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('zeroRange',     prefs.zero);
  setVal('maxRange',      prefs.maxRange);
  setVal('windSpeed',     prefs.wind);
  setVal('windDir',       prefs.windDir);
  setVal('altitude',      prefs.altitude);
  setVal('temperature',   prefs.temp);
  setVal('step',          prefs.step);
  setVal('sightHeight',   prefs.sightHeight);
  setVal('shootingAngle', prefs.angle);
  setVal('dragModel',     prefs.dragModel);

  try {
    const res = await fetch(`${API_BASE}/bullets`);
    bullets = await res.json();
  } catch (e) {
    console.warn('API offline — using mock data for preview');
    bullets = getMockBullets();
    setOfflineMode(true);
  }
  renderBulletList();

  // Restore bullet selection: null = first visit → select all; otherwise restore saved set
  if (prefs.selectedIds !== null) {
    // Only restore IDs that still exist in the catalog (handles catalog changes gracefully)
    const validIds = new Set(bullets.map(b => b.id));
    selectedIds = new Set(prefs.selectedIds.filter(id => validIds.has(id)));
  } else {
    bullets.forEach(b => selectedIds.add(b.id));
  }
  updateBulletCards();

  // Persist parameter changes automatically
  const paramInputIds = ['zeroRange','maxRange','windSpeed','windDir','altitude','temperature','step','sightHeight','shootingAngle','dragModel'];
  paramInputIds.forEach(id => {
    document.getElementById(id)?.addEventListener('input', savePrefs);
  });

  // Wire up static event listeners (replaces window.* globals and onclick attrs)
  document.getElementById('retryBtn')?.addEventListener('click', probeServer);
  document.getElementById('runBtn')?.addEventListener('click', runSimulation);
  document.querySelector('.export-csv-btn')?.addEventListener('click', exportCSV);
  document.getElementById('runCustomBtn')?.addEventListener('click', runCustom);
  document.getElementById('tab-charts')?.addEventListener('click', function() { switchTab('charts', this); });
  document.getElementById('tab-data')?.addEventListener('click', function() { switchTab('data', this); });

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

/**
 * Persist current parameter inputs and selected bullet IDs to localStorage.
 * Wrapped in try/catch: silently degrades in private-browsing or when quota is full.
 */
function savePrefs() {
  try {
    const get = id => document.getElementById(id)?.value;
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify([...selectedIds]));
    localStorage.setItem(PREF_KEYS.zero,        get('zeroRange')     ?? String(PREF_DEFAULTS.zero));
    localStorage.setItem(PREF_KEYS.maxRange,    get('maxRange')      ?? String(PREF_DEFAULTS.maxRange));
    localStorage.setItem(PREF_KEYS.wind,        get('windSpeed')     ?? String(PREF_DEFAULTS.wind));
    localStorage.setItem(PREF_KEYS.windDir,     get('windDir')       ?? String(PREF_DEFAULTS.windDir));
    localStorage.setItem(PREF_KEYS.altitude,    get('altitude')      ?? String(PREF_DEFAULTS.altitude));
    localStorage.setItem(PREF_KEYS.temp,        get('temperature')   ?? String(PREF_DEFAULTS.temp));
    localStorage.setItem(PREF_KEYS.step,        get('step')          ?? String(PREF_DEFAULTS.step));
    localStorage.setItem(PREF_KEYS.sightHeight, get('sightHeight')   ?? String(PREF_DEFAULTS.sightHeight));
    localStorage.setItem(PREF_KEYS.angle,       get('shootingAngle') ?? String(PREF_DEFAULTS.angle));
    localStorage.setItem(PREF_KEYS.dragModel,   get('dragModel')     ?? PREF_DEFAULTS.dragModel);
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
    } catch (_) {
      savedIds = null;
    }
    return {
      selectedIds: savedIds,
      zero:        +(localStorage.getItem(PREF_KEYS.zero)        ?? PREF_DEFAULTS.zero),
      maxRange:    +(localStorage.getItem(PREF_KEYS.maxRange)    ?? PREF_DEFAULTS.maxRange),
      wind:        +(localStorage.getItem(PREF_KEYS.wind)        ?? PREF_DEFAULTS.wind),
      windDir:     +(localStorage.getItem(PREF_KEYS.windDir)     ?? PREF_DEFAULTS.windDir),
      altitude:    +(localStorage.getItem(PREF_KEYS.altitude)    ?? PREF_DEFAULTS.altitude),
      temp:        +(localStorage.getItem(PREF_KEYS.temp)        ?? PREF_DEFAULTS.temp),
      step:        +(localStorage.getItem(PREF_KEYS.step)        ?? PREF_DEFAULTS.step),
      sightHeight: +(localStorage.getItem(PREF_KEYS.sightHeight) ?? PREF_DEFAULTS.sightHeight),
      angle:       +(localStorage.getItem(PREF_KEYS.angle)       ?? PREF_DEFAULTS.angle),
      dragModel:     localStorage.getItem(PREF_KEYS.dragModel)   ?? PREF_DEFAULTS.dragModel,
    };
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
  if (retryTimer !== null) { clearInterval(retryTimer); retryTimer = null; }
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
  getMockBullets, interpolateDragTable, g1Drag, airDensityRatio,
  findZeroAngleFps, integrateTrajectoryFps, simulateBullet, computeClientSide,
  renderBulletList, toggleBullet, updateBulletCards, runSimulation, streamCompare,
  resetCrosshairState, renderStatCards, buildChartConfig,
  renderResults, renderTable, updateReadout, switchTab, init,
  exportCSV, exportPNG, runCustom, setOfflineMode, probeServer, showToast,
  BULLET_COLORS, escapeHtml, csvCell, computeAdjustments, crosshairPlugin,
  drawVLine, drawHLine, annotationPlugin, windChartSubtitle,
  savePrefs, loadPrefs, PREF_KEYS, PREF_DEFAULTS,
  _getState, _resetState, _setBullets, _setSelectedIds, _setCharts, _setLastResults,
};
