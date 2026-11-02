package com.ballistics.controller;

import com.ballistics.service.UnknownBulletException;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.http.ProblemDetail;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link GlobalExceptionHandler} covering branches not reachable
 * via the full HTTP layer (e.g. null bulletId that passes through truncate).
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void handleUnknownBulletWithNullIdReturns400WithNullInDetail() {
        // truncate(null, 64) → "null" string; exercises the s==null branch
        UnknownBulletException ex = new UnknownBulletException(null);
        ResponseEntity<ProblemDetail> response = handler.handleUnknownBullet(ex);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getDetail()).contains("null");
    }
}
