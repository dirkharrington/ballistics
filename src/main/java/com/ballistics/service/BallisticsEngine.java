package com.ballistics.service;

import com.ballistics.model.*;
import com.ballistics.physics.PhysicsTables;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * BallisticsEngine — point-mass external ballistics simulator.
 *
 * Physics model:
 *  - G1/G7 drag function (Ingalls/Mayewski tables via Siacci method)
 *  - Standard atmosphere model with altitude and temperature corrections
 *  - Constant crosswind drift using Pejsa approximation
 *  - Gravity: 32.174 ft/s²
 *
 * Integration is performed with a 4th-order Runge-Kutta stepper at 0.5-ms intervals
 * for accuracy, with output sampled at the requested step interval.
 *
 * All public API accepts and returns SI units. Internal physics runs in imperial
 * (fps, feet, lbs) to preserve G1/G7 table calibration.
 */
@Service
public class BallisticsEngine {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(BallisticsEngine.class);

    private final MeterRegistry meterRegistry;

    // ── Physical constants (imperial — internal physics only) ─────────────────
    private static final double GRAVITY_FPS2       = 32.174;
    private static final double SPEED_OF_SOUND_FPS = 1125.0;
    private static final double DT_SECONDS         = 0.0005;
    private static final double GRAINS_PER_POUND   = 7000.0;
    private static final double MM_PER_FOOT        = 304.8;
    private static final double FT_PER_YARD        = 3.0;
    private static final double MIN_VELOCITY_FPS   = 100.0;
    private static final double MPH_TO_FPS         = 1.46667;

    // ── SI → imperial conversion factors ─────────────────────────────────────
    private static final double FPS_PER_MPS      = 3.28084;
    private static final double FT_PER_METER     = 3.28084;
    private static final double M_PER_YARD       = 0.9144;
    private static final double CM_PER_INCH      = 2.54;
    private static final double J_PER_FTLB       = 1.35582;
    private static final double GRAINS_PER_GRAM  = 15.4324;
    private static final double MPH_PER_KPH      = 0.621371;

    // ── Physics table data (instance fields, copied once from the bean) ───────
    private final double[] g1Velocities;
    private final double[] g1Coeffs;
    private final double[] g7Velocities;
    private final double[] g7Coeffs;
    private final double atmStdTempF;
    private final double atmLapseRatePer1000Ft;
    private final double atmRankineOffset;
    private final double atmPressureCoeff;
    private final double atmPressureExp;

    public BallisticsEngine(PhysicsTables tables, MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        // Copy once from bean accessors (accessors clone; we never call them on the hot path)
        this.g1Velocities          = tables.g1().velocitiesFps();
        this.g1Coeffs              = tables.g1().coefficients();
        this.g7Velocities          = tables.g7().velocitiesFps();
        this.g7Coeffs              = tables.g7().coefficients();
        this.atmStdTempF           = tables.atmosphere().stdTempF();
        this.atmLapseRatePer1000Ft = tables.atmosphere().lapseRatePer1000Ft();
        this.atmRankineOffset      = tables.atmosphere().rankineOffset();
        this.atmPressureCoeff      = tables.atmosphere().pressureCoeff();
        this.atmPressureExp        = tables.atmosphere().pressureExp();
    }

    /**
     * Computes a full trajectory for the given bullet and simulation parameters.
     *
     * <p>Results are cached by the full set of bullet and request parameters.
     * Identical calls return the cached result without re-running the integrator.</p>
     */
    @Cacheable(value = "trajectories", key = "{ #bullet, #req }")
    public TrajectoryResult compute(Bullet bullet, TrajectoryRequest req) {
        long start = System.nanoTime();

        // ── Convert SI inputs to imperial for internal physics ────────────────
        double mvFps      = bullet.muzzleVelocityMps() * FPS_PER_MPS;
        double weightLbs  = (bullet.bulletWeightGrams() * GRAINS_PER_GRAM) / GRAINS_PER_POUND;
        double bc         = bullet.ballisticCoefficient();
        double windMph    = req.windSpeedKph() * MPH_PER_KPH;
        double windDirRad = Math.toRadians(req.windDirectionDeg());
        double crosswindMph = windMph * Math.sin(windDirRad);
        double altFt      = req.altitudeMeters()  * FT_PER_METER;
        double tempF      = req.temperatureC()    * 9.0 / 5.0 + 32.0;
        double cosAngle   = Math.cos(Math.toRadians(req.shootingAngleDegrees()));
        double zeroFt     = req.zeroRangeMeters() * FT_PER_METER * cosAngle;
        double maxRangeYd = req.maxRangeMeters()  / M_PER_YARD;
        double stepYd     = req.stepMeters()      / M_PER_YARD;

        // Select drag table based on the requested model (G1 or G7)
        final double[] dragVelocities = "G7".equals(req.dragModel()) ? g7Velocities : g1Velocities;
        final double[] dragCoeffs     = "G7".equals(req.dragModel()) ? g7Coeffs     : g1Coeffs;

        double sightHeightFt   = req.sightHeightMm() / MM_PER_FOOT;
        double airDensityRatio = airDensityRatio(altFt, tempF);
        double launchAngleRad  = findZeroAngle(mvFps, bc, airDensityRatio, zeroFt, sightHeightFt,
                                               dragVelocities, dragCoeffs);
        double tanLaunchAngle  = Math.tan(launchAngleRad);

        int expectedPoints = (int)(maxRangeYd / stepYd) + 2;
        List<TrajectoryPoint> points = new ArrayList<>(expectedPoints);
        double maxOrdinateIn = 0, maxOrdinateRangeYd = 0, supersonicLimitYd = maxRangeYd;

        double x  = 0, y  = 0;
        double vx = mvFps * Math.cos(launchAngleRad);
        double vy = mvFps * Math.sin(launchAngleRad);

        double dt            = DT_SECONDS;
        double t             = 0;
        double nextSampleYd  = 0;
        boolean supersonicLogged = false;

        double[] k1 = new double[2];
        double[] k2 = new double[2];
        double[] k3 = new double[2];
        double[] k4 = new double[2];

        while ((x / FT_PER_YARD) <= maxRangeYd + stepYd) {

            double rangeYd  = x / FT_PER_YARD;
            double velocity = Math.hypot(vx, vy);

            if (x >= (nextSampleYd * FT_PER_YARD) - 0.01) {
                double dropIn      = (y - x * tanLaunchAngle) * 12.0 * cosAngle;
                double energyFtLbs = 0.5 * (weightLbs / GRAVITY_FPS2) * velocity * velocity;
                double windDriftIn = windDriftIn(crosswindMph, mvFps, rangeYd, t, launchAngleRad);

                double rangeSI    = r1(rangeYd  * M_PER_YARD);
                double dropCmSI   = r1(dropIn   * CM_PER_INCH);
                double velocitySI = r1(velocity / FPS_PER_MPS);
                double energySI   = r1(energyFtLbs * J_PER_FTLB);
                double driftSI    = r1(windDriftIn * CM_PER_INCH);
                double tof        = Math.round(t * 10000.0) / 10000.0;

                double moaAdj = 0.0, mradAdj = 0.0;
                if (rangeSI > 0) {
                    double angleRad = Math.atan2(Math.abs(dropCmSI) / 100.0, rangeSI);
                    double sign = dropCmSI < 0 ? 1.0 : (dropCmSI > 0 ? -1.0 : 0.0);
                    moaAdj  = r1(sign * angleRad * (180.0 / Math.PI) * 60.0);
                    mradAdj = r1(sign * angleRad * 1000.0);
                }

                points.add(new TrajectoryPoint(
                    rangeSI, dropCmSI, velocitySI, energySI, driftSI, tof, moaAdj, mradAdj
                ));

                if (y * 12.0 > maxOrdinateIn) {
                    maxOrdinateIn      = y * 12.0;
                    maxOrdinateRangeYd = rangeYd;
                }
                nextSampleYd += stepYd;
            }

            if (!supersonicLogged && velocity < SPEED_OF_SOUND_FPS) {
                supersonicLimitYd = rangeYd;
                supersonicLogged  = true;
            }

            derivatives(vx, vy, velocity, bc, airDensityRatio, dragVelocities, dragCoeffs, k1);
            double vx2 = vx + 0.5*dt*k1[0], vy2 = vy + 0.5*dt*k1[1];
            derivatives(vx2, vy2, Math.hypot(vx2, vy2), bc, airDensityRatio, dragVelocities, dragCoeffs, k2);
            double vx3 = vx + 0.5*dt*k2[0], vy3 = vy + 0.5*dt*k2[1];
            derivatives(vx3, vy3, Math.hypot(vx3, vy3), bc, airDensityRatio, dragVelocities, dragCoeffs, k3);
            double vx4 = vx + dt*k3[0], vy4 = vy + dt*k3[1];
            derivatives(vx4, vy4, Math.hypot(vx4, vy4), bc, airDensityRatio, dragVelocities, dragCoeffs, k4);

            vx += (dt / 6.0) * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0]);
            vy += (dt / 6.0) * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]);
            x  += vx * dt;
            y  += vy * dt;
            t  += dt;

            if (velocity < MIN_VELOCITY_FPS) break;
        }

        TrajectoryResult result = new TrajectoryResult(
            bullet, req, points,
            r1(maxOrdinateIn      * CM_PER_INCH),
            r1(maxOrdinateRangeYd * M_PER_YARD),
            r1(supersonicLimitYd  * M_PER_YARD)
        );

        meterRegistry.timer("ballistics.compute",
            "bullet", bullet.id())
            .record(System.nanoTime() - start, java.util.concurrent.TimeUnit.NANOSECONDS);

        log.info("trajectory computed bullet={} rangeM={} durationMs={}",
            bullet.id(), req.maxRangeMeters(),
            (System.nanoTime() - start) / 1_000_000);

        return result;
    }

    // ── Drag deceleration derivatives ─────────────────────────────────────────

    private void derivatives(double vx, double vy, double velocity,
                              double bc, double airDensityRatio,
                              double[] dragVelocities, double[] dragCoeffs,
                              double[] out) {
        double dragAccel = dragDeceleration(velocity, bc, airDensityRatio, dragVelocities, dragCoeffs);
        out[0] = -(vx / velocity) * dragAccel;
        out[1] = -(vy / velocity) * dragAccel - GRAVITY_FPS2;
    }

    private double dragDeceleration(double velocity, double bc, double airDensityRatio,
                                     double[] velocities, double[] coeffs) {
        return interpolateTable(Math.abs(velocity), velocities, coeffs) * airDensityRatio / bc;
    }

    private double interpolateTable(double velocity, double[] velocities, double[] coeffs) {
        if (velocity <= velocities[0]) return coeffs[0];
        int last = velocities.length - 1;
        if (velocity >= velocities[last]) return coeffs[last];
        int i = Arrays.binarySearch(velocities, velocity);
        if (i >= 0) return coeffs[i];
        i = -(i + 1);
        double v0 = velocities[i-1], v1 = velocities[i];
        double f0 = coeffs[i-1],     f1 = coeffs[i];
        double t  = (velocity - v0) / (v1 - v0);
        return f0 + t * (f1 - f0);
    }

    // ── Zero-angle solver (bisection) ─────────────────────────────────────────

    private double findZeroAngle(double mvFps, double bc, double airDensityRatio, double zeroFt,
                                  double sightHeightFt,
                                  double[] dragVelocities, double[] dragCoeffs) {
        double lo = -0.05, hi = 0.05;
        for (int iter = 0; iter < 64; iter++) {
            double mid = (lo + hi) / 2.0;
            if (simulateY(mvFps, bc, mid, zeroFt, airDensityRatio, dragVelocities, dragCoeffs) < sightHeightFt) lo = mid;
            else hi = mid;
            if (Math.abs(hi - lo) < 1e-9) break;
        }
        return (lo + hi) / 2.0;
    }

    private double simulateY(double mvFps, double bc, double anglRad,
                              double targetX, double airDensityRatio,
                              double[] dragVelocities, double[] dragCoeffs) {
        double vx = mvFps * Math.cos(anglRad);
        double vy = mvFps * Math.sin(anglRad);
        double x = 0, y = 0, dt = DT_SECONDS;
        double[] k1 = new double[2], k2 = new double[2],
                 k3 = new double[2], k4 = new double[2];
        while (x < targetX) {
            double velocity = Math.hypot(vx, vy);
            if (velocity < 50) break;
            derivatives(vx, vy, velocity, bc, airDensityRatio, dragVelocities, dragCoeffs, k1);
            double vx2 = vx + 0.5*dt*k1[0], vy2 = vy + 0.5*dt*k1[1];
            derivatives(vx2, vy2, Math.hypot(vx2, vy2), bc, airDensityRatio, dragVelocities, dragCoeffs, k2);
            double vx3 = vx + 0.5*dt*k2[0], vy3 = vy + 0.5*dt*k2[1];
            derivatives(vx3, vy3, Math.hypot(vx3, vy3), bc, airDensityRatio, dragVelocities, dragCoeffs, k3);
            double vx4 = vx + dt*k3[0], vy4 = vy + dt*k3[1];
            derivatives(vx4, vy4, Math.hypot(vx4, vy4), bc, airDensityRatio, dragVelocities, dragCoeffs, k4);
            vx += (dt / 6.0) * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0]);
            vy += (dt / 6.0) * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]);
            x  += vx * dt;
            y  += vy * dt;
        }
        return y;
    }

    // ── Wind drift (Pejsa approximation) ─────────────────────────────────────

    private double windDriftIn(double windMph, double mvFps, double rangeYd,
                                double tof, double launchAngleRad) {
        if (windMph == 0) return 0;
        double windFps   = windMph * MPH_TO_FPS;
        double vacuumTof = (rangeYd * FT_PER_YARD) / (mvFps * Math.cos(launchAngleRad));
        return windFps * (tof - vacuumTof) * 12.0;
    }

    // ── Atmosphere model ──────────────────────────────────────────────────────

    private double airDensityRatio(double altFt, double tempF) {
        double standardTempAtAlt = atmStdTempF - atmLapseRatePer1000Ft * (altFt / 1000.0);
        double tempRatio  = (atmRankineOffset + standardTempAtAlt) / (atmRankineOffset + tempF);
        double pressRatio = Math.pow(1.0 - atmPressureCoeff * altFt, atmPressureExp);
        return pressRatio * tempRatio;
    }

    // ── Rounding helper ───────────────────────────────────────────────────────

    private static double r1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
