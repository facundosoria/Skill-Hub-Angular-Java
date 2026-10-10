package com.skillhub.infra;

/**
 * Observed state of a service (or one of its instances) as this monitor can
 * honestly assert it.
 *
 * <ul>
 *   <li>UP: registry reports the instance as UP and the actuator health probe
 *       succeeds within the configured latency.</li>
 *   <li>DOWN: there is positive evidence of a process problem: the registry
 *       reports DOWN/OUT_OF_SERVICE, or the actuator health endpoint answers
 *       with a non-UP status.</li>
 *   <li>DEGRADED: the registry says UP but the actuator is slow, unreachable or
 *       returns limited coverage. The process may still be serving, so this is
 *       not reported as DOWN without evidence.</li>
 *   <li>UNKNOWN: known absence in a successful registry response, or the
 *       registry source itself failed. Never invented as past downtime.</li>
 *   <li>NO_ACCESS: the service was found but its probe destination is not
 *       approved by the allowlist or lacks management metadata.</li>
 * </ul>
 */
public enum InfraState {
    UP,
    DOWN,
    DEGRADED,
    UNKNOWN,
    NO_ACCESS;

    /** Counts towards availability: the service is serving (UP or DEGRADED). */
    public boolean available() {
        return this == UP || this == DEGRADED;
    }
}
