package com.ballistics.config;

import com.ballistics.ratelimit.RateLimitTier;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for RateLimitProperties binding and cross-field validation.
 */
class RateLimitPropertiesTest {

    // ── Default values ─────────────────────────────────────────────────────────

    @Test
    void defaultValuesBindCorrectly() {
        RateLimitProperties props = bind(Map.of(
            "app.ratelimit.single.capacity",        "120",
            "app.ratelimit.single.global-capacity", "1200",
            "app.ratelimit.compare.capacity",       "30",
            "app.ratelimit.compare.global-capacity","300",
            "app.ratelimit.batch.capacity",         "10",
            "app.ratelimit.batch.global-capacity",  "100"
        ));

        assertThat(props.enabled()).isTrue();
        assertThat(props.period()).isEqualTo(Duration.ofMinutes(1));
        assertThat(props.single().capacity()).isEqualTo(120);
        assertThat(props.single().globalCapacity()).isEqualTo(1200);
        assertThat(props.compare().capacity()).isEqualTo(30);
        assertThat(props.batch().capacity()).isEqualTo(10);
        assertThat(props.clientCache().maxSize()).isEqualTo(10000);
        assertThat(props.clientCache().expireAfterAccess()).isEqualTo(Duration.ofMinutes(2));
        assertThat(props.ipv6PrefixLength()).isEqualTo(64);
    }

    @Test
    void envOverrideChangesValues() {
        RateLimitProperties props = bind(Map.of(
            "app.ratelimit.enabled",                "false",
            "app.ratelimit.period",                 "30s",
            "app.ratelimit.single.capacity",        "5",
            "app.ratelimit.single.global-capacity", "50",
            "app.ratelimit.compare.capacity",       "2",
            "app.ratelimit.compare.global-capacity","20",
            "app.ratelimit.batch.capacity",         "1",
            "app.ratelimit.batch.global-capacity",  "10",
            "app.ratelimit.client-cache.expire-after-access", "30s"
        ));

        assertThat(props.enabled()).isFalse();
        assertThat(props.period()).isEqualTo(Duration.ofSeconds(30));
        assertThat(props.single().capacity()).isEqualTo(5);
    }

    @Test
    void tierMethodMapsCorrectly() {
        RateLimitProperties props = bind(Map.of(
            "app.ratelimit.single.capacity",        "120",
            "app.ratelimit.single.global-capacity", "1200",
            "app.ratelimit.compare.capacity",       "30",
            "app.ratelimit.compare.global-capacity","300",
            "app.ratelimit.batch.capacity",         "10",
            "app.ratelimit.batch.global-capacity",  "100"
        ));

        assertThat(props.tier(RateLimitTier.SINGLE).capacity()).isEqualTo(120);
        assertThat(props.tier(RateLimitTier.COMPARE).capacity()).isEqualTo(30);
        assertThat(props.tier(RateLimitTier.BATCH).capacity()).isEqualTo(10);
    }

    // ── Failure cases ──────────────────────────────────────────────────────────

    @Test
    void capacityLessThan1Fails() {
        assertThatThrownBy(() -> bind(Map.of(
            "app.ratelimit.single.capacity",        "0",
            "app.ratelimit.single.global-capacity", "0",
            "app.ratelimit.compare.capacity",       "30",
            "app.ratelimit.compare.global-capacity","300",
            "app.ratelimit.batch.capacity",         "10",
            "app.ratelimit.batch.global-capacity",  "100"
        ))).isInstanceOf(Exception.class);
    }

    @Test
    void globalCapacityLessThanCapacityFails() {
        assertThatThrownBy(() -> new RateLimitProperties.Tier(10, 5))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("global-capacity must be >= capacity");
    }

    @Test
    void globalCapacityLessThan1Fails() {
        // capacity=5 passes the first check; globalCapacity=0 exercises the globalCapacity < 1 branch
        assertThatThrownBy(() -> new RateLimitProperties.Tier(5, 0))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("global-capacity must be >= 1");
    }

    @Test
    void expireAfterAccessLessThanPeriodFails() {
        assertThatThrownBy(() -> new RateLimitProperties(
            true,
            Duration.ofMinutes(2),
            new RateLimitProperties.Tier(120, 1200),
            new RateLimitProperties.Tier(30, 300),
            new RateLimitProperties.Tier(10, 100),
            new RateLimitProperties.ClientCache(10000, Duration.ofMinutes(1)), // 1m < 2m period
            64
        )).isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("expire-after-access must be >= period");
    }

    // ── Compact-constructor branch coverage ────────────────────────────────────

    @Test
    void periodLessThan1sFails() {
        // period != null && period < 1s → true branch → throws
        assertThatThrownBy(() -> new RateLimitProperties(
            true,
            Duration.ofMillis(500),
            new RateLimitProperties.Tier(120, 1200),
            new RateLimitProperties.Tier(30, 300),
            new RateLimitProperties.Tier(10, 100),
            new RateLimitProperties.ClientCache(10000, Duration.ofMinutes(1)),
            64
        )).isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("must be >= 1s");
    }

    @Test
    void nullPeriodIsAccepted() {
        // period == null → false-branch short-circuits both conditions
        assertThatNoException().isThrownBy(() -> new RateLimitProperties(
            true, null,
            new RateLimitProperties.Tier(120, 1200),
            new RateLimitProperties.Tier(30, 300),
            new RateLimitProperties.Tier(10, 100),
            new RateLimitProperties.ClientCache(10000, Duration.ofMinutes(2)),
            64
        ));
    }

    @Test
    void nullClientCacheIsAccepted() {
        // clientCache == null → false-branch short-circuits the clientCache check
        assertThatNoException().isThrownBy(() -> new RateLimitProperties(
            true, Duration.ofMinutes(1),
            new RateLimitProperties.Tier(120, 1200),
            new RateLimitProperties.Tier(30, 300),
            new RateLimitProperties.Tier(10, 100),
            null, // clientCache null
            64
        ));
    }

    // ── helper ─────────────────────────────────────────────────────────────────

    private RateLimitProperties bind(Map<String, String> properties) {
        Binder binder = new Binder(new MapConfigurationPropertySource(properties));
        return binder.bindOrCreate("app.ratelimit", RateLimitProperties.class);
    }
}
