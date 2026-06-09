package com.cinema;

import com.cinema.datasource.DynamicDataSourceConfig;
import com.cinema.order.OrderMessagePublisher;
import com.cinema.security.ShiroPermissionConfig;
import com.cinema.security.SpringSecurityConfig;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class ArchitectureSmokeTest {
    @Test
    void routesReadWriteDatasource() {
        DynamicDataSourceConfig config = new DynamicDataSourceConfig();
        Assertions.assertEquals("write-db", config.route("writeOrder"));
        Assertions.assertEquals("read-db", config.route("queryMovie"));
    }

    @Test
    void mapsOrderEventToRabbitRoute() {
        OrderMessagePublisher publisher = new OrderMessagePublisher();
        Assertions.assertEquals("ticket.issue", publisher.routingKey("ORDER_PAID"));
    }

    @Test
    void grantsAdminPermissionWithShiro() {
        ShiroPermissionConfig shiro = new ShiroPermissionConfig();
        Assertions.assertTrue(shiro.hasPermission("ADMIN", "show:price:update"));
        Assertions.assertFalse(shiro.hasPermission("CUSTOMER", "show:price:update"));
    }

    @Test
    void protectsPrivateEndpointsWithSpringSecurityPolicy() {
        SpringSecurityConfig security = new SpringSecurityConfig();
        Assertions.assertFalse(security.requiresJwt("/api/auth/login"));
        Assertions.assertTrue(security.requiresJwt("/api/admin/dashboard"));
    }
}
