package com.ballistics.service;

/**
 * Thrown by {@link TrajectoryService} when a bullet ID is null, blank, or not in the catalog.
 * Mapped to HTTP 400 by {@link com.ballistics.controller.GlobalExceptionHandler}.
 */
public class UnknownBulletException extends RuntimeException {

    private final String bulletId;

    public UnknownBulletException(String bulletId) {
        super("Unknown bullet ID: " + bulletId);
        this.bulletId = bulletId;
    }

    public String bulletId() { return bulletId; }
}
