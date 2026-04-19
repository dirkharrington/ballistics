import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend } from 'chart.js';
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = '/api';

const BULLET_COLORS = {
  '223-rem-55gr':       '#4ADE80',
  '308-win-168gr':      '#F97316',
  '3006-150gr':         '#60A5FA',
  '65-creedmoor-140gr': '#E879F9',
  '243-win-95gr':         '#34D399',
  '270-win-130gr':        '#FBBF24',
  '7mm-rem-mag-160gr':    '#F87171',
  '338-lapua-250gr':      '#A78BFA',
  '6mm-creedmoor-108gr':  '#2DD4BF',
  '300-win-mag-190gr':    '#FB923C'
};

// G1 drag table: [velocity fps, form-factor F(v)] — linearly interpolated
const G1_TABLE = [
  [0,0.1198],[400,0.1198],[500,0.1197],[600,0.1196],[700,0.1194],[800,0.1193],
  [900,0.1194],[950,0.1202],[1000,0.1250],[1050,0.1315],[1100,0.1420],
  [1150,0.1550],[1200,0.1700],[1250,0.1820],[1300,0.1920],[1350,0.1990],
  [1400,0.2030],[1450,0.2020],[1500,0.1990],[1600,0.1920],[1700,0.1840],
  [1800,0.1750],[1900,0.1660],[2000,0.1580],[2100,0.1500],[2200,0.1425],
  [2300,0.1355],[2400,0.1295],[2500,0.1240],[2600,0.1188],[2700,0.1140],
  [2800,0.1096],[2900,0.1056],[3000,0.1020],[3100,0.0986],[3200,0.0955],
  [3300,0.0926],[3400,0.0900],[3500,0.0878],[4000,0.0800]
];

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

// ── Mock data (offline fallback) ──────────────────────────────────────────────
function getMockBullets() {
  return [
    { id: '223-rem-55gr',        name: '.223 Rem 55gr FMJ',           caliber: '.223 Remington',        bulletWeightGrams: 3.56,  muzzleVelocityMps: 987.6, ballisticCoefficient: 0.243, muzzleEnergyJoules: 1738, bulletDiameterMm: 5.69 },
    { id: '308-win-168gr',       name: '.308 Win 168gr BTHP',          caliber: '.308 Winchester',       bulletWeightGrams: 10.89, muzzleVelocityMps: 807.7, ballisticCoefficient: 0.475, muzzleEnergyJoules: 3552, bulletDiameterMm: 7.82 },
    { id: '3006-150gr',          name: '.30-06 Springfield 150gr',     caliber: '.30-06 Springfield',    bulletWeightGrams: 9.72,  muzzleVelocityMps: 887.0, ballisticCoefficient: 0.435, muzzleEnergyJoules: 3823, bulletDiameterMm: 7.82 },
    { id: '65-creedmoor-140gr',  name: '6.5 Creedmoor 140gr ELD',     caliber: '6.5 Creedmoor',         bulletWeightGrams: 9.07,  muzzleVelocityMps: 826.0, ballisticCoefficient: 0.646, muzzleEnergyJoules: 3095, bulletDiameterMm: 6.71 },
    { id: '243-win-95gr',        name: '.243 Win 95gr BT',             caliber: '.243 Winchester',       bulletWeightGrams: 6.16,  muzzleVelocityMps: 920.0, ballisticCoefficient: 0.379, muzzleEnergyJoules: 2608, bulletDiameterMm: 5.94 },
    { id: '270-win-130gr',       name: '.270 Win 130gr AccuBond',      caliber: '.270 Winchester',       bulletWeightGrams: 8.42,  muzzleVelocityMps: 939.0, ballisticCoefficient: 0.480, muzzleEnergyJoules: 3714, bulletDiameterMm: 6.99 },
    { id: '7mm-rem-mag-160gr',   name: '7mm Rem Mag 160gr Partition',  caliber: '7mm Remington Magnum',  bulletWeightGrams: 10.36, muzzleVelocityMps: 930.0, ballisticCoefficient: 0.531, muzzleEnergyJoules: 4484, bulletDiameterMm: 7.21 },
    { id: '338-lapua-250gr',     name: '.338 Lapua 250gr SMK',         caliber: '.338 Lapua Magnum',     bulletWeightGrams: 16.20, muzzleVelocityMps: 905.0, ballisticCoefficient: 0.587, muzzleEnergyJoules: 6640, bulletDiameterMm: 8.61 },
    { id: '6mm-creedmoor-108gr', name: '6mm Creedmoor 108gr Hybrid',   caliber: '6mm Creedmoor',         bulletWeightGrams: 7.00,  muzzleVelocityMps: 885.0, ballisticCoefficient: 0.536, muzzleEnergyJoules: 2740, bulletDiameterMm: 6.17 },
    { id: '300-win-mag-190gr',   name: '.300 Win Mag 190gr SMK',       caliber: '.300 Winchester Magnum',bulletWeightGrams: 12.31, muzzleVelocityMps: 930.0, ballisticCoefficient: 0.533, muzzleEnergyJoules: 5330, bulletDiameterMm: 7.82 }
  ];
}

// ── G1 drag table interpolation ───────────────────────────────────────────────
function g1Drag(v) {
  v = Math.abs(v);
  if (v <= G1_TABLE[0][0]) return G1_TABLE[0][1];
  if (v >= G1_TABLE[G1_TABLE.length - 1][0]) return G1_TABLE[G1_TABLE.length - 1][1];
  for (let i = 1; i < G1_TABLE.length; i++) {
    if (v <= G1_TABLE[i][0]) {
      const t = (v - G1_TABLE[i - 1][0]) / (G1_TABLE[i][0] - G1_TABLE[i - 1][0]);
      return G1_TABLE[i - 1][1] + t * (G1_TABLE[i][1] - G1_TABLE[i - 1][1]);
    }
  }
}

// ── Atmosphere model ──────────────────────────────────────────────────────────
function airDensityRatio(altFt, tempF) {
  const stdTemp   = 59 - 3.5 * (altFt / 1000);
  const tempRatio  = (459.67 + stdTemp) / (459.67 + tempF);
  const pressRatio = Math.pow(1 - 6.87559e-6 * altFt, 5.256);
  return pressRatio * tempRatio;
}

// ── Client-side ballistics engine (mirrors Java BallisticsEngine) ─────────────
function simulateBullet(bullet, req) {
  const G     = 32.174;
  const bc    = bullet.ballisticCoefficient;
  const mvFps = bullet.muzzleVelocityMps * FPS_PER_MPS;
  const wLbs  = (bullet.bulletWeightGrams / 453.592);
  const windMph    = req.windSpeedKph * MPH_PER_KPH;
  const maxRangeYd = req.maxRangeMeters / M_PER_YARD;
  const stepYd     = req.stepMeters / M_PER_YARD;
  const rho        = airDensityRatio(req.altitudeMeters * FT_PER_M,
                                     req.temperatureC * 9 / 5 + 32);

  // Find zero angle via bisection
  const sightHt = 1.5 / 12;
  const zeroFt  = req.zeroRangeMeters * FT_PER_M;
  let lo = -0.05, hi = 0.05;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    let vx = mvFps * Math.cos(mid);
    let vy = mvFps * Math.sin(mid);
    let x = 0, y = 0;
    const dt = 0.001;
    while (x < zeroFt) {
      const vel = Math.hypot(vx, vy);
      if (vel < 50) break;
      const drag = g1Drag(vel) * rho / bc;
      const ax = -(vx / vel) * drag;
      const ay = -(vy / vel) * drag - G;
      vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
    }
    if (y < sightHt) lo = mid; else hi = mid;
  }
  const angle = (lo + hi) / 2;

  // Integrate main trajectory
  let vx = mvFps * Math.cos(angle);
  let vy = mvFps * Math.sin(angle);
  let x = 0, y = 0, t = 0;
  const dt = 0.0005;
  const points = [];
  let nextYd = 0;
  let maxOrdIn = 0, maxOrdRangeYd = 0, supersonicLimYd = maxRangeYd;
  let supersonicLogged = false;

  while ((x / 3) <= maxRangeYd + stepYd) {
    const rangeYd = x / 3;
    const vel = Math.hypot(vx, vy);

    if (rangeYd >= nextYd - 0.01) {
      const dropIn    = (y - x * Math.tan(angle)) * 12;
      const energy    = 0.5 * (wLbs / G) * vel * vel;
      const windFps   = windMph * 1.46667;
      const windDrift = windFps * (t - x / mvFps) * 12;
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

    if (!supersonicLogged && vel < 1125) {
      supersonicLimYd = rangeYd;
      supersonicLogged = true;
    }

    const drag = g1Drag(vel) * rho / bc;
    const ax = -(vx / vel) * drag;
    const ay = -(vy / vel) * drag - G;
    vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt; t += dt;
    if (vel < 100) break;
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
    <div class="bullet-card" id="card-${b.id}"
         style="--bullet-color:${BULLET_COLORS[b.id] || '#4ADE80'}"
         onclick="toggleBullet('${b.id}')">
      <div class="bullet-name">${b.name}</div>
      <div class="bullet-specs">
        BC: ${b.ballisticCoefficient} &nbsp;|&nbsp; MV: ${b.muzzleVelocityMps} m/s
      </div>
      <div class="check"></div>
    </div>
  `).join('');
}

function toggleBullet(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateBulletCards();
}

function updateBulletCards() {
  bullets.forEach(b => {
    const card = document.getElementById('card-' + b.id);
    if (card) card.classList.toggle('active', selectedIds.has(b.id));
  });
}

// ── Simulation ────────────────────────────────────────────────────────────────
async function runSimulation() {
  if (selectedIds.size === 0) { alert('Select at least one round.'); return; }
  const btn = document.getElementById('runBtn');
  btn.classList.add('loading');
  btn.querySelector('span').textContent = '⟳ COMPUTING...';

  const req = {
    bulletIds:       [...selectedIds],
    zeroRangeMeters: +document.getElementById('zeroRange').value,
    maxRangeMeters:  +document.getElementById('maxRange').value,
    stepMeters:      +document.getElementById('step').value,
    windSpeedKph:    +document.getElementById('windSpeed').value,
    altitudeMeters:  +document.getElementById('altitude').value,
    temperatureC:    +document.getElementById('temperature').value
  };

  try {
    let results;
    try {
      const res = await fetch(`${API_BASE}/trajectories/compare`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(req)
      });
      results = await res.json();
    } catch (e) {
      results = computeClientSide(req);
    }
    lastResults = results;
    renderResults(results, req);
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
  const rows = ['Round,Range (m),Drop (cm),Velocity (m/s),Energy (J),Wind Drift (cm),Time (s)'];
  lastResults.forEach(r => {
    r.points.forEach(p => {
      rows.push(`"${r.bullet.name}",${p.rangeMeters},${p.dropCm},${p.velocityMps},${p.energyJoules},${p.windDriftCm},${p.timeOfFlightSec}`);
    });
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trajectory.csv';
  a.click();
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
async function runCustom() {
  const name   = document.getElementById('customName').value.trim() || 'Custom Load';
  const weight = +document.getElementById('customWeight').value;
  const mv     = +document.getElementById('customMV').value;
  const bc     = +document.getElementById('customBC').value;
  const dia    = +document.getElementById('customDia').value;
  const req = {
    name:                name,
    bulletWeightGrams:   weight,
    muzzleVelocityMps:   mv,
    ballisticCoefficient: bc,
    bulletDiameterMm:    dia,
    zeroRangeMeters:     +document.getElementById('zeroRange').value,
    maxRangeMeters:      +document.getElementById('maxRange').value,
    stepMeters:          +document.getElementById('step').value,
    windSpeedKph:        +document.getElementById('windSpeed').value,
    altitudeMeters:      +document.getElementById('altitude').value,
    temperatureC:        +document.getElementById('temperature').value
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

// ── Results rendering ─────────────────────────────────────────────────────────
function renderResults(results, req) {
  document.getElementById('emptyState').style.display = 'none';
  const rc = document.getElementById('resultsContainer');
  rc.style.display = 'flex';

  const cc = document.getElementById('chartContainer');
  cc.innerHTML = '';

  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  const statsHtml = `
    <div class="stats-grid">
      ${results.map(r => `
        <div class="stat-card" style="--bullet-color:${BULLET_COLORS[r.bullet.id]}">
          <div class="stat-label" style="color:${BULLET_COLORS[r.bullet.id]}">${r.bullet.name}</div>
          <div class="stat-value">${r.bullet.muzzleVelocityMps.toLocaleString()}</div>
          <div class="stat-unit">MV m/s &nbsp;·&nbsp; BC ${r.bullet.ballisticCoefficient} &nbsp;·&nbsp; ${r.bullet.bulletWeightGrams}g</div>
          <div style="margin-top:8px; font-family:'Share Tech Mono',monospace; font-size:9px; color:var(--text-dim); letter-spacing:1px; line-height:1.8">
            <span style="color:var(--text)">⚡ ${r.bullet.muzzleEnergyJoules.toLocaleString()}</span> J muzzle energy<br>
            <span style="color:var(--text)">${r.supersonicLimitMeters}</span> m supersonic<br>
            <span style="color:var(--text)">${r.maxOrdinateCm}</span> cm max ordinate @ ${r.maxOrdinateRangeMeters} m
          </div>
        </div>
      `).join('')}
    </div>`;
  cc.insertAdjacentHTML('beforeend', statsHtml);

  const chartDefs = [
    {
      id: 'dropChart', title: 'BULLET DROP', subtitle: `zeroed at ${req.zeroRangeMeters} m`,
      yLabel: 'Drop (cm)', key: 'dropCm'
    },
    {
      id: 'velocityChart', title: 'VELOCITY RETENTION', subtitle: 'm/s downrange',
      yLabel: 'Velocity (m/s)', key: 'velocityMps',
      refLine: { value: 343, label: 'Transonic', color: 'rgba(255,100,0,0.4)' }
    },
    {
      id: 'energyChart', title: 'KINETIC ENERGY', subtitle: 'joules downrange',
      yLabel: 'Energy (J)', key: 'energyJoules'
    },
    {
      id: 'windChart', title: 'WIND DRIFT', subtitle: `${req.windSpeedKph} km/h crosswind`,
      yLabel: 'Drift (cm)', key: 'windDriftCm'
    }
  ];

  chartDefs.forEach(def => {
    const html = `
      <div class="chart-panel">
        <div class="chart-header">
          <div>
            <div class="chart-title">${def.title}</div>
            <div class="chart-subtitle">${def.subtitle}</div>
          </div>
          <button class="export-btn" onclick="exportPNG('${def.id}')">PNG</button>
        </div>
        <div class="chart-wrap"><canvas id="${def.id}"></canvas></div>
      </div>`;
    cc.insertAdjacentHTML('beforeend', html);

    const datasets = results.map(r => ({
      label:           r.bullet.name,
      data:            r.points.map(p => ({ x: p.rangeMeters, y: p[def.key] })),
      borderColor:     BULLET_COLORS[r.bullet.id] || '#4ADE80',
      backgroundColor: 'transparent',
      borderWidth:     2,
      pointRadius:     0,
      pointHoverRadius: 4,
      tension:         0.3
    }));

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

    const ctx = document.getElementById(def.id).getContext('2d');
    charts[def.id] = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
        interaction: { mode: 'index', intersect: false },
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
    });
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
      rows.push(`
        <tr>
          <td><span class="bullet-tag" style="background:${color}"></span>${r.bullet.name}</td>
          <td>${p.rangeMeters}</td>
          <td>${p.dropCm > 0 ? '+' : ''}${p.dropCm} cm</td>
          <td>${p.velocityMps.toLocaleString()}</td>
          <td>${p.energyJoules.toLocaleString()}</td>
          <td>${p.windDriftCm > 0 ? '+' : ''}${p.windDriftCm} cm</td>
          <td>${p.timeOfFlightSec}s</td>
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
  try {
    const res = await fetch(`${API_BASE}/bullets`);
    bullets = await res.json();
  } catch (e) {
    console.warn('API offline — using mock data for preview');
    bullets = getMockBullets();
  }
  renderBulletList();
  bullets.forEach(b => selectedIds.add(b.id));
  updateBulletCards();
}

// ── State helpers (for test access) ──────────────────────────────────────────
function _getState()     { return { bullets, selectedIds, lastResults, charts }; }
function _resetState()   { bullets = []; selectedIds = new Set(); lastResults = []; charts = {}; }
function _setBullets(b)  { bullets = b; }
function _setSelectedIds(s) { selectedIds = s; }
function _setCharts(c)   { charts = c; }

// ── Browser globals (for inline onclick handlers) ─────────────────────────────
window.toggleBullet  = toggleBullet;
window.switchTab     = switchTab;
window.runSimulation = runSimulation;
window.runCustom     = runCustom;
window.exportCSV     = exportCSV;
window.exportPNG     = exportPNG;
window.init          = init;

export {
  getMockBullets, g1Drag, airDensityRatio, simulateBullet, computeClientSide,
  renderBulletList, toggleBullet, updateBulletCards, runSimulation,
  renderResults, renderTable, switchTab, init,
  exportCSV, exportPNG, runCustom,
  BULLET_COLORS,
  _getState, _resetState, _setBullets, _setSelectedIds, _setCharts,
};
