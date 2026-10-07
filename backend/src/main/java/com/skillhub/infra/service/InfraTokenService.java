package com.skillhub.infra.service;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;

@Service
public class InfraTokenService {

    private static final String PREFIX = "sk_svc_";
    private static final SecureRandom RNG = new SecureRandom();

    private final NamedParameterJdbcTemplate jdbc;

    public InfraTokenService(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** El token en claro se devuelve una sola vez; solo su hash debe persistirse. */
    public record GeneratedToken(String raw, String hash, String prefix) {}

    public GeneratedToken generateServiceToken() {
        byte[] randomBytes = new byte[24];
        RNG.nextBytes(randomBytes);
        String raw = PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
        return new GeneratedToken(raw, hashServiceToken(raw), raw.substring(0, PREFIX.length() + 6));
    }

    /** Persists only token metadata and its hash; the raw token is returned by the caller once. */
    public void persistServiceToken(String serviceId, String name, GeneratedToken token) {
        jdbc.update("""
                INSERT INTO infra_service_tokens (service_id, name, token_hash, token_prefix)
                VALUES (:serviceId, :name, :hash, :prefix)
                """, new MapSqlParameterSource()
                .addValue("serviceId", serviceId)
                .addValue("name", name)
                .addValue("hash", token.hash())
                .addValue("prefix", token.prefix()));
    }

    public static String hashServiceToken(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Throws 401 for missing, malformed, unknown or revoked tokens and 403 for a service mismatch. */
    public boolean validateServiceToken(String rawToken, String expectedServiceId) {
        if (rawToken == null || !rawToken.startsWith(PREFIX)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "SERVICE_TOKEN_INVALID");
        }

        String hash = hashServiceToken(rawToken);
        List<String> serviceIds = jdbc.query(
                """
                SELECT service_id
                FROM infra_service_tokens
                WHERE token_hash = :hash AND revoked_at IS NULL
                LIMIT 1
                """,
                new MapSqlParameterSource("hash", hash),
                (rs, rowNum) -> rs.getString("service_id"));

        if (serviceIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "SERVICE_TOKEN_INVALID");
        }
        if (!serviceIds.get(0).equals(expectedServiceId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "SERVICE_TOKEN_SERVICE_MISMATCH");
        }
        return true;
    }
}
