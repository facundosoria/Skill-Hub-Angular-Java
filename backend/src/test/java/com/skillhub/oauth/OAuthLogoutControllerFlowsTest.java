package com.skillhub.oauth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.session.SessionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Cierre de sesion OAuth: nombre del cliente, aceptacion con limpieza de la
 * sesion local y rechazo, siempre con un challenge valido de Hydra.
 */
class OAuthLogoutControllerFlowsTest {

    private final ObjectMapper json = new ObjectMapper();
    private HydraAdminClient hydra;
    private SessionService sessions;
    private OAuthPasswordChangeService passwordChanges;
    private OAuthLogoutController controller;

    @BeforeEach
    void setUp() {
        hydra = mock(HydraAdminClient.class);
        sessions = mock(SessionService.class);
        passwordChanges = mock(OAuthPasswordChangeService.class);
        controller = new OAuthLogoutController(hydra, sessions, passwordChanges);
    }

    private static Map<String, String> body(String challenge) {
        Map<String, String> body = new HashMap<>();
        body.put("logoutChallenge", challenge);
        return body;
    }

    private void request(String raw) throws Exception {
        when(hydra.getLogoutRequest("lc")).thenReturn(json.readTree(raw));
    }

    @Test
    void showsTheClientNameOrTheAppName() throws Exception {
        request("{\"client\":{\"client_name\":\"Cursor\"}}");
        assertThat(controller.logoutRequest("lc")).containsEntry("clientName", "Cursor");

        request("{\"client\":{}}");
        assertThat(controller.logoutRequest("lc")).containsEntry("clientName", "Skill Hub");
    }

    @Test
    void acceptingUsesTheHydraSubjectAndClearsTheSession() throws Exception {
        request("{\"subject\":\"u1\"}");
        when(hydra.acceptLogout("lc")).thenReturn("https://client.test/bye");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(controller.acceptLogout(body("lc"), new MockHttpServletRequest(), response)).containsEntry("redirectTo", "https://client.test/bye");

        verify(sessions).destroySession(response);
        verify(passwordChanges).invalidateForUser("u1");
        verify(sessions, never()).readSession(any(jakarta.servlet.http.HttpServletRequest.class));
    }

    @Test
    void acceptingFallsBackToTheLocalSessionSubject() throws Exception {
        request("{\"subject\":\" \"}");
        when(sessions.readSession(any(jakarta.servlet.http.HttpServletRequest.class)))
                .thenReturn(new SessionService.SessionPayload("u9", "ana", "member", null));

        assertThat(controller.acceptLogout(body("lc"), new MockHttpServletRequest(), new MockHttpServletResponse()))
                .containsEntry("redirectTo", "");
        verify(passwordChanges).invalidateForUser("u9");
    }

    @Test
    void acceptingWithoutAnySubjectStillLogsOut() throws Exception {
        request("{}");

        controller.acceptLogout(body("lc"), new MockHttpServletRequest(), new MockHttpServletResponse());

        verify(passwordChanges).invalidateForUser(null);
    }

    @Test
    void rejectingKeepsTheSession() throws Exception {
        request("{}");
        when(hydra.rejectLogout("lc")).thenReturn("https://client.test/stay");

        assertThat(controller.rejectLogout(body("lc"))).containsEntry("redirectTo", "https://client.test/stay");
        when(hydra.rejectLogout("lc")).thenReturn(null);
        assertThat(controller.rejectLogout(body("lc"))).containsEntry("redirectTo", "");
        verify(sessions, never()).destroySession(any());
    }

    @Test
    void invalidChallengesAreBadRequests() throws Exception {
        assertThatThrownBy(() -> controller.logoutRequest(" ")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
        assertThatThrownBy(() -> controller.acceptLogout(null, new MockHttpServletRequest(), new MockHttpServletResponse())).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
        assertThatThrownBy(() -> controller.rejectLogout(null)).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
        assertThatThrownBy(() -> controller.rejectLogout(body(null))).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");

        when(hydra.getLogoutRequest("nulo")).thenReturn(null);
        assertThatThrownBy(() -> controller.logoutRequest("nulo")).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
        when(hydra.getLogoutRequest("json-null")).thenReturn(json.readTree("null"));
        assertThatThrownBy(() -> controller.logoutRequest("json-null")).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
        when(hydra.getLogoutRequest("missing")).thenReturn(json.missingNode());
        assertThatThrownBy(() -> controller.logoutRequest("missing")).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
        when(hydra.getLogoutRequest("caido")).thenThrow(new RestClientException("hydra caido"));
        assertThatThrownBy(() -> controller.logoutRequest("caido")).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
    }

    @Test
    void hydraFailuresWhileAnsweringAreBadRequests() throws Exception {
        request("{\"subject\":\"u1\"}");
        when(hydra.acceptLogout("lc")).thenThrow(new IllegalArgumentException("challenge viejo"));
        when(hydra.rejectLogout("lc")).thenThrow(new RestClientException("hydra caido"));

        assertThatThrownBy(() -> controller.acceptLogout(body("lc"), new MockHttpServletRequest(), new MockHttpServletResponse()))
                .hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
        assertThatThrownBy(() -> controller.rejectLogout(body("lc"))).hasMessageContaining("LOGOUT_CHALLENGE_INVALID");
        verify(sessions, never()).destroySession(any());
    }
}
