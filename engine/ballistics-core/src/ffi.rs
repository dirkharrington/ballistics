use std::ffi::{CStr, CString};
use std::os::raw::c_char;

/// Compute a trajectory. `params_json` and `bullet_json` are UTF-8 JSON strings.
/// Returns a heap-allocated UTF-8 JSON string (TrajectoryResult or error envelope).
/// The caller must free the returned pointer with `ballistics_free_string`.
/// Returns NULL if `params_json` or `bullet_json` is NULL.
/// Must be freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn ballistics_compute_trajectory(
    params_json: *const c_char,
    bullet_json: *const c_char,
) -> *mut c_char {
    if params_json.is_null() || bullet_json.is_null() {
        return std::ptr::null_mut();
    }
    let params_str = match CStr::from_ptr(params_json).to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    let bullet_str = match CStr::from_ptr(bullet_json).to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    let result = crate::ballistics::compute_trajectory_from_json(params_str, bullet_str);
    match CString::new(result) {
        Ok(cs) => cs.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Free a string returned by `ballistics_compute_trajectory`.
/// Safe to call with NULL.
#[no_mangle]
pub unsafe extern "C" fn ballistics_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    fn c(s: &str) -> CString {
        CString::new(s).unwrap()
    }

    const PARAMS: &str =
        r#"{"bulletId":"308-win-168gr","maxRangeMeters":100,"stepMeters":50}"#;
    const BULLET: &str = r##"{"id":"308-win-168gr","name":"test","caliber":"test","bulletWeightGrams":10.89,"muzzleVelocityMps":807.7,"ballisticCoefficient":0.475,"bulletDiameterMm":7.82,"muzzleEnergyJoules":3552.0,"description":"test","hexColor":"#fff"}"##;

    #[test]
    fn compute_returns_valid_json() {
        let p = c(PARAMS);
        let b = c(BULLET);
        let raw = unsafe { ballistics_compute_trajectory(p.as_ptr(), b.as_ptr()) };
        assert!(!raw.is_null());
        let result = unsafe { CStr::from_ptr(raw).to_str().unwrap().to_owned() };
        unsafe { ballistics_free_string(raw) };
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(v.get("error").is_none(), "unexpected error: {result}");
    }

    #[test]
    fn compute_null_params_returns_null() {
        let b = c(BULLET);
        let raw = unsafe { ballistics_compute_trajectory(std::ptr::null(), b.as_ptr()) };
        assert!(raw.is_null());
    }

    #[test]
    fn compute_null_bullet_returns_null() {
        let p = c(PARAMS);
        let raw = unsafe { ballistics_compute_trajectory(p.as_ptr(), std::ptr::null()) };
        assert!(raw.is_null());
    }

    #[test]
    fn free_null_is_safe() {
        unsafe { ballistics_free_string(std::ptr::null_mut()) };
    }
}
