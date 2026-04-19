package com.ballistics.model;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;

/**
 * Parameters for a trajectory simulation request (all values in SI units).
 *
 * @param bulletId          ID of bullet from the catalog
 * @param zeroRangeMeters   range at which sights are zeroed in metres (default 100)
 * @param maxRangeMeters    maximum range to compute in metres (default 1000)
 * @param stepMeters        interval between trajectory points in metres (default 25)
 * @param windSpeedKph      crosswind speed in km/h
 * @param altitudeMeters    altitude above sea level in metres (affects air density)
 * @param temperatureC      ambient temperature in Celsius
 * @param sightHeightMm       height of scope/sights above bore centreline in mm (default 38.1 = 1.5 in)
 * @param windDirectionDeg    wind direction in degrees (meteorological: 0/360 = from North, 90 = from East).
 *                            90° = pure crosswind from right; 270° = pure crosswind from left.
 *                            Default 90 (full right crosswind, same behaviour as before this field existed).
 * @param dragModel           drag model to use: "G1" (flat-base/spitzer, default) or "G7" (boat-tail,
 *                            long-range).  Selects which drag table is used for the RK4 integration.
 */
public record TrajectoryRequest(
    @Schema(description = "Catalog bullet ID, e.g. \"308-win-168gr\". Must match an entry returned by GET /api/bullets.")
    String bulletId,

    @Schema(description = "Range at which sights are zeroed, in metres. Default 100 m.", example = "100")
    @Positive @Max(3000) double zeroRangeMeters,

    @Schema(description = "Maximum range to compute, in metres. Default 1000 m.", example = "1000")
    @Positive @Max(5000) double maxRangeMeters,

    @Schema(description = "Distance between trajectory output points, in metres. Default 25 m.", example = "25")
    @Positive @Max(500) double stepMeters,

    @Schema(description = "Full-value crosswind speed in km/h (90° to bore line). 0 = no wind.", example = "16")
    @PositiveOrZero double windSpeedKph,

    @Schema(description = "Altitude above sea level in metres. Affects air density and drag.", example = "0")
    @PositiveOrZero double altitudeMeters,

    @Schema(description = "Ambient temperature in °C. Range −50 to 60.", example = "15")
    @Min(-50) @Max(60) double temperatureC,

    @Schema(description = "Height of the sight/scope centreline above bore centreline in mm. Default 38.1 mm (1.5 in).", example = "38.1")
    @Max(150) Double sightHeightMm,

    @Schema(description = "Shooting angle from horizontal in degrees. Positive = uphill, negative = downhill. " +
            "The rifleman's rule cosine correction is applied: effective drop = flat drop × cos(angle). " +
            "Range ±45°. Default 0 (flat fire).", example = "0")
    @Min(-45) @Max(45) Double shootingAngleDegrees,

    @Schema(description = "Wind direction in meteorological degrees (direction the wind is coming FROM). " +
            "0/360 = from North, 90 = from East (right crosswind for a shooter facing North), " +
            "180 = from South (tailwind), 270 = from West (left crosswind). " +
            "The engine decomposes this into crosswind and headwind/tailwind components. " +
            "Default 90 (full right crosswind — preserves legacy behaviour).", example = "90")
    @Min(0) @Max(360) Double windDirectionDeg,

    @Schema(description = "Drag model to use for the RK4 integration. \"G1\" (default) suits flat-base and " +
            "spitzer projectiles; \"G7\" suits boat-tail, very-low-drag long-range projectiles. " +
            "Use G7 only when the ballistic coefficient was derived against the G7 standard projectile.",
            example = "G1", allowableValues = {"G1", "G7"})
    @Pattern(regexp = "G[17]") String dragModel
) {
    /** Defaults suitable for a standard sea-level, calm-day simulation. */
    public TrajectoryRequest {
        if (zeroRangeMeters <= 0) zeroRangeMeters = 100;
        if (maxRangeMeters  <= 0) maxRangeMeters  = 1000;
        if (stepMeters      <= 0) stepMeters       = 25;
        // null means absent from JSON; <=0 means caller wants the default
        if (sightHeightMm == null || sightHeightMm <= 0) sightHeightMm = 38.1;
        if (shootingAngleDegrees == null) shootingAngleDegrees = 0.0;
        if (windDirectionDeg == null) windDirectionDeg = 90.0;
        if (dragModel == null) dragModel = "G1";
    }
}
