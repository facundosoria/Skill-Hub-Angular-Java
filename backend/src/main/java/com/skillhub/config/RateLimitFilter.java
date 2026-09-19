package com.skillhub.config;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Rate limiter por IP para intentos fallidos de autenticacion.
 *
 * Cinco fallos consecutivos bloquean durante 60 segundos. Cada nuevo grupo de
 * cinco fallos duplica la espera (120 s, 240 s, ...), hasta una hora. Un login
 * exitoso limpia el estado de esa IP. Los registros no se cuentan: no son un
 * intento de autenticacion y compartir IP no debe bloquear altas legitimas.
 */
@Component
public class RateLimitFilter implements Filter {

    private static final int FAILURES_PER_LEVEL = 5;
    private static final long INITIAL_BLOCK_MS = 60_000;
    private static final long MAX_BLOCK_MS = 60 * 60_000;
    private static final String LOGIN_PATH = "/api/auth/login";

    private static final class Bucket {
        private int consecutiveFailures;
        private int penaltyLevel;
        private long blockedUntil;
    }

    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        if (req instanceof HttpServletRequest httpReq
                && res instanceof HttpServletResponse httpRes
                && "POST".equalsIgnoreCase(httpReq.getMethod())
                && LOGIN_PATH.equals(httpReq.getRequestURI())) {

            String ip = clientIp(httpReq);
            long now = System.currentTimeMillis();
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
                        bucket.penaltyLevel = 0;
                        bucket.blockedUntil = 0;
                    } else if (httpRes.getStatus() >= 400 && httpRes.getStatus() < 500) {
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
                        return b.blockedUntil < cleanupBefore && b.consecutiveFailures == 0;
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
