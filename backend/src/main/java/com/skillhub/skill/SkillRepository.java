package com.skillhub.skill;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;

/**
 * Lecturas de skills. Puerto parcial de src/server/skills/service.ts
 * (getSkillBySlug, listSkills) — solo lo que el spike de MCP necesita.
 */
@Repository
public class SkillRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public SkillRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * La version vigente es current_version_id, NUNCA "la de numero mas alto":
     * una edicion esperando votos ya existe en skill_versions pero todavia no es
     * la vigente. Con version explicito se trae esa.
     */
    public Skill getBySlug(String slug, Integer version) {
        var base = jdbc.query(
                """
                SELECT s.id, s.slug, s.title, s.description, s.when_to_use,
                       s.stack::text AS stack, s.type::text AS type, s.status::text AS status,
                       s.owner_team, s.origin::text AS origin, s.current_version_id,
                       s.pending_version_id, s.superseded_by,
                       sup.slug AS superseded_by_slug
                FROM skills s
                LEFT JOIN skills sup ON sup.id = s.superseded_by
                WHERE s.slug = :slug
                LIMIT 1
                """,
                new MapSqlParameterSource("slug", slug),
                (rs, i) -> new Object[]{
                        rs.getString("id"), rs.getString("slug"), rs.getString("title"),
                        rs.getString("description"), rs.getString("when_to_use"),
                        rs.getString("stack"), rs.getString("type"), rs.getString("status"),
                        rs.getString("owner_team"), rs.getString("origin"),
                        rs.getString("current_version_id"), rs.getString("pending_version_id"),
                        rs.getString("superseded_by_slug")
                });
        if (base.isEmpty()) return null;
        Object[] r = base.get(0);
        String id = (String) r[0];
        String currentVersionId = (String) r[10];

        Skill.SkillVersion sv = loadVersion(id, currentVersionId, version);
        List<String> tags = jdbc.queryForList(
                "SELECT tag FROM skill_tags WHERE skill_id = :id::uuid ORDER BY tag",
                new MapSqlParameterSource("id", id), String.class);

        return new Skill(
                id, (String) r[1], (String) r[2], (String) r[3], (String) r[4],
                (String) r[5], (String) r[6], (String) r[7], (String) r[8], (String) r[9],
                (String) r[11], (String) r[12], tags, sv);
    }

    private Skill.SkillVersion loadVersion(String skillId, String currentVersionId, Integer version) {
        MapSqlParameterSource p = new MapSqlParameterSource("skillId", skillId);
        String sql;
        if (version != null) {
            p.addValue("version", version);
            sql = """
                  SELECT version, content, preview FROM skill_versions
                  WHERE skill_id = :skillId::uuid AND version = :version LIMIT 1
                  """;
        } else if (currentVersionId != null) {
            p.addValue("vid", currentVersionId);
            sql = "SELECT version, content, preview FROM skill_versions WHERE id = :vid::uuid LIMIT 1";
        } else {
            sql = """
                  SELECT version, content, preview FROM skill_versions
                  WHERE skill_id = :skillId::uuid ORDER BY version DESC LIMIT 1
                  """;
        }
        var rows = jdbc.query(sql, p, (rs, i) ->
                new Skill.SkillVersion(rs.getInt("version"), rs.getString("content"), rs.getString("preview")));
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * Indice compacto del catalogo. Puerto acotado de listSkills: solo los
     * campos que consume list_skills del MCP (slug, title, when_to_use, stack,
     * type, version, usos_90d).
     */
    public List<SkillListRow> listSkills(String stack, String type, String status) {
        var conditions = new ArrayList<String>();
        MapSqlParameterSource p = new MapSqlParameterSource();
        if (stack != null) { conditions.add("s.stack::text = :stack"); p.addValue("stack", stack); }
        if (type != null) { conditions.add("s.type::text = :type"); p.addValue("type", type); }
        if (status != null) { conditions.add("s.status::text = :status"); p.addValue("status", status); }
        else conditions.add("s.status <> 'draft'");

        String where = String.join(" AND ", conditions);
        return jdbc.query(
                """
                WITH usage AS (
                  SELECT skill_id, COALESCE(SUM(hits), 0)::int AS usos
                  FROM usage_daily
                  WHERE day >= CURRENT_DATE - 90 * INTERVAL '1 day'
                  GROUP BY skill_id
                )
                SELECT s.slug, s.title, s.when_to_use,
                       s.stack::text AS stack, s.type::text AS type,
                       COALESCE(v.version, 1) AS version,
                       COALESCE(u.usos, 0) AS usos90d
                FROM skills s
                LEFT JOIN usage u ON u.skill_id = s.id
                LEFT JOIN skill_versions v ON v.id = s.current_version_id
                WHERE """ + where + """

                ORDER BY COALESCE(u.usos, 0) DESC, s.updated_at DESC
                """,
                p,
                (rs, i) -> new SkillListRow(
                        rs.getString("slug"), rs.getString("title"), rs.getString("when_to_use"),
                        rs.getString("stack"), rs.getString("type"),
                        rs.getInt("version"), rs.getInt("usos90d")));
    }

    public record SkillListRow(String slug, String title, String whenToUse,
                               String stack, String type, int version, int usos90d) {}
}
