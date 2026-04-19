package com.ballistics.model;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

class TrajectoryRequestTest {

    @Test
    void positiveValuesArePreserved() {
        TrajectoryRequest req = new TrajectoryRequest("bullet-id", 200, 800, 50, 15, 1000, 25);
        assertThat(req.bulletId()).isEqualTo("bullet-id");
        assertThat(req.zeroRangeMeters()).isEqualTo(200);
        assertThat(req.maxRangeMeters()).isEqualTo(800);
        assertThat(req.stepMeters()).isEqualTo(50);
        assertThat(req.windSpeedKph()).isEqualTo(15);
        assertThat(req.altitudeMeters()).isEqualTo(1000);
        assertThat(req.temperatureC()).isEqualTo(25);
    }

    @Test
    void zeroRangeMetersDefaultsTo100WhenZero() {
        TrajectoryRequest req = new TrajectoryRequest("id", 0, 500, 25, 0, 0, 15);
        assertThat(req.zeroRangeMeters()).isEqualTo(100);
    }

    @Test
    void zeroRangeMetersDefaultsTo100WhenNegative() {
        TrajectoryRequest req = new TrajectoryRequest("id", -50, 500, 25, 0, 0, 15);
        assertThat(req.zeroRangeMeters()).isEqualTo(100);
    }

    @Test
    void maxRangeMetersDefaultsTo1000WhenZero() {
        TrajectoryRequest req = new TrajectoryRequest("id", 100, 0, 25, 0, 0, 15);
        assertThat(req.maxRangeMeters()).isEqualTo(1000);
    }

    @Test
    void maxRangeMetersDefaultsTo1000WhenNegative() {
        TrajectoryRequest req = new TrajectoryRequest("id", 100, -100, 25, 0, 0, 15);
        assertThat(req.maxRangeMeters()).isEqualTo(1000);
    }

    @Test
    void stepMetersDefaultsTo25WhenZero() {
        TrajectoryRequest req = new TrajectoryRequest("id", 100, 500, 0, 0, 0, 15);
        assertThat(req.stepMeters()).isEqualTo(25);
    }

    @Test
    void stepMetersDefaultsTo25WhenNegative() {
        TrajectoryRequest req = new TrajectoryRequest("id", 100, 500, -10, 0, 0, 15);
        assertThat(req.stepMeters()).isEqualTo(25);
    }

    @Test
    void allThreeDefaultsAppliedSimultaneously() {
        TrajectoryRequest req = new TrajectoryRequest("id", 0, 0, 0, 0, 0, 15);
        assertThat(req.zeroRangeMeters()).isEqualTo(100);
        assertThat(req.maxRangeMeters()).isEqualTo(1000);
        assertThat(req.stepMeters()).isEqualTo(25);
    }

    @Test
    void windSpeedAndAltitudeAndTemperatureAllowZero() {
        TrajectoryRequest req = new TrajectoryRequest("id", 100, 500, 25, 0, 0, 0);
        assertThat(req.windSpeedKph()).isEqualTo(0);
        assertThat(req.altitudeMeters()).isEqualTo(0);
        assertThat(req.temperatureC()).isEqualTo(0);
    }

    @Test
    void nullBulletIdIsAllowed() {
        TrajectoryRequest req = new TrajectoryRequest(null, 100, 500, 25, 0, 0, 15);
        assertThat(req.bulletId()).isNull();
    }

    @Test
    void recordEquality() {
        TrajectoryRequest r1 = new TrajectoryRequest("a", 100, 1000, 25, 16, 0, 15);
        TrajectoryRequest r2 = new TrajectoryRequest("a", 100, 1000, 25, 16, 0, 15);
        assertThat(r1).isEqualTo(r2);
        assertThat(r1.hashCode()).isEqualTo(r2.hashCode());
    }

    @Test
    void recordInequality() {
        TrajectoryRequest r1 = new TrajectoryRequest("a", 100, 1000, 25, 16, 0, 15);
        TrajectoryRequest r2 = new TrajectoryRequest("b", 100, 1000, 25, 16, 0, 15);
        assertThat(r1).isNotEqualTo(r2);
    }

    @Test
    void recordToStringContainsBulletId() {
        TrajectoryRequest req = new TrajectoryRequest("unique-bullet-id", 100, 500, 25, 0, 0, 15);
        assertThat(req.toString()).contains("unique-bullet-id");
    }
}
