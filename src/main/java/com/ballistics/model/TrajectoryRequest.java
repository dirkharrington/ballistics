package com.ballistics.model;

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
 */
public record TrajectoryRequest(
    String bulletId,
    double zeroRangeMeters,
    double maxRangeMeters,
    double stepMeters,
    double windSpeedKph,
    double altitudeMeters,
    double temperatureC
) {
    /** Defaults suitable for a standard sea-level, calm-day simulation. */
    public TrajectoryRequest {
        if (zeroRangeMeters <= 0) zeroRangeMeters = 100;
        if (maxRangeMeters  <= 0) maxRangeMeters  = 1000;
        if (stepMeters      <= 0) stepMeters       = 25;
    }
}
