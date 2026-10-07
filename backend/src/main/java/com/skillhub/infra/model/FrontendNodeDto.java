package com.skillhub.infra.model;

public record FrontendNodeDto(
        String hostname, String group, String name, boolean identityDeclared,
        String status, String lastSeenRelative, String firstSeenRelative
) {}
