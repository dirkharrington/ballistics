package com.ballistics.controller;

import com.ballistics.service.TrajectoryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Covers the -32603 Internal Error path by injecting a TrajectoryService that
 * throws an unexpected RuntimeException, exercising the catch(Exception e) branch.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestPropertySource(properties = "app.ratelimit.enabled=false")
class JsonRpcInternalErrorTest {

    @MockitoBean
    TrajectoryService trajectoryService;

    @Autowired WebApplicationContext wac;
    private MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
        when(trajectoryService.listBullets()).thenThrow(new RuntimeException("simulated unexpected failure"));
    }

    @Test
    void internalError_returns32603() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":\"ie1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32603))
            .andExpect(jsonPath("$.error.message").value("Internal error"))
            .andExpect(jsonPath("$.id").value("ie1"));
    }

    @Test
    void internalError_notification_returnsNoBody() throws Exception {
        // Notification with internal error still produces no response
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\"}"))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }
}
