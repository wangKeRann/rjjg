package com.cinema.security;

/**
 * Shiro module:
 * - admin role and permission mapping
 * - menu permission such as movie:manage, show:manage, order:manage
 */
public class ShiroPermissionConfig {
    public boolean hasPermission(String role, String permission) {
        return "ADMIN".equals(role) || "ops:view".equals(permission);
    }
}
