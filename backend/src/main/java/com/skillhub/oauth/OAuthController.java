package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.skillhub.session.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Puente entre el login por usuario/contrasena de Skill Hub (ya existente,
 * UserService.login) y Ory Hydra: Hydra maneja todo el protocolo OAuth 2.1
 * pero no tiene base de usuarios propia, asi que redirige el navegador aca
 * con un login_challenge/consent_challenge y espera que le confirmemos quien
 * es la persona. Nunca se usa ni se guarda el email.
 *
 * Sin class-level @RequestMapping (igual que McpController) porque los
 * endpoints de descubrimiento deben vivir en /.well-known/..., fuera de
 * /api/**, para no pasar por los interceptors de WebConfig.
 */
@RestController
public class OAuthController {

    private final UserService users;
    private final HydraAdminClient hydra;
    private final OAuthPasswordChangeService passwordChanges;
    private final RestClient hydraPublic;
    private final String mcpResourceUrl;
    private final String hydraIssuer;

    @Autowired
    public OAuthController(UserService users, HydraAdminClient hydra,
                            OAuthPasswordChangeService passwordChanges,
                            @Value("${app.hydra.mcp-resource-url}") String mcpResourceUrl,
                            @Value("${app.hydra.issuer}") String hydraIssuer,
                            @Value("${app.hydra.public-url}") String hydraPublicUrl) {
        this.users = users;
        this.hydra = hydra;
        this.passwordChanges = passwordChanges;
        this.hydraPublic = RestClient.builder().baseUrl(hydraPublicUrl).build();
        this.mcpResourceUrl = mcpResourceUrl;
        this.hydraIssuer = hydraIssuer;
    }

    /** Constructor kept for focused controller tests that do not need Spring wiring. */
    public OAuthController(UserService users, HydraAdminClient hydra,
                           String mcpResourceUrl, String hydraIssuer, String hydraPublicUrl) {
        this(users, hydra, new OAuthPasswordChangeService(), mcpResourceUrl, hydraIssuer, hydraPublicUrl);
    }

    /** Valida usuario/contrasena con el mismo login que ya usa la web, y se lo confirma a Hydra. */
    @PostMapping("/api/oauth/accept-login")
    public Map<String, Object> acceptLogin(@RequestBody Map<String, String> body) {
        var result = users.login(body.get("username"), body.get("password"));
        if (result.user().mustChangePassword()) {
            String transaction = passwordChanges.create(body.get("loginChallenge"), result.user().id(),
                    result.payload().passwordChangeNonce());
            return Map.of("redirectTo", "/oauth/password-change?transaction=" + transaction);
        }
        String redirectTo = hydra.acceptLogin(body.get("loginChallenge"), result.user().id());
        return Map.of("redirectTo", redirectTo);
    }

    /** Completa el cambio temporal y recien entonces acepta el login_challenge en Hydra. */
    @PostMapping("/api/oauth/password-change")
    public Map<String, Object> completePasswordChange(@RequestBody Map<String, String> body) {
        String transaction = requireTransaction(body.get("transaction"));
        String newPassword = body.get("password");
        CompletedPasswordChange completed = passwordChanges.complete(transaction, pending -> new CompletedPasswordChange(
                pending.loginChallenge(),
                users.changeRequiredPassword(pending.userId(), pending.passwordChangeNonce(), newPassword)));
        String redirectTo = hydra.acceptLogin(completed.loginChallenge(), completed.changed().user().id());
        return Map.of("redirectTo", redirectTo);
    }

    /** Rechaza el login OAuth y consume la transaccion sin aceptar el challenge. */
    @PostMapping("/api/oauth/password-change/reject")
    public Map<String, Object> rejectPasswordChange(@RequestBody Map<String, String> body) {
        OAuthPasswordChangeService.PendingChange pending = passwordChanges.reject(requireTransaction(body.get("transaction")));
        return Map.of("redirectTo", hydra.rejectLogin(pending.loginChallenge()));
    }

    /** Devuelve al frontend sólo los datos seguros necesarios para mostrar consentimiento. */
    @GetMapping("/api/oauth/consent-request")
    public Map<String, Object> consentRequest(@RequestParam("consentChallenge") String consentChallenge) {
        consentChallenge = requireChallenge(consentChallenge);
        JsonNode request = hydra.getConsentRequest(consentChallenge);
        JsonNode client = request == null ? null : request.path("client");
        return Map.of(
                "clientName", client == null || client.path("client_name").asText().isBlank()
                        ? "Skill Hub"
                        : client.path("client_name").asText(),
                "requestedScopes", requestedScopes(request));
    }

    /** Acepta el consentimiento otorgando los scopes que Hydra solicito. */
    @PostMapping("/api/oauth/accept-consent")
    public Map<String, Object> acceptConsent(@RequestBody Map<String, Object> body) {
        String consentChallenge = requireChallenge(body.get("consentChallenge"));
        String redirectTo = hydra.acceptConsent(consentChallenge);
        return Map.of("redirectTo", redirectTo);
    }

    /** Rechaza el consentimiento y devuelve al cliente OAuth con access_denied. */
    @PostMapping("/api/oauth/reject-consent")
    public Map<String, Object> rejectConsent(@RequestBody Map<String, String> body) {
        String redirectTo = hydra.rejectConsent(requireChallenge(body.get("consentChallenge")));
        return Map.of("redirectTo", redirectTo);
    }

    private String requireChallenge(Object rawChallenge) {
        if (!(rawChallenge instanceof String challenge) || challenge.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CONSENT_CHALLENGE_REQUIRED");
        }
        return challenge;
    }

    private String requireTransaction(Object rawTransaction) {
        if (!(rawTransaction instanceof String transaction) || transaction.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PASSWORD_CHANGE_TRANSACTION_REQUIRED");
        }
        return transaction;
    }

    private record CompletedPasswordChange(String loginChallenge, UserService.LoginResult changed) {}

    private List<String> requestedScopes(JsonNode request) {
        if (request == null || !request.path("requested_scope").isArray()) return List.of();
        List<String> scopes = new ArrayList<>();
        request.path("requested_scope").forEach(scope -> {
            if (scope.isTextual() && !scope.asText().isBlank()) scopes.add(scope.asText());
        });
        return scopes;
    }

    /** RFC 9728 (OAuth 2.0 Protected Resource Metadata) - le dice a los clientes MCP donde autenticarse. */
    @GetMapping({
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/api/mcp",
            "/api/mcp/.well-known/oauth-protected-resource"
    })
    public Map<String, Object> protectedResourceMetadata() {
        return Map.of(
                "resource", mcpResourceUrl,
                "authorization_servers", List.of(hydraIssuer),
                "scopes_supported", List.of("mcp"),
                "bearer_methods_supported", List.of("header"));
    }

    /**
     * RFC 8414 (OAuth 2.0 Authorization Server Metadata). Hydra v2 NO expone
     * este path (solo /.well-known/openid-configuration, verificado
     * corriendo el stack local antes de este cambio) - varios clientes MCP
     * lo piden igual por compatibilidad, asi que este endpoint reenvia el
     * contenido real de Hydra tal cual.
     */
    @GetMapping({
            "/.well-known/oauth-authorization-server",
            "/.well-known/oauth-authorization-server/api/mcp",
            "/api/mcp/.well-known/oauth-authorization-server",
            "/api/mcp/.well-known/openid-configuration",
            "/.well-known/openid-configuration",
            "/.well-known/openid-configuration/api/mcp"
    })
    public JsonNode authorizationServerMetadata() {
        JsonNode metadata = hydraPublic.get()
                .uri("/.well-known/openid-configuration")
                .retrieve()
                .body(JsonNode.class);
        if (metadata == null || !metadata.isObject()) return metadata;
        ObjectNode sanitized = metadata.deepCopy();
        ArrayNode pkceMethods = sanitized.putArray("code_challenge_methods_supported");
        pkceMethods.add("S256");
        return sanitized;
    }

    /** Keep unknown discovery probes out of the SPA fallback. */
    @GetMapping({"/.well-known/**", "/api/mcp/.well-known/**"})
    public ResponseEntity<Map<String, Object>> unknownDiscoveryPath() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Discovery endpoint not found"));
    }
}
