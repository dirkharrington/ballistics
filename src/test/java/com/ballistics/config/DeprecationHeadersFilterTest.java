package com.ballistics.config;

import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.test.context.TestPropertySource;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@ExtendWith(OutputCaptureExtension.class)
@TestPropertySource(properties = "app.ratelimit.enabled=false")
class DeprecationHeadersFilterTest {

    @Autowired WebApplicationContext wac;
    @Autowired MeterRegistry meterRegistry;
    @Autowired DeprecationHeadersFilter deprecationHeadersFilter;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(wac)
            .addFilters(deprecationHeadersFilter)
            .build();
    }

    // ── String-literal checks ─────────────────────────────────────────────────

    @Test
    void sunsetValueHasLeadingZeroInDay() {
        assertThat(DeprecationHeadersFilter.SUNSET_VALUE)
            .isEqualTo("Sat, 01 May 2027 00:00:00 GMT");
    }

    @Test
    void linkValueContainsTemplatePlaceholder() {
        assertThat(DeprecationHeadersFilter.LINK_VALUE)
            .isEqualTo("</api/trajectories/{bulletId}>; rel=\"successor-version\"");
    }

    @Test
    void deprecationValueIsRfc9745Date() {
        assertThat(DeprecationHeadersFilter.DEPRECATION_VALUE).isEqualTo("@1793491200");
    }

    // ── Header presence on deprecated endpoint ────────────────────────────────

    @Test
    void postTrajectoryReturnsAllDeprecationHeaders() throws Exception {
        mvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"bulletId":"308-win-168gr",
                     "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                     "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}"""))
            .andExpect(status().isOk())
            .andExpect(header().string("Deprecation", "@1793491200"))
            .andExpect(header().string("Sunset", "Sat, 01 May 2027 00:00:00 GMT"))
            .andExpect(header().string("Link",
                "</api/trajectories/{bulletId}>; rel=\"successor-version\""));
    }

    @Test
    void postTrajectoryBadRequestAlsoHasDeprecationHeaders() throws Exception {
        mvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"bulletId":"unknown-bullet",
                     "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                     "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}"""))
            .andExpect(header().string("Deprecation", "@1793491200"))
            .andExpect(header().string("Sunset", "Sat, 01 May 2027 00:00:00 GMT"))
            .andExpect(header().string("Link",
                "</api/trajectories/{bulletId}>; rel=\"successor-version\""));
    }

    // ── No headers on other endpoints ─────────────────────────────────────────

    @Test
    void postTrajectoriesByIdDoesNotGetDeprecationHeaders() throws Exception {
        mvc.perform(post("/api/trajectories/308-win-168gr")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                     "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}"""))
            .andExpect(status().isOk())
            .andExpect(header().doesNotExist("Deprecation"))
            .andExpect(header().doesNotExist("Sunset"))
            .andExpect(header().doesNotExist("Link"));
    }

    @Test
    void getBulletsDoesNotGetDeprecationHeaders() throws Exception {
        mvc.perform(get("/api/bullets"))
            .andExpect(header().doesNotExist("Deprecation"));
    }

    // ── Startup WARN ──────────────────────────────────────────────────────────

    @Test
    void startupWarnEmittedExactlyOnce(CapturedOutput output) {
        // Fire the event listener directly so CapturedOutput captures it in this test
        deprecationHeadersFilter.warnOnDeprecation();
        assertThat(output.toString())
            .contains("POST /api/trajectory is deprecated and will be removed on 2027-05-01.");
    }

    // ── Counter ───────────────────────────────────────────────────────────────

    @Test
    void deprecatedRequestsCounterIncrementsOnEachCall() throws Exception {
        double before = meterRegistry.counter("ballistics.api.deprecated.requests",
            "endpoint", "/api/trajectory").count();

        mvc.perform(post("/api/trajectory")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"bulletId":"308-win-168gr",
                     "zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                     "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}"""));

        double after = meterRegistry.counter("ballistics.api.deprecated.requests",
            "endpoint", "/api/trajectory").count();

        assertThat(after).isEqualTo(before + 1.0);
    }
}
