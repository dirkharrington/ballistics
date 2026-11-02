package com.ballistics.config;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Adds RFC 9745 deprecation headers to every response for {@code POST /api/trajectory}.
 * Emits a WARN at startup and increments a Micrometer counter per request.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class DeprecationHeadersFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(DeprecationHeadersFilter.class);

    static final String DEPRECATION_VALUE = "@1793491200";
    static final String SUNSET_VALUE      = "Sat, 01 May 2027 00:00:00 GMT";
    static final String LINK_VALUE        = "</api/trajectories/{bulletId}>; rel=\"successor-version\"";

    static final String LEGACY_TRAJECTORY_DEPRECATION_MESSAGE =
        "POST /api/trajectory is deprecated and will be removed on 2027-05-01. " +
        "Use POST /api/trajectories/{bulletId} instead.";

    private final Counter deprecatedRequestsCounter;

    public DeprecationHeadersFilter(MeterRegistry meterRegistry) {
        this.deprecatedRequestsCounter = Counter.builder("ballistics.api.deprecated.requests")
            .tag("endpoint", "/api/trajectory")
            .register(meterRegistry);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !("POST".equals(request.getMethod()) &&
                 "/api/trajectory".equals(request.getRequestURI()));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        response.setHeader("Deprecation", DEPRECATION_VALUE);
        response.setHeader("Sunset",      SUNSET_VALUE);
        response.setHeader("Link",        LINK_VALUE);
        deprecatedRequestsCounter.increment();
        filterChain.doFilter(request, response);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void warnOnDeprecation() {
        log.warn(LEGACY_TRAJECTORY_DEPRECATION_MESSAGE);
    }
}
