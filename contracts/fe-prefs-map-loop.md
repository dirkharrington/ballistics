# Contract: `savePrefs()`/`loadPrefs()` map-driven loop (FE-R2)

Version: 1.0.0 — 2026-11-01
Owner of the implementation: frontend builder. devsecops reviews it.

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Deviations from the original brief

None.

## Problem

`savePrefs()` (lines 1102–1118) and `loadPrefs()` (lines 1126–1153) contain 10 hardcoded per-key `localStorage` calls each.  
Adding a new preference requires editing both functions plus `PREF_KEYS` and `PREF_DEFAULTS` — four separate places.

## Constraints

- `PREF_KEYS` and `PREF_DEFAULTS` already exist as module-level constants and are exported: `url-state.js` reads `PREF_KEYS`. Key names and constant names must not change.
- `selectedIds` is special: it is stored as JSON and read back with `JSON.parse`. Its save and load logic must remain separate from the generic loop.
- All other keys (`zero`, `maxRange`, `wind`, `windDir`, `altitude`, `temp`, `step`, `sightHeight`, `angle`, `dragModel`) follow a uniform pattern: save via `String(value)`, load via `+(stored ?? default)` for numeric keys or `stored ?? default` for string keys.
- Behaviour change: none. Same keys, same defaults, same fallback logic, same try/catch wrapper.

## Key classification

```
selectedIds   — JSON-encoded Array  (handle separately; not part of the loop)
dragModel     — plain string        (load: stored ?? default)
all others    — numeric             (load: +(stored ?? default))
```

The loop body needs to know whether a key is numeric or string-valued.  
Use the existing `PREF_DEFAULTS` value type: `typeof PREF_DEFAULTS[k] === 'number'` is `true` for numeric keys.

## Refactored `savePrefs()`

```js
function savePrefs() {
  try {
    localStorage.setItem(PREF_KEYS.selectedIds, JSON.stringify([...selectedIds]));
    for (const k of Object.keys(PREF_DEFAULTS).filter(k => k !== 'selectedIds')) {
      const domId = DOM_ID_FOR_PREF[k];                          // see §DOM-id map
      const value = (domId ? document.getElementById(domId)?.value : null)
                    ?? String(PREF_DEFAULTS[k]);
      localStorage.setItem(PREF_KEYS[k], value);
    }
  } catch (e) {
    console.warn('localStorage unavailable — preferences not saved', e);
  }
}
```

Loop body: `≤ 5 lines` (the loop header counts as 1; each statement inside counts as 1).

## Refactored `loadPrefs()`

```js
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEYS.selectedIds);
    let savedIds;
    try {
      savedIds = raw !== null ? JSON.parse(raw) : null;
      if (!Array.isArray(savedIds)) savedIds = null;
    } catch (_) { savedIds = null; }

    const prefs = { selectedIds: savedIds };
    for (const k of Object.keys(PREF_DEFAULTS).filter(k => k !== 'selectedIds')) {
      const stored = localStorage.getItem(PREF_KEYS[k]);
      prefs[k] = typeof PREF_DEFAULTS[k] === 'number'
        ? +(stored ?? PREF_DEFAULTS[k])
        : (stored ?? PREF_DEFAULTS[k]);
    }
    return prefs;
  } catch (e) {
    console.warn('localStorage unavailable — using defaults', e);
    return { ...PREF_DEFAULTS };
  }
}
```

Loop body: `≤ 5 lines`.

## DOM-id map

The current `savePrefs()` maps pref keys to DOM element IDs.  
Encode that mapping as a module-level constant so the loop can look it up:

```js
const DOM_ID_FOR_PREF = {
  zero:        'zeroRange',
  maxRange:    'maxRange',
  wind:        'windSpeed',
  windDir:     'windDir',
  altitude:    'altitude',
  temp:        'temperature',
  step:        'step',
  sightHeight: 'sightHeight',
  angle:       'shootingAngle',
  dragModel:   'dragModel',
};
```

`selectedIds` is absent (it is not read from a DOM input).  
This constant is not exported; it lives adjacent to `PREF_KEYS` / `PREF_DEFAULTS`.

## Adding a new preference (acceptance criterion)

A developer adding a new preference must:
1. Add one entry to `PREF_KEYS` (the `localStorage` key string).
2. Add one entry to `PREF_DEFAULTS` (the default value, typed correctly).
3. Add one entry to `DOM_ID_FOR_PREF` (the DOM element id, or omit if there is no input element).

No other edits to `savePrefs()` or `loadPrefs()` are required.

## Acceptance checklist

- [ ] All existing Jest tests for `savePrefs` and `loadPrefs` pass without modification.
- [ ] `savePrefs()` body (excluding the outer try/catch header and the `selectedIds` line) is a single loop of ≤ 5 lines.
- [ ] `loadPrefs()` body (excluding the `selectedIds` block) is a single loop of ≤ 5 lines.
- [ ] Behaviour parity: `loadPrefs()` returns an object with the same keys and value types as the original for every PREF_DEFAULTS entry.
- [ ] `url-state.js` compiles and its tests pass without modification (key names unchanged).
- [ ] `savePrefs()` called with a DOM environment sets all 10 non-`selectedIds` keys in `localStorage` with the expected string values.
- [ ] `loadPrefs()` with an empty `localStorage` returns the same object as `{ ...PREF_DEFAULTS }` (selectedIds: null).
- [ ] `loadPrefs()` with all keys present in `localStorage` returns parsed numeric values for numeric fields and raw strings for `dragModel`.
- [ ] Adding a new entry to `PREF_KEYS`, `PREF_DEFAULTS`, and `DOM_ID_FOR_PREF` causes `savePrefs()`/`loadPrefs()` to persist and restore it without any other code change.
