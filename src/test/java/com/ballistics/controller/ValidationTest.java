package com.ballistics.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.stream.Stream;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.params.provider.Arguments.arguments;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
class ValidationTest {

    @Autowired WebApplicationContext wac;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    // ── TrajectoryRequest constraints ─────────────────────────────────────────

    static Stream<Arguments> trajectoryConstraintViolations() {
        final String base = """
            {"bulletId":"308-win-168gr",
             "zeroRangeMeters":100,"maxRangeMeters":1000,"stepMeters":25,
             "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}""";
        return Stream.of(
            arguments("sightHeightMm @Max(150) — 151 rejected",
                base.replace("\"temperatureC\":15}", "\"temperatureC\":15,\"sightHeightMm\":151}"),
                "sightHeightMm"),
            arguments("zeroRangeMeters @Max(3000) — 3001 rejected",
                base.replace("\"zeroRangeMeters\":100", "\"zeroRangeMeters\":3001"),
                "zeroRangeMeters"),
            arguments("maxRangeMeters @Max(5000) — 5001 rejected",
                base.replace("\"maxRangeMeters\":1000", "\"maxRangeMeters\":5001"),
                "maxRangeMeters"),
            arguments("stepMeters @Max(500) — 501 rejected",
                base.replace("\"stepMeters\":25", "\"stepMeters\":501"),
                "stepMeters"),
            arguments("shootingAngleDegrees @Max(45) — 50 rejected",
                base.replace("\"temperatureC\":15}", "\"temperatureC\":15,\"shootingAngleDegrees\":50}"),
                "shootingAngleDegrees"),
            arguments("shootingAngleDegrees @Min(-45) — -50 rejected",
                base.replace("\"temperatureC\":15}", "\"temperatureC\":15,\"shootingAngleDegrees\":-50}"),
                "shootingAngleDegrees")
        );
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("trajectoryConstraintViolations")
    void trajectoryConstraintReturns400WithFieldInDetail(String desc, String body, String field)
            throws Exception {
        mvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail", containsString(field)));
    }

    // ── CompareRequest constraints ─────────────────────────────────────────────

    static Stream<Arguments> compareConstraintViolations() {
        final String base = """
            {"bulletIds":["308-win-168gr"],
             "zeroRangeMeters":100,"maxRangeMeters":1000,"stepMeters":25,
             "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}""";
        return Stream.of(
            arguments("zeroRangeMeters @Max(3000) — 3001 rejected",
                base.replace("\"zeroRangeMeters\":100", "\"zeroRangeMeters\":3001"),
                "zeroRangeMeters"),
            arguments("maxRangeMeters @Max(5000) — 5001 rejected",
                base.replace("\"maxRangeMeters\":1000", "\"maxRangeMeters\":5001"),
                "maxRangeMeters"),
            arguments("stepMeters @Max(500) — 501 rejected",
                base.replace("\"stepMeters\":25", "\"stepMeters\":501"),
                "stepMeters"),
            arguments("temperatureC @Min(-50) — -51 rejected",
                base.replace("\"temperatureC\":15", "\"temperatureC\":-51"),
                "temperatureC")
        );
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("compareConstraintViolations")
    void compareConstraintReturns400WithFieldInDetail(String desc, String body, String field)
            throws Exception {
        mvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail", containsString(field)));
    }

    // ── CustomBulletRequest constraints ────────────────────────────────────────

    static Stream<Arguments> customConstraintViolations() {
        final String base = """
            {"name":"Test Load",
             "bulletWeightGrams":10.89,"muzzleVelocityMps":807,
             "ballisticCoefficient":0.475,"bulletDiameterMm":7.82,
             "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":25,
             "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}""";
        return Stream.of(
            arguments("name @NotBlank — blank rejected",
                base.replace("\"name\":\"Test Load\"", "\"name\":\"\""),
                "name"),
            arguments("bulletWeightGrams @DecimalMax(30) — 31 rejected",
                base.replace("\"bulletWeightGrams\":10.89", "\"bulletWeightGrams\":31"),
                "bulletWeightGrams"),
            arguments("muzzleVelocityMps @Max(2000) — 2001 rejected",
                base.replace("\"muzzleVelocityMps\":807", "\"muzzleVelocityMps\":2001"),
                "muzzleVelocityMps"),
            arguments("ballisticCoefficient @DecimalMax(1.2) — 1.3 rejected",
                base.replace("\"ballisticCoefficient\":0.475", "\"ballisticCoefficient\":1.3"),
                "ballisticCoefficient"),
            arguments("bulletDiameterMm @DecimalMax(25) — 26 rejected",
                base.replace("\"bulletDiameterMm\":7.82", "\"bulletDiameterMm\":26"),
                "bulletDiameterMm")
        );
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("customConstraintViolations")
    void customConstraintReturns400WithFieldInDetail(String desc, String body, String field)
            throws Exception {
        mvc.perform(post("/api/trajectories/custom")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail", containsString(field)));
    }

    // ── Pre-existing tests ────────────────────────────────────────────────────

    @Test
    void negativeWindReturns400WithProblemDetail() throws Exception {
        mvc.perform(post("/api/trajectories/223-rem-55gr")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"zeroRangeMeters":100,"maxRangeMeters":1000,"stepMeters":25,
                     "windSpeedKph":-5,"altitudeMeters":0,"temperatureC":15}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail", containsString("windSpeedKph")));
    }

    @Test
    void temperatureTooHighReturns400WithFieldInDetail() throws Exception {
        mvc.perform(post("/api/trajectories/223-rem-55gr")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"zeroRangeMeters":100,"maxRangeMeters":1000,"stepMeters":25,
                     "windSpeedKph":0,"altitudeMeters":0,"temperatureC":100}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail", containsString("temperatureC")));
    }

    @Test
    void validRequestReturns200() throws Exception {
        mvc.perform(post("/api/trajectories/223-rem-55gr")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"zeroRangeMeters":100,"maxRangeMeters":1000,"stepMeters":25,
                     "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}
                    """))
            .andExpect(status().isOk());
    }
}
