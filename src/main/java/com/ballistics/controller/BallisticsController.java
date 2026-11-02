package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.ratelimit.RateLimited;
import com.ballistics.ratelimit.RateLimitTier;
import com.ballistics.service.TrajectoryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * REST API for the ballistics visualizer.
 */
@Tag(name = "Trajectories", description = "Compute and compare bullet trajectories")
@RestController
@RequestMapping("/api")
public class BallisticsController {

    private final TrajectoryService trajectoryService;
    private final long sseTimeoutMs;

    public BallisticsController(
            TrajectoryService trajectoryService,
            @Value("${app.sse.timeout-ms:30000}") long sseTimeoutMs) {
        this.trajectoryService = trajectoryService;
        this.sseTimeoutMs = sseTimeoutMs;
    }

    // ── GET /api/bullets ──────────────────────────────────────────────────────
    @GetMapping("/bullets")
    public ResponseEntity<List<Bullet>> listBullets() {
        return ResponseEntity.ok(trajectoryService.listBullets());
    }

    // ── POST /api/trajectory ──────────────────────────────────────────────────
    @Operation(summary = "Compute trajectory for a single bullet", deprecated = true)
    @RateLimited(RateLimitTier.SINGLE)
    @PostMapping("/trajectory")
    public TrajectoryResult computeTrajectory(@Valid @RequestBody TrajectoryRequest request) {
        return trajectoryService.compute(request.bulletId(), request);
    }

    // ── POST /api/trajectories/{bulletId} ─────────────────────────────────────
    @Operation(summary = "Compute trajectory for a single bullet by path variable")
    @RateLimited(RateLimitTier.SINGLE)
    @PostMapping("/trajectories/{bulletId}")
    public TrajectoryResult computeTrajectoryById(
            @PathVariable String bulletId,
            @Valid @RequestBody TrajectoryRequest request) {
        return trajectoryService.compute(bulletId, request);
    }

    // ── POST /api/trajectories/compare ───────────────────────────────────────
    @Operation(summary = "Compare trajectories for multiple bullets")
    @RateLimited(RateLimitTier.COMPARE)
    @PostMapping("/trajectories/compare")
    public List<TrajectoryResult> compareTrajectories(@Valid @RequestBody CompareRequest compareRequest) {
        return trajectoryService.compare(compareRequest);
    }

    // ── POST /api/trajectories/compare/stream ────────────────────────────────
    @Operation(summary = "Stream trajectories for multiple bullets as SSE")
    @RateLimited(RateLimitTier.COMPARE)
    @PostMapping(value = "/trajectories/compare/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter compareStream(@Valid @RequestBody CompareRequest compareRequest) {
        SseEmitter emitter = new SseEmitter(sseTimeoutMs);
        List<CompletableFuture<TrajectoryResult>> futures = trajectoryService.compareAsync(compareRequest);
        if (futures.isEmpty()) {
            emitter.complete();
            return emitter;
        }
        List<CompletableFuture<Void>> sendFutures = futures.stream()
            .map(f -> f.thenAccept(result -> {
                try {
                    emitter.send(result);
                } catch (IOException ignored) {}
            }))
            .toList();

        CompletableFuture.allOf(sendFutures.toArray(new CompletableFuture[0]))
            .whenComplete((v, ex) -> {
                try {
                    if (ex != null) emitter.completeWithError(ex);
                    else emitter.complete();
                } catch (IllegalStateException ignored) {}
            });

        return emitter;
    }

    // ── POST /api/trajectories/custom ────────────────────────────────────────
    @RateLimited(RateLimitTier.SINGLE)
    @PostMapping("/trajectories/custom")
    public TrajectoryResult customTrajectory(@Valid @RequestBody CustomBulletRequest req) {
        return trajectoryService.computeCustom(req);
    }
}
