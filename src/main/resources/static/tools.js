'use strict';

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

// ── DOM wiring ────────────────────────────────────────────────────────────────

function initTools() {
  const calcBtn = document.getElementById('toolCalcBtn');
  const unitBtn = document.getElementById('unitCalcBtn');

  calcBtn?.addEventListener('click', () => {
    const drop  = parseFloat(document.getElementById('toolDrop').value)  || 0;
    const range = parseFloat(document.getElementById('toolRange').value) || 100;
    const { moa, mrad } = calcMoaMrad(drop, range);
    document.getElementById('toolResults').innerHTML =
      `<span class="tool-label">MOA</span><span class="tool-value">${moa}</span>` +
      `<span class="tool-label">MRAD</span><span class="tool-value">${mrad}</span>`;
  });

  unitBtn?.addEventListener('click', () => {
    const value  = parseFloat(document.getElementById('unitValue').value);
    const from   = document.getElementById('unitFrom').value;
    const to     = document.getElementById('unitTo').value;
    const result = convertUnit(value, from, to);
    document.getElementById('unitResults').innerHTML = result !== null
      ? `<span class="tool-label">${to}</span><span class="tool-value">${result}</span>`
      : `<span class="tool-value" style="color:var(--warn)">Unsupported conversion</span>`;
  });
}

export { calcMoaMrad, convertUnit, initTools, CONVERSIONS };
