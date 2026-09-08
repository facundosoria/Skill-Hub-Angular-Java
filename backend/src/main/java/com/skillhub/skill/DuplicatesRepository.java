package com.skillhub.skill;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Puerto de src/server/skills/duplicates.ts.
 *
 * Combina tres senales, porque ninguna sola alcanza:
 *  - trigramas sobre el titulo  -> "Boton" / "Botones" / "Buttons"
 *  - full-text sobre el texto   -> sinonimos que comparten vocabulario
 *  - solapamiento de tags       -> titulos distintos del mismo tema
 */
@Repository
public class DuplicatesRepository {

    private static final double MIN_SIMILARITY = 0.3;
    private static final double TITULO_CASI_IDENTICO = 0.55;

    private final NamedParameterJdbcTemplate jdbc;

    public DuplicatesRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record DuplicateCandidate(
            String slug, String title, String description, String stack, String status,
            String ownerTeam, int version, String supersededBySlug,
            int usos90d, int personas,
            double similarity, double porTitulo, boolean porTexto, double porTags) {}

    public List<DuplicateCandidate> findSimilarSkills(String title, List<String> tags, int limit) {
        String t = title == null ? "" : title.trim();
        if (t.length() < 3) return List.of();

        List<String> cleanTags = tags == null ? List.of()
                : tags.stream().filter(x -> x != null && !x.isBlank()).toList();

        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("title", t)
                .addValue("limit", limit);

        // Sin tags no hay senal de solapamiento. Con tags, LEAST(count*0.2, 0.6).
        String tagOverlap;
        if (cleanTags.isEmpty()) {
            tagOverlap = "0::float";
        } else {
            p.addValue("tags", cleanTags);
            tagOverlap = """
                LEAST((
                  SELECT COUNT(*) FROM skill_tags st
                  WHERE st.skill_id = s.id AND st.tag IN (:tags)
                )::float * 0.2, 0.6)""";
        }

        String sql = """
            WITH usage AS (
              SELECT skill_id,
                     COALESCE(SUM(hits), 0)::int AS usos_90d,
                     COALESCE(MAX(distinct_users), 0)::int AS personas
              FROM usage_daily
              WHERE day >= CURRENT_DATE - 90 * INTERVAL '1 day'
              GROUP BY skill_id
            )
            SELECT s.slug, s.title, s.description,
                   s.stack::text  AS stack,
                   s.status::text AS status,
                   s.owner_team   AS owner_team,
                   COALESCE(v.version, 1) AS version,
                   sup.slug AS superseded_by_slug,
                   COALESCE(u.usos_90d, 0) AS usos_90d,
                   COALESCE(u.personas, 0) AS personas,
                   similarity(s.title, :title::text)::float AS por_titulo,
                   (to_tsvector('english', s.search_text)
                      @@ websearch_to_tsquery('english', :title::text)) AS por_texto,
                   %1$s AS por_tags,
                   GREATEST(
                     similarity(s.title, :title::text)::float,
                     CASE WHEN to_tsvector('english', s.search_text)
                               @@ websearch_to_tsquery('english', :title::text)
                          THEN 0.45::float ELSE 0::float END,
                     %1$s
                   ) AS similarity
            FROM skills s
            LEFT JOIN usage u          ON u.skill_id = s.id
            LEFT JOIN skills sup       ON sup.id = s.superseded_by
            LEFT JOIN skill_versions v ON v.id = s.current_version_id
            WHERE s.status <> 'draft'
            ORDER BY similarity DESC
            LIMIT :limit::int
            """.formatted(tagOverlap);

        return jdbc.query(sql, p, (rs, i) -> new DuplicateCandidate(
                        rs.getString("slug"), rs.getString("title"), rs.getString("description"),
                        rs.getString("stack"), rs.getString("status"), rs.getString("owner_team"),
                        rs.getInt("version"), rs.getString("superseded_by_slug"),
                        rs.getInt("usos_90d"), rs.getInt("personas"),
                        rs.getDouble("similarity"), rs.getDouble("por_titulo"),
                        rs.getBoolean("por_texto"), rs.getDouble("por_tags")))
                .stream().filter(c -> c.similarity() >= MIN_SIMILARITY).toList();
    }

    /**
     * Umbral para BLOQUEAR una propuesta de un agente (mas estricto que el aviso
     * del formulario): exige corroboracion. Dos senales, o titulo casi identico.
     */
    public static boolean esDuplicadoFuerte(DuplicateCandidate c) {
        return c.porTexto() || c.porTags() > 0 || c.porTitulo() >= TITULO_CASI_IDENTICO;
    }
}
