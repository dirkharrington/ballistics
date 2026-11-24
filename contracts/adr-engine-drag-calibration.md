# ADR 011: Calibrate the engine's drag model to standard point-mass retardation

**Status:** Proposed (needs user approval before the builder starts)
**Date:** 2026-11-23
**Author:** Architect
**Contract:** [`engine-drag-calibration.md`](engine-drag-calibration.md)
**Supersedes:** `feat3-custom-drag-ts.md` §3.4 (the "physics limitation" note). It also supersedes the "bit-identical to `simulateBulletJS` at `a63f361`" lock in ADR 008 and `spa1-ts-engine.md` §11.3. The golden fixture is re-baselined once. The lock itself stays in force from the new baseline.
**Blocks:** S24-4 BC truing (PR #219). That PR rebases on this change.

---

## 1. Context

### 1.1 Symptom

The engine's drag has almost no effect, whatever the BC. Take the .308 168 gr catalog round (G1 BC 0.475, MV 807.7 m/s, sea level, 15 °C). The golden fixture (`tests/fixtures/spa1-golden.json`, case `308-win-168gr condA G1`) records this at 600 m:

| Field | Current engine | Real-world magnitude (this ADR, §4.3) |
|---|---|---|
| `velocityMps` | 807.7 (0.0 m/s lost) | ~475 |
| `timeOfFlightSec` | 0.743 (= 600 / 807.7, the vacuum value) | ~0.97 |
| `dropCm` (bore line) | −270.9 (= ½ g t², the vacuum drop) | ~−391 |
| `windDriftCm`, 16 kph full value | 0 | ~101 |
| `supersonicLimitMeters` (max 1000 m) | 1000 (never goes subsonic) | ~982 |

Drop is the vacuum drop at every BC from 0.05 to 1.5. So any BC solver (`solveBC`, the S24-4 truing tool) has nothing to solve against. Wind drift uses the lag-time method, so it is also zero. The MV truing tool (S23-4) and the transonic markers (S23-2) read engine output, so they are wrong too.

### 1.2 Current formula (`app/physics/engine.ts`)

The same expression appears in all four RK4 stages of `evalHeightAtZero`, `integrateTrajectoryFps` and `evalDropCmAtRange`:

```
rhoOverBc = rho / bc                    // rho = density ratio (1.0 at ICAO sea level)
d         = F(|v|) * rhoOverBc          // F from the YAML table, ~0.08–0.20
ax        = -(vx / v) * d
ay        = -(vy / v) * d - 32.174
```

Here `F(v)` is linearly interpolated from `app/data/physics-tables.yaml`. The table is keyed by velocity in fps.

### 1.3 Why it gives near-vacuum drag

There are three independent faults. Fixing any one of them alone does not fix the engine.

1. **The v² term is missing.** Aerodynamic drag goes as ρv²C_d. The engine uses `F/BC` directly as an acceleration in ft/s². At the muzzle that is 0.1165 / 0.475 ≈ **0.245 ft/s²**, about 0.8 % of gravity. The real figure is **≈ 1,695 ft/s²** (§4.2), about 53 g. The engine is short by a factor of about 6,900, and that factor changes with velocity. No constant can absorb it.
2. **The unit-conversion constant is missing.** BC is in lb/in², v in ft/s, and ρ is a ratio. Getting ft/s² out needs the standard-density constant ρ₀π/(8·144) = 2.08551 × 10⁻⁴ ft⁻¹ (§2).
3. **The tables are not standard drag functions.** The YAML "G1" rows run from 0.1198 subsonic to a 0.2030 peak. The real G1 C_d runs from 0.2629 at Mach 0 to a 0.6625 peak at Mach 1.40, with a minimum of 0.2020 at Mach 0.55. The YAML subsonic rows (0.1198, 0.1197, 0.1196, 0.1194, …) are the **G7** C_d values for Mach 0.00, 0.05, 0.10, 0.15, … copied against velocities of 0, 400, 500, 600 fps. The "G7" and "G5" columns are approximations of unknown provenance on the same footing. They are also keyed by velocity, which fixes the Mach scale at one temperature, while S24-1 made sound speed depend on temperature.

## 2. The correct retardation (standard point-mass model)

For a projectile of mass m, reference area A = πd²/4 and drag coefficient C_D(M), the drag deceleration is:

```
a = ρ · v² · C_D(M) · A / (2m)
```

The G-model convention writes the bullet's C_D as i · C_G(M). Here C_G is the reference projectile's tabulated drag coefficient (G1, G5, G7) and i is the bullet's form factor. The ballistic coefficient is BC = m / (i · d²), in **lb/in²**. Substitute and convert units (ρ in lb/ft³, BC × 144 to get lb/ft²):

```
a [ft/s²] = (ρ / ρ₀) · CD_TO_RETARD · C_G(M) · v² / BC

CD_TO_RETARD = ρ₀ · π / (8 · 144) = 0.0764742 lb/ft³ · π / 1152 = 2.08551e-4 ft⁻¹
M            = v / a_sound(T)
```

- ρ₀ = 0.0764742 lb/ft³ (1.225 kg/m³) is ICAO sea-level standard density. It is the same reference that `airDensityRatio()` and `stationAirDensityRatio()` already normalise against, so their output (`rho`) is exactly ρ/ρ₀.
- 2.08551e-4 is the constant used by mainstream open-source point-mass solvers (for example the `ballistics-engine` crate's `CD_TO_RETARD`).
- The acceleration acts along −v̂, so in components: `ax = −a·vx/v = −(kDrag · C_G · v) · vx`, where `kDrag = CD_TO_RETARD · rho / BC`.

The reference C_G(M) tables are the standard BRL / JBM G1, G5 and G7 tables (79, 76 and 84 rows, Mach 0–5). The data is public domain and is the same data distributed with JBM Ballistics and py-ballisticcalc. The contract's Appendix A lists the exact values.

## 3. Options considered

| # | Option | Verdict |
|---|---|---|
| 1 | **Rescale the YAML `f` values by one constant**, formula unchanged | **Rejected.** It can't produce the v² dependence (fault 1), so the error still changes with velocity by a factor of about 3 between 1,500 and 2,700 fps. The table shapes are also wrong (fault 3). |
| 2 | **Velocity-keyed pre-multiplied table** G(v) = 2.08551e-4 · C_G(v/1116.4) · v², formula unchanged (`d = G(v)·rho/bc`) | **Rejected.** It fixes Mach at 15 °C, which undoes S24-1 for G1/G5/G7. Linear interpolation of a v²-weighted table adds 0.3–1 % curvature error between rows. Custom Mach→C_d tables would still need a separate path. |
| 3 | **Mach-keyed standard C_d tables. Formula `a = CD_TO_RETARD · ρ_ratio · C_d(M) · v² / BC`. Mach→fps conversion per run at the ambient sound speed** | **Chosen.** It is standard physics with standard data. G1/G5/G7 and custom tables share one code path (`toDragTable`, already used for custom tables since FEAT-3). It respects S24-1. The RK4 structure, the compiled-table hot loop (PERF-15) and the public API are unchanged. |
| 4 | Rewrite the engine in SI units | **Rejected.** It is a large rewrite with no accuracy gain, and imperial is the convention for BC. |

## 4. Decision

### 4.1 What changes

1. **Data.** `app/data/physics-tables.yaml` replaces `g1Table`, `g5Table` and `g7Table` (keyed `{v, f}`) with `g1CdTable`, `g5CdTable` and `g7CdTable` (keyed `{mach, cd}`), holding the standard tables. The atmosphere block is unchanged.
2. **Module surface.** `virtual:physics-tables` exports `G1_CD_TABLE`, `G5_CD_TABLE` and `G7_CD_TABLE` as `{mach, cd}` arrays, plus `ATMOSPHERE`. The names change deliberately, so any stale caller that expects a velocity-keyed table fails loudly rather than silently using Mach values as fps.
3. **Formula.** A new constant `CD_TO_RETARD = 2.08551e-4`. In every RK4 stage, `kDrag = CD_TO_RETARD * rho / bc` replaces `rhoOverBc`. The stage acceleration becomes `k = Cd·kDrag·v`, then `ax = −vx·k` and `ay = −vy·k − g`.
4. **Mach scale.** Reference tables convert to the engine's fps-keyed `DragTable` per run with `toDragTable(table, soundSpeedFps(temperatureC))`. A one-entry memo per model keeps table identity stable, so the existing `WeakMap` compile cache still hits.
5. **Loop termination guard (mandatory).** With real drag, a low-BC projectile ends up falling at terminal velocity. Its horizontal speed decays towards 0, so `x` approaches a finite limit. Its total speed tends to v_term = √(g / (kDrag·C_d)), and on the way it can dip below that value. For example, a custom bullet at the UI minimum BC of 0.01 has v_term ≈ 79 fps, which is above the zero solver's 50 fps stop. If that limit is short of the zero or target range, the loops `while (x < zeroFt)`, `while (x < targetFt)` and `while (x/3 <= maxRangeYd + stepYd)` **never end**, and the worker hangs. Today's near-vacuum drag can't reach this state. The three stop checks therefore change from total speed to **horizontal speed** (`vx`). Because |vx| ≤ v, the new check fires in every case where the old one fired, and also when the bullet stops travelling downrange. vx decreases monotonically and stays positive, so termination is guaranteed.
6. **`solveBC`.** It uses the G1 table at the solve's own temperature. Its lower bracket now searches for the smallest feasible BC. With real drag, BC = 0.001 stops the bullet within metres, and today's code would then return `null` for every input.

**Custom drag tables keep their FEAT-3 semantics.** The user's `cd` column goes through the same formula and is divided by the bullet's BC. A user-supplied curve is a reference drag function, like G1/G7. For a bullet-specific (Doppler-derived) C_d curve, the user enters BC = sectional density in lb/in². That makes the form factor 1. Whether to automate this is open question Q2.

### 4.2 Worked check at the muzzle (.308 168 gr, G1 BC 0.475, 807 m/s, 15 °C, sea level)

| Quantity | Value |
|---|---|
| v | 807 × 3.28084 = 2,647.64 ft/s |
| a_sound | `soundSpeedFps(15)` = 1,116.39 ft/s |
| M | 2.3716 |
| C_G1(M) | 0.5527 + (2.3716 − 2.35)/0.05 × (0.5481 − 0.5527) = 0.55071 |
| kDrag | 2.08551e-4 × 1.0 / 0.475 = 4.39055e-4 ft⁻¹ |
| a | 4.39055e-4 × 0.55071 × 2,647.64² = **1,695 ft/s²** (516.6 m/s²) |
| Current engine's a | 0.11651 / 0.475 = 0.245 ft/s² |

### 4.3 Expected trajectory after the fix

The full table is in contract §6. The 600 m values are ≈ 475 m/s, 0.972 s, −391 cm bore-line drop (−325 cm from line of sight, 5.4 mil) and 101 cm drift in a 16 kph full-value wind. Mach 1 comes at ≈ 982 m. These agree with published G1 data for this bullet class to within normal BC-band differences.

## 5. Consequences

### 5.1 Positive
- Drop, velocity, time of flight, energy, wind drift, spin drift (it depends on TOF), Coriolis (it depends on TOF), the supersonic limit, the transonic markers, DOPE, MPBR, the MV truing tool and the BC solver all become physically meaningful.
- BC truing (S24-4) becomes possible. Drop at 600 m changes by about 0.5 % per 1 % of BC. Today the change is effectively zero.
- G1/G5/G7 now respond to ambient temperature through Mach, consistent with S24-1 and the UI Mach column.

### 5.2 Negative and risks
| # | Risk | Mitigation |
|---|---|---|
| R1 | **Every numeric engine expectation changes.** The golden fixture (28 cases, about 1,000 values), the `solveBC` expected BCs, the reference RK4 in the PERF-16 test, the row-targeted branch-coverage tests (400 fps, 4,000 fps, 1,125 fps), and any UI test that runs the real `simulate()` against hard-coded numbers. | The contract (§7) lists each affected test. The golden is regenerated **only after** new physics-band tests pass (contract §6), so it can't lock in a wrong answer. Coverage stays at 100 %. |
| R2 | **E2E tests.** They are tolerant today. S24-3b accepts "Mach 1.x" or "Beyond max range". Results now differ visibly. | Run the full E2E suite against the built `dist/`. Update only assertions that hard-code engine numbers. |
| R3 | **G5 runs use the G1 BC.** There is no G5 BC field, and `bulletForDragModel` only swaps in G7. Once drag is real, a G5 run with a G1 BC under-predicts drag by about 37 % at Mach 2.4. Today this is masked. | Open question Q1. Recommend a follow-up: add a G5 BC, or hide G5 unless one is given. |
| R4 | **Zero-angle bracket is ±0.05 rad (2.86°).** Long zeros at the validation limit (3,000 m) with low-BC bullets can now need more elevation. `findZeroAngleFps` silently clamps. | Open question Q3. Recommend a follow-up to widen the bracket or report "zero unreachable". It is out of scope here so the solver contract (PERF-16/30) stays unchanged. |
| R5 | **Stale user data.** Custom "(trued)" bullets saved by the MV truing tool (S23-4) were solved under near-vacuum drag. Their MVs are biased low. | No automatic migration, because the app can't tell a trued MV from an entered one. Open question Q4: release note, or flag `(trued)` records for re-truing. |
| R6 | **Bullets now stall.** Very low BC at long range can fall below `MIN_VEL_FPS` (100 fps), so `points` can be shorter than `maxRangeMeters / stepMeters`. | This was always legal. Gravity bounds terminal velocity well above 100 fps for catalog bullets. The contract adds a test that a short `points` array is valid output. UI code already iterates `points` without assuming a length. |
| R6a | **Worker hang (DoS).** Real drag plus a low BC, or a heavy custom C_d curve, can leave the RK4 loops spinning forever (§4.1 item 5). The PERF-17 test (BC 0.02 to 1000 m) is a likely trigger once the formula changes. | The horizontal-speed termination guard is **mandatory**. Contract §7.2 adds non-termination regression tests with a Jest timeout. |
| R7 | **Stale bundle.** A service-worker-cached bundle could serve old physics after deploy. | Vite content-hashes assets. Navigations are network-first (PERF-12). No action needed. |

### 5.3 Threat model delta (STRIDE-lite)
- **Asset:** integrity of the firing solution. Wrong drop data can cause a miss or an unsafe shot.
- **Trust boundaries:** the YAML is bundled at build time. Custom tables come from the user (FEAT-3 validation, unchanged).
- **T (tampering / integrity):** a silent regression in the constants or tables. **Mitigation:** contract §6 physics-band tests against independently derived values; table row-count and spot-value tests (contract §7.2); the regenerated golden as an exact lock.
- **D (denial of service):** (a) **Infinite RK4 loop.** A projectile settles into terminal-velocity fall short of the zero or target range. The inputs that reach this are all in the UI: BC down to 0.01, or custom C_d up to 2.0. **Mitigation:** the `vx`-based stop in all three loops (contract §3.4), plus regression tests with a timeout. (b) The `solveBC` lower-bound search adds evaluations. **Mitigation:** at most 12 extra evaluations, and each infeasible one stops early under (a).
- There are no new inputs, storage, network calls or URL parameters.

## 6. Compliance with existing decisions
- ADR 008 (TypeScript is the only engine): unchanged. The golden fixture is re-baselined once under this ADR and stays an exact-equality lock.
- PERF-15/16/17/30 (compiled tables, secant zero solver, `solveBC`): the algorithms and signatures are unchanged. Only the drag expression inside each RK4 stage changes, plus the `solveBC` lower-bracket search.
- S24-1 (temperature-dependent sound speed): now applies to the reference tables too.
