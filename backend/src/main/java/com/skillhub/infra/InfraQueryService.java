package com.skillhub.infra;

import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Builds the authenticated infra view from persisted state. It never polls:
 * reads only touch the database, so a slow or unreachable registry cannot make
 * a page load block.
 */
@Service
public class InfraQueryService {

    /** Reasons we are willing to surface verbatim; anything else becomes a generic token. */
    private static final Set<String> SAFE_REASONS = Set.of(
            "absent_from_registry", "registry_unconfigured", "registry_unreachable", "registry_unavailable",
            "registry_redirect_blocked", "registry_url_invalid", "registry_parse_error",
            "management_metadata_absent", "host_not_allowlisted", "port_not_allowed", "scheme_not_allowed",
            "path_not_allowed", "host_missing", "actuator_unreachable", "actuator_error", "actuator_down",
            "probe_redirect_blocked", "latency_degraded", "coverage_unavailable", "probe_error", "registry_down");

    private final InfraProperties properties;
    private final InfraRepository repository;
    private final AvailabilityCalculator calculator;
    private final Clock clock;

    public InfraQueryService(InfraProperties properties, InfraRepository repository,
                             AvailabilityCalculator calculator, Clock clock) {
        this.properties = properties;
        this.repository = repository;
        this.calculator = calculator;
        this.clock = clock;
    }

    public InfraDto.StateView current() {
        Instant now = clock.instant();
        long window24h = Math.max(1, properties.getAvailabilityWindow24h().toSeconds());
        long window7d = Math.max(window24h, properties.getAvailabilityWindow7d().toSeconds());
        Instant from24 = now.minusSeconds(window24h);
        Instant from7 = now.minusSeconds(window7d);

        List<InfraProperties.ServiceDefinition> catalogue = new ArrayList<>(properties.getCatalogue());
        catalogue.removeIf(def -> def == null || def.getName() == null || def.getName().isBlank());
        catalogue.sort(Comparator.comparingInt(InfraProperties.ServiceDefinition::getSortOrder));

        Map<String, InfraRepository.ServiceStateRecord> states = repository.loadStates();
        Map<String, List<AvailabilitySample>> samples = new HashMap<>();
        if (properties.isEnabled()) {
            for (AvailabilitySample sample : repository.loadServiceSamples(from7, now)) {
                samples.computeIfAbsent(sample.serviceName(), k -> new ArrayList<>()).add(sample);
            }
        }

        List<InfraDto.ServiceView> services = new ArrayList<>();
        int up = 0;
        int down = 0;
        int degraded = 0;
        int unknown = 0;
        int noAccess = 0;

        for (InfraProperties.ServiceDefinition def : catalogue) {
            String name = def.getName();
            InfraRepository.ServiceStateRecord state = states.get(name);
            String stateName = state == null || state.state() == null ? InfraState.UNKNOWN.name() : state.state().name();
            switch (InfraState.valueOf(stateName)) {
                case UP -> up++;
                case DOWN -> down++;
                case DEGRADED -> degraded++;
                case NO_ACCESS -> noAccess++;
                case UNKNOWN -> unknown++;
            }
            List<AvailabilitySample> serviceSamples = samples.getOrDefault(name, List.of());
            InfraDto.AvailabilityView a24 = properties.isEnabled()
                    ? InfraDto.AvailabilityView.of(calculator.compute(serviceSamples, from24, now, now)) : null;
            InfraDto.AvailabilityView a7 = properties.isEnabled()
                    ? InfraDto.AvailabilityView.of(calculator.compute(serviceSamples, from7, now, now)) : null;
            services.add(new InfraDto.ServiceView(
                    name,
                    def.getName(),
                    stateName,
                    sanitizeReason(state == null ? null : state.reason()),
                    state == null ? null : state.coverage(),
                    state == null ? null : state.uptimeSeconds(),
                    state == null ? 0 : state.instances(),
                    state == null ? null : state.lastObservedAt(),
                    state == null ? null : state.lastHealthyAt(),
                    state == null ? null : state.lastRegistryLeaseAt(),
                    a24,
                    a7));
        }

        boolean registryConfigured = properties.getEurekaUrl() != null && !properties.getEurekaUrl().isBlank();
        boolean registryOk = states.values().stream().anyMatch(InfraRepository.ServiceStateRecord::sourceOk);
        Instant lastCheck = states.values().stream()
                .map(InfraRepository.ServiceStateRecord::lastRegistryCheckAt)
                .filter(java.util.Objects::nonNull)
                .max(Comparator.naturalOrder())
                .orElse(null);

        InfraDto.FrontendNodesView frontendNodes = frontendNodes();

        return new InfraDto.StateView(properties.isEnabled(), registryConfigured, now,
                new InfraDto.SourceView(registryConfigured, registryOk, lastCheck),
                new InfraDto.SummaryView(services.size(), up, down, degraded, unknown, noAccess),
                services, frontendNodes);
    }

    private InfraDto.FrontendNodesView frontendNodes() {
        InfraProperties.Tailscale tailscale = properties.getTailscale();
        boolean configured = tailscale.isEnabled()
                && tailscale.getApiKey() != null && !tailscale.getApiKey().isBlank()
                && tailscale.getTailnet() != null && !tailscale.getTailnet().isBlank();
        // The Tailscale listing contract (device fields, tag semantics) is not
        // resolved here, so it is reported as pending rather than simulated.
        return InfraDto.FrontendNodesView.unavailable(configured, configured ? "pending" : "unavailable");
    }

    private String sanitizeReason(String reason) {
        if (reason == null || reason.isBlank()) return null;
        return SAFE_REASONS.contains(reason) ? reason : "unavailable";
    }
}
