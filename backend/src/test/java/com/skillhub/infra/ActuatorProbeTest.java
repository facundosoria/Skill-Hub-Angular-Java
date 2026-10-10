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
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ActuatorProbeTest {

    private HttpServer server;
    private int port;
    private InfraProperties properties;
    private ActuatorProbe probe;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        port = server.getAddress().getPort();
        properties = new InfraProperties();
        properties.setAllowedHosts(List.of("127.0.0.1"));
        properties.setAllowedPorts(List.of(port));
        properties.setAllowedSchemes(List.of("http"));
        probe = new ActuatorProbe(new HttpProbeClient(properties),
                new ProbeTargetResolver(properties), properties, new ObjectMapper());
    }

    @AfterEach
    void tearDown() {
        if (server != null) server.stop(0);
    }

    private ServiceInstance instance(Integer managementPort) {
        return instance("127.0.0.1", null, managementPort);
    }

    private ServiceInstance instance(String hostName, String ipAddr, Integer managementPort) {
        return new ServiceInstance("i1", "USERS-SERVICE", hostName, ipAddr, 8080, null, null,
                RegistryState.UP, managementPort == null ? Map.of() : Map.of("management.port", String.valueOf(managementPort)));
    }

    private void serve(String path, int status, String body, long delayMs) {
        server.createContext(path, (HttpExchange exchange) -> {
            if (delayMs > 0) {
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
    }

    @Test
    void healthyActuatorIsUpWithUptime() {
        serve("/actuator/health", 200, "{\"status\":\"UP\"}", 0);
        serve("/actuator/prometheus", 200, "process_uptime_seconds 4321.0\n", 0);
        server.start();

        ActuatorProbe.Outcome outcome = probe.probe(instance(port), null);
        assertThat(outcome.state()).isEqualTo(InfraState.UP);
        assertThat(outcome.coverage()).isEqualTo(ActuatorProbe.COVERAGE_FULL);
        assertThat(outcome.uptimeSeconds()).isEqualTo(4321L);
    }

    @Test
    void healthDownIsDown() {
        serve("/actuator/health", 200, "{\"status\":\"DOWN\"}", 0);
        server.start();
        assertThat(probe.probe(instance(port), null).state()).isEqualTo(InfraState.DOWN);
    }

    @Test
    void slowActuatorIsDegradedNotDown() {
        properties.setDegradeLatency(Duration.ofMillis(1));
        serve("/actuator/health", 200, "{\"status\":\"UP\"}", 60);
        server.start();
        ActuatorProbe.Outcome outcome = probe.probe(instance(port), null);
        assertThat(outcome.state()).isEqualTo(InfraState.DEGRADED);
        assertThat(outcome.reason()).isEqualTo("latency_degraded");
    }

    @Test
    void unreachableActuatorIsDegradedWithLimitedCoverageNotDown() {
        // Server not started: connection refused.
        ActuatorProbe.Outcome outcome = probe.probe(instance(port), null);
        assertThat(outcome.state()).isEqualTo(InfraState.DEGRADED);
        assertThat(outcome.reason()).isEqualTo("actuator_unreachable");
        assertThat(outcome.coverage()).isEqualTo(ActuatorProbe.COVERAGE_UNAVAILABLE);
    }

    @Test
    void missingManagementMetadataIsNoAccessNotAFabricatedPort() {
        ActuatorProbe.Outcome outcome = probe.probe(instance(null), null);
        assertThat(outcome.state()).isEqualTo(InfraState.NO_ACCESS);
        assertThat(outcome.reason()).isEqualTo("management_metadata_absent");
    }

    @Test
    void hostOutsideAllowlistIsRejectedBeforeAnyRequest() {
        properties.setAllowedHosts(List.of("other-host"));
        serve("/actuator/health", 200, "{\"status\":\"UP\"}", 0);
        server.start();
        ActuatorProbe.Outcome outcome = probe.probe(instance(port), null);
        assertThat(outcome.state()).isEqualTo(InfraState.NO_ACCESS);
        assertThat(outcome.reason()).isEqualTo("host_not_allowlisted");
    }

    @Test
    void redirectIsBlockedAndReported() {
        server.createContext("/actuator/health", exchange -> {
            exchange.getResponseHeaders().add("Location", "http://127.0.0.1:" + port + "/login");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.start();
        ActuatorProbe.Outcome outcome = probe.probe(instance(port), null);
        assertThat(outcome.state()).isEqualTo(InfraState.NO_ACCESS);
        assertThat(outcome.reason()).isEqualTo("probe_redirect_blocked");
    }

    @Test
    void configuredManagementPortOverrideIsUsedWhenMetadataAbsent() {
        serve("/actuator/health", 200, "{\"status\":\"UP\"}", 0);
        server.start();
        ActuatorProbe.Outcome outcome = probe.probe(instance(null), port);
        assertThat(outcome.state()).isEqualTo(InfraState.UP);
    }

    @Test
    void ipAddrWinsOverHostNameForProbeDestination() {
        properties.setAllowedHosts(List.of("10.0.0.7"));
        ServiceInstance instance = instance("users-service", "10.0.0.7", port);
        assertThat(probe.healthUri(instance, null)).isNotNull();
        assertThat(probe.healthUri(instance, null).getHost()).isEqualTo("10.0.0.7");
    }

    @Test
    void containerIdHostNameWithValidIpAddrProbesTheIp() {
        properties.setAllowedHosts(List.of("100.64.1.20"));
        ServiceInstance instance = instance("4b07046d4859", "100.64.1.20", port);
        assertThat(probe.healthUri(instance, null)).isNotNull();
        assertThat(probe.healthUri(instance, null).getHost()).isEqualTo("100.64.1.20");
    }
}
