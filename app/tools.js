import { normalizeUnitSystem, toDisplay, fromDisplay, unitLabel } from './units.js';
import { escapeHtml, computeAdjustments } from './prefs.js';

// ── MOA / MRAD ────────────────────────────────────────────────────────────────

/**
 * Returns MOA and MRAD adjustments for a given drop and range.
 * @param {number} dropCm  - bullet drop in cm (negative = below aim line)
 * @param {number} rangeM  - target range in metres (must be > 0)
 * @returns {{ moa: number, mrad: number }}
 */
function calcMoaMrad(dropCm, rangeM) {
  if (rangeM <= 0) return { moa: 0, mrad: 0 };
  const dropM   = dropCm / 100;
  const radians = Math.atan2(-dropM, rangeM);
  const moa     = Math.round((radians * (180 / Math.PI) * 60) * 100) / 100;
  const mrad    = Math.round((radians * 1000) * 100) / 100;
  return { moa, mrad };
}

// ── Unit conversion ───────────────────────────────────────────────────────────

const CONVERSIONS = {
  // velocity
  mps:  { fps: v => v * 3.28084,   kph: v => v * 3.6,       mph: v => v * 2.23694  },
  fps:  { mps: v => v / 3.28084,   kph: v => v / 3.28084 * 3.6, mph: v => v / 1.46667 },
  kph:  { mps: v => v / 3.6,       fps: v => v / 3.6 * 3.28084, mph: v => v / 1.60934 },
  mph:  { mps: v => v / 2.23694,   fps: v => v * 1.46667,   kph: v => v * 1.60934  },
  // distance
  cm:   { in:  v => v / 2.54,      m:   v => v / 100,        yd:  v => v / 91.44   },
  in:   { cm:  v => v * 2.54,      m:   v => v * 0.0254,     yd:  v => v / 36      },
  m:    { cm:  v => v * 100,       in:  v => v / 0.0254,     yd:  v => v / 0.9144  },
  yd:   { cm:  v => v * 91.44,     in:  v => v * 36,         m:   v => v * 0.9144  },
};

/**
 * Converts a value from one unit to another.
 * @param {number} value
 * @param {string} from  - source unit key (e.g. 'mps', 'cm')
 * @param {string} to    - target unit key
 * @returns {number|null} converted value, or null when conversion is unsupported
 */
function convertUnit(value, from, to) {
  if (from === to) return value;
  const fn = CONVERSIONS[from]?.[to];
  if (!fn) return null;
  return Math.round(fn(value) * 10000) / 10000;
}

// ── Trajectory interpolation ──────────────────────────────────────────────────
/**
 * Linearly interpolate `field` from a sorted points array at `distMeters`.
 * Returns null when the field is absent or the array is empty.
 * @param {object[]} points      - trajectory points with rangeMeters property
 * @param {number}   distMeters  - target range in metres
 * @param {string}   field       - property name to interpolate (e.g. 'dropCm')
 * @returns {number|null}
 */
function interpolateAt(points, distMeters, field) {
  if (!points || points.length === 0) return null;
  if (distMeters <= points[0].rangeMeters) return points[0][field] ?? null;
  const last = points[points.length - 1];
  if (distMeters >= last.rangeMeters) return last[field] ?? null;
  // Lower-bound binary search: find smallest i in [1, n-1] with points[i].rangeMeters >= distMeters.
  let lo = 1, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].rangeMeters < distMeters) lo = mid + 1;
    else hi = mid;
  }
  const p0 = points[lo - 1];
  const p1 = points[lo];
  const t  = (distMeters - p0.rangeMeters) / (p1.rangeMeters - p0.rangeMeters);
  const v0 = p0[field];
  const v1 = p1[field];
  if (v0 == null || v1 == null) return null;
  return Math.round((v0 + t * (v1 - v0)) * 10) / 10;
}

// ── DOPE Card (MH-3) ──────────────────────────────────────────────────────────
let _dopeDistances    = [100, 200, 300, 400, 500, 600, 700, 800, 1000];
let _lastDopeResults  = null;
let _toolsUnitSystem  = 'metric';

function setToolsUnitSystem(unitSystem = 'metric') {
  _toolsUnitSystem = normalizeUnitSystem(unitSystem);
}

function _saveDopeDistances() {
  try {
    const params = new URLSearchParams(window.location.search);
    params.set('dopeDistances', JSON.stringify(_dopeDistances));
    history.replaceState(history.state, '', location.pathname + '?' + params.toString() + location.hash);
  } catch (_) {}
}

function _buildDopeTable(results, unitSystem) {
  const table = document.getElementById('dopeTable');
  if (!table || !results || results.length === 0) return;

  const sys   = normalizeUnitSystem(unitSystem);
  const rUnit = unitLabel('range', sys);
  const dUnit = unitLabel('drop', sys);
  const drUnit = unitLabel('drift', sys);
  const dists = [..._dopeDistances].sort((a, b) => a - b);
  const hasWind = results.some(r => r.points.some(p => p.windDriftCm != null && p.windDriftCm !== 0));
  const hasCoriolis = results.some(r => r.points.some(p => p.coriolisDeflectionCm !== undefined && p.coriolisDeflectionCm !== 0));
  const hasEotvos = results.some(r => r.points.some(p => p.coriolisVerticalCm !== undefined));
  const colSpan = 2 + (hasWind ? 2 : 0) + (hasCoriolis ? 1 : 0) + (hasEotvos ? 1 : 0);

  const thCols = results.map(r => `<th colspan="${colSpan}">${escapeHtml(r.bullet.name)}</th>`).join('');
  const thSub  = results.map(() =>
    `<th>MOA↑</th><th>MRAD↑</th>${hasWind ? '<th>Wind MOA</th><th>Wind MRAD</th>' : ''}${hasCoriolis ? `<th>Cor. (${drUnit})</th>` : ''}${hasEotvos ? `<th>Eötvös (${dUnit})</th>` : ''}`
  ).join('');

  const bodyRows = dists.map(dist => {
    const distMeters = fromDisplay('range', dist, sys);
    const tds = results.map(r => {
      const drop = interpolateAt(r.points, distMeters, 'dropCm');
      if (drop == null) return '<td>–</td>'.repeat(colSpan);
      const { moa, mrad } = computeAdjustments(drop, distMeters);
      let windCells = '';
      if (hasWind) {
        const wind = interpolateAt(r.points, distMeters, 'windDriftCm');
        if (wind == null) {
          windCells = '<td>–</td><td>–</td>';
        } else {
          const wRad  = Math.atan2(wind / 100, distMeters);
          const wMoa  = Math.round(wRad * (180 / Math.PI) * 60 * 10) / 10 + 0;
          const wMrad = Math.round(wRad * 1000 * 10) / 10 + 0;
          windCells = `<td>${wMoa > 0 ? '+' : ''}${wMoa}</td><td>${wMrad > 0 ? '+' : ''}${wMrad}</td>`;
        }
      }
      let corCell = '';
      if (hasCoriolis) {
        const cor = interpolateAt(r.points, distMeters, 'coriolisDeflectionCm');
        const corDisp = cor != null ? toDisplay('drift', cor, sys) : null;
        corCell = corDisp != null
          ? `<td>${corDisp >= 0 ? '+' : ''}${corDisp.toFixed(1)}</td>`
          : '<td>–</td>';
      }
      let eotCell = '';
      if (hasEotvos) {
        const eot = interpolateAt(r.points, distMeters, 'coriolisVerticalCm');
        const eotDisp = eot != null ? toDisplay('drop', eot, sys) : null;
        eotCell = eotDisp != null
          ? `<td>${eotDisp >= 0 ? '+' : ''}${eotDisp.toFixed(1)}</td>`
          : '<td>–</td>';
      }
      return `<td>${moa > 0 ? '+' : ''}${moa}</td><td>${mrad > 0 ? '+' : ''}${mrad}</td>${windCells}${corCell}${eotCell}`;
    }).join('');
    return `<tr><td><strong>${dist}</strong></td>${tds}</tr>`;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr><th>Range (${rUnit})</th>${thCols}</tr>
      <tr><th></th>${thSub}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  `;
}

function _renderDopeDistanceInputs() {
  const row = document.getElementById('dopeDistanceRow');
  if (!row) return;
  row.innerHTML = _dopeDistances.map((d, i) => `
    <input type="number" class="dope-dist-input" data-idx="${i}"
           value="${d}" min="0" max="3000" step="25">
  `).join('');
  row.querySelectorAll('.dope-dist-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const idx = +e.target.dataset.idx;
      const v   = +e.target.value;
      if (v > 0) {
        _dopeDistances[idx] = v;
        _saveDopeDistances();
        if (_lastDopeResults) _buildDopeTable(_lastDopeResults, _toolsUnitSystem);
      }
    });
  });
}

function _copyDopeText() {
  const table = document.getElementById('dopeTable');
  if (!table) return;
  const text = Array.from(table.querySelectorAll('tr'))
    .map(tr => Array.from(tr.querySelectorAll('th,td')).map(c => c.textContent.trim()).join('\t'))
    .join('\n');
  navigator.clipboard?.writeText(text).catch(() => {});
}

/**
 * Initialise the DOPE card DOM and wire events.
 * Must be called once after DOM is ready.
 */
function initDopeCard() {
  // Restore distances from URL if present
  try {
    const stored = new URLSearchParams(window.location.search).get('dopeDistances');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) _dopeDistances = parsed.map(Number).filter(n => n > 0);
    }
  } catch (_) {}

  _renderDopeDistanceInputs();

  document.getElementById('dopeAddDistBtn')?.addEventListener('click', () => {
    if (_dopeDistances.length >= 10) return;
    _dopeDistances.push((_dopeDistances[_dopeDistances.length - 1] ?? 500) + 100);
    _renderDopeDistanceInputs();
    _saveDopeDistances();
    if (_lastDopeResults) _buildDopeTable(_lastDopeResults, _toolsUnitSystem);
  });

  document.getElementById('dopeCopyBtn')?.addEventListener('click', _copyDopeText);
  document.getElementById('dopePrintBtn')?.addEventListener('click', () => window.print());
}

/**
 * Render (or re-render) the DOPE come-ups table from the latest simulation results.
 * Called by renderResults in ballistics.js after each simulation.
 * @param {object[]} results  - trajectory results array
 * @param {object}   _baseReq - base request (unused; reserved for future use)
 * @param {'metric'|'imperial'} [unitSystem='metric']
 */
function renderDopeCard(results, _baseReq, unitSystem = 'metric') {
  _toolsUnitSystem = normalizeUnitSystem(unitSystem);
  _lastDopeResults = results;
  _buildDopeTable(results, _toolsUnitSystem);
}

// ── BC Back-Calculator (SH-2 + PERF-17) ───────────────────────────────────────
let _bcSolveFn = null;

/**
 * Initialise the BC back-calculator card DOM and wire the CALCULATE button.
 * @param {Function} solveBCFn  Single-round-trip worker solver (PERF-17)
 */
function initBcSolver(solveBCFn = null) {
  _bcSolveFn = solveBCFn;

  document.getElementById('bcCalcBtn')?.addEventListener('click', async () => {
    const sys     = _toolsUnitSystem;
    const weightG = fromDisplay('weight', +document.getElementById('bcCalcWeightG').value, sys);
    const mvMps   = fromDisplay('velocity', +document.getElementById('bcCalcMvMps').value, sys);
    const dropCm  = fromDisplay('drop', +document.getElementById('bcCalcDropCm').value, sys);
    const rangeM  = fromDisplay('range', +document.getElementById('bcCalcRangeM').value, sys);
    const altM    = fromDisplay('altitude', +(document.getElementById('bcCalcAltM').value || 0), sys);
    const rawTemp = document.getElementById('bcCalcTempC').value;
    const tempC   = rawTemp == null ? 15 : fromDisplay('temp', +rawTemp, sys);
    const result  = document.getElementById('bcCalcResult');
    const btn     = document.getElementById('bcCalcBtn');
    if (!result) return;

    if (!(weightG > 0) || !(mvMps > 0) || dropCm === 0 || !(rangeM > 0)) {
      result.textContent = 'Fill all fields.';
      return;
    }

    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    try {
      const bc = typeof _bcSolveFn === 'function'
        ? await _bcSolveFn({ weightG, mvMps, measuredDropCm: dropCm, rangeM, altM, tempC })
        : null;
      if (bc === null) {
        result.textContent = 'Could not converge. Check inputs.';
      } else {
        const label = document.createElement('span'); label.className = 'tool-label'; label.textContent = 'G1 BC';
        const val   = document.createElement('span'); val.className   = 'tool-value'; val.textContent   = bc.toFixed(4);
        result.replaceChildren(label, val);
      }
    } catch (_) {
      result.textContent = 'Could not converge. Check inputs.';
    } finally {
      if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    }
  });
}

// ── DOM wiring ────────────────────────────────────────────────────────────────

function initTools() {
  const calcBtn = document.getElementById('toolCalcBtn');
  const unitBtn = document.getElementById('unitCalcBtn');

  calcBtn?.addEventListener('click', () => {
    const sys      = _toolsUnitSystem;
    const drop     = fromDisplay('drop', parseFloat(document.getElementById('toolDrop').value) || 0, sys);
    const rawRange = parseFloat(document.getElementById('toolRange').value);
    const range    = rawRange ? fromDisplay('range', rawRange, sys) : 100;
    const { moa, mrad } = calcMoaMrad(drop, range);
    const moaLabel  = document.createElement('span'); moaLabel.className  = 'tool-label'; moaLabel.textContent  = 'MOA';
    const moaValue  = document.createElement('span'); moaValue.className  = 'tool-value'; moaValue.textContent  = moa;
    const mradLabel = document.createElement('span'); mradLabel.className = 'tool-label'; mradLabel.textContent = 'MRAD';
    const mradValue = document.createElement('span'); mradValue.className = 'tool-value'; mradValue.textContent = mrad;
    document.getElementById('toolResults').replaceChildren(moaLabel, moaValue, mradLabel, mradValue);
  });

  unitBtn?.addEventListener('click', () => {
    const value  = parseFloat(document.getElementById('unitValue').value);
    const from   = document.getElementById('unitFrom').value;
    const to     = document.getElementById('unitTo').value;
    const result = convertUnit(value, from, to);
    const container = document.getElementById('unitResults');
    if (result !== null) {
      const label = document.createElement('span'); label.className = 'tool-label'; label.textContent = to;
      const val   = document.createElement('span'); val.className   = 'tool-value'; val.textContent   = result;
      container.replaceChildren(label, val);
    } else {
      const span = document.createElement('span');
      span.className = 'tool-value';
      span.style.color = 'var(--accent2)';
      span.textContent = 'Unsupported conversion';
      container.replaceChildren(span);
    }
  });
}

// ── MPBR Calculator (ENH-4) ───────────────────────────────────────────────────
let _lastMpbrResults = null;

/**
 * Compute Maximum Point-Blank Range (MPBR) for a trajectory within a vital zone diameter.
 * Scans after peak rise so negative near-muzzle sight height does not terminate MPBR at range 0.
 *
 * @param {object[]} points         - trajectory points with rangeMeters and dropCm
 * @param {number}   [vitalZoneCm]  - vital zone diameter in cm (default 20)
 * @returns {object|null}
 */
function calcMpbr(points, vitalZoneCm = 20) {
  if (!Array.isArray(points) || points.length === 0 || !(vitalZoneCm > 0) || !Number.isFinite(vitalZoneCm)) {
    return null;
  }
  const radius = vitalZoneCm / 2;

  let peakIdx = 0;
  let maxRiseCm = points[0].dropCm;
  let maxRiseRangeM = points[0].rangeMeters;
  for (let i = 1; i < points.length; i++) {
    if (points[i].dropCm > maxRiseCm) {
      maxRiseCm = points[i].dropCm;
      maxRiseRangeM = points[i].rangeMeters;
      peakIdx = i;
    }
  }
  const exceedsVitalZone = maxRiseCm > radius;

  let mpbrMeters;
  let truncatedAtMaxRange;
  if (maxRiseCm < -radius) {
    mpbrMeters = Math.round(maxRiseRangeM * 10) / 10;
    truncatedAtMaxRange = false;
  } else {
    let found = false;
    for (let i = peakIdx + 1; i < points.length; i++) {
      if (points[i].dropCm < -radius) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const t = (-radius - p0.dropCm) / (p1.dropCm - p0.dropCm);
        mpbrMeters = Math.round((p0.rangeMeters + t * (p1.rangeMeters - p0.rangeMeters)) * 10) / 10;
        truncatedAtMaxRange = false;
        found = true;
        break;
      }
    }
    if (!found) {
      mpbrMeters = Math.round(points[points.length - 1].rangeMeters * 10) / 10;
      truncatedAtMaxRange = true;
    }
  }

  return {
    vitalZoneCm,
    radiusCm: Math.round(radius * 10) / 10,
    mpbrMeters,
    maxRiseCm: Math.round(maxRiseCm * 10) / 10,
    maxRiseRangeM,
    exceedsVitalZone,
    truncatedAtMaxRange,
  };
}

/**
 * Render MPBR results into #mpbrResults for the current simulation results.
 * @param {object[]|null} results
 * @param {'metric'|'imperial'} [unitSystem='metric']
 */
function renderMpbrTool(results, unitSystem = 'metric') {
  const sys = normalizeUnitSystem(unitSystem);
  _toolsUnitSystem = sys;
  _lastMpbrResults = results;
  const vUnit = unitLabel('vitalZone', sys);
  const unitEl = document.querySelector('#mpbrCard [data-unit-kind="vitalZone"]');
  if (unitEl) unitEl.textContent = vUnit;

  const container = document.getElementById('mpbrResults');
  if (!container) return;
  if (!results || results.length === 0) {
    container.innerHTML = '';
    return;
  }

  const rUnit = unitLabel('range', sys);
  const dUnit = unitLabel('drop', sys);
  const vitalInput = document.getElementById('mpbrVitalCm');
  const rawVital = vitalInput ? parseFloat(vitalInput.value) : NaN;
  const vitalCm = Number.isFinite(rawVital) && rawVital > 0 ? fromDisplay('vitalZone', rawVital, sys) : 20;

  container.innerHTML = results.map(r => {
    const mpbr = calcMpbr(r.points, vitalCm);
    if (!mpbr) return '';
    const mpbrDisp         = toDisplay('range', mpbr.mpbrMeters, sys);
    const maxRiseDisp      = toDisplay('drop', mpbr.maxRiseCm, sys);
    const maxRiseRangeDisp = toDisplay('range', mpbr.maxRiseRangeM, sys);
    const radiusDisp       = toDisplay('vitalZone', mpbr.radiusCm, sys);
    const trunc = mpbr.truncatedAtMaxRange ? ' (max range)' : '';
    const warn = mpbr.exceedsVitalZone
      ? `<span class="mpbr-warning" style="display:inline-block;margin-top:4px;padding:1px 6px;border:1px solid var(--accent2,#ff6b00);color:var(--accent2,#ff6b00);font-size:10px;border-radius:2px;">Exceeds ±${radiusDisp} ${vUnit} vital zone</span>`
      : '';
    return `<div class="mpbr-entry" style="width:100%;font-family:'Share Tech Mono',monospace;font-size:11px;">` +
      `<div class="tool-label">${escapeHtml(r.bullet.name)}</div>` +
      `<div class="tool-value">MPBR: ${mpbrDisp} ${rUnit}${trunc} · Max Rise: ${maxRiseDisp} ${dUnit} @ ${maxRiseRangeDisp} ${rUnit}</div>` +
      `${warn}</div>`;
  }).join('');
}

/**
 * Initialise the MPBR calculator DOM and wire #mpbrVitalCm listeners.
 */
function initMpbrTool() {
  const inp = document.getElementById('mpbrVitalCm');
  if (!inp) return;
  const onUpdate = () => {
    if (_lastMpbrResults) renderMpbrTool(_lastMpbrResults, _toolsUnitSystem);
  };
  inp.addEventListener('input', onUpdate);
  inp.addEventListener('change', onUpdate);
}

// ── MV Truing (S23-4) ─────────────────────────────────────────────────────────

const TRUED_SUFFIX = ' (trued)';
const CUSTOM_NAME_MAX = 64;
const CUSTOM_SHORT_NAME_MAX = 16;
const MAX_TRUING_RANGE_M = 5000;
const MPS_PER_FPS = 0.3048;
const G_PER_GRAIN = 0.06479891;
const MM_PER_INCH = 25.4;
/** Drop-matching tolerance (cm); engine drops are rounded to 0.1 cm so 0.05 is the tightest reachable. */
const TRUING_TOL_CM = 0.05;
/** Stand-in drop (cm) when the bullet cannot be simulated at the observed range. */
const UNREACHABLE_DROP_CM = Infinity;
/** Upper bound for a physically plausible solved MV (matches custom-bullet MV max: 5000 fps). */
const MAX_SOLVED_MV_MPS = 5000 * MPS_PER_FPS;

/**
 * Bisect for the muzzle velocity whose drop at the observed range matches `observedDropCm`.
 * @param {(mv:number)=>number} computeDropFn  drop (cm, positive = below line of sight) at the observed range
 * @returns {number|null} solved MV, or null when the target is not bracketed
 */
function solveMV(computeDropFn, observedDropCm, mvLow = 50, mvHigh = 9999, tol = 0.01, maxIter = 100) {
  const dLow = computeDropFn(mvLow) - observedDropCm;
  const dHigh = computeDropFn(mvHigh) - observedDropCm;
  if (dLow * dHigh > 0) return null; // no bracket
  for (let i = 0; i < maxIter; i++) {
    const mid = (mvLow + mvHigh) / 2;
    const dMid = computeDropFn(mid) - observedDropCm;
    if (Math.abs(dMid) <= tol) return mid;
    if (dLow * dMid <= 0) { mvHigh = mid; } else { mvLow = mid; }
  }
  return (mvLow + mvHigh) / 2;
}

/**
 * Validate the truing form. Drop is positive when the bullet impacts below the line of sight.
 * @returns {{ ok: true, rangeM: number, dropCm: number } | { ok: false, error: string }}
 */
function validateTruingInput(rangeRaw, dropRaw, dropUnit, unitSystem = 'metric') {
  const sys = normalizeUnitSystem(unitSystem);
  const range = rangeRaw === '' || rangeRaw == null ? NaN : Number(rangeRaw);
  if (!Number.isFinite(range) || !(range > 0)) return { ok: false, error: 'Observed range must be greater than 0.' };
  const rangeM = fromDisplay('range', range, sys);
  if (rangeM > MAX_TRUING_RANGE_M) return { ok: false, error: `Observed range must be at most ${MAX_TRUING_RANGE_M} m.` };
  const drop = dropRaw === '' || dropRaw == null ? NaN : Number(dropRaw);
  if (!Number.isFinite(drop)) return { ok: false, error: 'Observed drop must be a number.' };
  const dropCm = dropUnit === 'moa'
    ? Math.tan((drop / 60) * Math.PI / 180) * rangeM * 100
    : fromDisplay('drop', drop, sys);
  return { ok: true, rangeM, dropCm };
}

/** Name for a trued copy, truncated so it always fits the custom-bullet name limit. */
function truedBulletName(originalName) {
  const base = String(originalName).replace(/ \(trued\)$/, '');
  return base.slice(0, CUSTOM_NAME_MAX - TRUED_SUFFIX.length) + TRUED_SUFFIX;
}

/** Custom-bullet form fields (strings) for a copy of `bullet` at the solved MV. */
function truedBulletFields(bullet, mvMps) {
  const base = String(bullet.shortName ?? bullet.name);
  return {
    name:                   truedBulletName(bullet.name),
    shortName:              base.slice(0, CUSTOM_SHORT_NAME_MAX - 1) + '*',
    bulletWeightGrains:     String(Math.round(bullet.bulletWeightGrams / G_PER_GRAIN * 100) / 100),
    ballisticCoefficientG1: String(bullet.ballisticCoefficient),
    ballisticCoefficientG7: bullet.ballisticCoefficientG7 == null ? '' : String(bullet.ballisticCoefficientG7),
    bulletDiameterInches:   String(Math.round(bullet.bulletDiameterMm / MM_PER_INCH * 1000) / 1000),
    muzzleVelocityFps:      String(Math.round(mvMps / MPS_PER_FPS * 10) / 10),
  };
}

let _truing = null; // { bullet, mvMps }

/**
 * Wire the MV Truing card.
 * @param {{ getContext: () => ({bullet:object, baseBullet:object, req:object}|null),
 *           loadSimulate: () => Promise<Function>,
 *           saveTrued: (baseBullet:object, mvMps:number) => ({ok:boolean, name?:string, message?:string}) }} deps
 */
function initMvTruing({ getContext, loadSimulate, saveTrued }) {
  _truing = null;
  const $ = id => document.getElementById(id);
  const setError = msg => { $('truingError').textContent = msg; };

  $('truingCalc')?.addEventListener('click', async () => {
    setError('');
    $('truingResult').style.display = 'none';
    $('truingApplyMsg').textContent = '';
    _truing = null;

    const sys = _toolsUnitSystem;
    const parsed = validateTruingInput($('truingRange').value, $('truingDrop').value, $('truingDropUnit').value, sys);
    if (!parsed.ok) { setError(parsed.error); return; }
    const ctx = getContext();
    if (!ctx) { setError('Select a bullet and run a simulation first.'); return; }

    const { rangeM, dropCm } = parsed;
    const steps = Math.ceil(rangeM / 500);
    let simulate;
    try {
      simulate = await loadSimulate();
    } catch (_) {
      setError('Could not load the physics engine.');
      return;
    }
    const params = {
      ...ctx.req,
      maxRangeMeters: rangeM,
      stepMeters: rangeM / steps,
    };
    let lastEngineError = null;
    const computeDropFn = mv => {
      try {
        const res = simulate({ ...ctx.bullet, muzzleVelocityMps: mv }, params);
        const last = res.points[res.points.length - 1];
        if (!last || last.rangeMeters < rangeM - 1e-6) return UNREACHABLE_DROP_CM;
        return -interpolateAt(res.points, rangeM, 'dropCm');
      } catch (e) {
        lastEngineError = e;
        return UNREACHABLE_DROP_CM;
      }
    };
    const mv = solveMV(computeDropFn, dropCm, 50, 9999, TRUING_TOL_CM);
    if (mv === null) {
      setError(lastEngineError
        ? (lastEngineError.message || 'Engine error — check your inputs.')
        : 'No muzzle velocity reproduces that drop. Check range, drop and units.');
      return;
    }
    if (mv > MAX_SOLVED_MV_MPS) { setError('Solved MV is out of range — check your inputs.'); return; }

    _truing = { baseBullet: ctx.baseBullet, mvMps: mv };
    const vUnit = unitLabel('velocity', sys);
    const mvDisp = Math.round(toDisplay('velocity', mv, sys) * 10) / 10;
    const delta = Math.round(toDisplay('velocity', mv - ctx.bullet.muzzleVelocityMps, sys) * 10) / 10;
    $('truingMV').textContent = `${mvDisp} ${vUnit}`;
    $('truingDelta').textContent = `${delta > 0 ? '+' : ''}${delta} ${vUnit} vs nominal`;
    $('truingResult').style.display = '';
  });

  $('truingApply')?.addEventListener('click', () => {
    const msg = $('truingApplyMsg');
    if (!_truing) return;
    const res = saveTrued(_truing.baseBullet, _truing.mvMps);
    msg.textContent = res.ok ? `Saved “${res.name}”.` : (res.message ?? 'Could not save bullet.');
  });
}

export { solveMV, validateTruingInput, truedBulletName, truedBulletFields, initMvTruing };
export { calcMoaMrad, convertUnit, initTools, CONVERSIONS, interpolateAt, initDopeCard, renderDopeCard, initBcSolver, calcMpbr, initMpbrTool, renderMpbrTool, setToolsUnitSystem };
