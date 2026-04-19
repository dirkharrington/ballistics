package com.ballistics.model;

import jakarta.validation.constraints.*;

public record CustomBulletRequest(
    @NotBlank String name,
    @Positive @DecimalMax("30.0") double bulletWeightGrams,
    @Positive @Max(2000) double muzzleVelocityMps,
    @Positive @DecimalMax("1.2") double ballisticCoefficient,
    @Positive @DecimalMax("25.0") double bulletDiameterMm,
    double zeroRangeMeters,
    double maxRangeMeters,
    double stepMeters,
    double windSpeedKph,
    double altitudeMeters,
    double temperatureC
) {
    public CustomBulletRequest {
        if (zeroRangeMeters <= 0) zeroRangeMeters = 100;
        if (maxRangeMeters  <= 0) maxRangeMeters  = 1000;
        if (stepMeters      <= 0) stepMeters       = 25;
    }
}
