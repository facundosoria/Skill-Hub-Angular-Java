package com.skillhub.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.skillhub.auth.ApiKeyIdentity;
import com.skillhub.auth.ApiKeyService;
import com.skillhub.oauth.OAuthIdentityService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Endpoint MCP sobre HTTP, stateless. Puerto de src/app/api/mcp/route.ts.
 *
 * En vez del SDK de MCP para Java (que en su 2.x sigue la spec stateless
 * 2026-07-28, mientras los clientes Claude todavia negocian 2025-06-18) se
 * implementa el JSON-RPC 2.0 a mano: para un server de solo lectura sin sesion
 * son ~4 metodos y evita el churn del SDK. Ver README del spike.
 *
 * La identidad sale del header Authorization: o bien "Bearer sk_hub_..."
 * (API key estatica, ApiKeyService) o un JWT emitido por Hydra (OAuth,
 * OAuthIdentityService) - ambos metodos conviven indefinidamente, ver
 * el plan de OAuth. Se distingue por el prefijo fijo de las API keys.
 */
@RestController
public class McpController {

    private static final Logger log = LoggerFactory.getLogger(McpController.class);
    private static final String DEFAULT_PROTOCOL = "2025-06-18";

    private final ApiKeyService apiKeys;
    private final OAuthIdentityService oauthIdentities;
    private final McpTools tools;
    private final ObjectMapper json;
    private final String resourceMetadataUrl;

    public McpController(ApiKeyService apiKeys, OAuthIdentityService oauthIdentities, McpTools tools,
                          ObjectMapper json,
                          @Value("${app.hydra.protected-resource-metadata-url}") String resourceMetadataUrl) {
        this.apiKeys = apiKeys;
        this.oauthIdentities = oauthIdentities;
        this.tools = tools;
        this.json = json;
        this.resourceMetadataUrl = resourceMetadataUrl;
    }

    @PostMapping("/api/mcp")
    public ResponseEntity<JsonNode> handle(@RequestBody JsonNode body, HttpServletRequest req) {
        String authHeader = req.getHeader("Authorization");
        boolean isApiKey = authHeader != null && authHeader.regionMatches(7, "sk_hub_", 0, 7);
        ApiKeyIdentity identity = isApiKey
                ? apiKeys.identifyByAuthHeader(authHeader)
                : oauthIdentities.identifyByAuthHeader(authHeader);
        if (identity == null) {
            return unauthorized();
        }
        if (identity.apiKeyId() != null) apiKeys.touchApiKey(identity.apiKeyId());

        JsonNode idNode = body.get("id");
        String method = body.path("method").asText("");
        JsonNode params = body.has("params") ? body.get("params") : json.createObjectNode();

        try {
            return switch (method) {
                case "initialize" -> ResponseEntity.ok(rpcResult(idNode, initialize(params)));
                case "notifications/initialized", "notifications/cancelled" ->
                        ResponseEntity.accepted().build();
                case "ping" -> ResponseEntity.ok(rpcResult(idNode, json.createObjectNode()));
                case "tools/list" -> {
                    ObjectNode result = json.createObjectNode();
                    result.set("tools", tools.toolList());
                    yield ResponseEntity.ok(rpcResult(idNode, result));
                }
                case "tools/call" -> ResponseEntity.ok(toolsCall(idNode, params, identity));
                default -> ResponseEntity.ok(rpcError(idNode, -32601, "Metodo no soportado: " + method));
            };
        } catch (RuntimeException e) {
            log.error("[mcp] fallo manejando {}", method, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(rpcError(idNode, -32603, "Error interno"));
        }
    }

    /**
     * Streamable HTTP currently exposes only POST. Keep authentication
     * semantics identical to POST before returning 405 for other methods;
     * otherwise Spring's unmapped GET becomes an incorrect 500 through the
     * generic exception handler.
     */
    @RequestMapping(value = "/api/mcp")
    public ResponseEntity<JsonNode> unsupported(HttpServletRequest req) {
        if (!authenticated(req)) {
            return unauthorized();
        }
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .header("Allow", "POST")
                .body(rpcError(null, -32600, "Metodo HTTP no soportado; use POST"));
    }

    private boolean authenticated(HttpServletRequest req) {
        String authHeader = req.getHeader("Authorization");
        boolean isApiKey = authHeader != null && authHeader.regionMatches(7, "sk_hub_", 0, 7);
        return (isApiKey ? apiKeys.identifyByAuthHeader(authHeader) : oauthIdentities.identifyByAuthHeader(authHeader)) != null;
    }

    private ResponseEntity<JsonNode> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .header("WWW-Authenticate", "Bearer realm=\"skill-hub\", resource_metadata=\"" + resourceMetadataUrl + "\"")
                // No body lets Spring emit the challenge even when the client
                // advertises only text/event-stream, before JSON negotiation.
                .build();
    }

    private ObjectNode initialize(JsonNode params) {
        String protocol = params.path("protocolVersion").asText(DEFAULT_PROTOCOL);
        ObjectNode result = json.createObjectNode();
        result.put("protocolVersion", protocol);
        ObjectNode caps = json.createObjectNode();
        caps.set("tools", json.createObjectNode());
        result.set("capabilities", caps);
        ObjectNode info = json.createObjectNode();
        info.put("name", "skill-hub");
        info.put("version", "1.0.0");
        result.set("serverInfo", info);
        result.put("instructions", McpInstructions.SERVER_INSTRUCTIONS);
        return result;
    }

    private JsonNode toolsCall(JsonNode idNode, JsonNode params, ApiKeyIdentity identity) {
        String name = params.path("name").asText("");
        JsonNode args = params.has("arguments") ? params.get("arguments") : json.createObjectNode();

        var content = tools.call(name, args, identity);
        if (content == null) {
            return rpcError(idNode, -32602, "Tool no encontrada: " + name);
        }
        ObjectNode result = json.createObjectNode();
        result.set("content", content);
        return rpcResult(idNode, result);
    }

    // --- JSON-RPC 2.0 envelopes ---------------------------------------------

    private ObjectNode rpcResult(JsonNode id, JsonNode result) {
        ObjectNode env = json.createObjectNode();
        env.put("jsonrpc", "2.0");
        env.set("id", id == null ? json.nullNode() : id);
        env.set("result", result);
        return env;
    }

    private ObjectNode rpcError(JsonNode id, int code, String message) {
        ObjectNode env = json.createObjectNode();
        env.put("jsonrpc", "2.0");
        env.set("id", id == null ? json.nullNode() : id);
        ObjectNode err = json.createObjectNode();
        err.put("code", code);
        err.put("message", message);
        env.set("error", err);
        return env;
    }
}
