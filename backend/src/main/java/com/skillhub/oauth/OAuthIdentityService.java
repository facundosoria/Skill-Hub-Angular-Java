package com.skillhub.oauth;

import com.skillhub.auth.ApiKeyIdentity;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Resuelve la identidad de un usuario a partir de un access token JWT emitido
 * por Hydra, para /api/mcp. Misma forma que ApiKeyIdentity (apiKeyId queda
 * null: no hay fila en api_keys para un login OAuth) para que McpTools no
 * necesite distinguir el origen de la identidad.
 */
@Service
public class OAuthIdentityService {

    private static final Pattern UUID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final HydraJwtValidator validator;
    private final NamedParameterJdbcTemplate jdbc;

    public OAuthIdentityService(HydraJwtValidator validator, NamedParameterJdbcTemplate jdbc) {
        this.validator = validator;
        this.jdbc = jdbc;
    }

    /** null si el token es invalido, expirado, o el usuario ya no esta activo. */
    public ApiKeyIdentity identifyByAuthHeader(String authHeader) {
        String userId = validator.validateAndGetSubject(authHeader).orElse(null);
        if (userId == null || !UUID_PATTERN.matcher(userId).matches()) return null;

        List<ApiKeyIdentity> rows = jdbc.query(
                """
                SELECT username, team, role::text AS role
                FROM users
                WHERE id = :id::uuid AND status = 'active'
                LIMIT 1
                """,
                new MapSqlParameterSource("id", userId),
                (rs, i) -> new ApiKeyIdentity(
                        null,
                        userId,
                        rs.getString("username"),
                        rs.getString("team"),
                        rs.getString("role")));

        return rows.isEmpty() ? null : rows.get(0);
    }
}
