package com.ballistics.service;

import com.ballistics.model.Bullet;
import com.ballistics.model.TrajectoryRequest;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import static org.mockito.Mockito.*;

@SpringBootTest
class TrajectoryCacheTest {

    @MockitoSpyBean BallisticsEngine engine;

    @Test
    void identicalRequestsComputeOnlyOnce() {
        Bullet bullet = Bullet.knownRifleBullets().get(0);
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15, null);

        engine.compute(bullet, req);
        engine.compute(bullet, req);

        verify(engine, times(1)).compute(bullet, req);
    }
}
