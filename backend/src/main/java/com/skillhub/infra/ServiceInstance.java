package com.skillhub.infra;

import java.util.Map;

/**
 * One instance of a service as reported by the registry. {@code metadata} is the
 * registry-provided metadata map; the probe destination is derived from the
 * instance {@code ipAddr} when present and {@code hostName} otherwise, plus the
 * management port, never from an arbitrary URL.
 */
public record ServiceInstance(
        String instanceId,
        String app,
        String hostName,
        String ipAddr,
        Integer port,
        Integer securePort,
        Boolean securePortEnabled,
        RegistryState registryState,
        Map<String, String> metadata) {

    public static final String MANAGEMENT_PORT_KEY = "management.port";

    /** Management port from registry metadata, or null when absent. */
    public Integer managementPort() {
        if (metadata == null) return null;
        String raw = metadata.get(MANAGEMENT_PORT_KEY);
        if (raw == null || raw.isBlank()) return null;
        try {
            int value = Integer.parseInt(raw.trim());
            return value > 0 ? value : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Whether the management endpoint is served over TLS. True only when the
     * registry advertised a secure port that is both enabled and positive; an
     * explicitly disabled or absent {@code enabled} flag keeps the probe on
     * plain HTTP.
     */
    public boolean secureManagement() {
        return Boolean.TRUE.equals(securePortEnabled) && securePort != null && securePort > 0;
    }
}
