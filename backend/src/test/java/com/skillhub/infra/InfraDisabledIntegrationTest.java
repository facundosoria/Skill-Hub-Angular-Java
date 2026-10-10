package com.skillhub.infra;

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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * With the feature disabled (the default) the application behaves exactly as
 * before: it starts with no registry configuration, the infra endpoint reports
 * an honest disabled state and the rest of the API keeps working.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class InfraDisabledIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("skillhub").withUsername("skillhub").withPassword("skillhub");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.datasource.hikari.connection-init-sql", () -> "SELECT 1");
        r.add("app.session-secret", () -> "test-session-secret-at-least-32-chars-long");
        // app.infra.enabled is left at its default (false).
    }

    @LocalServerPort int port;
    @Autowired TestRestTemplate rest;
    @Autowired ObjectMapper json;

    static String cookie;

    private JsonNode call(HttpMethod method, String path, Object body, String session) {
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
        String setCookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        if (setCookie != null) cookie = setCookie.split(";", 2)[0];
        try {
            return response.getBody() == null ? null : json.readTree(response.getBody());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    @Order(1)
    void existingHealthEndpointStillWorks() {
        assertThat(call(HttpMethod.GET, "/api/health", null, null).get("status").asText()).isEqualTo("ok");
    }

    @Test
    @Order(2)
    void disabledFeatureReportsHonestStateWithoutPolling() {
        call(HttpMethod.POST, "/api/auth/register",
                Map.of("username", "DisabledAdmin", "password", "unlargopassword", "team", "Backoffice"), null);

        JsonNode state = call(HttpMethod.GET, "/api/infra", null, cookie);
        assertThat(state.get("enabled").asBoolean()).isFalse();
        assertThat(state.get("configured").asBoolean()).isFalse();
        assertThat(state.get("source").get("registryOk").asBoolean()).isFalse();
        assertThat(state.get("services")).hasSize(13);
        for (JsonNode service : state.get("services")) {
            assertThat(service.get("state").asText()).isEqualTo("UNKNOWN");
            assertThat(service.get("availability24h").isNull()).isTrue();
        }
        assertThat(state.get("frontendNodes").get("available").asBoolean()).isFalse();
    }
}
