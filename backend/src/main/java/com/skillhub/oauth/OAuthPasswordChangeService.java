package com.skillhub.oauth;

import com.skillhub.web.DomainException;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * Guarda en memoria la continuacion efimera de un login OAuth que requiere
 * cambio de contrasena. No contiene contrasenas: solo referencias necesarias
 * para completar el login pendiente despues del cambio exitoso.
 */
@Service
public class OAuthPasswordChangeService {

    private static final Duration TTL = Duration.ofMinutes(10);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Map<String, PendingChange> pending = new ConcurrentHashMap<>();

    public String create(String loginChallenge, String userId, String passwordChangeNonce) {
        if (loginChallenge == null || loginChallenge.isBlank()
                || userId == null || userId.isBlank()
                || passwordChangeNonce == null || passwordChangeNonce.isBlank()) {
            throw new DomainException("No hay un cambio de contrasena OAuth valido");
        }

        purgeExpired();
        byte[] tokenBytes = new byte[32];
        RANDOM.nextBytes(tokenBytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);
        pending.put(token, new PendingChange(loginChallenge, userId, passwordChangeNonce,
                Instant.now().plus(TTL)));
        return token;
    }

    /**
     * Ejecuta una sola continuacion bajo lock. Si la operacion falla (por
     * ejemplo, una contrasena invalida), la transaccion permanece disponible.
     * Si termina bien, se consume antes de volver al controlador.
     */
    public <T> T complete(String token, Function<PendingChange, T> operation) {
        PendingChange transaction = require(token);
        synchronized (transaction) {
            if (pending.get(token) != transaction || transaction.expired()) {
                pending.remove(token, transaction);
                throw invalidTransaction();
            }
            T result = operation.apply(transaction);
            pending.remove(token, transaction);
            return result;
        }
    }

    /** Invalida una transaccion sin consumir ningun secreto ni challenge en logs. */
    public PendingChange reject(String token) {
        PendingChange transaction = require(token);
        if (!pending.remove(token, transaction)) throw invalidTransaction();
        return transaction;
    }

    /** Invalida las continuaciones OAuth pendientes de una cuenta al cerrar sesion. */
    public void invalidateForUser(String userId) {
        if (userId == null || userId.isBlank()) return;
        pending.entrySet().removeIf(entry -> userId.equals(entry.getValue().userId()));
    }

    private PendingChange require(String token) {
        if (token == null || token.isBlank()) throw invalidTransaction();
        PendingChange transaction = pending.get(token);
        if (transaction == null || transaction.expired()) {
            if (transaction != null) pending.remove(token, transaction);
            throw invalidTransaction();
        }
        return transaction;
    }

    private void purgeExpired() {
        Instant now = Instant.now();
        pending.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
    }

    private DomainException invalidTransaction() {
        return new DomainException("El cambio de contrasena OAuth ya no es valido");
    }

    public record PendingChange(String loginChallenge, String userId,
                                String passwordChangeNonce, Instant expiresAt) {
        private boolean expired() {
            return !expiresAt.isAfter(Instant.now());
        }
    }
}
