package com.ballistics.ratelimit;

import com.ballistics.config.RateLimitProperties;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.BandwidthBuilder;
import io.github.bucket4j.Bucket;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Per-client + global rate limiter backed by Bucket4j and Caffeine.
 *
 * <p>Algorithm:
 * <ol>
 *   <li>Check per-client bucket; reject with CLIENT scope if drained.</li>
 *   <li>Check global bucket; if drained, refund the per-client token and reject with GLOBAL scope.</li>
 *   <li>Allowed if both consumed.</li>
 * </ol>
 */
@Component
public class ClientRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(ClientRateLimiter.class);

    private final RateLimitProperties props;
    private final MeterRegistry meterRegistry;

    /** Per-client buckets: one ClientBuckets entry per known key. */
    private final Cache<String, ClientBuckets> clientCache;

    /** One global bucket per tier (shared across all clients). */
    private final Bucket[] globalBuckets = new Bucket[RateLimitTier.values().length];

    public ClientRateLimiter(RateLimitProperties props, MeterRegistry meterRegistry) {
        this.props         = props;
        this.meterRegistry = meterRegistry;
        this.clientCache   = Caffeine.newBuilder()
            .maximumSize(props.clientCache().maxSize())
            .expireAfterAccess(props.clientCache().expireAfterAccess())
            .build();
    }

    @PostConstruct
    void init() {
        // Initialise global buckets after construction
        for (RateLimitTier tier : RateLimitTier.values()) {
            RateLimitProperties.Tier cfg = props.tier(tier);
            globalBuckets[tier.ordinal()] = buildBucket(cfg.globalCapacity(), props.period());
        }
        // Gauge: expose the estimated client-cache size
        meterRegistry.gauge("ballistics.ratelimit.clients", clientCache,
            c -> (double) c.estimatedSize());
        if (!props.enabled()) {
            log.warn("Rate limiting is DISABLED (app.ratelimit.enabled=false)");
        }
    }

    /**
     * Attempts to consume one token from both per-client and global buckets.
     *
     * @return {@link Decision} indicating whether the request is allowed and, if not,
     *         which scope rejected it and how long to wait
     */
    public Decision tryConsume(RateLimitTier tier, String clientKey) {
        if (!props.enabled()) {
            return new Decision(true, null, 0);
        }

        ClientBuckets buckets = clientCache.get(clientKey, k -> new ClientBuckets(props));
        Bucket clientBucket = buckets.of(tier);

        var clientProbe = clientBucket.tryConsumeAndReturnRemaining(1);
        if (!clientProbe.isConsumed()) {
            long retryAfter = ceilSeconds(clientProbe.getNanosToWaitForRefill());
            log.debug("Rate limit rejected: tier={} scope=CLIENT key={}", tier, clientKey);
            meterRegistry.counter("ballistics.ratelimit.rejected",
                "tier", tier.name().toLowerCase(), "scope", "client").increment();
            return new Decision(false, Scope.CLIENT, retryAfter);
        }

        var globalProbe = globalBuckets[tier.ordinal()].tryConsumeAndReturnRemaining(1);
        if (!globalProbe.isConsumed()) {
            // Refund per-client token
            clientBucket.addTokens(1);
            long retryAfter = ceilSeconds(globalProbe.getNanosToWaitForRefill());
            log.debug("Rate limit rejected: tier={} scope=GLOBAL key={}", tier, clientKey);
            meterRegistry.counter("ballistics.ratelimit.rejected",
                "tier", tier.name().toLowerCase(), "scope", "global").increment();
            return new Decision(false, Scope.GLOBAL, retryAfter);
        }

        return new Decision(true, null, 0);
    }

    // ── inner types ────────────────────────────────────────────────────────────

    public record Decision(boolean allowed, Scope rejectedBy, long retryAfterSeconds) {}

    public enum Scope { CLIENT, GLOBAL }

    /** Holds one bucket per tier for a single client key. Created once under Caffeine's map lock. */
    private static final class ClientBuckets {
        private final Bucket[] buckets = new Bucket[RateLimitTier.values().length];

        ClientBuckets(RateLimitProperties props) {
            for (RateLimitTier tier : RateLimitTier.values()) {
                RateLimitProperties.Tier cfg = props.tier(tier);
                buckets[tier.ordinal()] = buildBucket(cfg.capacity(), props.period());
            }
        }

        Bucket of(RateLimitTier tier) { return buckets[tier.ordinal()]; }
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    private static Bucket buildBucket(long capacity, Duration period) {
        return Bucket.builder()
            .addLimit(BandwidthBuilder.builder()
                .capacity(capacity)
                .refillGreedy(capacity, period)
                .build())
            .build();
    }

    static long ceilSeconds(long nanos) {
        return Math.max(1L, (long) Math.ceil(nanos / 1_000_000_000.0));
    }
}
