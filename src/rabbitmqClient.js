const amqp = require('amqplib');
const loggerModule = require('./logger');
const logger = loggerModule.simpleLogger;
const { markEventAsSent, markEventAsFailed } = require('./outboxService');

let connection = null;
let channel = null;
let isConnected = false;
let reconnectTimer = null;

// 配置
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE_NAME = 'order_events';
const EXCHANGE_TYPE = 'topic';
const QUEUES = {
  orderPaid: 'order_paid_queue',
  stats: 'stats_queue',
  notification: 'notification_queue',
};

// 路由键
const ROUTING_KEYS = {
  ORDER_CREATED: 'order.created',
  ORDER_PAID: 'order.paid',
  ORDER_CANCELLED: 'order.cancelled',
  PRICE_UPDATED: 'price.updated',
};

/**
 * 连接 RabbitMQ
 */
async function connectRabbitMQ() {
  if (isConnected && channel) {
    return true;
  }
  
  try {
    logger.info('正在连接 RabbitMQ...', { url: RABBITMQ_URL.replace(/\/\/[^@]+@/, '//***@') });
    
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    // 声明 Topic 交换机
    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
      durable: true,
      autoDelete: false,
    });
    
    // 声明各个队列
    for (const [key, queueName] of Object.entries(QUEUES)) {
      await channel.assertQueue(queueName, {
        durable: true,
        maxPriority: 10,
      });
      // 绑定队列到交换机
      if (key === 'orderPaid') {
        await channel.bindQueue(queueName, EXCHANGE_NAME, ROUTING_KEYS.ORDER_PAID);
      } else if (key === 'stats') {
        await channel.bindQueue(queueName, EXCHANGE_NAME, 'order.*');  // 匹配所有订单事件
        await channel.bindQueue(queueName, EXCHANGE_NAME, ROUTING_KEYS.PRICE_UPDATED);
      } else if (key === 'notification') {
        await channel.bindQueue(queueName, EXCHANGE_NAME, 'order.*');
      }
    }
    
    // 监听连接关闭事件，自动重连
    connection.on('close', () => {
      logger.warn('RabbitMQ 连接关闭，尝试重连...');
      isConnected = false;
      scheduleReconnect();
    });
    
    connection.on('error', (err) => {
      logger.error('RabbitMQ 连接错误', { error: err.message });
      isConnected = false;
    });
    
    isConnected = true;
    logger.info('RabbitMQ 连接成功', {
      exchange: EXCHANGE_NAME,
      queues: Object.values(QUEUES),
    });
    
    return true;
  } catch (error) {
    logger.error('RabbitMQ 连接失败', { error: error.message });
    isConnected = false;
    scheduleReconnect();
    return false;
  }
}

/**
 * 调度重连
 */
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    logger.info('尝试重新连接 RabbitMQ...');
    await connectRabbitMQ();
  }, 5000);
}

/**
 * 发布事件到 RabbitMQ
 * @param {string} routingKey - 路由键
 * @param {object} eventData - 事件数据
 * @param {string} outboxEventId - 关联的 Outbox 事件ID（可选）
 */
async function publishEvent(routingKey, eventData, outboxEventId = null) {
  if (!channel || !isConnected) {
    logger.warn('RabbitMQ 未连接，事件将仅保存在 Outbox 中', {
      routingKey,
      eventId: outboxEventId,
    });
    return false;
  }
  
  try {
    const message = Buffer.from(JSON.stringify({
      ...eventData,
      _metadata: {
        publishedAt: new Date().toISOString(),
        routingKey,
        eventId: outboxEventId,
      },
    }));
    
    const published = channel.publish(EXCHANGE_NAME, routingKey, message, {
      persistent: true,        // 消息持久化
      contentType: 'application/json',
      timestamp: Date.now(),
    });
    
    logger.debug(`事件已发布到 RabbitMQ: ${routingKey}`, {
      routingKey,
      eventId: outboxEventId,
      published,
    });
    
    // 如果有关联的 Outbox 事件，标记为已发送
    if (outboxEventId && published) {
      markEventAsSent(outboxEventId);
    }
    
    return published;
  } catch (error) {
    logger.error(`发布事件失败: ${routingKey}`, {
      error: error.message,
      routingKey,
      eventId: outboxEventId,
    });
    
    // 如果有关联的 Outbox 事件，标记为失败
    if (outboxEventId) {
      markEventAsFailed(outboxEventId, error.message);
    }
    
    return false;
  }
}

/**
 * 消费队列消息
 * @param {string} queueName - 队列名称
 * @param {function} callback - 回调函数 (message) => void
 */
async function consume(queueName, callback) {
  if (!channel || !isConnected) {
    logger.warn('RabbitMQ 未连接，无法消费消息', { queueName });
    return false;
  }
  
  try {
    await channel.consume(queueName, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          callback(content, msg);
          channel.ack(msg);
        } catch (error) {
          logger.error(`处理消息失败: ${queueName}`, {
            error: error.message,
            content: msg.content.toString(),
          });
          // 拒绝消息并重新入队（延迟重试）
          channel.nack(msg, false, true);
        }
      }
    });
    
    logger.info(`已启动队列消费: ${queueName}`);
    return true;
  } catch (error) {
    logger.error(`启动队列消费失败: ${queueName}`, { error: error.message });
    return false;
  }
}

/**
 * 发送订单事件（便捷方法，自动创建 Outbox 记录）
 * @param {string} eventType - 事件类型
 * @param {object} order - 订单对象
 */
async function sendOrderEvent(eventType, order) {
  const routingKeyMap = {
    ORDER_CREATED: ROUTING_KEYS.ORDER_CREATED,
    ORDER_PAID: ROUTING_KEYS.ORDER_PAID,
    ORDER_CANCELLED: ROUTING_KEYS.ORDER_CANCELLED,
  };
  
  const routingKey = routingKeyMap[eventType];
  if (!routingKey) {
    logger.error(`未知的事件类型: ${eventType}`);
    return false;
  }
  
  const eventData = {
    eventType,
    orderId: order.id,
    userId: order.userId,
    userName: order.userName,
    amount: order.amount,
    seats: order.seats,
    showId: order.showId,
    movieTitle: order.movieTitle,
    cinema: order.cinema,
    status: order.status,
    ...(order.paidAt && { paidAt: order.paidAt }),
    ...(order.cancelledAt && { cancelledAt: order.cancelledAt }),
    ...(order.cancelReason && { cancelReason: order.cancelReason }),
  };
  
  // 创建 Outbox 事件（保证一致性）
  const { createOutboxEvent } = require('./outboxService');
  const outboxEvent = createOutboxEvent(eventType, order.id, eventData);
  
  // 发布到 RabbitMQ
  return await publishEvent(routingKey, eventData, outboxEvent.id);
}

/**
 * 获取连接状态
 */
function getConnectionStatus() {
  return {
    connected: isConnected,
    url: RABBITMQ_URL.replace(/\/\/[^@]+@/, '//***@'),
    exchange: EXCHANGE_NAME,
  };
}

/**
 * 关闭连接
 */
async function closeConnection() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (channel) await channel.close();
  if (connection) await connection.close();
  isConnected = false;
  logger.info('RabbitMQ 连接已关闭');
}

module.exports = {
  connectRabbitMQ,
  publishEvent,
  consume,
  sendOrderEvent,
  getConnectionStatus,
  closeConnection,
  ROUTING_KEYS,
  QUEUES,
};