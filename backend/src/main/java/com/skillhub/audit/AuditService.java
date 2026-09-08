package com.skillhub.audit;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Puerto de src/server/audit.ts.
 *
 * Punto unico por el que pasa TODO cambio. A diferencia de la telemetria de
 * uso, esta escritura SI es sincrona: si falla, el cambio no deberia darse por
 * hecho. Guarda una copia (snapshot) de la identidad del actor ademas de su id,
 * porque actor_id es ON DELETE SET NULL.
 */
@Service
public class AuditService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper json;

    public AuditService(NamedParameterJdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void logAudit(String actorId, String action, String targetType,
                         String targetId, Map<String, Object> metadata) {
        String snapshot = actorId == null ? null : snapshotOf(actorId);
        // metadata y actor_snapshot son columnas text en el schema original
        // (se guarda JSON.stringify, no jsonb).
        jdbc.update("""
                INSERT INTO audit_events (actor_id, actor_snapshot, action, target_type, target_id, metadata)
                VALUES (:actorId::uuid, :snapshot, :action, :targetType, :targetId::uuid, :metadata)
                """, new MapSqlParameterSource()
                .addValue("actorId", actorId)
                .addValue("snapshot", snapshot)
                .addValue("action", action)
                .addValue("targetType", targetType)
                .addValue("targetId", targetId)
                .addValue("metadata", metadata == null ? null : write(metadata)));
    }

    private String snapshotOf(String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT name, username, team, role::text AS role FROM users WHERE id = :id::uuid",
                new MapSqlParameterSource("id", userId));
        return rows.isEmpty() ? null : write(rows.get(0));
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
