package com.ballistics;

import com.ballistics.model.Bullet;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.util.List;
import java.util.Map;

/**
 * Test helper: loads the bullet catalog from bullets.yaml without a Spring context.
 * Mirrors what BulletCatalogProperties/BulletCatalogConfig do at runtime.
 */
public class BulletCatalog {

    @SuppressWarnings("unchecked")
    public static List<Bullet> load() {
        Yaml yaml = new Yaml();
        try (InputStream in = BulletCatalog.class.getClassLoader()
                .getResourceAsStream("bullets.yaml")) {
            Map<String, Object> root = yaml.load(in);
            Map<String, Object> app = (Map<String, Object>) root.get("app");
            List<Map<String, Object>> entries = (List<Map<String, Object>>) app.get("bullets");
            return entries.stream()
                .map(m -> new Bullet(
                    (String) m.get("id"),
                    (String) m.get("name"),
                    (String) m.get("caliber"),
                    toDouble(m.get("bulletWeightGrams")),
                    toDouble(m.get("muzzleVelocityMps")),
                    toDouble(m.get("ballisticCoefficient")),
                    toDouble(m.get("bulletDiameterMm")),
                    toDouble(m.get("muzzleEnergyJoules")),
                    (String) m.get("description"),
                    (String) m.get("hexColor")
                ))
                .toList();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load bullets.yaml from classpath", e);
        }
    }

    public static Bullet findById(String id) {
        return load().stream()
            .filter(b -> b.id().equals(id))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Unknown bullet id: " + id));
    }

    private static double toDouble(Object v) {
        return v instanceof Number n ? n.doubleValue() : Double.parseDouble(v.toString());
    }
}
