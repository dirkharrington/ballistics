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
 * @param moaAdjustment    scope elevation adjustment in MOA needed to return bullet to LoS
 *                         (positive = click up; negative = click down; 0 at muzzle)
 * @param mradAdjustment   same adjustment in MRAD (milliradians)
 * @param spinDriftCm      Gyroscopic spin drift in cm at this range. Positive = rightward (right-hand twist).
 *                         Zero when twistRateInchesPerTurn is null/absent on the request.
 */
public record TrajectoryPoint(
    double rangeMeters,
    double dropCm,
    double velocityMps,
    double energyJoules,
    double windDriftCm,
    double timeOfFlightSec,
    double moaAdjustment,
    double mradAdjustment,
    double spinDriftCm
) {}
