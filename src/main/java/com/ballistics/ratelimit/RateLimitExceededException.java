package com.ballistics.ratelimit;

/** Thrown by {@link RateLimitInterceptor} when a request exceeds the rate limit. */
public class RateLimitExceededException extends RuntimeException {

    private final RateLimitTier tier;
    private final long retryAfterSeconds;

    public RateLimitExceededException(RateLimitTier tier, long retryAfterSeconds) {
        super("Rate limit exceeded for tier " + tier + ". Retry after " + retryAfterSeconds + " s.");
        this.tier = tier;
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public RateLimitTier tier() { return tier; }
    public long retryAfterSeconds() { return retryAfterSeconds; }
}
