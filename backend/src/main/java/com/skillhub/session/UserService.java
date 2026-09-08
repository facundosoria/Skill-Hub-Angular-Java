package com.skillhub.session;

import com.skillhub.audit.AuditService;
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
                       status::text AS status, password_hash AS hash
                FROM users WHERE username = :u LIMIT 1
                """, new MapSqlParameterSource("u", username));

        boolean ok = user != null && passwords.verify(password, (String) user.get("hash"));
        if (user == null || !ok) throw new DomainException("Usuario o contrasena incorrectos");

        String status = (String) user.get("status");
        if ("pending".equals(status)) throw new DomainException("Tu cuenta todavia no fue aprobada por un administrador.");
        if ("rejected".equals(status)) throw new DomainException("Tu solicitud de acceso fue rechazada.");

        return new LoginResult(
                new CurrentUser((String) user.get("id"), (String) user.get("username"),
                        (String) user.get("name"), (String) user.get("team"), (String) user.get("role")),
                new SessionService.SessionPayload((String) user.get("id"),
                        (String) user.get("username"), (String) user.get("role")));
    }

    public record RegisterResult(String info, LoginResult session) {}

    @Transactional
    public RegisterResult register(String rawUsername, String password, String team, String legajo) {
        String username = rawUsername == null ? "" : rawUsername.trim().toLowerCase();
        if (username.isEmpty()) throw new DomainException("Ingresa tu usuario");
        if (team == null || team.isBlank()) throw new DomainException("Ingresa tu equipo");
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
                    """, base(username, team, legajoClean, password).addValue("id", id));
            audit.logAudit(id, "user.registered", "user", id, meta(username, team, legajoClean, true));
            return new RegisterResult(
                    "Cuenta creada. Un administrador tiene que aprobarla antes de que puedas entrar.", null);
        }

        Integer count = jdbc.getJdbcTemplate().queryForObject("SELECT COUNT(*)::int FROM users", Integer.class);
        boolean first = count != null && count == 0;

        String id = jdbc.queryForObject("""
                INSERT INTO users (username, name, team, legajo, role, status, password_hash)
                VALUES (:username, :name, :team, :legajo, :role::role, :status::account_status, :hash)
                RETURNING id::text
                """, base(username, team, legajoClean, password)
                .addValue("role", first ? "admin" : "member")
                .addValue("status", first ? "active" : "pending"), String.class);
        audit.logAudit(id, "user.registered", "user", id, meta(username, team, legajoClean, false));

        if (!first) {
            return new RegisterResult(
                    "Cuenta creada. Un administrador tiene que aprobarla antes de que puedas entrar.", null);
        }
        return new RegisterResult(null, new LoginResult(
                new CurrentUser(id, username, username, team, "admin"),
                new SessionService.SessionPayload(id, username, "admin")));
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
        Map<String, Object> t = targetSnapshot(userId);
        if (t == null) throw new DomainException("Usuario inexistente");
        jdbc.update("UPDATE users SET password_hash = :hash WHERE id = :id::uuid",
                new MapSqlParameterSource().addValue("hash", passwords.hash(newPassword)).addValue("id", userId));
        audit.logAudit(adminId, "user.password_reset", "user", userId, t);
    }

    public List<Map<String, Object>> listByStatus(String status) {
        return jdbc.query("""
                SELECT id::text AS id, name, username, team, legajo, created_at AS "createdAt"
                FROM users WHERE status = :s::account_status ORDER BY created_at ASC
                """, new MapSqlParameterSource("s", status), (rs, i) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getString("id"));
            m.put("name", rs.getString("name"));
            m.put("username", rs.getString("username"));
            m.put("team", rs.getString("team"));
            m.put("legajo", rs.getString("legajo"));
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
