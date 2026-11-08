// ISA atmosphere model constants from physics-tables.yaml
const STD_TEMP_F: f64 = 59.0;
const LAPSE_RATE_PER_1000_FT: f64 = 3.5;
const RANKINE_OFFSET: f64 = 459.67;
const PRESSURE_COEFF: f64 = 6.87559e-6;
const PRESSURE_EXP: f64 = 5.256;

/// Computes air density ratio relative to standard sea-level conditions.
/// Mirrors Java's `airDensityRatio(altFt, tempF)`.
///
/// `alt_ft`: altitude in feet
/// `temp_f`: temperature in degrees Fahrenheit
pub fn air_density_ratio(alt_ft: f64, temp_f: f64) -> f64 {
    let standard_temp_at_alt = STD_TEMP_F - LAPSE_RATE_PER_1000_FT * (alt_ft / 1000.0);
    let temp_ratio = (RANKINE_OFFSET + standard_temp_at_alt) / (RANKINE_OFFSET + temp_f);
    let press_ratio = (1.0 - PRESSURE_COEFF * alt_ft).powf(PRESSURE_EXP);
    press_ratio * temp_ratio
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sea_level_standard_temp_is_one() {
        // At sea level (0 ft) and standard temp (59°F = 15°C), density ratio ≈ 1.0
        let ratio = air_density_ratio(0.0, 59.0);
        assert!((ratio - 1.0).abs() < 0.01, "got {ratio}");
    }

    #[test]
    fn altitude_reduces_density() {
        let sea = air_density_ratio(0.0, 59.0);
        let high = air_density_ratio(5000.0, 59.0);
        assert!(high < sea, "high={high} sea={sea}");
    }

    #[test]
    fn hot_temp_reduces_density() {
        let standard = air_density_ratio(0.0, 59.0);
        let hot = air_density_ratio(0.0, 110.0);
        assert!(hot < standard, "hot={hot} standard={standard}");
    }

    #[test]
    fn positive_at_moderate_altitude_and_temp() {
        let ratio = air_density_ratio(3000.0, 70.0);
        assert!(ratio > 0.0);
    }
}
