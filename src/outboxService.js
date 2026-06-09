const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const loggerModule = require('./logger');
const logger = loggerModule.simpleLogger;

// Outbox 数据文件路径
const OUTBOX_FILE = path.join(__dirname, '..', 'data', 'outbox.json');

// 确保文件存在
function ensureOutboxFile() {
  if (!fs.existsSync(OUTBOX_FILE)) {
    const initialData = {
      meta: {
        version: 1,
        createdAt: new Date().toISOString(),
      },
      events: [],
    };
    fs.writeFileSync(OUTBOX_FILE, JSON.stringify(initialData, null, 2));
  }
}

// 读取 Outbox 事件
function readOutbox() {
  ensureOutboxFile();
  const data = fs.readFileSync(OUTBOX_FILE, 'utf-8');
  return JSON.parse(data);
}

// 写入 Outbox 事件
function writeOutbox(data) {
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(data, null, 2));
}

/**
 * 创建 Outbox 事件记录
 * @param {string} eventType - 事件类型: ORDER_CREATED, ORDER_PAID, ORDER_CANCELLED
 * @param {string} aggregateId - 聚合根ID（订单ID）
 * @param {object} payload - 事件负载数据
 * @param {object} metadata - 额外元数据
 * @returns {object} 创建的事件对象
 */
function createOutboxEvent(eventType, aggregateId, payload, metadata = {}) {
  const event = {
    id: crypto.randomUUID(),
    eventType,
    aggregateId,
    payload: {
      ...payload,
      timestamp: new Date().toISOString(),
    },
    metadata: {
      ...metadata,
      version: 1,
      source: 'cinema-ticket-system',
    },
    status: 'pending',  // pending, sent, failed
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    sentAt: null,
    lastError: null,
  };
  
  const outbox = readOutbox();
  outbox.events.push(event);
  outbox.meta.updatedAt = new Date().toISOString();
  writeOutbox(outbox);
  
  logger.info(`Outbox事件已创建: ${eventType}/${aggregateId}`, {
    eventId: event.id,
    eventType,
    aggregateId,
  });
  
  return event;
}

/**
 * 更新事件状态为已发送
 * @param {string} eventId - 事件ID
 */
function markEventAsSent(eventId) {
  const outbox = readOutbox();
  const event = outbox.events.find(e => e.id === eventId);
  if (event) {
    event.status = 'sent';
    event.sentAt = new Date().toISOString();
    outbox.meta.updatedAt = new Date().toISOString();
    writeOutbox(outbox);
    logger.debug(`Outbox事件已标记为已发送: ${eventId}`);
  }
}

/**
 * 更新事件状态为失败
 * @param {string} eventId - 事件ID
 * @param {string} error - 错误信息
 */
function markEventAsFailed(eventId, error) {
  const outbox = readOutbox();
  const event = outbox.events.find(e => e.id === eventId);
  if (event) {
    event.status = 'failed';
    event.retryCount += 1;
    event.lastError = error;
    outbox.meta.updatedAt = new Date().toISOString();
    writeOutbox(outbox);
    logger.warn(`Outbox事件发送失败: ${eventId}`, { error, retryCount: event.retryCount });
  }
}

/**
 * 获取待发送的事件（pending 状态，且未超过最大重试次数）
 * @param {number} limit - 获取数量限制
 * @returns {array} 待发送事件列表
 */
function getPendingEvents(limit = 100) {
  const outbox = readOutbox();
  return outbox.events
    .filter(e => e.status === 'pending' && e.retryCount < e.maxRetries)
    .slice(0, limit);
}

/**
 * 获取已发送的事件（用于查询）
 * @param {string} aggregateId - 可选，按聚合根ID过滤
 * @returns {array} 已发送事件列表
 */
function getSentEvents(aggregateId = null) {
  const outbox = readOutbox();
  let events = outbox.events.filter(e => e.status === 'sent');
  if (aggregateId) {
    events = events.filter(e => e.aggregateId === aggregateId);
  }
  return events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * 获取指定订单的所有 Outbox 事件
 * @param {string} orderId - 订单ID
 * @returns {array} 事件列表
 */
function getEventsByOrderId(orderId) {
  const outbox = readOutbox();
  return outbox.events
    .filter(e => e.aggregateId === orderId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/**
 * 清理已发送且超过保留时间的事件
 * @param {number} retentionHours - 保留小时数，默认24小时
 */
function cleanupSentEvents(retentionHours = 24) {
  const outbox = readOutbox();
  const cutoffTime = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
  const originalCount = outbox.events.length;
  
  outbox.events = outbox.events.filter(e => {
    if (e.status === 'sent' && new Date(e.sentAt) < cutoffTime) {
      return false;
    }
    return true;
  });
  
  outbox.meta.updatedAt = new Date().toISOString();
  outbox.meta.cleanedAt = new Date().toISOString();
  outbox.meta.cleanedCount = originalCount - outbox.events.length;
  writeOutbox(outbox);
  
  if (outbox.meta.cleanedCount > 0) {
    logger.info(`清理了 ${outbox.meta.cleanedCount} 条已过期的 Outbox 事件`);
  }
}

module.exports = {
  createOutboxEvent,
  markEventAsSent,
  markEventAsFailed,
  getPendingEvents,
  getSentEvents,
  getEventsByOrderId,
  cleanupSentEvents,
  readOutbox,
};