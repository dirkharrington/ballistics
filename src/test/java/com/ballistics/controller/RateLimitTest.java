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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Verifies per-client rate limiting.
 *
 * <p>Uses small capacities (SINGLE=2, COMPARE=2, BATCH=2) with large global ceilings
 * so tests drain their buckets quickly without interfering via the global bucket.
 * Each test sets a distinct {@code remoteAddr} so clients don't share buckets.</p>
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
class RateLimitTest {

    @Autowired WebApplicationContext wac;
    private MockMvc mvc;

    private static final String TRAJECTORY_BODY = """
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

    private static final String TRAJECTORY_BY_ID_BODY = """
            {
              "zeroRangeMeters": 100,
              "maxRangeMeters": 500,
              "stepMeters": 50,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

    private static final String COMPARE_BODY = """
            {
              "bulletIds": ["308-win-168gr"],
              "zeroRangeMeters": 100,
              "maxRangeMeters": 100,
              "stepMeters": 50,
              "windSpeedKph": 0,
              "altitudeMeters": 0,
              "temperatureC": 15
            }
            """;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(wac).build();
    }

    // ── single-bucket tests ───────────────────────────────────────────────────

    @Test
    void trajectoryReturns429WhenSingleBucketExhausted() throws Exception {
        // client ip 1.2.3.1: drain single bucket (capacity=2), 3rd request → 429
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectory")
                    .with(r -> { r.setRemoteAddr("1.2.3.1"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(TRAJECTORY_BODY))
                .andExpect(status().isOk());
        }
        mvc.perform(post("/api/trajectory")
                .with(r -> { r.setRemoteAddr("1.2.3.1"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BODY))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void trajectoryByIdReturns429WhenSingleBucketExhausted() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectories/308-win-168gr")
                    .with(r -> { r.setRemoteAddr("1.2.3.2"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(TRAJECTORY_BY_ID_BODY))
                .andExpect(status().isOk());
        }
        mvc.perform(post("/api/trajectories/308-win-168gr")
                .with(r -> { r.setRemoteAddr("1.2.3.2"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BY_ID_BODY))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void compareBucketIsIndependentOfSingleBucket() throws Exception {
        // Drain single bucket for a specific client
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectory")
                    .with(r -> { r.setRemoteAddr("1.2.3.3"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(TRAJECTORY_BODY))
                .andExpect(status().isOk());
        }
        // Single bucket exhausted but compare bucket for THIS client is still full
        mvc.perform(post("/api/trajectories/compare")
                .with(r -> { r.setRemoteAddr("1.2.3.3"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(COMPARE_BODY))
            .andExpect(status().isOk());
    }

    // ── compare bucket tests ──────────────────────────────────────────────────

    @Test
    void compareReturns429WhenCompareBucketExhausted() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectories/compare")
                    .with(r -> { r.setRemoteAddr("1.2.3.4"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(COMPARE_BODY))
                .andExpect(status().isOk());
        }
        mvc.perform(post("/api/trajectories/compare")
                .with(r -> { r.setRemoteAddr("1.2.3.4"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(COMPARE_BODY))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void singleBucketIsIndependentOfCompareBucket() throws Exception {
        // Drain compare bucket for client 1.2.3.5
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectories/compare")
                    .with(r -> { r.setRemoteAddr("1.2.3.5"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(COMPARE_BODY))
                .andExpect(status().isOk());
        }
        // Compare exhausted but single still fine for this client
        mvc.perform(post("/api/trajectory")
                .with(r -> { r.setRemoteAddr("1.2.3.5"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BODY))
            .andExpect(status().isOk());
    }

    // ── Retry-After header ────────────────────────────────────────────────────

    @Test
    void trajectoryReturns429WithRetryAfterHeader() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectory")
                    .with(r -> { r.setRemoteAddr("1.2.3.6"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(TRAJECTORY_BODY))
                .andExpect(status().isOk());
        }
        mvc.perform(post("/api/trajectory")
                .with(r -> { r.setRemoteAddr("1.2.3.6"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BODY))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().exists("Retry-After"));
    }

    @Test
    void compareReturns429WithRetryAfterHeader() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectories/compare")
                    .with(r -> { r.setRemoteAddr("1.2.3.7"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(COMPARE_BODY))
                .andExpect(status().isOk());
        }
        mvc.perform(post("/api/trajectories/compare")
                .with(r -> { r.setRemoteAddr("1.2.3.7"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(COMPARE_BODY))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().exists("Retry-After"));
    }

    @Test
    void compareStreamReturns429WhenCompareBucketExhausted() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectories/compare/stream")
                    .with(r -> { r.setRemoteAddr("1.2.3.8"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(COMPARE_BODY));
        }
        mvc.perform(post("/api/trajectories/compare/stream")
                .with(r -> { r.setRemoteAddr("1.2.3.8"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(COMPARE_BODY))
            .andExpect(status().isTooManyRequests());
    }

    // ── Different clients get independent buckets ─────────────────────────────

    @Test
    void differentClientsGetIndependentBuckets() throws Exception {
        // Drain client A's single bucket
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/trajectory")
                    .with(r -> { r.setRemoteAddr("1.2.3.9"); return r; })
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(TRAJECTORY_BODY))
                .andExpect(status().isOk());
        }
        mvc.perform(post("/api/trajectory")
                .with(r -> { r.setRemoteAddr("1.2.3.9"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BODY))
            .andExpect(status().isTooManyRequests());

        // Client B's bucket is untouched
        mvc.perform(post("/api/trajectory")
                .with(r -> { r.setRemoteAddr("1.2.3.10"); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BODY))
            .andExpect(status().isOk());
    }

    // ── GET /api/bullets is not rate-limited ──────────────────────────────────

    @Test
    void listBulletsIsNotRateLimited() throws Exception {
        // Make many requests from a fresh client; none should be rate-limited
        for (int i = 0; i < 10; i++) {
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/bullets")
                    .with(r -> { r.setRemoteAddr("1.2.3.11"); return r; }))
                .andExpect(status().isOk());
        }
    }
}
