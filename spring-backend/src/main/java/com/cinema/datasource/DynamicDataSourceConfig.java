package com.cinema.datasource;

/**
 * Database read/write splitting:
 * - write operations: write-db
 * - read operations: read-db
 * - transaction context decides routing key
 */
public class DynamicDataSourceConfig {
    public String route(String operation) {
        return operation != null && operation.startsWith("write") ? "write-db" : "read-db";
    }
}
