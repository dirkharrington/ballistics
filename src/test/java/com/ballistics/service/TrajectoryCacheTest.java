package com.ballistics.service;

import com.ballistics.BulletCatalog;
import com.ballistics.model.Bullet;
import com.ballistics.model.TrajectoryRequest;
import com.ballistics.model.TrajectoryResult;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest
class TrajectoryCacheTest {

    @MockitoSpyBean BallisticsEngine engine;

    // ── existing test ─────────────────────────────────────────────────────────

    @Test
    void identicalRequestsComputeOnlyOnce() {
        Bullet bullet = BulletCatalog.load().get(0);
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15, null, null, null, null, null);

        engine.compute(bullet, req);
        engine.compute(bullet, req);

        verify(engine, times(1)).compute(bullet, req);
    }

    // ── BE-2: custom-bullet cache-key regression tests ────────────────────────

    @Test
    void customBulletsWithDifferentBCProduceDifferentResults() {
        // Two bullets that differ only in ballistic coefficient must produce different
        // trajectories and cache entries.
        Bullet bulletLowBC  = new Bullet("custom", "Test", "Custom",
            11.34, 853, 0.400, 7.82, 4000, "desc", "#000");
        Bullet bulletHighBC = new Bullet("custom", "Test", "Custom",
            11.34, 853, 0.500, 7.82, 4000, "desc", "#000");

        TrajectoryRequest req = new TrajectoryRequest("custom", 100, 1000, 100, 0, 0, 15, null, null, null, null, null);

        TrajectoryResult r1 = engine.compute(bulletLowBC,  req);
        TrajectoryResult r2 = engine.compute(bulletHighBC, req);

        // Different BC → different drop at long range
        double drop1 = r1.points().get(r1.points().size() - 1).dropCm();
        double drop2 = r2.points().get(r2.points().size() - 1).dropCm();
        assertThat(drop1).isNotEqualTo(drop2);

        // The engine was called twice (separate cache entries)
        verify(engine, atLeast(2)).compute(any(), any());
    }

    @Test
    void sameCatalogRequestComputesOnlyOnce() {
        // Regression: catalog bullets must still be cache-hit on identical calls
        Bullet bullet = BulletCatalog.load().get(0);
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 100, 0, 0, 15, null, null, null, null, null);

        engine.compute(bullet, req);
        engine.compute(bullet, req);

        verify(engine, times(1)).compute(bullet, req);
    }

    // ── BE-R3: @Cacheable key fix — physics-only cache key tests ─────────────

    @Test
    void displayOnlyFieldChangeDoesNotBustCache() {
        // Same physics, different name/hexColor → should be a cache hit
        Bullet bulletA = new Bullet("custom", "Alpha Load", "Custom",
            11.34, 853, 0.505, 7.82, 4000, "desc", "#00d4ff");
        Bullet bulletB = new Bullet("custom", "Beta Load",  "Custom",
            11.34, 853, 0.505, 7.82, 4000, "desc", "#ff0000");

        TrajectoryRequest req = new TrajectoryRequest("custom", 100, 300, 50, 0, 0, 15, null, null, null, null, null);

        engine.compute(bulletA, req);
        engine.compute(bulletB, req);

        // With the physics-only key, name/color change is a hit → engine ran exactly once
        verify(engine, times(1)).compute(eq(bulletA), eq(req));
        verify(engine, never()).compute(eq(bulletB), eq(req));
    }

    @Test
    void differentBulletWeightBustsCache() {
        // Same id, different bulletWeightGrams → different physics → cache miss
        Bullet bulletLight = new Bullet("custom", "Light", "Custom",
            10.0, 853, 0.505, 7.82, 3500, "desc", "#000");
        Bullet bulletHeavy = new Bullet("custom", "Heavy", "Custom",
            12.0, 853, 0.505, 7.82, 4500, "desc", "#000");

        TrajectoryRequest req = new TrajectoryRequest("custom", 100, 300, 50, 0, 0, 15, null, null, null, null, null);

        engine.compute(bulletLight, req);
        engine.compute(bulletHeavy, req);

        // Different weight → two distinct cache entries → engine ran twice
        verify(engine, times(1)).compute(eq(bulletLight), eq(req));
        verify(engine, times(1)).compute(eq(bulletHeavy), eq(req));
    }

    @Test
    void customLoadsWithDifferentMuzzleVelocityGetSeparateCacheEntries() {
        // id="custom" with different muzzleVelocityMps → two cache entries
        Bullet fast = new Bullet("custom", "Fast Load", "Custom",
            11.34, 950, 0.505, 7.82, 4300, "desc", "#000");
        Bullet slow = new Bullet("custom", "Slow Load", "Custom",
            11.34, 760, 0.505, 7.82, 2750, "desc", "#000");

        TrajectoryRequest req = new TrajectoryRequest("custom", 100, 300, 50, 0, 0, 15, null, null, null, null, null);

        engine.compute(fast, req);
        engine.compute(slow, req);

        // Different muzzle velocity → two distinct cache entries → engine ran twice
        verify(engine, times(1)).compute(eq(fast), eq(req));
        verify(engine, times(1)).compute(eq(slow), eq(req));
    }
}
