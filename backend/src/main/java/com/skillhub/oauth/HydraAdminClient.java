package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.Set;

/**
 * Cliente del API admin de Hydra (http://hydra:4445/admin/...). Nunca
 * expuesto a internet - solo backend le habla, por la red interna de docker.
 */
@Component
public class HydraAdminClient {

    private static final Set<String> ALLOWED_SCOPES = Set.of("openid", "offline_access", "mcp");

    private final RestClient rest;
    private final String mcpResourceUrl;

    @Autowired
    public HydraAdminClient(@Value("${app.hydra.admin-url}") String adminUrl,
                            @Value("${app.hydra.mcp-resource-url}") String mcpResourceUrl) {
        this.rest = RestClient.builder().baseUrl(adminUrl).build();
        this.mcpResourceUrl = mcpResourceUrl;
    }

    /** Constructor kept for focused tests that replace the HTTP client in a subclass. */
    protected HydraAdminClient(String adminUrl) {
        this.rest = RestClient.builder().baseUrl(adminUrl).build();
        this.mcpResourceUrl = "";
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

    /**
     * Acepta el consentimiento con la interseccion del contrato permitido y
     * la solicitud real de Hydra. La audiencia es el recurso MCP validado por
     * HydraJwtValidator.
     */
    public String acceptConsent(String consentChallenge) {
        JsonNode request = getConsentRequest(consentChallenge);
        List<String> grantScopes = grantScopes(request);
        JsonNode body = rest.put()
                .uri("/admin/oauth2/auth/requests/consent/accept?consent_challenge={c}", consentChallenge)
                .body(Map.of(
                        "grant_scope", grantScopes,
                        "grant_access_token_audience", List.of(mcpResourceUrl),
                        "remember", true,
                        "remember_for", 2592000))
                .retrieve()
                .body(JsonNode.class);
        return body != null ? body.path("redirect_to").asText() : null;
    }

    List<String> grantScopes(JsonNode request) {
        if (request == null || !request.path("requested_scope").isArray()) return List.of();
        Set<String> scopes = new LinkedHashSet<>();
        request.path("requested_scope").forEach(scope -> {
            if (scope.isTextual() && ALLOWED_SCOPES.contains(scope.asText())) scopes.add(scope.asText());
        });
        return new ArrayList<>(scopes);
    }

    /** Rechaza un login pendiente cuando el usuario cancela el cambio obligatorio. */
    public String rejectLogin(String loginChallenge) {
        JsonNode body = rest.put()
                .uri("/admin/oauth2/auth/requests/login/reject?login_challenge={c}", loginChallenge)
                .body(Map.of(
                        "error", "access_denied",
                        "error_description", "El usuario rechazo el cambio de contrasena"))
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

    /** Devuelve el pedido de cierre de sesion real guardado por Hydra. */
    public JsonNode getLogoutRequest(String logoutChallenge) {
        return rest.get()
                .uri("/admin/oauth2/auth/requests/logout?logout_challenge={c}", logoutChallenge)
                .retrieve()
                .body(JsonNode.class);
    }

    /** Acepta el logout y devuelve el redirect_to de Hydra. */
    public String acceptLogout(String logoutChallenge) {
        JsonNode body = rest.put()
                .uri("/admin/oauth2/auth/requests/logout/accept?logout_challenge={c}", logoutChallenge)
                .retrieve()
                .body(JsonNode.class);
        return body != null ? body.path("redirect_to").asText() : null;
    }

    /** Rechaza el logout y devuelve el redirect_to de Hydra. */
    public String rejectLogout(String logoutChallenge) {
        JsonNode body = rest.put()
                .uri("/admin/oauth2/auth/requests/logout/reject?logout_challenge={c}", logoutChallenge)
                .body(Map.of(
                        "error", "access_denied",
                        "error_description", "El usuario rechazo el cierre de sesion"))
                .retrieve()
                .body(JsonNode.class);
        return body != null ? body.path("redirect_to").asText() : null;
    }
}
