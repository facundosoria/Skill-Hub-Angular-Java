package com.skillhub.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Bloqueo por IP del login: cinco fallos seguidos bloquean, un login exitoso
 * limpia el estado y las rutas que no son login no se cuentan.
 */
class RateLimitFilterTest {

    private final RateLimitFilter filter = new RateLimitFilter();

    private static MockHttpServletRequest login(String ip) {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/auth/login");
        req.setRemoteAddr(ip);
        return req;
    }

    private static FilterChain respondWith(int status) {
        return (req, res) -> ((MockHttpServletResponse) res).setStatus(status);
    }

    private MockHttpServletResponse attempt(MockHttpServletRequest req, int status) throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilter(req, res, respondWith(status));
        return res;
    }

    @Test
    void cincoFallosBloqueanConRetryAfter() throws Exception {
        for (int i = 0; i < 5; i++) assertThat(attempt(login("10.0.0.1"), 401).getStatus()).isEqualTo(401);

        MockHttpServletResponse blocked = attempt(login("10.0.0.1"), 200);
        assertThat(blocked.getStatus()).isEqualTo(429);
        assertThat(blocked.getHeader("Retry-After")).isEqualTo("60");
        assertThat(blocked.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(blocked.getContentAsString()).contains("Demasiados intentos fallidos");

        // Otra IP no queda afectada.
        assertThat(attempt(login("10.0.0.2"), 200).getStatus()).isEqualTo(200);
    }

    @Test
    void unLoginExitosoReiniciaElConteo() throws Exception {
        for (int i = 0; i < 4; i++) attempt(login("10.0.0.3"), 401);
        attempt(login("10.0.0.3"), 200);
        for (int i = 0; i < 4; i++) attempt(login("10.0.0.3"), 401);
        assertThat(attempt(login("10.0.0.3"), 200).getStatus()).isEqualTo(200);
    }

    @Test
    void erroresDelServidorNoCuentanComoFallo() throws Exception {
        for (int i = 0; i < 6; i++) attempt(login("10.0.0.4"), 500);
        assertThat(attempt(login("10.0.0.4"), 200).getStatus()).isEqualTo(200);
    }

    @Test
    void usaCloudflareYLuegoXForwardedForComoIp() throws Exception {
        for (int i = 0; i < 5; i++) {
            MockHttpServletRequest req = login("10.0.0.5");
            req.addHeader("CF-Connecting-IP", " 203.0.113.7 ");
            attempt(req, 401);
        }
        MockHttpServletRequest sameClient = login("10.0.0.6");
        sameClient.addHeader("X-Forwarded-For", "203.0.113.7, 10.0.0.6");
        assertThat(attempt(sameClient, 200).getStatus()).isEqualTo(429);

        MockHttpServletRequest blankHeaders = login("10.0.0.7");
        blankHeaders.addHeader("CF-Connecting-IP", " ");
        blankHeaders.addHeader("X-Forwarded-For", " ");
        assertThat(attempt(blankHeaders, 200).getStatus()).isEqualTo(200);
    }

    @Test
    void elLoginOAuthCompartePenalizacionConElLoginWeb() throws Exception {
        for (int i = 0; i < 3; i++) attempt(login("10.0.0.9"), 401);
        for (int i = 0; i < 2; i++) {
            MockHttpServletRequest oauth = new MockHttpServletRequest("POST", "/api/oauth/accept-login");
            oauth.setRemoteAddr("10.0.0.9");
            attempt(oauth, 401);
        }
        MockHttpServletRequest oauth = new MockHttpServletRequest("POST", "/api/oauth/accept-login");
        oauth.setRemoteAddr("10.0.0.9");
        assertThat(attempt(oauth, 200).getStatus()).isEqualTo(429);
        assertThat(attempt(login("10.0.0.9"), 200).getStatus()).isEqualTo(429);
    }

    @Test
    void rutasQueNoSonLoginPasanSinContar() throws Exception {
        for (int i = 0; i < 6; i++) {
            MockHttpServletRequest register = new MockHttpServletRequest("POST", "/api/auth/register");
            register.setRemoteAddr("10.0.0.8");
            attempt(register, 400);
            MockHttpServletRequest getLogin = new MockHttpServletRequest("GET", "/api/auth/login");
            getLogin.setRemoteAddr("10.0.0.8");
            attempt(getLogin, 400);
        }
        assertThat(attempt(login("10.0.0.8"), 200).getStatus()).isEqualTo(200);
    }

    @Test
    void muchasIpsDisparanLaLimpiezaSinPerderLasBloqueadas() throws Exception {
        for (int i = 0; i < 5; i++) attempt(login("10.9.9.9"), 401);
        for (int i = 0; i < 1001; i++) attempt(login("172.16." + (i / 256) + "." + (i % 256)), 200);
        assertThat(attempt(login("10.9.9.9"), 200).getStatus()).isEqualTo(429);
    }
}
