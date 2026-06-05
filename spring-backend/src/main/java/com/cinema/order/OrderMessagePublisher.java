package com.cinema.order;

/**
 * RabbitMQ publisher:
 * - ORDER_CREATED routes to ticket.issue queue
 * - ORDER_PAID routes to points.reward queue
 * - ORDER_CANCELLED routes to seat.release queue
 */
public class OrderMessagePublisher {
    public String routingKey(String eventType) {
        if ("ORDER_PAID".equals(eventType)) {
            return "ticket.issue";
        }
        if ("ORDER_CANCELLED".equals(eventType)) {
            return "seat.release";
        }
        return "order.created";
    }
}
