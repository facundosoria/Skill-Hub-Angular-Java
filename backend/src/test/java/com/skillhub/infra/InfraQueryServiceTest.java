package com.skillhub.infra;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Vista de infraestructura armada solo desde lo persistido: conteos por
 * estado, motivos saneados, disponibilidad y estado de los nodos frontend.
 */
class InfraQueryServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-25T10:00:00Z");

    private InfraProperties properties;
    private InfraRepository repository;
    private InfraQueryService service;

    @BeforeEach
    void setUp() {
        properties = new InfraProperties();
        List<InfraProperties.ServiceDefinition> catalogue = new ArrayList<>();
        String[] names = {"up", "down", "degraded", "noaccess", "unknown", "missing"};
        for (int i = 0; i < names.length; i++) {
            InfraProperties.ServiceDefinition def = new InfraProperties.ServiceDefinition();
            def.setName(names[i]);
            def.setSortOrder(names.length - i);
            catalogue.add(def);
        }
        InfraProperties.ServiceDefinition blank = new InfraProperties.ServiceDefinition();
        blank.setName(" ");
        InfraProperties.ServiceDefinition unnamed = new InfraProperties.ServiceDefinition();
        catalogue.addAll(Arrays.asList(blank, unnamed, null));
        properties.setCatalogue(catalogue);
        repository = mock(InfraRepository.class);
        service = new InfraQueryService(properties, repository, new AvailabilityCalculator(Duration.ofSeconds(90)),
                Clock.fixed(NOW, ZoneOffset.UTC));
        when(repository.loadStates()).thenReturn(Map.of(
                "up", state("up", InfraState.UP, "latency_degraded", true, NOW.minusSeconds(30)),
                "down", state("down", InfraState.DOWN, "SQLException: secreto", false, NOW.minusSeconds(10)),
                "degraded", state("degraded", InfraState.DEGRADED, " ", false, null),
                "noaccess", state("noaccess", InfraState.NO_ACCESS, null, false, null),
                "unknown", state("unknown", null, "actuator_down", false, null)));
    }

    private static InfraRepository.ServiceStateRecord state(String name, InfraState state, String reason, boolean sourceOk, Instant check) {
        return new InfraRepository.ServiceStateRecord(name, state, reason, NOW, NOW, NOW, NOW, 0, 1, sourceOk, check,
                "full", 2, 3600L, 12);
    }

    private InfraDto.ServiceView view(InfraDto.StateView state, String name) {
        return state.services().stream().filter(s -> s.name().equals(name)).findFirst().orElseThrow();
    }

    @Test
    void countsEveryStateAndSortsTheCatalogue() {
        var state = service.current();

        assertThat(state.services()).extracting(InfraDto.ServiceView::name)
                .containsExactly("missing", "unknown", "noaccess", "degraded", "down", "up");
        assertThat(state.summary()).isEqualTo(new InfraDto.SummaryView(6, 1, 1, 1, 2, 1));
    }

    @Test
    void sanitizesReasonsAndFillsMissingServicesWithNulls() {
        var state = service.current();

        assertThat(view(state, "up").reason()).isEqualTo("latency_degraded");
        assertThat(view(state, "down").reason()).isEqualTo("unavailable");
        assertThat(view(state, "degraded").reason()).isNull();
        assertThat(view(state, "noaccess").reason()).isNull();
        InfraDto.ServiceView missing = view(state, "missing");
        assertThat(missing.state()).isEqualTo("UNKNOWN");
        assertThat(missing.instances()).isZero();
        assertThat(missing.coverage()).isNull();
        assertThat(missing.lastHealthyAt()).isNull();
    }

    @Test
    void reportsRegistrySourceAndLatestCheck() {
        properties.setEurekaUrl("http://eureka:8761/eureka");

        var state = service.current();

        assertThat(state.source().registryConfigured()).isTrue();
        assertThat(state.source().registryOk()).isTrue();
        assertThat(state.source().lastCheckAt()).isEqualTo(NOW.minusSeconds(10));
    }

    @Test
    void anEmptyOrBlankRegistryUrlIsNotConfigured() {
        properties.setEurekaUrl(" ");
        assertThat(service.current().source().registryConfigured()).isFalse();
        properties.setEurekaUrl(null);
        assertThat(service.current().configured()).isFalse();
    }

    @Test
    void computesAvailabilityOnlyWhenEnabled() {
        var disabled = service.current();
        assertThat(view(disabled, "up").availability24h()).isNull();
        verify(repository, never()).loadServiceSamples(any(), any());

        properties.setEnabled(true);
        when(repository.loadServiceSamples(any(), any())).thenReturn(List.of(
                new AvailabilitySample("up", NOW.minusSeconds(120), InfraState.UP),
                new AvailabilitySample("up", NOW.minusSeconds(60), InfraState.UP),
                new AvailabilitySample("down", NOW.minusSeconds(60), InfraState.DOWN)));

        var enabled = service.current();
        assertThat(view(enabled, "up").availability24h()).isNotNull();
        assertThat(view(enabled, "up").availability7d()).isNotNull();
        assertThat(enabled.enabled()).isTrue();
    }

    @Test
    void frontendNodesArePendingOnlyWhenTailscaleIsFullyConfigured() {
        assertThat(service.current().frontendNodes().status()).isEqualTo("unavailable");

        InfraProperties.Tailscale tailscale = properties.getTailscale();
        tailscale.setEnabled(true);
        assertThat(service.current().frontendNodes().status()).isEqualTo("unavailable");
        tailscale.setApiKey("key");
        tailscale.setTailnet(" ");
        assertThat(service.current().frontendNodes().status()).isEqualTo("unavailable");
        tailscale.setTailnet(null);
        assertThat(service.current().frontendNodes().status()).isEqualTo("unavailable");
        tailscale.setApiKey(" ");
        tailscale.setTailnet("tailnet");
        assertThat(service.current().frontendNodes().status()).isEqualTo("unavailable");
        tailscale.setApiKey(null);
        assertThat(service.current().frontendNodes().status()).isEqualTo("unavailable");

        tailscale.setApiKey("key");
        var nodes = service.current().frontendNodes();
        assertThat(nodes.status()).isEqualTo("pending");
        assertThat(nodes.enabled()).isTrue();
        assertThat(nodes.available()).isFalse();
    }

    @Test
    void noStatesMeansNoRegistryCheck() {
        when(repository.loadStates()).thenReturn(Map.of());

        var state = service.current();

        assertThat(state.source().registryOk()).isFalse();
        assertThat(state.source().lastCheckAt()).isNull();
        assertThat(state.summary().unknown()).isEqualTo(6);
    }
}
