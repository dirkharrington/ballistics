package com.ballistics.config;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Externalized configuration for HTTP request size limits.
 *
 * <p>Picked up by {@code @ConfigurationPropertiesScan} on {@link com.ballistics.BallisticsApplication}.</p>
 */
@Validated
@ConfigurationProperties("app.http")
public record HttpLimitsProperties(
    @DefaultValue("65536") @Min(1024) @Max(10_485_760) long maxRequestBodyBytes
) {}
