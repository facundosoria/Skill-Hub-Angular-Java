package com.skillhub.infra;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.time.Instant;
import java.util.OptionalLong;

/**
 * Probes one registry instance's actuator endpoints.
 *
 * The destination is always derived from validated registry metadata plus the
 * configured allowlist, so an arbitrary registry URL is never fetched. A probe
 * that cannot run because management metadata is missing or the target is not
 * approved yields NO_ACCESS with limited coverage — never a fabricated DOWN.
 */
@Component
public class ActuatorProbe {

    private static final Logger log = LoggerFactory.getLogger(ActuatorProbe.class);

    public static final String COVERAGE_FULL = "full";
    public static final String COVERAGE_PARTIAL = "partial";
    public static final String COVERAGE_UNAVAILABLE = "unavailable";

    private final HttpProbeClient http;
    private final ProbeTargetResolver resolver;
    private final InfraProperties properties;
    private final ObjectMapper mapper;

    public ActuatorProbe(HttpProbeClient http, ProbeTargetResolver resolver,
                         InfraProperties properties, ObjectMapper mapper) {
        this.http = http;
        this.resolver = resolver;
        this.properties = properties;
        this.mapper = mapper;
    }

    public record Outcome(
            InfraState state,
            String reason,
            String coverage,
            Long uptimeSeconds,
            Integer latencyMs) {
    }

    public Outcome probe(ServiceInstance instance, Integer configuredManagementPort) {
        Integer managementPort = instance.managementPort() != null
                ? instance.managementPort() : configuredManagementPort;
        ProbeTargetResolver.Decision decision = resolver.resolve(
                probeHost(instance), managementPort, instance.secureManagement(),
                properties.getPaths().getHealth());
        if (!decision.allowed()) {
            return new Outcome(InfraState.NO_ACCESS, decision.rejectReason(),
                    COVERAGE_UNAVAILABLE, null, null);
        }

        long started = System.nanoTime();
        HttpProbeClient.Response response;
        try {
            response = http.get(decision.target().uri());
        } catch (HttpProbeClient.ProbeException e) {
            // Registry may say UP while the actuator is unreachable: limited
            // coverage / degradation, not a process DOWN without evidence.
            return new Outcome(InfraState.DEGRADED, "actuator_unreachable",
                    COVERAGE_UNAVAILABLE, null, null);
        }
        int latencyMs = (int) Math.max(0, (System.nanoTime() - started) / 1_000_000);

        if (response.redirect()) {
            return new Outcome(InfraState.NO_ACCESS, "probe_redirect_blocked",
                    COVERAGE_UNAVAILABLE, null, latencyMs);
        }

        String actuatorStatus = parseStatus(response.body());
        if (!response.ok()) {
            if ("DOWN".equals(actuatorStatus) || "OUT_OF_SERVICE".equals(actuatorStatus)) {
                return new Outcome(InfraState.DOWN, "actuator_down", COVERAGE_PARTIAL, null, latencyMs);
            }
            // 5xx without a clear status: cannot assert DOWN.
            return new Outcome(InfraState.DEGRADED, "actuator_error", COVERAGE_UNAVAILABLE, null, latencyMs);
        }
        if ("DOWN".equals(actuatorStatus) || "OUT_OF_SERVICE".equals(actuatorStatus)) {
            return new Outcome(InfraState.DOWN, "actuator_down", COVERAGE_PARTIAL, null, latencyMs);
        }
        if (latencyMs > properties.getDegradeLatency().toMillis()) {
            return new Outcome(InfraState.DEGRADED, "latency_degraded", COVERAGE_PARTIAL, null, latencyMs);
        }

        Long uptime = fetchUptime(instance, configuredManagementPort);
        String coverage = uptime != null ? COVERAGE_FULL : COVERAGE_PARTIAL;
        return new Outcome(InfraState.UP, null, coverage, uptime, latencyMs);
    }

    private Long fetchUptime(ServiceInstance instance, Integer configuredManagementPort) {
        Integer managementPort = instance.managementPort() != null
                ? instance.managementPort() : configuredManagementPort;
        ProbeTargetResolver.Decision decision = resolver.resolve(
                probeHost(instance), managementPort, instance.secureManagement(),
                properties.getPaths().getPrometheus());
        if (!decision.allowed()) return null;
        try {
            HttpProbeClient.Response response = http.get(decision.target().uri());
            if (!response.ok()) return null;
            OptionalLong uptime = PrometheusParser.uptimeSeconds(response.body(), Instant.now());
            return uptime.isPresent() ? uptime.getAsLong() : null;
        } catch (HttpProbeClient.ProbeException e) {
            return null;
        }
    }

    private String parseStatus(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            var node = mapper.readTree(body).get("status");
            return node == null || node.isNull() ? null : node.asText();
        } catch (Exception e) {
            log.debug("[infra] actuator health body not JSON: {}", e.getMessage());
            return null;
        }
    }

    /** Exposed for tests that need a URI without performing the request. */
    public URI healthUri(ServiceInstance instance, Integer configuredManagementPort) {
        Integer managementPort = instance.managementPort() != null
                ? instance.managementPort() : configuredManagementPort;
        var decision = resolver.resolve(probeHost(instance), managementPort,
                instance.secureManagement(), properties.getPaths().getHealth());
        return decision.allowed() ? decision.target().uri() : null;
    }

    /**
     * Probe destination host: the registry {@code ipAddr} when present, falling
     * back to {@code hostName}. Some registries advertise container ids as the
     * host name, which do not resolve from the shared namespace.
     */
    private static String probeHost(ServiceInstance instance) {
        String ipAddr = instance.ipAddr();
        return ipAddr != null && !ipAddr.isBlank() ? ipAddr : instance.hostName();
    }
}
