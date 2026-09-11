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

    /**
     * Umbrales del rechazo EN CALIENTE de propose_skill. Deliberadamente altos:
     * por debajo de esto no se rechaza, entra como provisional y el admin decide
     * en la revision. La senal se mide sobre title + when_to_use + arranque del
     * cuerpo (la sustancia), nunca sobre el pool de tags: dos convenciones
     * distintas del mismo dominio comparten vocabulario de tags.
     */
    public static final double PROPOSAL_REJECT_SCORE = 0.52;
    public static final double PROPOSAL_REJECT_TITLE = 0.75;
    private static final int PROPOSAL_BODY_CHARS = 240;

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
                   ((to_tsvector('english', s.search_text) @@ websearch_to_tsquery('english', :title::text))
                     OR (to_tsvector('spanish', s.search_text) @@ websearch_to_tsquery('spanish', :title::text))
                   ) AS por_texto,
                   %1$s AS por_tags,
                   GREATEST(
                     similarity(s.title, :title::text)::float,
                     CASE WHEN (to_tsvector('english', s.search_text) @@ websearch_to_tsquery('english', :title::text))
                               OR (to_tsvector('spanish', s.search_text) @@ websearch_to_tsquery('spanish', :title::text))
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
     * Match candidato para el rechazo de propose_skill. `score` es la similitud
     * trigram sobre title + when_to_use + arranque del cuerpo; `titleScore` la
     * similitud solo del titulo (una convencion con titulo casi identico es
     * sospechosa aunque el resto difiera).
     */
    public record ProposalMatch(String slug, String title, String status,
                                double score, double titleScore) {
        public boolean bloqueaEnCaliente() {
            return score >= PROPOSAL_REJECT_SCORE || titleScore >= PROPOSAL_REJECT_TITLE;
        }
    }

    /**
     * Los skills mas parecidos a una propuesta, medido sobre la sustancia
     * (title + when_to_use + primeras lineas del cuerpo), no sobre los tags.
     * Devuelve todo con su score para que el que llama decida el corte y lo
     * pueda mostrar; NO filtra por umbral.
     */
    public List<ProposalMatch> closestForProposal(String title, String whenToUse,
                                                  String content, int limit) {
        String t = title == null ? "" : title.trim();
        if (t.length() < 3) return List.of();

        String bodyStart = content == null ? "" : content
                .replaceAll("\\s+", " ").trim();
        if (bodyStart.length() > PROPOSAL_BODY_CHARS) {
            bodyStart = bodyStart.substring(0, PROPOSAL_BODY_CHARS);
        }
        String profile = (t + " . " + (whenToUse == null ? "" : whenToUse.trim())
                + " . " + bodyStart).toLowerCase();

        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("profile", profile)
                .addValue("title", t.toLowerCase())
                .addValue("bodyChars", PROPOSAL_BODY_CHARS)
                .addValue("limit", limit);

        String sql = """
            WITH candidato AS (
              SELECT s.slug, s.title, s.status::text AS status,
                     lower(concat_ws(' . ',
                       s.title,
                       s.when_to_use,
                       left(regexp_replace(COALESCE(v.content, ''), '\\s+', ' ', 'g'), :bodyChars::int)
                     )) AS perfil
              FROM skills s
              LEFT JOIN skill_versions v ON v.id = s.current_version_id
              WHERE s.status IN ('published', 'proposed')
            )
            SELECT slug, title, status,
                   similarity(perfil, :profile::text)      AS score,
                   similarity(title, :title::text)         AS title_score
            FROM candidato
            ORDER BY GREATEST(similarity(perfil, :profile::text),
                              similarity(title, :title::text)) DESC
            LIMIT :limit::int
            """;

        return jdbc.query(sql, p, (rs, i) -> new ProposalMatch(
                rs.getString("slug"), rs.getString("title"), rs.getString("status"),
                rs.getDouble("score"), rs.getDouble("title_score")));
    }
}
