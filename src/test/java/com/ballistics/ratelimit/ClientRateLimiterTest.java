package com.ballistics.ratelimit;

import com.ballistics.config.RateLimitProperties;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ClientRateLimiter} covering the global-rejection path,
 * the disabled-rate-limiting path, and the {@code ceilSeconds} helper.
 */
class ClientRateLimiterTest {

    // ── Disabled rate limiting ─────────────────────────────────────────────────

    @Test
    void disabledRateLimiterAlwaysAllows() {
        ClientRateLimiter limiter = limiterWith(false, 1, 1);
        ClientRateLimiter.Decision d = limiter.tryConsume(RateLimitTier.SINGLE, "clientA");
        assertThat(d.allowed()).isTrue();
        assertThat(d.rejectedBy()).isNull();
    }

    // ── Client rejection ──────────────────────────────────────────────────────

    @Test
    void clientBucketExhaustsBeforeGlobal() {
        // capacity=1, globalCapacity=10 → first call consumes client token,
        // second call from same client gets CLIENT rejection
        ClientRateLimiter limiter = limiterWith(true, 1, 10);

        ClientRateLimiter.Decision first = limiter.tryConsume(RateLimitTier.SINGLE, "clientA");
        assertThat(first.allowed()).isTrue();

        ClientRateLimiter.Decision second = limiter.tryConsume(RateLimitTier.SINGLE, "clientA");
        assertThat(second.allowed()).isFalse();
        assertThat(second.rejectedBy()).isEqualTo(ClientRateLimiter.Scope.CLIENT);
        assertThat(second.retryAfterSeconds()).isGreaterThanOrEqualTo(1L);
    }

    // ── Global rejection ──────────────────────────────────────────────────────

    @Test
    void globalBucketExhaustionRejectsWithGlobalScope() {
        // capacity=1, globalCapacity=1 → clientA consumes the single global token;
        // clientB has its own fresh client bucket but global is depleted → GLOBAL rejection
        ClientRateLimiter limiter = limiterWith(true, 1, 1);

        ClientRateLimiter.Decision clientA = limiter.tryConsume(RateLimitTier.SINGLE, "clientA");
        assertThat(clientA.allowed()).isTrue();

        ClientRateLimiter.Decision clientB = limiter.tryConsume(RateLimitTier.SINGLE, "clientB");
        assertThat(clientB.allowed()).isFalse();
        assertThat(clientB.rejectedBy()).isEqualTo(ClientRateLimiter.Scope.GLOBAL);
        assertThat(clientB.retryAfterSeconds()).isGreaterThanOrEqualTo(1L);
    }

    // ── ceilSeconds ───────────────────────────────────────────────────────────

    @Test
    void ceilSecondsZeroNanosReturnsOne() {
        assertThat(ClientRateLimiter.ceilSeconds(0L)).isEqualTo(1L);
    }

    @Test
    void ceilSecondsExactOneSecondReturnsOne() {
        assertThat(ClientRateLimiter.ceilSeconds(1_000_000_000L)).isEqualTo(1L);
    }

    @Test
    void ceilSecondsPartialSecondRoundsUp() {
        assertThat(ClientRateLimiter.ceilSeconds(1_000_000_001L)).isEqualTo(2L);
    }

    @Test
    void ceilSecondsOneAndHalfSecondsReturnsTwo() {
        assertThat(ClientRateLimiter.ceilSeconds(1_500_000_000L)).isEqualTo(2L);
    }

    // ── helper ────────────────────────────────────────────────────────────────

    private static ClientRateLimiter limiterWith(boolean enabled, long capacity, long globalCapacity) {
        RateLimitProperties.Tier tier = new RateLimitProperties.Tier(capacity, globalCapacity);
        RateLimitProperties props = new RateLimitProperties(
            enabled,
            Duration.ofMinutes(1),
            tier, tier, tier,
            new RateLimitProperties.ClientCache(100, Duration.ofMinutes(2)),
            64
        );
        ClientRateLimiter limiter = new ClientRateLimiter(props, new SimpleMeterRegistry());
        limiter.init();
        return limiter;
    }
}
