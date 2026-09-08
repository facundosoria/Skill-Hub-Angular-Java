package com.skillhub.web;

import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Puerto de src/app/(app)/audit/page.tsx. Solo admin. */
@RestController
@RequestMapping("/api/audit")
public class AuditController {

    private static final int PAGE_SIZE = 60;
    private final NamedParameterJdbcTemplate jdbc;

    public AuditController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public Map<String, Object> list(@AuthPrincipal CurrentUser user,
                                    @RequestParam(required = false) String action,
                                    @RequestParam(required = false) String actor) {
        if (!user.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un admin");

        List<String> where = new ArrayList<>();
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("lim", PAGE_SIZE);
        if (action != null) { where.add("a.action = :action"); p.addValue("action", action); }
        if (actor != null) { where.add("a.actor_id = :actor::uuid"); p.addValue("actor", actor); }
        String filter = where.isEmpty() ? "" : "WHERE " + String.join(" AND ", where);

        List<Map<String, Object>> events = jdbc.query("""
                SELECT a.id::text AS id, a.action, a.target_type AS "targetType", a.metadata,
                       a.actor_snapshot AS "actorSnapshot", a.created_at AS "createdAt",
                       a.actor_id::text AS "actorId",
                       u.name AS "actorName", u.username AS "actorUsername",
                       u.team AS "actorTeam", u.role::text AS "actorRole"
                FROM audit_events a
                LEFT JOIN users u ON u.id = a.actor_id
                """ + filter + """

                ORDER BY a.created_at DESC
                LIMIT :lim
                """, p, (rs, i) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getString("id"));
            m.put("action", rs.getString("action"));
            m.put("targetType", rs.getString("targetType"));
            m.put("metadata", rs.getString("metadata"));
            m.put("actorSnapshot", rs.getString("actorSnapshot"));
            m.put("createdAt", String.valueOf(rs.getObject("createdAt")));
            m.put("actorId", rs.getString("actorId"));
            m.put("actorName", rs.getString("actorName"));
            m.put("actorUsername", rs.getString("actorUsername"));
            m.put("actorTeam", rs.getString("actorTeam"));
            m.put("actorRole", rs.getString("actorRole"));
            return m;
        });

        var acciones = jdbc.getJdbcTemplate().queryForList(
                "SELECT action, COUNT(*)::int AS n FROM audit_events GROUP BY action ORDER BY n DESC");
        var actores = jdbc.getJdbcTemplate().queryForList("""
                SELECT u.id::text AS id, u.name, u.team, COUNT(*)::int AS n
                FROM audit_events a JOIN users u ON u.id = a.actor_id
                GROUP BY u.id, u.name, u.team ORDER BY n DESC LIMIT 20
                """);

        return Map.of("events", events, "actions", acciones, "actors", actores);
    }
}
