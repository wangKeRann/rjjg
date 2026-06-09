#!/usr/bin/env node
/**
 * Outbox 事件处理脚本
 * 定时扫描并重新发送失败的 Outbox 事件
 * 
 * 使用方式：
 *   node scripts/processOutbox.js          # 单次执行
 *   node scripts/processOutbox.js --watch  # 持续监听模式
 */

const { getPendingEvents, markEventAsSent, markEventAsFailed } = require('../src/outboxService');
const { publishEvent, connectRabbitMQ, getConnectionStatus } = require('../src/rabbitmqClient');
const { simpleLogger as logger } = require('../src/logger');

async function processPendingEvents() {
  const pendingEvents = getPendingEvents(50);
  
  if (pendingEvents.length === 0) {
    logger.debug('没有待处理的 Outbox 事件');
    return 0;
  }
  
  logger.info(`发现 ${pendingEvents.length} 条待处理的 Outbox 事件`);
  
  // 确保 RabbitMQ 已连接
  await connectRabbitMQ();
  const status = getConnectionStatus();
  
  let successCount = 0;
  let failCount = 0;
  
  for (const event of pendingEvents) {
    const routingKey = getRoutingKeyByEventType(event.eventType);
    
    if (!routingKey) {
      logger.warn(`未知事件类型: ${event.eventType}`, { eventId: event.id });
      markEventAsFailed(event.id, `Unknown event type: ${event.eventType}`);
      failCount++;
      continue;
    }
    
    const published = await publishEvent(routingKey, event.payload, event.id);
    
    if (published) {
      successCount++;
      logger.debug(`事件已重新发送: ${event.eventType}/${event.aggregateId}`, {
        eventId: event.id,
      });
    } else {
      failCount++;
      logger.warn(`事件重新发送失败: ${event.eventType}/${event.aggregateId}`, {
        eventId: event.id,
      });
    }
  }
  
  logger.info(`Outbox 处理完成: 成功=${successCount}, 失败=${failCount}`);
  return successCount;
}

function getRoutingKeyByEventType(eventType) {
  const routingKeyMap = {
    ORDER_CREATED: 'order.created',
    ORDER_PAID: 'order.paid',
    ORDER_CANCELLED: 'order.cancelled',
    PRICE_UPDATED: 'price.updated',
  };
  return routingKeyMap[eventType];
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const isWatchMode = args.includes('--watch');
  
  logger.info('Outbox 处理器启动', { watchMode: isWatchMode });
  
  if (isWatchMode) {
    // 持续监听模式：每 10 秒执行一次
    setInterval(async () => {
      await processPendingEvents();
    }, 10000);
    
    // 保持进程运行
    process.on('SIGINT', () => {
      logger.info('Outbox 处理器已停止');
      process.exit(0);
    });
  } else {
    // 单次执行模式
    await processPendingEvents();
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = { processPendingEvents };