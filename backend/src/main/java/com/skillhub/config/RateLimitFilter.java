package com.skillhub.config;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UrlPathHelper;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * Rate limiter por IP para intentos fallidos de autenticacion.
 *
 * Cinco fallos consecutivos bloquean durante 60 segundos. Cada nuevo grupo de
 * cinco fallos duplica la espera (120 s, 240 s, ...), hasta una hora. Un login
 * exitoso limpia el conteo de fallos de esa IP, pero no la penalizacion: esta
 * se olvida tras una hora sin fallos. Los registros no se cuentan: no son un
 * intento de autenticacion y compartir IP no debe bloquear altas legitimas.
 */
@Component
public class RateLimitFilter implements Filter {

    private static final int FAILURES_PER_LEVEL = 5;
    private static final long INITIAL_BLOCK_MS = 60_000;
    private static final long MAX_BLOCK_MS = 60 * 60_000;
    // Ambos validan usuario/contrasena; comparten el bucket de la IP para que
    // alternar entre la web y el login OAuth no esquive el bloqueo.
    private static final Set<String> LOGIN_PATHS = Set.of("/api/auth/login", "/api/oauth/accept-login");
    // Decodifica, quita ";..." y colapsa "//" igual que el ruteo de Spring MVC,
    // para que variantes del path no esquiven el limite.
    private static final UrlPathHelper PATHS = new UrlPathHelper();

    private static final class Bucket {
        private int consecutiveFailures;
        private int penaltyLevel;
        private long blockedUntil;
        private long lastFailureAt;
    }

    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final LongSupplier clock;

    @Autowired
    public RateLimitFilter() {
        this(System::currentTimeMillis);
    }

    RateLimitFilter(LongSupplier clock) {
        this.clock = clock;
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        if (req instanceof HttpServletRequest httpReq
                && res instanceof HttpServletResponse httpRes
                && "POST".equalsIgnoreCase(httpReq.getMethod())
                && LOGIN_PATHS.contains(PATHS.getPathWithinApplication(httpReq))) {

            String ip = clientIp(httpReq);
            long now = clock.getAsLong();
            Bucket bucket = buckets.computeIfAbsent(ip, ignored -> new Bucket());
            synchronized (bucket) {
                if (now < bucket.blockedUntil) {
                    reject(httpRes, bucket.blockedUntil - now);
                    return;
                }
            }

            try {
                chain.doFilter(req, res);
            } finally {
                synchronized (bucket) {
                    if (httpRes.getStatus() >= 200 && httpRes.getStatus() < 400) {
                        bucket.consecutiveFailures = 0;
                        bucket.blockedUntil = 0;
                    } else if (httpRes.getStatus() >= 400 && httpRes.getStatus() < 500) {
                        // La hora sin fallos se cuenta desde el fin del ultimo bloqueo: si no,
                        // un bloqueo de una hora (el maximo) borraria su propia penalizacion.
                        if (now - Math.max(bucket.lastFailureAt, bucket.blockedUntil) > MAX_BLOCK_MS) {
                            bucket.penaltyLevel = 0;
                            bucket.consecutiveFailures = 0;
                        }
                        bucket.lastFailureAt = now;
                        bucket.consecutiveFailures++;
                        if (bucket.consecutiveFailures >= FAILURES_PER_LEVEL) {
                            bucket.penaltyLevel++;
                            bucket.consecutiveFailures = 0;
                            bucket.blockedUntil = now + blockDuration(bucket.penaltyLevel);
                        }
                    }
                }
            }

            // Limpieza periódica: evita retener IPs inactivas indefinidamente.
            if (buckets.size() > 1000) {
                long cleanupBefore = now - MAX_BLOCK_MS;
                buckets.entrySet().removeIf(e -> {
                    Bucket b = e.getValue();
                    synchronized (b) {
                        return b.blockedUntil < cleanupBefore && b.lastFailureAt < cleanupBefore;
                    }
                });
            }
            return;
        }
        chain.doFilter(req, res);
    }

    private static long blockDuration(int penaltyLevel) {
        long duration = INITIAL_BLOCK_MS;
        for (int i = 1; i < penaltyLevel && duration < MAX_BLOCK_MS; i++) {
            duration = Math.min(MAX_BLOCK_MS, duration * 2);
        }
        return duration;
    }

    private static void reject(HttpServletResponse response, long remainingMs) throws IOException {
        long seconds = Math.max(1, (remainingMs + 999) / 1000);
        response.setStatus(429);
        response.setHeader("Retry-After", Long.toString(seconds));
        response.setHeader("Cache-Control", "no-store");
        response.setContentType("application/json");
        response.getWriter().write(
                "{\"error\":\"Demasiados intentos fallidos. Espera " + seconds + " segundos.\"}");
    }

    private static String clientIp(HttpServletRequest req) {
        String cloudflare = req.getHeader("CF-Connecting-IP");
        if (cloudflare != null && !cloudflare.isBlank()) return cloudflare.trim();
        String forwarded = req.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return req.getRemoteAddr();
    }
}
