package com.skillhub.infra.service;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class FrontendNodesServiceTest {
    private final AtomicReference<String> responseBody = new AtomicReference<>();
    private HttpServer server;
    private MemoryJdbcTemplate jdbc;
    private FrontendNodesService service;

    @BeforeEach
    void setUp() throws IOException {
        jdbc = new MemoryJdbcTemplate();
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v2/tailnet/test-tailnet/devices", exchange -> {
            assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isEqualTo("Bearer test-token");
            byte[] body = responseBody.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        TailscaleClient client = new TestTailscaleClient("http://localhost:" + server.getAddress().getPort() + "/api/v2",
                "test-token", "test-tailnet");
        service = new FrontendNodesService(jdbc, client, "test-token", "test-tailnet");
    }

    @AfterEach
    void tearDown() {
        if (server != null) server.stop(0);
    }

    @Test
    void validHostnameIsOnlineAndParsed() throws Exception {
        responseBody.set(payload("device-1", "group-05-frontend-moya"));
        service.syncFromTailscale();
        var status = service.getFrontendNodesStatus();
        assertThat(status.nodes()).singleElement().satisfies(node -> {
            assertThat(node.hostname()).isEqualTo("group-05-frontend-moya");
            assertThat(node.group()).isEqualTo("05");
            assertThat(node.name()).isEqualTo("moya");
            assertThat(node.identityDeclared()).isTrue();
            assertThat(node.status()).isEqualTo("ONLINE");
        });
    }

    @Test
    void unmatchedHostnameIsStoredAsUnidentified() {
        responseBody.set(payload("device-2", "student-laptop"));
        service.syncFromTailscale();
        var node = service.getFrontendNodesStatus().nodes().getFirst();
        assertThat(node.identityDeclared()).isFalse();
        assertThat(node.group()).isNull();
        assertThat(node.name()).isNull();
    }

    @Test
    void missingDeviceBecomesOfflineAndIsRetained() {
        responseBody.set(payload("device-3", "group-02-frontend-ada"));
        service.syncFromTailscale();
        responseBody.set("{\"devices\":[]}");
        service.syncFromTailscale();
        var status = service.getFrontendNodesStatus();
        assertThat(status.nodes()).hasSize(1);
        assertThat(status.nodes().getFirst().status()).isEqualTo("OFFLINE");
    }

    @Test
    void missingConfigurationReturnsUnavailableWithoutCallingApi() {
        FrontendNodesService unavailable = new FrontendNodesService(jdbc,
                new TestTailscaleClient("http://127.0.0.1:1", "", ""), "", "");
        var status = unavailable.getFrontendNodesStatus();
        assertThat(status.available()).isFalse();
        assertThat(status.source()).isEqualTo("no_configurado");
    }

    private String payload(String id, String hostname) {
        return "{\"devices\":[{\"id\":\"" + id + "\",\"hostname\":\"" + hostname
                + "\",\"tags\":[\"tag:frontend-edge\"],\"lastSeen\":\"" + Instant.now() + "\"}]}";
    }

    private static class TestTailscaleClient extends TailscaleClient {
        TestTailscaleClient(String baseUrl, String token, String tailnet) { super(baseUrl, token, tailnet); }
    }

    private static class MemoryJdbcTemplate extends JdbcTemplate {
        private final List<Node> nodes = new ArrayList<>();

        @Override
        public int update(String sql) {
            if (sql.startsWith("UPDATE frontend_nodes SET last_status = 'OFFLINE'")) {
                for (Node node : nodes) node.status = "OFFLINE";
                return nodes.size();
            }
            return 0;
        }

        @Override
        public int update(String sql, Object... args) {
            if (sql.startsWith("INSERT INTO frontend_nodes")) {
                String id = (String) args[0];
                Node node = nodes.stream().filter(existing -> existing.id.equals(id)).findFirst().orElse(null);
                if (node == null) {
                    node = new Node(id);
                    nodes.add(node);
                }
                node.hostname = (String) args[1];
                node.group = (String) args[2];
                node.name = (String) args[3];
                node.identityDeclared = (Boolean) args[4];
                node.lastSeen = (Timestamp) args[5];
                node.status = (String) args[6];
                node.updatedAt = Timestamp.from(Instant.now());
                return 1;
            }
            if (sql.startsWith("UPDATE frontend_nodes SET last_status = 'OFFLINE'")) {
                if (args.length == 0) {
                    for (Node node : nodes) node.status = "OFFLINE";
                } else {
                    for (Node node : nodes) {
                        boolean present = false;
                        for (Object id : args) if (node.id.equals(id)) present = true;
                        if (!present) node.status = "OFFLINE";
                    }
                }
                return nodes.size();
            }
            return 0;
        }

        @Override
        public <T> T queryForObject(String sql, RowMapper<T> rowMapper) {
            Timestamp latest = nodes.stream().map(node -> node.updatedAt).filter(value -> value != null)
                    .max(Timestamp::compareTo).orElse(null);
            try { return rowMapper.mapRow(resultSet(null, latest), 0); }
            catch (SQLException e) { throw new IllegalStateException(e); }
        }

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper) {
            List<T> result = new ArrayList<>();
            try {
                for (int i = 0; i < nodes.size(); i++) result.add(rowMapper.mapRow(resultSet(nodes.get(i), null), i));
            } catch (SQLException e) { throw new IllegalStateException(e); }
            return result;
        }

        private ResultSet resultSet(Node node, Timestamp maxUpdated) throws SQLException {
            ResultSet rs = mock(ResultSet.class);
            if (node == null) {
                when(rs.getTimestamp(1)).thenReturn(maxUpdated);
            } else {
                when(rs.getString("hostname")).thenReturn(node.hostname);
                when(rs.getString("parsed_group")).thenReturn(node.group);
                when(rs.getString("parsed_name")).thenReturn(node.name);
                when(rs.getBoolean("identity_declared")).thenReturn(node.identityDeclared);
                when(rs.getString("last_status")).thenReturn(node.status);
                when(rs.getTimestamp("last_seen_at")).thenReturn(node.lastSeen);
                when(rs.getTimestamp("first_seen_at")).thenReturn(node.firstSeen);
            }
            return rs;
        }

        private static class Node {
            final String id;
            String hostname, group, name, status;
            boolean identityDeclared;
            Timestamp firstSeen = Timestamp.from(Instant.now()), lastSeen, updatedAt;
            Node(String id) { this.id = id; }
        }
    }
}
