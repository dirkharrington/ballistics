package com.ballistics.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.concurrent.TimeUnit;

/**
 * Web MVC configuration for the ballistics visualizer.
 *
 * <p><b>CORS</b>: allowed origins are read from {@code app.cors.allowed-origins}
 * (application.properties), which itself defaults to the {@code CORS_ALLOWED_ORIGINS}
 * env var. Pass a comma-separated list to permit multiple origins without a code
 * change, e.g. {@code CORS_ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com}.</p>
 *
 * <p><b>Static resources</b>: cache strategy for the Vite-built SPA:
 * <ul>
 *   <li>{@code /assets/**} — content-hashed filenames → immutable, 1-year cache</li>
 *   <li>{@code /**} — index.html and friends → no-cache (always revalidate)</li>
 * </ul>
 * index.html must never be cached: Vite's {@code emptyOutDir=true} deletes the old
 * bundle on every rebuild, so a stale index.html referencing a deleted hash gets a
 * 404 and the page renders blank.</p>
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    /** Comma-separated list of allowed CORS origins. Injected from application.properties. */
    @Value("${app.cors.allowed-origins}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins(allowedOrigins)
            .allowedMethods("GET", "POST", "OPTIONS")
            .allowedHeaders("*")
            .maxAge(3600);
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/webjars/**")
            .addResourceLocations("classpath:/META-INF/resources/webjars/");

        registry.addResourceHandler("/assets/**")
            .addResourceLocations("classpath:/static/assets/")
            .setCacheControl(CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable());

        registry.addResourceHandler("/**")
            .addResourceLocations("classpath:/static/")
            .setCacheControl(CacheControl.noCache());
    }
}
