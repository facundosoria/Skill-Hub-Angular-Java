package com.skillhub.session;

/** Puerto de CurrentUser de src/server/auth/index.ts. */
public record CurrentUser(
        String id,
        String username,
        String name,
        String team,
        String role
) {
    public boolean isAdmin() {
        return "admin".equals(role);
    }
}
