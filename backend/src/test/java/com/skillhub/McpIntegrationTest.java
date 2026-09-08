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
    void toolsListExponeLasToolsDelSpikeComoLectura() {
        var tools = rpc("tools/list", null).path("body").path("result").path("tools");
        var nombres = new java.util.ArrayList<String>();
        tools.forEach(t -> nombres.add(t.path("name").asText()));
        assertThat(nombres).contains("search_skills", "get_skill");
        tools.forEach(t -> assertThat(t.path("annotations").path("readOnlyHint").asBoolean()).isTrue());
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
