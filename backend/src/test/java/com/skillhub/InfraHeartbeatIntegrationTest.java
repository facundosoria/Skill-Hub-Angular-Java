package com.skillhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skillhub.infra.service.InfraTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class InfraHeartbeatIntegrationTest {

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
    }

    @LocalServerPort int port;
    @Autowired TestRestTemplate rest;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired InfraTokenService tokens;
    private static String adminCookie;

    @BeforeEach
    void ensureAdminSession() {
        jdbc.update("DELETE FROM infra_service_heartbeats");
        jdbc.update("DELETE FROM infra_service_status_samples");
        if (adminCookie != null) return;
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        var response = rest.postForEntity(url("/api/auth/register"), new HttpEntity<>(Map.of(
                "username", "infra-test-admin", "password", "unlargopassword", "team", "Backoffice"), headers), String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        adminCookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE).split(";", 2)[0];
    }

    @Test
    void validHeartbeatUpdatesStatusToOk() throws Exception {
        String raw = createToken("course-service");
        assertThat(postHeartbeat(heartbeat("course-service", "node-a", 1234), raw).getStatusCode().value()).isEqualTo(200);

        JsonNode body = getStatus();
        JsonNode service = findService(body, "course-service");
        assertThat(service.path("status").asText()).isEqualTo("OK");
        assertThat(service.path("node").asText()).isEqualTo("node-a");
        assertThat(service.path("uptimeSeconds").asLong()).isEqualTo(1234);
    }

    @Test
    void mismatchedServiceTokenIsForbidden() {
        String raw = createToken("users-service");
        assertThat(postHeartbeat(heartbeat("course-service", "node-b", 10), raw).getStatusCode().value()).isEqualTo(403);
    }

    @Test
    void invalidOrRevokedTokenIsUnauthorized() {
        assertThat(postHeartbeat(heartbeat("course-service", "node-c", 10), "bad-token").getStatusCode().value()).isEqualTo(401);
        String raw = createToken("course-service");
        jdbc.update("UPDATE infra_service_tokens SET revoked_at = now() WHERE token_hash = ?", InfraTokenService.hashServiceToken(raw));
        assertThat(postHeartbeat(heartbeat("course-service", "node-c", 10), raw).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void expiredHeartbeatTransitionsToDown() {
        jdbc.update("""
                INSERT INTO infra_service_heartbeats (instance_id, service_id, node_name, status, uptime_seconds, started_at, last_heartbeat_at)
                VALUES ('course-service@old-node', 'course-service', 'old-node', 'UP', 60, now() - interval '1 hour', now() - interval '61 seconds')
                """);
        JsonNode service = findService(getStatus(), "course-service");
        assertThat(service.path("status").asText()).isEqualTo("DOWN");
        assertThat(service.path("reason").asText()).isEqualTo("timeout");
    }

    @Test
    void unreportedServiceIsReportedAsUnknown() {
        JsonNode body = getStatus();
        JsonNode service = findService(body, "users-service");
        assertThat(service.path("status").asText()).isEqualTo("UNKNOWN");
        assertThat(service.path("reason").asText()).isEqualTo("absent_from_registry");
        assertThat(body.path("summary").path("noData").asInt()).isGreaterThanOrEqualTo(1);
    }

    @Test
    void statusIncludesAvailabilityPercentagesFromRecentSamples() {
        jdbc.update("""
                INSERT INTO infra_service_status_samples (service_id, sampled_at, status) VALUES
                ('course-service', now() - interval '1 hour', 'OK'),
                ('course-service', now() - interval '2 hours', 'OK'),
                ('course-service', now() - interval '3 hours', 'DEGRADED'),
                ('course-service', now() - interval '4 hours', 'DEGRADED')
                """);

        JsonNode service = findService(getStatus(), "course-service");
        assertThat(service.path("availability24h").asDouble()).isEqualTo(50.0);
        assertThat(service.path("degraded24h").asDouble()).isEqualTo(50.0);
        assertThat(service.path("availability7d").asDouble()).isEqualTo(50.0);
        assertThat(service.path("degraded7d").asDouble()).isEqualTo(50.0);
    }

    private String createToken(String serviceId) {
        var token = tokens.generateServiceToken();
        tokens.persistServiceToken(serviceId, "integration-test", token);
        return token.raw();
    }

    private Map<String, Object> heartbeat(String service, String node, long uptime) {
        return Map.of("serviceId", service, "node", node, "status", "UP", "uptimeSeconds", uptime,
                "startedAt", Instant.now().minusSeconds(uptime).toString(), "version", "test");
    }

    private ResponseEntity<String> postHeartbeat(Object body, String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        return rest.postForEntity(url("/api/infra/heartbeat"), new HttpEntity<>(body, headers), String.class);
    }

    private JsonNode getStatus() {
        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.COOKIE, adminCookie);
        var response = rest.exchange(url("/api/infra/status"), HttpMethod.GET, new HttpEntity<>(headers), String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        try { return json.readTree(response.getBody()); } catch (Exception e) { throw new RuntimeException(e); }
    }

    private JsonNode findService(JsonNode body, String id) {
        for (JsonNode service : body.path("services")) if (id.equals(service.path("serviceId").asText())) return service;
        throw new AssertionError("Servicio no encontrado: " + id);
    }

    private String url(String path) { return "http://localhost:" + port + path; }
}
