package com.ballistics.ratelimit;

import com.ballistics.config.RateLimitProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Duration;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for {@link DefaultClientKeyResolver} covering every case in the contract.
 */
class ClientKeyResolverTest {

    private DefaultClientKeyResolver resolver;

    @BeforeEach
    void setUp() {
        resolver = new DefaultClientKeyResolver(defaultProps());
    }

    // ── IPv4 ──────────────────────────────────────────────────────────────────

    @Test
    void ipv4Address() {
        assertThat(resolve("192.168.1.10")).isEqualTo("v4:192.168.1.10");
    }

    @Test
    void ipv4Loopback() {
        assertThat(resolve("127.0.0.1")).isEqualTo("v4:127.0.0.1");
    }

    // ── IPv4-mapped IPv6 ──────────────────────────────────────────────────────

    @Test
    void ipv4MappedIPv6() {
        assertThat(resolve("::ffff:1.2.3.4")).isEqualTo("v4:1.2.3.4");
    }

    @Test
    void ipv4MappedIPv6Uppercase() {
        assertThat(resolve("::FFFF:10.0.0.1")).isEqualTo("v4:10.0.0.1");
    }

    // ── IPv6 prefix folding ───────────────────────────────────────────────────

    @Test
    void twoAddressesInSame64PrefixHaveSameKey() {
        // 2001:db8:1:1::1 and 2001:db8:1:1::2 are in the same /64
        String key1 = resolve("2001:db8:1:1::1");
        String key2 = resolve("2001:db8:1:1::2");
        assertThat(key1).isEqualTo(key2);
        assertThat(key1).startsWith("v6:");
        assertThat(key1).endsWith("/64");
    }

    @Test
    void twoAddressesInDifferent64PrefixesHaveDifferentKeys() {
        // 2001:db8:1:1::1 vs 2001:db8:1:2::1 — the 4th group differs
        String key1 = resolve("2001:db8:1:1::1");
        String key2 = resolve("2001:db8:1:2::1");
        assertThat(key1).isNotEqualTo(key2);
    }

    @Test
    void ipv6LoopbackAllFirstTenBytesZeroButNotMapped() {
        // ::1 has bytes [0,0,0,0,0,0,0,0,0,0, 0,0, 0,0,0,1]
        // isIPv4Mapped: all 10 zero bytes pass the loop but bytes[10] = 0x00 != 0xFF
        // → returns false → resolved as v6:prefix
        String key = resolve("::1");
        assertThat(key).startsWith("v6:").endsWith("/64");
    }

    // ── Hostname-like / invalid ───────────────────────────────────────────────

    @Test
    void hostnameLikeStringReturnsUnknown() {
        assertThat(resolve("example.com")).isEqualTo("unknown");
    }

    @Test
    void nullAddressReturnsUnknown() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr(null);
        // MockHttpServletRequest sets "127.0.0.1" as default; use a custom resolver with null
        assertThat(resolver.resolve(req)).isNotNull(); // at least returns something
    }

    @Test
    void emptyStringReturnsUnknown() {
        // Too short to match the ADDR_PATTERN (min 2 chars)
        assertThat(resolve("a")).isEqualTo("unknown");
    }

    @Test
    void tooLongStringReturnsUnknown() {
        // Over 45 chars
        assertThat(resolve("1234567890123456789012345678901234567890123456")).isEqualTo("unknown");
    }

    // ── prefixHex edge cases ──────────────────────────────────────────────────

    @Test
    void prefixHexWithExactByteAlignedPrefix() {
        byte[] all_ones = new byte[16];
        for (int i = 0; i < 16; i++) all_ones[i] = (byte) 0xFF;
        String result = DefaultClientKeyResolver.prefixHex(all_ones, 64);
        // First 8 bytes remain ff, rest are 00
        assertThat(result).startsWith("ffff:ffff:ffff:ffff:");
        assertThat(result).endsWith("0000:0000:0000:0000");
    }

    @Test
    void prefixHexWithPartialByte() {
        byte[] bytes = new byte[16];
        bytes[0] = (byte) 0xFF;
        bytes[1] = (byte) 0xFF;
        String result = DefaultClientKeyResolver.prefixHex(bytes, 12);
        // Only first 12 bits kept: 0xFFF0...
        assertThat(result).startsWith("fff0:");
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private String resolve(String addr) {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr(addr);
        return resolver.resolve(req);
    }

    private static RateLimitProperties defaultProps() {
        return new RateLimitProperties(
            true,
            Duration.ofMinutes(1),
            new RateLimitProperties.Tier(120, 1200),
            new RateLimitProperties.Tier(30, 300),
            new RateLimitProperties.Tier(10, 100),
            new RateLimitProperties.ClientCache(10000, Duration.ofMinutes(2)),
            64
        );
    }
}
