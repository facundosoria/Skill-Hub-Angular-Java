package com.skillhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.skill.SkillInput;
import com.skillhub.skill.SkillWriteService;
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

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * API REST + auth de sesion, de punta a punta contra Postgres 16 en
 * Testcontainers. Cubre: registro (primer usuario = admin), aprobacion de
 * cuentas, CRUD de skills con las guardas de idioma y duplicados, el flujo de
 * votos de una edicion, keys, review y perfil.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class RestApiIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("skillhub").withUsername("skillhub").withPassword("skillhub");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.datasource.hikari.connection-init-sql", () -> "SELECT 1");
        r.add("app.session-secret", () -> "test-session-secret-at-least-32-chars-long");
    }

    @LocalServerPort int port;
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired SkillWriteService write;

    static String adminCookie;
    static String memberCookie;

    // --- helpers ------------------------------------------------------

    private record Res(int status, JsonNode body, String cookie) {}

    private Res call(HttpMethod method, String path, Object body, String cookie) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        if (cookie != null) h.add(HttpHeaders.COOKIE, cookie);
        HttpEntity<String> entity;
        try {
            entity = new HttpEntity<>(body == null ? null : json.writeValueAsString(body), h);
        } catch (Exception e) { throw new RuntimeException(e); }
        var resp = rest.exchange("http://localhost:" + port + path, method, entity, String.class);
        JsonNode node = null;
        try { if (resp.getBody() != null) node = json.readTree(resp.getBody()); } catch (Exception ignored) {}
        String setCookie = resp.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        String jar = setCookie == null ? null : setCookie.split(";", 2)[0];
        return new Res(resp.getStatusCode().value(), node, jar);
    }

    private Res get(String path, String cookie) { return call(HttpMethod.GET, path, null, cookie); }
    private Res post(String path, Object body, String cookie) { return call(HttpMethod.POST, path, body, cookie); }
    private Res put(String path, Object body, String cookie) { return call(HttpMethod.PUT, path, body, cookie); }
    private Res del(String path, String cookie) { return call(HttpMethod.DELETE, path, null, cookie); }

    // --- auth -------------------------------------------------------

    @Test @Order(1)
    void primerUsuarioEsAdminYRecibeSesion() {
        var r = post("/api/auth/register", Map.of(
                "username", "Facu", "password", "unlargopassword", "team", "platform"), null);
        assertThat(r.status).isEqualTo(200);
        assertThat(r.body.path("user").path("role").asText()).isEqualTo("admin");
        assertThat(r.body.path("user").path("username").asText()).isEqualTo("facu"); // normalizado
        assertThat(r.cookie).startsWith("skillhub_session=");
        adminCookie = r.cookie;

        var me = get("/api/auth/me", adminCookie);
        assertThat(me.status).isEqualTo(200);
        assertThat(me.body.path("user").path("role").asText()).isEqualTo("admin");
    }

    @Test @Order(2)
    void meSinCookieDa401() {
        assertThat(get("/api/auth/me", null).status).isEqualTo(401);
    }

    @Test @Order(3)
    void segundoUsuarioQuedaPendienteHastaQueAdminLoAprueba() {
        var reg = post("/api/auth/register", Map.of(
                "username", "member1", "password", "otrolargopass", "team", "checkout"), null);
        assertThat(reg.status).isEqualTo(200);
        assertThat(reg.body.has("info")).isTrue();
        assertThat(reg.cookie).isNull();

        var loginPend = post("/api/auth/login",
                Map.of("username", "member1", "password", "otrolargopass"), null);
        assertThat(loginPend.status).isEqualTo(400);
        assertThat(loginPend.body.path("error").asText()).contains("aprobada");

        String memberId = jdbc.queryForObject(
                "SELECT id::text FROM users WHERE username = 'member1'", String.class);
        var approve = post("/api/admin/users/" + memberId + "/approve", null, adminCookie);
        assertThat(approve.status).isEqualTo(200);

        var login = post("/api/auth/login",
                Map.of("username", "member1", "password", "otrolargopass"), null);
        assertThat(login.status).isEqualTo(200);
        memberCookie = login.cookie;
    }

    @Test @Order(4)
    void loginConPasswordMalaDaMensajeGenerico() {
        var r = post("/api/auth/login", Map.of("username", "facu", "password", "malmalmal"), null);
        assertThat(r.status).isEqualTo(400);
        assertThat(r.body.path("error").asText()).isEqualTo("Usuario o contrasena incorrectos");
    }

    // --- skills ----------------------------------------------------

    @Test @Order(10)
    void crearSkillEnEspanolLoRechaza() {
        var r = post("/api/skills", Map.of(
                "slug", "botones-de-accion", "title", "Botones",
                "description", "Cada accion que se puede clickear en la interfaz de usuario.",
                "whenToUse", "Usar cuando se renderiza un boton, una llamada a la accion o un submit.",
                "stack", "angular", "content", "## Regla\n\nNunca uses un boton pelado."), adminCookie);
        assertThat(r.body.path("error").asText()).isEqualTo("EN_SOLO_INGLES");
        assertThat(r.body.path("idioma").path("campo").asText()).isNotEmpty();
    }

    @Test @Order(11)
    void crearYLeerUnSkill() {
        var create = post("/api/skills", Map.of(
                "slug", "buttons", "title", "Buttons",
                "description", "Every clickable action rendered in the interface.",
                "whenToUse", "Use when rendering a button, a call to action, or a submit in a form.",
                "stack", "angular", "type", "skill", "tags", List.of("buttons", "ui"),
                "content", "## Rule\n\nNever render a bare button. Use the shared AppButton component."),
                adminCookie);
        assertThat(create.status).isEqualTo(200);
        assertThat(create.body.path("slug").asText()).isEqualTo("buttons");

        // create deja el skill en draft (igual que la web); un admin lo publica
        assertThat(post("/api/skills/buttons/publish", null, adminCookie).status).isEqualTo(200);

        var list = get("/api/skills", adminCookie);
        var slugs = new java.util.ArrayList<String>();
        list.body.path("skills").forEach(s -> slugs.add(s.path("slug").asText()));
        assertThat(slugs).contains("buttons");

        var one = get("/api/skills/buttons", adminCookie);
        assertThat(one.body.path("skill").path("title").asText()).isEqualTo("Buttons");
        assertThat(one.body.path("history").get(0).path("version").asInt()).isEqualTo(1);
    }

    @Test @Order(12)
    void duplicadoSinJustificacionDevuelveCandidatos() {
        var r = post("/api/skills", Map.of(
                "slug", "buttons-v2", "title", "Buttons",
                "description", "Another take on every clickable action in the interface.",
                "whenToUse", "Use when rendering any button or call to action in the interface.",
                "stack", "angular",
                "content", "## Rule\n\nAlways use the shared button component, never a bare element."),
                adminCookie);
        assertThat(r.body.has("duplicates")).isTrue();
        var dupSlugs = new java.util.ArrayList<String>();
        r.body.path("duplicates").forEach(d -> dupSlugs.add(d.path("slug").asText()));
        assertThat(dupSlugs).contains("buttons");
    }

    @Test @Order(13)
    void publicarExigeAdmin() {
        // el member crea un skill propio (draft) y no puede publicarlo
        post("/api/skills", Map.of(
                "slug", "loading-states", "title", "Loading states",
                "description", "What to show while content is loading in the UI.",
                "whenToUse", "Use when showing a loading state: a spinner, a skeleton, a progress bar.",
                "stack", "angular",
                "content", "## Rule\n\nShow a skeleton, not a spinner, for content with a known layout."),
                memberCookie);
        var pub = post("/api/skills/loading-states/publish", null, memberCookie);
        assertThat(pub.status).isEqualTo(403);
        assertThat(post("/api/skills/loading-states/publish", null, adminCookie).status).isEqualTo(200);
    }

    @Test @Order(14)
    void checkLanguageEndpoint() {
        var en = post("/api/skills/check-language", Map.of(
                "title", "Buttons", "description", "Every clickable action", "whenToUse", "a button", "content", "## Rule"),
                memberCookie);
        assertThat(en.body.isNull()).isTrue();
        var es = post("/api/skills/check-language", Map.of(
                "title", "Botones", "description", "Cada accion que se puede clickear en la pantalla del usuario",
                "whenToUse", "cuando hay un boton", "content", "## Regla\n\nNunca uses un boton pelado en la pagina"),
                memberCookie);
        assertThat(es.body.path("campo").asText()).isNotEmpty();
    }

    // --- flujo de votos de una edicion ------------------------

    @Test @Order(20)
    void edicionDeUnMemberSobrePublicadoJuntaVotosYSeAplicaSola() {
        // 3 members mas (distintos del autor), aprobados
        for (int i = 2; i <= 4; i++) {
            post("/api/auth/register", Map.of(
                    "username", "voter" + i, "password", "votpasslargo" + i, "team", "checkout"), null);
            String id = jdbc.queryForObject(
                    "SELECT id::text FROM users WHERE username = 'voter" + i + "'", String.class);
            post("/api/admin/users/" + id + "/approve", null, adminCookie);
        }

        // member1 edita el skill publicado 'buttons' -> queda pendiente
        var edit = put("/api/skills/buttons", Map.of(
                "slug", "buttons", "title", "Buttons",
                "description", "Every clickable action rendered in the interface, revised.",
                "whenToUse", "Use when rendering a button, a call to action, or a submit in a form.",
                "stack", "angular", "tags", List.of("buttons", "ui"),
                "content", "## Rule\n\nNever render a bare button. Prefer AppButton, and set an explicit type."),
                memberCookie);
        assertThat(edit.body.path("pending").asBoolean()).isTrue();

        // la fila viva NO cambio todavia
        var before = get("/api/skills/buttons", adminCookie);
        assertThat(before.body.path("skill").path("description").asText()).doesNotContain("revised");
        assertThat(before.body.path("voteStatus").path("required").asInt()).isEqualTo(3);

        // votan voter2, voter3, voter4
        int applied = 0;
        for (int i = 2; i <= 4; i++) {
            var login = post("/api/auth/login",
                    Map.of("username", "voter" + i, "password", "votpasslargo" + i), null);
            var v = post("/api/skills/buttons/vote", null, login.cookie);
            assertThat(v.status).isEqualTo(200);
            if (v.body.path("applied").asBoolean()) applied++;
        }
        assertThat(applied).isEqualTo(1); // el tercer voto la aplica

        var after = get("/api/skills/buttons", adminCookie);
        assertThat(after.body.path("skill").path("description").asText()).contains("revised");
        assertThat(after.body.path("voteStatus").isNull()).isTrue();
    }

    @Test @Order(21)
    void elAutorNoPuedeVotarSuPropiaPropuesta() {
        // member1 propone otra edicion y trata de votarla
        put("/api/skills/loading-states", Map.of(
                "slug", "loading-states", "title", "Loading states",
                "description", "What to show while content is loading, revised copy.",
                "whenToUse", "Use when showing a loading state: a spinner, a skeleton, a progress bar.",
                "stack", "angular",
                "content", "## Rule\n\nShow a skeleton, never a spinner, when the layout is known ahead of time."),
                memberCookie);
        var v = post("/api/skills/loading-states/vote", null, memberCookie);
        assertThat(v.status).isEqualTo(400);
        assertThat(v.body.path("error").asText()).containsIgnoringCase("propia propuesta");
    }

    // --- keys / review / profile --------------------------

    @Test @Order(30)
    void keysCrearListarRevocar() {
        var created = post("/api/keys", Map.of("name", "mi-cli"), memberCookie);
        assertThat(created.body.path("created").asText()).startsWith("sk_hub_");

        var list = get("/api/keys", memberCookie);
        assertThat(list.body.path("keys").size()).isEqualTo(1);
        String id = list.body.path("keys").get(0).path("id").asText();

        assertThat(del("/api/keys/" + id, memberCookie).status).isEqualTo(200);
        var after = get("/api/keys", memberCookie);
        assertThat(after.body.path("keys").get(0).path("revokedAt").isNull()).isFalse();
    }

    @Test @Order(31)
    void reviewListaYAprueba() {
        // sembramos una propuesta directo (como si viniera del MCP)
        String id = jdbc.queryForObject("""
                INSERT INTO skills (slug, title, description, when_to_use, stack, type, status, origin, search_text)
                VALUES ('feature-flags', 'Feature flags', 'How a flag is named and retired.',
                        'Use when adding or removing a feature flag.', 'angular', 'convention', 'proposed', 'agent', 'feature flags')
                RETURNING id::text
                """, String.class);
        jdbc.update("""
                INSERT INTO skill_versions (skill_id, version, content) VALUES (?::uuid, 1, '## Rule\n\nFlags carry an owner and a removal date.')
                """, id);
        jdbc.update("UPDATE skills SET current_version_id = (SELECT id FROM skill_versions WHERE skill_id = ?::uuid) WHERE id = ?::uuid", id, id);

        var list = get("/api/review", adminCookie);
        var slugs = new java.util.ArrayList<String>();
        list.body.path("proposals").forEach(p -> slugs.add(p.path("slug").asText()));
        assertThat(slugs).contains("feature-flags");

        assertThat(get("/api/review", memberCookie).status).isEqualTo(403);

        assertThat(post("/api/review/feature-flags/approve", null, adminCookie).status).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status::text FROM skills WHERE slug = 'feature-flags'", String.class))
                .isEqualTo("published");
    }

    @Test @Order(34)
    void reviewListaYAceptaUnaRevisionDeAgente() {
        // 'feature-flags' quedo publicada v1 en el test anterior. Un agente propone
        // una revision (como haria propose_revision del MCP).
        String adminId = jdbc.queryForObject(
                "SELECT id::text FROM users WHERE username = 'facu'", String.class);
        var merged = new SkillInput("feature-flags", "Feature flags",
                "How a flag is named, retired and audited.",
                "Use when adding, reading or removing a feature flag or toggle.",
                "angular", "convention", null, java.util.List.of(),
                "## Rule\n\nFlags carry an owner, a removal date, and a CI check that fails when the date passes.",
                null, null);
        var rr = write.proposeRevision("feature-flags", 1, merged, adminId,
                "The published rule has no enforcement, so stale flags pile up.");
        assertThat(rr.ok()).isTrue();

        // aparece en /review como revision, con los dos lados para el diff
        var list = get("/api/review", adminCookie);
        var rev = list.body.path("revisions");
        assertThat(rev.size()).isGreaterThanOrEqualTo(1);
        JsonNode ff = null;
        for (JsonNode n : rev) if ("feature-flags".equals(n.path("slug").asText())) ff = n;
        assertThat(ff).isNotNull();
        assertThat(ff.path("currentContent").asText()).doesNotContain("CI check");
        assertThat(ff.path("proposedContent").asText()).contains("CI check");
        assertThat(ff.path("proposedVersion").asInt()).isEqualTo(2);

        // la fila viva sigue en v1 hasta que el admin acepta
        var before = get("/api/skills/feature-flags", adminCookie);
        assertThat(before.body.path("skill").path("description").asText()).doesNotContain("audited");

        assertThat(post("/api/review/feature-flags/approve", null, adminCookie).status).isEqualTo(200);

        var after = get("/api/skills/feature-flags", adminCookie);
        assertThat(after.body.path("skill").path("description").asText()).contains("audited");
        assertThat(after.body.path("history").get(0).path("version").asInt()).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "SELECT pending_version_id FROM skills WHERE slug = 'feature-flags'", String.class)).isNull();
    }

    @Test @Order(35)
    void rechazarUnaRevisionDeAgenteSoloDescartaElCambio() {
        String adminId = jdbc.queryForObject(
                "SELECT id::text FROM users WHERE username = 'facu'", String.class);
        var merged = new SkillInput("feature-flags", "Feature flags",
                "How a flag is named, retired and audited.",
                "Use when adding, reading or removing a feature flag or toggle.",
                "angular", "convention", null, java.util.List.of(),
                "## Rule\n\nThrowaway change that an admin will discard.", null, null);
        // base_version ahora es 2 (se aplico la revision anterior)
        var rr = write.proposeRevision("feature-flags", 2, merged, adminId,
                "Deliberately weak change to test the reject path.");
        assertThat(rr.ok()).isTrue();

        assertThat(post("/api/review/feature-flags/reject",
                java.util.Map.of("motivo", "no aporta"), adminCookie).status).isEqualTo(200);

        // sigue publicada v2, sin pendiente, contenido intacto
        assertThat(jdbc.queryForObject(
                "SELECT pending_version_id FROM skills WHERE slug = 'feature-flags'", String.class)).isNull();
        var after = get("/api/skills/feature-flags", adminCookie);
        assertThat(after.body.path("skill").path("status").asText()).isEqualTo("published");
        assertThat(after.body.path("skill").path("version").path("version").asInt()).isEqualTo(2);
        assertThat(after.body.path("skill").path("version").path("content").asText())
                .contains("CI check").doesNotContain("Throwaway");
        // y ya no figura como revision pendiente
        var list = get("/api/review", adminCookie);
        list.body.path("revisions").forEach(n ->
                assertThat(n.path("slug").asText()).isNotEqualTo("feature-flags"));
    }

    @Test @Order(32)
    void profileGetYUpdate() {
        var before = get("/api/profile", memberCookie);
        assertThat(before.body.path("locale").asText()).isEqualTo("es");

        var upd = put("/api/profile", Map.of(
                "name", "Member Uno", "team", "checkout", "theme", "dark", "locale", "en"), memberCookie);
        assertThat(upd.status).isEqualTo(200);
        assertThat(get("/api/profile", memberCookie).body.path("theme").asText()).isEqualTo("dark");
    }

    @Test @Order(33)
    void adminUsersLista() {
        var r = get("/api/admin/users", adminCookie);
        assertThat(r.body.path("active").size()).isGreaterThanOrEqualTo(2);
    }
}
