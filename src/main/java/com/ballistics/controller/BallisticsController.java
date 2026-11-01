package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.service.TrajectoryService;
import io.github.bucket4j.BandwidthBuilder;
import io.github.bucket4j.Bucket;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * REST API for the ballistics visualizer.
 *
 * Endpoints:
 *   GET  /api/bullets                       → list all known bullets
 *   POST /api/trajectory                    → compute single-bullet trajectory (legacy)
 *   POST /api/trajectories/{bulletId}       → compute single-bullet trajectory by path param
 *   POST /api/trajectories/compare          → compute trajectories for multiple bullets
 *   POST /api/trajectories/compare/stream   → stream trajectories as SSE
 *   POST /api/trajectories/custom           → compute trajectory for a user-defined bullet
 */
@Tag(name = "Trajectories", description = "Compute and compare bullet trajectories")
@RestController
@RequestMapping("/api")
public class BallisticsController {

    @Value("${app.sse.timeout-ms:30000}")
    private long sseTimeoutMs;

    private final TrajectoryService trajectoryService;

    // Rate-limit strategy: single 120 req/min, compare 30 req/min
    private final Bucket singleBucket = Bucket.builder()
        .addLimit(BandwidthBuilder.builder()
            .capacity(120)
            .refillGreedy(120, Duration.ofMinutes(1))
            .build())
        .build();

    private final Bucket compareBucket = Bucket.builder()
        .addLimit(BandwidthBuilder.builder()
            .capacity(30)
            .refillGreedy(30, Duration.ofMinutes(1))
            .build())
        .build();

    public BallisticsController(TrajectoryService trajectoryService) {
        this.trajectoryService = trajectoryService;
    }

    // ── GET /api/bullets ──────────────────────────────────────────────────────
    @GetMapping("/bullets")
    public ResponseEntity<List<Bullet>> listBullets() {
        return ResponseEntity.ok(trajectoryService.listBullets());
    }

    // ── POST /api/trajectory ──────────────────────────────────────────────────
    @Operation(summary = "Compute trajectory for a single bullet")
    @PostMapping("/trajectory")
    public ResponseEntity<?> computeTrajectory(@Valid @RequestBody TrajectoryRequest request) {
        if (!singleBucket.tryConsume(1)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "60")
                .build();
        }
        return ResponseEntity.ok(trajectoryService.compute(request.bulletId(), request));
    }

    // ── POST /api/trajectories/{bulletId} ─────────────────────────────────────
    @Operation(summary = "Compute trajectory for a single bullet by path variable")
    @PostMapping("/trajectories/{bulletId}")
    public ResponseEntity<?> computeTrajectoryById(
            @PathVariable String bulletId,
            @Valid @RequestBody TrajectoryRequest request) {
        if (!singleBucket.tryConsume(1)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "60")
                .build();
        }
        return ResponseEntity.ok(trajectoryService.compute(bulletId, request));
    }

    // ── POST /api/trajectories/compare ───────────────────────────────────────
    @Operation(summary = "Compare trajectories for multiple bullets")
    @PostMapping("/trajectories/compare")
    public ResponseEntity<?> compareTrajectories(@Valid @RequestBody CompareRequest compareRequest) {
        if (!compareBucket.tryConsume(1)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "60")
                .build();
        }
        return ResponseEntity.ok(trajectoryService.compare(compareRequest));
    }

    // ── POST /api/trajectories/compare/stream ────────────────────────────────
    @Operation(summary = "Stream trajectories for multiple bullets as SSE")
    @PostMapping(value = "/trajectories/compare/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> compareStream(@Valid @RequestBody CompareRequest compareRequest) {
        if (!compareBucket.tryConsume(1)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "60")
                .build();
        }
        SseEmitter emitter = new SseEmitter(sseTimeoutMs);
        List<CompletableFuture<TrajectoryResult>> futures = trajectoryService.compareAsync(compareRequest);
        if (futures.isEmpty()) {
            emitter.complete();
            return ResponseEntity.ok(emitter);
        }
        List<CompletableFuture<Void>> sendFutures = futures.stream()
            .map(f -> f.thenAccept(result -> {
                try {
                    emitter.send(result);
                } catch (IOException ignored) {
                    // Client disconnected; whenComplete will close the emitter
                }
            }))
            .toList();

        CompletableFuture.allOf(sendFutures.toArray(new CompletableFuture[0]))
            .whenComplete((v, ex) -> {
                try {
                    if (ex != null) emitter.completeWithError(ex);
                    else emitter.complete();
                } catch (IllegalStateException ignored) {}
            });

        return ResponseEntity.ok(emitter);
    }

    // ── POST /api/trajectories/custom ────────────────────────────────────────
    @PostMapping("/trajectories/custom")
    public ResponseEntity<?> customTrajectory(@Valid @RequestBody CustomBulletRequest req) {
        if (!singleBucket.tryConsume(1)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "60")
                .build();
        }
        return ResponseEntity.ok(trajectoryService.computeCustom(req));
    }
}
