package com.skillhub.web;

import com.skillhub.session.CurrentUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Preferencias del perfil: nombre, equipo (incluido uno heredado que ya no
 * esta en la lista), tema e idioma.
 */
class ProfileControllerTest {

    private static final String TEAM = "Identidad y Usuarios";

    private final CurrentUser user = new CurrentUser("u1", "ana", "Ana", "Viejo", "member", false);
    private NamedParameterJdbcTemplate jdbc;
    private ProfileController controller;

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        controller = new ProfileController(jdbc);
        when(jdbc.queryForObject(anyString(), any(MapSqlParameterSource.class), eq(String.class))).thenReturn("Equipo heredado");
    }

    private static Map<String, String> body(String... pairs) {
        Map<String, String> body = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) body.put(pairs[i], pairs[i + 1]);
        return body;
    }

    private MapSqlParameterSource saved() {
        ArgumentCaptor<MapSqlParameterSource> params = ArgumentCaptor.forClass(MapSqlParameterSource.class);
        verify(jdbc).update(anyString(), params.capture());
        return params.getValue();
    }

    @Test
    void readsTheProfileOfTheCurrentUser() {
        when(jdbc.queryForMap(anyString(), any(MapSqlParameterSource.class))).thenReturn(Map.of("name", "Ana"));

        assertThat(controller.get(user)).containsEntry("name", "Ana");
    }

    @Test
    void savesAValidTeamThemeAndLocale() {
        assertThat(controller.update(user, body("name", "  Ana María ", "team", TEAM, "theme", "dark", "locale", "en"))).containsEntry("ok", true);

        MapSqlParameterSource params = saved();
        assertThat(params.getValue("name")).isEqualTo("Ana María");
        assertThat(params.getValue("team")).isEqualTo(TEAM);
        assertThat(params.getValue("theme")).isEqualTo("dark");
        assertThat(params.getValue("locale")).isEqualTo("en");
    }

    @Test
    void defaultsThemeAndLocaleAndClearsAMissingTeam() {
        controller.update(user, body("name", "Ana"));

        MapSqlParameterSource params = saved();
        assertThat(params.getValue("team")).isNull();
        assertThat(params.getValue("theme")).isEqualTo("system");
        assertThat(params.getValue("locale")).isEqualTo("es");
    }

    @Test
    void keepsALegacyTeamThatIsNoLongerListed() {
        controller.update(user, body("name", "Ana", "team", " Equipo heredado "));

        assertThat(saved().getValue("team")).isEqualTo("Equipo heredado");
    }

    @Test
    void treatsABlankTeamAsNoTeam() {
        controller.update(user, body("name", "Ana", "team", "  "));

        assertThat(saved().getValue("team")).isNull();
    }

    @Test
    void validatesNameTeamThemeAndLocale() {
        assertThatThrownBy(() -> controller.update(user, body())).hasMessage("El nombre necesita entre 2 y 120 caracteres");
        assertThatThrownBy(() -> controller.update(user, body("name", "A"))).hasMessage("El nombre necesita entre 2 y 120 caracteres");
        assertThatThrownBy(() -> controller.update(user, body("name", "n".repeat(121)))).hasMessage("El nombre necesita entre 2 y 120 caracteres");
        assertThatThrownBy(() -> controller.update(user, body("name", "Ana", "team", "Inventado"))).hasMessage("Selecciona un equipo valido");
        assertThatThrownBy(() -> controller.update(user, body("name", "Ana", "theme", "neon"))).hasMessage("Tema invalido");
        assertThatThrownBy(() -> controller.update(user, body("name", "Ana", "locale", "fr"))).hasMessage("Idioma invalido");
        verify(jdbc, never()).update(anyString(), any(MapSqlParameterSource.class));
    }
}
