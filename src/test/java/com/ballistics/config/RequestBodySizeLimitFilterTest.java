package com.ballistics.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@TestPropertySource(properties = "app.ratelimit.enabled=false")
class RequestBodySizeLimitFilterTest {

    @Autowired WebApplicationContext wac;
    @Autowired ObjectMapper objectMapper;
    @Autowired RequestBodySizeLimitFilter requestBodySizeLimitFilter;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(wac)
            .addFilters(requestBodySizeLimitFilter)
            .build();
    }

    // ── shouldNotFilter: path/method routing ─────────────────────────────────

    @Test
    void shouldNotFilterReturnsTrueForNonApiPath() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(65536);
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/actuator/health");
        assertThat(filter.shouldNotFilter(req)).isTrue();
    }

    @Test
    void shouldNotFilterReturnsTrueForGetToApi() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(65536);
        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("GET", "/api/bullets"))).isTrue();
    }

    @Test
    void shouldNotFilterReturnsTrueForHeadToApi() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(65536);
        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("HEAD", "/api/bullets"))).isTrue();
    }

    @Test
    void shouldNotFilterReturnsTrueForOptionsToApi() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(65536);
        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("OPTIONS", "/api/bullets"))).isTrue();
    }

    @Test
    void shouldNotFilterReturnsTrueForTraceToApi() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(65536);
        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("TRACE", "/api/trajectory"))).isTrue();
    }

    @Test
    void shouldNotFilterReturnsFalseForPostToApi() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(65536);
        assertThat(filter.shouldNotFilter(new MockHttpServletRequest("POST", "/api/trajectory"))).isFalse();
    }

    // ── Unit: fast-path rejection (Content-Length > max, body not read) ───────

    @Test
    void fastPathRejectsOnContentLengthWithoutReadingBody() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(65536);

        int[] bytesRead = {0};
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/trajectory") {
            @Override public long getContentLengthLong() { return 1_000_000L; }
            @Override public ServletInputStream getInputStream() {
                return new ServletInputStream() {
                    @Override public boolean isFinished()                    { return true; }
                    @Override public boolean isReady()                       { return false; }
                    @Override public void setReadListener(ReadListener l)    {}
                    @Override public int read() { bytesRead[0]++; return -1; }
                };
            }
        };
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, resp) -> {});

        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(bytesRead[0]).isZero(); // body never read on fast path
        assertThat(response.getContentType()).contains("application/problem+json");
    }

    // ── Unit: bounded-read rejection ─────────────────────────────────────────

    @Test
    void boundedReadRejectsBodyOverMax() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(10);

        byte[] bodyBytes = new byte[11]; // one over the 10-byte limit
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/trajectory");
        request.setContent(bodyBytes);

        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, resp) -> {});

        assertThat(response.getStatus()).isEqualTo(413);
    }

    // ── Unit: body-read path rejection (Content-Length unknown, body read and exceeds max) ──

    @Test
    void bodyReadPathRejectsBodyOverMax() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(10);

        byte[] bodyBytes = new byte[11];
        // Override getContentLengthLong() to -1 so fast-path is skipped;
        // body is then read and found to exceed the limit
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/trajectory") {
            @Override public long getContentLengthLong() { return -1L; }
        };
        request.setContent(bodyBytes);

        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, resp) -> {});

        assertThat(response.getStatus()).isEqualTo(413);
    }

    // ── Unit: reject413 with malformed URI (IllegalArgumentException catch) ───

    @Test
    void reject413SetsFallbackInstanceOnMalformedUri() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(10);

        byte[] bodyBytes = new byte[11];
        // URI.create("{bad}") throws IllegalArgumentException — exercises the catch block
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/{bad}") {
            @Override public long getContentLengthLong() { return -1L; }
            @Override public String getRequestURI()      { return "/api/{bad}"; }
        };
        request.setContent(bodyBytes);

        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, resp) -> {});

        assertThat(response.getStatus()).isEqualTo(413);
    }

    // ── Unit: body within limit passes through ────────────────────────────────

    @Test
    void bodyWithinLimitIsPassedToCachedBodyRequest() throws Exception {
        RequestBodySizeLimitFilter filter = makeFilter(65536);

        byte[] bodyBytes = "{}".getBytes();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/trajectory");
        request.setContent(bodyBytes);

        boolean[] chainCalled = {false};
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, resp) -> {
            chainCalled[0] = true;
            assertThat(req).isInstanceOf(RequestBodySizeLimitFilter.CachedBodyRequest.class);
        });

        assertThat(chainCalled[0]).isTrue();
    }

    // ── CachedBodyRequest: stream/reader/length ───────────────────────────────

    @Test
    void cachedBodyRequestInputStreamReturnsAllBytes() throws Exception {
        byte[] body = {10, 20, 30};
        MockHttpServletRequest req = new MockHttpServletRequest();
        RequestBodySizeLimitFilter.CachedBodyRequest cached =
            new RequestBodySizeLimitFilter.CachedBodyRequest(req, body);

        ServletInputStream is = cached.getInputStream();
        assertThat(is.isReady()).isTrue();
        assertThat(is.isFinished()).isFalse();
        assertThat(is.read()).isEqualTo(10);
        assertThat(is.read()).isEqualTo(20);
        assertThat(is.read()).isEqualTo(30);
        assertThat(is.isFinished()).isTrue();
        is.setReadListener(null); // no-op; must not throw
    }

    @Test
    void cachedBodyRequestReaderDecodesUtf8() throws Exception {
        byte[] body = "hello".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setCharacterEncoding("UTF-8");
        RequestBodySizeLimitFilter.CachedBodyRequest cached =
            new RequestBodySizeLimitFilter.CachedBodyRequest(req, body);

        assertThat(cached.getContentLength()).isEqualTo(5);
        assertThat(cached.getContentLengthLong()).isEqualTo(5L);
        assertThat(cached.getReader().readLine()).isEqualTo("hello");
    }

    @Test
    void cachedBodyRequestReaderUsesUtf8WhenEncodingAbsent() throws Exception {
        byte[] body = "ok".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        MockHttpServletRequest req = new MockHttpServletRequest(); // no encoding set
        RequestBodySizeLimitFilter.CachedBodyRequest cached =
            new RequestBodySizeLimitFilter.CachedBodyRequest(req, body);

        assertThat(cached.getReader().readLine()).isEqualTo("ok");
    }

    // ── Integration: GET and non-/api/ routes pass through ───────────────────

    @Test
    void getRequestIsNotFiltered() throws Exception {
        mvc.perform(get("/api/bullets")).andExpect(status().isOk());
    }

    @Test
    void actuatorPathIsNotFiltered() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }

    // ── Integration: 413 response shape ──────────────────────────────────────

    @Test
    void oversizedBodyReturns413WithProblemJson() throws Exception {
        byte[] body = new byte[65537];
        mvc.perform(post("/api/trajectories/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().is(413))
            .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
            .andExpect(jsonPath("$.status").value(413))
            .andExpect(jsonPath("$.title").value("Content Too Large"))
            .andExpect(jsonPath("$.detail").value("Request body exceeds the 65536-byte limit."))
            .andExpect(jsonPath("$.instance").value("/api/trajectories/compare"));
    }

    // ── Integration: in-limit request reaches controller ─────────────────────

    @Test
    void validRequestPassesThroughFilter() throws Exception {
        mvc.perform(post("/api/trajectories/308-win-168gr")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50,
                     "windSpeedKph":0,"altitudeMeters":0,"temperatureC":15}"""))
            .andExpect(status().isOk());
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private RequestBodySizeLimitFilter makeFilter(long maxBytes) {
        return new RequestBodySizeLimitFilter(new HttpLimitsProperties(maxBytes), objectMapper);
    }
}
