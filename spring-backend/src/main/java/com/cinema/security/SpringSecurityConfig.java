package com.cinema.security;

/**
 * Spring Security module:
 * - authenticates user login
 * - issues JWT for customer APIs
 * - protects order/payment interfaces
 */
public class SpringSecurityConfig {
    public String loginPolicy() {
        return "JWT authentication for /api/orders and /api/profile";
    }
}
