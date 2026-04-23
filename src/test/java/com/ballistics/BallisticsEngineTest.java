package com.ballistics;

import com.ballistics.model.*;
import com.ballistics.service.BallisticsEngine;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.*;

class BallisticsEngineTest {

    private BallisticsEngine engine;

    @BeforeEach
    void setUp() {
        engine = new BallisticsEngine(new SimpleMeterRegistry());
    }

    // ── Core trajectory ───────────────────────────────────────────────────────

    @Test
    void allKnownBulletsProduceTrajectory() {
        for (Bullet bullet : Bullet.knownRifleBullets()) {
            TrajectoryRequest r = new TrajectoryRequest(
                bullet.id(), 100, 1000, 25, 16, 0, 15, null
            );
            TrajectoryResult result = engine.compute(bullet, r);

            assertThat(result.points()).isNotEmpty();
            assertThat(result.points().size()).isGreaterThan(10);

            TrajectoryPoint first = result.points().get(0);
            assertThat(first.rangeMeters()).isLessThanOrEqualTo(25.1);

            TrajectoryPoint last = result.points().get(result.points().size() - 1);
            assertThat(last.timeOfFlightSec()).isGreaterThan(first.timeOfFlightSec());
            assertThat(last.velocityMps()).isPositive();
            assertThat(last.energyJoules()).isPositive();
        }
    }

    @Test
    void sixFiveCreedmoorHasHigherBCAndLowerStartingVelocityThan223() {
        Bullet creedmoor = findById("65-creedmoor-140gr");
        Bullet rem223    = findById("223-rem-55gr");

        assertThat(creedmoor.ballisticCoefficient()).isGreaterThan(rem223.ballisticCoefficient());

        TrajectoryRequest req = new TrajectoryRequest(null, 100, 1000, 100, 0, 0, 15, null);
        TrajectoryResult creedmoorResult = engine.compute(creedmoor, req);
        TrajectoryResult rem223Result    = engine.compute(rem223, req);

        assertThat(creedmoorResult.points()).isNotEmpty();
        assertThat(rem223Result.points()).isNotEmpty();
    }

    @Test
    void zeroingWorksCorrectly() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null);
        TrajectoryResult result = engine.compute(bullet, req);

        // At the zero range the bore is angled upward, so the extended bore height exceeds
        // the bullet's actual height (≈38mm), giving a small negative drop.
        result.points().stream()
            .filter(p -> Math.abs(p.rangeMeters() - 100) < 1)
            .findFirst()
            .ifPresent(p -> {
                assertThat(p.dropCm()).isNegative();
                assertThat(p.dropCm()).isGreaterThan(-13.0); // no more than ~5 inches
            });
    }

    // ── Wind drift ────────────────────────────────────────────────────────────

    @Test
    void windDriftIsZeroWhenNoWind() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 100, 0, 0, 15, null);
        TrajectoryResult result = engine.compute(bullet, req);

        result.points().forEach(p ->
            assertThat(p.windDriftCm()).isEqualTo(0.0)
        );
    }

    @Test
    void windDriftIsComputedWhenWindIsPresent() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 100, 16, 0, 15, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.points()).isNotEmpty();
        assertThat(result.request().windSpeedKph()).isEqualTo(16.0);
    }

    // ── Supersonic limit ──────────────────────────────────────────────────────

    @Test
    void supersonicLimitEqualsMaxRangeWhenBulletNeverGoesSubsonic() {
        Bullet bullet = findById("223-rem-55gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 50, 0, 0, 15, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.supersonicLimitMeters()).isEqualTo(req.maxRangeMeters());
    }

    @Test
    void supersonicLimitIsZeroWhenBulletStartsSubsonic() {
        // 40 m/s ≈ 131 fps — well below speed of sound; supersonicLimit set at range 0
        Bullet slow = new Bullet("slow-test", "Slow", "test",
            50, 40, 0.1, 0.3, 5, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest("slow-test", 100, 200, 25, 0, 0, 15, null);
        TrajectoryResult result = engine.compute(slow, req);

        assertThat(result.supersonicLimitMeters()).isEqualTo(0.0);
    }

    // ── Max ordinate ──────────────────────────────────────────────────────────

    @Test
    void maxOrdinateIsPositiveAboveBoreLine() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.maxOrdinateCm()).isGreaterThan(0);
        assertThat(result.maxOrdinateRangeMeters()).isGreaterThan(0);
        assertThat(result.maxOrdinateRangeMeters()).isLessThan(req.maxRangeMeters());
    }

    // ── Atmosphere model ──────────────────────────────────────────────────────

    @Test
    void airDensityRatioViaReflection() throws Exception {
        // Internal method still takes feet and Fahrenheit for physics accuracy
        Method m = BallisticsEngine.class.getDeclaredMethod(
            "airDensityRatio", double.class, double.class);
        m.setAccessible(true);

        double sealevel = (double) m.invoke(engine, 0.0, 59.0);
        assertThat(sealevel).isCloseTo(1.0, within(0.01));

        double altitude = (double) m.invoke(engine, 5000.0, 59.0);
        assertThat(altitude).isLessThan(sealevel);

        double hot = (double) m.invoke(engine, 0.0, 110.0);
        assertThat(hot).isLessThan(sealevel);

        assertThat((double) m.invoke(engine, 3000.0, 70.0)).isGreaterThan(0);
    }

    // ── G1 drag table interpolation ───────────────────────────────────────────

    @Test
    void interpolateG1BoundaryValuesViaReflection() throws Exception {
        Method m = BallisticsEngine.class.getDeclaredMethod("interpolateG1", double.class);
        m.setAccessible(true);

        assertThat((double) m.invoke(engine,  0.0)).isEqualTo(0.1198);
        assertThat((double) m.invoke(engine, -5.0)).isEqualTo(0.1198);

        assertThat((double) m.invoke(engine, 4000.0)).isEqualTo(0.0800);
        assertThat((double) m.invoke(engine, 5000.0)).isEqualTo(0.0800);

        assertThat((double) m.invoke(engine, 700.0)).isEqualTo(0.1194);

        double interpolated = (double) m.invoke(engine, 1025.0);
        assertThat(interpolated).isBetween(0.1250, 0.1315);
    }

    // ── Edge cases for code coverage ──────────────────────────────────────────

    @Test
    void hypervelocityBulletExercisesHighEndDragTable() {
        // muzzleVelocityMps=4500 → ~14764 fps, triggers "≥ last entry" branch in interpolateG1
        Bullet fast = new Bullet("fast-test", "Hypervelocity", "test",
            55, 4500, 0.5, 5.56, 3000, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest("fast-test", 100, 300, 50, 0, 0, 15, null);
        TrajectoryResult result = engine.compute(fast, req);
        assertThat(result.points()).isNotEmpty();
    }

    @Test
    void verySlowBulletTriggersEarlyBreakConditions() {
        // muzzleVelocityMps=40 → ~131 fps, below speed of sound → supersonicLimit=0
        Bullet slow = new Bullet("slow-test", "Slow", "test",
            50, 40, 0.1, 0.3, 5, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest("slow-test", 100, 200, 25, 0, 0, 15, null);
        TrajectoryResult result = engine.compute(slow, req);

        assertThat(result).isNotNull();
        assertThat(result.supersonicLimitMeters()).isEqualTo(0.0);
    }

    // ── Result structure ──────────────────────────────────────────────────────

    @Test
    void trajectoryResultContainsExpectedFields() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 16, 0, 15, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.bullet()).isEqualTo(bullet);
        assertThat(result.request()).isEqualTo(req);
        assertThat(result.points()).isNotEmpty();
        assertThat(result.maxOrdinateCm()).isGreaterThanOrEqualTo(0);
        assertThat(result.maxOrdinateRangeMeters()).isGreaterThanOrEqualTo(0);
        assertThat(result.supersonicLimitMeters()).isGreaterThanOrEqualTo(0);
    }

    @Test
    void trajectoryPointFieldsAreRoundedAndPositive() {
        Bullet bullet = findById("223-rem-55gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 200, 25, 16, 0, 15, null);
        TrajectoryResult result = engine.compute(bullet, req);

        result.points().forEach(p -> {
            assertThat(p.rangeMeters()).isGreaterThanOrEqualTo(0);
            assertThat(p.velocityMps()).isGreaterThan(0);
            assertThat(p.energyJoules()).isGreaterThan(0);
            assertThat(p.timeOfFlightSec()).isGreaterThanOrEqualTo(0);
        });
    }

    @Test
    void defaultTrajectoryRequestValuesAreApplied() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 0, 0, 0, 0, 0, 15, null);
        TrajectoryResult result = engine.compute(bullet, req);

        // default step=25m, maxRange=1000m → 40+ points
        assertThat(result.points().size()).isGreaterThan(20);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static Bullet findById(String id) {
        return Bullet.knownRifleBullets().stream()
            .filter(b -> b.id().equals(id)).findFirst().orElseThrow();
    }
}
