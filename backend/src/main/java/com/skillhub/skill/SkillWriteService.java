package com.skillhub.skill;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.audit.AuditService;
import com.skillhub.web.DomainException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Puerto de src/server/skills/service.ts: create / update / publish / deprecate
 * y las dos formas de destrabar una propuesta de edicion (applyPendingEdit,
 * discardPendingEdit).
 *
 * La regla central de updateSkill: la edicion se aplica directo para un admin,
 * y tambien para cualquiera si el skill todavia no tiene nada `published`. Solo
 * cuando ya hay una version publicada y quien edita no es admin, la fila viva
 * no se toca: la version queda como propuesta en pending_version_id con el
 * SkillInput completo en meta_snapshot. Ver VoteService para como se aplica.
 */
@Service
public class SkillWriteService {

    private final NamedParameterJdbcTemplate jdbc;
    private final AuditService audit;
    private final ObjectMapper json;

    public SkillWriteService(NamedParameterJdbcTemplate jdbc, AuditService audit, ObjectMapper json) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.json = json;
    }

    // --- create ---------------------------------------------------------

    @Transactional
    public String createSkill(SkillInput input, String actorId) {
        List<String> errs = input.validate();
        if (!errs.isEmpty()) throw new DomainException(String.join("; ", errs));

        Integer exists = jdbc.query("SELECT 1 FROM skills WHERE slug = :slug LIMIT 1",
                new MapSqlParameterSource("slug", input.slug()), rs -> rs.next() ? 1 : null);
        if (exists != null) throw new DomainException("Ya existe un skill con el slug \"" + input.slug() + "\"");

        String searchText = Frontmatter.buildSearchText(input.title(), input.description(),
                input.whenToUse(), input.tags(), input.content());

        String skillId = jdbc.queryForObject("""
                INSERT INTO skills (slug, title, description, when_to_use, stack, type, owner_team,
                                    duplicate_justification, created_by, search_text)
                VALUES (:slug, :title, :description, :whenToUse, :stack::stack, :type::skill_type,
                        :ownerTeam, :dupJust, :actorId::uuid, :searchText)
                RETURNING id::text
                """, params(input).addValue("actorId", actorId).addValue("searchText", searchText),
                String.class);

        String versionId = jdbc.queryForObject("""
                INSERT INTO skill_versions (skill_id, version, content, preview, changelog, author_id)
                VALUES (:skillId::uuid, 1, :content, :preview, :changelog, :actorId::uuid)
                RETURNING id::text
                """, new MapSqlParameterSource()
                .addValue("skillId", skillId)
                .addValue("content", input.content())
                .addValue("preview", Frontmatter.extractPreview(input.content()))
                .addValue("changelog", input.changelog() != null ? input.changelog() : "Version inicial")
                .addValue("actorId", actorId), String.class);

        jdbc.update("UPDATE skills SET current_version_id = :vid::uuid WHERE id = :id::uuid",
                new MapSqlParameterSource().addValue("vid", versionId).addValue("id", skillId));
        insertTags(skillId, input.tags());

        audit.logAudit(actorId, "skill.created", "skill", skillId,
                Map.of("slug", input.slug(), "title", input.title()));
        if (input.duplicateJustification() != null) {
            audit.logAudit(actorId, "skill.duplicate_forced", "skill", skillId,
                    Map.of("slug", input.slug(), "justification", input.duplicateJustification()));
        }
        return skillId;
    }

    // --- update --------------------------------------------------------

    public record UpdateResult(int version, boolean pending) {}

    @Transactional
    public UpdateResult updateSkill(String slug, SkillInput input, String actorId, boolean isAdmin) {
        List<String> errs = input.validate();
        if (!errs.isEmpty()) throw new DomainException(String.join("; ", errs));

        Map<String, Object> skill = skillRow(slug);
        String skillId = (String) skill.get("id");
        String status = (String) skill.get("status");
        String currentVersionId = (String) skill.get("current_version_id");

        boolean applyDirectly = isAdmin || !"published".equals(status);
        int version = nextVersion(skillId);

        List<String> tagsBefore = jdbc.queryForList(
                "SELECT tag FROM skill_tags WHERE skill_id = :id::uuid",
                new MapSqlParameterSource("id", skillId), String.class);
        String currentContent = currentVersionId == null ? null : jdbc.query(
                "SELECT content FROM skill_versions WHERE id = :id::uuid",
                new MapSqlParameterSource("id", currentVersionId),
                rs -> rs.next() ? rs.getString(1) : null);

        Map<String, Object> changes = diffFields(skill, input, tagsBefore,
                currentContent != null && !currentContent.equals(input.content()));

        String metaSnapshot = applyDirectly ? null : writeJson(input);
        String versionId = jdbc.queryForObject("""
                INSERT INTO skill_versions (skill_id, version, content, preview, changelog, author_id, meta_snapshot)
                VALUES (:skillId::uuid, :version, :content, :preview, :changelog, :actorId::uuid, :meta)
                RETURNING id::text
                """, new MapSqlParameterSource()
                .addValue("skillId", skillId)
                .addValue("version", version)
                .addValue("content", input.content())
                .addValue("preview", Frontmatter.extractPreview(input.content()))
                .addValue("changelog", input.changelog())
                .addValue("actorId", actorId)
                .addValue("meta", metaSnapshot), String.class);

        if (applyDirectly) {
            applyMeta(skillId, input, versionId);
        } else {
            jdbc.update("UPDATE skills SET pending_version_id = :vid::uuid WHERE id = :id::uuid",
                    new MapSqlParameterSource().addValue("vid", versionId).addValue("id", skillId));
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("slug", slug);
        meta.put("version", version);
        meta.put("changelog", input.changelog());
        meta.put("cambios", changes);
        meta.put("camposCambiados", new ArrayList<>(changes.keySet()));
        meta.put("pendiente", !applyDirectly);
        audit.logAudit(actorId, "skill.updated", "skill", skillId, meta);

        return new UpdateResult(version, !applyDirectly);
    }

    // --- publish / deprecate ----------------------------------------

    @Transactional
    public void publishSkill(String slug, String actorId) {
        String id = requireSkillId(slug);
        jdbc.update("UPDATE skills SET status = 'published', updated_at = now() WHERE id = :id::uuid",
                new MapSqlParameterSource("id", id));
        audit.logAudit(actorId, "skill.published", "skill", id, Map.of("slug", slug));
    }

    @Transactional
    public void deprecateSkill(String slug, String supersededBySlug, String actorId) {
        String id = requireSkillId(slug);
        String supersededBy = null;
        if (supersededBySlug != null && !supersededBySlug.isBlank()) {
            supersededBy = jdbc.query("SELECT id::text FROM skills WHERE slug = :slug",
                    new MapSqlParameterSource("slug", supersededBySlug),
                    rs -> rs.next() ? rs.getString(1) : null);
            if (supersededBy == null) throw new DomainException("No existe el reemplazo \"" + supersededBySlug + "\"");
            if (supersededBy.equals(id)) throw new DomainException("Un skill no puede reemplazarse a si mismo");
        }
        jdbc.update("""
                UPDATE skills SET status = 'deprecated', superseded_by = :sup::uuid, updated_at = now()
                WHERE id = :id::uuid
                """, new MapSqlParameterSource().addValue("sup", supersededBy).addValue("id", id));
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("slug", slug);
        meta.put("supersededBy", supersededBySlug);
        audit.logAudit(actorId, "skill.deprecated", "skill", id, meta);
    }

    // --- propuestas de edicion pendientes -------------------------

    /** Aplica sobre la fila viva la propuesta de pending_version_id (meta_snapshot). */
    @Transactional
    public void applyPendingEdit(String skillId) {
        Map<String, Object> skill = jdbc.queryForMap(
                "SELECT pending_version_id::text AS pid FROM skills WHERE id = :id::uuid",
                new MapSqlParameterSource("id", skillId));
        String pid = (String) skill.get("pid");
        if (pid == null) throw new DomainException("No hay ninguna edicion pendiente");
        String meta = jdbc.query("SELECT meta_snapshot FROM skill_versions WHERE id = :id::uuid",
                new MapSqlParameterSource("id", pid), rs -> rs.next() ? rs.getString(1) : null);
        if (meta == null) throw new DomainException("La propuesta pendiente no tiene datos guardados");
        applyMeta(skillId, readInput(meta), pid);
    }

    @Transactional
    public void discardPendingEdit(String skillId) {
        int n = jdbc.update("""
                UPDATE skills SET pending_version_id = NULL
                WHERE id = :id::uuid AND pending_version_id IS NOT NULL
                """, new MapSqlParameterSource("id", skillId));
        if (n == 0) throw new DomainException("No hay ninguna edicion pendiente");
    }

    // --- helpers ---------------------------------------------------

    private void applyMeta(String skillId, SkillInput input, String versionId) {
        String searchText = Frontmatter.buildSearchText(input.title(), input.description(),
                input.whenToUse(), input.tags(), input.content());
        jdbc.update("""
                UPDATE skills SET title = :title, description = :description, when_to_use = :whenToUse,
                       stack = :stack::stack, type = :type::skill_type, owner_team = :ownerTeam,
                       current_version_id = :vid::uuid, pending_version_id = NULL,
                       updated_at = now(), search_text = :searchText
                WHERE id = :id::uuid
                """, params(input)
                .addValue("vid", versionId).addValue("id", skillId).addValue("searchText", searchText));
        jdbc.update("DELETE FROM skill_tags WHERE skill_id = :id::uuid",
                new MapSqlParameterSource("id", skillId));
        insertTags(skillId, input.tags());
    }

    private MapSqlParameterSource params(SkillInput in) {
        return new MapSqlParameterSource()
                .addValue("slug", in.slug())
                .addValue("title", in.title())
                .addValue("description", in.description())
                .addValue("whenToUse", in.whenToUse())
                .addValue("stack", in.stack())
                .addValue("type", in.type() == null ? "skill" : in.type())
                .addValue("ownerTeam", in.ownerTeam())
                .addValue("dupJust", in.duplicateJustification());
    }

    private void insertTags(String skillId, List<String> tags) {
        if (tags == null) return;
        for (String tag : tags) {
            jdbc.update("INSERT INTO skill_tags (skill_id, tag) VALUES (:id::uuid, :tag)",
                    new MapSqlParameterSource().addValue("id", skillId).addValue("tag", tag));
        }
    }

    private int nextVersion(String skillId) {
        Integer max = jdbc.query(
                "SELECT MAX(version) FROM skill_versions WHERE skill_id = :id::uuid",
                new MapSqlParameterSource("id", skillId), rs -> rs.next() ? (Integer) rs.getObject(1) : null);
        return (max == null ? 0 : max) + 1;
    }

    private Map<String, Object> skillRow(String slug) {
        try {
            return jdbc.queryForMap("""
                    SELECT id::text AS id, title, description, when_to_use, stack::text AS stack,
                           type::text AS type, status::text AS status, owner_team,
                           current_version_id::text AS current_version_id
                    FROM skills WHERE slug = :slug LIMIT 1
                    """, new MapSqlParameterSource("slug", slug));
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            throw new DomainException("No existe el skill \"" + slug + "\"");
        }
    }

    private String requireSkillId(String slug) {
        return (String) skillRow(slug).get("id");
    }

    private Map<String, Object> diffFields(Map<String, Object> before, SkillInput after,
                                           List<String> tagsBefore, boolean contentChanged) {
        Map<String, Object> changes = new LinkedHashMap<>();
        pair(changes, "titulo", before.get("title"), after.title());
        pair(changes, "descripcion", before.get("description"), after.description());
        pair(changes, "cuando usarlo", before.get("when_to_use"), after.whenToUse());
        pair(changes, "stack", before.get("stack"), after.stack());
        pair(changes, "tipo", before.get("type"), after.type());
        pair(changes, "equipo dueno", before.get("owner_team"), after.ownerTeam());
        var tagsAfter = new TreeSet<>(after.tags() == null ? List.of() : after.tags());
        var tagsAntes = new TreeSet<>(tagsBefore);
        if (!tagsAntes.equals(tagsAfter)) {
            changes.put("tags", Map.of("de", new ArrayList<>(tagsAntes), "a", new ArrayList<>(tagsAfter)));
        }
        if (contentChanged) changes.put("contenido", Map.of("de", "(ver diff)", "a", "(ver diff)"));
        return changes;
    }

    private void pair(Map<String, Object> changes, String key, Object de, Object a) {
        if (de == null ? a != null : !de.equals(a)) {
            changes.put(key, Map.of("de", de == null ? "" : de, "a", a == null ? "" : a));
        }
    }

    private String writeJson(Object o) {
        try { return json.writeValueAsString(o); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private SkillInput readInput(String s) {
        try { return json.readValue(s, SkillInput.class); } catch (Exception e) { throw new IllegalStateException(e); }
    }
}
