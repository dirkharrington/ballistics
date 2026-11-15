export const CUSTOM_ROUNDS_KEY   = 'bv_customRounds';
export const MAX_PRESETS         = 20;
export const PRESET_NAME_MAX     = 64;
export const DEFAULT_PRESET_NAME = 'Custom Load';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidPreset(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const { id, name, weightG, mvMps, bc, diaMm, savedAt } = obj;
  if (typeof id !== 'string' || !UUID_V4_RE.test(id)) return false;
  if (typeof name !== 'string' || name.length < 1 || name.length > 64) return false;
  if (typeof weightG !== 'number' || !isFinite(weightG) || !(weightG > 0 && weightG <= 30)) return false;
  if (typeof mvMps !== 'number' || !isFinite(mvMps) || !(mvMps > 0 && mvMps <= 2000)) return false;
  if (typeof bc !== 'number' || !isFinite(bc) || !(bc > 0 && bc <= 1.2)) return false;
  if (typeof diaMm !== 'number' || !isFinite(diaMm) || !(diaMm > 0 && diaMm <= 25)) return false;
  if (typeof savedAt !== 'string' || savedAt.length > 40 || isNaN(Date.parse(savedAt))) return false;
  return true;
}

export function loadPresets() {
  try {
    const raw = localStorage.getItem(CUSTOM_ROUNDS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidPreset)
      .slice(0, MAX_PRESETS)
      .map(({ id, name, weightG, mvMps, bc, diaMm, savedAt }) =>
        ({ id, name, weightG, mvMps, bc, diaMm, savedAt }));
  } catch {
    return [];
  }
}

export function savePreset({ name, weightG, mvMps, bc, diaMm }) {
  let trimmedName = (typeof name === 'string' ? name : '').trim();
  if (!trimmedName) trimmedName = DEFAULT_PRESET_NAME;
  if (trimmedName.length > PRESET_NAME_MAX) trimmedName = trimmedName.slice(0, PRESET_NAME_MAX);

  if (!(weightG > 0 && weightG <= 30))   return { ok: false, error: 'invalid', message: 'Weight must be greater than 0 and at most 30 g' };
  if (!(mvMps > 0 && mvMps <= 2000))     return { ok: false, error: 'invalid', message: 'Muzzle velocity must be greater than 0 and at most 2000 m/s' };
  if (!(bc > 0 && bc <= 1.2))            return { ok: false, error: 'invalid', message: 'BC must be greater than 0 and at most 1.2' };
  if (!(diaMm > 0 && diaMm <= 25))       return { ok: false, error: 'invalid', message: 'Diameter must be greater than 0 and at most 25 mm' };

  const existing = loadPresets();
  const replaceIdx = existing.findIndex(p => p.name === trimmedName);

  let preset;
  let replaced = false;
  let presets;

  if (replaceIdx !== -1) {
    preset  = { ...existing[replaceIdx], weightG, mvMps, bc, diaMm, savedAt: new Date().toISOString() };
    presets = [preset, ...existing.filter((_, i) => i !== replaceIdx)];
    replaced = true;
  } else {
    if (existing.length >= MAX_PRESETS) {
      return { ok: false, error: 'full', message: 'Preset library full (20). Delete one to save another.' };
    }
    preset  = { id: newPresetId(), name: trimmedName, weightG, mvMps, bc, diaMm, savedAt: new Date().toISOString() };
    presets = [preset, ...existing];
  }

  try {
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify(presets));
  } catch {
    return { ok: false, error: 'storage', message: 'Storage unavailable' };
  }

  return { ok: true, preset, replaced, presets };
}

export function deletePreset(id) {
  const existing = loadPresets();
  const filtered = existing.filter(p => p.id !== id);
  if (filtered.length === existing.length) return existing;
  try {
    localStorage.setItem(CUSTOM_ROUNDS_KEY, JSON.stringify(filtered));
  } catch {
    console.warn('deletePreset: localStorage unavailable');
    return existing;
  }
  return filtered;
}

export function renderPresetList(presets, handlers) {
  const section = document.getElementById('customPresetSection');
  const list    = document.getElementById('customPresetList');
  if (!section || !list) return;

  if (presets.length === 0) {
    section.hidden = true;
    list.textContent = '';
    return;
  }

  section.hidden = false;
  list.textContent = '';

  for (const p of presets) {
    const li = document.createElement('li');
    li.className = 'preset-row';
    li.dataset.presetId = p.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'preset-name';
    nameSpan.textContent = p.name;
    nameSpan.title = p.name;

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'preset-load-btn';
    loadBtn.textContent = 'Load';
    loadBtn.setAttribute('aria-label', `Load preset ${p.name}`);
    loadBtn.addEventListener('click', () => handlers.onLoad(p));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'preset-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete preset ${p.name}`);
    deleteBtn.addEventListener('click', () => handlers.onDelete(p.id));

    li.appendChild(nameSpan);
    li.appendChild(loadBtn);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  }
}

export function newPresetId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
