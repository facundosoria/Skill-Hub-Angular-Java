package com.skillhub.infra.model;

import java.time.Instant;

public record ServiceStatusDto(
        String serviceId,
        String name,
        String team,
        Integer port,
        String status,
        String reason,
        String node,
        Long uptimeSeconds,
        String uptimeFormatted,
        Instant lastHeartbeatAt,
        String lastSeenRelative,
        String version,
        Double availability24h,
        Double degraded24h,
        Double availability7d,
        Double degraded7d
) {}
