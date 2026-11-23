// ── Scope click values for DOPE (S23-3) ───────────────────────────────────────

/** 1 MRAD expressed in MOA. */
export const MOA_PER_MRAD = 3.43775;

const CLICK_VALUE_DEFAULT        = '0.25moa';

/** Preset click values: id → { moa per click, label }. */
export const CLICK_PRESETS = Object.freeze({
  '0.25moa':  Object.freeze({ moa: 0.25,                 label: '¼ MOA' }),
  '0.5moa':   Object.freeze({ moa: 0.5,                  label: '½ MOA' }),
  '1moa':     Object.freeze({ moa: 1,                    label: '1 MOA' }),
  '0.1mrad':  Object.freeze({ moa: 0.1 * MOA_PER_MRAD,   label: '0.1 MRAD' }),
  '0.05mrad': Object.freeze({ moa: 0.05 * MOA_PER_MRAD,  label: '0.05 MRAD' }),
});

export const CLICK_VALUE_IDS = Object.freeze([...Object.keys(CLICK_PRESETS), 'custom']);

/** Whole clicks needed for an angle (MOA) at `clickMOA` per click. */
export function toClicks(angleMOA, clickMOA) {
  if (!clickMOA || clickMOA <= 0) throw new Error('clickMOA must be positive');
  return Math.round(angleMOA / clickMOA) + 0;
}

/**
 * Resolve a select value (+ custom MOA value) to MOA per click.
 * Unknown ids and invalid custom values fall back to the default ¼ MOA.
 */
export function clickValueToMoa(id, customMoa) {
  if (id === 'custom') {
    return Number.isFinite(customMoa) && customMoa > 0 ? customMoa : CLICK_PRESETS[CLICK_VALUE_DEFAULT].moa;
  }
  return (CLICK_PRESETS[id] ?? CLICK_PRESETS[CLICK_VALUE_DEFAULT]).moa;
}

/** Human label such as "¼ MOA" or "0.3 MOA (custom)". */
export function clickLabel(id, customMoa) {
  if (id === 'custom') return `${clickValueToMoa(id, customMoa)} MOA (custom)`;
  return (CLICK_PRESETS[id] ?? CLICK_PRESETS[CLICK_VALUE_DEFAULT]).label;
}

/** Elevation clicks: `+N U`, `N D`, or `0`. Positive MOA = dial up. */
export function formatElevClicks(clicks) {
  if (clicks > 0) return `+${clicks} U`;
  if (clicks < 0) return `${Math.abs(clicks)} D`;
  return '0';
}

/**
 * Windage clicks: `N R`, `N L`, or `0`.
 * Positive input = dial right, negative = dial left.
 */
export function formatWindClicks(clicks) {
  if (clicks > 0) return `${clicks} R`;
  if (clicks < 0) return `${Math.abs(clicks)} L`;
  return '0';
}

/** Show the custom input only when "Custom…" is selected. */
export function syncClickCustomVisibility() {
  const sel = document.getElementById('clickValue');
  const custom = document.getElementById('clickValueCustom');
  if (sel && custom) custom.style.display = sel.value === 'custom' ? '' : 'none';
}

/** Read the active click size from the DOM: { id, moa, label }. */
export function readClickValue() {
  const id = document.getElementById('clickValue')?.value ?? CLICK_VALUE_DEFAULT;
  const customRaw = document.getElementById('clickValueCustom')?.value;
  const custom = customRaw === undefined || customRaw === '' ? NaN : Number(customRaw);
  return { id, moa: clickValueToMoa(id, custom), label: clickLabel(id, custom) };
}
