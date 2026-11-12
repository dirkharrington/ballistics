use serde::{Deserialize, Serialize};


fn default_zero_range() -> f64 { 100.0 }
fn default_max_range() -> f64 { 1000.0 }
fn default_step() -> f64 { 25.0 }
fn default_temperature() -> f64 { 15.0 }
fn default_sight_height() -> f64 { 38.1 }
fn default_wind_direction() -> f64 { 90.0 }
fn default_drag_model() -> String { "G1".to_string() }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrajectoryParams {
    pub bullet_id: String,
    #[serde(default = "default_zero_range")]
    pub zero_range_meters: f64,
    #[serde(default = "default_max_range")]
    pub max_range_meters: f64,
    #[serde(default = "default_step")]
    pub step_meters: f64,
    #[serde(default)]
    pub wind_speed_kph: f64,
    #[serde(default)]
    pub altitude_meters: f64,
    #[serde(default = "default_temperature")]
    pub temperature_c: f64,
    #[serde(default = "default_sight_height")]
    pub sight_height_mm: f64,
    #[serde(default)]
    pub shooting_angle_degrees: f64,
    #[serde(default = "default_wind_direction")]
    pub wind_direction_deg: f64,
    #[serde(default = "default_drag_model")]
    pub drag_model: String,
    #[serde(default)]
    pub twist_rate_inches_per_turn: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bullet {
    pub id: String,
    pub name: String,
    pub caliber: String,
    pub bullet_weight_grams: f64,
    pub muzzle_velocity_mps: f64,
    pub ballistic_coefficient: f64,
    pub bullet_diameter_mm: f64,
    pub muzzle_energy_joules: f64,
    pub description: String,
    pub hex_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrajectoryPoint {
    pub range_meters: f64,
    pub drop_cm: f64,
    pub velocity_mps: f64,
    pub energy_joules: f64,
    pub wind_drift_cm: f64,
    pub time_of_flight_sec: f64,
    pub moa_adjustment: f64,
    pub mrad_adjustment: f64,
    pub spin_drift_cm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrajectoryResult {
    pub bullet: Bullet,
    pub request: TrajectoryParams,
    pub points: Vec<TrajectoryPoint>,
    pub max_ordinate_cm: f64,
    pub max_ordinate_range_meters: f64,
    pub supersonic_limit_meters: f64,
    pub density_altitude_meters: f64,
}

impl TrajectoryParams {
    /// Validates all fields against the §3.1 ranges in contracts/wasm-engine.md.
    pub fn validate(&self) -> Result<(), String> {
        if self.zero_range_meters <= 0.0 || self.zero_range_meters > 3000.0 {
            return Err(format!("zeroRangeMeters must be >0 and ≤3000, got {}", self.zero_range_meters));
        }
        if self.max_range_meters <= 0.0 || self.max_range_meters > 5000.0 {
            return Err(format!("maxRangeMeters must be >0 and ≤5000, got {}", self.max_range_meters));
        }
        if self.step_meters <= 0.0 || self.step_meters > 500.0 {
            return Err(format!("stepMeters must be >0 and ≤500, got {}", self.step_meters));
        }
        if self.wind_speed_kph < 0.0 {
            return Err(format!("windSpeedKph must be ≥0, got {}", self.wind_speed_kph));
        }
        if self.altitude_meters < 0.0 {
            return Err(format!("altitudeMeters must be ≥0, got {}", self.altitude_meters));
        }
        if self.temperature_c < -50.0 || self.temperature_c > 60.0 {
            return Err(format!("temperatureC must be ≥−50 and ≤60, got {}", self.temperature_c));
        }
        if self.sight_height_mm < 0.0 || self.sight_height_mm > 150.0 {
            return Err(format!("sightHeightMm must be ≥0 and ≤150, got {}", self.sight_height_mm));
        }
        if self.shooting_angle_degrees < -45.0 || self.shooting_angle_degrees > 45.0 {
            return Err(format!("shootingAngleDegrees must be ≥−45 and ≤45, got {}", self.shooting_angle_degrees));
        }
        if self.wind_direction_deg < 0.0 || self.wind_direction_deg > 360.0 {
            return Err(format!("windDirectionDeg must be ≥0 and ≤360, got {}", self.wind_direction_deg));
        }
        if self.drag_model != "G1" && self.drag_model != "G7" {
            return Err(format!("dragModel must be \"G1\" or \"G7\", got \"{}\"", self.drag_model));
        }
        if let Some(twist) = self.twist_rate_inches_per_turn {
            if twist <= 0.0 || twist > 100.0 {
                return Err(format!("twistRateInchesPerTurn must be >0 and ≤100, got {twist}"));
            }
        }
        Ok(())
    }
}

impl Bullet {
    /// Validates that physics-critical bullet fields are positive and finite.
    pub fn validate(&self) -> Result<(), String> {
        if self.muzzle_velocity_mps <= 0.0 || !self.muzzle_velocity_mps.is_finite() {
            return Err(format!("muzzleVelocityMps must be >0, got {}", self.muzzle_velocity_mps));
        }
        if self.ballistic_coefficient <= 0.0 || !self.ballistic_coefficient.is_finite() {
            return Err(format!("ballisticCoefficient must be >0, got {}", self.ballistic_coefficient));
        }
        if self.bullet_weight_grams <= 0.0 || !self.bullet_weight_grams.is_finite() {
            return Err(format!("bulletWeightGrams must be >0, got {}", self.bullet_weight_grams));
        }
        if self.bullet_diameter_mm <= 0.0 || !self.bullet_diameter_mm.is_finite() {
            return Err(format!("bulletDiameterMm must be >0, got {}", self.bullet_diameter_mm));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_params() -> TrajectoryParams {
        TrajectoryParams {
            bullet_id: "test".to_string(),
            zero_range_meters: 100.0,
            max_range_meters: 1000.0,
            step_meters: 25.0,
            wind_speed_kph: 0.0,
            altitude_meters: 0.0,
            temperature_c: 15.0,
            sight_height_mm: 38.1,
            shooting_angle_degrees: 0.0,
            wind_direction_deg: 90.0,
            drag_model: "G1".to_string(),
            twist_rate_inches_per_turn: None,
        }
    }

    fn valid_bullet() -> Bullet {
        Bullet {
            id: "test".to_string(),
            name: "Test".to_string(),
            caliber: "test".to_string(),
            bullet_weight_grams: 10.89,
            muzzle_velocity_mps: 807.7,
            ballistic_coefficient: 0.475,
            bullet_diameter_mm: 7.82,
            muzzle_energy_joules: 3552.0,
            description: "test".to_string(),
            hex_color: "#fff".to_string(),
        }
    }

    #[test]
    fn params_valid_passes() {
        assert!(valid_params().validate().is_ok());
    }

    #[test]
    fn params_zero_range_zero_rejected() {
        let mut p = valid_params();
        p.zero_range_meters = 0.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_zero_range_exceeds_max_rejected() {
        let mut p = valid_params();
        p.zero_range_meters = 3001.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_max_range_too_large_rejected() {
        let mut p = valid_params();
        p.max_range_meters = 1e300;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_step_zero_rejected() {
        let mut p = valid_params();
        p.step_meters = 0.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_step_negative_rejected() {
        let mut p = valid_params();
        p.step_meters = -1.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_temperature_below_absolute_minimum_rejected() {
        let mut p = valid_params();
        p.temperature_c = -273.15;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_temperature_at_minimum_passes() {
        let mut p = valid_params();
        p.temperature_c = -50.0;
        assert!(p.validate().is_ok());
    }

    #[test]
    fn params_bad_drag_model_rejected() {
        let mut p = valid_params();
        p.drag_model = "G3".to_string();
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_g7_drag_model_passes() {
        let mut p = valid_params();
        p.drag_model = "G7".to_string();
        assert!(p.validate().is_ok());
    }

    #[test]
    fn params_twist_rate_zero_rejected() {
        let mut p = valid_params();
        p.twist_rate_inches_per_turn = Some(0.0);
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_twist_rate_too_large_rejected() {
        let mut p = valid_params();
        p.twist_rate_inches_per_turn = Some(101.0);
        assert!(p.validate().is_err());
    }

    #[test]
    fn bullet_valid_passes() {
        assert!(valid_bullet().validate().is_ok());
    }

    #[test]
    fn bullet_zero_muzzle_velocity_rejected() {
        let mut b = valid_bullet();
        b.muzzle_velocity_mps = 0.0;
        assert!(b.validate().is_err());
    }

    #[test]
    fn bullet_negative_muzzle_velocity_rejected() {
        let mut b = valid_bullet();
        b.muzzle_velocity_mps = -1.0;
        assert!(b.validate().is_err());
    }

    #[test]
    fn bullet_zero_bc_rejected() {
        let mut b = valid_bullet();
        b.ballistic_coefficient = 0.0;
        assert!(b.validate().is_err());
    }

    #[test]
    fn params_negative_wind_speed_rejected() {
        let mut p = valid_params();
        p.wind_speed_kph = -1.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_negative_altitude_rejected() {
        let mut p = valid_params();
        p.altitude_meters = -1.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_sight_height_too_large_rejected() {
        let mut p = valid_params();
        p.sight_height_mm = 151.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_shooting_angle_too_steep_rejected() {
        let mut p = valid_params();
        p.shooting_angle_degrees = 46.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn params_wind_direction_exceeds_max_rejected() {
        let mut p = valid_params();
        p.wind_direction_deg = 361.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn bullet_zero_weight_rejected() {
        let mut b = valid_bullet();
        b.bullet_weight_grams = 0.0;
        assert!(b.validate().is_err());
    }

    #[test]
    fn bullet_zero_diameter_rejected() {
        let mut b = valid_bullet();
        b.bullet_diameter_mm = 0.0;
        assert!(b.validate().is_err());
    }
}
