package com.skillhub.infra;

/** Status reported by the registry (Eureka) for one instance, kept apart from the process state. */
public enum RegistryState {
    UP,
    DOWN,
    OUT_OF_SERVICE,
    UNKNOWN,
    ABSENT;

    public static RegistryState fromEureka(String status) {
        if (status == null || status.isBlank()) return UNKNOWN;
        return switch (status.trim().toUpperCase()) {
            case "UP" -> UP;
            case "DOWN" -> DOWN;
            case "OUT_OF_SERVICE" -> OUT_OF_SERVICE;
            default -> UNKNOWN;
        };
    }

    /** Positive evidence that the process is not serving. */
    public boolean isFailureEvidence() {
        return this == DOWN || this == OUT_OF_SERVICE;
    }
}
