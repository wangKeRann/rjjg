const crypto = require('crypto');
const logger = require('./logger').simpleLogger;
const { 
  addOrder, 
  findShow, 
  getOrders, 
  markSeatsSold, 
  updateOrder,
} = require('./catalog');
const { sendOrderEvent } = require('./rabbitmqClient');

const LOCK_TTL_SECONDS = 120;
const MAX_SEATS_PER_ORDER = 4;

/**
 * 创建订单（带 Outbox 事件）
 * @param {object} params - 订单参数
 * @param {object} store - RedisStore 实例（用于锁座）
 * @returns {Promise<object>} 创建的订单
 */
async function createOrder({ showId, seats, userId, userName }, store) {
  const item = findShow(showId);
  if (!item) {
    throw new Error('SHOW_NOT_FOUND');
  }
  
  const uniqueSeats = Array.from(new Set(seats.map(s => String(s).trim()).filter(Boolean)));
  if (uniqueSeats.length === 0 || uniqueSeats.length > MAX_SEATS_PER_ORDER) {
    throw new Error(`INVALID_SEAT_COUNT: max ${MAX_SEATS_PER_ORDER}`);
  }
  
  // 验证座位有效性
  const invalidSeat = uniqueSeats.find(seat => !item.show.seats.includes(seat));
  if (invalidSeat) {
    throw new Error(`INVALID_SEAT: ${invalidSeat}`);
  }
  
  // 验证座位是否已售出
  const soldSeat = uniqueSeats.find(seat => item.show.sold.includes(seat));
  if (soldSeat) {
    throw new Error(`SEAT_ALREADY_SOLD: ${soldSeat}`);
  }
  
  // 锁座
  const lockedSeats = [];
  for (const seat of uniqueSeats) {
    const locked = await store.lockSeat(showId, seat, orderId, LOCK_TTL_SECONDS);
    if (!locked) {
      // 释放已锁座位
      await Promise.all(lockedSeats.map(s => store.releaseSeat(showId, s, orderId)));
      throw new Error(`SEAT_TEMPORARILY_LOCKED: ${seat}`);
    }
    lockedSeats.push(seat);
  }
  
  const orderId = crypto.randomUUID();
  const order = {
    id: orderId,
    showId,
    movieTitle: item.movie.title,
    cinema: item.show.cinema,
    hall: item.show.hall,
    startsAt: item.show.startsAt,
    seats: uniqueSeats,
    userId,
    userName,
    amount: uniqueSeats.length * item.show.price,
    status: 'PENDING_PAYMENT',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString(),
  };
  
  addOrder(order);
  
  // 记录日志
  orderLogger.created(order);
  
  // 发送 Outbox + RabbitMQ 事件
  await sendOrderEvent('ORDER_CREATED', order);
  
  return { order, lockTtlSeconds: LOCK_TTL_SECONDS };
}

/**
 * 支付订单（带 Outbox 事件）
 * @param {string} orderId - 订单ID
 * @param {object} store - RedisStore 实例
 * @returns {Promise<object>} 支付后的订单
 */
async function payOrder(orderId, store) {
  const orders = getOrders();
  const order = orders.find(o => o.id === orderId);
  
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  
  if (order.status !== 'PENDING_PAYMENT') {
    throw new Error(`ORDER_NOT_PAYABLE: ${order.status}`);
  }
  
  if (Date.parse(order.expiresAt) <= Date.now()) {
    throw new Error('ORDER_EXPIRED');
  }
  
  // 验证锁仍然有效
  const item = findShow(order.showId);
  for (const seat of order.seats) {
    const owner = await store.getLockOwner(order.showId, seat);
    if (owner !== order.id) {
      throw new Error(`LOCK_LOST: ${seat}`);
    }
  }
  
  // 释放锁并标记座位已售
  for (const seat of order.seats) {
    await store.releaseSeat(order.showId, seat, order.id);
  }
  markSeatsSold(order.showId, order.seats);
  
  // 更新订单状态
  const paidOrder = updateOrder(order.id, (row) => {
    row.status = 'PAID';
    row.paidAt = new Date().toISOString();
  });
  
  // 记录日志
  orderLogger.paid(paidOrder);
  
  // 发送 Outbox + RabbitMQ 事件
  await sendOrderEvent('ORDER_PAID', paidOrder);
  
  return paidOrder;
}

/**
 * 取消订单（带 Outbox 事件）
 * @param {string} orderId - 订单ID
 * @param {string} reason - 取消原因
 * @param {object} store - RedisStore 实例
 * @returns {Promise<object>} 取消后的订单
 */
async function cancelOrder(orderId, reason, store) {
  const orders = getOrders();
  const order = orders.find(o => o.id === orderId);
  
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  
  if (order.status !== 'PENDING_PAYMENT') {
    return order;
  }
  
  // 释放锁
  await Promise.all(order.seats.map(seat => store.releaseSeat(order.showId, seat, order.id)));
  
  // 更新订单状态
  const cancelledOrder = updateOrder(order.id, (row) => {
    row.status = 'CANCELLED';
    row.cancelReason = reason;
    row.cancelledAt = new Date().toISOString();
  });
  
  // 记录日志
  orderLogger.cancelled(cancelledOrder, reason);
  
  // 发送 Outbox + RabbitMQ 事件
  await sendOrderEvent('ORDER_CANCELLED', cancelledOrder);
  
  return cancelledOrder;
}

/**
 * 获取用户订单列表
 * @param {string} userId - 用户ID
 * @returns {array} 订单列表
 */
function getUserOrders(userId) {
  const orders = getOrders();
  return orders
    .filter(order => order.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * 获取订单详情
 * @param {string} orderId - 订单ID
 * @returns {object|null} 订单对象
 */
function getOrderById(orderId) {
  const orders = getOrders();
  return orders.find(o => o.id === orderId) || null;
}

module.exports = {
  createOrder,
  payOrder,
  cancelOrder,
  getUserOrders,
  getOrderById,
  LOCK_TTL_SECONDS,
  MAX_SEATS_PER_ORDER,
};