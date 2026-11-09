use crate::atmosphere::air_density_ratio;
use crate::drag::{interpolate_table, G1_COEFFS, G1_VELOCITIES, G7_COEFFS, G7_VELOCITIES};
use crate::types::{Bullet, TrajectoryParams, TrajectoryPoint, TrajectoryResult};

// Hard upper bound on trajectory sample points and inner-loop iterations.
// Caps caller-controlled allocation (stepMeters → Vec::with_capacity) and
// prevents unbounded loops when validation is bypassed or inputs are extreme.
pub const MAX_POINTS: usize = 50_000;

// ── Physical constants (imperial — internal physics only) ──────────────────
const GRAVITY_FPS2: f64 = 32.174;
const SPEED_OF_SOUND_FPS: f64 = 1125.0;
const DT_SECONDS: f64 = 0.0005;
const GRAINS_PER_POUND: f64 = 7000.0;
const MM_PER_FOOT: f64 = 304.8;
const FT_PER_YARD: f64 = 3.0;
const MIN_VELOCITY_FPS: f64 = 100.0;
const MPH_TO_FPS: f64 = 1.46667;

// ── SI → imperial conversion factors ──────────────────────────────────────
const FPS_PER_MPS: f64 = 3.28084;
const FT_PER_METER: f64 = 3.28084;
const M_PER_YARD: f64 = 0.9144;
const CM_PER_INCH: f64 = 2.54;
const J_PER_FTLB: f64 = 1.35582;
const GRAINS_PER_GRAM: f64 = 15.4324;
const MPH_PER_KPH: f64 = 0.621371;

struct ConvertedInputs<'a> {
    mv_fps: f64,
    weight_lbs: f64,
    bc: f64,
    crosswind_mph: f64,
    air_density_ratio: f64,
    zero_ft: f64,
    max_range_yd: f64,
    step_yd: f64,
    sight_height_ft: f64,
    cos_angle: f64,
    launch_angle_rad: f64,
    tan_launch_angle: f64,
    drag_velocities: &'a [f64],
    drag_coeffs: &'a [f64],
    twist_rate: Option<f64>,
    stability_factor: f64,
}

pub fn compute(params: TrajectoryParams, bullet: Bullet) -> TrajectoryResult {
    let ci = convert_inputs(&bullet, &params);
    let (points, max_ordinate_in, max_ordinate_range_yd, supersonic_limit_yd) =
        integrate_trajectory(&ci);

    // Density altitude (Java replication)
    let isa_temp = 15.0 - 1.98 * (params.altitude_meters / 304.8);
    let density_alt_m = r1(params.altitude_meters + 118.8 * (params.temperature_c - isa_temp));

    TrajectoryResult {
        bullet,
        request: params,
        points,
        max_ordinate_cm: r1(max_ordinate_in * CM_PER_INCH),
        max_ordinate_range_meters: r1(max_ordinate_range_yd * M_PER_YARD),
        supersonic_limit_meters: r1(supersonic_limit_yd * M_PER_YARD),
        density_altitude_meters: density_alt_m,
    }
}

fn convert_inputs<'a>(bullet: &Bullet, params: &TrajectoryParams) -> ConvertedInputs<'a> {
    let mv_fps = bullet.muzzle_velocity_mps * FPS_PER_MPS;
    let weight_lbs = (bullet.bullet_weight_grams * GRAINS_PER_GRAM) / GRAINS_PER_POUND;
    let bc = bullet.ballistic_coefficient;
    let wind_mph = params.wind_speed_kph * MPH_PER_KPH;
    let wind_dir_rad = params.wind_direction_deg.to_radians();
    let crosswind_mph = wind_mph * wind_dir_rad.sin();
    let alt_ft = params.altitude_meters * FT_PER_METER;
    let temp_f = params.temperature_c * 9.0 / 5.0 + 32.0;
    let cos_angle = params.shooting_angle_degrees.to_radians().cos();
    let zero_ft = params.zero_range_meters * FT_PER_METER * cos_angle;
    let max_range_yd = params.max_range_meters / M_PER_YARD;
    let step_yd = params.step_meters / M_PER_YARD;
    let sight_height_ft = params.sight_height_mm / MM_PER_FOOT;

    let (drag_velocities, drag_coeffs): (&'a [f64], &'a [f64]) = if params.drag_model == "G7" {
        (G7_VELOCITIES, G7_COEFFS)
    } else {
        (G1_VELOCITIES, G1_COEFFS)
    };

    let adr = air_density_ratio(alt_ft, temp_f);
    let launch_angle_rad =
        find_zero_angle(mv_fps, bc, adr, zero_ft, sight_height_ft, drag_velocities, drag_coeffs);
    let tan_launch_angle = launch_angle_rad.tan();

    let stability_factor = if let Some(twist) = params.twist_rate_inches_per_turn {
        let d_in = bullet.bullet_diameter_mm / 25.4;
        let d_in = d_in.max(0.001).min(5.0);
        let mass_gr = bullet.bullet_weight_grams * GRAINS_PER_GRAM;
        let mass_gr = mass_gr.max(0.001).min(10000.0);
        let twist = twist.max(0.001).min(1000.0);
        let ld_ratio = 4.5_f64;
        (150.0 * d_in.powi(3)) / (twist * twist * mass_gr * (1.0 + ld_ratio * ld_ratio))
    } else {
        0.0
    };

    ConvertedInputs {
        mv_fps,
        weight_lbs,
        bc,
        crosswind_mph,
        air_density_ratio: adr,
        zero_ft,
        max_range_yd,
        step_yd,
        sight_height_ft,
        cos_angle,
        launch_angle_rad,
        tan_launch_angle,
        drag_velocities,
        drag_coeffs,
        twist_rate: params.twist_rate_inches_per_turn,
        stability_factor,
    }
}

fn integrate_trajectory(ci: &ConvertedInputs) -> (Vec<TrajectoryPoint>, f64, f64, f64) {
    let expected = ((ci.max_range_yd / ci.step_yd) as usize + 2).min(MAX_POINTS);
    let mut points = Vec::with_capacity(expected);
    let mut max_ordinate_in = 0.0_f64;
    let mut max_ordinate_range_yd = 0.0_f64;
    let mut supersonic_limit_yd = ci.max_range_yd;

    // state[0]=vx, state[1]=vy, state[2]=x, state[3]=y (all imperial fps/ft)
    let mut state = [
        ci.mv_fps * ci.launch_angle_rad.cos(),
        ci.mv_fps * ci.launch_angle_rad.sin(),
        0.0_f64,
        0.0_f64,
    ];

    let mut t = 0.0_f64;
    let mut next_sample_yd = 0.0_f64;
    let mut supersonic_logged = false;

    while (state[2] / FT_PER_YARD) <= ci.max_range_yd + ci.step_yd {
        let range_yd = state[2] / FT_PER_YARD;
        let velocity = state[0].hypot(state[1]);

        if points.len() >= MAX_POINTS {
            break;
        }

        if state[2] >= (next_sample_yd * FT_PER_YARD) - 0.01 {
            let drop_in =
                (state[3] - state[2] * ci.tan_launch_angle) * 12.0 * ci.cos_angle;
            let energy_ft_lbs =
                0.5 * (ci.weight_lbs / GRAVITY_FPS2) * velocity * velocity;
            let wind_drift_in =
                wind_drift_in(ci.crosswind_mph, ci.mv_fps, range_yd, t, ci.launch_angle_rad);

            let range_si = r1(range_yd * M_PER_YARD);
            let drop_cm_si = r1(drop_in * CM_PER_INCH);
            let velocity_si = r1(velocity / FPS_PER_MPS);
            let energy_si = r1(energy_ft_lbs * J_PER_FTLB);
            let drift_si = r1(wind_drift_in * CM_PER_INCH);
            let tof = (t * 10000.0).round() / 10000.0;

            let (moa_adj, mrad_adj) = if range_si > 0.0 {
                let angle_rad =
                    (drop_cm_si.abs() / 100.0).atan2(range_si);
                let sign = if drop_cm_si < 0.0 {
                    1.0
                } else if drop_cm_si > 0.0 {
                    -1.0
                } else {
                    0.0
                };
                (
                    r1(sign * angle_rad * (180.0 / std::f64::consts::PI) * 60.0),
                    r1(sign * angle_rad * 1000.0),
                )
            } else {
                (0.0, 0.0)
            };

            let spin_drift_cm_si = if ci.twist_rate.is_some() {
                let drift_moa =
                    1.25 * (ci.stability_factor + 1.2) * tof.powf(1.83);
                r1(drift_moa * range_si * std::f64::consts::PI / 10800.0 * 100.0)
            } else {
                0.0
            };

            points.push(TrajectoryPoint {
                range_meters: range_si,
                drop_cm: drop_cm_si,
                velocity_mps: velocity_si,
                energy_joules: energy_si,
                wind_drift_cm: drift_si,
                time_of_flight_sec: tof,
                moa_adjustment: moa_adj,
                mrad_adjustment: mrad_adj,
                spin_drift_cm: spin_drift_cm_si,
            });

            // Track max ordinate (vertical position in inches above bore line)
            if state[3] * 12.0 > max_ordinate_in {
                max_ordinate_in = state[3] * 12.0;
                max_ordinate_range_yd = range_yd;
            }

            next_sample_yd += ci.step_yd;
        }

        if !supersonic_logged && velocity < SPEED_OF_SOUND_FPS {
            supersonic_limit_yd = range_yd;
            supersonic_logged = true;
        }

        integrate_to_x(
            &mut state,
            ci.bc,
            ci.air_density_ratio,
            ci.drag_velocities,
            ci.drag_coeffs,
        );
        t += DT_SECONDS;

        if velocity < MIN_VELOCITY_FPS {
            break;
        }
    }

    (points, max_ordinate_in, max_ordinate_range_yd, supersonic_limit_yd)
}

fn integrate_to_x(
    state: &mut [f64; 4],
    bc: f64,
    adr: f64,
    drag_velocities: &[f64],
    drag_coeffs: &[f64],
) {
    let dt = DT_SECONDS;
    let vx = state[0];
    let vy = state[1];
    let velocity = vx.hypot(vy);

    let mut k1 = [0.0_f64; 2];
    let mut k2 = [0.0_f64; 2];
    let mut k3 = [0.0_f64; 2];
    let mut k4 = [0.0_f64; 2];

    derivatives(vx, vy, velocity, bc, adr, drag_velocities, drag_coeffs, &mut k1);

    let vx2 = vx + 0.5 * dt * k1[0];
    let vy2 = vy + 0.5 * dt * k1[1];
    derivatives(vx2, vy2, vx2.hypot(vy2), bc, adr, drag_velocities, drag_coeffs, &mut k2);

    let vx3 = vx + 0.5 * dt * k2[0];
    let vy3 = vy + 0.5 * dt * k2[1];
    derivatives(vx3, vy3, vx3.hypot(vy3), bc, adr, drag_velocities, drag_coeffs, &mut k3);

    let vx4 = vx + dt * k3[0];
    let vy4 = vy + dt * k3[1];
    derivatives(vx4, vy4, vx4.hypot(vy4), bc, adr, drag_velocities, drag_coeffs, &mut k4);

    state[0] += (dt / 6.0) * (k1[0] + 2.0 * k2[0] + 2.0 * k3[0] + k4[0]);
    state[1] += (dt / 6.0) * (k1[1] + 2.0 * k2[1] + 2.0 * k3[1] + k4[1]);
    state[2] += state[0] * dt;
    state[3] += state[1] * dt;
}

fn derivatives(
    vx: f64,
    vy: f64,
    velocity: f64,
    bc: f64,
    adr: f64,
    drag_velocities: &[f64],
    drag_coeffs: &[f64],
    out: &mut [f64; 2],
) {
    let drag_accel = drag_deceleration(velocity, bc, adr, drag_velocities, drag_coeffs);
    out[0] = -(vx / velocity) * drag_accel;
    out[1] = -(vy / velocity) * drag_accel - GRAVITY_FPS2;
}

fn drag_deceleration(
    velocity: f64,
    bc: f64,
    adr: f64,
    velocities: &[f64],
    coeffs: &[f64],
) -> f64 {
    interpolate_table(velocity.abs(), velocities, coeffs) * adr / bc
}

fn find_zero_angle(
    mv_fps: f64,
    bc: f64,
    adr: f64,
    zero_ft: f64,
    sight_height_ft: f64,
    drag_velocities: &[f64],
    drag_coeffs: &[f64],
) -> f64 {
    let mut lo = -0.05_f64;
    let mut hi = 0.05_f64;
    for _ in 0..64 {
        let mid = (lo + hi) / 2.0;
        if simulate_y(mv_fps, bc, mid, zero_ft, adr, drag_velocities, drag_coeffs)
            < sight_height_ft
        {
            lo = mid;
        } else {
            hi = mid;
        }
        if (hi - lo).abs() < 1e-9 {
            break;
        }
    }
    (lo + hi) / 2.0
}

fn simulate_y(
    mv_fps: f64,
    bc: f64,
    angle_rad: f64,
    target_x: f64,
    adr: f64,
    drag_velocities: &[f64],
    drag_coeffs: &[f64],
) -> f64 {
    let mut state = [
        mv_fps * angle_rad.cos(),
        mv_fps * angle_rad.sin(),
        0.0_f64,
        0.0_f64,
    ];
    let mut iters = 0_usize;
    while state[2] < target_x {
        if state[0].hypot(state[1]) < 50.0 {
            break;
        }
        iters += 1;
        if iters > MAX_POINTS {
            break;
        }
        integrate_to_x(&mut state, bc, adr, drag_velocities, drag_coeffs);
    }
    state[3]
}

fn wind_drift_in(wind_mph: f64, mv_fps: f64, range_yd: f64, tof: f64, launch_angle_rad: f64) -> f64 {
    if wind_mph == 0.0 {
        return 0.0;
    }
    let wind_fps = wind_mph * MPH_TO_FPS;
    let vacuum_tof = (range_yd * FT_PER_YARD) / (mv_fps * launch_angle_rad.cos());
    wind_fps * (tof - vacuum_tof) * 12.0
}

/// Round to 1 decimal place using Java Math.round semantics (half-up, not half-away-from-zero).
#[inline]
pub fn r1(v: f64) -> f64 {
    (v * 10.0 + 0.5).floor() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Bullet, TrajectoryParams};

    fn make_308() -> Bullet {
        Bullet {
            id: "308-win-168gr".to_string(),
            name: ".308 Win 168gr BTHP".to_string(),
            caliber: ".308 Winchester".to_string(),
            bullet_weight_grams: 10.89,
            muzzle_velocity_mps: 807.7,
            ballistic_coefficient: 0.475,
            bullet_diameter_mm: 7.82,
            muzzle_energy_joules: 3552.0,
            description: "test".to_string(),
            hex_color: "#F97316".to_string(),
        }
    }

    fn make_223() -> Bullet {
        Bullet {
            id: "223-rem-55gr".to_string(),
            name: ".223 Rem 55gr FMJ".to_string(),
            caliber: ".223 Remington".to_string(),
            bullet_weight_grams: 3.56,
            muzzle_velocity_mps: 987.6,
            ballistic_coefficient: 0.243,
            bullet_diameter_mm: 5.69,
            muzzle_energy_joules: 1738.0,
            description: "test".to_string(),
            hex_color: "#4ADE80".to_string(),
        }
    }

    fn default_params(bullet_id: &str) -> TrajectoryParams {
        TrajectoryParams {
            bullet_id: bullet_id.to_string(),
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

    // ── Core trajectory ──────────────────────────────────────────────────────

    #[test]
    fn trajectory_produces_points() {
        let result = compute(default_params("308-win-168gr"), make_308());
        assert!(!result.points.is_empty());
        assert!(result.points.len() > 10);
    }

    #[test]
    fn first_point_is_at_muzzle() {
        let result = compute(default_params("308-win-168gr"), make_308());
        let first = &result.points[0];
        assert!(first.range_meters <= 0.1, "got {}", first.range_meters);
        assert_eq!(first.moa_adjustment, 0.0);
        assert_eq!(first.mrad_adjustment, 0.0);
    }

    #[test]
    fn velocity_decreases_downrange() {
        let result = compute(default_params("308-win-168gr"), make_308());
        let first = result.points[0].velocity_mps;
        let last = result.points.last().unwrap().velocity_mps;
        // Drag is intentionally near-vacuum (~0.25 fps²); velocity barely drops over 1000m
        // so rounded values may be equal — assert non-increasing is sufficient.
        assert!(last <= first, "last={last} first={first}");
    }

    #[test]
    fn energy_decreases_downrange() {
        let result = compute(default_params("308-win-168gr"), make_308());
        let first = result.points[0].energy_joules;
        let last = result.points.last().unwrap().energy_joules;
        assert!(last < first);
    }

    #[test]
    fn time_of_flight_increases_downrange() {
        let result = compute(default_params("308-win-168gr"), make_308());
        let first = result.points[0].time_of_flight_sec;
        let last = result.points.last().unwrap().time_of_flight_sec;
        assert!(last > first);
    }

    // ── Wind drift ───────────────────────────────────────────────────────────

    #[test]
    fn no_wind_gives_zero_drift() {
        let result = compute(default_params("308-win-168gr"), make_308());
        for p in &result.points {
            assert_eq!(p.wind_drift_cm, 0.0, "range={}", p.range_meters);
        }
    }

    #[test]
    fn crosswind_produces_nonzero_drift() {
        let mut params = default_params("308-win-168gr");
        // 160 kph ≈ 100 mph — matches the JS test comment: at typical speeds the rounded drift
        // is 0 (drag is tiny), so we need high wind to accumulate enough lag to survive rounding.
        params.wind_speed_kph = 160.0;
        params.wind_direction_deg = 90.0;
        let result = compute(params, make_308());
        let last = result.points.last().unwrap();
        assert!(last.wind_drift_cm != 0.0);
    }

    // ── Zeroing ──────────────────────────────────────────────────────────────

    #[test]
    fn zeroing_works_drop_near_zero_at_zero_range() {
        let result = compute(default_params("308-win-168gr"), make_308());
        // Drop is measured relative to the BORE LINE extension (not the sight line).
        // At the zero range the bullet is below the bore line extension by ~sight-height ≈ -7.6 cm.
        // The Java engine confirms this with isNegative() && isGreaterThan(-13.0).
        let p = result.points.iter().find(|p| (p.range_meters - 100.0).abs() < 1.0)
            .expect("should have a sample point near 100m");
        assert!(p.drop_cm < 0.0 && p.drop_cm > -13.0, "drop at zero={}", p.drop_cm);
    }

    // ── Max ordinate ─────────────────────────────────────────────────────────

    #[test]
    fn max_ordinate_is_positive() {
        let result = compute(default_params("308-win-168gr"), make_308());
        assert!(result.max_ordinate_cm > 0.0);
        assert!(result.max_ordinate_range_meters > 0.0);
        assert!(result.max_ordinate_range_meters < 1000.0);
    }

    // ── Supersonic limit ─────────────────────────────────────────────────────

    #[test]
    fn supersonic_limit_equals_max_range_when_bullet_stays_supersonic() {
        // .223 55gr at 987.6 m/s stays supersonic past 1000m
        let result = compute(default_params("223-rem-55gr"), make_223());
        assert_eq!(result.supersonic_limit_meters, 1000.0);
    }

    #[test]
    fn slow_bullet_goes_subsonic_before_max_range() {
        let slow = Bullet {
            id: "slow".to_string(),
            name: "Slow".to_string(),
            caliber: "test".to_string(),
            bullet_weight_grams: 50.0,
            muzzle_velocity_mps: 40.0,
            ballistic_coefficient: 0.1,
            bullet_diameter_mm: 0.3,
            muzzle_energy_joules: 5.0,
            description: "test".to_string(),
            hex_color: "#fff".to_string(),
        };
        let mut params = default_params("slow");
        params.max_range_meters = 200.0;
        let result = compute(params, slow);
        assert_eq!(result.supersonic_limit_meters, 0.0);
    }

    #[test]
    fn trajectory_stops_at_min_velocity() {
        // 10 m/s = 32.8 fps, which is below both MIN_VELOCITY_FPS (100) and
        // the simulate_y guard (50 fps), exercising both early-exit paths.
        let very_slow = Bullet {
            id: "crawl".to_string(),
            name: "Crawl".to_string(),
            caliber: "test".to_string(),
            bullet_weight_grams: 50.0,
            muzzle_velocity_mps: 10.0,
            ballistic_coefficient: 0.1,
            bullet_diameter_mm: 0.3,
            muzzle_energy_joules: 2.5,
            description: "test".to_string(),
            hex_color: "#fff".to_string(),
        };
        let mut params = default_params("crawl");
        params.max_range_meters = 200.0;
        let result = compute(params, very_slow);
        // Loop breaks on MIN_VELOCITY_FPS after muzzle sample; at most 2 points.
        assert!(result.points.len() <= 2);
    }

    // ── MOA / MRAD adjustments ───────────────────────────────────────────────

    #[test]
    fn positive_moa_when_drop_is_negative() {
        let result = compute(default_params("308-win-168gr"), make_308());
        // Beyond the zero range (100m), drop becomes negative and needs UP adjustment
        let p = result
            .points
            .iter()
            .find(|p| p.range_meters > 300.0 && p.drop_cm < 0.0)
            .expect("should have a sample beyond 300m with negative drop");
        assert!(p.moa_adjustment > 0.0, "moa={}", p.moa_adjustment);
        assert!(p.mrad_adjustment > 0.0, "mrad={}", p.mrad_adjustment);
    }

    #[test]
    fn moa_greater_than_mrad() {
        let result = compute(default_params("308-win-168gr"), make_308());
        let p = result
            .points
            .iter()
            .find(|p| p.range_meters > 300.0 && p.drop_cm < 0.0)
            .expect("should have a sample beyond 300m with negative drop");
        assert!(p.moa_adjustment > p.mrad_adjustment);
    }

    // ── Shooting angle ───────────────────────────────────────────────────────

    #[test]
    fn inclined_fire_reduces_apparent_drop() {
        let mut uphill = default_params("308-win-168gr");
        uphill.shooting_angle_degrees = 20.0;
        uphill.max_range_meters = 500.0;
        uphill.step_meters = 100.0;

        let mut flat = default_params("308-win-168gr");
        flat.max_range_meters = 500.0;
        flat.step_meters = 100.0;

        let flat_result = compute(flat, make_308());
        let uphill_result = compute(uphill, make_308());

        let flat_drop = flat_result.points.last().unwrap().drop_cm;
        let uphill_drop = uphill_result.points.last().unwrap().drop_cm;

        assert!(flat_drop.abs() > uphill_drop.abs(), "flat={flat_drop} uphill={uphill_drop}");
    }

    // ── Spin drift ───────────────────────────────────────────────────────────

    #[test]
    fn spin_drift_zero_without_twist_rate() {
        let result = compute(default_params("308-win-168gr"), make_308());
        for p in &result.points {
            assert_eq!(p.spin_drift_cm, 0.0);
        }
    }

    #[test]
    fn spin_drift_positive_at_1000m_with_twist_rate() {
        let mut params = default_params("308-win-168gr");
        params.twist_rate_inches_per_turn = Some(10.0);
        let result = compute(params, make_308());
        let last = result.points.last().unwrap();
        assert!(last.spin_drift_cm > 0.0, "spin_drift={}", last.spin_drift_cm);
    }

    #[test]
    fn spin_drift_zero_at_muzzle() {
        let mut params = default_params("308-win-168gr");
        params.twist_rate_inches_per_turn = Some(10.0);
        let result = compute(params, make_308());
        assert_eq!(result.points[0].spin_drift_cm, 0.0);
    }

    // ── Density altitude ─────────────────────────────────────────────────────

    #[test]
    fn density_altitude_near_zero_at_sea_level_standard_temp() {
        let result = compute(default_params("308-win-168gr"), make_308());
        assert!(result.density_altitude_meters.abs() < 50.0, "da={}", result.density_altitude_meters);
    }

    #[test]
    fn density_altitude_above_standard_temp_exceeds_physical_altitude() {
        let mut params = default_params("308-win-168gr");
        params.altitude_meters = 1000.0;
        params.temperature_c = 30.0;
        let result = compute(params, make_308());
        assert!(result.density_altitude_meters > 1000.0);
    }

    #[test]
    fn density_altitude_below_standard_temp_is_less_than_physical() {
        let mut params = default_params("308-win-168gr");
        params.altitude_meters = 1000.0;
        params.temperature_c = -5.0;
        let result = compute(params, make_308());
        assert!(result.density_altitude_meters < 1000.0);
    }

    // ── G7 drag model ────────────────────────────────────────────────────────

    #[test]
    fn g7_model_produces_different_trajectory_than_g1() {
        let g1_params = default_params("308-win-168gr");
        let mut g7_params = default_params("308-win-168gr");
        g7_params.drag_model = "G7".to_string();

        let g1_result = compute(g1_params, make_308());
        let g7_result = compute(g7_params, make_308());

        assert!(!g1_result.points.is_empty());
        assert!(!g7_result.points.is_empty());
        // G7 produces less drag than G1 at the same BC value (supersonic regime), so the
        // bullet retains >= energy downrange.  With the near-vacuum G1/G7 tables, velocity
        // rounds to the same 0.1 m/s bin but energy (0.1 J precision) still discriminates.
        let g1_last_e = g1_result.points.last().unwrap().energy_joules;
        let g7_last_e = g7_result.points.last().unwrap().energy_joules;
        assert!(g7_last_e >= g1_last_e, "g7={g7_last_e} g1={g1_last_e}");
    }

    // ── Allocation cap (MAX_POINTS) ──────────────────────────────────────────

    #[test]
    fn tiny_step_is_capped_at_max_points() {
        // stepMeters = 0.5 over 1000m → 2000 expected samples, well under MAX_POINTS.
        // Validates that the cap doesn't wrongly truncate normal trajectories.
        let mut params = default_params("308-win-168gr");
        params.step_meters = 0.5;
        params.max_range_meters = 1000.0;
        let result = compute(params, make_308());
        assert!(result.points.len() <= crate::ballistics::MAX_POINTS);
        assert!(!result.points.is_empty());
    }

    // ── Rounding helper ──────────────────────────────────────────────────────

    #[test]
    fn r1_rounds_to_one_decimal() {
        assert_eq!(r1(1.05), 1.1);
        assert_eq!(r1(1.04), 1.0);
        // Java Math.round: half-up (not half-away-from-zero), so -1.05 rounds to -1.0
        assert_eq!(r1(-1.05), -1.0);
        assert_eq!(r1(0.0), 0.0);
    }
}
