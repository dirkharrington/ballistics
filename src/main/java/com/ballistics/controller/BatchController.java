package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.ratelimit.RateLimited;
import com.ballistics.ratelimit.RateLimitTier;
import com.ballistics.service.TrajectoryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * POST /api/trajectories/batch — compute up to 20 independent trajectories in parallel.
 */
@Tag(name = "Batch", description = "Compute multiple independent trajectories in one request")
@RestController
@RequestMapping("/api")
public class BatchController {

    private final TrajectoryService trajectoryService;

    public BatchController(TrajectoryService trajectoryService) {
        this.trajectoryService = trajectoryService;
    }

    @Operation(summary = "Compute up to 20 independent trajectories in parallel",
               description = "Each request entry specifies its own bulletId and parameters. " +
                             "Results are returned in input order. Rate-limited to 10 req/min.")
    @RateLimited(RateLimitTier.BATCH)
    @PostMapping("/trajectories/batch")
    public List<TrajectoryResult> computeBatch(@Valid @RequestBody BatchRequest batchRequest) {
        return trajectoryService.batch(batchRequest);
    }
}
