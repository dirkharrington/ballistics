package com.ballistics.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.concurrent.TimeUnit;

/**
 * Static-resource cache strategy for the Vite-built SPA:
 *
 *   /assets/** — content-hashed filenames → immutable, 1-year cache
 *   /**        — index.html and friends  → no-cache (always revalidate)
 *
 * index.html must never be cached: Vite's emptyOutDir=true deletes the old
 * bundle on every rebuild, so a browser serving a stale index.html referencing
 * the previous bundle hash gets a 404 and the page renders blank.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

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
