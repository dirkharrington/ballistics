package com.ballistics.controller;

import io.github.bucket4j.Bucket;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.lang.reflect.Field;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies that both single-bullet and compare endpoints enforce their
 * respective rate limits and that the two buckets are independent.
 *
 * <p>Each test drains a bucket via reflection to avoid making 120+ real
 * requests. {@code @DirtiesContext} ensures the drained bucket is discarded
 * after this class so other test classes see a full bucket.</p>
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
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

    @org.junit.jupiter.api.AfterEach
    void resetBuckets() throws Exception {
        // Restore both buckets to full capacity between tests so they don't
        // interfere with each other. addTokens() won't exceed configured max.
        refillBucket("singleBucket",  120);
        refillBucket("compareBucket",  30);
    }

    // ── single-bullet bucket ─────────────────────────────────────────────────

    @Test
    void trajectoryReturns429WhenSingleBucketExhausted() throws Exception {
        drainBucket("singleBucket");

        mvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BODY))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void trajectoryByIdReturns429WhenSingleBucketExhausted() throws Exception {
        drainBucket("singleBucket");

        mvc.perform(post("/api/trajectories/308-win-168gr")
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BY_ID_BODY))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void compareBucketIsIndependentOfSingleBucket() throws Exception {
        // Exhausting the single-bullet bucket must not affect the compare bucket
        drainBucket("singleBucket");

        mvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(COMPARE_BODY))
            .andExpect(status().isOk());
    }

    // ── compare bucket ───────────────────────────────────────────────────────

    @Test
    void compareReturns429WhenCompareBucketExhausted() throws Exception {
        drainBucket("compareBucket");

        mvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(COMPARE_BODY))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void singleBucketIsIndependentOfCompareBucket() throws Exception {
        // Exhausting the compare bucket must not affect the single-bullet bucket
        drainBucket("compareBucket");

        mvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BODY))
            .andExpect(status().isOk());
    }

    // ── Retry-After header ───────────────────────────────────────────────────

    @Test
    void trajectoryReturns429WithRetryAfterHeader() throws Exception {
        drainBucket("singleBucket");

        mvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content(TRAJECTORY_BODY))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().string("Retry-After", "60"));
    }

    @Test
    void compareReturns429WithRetryAfterHeader() throws Exception {
        drainBucket("compareBucket");

        mvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(COMPARE_BODY))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().string("Retry-After", "60"));
    }

    @Test
    void compareStreamReturns429WhenCompareBucketExhausted() throws Exception {
        // /compare/stream shares the compareBucket — draining it must block the stream endpoint too
        drainBucket("compareBucket");

        mvc.perform(post("/api/trajectories/compare/stream")
                .contentType(MediaType.APPLICATION_JSON)
                .content(COMPARE_BODY))
            .andExpect(status().isTooManyRequests());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void drainBucket(String fieldName) throws Exception {
        getBucket(fieldName).tryConsumeAsMuchAsPossible();
    }

    private void refillBucket(String fieldName, long capacity) throws Exception {
        getBucket(fieldName).addTokens(capacity);
    }

    private Bucket getBucket(String fieldName) throws Exception {
        BallisticsController ctrl = wac.getBean(BallisticsController.class);
        Field f = BallisticsController.class.getDeclaredField(fieldName);
        f.setAccessible(true);
        return (Bucket) f.get(ctrl);
    }
}
