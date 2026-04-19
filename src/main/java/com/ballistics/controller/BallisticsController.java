package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.service.BallisticsEngine;
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
 *   GET  /api/bullets                  — list all known bullets
 *   POST /api/trajectory               — compute single-bullet trajectory
 *   POST /api/trajectories/compare     — compute trajectories for multiple bullets
 */
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
    @PostMapping("/trajectory")
    public ResponseEntity<?> computeTrajectory(@RequestBody TrajectoryRequest request) {
        Bullet bullet = bulletCatalog.get(request.bulletId());
        if (bullet == null) {
            return ResponseEntity.badRequest()
                .body("Unknown bullet ID: " + request.bulletId());
        }
        TrajectoryResult result = engine.compute(bullet, request);
        return ResponseEntity.ok(result);
    }

    // ── POST /api/trajectories/compare ───────────────────────────────────────
    @PostMapping("/trajectories/compare")
    public ResponseEntity<?> compareTrajectories(@RequestBody CompareRequest compareRequest) {
        List<java.util.concurrent.CompletableFuture<TrajectoryResult>> futures =
            compareRequest.bulletIds().stream()
                .filter(bulletCatalog::containsKey)
                .map(id -> java.util.concurrent.CompletableFuture.supplyAsync(() -> {
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
                }))
                .toList();

        List<TrajectoryResult> results = futures.stream()
            .map(java.util.concurrent.CompletableFuture::join)
            .toList();

        return ResponseEntity.ok(results);
    }

    // ── Inner record for compare request ─────────────────────────────────────
    public record CompareRequest(
        List<String> bulletIds,
        double zeroRangeMeters,
        double maxRangeMeters,
        double stepMeters,
        double windSpeedKph,
        double altitudeMeters,
        double temperatureC
    ) {}
}
