package com.skillhub.auth;

/** Identidad detras de una API key. Equivale a ApiKeyIdentity de src/server/auth/apikey.ts. */
public record ApiKeyIdentity(
        String apiKeyId,
        String userId,
        String username,
        String team,
        String role
) {}
