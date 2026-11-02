package com.ballistics.config;

import com.ballistics.physics.PhysicsTablesLoadException;
import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

/**
 * Converts a {@link PhysicsTablesLoadException} at context-refresh time into a
 * human-readable startup failure message instead of a raw stack trace.
 *
 * <p>Registered in
 * {@code META-INF/spring/org.springframework.boot.diagnostics.FailureAnalyzer}.</p>
 */
public class PhysicsTablesFailureAnalyzer
        extends AbstractFailureAnalyzer<PhysicsTablesLoadException> {

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure, PhysicsTablesLoadException cause) {
        String description = "Physics tables could not be loaded from " +
            cause.source() + ": " + cause.problem();
        String action =
            "Fix physics-tables.yaml (it is shared with the JS client via virtual:physics-tables), " +
            "or point app.physics.tables-location at a valid file.";
        return new FailureAnalysis(description, action, cause);
    }
}
