package com.skillhub.infra.model;

import java.time.Instant;
import java.util.List;

public record FrontendNodesStatusDto(
        boolean available, String source, Instant lastSync, List<FrontendNodeDto> nodes
) {}
