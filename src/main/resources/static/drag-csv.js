const MIN_POINTS = 3;
const MAX_POINTS = 100;
const MACH_MIN   = 0.0;
const MACH_MAX   = 5.0;
const CD_MIN     = 0.001;
const CD_MAX     = 2.0;
const LOW_MACH_THRESHOLD  = 0.5;
const HIGH_MACH_THRESHOLD = 2.0;

/**
 * Parse a user-supplied CSV text into a validated drag table array.
 * Expects a header row with Mach/mach and CD/cd columns (in either order).
 * Throws Error with a descriptive message on any validation failure.
 *
 * @param {string} text - raw CSV file content
 * @returns {{ mach: number, cd: number }[]}
 */
export function parseDragCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least 3 data rows.');
  }

  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').trim().toLowerCase());
  const machIdx = header.indexOf('mach');
  const cdIdx   = header.indexOf('cd');
  if (machIdx === -1) throw new Error('CSV header must contain a "Mach" column.');
  if (cdIdx   === -1) throw new Error('CSV header must contain a "CD" column.');

  const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, '').trim());
    const machRaw = cells[machIdx];
    const cdRaw   = cells[cdIdx];

    if (!DECIMAL_RE.test(machRaw)) {
      throw new Error(`Row ${i}: mach value "${machRaw}" is not a valid decimal number.`);
    }
    if (!DECIMAL_RE.test(cdRaw)) {
      throw new Error(`Row ${i}: CD value "${cdRaw}" is not a valid decimal number.`);
    }

    const mach = Number(machRaw);
    const cd   = Number(cdRaw);
    if (mach < MACH_MIN || mach > MACH_MAX) {
      throw new Error(`Row ${i}: mach ${mach} is out of range [${MACH_MIN}, ${MACH_MAX}].`);
    }
    if (cd < CD_MIN || cd > CD_MAX) {
      throw new Error(`Row ${i}: CD ${cd} is out of range [${CD_MIN}, ${CD_MAX}].`);
    }
    points.push({ mach, cd });
  }

  if (points.length < MIN_POINTS) {
    throw new Error(`CSV must have at least ${MIN_POINTS} data rows; got ${points.length}.`);
  }
  if (points.length > MAX_POINTS) {
    throw new Error(`CSV must have at most ${MAX_POINTS} data rows; got ${points.length}.`);
  }

  for (let i = 1; i < points.length; i++) {
    if (points[i].mach <= points[i - 1].mach) {
      throw new Error(
        `customDragTable validation error: mach values must be strictly increasing, ` +
        `got ${points[i - 1].mach} at index ${i - 1} followed by ${points[i].mach} at index ${i}.`
      );
    }
  }

  const hasLow  = points.some(p => p.mach <= LOW_MACH_THRESHOLD);
  const hasHigh = points.some(p => p.mach >= HIGH_MACH_THRESHOLD);
  if (!hasLow) {
    throw new Error(`CSV must include at least one point with mach ≤ ${LOW_MACH_THRESHOLD} (subsonic coverage).`);
  }
  if (!hasHigh) {
    throw new Error(`CSV must include at least one point with mach ≥ ${HIGH_MACH_THRESHOLD} (supersonic coverage).`);
  }

  return points;
}
