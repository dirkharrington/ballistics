package com.ballistics.physics;

/**
 * Standard-atmosphere constants used by the ballistics air-density model.
 *
 * <p>All values are in imperial units to preserve calibration with the G1/G7
 * drag tables and the existing RK4 integrator.</p>
 */
public record Atmosphere(
    double stdTempF,
    double lapseRatePer1000Ft,
    double rankineOffset,
    double pressureCoeff,
    double pressureExp
) {
    /** Compact constructor: all finite; rankineOffset, pressureCoeff, pressureExp all > 0. */
    public Atmosphere {
        if (!Double.isFinite(stdTempF))
            throw new IllegalArgumentException("stdTempF must be finite (" + stdTempF + ")");
        if (!Double.isFinite(lapseRatePer1000Ft))
            throw new IllegalArgumentException("lapseRatePer1000Ft must be finite (" + lapseRatePer1000Ft + ")");
        if (!Double.isFinite(rankineOffset) || rankineOffset <= 0)
            throw new IllegalArgumentException("rankineOffset must be finite and > 0 (" + rankineOffset + ")");
        if (!Double.isFinite(pressureCoeff) || pressureCoeff <= 0)
            throw new IllegalArgumentException("pressureCoeff must be finite and > 0 (" + pressureCoeff + ")");
        if (!Double.isFinite(pressureExp) || pressureExp <= 0)
            throw new IllegalArgumentException("pressureExp must be finite and > 0 (" + pressureExp + ")");
    }
}
