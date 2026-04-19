package com.ballistics.benchmark;

import com.ballistics.model.Bullet;
import com.ballistics.model.TrajectoryRequest;
import com.ballistics.model.TrajectoryResult;
import com.ballistics.service.BallisticsEngine;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.openjdk.jmh.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * JMH microbenchmarks for BallisticsEngine.
 *
 * Run all benchmarks:
 *   mvn test-compile integration-test -Pbenchmark
 *
 * Quick smoke run (no fork, fewer iterations):
 *   mvn test-compile integration-test -Pbenchmark \
 *       -Dexec.args=".*Benchmark -f 0 -wi 1 -i 3"
 */
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@State(Scope.Benchmark)
@Warmup(iterations = 3, time = 1)
@Measurement(iterations = 5, time = 1)
@Fork(1)
public class BallisticsEngineBenchmark {

    // ── Parameters ────────────────────────────────────────────────────────────

    /** Each combination of bullet × range produces its own benchmark row. */
    @Param({"223-rem-55gr", "308-win-168gr", "3006-150gr", "65-creedmoor-140gr"})
    private String bulletId;

    @Param({"500", "1000"})
    private int maxRangeMeters;

    // ── Fixtures ──────────────────────────────────────────────────────────────

    private BallisticsEngine engine;
    private Map<String, Bullet> catalog;

    @Setup(Level.Trial)
    public void setup() {
        engine  = new BallisticsEngine(new SimpleMeterRegistry());
        catalog = Bullet.knownRifleBullets().stream()
            .collect(Collectors.toMap(Bullet::id, Function.identity()));
    }

    // ── Benchmarks ────────────────────────────────────────────────────────────

    /** Baseline: calm air at sea level — exercises RK4 loop and zero-angle solver. */
    @Benchmark
    public TrajectoryResult standardConditions() {
        return engine.compute(
            catalog.get(bulletId),
            new TrajectoryRequest(bulletId, 100, maxRangeMeters, 25, 0, 0, 15)
        );
    }

    /** Adds wind drift and altitude corrections on top of the baseline. */
    @Benchmark
    public TrajectoryResult withWindAndAltitude() {
        return engine.compute(
            catalog.get(bulletId),
            new TrajectoryRequest(bulletId, 100, maxRangeMeters, 25, 16, 1524, 10)
        );
    }

    /** Simulates the /api/trajectories/compare endpoint: all four bullets in one call. */
    @Benchmark
    public List<TrajectoryResult> compareAllBullets() {
        return Bullet.knownRifleBullets().stream()
            .map(b -> engine.compute(
                b,
                new TrajectoryRequest(b.id(), 100, maxRangeMeters, 25, 16, 0, 15)
            ))
            .toList();
    }
}
