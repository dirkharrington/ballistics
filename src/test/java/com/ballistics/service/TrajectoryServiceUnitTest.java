package com.ballistics.service;

import com.ballistics.model.*;
import com.ballistics.physics.PhysicsTablesLoader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for {@link TrajectoryService} that cover branches not reachable
 * via the HTTP controller tests (e.g. null IDs in compare, joinUnwrapped with
 * checked exceptions, blank bulletId).
 */
class TrajectoryServiceUnitTest {

    private TrajectoryService service;
    private ExecutorService executor;

    private static final Bullet BULLET_308 = new Bullet(
        "308-win-168gr", "308 Win 168gr", "Rifle",
        10.9, 820.0, 0.505, 7.82,
        0.5 * 0.0109 * 820.0 * 820.0,
        "Test bullet", "#ffffff"
    );

    @BeforeEach
    void setUp() {
        var tables = PhysicsTablesLoader.load(new ClassPathResource("physics-tables.yaml"));
        var meterRegistry = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        var engine = new BallisticsEngine(tables, meterRegistry);

        Map<String, Bullet> catalog = new LinkedHashMap<>();
        catalog.put("308-win-168gr", BULLET_308);

        executor = Executors.newSingleThreadExecutor();
        service = new TrajectoryService(engine, catalog, executor);
    }

    // ── resolveBullet — blank id ──────────────────────────────────────────────

    @Test
    void computeWithBlankBulletIdThrows() {
        // bulletId.isBlank() true: exercises the isBlank() true branch in resolveBullet
        TrajectoryRequest req = new TrajectoryRequest(
            "  ", 100, 500, 25, 0, 0, 15, null, null, null, null, null);
        assertThatThrownBy(() -> service.compute("  ", req))
            .isInstanceOf(UnknownBulletException.class);
    }

    @Test
    void computeWithNullBulletIdThrows() {
        // null: exercises the bulletId == null true branch (short-circuits before isBlank)
        TrajectoryRequest req = new TrajectoryRequest(
            null, 100, 500, 25, 0, 0, 15, null, null, null, null, null);
        assertThatThrownBy(() -> service.compute(null, req))
            .isInstanceOf(UnknownBulletException.class);
    }

    // ── compareAsync — null id in list ───────────────────────────────────────

    @Test
    void compareAsyncSkipsNullBulletIds() {
        // null id in bulletIds list: exercises `id != null` false branch → skip
        // Use a list that contains null alongside valid and duplicate ids
        // CompareRequest record: (bulletIds, zeroRange, maxRange, step, windSpeed, altitude, tempC)
        // To construct with a null element we need a mutable list
        java.util.List<String> ids = new java.util.ArrayList<>();
        ids.add("308-win-168gr");
        ids.add(null);
        ids.add("308-win-168gr");
        CompareRequest req = new CompareRequest(ids, 100, 200, 100, 0, 0, 15, null, null, null, null, null);
        // Should NOT throw; the null is silently skipped; duplicate uses same future
        List<CompletableFuture<TrajectoryResult>> futures = service.compareAsync(req);
        // 2 entries (both are "308-win-168gr", the null is dropped from output)
        assertThat(futures).hasSize(2);
    }

    // ── joinUnwrapped — normal compare ───────────────────────────────────────

    @Test
    void compareReturnsSingleResult() {
        CompareRequest req = new CompareRequest(
            List.of("308-win-168gr"), 100, 200, 100, 0, 0, 15, null, null, null, null, null);
        List<TrajectoryResult> results = service.compare(req);
        assertThat(results).hasSize(1);
        assertThat(results.get(0).bullet().id()).isEqualTo("308-win-168gr");
    }

    // ── joinUnwrapped — RuntimeException cause rethrown directly ─────────────

    @Test
    void joinUnwrappedRuntimeExceptionIsRethrownDirectly() throws Exception {
        Method m = TrajectoryService.class.getDeclaredMethod("joinUnwrapped", CompletableFuture.class);
        m.setAccessible(true);

        // Wrap a RuntimeException in CompletionException — exercises the `throw re` branch
        // (cause instanceof RuntimeException re is TRUE → re is rethrown directly)
        RuntimeException cause = new RuntimeException("direct runtime");
        CompletableFuture<Object> future = new CompletableFuture<>();
        future.completeExceptionally(new CompletionException(cause));

        assertThatThrownBy(() -> m.invoke(service, future))
            .cause()  // invoke() wraps in InvocationTargetException
            .isSameAs(cause);
    }

    // ── joinUnwrapped — checked exception wrapped in RuntimeException ─────────

    @Test
    void joinUnwrappedCheckedExceptionIsWrappedInRuntimeException() throws Exception {
        Method m = TrajectoryService.class.getDeclaredMethod("joinUnwrapped", CompletableFuture.class);
        m.setAccessible(true);

        // Wrap a checked exception (IOException) in CompletionException — exercises the
        // `throw new RuntimeException(cause)` branch (cause is not a RuntimeException)
        CompletableFuture<Object> future = new CompletableFuture<>();
        future.completeExceptionally(new CompletionException(new IOException("checked")));

        assertThatThrownBy(() -> m.invoke(service, future))
            .cause()  // invoke() wraps in InvocationTargetException
            .isInstanceOf(RuntimeException.class)
            .hasCauseInstanceOf(IOException.class);
    }

    // ── batch — unknown id throws before any futures ──────────────────────────

    @Test
    void batchWithUnknownIdThrowsBeforeWork() {
        // A single batch entry with unknown id: resolveBullet throws before any futures
        TrajectoryRequest req1 = new TrajectoryRequest(
            "308-win-168gr", 100, 500, 25, 0, 0, 15, null, null, null, null, null);
        TrajectoryRequest req2 = new TrajectoryRequest(
            "unknown-id", 100, 500, 25, 0, 0, 15, null, null, null, null, null);
        BatchRequest batch = new BatchRequest(List.of(req1, req2));
        assertThatThrownBy(() -> service.batch(batch))
            .isInstanceOf(UnknownBulletException.class);
    }
}
