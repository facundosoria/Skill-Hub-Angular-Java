package com.skillhub.infra.logs;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = InfraLogsController.class)
public class LogsExceptionHandler {
    private static final org.springframework.http.MediaType JSON_UTF8 =
            new org.springframework.http.MediaType(org.springframework.http.MediaType.APPLICATION_JSON, java.nio.charset.StandardCharsets.UTF_8);

    @ExceptionHandler(LogsException.class)
    ResponseEntity<Map<String, String>> logs(LogsException exception) {
        var builder = ResponseEntity.status(exception.status).contentType(JSON_UTF8)
                .header("Cache-Control", LogsRequestFilter.CACHE_CONTROL);
        if (exception.retryAfter > 0) builder.header("Retry-After", Integer.toString(exception.retryAfter));
        return builder.body(Map.of("code", exception.code, "message", exception.getMessage()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> session(ResponseStatusException exception) {
        int status = exception.getStatusCode().value();
        String code = status == 403 ? "PASSWORD_CHANGE_REQUIRED" : "UNAUTHENTICATED";
        String message = status == 403 ? "Debés cambiar tu contraseña para acceder a los logs." : "Tu sesión venció. Volvé a ingresar.";
        return ResponseEntity.status(status).contentType(JSON_UTF8)
                .header("Cache-Control", LogsRequestFilter.CACHE_CONTROL)
                .body(Map.of("code", code, "message", message));
    }
}
