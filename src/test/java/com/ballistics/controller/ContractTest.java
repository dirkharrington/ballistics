package com.ballistics.controller;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
class ContractTest {

    @Autowired WebApplicationContext wac;
    @Autowired ObjectMapper mapper;
    private MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

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
