package com.skillhub.web;

import com.skillhub.audit.AuditService;
import com.skillhub.auth.ApiKeyService;
import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Puerto de src/server/keys/actions.ts. */
@RestController
@RequestMapping("/api/keys")
public class KeyController {

    private final NamedParameterJdbcTemplate jdbc;
    private final ApiKeyService keys;
    private final AuditService audit;

    public KeyController(NamedParameterJdbcTemplate jdbc, ApiKeyService keys, AuditService audit) {
        this.jdbc = jdbc;
        this.keys = keys;
        this.audit = audit;
    }

    @GetMapping
    public Map<String, Object> list(@AuthPrincipal CurrentUser user) {
        List<Map<String, Object>> rows = jdbc.query("""
                SELECT id::text AS id, name, prefix, last_used_at AS "lastUsedAt",
                       revoked_at AS "revokedAt", created_at AS "createdAt"
                FROM api_keys WHERE user_id = :uid::uuid ORDER BY created_at DESC
                """, new MapSqlParameterSource("uid", user.id()), (rs, i) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getString("id"));
            m.put("name", rs.getString("name"));
            m.put("prefix", rs.getString("prefix"));
            m.put("lastUsedAt", str(rs.getObject("lastUsedAt")));
            m.put("revokedAt", str(rs.getObject("revokedAt")));
            m.put("createdAt", str(rs.getObject("createdAt")));
            return m;
        });
        return Map.of("keys", rows);
    }

    @PostMapping
    public Map<String, Object> create(@AuthPrincipal CurrentUser user,
                                      @RequestBody(required = false) Map<String, String> body) {
        String name = body != null && body.get("name") != null && !body.get("name").isBlank()
                ? body.get("name").trim()
                : user.name() + " (" + (user.team() == null ? "sin equipo" : user.team()) + ")";
        var g = keys.generateApiKey();
        String id = jdbc.queryForObject("""
                INSERT INTO api_keys (user_id, name, key_hash, prefix)
                VALUES (:uid::uuid, :name, :hash, :prefix) RETURNING id::text
                """, new MapSqlParameterSource()
                .addValue("uid", user.id()).addValue("name", name)
                .addValue("hash", g.hash()).addValue("prefix", g.prefix()), String.class);
        audit.logAudit(user.id(), "apikey.created", "api_key", id,
                Map.of("name", name, "prefix", g.prefix()));
        return Map.of("created", g.raw());
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> revoke(@AuthPrincipal CurrentUser user, @PathVariable String id) {
        // El where incluye el user_id: nadie puede revocar la key de otro.
        var rows = jdbc.queryForList("""
                UPDATE api_keys SET revoked_at = now()
                WHERE id = :id::uuid AND user_id = :uid::uuid AND revoked_at IS NULL
                RETURNING id::text, prefix
                """, new MapSqlParameterSource().addValue("id", id).addValue("uid", user.id()));
        if (rows.isEmpty()) throw new DomainException("No se encontro esa key");
        audit.logAudit(user.id(), "apikey.revoked", "api_key", id,
                Map.of("prefix", rows.get(0).get("prefix")));
        return Map.of("ok", true);
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }
}
