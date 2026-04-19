package com.ballistics.model;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import jakarta.validation.constraints.Pattern;

public record CustomBulletRequest(
    @Schema(description = "Human-readable name for the custom load, e.g. \"175gr SMK handload\".")
    @NotBlank String name,

    @Schema(description = "Bullet weight in grams. Max 30 g (≈ 463 gr).", example = "11.34")
    @Positive @DecimalMax("30.0") double bulletWeightGrams,

    @Schema(description = "Muzzle velocity in m/s. Max 2000 m/s.", example = "853")
    @Positive @Max(2000) double muzzleVelocityMps,

    @Schema(description = "G1 ballistic coefficient (dimensionless). Typical range 0.1–0.7 for rifle bullets.", example = "0.505")
    @Positive @DecimalMax("1.2") double ballisticCoefficient,

    @Schema(description = "Bullet diameter (calibre) in mm. Max 25 mm (≈ .98 cal).", example = "7.82")
    @Positive @DecimalMax("25.0") double bulletDiameterMm,

    @Schema(description = "Zero range in metres. Default 100 m.", example = "100")
    double zeroRangeMeters,

    @Schema(description = "Maximum range to compute in metres. Default 1000 m.", example = "1000")
    double maxRangeMeters,

    @Schema(description = "Step interval between output points in metres. Default 25 m.", example = "25")
    double stepMeters,

    @Schema(description = "Full-value crosswind speed in km/h. 0 = no wind.", example = "0")
    double windSpeedKph,

    @Schema(description = "Altitude above sea level in metres.", example = "0")
    double altitudeMeters,

    @Schema(description = "Ambient temperature in °C.", example = "15")
    double temperatureC,

    @Schema(description = "Shooting angle from horizontal in degrees. Positive = uphill, negative = downhill. " +
            "Range ±45°. Default 0 (flat fire).", example = "0")
    @Min(-45) @Max(45) Double shootingAngleDegrees,

    @Schema(description = "Wind direction in meteorological degrees (direction wind is coming FROM). " +
            "90 = from East (right crosswind). Default 90.", example = "90")
    @Min(0) @Max(360) Double windDirectionDeg,

    @Schema(description = "Drag model: \"G1\" (default) or \"G7\" (boat-tail long-range).", example = "G1",
            allowableValues = {"G1", "G7"})
    @Pattern(regexp = "G[17]") String dragModel
) {
    public CustomBulletRequest {
        if (zeroRangeMeters <= 0) zeroRangeMeters = 100;
        if (maxRangeMeters  <= 0) maxRangeMeters  = 1000;
        if (stepMeters      <= 0) stepMeters       = 25;
        if (shootingAngleDegrees == null) shootingAngleDegrees = 0.0;
        if (windDirectionDeg == null) windDirectionDeg = 90.0;
        if (dragModel == null) dragModel = "G1";
    }
}
