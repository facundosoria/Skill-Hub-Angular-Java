package com.skillhub.oauth;

import com.skillhub.auth.ApiKeyIdentity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OAuthIdentityServiceTest {

    private static final String USER_ID = "5f8d5d3e-8b2a-45fb-9b50-9b9c9e9c9f21";

    private HydraJwtValidator validator;
    private NamedParameterJdbcTemplate jdbc;
    private OAuthIdentityService service;

    @BeforeEach
    void setUp() {
        validator = mock(HydraJwtValidator.class);
        jdbc = mock(NamedParameterJdbcTemplate.class);
        service = new OAuthIdentityService(validator, jdbc);
    }

    @Test
    void activeUserIsResolvedToOAuthIdentity() {
        ApiKeyIdentity identity = new ApiKeyIdentity(null, USER_ID, "active-user", "platform", "member");
        when(validator.validateAndGetSubject("Bearer token")).thenReturn(Optional.of(USER_ID));
        when(jdbc.query(anyString(), any(MapSqlParameterSource.class), anyRowMapper()))
                .thenReturn(List.of(identity));

        assertThat(service.identifyByAuthHeader("Bearer token")).isEqualTo(identity);
    }

    @Test
    void unknownUserIsRejected() {
        when(validator.validateAndGetSubject("Bearer token")).thenReturn(Optional.of(USER_ID));
        when(jdbc.query(anyString(), any(MapSqlParameterSource.class), anyRowMapper()))
                .thenReturn(List.of());

        assertThat(service.identifyByAuthHeader("Bearer token")).isNull();
    }

    @Test
    void inactiveUserIsRejectedByActiveStatusQuery() {
        when(validator.validateAndGetSubject("Bearer token")).thenReturn(Optional.of(USER_ID));
        when(jdbc.query(anyString(), any(MapSqlParameterSource.class), anyRowMapper()))
                .thenReturn(List.of());

        assertThat(service.identifyByAuthHeader("Bearer token")).isNull();
        verify(jdbc).query(org.mockito.ArgumentMatchers.contains("status = 'active'"),
                any(MapSqlParameterSource.class), anyRowMapper());
    }

    @Test
    void malformedSubjectIsRejectedWithoutDatabaseLookup() {
        when(validator.validateAndGetSubject("Bearer token")).thenReturn(Optional.of("not-a-uuid"));

        assertThat(service.identifyByAuthHeader("Bearer token")).isNull();
        org.mockito.Mockito.verifyNoInteractions(jdbc);
    }

    @SuppressWarnings("unchecked")
    private static RowMapper<ApiKeyIdentity> anyRowMapper() {
        return any(RowMapper.class);
    }
}
