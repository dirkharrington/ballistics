package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.service.BallisticsEngine;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * REST API for the ballistics visualizer.
 *
 * Endpoints:
 *   GET  /api/bullets                      — list all known bullets
 *   POST /api/trajectory                   — compute single-bullet trajectory (legacy)
 *   POST /api/trajectories/{bulletId}      — compute single-bullet trajectory by path param
 *   POST /api/trajectories/compare         — compute trajectories for multiple bullets
 */
@Tag(name = "Trajectories", description = "Compute and compare bullet trajectories")
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class BallisticsController {

    private final BallisticsEngine engine;
    private final Map<String, Bullet> bulletCatalog;

    public BallisticsController(BallisticsEngine engine) {
        this.engine = engine;
        this.bulletCatalog = Bullet.knownRifleBullets().stream()
            .collect(Collectors.toMap(Bullet::id, Function.identity()));
    }

    // ── GET /api/bullets ──────────────────────────────────────────────────────
    @GetMapping("/bullets")
    public ResponseEntity<List<Bullet>> listBullets() {
        return ResponseEntity.ok(Bullet.knownRifleBullets());
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
        TrajectoryResult result = engine.compute(bullet, request);
        return ResponseEntity.ok(result);
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
        // Build a request with the path-param bulletId merged in
        TrajectoryRequest merged = new TrajectoryRequest(
            bulletId,
            request.zeroRangeMeters(),
            request.maxRangeMeters(),
            request.stepMeters(),
            request.windSpeedKph(),
            request.altitudeMeters(),
            request.temperatureC()
        );
        TrajectoryResult result = engine.compute(bullet, merged);
        return ResponseEntity.ok(result);
    }

    // ── POST /api/trajectories/compare ───────────────────────────────────────
    @Operation(summary = "Compare trajectories for all known bullets")
    @PostMapping("/trajectories/compare")
    public ResponseEntity<?> compareTrajectories(@Valid @RequestBody CompareRequest compareRequest) {
        List<TrajectoryResult> results = compareRequest.bulletIds().stream()
            .filter(bulletCatalog::containsKey)
            .parallel()
            .map(id -> {
                TrajectoryRequest req = new TrajectoryRequest(
                    id,
                    compareRequest.zeroRangeMeters(),
                    compareRequest.maxRangeMeters(),
                    compareRequest.stepMeters(),
                    compareRequest.windSpeedKph(),
                    compareRequest.altitudeMeters(),
                    compareRequest.temperatureC()
                );
                return engine.compute(bulletCatalog.get(id), req);
            })
            .toList();

        return ResponseEntity.ok(results);
    }

    // ── POST /api/trajectories/custom ───────────────────────────────────────
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
            req.temperatureC()
        );
        return ResponseEntity.ok(engine.compute(bullet, trajReq));
    }

    // ── Inner record for compare request ─────────────────────────────────────
    public record CompareRequest(
        List<String> bulletIds,
        @Positive @Max(3000) double zeroRangeMeters,
        @Positive @Max(5000) double maxRangeMeters,
        @Positive @Max(500) double stepMeters,
        @PositiveOrZero double windSpeedKph,
        @PositiveOrZero double altitudeMeters,
        @Min(-50) @Max(60) double temperatureC
    ) {}
}
