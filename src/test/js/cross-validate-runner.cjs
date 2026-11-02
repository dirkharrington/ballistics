#!/usr/bin/env node
'use strict';
// Called by CrossValidationTest.java via Node subprocess.
// Reads { bullet, req } JSON from stdin, runs the JS RK4 simulator, writes
// the points array as JSON to stdout.  No npm dependencies — physics inline.

const G7_TABLE = [
  [0,0.1198],[400,0.1198],[500,0.1197],[600,0.1194],[700,0.1189],[800,0.1185],
  [900,0.1183],[950,0.1183],[1000,0.1185],[1050,0.1200],[1100,0.1230],
  [1150,0.1270],[1200,0.1318],[1250,0.1357],[1300,0.1386],[1350,0.1395],
  [1400,0.1378],[1450,0.1335],[1500,0.1278],[1600,0.1163],[1700,0.1066],
  [1800,0.0985],[1900,0.0920],[2000,0.0868],[2100,0.0826],[2200,0.0790],
  [2300,0.0757],[2400,0.0728],[2500,0.0702],[2600,0.0680],[2700,0.0661],
  [2800,0.0644],[2900,0.0630],[3000,0.0617],[3100,0.0604],[3200,0.0593],
  [3300,0.0583],[3400,0.0573],[3500,0.0564],[3600,0.0555],[4000,0.0520]
];

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

// ── Physics constants (must match ballistics.js and BallisticsEngine.java) ────
const G_FPS2      = 32.174;   // gravitational acceleration ft/s²  (≈ 9.807 m/s²)
const DT_S        = 0.0005;   // RK4 time step 0.5 ms
const SOUND_FPS   = 1125;     // speed of sound ft/s at ISA sea level (≈ 343 m/s)
const MIN_VEL_FPS = 100;      // below this the G1 model diverges; break early
const MPH_TO_FPS  = 1.46667;  // 1 mph = 1.46667 ft/s
const G_PER_LB    = 453.592;  // grams per avoirdupois pound

// ── Conversion constants ──────────────────────────────────────────────────────
const FPS_PER_MPS = 3.28084;
const FT_PER_M    = 3.28084;
const M_PER_YARD  = 0.9144;
const CM_PER_INCH = 2.54;
const J_PER_FTLB  = 1.35582;
const MPH_PER_KPH = 0.621371;

function tableDrag(table, v) {
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

function g1Drag(v) { return tableDrag(G1_TABLE, v); }

function airDensityRatio(altFt, tempF) {
  const stdTemp    = 59 - 3.5 * (altFt / 1000);
  const tempRatio  = (459.67 + stdTemp) / (459.67 + tempF);
  const pressRatio = Math.pow(1 - 6.87559e-6 * altFt, 5.256);
  return pressRatio * tempRatio;
}

function simulate(bullet, req) {
  const bc    = bullet.ballisticCoefficient;
  const mvFps = bullet.muzzleVelocityMps * FPS_PER_MPS;
  const wLbs  = bullet.bulletWeightGrams / G_PER_LB;
  const windMph    = req.windSpeedKph * MPH_PER_KPH;
  const maxRangeYd = req.maxRangeMeters / M_PER_YARD;
  const stepYd     = req.stepMeters / M_PER_YARD;
  const rho = airDensityRatio(req.altitudeMeters * FT_PER_M, req.temperatureC * 9 / 5 + 32);
  const dragTable  = (req.dragModel === 'G7') ? G7_TABLE : G1_TABLE;

  const deriv = (vx, vy, vel) => {
    const drag = tableDrag(dragTable, Math.abs(vel)) * rho / bc;
    return [-(vx / vel) * drag, -(vy / vel) * drag - G_FPS2];
  };

  const sightHt = (req.sightHeightMm != null ? req.sightHeightMm : 38.1) / 25.4 / 12;
  const zeroFt  = req.zeroRangeMeters * FT_PER_M;

  let lo = -0.05, hi = 0.05;
  // 64 iterations → error < 1e-19 rad; matches Java BallisticsEngine.findZeroAngle()
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    let vx = mvFps * Math.cos(mid), vy = mvFps * Math.sin(mid);
    let x = 0, y = 0;
    const dt = DT_S;
    while (x < zeroFt) {
      const vel = Math.hypot(vx, vy);
      if (vel < 50) break;
      const [ax1, ay1] = deriv(vx, vy, vel);
      const vx2 = vx + 0.5*dt*ax1, vy2 = vy + 0.5*dt*ay1;
      const [ax2, ay2] = deriv(vx2, vy2, Math.hypot(vx2, vy2));
      const vx3 = vx + 0.5*dt*ax2, vy3 = vy + 0.5*dt*ay2;
      const [ax3, ay3] = deriv(vx3, vy3, Math.hypot(vx3, vy3));
      const vx4 = vx +    dt*ax3, vy4 = vy +    dt*ay3;
      const [ax4, ay4] = deriv(vx4, vy4, Math.hypot(vx4, vy4));
      vx += (dt/6)*(ax1 + 2*ax2 + 2*ax3 + ax4);
      vy += (dt/6)*(ay1 + 2*ay2 + 2*ay3 + ay4);
      x  += vx * dt; y += vy * dt;
    }
    if (y < sightHt) lo = mid; else hi = mid;
  }
  const angle = (lo + hi) / 2;

  let vx = mvFps * Math.cos(angle), vy = mvFps * Math.sin(angle);
  let x = 0, y = 0, t = 0;
  const dt = 0.0005;
  const points = [];
  let nextYd = 0;
  const mvHorizFps = mvFps * Math.cos(angle);

  while ((x / 3) <= maxRangeYd + stepYd) {
    const rangeYd = x / 3;
    const vel = Math.hypot(vx, vy);

    if (rangeYd >= nextYd - 0.01) {
      const dropIn    = (y - x * Math.tan(angle)) * 12;
      const energy    = 0.5 * (wLbs / G_FPS2) * vel * vel;
      const windFps   = windMph * MPH_TO_FPS;
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
      nextYd += stepYd;
    }

    const [ax1, ay1] = deriv(vx, vy, vel);
    const vx2 = vx + 0.5*dt*ax1, vy2 = vy + 0.5*dt*ay1;
    const [ax2, ay2] = deriv(vx2, vy2, Math.hypot(vx2, vy2));
    const vx3 = vx + 0.5*dt*ax2, vy3 = vy + 0.5*dt*ay2;
    const [ax3, ay3] = deriv(vx3, vy3, Math.hypot(vx3, vy3));
    const vx4 = vx +    dt*ax3, vy4 = vy +    dt*ay3;
    const [ax4, ay4] = deriv(vx4, vy4, Math.hypot(vx4, vy4));
    vx += (dt/6)*(ax1 + 2*ax2 + 2*ax3 + ax4);
    vy += (dt/6)*(ay1 + 2*ay2 + 2*ay3 + ay4);
    x  += vx * dt; y += vy * dt; t += dt;
    if (vel < MIN_VEL_FPS) break;
  }
  return points;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const { bullet, req } = JSON.parse(input);
  process.stdout.write(JSON.stringify(simulate(bullet, req)));
});
