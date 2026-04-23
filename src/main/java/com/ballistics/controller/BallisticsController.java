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
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

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

    private final BallisticsEngine engine;
    private final Map<String, Bullet> bulletCatalog;
    private final ExecutorService compareExecutor;

    // 30 compare requests per minute — prevents a single client saturating the pool
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
        Bullet bullet = bulletCatalog.get(request.bulletId());
        if (bullet == null) {
            return ResponseEntity.badRequest()
                .body("Unknown bullet ID: " + request.bulletId());
        }
        return ResponseEntity.ok(engine.compute(bullet, request));
    }

    // ── POST /api/trajectories/{bulletId} ─────────────────────────────────────
    @Operation(summary = "Compute trajectory for a single bullet by path variable")
    @PostMapping("/trajectories/{bulletId}")
    public ResponseEntity<?> computeTrajectoryById(
            @PathVariable String bulletId,
            @Valid @RequestBody TrajectoryRequest request) {
        Bullet bullet = bulletCatalog.get(bulletId);
        if (bullet == null) {
            return ResponseEntity.badRequest()
                .body("Unknown bullet ID: " + bulletId);
        }
        TrajectoryRequest merged = new TrajectoryRequest(
            bulletId,
            request.zeroRangeMeters(),
            request.maxRangeMeters(),
            request.stepMeters(),
            request.windSpeedKph(),
            request.altitudeMeters(),
            request.temperatureC(),
            request.sightHeightMm()
        );
        return ResponseEntity.ok(engine.compute(bullet, merged));
    }

    // ── POST /api/trajectories/compare ───────────────────────────────────────
    @Operation(summary = "Compare trajectories for multiple bullets")
    @PostMapping("/trajectories/compare")
    public ResponseEntity<?> compareTrajectories(@Valid @RequestBody CompareRequest compareRequest) {
        if (!compareBucket.tryConsume(1)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).build();
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
                        null  // sight height: compact constructor defaults to 38.1 mm
                    );
                    return engine.compute(bulletCatalog.get(id), req);
                }, compareExecutor))
                .toList();

        List<TrajectoryResult> results = futures.stream()
            .map(CompletableFuture::join)
            .toList();

        return ResponseEntity.ok(results);
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
            null  // sight height: compact constructor defaults to 38.1 mm
        );
        return ResponseEntity.ok(engine.compute(bullet, trajReq));
    }
}
