package com.skillhub.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

import java.net.URI;
import java.util.Set;

/**
 * Verifica que las requests mutantes provengan del mismo origen.
 * Complementa SameSite=Lax como defensa en profundidad contra CSRF.
 */
@Component
public class OriginCheckInterceptor implements HandlerInterceptor {

    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                             Object handler) {
        if (SAFE_METHODS.contains(request.getMethod().toUpperCase())) return true;

        // Endpoints de API key (MCP) no usan cookie, no necesitan check de Origin.
        String uri = request.getRequestURI();
        if (uri.startsWith("/api/mcp")) return true;

        String origin = request.getHeader("Origin");
        if (origin == null || origin.isBlank()) return true; // mismo origen, aceptar

        try {
            URI originUri = URI.create(origin);
            String requestHost = request.getServerName();
            if (!originUri.getHost().equals(requestHost)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Origen no permitido");
            }
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Origen invalido");
        }
        return true;
    }
}
