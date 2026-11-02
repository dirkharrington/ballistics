package com.ballistics.ratelimit;

import com.ballistics.config.RateLimitProperties;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ClientRateLimiter} covering branches not exercised by the
 * integration-level {@code RateLimitTest}.
 */
class ClientRateLimiterTest {

    // ── Global-bucket rejection ───────────────────────────────────────────────

    @Test
    void globalBucketExhaustedRejectsWithGlobalScope() {
        // Global capacity = 1; two different client keys drain client(A), then
        // global rejects client(B) → exercises the `!globalProbe.isConsumed()` true branch.
        // capacity=1, globalCapacity=1: global pool has only 1 token shared across all clients
        RateLimitProperties props = new RateLimitProperties(
            true,
            Duration.ofMinutes(1),
            new RateLimitProperties.Tier(1, 1),
            new RateLimitProperties.Tier(1, 1),
            new RateLimitProperties.Tier(1, 1),
            new RateLimitProperties.ClientCache(10000, Duration.ofMinutes(2)),
            64
        );
        ClientRateLimiter limiter = new ClientRateLimiter(props, new SimpleMeterRegistry());
        limiter.init();

        // First call: client-A consumes the single global token
        ClientRateLimiter.Decision first = limiter.tryConsume(RateLimitTier.SINGLE, "client-A");
        assertThat(first.allowed()).isTrue();

        // Second call: different client-B, client bucket has plenty of tokens,
        // but global bucket is empty → rejected with GLOBAL scope
        ClientRateLimiter.Decision second = limiter.tryConsume(RateLimitTier.SINGLE, "client-B");
        assertThat(second.allowed()).isFalse();
        assertThat(second.rejectedBy()).isEqualTo(ClientRateLimiter.Scope.GLOBAL);
        assertThat(second.retryAfterSeconds()).isGreaterThan(0);
    }

    // ── Disabled rate limiter ─────────────────────────────────────────────────

    @Test
    void disabledRateLimiterAlwaysAllows() {
        RateLimitProperties props = new RateLimitProperties(
            false,   // disabled
            Duration.ofMinutes(1),
            new RateLimitProperties.Tier(1, 1),
            new RateLimitProperties.Tier(1, 1),
            new RateLimitProperties.Tier(1, 1),
            new RateLimitProperties.ClientCache(10000, Duration.ofMinutes(2)),
            64
        );
        ClientRateLimiter limiter = new ClientRateLimiter(props, new SimpleMeterRegistry());
        limiter.init();

        for (int i = 0; i < 10; i++) {
            ClientRateLimiter.Decision d = limiter.tryConsume(RateLimitTier.SINGLE, "any-key");
            assertThat(d.allowed()).isTrue();
        }
    }

    // ── ceilSeconds helper ────────────────────────────────────────────────────

    @Test
    void ceilSecondsRoundsUpToAtLeast1() {
        assertThat(ClientRateLimiter.ceilSeconds(0L)).isEqualTo(1L);
        assertThat(ClientRateLimiter.ceilSeconds(1_000_000_000L)).isEqualTo(1L);
        assertThat(ClientRateLimiter.ceilSeconds(1_000_000_001L)).isEqualTo(2L);
        assertThat(ClientRateLimiter.ceilSeconds(500_000_000L)).isEqualTo(1L);
    }
}
