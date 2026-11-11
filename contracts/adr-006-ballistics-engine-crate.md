# ADR-006: Extract `ballistics-engine` as a Publishable Cargo Crate (WA-10)

Status: **Proposed**  
Date: 2026-11-11  
Author: Architect (Claude)  
Supersedes: nothing  
Related: [`wasm-engine.md`](./wasm-engine.md) §1 (current workspace layout), [`wa10-shared-crate.md`](./wa10-shared-crate.md)

---

## Context

The current `engine/` directory is a single Cargo crate (`name = "ballistics-engine"`) that is both the physics library and the WASM boundary layer. `crate-type = ["cdylib", "rlib"]` lets it compile as a WASM module (cdylib) for the browser and as a Rust library (rlib) for `cargo test` on the host.

As the project moves toward a Rust backend (WA-11) and mobile SDKs (iOS/Android), the same physics code needs to be consumable:
1. By the WASM wrapper (current use)
2. By a future Axum/Actix-web backend as a Rust dependency
3. By iOS/Android via C FFI (cbindgen-generated header)
4. Potentially by third parties (crates.io publication)

The current single-crate design cannot cleanly serve all four roles simultaneously. `cdylib` crates cannot be depended on as `rlib` by other crates in the standard way (linking conflicts). C FFI header generation with cbindgen works best on a pure-lib crate with `#[no_mangle]` exports — mixing those with `#[wasm_bindgen]` macros is confusing.

## Decision

**Extract the physics implementation** into a new, independent crate `ballistics-core` within a Cargo workspace. The existing `engine/` becomes two workspace members:

```
engine/
├── Cargo.toml              # workspace root
├── ballistics-core/        # pure physics library (publishable)
│   ├── Cargo.toml          # name = "ballistics-engine", version = "0.1.0"
│   └── src/                # ballistics.rs, atmosphere.rs, drag.rs, types.rs
├── ballistics-wasm/        # WASM boundary layer
│   ├── Cargo.toml          # name = "ballistics-wasm", NOT published
│   └── src/
│       └── lib.rs          # wasm-bindgen entry points only
└── cbindgen.toml           # C header generation config
```

The `ballistics-wasm` crate depends on `ballistics-core` and handles all `wasm-bindgen` machinery. The `ballistics-core` crate has no WASM-specific dependencies.

## Consequences

**Good:**
- `ballistics-core` can be `cargo add`ed by the future Rust backend (WA-11) without dragging in `wasm-bindgen`.
- C FFI bindings via cbindgen are generated from `ballistics-core`'s `pub fn` interface without `#[wasm_bindgen]` noise.
- `crates.io` publication of `ballistics-core` is clean; `ballistics-wasm` stays private.
- The parity test suite moves into `ballistics-core` (host `cargo test` path) alongside the parity fixtures, cleanly separated from WASM concerns.
- The `simd` feature (WA-9) lives in `ballistics-core/Cargo.toml` and is consumed by `ballistics-wasm` via `features = ["simd"]`.

**Bad / risks:**
- Build system must reference `ballistics-wasm` (not `ballistics-core`) for the wasm-pack step. `wasm-pack build engine/ballistics-wasm --target web` — the path argument changes from `engine/` to `engine/ballistics-wasm/`.
- Maven `pom.xml` execution commands and `stage.sh` need path updates (one-time, low-risk).
- CI `rust-build` path in `paths-filter` needs updating.
- Published crate name: `ballistics-engine` on crates.io. This name is not currently taken (checked 2026-11-11). No name squatting risk at this time.
- The workspace `Cargo.lock` becomes the shared lock file for both members. This is correct and expected.

## Alternatives considered

### A. Keep single crate, add FFI without workspace restructure

Leave `engine/` as one crate and add `#[no_mangle] pub extern "C"` FFI functions alongside `#[wasm_bindgen]` exports.

**Rejected:** Mixing `#[wasm_bindgen]` and C FFI exports in the same crate is non-standard, confuses cbindgen (which generates headers from `extern "C"` functions and must be told to ignore `#[wasm_bindgen]` ones), and couples the WASM ABI to the C ABI lifetime. The Rust backend would need to depend on a `cdylib` crate, which is an anti-pattern.

### B. Workspace with three members (core + wasm + ffi)

Add a third `ballistics-ffi` crate solely for C header generation.

**Rejected:** Unnecessary complexity. cbindgen can generate headers from `ballistics-core` directly by exposing a `pub mod ffi` module gated on `#[cfg(feature = "ffi")]`. Two members are sufficient.

### C. Separate repository for `ballistics-engine`

Move `ballistics-core` to its own GitHub repository and consume via `git` or `crates.io`.

**Rejected:** Premature. Keep the crate in the monorepo. Publish to crates.io from CI (optional, not required for WA-11). If the crate evolves into a standalone product, extract it then.

## C FFI surface (cbindgen)

cbindgen is configured via `engine/cbindgen.toml`:

```toml
language = "C"
include_guard = "BALLISTICS_ENGINE_H"
namespace = "ballistics"
documentation = true
```

The C surface must be explicitly marked in `ballistics-core/src/lib.rs` under `#[cfg(feature = "ffi")]`:

```rust
#[cfg(feature = "ffi")]
pub mod ffi {
    use super::*;
    use std::ffi::{CStr, CString};

    /// Compute a trajectory. Returns heap-allocated JSON string.
    /// Caller must free with `ballistics_free_string`.
    #[no_mangle]
    pub unsafe extern "C" fn ballistics_compute_trajectory(
        params_json: *const std::os::raw::c_char,
        bullet_json: *const std::os::raw::c_char,
    ) -> *mut std::os::raw::c_char { ... }

    /// Free a string returned by `ballistics_compute_trajectory`.
    #[no_mangle]
    pub unsafe extern "C" fn ballistics_free_string(s: *mut std::os::raw::c_char) { ... }
}
```

The generated header (`include/ballistics_engine.h`) is committed to the repo and re-generated in CI when `ballistics-core/src/lib.rs` changes.

## Version strategy

`ballistics-core` starts at `0.1.0`. Semantic versioning applies:
- Patch (`0.1.x`): bug fixes, physics corrections within ε = 0.01
- Minor (`0.x.0`): new fields in `TrajectoryParams` or `TrajectoryPoint` (additive), new drag models
- Major (`x.0.0`): breaking changes to `TrajectoryParams`, `Bullet`, or `TrajectoryResult` struct layouts

`ballistics-wasm` is not published and uses a private version number that tracks `ballistics-core`'s minor version.
