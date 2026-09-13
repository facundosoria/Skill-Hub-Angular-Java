package com.skillhub.web;

import com.skillhub.session.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/** Puerto de src/server/auth/actions.ts. */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserService users;
    private final SessionService sessions;

    public AuthController(UserService users, SessionService sessions) {
        this.users = users;
        this.sessions = sessions;
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, String> body, HttpServletResponse res) {
        var r = users.login(body.get("username"), body.get("password"));
        sessions.createSession(res, r.payload());
        return Map.of("user", r.user());
    }

    @PostMapping("/register")
    public Map<String, Object> register(@RequestBody Map<String, String> body, HttpServletResponse res) {
        var r = users.register(body.get("username"), body.get("password"),
                body.get("team"), body.get("legajo"));
        if (r.session() != null) {
            sessions.createSession(res, r.session().payload());
            return Map.of("user", r.session().user());
        }
        return Map.of("info", r.info());
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletResponse res) {
        sessions.destroySession(res);
        return Map.of("ok", true);
    }

    @PostMapping("/change-password")
    public Map<String, Object> changePassword(@AuthPrincipal CurrentUser user,
                                              @RequestBody Map<String, String> body,
                                              HttpServletRequest req,
                                              HttpServletResponse res) {
        if (!user.mustChangePassword()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PASSWORD_CHANGE_NOT_REQUIRED");
        }
        SessionService.SessionPayload session = sessions.readSession(req);
        var changed = users.changeRequiredPassword(
                user.id(), session == null ? null : session.passwordChangeNonce(), body.get("password"));
        sessions.createSession(res, changed.payload());
        return Map.of("user", changed.user());
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req) {
        CurrentUser user = sessions.getCurrentUser(req);
        if (user == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
        return Map.of("user", user);
    }
}
