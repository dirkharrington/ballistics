package com.ballistics.ratelimit;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Spring MVC interceptor that enforces per-client + global rate limits on endpoints
 * annotated with {@link RateLimited}.
 *
 * <p>Registered in {@link com.ballistics.config.WebConfig} for {@code /api/**}.</p>
 *
 * <p>Tokens are consumed in {@code preHandle}, before body binding and validation,
 * so invalid requests also consume tokens (fails-closed).</p>
 */
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private final ClientKeyResolver keyResolver;
    private final ClientRateLimiter rateLimiter;

    public RateLimitInterceptor(ClientKeyResolver keyResolver, ClientRateLimiter rateLimiter) {
        this.keyResolver = keyResolver;
        this.rateLimiter = rateLimiter;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                             Object handler) throws Exception {
        if (!(handler instanceof HandlerMethod hm)) {
            return true; // not a controller method (static resources, CORS preflight, etc.)
        }
        RateLimited annotation = hm.getMethodAnnotation(RateLimited.class);
        if (annotation == null) {
            return true; // endpoint is not rate-limited
        }

        String clientKey = keyResolver.resolve(request);
        ClientRateLimiter.Decision decision = rateLimiter.tryConsume(annotation.value(), clientKey);

        if (!decision.allowed()) {
            throw new RateLimitExceededException(annotation.value(), decision.retryAfterSeconds());
        }
        return true;
    }
}
