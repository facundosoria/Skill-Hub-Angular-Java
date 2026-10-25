package com.skillhub.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Defensa CSRF: requests mutantes sólo desde el mismo host. */
class OriginCheckInterceptorTest {

    private final OriginCheckInterceptor interceptor = new OriginCheckInterceptor();

    private boolean check(String method, String uri, String origin) {
        MockHttpServletRequest req = new MockHttpServletRequest(method, uri);
        req.setServerName("skillhub.local");
        if (origin != null) req.addHeader("Origin", origin);
        return interceptor.preHandle(req, new MockHttpServletResponse(), new Object());
    }

    @Test
    void metodosSegurosMcpYSinOriginPasan() {
        assertThat(check("get", "/api/skills", "https://evil.example")).isTrue();
        assertThat(check("POST", "/api/mcp", "https://evil.example")).isTrue();
        assertThat(check("POST", "/api/skills", null)).isTrue();
        assertThat(check("POST", "/api/skills", " ")).isTrue();
    }

    @Test
    void mismoHostPasa() {
        assertThat(check("DELETE", "/api/skills/x", "https://skillhub.local:8087")).isTrue();
    }

    @Test
    void otroHostDa403() {
        assertThatThrownBy(() -> check("POST", "/api/skills", "https://evil.example"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Origen no permitido");
    }

    @Test
    void originMalformadoDa403() {
        assertThatThrownBy(() -> check("PUT", "/api/skills/x", "http://bad host"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Origen invalido");
    }
}
