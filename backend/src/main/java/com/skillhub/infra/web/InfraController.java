package com.skillhub.infra.web;

import com.skillhub.infra.model.HeartbeatRequest;
import com.skillhub.infra.model.FrontendNodesStatusDto;
import com.skillhub.infra.service.FrontendNodesService;
import com.skillhub.infra.service.InfraHeartbeatService;
import com.skillhub.infra.service.InfraTokenService;
import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/infra")
public class InfraController {

    private final InfraHeartbeatService infraHeartbeatService;
    private final InfraTokenService infraTokenService;
    private final FrontendNodesService frontendNodesService;

    public InfraController(InfraHeartbeatService infraHeartbeatService, InfraTokenService infraTokenService,
                           FrontendNodesService frontendNodesService) {
        this.infraHeartbeatService = infraHeartbeatService;
        this.infraTokenService = infraTokenService;
        this.frontendNodesService = frontendNodesService;
    }

    @PostMapping("/heartbeat")
    public Map<String, Object> heartbeat(@Valid @RequestBody HeartbeatRequest request,
                                         @RequestHeader(value = "Authorization", required = false) String authorization,
                                         HttpServletRequest httpRequest) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "SERVICE_TOKEN_INVALID");
        }
        String token = authorization.substring("Bearer ".length());
        if (token.isBlank() || token.chars().anyMatch(Character::isWhitespace)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "SERVICE_TOKEN_INVALID");
        }
        infraTokenService.validateServiceToken(token, request.serviceId());
        infraHeartbeatService.recordHeartbeat(request, clientIp(httpRequest));
        return Map.of("acknowledged", true, "timestamp", Instant.now().toString());
    }

    @GetMapping("/status")
    public Map<String, Object> status(@AuthPrincipal CurrentUser user) {
        var status = infraHeartbeatService.getInfraStatus();
        return Map.of("summary", status.overview(), "services", status.services());
    }

    @GetMapping("/frontend-nodes")
    public FrontendNodesStatusDto frontendNodes(@AuthPrincipal CurrentUser user) {
        return frontendNodesService.getFrontendNodesStatus();
    }

    @PostMapping("/services/{serviceId}/tokens")
    public Map<String, Object> createServiceToken(@AuthPrincipal CurrentUser user,
                                                   @PathVariable String serviceId,
                                                   @RequestBody(required = false) Map<String, String> body) {
        requireAdmin(user);
        String name = body != null && body.get("name") != null && !body.get("name").isBlank()
                ? body.get("name").trim()
                : serviceId;
        var token = infraTokenService.generateServiceToken();
        infraTokenService.persistServiceToken(serviceId, name, token);
        return Map.of("token", token.raw(), "serviceId", serviceId, "name", name);
    }

    private static String clientIp(HttpServletRequest request) {
        String cloudflare = request.getHeader("CF-Connecting-IP");
        if (cloudflare != null && !cloudflare.isBlank()) return cloudflare.trim();
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",")[0].trim();
        return request.getRemoteAddr();
    }

    private static void requireAdmin(CurrentUser user) {
        if (!user.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un admin");
    }
}
