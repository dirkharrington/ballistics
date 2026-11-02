package com.ballistics.benchmark;

import com.ballistics.BulletCatalog;
import com.ballistics.model.Bullet;
import com.ballistics.model.TrajectoryRequest;
import com.ballistics.model.TrajectoryResult;
import com.ballistics.physics.PhysicsTables;
import com.ballistics.physics.PhysicsTablesLoader;
import com.ballistics.service.BallisticsEngine;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.openjdk.jmh.annotations.*;
import org.springframework.core.io.ClassPathResource;

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
 */
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@State(Scope.Benchmark)
@Warmup(iterations = 3, time = 1)
@Measurement(iterations = 5, time = 1)
@Fork(1)
public class BallisticsEngineBenchmark {

    @Param({"223-rem-55gr", "308-win-168gr", "3006-150gr", "65-creedmoor-140gr"})
    private String bulletId;

    @Param({"500", "1000"})
    private int maxRangeMeters;

    private BallisticsEngine engine;
    private Map<String, Bullet> catalog;

    @Setup(Level.Trial)
    public void setup() {
        PhysicsTables tables = PhysicsTablesLoader.load(new ClassPathResource("physics-tables.yaml"));
        engine  = new BallisticsEngine(tables, new SimpleMeterRegistry());
        catalog = BulletCatalog.load().stream()
            .collect(Collectors.toMap(Bullet::id, Function.identity()));
    }

    @Benchmark
    public TrajectoryResult standardConditions() {
        return engine.compute(
            catalog.get(bulletId),
            new TrajectoryRequest(bulletId, 100, maxRangeMeters, 25, 0, 0, 15, null, null, null, null)
        );
    }

    @Benchmark
    public TrajectoryResult withWindAndAltitude() {
        return engine.compute(
            catalog.get(bulletId),
            new TrajectoryRequest(bulletId, 100, maxRangeMeters, 25, 16, 1524, 10, null, null, null, null)
        );
    }

    @Benchmark
    public List<TrajectoryResult> compareAllBullets() {
        return BulletCatalog.load().stream()
            .map(b -> engine.compute(
                b,
                new TrajectoryRequest(b.id(), 100, maxRangeMeters, 25, 16, 0, 15, null, null, null, null)
            ))
            .toList();
    }
}
