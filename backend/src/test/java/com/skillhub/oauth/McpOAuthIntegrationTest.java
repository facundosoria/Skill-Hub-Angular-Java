package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.auth.ApiKeyIdentity;
import com.skillhub.auth.ApiKeyService;
import com.skillhub.mcp.McpController;
import com.skillhub.mcp.McpTools;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class McpOAuthIntegrationTest {

    private static final String RESOURCE_METADATA = "https://hub.test/.well-known/oauth-protected-resource";

    private ApiKeyService apiKeys;
    private OAuthIdentityService oauthIdentities;
    private McpController controller;
    private ObjectMapper json;
    private JsonNode ping;

    @BeforeEach
    void setUp() {
        apiKeys = mock(ApiKeyService.class);
        oauthIdentities = mock(OAuthIdentityService.class);
        json = new ObjectMapper();
        controller = new McpController(apiKeys, oauthIdentities, mock(McpTools.class), json, RESOURCE_METADATA);
        ping = json.createObjectNode()
                .put("jsonrpc", "2.0")
                .put("id", 1)
                .put("method", "ping");
    }

    @Test
    void validOAuthIdentityCanCallMcp() {
        ApiKeyIdentity identity = new ApiKeyIdentity(null, "user-id", "oauth-user", "platform", "member");
        when(oauthIdentities.identifyByAuthHeader("Bearer oauth-token")).thenReturn(identity);

        ResponseEntity<JsonNode> response = callWith("Bearer oauth-token");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().path("jsonrpc").asText()).isEqualTo("2.0");
        verifyNoInteractions(apiKeys);
    }

    @Test
    void invalidOAuthIdentityIsRejected() {
        when(oauthIdentities.identifyByAuthHeader("Bearer invalid-token")).thenReturn(null);

        ResponseEntity<JsonNode> response = callWith("Bearer invalid-token");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getHeaders().getFirst("WWW-Authenticate"))
                .contains("resource_metadata=\"" + RESOURCE_METADATA + "\"");
    }

    @Test
    void validApiKeyStillUsesTheExistingIdentityPath() {
        ApiKeyIdentity identity = new ApiKeyIdentity("key-id", "user-id", "api-user", "platform", "member");
        when(apiKeys.identifyByAuthHeader("Bearer sk_hub_valid")).thenReturn(identity);

        ResponseEntity<JsonNode> response = callWith("Bearer sk_hub_valid");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(apiKeys).identifyByAuthHeader("Bearer sk_hub_valid");
        verify(apiKeys).touchApiKey("key-id");
        verifyNoInteractions(oauthIdentities);
    }

    @Test
    void revokedApiKeyRemainsUnauthorized() {
        when(apiKeys.identifyByAuthHeader("Bearer sk_hub_revoked")).thenReturn(null);

        ResponseEntity<JsonNode> response = callWith("Bearer sk_hub_revoked");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        verifyNoInteractions(oauthIdentities);
    }

    private ResponseEntity<JsonNode> callWith(String authorization) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", authorization);
        return controller.handle(ping, request);
    }
}
