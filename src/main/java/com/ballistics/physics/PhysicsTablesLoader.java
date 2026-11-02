package com.ballistics.physics;

import org.springframework.core.io.Resource;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;

/**
 * Parses and validates {@code physics-tables.yaml}, returning an immutable
 * {@link PhysicsTables} bean.
 *
 * <p>Has no Spring dependencies: tests and the JMH benchmark can call it directly.</p>
 */
public final class PhysicsTablesLoader {

    private PhysicsTablesLoader() {}

    /**
     * Loads from a Spring {@link Resource} (e.g. {@code ClassPathResource}).
     *
     * @throws PhysicsTablesLoadException if the resource does not exist, cannot be read,
     *                                    or fails validation
     */
    public static PhysicsTables load(Resource resource) {
        String desc = resource.getDescription();
        if (!resource.exists()) {
            throw new PhysicsTablesLoadException(desc, "resource not found");
        }
        try (InputStream in = resource.getInputStream()) {
            return load(in, desc);
        } catch (PhysicsTablesLoadException e) {
            throw e;
        } catch (IOException e) {
            throw new PhysicsTablesLoadException(desc, "could not open resource: " + e.getMessage(), e);
        }
    }

    /**
     * Parses {@code yaml} and validates every table and atmosphere entry.
     *
     * @param yaml              raw YAML bytes
     * @param sourceDescription used only in error messages (e.g. {@code "classpath:physics-tables.yaml"})
     * @throws PhysicsTablesLoadException on any parse or validation failure
     */
    public static PhysicsTables load(InputStream yaml, String sourceDescription) {
        if (yaml == null) {
            throw new PhysicsTablesLoadException(sourceDescription, "resource not found");
        }

        Map<String, Object> root;
        try {
            Yaml parser = new Yaml(new SafeConstructor(new LoaderOptions()));
            Object parsed = parser.load(yaml);
            if (!(parsed instanceof Map)) {
                throw new PhysicsTablesLoadException(sourceDescription, "root must be a YAML mapping");
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) parsed;
            root = m;
        } catch (PhysicsTablesLoadException e) {
            throw e;
        } catch (Exception e) {
            throw new PhysicsTablesLoadException(sourceDescription,
                "malformed YAML: " + e.getMessage(), e);
        }

        DragTable g1  = parseTable(root, "g1Table",  sourceDescription);
        DragTable g7  = parseTable(root, "g7Table",  sourceDescription);
        Atmosphere atm = parseAtmosphere(root, sourceDescription);

        return new PhysicsTables(g1, g7, atm);
    }

    // ── private helpers ───────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private static DragTable parseTable(Map<String, Object> root, String key, String src) {
        Object raw = root.get(key);
        if (!(raw instanceof List<?> list)) {
            if (raw == null) {
                throw new PhysicsTablesLoadException(src,
                    key + " must contain at least 2 rows (found 0)");
            }
            throw new PhysicsTablesLoadException(src,
                key + " must be a YAML list");
        }
        if (list.size() < 2) {
            throw new PhysicsTablesLoadException(src,
                key + " must contain at least 2 rows (found " + list.size() + ")");
        }

        int n = list.size();
        double[] velocities = new double[n];
        double[] coeffs     = new double[n];

        for (int i = 0; i < n; i++) {
            Object rowObj = list.get(i);
            if (!(rowObj instanceof Map<?, ?> rawRow)) {
                throw new PhysicsTablesLoadException(src, key + "[" + i + "] must be a mapping");
            }
            Map<String, Object> row = (Map<String, Object>) rawRow;

            // parse v
            Object vObj = row.get("v");
            if (!(vObj instanceof Number)) {
                throw new PhysicsTablesLoadException(src,
                    key + "[" + i + "].v is missing or not a number");
            }
            double v = ((Number) vObj).doubleValue();
            if (!Double.isFinite(v) || v < 0) {
                throw new PhysicsTablesLoadException(src,
                    key + "[" + i + "].v must be finite and >= 0 (" + v + ")");
            }
            if (i > 0 && v <= velocities[i - 1]) {
                throw new PhysicsTablesLoadException(src,
                    key + "[" + i + "].v must be > " + key + "[" + (i - 1) + "].v (" +
                    v + " <= " + velocities[i - 1] + ")");
            }
            velocities[i] = v;

            // parse f
            Object fObj = row.get("f");
            if (!(fObj instanceof Number)) {
                throw new PhysicsTablesLoadException(src,
                    key + "[" + i + "].f is missing or not a number");
            }
            double f = ((Number) fObj).doubleValue();
            if (!Double.isFinite(f) || f <= 0) {
                throw new PhysicsTablesLoadException(src,
                    key + "[" + i + "].f must be finite and > 0 (" + f + ")");
            }
            coeffs[i] = f;
        }

        return new DragTable(velocities, coeffs);
    }

    @SuppressWarnings("unchecked")
    private static Atmosphere parseAtmosphere(Map<String, Object> root, String src) {
        Object raw = root.get("atmosphere");
        if (!(raw instanceof Map<?, ?> rawAtm)) {
            throw new PhysicsTablesLoadException(src,
                "atmosphere must be a YAML mapping");
        }
        Map<String, Object> atm = (Map<String, Object>) rawAtm;

        double stdTempF            = requireDouble(atm, "stdTempF",            "atmosphere", src);
        double lapseRatePer1000Ft  = requireDouble(atm, "lapseRatePer1000Ft",  "atmosphere", src);
        double rankineOffset       = requireDouble(atm, "rankineOffset",       "atmosphere", src);
        double pressureCoeff       = requireDouble(atm, "pressureCoeff",       "atmosphere", src);
        double pressureExp         = requireDouble(atm, "pressureExp",         "atmosphere", src);

        return new Atmosphere(stdTempF, lapseRatePer1000Ft, rankineOffset, pressureCoeff, pressureExp);
    }

    private static double requireDouble(Map<String, Object> map, String key,
                                        String section, String src) {
        Object v = map.get(key);
        if (!(v instanceof Number)) {
            throw new PhysicsTablesLoadException(src,
                section + "." + key + " is missing or not a number");
        }
        return ((Number) v).doubleValue();
    }
}
