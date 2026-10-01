package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.session.CurrentUser;
import com.skillhub.session.SessionService;
import com.skillhub.session.UserService;
import com.skillhub.web.DomainException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class OAuthPasswordChangeFlowTest {

    private static final String USER_ID = "5f8d5d3e-8b2a-45fb-9b50-9b9c9e9c9f21";
    private static final String NONCE = "d3c0ffee-8b2a-45fb-9b50-9b9c9e9c9f21";

    @Test
    void normalUserAcceptsLoginChallengeImmediately() {
        UserService users = mock(UserService.class);
        FakeHydra hydra = new FakeHydra();
        OAuthController controller = new OAuthController(users, hydra, new OAuthPasswordChangeService(),
                "https://hub.test/api/mcp", "https://hub.test/", "http://hydra:4444");
        UserService.LoginResult login = loginResult(false, null);
        when(users.login("active", "password")).thenReturn(login);
        hydra.acceptRedirect = "https://client.test/callback?code=normal";

        Map<String, Object> response = controller.acceptLogin(Map.of(
                "loginChallenge", "login-normal", "username", "active", "password", "password"));

        assertThat(response).containsEntry("redirectTo", hydra.acceptRedirect);
        assertThat(hydra.acceptedLoginChallenge).isEqualTo("login-normal");
        verify(users, never()).changeRequiredPassword(anyString(), anyString(), anyString());
    }

    @Test
    void temporaryUserIsHeldUntilPasswordChangeThenContinuesOAuth() {
        UserService users = mock(UserService.class);
        FakeHydra hydra = new FakeHydra();
        OAuthController controller = new OAuthController(users, hydra, new OAuthPasswordChangeService(),
                "https://hub.test/api/mcp", "https://hub.test/", "http://hydra:4444");
        when(users.login("temporary", "password")).thenReturn(loginResult(true, NONCE));
        when(users.changeRequiredPassword(USER_ID, NONCE, "new-password-1"))
                .thenReturn(loginResult(false, null));
        hydra.acceptRedirect = "https://client.test/callback?code=changed";

        Map<String, Object> pending = controller.acceptLogin(Map.of(
                "loginChallenge", "login-temporary", "username", "temporary", "password", "password"));

        assertThat(pending.get("redirectTo").toString()).startsWith("/oauth/password-change?transaction=");
        assertThat(hydra.acceptedLoginChallenge).isNull();

        String transaction = pending.get("redirectTo").toString().substring(
                "/oauth/password-change?transaction=".length());
        Map<String, Object> completed = controller.completePasswordChange(Map.of(
                "transaction", transaction, "password", "new-password-1"));

        assertThat(completed).containsEntry("redirectTo", hydra.acceptRedirect);
        verify(users).changeRequiredPassword(USER_ID, NONCE, "new-password-1");
        assertThat(hydra.acceptedLoginChallenge).isEqualTo("login-temporary");
    }

    @Test
    void invalidPasswordDoesNotConsumePendingOAuthFlow() {
        UserService users = mock(UserService.class);
        FakeHydra hydra = new FakeHydra();
        OAuthPasswordChangeService transactions = new OAuthPasswordChangeService();
        OAuthController controller = new OAuthController(users, hydra, transactions,
                "https://hub.test/api/mcp", "https://hub.test/", "http://hydra:4444");
        when(users.login("temporary", "password")).thenReturn(loginResult(true, NONCE));
        when(users.changeRequiredPassword(USER_ID, NONCE, "bad-password-1"))
                .thenThrow(new DomainException("La contrasena temporal fue reemplazada"));
        when(users.changeRequiredPassword(USER_ID, NONCE, "new-password-1"))
                .thenReturn(loginResult(false, null));

        String redirect = controller.acceptLogin(Map.of(
                "loginChallenge", "login-retry", "username", "temporary", "password", "password"))
                .get("redirectTo").toString();
        String transaction = redirect.substring("/oauth/password-change?transaction=".length());

        assertThatThrownBy(() -> controller.completePasswordChange(Map.of(
                "transaction", transaction, "password", "bad-password-1")))
                .isInstanceOf(DomainException.class);
        assertThat(controller.completePasswordChange(Map.of(
                "transaction", transaction, "password", "new-password-1")))
                .containsEntry("redirectTo", hydra.acceptRedirect);
    }

    @Test
    void rejectedOrReusedOrExpiredTransactionsCannotContinue() throws Exception {
        OAuthPasswordChangeService transactions = new OAuthPasswordChangeService();
        String token = transactions.create("login-reject", USER_ID, NONCE);
        OAuthPasswordChangeService.PendingChange pending = transactions.reject(token);

        assertThat(pending.loginChallenge()).isEqualTo("login-reject");
        assertThatThrownBy(() -> transactions.complete(token, ignored -> "unexpected"))
                .isInstanceOf(DomainException.class);

        String expiredToken = transactions.create("login-expired", USER_ID, NONCE);
        var field = OAuthPasswordChangeService.class.getDeclaredField("pending");
        field.setAccessible(true);
        @SuppressWarnings("unchecked")
        Map<String, OAuthPasswordChangeService.PendingChange> pendingMap =
                (Map<String, OAuthPasswordChangeService.PendingChange>) field.get(transactions);
        pendingMap.put(expiredToken, new OAuthPasswordChangeService.PendingChange(
                "login-expired", USER_ID, NONCE, Instant.now().minusSeconds(1)));

        assertThatThrownBy(() -> transactions.complete(expiredToken, ignored -> "unexpected"))
                .isInstanceOf(DomainException.class);
    }

    @Test
    void inactiveUserCannotCreateOAuthContinuation() {
        UserService users = mock(UserService.class);
        OAuthController controller = new OAuthController(users, new FakeHydra(), new OAuthPasswordChangeService(),
                "https://hub.test/api/mcp", "https://hub.test/", "http://hydra:4444");
        when(users.login("inactive", "password"))
                .thenThrow(new DomainException("Tu cuenta se encuentra desactivada."));

        assertThatThrownBy(() -> controller.acceptLogin(Map.of(
                "loginChallenge", "login-inactive", "username", "inactive", "password", "password")))
                .isInstanceOf(DomainException.class);
    }

    private static UserService.LoginResult loginResult(boolean mustChange, String nonce) {
        CurrentUser user = new CurrentUser(USER_ID, "user", "User", "platform", "member", mustChange);
        return new UserService.LoginResult(user,
                new SessionService.SessionPayload(USER_ID, "user", "member", nonce));
    }

    private static final class FakeHydra extends HydraAdminClient {
        private String acceptedLoginChallenge;
        private String acceptRedirect = "https://client.test/callback?code=default";

        private FakeHydra() {
            super("http://hydra.invalid");
        }

        @Override
        public String acceptLogin(String loginChallenge, String userId) {
            acceptedLoginChallenge = loginChallenge;
            return acceptRedirect;
        }
    }
}
