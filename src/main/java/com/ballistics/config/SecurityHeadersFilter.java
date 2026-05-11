package com.ballistics.config;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Item 12 — stamps every response with HTTP security headers.
 *
 * <p>CSP is skipped for {@code /swagger-ui/**} and {@code /v3/api-docs/**} because
 * those paths require inline scripts. They are disabled in production via
 * {@code springdoc.swagger-ui.enabled=false} in application-prod.properties.</p>
 *
 * <p>HSTS is included unconditionally; it takes effect only once HTTPS is in front
 * of the service (browsers silently ignore it over plain HTTP for non-localhost).</p>
 *
 * <p>{@code style-src 'unsafe-inline'} permits existing {@code style="..."} attributes
 * in index.html. Migrating those to CSS classes would allow tightening to {@code 'self'}.</p>
 */
@Component
@Order(Integer.MIN_VALUE)
public class SecurityHeadersFilter implements Filter {

    private static final String CSP =
        "default-src 'self'; " +
        "font-src 'self'; " +
        "img-src 'self' data:; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; " +
        "frame-ancestors 'none'";

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest  req  = (HttpServletRequest)  request;
        HttpServletResponse resp = (HttpServletResponse) response;

        resp.setHeader("X-Content-Type-Options",  "nosniff");
        resp.setHeader("X-Frame-Options",          "DENY");
        resp.setHeader("X-XSS-Protection",         "0");
        resp.setHeader("Referrer-Policy",           "strict-origin-when-cross-origin");
        resp.setHeader("Permissions-Policy",        "camera=(), microphone=(), geolocation=(), payment=()");
        resp.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

        String path = req.getRequestURI();
        if (!path.startsWith("/swagger-ui") && !path.startsWith("/v3/api-docs")) {
            resp.setHeader("Content-Security-Policy", CSP);
        }

        chain.doFilter(request, response);
    }
}
