package com.skillhub.skill;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Puerto verbatim de src/server/skills/search.ts.
 *
 * Ranking (decision 15): la relevancia textual manda, el uso solo empuja.
 *   score = ts_rank x max(1 + ln(1 + usos_90d) * 0.2, gracia)
 *
 * Tres pasadas:
 *  1. estricta  - websearch_to_tsquery une con AND: matchea solo si estan todos los terminos.
 *  2. laxa      - se reescribe el AND a OR sobre la tsquery ya parseada (sin inyeccion),
 *                 con piso de ts_rank para que una palabra suelta no matchee todo.
 *  3. trigramas - un typo no deberia devolver vacio.
 */
@Repository
public class SearchRepository {

    public static final int SEARCH_RESULT_LIMIT = 5;
    private static final double USAGE_WEIGHT = 0.2;
    private static final double GRACE_MULTIPLIER = 1.35; // ~5 usos
    private static final int GRACE_DAYS = 30;
    private static final int USAGE_WINDOW_DAYS = 90;
    private static final double MIN_RANK_LOOSE = 0.02;

    private final NamedParameterJdbcTemplate jdbc;

    public SearchRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<SearchHit> searchSkills(String query, String stack, String type, Integer limitOpt) {
        int limit = Math.min(limitOpt == null ? SEARCH_RESULT_LIMIT : limitOpt, 25);
        String q = query == null ? "" : query.trim();
        if (q.isEmpty()) return List.of();

        var strict = runQuery(
                "websearch_to_tsquery('english', :q::text)", q, stack, type, limit, null);
        if (!strict.isEmpty()) return strict;

        var loose = runQuery(
                "replace(websearch_to_tsquery('english', :q::text)::text, ' & ', ' | ')::tsquery",
                q, stack, type, limit, MIN_RANK_LOOSE);
        if (!loose.isEmpty()) return loose;

        return fuzzySearch(q, stack, type, limit);
    }

    private List<SearchHit> runQuery(String tsqueryExpr, String q, String stack, String type,
                                     int limit, Double minRank) {
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("q", q)
                .addValue("stack", stack)
                .addValue("type", type)
                .addValue("minRank", minRank)
                .addValue("limit", limit)
                .addValue("usageWindow", USAGE_WINDOW_DAYS)
                .addValue("usageWeight", USAGE_WEIGHT)
                .addValue("graceDays", GRACE_DAYS)
                .addValue("graceMultiplier", GRACE_MULTIPLIER);

        String sql = """
            WITH usage AS (
              SELECT skill_id,
                     COALESCE(SUM(hits), 0)::int AS usos_90d,
                     COALESCE(MAX(distinct_users), 0)::int AS personas
              FROM usage_daily
              WHERE day >= CURRENT_DATE - :usageWindow::int * INTERVAL '1 day'
              GROUP BY skill_id
            ),
            matched AS (
              SELECT s.slug, s.title, s.description,
                     s.when_to_use   AS when_to_use,
                     s.stack::text   AS stack,
                     s.type::text    AS type,
                     s.owner_team    AS owner_team,
                     s.status::text  AS status,
                     s.updated_at,
                     COALESCE(v.version, 1) AS version,
                     COALESCE(u.usos_90d, 0) AS usos_90d,
                     COALESCE(u.personas, 0) AS personas,
                     ts_rank(to_tsvector('english', s.search_text), %s) AS rank,
                     GREATEST(
                       1 + ln(1 + COALESCE(u.usos_90d, 0)) * :usageWeight::float,
                       CASE WHEN s.created_at > now() - :graceDays::int * INTERVAL '1 day'
                            THEN :graceMultiplier::float ELSE 1 END
                     ) AS boost
              FROM skills s
              LEFT JOIN usage u ON u.skill_id = s.id
              LEFT JOIN skill_versions v ON v.id = s.current_version_id
              WHERE s.status IN ('published', 'proposed')
                AND (:stack::text IS NULL OR s.stack::text = :stack)
                AND (:type::text  IS NULL OR s.type::text  = :type)
                AND to_tsvector('english', s.search_text) @@ %s
            )
            SELECT slug, title, description, when_to_use, stack, type, owner_team, status,
                   version, usos_90d, personas
            FROM matched
            WHERE (:minRank::float IS NULL OR rank >= :minRank::float)
            ORDER BY rank * boost DESC, updated_at DESC
            LIMIT :limit::int
            """.formatted(tsqueryExpr, tsqueryExpr);

        return jdbc.query(sql, p, SearchRepository::mapHit);
    }

    private List<SearchHit> fuzzySearch(String q, String stack, String type, int limit) {
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("q", q)
                .addValue("stack", stack)
                .addValue("type", type)
                .addValue("limit", limit);
        return jdbc.query(
                """
                SELECT s.slug, s.title, s.description,
                       s.when_to_use AS when_to_use,
                       s.stack::text AS stack,
                       s.type::text  AS type,
                       s.owner_team  AS owner_team,
                       s.status::text AS status,
                       COALESCE(v.version, 1) AS version,
                       0 AS usos_90d, 0 AS personas
                FROM skills s
                LEFT JOIN skill_versions v ON v.id = s.current_version_id
                WHERE s.status IN ('published', 'proposed')
                  AND (:stack::text IS NULL OR s.stack::text = :stack)
                  AND (:type::text  IS NULL OR s.type::text  = :type)
                  AND similarity(s.title, :q::text) > 0.25
                ORDER BY similarity(s.title, :q::text) DESC
                LIMIT :limit::int
                """,
                p, SearchRepository::mapHit);
    }

    private static SearchHit mapHit(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new SearchHit(
                rs.getString("slug"), rs.getString("title"), rs.getString("description"),
                rs.getString("when_to_use"), rs.getString("stack"), rs.getString("type"),
                rs.getString("owner_team"), rs.getString("status"),
                rs.getInt("version"), rs.getInt("usos_90d"), rs.getInt("personas"));
    }
}
