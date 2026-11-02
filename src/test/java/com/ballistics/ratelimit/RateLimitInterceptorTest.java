package com.ballistics.ratelimit;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link RateLimitInterceptor} covering branches not reachable
 * via the full Spring MVC integration tests.
 */
class RateLimitInterceptorTest {

    // ── Non-HandlerMethod handler → early return true ─────────────────────────

    @Test
    void preHandleReturnsTrueForNonHandlerMethodObject() throws Exception {
        ClientKeyResolver keyResolver = mock(ClientKeyResolver.class);
        ClientRateLimiter rateLimiter = mock(ClientRateLimiter.class);
        RateLimitInterceptor interceptor = new RateLimitInterceptor(keyResolver, rateLimiter);

        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        // handler is a plain Object (not HandlerMethod) — exercises `!(handler instanceof HandlerMethod)` true branch
        boolean result = interceptor.preHandle(request, response, new Object());

        assertThat(result).isTrue();
        verifyNoInteractions(keyResolver, rateLimiter);
    }

    // ── RateLimitExceededException.tier() getter ──────────────────────────────

    @Test
    void rateLimitExceededExceptionTierGetterReturnsConstructedTier() {
        RateLimitExceededException ex = new RateLimitExceededException(RateLimitTier.COMPARE, 42L);
        assertThat(ex.tier()).isEqualTo(RateLimitTier.COMPARE);
        assertThat(ex.retryAfterSeconds()).isEqualTo(42L);
    }
}
