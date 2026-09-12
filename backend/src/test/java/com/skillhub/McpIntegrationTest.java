package com.skillhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.auth.ApiKeyService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Puerto del subconjunto de tests/integration/mcp.test.ts que cubre el spike:
 * autenticacion, search_skills, get_skill y estabilidad del prefijo cacheable.
 *
 * Levanta Postgres 16 en Testcontainers, deja que Flyway aplique V1..V12 sobre
 * la base limpia, siembra el mismo catalogo minimo de fixtures que el original y
 * pega contra /api/mcp por HTTP.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class McpIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("skillhub")
                    .withUsername("skillhub")
                    .withPassword("skillhub");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        // El init-sql de prod fija una zona que el contenedor de CI no necesita.
        r.add("spring.datasource.hikari.connection-init-sql", () -> "SELECT 1");
    }

    @LocalServerPort int port;
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired com.skillhub.skill.SkillWriteService write;
    @Autowired com.skillhub.skill.SkillRepository repo;

    static String apiKey;
    static boolean seeded;

    static final String PREFIX = "zz-mcp-";

    @BeforeEach
    void seedOnce() {
        if (seeded) return;
        String adminId = jdbc.queryForObject("""
                INSERT INTO users (username, name, team, role, password_hash, status)
                VALUES ('zz-mcp-admin', 'MCP Test Admin', 'platform', 'admin', 'x', 'active')
                RETURNING id::text
                """, String.class);

        byte[] rnd = new byte[24];
        new SecureRandom().nextBytes(rnd);
        String raw = "sk_hub_" + Base64.getUrlEncoder().withoutPadding().encodeToString(rnd);
        apiKey = raw;
        jdbc.update("""
                INSERT INTO api_keys (user_id, name, key_hash, prefix)
                VALUES (?::uuid, 'zz-mcp-key', ?, ?)
                """, adminId, ApiKeyService.hashApiKey(raw), raw.substring(0, 13));

        for (Fixture f : FIXTURES) {
            String skillId = jdbc.queryForObject("""
                    INSERT INTO skills (slug, title, description, when_to_use, stack, type, status,
                                        owner_team, created_by, search_text)
                    VALUES (?, ?, ?, ?, ?::stack, ?::skill_type, 'published', ?, ?::uuid, ?)
                    RETURNING id::text
                    """, String.class,
                    f.slug, f.title, f.description, f.whenToUse, f.stack, f.type, f.ownerTeam, adminId,
                    searchText(f));
            String versionId = jdbc.queryForObject("""
                    INSERT INTO skill_versions (skill_id, version, content, preview)
                    VALUES (?::uuid, 1, ?, ?) RETURNING id::text
                    """, String.class, skillId, f.content, preview(f.content));
            jdbc.update("UPDATE skills SET current_version_id = ?::uuid WHERE id = ?::uuid", versionId, skillId);
            for (String tag : f.tags) {
                jdbc.update("INSERT INTO skill_tags (skill_id, tag) VALUES (?::uuid, ?)", skillId, tag);
            }
        }
        seeded = true;
    }

    // --- helpers -------------------------------------------------------------

    private JsonNode rpc(String method, Object params, String token) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.set(HttpHeaders.ACCEPT, "application/json, text/event-stream");
        if (token != null) h.setBearerAuth(token);
        var body = json.createObjectNode();
        body.put("jsonrpc", "2.0");
        body.put("id", 1);
        body.put("method", method);
        if (params != null) body.set("params", json.valueToTree(params));
        var resp = rest.exchange("http://localhost:" + port + "/api/mcp",
                HttpMethod.POST, new HttpEntity<>(body.toString(), h), String.class);
        try {
            var out = json.createObjectNode();
            out.put("status", resp.getStatusCode().value());
            out.set("body", resp.getBody() == null ? null : json.readTree(resp.getBody()));
            return out;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private JsonNode rpc(String method, Object params) {
        return rpc(method, params, apiKey);
    }

    /** Como el helper `tool()` del original: devuelve el JSON del content[0].text. */
    private JsonNode tool(String name, Object args) {
        var r = rpc("tools/call", java.util.Map.of("name", name, "arguments", args));
        String text = r.path("body").path("result").path("content").path(0).path("text").asText(null);
        if (text == null) return null;
        try {
            return json.readTree(text);
        } catch (Exception e) {
            var o = json.createObjectNode();
            o.put("_raw", text);
            return o;
        }
    }

    private List<String> slugs(JsonNode searchResult) {
        var out = new java.util.ArrayList<String>();
        searchResult.path("results").forEach(n -> out.add(n.path("slug").asText()));
        return out;
    }

    // --- autenticacion ------------------------------------------------------

    @Test
    void sinKeyDevuelve401() {
        assertThat(rpc("tools/list", null, null).path("status").asInt()).isEqualTo(401);
    }

    @Test
    void keyInventadaDevuelve401() {
        assertThat(rpc("tools/list", null, "sk_hub_noexiste").path("status").asInt()).isEqualTo(401);
    }

    @Test
    void toolsListExponeLasSieteToolsYSoloLasDosDeEscrituraEscriben() {
        var tools = rpc("tools/list", null).path("body").path("result").path("tools");
        var nombres = new java.util.ArrayList<String>();
        var escriben = new java.util.ArrayList<String>();
        tools.forEach(t -> {
            nombres.add(t.path("name").asText());
            if (!t.path("annotations").path("readOnlyHint").asBoolean()) escriben.add(t.path("name").asText());
        });
        assertThat(nombres).containsExactlyInAnyOrder(
                "get_port_registry", "get_skill", "list_skills",
                "propose_skill", "propose_revision", "search_skills", "sync_skills");
        assertThat(escriben).containsExactlyInAnyOrder("propose_skill", "propose_revision");
    }

    @Test
    void initializeEntregaLasInstructions() {
        var instrucciones = rpc("initialize", java.util.Map.of(
                "protocolVersion", "2025-06-18", "capabilities", java.util.Map.of(),
                "clientInfo", java.util.Map.of("name", "junit", "version", "1")
        )).path("body").path("result").path("instructions").asText();
        assertThat(instrucciones).contains("BEFORE writing");
        assertThat(instrucciones).contains("search_skills");
        assertThat(instrucciones).contains("Search in English");
        assertThat(instrucciones).contains(".skill-hub/");
        assertThat(instrucciones.toLowerCase()).contains("cache");
    }

    @Test
    void keyRevocadaDejaDeServir() {
        jdbc.update("UPDATE api_keys SET revoked_at = now() WHERE name = 'zz-mcp-key'");
        try {
            assertThat(rpc("tools/list", null).path("status").asInt()).isEqualTo(401);
        } finally {
            jdbc.update("UPDATE api_keys SET revoked_at = NULL WHERE name = 'zz-mcp-key'");
        }
    }

    // --- calidad de busqueda ----------------------------------------------

    @Test
    void tareaDeFrontEncuentraBotones() {
        assertThat(slugs(tool("search_skills", java.util.Map.of("query", "save button in a form"))))
                .contains(PREFIX + "buttons");
    }

    @Test
    void tareaDeBackLlegaAlSkillCompartidoDeErrores() {
        assertThat(slugs(tool("search_skills",
                java.util.Map.of("query", "return an error from a Spring endpoint"))))
                .contains(PREFIX + "api-error-shape");
    }

    @Test
    void fraseLargaConPalabrasDeMasIgualEncuentraAlgo() {
        assertThat(slugs(tool("search_skills",
                java.util.Map.of("query", "how do I handle the error from this HTTP call"))))
                .isNotEmpty();
    }

    @Test
    void filtraPorStack() {
        var r = tool("search_skills", java.util.Map.of("query", "structure", "stack", "java"));
        r.path("results").forEach(n -> assertThat(n.path("stack").asText()).isEqualTo("java"));
    }

    @Test
    void nuncaDevuelveMasDeCinco() {
        var r = tool("search_skills", java.util.Map.of("query", "the a of in and to"));
        assertThat(r.path("results").size()).isLessThanOrEqualTo(5);
    }

    @Test
    void temaAusenteDevuelveVacioYQuedaRegistrado() throws Exception {
        String consulta = "kubernetes multi region operator " + System.nanoTime();
        var r = tool("search_skills", java.util.Map.of("query", consulta));
        assertThat(r.path("results").size()).isZero();
        assertThat(r.path("next_step").asText()).isEqualTo("propose_skill");

        Thread.sleep(6500); // flush de la cola
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM missed_queries WHERE query_text = ?", Integer.class, consulta);
        assertThat(n).isEqualTo(1);
    }

    // --- lectura de un skill --------------------------------------------

    @Test
    void getSkillTraeContenidoCompletoYTags() {
        var r = tool("get_skill", java.util.Map.of("slug", PREFIX + "buttons"));
        assertThat(r.path("content").asText()).contains("## Rule");
        var tags = new java.util.ArrayList<String>();
        r.path("tags").forEach(t -> tags.add(t.asText()));
        assertThat(tags).contains("buttons");
    }

    @Test
    void getSkillDevuelveMdGuardableSinPreview() {
        var r = tool("get_skill", java.util.Map.of("slug", PREFIX + "buttons"));
        assertThat(r.path("save_as").asText()).isEqualTo(".skill-hub/" + PREFIX + "buttons.md");
        assertThat(r.path("file").asText()).doesNotContain("```preview").doesNotContain("style=");
        assertThat(r.path("visual_example").asText()).containsIgnoringCase("visual example");
        // roundtrip del frontmatter
        String file = r.path("file").asText();
        assertThat(file).contains("slug: " + PREFIX + "buttons");
        assertThat(file).contains("version: " + r.path("version").asInt());
    }

    @Test
    void slugInexistenteDevuelveErrorNoCrash() {
        assertThat(tool("get_skill", java.util.Map.of("slug", "no-existe")).path("error").asText())
                .isNotEmpty();
    }

    @Test
    void deprecadoDejaDeAparecerYRedirigeAlReemplazo() {
        String reemplazo = jdbc.queryForObject(
                "SELECT id::text FROM skills WHERE slug = ?", String.class, PREFIX + "buttons");
        jdbc.update("UPDATE skills SET status='deprecated', superseded_by=?::uuid WHERE slug=?",
                reemplazo, PREFIX + "form-fields");
        try {
            assertThat(slugs(tool("search_skills", java.util.Map.of("query", "email field validation"))))
                    .doesNotContain(PREFIX + "form-fields");
            var lectura = tool("get_skill", java.util.Map.of("slug", PREFIX + "form-fields"));
            assertThat(lectura.path("status").asText()).isEqualTo("deprecated");
            assertThat(lectura.path("superseded_by").asText()).isEqualTo(PREFIX + "buttons");
            assertThat(lectura.has("content")).isFalse();
            assertThat(lectura.has("file")).isFalse();
        } finally {
            jdbc.update("UPDATE skills SET status='published', superseded_by=NULL WHERE slug=?",
                    PREFIX + "form-fields");
        }
    }

    // --- list_skills / sync_skills / get_port_registry -----------------

    @Test
    void listSkillsTraeLaVersionParaDetectarCopiasViejas() {
        var l = tool("list_skills", java.util.Map.of());
        assertThat(l.path("skills").size()).isGreaterThan(0);
        assertThat(l.path("skills").path(0).path("version").isIntegralNumber()).isTrue();
    }

    @Test
    void writingSkillsSeSirveYDocumentaLosCampos() {
        var r = tool("get_skill", java.util.Map.of("slug", "writing-skills"));
        assertThat(r.has("error")).isFalse();
        assertThat(r.path("type").asText()).isEqualTo("reference");
        assertThat(r.path("content").asText()).contains("## Rule").contains("when_to_use");
    }

    @Test
    void listSkillsIncluyeLasProvisionalesMarcadas() {
        jdbc.update("DELETE FROM skills WHERE slug = 'zz-test-feature-flags'");
        tool("propose_skill", PROPUESTO);
        try {
            var l = tool("list_skills", java.util.Map.of());
            var prov = bySlug(l.path("skills"), "zz-test-feature-flags");
            assertThat(prov.path("provisional").asBoolean()).isTrue();
            assertThat(l.path("provisional_count").asInt()).isGreaterThanOrEqualTo(1);
            // cuenta en el total: un agente que se orienta con list_skills la ve
            assertThat(l.path("total").asInt()).isEqualTo(l.path("skills").size());
            // las publicadas no quedan marcadas
            assertThat(bySlug(l.path("skills"), PREFIX + "buttons").path("provisional").asBoolean())
                    .isFalse();
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug = 'zz-test-feature-flags'");
        }
    }

    @Test
    void syncSkillsReconciliaCopiasLocalesEnUnLlamado() {
        var actual = tool("get_skill", java.util.Map.of("slug", PREFIX + "buttons"));
        int previa = actual.path("version").asInt();
        int nueva = previa + 1;
        String skillId = jdbc.queryForObject(
                "SELECT id::text FROM skills WHERE slug = ?", String.class, PREFIX + "buttons");
        // Nueva version publicada (current_version_id apunta a ella): la vigente
        // es la current, nunca "la de numero mas alto".
        String nuevaId = jdbc.queryForObject(
                "INSERT INTO skill_versions (skill_id, version, content) VALUES (?::uuid, ?, ?) RETURNING id::text",
                String.class, skillId, nueva, "## Rule\n\nUpdated body.");
        jdbc.update("UPDATE skills SET current_version_id = ?::uuid WHERE id = ?::uuid", nuevaId, skillId);
        try {
            var r = tool("sync_skills", java.util.Map.of("have", List.of(
                    java.util.Map.of("slug", PREFIX + "buttons", "version", previa),
                    java.util.Map.of("slug", PREFIX + "api-error-shape", "version", 999),
                    java.util.Map.of("slug", "no-existe-en-el-catalogo", "version", 1))));
            assertThat(r.path("checked").asInt()).isEqualTo(3);

            var vieja = bySlug(r.path("results"), PREFIX + "buttons");
            assertThat(vieja.path("state").asText()).isEqualTo("stale");
            assertThat(vieja.path("version").asInt()).isEqualTo(nueva);
            assertThat(vieja.path("save_as").asText()).isEqualTo(".skill-hub/" + PREFIX + "buttons.md");
            assertThat(slugList(r.path("to_overwrite"))).contains(PREFIX + "buttons");

            assertThat(bySlug(r.path("results"), PREFIX + "api-error-shape").path("state").asText())
                    .isEqualTo("current");
            var ida = bySlug(r.path("results"), "no-existe-en-el-catalogo");
            assertThat(ida.path("state").asText()).isEqualTo("gone");
            assertThat(slugList(r.path("to_delete"))).contains("no-existe-en-el-catalogo");
        } finally {
            String v1Id = jdbc.queryForObject(
                    "SELECT id::text FROM skill_versions WHERE skill_id = ?::uuid AND version = ?",
                    String.class, skillId, previa);
            jdbc.update("UPDATE skills SET current_version_id = ?::uuid WHERE id = ?::uuid", v1Id, skillId);
            jdbc.update("DELETE FROM skill_versions WHERE skill_id = ?::uuid AND version = ?", skillId, nueva);
        }
    }

    @Test
    void syncSkillsMarcaDeprecadoYApuntaAlReemplazo() {
        String reemplazo = jdbc.queryForObject(
                "SELECT id::text FROM skills WHERE slug = ?", String.class, PREFIX + "buttons");
        jdbc.update("UPDATE skills SET status='deprecated', superseded_by=?::uuid WHERE slug=?",
                reemplazo, PREFIX + "loading-states");
        try {
            var r = tool("sync_skills", java.util.Map.of("have",
                    List.of(java.util.Map.of("slug", PREFIX + "loading-states", "version", 1))));
            var res = r.path("results").path(0);
            assertThat(res.path("state").asText()).isEqualTo("deprecated");
            assertThat(res.path("superseded_by").asText()).isEqualTo(PREFIX + "buttons");
            assertThat(slugList(r.path("to_delete"))).contains(PREFIX + "loading-states");
        } finally {
            jdbc.update("UPDATE skills SET status='published', superseded_by=NULL WHERE slug=?",
                    PREFIX + "loading-states");
        }
    }

    @Test
    void getPortRegistryFiltraPorEquipo() {
        var r = tool("get_port_registry", java.util.Map.of("service", "payments"));
        var joined = new StringBuilder();
        r.path("matches").forEach(n -> joined.append(n.asText()).append(" "));
        assertThat(joined.toString()).contains("4500");
    }

    // --- propose_skill (revision de la decision 12) --------------------

    static final java.util.Map<String, Object> PROPUESTO = java.util.Map.of(
            "title", "Zz Test Feature Flags",
            "description", "How a feature flag is named, read and retired, for testing purposes.",
            "when_to_use", "Use when adding, reading or removing a feature flag or toggle in a test scenario.",
            "stack", "angular",
            "content", "## Rule\n\nA flag carries an owner and a removal date from the day it is created.",
            "from_query", "zz test naming and retiring a feature flag toggle",
            "rationale", "General practice: there was nothing in the catalogue to infer a flag convention from.");

    @Test
    void proposeFlujoCompleto() {
        jdbc.update("DELETE FROM skills WHERE slug = 'zz-test-feature-flags'");

        // busqueda vacia empuja a proponer
        var vacia = tool("search_skills", java.util.Map.of("query", PROPUESTO.get("from_query")));
        assertThat(vacia.path("results").size()).isZero();
        assertThat(vacia.path("next_step").asText()).isEqualTo("propose_skill");
        assertThat(vacia.path("note").asText()).contains("gap is not neutral");

        // propone y entra como provisional
        var creada = tool("propose_skill", PROPUESTO);
        assertThat(creada.path("status").asText()).isEqualTo("proposed");
        assertThat(creada.path("slug").asText()).isEqualTo("zz-test-feature-flags");
        var fila = jdbc.queryForMap(
                "SELECT status::text, origin::text, proposed_from_query FROM skills WHERE slug='zz-test-feature-flags'");
        assertThat(fila.get("status")).isEqualTo("proposed");
        assertThat(fila.get("origin")).isEqualTo("agent");
        assertThat(fila.get("proposed_from_query")).isEqualTo(PROPUESTO.get("from_query"));

        // el siguiente agente ya lo encuentra, marcado provisional
        var hit = bySlug(tool("search_skills",
                java.util.Map.of("query", "naming and retiring a feature flag toggle")).path("results"),
                "zz-test-feature-flags");
        assertThat(hit.path("provisional").asBoolean()).isTrue();
        assertThat(hit.path("caveat").asText()).containsIgnoringCase("not reviewed");

        // get_skill lo sirve con la advertencia
        var lectura = tool("get_skill", java.util.Map.of("slug", "zz-test-feature-flags"));
        assertThat(lectura.path("provisional").asBoolean()).isTrue();
        assertThat(lectura.path("content").asText()).contains("## Rule");

        // un segundo agente no puede duplicarlo
        var dup = tool("propose_skill", withOverrides(PROPUESTO,
                "title", "Zz Test Feature Flag", "from_query", "zz test how do I name a toggle"));
        assertThat(dup.path("status").asText()).isEqualTo("rejected");
        assertThat(slugList2(dup.path("existing"))).contains("zz-test-feature-flags");

        jdbc.update("DELETE FROM skills WHERE slug = 'zz-test-feature-flags'");
    }

    @Test
    void proposeRechazaViolacionDeTopesDeLongitud() {
        String largo = "Use when ".repeat(40); // 360 chars
        var r = tool("propose_skill", withOverrides(PROPUESTO,
                "title", "Zz Test Something Completely Unrelated To Anything",
                "when_to_use", largo,
                "from_query", "zz test unrelated topic"));
        assertThat(r.path("status").asText()).isEqualTo("rejected");
        // el error dice la longitud REAL, no un literal "(200)"
        assertThat(r.toString()).contains(String.valueOf(largo.length())).contains("200");
    }

    @Test
    void proposePluginConArchivoBase64YAprobar() {
        String slug = "zz-test-agent-plugin";
        jdbc.update("DELETE FROM skills WHERE slug = ?", slug);

        byte[] fakeZip = "PK\3\4fake-plugin-zip-contents".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String b64 = Base64.getEncoder().encodeToString(fakeZip);

        var creada = tool("propose_skill", java.util.Map.of(
                "title", "Zz Test Agent Plugin",
                "description", "A test plugin proposed by an agent with binary artifact attached.",
                "when_to_use", "Use when testing agent plugins with binary payloads.",
                "stack", "shared",
                "type", "plugin",
                "content", "## Rule\n\nPlugins must include executable packages attached by the agent.",
                "from_query", "zz test agent plugin attachment",
                "rationale", "Testing agent file uploading automation.",
                "file_name", "test-plugin.zip",
                "file_content_base64", b64
        ));

        assertThat(creada.path("status").asText()).isEqualTo("proposed");
        assertThat(creada.path("slug").asText()).isEqualTo(slug);
        assertThat(creada.path("artifact").asText()).isEqualTo("test-plugin.zip");

        String adminId = jdbc.queryForObject(
                "SELECT id::text FROM users WHERE username = 'zz-mcp-admin'", String.class);
        write.publishSkill(slug, adminId);

        var publicado = jdbc.queryForMap("SELECT status::text FROM skills WHERE slug = ?", slug);
        assertThat(publicado.get("status")).isEqualTo("published");

        jdbc.update("DELETE FROM skills WHERE slug = ?", slug);
    }

    @Test
    void proposePluginSinArchivoAutoGeneraManifestYAprueba() {
        String slug = "zz-test-plugin-no-file";
        jdbc.update("DELETE FROM skills WHERE slug = ?", slug);

        var creada = tool("propose_skill", java.util.Map.of(
                "title", "Zz Test Plugin No File",
                "description", "A test plugin proposed by an agent without file payload.",
                "when_to_use", "Use when testing agent plugin auto-generated manifest.",
                "stack", "shared",
                "type", "plugin",
                "content", "## Rule\n\nPlugins without file must auto-generate a manifest.",
                "from_query", "zz test agent plugin no file",
                "rationale", "Testing fallback manifest generation."
        ));

        assertThat(creada.path("status").asText()).isEqualTo("proposed");
        assertThat(creada.path("slug").asText()).isEqualTo(slug);

        String adminId = jdbc.queryForObject(
                "SELECT id::text FROM users WHERE username = 'zz-mcp-admin'", String.class);
        write.publishSkill(slug, adminId);

        var publicado = jdbc.queryForMap("SELECT status::text FROM skills WHERE slug = ?", slug);
        assertThat(publicado.get("status")).isEqualTo("published");

        jdbc.update("DELETE FROM skills WHERE slug = ?", slug);
    }

    // --- dedup: no rechazar por vocabulario compartido (bug A) --------

    static final java.util.Map<String, Object> STORIES = java.util.Map.of(
            "title", "Zz User Stories In Plain Language",
            "description", "How a user story is worded and split, for the Taiga backlog.",
            "when_to_use", "Use when writing a user story, splitting an epic into stories, or wording acceptance criteria for Taiga.",
            "stack", "shared",
            "content", "## Rule\n\nA user story is one sentence of user value in plain language. No Como/Quiero/Para template, but every story needs testable acceptance criteria.",
            "tags", java.util.List.of("agile", "taiga", "planning", "backlog", "documentation", "stories"),
            "from_query", "zz how to write user stories in plain language for taiga",
            "rationale", "Based on how the team already writes stories in Taiga.");

    static final java.util.Map<String, Object> EPICS = java.util.Map.of(
            "title", "Zz Product Epics In Taiga",
            "description", "How a product epic is scoped and described, distinct from a user story.",
            "when_to_use", "Use when writing a product epic, its description, its non-goals, or grouping stories under an epic in Taiga.",
            "stack", "shared",
            "content", "## Rule\n\nAn epic is a short outcome statement with explicit scope and non-goals. No user-story template, no BDD, no story points at the epic level.",
            "tags", java.util.List.of("agile", "taiga", "planning", "backlog", "documentation", "epics"),
            "from_query", "zz how to write a product epic in taiga format",
            "rationale", "The stories convention does not cover epic-level scoping; this is the opposite shape.");

    @Test
    void dosConvencionesDelMismoDominioPuedenCoexistir() {
        jdbc.update("DELETE FROM skills WHERE slug IN ('zz-user-stories-in-plain-language','zz-product-epics-in-taiga')");
        try {
            var s1 = tool("propose_skill", STORIES);
            assertThat(s1.path("status").asText()).isEqualTo("proposed");

            // comparten 5 tags y todo el vocabulario de dominio, pero son reglas
            // distintas: NO debe rechazarse en caliente.
            var s2 = tool("propose_skill", EPICS);
            assertThat(s2.path("status").asText())
                    .withFailMessage("epics fue rechazada como duplicada de stories: %s", s2)
                    .isEqualTo("proposed");
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug IN ('zz-user-stories-in-plain-language','zz-product-epics-in-taiga')");
        }
    }

    @Test
    void proposeRechazaCasiIdenticoYDevuelveElScore() {
        jdbc.update("DELETE FROM skills WHERE slug IN ('zz-user-stories-in-plain-language','zz-user-stories-in-plain-language-again')");
        try {
            tool("propose_skill", STORIES);
            var casiIgual = tool("propose_skill", withOverrides(STORIES,
                    "title", "Zz User Stories In Plain Language Again",
                    "from_query", "zz writing user stories plainly"));
            assertThat(casiIgual.path("status").asText()).isEqualTo("rejected");
            var hit = casiIgual.path("existing").path(0);
            assertThat(hit.path("slug").asText()).isEqualTo("zz-user-stories-in-plain-language");
            assertThat(hit.path("similarity").isNumber()).isTrue();
            assertThat(hit.path("similarity").asDouble()).isGreaterThan(0.0);
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug IN ('zz-user-stories-in-plain-language','zz-user-stories-in-plain-language-again')");
        }
    }

    // --- search: piso de relevancia (bug B) --------------------------

    @Test
    void searchPorDebajoDelPisoDevuelveVacioYEmpujaAProponer() {
        jdbc.update("DELETE FROM skills WHERE slug = 'zz-user-stories-in-plain-language'");
        try {
            tool("propose_skill", STORIES); // su when_to_use dice "splitting an epic into stories"

            // tarea sobre ESCRIBIR una epica: la skill de historias la roza por
            // "epic" pero no aplica. Debe caer por debajo del piso.
            var r = tool("search_skills", java.util.Map.of(
                    "query", "write a product epic with an epic description and epic non-goals"));
            assertThat(r.path("results").size())
                    .withFailMessage("devolvio un match debil en vez de vacio: %s", r)
                    .isZero();
            assertThat(r.path("next_step").asText()).isEqualTo("propose_skill");
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug = 'zz-user-stories-in-plain-language'");
        }
    }

    @Test
    void searchDevuelveElScoreDeCadaHit() {
        var r = tool("search_skills", java.util.Map.of("query", "save button in a form"));
        assertThat(r.path("results").size()).isGreaterThan(0);
        assertThat(r.path("results").path(0).path("score").isNumber()).isTrue();
    }

    // --- conteo de uso (bug G) -------------------------------------

    @Test
    void usageSoloCuentaGetSkillYNoAlEquipoDueno() throws Exception {
        // search no cuenta; get_skill del equipo dueno (platform) sobre skill
        // propio tampoco; get_skill sobre skill de otro equipo si.
        tool("search_skills", java.util.Map.of("query", "package structure of a java service module"));
        tool("get_skill", java.util.Map.of("slug", PREFIX + "api-error-shape")); // owner platform == identidad
        tool("get_skill", java.util.Map.of("slug", PREFIX + "buttons"));         // owner design-system
        Thread.sleep(6500); // flush + rollup

        assertThat(sumHits(PREFIX + "package-structure")).isZero();
        assertThat(sumHits(PREFIX + "api-error-shape")).isZero();
        assertThat(sumHits(PREFIX + "buttons")).isGreaterThan(0);
    }

    private int sumHits(String slug) {
        Integer n = jdbc.queryForObject("""
                SELECT COALESCE(SUM(ud.hits), 0)::int
                FROM usage_daily ud JOIN skills s ON s.id = ud.skill_id
                WHERE s.slug = ?
                """, Integer.class, slug);
        return n == null ? 0 : n;
    }

    // --- propose_revision (bug H) ---------------------------------

    @Test
    void proposeRevisionCreaPendienteSinTocarLaPublicada() {
        var g = tool("get_skill", java.util.Map.of("slug", PREFIX + "package-structure"));
        int base = g.path("version").asInt();
        String nuevoCuerpo = "## Rule\n\nOne package per bounded context. No catch-all `util` package. "
                + "New: the web adapter lives in its own package, not mixed with domain.";

        var rev = tool("propose_revision", java.util.Map.of(
                "slug", PREFIX + "package-structure",
                "base_version", base,
                "content", nuevoCuerpo,
                "rationale", "The rule is silent on where HTTP adapters go and teams put them in the domain package."));
        assertThat(rev.path("status").asText()).isEqualTo("revision_proposed");
        assertThat(rev.path("pending_version").asInt()).isEqualTo(base + 1);

        try {
            // get_skill sigue sirviendo la publicada, marcada
            var g2 = tool("get_skill", java.util.Map.of("slug", PREFIX + "package-structure"));
            assertThat(g2.path("version").asInt()).isEqualTo(base);
            assertThat(g2.path("pending_revision").asBoolean()).isTrue();
            assertThat(g2.path("content").asText()).doesNotContain("web adapter lives in its own package");

            // la revision propia sin revisar se puede reemplazar (misma base_version):
            // no deja bloqueado a su autor hasta que un admin la resuelva
            String cuerpoV2 = "## Rule\n\nOne package per bounded context. No catch-all `util` package. "
                    + "V2: the web adapter and the persistence adapter each live in their own package.";
            var otra = tool("propose_revision", java.util.Map.of(
                    "slug", PREFIX + "package-structure", "base_version", base,
                    "content", cuerpoV2,
                    "rationale", "Segunda pasada: aclaro tambien donde va el adapter de persistencia."));
            assertThat(otra.path("status").asText()).isEqualTo("revision_proposed");
            assertThat(otra.path("replaced_pending").asBoolean()).isTrue();

            // sigue habiendo UNA sola pendiente y es la v2; la publicada no se toca
            Integer pendientes = jdbc.queryForObject("""
                    SELECT count(*) FROM skill_versions v JOIN skills s ON s.id = v.skill_id
                    WHERE s.slug = ? AND v.proposed_by_agent
                    """, Integer.class, PREFIX + "package-structure");
            assertThat(pendientes).isEqualTo(1);
            String pendBody = jdbc.queryForObject("""
                    SELECT v.content FROM skill_versions v JOIN skills s ON s.id = v.skill_id
                    WHERE s.slug = ? AND v.id = s.pending_version_id
                    """, String.class, PREFIX + "package-structure");
            assertThat(pendBody).contains("persistence adapter");
            assertThat(tool("get_skill", java.util.Map.of("slug", PREFIX + "package-structure"))
                    .path("version").asInt()).isEqualTo(base);
        } finally {
            jdbc.update("""
                    UPDATE skills SET pending_version_id = NULL WHERE slug = ?
                    """, PREFIX + "package-structure");
            jdbc.update("""
                    DELETE FROM skill_versions WHERE proposed_by_agent
                      AND skill_id = (SELECT id FROM skills WHERE slug = ?)
                    """, PREFIX + "package-structure");
        }
    }

    @Test
    void proposeRevisionConBaseViejaRechazaPorStale() {
        var rev = tool("propose_revision", java.util.Map.of(
                "slug", PREFIX + "loading-states",
                "base_version", 999,
                "content", "## Rule\n\nShow a skeleton, not a spinner. Also: never block the whole page.",
                "rationale", "Testing the stale guard with a base_version from the future."));
        assertThat(rev.path("status").asText()).isEqualTo("rejected");
        assertThat(rev.path("reason").asText().toLowerCase()).contains("does not match the published version");
        assertThat(rev.path("current_version").asInt()).isGreaterThan(0);
    }

    @Test
    void proposeRevisionSobreSlugInexistenteRechaza() {
        var rev = tool("propose_revision", java.util.Map.of(
                "slug", "no-existe-esta-convencion",
                "base_version", 1,
                "content", "## Rule\n\nSomething about a thing that does not exist in the catalogue.",
                "rationale", "Should be rejected because the slug is unknown."));
        assertThat(rev.path("status").asText()).isEqualTo("rejected");
        assertThat(rev.path("reason").asText()).contains("No skill exists");
    }

    // --- propose_revision: title + rename (new_slug) -----------------

    /** Skill publicado propio para los tests de rename; se borra en el finally. */
    private void seedPublished(String slug, String title) {
        String adminId = jdbc.queryForObject(
                "SELECT id::text FROM users WHERE username = 'zz-mcp-admin'", String.class);
        String id = jdbc.queryForObject("""
                INSERT INTO skills (slug, title, description, when_to_use, stack, type, status,
                                    owner_team, created_by, search_text)
                VALUES (?, ?, 'Seed skill for a rename test, at least ten chars.',
                        'Use when testing the rename flow end to end in the catalogue.',
                        'shared'::stack, 'convention'::skill_type, 'published', 'platform', ?::uuid, ?)
                RETURNING id::text
                """, String.class, slug, title, adminId, slug + " rename test");
        String vid = jdbc.queryForObject("""
                INSERT INTO skill_versions (skill_id, version, content, preview)
                VALUES (?::uuid, 1, ?, NULL) RETURNING id::text
                """, String.class, id,
                "## Rule\n\nSeed body for the rename test. At least forty characters, easily met here.");
        jdbc.update("UPDATE skills SET current_version_id = ?::uuid WHERE id = ?::uuid", vid, id);
    }

    @Test
    void proposeRevisionPuedeCambiarSoloElTitulo() {
        seedPublished("zz-title-only", "Zz Title Before");
        try {
            var g = tool("get_skill", java.util.Map.of("slug", "zz-title-only"));
            int base = g.path("version").asInt();

            var rev = tool("propose_revision", java.util.Map.of(
                    "slug", "zz-title-only", "base_version", base,
                    "content", "## Rule\n\nBody changes too, but the slug stays. Forty characters is easily met here.",
                    "rationale", "Clarifying the display name and the rule wording.",
                    "title", "Zz Title After"));
            assertThat(rev.path("status").asText()).isEqualTo("revision_proposed");
            assertThat(rev.has("renamed_to")).isFalse();

            write.applyPendingEdit(repo.skillId("zz-title-only"));

            var g2 = tool("get_skill", java.util.Map.of("slug", "zz-title-only"));
            assertThat(g2.path("title").asText()).isEqualTo("Zz Title After");
            assertThat(g2.path("version").asInt()).isEqualTo(base + 1);
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug = 'zz-title-only'");
        }
    }

    @Test
    void proposeRevisionRenombraYDejaRedirect() {
        seedPublished("zz-rename-old", "Zz Rename Old");
        try {
            int base = tool("get_skill", java.util.Map.of("slug", "zz-rename-old")).path("version").asInt();

            var rev = tool("propose_revision", java.util.Map.of(
                    "slug", "zz-rename-old", "base_version", base,
                    "content", "## Rule\n\nRenamed convention body, kept intact through the rename. Forty chars, easily.",
                    "rationale", "Renaming to the generate-* convention as the team agreed.",
                    "title", "Zz Rename New",
                    "new_slug", "zz-rename-new"));
            assertThat(rev.path("status").asText()).isEqualTo("revision_proposed");
            assertThat(rev.path("renamed_to").asText()).isEqualTo("zz-rename-new");

            String id = repo.skillId("zz-rename-old");
            assertThat(repo.hasPendingAgentRevision(id)).isTrue();
            write.applyPendingEdit(id);

            // la fila viva es el slug nuevo, mismo id, contenido intacto
            var gNew = tool("get_skill", java.util.Map.of("slug", "zz-rename-new"));
            assertThat(gNew.path("slug").asText()).isEqualTo("zz-rename-new");
            assertThat(gNew.path("title").asText()).isEqualTo("Zz Rename New");
            assertThat(gNew.path("content").asText()).contains("Renamed convention body");
            assertThat(repo.skillId("zz-rename-new")).isEqualTo(id);

            // el slug viejo redirige
            var gOld = tool("get_skill", java.util.Map.of("slug", "zz-rename-old"));
            assertThat(gOld.path("status").asText()).isEqualTo("deprecated");
            assertThat(gOld.path("superseded_by").asText()).isEqualTo("zz-rename-new");
            assertThat(gOld.has("content")).isFalse();

            // sync_skills manda a borrar la copia vieja y apunta al reemplazo
            var sync = tool("sync_skills", java.util.Map.of("have", java.util.List.of(
                    java.util.Map.of("slug", "zz-rename-old", "version", 1))));
            var r0 = sync.path("results").path(0);
            assertThat(r0.path("state").asText()).isEqualTo("deprecated");
            assertThat(r0.path("superseded_by").asText()).isEqualTo("zz-rename-new");
            assertThat(slugList(sync.path("to_delete"))).contains("zz-rename-old");
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug IN ('zz-rename-old', 'zz-rename-new')");
        }
    }

    @Test
    void proposeRevisionRechazaNewSlugEnUso() {
        seedPublished("zz-rename-src", "Zz Rename Src");
        try {
            int base = tool("get_skill", java.util.Map.of("slug", "zz-rename-src")).path("version").asInt();
            var rev = tool("propose_revision", java.util.Map.of(
                    "slug", "zz-rename-src", "base_version", base,
                    "content", "## Rule\n\nTrying to rename onto a slug that already exists in the catalogue here.",
                    "rationale", "This must be rejected because the target slug is taken.",
                    "new_slug", PREFIX + "buttons"));
            assertThat(rev.path("status").asText()).isEqualTo("rejected");
            assertThat(rev.path("reason").asText().toLowerCase()).contains("already in use");
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug = 'zz-rename-src'");
        }
    }

    // --- propose_revision: una edicion web pendiente si frena (no es propia) ---

    @Test
    void proposeRevisionNoPisaUnaEdicionWebPendiente() {
        seedPublished("zz-web-pending", "Zz Web Pending");
        String memberId = jdbc.queryForObject("""
                INSERT INTO users (username, name, team, role, password_hash, status)
                VALUES ('zz-web-member', 'Web Member', 'design-system', 'member', 'x', 'active')
                RETURNING id::text
                """, String.class);
        try {
            int base = tool("get_skill", java.util.Map.of("slug", "zz-web-pending")).path("version").asInt();
            // un no-admin edita por la web -> queda pendiente por votos de pares
            var webEdit = new com.skillhub.skill.SkillInput("zz-web-pending", "Zz Web Pending",
                    "Seed skill for a rename test, at least ten chars.",
                    "Use when testing the rename flow end to end in the catalogue.",
                    "shared", "convention", "platform", java.util.List.of(),
                    "## Rule\n\nWeb edit body, pending peer votes. Forty characters is easily reached here.",
                    "ajuste menor", null);
            write.updateSkill("zz-web-pending", webEdit, memberId, false);

            var rev = tool("propose_revision", java.util.Map.of(
                    "slug", "zz-web-pending", "base_version", base,
                    "content", "## Rule\n\nAgent revision that must be blocked by the pending web edit here.",
                    "rationale", "Debe frenar: ya hay una edicion web pendiente por votos de pares."));
            assertThat(rev.path("status").asText()).isEqualTo("rejected");
            assertThat(rev.path("reason").asText().toLowerCase()).contains("someone else");
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug = 'zz-web-pending'");
            jdbc.update("DELETE FROM users WHERE username = 'zz-web-member'");
        }
    }

    // --- owning_team explicito (propose_skill / propose_revision) -----

    static final java.util.Map<String, Object> CACHE_KEYS = java.util.Map.of(
            "title", "Zz Cache Key Naming Across Services",
            "description", "How a Redis cache key is namespaced, versioned and expired across services.",
            "when_to_use", "Use when naming a Redis cache key, choosing a TTL, or versioning a cached payload shape.",
            "stack", "shared",
            "content", "## Rule\n\nA cache key is `svc:entity:v<n>:<id>` and always carries an explicit TTL.",
            "from_query", "zz how do we name and expire redis cache keys between services",
            "rationale", "There was no convention for cache-key naming; based on what payments already does.");

    @Test
    void proposeSkillAceptaOwningTeamExplicito() {
        jdbc.update("DELETE FROM skills WHERE slug = 'zz-cache-key-naming-across-services'");
        try {
            var creada = tool("propose_skill", withOverrides(CACHE_KEYS,
                    "owning_team", "architecture-guild"));
            assertThat(creada.path("status").asText()).isEqualTo("proposed");
            String owner = jdbc.queryForObject(
                    "SELECT owner_team FROM skills WHERE slug = 'zz-cache-key-naming-across-services'", String.class);
            assertThat(owner).isEqualTo("architecture-guild");
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug = 'zz-cache-key-naming-across-services'");
        }
    }

    @Test
    void proposeSkillSinOwningTeamUsaElEquipoDeLaKey() {
        jdbc.update("DELETE FROM skills WHERE slug = 'zz-cache-key-naming-across-services'");
        try {
            var creada = tool("propose_skill", CACHE_KEYS);
            assertThat(creada.path("status").asText()).isEqualTo("proposed");
            String owner = jdbc.queryForObject(
                    "SELECT owner_team FROM skills WHERE slug = 'zz-cache-key-naming-across-services'", String.class);
            assertThat(owner).isEqualTo("platform"); // el equipo de zz-mcp-admin
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug = 'zz-cache-key-naming-across-services'");
        }
    }

    @Test
    void proposeRevisionPuedeReasignarOwningTeam() {
        seedPublished("zz-owner-move", "Zz Owner Move"); // seedPublished deja owner_team = 'platform'
        try {
            int base = tool("get_skill", java.util.Map.of("slug", "zz-owner-move")).path("version").asInt();
            var rev = tool("propose_revision", java.util.Map.of(
                    "slug", "zz-owner-move", "base_version", base,
                    "content", "## Rule\n\nBody stays, but this shared convention moves to another owner. Forty chars ok.",
                    "rationale", "Se auto-asigno a platform al proponerla; es transversal y la cuida el guild.",
                    "owning_team", "architecture-guild"));
            assertThat(rev.path("status").asText()).isEqualTo("revision_proposed");
            write.applyPendingEdit(repo.skillId("zz-owner-move"));
            var g2 = tool("get_skill", java.util.Map.of("slug", "zz-owner-move"));
            assertThat(g2.path("owning_team").asText()).isEqualTo("architecture-guild");
        } finally {
            jdbc.update("DELETE FROM skills WHERE slug = 'zz-owner-move'");
        }
    }

    // --- helpers de los tests de tools -------------------------------

    private static JsonNode bySlug(JsonNode array, String slug) {
        for (JsonNode n : array) if (slug.equals(n.path("slug").asText())) return n;
        return com.fasterxml.jackson.databind.node.MissingNode.getInstance();
    }

    private static List<String> slugList(JsonNode stringArray) {
        var out = new java.util.ArrayList<String>();
        stringArray.forEach(n -> out.add(n.asText()));
        return out;
    }

    private static List<String> slugList2(JsonNode objArray) {
        var out = new java.util.ArrayList<String>();
        objArray.forEach(n -> out.add(n.path("slug").asText()));
        return out;
    }

    private static java.util.Map<String, Object> withOverrides(java.util.Map<String, Object> base, String... kv) {
        var m = new java.util.HashMap<String, Object>(base);
        for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    // --- estabilidad del prefijo cacheable ------------------------------

    @Test
    void instructionsYToolsSonIdenticosEntreLlamadas() {
        var a = rpc("initialize", java.util.Map.of("protocolVersion", "2025-06-18",
                "capabilities", java.util.Map.of(), "clientInfo", java.util.Map.of("name", "x", "version", "1")));
        var b = rpc("initialize", java.util.Map.of("protocolVersion", "2025-06-18",
                "capabilities", java.util.Map.of(), "clientInfo", java.util.Map.of("name", "x", "version", "1")));
        assertThat(a.path("body").path("result").path("instructions").asText())
                .isEqualTo(b.path("body").path("result").path("instructions").asText());

        var t1 = rpc("tools/list", null).path("body").path("result").path("tools").toString();
        var t2 = rpc("tools/list", null).path("body").path("result").path("tools").toString();
        assertThat(t1).isEqualTo(t2);
    }

    @Test
    void elPrefijoNoContieneNadaVariable() {
        var init = rpc("initialize", java.util.Map.of("protocolVersion", "2025-06-18",
                "capabilities", java.util.Map.of(), "clientInfo", java.util.Map.of("name", "x", "version", "1")))
                .path("body").path("result").path("instructions").asText();
        var tools = rpc("tools/list", null).path("body").path("result").path("tools").toString();
        var prefijo = init + tools;
        assertThat(prefijo).doesNotMatch("(?s).*\\d{4}-\\d{2}-\\d{2}.*");
        assertThat(prefijo).doesNotContain("sk_hub_");
        assertThat(prefijo).doesNotMatch("(?s).*\\b\\d+ skills\\b.*");
    }

    // --- fixtures (mismos que tests/integration/mcp.test.ts) ------------

    record Fixture(String slug, String title, String description, String whenToUse,
                   String stack, String type, String ownerTeam, List<String> tags, String content) {}

    static String md(String... lines) { return String.join("\n", lines); }

    static String searchText(Fixture f) {
        return md(f.title, f.description, f.whenToUse, String.join(" ", f.tags), f.content);
    }

    static String preview(String content) {
        var m = java.util.regex.Pattern.compile("```preview\\r?\\n([\\s\\S]*?)```").matcher(content);
        return m.find() ? m.group(1).trim() : null;
    }

    static final List<Fixture> FIXTURES = List.of(
            new Fixture(PREFIX + "buttons", "Buttons", "Every clickable action rendered in the UI.",
                    "Use when rendering a clickable action: a button, a call to action, a submit or save button in a form.",
                    "angular", "skill", "design-system", List.of("buttons", "ui"),
                    md("## Rule", "",
                            "Never render a bare `<button>`. Always use the shared `AppButton` so a save button in a form stays consistent.",
                            "", "```preview",
                            "<button style=\"padding:8px 16px;border-radius:6px\">Save</button>", "```", "")),
            new Fixture(PREFIX + "api-error-shape", "API error shape",
                    "The error response contract that Angular and Java both honour.",
                    "Use when returning an error from a Spring endpoint, or when you handle the error from an HTTP call on the client.",
                    "shared", "convention", "platform", List.of("errors", "http"),
                    md("## Rule", "",
                            "Every error response is a JSON body `{ code, message, details }` with the matching HTTP status.",
                            "The Angular client reads the same shape to handle the error from an HTTP call.")),
            new Fixture(PREFIX + "form-fields", "Form fields", "How a form field is labelled and validated.",
                    "Use when adding a form field: a text input, a select, or email field validation and its label.",
                    "angular", "skill", "design-system", List.of("forms"),
                    md("## Rule", "",
                            "Every form field has a visible label and inline validation. Email field validation runs on blur.")),
            new Fixture(PREFIX + "loading-states", "Loading states", "What to show while content is loading.",
                    "Use when showing a loading state: a spinner, a skeleton, a progress bar.",
                    "angular", "skill", "design-system", List.of("loading"),
                    md("## Rule", "", "Show a skeleton, not a spinner, for content with a known layout.")),
            new Fixture(PREFIX + "package-structure", "Package structure",
                    "How a Java service lays out its packages.",
                    "Use when deciding the package structure or module layout of a Java service.",
                    "java", "convention", "platform", List.of("structure"),
                    md("## Rule", "", "One package per bounded context. No catch-all `util` package.")),
            new Fixture("port-registry", "Port registry", "The port ranges assigned to each team.",
                    "Use before choosing a port for a new service, so you do not take another team's range.",
                    "infra", "reference", "platform", List.of("ports"),
                    md("## Rule", "", "| Team | Port range |", "| --- | --- |",
                            "| payments | 4500-4599 |", "| checkout | 4600-4699 |", "| platform | 4700-4799 |"))
    );
}
