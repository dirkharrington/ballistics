package com.ballistics.model;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

class TrajectoryPointTest {

    @Test
    void constructorAndAllAccessors() {
        TrajectoryPoint p = new TrajectoryPoint(228.6, -47.0, 670.6, 2437.0, 16.0, 0.3456);
        assertThat(p.rangeMeters()).isEqualTo(228.6);
        assertThat(p.dropCm()).isEqualTo(-47.0);
        assertThat(p.velocityMps()).isEqualTo(670.6);
        assertThat(p.energyJoules()).isEqualTo(2437.0);
        assertThat(p.windDriftCm()).isEqualTo(16.0);
        assertThat(p.timeOfFlightSec()).isEqualTo(0.3456);
    }

    @Test
    void zeroPointAtMuzzle() {
        TrajectoryPoint p = new TrajectoryPoint(0.0, 0.0, 987.6, 1738.0, 0.0, 0.0);
        assertThat(p.rangeMeters()).isEqualTo(0.0);
        assertThat(p.dropCm()).isEqualTo(0.0);
        assertThat(p.windDriftCm()).isEqualTo(0.0);
        assertThat(p.timeOfFlightSec()).isEqualTo(0.0);
    }

    @Test
    void negativeDropIsAllowed() {
        TrajectoryPoint p = new TrajectoryPoint(457.2, -106.7, 548.6, 1217.0, 30.5, 0.7);
        assertThat(p.dropCm()).isNegative();
    }

    @Test
    void recordEquality() {
        TrajectoryPoint p1 = new TrajectoryPoint(91.4, -14.0, 762.0, 2711.0, 8.1, 0.1234);
        TrajectoryPoint p2 = new TrajectoryPoint(91.4, -14.0, 762.0, 2711.0, 8.1, 0.1234);
        assertThat(p1).isEqualTo(p2);
        assertThat(p1.hashCode()).isEqualTo(p2.hashCode());
    }

    @Test
    void recordInequality() {
        TrajectoryPoint p1 = new TrajectoryPoint(91.4,  -14.0, 762.0, 2711.0, 8.1, 0.1234);
        TrajectoryPoint p2 = new TrajectoryPoint(182.9, -14.0, 762.0, 2711.0, 8.1, 0.1234);
        assertThat(p1).isNotEqualTo(p2);
    }

    @Test
    void recordToStringContainsRangeMeters() {
        TrajectoryPoint p = new TrajectoryPoint(320.0, -55.9, 640.1, 1626.0, 20.3, 0.45);
        assertThat(p.toString()).contains("320.0");
    }
}
