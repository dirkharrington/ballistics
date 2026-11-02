package com.ballistics;

import com.ballistics.model.*;
import com.ballistics.physics.PhysicsTables;
import com.ballistics.physics.PhysicsTablesLoader;
import com.ballistics.service.BallisticsEngine;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.*;

class BallisticsEngineTest {

    private BallisticsEngine engine;

    @BeforeEach
    void setUp() {
        PhysicsTables tables = PhysicsTablesLoader.load(new ClassPathResource("physics-tables.yaml"));
        engine = new BallisticsEngine(tables, new SimpleMeterRegistry());
    }

    // ── Core trajectory ───────────────────────────────────────────────────────

    @Test
    void allKnownBulletsProduceTrajectory() {
        for (Bullet bullet : BulletCatalog.load()) {
            TrajectoryRequest r = new TrajectoryRequest(
                bullet.id(), 100, 1000, 25, 16, 0, 15, null, null, null, null
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

        TrajectoryRequest req = new TrajectoryRequest(null, 100, 1000, 100, 0, 0, 15, null, null, null, null);
        TrajectoryResult creedmoorResult = engine.compute(creedmoor, req);
        TrajectoryResult rem223Result    = engine.compute(rem223, req);

        assertThat(creedmoorResult.points()).isNotEmpty();
        assertThat(rem223Result.points()).isNotEmpty();
    }

    @Test
    void zeroingWorksCorrectly() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        result.points().stream()
            .filter(p -> Math.abs(p.rangeMeters() - 100) < 1)
            .findFirst()
            .ifPresent(p -> {
                assertThat(p.dropCm()).isNegative();
                assertThat(p.dropCm()).isGreaterThan(-13.0);
            });
    }

    // ── Wind drift ────────────────────────────────────────────────────────────

    @Test
    void windDriftIsZeroWhenNoWind() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 100, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        result.points().forEach(p ->
            assertThat(p.windDriftCm()).isEqualTo(0.0)
        );
    }

    @Test
    void windDriftIsComputedWhenWindIsPresent() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 100, 16, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.points()).isNotEmpty();
        assertThat(result.request().windSpeedKph()).isEqualTo(16.0);
    }

    // ── Supersonic limit ──────────────────────────────────────────────────────

    @Test
    void supersonicLimitEqualsMaxRangeWhenBulletNeverGoesSubsonic() {
        Bullet bullet = findById("223-rem-55gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 50, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.supersonicLimitMeters()).isEqualTo(req.maxRangeMeters());
    }

    @Test
    void supersonicLimitIsZeroWhenBulletStartsSubsonic() {
        Bullet slow = new Bullet("slow-test", "Slow", "test",
            50, 40, 0.1, 0.3, 5, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest("slow-test", 100, 200, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(slow, req);

        assertThat(result.supersonicLimitMeters()).isEqualTo(0.0);
    }

    // ── Max ordinate ──────────────────────────────────────────────────────────

    @Test
    void maxOrdinateIsPositiveAboveBoreLine() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.maxOrdinateCm()).isGreaterThan(0);
        assertThat(result.maxOrdinateRangeMeters()).isGreaterThan(0);
        assertThat(result.maxOrdinateRangeMeters()).isLessThan(req.maxRangeMeters());
    }

    // ── Atmosphere model ──────────────────────────────────────────────────────

    @Test
    void airDensityRatioViaReflection() throws Exception {
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
        Method m = BallisticsEngine.class.getDeclaredMethod("interpolateTable",
                double.class, double[].class, double[].class);
        m.setAccessible(true);

        // Retrieve instance fields g1Velocities and g1Coeffs
        java.lang.reflect.Field velField = BallisticsEngine.class.getDeclaredField("g1Velocities");
        velField.setAccessible(true);
        double[] g1V = (double[]) velField.get(engine);

        java.lang.reflect.Field coeffField = BallisticsEngine.class.getDeclaredField("g1Coeffs");
        coeffField.setAccessible(true);
        double[] g1C = (double[]) coeffField.get(engine);

        assertThat((double) m.invoke(engine,  0.0, g1V, g1C)).isEqualTo(0.1198);
        assertThat((double) m.invoke(engine, -5.0, g1V, g1C)).isEqualTo(0.1198);

        assertThat((double) m.invoke(engine, 4000.0, g1V, g1C)).isEqualTo(0.0800);
        assertThat((double) m.invoke(engine, 5000.0, g1V, g1C)).isEqualTo(0.0800);

        assertThat((double) m.invoke(engine, 700.0, g1V, g1C)).isEqualTo(0.1194);

        double interpolated = (double) m.invoke(engine, 1025.0, g1V, g1C);
        assertThat(interpolated).isBetween(0.1250, 0.1315);
    }

    // ── Edge cases for code coverage ──────────────────────────────────────────

    @Test
    void hypervelocityBulletExercisesHighEndDragTable() {
        Bullet fast = new Bullet("fast-test", "Hypervelocity", "test",
            55, 4500, 0.5, 5.56, 3000, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest("fast-test", 100, 300, 50, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(fast, req);
        assertThat(result.points()).isNotEmpty();
    }

    @Test
    void verySlowBulletTriggersEarlyBreakConditions() {
        Bullet slow = new Bullet("slow-test", "Slow", "test",
            50, 40, 0.1, 0.3, 5, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest("slow-test", 100, 200, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(slow, req);

        assertThat(result).isNotNull();
        assertThat(result.supersonicLimitMeters()).isEqualTo(0.0);
    }

    // ── Result structure ──────────────────────────────────────────────────────

    @Test
    void trajectoryResultContainsExpectedFields() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 16, 0, 15, null, null, null, null);
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
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 200, 25, 16, 0, 15, null, null, null, null);
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
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 0, 0, 0, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.points().size()).isGreaterThan(20);
    }

    // ── Sight height default ──────────────────────────────────────────────────

    @Test
    void sightHeightDefaultsTo38_1WhenNull() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest withNull  = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryRequest with38_1  = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, 38.1, null, null, null);

        TrajectoryResult r1 = engine.compute(bullet, withNull);
        TrajectoryResult r2 = engine.compute(bullet, with38_1);

        assertThat(r1.points()).hasSameSizeAs(r2.points());
        assertThat(r1.points().get(5).dropCm())
            .isCloseTo(r2.points().get(5).dropCm(), within(0.01));
    }

    // ── MOA / MRAD scope-adjustment output ───────────────────────────────────

    @Test
    void muzzlePointHasZeroAdjustments() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        TrajectoryPoint muzzle = result.points().get(0);
        assertThat(muzzle.rangeMeters()).isEqualTo(0.0);
        assertThat(muzzle.moaAdjustment()).isEqualTo(0.0);
        assertThat(muzzle.mradAdjustment()).isEqualTo(0.0);
    }

    @Test
    void pointBeyondZeroHasPositiveAdjustment() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        TrajectoryPoint far = result.points().stream()
            .filter(p -> p.rangeMeters() > 300 && p.dropCm() < 0)
            .findFirst()
            .orElseThrow();

        assertThat(far.moaAdjustment()).isPositive();
        assertThat(far.mradAdjustment()).isPositive();
        assertThat(far.moaAdjustment()).isGreaterThan(far.mradAdjustment());
    }

    @Test
    void adjustmentsAreZeroWhenDropIsZero() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        result.points().stream()
            .filter(p -> Math.abs(p.dropCm()) < 0.1)
            .forEach(p -> {
                assertThat(p.moaAdjustment()).isBetween(-0.5, 0.5);
                assertThat(p.mradAdjustment()).isBetween(-0.2, 0.2);
            });
    }

    // ── Inclined-fire angle correction (rifleman's rule) ─────────────────────

    @Test
    void inclinedFireReducesApparentDropVsFlat() {
        Bullet bullet = findById("308-win-168gr");

        TrajectoryRequest flat   = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, 0.0, null, null);
        TrajectoryRequest uphill = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, 20.0, null, null);
        TrajectoryRequest down   = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, -20.0, null, null);

        TrajectoryResult flatResult   = engine.compute(bullet, flat);
        TrajectoryResult uphillResult = engine.compute(bullet, uphill);
        TrajectoryResult downResult   = engine.compute(bullet, down);

        double flatDrop   = pointAt(flatResult,   500).dropCm();
        double uphillDrop = pointAt(uphillResult, 500).dropCm();
        double downDrop   = pointAt(downResult,   500).dropCm();

        assertThat(flatDrop).isNegative();
        assertThat(Math.abs(uphillDrop)).isLessThan(Math.abs(flatDrop));
        assertThat(Math.abs(downDrop)).isLessThan(Math.abs(flatDrop));
    }

    @Test
    void zeroAngleMatchesFlatFireResult() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest withNull  = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryRequest withZero  = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, 0.0, null, null);

        TrajectoryResult nullResult = engine.compute(bullet, withNull);
        TrajectoryResult zeroResult = engine.compute(bullet, withZero);

        assertThat(nullResult.points()).hasSameSizeAs(zeroResult.points());
        for (int i = 0; i < nullResult.points().size(); i++) {
            assertThat(nullResult.points().get(i).dropCm())
                .isCloseTo(zeroResult.points().get(i).dropCm(), within(0.001));
        }
    }

    @Test
    void shootingAngleDefaultsToZeroWhenNull() {
        TrajectoryRequest req = new TrajectoryRequest("id", 100, 500, 25, 0, 0, 15, null, null, null, null);
        assertThat(req.shootingAngleDegrees()).isEqualTo(0.0);
    }

    private static TrajectoryPoint pointAt(TrajectoryResult result, double rangeM) {
        return result.points().stream()
            .filter(p -> Math.abs(p.rangeMeters() - rangeM) < 15)
            .findFirst()
            .orElseThrow(() -> new AssertionError("No point near " + rangeM + " m"));
    }

    // ── Coverage: dropCmSI == 0.0 branch (sign = 0.0 path in line 218) ──────────

    @Test
    void dropCmSignZeroCaseAtOneMetreStep() {
        // At 1 m from the muzzle the bullet is so close to the bore line that
        // the rounded dropCm value is exactly 0.0, exercising the sign==0 branch.
        Bullet bullet = findById("308-win-168gr"); // fast bullet, mv ≈ 820 m/s
        TrajectoryRequest req = new TrajectoryRequest(
            bullet.id(), 100, 100, 1, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        assertThat(result.points()).isNotEmpty();
        // The 1 m point's drop rounds to 0.0 before the zero range
        result.points().stream()
            .filter(p -> Math.abs(p.rangeMeters() - 1.0) < 0.6)
            .findFirst()
            .ifPresent(p -> assertThat(p.dropCm()).isEqualTo(0.0));
    }

    // ── Coverage: velocity < MIN_VELOCITY_FPS break (line 242) ───────────────

    @Test
    void ultraLowBcBulletTriggersMinVelocityBreak() {
        // BC=0.001 → 100× more drag than a typical 0.1-BC bullet → decelerates
        // below MIN_VELOCITY_FPS (100 fps) within ~20 m, exercising the break.
        Bullet ultraLow = new Bullet("ultra-low-bc-mvbreak", "Ultra Low BC", "test",
            50, 50.0, 0.001, 10.0, 62.5, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest(
            "ultra-low-bc-mvbreak", 100, 50, 5, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(ultraLow, req);
        assertThat(result).isNotNull();
    }

    // ── Coverage: simulateY velocity guard < 50 fps (line 332) ──────────────

    @Test
    void ultraLowBcBulletTriggersSimulateYVelocityGuard() {
        // zeroRange=200 m → simulateY targets 218 yd, but the ultra-low-BC bullet
        // decelerates below 50 fps within a few feet, exercising the break in
        // simulateY that guards against near-zero-velocity bisection.
        Bullet ultraLow = new Bullet("ultra-low-bc-simY", "Ultra Low BC SimY", "test",
            50, 50.0, 0.001, 10.0, 62.5, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest(
            "ultra-low-bc-simY", 200, 50, 50, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(ultraLow, req);
        assertThat(result).isNotNull();
    }

    private static Bullet findById(String id) {
        return BulletCatalog.findById(id);
    }
}
