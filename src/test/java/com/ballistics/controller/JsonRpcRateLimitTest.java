package com.ballistics.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Rate-limit tests for JsonRpcController.
 * Each tier uses capacity=2 so tests drain buckets quickly.
 * Each test uses a distinct remoteAddr to avoid cross-test bucket sharing.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestPropertySource(properties = {
    "app.ratelimit.enabled=true",
    "app.ratelimit.period=1m",
    "app.ratelimit.single.capacity=2",
    "app.ratelimit.single.global-capacity=200",
    "app.ratelimit.compare.capacity=2",
    "app.ratelimit.compare.global-capacity=200",
    "app.ratelimit.batch.capacity=2",
    "app.ratelimit.batch.global-capacity=200",
    "app.ratelimit.client-cache.expire-after-access=2m"
})
class JsonRpcRateLimitTest {

    @Autowired WebApplicationContext wac;
    private MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    // ── SINGLE tier ───────────────────────────────────────────────────────────

    @Test
    void singleTier_exceedsCapacity_returns32002() throws Exception {
        String ip = "10.0.1.1";
        String request = """
            {
              "jsonrpc":"2.0",
              "method":"trajectory.compute",
              "params":{
                "bulletId":"308-win-168gr",
                "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15
              },
              "id":"r1"
            }""";

        // Drain capacity=2 bucket
        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/rpc")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(request)
                    .with(req -> { req.setRemoteAddr(ip); return req; }))
                .andReturn();
        }
        // Third call must be rate limited
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content(request)
                .with(req -> { req.setRemoteAddr(ip); return req; }))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32002))
            .andExpect(jsonPath("$.error.message").value("Rate limit exceeded"))
            .andExpect(jsonPath("$.error.data.retryAfterSeconds").isNumber());
    }

    // ── COMPARE tier ──────────────────────────────────────────────────────────

    @Test
    void compareTier_exceedsCapacity_returns32002() throws Exception {
        String ip = "10.0.2.1";
        String request = """
            {
              "jsonrpc":"2.0",
              "method":"trajectory.compare",
              "params":{
                "bulletIds":["308-win-168gr"],
                "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15
              },
              "id":"cmp"
            }""";

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/rpc")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(request)
                    .with(req -> { req.setRemoteAddr(ip); return req; }))
                .andReturn();
        }
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content(request)
                .with(req -> { req.setRemoteAddr(ip); return req; }))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32002));
    }

    // ── BATCH tier ────────────────────────────────────────────────────────────

    @Test
    void batchTier_exceedsCapacity_returns32002() throws Exception {
        String ip = "10.0.3.1";
        String request = """
            {
              "jsonrpc":"2.0",
              "method":"trajectory.batch",
              "params":{
                "requests":[{
                  "bulletId":"308-win-168gr",
                  "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                  "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15
                }]
              },
              "id":"bt"
            }""";

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/rpc")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(request)
                    .with(req -> { req.setRemoteAddr(ip); return req; }))
                .andReturn();
        }
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content(request)
                .with(req -> { req.setRemoteAddr(ip); return req; }))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32002));
    }

    // ── Rate-limited notification returns no body ─────────────────────────────

    @Test
    void rateLimited_notification_returnsNoBody() throws Exception {
        String ip = "10.0.4.1";
        // Use trajectory.compute notification (SINGLE tier)
        String request = """
            {
              "jsonrpc":"2.0",
              "method":"trajectory.compute",
              "params":{
                "bulletId":"308-win-168gr",
                "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15
              }
            }""";

        // Drain SINGLE bucket first with ID requests
        String requestWithId = """
            {
              "jsonrpc":"2.0",
              "method":"trajectory.compute",
              "params":{
                "bulletId":"308-win-168gr",
                "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15
              },
              "id":"drain"
            }""";
        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/rpc")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestWithId)
                    .with(req -> { req.setRemoteAddr(ip); return req; }))
                .andReturn();
        }

        // Notification after rate limit is drained — no response body
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content(request)
                .with(req -> { req.setRemoteAddr(ip); return req; }))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }
}
