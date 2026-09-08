package com.skillhub.mcp;

import com.skillhub.auth.ApiKeyIdentity;
import com.skillhub.skill.Frontmatter;
import com.skillhub.skill.SearchHit;
import com.skillhub.skill.Skill;
import com.skillhub.skill.SkillRepository;
import com.skillhub.skill.SearchRepository;
import com.skillhub.usage.UsageService;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Fachada de lectura del catalogo para las tools MCP. Junta search + repo +
 * telemetria, y arma el .md guardable (skillAsFile en src/server/mcp/server.ts).
 */
@Service
public class SkillCatalog {

    private final SearchRepository search;
    private final SkillRepository skills;
    private final UsageService usage;
    private final NamedParameterJdbcTemplate jdbc;

    public SkillCatalog(SearchRepository search, SkillRepository skills,
                        UsageService usage, NamedParameterJdbcTemplate jdbc) {
        this.search = search;
        this.skills = skills;
        this.usage = usage;
        this.jdbc = jdbc;
    }

    public List<SearchHit> searchSkills(String query, String stack, String type) {
        return search.searchSkills(query, stack, type, SearchRepository.SEARCH_RESULT_LIMIT);
    }

    public void recordMissedQuery(String query, String stack) {
        usage.recordMissedQuery(query, stack);
    }

    public Skill getSkillBySlug(String slug, Integer version) {
        return skills.getBySlug(slug, version);
    }

    public List<SkillRepository.SkillListRow> listSkills(String stack, String type) {
        return skills.listSkills(stack, type, "published");
    }

    /** Telemetria fuera del camino critico: resuelve el id del slug sin bloquear. */
    public void recordUsageForSlug(String slug, String tool, ApiKeyIdentity identity) {
        try {
            var ids = jdbc.queryForList(
                    "SELECT id FROM skills WHERE slug = :slug LIMIT 1",
                    new MapSqlParameterSource("slug", slug), String.class);
            if (ids.isEmpty()) return;
            usage.recordUsage(new UsageService.UsageRow(
                    identity.apiKeyId(), identity.userId(), identity.team(), ids.get(0), tool));
        } catch (RuntimeException ignored) {
            // se ignora a proposito
        }
    }

    /**
     * El skill como .md guardable (frontmatter determinista + cuerpo sin
     * preview) mas la ruta relativa donde el agente lo escribe.
     * Puerto de skillAsFile() de src/server/mcp/server.ts.
     */
    public record LocalFile(int version, Frontmatter.Stripped stripped, String file, String saveAs) {}

    public LocalFile skillAsFile(Skill skill) {
        int version = skill.version() != null ? skill.version().version() : 1;
        String content = skill.version() != null ? skill.version().content() : "";
        Frontmatter.Stripped stripped = Frontmatter.stripPreview(content);
        Map<String, Object> fm = Frontmatter.buildSkillFrontmatter(
                skill.slug(), skill.title(), skill.description(), skill.whenToUse(),
                skill.stack(), skill.type(), skill.ownerTeam(), version, skill.tags());
        String file = Frontmatter.serializeSkillFile(fm, stripped.content());
        return new LocalFile(version, stripped, file, ".skill-hub/" + skill.slug() + ".md");
    }
}
