package com.ballistics.physics;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.*;

/**
 * Covers every validation rule in the contract's Validation table.
 */
class PhysicsTablesLoaderTest {

    // ── Happy path ────────────────────────────────────────────────────────────

    @Test
    void loadFromClasspath() {
        PhysicsTables tables = PhysicsTablesLoader.load(new ClassPathResource("physics-tables.yaml"));
        assertThat(tables.g1().size()).isGreaterThan(2);
        assertThat(tables.g7().size()).isGreaterThan(2);
        assertThat(tables.atmosphere().stdTempF()).isEqualTo(59.0);
    }

    // ── Resource existence ────────────────────────────────────────────────────

    @Test
    void missingResourceThrows() {
        assertThatThrownBy(() ->
            PhysicsTablesLoader.load(new ClassPathResource("does-not-exist.yaml")))
            .isInstanceOf(PhysicsTablesLoadException.class)
            .hasMessageContaining("resource not found");
    }

    @Test
    void nullStreamThrows() {
        assertThatThrownBy(() ->
            PhysicsTablesLoader.load(null, "test-source"))
            .isInstanceOf(PhysicsTablesLoadException.class)
            .hasMessageContaining("resource not found");
    }

    // ── Root structure ────────────────────────────────────────────────────────

    @Test
    void nonMappingRootThrows() {
        assertThrows("- item1\n- item2\n", "root must be a YAML mapping");
    }

    // ── Table structure ───────────────────────────────────────────────────────

    @Test
    void missingG1TableThrows() {
        String yaml = buildYaml("", validG7(), validAtm());
        assertThrows(yaml, "g1Table must contain at least 2 rows");
    }

    @Test
    void g1TableWith1RowThrows() {
        String oneRow = "g1Table:\n  - { v: 0, f: 0.1 }\n";
        String yaml = buildYaml(oneRow, validG7(), validAtm());
        assertThrows(yaml, "g1Table must contain at least 2 rows (found 1)");
    }

    @Test
    void missingG7TableThrows() {
        String yaml = buildYaml(validG1(), "", validAtm());
        assertThrows(yaml, "g7Table must contain at least 2 rows");
    }

    @Test
    void g7TableWith1RowThrows() {
        String oneRow = "g7Table:\n  - { v: 0, f: 0.1 }\n";
        String yaml = buildYaml(validG1(), oneRow, validAtm());
        assertThrows(yaml, "g7Table must contain at least 2 rows (found 1)");
    }

    // ── Row validation: missing/non-numeric v or f ────────────────────────────

    @Test
    void missingVThrows() {
        String bad = "g1Table:\n  - { v: 0, f: 0.1 }\n  - { f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[1].v is missing or not a number");
    }

    @Test
    void missingFThrows() {
        String bad = "g1Table:\n  - { v: 0, f: 0.1 }\n  - { v: 100 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[1].f is missing or not a number");
    }

    @Test
    void nonNumericVThrows() {
        String bad = "g1Table:\n  - { v: 0, f: 0.1 }\n  - { v: \"abc\", f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[1].v is missing or not a number");
    }

    @Test
    void nonNumericFThrows() {
        String bad = "g1Table:\n  - { v: 0, f: 0.1 }\n  - { v: 100, f: \"bad\" }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[1].f is missing or not a number");
    }

    // ── Row validation: v strictly increasing ────────────────────────────────

    @Test
    void vNotStrictlyIncreasingThrows() {
        // v[1] == v[0]: not strictly increasing
        String bad = "g1Table:\n  - { v: 100, f: 0.1 }\n  - { v: 100, f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[1].v must be > g1Table[0].v");
    }

    @Test
    void vDecreasingThrows() {
        String bad = "g1Table:\n  - { v: 200, f: 0.1 }\n  - { v: 100, f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[1].v must be > g1Table[0].v");
    }

    @Test
    void vNegativeFirstRowThrows() {
        String bad = "g1Table:\n  - { v: -1, f: 0.1 }\n  - { v: 100, f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[0].v must be finite and >= 0");
    }

    // ── Row validation: f finite and > 0 ─────────────────────────────────────

    @Test
    void fZeroThrows() {
        String bad = "g1Table:\n  - { v: 0, f: 0.0 }\n  - { v: 100, f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[0].f must be finite and > 0");
    }

    @Test
    void fNegativeThrows() {
        String bad = "g1Table:\n  - { v: 0, f: -0.1 }\n  - { v: 100, f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[0].f must be finite and > 0");
    }

    // ── Atmosphere validation ─────────────────────────────────────────────────

    @Test
    void missingAtmosphereKeyThrows() {
        String badAtm = "atmosphere:\n  stdTempF: 59.0\n  lapseRatePer1000Ft: 3.5\n  rankineOffset: 459.67\n  pressureCoeff: 6.87559e-6\n";
        // missing pressureExp
        String yaml = buildYaml(validG1(), validG7(), badAtm);
        assertThrows(yaml, "atmosphere.pressureExp is missing or not a number");
    }

    @Test
    void missingStdTempFThrows() {
        String badAtm = "atmosphere:\n  lapseRatePer1000Ft: 3.5\n  rankineOffset: 459.67\n  pressureCoeff: 6.87559e-6\n  pressureExp: 5.256\n";
        String yaml = buildYaml(validG1(), validG7(), badAtm);
        assertThrows(yaml, "atmosphere.stdTempF is missing or not a number");
    }

    @Test
    void missingLapseRateThrows() {
        String badAtm = "atmosphere:\n  stdTempF: 59.0\n  rankineOffset: 459.67\n  pressureCoeff: 6.87559e-6\n  pressureExp: 5.256\n";
        String yaml = buildYaml(validG1(), validG7(), badAtm);
        assertThrows(yaml, "atmosphere.lapseRatePer1000Ft is missing or not a number");
    }

    @Test
    void missingRankineOffsetThrows() {
        String badAtm = "atmosphere:\n  stdTempF: 59.0\n  lapseRatePer1000Ft: 3.5\n  pressureCoeff: 6.87559e-6\n  pressureExp: 5.256\n";
        String yaml = buildYaml(validG1(), validG7(), badAtm);
        assertThrows(yaml, "atmosphere.rankineOffset is missing or not a number");
    }

    @Test
    void missingPressureCoeffThrows() {
        String badAtm = "atmosphere:\n  stdTempF: 59.0\n  lapseRatePer1000Ft: 3.5\n  rankineOffset: 459.67\n  pressureExp: 5.256\n";
        String yaml = buildYaml(validG1(), validG7(), badAtm);
        assertThrows(yaml, "atmosphere.pressureCoeff is missing or not a number");
    }

    // ── Table structure: non-list and non-mapping row ─────────────────────────

    @Test
    void g1TableNotAListThrows() {
        // g1Table is a scalar, not a list → "must be a YAML list"
        String yaml = "g1Table: scalar_value\n" + validG7() + validAtm();
        assertThrows(yaml, "g1Table must be a YAML list");
    }

    @Test
    void tableRowNotAMappingThrows() {
        // Each row must be a YAML mapping; a plain string is not
        String bad = "g1Table:\n  - just_a_string\n  - { v: 100, f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[0] must be a mapping");
    }

    // ── Row validation: non-finite v or f ─────────────────────────────────────

    @Test
    void vNotFiniteThrows() {
        // .nan is YAML 1.1 literal for NaN; exercises !isFinite(v) true branch
        String bad = "g1Table:\n  - { v: .nan, f: 0.1 }\n  - { v: 100, f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[0].v must be finite and >= 0");
    }

    @Test
    void fNotFiniteThrows() {
        // .nan for coefficient; exercises !isFinite(f) true branch
        String bad = "g1Table:\n  - { v: 0, f: .nan }\n  - { v: 100, f: 0.2 }\n";
        String yaml = buildYaml(bad, validG7(), validAtm());
        assertThrows(yaml, "g1Table[0].f must be finite and > 0");
    }

    // ── Malformed YAML ────────────────────────────────────────────────────────

    @Test
    void malformedYamlThrows() {
        assertThrows("key: [unclosed bracket\n", "malformed YAML:");
    }

    // ── Defensive copy: mutating returned array doesn't affect engine ─────────

    @Test
    void dragTableDefensiveCopyOut() {
        PhysicsTables tables = PhysicsTablesLoader.load(new ClassPathResource("physics-tables.yaml"));
        double[] v1 = tables.g1().velocitiesFps();
        v1[0] = 999999.0;
        double[] v2 = tables.g1().velocitiesFps();
        assertThat(v2[0]).isNotEqualTo(999999.0);
    }

    // ── DragTable equals/hashCode ─────────────────────────────────────────────

    @Test
    void dragTableEquality() {
        DragTable a = new DragTable(new double[]{0, 100}, new double[]{0.1, 0.2});
        DragTable b = new DragTable(new double[]{0, 100}, new double[]{0.1, 0.2});
        DragTable c = new DragTable(new double[]{0, 200}, new double[]{0.1, 0.2});

        assertThat(a).isEqualTo(b);
        assertThat(a.hashCode()).isEqualTo(b.hashCode());
        assertThat(a).isNotEqualTo(c);
        assertThat(a.toString()).contains("size=2");
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private void assertThrows(String yamlContent, String expectedMsg) {
        byte[] bytes = yamlContent.getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() ->
            PhysicsTablesLoader.load(new ByteArrayInputStream(bytes), "test-source"))
            .isInstanceOf(PhysicsTablesLoadException.class)
            .hasMessageContaining(expectedMsg);
    }

    private String buildYaml(String g1, String g7, String atm) {
        return g1 + g7 + atm;
    }

    private String validG1() {
        return "g1Table:\n  - { v: 0, f: 0.1 }\n  - { v: 100, f: 0.2 }\n";
    }

    private String validG7() {
        return "g7Table:\n  - { v: 0, f: 0.1 }\n  - { v: 100, f: 0.2 }\n";
    }

    private String validAtm() {
        return "atmosphere:\n  stdTempF: 59.0\n  lapseRatePer1000Ft: 3.5\n" +
               "  rankineOffset: 459.67\n  pressureCoeff: 6.87559e-6\n  pressureExp: 5.256\n";
    }
}
