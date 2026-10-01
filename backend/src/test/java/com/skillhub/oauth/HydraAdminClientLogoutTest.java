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
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class HydraAdminClientLogoutTest {

    private final ObjectMapper json = new ObjectMapper();
    private HttpServer server;
    private AtomicReference<String> methodAndPath;
    private AtomicReference<String> acceptedBody;
    private AtomicReference<String> rejectedBody;

    @BeforeEach
    void setUp() throws IOException {
        methodAndPath = new AtomicReference<>();
        acceptedBody = new AtomicReference<>();
        rejectedBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/admin/oauth2/auth/requests/logout", exchange -> {
            methodAndPath.set(exchange.getRequestMethod() + " " + exchange.getRequestURI());
            if ("GET".equals(exchange.getRequestMethod())) {
                respond(exchange, "{\"subject\":\"user-1\",\"client\":{\"client_name\":\"Claude\"}}");
            } else if (exchange.getRequestURI().getPath().endsWith("/accept")) {
                acceptedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                respond(exchange, "{\"redirect_to\":\"https://client.test/logout\"}");
            } else {
                rejectedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                respond(exchange, "{\"redirect_to\":\"https://client.test/callback?error=access_denied\"}");
            }
        });
        server.start();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void logoutAdminEndpointsUseHydraV2PathsAndPayloads() throws Exception {
        HydraAdminClient client = new HydraAdminClient(
                "http://localhost:" + server.getAddress().getPort(), "https://hub.test/api/mcp");

        JsonNode request = client.getLogoutRequest("logout-1");
        assertThat(request.path("subject").asText()).isEqualTo("user-1");
        assertThat(methodAndPath.get()).isEqualTo("GET /admin/oauth2/auth/requests/logout?logout_challenge=logout-1");

        assertThat(client.acceptLogout("logout-1")).isEqualTo("https://client.test/logout");
        assertThat(acceptedBody.get()).isEmpty();
        assertThat(methodAndPath.get()).isEqualTo("PUT /admin/oauth2/auth/requests/logout/accept?logout_challenge=logout-1");

        assertThat(client.rejectLogout("logout-1"))
                .isEqualTo("https://client.test/callback?error=access_denied");
        JsonNode rejected = json.readTree(rejectedBody.get());
        assertThat(rejected.path("error").asText()).isEqualTo("access_denied");
        assertThat(methodAndPath.get()).isEqualTo("PUT /admin/oauth2/auth/requests/logout/reject?logout_challenge=logout-1");
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
