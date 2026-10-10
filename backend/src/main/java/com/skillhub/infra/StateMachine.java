package com.skillhub.infra;

import org.springframework.stereotype.Component;

/**
 * Applies hysteresis to the raw observation of a service: a DOWN must persist
 * for {@code failureThreshold} consecutive cycles before it is committed, and a
 * recovery must persist for {@code recoveryThreshold} cycles. UNKNOWN and
 * NO_ACCESS are committed immediately and reset the counters: a failed source
 * or a known absence is not a failure streak and must never cascade to DOWN.
 */
@Component
public class StateMachine {

    private final InfraProperties properties;

    public StateMachine(InfraProperties properties) {
        this.properties = properties;
    }

    public record Previous(InfraState state, int failures, int successes) {
    }

    public record Decision(InfraState state, int failures, int successes) {
    }

    public Decision decide(InfraState raw, Previous previous) {
        InfraState previousState = previous == null || previous.state() == null
                ? InfraState.UNKNOWN : previous.state();
        int failures = previous == null ? 0 : Math.max(0, previous.failures());
        int successes = previous == null ? 0 : Math.max(0, previous.successes());

        if (raw == null) raw = InfraState.UNKNOWN;
        return switch (raw) {
            case UNKNOWN, NO_ACCESS -> new Decision(raw, 0, 0);
            case UP, DEGRADED -> {
                int nextSuccesses = successes + 1;
                if (previousState == InfraState.DOWN && nextSuccesses < Math.max(1, properties.getRecoveryThreshold())) {
                    yield new Decision(InfraState.DOWN, 0, nextSuccesses);
                }
                yield new Decision(raw, 0, nextSuccesses);
            }
            case DOWN -> {
                int nextFailures = failures + 1;
                if (previousState != InfraState.DOWN && nextFailures < Math.max(1, properties.getFailureThreshold())) {
                    yield new Decision(previousState, nextFailures, 0);
                }
                yield new Decision(InfraState.DOWN, nextFailures, 0);
            }
        };
    }
}
