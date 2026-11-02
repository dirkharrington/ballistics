package com.ballistics.controller;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.cache.CacheManager;
import org.springframework.cache.caffeine.CaffeineCache;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Read-only endpoint exposing trajectory cache statistics.
 * Useful for monitoring cache health and diagnosing cold-start latency.
 */
@Tag(name = "Cache", description = "Trajectory cache statistics")
@RestController
@RequestMapping("/api")
public class CacheController {

    private final CacheManager cacheManager;

    public CacheController(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    @Operation(summary = "Return trajectory cache hit/miss statistics")
    @GetMapping("/cache/stats")
    public Map<String, Object> stats() {
        CaffeineCache spring = (CaffeineCache) cacheManager.getCache("trajectories");
        Cache<Object, Object> native_ = spring.getNativeCache();
        CacheStats s = native_.stats();
        return Map.of(
            "estimatedSize", native_.estimatedSize(),
            "hitCount",      s.hitCount(),
            "missCount",     s.missCount(),
            "hitRate",       s.hitRate(),
            "loadCount",     s.loadCount()
        );
    }
}
