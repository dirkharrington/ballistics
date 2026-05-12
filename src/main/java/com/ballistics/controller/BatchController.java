package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.service.BallisticsEngine;
import io.github.bucket4j.BandwidthBuilder;
import io.github.bucket4j.Bucket;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;

/**
 * POST /api/trajectories/batch — compute up to 20 independent trajectories in parallel.
 *
 * Each entry in the request carries its own bulletId and simulation parameters,
 * making it possible to mix bullet types, ranges, and conditions in one round-trip.
 * Results are returned in the same order as the input requests.
 */
@Tag(name = "Batch", description = "Compute multiple independent trajectories in one request")
@RestController
@RequestMapping("/api")
public class BatchController {

    private final BallisticsEngine engine;
    private final Map<String, Bullet> bulletCatalog;
    private final ExecutorService compareExecutor;

    // 10 req/min — each request can fan out to 20 parallel integrations.
    private final Bucket batchBucket = Bucket.builder()
        .addLimit(BandwidthBuilder.builder()
            .capacity(10)
            .refillGreedy(10, Duration.ofMinutes(1))
            .build())
        .build();

    public BatchController(BallisticsEngine engine,
                           Map<String, Bullet> bulletCatalog,
                           @Qualifier("compareExecutor") ExecutorService compareExecutor) {
        this.engine          = engine;
        this.bulletCatalog   = bulletCatalog;
        this.compareExecutor = compareExecutor;
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

        // Validate all bullet IDs up-front before launching any computation
        for (TrajectoryRequest req : batchRequest.requests()) {
            if (req.bulletId() != null && !bulletCatalog.containsKey(req.bulletId())) {
                ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                    HttpStatus.BAD_REQUEST, "Unknown bullet ID: " + req.bulletId());
                return ResponseEntity.badRequest()
                    .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                    .body(problem);
            }
        }

        List<CompletableFuture<TrajectoryResult>> futures = batchRequest.requests().stream()
            .map(req -> CompletableFuture.supplyAsync(() -> {
                Bullet bullet = bulletCatalog.get(req.bulletId());
                return engine.compute(bullet, req);
            }, compareExecutor))
            .toList();

        List<TrajectoryResult> results = futures.stream()
            .map(CompletableFuture::join)
            .toList();

        return ResponseEntity.ok(results);
    }
}
