package com.skillhub.infra.logs;

import com.skillhub.session.CurrentUser;
import com.skillhub.session.SessionService;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.mock.web.MockHttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.Collections;
import java.util.Date;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class LogsSessionValidationTest {
    static final String SECRET = "synthetic-session-secret-with-at-least-32-characters";
    SessionService sessions;
    ResultSet row;

    @BeforeEach void setup() throws Exception {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        row = mock(ResultSet.class);
        when(row.getString("id")).thenReturn("synthetic-account");
        when(row.getString("username")).thenReturn("student");
        when(row.getString("status")).thenReturn("active");
        when(row.getString("password_change_nonce")).thenReturn("synthetic-nonce");
        when(jdbc.query(anyString(), any(SqlParameterSource.class), org.mockito.ArgumentMatchers.<RowMapper<CurrentUser>>any()))
                .thenAnswer(call -> Collections.singletonList(call.<RowMapper<CurrentUser>>getArgument(2).mapRow(row, 0)));
        sessions = new SessionService(SECRET, false, jdbc);
    }

    private String token(Instant expiry, String nonce) {
        var builder = Jwts.builder().claim("userId", "00000000-0000-0000-0000-000000000001")
                .claim("username", "student").claim("role", "user").expiration(Date.from(expiry));
        if (nonce != null) builder.claim("passwordChangeNonce", nonce);
        return builder.signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8))).compact();
    }

    private void assertBoth(String token, boolean valid) {
        var request = new MockHttpServletRequest();
        request.setCookies(new Cookie("skillhub_session", token));
        assertThat(sessions.readSession(token)).isEqualTo(sessions.readSession(request));
        assertThat(sessions.getCurrentUser(token)).isEqualTo(sessions.getCurrentUser(request));
        assertThat(sessions.getCurrentUser(token) != null).isEqualTo(valid);
    }

    @Test void requestAndTokenOverloadsRejectInvalidAndExpiredTokensIdentically() {
        assertBoth("invalid-synthetic-token", false);
        assertBoth(token(Instant.now().minusSeconds(60), null), false);
        assertThat(sessions.readSession((String) null)).isNull();
        assertThat(sessions.getCurrentUser((String) null)).isNull();
    }

    @Test void requestAndTokenOverloadsRejectClosedAccountsAndChangedPasswordsIdentically() throws Exception {
        String active = token(Instant.now().plusSeconds(60), null);
        assertBoth(active, true);
        when(row.getString("status")).thenReturn("paused");
        assertBoth(active, false);
        when(row.getString("status")).thenReturn("active");
        assertBoth(token(Instant.now().plusSeconds(60), "old-synthetic-nonce"), false);
        assertBoth(token(Instant.now().plusSeconds(60), "synthetic-nonce"), true);
        assertThat(sessions.getCurrentUser(token(Instant.now().plusSeconds(60), "synthetic-nonce")).mustChangePassword()).isTrue();
    }
}
