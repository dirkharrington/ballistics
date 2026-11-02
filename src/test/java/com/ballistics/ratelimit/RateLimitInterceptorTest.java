package com.ballistics.ratelimit;

import com.ballistics.config.RateLimitProperties;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

import java.lang.reflect.Method;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link RateLimitInterceptor}.
 */
class RateLimitInterceptorTest {

    private RateLimitInterceptor interceptor;
    private MockHttpServletRequest request;
    private MockHttpServletResponse response;

    @BeforeEach
    void setUp() {
        RateLimitProperties.Tier tier = new RateLimitProperties.Tier(100, 1000);
        RateLimitProperties props = new RateLimitProperties(
            true, Duration.ofMinutes(1), tier, tier, tier,
            new RateLimitProperties.ClientCache(100, Duration.ofMinutes(2)), 64
        );
        ClientRateLimiter limiter = new ClientRateLimiter(props, new SimpleMeterRegistry());
        limiter.init();
        DefaultClientKeyResolver keyResolver = new DefaultClientKeyResolver(props);
        interceptor = new RateLimitInterceptor(keyResolver, limiter);
        request = new MockHttpServletRequest("POST", "/api/test");
        request.setRemoteAddr("127.0.0.1");
        response = new MockHttpServletResponse();
    }

    // ── Non-HandlerMethod handler (static resources, CORS preflight, etc.) ────

    @Test
    void nonHandlerMethodReturnsTrue() throws Exception {
        // Pass a String as handler — not a HandlerMethod → interceptor returns true immediately
        boolean result = interceptor.preHandle(request, response, "not-a-handler-method");
        assertThat(result).isTrue();
    }

    // ── HandlerMethod without @RateLimited annotation ────────────────────────

    @Test
    void handlerMethodWithoutAnnotationReturnsTrue() throws Exception {
        // A method without @RateLimited → interceptor returns true (not rate-limited)
        Method m = SampleController.class.getMethod("unannotated");
        HandlerMethod hm = new HandlerMethod(new SampleController(), m);
        boolean result = interceptor.preHandle(request, response, hm);
        assertThat(result).isTrue();
    }

    // ── HandlerMethod with @RateLimited when rate limit is not exceeded ───────

    @Test
    void handlerMethodWithAnnotationAllowsWhenBucketHasTokens() throws Exception {
        Method m = SampleController.class.getMethod("rateLimited");
        HandlerMethod hm = new HandlerMethod(new SampleController(), m);
        boolean result = interceptor.preHandle(request, response, hm);
        assertThat(result).isTrue();
    }

    // ── HandlerMethod with @RateLimited when rate limit is exceeded ──────────

    @Test
    void handlerMethodWithAnnotationThrowsWhenBucketDepleted() throws Exception {
        // Use a limiter with capacity=1 to exhaust on first call
        RateLimitProperties.Tier tiny = new RateLimitProperties.Tier(1, 10);
        RateLimitProperties props = new RateLimitProperties(
            true, Duration.ofMinutes(1), tiny, tiny, tiny,
            new RateLimitProperties.ClientCache(100, Duration.ofMinutes(2)), 64
        );
        ClientRateLimiter limiter = new ClientRateLimiter(props, new SimpleMeterRegistry());
        limiter.init();
        DefaultClientKeyResolver keyResolver = new DefaultClientKeyResolver(props);
        RateLimitInterceptor tightInterceptor = new RateLimitInterceptor(keyResolver, limiter);

        Method m = SampleController.class.getMethod("rateLimited");
        HandlerMethod hm = new HandlerMethod(new SampleController(), m);

        // First call succeeds
        tightInterceptor.preHandle(request, response, hm);
        // Second call from same client should throw
        assertThatThrownBy(() -> tightInterceptor.preHandle(request, response, hm))
            .isInstanceOf(RateLimitExceededException.class);
    }

    // ── Stub controller for HandlerMethod construction ────────────────────────

    static class SampleController {
        public void unannotated() {}

        @RateLimited(RateLimitTier.SINGLE)
        public void rateLimited() {}
    }
}
