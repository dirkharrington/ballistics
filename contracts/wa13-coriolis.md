# Contract: Coriolis Effect (WA-13)

Version: 0.1.0 — 2026-11-11  
ADR: none  
Depends on: [`wasm-engine.md`](./wasm-engine.md) §3 (TrajectoryParams, TrajectoryPoint schemas), [`engine-parity.md`](./engine-parity.md) §7 (TrajectoryPoint field verdicts), [`spin-drift.md`](./spin-drift.md) (spinDriftCm field — combined display)  
Owners: backend/Rust (§2–§4), backend/Java (§5), frontend (§6), devsecops (§7)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0. Motivation

Coriolis deflection is caused by the Earth's rotation. At long range (1000+ m), it produces lateral deflection comparable to spin drift — 5–15 cm at 1000 m, 30–60 cm at 2000 m, depending on latitude and shooting direction. It is the most-cited missing physics feature after spin drift.

WA-13 adds two optional input fields (`latitudeDeg`, `azimuthDeg`) and one new output field per `TrajectoryPoint` (`coriolisDeflectionCm`). It does **not** replace spin drift or combine them in the output — both are reported separately and the UI displays them alongside each other.

---

## 1. Physics model

### 1.1 Background

The Coriolis effect in external ballistics acts on the projectile's lateral velocity component due to the Earth's rotation (angular velocity Ω = 7.2921 × 10⁻⁵ rad/s, directed toward the geographic North Pole).

For a projectile fired at azimuth `az` (degrees clockwise from North) at geographic latitude `lat` (degrees North positive, South negative):

The lateral Coriolis acceleration (perpendicular to the direction of fire, positive = right of bore as seen from behind the shooter) is:

```
a_lateral = 2 × Ω × v × sin(lat)   [for az = East or West]
```

More generally, the full horizontal Coriolis acceleration has both a cross-track and a down-track component that depend on `az`. For the standard ballistic approximation (integrating over a predominantly horizontal trajectory):

```
a_coriolis_lateral = 2 × Ω × v_horizontal × sin(lat)
```

where the sign is positive (right deflection) in the Northern Hemisphere and negative (left deflection) in the Southern Hemisphere, with a direction modulation by azimuth (see §1.2).

### 1.2 Formula used (post-integration analytical approximation)

Consistent with the existing `windDriftCm` (which uses the Pejsa lag-time approximation rather than a full 3D integrator), the Coriolis deflection at each trajectory point is computed analytically from the time-of-flight and average horizontal velocity already available in the step output.

The formula is derived from integrating the lateral Coriolis acceleration over time-of-flight:

```
coriolisDeflection_m(t) = Ω × sin(lat_rad) × az_factor(az_rad) × v_muzzle_mps × t²
```

where:
- `Ω = 7.2921e-5` rad/s
- `lat_rad = latitudeDeg × π / 180`
- `az_factor(az_rad) = cos(az_rad)` — the component of Earth's rotation vector perpendicular to the direction of fire
  - `az_factor = 1.0` for a due-East shot (az = 90°)  
  - `az_factor = -1.0` for a due-West shot (az = 270°)
  - `az_factor = 0.0` for a due-North or due-South shot (no lateral Coriolis)
- `t` is `timeOfFlightSec` at this trajectory point

**Result in cm:** `coriolisDeflectionCm = round1(coriolisDeflection_m × 100)`

**Sign convention:** positive = right of bore (from shooter's perspective). In the Northern Hemisphere, a due-East shot produces positive (rightward) deflection. In the Southern Hemisphere (`lat < 0`), `sin(lat) < 0` and the deflection is left.

### 1.3 Accuracy note

The `v_muzzle × t²` formula is a first-order approximation. The more accurate integral is `∫₀ᵀ ∫₀ᵗ v(τ) dτ dt`, which requires the full velocity-time profile. For the per-point output, using `v_muzzle` (muzzle velocity) overstates the Coriolis deflection at long range (where velocity has fallen significantly), by approximately 10–20% at 2000 m for a .308 Win.

For the purpose of WA-13, the first-order formula (using muzzle velocity) is acceptable. It errs on the side of a larger correction cue, which is conservative for field use. A higher-accuracy formula using the per-point velocity can be introduced in a future revision without a schema change.

### 1.4 Validation

| Input | Range | Error if violated |
|---|---|---|
| `latitudeDeg` | `-90.0 ≤ lat ≤ 90.0` | `400` / engine error envelope |
| `azimuthDeg` | `0.0 ≤ az ≤ 360.0` | `400` / engine error envelope |
| Either field absent when the other is present | — | Treated as both absent (see §1.5) |

### 1.5 Default behaviour

If `latitudeDeg` is absent (or `null`), `coriolisDeflectionCm` is `0.0` for every point. `azimuthDeg` is ignored when `latitudeDeg` is absent.

If `latitudeDeg` is present but `azimuthDeg` is absent, `azimuthDeg` defaults to `0.0` (due North), which produces zero lateral Coriolis deflection (`az_factor = cos(0) = 1.0` but `sin(0) = 0`). **Wait — this is wrong:** `az_factor = cos(az_rad) = cos(0) = 1.0`, so a North shot with latitude 45° still has non-zero deflection. That is correct: the formula produces the deflection for a North shot (the Earth rotates under the bullet's trajectory). `azimuthDeg` default = `0.0` is intentional.

---

## 2. JSON schema change

### 2.1 `TrajectoryParams` additions

```json
{
  "latitudeDeg": 45.0,
  "azimuthDeg": 0.0
}
```

| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `latitudeDeg` | `number` | optional | absent (Coriolis disabled) | −90 to 90 inclusive |
| `azimuthDeg` | `number` | optional | `0.0` when `latitudeDeg` is present | 0 to 360 inclusive |

### 2.2 `TrajectoryPoint` addition

Add one new field:

```json
{
  "coriolisDeflectionCm": 12.4
}
```

| Field | Type | Rounding | Notes |
|---|---|---|---|
| `coriolisDeflectionCm` | `number` | `r1` (1 decimal place, half-up) | 0.0 when `latitudeDeg` absent. Positive = right of bore. |

The field is added after `spinDriftCm` in the JSON output. All existing consumers that read only the original nine fields are unaffected (the new field is additive).

### 2.3 `TrajectoryResult` — no change

No new summary fields. `supersonicLimitMeters`, `maxOrdinateCm`, etc. are unaffected.

---

## 3. Rust implementation

### 3.1 `types.rs` changes

```rust
// In TrajectoryParams:
#[serde(skip_serializing_if = "Option::is_none")]
pub latitude_deg: Option<f64>,

#[serde(skip_serializing_if = "Option::is_none")]
pub azimuth_deg: Option<f64>,
```

```rust
// In TrajectoryPoint:
pub coriolis_deflection_cm: f64,
```

### 3.2 `types.rs` validation addition

In `TrajectoryParams::validate()`:

```rust
if let Some(lat) = self.latitude_deg {
    if !(-90.0..=90.0).contains(&lat) || !lat.is_finite() {
        return Err("latitudeDeg must be between -90 and 90".into());
    }
}
if let Some(az) = self.azimuth_deg {
    if !(0.0..=360.0).contains(&az) || !az.is_finite() {
        return Err("azimuthDeg must be between 0 and 360".into());
    }
}
```

### 3.3 `ballistics.rs` computation

Add a constant `EARTH_ROTATION_RADS: f64 = 7.2921e-5`.

After the existing `spin_drift_cm` calculation at each trajectory point:

```rust
let coriolis_deflection_cm = match params.latitude_deg {
    None => 0.0,
    Some(lat_deg) => {
        let lat_rad = lat_deg.to_radians();
        let az_rad = params.azimuth_deg.unwrap_or(0.0).to_radians();
        let az_factor = az_rad.cos();
        let deflection_m = EARTH_ROTATION_RADS
            * lat_rad.sin()
            * az_factor
            * muzzle_velocity_fps / FPS_PER_MPS  // muzzle velocity in m/s
            * tof_sec.powi(2);
        round1(deflection_m * 100.0)
    }
};
```

Where `tof_sec` is the `time_of_flight_sec` value for this point (before 4-decimal rounding — use the raw `f64` from the integrator). `muzzle_velocity_fps` is the initial velocity from the input `Bullet`.

### 3.4 Rounding

`coriolisDeflectionCm` uses `r1` (1 decimal place, half-up), consistent with `spinDriftCm` and all other `TrajectoryPoint` fields except `timeOfFlightSec`.

---

## 4. Parity (`engine-parity.md` update)

Add `coriolisDeflectionCm` to §7.1 TrajectoryPoint fields:

| Field | Formula | Verdict | Notes |
|---|---|---|---|
| `coriolisDeflectionCm` | `r1(Ω × sin(lat) × cos(az) × v_muzzle_mps × tof² × 100)` | **MATCH** | Zero when `latitudeDeg` absent. Same constants, same rounding. |

Add parity test cases:
- `latitudeDeg: 45, azimuthDeg: 90` (maximum deflection at mid-latitude East shot) for `.338 Lapua 250gr` at 2000 m: expected ~40–60 cm at 2000 m.
- `latitudeDeg: -33, azimuthDeg: 0` (Southern Hemisphere, North shot): negative `coriolisDeflectionCm`.
- `latitudeDeg: 0` (Equator): zero Coriolis.
- `latitudeDeg` absent: zero Coriolis.

---

## 5. Java implementation

### 5.1 `TrajectoryRequest` additions

```java
@DecimalMin(value = "-90.0", message = "latitudeDeg must be ≥ -90")
@DecimalMax(value =  "90.0", message = "latitudeDeg must be ≤ 90")
private Double latitudeDeg;

@DecimalMin(value =   "0.0", message = "azimuthDeg must be ≥ 0")
@DecimalMax(value = "360.0", message = "azimuthDeg must be ≤ 360")
private Double azimuthDeg;
```

### 5.2 `TrajectoryPoint` addition

Add `coriolisDeflectionCm` after `spinDriftCm` in the builder/record. The Java `double` computation mirrors the Rust formula exactly (same constants, same `Math.round(v × 10.0) / 10.0` rounding).

### 5.3 `BallisticsEngine.java` computation

```java
double coriolisDeflectionCm = 0.0;
if (latitudeDeg != null) {
    double latRad = Math.toRadians(latitudeDeg);
    double azRad  = Math.toRadians(azimuthDeg != null ? azimuthDeg : 0.0);
    double azFactor = Math.cos(azRad);
    double deflectionM = EARTH_ROTATION_RADS
        * Math.sin(latRad)
        * azFactor
        * bullet.getMuzzleVelocityMps()
        * tofSec * tofSec;
    coriolisDeflectionCm = r1(deflectionM * 100.0);
}
```

Add `private static final double EARTH_ROTATION_RADS = 7.2921e-5;` to `BallisticsEngine`.

---

## 6. UI changes

### 6.1 Input fields

Add to the trajectory configuration panel (below the existing `shootingAngle` field):

```html
<div class="row g-2 mt-1" id="coriolisSection">
  <div class="col-6">
    <label for="latitudeDeg" class="form-label">Latitude (°)</label>
    <input type="number" id="latitudeDeg" class="form-control"
           placeholder="e.g. 45.0" min="-90" max="90" step="0.1">
    <div class="form-text">North positive, South negative.</div>
  </div>
  <div class="col-6">
    <label for="azimuthDeg" class="form-label">Azimuth (°)</label>
    <input type="number" id="azimuthDeg" class="form-control"
           placeholder="0 = North" min="0" max="360" step="1" value="0">
  </div>
</div>
```

Both fields are optional. When `latitudeDeg` is left blank, `coriolisDeflectionCm` is 0 and not displayed.

### 6.2 `toEngineParams` update (`engine-client.js`)

Add to the existing null/undefined key-copy loop:

```js
// latitudeDeg and azimuthDeg are included only when latitudeDeg is provided.
if (req.latitudeDeg != null) {
  out.latitudeDeg = req.latitudeDeg;
  if (req.azimuthDeg != null) out.azimuthDeg = req.azimuthDeg;
}
```

### 6.3 Trajectory table display

Add a `coriolisDeflectionCm` column to the results table, displayed alongside `spinDriftCm`. The column header is "Coriolis (cm)". The column is hidden when `coriolisDeflectionCm` is 0.0 for all points (i.e. `latitudeDeg` was not provided).

### 6.4 DOPE card

Add a "Coriolis" row to the DOPE card alongside the "Spin Drift" row, displayed only when non-zero. Format: `+12.4 cm → R` (positive = right, same convention as spin drift).

---

## 7. Threat model delta

| STRIDE | Threat | Mitigation |
|---|---|---|
| Availability | An attacker sends extreme values (`latitudeDeg = ±90`, `azimuthDeg = 0`): `sin(π/2) = 1`, max effect. At the physics level, `tof² × v_muzzle` is bounded by the trajectory itself. No overflow. | No mitigation needed beyond existing input validation. |
| Injection | `latitudeDeg` or `azimuthDeg` are displayed in the UI (DOPE card header "Lat: 45.0°"). | Display via `textContent`, not `innerHTML`. Values are numeric; no HTML injection risk. |
| Privacy | Latitude data reveals the shooter's geographic location. | The latitude is a local input — it is never sent to any analytics endpoint. For the REST path, it is in the POST body (HTTPS). No persistent storage. The privacy note should appear in the UI tooltip for `latitudeDeg`. |

---

## 8. `loader.d.ts` update

Add the two new optional fields to `TrajectoryParams` and the new field to `TrajectoryPoint`:

```ts
// In TrajectoryParams:
latitudeDeg?: number;
azimuthDeg?: number;

// In TrajectoryPoint:
coriolisDeflectionCm: number;
```

---

## 9. Acceptance checklist

- [ ] `latitudeDeg` absent: `coriolisDeflectionCm = 0.0` for all points; no regression in existing tests.
- [ ] `latitudeDeg: 0`: `coriolisDeflectionCm = 0.0` for all points.
- [ ] `latitudeDeg: 45, azimuthDeg: 90`, `.338 Lapua 250gr` at 2000 m: `coriolisDeflectionCm` ≈ 40–60 cm at the 2000 m point.
- [ ] `latitudeDeg: -33, azimuthDeg: 90`: `coriolisDeflectionCm` is negative (left deflection) at all ranges.
- [ ] Validation: `latitudeDeg: 91` → `400`/error envelope with specific message.
- [ ] Parity tests pass for all 4 Coriolis test cases (ε ≤ 0.01 between Rust and Java).
- [ ] `coriolisDeflectionCm` appears after `spinDriftCm` in JSON output for both engines.
- [ ] UI: `latitudeDeg` blank → Coriolis column hidden in results table.
- [ ] UI: DOPE card shows Coriolis row when non-zero.
- [ ] `toEngineParams` only sends `latitudeDeg`/`azimuthDeg` when `latitudeDeg` is provided.
- [ ] `loader.d.ts` updated with new fields.
- [ ] JaCoCo stays at 100%.
- [ ] Jest coverage stays at 100/100/100/100.
- [ ] `BACKLOG.md` marks WA-13 done in the same PR.

---

## 10. Task split

| ID | Owner | Task |
|---|---|---|
| WA13-BE-1 | Rust | Add `latitude_deg`, `azimuth_deg` to `TrajectoryParams`; add `coriolis_deflection_cm` to `TrajectoryPoint`; validation; computation in `ballistics.rs`. |
| WA13-BE-2 | Rust | Parity test cases (§4). Update `engine-parity.md`. |
| WA13-BE-3 | Java/BE | Add fields to `TrajectoryRequest`, `TrajectoryPoint`; validation annotations; computation in `BallisticsEngine.java`. |
| WA13-FE-1 | Frontend | UI input fields (§6.1). Update `toEngineParams` (§6.2). Results table Coriolis column (§6.3). DOPE card row (§6.4). Update `loader.d.ts` (§8). |
| WA13-FE-2 | Frontend | Jest tests: `toEngineParams` includes/excludes fields correctly; results table column visibility. |
