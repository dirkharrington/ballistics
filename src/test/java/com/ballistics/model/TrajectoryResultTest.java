package com.ballistics.model;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

class TrajectoryResultTest {

    private static final Bullet BULLET = Bullet.knownRifleBullets().get(1);
    private static final TrajectoryRequest REQUEST =
        new TrajectoryRequest("308-win-168gr", 100, 500, 25, 0, 0, 15, null);

    @Test
    void constructorAndAllAccessors() {
        List<TrajectoryPoint> points = List.of(
            new TrajectoryPoint(0.0,    0.0,  807.7, 3552.0, 0.0, 0.0),
            new TrajectoryPoint(91.4,   0.0,  747.6, 3036.0, 0.0, 0.12),
            new TrajectoryPoint(457.2, -106.7, 548.6, 1637.0, 0.0, 0.65)
        );

        TrajectoryResult result = new TrajectoryResult(BULLET, REQUEST, points, 8.1, 68.6, 731.5);

        assertThat(result.bullet()).isEqualTo(BULLET);
        assertThat(result.request()).isEqualTo(REQUEST);
        assertThat(result.points()).hasSize(3);
        assertThat(result.maxOrdinateCm()).isEqualTo(8.1);
        assertThat(result.maxOrdinateRangeMeters()).isEqualTo(68.6);
        assertThat(result.supersonicLimitMeters()).isEqualTo(731.5);
    }

    @Test
    void emptyPointsListIsAllowed() {
        TrajectoryResult result = new TrajectoryResult(BULLET, REQUEST, List.of(), 0.0, 0.0, 0.0);
        assertThat(result.points()).isEmpty();
        assertThat(result.maxOrdinateCm()).isEqualTo(0.0);
    }

    @Test
    void recordEquality() {
        List<TrajectoryPoint> pts = List.of(
            new TrajectoryPoint(91.4, 0.0, 762.0, 2711.0, 0.0, 0.1)
        );
        TrajectoryResult r1 = new TrajectoryResult(BULLET, REQUEST, pts, 5.1, 54.9, 777.2);
        TrajectoryResult r2 = new TrajectoryResult(BULLET, REQUEST, pts, 5.1, 54.9, 777.2);
        assertThat(r1).isEqualTo(r2);
        assertThat(r1.hashCode()).isEqualTo(r2.hashCode());
    }

    @Test
    void recordInequality() {
        TrajectoryResult r1 = new TrajectoryResult(BULLET, REQUEST, List.of(), 1.0, 45.7, 731.5);
        TrajectoryResult r2 = new TrajectoryResult(BULLET, REQUEST, List.of(), 2.0, 45.7, 731.5);
        assertThat(r1).isNotEqualTo(r2);
    }

    @Test
    void recordToStringIsNotBlank() {
        TrajectoryResult r = new TrajectoryResult(BULLET, REQUEST, List.of(), 0.0, 0.0, 0.0);
        assertThat(r.toString()).isNotBlank();
    }

    @Test
    void supersonicLimitCanEqualMaxRange() {
        TrajectoryResult r = new TrajectoryResult(BULLET, REQUEST, List.of(), 0.0, 0.0, 500.0);
        assertThat(r.supersonicLimitMeters()).isEqualTo(REQUEST.maxRangeMeters());
    }
}
