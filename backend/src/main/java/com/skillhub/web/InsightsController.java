package com.skillhub.web;

import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/**
 * Puerto de src/app/(app)/insights/page.tsx. Solo admin.
 *
 * Todo sale de usage_daily / missed_queries, nunca de las filas crudas
 * (decision 14): no hay ninguna consulta que pueda responder "que consulto X".
 */
@RestController
@RequestMapping("/api/insights")
public class InsightsController {

    private final JdbcTemplate jdbc;

    public InsightsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public Map<String, Object> get(@AuthPrincipal CurrentUser user) {
        if (!user.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un admin");

        var top = jdbc.queryForList("""
                SELECT s.slug, s.title,
                       COALESCE(SUM(ud.hits), 0)::int AS hits,
                       COALESCE(MAX(ud.distinct_users), 0)::int AS personas
                FROM usage_daily ud JOIN skills s ON s.id = ud.skill_id
                WHERE ud.day >= CURRENT_DATE - 90 * INTERVAL '1 day'
                GROUP BY s.slug, s.title ORDER BY hits DESC LIMIT 10
                """);
        var teams = jdbc.queryForList("""
                SELECT t.team,
                       COALESCE(SUM(ud.hits), 0)::int AS hits,
                       COUNT(DISTINCT ud.skill_id)::int AS skills
                FROM (
                    SELECT DISTINCT team FROM users WHERE team IS NOT NULL AND team <> ''
                    UNION
                    SELECT DISTINCT COALESCE(NULLIF(team, ''), 'sin equipo') AS team FROM usage_daily
                ) t
                LEFT JOIN usage_daily ud ON COALESCE(NULLIF(ud.team, ''), 'sin equipo') = t.team
                                        AND ud.day >= CURRENT_DATE - 90 * INTERVAL '1 day'
                GROUP BY t.team
                ORDER BY hits DESC, t.team ASC
                """);
        var missed = jdbc.queryForList("""
                SELECT query_text, COUNT(*)::int AS veces
                FROM missed_queries
                WHERE created_at >= now() - 90 * INTERVAL '1 day'
                GROUP BY query_text ORDER BY veces DESC, MAX(created_at) DESC LIMIT 15
                """);
        return Map.of("top", top, "teams", teams, "missed", missed);
    }
}
