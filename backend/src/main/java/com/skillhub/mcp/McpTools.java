package com.skillhub.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.skillhub.auth.ApiKeyIdentity;
import com.skillhub.skill.Skill;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Definiciones y despacho de las tools MCP. Spike: solo search_skills y
 * get_skill (las otras cuatro quedan pendientes). Puerto de
 * src/server/mcp/server.ts.
 *
 * Las descripciones estan prompt-engineered: se copian verbatim del original.
 * Los inputSchema van como JSON literal y estable (cacheable byte a byte).
 */
@Component
public class McpTools {

    private final SkillCatalog catalog;
    private final ObjectMapper json;

    public McpTools(SkillCatalog catalog, ObjectMapper json) {
        this.catalog = catalog;
        this.json = json;
    }

    // --- Definiciones (tools/list) ---------------------------------------------

    private static final String SEARCH_SKILLS_DESC =
            "Search the organisation's convention catalogue from a natural-language description of "
            + "the task. Call this BEFORE writing Angular or Java code, without waiting to be asked. "
            + "Search in English: the catalogue is written in English. Returns up to 5 candidates "
            + "with their when_to_use and usage level; it does not return contents - use get_skill for that.";

    private static final String GET_SKILL_DESC =
            "Return the full contents of one skill. The response includes `file` (the skill as a "
            + "self-contained .md) and `save_as` (a relative path): write it there as a local copy "
            + "and reuse it next time unless this `version` is higher than your copy's. If the skill "
            + "is deprecated, the response carries the slug of its replacement - use that one instead.";

    private static final String SEARCH_SKILLS_SCHEMA = """
        {"type":"object","properties":{\
        "query":{"type":"string","minLength":2,"description":"The task, described in natural language and in English. e.g. 'action button in a form'"},\
        "stack":{"type":"string","enum":["angular","java","shared","infra"],"description":"Restrict to one stack"},\
        "type":{"type":"string","enum":["skill","convention","reference"],"description":"Restrict to one document type"}},\
        "required":["query"],"additionalProperties":false}""";

    private static final String GET_SKILL_SCHEMA = """
        {"type":"object","properties":{\
        "slug":{"type":"string","description":"The skill slug, exactly as search_skills returned it"},\
        "version":{"type":"integer","exclusiveMinimum":0,"description":"A specific version; defaults to the latest"}},\
        "required":["slug"],"additionalProperties":false}""";

    /** El array de tools para tools/list. Identico entre llamadas. */
    public ArrayNode toolList() {
        ArrayNode arr = json.createArrayNode();
        arr.add(toolDef("search_skills", "Search skills", SEARCH_SKILLS_DESC, SEARCH_SKILLS_SCHEMA, true));
        arr.add(toolDef("get_skill", "Read a skill", GET_SKILL_DESC, GET_SKILL_SCHEMA, true));
        return arr;
    }

    private ObjectNode toolDef(String name, String title, String desc, String schemaJson, boolean readOnly) {
        ObjectNode t = json.createObjectNode();
        t.put("name", name);
        t.put("title", title);
        t.put("description", desc);
        try {
            t.set("inputSchema", json.readTree(schemaJson));
        } catch (Exception e) {
            throw new IllegalStateException("schema JSON invalido para " + name, e);
        }
        ObjectNode ann = json.createObjectNode();
        ann.put("readOnlyHint", readOnly);
        ann.put("openWorldHint", false);
        t.set("annotations", ann);
        return t;
    }

    // --- Despacho (tools/call) ------------------------------------------------

    /** Devuelve el nodo `content` de la respuesta MCP, o null si la tool no existe. */
    public ArrayNode call(String name, JsonNode args, ApiKeyIdentity identity) {
        return switch (name) {
            case "search_skills" -> textContent(searchSkills(args, identity));
            case "get_skill" -> textContent(getSkill(args, identity));
            default -> null;
        };
    }

    // --- search_skills -------------------------------------------------------

    private ObjectNode searchSkills(JsonNode args, ApiKeyIdentity identity) {
        String query = args.path("query").asText("");
        String stack = args.hasNonNull("stack") ? args.get("stack").asText() : null;
        String type = args.hasNonNull("type") ? args.get("type").asText() : null;

        var hits = catalog.searchSkills(query, stack, type);

        ObjectNode out = json.createObjectNode();
        if (hits.isEmpty()) {
            catalog.recordMissedQuery(query, stack);
            out.set("results", json.createArrayNode());
            out.put("note", "No convention exists for this yet. A gap is not neutral: if you just "
                    + "improvise, the next team improvises differently and the catalogue never "
                    + "converges. Decide how to solve it, then call propose_skill so the rest of the "
                    + "organisation gets the same answer. Read get_skill('writing-skills') first.");
            out.put("next_step", "propose_skill");
            return out;
        }

        for (var h : hits) catalog.recordUsageForSlug(h.slug(), "search_skills", identity);

        ArrayNode results = json.createArrayNode();
        for (var h : hits) {
            ObjectNode r = json.createObjectNode();
            r.put("slug", h.slug());
            r.put("title", h.title());
            r.put("description", h.description());
            r.put("when_to_use", h.whenToUse());
            r.put("stack", h.stack());
            r.put("type", h.type());
            r.put("owning_team", h.ownerTeam());
            r.put("version", h.version());
            r.put("uses_90d", h.usos90d());
            r.put("people", h.personas());
            if ("proposed".equals(h.status())) {
                r.put("provisional", true);
                r.put("caveat", "Drafted automatically because no convention existed. Not reviewed "
                        + "by a human yet. Follow it so the team stays consistent, but tell the user "
                        + "it is provisional.");
            }
            results.add(r);
        }
        out.set("results", results);
        out.put("next_step", "Pick the one that applies and fetch its contents with get_skill(slug).");
        return out;
    }

    // --- get_skill ---------------------------------------------------------

    private ObjectNode getSkill(JsonNode args, ApiKeyIdentity identity) {
        String slug = args.path("slug").asText("");
        Integer version = args.hasNonNull("version") ? args.get("version").asInt() : null;

        Skill skill = catalog.getSkillBySlug(slug, version);
        ObjectNode out = json.createObjectNode();
        if (skill == null) {
            out.put("error", "No skill exists with the slug \"" + slug + "\".");
            return out;
        }

        if ("deprecated".equals(skill.status())) {
            out.put("slug", skill.slug());
            out.put("status", "deprecated");
            out.put("superseded_by", skill.supersededBySlug());
            out.put("instruction", skill.supersededBySlug() != null
                    ? "This skill is deprecated. Use \"" + skill.supersededBySlug()
                        + "\" instead: call get_skill with that slug."
                    : "This skill is deprecated and has no replacement. Do not follow it.");
            return out;
        }

        if (!"published".equals(skill.status()) && !"proposed".equals(skill.status())) {
            out.put("error", "The skill \"" + slug + "\" is not available yet.");
            return out;
        }

        catalog.recordUsageForSlug(slug, "get_skill", identity);
        SkillCatalog.LocalFile local = catalog.skillAsFile(skill);

        out.put("slug", skill.slug());
        out.put("title", skill.title());
        if ("proposed".equals(skill.status())) {
            out.put("provisional", true);
            out.put("caveat", "Provisional: drafted automatically because no convention existed, and "
                    + "not reviewed by a human yet. Follow it for consistency, and tell the user it "
                    + "is provisional.");
        }
        out.put("when_to_use", skill.whenToUse());
        out.put("stack", skill.stack());
        out.put("type", skill.type());
        out.put("owning_team", skill.ownerTeam());
        out.put("version", local.version());
        ArrayNode tags = json.createArrayNode();
        skill.tags().forEach(tags::add);
        out.set("tags", tags);
        // ...local.stripped  ->  { content, visual_example? }
        out.put("content", local.stripped().content());
        if (local.stripped().visualExample() != null) {
            out.put("visual_example", local.stripped().visualExample());
        }
        out.put("file", local.file());
        out.put("save_as", local.saveAs());
        return out;
    }

    // --- helpers ----------------------------------------------------------

    private ArrayNode textContent(JsonNode payload) {
        String text;
        try {
            text = payload.isTextual()
                    ? payload.asText()
                    : json.writerWithDefaultPrettyPrinter().writeValueAsString(payload);
        } catch (Exception e) {
            text = String.valueOf(payload);
        }
        ArrayNode content = json.createArrayNode();
        ObjectNode item = json.createObjectNode();
        item.put("type", "text");
        item.put("text", text);
        content.add(item);
        return content;
    }

    public List<String> toolNames() {
        return List.of("search_skills", "get_skill");
    }
}
