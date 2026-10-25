package com.skillhub.oauth;

import com.skillhub.web.DomainException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.lang.reflect.Field;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Continuaciones efimeras del login OAuth con cambio de contrasena: se usan
 * una sola vez, sobreviven a un intento fallido y vencen a los diez minutos.
 */
class OAuthPasswordChangeServiceTest {

    private final OAuthPasswordChangeService service = new OAuthPasswordChangeService();

    @ParameterizedTest
    @CsvSource(nullValues = "NULL", value = {
            "NULL,u1,n1", "' ',u1,n1", "c1,NULL,n1", "c1,' ',n1", "c1,u1,NULL", "c1,u1,' '"})
    void requiresChallengeUserAndNonce(String challenge, String user, String nonce) {
        assertThatThrownBy(() -> service.create(challenge, user, nonce))
                .isInstanceOf(DomainException.class).hasMessage("No hay un cambio de contrasena OAuth valido");
    }

    @Test
    void completesOnceAndThenTheTokenIsGone() {
        String token = service.create("c1", "u1", "n1");

        String result = service.complete(token, change -> change.loginChallenge() + "/" + change.passwordChangeNonce());

        assertThat(result).isEqualTo("c1/n1");
        assertThatThrownBy(() -> service.complete(token, change -> "otra vez")).hasMessage("El cambio de contrasena OAuth ya no es valido");
    }

    @Test
    void aFailedOperationKeepsTheContinuationAvailable() {
        String token = service.create("c1", "u1", "n1");
        AtomicInteger attempts = new AtomicInteger();

        assertThatThrownBy(() -> service.complete(token, change -> { attempts.incrementAndGet(); throw new DomainException("clave invalida"); }))
                .hasMessage("clave invalida");

        int second = service.complete(token, change -> attempts.incrementAndGet());
        assertThat(second).isEqualTo(2);
    }

    @Test
    void rejectsMissingOrUnknownTokens() {
        assertThatThrownBy(() -> service.complete(null, change -> 1)).hasMessage("El cambio de contrasena OAuth ya no es valido");
        assertThatThrownBy(() -> service.complete(" ", change -> 1)).hasMessage("El cambio de contrasena OAuth ya no es valido");
        assertThatThrownBy(() -> service.reject("inventado")).hasMessage("El cambio de contrasena OAuth ya no es valido");
    }

    @Test
    void rejectingConsumesTheContinuation() {
        String token = service.create("c1", "u1", "n1");

        assertThat(service.reject(token).userId()).isEqualTo("u1");
        assertThatThrownBy(() -> service.reject(token)).isInstanceOf(DomainException.class);
    }

    @Test
    void logoutInvalidatesEveryContinuationOfTheUser() {
        String mine = service.create("c1", "u1", "n1");
        String other = service.create("c2", "u2", "n2");

        service.invalidateForUser(null);
        service.invalidateForUser(" ");
        service.invalidateForUser("u1");

        assertThatThrownBy(() -> service.reject(mine)).isInstanceOf(DomainException.class);
        assertThat(service.reject(other).userId()).isEqualTo("u2");
    }

    @Test
    void expiredContinuationsAreRejectedAndPurged() throws Exception {
        String token = service.create("c1", "u1", "n1");
        expire(token);

        assertThatThrownBy(() -> service.complete(token, change -> 1)).hasMessage("El cambio de contrasena OAuth ya no es valido");
        assertThat(pending()).doesNotContainKey(token);

        String stale = service.create("c2", "u2", "n2");
        expire(stale);
        service.create("c3", "u3", "n3");
        assertThat(pending()).doesNotContainKey(stale);
    }

    private void expire(String token) throws Exception {
        var change = pending().get(token);
        pending().put(token, new OAuthPasswordChangeService.PendingChange(change.loginChallenge(), change.userId(),
                change.passwordChangeNonce(), Instant.now().minusSeconds(1)));
    }

    @SuppressWarnings("unchecked")
    private Map<String, OAuthPasswordChangeService.PendingChange> pending() throws Exception {
        Field field = OAuthPasswordChangeService.class.getDeclaredField("pending");
        field.setAccessible(true);
        return (Map<String, OAuthPasswordChangeService.PendingChange>) field.get(service);
    }
}
