package com.ballistics.model;

/**
 * A single point along a bullet's computed trajectory (all values in SI units).
 *
 * @param rangeMeters      horizontal distance downrange in metres
 * @param dropCm           bullet drop below line of sight in centimetres (negative = below)
 * @param velocityMps      remaining velocity at this range in m/s
 * @param energyJoules     remaining kinetic energy in joules
 * @param windDriftCm      lateral drift due to crosswind in centimetres
 * @param timeOfFlightSec  time of flight from muzzle in seconds
 */
public record TrajectoryPoint(
    double rangeMeters,
    double dropCm,
    double velocityMps,
    double energyJoules,
    double windDriftCm,
    double timeOfFlightSec
) {}
