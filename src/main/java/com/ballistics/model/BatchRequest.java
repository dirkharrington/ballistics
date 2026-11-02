package com.ballistics.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Request body for POST /api/trajectories/batch.
 * Accepts 1–20 independent trajectory requests computed in parallel.
 */
public record BatchRequest(
    @NotEmpty @Size(max = 20) List<@Valid TrajectoryRequest> requests
) {}
