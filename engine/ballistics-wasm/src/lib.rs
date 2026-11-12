use ballistics_engine::ballistics::compute;
use ballistics_engine::types;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn hello_wasm() -> String {
    "ballistics-engine ok".to_string()
}

/// Computes a ballistic trajectory.
///
/// # Arguments
/// * `params_json` — JSON string matching `TrajectoryParams` (see wasm-engine.md §3.1)
/// * `bullet_json` — JSON string matching `Bullet` (see wasm-engine.md §3.2)
///
/// # Returns
/// JSON string: either a `TrajectoryResult` (§3.3) or `{"error":"<message>"}` on failure.
#[wasm_bindgen]
pub fn compute_trajectory(params_json: &str, bullet_json: &str) -> String {
    let params: types::TrajectoryParams = match serde_json::from_str(params_json) {
        Ok(p) => p,
        Err(e) => return error_json(&format!("params parse error: {e}")),
    };
    let bullet: types::Bullet = match serde_json::from_str(bullet_json) {
        Ok(b) => b,
        Err(e) => return error_json(&format!("bullet parse error: {e}")),
    };
    if let Err(e) = params.validate() {
        return error_json(&format!("params validation error: {e}"));
    }
    if let Err(e) = bullet.validate() {
        return error_json(&format!("bullet validation error: {e}"));
    }
    let result = compute(params, bullet);
    match serde_json::to_string(&result) {
        Ok(json) => json,
        Err(e) => error_json(&format!("serialisation error: {e}")),
    }
}

fn error_json(msg: &str) -> String {
    serde_json::json!({"error": msg}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_wasm_returns_expected_string() {
        assert_eq!(hello_wasm(), "ballistics-engine ok");
    }

    #[test]
    fn compute_trajectory_returns_valid_json() {
        let params = r#"{
            "bulletId": "308-win-168gr",
            "zeroRangeMeters": 100,
            "maxRangeMeters": 500,
            "stepMeters": 100
        }"#;
        let bullet = r##"{
            "id": "308-win-168gr",
            "name": ".308 Win 168gr BTHP",
            "caliber": ".308 Winchester",
            "bulletWeightGrams": 10.89,
            "muzzleVelocityMps": 807.7,
            "ballisticCoefficient": 0.475,
            "bulletDiameterMm": 7.82,
            "muzzleEnergyJoules": 3552.0,
            "description": "test",
            "hexColor": "#F97316"
        }"##;
        let result = compute_trajectory(params, bullet);
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert!(parsed.get("error").is_none(), "unexpected error: {result}");
        assert!(parsed.get("points").is_some());
        let points = parsed["points"].as_array().unwrap();
        assert!(!points.is_empty());
    }

    #[test]
    fn compute_trajectory_bad_params_returns_error_envelope() {
        let result = compute_trajectory("not json", "{}");
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert!(parsed.get("error").is_some());
    }

    #[test]
    fn compute_trajectory_bad_bullet_returns_error_envelope() {
        let params = r#"{"bulletId":"x"}"#;
        let result = compute_trajectory(params, "not json");
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert!(parsed.get("error").is_some());
    }

    #[test]
    fn compute_trajectory_all_nine_point_fields_present() {
        let params = r#"{"bulletId":"308-win-168gr","maxRangeMeters":100,"stepMeters":50}"#;
        let bullet = r##"{
            "id":"308-win-168gr","name":"test","caliber":"test",
            "bulletWeightGrams":10.89,"muzzleVelocityMps":807.7,
            "ballisticCoefficient":0.475,"bulletDiameterMm":7.82,
            "muzzleEnergyJoules":3552.0,"description":"test","hexColor":"#fff"
        }"##;
        let result = compute_trajectory(params, bullet);
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        let pt = &parsed["points"][0];
        assert!(pt["rangeMeters"].is_number());
        assert!(pt["dropCm"].is_number());
        assert!(pt["velocityMps"].is_number());
        assert!(pt["energyJoules"].is_number());
        assert!(pt["windDriftCm"].is_number());
        assert!(pt["timeOfFlightSec"].is_number());
        assert!(pt["moaAdjustment"].is_number());
        assert!(pt["mradAdjustment"].is_number());
        assert!(pt["spinDriftCm"].is_number());
    }

    #[test]
    fn error_json_escapes_quotes_and_backslashes() {
        let msg = error_json("say \"hello\" and c:\\path");
        let parsed: serde_json::Value = serde_json::from_str(&msg).expect("valid json");
        let s = parsed["error"].as_str().unwrap();
        assert!(s.contains('"'), "expected embedded quote in: {s}");
        assert!(s.contains('\\'), "expected embedded backslash in: {s}");
    }

    #[test]
    fn compute_trajectory_zero_muzzle_velocity_returns_error_envelope() {
        let params = r#"{"bulletId":"x","maxRangeMeters":500,"stepMeters":100}"#;
        let bullet = r##"{"id":"x","name":"x","caliber":"x","bulletWeightGrams":10.89,
            "muzzleVelocityMps":0,"ballisticCoefficient":0.475,"bulletDiameterMm":7.82,
            "muzzleEnergyJoules":3552.0,"description":"x","hexColor":"#fff"}"##;
        let result = compute_trajectory(params, bullet);
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert!(parsed.get("error").is_some(), "expected error envelope, got: {result}");
    }

    #[test]
    fn compute_trajectory_subzero_temperature_returns_error_envelope() {
        let params = r#"{"bulletId":"x","temperatureC":-273.15,"maxRangeMeters":500,"stepMeters":100}"#;
        let bullet = r##"{"id":"x","name":"x","caliber":"x","bulletWeightGrams":10.89,
            "muzzleVelocityMps":807.7,"ballisticCoefficient":0.475,"bulletDiameterMm":7.82,
            "muzzleEnergyJoules":3552.0,"description":"x","hexColor":"#fff"}"##;
        let result = compute_trajectory(params, bullet);
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert!(parsed.get("error").is_some(), "expected error envelope, got: {result}");
    }

    #[test]
    fn compute_trajectory_huge_max_range_returns_error_envelope() {
        let params = r#"{"bulletId":"x","maxRangeMeters":1e300,"stepMeters":100}"#;
        let bullet = r##"{"id":"x","name":"x","caliber":"x","bulletWeightGrams":10.89,
            "muzzleVelocityMps":807.7,"ballisticCoefficient":0.475,"bulletDiameterMm":7.82,
            "muzzleEnergyJoules":3552.0,"description":"x","hexColor":"#fff"}"##;
        let result = compute_trajectory(params, bullet);
        let parsed: serde_json::Value = serde_json::from_str(&result).expect("valid json");
        assert!(parsed.get("error").is_some(), "expected error envelope, got: {result}");
    }
}
