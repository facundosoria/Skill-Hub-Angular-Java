package com.skillhub.infra;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Runs the observation cycle on a dedicated single-thread scheduler and probes
 * instances on a separate bounded executor. No network call happens at startup:
 * the first cycle is scheduled one interval after the application is up, and
 * only when the feature is enabled. Each service and instance is handled in
 * isolation, so one failing source cannot take down the cycle or the rest of
 * the application.
 */
@Component
public class InfraMonitor {

    private static final Logger log = LoggerFactory.getLogger(InfraMonitor.class);

    private final InfraProperties properties;
    private final InfraRepository repository;
    private final EurekaRegistryClient registry;
    private final ActuatorProbe probe;
    private final StateMachine stateMachine;
    private final Clock clock;
    private final ExecutorService probeExecutor;

    private ScheduledExecutorService cycleExecutor;
    private volatile Instant lastPurge;
    private final Object cycleLock = new Object();

    public InfraMonitor(InfraProperties properties, InfraRepository repository,
                        EurekaRegistryClient registry, ActuatorProbe probe, StateMachine stateMachine,
                        Clock clock, @Qualifier("infraProbeExecutor") ExecutorService probeExecutor) {
        this.properties = properties;
        this.repository = repository;
        this.registry = registry;
        this.probe = probe;
        this.stateMachine = stateMachine;
        this.clock = clock;
        this.probeExecutor = probeExecutor;
    }

    @PostConstruct
    public void start() {
        if (!properties.isEnabled()) return;
        long intervalMs = Math.max(1_000L, properties.getInterval().toMillis());
        cycleExecutor = Executors.newSingleThreadScheduledExecutor(daemonFactory("skillhub-infra-scheduler"));
        // Schedule (not run) the first cycle: no network calls at startup and no
        // dependency reachability required for the app to come up.
        cycleExecutor.scheduleWithFixedDelay(this::safeCycle, intervalMs, intervalMs, TimeUnit.MILLISECONDS);
        log.info("[infra] monitor enabled; probing every {}ms", intervalMs);
    }

    @PreDestroy
    public void stop() {
        if (cycleExecutor != null) cycleExecutor.shutdownNow();
    }

    private void safeCycle() {
        try {
            runCycleOnce(clock.instant());
        } catch (RuntimeException e) {
            log.warn("[infra] cycle failed: {}", e.getMessage());
        }
    }

    /** Runs exactly one observation cycle synchronously (used by tests too). */
    public void runCycleOnce(Instant now) {
        synchronized (cycleLock) {
            doCycle(now == null ? clock.instant() : now);
        }
    }

    private void doCycle(Instant now) {
        List<InfraProperties.ServiceDefinition> catalogue = sortedCatalogue();
        repository.ensureCatalogue(catalogue);
        RegistrySnapshot snapshot = registry.fetch(now);
        Map<String, InfraRepository.ServiceStateRecord> previous = repository.loadStates();
        Map<String, List<ActuatorProbe.Outcome>> outcomes = probeInstances(catalogue, snapshot);

        List<InfraRepository.ObservationRecord> observations = new ArrayList<>();
        List<InfraRepository.TransitionRecord> transitions = new ArrayList<>();

        for (InfraProperties.ServiceDefinition def : catalogue) {
            ServiceAssessment assessment = assess(def, snapshot, outcomes.get(def.getName()), now);
            InfraRepository.ServiceStateRecord prev = previous.get(def.getName());
            StateMachine.Previous previousInput = prev == null ? null
                    : new StateMachine.Previous(prev.state(), prev.consecutiveFailures(), prev.consecutiveSuccesses());
            StateMachine.Decision decision = stateMachine.decide(assessment.rawState(), previousInput);

            InfraRepository.ServiceStateRecord row = buildState(def.getName(), assessment, decision, prev, now, snapshot.sourceOk());
            repository.saveState(row);
            if (prev == null || prev.state() != decision.state()) {
                transitions.add(new InfraRepository.TransitionRecord(def.getName(),
                        prev == null ? null : prev.state(), decision.state(), assessment.reason(), now));
            }
            // A failed registry source is a gap: we do not pretend we observed
            // the service, so availability treats the interval as unobserved.
            if (snapshot.sourceOk()) {
                observations.add(serviceObservation(def.getName(), assessment, decision.state(), now));
            }
        }

        repository.insertObservations(observations);
        for (InfraRepository.TransitionRecord transition : transitions) repository.insertTransition(transition);
        purge(now);
    }

    private List<InfraProperties.ServiceDefinition> sortedCatalogue() {
        List<InfraProperties.ServiceDefinition> catalogue = new ArrayList<>(properties.getCatalogue());
        catalogue.removeIf(def -> def == null || def.getName() == null || def.getName().isBlank());
        catalogue.sort(Comparator.comparingInt(InfraProperties.ServiceDefinition::getSortOrder));
        return catalogue;
    }

    private Map<String, List<ActuatorProbe.Outcome>> probeInstances(
            List<InfraProperties.ServiceDefinition> catalogue, RegistrySnapshot snapshot) {
        Map<String, List<ActuatorProbe.Outcome>> result = new HashMap<>();
        if (!snapshot.sourceOk()) return result;

        List<Callable<ProbeTask>> tasks = new ArrayList<>();
        for (InfraProperties.ServiceDefinition def : catalogue) {
            for (ServiceInstance instance : snapshot.instancesFor(def.getEurekaApp())) {
                tasks.add(() -> new ProbeTask(def.getName(), safeProbe(instance, def.getManagementPort())));
            }
        }
        if (tasks.isEmpty()) return result;

        long timeoutMs = properties.getConnectTimeout().toMillis() + properties.getReadTimeout().toMillis() + 1_000L;
        List<Future<ProbeTask>> futures;
        try {
            futures = probeExecutor.invokeAll(tasks, timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return result;
        }
        for (Future<ProbeTask> future : futures) {
            try {
                ProbeTask task = future.get(0, TimeUnit.MILLISECONDS);
                result.computeIfAbsent(task.service(), k -> new ArrayList<>()).add(task.outcome());
            } catch (ExecutionException e) {
                log.debug("[infra] probe task failed: {}", e.getMessage());
            } catch (TimeoutException e) {
                future.cancel(true);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return result;
            }
        }
        return result;
    }

    private ActuatorProbe.Outcome safeProbe(ServiceInstance instance, Integer configuredManagementPort) {
        try {
            return probe.probe(instance, configuredManagementPort);
        } catch (RuntimeException e) {
            return new ActuatorProbe.Outcome(InfraState.DEGRADED, "probe_error",
                    ActuatorProbe.COVERAGE_UNAVAILABLE, null, null);
        }
    }

    private record ProbeTask(String service, ActuatorProbe.Outcome outcome) {
    }

    private record ServiceAssessment(
            InfraState rawState,
            String reason,
            String coverage,
            int instances,
            RegistryState registryState,
            Long uptimeSeconds,
            Integer latencyMs,
            Instant leaseAt) {
    }

    private ServiceAssessment assess(InfraProperties.ServiceDefinition def, RegistrySnapshot snapshot,
                                     List<ActuatorProbe.Outcome> outcomes, Instant now) {
        if (!snapshot.sourceOk()) {
            return new ServiceAssessment(InfraState.UNKNOWN, snapshot.error(),
                    ActuatorProbe.COVERAGE_UNAVAILABLE, 0, RegistryState.UNKNOWN, null, null, null);
        }
        List<ServiceInstance> instances = snapshot.instancesFor(def.getEurekaApp());
        if (instances.isEmpty()) {
            return new ServiceAssessment(InfraState.UNKNOWN, "absent_from_registry",
                    ActuatorProbe.COVERAGE_UNAVAILABLE, 0, RegistryState.ABSENT, null, null, null);
        }

        boolean registryUpLease = instances.stream().anyMatch(i -> i.registryState() == RegistryState.UP);
        RegistryState aggregateRegistry = registryUpLease ? RegistryState.UP
                : (instances.stream().anyMatch(i -> i.registryState().isFailureEvidence())
                        ? RegistryState.DOWN : RegistryState.UNKNOWN);

        InfraState raw;
        String reason;
        Long uptime = null;
        Integer latency = null;
        String coverage;

        if (outcomes == null || outcomes.isEmpty()) {
            // Registered but nothing probed (e.g. allowlist gap): report limited
            // coverage rather than a fabricated state.
            raw = registryUpLease ? InfraState.DEGRADED : InfraState.UNKNOWN;
            reason = "coverage_unavailable";
            coverage = ActuatorProbe.COVERAGE_UNAVAILABLE;
        } else {
            raw = aggregate(outcomes, instances);
            reason = firstReason(outcomes);
            for (ActuatorProbe.Outcome outcome : outcomes) {
                if (outcome.uptimeSeconds() != null && (uptime == null || outcome.uptimeSeconds() > uptime)) {
                    uptime = outcome.uptimeSeconds();
                }
                if (outcome.latencyMs() != null && (latency == null || outcome.latencyMs() > latency)) {
                    latency = outcome.latencyMs();
                }
            }
            coverage = aggregateCoverage(outcomes, raw);
        }

        Instant leaseAt = registryUpLease ? now : null;
        return new ServiceAssessment(raw, reason, coverage, instances.size(), aggregateRegistry,
                uptime, latency, leaseAt);
    }

    /**
     * Instance outcomes map to a service state with a clear priority. A registry
     * NO_ACCESS target is never reported as DOWN unless the registry itself
     * carries failure evidence.
     */
    private InfraState aggregate(List<ActuatorProbe.Outcome> outcomes, List<ServiceInstance> instances) {
        boolean anyUp = false;
        boolean anyDegraded = false;
        boolean anyDown = false;
        boolean anyNoAccess = false;
        for (int i = 0; i < outcomes.size(); i++) {
            ActuatorProbe.Outcome outcome = outcomes.get(i);
            ServiceInstance instance = i < instances.size() ? instances.get(i) : null;
            switch (outcome.state()) {
                case UP -> anyUp = true;
                case DEGRADED -> anyDegraded = true;
                case DOWN -> anyDown = true;
                case NO_ACCESS -> {
                    if (instance != null && instance.registryState().isFailureEvidence()) anyDown = true;
                    else anyDegraded = true;
                }
                case UNKNOWN -> anyNoAccess = true;
            }
        }
        if (anyUp) return InfraState.UP;
        if (anyDegraded) return InfraState.DEGRADED;
        if (anyDown) return InfraState.DOWN;
        if (anyNoAccess) return InfraState.UNKNOWN;
        return InfraState.UNKNOWN;
    }

    private String firstReason(List<ActuatorProbe.Outcome> outcomes) {
        for (ActuatorProbe.Outcome outcome : outcomes) {
            if (outcome.reason() != null && !outcome.reason().isBlank()) return outcome.reason();
        }
        return null;
    }

    private String aggregateCoverage(List<ActuatorProbe.Outcome> outcomes, InfraState raw) {
        if (raw == InfraState.UNKNOWN) return ActuatorProbe.COVERAGE_UNAVAILABLE;
        boolean anyFull = outcomes.stream().anyMatch(o -> ActuatorProbe.COVERAGE_FULL.equals(o.coverage()));
        boolean anyUnavailable = outcomes.stream().allMatch(o -> ActuatorProbe.COVERAGE_UNAVAILABLE.equals(o.coverage()));
        if (anyUnavailable) return ActuatorProbe.COVERAGE_UNAVAILABLE;
        if (anyFull) return ActuatorProbe.COVERAGE_FULL;
        return ActuatorProbe.COVERAGE_PARTIAL;
    }

    private InfraRepository.ServiceStateRecord buildState(String serviceName, ServiceAssessment assessment,
                                                          StateMachine.Decision decision,
                                                          InfraRepository.ServiceStateRecord prev,
                                                          Instant now, boolean sourceOk) {
        Instant lastObservedAt = sourceOk ? now : (prev == null ? null : prev.lastObservedAt());
        // lastHealthyAt tracks the last time the service was actually observed
        // UP, independent of the hysteresis that may still be withholding a
        // state change. A DOWN observation must never advance it.
        Instant lastHealthyAt = assessment.rawState() == InfraState.UP ? now
                : (prev == null ? null : prev.lastHealthyAt());
        Instant leaseAt = assessment.leaseAt() != null ? assessment.leaseAt()
                : (prev == null ? null : prev.lastRegistryLeaseAt());
        Instant observedSince = prev == null ? null : prev.observedSince();
        if (sourceOk && (observedSince == null
                || (prev != null && prev.state() == InfraState.UNKNOWN && decision.state() != InfraState.UNKNOWN))) {
            observedSince = now;
        }
        return new InfraRepository.ServiceStateRecord(serviceName, decision.state(), assessment.reason(),
                lastObservedAt, lastHealthyAt, leaseAt, observedSince,
                decision.failures(), decision.successes(), sourceOk, now,
                assessment.coverage(), assessment.instances(),
                assessment.uptimeSeconds(), assessment.latencyMs());
    }

    private InfraRepository.ObservationRecord serviceObservation(String serviceName, ServiceAssessment assessment,
                                                                 InfraState observedState, Instant now) {
        return new InfraRepository.ObservationRecord(serviceName, InfraRepository.SERVICE_LEVEL_INSTANCE, now,
                observedState, observedState.available(), assessment.registryState(), true,
                "eureka+actuator", assessment.uptimeSeconds(), assessment.latencyMs(),
                assessment.coverage(), assessment.reason());
    }

    private void purge(Instant now) {
        Duration retention = Duration.ofDays(Math.max(1, properties.getRetentionDays()));
        if (lastPurge != null && now.isBefore(lastPurge.plus(Duration.ofHours(1)))) return;
        lastPurge = now;
        Instant cutoff = now.minus(retention);
        try {
            int observations = repository.purgeObservationsBefore(cutoff);
            int transitions = repository.purgeTransitionsBefore(cutoff);
            if (observations > 0 || transitions > 0) {
                log.info("[infra] retention purge removed {} observations and {} transitions", observations, transitions);
            }
        } catch (RuntimeException e) {
            log.warn("[infra] retention purge failed: {}", e.getMessage());
        }
    }

    private static ThreadFactory daemonFactory(String prefix) {
        AtomicInteger counter = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, prefix + "-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }
}
