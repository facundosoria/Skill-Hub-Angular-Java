package com.skillhub.web;

import com.skillhub.session.AuthPrincipal;
import com.skillhub.session.CurrentUser;
import com.skillhub.session.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/** Puerto de src/server/users/actions.ts + /admin/users. */
@RestController
@RequestMapping("/api/admin/users")
public class AdminUserController {

    private final UserService users;

    public AdminUserController(UserService users) {
        this.users = users;
    }

    @GetMapping
    public Map<String, Object> list(@AuthPrincipal CurrentUser user) {
        requireAdmin(user);
        return Map.of("pending", users.listByStatus("pending"), "active", users.listByStatus("active"));
    }

    @PostMapping("/{id}/approve")
    public Map<String, Object> approve(@AuthPrincipal CurrentUser user, @PathVariable String id) {
        requireAdmin(user);
        users.approve(user.id(), id);
        return Map.of("ok", true);
    }

    @PostMapping("/{id}/reject")
    public Map<String, Object> reject(@AuthPrincipal CurrentUser user, @PathVariable String id) {
        requireAdmin(user);
        users.reject(user.id(), id);
        return Map.of("ok", true);
    }

    @PostMapping("/{id}/reset-password")
    public Map<String, Object> resetPassword(@AuthPrincipal CurrentUser user, @PathVariable String id,
                                             @RequestBody Map<String, String> body) {
        requireAdmin(user);
        users.resetPassword(user.id(), id, body.get("password"));
        return Map.of("ok", true);
    }

    private void requireAdmin(CurrentUser user) {
        if (!user.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un admin");
    }
}
