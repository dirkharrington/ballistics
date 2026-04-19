package com.ballistics.model;

import java.util.List;

/**
 * Full trajectory result for a single bullet under given conditions (all values in SI units).
 */
public record TrajectoryResult(
    Bullet bullet,
    TrajectoryRequest request,
    List<TrajectoryPoint> points,
    double maxOrdinateCm,           // peak height above line of sight in centimetres
    double maxOrdinateRangeMeters,  // range at which peak occurs in metres
    double supersonicLimitMeters    // range where velocity drops below ~343 m/s
) {}
