package com.skillhub.session;

import com.skillhub.audit.AuditService;
import com.skillhub.team.Team;
import com.skillhub.web.DomainException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Puerto de src/server/auth/actions.ts + src/server/users/actions.ts.
 *
 * login: mismo mensaje para usuario inexistente y contrasena mala (no revelar
 * que usuarios existen). El estado de la cuenta se chequea DESPUES de la
 * contrasena. register: la primera cuenta del sistema es admin y entra activa;
 * el resto queda pending hasta que un admin la apruebe. Una cuenta rechazada
 * puede volver a intentarlo (se reescribe la misma fila, mismo id).
 */
@Service
public class UserService {

    private final NamedParameterJdbcTemplate jdbc;
    private final PasswordHasher passwords;
    private final AuditService audit;

    public UserService(NamedParameterJdbcTemplate jdbc, PasswordHasher passwords, AuditService audit) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.audit = audit;
    }

    public record LoginResult(CurrentUser user, SessionService.SessionPayload payload) {}

    public LoginResult login(String rawUsername, String password) {
        String username = rawUsername == null ? "" : rawUsername.trim().toLowerCase();
        if (username.isEmpty() || password == null || password.isEmpty()) {
            throw new DomainException("Ingresa tu usuario y contrasena");
        }
        Map<String, Object> user = one("""
                SELECT id::text AS id, username, name, team, role::text AS role,
                       status::text AS status, password_hash AS hash,
                       must_change_password AS "mustChangePassword",
                       password_change_nonce::text AS "passwordChangeNonce"
                FROM users WHERE username = :u LIMIT 1
                """, new MapSqlParameterSource("u", username));

        boolean ok = user != null && passwords.verify(password, (String) user.get("hash"));
        if (user == null || !ok) throw new DomainException("Usuario o contrasena incorrectos");

        String status = (String) user.get("status");
        if ("pending".equals(status)) throw new DomainException("Tu cuenta todavia no fue aprobada por un administrador.");
        if ("rejected".equals(status)) throw new DomainException("Tu solicitud de acceso fue rechazada.");

        boolean mustChangePassword = Boolean.TRUE.equals(user.get("mustChangePassword"));
        String passwordChangeNonce = mustChangePassword ? (String) user.get("passwordChangeNonce") : null;
        return new LoginResult(
                new CurrentUser((String) user.get("id"), (String) user.get("username"),
                        (String) user.get("name"), (String) user.get("team"), (String) user.get("role"),
                        mustChangePassword),
                new SessionService.SessionPayload((String) user.get("id"),
                        (String) user.get("username"), (String) user.get("role"), passwordChangeNonce));
    }

    public record RegisterResult(String info, LoginResult session) {}

    @Transactional
    public RegisterResult register(String rawUsername, String password, String team, String legajo) {
        String username = rawUsername == null ? "" : rawUsername.trim().toLowerCase();
        if (username.isEmpty()) throw new DomainException("Ingresa tu usuario");
        String canonicalTeam = Team.canonicalOrNull(team);
        if (canonicalTeam == null) throw new DomainException("Selecciona un equipo valido");
        if (password == null || password.length() < 10) throw new DomainException("Al menos 10 caracteres");
        String legajoClean = legajo != null && !legajo.isBlank() ? legajo.trim() : null;

        Map<String, Object> existing = one(
                "SELECT id::text AS id, status::text AS status FROM users WHERE username = :u LIMIT 1",
                new MapSqlParameterSource("u", username));

        if (existing != null && !"rejected".equals(existing.get("status"))) {
            throw new DomainException("Ya hay una cuenta con ese usuario");
        }

        if (existing != null) {
            String id = (String) existing.get("id");
            jdbc.update("""
                    UPDATE users SET name = :name, team = :team, legajo = :legajo,
                           status = 'pending', password_hash = :hash
                    WHERE id = :id::uuid
                    """, base(username, canonicalTeam, legajoClean, password).addValue("id", id));
            audit.logAudit(id, "user.registered", "user", id, meta(username, canonicalTeam, legajoClean, true));
            return new RegisterResult(
                    "Cuenta creada. Un administrador tiene que aprobarla antes de que puedas entrar.", null);
        }

        Integer count = jdbc.getJdbcTemplate().queryForObject("SELECT COUNT(*)::int FROM users", Integer.class);
        boolean first = count != null && count == 0;

        String id = jdbc.queryForObject("""
                INSERT INTO users (username, name, team, legajo, role, status, password_hash)
                VALUES (:username, :name, :team, :legajo, :role::role, :status::account_status, :hash)
                RETURNING id::text
                """, base(username, canonicalTeam, legajoClean, password)
                .addValue("role", first ? "admin" : "member")
                .addValue("status", first ? "active" : "pending"), String.class);
        audit.logAudit(id, "user.registered", "user", id, meta(username, canonicalTeam, legajoClean, false));

        if (!first) {
            return new RegisterResult(
                    "Cuenta creada. Un administrador tiene que aprobarla antes de que puedas entrar.", null);
        }
        return new RegisterResult(null, new LoginResult(
                new CurrentUser(id, username, username, canonicalTeam, "admin", false),
                new SessionService.SessionPayload(id, username, "admin", null)));
    }

    // --- admin: aprobar / rechazar / reset ---------------------------

    @Transactional
    public void approve(String adminId, String userId) {
        Map<String, Object> t = targetSnapshot(userId);
        jdbc.update("UPDATE users SET status = 'active' WHERE id = :id::uuid",
                new MapSqlParameterSource("id", userId));
        audit.logAudit(adminId, "user.approved", "user", userId, t);
    }

    @Transactional
    public void reject(String adminId, String userId) {
        Map<String, Object> t = targetSnapshot(userId);
        jdbc.update("UPDATE users SET status = 'rejected' WHERE id = :id::uuid",
                new MapSqlParameterSource("id", userId));
        audit.logAudit(adminId, "user.rejected", "user", userId, t);
    }

    @Transactional
    public void resetPassword(String adminId, String userId, String newPassword) {
        if (newPassword == null || newPassword.length() < 10) throw new DomainException("Al menos 10 caracteres");
        if (adminId.equals(userId)) throw new DomainException("No podes restablecer tu propia contrasena");
        Map<String, Object> target = one(
                "SELECT name, username, role::text AS role, status::text AS status FROM users WHERE id = :id::uuid LIMIT 1",
                new MapSqlParameterSource("id", userId));
        if (target == null) throw new DomainException("Usuario inexistente");
        if (!"active".equals(target.get("status"))) {
            throw new DomainException("Solo se puede restablecer una cuenta activa");
        }
        jdbc.update("""
                UPDATE users
                SET password_hash = :hash, must_change_password = true,
                    password_change_nonce = gen_random_uuid()
                WHERE id = :id::uuid
                """, new MapSqlParameterSource()
                .addValue("hash", passwords.hash(newPassword))
                .addValue("id", userId));
        audit.logAudit(adminId, "user.password_reset", "user", userId, target);
    }

    @Transactional
    public LoginResult changeRequiredPassword(String userId, String passwordChangeNonce, String newPassword) {
        if (passwordChangeNonce == null || passwordChangeNonce.isBlank()) {
            throw new DomainException("No hay un cambio de contrasena pendiente");
        }
        if (newPassword == null || newPassword.length() < 10) throw new DomainException("Al menos 10 caracteres");

        Map<String, Object> user = one("""
                SELECT id::text AS id, username, name, team, role::text AS role,
                       status::text AS status, password_hash AS hash,
                       must_change_password AS "mustChangePassword",
                       password_change_nonce::text AS "passwordChangeNonce"
                FROM users WHERE id = :id::uuid LIMIT 1
                """, new MapSqlParameterSource("id", userId));
        if (user == null || !"active".equals(user.get("status"))) throw new DomainException("Usuario inexistente");
        if (!Boolean.TRUE.equals(user.get("mustChangePassword"))
                || !passwordChangeNonce.equals(user.get("passwordChangeNonce"))) {
            throw new DomainException("La contrasena temporal fue reemplazada; inicia sesion nuevamente");
        }
        if (passwords.verify(newPassword, (String) user.get("hash"))) {
            throw new DomainException("La nueva contrasena debe ser diferente de la temporal");
        }

        int updated = jdbc.update("""
                UPDATE users
                SET password_hash = :hash, must_change_password = false, password_change_nonce = null
                WHERE id = :id::uuid AND password_change_nonce = :nonce::uuid
                """, new MapSqlParameterSource()
                .addValue("hash", passwords.hash(newPassword))
                .addValue("id", userId)
                .addValue("nonce", passwordChangeNonce));
        if (updated != 1) throw new DomainException("La contrasena temporal fue reemplazada; inicia sesion nuevamente");

        audit.logAudit(userId, "user.password_changed", "user", userId, Map.of("forced", true));
        CurrentUser currentUser = new CurrentUser((String) user.get("id"), (String) user.get("username"),
                (String) user.get("name"), (String) user.get("team"), (String) user.get("role"), false);
        return new LoginResult(currentUser, new SessionService.SessionPayload(
                currentUser.id(), currentUser.username(), currentUser.role(), null));
    }

    public List<Map<String, Object>> listByStatus(String status) {
        return jdbc.query("""
                SELECT id::text AS id, name, username, team, legajo, role::text AS role,
                       status::text AS status, must_change_password AS "mustChangePassword",
                       created_at AS "createdAt"
                FROM users WHERE status = :s::account_status ORDER BY created_at ASC
                """, new MapSqlParameterSource("s", status), (rs, i) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getString("id"));
            m.put("name", rs.getString("name"));
            m.put("username", rs.getString("username"));
            m.put("team", rs.getString("team"));
            m.put("legajo", rs.getString("legajo"));
            m.put("role", rs.getString("role"));
            m.put("status", rs.getString("status"));
            m.put("mustChangePassword", rs.getBoolean("mustChangePassword"));
            m.put("createdAt", String.valueOf(rs.getObject("createdAt")));
            return m;
        });
    }

    // --- helpers ----------------------------------------------------

    private MapSqlParameterSource base(String username, String team, String legajo, String password) {
        return new MapSqlParameterSource()
                .addValue("username", username)
                .addValue("name", username)
                .addValue("team", team)
                .addValue("legajo", legajo)
                .addValue("hash", passwords.hash(password));
    }

    private Map<String, Object> meta(String username, String team, String legajo, boolean resubmitted) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("username", username);
        m.put("team", team);
        m.put("legajo", legajo);
        if (resubmitted) m.put("resubmitted", true);
        return m;
    }

    private Map<String, Object> targetSnapshot(String userId) {
        return one("SELECT name, username FROM users WHERE id = :id::uuid LIMIT 1",
                new MapSqlParameterSource("id", userId));
    }

    private Map<String, Object> one(String sql, MapSqlParameterSource p) {
        var rows = jdbc.queryForList(sql, p);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
