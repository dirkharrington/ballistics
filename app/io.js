// ── Export & import helpers (lazy-loaded on demand via ballistics.js) ─────────
import { normalizeUnitSystem, toDisplay, unitLabel } from './units.js';
import { resultSpeedOfSound, formatMach } from './mach.js';

/** Bullet-level numeric fields copied from imported JSON. */
const BULLET_NUMERIC_FIELDS = [
  'muzzleVelocityMps', 'ballisticCoefficient', 'ballisticCoefficientG7', 'ballisticCoefficientG5',
  'bulletWeightGrams', 'bulletDiameterMm', 'muzzleEnergyJoules',
];

/** Result-level numeric fields copied from imported JSON. */
const RESULT_NUMERIC_FIELDS = [
  'supersonicLimitMeters', 'maxOrdinateCm', 'maxOrdinateRangeMeters', 'densityAltitudeMeters',
];

/** Point-level numeric fields copied from imported JSON. */
const POINT_NUMERIC_FIELDS = [
  'rangeMeters', 'dropCm', 'velocityMps', 'energyJoules', 'windDriftCm',
  'timeOfFlightSec', 'spinDriftCm', 'coriolisDeflectionCm', 'coriolisVerticalCm',
];

const MAX_IMPORT_BYTES   = 5 * 1024 * 1024;
const MAX_IMPORT_RESULTS = 10;
const MAX_IMPORT_POINTS  = 2000;
const MAX_BULLET_STR_LEN = 200;

/**
 * Escape a CSV cell per RFC 4180 and neutralize spreadsheet formula triggers.
 * @param {unknown} str
 * @returns {string}
 */
export function csvCell(str) {
  const s = String(str).replace(/"/g, '""');
  // Prevent formula injection in spreadsheet apps (Excel, Google Sheets)
  return /^[=+\-@\t\r]/.test(s) ? `"'${s}"` : `"${s}"`;
}

/**
 * Trigger a browser download for a Blob and immediately revoke its object URL.
 * @param {Blob} blob
 * @param {string} filename
 */
export function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export trajectory data in simplified UX-2 CSV format (Distance, Velocity, Energy, Drop, Bullet).
 * @param {object[]} results
 * @param {'metric'|'imperial'} [unitSystem='metric']
 */
export function exportTrajectoryCSV(results, unitSystem = 'metric') {
  if (!results.length) return;
  const sys   = normalizeUnitSystem(unitSystem);
  const rUnit = unitLabel('range', sys);
  const vUnit = unitLabel('velocity', sys);
  const eUnit = unitLabel('energy', sys);
  const dropHeader = sys === 'imperial' ? 'Drop (in)' : 'Drop (m)';
  const rows = [`Distance (${rUnit}),Velocity (${vUnit}),Energy (${eUnit}),${dropHeader},Bullet`];
  results.forEach(r => {
    r.points.forEach(p => {
      const dist = toDisplay('range', p.rangeMeters, sys);
      const vel  = toDisplay('velocity', p.velocityMps, sys);
      const en   = toDisplay('energy', p.energyJoules, sys);
      const drop = sys === 'imperial' ? toDisplay('drop', p.dropCm, 'imperial') : p.dropCm / 100;
      rows.push(`${dist},${vel},${en},${drop},${csvCell(r.bullet.name)}`);
    });
  });
  _downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), `trajectory-${Date.now()}.csv`);
}

/**
 * Export full trajectory table with MOA and MRAD scope adjustments as CSV.
 * @param {object[]} results
 * @param {Function} computeAdjustments
 * @param {'metric'|'imperial'} [unitSystem='metric']
 */
export function exportCSV(results, computeAdjustments, unitSystem = 'metric') {
  if (!results.length) return;
  const sys    = normalizeUnitSystem(unitSystem);
  const rUnit  = unitLabel('range', sys);
  const dUnit  = unitLabel('drop', sys);
  const vUnit  = unitLabel('velocity', sys);
  const eUnit  = unitLabel('energy', sys);
  const drUnit = unitLabel('drift', sys);
  const rows = [`Round,Range (${rUnit}),Drop (${dUnit}),Velocity (${vUnit}),Energy (${eUnit}),Wind Drift (${drUnit}),Time (s),MOA,MRAD,Mach`];
  results.forEach(r => {
    const sos = resultSpeedOfSound(r);
    r.points.forEach(p => {
      const adj  = computeAdjustments(p.dropCm, p.rangeMeters);
      const rng  = toDisplay('range', p.rangeMeters, sys);
      const drop = toDisplay('drop', p.dropCm, sys);
      const vel  = toDisplay('velocity', p.velocityMps, sys);
      const en   = toDisplay('energy', p.energyJoules, sys);
      const wind = toDisplay('drift', p.windDriftCm, sys);
      rows.push(`${csvCell(r.bullet.name)},${rng},${drop},${vel},${en},${wind},${p.timeOfFlightSec},${adj.moa},${adj.mrad},${formatMach(p.velocityMps, sos)}`);
    });
  });
  _downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), 'trajectory.csv');
}

/** Copy of results with a `mach` field added to every point (ignored on import). */
function withMach(results) {
  return results.map(r => {
    const sos = resultSpeedOfSound(r);
    return { ...r, points: r.points.map(p => ({ ...p, mach: Number(formatMach(p.velocityMps, sos)) })) };
  });
}

/**
 * Export raw trajectory results as formatted JSON.
 * @param {object[]} results
 */
export function exportJSON(results) {
  if (!results.length) return;
  _downloadBlob(
    new Blob([JSON.stringify(withMach(results), null, 2)], { type: 'application/json' }),
    'trajectory.json',
  );
}

/**
 * Export trajectory results as Markdown tables.
 * @param {object[]} results
 * @param {{ computeAdjustments: Function, escapeHtml: Function, unitSystem?: 'metric'|'imperial' }} deps
 */
export function exportMarkdown(results, { computeAdjustments, escapeHtml, unitSystem = 'metric' }) {
  if (!results.length) return;
  const sys    = normalizeUnitSystem(unitSystem);
  const rUnit  = unitLabel('range', sys);
  const dUnit  = unitLabel('drop', sys);
  const vUnit  = unitLabel('velocity', sys);
  const eUnit  = unitLabel('energy', sys);
  const drUnit = unitLabel('drift', sys);
  const lines = [];
  results.forEach(r => {
    lines.push(`## ${escapeHtml(r.bullet.name)}\n`);
    lines.push(`| Range (${rUnit}) | Drop (${dUnit}) | Velocity (${vUnit}) | Energy (${eUnit}) | Wind Drift (${drUnit}) | MOA | MRAD | Mach |`);
    lines.push('|----------:|----------:|---------------:|-----------:|----------------:|----:|-----:|-----:|');
    const sos = resultSpeedOfSound(r);
    r.points.forEach(p => {
      const adj  = computeAdjustments(p.dropCm, p.rangeMeters);
      const rng  = toDisplay('range', p.rangeMeters, sys);
      const drop = toDisplay('drop', p.dropCm, sys);
      const vel  = toDisplay('velocity', p.velocityMps, sys);
      const en   = toDisplay('energy', p.energyJoules, sys);
      const wind = toDisplay('drift', p.windDriftCm, sys);
      lines.push(`| ${rng} | ${drop} | ${vel} | ${en} | ${wind} | ${adj.moa} | ${adj.mrad} | ${formatMach(p.velocityMps, sos)} |`);
    });
    lines.push('');
  });
  _downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown' }), 'trajectory.md');
}

/**
 * Download a chart canvas as a PNG image.
 * @param {string} chartId
 */
export function exportPNG(chartId) {
  const canvas = document.getElementById(chartId);
  if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = chartId + '.png';
  a.click();
}

function _copyFiniteFields(src, fieldNames, labelPrefix) {
  const out = {};
  for (const field of fieldNames) {
    if (src[field] !== undefined) {
      if (!Number.isFinite(src[field])) {
        return { error: `Import failed: ${labelPrefix}${field} must be a finite number.` };
      }
      out[field] = src[field];
    }
  }
  return { fields: out };
}

function _sanitizeBullet(rawBullet, hexColorRe) {
  if (typeof rawBullet !== 'object') {
    return { error: 'Import failed: bullet must be an object.' };
  }
  if (typeof rawBullet.id !== 'string' || rawBullet.id.length > MAX_BULLET_STR_LEN) {
    return { error: 'Import failed: bullet.id must be a string of at most 200 characters.' };
  }
  if (typeof rawBullet.name !== 'string' || rawBullet.name.length > MAX_BULLET_STR_LEN) {
    return { error: 'Import failed: bullet.name must be a string of at most 200 characters.' };
  }

  const bullet = { id: rawBullet.id, name: rawBullet.name };
  if (typeof rawBullet.hexColor === 'string' && hexColorRe.test(rawBullet.hexColor)) {
    bullet.hexColor = rawBullet.hexColor;
  }

  const numeric = _copyFiniteFields(rawBullet, BULLET_NUMERIC_FIELDS, 'bullet.');
  if (numeric.error) return { error: numeric.error };
  Object.assign(bullet, numeric.fields);
  return { bullet };
}

function _sanitizeResult(item, hexColorRe) {
  if (!item || typeof item !== 'object' || !item.bullet || !item.points) {
    return { error: 'Import failed: each result must have a "bullet" and "points" property.' };
  }
  if (!Array.isArray(item.points)) {
    return { error: 'Import failed: each result "points" must be an array.' };
  }
  if (item.points.length > MAX_IMPORT_POINTS) {
    return { error: 'Import failed: a result contains more than 2000 points.' };
  }

  const bulletRes = _sanitizeBullet(item.bullet, hexColorRe);
  if (bulletRes.error) return { error: bulletRes.error };

  const resultNumeric = _copyFiniteFields(item, RESULT_NUMERIC_FIELDS, '');
  if (resultNumeric.error) return { error: resultNumeric.error };

  const points = [];
  for (const pt of item.points) {
    if (!pt || typeof pt !== 'object') {
      return { error: 'Import failed: each point must be an object.' };
    }
    const pointNumeric = _copyFiniteFields(pt, POINT_NUMERIC_FIELDS, 'point.');
    if (pointNumeric.error) return { error: pointNumeric.error };
    points.push(pointNumeric.fields);
  }

  return {
    result: {
      bullet: bulletRes.bullet,
      points,
      ...resultNumeric.fields,
    },
  };
}

function _validateImportedPayload(parsed, hexColorRe) {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { error: 'Import failed: JSON must be a non-empty array of trajectory results.' };
  }
  if (parsed.length > MAX_IMPORT_RESULTS) {
    return { error: 'Import failed: file contains more than 10 results.' };
  }

  const sanitized = [];
  for (const item of parsed) {
    const res = _sanitizeResult(item, hexColorRe);
    if (res.error) return { error: res.error };
    sanitized.push(res.result);
  }
  return { results: sanitized };
}

/**
 * Read, validate, and sanitize an imported JSON trajectory file, then invoke `onImported`.
 * @param {File|null|undefined} file
 * @param {{ hexColorRe: RegExp, setError: Function, onImported: Function }} deps
 * @returns {Promise<void>}
 */
export function importResultsFromFile(file, { hexColorRe, setError, onImported }) {
  if (!file) return Promise.resolve();
  if (file.size > MAX_IMPORT_BYTES) {
    setError('Import failed: file exceeds 5 MB limit.');
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        let parsed;
        try {
          parsed = JSON.parse(e.target.result);
        } catch (_) {
          setError('Import failed: file is not valid JSON.');
          return;
        }

        const validated = _validateImportedPayload(parsed, hexColorRe);
        if (validated.error) {
          setError(validated.error);
          return;
        }

        setError(null);
        try {
          await onImported(validated.results);
        } catch (_) {
          setError('Import failed: could not render the imported data.');
        }
      } finally {
        resolve();
      }
    };
    reader.onerror = () => {
      setError('Import failed: could not read file.');
      resolve();
    };
    reader.readAsText(file);
  });
}
