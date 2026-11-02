package com.ballistics.config;

import com.ballistics.physics.PhysicsTables;
import com.ballistics.physics.PhysicsTablesLoader;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.ImportRuntimeHints;
import org.springframework.core.io.Resource;

/**
 * Creates the singleton {@link PhysicsTables} bean from {@code physics-tables.yaml}.
 *
 * <p>The bean is created eagerly (Spring default), so bad YAML fails context refresh
 * before the web server opens its port.</p>
 */
@Configuration
@ImportRuntimeHints(PhysicsTablesConfig.Hints.class)
public class PhysicsTablesConfig {

    @Bean
    public PhysicsTables physicsTables(
            @Value("${app.physics.tables-location:classpath:physics-tables.yaml}") Resource location) {
        return PhysicsTablesLoader.load(location);
    }

    /** GraalVM native-image: register {@code physics-tables.yaml} as a classpath resource. */
    static class Hints implements RuntimeHintsRegistrar {
        @Override
        public void registerHints(RuntimeHints h, ClassLoader cl) {
            h.resources().registerPattern("physics-tables.yaml");
        }
    }
}
