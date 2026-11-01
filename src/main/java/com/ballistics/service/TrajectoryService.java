package com.ballistics.service;

import com.ballistics.model.*;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;

/**
 * Application-layer facade over {@link BallisticsEngine}.
 *
 * <p>Stateless and thread-safe. No HTTP/servlet types, no rate-limiting concerns,
 * no Bucket4j references. Controllers depend only on this service.</p>
 */
@Service
public class TrajectoryService {

    private final BallisticsEngine engine;
    private final Map<String, Bullet> bulletCatalog;
    private final ExecutorService executor;

    public TrajectoryService(BallisticsEngine engine,
                             Map<String, Bullet> bulletCatalog,
                             @Qualifier("compareExecutor") ExecutorService executor) {
        this.engine        = engine;
        this.bulletCatalog = bulletCatalog;
        this.executor      = executor;
    }

    /** Catalog bullets in catalog order. Unmodifiable. */
    public List<Bullet> listBullets() {
        return List.copyOf(bulletCatalog.values());
    }

    /**
     * Single catalog trajectory. Normalises the request's bulletId to {@code bulletId}.
     *
     * @throws UnknownBulletException if bulletId is null, blank, or not in the catalog
     */
    public TrajectoryResult compute(String bulletId, TrajectoryRequest request) {
        Bullet bullet = resolveBullet(bulletId);
        TrajectoryRequest normalised = request.withBulletId(bulletId);
        return engine.compute(bullet, normalised);
    }

    /**
     * Custom (user-defined) trajectory. Never throws {@link UnknownBulletException}.
     */
    public TrajectoryResult computeCustom(CustomBulletRequest request) {
        Bullet bullet = request.toBullet();
        TrajectoryRequest trajReq = request.toTrajectoryRequest();
        return engine.compute(bullet, trajReq);
    }

    /**
     * Fan-out compare, blocking. Unknown IDs are silently dropped.
     * Each distinct id is computed once; duplicate ids reuse the result.
     * Results are returned in input order (including duplicates).
     */
    public List<TrajectoryResult> compare(CompareRequest request) {
        List<CompletableFuture<TrajectoryResult>> futures = compareAsync(request);
        // futures are in input order; join in order
        List<TrajectoryResult> results = new ArrayList<>(futures.size());
        for (CompletableFuture<TrajectoryResult> f : futures) {
            results.add(joinUnwrapped(f));
        }
        return results;
    }

    /**
     * Fan-out compare, non-blocking. For the SSE endpoint.
     * One future per known input id, in input order. Duplicate ids share the same future.
     */
    public List<CompletableFuture<TrajectoryResult>> compareAsync(CompareRequest request) {
        // Build a deduplicated map from known id → future (preserves first-occurrence order)
        Map<String, CompletableFuture<TrajectoryResult>> byId = new LinkedHashMap<>();
        for (String id : request.bulletIds()) {
            if (id != null && bulletCatalog.containsKey(id) && !byId.containsKey(id)) {
                TrajectoryRequest req = request.toTrajectoryRequest(id);
                Bullet bullet = bulletCatalog.get(id);
                byId.put(id, CompletableFuture.supplyAsync(
                    () -> engine.compute(bullet, req), executor));
            }
        }

        // Build output list in original input order, reusing futures for duplicates
        List<CompletableFuture<TrajectoryResult>> ordered = new ArrayList<>(request.bulletIds().size());
        for (String id : request.bulletIds()) {
            if (id != null && byId.containsKey(id)) {
                ordered.add(byId.get(id));
            }
        }
        return ordered;
    }

    /**
     * Batch, blocking. Validates every bulletId BEFORE scheduling any work.
     *
     * @throws UnknownBulletException for the first unknown, null, or blank bulletId
     */
    public List<TrajectoryResult> batch(BatchRequest request) {
        // Validate all bullet IDs up-front
        for (TrajectoryRequest req : request.requests()) {
            resolveBullet(req.bulletId());
        }

        // Schedule all work in parallel
        List<CompletableFuture<TrajectoryResult>> futures = request.requests().stream()
            .map(req -> {
                Bullet bullet = bulletCatalog.get(req.bulletId());
                return CompletableFuture.supplyAsync(() -> engine.compute(bullet, req), executor);
            })
            .toList();

        // Collect in order, unwrapping any wrapper exceptions
        List<TrajectoryResult> results = new ArrayList<>(futures.size());
        for (CompletableFuture<TrajectoryResult> f : futures) {
            results.add(joinUnwrapped(f));
        }
        return results;
    }

    // ── private helpers ───────────────────────────────────────────────────────

    private Bullet resolveBullet(String bulletId) {
        if (bulletId == null || bulletId.isBlank()) {
            throw new UnknownBulletException(bulletId);
        }
        Bullet bullet = bulletCatalog.get(bulletId);
        if (bullet == null) {
            throw new UnknownBulletException(bulletId);
        }
        return bullet;
    }

    /** Joins a future, unwrapping CompletionException/ExecutionException to the cause. */
    private static <T> T joinUnwrapped(CompletableFuture<T> future) {
        try {
            return future.join();
        } catch (CompletionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException re) throw re;
            throw new RuntimeException(cause);
        }
    }
}
