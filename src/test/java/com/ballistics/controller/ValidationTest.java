package com.ballistics.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

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

    @Test
    void negativeWindReturns400WithProblemDetail() throws Exception {
        mvc.perform(post("/api/trajectories/223-rem-55gr")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"zeroRangeMeters":100,"maxRangeMeters":1000,"stepMeters":25,
                     "windSpeedKph":-5,"altitudeMeters":0,"temperatureC":15}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    void temperatureTooHighReturns400() throws Exception {
        mvc.perform(post("/api/trajectories/223-rem-55gr")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"zeroRangeMeters":100,"maxRangeMeters":1000,"stepMeters":25,
                     "windSpeedKph":0,"altitudeMeters":0,"temperatureC":100}
                    """))
            .andExpect(status().isBadRequest());
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
