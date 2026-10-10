package com.skillhub.infra;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Result of one registry query.
 *
 * {@code sourceOk=false} means the registry itself could not be read. That is a
 * failed source, not evidence about any particular micro, so callers must not
 * turn it into a cascade of DOWNs. {@code error} is a short sanitized token,
 * never a raw URL/response body.
 */
public record RegistrySnapshot(
        boolean sourceOk,
        String error,
        Instant observedAt,
        Map<String, List<ServiceInstance>> instancesByApp) {

    public static RegistrySnapshot failed(Instant observedAt, String error) {
        return new RegistrySnapshot(false, error, observedAt, Map.of());
    }

    /** Instances for an Eureka app id, matched case-insensitively. */
    public List<ServiceInstance> instancesFor(String eurekaApp) {
        if (eurekaApp == null || instancesByApp == null) return List.of();
        List<ServiceInstance> direct = instancesByApp.get(eurekaApp.toUpperCase());
        return direct == null ? List.of() : direct;
    }
}
