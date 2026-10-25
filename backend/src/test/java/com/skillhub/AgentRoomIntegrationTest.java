package com.skillhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.auth.ApiKeyService;
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

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Salas de agentes: dos equipos negocian por MCP y un humano interviene por la web. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AgentRoomIntegrationTest {

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
    static String bancoKey;
    static String mercadoKey;
    static String outsiderKey;
    static String roomId;

    private record Res(int status, JsonNode body, String cookie) {}

    private Res web(HttpMethod method, String path, Object body, String cookie) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (cookie != null) headers.add(HttpHeaders.COOKIE, cookie);
        try {
            String payload = body == null ? null : json.writeValueAsString(body);
            var response = rest.exchange("http://localhost:" + port + path, method,
                    new HttpEntity<>(payload, headers), String.class);
            JsonNode parsed = response.getBody() == null || response.getBody().isBlank()
                    ? null : json.readTree(response.getBody());
            String setCookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
            return new Res(response.getStatusCode().value(), parsed,
                    setCookie == null ? null : setCookie.split(";", 2)[0]);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private JsonNode tool(String key, String name, Object args) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.set(HttpHeaders.ACCEPT, "application/json, text/event-stream");
        h.setBearerAuth(key);
        var body = json.createObjectNode();
        body.put("jsonrpc", "2.0");
        body.put("id", 1);
        body.put("method", "tools/call");
        body.set("params", json.valueToTree(Map.of("name", name, "arguments", args)));
        var resp = rest.exchange("http://localhost:" + port + "/api/mcp",
                HttpMethod.POST, new HttpEntity<>(body.toString(), h), String.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        try {
            JsonNode rpc = json.readTree(resp.getBody());
            return json.readTree(rpc.path("result").path("content").path(0).path("text").asText());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private String userWithKey(String username, String team) {
        String userId = jdbc.queryForObject("""
                INSERT INTO users (username, name, team, role, password_hash, status)
                VALUES (?, ?, ?, 'member', 'x', 'active') RETURNING id::text
                """, String.class, username, username, team);
        byte[] rnd = new byte[24];
        new SecureRandom().nextBytes(rnd);
        String raw = "sk_hub_" + Base64.getUrlEncoder().withoutPadding().encodeToString(rnd);
        jdbc.update("INSERT INTO api_keys (user_id, name, key_hash, prefix) VALUES (?::uuid, ?, ?, ?)",
                userId, username + "-key", ApiKeyService.hashApiKey(raw), raw.substring(0, 13));
        return raw;
    }

    private List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

    @Test @Order(1)
    void agenteAbreSalaYSoloLosEquiposInvitadosLaVen() {
        adminCookie = web(HttpMethod.POST, "/api/auth/register", Map.of(
                "username", "rooms-admin", "password", "unlargopassword", "team", "Backoffice"), null).cookie;
        bancoKey = userWithKey("rooms-banco", "Banco");
        mercadoKey = userWithKey("rooms-mercado", "Mercado");
        outsiderKey = userWithKey("rooms-profesor", "Profesor");

        assertThat(tool(bancoKey, "create_room", Map.of("title", "Compra de ítems",
                "invite_teams", List.of("Equipo inventado"))).path("error").asText()).contains("Equipo desconocido");

        JsonNode created = tool(bancoKey, "create_room", Map.of("title", "Compra de ítems",
                "topic", "Definir el endpoint de débito", "invite_teams", List.of("Mercado")));
        roomId = created.path("id").asText();
        assertThat(roomId).isNotBlank();
        assertThat(texts(created.path("teams"))).containsExactlyInAnyOrder("Banco", "Mercado");
        assertThat(created.path("status").asText()).isEqualTo("open");

        assertThat(tool(mercadoKey, "list_rooms", Map.of()).path("rooms")).hasSize(1);
        assertThat(tool(outsiderKey, "list_rooms", Map.of()).path("rooms")).isEmpty();
        assertThat(tool(outsiderKey, "read_room", Map.of("room_id", roomId)).path("error").asText())
                .contains("no está invitado");
        assertThat(tool(outsiderKey, "post_room_message", Map.of("room_id", roomId, "body", "hola"))
                .path("error").asText()).contains("no está invitado");
        assertThat(tool(bancoKey, "read_room", Map.of("room_id", "no-es-uuid")).path("error").asText())
                .contains("no existe");
    }

    @Test @Order(2)
    void mensajesSeLeenPorCursorYElEquipoSaleDeLaIdentidad() {
        JsonNode first = tool(mercadoKey, "read_room", Map.of("room_id", roomId, "since_seq", 0));
        long cursor = first.path("nextSeq").asLong();
        assertThat(first.path("messages")).hasSize(1);
        assertThat(first.path("messages").path(0).path("kind").asText()).isEqualTo("system");

        JsonNode posted = tool(mercadoKey, "post_room_message", Map.of("room_id", roomId,
                "body", "Necesitamos POST /debits con itemId y amount."));
        assertThat(posted.path("authorTeam").asText()).isEqualTo("Mercado");
        assertThat(posted.path("authorKind").asText()).isEqualTo("agent");
        tool(bancoKey, "post_room_message", Map.of("room_id", roomId, "body", "OK, devolvemos 409 si no hay saldo."));

        JsonNode next = tool(bancoKey, "read_room", Map.of("room_id", roomId, "since_seq", cursor));
        assertThat(next.path("messages")).hasSize(2);
        assertThat(next.path("messages").path(0).path("seq").asLong()).isEqualTo(cursor + 1);
        assertThat(next.path("messages").path(1).path("seq").asLong()).isEqualTo(cursor + 2);
        assertThat(next.path("hasMore").asBoolean()).isFalse();

        JsonNode empty = tool(bancoKey, "read_room", Map.of("room_id", roomId, "since_seq", next.path("nextSeq").asLong()));
        assertThat(empty.path("messages")).isEmpty();
        assertThat(empty.path("nextSeq").asLong()).isEqualTo(next.path("nextSeq").asLong());
    }

    @Test @Order(3)
    void nuevaVersionReiniciaAceptacionesYTodosAceptanParaAcordar() {
        assertThat(tool(mercadoKey, "accept_agreement", Map.of("room_id", roomId, "version", 1))
                .path("error").asText()).contains("no hay un acuerdo");

        JsonNode v1 = tool(bancoKey, "propose_agreement", Map.of("room_id", roomId,
                "content", "## POST /debits\n\n- 201 ok\n- 409 sin saldo"));
        assertThat(v1.path("version").asInt()).isEqualTo(1);
        JsonNode accepted = tool(mercadoKey, "accept_agreement", Map.of("room_id", roomId, "version", 1));
        assertThat(texts(accepted.path("acceptedBy"))).containsExactly("Mercado");
        assertThat(accepted.path("status").asText()).isEqualTo("open");

        JsonNode v2 = tool(mercadoKey, "propose_agreement", Map.of("room_id", roomId, "format", "markdown",
                "content", "## POST /debits\n\n- 201 ok\n- 409 sin saldo\n- 404 ítem inexistente",
                "note", "Suma el 404."));
        assertThat(v2.path("version").asInt()).isEqualTo(2);
        assertThat(tool(bancoKey, "accept_agreement", Map.of("room_id", roomId, "version", 1))
                .path("error").asText()).contains("última versión");

        JsonNode read = tool(bancoKey, "read_room", Map.of("room_id", roomId, "since_seq", 0));
        assertThat(read.path("contract").path("version").asInt()).isEqualTo(2);
        assertThat(read.path("contract").path("acceptedBy")).isEmpty();
        assertThat(read.path("contract").path("content").asText()).contains("404");

        tool(bancoKey, "accept_agreement", Map.of("room_id", roomId, "version", 2));
        JsonNode done = tool(mercadoKey, "accept_agreement", Map.of("room_id", roomId, "version", 2));
        assertThat(done.path("status").asText()).isEqualTo("agreed");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_events WHERE action = 'agent_room.contract_accepted'",
                Integer.class)).isEqualTo(3);
    }

    @Test @Order(4)
    void humanoVeLaSalaEscribeYLaCierra() {
        Res list = web(HttpMethod.GET, "/api/rooms", null, adminCookie);
        assertThat(list.status).isEqualTo(200);
        assertThat(list.body).hasSize(1);

        Res detail = web(HttpMethod.GET, "/api/rooms/" + roomId, null, adminCookie);
        assertThat(detail.status).isEqualTo(200);
        assertThat(detail.body.path("status").asText()).isEqualTo("agreed");
        assertThat(detail.body.path("contract").path("version").asInt()).isEqualTo(2);

        Res posted = web(HttpMethod.POST, "/api/rooms/" + roomId + "/messages",
                Map.of("body", "Revisado, avancen."), adminCookie);
        assertThat(posted.status).isEqualTo(201);
        assertThat(posted.body.path("authorKind").asText()).isEqualTo("human");

        assertThat(web(HttpMethod.GET, "/api/rooms/" + roomId, null, null).status).isEqualTo(401);
        assertThat(web(HttpMethod.POST, "/api/rooms/" + roomId + "/close", null, adminCookie).status).isEqualTo(200);
        assertThat(tool(bancoKey, "post_room_message", Map.of("room_id", roomId, "body", "algo más"))
                .path("error").asText()).contains("cerrada");
    }
}
