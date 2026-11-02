package com.ballistics;

import com.ballistics.model.*;
import com.ballistics.physics.PhysicsTables;
import com.ballistics.physics.PhysicsTablesLoader;
import com.ballistics.service.BallisticsEngine;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for BE-R1 extracted private methods: convertInputs and integrateTrajectory.
 * No Spring context needed — constructs BallisticsEngine directly.
 */
class BallisticsEngineExtractionTest {

    private BallisticsEngine engine;

    @BeforeEach
    void setUp() {
        PhysicsTables tables = PhysicsTablesLoader.load(new ClassPathResource("physics-tables.yaml"));
        engine = new BallisticsEngine(tables, new SimpleMeterRegistry());
    }

    // ── Reflection helpers ────────────────────────────────────────────────────

    private Object convertInputs(Bullet bullet, TrajectoryRequest req) throws Exception {
        Method m = BallisticsEngine.class.getDeclaredMethod("convertInputs",
                Bullet.class, TrajectoryRequest.class);
        m.setAccessible(true);
        return m.invoke(engine, bullet, req);
    }

    private Object integrateTrajectory(Object ci) throws Exception {
        Method m = BallisticsEngine.class.getDeclaredMethod("integrateTrajectory", ci.getClass());
        m.setAccessible(true);
        return m.invoke(engine, ci);
    }

    private double getDouble(Object obj, String component) throws Exception {
        Method m = obj.getClass().getDeclaredMethod(component);
        m.setAccessible(true);
        return (double) m.invoke(obj);
    }

    private double[] getDoubleArray(Object obj, String component) throws Exception {
        Method m = obj.getClass().getDeclaredMethod(component);
        m.setAccessible(true);
        return (double[]) m.invoke(obj);
    }

    @SuppressWarnings("unchecked")
    private List<TrajectoryPoint> getPoints(Object integrationResult) throws Exception {
        Method m = integrationResult.getClass().getDeclaredMethod("points");
        m.setAccessible(true);
        return (List<TrajectoryPoint>) m.invoke(integrationResult);
    }

    // ── convertInputs tests ───────────────────────────────────────────────────

    @Test
    void convertInputs_mvFpsIsScaledFromMuzzleVelocityMps() throws Exception {
        Bullet bullet = BulletCatalog.findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15, null, null, null, null);

        Object ci = convertInputs(bullet, req);

        double expectedMvFps = bullet.muzzleVelocityMps() * 3.28084;
        double actualMvFps   = getDouble(ci, "mvFps");
        assertThat(actualMvFps).isCloseTo(expectedMvFps, within(expectedMvFps * 0.0001));
    }

    @Test
    void convertInputs_airDensityRatioNearOneAtStandardConditions() throws Exception {
        Bullet bullet = BulletCatalog.findById("308-win-168gr");
        // alt=0 m, temp=15 °C (=59 °F) → standard atmosphere → ratio ≈ 1.0
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15, null, null, null, null);

        Object ci = convertInputs(bullet, req);

        double ratio = getDouble(ci, "airDensityRatio");
        assertThat(ratio).isCloseTo(1.0, within(0.01));
    }

    @Test
    void convertInputs_launchAngleIsSmallNonZeroForTypicalRequest() throws Exception {
        Bullet bullet = BulletCatalog.findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15, null, null, null, null);

        Object ci = convertInputs(bullet, req);

        double angle = getDouble(ci, "launchAngleRad");
        assertThat(angle).isBetween(-0.05, 0.05);
        assertThat(angle).isNotEqualTo(0.0);
    }

    @Test
    void convertInputs_g7DragModelAliasesG7Tables() throws Exception {
        Bullet bullet = BulletCatalog.findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15, null, null, null, "G7");

        Object ci = convertInputs(bullet, req);

        double[] ciDragVelocities = getDoubleArray(ci, "dragVelocities");

        Field f = BallisticsEngine.class.getDeclaredField("g7Velocities");
        f.setAccessible(true);
        double[] g7Velocities = (double[]) f.get(engine);

        assertThat(ciDragVelocities).isSameAs(g7Velocities);
    }

    // ── integrateTrajectory tests ─────────────────────────────────────────────

    @Test
    void integrateTrajectory_pointsMatchComputeOutput() throws Exception {
        Bullet bullet = BulletCatalog.findById("308-win-168gr");
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 1000, 25, 0, 0, 15, null, null, null, null);

        // Reference result from the full compute() (no Spring cache on raw instance)
        TrajectoryResult expected = engine.compute(bullet, req);

        // Call extracted methods directly
        Object ci = convertInputs(bullet, req);
        Object ir = integrateTrajectory(ci);
        List<TrajectoryPoint> actualPoints = getPoints(ir);

        assertThat(actualPoints).hasSameSizeAs(expected.points());
        assertThat(actualPoints.get(0))
                .isEqualTo(expected.points().get(0));
        assertThat(actualPoints.get(actualPoints.size() - 1))
                .isEqualTo(expected.points().get(expected.points().size() - 1));
    }

    @Test
    void integrateTrajectory_supersonicLimitWithinRangeForSupersonicLoad() throws Exception {
        Bullet bullet = BulletCatalog.findById("308-win-168gr");
        // 2000 m max — .308 Win 168 gr goes subsonic well before 2000 m
        TrajectoryRequest req = new TrajectoryRequest(bullet.id(), 100, 2000, 50, 0, 0, 15, null, null, null, null);

        Object ci = convertInputs(bullet, req);
        Object ir = integrateTrajectory(ci);

        double supersonicLimitYd = getDouble(ir, "supersonicLimitYd");
        double maxRangeYd        = getDouble(ci, "maxRangeYd");

        assertThat(supersonicLimitYd).isGreaterThan(0);
        assertThat(supersonicLimitYd).isLessThanOrEqualTo(maxRangeYd);
    }
}
