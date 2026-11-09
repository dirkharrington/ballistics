// G1/G7 drag tables from physics-tables.yaml, embedded at compile time.
// Velocities in fps, coefficients are form factors F(v).

pub static G1_VELOCITIES: &[f64] = &[
    0.0, 400.0, 500.0, 600.0, 700.0, 800.0, 900.0, 950.0, 1000.0, 1050.0,
    1100.0, 1150.0, 1200.0, 1250.0, 1300.0, 1350.0, 1400.0, 1450.0, 1500.0,
    1600.0, 1700.0, 1800.0, 1900.0, 2000.0, 2100.0, 2200.0, 2300.0, 2400.0,
    2500.0, 2600.0, 2700.0, 2800.0, 2900.0, 3000.0, 3100.0, 3200.0, 3300.0,
    3400.0, 3500.0, 3600.0, 4000.0,
];

pub static G1_COEFFS: &[f64] = &[
    0.1198, 0.1198, 0.1197, 0.1196, 0.1194, 0.1193, 0.1194, 0.1202, 0.1250,
    0.1315, 0.1420, 0.1550, 0.1700, 0.1820, 0.1920, 0.1990, 0.2030, 0.2020,
    0.1990, 0.1920, 0.1840, 0.1750, 0.1660, 0.1580, 0.1500, 0.1425, 0.1355,
    0.1295, 0.1240, 0.1188, 0.1140, 0.1096, 0.1056, 0.1020, 0.0986, 0.0955,
    0.0926, 0.0900, 0.0878, 0.0858, 0.0800,
];

pub static G7_VELOCITIES: &[f64] = &[
    0.0, 400.0, 500.0, 600.0, 700.0, 800.0, 900.0, 950.0, 1000.0, 1050.0,
    1100.0, 1150.0, 1200.0, 1250.0, 1300.0, 1350.0, 1400.0, 1450.0, 1500.0,
    1600.0, 1700.0, 1800.0, 1900.0, 2000.0, 2100.0, 2200.0, 2300.0, 2400.0,
    2500.0, 2600.0, 2700.0, 2800.0, 2900.0, 3000.0, 3100.0, 3200.0, 3300.0,
    3400.0, 3500.0, 3600.0, 4000.0,
];

pub static G7_COEFFS: &[f64] = &[
    0.1198, 0.1198, 0.1197, 0.1194, 0.1189, 0.1185, 0.1183, 0.1183, 0.1185,
    0.1200, 0.1230, 0.1270, 0.1318, 0.1357, 0.1386, 0.1395, 0.1378, 0.1335,
    0.1278, 0.1163, 0.1066, 0.0985, 0.0920, 0.0868, 0.0826, 0.0790, 0.0757,
    0.0728, 0.0702, 0.0680, 0.0661, 0.0644, 0.0630, 0.0617, 0.0604, 0.0593,
    0.0583, 0.0573, 0.0564, 0.0555, 0.0520,
];

/// Mirrors Java's Arrays.binarySearch + interpolation.
pub fn interpolate_table(velocity: f64, velocities: &[f64], coeffs: &[f64]) -> f64 {
    // NaN or negative velocity: return sub-sonic table floor (safe fallback).
    // Without this guard, NaN causes partition_point to return i=0, then i-1 wraps
    // to usize::MAX and panics — with panic=abort that kills the WASM instance.
    if velocity.is_nan() || velocity <= velocities[0] {
        return coeffs[0];
    }
    let last = velocities.len() - 1;
    if velocity >= velocities[last] {
        return coeffs[last];
    }
    // Binary search for insertion point
    let i = velocities.partition_point(|&v| v < velocity);
    // Exact hit
    if velocities[i] == velocity {
        return coeffs[i];
    }
    // Linear interpolation between [i-1] and [i]
    let v0 = velocities[i - 1];
    let v1 = velocities[i];
    let f0 = coeffs[i - 1];
    let f1 = coeffs[i];
    let t = (velocity - v0) / (v1 - v0);
    f0 + t * (f1 - f0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn g1_below_min_velocity_returns_first_coeff() {
        assert_eq!(interpolate_table(0.0, G1_VELOCITIES, G1_COEFFS), 0.1198);
        assert_eq!(interpolate_table(-5.0, G1_VELOCITIES, G1_COEFFS), 0.1198);
    }

    #[test]
    fn g1_above_max_velocity_returns_last_coeff() {
        assert_eq!(interpolate_table(4000.0, G1_VELOCITIES, G1_COEFFS), 0.0800);
        assert_eq!(interpolate_table(5000.0, G1_VELOCITIES, G1_COEFFS), 0.0800);
    }

    #[test]
    fn g1_exact_hit_returns_table_value() {
        assert_eq!(interpolate_table(700.0, G1_VELOCITIES, G1_COEFFS), 0.1194);
        assert_eq!(interpolate_table(1000.0, G1_VELOCITIES, G1_COEFFS), 0.1250);
    }

    #[test]
    fn g1_interpolated_midpoint_is_in_range() {
        let v = interpolate_table(1025.0, G1_VELOCITIES, G1_COEFFS);
        assert!(v > 0.1250 && v < 0.1315, "got {v}");
    }

    #[test]
    fn g7_table_length_matches() {
        assert_eq!(G7_VELOCITIES.len(), G7_COEFFS.len());
        assert_eq!(G1_VELOCITIES.len(), G1_COEFFS.len());
        assert_eq!(G1_VELOCITIES.len(), G7_VELOCITIES.len());
    }

    #[test]
    fn nan_velocity_returns_first_coeff_without_panic() {
        // Regression: without the NaN guard, partition_point returns 0 and i-1
        // underflows, causing an out-of-bounds panic (abort in release mode).
        let result = interpolate_table(f64::NAN, G1_VELOCITIES, G1_COEFFS);
        assert_eq!(result, G1_COEFFS[0]);
    }

    #[test]
    fn g7_supersonic_coeff_is_less_than_g1() {
        // G7 is calibrated for boat-tail projectiles; lower supersonic drag than G1
        let g1_2000 = interpolate_table(2000.0, G1_VELOCITIES, G1_COEFFS);
        let g7_2000 = interpolate_table(2000.0, G7_VELOCITIES, G7_COEFFS);
        assert!(g7_2000 < g1_2000, "g7={g7_2000} g1={g1_2000}");
    }
}
