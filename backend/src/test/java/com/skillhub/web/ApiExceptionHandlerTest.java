package com.skillhub.web;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Todo error sale como {"error": "..."} sin filtrar detalles internos. */
class ApiExceptionHandlerTest {

    private final ApiExceptionHandler handler = new ApiExceptionHandler();

    @Test
    void responseStatusSinReasonUsaElCodigo() {
        var r = handler.status(new ResponseStatusException(HttpStatus.NOT_FOUND));
        assertThat(r.getStatusCode().value()).isEqualTo(404);
        assertThat(r.getBody()).containsEntry("error", "404 NOT_FOUND");
    }

    @Test
    void illegalArgumentNoExponeElMensaje() {
        var r = handler.illegal(new IllegalArgumentException("detalle interno"));
        assertThat(r.getStatusCode().value()).isEqualTo(400);
        assertThat(r.getBody()).containsEntry("error", "Datos invalidos");
    }

    @Test
    void uploadDemasiadoGrandeDa413() {
        var r = handler.uploadTooLarge(new MaxUploadSizeExceededException(1));
        assertThat(r.getStatusCode().value()).isEqualTo(413);
    }

    @Test
    void metodoNoSoportadoInformaAllow() {
        var r = handler.methodNotSupported(new HttpRequestMethodNotSupportedException("PATCH", List.of("GET", "POST")));
        assertThat(r.getStatusCode().value()).isEqualTo(405);
        assertThat(r.getHeaders().getFirst("Allow")).isEqualTo("GET, POST");

        var sinAllow = handler.methodNotSupported(new HttpRequestMethodNotSupportedException("PATCH"));
        assertThat(sinAllow.getHeaders().getFirst("Allow")).isNull();
    }

    @Test
    void formatoNoAceptableDa406() {
        var r = handler.mediaTypeNotAcceptable(new HttpMediaTypeNotAcceptableException("x"));
        assertThat(r.getStatusCode().value()).isEqualTo(406);
    }

    @Test
    void fallbackDa500Generico() {
        var r = handler.fallback(new RuntimeException("stack secreto"));
        assertThat(r.getStatusCode().value()).isEqualTo(500);
        assertThat(r.getBody()).containsEntry("error", "Error interno del servidor");
    }
}
