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

// ── Shared escape helper (tools.js cannot import from ballistics.js) ──────────
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  for (let i = 1; i < points.length; i++) {
    if (distMeters <= points[i].rangeMeters) {
      const t  = (distMeters - points[i - 1].rangeMeters) / (points[i].rangeMeters - points[i - 1].rangeMeters);
      const v0 = points[i - 1][field];
      const v1 = points[i][field];
      if (v0 == null || v1 == null) return null;
      return Math.round((v0 + t * (v1 - v0)) * 10) / 10;
    }
  }
  return null;
}

// ── DOPE Card (MH-3) ──────────────────────────────────────────────────────────
let _simulateBulletFn = null;
let _dopeDistances    = [100, 200, 300, 400, 500, 600, 700, 800, 1000];
let _lastDopeResults  = null;

function _saveDopeDistances() {
  try {
    const params = new URLSearchParams(window.location.search);
    params.set('dopeDistances', JSON.stringify(_dopeDistances));
    history.replaceState(history.state, '', location.pathname + '?' + params.toString() + location.hash);
  } catch (_) {}
}

function _buildDopeTable(results) {
  const table = document.getElementById('dopeTable');
  if (!table || !results || results.length === 0) return;

  const dists = [..._dopeDistances].sort((a, b) => a - b);

  const thCols = results.map(r => `<th colspan="2">${_esc(r.bullet.name)}</th>`).join('');
  const thSub  = results.map(() => '<th>MOA↑</th><th>MRAD↑</th>').join('');

  const bodyRows = dists.map(dist => {
    const tds = results.map(r => {
      const drop = interpolateAt(r.points, dist, 'dropCm');
      if (drop == null) return '<td>–</td><td>–</td>';
      const angleRad = Math.atan2(Math.abs(drop) / 100, dist);
      const sign     = drop < 0 ? 1 : (drop > 0 ? -1 : 0);
      const moa      = Math.round(sign * angleRad * (180 / Math.PI) * 60 * 10) / 10;
      const mrad     = Math.round(sign * angleRad * 1000 * 10) / 10;
      return `<td>${moa > 0 ? '+' : ''}${moa}</td><td>${mrad > 0 ? '+' : ''}${mrad}</td>`;
    }).join('');
    return `<tr><td><strong>${dist}</strong></td>${tds}</tr>`;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr><th>Range (m)</th>${thCols}</tr>
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
           value="${d}" min="0" max="3000" step="25"
           style="width:60px; font-family:'Share Tech Mono',monospace; font-size:11px; padding:4px; background:var(--surface,#1a2635); color:var(--text,#c8dde8); border:1px solid var(--border,#1e3040);">
  `).join('');
  row.querySelectorAll('.dope-dist-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const idx = +e.target.dataset.idx;
      const v   = +e.target.value;
      if (v > 0) {
        _dopeDistances[idx] = v;
        _saveDopeDistances();
        if (_lastDopeResults) _buildDopeTable(_lastDopeResults);
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
 * Must be called once after DOM is ready, with the simulateBullet callback.
 * @param {Function} simulateBulletFn - the simulateBullet function from ballistics.js
 */
function initDopeCard(simulateBulletFn) {
  _simulateBulletFn = simulateBulletFn;

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
    if (_lastDopeResults) _buildDopeTable(_lastDopeResults);
  });

  document.getElementById('dopeCopyBtn')?.addEventListener('click', _copyDopeText);
}

/**
 * Render (or re-render) the DOPE come-ups table from the latest simulation results.
 * Called by renderResults in ballistics.js after each simulation.
 * @param {object[]} results  - trajectory results array
 * @param {object}   _baseReq - base request (unused; reserved for future use)
 */
function renderDopeCard(results, _baseReq) {
  _lastDopeResults = results;
  _buildDopeTable(results);
}

// ── BC Back-Calculator (SH-2) ─────────────────────────────────────────────────
let _bcSimulateFn = null;

/**
 * Bisection solver: find the G1 BC that produces `measuredDropCm` at `rangeM`.
 * Runs 64 iterations → converges to < 0.0001 BC precision.
 *
 * @param {Function} simulateBulletFn
 * @param {number}   weightG          bullet weight in grams
 * @param {number}   mvMps            muzzle velocity in m/s
 * @param {number}   measuredDropCm   measured bullet drop (negative = below LoS)
 * @param {number}   rangeM           measurement range in metres
 * @param {number}   altM             altitude in metres
 * @param {number}   tempC            temperature in °C
 * @returns {number|null} solved BC rounded to 4 dp, or null if interpolation failed
 */
function calcBC(simulateBulletFn, weightG, mvMps, measuredDropCm, rangeM, altM, tempC) {
  const bullet = {
    id: 'bc-solve', name: 'BC Solve', caliber: 'Custom',
    bulletWeightGrams:    weightG,
    muzzleVelocityMps:    mvMps,
    ballisticCoefficient: 0.5,
    bulletDiameterMm:     7.62,
    muzzleEnergyJoules:   Math.round(0.5 * (weightG / 1000) * mvMps * mvMps),
  };
  const req = {
    bulletIds:            ['bc-solve'],
    zeroRangeMeters:      100,
    maxRangeMeters:       rangeM + 25,
    stepMeters:           25,
    windSpeedKph:         0,
    windDirectionDeg:     90,
    altitudeMeters:       altM,
    temperatureC:         tempC,
    sightHeightMm:        38.1,
    shootingAngleDegrees: 0,
    dragModel:            'G1',
  };

  let lo = 0.001, hi = 1.5;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    bullet.ballisticCoefficient = mid;
    const result = simulateBulletFn(bullet, req);
    const drop   = interpolateAt(result.points, rangeM, 'dropCm');
    if (drop === null) return null;
    // drop < measuredDropCm → too much drop (BC too low) → raise lo
    // drop >= measuredDropCm → too little drop (BC too high) → lower hi
    if (drop < measuredDropCm) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2 * 10000) / 10000;
}

/**
 * Initialise the BC back-calculator card DOM and wire the CALCULATE button.
 * @param {Function} simulateBulletFn
 */
function initBcSolver(simulateBulletFn) {
  _bcSimulateFn = simulateBulletFn;

  document.getElementById('bcCalcBtn')?.addEventListener('click', () => {
    const weightG = +document.getElementById('bcCalcWeightG').value;
    const mvMps   = +document.getElementById('bcCalcMvMps').value;
    const dropCm  = +document.getElementById('bcCalcDropCm').value;
    const rangeM  = +document.getElementById('bcCalcRangeM').value;
    const altM    = +(document.getElementById('bcCalcAltM').value  || 0);
    const tempC   = +(document.getElementById('bcCalcTempC').value ?? 15);
    const result  = document.getElementById('bcCalcResult');
    if (!result) return;

    if (!(weightG > 0) || !(mvMps > 0) || dropCm === 0 || !(rangeM > 0)) {
      result.textContent = 'Fill all fields.';
      return;
    }

    const bc = calcBC(_bcSimulateFn, weightG, mvMps, dropCm, rangeM, altM, tempC);
    if (bc === null) {
      result.textContent = 'Could not converge. Check inputs.';
    } else {
      const label = document.createElement('span'); label.className = 'tool-label'; label.textContent = 'G1 BC';
      const val   = document.createElement('span'); val.className   = 'tool-value'; val.textContent   = bc.toFixed(4);
      result.replaceChildren(label, val);
    }
  });
}

// ── DOM wiring ────────────────────────────────────────────────────────────────

function initTools() {
  const calcBtn = document.getElementById('toolCalcBtn');
  const unitBtn = document.getElementById('unitCalcBtn');

  calcBtn?.addEventListener('click', () => {
    const drop  = parseFloat(document.getElementById('toolDrop').value)  || 0;
    const range = parseFloat(document.getElementById('toolRange').value) || 100;
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
      span.style.color = 'var(--warn)';
      span.textContent = 'Unsupported conversion';
      container.replaceChildren(span);
    }
  });
}

export { calcMoaMrad, convertUnit, initTools, CONVERSIONS, interpolateAt, initDopeCard, renderDopeCard, initBcSolver, calcBC };
