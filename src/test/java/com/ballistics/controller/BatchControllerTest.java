package com.ballistics.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class BatchControllerTest {

    @Autowired WebApplicationContext wac;
    private MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    @Test
    void validBatchWithTwoKnownBulletsReturnsResults() throws Exception {
        String body = """
            {
              "requests": [
                {
                  "bulletId": "308-win-168gr",
                  "zeroRangeMeters": 100, "maxRangeMeters": 300, "stepMeters": 100,
                  "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15
                },
                {
                  "bulletId": "65-creedmoor-140gr",
                  "zeroRangeMeters": 100, "maxRangeMeters": 300, "stepMeters": 100,
                  "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15
                }
              ]
            }
            """;

        mockMvc.perform(post("/api/trajectories/batch")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(2)))
            .andExpect(jsonPath("$[0].bullet.id", is("308-win-168gr")))
            .andExpect(jsonPath("$[1].bullet.id", is("65-creedmoor-140gr")))
            .andExpect(jsonPath("$[0].points", not(empty())));
    }

    @Test
    void emptyRequestsListReturns400() throws Exception {
        mockMvc.perform(post("/api/trajectories/batch")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    { "requests": [] }
                    """))
            .andExpect(status().isBadRequest());
    }

    @Test
    void moreThan20RequestsReturns400() throws Exception {
        String entry = """
            {
              "bulletId": "308-win-168gr",
              "zeroRangeMeters": 100, "maxRangeMeters": 200, "stepMeters": 100,
              "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15
            }
            """;
        String requests = String.join(",", java.util.Collections.nCopies(21, entry));

        mockMvc.perform(post("/api/trajectories/batch")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{ \"requests\": [" + requests + "] }"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void unknownBulletIdReturns400() throws Exception {
        mockMvc.perform(post("/api/trajectories/batch")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "requests": [{
                        "bulletId": "unknown-bullet-xyz",
                        "zeroRangeMeters": 100, "maxRangeMeters": 300, "stepMeters": 100,
                        "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15
                      }]
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.detail", containsString("unknown-bullet-xyz")));
    }

    @Test
    @Order(Integer.MAX_VALUE)
    void rateLimitReturnsTooManyRequests() throws Exception {
        String body = """
            {
              "requests": [{
                "bulletId": "308-win-168gr",
                "zeroRangeMeters": 100, "maxRangeMeters": 200, "stepMeters": 100,
                "windSpeedKph": 0, "altitudeMeters": 0, "temperatureC": 15
              }]
            }
            """;

        boolean got429 = false;
        for (int i = 0; i < 12; i++) {
            var result = mockMvc.perform(post("/api/trajectories/batch")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body))
                .andReturn();
            if (result.getResponse().getStatus() == 429) {
                got429 = true;
                break;
            }
        }
        org.assertj.core.api.Assertions.assertThat(got429)
            .as("Expected 429 after exceeding batch rate limit").isTrue();
    }
}
