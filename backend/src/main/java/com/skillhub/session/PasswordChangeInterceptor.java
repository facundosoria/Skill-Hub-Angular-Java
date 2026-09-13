package com.skillhub.session;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Set;

/** Restringe una sesion creada con contrasena temporal hasta completar el cambio obligatorio. */
@Component
public class PasswordChangeInterceptor implements HandlerInterceptor {

    private static final Set<String> ALLOWED_PATHS = Set.of(
            "/api/auth/me",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/change-password"
    );

    private final SessionService sessions;

    public PasswordChangeInterceptor(SessionService sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        CurrentUser user = sessions.getCurrentUser(request);
        if (user != null && user.mustChangePassword() && !ALLOWED_PATHS.contains(request.getRequestURI())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PASSWORD_CHANGE_REQUIRED");
        }
        return true;
    }
}
