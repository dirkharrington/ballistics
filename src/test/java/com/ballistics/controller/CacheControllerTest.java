package com.ballistics.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
class CacheControllerTest {

    @Autowired WebApplicationContext wac;
    private MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    @Test
    void cacheStatsEndpointReturns200WithExpectedFields() throws Exception {
        mockMvc.perform(get("/api/cache/stats"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.estimatedSize", greaterThanOrEqualTo(0)))
            .andExpect(jsonPath("$.hitCount",      greaterThanOrEqualTo(0)))
            .andExpect(jsonPath("$.missCount",     greaterThanOrEqualTo(0)))
            .andExpect(jsonPath("$.hitRate",       greaterThanOrEqualTo(0.0)))
            .andExpect(jsonPath("$.loadCount",     greaterThanOrEqualTo(0)));
    }
}
