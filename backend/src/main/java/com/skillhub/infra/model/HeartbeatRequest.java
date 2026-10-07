package com.skillhub.infra.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.Map;

public record HeartbeatRequest(
        @NotBlank String serviceId,
        @NotBlank String node,
        @NotBlank String status,
        @NotNull Long uptimeSeconds,
        Instant startedAt,
        String version,
        Map<String, Object> details
) {}
