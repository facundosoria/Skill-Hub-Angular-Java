package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class HydraAdminClientConsentTest {

    private final ObjectMapper json = new ObjectMapper();
    private HttpServer server;
    private AtomicReference<String> acceptedBody;

    @BeforeEach
    void setUp() throws IOException {
        acceptedBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/admin/oauth2/auth/requests/consent", exchange -> {
            if ("GET".equals(exchange.getRequestMethod())) {
                respond(exchange, "{\"requested_scope\":[\"openid\",\"unknown\",\"mcp\",\"offline_access\",\"mcp\"]}");
                return;
            }
            acceptedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, "{\"redirect_to\":\"https://client.test/callback?code=ok\"}");
        });
        server.start();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void consentPayloadFiltersScopesAndIncludesMcpAudience() throws Exception {
        HydraAdminClient client = new HydraAdminClient(
                "http://localhost:" + server.getAddress().getPort(), "https://hub.test/api/mcp");

        assertThat(client.acceptConsent("consent-1"))
                .isEqualTo("https://client.test/callback?code=ok");
        JsonNode body = json.readTree(acceptedBody.get());

        assertThat(body.path("grant_scope").toString())
                .isEqualTo("[\"openid\",\"mcp\",\"offline_access\"]");
        assertThat(body.path("grant_access_token_audience").toString())
                .isEqualTo("[\"https://hub.test/api/mcp\"]");
    }

    @Test
    void grantScopeIntersectionKeepsOnlyContractScopes() throws Exception {
        HydraAdminClient client = new HydraAdminClient("http://hydra.invalid", "https://hub.test/api/mcp");
        JsonNode request = json.readTree("{\"requested_scope\":[\"offline\",\"mcp\",\"openid\"]}");

        assertThat(client.grantScopes(request)).isEqualTo(List.of("mcp", "openid"));
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }
}
