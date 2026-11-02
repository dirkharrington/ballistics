package com.ballistics.ratelimit;

import jakarta.servlet.http.HttpServletRequest;

/** Resolves a stable, normalised rate-limit key for an HTTP client. */
public interface ClientKeyResolver {
    String resolve(HttpServletRequest request);
}
