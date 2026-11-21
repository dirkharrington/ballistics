// ── Custom Bullet Catalog (UX-1) ──────────────────────────────────────────────
// This module handles schema, validation, storage, conversion, merge, and
// custom-group DOM rendering for user-defined bullets.
// It NEVER imports from ballistics.js (no import cycles).

// ── Constants ─────────────────────────────────────────────────────────────────

export const CUSTOM_BULLETS_KEY    = 'ballistics:custom-bullets:v1';
export const CUSTOM_BULLET_ID_RE   = /^usr-[0-9a-f]{16}$/;
export const MAX_CUSTOM_BULLETS    = 50;

export const CUSTOM_BULLET_LIMITS  = Object.freeze({
  bulletWeightGrains:     { min: 1,    max: 1000 },
  ballisticCoefficientG1: { min: 0.01, max: 1.2  },
  ballisticCoefficientG7: { min: 0.01, max: 1.0  },
  bulletDiameterInches:   { min: 0.1,  max: 1.0  },
  muzzleVelocityFps:      { min: 300,  max: 5000 },
});

export const CUSTOM_BULLET_PALETTE = Object.freeze([
  '#F472B6', '#38BDF8', '#FACC15', '#C084FC',
  '#22D3EE', '#FB7185', '#A3E635', '#FDBA74',
]);

// Unit conversion constants (exact by definition)
export const GRAINS_TO_GRAMS = 0.06479891;
export const FPS_TO_MPS      = 0.3048;
export const INCH_TO_MM      = 25.4;

// Forbidden chars: C0/C1 controls and bidi overrides
const FORBIDDEN_CHARS_RE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

// ── Id helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a new unique custom bullet id of the form `usr-<16 hex chars>`.
 * Regenerates if the generated id is already in existingIds.
 */
export function newCustomBulletId(existingIds) {
  while (true) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const id = 'usr-' + hex;
    if (!existingIds.has(id)) return id;
  }
}

/** Returns true if id matches the custom bullet id pattern. */
export function isCustomBulletId(id) {
  return CUSTOM_BULLET_ID_RE.test(id);
}

// ── Colour ────────────────────────────────────────────────────────────────────

/**
 * Returns a stable colour from CUSTOM_BULLET_PALETTE for the given custom id.
 * Uses the first 8 hex digits of the id (after the 'usr-' prefix).
 */
export function customColor(id) {
  const idx = parseInt(id.slice(4, 12), 16) % CUSTOM_BULLET_PALETTE.length;
  return CUSTOM_BULLET_PALETTE[idx];
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validates a raw form input object against schema rules.
 * raw: { name, shortName, bulletWeightGrains, ballisticCoefficientG1,
 *        ballisticCoefficientG7, bulletDiameterInches, muzzleVelocityFps }
 *   -- all strings from inputs
 * ctx: { records, builtInNames, editingId }
 * Returns { ok: true, value } or { ok: false, errors: [{field, message}] }
 */
export function validateCustomBulletInput(raw, ctx) {
  const errors = [];
  const { records, builtInNames, editingId } = ctx;

  // Numeric parsing helper
  function parseNumericField(key, label, required) {
    const t = (raw[key] ?? '').trim();
    if (t === '') {
      /* istanbul ignore else -- optional-field callers guard the blank case before invoking */
      if (required) errors.push({ field: key, message: `${label} is required` });
      return null;
    }
    if (!/^(?:\d{1,5}(?:\.\d{1,6})?|\.\d{1,6})$/.test(t)) {
      errors.push({ field: key, message: `${label} must be a number` });
      return null;
    }
    const n = Number(t);
    const lim = CUSTOM_BULLET_LIMITS[key];
    if (lim && (n < lim.min || n > lim.max)) {
      errors.push({ field: key, message: `${label} must be between ${lim.min} and ${lim.max}` });
      return null;
    }
    return n;
  }

  // Name field
  const nameRaw = (raw.name ?? '').trim();
  if (nameRaw === '') {
    errors.push({ field: 'name', message: 'Name is required' });
  } else if (nameRaw.length > 64) {
    errors.push({ field: 'name', message: 'Name must be 64 characters or fewer' });
  } else if (FORBIDDEN_CHARS_RE.test(nameRaw)) {
    errors.push({ field: 'name', message: 'Name contains invalid characters' });
  } else {
    const nameLc = nameRaw.toLowerCase();
    if (builtInNames.some(n => n.toLowerCase() === nameLc)) {
      errors.push({ field: 'name', message: 'Name matches a built-in bullet' });
    } else {
      const duplicate = records.find(r => r.id !== editingId && r.name.toLowerCase() === nameLc);
      if (duplicate) {
        errors.push({ field: 'name', message: 'A custom bullet with this name already exists' });
      }
    }
  }

  // Short name field
  const shortNameRaw = (raw.shortName ?? '').trim();
  if (shortNameRaw === '') {
    errors.push({ field: 'shortName', message: 'Short name is required' });
  } else if (shortNameRaw.length > 16) {
    errors.push({ field: 'shortName', message: 'Short name must be 16 characters or fewer' });
  } else if (FORBIDDEN_CHARS_RE.test(shortNameRaw)) {
    errors.push({ field: 'shortName', message: 'Short name contains invalid characters' });
  }

  // Numeric fields
  const bulletWeightGrains     = parseNumericField('bulletWeightGrains',     'Mass',            true);
  const ballisticCoefficientG1 = parseNumericField('ballisticCoefficientG1', 'BC G1',           true);
  const bcG7Raw                = (raw.ballisticCoefficientG7 ?? '').trim();
  let   ballisticCoefficientG7 = null;
  if (bcG7Raw !== '') {
    ballisticCoefficientG7 = parseNumericField('ballisticCoefficientG7', 'BC G7', false);
  }
  const bulletDiameterInches   = parseNumericField('bulletDiameterInches',   'Diameter',        true);
  const muzzleVelocityFps      = parseNumericField('muzzleVelocityFps',      'Muzzle velocity', true);

  // Form-level: bullet limit (only for add, not edit)
  if (editingId == null && records.length >= MAX_CUSTOM_BULLETS) {
    errors.push({ field: 'form', message: 'Custom bullet limit reached (50). Delete one to add another.' });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name:                   nameRaw,
      shortName:              shortNameRaw,
      bulletWeightGrains,
      ballisticCoefficientG1,
      ballisticCoefficientG7: bcG7Raw === '' ? null : ballisticCoefficientG7,
      bulletDiameterInches,
      muzzleVelocityFps,
    },
  };
}

// ── Drag table validation (ENH-5) ─────────────────────────────────────────────

/** Validate a custom Mach→Cd drag table array (3–100 strictly increasing points). */
export function isValidCustomDragTable(arr) {
  if (!Array.isArray(arr) || arr.length < 3 || arr.length > 100) return false;
  for (const p of arr) {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return false;
    if (typeof p.mach !== 'number' || !Number.isFinite(p.mach) || p.mach < 0 || p.mach > 5) return false;
    if (typeof p.cd   !== 'number' || !Number.isFinite(p.cd)   || p.cd   < 0.001 || p.cd > 2) return false;
  }
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].mach <= arr[i - 1].mach) return false;
  }
  if (!arr.some(p => p.mach <= 0.5)) return false;
  if (!arr.some(p => p.mach >= 2.0)) return false;
  return true;
}

// ── Storage-side validation ───────────────────────────────────────────────────

/** Validates a parsed record from storage against the schema. Returns boolean. */
export function isValidCustomBulletRecord(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.id !== 'string' || !CUSTOM_BULLET_ID_RE.test(obj.id)) return false;

  // name
  if (typeof obj.name !== 'string') return false;
  if (obj.name.trim() !== obj.name) return false;
  if (obj.name.length === 0 || obj.name.length > 64) return false;
  if (FORBIDDEN_CHARS_RE.test(obj.name)) return false;

  // shortName
  if (typeof obj.shortName !== 'string') return false;
  if (obj.shortName.trim() !== obj.shortName) return false;
  if (obj.shortName.length === 0 || obj.shortName.length > 16) return false;
  if (FORBIDDEN_CHARS_RE.test(obj.shortName)) return false;

  // Required numeric fields
  const numericFields = [
    ['bulletWeightGrains',     CUSTOM_BULLET_LIMITS.bulletWeightGrains],
    ['ballisticCoefficientG1', CUSTOM_BULLET_LIMITS.ballisticCoefficientG1],
    ['bulletDiameterInches',   CUSTOM_BULLET_LIMITS.bulletDiameterInches],
    ['muzzleVelocityFps',      CUSTOM_BULLET_LIMITS.muzzleVelocityFps],
  ];
  for (const [field, lim] of numericFields) {
    const v = obj[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lim.min || v > lim.max) return false;
  }

  // ballisticCoefficientG7: must be explicitly present as null or valid number
  if (!('ballisticCoefficientG7' in obj)) return false;
  const g7 = obj.ballisticCoefficientG7;
  if (g7 !== null) {
    if (typeof g7 !== 'number') return false;
    if (!Number.isFinite(g7)) return false;
    const lim = CUSTOM_BULLET_LIMITS.ballisticCoefficientG7;
    if (g7 < lim.min || g7 > lim.max) return false;
  }

  // customDragTable: optional; when present and non-null, must be valid
  if (obj.customDragTable !== undefined && obj.customDragTable !== null) {
    if (!isValidCustomDragTable(obj.customDragTable)) return false;
  }

  return true;
}

// ── localStorage I/O ──────────────────────────────────────────────────────────

/**
 * Load custom bullets from localStorage.
 * Never throws. Returns { records, status: 'ok'|'empty'|'corrupt'|'unavailable' }.
 */
export function loadCustomBullets() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BULLETS_KEY);
    if (raw === null) return { records: [], status: 'empty' };

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return { records: [], status: 'corrupt' };
    }
    if (!Array.isArray(parsed)) return { records: [], status: 'corrupt' };

    // Filter and deduplicate
    const seenIds   = new Set();
    const seenNames = new Set();
    const records   = [];

    for (const item of parsed) {
      if (!isValidCustomBulletRecord(item)) continue;
      if (seenIds.has(item.id)) continue;
      const nameLc = item.name.toLowerCase();
      if (seenNames.has(nameLc)) continue;
      if (records.length >= MAX_CUSTOM_BULLETS) break;

      seenIds.add(item.id);
      seenNames.add(nameLc);
      // Rebuild with only the allowed schema properties (strips extra/prototype keys)
      records.push({
        id:                     item.id,
        name:                   item.name,
        shortName:              item.shortName,
        bulletWeightGrains:     item.bulletWeightGrains,
        ballisticCoefficientG1: item.ballisticCoefficientG1,
        ballisticCoefficientG7: item.ballisticCoefficientG7,
        bulletDiameterInches:   item.bulletDiameterInches,
        muzzleVelocityFps:      item.muzzleVelocityFps,
        ...(item.customDragTable ? { customDragTable: item.customDragTable.map(p => ({ mach: p.mach, cd: p.cd })) } : {}),
      });
    }

    return { records, status: 'ok' };
  } catch (_) {
    return { records: [], status: 'unavailable' };
  }
}

/**
 * Save custom bullets to localStorage.
 * Never throws. Returns { ok: true } or { ok: false, error: 'storage' }.
 */
export function saveCustomBullets(records) {
  try {
    window.localStorage.setItem(CUSTOM_BULLETS_KEY, JSON.stringify(records));
    return { ok: true };
  } catch (e) {
    console.warn('Custom bullets: storage write failed', e);
    return { ok: false, error: 'storage' };
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Insert or update a record. Never mutates input.
 * editingId == null -> append. editingId set -> replace at same index.
 */
export function upsertCustomBullet(records, value, editingId) {
  const cleanValue = { ...value };
  if (cleanValue.customDragTable == null) delete cleanValue.customDragTable;
  if (editingId == null) {
    const existingIds = new Set(records.map(r => r.id));
    const id = newCustomBulletId(existingIds);
    return [...records, { id, ...cleanValue }];
  }
  const idx = records.findIndex(r => r.id === editingId);
  if (idx === -1) return [...records];
  const next = [...records];
  const updated = { ...records[idx], ...cleanValue, id: editingId };
  if (value.customDragTable === null) delete updated.customDragTable;
  next[idx] = updated;
  return next;
}

/**
 * Remove a record by id. Never mutates input.
 * Unknown id -> returns a copy unchanged.
 */
export function removeCustomBullet(records, id) {
  return records.filter(r => r.id !== id);
}

// ── Conversion ────────────────────────────────────────────────────────────────

/** Convert a CustomBulletRecordV1 to a Bullet-compatible runtime object. */
export function toBullet(record) {
  const bulletWeightGrams  = record.bulletWeightGrains * GRAINS_TO_GRAMS;
  const muzzleVelocityMps  = record.muzzleVelocityFps  * FPS_TO_MPS;
  const bulletDiameterMm   = record.bulletDiameterInches * INCH_TO_MM;
  const muzzleEnergyJoules = Math.round(0.5 * (bulletWeightGrams / 1000) * muzzleVelocityMps ** 2);

  return {
    id:                       record.id,
    name:                     record.name,
    caliber:                  'Custom',
    bulletWeightGrams,
    muzzleVelocityMps,
    ballisticCoefficient:     record.ballisticCoefficientG1,
    bulletDiameterMm,
    muzzleEnergyJoules,
    hexColor:                 customColor(record.id),
    // Extension properties
    shortName:                record.shortName,
    ballisticCoefficientG7:   record.ballisticCoefficientG7,
    source:                   'custom',
    ...(record.customDragTable ? { customDragTable: record.customDragTable } : {}),
  };
}

/**
 * Merge built-in bullets with custom records.
 * Returns [ ...builtIns, ...customs ] (defensive dedup by id).
 */
export function mergeCatalog(builtIns, records) {
  const builtInIds = new Set(builtIns.map(b => b.id));
  const customs    = records
    .filter(r => !builtInIds.has(r.id))
    .map(toBullet);
  return [...builtIns, ...customs];
}

// ── Drag-model BC resolution ──────────────────────────────────────────────────

/**
 * If dragModel is 'G7' and the bullet has a numeric G7 BC, return a copy with
 * ballisticCoefficient replaced by the G7 value. Otherwise return the same ref.
 */
export function bulletForDragModel(bullet, dragModel) {
  if (dragModel === 'G7' && typeof bullet.ballisticCoefficientG7 === 'number') {
    return { ...bullet, ballisticCoefficient: bullet.ballisticCoefficientG7 };
  }
  return bullet;
}

// ── DOM rendering (custom group, no innerHTML) ────────────────────────────────

/**
 * Append the custom bullet group to listEl.
 * ctx: { selectedIds, storageStatus, onToggle, onEdit, onDelete }
 */
export function renderCustomBulletGroup(listEl, customBullets, ctx) {
  const { selectedIds, storageStatus, onToggle, onEdit, onDelete } = ctx;

  const group = document.createElement('div');
  group.id = 'customBulletGroup';
  group.className = 'bullet-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', 'customBulletsHeading');

  const heading = document.createElement('div');
  heading.id = 'customBulletsHeading';
  heading.className = 'bullet-group-label';
  heading.textContent = 'Custom bullets';
  group.appendChild(heading);

  if (storageStatus === 'unavailable') {
    const notice = document.createElement('p');
    notice.className = 'bullet-group-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = 'Custom bullets unavailable: browser storage is blocked.';
    group.appendChild(notice);
  } else if (customBullets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'bullet-group-empty';
    empty.textContent = 'No custom bullets yet.';
    group.appendChild(empty);
  }

  let customIdx = 0;
  for (const b of customBullets) {
    const isSelected = selectedIds.has(b.id);

    const displayGrains = String(Math.round(b.bulletWeightGrams / GRAINS_TO_GRAMS));
    const displayFps    = String(Math.round(b.muzzleVelocityMps / FPS_TO_MPS));
    const displayBcG1   = String(b.ballisticCoefficient);

    const card = document.createElement('div');
    card.id = 'card-' + b.id;
    card.className = 'bullet-card bullet-card--custom' + (isSelected ? ' active' : '');
    card.style.setProperty('--bullet-color', customColor(b.id));
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', customIdx === 0 ? '0' : '-1');
    customIdx++;
    card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    card.addEventListener('click', () => {
      syncCustomRovingTabindex(group, card);
      onToggle(b.id);
    });
    card.addEventListener('focusin', e => {
      if (!e.target.closest('button')) {
        syncCustomRovingTabindex(group, card);
      }
    });
    card.addEventListener('keydown', e => {
      if (e.target.closest('button')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(b.id);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const visible = [...group.querySelectorAll('.bullet-card--custom')].filter(c => !c.hidden);
        /* istanbul ignore next -- card receiving keydown is always visible in DOM */
        if (visible.length === 0) return;
        e.preventDefault();
        const cur = visible.indexOf(card);
        /* istanbul ignore next -- cur is >= 0 for a visible card in group */
        const base = cur === -1 ? 0 : cur;
        let nextIdx = base;
        if (e.key === 'ArrowDown') nextIdx = Math.min(base + 1, visible.length - 1);
        else if (e.key === 'ArrowUp') nextIdx = Math.max(base - 1, 0);
        else if (e.key === 'Home') nextIdx = 0;
        else nextIdx = visible.length - 1;
        syncCustomRovingTabindex(group, visible[nextIdx]);
        visible[nextIdx].focus();
      }
    });

    const nameEl = document.createElement('div');
    nameEl.className = 'bullet-name';
    nameEl.textContent = b.name;
    card.appendChild(nameEl);

    const specs = document.createElement('div');
    specs.className = 'bullet-specs';
    let specText = `${b.shortName} · ${displayGrains} gr · ${displayFps} fps · G1 ${displayBcG1}`;
    if (b.ballisticCoefficientG7 != null) {
      specText += ` · G7 ${b.ballisticCoefficientG7}`;
    }
    if (b.customDragTable) {
      specText += ' · CSV';
    }
    specs.textContent = specText;
    card.appendChild(specs);

    const actions = document.createElement('div');
    actions.className = 'bullet-card-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'bullet-edit-btn';
    editBtn.textContent = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit ' + b.name);
    editBtn.addEventListener('click', e => { e.stopPropagation(); onEdit(b.id); });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'bullet-delete-btn';
    delBtn.textContent = 'Delete';
    delBtn.setAttribute('aria-label', 'Delete ' + b.name);
    if (isSelected) {
      delBtn.disabled = true;
      delBtn.title = 'Deselect this bullet to delete it';
    }
    delBtn.addEventListener('click', e => { e.stopPropagation(); onDelete(b.id); });
    actions.appendChild(delBtn);

    card.appendChild(actions);

    const check = document.createElement('div');
    check.className = 'check';
    check.setAttribute('aria-hidden', 'true');
    card.appendChild(check);

    group.appendChild(card);
  }

  listEl.appendChild(group);
}

/**
 * Keep roving tabindex valid among visible custom bullet cards inside containerEl.
 * Ensures at most one visible card has tabindex="0" and all others have tabindex="-1".
 */
export function syncCustomRovingTabindex(containerEl, preferredCard = null) {
  if (!containerEl) return;
  const cards = [...containerEl.querySelectorAll('.bullet-card--custom')];
  if (cards.length === 0) return;
  const visible = cards.filter(c => !c.hidden);
  let target = null;
  if (preferredCard && !preferredCard.hidden && visible.includes(preferredCard)) {
    target = preferredCard;
  } else if (visible.length > 0) {
    target = visible.find(c => c.getAttribute('tabindex') === '0') || visible[0];
  }
  for (const c of cards) {
    c.setAttribute('tabindex', c === target ? '0' : '-1');
  }
}

/**
 * Update delete button disabled/title/confirming state to match current selectedIds.
 * Also resets any .confirming button.
 * No-op if listEl is null/undefined.
 */
export function syncCustomDeleteGuards(listEl, selectedIds) {
  if (!listEl) return;
  listEl.querySelectorAll('.bullet-card--custom').forEach(card => {
    const id = card.id.replace(/^card-/, '');
    const delBtn = card.querySelector('.bullet-delete-btn');
    if (!delBtn) return;
    // Reset confirming state
    if (delBtn.classList.contains('confirming')) {
      delBtn.classList.remove('confirming');
      delBtn.textContent = 'Delete';
      const name = card.querySelector('.bullet-name')?.textContent ?? '';
      delBtn.setAttribute('aria-label', 'Delete ' + name);
    }
    // Update disabled
    if (selectedIds.has(id)) {
      delBtn.disabled = true;
      delBtn.title = 'Deselect this bullet to delete it';
    } else {
      delBtn.disabled = false;
      delBtn.title = '';
    }
  });
}
