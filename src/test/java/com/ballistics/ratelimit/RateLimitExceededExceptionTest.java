package com.ballistics.ratelimit;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link RateLimitExceededException} covering all getters.
 */
class RateLimitExceededExceptionTest {

    @Test
    void tierAndRetryAfterGettersReturnConstructorValues() {
        RateLimitExceededException ex = new RateLimitExceededException(RateLimitTier.SINGLE, 42L);
        assertThat(ex.tier()).isEqualTo(RateLimitTier.SINGLE);
        assertThat(ex.retryAfterSeconds()).isEqualTo(42L);
        assertThat(ex.getMessage()).contains("SINGLE").contains("42");
    }

    @Test
    void compareTierEnumValues() {
        RateLimitExceededException compare = new RateLimitExceededException(RateLimitTier.COMPARE, 5L);
        assertThat(compare.tier()).isEqualTo(RateLimitTier.COMPARE);

        RateLimitExceededException batch = new RateLimitExceededException(RateLimitTier.BATCH, 10L);
        assertThat(batch.tier()).isEqualTo(RateLimitTier.BATCH);
    }
}
