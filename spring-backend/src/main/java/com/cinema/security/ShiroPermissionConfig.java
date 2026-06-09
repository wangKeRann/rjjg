package com.cinema.security;

import java.util.Map;
import java.util.Set;

/**
 * Shiro module:
 * - admin role and permission mapping
 * - menu permission such as movie:manage, show:manage, order:manage
 */
public class ShiroPermissionConfig {
    private final Map<String, Set<String>> permissions = Map.of(
            "CUSTOMER", Set.of("movie:read", "show:read", "order:create", "order:read:self", "order:pay:self", "order:cancel:self"),
            "ADMIN", Set.of("movie:read", "show:read", "admin:dashboard", "show:price:update", "order:read:any", "order:pay:any", "order:cancel:any", "cache:manage", "ops:view")
    );

    public boolean hasPermission(String role, String permission) {
        return permissions.getOrDefault(role, Set.of()).contains(permission);
    }

    public Set<String> permissionsForRole(String role) {
        return permissions.getOrDefault(role, Set.of());
    }
}
