package com.ballistics.ratelimit;

/** Identifies the rate-limit tier applied to an endpoint. */
public enum RateLimitTier {
    SINGLE,
    COMPARE,
    BATCH
}
