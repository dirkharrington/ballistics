package com.ballistics.controller;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@TestPropertySource(properties = "app.ratelimit.enabled=false")
class ContractTest {

    @Autowired WebApplicationContext wac;
    @Autowired ObjectMapper mapper;
    private MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    // ── BE-3: parity — /compare with new fields equals direct /trajectories/{id} ──

    @Test
    void compareWithDragModelG7MatchesDirectEndpoint() throws Exception {
        String bulletId = "308-win-168gr";
        String singleBody = """
            {
              "bulletId": "%s",
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 8,
              "altitudeMeters": 500,
              "temperatureC": 10,
              "dragModel": "G7",
              "shootingAngleDegrees": 10
            }
            """.formatted(bulletId);

        String compareBody = """
            {
              "bulletIds": ["%s"],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 8,
              "altitudeMeters": 500,
              "temperatureC": 10,
              "dragModel": "G7",
              "shootingAngleDegrees": 10
            }
            """.formatted(bulletId);

        String singleJson = mockMvc.perform(post("/api/trajectories/" + bulletId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(singleBody))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        String compareJson = mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(compareBody))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        tools.jackson.databind.JsonNode singleResult  = mapper.readTree(singleJson);
        tools.jackson.databind.JsonNode compareResult = mapper.readTree(compareJson);
        assertThat(compareResult.isArray()).isTrue();
        assertThat(compareResult.size()).isEqualTo(1);
        assertThat(compareResult.get(0)).isEqualTo(singleResult);
    }

    @Test
    void compareWithSightHeightAndWindDirMatchesDirectEndpoint() throws Exception {
        String bulletId = "223-rem-55gr";
        String singleBody = """
            {
              "bulletId": "%s",
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 5,
              "altitudeMeters": 0,
              "temperatureC": 15,
              "sightHeightMm": 50,
              "windDirectionDeg": 270
            }
            """.formatted(bulletId);

        String compareBody = """
            {
              "bulletIds": ["%s"],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 5,
              "altitudeMeters": 0,
              "temperatureC": 15,
              "sightHeightMm": 50,
              "windDirectionDeg": 270
            }
            """.formatted(bulletId);

        String singleJson = mockMvc.perform(post("/api/trajectories/" + bulletId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(singleBody))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        String compareJson = mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(compareBody))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        tools.jackson.databind.JsonNode singleResult  = mapper.readTree(singleJson);
        tools.jackson.databind.JsonNode compareResult = mapper.readTree(compareJson);
        assertThat(compareResult.isArray()).isTrue();
        assertThat(compareResult.get(0)).isEqualTo(singleResult);
    }

    @Test
    void compareOmittingNewFieldsProducesSameResultAsExplicitDefaults() throws Exception {
        String bulletId = "308-win-168gr";
        String withDefaults = """
            {
              "bulletIds": ["%s"],
              "zeroRangeMeters": 100, "maxRangeMeters": 500, "stepMeters": 100,
              "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15,
              "sightHeightMm": 38.1, "shootingAngleDegrees": 0,
              "windDirectionDeg": 90, "dragModel": "G1"
            }
            """.formatted(bulletId);

        String withoutNewFields = """
            {
              "bulletIds": ["%s"],
              "zeroRangeMeters": 100, "maxRangeMeters": 500, "stepMeters": 100,
              "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15
            }
            """.formatted(bulletId);

        String jsonWithDefaults = mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(withDefaults))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        String jsonWithout = mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(withoutNewFields))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        assertThat(mapper.readTree(jsonWithDefaults)).isEqualTo(mapper.readTree(jsonWithout));
    }

    @Test
    void g7VsG1GivesDifferentDropAtMaxRange() throws Exception {
        String bulletId = "308-win-168gr";
        String g1Body = """
            {
              "bulletIds": ["%s"],
              "zeroRangeMeters": 100, "maxRangeMeters": 1000, "stepMeters": 500,
              "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15,
              "dragModel": "G1"
            }
            """.formatted(bulletId);

        String g7Body = g1Body.replace("\"G1\"", "\"G7\"");

        tools.jackson.databind.JsonNode g1 = mapper.readTree(
            mockMvc.perform(post("/api/trajectories/compare")
                    .contentType(MediaType.APPLICATION_JSON).content(g1Body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());

        tools.jackson.databind.JsonNode g7 = mapper.readTree(
            mockMvc.perform(post("/api/trajectories/compare")
                    .contentType(MediaType.APPLICATION_JSON).content(g7Body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());

        // Different drag models must produce different results at max range
        assertThat(g1.get(0)).isNotEqualTo(g7.get(0));
    }

    // ── BE-3: compare/stream parity ───────────────────────────────────────────

    @Test
    void compareStreamWithNewFieldsMatchesCompareEndpoint() throws Exception {
        String bulletId = "65-creedmoor-140gr";
        String body = """
            {
              "bulletIds": ["%s"],
              "zeroRangeMeters": 100, "maxRangeMeters": 500, "stepMeters": 100,
              "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15,
              "dragModel": "G7", "shootingAngleDegrees": 5
            }
            """.formatted(bulletId);

        String compareJson = mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        MvcResult streamMvcResult = mockMvc.perform(post("/api/trajectories/compare/stream")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(request().asyncStarted())
            .andReturn();
        streamMvcResult.getAsyncResult(5_000);
        mockMvc.perform(asyncDispatch(streamMvcResult)).andExpect(status().isOk());

        String streamResponse = streamMvcResult.getResponse().getContentAsString();

        // Collect all data: lines into one JSON string (the emitter sends one result)
        String sseData = streamResponse.lines()
            .filter(l -> l.startsWith("data:"))
            .map(l -> l.substring("data:".length()))
            .collect(java.util.stream.Collectors.joining());

        tools.jackson.databind.JsonNode compareResult = mapper.readTree(compareJson);
        tools.jackson.databind.JsonNode streamResult  = mapper.readTree(sseData);

        assertThat(compareResult.isArray()).isTrue();
        assertThat(compareResult.get(0)).isEqualTo(streamResult);
    }

    // ── original parity tests ────────────────────────────────────────────────

    @ParameterizedTest
    @ValueSource(strings = {"223-rem-55gr", "308-win-168gr", "65-creedmoor-140gr"})
    void compareResultMatchesSingleTrajectoryForEachBullet(String bulletId) throws Exception {
        String singleBody = """
            {
              "bulletId": "%s",
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 8,
              "altitudeMeters": 500,
              "temperatureC": 10
            }
            """.formatted(bulletId);

        String compareBody = """
            {
              "bulletIds": ["%s"],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 100,
              "windSpeedKph": 8,
              "altitudeMeters": 500,
              "temperatureC": 10
            }
            """.formatted(bulletId);

        String singleJson = mockMvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(singleBody))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        String compareJson = mockMvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(compareBody))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        JsonNode singleResult  = mapper.readTree(singleJson);
        JsonNode compareResult = mapper.readTree(compareJson);

        assertThat(compareResult.isArray()).isTrue();
        assertThat(compareResult.size()).isEqualTo(1);
        assertThat(compareResult.get(0)).isEqualTo(singleResult);
    }
}
