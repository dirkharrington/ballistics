package com.ballistics.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
class BallisticsControllerTest {

    @Autowired WebApplicationContext wac;
    private MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    // ── GET /api/bullets ──────────────────────────────────────────────────────

    @Test
    void getBulletsReturns200WithFourBullets() throws Exception {
        mockMvc.perform(get("/api/bullets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(4)))
            .andExpect(jsonPath("$[0].id", notNullValue()))
            .andExpect(jsonPath("$[0].name", notNullValue()))
            .andExpect(jsonPath("$[0].ballisticCoefficient", greaterThan(0.0)));
    }

    @Test
    void getBulletsContainsExpectedIds() throws Exception {
        mockMvc.perform(get("/api/bullets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[*].id", hasItems(
                "223-rem-55gr", "308-win-168gr", "3006-150gr", "65-creedmoor-140gr"
            )));
    }

    // ── POST /api/trajectory ──────────────────────────────────────────────────

    @Test
    void computeTrajectoryWithValidBullet() throws Exception {
        String body = """
            {
              "bulletId": "308-win-168gr",
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 50,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

        mockMvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.bullet.id", is("308-win-168gr")))
            .andExpect(jsonPath("$.points", not(empty())))
            .andExpect(jsonPath("$.supersonicLimitMeters", greaterThan(0.0)))
            .andExpect(jsonPath("$.maxOrdinateCm", greaterThanOrEqualTo(0.0)));
    }

    @Test
    void computeTrajectoryWithWindAndAltitude() throws Exception {
        String body = """
            {
              "bulletId": "65-creedmoor-140gr",
              "zeroRangeMeters": 100,
              "maxRangeMeters": 1000,
              "stepMeters": 100,
              "windSpeedKph": 16,
              "altitudeMeters": 1000,
              "temperatureC": 20
            }
            """;

        mockMvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.bullet.id", is("65-creedmoor-140gr")))
            .andExpect(jsonPath("$.points", not(empty())))
            .andExpect(jsonPath("$.maxOrdinateCm", greaterThanOrEqualTo(0.0)));
    }

    @Test
    void computeTrajectoryWithInvalidBulletIdReturns400() throws Exception {
        String body = """
            {
              "bulletId": "nonexistent-bullet-xyz",
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 25,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

        mockMvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest());
    }

    @Test
    void computeTrajectoryWithExplicitDefaults() throws Exception {
        String body = """
            {
              "bulletId": "223-rem-55gr",
              "zeroRangeMeters": 100,
              "maxRangeMeters": 1000,
              "stepMeters": 25,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

        mockMvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.points", hasSize(greaterThan(20))));
    }

    // ── POST /api/trajectories/compare ───────────────────────────────────────

    @Test
    void compareTrajectories_allValidIds() throws Exception {
        String body = """
            {
              "bulletIds": ["223-rem-55gr", "308-win-168gr"],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

        mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(2)))
            .andExpect(jsonPath("$[0].bullet.id", notNullValue()))
            .andExpect(jsonPath("$[1].bullet.id", notNullValue()));
    }

    @Test
    void compareTrajectories_allFourBullets() throws Exception {
        String body = """
            {
              "bulletIds": ["223-rem-55gr", "308-win-168gr", "3006-150gr", "65-creedmoor-140gr"],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

        mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(4)));
    }

    @Test
    void compareTrajectories_filtersOutInvalidIds() throws Exception {
        String body = """
            {
              "bulletIds": ["308-win-168gr", "invalid-id-xyz"],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

        mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].bullet.id", is("308-win-168gr")));
    }

    @Test
    void compareTrajectories_allInvalidIds_returnsEmptyList() throws Exception {
        String body = """
            {
              "bulletIds": ["bad-1", "bad-2"],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

        mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", empty()));
    }

    @Test
    void compareTrajectories_emptyBulletList_returnsEmptyList() throws Exception {
        String body = """
            {
              "bulletIds": [],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

        mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", empty()));
    }
}
