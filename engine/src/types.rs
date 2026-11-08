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
