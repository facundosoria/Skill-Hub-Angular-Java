package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;
import java.util.ArrayList;

/**
 * Cliente del API admin de Hydra (http://hydra:4445/admin/...). Nunca
 * expuesto a internet - solo backend le habla, por la red interna de docker.
 */
@Component
public class HydraAdminClient {

    private final RestClient rest;

    public HydraAdminClient(@Value("${app.hydra.admin-url}") String adminUrl) {
        this.rest = RestClient.builder().baseUrl(adminUrl).build();
    }

    /** Acepta un login_challenge con el userId de Skill Hub como subject. Devuelve el redirect_to de Hydra. */
    public String acceptLogin(String loginChallenge, String userId) {
        JsonNode body = rest.put()
                .uri("/admin/oauth2/auth/requests/login/accept?login_challenge={c}", loginChallenge)
                .body(Map.of("subject", userId, "remember", true, "remember_for", 2592000))
                .retrieve()
                .body(JsonNode.class);
        return body != null ? body.path("redirect_to").asText() : null;
    }

    /** Devuelve el pedido de consentimiento real guardado por Hydra. */
    public JsonNode getConsentRequest(String consentChallenge) {
        return rest.get()
                .uri("/admin/oauth2/auth/requests/consent?consent_challenge={c}", consentChallenge)
                .retrieve()
                .body(JsonNode.class);
    }

    /** Acepta el consentimiento usando los scopes que Hydra devolvio para el challenge. */
    public String acceptConsent(String consentChallenge) {
        JsonNode request = getConsentRequest(consentChallenge);
        List<String> requestedScopes = requestedScopes(request);
        JsonNode body = rest.put()
                .uri("/admin/oauth2/auth/requests/consent/accept?consent_challenge={c}", consentChallenge)
                .body(Map.of("grant_scope", requestedScopes, "remember", true, "remember_for", 2592000))
                .retrieve()
                .body(JsonNode.class);
        return body != null ? body.path("redirect_to").asText() : null;
    }

    private List<String> requestedScopes(JsonNode request) {
        if (request == null || !request.path("requested_scope").isArray()) return List.of();
        List<String> scopes = new ArrayList<>();
        request.path("requested_scope").forEach(scope -> {
            if (scope.isTextual() && !scope.asText().isBlank()) scopes.add(scope.asText());
        });
        return scopes;
    }

    /** Rechaza el consentimiento y devuelve al cliente OAuth con access_denied. */
    public String rejectConsent(String consentChallenge) {
        JsonNode body = rest.put()
                .uri("/admin/oauth2/auth/requests/consent/reject?consent_challenge={c}", consentChallenge)
                .body(Map.of(
                        "error", "access_denied",
                        "error_description", "El usuario rechazo el acceso a Skill Hub"))
                .retrieve()
                .body(JsonNode.class);
        return body != null ? body.path("redirect_to").asText() : null;
    }
}
