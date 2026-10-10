package com.skillhub.infra;

import java.time.Instant;
import java.util.List;

/**
 * Public, sanitized DTOs for the infra view.
 *
 * By construction these carry only names, a sanitized status/reason, derived
 * availability, timestamps, when-known uptime and aggregate counters. They never
 * carry mesh IPs, tailnet domains, internal endpoints, registry hosts/VIPs,
 * management ports, tokens or raw metrics/log bodies.
 */
public final class InfraDto {

    private InfraDto() {
    }

    public record AvailabilityView(
            Long observedSeconds,
            Long availableSeconds,
            Long degradedSeconds,
            Long unobservedSeconds,
            Double availability,
            Double coverage,
            boolean hasData) {

        public static AvailabilityView of(Availability availability) {
            if (availability == null) return null;
            return new AvailabilityView(availability.observedSeconds(), availability.availableSeconds(),
                    availability.degradedSeconds(), availability.unobservedSeconds(),
                    availability.availability(), availability.coverage(), availability.hasData());
        }
    }

    public record ServiceView(
            String name,
            String displayName,
            String state,
            String reason,
            String coverage,
            Long uptimeSeconds,
            int instances,
            Instant lastObservedAt,
            Instant lastHealthyAt,
            Instant lastRegistryLeaseAt,
            AvailabilityView availability24h,
            AvailabilityView availability7d) {
    }

    public record SourceView(
            boolean registryConfigured,
            boolean registryOk,
            Instant lastCheckAt) {
    }

    public record SummaryView(
            int total,
            int up,
            int down,
            int degraded,
            int unknown,
            int noAccess) {
    }

    /**
     * Frontend edge nodes are a separate, optional source. Until the Tailscale
     * API contract and credentials are wired, this reports an explicit
     * unavailable/pending state: it never simulates nodes.
     */
    public record FrontendNodesView(
            boolean enabled,
            boolean available,
            String status,
            List<FrontendNodeView> nodes) {

        public static FrontendNodesView unavailable(boolean enabled, String status) {
            return new FrontendNodesView(enabled, false, status, List.of());
        }
    }

    public record FrontendNodeView(
            String label,
            String group,
            Instant lastSeenAt,
            Boolean onlineHint,
            boolean buildDataAvailable) {
    }

    public record StateView(
            boolean enabled,
            boolean configured,
            Instant generatedAt,
            SourceView source,
            SummaryView summary,
            List<ServiceView> services,
            FrontendNodesView frontendNodes) {
    }
}
