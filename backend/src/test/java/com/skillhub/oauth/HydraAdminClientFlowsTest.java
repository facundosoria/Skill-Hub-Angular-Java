package com.skillhub.oauth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Cada llamada administrativa a Hydra: con redirect_to en la respuesta y
 * con cuerpo vacio, que se traduce en null sin romper.
 */
class HydraAdminClientFlowsTest {

    private final ObjectMapper json = new ObjectMapper();
    private HttpServer server;
    private String responseBody;
    private final List<String> calls = new ArrayList<>();

    @BeforeEach
    void setUp() throws IOException {
        responseBody = "{\"redirect_to\":\"https://client.test/next\"}";
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/admin/oauth2/auth/requests", this::handle);
        server.start();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private void handle(HttpExchange exchange) throws IOException {
        calls.add(exchange.getRequestMethod() + " " + exchange.getRequestURI());
        exchange.getRequestBody().readAllBytes();
        boolean consentRead = "GET".equals(exchange.getRequestMethod());
        byte[] bytes = (consentRead ? "{\"requested_scope\":[\"openid\"],\"subject\":\"u1\"}" : responseBody)
                .getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        if (bytes.length == 0) {
            exchange.sendResponseHeaders(200, -1);
        } else {
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
        }
        exchange.close();
    }

    private HydraAdminClient client() {
        return new HydraAdminClient("http://localhost:" + server.getAddress().getPort(), "https://hub.test/api/mcp");
    }

    @Test
    void everyWriteReturnsTheRedirect() {
        HydraAdminClient client = client();

        assertThat(client.acceptLogin("login-1", "u1")).isEqualTo("https://client.test/next");
        assertThat(client.rejectLogin("login-1")).isEqualTo("https://client.test/next");
        assertThat(client.acceptConsent("consent-1")).isEqualTo("https://client.test/next");
        assertThat(client.rejectConsent("consent-1")).isEqualTo("https://client.test/next");
        assertThat(client.acceptLogout("logout-1")).isEqualTo("https://client.test/next");
        assertThat(client.rejectLogout("logout-1")).isEqualTo("https://client.test/next");

        assertThat(calls).anyMatch(call -> call.startsWith("PUT /admin/oauth2/auth/requests/login/accept?login_challenge=login-1"));
        assertThat(calls).anyMatch(call -> call.startsWith("PUT /admin/oauth2/auth/requests/logout/reject?logout_challenge=logout-1"));
    }

    @Test
    void anEmptyAnswerBecomesNull() {
        responseBody = "";
        HydraAdminClient client = client();

        assertThat(client.acceptLogin("login-1", "u1")).isNull();
        assertThat(client.rejectLogin("login-1")).isNull();
        assertThat(client.acceptConsent("consent-1")).isNull();
        assertThat(client.rejectConsent("consent-1")).isNull();
        assertThat(client.acceptLogout("logout-1")).isNull();
        assertThat(client.rejectLogout("logout-1")).isNull();
    }

    @Test
    void readsConsentAndLogoutRequests() {
        HydraAdminClient client = client();

        assertThat(client.getConsentRequest("consent-1").path("subject").asText()).isEqualTo("u1");
        assertThat(client.getLogoutRequest("logout-1").path("subject").asText()).isEqualTo("u1");
    }

    @Test
    void grantsNothingWithoutAScopeList() throws Exception {
        HydraAdminClient client = client();

        assertThat(client.grantScopes(null)).isEmpty();
        assertThat(client.grantScopes(json.readTree("{\"requested_scope\":\"openid\"}"))).isEmpty();
        assertThat(client.grantScopes(json.readTree("{\"requested_scope\":[1,\"mcp\",\"admin\"]}"))).containsExactly("mcp");
    }

    @Test
    void theTestConstructorHasNoResource() {
        HydraAdminClient client = new HydraAdminClient("http://localhost:" + server.getAddress().getPort()) {};

        assertThat(client.acceptLogout("logout-1")).isEqualTo("https://client.test/next");
    }
}
