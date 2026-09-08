package com.skillhub.session;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;

/**
 * Puerto de src/server/auth/session.ts + la parte de sesion de auth/index.ts.
 *
 * Cookie httpOnly `skillhub_session` con un JWT HS256 firmado con SESSION_SECRET,
 * 7 dias. Payload { userId, username, role }. El estado de la cuenta se
 * re-chequea en CADA request (getCurrentUser): si un admin pausa o rechaza a
 * alguien con sesion viva, se corta en la proxima llamada sin esperar los 7 dias.
 */
@Service
public class SessionService {

    private static final String COOKIE = "skillhub_session";
    private static final long MAX_AGE_SECONDS = 60L * 60 * 24 * 7;

    private final SecretKey key;
    private final boolean cookieSecure;
    private final NamedParameterJdbcTemplate jdbc;

    public SessionService(@Value("${app.session-secret}") String secret,
                          @Value("${app.cookie-secure:false}") boolean cookieSecure,
                          NamedParameterJdbcTemplate jdbc) {
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException(
                    "app.session-secret falta o es mas corto que 32 caracteres (SESSION_SECRET)");
        }
        this.key = io.jsonwebtoken.security.Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.cookieSecure = cookieSecure;
        this.jdbc = jdbc;
    }

    public record SessionPayload(String userId, String username, String role) {}

    // --- emision / borrado de la cookie ---------------------------------

    public void createSession(HttpServletResponse res, SessionPayload payload) {
        Instant now = Instant.now();
        String token = Jwts.builder()
                .claim("userId", payload.userId())
                .claim("username", payload.username())
                .claim("role", payload.role())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(MAX_AGE_SECONDS, ChronoUnit.SECONDS)))
                .signWith(key)
                .compact();
        res.addHeader("Set-Cookie", cookie(token, MAX_AGE_SECONDS));
    }

    public void destroySession(HttpServletResponse res) {
        res.addHeader("Set-Cookie", cookie("", 0));
    }

    private String cookie(String value, long maxAge) {
        StringBuilder sb = new StringBuilder();
        sb.append(COOKIE).append('=').append(value)
                .append("; Path=/; HttpOnly; SameSite=Lax; Max-Age=").append(maxAge);
        if (cookieSecure) sb.append("; Secure");
        return sb.toString();
    }

    // --- lectura ------------------------------------------------------

    public SessionPayload readSession(HttpServletRequest req) {
        Cookie[] cookies = req.getCookies();
        if (cookies == null) return null;
        String token = null;
        for (Cookie c : cookies) {
            if (COOKIE.equals(c.getName())) { token = c.getValue(); break; }
        }
        if (token == null || token.isEmpty()) return null;
        try {
            Claims c = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
            return new SessionPayload(c.get("userId", String.class),
                    c.get("username", String.class), c.get("role", String.class));
        } catch (JwtException | IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * Usuario actual, o null. Re-chequea que la cuenta siga `active`: un admin
     * que rechaza a alguien con sesion viva lo corta en la proxima navegacion.
     */
    public CurrentUser getCurrentUser(HttpServletRequest req) {
        SessionPayload session = readSession(req);
        if (session == null) return null;
        List<CurrentUser> rows = jdbc.query(
                """
                SELECT id::text AS id, username, name, team, role::text AS role, status::text AS status
                FROM users WHERE id = :id::uuid LIMIT 1
                """,
                new MapSqlParameterSource("id", session.userId()),
                (rs, i) -> {
                    if (!"active".equals(rs.getString("status"))) return null;
                    return new CurrentUser(rs.getString("id"), rs.getString("username"),
                            rs.getString("name"), rs.getString("team"), rs.getString("role"));
                });
        return rows.isEmpty() ? null : rows.get(0);
    }
}
