package com.skillhub.auth;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;

/**
 * Puerto de src/server/auth/apikey.ts.
 *
 * La key en claro lleva el prefijo "sk_hub_"; en la base solo vive el SHA-256
 * hex. El lookup filtra por revoked_at IS NULL, asi que una key revocada deja
 * de servir de inmediato.
 */
@Service
public class ApiKeyService {

    private static final String PREFIX = "sk_hub_";

    private final NamedParameterJdbcTemplate jdbc;

    public ApiKeyService(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final SecureRandom RNG = new SecureRandom();

    /** Puerto de generateApiKey(): el valor en claro se devuelve UNA sola vez. */
    public record GeneratedKey(String raw, String hash, String prefix) {}

    public GeneratedKey generateApiKey() {
        byte[] rnd = new byte[24];
        RNG.nextBytes(rnd);
        String raw = PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(rnd);
        return new GeneratedKey(raw, hashApiKey(raw), raw.substring(0, PREFIX.length() + 6));
    }

    public static String hashApiKey(String raw) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Verifica un header "Authorization: Bearer sk_hub_...". null si no sirve. */
    public ApiKeyIdentity identifyByAuthHeader(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) return null;
        String raw = authHeader.substring(7).trim();
        if (!raw.startsWith(PREFIX)) return null;

        String hash = hashApiKey(raw);
        List<ApiKeyIdentity> rows = jdbc.query(
                """
                SELECT k.id         AS api_key_id,
                       u.id         AS user_id,
                       u.username   AS username,
                       u.team       AS team,
                       u.role::text AS role
                FROM api_keys k
                JOIN users u ON u.id = k.user_id
                WHERE k.key_hash = :hash AND k.revoked_at IS NULL
                LIMIT 1
                """,
                new MapSqlParameterSource("hash", hash),
                (rs, i) -> new ApiKeyIdentity(
                        rs.getString("api_key_id"),
                        rs.getString("user_id"),
                        rs.getString("username"),
                        rs.getString("team"),
                        rs.getString("role")));

        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Fuera del camino critico: nunca debe bloquear la respuesta. */
    public void touchApiKey(String apiKeyId) {
        try {
            jdbc.update("UPDATE api_keys SET last_used_at = now() WHERE id = :id::uuid",
                    new MapSqlParameterSource("id", apiKeyId));
        } catch (RuntimeException ignored) {
            // se ignora a proposito
        }
    }
}
