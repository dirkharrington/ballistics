// ── Muzzle-velocity temperature sensitivity (S23-1) ───────────────────────────
// Canonical storage is metric: sensitivity in m/s per °C, MV in m/s, temp in °C.

/** Reference temperature (°C) at which the nominal MV is quoted. */
export const MV_REF_TEMP_C = 15;

/** Absolute limits on the *displayed* value, per unit system. */
export const MV_SENS_LIMITS = Object.freeze({ metric: 5.5, imperial: 10.025 });

/**
 * MV at ambient temperature given a linear sensitivity.
 * @param {number} nominalMV
 * @param {number} sensitivity  MV change per °C
 * @param {number} ambientTempC
 * @param {number} [refTempC=15]
 */
export function effectiveMV(nominalMV, sensitivity, ambientTempC, refTempC = MV_REF_TEMP_C) {
  return nominalMV + sensitivity * (ambientTempC - refTempC);
}

/**
 * Validate the raw text of the sensitivity input (display units).
 * Empty input means "no sensitivity" (0).
 * @returns {{ ok: boolean, value?: number, error?: string }}
 */
export function validateMvSens(raw, unitSystem = 'metric') {
  const sys = unitSystem === 'imperial' ? 'imperial' : 'metric';
  const text = raw == null ? '' : String(raw).trim();
  if (text === '') return { ok: true, value: 0 };
  const num = Number(text);
  const limit = MV_SENS_LIMITS[sys];
  const unit = sys === 'imperial' ? 'fps/°F' : 'm/s/°C';
  if (!Number.isFinite(num) || Math.abs(num) > limit) {
    return { ok: false, error: `MV temp sensitivity must be a number between −${limit} and ${limit} ${unit}.` };
  }
  return { ok: true, value: num };
}

/**
 * Return `bullet` with its muzzle velocity adjusted for ambient temperature.
 * The original MV is kept as `nominalMuzzleVelocityMps` so the UI can show both.
 * Returns the same object when sensitivity is zero/absent.
 */
export function applyMvSensitivity(bullet, mvSensMps, ambientTempC) {
  if (!mvSensMps) return bullet;
  const eff = effectiveMV(bullet.muzzleVelocityMps, mvSensMps, ambientTempC);
  return { ...bullet, muzzleVelocityMps: eff, nominalMuzzleVelocityMps: bullet.muzzleVelocityMps };
}

/** Show/hide the inline error beneath the input. Returns `true` when an error is shown. */
export function showMvSensError(message) {
  const el = document.getElementById('mvSens-error');
  const input = document.getElementById('mvSens');
  if (el) el.textContent = message || '';
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  return Boolean(message);
}
