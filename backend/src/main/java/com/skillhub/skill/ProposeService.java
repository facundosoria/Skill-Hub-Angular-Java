package com.skillhub.skill;

import com.skillhub.audit.AuditService;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * Puerto de src/server/skills/propose.ts.
 *
 * Propuesta de skill hecha por un agente (revision de la decision 12). Entra
 * como `proposed`, nunca `published`: se sirve por MCP para que los equipos
 * converjan desde el dia uno, marcada como provisional hasta que una persona la
 * revise.
 *
 * Tres guardas, ninguna opcional:
 *  0. el catalogo va en ingles (un skill en espanol es invisible para los agentes)
 *  1. si ya existe algo parecido con corroboracion, NO crea: devuelve lo que existe
 *  2. valida el mismo esquema que la web, topes de longitud incluidos
 *  3. queda registrado como origen agente, con la busqueda que lo disparo
 */
@Service
public class ProposeService {

    private final DuplicatesRepository duplicates;
    private final AuditService audit;
    private final NamedParameterJdbcTemplate jdbc;
    private final CatalogArtifactService artifacts;

    public ProposeService(DuplicatesRepository duplicates, AuditService audit,
                          NamedParameterJdbcTemplate jdbc, CatalogArtifactService artifacts) {
        this.duplicates = duplicates;
        this.audit = audit;
        this.jdbc = jdbc;
        this.artifacts = artifacts;
    }

    public record FileAttachment(String fileName, String contentType, byte[] bytes) {}

    /** motivo: null (ok) | "invalido" | "idioma" | "duplicado". */
    public record Result(
            boolean ok, String slug, String motivo,
            List<String> errores,
            String campo, List<String> senales,
            List<Map<String, Object>> existentes) {

        static Result ok(String slug) { return new Result(true, slug, null, null, null, null, null); }
        static Result invalido(List<String> e) { return new Result(false, null, "invalido", e, null, null, null); }
        static Result idioma(String campo, List<String> s) { return new Result(false, null, "idioma", null, campo, s, null); }
        static Result duplicado(List<Map<String, Object>> ex) { return new Result(false, null, "duplicado", null, null, null, ex); }
    }

    @Transactional
    public Result proposeSkill(SkillInput input, String actorId, String fromQuery, String rationale) {
        return proposeSkill(input, actorId, fromQuery, rationale, null);
    }

    @Transactional
    public Result proposeSkill(SkillInput input, String actorId, String fromQuery, String rationale,
                               FileAttachment attachment) {
        String slug = (input.slug() != null && !input.slug().isBlank())
                ? input.slug().trim()
                : SkillInput.slugify(input.title());

        SkillInput withSlug = new SkillInput(slug, input.title(), input.description(),
                input.whenToUse(), input.stack(), input.type() == null ? "convention" : input.type(),
                input.ownerTeam(), input.tags() == null ? List.of() : input.tags(),
                input.content(), input.changelog(), input.duplicateJustification());

        List<String> errores = withSlug.validate();
        if (!errores.isEmpty()) return Result.invalido(errores);

        // Guarda 0: idioma.
        var idioma = LanguageDetector.revisarIdiomaSkill(
                withSlug.title(), withSlug.description(), withSlug.whenToUse(), withSlug.content());
        if (idioma != null) return Result.idioma(idioma.campo(), idioma.senales());

        // Guarda 1: solapamiento con algo que ya existe. Se mide sobre la
        // sustancia (title + when_to_use + arranque del cuerpo), no sobre tags.
        // Solo se rechaza en caliente si el parecido es alto; si no, entra como
        // provisional y el admin decide. El score viaja en la respuesta.
        var matches = duplicates.closestForProposal(
                withSlug.title(), withSlug.whenToUse(), withSlug.content(), 3);
        var bloqueantes = matches.stream()
                .filter(DuplicatesRepository.ProposalMatch::bloqueaEnCaliente)
                .toList();
        if (!bloqueantes.isEmpty()) {
            return Result.duplicado(bloqueantes.stream()
                    .map(m -> Map.<String, Object>of(
                            "slug", m.slug(), "title", m.title(), "status", m.status(),
                            "similarity", round(m.score()),
                            "title_similarity", round(m.titleScore())))
                    .toList());
        }

        Integer exists = jdbc.query("SELECT 1 FROM skills WHERE slug = :slug LIMIT 1",
                new MapSqlParameterSource("slug", slug), rs -> rs.next() ? 1 : null);
        if (exists != null) {
            return Result.duplicado(List.of(
                    Map.<String, Object>of("slug", slug, "title", withSlug.title(),
                            "status", "existente")));
        }

        String searchText = Frontmatter.buildSearchText(withSlug.title(), withSlug.description(),
                withSlug.whenToUse(), withSlug.tags(), withSlug.content());

        String skillId = jdbc.queryForObject("""
                INSERT INTO skills (slug, title, description, when_to_use, stack, type, status,
                                    origin, proposed_from_query, owner_team, created_by, search_text)
                VALUES (:slug, :title, :description, :whenToUse, :stack::stack, :type::skill_type,
                        'proposed', 'agent', :fromQuery, :ownerTeam, :actorId::uuid, :searchText)
                RETURNING id::text
                """, new MapSqlParameterSource()
                .addValue("slug", slug)
                .addValue("title", withSlug.title())
                .addValue("description", withSlug.description())
                .addValue("whenToUse", withSlug.whenToUse())
                .addValue("stack", withSlug.stack())
                .addValue("type", withSlug.type())
                .addValue("fromQuery", cut(fromQuery, 300))
                .addValue("ownerTeam", withSlug.ownerTeam())
                .addValue("actorId", actorId)
                .addValue("searchText", searchText), String.class);

        String versionId = jdbc.queryForObject("""
                INSERT INTO skill_versions (skill_id, version, content, preview, changelog, author_id)
                VALUES (:skillId::uuid, 1, :content, :preview, :changelog, :actorId::uuid)
                RETURNING id::text
                """, new MapSqlParameterSource()
                .addValue("skillId", skillId)
                .addValue("content", withSlug.content())
                .addValue("preview", Frontmatter.extractPreview(withSlug.content()))
                .addValue("changelog", "Propuesto por un agente. Base declarada: " + cut(rationale, 300))
                .addValue("actorId", actorId), String.class);

        jdbc.update("UPDATE skills SET current_version_id = :vid::uuid WHERE id = :id::uuid",
                new MapSqlParameterSource().addValue("vid", versionId).addValue("id", skillId));

        if (attachment != null && attachment.bytes() != null && attachment.bytes().length > 0) {
            artifacts.attachBytes(versionId, attachment.fileName(), attachment.contentType(),
                    attachment.bytes(), actorId);
        } else if ("plugin".equals(withSlug.type()) || "contract".equals(withSlug.type())) {
            artifacts.ensureDefaultArtifact(versionId, slug, withSlug.type(), withSlug.content(), actorId);
        }

        for (String tag : withSlug.tags()) {
            jdbc.update("INSERT INTO skill_tags (skill_id, tag) VALUES (:id::uuid, :tag)",
                    new MapSqlParameterSource().addValue("id", skillId).addValue("tag", tag));
        }

        audit.logAudit(actorId, "skill.proposed", "skill", skillId, Map.of(
                "slug", slug, "title", withSlug.title(), "origen", "agente",
                "busquedaQueLoDisparo", fromQuery, "baseDeclarada", rationale));

        return Result.ok(slug);
    }

    private static String cut(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static double round(double v) {
        return Math.round(v * 1000.0) / 1000.0;
    }
}
