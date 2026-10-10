package com.skillhub.infra;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
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

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end infra monitoring against Postgres 16 in Testcontainers with local
 * fake registry/actuator HTTP servers as source fixtures. Covers discovery,
 * replicas, failure/recovery thresholds, source semantics, privacy of the
 * public payload, retention and authenticated access.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class InfraIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("skillhub").withUsername("skillhub").withPassword("skillhub");

    static HttpServer fixture;
    static int fixturePort;

    // Mutable source fixture.
    static volatile String eurekaBody = "{}";
    static volatile int eurekaStatus = 200;
    static volatile String healthStatus = "UP";
    static volatile int healthHttp = 200;
    static volatile String prometheusBody = "process_uptime_seconds 1000.0\n";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry r) throws IOException {
        startFixture();
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.datasource.hikari.connection-init-sql", () -> "SELECT 1");
        r.add("app.session-secret", () -> "test-session-secret-at-least-32-chars-long");
        r.add("server.shutdown", () -> "immediate");
        r.add("app.infra.enabled", () -> true);
        r.add("app.infra.interval", () -> "PT1H");
        r.add("app.infra.eureka-url", () -> "http://127.0.0.1:" + fixturePort + "/eureka");
        r.add("app.infra.allowed-hosts", () -> List.of("127.0.0.1"));
        r.add("app.infra.allowed-ports", () -> List.of(fixturePort));
        r.add("app.infra.failure-threshold", () -> 2);
        r.add("app.infra.recovery-threshold", () -> 1);
    }

    static void startFixture() throws IOException {
        if (fixture != null) return;
        fixture = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        fixturePort = fixture.getAddress().getPort();
        fixture.createContext("/eureka/apps", ex -> respond(ex, eurekaStatus, eurekaBody));
        fixture.createContext("/actuator/health", ex -> respond(ex, healthHttp, "{\"status\":\"" + healthStatus + "\"}"));
        fixture.createContext("/actuator/prometheus", ex -> respond(ex, 200, prometheusBody));
        fixture.start();
    }

    static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    @AfterAll
    static void stopFixture() {
        if (fixture != null) fixture.stop(0);
    }

    @LocalServerPort int port;
    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired InfraMonitor monitor;
    @Autowired InfraRepository repository;

    static String cookie;

    private record Res(int status, JsonNode body) {
    }

    private Res call(HttpMethod method, String path, Object body, String session) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (session != null) headers.add(HttpHeaders.COOKIE, session);
        String payload = null;
        try {
            if (body != null) payload = json.writeValueAsString(body);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        var response = rest.exchange("http://localhost:" + port + path, method,
                new HttpEntity<>(payload, headers), String.class);
        JsonNode parsed = null;
        try {
            if (response.getBody() != null && !response.getBody().isBlank()) parsed = json.readTree(response.getBody());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        String setCookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        if (setCookie != null) cookie = setCookie.split(";", 2)[0];
        return new Res(response.getStatusCode().value(), parsed);
    }

    private String eurekaSingle(String appName, String status, int instances) {
        StringBuilder instance = new StringBuilder();
        for (int i = 0; i < instances; i++) {
            if (i > 0) instance.append(",");
            instance.append("""
                    {"instanceId":"%s-%d","hostName":"127.0.0.1","app":"%s","status":"%s",
                     "port":{"$":8080},"metadata":{"management.port":"%d"}}""".formatted(appName, i, appName, status, fixturePort));
        }
        return """
                {"applications":{"application":{"name":"%s","instance":[%s]}}}
                """.formatted(appName.toUpperCase(), instance);
    }

    @Test
    @Order(1)
    void unauthenticatedReadIsRejected() {
        Res response = call(HttpMethod.GET, "/api/infra", null, null);
        assertThat(response.status()).isEqualTo(401);
    }

    @Test
    @Order(2)
    void registerAdminAndLogin() {
        Res register = call(HttpMethod.POST, "/api/auth/register",
                java.util.Map.of("username", "InfraAdmin", "password", "unlargopassword", "team", "Backoffice"), null);
        assertThat(register.status()).isEqualTo(200);
        assertThat(cookie).isNotBlank();
    }

    @Test
    @Order(3)
    void initialViewListsExpectedServicesEvenWithoutRegistryHistory() {
        Res response = call(HttpMethod.GET, "/api/infra/state", null, cookie);
        assertThat(response.status()).isEqualTo(200);
        assertThat(response.body().get("enabled").asBoolean()).isTrue();
        List<String> names = new java.util.ArrayList<>();
        response.body().get("services").forEach(s -> names.add(s.get("name").asText()));
        assertThat(names).containsExactly(
                "users-service", "course-service", "engine-challenge-service",
                "theoretical-challenge-service", "practical-challenge-service", "sandbox-service",
                "llm-service", "accounting-service", "market-service", "roadmap-service",
                "notifications-service", "backoffice-service", "api-gateway");
    }

    @Test
    @Order(4)
    void discoveryMarksServiceUpWithUptimeAndKeepsReplicas() {
        eurekaBody = eurekaSingle("users-service", "UP", 2);
        healthHttp = 200;
        prometheusBody = "process_uptime_seconds 98765.0\n";
        monitor.runCycleOnce(Instant.now());

        Res response = call(HttpMethod.GET, "/api/infra/state", null, cookie);
        JsonNode users = find(response.body(), "users-service");
        assertThat(users.get("state").asText()).isEqualTo("UP");
        assertThat(users.get("instances").asInt()).isEqualTo(2);
        assertThat(users.get("uptimeSeconds").asLong()).isEqualTo(98765L);
        assertThat(users.get("coverage").asText()).isEqualTo("full");
    }

    @Test
    @Order(5)
    void registryHttpErrorIsUnknownNotDownAndNoCascade() {
        eurekaStatus = 500;
        monitor.runCycleOnce(Instant.now());
        Res response = call(HttpMethod.GET, "/api/infra/state", null, cookie);
        for (JsonNode service : response.body().get("services")) {
            assertThat(service.get("state").asText()).isEqualTo("UNKNOWN");
        }
        assertThat(response.body().get("source").get("registryOk").asBoolean()).isFalse();
        eurekaStatus = 200;
    }

    @Test
    @Order(6)
    void disappearanceInSuccessfulRegistryIsUnknownNotDown() {
        eurekaBody = "{}";
        monitor.runCycleOnce(Instant.now());
        Res response = call(HttpMethod.GET, "/api/infra/state", null, cookie);
        JsonNode users = find(response.body(), "users-service");
        assertThat(users.get("state").asText()).isEqualTo("UNKNOWN");
        assertThat(users.get("reason").asText()).isEqualTo("absent_from_registry");
    }

    @Test
    @Order(7)
    void failureThenRecoveryRespectsThresholdsAndPreservesLastHealthy() {
        eurekaBody = eurekaSingle("users-service", "UP", 1);
        monitor.runCycleOnce(Instant.now());
        JsonNode healthy = find(call(HttpMethod.GET, "/api/infra/state", null, cookie).body(), "users-service");
        assertThat(healthy.get("state").asText()).isEqualTo("UP");
        assertThat(healthy.get("lastHealthyAt").isNull()).isFalse();
        String lastHealthy = healthy.get("lastHealthyAt").asText();

        // Registry reports DOWN and the actuator also reports DOWN: first
        // failure is withheld (threshold 2).
        eurekaBody = eurekaSingle("users-service", "DOWN", 1);
        healthStatus = "DOWN";
        monitor.runCycleOnce(Instant.now());
        // Second failure commits DOWN.
        monitor.runCycleOnce(Instant.now());
        JsonNode down = find(call(HttpMethod.GET, "/api/infra/state", null, cookie).body(), "users-service");
        assertThat(down.get("state").asText()).isEqualTo("DOWN");
        assertThat(down.get("lastHealthyAt").asText()).isEqualTo(lastHealthy);

        // Recovery with threshold 1.
        eurekaBody = eurekaSingle("users-service", "UP", 1);
        healthStatus = "UP";
        monitor.runCycleOnce(Instant.now());
        JsonNode recovered = find(call(HttpMethod.GET, "/api/infra/state", null, cookie).body(), "users-service");
        assertThat(recovered.get("state").asText()).isEqualTo("UP");
    }

    @Test
    @Order(8)
    void publicPayloadNeverLeaksInternalDetails() {
        eurekaBody = eurekaSingle("users-service", "UP", 1);
        monitor.runCycleOnce(Instant.now());
        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.COOKIE, cookie);
        var response = rest.exchange("http://localhost:" + port + "/api/infra/state", HttpMethod.GET,
                new HttpEntity<>(headers), String.class);
        String body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body).doesNotContain("127.0.0.1");
        assertThat(body).doesNotContain("management.port");
        assertThat(body).doesNotContain("http://");
        assertThat(body).doesNotContain("https://");
        assertThat(body).doesNotContain("eureka");
        assertThat(body).doesNotContain("tailnet");
        assertThat(body).doesNotContain("100.64");
    }

    @Test
    @Order(9)
    void retentionPurgesObservationsOlderThanConfiguredDays() {
        jdbc.update("""
                INSERT INTO infra.observation (service_name, instance_key, observed_at, state, healthy,
                    registry_state, source_ok, source, reason)
                VALUES ('users-service', '_service', ?, 'UP', true, 'UP', true, 'eureka+actuator', null)
                """, java.sql.Timestamp.from(Instant.now().minus(Duration.ofDays(200))));

        long before = repository.countObservations();
        assertThat(before).isGreaterThan(0);
        // Advance the clock past the hourly purge gate.
        monitor.runCycleOnce(Instant.now().plus(Duration.ofHours(2)));
        Long stale = jdbc.queryForObject(
                "SELECT count(*) FROM infra.observation WHERE observed_at < now() - interval '90 days'",
                Long.class);
        assertThat(stale).isZero();
        assertThat(repository.countObservations()).isGreaterThan(0);
    }

    private JsonNode find(JsonNode state, String name) {
        for (JsonNode service : state.get("services")) {
            if (name.equals(service.get("name").asText())) return service;
        }
        throw new AssertionError("service not found: " + name);
    }
}
