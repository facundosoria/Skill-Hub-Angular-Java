package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.session.SessionService;
import com.skillhub.session.UserService;
import com.skillhub.web.AuthController;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class OAuthLogoutTest {

    private static final String USER_ID = "5f8d5d3e-8b2a-45fb-9b50-9b9c9e9c9f21";

    private FakeHydra hydra;
    private SessionService sessions;
    private OAuthPasswordChangeService passwordChanges;
    private OAuthLogoutController controller;
    private HttpServletRequest request;
    private HttpServletResponse response;

    @BeforeEach
    void setUp() {
        hydra = new FakeHydra();
        sessions = mock(SessionService.class);
        passwordChanges = mock(OAuthPasswordChangeService.class);
        controller = new OAuthLogoutController(hydra, sessions, passwordChanges);
        request = mock(HttpServletRequest.class);
        response = mock(HttpServletResponse.class);
    }

    @Test
    void acceptedLogoutClearsSessionInvalidatesPendingTransactionsAndRedirects() throws Exception {
        hydra.request = new ObjectMapper().readTree("""
                {"subject":"5f8d5d3e-8b2a-45fb-9b50-9b9c9e9c9f21", "client":{"client_name":"Claude"}}
                """);
        hydra.acceptRedirect = "https://client.test/logout-callback";

        Map<String, Object> result = controller.acceptLogout(
                Map.of("logoutChallenge", "logout-accepted"), request, response);

        assertThat(result).containsEntry("redirectTo", hydra.acceptRedirect);
        verify(sessions).destroySession(response);
        verify(passwordChanges).invalidateForUser(USER_ID);
        assertThat(hydra.acceptedChallenge).isEqualTo("logout-accepted");
    }

    @Test
    void acceptedLogoutWithoutSessionStillClearsCookie() throws Exception {
        hydra.request = new ObjectMapper().readTree("""
                {"client":{"client_name":"Client without local session"}}
                """);
        when(sessions.readSession(request)).thenReturn(null);

        controller.acceptLogout(Map.of("logoutChallenge", "logout-no-session"), request, response);

        verify(sessions).readSession(request);
        verify(sessions).destroySession(response);
        verify(passwordChanges).invalidateForUser(null);
    }

    @Test
    void rejectedLogoutPreservesLocalSession() throws Exception {
        hydra.request = new ObjectMapper().readTree("""
                {"subject":"5f8d5d3e-8b2a-45fb-9b9c9e9c9f21", "client":{"client_name":"Claude"}}
                """);
        hydra.rejectRedirect = "https://client.test/callback?error=access_denied";

        Map<String, Object> result = controller.rejectLogout(
                Map.of("logoutChallenge", "logout-rejected"));

        assertThat(result).containsEntry("redirectTo", hydra.rejectRedirect);
        verifyNoInteractions(sessions, passwordChanges);
        assertThat(hydra.rejectedChallenge).isEqualTo("logout-rejected");
    }

    @Test
    void invalidOrExpiredChallengeReturnsGenericErrorWithoutClearingSession() {
        hydra.request = null;

        assertThatThrownBy(() -> controller.logoutRequest("expired-or-invalid"))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
                        .isEqualTo(HttpStatus.BAD_REQUEST));
        verifyNoInteractions(sessions, passwordChanges);
    }

    @Test
    void missingChallengeReturnsGenericError() {
        assertThatThrownBy(() -> controller.acceptLogout(Map.of(), request, response))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getReason())
                        .isEqualTo("LOGOUT_CHALLENGE_INVALID"));
        verifyNoInteractions(sessions, passwordChanges);
    }

    @Test
    void authMeIsUnauthorizedAfterLogoutClearsCurrentSession() {
        when(sessions.getCurrentUser(request)).thenReturn(null);
        AuthController auth = new AuthController(mock(UserService.class), sessions);

        assertThatThrownBy(() -> auth.me(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
                        .isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void sessionServiceUsesDeletionCookieForAcceptedLogout() {
        SessionService realSessions = new SessionService(
                "test-session-secret-with-at-least-32-chars", false,
                mock(NamedParameterJdbcTemplate.class));
        MockHttpServletResponse servletResponse = new MockHttpServletResponse();

        realSessions.destroySession(servletResponse);

        assertThat(servletResponse.getHeader("Set-Cookie"))
                .startsWith("skillhub_session=; Path=/; Max-Age=0")
                .contains("HttpOnly")
                .contains("SameSite=Lax");
    }

    private static final class FakeHydra extends HydraAdminClient {
        private JsonNode request;
        private String acceptedChallenge;
        private String rejectedChallenge;
        private String acceptRedirect = "https://client.test/logout-callback";
        private String rejectRedirect = "https://client.test/callback?error=access_denied";

        private FakeHydra() {
            super("http://hydra.invalid");
        }

        @Override
        public JsonNode getLogoutRequest(String logoutChallenge) {
            return request;
        }

        @Override
        public String acceptLogout(String logoutChallenge) {
            acceptedChallenge = logoutChallenge;
            return acceptRedirect;
        }

        @Override
        public String rejectLogout(String logoutChallenge) {
            rejectedChallenge = logoutChallenge;
            return rejectRedirect;
        }
    }
}
