package com.ballistics.service;

import com.ballistics.model.*;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * BallisticsEngine — point-mass external ballistics simulator.
 *
 * Physics model:
 *  - G1 drag function (Ingalls tables approximation via Siacci method)
 *  - Standard atmosphere model with altitude & temperature corrections
 *  - Constant crosswind drift using Pejsa approximation
 *  - Gravity: 32.174 ft/s²
 *
 * Integration is performed with a 4th-order Runge-Kutta stepper at 0.5-ms intervals
 * for accuracy, with output sampled at the requested step interval.
 *
 * All public API accepts and returns SI units. Internal physics runs in imperial
 * (fps, feet, lbs) to preserve G1 table calibration.
 */
@Service
public class BallisticsEngine {

    // ── Physical constants (imperial — internal physics only) ─────────────────
    private static final double GRAVITY_FPS2       = 32.174;
    private static final double SPEED_OF_SOUND_FPS = 1125.0;

    // ── SI ↔ imperial conversion factors ─────────────────────────────────────
    private static final double FPS_PER_MPS      = 3.28084;
    private static final double FT_PER_METER     = 3.28084;
    private static final double M_PER_YARD       = 0.9144;
    private static final double CM_PER_INCH      = 2.54;
    private static final double J_PER_FTLB       = 1.35582;
    private static final double GRAINS_PER_GRAM  = 15.4324;
    private static final double MPH_PER_KPH      = 0.621371;

    // ── G1 drag table split into parallel arrays for cache-friendly binary search ──
    private static final double[] G1_VELOCITIES = {
           0,  400,  500,  600,  700,  800,  900,  950,
        1000, 1050, 1100, 1150, 1200, 1250, 1300, 1350,
        1400, 1450, 1500, 1600, 1700, 1800, 1900, 2000,
        2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800,
        2900, 3000, 3100, 3200, 3300, 3400, 3500, 3600, 4000
    };

    private static final double[] G1_COEFFS = {
        0.1198, 0.1198, 0.1197, 0.1196, 0.1194, 0.1193, 0.1194, 0.1202,
        0.1250, 0.1315, 0.1420, 0.1550, 0.1700, 0.1820, 0.1920, 0.1990,
        0.2030, 0.2020, 0.1990, 0.1920, 0.1840, 0.1750, 0.1660, 0.1580,
        0.1500, 0.1425, 0.1355, 0.1295, 0.1240, 0.1188, 0.1140, 0.1096,
        0.1056, 0.1020, 0.0986, 0.0955, 0.0926, 0.0900, 0.0878, 0.0858, 0.0800
    };

    // ─────────────────────────────────────────────────────────────────────────

    public TrajectoryResult compute(Bullet bullet, TrajectoryRequest req) {

        // ── Convert SI inputs to imperial for internal physics ────────────────
        double mvFps      = bullet.muzzleVelocityMps() * FPS_PER_MPS;
        double weightLbs  = (bullet.bulletWeightGrams() * GRAINS_PER_GRAM) / 7000.0;
        double bc         = bullet.ballisticCoefficient();
        double windMph    = req.windSpeedKph()    * MPH_PER_KPH;
        double altFt      = req.altitudeMeters()  * FT_PER_METER;
        double tempF      = req.temperatureC()    * 9.0 / 5.0 + 32.0;
        double zeroFt     = req.zeroRangeMeters() * FT_PER_METER;
        double maxRangeYd = req.maxRangeMeters()  / M_PER_YARD;
        double stepYd     = req.stepMeters()      / M_PER_YARD;

        double airDensityRatio = airDensityRatio(altFt, tempF);
        double launchAngleRad  = findZeroAngle(mvFps, bc, airDensityRatio, zeroFt);
        double tanLaunchAngle  = Math.tan(launchAngleRad);

        int expectedPoints = (int)(maxRangeYd / stepYd) + 2;
        List<TrajectoryPoint> points = new ArrayList<>(expectedPoints);
        double maxOrdinateIn = 0, maxOrdinateRangeYd = 0, supersonicLimitYd = maxRangeYd;

        double x  = 0, y  = 0;
        double vx = mvFps * Math.cos(launchAngleRad);
        double vy = mvFps * Math.sin(launchAngleRad);

        double dt            = 0.0005;
        double t             = 0;
        double nextSampleYd  = 0;
        boolean supersonicLogged = false;

        // Reused across all RK4 steps — eliminates ~8k short-lived array allocations per trajectory
        double[] k1 = new double[2];
        double[] k2 = new double[2];
        double[] k3 = new double[2];
        double[] k4 = new double[2];

        while ((x / 3.0) <= maxRangeYd + stepYd) {

            double rangeYd  = x / 3.0;
            double velocity = Math.hypot(vx, vy);

            if (x >= (nextSampleYd * 3.0) - 0.01) {
                double dropIn      = (y - x * tanLaunchAngle) * 12.0;
                double energyFtLbs = 0.5 * (weightLbs / GRAVITY_FPS2) * velocity * velocity;
                double windDriftIn = windDriftIn(windMph, mvFps, rangeYd, t);

                // Convert outputs to SI
                points.add(new TrajectoryPoint(
                    r1(rangeYd  * M_PER_YARD),
                    r1(dropIn   * CM_PER_INCH),
                    r1(velocity / FPS_PER_MPS),
                    r1(energyFtLbs * J_PER_FTLB),
                    r1(windDriftIn * CM_PER_INCH),
                    Math.round(t * 10000.0) / 10000.0
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

            derivatives(vx, vy, velocity, bc, airDensityRatio, k1);
            double vx2 = vx + 0.5*dt*k1[0], vy2 = vy + 0.5*dt*k1[1];
            derivatives(vx2, vy2, Math.hypot(vx2, vy2), bc, airDensityRatio, k2);
            double vx3 = vx + 0.5*dt*k2[0], vy3 = vy + 0.5*dt*k2[1];
            derivatives(vx3, vy3, Math.hypot(vx3, vy3), bc, airDensityRatio, k3);
            double vx4 = vx + dt*k3[0], vy4 = vy + dt*k3[1];
            derivatives(vx4, vy4, Math.hypot(vx4, vy4), bc, airDensityRatio, k4);

            vx += (dt / 6.0) * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0]);
            vy += (dt / 6.0) * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]);
            x  += vx * dt;
            y  += vy * dt;
            t  += dt;

            if (velocity < 100) break;
        }

        return new TrajectoryResult(
            bullet, req, points,
            r1(maxOrdinateIn      * CM_PER_INCH),
            r1(maxOrdinateRangeYd * M_PER_YARD),
            r1(supersonicLimitYd  * M_PER_YARD)
        );
    }

    // ── Drag deceleration derivatives ────────────────────────────────────────

    private void derivatives(double vx, double vy, double velocity,
                              double bc, double airDensityRatio, double[] out) {
        double dragAccel = dragDeceleration(velocity, bc, airDensityRatio);
        out[0] = -(vx / velocity) * dragAccel;
        out[1] = -(vy / velocity) * dragAccel - GRAVITY_FPS2;
    }

    private double dragDeceleration(double velocity, double bc, double airDensityRatio) {
        return interpolateG1(Math.abs(velocity)) * airDensityRatio / bc;
    }

    private double interpolateG1(double velocity) {
        if (velocity <= G1_VELOCITIES[0]) return G1_COEFFS[0];
        int last = G1_VELOCITIES.length - 1;
        if (velocity >= G1_VELOCITIES[last]) return G1_COEFFS[last];
        int i = Arrays.binarySearch(G1_VELOCITIES, velocity);
        if (i >= 0) return G1_COEFFS[i];
        i = -(i + 1); // insertion point: velocity is between [i-1] and [i]
        double v0 = G1_VELOCITIES[i-1], v1 = G1_VELOCITIES[i];
        double f0 = G1_COEFFS[i-1],     f1 = G1_COEFFS[i];
        double t  = (velocity - v0) / (v1 - v0);
        return f0 + t * (f1 - f0);
    }

    // ── Zero-angle solver (bisection) ─────────────────────────────────────────

    private double findZeroAngle(double mvFps, double bc, double airDensityRatio, double zeroFt) {
        double sightHeightFt = 1.5 / 12.0;
        double lo = -0.05, hi = 0.05;
        for (int iter = 0; iter < 64; iter++) {
            double mid = (lo + hi) / 2.0;
            if (simulateY(mvFps, bc, mid, zeroFt, airDensityRatio) < sightHeightFt) lo = mid;
            else hi = mid;
            if (Math.abs(hi - lo) < 1e-9) break;
        }
        return (lo + hi) / 2.0;
    }

    private double simulateY(double mvFps, double bc, double anglRad,
                              double targetX, double airDensityRatio) {
        double vx = mvFps * Math.cos(anglRad);
        double vy = mvFps * Math.sin(anglRad);
        double x = 0, y = 0, dt = 0.001;
        double[] d = new double[2];
        while (x < targetX) {
            double velocity = Math.hypot(vx, vy);
            if (velocity < 50) break;
            derivatives(vx, vy, velocity, bc, airDensityRatio, d);
            vx += d[0] * dt;  vy += d[1] * dt;
            x  += vx * dt;    y  += vy * dt;
        }
        return y;
    }

    // ── Wind drift (Pejsa approximation) ─────────────────────────────────────

    private double windDriftIn(double windMph, double mvFps, double rangeYd, double tof) {
        if (windMph == 0) return 0;
        double windFps   = windMph * 1.46667;
        double noWindTof = (rangeYd * 3.0) / mvFps;
        return windFps * (tof - noWindTof) * 12.0;
    }

    // ── Atmosphere model (imperial — altFt, tempF) ───────────────────────────

    private double airDensityRatio(double altFt, double tempF) {
        double standardTempAtAlt = 59.0 - 3.5 * (altFt / 1000.0);
        double tempRatio  = (459.67 + standardTempAtAlt) / (459.67 + tempF);
        double pressRatio = Math.pow(1.0 - 6.87559e-6 * altFt, 5.2560);
        return pressRatio * tempRatio;
    }

    // ── Rounding helper ───────────────────────────────────────────────────────

    private static double r1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
