package com.ballistics.config;

import com.ballistics.ratelimit.RateLimitTier;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * Externalized configuration for the per-client rate limiter.
 *
 * <p>Picked up by {@code @ConfigurationPropertiesScan} on {@link com.ballistics.BallisticsApplication}.</p>
 */
@Validated
@ConfigurationProperties("app.ratelimit")
public record RateLimitProperties(
    @DefaultValue("true")  boolean enabled,
    @DefaultValue("1m")    @NotNull Duration period,
    @NotNull               @Valid Tier single,
    @NotNull               @Valid Tier compare,
    @NotNull               @Valid Tier batch,
    @DefaultValue          @Valid ClientCache clientCache,
    @DefaultValue("64")    @Min(32) @Max(128) int ipv6PrefixLength
) {
    public RateLimitProperties {
        if (period != null && period.compareTo(Duration.ofSeconds(1)) < 0) {
            throw new IllegalArgumentException(
                "app.ratelimit.period must be >= 1s (got " + period + ")");
        }
        if (clientCache != null && period != null &&
                clientCache.expireAfterAccess().compareTo(period) < 0) {
            throw new IllegalArgumentException(
                "app.ratelimit.client-cache.expire-after-access must be >= period (got " +
                clientCache.expireAfterAccess() + " < " + period + ")");
        }
    }

    public record Tier(
        @Min(1) long capacity,
        @Min(1) long globalCapacity
    ) {
        public Tier {
            if (capacity < 1) {
                throw new IllegalArgumentException(
                    "app.ratelimit capacity must be >= 1 (got " + capacity + ")");
            }
            if (globalCapacity < 1) {
                throw new IllegalArgumentException(
                    "app.ratelimit global-capacity must be >= 1 (got " + globalCapacity + ")");
            }
            if (globalCapacity < capacity) {
                throw new IllegalArgumentException(
                    "app.ratelimit global-capacity must be >= capacity (got " +
                    globalCapacity + " < " + capacity + ")");
            }
        }
    }

    public record ClientCache(
        @DefaultValue("10000") @Min(100) @Max(1_000_000) long maxSize,
        @DefaultValue("2m") @NotNull Duration expireAfterAccess
    ) {}

    /** Returns the {@link Tier} for the given {@link RateLimitTier}. */
    public Tier tier(RateLimitTier t) {
        return switch (t) {
            case SINGLE  -> single;
            case COMPARE -> compare;
            case BATCH   -> batch;
        };
    }
}
