package com.skillhub.infra;

import java.time.Instant;

/** One service-level sample: the committed state observed at a point in time. */
public record AvailabilitySample(String serviceName, Instant observedAt, InfraState state) {
    public boolean available() {
        return state != null && state.available();
    }
}
