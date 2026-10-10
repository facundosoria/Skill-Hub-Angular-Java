package com.skillhub.infra;

/**
 * Availability snapshot over a window.
 *
 * {@code availability} is available-seconds / observed-seconds and
 * {@code coverage} is observed-seconds / window-seconds. Both are null when
 * there is no observation history, so an unknown period is never reported as
 * 100%. DEGRADED time counts as available (the process is still serving) and is
 * also exposed separately as {@code degradedSeconds}. A gap larger than the
 * configured grace is unobserved: it counts neither as observed nor as healthy,
 * so a restart cannot extend an old UP across an outage.
 */
public record Availability(
        Long observedSeconds,
        Long availableSeconds,
        Long degradedSeconds,
        Long unobservedSeconds,
        Double availability,
        Double coverage,
        boolean hasData) {
}
