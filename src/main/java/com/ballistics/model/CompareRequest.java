package com.ballistics.model;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.util.List;

public record CompareRequest(
    @Schema(description = "List of catalog bullet IDs to compare. Unknown IDs are silently filtered out.")
    @NotEmpty @Size(max = 20) List<String> bulletIds,

    @Schema(description = "Range at which sights are zeroed, in metres. Default 100 m.", example = "100")
    @Positive @Max(3000) double zeroRangeMeters,

    @Schema(description = "Maximum range to compute, in metres. Default 1000 m.", example = "1000")
    @Positive @Max(5000) double maxRangeMeters,

    @Schema(description = "Distance between trajectory output points, in metres. Default 25 m.", example = "25")
    @Positive @Max(500) double stepMeters,

    @Schema(description = "Full-value crosswind speed in km/h. 0 = no wind.", example = "0")
    @PositiveOrZero double windSpeedKph,

    @Schema(description = "Altitude above sea level in metres.", example = "0")
    @PositiveOrZero double altitudeMeters,

    @Schema(description = "Ambient temperature in °C. Range −50 to 60.", example = "15")
    @Min(-50) @Max(60) double temperatureC,

    // ── new: same annotations and @Schema text as TrajectoryRequest ──
    @Schema(description = "Height of the sight/scope centreline above bore centreline in mm. Default 38.1 mm (1.5 in).", example = "38.1")
    @Max(150) Double sightHeightMm,

    @Schema(description = "Shooting angle from horizontal in degrees. Positive = uphill, negative = downhill. Range ±45°. Default 0.", example = "0")
    @Min(-45) @Max(45) Double shootingAngleDegrees,

    @Schema(description = "Wind direction in meteorological degrees (direction the wind is coming FROM). 90 = from East (right crosswind). Default 90.", example = "90")
    @Min(0) @Max(360) Double windDirectionDeg,

    @Schema(description = "Drag model: \"G1\" (default) or \"G7\" (boat-tail long-range).", example = "G1", allowableValues = {"G1", "G7"})
    @Pattern(regexp = "G[17]") String dragModel
) {
    // No compact constructor. Defaults are applied by TrajectoryRequest.

    public TrajectoryRequest toTrajectoryRequest(String bulletId) {
        return new TrajectoryRequest(
            bulletId,
            zeroRangeMeters,
            maxRangeMeters,
            stepMeters,
            windSpeedKph,
            altitudeMeters,
            temperatureC,
            sightHeightMm,          // null or ≤ 0 → 38.1  (TrajectoryRequest compact ctor)
            shootingAngleDegrees,   // null → 0.0
            windDirectionDeg,       // null → 90.0
            dragModel               // null → "G1"
        );
    }
}
