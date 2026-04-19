package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.service.BallisticsEngine;
import io.github.bucket4j.BandwidthBuilder;
import io.github.bucket4j.Bucket;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;

/**
 * REST API for the ballistics visualizer.
 *
 * Endpoints:
 *   GET  /api/bullets                      → list all known bullets
 *   POST /api/trajectory                   → compute single-bullet trajectory (legacy)
 *   POST /api/trajectories/{bulletId}      → compute single-bullet trajectory by path param
 *   POST /api/trajectories/compare         → compute trajectories for multiple bullets
 *   POST /api/trajectories/custom          → compute trajectory for a user-defined bullet
 */
@Tag(name = "Trajectories", description = "Compute and compare bullet trajectories")
@RestController
@RequestMapping("/api")
public class BallisticsController {

    /** SSE streaming timeout in milliseconds. Configurable via app.sse.timeout-ms. */
    @Value("${app.sse.timeout-ms:30000}")
    private long sseTimeoutMs;

    private final BallisticsEngine engine;
    private final Map<String, Bullet> bulletCatalog;
    private final ExecutorService compareExecutor;

    // Rate-limit strategy:
    //   single-bullet endpoints (/trajectory, /trajectories/{id}): 120 req/min
    //     — higher limit because each request is one cheap RK4 integration;
    //       caps a runaway client at 2 req/s while staying invisible to normal
    //       interactive use.
    //   batch compare endpoints (/compare, /compare/stream): 30 req/min
    //     — lower limit because each request fans out to N parallel integrations
    //       and can saturate the compareExecutor thread pool.
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

    public BallisticsController(BallisticsEngine engine,
                                Map<String, Bullet> bulletCatalog,
                                @Qualifier("compareExecutor") ExecutorService compareExecutor) {
        this.engine          = engine;
        this.bulletCatalog   = bulletCatalog;
        this.compareExecutor = compareExecutor;
    }

    // ── GET /api/bullets ──────────────────────────────────────────────────────
    @GetMapping("/bullets")
    public ResponseEntity<List<Bullet>> listBullets() {
        return ResponseEntity.ok(List.copyOf(bulletCatalog.values()));
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
        Bullet bullet = bulletCatalog.get(request.bulletId());
        if (bullet == null) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "Unknown bullet ID: " + request.bulletId());
            return ResponseEntity.badRequest()
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
        }
        return ResponseEntity.ok(engine.compute(bullet, request));
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
        Bullet bullet = bulletCatalog.get(bulletId);
        if (bullet == null) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "Unknown bullet ID: " + bulletId);
            return ResponseEntity.badRequest()
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
        }
        TrajectoryRequest merged = new TrajectoryRequest(
            bulletId,
            request.zeroRangeMeters(),
            request.maxRangeMeters(),
            request.stepMeters(),
            request.windSpeedKph(),
            request.altitudeMeters(),
            request.temperatureC(),
            request.sightHeightMm(),
            request.shootingAngleDegrees(),
            request.windDirectionDeg(),
            request.dragModel()
        );
        return ResponseEntity.ok(engine.compute(bullet, merged));
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

        List<CompletableFuture<TrajectoryResult>> futures =
            compareRequest.bulletIds().stream()
                .filter(bulletCatalog::containsKey)
                .map(id -> CompletableFuture.supplyAsync(() -> {
                    TrajectoryRequest req = new TrajectoryRequest(
                        id,
                        compareRequest.zeroRangeMeters(),
                        compareRequest.maxRangeMeters(),
                        compareRequest.stepMeters(),
                        compareRequest.windSpeedKph(),
                        compareRequest.altitudeMeters(),
                        compareRequest.temperatureC(),
                        null,  // sight height: compact constructor defaults to 38.1 mm
                        null,  // angle: compact constructor defaults to 0.0 (flat fire)
                        null,  // windDirection: compact constructor defaults to 90.0 (right crosswind)
                        null   // dragModel: compact constructor defaults to "G1"
                    );
                    return engine.compute(bulletCatalog.get(id), req);
                }, compareExecutor))
                .toList();

        List<TrajectoryResult> results = futures.stream()
            .map(CompletableFuture::join)
            .toList();

        return ResponseEntity.ok(results);
    }

    // ── POST /api/trajectories/compare/stream ────────────────────────────────
    @Operation(summary = "Stream trajectories for multiple bullets as SSE — one event per bullet as it completes")
    @PostMapping(value = "/trajectories/compare/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> compareStream(@Valid @RequestBody CompareRequest compareRequest) {
        if (!compareBucket.tryConsume(1)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "60")
                .build();
        }
        SseEmitter emitter = new SseEmitter(sseTimeoutMs);
        List<String> validIds = compareRequest.bulletIds().stream()
            .filter(bulletCatalog::containsKey)
            .toList();
        if (validIds.isEmpty()) {
            emitter.complete();
            return ResponseEntity.ok(emitter);
        }
        List<CompletableFuture<Void>> futures = validIds.stream()
            .map(id -> CompletableFuture.supplyAsync(() -> {
                TrajectoryRequest req = new TrajectoryRequest(
                    id,
                    compareRequest.zeroRangeMeters(),
                    compareRequest.maxRangeMeters(),
                    compareRequest.stepMeters(),
                    compareRequest.windSpeedKph(),
                    compareRequest.altitudeMeters(),
                    compareRequest.temperatureC(),
                    null,  // sight height: compact constructor defaults to 38.1 mm
                    null,  // angle: compact constructor defaults to 0.0 (flat fire)
                    null,  // windDirection: compact constructor defaults to 90.0 (right crosswind)
                    null   // dragModel: compact constructor defaults to "G1"
                );
                return engine.compute(bulletCatalog.get(id), req);
            }, compareExecutor)
            .thenAccept(result -> {
                try {
                    emitter.send(result);
                } catch (IOException ignored) {
                    // Client disconnected; whenComplete will close the emitter
                }
            }))
            .toList();

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
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
        Bullet bullet = new Bullet(
            "custom",
            req.name(),
            "Custom",
            req.bulletWeightGrams(),
            req.muzzleVelocityMps(),
            req.ballisticCoefficient(),
            req.bulletDiameterMm(),
            0.5 * (req.bulletWeightGrams() / 1000.0) * req.muzzleVelocityMps() * req.muzzleVelocityMps(),
            "User-defined custom load",
            "#00d4ff"
        );
        TrajectoryRequest trajReq = new TrajectoryRequest(
            "custom",
            req.zeroRangeMeters(),
            req.maxRangeMeters(),
            req.stepMeters(),
            req.windSpeedKph(),
            req.altitudeMeters(),
            req.temperatureC(),
            null,  // sight height: compact constructor defaults to 38.1 mm
            req.shootingAngleDegrees(),
            req.windDirectionDeg(),
            req.dragModel()
        );
        return ResponseEntity.ok(engine.compute(bullet, trajReq));
    }
}
