package com.skillhub.skill;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

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
        String sql = """
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
                WHERE %s
                ORDER BY COALESCE(u.usos, 0) DESC, s.updated_at DESC
                """.formatted(where);
        return jdbc.query(sql, p,
                (rs, i) -> new SkillListRow(
                        rs.getString("slug"), rs.getString("title"), rs.getString("when_to_use"),
                        rs.getString("stack"), rs.getString("type"),
                        rs.getInt("version"), rs.getInt("usos90d")));
    }

    public record SkillListRow(String slug, String title, String whenToUse,
                               String stack, String type, int version, int usos90d) {}

    // --- lecturas para la web (puerto de service.ts) ------------------

    /**
     * Listado completo del catalogo para /skills: incluye el sparkline de
     * actividad (8 semanas), la preview para la miniatura y quien lo creo.
     * Puerto de listSkills() de service.ts.
     */
    public List<Map<String, Object>> listSkillsFull(String stack, String type, String status) {
        var conditions = new ArrayList<String>();
        MapSqlParameterSource p = new MapSqlParameterSource();
        if (stack != null) { conditions.add("s.stack::text = :stack"); p.addValue("stack", stack); }
        if (type != null) { conditions.add("s.type::text = :type"); p.addValue("type", type); }
        conditions.add(status != null ? "s.status::text = :status" : "s.status <> 'draft'");
        if (status != null) p.addValue("status", status);

        String sql = """
            WITH usage AS (
              SELECT skill_id, COALESCE(SUM(hits), 0)::int AS usos,
                     COALESCE(MAX(distinct_users), 0)::int AS personas
              FROM usage_daily WHERE day >= CURRENT_DATE - 90 * INTERVAL '1 day'
              GROUP BY skill_id
            ),
            semanas AS (SELECT generate_series(0, 7) AS n),
            actividad AS (
              SELECT s.id AS skill_id,
                     array_agg(COALESCE(w.hits, 0) ORDER BY sem.n DESC)::int[] AS serie
              FROM skills s CROSS JOIN semanas sem
              LEFT JOIN LATERAL (
                SELECT SUM(ud.hits)::int AS hits FROM usage_daily ud
                WHERE ud.skill_id = s.id
                  AND ud.day >  CURRENT_DATE - (sem.n + 1) * 7 * INTERVAL '1 day'
                  AND ud.day <= CURRENT_DATE - sem.n * 7 * INTERVAL '1 day'
              ) w ON TRUE
              GROUP BY s.id
            )
            SELECT s.slug, s.title, s.description, s.when_to_use AS "whenToUse",
                   s.stack::text AS stack, s.type::text AS type, s.status::text AS status,
                   s.owner_team AS "ownerTeam", s.updated_at AS "updatedAt",
                   COALESCE(v.version, 1) AS version, v.preview AS preview,
                   COALESCE(u.usos, 0) AS "usos90d", COALESCE(u.personas, 0) AS "personas",
                   COALESCE(a.serie, ARRAY[0,0,0,0,0,0,0,0]) AS actividad,
                   COALESCE(array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags,
                   cu.name AS "creatorName", s.created_by::text AS "creatorId"
            FROM skills s
            LEFT JOIN usage u ON u.skill_id = s.id
            LEFT JOIN actividad a ON a.skill_id = s.id
            LEFT JOIN skill_versions v ON v.id = s.current_version_id
            LEFT JOIN skill_tags t ON t.skill_id = s.id
            LEFT JOIN users cu ON cu.id = s.created_by
            WHERE %s
            GROUP BY s.id, v.version, v.preview, u.usos, u.personas, a.serie, cu.name
            ORDER BY COALESCE(u.usos, 0) DESC, s.updated_at DESC
            """.formatted(String.join(" AND ", conditions));
        return jdbc.query(sql, p, (rs, i) -> {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("slug", rs.getString("slug"));
            m.put("title", rs.getString("title"));
            m.put("description", rs.getString("description"));
            m.put("whenToUse", rs.getString("whenToUse"));
            m.put("stack", rs.getString("stack"));
            m.put("type", rs.getString("type"));
            m.put("status", rs.getString("status"));
            m.put("ownerTeam", rs.getString("ownerTeam"));
            m.put("updatedAt", String.valueOf(rs.getObject("updatedAt")));
            m.put("version", rs.getInt("version"));
            m.put("preview", rs.getString("preview"));
            m.put("usos90d", rs.getInt("usos90d"));
            m.put("personas", rs.getInt("personas"));
            m.put("actividad", intArray(rs.getArray("actividad")));
            m.put("tags", strArray(rs.getArray("tags")));
            m.put("creatorName", rs.getString("creatorName"));
            m.put("creatorId", rs.getString("creatorId"));
            return m;
        });
    }

    public List<Map<String, Object>> getHistory(String slug) {
        String id = skillId(slug);
        if (id == null) return List.of();
        return jdbc.query("""
                SELECT sv.version, sv.changelog, sv.created_at AS "createdAt",
                       u.name AS "authorName", u.username AS "authorUsername"
                FROM skill_versions sv
                LEFT JOIN users u ON u.id = sv.author_id
                WHERE sv.skill_id = :id::uuid
                ORDER BY sv.version DESC
                """, new MapSqlParameterSource("id", id), (rs, i) -> {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("version", rs.getInt("version"));
            m.put("changelog", rs.getString("changelog"));
            m.put("createdAt", String.valueOf(rs.getObject("createdAt")));
            m.put("authorName", rs.getString("authorName"));
            m.put("authorUsername", rs.getString("authorUsername"));
            return m;
        });
    }

    public List<Map<String, Object>> getRelated(String skillId) {
        return jdbc.query("""
                SELECT s.slug, s.title, s.stack::text AS stack
                FROM skill_related r JOIN skills s ON s.id = r.related_skill_id
                WHERE r.skill_id = :id::uuid
                """, new MapSqlParameterSource("id", skillId), (rs, i) -> Map.of(
                "slug", rs.getString("slug"), "title", rs.getString("title"),
                "stack", rs.getString("stack")));
    }

    /** Contenido de dos versiones, para el diff de la UI. */
    public Map<String, Object> getVersionsContent(String slug, int a, int b) {
        String id = skillId(slug);
        if (id == null) return null;
        var rows = jdbc.query(
                "SELECT version, content FROM skill_versions WHERE skill_id = :id::uuid",
                new MapSqlParameterSource("id", id),
                (rs, i) -> Map.entry(rs.getInt("version"), rs.getString("content")));
        String from = null, to = null;
        for (var e : rows) { if (e.getKey() == a) from = e.getValue(); if (e.getKey() == b) to = e.getValue(); }
        if (from == null || to == null) return null;
        return Map.of("from", Map.of("version", a, "content", from),
                "to", Map.of("version", b, "content", to));
    }

    /** Propuestas provisionales para /review, ordenadas por uso (las mas caras si estan mal). */
    public List<Map<String, Object>> listProposals() {
        return jdbc.query("""
            WITH uso AS (
              SELECT skill_id, COALESCE(SUM(hits),0)::int AS usos,
                     COALESCE(MAX(distinct_users),0)::int AS personas
              FROM usage_daily WHERE day >= CURRENT_DATE - 90 * INTERVAL '1 day'
              GROUP BY skill_id
            )
            SELECT s.slug, s.title, s.description, s.when_to_use AS "whenToUse",
                   s.stack::text AS stack, s.owner_team AS "ownerTeam",
                   s.proposed_from_query AS "proposedFromQuery", s.created_at AS "createdAt",
                   v.changelog, v.content,
                   COALESCE(u.usos,0) AS usos, COALESCE(u.personas,0) AS personas
            FROM skills s
            LEFT JOIN skill_versions v ON v.id = s.current_version_id
            LEFT JOIN uso u ON u.skill_id = s.id
            WHERE s.status = 'proposed'
            ORDER BY COALESCE(u.usos,0) DESC, s.created_at ASC
            """, (rs, i) -> {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("slug", rs.getString("slug"));
            m.put("title", rs.getString("title"));
            m.put("description", rs.getString("description"));
            m.put("whenToUse", rs.getString("whenToUse"));
            m.put("stack", rs.getString("stack"));
            m.put("ownerTeam", rs.getString("ownerTeam"));
            m.put("proposedFromQuery", rs.getString("proposedFromQuery"));
            m.put("createdAt", String.valueOf(rs.getObject("createdAt")));
            m.put("changelog", rs.getString("changelog"));
            m.put("content", rs.getString("content"));
            m.put("usos", rs.getInt("usos"));
            m.put("personas", rs.getInt("personas"));
            return m;
        });
    }

    public String skillId(String slug) {
        return jdbc.query("SELECT id::text FROM skills WHERE slug = :slug",
                new MapSqlParameterSource("slug", slug), rs -> rs.next() ? rs.getString(1) : null);
    }

    public void setStatusDraft(String slug) {
        jdbc.update("UPDATE skills SET status = 'draft' WHERE slug = :slug",
                new MapSqlParameterSource("slug", slug));
    }

    private static int[] intArray(java.sql.Array a) {
        try {
            if (a == null) return new int[0];
            Object arr = a.getArray();
            if (arr instanceof Integer[] boxed) {
                int[] out = new int[boxed.length];
                for (int i = 0; i < boxed.length; i++) out[i] = boxed[i] == null ? 0 : boxed[i];
                return out;
            }
            return new int[0];
        } catch (Exception e) { return new int[0]; }
    }

    private static List<String> strArray(java.sql.Array a) {
        try {
            if (a == null) return List.of();
            Object arr = a.getArray();
            if (arr instanceof String[] s) return List.of(s);
            return List.of();
        } catch (Exception e) { return List.of(); }
    }
}
