package com.ballistics.controller;

import com.ballistics.model.*;
import com.ballistics.ratelimit.*;
import com.ballistics.service.TrajectoryService;
import com.ballistics.service.UnknownBulletException;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.springframework.cache.CacheManager;
import org.springframework.cache.caffeine.CaffeineCache;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Collectors;

/**
 * JSON-RPC 2.0 transport endpoint at {@code POST /api/rpc}.
 *
 * <p>Handles both single and batch (up to 20 items) request objects.
 * All existing REST endpoints are unaffected — this is purely additive.</p>
 *
 * <p>Error handling is entirely controller-owned; {@link GlobalExceptionHandler}
 * does not intercept normal JSON-RPC error paths.</p>
 */
@Tag(name = "JSON-RPC", description = "JSON-RPC 2.0 transport — all methods accessible at a single URL")
@RestController
@RequestMapping(path = "/api/rpc", produces = MediaType.APPLICATION_JSON_VALUE)
public class JsonRpcController {

    private static final int BATCH_MAX = 20;
    private static final String JSONRPC_VERSION = "2.0";

    private final TrajectoryService trajectoryService;
    private final CacheManager cacheManager;
    private final ClientRateLimiter rateLimiter;
    private final DefaultClientKeyResolver keyResolver;
    private final Validator validator;
    private final ObjectMapper objectMapper;

    public JsonRpcController(
            TrajectoryService trajectoryService,
            CacheManager cacheManager,
            ClientRateLimiter rateLimiter,
            DefaultClientKeyResolver keyResolver,
            Validator validator,
            ObjectMapper objectMapper) {
        this.trajectoryService = trajectoryService;
        this.cacheManager = cacheManager;
        this.rateLimiter = rateLimiter;
        this.keyResolver = keyResolver;
        this.validator = validator;
        this.objectMapper = objectMapper;
    }

    // ── Main handler ──────────────────────────────────────────────────────────

    @Operation(
        summary = "JSON-RPC 2.0 transport",
        description = "Accepts a single JSON-RPC 2.0 request object or an array of up to 20 request objects.",
        requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(
            content = @Content(
                mediaType = MediaType.APPLICATION_JSON_VALUE,
                schema = @Schema(oneOf = {
                    com.ballistics.controller.JsonRpcController.JsonRpcRequestSchema.class,
                    com.ballistics.controller.JsonRpcController.JsonRpcBatchSchema.class
                })
            )
        )
    )
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Object> handleRpc(HttpServletRequest request) throws IOException {
        byte[] rawBody = request.getInputStream().readAllBytes();
        JsonNode body;
        try {
            body = objectMapper.readTree(rawBody);
        } catch (JacksonException e) {
            return ResponseEntity.badRequest()
                .body(buildError(null, -32700, "Parse error", null));
        }

        if (!body.isObject() && !body.isArray()) {
            return ResponseEntity.ok(buildError(null, -32600, "Invalid request", null));
        }

        if (body.isArray()) {
            return handleBatch(body, request);
        }

        JsonNode response = processSingle(body, request);
        if (response == null) {
            // Notification — no response body
            return ResponseEntity.ok().build();
        }
        return ResponseEntity.ok(response);
    }

    // ── Batch ─────────────────────────────────────────────────────────────────

    private ResponseEntity<Object> handleBatch(JsonNode array, HttpServletRequest request) {
        int size = array.size();
        if (size == 0 || size > BATCH_MAX) {
            return ResponseEntity.ok(buildError(null, -32600, "Invalid request", null));
        }

        ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor();
        List<CompletableFuture<JsonNode>> futures = new ArrayList<>(size);
        for (int i = 0; i < size; i++) {
            final JsonNode item = array.get(i);
            futures.add(CompletableFuture.supplyAsync(() -> processSingle(item, request), exec));
        }
        exec.shutdown();

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

        ArrayNode results = objectMapper.createArrayNode();
        for (CompletableFuture<JsonNode> f : futures) {
            JsonNode result = f.join();
            if (result != null) {
                results.add(result);
            }
        }
        return ResponseEntity.ok(results);
    }

    // ── Single dispatch ───────────────────────────────────────────────────────

    /**
     * Processes one JSON-RPC request object. Returns null for notifications.
     * Never throws — all exceptions are converted to JSON-RPC error responses.
     */
    private JsonNode processSingle(JsonNode req, HttpServletRequest httpReq) {
        if (!req.isObject()) {
            return buildError(null, -32600, "Invalid request", null);
        }

        boolean isNotification = !req.has("id");
        JsonNode idNode = req.get("id");

        JsonNode jsonrpcNode = req.get("jsonrpc");
        JsonNode methodNode = req.get("method");

        if (jsonrpcNode == null || !jsonrpcNode.isTextual() || !JSONRPC_VERSION.equals(jsonrpcNode.asText())
                || methodNode == null || !methodNode.isTextual()) {
            return isNotification ? null : buildError(idNode, -32600, "Invalid request", null);
        }

        JsonNode paramsNode = req.get("params");
        if (paramsNode != null && paramsNode.isArray()) {
            return isNotification ? null : buildError(idNode, -32600, "Invalid request", null);
        }

        String method = methodNode.asText();
        String clientKey = keyResolver.resolve(httpReq);

        try {
            Object result = dispatch(method, paramsNode, clientKey);
            return isNotification ? null : buildSuccess(idNode, result);
        } catch (MethodNotFoundException e) {
            return isNotification ? null : buildError(idNode, -32601, "Method not found", null);
        } catch (InvalidParamsException e) {
            return isNotification ? null : buildError(idNode, -32602, "Invalid params", e.getData());
        } catch (RateLimitExceededException e) {
            return isNotification ? null
                : buildError(idNode, -32002, "Rate limit exceeded",
                    Map.of("retryAfterSeconds", e.retryAfterSeconds()));
        } catch (UnknownBulletException e) {
            return isNotification ? null
                : buildError(idNode, -32001, "Unknown bullet",
                    Map.of("bulletId", e.bulletId() == null ? "null" : e.bulletId()));
        } catch (Exception e) {
            return isNotification ? null : buildError(idNode, -32603, "Internal error", null);
        }
    }

    // ── Method dispatcher ─────────────────────────────────────────────────────

    private Object dispatch(String method, JsonNode params, String clientKey) {
        return switch (method) {
            case "bullets.list" -> trajectoryService.listBullets();
            case "trajectory.compute" -> {
                consumeRateLimit(RateLimitTier.SINGLE, clientKey);
                TrajectoryRequest req = bindAndValidate(params, TrajectoryRequest.class);
                yield trajectoryService.compute(req.bulletId(), req);
            }
            case "trajectory.compare" -> {
                consumeRateLimit(RateLimitTier.COMPARE, clientKey);
                CompareRequest req = bindAndValidate(params, CompareRequest.class);
                yield trajectoryService.compare(req);
            }
            case "trajectory.computeCustom" -> {
                consumeRateLimit(RateLimitTier.SINGLE, clientKey);
                CustomBulletRequest req = bindAndValidate(params, CustomBulletRequest.class);
                yield trajectoryService.computeCustom(req);
            }
            case "trajectory.batch" -> {
                consumeRateLimit(RateLimitTier.BATCH, clientKey);
                BatchRequest req = bindAndValidate(params, BatchRequest.class);
                yield trajectoryService.batch(req);
            }
            case "cache.stats" -> cacheStats();
            default -> throw new MethodNotFoundException();
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void consumeRateLimit(RateLimitTier tier, String clientKey) {
        ClientRateLimiter.Decision decision = rateLimiter.tryConsume(tier, clientKey);
        if (!decision.allowed()) {
            throw new RateLimitExceededException(tier, decision.retryAfterSeconds());
        }
    }

    private <T> T bindAndValidate(JsonNode params, Class<T> type) {
        JsonNode effectiveParams = (params == null || params.isNull())
            ? objectMapper.createObjectNode()
            : params;
        T value;
        try {
            value = objectMapper.treeToValue(effectiveParams, type);
        } catch (JacksonException e) {
            throw new InvalidParamsException(e.getMessage());
        }
        Set<ConstraintViolation<T>> violations = validator.validate(value);
        if (!violations.isEmpty()) {
            String data = violations.stream()
                .map(v -> v.getPropertyPath().toString() + ": " + v.getMessage())
                .sorted()
                .collect(Collectors.joining("; "));
            throw new InvalidParamsException(data);
        }
        return value;
    }

    private Map<String, Object> cacheStats() {
        CaffeineCache spring = (CaffeineCache) cacheManager.getCache("trajectories");
        Cache<Object, Object> native_ = spring.getNativeCache();
        CacheStats s = native_.stats();
        return Map.of(
            "estimatedSize", native_.estimatedSize(),
            "hitCount",      s.hitCount(),
            "missCount",     s.missCount(),
            "hitRate",       s.hitRate(),
            "loadCount",     s.loadCount()
        );
    }

    // ── Response builders ─────────────────────────────────────────────────────

    private ObjectNode buildSuccess(JsonNode id, Object result) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("jsonrpc", JSONRPC_VERSION);
        node.set("result", objectMapper.valueToTree(result));
        node.set("id", id);
        return node;
    }

    private ObjectNode buildError(JsonNode id, int code, String message, Object data) {
        ObjectNode error = objectMapper.createObjectNode();
        error.put("code", code);
        error.put("message", message);
        if (data != null) {
            error.set("data", objectMapper.valueToTree(data));
        }
        ObjectNode node = objectMapper.createObjectNode();
        node.put("jsonrpc", JSONRPC_VERSION);
        node.set("error", error);
        node.set("id", id != null ? id : objectMapper.nullNode());
        return node;
    }

    // ── Inner exceptions ──────────────────────────────────────────────────────

    static final class MethodNotFoundException extends RuntimeException {
        MethodNotFoundException() { super("Method not found"); }
    }

    static final class InvalidParamsException extends RuntimeException {
        private final String data;
        InvalidParamsException(String data) {
            super("Invalid params");
            this.data = data;
        }
        String getData() { return data; }
    }

    // ── OpenAPI schema stubs (union type for request body documentation) ──────

    @Schema(name = "JsonRpcRequest", description = "Single JSON-RPC 2.0 request object")
    public static final class JsonRpcRequestSchema {
        @Schema(allowableValues = "2.0", requiredMode = Schema.RequiredMode.REQUIRED)
        public String jsonrpc;
        @Schema(description = "Method name, e.g. \"bullets.list\"", requiredMode = Schema.RequiredMode.REQUIRED)
        public String method;
        @Schema(description = "Named parameters object (no positional arrays)")
        public Object params;
        @Schema(description = "Request id (string, number, or null). Omit to make this a notification.")
        public Object id;
    }

    @Schema(name = "JsonRpcBatch",
            description = "Batch of up to 20 JSON-RPC 2.0 request objects",
            type = "array",
            maxLength = 20)
    public static final class JsonRpcBatchSchema {
        @Schema(description = "Array of JSON-RPC request objects")
        public List<JsonRpcRequestSchema> items;
    }
}
