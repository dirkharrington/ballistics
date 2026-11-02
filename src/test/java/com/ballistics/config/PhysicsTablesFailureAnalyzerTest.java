package com.ballistics.config;

import com.ballistics.physics.PhysicsTablesLoadException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.diagnostics.FailureAnalysis;

import static org.assertj.core.api.Assertions.assertThat;

class PhysicsTablesFailureAnalyzerTest {

    @Test
    void analyzeProducesHumanReadableDescription() {
        PhysicsTablesFailureAnalyzer analyzer = new PhysicsTablesFailureAnalyzer();
        PhysicsTablesLoadException cause = new PhysicsTablesLoadException("test-src", "bad yaml");

        FailureAnalysis analysis = analyzer.analyze(cause, cause);

        assertThat(analysis.getDescription())
            .contains("test-src")
            .contains("bad yaml");
        assertThat(analysis.getAction())
            .contains("physics-tables.yaml");
        assertThat(analysis.getCause()).isSameAs(cause);
    }
}
