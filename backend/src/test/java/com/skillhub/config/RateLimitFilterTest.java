package com.skillhub.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Bloqueo por IP del login: cinco fallos seguidos bloquean, un login exitoso
 * limpia el estado y las rutas que no son login no se cuentan.
 */
class RateLimitFilterTest {

    private final AtomicLong now = new AtomicLong(1_000_000_000L);
    private final RateLimitFilter filter = new RateLimitFilter(now::get);

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

    @Test
    void variantesDelPathTambienCuentan() throws Exception {
        String[] variants = {"/api/auth/login;jsessionid=a", "/api/auth/lo%67in", "//api/auth/login",
                "/api/oauth/accept-login;x=1", "/api/oauth/accept-lo%67in"};
        for (String uri : variants) {
            MockHttpServletRequest req = new MockHttpServletRequest("POST", uri);
            req.setRemoteAddr("10.1.1.1");
            attempt(req, 401);
        }
        assertThat(attempt(login("10.1.1.1"), 200).getStatus()).isEqualTo(429);
    }

    @Test
    void unLoginExitosoNoBorraLaPenalizacion() throws Exception {
        for (int i = 0; i < 5; i++) attempt(login("10.1.1.2"), 401);
        now.addAndGet(61_000);
        assertThat(attempt(login("10.1.1.2"), 200).getStatus()).isEqualTo(200);

        for (int i = 0; i < 5; i++) attempt(login("10.1.1.2"), 401);
        assertThat(attempt(login("10.1.1.2"), 200).getHeader("Retry-After")).isEqualTo("120");
    }

    @Test
    void laPenalizacionDecaeTrasUnaHoraSinFallos() throws Exception {
        for (int i = 0; i < 5; i++) attempt(login("10.1.1.3"), 401);
        now.addAndGet(60 * 60_000 + 61_000);

        for (int i = 0; i < 5; i++) attempt(login("10.1.1.3"), 401);
        assertThat(attempt(login("10.1.1.3"), 200).getHeader("Retry-After")).isEqualTo("60");
    }

    @Test
    void laLimpiezaEliminaIpsConFallosViejosSinBloqueo() throws Exception {
        for (int i = 0; i < 4; i++) attempt(login("10.1.1.4"), 401);
        now.addAndGet(60 * 60_000 + 1);
        for (int i = 0; i < 1001; i++) attempt(login("172.17." + (i / 256) + "." + (i % 256)), 200);

        // El bucket viejo se elimino: hacen falta cinco fallos nuevos para bloquear.
        assertThat(attempt(login("10.1.1.4"), 401).getStatus()).isEqualTo(401);
        assertThat(attempt(login("10.1.1.4"), 200).getStatus()).isEqualTo(200);
    }

    /** Cinco fallos seguidos desde la IP y devuelve el Retry-After del bloqueo resultante. */
    private String bloquear(String ip) throws Exception {
        for (int i = 0; i < 5; i++) attempt(login(ip), 401);
        return attempt(login(ip), 200).getHeader("Retry-After");
    }

    @Test
    void elBloqueoSeDuplicaEnCadaNivelHastaUnaHora() throws Exception {
        String[] esperados = {"60", "120", "240", "480", "960", "1920", "3600", "3600"};
        for (String esperado : esperados) {
            assertThat(bloquear("10.2.0.1")).isEqualTo(esperado);
            now.addAndGet(Long.parseLong(esperado) * 1000 + 1);
        }
    }

    @Test
    void unBloqueoDeUnaHoraNoBorraSuPropiaPenalizacion() throws Exception {
        // Siete niveles: el septimo ya es el tope de una hora.
        for (int nivel = 0; nivel < 7; nivel++) {
            String retry = bloquear("10.2.0.2");
            now.addAndGet(Long.parseLong(retry) * 1000 + 1);
        }

        // Apenas termina el bloqueo de una hora, el siguiente sigue siendo de una hora.
        assertThat(bloquear("10.2.0.2")).isEqualTo("3600");
    }

    @Test
    void laHoraSinFallosSeCuentaDesdeElFinDelBloqueo() throws Exception {
        assertThat(bloquear("10.2.0.3")).isEqualTo("60");

        // Mas de una hora desde el ultimo fallo, pero menos de una hora desde el fin del bloqueo.
        now.addAndGet(60 * 60_000 + 30_000);

        assertThat(bloquear("10.2.0.3")).isEqualTo("120");
    }

    @Test
    void trasUnaHoraDesdeElFinDelBloqueoLaPenalizacionVuelveAlInicio() throws Exception {
        assertThat(bloquear("10.2.0.4")).isEqualTo("60");

        now.addAndGet(60_000 + 60 * 60_000 + 1);

        assertThat(bloquear("10.2.0.4")).isEqualTo("60");
    }

    @Test
    void alDecaerSeOlvidanTambienLosFallosAcumulados() throws Exception {
        for (int i = 0; i < 4; i++) attempt(login("10.2.0.5"), 401);
        now.addAndGet(2 * 60 * 60_000);

        // Un solo fallo despues del decaimiento no completa los cinco.
        assertThat(attempt(login("10.2.0.5"), 401).getStatus()).isEqualTo(401);
        assertThat(attempt(login("10.2.0.5"), 200).getStatus()).isEqualTo(200);
    }

    @Test
    void losFallosRecientesSiguenSumandoAntesDeLaHora() throws Exception {
        for (int i = 0; i < 4; i++) attempt(login("10.2.0.6"), 401);
        now.addAndGet(59 * 60_000);

        attempt(login("10.2.0.6"), 401);
        assertThat(attempt(login("10.2.0.6"), 200).getStatus()).isEqualTo(429);
    }

    @Test
    void elRetryAfterRedondeaHaciaArribaYNuncaBajaDeUnSegundo() throws Exception {
        bloquear("10.2.0.7");

        now.addAndGet(59_500);
        assertThat(attempt(login("10.2.0.7"), 200).getHeader("Retry-After")).isEqualTo("1");

        now.addAndGet(499);
        assertThat(attempt(login("10.2.0.7"), 200).getHeader("Retry-After")).isEqualTo("1");

        now.addAndGet(1);
        assertThat(attempt(login("10.2.0.7"), 200).getStatus()).isEqualTo(200);
    }

    @Test
    void mientrasDuraElBloqueoNoSeLlamaAlLogin() throws Exception {
        bloquear("10.2.0.8");
        int[] llamadas = {0};
        MockHttpServletResponse res = new MockHttpServletResponse();

        filter.doFilter(login("10.2.0.8"), res, (req, r) -> llamadas[0]++);

        assertThat(res.getStatus()).isEqualTo(429);
        assertThat(res.getContentType()).isEqualTo("application/json");
        assertThat(llamadas[0]).isZero();
    }

    @Test
    void lasRedireccionesCuentanComoExito() throws Exception {
        for (int i = 0; i < 4; i++) attempt(login("10.2.0.9"), 401);
        attempt(login("10.2.0.9"), 302);
        for (int i = 0; i < 4; i++) attempt(login("10.2.0.9"), 401);

        assertThat(attempt(login("10.2.0.9"), 200).getStatus()).isEqualTo(200);
    }
}
