package com.skillhub.infra.model;

import java.time.Instant;

public record InfraOverviewDto(
        int totalServices,
        int ok,
        int down,
        int degraded,
        int noData,
        int noAccess,
        String source,
        Instant lastUpdated
) {}
