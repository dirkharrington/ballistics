package com.ballistics;

import com.ballistics.model.*;
import com.ballistics.service.BallisticsEngine;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
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
        // 40 m/s ≈ 131 fps — well below speed of sound; supersonicLimit set at range 0
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

    // ── G1 drag table interpolation (via generic interpolateTable) ────────────

    @Test
    void interpolateG1BoundaryValuesViaReflection() throws Exception {
        Method m = BallisticsEngine.class.getDeclaredMethod("interpolateTable",
                double.class, double[].class, double[].class);
        m.setAccessible(true);

        // Retrieve the private G1 table arrays
        Field velField = BallisticsEngine.class.getDeclaredField("G1_VELOCITIES");
        velField.setAccessible(true);
        double[] g1V = (double[]) velField.get(null);

        Field coeffField = BallisticsEngine.class.getDeclaredField("G1_COEFFS");
        coeffField.setAccessible(true);
        double[] g1C = (double[]) coeffField.get(null);

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
        // muzzleVelocityMps=4500 → ~14764 fps, triggers "≥ last entry" branch in interpolateG1
        Bullet fast = new Bullet("fast-test", "Hypervelocity", "test",
            55, 4500, 0.5, 5.56, 3000, "test", "#fff");
        TrajectoryRequest req = new TrajectoryRequest("fast-test", 100, 300, 50, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(fast, req);
        assertThat(result.points()).isNotEmpty();
    }

    @Test
    void verySlowBulletTriggersEarlyBreakConditions() {
        // muzzleVelocityMps=40 → ~131 fps, below speed of sound → supersonicLimit=0
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

        // default step=25m, maxRange=1000m → 40+ points
        assertThat(result.points().size()).isGreaterThan(20);
    }

    // ── Sight height default ──────────────────────────────────────────────────

    @Test
    void sightHeightDefaultsTo38_1WhenNull() {
        Bullet bullet = findById("308-win-168gr");
        // null in the compact constructor defaults to 38.1 mm (1.5 in)
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
        // Beyond the zero range the bullet is below LoS: adjustment must be positive (click up)
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        // find a point well past zero (drop should be clearly negative)
        TrajectoryPoint far = result.points().stream()
            .filter(p -> p.rangeMeters() > 300 && p.dropCm() < 0)
            .findFirst()
            .orElseThrow();

        assertThat(far.moaAdjustment()).isPositive();
        assertThat(far.mradAdjustment()).isPositive();
        // MRAD < MOA numerically for any realistic drop (1 MOA ≈ 2.909 MRAD)
        assertThat(far.moaAdjustment()).isGreaterThan(far.mradAdjustment());
    }

    @Test
    void adjustmentsAreZeroWhenDropIsZero() {
        Bullet bullet = findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, null, null, null);
        TrajectoryResult result = engine.compute(bullet, req);

        // The zero-range point should have drop ≈ 0 and thus near-zero adjustments
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
        // Both uphill (+20°) and downhill (−20°) should produce less apparent drop
        // at the same slant range than flat fire.  cos(20°) ≈ 0.940.
        Bullet bullet = findById("308-win-168gr");

        TrajectoryRequest flat   = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, 0.0, null, null);
        TrajectoryRequest uphill = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, 20.0, null, null);
        TrajectoryRequest down   = new TrajectoryRequest(bullet.id(), 100, 500, 25, 0, 0, 15, null, -20.0, null, null);

        TrajectoryResult flatResult   = engine.compute(bullet, flat);
        TrajectoryResult uphillResult = engine.compute(bullet, uphill);
        TrajectoryResult downResult   = engine.compute(bullet, down);

        // Pick a point well past zero where flat drop is clearly negative
        double flatDrop   = pointAt(flatResult,   500).dropCm();
        double uphillDrop = pointAt(uphillResult, 500).dropCm();
        double downDrop   = pointAt(downResult,   500).dropCm();

        assertThat(flatDrop).isNegative();
        // |inclined drop| < |flat drop| — rifleman's rule cosine effect
        assertThat(Math.abs(uphillDrop)).isLessThan(Math.abs(flatDrop));
        assertThat(Math.abs(downDrop)).isLessThan(Math.abs(flatDrop));
    }

    @Test
    void zeroAngleMatchesFlatFireResult() {
        // Explicit angle=0.0 should produce identical results to angle=null (defaults to 0)
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static Bullet findById(String id) {
        return BulletCatalog.findById(id);
    }
}
