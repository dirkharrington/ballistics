package com.ballistics.controller;

import com.ballistics.config.RequestBodySizeLimitFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Functional integration tests for JsonRpcController.
 * Rate limiting is disabled here; see JsonRpcRateLimitTest for those paths.
 * The body-size filter is added explicitly since MockMvc does not auto-register filters.
 */
@SpringBootTest
@TestPropertySource(properties = "app.ratelimit.enabled=false")
class JsonRpcControllerTest {

    @Autowired WebApplicationContext wac;
    @Autowired RequestBodySizeLimitFilter requestBodySizeLimitFilter;
    private MockMvc mockMvc;

    @BeforeEach
    void setup() {
        mockMvc = MockMvcBuilders.webAppContextSetup(wac)
            .addFilters(requestBodySizeLimitFilter)
            .build();
    }

    // ── GET /api/rpc → 405 ───────────────────────────────────────────────────

    @Test
    void getReturns405() throws Exception {
        mockMvc.perform(get("/api/rpc"))
            .andExpect(status().isMethodNotAllowed());
    }

    // ── Parse error (-32700) ─────────────────────────────────────────────────

    @Test
    void parseError_returns400AndCode32700() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("not valid json {"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.jsonrpc").value("2.0"))
            .andExpect(jsonPath("$.error.code").value(-32700))
            .andExpect(jsonPath("$.error.message").value("Parse error"))
            .andExpect(jsonPath("$.id").doesNotExist());
    }

    // ── Invalid request (-32600) ─────────────────────────────────────────────

    @Test
    void primitiveBody_returns32600() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("42"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    @Test
    void missingJsonrpc_returns32600() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"method\":\"bullets.list\",\"id\":\"1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600))
            .andExpect(jsonPath("$.error.message").value("Invalid request"))
            .andExpect(jsonPath("$.id").value("1"));
    }

    @Test
    void wrongJsonrpcVersion_returns32600() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"1.0\",\"method\":\"bullets.list\",\"id\":\"1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    @Test
    void missingMethod_returns32600() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"id\":\"1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    @Test
    void positionalParams_returns32600() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"params\":[1,2,3],\"id\":\"1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    @Test
    void nonTextualJsonrpc_returns32600() throws Exception {
        // jsonrpc field exists but is a number, not a string — covers !jsonrpcNode.isTextual() branch
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":2,\"method\":\"bullets.list\",\"id\":\"t1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    @Test
    void nonTextualMethod_returns32600() throws Exception {
        // method field exists but is a number, not a string — covers !methodNode.isTextual() branch
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":42,\"id\":\"t2\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    @Test
    void trajectoryCompute_jsonNullParams_returns32001() throws Exception {
        // "params":null (JSON null node) — covers params.isNull() branch in bindAndValidate
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"trajectory.compute\",\"params\":null,\"id\":\"t3\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32001));
    }

    @Test
    void emptyBatch_returns32600() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("[]"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    @Test
    void oversizedBatch_returns32600() throws Exception {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < 21; i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":").append(i).append('}');
        }
        sb.append("]");
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sb.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    // ── Method not found (-32601) ────────────────────────────────────────────

    @Test
    void unknownMethod_returns32601() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"no.such.method\",\"id\":\"x\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32601))
            .andExpect(jsonPath("$.error.message").value("Method not found"))
            .andExpect(jsonPath("$.id").value("x"));
    }

    // ── bullets.list ─────────────────────────────────────────────────────────

    @Test
    void bulletsList_returnsAllBullets() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":\"a\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.jsonrpc").value("2.0"))
            .andExpect(jsonPath("$.id").value("a"))
            .andExpect(jsonPath("$.result", hasSize(greaterThan(0))))
            .andExpect(jsonPath("$.result[0].id", notNullValue()));
    }

    @Test
    void bulletsList_withEmptyParams_returnsAllBullets() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"params\":{},\"id\":\"b\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result", hasSize(greaterThan(0))));
    }

    @Test
    void bulletsList_withNumericId() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":42}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(42));
    }

    @Test
    void bulletsList_withNullId_echoesNullId() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":null}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").isEmpty());
    }

    // ── trajectory.compute ───────────────────────────────────────────────────

    @Test
    void trajectoryCompute_validRequest_returnsResult() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.compute",
                      "params":{
                        "bulletId":"308-win-168gr",
                        "zeroRangeMeters":100,
                        "maxRangeMeters":500,
                        "stepMeters":50,
                        "windSpeedKph":0,
                        "altitudeMeters":0,
                        "temperatureC":15
                      },
                      "id":"c1"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.jsonrpc").value("2.0"))
            .andExpect(jsonPath("$.id").value("c1"))
            .andExpect(jsonPath("$.result.bullet.id").value("308-win-168gr"))
            .andExpect(jsonPath("$.result.points", hasSize(greaterThan(0))));
    }

    @Test
    void trajectoryCompute_unknownBullet_returns32001() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.compute",
                      "params":{"bulletId":"no-such-bullet"},
                      "id":"c2"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32001))
            .andExpect(jsonPath("$.error.message").value("Unknown bullet"))
            .andExpect(jsonPath("$.error.data.bulletId").value("no-such-bullet"))
            .andExpect(jsonPath("$.id").value("c2"));
    }

    @Test
    void trajectoryCompute_validationFailure_returns32602() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.compute",
                      "params":{
                        "bulletId":"308-win-168gr",
                        "maxRangeMeters":99999,
                        "zeroRangeMeters":100,
                        "stepMeters":25
                      },
                      "id":"c3"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32602))
            .andExpect(jsonPath("$.error.message").value("Invalid params"))
            .andExpect(jsonPath("$.error.data", containsString("maxRangeMeters")))
            .andExpect(jsonPath("$.id").value("c3"));
    }

    @Test
    void trajectoryCompute_noParamsField_returns32001() throws Exception {
        // No params field at all → bindAndValidate receives null → createObjectNode() branch
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"trajectory.compute\",\"id\":\"c5\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32001));
    }

    @Test
    void trajectoryCompute_nullBulletId_returns32001() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.compute",
                      "params":{"zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":25},
                      "id":"c4"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32001));
    }

    // ── trajectory.compare ───────────────────────────────────────────────────

    @Test
    void trajectoryCompare_validRequest_returnsResults() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.compare",
                      "params":{
                        "bulletIds":["308-win-168gr","65-creedmoor-140gr"],
                        "zeroRangeMeters":100,
                        "maxRangeMeters":500,
                        "stepMeters":50,
                        "windSpeedKph":0,
                        "altitudeMeters":0,
                        "temperatureC":15
                      },
                      "id":"cmp1"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result", hasSize(2)));
    }

    @Test
    void trajectoryCompare_missingBulletIds_returns32602() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.compare",
                      "params":{
                        "zeroRangeMeters":100,
                        "maxRangeMeters":500,
                        "stepMeters":50
                      },
                      "id":"cmp2"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32602));
    }

    @Test
    void trajectoryCompare_wrongParamType_returns32602() throws Exception {
        // "not-an-array" cannot be deserialized as List<String> → InvalidParamsException
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.compare",
                      "params":{"bulletIds":"not-an-array","zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":50},
                      "id":"cmp3"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32602));
    }

    // ── trajectory.computeCustom ─────────────────────────────────────────────

    @Test
    void trajectoryComputeCustom_validRequest_returnsResult() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.computeCustom",
                      "params":{
                        "name":"Test load",
                        "bulletWeightGrams":11.34,
                        "muzzleVelocityMps":853,
                        "ballisticCoefficient":0.505,
                        "bulletDiameterMm":7.82,
                        "zeroRangeMeters":100,
                        "maxRangeMeters":500,
                        "stepMeters":50,
                        "windSpeedKph":0,
                        "altitudeMeters":0,
                        "temperatureC":15
                      },
                      "id":"cu1"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result.bullet.id").value("custom"))
            .andExpect(jsonPath("$.id").value("cu1"));
    }

    @Test
    void trajectoryComputeCustom_missingName_returns32602() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.computeCustom",
                      "params":{
                        "bulletWeightGrams":11.34,
                        "muzzleVelocityMps":853,
                        "ballisticCoefficient":0.505,
                        "bulletDiameterMm":7.82
                      },
                      "id":"cu2"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32602));
    }

    // ── trajectory.batch ─────────────────────────────────────────────────────

    @Test
    void trajectoryBatch_validRequest_returnsResults() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.batch",
                      "params":{
                        "requests":[
                          {
                            "bulletId":"308-win-168gr",
                            "zeroRangeMeters":100,
                            "maxRangeMeters":500,
                            "stepMeters":50,
                            "windSpeedKph":0,
                            "altitudeMeters":0,
                            "temperatureC":15
                          },
                          {
                            "bulletId":"65-creedmoor-140gr",
                            "zeroRangeMeters":100,
                            "maxRangeMeters":500,
                            "stepMeters":50,
                            "windSpeedKph":0,
                            "altitudeMeters":0,
                            "temperatureC":15
                          }
                        ]
                      },
                      "id":"b1"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result", hasSize(2)));
    }

    @Test
    void trajectoryBatch_emptyRequests_returns32602() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.batch",
                      "params":{"requests":[]},
                      "id":"b2"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32602));
    }

    @Test
    void trajectoryBatch_unknownBullet_returns32001() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "jsonrpc":"2.0",
                      "method":"trajectory.batch",
                      "params":{
                        "requests":[{
                          "bulletId":"no-such-bullet",
                          "zeroRangeMeters":100,
                          "maxRangeMeters":500,
                          "stepMeters":50
                        }]
                      },
                      "id":"b3"
                    }"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32001));
    }

    // ── cache.stats ───────────────────────────────────────────────────────────

    @Test
    void cacheStats_returnsStats() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"cache.stats\",\"id\":\"s1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.result.estimatedSize").isNumber())
            .andExpect(jsonPath("$.result.hitCount").isNumber())
            .andExpect(jsonPath("$.result.missCount").isNumber())
            .andExpect(jsonPath("$.result.hitRate").isNumber())
            .andExpect(jsonPath("$.result.loadCount").isNumber())
            .andExpect(jsonPath("$.id").value("s1"));
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    @Test
    void notification_noId_returnsNoBody() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\"}"))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }

    @Test
    void notificationWithUnknownMethod_returnsNoBody() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"no.such\"}"))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }

    @Test
    void notificationWithInvalidEnvelope_returnsNoBody() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"1.0\",\"method\":\"bullets.list\"}"))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }

    @Test
    void notificationWithPositionalParams_returnsNoBody() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"params\":[1]}"))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }

    @Test
    void notificationWithValidationError_returnsNoBody() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"jsonrpc":"2.0","method":"trajectory.compute",
                     "params":{"bulletId":"308-win-168gr","maxRangeMeters":99999}}"""))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }

    @Test
    void notificationWithUnknownBullet_returnsNoBody() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"jsonrpc":"2.0","method":"trajectory.compute",
                     "params":{"bulletId":"no-such","zeroRangeMeters":100,"maxRangeMeters":500,"stepMeters":25}}"""))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }

    @Test
    void notificationWithNullBulletId_returnsNoBody() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"jsonrpc":"2.0","method":"trajectory.compute",
                     "params":{"bulletId":null}}"""))
            .andExpect(status().isOk())
            .andExpect(content().string(""));
    }

    // ── Batch requests ────────────────────────────────────────────────────────

    @Test
    void batch_mixedRequests_returnsArrayOfResponses() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    [
                      {"jsonrpc":"2.0","method":"bullets.list","id":"a"},
                      {"jsonrpc":"2.0","method":"cache.stats","id":"b"}
                    ]"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(2)));
    }

    @Test
    void batch_withNotification_omitsNotificationFromResponse() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    [
                      {"jsonrpc":"2.0","method":"bullets.list","id":"x"},
                      {"jsonrpc":"2.0","method":"bullets.list"}
                    ]"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].id").value("x"));
    }

    @Test
    void batch_withError_partialFailureAllowed() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    [
                      {"jsonrpc":"2.0","method":"bullets.list","id":"ok"},
                      {"jsonrpc":"2.0","method":"no.such","id":"err"}
                    ]"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(2)));
    }

    @Test
    void batch_allNotifications_returnsEmptyArray() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    [
                      {"jsonrpc":"2.0","method":"bullets.list"},
                      {"jsonrpc":"2.0","method":"cache.stats"}
                    ]"""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void batch_singleItem_returnsArray() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("[{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":\"1\"}]"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void batch_maxItems_returns20Results() throws Exception {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < 20; i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":").append(i).append('}');
        }
        sb.append("]");
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sb.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(20)));
    }

    @Test
    void batch_withNonObjectItem_returns32600ForThatItem() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("[42, {\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":\"1\"}]"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(2)));
    }

    // ── Response structure ────────────────────────────────────────────────────

    @Test
    void successResponse_hasJsonrpcAndResultAndId() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"bullets.list\",\"id\":\"test\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.jsonrpc").value("2.0"))
            .andExpect(jsonPath("$.result").exists())
            .andExpect(jsonPath("$.id").value("test"))
            .andExpect(jsonPath("$.error").doesNotExist());
    }

    @Test
    void errorResponse_hasJsonrpcAndErrorAndId() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"jsonrpc\":\"2.0\",\"method\":\"no.such\",\"id\":\"err\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.jsonrpc").value("2.0"))
            .andExpect(jsonPath("$.error").exists())
            .andExpect(jsonPath("$.id").value("err"))
            .andExpect(jsonPath("$.result").doesNotExist());
    }

    // ── Null body ─────────────────────────────────────────────────────────────

    @Test
    void nullJsonBody_returns32600() throws Exception {
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content("null"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.error.code").value(-32600));
    }

    // ── Body too large (HTTP 413) via existing filter ────────────────────────

    @Test
    void bodyTooLarge_returns413() throws Exception {
        byte[] body = new byte[65537];
        mockMvc.perform(post("/api/rpc")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().is(413));
    }
}
