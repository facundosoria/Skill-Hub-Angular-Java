package com.skillhub.infra;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Ciclo de observacion con registro, sonda y repositorio simulados: agregado
 * de instancias, cobertura, huecos del registro y purga de retencion.
 */
class InfraMonitorTest {

    private static final Instant NOW = Instant.parse("2026-10-25T10:00:00Z");

    private InfraProperties properties;
    private InfraRepository repository;
    private EurekaRegistryClient registry;
    private ActuatorProbe probe;
    private ExecutorService executor;
    private InfraMonitor monitor;
    private final Map<String, InfraRepository.ServiceStateRecord> stored = new HashMap<>();

    @BeforeEach
    void setUp() {
        properties = new InfraProperties();
        InfraProperties.ServiceDefinition users = new InfraProperties.ServiceDefinition();
        users.setName("users");
        users.setEurekaApp("USERS");
        users.setSortOrder(2);
        InfraProperties.ServiceDefinition llm = new InfraProperties.ServiceDefinition();
        llm.setName("llm");
        llm.setEurekaApp("LLM");
        llm.setManagementPort(9090);
        llm.setSortOrder(1);
        InfraProperties.ServiceDefinition unnamed = new InfraProperties.ServiceDefinition();
        unnamed.setName(" ");
        properties.setCatalogue(new ArrayList<>(Arrays.asList(users, llm, unnamed, null)));
        properties.setRetentionDays(30);
        repository = mock(InfraRepository.class);
        registry = mock(EurekaRegistryClient.class);
        probe = mock(ActuatorProbe.class);
        executor = Executors.newFixedThreadPool(2);
        when(repository.loadStates()).thenAnswer(call -> new HashMap<>(stored));
        org.mockito.Mockito.doAnswer(call -> {
            InfraRepository.ServiceStateRecord row = call.getArgument(0);
            stored.put(row.serviceName(), row);
            return null;
        }).when(repository).saveState(any());
        monitor = new InfraMonitor(properties, repository, registry, probe, new StateMachine(properties),
                Clock.fixed(NOW, ZoneOffset.UTC), executor);
    }

    @AfterEach
    void tearDown() {
        monitor.stop();
        executor.shutdownNow();
    }

    private static ServiceInstance instance(String app, RegistryState state) {
        return new ServiceInstance(app + "-1", app, "host", "100.64.0.1", 8080, null, null, state, Map.of());
    }

    private void registry(Map<String, List<ServiceInstance>> apps) {
        when(registry.fetch(any())).thenReturn(new RegistrySnapshot(true, null, NOW, apps));
    }

    private static ActuatorProbe.Outcome outcome(InfraState state, String coverage, Long uptime, Integer latency) {
        return new ActuatorProbe.Outcome(state, state == InfraState.UP ? null : "motivo", coverage, uptime, latency);
    }

    private List<InfraRepository.ObservationRecord> observations() {
        @SuppressWarnings("unchecked") ArgumentCaptor<List<InfraRepository.ObservationRecord>> captor = ArgumentCaptor.forClass(List.class);
        verify(repository, atLeastOnce()).insertObservations(captor.capture());
        return captor.getValue();
    }

    @Test
    void observesServicesInCatalogueOrderAndRecordsFirstTransitions() {
        registry(Map.of("USERS", List.of(instance("USERS", RegistryState.UP)), "LLM", List.of(instance("LLM", RegistryState.UP))));
        when(probe.probe(any(), any())).thenReturn(outcome(InfraState.UP, ActuatorProbe.COVERAGE_FULL, 120L, 15));

        monitor.runCycleOnce(NOW);

        verify(repository).ensureCatalogue(org.mockito.ArgumentMatchers.argThat(list -> list.size() == 2 && list.get(0).getName().equals("llm")));
        assertThat(stored.get("users").uptimeSeconds()).isEqualTo(120L);
        assertThat(stored.get("users").coverage()).isEqualTo(ActuatorProbe.COVERAGE_FULL);
        assertThat(stored.get("users").lastHealthyAt()).isEqualTo(NOW);
        assertThat(stored.get("users").lastRegistryLeaseAt()).isEqualTo(NOW);
        verify(repository, times(2)).insertTransition(any());
        assertThat(observations()).hasSize(2);
    }

    @Test
    void keepsTheHighestUptimeAndLatencyAcrossInstances() {
        registry(Map.of("USERS", List.of(instance("USERS", RegistryState.UP), instance("USERS", RegistryState.UP))));
        when(probe.probe(any(), any())).thenReturn(
                outcome(InfraState.UP, ActuatorProbe.COVERAGE_PARTIAL, 50L, 30),
                outcome(InfraState.DEGRADED, ActuatorProbe.COVERAGE_PARTIAL, 200L, null));

        monitor.runCycleOnce(NOW);

        assertThat(stored.get("users").uptimeSeconds()).isEqualTo(200L);
        assertThat(stored.get("users").latencyMs()).isEqualTo(30);
        assertThat(stored.get("users").coverage()).isEqualTo(ActuatorProbe.COVERAGE_PARTIAL);
    }

    @Test
    void aFailedRegistryIsAGapWithoutObservations() {
        when(registry.fetch(any())).thenReturn(RegistrySnapshot.failed(NOW, "registry_unreachable"));

        monitor.runCycleOnce(NOW);

        assertThat(stored.get("users").state()).isEqualTo(InfraState.UNKNOWN);
        assertThat(stored.get("users").reason()).isEqualTo("registry_unreachable");
        assertThat(stored.get("users").lastObservedAt()).isNull();
        assertThat(observations()).isEmpty();
        verify(probe, never()).probe(any(), any());
    }

    @Test
    void servicesMissingFromTheRegistryAreUnknown() {
        registry(Map.of());

        monitor.runCycleOnce(NOW);

        assertThat(stored.get("users").reason()).isEqualTo("absent_from_registry");
        assertThat(observations()).extracting(InfraRepository.ObservationRecord::registryState).containsOnly(RegistryState.ABSENT);
    }

    @Test
    void registeredButUnprobedServicesReportLimitedCoverage() {
        registry(Map.of("USERS", List.of(instance("USERS", RegistryState.UP)), "LLM", List.of(instance("LLM", RegistryState.DOWN))));
        when(probe.probe(any(), any())).thenThrow(new IllegalStateException("boom"));

        monitor.runCycleOnce(NOW);

        // La sonda que falla cuenta como degradada, nunca como caida.
        assertThat(stored.get("users").reason()).isEqualTo("probe_error");
        assertThat(stored.get("llm").coverage()).isEqualTo(ActuatorProbe.COVERAGE_UNAVAILABLE);
    }

    @Test
    void noAccessIsDownOnlyWithRegistryFailureEvidence() {
        registry(Map.of("USERS", List.of(instance("USERS", RegistryState.OUT_OF_SERVICE)), "LLM", List.of(instance("LLM", RegistryState.UP))));
        when(probe.probe(any(), any())).thenReturn(outcome(InfraState.NO_ACCESS, ActuatorProbe.COVERAGE_UNAVAILABLE, null, null));

        monitor.runCycleOnce(NOW);
        monitor.runCycleOnce(NOW.plusSeconds(30));
        monitor.runCycleOnce(NOW.plusSeconds(60));

        assertThat(observations()).filteredOn(o -> o.serviceName().equals("users")).extracting(InfraRepository.ObservationRecord::state)
                .containsOnly(stored.get("users").state());
        assertThat(stored.get("llm").state()).isIn(InfraState.DEGRADED, InfraState.UNKNOWN);
    }

    @Test
    void downAndUnknownOutcomesAggregateWithPriority() {
        registry(Map.of("USERS", List.of(instance("USERS", RegistryState.UNKNOWN)), "LLM", List.of(instance("LLM", RegistryState.UNKNOWN))));
        when(probe.probe(any(), any())).thenAnswer(call -> {
            ServiceInstance target = call.getArgument(0);
            return target.app().equals("USERS")
                    ? outcome(InfraState.DOWN, ActuatorProbe.COVERAGE_PARTIAL, null, null)
                    : outcome(InfraState.UNKNOWN, ActuatorProbe.COVERAGE_UNAVAILABLE, null, null);
        });

        monitor.runCycleOnce(NOW);

        assertThat(observations()).filteredOn(o -> o.serviceName().equals("llm"))
                .extracting(InfraRepository.ObservationRecord::coverage).containsOnly(ActuatorProbe.COVERAGE_UNAVAILABLE);
        assertThat(stored.get("users").reason()).isEqualTo("motivo");
    }

    @Test
    void keepsPreviousTimestampsWhenTheServiceIsNotHealthy() {
        Instant earlier = NOW.minusSeconds(600);
        stored.put("users", new InfraRepository.ServiceStateRecord("users", InfraState.UNKNOWN, null, earlier, earlier, earlier, earlier,
                0, 0, true, earlier, ActuatorProbe.COVERAGE_FULL, 1, null, null));
        when(registry.fetch(any())).thenReturn(RegistrySnapshot.failed(NOW, "registry_unreachable"));

        monitor.runCycleOnce(null);

        assertThat(stored.get("users").lastObservedAt()).isEqualTo(earlier);
        assertThat(stored.get("users").lastHealthyAt()).isEqualTo(earlier);
        assertThat(stored.get("users").lastRegistryLeaseAt()).isEqualTo(earlier);
        assertThat(stored.get("users").observedSince()).isEqualTo(earlier);
        verify(repository, never()).insertTransition(eq(new InfraRepository.TransitionRecord("users", InfraState.UNKNOWN, InfraState.UNKNOWN, "registry_unreachable", NOW)));
    }

    @Test
    void purgesAtMostOncePerHourAndSurvivesPurgeFailures() {
        registry(Map.of());
        when(repository.purgeObservationsBefore(any())).thenReturn(3).thenThrow(new IllegalStateException("db"));
        when(repository.purgeTransitionsBefore(any())).thenReturn(0);

        monitor.runCycleOnce(NOW);
        monitor.runCycleOnce(NOW.plusSeconds(60));
        monitor.runCycleOnce(NOW.plus(Duration.ofHours(2)));

        verify(repository, times(2)).purgeObservationsBefore(any());
        verify(repository).purgeObservationsBefore(NOW.minus(Duration.ofDays(30)));
    }

    @Test
    void startsOnlyWhenEnabledAndStopsCleanly() {
        monitor.start();
        monitor.stop();

        properties.setEnabled(true);
        properties.setInterval(Duration.ofMillis(10));
        monitor.start();
        monitor.stop();
        verify(registry, never()).fetch(any());
        verify(repository, never()).insertObservations(anyList());
    }
}
