package com.skillhub.infra;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Lectura de la respuesta del actuator con el cliente HTTP simulado: estados
 * explicitos, errores sin estado, latencia, metricas de uptime y destinos.
 */
class ActuatorProbeBranchesTest {

    private InfraProperties properties;
    private HttpProbeClient http;
    private ActuatorProbe probe;

    @BeforeEach
    void setUp() {
        properties = new InfraProperties();
        properties.setAllowedHosts(List.of("10.0.0.5", "users-service"));
        properties.setAllowedPorts(List.of(8081));
        properties.setAllowedSchemes(List.of("http", "https"));
        http = mock(HttpProbeClient.class);
        probe = new ActuatorProbe(http, new ProbeTargetResolver(properties), properties, new ObjectMapper());
    }

    private static ServiceInstance instance(String ip, Map<String, String> metadata) {
        return new ServiceInstance("i1", "USERS", "users-service", ip, 8080, null, null, RegistryState.UP, metadata);
    }

    private void health(int status, String body) {
        when(http.get(URI.create("http://10.0.0.5:8081/actuator/health"))).thenReturn(new HttpProbeClient.Response(status, body));
    }

    private void prometheus(int status, String body) {
        when(http.get(URI.create("http://10.0.0.5:8081/actuator/prometheus"))).thenReturn(new HttpProbeClient.Response(status, body));
    }

    @Test
    void anErrorResponseWithAnExplicitDownStatusIsDown() {
        health(503, "{\"status\":\"OUT_OF_SERVICE\"}");

        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).state()).isEqualTo(InfraState.DOWN);
    }

    @Test
    void anErrorResponseWithoutAClearStatusIsDegraded() {
        health(500, "no es json");
        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).reason()).isEqualTo("actuator_error");

        health(500, "{\"status\":null}");
        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).reason()).isEqualTo("actuator_error");

        health(500, " ");
        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).reason()).isEqualTo("actuator_error");

        health(500, "{\"status\":\"UP\"}");
        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).state()).isEqualTo(InfraState.DEGRADED);
    }

    @Test
    void aSuccessfulResponseReportingDownIsDown() {
        health(200, "{\"status\":\"DOWN\"}");

        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).reason()).isEqualTo("actuator_down");
    }

    @Test
    void slowResponsesAreDegraded() {
        properties.setDegradeLatency(Duration.ofMillis(-1));
        health(200, "{\"status\":\"UP\"}");

        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).reason()).isEqualTo("latency_degraded");
    }

    @Test
    void uptimeComesFromPrometheusWhenAvailable() {
        health(200, "{\"status\":\"UP\"}");
        prometheus(200, "process_uptime_seconds 120.4\n");

        var outcome = probe.probe(instance("10.0.0.5", Map.of()), 8081);

        assertThat(outcome.coverage()).isEqualTo(ActuatorProbe.COVERAGE_FULL);
        assertThat(outcome.uptimeSeconds()).isEqualTo(120L);
    }

    @Test
    void missingOrFailingMetricsLeavePartialCoverage() {
        health(200, "{\"status\":\"UP\"}");
        prometheus(500, "");
        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).coverage()).isEqualTo(ActuatorProbe.COVERAGE_PARTIAL);

        prometheus(200, "# solo comentarios\n");
        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).uptimeSeconds()).isNull();

        when(http.get(URI.create("http://10.0.0.5:8081/actuator/prometheus")))
                .thenThrow(new HttpProbeClient.ProbeException("actuator_unreachable", null));
        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).coverage()).isEqualTo(ActuatorProbe.COVERAGE_PARTIAL);
    }

    @Test
    void metricsAreSkippedWhenTheirPathIsNotAllowed() {
        properties.getPaths().setPrometheus("/actuator/../env");
        health(200, "{\"status\":\"UP\"}");

        assertThat(probe.probe(instance("10.0.0.5", Map.of()), 8081).coverage()).isEqualTo(ActuatorProbe.COVERAGE_PARTIAL);
    }

    @Test
    void theManagementPortFromMetadataWinsAndTheHostFallsBackToTheName() {
        ServiceInstance byName = instance(" ", Map.of("management.port", "8081"));

        assertThat(probe.healthUri(byName, 9999)).isEqualTo(URI.create("http://users-service:8081/actuator/health"));
        assertThat(probe.healthUri(instance("10.0.0.5", Map.of()), 9999)).isNull();
        assertThat(probe.healthUri(instance(null, Map.of()), 8081)).isEqualTo(URI.create("http://users-service:8081/actuator/health"));
    }

    @Test
    void rejectedTargetsNeverCallTheNetwork() {
        var outcome = probe.probe(instance("192.168.1.1", Map.of()), 8081);

        assertThat(outcome.state()).isEqualTo(InfraState.NO_ACCESS);
        assertThat(outcome.reason()).isEqualTo("host_not_allowlisted");
        when(http.get(any())).thenThrow(new AssertionError("no deberia llamar"));
    }
}
