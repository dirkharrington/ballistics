package com.ballistics.physics;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for {@link Atmosphere}, {@link DragTable}, and {@link PhysicsTables}
 * constructors and methods. Exercises branches that the YAML loader tests cannot
 * reach (the loader validates values before constructing objects).
 */
class PhysicsModelUnitTest {

    // ── PhysicsTables.forModel ────────────────────────────────────────────────

    @Test
    void forModelG7ReturnsG7Table() {
        DragTable g1  = twoRowTable(0, 100);
        DragTable g7  = twoRowTable(0, 200);
        Atmosphere atm = validAtmosphere();
        PhysicsTables tables = new PhysicsTables(g1, g7, atm);

        assertThat(tables.forModel("G7")).isSameAs(g7);
    }

    @Test
    void forModelNonG7ReturnsG1() {
        DragTable g1  = twoRowTable(0, 100);
        DragTable g7  = twoRowTable(0, 200);
        PhysicsTables tables = new PhysicsTables(g1, g7, validAtmosphere());

        assertThat(tables.forModel("G1")).isSameAs(g1);
        assertThat(tables.forModel(null)).isSameAs(g1);
        assertThat(tables.forModel("anything")).isSameAs(g1);
    }

    // ── Atmosphere constructor — each throw branch ────────────────────────────

    @Test
    void atmosphereRejectsNaNStdTempF() {
        assertThatThrownBy(() ->
            new Atmosphere(Double.NaN, 3.5, 459.67, 6.87559e-6, 5.256))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("stdTempF");
    }

    @Test
    void atmosphereRejectsNaNLapseRate() {
        assertThatThrownBy(() ->
            new Atmosphere(59.0, Double.NaN, 459.67, 6.87559e-6, 5.256))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("lapseRatePer1000Ft");
    }

    @Test
    void atmosphereRejectsNaNRankineOffset() {
        assertThatThrownBy(() ->
            new Atmosphere(59.0, 3.5, Double.NaN, 6.87559e-6, 5.256))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("rankineOffset");
    }

    @Test
    void atmosphereRejectsNonPositiveRankineOffset() {
        // finite but <= 0: exercises the second sub-condition of the compound ||
        assertThatThrownBy(() ->
            new Atmosphere(59.0, 3.5, -1.0, 6.87559e-6, 5.256))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("rankineOffset");
    }

    @Test
    void atmosphereRejectsNaNPressureCoeff() {
        assertThatThrownBy(() ->
            new Atmosphere(59.0, 3.5, 459.67, Double.NaN, 5.256))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("pressureCoeff");
    }

    @Test
    void atmosphereRejectsNonPositivePressureCoeff() {
        assertThatThrownBy(() ->
            new Atmosphere(59.0, 3.5, 459.67, -1.0, 5.256))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("pressureCoeff");
    }

    @Test
    void atmosphereRejectsNaNPressureExp() {
        assertThatThrownBy(() ->
            new Atmosphere(59.0, 3.5, 459.67, 6.87559e-6, Double.NaN))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("pressureExp");
    }

    @Test
    void atmosphereRejectsNonPositivePressureExp() {
        assertThatThrownBy(() ->
            new Atmosphere(59.0, 3.5, 459.67, 6.87559e-6, -1.0))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("pressureExp");
    }

    // ── DragTable constructor — each throw branch ────────────────────────────

    @Test
    void dragTableRejectsNullVelocities() {
        assertThatThrownBy(() ->
            new DragTable(null, new double[]{0.1, 0.2}))
            .isInstanceOf(NullPointerException.class);
    }

    @Test
    void dragTableRejectsNullCoefficients() {
        assertThatThrownBy(() ->
            new DragTable(new double[]{0, 100}, null))
            .isInstanceOf(NullPointerException.class);
    }

    @Test
    void dragTableRejectsMismatchedLengths() {
        assertThatThrownBy(() ->
            new DragTable(new double[]{0, 100, 200}, new double[]{0.1, 0.2}))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("same length");
    }

    @Test
    void dragTableRejectsSingleRow() {
        // Both arrays have length 1 (pass mismatch check) but fail the < 2 check
        assertThatThrownBy(() ->
            new DragTable(new double[]{100}, new double[]{0.2}))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("at least 2 rows");
    }

    @Test
    void dragTableRejectsNonFiniteVelocity() {
        // NaN velocity: exercises !isFinite(v) true branch (first sub-condition of compound ||)
        assertThatThrownBy(() ->
            new DragTable(new double[]{0, Double.NaN}, new double[]{0.1, 0.2}))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("velocitiesFps[1]");
    }

    @Test
    void dragTableRejectsNegativeVelocity() {
        // finite but < 0: exercises v < 0 true branch (second sub-condition)
        assertThatThrownBy(() ->
            new DragTable(new double[]{-1.0, 100}, new double[]{0.1, 0.2}))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("velocitiesFps[0]");
    }

    @Test
    void dragTableRejectsNonFiniteCoefficient() {
        // NaN coefficient: exercises !isFinite(f) true branch
        assertThatThrownBy(() ->
            new DragTable(new double[]{0, 100}, new double[]{Double.NaN, 0.2}))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("coefficients[0]");
    }

    @Test
    void dragTableRejectsNonPositiveCoefficient() {
        // zero coefficient: exercises f <= 0 branch
        assertThatThrownBy(() ->
            new DragTable(new double[]{0, 100}, new double[]{0.0, 0.2}))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("coefficients[0]");
    }

    @Test
    void dragTableRejectsNonMonotonicVelocities() {
        assertThatThrownBy(() ->
            new DragTable(new double[]{100, 50}, new double[]{0.1, 0.2}))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("velocitiesFps[1]");
    }

    // ── DragTable equals — edge cases ─────────────────────────────────────────

    @Test
    void dragTableEqualsItself() {
        DragTable t = twoRowTable(0, 100);
        // covers the `this == obj` true branch
        assertThat(t).isEqualTo(t);
    }

    @Test
    void dragTableDoesNotEqualNullOrOtherType() {
        DragTable t = twoRowTable(0, 100);
        // covers `!(obj instanceof DragTable)` true branch
        assertThat(t).isNotEqualTo(null);
        assertThat(t).isNotEqualTo("not-a-drag-table");
    }

    @Test
    void dragTableWithDifferentCoefficientsNotEqual() {
        DragTable a = new DragTable(new double[]{0, 100}, new double[]{0.1, 0.2});
        DragTable b = new DragTable(new double[]{0, 100}, new double[]{0.1, 0.9});
        // velocities equal but coefficients differ: covers 2nd Arrays.equals false
        assertThat(a).isNotEqualTo(b);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static DragTable twoRowTable(double v0, double v1) {
        return new DragTable(new double[]{v0, v1}, new double[]{0.1, 0.2});
    }

    private static Atmosphere validAtmosphere() {
        return new Atmosphere(59.0, 3.5, 459.67, 6.87559e-6, 5.256);
    }
}
