package com.ballistics.physics;

/**
 * Thrown when {@link PhysicsTablesLoader} fails to parse or validate
 * {@code physics-tables.yaml} (or a custom override resource).
 */
public class PhysicsTablesLoadException extends RuntimeException {

    private final String source;
    private final String problem;

    public PhysicsTablesLoadException(String source, String problem, Throwable cause) {
        super("Physics tables could not be loaded from " + source + ": " + problem, cause);
        this.source  = source;
        this.problem = problem;
    }

    public PhysicsTablesLoadException(String source, String problem) {
        this(source, problem, null);
    }

    /** The resource description (e.g. {@code "classpath:physics-tables.yaml"}). */
    public String source() { return source; }

    /** A human-readable description of what went wrong. */
    public String problem() { return problem; }
}
