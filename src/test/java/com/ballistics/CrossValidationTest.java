package com.ballistics;

import com.ballistics.model.Bullet;
import com.ballistics.model.TrajectoryRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.io.File;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies that the Java RK4 engine and the JavaScript simulateBullet() function
 * agree on drop values within 2 cm and velocity within 3 m/s at every range step
 * up to 800 m, for all catalog bullets at standard conditions.
 *
 * The JS engine runs via a Node subprocess (cross-validate-runner.cjs) which
 * replicates the same physics in CommonJS without any build-tool dependencies.
 */
@SpringBootTest
class CrossValidationTest {

    @Autowired
    private WebApplicationContext wac;

    private MockMvc mockMvc;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    @Test
    void javaAndJsDropValuesAgreeWithin2cmForAllCatalogBullets() throws Exception {
        for (Bullet bullet : BulletCatalog.load()) {
            TrajectoryRequest req = new TrajectoryRequest(
                bullet.id(), 100, 800, 25, 0, 0, 15, 38.1, null, null, null
            );

            List<Map<String, Object>> javaPoints = fetchJavaPoints(bullet.id(), req);
            List<Map<String, Object>> jsPoints   = fetchJsPoints(bullet, req);

            assertThat(javaPoints).as("Java produced no points for %s", bullet.id()).isNotEmpty();
            assertThat(jsPoints)  .as("JS produced no points for %s",   bullet.id()).isNotEmpty();

            for (Map<String, Object> jp : javaPoints) {
                double range = toDouble(jp.get("rangeMeters"));
                if (range > 800) break;

                double javaDrop = toDouble(jp.get("dropCm"));
                double jsDrop   = findFieldAt(jsPoints, range, "dropCm");
                // JS stops when velocity < 100 fps; Java may produce a few extra
                // points past that threshold — skip rather than fail those points.
                if (Double.isNaN(jsDrop)) continue;

                assertThat(javaDrop)
                    .as("drop at %.0f m disagrees for bullet %s", range, bullet.id())
                    .isCloseTo(jsDrop, within(2.0));
            }
        }
    }

    @Test
    void velocityValuesAgreeWithin3mpsForAllCatalogBullets() throws Exception {
        for (Bullet bullet : BulletCatalog.load()) {
            TrajectoryRequest req = new TrajectoryRequest(
                bullet.id(), 100, 800, 100, 0, 0, 15, 38.1, null, null, null
            );

            List<Map<String, Object>> javaPoints = fetchJavaPoints(bullet.id(), req);
            List<Map<String, Object>> jsPoints   = fetchJsPoints(bullet, req);

            for (Map<String, Object> jp : javaPoints) {
                double range   = toDouble(jp.get("rangeMeters"));
                double javaVel = toDouble(jp.get("velocityMps"));
                double jsVel   = findFieldAt(jsPoints, range, "velocityMps");
                if (Double.isNaN(jsVel)) continue; // JS broke early; skip

                assertThat(javaVel)
                    .as("velocity at %.0f m disagrees for bullet %s", range, bullet.id())
                    .isCloseTo(jsVel, within(3.0));
            }
        }
    }

    @Test
    void eachBulletProducesAtLeast20PointsInBothEngines() throws Exception {
        for (Bullet bullet : BulletCatalog.load()) {
            TrajectoryRequest req = new TrajectoryRequest(
                bullet.id(), 100, 800, 25, 0, 0, 15, 38.1, null, null, null
            );

            List<Map<String, Object>> javaPoints = fetchJavaPoints(bullet.id(), req);
            List<Map<String, Object>> jsPoints   = fetchJsPoints(bullet, req);

            assertThat(javaPoints)
                .as("Java produced < 20 trajectory points for bullet %s", bullet.id())
                .hasSizeGreaterThanOrEqualTo(20);
            assertThat(jsPoints)
                .as("JS produced < 20 trajectory points for bullet %s", bullet.id())
                .hasSizeGreaterThanOrEqualTo(20);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> fetchJavaPoints(String bulletId, TrajectoryRequest req)
            throws Exception {
        String body = mapper.writeValueAsString(Map.of(
            "bulletId",        bulletId,
            "zeroRangeMeters", req.zeroRangeMeters(),
            "maxRangeMeters",  req.maxRangeMeters(),
            "stepMeters",      req.stepMeters(),
            "windSpeedKph",    req.windSpeedKph(),
            "altitudeMeters",  req.altitudeMeters(),
            "temperatureC",    req.temperatureC(),
            "sightHeightMm",   req.sightHeightMm()
        ));

        String responseBody = mockMvc.perform(
                post("/api/trajectory")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();

        Map<?, ?> result = mapper.readValue(responseBody, Map.class);
        return (List<Map<String, Object>>) result.get("points");
    }

    private List<Map<String, Object>> fetchJsPoints(Bullet bullet, TrajectoryRequest req)
            throws Exception {
        Map<String, Object> payload = Map.of(
            "bullet", Map.of(
                "ballisticCoefficient", bullet.ballisticCoefficient(),
                "muzzleVelocityMps",    bullet.muzzleVelocityMps(),
                "bulletWeightGrams",    bullet.bulletWeightGrams()
            ),
            "req", Map.of(
                "zeroRangeMeters", req.zeroRangeMeters(),
                "maxRangeMeters",  req.maxRangeMeters(),
                "stepMeters",      req.stepMeters(),
                "windSpeedKph",    req.windSpeedKph(),
                "altitudeMeters",  req.altitudeMeters(),
                "temperatureC",    req.temperatureC(),
                "sightHeightMm",   req.sightHeightMm()
            )
        );

        ProcessBuilder pb = new ProcessBuilder("node", "src/test/js/cross-validate-runner.cjs");
        pb.directory(new File(System.getProperty("user.dir")));
        pb.redirectErrorStream(false);
        Process process = pb.start();

        process.getOutputStream().write(mapper.writeValueAsBytes(payload));
        process.getOutputStream().close();

        byte[] output = process.getInputStream().readAllBytes();
        int exitCode  = process.waitFor();
        assertThat(exitCode)
            .as("Node cross-validate-runner failed for bullet %s", bullet.id())
            .isEqualTo(0);

        return mapper.readValue(output,
            mapper.getTypeFactory().constructCollectionType(List.class, Map.class));
    }

    private double findFieldAt(List<Map<String, Object>> points, double rangeMeters, String field) {
        return points.stream()
            .filter(p -> Math.abs(toDouble(p.get("rangeMeters")) - rangeMeters) < 0.5)
            .mapToDouble(p -> toDouble(p.get(field)))
            .findFirst()
            .orElse(Double.NaN);
    }

    private static double toDouble(Object v) {
        if (v instanceof Number n) return n.doubleValue();
        return Double.parseDouble(v.toString());
    }
}
