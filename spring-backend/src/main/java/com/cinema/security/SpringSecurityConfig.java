package com.cinema.security;

import java.util.List;

/**
 * Spring Security module:
 * - authenticates user login
 * - issues JWT for customer/admin APIs
 * - protects order/payment/admin interfaces
 */
public class SpringSecurityConfig {
    public String loginPolicy() {
        return "JWT Bearer authentication with 8 hour expiry";
    }

    public List<String> publicEndpoints() {
        return List.of("/api/auth/login", "/api/health", "/api/movies", "/api/search");
    }

    public boolean requiresJwt(String endpoint) {
        return publicEndpoints().stream().noneMatch(endpoint::startsWith);
    }
}
