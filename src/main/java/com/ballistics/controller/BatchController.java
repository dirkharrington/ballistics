package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.service.TrajectoryService;
import io.github.bucket4j.BandwidthBuilder;
import io.github.bucket4j.Bucket;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.List;

/**
 * POST /api/trajectories/batch — compute up to 20 independent trajectories in parallel.
 */
@Tag(name = "Batch", description = "Compute multiple independent trajectories in one request")
@RestController
@RequestMapping("/api")
public class BatchController {

    private final TrajectoryService trajectoryService;

    // 10 req/min per batch bucket
    private final Bucket batchBucket = Bucket.builder()
        .addLimit(BandwidthBuilder.builder()
            .capacity(10)
            .refillGreedy(10, Duration.ofMinutes(1))
            .build())
        .build();

    public BatchController(TrajectoryService trajectoryService) {
        this.trajectoryService = trajectoryService;
    }

    @Operation(summary = "Compute up to 20 independent trajectories in parallel",
               description = "Each request entry specifies its own bulletId and parameters. " +
                             "Results are returned in input order. Rate-limited to 10 req/min.")
    @PostMapping("/trajectories/batch")
    public ResponseEntity<?> computeBatch(@Valid @RequestBody BatchRequest batchRequest) {
        if (!batchBucket.tryConsume(1)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "60")
                .build();
        }
        List<TrajectoryResult> results = trajectoryService.batch(batchRequest);
        return ResponseEntity.ok(results);
    }
}
