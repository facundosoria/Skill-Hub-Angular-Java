package com.skillhub.web;

import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import com.skillhub.team.Team;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Puerto de src/server/profile/actions.ts.
 *
 * La base es la fuente de verdad (las preferencias siguen a la cuenta entre
 * maquinas). El espejo a cookies para el anti-parpadeo del tema/idioma pasa a
 * ser trabajo del cliente Angular.
 */
@RestController
@RequestMapping("/api/profile")
public class ProfileController {

    private static final List<String> THEMES = List.of("system", "light", "dark");
    private static final List<String> LOCALES = List.of("es", "en");

    private final NamedParameterJdbcTemplate jdbc;

    public ProfileController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public Map<String, Object> get(@AuthPrincipal CurrentUser user) {
        return jdbc.queryForMap("""
                SELECT name, team, theme::text AS theme, locale::text AS locale
                FROM users WHERE id = :id::uuid
                """, new MapSqlParameterSource("id", user.id()));
    }

    @PutMapping
    public Map<String, Object> update(@AuthPrincipal CurrentUser user, @RequestBody Map<String, String> body) {
        String name = body.getOrDefault("name", "").trim();
        String rawTeam = body.get("team");
        String team = Team.canonicalOrNull(rawTeam);
        String currentTeam = jdbc.queryForObject("SELECT team FROM users WHERE id = :id::uuid",
                new MapSqlParameterSource("id", user.id()), String.class);
        boolean keepsLegacyTeam = rawTeam != null && rawTeam.trim().equals(currentTeam);
        String theme = body.getOrDefault("theme", "system");
        String locale = body.getOrDefault("locale", "es");
        if (name.length() < 2 || name.length() > 120) throw new DomainException("El nombre necesita entre 2 y 120 caracteres");
        if (rawTeam != null && !rawTeam.isBlank() && team == null && !keepsLegacyTeam)
            throw new DomainException("Selecciona un equipo valido");
        if (!THEMES.contains(theme)) throw new DomainException("Tema invalido");
        if (!LOCALES.contains(locale)) throw new DomainException("Idioma invalido");

        jdbc.update("""
                UPDATE users SET name = :name, team = :team,
                       theme = :theme::theme, locale = :locale::locale
                WHERE id = :id::uuid
                """, new MapSqlParameterSource()
                .addValue("name", name).addValue("team", team != null ? team : (keepsLegacyTeam ? currentTeam : null))
                .addValue("theme", theme).addValue("locale", locale)
                .addValue("id", user.id()));
        return Map.of("ok", true);
    }
}
