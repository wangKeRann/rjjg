package com.cinema.sentinel;

/**
 * Sentinel governance rules:
 * - /api/orders: 20 QPS
 * - /api/search: 50 QPS
 * - hotspot parameter: showId
 */
public class SentinelRules {
    public int qpsLimit(String path) {
        return "/api/orders".equals(path) ? 20 : 50;
    }
}
