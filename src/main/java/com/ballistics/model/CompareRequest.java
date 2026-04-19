package com.ballistics.model;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.util.List;

public record CompareRequest(
    @Schema(description = "List of catalog bullet IDs to compare. Unknown IDs are silently filtered out.")
    List<String> bulletIds,

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
    @Min(-50) @Max(60) double temperatureC
) {}
