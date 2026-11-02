package com.ballistics.physics;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link PhysicsTablesLoadException} covering all getters.
 */
class PhysicsTablesLoadExceptionTest {

    @Test
    void twoArgConstructorExposesSourceAndProblem() {
        PhysicsTablesLoadException ex = new PhysicsTablesLoadException("classpath:foo.yaml", "bad format");
        assertThat(ex.source()).isEqualTo("classpath:foo.yaml");
        assertThat(ex.problem()).isEqualTo("bad format");
        assertThat(ex.getMessage()).contains("classpath:foo.yaml").contains("bad format");
        assertThat(ex.getCause()).isNull();
    }

    @Test
    void threeArgConstructorExposesSourceProblemAndCause() {
        Throwable cause = new RuntimeException("root cause");
        PhysicsTablesLoadException ex = new PhysicsTablesLoadException("classpath:bar.yaml", "io error", cause);
        assertThat(ex.source()).isEqualTo("classpath:bar.yaml");
        assertThat(ex.problem()).isEqualTo("io error");
        assertThat(ex.getCause()).isSameAs(cause);
    }
}
