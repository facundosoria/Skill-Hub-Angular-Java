package com.skillhub.infra;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class EurekaRegistryClientTest {

    private HttpServer server;
    private int port;
    private InfraProperties properties;
    private EurekaRegistryClient client;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        port = server.getAddress().getPort();
        properties = new InfraProperties();
        properties.setEurekaUrl("http://127.0.0.1:" + port + "/eureka");
        client = new EurekaRegistryClient(new HttpProbeClient(properties), properties, new ObjectMapper());
    }

    @AfterEach
    void tearDown() {
        if (server != null) server.stop(0);
    }

    private void respond(String path, int status, String body) {
        server.createContext(path, (HttpExchange exchange) -> write(exchange, status, body));
    }

    private static void write(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    @Test
    void readsRegistryAndParsesApplications() {
        respond("/eureka/apps", 200, """
                { "applications": { "application": [
                  { "name": "USERS-SERVICE", "instance": { "instanceId": "u1", "hostName": "users-service",
                    "status": "UP", "port": { "$": 8080 }, "metadata": { "management.port": "9090" } } } ] } }
                """);
        server.start();

        RegistrySnapshot snapshot = client.fetch(Instant.now());
        assertThat(snapshot.sourceOk()).isTrue();
        assertThat(snapshot.instancesFor("users-service")).hasSize(1);
        assertThat(snapshot.instancesFor("users-service").get(0).managementPort()).isEqualTo(9090);
    }

    @Test
    void httpErrorIsAFailedSourceNotADownCascade() {
        respond("/eureka/apps", 500, "{}");
        server.start();

        RegistrySnapshot snapshot = client.fetch(Instant.now());
        assertThat(snapshot.sourceOk()).isFalse();
        assertThat(snapshot.error()).isEqualTo("registry_unavailable");
    }

    @Test
    void unreachableRegistryIsReportedAsUnreachable() {
        properties.setEurekaUrl("http://127.0.0.1:1/eureka");
        RegistrySnapshot snapshot = client.fetch(Instant.now());
        assertThat(snapshot.sourceOk()).isFalse();
        assertThat(snapshot.error()).isEqualTo("registry_unreachable");
    }

    @Test
    void unconfiguredRegistryIsExplicit() {
        properties.setEurekaUrl("");
        RegistrySnapshot snapshot = client.fetch(Instant.now());
        assertThat(snapshot.sourceOk()).isFalse();
        assertThat(snapshot.error()).isEqualTo("registry_unconfigured");
    }

    @Test
    void doesNotFollowRegistryRedirect() {
        server.createContext("/eureka/apps", exchange -> {
            exchange.getResponseHeaders().add("Location", "http://127.0.0.1:" + port + "/elsewhere");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.createContext("/elsewhere", exchange -> write(exchange, 200, "{\"applications\":{}}"));
        server.start();

        RegistrySnapshot snapshot = client.fetch(Instant.now());
        assertThat(snapshot.sourceOk()).isFalse();
        assertThat(snapshot.error()).isEqualTo("registry_redirect_blocked");
    }
}
