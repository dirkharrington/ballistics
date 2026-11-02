package com.ballistics.physics;

import java.util.Arrays;

/**
 * Immutable drag-table for a single projectile standard (e.g. G1 or G7).
 *
 * <p>Arrays are defensively copied both in and out so no external code can
 * mutate the data the engine uses on the hot path.</p>
 */
public record DragTable(double[] velocitiesFps, double[] coefficients) {

    /** Compact constructor: defensive copy in, then validate. */
    public DragTable {
        if (velocitiesFps == null) throw new NullPointerException("velocitiesFps");
        if (coefficients  == null) throw new NullPointerException("coefficients");
        velocitiesFps = velocitiesFps.clone();
        coefficients  = coefficients.clone();
        if (velocitiesFps.length != coefficients.length) {
            throw new IllegalArgumentException(
                "velocitiesFps and coefficients must have the same length");
        }
        if (velocitiesFps.length < 2) {
            throw new IllegalArgumentException(
                "drag table must contain at least 2 rows (found " + velocitiesFps.length + ")");
        }
        for (int i = 0; i < velocitiesFps.length; i++) {
            if (!Double.isFinite(velocitiesFps[i]) || velocitiesFps[i] < 0) {
                throw new IllegalArgumentException(
                    "velocitiesFps[" + i + "] must be finite and >= 0 (" + velocitiesFps[i] + ")");
            }
            if (!Double.isFinite(coefficients[i]) || coefficients[i] <= 0) {
                throw new IllegalArgumentException(
                    "coefficients[" + i + "] must be finite and > 0 (" + coefficients[i] + ")");
            }
            if (i > 0 && velocitiesFps[i] <= velocitiesFps[i - 1]) {
                throw new IllegalArgumentException(
                    "velocitiesFps[" + i + "] must be > velocitiesFps[" + (i - 1) + "] (" +
                    velocitiesFps[i] + " <= " + velocitiesFps[i - 1] + ")");
            }
        }
    }

    /** Returns a defensive copy of the velocity breakpoints in fps. */
    @Override
    public double[] velocitiesFps() { return velocitiesFps.clone(); }

    /** Returns a defensive copy of the drag form factors. */
    @Override
    public double[] coefficients() { return coefficients.clone(); }

    /** Number of rows in this table. */
    public int size() { return velocitiesFps.length; }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (!(obj instanceof DragTable other)) return false;
        return Arrays.equals(velocitiesFps, other.velocitiesFps)
            && Arrays.equals(coefficients, other.coefficients);
    }

    @Override
    public int hashCode() {
        return 31 * Arrays.hashCode(velocitiesFps) + Arrays.hashCode(coefficients);
    }

    @Override
    public String toString() {
        return "DragTable[size=" + velocitiesFps.length + "]";
    }
}
