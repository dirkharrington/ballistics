package com.ballistics.service;

import com.ballistics.model.Bullet;
import com.ballistics.model.TrajectoryRequest;
import com.ballistics.model.TrajectoryResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class TrajectoryCacheTest {

    @Autowired BallisticsEngine engine;

    @Test
    void identicalRequestsReturnCachedResult() {
        Bullet bullet = Bullet.knownRifleBullets().get(0);
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15);

        TrajectoryResult r1 = engine.compute(bullet, req);
        TrajectoryResult r2 = engine.compute(bullet, req);

        assertThat(r1).isSameAs(r2);
    }
}
