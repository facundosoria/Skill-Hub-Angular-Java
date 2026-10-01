package com.skillhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class DepMapIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("skillhub").withUsername("skillhub").withPassword("skillhub");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.datasource.hikari.connection-init-sql", () -> "SELECT 1");
        r.add("app.session-secret", () -> "test-session-secret-at-least-32-chars-long");
        r.add("server.shutdown", () -> "immediate");
    }

    @LocalServerPort int port;
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    static String adminCookie;
    static String memberCookie;
    static String addedEdge;

    private record Res(int status, JsonNode body, String cookie) {}

    private Res call(HttpMethod method, String path, Object body, String cookie) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (cookie != null) headers.add(HttpHeaders.COOKIE, cookie);
        String payload = null;
        try { if (body != null) payload = json.writeValueAsString(body); }
        catch (Exception e) { throw new RuntimeException(e); }
        var response = rest.exchange("http://localhost:" + port + path, method,
                new HttpEntity<>(payload, headers), String.class);
        JsonNode parsed = null;
        try { if (response.getBody() != null && !response.getBody().isBlank()) parsed = json.readTree(response.getBody()); }
        catch (Exception e) { throw new RuntimeException(e); }
        String setCookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        return new Res(response.getStatusCode().value(), parsed,
                setCookie == null ? null : setCookie.split(";", 2)[0]);
    }

    private Res get(String path, String cookie) { return call(HttpMethod.GET, path, null, cookie); }
    private Res post(String path, Object body, String cookie) { return call(HttpMethod.POST, path, body, cookie); }
    private Res put(String path, Object body, String cookie) { return call(HttpMethod.PUT, path, body, cookie); }
    private Res delete(String path, String cookie) { return call(HttpMethod.DELETE, path, null, cookie); }

    @Test @Order(1)
    void estadoInicialConservaLaFuente() {
        var registration = post("/api/auth/register", Map.of(
                "username", "depmap-admin", "password", "unlargopassword", "team", "Backoffice"), null);
        assertThat(registration.status).isEqualTo(200);
        adminCookie = registration.cookie;

        var state = get("/api/depmap/state", adminCookie);
        assertThat(state.status).isEqualTo(200);
        assertThat(state.body.path("version").asLong()).isEqualTo(5);
        assertThat(state.body.path("nodes")).hasSize(13);
        assertThat(state.body.path("edges")).hasSize(57);
        assertThat(state.body.path("done")).hasSize(4);
        assertThat(state.body.path("activity")).hasSize(4);
        assertThat(state.body.path("nodes").path("cur").path("x").asInt()).isEqualTo(500);
        assertThat(state.body.path("nodes").path("cur").path("y").asInt()).isEqualTo(255);
        assertThat(state.body.path("nodes").path("ux").path("x").asInt()).isEqualTo(95);
        assertThat(state.body.path("nodes").path("ux").path("y").asInt()).isEqualTo(48);
    }

    @Test @Order(2)
    void autenticaYRestringeImportReset() {
        assertThat(get("/api/depmap/state", null).status).isEqualTo(401);
        var registration = post("/api/auth/register", Map.of(
                "username", "depmap-member", "password", "otrolargopass", "team", "Mercado"), null);
        assertThat(registration.status).isEqualTo(200);
        String id = jdbc.queryForObject("SELECT id::text FROM users WHERE username = 'depmap-member'", String.class);
        assertThat(post("/api/admin/users/" + id + "/approve", null, adminCookie).status).isEqualTo(200);
        memberCookie = post("/api/auth/login", Map.of(
                "username", "depmap-member", "password", "otrolargopass"), null).cookie;
        assertThat(post("/api/depmap/import", Map.of("edges", List.of()), memberCookie).status).isEqualTo(403);
        assertThat(post("/api/depmap/reset", null, memberCookie).status).isEqualTo(403);
    }

    @Test @Order(3)
    void mutacionesValidanVersionActividadYAuditoria() {
        long before = get("/api/depmap/state", adminCookie).body.path("version").asLong();
        int auditBefore = jdbc.queryForObject("SELECT count(*) FROM audit_events", Integer.class);
        var invalid = post("/api/depmap/edges", Map.of(
                "from", "cur", "to", "cur", "kind", "api", "text", "x"), memberCookie);
        assertThat(invalid.status).isEqualTo(400);
        assertThat(invalid.body.path("error").asText()).isEqualTo("Elegí dos grupos distintos.");

        var created = post("/api/depmap/edges", Map.of(
                "from", "cur", "to", "acc", "kind", "api", "text", "Dependencia de prueba"), memberCookie);
        assertThat(created.status).isEqualTo(201);
        addedEdge = created.body.path("edge").path("id").asText();
        assertThat(created.body.path("version").asLong()).isEqualTo(before + 1);
        assertThat(put("/api/depmap/done/" + addedEdge, Map.of("done", true), memberCookie).status).isEqualTo(200);
        assertThat(delete("/api/depmap/edges/" + addedEdge, memberCookie).status).isEqualTo(200);
        assertThat(get("/api/depmap/state", adminCookie).body.path("version").asLong()).isEqualTo(before + 3);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_events", Integer.class)).isEqualTo(auditBefore + 3);
        assertThat(get("/api/depmap/state", adminCookie).body.path("activity")).hasSize(7);
    }

    @Test @Order(4)
    void sseRecibeHelloYUpdate() throws Exception {
        var reader = new SseReader();
        reader.start();
        assertThat(reader.hello.await(10, TimeUnit.SECONDS)).isTrue();
        var created = post("/api/depmap/edges", Map.of(
                "from", "usr", "to", "not", "kind", "evento", "text", "Evento SSE"), adminCookie);
        assertThat(created.status).isEqualTo(201);
        assertThat(reader.update.await(10, TimeUnit.SECONDS)).isTrue();
        reader.close();
    }

    @Test @Order(5)
    void adminPuedeResetearYLaSecuenciaSigueDisponible() {
        long beforeVersion = get("/api/depmap/state", adminCookie).body.path("version").asLong();
        int auditBefore = jdbc.queryForObject("SELECT count(*) FROM audit_events", Integer.class);

        var reset = post("/api/depmap/reset", null, adminCookie);
        assertThat(reset.status).isEqualTo(200);
        assertThat(reset.body.path("version").asLong()).isEqualTo(beforeVersion + 1);

        var state = get("/api/depmap/state", adminCookie);
        assertThat(state.status).isEqualTo(200);
        assertThat(state.body.path("edges")).hasSize(57);
        assertThat(state.body.path("done")).isEmpty();
        assertThat(state.body.path("activity").get(0).path("summary").asText())
                .contains("restauró los datos originales");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_events", Integer.class))
                .isEqualTo(auditBefore + 1);

        var created = post("/api/depmap/edges", Map.of(
                "from", "cur", "to", "acc", "kind", "api", "text", "Después del reset"), memberCookie);
        assertThat(created.status).isEqualTo(201);
        assertThat(delete("/api/depmap/edges/" + created.body.path("edge").path("id").asText(), memberCookie).status)
                .isEqualTo(200);
    }

    @Test @Order(6)
    void adminPuedeImportarReemplazandoEstadoYLaSecuenciaSigueDisponible() {
        long beforeVersion = get("/api/depmap/state", adminCookie).body.path("version").asLong();
        int auditBefore = jdbc.queryForObject("SELECT count(*) FROM audit_events", Integer.class);
        var importedEdge = Map.of(
                "id", "imported-edge",
                "from", "usr",
                "to", "not",
                "kind", "evento",
                "state", "definir",
                "text", "Importada para la prueba");

        var imported = post("/api/depmap/import", Map.of(
                "edges", List.of(importedEdge),
                "done", Map.of("imported-edge", true)), adminCookie);
        assertThat(imported.status).isEqualTo(200);
        assertThat(imported.body.path("version").asLong()).isEqualTo(beforeVersion + 1);

        var state = get("/api/depmap/state", adminCookie);
        assertThat(state.status).isEqualTo(200);
        assertThat(state.body.path("edges")).hasSize(1);
        assertThat(state.body.path("edges").get(0).path("id").asText()).isEqualTo("imported-edge");
        assertThat(state.body.path("done").path("imported-edge").asBoolean()).isTrue();
        assertThat(state.body.path("activity").get(0).path("summary").asText())
                .contains("importó datos (1 dependencias, 1 tildadas)");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_events", Integer.class))
                .isEqualTo(auditBefore + 1);

        var created = post("/api/depmap/edges", Map.of(
                "from", "cur", "to", "acc", "kind", "api", "text", "Después del import"), memberCookie);
        assertThat(created.status).isEqualTo(201);
        assertThat(delete("/api/depmap/edges/" + created.body.path("edge").path("id").asText(), memberCookie).status)
                .isEqualTo(200);
    }

    private final class SseReader implements AutoCloseable {
        private final CountDownLatch hello = new CountDownLatch(1);
        private final CountDownLatch update = new CountDownLatch(1);
        private volatile HttpURLConnection connection;
        private volatile BufferedReader input;
        private Thread thread;

        void start() {
            thread = new Thread(() -> {
                try {
                    connection = (HttpURLConnection) URI.create("http://localhost:" + port + "/api/depmap/events").toURL().openConnection();
                    connection.setRequestProperty(HttpHeaders.COOKIE, adminCookie);
                    connection.setRequestProperty(HttpHeaders.ACCEPT, MediaType.TEXT_EVENT_STREAM_VALUE);
                    connection.setRequestProperty(HttpHeaders.CONNECTION, "close");
                    connection.setReadTimeout(15_000);
                    input = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
                    try (var in = input) {
                        String line;
                        while ((line = in.readLine()) != null) {
                            if (line.contains("\"type\":\"hello\"")) hello.countDown();
                            if (line.contains("\"type\":\"update\"")) update.countDown();
                            if (update.getCount() == 0) break;
                        }
                    }
                } catch (Exception ignored) {
                    // The assertions on both latches expose an unexpected disconnect.
                }
            }, "depmap-sse-test");
            thread.start();
        }

        @Override public void close() throws Exception {
            if (input != null) input.close();
            if (connection != null) connection.disconnect();
            if (thread != null) thread.interrupt();
            if (thread != null) thread.join(2_000);
        }
    }
}
