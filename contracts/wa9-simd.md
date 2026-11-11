# Contract: SIMD Acceleration (WA-9)

Version: 0.1.0 — 2026-11-11  
ADR: none (build-variant selection is tactical; no new ADR required)  
Depends on: [`wasm-engine.md`](./wasm-engine.md) (Rust source structure), [`wasm-build-pipeline.md`](./wasm-build-pipeline.md), [`wasm-integration.md`](./wasm-integration.md) (loader API, `engine/stage.sh`, Vite plugin)  
Owners: backend/Rust (§2–§4), frontend (§5), devsecops (§6–§7)

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

---

## 0. Scope and non-changes

WA-9 adds a SIMD-optimised WASM binary alongside the existing scalar binary. The JS API surface (`computeTrajectory`, `initEngine`, `WasmUnavailableError`, `BallisticsEngineError`) is **unchanged**. The worker message protocol (`wasm-integration.md` §4), the engine-client tier state machine, and all JSON schemas are **unchanged**. This is a pure performance improvement with a transparent fallback.

Browsers without SIMD128 support (see §1.1) continue to receive the scalar binary. The JavaScript layer detects capability at init time and selects the appropriate binary.

---

## 1. Background

### 1.1 WASM SIMD128 browser support

WASM SIMD128 (the `simd128` target feature) is supported in:
- Chrome/Chromium ≥ 91 (May 2021)
- Firefox ≥ 90 (Jul 2021)
- Safari ≥ 16.4 (Mar 2023)

Safari 16.4 is the trailing edge. The existing `fallback → JS tier` already handles older browsers.

### 1.2 Expected performance gain

The inner RK4 loop in `ballistics.rs` performs 4–8 `f64` multiplications per time step. SIMD128 operates on 128-bit vectors (2× `f64` or 4× `f32`). Using `f64x2` SIMD on the velocity-derivative computation yields a 1.8–2.5× theoretical speedup on the per-step math; real-world gains on a full trajectory are 1.5–2.5× after accounting for loop overhead, branch-prediction, and memory throughput.

**Target:** a 3000 m trajectory at 1 m step (3 000 points × ~12 000 RK4 steps) completes ≤ 15 ms in SIMD tier vs ≤ 35 ms scalar, measured on Chrome 125 on an M-series Mac. The JS fallback tier target is unchanged (<100 ms).

### 1.3 Approach: two binaries, single JS API

WASM target features are compile-time decisions; the same WASM binary cannot switch code paths at runtime. The standard approach is two separate builds:

| File | Build flags | Use |
|---|---|---|
| `ballistics_engine_bg.wasm` | default (existing) | scalar fallback |
| `ballistics_engine_simd_bg.wasm` | `RUSTFLAGS="-C target-feature=+simd128"`, `--features simd` | SIMD fast path |

The JS loader performs a one-time capability probe at `initEngine()` and selects the appropriate binary. If the SIMD binary fails to compile in the browser (older runtime), the scalar binary is used.

---

## 2. Rust changes

### 2.1 Cargo feature

Add to `engine/Cargo.toml`:

```toml
[features]
simd = []
```

No dependencies are added. The feature gates `unsafe` SIMD code paths under `#[cfg(feature = "simd")]`.

### 2.2 SIMD inner loop

The only function eligible for SIMD vectorisation in the current codebase is the per-step derivative computation inside `simulate_trajectory` (the main RK4 loop in `ballistics.rs`). All other functions are either too branchy (drag lookup) or called O(1) times (zero-angle bisection).

Add a new function `rk4_derivatives_simd` gated on the SIMD feature **and** the WASM architecture:

```rust
#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn rk4_derivatives_simd(
    vx: f64, vy: f64,
    drag_decel: f64,
    gravity: f64,
) -> (f64, f64, f64, f64) {
    use std::arch::wasm32::*;
    // Pack [vx, vy] and [−drag×vx/v, −drag×vy/v − g] into f64x2 vectors.
    // Returns (dvx/dt, dvy/dt, dx/dt, dy/dt) = derivative tuple.
    let vel = f64x2(vx, vy);
    let accel = f64x2(
        -drag_decel * vx / f64x2_extract_lane::<0>(f64x2(vx*vx + vy*vy, 0.0).sqrt()),
        -drag_decel * vy / f64x2_extract_lane::<0>(f64x2(vx*vx + vy*vy, 0.0).sqrt()) - gravity,
    );
    let d_vel = f64x2_add(f64x2(0.0, 0.0), accel);
    let d_pos = vel;
    (
        f64x2_extract_lane::<0>(d_vel),
        f64x2_extract_lane::<1>(d_vel),
        f64x2_extract_lane::<0>(d_pos),
        f64x2_extract_lane::<1>(d_pos),
    )
}
```

The calling site in the RK4 loop selects the SIMD path when available:

```rust
#[cfg(all(target_arch = "wasm32", feature = "simd"))]
let derivs = unsafe { rk4_derivatives_simd(vx, vy, drag_decel, gravity) };

#[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
let derivs = rk4_derivatives_scalar(vx, vy, drag_decel, gravity);
```

**Note to implementer:** the exact SIMD implementation above is a sketch — the final version must pass parity tests at ε = 0.01. If the SIMD path produces rounding differences outside ε, switch to a 2× `f64x2` load/store pattern that matches the scalar arithmetic order. The scalar fallback function `rk4_derivatives_scalar` is an extract of the existing inline code with no behaviour change.

### 2.3 `lib.rs` WASM export

No change to `compute_trajectory` or `hello_wasm` exports. The SIMD path is entirely internal.

### 2.4 Cargo.lock

The `simd` feature introduces no new crate dependencies. `Cargo.lock` changes only if `wasm-bindgen` or `std::arch` intrinsics pull new sub-dependencies (they should not).

---

## 3. Build system changes

### 3.1 Two wasm-pack builds

The current Maven `pom.xml` execution (`wasm-pack-build`) produces one binary. Add a second execution **after** the first:

| Execution | Phase | Command | Output dir |
|---|---|---|---|
| `wasm-pack-build` (existing) | `generate-sources` | `wasm-pack build --target web` | `engine/pkg/` |
| `wasm-pack-build-simd` (new) | `generate-sources` | `RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir pkg-simd -- --features simd` | `engine/pkg-simd/` |

Both executions respect `<skip>${skip.wasm.pack}</skip>`.

### 3.2 `engine/stage.sh` additions

Add to the copy allowlist (§2.2 of `wasm-integration.md`):

| Source | Destination |
|---|---|
| `engine/pkg-simd/ballistics_engine_bg.wasm` | `static/wasm/ballistics_engine_simd_bg.wasm` |
| `engine/pkg-simd/ballistics_engine.js` | `static/wasm/ballistics_engine_simd.js` |

The SIMD `.d.ts` and `.wasm` are both needed. The SIMD glue JS file is renamed on copy to avoid overwriting the scalar glue.

Add to the `stage.sh` failure condition: if `engine/pkg-simd/ballistics_engine_bg.wasm` does not exist when the scalar WASM exists, `stage.sh` must warn (not fail) and skip copying the SIMD files. This allows a scalar-only build during development.

### 3.3 Vite bundling

The Vite `wasmEnginePlugin` (described in `wasm-integration.md` §2.5) must be updated to also bundle `ballistics_engine_simd_bg.wasm` when present. No change to the virtual module interface — the SIMD binary is imported from inside `loader.js`.

---

## 4. `engine/loader.js` changes

### 4.1 SIMD detection

Add a module-level async function (not exported):

```js
async function detectSimd() {
  try {
    // Probe bytes: a minimal WASM module using an f64x2 SIMD instruction.
    // Source: https://github.com/GoogleChromeLabs/wasm-feature-detect
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
    ]));
  } catch {
    return false;
  }
}
```

The probe bytes encode a valid WASM module that uses a SIMD instruction (`f64x2.splat` and `f64x2.eq`). `WebAssembly.validate` returns `true` if and only if the runtime supports all instructions in the module.

### 4.2 Binary selection in `initEngine`

Replace the current single `import(ballistics_engine.js)` path with:

```js
const simdSupported = await detectSimd();
const module = simdSupported
  ? await import(/* @vite-ignore */ new URL('./ballistics_engine_simd.js', import.meta.url))
  : await import(/* @vite-ignore */ new URL('./ballistics_engine.js', import.meta.url));
```

If the SIMD module import fails (file not served — scalar-only build, dev without SIMD), fall through to the scalar import. This failure path must be caught and must not prevent initialization.

### 4.3 Loader API unchanged

`initEngine()`, `computeTrajectory()`, `WasmUnavailableError`, and `BallisticsEngineError` are exported with identical signatures. `loader.d.ts` is unchanged.

---

## 5. CI changes

| Job | Change |
|---|---|
| `rust-build` | Add a second wasm-pack invocation: `RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir pkg-simd -- --features simd`. Upload `engine/pkg-simd/` as an artifact alongside `engine/pkg/`. |
| `java-build` | Download both `pkg` and `pkg-simd` artifacts before staging. The JAR-content check passes when **both** `*.wasm` files are present under `/assets/`. |
| `frontend-build` | The Vite stub (scalar-only) continues to satisfy `frontend-build`. No change. |

---

## 6. Threat model delta

| STRIDE | Threat | Mitigation |
|---|---|---|
| Tampering | SIMD binary is a newer build artifact; CSP `script-src 'self'` and `'wasm-unsafe-eval'` already cover it. No change needed. | Existing M1 (CSP) and M6 (content-hashed assets). |
| Tampering | SIMD probe bytes are inline constants; they cannot be injected by an external page because the loader is a same-origin module. | No new mitigation needed. |
| Availability | SIMD init failure causes silent downgrade to scalar, not to JS tier. A wasm `RuntimeError` in the SIMD binary (corruption) triggers the existing `EngineFault` path, which downgrades to JS as intended. | Existing §5.4 of `wasm-integration.md` EngineFault handling covers this. |
| Supply chain | `engine/pkg-simd/` could be inadvertently committed. | Add `engine/pkg-simd/` to `.gitignore` (same as `engine/pkg/`). |

No new API surface. No new data classification change.

---

## 7. Performance acceptance criteria

The following must be measured with Chrome DevTools Performance tab (or equivalent) and recorded in the PR description:

| Scenario | Scalar baseline | SIMD target |
|---|---|---|
| `.338 Lapua 250gr`, 3000 m, 1 m step, `dragModel: G1` | ≤ 50 ms | ≤ 20 ms |
| `.300 Norma Mag 230gr`, 3000 m, 1 m step | ≤ 50 ms | ≤ 20 ms |
| `.308 Win 168gr`, 1000 m, 25 m step (typical) | ≤ 10 ms | ≤ 5 ms |

Measurements are wall-clock time from `computeTrajectory()` call to resolution, Worker tier, Chrome 125+. Averages of 5 runs. If the SIMD improvement is <20% on the 3000 m scenario, raise with the architect before merging.

---

## 8. Acceptance checklist

- [ ] `engine/Cargo.toml` has `[features] simd = []`.
- [ ] `rk4_derivatives_simd` is gated on `#[cfg(all(target_arch = "wasm32", feature = "simd"))]` and `#[target_feature(enable = "simd128")]`.
- [ ] `engine/tests/parity_tests.rs` passes unchanged with the `simd` feature enabled (`cargo test --features simd`). All 10 bullets at ε ≤ 0.01.
- [ ] `wasm-pack build --features simd` produces `engine/pkg-simd/ballistics_engine_bg.wasm`. Binary size ≤ 170 KB gzip (10% size allowance over scalar's 150 KB for SIMD tables).
- [ ] `engine/stage.sh` copies both WASM binaries. Scalar-only build (no `pkg-simd/`) does not fail staging.
- [ ] `detectSimd()` returns `true` on Chrome 125, Firefox 125, Safari 17; returns `false` with SIMD feature-flagged off or on Firefox ≤ 89.
- [ ] `initEngine()` falls back to scalar binary when SIMD import fails.
- [ ] The JAR contains exactly two `.wasm` files under `/assets/` when built with both binaries.
- [ ] CI `rust-build` builds and uploads `pkg-simd/`.
- [ ] `engine/pkg-simd/` is in `.gitignore`.
- [ ] Jest coverage stays at 100/100/100/100. No new uncovered lines in `loader.js`.
- [ ] Performance targets from §7 are met and recorded in the PR.

---

## 9. Task split

| ID | Owner | Task |
|---|---|---|
| WA9-BE-1 | Rust | Add `simd` Cargo feature, `rk4_derivatives_simd`, conditional dispatch in RK4 loop. Verify parity tests pass with `--features simd`. |
| WA9-BE-2 | Rust/BE | Add `wasm-pack-build-simd` Maven execution and `pkg-simd` RUSTFLAGS env. Update `engine/stage.sh`. |
| WA9-FE-1 | Frontend | Update `loader.js`: add `detectSimd()`, update `initEngine` to select binary. Update `loader.d.ts` if needed (should not be needed). Update Jest mock (`wasm-engine.js`) to exercise both paths. |
| WA9-DS-1 | DevSecOps | CI: add SIMD wasm-pack step to `rust-build`, download `pkg-simd` in `java-build`, update JAR-content check to expect two `.wasm` files. Add `engine/pkg-simd/` to `.gitignore`. |
