package com.ballistics.physics;

import com.ballistics.BallisticsApplication;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;

import static org.assertj.core.api.Assertions.*;

/**
 * Proves that a bad {@code app.physics.tables-location} fails context refresh
 * with a {@link PhysicsTablesLoadException} somewhere in the cause chain.
 */
class PhysicsTablesContextTest {

    @Test
    void missingTablesFileFailsContextRefreshWithPhysicsTablesLoadException() {
        // Command-line args have the highest priority — they override application.properties
        SpringApplication app = new SpringApplication(BallisticsApplication.class);
        app.setWebApplicationType(org.springframework.boot.WebApplicationType.NONE);

        assertThatThrownBy(() ->
            app.run(
                "--app.physics.tables-location=classpath:does-not-exist.yaml",
                "--server.port=0"
            )
        ).satisfies(thrown -> {
            Throwable t = thrown;
            boolean found = false;
            while (t != null) {
                if (t instanceof PhysicsTablesLoadException ptle) {
                    found = true;
                    assertThat(ptle.getMessage()).contains("Physics tables could not be loaded");
                    break;
                }
                t = t.getCause();
            }
            assertThat(found)
                .as("Expected PhysicsTablesLoadException in cause chain, actual: %s", thrown.toString())
                .isTrue();
        });
    }
}
