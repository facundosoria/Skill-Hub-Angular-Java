package com.skillhub.infra;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AvailabilityCalculatorTest {

    private static final Instant T0 = Instant.parse("2026-10-06T00:00:00Z");
    private final AvailabilityCalculator calculator = new AvailabilityCalculator(Duration.ofSeconds(90));

    private AvailabilitySample sample(long seconds, InfraState state) {
        return new AvailabilitySample("svc", T0.plusSeconds(seconds), state);
    }

    @Test
    void noHistoryReportsNoDataInsteadOfOneHundredPercent() {
        Availability availability = calculator.compute(List.of(), T0.minusSeconds(3600), T0, T0);
        assertThat(availability.hasData()).isFalse();
        assertThat(availability.availability()).isNull();
        assertThat(availability.coverage()).isNull();
    }

    @Test
    void allHealthyWithinGraceIsFullyAvailable() {
        List<AvailabilitySample> samples = List.of(
                sample(0, InfraState.UP),
                sample(30, InfraState.UP),
                sample(60, InfraState.UP));
        Availability availability = calculator.compute(samples, T0, T0.plusSeconds(90), T0.plusSeconds(90));
        assertThat(availability.hasData()).isTrue();
        assertThat(availability.observedSeconds()).isEqualTo(90L);
        assertThat(availability.availableSeconds()).isEqualTo(90L);
        assertThat(availability.availability()).isEqualTo(1.0);
        assertThat(availability.coverage()).isEqualTo(1.0);
    }

    @Test
    void gapBeyondGraceIsUnobservedAndDoesNotExtendOldUp() {
        // UP at T0, then a long outage/restart, then UP again much later:
        // the gap must not be counted as available or observed.
        List<AvailabilitySample> samples = List.of(
                sample(0, InfraState.UP),
                sample(4000, InfraState.UP));
        Instant end = T0.plusSeconds(4030);
        Availability availability = calculator.compute(samples, T0, end, end);
        assertThat(availability.hasData()).isTrue();
        // Only the last in-grace interval counts (30s), never the 4000s gap.
        assertThat(availability.observedSeconds()).isEqualTo(30L);
        assertThat(availability.availableSeconds()).isEqualTo(30L);
        assertThat(availability.coverage()).isLessThan(0.01);
    }

    @Test
    void downTimeCountsAsObservedButNotAvailable() {
        List<AvailabilitySample> samples = List.of(
                sample(0, InfraState.UP),
                sample(30, InfraState.DOWN),
                sample(60, InfraState.UP));
        Availability availability = calculator.compute(samples, T0, T0.plusSeconds(90), T0.plusSeconds(90));
        assertThat(availability.observedSeconds()).isEqualTo(90L);
        assertThat(availability.availableSeconds()).isEqualTo(60L);
        assertThat(availability.availability()).isEqualTo(2.0 / 3.0);
    }

    @Test
    void degradedTimeCountsAsAvailableButIsReportedSeparately() {
        List<AvailabilitySample> samples = List.of(
                sample(0, InfraState.DEGRADED),
                sample(30, InfraState.UP),
                sample(60, InfraState.UP));
        Availability availability = calculator.compute(samples, T0, T0.plusSeconds(90), T0.plusSeconds(90));
        assertThat(availability.availableSeconds()).isEqualTo(90L);
        assertThat(availability.degradedSeconds()).isEqualTo(30L);
    }

    @Test
    void partialCoverageIsExposed() {
        List<AvailabilitySample> samples = List.of(
                sample(0, InfraState.UP),
                sample(30, InfraState.UP));
        Availability availability = calculator.compute(samples, T0, T0.plusSeconds(3600), T0.plusSeconds(3600));
        assertThat(availability.coverage()).isLessThan(0.1);
        assertThat(availability.availability()).isEqualTo(1.0);
    }
}
