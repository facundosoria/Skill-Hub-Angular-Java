package com.skillhub.oauth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.session.CurrentUser;
import com.skillhub.session.SessionService;
import com.skillhub.session.UserService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Login OAuth con cambio obligatorio de contrasena, datos seguros del
 * consentimiento y metadatos de descubrimiento saneados.
 */
class OAuthControllerFlowsTest {

    private final ObjectMapper json = new ObjectMapper();
    private UserService users;
    private HydraAdminClient hydra;
    private OAuthController controller;
    private HttpServer server;
    private String discovery;

    @BeforeEach
    void setUp() throws IOException {
        users = mock(UserService.class);
        hydra = mock(HydraAdminClient.class);
        discovery = "{\"issuer\":\"https://hub.test/\",\"code_challenge_methods_supported\":[\"plain\",\"S256\"]}";
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/.well-known/openid-configuration", exchange -> {
            byte[] bytes = discovery.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            if (bytes.length == 0) exchange.sendResponseHeaders(200, -1);
            else {
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
            }
            exchange.close();
        });
        server.start();
        controller = new OAuthController(users, hydra, new OAuthPasswordChangeService(), "https://hub.test/api/mcp",
                "https://hub.test/", "http://localhost:" + server.getAddress().getPort());
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private static UserService.LoginResult login(boolean mustChange) {
        CurrentUser user = new CurrentUser("u1", "ana", "Ana", "Banco", "member", mustChange);
        return new UserService.LoginResult(user, new SessionService.SessionPayload("u1", "ana", "member", mustChange ? "nonce" : null));
    }

    private static Map<String, String> body(String... pairs) {
        Map<String, String> body = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) body.put(pairs[i], pairs[i + 1]);
        return body;
    }

    @Test
    void acceptsTheLoginDirectlyWhenNoPasswordChangeIsPending() {
        when(users.login("ana", "pw")).thenReturn(login(false));
        when(hydra.acceptLogin("lc", "u1")).thenReturn("https://client.test/next");

        assertThat(controller.acceptLogin(body("username", "ana", "password", "pw", "loginChallenge", "lc")))
                .containsEntry("redirectTo", "https://client.test/next");
    }

    @Test
    void sendsUsersWithATemporaryPasswordToTheChangeScreenFirst() {
        when(users.login("ana", "pw")).thenReturn(login(true));
        when(users.changeRequiredPassword("u1", "nonce", "nueva-clave-1")).thenReturn(login(false));
        when(hydra.acceptLogin("lc", "u1")).thenReturn("https://client.test/next");

        String redirect = (String) controller.acceptLogin(body("username", "ana", "password", "pw", "loginChallenge", "lc")).get("redirectTo");
        assertThat(redirect).startsWith("/oauth/password-change?transaction=");
        verify(hydra, never()).acceptLogin(anyString(), anyString());

        String transaction = redirect.substring(redirect.indexOf('=') + 1);
        assertThat(controller.completePasswordChange(body("transaction", transaction, "password", "nueva-clave-1")))
                .containsEntry("redirectTo", "https://client.test/next");
    }

    @Test
    void rejectingThePasswordChangeRejectsTheLogin() {
        when(users.login("ana", "pw")).thenReturn(login(true));
        when(hydra.rejectLogin("lc")).thenReturn("https://client.test/denied");
        String redirect = (String) controller.acceptLogin(body("username", "ana", "password", "pw", "loginChallenge", "lc")).get("redirectTo");

        assertThat(controller.rejectPasswordChange(body("transaction", redirect.substring(redirect.indexOf('=') + 1))))
                .containsEntry("redirectTo", "https://client.test/denied");
    }

    @Test
    void passwordChangeRequestsNeedATransaction() {
        assertThatThrownBy(() -> controller.completePasswordChange(body("password", "x")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("PASSWORD_CHANGE_TRANSACTION_REQUIRED");
        assertThatThrownBy(() -> controller.rejectPasswordChange(body("transaction", " ")))
                .hasMessageContaining("PASSWORD_CHANGE_TRANSACTION_REQUIRED");
    }

    @Test
    void consentRequestFallsBackToTheAppNameAndKeepsOnlyTextScopes() throws Exception {
        when(hydra.getConsentRequest("cc")).thenReturn(json.readTree(
                "{\"client\":{\"client_name\":\" \"},\"requested_scope\":[\"openid\",\" \",7,\"mcp\"]}"));

        Map<String, Object> result = controller.consentRequest("cc");

        assertThat(result).containsEntry("clientName", "Skill Hub").containsEntry("requestedScopes", List.of("openid", "mcp"));
    }

    @Test
    void consentRequestHandlesMissingRequestsAndScopeLists() throws Exception {
        when(hydra.getConsentRequest("nulo")).thenReturn(null);
        assertThat(controller.consentRequest("nulo")).containsEntry("clientName", "Skill Hub").containsEntry("requestedScopes", List.of());

        when(hydra.getConsentRequest("sin")).thenReturn(json.readTree("{\"client\":{\"client_name\":\"Cursor\"},\"requested_scope\":\"openid\"}"));
        assertThat(controller.consentRequest("sin")).containsEntry("clientName", "Cursor").containsEntry("requestedScopes", List.of());
    }

    @Test
    void consentEndpointsNeedAChallenge() {
        assertThatThrownBy(() -> controller.consentRequest(" ")).isInstanceOf(ResponseStatusException.class)
                .extracting("statusCode").isEqualTo(HttpStatus.BAD_REQUEST);
        assertThatThrownBy(() -> controller.acceptConsent(Map.of("consentChallenge", 42))).hasMessageContaining("CONSENT_CHALLENGE_REQUIRED");
        assertThatThrownBy(() -> controller.rejectConsent(body())).hasMessageContaining("CONSENT_CHALLENGE_REQUIRED");
    }

    @Test
    void discoveryMetadataOnlyAdvertisesS256() {
        var metadata = controller.authorizationServerMetadata();

        assertThat(metadata.path("issuer").asText()).isEqualTo("https://hub.test/");
        assertThat(metadata.path("code_challenge_methods_supported").toString()).isEqualTo("[\"S256\"]");
    }

    @Test
    void discoveryMetadataThatIsNotAnObjectPassesThrough() {
        discovery = "[1,2]";
        assertThat(controller.authorizationServerMetadata().isArray()).isTrue();

        discovery = "";
        assertThat(controller.authorizationServerMetadata()).isNull();
    }

    @Test
    void unknownDiscoveryPathsAreNotFound() {
        var response = controller.unknownDiscoveryPath();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).containsEntry("error", "Discovery endpoint not found");
    }
}
