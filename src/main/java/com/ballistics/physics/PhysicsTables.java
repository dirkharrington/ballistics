package com.ballistics.physics;

import java.util.Objects;

/**
 * Immutable container for all physics data shared between the Java engine
 * and the JS client ({@code virtual:physics-tables}).
 *
 * <p>Loaded once at startup by {@link PhysicsTablesLoader} from
 * {@code physics-tables.yaml} and exposed as a singleton Spring bean
 * by {@link com.ballistics.config.PhysicsTablesConfig}.</p>
 */
public record PhysicsTables(DragTable g1, DragTable g7, Atmosphere atmosphere) {

    /** Compact constructor: all components must be non-null. */
    public PhysicsTables {
        Objects.requireNonNull(g1,         "g1");
        Objects.requireNonNull(g7,         "g7");
        Objects.requireNonNull(atmosphere, "atmosphere");
    }

    /**
     * Returns the drag table for the requested drag model.
     *
     * @param dragModel {@code "G7"} selects the G7 table; anything else (including
     *                  {@code "G1"} and {@code null}) selects G1.
     */
    public DragTable forModel(String dragModel) {
        return "G7".equals(dragModel) ? g7 : g1;
    }
}
