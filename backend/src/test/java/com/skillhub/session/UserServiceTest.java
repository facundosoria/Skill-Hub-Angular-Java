package com.skillhub.session;

import com.skillhub.audit.AuditService;
import com.skillhub.web.DomainException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Reglas de cuentas sin base de datos: login sin revelar usuarios, alta con
 * primer admin, acciones de administracion y cambio obligatorio de contrasena.
 */
class UserServiceTest {

    private static final String TEAM = "Identidad y Usuarios";
    private static final String GOOD_PASSWORD = "clave-segura-1";

    private NamedParameterJdbcTemplate jdbc;
    private JdbcTemplate plain;
    private PasswordHasher passwords;
    private AuditService audit;
    private UserService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        plain = mock(JdbcTemplate.class);
        passwords = mock(PasswordHasher.class);
        audit = mock(AuditService.class);
        when(jdbc.getJdbcTemplate()).thenReturn(plain);
        when(passwords.hash(anyString())).thenReturn("hash");
        service = new UserService(jdbc, passwords, audit);
    }

    private void row(String sqlFragment, Map<String, Object> row) {
        when(jdbc.queryForList(contains(sqlFragment), any(MapSqlParameterSource.class)))
                .thenReturn(row == null ? List.of() : List.of(row));
    }

    private static Map<String, Object> user(String status, boolean mustChange) {
        Map<String, Object> user = new HashMap<>();
        user.put("id", "u1");
        user.put("username", "ana");
        user.put("name", "Ana");
        user.put("team", TEAM);
        user.put("role", "member");
        user.put("status", status);
        user.put("hash", "stored");
        user.put("mustChangePassword", mustChange);
        user.put("passwordChangeNonce", mustChange ? "nonce-1" : null);
        return user;
    }

    // --- login ---------------------------------------------------------

    @ParameterizedTest
    @CsvSource(nullValues = "NULL", value = {"NULL,pw", "'  ',pw", "ana,NULL", "ana,''"})
    void loginRequiresUsernameAndPassword(String username, String password) {
        assertThatThrownBy(() -> service.login(username, password)).hasMessage("Ingresa tu usuario y contrasena");
    }

    @Test
    void loginRejectsOverlongUsernames() {
        assertThatThrownBy(() -> service.login("a".repeat(65), "pw")).hasMessage("Ingresa tu usuario y contrasena");
    }

    @Test
    void loginUsesTheSameMessageForUnknownUsersAndWrongPasswords() {
        row("FROM users WHERE username", null);
        assertThatThrownBy(() -> service.login("nadie", "pw")).hasMessage("Usuario o contrasena incorrectos");
        verify(passwords).verify(eq("pw"), anyString());

        row("FROM users WHERE username", user("active", false));
        when(passwords.verify("mala", "stored")).thenReturn(false);
        assertThatThrownBy(() -> service.login("ana", "mala")).hasMessage("Usuario o contrasena incorrectos");
    }

    @ParameterizedTest
    @CsvSource({
            "pending,Tu cuenta todavia no fue aprobada por un administrador.",
            "rejected,Tu solicitud de acceso fue rechazada.",
            "inactive,Tu cuenta se encuentra desactivada.",
    })
    void loginChecksTheAccountStatusAfterThePassword(String status, String message) {
        row("FROM users WHERE username", user(status, false));
        when(passwords.verify("pw", "stored")).thenReturn(true);

        assertThatThrownBy(() -> service.login("ANA ", "pw")).hasMessage(message);
    }

    @Test
    void loginReturnsTheUserAndAPasswordChangeNonceWhenRequired() {
        row("FROM users WHERE username", user("active", true));
        when(passwords.verify("pw", "stored")).thenReturn(true);

        UserService.LoginResult result = service.login(" Ana ", "pw");

        assertThat(result.user().mustChangePassword()).isTrue();
        assertThat(result.payload().passwordChangeNonce()).isEqualTo("nonce-1");
        assertThat(result.user().team()).isEqualTo(TEAM);
    }

    @Test
    void loginOmitsTheNonceWhenNoChangeIsPending() {
        row("FROM users WHERE username", user("active", false));
        when(passwords.verify("pw", "stored")).thenReturn(true);

        assertThat(service.login("ana", "pw").payload().passwordChangeNonce()).isNull();
    }

    // --- register ------------------------------------------------------

    @Test
    void registerValidatesUsernameTeamPasswordAndLegajo() {
        assertThatThrownBy(() -> service.register(null, GOOD_PASSWORD, TEAM, null)).hasMessage("Ingresa tu usuario");
        assertThatThrownBy(() -> service.register("a".repeat(65), GOOD_PASSWORD, TEAM, null)).hasMessage("El usuario no puede superar 64 caracteres");
        assertThatThrownBy(() -> service.register("ana", GOOD_PASSWORD, "Otro", null)).hasMessage("Selecciona un equipo valido");
        assertThatThrownBy(() -> service.register("ana", "corta", TEAM, null)).hasMessage("Al menos 10 caracteres");
        assertThatThrownBy(() -> service.register("ana", null, TEAM, null)).hasMessage("Al menos 10 caracteres");
        assertThatThrownBy(() -> service.register("ana", "aaaaabbbbb", TEAM, null)).hasMessage("La contrasena es demasiado simple");
        assertThatThrownBy(() -> service.register("ana", GOOD_PASSWORD, TEAM, "1".repeat(33))).hasMessage("El legajo no puede superar 32 caracteres");
    }

    @Test
    void registerRejectsAnExistingActiveUsername() {
        row("SELECT id::text AS id, status::text AS status FROM users", Map.of("id", "u1", "status", "active"));

        assertThatThrownBy(() -> service.register("ana", GOOD_PASSWORD, TEAM, null)).hasMessage("Ya hay una cuenta con ese usuario");
    }

    @Test
    void aRejectedAccountCanApplyAgainKeepingItsId() {
        row("SELECT id::text AS id, status::text AS status FROM users", Map.of("id", "u1", "status", "rejected"));

        UserService.RegisterResult result = service.register("ana", GOOD_PASSWORD, TEAM, "  321  ");

        assertThat(result.session()).isNull();
        assertThat(result.info()).startsWith("Cuenta creada");
        verify(jdbc).update(contains("UPDATE users SET name"), any(MapSqlParameterSource.class));
        verify(audit).logAudit(eq("u1"), eq("user.registered"), eq("user"), eq("u1"), eq(Map.of("username", "ana", "team", TEAM, "legajo", "321", "resubmitted", true)));
    }

    @Test
    void theFirstAccountBecomesAnActiveAdmin() {
        row("SELECT id::text AS id, status::text AS status FROM users", null);
        when(plain.queryForObject(anyString(), eq(Integer.class))).thenReturn(0);
        when(jdbc.queryForObject(contains("INSERT INTO users"), any(MapSqlParameterSource.class), eq(String.class))).thenReturn("first");

        UserService.RegisterResult result = service.register("Admin", GOOD_PASSWORD, TEAM, " ");

        assertThat(result.info()).isNull();
        assertThat(result.session().user().role()).isEqualTo("admin");
        assertThat(result.session().user().username()).isEqualTo("admin");
    }

    @Test
    void laterAccountsWaitForApproval() {
        row("SELECT id::text AS id, status::text AS status FROM users", null);
        when(plain.queryForObject(anyString(), eq(Integer.class))).thenReturn(3);
        when(jdbc.queryForObject(contains("INSERT INTO users"), any(MapSqlParameterSource.class), eq(String.class))).thenReturn("u9");

        UserService.RegisterResult result = service.register("nuevo", GOOD_PASSWORD, TEAM, null);

        assertThat(result.session()).isNull();
        assertThat(result.info()).startsWith("Cuenta creada");
    }

    @Test
    void aMissingUserCountIsNotTreatedAsFirst() {
        row("SELECT id::text AS id, status::text AS status FROM users", null);
        when(plain.queryForObject(anyString(), eq(Integer.class))).thenReturn(null);
        when(jdbc.queryForObject(contains("INSERT INTO users"), any(MapSqlParameterSource.class), eq(String.class))).thenReturn("u9");

        assertThat(service.register("nuevo", GOOD_PASSWORD, TEAM, null).session()).isNull();
    }

    // --- admin actions -------------------------------------------------

    @Test
    void approvesAndRejectsWithAnAuditSnapshot() {
        row("SELECT name, username, team, status", Map.of("username", "ana", "status", "pending"));

        service.approve("admin", "u1");
        service.reject("admin", "u1");

        verify(jdbc).update(contains("status = 'active'"), any(MapSqlParameterSource.class));
        verify(jdbc).update(contains("status = 'rejected'"), any(MapSqlParameterSource.class));
        verify(audit).logAudit(eq("admin"), eq("user.approved"), eq("user"), eq("u1"), anyMap());
        verify(audit).logAudit(eq("admin"), eq("user.rejected"), eq("user"), eq("u1"), anyMap());
    }

    @Test
    void updatesTheTeamRecordingThePreviousOne() {
        Map<String, Object> target = new HashMap<>();
        target.put("team", null);
        row("SELECT name, username, team, status", target);

        service.updateTeam("admin", "u1", TEAM);

        verify(audit).logAudit("admin", "user.team_updated", "user", "u1", Map.of("previousTeam", "", "newTeam", TEAM));
    }

    @Test
    void updateTeamValidatesTeamAndUser() {
        assertThatThrownBy(() -> service.updateTeam("admin", "u1", "Otro")).hasMessage("Selecciona un equipo valido");
        row("SELECT name, username, team, status", null);
        assertThatThrownBy(() -> service.updateTeam("admin", "u1", TEAM)).hasMessage("Usuario inexistente");
    }

    @Test
    void deactivatesAndRevokesApiKeys() {
        row("SELECT name, username, team, status", Map.of("status", "active"));

        service.deactivate("admin", "u1");

        verify(jdbc).update(contains("UPDATE api_keys SET revoked_at"), any(MapSqlParameterSource.class));
        verify(audit).logAudit(eq("admin"), eq("user.deactivated"), eq("user"), eq("u1"), anyMap());
    }

    @Test
    void deactivateGuardsSelfMissingAndInactiveAccounts() {
        assertThatThrownBy(() -> service.deactivate("admin", "admin")).hasMessage("No podes dar de baja tu propia cuenta");
        row("SELECT name, username, team, status", null);
        assertThatThrownBy(() -> service.deactivate("admin", "u1")).hasMessage("Usuario inexistente");
        row("SELECT name, username, team, status", Map.of("status", "inactive"));
        assertThatThrownBy(() -> service.deactivate("admin", "u1")).hasMessage("La cuenta ya se encuentra desactivada");
    }

    @Test
    void reactivatesOnlyAccountsThatAreNotActive() {
        row("SELECT name, username, team, status", null);
        assertThatThrownBy(() -> service.reactivate("admin", "u1")).hasMessage("Usuario inexistente");
        row("SELECT name, username, team, status", Map.of("status", "active"));
        assertThatThrownBy(() -> service.reactivate("admin", "u1")).hasMessage("La cuenta ya se encuentra activa");

        row("SELECT name, username, team, status", Map.of("status", "inactive"));
        service.reactivate("admin", "u1");
        verify(audit).logAudit(eq("admin"), eq("user.reactivated"), eq("user"), eq("u1"), anyMap());
    }

    @Test
    void resetsThePasswordOfAnActiveAccount() {
        row("SELECT name, username, role::text AS role, status::text AS status FROM users WHERE id", Map.of("status", "active"));

        service.resetPassword("admin", "u1", GOOD_PASSWORD);

        verify(jdbc).update(contains("must_change_password = true"), any(MapSqlParameterSource.class));
        verify(audit).logAudit(eq("admin"), eq("user.password_reset"), eq("user"), eq("u1"), anyMap());
    }

    @Test
    void resetPasswordGuardsInputAndTarget() {
        assertThatThrownBy(() -> service.resetPassword("admin", "u1", "corta")).hasMessage("Al menos 10 caracteres");
        assertThatThrownBy(() -> service.resetPassword("admin", "admin", GOOD_PASSWORD)).hasMessage("No podes restablecer tu propia contrasena");
        row("SELECT name, username, role::text AS role, status::text AS status FROM users WHERE id", null);
        assertThatThrownBy(() -> service.resetPassword("admin", "u1", GOOD_PASSWORD)).hasMessage("Usuario inexistente");
        row("SELECT name, username, role::text AS role, status::text AS status FROM users WHERE id", Map.of("status", "pending"));
        assertThatThrownBy(() -> service.resetPassword("admin", "u1", GOOD_PASSWORD)).hasMessage("Solo se puede restablecer una cuenta activa");
    }

    // --- forced password change ---------------------------------------

    @Test
    void changesTheRequiredPasswordAndClearsTheNonce() {
        row("FROM users WHERE id = :id::uuid LIMIT 1", user("active", true));
        when(passwords.verify(GOOD_PASSWORD, "stored")).thenReturn(false);
        when(jdbc.update(contains("must_change_password = false"), any(MapSqlParameterSource.class))).thenReturn(1);

        UserService.LoginResult result = service.changeRequiredPassword("u1", "nonce-1", GOOD_PASSWORD);

        assertThat(result.user().mustChangePassword()).isFalse();
        assertThat(result.payload().passwordChangeNonce()).isNull();
        verify(audit).logAudit("u1", "user.password_changed", "user", "u1", Map.of("forced", true));
    }

    @Test
    void requiredChangeNeedsAPendingNonceAndAValidPassword() {
        assertThatThrownBy(() -> service.changeRequiredPassword("u1", null, GOOD_PASSWORD)).hasMessage("No hay un cambio de contrasena pendiente");
        assertThatThrownBy(() -> service.changeRequiredPassword("u1", " ", GOOD_PASSWORD)).hasMessage("No hay un cambio de contrasena pendiente");
        assertThatThrownBy(() -> service.changeRequiredPassword("u1", "nonce-1", "corta")).hasMessage("Al menos 10 caracteres");
    }

    @Test
    void requiredChangeRejectsMissingOrInactiveUsers() {
        row("FROM users WHERE id = :id::uuid LIMIT 1", null);
        assertThatThrownBy(() -> service.changeRequiredPassword("u1", "nonce-1", GOOD_PASSWORD)).hasMessage("Usuario inexistente");
        row("FROM users WHERE id = :id::uuid LIMIT 1", user("inactive", true));
        assertThatThrownBy(() -> service.changeRequiredPassword("u1", "nonce-1", GOOD_PASSWORD)).hasMessage("Usuario inexistente");
    }

    @Test
    void requiredChangeRejectsReplacedTemporaryPasswords() {
        row("FROM users WHERE id = :id::uuid LIMIT 1", user("active", false));
        assertThatThrownBy(() -> service.changeRequiredPassword("u1", "nonce-1", GOOD_PASSWORD))
                .hasMessage("La contrasena temporal fue reemplazada; inicia sesion nuevamente");

        row("FROM users WHERE id = :id::uuid LIMIT 1", user("active", true));
        assertThatThrownBy(() -> service.changeRequiredPassword("u1", "otro-nonce", GOOD_PASSWORD))
                .hasMessage("La contrasena temporal fue reemplazada; inicia sesion nuevamente");

        when(passwords.verify(GOOD_PASSWORD, "stored")).thenReturn(false);
        when(jdbc.update(contains("must_change_password = false"), any(MapSqlParameterSource.class))).thenReturn(0);
        assertThatThrownBy(() -> service.changeRequiredPassword("u1", "nonce-1", GOOD_PASSWORD))
                .isInstanceOf(DomainException.class)
                .hasMessage("La contrasena temporal fue reemplazada; inicia sesion nuevamente");
        verify(audit, never()).logAudit(eq("u1"), eq("user.password_changed"), any(), any(), any());
    }

    @Test
    void requiredChangeMustDifferFromTheTemporaryPassword() {
        row("FROM users WHERE id = :id::uuid LIMIT 1", user("active", true));
        when(passwords.verify(GOOD_PASSWORD, "stored")).thenReturn(true);

        assertThatThrownBy(() -> service.changeRequiredPassword("u1", "nonce-1", GOOD_PASSWORD))
                .hasMessage("La nueva contrasena debe ser diferente de la temporal");
    }
}
