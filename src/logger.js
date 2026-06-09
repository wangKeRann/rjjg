const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 确保日志目录存在
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 自定义格式：Slf4j/logback 风格的 JSON 结构化日志
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'ISO8601' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// 控制台输出格式（开发环境更易读）
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // 所有日志写入 combined.log
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // 错误日志单独写入 error.log
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    // 订单相关日志单独记录（便于分析）
    new winston.transports.File({
      filename: path.join(logDir, 'orders.log'),
      level: 'info',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

// 开发环境同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

// 订单专用日志方法
const orderLogger = {
  created(order) {
    logger.info(`[ORDER_CREATED] ${order.id}`, {
      eventType: 'ORDER_CREATED',
      orderId: order.id,
      userId: order.userId,
      amount: order.amount,
      seats: order.seats,
      showId: order.showId,
      timestamp: new Date().toISOString(),
    });
  },
  paid(order) {
    logger.info(`[ORDER_PAID] ${order.id}`, {
      eventType: 'ORDER_PAID',
      orderId: order.id,
      userId: order.userId,
      amount: order.amount,
      paidAt: order.paidAt,
      timestamp: new Date().toISOString(),
    });
  },
  cancelled(order, reason) {
    logger.warn(`[ORDER_CANCELLED] ${order.id}`, {
      eventType: 'ORDER_CANCELLED',
      orderId: order.id,
      userId: order.userId,
      reason,
      cancelledAt: order.cancelledAt,
      timestamp: new Date().toISOString(),
    });
  },
  paymentFailed(orderId, userId, error) {
    logger.error(`[PAYMENT_FAILED] ${orderId}`, {
      eventType: 'PAYMENT_FAILED',
      orderId,
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  },
};

// 兼容原有的简单 logger 接口
const simpleLogger = {
  info(msg, meta) {
    if (typeof msg === 'string') {
      logger.info(msg, meta);
    } else {
      logger.info(msg.message || 'info', { ...msg, ...meta });
    }
  },
  warn(msg, meta) {
    if (typeof msg === 'string') {
      logger.warn(msg, meta);
    } else {
      logger.warn(msg.message || 'warn', { ...msg, ...meta });
    }
  },
  error(msg, meta) {
    if (typeof msg === 'string') {
      logger.error(msg, meta);
    } else {
      logger.error(msg.message || 'error', { ...msg, ...meta });
    }
  },
  debug(msg, meta) {
    if (typeof msg === 'string') {
      logger.debug(msg, meta);
    } else {
      logger.debug(msg.message || 'debug', { ...msg, ...meta });
    }
  },
};

module.exports = {
  logger,           // winston 原生实例
  orderLogger,      // 订单专用日志
  simpleLogger,     // 兼容原有接口
};