package com.ballistics.service;

import com.ballistics.model.*;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

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

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(BallisticsEngine.class);

    private final MeterRegistry meterRegistry;

    public BallisticsEngine(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    // ── Physical constants (imperial — internal physics only) ─────────────────
    private static final double GRAVITY_FPS2       = 32.174;

    /** ISA sea-level speed of sound: 340.3 m/s ≈ 1125 ft/s at 15 °C. */
    private static final double SPEED_OF_SOUND_FPS = 1125.0;

    /**
     * RK4 time step in seconds (0.5 ms).
     * At dt=0.0005 s, accumulated energy error stays below 0.01 % up to 2000 m.
     * Halving the step quadruples compute time with negligible accuracy gain for
     * the G1 drag model, which itself is only accurate to ~1–2 %.
     */
    private static final double DT_SECONDS     = 0.0005;

    /** 7000 grains per avoirdupois pound — converts grain-weight to lbs for kinetic-energy calc. */
    private static final double GRAINS_PER_POUND = 7000.0;

    /** 1 foot = 304.8 mm (12 in × 25.4 mm/in) — converts sight height from mm to feet. */
    private static final double MM_PER_FOOT    = 304.8;

    /** 3 feet per yard — converts the internal foot-based x position to yards for output. */
    private static final double FT_PER_YARD    = 3.0;

    /** Below this speed (fps) the G1 drag model diverges; integration is stopped early. */
    private static final double MIN_VELOCITY_FPS = 100.0;

    /** 1 mph = 5280/3600 ft/s ≈ 1.46667 ft/s — converts wind speed for drift calculation. */
    private static final double MPH_TO_FPS     = 1.46667;

    // ── SI → imperial conversion factors ─────────────────────────────────────
    private static final double FPS_PER_MPS      = 3.28084;
    private static final double FT_PER_METER     = 3.28084;
    private static final double M_PER_YARD       = 0.9144;
    private static final double CM_PER_INCH      = 2.54;
    private static final double J_PER_FTLB       = 1.35582;
    private static final double GRAINS_PER_GRAM  = 15.4324;
    private static final double MPH_PER_KPH      = 0.621371;

    // ── G1 / G7 drag tables & atmosphere constants ────────────────────────────
    // Loaded once at class-init from /physics-tables.yaml on the classpath so
    // the Java engine and the JS client (via virtual:physics-tables) share a
    // single source of truth.  Stored in static-final fields to preserve
    // hot-path performance (no per-request YAML parsing).
    private static final double[] G1_VELOCITIES;
    private static final double[] G1_COEFFS;
    private static final double[] G7_VELOCITIES;
    private static final double[] G7_COEFFS;
    private static final double ATM_STD_TEMP_F;
    private static final double ATM_LAPSE_RATE_PER_1000FT;
    private static final double ATM_RANKINE_OFFSET;
    private static final double ATM_PRESSURE_COEFF;
    private static final double ATM_PRESSURE_EXP;

    static {
        try (InputStream in = BallisticsEngine.class.getResourceAsStream("/physics-tables.yaml")) {
            if (in == null) {
                throw new IllegalStateException("physics-tables.yaml not found on classpath");
            }
            Map<String, Object> root = new Yaml().load(in);

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> g1 = (List<Map<String, Object>>) root.get("g1Table");
            int n1 = g1.size();
            double[] g1v = new double[n1], g1f = new double[n1];
            for (int i = 0; i < n1; i++) {
                g1v[i] = ((Number) g1.get(i).get("v")).doubleValue();
                g1f[i] = ((Number) g1.get(i).get("f")).doubleValue();
            }
            G1_VELOCITIES = g1v;
            G1_COEFFS     = g1f;

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> g7 = (List<Map<String, Object>>) root.get("g7Table");
            int n7 = g7.size();
            double[] g7v = new double[n7], g7f = new double[n7];
            for (int i = 0; i < n7; i++) {
                g7v[i] = ((Number) g7.get(i).get("v")).doubleValue();
                g7f[i] = ((Number) g7.get(i).get("f")).doubleValue();
            }
            G7_VELOCITIES = g7v;
            G7_COEFFS     = g7f;

            @SuppressWarnings("unchecked")
            Map<String, Object> atm = (Map<String, Object>) root.get("atmosphere");
            ATM_STD_TEMP_F             = ((Number) atm.get("stdTempF")).doubleValue();
            ATM_LAPSE_RATE_PER_1000FT  = ((Number) atm.get("lapseRatePer1000Ft")).doubleValue();
            ATM_RANKINE_OFFSET         = ((Number) atm.get("rankineOffset")).doubleValue();
            ATM_PRESSURE_COEFF         = ((Number) atm.get("pressureCoeff")).doubleValue();
            ATM_PRESSURE_EXP           = ((Number) atm.get("pressureExp")).doubleValue();
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Computes a full trajectory for the given bullet and simulation parameters.
     *
     * <p>Accepts SI inputs and returns SI outputs. All internal physics runs in
     * imperial units (ft/s, feet, lbs, grains) to preserve G1 drag-table calibration;
     * unit conversions are applied at the boundary of this method.</p>
     *
     * <p>Results are cached by the full set of request parameters. Identical calls
     * return the cached result without re-running the integrator.</p>
     *
     * @param bullet the projectile definition — mass in grams, muzzle velocity in m/s,
     *               dimensionless G1 ballistic coefficient, diameter in mm
     * @param req    simulation parameters: zero and max range in metres, step interval
     *               in metres, crosswind in km/h, altitude in metres, temperature in °C,
     *               sight height in mm
     * @return {@link TrajectoryResult} containing one {@link TrajectoryPoint} per step
     *         (drop in cm, velocity in m/s, energy in J, wind drift in cm, time of flight
     *         in seconds), peak ordinate in cm, and supersonic limit in metres
     */
    @Cacheable(
        value = "trajectories",
        key = "{ #req.bulletId(), #req.zeroRangeMeters(), #req.maxRangeMeters()," +
              " #req.stepMeters(), #req.windSpeedKph(), #req.altitudeMeters()," +
              " #req.temperatureC(), #req.sightHeightMm(), #req.shootingAngleDegrees()," +
              " #req.windDirectionDeg(), #req.dragModel() }"
    )
    public TrajectoryResult compute(Bullet bullet, TrajectoryRequest req) {
        long start = System.nanoTime();

        // ── Convert SI inputs to imperial for internal physics ────────────────
        double mvFps      = bullet.muzzleVelocityMps() * FPS_PER_MPS;
        double weightLbs  = (bullet.bulletWeightGrams() * GRAINS_PER_GRAM) / GRAINS_PER_POUND;
        double bc         = bullet.ballisticCoefficient();
        // Decompose wind into crosswind and headwind/tailwind components.
        // Meteorological convention: windDirectionDeg is where the wind comes FROM.
        // Shooter faces North (0°). sin() extracts the east-west (crosswind) component;
        // cos() extracts the north-south (headwind) component (positive = headwind).
        // Default 90° → full right crosswind, preserving legacy behavior.
        double windMph       = req.windSpeedKph() * MPH_PER_KPH;
        double windDirRad    = Math.toRadians(req.windDirectionDeg());
        double crosswindMph  = windMph * Math.sin(windDirRad);  // +ve = from right, -ve = from left
        double altFt      = req.altitudeMeters()  * FT_PER_METER;
        double tempF      = req.temperatureC()    * 9.0 / 5.0 + 32.0;
        // Rifleman's rule: for inclined fire, effective horizontal distance = slant × cos(θ)
        double cosAngle   = Math.cos(Math.toRadians(req.shootingAngleDegrees()));
        double zeroFt     = req.zeroRangeMeters() * FT_PER_METER * cosAngle;
        double maxRangeYd = req.maxRangeMeters()  / M_PER_YARD;
        double stepYd     = req.stepMeters()      / M_PER_YARD;

        // Select drag table based on the requested model (G1 or G7)
        final double[] dragVelocities = "G7".equals(req.dragModel()) ? G7_VELOCITIES : G1_VELOCITIES;
        final double[] dragCoeffs     = "G7".equals(req.dragModel()) ? G7_COEFFS     : G1_COEFFS;

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

        // Reused across all RK4 steps — eliminates ~8k short-lived array allocations per trajectory
        double[] k1 = new double[2];
        double[] k2 = new double[2];
        double[] k3 = new double[2];
        double[] k4 = new double[2];

        while ((x / FT_PER_YARD) <= maxRangeYd + stepYd) {

            double rangeYd  = x / FT_PER_YARD;
            double velocity = Math.hypot(vx, vy);

            if (x >= (nextSampleYd * FT_PER_YARD) - 0.01) {
                // Rifleman's rule: apparent drop on inclined shot = flat drop × cos(θ)
                double dropIn      = (y - x * tanLaunchAngle) * 12.0 * cosAngle;
                double energyFtLbs = 0.5 * (weightLbs / GRAVITY_FPS2) * velocity * velocity;
                double windDriftIn = windDriftIn(crosswindMph, mvFps, rangeYd, t, launchAngleRad);

                // Convert outputs to SI
                double rangeSI    = r1(rangeYd  * M_PER_YARD);
                double dropCmSI   = r1(dropIn   * CM_PER_INCH);
                double velocitySI = r1(velocity / FPS_PER_MPS);
                double energySI   = r1(energyFtLbs * J_PER_FTLB);
                double driftSI    = r1(windDriftIn * CM_PER_INCH);
                double tof        = Math.round(t * 10000.0) / 10000.0;

                // Scope-adjustment angles: positive = click up (bullet below LoS), negative = click down
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

    /**
     * Returns the magnitude of drag deceleration at the given speed using the
     * supplied drag table (G1 or G7).
     *
     * <p>Scales the drag form factor (interpolated from the selected table) by the
     * air density ratio and divides by the ballistic coefficient, yielding a retarding
     * acceleration in ft/s².</p>
     *
     * @param velocity        bullet speed in ft/s (must be positive)
     * @param bc              ballistic coefficient (dimensionless; higher = less drag)
     * @param airDensityRatio air density relative to ISA sea-level standard (dimensionless)
     * @param velocities      drag-table velocity breakpoints in fps
     * @param coeffs          drag-table form factors corresponding to {@code velocities}
     * @return drag deceleration magnitude in ft/s²
     */
    private double dragDeceleration(double velocity, double bc, double airDensityRatio,
                                     double[] velocities, double[] coeffs) {
        return interpolateTable(Math.abs(velocity), velocities, coeffs) * airDensityRatio / bc;
    }

    /** Linearly interpolates a drag form factor from the supplied velocity/coefficient table. */
    private double interpolateTable(double velocity, double[] velocities, double[] coeffs) {
        if (velocity <= velocities[0]) return coeffs[0];
        int last = velocities.length - 1;
        if (velocity >= velocities[last]) return coeffs[last];
        int i = Arrays.binarySearch(velocities, velocity);
        if (i >= 0) return coeffs[i];
        i = -(i + 1); // insertion point: velocity is between [i-1] and [i]
        double v0 = velocities[i-1], v1 = velocities[i];
        double f0 = coeffs[i-1],     f1 = coeffs[i];
        double t  = (velocity - v0) / (v1 - v0);
        return f0 + t * (f1 - f0);
    }

    // ── Zero-angle solver (bisection) — uses RK4 to match main trajectory ─────

    /**
     * Solves for the launch angle (radians) that places the bullet exactly at sight
     * height above bore at {@code zeroFt} using the specified drag table.
     *
     * <p>Bisects the interval [−0.05, +0.05] rad (≈ ±2.9°), which covers all
     * practical zero distances. Each midpoint is evaluated with {@link #simulateY}.
     * 64 iterations reduce the interval to below 10⁻¹⁹ rad — beyond double-precision
     * limits; the loop exits early once the interval is narrower than 10⁻⁹ rad.</p>
     *
     * @param mvFps           muzzle velocity in ft/s
     * @param bc              ballistic coefficient (dimensionless)
     * @param airDensityRatio air density relative to ISA sea-level standard
     * @param zeroFt          zero distance in feet
     * @param sightHeightFt   height of the sight line above bore centreline in feet
     * @param dragVelocities  drag-table velocity breakpoints
     * @param dragCoeffs      drag-table form factors
     * @return launch angle in radians (positive = upward)
     */
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

    /**
     * Simulates vertical bullet position at {@code targetX} using the same RK4
     * integrator as {@link #compute}, ensuring zero-angle accuracy matches trajectory
     * accuracy.
     *
     * <p>Integration stops early if speed falls below 50 ft/s, which prevents an
     * infinite loop on extremely low-velocity inputs that can never reach
     * {@code targetX}.</p>
     *
     * @param mvFps           muzzle velocity in ft/s
     * @param bc              ballistic coefficient (dimensionless)
     * @param anglRad         launch angle in radians
     * @param targetX         horizontal distance to evaluate at, in feet
     * @param airDensityRatio air density ratio (dimensionless)
     * @param dragVelocities  drag-table velocity breakpoints
     * @param dragCoeffs      drag-table form factors
     * @return vertical position in feet at {@code targetX} (positive = above bore line)
     */
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

    /**
     * Computes lateral wind drift in inches using the Pejsa approximation.
     *
     * <p>Drift = windSpeed × (actual TOF − vacuum TOF). The vacuum TOF uses the
     * initial <em>horizontal</em> velocity component (mvFps × cos(launchAngle))
     * rather than mvFps alone, eliminating a systematic under-estimate of drift
     * that grows with range and launch angle.</p>
     *
     * @param windMph        crosswind speed in mph (positive = right-to-left)
     * @param mvFps          muzzle velocity in ft/s
     * @param rangeYd        current range in yards
     * @param tof            actual time of flight to {@code rangeYd} in seconds
     * @param launchAngleRad launch angle in radians
     * @return lateral wind drift in inches (positive = downwind)
     */
    private double windDriftIn(double windMph, double mvFps, double rangeYd,
                                double tof, double launchAngleRad) {
        if (windMph == 0) return 0;
        double windFps      = windMph * MPH_TO_FPS;
        double vacuumTof    = (rangeYd * FT_PER_YARD) / (mvFps * Math.cos(launchAngleRad));
        return windFps * (tof - vacuumTof) * 12.0;
    }

    // ── Atmosphere model (imperial — altFt, tempF) ────────────────────────────

    /**
     * Returns the air density ratio ρ/ρ₀ for the given altitude and temperature,
     * relative to ISA sea-level standard density.
     *
     * <p>Uses the ICAO standard atmosphere: a linear temperature lapse rate up to
     * the tropopause and a power-law pressure profile. Coefficients are loaded from
     * {@code physics-tables.yaml} so the Java engine and JS client share identical
     * values.</p>
     *
     * @param altFt altitude above sea level in feet
     * @param tempF ambient temperature in °F
     * @return dimensionless air density ratio (1.0 at ISA sea level; decreases with
     *         altitude or increased temperature)
     */
    private double airDensityRatio(double altFt, double tempF) {
        double standardTempAtAlt = ATM_STD_TEMP_F - ATM_LAPSE_RATE_PER_1000FT * (altFt / 1000.0);
        double tempRatio  = (ATM_RANKINE_OFFSET + standardTempAtAlt) / (ATM_RANKINE_OFFSET + tempF);
        double pressRatio = Math.pow(1.0 - ATM_PRESSURE_COEFF * altFt, ATM_PRESSURE_EXP);
        return pressRatio * tempRatio;
    }

    // ── Rounding helper ───────────────────────────────────────────────────────

    private static double r1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
