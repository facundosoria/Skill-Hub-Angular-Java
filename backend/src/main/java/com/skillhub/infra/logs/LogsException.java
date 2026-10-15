package com.skillhub.infra.logs;

public class LogsException extends RuntimeException {
    final int status;
    final String code;
    final int retryAfter;

    LogsException(int status, String code, String message) {
        this(status, code, message, 0);
    }

    LogsException(int status, String code, String message, int retryAfter) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
    }

    static LogsException invalidQuery() {
        return new LogsException(400, "INVALID_QUERY", "La consulta de logs no es válida.");
    }

    static LogsException expired() {
        return new LogsException(409, "CURSOR_EXPIRED", "El historial solicitado ya no está disponible.");
    }

    static LogsException unavailable() {
        return new LogsException(503, "SOURCE_UNAVAILABLE", "La fuente de logs no está disponible.");
    }
}
