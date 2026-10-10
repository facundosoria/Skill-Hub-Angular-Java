package com.skillhub.infra;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;

/**
 * Computes availability from service-level observation samples.
 *
 * Only intervals between consecutive samples that are within the configured
 * grace count as observed time. Anything larger is a gap (restart, outage) and
 * contributes zero, which is what prevents an old UP from being extended across
 * an unobserved outage after a restart.
 */
public class AvailabilityCalculator {

    private final Duration grace;

    public AvailabilityCalculator(Duration grace) {
        this.grace = grace;
    }

    public Availability compute(List<AvailabilitySample> samples, Instant windowStart,
                                Instant windowEnd, Instant now) {
        long windowSeconds = Math.max(0, windowEnd.getEpochSecond() - windowStart.getEpochSecond());
        if (samples == null || samples.isEmpty() || windowSeconds <= 0) {
            return new Availability(null, null, null, windowSeconds, null, null, false);
        }
        List<AvailabilitySample> ordered = samples.stream()
                .filter(s -> s != null && s.observedAt() != null)
                .sorted(Comparator.comparing(AvailabilitySample::observedAt))
                .toList();
        if (ordered.isEmpty()) {
            return new Availability(null, null, null, windowSeconds, null, null, false);
        }
        long graceSeconds = Math.max(1, grace.getSeconds());
        Instant effectiveEnd = now.isBefore(windowEnd) ? now : windowEnd;

        long observed = 0;
        long available = 0;
        long degraded = 0;

        for (int i = 0; i < ordered.size(); i++) {
            AvailabilitySample sample = ordered.get(i);
            Instant next = i + 1 < ordered.size() ? ordered.get(i + 1).observedAt() : effectiveEnd;
            if (next == null) continue;
            long rawGap = next.getEpochSecond() - sample.observedAt().getEpochSecond();
            if (rawGap <= 0 || rawGap > graceSeconds) continue; // gap or no time elapsed
            long lo = Math.max(sample.observedAt().getEpochSecond(), windowStart.getEpochSecond());
            long hi = Math.min(next.getEpochSecond(), effectiveEnd.getEpochSecond());
            if (hi <= lo) continue;
            long span = hi - lo;
            observed += span;
            if (sample.available()) available += span;
            if (sample.state() == InfraState.DEGRADED) degraded += span;
        }

        if (observed == 0) {
            return new Availability(0L, 0L, 0L, windowSeconds, null, null, false);
        }
        Double availabilityRatio = (double) available / (double) observed;
        Double coverage = (double) observed / (double) windowSeconds;
        long unobserved = Math.max(0, windowSeconds - observed);
        return new Availability(observed, available, degraded, unobserved,
                availabilityRatio, coverage, true);
    }
}
