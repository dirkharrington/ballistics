package com.ballistics.model;

import java.util.List;

/**
 * Full trajectory result for a single bullet under given conditions (all values in SI units).
 *
 * @param densityAltitudeMeters  Density altitude in metres derived from altitudeMeters and temperatureC.
 *                               Negative when the air is denser than standard sea-level (cold high altitude).
 *                               Purely informational; does not affect trajectory computation.
 */
public record TrajectoryResult(
    Bullet bullet,
    TrajectoryRequest request,
    List<TrajectoryPoint> points,
    double maxOrdinateCm,           // peak height above line of sight in centimetres
    double maxOrdinateRangeMeters,  // range at which peak occurs in metres
    double supersonicLimitMeters,   // range where velocity drops below ~343 m/s
    double densityAltitudeMeters    // density altitude in metres — always present
) {}
