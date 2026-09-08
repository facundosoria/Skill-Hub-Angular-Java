package com.skillhub.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.skillhub.auth.ApiKeyIdentity;
import com.skillhub.skill.LanguageDetector;
import com.skillhub.skill.ProposeService;
import com.skillhub.skill.Skill;
import com.skillhub.skill.SkillInput;
import com.skillhub.skill.SkillRepository;
import com.skillhub.skill.SkillWriteService;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Definiciones y despacho de las seis tools MCP. Puerto de src/server/mcp/server.ts.
 *
 * Cinco de lectura (search_skills, get_skill, sync_skills, list_skills,
 * get_port_registry) y UNA de escritura (propose_skill).
 *
 * Las descripciones estan prompt-engineered: se copian verbatim del original.
 * Los inputSchema van como JSON literal y estable (cacheable byte a byte).
 * Todo lo que sale por aca esta en ingles: su lector es un modelo.
 */
@Component
public class McpTools {

    private static final String PORT_REGISTRY_SLUG = "port-registry";
    private static final int SYNC_MAX = 100;

    private final SkillCatalog catalog;
    private final ProposeService propose;
    private final SkillWriteService write;
    private final ObjectMapper json;

    public McpTools(SkillCatalog catalog, ProposeService propose,
                    SkillWriteService write, ObjectMapper json) {
        this.catalog = catalog;
        this.propose = propose;
        this.write = write;
        this.json = json;
    }

    // --- Definiciones (tools/list) -----------------------------------------

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

    private static final String SYNC_SKILLS_DESC =
            "Reconcile the skill files you keep in `.skill-hub/` in one call. Send every local copy "
            + "as { slug, version }. For each you get back its state: `current` (leave it), `stale` "
            + "(overwrite with the returned `file`), `deprecated` (delete it and fetch "
            + "`superseded_by`), or `gone` (delete it). Run it at the start of a session instead of "
            + "re-fetching skills one by one.";

    private static final String LIST_SKILLS_DESC =
            "A compact index of every skill in the catalogue. Useful to get your bearings on which "
            + "conventions exist; to find the one that applies to a concrete task, use search_skills "
            + "instead. Provisional entries (proposed by an agent, not reviewed by a human yet) are "
            + "included and carry `provisional: true` - follow them for consistency but treat them as "
            + "unreviewed.";

    private static final String PORT_REGISTRY_DESC =
            "Return the port ranges assigned to each team. Consult it before choosing a port for a "
            + "new service, so you do not take a port from another team's range.";

    private static final String PROPOSE_SKILL_DESC =
            "Propose a NEW convention, and only when search_skills returned nothing. A gap is not "
            + "neutral: every team fills it differently. Saved as provisional and served to other "
            + "agents immediately; refused if a close match exists (its similarity is returned). To "
            + "change an existing convention instead, use propose_revision. Call "
            + "get_skill('writing-skills') first — it defines every field below. Write in English.";

    private static final String PROPOSE_REVISION_DESC =
            "Propose a change to an existing convention when it is wrong, incomplete or outdated. "
            + "Creates a pending revision reviewed by an admin; it does not change the published "
            + "version. Fetch the current one with get_skill first and pass its `version` as "
            + "base_version. `content` is the full new body (Markdown starting with '## Rule'), not a "
            + "diff. Pass description / when_to_use / tags / stack / type only if they change. Write in English.";

    private static final String STACK_ENUM = "[\"angular\",\"java\",\"shared\",\"infra\"]";
    private static final String TYPE_ENUM = "[\"skill\",\"convention\",\"reference\"]";

    private static final String SEARCH_SKILLS_SCHEMA = ("""
        {"type":"object","properties":{\
        "query":{"type":"string","minLength":2,"description":"The task, described in natural language and in English. e.g. 'action button in a form'"},\
        "stack":{"type":"string","enum":%s,"description":"Restrict to one stack"},\
        "type":{"type":"string","enum":%s,"description":"Restrict to one document type"}},\
        "required":["query"],"additionalProperties":false}""").formatted(STACK_ENUM, TYPE_ENUM);

    private static final String GET_SKILL_SCHEMA = """
        {"type":"object","properties":{\
        "slug":{"type":"string","description":"The skill slug, exactly as search_skills returned it"},\
        "version":{"type":"integer","exclusiveMinimum":0,"description":"A specific version; defaults to the latest"}},\
        "required":["slug"],"additionalProperties":false}""";

    private static final String SYNC_SKILLS_SCHEMA = """
        {"type":"object","properties":{\
        "have":{"type":"array","maxItems":100,"description":"Every skill you currently have in .skill-hub/",\
        "items":{"type":"object","properties":{\
        "slug":{"type":"string","description":"The skill slug"},\
        "version":{"type":"integer","exclusiveMinimum":0,"description":"The version in your local file's frontmatter"}},\
        "required":["slug","version"],"additionalProperties":false}}},\
        "required":["have"],"additionalProperties":false}""";

    private static final String LIST_SKILLS_SCHEMA = ("""
        {"type":"object","properties":{\
        "stack":{"type":"string","enum":%s,"description":"Restrict to one stack"},\
        "type":{"type":"string","enum":%s,"description":"Restrict to one document type"}},\
        "additionalProperties":false}""").formatted(STACK_ENUM, TYPE_ENUM);

    private static final String PORT_REGISTRY_SCHEMA = """
        {"type":"object","properties":{\
        "service":{"type":"string","description":"Filter by service or team name"}},\
        "additionalProperties":false}""";

    private static final String PROPOSE_SKILL_SCHEMA = ("""
        {"type":"object","properties":{\
        "title":{"type":"string","minLength":3,"maxLength":120,"description":"Short noun phrase"},\
        "description":{"type":"string","minLength":10,"maxLength":200,"description":"One sentence, max 200 chars"},\
        "when_to_use":{"type":"string","minLength":10,"maxLength":200,"description":"Situations and synonyms, for machine matching. Max 200 chars"},\
        "stack":{"type":"string","enum":%s},\
        "content":{"type":"string","minLength":40,"description":"Markdown starting with '## Rule'"},\
        "type":{"type":"string","enum":%s},\
        "tags":{"type":"array","maxItems":12,"items":{"type":"string"}},\
        "slug":{"type":"string","description":"Derived from the title if omitted"},\
        "from_query":{"type":"string","description":"The search that returned nothing"},\
        "rationale":{"type":"string","minLength":10,"description":"What you based the rule on. Be honest; an admin reads this"}},\
        "required":["title","description","when_to_use","stack","content","from_query","rationale"],\
        "additionalProperties":false}""").formatted(STACK_ENUM, TYPE_ENUM);

    private static final String PROPOSE_REVISION_SCHEMA = ("""
        {"type":"object","properties":{\
        "slug":{"type":"string","description":"The convention to change, exactly as get_skill returned it"},\
        "base_version":{"type":"integer","exclusiveMinimum":0,"description":"The version you based the change on (from get_skill). Rejected if it is stale."},\
        "content":{"type":"string","minLength":40,"description":"The full new body, Markdown starting with '## Rule'. Not a diff."},\
        "rationale":{"type":"string","minLength":10,"description":"Why the change is needed. An admin reads this"},\
        "description":{"type":"string","minLength":10,"maxLength":200,"description":"Only if it changes"},\
        "when_to_use":{"type":"string","minLength":10,"maxLength":200,"description":"Only if it changes"},\
        "tags":{"type":"array","maxItems":12,"items":{"type":"string"},"description":"Only if they change; replaces the whole set"},\
        "stack":{"type":"string","enum":%s,"description":"Only if it changes"},\
        "type":{"type":"string","enum":%s,"description":"Only if it changes"}},\
        "required":["slug","base_version","content","rationale"],\
        "additionalProperties":false}""").formatted(STACK_ENUM, TYPE_ENUM);

    public ArrayNode toolList() {
        ArrayNode arr = json.createArrayNode();
        arr.add(toolDef("search_skills", "Search skills", SEARCH_SKILLS_DESC, SEARCH_SKILLS_SCHEMA, true, null));
        arr.add(toolDef("get_skill", "Read a skill", GET_SKILL_DESC, GET_SKILL_SCHEMA, true, null));
        arr.add(toolDef("sync_skills", "Refresh local skill copies", SYNC_SKILLS_DESC, SYNC_SKILLS_SCHEMA, true, null));
        arr.add(toolDef("list_skills", "List the catalogue", LIST_SKILLS_DESC, LIST_SKILLS_SCHEMA, true, null));
        arr.add(toolDef("get_port_registry", "Port registry", PORT_REGISTRY_DESC, PORT_REGISTRY_SCHEMA, true, null));
        arr.add(toolDef("propose_skill", "Propose a missing skill", PROPOSE_SKILL_DESC, PROPOSE_SKILL_SCHEMA, false, false));
        arr.add(toolDef("propose_revision", "Propose a change to a skill", PROPOSE_REVISION_DESC, PROPOSE_REVISION_SCHEMA, false, false));
        return arr;
    }

    private ObjectNode toolDef(String name, String title, String desc, String schemaJson,
                               boolean readOnly, Boolean destructive) {
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
        if (destructive != null) ann.put("destructiveHint", destructive);
        ann.put("openWorldHint", false);
        t.set("annotations", ann);
        return t;
    }

    // --- Despacho (tools/call) --------------------------------------------

    /** Devuelve el nodo `content` de la respuesta MCP, o null si la tool no existe. */
    public ArrayNode call(String name, JsonNode args, ApiKeyIdentity identity) {
        return switch (name) {
            case "search_skills" -> textContent(searchSkills(args, identity));
            case "get_skill" -> textContent(getSkill(args, identity));
            case "sync_skills" -> textContent(syncSkills(args));
            case "list_skills" -> textContent(listSkills(args));
            case "get_port_registry" -> textContent(getPortRegistry(args, identity));
            case "propose_skill" -> textContent(proposeSkill(args, identity));
            case "propose_revision" -> textContent(proposeRevision(args, identity));
            default -> null;
        };
    }

    // --- search_skills --------------------------------------------------

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
        // search_skills NO cuenta como uso: solo get_skill/get_port_registry (una
        // busqueda no es "consultar la convencion", y contarla infla el ranking
        // de canonicidad). Ver McpTools.getSkill / SkillCatalog.recordUsageForSlug.

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
            r.put("score", Math.round(h.score() * 1000.0) / 1000.0);
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

    // --- get_skill ----------------------------------------------------

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
        if ("published".equals(skill.status()) && skill.pendingVersionId() != null) {
            out.put("pending_revision", true);
            out.put("pending_note", "A change to this convention is already proposed and waiting for an "
                    + "admin. This is still the published version. Do not propose the same change again; "
                    + "if yours is different, base propose_revision on this `version`.");
        }
        out.put("when_to_use", skill.whenToUse());
        out.put("stack", skill.stack());
        out.put("type", skill.type());
        out.put("owning_team", skill.ownerTeam());
        out.put("version", local.version());
        ArrayNode tags = json.createArrayNode();
        skill.tags().forEach(tags::add);
        out.set("tags", tags);
        out.put("content", local.stripped().content());
        if (local.stripped().visualExample() != null) {
            out.put("visual_example", local.stripped().visualExample());
        }
        out.put("file", local.file());
        out.put("save_as", local.saveAs());
        return out;
    }

    // --- sync_skills -------------------------------------------------

    private ObjectNode syncSkills(JsonNode args) {
        JsonNode have = args.path("have");
        ArrayNode results = json.createArrayNode();
        List<String> stale = new ArrayList<>();
        List<String> drop = new ArrayList<>();

        int checked = 0;
        for (JsonNode entry : have) {
            if (checked >= SYNC_MAX) break;
            checked++;
            String slug = entry.path("slug").asText("");
            int localVersion = entry.path("version").asInt();
            Skill skill = catalog.getSkillBySlug(slug, null);

            ObjectNode r = json.createObjectNode();
            r.put("slug", slug);
            if (skill == null) {
                r.put("state", "gone");
                r.put("instruction", "Not in the catalogue anymore. Delete your local copy.");
                drop.add(slug);
            } else if ("deprecated".equals(skill.status())) {
                r.put("state", "deprecated");
                r.put("superseded_by", skill.supersededBySlug());
                r.put("instruction", skill.supersededBySlug() != null
                        ? "Deprecated. Delete your local copy and fetch \"" + skill.supersededBySlug()
                            + "\" with get_skill."
                        : "Deprecated with no replacement. Delete your local copy and stop following it.");
                drop.add(slug);
            } else if (!"published".equals(skill.status()) && !"proposed".equals(skill.status())) {
                r.put("state", "gone");
                r.put("instruction", "No longer available. Delete your local copy.");
                drop.add(slug);
            } else {
                SkillCatalog.LocalFile local = catalog.skillAsFile(skill);
                if (local.version() > localVersion) {
                    r.put("state", "stale");
                    r.put("version", local.version());
                    r.put("file", local.file());
                    r.put("save_as", local.saveAs());
                    stale.add(slug);
                } else {
                    r.put("state", "current");
                    r.put("version", local.version());
                }
            }
            results.add(r);
        }

        ObjectNode out = json.createObjectNode();
        out.put("checked", results.size());
        out.set("to_overwrite", toArray(stale));
        out.set("to_delete", toArray(drop));
        out.set("results", results);
        return out;
    }

    // --- list_skills ------------------------------------------------

    private ObjectNode listSkills(JsonNode args) {
        String stack = args.hasNonNull("stack") ? args.get("stack").asText() : null;
        String type = args.hasNonNull("type") ? args.get("type").asText() : null;
        List<SkillRepository.SkillListRow> rows = catalog.listSkills(stack, type);

        ArrayNode arr = json.createArrayNode();
        int provisional = 0;
        for (var row : rows) {
            ObjectNode s = json.createObjectNode();
            s.put("slug", row.slug());
            s.put("title", row.title());
            s.put("when_to_use", row.whenToUse());
            s.put("stack", row.stack());
            s.put("type", row.type());
            s.put("version", row.version());
            s.put("uses_90d", row.usos90d());
            if ("proposed".equals(row.status())) {
                s.put("provisional", true);
                provisional++;
            }
            arr.add(s);
        }
        ObjectNode out = json.createObjectNode();
        out.put("total", rows.size());
        if (provisional > 0) {
            out.put("provisional_count", provisional);
            out.put("note", "Entries with provisional:true were proposed by an agent and not reviewed "
                    + "by a human yet. Follow them so the team stays consistent, but tell the user they "
                    + "are provisional. Use get_skill for the full contents of any entry.");
        }
        out.set("skills", arr);
        return out;
    }

    // --- get_port_registry ---------------------------------------

    private ObjectNode getPortRegistry(JsonNode args, ApiKeyIdentity identity) {
        String service = args.hasNonNull("service") ? args.get("service").asText() : null;
        Skill skill = catalog.getSkillBySlug(PORT_REGISTRY_SLUG, null);
        ObjectNode out = json.createObjectNode();
        if (skill == null || skill.version() == null) {
            // Catalogo vacio: no es un error para el agente, es "todavia no hay
            // rangos asignados". Devolvemos 200 con lista vacia para que no tenga
            // que tratar el caso vacio como excepcion.
            out.set("teams", json.createArrayNode());
            out.put("note", "No port registry has been loaded into the catalogue yet. When one exists "
                    + "it lists the port range each team owns; until then, agree the port with the "
                    + "platform team before taking one.");
            return out;
        }
        catalog.recordUsageForSlug(PORT_REGISTRY_SLUG, "get_port_registry", identity);

        String content = skill.version().content();
        if (service == null || service.isEmpty()) {
            out.put("slug", skill.slug());
            out.put("content", content);
            return out;
        }
        String needle = service.toLowerCase();
        List<String> lines = content.lines()
                .filter(l -> l.toLowerCase().contains(needle))
                .toList();
        out.put("slug", skill.slug());
        out.put("filter", service);
        ArrayNode matches = json.createArrayNode();
        if (lines.isEmpty()) {
            matches.add("No matches. Call it again without a filter for the full registry.");
        } else {
            lines.forEach(matches::add);
        }
        out.set("matches", matches);
        return out;
    }

    // --- propose_skill -----------------------------------------

    private ObjectNode proposeSkill(JsonNode args, ApiKeyIdentity identity) {
        String title = args.path("title").asText("");
        String description = args.path("description").asText("");
        String whenToUse = args.path("when_to_use").asText("");
        String stack = args.path("stack").asText("");
        String content = args.path("content").asText("");
        String type = args.hasNonNull("type") ? args.get("type").asText() : "convention";
        String slug = args.hasNonNull("slug") ? args.get("slug").asText() : null;
        String fromQuery = args.path("from_query").asText("");
        String rationale = args.path("rationale").asText("");
        List<String> tags = new ArrayList<>();
        if (args.has("tags")) args.get("tags").forEach(n -> tags.add(n.asText()));

        // Guarda del esquema de la tool (mas estricta que skillInputSchema:
        // content min 40, from_query y rationale obligatorios).
        List<String> argErrs = new ArrayList<>();
        if (content.length() < 40) argErrs.add("content: Markdown starting with '## Rule', min 40 chars");
        if (fromQuery.isBlank()) argErrs.add("from_query: required");
        if (rationale.length() < 10) argErrs.add("rationale: min 10 chars");
        if (whenToUse.length() > SkillInput.MAX_WHEN_TO_USE)
            argErrs.add("when_to_use: max " + SkillInput.MAX_WHEN_TO_USE + " chars (200)");
        if (description.length() > SkillInput.MAX_DESCRIPTION)
            argErrs.add("description: max " + SkillInput.MAX_DESCRIPTION + " chars (200)");
        if (!argErrs.isEmpty()) {
            ObjectNode out = json.createObjectNode();
            out.put("status", "rejected");
            out.put("reason", "The proposal does not meet the catalogue rules.");
            out.set("errors", toArray(argErrs));
            out.put("instruction", "Fix these and call again. get_skill('writing-skills') explains the rules.");
            return out;
        }

        SkillInput input = new SkillInput(slug, title, description, whenToUse, stack, type,
                identity.team(), tags, content, null, null);
        ProposeService.Result res = propose.proposeSkill(input, identity.userId(), fromQuery, rationale);

        ObjectNode out = json.createObjectNode();
        if (res.ok()) {
            out.put("status", "proposed");
            out.put("slug", res.slug());
            out.put("note", "Saved as a provisional convention and already visible to other agents, "
                    + "so the team converges on one answer instead of improvising separately. An "
                    + "admin will review it. Tell the user you created it and that it has not been "
                    + "reviewed yet.");
            return out;
        }
        switch (res.motivo()) {
            case "idioma" -> {
                out.put("status", "rejected");
                out.put("reason", "The \"" + res.campo() + "\" field is not in English.");
                out.set("evidence", toArray(res.senales()));
                out.put("instruction", "The catalogue is written in English because the search index "
                        + "stems English and agents query in English — a skill in another "
                        + "language is effectively invisible to them. Rewrite the whole skill in "
                        + "English and call again.");
            }
            case "duplicado" -> {
                out.put("status", "rejected");
                out.put("reason", "Something close enough already exists in the catalogue. "
                        + "`similarity` (0-1, measured on title + when_to_use + the start of the body) "
                        + "is included so you can judge the call.");
                ArrayNode existing = json.createArrayNode();
                for (var e : res.existentes()) existing.add(json.valueToTree(e));
                out.set("existing", existing);
                out.put("instruction", "Fetch the existing skill with get_skill and follow it. If your "
                        + "rule genuinely EXTENDS or CORRECTS it rather than being a separate "
                        + "convention, call propose_revision(slug, base_version, ...) with that slug "
                        + "instead — an admin reviews the change. Only tell the user to go to the web "
                        + "app if neither fits.");
            }
            default -> {
                out.put("status", "rejected");
                out.put("reason", "The proposal does not meet the catalogue rules.");
                out.set("errors", toArray(res.errores()));
                out.put("instruction", "Fix these and call again. get_skill('writing-skills') explains the rules.");
            }
        }
        return out;
    }

    // --- propose_revision -------------------------------------

    private ObjectNode proposeRevision(JsonNode args, ApiKeyIdentity identity) {
        String slug = args.path("slug").asText("");
        String content = args.path("content").asText("");
        String rationale = args.path("rationale").asText("");
        Integer baseVersion = args.hasNonNull("base_version") ? args.get("base_version").asInt() : null;

        ObjectNode out = json.createObjectNode();

        List<String> argErrs = new ArrayList<>();
        if (slug.isBlank()) argErrs.add("slug: required");
        if (baseVersion == null || baseVersion < 1)
            argErrs.add("base_version: required — the `version` get_skill returned for this slug");
        if (content.length() < 40) argErrs.add("content: the full new body, Markdown starting with '## Rule', min 40 chars");
        if (rationale.length() < 10) argErrs.add("rationale: min 10 chars; an admin reads it");
        if (!argErrs.isEmpty()) {
            out.put("status", "rejected");
            out.put("reason", "The revision does not meet the catalogue rules.");
            out.set("errors", toArray(argErrs));
            out.put("instruction", "Fix these and call again.");
            return out;
        }

        Skill current = catalog.getSkillBySlug(slug, null);
        if (current == null) {
            out.put("status", "rejected");
            out.put("reason", "No skill exists with the slug \"" + slug + "\".");
            out.put("instruction", "Check the slug with search_skills, or use propose_skill if the "
                    + "convention does not exist yet.");
            return out;
        }
        if ("deprecated".equals(current.status())) {
            out.put("status", "rejected");
            out.put("reason", "\"" + slug + "\" is deprecated" + (current.supersededBySlug() != null
                    ? " and replaced by \"" + current.supersededBySlug() + "\"." : "."));
            out.put("instruction", current.supersededBySlug() != null
                    ? "Revise \"" + current.supersededBySlug() + "\" instead, or propose_skill if the "
                        + "replacement does not cover your case."
                    : "Do not revise it. Use propose_skill if a convention is still needed here.");
            return out;
        }
        if (!"published".equals(current.status())) {
            out.put("status", "rejected");
            out.put("reason", "proposed".equals(current.status())
                    ? "\"" + slug + "\" is still a provisional proposal, not a published convention."
                    : "\"" + slug + "\" is not published.");
            out.put("instruction", "There is nothing published to revise yet. Wait for it to be "
                    + "reviewed, or tell the user.");
            return out;
        }

        String description = args.hasNonNull("description") ? args.get("description").asText() : current.description();
        String whenToUse = args.hasNonNull("when_to_use") ? args.get("when_to_use").asText() : current.whenToUse();
        String stack = args.hasNonNull("stack") ? args.get("stack").asText() : current.stack();
        String type = args.hasNonNull("type") ? args.get("type").asText() : current.type();
        List<String> tags = current.tags();
        if (args.has("tags")) {
            List<String> newTags = new ArrayList<>();
            args.get("tags").forEach(n -> newTags.add(n.asText()));
            tags = newTags;
        }

        SkillInput merged = new SkillInput(slug, current.title(), description, whenToUse, stack, type,
                current.ownerTeam(), tags, content, null, null);
        List<String> errs = merged.validate();
        if (!errs.isEmpty()) {
            out.put("status", "rejected");
            out.put("reason", "The revised skill does not meet the catalogue rules.");
            out.set("errors", toArray(errs));
            out.put("instruction", "Fix these and call again. get_skill('writing-skills') explains the rules.");
            return out;
        }

        var idioma = LanguageDetector.revisarIdiomaSkill(current.title(), description, whenToUse, content);
        if (idioma != null) {
            out.put("status", "rejected");
            out.put("reason", "The \"" + idioma.campo() + "\" field is not in English.");
            out.set("evidence", toArray(idioma.senales()));
            out.put("instruction", "The catalogue is written in English. Rewrite the change in English "
                    + "and call again.");
            return out;
        }

        SkillWriteService.RevisionResult res =
                write.proposeRevision(slug, baseVersion, merged, identity.userId(), rationale);
        if (res.ok()) {
            out.put("status", "revision_proposed");
            out.put("slug", slug);
            out.put("base_version", baseVersion);
            out.put("pending_version", res.newVersion());
            out.put("note", "Pending revision created against version " + res.currentVersion() + ". The "
                    + "published version is unchanged; an admin accepts it (which bumps the version) or "
                    + "discards it. get_skill still returns the published one, now flagged "
                    + "pending_revision:true. Tell the user you proposed a change and it is not reviewed yet.");
            return out;
        }
        switch (res.motivo()) {
            case "stale" -> {
                out.put("status", "rejected");
                out.put("reason", "base_version " + baseVersion + " does not match the published version ("
                        + res.currentVersion() + "). It changed since you read it.");
                out.put("current_version", res.currentVersion());
                out.put("instruction", "Call get_skill(\"" + slug + "\") again, redo your change on top "
                        + "of the current version, and retry with its `version` as base_version.");
            }
            case "ya_pendiente" -> {
                out.put("status", "rejected");
                out.put("reason", "\"" + slug + "\" already has a pending revision waiting for review.");
                out.put("instruction", "Do not stack another. Wait for the admin to resolve it; get_skill "
                        + "shows pending_revision:true while it is open.");
            }
            default -> {
                out.put("status", "rejected");
                out.put("reason", "The revision could not be created (" + res.motivo() + ").");
            }
        }
        return out;
    }

    // --- helpers --------------------------------------------

    private ArrayNode toArray(List<String> values) {
        ArrayNode a = json.createArrayNode();
        values.forEach(a::add);
        return a;
    }

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
}
