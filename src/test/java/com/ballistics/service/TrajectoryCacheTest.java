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
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15, null, null, null, null);

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

        TrajectoryRequest req = new TrajectoryRequest("custom", 100, 1000, 100, 0, 0, 15, null, null, null, null);

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
    void customBulletsWithDifferentNameReturnOwnResult() {
        // Two bullets that differ only in name must each get their own cache entry.
        // This is essential for the custom-bullet flow because the name is part of
        // the Bullet record and therefore part of the cache key.
        Bullet bulletA = new Bullet("custom", "Alpha Load", "Custom",
            11.34, 853, 0.505, 7.82, 4000, "desc", "#00d4ff");
        Bullet bulletB = new Bullet("custom", "Beta Load", "Custom",
            11.34, 853, 0.505, 7.82, 4000, "desc", "#00d4ff");

        TrajectoryRequest req = new TrajectoryRequest("custom", 100, 500, 100, 0, 0, 15, null, null, null, null);

        TrajectoryResult rA = engine.compute(bulletA, req);
        TrajectoryResult rB = engine.compute(bulletB, req);

        // Each result carries its own bullet name
        assertThat(rA.bullet().name()).isEqualTo("Alpha Load");
        assertThat(rB.bullet().name()).isEqualTo("Beta Load");
    }

    @Test
    void sameCatalogRequestComputesOnlyOnce() {
        // Regression: catalog bullets must still be cache-hit on identical calls
        Bullet bullet = BulletCatalog.load().get(0);
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 100, 0, 0, 15, null, null, null, null);

        engine.compute(bullet, req);
        engine.compute(bullet, req);

        verify(engine, times(1)).compute(bullet, req);
    }
}
