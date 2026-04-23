package com.ballistics.model;

import jakarta.validation.constraints.*;
import java.util.List;

public record CompareRequest(
    List<String> bulletIds,
    @Positive @Max(3000) double zeroRangeMeters,
    @Positive @Max(5000) double maxRangeMeters,
    @Positive @Max(500) double stepMeters,
    @PositiveOrZero double windSpeedKph,
    @PositiveOrZero double altitudeMeters,
    @Min(-50) @Max(60) double temperatureC
) {}
