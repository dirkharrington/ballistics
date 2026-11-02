package com.ballistics.controller;

import com.ballistics.ratelimit.RateLimitExceededException;
import com.ballistics.ratelimit.RateLimitTier;
import com.ballistics.service.UnknownBulletException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link GlobalExceptionHandler} covering branches not reachable
 * via MockMvc integration tests (e.g. null bulletId → truncate("null")).
 */
class GlobalExceptionHandlerUnitTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    // ── truncate(null) → "null" ───────────────────────────────────────────────

    @Test
    void handleUnknownBulletWithNullIdIncludesNullLiteral() {
        // UnknownBulletException(null) → truncate(null) returns "null"
        ResponseEntity<ProblemDetail> response = handler.handleUnknownBullet(new UnknownBulletException(null));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getDetail()).contains("null");
    }

    // ── truncate with normal (short) id ──────────────────────────────────────

    @Test
    void handleUnknownBulletWithNormalId() {
        ResponseEntity<ProblemDetail> response =
            handler.handleUnknownBullet(new UnknownBulletException("308-win-168gr"));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getDetail()).contains("308-win-168gr");
    }

    // ── handleRateLimit sets Retry-After header ───────────────────────────────

    @Test
    void handleRateLimitSetsRetryAfterHeader() {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/trajectory");
        RateLimitExceededException ex = new RateLimitExceededException(RateLimitTier.SINGLE, 30L);
        ResponseEntity<ProblemDetail> response = handler.handleRateLimit(ex, req);
        assertThat(response.getStatusCode().value()).isEqualTo(429);
        assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("30");
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getDetail()).contains("30");
    }
}
