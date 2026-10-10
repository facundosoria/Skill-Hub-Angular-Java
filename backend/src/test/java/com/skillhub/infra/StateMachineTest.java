package com.skillhub.infra;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StateMachineTest {

    private StateMachine machine(int failures, int recoveries) {
        InfraProperties properties = new InfraProperties();
        properties.setFailureThreshold(failures);
        properties.setRecoveryThreshold(recoveries);
        return new StateMachine(properties);
    }

    @Test
    void withholdsDownUntilFailureThresholdReached() {
        StateMachine machine = machine(3, 2);
        StateMachine.Previous prev = new StateMachine.Previous(InfraState.UP, 0, 5);

        StateMachine.Decision first = machine.decide(InfraState.DOWN, prev);
        assertThat(first.state()).isEqualTo(InfraState.UP);
        assertThat(first.failures()).isEqualTo(1);

        StateMachine.Decision second = machine.decide(InfraState.DOWN, new StateMachine.Previous(first.state(), first.failures(), first.successes()));
        assertThat(second.state()).isEqualTo(InfraState.UP);

        StateMachine.Decision third = machine.decide(InfraState.DOWN, new StateMachine.Previous(second.state(), second.failures(), second.successes()));
        assertThat(third.state()).isEqualTo(InfraState.DOWN);
    }

    @Test
    void requiresRecoveryThresholdBeforeLeavingDown() {
        StateMachine machine = machine(3, 2);
        StateMachine.Decision first = machine.decide(InfraState.UP, new StateMachine.Previous(InfraState.DOWN, 3, 0));
        assertThat(first.state()).isEqualTo(InfraState.DOWN);

        StateMachine.Decision second = machine.decide(InfraState.UP, new StateMachine.Previous(first.state(), first.failures(), first.successes()));
        assertThat(second.state()).isEqualTo(InfraState.UP);
    }

    @Test
    void unknownAndNoAccessCommitImmediatelyAndResetCounters() {
        StateMachine machine = machine(3, 2);
        StateMachine.Decision unknown = machine.decide(InfraState.UNKNOWN, new StateMachine.Previous(InfraState.UP, 2, 0));
        assertThat(unknown.state()).isEqualTo(InfraState.UNKNOWN);
        assertThat(unknown.failures()).isZero();
        assertThat(unknown.successes()).isZero();

        StateMachine.Decision noAccess = machine.decide(InfraState.NO_ACCESS, new StateMachine.Previous(InfraState.DOWN, 3, 0));
        assertThat(noAccess.state()).isEqualTo(InfraState.NO_ACCESS);
    }

    @Test
    void firstFailureEvidenceFromUnknownIsWithheldUntilThreshold() {
        StateMachine machine = machine(3, 2);
        StateMachine.Decision decision = machine.decide(InfraState.DOWN, null);
        assertThat(decision.state()).isEqualTo(InfraState.UNKNOWN);
        assertThat(decision.failures()).isEqualTo(1);
    }
}
