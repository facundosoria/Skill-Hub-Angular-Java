package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.skillhub.session.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/** Resuelve el consentimiento de logout OAuth entre Hydra y la sesion web local. */
@RestController
public class OAuthLogoutController {

    private final HydraAdminClient hydra;
    private final SessionService sessions;
    private final OAuthPasswordChangeService passwordChanges;

    public OAuthLogoutController(HydraAdminClient hydra, SessionService sessions,
                                 OAuthPasswordChangeService passwordChanges) {
        this.hydra = hydra;
        this.sessions = sessions;
        this.passwordChanges = passwordChanges;
    }

    /** Expone solo el nombre del cliente; subject y otros detalles quedan en backend. */
    @GetMapping("/api/oauth/logout-request")
    public Map<String, Object> logoutRequest(@RequestParam("logoutChallenge") String logoutChallenge) {
        JsonNode request = loadRequest(requireChallenge(logoutChallenge));
        JsonNode client = request.path("client");
        String clientName = client.path("client_name").asText();
        return Map.of("clientName", clientName.isBlank() ? "Skill Hub" : clientName);
    }

    /** Acepta el logout OAuth, limpia la sesion local y continua hacia Hydra. */
    @PostMapping("/api/oauth/accept-logout")
    public Map<String, Object> acceptLogout(@RequestBody Map<String, String> body,
                                            HttpServletRequest request,
                                            HttpServletResponse response) {
        String challenge = requireChallenge(body == null ? null : body.get("logoutChallenge"));
        JsonNode logoutRequest = loadRequest(challenge);
        String subject = textOrNull(logoutRequest, "subject");
        if (subject == null) {
            SessionService.SessionPayload session = sessions.readSession(request);
            subject = session == null ? null : session.userId();
        }

        String redirectTo = acceptHydraLogout(challenge);
        sessions.destroySession(response);
        passwordChanges.invalidateForUser(subject);
        return Map.of("redirectTo", redirectTo == null ? "" : redirectTo);
    }

    /** Rechaza el logout y conserva la sesion local. */
    @PostMapping("/api/oauth/reject-logout")
    public Map<String, Object> rejectLogout(@RequestBody Map<String, String> body) {
        String challenge = requireChallenge(body == null ? null : body.get("logoutChallenge"));
        loadRequest(challenge);
        String redirectTo;
        try {
            redirectTo = hydra.rejectLogout(challenge);
        } catch (RestClientException | IllegalArgumentException e) {
            throw invalidChallenge();
        }
        return Map.of("redirectTo", redirectTo == null ? "" : redirectTo);
    }

    private JsonNode loadRequest(String challenge) {
        try {
            JsonNode request = hydra.getLogoutRequest(challenge);
            if (request == null || request.isNull() || request.isMissingNode()) {
                throw invalidChallenge();
            }
            return request;
        } catch (RestClientException | IllegalArgumentException e) {
            throw invalidChallenge();
        }
    }

    private String acceptHydraLogout(String challenge) {
        try {
            return hydra.acceptLogout(challenge);
        } catch (RestClientException | IllegalArgumentException e) {
            throw invalidChallenge();
        }
    }

    private String requireChallenge(String challenge) {
        if (challenge == null || challenge.isBlank()) throw invalidChallenge();
        return challenge;
    }

    private ResponseStatusException invalidChallenge() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "LOGOUT_CHALLENGE_INVALID");
    }

    private String textOrNull(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }
}
